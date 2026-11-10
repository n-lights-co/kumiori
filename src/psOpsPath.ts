/**
 * psOpsPath — パスの演算子 (§8.2: moveto・lineto・curveto・arc・closepath・pathbbox・pathforall・clip・rect*)、塗る演算子 (fill・stroke・shfill) と、
 * ユーザパス (§4.6: uappend・ufill・ustroke・inufill など)
 */
import { apply, applyVector, invert, mul, type Seg } from './matrix';
import { type Interp, PSError, arr, arrItems, real, FALSE } from './psInterp';
import type { Graphics, Mat } from './psGraphics';
import { isMatrix, popMatrix } from './psOpsMatrix';
import { shfill } from './psShading';

/** 矩形 (x, y, w, h) をそれぞれ閉じた部分パスとして現在のパスに足す (rectfill・rectstroke・rectclip・execform の BBox) */
export function appendRects(G: Graphics, rs: Array<[number, number, number, number]>) {
  for (const [x, y, w, h] of rs) {
    G.moveTo(x, y);
    const m = G.g.ctm;
    for (const [px, py] of [
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]) {
      const [dx, dy] = apply(m, px, py);
      G.lineToDev(dx, dy);
    }
    G.closePath();
  }
}

/** パス・塗り・ユーザパスの演算子を登録する */
export function installPathOperators(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  // パス (§8.2)
  d('newpath', () => G.newPath());
  d('currentpoint', (I) => {
    const [x, y] = G.userCP();
    I.push(real(x));
    I.push(real(y));
  });
  d('moveto', (I) => {
    const y = I.popNum();
    const x = I.popNum();
    G.moveTo(x, y);
  });
  d('rmoveto', (I) => {
    const dy = I.popNum();
    const dx = I.popNum();
    const cp = G.needCP();
    const [ddx, ddy] = applyVector(G.g.ctm, dx, dy);
    const inv = invert(G.g.ctm);
    if (!inv) throw new PSError('undefinedresult'); // 0 0 scale のあとの rmoveto (CTM が逆行列を持たない)
    const [ux, uy] = apply(inv, cp[0] + ddx, cp[1] + ddy);
    G.moveTo(ux, uy);
  });
  d('lineto', (I) => {
    const y = I.popNum();
    const x = I.popNum();
    const [dx, dy] = apply(G.g.ctm, x, y);
    G.lineToDev(dx, dy);
  });
  d('rlineto', (I) => {
    const dy = I.popNum();
    const dx = I.popNum();
    const cp = G.needCP();
    const [ddx, ddy] = applyVector(G.g.ctm, dx, dy);
    G.lineToDev(cp[0] + ddx, cp[1] + ddy);
  });
  d('curveto', (I) => {
    const v = [6, 5, 4, 3, 2, 1].map(() => I.popNum()).reverse();
    const m = G.g.ctm;
    const [a, b] = apply(m, v[0], v[1]);
    const [c, e] = apply(m, v[2], v[3]);
    const [f, h] = apply(m, v[4], v[5]);
    G.curveToDev(a, b, c, e, f, h);
  });
  d('rcurveto', (I) => {
    const v = [6, 5, 4, 3, 2, 1].map(() => I.popNum()).reverse();
    const cp = G.needCP();
    const m = G.g.ctm;
    const p = (i: number) => {
      const [x, y] = applyVector(m, v[i], v[i + 1]);
      return [cp[0] + x, cp[1] + y];
    };
    const [a, b] = p(0);
    const [c, e] = p(2);
    const [f, h] = p(4);
    G.curveToDev(a, b, c, e, f, h);
  });
  d('closepath', () => G.closePath());
  d('arc', (I) => {
    const a2 = I.popNum();
    const a1 = I.popNum();
    const r = I.popNum();
    const y = I.popNum();
    const x = I.popNum();
    G.arc(x, y, r, a1, a2, false);
  });
  d('arcn', (I) => {
    const a2 = I.popNum();
    const a1 = I.popNum();
    const r = I.popNum();
    const y = I.popNum();
    const x = I.popNum();
    G.arc(x, y, r, a1, a2, true);
  });
  const arct = (I: Interp, push: boolean) => {
    const r = I.popNum();
    const y2 = I.popNum();
    const x2 = I.popNum();
    const y1 = I.popNum();
    const x1 = I.popNum();
    const [x0, y0] = G.userCP();
    // 2 本の接線に接する円弧 (§8.2 arct)
    const v1 = [x0 - x1, y0 - y1];
    const v2 = [x2 - x1, y2 - y1];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    if (!l1 || !l2 || Math.abs(cross) < 1e-12 || r === 0) {
      const [dx, dy] = apply(G.g.ctm, x1, y1);
      G.lineToDev(dx, dy);
      if (push) [x1, y1, x1, y1].forEach((v) => I.push(real(v)));
      return;
    }
    const cosT = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
    const dist = r / Math.tan(theta / 2);
    const t1 = [x1 + (v1[0] / l1) * dist, y1 + (v1[1] / l1) * dist];
    const t2 = [x1 + (v2[0] / l2) * dist, y1 + (v2[1] / l2) * dist];
    const bis = [v1[0] / l1 + v2[0] / l2, v1[1] / l1 + v2[1] / l2];
    const bl = Math.hypot(bis[0], bis[1]);
    const cd = r / Math.sin(theta / 2);
    const c = [x1 + (bis[0] / bl) * cd, y1 + (bis[1] / bl) * cd];
    const a1 = (Math.atan2(t1[1] - c[1], t1[0] - c[0]) * 180) / Math.PI;
    const a2 = (Math.atan2(t2[1] - c[1], t2[0] - c[0]) * 180) / Math.PI;
    G.arc(c[0], c[1], Math.abs(r), a1, a2, cross > 0);
    if (push) [t1[0], t1[1], t2[0], t2[1]].forEach((v) => I.push(real(v)));
  };
  d('arct', (I) => arct(I, false));
  d('arcto', (I) => arct(I, true));
  d('flattenpath', () => {});
  d('reversepath', () => {
    // 部分パスごとに向きを逆にする
    const out: Seg[] = [];
    let sub: Seg[] = [];
    const flush = () => {
      if (!sub.length) return;
      const closed = sub[sub.length - 1].op === 'Z';
      const segs = closed ? sub.slice(0, -1) : sub;
      const pts: Array<[number, number]> = [];
      for (const s of segs) if (s.op !== 'Z') pts.push([s.x, s.y]);
      if (!pts.length) return;
      out.push({ op: 'M', x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
      for (let k = segs.length - 1; k > 0; k--) {
        const s = segs[k];
        const prev = pts[k - 1];
        if (s.op === 'C') out.push({ op: 'C', x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1, x: prev[0], y: prev[1] });
        else out.push({ op: 'L', x: prev[0], y: prev[1] });
      }
      if (closed) out.push({ op: 'Z' });
      sub = [];
    };
    // 逆向きのパスは、点を作り直す
    G.countPoints(G.g.path.length);
    for (const s of G.g.path) {
      if (s.op === 'M') flush();
      sub.push(s);
    }
    flush();
    G.g.path = out;
  });
  d('strokepath', () => {
    I.warn('strokepath');
    G.newPath();
  });
  d('clippath', () => {
    if (G.g.clip) G.countCopy(G.g.clip.segs.length);
    G.g.path = G.clipPathSegs();
    const last = G.g.path.find((s) => s.op === 'M');
    G.g.cp = last && last.op === 'M' ? [last.x, last.y] : undefined;
  });
  d('pathbbox', (I) => {
    const pts: Array<[number, number]> = [];
    for (const s of G.g.path) {
      if (s.op === 'Z') continue;
      if (s.op === 'C') pts.push([s.x1, s.y1], [s.x2, s.y2]);
      pts.push([s.x, s.y]);
    }
    if (!pts.length) throw new PSError('nocurrentpoint');
    const inv = invert(G.g.ctm);
    if (!inv) throw new PSError('undefinedresult');
    // Math.min(...xs) の spread は点の数 (数十万) で引数の数の上限を超えて RangeError になるので、ループで求める
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => apply(inv, x, y));
    I.push(real(Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0])));
    I.push(real(Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1])));
    I.push(real(Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0])));
    I.push(real(Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1])));
  });
  d('pathforall', (I) => {
    const close = I.popProc();
    const curve = I.popProc();
    const line = I.popProc();
    const move = I.popProc();
    const inv = invert(G.g.ctm);
    if (!inv) throw new PSError('undefinedresult');
    I.work(G.g.path.length);
    for (const s of G.g.path.slice()) {
      if (s.op === 'Z') {
        if (!I.loopBody(close)) break;
        continue;
      }
      if (s.op === 'C') {
        for (const [x, y] of [apply(inv, s.x1, s.y1), apply(inv, s.x2, s.y2)]) {
          I.push(real(x));
          I.push(real(y));
        }
      }
      const [x, y] = apply(inv, s.x, s.y);
      I.push(real(x));
      I.push(real(y));
      if (!I.loopBody(s.op === 'M' ? move : s.op === 'L' ? line : curve)) break;
    }
  });
  d('initclip', () => void (G.g.clip = undefined));
  d('clip', () => G.clip(false));
  d('eoclip', () => G.clip(true));
  d('clipsave', () => {
    // 入れ子の深さの上限は gsave と同じ (clipStack は gsave のたびに写すので、際限なく積ませない)
    if (G.g.clipStack.length >= 1000) throw new PSError('limitcheck');
    G.g.clipStack.push(G.g.clip);
  });
  d('cliprestore', () => {
    if (G.g.clipStack.length) G.g.clip = G.g.clipStack.pop();
  });
  const rects = (I: Interp): Array<[number, number, number, number]> => {
    const top = I.pop();
    if (top.t === 'array') {
      const v = arrItems(top).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0));
      const out: Array<[number, number, number, number]> = [];
      for (let k = 0; k + 3 < v.length; k += 4) out.push([v[k], v[k + 1], v[k + 2], v[k + 3]]);
      return out;
    }
    if (top.t === 'string') {
      I.warn('rect の文字列の形');
      return [];
    }
    if (top.t !== 'int' && top.t !== 'real') throw new PSError('typecheck');
    const h = top.v;
    const w = I.popNum();
    const y = I.popNum();
    const x = I.popNum();
    return [[x, y, w, h]];
  };
  d('rectfill', (I) => {
    const rs = rects(I);
    // 現在のパスには触れない (PLRM §8.2 rectfill)。現在の点と、部分パスの始まり (closepath で戻る点) も元に戻す
    const saved = G.g.path;
    const cp = G.g.cp;
    const sp = G.g.sp;
    G.g.path = [];
    appendRects(G, rs);
    G.fill(false);
    G.g.path = saved;
    G.g.cp = cp;
    G.g.sp = sp;
  });
  d('rectstroke', (I) => {
    let m: Mat | undefined;
    // 形 (PLRM §8.2 rectstroke): x y width height・x y width height matrix・numarray・numarray matrix・numstring・numstring matrix。
    // 矩形の数の並びは 4 の倍数なので、一番上が 6 つの数の配列で、その下に矩形 (数・配列・文字列) があれば、一番上は行列
    const below = I.ostack[I.ostack.length - 2];
    if (isMatrix(I.ostack[I.ostack.length - 1]) && below && (below.t === 'int' || below.t === 'real' || below.t === 'array' || below.t === 'string')) m = popMatrix(I);
    const rs = rects(I);
    const saved = G.g.path;
    const cp = G.g.cp;
    const sp = G.g.sp;
    const ctm = G.g.ctm;
    G.g.path = [];
    appendRects(G, rs);
    if (m) G.g.ctm = mul(ctm, m);
    G.stroke();
    G.g.ctm = ctm;
    G.g.path = saved;
    G.g.cp = cp;
    G.g.sp = sp;
  });
  d('rectclip', (I) => {
    const rs = rects(I);
    G.newPath();
    appendRects(G, rs);
    G.clip(false);
    G.newPath();
  });

  // 塗る (§8.2)
  d('fill', () => G.fill(false));
  d('eofill', () => G.fill(true));
  d('stroke', () => G.stroke());
  d('erasepage', () => {});
  d('shfill', (I) => shfill(G, I.pop()));

  // ユーザパス (§4.6): 演算子の並びをそのまま実行する
  d('setbbox', (I) => {
    for (let k = 0; k < 4; k++) I.popNum();
  });
  d('ucache', () => {});
  const uappend = (I: Interp) => {
    const p = I.pop();
    if (p.t !== 'array') throw new PSError('typecheck');
    if (p.n === 2 && p.a[p.o].t === 'string') {
      I.warn('符号化したユーザパス');
      return;
    }
    I.execProc({ ...p, x: true });
  };
  d('uappend', uappend);
  const upaint = (paint: () => void) => (I: Interp) => {
    let m: Mat | undefined;
    if (isMatrix(I.ostack[I.ostack.length - 1]) && I.ostack[I.ostack.length - 2]?.t === 'array') m = popMatrix(I);
    const saved = G.copy(G.g);
    G.newPath();
    uappend(I);
    if (m) G.g.ctm = mul(G.g.ctm, m);
    paint();
    G.g = saved;
  };
  d('ufill', upaint(() => G.fill(false)));
  d('ueofill', upaint(() => G.fill(true)));
  d('ustroke', upaint(() => G.stroke()));
  d('upath', (I) => {
    I.popBool();
    I.push(arr([], true));
  });
  d('ustrokepath', (I) => {
    I.pop();
    G.newPath();
  });
  d('inufill', (I) => {
    I.pop();
    I.pop();
    I.push(FALSE);
  });
  d('infill', (I) => {
    I.pop();
    if (I.ostack[I.ostack.length - 1]?.t !== 'array') I.pop();
    I.push(FALSE);
  });
  d('ineofill', (I) => {
    I.pop();
    if (I.ostack[I.ostack.length - 1]?.t !== 'array') I.pop();
    I.push(FALSE);
  });
  d('instroke', (I) => {
    I.pop();
    if (I.ostack[I.ostack.length - 1]?.t !== 'array') I.pop();
    I.push(FALSE);
  });
}
