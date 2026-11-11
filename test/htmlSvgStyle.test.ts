/**
 * 文書の CSS の fill・stroke・color などを、文書の中にじかに書いた <svg> に渡す (NC-17)。
 *  - SVG 2 §6.4: HTML の文書の style 要素のスタイルシートは、文書の中の SVG の内容にも効く
 *  - SVG 2 §6.6: 表示の属性 (fill="…" など) は、作成者の出どころの、詳細度 0 の規則で、ほかの作成者のスタイルシートより前に置く
 *  - SVG 2 §13.3・CSS Color 4 §6.4・§15.5: currentcolor は、その要素の color の値。キーワードのまま継承する
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { parseCss } from '../src/htmlPaged';
import { serializeInlineSvg } from '../src/htmlSvg';
import { unsupportedCssReport } from '../src/cssUnsupported';
import { parseSvg } from '../src/svg';

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const PATH = 'd="M0 0h10v10H0z"';

/** 文書の中の最初の <svg> を、文書の CSS を渡して書き出す */
const out = (body: string, css = '') => {
  const { document } = parseHTML(`<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`);
  const d = document as unknown as Document;
  const src = cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } });
  const svg = d.querySelector('svg') as unknown as Element;
  return { styled: serializeInlineSvg(svg, (e, root) => src.svgStyle!(e, root)), plain: serializeInlineSvg(svg) };
};
const parseXml = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
/** 書き出した SVG を読んだ図形 */
const shapes = (body: string, css = '') => parseSvg(out(body, css).styled, parseXml)!.shapes;

