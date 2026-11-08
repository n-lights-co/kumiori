import { beforeAll, describe, expect, it } from "vitest";
import {
  AREA_TREE_SCHEMA_VERSION,
  AreaTreeFormatError,
  parseAreaTree,
  serializeAreaTree,
  childrenOf,
  walkAreaTree,
} from "../src/areaTree";
import { paintSheet, type Painter } from "../src/paint";
import { doc, makeEngine } from "./helpers";

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 描く処理の呼び出しを記録する Painter (呼んだ関数の名前と引数) */
function recorder(): { p: Painter; log: string[] } {
  const log: string[] = [];
  const p = new Proxy({} as Painter, {
    get:
      (_t, name) =>
      (...args: unknown[]) => {
        log.push(
          `${String(name)} ${JSON.stringify(args.map((a) => (typeof a === "function" ? "fn" : a)))}`,
        );
        for (const a of args) if (typeof a === "function") (a as () => void)();
      },
  });
  return { p, log };
}

describe("Area Tree の決まり (areaTree.ts)", () => {
  const sample = () =>
    E.engine.layout(
      doc([
        {
          type: "block",
          children: [
            "本文の段落",
            { type: "ruby", baseText: "漢字", rubyText: "かんじ" },
          ],
        },
        { type: "block", id: "x", children: ["二つ目"] },
      ] as never),
    );

  it("版の番号を持つ", () => {
    expect(sample().schemaVersion).toBe(AREA_TREE_SCHEMA_VERSION);
  });

  it("childrenOf は描く順に子を返す (page は背面 → 本文 → 絶対配置、ruby は親文字 → ルビ)", () => {
    const t = sample();
    const sheet = t.sheets[0];
    expect(childrenOf(sheet)).toEqual([sheet.page]);
    const page = sheet.page;
    expect(childrenOf(page)).toEqual([
      ...page.behindAreas,
      page.regionBody,
      ...page.absoluteAreas,
    ]);
    const types = new Set<string>();
    walkAreaTree(t, (a) => void types.add(a.type));
    expect([...types]).toEqual(
      expect.arrayContaining([
        "sheet",
        "page",
        "region-body",
        "block",
        "line",
        "glyph",
        "ruby",
      ]),
    );
  });

  it("JSON にして読み直した木も、同じ描き方になる", () => {
    const t = sample();
    const copy = JSON.parse(JSON.stringify(t)) as typeof t;
    const a = recorder();
    const b = recorder();
    t.sheets.forEach((s) => paintSheet(s, a.p));
    copy.sheets.forEach((s) => paintSheet(s, b.p));
    expect(a.log.length).toBeGreaterThan(5);
    expect(b.log).toEqual(a.log);
  });

  it('serializeAreaTree・parseAreaTree で往復した木は、同じ描き方になる', () => {
    const t = sample();
    const back = parseAreaTree(serializeAreaTree(t));
    const a = recorder();
    const b = recorder();
    t.sheets.forEach((s) => paintSheet(s, a.p));
    back.sheets.forEach((s) => paintSheet(s, b.p));
    expect(b.log).toEqual(a.log);
  });

  it('parseAreaTree は、版や形の合わない木を誤りにする', () => {
    const t = JSON.parse(serializeAreaTree(sample()));
    expect(() => parseAreaTree('{')).toThrow(AreaTreeFormatError);
    expect(() => parseAreaTree(JSON.stringify({ ...t, schemaVersion: 99 }))).toThrow(/版 99/);
    const broken = JSON.parse(JSON.stringify(t));
    broken.sheets[0].page.regionBody.children[0].width = 'wide';
    expect(() => parseAreaTree(JSON.stringify(broken))).toThrow(/width が数ではありません/);
  });
});

describe("元の入力の節への参照 (sourceRef)", () => {
  it("block・inline・字・表のセルの Area は、documentNodes(doc) の位置で元の節を指す", async () => {
    const { documentNodes } = await import("../src/areaTree");
    const em = { type: "inline", fontWeight: 700, children: ["強"] };
    const para = { type: "block", children: ["本", em] };
    const cell = { type: "table-cell", children: [{ type: "block", children: ["表"] }] };
    const d = doc([
      para,
      { type: "table", columns: [{ type: "table-column", width: 50 }], body: { type: "table-body", rows: [{ type: "table-row", cells: [cell] }] } },
    ] as never);
    const nodes = documentNodes(d);
    const tree = E.engine.layout(d);
    const of = (pred: (a: { type: string; text?: string }) => boolean) => {
      let hit: { sourceRef?: number } | undefined;
      walkAreaTree(tree, (a) => {
        if (!hit && pred(a as never)) hit = a as never;
      });
      return hit?.sourceRef === undefined ? undefined : nodes[hit.sourceRef];
    };
    // block の直下の字は block、inline の中の字は inline
    expect(of((a) => a.type === "glyph" && a.text === "本")).toBe(para);
    expect(of((a) => a.type === "glyph" && a.text === "強")).toBe(em);
    expect(of((a) => a.type === "block")).toBe(para);
    expect(of((a) => a.type === "table-cell")).toBe(cell);
    // JSON にして読み直しても、番号は残る
    const back = parseAreaTree(serializeAreaTree(tree));
    let refs = 0;
    walkAreaTree(back, (a) => {
      if (a.sourceRef !== undefined) refs++;
    });
    expect(refs).toBeGreaterThan(3);
  });
});

describe("Area Tree の版 2", () => {
  it("版 1 の木 (罫線の重ね合わせの欄が BorderSide に直接ある) を読むと、collapse の下に移して版 2 にする", () => {
    const t = E.engine.layout(doc([{ type: "block", children: ["あ"] }]));
    const v1 = JSON.parse(serializeAreaTree(t));
    v1.schemaVersion = 1;
    const block = v1.sheets[0].page.regionBody.children[0];
    block.border = { top: { width: 0.5, color: "#000000", noPaint: true }, bottom: { width: 0.5, color: "#000000", paintWidth: 1, tableEdge: true } };
    const back = parseAreaTree(JSON.stringify(v1));
    expect(back.schemaVersion).toBe(2);
    const b = (back.sheets[0].page.regionBody.children[0] as unknown as { border: Record<string, unknown> }).border;
    expect(b.top).toEqual({ width: 0.5, color: "#000000", collapse: { noPaint: true } });
    expect(b.bottom).toEqual({ width: 0.5, color: "#000000", collapse: { paintWidth: 1, tableEdge: true } });
  });
});
