/**
 * snapshotDocument (src/snapshot.ts) の、DOM の要らない所の試験: CSS の書き換え (src/snapshotCss.ts) と、選択肢・DOM の無い所の誤り。
 * ブラウザの中で写して組む試験は e2e/snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { KumioriOptionError, snapshotDocument } from '../src/index';
import { activeDataUrl, animatesToScript, escapeStyleText, resolveSnapshotUrl } from '../src/snapshot';
import { mapStyleRuleSelectors, renameTypeSelector, rewriteCssUrls, ruleDiff, scopeSelectorList, splitSelectorList, stripImports } from '../src/snapshotCss';

const abs = (base: string) => (u: string) => (u.startsWith('#') || u.startsWith('data:') ? undefined : new URL(u, base).href);

describe('rewriteCssUrls', () => {
  const base = 'https://example.com/a/b/page.html';
  it('url() の引用符の無い形・文字列の形、@import の文字列、image-set() の文字列を書き換える', () => {
    const css = `@import "x.css"; @import url(y.css) screen; p { background: url( img/a.png ) } q { background-image: url('../b.png'), image-set("c.png" 1x, 'd.png' 2x) }`;
    expect(rewriteCssUrls(css, abs(base))).toBe(
      `@import url("https://example.com/a/b/x.css"); @import url("https://example.com/a/b/y.css") screen; p { background: url("https://example.com/a/b/img/a.png") } q { background-image: url("https://example.com/a/b.png"), image-set(url("https://example.com/a/b/c.png") 1x, url("https://example.com/a/b/d.png") 2x) }`,
    );
  });
  it('# だけの参照・data: はそのまま。注釈の中・ふつうの文字列 (content) は書き換えない', () => {
    const css = `/* url(a.png) */ p::before { content: "url(x.png)" } r { fill: url(#g); background: url(data:image/png;base64,AA==) }`;
    expect(rewriteCssUrls(css, abs(base))).toBe(css);
  });
  it('逆斜線の入った URL は書き換えない。閉じない url( の長い並びも、長さに比例した手間で読む', () => {
    expect(rewriteCssUrls('p { background: url(a\\(b.png) }', abs(base))).toBe('p { background: url(a\\(b.png) }');
    const long = 'p { x: ' + 'url('.repeat(200_000) + ' }';
    const t = Date.now();
    rewriteCssUrls(long, abs(base));
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('書き換えた値の中の " と \\ はエスケープする', () => {
    expect(rewriteCssUrls('p { background: url(a.png) }', () => 'x"y\\z')).toBe('p { background: url("x\\"y\\\\z") }');
  });
});

describe('mapStyleRuleSelectors', () => {
  it('スタイルの規則と、@media・@supports・@layer の中の規則のセレクタを書き換える。@font-face・@keyframes の中は、そのまま', () => {
    const css = `p, .a > b { color: red } @media print { h1 { x: 1 } } @keyframes k { from { a: 1 } to { a: 2 } } @font-face { font-family: F } @layer l { i { y: 1 } } @import "a.css";`;
    const out = mapStyleRuleSelectors(css, (s) => `[${s}]`);
    expect(out).toBe(`[p, .a > b] { color: red } @media print { [h1] { x: 1 } } @keyframes k { from { a: 1 } to { a: 2 } } @font-face { font-family: F } @layer l { [i] { y: 1 } } @import "a.css";`);
  });
  it('入れ子の規則は、親のセレクタだけを書き換える。文字列の中の { } で崩れない', () => {
    const css = `.card { color: red; & .t { x: 1 } } p::before { content: "{" }`;
    expect(mapStyleRuleSelectors(css, (s) => `X${s}`)).toBe(`X.card { color: red; & .t { x: 1 } } Xp::before { content: "{" }`);
  });
});

