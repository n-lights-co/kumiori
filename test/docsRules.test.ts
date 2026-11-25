/**
 * 配る文書の決まり (CLAUDE.md の「言葉」) を、読み直しの代わりに試験で見る。
 *  1. 日英の対: README・CHANGELOG・SECURITY・docs・examples の説明 (日本語の X.md と英語の X.en.md・docs/en/X.md) で、
 *     見出しの並び (段の深さ)・節ごとの表の行の数・コードの塊の数と言語の名前・箇条書きの項目の数・表の 1 つ目の欄の英数の名前がそろうこと。
 *     対応仕様説明書 (docs/conformance の .html・.fo と、その .en.*) は、塊の要素の並び (行内の要素を除く)・id・見本の印の並びがそろうこと
 *  2. 台帳の番号: 配る文書 (CHANGELOG・README・SECURITY・docs・samples・examples) と配るコード (src とビルドの設定) に、
 *     レビュー台帳の番号 (分野の略号と番号。台帳の中・コミットの文・ブランチの名前にだけ書く) が無いこと
 *  3. 見えない字: 配る文書に、行・段落の区切りの字 (U+2028・U+2029)・制御文字・幅の無い字・書字方向の制御の字がそのまま入っていないこと
 *     (表示では見えず、改行として扱う道具ではそこで行が切れる。src も、行・段落の区切りの字・制御文字・書字方向の制御の字を見る)
 * どれも、そろえなくてよい所は、理由を添えて下の許す一覧に書く (一覧の項目が要らなくなったら、試験が知らせる)。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
/** HTML・XML のコメント (<!-- … -->) を外す。外した後に新しく <!-- … --> の並びができても残さないように、無くなるまで繰り返す */
const stripComments = (t: string) => {
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(/<!--[\s\S]*?-->/g, '');
  }
  return t;
};

/** ディレクトリの下のファイル (リポジトリの中の道。node_modules・ビルドの出力・.cache は見ない) */
function walk(dir: string): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return ['node_modules', 'dist', '.cache'].includes(e.name) ? [] : walk(rel);
    return [rel];
  });
}

