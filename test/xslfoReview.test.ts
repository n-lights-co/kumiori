/**
 * XSL-FO の読み込みと組版の手直し (対応仕様説明書の検証の指摘)。
 * 仕様は XSL 1.1 (https://www.w3.org/TR/xsl11/ 2026-11-06 取得) で確かめた。アンテナハウスの拡張 (axf:*) は、その名前と値で読む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { adjustJapaneseSpacing, type Atom } from '../src/inlineLayout';
import { makeEngine } from './helpers';
import type { LBlock, LBlockContainer, LPageSequence, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const AXNS = 'xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>`;
const fo = (flow: string) => `<?xml version="1.0"?><fo:root ${NS} ${AXNS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
/** 幅 200mm・余白 10mm のページ (本文の幅 180mm) に、region-body の指定と flow の中身を置く */
const root = (body: string, flow: string) =>
  `<fo:root ${NS} ${AXNS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200mm" page-height="100mm" margin="10mm">${body}</fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
type Compat = 'spec' | 'antenna';
const imp = (xml: string, o: ImportOptions = {}) => importXslFo(xml, parse, { compat: 'antenna', ...o });
const seq = (xml: string, compat: Compat = 'antenna'): LPageSequence => imp(xml, { compat }).document.sequences[0];
const first = <T>(xml: string, compat: Compat = 'antenna') => seq(xml, compat).flow.children[0] as T;

/** 1 ページ目の本文の字 (字と、本文の左上からの x・y) */
const glyphs = (xml: string, compat: Compat = 'spec') => {
  const t = E.engine.layout(imp(xml, { compat }).document);
  const out: Array<{ ch: string; x: number; y: number }> = [];
  type A = { x: number; y: number; type: string; text?: string; children?: A[] };
  const visit = (a: A, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ ch: a.text ?? '', x, y });
    for (const c of a.children ?? []) visit(c, x, y);
  };
  for (const c of t.sheets[0].page.regionBody.children as unknown as A[]) visit(c, 0, 0);
  return out;
};

describe('段組 (no 2・3)', () => {
  it('負の column-gap は 0pt にする (region-body・block-container・axf:column-gap。XSL 1.1 §7.27.3)', () => {
    for (const c of ['antenna', 'spec'] as const) expect(seq(root('<fo:region-body column-count="2" column-gap="-20pt"/>', '<fo:block>a</fo:block>'), c).master.columns).toEqual({ count: 2, gap: 0 });
    const bc = (a: string) => first<LBlockContainer>(fo(`<fo:block-container ${a}><fo:block>a</fo:block></fo:block-container>`));
    expect(bc('axf:column-count="2" axf:column-gap="-5mm"').columns?.gap).toBe(0);
    expect(bc('column-count="2" column-gap="-5mm"').columns?.gap).toBe(0);
    expect(bc('axf:column-count="2" axf:column-gap="6pt"').columns?.gap).toBe(6);
  });
  it('負の column-gap の 2 段組は、2 段目が 1 段目に重ならない (段の間は 0)', () => {
    const x2 = (gap: string) => glyphs(root(`<fo:region-body column-count="2" column-gap="${gap}"/>`, '<fo:block break-before="column">B</fo:block>'))[0].x;
    expect(x2('-20pt')).toBeCloseTo(x2('0pt'), 2);
  });
  it('column-count の整数でない値・正でない値は、1 以上の最も近い整数に丸める (§7.27.2)', () => {
    const cols = (v: string) => seq(root(`<fo:region-body column-count="${v}"/>`, '<fo:block>a</fo:block>')).master.columns?.count ?? 1;
    expect([cols('2.6'), cols('2.4'), cols('0.3'), cols('-2'), cols('3')]).toEqual([3, 2, 1, 1, 3]);
    const bc = (v: string) => first<LBlockContainer>(fo(`<fo:block-container axf:column-count="${v}"><fo:block>a</fo:block></fo:block-container>`)).columns?.count;
    expect([bc('2.6'), bc('1.4')]).toEqual([3, undefined]);
  });
});

describe('表の列・セルの数 (no 4)', () => {
  it('number-columns-repeated・number-columns-spanned・number-rows-spanned の整数でない値は、1 以上の最も近い整数に丸める (§7.28.12〜14)', () => {
    const t = first<LTable>(
      fo(
        '<fo:table table-layout="fixed" width="60mm"><fo:table-column column-width="10mm" number-columns-repeated="2.6"/><fo:table-body><fo:table-row>' +
          '<fo:table-cell number-columns-spanned="2.6" number-rows-spanned="1.7"><fo:block>a</fo:block></fo:table-cell><fo:table-cell number-columns-spanned="-1"><fo:block>b</fo:block></fo:table-cell>' +
          '</fo:table-row><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>',
      ),
    );
    expect(t.columns.length).toBeGreaterThanOrEqual(3);
    expect(t.columns.slice(0, 3).map((c) => (typeof c.width === 'number' ? Math.round(c.width) : c.width))).toEqual([28, 28, 28]);
    const [a, b] = t.body.rows[0].cells;
    expect([a.colSpan, a.rowSpan, b.colSpan]).toEqual([3, 2, undefined]);
  });
});

describe('揃え (no 5・6)', () => {
  it('仕様モード: text-align の left は start、right は end (右から左の書字方向でも。§7.16.9・§7.16.10)。互換モードは物理の左右のまま', () => {
    const al = (compat: Compat, v: string) => first<LBlock>(fo(`<fo:block direction="rtl" text-align="${v}" text-align-last="${v}">a</fo:block>`), compat);
    expect([al('spec', 'left').textAlign, al('spec', 'left').textAlignLast, al('spec', 'right').textAlign, al('spec', 'right').textAlignLast]).toEqual(['start', 'start', 'end', 'end']);
    expect([al('antenna', 'left').textAlign, al('antenna', 'right').textAlign]).toEqual(['end', 'start']);
    // 組んだ結果: 右から左の行の left は右端 (start) に寄る。互換モードは左端
    const x = (c: Compat) => glyphs(root('<fo:region-body/>', '<fo:block direction="rtl" text-align="left">ABC</fo:block>'), c)[0].x;
    expect(x('spec')).toBeGreaterThan(400);
    expect(x('antenna')).toBeLessThan(1);
  });
  it('仕様モード: text-align-last の inside・outside は、組むページの綴じ側で決める (1 ページ目の outside は end、inside は start。§7.16.10)', () => {
    const last = (v: string, c: Compat = 'spec') => glyphs(root('<fo:region-body/>', `<fo:block text-align="center" text-align-last="${v}">ABC</fo:block>`), c)[0].x;
    expect(last('outside')).toBeGreaterThan(400);
    expect(last('inside')).toBeLessThan(1);
    expect(last('outside', 'antenna')).toBeLessThan(1); // 互換モードは従来どおり start
    expect(first<LBlock>(fo('<fo:block text-align-last="outside">a</fo:block>'), 'spec').textAlignLast).toBe('outside');
  });
});

describe('keep (no 9)', () => {
  it('仕様モード: ブロックの keep-together の整数 (1 以上) は always と同じに保つ。互換モードは always だけ (従来どおり)', () => {
    const kt = (v: string, c: Compat) => first<LBlock>(fo(`<fo:block keep-together.within-page="${v}">a</fo:block>`), c).keepTogether;
    expect([kt('5', 'spec'), kt('always', 'spec'), kt('auto', 'spec'), kt('5', 'antenna'), kt('always', 'antenna')]).toEqual([true, true, undefined, undefined, true]);
  });
});

describe('relative-align (no 11)', () => {
  it('display-align が auto のセルとリストの項目は、relative-align="baseline" なら 1 行目の基線をそろえる (§7.14.4・§7.14.6)', () => {
    const t = first<LTable>(
      fo('<fo:table relative-align="baseline"><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell><fo:table-cell display-align="after"><fo:block>b</fo:block></fo:table-cell><fo:table-cell display-align="auto"><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>'),
    );
    expect(t.body.rows[0].cells.map((c) => c.blockAlign)).toEqual(['baseline', 'end', 'baseline']);
    const l = first<LTable>(fo('<fo:list-block><fo:list-item relative-align="baseline"><fo:list-item-label><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body><fo:block>b</fo:block></fo:list-item-body></fo:list-item></fo:list-block>'));
    expect(l.body.rows[0].cells.map((c) => c.blockAlign)).toEqual(['baseline', 'baseline']);
    const plain = first<LTable>(fo('<fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>'));
    expect(plain.body.rows[0].cells[0].blockAlign).toBeUndefined();
  });
  it('組んだ結果: 大きい字のセルと小さい字のセルの 1 行目の基線がそろう', () => {
    const cellXml = (ra: string) =>
      root(
        '<fo:region-body/>',
        `<fo:table ${ra} table-layout="fixed" width="100mm"><fo:table-column column-width="50mm"/><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row><fo:table-cell><fo:block font-size="30pt">A</fo:block></fo:table-cell><fo:table-cell><fo:block font-size="8pt">B</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`,
      );
    const dy = (ra: string) => {
      const g = glyphs(cellXml(ra));
      return g.find((v) => v.ch === 'B')!.y - g.find((v) => v.ch === 'A')!.y;
    };
    expect(dy('relative-align="baseline"')).toBeGreaterThan(dy('') + 10);
  });
});

describe('reference-orientation (no 12)', () => {
  it('inherit は親の要素の計算値 (§5.9.10.1)。親に指定が無ければ初期値の 0', () => {
    const c = first<LBlockContainer>(fo('<fo:block-container reference-orientation="90" width="30mm" height="30mm"><fo:block-container reference-orientation="inherit"><fo:block>a</fo:block></fo:block-container></fo:block-container>'));
    expect(c.rotation).toBe(90);
    expect((c.children[0] as LBlockContainer).rotation).toBe(90);
    expect(first<LBlockContainer>(fo('<fo:block-container reference-orientation="inherit"><fo:block>a</fo:block></fo:block-container>')).rotation).toBeUndefined();
    const m = seq(
      `<fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" reference-orientation="180"><fo:region-body reference-orientation="inherit"/></fo:simple-page-master></fo:layout-master-set>` +
        `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`,
    ).master;
    expect(m.bodyRotation).toBe(180);
  });
});

