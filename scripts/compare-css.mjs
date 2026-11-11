#!/usr/bin/env node
/**
 * compare-css — 自前の CSS のカスケード (src/cssCascade.ts) の計算値を、ブラウザ (Chromium) の getComputedStyle と比べる。
 *
 * 使い方:
 *   node scripts/compare-css.mjs --html <HTML ファイル> [--css a.css,b.css] [--style kumiori|browser|browser-margin|ah] [--out <出力先>] [--examples 3]
 *   node scripts/compare-css.mjs --list <見本の一覧.json> [--out <出力先>]
 *
 *  - --web-fonts: 既定の Web フォントのディレクトリ (compare-pdf.mjs と同じ)。無いと、画面の準備完了を待たずに比べる (書体は計算値に関係しない)
 *  - --list: [{ "html": "…", "css": "a.css", "style": "browser" }, …] の見本を、サーバーとブラウザを 1 度だけ起動して続けて比べる (速い)。
 *
 *  - HTML と同じディレクトリ (と下のディレクトリ) の CSS・画像・書体を、画面の「読み込む」で一緒に選んで読み込む (compare-pdf.mjs と同じ)。
 *  - 画面が HTML を見えない iframe に読み込んだところで (window.__kumioriOnHtmlLoaded)、文書のすべての要素 (と ::before / ::after) について、
 *    htmlImport が読む性質を、ブラウザの値と自前のカスケードの値で比べる。
 *  - 幅・高さなど、ブラウザがレイアウトした寸法 (使用値) を返す性質で、自前が auto・min-content などのもの、flex・grid の項目、
 *    min- / max- の制約のある要素、表示されない要素 (ブラウザは指定値のまま返す) は「使用値」として別に数える (違いには数えない)。
 *  - 結果は <出力先>/<名前>.css-diff.json と .md (違いの多い性質の順に、例を添えて)。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
if (!args.html && !args.list) {
  console.error('usage: node scripts/compare-css.mjs --html <file> [--css a.css] [--style browser] [--out <dir>]  |  --list <samples.json>');
  process.exit(1);
}
/** 比べる見本 (--list なら一覧、無ければ --html の 1 つ) */
const samples = args.list ? JSON.parse(fs.readFileSync(args.list, 'utf8')) : [{ html: args.html, css: args.css, style: args.style }];
const outDir = path.resolve(args.out ?? 'compare-css-out');
fs.mkdirSync(outDir, { recursive: true });

/** htmlImport が読む性質 */
const PROPS = `background-color background-image background-repeat background-position-x background-position-y background-size display position float clear z-index
top right bottom left width height box-sizing margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style
border-top-color border-right-color border-bottom-color border-left-color border-collapse table-layout vertical-align
font-family font-size font-weight font-style font-stretch font-variant font-variant-caps font-variant-numeric font-kerning font-feature-settings
line-height letter-spacing text-align text-align-last text-indent text-decoration-line white-space hyphens direction writing-mode text-combine-upright
text-spacing-trim text-autospace list-style-type list-style-position color object-fit content counter-reset counter-increment counter-set
break-before break-after break-inside page-break-before page-break-after page-break-inside column-count column-width column-gap column-rule-width
column-rule-style column-rule-color column-span column-fill flex-direction justify-content align-items align-self`.split(/\s+/);

