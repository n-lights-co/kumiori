/**
 * 検査 (3 回目) の SVG の問題: 小さな入力で時間・メモリを使い切らせないこと (var()・calc()・<style> の照合・SVG フォント・
 * foreignObject の入れ子・systemLanguage の組み直し・リンクの数)。正当な SVG の結果は変えない
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { evaluateCalc, parseSvg, substituteVars, systemLanguageKey } from '../src/svg';
import { AssetStore } from '../src/assets';
import { renderPdf } from '../src/pdfRenderer';
import { LayoutEngine } from '../src/layoutEngine';
import { FAMILY, doc, makeEngine, pageOps } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${body}</svg>`;
/** かかった時間 (ミリ秒) と結果 */
const timed = <T>(f: () => T): [T, number] => {
  const t0 = Date.now();
  const r = f();
  return [r, Date.now() - t0];
};

describe('var() の置き換えの長さの上限 (Variables 1 §3.3)', () => {
  it('4 倍ずつ膨らむ var() を 15 段重ねても、すぐ終わり、その宣言は無効 (fill の初期値の黒)', () => {
    let decl = '--v0:x;';
    for (let i = 1; i <= 15; i++) decl += `--v${i}:${Array(4).fill(`var(--v${i - 1})`).join(' ')};`;
    const [d, ms] = timed(() => parseSvg(svg(`<rect width="10" height="10" style="${decl}fill:var(--v15)"/>`), parse));
    expect(ms).toBeLessThan(5000);
    expect(d!.shapes[0].fill).toBe('#000000');
  });

  it('空の値の置き換えも数える (長さの増えない置き換えを指数回くり返させない)', () => {
    const vars = new Map<string, string>([['--v0', '']]);
    for (let i = 1; i <= 15; i++) vars.set(`--v${i}`, Array(4).fill(`var(--v${i - 1})`).join(''));
    const [r, ms] = timed(() => substituteVars('var(--v15)', vars));
    expect(ms).toBeLessThan(5000);
    expect(r).toBeUndefined();
  });

  it('ふつうの var() は、これまでどおり置き換える (代わりの値・入れ子も)', () => {
    const vars = new Map([
      ['--a', '#00ff00'],
      ['--b', 'var(--a)'],
    ]);
    expect(substituteVars('var(--b)', vars)).toBe('#00ff00');
    expect(substituteVars('var(--none, red)', vars)).toBe('red');
    expect(substituteVars('var(--none)', vars)).toBeUndefined();
    const d = parseSvg(svg('<g style="--c:#0000ff"><rect width="1" height="1" style="fill:var(--c)"/><rect width="1" height="1" style="fill:var(--c)"/></g>'), parse)!;
    expect(d.shapes.map((s) => s.fill)).toEqual(['#0000ff', '#0000ff']);
  });
});

describe('calc() の解き方', () => {
  it('calc(1) を 4 万個並べた値も、長さに比例する時間で解く', () => {
    const [r, ms] = timed(() => evaluateCalc(Array(40000).fill('calc(1)').join(' ')));
    expect(ms).toBeLessThan(2000);
    expect(r.startsWith('1 1 1')).toBe(true);
  });

  it('括弧を数万段重ねた式は、スタックを使い切らずに読めない値として残す', () => {
    const deep = `calc(${'('.repeat(30000)}1${')'.repeat(30000)})`;
    expect(evaluateCalc(deep)).toBe(deep);
    const nested = `${'calc('.repeat(30000)}1${')'.repeat(30000)}`;
    expect(evaluateCalc(nested)).toBe(nested);
  });

  it('ふつうの式は、これまでどおり解く (大文字の CALC も)', () => {
    expect(evaluateCalc('calc(1px + 2px)')).toBe('3px');
    expect(evaluateCalc('CALC(2 * (3 + 4))')).toBe('14');
    expect(evaluateCalc('calc(-(1in))')).toBe('-96px');
    expect(evaluateCalc('a calc(1pt*3) b calc(10% / 2)')).toBe('a 4px b 5%');
  });
});