describe('axf:box-shadow (no 17)', () => {
  it('カンマで影ごとに分け、それぞれの色を読む。inset の影は内側の影', () => {
    const sh = (v: string) => first<LBlock>(fo(`<fo:block axf:box-shadow="${v}">a</fo:block>`)).boxShadow;
    expect(sh('4pt 4pt #ff0000, 8pt 8pt #0000ff')).toEqual([
      { dx: 4, dy: 4, color: '#ff0000' },
      { dx: 8, dy: 8, color: '#0000ff' },
    ]);
    expect(sh('4pt 4pt rgb(0, 255, 0), 1pt 1pt #000000')).toEqual([
      { dx: 4, dy: 4, color: 'rgb(0, 255, 0)' },
      { dx: 1, dy: 1, color: '#000000' },
    ]); // 括弧の中のカンマでは分けない
    expect(sh('inset 4pt 4pt #00ff00')).toEqual({ dx: 4, dy: 4, color: '#00ff00', inset: true });
    expect(sh('inset 4pt 4pt #00ff00, 2pt 2pt #ff0000')).toEqual([
      { dx: 4, dy: 4, color: '#00ff00', inset: true },
      { dx: 2, dy: 2, color: '#ff0000' },
    ]);
  });
});

describe('改訂バー (no 18)', () => {
  it('axf:revision-bar-style が none (初期値) なら引かない。色の初期値は color の値。指定は子へ継承する', () => {
    const b = (attrs: string, inner = '') => first<LBlock>(fo(`<fo:block ${attrs}>a${inner}</fo:block>`));
    expect(b('axf:revision-bar-color="red"').revisionBar).toBeUndefined();
    expect(b('axf:revision-bar-style="none" axf:revision-bar-color="red"').revisionBar).toBeUndefined();
    expect(b('axf:revision-bar-style="solid" axf:revision-bar-color="#ff0000"').revisionBar?.color).toBe('#ff0000');
    expect(b('axf:revision-bar-style="solid" color="#00ff00"').revisionBar?.color).toBe('#00ff00');
    // 親の線種を受け継いで、子の色で引く
    const p = b('axf:revision-bar-style="dashed"', '<fo:inline axf:revision-bar-color="#0000ff">b</fo:inline>');
    const child = p.children.find((c) => typeof c !== 'string') as { revisionBar?: { color: string; style?: string } };
    expect(child.revisionBar).toMatchObject({ color: '#0000ff', style: 'dashed' });
  });
});

