/**
 * gen-stress-docs — 組版の速さと結果の戻りを確かめる文書を、種を決めた乱数で作る (いつも同じ文書が出る)。
 * 段組の脚注の文書は scripts/gen-column-footnotes.mjs。ここは、ほかの形 (深い入れ子・大きな表・多くの CSS の規則・長い段落・多くの画像) を作る。
 *
 * 形 (SHAPES。それぞれ大きさ n で、n に比例する量の文書を作る):
 *  - nest:   div・section・blockquote・ul/li・span を乱数で入れ子にした HTML (深さは 1〜100 段。入れ子の上限 128 段の内)。葉ごとに短い段落
 *  - table:  n 行 6 列の表 (HTML)。colspan・rowspan (1〜3) を乱数で混ぜ、thead を付ける。セルの字の長さも乱数
 *  - rules:  要素 n 個 (クラスを乱数で 0〜3 個) と規則 4n 個 (クラス・子孫・子・隣・属性・:nth-child・:not の混ざったもの) の HTML
 *  - para:   長い段落の HTML: 和文と欧文の語を混ぜた段落 n 個 (1 つ 200〜2000 字)。ruby・em・strong を乱数で挟む。初めの段落は n×100 字
 *  - images: 小さな SVG の画像 (data: の URL。大きさ・色・形は乱数) を n 個、float と行の中に混ぜた HTML
 *  - fonest: XSL-FO の入れ子 (fo:block・fo:block-container・fo:list-block・fo:inline。深さは 1〜40 段)
 *  - fotable: XSL-FO の n 行 5 列の表 (number-columns-spanned・number-rows-spanned を乱数で混ぜる)
 *
 * 使い方: node scripts/gen-stress-docs.mjs <出力のディレクトリ> [--scale <倍率>]
 *   形ごとに 1 つの文書 (大きさは STANDARD_SIZES × 倍率) と、文書ごとの形と大きさを書いた meta.json を置く。
 *   npm run compare:base の generated の群でも組む (scripts/compare-base.mjs の gens)。
 * 試験 (test/stressDocs.test.ts) は、小さな大きさで、ここの関数で文書を作り、ページ数・数行だけのページ・警告の数と、手間の伸び方を確かめる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { random } from './gen-column-footnotes.mjs';

const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KANJI = '組版文字行段落表画像規則入子速度試験頁脚注見出本文図版余白書体数式縦横';
const LATIN = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'typesetting', 'kumiori', 'paragraph', 'layout', 'engine', 'page', 'line'];

/** 乱数の便り: int(a, b) は a 以上 b 以下の整数、pick(xs) は 1 つ選ぶ */
function tools(seed) {
  const r = random(seed);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  /** 和文と欧文を混ぜた字の並び (およそ len 字) */
  const text = (len) => {
    let s = '';
    while (s.length < len) {
      const u = r();
      if (u < 0.45) s += Array.from({ length: int(2, 8) }, () => pick(KANA)).join('');
      else if (u < 0.75) s += Array.from({ length: int(1, 4) }, () => pick(KANJI)).join('');
      else s += ` ${pick(LATIN)} `;
      if (r() < 0.08) s += '。';
    }
    return s.slice(0, len).trim() || 'x';
  };
  return { r, int, pick, text };
}

