import { describe, expect, it } from 'vitest';
import { chromiumLaunchOptions } from '../scripts/chromium.mjs';

/** e2e と比較のスクリプトが Chromium を起こすときの指定 (scripts/chromium.mjs。PKG-26) */
describe('chromiumLaunchOptions', () => {
  it('KUMIORI_CHROMIUM を指さないときは空 (Playwright の取った Chromium を使う)', () => {
    expect(chromiumLaunchOptions({})).toEqual({});
    expect(chromiumLaunchOptions({ KUMIORI_CHROMIUM: '' })).toEqual({});
    expect(chromiumLaunchOptions({ KUMIORI_CHROMIUM: '  ' })).toEqual({});
  });
  it('KUMIORI_CHROMIUM を指すと、その実行ファイルを executablePath に渡す', () => {
    expect(chromiumLaunchOptions({ KUMIORI_CHROMIUM: '/opt/pw-browsers/chromium' })).toEqual({ executablePath: '/opt/pw-browsers/chromium' });
  });
});