describe('文書の CSS を、文書の中の <svg> に渡す', () => {
  it('sanitize.css の svg:not([fill]) { fill: currentColor } と、親の color (CSS Color 4 §6.4)', () => {
    const r = out(`<span class="icon"><svg viewBox="0 0 10 10"><path ${PATH}/></svg></span>`, 'svg:not([fill]) { fill: currentColor } .icon { color: red }');
    expect(r.styled).toBe(`${HEAD} viewBox="0 0 10 10" style="fill: currentColor; color: rgb(255, 0, 0)"><path ${PATH}/></svg>`);
    expect(shapes(`<span class="icon"><svg viewBox="0 0 10 10"><path ${PATH}/></svg></span>`, 'svg:not([fill]) { fill: currentColor } .icon { color: red }')[0].fill).toBe('#ff0000');
  });
  it('fill="currentColor" の属性は、<svg> の外から継承した color で塗る (SVG 2 §13.3 の例)', () => {
    const body = `<p class="icon"><svg viewBox="0 0 10 10"><g fill="currentColor"><path ${PATH}/></g><path stroke="currentcolor" fill="none" ${PATH}/></svg></p>`;
    const r = out(body, '.icon { color: #468 }');
    expect(r.styled).toBe(`${HEAD} viewBox="0 0 10 10" style="color: rgb(68, 102, 136)"><g fill="currentColor"><path ${PATH}/></g><path stroke="currentcolor" fill="none" ${PATH}/></svg>`);
    const s = shapes(body, '.icon { color: #468 }');
    expect(s[0].fill).toBe('#446688');
    expect(s[1].stroke).toBe('#446688');
    expect(s[1].fill).toBeUndefined();
  });
  it('文書の CSS が <svg> の中の要素に当たらず、currentColor も使わない文書では、書き出す SVG は変わらない', () => {
    const body = `<p class="icon"><svg viewBox="0 0 10 10" width="10"><g fill="#f00" style="stroke: blue"><path ${PATH}/></g><rect width="5" height="5"/></svg></p>`;
    for (const css of ['', 'body { color: #333 } .icon { color: red; font-size: 20px; opacity: .5 } p { margin: 0 }', 'svg { width: 20px; vertical-align: middle } div path { fill: red }']) {
      const r = out(body, css);
      expect(r.styled).toBe(r.plain);
    }
  });
  it('作成者のスタイルシートの規則は、表示の属性より強い (SVG 2 §6.6)。style 属性は規則より強い', () => {
    const body = `<svg viewBox="0 0 10 10"><path id="a" fill="red" ${PATH}/><path id="b" fill="red" style="fill: lime" ${PATH}/><path id="c" style="fill: lime" ${PATH}/><path id="d" fill="red" ${PATH}/></svg>`;
    const css = '#a, #b { fill: blue } #c { fill: blue !important }';
    const r = out(body, css);
    expect(r.styled).toBe(
      `${HEAD} viewBox="0 0 10 10"><path id="a" fill="red" ${PATH} style="fill: rgb(0, 0, 255)"/><path id="b" fill="red" style="fill: lime" ${PATH}/><path id="c" style="fill: lime; fill: rgb(0, 0, 255)" ${PATH}/><path id="d" fill="red" ${PATH}/></svg>`,
    );
    expect(shapes(body, css).map((s) => s.fill)).toEqual(['#0000ff', '#00ff00', '#0000ff', '#ff0000']);
  });
  it('<svg> の外の要素から継承する fill・stroke・stroke-width (継承する性質。SVG 2 §13.4・§13.5)', () => {
    const body = `<div class="icon"><svg viewBox="0 0 10 10"><path ${PATH}/><path stroke="none" ${PATH}/></svg></div>`;
    const css = '.icon { fill: green; stroke: #00f; stroke-width: 0.125em; stroke-linejoin: round; font-size: 16px }';
    const r = out(body, css);
    expect(r.styled).toBe(`${HEAD} viewBox="0 0 10 10" style="fill: rgb(0, 128, 0); stroke: rgb(0, 0, 255); stroke-width: 2; stroke-linejoin: round"><path ${PATH}/><path stroke="none" ${PATH}/></svg>`);
    const s = shapes(body, css);
    expect([s[0].fill, s[0].stroke, s[0].strokeWidth, s[0].lineJoin]).toEqual(['#008000', '#0000ff', 2, 1]);
    expect(s[1].stroke).toBeUndefined();
  });
  it('<svg> の属性・style 属性があれば、外から継承しない', () => {
    const r = out(`<div class="icon"><svg fill="none" style="stroke: red" viewBox="0 0 10 10"><path ${PATH}/></svg></div>`, '.icon { fill: green; stroke: blue }');
    expect(r.styled).toBe(r.plain);
  });
  it('var()・inherit・em の長さ・百分率の不透明度は、計算値にして渡す', () => {
    const body = `<svg viewBox="0 0 10 10" style="font-size: 10px"><g fill="red" stroke-width="3"><path class="a" ${PATH}/><path class="b" style="fill: var(--brand)" ${PATH}/></g></svg>`;
    const css = ':root { --brand: #0a0b0c } .a { stroke: var(--brand); stroke-width: inherit; fill-opacity: 50%; stroke-opacity: 2; stroke-dasharray: 1em, 2 } .b { fill: blue }';
    const r = out(body, css);
    expect(r.styled).toContain(`<path class="a" ${PATH} style="stroke: rgb(10, 11, 12); stroke-width: 3; fill-opacity: 0.5; stroke-opacity: 1; stroke-dasharray: 10 2"/>`);
    expect(r.styled).toContain(`<path class="b" style="fill: var(--brand); fill: rgb(10, 11, 12)" ${PATH}/>`);
  });
  it('読めない値の宣言は捨て、次に強い宣言 (無ければ属性) を使う (Cascade 5 §5)', () => {
    const body = `<svg viewBox="0 0 10 10"><path fill="red" ${PATH}/></svg>`;
    expect(out(body, 'path { fill: notacolor; stroke-width: -1; fill-opacity: big }').styled).toBe(out(body).plain);
    expect(out(body, 'path { fill: blue } path { fill: notacolor }').styled).toContain('style="fill: rgb(0, 0, 255)"');
  });
  it('<svg> の中の要素の color と currentcolor: キーワードのまま継承し、使う要素の color で決まる (CSS Color 4 §15.5)', () => {
    const body = `<div class="icon"><svg viewBox="0 0 10 10"><g class="g"><path ${PATH}/><path class="k" ${PATH}/></g></svg></div>`;
    const css = '.icon { color: red } .g { fill: currentColor } .k { color: blue }';
    const r = out(body, css);
    expect(r.styled).toBe(`${HEAD} viewBox="0 0 10 10" style="color: rgb(255, 0, 0)"><g class="g" style="fill: currentColor"><path ${PATH}/><path class="k" ${PATH} style="color: rgb(0, 0, 255)"/></g></svg>`);
    expect(shapes(body, css).map((s) => s.fill)).toEqual(['#ff0000', '#0000ff']);
  });
  it('半透明の色 (rgba) は、塗りの不透明度に掛かる', () => {
    const s = shapes(`<div class="icon"><svg viewBox="0 0 10 10"><path fill="currentColor" fill-opacity="0.5" ${PATH}/><path class="p" ${PATH}/></svg></div>`, '.icon { color: rgba(255, 0, 0, 0.5) } .p { fill: none; stroke: rgb(0 0 255 / 25%) }');
    expect([s[0].fill, s[0].fillOpacity]).toEqual(['#ff0000', 0.25]);
    expect([s[1].stroke, s[1].strokeOpacity]).toEqual(['#0000ff', 0.25]);
  });
  it('opacity・fill-rule・stroke-linecap・stroke-miterlimit・stroke-dashoffset', () => {
    const r = out(`<svg viewBox="0 0 10 10"><path ${PATH}/></svg>`, 'path { opacity: 50%; fill-rule: evenodd; stroke-linecap: round; stroke-miterlimit: 2; stroke-dashoffset: 1pt; fill: url(#g) red }');
    expect(r.styled).toContain(`style="fill: url(#g) rgb(255, 0, 0); fill-rule: evenodd; stroke-linecap: round; stroke-miterlimit: 2; stroke-dashoffset: 1.3333; opacity: 0.5"`);
  });
  it('色の関数 (CSS Color 4・5): 文書の CSS の値も、<svg> の属性・style 属性の値も、sRGB にして渡す', () => {
    const body = `<div class="icon"><svg viewBox="0 0 10 10"><path class="a" ${PATH}/><path fill="color(srgb 0 0 1)" ${PATH}/><path style="fill: hwb(120 0% 0%)" ${PATH}/><path class="m" ${PATH}/></svg></div>`;
    const css = '.icon { color: red } .a { fill: oklab(1 0 0) } .m { fill: color-mix(in srgb, currentColor, blue) }';
    expect(shapes(body, css).map((s) => s.fill)).toEqual(['#ffffff', '#0000ff', '#00ff00', '#800080']);
  });
  it('<svg> の中の style 要素の規則も、文書のスタイルシート (SVG 2 §6.4)', () => {
    const body = `<svg viewBox="0 0 10 10"><style>.x { fill: red }</style><path class="x" ${PATH}/></svg>`;
    expect(shapes(body, 'svg .x { fill: blue }')[0].fill).toBe('#0000ff');
    expect(shapes(body)[0].fill).toBe('#ff0000');
  });
  it('importHtml: 画像の data URI に、文書の CSS の色が入る', () => {
    const { document } = parseHTML(`<!DOCTYPE html><html><head><title>t</title></head><body><p class="icon"><svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" ${PATH}/></svg></p></body></html>`);
    const d = document as unknown as Document;
    const css = '.icon { color: red }';
    const res = importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
    const uri = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(JSON.stringify(res.document))![1];
    expect(new TextDecoder().decode(Uint8Array.from(atob(uri), (c) => c.charCodeAt(0)))).toContain('style="color: rgb(255, 0, 0)"');
  });
});

