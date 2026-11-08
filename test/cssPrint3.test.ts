import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import {
  CounterStyles,
  parseCounterStyleRule,
  splitSymbols,
} from "../src/counterStyle";
import { importHtml } from "../src/htmlImport";
import { parseCss } from "../src/htmlPaged";
import { lineBreakActions } from "../src/lineBreak";
import { doc, makeEngine, walk } from "./helpers";
import {
  cascadeStyles,
  expand,
  fontFaceWeights,
  relativeWeightCss21,
} from "../src/cssCascade";
import type { Area, LTable, LTableCell } from "../src/types";

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 中身の文字 (children をたどる) */
const texts = (n: unknown): string[] => {
  if (typeof n === "string") return [n];
  if (Array.isArray(n)) return n.flatMap(texts);
  if (n && typeof n === "object")
    return (["children", "body", "rows", "cells"] as const).flatMap((k) =>
      texts((n as Record<string, unknown>)[k] ?? []),
    );
  return [];
};

function load(body: string, css: string, opts: Record<string, unknown> = {}) {
  const d = new DOMParser().parseFromString(
    `<html><head><title>t</title></head><body>${body}</body></html>`,
    "text/html",
  ) as unknown as Document;
  return importHtml(
    d,
    cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }),
    { css, ...opts },
  );
}

describe("@counter-style (CSS Counter Styles 3)", () => {
  const styles = (css: string) =>
    new CounterStyles(
      parseCss(css).counterStyles,
      (t, n) =>
        t === "decimal"
          ? String(n)
          : t === "lower-roman"
            ? ["", "i", "ii", "iii", "iv"][n]
            : undefined,
      (t) => (t === "decimal" || t === "lower-roman" ? "." : undefined),
    );

  it("記号の字句: 引用符の文字列・識別子・\\ の 16 進の逃がし (後ろの空白 1 つは逃がしの一部)", () => {
    expect(splitSymbols(String.raw`\3007  \4E00 "a b" 'c' x`)).toEqual([
      "〇",
      "一",
      "a b",
      "c",
      "x",
    ]);
    expect(
      parseCounterStyleRule([
        ["system", "fixed 3"],
        ["suffix", '"\\3001"'],
      ]),
    ).toEqual({ system: "fixed", first: 3, suffix: "、" });
  });

  it("書式ごとの表記 (§3.1.1): cyclic・fixed・symbolic・alphabetic・numeric・additive", () => {
    const s = styles(`
      @counter-style cy { system: cyclic; symbols: a b c; }
      @counter-style fx { system: fixed 2; symbols: x y; }
      @counter-style sy { system: symbolic; symbols: "*" "+"; }
      @counter-style al { system: alphabetic; symbols: a b; }
      @counter-style nu { system: numeric; symbols: "0" "1"; }
      @counter-style ad { system: additive; additive-symbols: 10 X, 5 V, 1 I; }`);
    expect([1, 2, 3, 4].map((n) => s.text("cy", n))).toEqual([
      "a",
      "b",
      "c",
      "a",
    ]);
    // fixed: 範囲の外は代わりの書式 (decimal)
    expect([1, 2, 3, 4].map((n) => s.text("fx", n))).toEqual([
      "1",
      "x",
      "y",
      "4",
    ]);
    expect([1, 2, 3, 4].map((n) => s.text("sy", n))).toEqual([
      "*",
      "+",
      "**",
      "++",
    ]);
    expect([1, 2, 3, 6].map((n) => s.text("al", n))).toEqual([
      "a",
      "b",
      "aa",
      "bb",
    ]);
    expect([0, 1, 2, 5].map((n) => s.text("nu", n))).toEqual([
      "0",
      "1",
      "10",
      "101",
    ]);
    expect([0, 4, 16, 27].map((n) => s.text("ad", n))).toEqual([
      "0",
      "IIII",
      "XVI",
      "XXVII",
    ]);
  });

  it("負の数・範囲・詰め物・代わりの書式・extends・定義の無い名前", () => {
    const s = styles(`
      @counter-style neg { system: numeric; symbols: "0" "1" "2" "3" "4" "5" "6" "7" "8" "9"; negative: "(" ")"; pad: 3 "0"; }
      @counter-style rng { system: cyclic; symbols: a; range: 1 2; fallback: lower-roman; }
      @counter-style paren { system: extends decimal; prefix: "("; suffix: ") "; }
      @counter-style decimal { system: cyclic; symbols: z; }`);
    expect([5, -5, 1234].map((n) => s.text("neg", n))).toEqual([
      "005",
      "(5)",
      "1234",
    ]);
    expect([1, 3].map((n) => s.text("rng", n))).toEqual(["a", "iii"]);
    expect(s.marker("paren", 3)).toBe("(3) ");
    // decimal は上書きできない (§2)。定義の無い名前は undefined (呼ぶ側が decimal にする)
    expect([s.text("decimal", 2), s.text("nothing", 2)]).toEqual([
      undefined,
      undefined,
    ]);
    // 名前は大文字・小文字を区別する
    expect(s.text("NEG", 5)).toBeUndefined();
  });

  it("リストの目印: 前置き + 表記 + 後置き。定義の無い名前は decimal", () => {
    const r = load(
      '<ol class="c"><li>一</li><li>二</li></ol><ol class="u"><li>x</li></ol>',
      `@counter-style my-cjk { system: numeric; range: 0 infinite; symbols: \\3007  \\4E00  \\4E8C  \\4E09; suffix: "\\3001"; }
       ol.c li { list-style-type: my-cjk; } ol.u li { list-style-type: no-such-style; }`,
    );
    const all = texts(r.document.sequences[0].flow.children)
      .filter((t) => t.trim())
      .join("|");
    expect(all).toContain("一、|一");
    expect(all).toContain("二、|二");
    expect(all).toContain("1.|x");
  });
});

