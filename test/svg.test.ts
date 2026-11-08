import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument, PDFName } from 'pdf-lib';
import { parsePathData, parseSvg } from '../src/svg';
import { AssetStore } from '../src/assets';
import { renderPdf } from '../src/pdfRenderer';
import { LayoutEngine } from '../src/layoutEngine';
import { FAMILY, doc, makeEngine } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string, attrs = 'width="100" height="50" viewBox="0 0 100 50"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe('SVG → ベクタ', () => {
  it('単位の付いた長さは利用者座標 (px) に直す。viewBox の無い根の svg は、width・height を px にして viewBox にする (SVG 1.1 §7.10)', () => {
    const d = parseSvg(svg('<rect x="1cm" y="0" width="1in" height="12pt"/>', 'width="4.5cm" height="2in"'), parse)!;
    expect(d.viewBox[2]).toBeCloseTo((4.5 * 96) / 2.54, 3);
    expect(d.viewBox[3]).toBeCloseTo(192, 3);
    const seg = d.shapes[0].segs as Array<{ x: number; y: number }>;
    const xs = seg.filter((p) => p.x !== undefined).map((p) => p.x);
    const ys = seg.filter((p) => p.y !== undefined).map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(96 / 2.54, 3);
    expect(Math.max(...xs)).toBeCloseTo(96 / 2.54 + 96, 3);
    expect(Math.max(...ys)).toBeCloseTo(16, 3);
  });
  it('path の相対・省略記法を絶対座標の M/L/C/Z にする', () => {
    const s = parsePathData('M10 10 h20 v20 l-20 0 z m5 5 c1,1 2,2 3,3 s1,1 2,2')!;
    expect(s[1]).toEqual({ op: 'L', x: 30, y: 10 });
    expect(s[2]).toEqual({ op: 'L', x: 30, y: 30 });
    expect(s.find((x) => x.op === 'Z')).toBeTruthy();
    const c = s.filter((x) => x.op === 'C');
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ x: 18, y: 18 }); // z 後の現在点は (10,10) → m5 5 → (15,15)、c の終点 (18,18)
  });

  it('円弧は 90° 以下の三次ベジエに変換され、終点が一致する', () => {
    const s = parsePathData('M0 0 A10 10 0 0 1 20 0')!;
    const cs = s.filter((x) => x.op === 'C');
    expect(cs.length).toBe(2);
    expect(cs[cs.length - 1]).toMatchObject({ x: 20, y: 0 });
  });

  it('transform・継承された fill・display:none・opacity を解釈する', () => {
    const d = parseSvg(
      svg(`<g fill="#ff0000" opacity="0.5" transform="translate(10,5)"><rect x="0" y="0" width="10" height="10"/><path display="none" d="M0 0L1 1"/></g><circle cx="50" cy="25" r="5" fill="none" stroke="blue" stroke-width="2"/>`),
      parse,
    )!;
    expect(d.shapes).toHaveLength(2);
    expect(d.shapes[0].fill).toBe('#ff0000');
    expect(d.shapes[0].fillOpacity).toBeCloseTo(0.5);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 10, y: 5 });
    expect(d.shapes[1].fill).toBeUndefined();
    expect(d.shapes[1].stroke).toBe('#0000ff');
    expect(d.shapes[1].strokeWidth).toBe(2);
  });

  it('非表示の image は無視できるが、mask・(輪郭を作れない) text 等を含む SVG は null (ラスタライズへ)', () => {
    expect(parseSvg(svg('<g display="none"><image width="1" height="1"/></g><path d="M0 0L10 10"/>'), parse)).not.toBeNull();
    expect(parseSvg(svg('<rect width="5" height="5" filter="url(#f)"/>'), parse)).toBeNull();
    expect(parseSvg(svg('<text x="0" y="10">hi</text>'), parse)).toBeNull();
  });

  it('PDF にはベクタ命令として埋め込まれ (画像 XObject なし)、不透明度は ExtGState になる', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<path fill="#158030" d="M0 0H50V25H0Z"/><path fill="#ff0000" fill-opacity="0.5" d="M50 25H100V50H50Z"/>');
    assets.register('a.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'a.svg', width: 100, height: 50 }] }]));
    const bytes = await renderPdf(tree, fonts, { assets, parseXml: parse });
    const pdf = await PDFDocument.load(bytes);
    const res = pdf.getPage(0).node.Resources();
    const xo = res?.lookup(PDFName.of('XObject')) as { keys(): unknown[] } | undefined;
    expect(xo?.keys().length ?? 0).toBe(0);
    expect(res?.lookup(PDFName.of('ExtGState'))).toBeDefined();

    // パースできない SVG (グラデーション) はラスタライズに回る = ブラウザ無しの Node では画像が出ない
    assets.register('g.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg('<linearGradient id="a"/>')), width: 1, height: 1 });
  });

  it('画像を描けない環境 (Node) では、図形にできない SVG (filter など) を仮の枠で描き、警告する', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore({ parseXml: parse });
    const filtered = svg('<filter id="f"><feTurbulence baseFrequency="0.05"/></filter><rect width="100" height="50" filter="url(#f)"/>');
    const a = await assets.addBlob('m.svg', new Blob([filtered], { type: 'image/svg+xml' }));
    expect([a?.drawable, a?.unsupported, a?.width]).toEqual([false, 'filter feturbulence', 100]);
    // 描ける SVG (text を含む) はそのまま
    const ok = await assets.addBlob('t.svg', new Blob([svg('<text x="5" y="30">A</text>')], { type: 'image/svg+xml' }));
    expect(ok?.drawable).toBeUndefined();
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const img = { type: 'image' as const, src: 'm.svg' };
    const tree = engine.layout(doc([{ type: 'block', children: [img, img] }]));
    expect(tree.warnings).toEqual(['画像 m.svg を描けないため、仮の枠で描きます (filter feturbulence)']);
  });
});

