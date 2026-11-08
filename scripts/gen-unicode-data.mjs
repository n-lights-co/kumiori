// Unicode の文字データ (UCD) から、改行 (UAX #14)・縦書きの字の向き (UAX #50)・双方向のテキスト (UAX #9) に使う性質の表を作る。
// 使い方: node scripts/gen-unicode-data.mjs <UCD のファイルを置いたディレクトリ> > src/unicodeData.ts
// ディレクトリに置くファイル (Unicode 18.0.0。https://www.unicode.org/Public/18.0.0/ucd/ から取得):
//   LineBreak.txt・EastAsianWidth.txt・VerticalOrientation.txt・emoji-data.txt (emoji/)・DerivedGeneralCategory.txt (extracted/)・
//   DerivedBidiClass.txt (extracted/)・BidiMirroring.txt・BidiBrackets.txt・DerivedJoiningType.txt (extracted/)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('UCD のディレクトリを指定してください');
const read = (f) => readFileSync(join(dir, f), 'utf8');

/** 「範囲 ; 値」の行を読む。wanted が与えられれば、その値だけ */
function parse(text, wanted) {
  const out = [];
  for (const line of text.split('\n')) {
    const body = line.replace(/#.*/, '').trim();
    if (!body) continue;
    const [r, v] = body.split(';').map((x) => x.trim());
    if (wanted && !wanted.includes(v)) continue;
    const [a, b] = r.split('..');
    out.push([parseInt(a, 16), parseInt(b ?? a, 16), v]);
  }
  return out;
}

/** 範囲の並びを、値の番号付きの詰めた文字列にする (隣り合う同じ値の範囲はまとめる。既定の値の範囲は書かない) */
function encode(ranges, values, dflt) {
  const rs = ranges.filter((r) => r[2] !== dflt).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && last[2] === r[2] && last[1] + 1 === r[0]) last[1] = r[1];
    else merged.push([...r]);
  }
  let prev = 0;
  const parts = merged.map(([a, b, v]) => {
    const i = values.indexOf(v);
    if (i < 0) throw new Error(`値 ${v} が一覧に無い`);
    const s = `${(a - prev).toString(36)},${(b - a).toString(36)},${i.toString(36)}`;
    prev = b + 1;
    return s;
  });
  return parts.join(';');
}

