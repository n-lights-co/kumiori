#!/usr/bin/env node
/**
 * 組版の器 (createTypesetter) で、長い文書を何度も組み、1 回の組版の時間を段階ごとに分けて数字にする (組み直しの速さを調べるための道具)。
 * 組版の仕組みは変えずに、外から測る:
 *  - 段階ごとの時間は、Node の CPU プロファイル (node:inspector の Profiler) の標本を、呼び出しの並び (スタック) で分けて数える。
 *    外側の段階 (資源の収集・読み込み・組版・エリアツリー・PDF・描画) は、スタックにある関数の名前で決め、
 *    内側の分け方 (解析・カスケード・字の測り・行分け・ページ分け・PDF の書き出しなど) は、いちばん内側の関数のあるファイルで決める。
 *  - 組み直しの回の数と回ごとの時間は、LayoutEngine の layoutOnce を包んで測る (プロファイルの標本からは回を分けられないため)。
 *  - 画面の描画 (renderPage) は、Node に canvas が無いので、何もしない 2D の文脈で呼ぶ (描く命令を作る JS の手間だけ。画素にする手間は入らない)。
 *    SVG への書き出し (renderPageToSvg) も測る。
 * そのため、名前を残し、ソースのファイルごとに分けたビルド (.cache/profile-build) を、初めに vite で作る (数秒)。
 *
 * 使い方:
 *   node scripts/profile-relayout.mjs [--doc <名前>]... [--runs N] [--edit] [--pages N] [--no-pdf] [--interval µs] [--json <file>] [--cpu-prof <dir>]
 *   --doc: html-spec (HTML と CSS 編の対応仕様説明書)・fo-spec (XSL-FO 編)・css-print (『CSSページ組版入門』第 4 版。.cache/samples に戻しておく)・
 *          fo:<名前> (アンテナハウスのサンプル FO 集の <名前>.fo。.cache/samples/fo)・
 *          gen:<形>[:<大きさ>] (scripts/gen-stress-docs.mjs の種を決めた乱数の文書。nest・table・rules・para・images・fonest・fotable)。何度でも。既定は html-spec・fo-spec・css-print
 *   --runs: 1 つの器で組む回数 (既定 4。初めの回は JIT と書体の読み込みが温まっていないので、2 回目からが組み直しの目安)
 *   --edit: 2 回目からは、文書の中ほどの 1 段落に字を足してから組む (1 段落だけ直したときの組み直し)
 *   --edit-chars N: 足す字の数 (既定 7。行の増える直しを試すときは、100 など)
 *   --edit-block: 2 回目からは、文書の中ほどの段落 (HTML の <p>・XSL-FO の <fo:block>。中に同じ名前の要素の無いもの) を 1 つ、すぐ後ろにもう 1 つ足してから組む
 *          (ブロックを足したときの組み直し。--edit と一緒には使わない)
 *   --pages: 描画 (renderPage・renderPageToSvg) を測るページの数 (既定 3。プレビューで見えるページの目安)
 *   --no-pdf: PDF の書き出し (toPdf) を測らない
 *   --no-profile: プロファイルを取らない (段階に分けず、全体の時間だけを、プロファイルの手間の入らない値で測る)
 *   --interval: プロファイルの標本の間隔 (マイクロ秒。既定 250)
 *   --json: 結果を JSON で書く
 *   --cpu-prof: 回ごとの CPU プロファイル (.cpuprofile。Chrome の DevTools で開ける) を書くディレクトリ
 *   --diff-pages: 2 回目からは、ページごとの SVG (renderPageToSvg) を前の回と比べ、同じページの数と、違うページの範囲を出す
 *          (直した所の前のページと、後ろで組み直しが元に戻ったページは、前の組版を使い回せる見込みがある。時間を測る値には入れない)
 *   --check-reuse: 回ごとに、reuse: false の器でも同じ文書を組み、領域の木 (serializeAreaTree) と PDF のバイト列が同じことを確かめる
 *          (PDF の日時と識別子は、時計と乱数を止めて同じにする。時間を測る値には入れない)。違えば、終わりの状態を 1 にする
 *   --no-reuse: 器の reuse を false にする (文書をまたぐ使い回しをせずに組む。使い回しの前後を比べる)
 *   --signal: 組むたびに、止めない合図 (AbortSignal) を渡す (間をあける組版の手間を測る。toPdf にも渡す)
 *   --progress: 組むたびに、何もしない進み具合の呼び返し (onProgress) を渡す (toPdf にも渡す)
 *   --share-measurer: 試し。字の測りの覚え (Measurer の書体ごとの表) を、文書をまたいで使い回す (器の中の書体は同じ LoadedFont なので、
 *          その書体の字の送り・カーニングなどは同じ値になる)。字の測りを器で覚える段階の速さの見込みを測る。組版の仕組みは変えず、測る道具の中だけで差し替える
 *   --src <dir>: 組版のソース (src) を、このリポジトリでなく <dir> (別のコミットを取り出した場所など) から作る。ビルドは <dir>/.cache/profile-build に置く
 *          (依存は <dir> から見つかるものを使う)。文書と書体は、このリポジトリのものを使う (前と後のコミットで同じ文書を組み比べるため。scripts/perf-compare.mjs)
 *   --no-build: ビルドを作り直さずに、前に作ったもの (.cache/profile-build) を使う。--build-only: ビルドだけを作って終わる
 *   測る値には、壁の時計の時間 (typeset) のほかに、組版の CPU の時間 (typesetCpu。このスレッドの process.threadCpuUsage の差) も入れる (--json の結果)
 * 書体: 既定の書体は .cache/fonts (無ければ Google Fonts の配信元から取って置く)。対応仕様説明書の見本の書体は scripts/conformance-fonts.mjs の一覧。
 * css-print は、元のファイルの zip に入っている日本語版の源ノ角ゴシック・源ノ明朝で組む (見本と同じ MS 明朝などには差し替えない。時間を測るだけなので)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { expand } from './conformance-lib.mjs';
import { CONFORMANCE_FONTS, ensureConformanceFonts, fontUrlsIn, urlBasename } from './conformance-fonts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 引数
const args = { src: undefined, build: true, buildOnly: false, docs: [], checkReuse: false, reuse: true, editChars: 7, diffPages: false, shareMeasurer: false, profile: true, runs: 4, edit: false, editBlock: false, pages: 3, pdf: true, interval: 250, json: undefined, cpuProf: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i];
  if (a === '--doc') args.docs.push(v());
  else if (a === '--src') args.src = path.resolve(v());
  else if (a === '--no-build') args.build = false;
  else if (a === '--build-only') args.buildOnly = true;
  else if (a === '--runs') args.runs = Number(v());
  else if (a === '--edit') args.edit = true;
  else if (a === '--edit-block') args.editBlock = true;
  else if (a === '--pages') args.pages = Number(v());
  else if (a === '--no-pdf') args.pdf = false;
  else if (a === '--no-profile') args.profile = false;
  else if (a === '--share-measurer') args.shareMeasurer = true;
  else if (a === '--diff-pages') args.diffPages = true;
  else if (a === '--no-reuse') args.reuse = false;
  else if (a === '--signal') args.signal = true;
  else if (a === '--progress') args.progress = true;
  else if (a === '--check-reuse') args.checkReuse = true;
  else if (a === '--edit-chars') args.editChars = Number(v());
  else if (a === '--interval') args.interval = Number(v());
  else if (a === '--json') args.json = v();
  else if (a === '--cpu-prof') args.cpuProf = v();
  else throw new Error(`知らない引数: ${a}`);
}
if (!args.docs.length) args.docs = ['html-spec', 'fo-spec', 'css-print'];

// ── 名前を残し、ソースのファイルごとに分けたビルド (依存のパッケージは取り込まない)
const srcRoot = args.src ?? root;
const outDir = path.join(srcRoot, '.cache', 'profile-build');
if (args.build || !fs.existsSync(path.join(outDir, 'index.js'))) await build({
  configFile: false,
  root: srcRoot,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    ssr: true,
    rolldownOptions: {
      input: { index: 'src/index.ts', node: 'src/node.ts', layoutEngine: 'src/layoutEngine.ts', measurer: 'src/measurer.ts' },
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
    },
  },
});
if (args.buildOnly) process.exit(0);
const lib = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
const { createFontLoader } = await import(pathToFileURL(path.join(outDir, 'node.js')).href);
const { LayoutEngine } = await import(pathToFileURL(path.join(outDir, 'layoutEngine.js')).href);

// 組み直しの回ごとの時間 (layoutOnce を包む。api.js が使うのと同じモジュールの LayoutEngine)
let passTimes = [];
const origOnce = LayoutEngine.prototype.layoutOnce;
LayoutEngine.prototype.layoutOnce = function (doc) {
  const t = performance.now();
  try {
    return origOnce.call(this, doc);
  } finally {
    passTimes.push(performance.now() - t);
  }
};

// 試し (--share-measurer): Measurer の書体ごとの覚えの表を、器の全体で 1 つにする (どの文書の Measurer も、初めて使うときに差し替える)
if (args.shareMeasurer) {
  const { Measurer } = await import(pathToFileURL(path.join(outDir, 'measurer.js')).href);
  const FIELDS = ['cache', 'kernPairs', 'vertCache', 'vertFeatureCache', 'contextSpaces', 'stackCache', 'clusterLigCache'];
  const shared = {};
  for (const k of Object.getOwnPropertyNames(Measurer.prototype)) {
    const f = Object.getOwnPropertyDescriptor(Measurer.prototype, k);
    if (k === 'constructor' || typeof f.value !== 'function') continue;
    const orig = f.value;
    Measurer.prototype[k] = function (...a) {
      if (!this.__shared) {
        this.__shared = true;
        for (const name of FIELDS) {
          if (!(name in this)) continue;
          shared[name] ??= this[name];
          this[name] = shared[name];
        }
      }
      return orig.apply(this, a);
    };
  }
}

// ── 文書
const fontDir = process.env.KUMIORI_FONT_CACHE ? path.resolve(process.env.KUMIORI_FONT_CACHE) : path.join(root, '.cache', 'fonts');
const readFiles = (dir, rel = '') =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? readFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [{ name: `${rel}${e.name}`, data: new Uint8Array(fs.readFileSync(path.join(dir, e.name))) }],
      )
    : [];

async function loadDoc(name) {
  if (name === 'html-spec' || name === 'fo-spec') {
    const conf = path.join(root, 'docs', 'conformance');
    const fontFiles = await ensureConformanceFonts(fontDir);
    if (name === 'html-spec') {
      const src = fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.html'), 'utf8');
      const files = [
        { name: 'kumiori-html-css.css', data: fs.readFileSync(path.join(conf, 'html', 'kumiori-html-css.css'), 'utf8') },
        ...readFiles(path.join(conf, 'html', 'images'), 'images/'),
        ...fontUrlsIn(src).map((u) => ({ name: `fonts/${urlBasename(u)}`, data: new Uint8Array(fs.readFileSync(fontFiles.get(u))) })),
      ];
      return { name, text: expand(src, 'html'), setup: {}, options: { files } };
    }
    const src = fs.readFileSync(path.join(conf, 'fo', 'kumiori-xsl-fo.fo'), 'utf8');
    const fonts = CONFORMANCE_FONTS.filter((f) => f.fo).map((f) => ({ name: path.basename(fontFiles.get(f.url)), data: new Uint8Array(fs.readFileSync(fontFiles.get(f.url))) }));
    return { name, text: expand(src, 'fo'), setup: { fonts }, options: { compat: 'spec', files: readFiles(path.join(conf, 'fo', 'images'), 'images/') } };
  }
  if (name === 'css-print') {
    const dir = path.join(root, '.cache', 'samples', 'css-print', 'src');
    if (!fs.existsSync(dir)) throw new Error('css-print: .cache/samples/css-print/src がありません (CLAUDE.md の「見本と書体の置き場」の手順で戻す)');
    const text = fs.readFileSync(path.join(dir, 'CSS-Print-ja.html'), 'utf8');
    const files = readFiles(dir).filter((f) => f.name !== 'CSS-Print-ja.html' && !/LICENSE/i.test(f.name));
    return { name, text, setup: {}, options: { style: 'ah', files } };
  }
  if (name.startsWith('gen:')) {
    // 種を決めた乱数の文書 (scripts/gen-stress-docs.mjs)。gen:<形> は書き出す大きさ、gen:<形>:<大きさ> は大きさを決めて作る
    // 使い回しの確かめの形 (REUSE_SHAPES。初めに目次のある toc・fotoc など) も選べる
    const { SHAPES, STANDARD_SIZES, REUSE_SHAPES = {}, REUSE_SIZES = {} } = await import('./gen-stress-docs.mjs');
    const all = { ...SHAPES, ...REUSE_SHAPES };
    const [, shape, size] = name.split(':');
    if (!all[shape]) throw new Error(`${name}: 知らない形 (${Object.keys(all).join('・')})`);
    const n = size ? Number(size) : (STANDARD_SIZES[shape] ?? REUSE_SIZES[shape]);
    return { name, text: all[shape].make(n), setup: {}, options: { kind: all[shape].ext } };
  }
  if (name.startsWith('fo:')) {
    const dir = path.join(root, '.cache', 'samples', 'fo');
    const file = path.join(dir, 'fo', `${name.slice(3)}.fo`);
    if (!fs.existsSync(file)) throw new Error(`${name}: ${file} がありません`);
    const text = fs.readFileSync(file, 'utf8');
    // 見本が参照する画像だけを渡す (img の全部を渡すと、読み込みの手間が測る値に入る)
    const imgDir = path.join(dir, 'img');
    const files = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((f) => text.includes(f)).map((f) => ({ name: f, data: new Uint8Array(fs.readFileSync(path.join(imgDir, f))) })) : [];
    return { name, text, setup: {}, options: { compat: 'antenna', files } };
  }
  throw new Error(`知らない文書: ${name}`);
}

/** 文書の中ほどの段落 (HTML の <p>・XSL-FO の <fo:block>) の初めに、字を足す (1 段落だけ直したときの組み直しを試す) */
function editOnce(text, n) {
  const re = /<(p|fo:block)\b[^>]*>(?=[^<\s])/g;
  re.lastIndex = Math.floor(text.length / 2);
  const m = re.exec(text);
  if (!m) return text;
  const at = m.index + m[0].length;
  const add = `直した${n}回目。`;
  const s = add.repeat(Math.ceil(args.editChars / add.length)).slice(0, args.editChars);
  return text.slice(0, at) + s + text.slice(at);
}

