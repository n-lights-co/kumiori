/**
 * psOpsFont — 書体の演算子 (第 5 章: findfont・scalefont・setfont・show 系・charpath・definefont・composefont・eexec など) と、
 * 字の形の取り出し (Type 1・Type 3・CFF・CID・CMap)。字の形の命令そのものは psFonts.ts・psCff.ts
 */
import { apply, applyVector, mul, type Seg } from './matrix';
import {
  type Interp,
  type PSDict,
  type PSObj,
  type PSString,
  PSError,
  PSFile,
  arr,
  arrItems,
  bytesSource,
  dictObj,
  int,
  name,
  real,
  str,
  strBytes,
  strText,
} from './psInterp';
import type { Graphics, Mat, DisplayItem } from './psGraphics';
import { findResource, fallbackFont, FALLBACK_KEY } from './psResources';
import type { ByteSource } from './psFilters';
import { decodeCMap, decryptCharstring, eexecSource, identityCMap, newCMap, runType1Charstring, type CMapData, type Glyph } from './psFonts';
import { GLYPH_CHARS, ISO_LATIN1_ENCODING, STANDARD_ENCODING } from './psEncodings';
import { cffGlyph, parseCff, type CffFont } from './psCff';

// ───────────────────────── 書体 (第 5 章) ─────────────────────────
//
// 字の形は、埋め込まれた書体から作る (psFonts.ts):
//  - Type 1 の書体 (FontType 1): 符号化 → 字の名前 → CharStrings の字形の命令
//  - Type 3 の書体: BuildGlyph・BuildChar の手続きを実行する (§5.7)
//  - 複合書体 (FontType 0、FMapType 9): CMap で CID にし、CIDFontType 0 の字形の命令を使う (§5.11)
// 字の形を持たない書体 (findfont で見つからない書体の代わりの辞書) は、書体の名前から代わりの書体で描く (SVG の text)。

/** CMap の辞書ごとの対応 (CIDInit の演算子で作る) */
const CMAPS = new WeakMap<PSDict, CMapData>();

const numsOf = (a: PSObj | undefined): number[] => (a && a.t === 'array' ? arrItems(a).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0)) : []);
const matOf = (a: PSObj | undefined, def: Mat): Mat => {
  const v = numsOf(a);
  return v.length === 6 ? (v as Mat) : def;
};
const intOf = (o: PSObj | undefined, def: number) => (o && (o.t === 'int' || o.t === 'real') ? o.v : def);
const bytesOfStr = (o: PSObj | undefined): Uint8Array | undefined => (o && o.t === 'string' ? strBytes(o) : undefined);

