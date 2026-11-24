/**
 * SVG の中の参照の数が多いときの手間と、警告の大きさ。
 * - インラインの svg は、SVG の全体の data: の URL の画像になる。見つからない参照ごとの警告の文と args に、その URL を切らずに入れると、
 *   参照の数 × SVG の大きさ (数の 2 乗) の字になった (違う参照 2,000 個で 78 秒)。src・href を 200 字で切り、1 つの SVG の分は 20 件までを
 *   1 件ずつ、残りを数だけの 1 件にまとめる
 * - 参照を集める所 (svgImageRefs) と、見つからない参照を集める所の重なりの確かめを Set にする (配列の includes では数の 2 乗)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset } from '../src/index';
import { svgImageRefs } from '../src/documentResources';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('SVG の中の参照が多いとき', () => {
  it('違う href の image を 2,000 個持つインラインの svg: 警告は 21 件で、文の長さは SVG の大きさによらない', async () => {
    const images = Array.from({ length: 2000 }, (_, i) => `<image href="pics/${i}.png" width="1" height="1"/>`).join('');
    const html = `<p>x</p><svg width="10" height="10">${images}</svg>`;
    const t = performance.now();
    const r = await typeset(html, { loadFont: loadCachedFont, fetchImages: false });
    const ms = performance.now() - t;
    const refs = r.diagnostics.filter((d) => d.code === 'image/reference-not-found');
    expect(refs).toHaveLength(21);
    expect(refs[20].args).toMatchObject({ count: 1980, href: '' });
    for (const d of refs) expect(d.message.length).toBeLessThan(800);
    expect(r.warnings.reduce((a, w) => a + w.length, 0)).toBeLessThan(50_000);
    // 前は 78 秒 (この機械で)。字の量が数に比例するだけなら数秒
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it('svgImageRefs: 違う href を 4 万個持つ SVG (約 2MB) でも 1 秒ほどで返し、重なりは 1 つにする', () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: 40_000 }, (_, i) => `<image href="http://example.com/img/${i}.png"/>`).join('')}<image href="http://example.com/img/0.png"/></svg>`;
    const t = performance.now();
    const refs = svgImageRefs(text);
    expect(performance.now() - t).toBeLessThan(2_000);
    expect(refs).toHaveLength(40_000);
    expect(refs[0]).toBe('http://example.com/img/0.png');
  });
});
