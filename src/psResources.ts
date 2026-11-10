/**
 * psResources — PostScript の資源 (§3.9): 分類 (Category) の実装の辞書と、その局所・大域の実例、資源の演算子の本体。
 * 書体が見つからないときの代わりの書体 (fallbackFont) もここに置く (Font の分類の FindResource が使う)
 */
import { type Interp, type PSDict, type PSObj, PSError, typeName, arr, dictObj, int, name, real, strText, FALSE, TRUE } from './psInterp';

// ───────────────────────── 資源 (§3.9) ─────────────────────────
//
// 資源の演算子は、分類の実装の辞書 (Category の資源) を begin し、その DefineResource・FindResource などを呼ぶ (§3.9.3)。
// 標準の分類と Generic の実装は、実装の辞書ごとに、局所と大域の実例を別に持つ (表 3.11 の後の説明)。

/** 実装の辞書ごとの実例 (Interp.resourceInstances。辞書の中に置かない: Generic を写して作った分類と混ざらないように) */
function instancesOf(I: Interp, impl: PSDict) {
  let r = I.resourceInstances.get(impl);
  if (!r) {
    const local = new (impl.constructor as new (I: Interp, n: number) => PSDict)(I, 10);
    const global = new (impl.constructor as new (I: Interp, n: number) => PSDict)(I, 10);
    global.global = true;
    r = { local, global };
    I.resourceInstances.set(impl, r);
  }
  return r;
}

// ── 型紙 (resourceforall・filenameforall の template。§8.2 filenameforall) ──
// 「*」は 0 字以上のどんな並びにも、「?」はどの 1 字にも一致する。「\」は次の 1 字を文字通りに扱う (「\*」は * そのもの)。ほかの字はその字に一致する。

const T_STAR = -1;
const T_ANY = -2;

/** 型紙を、字の符号・T_STAR・T_ANY の並びにする (続く * は 1 つにまとめる。末尾の \ は \ そのもの) */
export function parseTemplate(t: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x5c && i + 1 < t.length) out.push(t.charCodeAt(++i));
    else if (c === 0x2a) {
      if (out[out.length - 1] !== T_STAR) out.push(T_STAR);
    } else if (c === 0x3f) out.push(T_ANY);
    else out.push(c);
  }
  return out;
}

/**
 * 型紙 (parseTemplate の結果) が text の全体に一致するか。
 * 後戻りは「最後に見た * に 1 字多く食わせる」の 1 通りだけなので、手間は長さの積までで済む (正規表現の .* の入れ子のように、* の数の乗で増えない)。
 * work は、4096 歩ごとに呼ぶ (呼び手が、手間として数える)
 */
export function matchTemplate(pat: number[], text: string, work?: () => void): boolean {
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = 0;
  let steps = 0;
  while (t < text.length) {
    if (p < pat.length && (pat[p] === T_ANY || pat[p] === text.charCodeAt(t))) {
      p++;
      t++;
    } else if (p < pat.length && pat[p] === T_STAR) {
      starP = p++;
      starT = t;
    } else if (starP >= 0) {
      p = starP + 1;
      t = ++starT;
    } else return false;
    if ((++steps & 4095) === 0) work?.();
  }
  while (p < pat.length && pat[p] === T_STAR) p++;
  return p === pat.length;
}

/** 分類の辞書 (Category の資源の実例) */
function categories(I: Interp): PSDict {
  const v = I.systemdict.map.get('\u0000categories');
  return (v!.v as { d: PSDict }).d;
}

/** 分類の実例の辞書を探す (Generic の実装のもの)。無ければ undefined */
export function findResource(I: Interp, key: PSObj, cat: string): PSObj | undefined {
  const impl = categories(I).get(cat);
  if (!impl || impl.t !== 'dict') return undefined;
  const ins = instancesOf(I, impl.d);
  const v = ins.local.get(key) ?? ins.global.get(key);
  if (v) return v;
  if (cat === 'Font') return (I.systemdict.get('FontDirectory') as { d: PSDict } | undefined)?.d.get(key);
  return undefined;
}