const header = (f) => read(f).split('\n')[0].replace(/^#\s*/, '');

const lb = parse(read('LineBreak.txt'));
const LB_VALUES = [...new Set(lb.map((r) => r[2]))].sort();
if (!LB_VALUES.includes('XX')) LB_VALUES.push('XX');
const ea = parse(read('EastAsianWidth.txt'));
const EA_VALUES = ['N', 'A', 'F', 'H', 'Na', 'W'];
const vo = parse(read('VerticalOrientation.txt'));
const VO_VALUES = ['R', 'U', 'Tu', 'Tr'];
const gc = parse(read('DerivedGeneralCategory.txt'), ['Mn', 'Mc', 'Pi', 'Pf', 'Cn']);
const GC_VALUES = ['', 'Mn', 'Mc', 'Pi', 'Pf', 'Cn'];
const ep = parse(read('emoji-data.txt'), ['Extended_Pictographic']).map(([a, b]) => [a, b, 'Y']);

// Bidi_Class: @missing の行 (書いていない字の既定。後の行ほど狭い範囲) を先に、明示の行で上書きする
const BC_LONG = { Left_To_Right: 'L', Right_To_Left: 'R', Arabic_Letter: 'AL', European_Terminator: 'ET' };
const bcText = read('DerivedBidiClass.txt');
const bcAll = new Array(0x110000).fill('L');
for (const m of bcText.matchAll(/^# @missing: ([0-9A-F]+)\.\.([0-9A-F]+); (\w+)/gm)) {
  const v = BC_LONG[m[3]];
  if (!v) throw new Error(`@missing の値 ${m[3]} が一覧に無い`);
  bcAll.fill(v, parseInt(m[1], 16), parseInt(m[2], 16) + 1);
}
for (const [a, b, v] of parse(bcText)) bcAll.fill(v, a, b + 1);
const bc = [];
for (let c = 0; c < bcAll.length; c++) {
  const last = bc[bc.length - 1];
  if (last && last[2] === bcAll[c] && last[1] + 1 === c) last[1] = c;
  else bc.push([c, c, bcAll[c]]);
}
const BC_VALUES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'];
// Bidi_Mirroring_Glyph (字, 鏡像の字) と Bidi_Paired_Bracket・Bidi_Paired_Bracket_Type (字, 対の字, o/c)
const pairs = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(';').map((x) => x.trim()));
const mirror = pairs(read('BidiMirroring.txt')).map(([a, b]) => `${parseInt(a, 16).toString(36)},${parseInt(b, 16).toString(36)}`);
const brackets = pairs(read('BidiBrackets.txt')).map(([a, b, t]) => `${parseInt(a, 16).toString(36)},${parseInt(b, 16).toString(36)},${t}`);

// Joining_Type (既定は U。T は DerivedJoiningType の導出のとおり)
const jt = parse(read('DerivedJoiningType.txt'));
const JT_VALUES = ['U', 'D', 'R', 'L', 'C', 'T'];

const files = ['LineBreak.txt', 'EastAsianWidth.txt', 'VerticalOrientation.txt', 'DerivedGeneralCategory.txt', 'emoji-data.txt', 'DerivedBidiClass.txt', 'BidiMirroring.txt', 'BidiBrackets.txt', 'DerivedJoiningType.txt'].map((f) => ` *   ${header(f)}`).join('\n');
const out = `/**
 * Unicode の文字データ (UCD 18.0.0) から作った、文字の性質の表。scripts/gen-unicode-data.mjs で作る (手で書き換えない)。
 * 元のファイル (https://www.unicode.org/Public/18.0.0/ucd/ 、2026-11-04 取得。DerivedJoiningType は 2026-11-05 取得):
${files}
 * Copyright © 1991-2026 Unicode, Inc. Unicode License v3 (THIRD_PARTY_NOTICES.md の 6 節)。
 *
 * 表の形: 「前の範囲の終わりの次からの距離,範囲の長さ - 1,値の番号」を ; で区切った 36 進の並び。書いていない字は既定の値
 */
export const LB_VALUES = ${JSON.stringify(LB_VALUES)};
/** Line_Break (既定は XX) */
export const LB_DATA = ${JSON.stringify(encode(lb, LB_VALUES, 'XX'))};
export const EA_VALUES = ${JSON.stringify(EA_VALUES)};
/** East_Asian_Width (既定は N) */
export const EA_DATA = ${JSON.stringify(encode(ea, EA_VALUES, 'N'))};
export const VO_VALUES = ${JSON.stringify(VO_VALUES)};
/** Vertical_Orientation (既定は R) */
export const VO_DATA = ${JSON.stringify(encode(vo, VO_VALUES, 'R'))};
export const GC_VALUES = ${JSON.stringify(GC_VALUES)};
/** General_Category のうち、改行の規則が使う Mn・Mc・Pi・Pf・Cn (ほかは空) */
export const GC_DATA = ${JSON.stringify(encode(gc, GC_VALUES, ''))};
/** Extended_Pictographic */
export const EP_DATA = ${JSON.stringify(encode(ep, ['', 'Y'], ''))};
export const BC_VALUES = ${JSON.stringify(BC_VALUES)};
/** Bidi_Class (既定は L。@missing の既定を含む) */
export const BC_DATA = ${JSON.stringify(encode(bc, BC_VALUES, 'L'))};
/** Bidi_Mirroring_Glyph: 「字,鏡像の字」(36 進) を ; で区切った並び */
export const MIRROR_DATA = ${JSON.stringify(mirror.join(';'))};
/** Bidi_Paired_Bracket と Bidi_Paired_Bracket_Type: 「字,対の字,o か c」(36 進) を ; で区切った並び */
export const BRACKET_DATA = ${JSON.stringify(brackets.join(';'))};
export const JT_VALUES = ${JSON.stringify(JT_VALUES)};
/** Joining_Type (既定は U。アラビア文字などのつながり方) */
export const JT_DATA = ${JSON.stringify(encode(jt, JT_VALUES, 'U'))};
`;
process.stdout.write(out);
