/**
 * drawioSketch — draw.io の手書き風 (sketch=1。rough.js の線と塗り) と、ゆらした線 (comic=1・sketchStyle=comic) を描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/js/diagramly/Editor.js の Editor.createRoughCanvas と
 * RoughCanvas (getStyle・limitFill・drawPath・rect・ellipse・roundrect。rough.js の生成器に、図形の経路と、セルのスタイルから作った設定を渡す)、
 * js/grapheditor/Shapes.js の HandJiggle (comic。まっすぐの線を、10 px ほどの区切りごとに横へずらす)。
 * rough.js (MIT License。npm の roughjs) の生成器 (generator) で、線 (path)・塗り (fillPath)・斜線の塗り (fillSketch) を作る。
 *
 * Kumiori では、セルの図形を描いた SVG (drawio.ts の形・道具・図形ライブラリが書いたもの) の、描く要素 (path・rect・ellipse・circle・
 * line・polygon・polyline) を 1 つずつ、同じ設定の rough.js の線と塗りに置き換える (draw.io は描く道具の命令を横取りするが、
 * 塗りと線を決めて描く単位は同じ)。文字・画像 (入れ子の svg・image)・定義 (defs) の中は変えない。
 * comic の線の揺れは、draw.io は Math.random で決める (描くたびに変わる) が、ここではセルの id から決めた乱数で、いつも同じにする
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/diagramly/Editor.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import rough from 'roughjs';
import { f } from './drawioXml';

/** rough.js の生成器 (描く先の無い、形を作るだけのもの) */
let generator: ReturnType<typeof rough.generator> | undefined;

/** RoughCanvas.prototype.maxFillSize・maxFillCount (斜線の塗りの大きさ・線の数の上限) */
const MAX_FILL_SIZE = 200000;
const MAX_FILL_COUNT = 100000;
/** 手書き風にする要素の大きさ (幅 + 高さ) の上限。drawio.ts の座標の上限 (LIMITS.coord。1,000 万 px) と同じ */
const SKETCH_MAX_SIZE = 1e7;
/** Editor.sketchDefaultJiggle (comic の揺れの既定) */
const DEFAULT_JIGGLE = 2;
/** HandJiggle.prototype.maxSegments */
const MAX_SEGMENTS = 10000;
/** 1 つのセルで置き換える要素の数の上限 (それより後はそのまま描く) */
const MAX_ELEMENTS = 2000;

/** セルの id から作る種 (RoughCanvas.getStyle: seed = ((seed << 5) - seed + 字) << 0、初め 1) */
export function sketchSeed(id: string): number {
  let seed = 1;
  for (let i = 0; i < id.length; i++) seed = ((seed << 5) - seed + id.charCodeAt(i)) << 0;
  return seed;
}

/** 手書き風か (sketch か comic。comic は sketch=1;sketchStyle=comic か、comic=1) */
export function sketchKind(style: Record<string, string>): 'rough' | 'comic' | undefined {
  if (style.sketch !== undefined && style.sketch !== '0') return style.sketchStyle === 'comic' ? 'comic' : 'rough';
  if (style.comic !== undefined && style.comic !== '0') return 'comic';
  return undefined;
}

export interface SketchCell {
  id: string;
  style: Record<string, string>;
  /** 形の大きさ (幅 + 高さ。limitFill の上限に使う) */
  size: number;
  /**
   * 書いてよい SVG の字の数の残り (drawio.ts の LIMITS.svgChars。StencilContext.budget)。あれば、置き換えるたびに減らし、
   * 負になったら、その後の要素は置き換えない (そのまま描く)。巨大な形のジグザグの塗り (要素 1 つで線 10 万本) を、要素ごと・セルごとに作り続けない
   */
  budget?: { chars?: number };
}

/** 中を変えない要素 (定義・文字・画像など) */
const OPAQUE = new Set(['defs', 'svg', 'text', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'symbol', 'foreignObject', 'style', 'title', 'desc']);
/** 置き換える要素 */
const DRAWN = new Set(['path', 'rect', 'ellipse', 'circle', 'line', 'polygon', 'polyline']);
/** 置き換えた要素へ写さない属性 (形と、塗り・線の決め方) */
const GEOMETRY = new Set(['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2', 'pathLength']);
const PAINT = new Set(['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linejoin', 'stroke-linecap', 'stroke-miterlimit', 'fill-rule']);

