import { describe, expect, it } from 'vitest';
import { CSS_SPACE, firstLetterOf, firstSvgTag, hideGlyphElements, replacePaletteVars, splitCommasOutsideParens, stripDoctype, trailingResolution, trimAroundNewlines, trimChars } from '../src/linearText';

// 書き換える前の正規表現 (結果を比べる相手)
const OLD = {
  trim: (s: string) => s.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, ''),
  lines: (s: string) => s.replace(/[ \t]*\n[ \t]*/g, '\n'),
  commas: (s: string) => s.split(/,(?![^(]*\))/),
  firstLetter: (s: string) => {
    const m = /^(\s*)([\p{Ps}\p{Pi}\p{Po}]*\s*[\p{L}\p{N}\p{S}]\p{M}*[\p{Pe}\p{Pf}\p{Po}]*)/u.exec(s);
    return m ? [m[1], m[2]] : undefined;
  },
  resolution: (s: string) => {
    const m = /(\d+(?:\.\d+)?)\s*(dpi|dpcm|dppx|x)?\s*$/i.exec(s);
    return m ? [m[1], m[2]] : undefined;
  },
  glyph: (s: string, keep: (name: string, n: string) => boolean) =>
    s.replace(/<([A-Za-z][\w:.-]*)\b([^>]*?\bid\s*=\s*["']glyph(\d+)["'][^>]*?)(\/?)>/g, (all, name: string, attrs: string, n: string, close: string) => (keep(name, n) ? all : `<${name}${attrs} display="none"${close}>`)),
  doctype: (s: string) => s.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, ''),
  svgTag: (s: string) => /<svg\b[^>]*>/.exec(s)?.[0],
  palette: (s: string, f: (n: string, fallback: string | undefined) => string) =>
    s.replace(/var\(\s*--color(\d+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, n: string, fallback?: string) => f(n, fallback)),
};

// 決まった種の、小さな擬似乱数 (結果を毎回同じにする)
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

/** 部品 parts をランダムに並べた文字列 */
function randomText(r: () => number, parts: readonly string[], max: number): string {
  let s = '';
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) s += parts[Math.floor(r() * parts.length)];
  return s;
}

const RUNS = 4000;

function timed(f: () => void): number {
  const t = performance.now();
  f();
  return performance.now() - t;
}

describe('linearText: 元の正規表現と結果が同じ', () => {
  it('trimChars (前後の CSS の空白)', () => {
    const r = rng(1);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, [' ', '\t', '\n', '\r', '\f', 'a', '　', ' ', 'b c'], 12);
      expect(trimChars(s, CSS_SPACE)).toBe(OLD.trim(s));
    }
  });

  it('trimAroundNewlines (改行の前後の空白とタブ)', () => {
    const r = rng(2);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, [' ', '\t', '\n', 'a', '　', '\r'], 14);
      expect(trimAroundNewlines(s)).toBe(OLD.lines(s));
    }
  });

  it('splitCommasOutsideParens (括弧の中でないコンマで分ける)', () => {
    const r = rng(3);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, [',', '(', ')', 'a', ' ', 'attr(x)', 'counter(a, b)'], 12);
      expect(splitCommasOutsideParens(s)).toEqual(OLD.commas(s));
    }
  });

  it('firstLetterOf (::first-letter の字)', () => {
    const r = rng(4);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, [' ', '\n', '　', '「', '」', '"', '“', '”', '(', ')', '.', '!', 'a', 'あ', '1', '$', '́', '゙', '😀', '-'], 8);
      expect(firstLetterOf(s)).toEqual(OLD.firstLetter(s));
    }
  });

  it('trailingResolution (末尾の解像度)', () => {
    const r = rng(5);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, ['1', '0', '9', '.', ' ', '\t', 'dpi', 'DPI', 'dpcm', 'dppx', 'x', 'X', 'dp', 'p', 'a', '-', 'İ'], 9);
      expect(trailingResolution(s)).toEqual(OLD.resolution(s));
    }
  });

  it('hideGlyphElements (ほかの字形の要素を隠す)', () => {
    const r = rng(6);
    const keep = (name: string, n: string) => n === '1' || name === 'svg';
    for (let k = 0; k < RUNS * 8; k++) {
      const s = randomText(r, ['<', '<g', '<svg', '<a-', '<b.c', '<x:y', '>', '/>', '/', ' ', 'a', '-', '.', '_', 'id', 'id="glyph1"', " id='glyph2'", ' id = "glyph01"', '-id="glyph3"', 'glyph3', '"', '='], 8);
      expect(hideGlyphElements(s, keep)).toBe(OLD.glyph(s, keep));
    }
  });

  it('stripDoctype (文書型宣言を取り除く)', () => {
    const r = rng(7);
    for (let k = 0; k < RUNS * 2; k++) {
      const s = randomText(r, ['<!DOCTYPE', '<!doctype x [', '[', ']', ']>', '] >', '>', ' ', '\n', 'a', '<', '"'], 8);
      expect(stripDoctype(s)).toBe(OLD.doctype(s));
    }
  });
});

