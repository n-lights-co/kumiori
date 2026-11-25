/**
 * doc-sources — 確かめの道具が組む文書の群 (リポジトリの文書と外の見本) の一覧。scripts/check-relayout.mjs・check-resume.mjs と scripts/check-pdfs.mjs で使う。
 *   conformance … 対応仕様説明書 (HTML と CSS 編・XSL-FO 編。日本語と英語。scripts/build-conformance.mjs と同じく、コードの表示を差し込み、見本の書体を渡す)
 *   examples    … examples の HTML と FO (examples/preview の画面のコードは除く)
 *   samples     … samples の FO (--compat spec と antenna)
 *   generated   … scripts/gen-stress-docs.mjs の種を決めた乱数の文書
 *   ah          … アンテナハウスのサンプル FO 集 (<samples>/fo/samples。--compat antenna)
 *   css-print   … 『CSSページ組版入門』第 4 版 (<samples>/css-print/src。--style ah)
 *   weasyprint  … WeasyPrint の見本 (--style weasyprint。見本の printall.sh と同じ組み合わせ)
 * 手元に無い見本の群は、理由を skipped に書いて飛ばす。
 * 文書は { id, load } で、load() は { text, setup? (createTypesetter に渡す設定), options (TypesetOptions か、それを返す関数) } を返す。読むのは組むときだけ
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand } from './conformance-lib.mjs';
import { CONFORMANCE_FONTS, ensureConformanceFonts, fontUrlsIn, urlBasename } from './conformance-fonts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
/** dir の中のファイルを、dir からの名前で渡す (skip: 渡さないファイル) */
const filesIn = (dir, skip = () => false) =>
  walk(dir)
    .filter((f) => !skip(f))
    .map((f) => ({ name: path.relative(dir, f).split(path.sep).join('/'), data: new Uint8Array(fs.readFileSync(f)) }));

