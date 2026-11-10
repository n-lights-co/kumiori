/**
 * psGraphics — PostScript の図形の演算子 (PLRM 第 4 章)。描いたものは「描画の並び」(DisplayItem) にためる。
 *
 *  グラフィックス状態 (§4.2)・座標変換 (§4.3)・パス (§4.4)・塗りと線 (§4.5)・クリップ・色空間 (§4.8)・画像 (§4.10)
 *  色は描くときに RGB にする (DeviceCMYK → DeviceRGB は §7.2.4 の式。CIE ベースの色空間は、成分をそのまま RGB・グレー・CMYK とみなす)。
 *  文字 (第 5 章) は、書体の名前と行列だけを使い、代わりの書体で描く (埋め込まれた書体の字の形はまだ使わない)。
 *  模様 (§4.9) と網かけ (shfill) は psShading で描く (網かけは画素の画像、並べる模様は PaintProc の絵の写し)。模様の線 (stroke) は、線の輪郭を模様で塗る。
 */
import { apply, IDENTITY, invert, mul, type Matrix, type Seg } from './matrix';
import { type Interp, type PSObj, PSError, VM_GSTATE, arr, arrItems, dictObj, name, real, strBytes, strText, NULL } from './psInterp';
import { PS_MAX_PATH_POINTS } from './imageLimits';

import { DEVICE_GRAY, DEVICE_RGB, DEVICE_CMYK, clamp01, type ColorSpace, type RGB } from './psColorSpace';
export type { RGB } from './psColorSpace';
import { findResource, installResources, resourceOp } from './psResources';
export { findResource } from './psResources';
import { installMatrixOperators, readMatrix } from './psOpsMatrix';
import { installStateOperators } from './psOpsState';
import { appendRects, installPathOperators } from './psOpsPath';
import { installImageOperators } from './psOpsImage';
import { installFontStubs, makeCIDInit, makeFontSetInit } from './psOpsFont';
import { patternFill as shadePatternFill, strokeOutline } from './psShading';

/**
 * 変換の行列 (matrix.ts の Matrix)。PostScript の「点に a を掛けてから b を掛ける」積 (§4.3.3) は mul(b, a) と書く
 * (matrix.ts の mul は「後ろの引数を先に当てる」)
 */
export type Mat = Matrix;

/** クリップ (外側のものへのつながりを持つ。同じクリップは同じオブジェクト) */
export interface Clip {
  segs: Seg[];
  evenOdd: boolean;
  parent?: Clip;
}

export type DisplayItem =
  | { k: 'fill'; segs: Seg[]; evenOdd: boolean; color: RGB; cmyk?: number[]; clip?: Clip }
  | {
      k: 'stroke';
      segs: Seg[];
      color: RGB;
      cmyk?: number[];
      lineWidth: number;
      cap: number;
      join: number;
      miter: number;
      dash?: { array: number[]; offset: number };
      ctm: Mat;
      clip?: Clip;
    }
  | { k: 'image'; width: number; height: number; rgba?: Uint8Array; jpeg?: Uint8Array; mat: Mat; interpolate: boolean; clip?: Clip }
  /** 文字 (埋め込まれていない書体): mat は 1 em の文字の空間 (y 上向き) → 機器の座標 (原点は文字の始まり) */
  | { k: 'text'; text: string; fontName: string; mat: Mat; color: RGB; cmyk?: number[]; clip?: Clip };

/**
 * パスの配列を持つグラフィックス状態の数 (無ければ 1)。gsave などの写し (copy) で増え、書き換える前 (ownPath) に 2 以上なら写す。
 * grestore・restore・newpath で手放すときに減らす (減らし忘れは余計な写しになるだけで、結果は変わらない)
 */
