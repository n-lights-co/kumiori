/**
 * HTML+CSS の読み込みで、止まる・落ちる入力への備え (全体レビューの HTM-04〜07・16・18、CSS-01):
 *  - HTM-04 content: attr() (引数なし) は宣言を無効にする
 *  - HTM-05 @import の循環と var() の多重参照は、展開の上限で切る
 *  - HTM-06 表の span・colspan・rowspan は HTML の仕様の上限に抑える
 *  - HTM-07 grid-template-columns の repeat() の回数の上限
 *  - HTM-16 深い入れ子は、上限の深さで平らにする
 *  - HTM-18 同じ画像の URL は 1 度だけ取りに行く
 *  - CSS-01 @counter-style の symbolic・additive と roman の、長すぎる表記
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { counterText, parseCss, resolveVars, MAX_VAR_LENGTH } from '../src/htmlPaged';
import { importHtml, gridTracks, MAX_GRID_REPEAT } from '../src/htmlImport';
import { limitTreeDepth, MAX_TREE_DEPTH, MAX_IMPORTED_CSS_LENGTH, prepareHtml } from '../src/htmlPrepare';
import { fetchReportedImages } from '../src/documentResources';
import { AssetStore } from '../src/assets';
import { CounterStyles, parseCounterStyleRule, MAX_COUNTER_LENGTH } from '../src/counterStyle';
import { renderPdf } from '../src/pdfRenderer';
import type { Area, LTable } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const DEF = { width: 210, height: 297, margin: 20 };
const lk = (h: string) => parseHTML(h).document as unknown as Document;
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
/** importHtml (A5・余白 10mm)。linkedom (CLI・API の経路) で読む */
const imp = (body: string, css = '', xml = false) => {
  const d = xml ? (new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document) : lk(page(body));
  limitTreeDepth(d);
  const full = `@page { size: A5; margin: 10mm } body { margin: 0 } ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
const texts = (body: string, css = '') => {
  const out: string[] = [];
  const rec = (a: Area) => {
    if (a.type === 'glyph') out.push(a.text);
    for (const c of childrenOf(a)) rec(c);
  };
  for (const s of E.engine.layout(imp(body, css).document).sheets) rec(s.page);
  return out.join('');
};
const tables = (doc: unknown): LTable[] => {
  const out: LTable[] = [];
  JSON.stringify(doc, (_k, v) => {
    if (v && v.type === 'table') out.push(v as LTable);
    return v;
  });
  return out;
};

describe('HTM-04: 引数の無い attr()', () => {
  it('content: attr() は無効な宣言 (生成内容なし。落ちない)', () => {
    expect(texts('<p class="x">a</p>', '.x::before{content: "[" attr() "]"}')).toBe('a');
  });
  it('string-set: s attr() も無効 (落ちない)', () => {
    expect(texts('<p class="x">a</p>', '.x{string-set: s attr()}')).toBe('a');
  });
  it('引数のある attr() は今までどおり', () => {
    expect(texts('<p class="x" title="T">a</p>', '.x::before{content: "[" attr(title) "]"}')).toBe('[T]a');
  });
  it('counter()・counters()・target-counter() の引数なしも落ちない', () => {
    expect(texts('<p class="x">a</p>', '.x::before{content: counter()} .x::after{content: counters() target-counter() target-text()}')).toBe('a');
  });
});

describe('HTM-05: @import の循環と var() の多重参照', () => {
  const prep = (files: Record<string, string>, html = '<html><head><link rel="stylesheet" href="a.css"></head><body><p>x</p></body></html>') =>
    prepareHtml(html, Object.entries(files).map(([name, t]) => ({ name, text: async () => t })), 'browser', DEF, lk);
  it('自分自身を読む @import は読まない (中身は 1 度だけ)', async () => {
    const r = await prep({ 'a.css': '@import "a.css";'.repeat(5) + 'p{color:red}' });
    expect(r.authorCss.match(/color:red/g)?.length).toBe(1);
  });
  it('互いに読み合う @import は、循環の所で切る', async () => {
    const r = await prep({ 'a.css': '@import "b.css";@import "b.css"; p{color:red}', 'b.css': '@import "a.css";@import "a.css"; p{color:blue}' });
    // a.css は b.css を 2 度読む (同じファイルを 2 度読むのは循環ではない) が、b.css の中の a.css は読まない
    expect(r.authorCss.match(/color:red/g)?.length).toBe(1);
    expect(r.authorCss.match(/color:blue/g)?.length).toBe(2);
  });
  it('循環の無い多重の @import も、展開後の長さの上限で止める (上限を超える @import は捨てる)', async () => {
    // 8 段、段ごとに 16 回読む: 16^8 倍に膨らむ
    const files: Record<string, string> = {};
    for (let k = 0; k < 8; k++) files[`${String.fromCharCode(97 + k)}.css`] = `@import "${String.fromCharCode(98 + k)}.css";`.repeat(16) + `p{--k:${k}}`;
    files['i.css'] = 'p{color:green}' + ' '.repeat(1000);
    const r = await prep(files);
    expect(r.authorCss.length).toBeLessThanOrEqual(MAX_IMPORTED_CSS_LENGTH * 2);
    expect(r.authorCss).toContain('--k:0');
    // 捨てたことは、警告で 1 度だけ知らせる
    expect(r.warnings.filter((w) => w.includes('@import'))).toHaveLength(1);
  });
  it('ふつうの入れ子の @import は今までどおり', async () => {
    const r = await prep({ 'a.css': '@import "b.css"; p{color:red}', 'b.css': '@import url(c.css); p{color:blue}', 'c.css': 'p{color:green}' });
    expect(r.authorCss.replace(/\s+/g, '')).toBe('p{color:green}p{color:blue}p{color:red}');
  });

  it('var() の多重参照は、長さの上限を超えたら宣言を無効にする (空にする)', () => {
    const vars: Record<string, string> = { '--v0': 'xxxxxxxxxx' };
    for (let k = 1; k <= 10; k++) vars[`--v${k}`] = `var(--v${k - 1}) `.repeat(10);
    const out = resolveVars('var(--v10)', vars);
    expect(out.length).toBeLessThanOrEqual(MAX_VAR_LENGTH);
    expect(out).toBe('');
  });
  it('var() の循環は今までどおり止まる。ふつうの参照は今までどおり', () => {
    expect(resolveVars('var(--a)', { '--a': 'var(--b)', '--b': 'var(--a)' }).length).toBeLessThan(100);
    expect(resolveVars('1px var(--a) var(--c, blue)', { '--a': 'var(--b)', '--b': 'red' })).toBe('1px red blue');
  });
  it('文書の CSS の変数の多重参照で、読み込みが落ちない', () => {
    let css = ':root{--v0:xxxxxxxxxx;';
    for (let k = 1; k <= 10; k++) css += `--v${k}:${`var(--v${k - 1}) `.repeat(10)};`;
    css += '} p{font-family:var(--v10)} p::before{content:"b"}';
    expect(parseCss(css).rules.length).toBeGreaterThan(0);
    expect(texts('<p>a</p>', css)).toBe('ba');
  });
});

describe('HTM-06: 表の span の上限 (HTML の仕様)', () => {
  it('<col span> は 1000 まで', () => {
    const t = tables(imp('<table><col span="4000000"><tr><td>a</td></tr></table>').document)[0];
    expect(t.columns!.length).toBe(1000);
  });
  it('<colgroup span> は 1000 まで', () => {
    const t = tables(imp('<table><colgroup span="4000000"></colgroup><tr><td>a</td></tr></table>').document)[0];
    expect(t.columns!.length).toBeLessThanOrEqual(1000);
  });
  it('colspan は 1000、rowspan は 65534 まで', () => {
    const t = tables(imp('<table><tr><td colspan="100000" rowspan="100000">a</td></tr><tr><td>b</td></tr></table>').document)[0];
    const cell = t.body.rows[0].cells[0];
    expect(cell.colSpan).toBe(1000);
    expect(cell.rowSpan).toBe(65534);
  });
  it('ふつうの span はそのまま', () => {
    const t = tables(imp('<table><col span="3"><tr><td colspan="2" rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></table>').document)[0];
    expect(t.columns!.length).toBe(3);
    expect(t.body.rows[0].cells[0].colSpan).toBe(2);
    expect(t.body.rows[0].cells[0].rowSpan).toBe(2);
  });
  it('大きな colspan の表を組める', () => {
    expect(texts('<table><tr><td colspan="100000">a</td></tr><tr><td>b</td></tr></table>')).toBe('ab');
  });
});

describe('HTM-07: grid の repeat() の回数の上限', () => {
  it('上限を超える回数は、上限に切る', () => {
    expect(gridTracks('repeat(5000000000, 1fr)', 100, 0).length).toBe(MAX_GRID_REPEAT);
    expect(gridTracks('repeat(4294967296, 1fr 2fr)', 100, 0).length).toBeLessThanOrEqual(MAX_GRID_REPEAT);
    expect(gridTracks(`repeat(3, repeat(${MAX_GRID_REPEAT}, 1fr))`, 100, 0).length).toBeLessThanOrEqual(MAX_GRID_REPEAT);
  });
  it('ふつうの repeat() はそのまま', () => {
    expect(gridTracks('repeat(3, 1fr)', 90, 0)).toEqual([30, 30, 30]);
    expect(gridTracks('10pt repeat(2, 1fr 2fr)', 100, 0).length).toBe(5);
  });
  it('巨大な repeat() の grid の文書を組める', () => {
    expect(texts('<div class="g"><span>a</span></div>', '.g{display:grid;grid-template-columns:repeat(5000000000,1fr)}')).toBe('a');
  });
});

describe('HTM-16: 深い入れ子', () => {
  const depthOf = (d: Document) => {
    let max = 0;
    let n: Node | null = d.documentElement;
    let depth = 1;
    while (n) {
      if (n.nodeType === 1) max = Math.max(max, depth);
      if (n.firstChild) {
        n = n.firstChild;
        depth++;
        continue;
      }
      while (n && !n.nextSibling) {
        n = n.parentNode;
        depth--;
      }
      n = n?.nextSibling ?? null;
    }
    return max;
  };
  it('上限より深い要素は、上限の深さの祖先の後ろへ出す (文字の順は変わらない)', () => {
    const n = MAX_TREE_DEPTH + 300;
    const d = lk(page('<div>'.repeat(n) + 'x<img alt="i">y' + '</div>z'.repeat(n)));
    limitTreeDepth(d);
    expect(depthOf(d)).toBe(MAX_TREE_DEPTH);
    expect(d.querySelectorAll('div').length).toBe(n);
    expect(d.querySelectorAll('img').length).toBe(1);
    expect(d.body.textContent).toBe('xy' + 'z'.repeat(n));
  });
  it('上限までの深さの文書は変えない', () => {
    const html = page('<div>'.repeat(MAX_TREE_DEPTH - 2) + 'x' + '</div>'.repeat(MAX_TREE_DEPTH - 2));
    const d = lk(html);
    const before = d.documentElement.outerHTML;
    limitTreeDepth(d);
    expect(d.documentElement.outerHTML).toBe(before);
    expect(depthOf(d)).toBe(MAX_TREE_DEPTH);
  });
  it('prepareHtml が深さを抑える', async () => {
    const r = await prepareHtml(page('<div>'.repeat(3000) + 'x' + '</div>'.repeat(3000)), [], 'browser', DEF, lk);
    expect(depthOf(r.doc)).toBeLessThanOrEqual(MAX_TREE_DEPTH);
    // 木の形が変わるので、黙って進めずに警告する (上限に届かない文書では出さない)
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(`${MAX_TREE_DEPTH} 段`);
    const shallow = await prepareHtml(page('<div>'.repeat(MAX_TREE_DEPTH - 3) + 'x' + '</div>'.repeat(MAX_TREE_DEPTH - 3)), [], 'browser', DEF, lk);
    expect(shallow.warnings).toEqual([]);
  });
  // 上限の深さ (と、それを大きく超える深さ) の入れ子を、PDF まで作ってもスタックが切れない。
  // flex・grid は 1 段ごとに領域が何重にもなり、描画の再帰がいちばん深くなる
  const nest: Record<string, (n: number) => string> = {
    div: (n) => '<div>'.repeat(n) + 'x' + '</div>'.repeat(n),
    span: (n) => '<p>' + '<span>'.repeat(n) + 'x' + '</span>'.repeat(n) + '</p>',
    リスト: (n) => '<ul><li>'.repeat(n / 2) + 'x' + '</li></ul>'.repeat(n / 2),
    flex: (n) => '<div class="f">'.repeat(n) + 'x' + '</div>'.repeat(n),
    grid: (n) => '<div class="g">'.repeat(n) + 'x' + '</div>'.repeat(n),
    縦書きと横書きの入れ子: (n) => '<div class="v"><div class="h">'.repeat(n / 2) + 'x' + '</div></div>'.repeat(n / 2),
  };
  const nestCss = '.f{display:flex} .g{display:grid;grid-template-columns:1fr} .v{writing-mode:vertical-rl} .h{writing-mode:horizontal-tb}';
  for (const [name, f] of Object.entries(nest)) {
    it(`${name} の深い入れ子 (上限ちょうど・800 段・1200 段) を PDF まで作れる`, async () => {
      for (const n of [MAX_TREE_DEPTH - 2, 800, 1200]) {
        const tree = E.engine.layout(imp(f(n), nestCss).document);
        const pdf = await renderPdf(tree, E.fonts);
        expect(pdf.length).toBeGreaterThan(100);
      }
    });
  }
  it('6000 段の入れ子を組める', () => {
    expect(texts(nest.div(6000))).toBe('x');
    expect(texts(nest.span(6000))).toBe('x');
  });
  it('表・リストの深い入れ子も読める', () => {
    const n = 300;
    // 表は読み込みだけ確かめる (何重もの入れ子の表の組版は時間がかかるので、ここでは組まない)
    const doc = imp('<table><tr><td>'.repeat(n) + 'x' + '</td></tr></table>'.repeat(n)).document;
    expect(tables(doc).length).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).toContain('"x"');
    expect(texts('<ul><li>'.repeat(n) + 'x' + '</li></ul>'.repeat(n)).endsWith('x')).toBe(true);
  });
});

describe('HTM-18: 同じ画像の URL は 1 度だけ取る', () => {
  it('取れなかった URL を取り直さない。許さない URL も 1 度だけ報告する', async () => {
    const assets = new AssetStore();
    const calls: string[] = [];
    assets.addUrl = async (url: string) => {
      calls.push(url);
      return undefined;
    };
    const bad = 'https://example.invalid/x.png';
    const refused = await fetchReportedImages(assets, [...Array(50).fill(bad), 'https://no.invalid/a.png', 'https://no.invalid/a.png'], (u) => u === bad, 10);
    expect(calls).toEqual([bad]);
    expect(refused).toEqual(['https://no.invalid/a.png']);
  });
  it('report.images に同じ URL は 1 つ', () => {
    const r = imp('<p><img src="https://example.invalid/x.png"><img src="https://example.invalid/x.png"><img src="https://example.invalid/y.png"></p>'.repeat(3));
    expect(r.report.images).toEqual(['https://example.invalid/x.png', 'https://example.invalid/y.png']);
  });
});

describe('CSS-01: 長すぎるカウンターの表記', () => {
  const styles = (body: string) => {
    const decls = body.split(';').map((d) => d.split(':').map((x) => x.trim()) as [string, string]);
    const cs = new CounterStyles(new Map([['x', parseCounterStyleRule(decls)]]), (t, n) => (t === 'decimal' ? String(n) : undefined), () => undefined);
    return (n: number) => cs.text('x', n);
  };
  it('symbolic: 表記が上限を超える数は fallback (decimal) で書く', () => {
    const s = styles('system: symbolic; symbols: "*"');
    expect(s(3)).toBe('***');
    expect(s(MAX_COUNTER_LENGTH)).toBe('*'.repeat(MAX_COUNTER_LENGTH));
    expect(s(MAX_COUNTER_LENGTH + 1)).toBe(String(MAX_COUNTER_LENGTH + 1));
    expect(s(200000000)).toBe('200000000');
    expect(s(2 ** 31 - 1)).toBe(String(2 ** 31 - 1));
  });
  it('additive: 表記が上限を超える数は fallback で書く', () => {
    const s = styles('system: additive; additive-symbols: 5 "V", 1 "I"');
    expect(s(7)).toBe('VII');
    expect(s(2000000000)).toBe('2000000000');
  });
  it('pad: 巨大な桁数でも落ちない', () => {
    const s = styles('system: numeric; symbols: "0" "1"; pad: 2000000000 "0"');
    expect(s(5)).toBe('5');
    const ok = styles('system: numeric; symbols: "0" "1"; pad: 8 "0"');
    expect(ok(5)).toBe('00000101');
  });
  it('文書の中の巨大なカウンターの値で落ちない', () => {
    expect(texts('<p class="x">a</p>', '@counter-style st { system: symbolic; symbols: "*" } .x{counter-reset: c 200000000} .x::before{content: counter(c, st) " "}')).toBe('200000000 a');
  });
  it('roman: 巨大な数でも長い表記を作らない', () => {
    expect(counterText('upper-roman', 1994)).toBe('MCMXCIV');
    expect(counterText('lower-roman', 3000000000).length).toBeLessThanOrEqual(MAX_COUNTER_LENGTH);
    expect(texts('<p class="x">a</p>', '.x{counter-reset: c 2000000000} .x::before{content: counter(c, upper-roman) " "}').length).toBeLessThan(MAX_COUNTER_LENGTH + 10);
  });
});