/** セルの図形の SVG を、手書き風にする */
export function sketchSvg(svg: string, cell: SketchCell): string {
  const kind = sketchKind(cell.style);
  if (!kind) return svg;
  const seed = sketchSeed(cell.id);
  const random = seededRandom(seed);
  let skip = 0;
  let count = 0;
  return replaceTags(svg, (tag, close, name, rest, self) => {
    if (OPAQUE.has(name)) {
      if (close) skip = Math.max(0, skip - 1);
      else if (!self) skip++;
      return tag;
    }
    // 中身のある要素 (開きと閉じのタグ。道具も図形ライブラリも書かない) はそのまま
    if (skip || close || !self || !DRAWN.has(name) || count >= MAX_ELEMENTS) return tag;
    if (cell.budget?.chars !== undefined && cell.budget.chars < 0) return tag;
    count++;
    const attrs = parseAttrs(rest);
    try {
      const r = (kind === 'rough' ? roughElement(name, attrs, cell, seed) : comicElement(name, attrs, cell, random)) ?? tag;
      if (cell.budget?.chars !== undefined) cell.budget.chars -= r.length;
      return r;
    } catch {
      return tag;
    }
  });
}

/**
 * SVG の文字の中のタグを、fn の返す文字に置き換える。正規表現
 * /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g の replace と同じ結果 (同じタグを、同じ組で fn に渡す)。
 * 正規表現のままだと、閉じない '<a' のたびに、引用符の外の '>' か、閉じない引用符まで読んで失敗するので、長さの 2 乗の手間になった
 * (入れ子の svg の画像に '<a ' を 2 万個と、閉じない ' を 1 つ置いた 6 万字で 2.1 秒)。
 * 位置ごとに「そこから引用符の外で読み進めたとき、最初に出会う '>' の位置 (閉じない引用符か終わりに出会ったら -1)」を、
 * 後ろから 1 度だけ求めておく (引用符の中は、同じ種類の次の引用符まで飛ぶ)。タグは、名前の後ろからその '>' まで。
 * 名前の字は引用符でも '>' でもないので、名前の長さによらずに同じ '>' に着く。'>' の前が引用符の外の '/' なら、空の要素の '/'
 */
export function replaceTags(svg: string, fn: (tag: string, close: string, name: string, rest: string, self: string) => string): string {
  const n = svg.length;
  const gt = new Int32Array(n + 1);
  gt[n] = -1;
  let dq = -1;
  let sq = -1;
  for (let i = n - 1; i >= 0; i--) {
    const c = svg.charCodeAt(i);
    if (c === 0x3e) gt[i] = i;
    else if (c === 0x22) gt[i] = dq < 0 ? -1 : gt[dq + 1];
    else if (c === 0x27) gt[i] = sq < 0 ? -1 : gt[sq + 1];
    else gt[i] = gt[i + 1];
    if (c === 0x22) dq = i;
    else if (c === 0x27) sq = i;
  }
  const head = /<(\/?)([A-Za-z][\w:.-]*)/y;
  const out: string[] = [];
  let done = 0;
  for (let lt = svg.indexOf('<'); lt >= 0; lt = svg.indexOf('<', lt + 1)) {
    head.lastIndex = lt;
    const h = head.exec(svg);
    if (!h) continue;
    const from = lt + h[0].length;
    const end = gt[from];
    if (end < 0) continue;
    const self = end > from && svg.charCodeAt(end - 1) === 0x2f ? '/' : '';
    out.push(svg.slice(done, lt), fn(svg.slice(lt, end + 1), h[1], h[2], svg.slice(from, end - self.length), self));
    done = end + 1;
    lt = end;
  }
  out.push(svg.slice(done));
  return out.join('');
}

type Attrs = Map<string, string>;

function parseAttrs(s: string): Attrs {
  const m = new Map<string, string>();
  for (const a of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) m.set(a[1], a[2] ?? a[3] ?? '');
  return m;
}

/** 置き換えた要素へ写す属性 (transform・opacity・style・clip-path など) */
function passThrough(a: Attrs): string {
  let s = '';
  for (const [k, v] of a) if (!GEOMETRY.has(k) && !PAINT.has(k) && k !== 'id') s += ` ${k}="${v}"`;
  return s;
}