describe("改行: 斜線の後ろ (UAX #14 §5.1 SY の推奨)", () => {
  const show = (s: string, md?: number) => {
    const cps = [...s].map((c) => c.codePointAt(0)!);
    const act = lineBreakActions(cps, md ? { symbolBreakMinDistance: md } : {});
    return [...s]
      .map((c, i) => (i > 0 && act[i] === "÷" ? "|" : "") + c)
      .join("");
  };
  it("次の改行の機会まで短い略記 (and/or) は分けず、長ければ分ける。指定が無ければ UAX #14 の規則どおり", () => {
    expect(show("x and/or y", 5)).toBe("x |and/or |y");
    expect(show("x path/longword", 5)).toBe("x |path/|longword");
    expect(show("x and/or y")).toBe("x |and/|or |y");
    // 控えた位置は soft に印が付く (ほかに改行できる位置が無いときに使う)
    const soft: boolean[] = [];
    lineBreakActions(
      [..."PDF/A-1a"].map((c) => c.codePointAt(0)!),
      { symbolBreakMinDistance: 5 },
      soft,
    );
    expect(soft.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([4]);
  });
});

describe("string-set・target-text の要素の文字", () => {
  it("子孫の ::before・::after を含め、content で置き換えた子孫は置き換えた文字にする。要素自身の ::before は含めない", () => {
    const r = load(
      '<p><a class="r" href="#x">x</a></p><h4 id="x">Var <span class="p">string-set</span> property <span class="l">CSS 3</span></h4>',
      `.p::before { content: "‘" } .p::after { content: "’" } .l { content: "" } h4::before { content: "19.2 " }
       a.r { content: target-text(attr(href url), content) }`,
    );
    const all = texts(r.document.sequences[0].flow.children).join("");
    expect(all).toContain("Var ‘string-set’ property");
    expect(all).not.toContain("property CSS 3Var");
  });
});

describe("表: 中身に合わせた幅の collapse の表", () => {
  const cell = (t: string): LTableCell => ({
    type: "table-cell",
    border: { width: 0.5, color: "#000000" },
    padding: 2,
    backgroundColor: "#888888",
    children: [t],
  });
  const table = (extra: Partial<LTable> = {}): LTable => ({
    type: "table",
    borderCollapse: "collapse",
    border: { width: 2, color: "#000000" },
    fitContent: true,
    columns: [],
    body: {
      type: "table-body",
      rows: [{ type: "table-row", cells: [cell("あ"), cell("い")] }],
    },
    ...extra,
  });
  const geom = (tb: LTable) => {
    const t = E.engine.layout(doc([tb]));
    let tableA: Area | undefined;
    const cells: Area[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === "table" && !tableA) tableA = a;
      if (a.type === "table-cell") cells.push(a);
    });
    return { tableA: tableA!, cells, bodyW: t.sheets[0].page.regionBody.width };
  };
  it("最後の列と外枠の罫線の間に空きを作らない (表が外枠の罫線を持つ辺は、外へ出る半分を中身の幅に足さない)", () => {
    const { tableA, cells } = geom(table());
    const last = cells[cells.length - 1];
    // セルの位置は表の中身の箱から。表の箱は外枠の罫線 2pt を両側に持ち、外へ出る半分 (1pt) だけ左へずれる
    expect(Math.abs(last.x + last.width + 2 * 2 - tableA.width)).toBeLessThan(
      0.05,
    );
    expect(tableA.x).toBeCloseTo(-1, 3);
  });
  it("左右の余白が auto (autoMargins: center) なら、置く場所の中央に寄せる (CSS 2.1 §10.3.3)", () => {
    const { tableA, bodyW } = geom(table({ autoMargins: "center" }));
    expect(
      Math.abs(tableA.x - (bodyW - (tableA.x + tableA.width))),
    ).toBeLessThan(0.05);
    const end = geom(table({ autoMargins: "start" }));
    expect(
      Math.abs(end.tableA.x + end.tableA.width - (end.bodyW + 1)),
    ).toBeLessThan(0.05);
  });
});