describe('axf:punctuation-trim (no 19)', () => {
  const flags = (v: string, c: Compat = 'antenna') => {
    const b = first<LBlock>(fo(`<fo:block axf:punctuation-trim="${v}">a</fo:block>`), c);
    return [b.punctuationSqueeze, b.punctuationTrimStart, b.punctuationTrimStartExceptFirst, b.punctuationTrimEnd, b.punctuationTrimEndExceptFullstop, b.punctuationTrimAll].map((x) => (x ? 1 : 0)).join('');
  };
  it('値はトークンとして読む (start-except-first を start と取り違えない)。拡張の値に無い語は報告する', () => {
    // 並び: adjacent・start・start-except-first・end・end-except-fullstop・all
    expect(flags('none')).toBe('000000');
    expect(flags('start')).toBe('010000');
    expect(flags('start-except-first')).toBe('011000');
    expect(flags('end')).toBe('000100');
    expect(flags('end-except-fullstop')).toBe('000110');
    expect(flags('allow-end')).toBe('000000');
    expect(flags('start end adjacent')).toBe('110100');
    expect(flags('all')).toBe('000001');
    expect(flags('auto')).toBe('100100'); // 互換モードの既定と同じ (約物の連続の詰めと行末)
    expect(flags('auto', 'spec')).toBe('000000');
    expect(flags('&quot;・&quot;')).toBe('000000'); // <string> だけは <string> none と同じ
    expect(imp(fo('<fo:block axf:punctuation-trim="both">a</fo:block>')).report.unsupported['axf:punctuation-trim:both']).toBe(1);
  });
  it('組版: start-except-first は段落の 1 行目と強制改行の直後の行の行頭を詰めない', () => {
    const xs = (v: string) =>
      glyphs(root('<fo:region-body/>', `<fo:block font-size="10pt" axf:punctuation-trim="${v}" linefeed-treatment="preserve">「あ&#10;「い</fo:block>`))
        .filter((g) => g.ch === '「')
        .map((g) => g.x);
    const [s1, s2] = xs('start');
    const [e1, e2] = xs('start-except-first');
    expect(s1).toBeCloseTo(e1 - 5, 1);
    expect(s2).toBeCloseTo(e2 - 5, 1);
    // 段落の途中で折り返した行の先頭は、start-except-first でも詰める
    const wrapped = glyphs(root('<fo:region-body margin-right="160mm"/>', `<fo:block font-size="10pt" axf:punctuation-trim="start-except-first">${'あ'.repeat(5)}「い</fo:block>`)).find((g) => g.ch === '「')!;
    const wrappedNone = glyphs(root('<fo:region-body margin-right="160mm"/>', `<fo:block font-size="10pt" axf:punctuation-trim="none">${'あ'.repeat(5)}「い</fo:block>`)).find((g) => g.ch === '「')!;
    expect(wrapped.y).toBeGreaterThan(5); // 2 行目
    expect(wrapped.x).toBeCloseTo(wrappedNone.x - 5, 1);
  });
  it('組版: end-except-fullstop は、行末の句点 (。．) の後ろのアキを残す', () => {
    const endX = (v: string, ch: string) => glyphs(root('<fo:region-body/>', `<fo:block font-size="10pt" text-align="end" axf:punctuation-trim="${v}">あ${ch}</fo:block>`)).find((g) => g.ch === ch)!.x;
    expect(endX('end', '。')).toBeCloseTo(endX('none', '。') + 5, 1);
    expect(endX('end-except-fullstop', '。')).toBeCloseTo(endX('none', '。'), 1);
    expect(endX('end-except-fullstop', '、')).toBeCloseTo(endX('none', '、') + 5, 1);
  });
  it('all: 全角の括弧類・中点類・句読点類をすべて二分にする (始め括弧類は前、中点類は前後の四分ずつ)', () => {
    const st = { fontSize: 10, punctuationTrimAll: true, punctuationSqueeze: true } as unknown as Atom['st'];
    const a = ['あ', '「', 'い', '」', '・', 'う', '、', 'え'].map((ch) => ({ kind: 'glyph', first: ch, last: ch, advance: 10, isSpace: false, runId: 0, st }) as Atom);
    adjustJapaneseSpacing(a);
    expect(a.map((x) => x.advance)).toEqual([10, 5, 10, 5, 5, 10, 5, 10]);
    expect([a[1].dx, a[4].dx]).toEqual([-5, -2.5]);
  });
});