const num = (v: string | undefined, d: number) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/** 要素の形を経路 (d) にする。rect の角の丸めは RoughCanvas.roundrect と同じく 2 次の曲線 */
function elementPath(name: string, a: Attrs): string | undefined {
  const n = (k: string) => num(a.get(k), 0);
  switch (name) {
    case 'path':
      return a.get('d');
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      if (!(w > 0 && h > 0)) return undefined;
      let rx = a.has('rx') ? n('rx') : a.has('ry') ? n('ry') : 0;
      let ry = a.has('ry') ? n('ry') : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry) return `M${f(x)} ${f(y)}L${f(x + w)} ${f(y)}L${f(x + w)} ${f(y + h)}L${f(x)} ${f(y + h)}Z`;
      return (
        `M${f(x + rx)} ${f(y)}L${f(x + w - rx)} ${f(y)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + ry)}L${f(x + w)} ${f(y + h - ry)}` +
        `Q${f(x + w)} ${f(y + h)} ${f(x + w - rx)} ${f(y + h)}L${f(x + rx)} ${f(y + h)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - ry)}L${f(x)} ${f(y + ry)}Q${f(x)} ${f(y)} ${f(x + rx)} ${f(y)}`
      );
    }
    case 'line':
      return `M${f(n('x1'))} ${f(n('y1'))}L${f(n('x2'))} ${f(n('y2'))}`;
    case 'polygon':
    case 'polyline': {
      const p = (a.get('points') ?? '').trim().split(/[\s,]+/).map(Number);
      if (p.length < 4 || p.some((v) => !Number.isFinite(v))) return undefined;
      let d = `M${f(p[0])} ${f(p[1])}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${f(p[i])} ${f(p[i + 1])}`;
      return name === 'polygon' ? d + 'Z' : d;
    }
    default:
      return undefined;
  }
}

