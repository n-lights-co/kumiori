/**
 * WeasyPrint の見本 (report・invoice・ticket・book) と対応仕様説明書の点検で見つけた不具合の修正。
 * テストの文書の文面と CSS の値は、見本 (他の人の著作物) から写さず、同じ振る舞いを試す自前のものにしている。直したもの:
 *  - break-before / break-after: always (Fragmentation 4) は page と同じ
 *  - 要素の content: '' は、::before / ::after が無ければ中身を捨てない (footer { content: '' })
 *  - 縦並びの flex の justify-content: space-between / space-around / space-evenly、flex の項目の margin: auto
 *  - 絶対配置の箱の margin (top に足す。top も bottom も無ければ static position を下げる)、絶対配置の表の幅は罫線を含む
 *  - 行内の要素の、中身の無いブロックの ::before (dt::before { content: ''; display: block }) は行を分ける
 *  - img の border・padding・背景色、余白の箱の z-index: -1、scaling="non-uniform" の SVG、fo:page-number-citation の書式
 *  - 残す空白 (pre・white-space-collapse="false") は追込みで詰めず、行頭の空白 (字下げ) と語を離さない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
import { AssetStore } from '../src/assets';
import { LayoutEngine } from '../src/layoutEngine';
import { paintSheet } from '../src/paint';
import { breakLines, flattenInline, markLineBreaks } from '../src/inlineLayout';
import { resolveStyle, type ResolvedStyle } from '../src/lnode';
import { FAMILY, doc, makeEngine, pt } from './helpers';
import type { ImageArea, LBlock, LBlockContainer, LImage, LInline, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

function load(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css });
}
/** body の中のブロック (flow の最初の子は body の箱) */
const flow = (body: string, css = '') => (load(body, css).document.sequences[0].flow.children[0] as LBlock).children as LBlock[];
/** 木の中の、条件に合う節をすべて集める */
function find<T>(root: unknown, pred: (n: Record<string, unknown>) => boolean): T[] {
  const out: T[] = [];
  const w = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(w);
    const o = n as Record<string, unknown>;
    if (pred(o)) out.push(o as T);
    for (const v of Object.values(o)) if (v && typeof v === 'object') w(v);
  };
  w(root);
  return out;
}

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const foFirst = <T>(body: string) => importXslFo(fo(body), parse, { compat: 'spec' }).document.sequences[0].flow.children[0] as T;

describe('改ページ・content・flex (WeasyPrint の report・invoice・ticket)', () => {
  it('break-before: always は page と同じ強制改ページ (break-after も)', () => {
    const [a, b] = flow('<h2>A</h2><h2 class="x">B</h2>', 'h2 { break-before: always } .x { break-before: auto; break-after: always }');
    expect(a.breakBefore).toBe('page');
    expect(b.breakBefore).toBeUndefined();
    expect(b.breakAfter).toBe('page');
  });
  it("要素の content: '' は、::before / ::after の content が無ければ中身を捨てない。::before があれば中身を置き換える", () => {
    const [footer] = flow('<footer><table><tr><td>Total</td></tr></table></footer>', "footer { content: '' }");
    expect(find<LTable>(footer, (n) => n.type === 'table')).toHaveLength(1);
    const [p] = flow('<p class="r">gone</p>', ".r { content: '' } .r::before { content: 'ref' }");
    expect(JSON.stringify(p.children)).not.toContain('gone');
    expect(JSON.stringify(p.children)).toContain('ref');
  });
  it('縦並びの flex (高さ指定) の justify-content: space-around は、箱の中で項目を上下に散らす', () => {
    const [stub] = flow(
      '<section><p>a</p><h2>b</h2><p>c</p></section>',
      'section { display: flex; flex-direction: column; height: 8cm; justify-content: space-around } p, h2 { margin: 0 }',
    ) as unknown as LBlockContainer[];
    expect(stub.type).toBe('block-container');
    expect(stub.blockAlign).toBe('space-around');
    // 組版: 3 つの子の前後と間に、余りが 1 : 2 : 2 : 1 で入る (最初の子の前の空きは、子の間の空きの半分)
    const t = E.engine.layout(doc([{ type: 'block-container', height: 300, blockAlign: 'space-around', children: [{ type: 'block', children: ['a'] }, { type: 'block', children: ['b'] }, { type: 'block', children: ['c'] }] } as never]));
    const cont = t.sheets[0].page.regionBody.children[0];
    const tops = find<{ y: number }>(cont, (n) => n.type === 'block' && Array.isArray(n.children) && (n.children as unknown[]).some((c) => (c as { type: string }).type === 'line')).map((b) => b.y);
    expect(tops).toHaveLength(3);
    const lineH = find<{ height: number }>(cont, (n) => n.type === 'line')[0].height;
    const gap = tops[1] - tops[0];
    expect(tops[2] - tops[1]).toBeCloseTo(gap, 3);
    expect(tops[0]).toBeCloseTo((gap - lineH) / 2, 3);
  });
  it('flex の項目の margin-left: auto は、伸びる項目が無ければ余りを吸い取る比例の列になる (右端に寄せる)', () => {
    const [ul] = flow(
      '<ul><li>9:30</li><li>2 号車</li><li class="bar">0123456789</li></ul>',
      'ul { display: flex; list-style: none; margin: 0; padding: 0; width: 500px } li { width: 60px } .bar { margin-left: auto }',
    );
    const t = find<LTable>(ul, (n) => n.type === 'table')[0];
    const widths = t.columns.map((c) => c.width);
    // 項目 1・項目 2・(余りの列)・項目 3
    expect(widths.filter((w) => typeof w === 'string')).toEqual(['1*']);
    expect(widths.indexOf('1*')).toBe(2);
  });
});

