/**
 * CSS のグラデーション (CSS Images 3 §3: linear-gradient・radial-gradient と repeating- の付いたもの) を、
 * 箱の大きさが決まったところで SVG のグラデーションの画像にする。背景の画像として描く (paint.ts の背景画像と同じ経路)。
 *
 * - linear-gradient: 角度 (deg・rad・grad・turn) か to <辺・角>。グラデーションの線の長さは |W sin θ| + |H cos θ| (§3.1.1)。
 *   to <角> は、隣り合う 2 つの角を結ぶ線に垂直な向き (§3.1.1)
 * - radial-gradient: circle・ellipse、大きさ (closest-side・farthest-side・closest-corner・farthest-corner・長さ)、at <位置> (§3.2)
 * - 色の止まり (§3.4): 位置の無い最初と最後は 0%・100%、前の位置より小さい位置は前の位置にし、位置の無い止まりは前後の間を等分する。
 *   色の変わり目の指定 (transition hint) は読み飛ばす (前後の色を線形に補間する)
 */
import { parseColor, splitTop, UNIT_PT } from './cssText';

/** グラデーションの関数か */
export function isCssGradient(v: string): boolean {
  return /^\s*(repeating-)?(linear|radial)-gradient\(/i.test(v);
}

/** 最初のグラデーションの関数の文字列 (background-image の最初の層)。無ければ undefined */
export function firstGradient(v: string): string | undefined {
  const m = /(repeating-)?(linear|radial)-gradient\(/i.exec(v);
  if (!m) return undefined;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < v.length; i++) {
    if (v[i] === '(') depth++;
    else if (v[i] === ')' && --depth === 0) return v.slice(m.index, i + 1);
  }
  return undefined;
}

/** 長さ (pt) か百分率 (基準の長さ ref に対して)。em・rem は fontSize (pt) を基準にする */
function lenPct(v: string, ref: number, fontSize: number): number | undefined {
  const m = /^(-?[\d.]+)(%|px|pt|mm|cm|in|pc|q|em|rem)?$/i.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = (m[2] ?? '').toLowerCase();
  if (u === '%') return (n / 100) * ref;
  if (u === 'em' || u === 'rem') return n * fontSize;
  if (u === '') return n === 0 ? 0 : undefined;
  return n * UNIT_PT[u];
}

function angleDeg(v: string): number | undefined {
  const m = /^(-?[\d.]+)(deg|rad|grad|turn)$/i.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  return u === 'deg' ? n : u === 'rad' ? (n * 180) / Math.PI : u === 'grad' ? n * 0.9 : n * 360;
}

interface Stop {
  color: [number, number, number, number];
  pos?: number;
}

/** 色の止まりの並び。位置は線の長さ (pt) に対する値 */
function parseStops(items: string[], len: number, fontSize: number): Stop[] | undefined {
  const stops: Stop[] = [];
  for (const it of items) {
    const parts = splitTop(it, ' ');
    if (parts.length === 1 && lenPct(parts[0], len, fontSize) !== undefined) continue; // 色の変わり目の指定は読み飛ばす
    // currentcolor は読まない (color-mix() の中のものも。止まりの色に、要素の color を渡していない)
    const c = /currentcolor/i.test(parts[0]) ? undefined : parseColor(parts[0]);
    if (!c || c === 'current') return undefined;
    const ps = parts.slice(1).map((p) => lenPct(p, len, fontSize));
    if (ps.some((p) => p === undefined)) return undefined;
    if (ps.length === 0) stops.push({ color: c });
    // 位置を 2 つ書いた止まりは、同じ色の 2 つの止まり
    for (const p of ps) stops.push({ color: c, pos: p });
  }
  if (!stops.length) return undefined;
  // 止まりが 1 つだけなら、その色の一色 (Images 4 §3.5.1 の <color-stop-list> は止まり 1 つを許す。Images 3 §3.4.1 では 2 つ以上)。
  // 同じ色の止まりを足してから、下の位置の補正を通す (位置の無いままにしない)
  if (stops.length === 1) stops.push({ color: stops[0].color });
  // §3.4.3 の補正
  if (stops[0].pos === undefined) stops[0].pos = 0;
  if (stops[stops.length - 1].pos === undefined) stops[stops.length - 1].pos = len;
  let maxSoFar = stops[0].pos!;
  for (const s of stops) {
    if (s.pos !== undefined) {
      s.pos = Math.max(s.pos, maxSoFar);
      maxSoFar = s.pos;
    }
  }
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].pos !== undefined) continue;
    let j = i;
    while (stops[j].pos === undefined) j++;
    const a = stops[i - 1].pos!;
    const b = stops[j].pos!;
    for (let k = i; k < j; k++) stops[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return premultiplied(stops);
}