describe('<style> の単純でない選択子の照合', () => {
  it('属性の選択子は、属性の名前で引く (1000 規則 × 1 万要素でも、すぐ終わる)。当てる順は変えない', () => {
    const rules = Array.from({ length: 1000 }, (_, i) => `[a${i}] {fill:#00${String(i % 10)}}`).join('\n');
    const rects = '<rect width="1" height="1"/>'.repeat(10000);
    const [d, ms] = timed(() => parseSvg(svg(`<style>${rules}</style>${rects}<rect A5="" width="1" height="1"/>`), parse)!);
    expect(ms).toBeLessThan(5000);
    expect(d.shapes).toHaveLength(10001);
    expect(d.shapes[0].fill).toBe('#000000');
    // 属性の名前は大文字小文字を区別せずに比べる (cssSelector の attrValue と同じ)
    expect(d.shapes[10000].fill).toBe('#000055');
    // 後に書いた規則が勝つ・詳細度の高い規則が勝つ
    const d2 = parseSvg(svg('<style>[k] {fill:#f00} [k] {fill:#0f0} rect[k] {stroke:#00f} [k] {stroke:#f00}</style><rect k="1" width="1" height="1"/>'), parse)!;
    expect(d2.shapes[0].fill).toBe('#00ff00');
    expect(d2.shapes[0].stroke).toBe('#0000ff');
  });

  it('索引で絞れない規則を照らす回数に上限があり、超えた SVG は描けないものとする', () => {
    // 右端が * の規則は、親ごとに 1 度だけ照らすので (parentDecidedSelectors.test.ts)、どの図形も候補になる右端の要素名で数える
    const rules = Array.from({ length: 1000 }, (_, i) => `*:nth-child(${i + 1}n+${i + 1}) rect {fill:#001}`).join('\n');
    const rects = '<rect width="1" height="1"/>'.repeat(2000);
    let why = '';
    const [d, ms] = timed(() => parseSvg(svg(`<style>${rules}</style><g>${rects}</g>`), parse, { onUnsupported: (m) => (why = m) }));
    expect(ms).toBeLessThan(10000);
    expect(d).toBeNull();
    expect(why).toMatch(/too many matches/);
    // 規則の少ないものは、これまでどおり当てる
    const ok = parseSvg(svg('<style>g > :nth-child(2) {fill:#0f0}</style><g><rect width="1" height="1"/><rect width="1" height="1"/></g>'), parse)!;
    expect(ok.shapes.map((s) => s.fill)).toEqual(['#000000', '#00ff00']);
  });
});

describe('SVG フォント', () => {
  const font = (glyphs: string) => `<defs><font horiz-adv-x="500"><font-face font-family="F" units-per-em="1000"/>${glyphs}</font></defs>`;
  it('合字は長いものを先に当てる (字の木で引く)。同じ unicode は先に書いた glyph', () => {
    const g = '<glyph unicode="f" d="M0 0L1 0Z"/><glyph unicode="ffi" horiz-adv-x="900" d="M0 0L1 0L1 1Z"/><glyph unicode="i" d="M0 0L1 0Z"/><glyph unicode="f" horiz-adv-x="100" d="M0 0Z"/>';
    const d = parseSvg(svg(`${font(g)}<text x="0" y="50" font-family="F" font-size="100">ffif</text>`), parse)!;
    const segs = d.shapes.flatMap((s) => s.segs);
    // ffi (3 線分 + Z) と f (2 線分 + Z)
    expect(segs.filter((s) => s.op === 'Z')).toHaveLength(2);
    expect(segs).toHaveLength(7);
  });

  it('長い unicode の glyph と長い text も、すぐ終わる', () => {
    const g = `<glyph unicode="${'a'.repeat(2000)}" d="M0 0L1 1Z"/><glyph unicode="a" d="M0 0L1 0Z"/>`;
    const [d, ms] = timed(() => parseSvg(svg(`${font(g)}<text x="0" y="50" font-family="F" font-size="10">${'a'.repeat(2000)}</text>`), parse));
    expect(ms).toBeLessThan(3000);
    expect(d).not.toBeNull();
  });

  it('glyph の輪郭は、2 度目からを線分の予算に数える (尽きたら描けないものとする)', () => {
    const d = `M0 0${Array.from({ length: 40000 }, (_, i) => `L${i % 7} ${i}`).join('')}Z`;
    let why = '';
    const [r, ms] = timed(() => parseSvg(svg(`${font(`<glyph unicode="b" d="${d}"/>`)}<text x="0" y="50" font-family="F" font-size="10">${'b'.repeat(1000)}</text>`), parse, { onUnsupported: (m) => (why = m) }));
    expect(ms).toBeLessThan(10000);
    expect(r).toBeNull();
    expect(why).toMatch(/too many path segments/);
  });
});

