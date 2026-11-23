/**
 * 説明書の表と src の対を、読み直しの代わりに試験で見る。
 *  1. docs/library.md (日英) の選択肢・持ち物の表と文が、公開の型 (TypesetOptions・PdfOptions・DrawioOptions など) の欄をすべて載せていること。
 *     型の欄は、src の宣言 (interface と型の字面の { … }) から取る (TypeScript 7 には、型の情報を読む安定した API が無いので、宣言の字面を読む)。
 *     公開の関数・値 (src/index.ts・src/node.ts の export) が、説明書のどこかにあることも見る
 *  2. docs/diagnostics.md (日英) の診断の表の args の欄が、src で診断を作る所 (diag(…)・誤りの型の args) の args の名前と合うこと。
 *     同じ名前の診断が、作る所によって違う args を持たないことも見る
 *  3. docs/cli.md (日英) の環境変数の表が、コマンドの読む環境変数と合うこと (オプションの表は test/cliDocs.test.ts が見る)
 * 上限 (limits) の名前の表は test/limits.test.ts、診断の名前・重さ・順は test/diagnostics.test.ts が見るので、ここでは見ない。
 * いま説明書に無いものは、許す一覧に、直す台帳の項目と並べて書く (直して説明書に載ったら、一覧から外すよう試験が知らせる)。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

// ---- ソースの字面を読む小さな道具 ----

/** s[i] から始まる文字列・テンプレート・注釈を飛ばした後ろの位置 (そうでなければ -1) */
function skipLiteral(s: string, i: number): number {
  const c = s[i];
  if (c === '/' && s[i + 1] === '/') {
    const j = s.indexOf('\n', i);
    return j < 0 ? s.length : j;
  }
  if (c === '/' && s[i + 1] === '*') return s.indexOf('*/', i + 2) + 2;
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < s.length && s[j] !== '`') {
      if (s[j] === '\\') j += 2;
      else if (s[j] === '$' && s[j + 1] === '{') j = closeOf(s, j + 1);
      else j++;
    }
    return j + 1;
  }
  return -1;
}

/** s[i] の開き括弧 ( { [ に対応する閉じ括弧の後ろの位置 */
function closeOf(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; ) {
    const k = skipLiteral(s, j);
    if (k >= 0) {
      j = k;
      continue;
    }
    const c = s[j];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return s.length;
}

