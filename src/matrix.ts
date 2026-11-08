/**
 * matrix — 2 次元のアフィン変換 (行列) と、輪郭 (Seg) の共通の型と計算。
 *
 * 行列は [a, b, c, d, e, f] (x' = a·x + c·y + e、y' = b·x + d·y + f。PDF・SVG・PostScript の書き方と同じ)。
 * 合成は mul(p, c) = 「c を先に、p を後に」(列ベクトルの流儀: 点に c を掛けてから p を掛ける。PDF の cm・SVG の transform の入れ子の順)。
 * PostScript (§4.3.3) やメタファイルの「行ベクトルの積 a·b (先に a、次に b)」は mul(b, a) と同じ値になる
 * (要素ごとの式は積の交換と和の順まで同じなので、浮動小数点の結果も一致する)。
 *
 * 描画・画像・図形の読み込み (pdfRenderer・svg・psGraphics・metafile・eps・paint) が共有する。
 * 組版の中核の geometry.ts とは別 (あちらは箱の座標)
 */

export type Matrix = [number, number, number, number, number, number];

/** 恒等変換 (書き換えないこと。変える要素は [...IDENTITY] で写す) */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** 2 つの変換の合成 (c を先に、p を後に当てる): mul(p, c)·v = p·(c·v) */
export const mul = (p: Matrix, c: Matrix): Matrix => [
  p[0] * c[0] + p[2] * c[1],
  p[1] * c[0] + p[3] * c[1],
  p[0] * c[2] + p[2] * c[3],
  p[1] * c[2] + p[3] * c[3],
  p[0] * c[4] + p[2] * c[5] + p[4],
  p[1] * c[4] + p[3] * c[5] + p[5],
];

/**
 * 逆変換。行列式が 0 か有限でなければ undefined。minDet を渡すと、行列式の絶対値がそれより小さいものも「逆が無い」とする
 * (SVG は 1e-12 で、PostScript は 0 (ちょうど 0 のときだけ undefinedresult) で使う)
 */
export function invert(m: Matrix, minDet = 0): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || det === 0 || Math.abs(det) < minDet) return undefined;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** 点 (x, y) を写す */
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** ベクトル (x, y) を写す (平行移動を掛けない。PostScript の dtransform) */
export const applyVector = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/** 恒等変換か (undefined も恒等とみなす) */
export const isIdentity = (m: Matrix | undefined) => !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);

/** 輪郭の 1 要素: M (始点)・L (直線)・C (3 次ベジェ)・Z (閉じる) */
export type Seg =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

/** 輪郭の点をすべて m で写す */
export function transformSegs(segs: readonly Seg[], m: Matrix): Seg[] {
  const X = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
  const Y = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
  return segs.map((s): Seg => {
    if (s.op === 'Z') return s;
    if (s.op === 'C') return { op: 'C', x1: X(s.x1, s.y1), y1: Y(s.x1, s.y1), x2: X(s.x2, s.y2), y2: Y(s.x2, s.y2), x: X(s.x, s.y), y: Y(s.x, s.y) };
    return { op: s.op, x: X(s.x, s.y), y: Y(s.x, s.y) };
  });
}
