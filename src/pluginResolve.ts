/**
 * --plugin の指定 (ファイルの道かパッケージの名前) を、import() で読む URL にする (コマンドだけが使う。Node の fs を使う)。
 *
 * 探す順 (resolvePlugin):
 *  1. 道の形の指定 (./・../・.・..・絶対の道・Windows のドライブの道や UNC・file: の URL) は、ファイルの道 (今のディレクトリを基準にする)。
 *     Node の import() でも、これらは相対・絶対の指定で、パッケージとしては探さない。
 *  2. それ以外は、import() と同じに、まずパッケージの名前 (bare specifier) として解決する (拡張子で終わるものも。
 *     kp/dist/plugin.js・exports の ./x.js の鍵・chart.js のような名前のパッケージ)。
 *  3. パッケージとして読めず (パッケージが無いときのほか、指したサブパスを exports で出していないとき・入口のファイルが無いときも)、
 *     今のディレクトリにその名前のファイルがあれば、そのファイルを読む
 *     (--plugin myplugin.js のように ./ を付けない書き方のため。import() とはここだけが違う)。
 *     パッケージとして読めるときは、Node と同じくパッケージを読む。確実にファイルを読ませたいときは ./ を付ける。
 *
 * パッケージの名前は、import() と同じ決まり (Node の ESM の解決: Node の文書「Modules: ECMAScript modules」の
 * 「Resolution Algorithm Specification」の PACKAGE_RESOLVE・PACKAGE_EXPORTS_RESOLVE・PACKAGE_TARGET_RESOLVE・LEGACY_MAIN_RESOLVE) で、
 * 今のディレクトリ (コマンドを動かした所) を基準に解決する。条件は import() と同じ (import・node・module-sync・default)。
 * createRequire().resolve は require の条件で解決するので、exports に import の条件しか無い ESM のパッケージを見つけられない。
 * import.meta.resolve の 2 つ目の引数 (基準の URL) は、動かせる Node (>=22.12.0) では、
 * --experimental-import-meta-resolve を付けないと使えないので、自前で解決する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { msg } from './messages';

/** import() の条件 (Node の ESM の既定の条件。module-sync は Node 20.19・22.10 から) */
const CONDITIONS = new Set(['import', 'node', 'module-sync', 'default']);

/**
 * ファイルの道とみなす指定 (道の形のもの): . か .. そのもの、./・../・.\・..\ で始まるもの、絶対の道 (/…・C:\…・C:/…・\\server\share…)、file: の URL。
 * 拡張子では決めない (kp/dist/plugin.js・chart.js はパッケージの名前。パッケージとして読めなければ resolvePlugin が今のディレクトリのファイルに落とす)
 */
export function isPluginPath(spec: string): boolean {
  return /^\.{1,2}(?:[\\/]|$)/.test(spec) || path.isAbsolute(spec) || path.win32.isAbsolute(spec) || /^file:/i.test(spec);
}

/** パッケージの名前とサブパス (@scope/name/sub → ['@scope/name', './sub'])。名前として正しくなければ undefined */
function splitSpecifier(spec: string): [string, string] | undefined {
  const parts = spec.split('/');
  const n = spec.startsWith('@') ? 2 : 1;
  if (parts.length < n || parts.slice(0, n).some((p) => !p)) return undefined;
  const name = parts.slice(0, n).join('/');
  // PACKAGE_RESOLVE: 名前が . で始まるもの、\ か % を含むものは誤り
  if (name.startsWith('.') || /[\\%]/.test(name)) return undefined;
  const rest = parts.slice(n).join('/');
  // PACKAGE_RESOLVE: サブパスが / で終わるもの (p1/・@scope/name/ など) は誤り
  if (spec.endsWith('/')) return undefined;
  return [name, rest ? `./${rest}` : '.'];
}

