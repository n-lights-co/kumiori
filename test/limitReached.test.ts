/**
 * 上限 (limits) に当たって、入力を切った・近似したことを、上限の名前ごとに 1 件の診断 limit/reached (警告) で知らせる。
 * 上限を下げた利用者が、何が切られたかを知れるように。既定の上限で、ふつうの文書には出ない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetHtml, typesetToPdf, type FontSpec, type TypesetResult } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const page = (css: string, body: string) => `<!DOCTYPE html><html><head><title>t</title><style>${css}</style></head><body>${body}</body></html>`;
const reached = (r: { diagnostics: TypesetResult['diagnostics'] }) => r.diagnostics.filter((d) => d.code === 'limit/reached').map((d) => [d.severity, d.args, d.count ?? 1]);

describe('limit/reached', () => {
  const grid = page('.g { display: grid; grid-template-columns: repeat(20, 1fr) }', '<div class="g"><div>a</div><div>b</div></div><div class="g"><div>c</div></div>');
  it('grid の列の並びを上限で切ったら、名前ごとに 1 件', async () => {
    const r = await typesetHtml(grid, { loadFont, limits: { gridTracks: 5 } });
    expect(reached(r)).toEqual([['warning', { limit: 'gridTracks', value: 5 }, 1]]);
    expect(r.warnings.some((w) => /gridTracks \(5\)/.test(w))).toBe(true);
  });
  it('既定の上限では出ない', async () => {
    expect(reached(await typesetHtml(grid, { loadFont }))).toEqual([]);
  });
  it('PDF に書く道筋 (typesetToPdf) でも出し、ignore で出さない', async () => {
    expect(reached(await typesetToPdf(grid, { kind: 'html', loadFont, limits: { gridTracks: 5 } }))).toEqual([['warning', { limit: 'gridTracks', value: 5 }, 1]]);
    expect(reached(await typesetHtml(grid, { loadFont, limits: { gridTracks: 5 }, diagnostics: { ignore: ['limit/reached'] } }))).toEqual([]);
  });
  it('入れ子の規則の展開・表の colspan・リーダー', async () => {
    const html = page(
      '.a, .b, .c { & .x, & .y, & .z { color: red } } p.l::after { content: leader(dotted) }',
      '<table><tr><td colspan="8">a</td></tr><tr><td>b</td></tr></table><p class="l">x</p>',
    );
    const r = await typesetHtml(html, { loadFont, limits: { nestedSelectors: 4, tableColumns: 4, leaderRepeats: 2 } });
    expect(reached(r).map((x) => (x[1] as { limit: string }).limit)).toEqual(['leaderRepeats', 'nestedSelectors', 'tableColumns']);
  });
});
