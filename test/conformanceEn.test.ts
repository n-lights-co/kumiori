/**
 * 対応仕様説明書の英語版 (docs/conformance の .en.fo・.en.html。見本は日本語版と同じで、本文を英語にしたもの) の見本の 1 つずつと文書の全体を組む
 * (中身は test/conformanceSuite.ts。日本語版は test/conformance.test.ts)。指紋は test/fingerprints/conformance-en.json
 */
import { conformanceSuite } from './conformanceSuite';

conformanceSuite(
  [
    { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.en.fo' },
    { kind: 'html', dir: 'html', file: 'kumiori-html-css.en.html' },
  ],
  'conformance-en',
);
