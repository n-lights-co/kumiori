/**
 * 組み直しの組み比べの部品 (test/relayoutCheck.test.ts と scripts/check-relayout.mjs が使う)。
 *
 * 文書を、種を決めた乱数の所で少しずつ直し (字を足す・消す・置き換える)、直した文書の並びを、比べる器 (既定は使い回しをする器:
 * createTypesetter の reuse) と、基準の器 (reuse: false) で順に組んで、組んだ結果が同じかを確かめる。比べるのは
 *  - 領域の木 (serializeAreaTree の文字列。違えば、最初に違うページ)
 *  - 診断 (diagnostics。場所 (行・桁) まで) と警告の文
 *  - PDF のバイト列 (違えば、最初に違うバイトの位置)
 * PDF の作った日時とファイルの識別子 (trailer の ID。乱数で作る) は、時計と乱数を止めて同じにする (freezeClockAndRandom)。
 *
 * 比べる器は、名前と作り方の並び (subjects) で渡す。使い回しの有無と、ページの境目から続けて組む器 (scripts/check-relayout.mjs の resume) を
 * 比べる。変わったページから組み直して前の組版と繋ぐ作りを入れたら、その器や、組んだ結果から数を取り出す関数 (stats) を足して、同じ比べに載せる。
 * 組版のライブラリ (createTypesetter・serializeAreaTree) は、呼ぶ側が渡す (試験は src を、道具はビルドしたものを渡す)。
 */