describe('絶対配置の margin・表の幅、行内要素のブロックの ::before (invoice・ticket・book)', () => {
  it('top がある絶対配置の箱は、margin-top の分だけ下がる (book の .outro: img { margin: 2em auto })', () => {
    const css = '.outro { position: absolute; top: 100pt; left: 0; width: 100pt; height: 50pt }';
    const [img] = flow('<img src="a.png" class="outro">', `img { margin: 20pt auto } ${css}`) as unknown as LBlockContainer[];
    const [plain] = flow('<img src="a.png" class="outro">', css) as unknown as LBlockContainer[];
    expect(img.absolutePosition).toBe(true);
    expect((img.top ?? 0) - (plain.top ?? 0)).toBeCloseTo(20, 3);
    expect(img.margin).toBeUndefined();
  });
  it('top も bottom も無い絶対配置の箱は、static position から margin-top だけ下がる (ticket の h1#destination)', () => {
    const [sec] = flow(
      '<section><h1 id="n">Name</h1><h1 id="d">DEST</h1></section>',
      'section { position: relative } h1 { display: inline-block; margin: 16pt 0 } #d { position: absolute; right: 12mm }',
    );
    const abs = find<LBlockContainer>(sec, (n) => n.type === 'block-container' && n.absolutePosition === true)[0];
    expect(abs.top).toBeUndefined();
    expect(abs.bottom).toBeUndefined();
    expect(abs.staticOffset).toBeCloseTo(16, 3);
  });
  it('絶対配置の表の width は罫線を含む幅 (border-box) で、中の表はその内側いっぱい (invoice の table#total)', () => {
    const [footer] = flow(
      '<footer><table id="total"><tr><td>11 月 30 日</td><td>12,345 円</td></tr></table></footer>',
      '#total { position: absolute; bottom: 0; width: 16cm; margin: 0 -2cm; border: solid #ddd; border-width: 1cm 2cm } table { width: 100% }',
    );
    const abs = find<LBlockContainer>(footer, (n) => n.type === 'block-container' && n.absolutePosition === true)[0];
    expect(abs.boxSizing).toBe('border-box');
    expect(abs.width).toBeCloseTo((16 * 72) / 2.54, 2);
    const t = find<LTable>(abs, (n) => n.type === 'table')[0];
    // 罫線の太さは整数の px に丸める (2cm は 75.6px) ので、1pt の差を許す。中の表は 16cm − 2cm × 2
    expect(Math.abs((t.width as number) - (12 * 72) / 2.54)).toBeLessThan(1);
    // 左右の位置が無ければ、static position (基準の左端) から margin-left (−2cm) だけ左へ
    const base = flow('<footer><table id="total"><tr><td>x</td></tr></table></footer>', '#total { position: absolute; bottom: 0; width: 16cm }')[0];
    const abs0 = find<LBlockContainer>(base, (n) => n.type === 'block-container' && n.absolutePosition === true)[0];
    expect((abs0.left ?? 0) - (abs.left ?? 0)).toBeCloseTo((2 * 72) / 2.54, 2);
  });
  it("行内の dt の ::before { content: ''; display: block } は行を分ける (行頭では空の行を作らない)", () => {
    const [dl] = flow(
      '<dl><dt>番号</dt><dd>101</dd><dt>日付</dt><dd>11 月 8 日</dd></dl>',
      "dt, dd { display: inline; margin: 0 } dt::before { content: ''; display: block } dt::after { content: ':' }",
    );
    const soft = find<LInline>(dl, (n) => n.type === 'inline' && n.softBreak === true);
    expect(soft).toHaveLength(2);
    // 組版: 2 行 (先頭の改行は空の行にならない)
    const r = load('<dl><dt>番号</dt><dd>101</dd><dt>日付</dt><dd>11 月 8 日</dd></dl>', "dt, dd { display: inline; margin: 0 } dt::before { content: ''; display: block }");
    const lines = find<{ type: string }>(E.engine.layout(r.document).sheets[0].page.regionBody, (n) => n.type === 'line');
    expect(lines).toHaveLength(2);
  });
});

