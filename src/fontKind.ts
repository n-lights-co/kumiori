/**
 * 書体の種類 (明朝・ゴシックなど) を、OpenType の OS/2 の表の値と名前から決める。OS の書体を後備に使うとき (systemFonts) に、
 * 指定の書体と同じ種類の OS の書体を先に使うため (OS の書体の部品 nodeSystemFonts.ts と、組版の書体の組 fontManager.ts が使う)。
 *  - serif: 明朝・セリフ体、sans: ゴシック・サンセリフ体、other: 手書き・装飾・記号の書体、unknown: 決まらない
 */
import type { SystemFontKind } from './types';

/** 書体の種類を決めるのに使う値 */
export interface FontKindHints {
  /** OS/2 の panose (10 バイト。無ければ空) */
  panose?: readonly number[];
  /** OS/2 の sFamilyClass (上の 1 バイトが類、下の 1 バイトが細かい類) */
  familyClass?: number;
  /** ファミリー名 */
  family?: string;
}

const SANS_NAME = /ゴシック|gothic|\bsans\b|sans[- ]?serif|\bhei\b|heiti|黑体|黒体|gulim|dotum|굴림|돋움|고딕/i;
const SERIF_NAME = /明朝|mincho|\bserif\b|\bsong\b|songti|宋体|\bming\b|mingliu|batang|myeongjo|바탕|명조/i;

/**
 * 書体の種類。次の順に見て、最初に決まったもの:
 *  1. PANOSE (OpenType 1.9 の OS/2 の panose。PANOSE 2.0 の分類): bFamilyType が 2 (Latin Text) なら、bSerifStyle が 2〜10 (Cove〜Triangle) は serif、
 *     11〜15 (Normal Sans〜Rounded) は sans。bFamilyType が 3 (Latin Hand Written)・4 (Latin Decoratives)・5 (Latin Symbol) は other。0・1 (Any・No Fit) は決めない
 *  2. sFamilyClass (OpenType 1.9 の Family Class IDs。上の 1 バイトの類): 1〜5・7 は serif、8 (Sans Serif) は sans、9 (Ornamentals)・10 (Scripts)・12 (Symbolic) は other
 *  3. ファミリー名の手がかり (CJK の書体は PANOSE も sFamilyClass も 0 のものが多いため): ゴシック・Gothic・Sans・Hei など は sans、
 *     明朝・Mincho・Serif・Song・Ming・Batang など は serif ("Sans Serif" は Sans を先に見る)
 */
export function classifyFontKind(h: FontKindHints): SystemFontKind {
  const p = h.panose ?? [];
  if (p.length >= 1) {
    const [family, serif = 0] = p;
    if (family === 2) {
      if (serif >= 2 && serif <= 10) return 'serif';
      if (serif >= 11 && serif <= 15) return 'sans';
    } else if (family >= 3 && family <= 5) return 'other';
  }
  const cls = ((h.familyClass ?? 0) >> 8) & 0xff;
  if ((cls >= 1 && cls <= 5) || cls === 7) return 'serif';
  if (cls === 8) return 'sans';
  if (cls === 9 || cls === 10 || cls === 12) return 'other';
  const name = h.family ?? '';
  if (SANS_NAME.test(name)) return 'sans';
  if (SERIF_NAME.test(name)) return 'serif';
  return 'unknown';
}

/**
 * 指定の書体の種類 want に対する、後備の書体の種類 kind の順位 (小さいほど先): 同じ種類 → unknown → serif と sans の残りの方 → other。
 * want が unknown・other なら serif として扱う (Kumiori の既定の書体が明朝のため)
 */
export function kindRank(want: SystemFontKind, kind: SystemFontKind): number {
  const w = want === 'sans' ? 'sans' : 'serif';
  if (kind === w) return 0;
  if (kind === 'unknown') return 1;
  if (kind === 'other') return 3;
  return 2;
}
