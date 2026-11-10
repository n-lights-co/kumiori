/**
 * 変更バー (XSL 1.1 §6.13.2 fo:change-bar-begin・§6.13.3 fo:change-bar-end、§7.30.1〜§7.30.6 change-bar-*、§6.4.5 の change bar area):
 * 始まりと終わりの間にある行の横 (段の端から change-bar-offset だけ離れた所が中心) に線を引く
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine, pt } from './helpers';
import type { Area } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
// ページ 100mm 角、余白 20mm → 本文は x・y とも 20mm から 80mm
const page = (body: string, o: { flow?: string; region?: string; seq?: string } = {}) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="20mm"><fo:region-body ${o.region ?? ''}/><fo:region-before extent="10mm"/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m" ${o.seq ?? ''}>` +
  `<fo:static-content flow-name="xsl-region-before"><fo:block>柱</fo:block></fo:static-content>` +
  `<fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="14pt" ${o.flow ?? ''}>${body}</fo:flow></fo:page-sequence></fo:root>`;
const begin = (cls: string, attrs = 'change-bar-style="solid"') => `<fo:change-bar-begin change-bar-class="${cls}" ${attrs}/>`;
const end = (cls: string) => `<fo:change-bar-end change-bar-class="${cls}"/>`;

interface Bar { x: number; y: number; w: number; h: number; color: string; style?: string; side: string }
/** ページごとの、バー (字を持たず、罫線が 1 辺だけの細い箱) の位置 (ページの左上から pt) */
const bars = (fo: string) => {
  const im = importXslFo(fo, parse, { compat: 'spec' });
  const t = E.engine.layout(im.document);
  const pages = t.sheets.map((sh) => {
    const out: Bar[] = [];
    const rec = (a: Area, x: number, y: number) => {
      const kids = childrenOf(a as never);
      const sides = Object.entries((a.border ?? {}) as Record<string, { width: number; color: string; style?: string } | undefined>).filter(([, v]) => v && v.width > 0);
      if (a.type === 'block' && !kids.length && sides.length === 1 && Math.min(a.width, a.height) <= 5)
        out.push({ x: x + a.x, y: y + a.y, w: a.width, h: a.height, color: sides[0][1]!.color, style: sides[0][1]!.style, side: sides[0][0] });
      for (const c of kids) rec(c, x + a.x, y + a.y);
    };
    rec(sh as unknown as Area, 0, 0);
    return out;
  });
  return { pages, im };
};
const L = pt(20);
const R = pt(80);