/** 文書の中ほどの段落 (中に同じ名前の要素の無いもの) を 1 つ、すぐ後ろにもう 1 つ足す (ブロックを足したときの組み直しを試す) */
function editBlockOnce(text) {
  const re = /<(p|fo:block)(?=[\s>])[^>]*>(?:(?!<(?:p|fo:block)[\s>/])[\s\S])*?<\/\1>/g;
  re.lastIndex = Math.floor(text.length / 2);
  const m = re.exec(text);
  if (!m) return text;
  const end = m.index + m[0].length;
  return text.slice(0, end) + m[0] + text.slice(end);
}

// ── 何もしない 2D の文脈 (renderPage の JS の手間だけを測る)
// (字の輪郭の Path2D も、何もしないものにする。輪郭の文字列 (d) を作る手間は測る値に入る)
globalThis.Path2D ??= class Path2D {
  constructor(d) {
    this.d = d;
  }
  addPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  closePath() {}
  rect() {}
  arc() {}
  ellipse() {}
};
function stubCanvas() {
  const ctx = new Proxy(
    { canvas: null, measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return this; } }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createConicGradient: () => ({ addColorStop() {} }), createPattern: () => ({ setTransform() {} }), getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), isPointInPath: () => false },
    { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'filter', 'textAlign', 'textBaseline', 'direction', 'lineCap', 'lineJoin', 'miterLimit', 'globalCompositeOperation', 'imageSmoothingEnabled', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'lineDashOffset', 'fontKerning'].includes(k) ? () => {} : undefined), set: (t, k, v) => ((t[k] = v), true) },
  );
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  ctx.canvas = canvas;
  return canvas;
}

