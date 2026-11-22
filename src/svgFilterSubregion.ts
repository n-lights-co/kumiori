/**
 * svgFilterSubregion — SVG の filter の要素 (primitive) の部分領域 (Filter Effects 1 §9.4 filter primitive subregion) の読み方。
 * 画素で計算する所 (svgFilterRaster.ts) と、図形で近似する所 (svg.ts の filterOf) が同じ決まりで読むように、ここにまとめる。
 * 座標は、filter を付けた要素の座標 (利用者の座標)。
 */

type Box = { x: number; y: number; w: number; h: number };

/** 標準の入力 (§9.2 の in の値のうち、結果の名前でないもの)。部分領域は filter の領域 */
export const isStandardInput = (r: string) => /^(SourceGraphic|SourceAlpha|BackgroundImage|BackgroundAlpha|FillPaint|StrokePaint)$/.test(r.trim());

/**
 * 部分領域の既定を決める、参照する結果 (§9.4: 既定は、参照する結果の部分領域の和)。参照の無い要素 (feImage・feTurbulence・feFlood) と、
 * feTile (入力を縦横に並べて、ふつうは入力より広い結果を作る要素) は空 (filter の領域。§9.4: 既定は、filter の領域の
 * 大きさに対する 0%,0%,100%,100%)。name は小文字の要素名、mergeIns は feMerge の feMergeNode の in
 */
export function subregionRefs(name: string, attr: (k: string) => string | undefined, mergeIns: () => Array<string | undefined>): Array<string | undefined> {
  const ins = [attr('in'), attr('in2')];
  if (name === 'femerge') return mergeIns();
  if (name === 'feimage' || name === 'feturbulence' || name === 'feflood' || name === 'fetile') return [];
  if (name === 'fecomposite' || name === 'feblend' || name === 'fedisplacementmap') return ins;
  return [ins[0]];
}

/**
 * 部分領域の既定 (§9.4): 参照する結果の部分領域の和。参照が無いか、標準の入力・名前の分からない結果を参照するなら、filter の領域 full。
 * lookup は名前を付けた結果の部分領域、prev は前の要素の結果の部分領域 (in の無い要素が参照する。最初の要素なら無い)。
 * 座標は、和が座標の変換で変わらないので、要素の座標でも画素でもよい (full・lookup・prev が同じ座標なら)
 */
export function defaultSubregion(refs: Array<string | undefined>, lookup: (name: string) => Box | undefined, prev: Box | undefined, full: Box): Box {
  const subs = refs.map((r) => (r && isStandardInput(r) ? undefined : r && r.trim() ? lookup(r.trim()) : prev));
  if (!refs.length || subs.some((s) => !s)) return full;
  return subs.reduce((u, s) => {
    const x = Math.min(u!.x, s!.x);
    const y = Math.min(u!.y, s!.y);
    return { x, y, w: Math.max(u!.x + u!.w, s!.x + s!.w) - x, h: Math.max(u!.y + u!.h, s!.y + s!.h) - y };
  })!;
}

/** 部分領域の単位: primitiveUnits が objectBoundingBox (と外接矩形 bbox) か、userSpaceOnUse (と viewport の幅・高さ) か */
export type SubregionUnits = { obb: boolean; bbox?: Box; viewport?: { w: number; h: number } };

/**
 * 要素の x・y・width・height を、要素の座標で読む (書いてないものは無い)。
 * 百分率 (§9.4・§8 の primitiveUnits): objectBoundingBox なら外接矩形の割合 (50% は 0.5 と同じ)、userSpaceOnUse なら
 * 利用者の座標の長さで、基準は viewport の幅・高さ (SVG 2 §8.9 の、百分率の長さの基準)。filter の領域に対してではない
 */
export function subregionAttrs(attr: (k: string) => string | undefined, u: SubregionUnits): { x?: number; y?: number; w?: number; h?: number } {
  const obb = u.obb && !!u.bbox;
  const bb = u.bbox;
  const vw = obb ? 1 : (u.viewport?.w ?? 0);
  const vh = obb ? 1 : (u.viewport?.h ?? 0);
  const pct = (v: string, ref: number) => (/%$/.test(v.trim()) ? (parseFloat(v) / 100) * ref : parseFloat(v));
  const out: { x?: number; y?: number; w?: number; h?: number } = {};
  const sx = attr('x');
  const sy = attr('y');
  const sw = attr('width');
  const sh = attr('height');
  if (sx !== undefined) out.x = obb ? bb!.x + pct(sx, vw) * bb!.w : pct(sx, vw);
  if (sy !== undefined) out.y = obb ? bb!.y + pct(sy, vh) * bb!.h : pct(sy, vh);
  if (sw !== undefined) out.w = obb ? pct(sw, vw) * bb!.w : pct(sw, vw);
  if (sh !== undefined) out.h = obb ? pct(sh, vh) * bb!.h : pct(sh, vh);
  return out;
}
