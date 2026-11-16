import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument, decodePDFRawStream, type PDFArray } from 'pdf-lib';
import { parseSvg, type Seg, type TextOutliner } from '../src/svg';
import { AssetStore } from '../src/assets';
import { renderPdf } from '../src/pdfRenderer';
import { LayoutEngine } from '../src/layoutEngine';
import { FAMILY, doc, makeEngine } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string, attrs = 'width="200" height="100" viewBox="0 0 200 100"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** 1 字 = 幅 size/2・高さ size の四角 (左下が字の原点) */
const box: TextOutliner = (t, _f, _w, size) => {
  const segs: Seg[] = [];
  [...t].forEach((_, k) => segs.push({ op: 'M', x: (k * size) / 2, y: -size }, { op: 'L', x: (k * size) / 2 + size / 2, y: 0 }, { op: 'Z' }));
  return { segs, advance: ([...t].length * size) / 2, ascent: 0.8, descent: 0.2 };
};

/** SVG を 1 枚の PDF に描き、ページの描画の命令を返す */
async function pdfOps(src: string): Promise<string> {
  const { fonts, measurer } = await makeEngine();
  const assets = new AssetStore();
  assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
  const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
  const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }]));
  const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
  const contents = pdf.getPage(0).node.Contents()!;
  const streams = 'asArray' in contents ? (contents as PDFArray).asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
}

describe('SVG の text の font-style', () => {
  it('font-style (継承する) を輪郭を作る関数に渡す。normal で立体に戻す', () => {
    const seen: Array<string | undefined> = [];
    const outline: TextOutliner = (t, f, w, size, style) => {
      seen.push(style);
      return box(t, f, w, size, style);
    };
    parseSvg(svg('<g font-style="italic"><text y="20">a<tspan font-style="normal">b</tspan><tspan style="font-style:oblique 10deg">c</tspan></text></g>'), parse, { outline });
    expect(seen).toEqual(['italic', undefined, 'oblique']);
  });

  it('PDF: 斜体の書体が無ければ、立体を傾けた輪郭で描く (CSS Fonts 4 §2.4)。立体の字は書体の文字のまま', async () => {
    const upright = await pdfOps(svg('<text x="5" y="50" font-size="20">Ab</text>'));
    expect(upright).toMatch(/BT[\s\S]*Tj[\s\S]*ET/);
    const italic = await pdfOps(svg('<text x="5" y="50" font-size="20" font-style="italic">Ab</text>'));
    // 傾けた字は書体の文字にできないので、字形の曲線で描く
    expect(italic).not.toMatch(/Tj/);
    expect((italic.match(/ c\n/g) ?? []).length).toBeGreaterThan(5);
  });
});