describe('img の罫線・余白の箱の重なり・SVG の引き伸ばし・page-number-citation の書式', () => {
  it('img の border・padding・背景色は、画像を囲む行内の箱に付く', () => {
    const [p] = flow('<p><img src="a.png" width="40" height="20"></p>', 'img { border: 3pt solid #f00; padding: 1pt; background: #eee }');
    const inl = find<LInline>(p, (n) => n.type === 'inline' && !!n.border)[0];
    expect(inl).toBeDefined();
    expect((inl.border as { left: { width: number } }).left.width).toBeCloseTo(3, 3);
    expect(inl.backgroundColor).toBe('#eeeeee');
    expect((inl.children[0] as LImage).type).toBe('image');
    // 罫線が無ければ、画像をそのまま置く
    const [q] = flow('<p><img src="a.png" width="40" height="20"></p>');
    expect((q.children[0] as LImage).type).toBe('image');
  });
  it('img の border-radius: 画像を角丸で切り抜く。罫線つきなら枠に角丸、画像は内側の角丸 (外側 − 罫線と余白)。ブロックの img は罫線を二重にしない', () => {
    // 行内の img (罫線なし): 画像そのものに角丸
    const [p] = flow('<p><img src="a.png" width="40" height="20"></p>', 'img { border-radius: 50% }');
    const img = (p.children[0] as LImage);
    expect(img.type).toBe('image');
    expect(img.borderRadius).toEqual({ rx: 0, ry: 0, corners: [['50%', '50%'], ['50%', '50%'], ['50%', '50%'], ['50%', '50%']] });
    // 行内の img (罫線 3pt・余白 1pt・角丸 10pt): 包みの行内の箱に 10pt、画像は 6pt
    const [q] = flow('<p><img src="a.png" width="40" height="20"></p>', 'img { border: 3pt solid #f00; padding: 1pt; border-radius: 10pt }');
    const inl = find<LInline>(q, (n) => n.type === 'inline' && !!n.border)[0];
    expect(inl.borderRadius?.rx).toBeCloseTo(10, 3);
    expect(inl.borderRadius?.ry).toBeCloseTo(10, 3);
    const inner = inl.children[0] as LImage;
    expect(inner.borderRadius?.corners?.map(([h, v]) => [Math.round(h as number), Math.round(v as number)])).toEqual([[6, 6], [6, 6], [6, 6], [6, 6]]);
    // ブロックの img: ブロックに罫線と角丸。子は行内の包みでなく画像そのもの (罫線は 1 重)。画像は内側の角丸
    const [b] = flow('<img src="a.png" width="40" height="20">', 'img { display: block; border: 2pt solid #00f; border-radius: 50% }');
    expect((b.border as { top: { width: number } }).top.width).toBeGreaterThan(0); // (罫線の太さは px に丸める)
    expect(b.borderRadius?.corners?.[0]).toEqual(['50%', '50%']);
    expect(find<LInline>(b, (n) => n.type === 'inline' && !!n.border)).toHaveLength(0);
    expect((b.children[0] as LImage).type).toBe('image');
    expect((b.children[0] as LImage).borderRadius?.corners?.[0]).toEqual(['50%', '50%']);
  });
  it('幅の指定のあるブロックの img も、箱の幅は max-width で抑えた画像の幅にする (CSS 2.1 §10.4。箱が画像より広くならない)', () => {
    const d = new DOMParser().parseFromString('<html><body><section style="width: 400px"><img src="a.png"></section></body></html>', 'text/html') as never;
    const css = 'img { display: block; margin: auto; width: 75%; max-width: 70%; border: 2pt solid #fff; border-radius: 50% }';
    const r = importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css, imageSize: () => ({ width: 900, height: 520 }) });
    const b = find<LBlock>(r.document, (n) => n.type === 'block' && !!n.borderRadius)[0];
    // 75% (225pt) ではなく、上限の 70% = 280px = 210pt
    expect((b.children[0] as LImage).width).toBeCloseTo(210, 3);
    expect(b.width).toBeCloseTo(210, 3);
  });
  it('ブロックの img の箱の幅は画像の幅 (max-width で決まった幅も)。左右の余白が auto なら中央に置く (罫線・角丸が画像より広くならない)', () => {
    const d = new DOMParser().parseFromString('<html><body><figure style="width: 200px"><img src="a.png"><figcaption>写真の説明</figcaption></figure></body></html>', 'text/html') as never;
    const css = 'figure { margin: 0; text-align: center } img { display: block; margin: 0 auto; max-width: 40px; border: 2pt solid #fff; border-radius: 50% }';
    const r = importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css, imageSize: () => ({ width: 151, height: 151 }) });
    const b = find<LBlock>(r.document, (n) => n.type === 'block' && !!n.borderRadius)[0];
    expect(b).toBeDefined();
    // 幅 40px = 30pt (content-box)。左右の余白は組むときに等分する (autoMargins)
    expect(b.width).toBeCloseTo(30, 3);
    expect(b.autoMargins).toBe('center');
    expect((b.children[0] as LImage).width).toBeCloseTo(30, 3);
    // 組むと、figure (200px = 150pt) の中央に置かれる: 罫線の箱の左端 = (150 − 30 − 罫線 2 本) / 2
    const t = E.engine.layout(r.document);
    const area = find<{ x: number; width: number; border: { left: { width: number } } }>(t.sheets[0], (n) => n.type === 'block' && !!n.borderRadius)[0];
    const bw = area.border.left.width;
    expect(area.x).toBeCloseTo((150 - 30 - 2 * bw) / 2, 1);
    expect(area.width).toBeCloseTo(30 + 2 * bw, 1);
  });
  it('角丸は描くときに切り抜く: 画像 (ImageArea.borderRadius)・背景画像・overflow: hidden の中身を角丸の形で切り抜く', () => {
    const assets = new AssetStore();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assets.register('a.png', { mime: 'image/png', bytes: png, width: 40, height: 20 });
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const count = (nodes: unknown[]) => {
      const t = engine.layout(doc(nodes as never));
      const paths: number[] = [];
      let rects = 0;
      const painter = {
        fillRect: () => {},
        fillPath: () => {},
        strokePath: () => {},
        clipPath: (p: unknown[]) => paths.push(p.length),
        drawGlyph: () => {},
        drawImage: () => {},
        strokeLine: () => {},
        clipRect: () => rects++,
        restore: () => {},
        transform: (_m: number[], draw: () => void) => draw(),
      };
      paintSheet(t.sheets[0], painter as never);
      return { paths, rects };
    };
    // 角丸の画像: 角丸の輪郭 (10 節) で 1 回切り抜く。角丸が無ければ切り抜かない
    expect(count([{ type: 'block', children: [{ type: 'image', src: 'a.png', width: 40, height: 20, borderRadius: { rx: 5, ry: 5 } }] }]).paths).toEqual([10]);
    expect(count([{ type: 'block', children: [{ type: 'image', src: 'a.png', width: 40, height: 20 }] }]).paths).toEqual([]);
    // 角丸の箱の背景画像: 矩形でなく角丸で切り抜く (角丸が無いときの矩形の切り抜きが 1 つ減り、角丸の切り抜きが 1 つ増える)
    const bgBox = (rad: boolean) => ({ type: 'block', width: 100, height: 50, ...(rad ? { borderRadius: { rx: 8, ry: 8 } } : {}), backgroundImage: { src: 'a.png', width: 40, height: 20, repeat: 'no-repeat' }, children: [] });
    const bg = count([bgBox(true)]);
    expect(bg.paths).toEqual([10]);
    expect(bg.rects).toBe(count([bgBox(false)]).rects - 1);
    // overflow: hidden + 角丸: 中身を角丸で切り抜く (矩形の切り抜きは使わない)
    const ovBox = (rad: boolean) => ({ type: 'block', width: 100, height: 20, overflow: 'hidden', ...(rad ? { borderRadius: { rx: 8, ry: 8 } } : {}), children: [{ type: 'block', height: 60, backgroundColor: '#0cf', children: [] }] });
    const ov = count([ovBox(true)]);
    expect(ov.paths).toEqual([10]);
    expect(ov.rects).toBe(count([ovBox(false)]).rects - 1);
  });
  it('z-index が負の余白の箱 (@bottom-left { z-index: -1 }) は本文の背面に置く', () => {
    const r = load('<p>x</p>', '@page { @bottom-left { content: counter(page); z-index: -1 } @bottom-right { content: "r" } }');
    const sc = (r.document.sequences[0].staticContent ?? []) as LBlockContainer[];
    expect(sc.map((b) => b.layer)).toEqual(['behind', undefined]);
  });
  it('scaling="non-uniform" の SVG は、preserveAspectRatio によらず枠へ引き伸ばす (ImageArea.stretch)', () => {
    const assets = new AssetStore();
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
    assets.register('a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg), width: 100, height: 50 });
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const areaOf = (img: Partial<LImage>) => {
      const t = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'a.svg', width: 100, height: 100, ...img }] }] as never));
      return find<ImageArea>(t.sheets[0], (n) => n.type === 'image')[0];
    };
    expect(areaOf({ scaling: 'non-uniform' }).stretch).toBe(true);
    expect(areaOf({ fit: 'fill' }).stretch).toBeUndefined();
    // FO の external-graphic: content-width・content-height と scaling="non-uniform"
    const blk = foFirst<LBlock>('<fo:block><fo:external-graphic src="url(a.svg)" content-width="40mm" content-height="12mm" scaling="non-uniform"/></fo:block>');
    const img = find<LImage>(blk, (n) => n.type === 'image')[0];
    expect(img.scaling).toBe('non-uniform');
  });
  it('fo:page-number-citation の color・font-weight は、行内の箱で包んで当てる', () => {
    const blk = foFirst<LBlock>('<fo:block id="x">p. <fo:page-number-citation ref-id="x" color="#b5562b" font-weight="bold"/> / <fo:page-number-citation ref-id="x"/></fo:block>');
    const inl = find<LInline>(blk, (n) => n.type === 'inline' && n.color === '#b5562b')[0];
    expect(inl).toBeDefined();
    expect(inl.fontWeight).toBe(700);
    expect((inl.children[0] as { type: string; refId: string }).type).toBe('page-number-citation');
    // 書式の無い参照は、そのまま
    expect(find<{ type: string }>(blk, (n) => n.type === 'page-number-citation')).toHaveLength(2);
  });
});