/** CIDInit の手続き集 (表 3.10): CMap を記録する演算子と StartData */
export function makeCIDInit(I: Interp): PSDict {
  const cidInit = I.newDict(30);
  cidInit.global = true;
  const op = (nm: string, fn: (I: Interp) => void): PSObj => ({ t: 'operator', name: nm, fn, x: true });
  const cmapOf = (I: Interp) => {
    const d = I.currentdict;
    let c = CMAPS.get(d);
    if (!c) {
      c = newCMap();
      CMAPS.set(d, c);
    }
    return c;
  };
  /** 印までのオペランドを取り出す */
  const items = (I: Interp): PSObj[] => {
    const out: PSObj[] = [];
    while (I.ostack.length && I.ostack[I.ostack.length - 1].t !== 'mark') out.unshift(I.ostack.pop()!);
    I.ostack.pop();
    return out;
  };
  const codeOf = (o: PSObj) => {
    const b = bytesOfStr(o) ?? new Uint8Array(0);
    let v = 0;
    for (const c of b) v = v * 256 + c;
    return { n: b.length, v, bytes: [...b] };
  };
  const beginN = (I: Interp) => {
    I.popInt();
    I.push({ t: 'mark' });
  };
  for (const k of ['begincodespacerange', 'beginbfchar', 'beginbfrange', 'begincidchar', 'begincidrange', 'beginnotdefchar', 'beginnotdefrange', 'beginusematrix']) cidInit.put(k, op(k, beginN));
  cidInit.put(
    'endcodespacerange',
    op('endcodespacerange', (I) => {
      const v = items(I);
      const cm = cmapOf(I);
      for (let k = 0; k + 1 < v.length; k += 2) cm.space.push({ lo: codeOf(v[k]).bytes, hi: codeOf(v[k + 1]).bytes });
    }),
  );
  cidInit.put(
    'endcidrange',
    op('endcidrange', (I) => {
      const v = items(I);
      const cm = cmapOf(I);
      for (let k = 0; k + 2 < v.length; k += 3) {
        const lo = codeOf(v[k]);
        cm.ranges.push({ n: lo.n, lo: lo.v, hi: codeOf(v[k + 1]).v, cid: intOf(v[k + 2], 0) });
      }
    }),
  );
  cidInit.put(
    'endcidchar',
    op('endcidchar', (I) => {
      const v = items(I);
      const cm = cmapOf(I);
      for (let k = 0; k + 1 < v.length; k += 2) {
        const c = codeOf(v[k]);
        cm.chars.set(`${c.n}:${c.v}`, intOf(v[k + 1], 0));
      }
    }),
  );
  // Unicode への対応 (bfchar・bfrange)・notdef の対応・座標の変換 (usematrix) は、字の形には使わないので読み捨てる
  for (const k of ['endbfchar', 'endbfrange', 'endnotdefchar', 'endnotdefrange', 'endusematrix']) cidInit.put(k, op(k, (I) => void items(I)));
  cidInit.put(
    'begincmap',
    op('begincmap', (I) => void cmapOf(I)),
  );
  cidInit.put(
    'endcmap',
    op('endcmap', (I) => {
      const cm = cmapOf(I);
      cm.wmode = intOf(I.currentdict.get('WMode'), 0);
    }),
  );
  cidInit.put(
    'usecmap',
    op('usecmap', (I) => {
      const key = I.pop();
      const other = findResource(I, key, 'CMap');
      const src = other && other.t === 'dict' ? CMAPS.get(other.d) : key.t === 'name' && /^Identity-[HV]$/.test(key.v) ? identityCMap() : undefined;
      if (!src) return;
      const cm = cmapOf(I);
      cm.space.push(...src.space);
      cm.ranges.push(...src.ranges);
      for (const [k, v] of src.chars) cm.chars.set(k, v);
    }),
  );
  cidInit.put('usefont', op('usefont', (I) => void I.pop()));
  cidInit.put(
    'beginrearrangedfont',
    op('beginrearrangedfont', (I) => {
      I.pop();
      I.pop();
    }),
  );
  cidInit.put('endrearrangedfont', op('endrearrangedfont', () => {}));
  // StartData (§8.2): 続くバイナリ (または 16 進) のデータを GlyphData にし、CIDFont として定義して、辞書を 2 つ外す
  cidInit.put(
    'StartData',
    op('StartData', (I) => {
      const n = I.popInt();
      const fmt = I.popString();
      const f = I.fileStack[I.fileStack.length - 1];
      if (!f) throw new PSError('ioerror');
      const hex = strText(fmt) === 'Hex';
      const data = new Uint8Array(n);
      let k = 0;
      if (hex) {
        let hi = -1;
        while (k < n) {
          const c = f.read();
          if (c < 0) break;
          const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
          if (v < 0) continue;
          if (hi < 0) hi = v;
          else {
            data[k++] = hi * 16 + v;
            hi = -1;
          }
        }
      } else
        for (; k < n; k++) {
          const c = f.read();
          if (c < 0) break;
          data[k] = c;
        }
      const fd = I.currentdict;
      fd.put('GlyphData', str(data));
      const cname = fd.get('CIDFontName') ?? name('Unnamed');
      I.push(cname);
      I.push(dictObj(fd));
      I.push(name('CIDFont'));
      I.call(I.lookup('defineresource')!);
      I.pop();
      if (I.dstack.length > 3) I.dstack.pop();
      if (I.dstack.length > 3) I.dstack.pop();
    }),
  );
  return cidInit;
}

/** 字 1 つ: 字の空間 → ユーザ空間の行列と、字の形 (または Type 3 の手続き、代わりの書体の字) */
interface ShownGlyph {
  m: Mat;
  glyph?: Glyph;
  /** Type 3 の書体: 呼ぶ手続きと引数 */
  type3?: { font: PSDict; key: PSObj; proc: PSObj };
  /** 字の形が無い (代わりの書体で描く) */
  fallback?: { fontName: string; ch: string };
  /** 符号 (widthshow・kshow 用) */
  code: number;
  paintType: number;
  strokeWidth: number;
}

/** CFF の書体 (FontSetInit の StartData で作った書体の辞書に、隠したキーで持つ) */
const CFF_KEY = '\u0000cff';
function cffOf(d: PSDict): CffFont | undefined {
  const v = d.get(CFF_KEY);
  return v && v.t === 'fontid' ? (v.v as CffFont) : undefined;
}
const CFF_GLYPHS = new WeakMap<CffFont, Map<number, Glyph | null>>();
function cffGlyphCached(f: CffFont, gid: number): Glyph | undefined {
  let m = CFF_GLYPHS.get(f);
  if (!m) {
    m = new Map();
    CFF_GLYPHS.set(f, m);
  }
  if (m.has(gid)) return m.get(gid) ?? undefined;
  const g = cffGlyph(f, gid);
  m.set(gid, g ?? null);
  return g;
}

/**
 * FontSetInit の手続き集 (表 3.10): StartData (key int StartData) で、続く CFF のデータを書体の集まり (FontSet) にし、
 * その中の書体を Font (CID の書体は CIDFont) の資源として定義する (§5.8.1・§8.2 StartData)
 */