describe('SVG の <style> の選択子', () => {
  it('結合子 (子孫・子・隣接・後続)・属性・疑似クラスの選択子を当てる (Selectors 4)', () => {
    const d = parseSvg(
      svg(
        '<style>g rect{fill:#f00} g > .a{fill:#0f0} .a + rect{fill:#00f} [data-k="v"]{fill:#ff0} rect:first-child{stroke:#000} #s ~ rect{fill:#0ff} rect:hover{fill:#123456} rect::before{fill:#654321}</style>' +
          '<rect width="1" height="1"/>' +
          '<g><rect width="1" height="1"/><rect class="a" width="1" height="1"/><rect width="1" height="1"/><circle r="1"/><rect data-k="v" width="1" height="1"/></g>' +
          '<rect id="s" width="1" height="1"/><rect width="1" height="1"/>',
      ),
      parse,
    )!;
    // 1: どれにも当たらない。2: g の中 (子孫)。3: g の子の .a。4: .a の次。5: circle は rect でない。6: 属性 ([data-k] の詳細度 0,1,0 は g rect の 0,0,2 より高い)。
    // 8: #s の後続。:hover (動的な疑似クラス) と ::before は当たらない
    expect(d.shapes.map((x) => x.fill)).toEqual(['#000000', '#ff0000', '#00ff00', '#0000ff', '#000000', '#ffff00', '#000000', '#00ffff']);
    // :first-child は g の最初の子だけ (根の最初の子は style)
    expect(d.shapes.map((x) => x.stroke)).toEqual([undefined, '#000000', undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('読めない選択子があれば描けないものとする (ラスタライズ)', () => {
    let why = '';
    expect(parseSvg(svg('<style>rect:unknown-thing(){fill:red}</style><rect width="1" height="1"/>'), parse, { onUnsupported: (w) => (why = w) })).toBeNull();
    expect(why).toMatch(/css selector/);
  });
});

describe('SVG の filter の近似 (図形にできない環境)', () => {
  const approx = (body: string) => parseSvg(svg(body), parse, { approximateFilters: true });
  it('Figma の書き出す影 (feColorMatrix で SourceAlpha を濃さにし、feBlend で重ねる) を、ずらしてぼかした影と元の図形にする', () => {
    const d = approx(
      '<filter id="f" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>' +
        '<feOffset dy="4"/><feGaussianBlur stdDeviation="2"/><feComposite in2="hardAlpha" operator="out"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>' +
        '<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape"/></filter>' +
        '<rect width="10" height="10" fill="#00f" filter="url(#f)"/>',
    )!;
    // 影 5 枚 (赤、下へ 4 ずらす) と元の図形
    expect(d.shapes).toHaveLength(6);
    expect(d.shapes.slice(0, 5).every((x) => x.fill === '#ff0000')).toBe(true);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 0, y: 4 });
    const total = 1 - d.shapes.slice(0, 5).reduce((a, x) => a * (1 - x.fillOpacity), 1);
    expect(total).toBeCloseTo(0.25 * 0.6, 5);
    expect(d.shapes[5]).toMatchObject({ fill: '#0000ff', fillOpacity: 1 });
  });

  it('feColorMatrix・feComponentTransfer は図形の色を変える (Filter Effects 1 §9.6・§9.7。既定の色空間は linearRGB)', () => {
    // saturate 0 (灰色にする)。sRGB の計算なら、赤 → 0.213 の灰色
    const g = approx('<filter id="g" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter><rect width="1" height="1" fill="#f00" filter="url(#g)"/>')!;
    expect(g.shapes[0].fill).toBe('#363636');
    // linearRGB (既定) では、線形にしてから掛けて戻す: 0.213 → sRGB の 0.5 ほど
    const l = approx('<filter id="g"><feColorMatrix type="saturate" values="0"/></filter><rect width="1" height="1" fill="#f00" filter="url(#g)"/>')!;
    expect(l.shapes[0].fill).toBe('#7f7f7f');
    // 色を入れ替える行列 (r ↔ b)・不透明度を半分にする feFuncA
    const m = approx(
      '<filter id="m" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 1 0 0 0 1 0 0 0 1 0 0 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer></filter>' +
        '<rect width="1" height="1" fill="#ff8000" stroke="#000" filter="url(#m)"/>',
    )!;
    expect(m.shapes[0]).toMatchObject({ fill: '#0080ff', fillOpacity: 0.5, stroke: '#000000', strokeOpacity: 0.5 });
    // グラデーションは stop ごとに変える
    const gr = approx(
      '<linearGradient id="lg"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
        '<filter id="h" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 1 0 0 0 1 0 0 0 1 0 0 0 0 0 0 0 1 0"/></filter><rect width="1" height="1" fill="url(#lg)" filter="url(#h)"/>',
    )!;
    expect(gr.shapes[0].fillPaint!.stops.map((s) => s.color)).toEqual(['#0000ff', '#ff0000']);
  });

  it('扱えない要素 (feTurbulence)・領域いっぱいの feFlood は近似しない', () => {
    expect(approx('<filter id="t"><feTurbulence baseFrequency="0.1"/></filter><rect width="1" height="1" filter="url(#t)"/>')).toBeNull();
    expect(approx('<filter id="t"><feFlood flood-color="#f00"/></filter><rect width="1" height="1" filter="url(#t)"/>')).toBeNull();
  });

  it('feBlend の描画モードは in の図形に付け、結果を透明のグループにする。結果は filter の領域 (既定は外接矩形の −10%〜120%) で切り抜く', () => {
    const d = approx('<filter id="t"><feOffset dx="2" in="SourceGraphic" result="o"/><feBlend mode="multiply" in="SourceGraphic" in2="o"/></filter><rect width="10" height="10" fill="#f00" filter="url(#t)"/>')!;
    expect(d.shapes).toHaveLength(1);
    expect(d.shapes[0].group!.shapes.map((x) => x.blend)).toEqual([undefined, 'multiply']);
    expect(d.shapes[0].clips![0].segs.filter((g) => g.op !== 'Z').map((g) => [(g as { x: number }).x, (g as { y: number }).y])).toEqual([[-1, -1], [11, -1], [11, 11], [-1, 11]]);
    // 影がずれて領域の外へ出る分は切る
    const s = approx('<filter id="s" x="0" y="0" width="1" height="1"><feDropShadow dx="20" dy="0" stdDeviation="0"/></filter><rect width="10" height="10" filter="url(#s)"/>')!;
    expect(s.shapes.every((x) => x.clips?.length === 1)).toBe(true);
  });
});

describe('SVG の text の字ごとの位置・基線', () => {
  // 字ごとの左上の点 (box の字の輪郭は、字ごとに M で始まる)
  const at = (body: string) => parseSvg(svg(body), parse, { outline: box })!.shapes.flatMap((sh) => sh.segs.filter((g) => g.op === 'M') as Array<{ x: number; y: number }>);
  it('x・y・dx・dy の並びは字ごとに当てる。子の tspan の並びが先祖の並びに勝ち、dx・dy は並びの外の字をずらさない (SVG 1.1 §10.5)', () => {
    // 字の幅は 5 (size 10)。x の並びで 3 字を置き、4 字目は 3 字目の後に続く
    expect(at('<text x="10 30 50" y="20" font-size="10">abcd</text>').map((p) => p.x)).toEqual([10, 30, 50, 55]);
    // dx の並び: 1 字目 +1、2 字目 +2 (積み重なる)、3 字目は並びの外
    expect(at('<text x="0" y="20" dx="1 2" font-size="10">abc</text>').map((p) => p.x)).toEqual([1, 8, 13]);
    // tspan の x は、その中の字にだけ当たる。先祖の並びの続きは、tspan の外の字に当たる (2 字目は tspan の x、3 字目は text の 3 つ目の値)
    expect(at('<text x="0 100 200" y="20" font-size="10">a<tspan x="40">b</tspan>c</text>').map((p) => p.x)).toEqual([0, 40, 200]);
    // y の並び
    expect(at('<text x="0" y="10 20" font-size="10">ab</text>').map((p) => p.y)).toEqual([0, 10]);
  });

  it('rotate は字をその原点の周りに回し、並びの最後の値が後の字にも当たる', () => {
    const d = parseSvg(svg('<text x="0" y="20" rotate="90" font-size="10">ab</text>'), parse, { outline: box })!;
    // 字の左上 (0, -10) を 90 度回すと (10, 0) → 原点 (0, 20) に置いて (10, 20)
    expect(d.shapes.map((sh) => sh.segs[0])).toEqual([
      { op: 'M', x: 10, y: 20 },
      { op: 'M', x: 15, y: 20 },
    ]);
  });

  it('baseline-shift (sub・super・長さ・百分率。入れ子は足す) と dominant-baseline・alignment-baseline で、字を上下にずらす', () => {
    const ys = (body: string) => at(body).map((p) => p.y + 10); // 基線の y (字の上端 + 字の大きさ)
    // super は親の字の大きさの 1/3 上げ、sub は 1/5 下げる (CSS Inline 3 §4.2.3 の既定)。百分率は字の大きさに対して
    expect(ys('<text x="0" y="30" font-size="10">a<tspan baseline-shift="super">b</tspan><tspan baseline-shift="-50%">c</tspan>d</text>').map((y) => +y.toFixed(3))).toEqual([30, 26.667, 35, 30]);
    // 入れ子の baseline-shift は足し合わせる
    expect(ys('<text x="0" y="30" font-size="10"><tspan baseline-shift="2">a<tspan baseline-shift="3">b</tspan></tspan></text>')).toEqual([28, 25]);
    // central は上の高さ (0.8) と下の深さ (0.2) の中ほどを y に合わせる → 基線は 0.3em 下。text-top は 0.8em 下、ideographic は 0.2em 上
    expect(ys('<text x="0" y="30" font-size="10" dominant-baseline="central">a</text>')[0]).toBeCloseTo(33, 5);
    expect(ys('<text x="0" y="30" font-size="10" dominant-baseline="text-top">a<tspan alignment-baseline="ideographic">b</tspan></text>').map((y) => +y.toFixed(3))).toEqual([38, 28]);
    // hanging は 0.6em (CSS Inline 3 の付録 A.2 の既定)
    expect(ys('<text x="0" y="30" font-size="10" dominant-baseline="hanging">a</text>')[0]).toBeCloseTo(36, 5);
  });

  it('word-spacing は空白の後に足す', () => {
    expect(at('<text x="0" y="20" font-size="10" word-spacing="7">a b</text>').map((p) => p.x)).toEqual([0, 5, 17]);
  });
});

describe('SVG の clipPath・mask の objectBoundingBox', () => {
  const pts = (segs: Seg[]) => segs.filter((g) => g.op !== 'Z').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]);
  it('clipPathUnits="objectBoundingBox" は、中身の座標を要素の外接矩形の 0〜1 にする (CSS Masking 1 §6.1)', () => {
    const d = parseSvg(
      svg('<clipPath id="c" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1"/></clipPath><g transform="translate(5 5)"><rect x="10" y="20" width="40" height="10" clip-path="url(#c)"/></g>'),
      parse,
    )!;
    // 外接矩形 (10, 20)〜(50, 30) の左半分。根の座標で 5 ずれる
    expect(pts(d.shapes[0].clips![0].segs)).toEqual([[15, 25], [35, 25], [35, 35], [15, 35]]);
    // 円の外接矩形は、制御点でなく形の端 (中心 50,50・半径 10)
    const c = parseSvg(svg('<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath><circle cx="50" cy="50" r="10" clip-path="url(#c)"/>'), parse)!;
    expect(pts(c.shapes[0].clips![0].segs)).toEqual([[40, 40], [60, 40], [60, 60], [40, 60]]);
    // 外接矩形の無い要素 (幅 0 の線) と空の clipPath は、すべてを切る (描かない)
    expect(parseSvg(svg('<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath><line x1="0" y1="5" x2="10" y2="5" stroke="#000" clip-path="url(#c)"/>'), parse)!.shapes).toHaveLength(0);
    expect(parseSvg(svg('<clipPath id="e"/><rect width="5" height="5" clip-path="url(#e)"/>'), parse)!.shapes).toHaveLength(0);
  });

  it('maskContentUnits="objectBoundingBox" は、マスクの中身の座標を外接矩形の 0〜1 にする (CSS Masking 1 §7.1)', () => {
    const d = parseSvg(svg('<mask id="m" maskContentUnits="objectBoundingBox"><rect x="0.25" y="0" width="0.5" height="1" fill="#fff"/></mask><rect x="10" y="10" width="40" height="20" mask="url(#m)"/>'), parse)!;
    expect(pts(d.shapes[0].masks![0].shapes[0].segs)).toEqual([[20, 10], [40, 10], [40, 30], [20, 30]]);
  });
});