describe("font-variant の一括指定・bolder / lighter (CSS 2.1 §15.6)", () => {
  it("font-variant: small-caps は font-variant-caps に (Fonts 4 §6.11)", () => {
    expect(expand("font-variant", "small-caps")).toContainEqual([
      "font-variant-caps",
      "small-caps",
    ]);
    expect(expand("font-variant", "normal")).toContainEqual([
      "font-variant-caps",
      "normal",
    ]);
  });
  it("bolder は、@font-face で定義した太さのうち親より太い次の太さ。無ければ次の数の太さ", () => {
    const w = fontFaceWeights(
      '@font-face { font-family: "A"; src: url(a.otf) } @font-face { font-family: A; font-weight: 600; src: url(b.otf) } @font-face { font-family: A; font-weight: bold; src: url(c.otf) }',
    );
    expect(w.get("a")).toEqual(expect.arrayContaining([400, 600, 700]));
    expect(relativeWeightCss21(w.get("a")!, 400, "bolder")).toBe(600);
    expect(relativeWeightCss21(w.get("a")!, 700, "bolder")).toBe(800);
    expect(relativeWeightCss21(w.get("a")!, 700, "lighter")).toBe(600);
  });
});

describe("縦書きの float (CSS Page Floats 3 §3.2)", () => {
  const floats = (html: string) => {
    const out: Array<{ float: string; cssPlacement?: boolean }> = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const o = n as {
        type?: string;
        float?: string;
        cssPlacement?: boolean;
        children?: unknown;
      };
      if (o.type === "float")
        out.push({
          float: o.float!,
          ...(o.cssPlacement ? { cssPlacement: true } : {}),
        });
      walk(o.children);
    };
    walk(
      load(html, "div.v { writing-mode: vertical-rl; height: 8em }").document
        .sequences[0].flow.children,
    );
    return out;
  };
  it("縦書きの top・bottom は行頭・行末に寄せる行内の float、before・after は段の先頭・末尾", () => {
    expect(
      floats(
        '<div class="v"><p>あ</p><div style="float: top">t</div><div style="float: bottom">b</div><div style="float: before">x</div><div style="float: after">y</div></div>',
      ),
    ).toEqual([
      { float: "start", cssPlacement: true },
      { float: "end", cssPlacement: true },
      { float: "before" },
      { float: "after" },
    ]);
    // 横書きの top・bottom は、これまでどおり段の先頭・末尾
    expect(
      floats('<div><p>a</p><div style="float: top">t</div></div>'),
    ).toEqual([{ float: "before" }]);
  });
  it("縦書きの箱の中の before・after は、箱の内容の先頭・末尾の端に置く (後に書いた after ほど端に寄せる)", () => {
    const box = (s: string, side: "before" | "after") => ({
      type: "float",
      float: side,
      border: { width: 1, color: "#000000" },
      children: [{ type: "block", children: [s] }],
    });
    const tb = {
      type: "block",
      writingMode: "vertical-rl",
      height: 100,
      border: { width: 2, color: "#008000" },
      children: [
        { type: "block", children: ["あいう"] },
        box("前", "before"),
        box("後1", "after"),
        box("後2", "after"),
        { type: "block", children: ["えお"] },
      ],
    };
    const t = E.engine.layout(doc([tb] as never));
    const xs: Record<string, number> = {};
    let boxX: [number, number] | undefined;
    // 字の位置は親の箱からの位置なので、たどりながら足す
    const rec = (a: Record<string, unknown>, ox: number) => {
      const x = ox + ((a.x as number) ?? 0);
      const text = a.text as string | undefined;
      if (a.type === "glyph" && text && !(text in xs)) xs[text] = x;
      if (
        !boxX &&
        (a.border as { left?: { color: string } } | undefined)?.left?.color ===
          "#008000"
      )
        boxX = [x, x + (a.width as number)];
      for (const c of [
        ...((a.children as Record<string, unknown>[]) ?? []),
        ...((a.glyphs as Record<string, unknown>[]) ?? []),
      ])
        rec(c, x);
    };
    rec(t.sheets[0].page.regionBody as unknown as Record<string, unknown>, 0);
    expect(boxX).toBeDefined();
    // 前 (before) は本文 (あ) より右、後2 (後に書いた after) は後1 より左
    expect(xs["前"]).toBeGreaterThan(xs["あ"]);
    expect(xs["あ"]).toBeGreaterThan(xs["え"]);
    expect(xs["え"]).toBeGreaterThan(xs["後"]);
    expect(xs["1"]).toBeGreaterThan(xs["2"]);
    // 後2 は箱の左の枠のすぐ内側 (箱の外へ出ない)
    expect(xs["2"]).toBeGreaterThan(boxX![0]);
  });
});

