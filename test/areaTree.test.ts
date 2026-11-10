import { beforeAll, describe, expect, it } from "vitest";
import {
  AREA_TREE_SCHEMA_VERSION,
  AreaTreeFormatError,
  parseAreaTree,
  serializeAreaTree,
  childrenOf,
  walkAreaTree,
} from "../src/areaTree";
import { MAX_NESTED_ORIENTATIONS, paintSheet, type Painter } from "../src/paint";
import { renderPdf } from "../src/pdfRenderer";
import type { Area, AreaTree } from "../src/types";
import { doc, FAMILY, makeEngine } from "./helpers";

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

describe('OUT-14: 深い Area Tree をたどっても、スタックを使い切らない', () => {
  const z = { top: 0, right: 0, bottom: 0, left: 0 };
  const box = (children: Area[], over: Partial<Area> = {}): Area => ({ type: 'block', x: 1, y: 1, width: 100, height: 100, margin: z, padding: z, border: {}, writingMode: 'horizontal-tb', children, ...over }) as unknown as Area;
  const glyph = (text: string): Area => ({ type: 'glyph', x: 0, y: 0, width: 10, height: 10, margin: z, padding: z, border: {}, writingMode: 'horizontal-tb', text, fontFamily: FAMILY, fontWeight: 400, fontSize: 10, color: '#000000' }) as unknown as Area;
  const line = (text: string): Area => ({ ...box([glyph(text)]), type: 'line' }) as Area;
  const treeOf = (a: Area): AreaTree => {
    const r = { x: 0, y: 0, width: 200, height: 200 };
    const page = { type: 'page', x: 0, y: 0, width: 200, height: 200, margin: z, padding: z, border: {}, behindAreas: [], absoluteAreas: [], regionBody: { ...box([a]), type: 'region-body', x: 0, y: 0 } };
    return { schemaVersion: AREA_TREE_SCHEMA_VERSION, warnings: [], sheets: [{ type: 'sheet', x: 0, y: 0, width: 200, height: 200, trimBox: r, bleedBox: r, bleed: 0, trimMarks: false, trimMarkMargin: 0, margin: z, padding: z, border: {}, page }] } as unknown as AreaTree;
  };
  /** n 段の入れ子の箱 (いちばん内側に字) */
  const deep = (n: number, over: Partial<Area> = {}) => {
    let a = box([line('x')], over);
    for (let k = 1; k < n; k++) a = box([a], over);
    return treeOf(a);
  };
  /** 入れ子の深い JSON を、JSON.stringify を使わずに作る (JSON.stringify は処理系の中の再帰でスタックを使い切る) */
  const deepJson = (n: number) => {
    const [head, tail] = JSON.stringify(treeOf(null as unknown as Area)).split('null');
    const [open, close] = JSON.stringify(box([null as unknown as Area])).split('null');
    return head + open.repeat(n) + JSON.stringify(line('x')) + close.repeat(n) + tail;
  };

  it('walkAreas は、5 万段の入れ子を、親・深さを付けて前順にたどる', () => {
    const n = 50000;
    let count = 0;
    let maxDepth = 0;
    let ok = true;
    walkAreaTree(deep(n), (a, parent, depth) => {
      count++;
      maxDepth = Math.max(maxDepth, depth);
      if (depth > 0 && !childrenOf(parent!).includes(a as Area)) ok = false;
    });
    // sheet・page・region-body・箱 n 個・行・字
    expect(count).toBe(n + 5);
    expect(maxDepth).toBe(n + 4);
    expect(ok).toBe(true);
  });
  it('walkAreas のたどる順は、再帰でたどるのと同じ (false を返した節の子はたどらない)', () => {
    const tree = E.engine.layout(doc([{ type: 'block', children: ['一行目', { type: 'ruby', baseText: '漢字', rubyText: 'かんじ' }] }, { type: 'block', children: ['二'] }] as never));
    const skip = (a: { type: string }) => a.type === 'ruby';
    const want: string[] = [];
    const rec = (a: Parameters<typeof childrenOf>[0], parent: { type: string } | undefined, depth: number) => {
      want.push(`${depth} ${parent?.type} ${a.type} ${a.x} ${a.y}`);
      if (skip(a)) return;
      for (const c of childrenOf(a)) rec(c, a, depth + 1);
    };
    for (const s of tree.sheets) rec(s, undefined, 0);
    const got: string[] = [];
    walkAreaTree(tree, (a, parent, depth) => {
      got.push(`${depth} ${parent?.type} ${a.type} ${a.x} ${a.y}`);
      return !skip(a);
    });
    expect(got).toEqual(want);
    expect(got.length).toBeGreaterThan(8);
  });
  it('5 万段の入れ子の木を描ける (描く命令の数は、箱ごとの背景と字)', async () => {
    const n = 50000;
    const { p, log } = recorder();
    for (const s of deep(n, { backgroundColor: '#ff0000' }).sheets) paintSheet(s, p);
    expect(log.filter((l) => l.startsWith('fillRect')).length).toBe(n);
    expect(log.filter((l) => l.startsWith('drawGlyph')).length).toBe(1);
    // 字は、入れ子の分だけずれた位置に描く (箱ごとに x・y が 1。行・字は 0 でなく箱と同じ 1 と 0)
    expect(log.find((l) => l.startsWith('drawGlyph'))).toContain(`},${n + 1},${n + 1}]`);
    const pdf = await renderPdf(deep(5000, { backgroundColor: '#ff0000' }), E.fonts);
    expect(pdf.length).toBeGreaterThan(5000);
  });
  it('回り込み (float) のある箱は、背景 → 回り込み → 行内の中身の順に描く (入れ子でも同じ)', () => {
    // A [ B (背景と行), F (回り込み。中に G), C (背景と、回り込み H を持つ箱 D) ]
    const g = box([line('g')], { backgroundColor: '#00000g' });
    const f = box([g], { backgroundColor: '#00000f', float: true });
    const b = box([line('b')], { backgroundColor: '#00000b' });
    const h = box([line('h')], { backgroundColor: '#00000h', float: true });
    const d = box([line('d'), h], { backgroundColor: '#00000d' });
    const c = box([d, line('c')], { backgroundColor: '#00000c', clip: true } as Partial<Area>);
    const a = box([b, f, c], { backgroundColor: '#00000a', border: { top: { width: 1, color: '#bbbbbb' } } } as Partial<Area>);
    const { p, log } = recorder();
    for (const s of treeOf(a).sheets) paintSheet(s, p);
    const brief = log
      .map((l) => (l.startsWith('fillRect') ? `bg ${/#00000(.)/.exec(l)?.[1] ?? 'border'}` : l.startsWith('drawGlyph') ? `字 ${/"text":"(.)"/.exec(l)![1]}` : l.split(' ')[0]))
      .slice(1, -1); // 用紙の切り抜きとその終わりを除く
    expect(brief).toEqual([
      'bg a',
      // 背景の段: 流れの中の箱 B・C (と C の中の D)。D の回り込み H は、D の背景の段でまるごと描く。C の切り抜きは段ごとに始めて終える
      'bg b',
      'bg c', 'clipRect', 'bg d', 'bg h', '字 h', 'restore',
      // 回り込み F をまるごと
      'bg f', 'bg g', '字 g',
      // 中身の段: B の行、C の中 (D の行 → C の行)
      '字 b',
      'clipRect', '字 d', '字 c', 'restore',
      // A の罫線は子より後
      'bg border',
    ]);
  });
  it(`回転した箱の入れ子は ${MAX_NESTED_ORIENTATIONS} 段まで描き、それより深ければ誤りで止める (誤りの後も、次の描画は数え直す)`, async () => {
    const rot = (n: number) => deep(n, { orientation: 90 } as Partial<Area>);
    const draw = (n: number) => {
      const { p, log } = recorder();
      for (const s of rot(n).sheets) paintSheet(s, p);
      return log.filter((l) => l.startsWith('transform')).length;
    };
    expect(draw(MAX_NESTED_ORIENTATIONS)).toBe(MAX_NESTED_ORIENTATIONS);
    expect(() => draw(MAX_NESTED_ORIENTATIONS + 1)).toThrow(/回転した領域.*深すぎます/);
    expect(draw(MAX_NESTED_ORIENTATIONS)).toBe(MAX_NESTED_ORIENTATIONS);
    expect((await renderPdf(rot(MAX_NESTED_ORIENTATIONS), E.fonts)).length).toBeGreaterThan(1000);
    await expect(renderPdf(rot(MAX_NESTED_ORIENTATIONS + 1), E.fonts)).rejects.toThrow(/回転した領域.*深すぎます/);
  });
  it('外から渡した深い木 (2 万段の JSON) を読んで、描ける。JSON にできないほど深い木は、分かる誤りにする', async () => {
    const n = 20000;
    const tree = parseAreaTree(deepJson(n));
    let count = 0;
    walkAreaTree(tree, () => void count++);
    expect(count).toBe(n + 5);
    const { p, log } = recorder();
    for (const s of tree.sheets) paintSheet(s, p);
    expect(log.filter((l) => l.startsWith('drawGlyph')).length).toBe(1);
    expect((await renderPdf(tree, E.fonts)).length).toBeGreaterThan(1000);
    // 形の誤りは、深い所でも場所を付けて報告する
    expect(() => parseAreaTree(deepJson(n).replace('"type":"glyph"', '"type":"nazo"'))).toThrow(AreaTreeFormatError);
    // JSON.stringify は、処理系の中でスタックを使い切る
    expect(() => serializeAreaTree(tree)).toThrow(AreaTreeFormatError);
    expect(() => serializeAreaTree(tree)).toThrow(/深すぎ/);
    // 組版が作る深さ (千数百段) の木は、往復できる
    const t2 = deep(1500);
    expect(serializeAreaTree(parseAreaTree(serializeAreaTree(t2)))).toBe(serializeAreaTree(t2));
  });
});