describe('SVG の image の preserveAspectRatio', () => {
  // 幅 2・高さ 1 の画素の PNG (図形にするときは、IHDR の大きさだけを読む)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]).toString('base64');
  it('slice は、枠を覆う大きさにして、はみ出しを枠で切る (SVG 1.1 §7.8)', () => {
    const d = parseSvg(svg(`<image x="0" y="0" width="10" height="10" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${png}"/>`), parse)!;
    // 高さ 10 に合わせて幅 20、中央に揃えて x = -5
    expect(d.shapes[0].image!.matrix).toEqual([20, 0, 0, -10, -5, 10]);
    expect(d.shapes[0].clips![0].segs.filter((g) => g.op !== 'Z').map((g) => [(g as { x: number }).x, (g as { y: number }).y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
});

describe('SVG の image の外のファイル', () => {
  it('呼ぶ側の引いた PNG を描く。引けない画像の image は描かずに、ほかの図形を描く', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const asked: string[] = [];
    const d = parseSvg(svg('<image width="20" height="10" href="b.png"/><image width="20" height="10" xlink:href="none.png" xmlns:xlink="http://www.w3.org/1999/xlink"/><rect width="1" height="1"/>'), parse, {
      image: (h) => (asked.push(h), h === 'b.png' ? { kind: 'png', bytes: png } : undefined),
    })!;
    expect(asked).toEqual(['b.png', 'none.png']);
    expect(d.shapes.map((x) => !!x.image)).toEqual([true, false]);
    // 引く関数が無ければ、image だけを描かない
    expect(parseSvg(svg('<image width="20" height="10" href="b.png"/><rect width="1" height="1"/>'), parse)!.shapes).toHaveLength(1);
  });

  it('PDF: SVG の場所を基準に、登録した画像を引いて描く', async () => {
    const { encodePngStored } = await import('../src/pixels');
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const png = encodePngStored({ width: 2, height: 2, rgba: new Uint8Array(16).fill(255) });
    assets.register('img/b.png', { mime: 'image/png', bytes: png, width: 2, height: 2 });
    assets.register('img/a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg('<image width="200" height="100" href="b.png"/>')), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'img/a.svg', width: 200, height: 100 }] }]));
    expect(tree.warnings ?? []).toEqual([]);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const { PDFName } = await import('pdf-lib');
    const xo = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject')) as { keys(): unknown[] } | undefined;
    expect(xo?.keys().length).toBe(1);
  });
});

describe('SVG の paint-order・条件の属性', () => {
  it('paint-order (SVG 2 §13.8): stroke を先にすると、線の図形を塗りの図形より先に描く。省いた語は normal の順で続く', () => {
    const d = parseSvg(svg('<rect width="5" height="5" fill="#f00" stroke="#00f" paint-order="stroke"/><rect width="5" height="5" fill="#f00" stroke="#00f"/>'), parse)!;
    expect(d.shapes.map((x) => [x.fill ?? null, x.stroke ?? null])).toEqual([
      [null, '#0000ff'],
      ['#ff0000', null],
      ['#ff0000', '#0000ff'],
    ]);
    // 字も、字ごとに線を先に描く
    const t = parseSvg(svg('<text y="20" font-size="10" fill="#f00" stroke="#00f" style="paint-order: stroke fill">ab</text>'), parse, { outline: box })!;
    expect(t.shapes.map((x) => [x.fill ?? null, x.stroke ?? null])).toEqual([
      [null, '#0000ff'],
      ['#ff0000', null],
    ]);
  });

  it('switch の systemLanguage (SVG 2 §5.6.5): 利用者の言語に合う最初の子を描く。利用者の en-US は en に合う。switch の外の要素も、条件が満たされなければ描かない', () => {
    const body = '<switch><rect systemLanguage="ja" width="1" height="1" fill="#f00"/><rect systemLanguage="en, fr" width="1" height="1" fill="#0f0"/><rect width="1" height="1" fill="#00f"/></switch>';
    const fill = (langs: string[]) => parseSvg(svg(body), parse, { languages: langs })!.shapes.map((x) => x.fill);
    expect(fill(['ja-JP'])).toEqual(['#ff0000']);
    expect(fill(['en-US'])).toEqual(['#00ff00']);
    expect(fill(['de'])).toEqual(['#0000ff']);
    // 言語の部分 (ja) は、より細かい言語 (ja-JP) に合わない
    expect(parseSvg(svg('<switch><rect systemLanguage="ja-JP" width="1" height="1"/></switch>'), parse, { languages: ['ja'] })!.shapes).toHaveLength(0);
    expect(parseSvg(svg('<rect systemLanguage="ja" width="1" height="1"/><rect requiredExtensions="http://example.com/x" width="1" height="1"/><rect width="1" height="1"/>'), parse, { languages: ['en'] })!.shapes).toHaveLength(1);
  });
});

describe('SVG の pattern の中身', () => {
  it('PDF: 中身のグラデーション・不透明度・入れ子の模様を、タイルの中に描く (タイルの資源はページと同じ辞書)', async () => {
    const ops = await pdfOps(
      svg(
        '<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
          '<pattern id="q" patternUnits="userSpaceOnUse" width="2" height="2"><rect width="1" height="1" fill="#0f0"/></pattern>' +
          '<pattern id="p" patternUnits="userSpaceOnUse" width="20" height="20"><rect width="10" height="10" fill="url(#g)"/><circle cx="15" cy="15" r="4" fill="#000" opacity="0.5"/><rect x="10" width="10" height="10" fill="url(#q)"/></pattern>' +
          '<rect width="200" height="100" fill="url(#p)"/>',
      ),
    );
    expect(ops).toMatch(/\/Pattern cs/);
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><pattern id="p" patternUnits="userSpaceOnUse" width="20" height="20"><rect width="10" height="10" fill="url(#g)" opacity="0.5"/></pattern><rect width="200" height="100" fill="url(#p)"/>');
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }])), fonts, { assets, parseXml: parse }));
    const { PDFName, PDFDict } = await import('pdf-lib');
    const pats = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Pattern'), PDFDict);
    // タイルの模様 (PatternType 1) の中身は、グラデーションの模様と ExtGState (不透明度) を使い、それをタイルの資源から引ける
    const tile = pats.keys().map((k) => pats.lookup(k) as { dict?: import('pdf-lib').PDFDict }).find((p) => p.dict?.get(PDFName.of('PatternType'))?.toString() === '1');
    expect(tile).toBeTruthy();
    const res = tile!.dict!.lookup(PDFName.of('Resources'), PDFDict);
    expect(res.lookup(PDFName.of('Pattern'))).toBeTruthy();
    expect(res.lookup(PDFName.of('ExtGState'))).toBeTruthy();
  });
});

