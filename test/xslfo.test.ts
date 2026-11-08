import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { collapseTableBorders } from '../src/tableBorders';
import { doc, makeEngine, walk } from './helpers';
import type { BlockArea, LBlock, LBlockContainer, LFloat, LFootnote, LImage, LInlineContainer, LPageSequence, LTable, LTableRow } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin-top="10mm" margin-bottom="10mm" margin-left="10mm" margin-right="10mm">
  <fo:region-body margin-top="5mm"/><fo:region-before extent="5mm"/><fo:region-after extent="5mm"/></fo:simple-page-master></fo:layout-master-set>`;
const fo = (flow: string, extra = '', statics = '') =>
  `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m" ${extra}>${statics}<fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
// このファイルのテストは、既定でアンテナハウス互換 (compat: 'antenna') で読む (仕様モードを確かめるテストは compat: 'spec' を渡す)
const imp = (xml: string, o: ImportOptions = {}) => importXslFo(xml, parse, { compat: 'antenna', ...o });
const seq = (xml: string) => imp(xml).document.sequences[0];

describe('XSL-FO 変換: ページ', () => {
  it('ページ寸法と、ページ余白 + region-body 余白の合算', () => {
    const m = seq(fo('<fo:block>a</fo:block>')).master;
    expect(m.width).toBeCloseTo(100);
    expect(m.margins.top).toBeCloseTo(15); // 10 + 5
    expect(m.margins.left).toBeCloseTo(10);
  });

  it('static-content は region の矩形に置く絶対配置コンテナになり、page-number はトークンになる', () => {
    const s = seq(fo('<fo:block>a</fo:block>', '', '<fo:static-content flow-name="xsl-region-after"><fo:block>- <fo:page-number/> -</fo:block></fo:static-content>'));
    const c = s.staticContent![0];
    expect(c.absolutePosition).toBe(true);
    expect(c.top).toBeCloseTo((90 - 5) * 72 / 25.4); // 下端 (100 - 10) から extent 5mm 上
    expect(JSON.stringify(c.children)).toContain('{pageNumber}');
  });

  it('page-sequence-master の条件付き参照 → masterAlternatives (+ 各マスターの static-content)', () => {
    const xml = `<fo:root ${NS}><fo:layout-master-set>
      <fo:simple-page-master master-name="o" page-width="100mm" page-height="100mm"><fo:region-body margin-left="20mm"/></fo:simple-page-master>
      <fo:simple-page-master master-name="e" page-width="100mm" page-height="100mm"><fo:region-body margin-right="20mm"/></fo:simple-page-master>
      <fo:page-sequence-master master-name="s"><fo:repeatable-page-master-alternatives>
        <fo:conditional-page-master-reference master-reference="o" odd-or-even="odd"/>
        <fo:conditional-page-master-reference master-reference="e" odd-or-even="even"/>
      </fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>
      <fo:page-sequence master-reference="s"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const s = seq(xml) as LPageSequence;
    expect(s.masterAlternatives!.map((a) => a.when.oddOrEven)).toEqual(['odd', 'even']);
    expect(s.masterAlternatives![0].master.margins.left).toBeCloseTo(20);
    expect(s.masterAlternatives![1].master.margins.right).toBeCloseTo(20);
  });

  it('リージョンの範囲: 既定 (precedence=false) は start/end が上下端まで通り、before/after がその間に収まる', () => {
    const mk = (prec: string) => `<fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="200mm" margin-top="10mm" margin-bottom="10mm" margin-left="10mm" margin-right="10mm">
      <fo:region-before extent="15mm" background-color="red" ${prec}/><fo:region-after extent="15mm" background-color="red" ${prec}/>
      <fo:region-start extent="8mm" background-color="blue"/><fo:region-end extent="8mm" background-color="blue"/><fo:region-body margin="30mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const mm = (v: number) => (v * 72) / 25.4;
    const rects = (xml: string) => {
      const bgs = (seq(xml).staticContent ?? []).filter((c) => c.layer === 'behind');
      const by = (color: string) => bgs.filter((c) => c.backgroundColor === color).map((c) => ({ x: c.left!, y: c.top!, w: c.width!, h: c.height! }));
      return { red: by('red'), blue: by('blue') };
    };
    // 既定: start/end は y=10mm から高さ 180mm (上下のページ余白の間いっぱい)。before は start/end の間 (幅 100-20-16=64mm)
    const d = rects(mk(''));
    expect(d.blue.map((r) => [r.y, r.h])).toEqual([[mm(10), mm(180)], [mm(10), mm(180)]]);
    expect(d.red[0].x).toBeCloseTo(mm(10 + 8));
    expect(d.red[0].w).toBeCloseTo(mm(64));
    // precedence="true": before/after が全幅 (80mm)、start/end はその間 (高さ 180-30=150mm)
    const t = rects(mk('precedence="true"'));
    expect(t.red[0].x).toBeCloseTo(mm(10));
    expect(t.red[0].w).toBeCloseTo(mm(80));
    expect(t.blue[0].y).toBeCloseTo(mm(25));
    expect(t.blue[0].h).toBeCloseTo(mm(150));
  });

  it('writing-mode="tb-rl" は縦書きに', () => {
    const s = seq(fo('<fo:block>a</fo:block>', 'writing-mode="tb-rl"'));
    expect(s.flow.writingMode).toBe('vertical-rl');
  });
});

describe('XSL-FO 変換: 内容', () => {
  it('FO の既定値 (font-size=10pt・line-height=normal≒1.2・text-align=start) を土台にし、root → page-sequence の順で上書きする', () => {
    const d = seq(fo('<fo:block>a</fo:block>'));
    // ぶら下げは既定で行わない (axf:hanging-punctuation の初期値 none)
    expect([d.fontSize, d.lineHeight, d.textAlign, d.hangingPunctuation]).toEqual([10, 1.2, 'start', false]);
    const root = `<?xml version="1.0"?><fo:root ${NS} font-size="9pt" line-height="1.5" text-align="justify">${PM}<fo:page-sequence master-reference="m" font-size="14pt"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = seq(root);
    expect([r.fontSize, r.lineHeight, r.textAlign]).toEqual([14, 1.5, 'justify']);
    // 組版結果: 指定の無い文字は 10pt で組まれる
    const tree = E.engine.layout(imp(fo('<fo:block>あいう</fo:block>')).document);
    const sizes = new Set<number>();
    walk(tree.sheets[0].page.regionBody, (n) => n.type === 'glyph' && sizes.add(n.fontSize));
    expect([...sizes]).toEqual([10]);
  });

  it('空白の畳み込み・ブロック間の空白除去・長さの単位 (mm/em)・space-before → margin', () => {
    const s = seq(fo('<fo:block font-size="10pt" space-before="1em" space-after="2mm">\n  あ   い\n  <fo:block>x</fo:block>  \n</fo:block>'));
    const b = s.flow.children[0] as LBlock;
    expect(b.fontSize).toBe(10);
    expect(b.margin).toEqual({ top: 10, bottom: (2 * 72) / 25.4 });
    expect(b.children[0]).toBe('あ い');
    expect(b.children.length).toBe(2);
  });

  it('inline-container のルビ表記 → LRuby', () => {
    const r = imp(fo('<fo:block>XMLとは<fo:inline-container><fo:block font-size="0.4em">じょうほう</fo:block><fo:block>情報</fo:block></fo:inline-container>です</fo:block>'));
    expect(r.report.counts.rubies).toBe(1);
    expect(JSON.stringify(r.document)).toContain('"type":"ruby","baseText":"情報","rubyText":"じょうほう"');
  });

  it('rgb-icc の #CMYK は cmyk() のまま、色名は解決、未知の色名は報告', () => {
    const r = imp(fo('<fo:block color="rgb-icc(10,20,30,#CMYK,0.1,0.2,0.3,0.4)" background-color="yellow">a<fo:inline color="nosuchcolor">b</fo:inline></fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.color).toBe('cmyk(0.1,0.2,0.3,0.4)');
    expect(b.backgroundColor).toBe('yellow');
    expect(r.report.unsupported['color:nosuchcolor']).toBe(1);
  });

  it('罫線: 方向 (before/after/start/end) を書字方向に応じた物理辺へ、thin などの幅名を解決', () => {
    const h = imp(fo('<fo:block border-before-style="solid" border-before-width="thin" border-after-style="solid" border-after-width="2pt">a</fo:block>')).document.sequences[0].flow.children[0] as LBlock;
    expect(Object.keys(h.border as object).sort()).toEqual(['bottom', 'top']);
    const v = imp(fo('<fo:block border-before-style="solid" border-before-width="1pt">a</fo:block>', 'writing-mode="tb-rl"')).document.sequences[0].flow.children[0] as LBlock;
    expect(Object.keys(v.border as object)).toEqual(['right']); // 縦書きの before は右
  });

  it('表: 列幅 (固定・比例)・ヘッダ・colspan/rowspan・足りない列定義', () => {
    const r = imp(
      fo(`<fo:table><fo:table-column column-width="30mm"/><fo:table-column column-width="proportional-column-width(2)"/>
        <fo:table-header><fo:table-row><fo:table-cell><fo:block>H</fo:block></fo:table-cell></fo:table-row></fo:table-header>
        <fo:table-body><fo:table-row><fo:table-cell number-rows-spanned="2"><fo:block>a</fo:block></fo:table-cell><fo:table-cell number-columns-spanned="2"><fo:block>b</fo:block></fo:table-cell></fo:table-row>
        <fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`),
    );
    const t = r.document.sequences[0].flow.children[0] as LTable;
    expect(t.columns[0].width).toBeCloseTo((30 * 72) / 25.4);
    expect(t.columns[1].width).toBe('2*');
    expect(t.header!.rows.length).toBe(1);
    const row0 = t.body.rows[0] as LTableRow;
    expect(row0.cells[0].rowSpan).toBe(2);
    expect(row0.cells[1].colSpan).toBe(2);
    // 列定義 2 つに対し 3 列使う行がある → エンジン側で補われ、レイアウトが破綻しない
    const tree = E.engine.layout(r.document);
    expect(tree.sheets.length).toBe(1);
  });

  it('脚注・float・leader・marker・retrieve-marker・list-block', () => {
    const r = imp(
      fo(`<fo:block><fo:marker marker-class-name="c">章</fo:marker>本文<fo:footnote><fo:inline>*1</fo:inline><fo:footnote-body><fo:block>注</fo:block></fo:footnote-body></fo:footnote>
        <fo:leader leader-pattern="dots"/>12</fo:block>
        <fo:float float="end"><fo:block inline-progression-dimension="30mm">図</fo:block></fo:float>
        <fo:list-block provisional-distance-between-starts="20pt"><fo:list-item><fo:list-item-label><fo:block>1.</fo:block></fo:list-item-label><fo:list-item-body><fo:block>項目</fo:block></fo:list-item-body></fo:list-item></fo:list-block>`,
      '', '<fo:static-content flow-name="xsl-region-before"><fo:block><fo:retrieve-marker retrieve-class-name="c" retrieve-position="first-including-carryover"/></fo:block></fo:static-content>'),
    );
    const json = JSON.stringify(r.document);
    expect(json).toContain('"type":"marker","className":"c"');
    expect(json).toContain('"type":"footnote"');
    expect(json).toContain('"label":"*1"');
    expect(json).toContain('"type":"leader","pattern":"dots"');
    expect(json).toContain('"type":"retrieve-marker","className":"c","position":"first-including-carryover"');
    const fl = r.document.sequences[0].flow.children.find((c) => c.type === 'float') as LFloat;
    expect(fl.float).toBe('end');
    expect(fl.width).toBeCloseTo((30 * 72) / 25.4);
    const list = r.document.sequences[0].flow.children.find((c) => c.type === 'table') as LTable;
    expect(list.columns[0].width).toBe(20);
    expect((r.document.sequences[0].flow.children[0] as LBlock).children.some((c) => (c as LFootnote).type === 'footnote')).toBe(true);
    // 組版まで通る
    expect(E.engine.layout(r.document).sheets.length).toBeGreaterThan(0);
  });

  it('未対応要素は黙って捨てずに報告 (text-transform の知らない値・SVG 埋め込み 等)', () => {
    const r = imp(fo('<fo:block><fo:instream-foreign-object/>a<fo:block text-transform="full-width">b</fo:block></fo:block>'));
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:instream-foreign-object'))).toBe(true);
    expect(r.report.unsupported['text-transform:full-width']).toBe(1);
  });

  it('XSL-FO でない入力はエラー', () => {
    expect(() => imp('<html><body/></html>')).toThrow();
  });

  it('先頭に空白・BOM があっても読める', () => {
    expect(imp('﻿  \n' + fo('<fo:block>a</fo:block>')).document.sequences.length).toBe(1);
  });
});

describe('XSL-FO 変換: リージョンの writing-mode / reference-orientation / display-align', () => {
  const xml = `<fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="200mm" margin-top="10mm" margin-bottom="10mm" margin-left="10mm" margin-right="10mm">
    <fo:region-body margin="30mm" reference-orientation="90" writing-mode="tb-rl"/><fo:region-before extent="15mm" display-align="center"/>
    <fo:region-start extent="8mm" writing-mode="tb-rl"/><fo:region-end extent="8mm" reference-orientation="270"/></fo:simple-page-master></fo:layout-master-set>
    <fo:page-sequence master-reference="m" writing-mode="from-page-master-region()" reference-orientation="from-page-master-region()">
      <fo:static-content flow-name="xsl-region-before"><fo:block>前</fo:block></fo:static-content>
      <fo:static-content flow-name="xsl-region-start"><fo:block>左</fo:block></fo:static-content>
      <fo:static-content flow-name="xsl-region-end"><fo:block>右</fo:block></fo:static-content>
      <fo:flow flow-name="xsl-region-body"><fo:block>本文</fo:block></fo:flow></fo:page-sequence></fo:root>`;
  const mm = (v: number) => (v * 72) / 25.4;

  it('region-body の writing-mode / reference-orientation は本文の縦書き・本文領域の回転になる', () => {
    const s = seq(xml);
    expect(s.flow.writingMode).toBe('vertical-rl');
    expect(s.master.bodyRotation).toBe(90);
  });

  it('各リージョン自身の writing-mode・回転・display-align が static-content の箱に反映される', () => {
    const sc = seq(xml).staticContent!;
    const before = sc.find((c) => JSON.stringify(c.children).includes('前'))!;
    const start = sc.find((c) => JSON.stringify(c.children).includes('左'))!;
    const end = sc.find((c) => JSON.stringify(c.children).includes('右'))!;
    // 本文が縦書きでも、region-before は自分の指定が無ければ横書き。display-align=center → 中央
    expect(before.writingMode).toBe('horizontal-tb');
    expect(before.blockAlign).toBe('center');
    // region-start は tb-rl (回転なし): 幅 8mm × 高さ = 左右の間...(start/end は上下端まで通る = 180mm)
    expect(start.writingMode).toBe('vertical-rl');
    expect(start.rotation).toBeUndefined();
    expect([start.width, start.height]).toEqual([mm(8), mm(180)]);
    // region-end は 270° 回転: 回転前の幅 = 領域の高さ (180mm)、高さ = 領域の幅 (8mm)。位置は外接矩形の左上
    expect(end.rotation).toBe(270);
    expect(end.width).toBeCloseTo(mm(180));
    expect(end.height).toBeCloseTo(mm(8));
    expect(end.left).toBeCloseTo(mm(100 - 10 - 8));
    expect(end.top).toBeCloseTo(mm(10));
  });

  it('block-container / inline-container の reference-orientation', () => {
    const r = imp(fo('<fo:block-container reference-orientation="90" break-before="page"><fo:block>a</fo:block></fo:block-container><fo:block>x<fo:inline-container reference-orientation="-90" writing-mode="tb-rl"><fo:block>縦</fo:block></fo:inline-container></fo:block>'));
    const c = r.document.sequences[0].flow.children[0] as LBlockContainer;
    expect(c.rotation).toBe(90);
    expect(c.breakBefore).toBe('page');
    const ic = ((r.document.sequences[0].flow.children[1] as LBlock).children[1]) as LInlineContainer;
    expect(ic.rotation).toBe(270); // -90 は 270 に正規化
    expect(ic.writingMode).toBe('vertical-rl');
    expect(imp(fo('<fo:block-container reference-orientation="45"><fo:block>a</fo:block></fo:block-container>')).report.unsupported['reference-orientation:45']).toBe(1);
  });
});

describe('XSL-FO 変換: 画像・inline-container・背景色', () => {
  it('段組のページ: flow の中の要素の幅の百分率は 1 段の幅、span="all" のブロックは本文の幅', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm">
      <fo:region-body column-count="2" column-gap="10mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block-container span="all" inline-progression-dimension="50%"><fo:block>a</fo:block></fo:block-container><fo:block-container inline-progression-dimension="50%"><fo:block>b</fo:block></fo:block-container></fo:flow></fo:page-sequence></fo:root>`;
    const kids = imp(xml).document.sequences[0].flow.children as LBlockContainer[];
    const mm = (v: number) => (v * 72) / 25.4;
    expect(kids[0].width).toBeCloseTo(mm(40));
    expect(kids[1].width).toBeCloseTo(mm(17.5));
  });

  it('inline-progression-dimension.minimum は領域より広ければその幅、block-progression-dimension.minimum は高さの下限', () => {
    const c = seq(fo('<fo:block-container inline-progression-dimension.minimum="100mm" block-progression-dimension.minimum="2em" font-size="10pt"><fo:block>a</fo:block></fo:block-container>')).flow.children[0] as LBlockContainer;
    expect(c.width).toBeCloseTo((100 * 72) / 25.4);
    expect(c.minBlockSize).toBeCloseTo(20);
    const narrow = seq(fo('<fo:block-container inline-progression-dimension.minimum="10mm"><fo:block>a</fo:block></fo:block-container>')).flow.children[0] as LBlockContainer;
    expect(narrow.width).toBeUndefined();
  });

  it('段組のブロックコンテナの中の画像の width の百分率は、1 段の幅に対する割合', () => {
    const r = imp(fo('<fo:block-container column-count="2" column-gap="10mm"><fo:block><fo:external-graphic src="a.png" content-width="scale-down-to-fit" width="50%"/></fo:block></fo:block-container>'));
    const c = r.document.sequences[0].flow.children[0] as LBlockContainer;
    const img = (c.children[0] as LBlock).children[0] as LImage;
    // 本文の幅 80mm、段の幅 (80 − 10) / 2 = 35mm の 50%
    expect(img.width).toBeCloseTo((17.5 * 72) / 25.4);
  });

  it('external-graphic → LImage (url() の包みを外し、content-width/height・scale-to-fit を解釈) と画像一覧', () => {
    const r = imp(fo(`<fo:block><fo:external-graphic src="url('img/a.png')" content-height="12mm"/><fo:external-graphic src="b.svg" content-width="scale-to-fit" width="9cm" height="6cm"/></fo:block>`));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    const [a, c] = b.children as LImage[];
    expect(a).toMatchObject({ type: 'image', src: 'img/a.png' });
    expect(a.height).toBeCloseTo((12 * 72) / 25.4);
    expect(a.width).toBeUndefined();
    // content-width だけ scale-to-fit (content-height は auto): 枠 (9cm × 6cm) は残し、画像の幅を枠に合わせる (高さは縦横の比)
    expect(c.width).toBeCloseTo((90 * 72) / 25.4);
    expect(c.height).toBeUndefined();
    expect(c.viewport!.width).toBeCloseTo((90 * 72) / 25.4, 3);
    expect(c.viewport!.height).toBeCloseTo((60 * 72) / 25.4, 3);
    // 両方 scale-to-fit でも、枠 (9cm × 6cm) はそのまま。画像は枠に収まる大きさ (§7.15.4・§7.15.5。縦横の比は組むときに保つ)
    const both = (imp(fo('<fo:block><fo:external-graphic src="b.svg" content-width="scale-to-fit" content-height="scale-to-fit" width="9cm" height="6cm"/></fo:block>')).document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect(both.width).toBeCloseTo((90 * 72) / 25.4, 3);
    expect(both.height).toBeCloseTo((60 * 72) / 25.4, 3);
    expect(both.viewport!.width).toBeCloseTo((90 * 72) / 25.4, 3);
    expect(both.viewport!.height).toBeCloseTo((60 * 72) / 25.4, 3);
    // scale-down-to-fit・scale-up-to-fit は、倍率の制限として渡す
    const down = (imp(fo('<fo:block><fo:external-graphic src="b.svg" content-width="scale-down-to-fit" content-height="scale-up-to-fit" width="9cm" height="6cm"/></fo:block>')).document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect(down.fitLimit).toEqual({ w: 'down', h: 'up' });
    expect(r.report.images).toEqual(['img/a.png', 'b.svg']);
  });

  it('inline-container: ルビ以外は LInlineContainer (背景色・寸法つき)', () => {
    const r = imp(fo('<fo:block>前<fo:inline-container background-color="silver" inline-progression-dimension="30mm"><fo:block>1行目</fo:block><fo:block>2行目</fo:block></fo:inline-container>後</fo:block>'));
    const ic = (r.document.sequences[0].flow.children[0] as LBlock).children[1] as LInlineContainer;
    expect(ic.type).toBe('inline-container');
    expect(ic.backgroundColor).toBe('silver');
    expect(ic.width).toBeCloseTo((30 * 72) / 25.4);
    expect(ic.children.length).toBe(2);
    expect(r.report.unsupported['fo:inline-container (ルビ以外)']).toBeUndefined();
  });

  it('背景色: ページ全体 (axf:background-color)・リージョン (背面に敷く)・table-header/body → セル', () => {
    const xml = `<fo:root ${NS} xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set>
      <fo:simple-page-master master-name="m" axf:background-color="#85DAE7" page-width="100mm" page-height="100mm" margin-top="10mm" margin-left="10mm" margin-right="10mm" margin-bottom="10mm">
        <fo:region-body background-color="lime" margin-top="5mm"/><fo:region-before extent="5mm" background-color="pink"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:table><fo:table-header background-color="#DDDDDD"><fo:table-row><fo:table-cell><fo:block>h</fo:block></fo:table-cell></fo:table-row></fo:table-header>
      <fo:table-body background-color="#EEEEEE"><fo:table-row><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:flow></fo:page-sequence></fo:root>`;
    const s = seq(xml);
    expect(s.master.backgroundColor).toBe('#85DAE7');
    const bgs = (s.staticContent ?? []).filter((c) => c.layer === 'behind');
    expect(bgs.map((c) => c.backgroundColor).sort()).toEqual(['lime', 'pink']);
    const t = s.flow.children[0] as LTable;
    expect(t.header!.rows[0].cells[0].backgroundColor).toBe('#DDDDDD');
    expect(t.body.rows[0].cells[0].backgroundColor).toBe('#EEEEEE');
    // 組版: 背面の領域は behindAreas に入り、前面の absoluteAreas には入らない
    const tree = E.engine.layout({ type: 'document', sequences: [s] });
    expect(tree.sheets[0].page.behindAreas.length).toBe(2);
    expect(tree.sheets[0].page.absoluteAreas.length).toBe(0);
  });
});

describe('本文の fo:page-number (XSL 1.1 §6.6.10)', () => {
  it('それを含むページの番号になる (2 ページ目の段落は 2)', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `<fo:block>行${i}</fo:block>`).join('');
    const xml = fo(`<fo:block>p<fo:page-number/></fo:block>${filler}<fo:block keep-with-next.within-page="always">q<fo:page-number/></fo:block><fo:block>end</fo:block>`);
    const tree = E.engine.layout(imp(xml).document);
    const texts = tree.sheets.map((sh) => {
      const g: string[] = [];
      walk(sh.page.regionBody as unknown as BlockArea, (n) => n.type === 'glyph' && g.push(n.text));
      return g.join('');
    });
    expect(texts[0]).toContain('p1');
    const last = texts.findIndex((t) => /q\d/.test(t));
    expect(texts[last]).toContain(`q${last + 1}`);
    expect(texts.join('')).not.toContain('{pageNumber}');
  });
});

