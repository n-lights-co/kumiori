/**
 * bidi — 双方向のテキストの並べ方 (UAX #9 Unicode Bidirectional Algorithm, Unicode 18.0.0 / Revision 52)。
 *
 *  - resolveLevels: 段落の埋め込みの深さ (P2〜P3・X1〜X10・W1〜W7・N0〜N2・I1〜I2) を字ごとに決める
 *  - lineLevels: 行ごとに、行末の空白などを段落の深さに戻す (L1)
 *  - visualOrder: 深さから、左から右へ描く順を決める (L2)
 *  - mirrorChar: 右から左の深さで、鏡像の字に置き換える字 (L4。Bidi_Mirroring_Glyph)
 *
 * 字の性質は unicodeData.ts (DerivedBidiClass・BidiMirroring・BidiBrackets) から引く。
 * 入力は字 (コードポイント) の並び。X9 で取り除く字 (埋め込みの制御と BN) の深さは、直前の字の深さ (無ければ段落の深さ) にする。
 */
import { rangeTable } from './lineBreak';
import { BC_DATA, BC_VALUES, BRACKET_DATA, MIRROR_DATA } from './unicodeData';

export type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM' | 'BN' | 'B' | 'S' | 'WS' | 'ON' | 'LRE' | 'LRO' | 'RLE' | 'RLO' | 'PDF' | 'LRI' | 'RLI' | 'FSI' | 'PDI';

/** 字の Bidi_Class */
export const bidiClass = rangeTable(BC_DATA, BC_VALUES, 'L') as (cp: number) => BidiClass;

let mirrorMap: Map<number, number> | undefined;
/** Bidi_Mirroring_Glyph (鏡像の字。無ければ undefined) */
export function mirrorChar(cp: number): number | undefined {
  if (!mirrorMap) {
    mirrorMap = new Map();
    for (const p of MIRROR_DATA.split(';')) {
      const [a, b] = p.split(',').map((x) => parseInt(x, 36));
      mirrorMap.set(a, b);
    }
  }
  return mirrorMap.get(cp);
}

let bracketMap: Map<number, { pair: number; open: boolean }> | undefined;
function bracketOf(cp: number) {
  if (!bracketMap) {
    bracketMap = new Map();
    for (const p of BRACKET_DATA.split(';')) {
      const [a, b, t] = p.split(',');
      bracketMap.set(parseInt(a, 36), { pair: parseInt(b, 36), open: t === 'o' });
    }
  }
  return bracketMap.get(cp);
}
/** 括弧の対の比較で、正準等価の字を同じとみなす (U+2329・U+232A と U+3008・U+3009。BD16) */
const canonBracket = (cp: number) => (cp === 0x2329 ? 0x3008 : cp === 0x232a ? 0x3009 : cp);

const MAX_DEPTH = 125;
const isIsolateInit = (c: BidiClass) => c === 'LRI' || c === 'RLI' || c === 'FSI';
const isRemovedByX9 = (c: BidiClass) => c === 'RLE' || c === 'LRE' || c === 'RLO' || c === 'LRO' || c === 'PDF' || c === 'BN';
/** N1・N2 の中立の字 (NI) */
const isNI = (c: BidiClass) => c === 'B' || c === 'S' || c === 'WS' || c === 'ON' || isIsolateInit(c) || c === 'PDI';

/** 字の並びの、対になる PDI の位置 (BD9。無ければ -1) */
function matchingPdi(types: BidiClass[]): Int32Array {
  const out = new Int32Array(types.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (isIsolateInit(t)) stack.push(i);
    else if (t === 'PDI' && stack.length) out[stack.pop()!] = i;
    else if (t === 'B') stack.length = 0;
  }
  return out;
}

/** P2・P3: start から end (含まない) までの最初の強い字の向き。隔離の中は飛ばす。無ければ undefined */
function firstStrong(types: BidiClass[], start: number, end: number, pdi: Int32Array): 0 | 1 | undefined {
  for (let i = start; i < end; i++) {
    const t = types[i];
    if (t === 'L') return 0;
    if (t === 'R' || t === 'AL') return 1;
    if (isIsolateInit(t)) {
      if (pdi[i] < 0) return undefined;
      i = pdi[i];
    } else if (t === 'B') return undefined;
  }
  return undefined;
}