const PATH_HOLDERS = new WeakMap<Seg[], number>();
const sharePath = (p: Seg[]) => PATH_HOLDERS.set(p, (PATH_HOLDERS.get(p) ?? 1) + 1);
const releasePath = (p: Seg[]) => {
  const n = PATH_HOLDERS.get(p);
  if (n !== undefined) PATH_HOLDERS.set(p, n - 1);
};

export interface GState {
  ctm: Mat;
  path: Seg[];
  /** 現在の点 (機器の座標) */
  cp?: [number, number];
  /** 最後の moveto の点 (closepath で戻る) */
  sp?: [number, number];
  cs: ColorSpace;
  color: number[];
  /** 模様 (Pattern の色空間のとき) */
  pattern?: PSObj;
  lineWidth: number;
  cap: number;
  join: number;
  miter: number;
  dash: { array: number[]; offset: number };
  flat: number;
  strokeAdjust: boolean;
  overprint: boolean;
  smoothness: number;
  clip?: Clip;
  clipStack: Array<Clip | undefined>;
  font: PSObj;
  transfer: PSObj;
  screen: PSObj[];
  halftone: PSObj;
  colorRendering: PSObj;
  blackGeneration: PSObj;
  ucr: PSObj;
}

/**
 * メモリの合計の勘定 (Interp.memAlloc。imageLimits.ts の PS_MAX_MEMORY_BYTES の説明) に積む、パスの 1 点の量。
 * 実際に使う量 (Node 22 で測った値) は、lineto の 1 点で 60 バイト、curveto で 92 バイト。描画の並びの 1 件 (4 点と数える) は
 * 2 点の stroke で 388 バイト・4 点の fill で 412 バイト (点の分を含む)、文字は 1 字 33 バイト
 */
export const MEM_PATH_POINT = 96;
/** 描画の並び・クリップに写したパスの 1 点 (点の本体は共有し、並びだけを写す) */
export const MEM_SHOWN_POINT = 8;

export interface GraphicsOptions {
  /** 既定の座標 (EPS の外接矩形) */
  bbox: [number, number, number, number];
  /** パスの点の合計の上限 (超えれば limitcheck)。既定は PS_MAX_PATH_POINTS */
  maxPathPoints?: number;
}

export class Graphics {
  g: GState;
  stack: GState[] = [];
  items: DisplayItem[] = [];
  /** これまでに描いた画像の画素の合計 (上限を確かめる) */
  imagePixels?: number;
  /**
   * これまでに作ったパスの点の合計 (PS_MAX_PATH_POINTS の説明。メモリの量を抑える)。
   * 点を 1 つ作るごとに 1、グラフィックス状態が持つパスの写し (gsave のあとの書き換え。点の本体は共有する) は 8 点で 1、
   * 描画の並びの 1 件は 4、文字は 1 字で 1 と数える。
   * newpath で捨てたパスの分は戻さない (描画の並びが点を持ち続けているかどうかを、点ごとに追わない)
   */
  pathPoints = 0;
  maxPathPoints: number;
  /**
   * 描画の並び (fill・stroke・クリップ) に写したパスの点の合計。上限は maxPathPoints の 2 倍 (同じパスを塗って線も引く絵が、作った点の 2 倍を写す)。
   * 写しは点の本体を共有するのでメモリは小さいが、描画の並びを SVG・PDF にするときに、写した点の数だけ出力が増える
   * ({ gsave fill grestore } loop が、10 万点のパスを何百回も写す)
   */
  shownPoints = 0;
  /** 一度だけ出す警告 */
  constructor(
    public I: Interp,
    public opts: GraphicsOptions,
  ) {
    this.maxPathPoints = opts.maxPathPoints ?? PS_MAX_PATH_POINTS;
    this.g = this.initial();
    I.gfx = {
      saveCost: () => this.gstateCost(this.g) + this.stack.reduce((t, s) => t + this.gstateCost(s), 0),
      saveForRestore: () => ({ g: this.copy(this.g), stack: this.stack.map((s) => this.copy(s)) }),
      restoreTo: (s) => {
        const st = s as { g: GState; stack: GState[] };
        this.discard(this.g);
        for (const x of this.stack) this.discard(x);
        this.g = this.copy(st.g);
        this.stack = st.stack.map((x) => this.copy(x));
      },
    };
    installGraphicsOperators(I, this);
  }

