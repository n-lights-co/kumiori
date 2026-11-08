import { describe, expect, it } from 'vitest';
import { trimMarkLines } from '../src/paint';
import type { SheetArea } from '../src/types';

const MM = 72 / 25.4;
const r = (v: number) => Math.round(v * 100) / 100;

describe('トンボの形', () => {
  // 仕上がり 100mm 角、塗り足し 3mm、トンボの余白 (仕上がりから紙の端まで) 14mm
  const trim = { x: 14 * MM, y: 14 * MM, width: 100 * MM, height: 100 * MM };
  const sheet = { trimBox: trim, bleed: 3 * MM, trimMarkMargin: 11 * MM } as unknown as SheetArea;
  const lines = trimMarkLines(sheet).map((l) => [l.x1, l.y1, l.x2, l.y2].map(r));

  it('角: 線は塗り足しの端から外へ 10mm。塗り足しの線は仕上がりの線の位置まで伸ばして L 字につなぐ', () => {
    const [cx, cy, b] = [trim.x, trim.y, 3 * MM];
    const out = cx - b - 10 * MM; // 外の端 (紙の端から 1mm)
    // 左上の角
    expect(lines).toContainEqual([cx - b, cy, out, cy].map(r)); // 仕上がりの横線
    expect(lines).toContainEqual([cx, cy - b, out, cy - b].map(r)); // 塗り足しの横線 (仕上がりの縦線の位置から)
    expect(lines).toContainEqual([cx, cy - b, cx, out].map(r)); // 仕上がりの縦線
    expect(lines).toContainEqual([cx - b, cy, cx - b, out].map(r)); // 塗り足しの縦線 (仕上がりの横線の位置から)
  });

  it('センター: 中心線は塗り足しの端から外へ 10mm、十字の棒は塗り足しの幅だけ外に長さ 20mm', () => {
    const mx = trim.x + trim.width / 2;
    const yEdge = trim.y - 3 * MM;
    expect(lines).toContainEqual([mx, yEdge, mx, yEdge - 10 * MM].map(r));
    expect(lines).toContainEqual([mx - 10 * MM, yEdge - 3 * MM, mx + 10 * MM, yEdge - 3 * MM].map(r));
  });

  it('トンボの余白が 10mm より狭いときは、紙の端まで', () => {
    const narrow = trimMarkLines({ ...sheet, trimMarkMargin: 5 * MM } as SheetArea).map((l) => [l.x1, l.y1, l.x2, l.y2].map(r));
    expect(narrow).toContainEqual([trim.x - 3 * MM, trim.y, trim.x - 8 * MM, trim.y].map(r));
  });
});
