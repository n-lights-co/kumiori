/**
 * 論理座標 (inline / block) ↔ 物理座標 (x / y) の変換。
 *
 *  horizontal-tb : inline = →(x+), block = ↓(y+)
 *  vertical-rl   : inline = ↓(y+), block = ←(x-)  (行は右から左へ積む)
 *  vertical-lr   : inline = ↓(y+), block = →(x+)  (行は左から右へ積む)
 *
 * レイアウトは常に論理座標で行い、サイズ確定後に 1 回だけ物理化する。
 * これにより「縦書きでは親の幅が確定するまで子の x が決まらない」問題を回避できる。
 */
import type { BorderInput, BorderSide, BorderStyle, Edges, EdgesInput, WritingMode } from './types';

export interface LEdges {
  /** block-start / block-end / inline-start / inline-end */
  bs: number;
  be: number;
  is: number;
  ie: number;
}

export const zeroEdges = (): Edges => ({ top: 0, right: 0, bottom: 0, left: 0 });

export function normEdges(v: EdgesInput | undefined): Edges {
  if (v === undefined) return zeroEdges();
  if (typeof v === 'number') return { top: v, right: v, bottom: v, left: v };
  return { top: v.top ?? 0, right: v.right ?? 0, bottom: v.bottom ?? 0, left: v.left ?? 0 };
}

export function normBorder(v: BorderInput | undefined): BorderStyle {
  if (!v) return {};
  if ('width' in v && 'color' in v && typeof (v as BorderSide).width === 'number') {
    const s = v as BorderSide;
    return s.width > 0 ? { top: s, right: s, bottom: s, left: s } : {};
  }
  const o = v as Partial<Record<keyof Edges, BorderSide>>;
  const out: BorderStyle = {};
  for (const k of ['top', 'right', 'bottom', 'left'] as const) if (o[k] && o[k]!.width > 0) out[k] = o[k];
  return out;
}

export const borderWidths = (b: BorderStyle): Edges => ({
  top: b.top?.width ?? 0,
  right: b.right?.width ?? 0,
  bottom: b.bottom?.width ?? 0,
  left: b.left?.width ?? 0,
});

export function toLogical(e: Edges, wm: WritingMode): LEdges {
  if (wm === 'horizontal-tb') return { bs: e.top, be: e.bottom, is: e.left, ie: e.right };
  if (wm === 'vertical-lr') return { bs: e.left, be: e.right, is: e.top, ie: e.bottom };
  return { bs: e.right, be: e.left, is: e.top, ie: e.bottom };
}

export function toPhysicalEdges(l: LEdges, wm: WritingMode): Edges {
  if (wm === 'horizontal-tb') return { top: l.bs, bottom: l.be, left: l.is, right: l.ie };
  if (wm === 'vertical-lr') return { left: l.bs, right: l.be, top: l.is, bottom: l.ie };
  return { right: l.bs, left: l.be, top: l.is, bottom: l.ie };
}

export function borderToLogicalWidths(b: BorderStyle, wm: WritingMode): LEdges {
  return toLogical(borderWidths(b), wm);
}

/** 物理サイズ ← 論理サイズ */
export function physSize(isize: number, bsize: number, wm: WritingMode): { width: number; height: number } {
  return wm === 'horizontal-tb' ? { width: isize, height: bsize } : { width: bsize, height: isize };
}

/**
 * 親 content-box (物理幅 PW) の中での子の物理 (x, y)。
 * i, b: 親の書字方向における子 border-box の inline-start / block-start オフセット
 * pw: 子の物理幅 (vertical-rl で右端から折り返すのに使う。高さは要らない)
 */
export function physPos(
  parentWm: WritingMode,
  PW: number,
  i: number,
  b: number,
  pw: number,
): { x: number; y: number } {
  if (parentWm === 'horizontal-tb') return { x: i, y: b };
  if (parentWm === 'vertical-lr') return { x: b, y: i };
  return { x: PW - b - pw, y: i };
}
