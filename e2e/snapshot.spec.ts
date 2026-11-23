/**
 * snapshotDocument (src/snapshot.ts) の結合テスト: ブラウザ向けの 1 ファイル (dist-browser/kumiori.js) を読み、JS で中身を作る小さなページを開いて、
 * ページの中で snapshotDocument → typeset まで行い、写しの中身と、組んだ結果 (Area Tree) を見る。先に npm run build:browser を実行しておく。
 * ページは http://snap.test/sub/page.html に置き (page.route で返す。開発サーバーを通さない)、別の origin は http://other.test で作る。
 * 実の Chart.js・styled-components は使わず、同じ形 (devicePixelRatio 倍で描く canvas・空の <style> への insertRule) を手で作る
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeFontCache } from './fontCache';

const dist = fileURLToPath(new URL('../dist-browser/', import.meta.url));
/** 1×1 の PNG (赤) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/**
 * ページを開く: バンドルとその別ファイル、ページの HTML、画像 (同じ origin の /other/・/img/ と、CORS の無い別の origin) を返す。
 * 書体は e2e/fontCache.ts の決まり (KUMIORI_E2E_FONT_CACHE) で取る。返すのは、ページで起きた誤りの一覧
 */
async function open(page: Page, html: string): Promise<string[]> {
  const built = fs.existsSync(path.join(dist, 'kumiori.js'));
  const reason = 'dist-browser/kumiori.js が無い: 先に npm run build:browser を実行する';
  if (!built && process.env.CI) throw new Error(`${reason} (CI では、このテストを飛ばさずに失敗にする)`);
  if (!built) console.warn(`[skip] ${test.info().title}: ${reason}`);
  test.skip(!built, reason);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeFontCache(page);
  await page.route('http://other.test/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route('http://snap.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/dist-browser/')) {
      const file = path.join(dist, decodeURIComponent(u.pathname.slice('/dist-browser/'.length)));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
    }
    if (u.pathname === '/sub/page.html') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
    if (/\.png$/.test(u.pathname)) return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (u.pathname === '/other/a.css') return route.fulfill({ body: '.linked { color: rgb(0, 0, 255) }', contentType: 'text/css' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://snap.test/sub/page.html');
  return errors;
}

/** 字の色を [r, g, b] にする (Area Tree の color は CSS の色の書き方) */
function rgb(c: string | undefined): number[] {
  if (!c) return [];
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (hex) return hex.slice(1, 4).map((h) => parseInt(h, 16));
  const m = /rgba?\(([^)]*)\)/i.exec(c);
  if (m) return m[1].split(/[\s,/]+/).slice(0, 3).map(Number);
  return c === 'black' ? [0, 0, 0] : [];
}

interface Run {
  html: string;
  files: Array<[string, number, string]>;
  warnings: string[];
  codes: string[];
  args: Array<Record<string, unknown> | undefined>;
  glyphs?: Array<{ text: string; color: string; family: string }>;
  images?: Array<{ src: string; width: number; height: number }>;
  typesetWarnings?: string[];
}

/**
 * ページの中で、選択肢を作る関数 (文字の形で渡す) の選択肢で snapshotDocument を呼び、typeset なら組んで、字と画像の領域を集める
 */
async function snapshot(page: Page, optionsSource = '({})', typeset = false): Promise<Run> {
  return page.evaluate(
    async ({ optionsSource, typeset }) => {
      const url = '/dist-browser/kumiori.js';
      const mod = (await import(/* @vite-ignore */ url)) as typeof import('../src/index');
      const options = (0, eval)(optionsSource);
      const s = await mod.snapshotDocument(document, options);
      const out: Run = {
        html: s.html,
        files: s.options.files.map((f) => {
          const d = f.data as Uint8Array;
          return [f.name, d.length, String.fromCharCode(...d.slice(1, 4))];
        }),
        warnings: s.warnings,
        codes: s.diagnostics.map((d) => d.code),
        args: s.diagnostics.map((d) => d.args),
      };
      if (typeset) {
        const r = await mod.typesetHtml(s.html, { ...s.options });
        out.glyphs = [];
        out.images = [];
        mod.walkAreaTree(r.areaTree, (a) => {
          if (a.type === 'glyph') out.glyphs!.push({ text: a.text, color: a.color, family: a.fontFamily });
          if (a.type === 'image') out.images!.push({ src: a.src, width: a.width, height: a.height });
        });
        out.typesetWarnings = r.warnings;
      }
      return out;
    },
    { optionsSource, typeset },
  );
}

/** 字を順につないだもの */
const textOf = (r: Run) => (r.glyphs ?? []).map((g) => g.text).join('');
/** 字を順につないだ中の、text の初めの字の領域の色 (字の領域は、同じ書体・色の字の並びか 1 字) */
function colorOf(r: Run, text: string): number[] {
  const at = textOf(r).indexOf(text);
  if (at < 0) return [];
  let k = 0;
  for (const g of r.glyphs ?? []) {
    if (at < k + g.text.length) return rgb(g.color);
    k += g.text.length;
  }
  return [];
}

test('snapshotDocument: canvas の絵を PNG にして img に置き換え、CSS の大きさで組む。汚れた canvas は残して警告する', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title><style>canvas { display: block; margin: 0 }</style></head><body>
<canvas id="chart" style="width: 100px; height: 50px">グラフ</canvas><canvas id="tainted" width="20" height="20"></canvas><canvas id="empty" width="0" height="0"></canvas>
<script>
  // Chart.js と同じ形: 画面の devicePixelRatio (ここでは 2) 倍の画素で描き、style で CSS の大きさにする
  const c = document.getElementById('chart'); c.width = 200; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#3366cc'; [20, 60, 40, 80].forEach((h, i) => g.fillRect(10 + i * 45, 100 - h, 30, h));
  const im = new Image(); im.onload = () => { document.getElementById('tainted').getContext('2d').drawImage(im, 0, 0); window.ready = true; }; im.src = 'http://other.test/x.png';
</script></body></html>`,
  );
  const r = await snapshot(page, '({ waitFor: () => window.ready })', true);
  expect(r.files).toEqual([['kumiori-snapshot/canvas-1.png', expect.any(Number), 'PNG']]);
  expect(r.html).toContain('<img id="chart" style="width: 100px; height: 50px" width="200" height="100" data-kumiori-canvas="" alt="グラフ" src="kumiori-snapshot/canvas-1.png">');
  // canvas を名指しした規則は、置き換えた img にも当てる
  expect(r.html).toContain('canvas, img[data-kumiori-canvas] { display: block; margin: 0 }');
  expect(r.html).toMatch(/<canvas id="tainted" width="20" height="20"><\/canvas>/);
  expect(r.codes).toEqual(['snapshot/canvas-tainted']);
  expect(r.args).toEqual([{ element: 'canvas#tainted' }]);
  // 100px × 50px (1px = 0.75pt)
  expect(r.images).toEqual([{ src: 'kumiori-snapshot/canvas-1.png', width: 75, height: 37.5 }]);
  expect(errors).toEqual([]);
});

test('snapshotDocument: CSSOM で足した規則 (insertRule)・作ったスタイルシートを写し、<style> の元の字 (ブラウザの知らない string-set) は残す', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title>
<style id="print">@page { size: 100mm 60mm; margin: 15mm 10mm; @top-center { content: string(head) } } h1 { string-set: head content(); font-size: 12pt }</style>
<style data-styled="active"></style><link rel="stylesheet" href="/other/a.css"></head>
<body><h1>見出し</h1><p class="sc-a">styled</p><p class="adopted">adopted</p><p class="linked">linked</p><p class="gone">gone</p>
<script>
  // styled-components の本番と同じ形: 空の <style> に insertRule で規則を足す
  const sc = document.querySelector('style[data-styled]').sheet; sc.insertRule('.sc-a { color: rgb(255, 0, 0) }', 0);
  document.getElementById('print').sheet.insertRule('.gone { color: rgb(0, 128, 0) }', 1);
  document.getElementById('print').sheet.deleteRule(2);
  const a = new CSSStyleSheet(); a.replaceSync('.adopted { color: rgb(0, 0, 255) }'); document.adoptedStyleSheets = [a];
</script></body></html>`,
  );
  const r = await snapshot(page, '({})', true);
  expect(r.html).toContain('<style id="print">@page { size: 100mm 60mm; margin: 15mm 10mm; @top-center { content: string(head) } } h1 { string-set: head content(); font-size: 12pt }</style><style data-kumiori-cssom="">.gone { color: rgb(0, 128, 0); }</style>');
  expect(r.html).toContain('<style data-kumiori-cssom="">.sc-a { color: rgb(255, 0, 0); }</style>');
  expect(r.html).toContain('<style data-kumiori-adopted="">.adopted { color: rgb(0, 0, 255); }</style>');
  expect(r.html).toContain('<link rel="stylesheet" href="http://snap.test/other/a.css">');
  // CSSOM で消した規則 (h1 の規則) は、元の字から消せないので残す
  expect(r.codes).toEqual(['snapshot/stylesheet-rule-removed']);
  expect(r.args).toEqual([{ count: 1 }]);
  expect(colorOf(r, 'styled')).toEqual([255, 0, 0]);
  expect(colorOf(r, 'adopted')).toEqual([0, 0, 255]);
  expect(colorOf(r, 'linked')).toEqual([0, 0, 255]);
  // 柱 (string-set) に見出しが出る: 見出しの字が、本文の 1 回と、ページごとの柱
  expect(textOf(r).split('見出し').length - 1).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('snapshotDocument: Shadow DOM を平らな木に展開し、影の木のスタイルをその中だけに当てる。閉じた根は shadowRoots で渡したものだけ', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title></head><body>
<h2>外の見出し</h2><my-card><span slot="title">名前付き</span><i>既定の slot</i></my-card><x-closed></x-closed><x-given></x-given>
<script>
  customElements.define('my-card', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = '<style>:host { display: block } h2 { color: rgb(0, 128, 0) } ::slotted(i) { color: rgb(255, 0, 0) }</style><h2><slot name="title">既定の題</slot></h2><div><slot></slot></div><inner-el></inner-el><slot name="none">代わりの中身</slot>';
    const s = new CSSStyleSheet(); s.replaceSync('div { color: rgb(0, 0, 255) }'); r.adoptedStyleSheets = [s]; } });
  customElements.define('inner-el', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<b>入れ子</b>'; } });
  customElements.define('x-closed', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<b style="display: block; height: 20px">閉じた根</b>'; } });
  customElements.define('x-given', class extends HTMLElement { constructor() { super(); window.givenRoot = this.attachShadow({ mode: 'closed' }); window.givenRoot.innerHTML = '<u>渡した根</u>'; } });
</script></body></html>`,
  );
  const r = await snapshot(page, '({ shadowRoots: [window.givenRoot] })', true);
  expect(r.html).toContain('<my-card data-ks-h="1"><h2 data-ks-s="1"><span slot="title" data-ks-sl="1">名前付き</span></h2><div data-ks-s="1"><i data-ks-sl="1">既定の slot</i></div><inner-el data-ks-s="1" data-ks-h="2"><b data-ks-s="2">入れ子</b></inner-el>代わりの中身</my-card>');
  expect(r.html).toContain('<x-closed></x-closed><x-given data-ks-h="3"><u data-ks-s="3">渡した根</u></x-given>');
  expect(r.codes).toEqual(['snapshot/shadow-root-closed']);
  expect(r.args).toEqual([{ element: 'x-closed' }]);
  expect(textOf(r)).toMatch(/外の見出し.*名前付き.*既定の slot.*入れ子.*代わりの中身.*渡した根/);
  expect(textOf(r)).not.toContain('閉じた根');
  // 影の木のスタイルは、その中だけに当たる (外の h2 は緑にならない)
  expect(colorOf(r, '名前付き')).toEqual([0, 128, 0]);
  expect(colorOf(r, '外の見出し')).not.toEqual([0, 128, 0]);
  expect(colorOf(r, '既定の slot')).toEqual([255, 0, 0]);
  expect(errors).toEqual([]);
});

test('snapshotDocument: フォームのいまの値を属性に書き戻す (password・file・hidden の値は書かない)', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title></head><body><form>
<input id="t" value="前"><input id="pw" type="password" value="初め"><input id="cb" type="checkbox"><input id="r1" type="radio" name="r" checked><input id="r2" type="radio" name="r">
<select id="s"><option>一</option><option>二</option></select><textarea id="ta">前の字</textarea><input type="hidden" value="h">
</form><script>
  t.value = '後'; pw.value = '秘密'; cb.checked = true; r2.checked = true; s.selectedIndex = 1; ta.value = '後の字';
</script></body></html>`,
  );
  const r = await snapshot(page);
  expect(r.html).toContain('<input id="t" value="後"><input id="pw" type="password"><input id="cb" type="checkbox" checked=""><input id="r1" type="radio" name="r"><input id="r2" type="radio" name="r" checked="">');
  expect(r.html).toContain('<select id="s"><option>一</option><option selected="">二</option></select><textarea id="ta">後の字</textarea><input type="hidden">');
  expect(r.html).not.toContain('秘密');
  expect(r.html).not.toContain('初め');
  expect(errors).toEqual([]);
});