  initial(): GState {
    const nullProc = arr([], true);
    return {
      ctm: [...IDENTITY] as Mat,
      path: [],
      cs: DEVICE_GRAY,
      color: [0],
      lineWidth: 1,
      cap: 0,
      join: 0,
      miter: 10,
      dash: { array: [], offset: 0 },
      flat: 1,
      strokeAdjust: false,
      overprint: false,
      smoothness: 0.02,
      clipStack: [],
      font: NULL,
      transfer: nullProc,
      screen: [real(60), real(45), nullProc],
      halftone: NULL,
      colorRendering: NULL,
      blackGeneration: nullProc,
      ucr: nullProc,
    };
  }
  copy(g: GState): GState {
    // パスは写さずに共有し、書き換える側が写す (ownPath)
    sharePath(g.path);
    return { ...g, color: g.color.slice(), dash: { ...g.dash, array: g.dash.array.slice() }, clipStack: g.clipStack.slice(), ctm: [...g.ctm] as Mat };
  }

  /** グラフィックス状態 1 つの写しが使う量 (VM に積む。gstate のオブジェクト・save の記録) */
  gstateCost(g: GState): number {
    return VM_GSTATE + (g.dash.array.length + g.clipStack.length + g.color.length) * 8;
  }

  // ── 点の数 (付録 B の「パス」の限界) ──
  /** パスの点を n 個作った (または、描画の並びに n 点ぶんを足した) と数える。上限を超えれば limitcheck */
  countPoints(n: number) {
    this.pathPoints += n;
    if (this.pathPoints > this.maxPathPoints) throw new PSError('limitcheck');
    // メモリの合計の勘定にも積む (超えれば VMerror)
    this.I.memAlloc(n * MEM_PATH_POINT);
  }
  /** グラフィックス状態が持つ n 点のパスを写した (点の本体は共有する) と数える。写す手間も数える */
  countCopy(n: number) {
    this.countPoints(Math.ceil(n / 8));
    this.I.work(n);
  }
  /** 描画の並び (またはクリップ) に 1 件を足す前に呼ぶ。n: その 1 件が持つパスの点の数 */
  countItem(n = 0) {
    this.countPoints(4);
    this.shownPoints += n;
    if (this.shownPoints > this.maxPathPoints * 2) throw new PSError('limitcheck');
    this.I.memAlloc(n * MEM_SHOWN_POINT);
    this.I.work(n);
  }

