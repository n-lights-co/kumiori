#!/usr/bin/env node
/**
 * measure-result-memory — 組んだ結果 (TypesetResult) と Typesetter のメモリの見積もり (memoryUsage) が、実際に手放して減る量と
 * どれだけ合うかを測る。見積もりの係数 (src/areaTree.ts の AREA_TREE_BYTES・src/fontManager.ts の FONT_TABLE_BYTES_PER_FILE_BYTE・
 * src/layoutEngine.ts の REUSE_BYTES) を決め直すための道具。
 *
 * 使い方 (リポジトリの直下で):
 *   node scripts/measure-result-memory.mjs [--doc <名前>]... [--no-build] [--json <file>]
 *   node scripts/measure-result-memory.mjs --browser [--doc <名前>]... [--no-build] [--json <file>]
 *
 *  - --doc: 測る文書 (何度でも)。既定は web:3・web:20・web:200・html-spec・fo-spec・text:1500
 *      web:<ページ>  … プレビューの使い方をまねた HTML (作る): 共通の CSS に @font-face の TrueType の書体 3 つ (Arimo・Arimo Bold・Cousine。
 *                       .cache/fonts のもの)、1 ページに見出し・段落 6 つ・画像 1.7 枚ほど (どれも違う中身の 300×200 の PNG)
 *      html-spec・fo-spec … 対応仕様説明書の HTML と XSL-FO (scripts/measure-memory.mjs と同じ読み方)
 *      text:<節の数>  … 文だけの文書 (scripts/measure-memory.mjs と同じ)
 *      toc:<節の数>   … 文だけの文書の前に、節ごとのページ番号の目次 (target-counter) を置いたもの (組み直しの 2 回目からの回の字の差し替えがある)
 *    名前の後ろに +noreuse を付けると Typesetter の再利用なしで、+noface を付けると (web の文書で) @font-face を使わずに、
 *    +linesfirst を付けると、再利用のキャッシュを行分け → 前の文書のページの順に手放して測る
 *    (係数を、再利用のキャッシュと書体の分を除いて決めるため)
 *  - --browser: Node でなく、Chromium (KUMIORI_CHROMIUM。無ければ Playwright の既定) の Web Worker の中で測る
 *    (片付けと量は、Worker の CDP の HeapProfiler.collectGarbage と Runtime.getHeapUsage の usedSize。usedSize には外のバイト列
 *    (ArrayBuffer の中身) が入らないので、画像と書体のファイルの分は数えられない: 係数 (領域・書体の表・キャッシュ) を Node と比べる)
 *  - --no-build: 前に作ったビルドを使う
 *
 * 測り方 (どちらも同じ): 使う側 (印刷プレビュー) と同じ条件にする。Typesetter は 1 つで再利用あり (既定の reuse)、
 * 画像と書体と CSS は resolveResource で渡し、資源は先に読んでおいて、何度問い合わせても同じ ArrayBuffer を返す。
 *  1. Typesetter を作り、片付けてから量を見る (以下「見る」は、タスクを 1 つ待ってから gc() を 2 回して、heapUsed + arrayBuffers)
 *  2. 文書を組む (結果 A)。見る。もう 1 度、同じ文書を組む (結果 B: 再利用のキャッシュが温まった後の 1 件)。見る
 *  3. B を dispose して見る (直近の結果)。A を dispose して見る (前の結果: 再利用のキャッシュが参照しない)
 *  4. Typesetter の再利用のキャッシュを、前の文書のページ・行分け・書体の下ごしらえの順に手放して、それぞれ見る (中を直に触る)
 * 見積もり (memoryUsage) は、2 の後に読む。結果の dispose で減った量は、A の分 (前の結果) を見積もりと比べる
 * (B は、書体の表を再利用のキャッシュも参照するので、次の文書を組むまで、その分が残る)。
 *
 * docs/development.md の「組んだ結果のメモリの見積もりの測り」に、測った値と読み方を書いてある。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.cache', 'measure-result-memory-build');
const browserDir = path.join(root, '.cache', 'measure-result-memory-browser');
const DEFAULT_DOCS = ['web:3', 'web:20', 'web:200', 'html-spec', 'fo-spec', 'text:1500'];

// ── 子のプロセス (Node): 1 つの文書を測って、JSON で書く
if (process.argv[2] === '--child') {
  const name = process.argv[3];
  const lib = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
  const { createFontLoader } = await import(pathToFileURL(path.join(outDir, 'node.js')).href);
  const engine = await import(pathToFileURL(path.join(outDir, 'layoutEngine.js')).href);
  const doc = await loadDoc(name);
  const loadFont = createFontLoader({ cacheDir: fontDir(), log: () => {} });
  const live = async () => {
    await new Promise((r) => setTimeout(r, 0));
    globalThis.gc();
    globalThis.gc();
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
  };
  const row = await measure({ lib, engine, doc, loadFont, live });
  process.stdout.write(JSON.stringify({ doc: name, runtime: `Node ${process.versions.node}`, ...row }) + '\n');
  process.exit(0);
}

/**
 * 1 つの文書を測る (Node の子のプロセスと、ブラウザの Worker の中で同じものを使う。ブラウザでは、この関数の字を Worker に送って動かす)。
 * lib: Kumiori の入口、engine: layoutEngine のモジュール (再利用のキャッシュを直に触る)、doc: { text, setup, options, resources }、live: 生きている量
 */