test('snapshotDocument: blob: の URL の中身を取り込む。消された URL でも、読み終わった img の絵は取り込み、読めないものは警告する', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title></head><body><img id="live"><img id="revoked"><div id="bg" style="width: 10px; height: 10px"></div>
<script>
  fetch('/img/a.png').then((r) => r.blob()).then((b) => {
    live.src = URL.createObjectURL(b);
    const u = URL.createObjectURL(b);
    revoked.onload = () => { URL.revokeObjectURL(u); window.ready = true; };
    revoked.src = u;
    const u2 = URL.createObjectURL(b); bg.style.backgroundImage = 'url(' + u2 + ')'; URL.revokeObjectURL(u2);
  });
</script></body></html>`,
  );
  const r = await snapshot(page, '({ waitFor: () => window.ready })', true);
  expect(r.files.map((f) => f.slice(0, 1).concat(f[2]))).toEqual([
    ['kumiori-snapshot/blob-1.png', 'PNG'],
    ['kumiori-snapshot/blob-2.png', 'PNG'],
  ]);
  expect(r.html).toContain('<img id="live" src="kumiori-snapshot/blob-1.png"><img id="revoked" src="kumiori-snapshot/blob-2.png">');
  expect(r.codes).toEqual(['snapshot/blob-unreadable']);
  expect(String(r.args[0]?.url)).toMatch(/^blob:http:\/\/snap\.test\//);
  expect(r.images?.map((i) => i.src)).toEqual(['kumiori-snapshot/blob-1.png', 'kumiori-snapshot/blob-2.png']);
  expect(errors).toEqual([]);
});

test('snapshotDocument: JS で足した書体 (FontFace) は、fontSources でもらった中身を files と @font-face にする。もらえなければ警告する', async ({ page }) => {
  const errors = await open(page, `<!doctype html><html><head><title>t</title></head><body><p style="font-family: MyFace">Face</p></body></html>`);
  const ready = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ String('/dist-browser/kumiori.js'))) as typeof import('../src/index');
    const spec = mod.DEFAULT_FONTS.base.find((f) => f.family === 'Tinos' && (f.weight ?? 400) === 400)!;
    const buf = await (await fetch(spec.urls.find((u) => u.startsWith('https:'))!)).arrayBuffer();
    const face = new FontFace('MyFace', buf, { weight: '400' });
    document.fonts.add(face);
    await face.load();
    (window as unknown as { faceBuf: ArrayBuffer }).faceBuf = buf;
    return face.status;
  });
  expect(ready).toBe('loaded');
  const given = await snapshot(page, '({ fontSources: (f) => (f.family.replace(/"/g, "") === "MyFace" ? window.faceBuf : undefined) })', true);
  expect(given.files).toEqual([['kumiori-snapshot/font-1.ttf', expect.any(Number), expect.any(String)]]);
  expect(given.html).toContain('<style data-kumiori-fonts="">@font-face { font-family: "MyFace"; src: url("kumiori-snapshot/font-1.ttf") }</style>');
  expect(given.codes).toEqual([]);
  expect(given.typesetWarnings?.filter((w) => w.includes('MyFace'))).toEqual([]);
  const none = await snapshot(page);
  expect(none.codes).toEqual(['snapshot/font-face-source-unknown']);
  expect(none.args).toEqual([{ family: 'MyFace' }]);
  expect(errors).toEqual([]);
});

test('snapshotDocument: 相対の URL を文書の基準で絶対にし、文書の中を指す参照は # の形に残す。srcset は画面で選んだ画像にする', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title><base href="/other/"><style>.bg { background: url(b.png); height: 10px }</style></head><body>
<p><a href="#sec">中</a> <a href="http://snap.test/sub/page.html#sec">同じ文書</a> <a href="next.html">次</a></p>
<img src="a.png" style="width: 10px"><img src="x.png" srcset="c.png 1x, d.png 2x" style="width: 10px"><picture><source srcset="e.png"><img src="f.png" style="width: 10px"></picture>
<div class="bg"></div><svg width="10" height="10"><use href="#i"/><image href="g.png" width="10" height="10"/></svg><h2 id="sec">節</h2></body></html>`,
  );
  const r = await snapshot(page, '({})', true);
  expect(r.html).toContain('<a href="#sec">中</a> <a href="#sec">同じ文書</a> <a href="http://snap.test/other/next.html">次</a>');
  expect(r.html).toContain('<img src="http://snap.test/other/a.png" style="width: 10px"><img src="http://snap.test/other/c.png" style="width: 10px"><picture><img src="http://snap.test/other/e.png" style="width: 10px"></picture>');
  expect(r.html).toContain('.bg { background: url("http://snap.test/other/b.png"); height: 10px }');
  expect(r.html).toContain('<use href="#i"></use><image href="http://snap.test/other/g.png" width="10" height="10"></image>');
  expect(r.html).not.toContain('<base');
  // 絶対にした画像は、Kumiori が取って組む (読めない画像の警告が無い)。インラインの SVG の中の <image> の http の画像は、いまの Kumiori の組版が取らないので見ない
  expect(r.images?.map((i) => i.src)).toEqual(expect.arrayContaining(['http://snap.test/other/a.png', 'http://snap.test/other/c.png', 'http://snap.test/other/e.png']));
  expect(r.typesetWarnings?.filter((w) => w.includes('snap.test') && !w.includes('g.png'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('snapshotDocument: ページの合図 (waitFor) を待つ。待ち切れなければ警告して続け、止める合図 (signal) で止まる', async ({ page }) => {
  const errors = await open(page, `<!doctype html><html><head><title>t</title></head><body><p id="m">読み込み中</p><script>setTimeout(() => { m.textContent = '出来た'; window.done = true; }, 300);</script></body></html>`);
  const waited = await snapshot(page, '({ waitFor: () => window.done })');
  expect(waited.html).toContain('<p id="m">出来た</p>');
  expect(waited.codes).toEqual([]);
  const promised = await snapshot(page, '({ waitFor: new Promise((ok) => setTimeout(ok, 50)) })');
  expect(promised.codes).toEqual([]);
  const timedOut = await snapshot(page, '({ waitFor: () => false, timeoutMs: 200 })');
  expect(timedOut.codes).toEqual(['snapshot/wait-timeout']);
  expect(timedOut.args).toEqual([{ waiting: 'waitFor', ms: 200 }]);
  const aborted = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ String('/dist-browser/kumiori.js'))) as typeof import('../src/index');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    try {
      await mod.snapshotDocument(document, { waitFor: () => false, signal: ac.signal });
      return 'resolved';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(aborted).toBe('AbortError');
  expect(errors).toEqual([]);
});

test('snapshotDocument: script・イベントの扱い手・javascript: の URL・noscript を文字にせず、iframe の中は写さない', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title><meta http-equiv="refresh" content="999"><script type="application/json" id="data">{"token":"鍵"}</script></head><body>
<p onclick="alert(1)">押す</p><a href="javascript:alert(1)">js</a><noscript>JS が無い</noscript><iframe src="frame.html"></iframe><script>window.x = '中の script';</script></body></html>`,
  );
  const r = await snapshot(page);
  for (const s of ['<script', '鍵', 'onclick', 'javascript:', 'noscript', 'JS が無い', 'refresh', '中の script']) expect(r.html).not.toContain(s);
  expect(r.html).toContain('<p>押す</p><a>js</a><iframe src="http://snap.test/sub/frame.html"></iframe>');
  expect(r.codes).toEqual(['snapshot/iframe-skipped']);
  expect(r.args).toEqual([{ src: 'http://snap.test/sub/frame.html' }]);
  expect(errors).toEqual([]);
});

test('snapshotDocument: href を javascript: に動かす SVG のアニメーションと、iframe・object・embed の文書の data: の URL を、写しに残さない', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title></head><body>
<svg width="10" height="10"><a href="#x"><set attributeName="href" to="javascript:alert(1)" begin="indefinite"/><animate attributeName="xlink:href" values="#x;java&#9;script:alert(2)" begin="indefinite"/><animate attributeName="opacity" values="0;1" dur="1s" begin="indefinite"/><rect id="x" width="5" height="5"/></a></svg>
<iframe src="data:text/html,%3Cscript%3Ealert(3)%3C/script%3E"></iframe><object data="data:text/html,%3Cscript%3Ealert(4)%3C/script%3E"></object><embed src="data:image/svg+xml,%3Csvg%20onload%3Dalert(5)%3E%3C/svg%3E">
<object id="o" data="data:image/png;base64,iVBORw0KGgo="></object></body></html>`,
  );
  const r = await snapshot(page);
  for (const s of ['javascript', 'data:text/html', 'data:image/svg+xml', '<set']) expect(r.html).not.toContain(s);
  // href を動かさないアニメーションと、画像の data: は残す
  expect(r.html).toContain('attributeName="opacity"');
  expect(r.html).toContain('data="data:image/png;base64,iVBORw0KGgo="');
  expect(r.html).toContain('<a href="#x">');
  expect(errors).toEqual([]);
});

