/**
 * ブラウザの既定のスタイル (--style browser・browser-margin) の line-height: normal は、既定の書体 (読み込んでいない書体) でも書体の値
 * (compat.ts の BROWSER_HTML_IMPORT_OPTIONS)。
 *  - CSS Inline 3 §5.3・§6.4、CSS 2.1 §10.8.1: normal の行内の箱は、最初に使える書体の A + D + 行間 (書体の値)。代わりの書体の字は、
 *    その書体の A・D (と行間の半分) も囲む。お手本の Chromium も、書体の hhea の値で決める
 *  - ほかのスタイル (kumiori・ah・weasyprint・vivliostyle) は、既定の書体の normal を字の大きさの 1.2 倍にし、代わりの書体として使われた
 *    既定の書体は数えない (これまでどおり。1651f72 の判断)
 * 書体の値 (hhea。em に対する比): Tinos 0.891・0.216・行間 0.042 (normal 1.150)、Cousine 0.833・0.300 (1.133)、Noto Serif JP 1.151・0.286 (1.437)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

const FS = 20;
const TINOS = { a: 1825 / 2048, d: 443 / 2048, gap: 87 / 2048 };
const COUSINE = { a: 1705 / 2048, d: 615 / 2048, gap: 0 };
const JP = { a: 1.151, d: 0.286, gap: 0 };
const normal = (f: { a: number; d: number; gap: number }) => (f.a + f.d + f.gap) * FS;

interface Line { y: number; h: number; base?: number }
function linesOf(tree: AreaTree): Line[] {
  const out: Line[] = [];
  const rec = (a: Area, oy: number, line?: Line) => {
    const y = oy + (a.y ?? 0);
    let cur = line;
    if (a.type === 'line') out.push((cur = { y, h: a.height }));
    const g = a as unknown as { baselineY?: number };
    if (a.type === 'glyph' && cur) cur.base ??= y + (g.baselineY ?? 0) - cur.y;
    for (const c of childrenOf(a)) rec(c as Area, y, cur);
  };
  rec(tree.sheets[0].page.regionBody as unknown as Area, 0);
  return out;
}
type Style = 'kumiori' | 'browser' | 'browser-margin' | 'ah' | 'weasyprint' | 'vivliostyle';
const page = (body: string) =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 600pt; margin: 20pt }
body { margin: 0; font-size: ${FS}pt } p { margin: 0; text-indent: 0; text-align: left; line-height: normal }</style></head><body>${body}</body></html>`;
const html = async (body: string, style: Style) => linesOf((await typesetHtml(page(body), { loadFont: loadCachedFont, style })).areaTree);

describe('--style browser・browser-margin: line-height: normal は、既定の書体でも書体の値 (CSS Inline 3 §5.3・CSS 2.1 §10.8.1。Chromium と同じ)', () => {
  for (const style of ['browser', 'browser-margin'] as const) {
    it(`${style}: 総称の serif (最初に使える書体は Tinos) の欧文の行は、Tinos の A + D + 行間 (1.150em)。基線は行の上端から A + 行間の半分`, async () => {
      const ls = await html('<p>abc<br>abc</p>', style);
      expect(ls[0].h).toBeCloseTo(normal(TINOS), 2);
      expect(ls[1].y - ls[0].y).toBeCloseTo(normal(TINOS), 2);
      expect(ls[0].base!).toBeCloseTo((TINOS.a + TINOS.gap / 2) * FS, 2);
    });
    it(`${style}: 和文の字 (代わりの書体の Noto Serif JP) の行は、その書体の上下も囲む (1.437em)`, async () => {
      const ls = await html('<p>漢字</p>', style);
      expect(ls[0].h).toBeCloseTo(normal(JP), 1);
      expect(ls[0].base!).toBeCloseTo(JP.a * FS, 1);
    });
    it(`${style}: 総称の monospace (Cousine) の行は、Cousine の A + D (1.133em)。等幅の書体は読み込みの後で読むので、読んでから組み直す`, async () => {
      const ls = await html('<p style="font-family: monospace">abc<br>abc</p>', style);
      expect(ls[0].h).toBeCloseTo(normal(COUSINE), 2);
      expect(ls[1].y - ls[0].y).toBeCloseTo(normal(COUSINE), 2);
    });
  }
});

describe('ほかのスタイルは、これまでどおり: 既定の書体の normal は字の大きさの 1.2 倍で、代わりの書体の既定の書体は数えない', () => {
  for (const style of ['kumiori', 'ah', 'weasyprint', 'vivliostyle'] as const) {
    it(`${style}: 欧文の行・和文の行・等幅の行は、どれも 1.2em`, async () => {
      for (const body of ['<p>abc</p>', '<p>漢字</p>', '<p style="font-family: monospace">abc</p>']) {
        const ls = await html(body, style);
        expect(ls[0].h, `${style} ${body}`).toBeCloseTo(1.2 * FS, 2);
      }
    });
  }
});