describe('SVG のグラデーション・clipPath・use (O-01)', () => {
  const grad = svg(`<defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="0.5" stop-color="#00ff00"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <radialGradient id="r" href="#g" cx="50%" cy="50%" r="50%"/>
      <clipPath id="c"><circle cx="50" cy="25" r="20"/></clipPath>
      <rect id="box" width="10" height="10" fill="url(#g)"/>
    </defs>
    <rect x="0" y="0" width="100" height="50" fill="url(#g)" clip-path="url(#c)"/>
    <ellipse cx="20" cy="20" rx="10" ry="5" fill="url(#r)"/>
    <use href="#box" x="80" y="30"/>`);

  it('グラデーション (href で stop を継承)・切り抜き・use を図形にする', () => {
    const d = parseSvg(grad, parse)!;
    expect(d).not.toBeNull();
    expect(d.shapes).toHaveLength(3);
    expect(d.shapes[0].fillPaint?.kind).toBe('linear');
    expect(d.shapes[0].fillPaint?.stops.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    // objectBoundingBox: 0〜1 を図形の外接矩形 (100×50) に写す
    expect(d.shapes[0].fillPaint?.matrix).toEqual([100, 0, 0, 50, 0, 0]);
    expect(d.shapes[0].clips).toHaveLength(1);
    expect(d.shapes[1].fillPaint?.kind).toBe('radial');
    expect(d.shapes[1].fillPaint?.stops).toHaveLength(3);
    expect(d.shapes[2].segs[0]).toEqual({ op: 'M', x: 80, y: 30 });
  });

  it('PDF ではグラデーションを shading pattern、切り抜きを W n で描く (画像にしない)', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('g.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(grad), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'g.svg', width: 100, height: 50 }] }]));
    const bytes = await renderPdf(tree, fonts, { assets, parseXml: parse, subset: false });
    const pdf = await PDFDocument.load(bytes);
    const res = pdf.getPage(0).node.Resources();
    const pat = res?.lookup(PDFName.of('Pattern')) as { keys(): unknown[] } | undefined;
    expect(pat?.keys().length).toBe(3);
    const xo = res?.lookup(PDFName.of('XObject')) as { keys(): unknown[] } | undefined;
    expect(xo?.keys().length ?? 0).toBe(0);
  });

  it('<style> の規則 (要素名・.class・#id、詳細度と出現順、style 属性が最優先) を当てる', () => {
    const d = parseSvg(
      svg(
        '<style>/* c */ rect{fill:#00f} .st0{fill:#f00;stroke:#0f0} .st0.big{stroke-width:4} #x{fill:#ff0}</style>' +
          '<rect class="st0" width="5" height="5"/><rect width="5" height="5"/><rect id="x" class="st0 big" width="5" height="5"/><rect class="st0" style="fill:#000" width="5" height="5"/>',
      ),
      parse,
    )!;
    expect(d.shapes.map((x) => x.fill)).toEqual(['#ff0000', '#0000ff', '#ffff00', '#000000']);
    expect(d.shapes[0].stroke).toBe('#00ff00');
    expect(d.shapes[2].strokeWidth).toBe(4);
    // 扱えない選択子はラスタライズへ
    expect(parseSvg(svg('<style>g rect{fill:red}</style><rect width="5" height="5"/>'), parse)).toBeNull();
    // * はすべての要素 (matplotlib の出力の *{stroke-linejoin: round})
    expect(parseSvg(svg('<style>*{fill:#00f} rect{stroke:#f00}</style><rect width="5" height="5"/>'), parse)!.shapes[0]).toMatchObject({ fill: '#0000ff', stroke: '#ff0000' });
  });

  it('@font-face は読み飛ばし、switch は条件を満たす最初の子だけ、SVG でない名前空間の要素は描かない', () => {
    const d = parseSvg(
      svg(
        '<style><![CDATA[@font-face{font-family:"A";src:url("data:;base64,AAAA")} rect{fill:#00f}]]></style>' +
          '<switch><foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/"><x/></foreignObject><rect width="5" height="5"/><rect width="9" height="9"/></switch>' +
          '<v:paragraph xmlns:v="http://schemas.microsoft.com/visio/2003/SVGExtensions/"/>',
      ),
      parse,
    )!;
    expect(d.shapes.map((x) => [x.fill, x.segs[2]])).toEqual([['#0000ff', { op: 'L', x: 5, y: 5 }]]);
  });

  it('mask: 中身をマスクを使う要素の座標で図形にし、要素の図形に付ける。PDF では輝度のソフトマスク', async () => {
    const src = svg(
      '<defs><mask id="m" fill="#fff"><rect width="10" height="10"/></mask></defs><g transform="translate(5 0)" mask="url(#m)"><rect width="20" height="20" fill="#f00"/><circle r="3" fill="#00f"/></g><rect width="1" height="1"/>',
    );
    const d = parseSvg(src, parse)!;
    expect(d.shapes.map((x) => x.masks?.length ?? 0)).toEqual([1, 1, 0]);
    expect(d.shapes[0].masks![0]).toBe(d.shapes[1].masks![0]);
    // マスクの中身は、マスクの要素の fill を受け継ぎ、g の translate の中で描く
    expect(d.shapes[0].masks![0].shapes[0]).toMatchObject({ fill: '#ffffff', segs: [{ op: 'M', x: 5, y: 0 }, { op: 'L', x: 15, y: 0 }, {}, {}, {}] });
    // 参照先が mask でなければ、図形にできない
    expect(parseSvg(svg('<rect width="1" height="1" mask="url(#x)"/>'), parse)).toBeNull();

    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('m.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'm.svg', width: 100, height: 50 }] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ExtGState')) as { entries(): [unknown, unknown][] } | undefined;
    const smasks = (gs?.entries() ?? []).map(([, v]) => String(pdf.context.lookup(v as never))).filter((t) => t.includes('/SMask'));
    expect(smasks).toHaveLength(1); // 同じマスクは 1 つの ExtGState
    expect(smasks[0]).toContain('/Luminosity');
  });

  it('mix-blend-mode (multiply・screen・difference) は図形の描画モードになり、PDF では ExtGState の BM になる', async () => {
    const src = svg('<rect width="10" height="10" fill="#000" style="mix-blend-mode:multiply"/><rect width="10" height="10" fill="#fff" mix-blend-mode="difference"/>');
    const d = parseSvg(src, parse)!;
    expect(d.shapes.map((x) => x.blend)).toEqual(['multiply', 'difference']);
    // 子をまとめて重ねる g の描画モードと、ほかの値は扱わず、描画モード無しで描く (対応する前と同じ)
    expect(parseSvg(svg('<g style="mix-blend-mode:multiply"><rect width="1" height="1"/></g>'), parse)!.shapes.map((x) => x.blend)).toEqual([undefined]);
    expect(parseSvg(svg('<rect width="1" height="1" style="mix-blend-mode:overlay"/>'), parse)!.shapes.map((x) => x.blend)).toEqual([undefined]);
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('b.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'b.svg', width: 100, height: 50 }] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ExtGState')) as { entries(): [unknown, unknown][] } | undefined;
    const all = (gs?.entries() ?? []).map(([, v]) => String(pdf.context.lookup(v as never))).join(' ');
    expect(all).toContain('/BM /Multiply');
    expect(all).toContain('/BM /Difference');
  });

  it('filter: ふつうは図形にしない。近似するときは影 (ずらした半透明の写しの重ね) と元の図形にする', () => {
    const drop = svg('<filter id="d"><feDropShadow dx="4" dy="2" stdDeviation="2" flood-color="#f00" flood-opacity="0.5"/></filter><rect width="10" height="10" fill="#00f" filter="url(#d)"/>');
    expect(parseSvg(drop, parse)).toBeNull();
    const d = parseSvg(drop, parse, { approximateFilters: true })!;
    // 影 5 枚 (外から 2σ・1.5σ・σ・0.5σ・0 太らせる) と元の図形
    expect(d.shapes).toHaveLength(6);
    expect(d.shapes.slice(0, 5).map((x) => [x.fill, x.stroke ?? null, x.strokeWidth])).toEqual([
      ['#ff0000', '#ff0000', 8],
      ['#ff0000', '#ff0000', 6],
      ['#ff0000', '#ff0000', 4],
      ['#ff0000', '#ff0000', 2],
      ['#ff0000', null, 0],
    ]);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 4, y: 2 });
    // 重ねたときの濃さは、縁で不透明度の 0.6 倍
    const total = 1 - d.shapes.slice(0, 5).reduce((a, x) => a * (1 - x.fillOpacity), 1);
    expect(total).toBeCloseTo(0.3, 5);
    expect(d.shapes[5]).toMatchObject({ fill: '#0000ff', fillOpacity: 1 });
    // SourceAlpha をぼかしてずらし、元の図形と合わせる (古い書き方)。色は黒、濃さは feFuncA の slope
    const old = parseSvg(
      svg(
        '<filter id="o"><feGaussianBlur in="SourceAlpha" stdDeviation="0"/><feOffset dx="3" dy="3"/><feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><circle r="5" fill="#0f0" filter="url(#o)"/>',
      ),
      parse,
      { approximateFilters: true },
    )!;
    expect(old.shapes.map((x) => [x.fill, x.fillOpacity])).toEqual([
      ['#000000', 0.4],
      ['#00ff00', 1],
    ]);
    // ぼかしだけは元の図形のまま。扱えない filter は近似しない。使われない <filter> は描かない
    expect(parseSvg(svg('<filter id="b"><feGaussianBlur stdDeviation="2"/></filter><rect width="1" height="1" filter="url(#b)"/>'), parse, { approximateFilters: true })!.shapes).toHaveLength(1);
    expect(parseSvg(svg('<filter id="t"><feTurbulence/></filter><rect width="1" height="1" filter="url(#t)"/>'), parse, { approximateFilters: true })).toBeNull();
    expect(parseSvg(svg('<filter id="u"><feTurbulence/></filter><rect width="1" height="1"/>'), parse)!.shapes).toHaveLength(1);
  });

  it('stop-opacity: 止まり点の不透明度を読み、PDF ではグレーのグラデーションの輝度のソフトマスクにする', async () => {
    const src = svg(
      '<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#f00" stop-opacity="0.2"/></linearGradient><rect width="100" height="50" fill="url(#g)" stroke="#000"/>',
    );
    const d = parseSvg(src, parse)!;
    expect(d.shapes[0].fillPaint!.stops).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#ff0000', opacity: 0.2 },
    ]);
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    assets.register('g.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'g.svg', width: 100, height: 50 }] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ExtGState')) as { entries(): [unknown, unknown][] } | undefined;
    const smasks = (gs?.entries() ?? []).map(([, v]) => String(pdf.context.lookup(v as never))).filter((t) => t.includes('/SMask'));
    expect(smasks).toHaveLength(1);
    expect(smasks[0]).toContain('/Luminosity');
  });

  it('marker: 頂点に置き、向き (auto・auto-start-reverse)・線の太さでの拡大・viewBox と refX / refY を当てる', () => {
    const d = parseSvg(
      svg(
        '<defs><marker id="m" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><rect width="10" height="10" fill="#f00"/></marker>' +
          '<marker id="u" markerWidth="2" markerHeight="2" refX="1" refY="1" markerUnits="userSpaceOnUse" style="overflow: visible"><rect width="2" height="2"/></marker></defs>' +
          '<path d="M10 10 L40 10 L40 30" stroke="#000" stroke-width="2" fill="none" marker-start="url(#m)" marker-mid="url(#u)" marker-end="url(#m)"/>',
      ),
      parse,
    )!;
    // 線 1・始点・途中・終点
    expect(d.shapes).toHaveLength(4);
    const box = (sh: { segs: import('../src/svg').Seg[] }) => {
      const xs = sh.segs.filter((g) => g.op !== 'Z').map((g) => (g as { x: number }).x);
      const ys = sh.segs.filter((g) => g.op !== 'Z').map((g) => (g as { y: number }).y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 100) / 100);
    };
    // 始点: 逆向き (左向き) で、枠 8×8 (4 × 線の太さ 2) の右端の中ほど (refX=10・refY=5) が (10, 10) に来る → 左へ伸びる
    expect(box(d.shapes[1])).toEqual([10, 6, 18, 14]);
    expect(d.shapes[1].clips).toHaveLength(1);
    // 途中: 拡大しない 2×2 の中心が (40, 10)。overflow: visible なので切り抜かない
    expect(box(d.shapes[2])).toEqual([39, 9, 41, 11]);
    expect(d.shapes[2].clips ?? []).toHaveLength(0);
    // 終点: 下向き (90°) で、(40, 30) に右端の中ほどが来る → 上へ伸びる
    expect(box(d.shapes[3])).toEqual([36, 22, 44, 30]);
  });

  it('markerOverflowVisible: overflow の指定が無い marker を切り抜かない (互換)。指定があればそれに従う', () => {
    const doc = (style: string) =>
      svg(
        `<defs><marker id="m" markerWidth="3" markerHeight="3"${style}><rect width="10" height="10"/></marker></defs>` +
          '<path d="M10 10 L40 10" stroke="#000" fill="none" marker-end="url(#m)"/>',
      );
    expect(parseSvg(doc(''), parse)!.shapes[1].clips).toHaveLength(1);
    expect(parseSvg(doc(''), parse, { markerOverflowVisible: true })!.shapes[1].clips ?? []).toHaveLength(0);
    expect(parseSvg(doc(' overflow="hidden"'), parse, { markerOverflowVisible: true })!.shapes[1].clips).toHaveLength(1);
  });

  it('textPath: パスに沿って 1 字ずつ置き、その場所の向きに回す (startOffset・text-anchor)', () => {
    // 1 字 = 幅 10 の四角 (原点は基線の始点)
    const outline = (t: string) => ({ segs: [{ op: 'M' as const, x: 0, y: -10 }, { op: 'L' as const, x: 10, y: 0 }], advance: 10 * [...t].length });
    const d = parseSvg(
      svg('<defs><path id="p" d="M0 50 L100 50 L100 150"/></defs><text><textPath href="#p" startOffset="80">ABCDE</textPath></text>', 'width="200" height="200" viewBox="0 0 200 200"'),
      parse,
      { outline },
    )!;
    // A・B は横の線の上 (80〜100)、C・D は縦の線の上 (下向きに回る)、E も縦の線の上
    expect(d.shapes).toHaveLength(5);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 80, y: 40 });
    const c = d.shapes[2].segs[0] as { x: number; y: number };
    expect([Math.round(c.x), Math.round(c.y)]).toEqual([110, 50]); // 下向き: 字の上 (y=-10) は +x 側
    // 中ほどに揃え、パスの長さ (200) を越える字は描かない
    const m = parseSvg(
      svg('<defs><path id="p" d="M0 50 L100 50"/></defs><text text-anchor="middle"><textPath href="#p" startOffset="50%">ABCDEFGHIJKL</textPath></text>', 'width="200" height="200" viewBox="0 0 200 200"'),
      parse,
      { outline },
    )!;
    expect(m.shapes).toHaveLength(10); // 幅 120 を 50 を中心に置く: -10〜110 のうち、真ん中が 0〜100 の 10 字
  });

  it('textPath の拡張: data-extend は経路の外の字を端の接線の上に置き、data-rotate="none" は字を回さない。letter-spacing を足す', () => {
    const outline = (t: string) => ({ segs: [{ op: 'M' as const, x: 0, y: -10 }, { op: 'L' as const, x: 10, y: 0 }], advance: 10 * [...t].length });
    const d = parseSvg(
      svg('<defs><path id="p" d="M0 50 L100 50 L100 70"/></defs><text><textPath href="#p" startOffset="100" data-extend="true">ABCD</textPath></text>', 'width="200" height="200" viewBox="0 0 200 200"'),
      parse,
      { outline },
    )!;
    // 経路の長さは 120: A (真ん中 105) は縦の線の上、B・C・D は終わり (100, 70) から下向きに延ばした線の上 (D の真ん中は 135 → (100, 85))
    expect(d.shapes).toHaveLength(4);
    const p = (k: number) => (d.shapes[k].segs[1] as { x: number; y: number });
    expect([Math.round(p(3).x), Math.round(p(3).y)]).toEqual([100, 90]);
    const flat = parseSvg(
      svg('<defs><path id="p" d="M0 50 L0 150"/></defs><text letter-spacing="5"><textPath href="#p" data-rotate="none">AB</textPath></text>', 'width="200" height="200" viewBox="0 0 200 200"'),
      parse,
      { outline },
    )!;
    // 回さない: 字の形はそのまま (M は字の左上)。B の真ん中は 10 + 5 + 5 = 20 の位置
    expect(flat.shapes[0].segs[0]).toEqual({ op: 'M', x: -5, y: 45 });
    expect(flat.shapes[1].segs[0]).toEqual({ op: 'M', x: -5, y: 60 });
  });

  it('text の letter-spacing・textLength・text-decoration と、data-kendot', () => {
    const outline = (t: string) => ({ segs: [{ op: 'M' as const, x: 0, y: -10 }, { op: 'L' as const, x: 10, y: 0 }], advance: 10 * [...t].length });
    const xs = (src: string) => parseSvg(svg(src, 'width="200" height="200" viewBox="0 0 200 200"'), parse, { outline })!.shapes.map((sh) => (sh.segs[0] as { x: number }).x);
    expect(xs('<text x="0" y="50" letter-spacing="4">ABC</text>')).toEqual([0, 14, 28]);
    expect(xs('<text x="0" y="50" textLength="60" lengthAdjust="spacing">ABC</text>')).toEqual([0, 25, 50]);
    // spacingAndGlyphs は字を横に伸ばす (幅 30 → 60 で 2 倍)
    const g = parseSvg(svg('<text x="0" y="50" textLength="60" lengthAdjust="spacingAndGlyphs">ABC</text>', 'width="200" height="200" viewBox="0 0 200 200"'), parse, { outline })!;
    expect(g.shapes[0].segs[1]).toMatchObject({ x: 20 });
    // 下線と圏点は、字の後に 1 つの塗りの図形として足す
    const dec = parseSvg(svg('<text x="0" y="50" text-decoration="underline" data-kendot="true">AB</text>', 'width="200" height="200" viewBox="0 0 200 200"'), parse, { outline })!;
    // 字 (1 つの塊) と、線と点 (下線 1 本 + 字ごとの点 2 つ)
    expect(dec.shapes).toHaveLength(2);
    expect(dec.shapes[1].fill).toBe('#000000');
    expect(dec.shapes[1].segs.filter((x) => x.op === 'Z')).toHaveLength(3);
  });

  it('stroke-dashoffset・stroke-miterlimit は図形に渡す (拡大縮小で dashoffset も変わる)', () => {
    const d = parseSvg(svg('<g transform="scale(2)"><path d="M0 0L10 0" stroke="#000" stroke-dasharray="2 1" stroke-dashoffset="1" stroke-miterlimit="8"/></g>'), parse)!;
    expect(d.shapes[0]).toMatchObject({ dash: [4, 2], dashOffset: 2, miterLimit: 8 });
  });

  it('入れ子の svg と viewBox のある symbol: 枠に viewBox を合わせ、枠で切り抜く (overflow: visible なら切り抜かない)', () => {
    const corner = (x: { segs: import('../src/svg').Seg[] }) => x.segs[2];
    // 100×50 の枠の右半分 (50%) に、viewBox 0 0 10 10 を xMidYMid meet で (5 倍、横は 0 から)
    const d = parseSvg(svg('<svg x="50%" y="0" width="50%" height="100%" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'), parse)!;
    expect(corner(d.shapes[0])).toEqual({ op: 'L', x: 100, y: 50 });
    expect(d.shapes[0].clips).toHaveLength(1);
    const v = parseSvg(svg('<svg x="12pt" y="0" overflow="visible"><rect width="4" height="4"/></svg>'), parse)!;
    expect(corner(v.shapes[0])).toEqual({ op: 'L', x: 20, y: 4 });
    expect(v.shapes[0].clips ?? []).toHaveLength(0);
    // symbol の viewBox は use の width・height に合わせる
    const s = parseSvg(svg('<defs><symbol id="s" viewBox="-1 -1 2 2"><rect x="-1" y="-1" width="2" height="2"/></symbol></defs><use href="#s" x="10" y="10" width="20" height="20"/>'), parse)!;
    expect(corner(s.shapes[0])).toEqual({ op: 'L', x: 30, y: 30 });
  });

  it('text は輪郭にする: x / y・tspan の続き・text-anchor・継承した fill', () => {
    // 1 字 = 幅 size/2 の四角
    const outline = (t: string, _f: string | undefined, _w: number, size: number) => {
      const segs: import('../src/svg').Seg[] = [];
      [...t].forEach((_, k) => segs.push({ op: 'M', x: (k * size) / 2, y: -size }, { op: 'L', x: (k * size) / 2 + size / 2, y: 0 }, { op: 'Z' }));
      return { segs, advance: ([...t].length * size) / 2 };
    };
    const d = parseSvg(svg('<g fill="#f00"><text x="10" y="40" font-size="10">ab<tspan fill="#00f">c</tspan></text><text x="50" y="20" font-size="20" text-anchor="middle">xy</text></g>'), parse, { outline })!;
    expect(d.shapes.map((x) => x.fill)).toEqual(['#ff0000', '#0000ff', '#ff0000']);
    expect(d.shapes[0].segs[0]).toEqual({ op: 'M', x: 10, y: 30 });
    expect(d.shapes[1].segs[0]).toMatchObject({ x: 20 }); // ab の後ろ
    expect(d.shapes[2].segs[0]).toMatchObject({ x: 40 }); // 幅 20 の中央を x=50 に
    // dy の em は字の大きさに対して (Visio の出力)。SVG でない名前空間の要素 (v:newlineChar) は描かない
    const e = parseSvg(svg('<text x="0" y="20" font-size="10">a<v:newlineChar xmlns:v="urn:v"/><tspan x="0" dy="1.5em">b</tspan></text>'), parse, { outline })!;
    expect(e.shapes.map((x) => x.segs[0])).toEqual([
      { op: 'M', x: 0, y: 10 },
      { op: 'M', x: 0, y: 25 },
    ]);
    // 輪郭を作れなければラスタライズ
    expect(parseSvg(svg('<text x="0" y="10">hi</text>'), parse)).toBeNull();
  });

  it('xml:space="preserve" (継承する): 改行・タブは空白にし、先頭・末尾・続いた空白も描く (SVG 1.1 §10.15)', () => {
    // 1 字 (空白も) = 幅 5 の四角。字の数は M の数で数える
    const outline = (t: string, _f: string | undefined, _w: number, size: number) => {
      const segs: import('../src/svg').Seg[] = [];
      [...t].forEach((_, k) => segs.push({ op: 'M', x: (k * size) / 2, y: -size }, { op: 'L', x: (k * size) / 2 + size / 2, y: 0 }, { op: 'Z' }));
      return { segs, advance: ([...t].length * size) / 2 };
    };
    const count = (d: ReturnType<typeof parseSvg>) => d!.shapes.reduce((a, s) => a + s.segs.filter((g) => g.op === 'M').length, 0);
    const body = '<text x="0" y="20" font-size="10">  a\n\tb  </text>';
    // 既定: 空白の並びを 1 つにまとめ、先頭・末尾を落とす → "a b"
    expect(count(parseSvg(svg(body), parse, { outline }))).toBe(3);
    // ルートの svg の preserve が text に受け継がれる → "  a  b  " (改行・タブはそれぞれ空白 1 つ)
    expect(count(parseSvg(svg(body, 'width="100" height="50" viewBox="0 0 100 50" xml:space="preserve"'), parse, { outline }))).toBe(8);
    // 子の要素の default で打ち消す
    expect(count(parseSvg(svg('<g xml:space="default">' + body + '</g>', 'width="100" height="50" viewBox="0 0 100 50" xml:space="preserve"'), parse, { outline }))).toBe(3);
  });

  it('PDF では SVG の text を書体の文字として描く (画像にしない)。グラデーションで塗る字は輪郭 (図形) にする', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg('<text x="5" y="30" font-size="20" fill="#336699">Ab漢</text>');
    assets.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 100, height: 50 }] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const res = pdf.getPage(0).node.Resources();
    const xo = res?.lookup(PDFName.of('XObject')) as { keys(): unknown[] } | undefined;
    expect(xo?.keys().length ?? 0).toBe(0);
    const { decodePDFRawStream } = await import('pdf-lib');
    const contents = pdf.getPage(0).node.Contents()!;
    const streams = 'asArray' in contents ? (contents as import('pdf-lib').PDFArray).asArray().map((r) => pdf.context.lookup(r)) : [contents];
    const ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
    expect(ops).toMatch(/0\.2 0\.4 0\.6 rg/);
    // 単色の塗りの字は、埋め込んだ書体の文字 (BT … Tf … Tm … Tj … ET)
    expect(ops).toMatch(/BT[\s\S]*Tf[\s\S]*Tm[\s\S]*Tj[\s\S]*ET/);
    expect((ops.match(/ c\n/g) ?? []).length).toBe(0);
    // グラデーションの塗りの字は、字形の曲線で描く
    const src2 = svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><text x="5" y="30" font-size="20" fill="url(#g)">Ab</text>');
    const assets2 = new AssetStore();
    assets2.register('t.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src2), width: 100, height: 50 });
    const engine2 = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets: assets2 });
    const pdf2 = await PDFDocument.load(await renderPdf(engine2.layout(doc([{ type: 'block', children: [{ type: 'image', src: 't.svg', width: 100, height: 50 }] }])), fonts, { assets: assets2, parseXml: parse }));
    const c2 = pdf2.getPage(0).node.Contents()!;
    const st2 = 'asArray' in c2 ? (c2 as import('pdf-lib').PDFArray).asArray().map((r) => pdf2.context.lookup(r)) : [c2];
    const ops2 = st2.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
    expect((ops2.match(/ c\n/g) ?? []).length).toBeGreaterThan(10);
  });

  it('pattern は模様 (タイル) にする。中身に透明度などがあればラスタライズ', () => {
    const d = parseSvg(
      svg('<defs><pattern id="p" patternUnits="userSpaceOnUse" x="2" y="3" width="10" height="8"><circle cx="5" cy="4" r="2" fill="#f00"/></pattern></defs><rect x="0" y="0" width="50" height="40" fill="url(#p)"/>'),
      parse,
    )!;
    const pt = d.shapes[0].fillPattern!;
    expect(pt).toMatchObject({ width: 10, height: 8, matrix: [1, 0, 0, 1, 2, 3] });
    expect(pt.shapes[0].fill).toBe('#ff0000');
    // objectBoundingBox (既定): 大きさは図形の外接矩形に対する割合
    const b = parseSvg(svg('<pattern id="p" width="0.5" height="0.25"><rect width="5" height="5"/></pattern><rect x="10" y="10" width="40" height="20" fill="url(#p)"/>'), parse)!;
    expect(b.shapes[0].fillPattern).toMatchObject({ width: 20, height: 5, matrix: [1, 0, 0, 1, 10, 10] });
    expect(parseSvg(svg('<pattern id="p" width="1" height="1"><rect width="5" height="5" opacity="0.5"/></pattern><rect width="5" height="5" fill="url(#p)"/>'), parse)).toBeNull();
    expect(parseSvg(svg('<rect width="5" height="5" mask="url(#m)"/>'), parse)).toBeNull();
  });

  it('preserveAspectRatio: 既定 (xMidYMid meet) は縦横比を保って中央に、none は引き伸ばす (O-02)', async () => {
    const { fonts, measurer } = await makeEngine();
    const draw = async (par: string) => {
      const assets = new AssetStore();
      const src = svg('<rect width="100" height="50" fill="#f00"/>', `width="100" height="50" viewBox="0 0 100 50"${par}`);
      assets.register('r.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
      const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
      const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'r.svg', width: 100, height: 100, fit: 'fill' }] }] as never));
      const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
      const { decodePDFRawStream } = await import('pdf-lib');
      const contents = pdf.getPage(0).node.Contents()!;
      const streams = 'asArray' in contents ? (contents as import('pdf-lib').PDFArray).asArray().map((r) => pdf.context.lookup(r)) : [contents];
      const ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
      return /([-\d.]+) 0 0 ([-\d.]+) [-\d.]+ [-\d.]+ cm\n[\s\S]*?1 0 0 rg/.exec(ops)!;
    };
    const meet = await draw('');
    expect(Number(meet[1])).toBeCloseTo(1, 3); // 縦横 1 倍 (100×50 を 100×100 の中央に)
    expect(Number(meet[2])).toBeCloseTo(-1, 3);
    const none = await draw(' preserveAspectRatio="none"');
    expect(Number(none[2])).toBeCloseTo(-2, 3); // 縦だけ 2 倍
  });

  it('線のグラデーション', () => {
    const d = parseSvg(svg('<linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><path d="M0 0L50 50" stroke="url(#g)" stroke-width="3"/>'), parse)!;
    expect(d.shapes[0].strokePaint?.kind).toBe('linear');
    expect(d.shapes[0].stroke).toBe('#0000ff');
  });

  it('PDF では pattern をタイリングパターン、線のグラデーションを線の shading pattern で描く', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore();
    const src = svg(
      '<pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5" fill="#0a0"/></pattern><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
        '<rect width="100" height="50" fill="url(#p)" stroke="url(#g)" stroke-width="4"/>',
    );
    assets.register('p.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 100, height: 50 });
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'p.svg', width: 100, height: 50 }] }]));
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { assets, parseXml: parse }));
    const pats = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Pattern')) as import('pdf-lib').PDFDict;
    const types = pats.keys().map((k) => {
      const o = pdf.context.lookup(pats.get(k)!) as unknown as { dict?: import('pdf-lib').PDFDict; get?: (n: PDFName) => unknown };
      return String((o.dict ?? (o as unknown as import('pdf-lib').PDFDict)).get(PDFName.of('PatternType')));
    });
    expect(types.sort()).toEqual(['1', '2']);
  });
});