describe('SVG の color と currentColor (単独の SVG でも同じ)', () => {
  const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ${attrs}>${body}</svg>`;
  const P = `<path ${PATH}/>`;
  it('color の無い SVG の currentColor は黒 (color の初期値。これまでと同じ)', () => {
    expect(parseSvg(svg(`<path fill="currentColor" ${PATH}/>`), parseXml)!.shapes[0].fill).toBe('#000000');
  });
  it('color の属性・style・継承。大文字小文字は問わない', () => {
    const d = parseSvg(svg(`<g fill="CURRENTCOLOR">${P}<g color="blue">${P}<g style="color: currentColor">${P}</g></g></g><path fill="lime" stroke="currentColor" ${PATH}/>`, 'color="red"'), parseXml)!;
    expect(d.shapes.map((s) => s.fill)).toEqual(['#ff0000', '#0000ff', '#0000ff', '#00ff00']);
    expect(d.shapes[3].stroke).toBe('#ff0000');
  });
  it('グラデーションの stop-color の currentColor', () => {
    const d = parseSvg(svg(`<linearGradient id="g" color="blue"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="red"/></linearGradient><path fill="url(#g)" ${PATH}/>`, 'color="lime"'), parseXml)!;
    expect(d.shapes[0].fillPaint!.stops.map((s) => s.color)).toEqual(['#0000ff', '#ff0000']);
  });
});

describe('未対応の一覧と @supports', () => {
  it('fill・stroke などは、未対応・知らないプロパティとして数えない', () => {
    const r = unsupportedCssReport(parseCss('svg { fill: currentColor; stroke: red; stroke-width: 2; fill-opacity: .5; stroke-opacity: .5; fill-rule: evenodd; stroke-linecap: round; stroke-linejoin: round; stroke-miterlimit: 2; stroke-dasharray: 1 2; stroke-dashoffset: 1 }'));
    expect(r).toEqual({ unsupported: {}, unknown: {} });
  });
  it('@supports (fill: …) は、読める値なら真', () => {
    expect(supportsCssDeclaration('fill', 'currentColor')).toBe(true);
    expect(supportsCssDeclaration('stroke', 'url(#a) none')).toBe(true);
    expect(supportsCssDeclaration('fill', 'notacolor')).toBe(false);
    expect(supportsCssDeclaration('stroke-width', '-1px')).toBe(false);
    expect(supportsCssDeclaration('stroke-linecap', 'pointy')).toBe(false);
  });
});

describe('SVG の側が属性として読む性質も、文書の CSS から届ける', () => {
  it('stop-color・stop-opacity (SVG 2 §14.2.4.2。継承しない): グラデーションの色を CSS で決める', () => {
    const body = `<svg viewBox="0 0 10 10"><linearGradient id="g"><stop class="a" offset="0"/><stop class="b" offset="1" stop-color="lime"/></linearGradient><path fill="url(#g)" ${PATH}/></svg>`;
    const css = '.a { stop-color: red } .b { stop-color: blue; stop-opacity: 50% } svg { stop-color: yellow }';
    const r = out(body, css);
    expect(r.styled).toContain('<stop class="a" offset="0" style="stop-color: rgb(255, 0, 0)"/>');
    expect(r.styled).toContain('<stop class="b" offset="1" stop-color="lime" style="stop-color: rgb(0, 0, 255); stop-opacity: 0.5"/>');
    const stops = shapes(body, css)[0].fillPaint!.stops;
    expect(stops.map((s) => s.color)).toEqual(['#ff0000', '#0000ff']);
    expect(stops[1].opacity).toBe(0.5);
    // CSS が無ければ、書き出す SVG は変わらない (属性のまま)
    expect(out(body).styled).toBe(out(body).plain);
  });
  it('text-anchor (SVG 2 §11.10.1.1)・clip-rule (CSS Masking 1 §6.2) は継承する。<svg> の外の要素の値も届く', () => {
    const body = `<p class="c"><svg viewBox="0 0 10 10"><text x="5" y="5">a</text><g class="m"><text x="5" y="9">b</text></g></svg></p>`;
    const r = out(body, '.c { text-anchor: middle; clip-rule: evenodd } .m { text-anchor: end }');
    expect(r.styled).toContain('style="clip-rule: evenodd; text-anchor: middle"');
    expect(r.styled).toContain('<g class="m" style="text-anchor: end">');
  });
  it('marker-start・marker-mid・marker-end と一括指定 marker (SVG 2 §13.7.2・§13.7.3)、vector-effect (§8.13。継承しない)', () => {
    const body = `<svg viewBox="0 0 10 10"><marker id="m" markerWidth="2" markerHeight="2"><circle cx="1" cy="1" r="1"/></marker><path class="p" d="M0 0L5 5L10 0" fill="none" stroke="black"/><path class="q" d="M0 9L10 9" stroke="black"/></svg>`;
    const r = out(body, '.p { marker: url(#m); vector-effect: non-scaling-stroke } .q { marker-end: url(#m); marker-start: none }');
    expect(r.styled).toContain('style="marker-start: url(#m); marker-mid: url(#m); marker-end: url(#m); vector-effect: non-scaling-stroke"');
    expect(r.styled).toContain('style="marker-start: none; marker-end: url(#m)"');
  });
  it('読めない値の宣言は捨てる。@supports も、読める値だけ真', () => {
    const body = `<svg viewBox="0 0 10 10"><text class="t" x="5" y="5">a</text></svg>`;
    expect(out(body, '.t { text-anchor: zzz; vector-effect: non-rotation; clip-rule: 1; stop-color: notacolor; marker-end: m; stop-opacity: x }').styled).toBe(out(body).plain);
    for (const [p, v] of [['text-anchor', 'middle'], ['clip-rule', 'evenodd'], ['stop-color', '#f00'], ['stop-opacity', '.5'], ['marker-start', 'url(#m)'], ['marker', 'none'], ['marker', 'url("#m")'], ['vector-effect', 'non-scaling-stroke']])
      expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(true);
    for (const [p, v] of [['text-anchor', 'center'], ['clip-rule', 'zzz'], ['stop-color', 'notacolor'], ['marker-end', 'm'], ['marker', 'zzz'], ['vector-effect', 'non-rotation'], ['paint-order', 'stroke'], ['cx', '1px']])
      expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(false);
  });
});

describe('SVG の要素にだけ当てはまる性質の数え方', () => {
  const doc = (body: string) => parseHTML(`<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;
  const SVG_ONLY = 'paint-order: stroke; cx: 1px; cy: 1px; r: 2px; rx: 1px; ry: 1px; x: 0; y: 0; d: none; color-interpolation: sRGB; color-interpolation-filters: sRGB; flood-color: red; flood-opacity: 1; lighting-color: red; mask-type: alpha';
  it('HTML の要素に書いた SVG の性質は、当てはまらないので何もしない (未対応にも、知らないプロパティにも数えない)', () => {
    const css = parseCss(`div { fill: green; stroke: red; text-anchor: middle; stop-color: red; marker: none; clip-rule: evenodd; vector-effect: none; shape-rendering: crispEdges; text-rendering: optimizeLegibility; ${SVG_ONLY} }`);
    // 文書に <svg> が無い (文書を渡さないときも同じ)
    expect(unsupportedCssReport(css, doc(`<div style="${SVG_ONLY}; fill: red">a</div>`))).toEqual({ unsupported: {}, unknown: {} });
    expect(unsupportedCssReport(css)).toEqual({ unsupported: {}, unknown: {} });
  });
  it('文書の中に <svg> があれば、届けない性質を「<名前> (SVG の要素)」として未対応に数える。描き方の手がかり (shape-rendering・text-rendering) は数えない', () => {
    const css = parseCss('svg circle { paint-order: stroke; r: 4px; shape-rendering: crispEdges; fill: red } text { text-rendering: geometricPrecision; text-anchor: middle }');
    const d = doc(`<div style="paint-order: stroke">a</div><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" style="cx: 3px; fill: blue"/></svg>`);
    // style 属性は、SVG の要素のものだけを数える (div の paint-order は数えない)
    expect(unsupportedCssReport(css, d)).toEqual({ unsupported: { 'paint-order (SVG の要素)': 1, 'r (SVG の要素)': 1, 'cx (SVG の要素)': 1 }, unknown: {} });
  });
  it('SVG の性質でない、知らない名前は、これまでどおり知らないプロパティに数える', () => {
    expect(unsupportedCssReport(parseCss('div { filll: red; strok: 1 }')).unknown).toEqual({ filll: 1, strok: 1 });
  });
});