describe("vertical-align: bottom・top の画像 (CSS 2.1 §10.8.1)", () => {
  it("top は行の箱の上端、text-top は字面の上端に揃える (行に背の高い画像があると違う)", () => {
    const img = (h: number, va?: string): unknown => ({
      type: "image",
      src: "x.png",
      width: 10,
      height: h,
      ...(va ? { alignmentBaseline: va } : {}),
    });
    const bottomOf = (va: string) => {
      const t = E.engine.layout(
        doc([
          { type: "block", children: ["あ", img(60), img(10, va)] },
        ] as never),
      );
      const imgs: Array<{ y: number; h: number }> = [];
      const rec = (a: Record<string, unknown>, oy: number) => {
        const y = oy + ((a.y as number) ?? 0);
        if (a.type === "image") imgs.push({ y, h: a.height as number });
        for (const c of (a.children as Record<string, unknown>[]) ?? [])
          rec(c, y);
      };
      rec(t.sheets[0].page.regionBody as unknown as Record<string, unknown>, 0);
      return imgs.map((i) => i.y);
    };
    const [tallT, lineT] = bottomOf("line-top");
    const [, textT] = bottomOf("before-edge");
    // 行の上端に揃えた画像の上端は、背の高い画像の上端 (行の上端) と同じか上。字面に揃えたものより上
    expect(lineT).toBeLessThanOrEqual(tallT + 0.01);
    expect(lineT).toBeLessThan(textT - 10);
  });
});