describe('fo:change-bar-begin・fo:change-bar-end', () => {
  it('始まりと終わりの間の行の横に、段の始めの端から 6pt 離れた所を中心に線を引く (初期値: placement=start・offset=6pt・width=medium)', () => {
    const { pages } = bars(page(`<fo:block>前</fo:block>${begin('a')}<fo:block>変更 1</fo:block><fo:block>変更 2</fo:block>${end('a')}<fo:block>後</fo:block>`));
    expect(pages[0].length).toBe(1);
    const b = pages[0][0];
    // 2 行ぶん (14pt × 2)。1 行めの下から
    expect(b.h).toBeCloseTo(28, 1);
    expect(b.y).toBeCloseTo(L + 14, 1);
    // バーの中心が、本文の左端から 6pt 外
    expect(b.x + b.w / 2).toBeCloseTo(L - 6, 1);
    expect(b.color.toLowerCase()).toBe('#000000');
  });

  it('change-bar-style の初期値は none (線を引かない)', () => {
    const { pages } = bars(page(`${begin('a', '')}<fo:block>変更</fo:block>${end('a')}`));
    expect(pages[0].length).toBe(0);
  });

  it('色・太さ・間隔・線種は、始まりの要素での値 (継承される)', () => {
    const { pages } = bars(page(`<fo:block change-bar-color="#ff0000" change-bar-width="2pt" change-bar-offset="10pt" change-bar-style="dashed">${begin('a', '')}変更${end('a')}</fo:block>`));
    const b = pages[0][0];
    expect(b.color.toLowerCase()).toBe('#ff0000');
    expect(b.w).toBeCloseTo(2, 2);
    expect(b.style).toBe('dashed');
    expect(b.x + b.w / 2).toBeCloseTo(L - 10, 1);
  });

  it('change-bar-color の初期値は color の値', () => {
    const { pages } = bars(page(`<fo:block color="#0000ff">${begin('a')}変更${end('a')}</fo:block>`));
    expect(pages[0][0].color.toLowerCase()).toBe('#0000ff');
  });

  it('ブロックの途中で始まり、途中で終わる: その字を含む行にだけ', () => {
    const text = 'あ'.repeat(40); // 1 行 17 字 (60mm ÷ 10pt) → 3 行
    const { pages } = bars(page(`<fo:block>${text}${begin('a')}変更${end('a')}${text}</fo:block>`));
    expect(pages[0].length).toBe(1);
    // 「変更」は 3 行め (41・42 字め) だけ
    expect(pages[0][0].h).toBeCloseTo(14, 1);
    expect(pages[0][0].y).toBeCloseTo(L + 28, 1);
  });

  it('始まりと終わりが別の要素の中にあってもよい (文書の順の範囲)', () => {
    const { pages } = bars(page(`<fo:block>一${begin('a')}二</fo:block><fo:block>三</fo:block><fo:block>四${end('a')}</fo:block><fo:block>五</fo:block>`));
    expect(pages[0].length).toBe(1);
    expect(pages[0][0].y).toBeCloseTo(L, 1);
    expect(pages[0][0].h).toBeCloseTo(42, 1);
  });

  it('入れ子・重なり: class ごとに組にし、それぞれの線を引く', () => {
    const fo = page(
      `${begin('a')}<fo:block>1</fo:block>${begin('b', 'change-bar-style="solid" change-bar-offset="12pt"')}<fo:block>2</fo:block>${end('a')}<fo:block>3</fo:block>${end('b')}<fo:block>4</fo:block>`,
    );
    const ps = bars(fo).pages[0].sort((p, q) => q.x - p.x);
    expect(ps.length).toBe(2);
    // a: 1・2 行め (6pt)、b: 2・3 行め (12pt)
    expect([ps[0].y - L, ps[0].h].map((v) => Math.round(v))).toEqual([0, 28]);
    expect([ps[1].y - L, ps[1].h].map((v) => Math.round(v))).toEqual([14, 28]);
    expect(ps[1].x + ps[1].w / 2).toBeCloseTo(L - 12, 1);
  });

  it('同じ class の入れ子は、内側の終わりが内側の始まりと組になる', () => {
    const fo = page(`${begin('a')}<fo:block>1</fo:block>${begin('a', 'change-bar-style="solid" change-bar-offset="12pt"')}<fo:block>2</fo:block>${end('a')}<fo:block>3</fo:block>${end('a')}<fo:block>4</fo:block>`);
    const ps = bars(fo).pages[0].sort((p, q) => q.x - p.x);
    expect(ps.map((b) => Math.round(b.h))).toEqual([42, 14]);
  });

  it('終わりの無い始まりは文書の終わりまで。始まりの無い終わりは無視して報告する', () => {
    const a = bars(page(`<fo:block>1</fo:block>${begin('a')}<fo:block>2</fo:block><fo:block>3</fo:block>`));
    expect(Math.round(a.pages[0][0].h)).toBe(28);
    const b = bars(page(`<fo:block>1</fo:block>${end('a')}<fo:block>2</fo:block>`));
    expect(b.pages[0].length).toBe(0);
    expect(JSON.stringify(b.im.report)).toContain('change-bar-end');
  });

  it('change-bar-placement: end・left・right', () => {
    const at = (pl: string, flow = '') => {
      const b = bars(page(`${begin('a', `change-bar-style="solid" change-bar-placement="${pl}"`)}<fo:block>変更</fo:block>${end('a')}`, { flow })).pages[0][0];
      return b.x + b.w / 2;
    };
    expect(at('end')).toBeCloseTo(R + 6, 1);
    expect(at('left')).toBeCloseTo(L - 6, 1);
    expect(at('right')).toBeCloseTo(R + 6, 1);
  });

  it('change-bar-placement: inside・outside は、奇数ページでは綴じる側が始めの端、偶数ページでは終わりの端', () => {
    const body = (pl: string) => `${begin('a', `change-bar-style="solid" change-bar-placement="${pl}"`)}<fo:block>1 ページめ</fo:block><fo:block break-before="page">2 ページめ</fo:block>${end('a')}`;
    const xs = (pl: string) => bars(page(body(pl))).pages.map((p) => Math.round(p[0].x + p[0].w / 2));
    expect(xs('inside')).toEqual([Math.round(L - 6), Math.round(R + 6)]);
    expect(xs('outside')).toEqual([Math.round(R + 6), Math.round(L - 6)]);
  });

  it('段組: 段ごとに、その段の端に引く。alternate は 2 段のとき 1 段めの始めと 2 段めの終わり', () => {
    const region = 'column-count="2" column-gap="10mm"';
    const body = (pl: string) => `${begin('a', `change-bar-style="solid" change-bar-placement="${pl}"`)}<fo:block>1 段め</fo:block><fo:block break-before="column">2 段め</fo:block>${end('a')}`;
    const xs = (pl: string) =>
      bars(page(body(pl), { region }))
        .pages[0].map((b) => Math.round(b.x + b.w / 2))
        .sort((a, b) => a - b);
    const colW = (pt(60) - pt(10)) / 2;
    expect(xs('start')).toEqual([Math.round(L - 6), Math.round(L + colW + pt(10) - 6)]);
    expect(xs('alternate')).toEqual([Math.round(L - 6), Math.round(R + 6)]);
    // 3 段では outside と同じ (奇数ページ: 終わりの端)
    const three = bars(page(body('alternate'), { region: 'column-count="3" column-gap="6mm"' })).pages[0].map((b) => Math.round(b.x + b.w / 2));
    const w3 = (pt(60) - pt(12)) / 3;
    expect(three.sort((a, b) => a - b)).toEqual([Math.round(L + w3 + 6), Math.round(L + 2 * w3 + pt(6) + 6)]);
  });

  it('表のセルの中にも引く (隣り合うセルの行は 1 本にまとめ、高い方のセルの下まで)', () => {
    const tbl =
      `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="50%"/><fo:table-column column-width="50%"/><fo:table-body>` +
      `<fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row>${begin('a')}` +
      `<fo:table-row><fo:table-cell><fo:block>c</fo:block><fo:block>c</fo:block><fo:block>c</fo:block></fo:table-cell><fo:table-cell><fo:block>d</fo:block></fo:table-cell></fo:table-row>${end('a')}` +
      `<fo:table-row><fo:table-cell><fo:block>e</fo:block></fo:table-cell><fo:table-cell><fo:block>f</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const { pages } = bars(page(tbl));
    expect(pages[0].length).toBe(1);
    expect(pages[0][0].y).toBeCloseTo(L + 14, 1);
    expect(pages[0][0].h).toBeCloseTo(42, 1);
  });

  it('脚注の本体・柱 (fo:static-content) には引かない', () => {
    const fo = page(`${begin('a')}<fo:block>本文<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>脚注</fo:block></fo:footnote-body></fo:footnote></fo:block>${end('a')}`);
    const { pages } = bars(fo);
    expect(pages[0].length).toBe(1);
    expect(pages[0][0].h).toBeCloseTo(14, 1);
  });

  it('縦書き: 段の始めの端 (上) の外に、行の並ぶ向きの線を引く', () => {
    const { pages } = bars(page(`<fo:block>前</fo:block>${begin('a')}<fo:block>変更 1</fo:block><fo:block>変更 2</fo:block>${end('a')}`, { seq: 'writing-mode="tb-rl"' }));
    expect(pages[0].length).toBe(1);
    const b = pages[0][0];
    // 横に 2 行ぶん、上端から 6pt 上が中心
    expect(b.w).toBeCloseTo(28, 1);
    expect(b.y + b.h / 2).toBeCloseTo(L - 6, 1);
    // 右から 2 行め・3 行め
    expect(b.x + b.w).toBeCloseTo(R - 14, 1);
  });

  it('右から左の横書き (rl-tb): 始めの端は右。left・right は書字方向によらない', () => {
    const at = (pl: string) => {
      const b = bars(page(`${begin('a', `change-bar-style="solid" change-bar-placement="${pl}"`)}<fo:block>abc</fo:block>${end('a')}`, { seq: 'writing-mode="rl-tb"' })).pages[0][0];
      return b.x + b.w / 2;
    };
    expect(at('start')).toBeCloseTo(R + 6, 1);
    expect(at('end')).toBeCloseTo(L - 6, 1);
    expect(at('left')).toBeCloseTo(L - 6, 1);
    expect(at('right')).toBeCloseTo(R + 6, 1);
  });

  it('axf:revision-bar-* と一緒に使っても、どちらも引く', () => {
    const { pages } = bars(page(`<fo:block axf:revision-bar-style="solid" axf:revision-bar-width="1pt" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions">一${begin('a')}二${end('a')}</fo:block><fo:block>三</fo:block>`));
    expect(pages[0].length).toBe(2);
  });

  it('変更バーの無い文書には、何も足さない', () => {
    const { pages, im } = bars(page(`<fo:block>本文</fo:block>`));
    expect(pages[0].length).toBe(0);
    expect(JSON.stringify(im.document)).not.toContain('changeBars');
  });
});
