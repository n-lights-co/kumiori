/**
 * 対応仕様説明書 (docs/conformance) の見本の取り出しと、コードの表示の差し込み。
 * scripts/build-conformance.mjs (PDF に組む) と test/conformance.test.ts (見本をテストとして組む) で使う。
 *
 * 見本は文書の中に 1 回だけ書き、前後に印を付ける:
 *   XSL-FO: <?kumiori-sample id="名前"?> … <?kumiori-sample-end?>
 *   HTML  : <!--kumiori-sample id="名前"--> … <!--/kumiori-sample-->
 * 印の間は、そのまま組まれる (組版例)。組むときに、印の間の原文をコードの表示にして、組版例の後に差し込む。
 * 印に mark="文字列|文字列" を書くと、コードの表示の中のその文字列を強調する (見本の要所)。
 * 印の間に置けるのは、FO なら fo:flow の中に置ける要素、HTML なら body の中に置ける要素。
 */

const MARK = {
  fo: { start: /<\?kumiori-sample\s+id="([^"]+)"(?:\s+mark="([^"]*)")?\s*\?>/g, end: '<?kumiori-sample-end?>' },
  html: { start: /<!--kumiori-sample\s+id="([^"]+)"(?:\s+mark="([^"]*)")?\s*-->/g, end: '<!--\/kumiori-sample-->' },
};

/** 見本の並び: { id, code (原文。字下げをそろえたもの), raw (印の間の原文), marks (強調する文字列), start, end (印を含む位置) } */
export function extractSamples(text, kind) {
  const m = MARK[kind];
  const out = [];
  m.start.lastIndex = 0;
  for (let s; (s = m.start.exec(text)); ) {
    const from = s.index + s[0].length;
    const to = text.indexOf(m.end, from);
    if (to < 0) throw new Error(`見本 ${s[1]} の終わりの印がありません`);
    const raw = text.slice(from, to);
    const marks = (s[2] ?? '').split('|').filter(Boolean).map((x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    out.push({ id: s[1], raw, code: dedent(raw), marks, start: s.index, end: to + m.end.length });
    m.start.lastIndex = to + m.end.length;
  }
  const ids = new Set();
  for (const x of out) {
    if (ids.has(x.id)) throw new Error(`見本の名前 ${x.id} が重なっています`);
    ids.add(x.id);
  }
  return out;
}

/** 前後の空の行を除き、共通の字下げを取る */
export function dedent(s) {
  const lines = s.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 見本ごとに、コードの表示と、組版例の枠を差し込んだ文書 */
export function expand(text, kind) {
  const samples = extractSamples(text, kind);
  let out = '';
  let at = 0;
  for (const s of samples) {
    out += text.slice(at, s.start);
    out += kind === 'fo' ? foSample(s) : htmlSample(s);
    at = s.end;
  }
  return out + text.slice(at);
}

/** コードを逃がし、強調する文字列を open … close で囲む */
function marked(code, marks, open, close) {
  if (!marks.length) return esc(code);
  const re = new RegExp(marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let out = '';
  let at = 0;
  for (let m; (m = re.exec(code)); ) {
    if (!m[0]) break;
    out += esc(code.slice(at, m.index)) + open + esc(m[0]) + close;
    at = m.index + m[0].length;
  }
  return out + esc(code.slice(at));
}

function foSample(s) {
  return (
    `<fo:block-container role="kumiori-result" id="result-${s.id}" border="0.5pt solid #b9bfbc" padding="7pt" space-before="7pt" keep-with-next.within-page="always" keep-together.within-page="always">` +
    s.raw +
    `</fo:block-container>` +
    `<fo:block role="kumiori-listing" id="code-${s.id}" font-family="monospace" font-size="7.2pt" line-height="1.45" color="#2f3437" ` +
    `background-color="#f2f3f1" padding="5pt" padding-start="7pt" space-before="0pt" space-after="10pt" keep-together.within-page="always" ` +
    `linefeed-treatment="preserve" white-space-collapse="false" white-space-treatment="preserve" wrap-option="wrap" ` +
    `text-align="start" hyphenate="false">${marked(s.code, s.marks, '<fo:inline font-weight="bold" background-color="#fff3a8">', '</fo:inline>')}</fo:block>`
  );
}

function htmlSample(s) {
  return (
    `<div class="kumiori-result" id="result-${s.id}">${s.raw}</div>` +
    `<pre class="kumiori-listing" id="code-${s.id}"><code>${marked(s.code, s.marks, '<b>', '</b>')}</code></pre>`
  );
}

/** 見本を、それだけで組める文書にする (テスト用) */
export function standalone(sample, kind) {
  if (kind === 'fo') {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" xml:lang="ja">` +
      `<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="148mm" page-height="210mm" margin="12mm">` +
      `<fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${sample.raw}</fo:flow></fo:page-sequence></fo:root>`
    );
  }
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${esc(sample.id)}</title></head><body>${sample.raw}</body></html>`;
}
