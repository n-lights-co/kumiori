/**
 * strokeOutline — 線の輪郭 (太さ・つなぎ目・端・破線を、塗る形にしたもの) を作る。
 *
 *  PostScript の stroke (psGraphics.ts の Graphics.stroke) と、SVG の filter を画素で計算する所 (svgFilterRaster.ts) が使う。
 *  PostScript の解釈系 (psInterp.ts・psGraphics.ts) には頼らないので、EPS を読まない文書では、解釈系を読み込まずに使える
 *  (EPS の処理は、EPS が出てきたときだけ読み込む別のチャンク。assets.ts)。根拠は PostScript Language Reference 3rd ed. の
 *  §4.5 (塗りと線。線の太さ・端・つなぎ目・とがりの上限・破線)。psShading.ts から分けたもので、中身は変えていない
 */
import { invert, transformSegs, type Matrix, type Seg } from './matrix';

/**
 * 線の輪郭 (機器の座標の閉じた形の並び。すべて同じ向きなので、非ゼロ規則で塗れば線の形になる)。
 * 線はユーザ空間 (CTM の逆で戻した座標) で、太さ w の、線分ごとの長方形と、つなぎ目・端の形で表す:
 * つなぎ目は丸 (join 1)・面取り (2)・とがり (0。とがりの長さの比が miter の上限を超えれば面取り)、
 * 端は突き出し (cap 2: 太さの半分だけ延ばす)・丸 (1)・切り落とし (0)。破線は先に切り分ける。曲線は細かい線分にする
 */
export function strokeOutline(segs: Seg[], ctm: Matrix, w: number, cap: number, join: number, dash: { array: number[]; offset: number }, miter = 10, tally?: OutlineTally): Seg[] {
  // 作る間だけ持つ点の数 (勘定に積んだ分。作り終えたら戻す)
  const st = { temp: 0 };
  try {
    return outlineOf(segs, ctm, w, cap, join, dash, miter, tally, st);
  } finally {
    tally?.release(st.temp);
  }
}

/**
 * 線の輪郭を作る間の勘定 (Graphics.stroke が渡す)。どれも、上限を超えれば例外を投げて、輪郭を作るのをやめる。
 * 輪郭は元のパスの何十倍もの点になる (丸いつなぎ目は 1 つで 25 点、曲線は 16 分割して、線分ごとに長方形の 5 点) ので、
 * 作り切ってから数えるのでは遅い
 */
export interface OutlineTally {
  /** 輪郭の点を n 個作った */
  points(n: number): void;
  /** 作る間だけ持つ点 (パスの写し・曲線を分けた線分・破線のかけら) を n 個作った */
  temp(n: number): void;
  /** temp で数えた分を戻す */
  release(n: number): void;
}

