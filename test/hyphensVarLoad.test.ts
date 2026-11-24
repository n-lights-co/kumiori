/**
 * 分綴の規則を読み込むかの見分け: hyphens: auto を var() で書いたもの・注釈を挟んだもの・大文字のものも、分綴を使う文書として読み込む。
 * 前は CSS の字面 /hyphens\s*:\s*auto/ だけで決めたので、その文書を組むと、プロセスで前にほかの文書が同じ言語の規則を読み込んでいたかで、
 * 分綴されたりされなかったりした (この試験のファイルは、ほかの文書を組む前に、その文書を組む)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, walkAreaTree, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const text = 'Typesetting engines must balance typographic considerations such as justification, hyphenation, internationalization and characterization requirements. '.repeat(3);
const hyphens = (r: Awaited<ReturnType<typeof typeset>>) => {
  let n = 0;
  walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && /-$/.test((a as GlyphArea).text) && n++));
  return n;
};

describe('hyphens を var() などで書いた文書も、分綴の規則を読み込む', () => {
  // 試験の順は、var() の文書が初め (ほかの文書が規則を読み込む前)
  for (const [name, css] of [
    ['var() で書いた hyphens', ':root { --hy: auto } p { hyphens: var(--hy) }'],
    ['注釈を挟んだ hyphens', 'p { hyphens:/**/auto }'],
  ] as const)
    it(name, async () => {
      const r = await typeset(`<html lang="en"><head><style>@page { size: 120pt 600pt; margin: 10pt } ${css} p { text-align: justify }</style></head><body><p>${text}</p></body></html>`, { loadFont: loadCachedFont });
      expect(hyphens(r)).toBeGreaterThan(0);
    });
});