  // ── 色 ──
  /** 色空間の成分を RGB にする */
  toRGB(cs: ColorSpace, c: number[]): RGB {
    switch (cs.family) {
      case 'DeviceGray':
      case 'CIEBasedA':
      case 'CalGray':
        return [clamp01(c[0]), clamp01(c[0]), clamp01(c[0])];
      case 'DeviceRGB':
      case 'CIEBasedABC':
      case 'CIEBasedDEF':
      case 'CalRGB':
        return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
      case 'DeviceCMYK':
      case 'CIEBasedDEFG':
        // §7.2.4
        return [1 - Math.min(1, c[0] + c[3]), 1 - Math.min(1, c[1] + c[3]), 1 - Math.min(1, c[2] + c[3])];
      case 'Indexed': {
        const base = cs.base!;
        const i = Math.max(0, Math.min(cs.hival!, Math.round(c[0])));
        if (cs.lookup instanceof Uint8Array) {
          const comps: number[] = [];
          for (let k = 0; k < base.ncomp; k++) comps.push((cs.lookup[i * base.ncomp + k] ?? 0) / 255);
          return this.toRGB(base, comps);
        }
        const out = this.callTint(cs.lookup as PSObj, [i], base.ncomp);
        return this.toRGB(base, out);
      }
      case 'Separation':
      case 'DeviceN': {
        // 色の名前が All は全ての色材、None は描かない (§4.8.4)。それ以外は代わりの色空間で描く
        if (cs.family === 'Separation' && cs.names?.[0] === 'All') return [1 - c[0], 1 - c[0], 1 - c[0]];
        const out = this.callTint(cs.tint!, c, cs.base!.ncomp);
        return this.toRGB(cs.base!, out);
      }
      default:
        return [0, 0, 0];
    }
  }
  private tintCache = new Map<string, number[]>();
  callTint(proc: PSObj, comps: number[], n: number): number[] {
    const key = (proc as { a?: unknown }).a ? `${comps.join(',')}` : '';
    const cacheKey = key && this.tintKey(proc) + ':' + key;
    if (cacheKey) {
      const hit = this.tintCache.get(cacheKey);
      if (hit) return hit;
    }
    const I = this.I;
    const depth = I.ostack.length;
    for (const v of comps) I.push(real(v));
    try {
      I.call(proc);
    } catch (e) {
      if (!(e instanceof PSError)) throw e;
    }
    const out: number[] = [];
    while (I.ostack.length > depth && out.length < n) {
      const o = I.ostack.pop()!;
      out.unshift(o.t === 'int' || o.t === 'real' ? o.v : 0);
    }
    I.ostack.length = depth;
    while (out.length < n) out.push(0);
    if (cacheKey && this.tintCache.size < 200000) this.tintCache.set(cacheKey, out);
    return out;
  }
  private procIds = new WeakMap<object, number>();
  private procSerial = 0;
  private tintKey(p: PSObj): number {
    const k = (p as { a: object }).a;
    let id = this.procIds.get(k);
    if (id === undefined) {
      id = ++this.procSerial;
      this.procIds.set(k, id);
    }
    return id;
  }
  currentRGB(): RGB {
    return this.toRGB(this.g.cs, this.g.color);
  }
  /** 色が CMYK で決まるとき (DeviceCMYK と、元の色空間が DeviceCMYK の Indexed・Separation・DeviceN) の CMYK の値 */
  toCMYK(cs: ColorSpace, c: number[]): number[] | undefined {
    switch (cs.family) {
      case 'DeviceCMYK':
        return c.map(clamp01);
      case 'Indexed': {
        const base = cs.base!;
        if (base.family !== 'DeviceCMYK' && base.family !== 'Separation' && base.family !== 'DeviceN') return undefined;
        const i = Math.max(0, Math.min(cs.hival!, Math.round(c[0])));
        const comps: number[] = [];
        if (cs.lookup instanceof Uint8Array) for (let k = 0; k < base.ncomp; k++) comps.push((cs.lookup[i * base.ncomp + k] ?? 0) / 255);
        else comps.push(...this.callTint(cs.lookup as PSObj, [i], base.ncomp));
        return this.toCMYK(base, comps);
      }
      case 'Separation':
      case 'DeviceN':
        if (cs.family === 'Separation' && cs.names?.[0] === 'All') return [c[0], c[0], c[0], c[0]].map(clamp01);
        if (cs.base?.family !== 'DeviceCMYK') return undefined;
        return this.callTint(cs.tint!, c, 4).map(clamp01);
      default:
        return undefined;
    }
  }
  /** 色材の名前が None の Separation (すべて None の DeviceN) は何も描かない (§4.8.4) */
  invisible(): boolean {
    const cs = this.g.cs;
    return (cs.family === 'Separation' || cs.family === 'DeviceN') && !!cs.names?.length && cs.names.every((n) => n === 'None');
  }
  currentCMYK(): number[] | undefined {
    return this.g.cs.family === 'Pattern' ? undefined : this.toCMYK(this.g.cs, this.g.color);
  }

