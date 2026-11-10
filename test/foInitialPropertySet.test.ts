/**
 * fo:initial-property-set (XSL 1.1 §6.6.4): fo:block の最初の行にだけ書式を当てる。
 * 最初の行に入った子を、その書式の fo:inline で包んだものとして組む (Trait Derivation)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
// 本文の幅 60mm ≒ 170pt。10pt の字で 1 行 17 字
const page = (body: string, seq = '') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="80mm" page-height="80mm" margin="10mm"><fo:region-body/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m" ${seq}><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="14pt" text-align="start">${body}</fo:flow></fo:page-sequence></fo:root>`;

interface Line { y: number; h: number; glyphs: GlyphArea[] }
const linesOf = (fo: string) => {
  const im = importXslFo(fo, parse, { compat: 'spec' });
  const t = E.engine.layout(im.document);
  const out: Line[] = [];
  const rec = (a: Area, y: number, line?: Line) => {
    let cur = line;
    if (a.type === 'line') {
      cur = { y: y + a.y, h: a.height, glyphs: [] };
      out.push(cur);
    }
    if (a.type === 'glyph' && cur) cur.glyphs.push(a as GlyphArea);
    for (const c of childrenOf(a as never)) rec(c, y + a.y, cur);
  };
  rec(t.sheets[0] as unknown as Area, 0);
  return { lines: out, im };
};
const TEXT = 'あ'.repeat(40);
/** 太字 (テストの書体は 400 だけなので、疑似太字になる) */
const bold = (g: GlyphArea) => g.fontWeight >= 700 || !!g.fakeBold;