describe("float: multicol top (アンテナハウスの拡張)", () => {
  it("段組の箱の先頭へ、段をまたぐブロックとして移し、gr の幅を段の幅から決める", () => {
    const r = load(
      '<div class="m"><p>a</p><div style="float: multicol top; width: 1gr; box-sizing: border-box">F</div><p>b</p></div>',
      "div.m { column-count: 3; column-gap: 10pt; width: 320pt }",
    );
    type B = {
      type: string;
      columns?: unknown;
      span?: string;
      width?: number;
      children: B[];
    };
    const find = (n: B[]): B | undefined =>
      n
        .map((c) =>
          c && typeof c === "object"
            ? c.columns
              ? c
              : find(c.children ?? [])
            : undefined,
        )
        .find(Boolean);
    const box = find(r.document.sequences[0].flow.children as unknown as B[])!;
    expect(box.type).toBe("block-container");
    expect(box.children[0]).toMatchObject({ type: "block", span: "all" });
    // 1gr = 段の幅 ((320pt − 段の間 2 つ) / 3)
    expect(box.children[0].width).toBeCloseTo(100, 1);
  });
});

describe("コードレビューの修正", () => {
  /** 字の位置 (ページの中の x・y。親の箱からの位置を足す) */
  const glyphPos = (root: unknown) => {
    const out: Array<{ text: string; x: number; y: number }> = [];
    const rec = (a: Record<string, unknown>, ox: number, oy: number) => {
      const x = ox + ((a.x as number) ?? 0);
      const y = oy + ((a.y as number) ?? 0);
      if (a.type === "glyph" && a.text)
        out.push({ text: a.text as string, x, y });
      for (const c of [
        ...((a.children as Record<string, unknown>[]) ?? []),
        ...((a.glyphs as Record<string, unknown>[]) ?? []),
      ])
        rec(c, x, y);
    };
    rec(root as Record<string, unknown>, 0, 0);
    return out;
  };

  it("縦書きの高さのある箱の after の float の場所を、後から置く本文が避ける", () => {
    const tb = {
      type: "block",
      writingMode: "vertical-rl",
      width: 150,
      height: 60,
      children: [
        { type: "block", children: ["本"] },
        {
          type: "float",
          float: "after",
          children: [{ type: "block", children: ["後"] }],
        },
        ...Array.from({ length: 9 }, () => ({
          type: "block",
          children: ["本"],
        })),
      ],
    };
    const t = E.engine.layout(doc([tb] as never));
    const g = glyphPos(t.sheets[0].page.regionBody);
    const after = g.find((x) => x.text === "後")!;
    const body = g.filter((x) => x.text === "本");
    expect(body).toHaveLength(10);
    // 本文の行は、after の float の行と重ならない (字の大きさの分より離れる)
    for (const b of body) expect(Math.abs(b.x - after.x)).toBeGreaterThan(5);
  });

  it('定義済みの書式を extends した書式: 後置きは ". "・" "。負の数・詰め物も当てる', () => {
    const r = load(
      '<ol class="a" style="list-style-position: inside"><li>x</li></ol><ol class="b" style="list-style-position: inside"><li>y</li></ol><ol class="a" start="-2" style="list-style-position: inside"><li>z</li></ol>',
      `@counter-style p3 { system: extends decimal; pad: 3 "0"; negative: "(" ")"; }
       @counter-style d2 { system: extends disc; }
       ol.a li { list-style-type: p3 } ol.b li { list-style-type: d2 }`,
    );
    const all = texts(r.document.sequences[0].flow.children).join("|");
    expect(all).toContain("001. ");
    expect(all).toContain("• ");
    expect(all).toContain("(2). ");
  });

  it("target-text() の子孫の ::before の counter() は、組んだときの値", () => {
    const r = load(
      '<p id="x">A<span class="c"></span>B<span class="c"></span>C</p><p><span class="c"></span><a class="r" href="#x">r</a></p>',
      `body { counter-reset: n } span.c::before { counter-increment: n; content: "[" counter(n) "]" }
       a.r::after { content: " / " target-text(attr(href url)) }`,
    );
    const all = texts(r.document.sequences[0].flow.children).join("");
    expect(all).toContain("/ A[1]B[2]C");
  });

  it("高さのある段組の箱でも、column-span: all の要素は箱の幅いっぱいに置く", () => {
    const words = (w: string) => Array(30).fill(w).join(" ");
    const box = {
      type: "block-container",
      height: 300,
      columns: { count: 2, gap: 10 },
      children: [
        { type: "block", children: [words("one")] },
        { type: "block", span: "all", children: ["SPAN"] },
        { type: "block", children: [words("two")] },
      ],
    };
    const t = E.engine.layout(doc([box] as never));
    const g = glyphPos(t.sheets[0].page.regionBody);
    const yOf = (s: string) => g.filter((x) => x.text === s).map((x) => x.y);
    const span = Math.min(...yOf("S"));
    // 段に組んだ one はすべて SPAN の前、two はすべて後ろ。two は 2 段に分かれる
    expect(Math.max(...yOf("n"))).toBeLessThan(span);
    expect(Math.min(...yOf("w"))).toBeGreaterThan(span);
    // SPAN の前の one は、釣り合わせて 2 段に分ける
    const xs = g.filter((x) => x.text === "n").map((x) => x.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });

  it("@font-face の太さは、注釈・@media の中の規則も読む", () => {
    const w = fontFaceWeights(
      '/* @font-face { font-family: A; font-weight: 300; src: url(x) } */ @media print { @font-face { font-family: "A"; font-weight: 600; src: url(b.otf) } } @font-face { font-family: A; src: url(a.otf) }',
    );
    expect([...(w.get("a") ?? [])].sort()).toEqual([400, 600]);
  });
});

describe("ページをまたぐ段組と行グリッド (-ah-baseline-grid)", () => {
  it("ページに収まる段組でも、段組の箱の行グリッドは段の中に効き、どの段の行も同じグリッドに載る (見出しのある段も)", () => {
    const css = `@page { size: A5; margin: 20mm } div.B { column-count: 2; column-gap: 5mm; -ah-baseline-grid: new; font-size: 9pt; line-height: 13pt } h4 { font-size: 14pt; margin: 0 0 4pt }`;
    const text = Array.from({ length: 8 }, (_, k) => `<p>Paragraph ${k} with some words to fill the line.</p>`).join("");
    const r = load(`<div class="B"><h4>Heading</h4>${text}</div>`, css);
    const t = E.engine.layout(r.document);
    const firstBase = (n: Area, oy: number): number | undefined => {
      if (n.type === "glyph") return oy + n.y + (n as unknown as { baselineY: number }).baselineY;
      for (const c of (n as { children?: Area[] }).children ?? []) {
        const v = firstBase(c, oy + n.y);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const pts: Array<[number, number, number]> = [];
    const collect = (a: Area, ox: number, oy: number) => {
      if (a.type === "line") {
        const b = firstBase(a, oy);
        const g: number[] = [];
        walk(a, (x) => x.type === "glyph" && g.push((x as unknown as { fontSize: number }).fontSize));
        if (b !== undefined) pts.push([ox + a.x, b, Math.max(...g)]);
        return;
      }
      for (const c of (a as { children?: Area[] }).children ?? [])
        collect(c, ox + a.x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), oy + a.y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
    };
    for (const c of (t.sheets[0].page.regionBody as unknown as { children: Area[] }).children) collect(c, 0, 0);
    // 本文 (9pt) の行だけを見る。2 つの段の行のベースラインが、同じ 13pt おきのグリッドに載る
    const body = pts.filter(([, , fs]) => fs < 10);
    expect(new Set(body.map(([x]) => Math.round(x / 50))).size).toBe(2);
    const first = Math.min(...body.map(([, y]) => y));
    for (const [, y] of body) {
      const q = (y - first) / 13;
      expect(Math.abs(q - Math.round(q))).toBeLessThan(0.01);
    }
  });

  it("行グリッドの段組の箱は、最後の行の下の半行間を高さに入れない", () => {
    // 箱の内容の下端から、最後の行のベースラインまで
    const gap = (grid: boolean) => {
      const css = `@page { size: A5; margin: 20mm } div.B { column-count: 2; column-gap: 5mm; ${grid ? "-ah-baseline-grid: new;" : ""} font-size: 9pt; line-height: 13pt; border: 0.3pt solid gray } p { margin: 0 }`;
      const r = load(`<div class="B"><p>One two three.</p><p>Four five six.</p></div>`, css);
      const t = E.engine.layout(r.document);
      const box = (t.sheets[0].page.regionBody as unknown as { children: Area[] }).children[0];
      let last = -1;
      const go = (a: Area, oy: number) => {
        if (a.type === "glyph") last = Math.max(last, oy + (a as unknown as { baselineY: number }).baselineY);
        for (const c of (a as { children?: Area[] }).children ?? []) go(c, oy + c.y);
      };
      go(box, 0);
      return box.height - (box.border?.bottom?.width ?? 0) - last;
    };
    // 行グリッドの中では、最後の行の下の半行間 ((13 − 9) / 2 = 2pt) が無い
    expect(gap(false) - gap(true)).toBeGreaterThan(1.5);
  });

  it("段組の箱の行グリッドは、段の中にも効く (リストの間の余白の後の行のベースラインもグリッドの位置)", () => {
    const li = (k: number) => `<li>item ${k}</li>`;
    const ul = (k: number) => `<ul class="I">${[0, 1, 2, 3, 4].map((j) => li(k * 5 + j)).join("")}</ul>`;
    const css = `@page { size: A5; margin: 20mm } div.B { column-count: 2; column-gap: 5mm; -ah-baseline-grid: new; font-size: 9pt; line-height: 11pt } ul.I { list-style: none; margin: .5em 1em 2em; padding: 0 }`;
    const r = load(`<div class="B">${Array.from({ length: 16 }, (_, k) => ul(k)).join("")}</div>`, css);
    const t = E.engine.layout(r.document);
    expect(t.sheets.length).toBeGreaterThan(1);
    // 行ごとに、最初の字のベースラインの位置と横位置 (親の箱の位置・罫線・padding を足していく)
    const firstBase = (n: Area, oy: number): number | undefined => {
      if (n.type === "glyph") return oy + n.y + (n as unknown as { baselineY: number }).baselineY;
      for (const c of (n as { children?: Area[] }).children ?? []) {
        const v = firstBase(c, oy + n.y);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const collect = (a: Area, ox: number, oy: number, out: Array<[number, number]>) => {
      if (a.type === "line") {
        const b = firstBase(a, oy);
        if (b !== undefined) out.push([ox + a.x, b]);
        return;
      }
      for (const c of (a as { children?: Area[] }).children ?? [])
        collect(c, ox + a.x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), oy + a.y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0), out);
    };
    for (const sh of t.sheets.slice(0, -1)) {
      const pts: Array<[number, number]> = [];
      for (const c of (sh.page.regionBody as unknown as { children: Area[] }).children) collect(c, 0, 0, pts);
      expect(pts.length).toBeGreaterThan(5);
      // 段ごと (横位置ごと) に、どの行のベースラインも、その段の最初の行のベースラインから行の送り (11pt) の倍数
      // (リストの間の余白 (2em) の後の行も、グリッドの位置に下がる)
      const cols = new Map<number, number[]>();
      for (const [x, y] of pts) cols.set(Math.round(x / 50), [...(cols.get(Math.round(x / 50)) ?? []), y]);
      expect(cols.size).toBe(2);
      for (const ys of cols.values()) {
        const first = Math.min(...ys);
        for (const y of ys) {
          const q = (y - first) / 11;
          expect(Math.abs(q - Math.round(q))).toBeLessThan(0.01);
        }
      }
    }
  });
});