export interface BidiParagraph {
  /** 段落の埋め込みの深さ (0: 左から右、1: 右から左) */
  level: number;
  /** 字ごとの深さ (I2 の後。X9 で取り除いた字は直前の字の深さ) */
  levels: Uint8Array;
  /** 字ごとの元の Bidi_Class (L1 に使う) */
  types: BidiClass[];
}

/**
 * 段落の字の深さを決める。direction は段落の向き (auto は最初の強い字から。P2・P3)。
 * 段落は 1 つ (段落の区切り B は段落の終わりにしか無いものとして扱う)
 */
export function resolveLevels(cps: ArrayLike<number>, direction: 'ltr' | 'rtl' | 'auto' = 'auto', classes?: BidiClass[]): BidiParagraph {
  const n = cps.length;
  // classes: 字の性質の代わりに使う Bidi_Class (試験用。括弧の対は cps から引く)
  const orig: BidiClass[] = classes ? classes.slice() : new Array(n);
  if (!classes) for (let i = 0; i < n; i++) orig[i] = bidiClass(cps[i]);
  const pdi = matchingPdi(orig);
  const para = direction === 'rtl' ? 1 : direction === 'ltr' ? 0 : (firstStrong(orig, 0, n, pdi) ?? 0);
  const types = orig.slice();
  const levels = new Uint8Array(n);

  // X1〜X8: 明示の埋め込み・上書き・隔離
  {
    type Entry = { level: number; override: 'N' | 'L' | 'R'; isolate: boolean };
    const stack: Entry[] = [{ level: para, override: 'N', isolate: false }];
    let overflowIsolate = 0;
    let overflowEmbedding = 0;
    let validIsolate = 0;
    for (let i = 0; i < n; i++) {
      const t = orig[i];
      const top = stack[stack.length - 1];
      if (t === 'RLE' || t === 'LRE' || t === 'RLO' || t === 'LRO') {
        // X2〜X5
        const rtl = t === 'RLE' || t === 'RLO';
        const nl = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
        levels[i] = top.level;
        if (nl <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) stack.push({ level: nl, override: t === 'RLO' ? 'R' : t === 'LRO' ? 'L' : 'N', isolate: false });
        else if (overflowIsolate === 0) overflowEmbedding++;
      } else if (isIsolateInit(t)) {
        // X5a〜X5c
        levels[i] = top.level;
        if (top.override !== 'N') types[i] = top.override;
        const rtl = t === 'RLI' || (t === 'FSI' && firstStrong(orig, i + 1, pdi[i] < 0 ? n : pdi[i], pdi) === 1);
        const nl = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
        if (nl <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
          validIsolate++;
          stack.push({ level: nl, override: 'N', isolate: true });
        } else overflowIsolate++;
      } else if (t === 'PDI') {
        // X6a
        if (overflowIsolate > 0) overflowIsolate--;
        else if (validIsolate > 0) {
          overflowEmbedding = 0;
          while (!stack[stack.length - 1].isolate) stack.pop();
          stack.pop();
          validIsolate--;
        }
        const cur = stack[stack.length - 1];
        levels[i] = cur.level;
        if (cur.override !== 'N') types[i] = cur.override;
      } else if (t === 'PDF') {
        // X7
        levels[i] = top.level;
        if (overflowIsolate > 0) {
          /* 何もしない */
        } else if (overflowEmbedding > 0) overflowEmbedding--;
        else if (!top.isolate && stack.length >= 2) stack.pop();
      } else if (t === 'B') {
        // X8
        levels[i] = para;
      } else if (t === 'BN') {
        levels[i] = top.level;
      } else {
        // X6
        levels[i] = top.level;
        if (top.override !== 'N') types[i] = top.override;
      }
    }
  }

  // X9: 取り除く字を除いた位置の並び
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (!isRemovedByX9(orig[i])) idx.push(i);

  // X10: 深さの連なり (level run) を、隔離の始めと対の PDI でつないだ並び (isolating run sequence)
  const runs: number[][] = [];
  for (let k = 0; k < idx.length; k++) {
    if (k === 0 || levels[idx[k]] !== levels[idx[k - 1]]) runs.push([]);
    runs[runs.length - 1].push(idx[k]);
  }
  const runOfStart = new Map<number, number>();
  runs.forEach((r, k) => runOfStart.set(r[0], k));
  const matchedPdi = new Set<number>();
  for (const q of pdi) if (q >= 0) matchedPdi.add(q);
  const sequences: number[][] = [];
  for (const r of runs) {
    // 対の PDI で始まる連なりは、前の連なりの続き
    if (orig[r[0]] === 'PDI' && matchedPdi.has(r[0])) continue;
    const seq = [...r];
    let last = r[r.length - 1];
    while (isIsolateInit(orig[last]) && pdi[last] >= 0) {
      const k = runOfStart.get(pdi[last]);
      if (k === undefined) break;
      seq.push(...runs[k]);
      last = runs[k][runs[k].length - 1];
    }
    sequences.push(seq);
  }
  const posInIdx = new Int32Array(n).fill(-1);
  idx.forEach((i, k) => (posInIdx[i] = k));

  // sos・eos は、W・N・I の規則の前の深さで決める (前の並びの I1・I2 で変わった深さは使わない)
  const embed = levels.slice();
  for (const seq of sequences) {
    const lvl = embed[seq[0]];
    const first = posInIdx[seq[0]];
    const lastI = seq[seq.length - 1];
    const before = first > 0 ? embed[idx[first - 1]] : para;
    const afterK = posInIdx[lastI] + 1;
    const after = isIsolateInit(orig[lastI]) || afterK >= idx.length ? para : embed[idx[afterK]];
    const sos: BidiClass = Math.max(lvl, before) % 2 ? 'R' : 'L';
    const eos: BidiClass = Math.max(lvl, after) % 2 ? 'R' : 'L';
    const t = seq.map((i) => types[i]);
    const m = t.length;

    // W1: NSM は前の字の種類 (隔離の始め・PDI の後なら ON)
    for (let k = 0; k < m; k++) if (t[k] === 'NSM') t[k] = k === 0 ? sos : isIsolateInit(t[k - 1]) || t[k - 1] === 'PDI' ? 'ON' : t[k - 1];
    // W2: EN の前の強い字が AL なら AN
    {
      let strong: BidiClass = sos;
      for (let k = 0; k < m; k++) {
        if (t[k] === 'L' || t[k] === 'R' || t[k] === 'AL') strong = t[k];
        else if (t[k] === 'EN' && strong === 'AL') t[k] = 'AN';
      }
    }
    // W3
    for (let k = 0; k < m; k++) if (t[k] === 'AL') t[k] = 'R';
    // W4: EN と EN の間の 1 つの ES・CS、AN と AN の間の 1 つの CS
    for (let k = 1; k < m - 1; k++) {
      if (t[k] === 'ES' && t[k - 1] === 'EN' && t[k + 1] === 'EN') t[k] = 'EN';
      else if (t[k] === 'CS' && t[k - 1] === 'EN' && t[k + 1] === 'EN') t[k] = 'EN';
      else if (t[k] === 'CS' && t[k - 1] === 'AN' && t[k + 1] === 'AN') t[k] = 'AN';
    }
    // W5: EN に接する ET の並びは EN
    for (let k = 0; k < m; k++) {
      if (t[k] !== 'ET') continue;
      let e = k;
      while (e < m && t[e] === 'ET') e++;
      if ((k > 0 && t[k - 1] === 'EN') || (e < m && t[e] === 'EN')) for (let q = k; q < e; q++) t[q] = 'EN';
      k = e - 1;
    }
    // W6
    for (let k = 0; k < m; k++) if (t[k] === 'ES' || t[k] === 'ET' || t[k] === 'CS') t[k] = 'ON';
    // W7: EN の前の強い字が L なら L
    {
      let strong: BidiClass = sos;
      for (let k = 0; k < m; k++) {
        if (t[k] === 'L' || t[k] === 'R') strong = t[k];
        else if (t[k] === 'EN' && strong === 'L') t[k] = 'L';
      }
    }

    // N0: 括弧の対 (BD16)
    const e: BidiClass = lvl % 2 ? 'R' : 'L';
    const strongOf = (c: BidiClass): BidiClass | undefined => (c === 'L' ? 'L' : c === 'R' || c === 'EN' || c === 'AN' ? 'R' : undefined);
    {
      const pairs: Array<[number, number]> = [];
      const stack: Array<{ close: number; pos: number }> = [];
      for (let k = 0; k < m; k++) {
        if (t[k] !== 'ON') continue;
        const cp = cps[seq[k]];
        const b = bracketOf(cp);
        if (!b) continue;
        if (b.open) {
          if (stack.length >= 63) break;
          stack.push({ close: canonBracket(b.pair), pos: k });
        } else {
          const c = canonBracket(cp);
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].close === c) {
              pairs.push([stack[s].pos, k]);
              stack.length = s;
              break;
            }
          }
        }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [o, c] of pairs) {
        let found: BidiClass | undefined;
        for (let k = o + 1; k < c; k++) {
          const s = strongOf(t[k]);
          if (!s) continue;
          if (s === e) {
            found = e;
            break;
          }
          found = s;
        }
        if (!found) continue;
        let dir: BidiClass = e;
        if (found !== e) {
          // 括弧の中に反対の向きの字だけがある: 括弧の前の文脈 (sos まで) が同じ向きならその向き
          let ctx: BidiClass = sos;
          for (let k = o - 1; k >= 0; k--) {
            const s = strongOf(t[k]);
            if (s) {
              ctx = s;
              break;
            }
          }
          dir = ctx === found ? found : e;
        }
        t[o] = dir;
        t[c] = dir;
        // 向きを変えた括弧の直後の、元が NSM の字も同じ向き
        for (const p of [o, c]) for (let k = p + 1; k < m && orig[seq[k]] === 'NSM'; k++) t[k] = dir;
      }
    }

    // N1・N2: 中立の字の並びは、両側の強い字 (EN・AN は R) が同じならその向き、違えば埋め込みの向き
    for (let k = 0; k < m; k++) {
      if (!isNI(t[k])) continue;
      let q = k;
      while (q < m && isNI(t[q])) q++;
      const prev = k === 0 ? sos : (strongOf(t[k - 1]) ?? e);
      const next = q >= m ? eos : (strongOf(t[q]) ?? e);
      const dir = prev === next ? prev : e;
      for (let r = k; r < q; r++) t[r] = dir;
      k = q - 1;
    }

    // I1・I2
    for (let k = 0; k < m; k++) {
      const i = seq[k];
      const c = t[k];
      if (levels[i] % 2 === 0) {
        if (c === 'R') levels[i] += 1;
        else if (c === 'AN' || c === 'EN') levels[i] += 2;
      } else if (c === 'L' || c === 'EN' || c === 'AN') levels[i] += 1;
    }
  }

  // X9 で取り除いた字は、直前の字の深さ (無ければ段落の深さ)
  for (let i = 0; i < n; i++) if (isRemovedByX9(orig[i])) levels[i] = i > 0 ? levels[i - 1] : para;
  return { level: para, levels, types: orig };
}

