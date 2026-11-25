/**
 * Intl.Segmenter の無い環境の、語の間に空白を書かない用字 (タイ語など。UAX #14 の SA) の折り返し: 辞書で語を分けられないので、
 * 字の単位 (書記素クラスタ) の間をすべて改行の機会にする (CSS Text 3 §5.1)。結合文字の前では分けない。
 * このファイルのワーカーでは、初めに Intl.Segmenter を外す (lineBreak.ts は言語ごとの Segmenter を初めて使うときに作る)
 */
import { describe, expect, it } from 'vitest';
import { complexContextBreaks } from '../src/lineBreak';

describe('Intl.Segmenter の無い環境のタイ語の折り返し', () => {
  it('字の単位の間すべてが境目 (結合文字の前は除く)', () => {
    const I = Intl as unknown as { Segmenter?: unknown };
    const saved = I.Segmenter;
    I.Segmenter = undefined;
    try {
      // ภาษาไทย: ภ า ษ า ไ ท ย (結合文字なし) / กี่ : ก + ี (Mn) + ่ (Mn)
      const cps = [...'ภาษาไทยกี่'].map((c) => c.codePointAt(0)!);
      const b = complexContextBreaks(cps, () => undefined)!;
      expect(b).toEqual([1, 2, 3, 4, 5, 6, 7]);
    } finally {
      I.Segmenter = saved;
    }
  });
});
