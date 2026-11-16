/**
 * drawioText — draw.io の図の文字の幅 (ラベルの折り返し・文字の背景の枠・モックアップのボタンの幅など)。
 * draw.io は画面の上で、書体で測る (mxUtils.getSizeForString・HTML のラベルの折り返し)。Kumiori は、描く側が渡す測り方
 * (DrawioMeasure。Node は文書の書体で SVG の文字を描くときと同じ書体 (pdfRenderer.ts の svgTextWidth)、画面はブラウザの canvas) で測る。
 * 測り方が無いとき・測れないときは見積もる (ASCII などの WinAnsi の字は Helvetica の字の幅 (PDF の標準 14 書体の幅。pdf-lib の表)、
 * 全角の字は 1em、そのほかは 0.6em)。
 * 描く処理 (drawio.ts の render) は同期なので、測り方は描く間だけ withMeasure で決める (drawioJs の形の中からも textWidth で使う)
 */

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

/** 測る文字の書体 */
export interface DrawioFont {
  /** 書体の名前 (fontFamily の最初の名前。Helvetica など) */
  family: string;
  /** 字の大きさ (px) */
  size: number;
  bold: boolean;
  italic: boolean;
}

/** 文字の幅 (px) を測る。測れなければ undefined (見積もる) */
export type DrawioMeasure = (text: string, font: DrawioFont) => number | undefined;

let current: { measure: DrawioMeasure; cache: Map<string, number> } | undefined;

/** 描く間 (fn の間) だけ、測り方を measure にする (入れ子にできる) */
export function withMeasure<T>(measure: DrawioMeasure | undefined, fn: () => T): T {
  const prev = current;
  current = measure ? { measure, cache: new Map() } : undefined;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** 測り方で測った 1 px あたりの幅を覚える数の上限 */
const CACHE_MAX = 20000;

/** 文字の幅 (px)。測り方があれば測る (大きさ 1 あたりで覚える)。無ければ、測れなければ見積もる */
export function textWidth(text: string, size: number, family = 'Helvetica', bold = false, italic = false): number {
  if (!text || !(size > 0)) return 0;
  if (current) {
    const key = `${bold ? 'b' : 'r'}${italic ? 'i' : 'n'}${family}\0${text}`;
    const hit = current.cache.get(key);
    if (hit !== undefined) return hit * size;
    let w: number | undefined;
    try {
      // 大きさ 100 で測って割る (字の大きさに比例するとして覚える。小さすぎる大きさの丸めを避ける)
      const m = current.measure(text, { family, size: 100, bold, italic });
      w = m !== undefined && Number.isFinite(m) && m >= 0 ? m / 100 : undefined;
    } catch {
      w = undefined;
    }
    if (w !== undefined) {
      if (current.cache.size < CACHE_MAX) current.cache.set(key, w);
      return w * size;
    }
  }
  let em = 0;
  for (const ch of text) em += estimateChar(ch, bold);
  return em * size;
}

let helv: { r: StandardFontEmbedder; b: StandardFontEmbedder } | undefined;
const estimates = new Map<string, number>();

/** 字の幅の見積もり (em)。ASCII などの WinAnsi の字は Helvetica の幅、全角の字は 1、そのほかは 0.6 */
export function estimateChar(ch: string, bold: boolean): number {
  const key = (bold ? 'b' : 'r') + ch;
  const hit = estimates.get(key);
  if (hit !== undefined) return hit;
  const cp = ch.codePointAt(0)!;
  let w: number;
  if (isWide(cp)) w = 1;
  else if (cp < 0x2000) {
    // (StandardFonts の値は、standard-fonts の FontNames と同じ名前の文字。型だけが別なので直す)
    const font = (n: StandardFonts) => StandardFontEmbedder.for(n as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
    helv ??= { r: font(StandardFonts.Helvetica), b: font(StandardFonts.HelveticaBold) };
    try {
      w = (bold ? helv.b : helv.r).widthOfTextAtSize(cp === 0xa0 ? ' ' : ch, 1000) / 1000;
    } catch {
      w = 0.6;
    }
  } else w = 0.6;
  if (estimates.size < 4096) estimates.set(key, w);
  return w;
}

/** 全角の字 (Unicode の East Asian Width の W・F のおもな範囲。UAX #11) */
export const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