describe('SVG の systemLanguage と、置いた所の言語', () => {
  it('PDF: systemLanguage は、画像を置いた所の言語 (language) で照らす。3 字の言語の符号 (jpn) も読む', async () => {
    const src = svg('<switch><rect systemLanguage="ja" width="200" height="100" fill="#f00"/><rect width="200" height="100" fill="#00f"/></switch>');
    const draw = async (language?: string) => {
      const { fonts, measurer } = await makeEngine();
      const assets = new AssetStore();
      assets.register('s.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
      const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
      const tree = engine.layout(doc([{ type: 'block', ...(language ? { language } : {}), children: [{ type: 'image', src: 's.svg', width: 200, height: 100 }] }] as never));
      const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
      const contents = pdf.getPage(0).node.Contents()!;
      const streams = 'asArray' in contents ? (contents as PDFArray).asArray().map((r) => pdf.context.lookup(r)) : [contents];
      return streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
    };
    expect(await draw('ja')).toMatch(/1 0 0 rg/);
    expect(await draw('jpn')).toMatch(/1 0 0 rg/);
    expect(await draw('en')).toMatch(/0 0 1 rg/);
  });

  it('SVG の中で見つからない外の画像は、警告に出す (同じ SVG を何度置いても 1 度)', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('img/a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg('<image width="10" height="10" href="none.png"/><image width="10" height="10" href="data:image/png;base64,AAAA"/>')), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const img = { type: 'image', src: 'img/a.svg', width: 20, height: 10 };
    const tree = engine.layout(doc([{ type: 'block', children: [img, img] }] as never));
    expect(tree.warnings.filter((w) => w.includes('none.png'))).toHaveLength(1);
    expect(tree.warnings.join('\n')).not.toMatch(/data:/);
  });
});

describe('SVG の visibility と透明のグループ', () => {
  it('visibility は継承し、子が visible に戻せば、その子は描く (CSS 2.1 §11.2)', () => {
    const d = parseSvg(svg('<g visibility="hidden"><rect width="1" height="1" fill="#f00"/><rect width="1" height="1" fill="#0f0" visibility="visible"/><g><rect width="1" height="1" fill="#00f"/></g></g>'), parse)!;
    expect(d.shapes.map((x) => x.fill)).toEqual(['#00ff00']);
  });

  it('opacity の g は、子をまとめた透明のグループにする (重なった所が濃くならない)。図形 1 つなら、その図形に不透明度を掛ける', () => {
    const d = parseSvg(svg('<g opacity="0.5"><rect width="10" height="10" fill="#f00"/><rect x="5" width="10" height="10" fill="#00f"/></g><g opacity="0.5"><rect width="1" height="1" fill="#0f0"/></g>'), parse)!;
    expect(d.shapes[0].group!.shapes.map((x) => [x.fill, x.fillOpacity])).toEqual([
      ['#ff0000', 1],
      ['#0000ff', 1],
    ]);
    expect(d.shapes[0].fillOpacity).toBe(0.5);
    expect(d.shapes[1]).toMatchObject({ fill: '#00ff00', fillOpacity: 0.5 });
    expect(d.shapes[1].group).toBeUndefined();
    // 塗りと線のある図形の opacity も、グループにする (線の下の塗りが透けない)
    expect(parseSvg(svg('<rect width="5" height="5" fill="#f00" stroke="#000" opacity="0.5"/>'), parse)!.shapes[0].group?.shapes).toHaveLength(1);
    // isolation: isolate の g もグループにする (中の描画モードが、外の図形と混ざらない)
    expect(parseSvg(svg('<g style="isolation:isolate"><rect width="5" height="5" style="mix-blend-mode:multiply"/></g>'), parse)!.shapes[0].group?.shapes[0].blend).toBe('multiply');
  });

  it('PDF: 透明のグループは、Group の付いた Form XObject を不透明度・描画モードで置く (ISO 32000-2 §11.6.6)', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<g opacity="0.5" style="mix-blend-mode:screen"><rect width="100" height="100" fill="#f00"/><circle cx="100" cy="50" r="40" fill="#00f"/></g>');
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }])), fonts, { assets, parseXml: parse }));
    const { PDFName, PDFDict } = await import('pdf-lib');
    const res = pdf.getPage(0).node.Resources()!;
    const xo = res.lookup(PDFName.of('XObject'), PDFDict);
    const form = xo.lookup(xo.keys()[0]) as unknown as { dict: import('pdf-lib').PDFDict };
    expect(String(form.dict.lookup(PDFName.of('Group')))).toMatch(/\/S \/Transparency[\s\S]*\/I true/);
    const gs = res.lookup(PDFName.of('ExtGState'), PDFDict);
    const all = gs.keys().map((k) => String(gs.lookup(k))).join(' ');
    expect(all).toMatch(/\/ca 0\.5[\s\S]*\/BM \/Screen/);
  });
});

describe('SVG の transform の CSS の書き方', () => {
  const first = (body: string) => {
    const d = parseSvg(svg(body), parse);
    return d ? d.shapes[0].segs.filter((g) => g.op !== 'Z').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]) : null;
  };
  it('単位の付いた値 (deg・turn・px・mm)・translateX・scale の百分率・skew を読む (CSS Transforms 1)', () => {
    expect(first('<rect width="10" height="10" transform="translate(5px, 2px) rotate(0.25turn)"/>')).toEqual([[5, 2], [5, 12], [-5, 12], [-5, 2]]);
    expect(first('<rect width="10" height="10" transform="rotate(90deg)"/>')).toEqual(first('<rect width="10" height="10" transform="rotate(90)"/>'));
    expect(first('<rect width="10" height="10" transform="translateX(1in) scale(50%)"/>')).toEqual([[96, 0], [101, 0], [101, 5], [96, 5]]);
    expect(first('<rect width="10" height="10" transform="skew(45deg)"/>')![2]).toEqual([20, 10]);
    // 読めない値は、これまでどおり描けないもの (ラスタライズ)
    expect(first('<rect width="10" height="10" transform="rotate(1foo)"/>')).toBeNull();
  });

  it('transform を style・<style> から読み、transform-origin と transform-box (fill-box・view-box) で回す点を決める', () => {
    // 外接矩形の中央 (15, 15) の周りに 90 度
    const a = first('<rect x="10" y="10" width="10" height="10" style="transform: rotate(90deg); transform-origin: center; transform-box: fill-box"/>');
    expect(a).toEqual([[20, 10], [20, 20], [10, 20], [10, 10]]);
    // view-box (初期値) の center は viewport の中央 (100, 50)。<style> の規則の transform
    const b = first('<style>.r{transform:rotate(180deg);transform-origin:50% 50%}</style><rect class="r" x="0" y="0" width="10" height="10"/>');
    expect(b).toEqual([[200, 100], [190, 100], [190, 90], [200, 90]]);
    // 長さの transform-origin。style の transform は属性に勝つ
    expect(first('<rect width="10" height="10" transform="translate(50 50)" style="transform: scale(2); transform-origin: 10px 0"/>')).toEqual([[-10, 0], [10, 0], [10, 20], [-10, 20]]);
  });
});

describe('SVG の var()・calc()', () => {
  it('var() はカスタムプロパティ (祖先から受け継ぐ) の値に置き換え、無ければ代わりの値、それも無ければ指定が無いものとする (CSS Variables 1 §3)', () => {
    const d = parseSvg(
      svg(
        '<style>:root{--main:#f00;--w:3} .b{--main:#00f}</style>' +
          '<rect width="1" height="1" style="fill: var(--main)"/><g class="b"><rect width="1" height="1" style="fill: var(--main); stroke: var(--line, #0f0); stroke-width: var(--w)"/></g>' +
          '<rect width="1" height="1" fill="#123456" style="fill: var(--none)"/><rect width="1" height="1" style="--Case:#ff0; fill: var(--Case)"/>',
      ),
      parse,
    )!;
    expect(d.shapes.map((x) => x.fill)).toEqual(['#ff0000', '#0000ff', '#000000', '#ffff00']);
    expect(d.shapes[1]).toMatchObject({ stroke: '#00ff00', strokeWidth: 3 });
  });

  it('calc() は同じ種類の項の式を数にする (CSS Values 4 §10.1)', () => {
    const d = parseSvg(svg('<rect width="10" height="10" fill="#000" stroke="#000" style="stroke-width: calc(2px * 3 - 1px); opacity: calc(1 / 2)"/>'), parse)!;
    expect(d.shapes[0].group?.shapes[0].strokeWidth ?? d.shapes[0].strokeWidth).toBe(5);
    expect(d.shapes[0].fillOpacity).toBe(0.5);
    const r = parseSvg(svg('<rect width="10" height="10" style="transform: rotate(calc(45deg * 2))"/>'), parse)!;
    expect(r.shapes[0].segs[1]).toMatchObject({ x: expect.closeTo(0, 6), y: 10 });
  });
});

describe('SVG の切り抜きを、続く図形で 1 度だけ書く (OUT-31)', () => {
  /** 切り抜きの形の始めの点 (x が 7.125 の点) を書いた数 */
  const clipWrites = (ops: string, x = '7.125') => ops.split('\n').filter((l) => l.startsWith(`${x} `) && l.endsWith(' m')).length;
  const balanced = (ops: string) => {
    let d = 0;
    for (const l of ops.split('\n')) {
      if (l === 'q') d++;
      else if (l === 'Q' && --d < 0) return false;
    }
    return d === 0;
  };
  const defs = '<defs><clipPath id="c"><rect x="7.125" y="0" width="50" height="50"/></clipPath><clipPath id="d"><rect x="9.375" y="0" width="80" height="80"/></clipPath><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue" stop-opacity="0.5"/></linearGradient></defs>';
  it('同じ切り抜きの図形が続けば 1 度、間に切り抜かない図形があれば開き直す。q と Q は釣り合う (ISO 32000-2 §8.4.2)', async () => {
    const ops = await pdfOps(svg(`${defs}${'<rect width="5" height="5" clip-path="url(#c)"/>'.repeat(3)}<rect width="5" height="5"/><rect width="5" height="5" clip-path="url(#c)"/>`));
    expect(clipWrites(ops)).toBe(2);
    expect(balanced(ops)).toBe(true);
  });
  it('入れ子の切り抜き (g と図形の clip-path)・透明のグループの中・塗りと線を分けて描く図形でも、まとめて書く', async () => {
    const nested = await pdfOps(svg(`${defs}<g clip-path="url(#c)">${'<rect width="5" height="5" clip-path="url(#d)"/>'.repeat(3)}<rect width="5" height="5"/></g>`));
    expect([clipWrites(nested), clipWrites(nested, '9.375')]).toEqual([1, 1]);
    expect(balanced(nested)).toBe(true);
    const group = await pdfOps(svg(`${defs}<g opacity="0.5"><rect width="5" height="5" clip-path="url(#c)"/><rect x="9" width="5" height="5" clip-path="url(#c)"/></g>`));
    expect(balanced(group)).toBe(true);
    // 透明度のあるグラデーションの塗りと線は分けて描くが、切り抜きは 1 度
    const split = await pdfOps(svg(`${defs}<rect width="5" height="5" fill="url(#g)" stroke="#000" clip-path="url(#c)"/>`));
    expect(clipWrites(split)).toBe(1);
    expect(balanced(split)).toBe(true);
  });
});