const page = (css, body) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>@page { size: A5; margin: 15mm } body { font-size: 10pt; line-height: 1.6 } ${css}</style></head><body>${body}</body></html>`;

const foRoot = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="15mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="1.6">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 入れ子の HTML: 葉 n 個。入れ子の深さは乱数で 1〜100 段 (上がったり下がったり) */
export function nestHtml(n, seed = 1) {
  const { r, int, pick, text } = tools(seed);
  const kinds = ['div', 'section', 'blockquote', 'ul', 'div'];
  const stack = [];
  let s = '';
  for (let i = 0; i < n; i++) {
    const target = Math.min(100, Math.max(1, stack.length + int(-6, 6)));
    while (stack.length > target) s += `</${stack.pop()}>`;
    while (stack.length < target) {
      const k = stack[stack.length - 1] === 'ul' ? 'li' : pick(kinds);
      s += `<${k}${r() < 0.2 ? ' class="b"' : ''}>`;
      stack.push(k);
    }
    let inner = text(int(10, 80));
    if (r() < 0.3) {
      const k = int(1, 10);
      inner = `${text(int(5, 30))}${'<span>'.repeat(k)}${text(int(5, 20))}${'</span>'.repeat(k)}`;
    }
    s += stack[stack.length - 1] === 'ul' ? `<li>${inner}</li>` : `<p>${inner}</p>`;
  }
  while (stack.length) s += `</${stack.pop()}>`;
  return page('div, section, blockquote { margin: 0 0 0 1pt } ul { margin: 0; padding-left: 6pt } .b { border-left: 1px solid #888; padding-left: 2pt } p { margin: 0 }', s);
}

/** 大きな表の HTML: n 行 6 列。colspan・rowspan は 1〜3 (列と行の残りの内) */
export function tableHtml(n, seed = 2) {
  const { r, int, text } = tools(seed);
  const cols = 6;
  // 行ごとの、上の行の rowspan で埋まっている列
  const busy = Array.from({ length: n + 3 }, () => new Array(cols).fill(false));
  let s = `<table><thead><tr>${Array.from({ length: cols }, (_, c) => `<th>見出し${c + 1}</th>`).join('')}</tr></thead><tbody>`;
  for (let i = 0; i < n; i++) {
    s += '<tr>';
    for (let c = 0; c < cols; ) {
      if (busy[i][c]) {
        c++;
        continue;
      }
      let cs = r() < 0.15 ? int(2, 3) : 1;
      while (cs > 1 && (c + cs > cols || busy[i].slice(c, c + cs).some(Boolean))) cs--;
      // 1 列目は行をまたがない (どの行にもセルが 1 つはあるように)
      const rs = c > 0 && r() < 0.1 ? Math.min(int(2, 3), n - i) : 1;
      for (let k = 1; k < rs; k++) for (let j = c; j < c + cs; j++) busy[i + k][j] = true;
      s += `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${text(int(1, r() < 0.1 ? 120 : 20))}</td>`;
      c += cs;
    }
    s += '</tr>';
  }
  return page('table { border-collapse: collapse; width: 100% } td, th { border: 0.5pt solid #444; padding: 1pt; font-size: 8pt } th { background: #eee }', s + '</tbody></table>');
}

/** 多くの CSS の規則の HTML: 要素 n 個と規則 4n 個 */
export function rulesHtml(n, seed = 3) {
  const { r, int, pick, text } = tools(seed);
  const classes = Array.from({ length: Math.max(8, Math.floor(n / 4)) }, (_, i) => `k${i}`);
  const tags = ['p', 'div', 'span', 'em', 'strong'];
  const sel = () => {
    const c = () => `.${pick(classes)}`;
    const u = r();
    if (u < 0.2) return c();
    if (u < 0.35) return `${c()} ${pick(tags)}`;
    if (u < 0.5) return `${c()} > ${pick(tags)}${c()}`;
    if (u < 0.6) return `${c()} + ${c()}`;
    if (u < 0.7) return `[data-k="${int(0, 20)}"]${c()}`;
    if (u < 0.8) return `${pick(tags)}:nth-child(${int(2, 5)}n+${int(0, 3)})${c()}`;
    if (u < 0.9) return `${c()}:not(${c()})`;
    return `${c()} ${c()} ${pick(tags)}`;
  };
  const decl = () =>
    pick([
      `color: rgb(${int(0, 200)}, ${int(0, 200)}, ${int(0, 200)})`,
      `font-weight: ${pick(['bold', 'normal'])}`,
      `margin-left: ${int(0, 8)}pt`,
      `background: #${int(0x888888, 0xffffff).toString(16)}`,
      `font-size: ${int(8, 12)}pt`,
      `text-decoration: ${pick(['underline', 'none'])}`,
    ]);
  const css = Array.from({ length: 4 * n }, () => `${sel()} { ${decl()} }`).join('\n');
  const cls = () => Array.from({ length: int(0, 3) }, () => pick(classes)).join(' ');
  let s = '';
  for (let i = 0; i < n; i++) {
    const t = pick(['p', 'div', 'p']);
    s += `<${t} class="${cls()}" data-k="${int(0, 20)}">${text(int(5, 30))}<span class="${cls()}">${text(int(3, 10))}</span><em class="${cls()}">${text(int(2, 6))}</em></${t}>`;
  }
  return page(css, s);
}