describe('scopeSelectorList', () => {
  const scope = { inside: '[data-ks-s="1"]', host: '[data-ks-h="1"]', slotted: '[data-ks-sl="1"]' };
  it('複合セレクタごとに影の木の印を足す (擬似要素の前に)', () => {
    expect(scopeSelectorList('.a > b + i, p::before, li:hover, *', scope)).toBe('.a[data-ks-s="1"] > b[data-ks-s="1"] + i[data-ks-s="1"], p[data-ks-s="1"]::before, li:hover[data-ks-s="1"], *[data-ks-s="1"]');
    expect(scopeSelectorList('a:not(.x, .y) span', scope)).toBe('a:not(.x, .y)[data-ks-s="1"] span[data-ks-s="1"]');
  });
  it(':host・:host(X)・:host-context(X)・::slotted(X)', () => {
    expect(scopeSelectorList(':host', scope)).toBe('[data-ks-h="1"]');
    expect(scopeSelectorList(':host(.dark) .t', scope)).toBe('.dark[data-ks-h="1"] .t[data-ks-s="1"]');
    // :host-context(X) は、host の祖先か host そのものが X (CSS Scoping 1 §3.2.1)
    expect(scopeSelectorList(':host-context(.night) p', scope)).toBe(':is(.night [data-ks-h="1"], .night[data-ks-h="1"]) p[data-ks-s="1"]');
    expect(scopeSelectorList('::slotted(img)', scope)).toBe('img[data-ks-sl="1"]');
    expect(scopeSelectorList('slot::slotted(*)', scope)).toBe('*[data-ks-sl="1"]');
  });
  it('属性の中・文字列の中の , と結合子で分けない', () => {
    expect(splitSelectorList('a[title="x, y"], b')).toEqual(['a[title="x, y"]', 'b']);
    expect(scopeSelectorList('a[title="x > y"]', scope)).toBe('a[title="x > y"][data-ks-s="1"]');
  });
});

describe('stripImports', () => {
  it('いちばん外の @import の文を除く (文字列・url() の中の ; と、ブロックの中は見ない)', () => {
    expect(stripImports('@import url("a;b.css") screen; /* c */ @import \'d.css\';\np { color: red }')).toBe('\np { color: red }');
    expect(stripImports('@media print { p { content: "@import x;" } }')).toBe('@media print { p { content: "@import x;" } }');
  });
});

describe('renameTypeSelector', () => {
  it('型セレクタだけを置き換える (クラス・id・属性・名前の一部は置き換えない)', () => {
    const to = 'img[data-kumiori-canvas]';
    expect(renameTypeSelector('canvas', 'canvas', to)).toBe(to);
    expect(renameTypeSelector('div > canvas.c, .canvas, #canvas, [data-x=canvas], canvas-el, :not(canvas)', 'canvas', to)).toBe(`div > ${to}.c, .canvas, #canvas, [data-x=canvas], canvas-el, :not(${to})`);
  });
});

describe('ruleDiff', () => {
  it('足された規則 (live の順) と、消された規則の数。同じ文字の規則は数で比べる', () => {
    expect(ruleDiff(['a {}', 'b {}', 'a {}'], ['a {}', 'c {}', 'b {}', 'd {}'])).toEqual({ added: ['c {}', 'd {}'], removed: 1 });
    expect(ruleDiff([], ['x {}'])).toEqual({ added: ['x {}'], removed: 0 });
  });
});

describe('snapshotDocument の選択肢と、DOM の無い所', () => {
  it('DOM の無い所 (Node) では KumioriOptionError', async () => {
    await expect(snapshotDocument()).rejects.toBeInstanceOf(KumioriOptionError);
    await expect(snapshotDocument()).rejects.toThrow(/postMessage/);
  });
  it('知らない名前・型の違う値・snapshot の上限に無い名前は KumioriOptionError', async () => {
    const bad: unknown[] = [{ wait: 1 }, { timeoutMs: -1 }, { waitFor: 3 }, { signal: {} }, { lang: 'fr' }, { limits: { imagePixels: 0 } }, { limits: { pages: 3 } }, { limits: { snapshotBytes: 1.5 } }];
    for (const o of bad) await expect(snapshotDocument(undefined, o as never)).rejects.toBeInstanceOf(KumioriOptionError);
  });
});