describe('fo:initial-property-set', () => {
  it('色・太さ・字の大きさは、最初の行の字にだけ当たる', () => {
    const { lines } = linesOf(page(`<fo:block><fo:initial-property-set color="#ff0000" font-weight="bold" font-size="12pt"/>${TEXT}</fo:block>`));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const g of lines[0].glyphs) {
      expect(g.color.toLowerCase()).toBe('#ff0000');
      expect(g.fontSize).toBe(12);
      expect(bold(g)).toBe(true);
    }
    for (const l of lines.slice(1))
      for (const g of l.glyphs) {
        expect(g.color.toLowerCase()).toBe('#000000');
        expect(g.fontSize).toBe(10);
        expect(bold(g)).toBe(false);
      }
    // 最初の行は 12pt の字で組む (170pt ÷ 12pt = 14 字)。残りは 10pt で 17 字ずつ
    expect(lines[0].glyphs.length).toBe(14);
    expect(lines[1].glyphs.length).toBe(17);
  });

  it('em の長さは、ブロックの字の大きさを基準にした最初の行の字の大きさで決まる', () => {
    const { lines } = linesOf(page(`<fo:block><fo:initial-property-set font-size="1.5em"/>${TEXT}</fo:block>`));
    expect(lines[0].glyphs[0].fontSize).toBe(15);
    expect(lines[1].glyphs[0].fontSize).toBe(10);
  });

  it('子の fo:inline が行をまたぐとき、最初の行に入った部分にだけ当たる。子が自分で指定した値はそのまま', () => {
    const { lines } = linesOf(page(`<fo:block><fo:initial-property-set color="#ff0000"/>い<fo:inline font-weight="bold">${TEXT}</fo:inline><fo:inline color="#00ff00">う</fo:inline></fo:block>`));
    expect(lines[0].glyphs.every((g) => g.color.toLowerCase() === '#ff0000')).toBe(true);
    expect(bold(lines[0].glyphs[1])).toBe(true);
    expect(lines[1].glyphs.every((g) => g.color.toLowerCase() === '#000000' && bold(g))).toBe(true);
    const last = lines[lines.length - 1].glyphs;
    expect(last[last.length - 1].color.toLowerCase()).toBe('#00ff00');
  });

  it('letter-spacing は最初の行の字の送りにだけ足される', () => {
    const { lines } = linesOf(page(`<fo:block><fo:initial-property-set letter-spacing="2pt"/>${TEXT}</fo:block>`));
    expect(lines[0].glyphs[1].x - lines[0].glyphs[0].x).toBeCloseTo(12, 1);
    expect(lines[1].glyphs[1].x - lines[1].glyphs[0].x).toBeCloseTo(10, 1);
  });

  it('text-decoration・background-color', () => {
    const { im } = linesOf(page(`<fo:block><fo:initial-property-set text-decoration="underline" background-color="#ffff00"/>${TEXT}</fo:block>`));
    const blk = (im.document.sequences[0].flow.children[0] as unknown as { children: Array<Record<string, unknown>> }).children[0];
    expect(blk.firstLine).toBe(true);
    expect(blk.backgroundColor).toBe('#ffff00');
    expect(JSON.stringify(blk.textDecoration ?? blk.underline ?? blk)).toContain('underline');
    expect(Object.keys(im.report.unsupported)).toEqual([]);
    // 背景と下線は、最初の行の中にだけある
    const t = E.engine.layout(im.document);
    const hits: Array<{ kind: string; line: number }> = [];
    let line = -1;
    const rec = (a: Area) => {
      if (a.type === 'line') line++;
      if (a.backgroundColor?.toLowerCase() === '#ffff00') hits.push({ kind: 'bg', line });
      // 下線は、行の中の細い箱 (字の色の背景) として描く
      if (a.type !== 'glyph' && a.type !== 'line' && line >= 0 && a.height > 0 && a.height < 1.5 && a.backgroundColor) hits.push({ kind: 'ul', line });
      for (const c of childrenOf(a as never)) rec(c);
    };
    rec(t.sheets[0] as unknown as Area);
    expect(hits.some((h) => h.kind === 'bg')).toBe(true);
    expect(hits.some((h) => h.kind === 'ul')).toBe(true);
    expect(hits.every((h) => h.line === 0)).toBe(true);
  });

  it('最初の fo:marker の後ろに置ける。ブロックの子のブロックより後ろの行には当てない', () => {
    const { lines } = linesOf(page(`<fo:block><fo:marker marker-class-name="m">M</fo:marker><fo:initial-property-set color="#ff0000"/>一行め<fo:block>子のブロック</fo:block>後ろ</fo:block>`));
    expect(lines.map((l) => l.glyphs[0].color.toLowerCase())).toEqual(['#ff0000', '#000000', '#000000']);
  });

  it('縦書きでも最初の行にだけ当たる', () => {
    const { lines } = linesOf(page(`<fo:block><fo:initial-property-set color="#ff0000"/>${TEXT}</fo:block>`, 'writing-mode="tb-rl"'));
    expect(lines[0].glyphs.every((g) => g.color.toLowerCase() === '#ff0000')).toBe(true);
    expect(lines[1].glyphs.every((g) => g.color.toLowerCase() === '#000000')).toBe(true);
  });

  it('最初の行だけに当てられない性質 (text-transform・font-variant・line-height・相対位置・罫線と余白) は、読まずに報告する', () => {
    const { lines, im } = linesOf(page(`<fo:block><fo:initial-property-set text-transform="uppercase" font-variant="small-caps" relative-position="relative" border="1pt solid black" padding="2pt" line-height="28pt" color="#ff0000"/>abc ${TEXT}</fo:block>`));
    expect(lines[0].glyphs[0].text).toBe('a');
    expect(lines[0].glyphs[0].color.toLowerCase()).toBe('#ff0000');
    const keys = Object.keys(im.report.unsupported).join(' ');
    for (const k of ['text-transform', 'font-variant', 'relative-position', 'border', 'padding', 'line-height']) expect(keys).toContain(k);
    // 行の高さは変わらない
    expect(lines[1].y - lines[0].y).toBeCloseTo(14, 1);
  });

  it('fo:block の子でないものは、読まずに報告する。fo:initial-property-set の無いブロックは、いままでどおり', () => {
    const { im } = linesOf(page(`<fo:block><fo:inline><fo:initial-property-set color="#ff0000"/>字</fo:inline></fo:block>`));
    expect(Object.keys(im.report.unsupported).join(' ')).toContain('initial-property-set');
    const plain = linesOf(page(`<fo:block>${TEXT}</fo:block>`));
    expect(JSON.stringify(plain.im.document)).not.toContain('firstLine');
  });
});