describe('SVG の clip-path の基本図形', () => {
  const clip = (body: string) => {
    const d = parseSvg(svg(body), parse)!;
    const c = d.shapes[0]?.clips?.[0];
    return c ? c.segs.filter((g) => g.op !== 'Z').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]) : d.shapes.length;
  };
  it('inset()・polygon()・xywh()・参照の箱だけ (CSS Masking 1 §5.1・CSS Shapes 1 §3.1)。既定の箱は stroke-box', () => {
    expect(clip('<rect x="10" y="10" width="40" height="20" style="clip-path: inset(10% 25%)"/>')).toEqual([[20, 12], [40, 12], [40, 28], [20, 28]]);
    // 線のある図形の既定の箱 (border-box → stroke-box) は、線の太さの半分だけ広い
    expect(clip('<rect x="10" y="10" width="40" height="20" stroke="#000" stroke-width="4" style="clip-path: inset(0)"/>')).toEqual([[8, 8], [52, 8], [52, 32], [8, 32]]);
    expect(clip('<rect x="10" y="10" width="40" height="20" stroke="#000" stroke-width="4" style="clip-path: inset(0) fill-box"/>')).toEqual([[10, 10], [50, 10], [50, 30], [10, 30]]);
    expect(clip('<rect x="0" y="0" width="40" height="20" style="clip-path: polygon(50% 0, 100% 100%, 0 100%)"/>')).toEqual([[20, 0], [40, 20], [0, 20]]);
    expect(clip('<rect x="0" y="0" width="40" height="20" style="clip-path: xywh(1px 2px 10px 5px)"/>')).toEqual([[1, 2], [11, 2], [11, 7], [1, 7]]);
    expect(clip('<rect x="5" y="5" width="10" height="10" style="clip-path: view-box"/>')).toEqual([[0, 0], [200, 0], [200, 100], [0, 100]]);
  });

  it('circle()・ellipse() の半径と位置、path()', () => {
    const c = clip('<rect x="0" y="0" width="40" height="20" style="clip-path: circle(5px at 10px 10px)"/>') as number[][];
    expect(Math.min(...c.map((p) => p[0]))).toBeCloseTo(5, 3);
    expect(Math.max(...c.map((p) => p[0]))).toBeCloseTo(15, 3);
    // 半径の既定は closest-side (中心 (20, 10) から上下の辺まで 10)
    const d = clip('<rect x="0" y="0" width="40" height="20" style="clip-path: circle()"/>') as number[][];
    expect(Math.max(...d.map((p) => p[1]))).toBeCloseTo(20, 3);
    const e = clip('<rect x="0" y="0" width="40" height="20" style="clip-path: ellipse(50% 50%)"/>') as number[][];
    expect(Math.max(...e.map((p) => p[0]))).toBeCloseTo(40, 3);
    expect(clip(`<rect x="10" y="10" width="40" height="20" style="clip-path: path('M0 0 L10 0 L0 10 Z')"/>`)).toEqual([[10, 10], [20, 10], [10, 20]]);
  });

  it('無い要素を指す url() は、指定が無いものとする。読めない値はラスタライズ', () => {
    expect(parseSvg(svg('<rect width="5" height="5" clip-path="url(#none)"/>'), parse)!.shapes[0].clips).toBeUndefined();
    expect(parseSvg(svg('<rect width="5" height="5" style="clip-path: star(5)"/>'), parse)).toBeNull();
  });
});

describe('SVG の use の外のファイル', () => {
  it('use は外のファイルの要素を、そのファイルの <style> と id の参照 (グラデーション) とともに描く', () => {
    const icons = svg('<style>.i{fill:#0f0}</style><linearGradient id="lg"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><symbol id="a"><rect class="i" width="5" height="5"/><rect x="5" width="5" height="5" fill="url(#lg)"/></symbol>');
    const asked: string[] = [];
    const d = parseSvg(svg('<use href="icons.svg#a" x="10" y="20"/><use href="none.svg#a"/>'), parse, { resource: (h) => (asked.push(h), h === 'icons.svg' ? icons : undefined) })!;
    expect(asked).toEqual(['icons.svg', 'none.svg']);
    expect(d.shapes.map((x) => [x.fill, !!x.fillPaint])).toEqual([
      ['#00ff00', false],
      ['#0000ff', true],
    ]);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 10, y: 20 });
  });

  it('PDF: SVG の場所を基準に、登録した SVG を引く。見つからないファイルは警告に出す', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('img/icons.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg('<symbol id="a"><rect width="50" height="50" fill="#f00"/></symbol>')), width: 200, height: 100 });
    assets.register('img/a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg('<use href="icons.svg#a"/><use href="missing.svg#b"/>')), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'img/a.svg', width: 200, height: 100 }] }]));
    expect(tree.warnings.filter((w) => w.includes('missing.svg'))).toHaveLength(1);
    expect(tree.warnings.some((w) => w.includes('icons.svg'))).toBe(false);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const contents = pdf.getPage(0).node.Contents()!;
    const streams = 'asArray' in contents ? (contents as PDFArray).asArray().map((r) => pdf.context.lookup(r)) : [contents];
    expect(streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n')).toMatch(/1 0 0 rg/);
  });
});

describe('SVG の tspan の字の間・線と textPath', () => {
  const xs = (body: string) => parseSvg(svg(body), parse, { outline: box })!.shapes.flatMap((sh) => sh.segs.filter((g) => g.op === 'M').map((g) => +(g as { x: number }).x.toFixed(3)));
  it('letter-spacing・word-spacing は tspan でも変えられ、受け継ぐ (em も読む)', () => {
    expect(xs('<text x="0" y="20" font-size="10">ab<tspan letter-spacing="2">cd</tspan></text>')).toEqual([0, 5, 10, 17]);
    expect(xs('<text x="0" y="20" font-size="10" letter-spacing="0.1em">ab</text>')).toEqual([0, 6]);
  });

  it('text-decoration は、指定した tspan の字の範囲に、その要素の塗りで引く (SVG 1.1 §10.12)', () => {
    const d = parseSvg(svg('<text x="0" y="20" font-size="10" fill="#000">ab<tspan fill="#f00" text-decoration="underline">cd</tspan></text>'), parse, { outline: box })!;
    const line = d.shapes.find((x) => x.fill === '#ff0000' && x.segs.length === 5 && !x.text)!;
    const lx = line.segs.filter((g) => g.op !== 'Z').map((g) => (g as { x: number }).x);
    expect([Math.min(...lx), Math.max(...lx)]).toEqual([10, 20]);
  });

  it('textPath の side="right" はパスの向きを逆にし、baseline-shift は字をパスに垂直にずらす', () => {
    const path = '<defs><path id="p" d="M0 50 L200 50"/></defs>';
    const a = parseSvg(svg(`${path}<text font-size="10"><textPath href="#p" side="right">a</textPath></text>`), parse, { outline: box })!;
    // 逆向き: 右端 (200) から左へ。字は 180 度回る
    expect((a.shapes[0].segs[0] as { x: number }).x).toBeGreaterThan(190);
    const b = parseSvg(svg(`${path}<text font-size="10"><textPath href="#p"><tspan baseline-shift="5">a</tspan></textPath></text>`), parse, { outline: box })!;
    expect((b.shapes[0].segs[0] as { y: number }).y).toBeCloseTo(35, 5);
  });
});