  /** 色空間のオブジェクト (名前または配列) を読む (§4.8) */
  parseColorSpace(o: PSObj): ColorSpace {
    const I = this.I;
    if (o.t === 'name') {
      switch (o.v) {
        case 'DeviceGray':
          return DEVICE_GRAY;
        case 'DeviceRGB':
          return DEVICE_RGB;
        case 'DeviceCMYK':
          return DEVICE_CMYK;
        case 'Pattern':
          return { family: 'Pattern', obj: o, ncomp: 1 };
        default: {
          // 名前の付いた色空間 (ColorSpace の資源)
          const r = findResource(I, o, 'ColorSpace');
          if (r) return this.parseColorSpace(r);
          throw new PSError('undefined');
        }
      }
    }
    if (o.t !== 'array' || o.n < 1) throw new PSError('typecheck');
    const items = arrItems(o);
    const fam = items[0];
    if (fam.t !== 'name') throw new PSError('typecheck');
    switch (fam.v) {
      case 'DeviceGray':
      case 'DeviceRGB':
      case 'DeviceCMYK':
        return this.parseColorSpace(fam);
      case 'CIEBasedA':
        return { family: 'CIEBasedA', obj: o, ncomp: 1 };
      case 'CIEBasedABC':
        return { family: 'CIEBasedABC', obj: o, ncomp: 3 };
      case 'CIEBasedDEF':
        return { family: 'CIEBasedDEF', obj: o, ncomp: 3 };
      case 'CIEBasedDEFG':
        return { family: 'CIEBasedDEFG', obj: o, ncomp: 4 };
      case 'Pattern':
        return { family: 'Pattern', obj: o, ncomp: 1, base: items[1] ? this.parseColorSpace(items[1]) : undefined };
      case 'Indexed': {
        const base = this.parseColorSpace(items[1]);
        const hi = items[2];
        const lk = items[3];
        if (hi.t !== 'int') throw new PSError('typecheck');
        return { family: 'Indexed', obj: o, ncomp: 1, base, hival: hi.v, lookup: lk.t === 'string' ? strBytes(lk).slice() : lk };
      }
      case 'Separation': {
        const nm = items[1];
        return {
          family: 'Separation',
          obj: o,
          ncomp: 1,
          names: [nm.t === 'name' ? nm.v : nm.t === 'string' ? strText(nm) : ''],
          base: this.parseColorSpace(items[2]),
          tint: items[3],
        };
      }
      case 'DeviceN': {
        const nms = items[1];
        if (nms.t !== 'array') throw new PSError('typecheck');
        const names = arrItems(nms).map((x) => (x.t === 'name' ? x.v : x.t === 'string' ? strText(x) : ''));
        return { family: 'DeviceN', obj: o, ncomp: names.length, names, base: this.parseColorSpace(items[2]), tint: items[3] };
      }
      default:
        this.I.warn(`色空間 ${fam.v}`);
        return DEVICE_GRAY;
    }
  }
  initialColor(cs: ColorSpace): number[] {
    switch (cs.family) {
      case 'DeviceCMYK':
        return [0, 0, 0, 1];
      case 'Separation':
      case 'DeviceN':
        return new Array(cs.ncomp).fill(1);
      default:
        return new Array(cs.ncomp).fill(0);
    }
  }