describe('約物のアキの宣言の要素名 (no 20)', () => {
  it('axf:space-start-punctuation・axf:space-end-punctuation (今の名前) も、以前の before・after の名前も読む', () => {
    const doc = (a: string, b: string) =>
      `<fo:root ${NS} ${AXNS}>${PM}<fo:declarations><axf:${a} code="?" space="25%" language="fr"/><axf:${b} code="&#xAB;" space="thin" language="fr"/></fo:declarations>` +
      `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block xml:lang="fr" font-size="12pt">oui? «non</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const want = ['oui', { type: 'inline', padding: { left: 3 }, children: ['?'] }, ' ', { type: 'inline', padding: { right: 2 }, children: ['«'] }, 'non'];
    const r = imp(doc('space-start-punctuation', 'space-end-punctuation'));
    expect((r.document.sequences[0].flow.children[0] as LBlock).children).toEqual(want);
    expect(r.report.unsupported).toEqual({});
    expect((imp(doc('space-before-punctuation', 'space-after-punctuation')).document.sequences[0].flow.children[0] as LBlock).children).toEqual(want);
  });
});

describe('fo:multi-switch (no 25)', () => {
  it('starting-state が show (初期値) の最初の fo:multi-case だけを組む (§6.9.3・§7.23.10)', () => {
    const txt = (cases: string) => JSON.stringify(seq(fo(`<fo:block><fo:multi-switch>${cases}</fo:multi-switch></fo:block>`)).flow.children);
    const two = txt('<fo:multi-case>CASEA</fo:multi-case><fo:multi-case>CASEB</fo:multi-case>');
    expect(two).toContain('CASEA');
    expect(two).not.toContain('CASEB');
    const hideFirst = txt('<fo:multi-case starting-state="hide">CASEA</fo:multi-case><fo:multi-case>CASEB</fo:multi-case>');
    expect(hideFirst).not.toContain('CASEA');
    expect(hideFirst).toContain('CASEB');
    expect(txt('<fo:multi-case starting-state="hide">CASEA</fo:multi-case>')).not.toContain('CASEA');
    expect(first<LBlock>(fo('<fo:multi-switch><fo:multi-case><fo:block>X</fo:block></fo:multi-case></fo:multi-switch>')).type).toBe('block');
  });
});

describe('読み込みの報告 (no 26)', () => {
  it('fo:page-sequence・fo:layout-master-set・fo:declarations の中の読まない要素も数える', () => {
    const xml =
      `<fo:root ${NS} ${AXNS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>` +
      `<fo:flow-map flow-map-name="f"/></fo:layout-master-set>` +
      `<fo:declarations><fo:color-profile src="x.icc" color-profile-name="p"/><axf:document-info name="title" value="T"/><axf:space-start-punctuation code="?" space="thin" language="fr"/></fo:declarations>` +
      `<fo:page-sequence master-reference="m"><fo:title>TITLEX</fo:title><fo:folio-prefix>PFX</fo:folio-prefix><fo:folio-suffix>SFX</fo:folio-suffix>` +
      `<fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow><fo:flow flow-name="other"><fo:block>b</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = imp(xml);
    expect(r.report.unsupported).toEqual({ 'fo:flow-map': 1, 'fo:color-profile': 1, 'fo:title': 1, 'fo:folio-prefix': 1, 'fo:folio-suffix': 1, 'flow:other': 1 });
    // fo:declarations の子の axf:document-info (拡張の置き場所) は読む
    expect(r.document.title).toBe('T');
  });
});