describe('ページ番号参照 (fo:page-number-citation)', () => {
  it('参照先ブロックのページ番号に置き換わる (組み直して収束する)', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `<fo:block>行${i}</fo:block>`).join('');
    const xml = fo(`<fo:block>目次 <fo:page-number-citation ref-id="ch"/></fo:block>${filler}<fo:block id="ch">章の見出し</fo:block>`);
    const tree = E.engine.layout(imp(xml).document);
    expect(tree.sheets.length).toBeGreaterThan(1);
    const g: string[] = [];
    walk((tree.sheets[0].page.regionBody.children[0] as BlockArea), (n) => n.type === 'glyph' && g.push(n.text));
    const text = g.join('');
    const total = tree.sheets.length;
    expect(text).toMatch(/^目次 \d+$/);
    expect(Number(text.replace('目次 ', ''))).toBeGreaterThan(1);
    expect(Number(text.replace('目次 ', ''))).toBeLessThanOrEqual(total);
    expect(tree.warnings).toEqual([]);
  });

  it('参照先が無ければ ? と警告', () => {
    const tree = E.engine.layout(imp(fo('<fo:block><fo:page-number-citation ref-id="none"/></fo:block>')).document);
    expect(tree.warnings.join()).toContain('none');
  });
});

describe('変換 → 組版 → Area の整合', () => {
  it('絶対配置の block-container は本文領域の原点を足してページ基準になる', () => {
    const r = imp(fo('<fo:block-container absolute-position="absolute" top="10mm" left="5mm" width="30mm" height="20mm"><fo:block>x</fo:block></fo:block-container>'));
    const c = r.document.sequences[0].flow.children[0] as LBlockContainer;
    expect(c.absolutePosition).toBe(true);
    // 本文領域の左上 = (10mm, 15mm)
    expect(c.left).toBeCloseTo(((5 + 10) * 72) / 25.4);
    expect(c.top).toBeCloseTo(((10 + 15) * 72) / 25.4);
  });

  it('width・height は内容の寸法で、枠は top・left の外側へ出る', () => {
    const r = imp(fo('<fo:block-container absolute-position="absolute" top="10mm" left="5mm" width="30mm" height="20mm" border="2pt solid black" padding="1pt"><fo:block>x</fo:block></fo:block-container>'));
    const c = r.document.sequences[0].flow.children[0] as LBlockContainer;
    expect(c.boxSizing).toBeUndefined();
    expect(c.width).toBeCloseTo((30 * 72) / 25.4);
    expect(c.left).toBeCloseTo(((5 + 10) * 72) / 25.4 - 3);
    expect(c.top).toBeCloseTo(((10 + 15) * 72) / 25.4 - 3);
  });
});

describe('XSL-FO 変換: footnote-separator', () => {
  const sep = (leader: string) =>
    seq(fo('<fo:block>a</fo:block>', '', `<fo:static-content flow-name="xsl-footnote-separator"><fo:block>${leader}</fo:block></fo:static-content>`));

  // leader の区切りは内容として組む (点はフォントの字、区切りのブロックの行の中)
  const leaderOf = (s: ReturnType<typeof sep>) => {
    const content = (s.footnotes!.separator as unknown as { content: Array<{ children: Array<Record<string, unknown>> }> }).content;
    return content[0].children.find((c) => c.type === 'leader')!;
  };

  it('leader-pattern=dots は点線、長さは本文幅の割合', () => {
    const ld = leaderOf(sep('<fo:leader leader-length="30%" leader-pattern="dots"/>'));
    expect(ld.pattern).toBe('dots');
    // 百分率は、組むときに置く領域の寸法から決める (§7.22.4)
    expect(ld.lengthPct).toEqual({ minimum: 0.3, optimum: 0.3, maximum: 0.3 });
  });

  it('leader-pattern=rule は実線 (太さ指定を反映)', () => {
    const ld = leaderOf(sep('<fo:leader leader-length="50%" leader-pattern="rule" rule-thickness="2pt"/>'));
    expect(ld.pattern).toBe('rule');
    expect(ld.ruleThickness).toBe(2);
  });

  it('画像や罫線だけの区切りも、内容としてそのまま組む (I-05)', () => {
    const img = sep('<fo:external-graphic src="sep.png"/>').footnotes!.separator as { content?: unknown[] };
    expect(img.content?.length).toBe(1);
    const ruled = sep('').footnotes;
    expect(ruled?.separator).toBeUndefined();
    const border = seq(fo('<fo:block>a</fo:block>', '', '<fo:static-content flow-name="xsl-footnote-separator"><fo:block border-top="1pt dashed red" width="30mm"/></fo:static-content>')).footnotes!.separator as { content?: unknown[] };
    expect(border.content?.length).toBe(1);
  });
});

describe('XSL-FO 変換: 段組', () => {
  it('region-body の column-count / column-gap → PageMaster.columns、span="all" → LBlock.span', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm">
      <fo:region-body column-count="2" column-gap="10mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block span="all">t</fo:block><fo:block>b</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = imp(xml);
    const s = r.document.sequences[0];
    expect(s.master.columns).toEqual({ count: 2, gap: 10 });
    expect((s.flow.children[0] as LBlock).span).toBe('all');
    expect(JSON.stringify(r.report.unsupported)).not.toContain('column');
  });
  it('line-height の成分: .precedence・.conditionality、一つの値の line-height は force・retain に戻す、.minimum・.maximum で行送りを収める (§7.16.4)', () => {
    const b = (attrs: string) => seq(fo(`<fo:block font-size="10pt" ${attrs}>a</fo:block>`)).flow.children[0] as LBlock;
    expect(b('line-height.precedence="2"').lineHeightPrecedence).toBe(2);
    expect(b('line-height="1.5"').lineHeightPrecedence).toBe('force');
    expect(b('line-height.conditionality="discard"').lineHeightDiscard).toBe(true);
    expect(b('line-height="1.5"').lineHeightDiscard).toBe(false);
    // 既定の行送り (10pt × 1.2 = 12pt) を下限・上限に収める
    expect(b('line-height.minimum="20pt"').lineHeightPt).toBeCloseTo(20, 3);
    expect(b('line-height.maximum="1.0"').lineHeightPt).toBeCloseTo(10, 3);
    expect(b('line-height.minimum="5pt"').lineHeightPt).toBeUndefined();
  });

  it('入れ子のブロックの span="all": 互換モードは flow の直下へ出す。仕様モードは出さない (span は flow の直下にだけ効く。§7.21.4)', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm">
      <fo:region-body column-count="2"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><fo:block span="all">t</fo:block><fo:block>b</fo:block></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    expect((imp(xml).document.sequences[0].flow.children[0] as LBlock).span).toBe('all');
    expect((imp(xml, { compat: 'spec' }).document.sequences[0].flow.children[0] as LBlock).span).toBeUndefined();
  });

  it('入れ子の span="all" を出すとき、親の space-before は出した子の前に移し、残りの部分には付けない', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm">
      <fo:region-body column-count="2"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block space-before="6pt"><fo:block span="all" space-before="2pt">t</fo:block><fo:block>b</fo:block></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const [lead, rest] = imp(xml).document.sequences[0].flow.children as LBlock[];
    expect((lead.margin as { top?: number }).top).toBe(6);
    expect((rest.margin as { top?: number } | undefined)?.top ?? 0).toBe(0);
  });
});

describe('XSL-FO 変換: font-style / baseline-shift', () => {
  it('font-style=italic は fontStyle、baseline-shift=super/sub/長さ は baselineShift になり、未対応として数えない', () => {
    const r = imp(fo('<fo:block font-style="italic">a<fo:inline baseline-shift="super" font-size="75%">1</fo:inline><fo:inline baseline-shift="-2pt">2</fo:inline><fo:inline baseline-shift="sub">3</fo:inline></fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontStyle).toBe('italic');
    const inl = b.children.filter((c) => typeof c !== 'string') as Array<{ baselineShift?: unknown }>;
    expect(inl.map((i) => i.baselineShift)).toEqual(['super', -2, 'sub']);
    expect(Object.keys(r.report.unsupported).join()).not.toMatch(/font-style|baseline-shift/);
  });

  it('上付きは行内で持ち上がり、斜体のグリフは italic を持つ', () => {
    const t = E.engine.layout(doc([{ type: 'block', fontStyle: 'italic', children: ['あ', { type: 'inline', baselineShift: 'super', children: ['い'] }] }] as never));
    const gs: Array<{ text: string; y: number; italic?: boolean; baselineY: number }> = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') gs.push({ text: a.text, y: a.y, baselineY: a.baselineY, italic: a.italic });
    });
    const a = gs.find((g) => g.text === 'あ')!;
    const i = gs.find((g) => g.text === 'い')!;
    expect(a.italic).toBe(true);
    expect(i.y).toBeLessThan(a.y); // 上げた分だけ上 (y は下向き)
  });
});

describe('XSL-FO 変換: 区切り領域の内容 (footnote-separator / before-float-separator)', () => {
  const statics = `<fo:static-content flow-name="xsl-before-float-separator"><fo:block background-color="#FEAAFE">前方区切り</fo:block></fo:static-content>
    <fo:static-content flow-name="xsl-footnote-separator"><fo:block background-color="#FEAAFE">脚注区切り</fo:block></fo:static-content>`;

  it('文字・背景色つきの区切りは内容として取り込む (線に置き換えない)', () => {
    const s = seq(fo('<fo:block>a</fo:block>', '', statics));
    expect(s.beforeFloatSeparator).toHaveLength(1);
    const sep = s.footnotes!.separator as { content?: unknown[] };
    expect(sep.content).toHaveLength(1);
  });

  it('前方 float の下に区切りが入り、脚注の前にも区切りの内容が出る', () => {
    const s = seq(
      fo(
        '<fo:block>本文<fo:float float="before"><fo:block background-color="#00EEAA">前方フロート</fo:block></fo:float>です<fo:footnote><fo:inline>(1)</fo:inline><fo:footnote-body><fo:block>脚注本体</fo:block></fo:footnote-body></fo:footnote></fo:block>',
        '',
        statics,
      ),
    );
    const t = E.engine.layout({ type: 'document', sequences: [s] });
    const found: Array<{ bg: string; y: number; h: number }> = [];
    const visit = (a: BlockArea, oy: number) => {
      const y = oy + a.y;
      if (a.backgroundColor) found.push({ bg: a.backgroundColor.toLowerCase(), y, h: a.height });
      for (const c of (a as unknown as { children?: BlockArea[] }).children ?? []) if (c.type === 'block') visit(c, y);
    };
    for (const c of t.sheets[0].page.regionBody.children as BlockArea[]) visit(c, 0);
    const fl = found.find((x) => x.bg === '#00eeaa')!;
    const bsep = found.filter((x) => x.bg === '#feaafe').sort((a, b) => a.y - b.y)[0];
    expect(fl && bsep).toBeTruthy();
    expect(bsep.y).toBeGreaterThanOrEqual(fl.y + fl.h - 0.5); // float の直下
    let n = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'block' && a.backgroundColor?.toLowerCase() === '#feaafe') n++;
    });
    expect(n).toBe(2); // 前方区切り + 脚注区切り
  });
});

