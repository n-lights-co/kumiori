/**
 * 脆弱性検査の残り (CSS の読み込み・カスケード・セレクタ・正規表現、内部実体、分綴、EPUB) の修正の確かめ。
 * 小さな入力で時間・メモリを使い切らせないこと、正当な入力の結果 (受け入れる字・合うセレクタ・勝つ宣言) が変わらないことを見る
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, lengthPx, supportsCssDeclaration } from '../src/cssCascade';
import { createSelectorMemo, matches, parseSelectorList, querySelectorAll } from '../src/cssSelector';
import { replaceUrls, stripImportant, urlsIn } from '../src/cssText';
import { matchMedia, matchSupports, parseCss } from '../src/htmlPaged';
import { cssRefs, rebaseFontFaceUrls } from '../src/resources';
import { expandInternalEntities } from '../src/api';
import { hyphenPositions, loadHyphenator } from '../src/hyphenation';
import { readEpub, readZip, ZipEntryError } from '../src/epub';
import { makeZip } from './makeZip';

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const ids = (doc: Document, sel: string) => querySelectorAll(doc, sel).map((e) => e.getAttribute('id') ?? e.localName);
const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
};
const R = (s: string, n: number) => s.repeat(n);

describe('セレクタの照合の覚え (:has()・:nth-child(… of S))', () => {
  it(':has() の入れ子・兄弟・子・隣接の当たり外れ (覚えを使っても同じ)', () => {
    const doc = parse('<div id="d1"><p id="p1"><i id="i1"><b id="b1"></b></i></p><p id="p2"></p><b id="b2"></b></div><div id="d2"><p id="p3"><i id="i2"></i></p><span id="s1"></span></div>');
    expect(ids(doc, 'div:has(b)')).toEqual(['d1']);
    expect(ids(doc, ':has(:has(:has(b)))')).toEqual(['html', 'body', 'd1']);
    expect(ids(doc, 'p:has(> i)')).toEqual(['p1', 'p3']);
    expect(ids(doc, 'p:has(+ b)')).toEqual(['p2']);
    expect(ids(doc, 'p:has(~ b)')).toEqual(['p1', 'p2']);
    expect(ids(doc, 'p:has(~ p:has(~ b))')).toEqual(['p1']);
    expect(ids(doc, 'p:has(~ span)')).toEqual(['p3']);
    expect(ids(doc, 'p:has(~ * b)')).toEqual([]);
    expect(ids(doc, 'p:has(i b)')).toEqual(['p1']);
    expect(ids(doc, ':not(:has(*))').filter((x) => x !== 'head')).toEqual(['b1', 'p2', 'b2', 'i2', 's1']);
    // :scope を見る相対セレクタ (覚えの近道を使わない形)
    expect(ids(doc, 'div:has(> p:not(:scope))')).toEqual(['d1', 'd2']);
    // 1 つの覚えを続けて使っても、渡さないときと同じ
    const memo = createSelectorMemo();
    const all = querySelectorAll(doc, '*');
    for (const s of ['div:has(b)', 'p:has(~ p:has(~ b))', ':has(> i:has(b))', 'p:has(+ b)']) {
      const sel = parseSelectorList(s)[0];
      expect(all.filter((e) => matches(e, sel, undefined, memo))).toEqual(all.filter((e) => matches(e, sel)));
    }
  });

  it(':nth-child(An+B of S)・:nth-last-child(… of S) の当たり外れ', () => {
    const doc = parse(`<div>${Array.from({ length: 10 }, (_, i) => `<p id="q${i}"${i % 3 === 0 ? ' class="a"' : ''}></p>`).join('')}</div>`);
    expect(ids(doc, 'p:nth-child(2n+1 of .a)')).toEqual(['q0', 'q6']);
    expect(ids(doc, 'p:nth-last-child(1 of .a)')).toEqual(['q9']);
    expect(ids(doc, 'p:nth-child(2n of p:nth-child(2n of p))')).toEqual(['q3', 'q7']);
    expect(ids(doc, 'p:nth-child(2 of :not(.a))')).toEqual(['q2']);
  });

  it('入れ子の :has()・of S を、要素の数の何乗もの時間をかけずに照合する', () => {
    // 以前: :has(:has(:has(b))) × div 100 段と p 300 個で 10 秒、p:has(~ p:has(~ p:has(~ b))) × p 500 個で 70 秒超、
    // of S の 4 重 × p 3000 個で 80 秒超、p:nth-child(2n+1 of .a) × 2 万個で 80 秒超
    const deep = parse(`${R('<div>', 100)}${R('<p><i>x</i></p>', 300)}${R('</div>', 100)}`);
    const sib = parse(`<div>${R('<p>x</p>', 500)}<b></b></div>`);
    const flat = parse(`<div>${R('<p>x</p>', 3000)}</div>`);
    const many = parse(`<div>${R('<p class="a">x</p>', 20000)}</div>`);
    const [n1, t1] = timed(() => querySelectorAll(deep, ':has(:has(:has(:has(i))))').length);
    const [n2, t2] = timed(() => querySelectorAll(sib, 'p:has(~ p:has(~ p:has(~ b)))').length);
    const [n3, t3] = timed(() => querySelectorAll(flat, 'p:nth-child(2n of p:nth-child(2n of p:nth-child(2n of p:nth-child(2n of p))))').length);
    const [n4, t4] = timed(() => querySelectorAll(many, 'p:nth-child(2n+1 of .a)').length);
    expect([n1, n2, n3, n4]).toEqual([2 + 98, 498, 187, 10000]);
    expect(Math.max(t1, t2, t3, t4)).toBeLessThan(4000);
  });

  it('カスケードでも同じ: :has() の規則が、合う要素だけに当たる', () => {
    const doc = parse(`<div id="a"><p id="x">1</p><b></b></div><div id="b"><p id="y">2</p></div>`);
    const st = cascadeStyles(doc, 'div:has(b) p { color: red } p:has(~ b) { font-size: 20px }');
    const el = (id: string) => querySelectorAll(doc, `#${id}`)[0];
    expect(st.style(el('x')).getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(st.style(el('y')).getPropertyValue('color')).toBe('rgb(0, 0, 0)');
    expect(st.style(el('x')).getPropertyValue('font-size')).toBe('20px');
    expect(st.style(el('y')).getPropertyValue('font-size')).toBe('16px');
  });
});

describe('規則の索引 (祖先の名前)', () => {
  it('祖先の id・クラス・要素名で分けても、当たる規則と勝つ宣言は同じ', () => {
    const doc = parse('<section class="s"><div id="d"><p id="p1" class="c">1</p></div><span><p id="p2">2</p></span></section><p id="p3">3</p>');
    const css = [
      '.s p { color: red }',
      '#d > .c { font-size: 20px }',
      'section span p { color: blue }',
      'section span p { background-color: blue }',
      '.s ~ p { color: green }',
      'div + p, span + p { color: pink }',
      '.zz p { color: yellow }',
      'section :is(div, span) > p { text-indent: 3px }',
    ].join('\n');
    const st = cascadeStyles(doc, css);
    const get = (id: string, p: string) => st.style(querySelectorAll(doc, `#${id}`)[0]).getPropertyValue(p);
    expect([get('p1', 'color'), get('p2', 'color'), get('p3', 'color')]).toEqual(['rgb(255, 0, 0)', 'rgb(255, 0, 0)', 'rgb(0, 128, 0)']);
    expect([get('p1', 'background-color'), get('p2', 'background-color')]).toEqual(['rgba(0, 0, 0, 0)', 'rgb(0, 0, 255)']);
    expect([get('p1', 'font-size'), get('p2', 'font-size')]).toEqual(['20px', '16px']);
    expect([get('p1', 'text-indent'), get('p2', 'text-indent'), get('p3', 'text-indent')]).toEqual(['3px', '3px', '0px']);
  });

  it('互換モードでは、祖先のクラスも大文字小文字を区別しない', () => {
    const doc = new DOMParser().parseFromString('<html><body><div class="Box"><p id="p">x</p></div></body></html>', 'text/html') as unknown as Document;
    const st = cascadeStyles(doc, '.box p { color: red }', { quirksMode: 'quirks' });
    expect(st.style(querySelectorAll(doc, '#p')[0]).getPropertyValue('color')).toBe('rgb(255, 0, 0)');
  });

  it('2 万規則 × 2000 要素を、規則ごとに全部の要素を照合せずに組む', () => {
    // 以前: 57 秒 (declsFor が、要素ごとに右端の同じ 2 万個の規則を照合していた)
    const css = Array.from({ length: 20000 }, (_, i) => `.c${i} p, div > .d${i} { color: red }`).join('\n');
    const doc = parse(`<div class="c7">${R('<p class="x">x</p>', 2000)}</div>`);
    const [colors, t] = timed(() => {
      const st = cascadeStyles(doc, css);
      return new Set(querySelectorAll(doc, 'p').map((p) => st.style(p).getPropertyValue('color')));
    });
    expect([...colors]).toEqual(['rgb(255, 0, 0)']);
    expect(t).toBeLessThan(10000);
  });
});

describe('カスタム プロパティの表', () => {
  it('親の表を写さずに持っても、継承・上書き・無効の値は同じ', () => {
    const doc = parse('<div id="a" style="--x: 1px; --y: 2px"><div id="b" style="--x: 5px; --z: var(--q)"><p id="c" style="--w: var(--x)">x</p></div></div>');
    const st = cascadeStyles(doc, 'p { padding-left: var(--x); padding-right: var(--y); padding-top: var(--z, 7px); padding-bottom: var(--w) }');
    const s = st.style(querySelectorAll(doc, '#c')[0]);
    expect([s.getPropertyValue('padding-left'), s.getPropertyValue('padding-right'), s.getPropertyValue('padding-top'), s.getPropertyValue('padding-bottom')]).toEqual(['5px', '2px', '7px', '5px']);
  });

  it(':root の 2 万個の変数 × 自分の変数を持つ 2000 個の要素で、表を要素ごとに写さない', () => {
    // 以前: 405KB の文書で RSS 2.0GB
    const css = `:root { ${Array.from({ length: 20000 }, (_, i) => `--v${i}: ${i}px;`).join(' ')} } p { width: var(--v1); height: var(--z) }`;
    const doc = parse(R('<p style="--z: 3px">x</p>', 2000));
    const before = process.memoryUsage().heapUsed;
    const st = cascadeStyles(doc, css);
    const ps = querySelectorAll(doc, 'p');
    const ws = new Set(ps.map((p) => st.style(p).getPropertyValue('width') + ' ' + st.style(p).getPropertyValue('height')));
    expect([...ws]).toEqual(['1px 3px']);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(400 * 1024 * 1024);
  });

  it('5000 段の var() の連鎖で、呼び出しの段を使い切らない', () => {
    const css = `:root { --a0: 1px; ${Array.from({ length: 5000 }, (_, i) => `--a${i + 1}: var(--a${i});`).join(' ')} } p { width: var(--a5000) }`;
    const doc = parse('<p id="p">x</p>');
    const st = cascadeStyles(doc, css);
    expect(st.style(querySelectorAll(doc, '#p')[0]).getPropertyValue('width')).toBe('1px');
    // 循環は無効の値
    const st2 = cascadeStyles(doc, ':root { --a: var(--b); --b: var(--c); --c: var(--a); --d: var(--d) } p { width: var(--a, 4px); height: var(--d, 5px) }');
    const s2 = st2.style(querySelectorAll(doc, '#p')[0]);
    expect([s2.getPropertyValue('width'), s2.getPropertyValue('height')]).toEqual(['4px', '5px']);
  });

  it('互いを 2 度ずつ参照する変数の連鎖 (:root に 5000 個) を、宣言ごとに膨らませない', () => {
    const css = `:root { --a0: x; ${Array.from({ length: 5000 }, (_, i) => `--a${i + 1}: var(--a${i}) var(--a${i});`).join(' ')} } @page { margin: var(--m, 10mm) }`;
    const [r, t] = timed(() => parseCss(css));
    expect(r.pages[0].decls.margin).toBe('10mm');
    expect(t).toBeLessThan(3000);
  });
});

describe('数と !important・url() の正規表現 (受け入れる字は変えない)', () => {
  const OLD_IMPORTANT = (v: string) => v.replace(/\s*!\s*important\s*$/i, '').trim();
  const OLD_URLS = (v: string) => v.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g, (_m, a?: string, b?: string, c?: string) => `url("${(a ?? b ?? c ?? '').trim()}")`);
  const samples = ['red', 'red !important', 'red!important', 'red ! important ', ' red\t!IMPORTANT\n', 'a !important !important', '!important', 'url( "a b" ) x', "url('a')", 'url(a b)', 'url("a" b)', 'url( a )url(b)', 'url(', 'url(a', 'url("a)', 'x url("a") url(b) url(', 'URL(a)', 'url(url(a))', ''];

  it('stripImportant・replaceUrls は、前の正規表現と同じ結果', () => {
    for (const s of samples) {
      expect(stripImportant(s)).toBe(OLD_IMPORTANT(s));
      expect(stripImportant(s, false)).toBe(s.replace(/\s*!important\s*$/i, '').trim());
      expect(replaceUrls(s, (u) => `url("${u}")`)).toBe(OLD_URLS(s));
      expect(urlsIn(s)).toEqual([...s.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()));
    }
  });

  it('cssRefs・rebaseFontFaceUrls は、前の正規表現と同じ url() を拾う', () => {
    const css = '@import "x.css"; p { background: url( "a.png" ) } @font-face { font-family: f; src: url(f.woff2) format("woff2"), url(\'g.ttf\'); unicode-range: U+0-7F } q { background: url(b c) url(d.png) url( e.png ) }';
    expect(cssRefs(css)).toEqual([
      { url: 'x.css', kind: 'css' },
      { url: 'a.png', kind: 'other' },
      { url: 'f.woff2', kind: 'font', ranges: [[0, 0x7f]] },
      { url: 'g.ttf', kind: 'font', ranges: [[0, 0x7f]] },
      { url: 'd.png', kind: 'other' },
      { url: 'e.png', kind: 'other' },
    ]);
    expect(rebaseFontFaceUrls('@font-face { src: url(f.woff2), url("data:x") } p { background: url(a.png) }', 'https://example.com/css/')).toBe('@font-face { src: url("https://example.com/css/f.woff2"), url("data:x") } p { background: url(a.png) }');
  });

  it('数の書き方: 先頭・末尾の点、指数、単位 (lengthPx・supportsCssDeclaration)', () => {
    const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 600 };
    expect(lengthPx('1.5px', ctx)).toBe(1.5);
    expect(lengthPx('1.px', ctx)).toBe(1);
    expect(lengthPx('.5em', ctx)).toBe(8);
    expect(lengthPx('+1e1px', ctx)).toBe(10);
    expect(lengthPx('calc(1px + 2px * 3 - (1px))', ctx)).toBe(6);
    expect(lengthPx('calc(10px foo)', ctx)).toBeUndefined();
    expect(lengthPx('calc(1px + min(2px, 3px))', ctx)).toBe(3);
    expect(supportsCssDeclaration('line-height', '1.5')).toBe(true);
    expect(supportsCssDeclaration('line-height', '1.')).toBe(true);
    expect(supportsCssDeclaration('line-height', '1.5x')).toBe(false);
    expect(supportsCssDeclaration('opacity', '50%')).toBe(true);
    expect(supportsCssDeclaration('color', 'rgb(1, 2, 3)')).toBe(true);
    expect(supportsCssDeclaration('color', 'red !important')).toBe(true);
  });

  it('長い数・空白の並び・閉じない url( を、長さの 2 乗の時間をかけずに読む', () => {
    // 以前: line-height: 000…0x (100KB) で 17.6 秒、calc() で 5.9 秒、rgb() で 7.0 秒、color: red + 空白 + x で 7.6 秒、
    // url( × 5 万で 8〜14 秒、閉じない @font-face { × 5 万で 15 秒
    const z = R('0', 100000);
    const ws = R(' ', 200000);
    const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 600 };
    const [, t] = timed(() => {
      supportsCssDeclaration('line-height', `${z}x`);
      lengthPx(`calc(${z}x + 1px)`, ctx);
      lengthPx(`calc(${R('a', 100000)})`, ctx);
      supportsCssDeclaration('color', `rgb(${z}x,0,0)`);
      supportsCssDeclaration('color', `red${ws}x`);
      supportsCssDeclaration('font', `12px${ws}/${ws}x serif`);
      stripImportant(`red${ws}x`);
      replaceUrls(R('url(', 50000), (u) => u);
      cssRefs(R('url(', 50000));
      cssRefs(R('@font-face { ', 50000));
      cssRefs(`${R('url("', 25000)}${R("url('", 25000)}`);
      rebaseFontFaceUrls(R('@font-face { ', 50000), 'https://example.com/');
      matchMedia(`print${R('\n', 100000)}x`);
      parseCss(`@import "${R('a', 300000)}`);
      parseCss(`p { ${R(';', 100000)} } ${R('a;', 100000)}`);
    });
    expect(t).toBeLessThan(5000);
  });

  it('「空白 and 空白」の分け方は前と同じ', () => {
    expect(matchMedia('print and (color)', { width: 100, height: 100 })).toBe(true);
    expect(matchMedia('print  and\n(min-width: 1px)  and  (max-width: 1px)', { width: 100, height: 100 })).toBe(false);
    expect(matchMedia('screen and (color)', { width: 100, height: 100 })).toBe(false);
  });
});

describe('規則の入れ子の深さ', () => {
  it('深すぎる入れ子の塊は読まずに警告に数え、ほかの規則は読む', () => {
    for (const css of [`${R('@media all { ', 5000)} p { color: red } ${R('}', 5000)} q { color: blue }`, `${R('p { & ', 3000)} { color: red } ${R('}', 3000)} q { color: blue }`, `${R('p{', 100000)} q { color: blue }`]) {
      const r = parseCss(css);
      expect(r.ignored?.some((x) => /深すぎる入れ子/.test(x))).toBe(true);
    }
    const ok = parseCss(`q { color: blue } ${R('@media all { ', 10)} p { color: red } ${R('}', 10)}`);
    expect(ok.rules.map((r) => r.selector)).toEqual(['q', 'p']);
    expect(ok.ignored).toBeUndefined();
  });

  it('@supports の深い入れ子は偽 (読めない条件)。浅い入れ子は前と同じ', () => {
    expect(matchSupports(`${R('(not ', 30000)}(display: block)${R(')', 30000)}`)).toBe(false);
    expect(matchSupports('not (not (display: block))')).toBe(true);
    expect(matchSupports('(display: block) and (not (display: foo))')).toBe(true);
  });
});

describe('内部実体の展開の上限', () => {
  it('1 つずつは上限の内の実体を、何万回も参照する文書は、分かる文の誤りで止める', () => {
    const n = 20000;
    const xml = `<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY a "${R('x', n * 3)}">]>\n<r>${R('&a;', n)}</r>`;
    const [err, t] = timed(() => {
      try {
        expandInternalEntities(xml);
        return undefined;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(err).toMatch(/内部実体の展開が大きすぎます|expansion of internal entities is too large/);
    expect(t).toBeLessThan(2000);
    // 上限の内なら、前と同じに展開する
    expect(expandInternalEntities('<!DOCTYPE r [<!ENTITY a "x&b;"><!ENTITY b "y">]><r>&a;&a;<![CDATA[&a;]]></r>')).toBe('<!DOCTYPE r [<!ENTITY a "x&b;"><!ENTITY b "y">]><r>xyxy<![CDATA[&a;]]></r>');
  });
});

describe('分綴に渡す語の長さ', () => {
  it('128 字を超える語は分綴しない。それ以下の語は前と同じ', async () => {
    expect(await loadHyphenator('en')).toBeDefined();
    expect(hyphenPositions('hyphenation', 'en')?.length).toBeGreaterThan(0);
    const long = R('hyphenation', 12); // 132 字
    expect(hyphenPositions(long.slice(0, 121), 'en')?.length).toBeGreaterThan(0);
    const [r, t] = timed(() => hyphenPositions(R('hyphenation', 12000), 'en'));
    expect(r).toEqual([]);
    expect(hyphenPositions(long, 'en')).toEqual([]);
    expect(t).toBeLessThan(100);
  });
});

describe('EPUB の zip の読み取り', () => {
  const parseXml = (t: string, type: string) => new DOMParser().parseFromString(t, type) as unknown as Document;
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>';
  const opf = (n: number) => `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest>${Array.from({ length: n }, (_, i) => `<item id="i${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${Array.from({ length: n }, (_, i) => `<itemref idref="i${i}"/>`).join('')}</spine></package>`;
  const ch = (s: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${s}</p></body></html>`;
  /** 中央ディレクトリの k 番目の項目の欄を書き換える */
  const patchCd = (z: Uint8Array, k: number, f: (v: DataView, at: number) => void) => {
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let p = v.getUint32(z.length - 22 + 16, true);
    for (let i = 0; i < k; i++) p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    f(v, p);
    return z;
  };

  it('偽の位置・大きさ、暗号化、ZIP64 の項目は、分かる文の誤り (ZipEntryError) にする', async () => {
    const one = () => makeZip([{ name: 'a', text: 'xyz' }]);
    const err = async (z: Uint8Array) => {
      try {
        await readZip(z)[0].data();
        return undefined;
      } catch (e) {
        return e;
      }
    };
    const bad = await err(patchCd(one(), 0, (v, p) => v.setUint32(p + 42, 0xfffffff0, true)));
    expect(bad).toBeInstanceOf(ZipEntryError);
    expect((bad as Error).message).toMatch(/位置か大きさが壊れています|offset or size/);
    expect(await err(patchCd(one(), 0, (v, p) => v.setUint32(p + 20, 1000, true)))).toBeInstanceOf(ZipEntryError);
    expect(((await err(patchCd(one(), 0, (v, p) => v.setUint16(p + 8, 1, true)))) as Error).message).toMatch(/暗号化|encrypted/);
    expect(((await err(patchCd(one(), 0, (v, p) => v.setUint32(p + 20, 0xffffffff, true)))) as Error).message).toMatch(/ZIP64/);
    expect(new TextDecoder().decode(await readZip(one())[0].data())).toBe('xyz');
    // 壊れた deflate (途中で切れたデータ)
    const cut = patchCd(makeZip([{ name: 'd', text: R('xyz', 1000), deflate: true }]), 0, (v, p) => v.setUint32(p + 20, 3, true));
    expect(((await err(cut)) as Error).message).toMatch(/展開できません|cannot decompress/);
  });

  it('読めない章は飛ばして警告に書き、ほかの章は組む', async () => {
    const z = makeZip([
      { name: 'META-INF/container.xml', text: container },
      { name: 'c.opf', text: opf(2) },
      { name: 'c0.xhtml', text: ch('first') },
      { name: 'c1.xhtml', text: ch('second') },
    ]);
    patchCd(z, 2, (v, p) => v.setUint16(p + 8, 1, true));
    const book = await readEpub(z, parseXml);
    expect(book.html).toContain('second');
    expect(book.html).not.toContain('first');
    expect(book.warnings?.join('\n')).toMatch(/暗号化|encrypted/);
  });

  it('章の字の数の合計が上限を超えたら、その後の章は読まずに警告を出す', async () => {
    const z = makeZip([{ name: 'META-INF/container.xml', text: container }, { name: 'c.opf', text: opf(5) }, ...Array.from({ length: 5 }, (_, i) => ({ name: `c${i}.xhtml`, text: ch(`chapter${i} ${R('x', 1000)}`), deflate: true }))]);
    const book = await readEpub(z, parseXml, { maxTextChars: 3000 });
    expect(book.html).toContain('chapter1');
    expect(book.html).not.toContain('chapter2');
    expect(book.warnings?.join('\n')).toMatch(/3 個の章を読みません|3 chapters/);
    expect((await readEpub(z, parseXml)).html).toContain('chapter4');
  });
});