/** 種を決めた乱数 (mulberry32)。0 以上 1 未満を返す関数 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列から種を作る (文書ごとに違う種にする。FNV-1a) */
export function seedOf(...parts) {
  let h = 0x811c9dc5;
  for (const c of parts.join('\u0000')) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** 中身を字として読まない要素 (HTML の生の字の要素)。その中は直さない */
const RAW = /^(style|script|textarea|xmp|noscript|template)$/i;

/**
 * 文書の字の部分 (タグ・注釈・CDATA・処理命令・<!DOCTYPE> と、style・script などの中を除いた、空白だけでない字の並び) の範囲を返す。
 * 直すときに文書の形 (要素の入れ子) を壊さないための、軽い字の切り出し (属性の値の中の > は、引用符を見て読み飛ばす)
 */
export function textRanges(text) {
  const out = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end) => {
    if (end > textStart && /\S/.test(text.slice(textStart, end))) out.push([textStart, end]);
  };
  while (i < text.length) {
    if (text[i] !== '<') {
      i++;
      continue;
    }
    pushText(i);
    let end;
    if (text.startsWith('<!--', i)) end = text.indexOf('-->', i + 4) + 3;
    else if (text.startsWith('<![CDATA[', i)) end = text.indexOf(']]>', i + 9) + 3;
    else if (text.startsWith('<?', i)) end = text.indexOf('?>', i + 2) + 2;
    else {
      // タグ (<!DOCTYPE …> も)。引用符の中の > は読み飛ばす
      let j = i + 1;
      let q;
      for (; j < text.length; j++) {
        const c = text[j];
        if (q) {
          if (c === q) q = undefined;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
      }
      end = j + 1;
      const m = /^<([A-Za-z][\w:.-]*)/.exec(text.slice(i, i + 40));
      if (m && RAW.test(m[1]) && text[j - 1] !== '/') {
        // 生の字の要素: 閉じるタグまで読み飛ばす
        const close = text.toLowerCase().indexOf(`</${m[1].toLowerCase()}`, end);
        end = close < 0 ? text.length : close;
      }
    }
    if (end <= i) end = text.length;
    i = end;
    textStart = i;
  }
  pushText(text.length);
  return out;
}

/** 字の並び [s, e) の中で、切ってよい位置か (文字参照 &…; の中と、サロゲートの対の間は切らない) */
function cuttable(text, s, e, at) {
  if (at < s || at > e) return false;
  const c = text.charCodeAt(at);
  if (at < e && c >= 0xdc00 && c <= 0xdfff) return false;
  const amp = text.lastIndexOf('&', at - 1);
  if (amp >= s) {
    const semi = text.indexOf(';', amp);
    if (semi >= at && semi < e && /^&#?\w+;$/.test(text.slice(amp, semi + 1))) return false;
  }
  return true;
}

/** 足す字 (和文・欧文・長いもの。< と & を含まない) */
const SNIPPETS = [
  '直した所',
  '字を足した。',
  'edit',
  ' inserted words ',
  '組版の結果は、使い回しの有無で変わらないことを確かめる。',
  'The quick brown fox jumps over the lazy dog. ',
  '行が増えるように、長めの文を足す。段落の行分けが変わり、改ページの位置も動くことがある。字の数を増やして、後ろのページまで動くようにする。',
  'Supercalifragilisticexpialidocious internationalization ',
  '「括弧」と、句読点。',
  '0123456789',
];

/** 行の番号 (1 から) */
const lineAt = (text, at) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

/**
 * 文書の字の部分の乱数の所を 1 度直す。返すのは { text, edit } (edit: 直し方・行の番号・消した字・足した字)。
 * 直す所は、字の部分の字の数で重みを付けて選ぶ (長い段落ほど選ばれやすい)。字の部分が無ければ、そのまま返す
 */
export function editOnce(text, rng) {
  const ranges = textRanges(text);
  const total = ranges.reduce((n, [s, e]) => n + (e - s), 0);
  if (!total) return { text, edit: undefined };
  let pick = Math.floor(rng() * total);
  let range = ranges[0];
  for (const r of ranges) {
    if (pick < r[1] - r[0]) {
      range = r;
      break;
    }
    pick -= r[1] - r[0];
  }
  const [s, e] = range;
  let at = s + pick;
  while (at < e && !cuttable(text, s, e, at)) at++;
  const r = rng();
  const op = r < 0.5 ? 'insert' : r < 0.8 ? 'delete' : 'replace';
  let del = 0;
  if (op !== 'insert') {
    del = Math.min(e - at, 1 + Math.floor(rng() * 24));
    while (del > 0 && !cuttable(text, s, e, at + del)) del--;
  }
  const add = op === 'delete' ? '' : SNIPPETS[Math.floor(rng() * SNIPPETS.length)];
  const out = text.slice(0, at) + add + text.slice(at + del);
  return { text: out, edit: { op: del && add ? 'replace' : del ? 'delete' : 'insert', at, line: lineAt(text, at), removed: text.slice(at, at + del), inserted: add } };
}

/** 属性の直しで足す、組み方の属性 (XSL-FO の fo:block と、HTML のブロックの style。keep・区切り・widows など、組み方の決め方が先を見るもの) */
const FO_ATTRS = ['keep-with-previous="always"', 'keep-with-next="always"', 'keep-together.within-page="always"', 'break-before="page"', 'widows="4"', 'orphans="4"'];
const HTML_STYLES = ['break-before: avoid', 'break-after: avoid', 'break-inside: avoid', 'break-before: page', 'widows: 4', 'orphans: 4'];

/**
 * 文書の乱数のブロックの開きタグに、組み方の属性を 1 つ足す (字でなく属性を直したときの組み直しを試す)。同じ名前の属性のあるタグには足さない。
 * 足せるタグが無ければ、そのまま返す
 */
export function editAttr(text, rng) {
  const tags = [...text.matchAll(/<(fo:block|p|li|h[1-6]|div)(?=[\s>])([^>]*)>/g)];
  if (!tags.length) return { text, edit: undefined };
  const m = tags[Math.floor(rng() * tags.length)];
  const fo = m[1] === 'fo:block';
  const list = fo ? FO_ATTRS : HTML_STYLES;
  const pick = list[Math.floor(rng() * list.length)];
  const attr = fo ? ` ${pick}` : ` style="${pick}"`;
  const name = fo ? pick.split('=')[0] : 'style';
  if (new RegExp(`\\s${name.replace('.', '\\.')}=`).test(m[2])) return { text, edit: undefined };
  const at = m.index + 1 + m[1].length;
  return { text: text.slice(0, at) + attr + text.slice(at), edit: { op: 'attr', at, line: lineAt(text, at), removed: '', inserted: attr.trim() } };
}

/**
 * ブロックを 1 つ足すか消す (ブロックの足し消しの組み直しを試す): 文書の乱数の、中に同じ名前の要素の無いブロック (XSL-FO の fo:block、HTML の p・li) を、
 * 半分の割合で消し、残りは、すぐ後ろに同じものをもう 1 つ足す。足せるブロックが無ければ、そのまま返す
 */
export function editBlock(text, rng) {
  const blocks = [...text.matchAll(/<(fo:block|p|li)(?=[\s>])[^>]*>((?:(?!<(?:fo:block|p|li)[\s>/])[\s\S])*?)<\/\1>/g)];
  if (!blocks.length) return { text, edit: undefined };
  const m = blocks[Math.floor(rng() * blocks.length)];
  const at = m.index;
  const whole = m[0];
  if (rng() < 0.5) return { text: text.slice(0, at) + text.slice(at + whole.length), edit: { op: 'block-delete', at, line: lineAt(text, at), removed: whole, inserted: '' } };
  const end = at + whole.length;
  return { text: text.slice(0, end) + whole + text.slice(end), edit: { op: 'block-insert', at: end, line: lineAt(text, end), removed: '', inserted: whole } };
}

/** ページのマスター (XSL-FO の領域・HTML の @page) に足す背景の色。直しごとに替える */
const MASTER_COLORS = ['#fffbe8', '#eef6ff', '#f3fff0', '#fff0f3'];

/**
 * ページのマスターだけを直す (本文は変えない): XSL-FO は、領域 (fo:region-body・region-before・region-after・region-start・region-end) の 1 つに
 * background-color を足し、HTML は、head の終わりに @page の背景の規則を足す。直す所が無ければ edit は undefined
 */
export function editMaster(text, rng) {
  const color = MASTER_COLORS[Math.floor(rng() * MASTER_COLORS.length)];
  const tags = [...text.matchAll(/<(fo:region-(?:body|before|after|start|end))(?=[\s/>])([^>]*?)(\/?)>/g)].filter((m) => !/\sbackground-color=/.test(m[2]));
  let at;
  let ins;
  if (tags.length) {
    const m = tags[Math.floor(rng() * tags.length)];
    at = m.index + 1 + m[1].length;
    ins = ` background-color="${color}"`;
  } else {
    const head = text.search(/<\/head>/i);
    if (head < 0) return { text, edit: undefined };
    at = head;
    ins = `<style>@page { background-color: ${color} }</style>`;
  }
  return { text: text.slice(0, at) + ins + text.slice(at), edit: { op: 'master', at, line: lineAt(text, at), removed: '', inserted: ins.trim() } };
}

/**
 * 直した文書の並び: 元の文書・n 回まで重ねて直したもの・元の文書 (最後に戻すと、覚えの当たる組み直しになる)。直しは字の直し (editOnce) で、
 * attrRate (0〜1。既定 0) を渡すと、その割合で属性の直し (editAttr) にし、masterRate (0〜1。既定 0) を渡すと、その割合でページのマスターだけの直し
 * (editMaster) にし、blockRate (0〜1。既定 0) を渡すと、その割合でブロックの足し消し (editBlock) にする。返すのは [{ text, edit, label }]
 */
export function editSequence(text, { seed = 1, edits = 3, revert = true, attrRate = 0, masterRate = 0, blockRate = 0 } = {}) {
  const rng = seededRandom(seed);
  const out = [{ text, edit: undefined, label: '元の文書' }];
  let cur = text;
  for (let k = 0; k < edits; k++) {
    // 割合を使わないときは乱数を引かない (前からの種で、同じ直しの並びになるように)
    let r = blockRate > 0 && rng() < blockRate ? editBlock(cur, rng) : undefined;
    if (!r?.edit) r = masterRate > 0 && rng() < masterRate ? editMaster(cur, rng) : undefined;
    if (!r?.edit) r = attrRate > 0 && rng() < attrRate ? editAttr(cur, rng) : undefined;
    if (!r?.edit) r = editOnce(cur, rng);
    const { text: next, edit } = r;
    if (!edit) break;
    cur = next;
    out.push({ text: cur, edit, label: describeEdit(edit) });
  }
  if (revert && out.length > 1) out.push({ text, edit: undefined, label: '元の文書に戻す' });
  return out;
}

/** 直し方の短い説明 (報告に出す) */
export function describeEdit(e) {
  const clip = (s) => JSON.stringify(s.length > 16 ? `${s.slice(0, 16)}…` : s);
  const name = { insert: '足す', delete: '消す', replace: '置き換える', attr: '属性を足す', master: 'ページのマスターを直す', 'block-insert': 'ブロックを足す', 'block-delete': 'ブロックを消す' }[e.op];
  return `${e.line} 行目で${name} (${e.removed ? `消す字 ${clip(e.removed)}` : ''}${e.removed && e.inserted ? '・' : ''}${e.inserted ? `足す字 ${clip(e.inserted)}` : ''})`;
}

/**
 * 時計と乱数を止める (PDF の作った日時と識別子を同じにする)。戻す関数を返す。
 * Date は、引数の無い new Date() と Date.now() を決めた時刻にする。crypto.getRandomValues は、決めたバイトで埋める
 */
export function freezeClockAndRandom(at = '2026-01-01T00:00:00Z') {
  const RealDate = globalThis.Date;
  const fixed = new RealDate(at).getTime();
  class FixedDate extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  const c = globalThis.crypto;
  const realRandom = c.getRandomValues;
  c.getRandomValues = (x) => {
    if (x) new Uint8Array(x.buffer, x.byteOffset, x.byteLength).fill(7);
    return x;
  };
  return () => {
    globalThis.Date = RealDate;
    c.getRandomValues = realRandom;
  };
}

/** 組んだ結果から、比べるものを取り出す */
async function snapshotOf(lib, r, pdf) {
  return {
    pages: r.pageCount,
    tree: lib.serializeAreaTree(r.areaTree),
    diagnostics: JSON.stringify(r.diagnostics),
    warnings: JSON.stringify(r.warnings),
    pdf: pdf ? await r.toPdf() : undefined,
  };
}

/** 2 つの領域の木の、最初に違うページ (1 から)。ページの数の違いも書く */
function treeDiff(a, b) {
  try {
    const x = JSON.parse(a).sheets;
    const y = JSON.parse(b).sheets;
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return `${i + 1} ページ目から違う (ページ ${x.length}・${y.length})`;
    if (x.length !== y.length) return `ページの数が違う (${x.length}・${y.length})`;
    return 'ページの外 (しおり・リンクの飛び先・文書の情報など) が違う';
  } catch {
    return '違う';
  }
}

/** 2 つの診断の並びの、最初に違う項目 */
function listDiff(a, b) {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return `${i + 1} 番目が違う (${JSON.stringify(x[i])?.slice(0, 200) ?? 'なし'} ・ ${JSON.stringify(y[i])?.slice(0, 200) ?? 'なし'})`;
  return '違う';
}

/** 2 つの PDF の、最初に違うバイトの位置 */
function bytesDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `${i} バイト目から違う (大きさ ${a.length}・${b.length})`;
  return a.length === b.length ? undefined : `大きさが違う (${a.length}・${b.length})`;
}

/** 比べた結果 (基準と同じなら undefined。違えば、違うものごとの説明) */
function compareSnapshots(ref, s) {
  const diff = {};
  if (s.tree !== ref.tree) diff.tree = treeDiff(s.tree, ref.tree);
  if (s.diagnostics !== ref.diagnostics) diff.diagnostics = listDiff(s.diagnostics, ref.diagnostics);
  if (s.warnings !== ref.warnings) diff.warnings = listDiff(s.warnings, ref.warnings);
  if (ref.pdf && s.pdf) {
    const d = bytesDiff(s.pdf, ref.pdf);
    if (d) diff.pdf = d;
  }
  return Object.keys(diff).length ? diff : undefined;
}

/**
 * 直した文書の並びを、基準の器と比べる器で組み比べる。
 *  lib: { createTypesetter, serializeAreaTree }
 *  setup: 器を作る設定 (createTypesetter に渡す。subjects・reference の setup を上に重ねる)
 *  options: 文書ごとの設定 (組むたびに呼ぶ関数でもよい。files のデータを組むたびに作り直すとき)
 *  versions: editSequence の並び
 *  subjects: 比べる器 [{ name, setup?, stats?, wrap? }] (既定は使い回しをする器 1 つ)。stats は、組んだ結果から報告に出す数を取り出す関数。
 *    wrap は、その器で組む間を包む関数 (組む関数を受けて、その結果を返す。組版の内部の印を、その器で組む間だけ切り替えるとき)
 *  reference: 基準の器 { name, setup } (既定は reuse: false)
 *  pdf: PDF のバイト列も比べるか (既定 true)
 *  onVersion: 1 つの版を比べ終えるたびに呼ぶ (報告を順に出すとき)
 * 返すのは { ok, versions: [{ index, label, edit, pages, ms, subjects: [{ name, diff, stats, ms }] }] }
 */
export async function checkRelayout({ lib, setup = {}, options = {}, versions, subjects = [{ name: 'reuse' }], reference = { name: 'reuse: false', setup: { reuse: false } }, pdf = true, onVersion }) {
  const restore = freezeClockAndRandom();
  try {
    const ref = await lib.createTypesetter({ ...setup, ...reference.setup });
    const subs = [];
    for (const s of subjects) subs.push({ ...s, ts: await lib.createTypesetter({ ...setup, ...s.setup }) });
    const out = [];
    let ok = true;
    for (let index = 0; index < versions.length; index++) {
      const v = versions[index];
      const opts = () => (typeof options === 'function' ? options() : options);
      let t = performance.now();
      const base = await snapshotOf(lib, await ref.typeset(v.text, opts()), pdf);
      const row = { index, label: v.label, edit: v.edit, pages: base.pages, ms: Math.round(performance.now() - t), subjects: [] };
      for (const s of subs) {
        t = performance.now();
        const r = await (s.wrap ? s.wrap(() => s.ts.typeset(v.text, opts())) : s.ts.typeset(v.text, opts()));
        const ms = Math.round(performance.now() - t);
        const diff = compareSnapshots(base, await snapshotOf(lib, r, pdf));
        if (diff) ok = false;
        row.subjects.push({ name: s.name, ms, ...(diff ? { diff } : {}), ...(s.stats ? { stats: s.stats(r) } : {}) });
      }
      out.push(row);
      await onVersion?.(row);
    }
    return { ok, versions: out };
  } finally {
    restore();
  }
}

/**
 * 組み直しの再利用の確かめで比べる対象 (組版の内部の印 resumeProbe を、その対象で組む間だけ立てる。scripts/check-relayout.mjs の --subjects と同じ):
 *  - resume: 1 段の page-sequence の続きから組める境目のすべてで、1 ページ先まで組んでから境目に戻り、境目で保存した状態から続けて組む (resumeProbe.check)
 *  - resume-late: page-sequence を終わりまで組んだ後、続きから組める境目を late 個ほど選び、後ろから順に境目に戻って終わりまで組み直す (resumeProbe.late)
 *  - splice-verify: 前の組版と揃った境目で繋がずに終わりまで組み、繋いだはずの前の組版のページと同じかを確かめる (resumeProbe.spliceVerify)
 * 結果の stats は、resume・resume-late は { resume: { boundaries, resumable, resumed, mismatched, reasons } }、
 * splice-verify は { verify: { same, pages, diff: [{ at, why }] } }。probeFailures で、誤り (指紋の違い・繋ぐ確かめの違い) を取り出す
 */
export function probeSubjects(resumeProbe, { late = 4 } = {}) {
  const counted = (name, on, off) => {
    let rs;
    return {
      name,
      wrap: async (typeset) => {
        rs = { boundaries: 0, resumable: 0, resumed: 0, mismatched: 0, reasons: {} };
        on();
        resumeProbe.onStats = (st) => {
          for (const k of ['boundaries', 'resumable', 'resumed', 'mismatched']) rs[k] += st[k];
          for (const [k, n] of Object.entries(st.reasons)) rs.reasons[k] = (rs.reasons[k] ?? 0) + n;
        };
        try {
          return await typeset();
        } finally {
          off();
          resumeProbe.onStats = undefined;
        }
      },
      stats: () => ({ resume: rs }),
    };
  };
  let v;
  return {
    resume: counted(
      'resume',
      () => (resumeProbe.check = true),
      () => (resumeProbe.check = false),
    ),
    'resume-late': counted(
      'resume-late',
      () => (resumeProbe.late = late),
      () => (resumeProbe.late = undefined),
    ),
    'splice-verify': {
      name: 'splice-verify',
      wrap: async (typeset) => {
        v = { same: 0, pages: 0, diff: [] };
        resumeProbe.spliceVerify = (x) => {
          if (x.same) {
            v.same++;
            v.pages += x.pages;
          } else v.diff.push(x);
        };
        try {
          return await typeset();
        } finally {
          resumeProbe.spliceVerify = undefined;
        }
      },
      stats: () => ({ verify: v }),
    },
  };
}

/** checkRelayout の結果の、誤りの説明の並び (結果の違い・境目の指紋の違い・繋ぐ確かめの違い)。空なら誤りは無い */
export function probeFailures(rows) {
  const out = [];
  for (const r of rows)
    for (const x of r.subjects) {
      if (x.diff) out.push(`${r.index}: ${r.label}: ${x.name} が違う: ${JSON.stringify(x.diff)}`);
      const st = x.stats;
      if (st?.resume?.mismatched) out.push(`${r.index}: ${r.label}: ${x.name}: 境目の指紋の違い ${st.resume.mismatched}`);
      if (st?.verify?.diff.length) out.push(`${r.index}: ${r.label}: ${x.name}: 繋ぐ確かめの違い ${st.verify.diff.map((d) => `${d.at}: ${d.why}`).join(' / ')}`);
    }
  return out;
}
