// アンテナハウスの拡張 -ah-text-justify-trim (CSS)・axf:text-justify-trim (XSL-FO) の値を読む。
// 接頭辞・名前空間の付いた拡張なので、互換の指定に関わらず、どのモードでも読む (CLAUDE.md)。
// 値と意味は、アンテナハウスの公開の説明 (AH Formatter の「XSL/CSS 拡張仕様」の axf:text-justify-trim) による:
//   none | [ punctuation || punctuation-except-fullstop || punctuation-except-middledot || [ kana | ideograph ] || inter-word ] | auto
//   (初期値 auto。継承する)。両端揃えで、指定のアキを詰めて字を行に収める。
// 詰める量の上限は、説明に書かれていないので、JLREQ §3.8.3 の追込みと同じく、約物のアキをベタ組まで (行あたりの上限は lineSqueezeMax)。
// 見本の PDF (CSS-Print 第 4 版。原文は body:lang(ja) { -ah-text-justify-trim: punctuation }) では、行中の句点「．」の後ろも、
// 読点と同じ割合で詰めている。
import type { TextJustifyTrim } from './types';

/** auto (初期値): 既定の詰め方 (JLREQ §3.8.3。行中の句点類の後ろは詰めない)。祖先の指定を打ち消すときに使う */
export const AUTO_JUSTIFY_TRIM: TextJustifyTrim = { punctuation: true, fullStop: false, middleDot: true, interWord: false };

/**
 * 値を読む。auto は AUTO_JUSTIFY_TRIM (既定の詰め方)。読めない語 (kana・ideograph は未対応) は unsupported に返す。
 * 値として正しくない (語が空・知らない語) ときは invalid
 */
export function parseTextJustifyTrim(v: string): { trim?: TextJustifyTrim; unsupported: string[]; invalid?: boolean } {
  const toks = v.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const known = ['none', 'auto', 'punctuation', 'punctuation-except-fullstop', 'punctuation-except-middledot', 'kana', 'ideograph', 'inter-word'];
  if (toks.length === 0 || toks.some((t) => !known.includes(t))) return { unsupported: [], invalid: true };
  if (toks.length === 1 && toks[0] === 'auto') return { trim: AUTO_JUSTIFY_TRIM, unsupported: [] };
  if (toks.length === 1 && toks[0] === 'none') return { trim: { punctuation: false, fullStop: false, middleDot: false, interWord: false }, unsupported: [] };
  if (toks.includes('auto') || toks.includes('none')) return { unsupported: [], invalid: true };
  const has = (t: string) => toks.includes(t);
  const p = has('punctuation'), exF = has('punctuation-except-fullstop'), exM = has('punctuation-except-middledot');
  const punctuation = p || exF || exM;
  // 句点・中点を除く語だけのときは、それを除く。punctuation と一緒なら、punctuation が広い (除かない)
  return {
    trim: { punctuation, fullStop: punctuation && (p || !exF), middleDot: punctuation && (p || !exM), interWord: has('inter-word') },
    unsupported: toks.filter((t) => t === 'kana' || t === 'ideograph'),
  };
}