/** 長い段落の HTML: 段落 n 個 (初めの段落は n×100 字、ほかは 200〜2000 字) */
export function paraHtml(n, seed = 4) {
  const { r, int, pick, text } = tools(seed);
  const inline = (len) => {
    let s = '';
    while (s.length < len) {
      const u = r();
      const t = text(int(10, 60));
      if (u < 0.05) s += `<ruby>${pick(KANJI)}${pick(KANJI)}<rt>${pick(KANA)}${pick(KANA)}</rt></ruby>`;
      else if (u < 0.12) s += `<em>${t}</em>`;
      else if (u < 0.17) s += `<strong>${t}</strong>`;
      else s += t;
    }
    return s;
  };
  let s = `<p>${inline(n * 100)}</p>`;
  for (let i = 1; i < n; i++) s += `<p>${inline(int(200, 2000))}</p>`;
  return page('p { text-align: justify; text-indent: 1em; margin: 0 }', s);
}

/** 小さな SVG の画像 n 個の HTML (float と行の中) */
export function imagesHtml(n, seed = 5) {
  const { r, int, pick, text } = tools(seed);
  const svg = () => {
    const w = int(10, 80);
    const h = int(10, 80);
    const col = `#${int(0x222222, 0xdddddd).toString(16)}`;
    const shape = pick([`<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="${col}"/>`, `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2 - 1}" fill="${col}"/>`, `<path d="M0 ${h}L${w / 2} 0L${w} ${h}Z" fill="${col}"/>`]);
    return { w, h, src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shape}</svg>`)}` };
  };
  let s = '';
  for (let i = 0; i < n; i++) {
    const im = svg();
    const u = r();
    if (u < 0.3) s += `<p><img class="fl" src="${im.src}" width="${im.w}" height="${im.h}">${text(int(20, 120))}</p>`;
    else if (u < 0.8) s += `<p>${text(int(5, 40))}<img src="${im.src}" width="${Math.ceil(im.w / 4)}" height="${Math.ceil(im.h / 4)}">${text(int(5, 40))}</p>`;
    else s += `<p><img class="bl" src="${im.src}" width="${im.w * 2}" height="${im.h * 2}"></p>`;
  }
  return page('p { margin: 0 0 2pt } .fl { float: left; margin: 0 4pt 2pt 0 } .bl { display: block }', s);
}