export function makeFontSetInit(I: Interp): PSDict {
  const d = I.newDict(4);
  d.global = true;
  d.put('StartData', {
    t: 'operator',
    name: 'StartData',
    x: true,
    fn: (I) => {
      // Chameleon の書体の名前 (3 つ目の引数) は扱わない
      let top = I.pop();
      if (top.t === 'name' && I.ostack.length >= 2 && I.ostack[I.ostack.length - 1].t === 'int') top = I.pop();
      if (top.t !== 'int') throw new PSError('typecheck');
      const n = top.v;
      const key = I.pop();
      const f = I.fileStack[I.fileStack.length - 1];
      if (!f) throw new PSError('ioerror');
      const data = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const c = f.read();
        if (c < 0) break;
        data[k] = c;
      }
      const set = I.newDict(10);
      for (const cf of parseCff(data)) {
        const fd = I.newDict(12);
        fd.put('FontMatrix', arr(cf.fontMatrix.map(real)));
        fd.put('FontBBox', arr(cf.fontBBox.map(real)));
        fd.put('PaintType', int(cf.paintType));
        fd.map.set(CFF_KEY, { k: name(CFF_KEY), v: { t: 'fontid', v: cf } });
        fd.put('FID', { t: 'fontid', v: {} });
        if (cf.cid) {
          fd.put('CIDFontName', name(cf.name));
          fd.put('CIDFontType', int(0));
          defineRes(I, name(cf.name), dictObj(fd), 'CIDFont');
        } else {
          fd.put('FontName', name(cf.name));
          fd.put('FontType', int(2));
          // 符号化: 符号 → 字の名前
          const enc = Array.from({ length: 256 }, () => name('.notdef'));
          for (const [code, gid] of cf.encoding) enc[code] = name(gid === 0 ? '.notdef' : cf.strings(cf.charset[gid]));
          fd.put('Encoding', arr(enc));
          defineRes(I, name(cf.name), dictObj(fd), 'Font');
          (I.systemdict.get('FontDirectory') as { d: PSDict }).d.put(name(cf.name), dictObj(fd));
        }
        set.put(name(cf.name), dictObj(fd));
      }
      defineRes(I, key, dictObj(set), 'FontSet');
      // FontSetInit の辞書を外す (§8.2 StartData)
      if (I.dstack.length > 3) I.dstack.pop();
    },
  });
  return d;
}

/** key inst category defineresource pop と同じ */
function defineRes(I: Interp, key: PSObj, inst: PSObj, cat: string) {
  I.push(key);
  I.push(inst);
  I.push(name(cat));
  I.call(I.lookup('defineresource')!);
  I.pop();
}

