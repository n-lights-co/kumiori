/**
 * textMeasure — 文書を作らずに文字列を測る (Typesetter.measureText・breakLines)。
 *
 * 組版の結果と食い違わないように、測るための仕組みを別に作らず、文字列を 1 つのブロック (HTML の div) だけの文書にして、
 * 同じ Typesetter (同じフォント・同じ組版の処理) で組み、できた行の領域を読む。行分け (禁則・ぶら下げ・ハイフネーション・字間の調整)、
 * フォントの選び方 (足りない文字のフォールバック)、カーニング・合字は、文書の中で同じ文字列・同じスタイルを組んだときと同じになる。
 * 指定の無いプロパティは、Kumiori の HTML の既定のスタイル (htmlPrepare.ts の KUMIORI_BOOK_CSS: 10pt・line-height 1.75・serif・
 * text-align: justify・hanging-punctuation: allow-end) の本文と同じ。段落の字下げ (p の text-indent: 1em) は付けない (textIndent で付ける)。
 * ページは行の長さ (width) の幅で、余白は 0。測った値の単位は pt (領域の木と同じ)。
 */
import { childrenOf, type AreaNode } from './areaTree';
import { KumioriOptionError } from './errors';
import { msg } from './messages';

/**
 * 測る文字列のスタイル (CSS のプロパティの一部。名前は CSS のプロパティを camelCase にしたもの)。値は CSS の値の文字列で、
 * 長さは数でも書ける (pt。fontSize・letterSpacing・wordSpacing・textIndent)。lineHeight の数は CSS と同じく倍率 (字の大きさに掛ける)。
 * fontWeight の数は CSS の太さ (400・700 など)。lang は言語のタグ (ja・en など。HTML の lang と同じに、禁則・ハイフネーション・字形の選び方に効く)。
 * フォントは、Typesetter を作ったときに読み込んだもの (既定のフォント・fonts・systemFonts) から選ぶ (@font-face は使えない)。
 * 1.0 までに形を変えることがある
 */
export interface TextStyle {
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: number | string;
  fontStyle?: string;
  fontStretch?: string;
  fontKerning?: string;
  fontFeatureSettings?: string;
  fontVariantEastAsian?: string;
  letterSpacing?: number | string;
  wordSpacing?: number | string;
  lineHeight?: number | string;
  lang?: string;
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
  textOrientation?: string;
  direction?: 'ltr' | 'rtl';
  textAlign?: string;
  textAlignLast?: string;
  textJustify?: string;
  textIndent?: number | string;
  whiteSpace?: string;
  wordBreak?: string;
  lineBreak?: string;
  overflowWrap?: string;
  hyphens?: string;
  hangingPunctuation?: string;
  textSpacingTrim?: string;
  textAutospace?: string;
}

/** 測った 1 行 */
export interface MeasuredLine {
  /** 行の文字 (組んだ順。行末で語を分けたときのハイフンを含み、行の初め・終わりで除いた空白は含まない) */
  text: string;
  /**
   * 行の中身の、行の進む方向 (横書きは横、縦書きは縦) の長さ (pt)。最初の文字の始まりから最後の文字の終わりまで
   * (字間・カーニング・ぶら下げた約物を含む)。両端揃え (text-align: justify) の、最後でない行は、行の長さ (width) いっぱいになる
   */
  inlineSize: number;
  /** 行の高さ (pt。行の並ぶ方向の長さ。line-height で決まる。縦書きでは行の幅) */
  blockSize: number;
}

/** measureText・breakLines の結果 */
export interface MeasuredText {
  /** 行の数 */
  lineCount: number;
  /** いちばん長い行の inlineSize (pt) */
  inlineSize: number;
  /** 行の blockSize の合計 (pt。全体の高さ。縦書きでは全体の幅) */
  blockSize: number;
  /** 紙の上の幅 (pt。横書きは inlineSize、縦書きは blockSize) */
  width: number;
  /** 紙の上の高さ (pt。横書きは blockSize、縦書きは inlineSize) */
  height: number;
  /** breakLines で、行の長さ (width) を超えた行があるか (分けられない長い語・ぶら下げなど)。measureText では false */
  overflow: boolean;
  /** 行 (並ぶ順) */
  lines: MeasuredLine[];
}