describe('systemLanguage の照らし方の鍵', () => {
  it('結果の同じ言語は同じ鍵', () => {
    const t = svg('<switch><rect systemLanguage="ja" width="1" height="1"/><rect systemLanguage="en, fr" width="1" height="1"/></switch>');
    expect(systemLanguageKey(t, ['de'])).toBe(systemLanguageKey(t, ['ko']));
    expect(systemLanguageKey(t, ['ja'])).not.toBe(systemLanguageKey(t, ['de']));
    expect(systemLanguageKey(t, ['en-US'])).toBe(systemLanguageKey(t, ['fr']));
    expect(systemLanguageKey(svg('<rect systemLanguage="&#106;a"/>'), ['ja'])).toBeUndefined();
  });
});

async function render(src: string, blocks: Array<{ language?: string; count?: number }>, extra: Record<string, unknown> = {}) {
  const { fonts, measurer } = await makeEngine();
  const assets = new AssetStore();
  assets.register('s.svg', { mime: 'image/svg+xml', bytes: new TextEncoder().encode(src), width: 200, height: 100 });
  const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
  const children = blocks.map((b) => ({ type: 'block', ...(b.language ? { language: b.language } : {}), children: Array.from({ length: b.count ?? 1 }, () => ({ type: 'image', src: 's.svg', width: 20, height: 10 })) }));
  const tree = engine.layout(doc(children as never));
  const warnings: string[] = [];
  const bytes = await renderPdf(tree, fonts, { assets, parseXml: parse, warnings, ...extra });
  return { pdf: await PDFDocument.load(bytes), warnings };
}

describe('PDF: SVG の組み直し・組む量・リンクの数', () => {
  it('foreignObject の入れ子は、外側だけを組む (番号はずらさない)', async () => {
    let calls = 0;
    const inner = (k: number): string => (k === 0 ? '<p xmlns="http://www.w3.org/1999/xhtml">x</p>' : `<foreignObject width="10" height="10"><svg xmlns="http://www.w3.org/2000/svg">${inner(k - 1)}</svg></foreignObject>`);
    const src = svg(`${inner(20)}<foreignObject x="50" width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">y</p></foreignObject>`);
    await render(src, [{}], {
      typesetForeign: async () => {
        calls++;
        return undefined;
      },
    });
    // 外側の 1 つと、後ろの 1 つ
    expect(calls).toBe(2);
  }, 60_000);

  it('systemLanguage の結果が同じ言語の所に置いた SVG は、組み直さない (描く色は言語ごと)', async () => {
    const src = svg('<switch><rect systemLanguage="ja" width="200" height="100" fill="#f00"/><rect width="200" height="100" fill="#00f"/></switch>');
    const ops = async (langs: string[]) => {
      const { pdf } = await render(src, langs.map((language) => ({ language })));
      return pageOps(pdf);
    };
    const all = await ops(['en', 'de', 'ja', 'fr', 'ko', 'jpn']);
    expect((all.match(/1 0 0 rg/g) ?? []).length).toBe(2);
    expect((all.match(/0 0 1 rg/g) ?? []).length).toBe(4);
  }, 60_000);

  it('1 ページの SVG のリンクは 5000 個まで (超えた分はリンクにせず、警告)', async () => {
    const as = Array.from({ length: 3000 }, (_, i) => `<a href="https://example.com/${i}"><rect x="${i % 200}" y="${Math.floor(i / 200)}" width="1" height="1"/></a>`).join('');
    const { pdf, warnings } = await render(svg(as), [{ count: 2 }]);
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(5000);
    expect(warnings.join('\n')).toMatch(/5000 個を超えた/);
    // 少なければ、これまでどおり全部リンクにする
    const few = await render(svg(as.slice(0, as.indexOf('<a', 10))), [{ count: 1 }]);
    expect(few.pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1);
  }, 120_000);
});
