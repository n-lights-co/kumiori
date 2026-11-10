/**
 * fo:retrieve-table-marker (XSL 1.1 §6.13.7、retrieve-position-within-table §7.25.6、retrieve-boundary-within-table §7.25.2):
 * 表の header・footer の中で、その表の断片 (ページ・段) の中の fo:marker を取り出す
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import { childrenOf } from '../src/areaTree';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const page = (body: string, attrs = '', region = '') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="80mm" page-height="60mm" margin="5mm"><fo:region-body ${region}/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="14pt" ${attrs}>${body}</fo:flow></fo:page-sequence></fo:root>`;
const rtm = (cls: string, pos?: string, bd?: string) => `<fo:retrieve-table-marker retrieve-class-name="${cls}"${pos ? ` retrieve-position-within-table="${pos}"` : ''}${bd ? ` retrieve-boundary-within-table="${bd}"` : ''}/>`;
const cell = (s: string) => `<fo:table-cell>${s}</fo:table-cell>`;
/** 行: 1 列めのセルにマーカー (mk) と字 */
const row = (text: string, mk = '', attrs = '') => `<fo:table-row ${attrs}>${cell(`${mk}<fo:block>${text}</fo:block>`)}</fo:table-row>`;
const marker = (cls: string, s: string) => `<fo:marker marker-class-name="${cls}">${s}</fo:marker>`;
const table = (header: string, footer: string, rows: string, attrs = '') =>
  `<fo:table table-layout="fixed" width="100%" ${attrs}><fo:table-column column-width="100%"/>` +
  (header ? `<fo:table-header><fo:table-row>${cell(`<fo:block>${header}</fo:block>`)}</fo:table-row></fo:table-header>` : '') +
  (footer ? `<fo:table-footer><fo:table-row>${cell(`<fo:block>${footer}</fo:block>`)}</fo:table-row></fo:table-footer>` : '') +
  `<fo:table-body>${rows}</fo:table-body></fo:table>`;

const layout = (fo: string) => {
  const im = importXslFo(fo, parse, { compat: 'spec' });
  return { im, t: E.engine.layout(im.document) };
};
/** ページごとの字 (Area Tree の順。見出し・本体・フッターの順に置かれる) */
const texts = (fo: string) =>
  layout(fo).t.sheets.map((sh) => {
    let s = '';
    walk(sh as unknown as Area, (a) => {
      if (a.type === 'glyph') s += (a as GlyphArea).text;
    });
    return s;
  });

// 本文の高さは 50mm ≒ 141.7pt。行は 14pt。見出し 1 行 + フッター 1 行 + 本体 8 行で 1 ページ
const rows = (n: number, mk: (k: number) => string) => Array.from({ length: n }, (_, k) => row(`r${k + 1};`, mk(k + 1))).join('');