  // ── パス ──
  needCP(): [number, number] {
    if (!this.g.cp) throw new PSError('nocurrentpoint');
    return this.g.cp;
  }
  /**
   * 現在のパスを書き換える前に呼ぶ: gsave・save・gstate で共有している配列なら写してから返す (copy-on-write)。
   * 長いパスを作りながら gsave を繰り返す EPS で、gsave ごとにパス全体を写さない
   */
  ownPath(): Seg[] {
    let p = this.g.path;
    if ((PATH_HOLDERS.get(p) ?? 1) > 1) {
      this.countCopy(p.length);
      releasePath(p);
      p = p.slice();
      this.g.path = p;
    }
    return p;
  }
  /** グラフィックス状態を手放す (パスの共有の数を減らす) */
  discard(g: GState) {
    releasePath(g.path);
  }
  moveTo(x: number, y: number) {
    const [dx, dy] = apply(this.g.ctm, x, y);
    this.countPoints(1);
    const p = this.ownPath();
    if (p.length && p[p.length - 1].op === 'M') p.pop();
    p.push({ op: 'M', x: dx, y: dy });
    this.g.cp = [dx, dy];
    this.g.sp = [dx, dy];
  }
  lineToDev(dx: number, dy: number) {
    this.needCP();
    this.countPoints(1);
    this.ownPath().push({ op: 'L', x: dx, y: dy });
    this.g.cp = [dx, dy];
  }
  curveToDev(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.needCP();
    this.countPoints(1);
    this.ownPath().push({ op: 'C', x1, y1, x2, y2, x: x3, y: y3 });
    this.g.cp = [x3, y3];
  }
  closePath() {
    if (!this.g.cp || !this.g.path.length) return;
    const last = this.g.path[this.g.path.length - 1];
    if (last.op === 'Z') return;
    this.countPoints(1);
    this.ownPath().push({ op: 'Z' });
    if (this.g.sp) this.g.cp = this.g.sp;
  }
  /** 円弧 (§8.2 arc・arcn)。ユーザ空間で 90 度以下に分けてベジェにする */
  arc(cx: number, cy: number, r: number, a1: number, a2: number, neg: boolean) {
    const rad = (a: number) => (a * Math.PI) / 180;
    if (![cx, cy, r, a1, a2].every(Number.isFinite)) return;
    // ang2 は ang1 以上 (arcn では以下) になるまで 360 の倍数を足す (PLRM §8.2)。1 周を超える分は見た目が同じなので 1 周に畳む
    // (巨大な角度で分割の数が爆発しない・while が止まらなくならないように)
    let sweep = (a2 - a1) % 360;
    if (!neg && sweep < 0) sweep += 360;
    if (neg && sweep > 0) sweep -= 360;
    if (sweep === 0 && a2 !== a1) sweep = neg ? -360 : 360;
    a2 = a1 + sweep;
    const sx = cx + r * Math.cos(rad(a1));
    const sy = cy + r * Math.sin(rad(a1));
    const [dx, dy] = apply(this.g.ctm, sx, sy);
    if (this.g.cp) this.lineToDev(dx, dy);
    else this.moveTo(sx, sy);
    const total = a2 - a1;
    const n = Math.max(1, Math.ceil(Math.abs(total) / 90 - 1e-9));
    const step = total / n;
    for (let k = 0; k < n; k++) {
      const t1 = rad(a1 + step * k);
      const t2 = rad(a1 + step * (k + 1));
      const h = ((4 / 3) * Math.tan((t2 - t1) / 4)) * r;
      const p1 = [cx + r * Math.cos(t1) - h * Math.sin(t1), cy + r * Math.sin(t1) + h * Math.cos(t1)];
      const p2 = [cx + r * Math.cos(t2) + h * Math.sin(t2), cy + r * Math.sin(t2) - h * Math.cos(t2)];
      const p3 = [cx + r * Math.cos(t2), cy + r * Math.sin(t2)];
      const m = this.g.ctm;
      const [x1, y1] = apply(m, p1[0], p1[1]);
      const [x2, y2] = apply(m, p2[0], p2[1]);
      const [x3, y3] = apply(m, p3[0], p3[1]);
      this.curveToDev(x1, y1, x2, y2, x3, y3);
    }
  }
  /** ユーザ空間の現在の点 */
  userCP(): [number, number] {
    const cp = this.needCP();
    const inv = invert(this.g.ctm);
    if (!inv) throw new PSError('undefinedresult');
    return apply(inv, cp[0], cp[1]);
  }