export function listDocs({ groups, filter, samples, weasyprint: weasyDir, fontDir }) {
  const docs = [];
  const skipped = [];
  const add = (d) => {
    if (!filter || d.id.includes(filter)) docs.push(d);
  };
  if (groups.includes('conformance')) {
    const conf = path.join(root, 'docs', 'conformance');
    for (const file of ['kumiori-html-css.html', 'kumiori-html-css.en.html'])
      add({
        id: `conformance/${file}`,
        load: async () => {
          const fontFiles = await ensureConformanceFonts(fontDir);
          const src = fs.readFileSync(path.join(conf, 'html', file), 'utf8');
          const fonts = fontUrlsIn(src).map((u) => ({ name: `fonts/${urlBasename(u)}`, data: new Uint8Array(fs.readFileSync(fontFiles.get(u))) }));
          const files = filesIn(path.join(conf, 'html'), (f) => /\.html$/.test(f));
          return { text: expand(src, 'html'), options: () => ({ kind: 'html', files: [...files, ...fonts] }) };
        },
      });
    for (const file of ['kumiori-xsl-fo.fo', 'kumiori-xsl-fo.en.fo'])
      add({
        id: `conformance/${file}`,
        load: async () => {
          const fontFiles = await ensureConformanceFonts(fontDir);
          const src = fs.readFileSync(path.join(conf, 'fo', file), 'utf8');
          const fonts = CONFORMANCE_FONTS.filter((f) => f.fo).map((f) => ({ name: path.basename(fontFiles.get(f.url)), data: new Uint8Array(fs.readFileSync(fontFiles.get(f.url))) }));
          const files = filesIn(path.join(conf, 'fo', 'images')).map((f) => ({ ...f, name: `images/${f.name}` }));
          return { text: expand(src, 'fo'), setup: { fonts }, options: () => ({ kind: 'fo', compat: 'spec', files }) };
        },
      });
  }
  const repoDocs = (dir, re) => walk(path.join(root, dir)).filter((f) => re.test(f)).sort();
  const fileDoc = (id, file, extra) => ({
    id,
    load: async () => {
      const files = filesIn(path.dirname(file), (f) => f === file || /\.(md|pdf)$/i.test(f));
      return { text: fs.readFileSync(file, 'utf8'), options: () => ({ kind: /\.fo$/.test(file) ? 'fo' : 'html', files, ...extra }) };
    },
  });
  if (groups.includes('examples')) for (const f of repoDocs('examples', /\.(fo|x?html?)$/i).filter((f) => !f.includes(`${path.sep}preview${path.sep}`))) add(fileDoc(path.relative(root, f), f, {}));
  if (groups.includes('samples'))
    for (const f of repoDocs('samples', /\.(fo|x?html?)$/i)) {
      if (f.endsWith('.fo')) for (const compat of ['spec', 'antenna']) add(fileDoc(`${path.relative(root, f)} (--compat ${compat})`, f, { compat }));
      else add(fileDoc(path.relative(root, f), f, {}));
    }
  if (groups.includes('generated')) {
    for (const shape of ['nest', 'table', 'rules', 'para', 'images', 'fonest', 'fotable'])
      add({
        id: `generated/${shape}`,
        load: async () => {
          const { SHAPES, STANDARD_SIZES } = await import('./gen-stress-docs.mjs');
          return { text: SHAPES[shape].make(STANDARD_SIZES[shape]), options: { kind: SHAPES[shape].ext } };
        },
      });
    // 左右・奇数偶数で本文の幅の違うページをまたぐ長い段落と、罫線をつぶした表がページをまたぐ文書 (続きから組んだ流れが写す境目と、
    // 境目の後の組みが組んだ物に書き込むものの確かめ。gen-stress-docs.mjs の RESUME_SHAPES)
    for (const shape of ['sidewidth', 'fosidewidth', 'collapsetable', 'focollapsetable'])
      add({
        id: `generated/${shape}`,
        load: async () => {
          const { RESUME_SHAPES, RESUME_SIZES } = await import('./gen-stress-docs.mjs');
          return { text: RESUME_SHAPES[shape].make(RESUME_SIZES[shape]), options: { kind: RESUME_SHAPES[shape].ext } };
        },
      });
    // 章ごとに page-sequence を分け、脚注・マーカーのある XSL-FO (page-sequence の使い回しの当たりにくい形。gen-stress-docs.mjs の REUSE_SHAPES)
    for (const shape of ['fofootnotes', 'fomarkers'])
      add({
        id: `generated/${shape}`,
        load: async () => {
          const { REUSE_SHAPES, REUSE_SIZES } = await import('./gen-stress-docs.mjs');
          return { text: REUSE_SHAPES[shape].make(REUSE_SIZES[shape]), options: { kind: REUSE_SHAPES[shape].ext } };
        },
      });
  }
  if (groups.includes('ah')) {
    const dir = path.join(samples, 'fo', 'samples');
    const fos = walk(dir).filter((f) => f.endsWith('.fo')).sort();
    if (!fos.length) skipped.push({ group: 'ah', reason: `見本が無い (${dir}。CLAUDE.md の「見本と書体の置き場」の手順で戻す)` });
    for (const f of fos) add(fileDoc(`ah/${path.basename(f, '.fo')}`, f, { compat: 'antenna' }));
  }
  if (groups.includes('css-print')) {
    const dir = path.join(samples, 'css-print', 'src');
    const html = path.join(dir, 'CSS-Print-ja.html');
    if (!fs.existsSync(html)) skipped.push({ group: 'css-print', reason: `見本が無い (${html})` });
    else
      add({
        id: 'css-print/CSS-Print-ja',
        load: async () => {
          const files = filesIn(dir, (f) => f === html || /LICENSE/i.test(f));
          return { text: fs.readFileSync(html, 'utf8'), options: () => ({ kind: 'html', style: 'ah', files }) };
        },
      });
  }
  if (groups.includes('weasyprint')) {
    // 見本の printall.sh と同じ組み合わせ (HTML と、weasyprint -s で足す CSS)。足す CSS は、利用者のスタイルシートとして当てる
    // (同じ HTML に足すほかの CSS は渡さない)
    const list = [
      ['ticket', 'ticket/ticket.html'],
      ['report', 'report/report.html'],
      ['poster', 'poster/poster.html', 'poster.css', 'flyer.css'],
      ['flyer', 'poster/poster.html', 'flyer.css', 'poster.css'],
      ['letter', 'letter/letter.html'],
      ['invoice', 'invoice/invoice.html'],
      ['book-classical', 'book/book.html', 'book-classical.css', 'book.css'],
      ['book', 'book/book.html', 'book.css', 'book-classical.css'],
    ];
    if (!fs.existsSync(path.join(weasyDir, 'ticket', 'ticket.html')))
      skipped.push({ group: 'weasyprint', reason: `見本が無い (${weasyDir}。GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <置き場> で取り、--weasyprint で渡す)` });
    else
      for (const [name, rel, , other] of list) {
        const html = path.join(weasyDir, rel);
        add({
          id: `weasyprint/${name}`,
          load: async () => {
            const files = filesIn(path.dirname(html), (f) => f === html || (other && path.basename(f) === other) || /\.(pdf|md|rst|sh)$/i.test(f));
            return { text: fs.readFileSync(html, 'utf8'), options: () => ({ kind: 'html', style: 'weasyprint', files, unreferencedCss: 'user-stylesheet' }) };
          },
        });
      }
  }
  return { docs, skipped };
}

/**
 * 文書の重さ (組む時間) のおおまかな見積もり。並べて組む道具が、重い文書から先に組むために使う (終わりに重い文書だけが長く走るのを防ぐ)。
 * 対応仕様説明書の HTML と CSS 編・『CSSページ組版入門』は 4、ほかの対応仕様説明書は 3、WeasyPrint の book と作った文書は 2、ほかは 1
 */
export const docWeight = (id) => (/^(conformance\/kumiori-html-css|css-print\/)/.test(id) ? 4 : /^conformance\//.test(id) ? 3 : /^(weasyprint\/book|generated\/)/.test(id) ? 2 : 1);

/**
 * 文書を組み比べるプロセスのメモリの山のおおまかな見積もり (GB。scripts/check-relayout.mjs は、基準と比べる対象の組版を並べて持つので大きい)。
 * 測った山 (VmHWM。--subjects reuse,splice-verify): 対応仕様説明書の HTML と CSS 編 (英語版) 5.0GB・XSL-FO 編 (英語版) 3.9GB・generated/nest 2.3GB
 */
export const docMemoryGB = (id) => [1, 1, 2.5, 4, 5][docWeight(id)];

/** 文書の並びの番号を、重い順に並べる (同じ重さは一覧の順) */
export const heavyFirst = (docs) =>
  docs
    .map((d, i) => ({ i, w: docWeight(d.id) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.i);