describe('fo:retrieve-table-marker', () => {
  it('フッターの last-ending は、その断片までの最後の行のマーカー (小計)。見出しの first-starting は、その断片の最初の行のマーカー (繰越)', () => {
    const ps = texts(page(table(`H[${rtm('carry')}]`, `F[${rtm('sub', 'last-ending')}]`, rows(20, (k) => marker('carry', `c${k - 1}`) + marker('sub', `s${k}`)))));
    expect(ps.length).toBe(3);
    expect(ps[0]).toBe(`H[c0]${Array.from({ length: 8 }, (_, k) => `r${k + 1};`).join('')}F[s8]`);
    expect(ps[1].startsWith('H[c8]r9;')).toBe(true);
    expect(ps[1].endsWith('r16;F[s16]')).toBe(true);
    expect(ps[2]).toBe('H[c16]r17;r18;r19;r20;F[s20]');
  });

  it('「(続き)」: 最初の行のマーカーは空、ほかの行は「続き」。最後の行のマーカーは空、ほかは「次ページへ」', () => {
    const mk = (k: number) => marker('cont', k === 1 ? '' : '続き') + marker('more', k === 12 ? '' : '次へ');
    const ps = texts(page(table(`H(${rtm('cont', 'first-starting', 'table-fragment')})`, `F(${rtm('more', 'last-ending', 'table-fragment')})`, rows(12, mk))));
    expect(ps.length).toBe(2);
    expect(ps[0].startsWith('H()r1;')).toBe(true);
    expect(ps[0].endsWith('F(次へ)')).toBe(true);
    expect(ps[1].startsWith('H(続き)r9;')).toBe(true);
    expect(ps[1].endsWith('r12;F()')).toBe(true);
  });

  it('断片にマーカーが無ければ、範囲 (table) の中の最後のマーカー。table-fragment なら取り出さない', () => {
    // マーカーは 2 行めにだけある。2 ページめの断片には無い
    const mk = (k: number) => (k === 2 ? marker('m', 'M2') : '');
    const t = texts(page(table(`H[${rtm('m')}]`, '', rows(12, mk))));
    expect(t[0].startsWith('H[M2]r1;')).toBe(true);
    expect(t[1].startsWith('H[M2]r')).toBe(true);
    const f = texts(page(table(`H[${rtm('m', 'first-starting', 'table-fragment')}]`, '', rows(12, mk))));
    expect(f[0].startsWith('H[M2]r1;')).toBe(true);
    expect(f[1].startsWith('H[]r')).toBe(true);
  });

  it('取り出した中身で見出しの高さが変わると、断片に入る行の数が変わる (行は見出しの下にずれ、重ならない)', () => {
    // 1 ページめの見出しは 3 行 (最初の行のマーカーがブロック 3 つ)、2 ページめの見出しは 1 行
    const tall = '<fo:block>T1</fo:block><fo:block>T2</fo:block><fo:block>T3</fo:block>';
    const hd = `<fo:table-header><fo:table-row><fo:table-cell>${rtm('h')}</fo:table-cell></fo:table-row></fo:table-header>`;
    const body = Array.from({ length: 14 }, (_, k) => row(`r${k + 1};`, marker('h', k === 0 ? tall : '<fo:block>S</fo:block>'))).join('');
    const fo = page(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="100%"/>${hd}<fo:table-body>${body}</fo:table-body></fo:table>`);
    const ps = texts(fo);
    // 1 ページめ: 見出し 3 行 + 7 行 (10 行 = 140pt)。2 ページめ: 見出し 1 行 + 残り 7 行
    expect(ps[0]).toBe(`T1T2T3${Array.from({ length: 7 }, (_, k) => `r${k + 1};`).join('')}`);
    expect(ps[1]).toBe(`S${Array.from({ length: 7 }, (_, k) => `r${k + 8};`).join('')}`);
    // 行の位置 (領域の位置は絶対): 見出し (3 行 = 42pt) の行と本体の行が、14pt ずつ並ぶ
    const { t } = layout(fo);
    const ys: number[] = [];
    const rec = (a: Area, y: number) => {
      if (a.type === 'line') ys.push(Math.round((y + a.y) * 10) / 10);
      for (const c of childrenOf(a as never)) rec(c, y + a.y);
    };
    rec(t.sheets[0] as unknown as Area, 0);
    const sorted = [...new Set(ys)].sort((a, b) => a - b);
    expect(sorted.length).toBe(10);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeCloseTo(14, 1);
  });

  it('フッターの高さが変わるときも、ページからはみ出さない', () => {
    // 8 行めのマーカーだけ 3 行。1 ページめは、8 行めを入れると フッター 3 行で入らないので 7 行まで (フッターは 7 行めのマーカー = 1 行)
    const big = '<fo:block>B1</fo:block><fo:block>B2</fo:block><fo:block>B3</fo:block>';
    const ft = `<fo:table-footer><fo:table-row><fo:table-cell>${rtm('f', 'last-ending')}</fo:table-cell></fo:table-row></fo:table-footer>`;
    const body = Array.from({ length: 12 }, (_, k) => row(`r${k + 1};`, marker('f', k === 7 ? big : `<fo:block>f${k + 1}</fo:block>`))).join('');
    const ps = texts(page(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="100%"/>${ft}<fo:table-body>${body}</fo:table-body></fo:table>`));
    expect(ps[0].endsWith('r7;f7')).toBe(true);
    expect(ps[1]).toBe('r8;r9;r10;r11;r12;f12');
  });

  it('last-starting・first-including-carryover と、ページをまたいで分かれた行 (is-first・is-last)', () => {
    // 2 行めは長く、1 ページめから 2 ページめに続く
    const long = `<fo:table-row>${cell(`${marker('m', 'L')}<fo:block>${'長'.repeat(200)}</fo:block>`)}</fo:table-row>`;
    const body = row('r1;', marker('m', 'A')) + long + row('r3;', marker('m', 'C'));
    const mk = (pos: string) => texts(page(table(`H[${rtm('m', pos)}]`, `F[${rtm('m', 'last-ending')}]`, body))).map((p) => [/H\[(\w*)\]/.exec(p)?.[1], /F\[(\w*)\]/.exec(p)?.[1]]);
    // 1 ページめ: A の行と、L の行の最初の断片。last-ending: 終わったのは A だけ
    // 2 ページめ: L の行の続き (is-first でない) と C の行
    expect(mk('first-starting')).toEqual([['A', 'A'], ['C', 'C']]);
    expect(mk('first-including-carryover')).toEqual([['A', 'A'], ['L', 'C']]);
    expect(mk('last-starting')).toEqual([['L', 'A'], ['C', 'C']]);
  });

  it('fo:table-body の子の fo:marker は、本体の領域に付く', () => {
    const b1 = `<fo:table-body>${marker('b', 'B1')}${rows(10, () => '')}</fo:table-body>`;
    const b2 = `<fo:table-body>${marker('b', 'B2')}${rows(3, () => '')}</fo:table-body>`;
    const hd = (pos: string) => `<fo:table-header><fo:table-row>${cell(`<fo:block>H[${rtm('b', pos)}]</fo:block>`)}</fo:table-row></fo:table-header>`;
    const t = (pos: string) => texts(page(`<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="100%"/>${hd(pos)}${b1}${b2}</fo:table>`)).map((p) => /H\[(\w*)\]/.exec(p)?.[1]);
    // 2 ページめ: B1 の続き (is-first でない) と、そこで始まる B2
    expect(t('first-starting')).toEqual(['B1', 'B2']);
    expect(t('first-including-carryover')).toEqual(['B1', 'B1']);
    expect(t('last-ending')).toEqual(['B1', 'B2']);
  });

  it('段組: retrieve-boundary-within-table="page" は、同じページの前の段の断片まで', () => {
    // 2 段。マーカーは 1 行めにだけある。1 ページめの 2 段めは同じページなので取り出せる。2 ページめは取り出せない
    const mk = (k: number) => (k === 1 ? marker('m', 'M') : '');
    const ps = texts(page(table(`H[${rtm('m', 'first-starting', 'page')}]`, '', rows(22, mk)), '', 'column-count="2" column-gap="4mm"'));
    expect(ps.length).toBe(2);
    expect(ps[0].match(/H\[M?\]/g)).toEqual(['H[M]', 'H[M]']);
    expect(ps[1].match(/H\[M?\]/g)).toEqual(['H[]']);
  });

  it('縦書きの表でも取り出す', () => {
    const ps = texts(page(table(`H[${rtm('m')}]`, `F[${rtm('m', 'last-ending')}]`, rows(12, (k) => marker('m', `m${k}`))), 'writing-mode="tb-rl"'));
    expect(ps.length).toBeGreaterThan(1);
    expect(ps[0]).toContain('H[m1]');
    expect(ps[1]).toMatch(/H\[m\d+\]/);
    expect(ps[ps.length - 1]).toContain('F[m12]');
  });

  it('表の header・footer の外の fo:retrieve-table-marker は、読み込みの報告に数える', () => {
    const { im } = layout(page(`<fo:block>${rtm('m')}本文</fo:block>`));
    expect(JSON.stringify(im.report)).toContain('retrieve-table-marker');
  });

  it('fo:retrieve-table-marker の無い表は、見出しを 1 度だけ組んで繰り返す (いままでどおり)', () => {
    const ps = texts(page(table('H', 'F', rows(12, (k) => marker('m', `m${k}`)))));
    expect(ps[0].startsWith('Hr1;')).toBe(true);
    expect(ps[1].startsWith('Hr9;')).toBe(true);
  });
});