/**
 * CSS は色を乗算済みの値で補間する (§3.4.4) が、SVG の stop は乗算しない値で補間する。
 * 不透明度の違う止まりの間に止まりを足して、乗算済みの補間に近づける (透明は隣の色の色味になる)
 */
function premultiplied(stops: Stop[]): Stop[] {
  if (stops.every((s) => s.color[3] === stops[0].color[3])) return stops;
  const out: Stop[] = [];
  const push = (st: Stop) => {
    const last = out[out.length - 1];
    if (last && last.pos === st.pos && last.color.every((v, k) => Math.abs(v - st.color[k]) < 1e-6)) return;
    out.push(st);
  };
  for (let i = 0; i + 1 < stops.length; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    const [a0, a1] = [s0.color[3], s1.color[3]];
    const steps = a0 === a1 ? 1 : 8;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = a0 + (a1 - a0) * t;
      const rgb = [0, 1, 2].map((j) => {
        if (a > 1e-9) return (s0.color[j] * a0 + (s1.color[j] * a1 - s0.color[j] * a0) * t) / a;
        return a0 > 1e-9 ? s0.color[j] : a1 > 1e-9 ? s1.color[j] : s0.color[j] + (s1.color[j] - s0.color[j]) * t;
      });
      push({ color: [rgb[0], rgb[1], rgb[2], a], pos: s0.pos! + (s1.pos! - s0.pos!) * t });
    }
  }
  return out;
}

const n = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
const hex = (c: number[]) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** repeating-: 止まりの並び (1 周期) を、位置の範囲 [a, b] を覆うまで繰り返して並べる (§3.5) */
function repeatStops(stops: Stop[], a: number, b: number): Stop[] {
  const first = stops[0].pos!;
  const period = stops[stops.length - 1].pos! - first;
  const out: Stop[] = [];
  const k0 = Math.floor((a - first) / period);
  const k1 = Math.ceil((b - first) / period);
  for (let k = k0; k <= k1 && out.length < 4000; k++) for (const s of stops) out.push({ color: s.color, pos: s.pos! + k * period });
  return clipStops(out, a, b);
}

/** 止まりの並びを位置の範囲 [a, b] で切る (端の色は前後の止まりから補間する) */
function clipStops(stops: Stop[], a: number, b: number): Stop[] {
  const colorAt = (p: number): Stop['color'] => {
    for (let i = 0; i + 1 < stops.length; i++) {
      const s0 = stops[i];
      const s1 = stops[i + 1];
      if (p >= s0.pos! && p <= s1.pos!) {
        const t = s1.pos! - s0.pos! > 1e-9 ? (p - s0.pos!) / (s1.pos! - s0.pos!) : 1;
        return s0.color.map((v, k) => v + (s1.color[k] - v) * t) as Stop['color'];
      }
    }
    return (p < stops[0].pos! ? stops[0] : stops[stops.length - 1]).color;
  };
  return [{ color: colorAt(a), pos: a }, ...stops.filter((s) => s.pos! > a && s.pos! < b), { color: colorAt(b), pos: b }];
}

/** 止まりを、0〜1 の offset の SVG の stop にする (位置の範囲 [p0, p1] を 0〜1 に写す) */
function svgStops(stops: Stop[], p0: number, p1: number): string {
  const span = p1 - p0 || 1;
  return stops
    .map((s) => `<stop offset="${n(Math.min(1, Math.max(0, (s.pos! - p0) / span)))}" stop-color="${hex(s.color)}"${s.color[3] < 1 ? ` stop-opacity="${n(s.color[3])}"` : ''}/>`)
    .join('');
}

