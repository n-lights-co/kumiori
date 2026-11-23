/**
 * gen-column-footnotes — 段組のページの脚注の組み直しを確かめる文書を作る (種を決めた乱数で、いつも同じ文書が出る)。
 *
 * 作る文書 (standardSet):
 * - mix3000a.html・mix3000b.html: 2 段の HTML (300pt 角・margin 10pt)。本文 3000 行 (<p>line N text</p>) の行ごとに、確率 0.08・0.15 で
 *   脚注を付ける。脚注の長さは、15% が 12 か 30 行、10% が 6〜11 行、残りが 1〜5 行 (1 行は「fnNxJ」と「w」を 12 個)。
 * - mix3000fo.fo: mix3000a と同じ脚注の、XSL-FO の region-body の 2 段。
 * - col00〜col25: 短い文書 26 個 (HTML 18・XSL-FO 8。2・3 段、本文 60〜400 行、脚注の確率 0.03〜0.15)。
 * - lay58.html: 脚注の量がページより多い段組 (300×400pt・2 段・9pt の本文、4 行の段落 12 個に 3 行の脚注 (7pt) を 1 つずつ)。
 *
 * 使い方: node scripts/gen-column-footnotes.mjs <出力のディレクトリ>
 * 文書と、文書ごとの本文の行の数と脚注 (行の番号 → 脚注の行の数) を書いた meta.json を置く。
 * 組んだ結果の数え方は scripts/measure-column-footnotes.mjs。試験 (test/columnFootnoteReserve.test.ts) も、ここの関数で文書を作る。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 種から決まる乱数 (mulberry32)。0 以上 1 未満を返す関数 */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 行ごとに確率 p で脚注を付ける (rnd は random の返す関数か種)。長さは 15% が 12 か 30 行、10% が 6〜11 行、残りが 1〜5 行 */
export function randomNotes(lines, p, rnd) {
  const r = typeof rnd === 'function' ? rnd : random(rnd);
  const notes = {};
  for (let n = 1; n <= lines; n++) {
    if (r() >= p) continue;
    const u = r();
    notes[n] = u < 0.15 ? (r() < 0.5 ? 12 : 30) : u < 0.25 ? 6 + Math.floor(r() * 6) : 1 + Math.floor(r() * 5);
  }
  return notes;
}

/** 脚注の 1 行: 「fnNxJ」と「w」を 12 個 */
export const footnoteItem = (n, j) => `fn${n}x${j} ` + Array(12).fill('w').join(' ');

/** 本文 lines 行 (line N text)。notes の行に、その行数の脚注を付ける (HTML、300pt 角、cols 段) */
export function columnHtml(lines, notes, cols = 2) {
  let s =
    `<!doctype html><html><head><style>@page { size: 300pt 300pt; margin: 10pt } ` +
    `body { margin: 0; font-size: 10pt; line-height: 12pt; column-count: ${cols} } p { margin: 0 } .F { float: footnote } .i { display: block }` +
    `</style></head><body>`;
  for (let n = 1; n <= lines; n++) {
    const c = notes[n];
    if (!c) {
      s += `<p>line ${n} text</p>`;
      continue;
    }
    let rest = '';
    for (let j = 2; j <= c; j++) rest += `<span class=i>${footnoteItem(n, j)}</span>`;
    s += `<p>line ${n} text<span class=F>${footnoteItem(n, 1)}${rest}</span></p>`;
  }
  return s + `</body></html>`;
}

/** 同じ形の XSL-FO (region-body の cols 段。脚注の 1 行が 1 つの fo:block) */
export function columnFo(lines, notes, cols = 2) {
  let s =
    `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format">` +
    `<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="10pt">` +
    `<fo:region-body column-count="${cols}" column-gap="12pt"/></fo:simple-page-master></fo:layout-master-set>` +
    `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="12pt">`;
  for (let n = 1; n <= lines; n++) {
    const c = notes[n];
    if (!c) {
      s += `<fo:block>line ${n} text</fo:block>`;
      continue;
    }
    let body = '';
    for (let j = 1; j <= c; j++) body += `<fo:block>${footnoteItem(n, j)}</fo:block>`;
    s += `<fo:block>line ${n} text<fo:footnote><fo:inline baseline-shift="super" font-size="7pt">*</fo:inline><fo:footnote-body>${body}</fo:footnote-body></fo:footnote></fo:block>`;
  }
  return s + `</fo:flow></fo:page-sequence></fo:root>`;
}

/** 脚注の量がページより多い段組 (300×400pt・2 段・9pt。line N text と word 20 個の 4 行の段落 12 個に、3 行の脚注 (7pt)) */
export function overfullHtml() {
  const para = Array(20).fill('word').join(' ');
  let s =
    `<!doctype html><html><head><style>@page { size: 300pt 400pt; margin: 10pt } ` +
    `body { margin: 0; font-size: 9pt; column-count: 2; column-gap: 12pt } p { margin: 0 } .F { float: footnote; font-size: 7pt } .i { display: block }` +
    `</style></head><body>`;
  const notes = {};
  for (let n = 1; n <= 12; n++) {
    s += `<p>line ${n} text ${para}<span class=F>${footnoteItem(n, 1)}<span class=i>${footnoteItem(n, 2)}</span><span class=i>${footnoteItem(n, 3)}</span></span></p>`;
    notes[n] = 3;
  }
  return { text: s + `</body></html>`, lines: 12, notes };
}

/** 確かめの文書の一揃い: { name, text, lines, notes } の並び */
export function standardSet() {
  const out = [];
  const a = randomNotes(3000, 0.08, 7);
  const b = randomNotes(3000, 0.15, 8);
  out.push({ name: 'mix3000a.html', text: columnHtml(3000, a), lines: 3000, notes: a });
  out.push({ name: 'mix3000b.html', text: columnHtml(3000, b), lines: 3000, notes: b });
  out.push({ name: 'mix3000fo.fo', text: columnFo(3000, a), lines: 3000, notes: a });
  const r = random(20261121);
  for (let i = 0; i < 26; i++) {
    const lines = 60 + Math.floor(r() * 341);
    const cols = r() < 2 / 3 ? 2 : 3;
    const p = 0.03 + r() * 0.12;
    const notes = randomNotes(lines, p, r);
    const name = `col${String(i).padStart(2, '0')}.${i < 18 ? 'html' : 'fo'}`;
    out.push({ name, text: i < 18 ? columnHtml(lines, notes, cols) : columnFo(lines, notes, cols), lines, notes });
  }
  out.push({ name: 'lay58.html', ...overfullHtml() });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('使い方: node scripts/gen-column-footnotes.mjs <出力のディレクトリ>');
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const meta = {};
  for (const d of standardSet()) {
    fs.writeFileSync(path.join(dir, d.name), d.text);
    meta[d.name] = { lines: d.lines, notes: d.notes };
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  console.log(`${Object.keys(meta).length} 個の文書を ${dir} に置きました`);
}