/** XSL-FO の入れ子: 葉 n 個 (深さ 1〜40 段。字下げで行が狭くなりすぎないように、字下げは 4 段に 1 段ほど) */
export function nestFo(n, seed = 6) {
  const { r, int, pick, text } = tools(seed);
  const open = [];
  let s = '';
  const begin = () => {
    const k = pick(['block', 'block', 'container', 'list']);
    if (k === 'block') {
      s += `<fo:block${r() < 0.25 ? ' margin-left="2pt"' : ''}${r() < 0.2 ? ' border-start-style="solid" border-start-width="0.5pt"' : ''}>`;
      open.push('</fo:block>');
    } else if (k === 'container') {
      s += '<fo:block-container><fo:block>';
      open.push('</fo:block></fo:block-container>');
    } else {
      s += '<fo:list-block provisional-distance-between-starts="6pt"><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>・</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()"><fo:block>';
      open.push('</fo:block></fo:list-item-body></fo:list-item></fo:list-block>');
    }
  };
  for (let i = 0; i < n; i++) {
    const target = Math.min(40, Math.max(1, open.length + int(-5, 5)));
    while (open.length > target) s += open.pop();
    while (open.length < target) begin();
    s += r() < 0.3 ? `<fo:block>${text(int(5, 30))}<fo:inline font-weight="bold">${text(int(3, 15))}</fo:inline></fo:block>` : `<fo:block>${text(int(10, 80))}</fo:block>`;
  }
  while (open.length) s += open.pop();
  return foRoot(s);
}

/** XSL-FO の表: n 行 5 列 (列・行をまたぐセルを乱数で混ぜる) */
export function tableFo(n, seed = 7) {
  const { r, int, text } = tools(seed);
  const cols = 5;
  const busy = Array.from({ length: n + 3 }, () => new Array(cols).fill(false));
  let s = `<fo:table table-layout="fixed" width="100%" border-collapse="collapse">${'<fo:table-column column-width="proportional-column-width(1)"/>'.repeat(cols)}`;
  s += `<fo:table-header><fo:table-row>${Array.from({ length: cols }, (_, c) => `<fo:table-cell border="0.5pt solid black"><fo:block font-weight="bold">見出し${c + 1}</fo:block></fo:table-cell>`).join('')}</fo:table-row></fo:table-header><fo:table-body>`;
  for (let i = 0; i < n; i++) {
    s += '<fo:table-row>';
    for (let c = 0; c < cols; ) {
      if (busy[i][c]) {
        c++;
        continue;
      }
      let cs = r() < 0.15 ? int(2, 3) : 1;
      while (cs > 1 && (c + cs > cols || busy[i].slice(c, c + cs).some(Boolean))) cs--;
      // 1 列目は行をまたがない (どの行にもセルが 1 つはあるように)
      const rs = c > 0 && r() < 0.1 ? Math.min(int(2, 3), n - i) : 1;
      for (let k = 1; k < rs; k++) for (let j = c; j < c + cs; j++) busy[i + k][j] = true;
      s += `<fo:table-cell border="0.5pt solid black"${cs > 1 ? ` number-columns-spanned="${cs}"` : ''}${rs > 1 ? ` number-rows-spanned="${rs}"` : ''}><fo:block font-size="8pt">${text(int(1, r() < 0.1 ? 100 : 20))}</fo:block></fo:table-cell>`;
      c += cs;
    }
    s += '</fo:table-row>';
  }
  return foRoot(s + '</fo:table-body></fo:table>');
}

/**
 * 左右のページで本文の幅が違い (HTML の @page :left の余白)、ページをまたぐ長い段落の続く HTML。n は段落の数。
 * 続きから組む作りの確かめ (scripts/check-resume.mjs・check-relayout.mjs の generated の群) に使う: 段落の途中の境目から続けると、
 * 行の長さの変わるページで残りの行を組み直す。その間の境目の続きの位置の誤りを探す
 */
export function sideWidthHtml(n, seed = 9) {
  return paraHtml(n, seed).replace('@page { size: A5; margin: 15mm }', '@page { size: A5; margin: 15mm } @page :left { margin-left: 30mm }');
}

/**
 * 奇数・偶数のページで本文の幅が違うマスターと、最後のページのマスター (page-position="last"。余白が広い) のある XSL-FO。
 * ページをまたぐ長い段落が n 個続く。最後のページのマスターの組み直しが、段落の途中の境目から続けて組む (sideWidthHtml と同じ確かめに使う)
 */