test('snapshotDocument: 結果は postMessage で Web Worker に送れ、Worker の中で組める', async ({ page }) => {
  const errors = await open(page, `<!doctype html><html><head><title>t</title></head><body><canvas id="c" width="40" height="20"></canvas><p>Worker</p><script>c.getContext('2d').fillRect(0, 0, 40, 20);</script></body></html>`);
  const r = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ String('/dist-browser/kumiori.js'))) as typeof import('../src/index');
    const snap = await mod.snapshotDocument(document);
    const src = `self.onmessage = async ({ data }) => { const m = await import('http://snap.test/dist-browser/kumiori.js'); const r = await m.typesetHtml(data.html, data.options); let images = 0; m.walkAreaTree(r.areaTree, (a) => { if (a.type === 'image') images++; }); self.postMessage({ pages: r.pageCount, images }); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    const got = new Promise<{ pages: number; images: number }>((ok, ng) => {
      w.onmessage = (e) => ok(e.data);
      w.onerror = (e) => ng(new Error(e.message));
    });
    w.postMessage(snap, snap.options.files.map((f) => (f.data as Uint8Array).buffer));
    const out = await got;
    w.terminate();
    return out;
  });
  expect(r).toEqual({ pages: 1, images: 1 });
  expect(errors).toEqual([]);
});

test('snapshotDocument: 隠した javascript: の URL・</style> や --> による差し込み・template の中身・hidden の値を、写しに残さない', async ({ page }) => {
  const errors = await open(
    page,
    `<!doctype html><html><head><title>t</title><style id="a">p { color: black }</style></head><body>