describe('XSL-FO 変換: keep-with-next / text-align-last / 罫線の線種', () => {
  it('keep-with-next・keep-with-previous (always / 1 以上の整数) と text-align-last を変換し、未対応に数えない', () => {
    const r = imp(fo('<fo:block keep-with-next.within-page="always" text-align-last="center">a</fo:block><fo:block keep-with-previous="1" text-align-last="end">b</fo:block><fo:block keep-with-next="auto">c</fo:block>'));
    const [a, b, c] = r.document.sequences[0].flow.children as LBlock[];
    expect(a.keepWithNext).toBe(true);
    expect(a.textAlignLast).toBe('center');
    expect(b.keepWithPrevious).toBe(true);
    expect(b.textAlignLast).toBe('end');
    expect(c.keepWithNext).toBeUndefined();
    expect(Object.keys(r.report.unsupported).join()).not.toMatch(/keep-with|text-align-last/);
  });

  it('border-style の線種を保持する (未対応として数えない)', () => {
    const r = imp(fo('<fo:block border-top="1pt dotted #000000" border-bottom-style="double" border-bottom-width="3pt" border-bottom-color="#ff0000">a</fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    const border = b.border as { top?: { style?: string }; bottom?: { style?: string; width: number } };
    expect(border.top?.style).toBe('dotted');
    expect(border.bottom?.style).toBe('double');
    expect(Object.keys(r.report.unsupported).join()).not.toMatch(/border-style/);
  });
});

describe('XSL-FO 変換: start-indent / end-indent は内容端の位置 (border・padding は外側に付く)', () => {
  const mmPt = (v: number) => (v * 72) / 25.4;
  const first = (xml: string) => (seq(fo(xml)).flow.children[0] as LBlock).children[0] as LBlock;

  it('start-indent=20mm・border 3mm・padding 2mm → margin-left = 20mm − 5mm、end-indent=0 → margin-right = −5mm', () => {
    const b = first('<fo:block><fo:block start-indent="20mm" end-indent="0mm" padding="2mm" border-style="solid" border-width="3mm" border-color="#DDFFDD">a</fo:block></fo:block>');
    const m = b.margin as { left: number; right: number };
    expect(m.left).toBeCloseTo(mmPt(15), 1);
    expect(m.right).toBeCloseTo(-mmPt(5), 1);
  });

  it('margin-left 指定のブロックの子の start-indent は、親の border・padding・margin を含めた位置から測る', () => {
    const outer = first('<fo:block><fo:block margin-left="10mm" padding="2mm" border-style="solid" border-width="3mm" border-color="#000000"><fo:block start-indent="20mm">a</fo:block></fo:block></fo:block>');
    const inner = outer.children[0] as LBlock;
    // 親の内容端は 10+3+2 = 15mm → 子の margin-left は 20 − 15 = 5mm
    expect((inner.margin as { left: number }).left).toBeCloseTo(mmPt(5), 1);
  });
});

describe('XSL-FO 変換: letter-spacing を指定した行は両端揃えにしない', () => {
  it('letter-spacing=1mm → fixedLetterSpacing、normal で解除', () => {
    const r = imp(fo('<fo:block letter-spacing="1mm">a<fo:block letter-spacing="normal">b</fo:block></fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fixedLetterSpacing).toBe(true);
    expect(b.letterSpacing).toBeCloseTo((1 * 72) / 25.4);
    expect((b.children[1] as LBlock).fixedLetterSpacing).toBe(false);
  });

  it('組版: justify でも letter-spacing 指定の行は右端まで伸ばさず、指定なしは伸ばす', () => {
    const mk = (extra: string) => E.engine.layout(imp(fo(`<fo:block ${extra}>${'あ'.repeat(30)}</fo:block>`)).document);
    const right = (t: ReturnType<typeof E.engine.layout>) => {
      let r = 0;
      const visit = (a: never, ox: number) => {
        const x = ox + (a as { x: number }).x;
        if ((a as { type: string }).type === 'glyph') r = Math.max(r, x + (a as { width: number }).width);
        for (const c of ((a as { children?: never[] }).children ?? [])) visit(c, x);
      };
      // 1 行目だけを見る (最終行ではない行)
      const first = (t.sheets[0].page.regionBody.children[0] as unknown as { children: never[] }).children[0];
      visit(first, 0);
      return r;
    };
    const body = (80 * 72) / 25.4;
    expect(right(mk('text-align="justify"'))).toBeCloseTo(body, 0);
    expect(right(mk('text-align="justify" letter-spacing="0.5pt"'))).toBeLessThan(body - 1);
  });
});

describe('XSL-FO 変換: letter-spacing.maximum', () => {
  it('maximum が optimum より大きいときは、その差まで字間を広げて両端揃えにする', () => {
    const mk = (extra: string) => E.engine.layout(imp(fo(`<fo:block text-align="justify" letter-spacing="0.5pt" ${extra}>${'あ'.repeat(30)}</fo:block>`)).document);
    const right = (t: ReturnType<typeof E.engine.layout>) => {
      let r = 0;
      const visit = (a: never, ox: number) => {
        const x = ox + (a as { x: number }).x;
        if ((a as { type: string }).type === 'glyph') r = Math.max(r, x + (a as { width: number }).width);
        for (const c of ((a as { children?: never[] }).children ?? [])) visit(c, x);
      };
      visit((t.sheets[0].page.regionBody.children[0] as unknown as { children: never[] }).children[0], 0);
      return r;
    };
    const body = (80 * 72) / 25.4;
    expect(right(mk(''))).toBeLessThan(body - 1);
    // 行末の字の後ろの letter-spacing (0.5pt) は行の幅に数えないので、字の箱 (字間を含む) は右端からその分だけ出る
    expect(right(mk('letter-spacing.maximum="6pt"'))).toBeCloseTo(body + 0.5, 0);
    // 広げる上限が小さすぎるときは、右端まで届かない
    expect(right(mk('letter-spacing.maximum="0.6pt"'))).toBeLessThan(body - 1);
  });
});

describe('XSL-FO 変換: 空の fo:inline の inline-progression-dimension', () => {
  it('幅 2em・背景色つきの空の inline → 背景色つきの 2em の空白として行に入る', () => {
    const r = imp(fo('<fo:block font-size="10pt">あ<fo:inline inline-progression-dimension="2em" background-color="yellow"/>い</fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    const inl = b.children.find((c) => typeof c !== 'string') as { type: string; width?: number; backgroundColor?: string };
    expect(inl.width).toBeCloseTo(20);
    const t = E.engine.layout(r.document);
    const found: Array<{ bg: string; x: number; w: number }> = [];
    const visit = (a: never, ox: number) => {
      const x = ox + (a as { x: number }).x;
      const o = a as { backgroundColor?: string; width: number; children?: never[] };
      if ((o.backgroundColor?.toLowerCase() === 'yellow' || o.backgroundColor?.toLowerCase() === '#ffff00')) found.push({ bg: o.backgroundColor, x, w: o.width });
      for (const c of o.children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c as never, 0);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].w).toBeCloseTo(20, 0);
    expect(found[0].x).toBeCloseTo(10, 0); // 「あ」(10pt) の直後
  });
});

describe('XSL-FO 変換: content-width / content-height の百分率は画像本来の大きさに対する倍率', () => {
  it('60% → widthScale / heightScale (width / height にはしない)', () => {
    const r = imp(fo('<fo:block><fo:external-graphic src="a.png" content-width="60%" content-height="60%"/></fo:block>'));
    const img = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect(img.widthScale).toBeCloseTo(0.6);
    expect(img.heightScale).toBeCloseTo(0.6);
    expect(img.width).toBeUndefined();
  });
  it('百分率と枠 (width・height) が両方あれば、枠はそのまま、画像は本来の大きさの倍率 (枠の大きさにしない)', () => {
    const r = imp(fo('<fo:block><fo:external-graphic src="a.png" width="9cm" height="6cm" content-width="100%" content-height="100%" display-align="center" text-align="center"/></fo:block>'));
    const img = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect(img.width).toBeUndefined();
    expect(img.height).toBeUndefined();
    expect(img.widthScale).toBe(1);
    expect(img.viewport!.width).toBeCloseTo((90 * 72) / 25.4, 3);
    expect(img.viewport).toMatchObject({ align: 'center', blockAlign: 'center' });
  });
});

describe('XSL-FO 変換: 長さの式 (20mm+18pt+30pt)', () => {
  it('足し算・引き算の式を長さとして解釈する (space-before など)', () => {
    const r = imp(fo('<fo:block space-before="20mm+18pt+30pt" margin-left="1em - 2pt" font-size="10pt">a</fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    const m = b.margin as { top: number; left: number };
    expect(m.top).toBeCloseTo((20 * 72) / 25.4 + 18 + 30, 1);
    expect(m.left).toBeCloseTo(8, 1);
  });
});

describe('XSL-FO 変換: keep-together.within-column', () => {
  it('within-page と同じく keepTogether になる', () => {
    const r = imp(fo('<fo:block keep-together.within-column="always">a</fo:block><fo:block keep-together.within-page="always">b</fo:block><fo:block keep-together.within-column="auto">c</fo:block>'));
    const [a, b, c] = r.document.sequences[0].flow.children as LBlock[];
    expect([a.keepTogether, b.keepTogether, c.keepTogether]).toEqual([true, true, undefined]);
  });
});

describe('XSL-FO 変換: 表の border-collapse・display-align、font-size のキーワード、罫線の既定の太さ', () => {
  it('flow の直下のブロックの先頭の span="all" の子は、外へ出して段をまたがせる', () => {
    const r = imp(fo('<fo:block break-before="page"><fo:block span="all">見出し</fo:block><fo:block>本文</fo:block></fo:block>'));
    const ch = r.document.sequences[0].flow.children as LBlock[];
    expect(ch.map((c) => [c.span, c.breakBefore])).toEqual([['all', 'page'], [undefined, undefined]]);
  });
  it('list-item-body の start-indent (長さ) は、ラベルの列の幅になる', () => {
    const r = imp(fo('<fo:list-block><fo:list-item><fo:list-item-label><fo:block>emf</fo:block></fo:list-item-label><fo:list-item-body start-indent="4em"><fo:block>説明</fo:block></fo:list-item-body></fo:list-item></fo:list-block>'));
    const t = r.document.sequences[0].flow.children[0] as LTable;
    expect(t.columns[0].width).toBeCloseTo(40);
  });
  it('table-and-caption 自身の文字の大きさ・余白は、見出しと表を包むブロックにする', () => {
    const r = imp(fo('<fo:table-and-caption font-size="12pt" space-before="1em"><fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:table-and-caption>'));
    const w = r.document.sequences[0].flow.children[0] as LBlock;
    expect([w.type, w.fontSize, (w.children[0] as LTable).type]).toEqual(['block', 12, 'table']);
  });
  it('external-graphic の罫線・余白は画像の外側の箱になる', () => {
    const r = imp(fo('<fo:block><fo:external-graphic src="a.png" width="20pt" height="10pt" border="1pt dotted black" padding="2pt"/></fo:block>'));
    const img = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect([img.border !== undefined, img.padding]).toEqual([true, { top: 2, right: 2, bottom: 2, left: 2 }]);
  });
  it('太さだけを指定した要素は、祖先の font-family で書体を選び直す', () => {
    const calls: Array<[string[], boolean]> = [];
    imp(fo('<fo:block font-family="ＭＳ ゴシック"><fo:block font-weight="bold">a</fo:block></fo:block>'), { mapFont: (f, b) => (calls.push([f, b]), undefined) });
    expect(calls).toContainEqual([['ＭＳ ゴシック'], true]);
  });
  it('axf:space-before-punctuation など: 言語が合う文字列で、記号の前後に行内の余白でアキを入れる', () => {
    const NSX = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const doc = (lang: string) =>
      `<fo:root ${NSX}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:declarations><axf:space-before-punctuation code="?" space="25%" language="fr"/><axf:space-after-punctuation code="&#xAB;" space="thin" language="fr"/></fo:declarations>` +
      `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block xml:lang="${lang}" font-size="12pt">oui? «non</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const fr = (imp(doc('fr')).document.sequences[0].flow.children[0] as LBlock).children;
    expect(fr).toEqual(['oui', { type: 'inline', padding: { left: 3 }, children: ['?'] }, ' ', { type: 'inline', padding: { right: 2 }, children: ['«'] }, 'non']);
    expect((imp(doc('en')).document.sequences[0].flow.children[0] as LBlock).children).toEqual(['oui? «non']);
  });
  it('table-caption は自身の書式のブロック、table-column の column-number は列の位置', () => {
    const r = imp(fo('<fo:table-and-caption><fo:table-caption text-align="center" font-size="17pt"><fo:block>見出し</fo:block></fo:table-caption><fo:table table-layout="fixed"><fo:table-column column-number="1" column-width="20mm"/><fo:table-column column-number="3" column-width="30mm"/><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:table-and-caption>'));
    const [cap, t] = r.document.sequences[0].flow.children as [LBlock, LTable];
    expect([cap.type, cap.textAlign, cap.fontSize]).toEqual(['block', 'center', 17]);
    expect(t.columns.map((c) => (typeof c.width === 'number' ? Math.round(c.width) : c.width))).toEqual([57, undefined, 85]);
  });
  const tableXml = (attrs = '', rowAttrs = '') =>
    `<fo:table ${attrs}><fo:table-body><fo:table-row ${rowAttrs}><fo:table-cell border="solid 1pt black"><fo:block>a</fo:block></fo:table-cell><fo:table-cell display-align="after"><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;

  it('border-collapse の初期値は collapse、separate の指定はそのまま', () => {
    expect((seq(fo(tableXml())).flow.children[0] as LTable).borderCollapse).toBe('collapse');
    expect((seq(fo(tableXml('border-collapse="separate"'))).flow.children[0] as LTable).borderCollapse).toBe('separate');
  });

  it('display-align はセル → 行 → 表の順に継承して、セルの blockAlign になる', () => {
    const t = seq(fo(tableXml('', 'display-align="center"'))).flow.children[0] as LTable;
    const [a, b] = t.body.rows[0].cells;
    expect(a.blockAlign).toBe('center');
    expect(b.blockAlign).toBe('end');
  });

  it('font-size のキーワードは medium (既定 10pt) から 1.2 倍ずつ', () => {
    const r = imp(fo('<fo:block font-size="small">a</fo:block><fo:block font-size="large">b</fo:block><fo:block font-size="medium">c</fo:block>'));
    const [s, l, m] = r.document.sequences[0].flow.children as LBlock[];
    expect(s.fontSize).toBeCloseTo(10 / 1.2);
    expect(l.fontSize).toBeCloseTo(12);
    expect(m.fontSize).toBeCloseTo(10);
  });

  it('線種だけ指定した罫線の太さは medium (互換モード 3pt、仕様モード 2.25pt)。thin・thick も同じく', () => {
    const w = (attrs: string, compat?: 'spec') =>
      ((imp(fo(`<fo:block ${attrs}>a</fo:block>`), compat ? { compat } : {}).document.sequences[0].flow.children[0] as LBlock).border as { top: { width: number } }).top.width;
    expect(w('border-style="solid"')).toBeCloseTo(3);
    expect(w('border-style="solid"', 'spec')).toBeCloseTo(2.25);
    expect([w('border="thin solid"'), w('border="thick solid"')]).toEqual([1, 5]);
  });
});

describe('XSL-FO 変換: line-height の継承 (§7.16.4)', () => {
  it('長さで指定した line-height は、子の文字サイズが違っても同じ長さで継承される。数値は比のまま', () => {
    const tree = (lh: string) => E.engine.layout(imp(fo(`<fo:block line-height="${lh}" font-size="10pt"><fo:block font-size="20pt">あ<fo:block/>い</fo:block></fo:block>`)).document);
    const linePitch = (t: ReturnType<typeof tree>) => {
      const ys: number[] = [];
      const visit = (a: never, oy: number) => {
        const o = a as { type: string; y: number; height: number; children?: never[] };
        const y = oy + o.y;
        if (o.type === 'line') ys.push(y);
        for (const c of o.children ?? []) visit(c, y);
      };
      for (const c of t.sheets[0].page.regionBody.children) visit(c as never, 0);
      return ys[1] - ys[0];
    };
    // 20pt の文字でも行は字の大きさまで広げない (字は行の上下にはみ出す)。13pt × 2 にもならない
    expect(linePitch(tree('13pt'))).toBeLessThan(20);
    expect(linePitch(tree('13pt'))).toBeGreaterThanOrEqual(13 - 0.01);
    expect(linePitch(tree('30pt'))).toBeCloseTo(30, 0); // 長さのまま (20pt の子でも 60pt にならない)
    expect(linePitch(tree('1.5'))).toBeCloseTo(30, 0); // 比は子の文字サイズに掛かる (20 × 1.5)
  });
});

describe('XSL-FO 変換: margin から決まる space は retain (§5.3.2)', () => {
  it('margin-top / margin の指定は retainSpaceBefore、space-before だけなら捨てる (既定)', () => {
    const r = imp(fo('<fo:block margin-top="5mm">a</fo:block><fo:block margin="3mm">b</fo:block><fo:block space-before="5mm">c</fo:block>'));
    const [a, b, c] = r.document.sequences[0].flow.children as LBlock[];
    expect(a.retainSpaceBefore).toBe(true);
    expect(b.retainSpaceBefore).toBe(true);
    expect(c.retainSpaceBefore).toBeUndefined();
  });
  it('後ろ側の margin から決まる space-after は、仕様モードだけ retainSpaceAfter。space-after.conditionality="retain" はどちらでも', () => {
    const src = fo('<fo:block margin-bottom="5mm">a</fo:block><fo:block space-after="5mm" space-after.conditionality="retain">b</fo:block><fo:block space-after="5mm">c</fo:block>');
    const kids = (o: ImportOptions) => imp(src, o).document.sequences[0].flow.children as LBlock[];
    const [a, b, c] = kids({ compat: 'spec' });
    expect([a.retainSpaceAfter, b.retainSpaceAfter, c.retainSpaceAfter]).toEqual([true, true, undefined]);
    const [a2, b2] = kids({});
    expect([a2.retainSpaceAfter, b2.retainSpaceAfter]).toEqual([undefined, true]);
  });
});

describe('XSL-FO 変換: 空白・改行の扱い (§7.16.7 / 7.16.8 / 7.16.12 / 7.16.13)', () => {
  const txt = (attrs: string, body: string) => {
    const b = seq(fo(`<fo:block ${attrs}>${body}</fo:block>`)).flow.children[0] as LBlock;
    return b.children.filter((c) => typeof c === 'string').join('');
  };
  it('既定: 改行は空白、連続空白は 1 つ、ブロックの端の空白は消す', () => {
    expect(txt('', '\n  あ  \n  い  ')).toBe('あ い');
  });
  it('linefeed-treatment=preserve だけなら、改行は残し、改行の前後の空白は消し、連続空白は畳む', () => {
    expect(txt('linefeed-treatment="preserve"', 'あ   い  \n  う')).toBe('あ い\nう');
  });
  it('white-space-collapse=false だけなら、空白は残るが改行は空白になる', () => {
    expect(txt('white-space-collapse="false" white-space-treatment="preserve"', 'あ   い\nう')).toBe('あ   い う');
  });
  it('white-space="pre" は改行・空白をそのまま残し、折り返さない (noWrap)', () => {
    const b = seq(fo('<fo:block white-space="pre">a  b\n  c</fo:block>')).flow.children[0] as LBlock;
    expect(b.children.join('')).toBe('a  b\n  c');
    expect(b.noWrap).toBe(true);
  });
  it('linefeed-treatment=ignore / treat-as-zero-width-space', () => {
    expect(txt('linefeed-treatment="ignore"', 'あ\nい')).toBe('あい');
    expect(txt('linefeed-treatment="treat-as-zero-width-space"', 'あ\nい')).toBe('あ\u200Bい');
  });
  it('タブは空白 1 つ (4 つに展開しない)', () => {
    expect(txt('white-space="pre"', 'a\tb')).toBe('a b');
  });
  it('wrap-option=no-wrap の行は、行幅を超えても折り返さない', () => {
    const t = E.engine.layout(imp(fo(`<fo:block wrap-option="no-wrap">${'あ'.repeat(40)}</fo:block>`)).document);
    let lines = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') lines++;
    });
    expect(lines).toBe(1);
  });
});

describe('XSL-FO 変換: 改ページの種類・ページ数の調整・id (S-05 / S-10)', () => {
  it('break-before/after の column・odd-page・even-page をそのまま保持する', () => {
    const r = imp(fo('<fo:block break-before="column">a</fo:block><fo:block break-before="odd-page" break-after="even-page">b</fo:block>'));
    const [a, b] = r.document.sequences[0].flow.children as LBlock[];
    expect(a.breakBefore).toBe('column');
    expect([b.breakBefore, b.breakAfter]).toEqual(['odd-page', 'even-page']);
  });

  it('initial-page-number の auto-odd / auto-even と force-page-count を読む', () => {
    expect(seq(fo('<fo:block>a</fo:block>', 'initial-page-number="auto-odd" force-page-count="end-on-even"')).initialPageNumber).toBe('auto-odd');
    expect(seq(fo('<fo:block>a</fo:block>', 'force-page-count="even"')).forcePageCount).toBe('even');
  });

  it('inline・セル・行・ブロックコンテナ・画像の id を取り込む', () => {
    const r = imp(
      fo(
        '<fo:block><fo:inline id="i1">x</fo:inline><fo:external-graphic id="g1" src="a.png"/></fo:block><fo:block-container id="c1"><fo:block>y</fo:block></fo:block-container>' +
          '<fo:table><fo:table-body><fo:table-row id="r1"><fo:table-cell id="t1"><fo:block>z</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>',
      ),
    );
    const json = JSON.stringify(r.document);
    for (const id of ['i1', 'g1', 'c1', 'r1', 't1']) expect(json).toContain(`"id":"${id}"`);
  });
});

describe('XSL-FO 変換: writing-mode とリージョンの配置 (S-04)', () => {
  it('tb-lr は vertical-lr、tb は tb-rl の略。bt-lr は vertical-lr で組んで行の中を裏返す (未対応として報告しない)', () => {
    expect(seq(fo('<fo:block>a</fo:block>', 'writing-mode="tb-lr"')).flow.writingMode).toBe('vertical-lr');
    expect(seq(fo('<fo:block>a</fo:block>', 'writing-mode="tb"')).flow.writingMode).toBe('vertical-rl');
    const r = imp(fo('<fo:block-container writing-mode="bt-lr"><fo:block>a</fo:block></fo:block-container>'));
    expect(r.report.unsupported['writing-mode:bt-lr']).toBeUndefined();
    const c = r.document.sequences[0].flow.children[0] as { writingMode?: string; writingFlip?: object };
    expect(c.writingMode).toBe('vertical-lr');
    expect(c.writingFlip).toEqual({ inline: true });
  });

  it('ページの書字方向が tb-rl なら、region-before は右端・region-start は上端に置かれる', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" writing-mode="tb-rl">
      <fo:region-body margin="10mm"/><fo:region-before extent="10mm"/><fo:region-start extent="8mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before"><fo:block>B</fo:block></fo:static-content>
      <fo:static-content flow-name="xsl-region-start"><fo:block>S</fo:block></fo:static-content><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const s = seq(xml);
    const mm = (v: number) => (v * 72) / 25.4;
    const [before, start] = (s.staticContent ?? []).filter((c) => c.children.length);
    // before: 右端に幅 10mm。start (上端) の角は start が取る (precedence=false)
    expect(before.left).toBeCloseTo(mm(90), 1);
    expect(before.width).toBeCloseTo(mm(10), 1);
    expect(before.top).toBeCloseTo(mm(8), 1);
    // start: 上端に高さ 8mm、左右いっぱい
    expect(start.top).toBeCloseTo(0, 1);
    expect(start.height).toBeCloseTo(mm(8), 1);
    expect(start.width).toBeCloseTo(mm(100), 1);
    // リージョンの書字方向はページから継承 (縦書き)
    expect(before.writingMode).toBe('vertical-rl');
    // 本文の書字方向もページから継承
    expect(s.flow.writingMode).toBe('vertical-rl');
  });
});

describe('XSL-FO 変換: keep の適用範囲 (S-08)', () => {
  it('table-row・list-item の keep-with-next/previous、表の keep-together、inline の keep-together (within-line)', () => {
    const r = imp(
      fo(
        '<fo:table keep-together.within-page="always" keep-with-next="always"><fo:table-body><fo:table-row keep-with-next="always"><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row>' +
          '<fo:table-row keep-with-previous.within-column="always"><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>' +
          '<fo:list-block><fo:list-item keep-with-next="always"><fo:list-item-label><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body><fo:block>x</fo:block></fo:list-item-body></fo:list-item></fo:list-block>' +
          '<fo:block><fo:inline keep-together.within-line="always">ab</fo:inline><fo:inline keep-together="always">cd</fo:inline></fo:block>',
      ),
    );
    const [t, list, b] = r.document.sequences[0].flow.children as [LTable, LTable, LBlock];
    expect([t.keepTogether, t.keepWithNext]).toEqual([true, true]);
    expect(t.body.rows[0].keepWithNext).toBe(true);
    expect(t.body.rows[1].keepWithPrevious).toBe(true);
    expect(list.body.rows[0].keepWithNext).toBe(true);
    expect((b.children as Array<{ noBreak?: boolean }>).filter((c) => typeof c !== 'string').map((c) => c.noBreak)).toEqual([true, true]);
  });
});

describe('XSL-FO 変換: 既定値の流儀 (S-13)', () => {
  it('axf:punctuation-spacing: 字の大きさに対する比で持つ', () => {
    const b = (v: string) => (imp(fo(`<fo:block font-size="10pt" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:punctuation-spacing="${v}">a</fo:block>`)).document.sequences[0].flow.children[0] as LBlock).punctuationSpacing;
    expect(b('0.25em')).toBeCloseTo(0.25);
    expect(b('5pt')).toBeCloseTo(0.5);
    expect(b('0em')).toBe(0);
  });
  it('axf:punctuation-trim: 既定 (antenna) は行末の約物のアキを捨てる。none・start では捨てない。compat=spec も捨てない', () => {
    const AX = 'xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const seq = (o: ImportOptions = {}) => imp(fo(`<fo:block>a</fo:block><fo:block ${AX} axf:punctuation-trim="start">b</fo:block><fo:block ${AX} axf:punctuation-trim="end">c</fo:block>`), o).document.sequences[0];
    const s = seq();
    expect(s.punctuationTrimEnd).toBe(true);
    expect((s.flow.children[1] as LBlock).punctuationTrimEnd).toBe(false);
    expect((s.flow.children[2] as LBlock).punctuationTrimEnd).toBe(true);
    expect(seq({ compat: 'spec' }).punctuationTrimEnd).toBeFalsy();
  });
  it('axf:line-break: 既定 (antenna) は normal (小書き仮名などを行頭に置いてよい)、strict は禁則にする。compat=spec は禁則', () => {
    const seq = (o: ImportOptions = {}) => imp(fo('<fo:block>a</fo:block><fo:block xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:line-break="strict">b</fo:block>'), o).document.sequences[0];
    const s = seq();
    expect(s.looseLineStart).toBe(true);
    expect((s.flow.children[1] as LBlock).looseLineStart).toBe(false);
    expect(seq({ compat: 'spec' }).looseLineStart).toBeFalsy();
  });
  it('compat を指定しないと spec (XSL-FO 1.1 の初期値どおり)、antenna は互換モードの値', () => {
    const pick = (s: LPageSequence) => [s.fontSize, s.lineHeight, s.textAlign, s.hangingPunctuation];
    expect(pick(importXslFo(fo('<fo:block>a</fo:block>'), parse).document.sequences[0])).toEqual([12, 1.2, 'start', false]);
    expect(pick(imp(fo('<fo:block>a</fo:block>'), { compat: 'spec' }).document.sequences[0])).toEqual([12, 1.2, 'start', false]);
    expect(pick(imp(fo('<fo:block>a</fo:block>')).document.sequences[0])).toEqual([10, 1.2, 'start', false]);
    // font-size="medium" も流儀に従う
    const b = imp(fo('<fo:block font-size="large">a</fo:block>'), { compat: 'spec' }).document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontSize).toBeCloseTo(14.4);
  });
});

describe('XSL-FO 変換: overflow (S-12)', () => {
  it('block-container の overflow=hidden / scroll は切り抜き、condense などは未対応として報告', () => {
    const r = imp(fo('<fo:block-container overflow="hidden" height="10mm"><fo:block>a</fo:block></fo:block-container><fo:block-container overflow="scroll"><fo:block>b</fo:block></fo:block-container><fo:block-container overflow="condense"><fo:block>c</fo:block></fo:block-container>'));
    const [a, b, c] = r.document.sequences[0].flow.children as LBlockContainer[];
    expect([a.overflow, b.overflow, c.overflow]).toEqual(['hidden', 'hidden', undefined]);
    expect(r.report.unsupported['overflow:condense']).toBe(1);
    // 組版結果の Area に clip が付く
    const t = E.engine.layout(r.document);
    let clipped = 0;
    walk(t.sheets[0].page.regionBody, (x) => {
      if ((x as { clip?: boolean }).clip) clipped++;
    });
    expect(clipped).toBe(2);
  });
});

describe('XSL-FO 変換: リストのラベル間隔・脚注の参照記号の書式 (S-12)', () => {
  it('label-end() のラベルは、provisional-label-separation (既定 6pt) をラベルの終端側の余白にする', () => {
    const list = (attrs: string) =>
      seq(fo(`<fo:list-block ${attrs}><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>1.</fo:block></fo:list-item-label><fo:list-item-body><fo:block>x</fo:block></fo:list-item-body></fo:list-item></fo:list-block>`)).flow.children[0] as LTable;
    expect((list('').body.rows[0].cells[0].padding as { right: number }).right).toBe(6);
    expect((list('provisional-label-separation="3mm"').body.rows[0].cells[0].padding as { right: number }).right).toBeCloseTo((3 * 72) / 25.4);
  });

  it('脚注の参照記号は、参照側 inline の font-size と baseline-shift を使う', () => {
    const fn = (inline: string) => {
      const b = seq(fo(`<fo:block>a<fo:footnote>${inline}<fo:footnote-body><fo:block>n</fo:block></fo:footnote-body></fo:footnote></fo:block>`)).flow.children[0] as LBlock;
      return b.children.find((c) => typeof c !== 'string') as LFootnote;
    };
    const a = fn('<fo:inline baseline-shift="super" font-size="75%">(1)</fo:inline>');
    expect([a.referenceScale, a.referenceShift]).toEqual([0.75, 'super']);
    const b = fn('<fo:inline>※</fo:inline>');
    expect([b.referenceScale, b.referenceShift]).toEqual([1, 'none']);
  });
});

describe('XSL-FO 変換: page-sequence-master の部分列 (S-12)', () => {
  it('順序・maximum-repeats・blank-or-not-blank を masterSequence に保つ', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set>
      <fo:simple-page-master master-name="a" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>
      <fo:simple-page-master master-name="b" page-width="101mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>
      <fo:simple-page-master master-name="c" page-width="102mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>
      <fo:page-sequence-master master-name="s"><fo:single-page-master-reference master-reference="a"/><fo:repeatable-page-master-reference master-reference="b" maximum-repeats="3"/>
        <fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="c" blank-or-not-blank="blank"/><fo:conditional-page-master-reference master-reference="b"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master>
      </fo:layout-master-set><fo:page-sequence master-reference="s"><fo:flow flow-name="xsl-region-body"><fo:block>x</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = imp(xml);
    const ms = r.document.sequences[0].masterSequence!;
    expect(ms.map((i) => [i.kind, i.maxRepeats])).toEqual([['single', undefined], ['repeatable', 3], ['alternatives', undefined]]);
    expect(ms[2].masters[0].when.blankOrNotBlank).toBe('blank');
    expect(r.report.unsupported['blank-or-not-blank=blank']).toBeUndefined();
  });
});

describe('XSL-FO 変換: text-decoration (E-04)', () => {
  it('underline / line-through / overline と打ち消し (no-underline・none)', () => {
    const r = imp(fo('<fo:block text-decoration="underline line-through">a<fo:inline text-decoration="no-underline">b</fo:inline></fo:block>'));
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.textDecoration).toEqual({ underline: true, lineThrough: true });
    expect((b.children[1] as { textDecoration?: object }).textDecoration).toEqual({ underline: false });
  });

  it('組版: 下線は基線の下、取り消し線は字面の中ほどに、文字の幅いっぱいに引かれる。打ち消した inline には引かない', () => {
    const r = imp(fo('<fo:block font-size="10pt" text-decoration="underline">あいう<fo:inline text-decoration="no-underline">えお</fo:inline></fo:block>'));
    const t = E.engine.layout(r.document);
    const deco: Array<{ y: number; w: number }> = [];
    const visit = (a: never, ox: number, oy: number) => {
      const o = a as { type: string; x: number; y: number; width: number; height: number; backgroundColor?: string; children?: never[] };
      const x = ox + o.x;
      const y = oy + o.y;
      if (o.type === 'block' && o.backgroundColor && o.height < 1.5) deco.push({ y, w: o.width });
      for (const c of o.children ?? []) visit(c, x, y);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c as never, 0, 0);
    expect(deco).toHaveLength(1);
    expect(deco[0].w).toBeCloseTo(30, 0); // あいう (10pt × 3)
  });
});

describe('XSL-FO 変換: 傍注・inside/outside の float・margin の略記 (E-06)', () => {
  it('margin="20mm 50mm 10mm 0mm" (略記の 4 値) を上・右・下・左に展開する', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200mm" page-height="100mm" margin="5mm 6mm 7mm 8mm">
      <fo:region-body margin="20mm 50mm 10mm 0mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const m = seq(xml).master.margins;
    expect([m.top, m.right, m.bottom, m.left].map((v) => Math.round(v))).toEqual([25, 56, 17, 8]);
  });

  it('負の start/end-indent で外へはみ出す内容の float は傍注 (marginal)。float="outside" はそのまま保つ', () => {
    const s = seq(fo('<fo:block><fo:float float="outside"><fo:block start-indent="-50mm" end-indent="-50mm">注</fo:block></fo:float>本文</fo:block>'));
    const f = ((s.flow.children[0] as LBlock).children[0]) as LFloat;
    expect(f.float).toBe('outside');
    expect(f.marginal).toBe(true);
  });

  it('角ごとの径 (axf:border-top-left-radius など) を borderRadius.corners にする。指定の無い角は axf:border-radius の値', () => {
    const s = seq(fo('<fo:block xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:border-radius="1pt" axf:border-top-left-radius="4pt" axf:border-bottom-left-radius="4pt 2pt">a</fo:block>'));
    const r = (s.flow.children[0] as LBlock).borderRadius!;
    expect(r.corners).toEqual([[4, 4], [1, 1], [1, 1], [4, 2]]);
  });

  it('float の幅は、内容の block-container の width に start-indent・end-indent (margin + 枠 + パディング) を足した長さ', () => {
    const P = 72 / 25.4;
    const s = seq(fo('<fo:block><fo:float float="end"><fo:block-container width="32mm" margin-left="3mm" margin-right="0mm" padding="3pt" border="0.6pt solid #000"><fo:block>図</fo:block></fo:block-container></fo:float>本文</fo:block>'));
    const f = (s.flow.children[0] as LBlock).children[0] as LFloat;
    expect(f.width).toBeCloseTo(32 * P + 3 * P + 2 * (3 + 0.6), 3);
    // margin の無い側 (start-indent が 0 の側) は足さない
    const s2 = seq(fo('<fo:block><fo:float float="end"><fo:block-container width="32mm" padding="3pt"><fo:block>図</fo:block></fo:block-container></fo:float>本文</fo:block>'));
    expect(((s2.flow.children[0] as LBlock).children[0] as LFloat).width).toBeCloseTo(32 * P, 3);
  });
});

describe('XSL-FO 変換: block-container の中の indent (S-07)', () => {
  const xml = fo('<fo:block start-indent="10mm"><fo:block-container><fo:block>a</fo:block><fo:block start-indent="15mm">b</fo:block></fo:block-container></fo:block>');
  it('仕様モード: 中の要素はコンテナの start-indent (継承値) を、コンテナの内容端から受け継ぐ', () => {
    const b = imp(xml, { compat: 'spec' }).document.sequences[0].flow.children[0] as LBlock;
    const cont = b.children[0] as LBlockContainer;
    const wrap = cont.children[0] as LBlock;
    const mm = (v: number) => (v * 72) / 25.4;
    expect((wrap.margin as { left: number }).left).toBeCloseTo(mm(10), 1);
    // 明示の start-indent=15mm は、内容端から 15mm (包みの 10mm + 差分 5mm)
    expect(((wrap.children[1] as LBlock).margin as { left: number }).left).toBeCloseTo(mm(5), 1);
  });
  it('互換モード (既定): 従来どおり (外の indent を中へ持ち込まない)', () => {
    const b = imp(xml).document.sequences[0].flow.children[0] as LBlock;
    const cont = b.children[0] as LBlockContainer;
    expect((cont.children[0] as LBlock).margin).toBeUndefined();
  });
});

describe('XSL-FO 変換: 右から左の横組み (writing-mode="rl-tb", S-04)', () => {
  it('direction を rtl にし、start / end を右 / 左に、text-align の left / right を end / start に読み替える', () => {
    const s = seq(fo('<fo:block start-indent="20pt" end-indent="5pt" text-align="left">a</fo:block><fo:block writing-mode="lr-tb" start-indent="7pt">b</fo:block>', 'writing-mode="rl-tb"'));
    expect(s.direction).toBe('rtl');
    expect(s.flow.writingMode).toBe('horizontal-tb');
    const [b1, b2] = s.flow.children as LBlock[];
    expect(b1.margin).toMatchObject({ right: 20, left: 5 });
    expect(b1.textAlign).toBe('end');
    expect(b2.direction).toBe('ltr');
    expect(b2.margin).toMatchObject({ left: 7 });
  });
});

describe('XSL-FO 変換: instream-foreign-object (I-02)', () => {
  it('埋め込みの SVG は、単独の SVG 文書に書き戻して data URI の画像にする', () => {
    const r = imp(fo('<fo:block><fo:instream-foreign-object content-width="20pt"><svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="10" height="10"><svg:rect width="5" height="5" fill="red"/><svg:text x="1" y="9">字 &amp; &lt;</svg:text></svg:svg></fo:instream-foreign-object></fo:block>'));
    const img = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LImage;
    expect(img.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(r.report.images).toContain(img.src);
    expect(img.width).toBe(20);
    const xml = new TextDecoder().decode(Uint8Array.from(atob(img.src.split(',')[1]), (c) => c.charCodeAt(0)));
    expect(xml).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><rect width="5" height="5" fill="red"/><text x="1" y="9">字 &amp; &lt;</text></svg>');
    expect(r.report.unsupported).toEqual({});
  });
  it('MathML は行内の要素に組み替える (上付き・分数の箱など)。CDATA に入った MathML・SVG も読む', () => {
    const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
    const r = imp(fo(`<fo:block><fo:instream-foreign-object><math ${M}><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mn>1</mn><mi>y</mi></mfrac></math></fo:instream-foreign-object></fo:block>`));
    const json = JSON.stringify(r.document);
    expect(json).toContain('"baselineShift":"super"');
    expect(json).toContain('"children":["x"],"fontStyle":"italic"');
    expect(json).toContain('"type":"inline-container","alignmentBaseline":"central"');
    expect(json).toContain('"children":["+"],"padding"');
    expect(r.report.unsupported).toEqual({});
    const cdata = imp(fo(`<fo:block><fo:instream-foreign-object><![CDATA[<!DOCTYPE math PUBLIC "-//W3C//DTD MathML 2.0//EN" "x.dtd"><math ${M}><mi>z</mi></math>]]></fo:instream-foreign-object></fo:block>`));
    expect(JSON.stringify(cdata.document)).toContain('"children":["z"]');
  });
  it('Content MathML (apply・lambda・int) を見た目の記法にし、external-graphic の MathML のファイルも読む', () => {
    const M = 'xmlns:m="http://www.w3.org/1998/Math/MathML"';
    const lam = `<m:math ${M}><m:lambda><m:bvar><m:ci>b</m:ci></m:bvar><m:apply><m:int/><m:bvar><m:ci>x</m:ci></m:bvar><m:lowlimit><m:ci>a</m:ci></m:lowlimit><m:uplimit><m:ci>b</m:ci></m:uplimit><m:apply><m:fn><m:ci>f</m:ci></m:fn><m:ci>x</m:ci></m:apply></m:apply></m:lambda></m:math>`;
    const r = imp(fo(`<fo:block><fo:instream-foreign-object>${lam}</fo:instream-foreign-object></fo:block>`));
    const json = JSON.stringify(r.document);
    for (const t of ['" ↦ "', '"∫"', '" d"', '"("', '")"']) expect(json).toContain(t);
    expect(r.report.unsupported).toEqual({});
    // external-graphic: readText が中身を返せば数式として組み、返さなければ画像のまま
    const g = '<fo:block><fo:external-graphic src="url(\'MathML/a.mml\')" content-type="application/mathml+xml"/></fo:block>';
    const ext = imp(fo(g), { readText: (s) => (s === 'MathML/a.mml' ? lam : undefined) });
    expect(JSON.stringify(ext.document)).toContain('" ↦ "');
    expect(JSON.stringify(imp(fo(g)).document)).toContain('"type":"image"');
  });
  it('幅も列の幅も指定の無い表は、列の幅を中身に合わせ、入らなければ最大の長さの比で配る', () => {
    const t = (attrs: string) => JSON.stringify(imp(fo(`<fo:table ${attrs}><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`)).document);
    expect(t('')).toContain('"fitContent":true,"fitContentRule":"max-ratio"');
    expect(t('table-layout="fixed"')).not.toContain('fitContent');
    expect(t('inline-progression-dimension="100mm"')).not.toContain('"fitContent"');
    // 幅の指定があっても table-layout が auto (初期値) なら自動レイアウト (§6.7.3)。fixed なら列を等分する
    expect(t('inline-progression-dimension="100mm"')).toContain('"fillContent":true');
    expect(t('inline-progression-dimension="100mm" table-layout="fixed"')).not.toContain('fillContent');
  });
  it('MathML: 背の高い中身の括弧は図形で伸ばし (stretchy="false" は字のまま)、アクセントの矢印・根号も図形と罫線で描く', () => {
    const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
    const m = (x: string) => JSON.stringify(imp(fo(`<fo:block font-size="10pt"><fo:instream-foreign-object><math display="block" ${M}>${x}</math></fo:instream-foreign-object></fo:block>`)).document);
    const frac = '<mfrac><mi>x</mi><mi>y</mi></mfrac>';
    const svgCount = (j: string) => (j.match(/data:image\/svg\+xml/g) ?? []).length;
    expect(svgCount(m(`<mrow><mo>(</mo>${frac}<mo>)</mo></mrow>`))).toBe(2);
    expect(svgCount(m(`<mrow><mo stretchy="false">(</mo>${frac}<mo stretchy="false">)</mo></mrow>`))).toBe(0);
    // 1 行に収まる中身の括弧は字のまま
    expect(svgCount(m('<mrow><mo>(</mo><mi>x</mi><mo>)</mo></mrow>'))).toBe(0);
    expect(svgCount(m(`<mfenced>${frac}</mfenced>`))).toBe(2);
    // ベクトルの矢印は図形 (字の → は置かない)
    const vec = m('<mover accent="true"><mi>a</mi><mo stretchy="true">→</mo></mover>');
    expect(svgCount(vec)).toBe(1);
    expect(vec).not.toContain('"→"');
    // 根号: はねの図形と、上と左に罫線のある箱 (字の √ は置かない)
    const sq = m('<msqrt><mi>x</mi></msqrt>');
    expect(svgCount(sq)).toBe(1);
    expect(sq).not.toContain('√');
    expect(sq).toMatch(/"border":\{"top":\{[^}]*\},"left":\{/);
  });
  it('axf:diagonal-border-* / axf:reverse-diagonal-border-* と、表の行の height (最小の高さ)', () => {
    const d = JSON.stringify(
      imp(fo('<fo:table><fo:table-body><fo:table-row height="20pt"><fo:table-cell xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:diagonal-border-style="solid" axf:diagonal-border-width="1pt" axf:diagonal-border-color="black"><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table><fo:block-container xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" axf:reverse-diagonal-border="4pt solid #2222FF"><fo:block>b</fo:block></fo:block-container>')).document,
    );
    expect(d).toContain('"diagonalBorder":{"width":1,"color":"black"}');
    expect(d).toContain('"reverseDiagonalBorder":{"width":4,"color":"#2222FF"}');
    expect(d).toContain('"minHeight":20');
    // 縦書きの表でも block-progression-dimension.optimum を読む
    const v = JSON.stringify(imp(fo('<fo:table writing-mode="tb-rl"><fo:table-body><fo:table-row block-progression-dimension.optimum="18pt"><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>')).document);
    expect(v).toContain('"minHeight":18');
    // 一括指定の太さと別に -width を書いても、一括指定の色を使う
    const AX = 'xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const e = JSON.stringify(imp(fo(`<fo:block-container ${AX} axf:diagonal-border="2pt solid red" axf:diagonal-border-width="1pt"><fo:block>c</fo:block></fo:block-container>`)).document);
    expect(e).toContain('"diagonalBorder":{"width":1,"color":"red"}');
  });
  it('MathML の図形 (伸ばした括弧・根号) は、周りの字の色や mathcolor で描く', () => {
    const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
    const d = (color: string, inner: string) => imp(fo(`<fo:block color="${color}"><fo:instream-foreign-object><math display="block" ${M}>${inner}</math></fo:instream-foreign-object></fo:block>`)).document;
    const svgs = (doc: unknown) => [...JSON.stringify(doc).matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8'));
    const frac = '<mfrac><mi>x</mi><mi>y</mi></mfrac>';
    const fence = svgs(d('blue', `<mrow><mo>(</mo>${frac}<mo>)</mo></mrow>`));
    expect(fence.length).toBe(2);
    expect(fence.every((v) => v.includes('stroke="rgb(0,0,255)"'))).toBe(true);
    // 根号: はねの図形と、上と左の罫線
    const sq = d('blue', '<msqrt><mi>x</mi></msqrt>');
    expect(svgs(sq)[0]).toContain('stroke="rgb(0,0,255)"');
    expect(JSON.stringify(sq)).toMatch(/"border":\{"top":\{[^}]*"color":"blue"/);
    // mathcolor はその中だけ
    const mc = svgs(d('black', `<mrow mathcolor="red"><mo>(</mo>${frac}<mo>)</mo></mrow>`));
    expect(mc.every((v) => v.includes('stroke="rgb(255,0,0)"'))).toBe(true);
  });
  it('table-body の字の指定 (font-size など) は、中の行・セルへ引き継ぐ', () => {
    const d = imp(fo('<fo:table><fo:table-body font-size="8pt" color="red"><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>')).document;
    expect(JSON.stringify(d)).toMatch(/"type":"table-row"[^\]]*"fontSize":8|"fontSize":8[^\]]*"type":"table-row"/);
  });
  it('mtable は列の幅を中身に合わせた表、見えない演算子は字を置かず、display="block" の分数は小さくしない', () => {
    const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
    const r = imp(fo(`<fo:block><fo:instream-foreign-object><math ${M}><mtable frame="solid"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi><mo>&#x2062;</mo><mi>c</mi></mtd></mtr></mtable></math></fo:instream-foreign-object></fo:block>`));
    const json = JSON.stringify(r.document);
    expect(json).toContain('"type":"table","fitContent":true');
    expect(json).not.toContain('\u2062');
    const frac = (display: string) =>
      JSON.stringify(imp(fo(`<fo:block font-size="10pt"><fo:instream-foreign-object><math display="${display}" ${M}><mfrac><mi>x</mi><mi>y</mi></mfrac></math></fo:instream-foreign-object></fo:block>`)).document);
    expect(frac('block')).toContain('"fontSize":10,"lineHeight":1.15');
    expect(frac('inline')).toContain('"fontSize":7.1,"lineHeight":1.15');
  });
  it('mtable の rowspacing・columnspacing はセルの余白、アクセントの段は行の高さを詰める', () => {
    const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
    const r = imp(fo(`<fo:block font-size="10pt"><fo:instream-foreign-object><math ${M}><mtable rowspacing="0" columnspacing="1em"><mtr><mtd><mover accent="true"><mi>a</mi><mo>→</mo></mover></mtd></mtr></mtable></math></fo:instream-foreign-object></fo:block>`));
    const json = JSON.stringify(r.document);
    expect(json).toContain('"padding":{"left":5,"right":5,"top":0,"bottom":0}');
    expect(json).toContain('"lineStackingStrategy":"line-height"');
  });
});

describe('XSL-FO 変換: 数式の表の揃えと ex の長さ', () => {
  const M = 'xmlns="http://www.w3.org/1998/Math/MathML"';
  const mathDoc = (body: string) => JSON.stringify(imp(fo(`<fo:block font-size="10pt"><fo:instream-foreign-object><math ${M}>${body}</math></fo:instream-foreign-object></fo:block>`)).document);
  it('rowspacing の ex は em の半分', () => {
    expect(mathDoc('<mtable rowspacing="3ex"><mtr><mtd><mi>a</mi></mtd></mtr></mtable>')).toContain('"top":7.5,"bottom":7.5');
  });
  it('columnalign は列ごと (足りない列は最後の値)。行・セルの指定が優先', () => {
    const json = mathDoc('<mtable columnalign="left right"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd><mtd><mi>c</mi></mtd></mtr><mtr columnalign="center"><mtd columnalign="right"><mi>d</mi></mtd><mtd><mi>e</mi></mtd><mtd><mi>f</mi></mtd></mtr></mtable>');
    // セルの中のブロックの揃え (先頭は fo:block 自身の揃え)
    const aligns = [...json.matchAll(/"textAlign":"(\w+)"/g)].map((m) => m[1]).slice(-6);
    expect(aligns).toEqual(['start', 'end', 'end', 'end', 'center', 'center']);
  });
  it('数式の全体が表なら、表の下端を文字の下端に揃える。式の中の表は軸 (中央) に揃える', () => {
    expect(mathDoc('<mrow><mtable><mtr><mtd><mi>a</mi></mtd></mtr></mtable></mrow>')).toContain('"alignmentBaseline":"after-edge"');
    const inner = mathDoc('<mrow><mi>A</mi><mo>=</mo><mtable><mtr><mtd><mi>a</mi></mtd></mtr></mtable></mrow>');
    expect(inner).not.toContain('"after-edge"');
    expect(inner).toContain('"alignmentBaseline":"central","children":[{"type":"table"');
  });
});

describe('XSL-FO 変換: 行グループの罫線と、table-and-caption の表の寄せ', () => {
  const table = (body: string, tableAttr = '') =>
    (seq(fo(`<fo:table${tableAttr}><fo:table-column column-width="10mm"/><fo:table-column column-width="10mm"/>${body}</fo:table>`)).flow.children[0] as LTable);
  // 行グループの罫線は、組むときの重ね合わせ (collapseTableBorders) で解決する
  const cellsOf = (t: LTable) =>
    collapseTableBorders(t, 'horizontal-tb').body.rows.map((r) => r.cells.map((c) => (t.borderCollapse === 'collapse' ? c.border : undefined) as Record<string, { width: number } | undefined> | undefined));
  it('table-body の罫線は、外周に接するセルの罫線になる (太い方が勝つ。内側の辺には付けない)', () => {
    const t = table('<fo:table-body border-style="solid" border-width="1pt"><fo:table-row><fo:table-cell border-right-style="solid" border-right-width="2pt"><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell><fo:table-cell><fo:block>d</fo:block></fo:table-cell></fo:table-row></fo:table-body>');
    const [[a, b], [c, d]] = cellsOf(t);
    // 互換モード (既定): 内側の罫線は後ろ (右) のセルが持つ
    expect([a?.top?.width, a?.left?.width, a?.right, a?.bottom]).toEqual([1, 1, undefined, undefined]);
    expect([b?.top?.width, b?.right?.width, b?.left?.width, b?.bottom]).toEqual([1, 1, 2, undefined]);
    expect([c?.bottom?.width, c?.left?.width, c?.top, c?.right]).toEqual([1, 1, undefined, undefined]);
    expect([d?.bottom?.width, d?.right?.width]).toEqual([1, 1]);
  });
  it('行をまたぐセルは、行グループの下端に届けば下の罫線も付く。separate の表では付けない', () => {
    const body = '<fo:table-body border-style="solid" border-width="1pt"><fo:table-row><fo:table-cell number-rows-spanned="2"><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body>';
    const [[a, b], [c]] = cellsOf(table(body));
    expect(a?.bottom?.width).toBe(1);
    expect(b?.bottom).toBeUndefined();
    expect([c?.left, c?.right?.width, c?.bottom?.width]).toEqual([undefined, 1, 1]);
    const sep = table(body, ' border-collapse="separate"');
    expect(sep.body.rows.every((r) => !r.group && r.cells.every((c) => !c.border))).toBe(true);
  });
  it('table-and-caption の中の表には、継承した text-align で寄せる印を付ける。table だけなら付けない', () => {
    const tc = seq(fo('<fo:table-and-caption><fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:table-and-caption>')).flow.children[0] as LTable;
    expect(tc.alignByTextAlign).toBe(true);
    expect(table('<fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell></fo:table-row></fo:table-body>').alignByTextAlign).toBeUndefined();
  });
});

describe('XSL-FO 変換: text-transform', () => {
  const texts = (attr: string, opts = {}) => JSON.stringify(imp(fo(`<fo:block ${attr}><fo:block>SCENE I. Orchard of Oliver's house, well-known</fo:block><fo:inline text-transform="none">Keep IT</fo:inline></fo:block>`), opts).document);
  it('uppercase・lowercase は字を変え、継承される。none で止める', () => {
    expect(texts('text-transform="uppercase"')).toContain("SCENE I. ORCHARD OF OLIVER'S HOUSE, WELL-KNOWN");
    expect(texts('text-transform="lowercase"')).toContain("scene i. orchard of oliver's house, well-known");
    expect(texts('text-transform="uppercase"')).toContain('Keep IT');
  });
  it('capitalize: 語の最初の字を大文字に (アポストロフィの後ろは語の続き)。互換モードは残りを小文字に、仕様モードは残りを変えない', () => {
    expect(texts('text-transform="capitalize"')).toContain("Scene I. Orchard Of Oliver's House, Well-Known");
    expect(texts('text-transform="capitalize"', { compat: 'spec' })).toContain("SCENE I. Orchard Of Oliver's House, Well-Known");
    expect(imp(fo('<fo:block text-transform="capitalize">a</fo:block>')).report.unsupported['text-transform']).toBeUndefined();
  });
});

describe('XSL-FO 変換: 余白・絶対配置・表の幅・リスト', () => {
  const first = (flow: string, o: ImportOptions = {}) => imp(fo(flow), o).document.sequences[0].flow.children[0] as LBlock & Record<string, unknown>;
  const MM = 72 / 25.4;
  it('margin の一括指定は、同じ側の space-before・start-indent に負ける。個別の margin-top は space-before に勝つ', () => {
    const a = first('<fo:block margin="10pt" space-before="5pt" start-indent="5mm" end-indent="5mm">a</fo:block>');
    expect(a.margin).toMatchObject({ top: 5, bottom: 10 });
    expect((a.margin as Record<string, number>).left).toBeCloseTo(5 * MM, 3);
    expect((a.margin as Record<string, number>).right).toBeCloseTo(5 * MM, 3);
    expect(a.retainSpaceBefore).toBeUndefined();
    const b = first('<fo:block margin-top="7pt" space-before="5pt">a</fo:block>');
    expect((b.margin as Record<string, number>).top).toBe(7);
    expect(b.retainSpaceBefore).toBe(true);
  });
  it('indent も margin も無いブロックの罫線・パディングは、内容の端の外へ出る', () => {
    const a = first('<fo:block border="2pt solid black" padding="3pt">a</fo:block>');
    expect(a.margin).toMatchObject({ left: -5, right: -5 });
    expect(first('<fo:block start-indent="0pt" border="2pt solid black">a</fo:block>').margin).toMatchObject({ left: -2, right: -2 });
  });
  it('ページシーケンスの最初のページの先頭でも space-before を捨てる (discardLeadingSpace)', () => {
    expect(seq(fo('<fo:block>a</fo:block>')).discardLeadingSpace).toBe(true);
  });
  it('長さの式の掛け算・割り算 (12pt*14、100pt div 4)', () => {
    expect(first('<fo:block-container height="12pt*14"><fo:block>a</fo:block></fo:block-container>').height).toBe(168);
    expect(first('<fo:block-container height="100pt div 4"><fo:block>a</fo:block></fo:block-container>').height).toBe(25);
  });
  it('leader-length の短い形は最小・最適・最大のすべて。rule-style と use-content の文字列', () => {
    const ld = (attrs: string, body = '') => ((first(`<fo:block>a<fo:leader ${attrs}>${body}</fo:leader></fo:block>`).children as unknown[])[1] as Record<string, unknown>);
    expect(ld('leader-pattern="rule" leader-length="30pt"').length).toEqual({ minimum: 30, optimum: 30, maximum: 30 });
    expect(ld('leader-pattern="rule" rule-style="dashed"').ruleStyle).toBe('dashed');
    expect(ld('leader-pattern="use-content"', '\nleader').patternText).toBe(' leader');
  });
  it('column-width がすべて百分率で合計 100% なら、表の幅を比で分ける', () => {
    const t = first('<fo:table><fo:table-column column-width="25%"/><fo:table-column column-width="75%"/><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>') as unknown as LTable;
    expect(t.columns.map((c) => c.width)).toEqual(['25*', '75*']);
  });
  it('絶対配置: 上下 (左右) の両方の指定は本文領域から寸法を決める。ブロックコンテナの中の絶対配置は、そのコンテナが基準', () => {
    const page = first('<fo:block-container absolute-position="absolute" top="0" bottom="0" left="0" right="0"><fo:block>a</fo:block></fo:block-container>') as unknown as LBlockContainer;
    // 本文領域: 100mm − 余白 10mm × 2 (幅)、100mm − 10mm × 2 − region-body の margin-top 5mm (高さ)
    expect(page.width).toBeCloseTo(80 * MM, 3);
    expect(page.height).toBeCloseTo(75 * MM, 3);
    expect(page.positionInContainer).toBeUndefined();
    const outer = first('<fo:block-container height="50mm"><fo:block-container absolute-position="absolute" top="10mm" left="5mm"><fo:block>a</fo:block></fo:block-container></fo:block-container>') as unknown as LBlockContainer;
    const inner = outer.children[0] as LBlockContainer;
    expect(inner.positionInContainer).toBe(true);
    expect(inner.top).toBeCloseTo(10 * MM, 3);
    expect(inner.left).toBeCloseTo(5 * MM, 3);
  });
  it('親と書字方向が直交するコンテナは、親の幅いっぱいに広げる印を付ける', () => {
    const c = first('<fo:block-container writing-mode="tb-rl" height="4em"><fo:block>縦</fo:block></fo:block-container>') as unknown as LBlockContainer;
    expect(c.fillOrthogonal).toBe(true);
  });
  it('リスト: ラベルの start-indent・本体の end-indent。互換モードでは本体の始端にラベルの start-indent を足す', () => {
    const list = (o: ImportOptions = {}) =>
      first('<fo:list-block provisional-distance-between-starts="15mm"><fo:list-item><fo:list-item-label start-indent="5mm" end-indent="label-end()"><fo:block>•</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()" end-indent="5mm"><fo:block>本文</fo:block></fo:list-item-body></fo:list-item></fo:list-block>', o) as unknown as LTable;
    const a = list();
    expect(a.columns[0].width as number).toBeCloseTo(20 * MM, 3);
    const [label, body] = a.body.rows[0].cells;
    expect((label.padding as Record<string, number>).left).toBeCloseTo(5 * MM, 3);
    expect((body.padding as Record<string, number>).right).toBeCloseTo(5 * MM, 3);
    expect(list({ compat: 'spec' }).columns[0].width as number).toBeCloseTo(15 * MM, 3);
  });
  it('互換モード: 中身の無いブロックの space-before は、その高さの空のブロックにする (次の space-before と足し合わさる)', () => {
    const a = first('<fo:block space-before="20pt">\n</fo:block>');
    expect(a.height).toBe(20);
    expect((a.margin as Record<string, number> | undefined)?.top).toBeUndefined();
    const b = first('<fo:block space-before="20pt">\n</fo:block>', { compat: 'spec' });
    expect(b.height).toBeUndefined();
    expect((b.margin as Record<string, number>).top).toBe(20);
  });
  it('画像: 枠の中で content-height だけ scale-to-fit なら、枠を残して text-align で寄せる', () => {
    const img = (first('<fo:block><fo:external-graphic src="a.png" width="180mm" height="40mm" text-align="right" content-width="auto" content-height="scale-to-fit"/></fo:block>').children as LImage[])[0];
    expect(img.viewport?.align).toBe('end');
    expect(img.height).toBeCloseTo(40 * MM, 3);
    expect(img.width).toBeUndefined();
  });
});

describe('XSL-FO 変換: page-sequence の reference-orientation (I-01)', () => {
  it('数値は本文 (region-body) の向きを上書きし、90 の倍数以外は報告する', () => {
    expect(seq(fo('<fo:block>a</fo:block>', 'reference-orientation="90"')).master.bodyRotation).toBe(90);
    expect(seq(fo('<fo:block>a</fo:block>', 'reference-orientation="-90"')).master.bodyRotation).toBe(270);
    expect(seq(fo('<fo:block>a</fo:block>', 'reference-orientation="0"')).master.bodyRotation).toBeUndefined();
    const r = imp(fo('<fo:block>a</fo:block>', 'reference-orientation="45"'));
    expect(r.report.unsupported['reference-orientation:45']).toBe(1);
  });
});

describe('XSL-FO 変換: font-stretch (I-06)', () => {
  it('キーワード・百分率・wider / narrower', () => {
    const b = (attr: string, inner = '') => (seq(fo(`<fo:block ${attr}>a${inner}</fo:block>`)).flow.children[0] as LBlock);
    // 互換モード (既定): 1 段ごとに 1.2 倍
    expect(b('font-stretch="condensed"').fontStretch).toBeCloseTo(1 / 1.44);
    expect(b('font-stretch="ultra-expanded"').fontStretch).toBeCloseTo(1.2 ** 4);
    expect(b('font-stretch="120%"').fontStretch).toBe(1.2);
    const inner = b('font-stretch="condensed"', '<fo:inline font-stretch="wider">b</fo:inline>').children[1] as { fontStretch?: number };
    expect(inner.fontStretch).toBeCloseTo(1 / 1.2);
    // 仕様モード: CSS の比率
    const spec = (seq2: string) => (importXslFo(fo(`<fo:block ${seq2}>a</fo:block>`), parse, { compat: 'spec' }).document.sequences[0].flow.children[0] as LBlock).fontStretch;
    expect(spec('font-stretch="condensed"')).toBe(0.75);
    expect(spec('font-stretch="ultra-expanded"')).toBe(2);
  });
});

describe('XSL-FO 変換: 画像の枠 (width / height と content-*)', () => {
  it('width / height は枠、content-* は画像の大きさ。scale-to-fit なら枠 = 画像', () => {
    const img = (attrs: string) => (seq(fo(`<fo:block><fo:external-graphic src="a.png" ${attrs}/></fo:block>`)).flow.children[0] as LBlock).children[0] as LImage;
    const a = img('width="9cm" height="6cm" content-width="6cm" display-align="center" text-align="center"');
    expect(a.viewport).toMatchObject({ align: 'center', blockAlign: 'center' });
    expect(a.viewport!.width).toBeCloseTo((9 * 72) / 2.54, 1);
    expect(a.width).toBeCloseTo((6 * 72) / 2.54, 1);
    const b = img('width="9cm"');
    expect(b.viewport?.width).toBeCloseTo((9 * 72) / 2.54, 1);
    expect(b.width).toBeUndefined(); // content-width=auto: 画像本来の大きさ
    const c = img('width="40mm" content-width="scale-to-fit"');
    expect(c.viewport).toBeUndefined();
    expect(c.width).toBeCloseTo((40 * 72) / 25.4, 1);
  });
});

describe('XSL-FO 変換: 絶対配置・脚注・空白の扱い', () => {
  it('一括指定の position="absolute" も絶対配置になり、上下左右の指定で枠の外の端を基準の領域に合わせる (§7.31.20)', () => {
    const s = seq(fo('<fo:block-container position="absolute" left="0cm" top="0cm" right="0cm" bottom="0cm" border-style="solid" border-width="1pt"><fo:block>a</fo:block></fo:block-container>'));
    const c = s.flow.children[0] as LBlockContainer;
    expect(c.type).toBe('block-container');
    expect(c.absolutePosition).toBe(true);
    // 本文領域の原点 (10mm, 15mm) に枠の外の端
    expect(c.left).toBeCloseTo((10 * 72) / 25.4, 1);
    expect(c.top).toBeCloseTo((15 * 72) / 25.4, 1);
    // 内容の高さ = 本文領域の高さ (75mm) − 上下の枠
    expect(c.height).toBeCloseTo((75 * 72) / 25.4 - 2, 1);
  });

  it('top・left と height を指定した絶対配置は、従来どおり内容の端を top・left に合わせる', () => {
    const s = seq(fo('<fo:block-container absolute-position="absolute" left="0cm" top="0cm" height="20mm" border-style="solid" border-width="1pt"><fo:block>a</fo:block></fo:block-container>'));
    const c = s.flow.children[0] as LBlockContainer;
    expect(c.top).toBeCloseTo((15 * 72) / 25.4 - 1, 1);
  });

  it('脚注本体の文字の大きさは周りから受け継ぐ (HTML 向けの 0.8 倍にしない)', () => {
    const xml = fo('<fo:block font-size="10pt">本文<fo:footnote><fo:inline font-size="75%">(1)</fo:inline><fo:footnote-body><fo:block>脚注</fo:block></fo:footnote-body></fo:footnote></fo:block>');
    const tree = E.engine.layout(imp(xml).document);
    const sizes: number[] = [];
    const pg = tree.sheets[0].page as unknown as { regionBody: Parameters<typeof walk>[0]; absoluteAreas?: Parameters<typeof walk>[0][] };
    for (const r of [pg.regionBody, ...(pg.absoluteAreas ?? [])]) walk(r, (n) => n.type === 'glyph' && (n as { text: string }).text.includes('脚') && sizes.push((n as { fontSize: number }).fontSize));
    expect(sizes.length).toBeGreaterThan(0);
    for (const v of sizes) expect(v).toBeCloseTo(10);
  });

  it('break-before の後のページ先頭では、conditionality="discard" の space-before を捨てる (§4.3.1)', () => {
    const xml = fo('<fo:block>a</fo:block><fo:block break-before="page" space-before="20mm">b</fo:block><fo:block break-before="page" space-before="20mm" space-before.conditionality="retain">c</fo:block>');
    const tree = E.engine.layout(imp(xml).document);
    const firstY = (k: number) => tree.sheets[k].page.regionBody.children[0].y;
    expect(tree.sheets.length).toBe(3);
    expect(firstY(1)).toBeCloseTo(firstY(0), 1);
    expect(firstY(2) - firstY(0)).toBeCloseTo((20 * 72) / 25.4, 1);
  });

  it('fo:inline の端の空白は残し、行の先頭・末尾の空白だけを消す (§7.16.8)', () => {
    const b = seq(fo('<fo:block>Hello<fo:inline font-weight="bold"> world </fo:inline>!</fo:block>')).flow.children[0] as LBlock;
    const text = (v: unknown): string => (typeof v === 'string' ? v : ((v as { children?: unknown[] }).children ?? []).map(text).join(''));
    expect(text(b)).toBe('Hello world !');
    const b2 = seq(fo('<fo:block><fo:inline> x </fo:inline></fo:block>')).flow.children[0] as LBlock;
    expect(text(b2)).toBe('x');
  });
});

describe('XSL-FO 変換: 仕様との照合', () => {
  const tableArea = (xml: string) => {
    const tree = E.engine.layout(imp(xml).document);
    let t: { columnSizes: number[] } | undefined;
    walk(tree.sheets[0].page.regionBody, (n) => {
      if (n.type === 'table' && !t) t = n as unknown as { columnSizes: number[] };
    });
    return t!;
  };

  it('proportional-column-width(N)+長さ の列幅 (§6.7.1.1.2 の例)', () => {
    const t = tableArea(fo(`<fo:table width="12cm" table-layout="fixed"><fo:table-column column-width="proportional-column-width(1)"/><fo:table-column column-width="proportional-column-width(2)+2pc"/><fo:table-column column-width="72pt"/>
      <fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`));
    expect(t.columnSizes[0]).toBeCloseTo(81.39, 1);
    expect(t.columnSizes[1]).toBeCloseTo(186.77, 1);
    expect(t.columnSizes[2]).toBeCloseTo(72, 1);
  });
});

describe('XSL-FO 変換: リストの字下げ (仕様との照合)', () => {
  const list = (attrs: string, label: string, body: string) =>
    seq(fo(`<fo:list-block ${attrs}><fo:list-item><fo:list-item-label ${label}><fo:block>•</fo:block></fo:list-item-label><fo:list-item-body ${body}><fo:block>本文</fo:block></fo:list-item-body></fo:list-item></fo:list-block>`)).flow.children[0] as LTable;
  it('ラベル・本体の start-indent は参照領域からの位置。list-block 自身の start-indent を二重に足さない (§5.3.2)', () => {
    const t = list('start-indent="20pt"', 'end-indent="label-end()"', 'start-indent="40pt"');
    expect((t.margin as Record<string, number>).left).toBe(20);
    // 本体の始端 40pt = リストの始端 20pt + ラベルの列 20pt
    expect(t.columns[0].width).toBe(20);
  });
  it('label-end() のラベルの終端は provisional-distance-between-starts − provisional-label-separation (§7.30.11)', () => {
    const t = list('', 'end-indent="label-end()"', 'start-indent="50pt"');
    expect(t.columns[0].width).toBe(50);
    // ラベルの終端 = 24 − 6 = 18pt → 列の終端 (50pt) から 32pt 空ける
    expect((t.body.rows[0].cells[0].padding as Record<string, number>).right).toBe(32);
  });
});

describe('XSL-FO 変換: 表の仕様との照合 (続き)', () => {
  const tbl = (inner: string, attrs = '', o: ImportOptions = {}) =>
    imp(fo(`<fo:table ${attrs}><fo:table-column column-width="20mm"/><fo:table-column column-width="20mm"/><fo:table-column column-width="20mm"/>${inner}</fo:table>`), o).document.sequences[0].flow.children[0] as LTable;
  const c = (t: string, a = '') => `<fo:table-cell ${a}><fo:block>${t}</fo:block></fo:table-cell>`;
  it('border-separation: 罫線を分ける表のセルの間隔 (§7.28.5)', () => {
    const t = tbl(`<fo:table-body><fo:table-row>${c('a')}${c('b')}</fo:table-row></fo:table-body>`, 'border-collapse="separate" border-separation="4pt"');
    expect(t.borderSpacing).toEqual({ i: 4, b: 4 });
    const tree = E.engine.layout({ type: 'document', sequences: [{ ...imp(fo('<fo:block/>')).document.sequences[0], flow: { type: 'flow', children: [t] } }] } as never);
    const xs: number[] = [];
    walk(tree.sheets[0].page.regionBody, (n) => n.type === 'table-cell' && xs.push(n.x));
    expect(xs[0]).toBeCloseTo(4, 1);
    expect(xs[1] - xs[0]).toBeCloseTo((20 * 72) / 25.4 + 4, 1);
  });
  it('empty-cells="hide": 罫線を分ける表で、中身の無いセルの罫線と背景を描かない (§7.28.10)', () => {
    const t = tbl(`<fo:table-body><fo:table-row>${c('a', 'border="1pt solid black" background-color="red"')}${c('', 'border="1pt solid black" background-color="red"')}</fo:table-row></fo:table-body>`, 'border-collapse="separate" empty-cells="hide"');
    const [a, b] = t.body.rows[0].cells;
    expect(a.border).toBeDefined();
    expect([b.border, b.backgroundColor]).toEqual([undefined, undefined]);
  });
  it('table-row の無い表: starts-row・ends-row で行を分ける。column-number のセルはその列に置く', () => {
    const t = tbl(`<fo:table-body>${c('a')}${c('b', 'ends-row="true"')}${c('c', 'column-number="3"')}${c('d', 'starts-row="true"')}</fo:table-body>`);
    expect(t.body.rows.map((r) => r.cells.length)).toEqual([2, 3, 1]);
    expect(t.body.rows[1].cells[2].children.length).toBe(1);
    expect(t.body.rows[1].cells[0].children).toEqual([]);
  });
  it('仕様モード: 行の height は minimum = optimum = maximum (§7.15.3)。互換モードは最小の高さ', () => {
    const row = (o: ImportOptions) => tbl(`<fo:table-body><fo:table-row height="30pt">${c('a')}</fo:table-row></fo:table-body>`, '', o).body.rows[0];
    expect([row({ compat: 'spec' }).minHeight, row({ compat: 'spec' }).maxHeight]).toEqual([30, 30]);
    expect([row({}).minHeight, row({}).maxHeight]).toEqual([30, undefined]);
    const r2 = tbl(`<fo:table-body><fo:table-row block-progression-dimension.minimum="10pt" block-progression-dimension.optimum="30pt">${c('a')}</fo:table-row></fo:table-body>`, '', { compat: 'spec' }).body.rows[0];
    expect(r2.minHeight).toBe(30);
  });
});

describe('XSL-FO 変換: ページ・位置の仕様との照合', () => {
  const abs = (attrs: string) => seq(fo(`<fo:block-container absolute-position="absolute" ${attrs}><fo:block>a</fo:block></fo:block-container>`)).flow.children[0] as LBlockContainer;
  const mm = (v: number) => (v * 72) / 25.4;
  it('right・bottom は本文領域の右端・下端から測る (§7.6.1)。組むときはページの端からの値にする', () => {
    // ページ 100mm 角、余白 10mm、本文領域の上の余白 5mm → 本文の右端はページの端から 10mm、下端は 10mm
    const c = abs('right="0mm" bottom="0mm" width="30mm" height="10mm"');
    expect(c.right).toBeCloseTo(mm(10), 1);
    expect(c.bottom).toBeCloseTo(mm(10), 1);
  });
  it('幅の指定が無く left だけなら、本文領域の右端まで', () => {
    const c = abs('left="10mm" top="0mm"');
    expect(c.right).toBeCloseTo(mm(10), 1);
  });
  it('absolute-position="fixed" はページを基準にする', () => {
    const c = seq(fo('<fo:block-container absolute-position="fixed" left="0mm" top="0mm" width="10mm" height="10mm"><fo:block>a</fo:block></fo:block-container>')).flow.children[0] as LBlockContainer;
    expect([c.left, c.top]).toEqual([0, 0]);
  });
  it('リージョンの extent・本文の余白の百分率 (§7.27.4)、負の extent は 0', () => {
    const PM2 = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="200mm"><fo:region-body margin-top="10%"/><fo:region-before extent="10%"/><fo:region-after extent="-5mm"/></fo:simple-page-master></fo:layout-master-set>`;
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM2}<fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before"><fo:block>h</fo:block></fo:static-content><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const s = seq(xml);
    expect(s.master.margins.top).toBeCloseTo(10, 1); // 幅 100mm の 10%
    const head = s.staticContent!.find((c) => (c as LBlockContainer).top === 0) as LBlockContainer;
    expect(head.height).toBeCloseTo(mm(20), 1); // 高さ 200mm の 10%
  });
  it('ページマスターの em は fo:root の font-size が基準', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS} font-size="8pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin-top="2em"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    expect(seq(xml).master.margins.top).toBeCloseTo(16 / (72 / 25.4), 2);
  });
});

describe('XSL-FO 変換: 余白の仕様との照合 (§4.3.1)', () => {
  // id の付いたブロックの、本文領域の中での絶対の y (内容の端。親の位置・罫線・余白を足す)
  const ys = (flow: string) => {
    const tree = E.engine.layout(imp(fo(flow)).document);
    const out: Record<string, number> = {};
    type A = { type: string; y: number; sourceId?: string; children?: A[]; border: { top?: { width: number } }; padding: { top: number } };
    const rec = (a: A, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'block' && a.sourceId) out[a.sourceId] = y;
      for (const c of a.children ?? []) rec(c, y + (a.border.top?.width ?? 0) + a.padding.top);
    };
    rec(tree.sheets[0].page.regionBody as unknown as A, 0);
    return { out, tree };
  };
  it('同じ優先度の余白は、符号も含めて最も大きい値 (負の余白を正の余白に足さない)', () => {
    const { out } = ys('<fo:block id="a" space-after="10pt">a</fo:block><fo:block id="b" space-before="-4pt">b</fo:block>');
    const { out: ref } = ys('<fo:block id="a" space-after="10pt">a</fo:block><fo:block id="b">b</fo:block>');
    expect(out.b - out.a).toBeCloseTo(ref.b - ref.a, 1);
  });
  it('list-item の space-before / space-after は隣の項目と重ね合わせる (足し合わせない)', () => {
    const item = (id: string) => `<fo:list-item id="${id}" space-before="6pt" space-after="6pt"><fo:list-item-label end-indent="label-end()"><fo:block>•</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()"><fo:block>本文</fo:block></fo:list-item-body></fo:list-item>`;
    const tree = E.engine.layout(imp(fo(`<fo:list-block>${item('i1')}${item('i2')}</fo:list-block>`)).document);
    const rows: Array<{ y: number; h: number }> = [];
    walk(tree.sheets[0].page.regionBody, (n) => n.type === 'table-row' && rows.push({ y: n.y, h: n.height }));
    expect(rows.length).toBe(2);
    expect(rows[1].y - (rows[0].y + rows[0].h)).toBeCloseTo(6, 1);
  });
  it('ブロックコンテナは参照領域: 中の先頭の space-before は外の余白と重ねず、捨てる (§4.2.5)', () => {
    const { out } = ys('<fo:block id="a" space-after="10pt">a</fo:block><fo:block-container><fo:block id="b" space-before="20pt">b</fo:block></fo:block-container>');
    const { out: ref } = ys('<fo:block id="a" space-after="10pt">a</fo:block><fo:block id="b">b</fo:block>');
    expect(out.b - out.a).toBeCloseTo(ref.b - ref.a, 1);
  });
  it('margin・padding・text-indent の百分率は、包含ブロック (親の内容) の幅が基準 (§7.11.1)', () => {
    const d = imp(fo('<fo:block start-indent="20mm"><fo:block id="x" padding-start="10%">a</fo:block></fo:block>')).document;
    const inner = (d.sequences[0].flow.children[0] as LBlock).children[0] as LBlock;
    // 本文の幅 80mm − 字下げ 20mm = 60mm の 10%
    expect((inner.padding as Record<string, number>).left).toBeCloseTo((6 * 72) / 25.4, 1);
  });
  it('height の百分率は、高さの決まった包含ブロックの高さが基準 (§7.15.6)', () => {
    const d = imp(fo('<fo:block-container height="40mm"><fo:block-container id="x" height="50%"><fo:block>a</fo:block></fo:block-container></fo:block-container>')).document;
    const outer = d.sequences[0].flow.children[0] as LBlockContainer;
    expect((outer.children[0] as LBlockContainer).height).toBeCloseTo((20 * 72) / 25.4, 1);
  });
  it('border の conditionality="retain": ページで分かれた続きの断片にも、前側の罫線を付ける', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `行${i}`).join('\n');
    const xml = fo(`<fo:block linefeed-treatment="preserve" border-before-style="solid" border-before-width="2pt" border-before-width.conditionality="retain">${lines}</fo:block>`);
    const tree = E.engine.layout(imp(xml).document);
    expect(tree.sheets.length).toBeGreaterThan(1);
    let top: number | undefined;
    walk(tree.sheets[1].page.regionBody, (n) => n.type === 'block' && n.border.top && top === undefined && (top = n.border.top.width));
    expect(top).toBe(2);
  });
});

describe('XSL-FO 変換: 行の仕様との照合', () => {
  const lineYs = (flow: string, o: ImportOptions = {}) => {
    const tree = E.engine.layout(imp(fo(flow), o).document);
    const ys: number[] = [];
    walk(tree.sheets[0].page.regionBody, (n) => n.type === 'line' && ys.push(n.y));
    return ys;
  };
  it('font-height: 行送りは中の字の大きさによらず line-height (§4.5)', () => {
    const ys = lineYs('<fo:block font-size="10pt" line-height="2" line-stacking-strategy="font-height" linefeed-treatment="preserve">a\n<fo:inline font-size="24pt">大</fo:inline>\nc</fo:block>');
    expect(ys.length).toBe(3);
    expect(ys[1] - ys[0]).toBeCloseTo(20, 1);
    expect(ys[2] - ys[1]).toBeCloseTo(20, 1);
  });
  it('仕様モード max-height: 小さい字だけの行も、ブロックの字の高さ + 半行間 (§4.5)', () => {
    const ys = lineYs('<fo:block font-size="10pt" line-height="12pt" linefeed-treatment="preserve"><fo:inline font-size="6pt">a</fo:inline>\n<fo:inline font-size="6pt">b</fo:inline>\nc</fo:block>', { compat: 'spec' });
    expect(ys[1] - ys[0]).toBeCloseTo(12, 0);
  });
  it('baseline-shift の百分率は親の line-height、em はその inline の font-size が基準 (§7.14.3)', () => {
    const inl = (attrs: string) => ((seq(fo(`<fo:block font-size="10pt" line-height="2"><fo:inline ${attrs}>x</fo:inline></fo:block>`)).flow.children[0] as LBlock).children[0] as { baselineShift?: number });
    expect(inl('baseline-shift="50%"').baselineShift).toBeCloseTo(10, 5);
    expect(inl('font-size="5pt" baseline-shift="1em"').baselineShift).toBeCloseTo(5, 5);
  });
  it('leader の初期値: rule-thickness 1pt、leader-length は 0pt / 12pt / 100% (§7.22.4・§7.22.6)', () => {
    const ld = (seq(fo('<fo:block><fo:leader leader-pattern="rule"/></fo:block>')).flow.children[0] as LBlock).children[0] as { ruleThickness?: number; length?: unknown; lengthPct?: unknown };
    expect(ld.ruleThickness).toBe(1);
    expect(ld.length).toEqual({ minimum: 0, optimum: 12 });
    expect(ld.lengthPct).toEqual({ maximum: 1 });
  });
  it('仕様モード letter-spacing: Alphabetic の字の前後に半分ずつ、行末の分は捨てる (§7.17.2)', () => {
    const right = (o: ImportOptions) => {
      const tree = E.engine.layout(imp(fo('<fo:block letter-spacing="4pt" text-align="end">ab c</fo:block>'), o).document);
      let r = 0;
      const rec = (a: { type: string; x: number; width: number; children?: unknown[] }, ox: number) => {
        const x = ox + a.x;
        if (a.type === 'glyph') r = Math.max(r, x + a.width);
        for (const c of (a.children ?? []) as never[]) rec(c, x);
      };
      for (const c of tree.sheets[0].page.regionBody.children as never[]) rec(c, 0);
      return r;
    };
    // 末尾揃え: 最後の字の右端が本文の右端 (80mm) に来る (行末の letter-spacing を残さない)
    expect(right({ compat: 'spec' })).toBeCloseTo((80 * 72) / 25.4, 0);
  });
  it('white-space-treatment="preserve" の行末の空白は消さない (§7.16.8)', () => {
    const glyphs = (attrs: string) => {
      const tree = E.engine.layout(imp(fo(`<fo:block ${attrs} text-align="end">a   </fo:block>`)).document);
      const out: string[] = [];
      walk(tree.sheets[0].page.regionBody, (n) => n.type === 'glyph' && out.push((n as { text: string }).text));
      return out.join('');
    };
    expect(glyphs('white-space-treatment="preserve" white-space-collapse="false"')).toBe('a   ');
    expect(glyphs('')).toBe('a');
  });
});

describe('XSL-FO 変換: rule の leader の位置', () => {
  it('線の中心は基線 (太さは上下に等しく。§7.22.6)', () => {
    const tree = E.engine.layout(imp(fo('<fo:block font-size="14pt" text-align-last="justify">a<fo:leader leader-pattern="rule" rule-thickness="5pt"/>b</fo:block>')).document);
    type A = { type: string; x: number; y: number; height: number; backgroundColor?: string; baselineY?: number; children?: A[] };
    let ruleMid: number | undefined;
    let base: number | undefined;
    const rec = (a: A, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'block' && a.backgroundColor && Math.abs(a.height - 5) < 0.01) ruleMid = y + a.height / 2;
      if (a.type === 'glyph' && base === undefined && a.baselineY !== undefined) base = y + a.baselineY;
      for (const c of a.children ?? []) rec(c, y);
    };
    rec(tree.sheets[0].page.regionBody as unknown as A, 0);
    expect(ruleMid).toBeDefined();
    expect(ruleMid!).toBeCloseTo(base!, 1);
  });
});

describe('XSL-FO 変換: 画像', () => {
  it('external-graphic は、画像に書かれた解像度で本来の大きさを決める (content-width の百分率はその大きさに掛ける)', () => {
    const img = (attrs: string) => (seq(fo(`<fo:block><fo:external-graphic src="a.png" ${attrs}/></fo:block>`)).flow.children[0] as LBlock).children[0] as LImage;
    expect(img('').intrinsicFromImage).toBe(true);
    expect(img('').resolutionFromImage).toBeUndefined();
  });
  it('見つからない・読めない画像は警告を出す', async () => {
    const { AssetStore } = await import('../src/assets');
    const { LayoutEngine } = await import('../src/layoutEngine');
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: 'Noto Serif JP', assets: new AssetStore() });
    const tree = engine.layout(imp(fo('<fo:block><fo:external-graphic src="missing.bmp"/></fo:block>')).document);
    expect(tree.warnings.some((w) => w.includes('missing.bmp'))).toBe(true);
  });
});