/** 長さを書けるプロパティ (数は pt) */
const LENGTHS = new Set(['fontSize', 'letterSpacing', 'wordSpacing', 'textIndent']);
/** プロパティの名前 (TextStyle のキー) */
const STYLE_KEYS = new Set<string>([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontKerning',
  'fontFeatureSettings',
  'fontVariantEastAsian',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'lang',
  'writingMode',
  'textOrientation',
  'direction',
  'textAlign',
  'textAlignLast',
  'textJustify',
  'textIndent',
  'whiteSpace',
  'wordBreak',
  'lineBreak',
  'overflowWrap',
  'hyphens',
  'hangingPunctuation',
  'textSpacingTrim',
  'textAutospace',
]);

/** 行の長さの上限 (pt。PDF のページの大きさの上限 200 インチ。ISO 32000-2 の附属書 C) */
export const MAX_MEASURE_LENGTH = 14400;

const bad = (ja: string, en: string, option: string) => new KumioriOptionError(msg(`選択肢の誤り: ${ja}`, `invalid option: ${en}`), option);

/** 測る文字列と、スタイル・行の長さを確認する (エラーは KumioriOptionError) */
export function checkMeasureArgs(text: unknown, style: unknown, width?: unknown): asserts style is TextStyle {
  if (typeof text !== 'string') throw bad('text は文字列にしてください', 'text must be a string', 'text');
  if (typeof style !== 'object' || style === null || Array.isArray(style)) throw bad('style はオブジェクトにしてください', 'style must be an object', 'style');
  for (const [k, v] of Object.entries(style)) {
    if (!STYLE_KEYS.has(k)) throw bad(`style の ${k} は使えません (${[...STYLE_KEYS].join('・')})`, `style.${k} is not supported (${[...STYLE_KEYS].join(', ')})`, `style.${k}`);
    if (v === undefined) continue;
    if (typeof v === 'number') {
      if (!(LENGTHS.has(k) || k === 'lineHeight' || k === 'fontWeight') || !Number.isFinite(v)) throw bad(`style.${k} の値 ${v} は使えません`, `style.${k} cannot be ${v}`, `style.${k}`);
      continue;
    }
    if (typeof v !== 'string') throw bad(`style.${k} は文字列${LENGTHS.has(k) || k === 'lineHeight' || k === 'fontWeight' ? 'か数' : ''}にしてください`, `style.${k} must be a string${LENGTHS.has(k) || k === 'lineHeight' || k === 'fontWeight' ? ' or a number' : ''}`, `style.${k}`);
    // CSS の宣言の外に出る字 (; { } < >・\)・コメント・url() は使えない (ほかのプロパティや規則を書き足せないように)
    if (k === 'lang' ? !/^[A-Za-z0-9-]{1,64}$/.test(v) : /[;{}<>\\]|\/\*|url\s*\(|@import/i.test(v) || v.length > 1000)
      throw bad(`style.${k} の値 ${JSON.stringify(v.slice(0, 100))} は使えません`, `style.${k} cannot be ${JSON.stringify(v.slice(0, 100))}`, `style.${k}`);
  }
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > MAX_MEASURE_LENGTH))
    throw bad(`width は 0 より大きく ${MAX_MEASURE_LENGTH} 以下の数 (pt) にしてください`, `width must be a number (pt) greater than 0 and at most ${MAX_MEASURE_LENGTH}`, 'width');
}

/** camelCase の名前を CSS のプロパティの名前にする */
const cssName = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 測るための HTML の文書。width があれば、その長さで行を分ける (breakLines)。無ければ行を分けない (measureText。white-space の
 * 改行を残す指定の改行だけで分ける)
 */