<p><a id="l1" href="java&#9;script:alert(1)">1</a><a id="l2" href="&#1;javascript:alert(2)">2</a><a id="l3" href="javascript&#10;:alert(3)">3</a></p>
<svg width="10" height="10"><a href="java&#10;script:alert(4)"><rect width="5" height="5"/></a></svg><math><mi href="java&#13;script:alert(5)">x</mi></math>
<template><script>window.secret = 'SECRET'</script><img src="x" onerror="alert(6)"><a href="javascript:alert(7)">t</a><p>中身</p></template>
<form><input type="hidden" name="csrf" value="TOKEN123"></form><xmp id="x"></xmp><div id="c"></div>
<script>
  document.getElementById('a').textContent = 'p { color: black } </style><script>window.bad = 1</' + 'script><base href="http://evil.test/">';
  const s = document.createElement('style'); document.head.appendChild(s); s.sheet.insertRule('.q::before { content: "</style><img src=y onerror=alert(8)>" }');
  const ad = new CSSStyleSheet(); ad.replaceSync('.r::before { content: "</style><img src=z onerror=alert(9)>" }'); document.adoptedStyleSheets = [ad];
  document.getElementById('x').textContent = '</xmp><img src=w onerror=alert(10)>';
  document.getElementById('c').appendChild(document.createComment('--><img src=v onerror=alert(11)><!--'));