// ── プロファイルの標本を段階に分ける
/** 外側の段階: スタックにある関数の名前 (外側から見て最初に当たったもの) */
const OUTER = [
  [/^collectResources$/, '資源の収集'],
  [/^importHtmlText$|^importFo$/, '読み込み'],
  [/^layoutPasses$|^layoutLowMemory$/, '組版'],
  [/^finishTree$|^attachResources$/, 'エリアツリー'],
  [/^renderPdf$|^renderPdfPages$/, 'PDF'],
  [/^renderSheetToCanvas$/, '描画 (canvas)'],
  [/^renderSheetToSvg$/, '描画 (SVG)'],
];
/** 内側の分け方: いちばん内側の、Kumiori のソースか依存のパッケージのファイル */
const INNER = [
  [/^(htmlparser2|domhandler|domutils|entities|linkedom|@xmldom|htmlParserStack|htmlPrepare|xhtml|linkedomModules|cssUrlScan|documentText)/, '解析'],
  [/^(cssCascade|cssSelector|cssText|cssColorFunctions|cssGradient|cssTransform|cssUnsupported|counterStyle)/, 'カスケード'],
  [/^(htmlImport|xslfoImport|foDom|foExpr|foContext|foPageMaster|structureBuilder|structure|inlineFlatten|textTransform|htmlPaged|htmlFrame)/, '読み込みの木作り'],
  [/^(measurer|@pdf-lib\/fontkit|fontkitShaping|fontkitCffFlex|fontkitEmptyGlyph|ligature|fontManager|fontMapping|fontVariation|arabicMarks|hebrewMarks|orthographicSyllable)/, '字の測り'],
  [/^(inlineLayout|lineBreak|hyphenation|hyphen|bidi|grapheme|textJustifyTrim|lineMetrics|unicodeData|warichu|jis)/, '行分け'],
  [/^(layoutEngine|pageFlow|footnotes|tableBorders|tableMarkers|gridTracks|pageNumber|indexCitation|lnode|geometry|units)/, 'ページ分け・ブロック'],
  [/^(areaResources|areaTree|paintEffect|paint)/, 'エリアツリー'],
  [/^(pdf-lib|pdfRenderer|pdfTags|pdfFlatten|pako|inflateFast|psCff|cff|fontInstancer|colorGlyphPdf|pdfLibPatches)/, 'PDF の書き出し'],
  [/^(svg|svgRenderer|canvasRenderer|colorGlyph|strokeOutline|regionBool|matrix)/, '描く命令'],
  [/^(jpeg|webp|vp8|imageInfo|imageFormats|assets|ccitt|utif|cgm|eps|psInterp|ps)/, '画像'],
];
function fileOf(url) {
  if (!url) return '';
  const nm = url.lastIndexOf('/node_modules/');
  if (nm >= 0) {
    const rest = url.slice(nm + 14).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  if (url.includes('/.cache/profile-build/')) return url.split('/.cache/profile-build/')[1].replace(/\.js$/, '');
  return '';
}
function classify(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const memo = new Map();
  const info = (id) => {
    let r = memo.get(id);
    if (r) return r;
    const n = byId.get(id);
    const name = n.callFrame.functionName;
    if (name === '(garbage collector)') r = { outer: 'GC', inner: 'GC', file: 'GC' };
    else if (name === '(root)') r = { outer: undefined, inner: undefined, file: undefined };
    else if (name === '(program)' || name === '(idle)') r = { outer: 'その他', inner: name, file: name };
    else {
      const p = parent.has(id) ? info(parent.get(id)) : { outer: undefined, inner: undefined, file: undefined };
      const outerHere = OUTER.find(([re]) => re.test(name))?.[1];
      const f = fileOf(n.callFrame.url);
      r = { outer: p.outer ?? outerHere, inner: undefined, file: undefined, under: p.under };
      // どの段階にも入らない標本は、typesetDocument のすぐ下の関数の名前で分ける (書体の確かめ・画像の登録など)
      if (!r.outer && !r.under && p.name === 'typesetDocument') r.under = name || '(無名)';
      r.top = p.top ?? (name ? `${name} (${fileOf(n.callFrame.url) || n.callFrame.url.split('/').pop() || '?'})` : undefined);
      // 内側: いちばん内側のファイルを優先する (子の側で上書きするので、ここでは親の値を受け継ぎ、ファイルがあれば差し替える)
      r.file = f || p.file;
    }
    r.name = name;
    memo.set(id, r);
    return r;
  };
  const dt = profile.timeDeltas;
  const table = new Map();
  const files = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const ms = (dt[i + 1] ?? dt[i] ?? 0) / 1000;
    const r = info(profile.samples[i]);
    if (r.inner === '(idle)') continue;
    total += ms;
    const outer = r.outer ?? (r.under ? `その他: ${r.under}` : r.top ? `その他 (${r.top} から)` : 'その他');
    const file = r.file ?? '';
    const inner = r.inner === 'GC' ? 'GC' : (INNER.find(([re]) => re.test(file))?.[1] ?? (file ? `その他 (${file})` : 'その他'));
    const key = `${outer}\t${inner.startsWith('その他 (') ? 'その他' : inner}`;
    table.set(key, (table.get(key) ?? 0) + ms);
    files.set(`${outer}\t${file || '(なし)'}`, (files.get(`${outer}\t${file || '(なし)'}`) ?? 0) + ms);
  }
  return { total, table, files };
}