function outlineOf(segs: Seg[], ctm: Matrix, w: number, cap: number, join: number, dash: { array: number[]; offset: number }, miter: number, tally: OutlineTally | undefined, st: { temp: number }): Seg[] {
  const inv = invert(ctm);
  if (!inv || !(w > 0)) return [];
  // 4096 点ごとにまとめて数える
  let pend = 0;
  const flushTemp = () => {
    if (tally && pend) {
      // 勘定に積めた分だけを、後で戻す分に足す (memAlloc が VMerror を投げたときは、積んでいない)
      tally.temp(pend);
      st.temp += pend;
    }
    pend = 0;
  };
  const temp = (n: number) => {
    pend += n;
    if (pend >= 4096) flushTemp();
  };
  if (tally) {
    tally.temp(segs.length);
    st.temp += segs.length;
  }
  const user = transformSegs(segs, inv);
  // 線分の並び (部分パスごと。閉じた部分パスは最初の点に戻る)
  const subs: Array<{ pts: Array<[number, number]>; closed: boolean }> = [];
  let cur: Array<[number, number]> = [];
  let start: [number, number] | undefined;
  const flush = (closed: boolean) => {
    if (cur.length >= 2) subs.push({ pts: cur, closed });
    cur = [];
  };
  for (const s of user) {
    if (s.op === 'M') {
      flush(false);
      cur = [[s.x, s.y]];
      start = [s.x, s.y];
    } else if (s.op === 'L') {
      temp(1);
      cur.push([s.x, s.y]);
    } else if (s.op === 'C') {
      temp(16);
      const p0 = cur[cur.length - 1] ?? [s.x1, s.y1];
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
        cur.push([a * p0[0] + b * s.x1 + c * s.x2 + d * s.x, a * p0[1] + b * s.y1 + c * s.y2 + d * s.y]);
      }
    } else if (s.op === 'Z' && start) {
      cur.push([start[0], start[1]]);
      flush(true);
      cur = [[start[0], start[1]]];
    }
  }
  flush(false);
  // 破線: 部分パスを、線・隙間の並びで切り分ける (開いた線になる)
  const pieces: Array<{ pts: Array<[number, number]>; closed: boolean }> = [];
  const total = dash.array.reduce((a, v) => a + v, 0);
  for (const sp of subs) {
    if (!(total > 0) || dash.array.some((v) => v < 0)) {
      pieces.push(sp);
      continue;
    }
    let idx = 0;
    let left = dash.array[0];
    let off = ((dash.offset % total) + total) % total;
    while (off > 0) {
      if (off >= left) {
        off -= left;
        idx = (idx + 1) % dash.array.length;
        left = dash.array[idx];
      } else {
        left -= off;
        off = 0;
      }
    }
    let on = idx % 2 === 0;
    let piece: Array<[number, number]> = on ? [sp.pts[0]] : [];
    for (let k = 1; k < sp.pts.length; k++) {
      let [x0, y0] = sp.pts[k - 1];
      const [x1, y1] = sp.pts[k];
      let len = Math.hypot(x1 - x0, y1 - y0);
      while (len > 1e-9) {
        const step = Math.min(left, len);
        const t = step / len;
        const nx = x0 + (x1 - x0) * t;
        const ny = y0 + (y1 - y0) * t;
        if (on) {
          temp(1);
          piece.push([nx, ny]);
        }
        len -= step;
        left -= step;
        [x0, y0] = [nx, ny];
        if (left <= 1e-9) {
          if (on && piece.length >= 2) pieces.push({ pts: piece, closed: false });
          idx = (idx + 1) % dash.array.length;
          left = dash.array[idx];
          on = !on;
          piece = on ? [[x0, y0]] : [];
          if (pieces.length > 20000) break;
        }
      }
    }
    if (on && piece.length >= 2) pieces.push({ pts: piece, closed: false });
  }
  flushTemp();
  const h = w / 2;
  const out: Seg[] = [];
  let counted = 0;
  // 機器の座標に直しながら足す (transformSegs と同じ式。全部を作ってから写すと、輪郭を 2 重に持つ)
  const X = (x: number, y: number) => ctm[0] * x + ctm[2] * y + ctm[4];
  const Y = (x: number, y: number) => ctm[1] * x + ctm[3] * y + ctm[5];
  /** 反時計回りの多角形を足す */
  const poly = (ps: Array<[number, number]>) => {
    if (ps.length < 3) return;
    if (tally && out.length - counted >= 4096) {
      tally.points(out.length - counted);
      counted = out.length;
    }
    let area = 0;
    for (let k = 0; k < ps.length; k++) {
      const [ax, ay] = ps[k];
      const [bx, by] = ps[(k + 1) % ps.length];
      area += ax * by - bx * ay;
    }
    const pts = area < 0 ? ps.slice().reverse() : ps;
    pts.forEach(([x, y], k) => out.push({ op: k ? 'L' : 'M', x: X(x, y), y: Y(x, y) }));
    out.push({ op: 'Z' });
  };
  const circle = (c: [number, number]) => poly(Array.from({ length: 24 }, (_, k): [number, number] => [c[0] + h * Math.cos((k * Math.PI) / 12), c[1] + h * Math.sin((k * Math.PI) / 12)]));
  for (const pc of pieces) {
    const pts = pc.pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pc.pts[k - 1][0], p[1] - pc.pts[k - 1][1]) > 1e-9);
    if (pts.length < 2) {
      // 長さ 0 の線: 丸い端なら点を描く
      if (cap === 1 && pts.length) circle(pts[0]);
      continue;
    }
    const dirs = pts.slice(1).map((p, k) => {
      const dx = p[0] - pts[k][0];
      const dy = p[1] - pts[k][1];
      const l = Math.hypot(dx, dy);
      return [dx / l, dy / l] as [number, number];
    });
    dirs.forEach(([ux, uy], k) => {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      // 端の突き出し (cap 2)。閉じていない線の最初と最後の線分だけ
      const e0 = !pc.closed && k === 0 && cap === 2 ? h : 0;
      const e1 = !pc.closed && k === dirs.length - 1 && cap === 2 ? h : 0;
      const nx = -uy * h;
      const ny = ux * h;
      poly([
        [ax - ux * e0 + nx, ay - uy * e0 + ny],
        [ax - ux * e0 - nx, ay - uy * e0 - ny],
        [bx + ux * e1 - nx, by + uy * e1 - ny],
        [bx + ux * e1 + nx, by + uy * e1 + ny],
      ]);
    });
    // つなぎ目 (閉じた線は最後と最初の線分のつなぎ目も)
    const joins: Array<[number, [number, number], [number, number]]> = [];
    for (let k = 1; k < pts.length - 1; k++) joins.push([k, dirs[k - 1], dirs[k]]);
    if (pc.closed && dirs.length >= 2) joins.push([0, dirs[dirs.length - 1], dirs[0]]);
    for (const [k, [ux0, uy0], [ux1, uy1]] of joins) {
      const p = pts[k];
      const cross = ux0 * uy1 - uy0 * ux1;
      if (Math.abs(cross) < 1e-9 && ux0 * ux1 + uy0 * uy1 > 0) continue;
      if (join === 1) {
        circle(p);
        continue;
      }
      // 外側の角: 曲がる向きの反対側
      const sgn = cross > 0 ? -1 : 1;
      const o0: [number, number] = [p[0] + sgn * -uy0 * h, p[1] + sgn * ux0 * h];
      const o1: [number, number] = [p[0] + sgn * -uy1 * h, p[1] + sgn * ux1 * h];
      const tri: Array<[number, number]> = [p, o0, o1];
      if (join === 0) {
        // とがり: 2 つの外側の辺の交点。とがりの長さ ÷ 太さ = 1 / sin(φ/2) (φ は 2 本の線のなす角 = π − 曲がる角 θ) が
        // miter の上限以下のときだけ (上限を超えれば面取り)
        const cos = ux0 * ux1 + uy0 * uy1;
        const ratio = 1 / Math.sqrt(Math.max((1 + cos) / 2, 1e-12));
        if (ratio <= miter) {
          const mx = o0[0] + ux0 * h * Math.tan(Math.acos(Math.min(1, Math.max(-1, cos))) / 2);
          const my = o0[1] + uy0 * h * Math.tan(Math.acos(Math.min(1, Math.max(-1, cos))) / 2);
          tri.splice(2, 0, [mx, my]);
        }
      }
      poly(tri);
    }
    // 丸い端
    if (!pc.closed && cap === 1) {
      circle(pts[0]);
      circle(pts[pts.length - 1]);
    }
  }
  if (tally) tally.points(out.length - counted);
  return out;
}

