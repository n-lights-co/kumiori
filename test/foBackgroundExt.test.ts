/**
 * XSL-FO の背景の拡張 (台帳の FO-24 の (Q)・(R))。
 * - background-image の値は <uri-specification> | none | inherit (XSL 1.1 §7.8.3)。linear-gradient() などの関数は、接頭辞の無い名前に足された
 *   拡張の値なので、互換の指定 (compat: 'antenna') のときだけ読み、仕様モードでは無効の値として報告する
 * - 背景の性質は、領域の要素 (fo:region-body・fo:region-before など) にも当たる (§6.4.14〜§6.4.18 の性質の一覧の
 *   「7.8 Common Border, Padding, and Background Properties」)。fo:simple-page-master には当たらない (§6.4.13 の一覧に無い) ので、
 *   そこに書いた background-image などは、互換の指定のときだけページの背景として読む (アンテナハウスの拡張)
 * - axf:background-size は、axf: の付いた拡張なので、どのモードでも読む
 * https://www.w3.org/TR/xsl11/ (2026-11-11 取得)。拡張の中身は https://www.antenna.co.jp/AHF/help/ja/ahf-ext.html の「背景の拡張」
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import type { BackgroundImage } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
type Compat = 'spec' | 'antenna';
const imp = (body: string, compat: Compat, o: { spm?: string; regions?: string } = {}) => {
  const pm = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm" ${o.spm ?? ''}>${o.regions ?? '<fo:region-body/>'}</fo:simple-page-master></fo:layout-master-set>`;
  const r = importXslFo(`<?xml version="1.0"?><fo:root ${NS} font-size="10pt">${pm}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`, parse, { compat });
  const seq = r.document.sequences[0];
  const first = seq.flow.children[0] as { backgroundImage?: BackgroundImage; backgroundColor?: string };
  return { first, seq, unsupported: r.report.unsupported, images: r.report.images ?? [] };
};
const box = (attrs: string) => `<fo:block-container width="50mm" height="30mm" ${attrs}><fo:block>x</fo:block></fo:block-container>`;

describe('background-image のグラデーション (FO-24 (Q))', () => {
  it('互換モード: linear-gradient()・radial-gradient()・repeating- の付いたものを、グラデーションの背景として渡す', () => {
    for (const g of ['linear-gradient(0deg, darkorange, yellow)', 'linear-gradient(to right, darkorange 50%, yellow)', 'radial-gradient(circle at top left, yellow, darkorange)', 'repeating-linear-gradient(darkorange, yellow 20%, darkorange 40%)', 'repeating-radial-gradient(circle closest-side at 30px 30px, darkorange, yellow, darkorange)']) {
      const r = imp(box(`background-image="${g}"`), 'antenna');
      expect(r.first.backgroundImage, g).toEqual({ src: '', gradient: g, gradientFontSize: 10 });
      expect(r.unsupported).toEqual({});
      // 画像のファイルとしては数えない
      expect(r.images).toEqual([]);
    }
  });

  it('仕様モード: グラデーションの関数は background-image の値ではない (§7.8.3)。描かずに、無効の値として報告する', () => {
    const r = imp(box('background-image="linear-gradient(0deg, darkorange, yellow)" background-color="#ff0000"') + box('background-image="repeating-radial-gradient(yellow, darkorange)"'), 'spec');
    expect(r.first.backgroundImage).toBeUndefined();
    expect(r.first.backgroundColor).toBe('#ff0000');
    expect(r.unsupported).toEqual({ 'background-image:linear-gradient()': 1, 'background-image:repeating-radial-gradient()': 1 });
    expect(r.images).toEqual([]);
  });

  it('互換モード: 繰り返し・位置・大きさ (axf:background-content-width) の指定は、画像のときと同じに効く。一括指定 background でも読む', () => {
    const a = imp(box('background-image="linear-gradient(to right, red, blue)" background-repeat="no-repeat" background-position-horizontal="center" axf:background-content-width="20mm" axf:background-content-height="10mm"'), 'antenna');
    expect(a.first.backgroundImage).toMatchObject({ gradient: 'linear-gradient(to right, red, blue)', repeat: 'no-repeat', x: 'center' });
    expect(a.first.backgroundImage!.width).toBeCloseTo((20 * 72) / 25.4, 3);
    expect(a.first.backgroundImage!.height).toBeCloseTo((10 * 72) / 25.4, 3);
    const b = imp(box('background="linear-gradient(to right, red, blue) no-repeat #00ff00"'), 'antenna');
    expect(b.first.backgroundImage).toMatchObject({ gradient: 'linear-gradient(to right, red, blue)', repeat: 'no-repeat' });
    expect(b.first.backgroundColor).toBe('#00ff00');
    expect(b.unsupported).toEqual({});
    // 仕様モードの一括指定: グラデーションだけを無効の値として報告し、色は読む
    const c = imp(box('background="linear-gradient(to right, red, blue) no-repeat #00ff00"'), 'spec');
    expect(c.first.backgroundImage).toBeUndefined();
    expect(c.first.backgroundColor).toBe('#00ff00');
    expect(c.unsupported).toEqual({ 'background-image:linear-gradient()': 1 });
  });

  it('互換モード: 読めない書き方のグラデーションは、描かずに報告する', () => {
    const r = imp(box('background-image="linear-gradient()"'), 'antenna');
    expect(r.first.backgroundImage).toBeUndefined();
    expect(r.unsupported).toEqual({ 'background-image:linear-gradient()': 1 });
  });
});

describe('axf:background-size (どのモードでも)', () => {
  it('長さ・百分率・auto・cover・contain を読む', () => {
    for (const c of ['spec', 'antenna'] as const) {
      const of = (v: string) => imp(box(`background-image="url(a.png)" axf:background-size="${v}"`), c);
      expect(of('20pt 10pt').first.backgroundImage).toMatchObject({ src: 'a.png', width: 20, height: 10 });
      expect(of('20pt').first.backgroundImage).toEqual({ src: 'a.png', width: 20 });
      expect(of('auto 10pt').first.backgroundImage).toEqual({ src: 'a.png', height: 10 });
      expect(of('cover').first.backgroundImage).toEqual({ src: 'a.png', size: 'cover' });
      expect(of('contain').first.backgroundImage).toEqual({ src: 'a.png', size: 'contain' });
      expect(of('50% 25%').first.backgroundImage).toEqual({ src: 'a.png', widthPct: 0.5, heightPct: 0.25 });
      expect(of('50%').first.backgroundImage).toEqual({ src: 'a.png', widthPct: 0.5, pctAuto: 'height' });
      expect(of('auto').first.backgroundImage).toEqual({ src: 'a.png' });
      expect(of('20pt').unsupported).toEqual({});
      // 読めない値・2 枚目からの層は、報告する
      expect(of('big').unsupported).toEqual({ 'axf:background-size:big': 1 });
      expect(of('10pt, 20pt').unsupported).toEqual({ 'axf:background-size:10pt, 20pt': 1 });
    }
  });
});

describe('領域とページマスターの背景の画像 (FO-24 (R))', () => {
  const bgOf = (seq: { staticContent?: unknown[] }) => (seq.staticContent as Array<{ layer?: string; backgroundImage?: BackgroundImage; left?: number; top?: number; width?: number; height?: number }>).filter((c) => c.layer === 'behind');

  it('fo:region-body・fo:region-before の background-image・-repeat・-position を、領域の矩形の背景として渡す (どのモードでも)', () => {
    for (const c of ['spec', 'antenna'] as const) {
      const r = imp('<fo:block>x</fo:block>', c, {
        regions: '<fo:region-body margin-top="10mm" background-image="url(wm.svg)" background-position-horizontal="center" background-position-vertical="50%"/><fo:region-before extent="8mm" background-image="head.png" background-repeat="repeat-x"/>',
      });
      const bgs = bgOf(r.seq);
      expect(bgs.map((b) => b.backgroundImage)).toEqual([
        { src: 'head.png', repeat: 'repeat-x' },
        { src: 'wm.svg', x: 'center', y: '50%' },
      ]);
      // 本文の領域の矩形: ページの余白 10mm の内側の、margin-top 10mm から下
      const mm = 72 / 25.4;
      expect(bgs[1].left).toBeCloseTo(10 * mm, 3);
      expect(bgs[1].top).toBeCloseTo(20 * mm, 3);
      expect(bgs[1].width).toBeCloseTo(80 * mm, 3);
      expect(bgs[1].height).toBeCloseTo(70 * mm, 3);
      expect(r.unsupported).toEqual({});
      expect(r.images.sort()).toEqual(['head.png', 'wm.svg']);
    }
  });

  it('fo:simple-page-master の background-image (仕様では当たらない。§6.4.13): 互換モードだけ、ページの背景として読む。仕様モードは報告する', () => {
    const spm = 'background-image="peace.svg" background-repeat="no-repeat" background-position-horizontal="center" background-position-vertical="center" axf:background-content-height="250pt"';
    const a = imp('<fo:block>x</fo:block>', 'antenna', { spm });
    expect(a.seq.master.backgroundImage).toEqual({ src: 'peace.svg', repeat: 'no-repeat', x: 'center', y: 'center', height: 250 });
    expect(a.unsupported).toEqual({});
    const s = imp('<fo:block>x</fo:block>', 'spec', { spm });
    expect(s.seq.master.backgroundImage).toBeUndefined();
    // 読まなかった属性として、名前ごとに 1 度ずつ報告に出る (ほかの要素で読む名前には「(fo:simple-page-master)」が付く)
    expect(Object.entries(s.unsupported).map(([k, n]) => `${k.replace(/ \(fo:simple-page-master\)$/, '')}=${n}`).sort()).toEqual(
      ['axf:background-content-height=1', 'background-image=1', 'background-position-horizontal=1', 'background-position-vertical=1', 'background-repeat=1'],
    );
  });
});

describe('fo:simple-page-master の background-color (背景の性質は fo:simple-page-master に当たらない。XSL 1.1 §6.4.13)', () => {
  const master = (r: ReturnType<typeof imp>) => (r.seq.master as { backgroundColor?: string }).backgroundColor;
  it('仕様モード: 接頭辞の無い background-color は読まず、読まなかった属性として報告する (直す前は、ページの背景色として読んでいた)', () => {
    const r = imp(box(''), 'spec', { spm: 'background-color="#eeeeff"' });
    expect(master(r)).toBeUndefined();
    expect(Object.keys(r.unsupported).some((k) => k.startsWith('background-color'))).toBe(true);
  });
  it('互換モード: アンテナハウスの拡張 (ページの背景) として、ページの背景色に読む', () => {
    const r = imp(box(''), 'antenna', { spm: 'background-color="#eeeeff"' });
    expect(master(r)).toBe('#eeeeff');
  });
  it('axf:background-color は、名前に接頭辞の付いた拡張なので、どのモードでも読む', () => {
    for (const compat of ['spec', 'antenna'] as const) {
      const r = imp(box(''), compat, { spm: 'axf:background-color="#eeeeff"' });
      expect(master(r), compat).toBe('#eeeeff');
      expect(Object.keys(r.unsupported).filter((k) => k.includes('background'))).toEqual([]);
    }
  });
});