export function sideWidthFo(n, seed = 10) {
  const { int, text } = tools(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<fo:block text-align="justify" text-indent="1em" space-after="4pt">${text(int(800, 2400))}</fo:block>`;
  const spm = (name, extra) => `<fo:simple-page-master master-name="${name}" page-width="148mm" page-height="210mm" margin="15mm"${extra}><fo:region-body/></fo:simple-page-master>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja"><fo:layout-master-set>` +
    spm('odd', '') +
    spm('even', ' margin-left="30mm"') +
    spm('last', ' margin-bottom="60mm"') +
    `<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="last" page-position="last"/>` +
    `<fo:conditional-page-master-reference master-reference="even" odd-or-even="even"/><fo:conditional-page-master-reference master-reference="odd"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>` +
    `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="1.6">${s}</fo:flow></fo:page-sequence></fo:root>`
  );
}

/**
 * 罫線をつぶした表 (border-collapse: collapse) がページをまたぐ HTML。表は見出しの行 (thead) を繰り返し、2 行をまたぐセル (rowspan) と
 * 分けない指定の行 (break-inside: avoid) を混ぜ、長さの違うセルで、行の境目の改ページ・行の中の改ページの両方が起きるようにする。n は表の数。
 * 改ページの境目では、ページの最後の行の後ろ側の線と、表ヘッダーの後の最初の行の前側の線を、組んだ行のセルの辺を書き換えて決める。
 * 境目から組み直す確かめ (遅く戻る試し) で、前の組みの書き換えが組み直しに漏れる誤りを探す
 */