describe('linearText: 元の正規表現と結果が同じ (書体の SVG の表)', () => {
  it('firstSvgTag (最初の <svg …>)', () => {
    const r = rng(8);
    for (let k = 0; k < RUNS; k++) {
      const s = randomText(r, ['<svg', '<svgx', '<SVG', '<', '>', ' ', 'a', '-', '"', '1'], 8);
      expect(firstSvgTag(s)).toBe(OLD.svgTag(s));
    }
  });

  it('replacePaletteVars (var(--colorN, 代わりの値))', () => {
    const r = rng(9);
    // 代わりの値の有る無しと中身が分かるように、置き換えの結果に書き出す
    const f = (n: string, fallback: string | undefined) => `[${n}|${fallback === undefined ? '-' : fallback}]`;
    for (let k = 0; k < RUNS * 8; k++) {
      const s = randomText(r, ['var(--color1', 'var( --color02 ', 'var(--color', 'var(', '1', ',', ', ', ', rgb(1,2,3)', ',f(', ' ', '\n', '(', ')', ')', 'rgb(1,2,3)', 'red'], 7);
      expect(replacePaletteVars(s, f)).toBe(OLD.palette(s, f));
    }
  });
});

describe('linearText: 長い入力でも、長さに比例する時間で読む', () => {
  it('2 乗・3 乗の手間になっていた入力', () => {
    // 以前 (元の正規表現): 2 万字で、どれも 0.3〜0.5 秒。解像度は数字 2 千字で 21 ms (長さの 3 乗に近い)。
    // <svg は 2 万個で 1.6 秒、var(--color1, の後ろの空白 2 万字は 2 分を超えても終わらなかった
    const R = (s: string, n: number) => s.repeat(n);
    const n = 200000;
    const t = timed(() => {
      firstLetterOf(R('\n', n));
      trimChars(`a${R(' ', n)}a`, CSS_SPACE);
      splitCommasOutsideParens(R(',', n));
      trimAroundNewlines(`${R(' ', n)}\n`);
      trailingResolution(`${R('0', n)}q`);
      trailingResolution(R('0', n));
      hideGlyphElements(R('<a ', n), () => false);
      hideGlyphElements(`${R('<a-.-', n)} id="glyph1">`, () => false);
      stripDoctype(`<!DOCTYPE${R(' ', n)}x`);
      stripDoctype(`<!DOCTYPE [${R('] ', n)}x`);
      stripDoctype(R('<!DOCTYPE [', n / 10));
      firstSvgTag(R('<svg ', n));
      replacePaletteVars(`var(--color1,${R(' ', n)}`, () => '');
      replacePaletteVars(R('var(--color1, a(', n / 10), () => '');
      replacePaletteVars(`var(--color1, (${R('x', n)}`, () => '');
    });
    expect(t).toBeLessThan(1500);
  });
});