async function measure({ lib, engine, doc, loadFont, live }) {
  // Typesetter の再利用のキャッシュ (SharedLineMemo) を捕まえる (組み始めに呼ぶ startDocument で)
  let memo;
  const start = engine.SharedLineMemo.prototype.startDocument;
  engine.SharedLineMemo.prototype.startDocument = function () {
    memo = this;
    return start.call(this);
  };
  const resources = doc.resources;
  const resolveResource = async (url) => resources.get(url) ?? resources.get(url.split(/[?#]/)[0].split('/').pop());
  const ts = await lib.createTypesetter({ loadFont, ...doc.setup, ...(doc.noReuse ? { reuse: false } : {}) });
  const options = { ...doc.options, resolveResource };
  const usage0 = ts.memoryUsage();
  const m0 = await live();
  const t0 = Date.now();
  const a = await ts.typeset(doc.text, options);
  const ms = Date.now() - t0;
  const m1 = await live();
  const b = await ts.typeset(doc.text, options);
  const m2 = await live();
  // memoryUsage の 1 回あたりの時間 (ミリ秒): 初めの 1 回 (B。エリアツリーを数える) と、2 回目から (A。何度も呼ぶとき) の平均
  let tu = performance.now();
  const usageB = b.memoryUsage();
  const usageFirstMs = performance.now() - tu;
  const usageA = a.memoryUsage();
  const REPEAT = 200;
  tu = performance.now();
  for (let i = 0; i < REPEAT; i++) a.memoryUsage();
  const usageRepeatMs = (performance.now() - tu) / REPEAT;
  const usageT = ts.memoryUsage();
  // 数 (係数を決めるため)。前の文書の組版を、この関数の変数に持たない (持つと、手放しても減らない)
  const counts = countsOf(lib, a, memo);
  b.dispose();
  const m3 = await live();
  a.dispose();
  const m4 = await live();
  // 再利用のキャッシュを、前の文書のページ → 行分け → 書体の下ごしらえの順に手放す (+linesfirst では、行分けを先に)。
  // 前の文書のページと行分けのキャッシュは、行の節を共有するので、先に手放した側では、共有の分が減らない
  const prevBytes = memo?.layout.memoryBytes() ?? 0;
  const lineBytes = memo ? memo.memoryBytes() - prevBytes : 0;
  const dropPrev = () => memo && (memo.layout.prev = undefined);
  const dropLines = () => {
    if (!memo) return;
    const keep = memo.layout.prev;
    memo.clear();
    memo.layout.prev = keep;
  };
  (doc.linesFirst ? dropLines : dropPrev)();
  const m5 = await live();
  (doc.linesFirst ? dropPrev : dropLines)();
  const m6 = await live();
  const prepBytes = ts.memoryUsage().caches;
  ts.releaseCaches();
  const m7 = await live();
  // 手放した後も組める (時間は初めて組むときと同じほど)
  const t1 = Date.now();
  const c = await ts.typeset(doc.text, options);
  const msAfterRelease = Date.now() - t1;
  const samePages = c.pageCount === counts.pages;
  c.dispose();
  engine.SharedLineMemo.prototype.startDocument = start;
  const MB = (n) => Math.round((n / 1048576) * 10) / 10;
  const est = (u) => ({ total: MB(u.total), images: MB(u.images), fonts: MB(u.fonts), layout: MB(u.layout) });
  return {
    counts,
    seconds: Math.round(ms / 100) / 10,
    secondsAfterRelease: Math.round(msAfterRelease / 100) / 10,
    samePages,
    /** memoryUsage の 1 回あたりの時間 (ミリ秒): first は結果ごとの初めの 1 回、repeat は 2 回目から */
    usageMs: { first: Math.round(usageFirstMs * 1000) / 1000, repeat: Math.round(usageRepeatMs * 1000) / 1000 },
    /** 実際の量 (MB) */
    measured: {
      /** 結果を 2 つ組んだ後に増えた量 (Typesetter の増えた分 + 結果 2 つ) */
      held: MB(m2 - m0),
      resultA: MB(m1 - m0),
      resultB: MB(m2 - m1),
      freedB: MB(m2 - m3),
      freedA: MB(m3 - m4),
      freedPrev: MB(doc.linesFirst ? m5 - m6 : m4 - m5),
      freedLines: MB(doc.linesFirst ? m4 - m5 : m5 - m6),
      freedPrep: MB(m6 - m7),
      /** 全部を手放した後に、組む前より残った量 (ほかのキャッシュ) */
      left: MB(m7 - m0),
    },
    /** 見積もり (MB) */
    estimated: {
      /** Typesetter の増えた分 + 結果 2 つ */
      held: MB(usageT.total - usage0.total + usageA.total + usageB.total),
      resultA: est(usageA),
      resultB: est(usageB),
      typesetter: { total: MB(usageT.total), fonts: MB(usageT.fonts), caches: MB(usageT.caches), fontsAdded: MB(usageT.fonts - usage0.fonts) },
      prev: MB(prevBytes),
      lines: MB(lineBytes),
      prep: MB(prepBytes),
    },
  };
}

/** 係数を決めるための数: ページ・領域・構造の木の節・前の文書のページの論理の木の節と入力の節・行分けのキャッシュの大きさ */
function countsOf(lib, a, memo) {
  let areas = 0;
  lib.walkAreaTree(a.areaTree, () => void areas++);
  const struct = a.areaTree.structure;
  const prev = memo?.layout.prev;
  let lnodes = 0;
  if (prev) {
    const seen = new Set();
    const walk = (x) => {
      if (seen.has(x)) return;
      seen.add(x);
      lnodes++;
      for (const c of x.children) walk(c);
    };
    for (const q of prev.seqs) for (const p of q?.memo.built ?? []) (walk(p.root), p.abs.forEach(walk));
  }
  return { pages: a.pageCount, areas, structNodes: struct?.nodes.length ?? 0, tags: struct?.tags.length ?? 0, prevLNodes: lnodes, prevInputs: prev?.nodes.length ?? 0, prevUndo: (prev?.undo?.glyphs.size ?? 0) + (prev?.undo?.cites.size ?? 0), lineAtoms: memo?.atoms ?? 0, docGlyphs: 0 };
}

// ── 親のプロセス
const args = { docs: [], build: true, json: undefined, browser: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i] ?? usage(`${a} に値がありません`);
  if (a === '--doc') args.docs.push(v());
  else if (a === '--no-build') args.build = false;
  else if (a === '--json') args.json = v();
  else if (a === '--browser') args.browser = true;
  else usage(`知らない引数: ${a}`);
}
function usage(message) {
  if (message) console.error(message);
  console.error('使い方: node scripts/measure-result-memory.mjs [--browser] [--doc <名前>]... [--no-build] [--json <file>]');
  process.exit(2);
}
if (!args.docs.length) args.docs = DEFAULT_DOCS;

const { build } = await import('vite');
if (args.build || !fs.existsSync(path.join(outDir, 'index.js'))) {
  // 名前を残し、ソースのファイルごとに分けたビルド (scripts/measure-memory.mjs と同じ作り)
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      ssr: true,
      rolldownOptions: { input: { index: 'src/index.ts', node: 'src/node.ts', layoutEngine: 'src/layoutEngine.ts' }, output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' } },
    },
  });
}

