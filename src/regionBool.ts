/**
 * regionBool — 多角形の集まりどうしの論理演算 (共通部分・和・排他的論理和・差)。
 *
 * メタファイルの切り抜き (領域とパスを RegionMode で組み合わせる) のために使う。
 * 曲線 (3 次ベジェ・楕円の弧) は細かい折れ線にし、平面を横の帯 (頂点と辺の交点の y で区切る) に分ける。
 * 帯の中では辺どうしが交わらないので、左から辺をたどって内側かどうか (偶奇・非ゼロの規則) を数え、
 * 結果の内側を台形にする。上下の帯で左右の辺が同じ台形はつなげる。出す台形はどれも同じ向きで重ならない (非ゼロの規則で塗れる)。
 */

export type Pt = [number, number];
/** 輪 (閉じた折れ線) の集まり */
export type Rings = Pt[][];
/** 変換 (x' = a·x + c·y + e、y' = b·x + d·y + f) */
export type Mat = [number, number, number, number, number, number];

/** 曲線を折れ線にするときの、大きさに対する許す誤差の割合 */
const TOL = 2.5e-4;

/** パスの d (M・L・H・V・C・A・Z。絶対座標だけ) を輪にする。m があれば点を写す */
export function flattenPath(d: string, m?: Mat): Rings {
  const tk = d.match(/[MLHVCAZmlhvcaz]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: Rings = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  let cmd = '';
  const n = () => parseFloat(tk[i++]);
  const close = () => {
    if (cur.length > 2) rings.push(cur);
    cur = [];
  };
  while (i < tk.length) {
    if (/[A-Za-z]/.test(tk[i])) cmd = tk[i++].toUpperCase();
    else if (!cmd) {
      i++;
      continue;
    }
    if (cmd === 'Z') {
      close();
      x = sx;
      y = sy;
      cmd = '';
      continue;
    }
    if (cmd === 'M') {
      close();
      x = sx = n();
      y = sy = n();
      cur.push([x, y]);
      cmd = 'L';
    } else if (cmd === 'L') {
      x = n();
      y = n();
      cur.push([x, y]);
    } else if (cmd === 'H') {
      x = n();
      cur.push([x, y]);
    } else if (cmd === 'V') {
      y = n();
      cur.push([x, y]);
    } else if (cmd === 'C') {
      const p: Pt[] = [
        [x, y],
        [n(), n()],
        [n(), n()],
        [n(), n()],
      ];
      bezier(p, cur);
      [x, y] = p[3];
    } else if (cmd === 'A') {
      const rx = n();
      const ry = n();
      const rot = n();
      const large = n();
      const sweep = n();
      const ex = n();
      const ey = n();
      arc(x, y, rx, ry, rot, !!large, !!sweep, ex, ey, cur);
      x = ex;
      y = ey;
    } else i++;
  }
  close();
  return m ? rings.map((r) => r.map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]] as Pt)) : rings;
}

/** 3 次ベジェを折れ線に (始点は入れない) */
function bezier(p: Pt[], out: Pt[]) {
  const size = Math.max(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) + Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]), 1e-9);
  const tol = size * TOL;
  const rec = (a: Pt, b: Pt, c: Pt, e: Pt, depth: number) => {
    // 平らさ: 制御点と弦の距離
    const dx = e[0] - a[0];
    const dy = e[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    const d1 = Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len;
    const d2 = Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / len;
    if (depth > 16 || Math.max(d1, d2) <= tol) {
      out.push(e);
      return;
    }
    const mid = (u: Pt, v: Pt): Pt => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ce = mid(c, e);
    const abc = mid(ab, bc);
    const bce = mid(bc, ce);
    const m = mid(abc, bce);
    rec(a, ab, abc, m, depth + 1);
    rec(m, bce, ce, e, depth + 1);
  };
  rec(p[0], p[1], p[2], p[3], 0);
}