describe('残す空白 (コードの表示)', () => {
  const base = (over: Partial<ResolvedStyle> = {}): ResolvedStyle => ({
    fontFamily: FAMILY,
    fontWeight: 400,
    italic: false,
    fontSize: 10,
    lineHeight: 1.5,
    color: '#000',
    textAlign: 'start',
    textIndent: 0,
    letterSpacing: 0,
    rubyScale: 0.5,
    hanging: false,
    orphans: 2,
    widows: 2,
    wm: 'horizontal-tb',
    ...over,
  });
  const lines = (text: string, st: ResolvedStyle, L: number) => {
    const atoms = flattenInline([text], st, E.measurer);
    markLineBreaks(atoms);
    return breakLines(atoms, L, 0, false).map((l) => l.items.map((a) => a.first).join(''));
  };
  it('white-space-collapse="false" (FO) は collapseSpaces: false の字の並びにする', () => {
    const b = foFirst<LBlock>('<fo:block white-space-collapse="false" linefeed-treatment="preserve">x</fo:block>');
    expect(b.collapseSpaces).toBe(false);
    expect(foFirst<LBlock>('<fo:block>x</fo:block>').collapseSpaces).toBeUndefined();
  });
  it('行頭の残す空白 (字下げ) と語の間では折り返さず、空白だけの行を作らない', () => {
    const st = resolveStyle(base({ collapseSpaces: false, wordSpaceShrink: true }), {});
    const sp = E.measurer.glyph(' ', { fontFamily: FAMILY, fontWeight: 400, italic: false, fontSize: 10 } as never, 'horizontal-tb').advance;
    const xw = E.measurer.glyph('x', { fontFamily: FAMILY, fontWeight: 400, italic: false, fontSize: 10 } as never, 'horizontal-tb').advance;
    // 幅: 空白 6 つ + x 10 字が入り、x 20 字は入らない
    const L = 6 * sp + 15 * xw;
    const out = lines('      ' + 'x'.repeat(20) + '>', st, L);
    expect(out[0].startsWith('      x')).toBe(true);
    expect(out.every((l) => l.trim() !== '')).toBe(true);
  });
  it('残す空白は追込みで詰めない (詰める空白なら 1 行に入るものが、2 行になる)', () => {
    const sp = E.measurer.glyph(' ', { fontFamily: FAMILY, fontWeight: 400, italic: false, fontSize: 10 } as never, 'horizontal-tb').advance;
    const aw = E.measurer.glyph('a', { fontFamily: FAMILY, fontWeight: 400, italic: false, fontSize: 10 } as never, 'horizontal-tb').advance;
    const text = 'a a a a a a a a a';
    // 自然な長さより空白 1 つ分弱だけ狭い行: 8 つの語間を 1/3 ずつ詰めれば入る
    const L = 9 * aw + 8 * sp - sp * 0.8;
    expect(lines(text, resolveStyle(base({ collapseSpaces: true, wordSpaceShrink: true }), {}), L)).toHaveLength(1);
    expect(lines(text, resolveStyle(base({ collapseSpaces: false, wordSpaceShrink: true }), {}), L)).toHaveLength(2);
  });
});