/** 書体の節が作る ProcSet (CIDInit・FontSetInit)。psOpsFont のものを psGraphics が渡す (psResources と psOpsFont を互いに読み込ませない) */
export interface FontProcSets {
  makeCIDInit: (I: Interp) => PSDict;
  makeFontSetInit: (I: Interp) => PSDict;
}

export function installResources(I: Interp, fontProcSets: FontProcSets) {
  const cats = I.newDict(40);
  cats.global = true;
  I.systemdict.map.set('\u0000categories', { k: name('\u0000categories'), v: dictObj(cats) });
  const op = (nm: string, fn: (I: Interp) => void): PSObj => ({ t: 'operator', name: nm, fn, x: true });
  const impl = () => I.currentdict;
  const catName = (d: PSDict) => {
    const c = d.get('Category');
    return c && c.t === 'name' ? c.v : '';
  };
  // Generic の実装 (§3.9.3 Generic Category)
  const generic: Array<[string, PSObj]> = [
    [
      'DefineResource',
      op('DefineResource', (I) => {
        const inst = I.pop();
        const key = I.pop();
        const d = impl();
        const it = d.get('InstanceType');
        if (it && it.t === 'name' && typeName(inst) !== it.v) throw new PSError('typecheck');
        const ins = instancesOf(I, d);
        (I.globalAlloc ? ins.global : ins.local).put(key, inst);
        if (catName(d) === 'Font' && inst.t === 'dict') (I.systemdict.get('FontDirectory') as { d: PSDict }).d.put(key, inst);
        I.push(inst);
      }),
    ],
    [
      'UndefineResource',
      op('UndefineResource', (I) => {
        const key = I.pop();
        const ins = instancesOf(I, impl());
        ins.local.del(key);
        ins.global.del(key);
      }),
    ],
    [
      'FindResource',
      op('FindResource', (I) => {
        const key = I.pop();
        const d = impl();
        const ins = instancesOf(I, d);
        const v = ins.local.get(key) ?? ins.global.get(key);
        if (v) return I.push(v);
        const cn = catName(d);
        if (cn === 'Font') {
          const fd = (I.systemdict.get('FontDirectory') as { d: PSDict }).d.get(key);
          I.push(fd ?? fallbackFont(I, key));
          return;
        }
        throw new PSError('undefinedresource');
      }),
    ],
    [
      'ResourceStatus',
      op('ResourceStatus', (I) => {
        const key = I.pop();
        const ins = instancesOf(I, impl());
        const local = ins.local.has(key);
        if (local || ins.global.has(key)) {
          // status は 0 (defineresource で VM に定義したもの。PLRM §8.2 resourcestatus)。大きさは分からないが、
          // 実例が暗に決まっている分類 (VM を使わない) と同じ 0 を返す
          I.push(int(0));
          I.push(int(0));
          I.push(TRUE);
        } else I.push(FALSE);
      }),
    ],
    [
      'ResourceForAll',
      op('ResourceForAll', (I) => {
        const scratch = I.popString();
        const proc = I.popProc();
        const template = I.popString();
        const d = impl();
        const ins = instancesOf(I, d);
        // 型紙の照合は、後戻りの爆発しない手書きのものでする (正規表現に直すと、(*a*a*a*a*a*a*a*a*a*b) のような型紙 1 つで十数秒かかる)
        I.work(template.n);
        const pat = parseTemplate(strText(template));
        const work = () => I.charge(64);
        // 同じ実例は 1 度だけ渡す (local と global の両方に定義があれば local のもの。PLRM §8.2 resourceforall)
        const keys = [...ins.local.map.values(), ...[...ins.global.map.values()].filter((e) => !ins.local.has(e.k))].map((e) => e.k);
        const starOnly = pat.length === 1 && pat[0] === T_STAR;
        // 実装の辞書を辞書スタックから外して、手続きを呼ぶ (表 3.11 ResourceForAll)
        const top = I.dstack.pop()!;
        try {
          for (const k of keys) {
            I.tick();
            if (k.t !== 'name' && k.t !== 'string') {
              // 名前でも文字列でもない鍵は、型紙 (*) だけに合い、scratch に写さずに鍵をそのまま渡す (PLRM §8.2 resourceforall)
              if (!starOnly) continue;
              I.push(k);
              if (!I.loopBody(proc)) break;
              continue;
            }
            const t = k.t === 'name' ? k.v : strText(k);
            if (!matchTemplate(pat, t, work)) continue;
            const b = new TextEncoder().encode(t);
            scratch.b.set(b.subarray(0, scratch.n), scratch.o);
            I.push({ ...scratch, n: Math.min(b.length, scratch.n) });
            if (!I.loopBody(proc)) break;
          }
        } finally {
          I.dstack.push(top);
        }
      }),
    ],
  ];
  const makeImpl = (cat: string, instanceType?: string) => {
    const d = I.newDict(10);
    d.global = true;
    for (const [k, v] of generic) d.put(k, v);
    d.put('Category', name(cat));
    if (instanceType) d.put('InstanceType', name(instanceType));
    cats.put(cat, dictObj(d));
    return d;
  };
  // 表 3.7・3.8・3.9 の分類
  const regular: Array<[string, string]> = [
    ['Font', 'dicttype'],
    ['CIDFont', 'dicttype'],
    ['CMap', 'dicttype'],
    ['FontSet', 'dicttype'],
    ['Encoding', 'arraytype'],
    ['Form', 'dicttype'],
    ['Pattern', 'dicttype'],
    ['ProcSet', 'dicttype'],
    ['ColorSpace', 'arraytype'],
    ['Halftone', 'dicttype'],
    ['ColorRendering', 'dicttype'],
    ['IdiomSet', 'dicttype'],
    ['InkParams', 'dicttype'],
    ['TrapParams', 'dicttype'],
    ['OutputDevice', 'dicttype'],
    ['ControlLanguage', 'dicttype'],
    ['Localization', 'dicttype'],
    ['PDL', 'dicttype'],
    ['HWOptions', 'dicttype'],
  ];
  for (const [c, t] of regular) makeImpl(c, t);
  makeImpl('Generic');
  // 実例が暗に決まっている分類 (表 3.8): この実装が扱えるものを実例にする
  const implicit: Record<string, PSObj[]> = {
    Filter: ['ASCIIHexDecode', 'ASCII85Decode', 'RunLengthDecode', 'LZWDecode', 'FlateDecode', 'SubFileDecode', 'ReusableStreamDecode', 'DCTDecode', 'NullEncode'].map((n) => name(n)),
    ColorSpaceFamily: ['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'CIEBasedA', 'CIEBasedABC', 'CIEBasedDEF', 'CIEBasedDEFG', 'Indexed', 'Separation', 'DeviceN', 'Pattern'].map((n) => name(n)),
    Emulator: [],
    IODevice: [],
    ColorRenderingType: [int(1)],
    FMapType: [],
    FontType: [int(1), int(3)],
    FormType: [int(1)],
    HalftoneType: [int(1), int(3), int(5), int(6), int(10), int(16)],
    ImageType: [int(1), int(3), int(4)],
    PatternType: [int(1), int(2)],
    FunctionType: [int(0), int(2), int(3), int(4)],
    ShadingType: [int(1), int(2), int(3), int(4), int(5), int(6), int(7)],
    TrappingType: [],
  };
  for (const [c, list] of Object.entries(implicit)) {
    const d = makeImpl(c);
    const ins = instancesOf(I, d);
    for (const k of list) ins.global.put(k, k);
  }
  // 標準の手続き集 (表 3.10)。CIDInit の CMap の演算子 (符号の範囲と CID の対応を覚える) と FontSetInit (CFF の StartData) は psOpsFont が作る
  const procImpl = (cats.get('ProcSet') as { d: PSDict }).d;
  const cidInit = fontProcSets.makeCIDInit(I);
  const procs = instancesOf(I, procImpl).global;
  procs.put('CIDInit', dictObj(cidInit));
  procs.put('FontSetInit', dictObj(fontProcSets.makeFontSetInit(I)));
  for (const n of ['ColorRendering', 'Trapping', 'BitmapFontInit']) {
    const d = I.newDict(4);
    d.global = true;
    procs.put(n, dictObj(d));
  }
  // 標準の符号化 (StandardEncoding・ISOLatin1Encoding) も Encoding の実例にする
  const encImpl = (cats.get('Encoding') as { d: PSDict }).d;
  for (const n of ['StandardEncoding', 'ISOLatin1Encoding']) {
    const v = I.systemdict.get(n);
    if (v) instancesOf(I, encImpl).global.put(n, v);
  }
}

/** 資源の演算子: 分類の実装の辞書の手続きを呼ぶ (§3.9.3) */
export function resourceOp(I: Interp, proc: string, nargs: number) {
  const cat = I.pop();
  if (cat.t !== 'name' && cat.t !== 'string') throw new PSError('typecheck');
  const cn = cat.t === 'name' ? cat.v : strText(cat);
  const cats = categories(I);
  if (cn === 'Category') {
    // Category の分類: 実例は分類の実装の辞書
    if (proc === 'DefineResource') {
      const inst = I.pop();
      const key = I.pop();
      if (inst.t !== 'dict') throw new PSError('typecheck');
      inst.d.put('Category', key.t === 'string' ? name(strText(key)) : key);
      cats.put(key, inst);
      I.push(inst);
    } else if (proc === 'FindResource') {
      const key = I.pop();
      const v = cats.get(key);
      if (!v) throw new PSError('undefinedresource');
      I.push(v);
    } else if (proc === 'ResourceStatus') {
      const key = I.pop();
      if (cats.has(key)) {
        I.push(int(1));
        I.push(int(0));
        I.push(TRUE);
      } else I.push(FALSE);
    } else if (proc === 'UndefineResource') cats.del(I.pop());
    else {
      const scratch = I.popString();
      const p = I.popProc();
      I.popString();
      for (const { k } of [...cats.map.values()]) {
        const b = new TextEncoder().encode(k.t === 'name' ? k.v : '');
        scratch.b.set(b.subarray(0, scratch.n), scratch.o);
        I.push({ ...scratch, n: Math.min(b.length, scratch.n) });
        if (!I.loopBody(p)) break;
      }
    }
    return;
  }
  const implObj = cats.get(cn);
  if (!implObj || implObj.t !== 'dict') throw new PSError('undefined');
  const fn = implObj.d.get(proc);
  if (!fn) throw new PSError('undefined');
  const depth = I.ostack.length - nargs;
  const dsl = I.dstack.length;
  const saved = I.ostack.slice(depth);
  I.dstack.push(implObj.d);
  try {
    I.call(fn);
  } catch (e) {
    // 実装の手続きの中のエラーは、資源の演算子のエラーに見せる (表 3.11 の後の説明)
    if (proc !== 'ResourceForAll') {
      I.ostack.length = Math.max(0, depth);
      I.ostack.push(...saved);
    }
    I.dstack.length = dsl;
    throw e;
  }
  I.dstack.length = Math.min(I.dstack.length, dsl);
}

/** 書体の辞書 (仮): 字の形を持たず、送りは字の大きさの 0.5 */
export function fallbackFont(I: Interp, key: PSObj): PSObj {
  const fd = I.newDict(10);
  fd.put('FontName', key.t === 'string' ? name(strText(key)) : key);
  fd.put('FontType', int(1));
  fd.put('FontMatrix', arr([real(0.001), real(0), real(0), real(0.001), real(0), real(0)]));
  fd.put('FontBBox', arr([int(0), int(-200), int(1000), int(900)]));
  fd.put('Encoding', I.systemdict.get('StandardEncoding') ?? arr([]));
  fd.put('PaintType', int(0));
  fd.put('CharStrings', dictObj(I.newDict()));
  fd.put('FID', { t: 'fontid', v: {} });
  // 字の形を持たない書体の印 (要求された名前)。dup length dict copy などで写した書体にも付いていく
  fd.put(FALLBACK_KEY, key.t === 'string' ? name(strText(key)) : key);
  return dictObj(fd);
}
/** 字の形を持たない書体の印 (要求された名前を入れる鍵) */
export const FALLBACK_KEY = '\u0000fallback';