/** 括弧・文字列の外の sep で分ける */
function splitTop(s: string, sep: ',' | ';'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < s.length; ) {
    const k = skipLiteral(s, j);
    if (k >= 0) {
      j = k;
      continue;
    }
    const c = s[j];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, j));
      start = j + 1;
    }
    j++;
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 注釈を除いた字面 (文字列の中の // は残す) */
function stripComments(s: string): string {
  let out = '';
  for (let j = 0; j < s.length; ) {
    if (s[j] === '/' && (s[j + 1] === '/' || s[j + 1] === '*')) {
      j = skipLiteral(s, j);
      continue;
    }
    const k = skipLiteral(s, j);
    if (k >= 0) {
      out += s.slice(j, k);
      j = k;
      continue;
    }
    out += s[j++];
  }
  return out;
}

/**
 * 宣言の型の欄の名前。decl は宣言の頭 (`export interface X`・`export type X =`・`export const X:`) で、その後ろの最初の { … } の欄を読む
 * (interface の extends と、型の別名の Pick<…> & { … } の前の部分は読まない。読むのはその宣言が自分で足す欄だけ)
 */
function membersOf(file: string, decl: string): string[] {
  const src = stripComments(read(file));
  // 名前の続く別の宣言 (ImageFormat に対する ImageFormatContext) に当てない
  let at = -1;
  for (let from = 0; ; from = at + 1) {
    at = src.indexOf(decl, from);
    if (at < 0 || !/[\w$]/.test(src[at + decl.length] ?? '')) break;
  }
  if (at < 0) throw new Error(`${file} に ${decl} が無い`);
  const found = { index: at };
  const open = src.indexOf('{', found.index + decl.length);
  const body = src.slice(open + 1, closeOf(src, open) - 1);
  const names: string[] = [];
  for (const m of splitTop(body.replace(/\n/g, ';'), ';')) {
    const name = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(<]/.exec(m);
    if (name) names.push(name[1]);
  }
  if (!names.length) throw new Error(`${file} の ${decl} の欄を読めない`);
  return names;
}

/** 書いた形の値の export の名前 (`export { a, b as c } from …`・`export function f`・`export const X`。型だけの export は除く) */
function valueExportsOf(file: string): string[] {
  const src = stripComments(read(file));
  const names: string[] = [];
  for (const m of src.matchAll(/^export \{([^}]*)\}/gm)) for (const n of m[1].split(',')) names.push(n.trim().split(/\s+as\s+/).pop()!);
  for (const m of src.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  return names.filter(Boolean);
}

// ---- 説明書を読む道具 ----

/** 説明書の節 (見出しの行から、同じ段か上の段の次の見出しの前まで。下の段の節を含む)。英語版は、日本語版の同じ順の見出しの節 */
function sectionOf(md: string, jaMd: string, heading: string): string {
  const heads = (t: string) => [...t.matchAll(/^(#{1,6}) (.*)$/gm)].map((m) => ({ at: m.index, level: m[1].length, text: m[2] }));
  const ja = heads(jaMd);
  const k = ja.findIndex((h) => h.text === heading);
  if (k < 0) throw new Error(`見出し「${heading}」が無い`);
  const hs = heads(md);
  const h = hs[k];
  const next = hs.slice(k + 1).find((x) => x.level <= h.level);
  return md.slice(h.at, next?.at ?? md.length);
}

/** 節の表の 1 つ目の欄に書いた名前 (`name`・`name(…)`・`name({ … })` の頭の名前) */
function tableNames(section: string): Set<string> {
  const names = new Set<string>();
  let fence = false;
  for (const line of section.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence || !line.startsWith('|')) continue;
    for (const m of (line.split('|')[1] ?? '').matchAll(/`([A-Za-z_$][\w$.]*)/g)) names.add(m[1].split('.').pop()!);
  }
  return names;
}

/** 節の `…` とコードの塊に、語として出てくる名前 */
function codeWords(section: string): Set<string> {
  const words = new Set<string>();
  const add = (t: string) => {
    for (const m of t.matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0]);
  };
  for (const m of section.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) add(m[1]);
  for (const m of section.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)) add(m[1]);
  return words;
}

// ---- 1. docs/library.md の選択肢の表と、公開の型 ----

interface TypeCheck {
  /** 型の名前 (報告と許す一覧の鍵) */
  type: string;
  file: string;
  decl: string;
  /** 説明書の節の見出し (日本語版) */
  section: string;
  /** table: 節の表の 1 つ目の欄に要る。text: 節の `…` かコードの塊にあればよい (表でなく文で書く型) */
  where: 'table' | 'text';
}

const TYPE_CHECKS: TypeCheck[] = [
  { type: 'TypesetOptions', file: 'src/api.ts', decl: 'export interface TypesetOptions', section: '組み方の選択肢 (options)', where: 'table' },
  { type: 'TypesetterOptions', file: 'src/api.ts', decl: 'export type TypesetterOptions =', section: '入口の関数', where: 'text' },
  { type: 'TypesetResult', file: 'src/api.ts', decl: 'export interface TypesetResult', section: '組んだ結果 (TypesetResult)', where: 'table' },
  { type: 'PdfOptions', file: 'src/api.ts', decl: 'export interface PdfOptions', section: 'PDF にする (toPdf)', where: 'table' },
  { type: 'PdfXOptions', file: 'src/pdfStandard.ts', decl: 'export interface PdfXOptions', section: 'PDF/X と PDF/A', where: 'text' },
  { type: 'PdfAOptions', file: 'src/pdfStandard.ts', decl: 'export interface PdfAOptions', section: 'PDF/X と PDF/A', where: 'text' },
  { type: 'RenderPageOptions', file: 'src/api.ts', decl: 'export interface RenderPageOptions', section: 'Canvas に描く (renderPage)', where: 'table' },
  { type: 'RenderPageSvgOptions', file: 'src/api.ts', decl: 'export interface RenderPageSvgOptions', section: 'SVG にする (renderPageToSvg)', where: 'table' },
  { type: 'RenderPagePngOptions', file: 'src/api.ts', decl: 'export interface RenderPagePngOptions', section: 'PNG にする (renderPageToPng)', where: 'text' },
  { type: 'TypesetPdfOptions', file: 'src/api.ts', decl: 'export interface TypesetPdfOptions', section: 'PDF だけを作る (typesetToPdf)', where: 'text' },
  { type: 'TypesetPdfResult', file: 'src/api.ts', decl: 'export interface TypesetPdfResult', section: 'PDF だけを作る (typesetToPdf)', where: 'text' },
  { type: 'LinkPolicy', file: 'src/linkPolicy.ts', decl: 'export interface LinkPolicy', section: 'PDF の作り', where: 'text' },
  { type: 'DrawioOptions', file: 'src/drawio/options.ts', decl: 'export interface DrawioOptions', section: 'draw.io の図', where: 'table' },
  { type: 'KumioriPlugin', file: 'src/imageFormats.ts', decl: 'export interface KumioriPlugin', section: 'プラグイン', where: 'text' },
  { type: 'ImageFormat', file: 'src/imageFormats.ts', decl: 'export interface ImageFormat', section: 'プラグイン', where: 'text' },
  { type: 'ImageFormatContext', file: 'src/imageFormats.ts', decl: 'export interface ImageFormatContext', section: 'プラグイン', where: 'table' },
  { type: 'FontLoaderOptions', file: 'src/nodeFonts.ts', decl: 'export interface FontLoaderOptions', section: 'Node の部品 (kumiori/node)', where: 'text' },
  { type: 'SystemFontOptions', file: 'src/nodeSystemFonts.ts', decl: 'export interface SystemFontOptions', section: 'Node の部品 (kumiori/node)', where: 'text' },
  { type: 'DEFAULT_FONTS', file: 'src/index.ts', decl: 'export const DEFAULT_FONTS:', section: '入口の関数', where: 'text' },
  { type: 'Diagnostic', file: 'src/diagnostics.ts', decl: 'export interface Diagnostic', section: '診断 (diagnostics)', where: 'table' },
  { type: 'TypesetProgress', file: 'src/callContext.ts', decl: 'export interface TypesetProgress', section: '組版を止める・進み具合 (signal・onProgress)', where: 'text' },
  { type: 'ResourceContext', file: 'src/api.ts', decl: 'export interface ResourceContext', section: 'resolveResource', where: 'text' },
  { type: 'SnapshotOptions', file: 'src/snapshot.ts', decl: 'export interface SnapshotOptions', section: 'JS が組み上げたページを組む (snapshotDocument)', where: 'table' },
  { type: 'DocumentSnapshot', file: 'src/snapshot.ts', decl: 'export interface DocumentSnapshot', section: 'JS が組み上げたページを組む (snapshotDocument)', where: 'table' },
];

/**
 * 公開の関数・値と、それを書く所。kumiori の入口のものは、説明書 (docs の同じ言語の文書) のどこか
 * (Area Tree をたどる関数は docs/area-tree.md、draw.io の関数は docs/drawio.md に書く)。kumiori/node の部品は、library.md のその節の表
 */
const EXPORT_CHECKS: Array<{ file: string; section?: string }> = [{ file: 'src/index.ts' }, { file: 'src/node.ts', section: 'Node の部品 (kumiori/node)' }];
/** 同じ言語の説明書 (docs/*.md か docs/en/*.md) を 1 つにつないだもの */
const allDocs = (libraryFile: string) => {
  const dir = path.dirname(libraryFile);
  return fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => read(`${dir}/${f}`))
    .join('\n');
};

/**
 * いま説明書に無い欄・値と、それを直す台帳の項目。直して説明書 (日英) に載ったら、ここから外す。
 */
const LIBRARY_ALLOW = new Map<string, string>([]);

describe('docs/library.md の選択肢の表と、公開の型', () => {
  const jaMd = read('docs/library.md');
  const files = [
    ['docs/library.md', jaMd],
    ['docs/en/library.md', read('docs/en/library.md')],
  ] as const;

  it('型の欄を src の宣言から読める', () => {
    expect(membersOf('src/api.ts', 'export interface TypesetOptions')).toEqual(expect.arrayContaining(['kind', 'files', 'fonts', 'limits', 'drawio', 'plugins']));
    expect(membersOf('src/api.ts', 'export interface TypesetResult')).toEqual(expect.arrayContaining(['pageCount', 'toPdf', 'renderPage', 'renderPageToPng']));
    // 型の別名は、自分で足す { … } の欄だけ (Pick<…> の名前は TypesetOptions の欄として見る)
    expect(membersOf('src/api.ts', 'export type TypesetterOptions =')).toContain('reuse');
    expect(membersOf('src/api.ts', 'export type TypesetterOptions =')).not.toContain('fonts');
    expect(membersOf('src/callContext.ts', 'export interface TypesetProgress')).toEqual(['phase', 'pass', 'pages', 'loaded', 'total']);
    expect(membersOf('src/api.ts', 'export interface ResourceContext')).toEqual(['signal']);
    expect(valueExportsOf('src/index.ts')).toEqual(expect.arrayContaining(['typeset', 'createTypesetter', 'DEFAULT_FONTS', 'isKumioriError', 'PLUGIN_API_VERSION']));
  });

  const missing = (pick: (file: string, md: string) => string[]) => {
    const out: string[] = [];
    for (const [file, md] of files) for (const k of pick(file, md)) if (!LIBRARY_ALLOW.has(k)) out.push(`${file}: ${k}`);
    return out;
  };
  const undocumented = (_file: string, md: string) =>
    TYPE_CHECKS.flatMap((c) => {
      const sec = sectionOf(md, jaMd, c.section);
      const have = c.where === 'table' ? tableNames(sec) : codeWords(sec);
      return membersOf(c.file, c.decl)
        .filter((m) => !have.has(m))
        .map((m) => `${c.type}.${m}`);
    });
  const unexported = (file: string, md: string) =>
    EXPORT_CHECKS.flatMap((c) => {
      const have = c.section ? tableNames(sectionOf(md, jaMd, c.section)) : codeWords(allDocs(file));
      return valueExportsOf(c.file)
        .filter((n) => !have.has(n))
        .map((n) => `${c.file}:${n}`);
    });

  it('公開の型の欄は、どれも説明書 (日英) の、その型の節にある', () => {
    expect(missing(undocumented)).toEqual([]);
  });
  it('公開の関数・値は、どれも説明書 (日英) にある', () => {
    expect(missing(unexported)).toEqual([]);
  });
  it('許す一覧の項目は、どれも今も説明書に無い (載ったら一覧から外す)', () => {
    const now = new Set(files.flatMap(([file, md]) => [...undocumented(file, md), ...unexported(file, md)]));
    expect([...LIBRARY_ALLOW.keys()].filter((k) => !now.has(k))).toEqual([]);
  });
});

// ---- 2. docs/diagnostics.md の args の欄と、src で診断を作る所 ----

/** 説明書の診断の表の、名前ごとの args の欄の名前 */
function documentedArgs(file: string): Map<string, Set<string>> {
  const md = read(file);
  const rows = [...md.matchAll(/^\| `([a-z0-9/-]+)` \| (?:error|warning|info) \| .* \| (.*) \|$/gm)];
  return new Map(rows.map((r) => [r[1], new Set([...r[2].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]))]));
}

interface ArgsUse {
  at: string;
  /** いつも渡す名前 */
  keys: string[];
  /** 場合によって渡す名前 (...(c ? { a } : {}) のような展開の中) */
  optional: string[];
}

/** 字面の { … } の欄の名前 (書き方を読めなければ undefined) */
function objectKeys(text: string): { keys: string[]; optional: string[] } | undefined {
  const t = text.trim();
  if (!t.startsWith('{') || closeOf(t, 0) !== t.length) return undefined;
  const keys: string[] = [];
  const optional: string[] = [];
  for (const p of splitTop(t.slice(1, -1), ',')) {
    if (p.startsWith('...')) {
      for (const m of p.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)) optional.push(m[1]);
      continue;
    }
    const m = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(p);
    if (!m) return undefined;
    keys.push(m[1]);
  }
  return { keys, optional };
}

function srcFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
}

/**
 * src で診断を作る所 (diag(名前, 文, args, 場所) と、誤りの型 new Kumiori…Error(名前, 文, { args }))。名前ごとに、渡す args の名前を集める。
 * 名前は、1 つ目の引数の字面の名前 (三項演算子の両方も) か、1 つ目の引数が同じファイルの関数の呼び出しなら、その関数が返す字面の名前。
 * args を変数で渡す所は、名前を読めないので unknown に数える
 */
function argsUses(codes: Set<string>): { uses: Map<string, ArgsUse[]>; unknown: Map<string, string[]> } {
  const uses = new Map<string, ArgsUse[]>();
  const unknown = new Map<string, string[]>();
  const literals = (t: string) => [...t.matchAll(/'([a-z0-9-]+\/[a-z0-9-]+)'/g)].map((m) => m[1]).filter((c) => codes.has(c));
  for (const file of srcFiles('src')) {
    if (file === 'src/diagnostics.ts') continue;
    const s = read(file);
    for (const m of s.matchAll(/(?<![\w$])(diag|new Kumiori\w*Error)\(/g)) {
      // diag は、展開 (...diag(…)) は読むが、メソッド (x.diag(…)) は読まない
      if (s[m.index - 1] === '.' && s.slice(m.index - 3, m.index) !== '...') continue;
      const open = m.index + m[0].length - 1;
      const args = splitTop(s.slice(open + 1, closeOf(s, open) - 1), ',');
      if (!args.length) continue;
      let names = literals(args[0]);
      const call = /^([A-Za-z_$][\w$]*)\(/.exec(args[0]);
      if (!names.length && call) {
        const fn = new RegExp(`function ${call[1]}\\(`).exec(s);
        if (fn) {
          const b = s.indexOf('{', fn.index);
          names = literals(s.slice(b, closeOf(s, b)));
        }
      }
      if (!names.length) continue;
      const at = `${file}:${s.slice(0, m.index).split('\n').length}`;
      const third = args[2];
      let got: { keys: string[]; optional: string[] } | undefined;
      if (third === undefined || third === 'undefined') got = { keys: [], optional: [] };
      else if (m[1] === 'diag') got = objectKeys(third);
      else {
        // 誤りの型の 3 つ目は { args, … } の細目。args の無い細目は、args を渡さない
        const d = objectKeys(third);
        const inner = /(?:^\{|,)\s*args\s*:\s*\{/.exec(third);
        if (inner) {
          const b = inner.index + inner[0].length - 1;
          got = objectKeys(third.slice(b, closeOf(third, b)));
        } else if (d && !d.keys.includes('args')) got = { keys: [], optional: [] };
      }
      for (const code of names) {
        if (got) uses.set(code, [...(uses.get(code) ?? []), { at, ...got }]);
        else unknown.set(code, [...(unknown.get(code) ?? []), at]);
      }
    }
  }
  return { uses, unknown };
}

/**
 * 同じ名前の診断が、作る所によって違う args を持つもの (いまの食い違い)。args をそろえるか、表に書き分けるまでの間だけ置く (API-28 でそろえ、いまは無い)。
 * 値は、許す args の形 (いつも渡す名前を並べたもの) の集まり
 */
const ARGS_SHAPE_ALLOW = new Map<string, { shapes: string[]; why: string }>([]);

describe('docs/diagnostics.md の args の欄と、src で診断を作る所', () => {
  const ja = documentedArgs('docs/diagnostics.md');
  const en = documentedArgs('docs/en/diagnostics.md');
  const { uses, unknown } = argsUses(new Set(ja.keys()));
  const shapeOf = (u: ArgsUse) => [...new Set(u.keys)].sort().join(',');

  it('説明書の表を読め、src の作る所を読める', () => {
    expect(ja.size).toBeGreaterThan(80);
    expect([...en.keys()]).toEqual([...ja.keys()]);
    expect([...uses.values()].flat().length).toBeGreaterThan(100);
    // 診断の名前は、どれも src のどこかで作る (作る所を読めないなら、読み方を直す)
    expect([...ja.keys()].filter((c) => !uses.has(c) && !unknown.has(c))).toEqual([]);
  });
  it('日英の説明書の args の欄は同じ名前', () => {
    for (const [code, a] of ja) expect([...en.get(code)!].sort(), code).toEqual([...a].sort());
  });
  it('src で渡す args の名前は、どれも説明書の args の欄にあり、説明書の args の名前は、どれも src のどこかで渡す', () => {
    const problems: string[] = [];
    for (const [code, doc] of ja) {
      const us = uses.get(code) ?? [];
      const given = new Set(us.flatMap((u) => [...u.keys, ...u.optional]));
      for (const k of given) if (!doc.has(k)) problems.push(`${code}: src が渡す ${k} が説明書に無い (${us.filter((u) => u.keys.includes(k) || u.optional.includes(k)).map((u) => u.at).join(' ')})`);
      // args を変数で渡す所があれば、説明書の名前を渡しているかは読めない
      if (!unknown.has(code)) for (const k of doc) if (!given.has(k)) problems.push(`${code}: 説明書の ${k} を src が渡さない`);
    }
    expect(problems).toEqual([]);
  });
  it('同じ名前の診断は、作る所によらず、同じ args を渡す (いまの食い違いは許す一覧に)', () => {
    const problems: string[] = [];
    for (const [code, us] of uses) {
      const shapes = [...new Set(us.map(shapeOf))].sort();
      if (shapes.length <= 1) continue;
      const allow = ARGS_SHAPE_ALLOW.get(code);
      if (allow && shapes.every((s) => allow.shapes.includes(s))) continue;
      problems.push(`${code}: ${shapes.map((s) => `{${s}} (${us.filter((u) => shapeOf(u) === s).map((u) => u.at).join(' ')})`).join(' と ')}`);
    }
    expect(problems).toEqual([]);
  });
  it('許す一覧の項目は、どれも今も食い違う (そろえたら一覧から外す)', () => {
    for (const [code, allow] of ARGS_SHAPE_ALLOW) {
      const shapes = [...new Set((uses.get(code) ?? []).map(shapeOf))].sort();
      expect(shapes, code).toEqual([...allow.shapes].sort());
    }
  });
});

// ---- 3. docs/cli.md の環境変数の表と、コマンドの読む環境変数 ----

/** コマンドの道で読む環境変数を書く所 (env.NAME・env?.NAME・env['NAME']) を探すファイル */
const ENV_FILES = ['src/cli.ts', 'src/nodeFonts.ts', 'src/nodeSystemFonts.ts', 'src/messages.ts'];
/** 説明書に書かない環境変数と、その理由 */
const ENV_ALLOW = new Map<string, string>();
/** 環境変数を読む所の書き方 (このほかの書き方は試験で止める) */
// 大文字で始まる名前 (Windows の SystemRoot のように、小文字を交ぜた名前も)
const ENV_READ = /\benv\??\.([A-Z][A-Za-z0-9_]*)\b|\benv\[\s*'([A-Z][A-Za-z0-9_]*)'\s*\]/g;

describe('docs/cli.md の環境変数の表と、コマンドの読む環境変数', () => {
  const read_ = () => {
    const names = new Set<string>();
    for (const f of ENV_FILES) for (const m of stripComments(read(f)).matchAll(ENV_READ)) names.add(m[1] ?? m[2]);
    return names;
  };
  it('コマンドの読む環境変数は、どれも説明書 (日英) の環境変数の表にあり、表の変数は、どれもコマンドが読む', () => {
    const used = read_();
    expect([...used]).toEqual(expect.arrayContaining(['KUMIORI_LANG', 'KUMIORI_FONT_CACHE', 'LANG']));
    const jaMd = read('docs/cli.md');
    for (const file of ['docs/cli.md', 'docs/en/cli.md']) {
      const md = read(file);
      const documented = tableNames(sectionOf(md, jaMd, '環境変数'));
      expect([...used].filter((n) => !documented.has(n) && !ENV_ALLOW.has(n)), `${file} の表に無い変数`).toEqual([]);
      expect([...documented].filter((n) => !used.has(n)), `${file} の表にあって、コマンドが読まない変数`).toEqual([]);
    }
  });
  it('環境変数は、決まった書き方 (env.NAME) でだけ読む (process.env を丸ごと別の名前で引く書き方があれば、取り出しを直す)', () => {
    for (const f of ENV_FILES) {
      const s = stripComments(read(f));
      expect(s, f).not.toMatch(/process\.env\[(?!\s*'[A-Z])/);
      expect(s, f).not.toMatch(/\{[^}]*\}\s*=\s*process\.env/);
    }
  });
});
