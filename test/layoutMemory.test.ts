/**
 * 大きな文書を組むときのメモリ: 字ごとに作るものを小さく保つ、組み直しの回の結果を持ち続けない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
const layout = (s: string) => E.engine.layout(importXslFo(s, parse, { compat: 'spec' }).document);
const glyphs = (t: ReturnType<typeof layout>) => {
  const out: GlyphArea[] = [];
  for (const s of t.sheets) walk(s as unknown as Area, (a) => a.type === 'glyph' && out.push(a as GlyphArea));
  return out;
};

describe('組版のメモリ', () => {
  it('格子に合わせたリーダーの点 (leader-alignment) は、点ごとに余白・罫線の Object を写さない (字の節の共有の値のまま)', () => {
    // DocBook の XSL の目次の行と同じ書き方
    const t = layout(fo('<fo:block text-align-last="justify">Chapter<fo:leader leader-pattern="dots" leader-pattern-width="3pt" leader-alignment="reference-area"/>12</fo:block>'));
    const dots = glyphs(t).filter((g) => g.text === '.');
    expect(dots.length).toBeGreaterThan(20);
    for (const k of ['margin', 'padding', 'border'] as const) {
      expect(new Set(dots.map((d) => d[k])).size).toBe(1);
      expect(Object.isFrozen(dots[0][k])).toBe(true);
    }
  });

  it('飾りの無い字の領域は、値の無い欄を持たない (JSON に書いたものは、欄の有る作り方と同じ)', () => {
    const t = layout(fo('<fo:block>Plain <fo:inline font-style="italic" background-color="yellow">styled</fo:inline></fo:block>'));
    const gs = glyphs(t);
    const plain = gs.find((g) => g.text === 'P')!;
    expect('backgroundColor' in plain).toBe(false);
    expect('sourceId' in plain).toBe(false);
    expect(plain.fontId).toBeTruthy();
    expect(plain.glyphIds?.length).toBe(1);
    // 飾りのある字は、これまでどおりの作り方 (斜体の印を持つ)
    expect(gs.find((g) => g.text === 's')!.italic).toBe(true);
    // JSON に書いたときの欄の並びは、これまでと同じ (値の無い欄は、どちらの作り方でも書かれない)
    expect(Object.keys(JSON.parse(JSON.stringify(plain)))).toEqual(['x', 'y', 'width', 'height', 'margin', 'padding', 'border', 'writingMode', ...(plain.sourceRef !== undefined ? ['sourceRef'] : []), 'type', 'text', 'fontFamily', 'fontWeight', 'fontSize', 'color', 'baselineX', 'baselineY', 'rotation', 'scaleX', 'advance', 'fontId', 'glyphIds']);
  });

  it('ページ番号の参照で組み直しても、ページの番号と参照の値は前と同じ (領域の木は収束した回だけ作る)', () => {
    // 後ろのページを指す参照: 1 回目は、まだ置いていない参照先を、いまのページの番号 (2) を仮の値にして組む。2 回目は、本当の値 (5) が
    // 仮の値と桁数・字の幅が同じなので (テストの書体の「2」と「5」は同じ幅)、組み直さずに、前の回のページの字だけ差し替える
    const page = (s: string) => `<fo:block break-before="page">${s}</fo:block>`;
    const body = `<fo:block>First</fo:block>${page('See page <fo:page-number-citation ref-id="end"/>.')}<fo:block>Line 2</fo:block>${page('Three')}${page('Four')}${page('<fo:inline id="end">End</fo:inline> 2')}`;
    const t = layout(fo(body));
    expect(t.sheets.length).toBe(5);
    const text = (s: (typeof t.sheets)[number]) => {
      let out = '';
      walk(s as unknown as Area, (a) => {
        if (a.type === 'glyph') out += (a as GlyphArea).text;
      });
      return out;
    };
    expect(text(t.sheets[1])).toBe('See page 5.Line 2');
    // 字の描き方は、同じ中身の字で共有している。参照の字 (仮の値の「2」) を差し替えても、本文の同じ「2」は変わらない
    expect(text(t.sheets[4])).toBe('End 2');
    expect(t.destinations?.end).toBe(t.sheets.length - 1);
  });
});

/** 既定の組み方 (組み直しの回で、前の回のページを使い回す) と、メモリ節約の組み方 (使い回さない) の、全ページの領域の木 */
const bothWays = (src: string) => {
  const doc = () => importXslFo(src, parse, { compat: 'spec' }).document;
  const t = E.engine.layout(doc());
  const lm = E.engine.layoutLowMemory(doc());
  lm.scan(
    () => {},
    () => {},
  );
  const low: unknown[] = [];
  lm.paint((s) => low.push(s));
  lm.finish();
  const text = (s: unknown) => {
    let out = '';
    walk(s as Area, (a) => {
      if (a.type === 'glyph') out += (a as GlyphArea).text;
    });
    return out;
  };
  return { reused: t.sheets.map((s) => JSON.stringify(s)), fresh: low.map((s) => JSON.stringify(s)), reusedText: t.sheets.map(text), freshText: low.map(text) };
};
/** 何枚かの page-sequence の FO (seqs の各要素が、1 つの page-sequence の flow の中身) */
const foSeqs = (seqs: string[], attrs = '') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="en"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  seqs.map((b) => `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt"${attrs}>${b}</fo:flow></fo:page-sequence>`).join('') +
  '</fo:root>';
