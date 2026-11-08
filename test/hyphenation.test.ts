/**
 * 分綴の規則の読み込み: CSS のほか、要素の style 属性の hyphens: auto でも読み込む
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { hyphenPositions, loadDocumentHyphenators } from '../src/hyphenation';

describe('loadDocumentHyphenators', () => {
  it('style 属性の hyphens: auto でも、文書の言語の分綴の規則を読み込む', async () => {
    const { document } = parseHTML('<html lang="ja"><body><p lang="en" style="hyphens: auto">internationalization</p></body></html>');
    await loadDocumentHyphenators(document as unknown as Document, '');
    expect(hyphenPositions('internationalization', 'en')?.length).toBeGreaterThan(0);
  });
});