describe('SVG の @font-face の記述子', () => {
  it('PDF: @font-face の font-weight・font-style で登録し、同じ名前の太さの違う書体を両方使う', async () => {
    const { extraTestFont } = await import('./helpers');
    const { readFileSync } = await import('node:fs');
    const bold = readFileSync(await extraTestFont('Anybody-Bold-v13.ttf')).toString('base64');
    const src = svg(`<style>@font-face{font-family:"SvgX";font-weight:700;src:url("data:font/ttf;base64,${bold}")}</style><text x="5" y="50" font-size="20" font-family="SvgX" font-weight="bold">Ab</text>`);
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    await renderPdf(engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }])), fonts, { assets, parseXml: parse });
    expect(fonts.get('SvgX', 700).weight).toBe(700);
  });
});

describe('SVG の mask・context-fill・GIF の画像', () => {
  const pts = (segs: Seg[]) => segs.filter((g) => g.op !== 'Z').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]);
  it('マスクの領域 (既定は外接矩形の −10%〜120%) で、要素を切り抜く (CSS Masking 1 §9.1)。mask-type="alpha" を読む', () => {
    const d = parseSvg(svg('<mask id="m" mask-type="alpha"><rect width="200" height="100" fill="#fff"/></mask><rect x="10" y="10" width="100" height="50" mask="url(#m)"/>'), parse)!;
    expect(d.shapes[0].masks![0].alpha).toBe(true);
    expect(pts(d.shapes[0].clips!.at(-1)!.segs)).toEqual([[0, 5], [120, 5], [120, 65], [0, 65]]);
    const u = parseSvg(svg('<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="50%" height="20"><rect width="200" height="100" fill="#fff"/></mask><rect width="200" height="100" mask="url(#m)"/>'), parse)!;
    expect(pts(u.shapes[0].clips!.at(-1)!.segs)).toEqual([[0, 0], [100, 0], [100, 20], [0, 20]]);
  });

  it('PDF: mask-type="alpha" は Alpha のソフトマスク、入れ子のマスクはグループにして両方を掛ける', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<mask id="a" mask-type="alpha"><rect width="200" height="100" fill="#000" opacity="0.5"/></mask><mask id="b"><rect width="100" height="100" fill="#fff"/></mask><g mask="url(#a)"><rect width="200" height="100" fill="#f00" mask="url(#b)"/></g>');
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }])), fonts, { assets, parseXml: parse }));
    const { PDFName, PDFDict } = await import('pdf-lib');
    const res = pdf.getPage(0).node.Resources()!;
    const gs = res.lookup(PDFName.of('ExtGState'), PDFDict);
    const all = gs.keys().map((k) => String(gs.lookup(k))).join(' ');
    expect(all).toMatch(/\/S \/Alpha/);
    expect(all).toMatch(/\/S \/Luminosity/);
    // 内側のマスクの図形を入れたグループ (Form XObject) がある
    expect(res.lookup(PDFName.of('XObject'), PDFDict).keys().length).toBeGreaterThan(0);
  });

  it('context-fill・context-stroke は、marker を付けた図形・use の要素の塗りと線 (SVG 2 §13.2)', () => {
    const d = parseSvg(
      svg('<marker id="k" markerWidth="4" markerHeight="4" overflow="visible"><circle r="1" fill="context-stroke" stroke="context-fill"/></marker><path d="M0 0 L10 0" stroke="#f00" fill="#00f" marker-end="url(#k)"/>'),
      parse,
    )!;
    expect([d.shapes[1].fill, d.shapes[1].stroke]).toEqual(['#ff0000', '#0000ff']);
    const u = parseSvg(svg('<defs><rect id="r" width="1" height="1" fill="context-fill"/></defs><use href="#r" fill="#0f0"/>'), parse)!;
    expect(u.shapes[0].fill).toBe('#00ff00');
  });

  it('data: の GIF の画像は PNG にして描く', () => {
    const gif = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
    const d = parseSvg(svg(`<image width="10" height="10" href="data:image/gif;base64,${gif}"/>`), parse)!;
    expect(d.shapes[0].image?.kind).toBe('png');
  });
});

describe('SVG の a のリンク', () => {
  it('PDF: a の中の図形の外接矩形を、URL のリンクの注釈にする (javascript: などは使わない)', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<a href="https://example.com/x"><rect x="10" y="10" width="50" height="20"/></a><a href="javascript:alert(1)"><rect x="100" y="10" width="50" height="20"/></a>');
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 200, height: 100 }] }])), fonts, { assets, parseXml: parse }));
    const { PDFName, PDFArray: Arr } = await import('pdf-lib');
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), Arr);
    const all = annots.asArray().map((r) => String(pdf.context.lookup(r))).join(' ');
    expect(all).toContain('https://example.com/x');
    expect(all).not.toContain('javascript');
    expect(annots.size()).toBe(1);
  });
});

describe('SVG の <style> の @media', () => {
  it('印刷の画面 (SVG の大きさ) で照らし、合うものの規則を読む (all・print・幅・向き。screen は合わない)', async () => {
    const { mediaMatches } = await import('../src/svg');
    const env = { width: 200, height: 100 };
    expect(['print', 'all', 'screen', 'not screen', 'print and (min-width: 150px)', '(max-width: 150px)', '(orientation: landscape)', 'screen, print', '(prefers-color-scheme: dark)', '(hover: hover)'].map((q) => mediaMatches(q, env))).toEqual([
      true, true, false, true, true, false, true, true, false, false,
    ]);
    const d = parseSvg(svg('<style>rect{fill:#f00} @media screen{rect{fill:#0f0}} @media print and (min-width: 100px){rect{stroke:#00f} @media (orientation: portrait){rect{fill:#000}}}</style><rect width="1" height="1"/>'), parse)!;
    expect([d.shapes[0].fill, d.shapes[0].stroke]).toEqual(['#ff0000', '#0000ff']);
  });
});

describe('SVG の縦書き (writing-mode)', () => {
  it('writing-mode が縦なら、字を下へ送り、縦書きの指定 (text-orientation) を輪郭の関数に渡す。text-anchor は送りの向き', () => {
    const seen: Array<string | undefined> = [];
    const outline: TextOutliner = (_t, _f, _w, size, _style, vertical) => {
      seen.push(vertical);
      return { segs: [{ op: 'M', x: 0, y: 0 }], advance: size };
    };
    const ys = (body: string) => parseSvg(svg(body), parse, { outline })!.shapes.map((sh) => [(sh.segs[0] as { x: number }).x, (sh.segs[0] as { y: number }).y]);
    expect(ys('<text x="50" y="10" font-size="10" writing-mode="tb-rl">日本語</text>')).toEqual([[50, 10], [50, 20], [50, 30]]);
    expect(seen).toEqual(['mixed', 'mixed', 'mixed']);
    expect(ys('<text x="50" y="50" font-size="10" style="writing-mode: vertical-rl; text-anchor: middle">日本</text>')).toEqual([[50, 40], [50, 50]]);
    seen.length = 0;
    ys('<text x="50" y="10" font-size="10" style="writing-mode: vertical-rl; text-orientation: upright">ab</text>');
    expect(seen).toEqual(['upright', 'upright']);
  });

  it('PDF: 和字は立て、欧字は寝かせ、句読点は縦書きの字形で描く', async () => {
    const ops = await pdfOps(svg('<text x="100" y="10" font-size="16" writing-mode="tb-rl">日本、ab</text>'));
    expect((ops.match(/ c\n/g) ?? []).length).toBeGreaterThan(10);
  });
});