  // ── 描く ──
  fill(evenOdd: boolean) {
    const segs = this.g.path;
    if (segs.some((s) => s.op !== 'M') && !this.invisible()) {
      if (this.g.cs.family === 'Pattern') this.patternFill(segs, evenOdd);
      else {
        // 描画の並びに写すパスの点にも上限を置く ({ gsave fill grestore } loop が、メモリを使い切る前に limitcheck にする)
        this.countItem(segs.length);
        this.items.push({ k: 'fill', segs: segs.slice(), evenOdd, color: this.currentRGB(), cmyk: this.currentCMYK(), clip: this.g.clip });
      }
    }
    this.newPath();
  }
  stroke() {
    const segs = this.g.path;
    if (segs.some((s) => s.op !== 'M') && !this.invisible()) {
      const g = this.g;
      if (g.cs.family === 'Pattern') {
        // 模様の線: 線の輪郭 (太さを持った形) を求めて、その形を模様で塗る
        const outline = strokeOutline(segs, g.ctm, g.lineWidth, g.cap, g.join, g.dash, g.miter);
        if (outline.length) shadePatternFill(this, outline, false);
      } else {
        this.countItem(segs.length);
        this.items.push({
          k: 'stroke',
          segs: segs.slice(),
          color: this.currentRGB(),
          cmyk: this.currentCMYK(),
          lineWidth: g.lineWidth,
          cap: g.cap,
          join: g.join,
          miter: g.miter,
          dash: g.dash.array.length ? { array: g.dash.array.slice(), offset: g.dash.offset } : undefined,
          ctm: [...g.ctm] as Mat,
          clip: g.clip,
        });
      }
    }
    this.newPath();
  }
  patternFill(segs: Seg[], evenOdd: boolean) {
    shadePatternFill(this, segs, evenOdd);
  }
  newPath() {
    releasePath(this.g.path);
    this.g.path = [];
    this.g.cp = undefined;
    this.g.sp = undefined;
  }
  clip(evenOdd: boolean) {
    // クリップは描いたあとも現在のパスを残す (§8.2 clip)
    this.countItem(this.g.path.length);
    const segs = this.g.path.slice();
    this.g.clip = { segs, evenOdd, parent: this.g.clip };
  }
  /** 現在のクリップのパス (無ければ外接矩形) */
  clipPathSegs(): Seg[] {
    if (this.g.clip) return this.g.clip.segs.slice();
    const [x0, y0, x1, y1] = this.opts.bbox;
    return [
      { op: 'M', x: x0, y: y0 },
      { op: 'L', x: x1, y: y0 },
      { op: 'L', x: x1, y: y1 },
      { op: 'L', x: x0, y: y1 },
      { op: 'Z' },
    ];
  }
}

// ───────────────────────── 演算子 ─────────────────────────