describe('report の章扉・invoice の合計の表・font-variant (2 回目の見直し)', () => {
  it('高さの決まった 1 行の flex (align-items: center) は、項目を上下の中央に置く (章扉の見出し)', () => {
    const [ch] = flow('<article><h2>Chapter</h2></article>', 'article { display: flex; align-items: center; justify-content: center; height: 297mm } h2 { width: 100% }') as unknown as LBlockContainer[];
    expect(ch.type).toBe('block-container');
    // 行の高さは容器の内側の高さ (Flexbox 1 §9.4 の 15) で、項目はその中で上下の中央に揃える
    const row = (ch.children[0] as unknown as LTable).body!.rows[0];
    expect(row.minHeight).toBeCloseTo((297 * 72) / 25.4, 0);
    expect(row.cells.find((c) => c.children.length)!.blockAlign).toBe('center');
    // align-items の無い (stretch) 1 行は、項目を行 (容器) の高さまで伸ばす
    const [top] = flow('<article><h2>Chapter</h2></article>', 'article { display: flex; height: 297mm }') as unknown as LBlockContainer[];
    expect(top.blockAlign).toBeUndefined();
    expect((top.children[0] as unknown as LTable).body!.rows[0].cells.find((c) => c.children.length)!.stretchContent).toBe(true);
  });
  it('絶対配置の表は、表として (自動レイアウトで中身の幅の比に列を配り) 組む。罫線・余白は箱だけが持つ', () => {
    const [footer] = flow(
      '<footer><table id="total"><thead><tr><th>期日</th><th>口座</th><th>金額</th></tr></thead><tbody><tr><td>2026 年 11 月 30 日</td><td>0001 2345 6789</td><td>12,345 円</td></tr></tbody></table></footer>',
      '#total { position: absolute; bottom: 0; width: 16cm; margin: 0 -2cm; border: solid #ddd; border-width: 1cm 2cm; font-size: 18pt } table { width: 100%; border-collapse: collapse }',
    );
    const abs = find<LBlockContainer>(footer, (n) => n.type === 'block-container' && n.absolutePosition === true)[0];
    const t = find<LTable>(abs, (n) => n.type === 'table')[0];
    expect(t.fillContent).toBe(true);
    // 罫線を重ねる表: 表の幅 16cm は左右の罫線の半分 (1cm ずつ) だけを含む (CSS 2.1 §17.6.2) ので、中身は 16cm − 2cm
    expect(Math.abs((t.width as number) - (14 * 72) / 2.54)).toBeLessThan(1);
    expect(Math.abs((abs.width as number) - (18 * 72) / 2.54)).toBeLessThan(1);
    expect(t.header?.rows).toHaveLength(1);
    expect(t.border).toBeUndefined();
    expect(t.margin).toBeUndefined();
    expect(abs.border).toBeDefined();
  });
  it('font-variant-position: super / sub と font-variant-ligatures の discretionary・contextual は OpenType の機能にする', () => {
    const [p] = flow(
      '<p><span class="a">a2</span><span class="b">H2O</span><span class="c">Often</span><span class="d">#&amp;</span></p>',
      '.a { font-variant-position: super } .b { font-variant-position: sub } .c { font-variant-ligatures: discretionary-ligatures } .d { font-variant-ligatures: contextual }',
    );
    const feats = find<LInline>(p, (n) => n.type === 'inline' && Array.isArray(n.fontFeatures)).map((i) => (i.fontFeatures as string[]).join(','));
    expect(feats).toEqual(['sups', 'subs', 'dlig', 'calt']);
  });
});