describe('SVG の tspan の textLength', () => {
  const xs = (body: string) => parseSvg(svg(body), parse, { outline: box })!.shapes.flatMap((sh) => sh.segs.filter((g) => g.op === 'M').map((g) => +(g as { x: number }).x.toFixed(3)));
  it('tspan の textLength は、その中の字の範囲を伸ばし (spacing)、後ろの字をずらす (SVG 1.1 §10.5)', () => {
    // 字の幅 5。cd (幅 10) を 20 にする: c は 10、d は 25、e は 30
    expect(xs('<text x="0" y="20" font-size="10">ab<tspan textLength="20">cd</tspan>e</text>')).toEqual([0, 5, 10, 25, 30]);
  });
  it('lengthAdjust="spacingAndGlyphs" は、字を横に伸ばす', () => {
    const d = parseSvg(svg('<text x="0" y="20" font-size="10"><tspan textLength="20" lengthAdjust="spacingAndGlyphs">ab</tspan>c</text>'), parse, { outline: box })!;
    const pts = d.shapes.flatMap((sh) => sh.segs.filter((g) => g.op !== 'Z').map((g) => +(g as { x: number }).x.toFixed(3)));
    // a は 0〜10、b は 10〜20 (幅 2 倍)、c は 20〜25
    expect(pts).toEqual([0, 10, 10, 20, 20, 25]);
  });
});

describe('SVG の縦書きの textLength と線', () => {
  const outline: TextOutliner = (_t, _f, _w, size) => ({ segs: [{ op: 'M', x: 0, y: 0 }], advance: size });
  it('textLength は送りの向きの長さにそろえ、underline は字の左、overline は右に引く', () => {
    const d = parseSvg(svg('<text x="50" y="0" font-size="10" writing-mode="tb-rl" textLength="40" text-decoration="underline overline">abc</text>'), parse, { outline })!;
    expect(d.shapes.slice(0, 3).map((sh) => (sh.segs[0] as { y: number }).y)).toEqual([0, 15, 30]);
    const bars = d.shapes.slice(3).flatMap((sh) => sh.segs.filter((g) => g.op === 'M').map((g) => +(g as { x: number }).x.toFixed(3)));
    expect(bars).toEqual([44.4, 55]);
  });
});

describe('SVG の inline-size (自動の折り返し)', () => {
  it('横書きの text を inline-size の幅で、語の間・和字の間で折り返す。行の間は line-height', () => {
    const lines = (body: string) => {
      const d = parseSvg(svg(body), parse, { outline: box })!;
      const pts = d.shapes.flatMap((sh) => sh.segs.filter((g) => g.op === 'M').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3) + 10]));
      const byY = new Map<number, number[]>();
      for (const [x, y] of pts) byY.set(y, [...(byY.get(y) ?? []), x]);
      return [...byY.entries()].map(([y, xs]) => [y, xs.length, Math.min(...xs)]);
    };
    // 字の幅 5。幅 30 に「aaa bbb ccc」: 1 行に「aaa bbb」(35) は入らないので「aaa」「bbb」「ccc」
    expect(lines('<text x="10" y="20" font-size="10" style="inline-size: 30px">aaa bbb ccc</text>')).toEqual([[20, 3, 10], [32, 3, 10], [44, 3, 10]]);
    // 和字は字の間で折る。line-height 2
    expect(lines('<text x="0" y="20" font-size="10" style="inline-size: 20px; line-height: 2">日本語の文章</text>')).toEqual([[20, 4, 0], [40, 2, 0]]);
  });
});

describe('SVG フォント (font 要素)', () => {
  it('font-face の font-family の名前の text は、glyph の字形 (y 上向き・units-per-em) で描く。合字の glyph を先に当て、無い字は missing-glyph', () => {
    const font =
      '<defs><font id="f" horiz-adv-x="500"><font-face font-family="Box" units-per-em="1000"/><missing-glyph d="M0 0 L100 0 L100 100 Z"/>' +
      '<glyph unicode="a" d="M0 0 L500 0 L500 700 Z"/><glyph unicode="fi" horiz-adv-x="800" d="M0 0 L800 0 L800 700 Z"/></font></defs>';
    const d = parseSvg(svg(`${font}<text x="10" y="50" font-size="10" font-family="Box">afiz</text>`), parse)!;
    const pts = d.shapes.flatMap((sh) => sh.segs.filter((g) => g.op !== 'Z').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]));
    // a (幅 5、高さ 7 の三角)、fi (幅 8)、z は missing-glyph (幅は font の 500 → 5)
    expect(pts).toEqual([[10, 50], [15, 50], [15, 43], [15, 50], [23, 50], [23, 43], [23, 50], [24, 50], [24, 49]]);
  });
});

/** 内側の影 (手書き・Inkscape でよくある形。台帳の SVG-33 の例) */
const innerShadow =
  '<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="40" height="40" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx="4" dy="4"/><feGaussianBlur stdDeviation="2" result="b"/>' +
  '<feComposite in="SourceAlpha" in2="b" operator="out" result="inv"/><feFlood flood-color="black" flood-opacity=".8"/><feComposite in2="inv" operator="in" result="sh"/>' +
  '<feComposite in="sh" in2="SourceGraphic"/></filter><rect x="5" y="5" width="30" height="30" rx="4" fill="#fc6" filter="url(#f)"/>';

describe('SVG の filter を画素で計算する (図形で近似できないもの)', async () => {
  const { rasterFilter } = await import('../src/svgFilterRaster');
  /** 1 単位 = 1 画素で計算し、結果の画像の画素を返す */
  const run = (body: string) => {
    const d = parseSvg(svg(body), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!;
    const img = d.shapes.find((x) => x.image?.pixels)!.image!;
    const px = img.pixels!;
    const at = (x: number, y: number) => Array.from(px.rgba.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4));
    return { px, at, matrix: img.matrix };
  };
  it('feMorphology の dilate は半径の分だけ太らせ、erode は細らせる (§9.17)。結果は filter の領域に置く', () => {
    const r = run('<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="40" height="40"><feMorphology operator="dilate" radius="3"/></filter><rect x="10" y="10" width="10" height="10" fill="#f00" filter="url(#f)"/>');
    expect([r.px.width, r.px.height]).toEqual([40, 40]);
    expect(r.matrix).toEqual([40, 0, 0, -40, 0, 40]);
    expect(r.at(7, 15)).toEqual([255, 0, 0, 255]);
    expect(r.at(6, 15)[3]).toBe(0);
    const e = run('<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="40" height="40"><feMorphology operator="erode" radius="3"/></filter><rect x="10" y="10" width="10" height="10" fill="#f00" filter="url(#f)"/>');
    expect(e.at(12, 15)[3]).toBe(0);
    expect(e.at(15, 15)).toEqual([255, 0, 0, 255]);
  });

  it('feFlood と feComposite の in・arithmetic (§9.8)', () => {
    const r = run(
      '<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20" color-interpolation-filters="sRGB"><feFlood flood-color="#00f"/><feComposite in2="SourceAlpha" operator="in" result="c"/>' +
        '<feComposite in="c" in2="SourceGraphic" operator="arithmetic" k2="0.5" k3="0.5"/></filter><rect x="5" y="5" width="10" height="10" fill="#f00" filter="url(#f)"/>',
    );
    expect(r.at(10, 10)).toEqual([128, 0, 128, 255]);
    expect(r.at(2, 2)[3]).toBe(0);
  });

  // SVG-33: feComposite の in・out・atop で、in が単色 (flood) でないものは、図形の近似では素通しになっていた (内側の影で図形の全体が影の色になる)
  it('内側の影 (feComposite の out・in。SVG-33): 図形の真ん中は元の色、左上の縁だけが影の色 (画素で計算する)', () => {
    const r = run(innerShadow);
    // 真ん中: 元の色 (#fc6)。前は図形の全体が黒 80% で塗られていた
    expect(r.at(25, 25)).toEqual([255, 204, 102, 255]);
    // 左上の縁の内側: 影 (黒) が濃く掛かる
    expect(r.at(6, 15)[0]).toBeLessThan(150);
  });

  it('feComposite の in で、in2 がずらした写しなら、重なりだけを描く (SVG-33)', () => {
    const r = run(
      '<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="40" height="40"><feOffset in="SourceGraphic" dx="10" result="o"/><feComposite in="SourceGraphic" in2="o" operator="in"/></filter>' +
        '<rect x="5" y="5" width="20" height="20" fill="#f00" filter="url(#f)"/>',
    );
    expect(r.at(20, 15)).toEqual([255, 0, 0, 255]);
    // 重なりの外 (元の図形の左の部分) は描かない。前は元の図形の全体を描いていた
    expect(r.at(10, 15)[3]).toBe(0);
  });
  it('内側の影は、Node の PDF の書き出しでは画素で計算して描く (SVG-33)', () => {
    const d = parseSvg(svg(innerShadow), parse, { approximateFilters: true, rasterFilter, filterResolution: 1 })!;
    expect(d.shapes.some((x) => x.image?.pixels)).toBe(true);
  });

  it('光の効果: 真上 (elevation 90) の遠い光は、平らな面を光の色にする (§9.10)', () => {
    const r = run('<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20"><feDiffuseLighting lighting-color="#ff8000" diffuseConstant="1"><feDistantLight azimuth="0" elevation="90"/></feDiffuseLighting></filter><rect width="20" height="20" filter="url(#f)"/>');
    expect(r.at(10, 10)).toEqual([255, 128, 0, 255]);
  });

  it('feTurbulence は seed で決まる模様を作る (§9.21)。同じ seed は同じ結果', () => {
    const body = (seed: number) => `<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><feTurbulence type="fractalNoise" baseFrequency="0.1" numOctaves="2" seed="${seed}"/></filter><rect width="32" height="32" filter="url(#f)"/>`;
    const a = run(body(1));
    const b = run(body(1));
    const c = run(body(2));
    expect(Array.from(a.px.rgba)).toEqual(Array.from(b.px.rgba));
    expect(Array.from(a.px.rgba)).not.toEqual(Array.from(c.px.rgba));
    const vals = new Set(Array.from({ length: 32 }, (_, i) => a.at(i, 16)[0]));
    expect(vals.size).toBeGreaterThan(5);
  });

  it('PDF: 画素で計算した filter を画像として埋め込む', async () => {
    const ops = await pdfOps(svg('<filter id="f"><feTurbulence baseFrequency="0.05"/></filter><rect width="100" height="50" filter="url(#f)"/>'));
    expect(ops).toMatch(/ Do\n/);
  });
});