describe('resolveSnapshotUrl (写しの中の URL)', () => {
  const base = 'https://example.com/a/page.html';
  const doc = 'https://example.com/a/page.html';
  it('空白・制御字・タブ・改行で隠した javascript: と vbscript: は null (取り除く。URL Standard §4.4 の前処理の後で見る)', () => {
    for (const v of ['javascript:alert(1)', 'JaVaScRiPt:x', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'javascript\t:alert(1)', '\x01javascript:alert(1)', ' \x00 javascript:x', 'jav\rascript:x', 'vbscript:msgbox'])
      expect(resolveSnapshotUrl(v, base, doc)).toBeNull();
  });
  it('相対の URL は絶対に、# と、文書の URL に # の付いたものは # の形に。data: はそのまま', () => {
    expect(resolveSnapshotUrl(' img/a.png ', base, doc)).toBe('https://example.com/a/img/a.png');
    expect(resolveSnapshotUrl('#x', base, doc)).toBe('#x');
    expect(resolveSnapshotUrl('page.html#y', base, doc)).toBe('#y');
    expect(resolveSnapshotUrl('data:image/png;base64,AA==', base, doc)).toBe('data:image/png;base64,AA==');
  });
});

describe('animatesToScript・activeDataUrl (写しに残さない、動かす中身)', () => {
  /** 属性だけを持つ要素の代わり */
  const el = (localName: string, attrs: Record<string, string>) => ({ localName, getAttribute: (n: string) => attrs[n] ?? null });
  it('SVG の set・animate などで href・xlink:href を javascript:・vbscript: に動かすものは、写さない (to・from・by・values。隠したものも)', () => {
    expect(animatesToScript(el('set', { attributeName: 'href', to: 'javascript:alert(1)' }))).toBe(true);
    expect(animatesToScript(el('animate', { attributeName: 'xlink:href', values: '#a; java\tscript:alert(1)' }))).toBe(true);
    expect(animatesToScript(el('animate', { attributeName: 'HREF', from: ' vbscript:x' }))).toBe(true);
    expect(animatesToScript(el('animateMotion', { attributeName: 'href', by: 'javascript:x' }))).toBe(true);
    // href でない属性・javascript: でない値・アニメーションでない要素は残す
    expect(animatesToScript(el('set', { attributeName: 'fill', to: 'javascript:x' }))).toBe(false);
    expect(animatesToScript(el('animate', { attributeName: 'href', values: '#a;#b' }))).toBe(false);
    expect(animatesToScript(el('a', { attributeName: 'href', to: 'javascript:x' }))).toBe(false);
  });
  it('iframe・object・embed の文書の data: の URL は取り除く。画像の data: (SVG を除く) と、ほかの要素の data: は残す', () => {
    expect(activeDataUrl('iframe', 'data:text/html,<script>alert(1)</script>')).toBe(true);
    expect(activeDataUrl('iframe', 'data:image/png;base64,AA==')).toBe(true);
    expect(activeDataUrl('object', ' DATA:text/html;base64,AA==')).toBe(true);
    expect(activeDataUrl('embed', 'data:image/svg+xml,<svg/>')).toBe(true);
    expect(activeDataUrl('object', 'data:image/png;base64,AA==')).toBe(false);
    expect(activeDataUrl('embed', 'https://example.com/a.pdf')).toBe(false);
    expect(activeDataUrl('img', 'data:text/html,x')).toBe(false);
  });
});

describe('escapeStyleText (HTML の <style> の字)', () => {
  it('</style を逃がす (HTML §13.3 は style の字を逃がさずに書き出すので、</style で要素を差し込めないように)。CSS の意味は変わらない', () => {
    expect(escapeStyleText('p::before { content: "</style><script>x</script>" }')).toBe('p::before { content: "<\\/style><script>x</script>" }');
    expect(escapeStyleText('a { } </STYLE >')).toBe('a { } <\\/STYLE >');
    expect(escapeStyleText('a > b { }')).toBe('a > b { }');
  });
});