/** PACKAGE_TARGET_RESOLVE: exports の値 (文字列・条件の表・配列) → パッケージの中のファイル。無ければ undefined (null は「出さない」) */
function resolveTarget(pkgDir: string, target: unknown, patternMatch?: string): string | null | undefined {
  if (typeof target === 'string') {
    // 道は ./ で始まる (パッケージの外や node_modules を指せない)
    if (!target.startsWith('./')) return undefined;
    const t = patternMatch !== undefined ? target.split('*').join(patternMatch) : target;
    if (t.split(/[\\/]/).slice(1).some((s) => s === '..' || s === '.' || s.toLowerCase() === 'node_modules')) return undefined;
    return path.join(pkgDir, t);
  }
  if (Array.isArray(target)) {
    for (const t of target) {
      const r = resolveTarget(pkgDir, t, patternMatch);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (target === null) return null;
  if (typeof target === 'object') {
    // 条件の表: 書いた順に、知っている条件の最初のもの
    for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
      if (!CONDITIONS.has(k)) continue;
      const r = resolveTarget(pkgDir, v, patternMatch);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/** PACKAGE_EXPORTS_RESOLVE: exports から、サブパス (. か ./x) のファイル */
function resolveExports(pkgDir: string, exportsField: unknown, subpath: string): string | null | undefined {
  // 文字列・配列・. で始まらない鍵の表は、. の値
  const isSubpathMap = !!exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField) && Object.keys(exportsField).some((k) => k.startsWith('.'));
  const map: Record<string, unknown> = isSubpathMap ? (exportsField as Record<string, unknown>) : { '.': exportsField };
  if (Object.prototype.hasOwnProperty.call(map, subpath) && !subpath.includes('*')) return resolveTarget(pkgDir, map[subpath]);
  // 型 (* を 1 つ含む鍵): 前が一致するもののうち、長いもの (PATTERN_KEY_COMPARE)
  let best: { key: string; match: string } | undefined;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
    const pre = key.slice(0, star);
    const post = key.slice(star + 1);
    if (subpath.length < key.length || !subpath.startsWith(pre) || !subpath.endsWith(post) || subpath === pre) continue;
    if (!best || pre.length > best.key.indexOf('*') || (pre.length === best.key.indexOf('*') && key.length > best.key.length)) best = { key, match: subpath.slice(pre.length, subpath.length - post.length) };
  }
  return best ? resolveTarget(pkgDir, map[best.key], best.match) : undefined;
}

/** LEGACY_MAIN_RESOLVE (exports の無いパッケージの .): main・main.js・main/index.js、無ければ index.js */
function legacyMain(pkgDir: string, main: unknown): string | undefined {
  const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
  const cands = typeof main === 'string' && main ? [main, `${main}.js`, path.join(main, 'index.js')] : [];
  return [...cands, 'index.js'].map((c) => path.join(pkgDir, c)).find(isFile);
}

/** 探したもの (見つからなかったときの文に使う。探した順) */
export type PluginSearchStep =
  | { kind: 'path'; file: string }
  | { kind: 'package'; name: string; subpath: string; from: string; pkgDir?: string }
  | { kind: 'invalid-name' }
  | { kind: 'trailing-slash' }
  | { kind: 'cwd-file'; file: string };

/** 解決の結果。via は、道の形 (path)・パッケージ (package)・パッケージとして読めず今のディレクトリのファイル (file) */
export type PluginResolution = { url: string; via: 'path' | 'package' | 'file'; tried: PluginSearchStep[] } | { url?: undefined; via?: undefined; tried: PluginSearchStep[] };

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** --plugin の指定を、探す順 (ファイルの先頭の説明) に解決する */
export function resolvePlugin(spec: string, cwd: string = process.cwd()): PluginResolution {
  const tried: PluginSearchStep[] = [];
  if (isPluginPath(spec)) {
    let file: string;
    try {
      file = /^file:/i.test(spec) ? fileURLToPath(spec) : path.resolve(cwd, spec);
    } catch {
      return { tried: [{ kind: 'path', file: spec }] };
    }
    tried.push({ kind: 'path', file });
    return isFile(file) ? { url: pathToFileURL(file).href, via: 'path', tried } : { tried };
  }
  const split = splitSpecifier(spec);
  if (!split) tried.push({ kind: spec.endsWith('/') ? 'trailing-slash' : 'invalid-name' });
  else {
    const step: PluginSearchStep = { kind: 'package', name: split[0], subpath: split[1], from: path.resolve(cwd) };
    tried.push(step);
    const r = resolvePackage(split[0], split[1], cwd);
    if (r.pkgDir) step.pkgDir = r.pkgDir;
    if (r.file) return { url: pathToFileURL(r.file).href, via: 'package', tried };
  }
  // パッケージとして読めない (パッケージが無い・サブパスを出していない・入口のファイルが無い): 今のディレクトリのその名前のファイル (ディレクトリは読まない)
  const file = path.resolve(cwd, spec);
  tried.push({ kind: 'cwd-file', file });
  return isFile(file) ? { url: pathToFileURL(file).href, via: 'file', tried } : { tried };
}

/** 見つからなかったときの文 (何をどの順に探したか) */
export function pluginNotFoundMessage(spec: string, tried: PluginSearchStep[]): string {
  const parts = tried.map((t) => {
    switch (t.kind) {
      case 'path':
        return msg(`ファイル ${t.file} が無い`, `the file ${t.file} does not exist`);
      case 'invalid-name':
        return msg('パッケージの名前として正しくない', 'it is not a valid package name');
      case 'trailing-slash':
        return msg('パッケージの指定は / で終われない', 'a package specifier cannot end in /');
      case 'package':
        return t.pkgDir
          ? msg(`パッケージ ${t.name} (${t.pkgDir}) に ${t.subpath} が無いか、exports で出していない`, `the package ${t.name} (${t.pkgDir}) has no ${t.subpath} or does not export it`)
          : msg(`パッケージ ${t.name} を、${t.from} から上の node_modules で探したが無い`, `searched for the package ${t.name} in node_modules from ${t.from} upward, but it is not there`);
      case 'cwd-file':
        return msg(`今のディレクトリのファイル ${t.file} も無い`, `the file ${t.file} in the current directory does not exist either`);
    }
  });
  return msg(`プラグインが見つかりません: ${spec} (${parts.join('。')})`, `plugin not found: ${spec} (${parts.join('; ')})`);
}

/** --plugin の指定 → import() に渡す URL。見つからなければ undefined (resolvePlugin の url) */
export function resolvePluginUrl(spec: string, cwd: string = process.cwd()): string | undefined {
  return resolvePlugin(spec, cwd).url;
}

/**
 * パッケージの名前とサブパスを、cwd から上へ node_modules を探して解決する。
 * pkgDir は見つけたパッケージのディレクトリ、file はそのファイル (サブパスが無いか出していなければ無い)
 */
function resolvePackage(name: string, subpath: string, cwd: string): { pkgDir?: string; file?: string } {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', name);
    if (fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()) {
      // 見つけた最初のパッケージで決める (Node と同じ。上のディレクトリの同じ名前のものは見ない)
      let pjson: { exports?: unknown; main?: unknown } = {};
      try {
        pjson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as typeof pjson;
      } catch {
        // package.json が無いか読めない: exports も main も無いものとして扱う
      }
      const file =
        pjson.exports !== undefined && pjson.exports !== null
          ? resolveExports(pkgDir, pjson.exports, subpath)
          : subpath === '.'
            ? legacyMain(pkgDir, pjson.main)
            : path.join(pkgDir, subpath);
      return file && isFile(file) ? { pkgDir, file } : { pkgDir };
    }
    if (path.dirname(dir) === dir) return {};
  }
}