export function measureDocument(text: string, style: TextStyle, width?: number): string {
  const vertical = style.writingMode === 'vertical-rl' || style.writingMode === 'vertical-lr';
  const decls: string[] = [];
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || k === 'lang' || k === 'writingMode') continue;
    let value = typeof v === 'number' ? (LENGTHS.has(k) ? `${v}pt` : String(v)) : v;
    // 行を分けない (measureText): 空白をまとめる指定は nowrap に、改行を残して行も分ける指定は、改行を残して行を分けない pre にする
    if (k === 'whiteSpace' && width === undefined) value = /^(pre-wrap|break-spaces|pre)$/.test(value.trim()) ? 'pre' : /^pre-line$/.test(value.trim()) ? 'pre-line' : 'nowrap';
    decls.push(`${cssName(k)}: ${value}`);
  }
  if (width === undefined && style.whiteSpace === undefined) decls.push('white-space: nowrap');
  if (style.textIndent === undefined) decls.push('text-indent: 0');
  const length = width ?? MAX_MEASURE_LENGTH;
  // 行の長さは、横書きではページの幅、縦書きではページの高さ。行の並ぶ方向は、上限の長さ (行が多ければ次のページへ続く)
  const size = vertical ? `${MAX_MEASURE_LENGTH}pt ${length}pt` : `${length}pt ${MAX_MEASURE_LENGTH}pt`;
  const lang = style.lang ? ` lang="${escapeHtml(style.lang)}"` : '';
  const wm = style.writingMode ? ` writing-mode: ${style.writingMode};` : '';
  return (
    `<!DOCTYPE html><html${lang}><head><style>@page { size: ${size}; margin: 0; @bottom-center { content: none } } html {${wm} } html, body { margin: 0; padding: 0 }</style></head>` +
    `<body><div style="${escapeHtml(decls.join('; '))}">${escapeHtml(text)}</div></body></html>`
  );
}

/** 領域の木の、行の領域を読んで、測った結果にする */
export function measuredLines(sheets: readonly AreaNode[], vertical: boolean, width?: number): MeasuredText {
  const lines: MeasuredLine[] = [];
  const visit = (a: AreaNode) => {
    if (a.type === 'line') {
      lines.push(lineOf(a, vertical));
      return;
    }
    for (const c of childrenOf(a)) visit(c);
  };
  for (const s of sheets) visit(s);
  const inlineSize = lines.reduce((m, l) => Math.max(m, l.inlineSize), 0);
  const blockSize = lines.reduce((n, l) => n + l.blockSize, 0);
  return {
    lineCount: lines.length,
    inlineSize,
    blockSize,
    width: vertical ? blockSize : inlineSize,
    height: vertical ? inlineSize : blockSize,
    // 計算の誤差 (1/1000 pt) は超えたと見ない
    overflow: width !== undefined && lines.some((l) => l.inlineSize > width + 1e-3),
    lines,
  };
}

/** 1 つの行の領域: 文字の領域 (glyph) の始まりと終わり (行の進む方向) と文字 */
function lineOf(line: AreaNode, vertical: boolean): MeasuredLine {
  let start = Infinity;
  let end = -Infinity;
  let text = '';
  const walk = (a: AreaNode, x: number, y: number) => {
    for (const c of childrenOf(a)) {
      const cx = x + c.x;
      const cy = y + c.y;
      if (c.type === 'glyph') {
        const s = vertical ? cy : cx;
        const e = s + (vertical ? c.height : c.width);
        if (s < start) start = s;
        if (e > end) end = e;
        text += (c as AreaNode & { text?: string }).text ?? '';
      } else walk(c, cx, cy);
    }
  };
  walk(line, 0, 0);
  return { text, inlineSize: end > start ? end - start : 0, blockSize: vertical ? line.width : line.height };
}