describe('SVG の foreignObject の HTML (文字の近似)', () => {
  const html = (inner: string, attrs = 'x="10" y="10" width="40" height="60"') => `<foreignObject ${attrs}><div xmlns="http://www.w3.org/1999/xhtml">${inner}</div></foreignObject>`;
  /** 字ごとの左上の点 */
  const pts = (body: string) =>
    parseSvg(svg(body), parse, { outline: box, approximateFilters: true })!.shapes.flatMap((sh) => sh.segs.filter((g) => g.op === 'M').map((g) => [+(g as { x: number }).x.toFixed(3), +(g as { y: number }).y.toFixed(3)]));
  it('画像にできる環境 (近似しないとき) は、描けないもの (SVG ごと画像にする)', () => {
    expect(parseSvg(svg(html('a')), parse, { outline: box })).toBeNull();
  });
  it('ブロックと br で行を分け、枠の幅で折り返す。字の大きさ・色は <style> と style 属性から', () => {
    // 字の大きさ 10 (幅 5)。行の高さ 12、最初の基線は 10 + 1 + 8 = 19 → 字の上端 9
    const p = pts(`<style>.l{font-size:10px}</style>${html('<p class="l">aaaa bbbb ccc</p><p class="l">d<br/>e</p>')}`);
    // 1 行目 aaaa、2 行目 bbbb ccc (空白を入れて幅 40 にちょうど収まる)、次のブロックの d、br の後の e
    expect(p).toEqual([[10, 9], [15, 9], [20, 9], [25, 9], [10, 21], [15, 21], [20, 21], [25, 21], [30, 21], [35, 21], [40, 21], [45, 21], [10, 33], [10, 45]]);
    const d = parseSvg(svg(html('<span style="color:#f00;font-size:10px">a</span>')), parse, { outline: box, approximateFilters: true })!;
    expect(d.shapes[0].fill).toBe('#ff0000');
    // 枠で切る
    expect(d.shapes[0].clips).toHaveLength(1);
  });

  it('text-align: center は枠の中央に、white-space: nowrap は折り返さない', () => {
    expect(pts(html('<p style="text-align:center;font-size:10px">ab</p>'))[0]).toEqual([25, 9]);
    expect(pts(html('<p style="white-space:nowrap;font-size:10px">aaaa bbbb ccc</p>')).every((q) => q[1] === 9)).toBe(true);
  });
});

describe('feComposite の in・out・atop の図形の近似 (SVG-33)', () => {
  const approx = (body: string, onUnsupported?: (w: string) => void) => parseSvg(svg(body), parse, { approximateFilters: true, ...(onUnsupported ? { onUnsupported } : {}) });
  it('図形で正しく描けないもの (内側の影・ずらした写しとの in・in2 がずれた out・flood の out) は近似せず、画素の計算が無ければ描けないものにする', () => {
    let why = '';
    expect(approx(innerShadow, (w) => (why = w))).toBeNull();
    expect(why).toMatch(/feComposite/);
    expect(approx('<filter id="f"><feOffset in="SourceGraphic" dx="10" result="o"/><feComposite in="SourceGraphic" in2="o" operator="in"/></filter><rect width="20" height="20" filter="url(#f)"/>')).toBeNull();
    expect(approx('<filter id="f"><feOffset in="SourceGraphic" dx="10" result="o"/><feComposite in="SourceGraphic" in2="o" operator="atop"/></filter><rect width="20" height="20" filter="url(#f)"/>')).toBeNull();
    expect(approx('<filter id="f"><feFlood flood-color="#f00"/><feComposite in2="SourceAlpha" operator="out"/></filter><rect width="20" height="20" filter="url(#f)"/>')).toBeNull();
    // out で切り抜かずに描いた影が、元の図形で隠れないもの (影だけを結果にする)
    expect(approx('<filter id="f"><feOffset in="SourceAlpha" dx="3" dy="3"/><feComposite in2="SourceAlpha" operator="out"/></filter><rect width="20" height="20" filter="url(#f)"/>')).toBeNull();
    // 切り抜いた後でずらすもの
    expect(approx('<filter id="f"><feOffset in="SourceAlpha" dx="3" dy="3"/><feComposite in2="SourceAlpha" operator="out"/><feOffset dx="5"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><rect width="20" height="20" filter="url(#f)"/>')).toBeNull();
  });

  it('図形で正しく描けるもの (flood の in・atop、元の図形どうしの in、元の図形で隠れる out の影) は近似する', () => {
    // flood を元の図形の形で塗る (in・atop)
    const a = approx('<filter id="f"><feFlood flood-color="#00f"/><feComposite in2="SourceAlpha" operator="in"/></filter><rect width="20" height="20" fill="#f00" filter="url(#f)"/>')!;
    expect(a.shapes.map((x) => x.fill)).toEqual(['#0000ff']);
    const t = approx('<filter id="f"><feFlood flood-color="#00f" flood-opacity=".5"/><feComposite in2="SourceGraphic" operator="atop"/></filter><rect width="20" height="20" fill="#f00" filter="url(#f)"/>')!;
    expect(t.shapes.map((x) => [x.fill, x.fillOpacity])).toEqual([['#ff0000', 1], ['#0000ff', 0.5]]);
    // 元の図形どうしの in は元の図形
    const s = approx('<filter id="f"><feComposite in="SourceGraphic" in2="SourceAlpha" operator="in"/></filter><rect width="20" height="20" fill="#f00" filter="url(#f)"/>')!;
    expect(s.shapes.map((x) => x.fill)).toEqual(['#ff0000']);
    // 影を元の図形で切り抜き (out)、元の図形を上に重ねる: 切り抜く所は元の図形で隠れるので、切り抜かずに描く
    const d = approx('<filter id="f"><feOffset in="SourceAlpha" dx="3" dy="3"/><feComposite in2="SourceAlpha" operator="out"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><rect width="20" height="20" fill="#f00" filter="url(#f)"/>')!;
    expect(d.shapes.map((x) => x.fill)).toEqual(['#000000', '#ff0000']);
    // in2 が空 (BackgroundAlpha): out は in のまま
    const e = approx('<filter id="f"><feComposite in="SourceGraphic" in2="BackgroundAlpha" operator="out"/></filter><rect width="20" height="20" fill="#f00" filter="url(#f)"/>')!;
    expect(e.shapes.map((x) => x.fill)).toEqual(['#ff0000']);
  });
});