const port = Number(args.port ?? 5176);
// npx を通すと、npx を止めても vite が残るので、vite を直接起動する
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
// 前の実行の vite が残っていると、そちら (古いコード) で比べてしまうので止める
server.on('exit', (code) => {
  if (code) {
    console.error(`vite が起動できませんでした (ポート ${port} が使われています)`);
    process.exit(1);
  }
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
  } catch {
    /* まだ */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
// 既定の Web フォント: --web-fonts があれば手元のファイルから (compare-pdf.mjs と同じ)。無ければ読まない (書体は計算値に関係しない)
if (args['web-fonts']) {
  const dir = args['web-fonts'];
  await page.route('**/fonts.gstatic.com/**', (route) => {
    const u = route.request().url();
    const f = u.includes('/tinos/')
      ? u.includes('buE1')
        ? 'tinos700.ttf'
        : 'tinos400.ttf'
      : u.includes('/arimo/')
        ? u.includes('CstsBw')
          ? 'arimo700.ttf'
          : 'arimo400.ttf'
        : u.includes('notoserifjp')
          ? (u.includes('zWPebA') && fs.existsSync(path.join(dir, 'notoserif700.ttf')) ? 'notoserif700.ttf' : 'notoserif.ttf')
          : u.includes('VFPYk75s')
            ? 'notosans700.ttf'
            : 'notosans.ttf';
    return route.fulfill({ body: fs.readFileSync(path.join(dir, f)), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
  });
} else await page.route('**/fonts.gstatic.com/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
await page.goto(`http://127.0.0.1:${port}/`);
// 既定の書体を読めないと画面は「準備完了」にならないが、HTML の読み込みはできる (待つのは短く)
await page.waitForSelector('html[data-ready="1"]', { timeout: args['web-fonts'] ? 180_000 : 15_000 }).catch(() => {});

async function load(sample) {
  const dir = path.dirname(sample.html);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const onlyCss = sample.css ? new Set(sample.css.split(',').map((c) => path.basename(c).toLowerCase())) : undefined;
  for (const name of onlyCss ?? []) {
    const file = walk(dir).find((f) => path.basename(f).toLowerCase() === name);
    if (!file) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) onlyCss.add(path.basename(m[1]).toLowerCase());
  }
  const files = [
    sample.html,
    ...walk(dir).filter((f) => f !== sample.html && /\.(css|png|jpe?g|gif|svg|webp|otf|ttf)$/i.test(f) && (!onlyCss || !/\.css$/i.test(f) || onlyCss.has(path.basename(f).toLowerCase()))),
  ];
  // 既定のスタイル: change を起こすと前の見本を組み直してしまうので、値だけ変える (次の読み込みで使われる)
  await page.evaluate((v) => (document.getElementById('htmlstyle').value = v), sample.style ?? 'browser');
  // ブラウザの計算値と比べるので、CSS の解釈はブラウザ (iframe) にする
  await page.evaluate(() => (document.getElementById('cssengine').value = 'browser'));

  // 画面が HTML を読み込んだところで、比べる
  await page.evaluate((props) => {
    window.__kumioriOnHtmlLoaded = async (loaded) => {
      try {
        await run(loaded);
      } catch (e) {
        window.__cssDiff = { error: String(e?.stack ?? e) };
      }
    };
    const run = async (loaded) => {
      const { cascadeStyles } = await import('/src/cssCascade.ts');
      const win = loaded.doc.defaultView;
      const t0 = performance.now();
      const ours = cascadeStyles(loaded.doc, loaded.css, {
        viewport: { width: win.innerWidth, height: win.innerHeight },
        // Chrome の既定の等幅の書体の大きさ (13px) に合わせる
        monospaceSize13: true,
      });
      const els = [loaded.doc.documentElement, ...loaded.doc.documentElement.querySelectorAll('*')];
      const pathOf = (el) => {
        const parts = [];
        for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
          const id = e.id ? `#${e.id}` : '';
          const cls = e.classList?.length ? `.${[...e.classList].slice(0, 2).join('.')}` : '';
          parts.unshift(`${e.localName}${id}${cls}`);
        }
        return parts.join(' > ');
      };
      const rows = [];
      let n = 0;
      for (const el of els) {
        for (const pseudo of [undefined, '::before', '::after']) {
          const b = win.getComputedStyle(el, pseudo);
          if (pseudo && (b.content === 'none' || b.content === 'normal')) continue;
          const o = ours.style(el, pseudo);
          n++;
          // 幅・高さがレイアウトで決まる理由: flex・grid の項目、min- / max- の制約、箱が無い (表示されない要素は指定値のまま返る)
          const pd = el.parentElement && !pseudo ? win.getComputedStyle(el.parentElement).display : '';
          const layout = /flex|grid/.test(pd)
            ? 'flex'
            : !/^(none|)$/.test(b.maxWidth) || !/^(none|)$/.test(b.maxHeight) || !/^(0px|auto|)$/.test(b.minWidth) || !/^(0px|auto|)$/.test(b.minHeight)
              ? 'minmax'
              : !pseudo && el.getClientRects().length === 0
                ? 'hidden'
                : '';
          for (const p of props) rows.push([pathOf(el) + (pseudo ?? ''), p, b.getPropertyValue(p), o.getPropertyValue(p), layout]);
        }
      }
      window.__cssDiff = { rows, elements: n, ms: performance.now() - t0 };
    };
  }, PROPS);

  await page.evaluate(() => (window.__cssDiff = undefined));
  await page.setInputFiles('#fofile', files);
  await page.waitForFunction(() => window.__cssDiff, null, {
    timeout: 600_000,
  });
  return page.evaluate(() => window.__cssDiff);
}

// ── 比べる ──
const num = (v) => (/^-?[\d.]+(e-?\d+)?px$/.test(v) ? parseFloat(v) : undefined);
const rgba = (v) => {
  const m = /^rgba?\(([^)]*)\)$/.exec(v.trim());
  if (!m) return undefined;
  const p = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const norm = (v) =>
  v
    .trim()
    .toLowerCase()
    .replace(/["']/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/url\("?([^")]*)"?\)/g, (_m, u) => `url(${u.split(/[?#]/)[0].split('/').pop()})`);
const USED = new Set(['width', 'height', 'top', 'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'column-width']);
const same = (p, a, b) => {
  if (a === b) return true;
  const na = num(a);
  const nb = num(b);
  if (na !== undefined && nb !== undefined) return Math.abs(na - nb) <= Math.max(0.05, Math.abs(na) * 0.002);
  const ca = rgba(a);
  const cb = rgba(b);
  if (ca && cb) return ca.every((x, k) => Math.abs(x - cb[k]) <= (k === 3 ? 0.01 : 1));
  return norm(a) === norm(b);
};
let failed = false;
for (const sample of samples) {
  const result = await load(sample);
  if (result.error) {
    console.error(`${sample.html}: ${result.error}`);
    failed = true;
    continue;
  }
  const { rows, elements, ms } = result;
  const byProp = new Map();
  let diffs = 0;
  let used = 0;
  for (const [el, p, b, o, layout] of rows) {
    if (same(p, b, o)) continue;
    // 使用値: 自前が auto・中身で決まる幅 (min-content など)・% (表の列の幅) のもの、レイアウトで決まる要素 (flex・grid の項目・min- / max- の制約・表示されない要素)
    if (USED.has(p) && ((num(b) !== undefined && /^(auto|min-content|max-content|fit-content|)$|%$/.test(o)) || (layout && (p === 'width' || p === 'height')))) {
      used++;
      continue;
    }
    diffs++;
    const e = byProp.get(p) ?? { count: 0, examples: [] };
    e.count++;
    if (e.examples.length < Number(args.examples ?? 3)) e.examples.push({ el, browser: b, ours: o });
    byProp.set(p, e);
  }
  const name = path.basename(sample.html).replace(/\.x?html?$/i, '');
  const sorted = [...byProp.entries()].sort((a, b) => b[1].count - a[1].count);
  const summary = {
    name,
    elements,
    values: rows.length,
    diffs,
    used,
    rate: diffs / rows.length,
    ms: Math.round(ms),
    props: Object.fromEntries(sorted),
  };
  fs.writeFileSync(path.join(outDir, `${name}.css-diff.json`), JSON.stringify(summary, null, 2));
  const md = [
    `# ${name}: 要素 ${elements}・値 ${rows.length}・違い ${diffs} (${((100 * diffs) / rows.length).toFixed(2)}%)・使用値 ${used}・カスケード ${Math.round(ms)}ms`,
    '',
    '| 性質 | 違い | 例 (要素: ブラウザ / 自前) |',
    '|---|---|---|',
    ...sorted.map(([p, e]) => `| ${p} | ${e.count} | ${e.examples.map((x) => `\`${x.el}\`: \`${x.browser}\` / \`${x.ours}\``).join('<br>')} |`),
  ];
  fs.writeFileSync(path.join(outDir, `${name}.css-diff.md`), md.join('\n') + '\n');
  console.log(md[0]);
  for (const [p, e] of sorted.slice(0, Number(args.top ?? 15))) console.log(`  ${p}: ${e.count}  例 ${e.examples[0].el}: ${e.examples[0].browser} / ${e.examples[0].ours}`);
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