/** 白 (#fff・#ffffff・white・rgb(255,255,255)) か (fillStyle=auto で、白の塗りは斜線にしない) */
const isWhite = (c: string) => /^(?:#fff(?:f{3})?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*1\s*)?\))$/i.test(c.trim());

/** RoughCanvas.getStyle と limitFill: rough.js の設定 */
function roughOptions(cell: SketchCell, seed: number, sw: number, stroke: string | undefined, fill: string | undefined, size = cell.size): Record<string, unknown> {
  const s = cell.style;
  const v = (k: string, d: number) => num(s[k], d);
  // rough.js の既定 (getDefaultOptions): bowing 1・hachureAngle -41・curveFitting 0.95・roughness 1・simplification 0
  const o: Record<string, unknown> = {
    strokeWidth: sw,
    seed,
    preserveVertices: true,
    stroke: stroke ?? 'none',
    bowing: v('bowing', 1),
    hachureAngle: v('hachureAngle', -41),
    curveFitting: v('curveFitting', 0.95),
    roughness: v('jiggle', 1),
    simplification: v('simplification', 0),
    disableMultiStroke: s.disableMultiStroke === '1' || s.disableMultiStroke === 'true',
    disableMultiStrokeFill: s.disableMultiStrokeFill === '1' || s.disableMultiStrokeFill === 'true',
  };
  const hachureGap = s.hachureGap === undefined || s.hachureGap === 'auto' ? -1 : v('hachureGap', -1);
  o.hachureGap = hachureGap;
  o.dashGap = v('dashGap', hachureGap);
  o.dashOffset = v('dashOffset', hachureGap);
  o.zigzagOffset = v('zigzagOffset', hachureGap);
  o.fillWeight = s.fillWeight === undefined || s.fillWeight === 'auto' ? -1 : v('fillWeight', -1);
  // 塗りの形 (dots は draw.io が重いので auto にする。auto は、白・グラデーションなら塗りつぶし、ほかは rough.js の既定 hachure)
  let fillStyle = s.fillStyle ?? 'auto';
  if (fillStyle === 'dots') fillStyle = 'auto';
  if (fillStyle === 'auto') fillStyle = fill !== undefined && (fill.startsWith('url(') || isWhite(fill)) ? 'solid' : 'hachure';
  o.fillStyle = fillStyle;
  if (fill !== undefined) {
    o.fill = fill;
    limitFill(o, size, sw);
  }
  return o;
}

/** RoughCanvas.limitFill: 大きな形は塗りつぶしにし、斜線・破線・ジグザグの数を MAX_FILL_COUNT までにする */
function limitFill(o: Record<string, unknown>, size: number, sw: number) {
  const fillStyle = o.fillStyle as string;
  if (fillStyle === 'solid' || !(size > 0)) return;
  if (size > MAX_FILL_SIZE) {
    o.fillStyle = 'solid';
    return;
  }
  // 形の幅と高さ (ここでは幅 + 高さだけが分かるので、正方形として見積もる)
  const w = size / 2;
  const h = size / 2;
  let gap = o.hachureGap as number;
  gap = gap < 0 ? 4 * sw : gap;
  let g = Math.max(gap, 0.1);
  const minGap = ((fillStyle === 'cross-hatch' ? 2 : 1) * (w + h)) / MAX_FILL_COUNT;
  if (g < minGap) {
    g = minGap;
    o.hachureGap = g;
  }
  if (fillStyle === 'dashed') {
    let offset = o.dashOffset as number;
    let dashGap = o.dashGap as number;
    offset = offset < 0 ? gap : offset;
    dashGap = dashGap < 0 ? gap : dashGap;
    const dash = (w * h) / (g * MAX_FILL_COUNT);
    if (offset + dashGap < dash) {
      const k = offset + dashGap > 0 ? dash / (offset + dashGap) : 0;
      o.dashOffset = k > 0 ? offset * k : dash / 2;
      o.dashGap = k > 0 ? dashGap * k : dash / 2;
    }
  } else if (fillStyle === 'zigzag-line') {
    let zigzag = o.zigzagOffset as number;
    zigzag = zigzag < 0 ? gap : zigzag;
    const minZigzag = (Math.sqrt(g * g + (8 * w * h) / MAX_FILL_COUNT) - g) / 2;
    if (zigzag < minZigzag) o.zigzagOffset = minZigzag;
  }
}

interface Op {
  op: string;
  data: number[];
}

/** rough.js の命令の並びを経路 (d) にする (Editor.createRoughCanvas の _drawToContext と同じ: move・bcurveTo・lineTo) */
function opsPath(ops: Op[]): string {
  let d = '';
  for (const { op, data: p } of ops) {
    if (op === 'move') d += `M${f(p[0])} ${f(p[1])}`;
    else if (op === 'bcurveTo') d += `C${f(p[0])} ${f(p[1])} ${f(p[2])} ${f(p[3])} ${f(p[4])} ${f(p[5])}`;
    else if (op === 'lineTo') d += `L${f(p[0])} ${f(p[1])}`;
  }
  return d;
}

/** 1 つの要素を rough.js の線と塗りにする */
function roughElement(name: string, a: Attrs, cell: SketchCell, seed: number): string | undefined {
  const fillRaw = a.get('fill');
  const strokeRaw = a.get('stroke');
  // 塗りの属性が無ければ SVG の既定の黒 (道具・図形ライブラリは書くので、無いのはまれ)
  const fill = fillRaw === undefined ? '#000000' : fillRaw === 'none' || fillRaw === '' || fillRaw === 'transparent' ? undefined : fillRaw;
  const stroke = strokeRaw === undefined || strokeRaw === 'none' || strokeRaw === '' ? undefined : strokeRaw;
  if (!fill && !stroke) return '';
  const sw = Math.max(0, num(a.get('stroke-width'), 1));
  const n = (k: string) => num(a.get(k), 0);
  // 斜線の本数の見積もり (limitFill) には、セルの枠の大きさ (cell.size) と、この要素そのものの大きさの大きい方を使う。形は style の値で
  // 枠の外まで描くことがある (rackCabinet の unitNum × unitHeight、ボタンの列の textSize、線の endSize) ので、枠の大きさだけで見積もると、
  // 300 バイトに満たない図で、rough.js が 2 億本を超える斜線を作り、メモリが尽きていた。
  // 要素の大きさが座標の上限 (SKETCH_MAX_SIZE) を超える (か、数でない) ものは、手書き風にせず、そのまま描く (rough.js の楕円の点の数も大きさで増える)
  const ext = elementExtent(name, a);
  if (!(ext <= SKETCH_MAX_SIZE)) return undefined;
  const o = roughOptions(cell, seed, sw, stroke, fill, Math.max(cell.size, ext));
  generator ??= rough.generator();
  let drawable;
  if (name === 'ellipse' || name === 'circle') {
    const rx = name === 'circle' ? n('r') : n('rx');
    const ry = name === 'circle' ? n('r') : a.has('ry') ? n('ry') : rx;
    if (!(rx > 0 && ry > 0)) return undefined;
    drawable = generator.ellipse(n('cx'), n('cy'), 2 * rx, 2 * ry, o);
  } else if (name === 'rect' && !(n('rx') > 0 || n('ry') > 0)) {
    if (!(n('width') > 0 && n('height') > 0)) return undefined;
    drawable = generator.rectangle(n('x'), n('y'), n('width'), n('height'), o);
  } else {
    const d = elementPath(name, a);
    if (!d) return undefined;
    drawable = generator.path(d, o);
  }
  const pass = passThrough(a);
  const fo = a.get('fill-opacity');
  const so = a.get('stroke-opacity');
  const dash = a.get('stroke-dasharray');
  const rule = a.get('fill-rule');
  let out = '';
  for (const set of drawable.sets) {
    const d = opsPath(set.ops as Op[]);
    if (!d) continue;
    if (set.type === 'path') {
      // 線 (線の色が無ければ描かない)。draw.io の RoughCanvas は線の端とつなぎを丸める
      if (!stroke) continue;
      out += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${f(sw)}"${so ? ` stroke-opacity="${so}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"${pass}/>`;
    } else if (set.type === 'fillPath') {
      out += `<path d="${d}" fill="${fill}"${fo ? ` fill-opacity="${fo}"` : ''}${rule ? ` fill-rule="${rule}"` : ''} stroke="none"${pass}/>`;
    } else if (set.type === 'fillSketch') {
      // 斜線の塗り (fillSketch): 塗りの色の線で引く。太さは fillWeight (負なら線の太さの半分)、不透明度は塗りの不透明度、破線にしない
      const fw = (o.fillWeight as number) < 0 ? sw / 2 : (o.fillWeight as number);
      out += `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${f(fw)}"${fo ? ` stroke-opacity="${fo}"` : ''} stroke-linejoin="round" stroke-linecap="round"${pass}/>`;
    }
  }
  return out;
}

/** 種から作る乱数 (0 以上 1 未満。mulberry32) */
function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * comic (HandJiggle): 経路のまっすぐの線 (L・H・V と、閉じる Z の線) を、長さ / 10 (5 以上。5 未満なら 5 にして揺れを 1/3) に区切り、
 * 区切りごとに、線と直角の向きへ (乱数 - 0.5) × jiggle だけずらす。長さ 2 未満の線と、曲線はそのまま。
 * 塗り・線の色は元の要素のまま (つなぎと端は丸める)
 */
function comicElement(name: string, a: Attrs, cell: SketchCell, random: () => number): string | undefined {
  if (name === 'ellipse' || name === 'circle') return undefined;
  const d = elementPath(name, a);
  if (!d) return undefined;
  const variation0 = num(cell.style.jiggle, DEFAULT_JIGGLE);
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let out = '';
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const nums = (k: number) => {
    const r: number[] = [];
    for (let j = 0; j < k; j++) r.push(parseFloat(tokens[i++]));
    return r;
  };
  const jiggleTo = (ex: number, ey: number) => {
    const dx = Math.abs(ex - x);
    const dy = Math.abs(ey - y);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) {
      out += `L${f(ex)} ${f(ey)}`;
    } else {
      let segs = Math.min(Math.round(dist / 10), MAX_SEGMENTS);
      let variation = variation0;
      if (segs < 5) {
        segs = 5;
        variation /= 3;
      }
      const stepX = (Math.sign(ex - x) * dx) / segs;
      const stepY = (Math.sign(ey - y) * dy) / segs;
      const fx = dx / dist;
      const fy = dy / dist;
      for (let s = 0; s < segs; s++) {
        const px = stepX * s + x;
        const py = stepY * s + y;
        const offset = (random() - 0.5) * variation;
        out += `L${f(px - offset * fy)} ${f(py - offset * fx)}`;
      }
      out += `L${f(ex)} ${f(ey)}`;
    }
    x = ex;
    y = ey;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) return undefined;
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const [px, py] = nums(2);
        x = px + (rel ? x : 0);
        y = py + (rel ? y : 0);
        sx = x;
        sy = y;
        out += `M${f(x)} ${f(y)}`;
        // M の後の数の組は L
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const [px, py] = nums(2);
        jiggleTo(px + (rel ? x : 0), py + (rel ? y : 0));
        break;
      }
      case 'H': {
        const [px] = nums(1);
        jiggleTo(px + (rel ? x : 0), y);
        break;
      }
      case 'V': {
        const [py] = nums(1);
        jiggleTo(x, py + (rel ? y : 0));
        break;
      }
      case 'C': {
        const p = nums(6);
        const o = rel ? [x, y, x, y, x, y] : [0, 0, 0, 0, 0, 0];
        const q = p.map((v, k) => v + o[k]);
        out += `C${q.map(f).join(' ')}`;
        [x, y] = [q[4], q[5]];
        break;
      }
      case 'Q': {
        const p = nums(4);
        const o = rel ? [x, y, x, y] : [0, 0, 0, 0];
        const q = p.map((v, k) => v + o[k]);
        out += `Q${q.map(f).join(' ')}`;
        [x, y] = [q[2], q[3]];
        break;
      }
      case 'A': {
        const p = nums(7);
        const ex = p[5] + (rel ? x : 0);
        const ey = p[6] + (rel ? y : 0);
        out += `A${f(p[0])} ${f(p[1])} ${f(p[2])} ${p[3] ? 1 : 0} ${p[4] ? 1 : 0} ${f(ex)} ${f(ey)}`;
        [x, y] = [ex, ey];
        break;
      }
      case 'Z':
        // HandJiggle.close: 始めの点へ揺らした線を引いてから閉じる
        jiggleTo(sx, sy);
        out += 'Z';
        x = sx;
        y = sy;
        break;
      default:
        // S・T などは道具も図形ライブラリも書かない。読めない経路はそのまま
        return undefined;
    }
    if (tokens.slice(i).length && Number.isNaN(parseFloat(tokens[i])) && !/[A-Za-z]/.test(tokens[i])) return undefined;
  }
  const paint = [...a].filter(([k]) => PAINT.has(k) && k !== 'stroke-linejoin' && k !== 'stroke-linecap').map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<path d="${out}"${paint} stroke-linejoin="round" stroke-linecap="round"${passThrough(a)}/>`;
}

/**
 * 要素の大きさ (外接の矩形の幅 + 高さ。limitFill の size と同じ測り方)。円・楕円・矩形は属性から、ほかは経路 (elementPath) の点から求める。
 * 経路は、端点と制御点の外接で見積もる (曲線の外接より大きくはならない。円弧は半径の分を足す)。読めなければ 0
 */
function elementExtent(name: string, a: Attrs): number {
  const n = (k: string) => num(a.get(k), 0);
  if (name === 'circle') return 4 * Math.abs(n('r'));
  if (name === 'ellipse') return 2 * Math.abs(n('rx')) + 2 * Math.abs(a.has('ry') ? n('ry') : n('rx'));
  if (name === 'rect') return Math.abs(n('width')) + Math.abs(n('height'));
  const d = elementPath(name, a);
  return d ? pathExtent(d) : 0;
}

/** 経路の点 (端点と制御点) の外接の幅 + 高さ (SVG 2 §9.3 の経路の書き方。円弧は終点と半径で見積もる) */
export function pathExtent(d: string): number {
  const NARGS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let cx = 0, cy = 0, sx = 0, sy = 0, extra = 0;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  let cmd = '';
  let args: number[] = [];
  const run = () => {
    const c = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const k = NARGS[c];
    if (k === undefined) return;
    if (c === 'z') {
      cx = sx;
      cy = sy;
      return;
    }
    for (let i = 0; i + k <= args.length; i += k) {
      const p = args.slice(i, i + k);
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      if (c === 'h') cx = ox + p[0];
      else if (c === 'v') cy = oy + p[0];
      else if (c === 'a') {
        extra = Math.max(extra, 2 * (Math.abs(p[0]) + Math.abs(p[1])));
        cx = ox + p[5];
        cy = oy + p[6];
      } else {
        for (let j = 0; j + 2 < k; j += 2) add(ox + p[j], oy + p[j + 1]);
        cx = ox + p[k - 2];
        cy = oy + p[k - 1];
      }
      add(cx, cy);
      if (c === 'm' && i === 0) {
        sx = cx;
        sy = cy;
      }
    }
  };
  for (const m of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
    if (m[1]) {
      if (cmd) run();
      cmd = m[1];
      args = [];
    } else args.push(Number(m[2]));
  }
  if (cmd) run();
  if (!(x1 >= x0)) return extra;
  return x1 - x0 + (y1 - y0) + extra;
}