export function collapseTableHtml(n, seed = 11) {
  const { r, int, text } = tools(seed);
  let body = '';
  for (let t = 0; t < n; t++) {
    body += `<p>${text(int(40, 300))}</p>`;
    let rows = '';
    let spanLeft = 0;
    const m = int(8, 16);
    for (let i = 0; i < m; i++) {
      const avoid = r() < 0.25 ? ' style="break-inside: avoid"' : '';
      // 2 列目は、2 行をまたぐセルか、またいだセルの続きの行 (セルを置かない)
      const span = spanLeft === 0 && i + 1 < m && r() < 0.35;
      const second = spanLeft > 0 ? '' : `<td${span ? ' rowspan="2"' : ''}>r${i}</td>`;
      spanLeft = span ? 1 : Math.max(0, spanLeft - 1);
      rows += `<tr${avoid}><td>${i}</td>${second}<td>${text(r() < 0.15 ? int(200, 500) : int(5, 80))}</td></tr>`;
    }
    // 罫線は、表ごとに、すべてのセル・表ヘッダーの下の線だけ・ところどころのセルの上の線と表ヘッダーの下の線、のどれか
    // (セルに後ろ側の線が無く、次の行のセルや表ヘッダーに線のある所で、ページの最後の行の後ろ側の線を決める)
    const cls = ['all', 'head', 'some'][t % 3];
    body += `<table class="${cls}"${t % 4 === 3 ? ' style="break-before: right"' : ''}><thead><tr><th>番号</th><th>H</th><th>中身</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>@page { size: A6; margin: 9mm } @page :first { margin-top: 30mm } body { font-size: 9pt } ' +
    'table { border-collapse: collapse; width: 100% } td, th { padding: 1pt 3pt } .all td, .all th { border: 0.5pt solid black } th { border-bottom: 1.5pt solid black } ' +
    '.some tr:nth-child(3n) td { border-top: 0.25pt solid black }</style></head><body>' +
    body +
    '</body></html>'
  );
}

/**
 * 罫線をつぶした表がページをまたぐ XSL-FO。最後のページのマスター (page-position="last"。余白が広い) で、最後のページを組み直すとき、
 * 境目から続けて組む。表は表ヘッダーを繰り返し、2 行をまたぐセル (number-rows-spanned) と、分けない指定の行 (keep-together) を混ぜる。n は表の数
 */
export function collapseTableFo(n, seed = 12) {
  const { r, int, text } = tools(seed);
  // 罫線は、表ごとに、すべてのセル・表ヘッダーの下の線だけ・ところどころのセルの上の線と表ヘッダーの下の線、のどれか (collapseTableHtml と同じ)
  let cls = 'all';
  let row = 0;
  const cell = (body, extra = '') =>
    `<fo:table-cell padding="1pt"${cls === 'all' ? ' border="0.5pt solid black"' : cls === 'some' && row % 3 === 2 ? ' border-before-style="solid" border-before-width="0.25pt"' : ''}${extra}><fo:block>${body}</fo:block></fo:table-cell>`;
  const head = ' border-after-style="solid" border-after-width="1.5pt"';
  let s = '';
  for (let t = 0; t < n; t++) {
    cls = ['all', 'head', 'some'][t % 3];
    s += `<fo:block space-after="4pt">${text(int(40, 300))}</fo:block>`;
    let rows = '';
    let spanLeft = 0;
    const m = int(8, 16);
    for (let i = 0; i < m; i++) {
      row = i;
      const keep = r() < 0.25 ? ' keep-together.within-page="always"' : '';
      const span = spanLeft === 0 && i + 1 < m && r() < 0.35;
      const second = spanLeft > 0 ? '' : cell(`r${i}`, span ? ' number-rows-spanned="2"' : '');
      spanLeft = span ? 1 : Math.max(0, spanLeft - 1);
      rows += `<fo:table-row${keep}>${cell(String(i))}${second}${cell(text(r() < 0.15 ? int(200, 500) : int(5, 80)))}</fo:table-row>`;
    }
    row = -1;
    s +=
      `<fo:table table-layout="fixed" width="100%" border-collapse="collapse" space-after="4pt"><fo:table-column column-width="12mm"/><fo:table-column column-width="12mm"/><fo:table-column column-width="proportional-column-width(1)"/>` +
      `<fo:table-header><fo:table-row>${cell('番号', head)}${cell('H', head)}${cell('中身', head)}</fo:table-row></fo:table-header><fo:table-body>${rows}</fo:table-body></fo:table>`;
  }
  const spm = (name, extra) => `<fo:simple-page-master master-name="${name}" page-width="105mm" page-height="148mm" margin="9mm"${extra}><fo:region-body/></fo:simple-page-master>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja"><fo:layout-master-set>` +
    spm('p', '') +
    spm('last', ' margin-bottom="40mm"') +
    `<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="last" page-position="last"/>` +
    `<fo:conditional-page-master-reference master-reference="p"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>` +
    `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="8pt">${s}</fo:flow></fo:page-sequence></fo:root>`
  );
}

/**
 * 章ごとに page-sequence を分けた XSL-FO (n は章の数)。createTypesetter の使い回し (前の文書の page-sequence を、そのまま使い回す作り) の確かめに使う。
 * kind が footnote なら、本文の段落に脚注を付ける (タグ付きの PDF では、脚注の構造の要素を、文書の初めからの通し番号で名付ける)。
 * marker なら、章の段落にマーカーを置き、柱 (region-before) で retrieve-marker で引く
 */