/**
 * L1: 行 (start から end の手前まで) の深さ。区切りの字 (S・B)、その前の空白の並び、行末の空白の並びを段落の深さに戻す。
 * 空白の並びには、隔離の制御 (FSI・LRI・RLI・PDI) と X9 で取り除いた字も含む
 */
export function lineLevels(p: BidiParagraph, start: number, end: number): Uint8Array {
  const out = p.levels.slice(start, end);
  const ws = (c: BidiClass) => c === 'WS' || isIsolateInit(c) || c === 'PDI' || isRemovedByX9(c);
  let trailing = true;
  for (let i = end - 1; i >= start; i--) {
    const c = p.types[i];
    if (c === 'S' || c === 'B') {
      out[i - start] = p.level;
      trailing = true;
    } else if (trailing && ws(c)) out[i - start] = p.level;
    else trailing = false;
  }
  return out;
}

/** L2: 深さの並びから、左から右へ描く順 (元の位置の並び) を返す */
export function visualOrder(levels: ArrayLike<number>): number[] {
  const order = Array.from({ length: levels.length }, (_, k) => k);
  let hi = 0;
  let lo = Infinity;
  for (let k = 0; k < levels.length; k++) {
    hi = Math.max(hi, levels[k]);
    if (levels[k] % 2) lo = Math.min(lo, levels[k]);
  }
  for (let lv = hi; lv >= lo && lv > 0; lv--) {
    for (let k = 0; k < order.length; k++) {
      if (levels[order[k]] < lv) continue;
      let e = k;
      while (e < order.length && levels[order[e]] >= lv) e++;
      order.splice(k, e - k, ...order.slice(k, e).reverse());
      k = e;
    }
  }
  return order;
}