/** 楕円の弧 (SVG の A。端点の表し方 → 中心の表し方は SVG 1.1 F.6.5) を折れ線に (始点は入れない) */
function arc(x1: number, y1: number, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number, out: Pt[]) {
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if ((x1 === x2 && y1 === y2) || !rx || !ry) {
    out.push([x2, y2]);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  // 弦と弧の隔たり r(1 − cos(θ/2)) が r·TOL 以下になる刻み
  const step = 2 * Math.acos(1 - TOL);
  const k = Math.max(1, Math.ceil(Math.abs(dt) / step));
  for (let j = 1; j <= k; j++) {
    const t = t1 + (dt * j) / k;
    if (j === k) out.push([x2, y2]);
    else out.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 上 (y の小さいほう) から下へ向かう辺なら 1、逆なら -1 */
  w: number;
  /** 0: A の辺、1: B の辺 */
  who: 0 | 1;
  id: number;
}

const xAt = (e: Edge, y: number) => e.x1 + ((y - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1);

/**
 * 輪の集まり A・B の論理演算。evenOdd は塗りの規則 (偽なら非ゼロ)。op は RegionMode ([MS-EMF] 2.1.29) の番号:
 * 1 AND (共通部分)・2 OR (和)・3 XOR (排他的論理和)・4 DIFF (A から B を除く)・5 COPY (B)。結果は重ならない台形の輪
 */
export function polyBool(a: Rings, aEvenOdd: boolean, b: Rings, bEvenOdd: boolean, op: number): Rings {
  const edges: Edge[] = [];
  const add = (rings: Rings, who: 0 | 1) => {
    for (const r of rings)
      for (let k = 0; k < r.length; k++) {
        const p = r[k];
        const q = r[(k + 1) % r.length];
        if (p[1] === q[1]) continue; // 横の辺は内外を変えない
        const down = p[1] < q[1];
        const [u, v] = down ? [p, q] : [q, p];
        edges.push({ x1: u[0], y1: u[1], x2: v[0], y2: v[1], w: down ? 1 : -1, who, id: edges.length });
      }
  };
  add(a, 0);
  add(b, 1);
  // 帯の境: 頂点の y と、辺どうしの交点の y
  const ys = new Set<number>();
  for (const e of edges) {
    ys.add(e.y1);
    ys.add(e.y2);
  }
  const sorted = [...edges].sort((p, q) => p.y1 - q.y1);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].y1 < e.y2; j++) {
      const f = sorted[j];
      const lo = Math.max(e.y1, f.y1);
      const hi = Math.min(e.y2, f.y2);
      if (hi <= lo) continue;
      const d0 = xAt(e, lo) - xAt(f, lo);
      const d1 = xAt(e, hi) - xAt(f, hi);
      if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) ys.add(lo + ((hi - lo) * d0) / (d0 - d1));
    }
  }
  const Y = [...ys].sort((p, q) => p - q);
  const inside = (w: number, eo: boolean) => (eo ? (w & 1) !== 0 : w !== 0);
  const keep = (ia: boolean, ib: boolean) => (op === 1 ? ia && ib : op === 2 ? ia || ib : op === 3 ? ia !== ib : op === 4 ? ia && !ib : ib);
  const out: Rings = [];
  // 前の帯の台形 (左の辺・右の辺 → 輪)。同じ辺どうしの台形が続けば、下へ伸ばす
  let prev = new Map<string, Pt[]>();
  for (let s = 0; s + 1 < Y.length; s++) {
    const y0 = Y[s];
    const y1 = Y[s + 1];
    if (y1 - y0 <= 0) continue;
    const ym = (y0 + y1) / 2;
    const act = edges.filter((e) => e.y1 <= y0 && e.y2 >= y1).map((e) => ({ e, xm: xAt(e, ym) }));
    act.sort((p, q) => p.xm - q.xm);
    let wa = 0;
    let wb = 0;
    let open: Edge | null = null;
    const next = new Map<string, Pt[]>();
    for (let k = 0; k < act.length; k++) {
      const e = act[k].e;
      if (e.who === 0) wa += e.w;
      else wb += e.w;
      const on = keep(inside(wa, aEvenOdd), inside(wb, bEvenOdd));
      if (on && !open) open = e;
      else if (!on && open) {
        const key = `${open.id}/${e.id}`;
        const up = prev.get(key);
        if (up) {
          // 輪 [左上, 右上, 右下, 左下]: 下の 2 点を下げる
          up[2] = [xAt(e, y1), y1];
          up[3] = [xAt(open, y1), y1];
          next.set(key, up);
        } else {
          const ring: Pt[] = [
            [xAt(open, y0), y0],
            [xAt(e, y0), y0],
            [xAt(e, y1), y1],
            [xAt(open, y1), y1],
          ];
          out.push(ring);
          next.set(key, ring);
        }
        open = null;
      }
    }
    prev = next;
  }
  return out;
}

/** 輪 → パスの d */
export function ringsPath(rings: Rings, fmt: (v: number) => string): string {
  return rings.map((r) => `M${r.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}Z`).join('');
}