const rows = [];
if (args.browser) rows.push(...(await runBrowser(args.docs)));
else
  for (const doc of args.docs) {
    const r = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', fileURLToPath(import.meta.url), '--child', doc], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    const line = r.stdout.trim().split('\n').pop();
    if (r.status !== 0 || !line?.startsWith('{')) {
      console.error(`${doc}: 失敗しました\n${r.stderr.slice(-3000)}`);
      rows.push({ doc, failed: true });
      continue;
    }
    rows.push(JSON.parse(line));
    console.error(`${doc}: ${line}`);
  }

const head = ['文書', '処理系', 'ページ', '領域', '持った量 (実際・見積もり)', '結果 A・B の dispose で減った量', '結果の見積もり (画像・書体・木)', 'キャッシュの見積もり (ページ・行分け・下ごしらえ)', 'キャッシュの段ごとに減った量', '残り', 'memoryUsage の時間 (初め・2 回目から。ms)'];
console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
for (const r of rows) {
  if (r.failed) {
    console.log(`| ${r.doc} | 失敗 |`);
    continue;
  }
  const e = r.estimated;
  const m = r.measured;
  console.log(
    `| ${r.doc} | ${r.runtime} | ${r.counts.pages} | ${r.counts.areas} | ${m.held}・${e.held} | ${m.freedA}・${m.freedB} | ${e.resultA.total} (${e.resultA.images}・${e.resultA.fonts}・${e.resultA.layout}) | ${e.typesetter.caches} (${e.prev}・${e.lines}・${e.prep}) | ${m.freedPrev}・${m.freedLines}・${m.freedPrep} | ${m.left} | ${r.usageMs?.first ?? '—'}・${r.usageMs?.repeat ?? '—'} |`,
  );
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 2));