const pages = (n: number, f: (k: number) => string) => Array.from({ length: n }, (_, k) => `<fo:block${k ? ' break-before="page"' : ''}>${f(k)}</fo:block>`).join('');

describe('ページ番号の参照の字の差し替え (組み直しの回で、前の回のページを使い回すとき)', () => {
  it('1 回目の仮の値が、ページごとに違う値・違う桁数で混じる sequence: 使い回さずに組んだときと、全ページの領域の木が同じ', () => {
    // 2〜12 ページの sequence が、15 ページの参照先を指す。1 回目は、まだ置いていない参照先の仮の値を、引いたページの番号にする
    // (2〜9 は 1 桁、10〜12 は 2 桁)。2 回目の値「15」と桁数の違う仮の値があるので、字だけを差し替えてはならない
    // (テストの書体では「2」と「5」が同じ幅なので、最後に引いた仮の値「12」だけを見ると、差し替えられるように見える)
    const src = foSeqs(['Front', pages(11, (k) => `Page ${k + 2} see p.<fo:page-number-citation ref-id="c2"/>`), pages(2, () => 'Pad'), '<fo:block id="c2">Chapter 2</fo:block>']);
    const r = bothWays(src);
    expect(r.freshText.length).toBe(15);
    expect(r.freshText[1]).toBe('Page 2 see p.15');
    expect(r.reusedText).toEqual(r.freshText);
    expect(r.reused).toEqual(r.fresh);
  });

  it('同じ桁数の違う仮の値 (15・16 → 18) は字だけを差し替え、同じページを指す参照が 1 行に複数あっても、書式が違っても、使い回さずに組んだときと同じ', () => {
    // テストの書体では「5」「6」「8」が同じ幅
    const src = foSeqs([
      pages(14, (k) => `Front ${k + 1}`),
      pages(2, (k) => `Page ${k + 15} see <fo:page-number-citation ref-id="c3"/> and <fo:page-number-citation ref-id="c3"/>, <fo:inline font-size="14pt" letter-spacing="2pt" color="red"><fo:page-number-citation ref-id="c3"/></fo:inline>`),
      'Pad',
      '<fo:block id="c3">Chapter 3</fo:block>',
    ]);
    const r = bothWays(src);
    expect(r.freshText[14]).toBe('Page 15 see 18 and 18, 18');
    expect(r.reusedText).toEqual(r.freshText);
    expect(r.reused).toEqual(r.fresh);
  });

  it('目次 (リーダー・両端揃え・ローマ数字と漢数字の書式) の参照の値の桁数が変わる文書: 使い回さずに組んだときと同じ', () => {
    const chapters = Array.from({ length: 12 }, (_, k) => pages(k % 3 === 0 ? 2 : 1, (j) => (j ? `More ${k + 1}` : `<fo:inline id="ch${k + 1}">Chapter ${k + 1}</fo:inline>`)));
    const toc = Array.from(
      { length: 12 },
      (_, k) =>
        `<fo:block text-align-last="justify">Chapter ${k + 1}<fo:leader leader-pattern="dots"/><fo:page-number-citation ref-id="ch${k + 1}"/> ` +
        `<fo:page-number-citation ref-id="ch${k + 1}" axf:format="i" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"/></fo:block>`,
    ).join('');
    const src = foSeqs([toc, ...chapters]);
    const r = bothWays(src);
    expect(r.reusedText).toEqual(r.freshText);
    expect(r.reused).toEqual(r.fresh);
  });
});