describe('vector-effect', () => {
  it('non-scaling-stroke は線の太さを変換で変えず、non-scaling-size は形を原点の周りに元の大きさで置く', () => {
    const d = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g transform="scale(2)">' +
        '<path d="M0 0L10 0" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
        '<path d="M-1 0L1 0" stroke="#000" transform="translate(5 5)" vector-effect="non-scaling-size non-scaling-stroke"/></g></svg>',
      parse,
    )!;
    expect(d.shapes[0].strokeWidth).toBe(1);
    expect(d.shapes[0].nonScalingStroke).toBe(true);
    // 原点 (5, 5) は scale(2) で (10, 10) に写り、形は元の大きさ (幅 2) のまま
    expect(d.shapes[1].nonScalingAnchor).toEqual([10, 10]);
    expect(d.shapes[1].segs.map((g) => ('x' in g ? g.x : 0))).toEqual([9, 11]);
  });
  it('根の svg の overflow: 既定は使わず viewport で切り抜く (SVG 1.1 §14.3.3)。互換の rootOverflowVisible なら、visible のとき切り抜かない', () => {
    const vis = svg('<rect x="0" y="0" width="100" height="50" style="stroke:#000;stroke-width:4"/>', 'width="100" height="50" viewBox="0 0 100 50" style="overflow:visible"');
    const hid = svg('<rect x="0" y="0" width="100" height="50"/>', 'width="100" height="50" viewBox="0 0 100 50"');
    expect(parseSvg(vis, parse)!.noClip).toBeUndefined();
    expect(parseSvg(vis, parse, { rootOverflowVisible: true })!.noClip).toBe(true);
    expect(parseSvg(hid, parse, { rootOverflowVisible: true })!.noClip).toBeUndefined();
  });
});