describe('紙の端に接する塗りの伸ばし (比較の画像で右端に薄い線が見えていた)', () => {
  const fills = async (margins: number) => {
    const { paintSheet } = await import('../src/paint');
    const { master } = await import('./helpers');
    const m = margins;
    const t = E.engine.layout(doc([{ type: 'block', backgroundColor: '#112233', children: ['x'] }], 'horizontal-tb', { master: master({ margins: { top: m, right: m, bottom: m, left: m }, bleed: 0 }) }));
    const rects: number[][] = [];
    const p = { fillRect: (x: number, y: number, w: number, h: number, c: string) => c === '#112233' && rects.push([x, y, w, h]), drawGlyph() {}, drawImage() {}, transform: (_m: unknown, d: () => void) => d(), strokeLine() {}, clipRect() {}, restore() {} };
    paintSheet(t.sheets[0], p as never);
    return { r: rects[0], sheet: t.sheets[0] };
  };
  it('紙の端 (余白 0) まで届く箱の背景は、端の外へ 2pt 伸ばす。端に届かない箱はそのまま', async () => {
    const edge = await fills(0);
    const W = edge.sheet.bleedBox.width;
    expect(edge.r[0]).toBeCloseTo(-2, 3);
    expect(edge.r[0] + edge.r[2]).toBeCloseTo(W + 2, 3);
    const inner = await fills(10);
    expect(inner.r[0]).toBeCloseTo(pt(10) + inner.sheet.trimBox.x, 3);
    expect(inner.r[0] + inner.r[2]).toBeCloseTo(inner.sheet.trimBox.x + inner.sheet.trimBox.width - pt(10), 3);
  });
});