export function chaptersFo(n, seed = 13, kind = 'footnote') {
  const { r, int, text } = tools(seed);
  let seqs = '';
  for (let c = 0; c < n; c++) {
    let body = `<fo:block font-size="14pt" space-after="6pt">第 ${c + 1} 章</fo:block>`;
    const m = int(6, 14);
    for (let i = 0; i < m; i++) {
      const note = kind === 'footnote' && r() < 0.4 ? `<fo:footnote><fo:inline baseline-shift="super" font-size="6pt">*</fo:inline><fo:footnote-body><fo:block font-size="7pt">${text(int(20, 120))}</fo:block></fo:footnote-body></fo:footnote>` : '';
      const marker = kind === 'marker' ? `<fo:marker marker-class-name="sec">${c + 1}.${i + 1} ${text(int(3, 10))}</fo:marker>` : '';
      body += `<fo:block space-after="4pt">${marker}${text(int(60, 400))}${note}${text(int(10, 80))}</fo:block>`;
    }
    const head = kind === 'marker' ? '<fo:retrieve-marker retrieve-class-name="sec" retrieve-position="first-including-carryover"/>' : `第 ${c + 1} 章`;
    seqs +=
      `<fo:page-sequence master-reference="p"><fo:static-content flow-name="xsl-region-before"><fo:block font-size="7pt" text-align="end">${head}</fo:block></fo:static-content>` +
      `<fo:flow flow-name="xsl-region-body" font-size="9pt" line-height="1.5">${body}</fo:flow></fo:page-sequence>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja"><fo:layout-master-set>` +
    `<fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="9mm"><fo:region-body margin-top="8mm"/><fo:region-before extent="6mm"/></fo:simple-page-master></fo:layout-master-set>` +
    seqs +
    '</fo:root>'
  );
}

/** createTypesetter の使い回しの確かめに使う形 (SHAPES と同じ形。書き出す一揃い・指標の試験には入れない)。大きさは REUSE_SIZES */
export const REUSE_SHAPES = {
  fofootnotes: { make: (n, seed) => chaptersFo(n, seed ?? 13, 'footnote'), ext: 'fo' },
  fomarkers: { make: (n, seed) => chaptersFo(n, seed ?? 14, 'marker'), ext: 'fo' },
};
export const REUSE_SIZES = { fofootnotes: 8, fomarkers: 8 };

/** 続きから組む作りの確かめに使う形 (SHAPES と同じ形。書き出す一揃い・指標の試験には入れない)。大きさは RESUME_SIZES */
export const RESUME_SHAPES = {
  sidewidth: { make: sideWidthHtml, ext: 'html' },
  fosidewidth: { make: sideWidthFo, ext: 'fo' },
  collapsetable: { make: collapseTableHtml, ext: 'html' },
  focollapsetable: { make: collapseTableFo, ext: 'fo' },
};
export const RESUME_SIZES = { sidewidth: 12, fosidewidth: 12, collapsetable: 6, focollapsetable: 6 };

/** 形の一覧: 名前 → { make(n, seed), ext } */
export const SHAPES = {
  nest: { make: nestHtml, ext: 'html' },
  table: { make: tableHtml, ext: 'html' },
  rules: { make: rulesHtml, ext: 'html' },
  para: { make: paraHtml, ext: 'html' },
  images: { make: imagesHtml, ext: 'html' },
  fonest: { make: nestFo, ext: 'fo' },
  fotable: { make: tableFo, ext: 'fo' },
};

/** 書き出す大きさ (compare:base で組む大きさ。1 つ数秒で組める程度) */
export const STANDARD_SIZES = { nest: 1500, table: 600, rules: 800, para: 40, images: 600, fonest: 1500, fotable: 600 };

/** 書き出す文書の一揃い: { name, text, shape, n } の並び */
export function standardSet(scale = 1) {
  return Object.entries(SHAPES).map(([shape, s]) => {
    const n = Math.max(1, Math.round(STANDARD_SIZES[shape] * scale));
    return { name: `${shape}${n}.${s.ext}`, text: s.make(n), shape, n };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let scale = 1;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scale') scale = Number(argv[++i]);
    else rest.push(argv[i]);
  }
  const dir = rest[0];
  if (!dir || !(scale > 0)) {
    console.error('使い方: node scripts/gen-stress-docs.mjs <出力のディレクトリ> [--scale <倍率>]');
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const meta = {};
  for (const d of standardSet(scale)) {
    fs.writeFileSync(path.join(dir, d.name), d.text);
    meta[d.name] = { shape: d.shape, n: d.n };
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  console.log(`${Object.keys(meta).length} 個の文書を ${dir} に置きました`);
}