</script></body></html>`,
  );
  const r = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ String('/dist-browser/kumiori.js'))) as typeof import('../src/index');
    const spec = mod.DEFAULT_FONTS.base.find((f) => f.family === 'Tinos' && (f.weight ?? 400) === 400)!;
    const buf = await (await fetch(spec.urls.find((u) => u.startsWith('https:'))!)).arrayBuffer();
    const face = new FontFace('Evil</style><script>window.bad2 = 1</script>', buf);
    document.fonts.add(face);
    await face.load();
    const snap = await mod.snapshotDocument(document, { fontSources: () => buf });
    // 写しを、Kumiori と同じ DOMParser で読み直して、差し込まれたものが無いかを見る
    const d = new DOMParser().parseFromString(snap.html, 'text/html');
    const all = [...d.querySelectorAll('*'), ...[...d.querySelectorAll('template')].flatMap((t) => [...(t as HTMLTemplateElement).content.querySelectorAll('*')])];
    const clean = (u: string) => u.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
    return {
      html: snap.html,
      scripts: all.filter((e) => e.localName === 'script').length,
      bases: all.filter((e) => e.localName === 'base').length,
      handlers: all.flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${e.localName}[${a.name}]`)),
      jsUrls: all.flatMap((e) => [...e.attributes].filter((a) => /^(java|vb)script:/i.test(clean(a.value))).map((a) => `${e.localName}[${a.name}]`)),
      imgs: all.filter((e) => e.localName === 'img').map((e) => e.getAttribute('src')),
      template: [...d.querySelectorAll('template')].map((t) => (t as HTMLTemplateElement).innerHTML),
    };
  });
  expect(r.scripts).toBe(0);
  expect(r.bases).toBe(0);
  expect(r.handlers).toEqual([]);
  expect(r.jsUrls).toEqual([]);
  // 差し込まれた img (y・z・w・v) は無い。template の中の img は、イベントの扱い手を取り除いて写す
  expect(r.imgs).toEqual(['http://snap.test/sub/x']);
  expect(r.template).toEqual(['<img src="http://snap.test/sub/x"><a>t</a><p>中身</p>']);
  // template の中の script の中身と、hidden の値は写さない (CSS の字の中の </style の後ろは、逃がした字として残るが、要素にはならない: 上の scripts)
  for (const s of ['SECRET', 'TOKEN123']) expect(r.html).not.toContain(s);
  // 逃がした字は、CSS としては同じ (Kumiori が読む規則の中身は変わらない)
  expect(r.html).toContain('content: "<\\/style><img src=y onerror=alert(8)>"');
  expect(errors).toEqual([]);
});

test('snapshotDocument: 止める合図で止めたら、waitFor を呼ぶのをやめる', async ({ page }) => {
  const errors = await open(page, `<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>`);
  const r = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ String('/dist-browser/kumiori.js'))) as typeof import('../src/index');
    const ac = new AbortController();
    let calls = 0;
    setTimeout(() => ac.abort(), 100);
    const name = await mod.snapshotDocument(document, { waitFor: () => (calls++, false), signal: ac.signal }).then(
      () => 'resolved',
      (e) => (e as Error).name,
    );
    const atAbort = calls;
    await new Promise((ok) => setTimeout(ok, 300));
    return { name, atAbort, later: calls };
  });
  expect(r.name).toBe('AbortError');
  expect(r.later - r.atAbort).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