function installGraphicsOperators(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  installStateOperators(I, G);
  installMatrixOperators(I, G);
  installPathOperators(I, G);
  installImageOperators(I, G);

  // 機器 (§6): EPS の中では何もしない (EPSF 3.0 §3.2 showpage は取り込む側で空にする)
  d('showpage', () => {});
  d('copypage', () => {});
  d('setpagedevice', (I) => void I.pop());
  d('currentpagedevice', (I) => {
    const pd = I.newDict(4);
    const [x0, y0, x1, y1] = G.opts.bbox;
    pd.put('PageSize', arr([real(x1 - x0), real(y1 - y0)]));
    pd.put('HWResolution', arr([real(72), real(72)]));
    pd.put('Policies', dictObj(I.newDict()));
    pd.put('InputAttributes', dictObj(I.newDict()));
    pd.put('OutputAttributes', dictObj(I.newDict()));
    pd.put('ProcessColorModel', name('DeviceCMYK'));
    I.push(dictObj(pd));
  });
  d('nulldevice', () => {});
  d('framedevice', (I) => {
    for (let k = 0; k < 4; k++) I.pop();
  });
  d('banddevice', (I) => {
    for (let k = 0; k < 4; k++) I.pop();
  });
  d('renderbands', (I) => void I.pop());
  d('wtranslation', (I) => {
    I.push(real(0));
    I.push(real(0));
  });

  // 資源 (§3.9)
  d('findresource', (I) => resourceOp(I, 'FindResource', 1));
  d('defineresource', (I) => resourceOp(I, 'DefineResource', 2));
  d('undefineresource', (I) => resourceOp(I, 'UndefineResource', 1));
  d('resourcestatus', (I) => resourceOp(I, 'ResourceStatus', 1));
  d('resourceforall', (I) => resourceOp(I, 'ResourceForAll', 3));

  // 書体 (第 5 章)。いまは字を描かず、送りだけを進める
  installFontStubs(I, G);
  installResources(I, { makeCIDInit, makeFontSetInit });

  // 形 (form。§4.7)
  d('execform', (I) => {
    const f = I.popDict();
    const pp = f.get('PaintProc');
    const m = f.get('Matrix');
    const saved = G.copy(G.g);
    if (m && m.t === 'array') G.g.ctm = mul(G.g.ctm, readMatrix(m));
    const bb = f.get('BBox');
    if (bb && bb.t === 'array' && bb.n === 4) {
      const v = arrItems(bb).map((o) => (o.t === 'int' || o.t === 'real' ? o.v : 0));
      G.newPath();
      appendRects(G, [[v[0], v[1], v[2] - v[0], v[3] - v[1]]]);
      G.clip(false);
      G.newPath();
    }
    I.push(dictObj(f));
    if (pp) I.call(pp);
    G.g = saved;
  });

  // 取るオペランドの個数 (PLRM の演算子の形から)。色を読む・塗る演算子 (currentgray・fill・rectfill など。濃度の手続きを呼びうる) と、
  // 画像・手続きを実行するものには付けない
  I.operandCounts({
    gsave: 0, grestore: 0, grestoreall: 0, initgraphics: 0, gstate: 0, currentgstate: 1, setgstate: 1,
    setlinewidth: 1, currentlinewidth: 0, setlinecap: 1, currentlinecap: 0, setlinejoin: 1, currentlinejoin: 0,
    setmiterlimit: 1, currentmiterlimit: 0, setdash: 2, currentdash: 0, setflat: 1, currentflat: 0,
    setstrokeadjust: 1, currentstrokeadjust: 0, setoverprint: 1, currentoverprint: 0, setsmoothness: 1, currentsmoothness: 0,
    setgray: 1, setrgbcolor: 3, sethsbcolor: 3, setcmykcolor: 4, currentcolorspace: 0,
    settransfer: 1, currenttransfer: 0, setblackgeneration: 1, currentblackgeneration: 0, setundercolorremoval: 1, currentundercolorremoval: 0,
    sethalftone: 1, currenthalftone: 0, setcolorrendering: 1, currentcolorrendering: 0,
    matrix: 0, initmatrix: 0, identmatrix: 1, defaultmatrix: 1, currentmatrix: 1, setmatrix: 1,
    translate: 3, scale: 3, rotate: 2, concat: 1, concatmatrix: 3, invertmatrix: 2,
    transform: 3, dtransform: 3, itransform: 3, idtransform: 3,
    newpath: 0, currentpoint: 0, moveto: 2, rmoveto: 2, lineto: 2, rlineto: 2, curveto: 6, rcurveto: 6, closepath: 0,
    arc: 5, arcn: 5, arct: 5, arcto: 5, flattenpath: 0, reversepath: 0, strokepath: 0, clippath: 0, pathbbox: 0,
    initclip: 0, clip: 0, eoclip: 0, clipsave: 0, cliprestore: 0, rectclip: 4,
    showpage: 0, copypage: 0, setpagedevice: 1, currentpagedevice: 0, nulldevice: 0, renderbands: 1,
  });
}
