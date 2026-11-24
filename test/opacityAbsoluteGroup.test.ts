/**
 * 不透明度 (opacity) の箱の中の絶対配置の子孫を、子ごとでなく、1 つのグループとして不透明度を掛けて描く
 * (CSS Color 4 §3.2: 要素と子孫を 1 枚の絵にしてから掛ける。opacity が 1 未満の箱は重ね合わせの文脈を作り、
 * 絶対配置の子孫はその中で描く。CSS 2 付録 E・Positioned Layout 3)。PNG・PDF・SVG で、重なりが濃くならないことを確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const px = (p: PNG, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));
const near = (a: number[], b: number[], tol = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
// 300 × 225pt。288dpi で 1200 × 900 画素 (1pt = 4 画素)。赤い 20pt の箱を 2 つ、10pt ずらして重ねる
const page = '@page { size: 300pt 225pt; margin: 0 } body { margin: 0 }';
const html =
  `<style>${page} .o { opacity: 0.5 } p { position: absolute; background: #ff0000; width: 20pt; height: 20pt; margin: 0 }</style>` +
  '<div class="o"><p style="left: 100pt; top: 100pt"></p><p style="left: 110pt; top: 110pt"></p></div>';
const half = Math.round(255 * 0.5);

describe('不透明度の箱の中の絶対配置の子', () => {
  it('PNG: 重ならない所も重なりも、0.5 の赤 (重なりが濃くならない)', async () => {
    const r = await typeset(html, { kind: 'html', loadFont });
    const out = PNG.sync.read(Buffer.from(await r.renderPageToPng(0, { dpi: 288 })));
    expect(px(out, 420, 420)).toSatisfy((c: number[]) => near(c, [255, half, half], 3));
    // 前は (255, 64, 64)
    expect(px(out, 460, 460)).toSatisfy((c: number[]) => near(c, [255, half, half], 3));
  });

  it('SVG: 不透明度のグループは 1 つ', async () => {
    const r = await typeset(html, { kind: 'html', loadFont });
    const svg = await r.renderPageToSvg(0);
    expect(svg.match(/opacity="0\.5"/g) ?? []).toHaveLength(1);
  });

  it.skipIf(!hasPdftoppm)('PDF: 重なりも 0.5 の赤', async () => {
    const r = await typeset(html, { kind: 'html', loadFont });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-op-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.pdf'), await r.toPdf());
      execFileSync('pdftoppm', ['-r', '288', '-png', '-singlefile', path.join(dir, 'a.pdf'), path.join(dir, 'a')]);
      const out = PNG.sync.read(fs.readFileSync(path.join(dir, 'a.png')));
      expect(px(out, 420, 420)).toSatisfy((c: number[]) => near(c, [255, half, half], 3));
      expect(px(out, 460, 460)).toSatisfy((c: number[]) => near(c, [255, half, half], 3));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('不透明度の箱そのものが絶対配置の子なら、子ごとに掛ける (別々の箱の不透明度は、重なれば濃くなる)', async () => {
    const own =
      `<style>${page} p { position: absolute; opacity: 0.5; background: #ff0000; width: 20pt; height: 20pt; margin: 0 }</style>` +
      '<div><p style="left: 100pt; top: 100pt"></p><p style="left: 110pt; top: 110pt"></p></div>';
    const r = await typeset(own, { kind: 'html', loadFont });
    const out = PNG.sync.read(Buffer.from(await r.renderPageToPng(0, { dpi: 288 })));
    const q = Math.round(255 * 0.25);
    expect(px(out, 420, 420)).toSatisfy((c: number[]) => near(c, [255, half, half], 3));
    expect(px(out, 460, 460)).toSatisfy((c: number[]) => near(c, [255, q, q], 3));
  });
});