/** 配る文書 (リリースする文書) のディレクトリと、直下の文書 */
const RELEASE_DIRS = ['docs', 'samples', 'examples'];
const ROOT_DOCS = ['README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'SECURITY.md', 'SECURITY.en.md', 'THIRD_PARTY_NOTICES.md'];
/** 配るコード (src と、ビルド・配布の設定) */
const CODE_FILES = () => [...walk('src'), 'package.json', 'index.html', 'tsconfig.json', 'tsconfig.lib.json', 'vite.config.ts', 'vite.lib.config.ts', 'vite.cli.config.ts', 'vite.browser.config.ts'];
const TEXT_EXT = /\.(md|ts|js|mjs|cjs|json|html|fo|css|xml|xsl|svg|drawio|txt)$/;
const releaseDocs = () => [...ROOT_DOCS, ...RELEASE_DIRS.flatMap(walk)].filter((f) => TEXT_EXT.test(f));

// ---- 1. 日英の対 ----

/** 英語版の無い Markdown (日本語だけで書くもの) と、その理由 */
const NO_ENGLISH = new Map<string, string>([
  ['THIRD_PARTY_NOTICES.md', '第三者の表示は、ライセンスの本文 (英語) に日本語の説明を添えた 1 つの文書'],
  ['samples/check/README.md', '開発で確かめるための自作の見本の覚え書き (配る包みに入らない)'],
]);

/** 日本語の Markdown と、その英語版の対 */
function markdownPairs(): Array<[string, string]> {
  const md = releaseDocs().filter((f) => f.endsWith('.md'));
  const pairs: Array<[string, string]> = [];
  for (const f of md) {
    if (f.endsWith('.en.md') || f.startsWith('docs/en/')) continue;
    if (NO_ENGLISH.has(f)) continue;
    // docs/X.md → docs/en/X.md。docs/conformance/README.md → docs/en/conformance.md。ほかは X.md → X.en.md
    const en = f === 'docs/conformance/README.md' ? 'docs/en/conformance.md' : /^docs\/[^/]+\.md$/.test(f) ? f.replace(/^docs\//, 'docs/en/') : f.replace(/\.md$/, '.en.md');
    pairs.push([f, en]);
  }
  return pairs;
}

interface MdSection {
  heading: string;
  level: number;
  tableRows: number;
  /** コードの塊の言語の名前 (``` の後ろ。無ければ空) */
  code: string[];
  listItems: number;
  /**
   * 表の行ごとの、1 つ目の欄の `…` の中の英数の名前 (オプション・プロパティ・要素の名前など)。`…` の中を「・」「,」・空白で分け、
   * 英数と記号 (: . * / @ # -) だけの語を取る (日本語を含む語・括弧や引用符を含む書き方は訳すので除く。文書の道は日英の道を同じにして比べる)
   */
  firstCells: string[];
}

/** 英語版の文書の道を、日本語版の道にそろえる (表の 1 つ目の欄で、日英の版それぞれの文書を指すため) */
const normalizePath = (s: string) => s.replace(/^docs\/en\/conformance\.md$/, 'docs/conformance/').replace(/docs\/en\//g, 'docs/').replace(/\.en\.md\b/g, '.md');

function mdShape(text: string): MdSection[] {
  let cur: MdSection = { heading: '(頭)', level: 0, tableRows: 0, code: [], listItems: 0, firstCells: [] };
  const out = [cur];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s*```(.*)$/.exec(line);
    if (f) {
      if (!fence) cur.code.push(f[1].trim());
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6}) (.*)$/.exec(line);
    if (h) {
      cur = { heading: h[2], level: h[1].length, tableRows: 0, code: [], listItems: 0, firstCells: [] };
      out.push(cur);
      continue;
    }
    if (line.startsWith('|')) {
      cur.tableRows++;
      if (!/^\|\s*:?-/.test(line)) {
        const first = line.split('|')[1] ?? '';
        const names = [...first.matchAll(/`([^`]+)`/g)].flatMap((m) => normalizePath(m[1]).split(/[・、,\s]+/)).filter((n) => /^[\w:.*/@#-]+$/.test(n));
        cur.firstCells.push([...new Set(names)].sort().join(' '));
      }
    }
    if (/^\s*(?:[-*]|\d+\.) /.test(line)) cur.listItems++;
  }
  return out;
}

/**
 * 日英でそろわなくてよい所 (日本語版の道・節の見出し (日本語)・何が違ってよいか・理由)。いまは無い。
 * 足すのは、英語版に、日本語版と違う中身を書く理由があるとき (片方の言語だけの事情など) だけにする
 */
const PAIR_ALLOW: Array<{ file: string; heading: string; what: 'tableRows' | 'code' | 'listItems' | 'firstCells'; why: string }> = [];

/** 塊の要素の並びを比べるときに除く、行内の要素 (訳すと語の並びと一緒に変わる) */
const INLINE = new Set(
  'a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr fo:inline fo:basic-link fo:wrapper fo:page-number fo:page-number-citation fo:page-number-citation-last fo:character fo:leader'.split(' '),
);

describe('日英の対', () => {
  const pairs = markdownPairs();
  it('許す一覧の項目は、どれも今の文書の節を指す', () => {
    for (const p of PAIR_ALLOW) expect(mdShape(read(p.file)).some((s) => s.heading === p.heading), `${p.file} の「${p.heading}」`).toBe(true);
  });
  it('日本語の文書には英語版があり、英語版には日本語の文書がある', () => {
    expect(pairs.length).toBeGreaterThan(15);
    for (const [, en] of pairs) expect(fs.existsSync(path.join(root, en)), en).toBe(true);
    const ens = new Set(pairs.map((p) => p[1]));
    const orphans = releaseDocs().filter((f) => (f.endsWith('.en.md') || f.startsWith('docs/en/')) && f.endsWith('.md') && !ens.has(f));
    expect(orphans, '日本語版の無い英語版').toEqual([]);
    for (const f of NO_ENGLISH.keys()) expect(fs.existsSync(path.join(root, f)), `許す一覧の ${f} が無い`).toBe(true);
  });

  for (const [ja, en] of markdownPairs()) {
    it(`${ja} と ${en} の節・表・コード・箇条書きがそろう`, () => {
      const a = mdShape(read(ja));
      const b = mdShape(read(en));
      expect(b.map((s) => s.level), '見出しの並び (段の深さ)').toEqual(a.map((s) => s.level));
      const diffs: string[] = [];
      a.forEach((s, i) => {
        const t = b[i];
        for (const what of ['tableRows', 'code', 'listItems', 'firstCells'] as const) {
          if (JSON.stringify(s[what]) === JSON.stringify(t[what])) continue;
          if (PAIR_ALLOW.some((p) => p.file === ja && p.heading === s.heading && p.what === what)) continue;
          if (what === 'firstCells' && s.tableRows === t.tableRows) {
            // 行ごとに、違う行だけを書く
            s.firstCells.forEach((c, k) => {
              if (c !== t.firstCells[k]) diffs.push(`「${s.heading}」/「${t.heading}」の表の ${k + 1} 行目の 1 つ目の欄の名前: ${c} と ${t.firstCells[k]}`);
            });
          } else diffs.push(`「${s.heading}」/「${t.heading}」の ${what}: ${JSON.stringify(s[what])} と ${JSON.stringify(t[what])}`);
        }
      });
      expect(diffs).toEqual([]);
    });
  }

  for (const [ja, en] of [
    ['docs/conformance/html/kumiori-html-css.html', 'docs/conformance/html/kumiori-html-css.en.html'],
    ['docs/conformance/fo/kumiori-xsl-fo.fo', 'docs/conformance/fo/kumiori-xsl-fo.en.fo'],
  ] as const) {
    it(`${ja} と英語版の、塊の要素の並び・id・見本の印がそろう`, () => {
      const blocks = (t: string) =>
        [...stripComments(t).replace(/<head>[\s\S]*?<\/head>/, '').matchAll(/<([a-zA-Z][\w:.-]*)/g)].map((m) => m[1]).filter((n) => !INLINE.has(n));
      const ids = (t: string) => [...stripComments(t).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      const samples = (t: string) => [...t.matchAll(/kumiori-sample id="([^"]+)"/g)].map((m) => m[1]);
      const a = read(ja);
      const b = read(en);
      const ba = blocks(a);
      const bb = blocks(b);
      expect(ba.length).toBeGreaterThan(1000);
      const at = ba.findIndex((n, i) => n !== bb[i]);
      expect(at < 0 && ba.length === bb.length ? 'same' : `${at} 番目の要素から違う: ${ba.slice(at, at + 4).join(' ')} と ${bb.slice(at, at + 4).join(' ')}`).toBe('same');
      expect(ids(b)).toEqual(ids(a));
      expect(samples(b)).toEqual(samples(a));
    });
  }
});

// ---- 2. 台帳の番号 ----

/** 台帳の番号の形 (分野の略号と 2〜3 桁の番号。決めたことの番号 D-048 なども) */
const LEDGER_ID = /\b(?:API|CSS|FO|HTM|IMG|LAY|NC|NF|OUT|PDFX|PKG|PS|SVG|TODO)-\d{2,3}\b|\bD-\d{3}\b/g;

describe('台帳の番号', () => {
  it('台帳の番号の形は、台帳の番号に当たり、仕様の名前などには当たらない', () => {
    const hit = (s: string) => [...s.matchAll(LEDGER_ID)].map((m) => m[0]);
    expect(hit('IMG-19・FO-40・PDFX-21・HTM-200・D-048')).toEqual(['IMG-19', 'FO-40', 'PDFX-21', 'HTM-200', 'D-048']);
    expect(hit('UTF-16・ISO-8859-1・PDF/UA-1・PDF/X-1a・X-4・SVG-1.1・CSS-2.1・CMYK D-50・ISO 15930-7')).toEqual([]);
  });
  it('配る文書と配るコードに、台帳の番号が無い (CLAUDE.md の「言葉」)', () => {
    const files = [...releaseDocs(), ...CODE_FILES().filter((f) => TEXT_EXT.test(f))];
    expect(files.length).toBeGreaterThan(200);
    const found: string[] = [];
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        for (const m of l.matchAll(LEDGER_ID)) found.push(`${f}:${i + 1}: ${m[0]}`);
      });
    }
    expect(found).toEqual([]);
  });
});