export function installFontStubs(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  const fontDir = I.newDict(50);
  fontDir.global = true;
  I.systemdict.map.set('FontDirectory', { k: name('FontDirectory'), v: dictObj(fontDir) });
  I.systemdict.map.set('GlobalFontDirectory', { k: name('GlobalFontDirectory'), v: dictObj(fontDir) });
  // SharedFontDirectory は GlobalFontDirectory と同じ辞書 (§8.2 SharedFontDirectory)
  I.systemdict.map.set('SharedFontDirectory', { k: name('SharedFontDirectory'), v: dictObj(fontDir) });
  // 標準の符号化 (付録 E.6・E.7)
  const encArr = (names: string[]) => {
    const a = arr(names.map((n) => name(n)));
    a.acc = 'readonly';
    return a;
  };
  I.systemdict.map.set('StandardEncoding', { k: name('StandardEncoding'), v: encArr(STANDARD_ENCODING) });
  I.systemdict.map.set('ISOLatin1Encoding', { k: name('ISOLatin1Encoding'), v: encArr(ISO_LATIN1_ENCODING) });

  const fontMatrix = (f: PSObj): Mat => (f.t === 'dict' ? matOf(f.d.get('FontMatrix'), [0.001, 0, 0, 0.001, 0, 0]) : [0.001, 0, 0, 0.001, 0, 0]);
  const transformFont = (f: PSDict, m: Mat): PSObj => {
    const nf = I.newDict(f.size + 1);
    for (const { k, v } of f.map.values()) nf.put(k, v);
    nf.put('FontMatrix', arr(mul(m, fontMatrix(dictObj(f))).map(real)));
    nf.put('FID', { t: 'fontid', v: {} });
    return dictObj(nf);
  };
  // 暗号を解いた字形の命令は、元の文字列ごとに覚えておく
  const decCache = new WeakMap<Uint8Array, Map<number, Uint8Array>>();
  const decrypt = (s: PSObj | undefined, lenIV: number): Uint8Array | undefined => {
    if (!s || s.t !== 'string') return undefined;
    const b = strBytes(s);
    let m = decCache.get(s.b);
    if (!m) {
      m = new Map();
      decCache.set(s.b, m);
    }
    const key = s.o * 64 + lenIV + 2;
    let r = m.get(key);
    if (!r) {
      r = decryptCharstring(b, lenIV);
      m.set(key, r);
    }
    return r;
  };
  const glyphCache = new WeakMap<object, Map<string, Glyph | null>>();
  const cached = (owner: object, key: string, make: () => Glyph | undefined): Glyph | undefined => {
    let m = glyphCache.get(owner);
    if (!m) {
      m = new Map();
      glyphCache.set(owner, m);
    }
    if (m.has(key)) return m.get(key) ?? undefined;
    const g = make();
    m.set(key, g ?? null);
    return g;
  };
  /** Type 1 の書体の字の名前の字形 */
  const type1Glyph = (f: PSDict, nm: string): Glyph | undefined => {
    const csd = f.get('CharStrings');
    if (!csd || csd.t !== 'dict') return undefined;
    return cached(csd.d, nm, () => {
      const priv = f.get('Private');
      const pd = priv && priv.t === 'dict' ? priv.d : undefined;
      const lenIV = intOf(pd?.get('lenIV'), 4);
      const subrs = pd?.get('Subrs');
      const cs = decrypt(csd.d.get(nm) ?? csd.d.get('.notdef'), lenIV);
      if (!cs) return undefined;
      return runType1Charstring(cs, {
        subr: (i) => (subrs && subrs.t === 'array' && i >= 0 && i < subrs.n ? decrypt(subrs.a[subrs.o + i], lenIV) : undefined),
        standardGlyph: (code) => decrypt(csd.d.get(STANDARD_ENCODING[code] ?? '.notdef'), lenIV),
      });
    });
  };
  /** CIDFontType 0 の CID の字形 (§5.11.3 Type 0 CIDFonts) と、使う FDArray の辞書 */
  const glyphDataBytes = new WeakMap<object, Uint8Array>();
  const cidGlyph = (cf: PSDict, cid: number): { glyph?: Glyph; fd?: PSDict } => {
    const fdBytes = intOf(cf.get('FDBytes'), 0);
    const gdBytes = intOf(cf.get('GDBytes'), 0);
    const fdArr = cf.get('FDArray');
    const fdOf = (i: number) => (fdArr && fdArr.t === 'array' && i < fdArr.n && fdArr.a[fdArr.o + i].t === 'dict' ? (fdArr.a[fdArr.o + i] as { d: PSDict }).d : undefined);
    const readN = (b: Uint8Array, o: number, n: number) => {
      let v = 0;
      for (let k = 0; k < n; k++) v = v * 256 + (b[o + k] ?? 0);
      return v;
    };
    let cs: Uint8Array | undefined;
    let fdi = 0;
    let data: Uint8Array | undefined;
    const gdir = cf.get('GlyphDirectory');
    if (gdir && (gdir.t === 'array' || gdir.t === 'dict')) {
      const e = gdir.t === 'array' ? (cid < gdir.n ? gdir.a[gdir.o + cid] : undefined) : gdir.d.get(int(cid));
      const b = bytesOfStr(e);
      if (b) {
        fdi = readN(b, 0, fdBytes);
        cs = b.subarray(fdBytes);
      }
    } else {
      const gd = cf.get('GlyphData');
      if (gd && gd.t === 'string') data = strBytes(gd);
      else if (gd && gd.t === 'array') {
        data = glyphDataBytes.get(gd.a);
        if (!data) {
          const parts = arrItems(gd).map((o) => bytesOfStr(o) ?? new Uint8Array(0));
          data = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
          let o = 0;
          for (const p of parts) {
            data.set(p, o);
            o += p.length;
          }
          glyphDataBytes.set(gd.a, data);
        }
      }
      if (data && cid < intOf(cf.get('CIDCount'), 0)) {
        const ent = intOf(cf.get('CIDMapOffset'), 0) + cid * (fdBytes + gdBytes);
        fdi = readN(data, ent, fdBytes);
        const off = readN(data, ent + fdBytes, gdBytes);
        const next = readN(data, ent + fdBytes + gdBytes + fdBytes, gdBytes);
        if (next > off) cs = data.subarray(off, next);
      }
    }
    const fd = fdOf(fdi);
    if (!cs || !fd) return { fd };
    const priv = fd.get('Private');
    const pd = priv && priv.t === 'dict' ? priv.d : undefined;
    const lenIV = intOf(pd?.get('lenIV'), 4);
    const subrs = pd?.get('Subrs');
    const subrCount = intOf(pd?.get('SubrCount'), 0);
    const sdBytes = intOf(pd?.get('SDBytes'), 0);
    const subrMap = intOf(pd?.get('SubrMapOffset'), 0);
    const dec = (b: Uint8Array) => decryptCharstring(b, lenIV);
    const glyph = cached(cf, `cid${cid}`, () =>
      runType1Charstring(dec(cs!), {
        subr: (i) => {
          if (subrs && subrs.t === 'array') return i >= 0 && i < subrs.n ? decrypt(subrs.a[subrs.o + i], lenIV) : undefined;
          if (!data || i < 0 || i >= subrCount) return undefined;
          const o = readN(data, subrMap + i * sdBytes, sdBytes);
          const e = readN(data, subrMap + (i + 1) * sdBytes, sdBytes);
          return e > o ? dec(data.subarray(o, e)) : undefined;
        },
      }),
    );
    return { glyph, fd };
  };
  /** 複合書体の CMap */
  const cmapOfFont = (f: PSDict): CMapData | undefined => {
    const c = f.get('CMap');
    if (c && c.t === 'dict') return CMAPS.get(c.d) ?? (/-V$/.test(strText(str(String((c.d.get('CMapName') as { v?: string } | undefined)?.v ?? '')))) ? identityCMap(1) : undefined);
    return undefined;
  };
  const decodeChar = (f: PSDict, code: number): string => {
    const enc = f.get('Encoding');
    const nm = enc && enc.t === 'array' && code < enc.n ? enc.a[enc.o + code] : undefined;
    if (nm && nm.t === 'name') {
      const ch = GLYPH_CHARS[nm.v];
      if (ch) return ch;
    }
    return String.fromCharCode(code);
  };
  /** 文字列の字を並べる (字の空間 → ユーザ空間の行列つき) */
  const glyphsOf = (f: PSObj, s: PSString): ShownGlyph[] => {
    if (f.t !== 'dict') return [];
    const fd = f.d;
    const fm = fontMatrix(f);
    const ft = intOf(fd.get('FontType'), 1);
    const paintType = intOf(fd.get('PaintType'), 0);
    const strokeWidth = intOf(fd.get('StrokeWidth'), 0);
    const bytes = strBytes(s);
    const out: ShownGlyph[] = [];
    const fb = fd.get(FALLBACK_KEY);
    if (fb && fb.t === 'name') {
      for (const c of bytes) out.push({ m: fm, code: c, paintType, strokeWidth, fallback: { fontName: fb.v, ch: decodeChar(fd, c) } });
      return out;
    }
    if (ft === 0) {
      const fmt = intOf(fd.get('FMapType'), 0);
      const dep = fd.get('FDepVector');
      const desc = dep && dep.t === 'array' && dep.n && dep.a[dep.o].t === 'dict' ? (dep.a[dep.o] as { d: PSDict }).d : undefined;
      const cm = cmapOfFont(fd);
      if (fmt !== 9 || !desc || !cm) {
        I.warn('複合書体の文字 (FMapType 9 以外・CMap が読めない)');
        return [];
      }
      const cidType = intOf(desc.get('CIDFontType'), -1);
      const dcff = cffOf(desc);
      if (dcff) {
        // CFF の CIDFont (§5.8.1・CFF §18): CID → GID は文字集合、字の空間は FD の FontMatrix × 上の FontMatrix
        for (const cid of decodeCMap(cm, bytes)) {
          const gid = dcff.byCid.get(cid) ?? 0;
          const fdm = dcff.fdMatrices[dcff.fdSelect(gid)];
          const top = dcff.fontMatrix as Mat;
          const gm = fdm && fdm.length === 6 ? mul(top, fdm as Mat) : top;
          out.push({ m: mul(fm, gm), glyph: cffGlyphCached(dcff, gid) ?? { segs: [], wx: 1000, wy: 0 }, code: cid, paintType: dcff.paintType, strokeWidth: 0 });
        }
        return out;
      }
      if (cidType !== 0) {
        I.warn(`CIDFontType ${cidType} の文字`);
        return [];
      }
      // CIDFont の FontMatrix が無ければ [.001 0 0 .001 0 0] とし、FDArray の FontMatrix を 1000 倍する (§5.11.3)
      const hasFM = desc.has('FontMatrix');
      const cfm = matOf(desc.get('FontMatrix'), [0.001, 0, 0, 0.001, 0, 0]);
      for (const cid of decodeCMap(cm, bytes)) {
        const { glyph, fd: sub } = cidGlyph(desc, cid);
        let fdm = matOf(sub?.get('FontMatrix'), [1, 0, 0, 1, 0, 0]);
        if (!hasFM) fdm = fdm.map((v, k) => (k < 4 ? v * 1000 : v)) as Mat;
        out.push({ m: mul(fm, mul(cfm, fdm)), glyph: glyph ?? { segs: [], wx: 1000, wy: 0 }, code: cid, paintType: intOf(desc.get('PaintType'), 0), strokeWidth: intOf(desc.get('StrokeWidth'), 0) });
      }
      return out;
    }
    const enc = fd.get('Encoding');
    for (const c of bytes) {
      const nmo = enc && enc.t === 'array' && c < enc.n ? enc.a[enc.o + c] : name('.notdef');
      const nm = nmo.t === 'name' ? nmo.v : nmo.t === 'string' ? strText(nmo) : '.notdef';
      if (ft === 3) {
        const bg = fd.get('BuildGlyph');
        const bc = fd.get('BuildChar');
        if (bg) out.push({ m: fm, code: c, paintType, strokeWidth, type3: { font: fd, key: name(nm), proc: bg } });
        else if (bc) out.push({ m: fm, code: c, paintType, strokeWidth, type3: { font: fd, key: int(c), proc: bc } });
        continue;
      }
      const cff = ft === 2 ? cffOf(fd) : undefined;
      const g = ft === 1 ? type1Glyph(fd, nm) : cff ? cffGlyphCached(cff, cff.byName.get(nm) ?? 0) : undefined;
      const fname = fd.get('FontName');
      if (g) out.push({ m: fm, glyph: g, code: c, paintType, strokeWidth });
      else out.push({ m: fm, code: c, paintType, strokeWidth, fallback: { fontName: fname && fname.t === 'name' ? fname.v : '', ch: decodeChar(fd, c) } });
    }
    return out;
  };

  /** Type 3 の字の送り (setcharwidth・setcachedevice で受け取る) */
  let type3Width: [number, number] = [0, 0];
  /**
   * 字を並べて描く。each: 字ごとに足す送り (ユーザ空間)。paint: false なら描かず送るだけ (stringwidth・cshow)。
   * path: true なら字の輪郭を現在のパスに足す (charpath)
   */
  const showGlyphs = (
    glyphs: ShownGlyph[],
    opts: { paint: boolean; path?: boolean; extra?: (g: ShownGlyph, i: number) => [number, number]; between?: (i: number) => void } = { paint: true },
  ): [number, number] => {
    const ctm = G.g.ctm;
    const lin: Mat = [ctm[0], ctm[1], ctm[2], ctm[3], 0, 0];
    let total: [number, number] = [0, 0];
    const fillSegs: Seg[] = [];
    let stroke: { width: number; m: Mat } | undefined;
    let runItem: DisplayItem | undefined;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const cp = G.g.cp ?? [ctm[4], ctm[5]];
      let w: [number, number];
      if (g.type3) {
        // Type 3: CTM を FontMatrix × CTM (原点を現在の点に) にして手続きを呼ぶ (§5.7.1)
        type3Width = [0, 0];
        const saved = G.copy(G.g);
        G.stack.push(saved);
        G.g.ctm = mul([ctm[0], ctm[1], ctm[2], ctm[3], cp[0], cp[1]], g.m);
        G.newPath();
        if (opts.paint) {
          I.push(dictObj(g.type3.font));
          I.push(g.type3.key);
          try {
            I.call(g.type3.proc);
          } catch (e) {
            if (!(e instanceof PSError)) throw e;
          }
        }
        G.g = G.stack.pop() ?? saved;
        w = type3Width;
        // 描かないとき (送りだけ) は、手続きを呼んで幅を知る (描いたものは捨てる)
        if (!opts.paint) {
          const n = G.items.length;
          G.stack.push(G.copy(G.g));
          G.g.ctm = mul([ctm[0], ctm[1], ctm[2], ctm[3], cp[0], cp[1]], g.m);
          I.push(dictObj(g.type3.font));
          I.push(g.type3.key);
          try {
            I.call(g.type3.proc);
          } catch (e) {
            if (!(e instanceof PSError)) throw e;
          }
          G.g = G.stack.pop()!;
          G.items.length = n;
          w = type3Width;
        }
      } else if (g.glyph) {
        w = [g.glyph.wx, g.glyph.wy];
        if (opts.paint || opts.path) {
          const m = mul([1, 0, 0, 1, cp[0], cp[1]], mul(lin, g.m));
          const segs = g.glyph.segs.map((s): Seg => {
            if (s.op === 'Z') return s;
            if (s.op === 'C') {
              const [x1, y1] = apply(m, s.x1, s.y1);
              const [x2, y2] = apply(m, s.x2, s.y2);
              const [x, y] = apply(m, s.x, s.y);
              return { op: 'C', x1, y1, x2, y2, x, y };
            }
            const [x, y] = apply(m, s.x, s.y);
            return { op: s.op, x, y };
          });
          if (opts.path) {
            const p = G.ownPath();
            for (const s of segs) p.push(s);
          }
          else {
            fillSegs.push(...segs);
            if (g.paintType === 2) stroke = { width: g.strokeWidth, m: mul(lin, g.m) };
          }
        }
      } else if (g.fallback) {
        // 字の形が無い: 代わりの書体で描く (送りは 0.5 em)。続けて並ぶ字は 1 つの文字列にまとめる (字の送りは代わりの書体のもの)
        w = [500, 0];
        if (opts.paint && !G.invisible()) {
          const e = mul(lin, mul(g.m, [1000, 0, 0, 1000, 0, 0]));
          const last = G.items[G.items.length - 1];
          const own = !opts.extra || (opts.extra(g, i)[0] === 0 && opts.extra(g, i)[1] === 0);
          if (own && runItem && last === runItem && runItem.k === 'text' && runItem.fontName === g.fallback.fontName) runItem.text += g.fallback.ch;
          else {
            runItem = { k: 'text', text: g.fallback.ch, fontName: g.fallback.fontName, mat: [e[0], e[1], e[2], e[3], cp[0], cp[1]], color: G.currentRGB(), cmyk: G.currentCMYK(), clip: G.g.clip };
            G.items.push(runItem);
            if (!own) runItem = undefined;
          }
        }
      } else w = [0, 0];
      // 送り (字の空間 → ユーザ空間)。Type 3 の送りは字の空間の値
      const [ux, uy] = applyVector(g.m, w[0], w[1]);
      const [ex, ey] = opts.extra ? opts.extra(g, i) : [0, 0];
      total = [total[0] + ux + ex, total[1] + uy + ey];
      if (G.g.cp) {
        const [dx, dy] = applyVector(ctm, ux + ex, uy + ey);
        G.g.cp = [G.g.cp[0] + dx, G.g.cp[1] + dy];
      }
      if (opts.between && i + 1 < glyphs.length) opts.between(i);
    }
    if (fillSegs.length && opts.paint && !G.invisible()) {
      if (stroke)
        G.items.push({
          k: 'stroke',
          segs: fillSegs,
          color: G.currentRGB(),
          cmyk: G.currentCMYK(),
          lineWidth: stroke.width,
          cap: 0,
          join: 0,
          miter: 10,
          ctm: stroke.m,
          clip: G.g.clip,
        });
      else G.items.push({ k: 'fill', segs: fillSegs, evenOdd: false, color: G.currentRGB(), cmyk: G.currentCMYK(), clip: G.g.clip });
    }
    // 現在の点をパスにも反映する (show のあとの rlineto などのため)
    if (G.g.cp) {
      const p = G.g.path;
      if (p.length && p[p.length - 1].op === 'M') p.pop();
      p.push({ op: 'M', x: G.g.cp[0], y: G.g.cp[1] });
    }
    return total;
  };

  d('findfont', (I) => {
    const key = I.pop();
    const v = fontDir.get(key) ?? findResource(I, key, 'Font');
    I.push(v ?? fallbackFont(I, key));
  });
  d('definefont', (I) => {
    const f = I.pop();
    const key = I.pop();
    if (f.t !== 'dict') throw new PSError('typecheck');
    if (!f.d.has('FID')) f.d.map.set('FID', { k: name('FID'), v: { t: 'fontid', v: {} } });
    fontDir.put(key, f);
    I.push(f);
  });
  d('undefinefont', (I) => fontDir.del(I.pop()));
  d('scalefont', (I) => {
    const s = I.popNum();
    I.push(transformFont(I.popDict(), [s, 0, 0, s, 0, 0]));
  });
  d('makefont', (I) => {
    const a = I.popArray();
    I.push(transformFont(I.popDict(), matOf(a, [1, 0, 0, 1, 0, 0])));
  });
  d('setfont', (I) => void (G.g.font = I.pop()));
  d('currentfont', (I) => I.push(G.g.font.t === 'dict' ? G.g.font : fallbackFont(I, name('Courier'))));
  d('rootfont', (I) => I.push(G.g.font));
  d('selectfont', (I) => {
    const sz = I.pop();
    const key = I.pop();
    const f = fontDir.get(key) ?? findResource(I, key, 'Font') ?? fallbackFont(I, key);
    if (f.t !== 'dict') throw new PSError('typecheck');
    G.g.font = sz.t === 'array' ? transformFont(f.d, matOf(sz, [1, 0, 0, 1, 0, 0])) : transformFont(f.d, [(sz as { v: number }).v, 0, 0, (sz as { v: number }).v, 0, 0]);
  });
  // composefont (§8.2): CMap と CIDFont から複合書体 (FontType 0、FMapType 9) を作る
  d('composefont', (I) => {
    const a = I.popArray();
    const cmo = I.pop();
    const key = I.pop();
    let cmap: PSObj | undefined = cmo.t === 'dict' ? cmo : findResource(I, cmo, 'CMap');
    if (!cmap && (cmo.t === 'name' || cmo.t === 'string') && /^Identity-[HV]$/.test(cmo.t === 'name' ? cmo.v : strText(cmo))) {
      // Identity-H・Identity-V (2 バイトの符号をそのまま CID にする) は、定義が無くても使えるようにする
      const nmv = cmo.t === 'name' ? cmo.v : strText(cmo);
      const cd = I.newDict(4);
      cd.put('CMapName', name(nmv));
      cd.put('WMode', int(nmv.endsWith('V') ? 1 : 0));
      CMAPS.set(cd, identityCMap(nmv.endsWith('V') ? 1 : 0));
      cmap = dictObj(cd);
    }
    if (!cmap || cmap.t !== 'dict') throw new PSError('undefinedresource');
    const deps = arrItems(a).map((o) => (o.t === 'dict' ? o : (findResource(I, o, 'CIDFont') ?? findResource(I, o, 'Font') ?? fallbackFont(I, o))));
    const f = I.newDict(10);
    f.put('CMap', cmap);
    f.put('Encoding', arr(deps.map((_, k) => int(k))));
    f.put('FDepVector', arr(deps));
    f.put('FMapType', int(9));
    f.put('FontMatrix', arr([1, 0, 0, 1, 0, 0].map(real)));
    f.put('FontName', key.t === 'string' ? name(strText(key)) : key);
    f.put('FontType', int(0));
    f.put('WMode', int(intOf(cmap.d.get('WMode'), 0)));
    f.put('FID', { t: 'fontid', v: {} });
    fontDir.put(key, dictObj(f));
    I.push(dictObj(f));
  });
  const showStr = (s: PSString, extra?: (g: ShownGlyph, i: number) => [number, number], between?: (g: ShownGlyph[], i: number) => void) => {
    G.needCP();
    const gl = glyphsOf(G.g.font, s);
    showGlyphs(gl, { paint: true, extra, between: between ? (i) => between(gl, i) : undefined });
  };
  d('show', (I) => showStr(I.popString()));
  d('ashow', (I) => {
    const s = I.popString();
    const ay = I.popNum();
    const ax = I.popNum();
    showStr(s, () => [ax, ay]);
  });
  d('widthshow', (I) => {
    const s = I.popString();
    const ch = I.popInt();
    const cy = I.popNum();
    const cx = I.popNum();
    showStr(s, (g) => (g.code === ch ? [cx, cy] : [0, 0]));
  });
  d('awidthshow', (I) => {
    const s = I.popString();
    const ay = I.popNum();
    const ax = I.popNum();
    const ch = I.popInt();
    const cy = I.popNum();
    const cx = I.popNum();
    showStr(s, (g) => (g.code === ch ? [cx + ax, cy + ay] : [ax, ay]));
  });
  d('kshow', (I) => {
    const s = I.popString();
    const p = I.popProc();
    const b = strBytes(s);
    showStr(s, undefined, (_g, i) => {
      I.push(int(b[i]));
      I.push(int(b[i + 1]));
      I.call(p);
    });
  });
  d('cshow', (I) => {
    const s = I.popString();
    const p = I.popProc();
    // 字ごとに、符号と送り (ユーザ空間) を積んで手続きを呼ぶ。字は描かない (§8.2 cshow)
    for (const g of glyphsOf(G.g.font, s)) {
      const save = G.g.cp;
      const [wx, wy] = showGlyphs([g], { paint: false });
      G.g.cp = save;
      I.push(int(g.code));
      I.push(real(wx));
      I.push(real(wy));
      I.call(p);
    }
  });
  // xshow・yshow・xyshow: 字ごとの送りを数の配列で与える
  const xyshow = (mode: 'x' | 'y' | 'xy') => (I: Interp) => {
    const na = I.pop();
    const s = I.popString();
    if (na.t !== 'array') {
      I.warn('xshow の符号化した数の並び');
      return showStr(s);
    }
    const v = numsOf(na);
    G.needCP();
    const gl = glyphsOf(G.g.font, s);
    // 字の送りを、与えた送りに置き換える: 字の送りを打ち消してから足す
    showGlyphs(gl, {
      paint: true,
      extra: (g, i) => {
        const w = g.glyph ? [g.glyph.wx, g.glyph.wy] : g.fallback ? [500, 0] : type3Width;
        const [ux, uy] = applyVector(g.m, w[0], w[1]);
        const dx = mode === 'x' ? v[i] : mode === 'xy' ? v[i * 2] : 0;
        const dy = mode === 'y' ? v[i] : mode === 'xy' ? v[i * 2 + 1] : 0;
        return [(dx ?? 0) - ux, (dy ?? 0) - uy];
      },
    });
  };
  d('xshow', xyshow('x'));
  d('yshow', xyshow('y'));
  d('xyshow', xyshow('xy'));
  d('glyphshow', (I) => {
    const k = I.pop();
    G.needCP();
    const f = G.g.font;
    if (f.t !== 'dict') return;
    const ft = intOf(f.d.get('FontType'), 1);
    if ((ft === 1 || ft === 2) && k.t === 'name') {
      const cff = ft === 2 ? cffOf(f.d) : undefined;
      const g = cff ? cffGlyphCached(cff, cff.byName.get(k.v) ?? 0) : type1Glyph(f.d, k.v);
      if (g) showGlyphs([{ m: fontMatrix(f), glyph: g, code: 0, paintType: 0, strokeWidth: 0 }]);
    } else I.warn('glyphshow');
  });
  d('stringwidth', (I) => {
    const s = I.popString();
    const save = { cp: G.g.cp, path: G.g.path.slice() };
    const [x, y] = showGlyphs(glyphsOf(G.g.font, s), { paint: false });
    G.g.cp = save.cp;
    G.g.path = save.path;
    I.push(real(x));
    I.push(real(y));
  });
  d('charpath', (I) => {
    I.popBool();
    const s = I.popString();
    G.needCP();
    const gl = glyphsOf(G.g.font, s);
    if (gl.some((g) => g.fallback)) I.warn('代わりの書体の charpath');
    showGlyphs(gl, { paint: false, path: true });
  });
  d('setcachedevice', (I) => {
    for (let k = 0; k < 4; k++) I.pop();
    const wy = I.popNum();
    const wx = I.popNum();
    type3Width = [wx, wy];
  });
  d('setcachedevice2', (I) => {
    for (let k = 0; k < 8; k++) I.pop();
    const wy = I.popNum();
    const wx = I.popNum();
    type3Width = [wx, wy];
  });
  d('setcharwidth', (I) => {
    const wy = I.popNum();
    const wx = I.popNum();
    type3Width = [wx, wy];
  });
  d('setcachelimit', (I) => void I.pop());
  d('cachestatus', (I) => {
    for (let k = 0; k < 7; k++) I.push(int(0));
  });
  d('setcacheparams', (I) => {
    let n = 0;
    while (I.ostack.length && I.ostack[I.ostack.length - 1].t !== 'mark' && n++ < 10) I.pop();
    if (I.ostack.length) I.pop();
  });
  d('currentcacheparams', (I) => {
    I.push({ t: 'mark' });
    I.push(int(0));
    I.push(int(0));
  });
  d('findencoding', (I) => {
    const k = I.pop();
    const v = findResource(I, k, 'Encoding') ?? (k.t === 'name' ? I.systemdict.get(k.v) : undefined);
    if (!v) throw new PSError('undefinedresource');
    I.push(v);
  });
  // eexec (§8.2・T1 §7.2): 暗号を解いたファイルを、systemdict を辞書スタックに積んで実行する
  d('eexec', (I) => {
    const src = I.pop();
    let read: ByteSource;
    if (src.t === 'file') {
      const f = src.f;
      read = { read: () => f.read() };
    } else if (src.t === 'string') read = bytesSource(strBytes(src).slice());
    else throw new PSError('typecheck');
    const ef = new PSFile(eexecSource(read), 'eexec');
    I.dstack.push(I.systemdict);
    const n = I.dstack.length;
    try {
      I.runFile(ef);
    } finally {
      // 暗号を解いたファイルが閉じたら、辞書スタックを 1 つ外す
      if (I.dstack.length >= n && I.dstack[n - 1] === I.systemdict) I.dstack.splice(n - 1, 1);
    }
  });
}