/** 位置のキーワード・長さの 1〜2 個 (at の後ろ) → [x, y] (pt) */
function position(tokens: string[], W: number, H: number, fontSize: number): [number, number] | undefined {
  let x: number | undefined;
  let y: number | undefined;
  const kw: Record<string, ['x' | 'y' | 'c', number]> = { left: ['x', 0], right: ['x', 1], top: ['y', 0], bottom: ['y', 1], center: ['c', 0.5] };
  const rest: string[] = [];
  for (const t of tokens) {
    const k = kw[t.toLowerCase()];
    if (k?.[0] === 'x') x = k[1] * W;
    else if (k?.[0] === 'y') y = k[1] * H;
    else rest.push(t);
  }
  for (const t of rest) {
    const lc = t.toLowerCase();
    if (lc === 'center') {
      if (x === undefined) x = W / 2;
      else if (y === undefined) y = H / 2;
      continue;
    }
    if (x === undefined) x = lenPct(t, W, fontSize);
    else if (y === undefined) y = lenPct(t, H, fontSize);
  }
  if (x === undefined) x = W / 2;
  if (y === undefined) y = H / 2;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

/**
 * グラデーションを、幅 W・高さ H (pt) の SVG の文字列にする。読めない書き方なら undefined
 * fontSize: em の基準
 */
export function gradientSvg(text: string, W: number, H: number, fontSize = 12): string | undefined {
  const m = /^\s*(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)\s*$/i.exec(text);
  if (!m || W <= 0 || H <= 0) return undefined;
  const repeating = !!m[1];
  const args = splitTop(m[3], ',');
  if (!args.length) return undefined;
  const head = args[0].trim().toLowerCase();
  let body: string;
  if (m[2].toLowerCase() === 'linear') {
    // 向き: 角度 (0deg は上、時計回り) か to <辺・角>。初期値は to bottom (180deg)
    let dx = 0;
    let dy = 1;
    let stopItems = args;
    const ang = angleDeg(head);
    if (ang !== undefined) {
      const r = (ang * Math.PI) / 180;
      dx = Math.sin(r);
      dy = -Math.cos(r);
      stopItems = args.slice(1);
    } else if (head.startsWith('to ')) {
      const ws = head.slice(3).trim().split(/\s+/);
      // to の後ろは、横と縦の辺のキーワードを 1 つずつまで (それ以外は読めない)
      const hz = ws.filter((w) => w === 'left' || w === 'right').length;
      const vt = ws.filter((w) => w === 'top' || w === 'bottom').length;
      if (ws.length > 2 || hz > 1 || vt > 1 || hz + vt !== ws.length) return undefined;
      const sx = ws.includes('left') ? -1 : ws.includes('right') ? 1 : 0;
      const sy = ws.includes('top') ? -1 : ws.includes('bottom') ? 1 : 0;
      if (sx && sy) {
        // 角へ: 隣り合う 2 つの角を結ぶ線に垂直な向き
        dx = sx * H;
        dy = sy * W;
      } else {
        dx = sx;
        dy = sy;
      }
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      stopItems = args.slice(1);
    }
    const len = Math.abs(W * dx) + Math.abs(H * dy);
    const stops = parseStops(stopItems, len, fontSize);
    if (!stops) return undefined;
    if (repeating && stops[stops.length - 1].pos! - stops[0].pos! <= 1e-6) {
      // 繰り返しの長さが 0: 色の平均で塗る (§3.5)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}" height="${n(H)}" viewBox="0 0 ${n(W)} ${n(H)}"><rect width="${n(W)}" height="${n(H)}" fill="${hex(stops[stops.length - 1].color)}"/></svg>`;
    }
    const all = repeating ? repeatStops(stops, 0, len) : stops;
    const p0 = repeating ? 0 : Math.min(0, stops[0].pos!);
    const p1 = repeating ? len : Math.max(len, stops[stops.length - 1].pos!);
    // 線の始まり: 箱の中央から、線の向きに逆へ長さの半分
    const sx0 = W / 2 - (dx * len) / 2;
    const sy0 = H / 2 - (dy * len) / 2;
    const at = (p: number) => [sx0 + dx * p, sy0 + dy * p];
    const [x1, y1] = at(p0);
    const [x2, y2] = at(p1);
    body =
      `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">` +
      svgStops(all, p0, p1) +
      `</linearGradient>`;
  } else {
    // radial-gradient([<形> || <大きさ>] [at <位置>]?, <止まり>…)
    let shape: 'circle' | 'ellipse' | undefined;
    let sizeKw = 'farthest-corner';
    let sizeLen: string[] = [];
    let pos: [number, number] = [W / 2, H / 2];
    let stopItems = args;
    const toks = splitTop(args[0], ' ');
    const looksPrelude = toks.some((t) => /^(circle|ellipse|closest-side|farthest-side|closest-corner|farthest-corner|at)$/i.test(t)) || (toks.length <= 2 && toks.every((t) => lenPct(t, 1, fontSize) !== undefined) && args.length > 2);
    if (looksPrelude) {
      stopItems = args.slice(1);
      const atIdx = toks.findIndex((t) => t.toLowerCase() === 'at');
      const pre = atIdx >= 0 ? toks.slice(0, atIdx) : toks;
      if (atIdx >= 0) {
        const p = position(toks.slice(atIdx + 1), W, H, fontSize);
        if (!p) return undefined;
        pos = p;
      }
      for (const t of pre) {
        const lc = t.toLowerCase();
        if (lc === 'circle' || lc === 'ellipse') shape = lc;
        else if (/^(closest|farthest)-(side|corner)$/.test(lc)) sizeKw = lc;
        else sizeLen.push(t);
      }
    }
    if (!shape) shape = sizeLen.length === 1 ? 'circle' : 'ellipse';
    const [cx, cy] = pos;
    const sides = [cx, W - cx, cy, H - cy].map(Math.abs);
    const corners = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ].map(([x, y]) => [Math.abs(x - cx), Math.abs(y - cy)]);
    let rx: number;
    let ry: number;
    if (sizeLen.length) {
      rx = lenPct(sizeLen[0], W, fontSize) ?? 0;
      ry = shape === 'circle' ? rx : (lenPct(sizeLen[1] ?? sizeLen[0], H, fontSize) ?? 0);
    } else if (shape === 'circle') {
      const dist = corners.map(([a, b]) => Math.hypot(a, b));
      rx = ry =
        sizeKw === 'closest-side'
          ? Math.min(...sides)
          : sizeKw === 'farthest-side'
            ? Math.max(...sides)
            : sizeKw === 'closest-corner'
              ? Math.min(...dist)
              : Math.max(...dist);
    } else {
      const hs = [Math.min(sides[0], sides[1]), Math.max(sides[0], sides[1])];
      const vs = [Math.min(sides[2], sides[3]), Math.max(sides[2], sides[3])];
      if (sizeKw === 'closest-side' || sizeKw === 'farthest-side') {
        const k = sizeKw === 'closest-side' ? 0 : 1;
        rx = hs[k];
        ry = vs[k];
      } else {
        // 角を通る楕円 (縦横の比は closest-side・farthest-side のときと同じ。§3.2.2)
        const k = sizeKw === 'closest-corner' ? 0 : 1;
        const pick = corners.reduce((best, c) => (k === 0 ? Math.hypot(c[0], c[1]) < Math.hypot(best[0], best[1]) : Math.hypot(c[0], c[1]) > Math.hypot(best[0], best[1])) ? c : best);
        const ratio = (vs[k] || 1) / (hs[k] || 1);
        rx = Math.hypot(pick[0], pick[1] / ratio);
        ry = rx * ratio;
      }
    }
    if (rx <= 0 || ry <= 0) return undefined;
    const stops = parseStops(stopItems, rx, fontSize);
    if (!stops) return undefined;
    // 中心から一番遠い角までの距離 (楕円を円に直した空間で)。repeating- はそこまで止まりを並べる
    const reach = Math.max(...corners.map(([a, b]) => Math.hypot(a, (b * rx) / ry)));
    if (repeating && stops[stops.length - 1].pos! - stops[0].pos! <= 1e-6) return undefined;
    const all = repeating ? repeatStops(stops, 0, reach) : stops;
    const p0 = 0;
    const p1 = repeating ? reach : Math.max(rx, stops[stops.length - 1].pos!);
    if (p1 <= 1e-6) return undefined;
    // 半径 p1 の円を、縦に ry / rx 倍した楕円
    const tr = Math.abs(ry - rx) > 1e-6 ? ` gradientTransform="translate(${n(cx)} ${n(cy)}) scale(1 ${n(ry / rx)}) translate(${n(-cx)} ${n(-cy)})"` : '';
    body =
      `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(p1)}"${tr}>` +
      svgStops(all, p0, p1) +
      `</radialGradient>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}pt" height="${n(H)}pt" viewBox="0 0 ${n(W)} ${n(H)}"><defs>${body}</defs><rect width="${n(W)}" height="${n(H)}" fill="url(#g)"/></svg>`;
}

/** gradientSvg が作った SVG の中身 (Canvas に、ブラウザの画像の読み込みを待たずに描くための形。位置は SVG の座標 = pt) */
export type GradientPaint =
  | { kind: 'solid'; width: number; height: number; color: string }
  | { kind: 'linear'; width: number; height: number; coords: [number, number, number, number]; stops: Array<{ offset: number; color: string; opacity: number }> }
  /** radial: 中心 (cx, cy)・半径 r の円を、中心のまわりに縦へ scaleY 倍した楕円 */
  | { kind: 'radial'; width: number; height: number; cx: number; cy: number; r: number; scaleY: number; stops: Array<{ offset: number; color: string; opacity: number }> };

/**
 * gradientSvg が作った SVG を読み戻す (この関数が読むのは、gradientSvg の出す決まった形だけ。ふつうの SVG は読まない。読めなければ undefined)。
 * Canvas の描画 (canvasRenderer.ts) が、PDF に描くのと同じ線・同じ止まりで描くために使う:
 * グラデーションの画像は組版の中で作る (同期) ので、ブラウザの画像 (読み込みが非同期) にできない
 */
export function readGradientSvg(svg: string): GradientPaint | undefined {
  const root = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[^"]*" height="[^"]*" viewBox="0 0 (\S+) (\S+)">/.exec(svg);
  if (!root) return undefined;
  const width = parseFloat(root[1]);
  const height = parseFloat(root[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  const rest = svg.slice(root[0].length);
  const solid = /^<rect width="[^"]*" height="[^"]*" fill="(#[0-9a-f]{6})"\/><\/svg>$/.exec(rest);
  if (solid) return { kind: 'solid', width, height, color: solid[1] };
  const stops = [...rest.matchAll(/<stop offset="([^"]*)" stop-color="(#[0-9a-f]{6})"(?: stop-opacity="([^"]*)")?\/>/g)].map((m) => ({ offset: parseFloat(m[1]), color: m[2], opacity: m[3] === undefined ? 1 : parseFloat(m[3]) }));
  if (!stops.length || stops.some((s) => !Number.isFinite(s.offset) || !Number.isFinite(s.opacity))) return undefined;
  const lin = /^<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)">/.exec(rest);
  if (lin) {
    const coords = lin.slice(1, 5).map(parseFloat) as [number, number, number, number];
    return coords.every(Number.isFinite) ? { kind: 'linear', width, height, coords, stops } : undefined;
  }
  const rad = /^<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="([^"]*)" cy="([^"]*)" r="([^"]*)"(?: gradientTransform="translate\([^)]*\) scale\(1 ([^)]*)\) translate\([^)]*\)")?>/.exec(rest);
  if (rad) {
    const [cx, cy, r] = rad.slice(1, 4).map(parseFloat);
    const scaleY = rad[4] === undefined ? 1 : parseFloat(rad[4]);
    return [cx, cy, r, scaleY].every(Number.isFinite) && r > 0 && scaleY > 0 ? { kind: 'radial', width, height, cx, cy, r, scaleY, stops } : undefined;
  }
  return undefined;
}