// ---- 3. 見えない字 ----

/** 文書に入れない字 (行・段落の区切り・制御文字 (タブ・改行のほか)・幅の無い字・BOM・やわらかいハイフン・書字方向の制御の字) */
const INVISIBLE_IN_DOCS = charClass([[0x2028, 0x2029], [0x0, 0x8], [0xb, 0xc], [0xe, 0x1f], [0x7f, 0x7f], [0x200b, 0x200d], [0xfeff, 0xfeff], [0xad, 0xad], [0x202a, 0x202e], [0x2066, 0x2069]]);
/**
 * コード・対応仕様説明書 (文字の組み方の見本に幅の無い字を使う) に入れない字 (行・段落の区切り・制御文字・書字方向の制御の字)。
 * 書字方向の制御の字は、見た目と違う並びのコードに見せられる (Trojan Source) ので、使うなら JavaScript の文字列のエスケープ (バックスラッシュ・u と 16 進の 4 桁) で書く
 */
/** 字の番号の範囲の組から、その字のどれかに当たる正規表現を作る (見えない字を、このファイルにそのまま書かないため) */
function charClass(ranges: Array<[number, number]>): RegExp {
  const esc = (n: number) => '\\' + 'u' + n.toString(16).padStart(4, '0');
  return new RegExp(`[${ranges.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join('')}]`, 'g');
}
const INVISIBLE_IN_CODE = charClass([[0x2028, 0x2029], [0x0, 0x8], [0xb, 0xc], [0xe, 0x1f], [0x7f, 0x7f], [0x202a, 0x202e], [0x2066, 0x2069]]);

describe('見えない字', () => {
  it('配る文書 (Markdown) とコードに、見えない字がそのまま入っていない (使うならエスケープで書く)', () => {
    const found: string[] = [];
    const scan = (f: string, re: RegExp) => {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        for (const m of l.matchAll(re)) found.push(`${f}:${i + 1}: U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
      });
    };
    for (const f of releaseDocs()) scan(f, f.endsWith('.md') ? INVISIBLE_IN_DOCS : INVISIBLE_IN_CODE);
    for (const f of CODE_FILES().filter((x) => TEXT_EXT.test(x))) scan(f, INVISIBLE_IN_CODE);
    expect(found).toEqual([]);
  });
});
