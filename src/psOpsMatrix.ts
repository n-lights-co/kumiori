/**
 * psOpsMatrix — 座標の演算子 (§8.2: matrix・translate・scale・rotate・concat・transform など) と、
 * 行列 (6 要素の配列) をオペランドから読む・書く補助 (ほかの演算子の節も使う)
 */
import { apply, applyVector, IDENTITY, invert, mul } from './matrix';
import { type Interp, type PSArray, type PSObj, PSError, arrItems, real } from './psInterp';
import type { Graphics, Mat } from './psGraphics';

/** オペランドスタックの上の行列 (6 要素の配列) を取る */
export function popMatrix(I: Interp): Mat {
  const a = I.popArray();
  return readMatrix(a);
}
/** 配列を行列として読む (6 個の数でなければ rangecheck・typecheck) */
export function readMatrix(a: PSArray): Mat {
  if (a.n !== 6) throw new PSError('rangecheck');
  return arrItems(a).map((o) => {
    if (o.t !== 'int' && o.t !== 'real') throw new PSError('typecheck');
    return o.v;
  }) as Mat;
}
/** 行列を配列に書き込み、その配列を積む (save の記録も取る) */
export function writeMatrix(I: Interp, a: PSArray, m: Mat) {
  if (a.n !== 6) throw new PSError('rangecheck');
  for (let k = 0; k < 6; k++) {
    I.journalArray(a.a, a.o + k);
    a.a[a.o + k] = real(m[k]);
  }
  I.push(a);
}
/** 行列 (6 個の数の配列) か */
export const isMatrix = (o: PSObj | undefined) => !!o && o.t === 'array' && o.n === 6 && arrItems(o).every((x) => x.t === 'int' || x.t === 'real');

/** 座標の演算子を登録する */
export function installMatrixOperators(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  // 座標 (§8.2)
  // 新しい配列は VM に数える (newArray)。数えないと、配列の 1 枠ごとに、勘定の無い行列を詰めて、上限を超える量を確保できる
  d('matrix', (I) => I.push(I.newArray(IDENTITY.map(real))));
  d('initmatrix', () => void (G.g.ctm = [...IDENTITY] as Mat));
  d('identmatrix', () => writeMatrix(I, I.popArray(), [...IDENTITY] as Mat));
  d('defaultmatrix', () => writeMatrix(I, I.popArray(), [...IDENTITY] as Mat));
  d('currentmatrix', () => writeMatrix(I, I.popArray(), G.g.ctm));
  d('setmatrix', () => void (G.g.ctm = popMatrix(I)));
  d('translate', (I) => {
    const top = I.ostack[I.ostack.length - 1];
    if (isMatrix(top)) {
      const a = I.popArray();
      const y = I.popNum();
      const x = I.popNum();
      return writeMatrix(I, a, [1, 0, 0, 1, x, y]);
    }
    const y = I.popNum();
    const x = I.popNum();
    G.g.ctm = mul(G.g.ctm, [1, 0, 0, 1, x, y]);
  });
  d('scale', (I) => {
    const top = I.ostack[I.ostack.length - 1];
    if (isMatrix(top)) {
      const a = I.popArray();
      const y = I.popNum();
      const x = I.popNum();
      return writeMatrix(I, a, [x, 0, 0, y, 0, 0]);
    }
    const y = I.popNum();
    const x = I.popNum();
    G.g.ctm = mul(G.g.ctm, [x, 0, 0, y, 0, 0]);
  });
  d('rotate', (I) => {
    const top = I.ostack[I.ostack.length - 1];
    let a: PSArray | undefined;
    if (isMatrix(top)) a = I.popArray();
    const t = (I.popNum() * Math.PI) / 180;
    const m: Mat = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
    if (a) return writeMatrix(I, a, m);
    G.g.ctm = mul(G.g.ctm, m);
  });
  d('concat', () => void (G.g.ctm = mul(G.g.ctm, popMatrix(I))));
  d('concatmatrix', () => {
    const out = I.popArray();
    const b = popMatrix(I);
    const a = popMatrix(I);
    writeMatrix(I, out, mul(b, a));
  });
  d('invertmatrix', () => {
    const out = I.popArray();
    const m = invert(popMatrix(I));
    if (!m) throw new PSError('undefinedresult');
    writeMatrix(I, out, m);
  });
  const xform = (f: (m: Mat, x: number, y: number) => [number, number], inv: boolean) => (I: Interp) => {
    let m = G.g.ctm;
    const top = I.ostack[I.ostack.length - 1];
    if (isMatrix(top)) m = readMatrix(I.popArray());
    const y = I.popNum();
    const x = I.popNum();
    if (inv) {
      const mi = invert(m);
      if (!mi) throw new PSError('undefinedresult');
      m = mi;
    }
    const [a, b] = f(m, x, y);
    I.push(real(a));
    I.push(real(b));
  };
  d('transform', xform(apply, false));
  d('dtransform', xform(applyVector, false));
  d('itransform', xform(apply, true));
  d('idtransform', xform(applyVector, true));
}
