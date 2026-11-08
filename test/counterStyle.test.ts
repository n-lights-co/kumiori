import { describe, expect, it } from 'vitest';
describe('手順で作る定義済みの数え方 (CSS Counter Styles 3 §7.1.3・§7.2)', () => {
  it('中国語の書式は仕様書の表のとおり', async () => {
    const { complexCounterText } = await import('../src/counterStylePredefined');
    const t = (n: number) => complexCounterText('simp-chinese-informal', n);
    expect([0, 1, 10, 11, 99, 100, 101, 110, 120, 6001].map(t)).toEqual(['零', '一', '十', '十一', '九十九', '一百', '一百零一', '一百一十', '一百二十', '六千零一']);
    expect(complexCounterText('simp-chinese-formal', 6001)).toBe('陆仟零壹');
    expect(complexCounterText('trad-chinese-formal', 11)).toBe('壹拾壹');
    expect(complexCounterText('trad-chinese-informal', -3)).toBe('負三');
    expect(complexCounterText('simp-chinese-informal', 10000)).toBeUndefined();
  });
  it('ethiopic-numeric は仕様書の例のとおり', async () => {
    const { complexCounterText } = await import('../src/counterStylePredefined');
    expect(complexCounterText('ethiopic-numeric', 1)).toBe('፩');
    expect(complexCounterText('ethiopic-numeric', 100)).toBe('፻');
    expect(complexCounterText('ethiopic-numeric', 78010092)).toBe('፸፰፻፩፼፺፪');
    expect(complexCounterText('ethiopic-numeric', 780100000092)).toBe('፸፰፻፩፼፼፺፪');
  });
});
