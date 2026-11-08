/**
 * OS/2 の表 (typo の値) の無い書体の基準線の位置: hhea の上下 (A・D) で、CSS 2.1 §10.8.1 と同じ位置
 * (行の上端から LH/2 + (A − D)/2) になる比 0.5 + (A − D)/2 を使う
 */
import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { FontManager } from '../src/fontManager';
import { fontBuffer } from './helpers';

/** 表の並びの 'OS/2' の名前を別の名前に書き換えて、OS/2 の表の無い書体にする */
function withoutOs2(buf: ArrayBuffer): ArrayBuffer {
  const out = buf.slice(0);
  const v = new DataView(out);
  const n = v.getUint16(4);
  for (let k = 0; k < n; k++) {
    const at = 12 + 16 * k;
    if (String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3)) === 'OS/2') {
      'zzzz'.split('').forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    }
  }
  return out;
}

describe('OS/2 の表の無い書体', () => {
  it('基準線の比は 0.5 + (hhea の上 − 下) / 2', async () => {
    const buf = withoutOs2(await fontBuffer());
    const fk = fontkit.create(new Uint8Array(buf)) as unknown as { ascent: number; descent: number; unitsPerEm: number; 'OS/2'?: { typoAscender?: number } };
    expect(typeof fk['OS/2']?.typoAscender).not.toBe('number');
    const fm = new FontManager();
    const lf = await fm.registerBuffer('NoOs2', 400, buf, false);
    expect(lf.baselineRatio).toBeCloseTo(0.5 + (fk.ascent + fk.descent) / (2 * fk.unitsPerEm), 6);
  });
});