describe('XSL-FO 変換: 画像のある行の半行間', () => {
  it('行の高さを超える画像の行も、ブロックの半行間 (line-height と字の大きさの差の半分) を上下に空ける (§4.5)', () => {
    const xml = fo('<fo:block font-size="10pt" line-height="12pt"><fo:block>a</fo:block><fo:external-graphic content-width="50pt" content-height="50pt" src="x.png"/></fo:block>');
    const tree = E.engine.layout(imp(xml).document);
    const lines: Array<{ y: number; h: number }> = [];
    walk(tree.sheets[0].page.regionBody, (n) => n.type === 'line' && lines.push({ y: n.y, h: n.height }));
    // 画像の行: 画像 50pt (下端が基線) + ブロックの字の下がり 1.2pt (10pt の字の em の箱の下。nominal-requested-line-rectangle) + 上下の半行間 1pt ずつ
    expect(lines[1].h).toBeCloseTo(53.2, 1);
  });
});

describe('XSL-FO 変換: 空白・セルの幅・リージョンの罫線', () => {
  it('改行しない空白 (U+00A0) だけの文字列は、ブロックの間でも消さない', () => {
    const b = seq(fo('<fo:block>a<fo:block/>&#xA0;<fo:block/>&#xA0;</fo:block>')).flow.children[0] as LBlock;
    expect(JSON.stringify(b)).toContain(' ');
  });
  it('セルの幅の指定 (inline-progression-dimension) を、幅の指定の無い列の幅にする', () => {
    const t = seq(fo('<fo:table><fo:table-body><fo:table-row><fo:table-cell inline-progression-dimension="30mm"><fo:block>a</fo:block></fo:table-cell><fo:table-cell inline-progression-dimension="20mm"><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>')).flow.children[0] as LTable;
    expect(t.columns.map((c) => Math.round(c.width as number))).toEqual([85, 57]);
    expect(t.fitContent).toBeUndefined();
  });
  it('互換モード: リージョンの罫線を描く (アンテナハウスの拡張)。仕様モードは描かない', () => {
    const PM2 = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body border="1pt solid red"/></fo:simple-page-master></fo:layout-master-set>`;
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM2}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const hasBorder = (o: ImportOptions) => (imp(xml, o).document.sequences[0].staticContent ?? []).some((c) => !!(c as LBlockContainer).border);
    expect(hasBorder({})).toBe(true);
    expect(hasBorder({ compat: 'spec' })).toBe(false);
  });
});

describe('XSL-FO 変換: アンテナハウス拡張のページの指定', () => {
  const xmlWith = (pmAttrs: string, psAttrs = '') =>
    `<?xml version="1.0"?><fo:root ${NS} xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="182mm" page-height="257mm" ${pmAttrs}><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m" ${psAttrs}><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
  it('axf:printer-marks・axf:crop-offset・axf:bleed・axf:printer-marks-line-width でトンボを付ける', () => {
    const m = seq(xmlWith('axf:printer-marks="crop" axf:crop-offset="20mm 14mm" axf:bleed="4mm" axf:printer-marks-line-width="0.25pt"')).master;
    expect(m.trimMarks).toBe(true);
    expect(m.bleed).toBeCloseTo(4, 3);
    expect(m.centerMarks).toBe(false);
    expect(m.cornerMarks).toBeUndefined();
    const mm4 = m.trimMarkMargins!;
    expect([mm4.top, mm4.right, mm4.bottom, mm4.left].map((v) => Math.round(v * 1000) / 1000)).toEqual([16, 10, 16, 10]);
    expect(m.trimMarkLineWidth).toBe(0.25);
    const tree = E.engine.layout(imp(xmlWith('axf:printer-marks="crop cross" axf:crop-offset="20mm 14mm" axf:bleed="4mm"')).document);
    const sheet = tree.sheets[0];
    // 紙の大きさ = 仕上がり + 左右 14mm・上下 20mm
    expect(sheet.width).toBeCloseTo(((182 + 28) * 72) / 25.4, 1);
    expect(sheet.height).toBeCloseTo(((257 + 40) * 72) / 25.4, 1);
  });
  it('page-sequence の axf:background-image をページの背景画像にする', () => {
    const m = seq(xmlWith('', 'axf:background-image="a.svg" axf:background-repeat="no-repeat" axf:background-position-horizontal="center"')).master;
    expect(m.backgroundImage).toMatchObject({ src: 'a.svg', repeat: 'no-repeat', x: 'center' });
  });
});

describe('XSL-FO 変換: 表の列の幅・max-width・脚注の区切り・絶対配置', () => {
  it('表の列の幅の百分率は、表の幅 (本文の幅から start-indent・end-indent を引いた幅) に対する値', () => {
    const t = seq(fo('<fo:table table-layout="fixed" start-indent="10%" end-indent="10%"><fo:table-column column-width="50%"/><fo:table-column column-width="40%"/><fo:table-body><fo:table-row><fo:table-cell><fo:block>a</fo:block></fo:table-cell><fo:table-cell><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>')).flow.children[0] as LTable;
    const w = t.columns.map((c) => c.width as number);
    expect(w[0] / w[1]).toBeCloseTo(50 / 40, 3);
    // 本文の幅の 80% の 50%
    expect(w[0] + w[1]).toBeCloseTo((w[0] / 0.5) * 0.9, 1);
  });
  it('block-container の max-width (アンテナハウスの拡張で書ける CSS の属性) を、幅の上限にする', () => {
    const c = seq(fo('<fo:block-container max-width="10em" font-size="10pt"><fo:block>a</fo:block></fo:block-container>')).flow.children[0] as LBlockContainer;
    expect(c.width).toBeCloseTo(100, 1);
  });
  it('脚注の区切りの static-content が無ければ、区切り線を描かない', () => {
    expect(seq(fo('<fo:block>a</fo:block>')).footnotes?.separator).toBe(false);
  });
  it('互換モード: top だけを指定した絶対配置のコンテナは、基準の領域の下端まで伸ばす (仕様モードは中身の高さ)', () => {
    const xml = fo('<fo:block-container height="100pt"><fo:block-container absolute-position="absolute" top="10pt"><fo:block>a</fo:block></fo:block-container></fo:block-container>');
    const inner = (o: ImportOptions) => ((imp(xml, o).document.sequences[0].flow.children[0] as LBlockContainer).children[0] as LBlockContainer).height;
    expect(inner({})).toBeCloseTo(90, 1);
    expect(inner({ compat: 'spec' })).toBeUndefined();
  });
});

describe('段組: span の後の強制の段区切り', () => {
  it('2 段目の頭の retain の余白は、見出しの space-after と二重に空けない (1 段目と頭がそろう)', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200mm" page-height="150mm" margin="10mm">
      <fo:region-body column-count="2" column-gap="10mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
      <fo:block font-size="24pt" span="all" space-after="0.6em">H</fo:block>
      <fo:block id="a" space-before="5mm" space-before.conditionality="retain" border="1pt solid">A</fo:block>
      <fo:block id="c" break-before="column" space-before="5mm" space-before.conditionality="retain" border="1pt solid">C</fo:block>
      </fo:flow></fo:page-sequence></fo:root>`;
    const tree = E.engine.layout(imp(xml).document);
    const ys: Record<string, number> = {};
    const visit = (a: BlockArea, y0: number) => {
      const y = y0 + (a.y ?? 0);
      const id = a.sourceId;
      if (id) ys[id] = y;
      for (const c of (a as { children?: BlockArea[] }).children ?? []) visit(c, y);
    };
    visit(tree.sheets[0].page.regionBody as unknown as BlockArea, 0);
    expect(ys.a).toBeDefined();
    expect(ys.c).toBeCloseTo(ys.a, 1);
  });
});

describe('リージョンの枠線 (互換モード)', () => {
  it('中身はリージョンの枠線の内側に置き、本文領域も枠線の分だけ狭める', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm">
      <fo:region-body margin-top="20mm" border-style="solid" border-width="1pt"/><fo:region-before extent="15mm" border-style="solid" border-width="3pt"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:static-content flow-name="xsl-region-before"><fo:block>H</fo:block></fo:static-content><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const s = imp(xml).document.sequences[0];
    const mm = (v: number) => (v * 72) / 25.4;
    expect(s.master.margins.top).toBeCloseTo(30 + 1 / (72 / 25.4));
    const found: LBlockContainer[] = [];
    const visit = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      const o = v as LBlockContainer;
      if (o.type === 'block-container' && o.absolutePosition) found.push(o);
      for (const x of Object.values(v as object)) visit(x);
    };
    visit(s);
    const head = found.find((c) => JSON.stringify(c.children).includes('"H"'))!;
    expect(head.top).toBeCloseTo(mm(10) + 3);
    expect(head.left).toBeCloseTo(mm(10) + 3);
    expect(head.height).toBeCloseTo(mm(15) - 6);
  });
});

describe('傍注 (axf:footnote-position="outside")', () => {
  it('奇数ページは region-end の領域に、参照する行の高さから置き、ページ末尾の脚注領域は使わない', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS} xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200mm" page-height="150mm" margin="10mm">
      <fo:region-body margin-right="50mm" axf:footnote-position="outside"/><fo:region-end extent="40mm"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>本文<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>注の本文</fo:block></fo:footnote-body></fo:footnote>です。</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = imp(xml);
    const sn = r.document.sequences[0].master.sideNotes!;
    expect(sn.end!.x).toBeCloseTo(140);
    expect(sn.end!.width).toBeCloseTo(40);
    const tree = E.engine.layout(r.document);
    const body = tree.sheets[0].page.regionBody as unknown as BlockArea;
    const mm = (v: number) => (v * 72) / 25.4;
    const note = (body.children as BlockArea[]).find((c) => c.x > mm(100));
    expect(note).toBeDefined();
    expect(note!.x).toBeCloseTo(mm(140));
    expect(note!.width).toBeCloseTo(mm(40));
    expect(note!.y).toBeLessThan(mm(10));
  });
});

describe('内容が消える不具合 (全体のレビュー)', () => {
  const textOf = (t: ReturnType<typeof E.engine.layout>, k: number) => {
    let s = '';
    const rec = (a: Record<string, unknown>) => {
      if (a.type === 'glyph') s += a.text as string;
      for (const key of ['children', 'glyphs', 'base', 'absoluteAreas']) for (const c of (a[key] as Record<string, unknown>[]) ?? []) rec(c);
      if (a.regionBody) rec(a.regionBody as Record<string, unknown>);
    };
    rec(t.sheets[k].page as unknown as Record<string, unknown>);
    return s;
  };

  it('子に marker があっても、inline と inline の間の空白は残す (§7.16.8)', () => {
    const b = seq(fo('<fo:block><fo:marker marker-class-name="h">H</fo:marker><fo:inline>Left</fo:inline> <fo:inline>Right</fo:inline></fo:block>')).flow.children[0] as LBlock;
    expect(JSON.stringify(b.children)).toMatch(/"Left"\]\},(" "|\{[^}]*" ")/);
  });

  it('last のページマスターで組み直しても、id の飛び先は組み直した後のページを指す', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set>
      <fo:simple-page-master master-name="a" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>
      <fo:simple-page-master master-name="z" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master>
      <fo:page-sequence-master master-name="s"><fo:repeatable-page-master-alternatives>
        <fo:conditional-page-master-reference master-reference="z" page-position="last"/>
        <fo:conditional-page-master-reference master-reference="a"/>
      </fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>
      <fo:bookmark-tree><fo:bookmark internal-destination="tgt"><fo:bookmark-title>T</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>
      <fo:page-sequence master-reference="s"><fo:flow flow-name="xsl-region-body">
      <fo:block>1</fo:block><fo:block break-before="page" id="tgt">2</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const t = E.engine.layout(imp(xml).document);
    expect(t.destinations).toEqual({ tgt: 1 });
    expect(t.bookmarks?.[0].sheet).toBe(1);
  });

  it('ページをまたいで分けた表のセルの中の脚注も、本体を脚注領域に置く', () => {
    const long = Array.from({ length: 40 }, (_, k) => `<fo:block>行${k}</fo:block>`).join('');
    const xml = fo(`<fo:table><fo:table-column column-width="40mm"/><fo:table-column column-width="40mm"/><fo:table-body><fo:table-row>
      <fo:table-cell><fo:block>注<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>脚注の本体</fo:block></fo:footnote-body></fo:footnote></fo:block>${long}</fo:table-cell>
      <fo:table-cell><fo:block>右</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`);
    const t = E.engine.layout(imp(xml).document);
    expect(t.sheets.length).toBeGreaterThan(1);
    expect(textOf(t, 0)).toContain('脚注の本体');
  });
});

describe('XSL-FO の規格どおりでない読み方 (全体のレビュー)', () => {
  it('絶対と相対の padding・罫線を両方書いたら、絶対が勝つ (§5.3.1)', () => {
    const b = seq(fo('<fo:block padding-top="2pt" padding-before="9pt" border-top-style="solid" border-before-style="dashed" border-top-width="1pt">x</fo:block>')).flow.children[0] as LBlock;
    expect((b.padding as Record<string, number>).top).toBe(2);
    expect((b.border as Record<string, { style?: string }>).top.style ?? 'solid').toBe('solid');
  });
  it('page-sequence-wrapper の中の page-sequence を組む (§6.4.6)', () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence-wrapper><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:page-sequence-wrapper></fo:root>`;
    expect(imp(xml).document.sequences.length).toBe(1);
  });
  it('provisional-distance-between-starts は入れ子のリストに継承される', () => {
    const inner = '<fo:list-block><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>-</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()"><fo:block>y</fo:block></fo:list-item-body></fo:list-item></fo:list-block>';
    const xml = fo(`<fo:list-block provisional-distance-between-starts="50pt"><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()">${inner}</fo:list-item-body></fo:list-item></fo:list-block>`);
    const outer = seq(xml).flow.children[0] as LTable;
    const innerT = outer.body.rows[0].cells[1].children[0] as LTable;
    expect(innerT.columns[0].width).toBe(50);
  });
  it('list-item・table-row の break-before と keep-together、label の書式と id', () => {
    const xml = fo(`<fo:list-block><fo:list-item break-before="page" keep-together.within-page="always"><fo:list-item-label id="L1" color="red"><fo:block>1</fo:block></fo:list-item-label><fo:list-item-body><fo:block>x</fo:block></fo:list-item-body></fo:list-item></fo:list-block>
      <fo:table><fo:table-body><fo:table-row break-after="page"><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`);
    const [list, table] = seq(xml).flow.children as LTable[];
    expect(list.body.rows[0]).toMatchObject({ breakBefore: true, keepTogether: true });
    expect(list.body.rows[0].cells[0]).toMatchObject({ id: 'L1', color: 'red' });
    expect(table.body.rows[0].breakAfter).toBe(true);
  });
  it('fo:character の空白を残し、書式を当てる', () => {
    const b = seq(fo('<fo:block>a<fo:character character=" "/>b<fo:character character="X" color="red"/></fo:block>')).flow.children[0] as LBlock;
    const json = JSON.stringify(b.children);
    expect(json).toContain('"a b"');
    expect(json).toContain('"color":"red"');
  });
  it('table-and-caption の id を残す', () => {
    const b = seq(fo('<fo:table-and-caption id="tc"><fo:table><fo:table-body><fo:table-row><fo:table-cell><fo:block>c</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:table-and-caption>')).flow.children[0] as LBlock;
    expect(b.id).toBe('tc');
  });
  it('inline の space-start・space-end を外側の空きにする (§7.12.5)', () => {
    const b = seq(fo('<fo:block>a<fo:inline space-start="10pt" space-end="4pt">b</fo:inline></fo:block>')).flow.children[0] as LBlock;
    expect(JSON.stringify(b.children)).toContain('"inlineMargin":{"start":10,"end":4}');
  });
  it('読めない性質の値の関数は報告する (§5.10.4)', () => {
    const r = imp(fo('<fo:block font-size="from-parent(font-size) * 2">x</fo:block>'));
    expect(JSON.stringify(r.report)).toContain('from-parent');
  });
  it('static-content の文字の「{pageNumber}」はページ番号にしない', () => {
    const xml = fo('<fo:block>本文</fo:block>', '', '<fo:static-content flow-name="xsl-region-before"><fo:block>H {pageNumber} <fo:page-number/></fo:block></fo:static-content>');
    const t = E.engine.layout(imp(xml).document);
    let s = '';
    walk(t.sheets[0].page as never, (a) => {
      if (a.type === 'glyph') s += a.text;
    });
    expect(s).toContain('H {pageNumber} 1');
  });
});

describe('marker の中身は retrieve-marker の位置の文脈で読む (XSL 1.1 §6.13.5・§6.13.6)', () => {
  it('em は retrieve-marker の祖先の font-size から。marker の祖先の性質は引き継がない', () => {
    const s = seq(
      fo(
        '<fo:block font-size="20pt"><fo:marker marker-class-name="c"><fo:inline font-size="1.5em">X</fo:inline></fo:marker>本文</fo:block>',
        '',
        '<fo:static-content flow-name="xsl-region-before"><fo:block font-size="8pt"><fo:retrieve-marker retrieve-class-name="c"/></fo:block></fo:static-content>',
      ),
    );
    const json = JSON.stringify(s.staticContent);
    expect(json).toContain('"variants":{"0":[{"type":"inline","fontSize":12,"children":["X"]}]}');
  });
});

describe('脚注の参照記号の書式', () => {
  it('参照側の fo:inline の太さ・色・斜体も参照記号に使う', () => {
    const s = seq(fo('<fo:block>本文<fo:footnote><fo:inline font-size="70%" baseline-shift="super" font-weight="bold" color="red" font-style="italic">*</fo:inline><fo:footnote-body><fo:block>注</fo:block></fo:footnote-body></fo:footnote></fo:block>'));
    const fn = JSON.parse(JSON.stringify(s.flow.children[0])).children.find((c: { type?: string }) => c.type === 'footnote');
    expect(fn.referenceStyle).toEqual({ fontWeight: 700, color: 'red', fontStyle: 'italic' });
    expect([fn.referenceScale, fn.referenceShift]).toEqual([0.7, 'super']);
  });
});

describe('脚注の参照記号と marker の組版', () => {
  const glyphs = async (xml: string) => {
    const { AssetStore } = await import('../src/assets');
    const { LayoutEngine } = await import('../src/layoutEngine');
    const { walkAreaTree } = await import('../src/areaTree');
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: 'Noto Serif JP', assets: new AssetStore() });
    const out: Array<{ text: string; color?: string; fontWeight?: number; fontSize?: number }> = [];
    walkAreaTree(engine.layout(imp(xml).document), (a) => {
      if (a.type === 'glyph') out.push(a as never);
    });
    return out;
  };
  it('参照記号の字は参照側の inline の色・太さで組む', async () => {
    const gs = await glyphs(fo('<fo:block><fo:inline font-weight="bold">B</fo:inline>本文<fo:footnote><fo:inline font-weight="bold" color="red">*</fo:inline><fo:footnote-body><fo:block>注</fo:block></fo:footnote-body></fo:footnote></fo:block>'));
    const star = gs.find((g) => g.text === '*')!;
    // 太さは、同じ書体の太字の字と同じ (試験の書体に太字が無ければ、細字の書体の名前になる)
    expect([star.color, star.fontWeight]).toEqual(['red', gs.find((g) => g.text === 'B')!.fontWeight]);
    expect(gs.find((g) => g.text === '本')!.color).not.toBe('red');
  });
  it('柱の marker の em は、retrieve-marker の置き場の文字の大きさから', async () => {
    const gs = await glyphs(
      fo(
        '<fo:block font-size="20pt"><fo:marker marker-class-name="c"><fo:inline font-size="1.5em">X</fo:inline></fo:marker>本文</fo:block>',
        '',
        '<fo:static-content flow-name="xsl-region-before"><fo:block font-size="8pt"><fo:retrieve-marker retrieve-class-name="c"/></fo:block></fo:static-content>',
      ),
    );
    expect(gs.find((g) => g.text === 'X')?.fontSize).toBe(12);
  });
});