// ── ブラウザ (Chromium の Web Worker) で測る
async function runBrowser(docs) {
  const { chromium } = await import('playwright');
  // Worker に読み込むビルド (ブラウザ向けの 1 つのファイル) と、measure を動かす Worker の本体
  if (args.build || !fs.existsSync(path.join(browserDir, 'worker.js'))) {
    fs.mkdirSync(browserDir, { recursive: true });
    const entry = path.join(browserDir, 'entry.mjs');
    fs.writeFileSync(entry, `export * as lib from ${JSON.stringify(path.join(root, 'src', 'index.ts'))};\nexport * as engine from ${JSON.stringify(path.join(root, 'src', 'layoutEngine.ts'))};\n`);
    await build({
      // ブラウザ向けの 1 ファイルのビルド (npm run build:browser) と同じ設定 (Worker の中で HTML を読む linkedom の差し替えなど) で、入口だけを変える
      configFile: path.join(root, 'vite.browser.config.ts'),
      root,
      logLevel: 'warn',
      build: { outDir: browserDir, emptyOutDir: false, minify: false, sourcemap: false, lib: { entry, formats: ['es'], fileName: () => 'worker-lib.js' } },
    });
    fs.writeFileSync(
      path.join(browserDir, 'worker.js'),
      [
        "import { lib, engine } from './worker-lib.js';",
        measure.toString(),
        countsOf.toString(),
        'let probed;',
        'self.onmessage = async (ev) => {',
        "  if (ev.data.type === 'heap') return probed?.(ev.data.bytes);",
        // 中身は、ページの側の決まった URL (Node が返す) から、組む前に取っておく (大きな中身を page.evaluate で渡すと、ページが落ちる)
        '  const { text, setup: setup0, options, resourceKeys, fontKeys, noReuse, linesFirst } = ev.data;',
        "  const get = async (kind, k) => { const r = await fetch('/' + kind + '/' + encodeURIComponent(k)); return r.headers.get('x-text') ? await r.text() : await r.arrayBuffer(); };",
        "  const resources = []; for (const k of resourceKeys) resources.push([k, await get('res', k)]);",
        "  const fonts = []; for (const k of fontKeys) fonts.push([k, await get('font', k)]);",
        "  const setup = { ...setup0, ...(setup0.fontNames ? { fonts: await Promise.all(setup0.fontNames.map(async (n) => ({ name: n, data: new Uint8Array(await get('setup', n)) }))) } : {}) };",
        '  const fontMap = new Map(fonts);',
        "  const loadFont = async (spec) => fontMap.get(spec.family + '|' + (spec.weight ?? 400));",
        // 量は、ページの側が CDP で Worker の Runtime.getHeapUsage を読み、送り返す (片付けも CDP の HeapProfiler.collectGarbage)
        "  const live = async () => { await new Promise((r) => setTimeout(r, 0)); const p = new Promise((r) => (probed = r)); self.postMessage({ type: 'probe' }); return await p; };",
        '  try {',
        '    const row = await measure({ lib, engine, doc: { text, setup, options, resources: new Map(resources), noReuse, linesFirst }, loadFont, live });',
        "    self.postMessage({ type: 'done', row });",
        '  } catch (e) {',
        "    self.postMessage({ type: 'error', message: String((e && e.stack) || e) });",
        '  }',
        '};',
      ].join('\n'),
    );
  }
  const exe = process.env.KUMIORI_CHROMIUM;
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const out = [];
  try {
    const { createFontLoader } = await import(pathToFileURL(path.join(outDir, 'node.js')).href);
    const { DEFAULT_FONTS } = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
    const loader = createFontLoader({ cacheDir: fontDir(), log: () => {} });
    // 既定の書体 (と、文書が使う数式・等幅・記号・絵文字の書体) を先に読んで、Worker に渡す
    const specs = [...DEFAULT_FONTS.base, ...(DEFAULT_FONTS.mono ?? []), DEFAULT_FONTS.symbol, DEFAULT_FONTS.emoji, DEFAULT_FONTS.math].filter(Boolean);
    const fonts = [];
    for (const sp of specs) {
      const buf = await loader(sp).catch(() => undefined);
      if (buf) fonts.push([`${sp.family}|${sp.weight ?? 400}`, buf]);
    }
    for (const name of docs) {
      const doc = await loadDoc(name);
      const page = await browser.newPage();
      const fontMap = new Map(fonts);
      const setupFonts = new Map((doc.setup.fonts ?? []).map((f) => [f.name, f.data]));
      await page.route('http://kumiori.test/**', (route) => {
        const [, kind, key] = new URL(route.request().url()).pathname.split('/');
        const k = key === undefined ? undefined : decodeURIComponent(key);
        const v = kind === 'res' ? doc.resources.get(k) : kind === 'font' ? fontMap.get(k) : kind === 'setup' ? setupFonts.get(k) : undefined;
        if (v !== undefined) return route.fulfill({ status: 200, headers: typeof v === 'string' ? { 'x-text': '1', 'content-type': 'text/plain' } : { 'content-type': 'application/octet-stream' }, body: typeof v === 'string' ? v : Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v) });
        const rel = new URL(route.request().url()).pathname.slice(1);
        const f = path.join(browserDir, rel);
        if (!rel || !fs.existsSync(f)) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>measure</title>' });
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
      });
      await page.goto('http://kumiori.test/');
      // Worker の CDP: 自動の接続 (flatten なし) で Worker の目標につなぎ、sendMessageToTarget で送る
      const cdp = await page.context().newCDPSession(page);
      let target;
      let seq = 0;
      const waiting = new Map();
      cdp.on('Target.attachedToTarget', (e) => {
        if (e.targetInfo.type === 'worker') target = e.sessionId;
      });
      cdp.on('Target.receivedMessageFromTarget', (e) => {
        const m = JSON.parse(e.message);
        if (m.id !== undefined && waiting.has(m.id)) (waiting.get(m.id)(m.result), waiting.delete(m.id));
      });
      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const id = ++seq;
          waiting.set(id, resolve);
          void cdp.send('Target.sendMessageToTarget', { sessionId: target, message: JSON.stringify({ id, method, params }) });
        });
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
      await page.exposeFunction('probeHeap', async () => {
        await send('HeapProfiler.collectGarbage');
        await send('HeapProfiler.collectGarbage');
        const r = await send('Runtime.getHeapUsage');
        return r.usedSize;
      });
      const result = await page.evaluate(
        async (data) =>
          await new Promise((resolve) => {
            const w = new Worker('/worker.js', { type: 'module' });
            w.onmessage = async (ev) => {
              const d = ev.data;
              if (d.type === 'probe') w.postMessage({ type: 'heap', bytes: await window.probeHeap() });
              else if (d.type === 'done') resolve(d.row);
              else if (d.type === 'error') resolve({ error: d.message });
            };
            w.onerror = (e) => resolve({ error: String(e.message ?? e) });
            w.postMessage(data);
          }),
        {
          text: doc.text,
          setup: { ...doc.setup, fonts: undefined, ...(doc.setup.fonts ? { fontNames: doc.setup.fonts.map((f) => f.name) } : {}) },
          options: doc.options,
          resourceKeys: [...doc.resources.keys()],
          fontKeys: fonts.map(([k]) => k),
          noReuse: !!doc.noReuse,
          linesFirst: !!doc.linesFirst,
        },
      );
      if (result.error) {
        console.error(`${name}: 失敗しました\n${result.error}`);
        out.push({ doc: name, failed: true });
      } else {
        out.push({ doc: name, runtime: `Chromium ${browser.version()} (Worker)`, ...result });
        console.error(`${name}: ${JSON.stringify(result)}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

// ── 文書
function fontDir() {
  return process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');
}
function readFiles(dir, rel = '') {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? readFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [{ name: `${rel}${e.name}`, data: fs.readFileSync(path.join(dir, e.name)) }]))
    : [];
}
/** ファイルの中身を、何度問い合わせても同じ ArrayBuffer にする (使う側の resolveResource のキャッシュと同じ) */
function arrayBufferOf(b) {
  return typeof b === 'string' ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function loadDoc(full) {
  // 名前の後ろの印: +noreuse (Typesetter の再利用なし)・+noface (web の文書で @font-face を使わない)
  const [name, ...marks] = full.split('+');
  const doc = await loadDocBody(name, marks.includes('noface'));
  return { ...doc, ...(marks.includes('noreuse') ? { noReuse: true } : {}), ...(marks.includes('linesfirst') ? { linesFirst: true } : {}) };
}

async function loadDocBody(name, noFace) {
  const [kind, size] = name.split(':');
  const resources = new Map();
  if (kind === 'web') {
    const pages = size ? Number(size) : 20;
    const { PNG } = await import('pngjs');
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    const fonts = ['Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Cousine-Regular.ttf'];
    for (const f of fonts) resources.set(`fonts/${f}`, arrayBufferOf(fs.readFileSync(path.join(fontDir(), f))));
    const css = noFace ? 'body { font-size: 10pt; line-height: 1.6 } h2 { break-before: page; font-size: 16pt } img { width: 6cm; display: block; margin: 4pt 0 }' : `@font-face { font-family: Body; src: url(fonts/Arimo-Regular.ttf) } @font-face { font-family: Body; font-weight: bold; src: url(fonts/Arimo-Bold.ttf) }
@font-face { font-family: Code; src: url(fonts/Cousine-Regular.ttf) } body { font-family: Body, serif; font-size: 10pt; line-height: 1.6 } code { font-family: Code }
h2 { break-before: page; font-size: 16pt } img { width: 6cm; display: block; margin: 4pt 0 }`;
    resources.set('style.css', css);
    const sections = [];
    let img = 0;
    for (let p = 0; p < pages; p++) {
      const body = [];
      for (let k = 0; k < 6; k++) {
        body.push(`<p>第 ${p + 1} 章の ${k + 1} 番目の段落です。Kumiori lays out <b>HTML and CSS</b> and <code>XSL-FO</code> into pages. 日本語と English を混ぜた文を、行に分けて組みます。${'同じ文を繰り返して、段落の行を作ります。'.repeat(2)}</p>`);
        if ((p * 6 + k) % 7 === 3 || (p * 6 + k) % 7 === 6) {
          const png = new PNG({ width: 300, height: 200, colorType: 2 });
          for (let q = 0; q < png.data.length; q++) png.data[q] = q % 4 === 3 ? 255 : rand();
          const file = `images/p${img++}.png`;
          resources.set(file, arrayBufferOf(PNG.sync.write(png, { colorType: 2 })));
          body.push(`<img src="${file}" alt="図 ${img}">`);
        }
      }
      sections.push(`<section><h2>第 ${p + 1} 章</h2>${body.join('\n')}</section>`);
    }
    return { text: `<!doctype html><html lang="ja"><head><title>プレビューの文書</title><link rel="stylesheet" href="style.css"></head><body>${sections.join('\n')}</body></html>`, setup: {}, options: {}, resources };
  }
  if (kind === 'html-spec' || kind === 'fo-spec') {
    const { expand } = await import('./conformance-lib.mjs');
    const { CONFORMANCE_FONTS, ensureConformanceFonts, fontUrlsIn, urlBasename } = await import('./conformance-fonts.mjs');
    const conf = path.join(root, 'docs', 'conformance');
    const fontFiles = await ensureConformanceFonts(fontDir());
    if (kind === 'html-spec') {
      const src = fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.html'), 'utf8');
      resources.set('kumiori-html-css.css', fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.css'), 'utf8'));
      for (const f of readFiles(path.join(conf, 'html', 'images'), 'images/')) resources.set(f.name, arrayBufferOf(f.data)), resources.set(path.basename(f.name), resources.get(f.name));
      for (const u of fontUrlsIn(src)) resources.set(u, arrayBufferOf(fs.readFileSync(fontFiles.get(u)))), resources.set(urlBasename(u), resources.get(u));
      return { text: expand(src, 'html'), setup: {}, options: {}, resources };
    }
    const src = fs.readFileSync(path.join(conf, 'fo', 'kumiori-xsl-fo.fo'), 'utf8');
    const fonts = CONFORMANCE_FONTS.filter((f) => f.fo).map((f) => ({ name: path.basename(fontFiles.get(f.url)), data: new Uint8Array(fs.readFileSync(fontFiles.get(f.url))) }));
    for (const f of readFiles(path.join(conf, 'fo', 'images'), 'images/')) resources.set(f.name, arrayBufferOf(f.data)), resources.set(path.basename(f.name), resources.get(f.name));
    return { text: expand(src, 'fo'), setup: { fonts }, options: { compat: 'spec' }, resources };
  }
  if (kind === 'text') {
    const n = size ? Number(size) : 1500;
    const para = 'これは、流し書きのメモリを測るための文だけの文書です。同じ文を繰り返して、段落の行を作ります。'.repeat(3);
    const body = Array.from({ length: n }, (_, i) => `<h2>節 ${i + 1}</h2><p>${para}</p>`).join('\n');
    return { text: `<!doctype html><html lang="ja"><head><title>文だけの文書</title></head><body>${body}</body></html>`, setup: {}, options: {}, resources };
  }
  if (kind === 'toc') {
    // 文だけの文書の前に、節ごとのページ番号の目次 (target-counter) を置いたもの。1 回目の組版は前向きの参照を仮の値で組み、2 回目からの回で
    // 字を差し替えるので、再利用のキャッシュが、差し替える前の中身 (undo) と、組み直した page-sequence の 1 回目のページを持つ
    const n = size ? Number(size) : 1500;
    const para = 'これは、目次のある文書のメモリを測るための文です。同じ文を繰り返して、段落の行を作ります。'.repeat(3);
    const toc = Array.from({ length: n }, (_, i) => `<li><a href="#s${i + 1}">節 ${i + 1}</a></li>`).join('');
    const body = Array.from({ length: n }, (_, i) => `<h2 id="s${i + 1}">節 ${i + 1}</h2><p>${para}</p>`).join('\n');
    const css = 'nav a::after { content: " … " target-counter(attr(href), page); } nav { page-break-after: always; }';
    return { text: `<!doctype html><html lang="ja"><head><title>目次のある文書</title><style>${css}</style></head><body><nav><ol>${toc}</ol></nav>${body}</body></html>`, setup: {}, options: {}, resources };
  }
  throw new Error(`知らない文書: ${name}`);
}