// ── 測る
/** このスレッドの CPU の時間 (ミリ秒)。GC などのほかのスレッドの時間は入れない (無い版の Node では、プロセスの全体) */
const cpuMs = () => {
  const u = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: args.interval });
if (args.cpuProf) fs.mkdirSync(args.cpuProf, { recursive: true });

/** --signal・--progress のときに、組版と toPdf に渡す選択肢 */
const control = () => ({ ...(args.signal ? { signal: new AbortController().signal } : {}), ...(args.progress ? { onProgress: () => {} } : {}) });
const results = [];
const fmt = (ms) => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)).padStart(7);
for (const name of args.docs) {
  const d = await loadDoc(name);
  const loadFont = createFontLoader({ cacheDir: fontDir, log: () => {} });
  const t0 = performance.now();
  const ts = await lib.createTypesetter({ loadFont, ...d.setup, ...(args.reuse ? {} : { reuse: false }) });
  const setupMs = performance.now() - t0;
  console.log(`\n■ ${name} (${(d.text.length / 1024).toFixed(0)}KB の文字列、ファイル ${d.options.files?.length ?? 0} 個)  器を作る: ${setupMs.toFixed(0)}ms`);
  let text = d.text;
  let prevPages;
  const plain = args.checkReuse ? await lib.createTypesetter({ loadFont, ...d.setup, reuse: false }) : undefined;
  for (let run = 1; run <= args.runs; run++) {
    if (args.edit && run > 1) text = editOnce(text, run);
    if (args.editBlock && run > 1) text = editBlockOnce(text);
    passTimes = [];
    if (args.profile) await session.post('Profiler.start');
    const w = {};
    let t = performance.now();
    const cpu0 = cpuMs();
    const r = await ts.typeset(text, { ...d.options, ...control() });
    w.typeset = performance.now() - t;
    w.typesetCpu = cpuMs() - cpu0;
    w.layoutMs = r.layoutMs;
    const passes = passTimes.slice();
    const n = Math.min(args.pages, r.pageCount);
    t = performance.now();
    for (let i = 0; i < n; i++) r.renderPage(stubCanvas(), i, { scale: 1 });
    w.renderPage = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < n; i++) await r.renderPageToSvg(i);
    w.renderSvg = performance.now() - t;
    let pdfBytes = 0;
    if (args.pdf) {
      t = performance.now();
      pdfBytes = (await r.toPdf(control())).length;
      w.toPdf = performance.now() - t;
    }
    // 使うメモリ (--expose-gc で動かしたときは、GC の後の値。組んだ結果 r を持っている間)
    if (globalThis.gc) globalThis.gc();
    w.heapMB = Math.round(process.memoryUsage().heapUsed / 1048576);
    if (plain) {
      // 時計と乱数を止めて、PDF の日時と識別子を同じにする
      const RealDate = Date;
      const fixed = new RealDate('2026-01-01T00:00:00Z').getTime();
      globalThis.Date = class extends RealDate {
        constructor(...a) {
          super(...(a.length ? a : [fixed]));
        }
        static now() {
          return fixed;
        }
      };
      const realRandom = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (x) => (new Uint8Array(x.buffer, x.byteOffset, x.byteLength).fill(7), x);
      try {
        const p = await ts.typeset(text, d.options);
        const q = await plain.typeset(text, d.options);
        const sameTree = lib.serializeAreaTree(p.areaTree) === lib.serializeAreaTree(q.areaTree);
        const sameWarn = JSON.stringify(p.warnings) === JSON.stringify(q.warnings);
        const a = await p.toPdf();
        const b = await q.toPdf();
        const samePdf = a.length === b.length && a.every((v, i) => v === b[i]);
        w.reuseCheck = { sameTree, sameWarn, samePdf };
        if (!(sameTree && sameWarn && samePdf)) process.exitCode = 1;
        w.checkLine = `    reuse: false の器と比べて: 領域の木 ${sameTree ? '同じ' : '違う'}・警告 ${sameWarn ? '同じ' : '違う'}・PDF ${samePdf ? '同じ' : '違う'}`;
      } finally {
        globalThis.Date = RealDate;
        crypto.getRandomValues = realRandom;
      }
    }
    if (args.diffPages) {
      // 時間を測った後で比べる (比べる手間は測る値に入れない)
      const pagesSvg = [];
      for (let i = 0; i < r.pageCount; i++) pagesSvg.push(await r.renderPageToSvg(i, { idPrefix: 'p' }));
      if (prevPages) {
        const same = pagesSvg.map((p, i) => p === prevPages[i]);
        const diffIdx = same.flatMap((v, i) => (v ? [] : [i + 1]));
        // 前から同じページの数・後ろから同じページの数 (ページ数が変わっても、後ろの側で揃えて比べる)
        let head = 0;
        while (head < Math.min(pagesSvg.length, prevPages.length) && pagesSvg[head] === prevPages[head]) head++;
        let tail = 0;
        while (tail < Math.min(pagesSvg.length, prevPages.length) - head && pagesSvg[pagesSvg.length - 1 - tail] === prevPages[prevPages.length - 1 - tail]) tail++;
        // 違うページの中で、前の回のどこかのページと同じ中身のもの (ページ番号の入る柱が違えば、違うページになる)
        const prevSet = new Set(prevPages);
        const movedSame = diffIdx.filter((i) => prevSet.has(pagesSvg[i - 1])).length;
        w.diff = { pages: pagesSvg.length, prev: prevPages.length, samePos: same.filter(Boolean).length, head, tail, firstDiff: diffIdx[0], lastDiff: diffIdx[diffIdx.length - 1], diffCount: diffIdx.length, movedSame };
        w.diffLine = (`    前の回と同じページ: 同じ位置 ${w.diff.samePos}/${pagesSvg.length}・前から ${head}・後ろから ${tail}  違うページ ${diffIdx.length} (${diffIdx[0] ?? '-'}〜${diffIdx[diffIdx.length - 1] ?? '-'} ページ: ${diffIdx.length <= 20 ? diffIdx.join(",") : "…"})・違う位置で同じ中身 ${movedSame}`);
      }
      prevPages = pagesSvg;
    }
    if (!args.profile) {
      console.log(`  ${run} 回目${args.edit && run > 1 ? ' (1 段落を直して)' : args.editBlock && run > 1 ? ' (段落を 1 つ足して)' : ''}: ${r.pageCount} ページ  typeset ${w.typeset.toFixed(0)}ms (うち layoutMs ${w.layoutMs}ms・組み直しの回 ${passes.length} 回 [${passes.map((p) => p.toFixed(0)).join(', ')}]ms)  renderPage×${n} ${w.renderPage.toFixed(0)}ms  renderPageToSvg×${n} ${w.renderSvg.toFixed(0)}ms${args.pdf ? `  toPdf ${w.toPdf.toFixed(0)}ms` : ''}  ヒープ ${w.heapMB}MB`);
      if (w.diffLine) console.log(w.diffLine);
      if (w.checkLine) console.log(w.checkLine);
      results.push({ doc: name, run, edited: (args.edit || args.editBlock) && run > 1, pages: r.pageCount, ...w, passes, warnings: r.warnings.length });
      continue;
    }
    const { profile } = await session.post('Profiler.stop');
    if (args.cpuProf) fs.writeFileSync(path.join(args.cpuProf, `${name.replace(/[^\w.-]/g, '_')}-${run}.cpuprofile`), JSON.stringify(profile));
    const c = classify(profile);
    const outerSum = new Map();
    for (const [k, ms] of c.table) outerSum.set(k.split('\t')[0], (outerSum.get(k.split('\t')[0]) ?? 0) + ms);
    console.log(
      `  ${run} 回目${args.edit && run > 1 ? ' (1 段落を直して)' : args.editBlock && run > 1 ? ' (段落を 1 つ足して)' : ''}: ${r.pageCount} ページ  typeset ${w.typeset.toFixed(0)}ms (うち layoutMs ${w.layoutMs}ms・組み直しの回 ${passes.length} 回 [${passes.map((p) => p.toFixed(0)).join(', ')}]ms)` +
        `  renderPage×${n} ${w.renderPage.toFixed(0)}ms  renderPageToSvg×${n} ${w.renderSvg.toFixed(0)}ms${args.pdf ? `  toPdf ${w.toPdf.toFixed(0)}ms (${(pdfBytes / 1048576).toFixed(1)}MB)` : ''}  警告 ${r.warnings.length}`,
    );
    const rows = [...c.table].sort((a, b) => b[1] - a[1]);
    const order = [...outerSum].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    for (const o of order) {
      const inner = rows.filter(([k]) => k.startsWith(`${o}\t`)).map(([k, ms]) => `${k.split('\t')[1]} ${ms.toFixed(0)}`);
      console.log(`    ${o.padEnd(10, '　')}${fmt(outerSum.get(o))}ms  (${inner.join('・')})`);
    }
    if (w.diffLine) console.log(w.diffLine);
    if (w.checkLine) console.log(w.checkLine);
    const topFiles = [...c.files].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => `${k.replace('\t', ':')} ${ms.toFixed(0)}`);
    console.log(`    ファイルの多い順: ${topFiles.join('・')}`);
    results.push({ doc: name, run, edited: (args.edit || args.editBlock) && run > 1, pages: r.pageCount, ...w, passes, warnings: r.warnings.length, sampledMs: c.total, phases: Object.fromEntries(c.table), files: Object.fromEntries([...c.files].sort((a, b) => b[1] - a[1]).slice(0, 40)) });
  }
}
await session.post('Profiler.disable');
session.disconnect();
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 1));