describe('セルの中の百分率の基準 (セルは参照領域)', () => {
  const widths = (table: string) => {
    const out: number[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as { type?: string; width?: number };
        if (o.type === 'block-container' && typeof o.width === 'number') out.push(+o.width.toFixed(3));
        Object.values(o).forEach(walk);
      }
    };
    walk(seq(fo(table)).flow.children);
    return out;
  };
  it('列の幅が長さで決まれば、またぐ列の幅から padding と罫線を引いた幅に対する値', () => {
    const w = widths(`<fo:table table-layout="fixed" width="300pt" border-collapse="separate" border-separation="4pt">
      <fo:table-column column-width="100pt"/><fo:table-column column-width="200pt"/>
      <fo:table-body>
        <fo:table-row><fo:table-cell padding="5pt" border="1pt solid black"><fo:block-container width="50%"><fo:block>a</fo:block></fo:block-container></fo:table-cell>
          <fo:table-cell number-rows-spanned="2"><fo:block-container width="50%"><fo:block>b</fo:block></fo:block-container></fo:table-cell></fo:table-row>
        <fo:table-row><fo:table-cell><fo:block-container width="50%"><fo:block>c</fo:block></fo:block-container></fo:table-cell></fo:table-row>
        <fo:table-row><fo:table-cell number-columns-spanned="2"><fo:block-container width="50%"><fo:block>d</fo:block></fo:block-container></fo:table-cell></fo:table-row>
      </fo:table-body></fo:table>`);
    // a: (100 − 10 − 2) / 2、b: 200 / 2、c: 1 列目 (2 列目は b が埋める) 100 / 2、d: (100 + 4 + 200) / 2
    expect(w).toEqual([44, 100, 50, 152]);
  });
});

describe('fo:bidi-override (XSL 1.1 §6.6.2)', () => {
  it('direction と unicode-bidi を持つ inline になる', () => {
    const json = JSON.stringify(seq(fo('<fo:block>a<fo:bidi-override direction="rtl" unicode-bidi="bidi-override">bc</fo:bidi-override></fo:block>')).flow.children);
    expect(json).toContain('"direction":"rtl"');
    expect(json).toContain('"unicodeBidi":"bidi-override"');
    expect(json).toContain('"bc"');
  });
});
