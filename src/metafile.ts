/**
 * metafile — Windows のメタファイル (WMF・EMF) の描画命令を読み、SVG にする。
 *
 * SVG にすれば、画面 (ブラウザの SVG の描画) と PDF (svg.ts のベクター出力) の両方に、そのまま流せる。
 * 対応: 座標系 (window の原点・大きさ、EMF の世界変換)、ペン・ブラシ・フォントの作成と選択・削除、線・多角形・複数の多角形・
 * 矩形・角丸矩形・楕円・弧・弦・扇形・パス (EMF)、文字 (揃え・色・回転・太さ・斜体)、塗りの規則、状態の保存と復元、
 * 切り抜き (矩形・領域・パス)、領域の塗り、画素、画像 (DIB。描き先に依らないラスター演算のもの)。
 * ハッチの模様・模様のブラシ・描き先と混ぜるラスター演算・EMF+ (GDI コメント) は扱わない (描かずに飛ばす)。
 */
import { decodeBmp, encodePngStored, expandRle, type Pixels } from './pixels';
import { MAX_PIXELS, METAFILE_TOTAL_IMAGE_PIXELS } from './imageLimits';
import { apply as applyXf, isIdentity, mul, type Matrix } from './matrix';
import { base64 } from './base64';
import { flattenPath, polyBool, ringsPath, type Rings } from './regionBool';

interface Pen {
  kind: 'pen';
  none: boolean;
  width: number;
  color: string;
  /** PenStyle ([MS-WMF] 2.1.1.23・[MS-EMF] 2.1.25) の値 (線の種類・端・角の組み合わせ) */
  style?: number;
  /** PS_USERSTYLE の破線と空きの長さ ([MS-EMF] 2.2.20 の StyleEntry。論理単位) */
  dash?: number[];
}

/** PenStyle から、SVG の線の端・角・破線の指定 */
function penStyleAttrs(p: Pen, miter: number | undefined): string {
  const st = p.style ?? 0;
  // 端: PS_ENDCAP_SQUARE (0x100)・PS_ENDCAP_FLAT (0x200)、既定 (0) は丸。角: PS_JOIN_BEVEL (0x1000)・PS_JOIN_MITER (0x2000)、既定 (0) は丸
  const cap = (st & 0x0f00) === 0x0100 ? 'square' : (st & 0x0f00) === 0x0200 ? 'butt' : 'round';
  const join = (st & 0xf000) === 0x1000 ? 'bevel' : (st & 0xf000) === 0x2000 ? 'miter' : 'round';
  let a = ` stroke-linejoin="${join}" stroke-linecap="${cap}"`;
  if (join === 'miter' && miter !== undefined && miter >= 1) a += ` stroke-miterlimit="${num(miter)}"`;
  if ((st & 0x0f) === 7 && p.dash?.length && p.dash.some((d) => d > 0)) a += ` stroke-dasharray="${p.dash.map(num).join(' ')}"`;
  return a;
}
interface Brush {
  kind: 'brush';
  none: boolean;
  color: string;
  /**
   * 模様のブラシ (BS_PATTERN・BS_DIBPATTERNPT・モノクロの模様・BS_HATCHED): 使うときの状態 (パレット・背景) で、模様の画素を作る。
   * 不透明度 0 の画素は塗らない
   */
  pattern?: (dc: Dc, out: SvgOut) => Pixels | undefined;
}
interface Font {
  kind: 'font';
  height: number;
  escapement: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  charset: number;
  face: string;
}
interface Region {
  kind: 'region';
  /** 重ならない矩形 (論理座標) */
  rects: Rect[];
}
/** 論理パレット ([MS-WMF] 2.2.1.3)。項は [赤, 緑, 青, Values (PaletteEntryFlag)] */
interface Palette {
  kind: 'palette';
  entries: Array<[number, number, number, number]>;
}
type Obj = Pen | Brush | Font | Region | Palette | { kind: 'other' };

/** 矩形 (left, top, right, bottom。left ≤ right・top ≤ bottom) */
type Rect = [number, number, number, number];
/** 変換 ([MS-EMF] 2.2.28 の XForm: M11, M12, M21, M22, Dx, Dy。x' = M11·x + M21·y + Dx、y' = M12·x + M22·y + Dy) */
type Xf = Matrix;
/** パスによる切り抜きの層 (d は論理座標。m はそのときの世界変換。invert は外側を残す) */
interface ClipLayer {
  d: string;
  evenodd: boolean;
  m?: Xf;
  invert?: boolean;
}
/** 切り抜き: rects (ページの座標の重ならない矩形。無ければ全面) と、paths のすべての共通部分 */
interface Clip {
  rects?: Rect[];
  paths: ClipLayer[];
}

const HUGE = 1e7;
/** 幅 0 のペンの線の太さの目印 (出来上がりの大きさが決まってから、1px 相当の値に置き換える) */
const HAIR = '__kmHair__';
const fmt = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
const normRect = (l: number, t: number, r: number, b: number): Rect => [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)];

/**
 * 領域 (重ならない矩形の集まり) の演算。undefined は全面。op は RegionMode ([MS-EMF] 2.1.29): 1 AND・2 OR・3 XOR・4 DIFF・5 COPY
 */
function regionOp(a: Rect[] | undefined, b: Rect[] | undefined, op: number): Rect[] | undefined {
  if (op === 5) return b;
  const whole: Rect[] = [[-HUGE, -HUGE, HUGE, HUGE]];
  const A = a ?? whole;
  const B = b ?? whole;
  const xs = [...new Set([...A, ...B].flatMap((r) => [r[0], r[2]]))].sort((p, q) => p - q);
  const ys = [...new Set([...A, ...B].flatMap((r) => [r[1], r[3]]))].sort((p, q) => p - q);
  if (xs.length * ys.length > 4e6 || A.length + B.length > 50_000) return a;
  // 格子の 1 マスごとに矩形を線形に探さず (格子 × 矩形数)、行 (y の帯) ごとに、その帯にかかる矩形の x の範囲に印を付ける
  // (矩形の辺はすべて xs にあるので、辺の番号の範囲をそのまま塗れる)。手間は 行数 × 矩形数 + マス数
  const xi = new Map<number, number>();
  xs.forEach((v, i) => xi.set(v, i));
  const cells = xs.length - 1;
  const inA = new Uint8Array(Math.max(cells, 0));
  const inB = new Uint8Array(Math.max(cells, 0));
  const mark = (rs: Rect[], flags: Uint8Array, cy: number) => {
    flags.fill(0);
    for (const r of rs) {
      if (!(r[1] <= cy && cy < r[3])) continue;
      const i1 = xi.get(r[2])!;
      for (let i = xi.get(r[0])!; i < i1; i++) flags[i] = 1;
    }
  };
  const out: Rect[] = [];
  let prev = new Map<string, Rect>();
  for (let j = 0; j + 1 < ys.length; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    mark(A, inA, cy);
    mark(B, inB, cy);
    const row: Rect[] = [];
    for (let i = 0; i < cells; i++) {
      const p = inA[i] === 1;
      const q = inB[i] === 1;
      const v = op === 1 ? p && q : op === 2 ? p || q : op === 3 ? p !== q : p && !q;
      if (!v) continue;
      const last = row[row.length - 1];
      if (last && last[2] === xs[i]) last[2] = xs[i + 1];
      else row.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
    }
    // 上の行と左右が同じ矩形はつなげる
    const next = new Map<string, Rect>();
    for (const r of row) {
      const key = `${r[0]},${r[2]}`;
      const up = prev.get(key);
      if (up && up[3] === r[1]) {
        up[3] = r[3];
        next.set(key, up);
      } else {
        out.push(r);
        next.set(key, r);
      }
    }
    prev = next;
  }
  return out;
}
const rectsPath = (rs: Rect[]) => rs.map((r) => `M${fmt(r[0])} ${fmt(r[1])}H${fmt(r[2])}V${fmt(r[3])}H${fmt(r[0])}Z`).join('');

interface Dc {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  textAlign: number;
  fillRule: 'evenodd' | 'nonzero';
  x: number;
  y: number;
  winOrg: [number, number];
  winExt?: [number, number];
  /** 背景の塗り方 (MixMode: 1 TRANSPARENT・2 OPAQUE) と背景色 (SETBKCOLOR があったときだけ) */
  bkMode?: number;
  bkColor?: string;
  /** EMR_SETMITERLIMIT の値 */
  miterLimit?: number;
  /** 世界の座標 → ページの座標の変換 (EMF。無ければ恒等) */
  xf?: Xf;
  /** 切り抜き (無ければ全面) */
  clip?: Clip;
  /** 弧の向きが時計回り (EMR_SETARCDIRECTION の AD_CLOCKWISE。既定は反時計回り) */
  arcCw?: boolean;
  /** 今の論理パレット */
  palette?: Palette;
  /** ブラシの原点 (EMR_SETBRUSHORGEX。論理座標) */
  brushOrg?: [number, number];
  /** 写像モード (WMF の META_SETMAPMODE。[MS-WMF] 2.1.1.16 MapMode) と viewport の大きさ */
  mapMode?: number;
  vpExt?: [number, number];
}

const BLACK_PEN: Pen = { kind: 'pen', none: false, width: 0, color: '#000000' };
const WHITE_BRUSH: Brush = { kind: 'brush', none: false, color: '#ffffff' };
const DEFAULT_FONT: Font = {
  kind: 'font',
  height: 12,
  escapement: 0,
  weight: 400,
  italic: false,
  underline: false,
  charset: 0,
  face: 'sans-serif',
};

const colorRef = (v: number) => `#${[v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => (Math.round(v * 100) / 100).toString();

/** 文字集合 (LOGFONT の lfCharSet) → TextDecoder の名前 */
function decoderFor(charset: number): TextDecoder {
  const label = charset === 128 ? 'shift_jis' : charset === 134 ? 'gbk' : charset === 136 ? 'big5' : charset === 129 ? 'euc-kr' : 'windows-1252';
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('latin1');
  }
}

/** 書体名 → SVG の font-family (日本語の書体名には、総称の書体を添える) */
function family(face: string): string {
  const generic = /ゴシック|Gothic|Arial|Helvetica|Sans/i.test(face) ? 'sans-serif' : 'serif';
  return face ? `'${face.replace(/'/g, '')}', ${generic}` : generic;
}

class SvgOut {
  parts: string[] = [];
  dc: Dc;
  stack: Dc[] = [];
  /** パス (EMF の BEGINPATH〜ENDPATH) を集めている途中 */
  path: string | null = null;
  /** この文書で画素にできる残りの数 (imageLimits.ts の METAFILE_TOTAL_IMAGE_PIXELS)。足りなければ false (その画像は描かない) */
  private pixelsLeft = METAFILE_TOTAL_IMAGE_PIXELS;
  takePixels(n: number): boolean {
    if (n > this.pixelsLeft) return false;
    this.pixelsLeft -= n;
    return true;
  }
  constructor() {
    this.dc = {
      pen: BLACK_PEN,
      brush: WHITE_BRUSH,
      font: DEFAULT_FONT,
      textColor: '#000000',
      textAlign: 0,
      fillRule: 'evenodd',
      x: 0,
      y: 0,
      winOrg: [0, 0],
    };
  }
  save() {
    this.stack.push({ ...this.dc });
  }
  restore(n = -1) {
    // n < 0: 直近から |n| 番目の保存へ戻る
    const k = this.stack.length + n;
    if (k < 0 || k >= this.stack.length) return;
    this.dc = this.stack[k];
    this.stack.length = k;
  }
  strokeAttrs(): string {
    const p = this.dc.pen;
    if (p.none) return 'stroke="none"';
    // 幅は論理単位 (PS_COSMETIC の幅 1 も 1 論理単位: [MS-EMF] 2.1.25)。幅 0 は細い線 (出来上がりの 1px。finish で決める)
    return `stroke="${p.color}" stroke-width="${p.width > 0 ? num(p.width) : HAIR}"${penStyleAttrs(p, this.dc.miterLimit)}`;
  }
  fillAttrs(): string {
    const paint = this.paintOf(this.dc.brush);
    return paint ? `fill="${paint}" fill-rule="${this.dc.fillRule}"` : 'fill="none"';
  }

  // ── 模様のブラシ ──
  /**
   * 装置の 1 画素の大きさ (ページの座標。横・縦)。模様のタイルは装置の画素で敷き詰める。vb は出来上がりの viewBox。
   * 決まらなければ undefined (そのときは模様で塗らない)
   */
  pixelSize?: (vb: [number, number, number, number]) => [number, number] | undefined;
  private patterns: Array<{ id: string; px: Pixels; org: [number, number]; xf?: Xf; size?: [number, number] }> = [];
  /** ブラシの塗り (色・模様の url)。塗らないなら undefined */
  paintOf(b: Brush): string | undefined {
    if (b.none) return undefined;
    if (!b.pattern) return b.color;
    const px = b.pattern(this.dc, this);
    if (!px) return undefined;
    // WMF: 写像モードから決まるなら、使うときの値で決める (MM_TEXT は 1 論理単位が 1 画素。[MS-WMF] 2.1.1.16)
    let size: [number, number] | undefined;
    if (this.dc.mapMode !== undefined) {
      const w = this.dc.winExt;
      const v = this.dc.vpExt;
      if (this.dc.mapMode === 1) size = [1, 1];
      else if ((this.dc.mapMode === 7 || this.dc.mapMode === 8) && w && v && v[0] && v[1]) size = [Math.abs(w[0] / v[0]), Math.abs(w[1] / v[1])];
      else return undefined;
    } else if (!this.pixelSize) return undefined;
    const org = this.dc.brushOrg ?? [0, 0];
    const xf = isIdentity(this.dc.xf) ? undefined : this.dc.xf;
    const id = `kmMfPat${this.patterns.length + 1}`;
    this.patterns.push({ id, px, org: xf ? applyXf(xf, org[0], org[1]) : [org[0], org[1]], ...(xf ? { xf } : {}), ...(size ? { size } : {}) });
    return `url(#${id})`;
  }
  /** 模様の定義 (pattern。ページの座標で、装置の画素のタイルを敷き詰める。中身は色ごとの矩形) */
  private patternDefs(vb: [number, number, number, number]): string {
    let out = '';
    for (const pt of this.patterns) {
      const sz = pt.size ?? this.pixelSize?.(vb);
      if (!sz) continue;
      const [tx, ty] = sz;
      const { width: W, height: H, rgba } = pt.px;
      const byColor = new Map<string, string>();
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; ) {
          const o = (y * W + x) * 4;
          const c = `#${[rgba[o], rgba[o + 1], rgba[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          let e = x + 1;
          while (e < W && rgba[(y * W + e) * 4] === rgba[o] && rgba[(y * W + e) * 4 + 1] === rgba[o + 1] && rgba[(y * W + e) * 4 + 2] === rgba[o + 2] && rgba[(y * W + e) * 4 + 3] === rgba[o + 3]) e++;
          if (!rgba[o + 3]) {
            x = e;
            continue;
          }
          byColor.set(c, (byColor.get(c) ?? '') + `M${fmt(x * tx)} ${fmt(y * ty)}H${fmt(e * tx)}V${fmt((y + 1) * ty)}H${fmt(x * tx)}Z`);
          x = e;
        }
      // 要素の座標は論理座標 (世界変換の組の中) なので、patternTransform で世界変換を戻す
      let tr = '';
      if (pt.xf) {
        const m = pt.xf;
        const det = m[0] * m[3] - m[1] * m[2];
        if (!det) continue;
        const inv: Xf = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
        tr = ` patternTransform="matrix(${inv.map(fmt).join(' ')})"`;
      }
      out += `<pattern id="${pt.id}" patternUnits="userSpaceOnUse" x="${fmt(pt.org[0])}" y="${fmt(pt.org[1])}" width="${fmt(W * tx)}" height="${fmt(H * ty)}"${tr}>${[...byColor].map(([c, d]) => `<path d="${d}" fill="${c}"/>`).join('')}</pattern>`;
    }
    return out ? `<defs>${out}</defs>` : '';
  }

  // ── 描き先と混ぜる画像の転送 (SRCAND と SRCINVERT の組) ──
  /** まだ描いていない SRCAND (次の記録が同じ所への SRCINVERT なら、組にして透明の画像にする) */
  pending?: { dst: [number, number, number, number]; px: Pixels; clip?: Clip; xf?: Xf; flush: () => void };
  flushPending() {
    const f = this.pending;
    if (!f) return;
    this.pending = undefined;
    const saved = { clip: this.dc.clip, xf: this.dc.xf };
    this.dc.clip = f.clip;
    this.dc.xf = f.xf;
    f.flush();
    this.dc.clip = saved.clip;
    this.dc.xf = saved.xf;
  }
  shape(d: string, fill: boolean) {
    if (this.path !== null) {
      this.path += d;
      return;
    }
    this.emit(`<path d="${d}" ${fill ? this.fillAttrs() : 'fill="none"'} ${this.strokeAttrs()}/>`);
  }
  poly(pts: number[][], close: boolean) {
    if (!pts.length) return '';
    return `M${pts.map((p) => `${num(p[0])} ${num(p[1])}`).join('L')}${close ? 'Z' : ''}`;
  }
  /**
   * PS_INSIDEFRAME (6) のペン: 外接矩形をとる図形は、ペンの太さを含めて矩形の中に収まるよう、太さの半分だけ縮める ([MS-WMF] 2.1.1.23)
   */
  inset(l: number, t: number, r: number, b: number): [number, number, number, number] {
    const p = this.dc.pen;
    if (p.none || ((p.style ?? 0) & 0x0f) !== 6 || p.width <= 0) return [l, t, r, b];
    const h = p.width / 2;
    const [x0, x1] = l <= r ? [l + h, r - h] : [l - h, r + h];
    const [y0, y1] = t <= b ? [t + h, b - h] : [t - h, b + h];
    return [x0, y0, x1, y1];
  }
  rect(l0: number, t0: number, r0: number, b0: number, fill = true) {
    const [l, t, r, b] = this.inset(l0, t0, r0, b0);
    this.shape(`M${num(l)} ${num(t)}H${num(r)}V${num(b)}H${num(l)}Z`, fill);
  }
  private gradSeq = 0;
  /** 色を変えながら塗る矩形 (EMR_GRADIENTFILL の矩形。vertical なら上から下、そうでなければ左から右へ c0 から c1 に変える) */
  gradientRect(x0: number, y0: number, x1: number, y1: number, c0: string, c1: string, vertical: boolean) {
    const id = `kmMfGrad${++this.gradSeq}`;
    const [ax, bx] = vertical ? [x0, x0] : [x0, x1];
    const [ay, by] = vertical ? [y0, y1] : [y0, y0];
    this.emit(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(ax)}" y1="${num(ay)}" x2="${num(bx)}" y2="${num(by)}"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>` +
        `<path d="M${num(x0)} ${num(y0)}H${num(x1)}V${num(y1)}H${num(x0)}Z" fill="url(#${id})"/>`,
    );
  }
  /** 枠を描かず、一つの色で塗る多角形 (EMR_GRADIENTFILL の三角形を分けたもの) */
  solidPolygon(pts: number[][], color: string) {
    this.emit(`<path d="${this.poly(pts, true)}" fill="${color}" stroke="${color}" stroke-width="0.25"/>`);
  }
  ellipse(l0: number, t0: number, r0: number, b0: number) {
    const [l, t, r, b] = this.inset(l0, t0, r0, b0);
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const rx = Math.abs(r - l) / 2;
    const ry = Math.abs(b - t) / 2;
    this.shape(`M${num(cx - rx)} ${num(cy)}A${num(rx)} ${num(ry)} 0 1 0 ${num(cx + rx)} ${num(cy)}A${num(rx)} ${num(ry)} 0 1 0 ${num(cx - rx)} ${num(cy)}Z`, true);
  }
  roundRect(l0: number, t0: number, r0: number, b0: number, w: number, h: number) {
    const [l, t, r, b] = this.inset(l0, t0, r0, b0);
    const rx = Math.min(Math.abs(w) / 2, Math.abs(r - l) / 2);
    const ry = Math.min(Math.abs(h) / 2, Math.abs(b - t) / 2);
    this.shape(
      `M${num(l + rx)} ${num(t)}H${num(r - rx)}A${num(rx)} ${num(ry)} 0 0 1 ${num(r)} ${num(t + ry)}V${num(b - ry)}A${num(rx)} ${num(ry)} 0 0 1 ${num(r - rx)} ${num(b)}H${num(l + rx)}A${num(rx)} ${num(ry)} 0 0 1 ${num(l)} ${num(b - ry)}V${num(t + ry)}A${num(rx)} ${num(ry)} 0 0 1 ${num(l + rx)} ${num(t)}Z`,
      true,
    );
  }
  lineTo(x: number, y: number) {
    if (this.path !== null) this.path += `L${num(x)} ${num(y)}`;
    else this.emit(`<path d="M${num(this.dc.x)} ${num(this.dc.y)}L${num(x)} ${num(y)}" fill="none" ${this.strokeAttrs()}/>`);
    this.dc.x = x;
    this.dc.y = y;
  }
  moveTo(x: number, y: number) {
    if (this.path !== null) this.path += `M${num(x)} ${num(y)}`;
    this.dc.x = x;
    this.dc.y = y;
  }
  private clipSeq = 0;
  /**
   * 文字の記録の矩形 (ExtTextOutOptions: [MS-WMF] 2.1.2.2): ETO_OPAQUE (2) は矩形を背景色で塗り、ETO_CLIPPED (4) は字を矩形で切り抜く。
   * 背景色は SETBKCOLOR の値 (再生の初期値は環境による ([MS-WMF] 3.1.5) ので、指定が無ければ塗らない)
   */
  textBox(rect: [number, number, number, number] | undefined, opts: number, draw: () => void) {
    if (!rect) return draw();
    const [l, t, r, b] = rect;
    const x0 = Math.min(l, r);
    const y0 = Math.min(t, b);
    const w = Math.abs(r - l);
    const h = Math.abs(b - t);
    if (opts & 2 && this.dc.bkColor && w > 0 && h > 0) this.emit(`<rect x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}" fill="${this.dc.bkColor}" stroke="none"/>`);
    if (!(opts & 4) || w <= 0 || h <= 0) return draw();
    const id = `kmMfClip${++this.clipSeq}`;
    this.emit(`<clipPath id="${id}"><rect x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}"/></clipPath><g clip-path="url(#${id})">`);
    draw();
    this.emit('</g>');
  }

  /**
   * 文字を描く。dx があれば、i 番目の字の原点から i + 1 番目の字の原点までの距離 (論理単位。[MS-WMF] 2.3.3.5 の Dx・
   * [MS-EMF] 2.2.5 の OutputDx)。dy は縦の距離 (EMF の ETO_PDY)。揃え (TA_CENTER・TA_RIGHT) は送りの合計の幅で決める
   */
  text(x: number, y: number, s: string, dx?: number[], dy?: number[]) {
    if (!s) return;
    const chars = Array.from(s);
    if (dx && dx.length >= chars.length && chars.length > 1) {
      const total = dx.slice(0, chars.length - 1).reduce((t, d) => t + d, 0) + dx[chars.length - 1];
      const a = this.dc.textAlign;
      const start = (a & 6) === 6 ? x - total / 2 : (a & 6) === 2 ? x - total : x;
      const saved = this.dc.textAlign;
      this.dc.textAlign = a & ~6; // 字ごとに左揃えで置く
      let cx = start;
      let cy = y;
      chars.forEach((ch, i) => {
        this.textAt(cx, cy, ch, x, y);
        cx += dx[i];
        if (dy) cy += dy[i] ?? 0;
      });
      this.dc.textAlign = saved;
      return;
    }
    this.textAt(x, y, s, x, y);
  }

  /** 文字を (x, y) に置く。回転 (escapement) の中心は (rx, ry) */
  private textAt(x: number, y: number, s: string, rx: number, ry: number) {
    const f = this.dc.font;
    const size = Math.abs(f.height) || 12;
    // 文字の高さ: 正はセルの高さ (行間を含む)、負は字の高さ。セルの高さは字の高さのおよそ 1.15 倍
    const em = f.height > 0 ? size / 1.15 : size;
    const a = this.dc.textAlign;
    const anchor = (a & 6) === 6 ? 'middle' : (a & 6) === 2 ? 'end' : 'start';
    // 縦の揃え: TA_BASELINE (24) は基線、TA_BOTTOM (8) は下端、既定 (TA_TOP) は上端
    const dy = (a & 24) === 24 ? 0 : (a & 8) === 8 ? -em * 0.12 : em * 0.88;
    const rot = f.escapement ? ` transform="rotate(${num(-f.escapement / 10)} ${num(rx)} ${num(ry)})"` : '';
    const style = `${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${f.underline ? ' text-decoration="underline"' : ''}`;
    this.emit(
      `<text x="${num(x)}" y="${num(y + dy)}" font-family="${esc(family(f.face))}" font-size="${num(em)}" fill="${this.dc.textColor}" text-anchor="${anchor}"${style}${rot} xml:space="preserve">${esc(s)}</text>`,
    );
  }
  // ── 出力の組 (切り抜き・世界変換) ──
  // 開いている組の鍵は、切り抜き・世界変換の中身を文字列にしたもの。切り抜き (dc.clip) と世界変換 (dc.xf) は、変えるときに必ず
  // 新しい値に置き換える (中身を書き換えない) ので、文字列は値ごとに 1 度だけ作って覚える (描くたびに作ると、矩形の多い切り抜きの下で
  // 描く数 × 切り抜きの大きさの手間になる)。置き換えた後の中身が前と同じなら、鍵も同じなので、組は開き直さない (出力は変わらない)
  private openClipKey = '';
  private openXfKey = '';
  private keys = new WeakMap<object, string>();
  private keyOf(o: object | undefined): string {
    if (!o) return '';
    let k = this.keys.get(o);
    if (k === undefined) this.keys.set(o, (k = JSON.stringify(o)));
    return k;
  }
  private openDepth = 0;
  private layerSeq = 0;
  /** 要素を出す。切り抜きか世界変換が前の要素と違えば、組 (g) を閉じて開き直す */
  emit(el: string) {
    if (this.pending) this.flushPending();
    const c = this.dc.clip;
    if (c?.rects && c.rects.length === 0) return; // 空の切り抜き: 何も見えない
    const xf = isIdentity(this.dc.xf) ? undefined : this.dc.xf;
    const clipKey = this.keyOf(c);
    const xfKey = this.keyOf(xf);
    if (clipKey !== this.openClipKey || xfKey !== this.openXfKey) {
      this.closeGroups();
      this.openClipKey = clipKey;
      this.openXfKey = xfKey;
      const layers: string[] = [];
      if (c?.rects) layers.push(`<path d="${rectsPath(c.rects)}"/>`);
      for (const l of c?.paths ?? []) {
        let d = l.d;
        if (l.invert) {
          // 外側: ページの座標の大きな矩形を、層の座標 (論理座標) に戻して足し、偶奇の規則で抜く
          const m = l.m ?? [1, 0, 0, 1, 0, 0];
          const det = m[0] * m[3] - m[1] * m[2];
          if (!det) continue;
          const inv = (x: number, y: number) => {
            const u = x - m[4];
            const v = y - m[5];
            return [(m[3] * u - m[2] * v) / det, (-m[1] * u + m[0] * v) / det];
          };
          const q = [inv(-HUGE, -HUGE), inv(HUGE, -HUGE), inv(HUGE, HUGE), inv(-HUGE, HUGE)];
          d = `M${q.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}Z${d}`;
        }
        const tr = l.m && !isIdentity(l.m) ? ` transform="matrix(${l.m.map(fmt).join(' ')})"` : '';
        layers.push(`<path d="${d}" clip-rule="${l.evenodd || l.invert ? 'evenodd' : 'nonzero'}"${tr}/>`);
      }
      for (const body of layers) {
        const id = `kmMfRgn${++this.layerSeq}`;
        this.parts.push(`<clipPath id="${id}">${body}</clipPath><g clip-path="url(#${id})">`);
        this.openDepth++;
      }
      if (xf) {
        this.parts.push(`<g transform="matrix(${xf.map(fmt).join(' ')})">`);
        this.openDepth++;
      }
    }
    this.parts.push(el);
  }
  closeGroups() {
    for (; this.openDepth > 0; this.openDepth--) this.parts.push('</g>');
    this.openClipKey = '';
    this.openXfKey = '';
  }

  // ── 切り抜き ([MS-WMF] 2.3.5・[MS-EMF] 2.3.2) ──
  /** 論理座標の矩形の集まり → 世界変換が軸に沿うならページの座標の矩形、そうでなければパスの層 */
  private shapeOf(rs: Rect[]): { rects: Rect[] } | { layer: ClipLayer } {
    const m = this.dc.xf;
    if (!m || (m[1] === 0 && m[2] === 0)) {
      return {
        rects: rs.map((r) => {
          const [x0, y0] = m ? applyXf(m, r[0], r[1]) : [r[0], r[1]];
          const [x1, y1] = m ? applyXf(m, r[2], r[3]) : [r[2], r[3]];
          return normRect(x0, y0, x1, y1);
        }),
      };
    }
    return { layer: { d: rectsPath(rs), evenodd: false, m } };
  }
  /** 切り抜きに、矩形の集まり (論理座標) か、パスの層を組み合わせる。mode は RegionMode (1 AND・2 OR・3 XOR・4 DIFF・5 COPY) */
  combineClip(shape: { rects: Rect[] } | { layer: ClipLayer } | undefined, mode: number) {
    const cur = this.dc.clip;
    if (mode === 5) {
      this.dc.clip = !shape ? undefined : 'rects' in shape ? { rects: shape.rects, paths: [] } : { paths: [shape.layer] };
      return;
    }
    if (!shape) return;
    const paths = cur?.paths ?? [];
    if ('rects' in shape) {
      if (mode === 1 || mode === 4 || !paths.length) {
        this.dc.clip = {
          rects: regionOp(cur?.rects, shape.rects, mode),
          paths,
        };
        return;
      }
    } else if (mode === 1) {
      this.dc.clip = { rects: cur?.rects, paths: [...paths, shape.layer] };
      return;
    } else if (mode === 4) {
      this.dc.clip = {
        rects: cur?.rects,
        paths: [...paths, { ...shape.layer, invert: true }],
      };
      return;
    } else if (!cur) {
      // 全面との OR は全面、XOR は外側
      this.dc.clip = mode === 2 ? undefined : { paths: [{ ...shape.layer, invert: true }] };
      return;
    }
    // パスの層を含む OR・XOR: 今の切り抜きと新しい形を多角形にして演算し、1 つの層 (ページの座標・非ゼロの規則) にする
    const toRings = (rs: Rect[]): Rings =>
      rs.map((r) => [
        [r[0], r[1]],
        [r[2], r[1]],
        [r[2], r[3]],
        [r[0], r[3]],
      ]);
    let acc: Rings = toRings(cur?.rects ?? [[-HUGE, -HUGE, HUGE, HUGE]]);
    for (const l of paths) acc = polyBool(acc, false, flattenPath(l.d, l.m), l.evenodd, l.invert ? 4 : 1);
    const add: [Rings, boolean] = 'rects' in shape ? [toRings(shape.rects), false] : [flattenPath(shape.layer.d, shape.layer.m), shape.layer.evenodd];
    this.dc.clip = { paths: [{ d: ringsPath(polyBool(acc, false, add[0], add[1], mode), fmt), evenodd: false }] };
  }
  clipRects(rs: Rect[], mode: number) {
    this.combineClip(this.shapeOf(rs), mode);
  }
  /** 切り抜きを論理座標で (dx, dy) だけ動かす */
  offsetClip(dx: number, dy: number) {
    const c = this.dc.clip;
    if (!c) return;
    const m = this.dc.xf ?? [1, 0, 0, 1, 0, 0];
    const px = m[0] * dx + m[2] * dy;
    const py = m[1] * dx + m[3] * dy;
    this.dc.clip = {
      rects: c.rects?.map((r) => [r[0] + px, r[1] + py, r[2] + px, r[3] + py] as Rect),
      paths: c.paths.map((l) => ({
        ...l,
        m: mul([1, 0, 0, 1, px, py], l.m ?? [1, 0, 0, 1, 0, 0]),
      })),
    };
  }

  // ── 弧・弦・扇形 ([MS-WMF] 2.3.3.1・2.3.3.2・2.3.3.16、[MS-EMF] 2.3.5.1〜2.3.5.4・2.3.5.15) ──
  /** 装置の座標で反時計回りに描く (既定) ときの SVG の sweep-flag。世界変換が裏返すなら逆 */
  private sweepFlag(cw: boolean): number {
    const m = this.dc.xf;
    const flip = m ? m[0] * m[3] - m[1] * m[2] < 0 : false;
    // 下向きの y の座標では、SVG の sweep-flag 1 が時計回り
    return cw !== flip ? 1 : 0;
  }
  /**
   * 外接矩形と、始まり・終わりの放射線の端点で決まる楕円の弧。kind: arc (線だけ)・chord (弦で閉じて塗る)・pie (中心と結んで塗る)・
   * arcto (現在の位置から始点へ線を引き、終点を現在の位置にする)
   */
  arc(l0: number, t0: number, r0: number, b0: number, xs: number, ys: number, xe: number, ye: number, kind: 'arc' | 'chord' | 'pie' | 'arcto') {
    const [l, t, r, b] = this.inset(l0, t0, r0, b0);
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const rx = Math.abs(r - l) / 2;
    const ry = Math.abs(b - t) / 2;
    if (!rx || !ry) return;
    const a0 = Math.atan2((ys - cy) / ry, (xs - cx) / rx);
    const a1 = Math.atan2((ye - cy) / ry, (xe - cx) / rx);
    const pt = (a: number) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const sweep = this.sweepFlag(!!this.dc.arcCw);
    // 角度は下向きの y で測る。sweep-flag 1 は角度の増える向き
    let delta = sweep ? a1 - a0 : a0 - a1;
    while (delta <= 1e-9) delta += 2 * Math.PI;
    const mid = sweep ? a0 + delta / 2 : a0 - delta / 2;
    const [sx, sy] = pt(a0);
    const [mx, my] = pt(mid);
    const [ex, ey] = pt(a1);
    const arcs = `A${num(rx)} ${num(ry)} 0 0 ${sweep} ${num(mx)} ${num(my)}A${num(rx)} ${num(ry)} 0 0 ${sweep} ${num(ex)} ${num(ey)}`;
    const start = `${num(sx)} ${num(sy)}`;
    if (kind === 'arcto') {
      const d = `${this.path !== null ? '' : `M${num(this.dc.x)} ${num(this.dc.y)}`}L${start}${arcs}`;
      this.shape(d, false);
      this.dc.x = ex;
      this.dc.y = ey;
      return;
    }
    if (kind === 'arc') return this.shape(`M${start}${arcs}`, false);
    if (kind === 'chord') return this.shape(`M${start}${arcs}Z`, true);
    this.shape(`M${num(cx)} ${num(cy)}L${start}${arcs}Z`, true);
  }
  /** EMR_ANGLEARC: 現在の位置から円周の始点へ線、中心・半径・始まりの角度・掃く角度 (度。反時計回り) の円弧 */
  angleArc(cx: number, cy: number, radius: number, startDeg: number, sweepDeg: number) {
    const s = (startDeg * Math.PI) / 180;
    const sw = (Math.max(-360, Math.min(360, sweepDeg)) * Math.PI) / 180;
    // 反時計回り (装置の座標で見て) の角度: 下向きの y では y を引く
    const flip = this.dc.xf ? this.dc.xf[0] * this.dc.xf[3] - this.dc.xf[1] * this.dc.xf[2] < 0 : false;
    const pt = (a: number) => [cx + radius * Math.cos(a), cy - (flip ? -1 : 1) * radius * Math.sin(a)];
    const [sx, sy] = pt(s);
    const [mx, my] = pt(s + sw / 2);
    const [ex, ey] = pt(s + sw);
    const f = sw >= 0 ? (flip ? 1 : 0) : flip ? 0 : 1;
    const R = num(radius);
    const head = this.path !== null ? '' : `M${num(this.dc.x)} ${num(this.dc.y)}`;
    this.shape(`${head}L${num(sx)} ${num(sy)}A${R} ${R} 0 0 ${f} ${num(mx)} ${num(my)}A${R} ${R} 0 0 ${f} ${num(ex)} ${num(ey)}`, false);
    this.dc.x = ex;
    this.dc.y = ey;
  }

  /** 領域 (論理座標の矩形) を色で塗る (線は引かない) */
  /** 領域を塗る (paint は色か模様の url。blend は描画モード) */
  fillRects(rs: Rect[], paint: string | undefined, blend?: string) {
    if (!rs.length || !paint) return;
    this.emit(`<path d="${rectsPath(rs)}" fill="${paint}" stroke="none"${blend ? ` style="mix-blend-mode:${blend}"` : ''}/>`);
  }
  /** 画像を (x, y) から幅 w・高さ h (論理座標。負なら裏返す) に描く。blend は描画モード */
  image(x: number, y: number, w: number, h: number, href: string, blend?: string) {
    if (!w || !h) return;
    this.emit(
      `<image x="0" y="0" width="${fmt(Math.abs(w))}" height="${fmt(Math.abs(h))}" preserveAspectRatio="none" transform="matrix(${Math.sign(w)} 0 0 ${Math.sign(h)} ${fmt(x)} ${fmt(y)})"${blend ? ` style="mix-blend-mode:${blend}"` : ''} href="${href}"/>`,
    );
  }
  toSvg(vb: [number, number, number, number], widthPx: number, heightPx: number): string {
    this.flushPending();
    this.closeGroups();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(widthPx)}" height="${num(heightPx)}" viewBox="${vb.map(num).join(' ')}" preserveAspectRatio="none">${this.patternDefs(vb)}${this.parts.join('')}</svg>`;
  }
}

/**
 * 文字列のバイト列を、字ごとのバイト数にする。文字セットの復号器が 1 バイトだけでは字にできないバイト (2 バイトの文字の
 * 先頭のバイト) なら、次のバイトと合わせて 2 バイトの字とする
 */
function byteLengths(bytes: Uint8Array, charset: number): number[] {
  const label = decoderFor(charset).encoding;
  let strict: TextDecoder;
  try {
    strict = new TextDecoder(label, { fatal: true });
  } catch {
    return Array.from(bytes, () => 1);
  }
  const single = (c: number) => {
    try {
      strict.decode(new Uint8Array([c]));
      return true;
    } catch {
      return false;
    }
  };
  const out: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const len = !single(bytes[i]) && i + 1 < bytes.length ? 2 : 1;
    out.push(len);
    i += len;
  }
  return out;
}

/** 画像の転送の元 (DIB。[MS-WMF] 2.2.2.9) */
interface DibSrc {
  /** 頭 (BitmapInfoHeader・BitmapCoreHeader) の位置 */
  bmi: number;
  /** 画素の位置 (無ければ、頭と色の表のすぐ後ろ: 詰めた DIB) */
  bits?: number;
  /** 画素の終わり (記録の終わり) */
  end: number;
  /** ColorUsage ([MS-WMF] 2.1.1.6): 0 DIB_RGB_COLORS・1 DIB_PAL_COLORS・2 DIB_PAL_INDICES */
  usage: number;
  /** 画素の行の数 (SETDIBITSTODEVICE の cScans。頭の高さより少ないとき) */
  scans?: number;
  /** 32 ビットの画素の 4 バイト目を不透明度として読む (EMR_ALPHABLEND の AC_SRC_ALPHA) */
  alpha?: boolean;
  /** 今の論理パレット (DIB_PAL_COLORS・DIB_PAL_INDICES の番号を色にする) */
  palette?: Palette;
}

/** DIB → 画素 (上から下の行)、または JPEG・PNG の中身。読めなければ (文書の画素の合計の上限 out.takePixels を超えるときも) undefined */
function dibImage(out: SvgOut, b: Uint8Array, s: DibSrc): { px: Pixels } | { mime: string; data: Uint8Array } | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (s.bmi + 12 > s.end) return undefined;
  const hs = v.getUint32(s.bmi, true);
  const core = hs === 12;
  if (!core && (hs < 40 || s.bmi + hs > b.length)) return undefined;
  const w = core ? v.getUint16(s.bmi + 4, true) : v.getInt32(s.bmi + 4, true);
  const h = core ? v.getInt16(s.bmi + 6, true) : v.getInt32(s.bmi + 8, true);
  const bpp = v.getUint16(s.bmi + (core ? 10 : 14), true);
  const comp = core ? 0 : v.getUint32(s.bmi + 16, true);
  const sizeImage = core ? 0 : v.getUint32(s.bmi + 20, true);
  const used = core ? 0 : v.getUint32(s.bmi + 32, true);
  // 色の表 ([MS-WMF] 2.1.1.3 BitCount): 8 ビット以下は ColorUsed (0 なら 2^bpp) 個、BI_BITFIELDS は 3 つの色の覆いが前に付く
  // ColorUsed ([MS-WMF] 2.2.2.3): 8 ビット以下では色の表の項の数で、2^bpp を超えない。どの深さでも、色の表は記録の中に収まる。
  // 欄の値をそのまま信じると、小さな記録で巨大な色の表 (とそれを写す領域) を確保するので、2^bpp と記録の残りで切る
  const maskBytes = comp === 3 && hs === 40 ? 12 : 0;
  // DIB_PAL_COLORS は 16 ビットのパレットの番号、DIB_PAL_INDICES は色の表が無い ([MS-WMF] 2.1.1.6)
  const entryBytes = core ? 3 : s.usage === 1 ? 2 : s.usage === 2 ? 0 : 4;
  const maxEntries = bpp <= 8 ? 1 << bpp : 0;
  const declared = core ? maxEntries : bpp <= 8 ? Math.min(used || maxEntries, maxEntries) : used;
  const entries = entryBytes ? Math.min(declared, Math.max(0, Math.floor((s.end - (s.bmi + hs + maskBytes)) / entryBytes))) : declared;
  const colorBytes = maskBytes + entries * entryBytes;
  const bits = s.bits ?? s.bmi + hs + colorBytes;
  if (comp === 4 || comp === 5) {
    // BI_JPEG・BI_PNG: 画素の場所に JPEG・PNG のファイルがそのまま入る
    const n = sizeImage || s.end - bits;
    return {
      mime: comp === 4 ? 'image/jpeg' : 'image/png',
      data: b.subarray(bits, Math.min(s.end, bits + n)),
    };
  }
  const byPalette = s.usage !== 0 && bpp <= 8;
  if (byPalette && (core || !s.palette)) return undefined;
  const W = Math.abs(w);
  const rows = s.scans ?? Math.abs(h);
  // 画素の数の上限 (ヘッダの寸法だけで大量のメモリ・時間を使わない)
  if (!W || !rows || W * rows > MAX_PIXELS || !out.takePixels(W * rows)) return undefined;
  const stride = Math.floor((bpp * W + 31) / 32) * 4;
  let pixels: Uint8Array;
  let newComp = comp;
  if ((comp === 1 && bpp === 8) || (comp === 2 && bpp === 4)) {
    const n = sizeImage || s.end - bits;
    pixels = expandRle(b.subarray(bits, Math.min(s.end, bits + n)), W, rows, bpp);
    newComp = 0;
  } else pixels = b.subarray(bits, Math.min(s.end, bits + stride * rows));
  // パレットの番号: 使われている画素の値ごとに、論理パレットの色を引いて RGBQuad の色の表を作る。
  // パレットに無い番号・PC_EXPLICIT (装置のパレットの番号。[MS-WMF] 2.1.1.22) の項を使っていれば描かない
  let table: Uint8Array | undefined;
  if (byPalette) {
    const pal = s.palette!.entries;
    const n = s.usage === 1 ? entries : 1 << bpp;
    table = new Uint8Array(n * 4);
    const used = new Set<number>();
    // 画素のデータのある行だけを見る (データより大きな寸法を書いたファイルで、無い画素を数えない)
    const dataRows = Math.min(rows, Math.ceil(pixels.length / stride));
    for (let y = 0; y < dataRows; y++)
      for (let x = 0; x < W; x++) {
        const bit = x * bpp;
        const o = y * stride + (bit >> 3);
        if (o < pixels.length) used.add((pixels[o] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1));
      }
    for (const u of used) {
      if (u >= n) return undefined;
      const at = s.bmi + hs + maskBytes + 2 * u;
      const idx = s.usage === 1 ? (at + 2 <= b.length ? v.getUint16(at, true) : -1) : u;
      const e = pal[idx];
      if (!e || e[3] & 2) return undefined;
      table.set([e[2], e[1], e[0], 0], u * 4);
    }
  }
  // BMP のファイルの頭 (14 バイト) を付けて、decodeBmp で読む
  const tableBytes = table ? maskBytes + table.length : colorBytes;
  const head = 14 + hs + tableBytes;
  const file = new Uint8Array(head + pixels.length);
  file.set([0x42, 0x4d], 0);
  const fv = new DataView(file.buffer);
  fv.setUint32(2, file.length, true);
  fv.setUint32(10, head, true);
  file.set(b.subarray(s.bmi, Math.min(b.length, s.bmi + hs + (table ? maskBytes : colorBytes))), 14);
  if (table) {
    file.set(table, 14 + hs + maskBytes);
    fv.setUint32(14 + 32, table.length / 4, true);
  }
  if (core) fv.setInt16(14 + 6, Math.sign(h) * rows, true);
  else {
    fv.setInt32(14 + 8, (h < 0 ? -1 : 1) * rows, true);
    fv.setUint32(14 + 16, newComp, true);
  }
  file.set(pixels, head);
  const px = decodeBmp(file);
  if (px && s.alpha && bpp === 32 && (comp === 0 || comp === 3)) {
    // 不透明度は、赤・緑・青の覆い (BI_RGB なら下位 3 バイト。[MS-WMF] 2.1.1.3) の外のビット。decodeBmp は不透明にするので、ここで読み直す
    const mk = comp === 3 ? [0, 4, 8].map((k) => v.getUint32(s.bmi + 40 + k, true)) : [0xff0000, 0xff00, 0xff];
    const am = ~(mk[0] | mk[1] | mk[2]) >>> 0;
    let sh = 0;
    while (sh < 32 && !((am >>> sh) & 1)) sh++;
    const max = am >>> sh;
    const pv = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    if (am && max)
      for (let y = 0; y < rows; y++) {
        const r = (h < 0 ? y : rows - 1 - y) * stride;
        for (let x = 0; x < W && r + x * 4 + 4 <= pixels.length; x++) px.rgba[(y * W + x) * 4 + 3] = Math.round((((pv.getUint32(r + x * 4, true) & am) >>> sh) * 255) / max);
      }
  }
  return px ? { px } : undefined;
}

/** 画素の一部 (上から下の座標の x, y, w, h) を切り出す */
function cropPixels(px: Pixels, x: number, y: number, w: number, h: number): Pixels | undefined {
  const x0 = Math.max(0, Math.min(px.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(px.height, Math.round(y)));
  const x1 = Math.max(x0, Math.min(px.width, Math.round(x + w)));
  const y1 = Math.max(y0, Math.min(px.height, Math.round(y + h)));
  if (x1 <= x0 || y1 <= y0) return undefined;
  if (x0 === 0 && y0 === 0 && x1 === px.width && y1 === px.height) return px;
  const W = x1 - x0;
  const rgba = new Uint8Array(W * (y1 - y0) * 4);
  for (let r = y0; r < y1; r++) rgba.set(px.rgba.subarray((r * px.width + x0) * 4, (r * px.width + x1) * 4), (r - y0) * W * 4);
  return { width: W, height: y1 - y0, rgba };
}

const rgbOf = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** 3 項のラスター演算 (番号 code) の値。p・s・d は 8 ビットの値 (型・元・描き先) */
function rop3(code: number, p: number, s: number, d: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) if (code & (1 << i)) r |= (i & 4 ? p : ~p) & (i & 2 ? s : ~s) & (i & 1 ? d : ~d);
  return r & 0xff;
}

/**
 * 描き先に依るラスター演算を、描画モードの 3 つの層で表す。元 (s) と型 (p) の色の成分が 0 か 255 なら、ビット演算の結果は
 * 描き先の成分 d に対して「0」「255」「d」「255 − d」のどれかになる。それぞれ、乗算 (黒を掛ける)・スクリーン (白を重ねる)・
 * そのまま・差の絶対値 (白との差) と同じ値なので、乗算・スクリーン・差の層を重ねれば、画素ごと・成分ごとに同じ結果になる。
 * 0・255 以外の成分があれば、表せないので false
 */
function blendLayers(out: SvgOut, code: number, pat: [number, number, number], px: Pixels | undefined, dst: [number, number, number, number]): boolean {
  const [x, y, w, h] = dst;
  const bin = (v: number) => v === 0 || v === 255;
  if (!pat.every(bin)) return false;
  const W = px?.width ?? 1;
  const H = px?.height ?? 1;
  const layers = { multiply: new Uint8Array(W * H * 4).fill(255), screen: new Uint8Array(W * H * 4), difference: new Uint8Array(W * H * 4) };
  const used = { multiply: false, screen: false, difference: false };
  for (let i = 0; i < W * H; i++) {
    for (let k = 0; k < 3; k++) {
      const sv = px ? px.rgba[i * 4 + k] : 0;
      if (!bin(sv)) return false;
      const r0 = rop3(code, pat[k], sv, 0);
      const r1 = rop3(code, pat[k], sv, 255);
      if (r0 === 0 && r1 === 0) {
        layers.multiply[i * 4 + k] = 0;
        used.multiply = true;
      } else if (r0 === 255 && r1 === 255) {
        layers.screen[i * 4 + k] = 255;
        used.screen = true;
      } else if (r0 === 255 && r1 === 0) {
        layers.difference[i * 4 + k] = 255;
        used.difference = true;
      }
    }
    layers.multiply[i * 4 + 3] = layers.screen[i * 4 + 3] = layers.difference[i * 4 + 3] = 255;
  }
  for (const mode of ['multiply', 'screen', 'difference'] as const) {
    if (!used[mode]) continue;
    const rgba = layers[mode];
    if (!px) {
      // 元の無い演算 (DSTINVERT・PATINVERT など): 矩形を 1 色で
      out.fillRects([normRect(x, y, x + w, y + h)], `#${[0, 1, 2].map((k) => rgba[k].toString(16).padStart(2, '0')).join('')}`, mode);
    } else if (out.takePixels(W * H)) out.image(x, y, w, h, `data:image/png;base64,${base64(encodePngStored({ width: W, height: H, rgba }))}`, mode); // (層ごとに 1 枚の画像になるので、画素の合計に数える)
  }
  return true;
}

/**
 * 画像の転送 (BITBLT・STRETCHBLT・STRETCHDIB など)。dst は描き先 (論理座標の x, y, w, h)、src は元の DIB、
 * sr は元の矩形 (画素。上から下の座標)。描き先に依る演算は blendLayers で表す。SRCAND の次に同じ所への SRCINVERT が来て、
 * マスクが白の画素で画像が黒なら、「(描き先 AND マスク) XOR 画像」は、マスクの黒の所だけ画像を置くのと同じなので、透明の部分を持つ画像 1 枚にする
 */
function blit(out: SvgOut, b: Uint8Array, rop: number, dst: [number, number, number, number], src?: DibSrc, sr?: [number, number, number, number]) {
  // 記録の RasterOperation は 32 ビットの値 (Reverse Polish の列。例 SRCCOPY = 0x00CC0020・BLACKNESS = 0x00000042): 上位の語の下位のバイトが演算の番号
  const code = (rop >>> 16) & 0xff;
  const usesD = ((code >> 1) & 0x55) !== (code & 0x55);
  const usesS = ((code >> 2) & 0x33) !== (code & 0x33);
  const usesP = ((code >> 4) & 0x0f) !== (code & 0x0f);
  // 待っている SRCAND は、組にならなければ先に描く (組になりうるときも、ほかの描画をすれば emit が先に描く)
  const pend = out.pending;
  const sameDst = pend && pend.dst.every((v, k) => v === dst[k]) && pend.clip === out.dc.clip && pend.xf === out.dc.xf;
  if (pend && !(code === 0x66 && sameDst)) out.flushPending();
  const brush = out.dc.brush;
  if (usesP && brush.none) return;
  if (usesP && brush.pattern) {
    // 模様のブラシ: PATCOPY だけ (模様で矩形を塗る)
    if (code === 0xf0) out.fillRects([normRect(dst[0], dst[1], dst[0] + dst[2], dst[1] + dst[3])], out.paintOf(brush));
    return;
  }
  const pat = rgbOf(usesP ? brush.color : '#000000');
  const [x, y, w, h] = dst;
  if (!usesS) {
    if (usesD) {
      blendLayers(out, code, pat, undefined, dst);
      return;
    }
    // BLACKNESS・WHITENESS・PATCOPY など: 矩形を 1 色で塗る
    const c = pat.map((v) => rop3(code, v, 0, 0));
    out.fillRects([normRect(x, y, x + w, y + h)], `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    return;
  }
  if (!src) return;
  const img = dibImage(out, b, { ...src, palette: out.dc.palette });
  if (!img) return;
  if ('data' in img) {
    if (code === 0xcc) out.image(x, y, w, h, `data:${img.mime};base64,${base64(img.data)}`);
    return;
  }
  let px: Pixels | undefined = img.px;
  if (sr) px = cropPixels(px, sr[0], sr[1], Math.abs(sr[2]), Math.abs(sr[3]));
  if (!px) return;
  if (usesD) {
    if (code === 0x66 && pend && out.pending === pend && sameDst && pend.px.width === px.width && pend.px.height === px.height) {
      const m = pend.px.rgba;
      const s = px.rgba;
      const rgba = new Uint8Array(s.length);
      let ok = true;
      for (let i = 0; i < s.length && ok; i += 4) {
        if (m[i] === 0 && m[i + 1] === 0 && m[i + 2] === 0) rgba.set([s[i], s[i + 1], s[i + 2], 255], i);
        else if (m[i] === 255 && m[i + 1] === 255 && m[i + 2] === 255 && !s[i] && !s[i + 1] && !s[i + 2]) rgba.set([0, 0, 0, 0], i);
        else ok = false;
      }
      if (ok) {
        out.pending = undefined;
        out.image(x, y, w, h, `data:image/png;base64,${base64(encodePngStored({ width: px.width, height: px.height, rgba }))}`);
        return;
      }
    }
    if (code === 0x88) {
      const p0 = px;
      out.pending = { dst, px: p0, ...(out.dc.clip ? { clip: out.dc.clip } : {}), ...(out.dc.xf ? { xf: out.dc.xf } : {}), flush: () => void blendLayers(out, code, pat, p0, dst) };
      return;
    }
    blendLayers(out, code, pat, px, dst);
    return;
  }
  if (code !== 0xcc) {
    const rgba = new Uint8Array(px.rgba);
    for (let i = 0; i < rgba.length; i += 4) for (let k = 0; k < 3; k++) rgba[i + k] = rop3(code, pat[k], rgba[i + k], 0);
    px = { width: px.width, height: px.height, rgba };
  }
  out.image(x, y, w, h, `data:image/png;base64,${base64(encodePngStored(px))}`);
}

/**
 * EMR_ALPHABLEND ([MS-EMF] 2.3.1.1): 元の画素を不透明度で描き先に重ねる。AlphaFormat 0 は SrcConstantAlpha だけ、
 * AC_SRC_ALPHA (1) は画素ごとの不透明度 (色はその不透明度を掛けた値) に SrcConstantAlpha を掛ける。
 * どちらも「元 × α + 描き先 × (1 − α)」なので、色を戻して不透明度付きの PNG にすれば、SVG のふつうの重ね方で同じになる
 */
function alphaBlend(out: SvgOut, b: Uint8Array, dst: [number, number, number, number], src: DibSrc, sr: [number, number, number, number], constAlpha: number, perPixel: boolean) {
  const img = dibImage(out, b, { ...src, alpha: perPixel, palette: out.dc.palette });
  if (!img || !('px' in img)) return;
  const px = cropPixels(img.px, sr[0], sr[1], Math.abs(sr[2]), Math.abs(sr[3]));
  if (!px) return;
  const rgba = new Uint8Array(px.rgba);
  const c = constAlpha / 255;
  for (let i = 0; i < rgba.length; i += 4) {
    const A = perPixel ? rgba[i + 3] : 255;
    for (let k = 0; k < 3; k++) rgba[i + k] = perPixel ? (A ? Math.min(255, Math.round((rgba[i + k] * 255) / A)) : 0) : rgba[i + k];
    rgba[i + 3] = Math.round(A * c);
  }
  out.image(dst[0], dst[1], dst[2], dst[3], `data:image/png;base64,${base64(encodePngStored({ width: px.width, height: px.height, rgba }))}`);
}

/** WMF の Palette オブジェクト (Start, NumberOfEntries, PaletteEntry (Red, Green, Blue, Values)…) の項 */
function wmfPaletteEntries(b: Uint8Array, at: number, end: number): Array<[number, number, number, number]> {
  const n = b[at + 2] | (b[at + 3] << 8);
  const out: Array<[number, number, number, number]> = [];
  // 項は記録の中にあるものだけ (end は記録の終わり。数の欄だけを信じると、短い記録を並べたファイルで、記録ごとに 65,535 個を読む)
  for (let k = 0; k < n && at + 4 + 4 * k + 4 <= end; k++) out.push([b[at + 4 + 4 * k], b[at + 5 + 4 * k], b[at + 6 + 4 * k], b[at + 7 + 4 * k]]);
  return out;
}

/**
 * ハッチのブラシ (BS_HATCHED)。仕様書 ([MS-WMF] 2.1.1.12 HatchStyle) は模様の向きだけを決め、線の間隔・太さの決まりが無い。
 * ここでは利用者の指定により、装置の 8 画素ごとに太さ 1 画素の線を引く (8×8 画素のタイル)。線はブラシの色、線の間は、
 * 背景のモードが OPAQUE (2) で背景色 (SETBKCOLOR) があればその色、そうでなければ塗らない ([MS-WMF] 2.1.1.20 MixMode)
 */
function hatchBrush(color: string, hatch: number): Brush {
  if (hatch > 5) return { kind: 'brush', none: true, color };
  return {
    kind: 'brush',
    none: false,
    color,
    pattern: (dc) => {
      const fg = rgbOf(color);
      const bg = dc.bkMode === 2 && dc.bkColor ? rgbOf(dc.bkColor) : undefined;
      const rgba = new Uint8Array(8 * 8 * 4);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          // 0 横・1 縦・2 左上から右下への斜め・3 左下から右上への斜め・4 横と縦・5 両方の斜め
          const on = [y === 0, x === 0, x === y, x + y === 7, x === 0 || y === 0, x === y || x + y === 7][hatch];
          const c = on ? fg : bg;
          if (c) rgba.set([...c, 255], (y * 8 + x) * 4);
        }
      return { width: 8, height: 8, rgba };
    },
  };
}

/** DIB の模様のブラシ。画素は使うときのパレットで作る (DIB_PAL_COLORS のため) */
function patternBrush(b: Uint8Array, src: DibSrc): Brush {
  return {
    kind: 'brush',
    none: false,
    color: '#000000',
    pattern: (dc, out) => {
      const img = dibImage(out, b, { ...src, palette: dc.palette });
      if (!img || !('px' in img)) return undefined;
      // 模様の画素は不透明に (DIB の不透明度は使わない)
      const rgba = new Uint8Array(img.px.rgba);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      return { width: img.px.width, height: img.px.height, rgba };
    },
  };
}

/** WMF の Region オブジェクトの走査線 ([MS-WMF] 2.2.2.21 Scan: Count, Top, Bottom, (Left, Right)…, Count2) → 矩形 */
function wmfRegion(v: DataView, at: number, end: number): Rect[] {
  const n = v.getInt16(at - 22 + 10, true); // ScanCount (Region オブジェクトの 10 バイト目)
  const out: Rect[] = [];
  let o = at;
  for (let k = 0; k < n && o + 6 <= end; k++) {
    const count = v.getUint16(o, true);
    const top = v.getUint16(o + 2, true);
    const bottom = v.getUint16(o + 4, true);
    for (let j = 0; j + 1 < count && o + 6 + j * 2 + 4 <= end; j += 2) out.push(normRect(v.getUint16(o + 6 + j * 2, true), top, v.getUint16(o + 8 + j * 2, true), bottom));
    o += 6 + count * 2 + 2;
  }
  return out;
}

/** EMF の RegionData ([MS-EMF] 2.2.24: 32 バイトの頭 (CountRects は 8 バイト目) と RectL の並び) → 矩形 */
function emfRegion(v: DataView, at: number, end: number): Rect[] {
  if (at + 32 > end) return [];
  const n = v.getUint32(at + 8, true);
  const out: Rect[] = [];
  for (let k = 0, o = at + 32; k < n && o + 16 <= end; k++, o += 16) out.push(normRect(v.getInt32(o, true), v.getInt32(o + 4, true), v.getInt32(o + 8, true), v.getInt32(o + 12, true)));
  return out;
}

/**
 * SETDIBITSTODEVICE ([MS-EMF] 2.3.1.5。WMF の META_SETDIBTODEV も同じ並びの値として読む): 元の矩形は左下の隅 (xSrc, ySrc) と
 * 幅・高さで、画素は下から startScan 行目からの scans 行だけ。描き先の大きさは元の矩形と同じ
 */
function setDibToDevice(out: SvgOut, b: Uint8Array, dst: [number, number, number, number], src: DibSrc, xSrc: number, ySrc: number, startScan: number) {
  const img = dibImage(out, b, { ...src, palette: out.dc.palette });
  if (!img || !('px' in img)) return;
  const { width, height: rows } = img.px;
  const [x, y, w, h] = dst;
  const W = Math.abs(w);
  const H = Math.abs(h);
  // 下から数えた行 → 渡された行 (上から下) の中の位置。渡された行の外は描かない
  const top = startScan + rows - (ySrc + H);
  const x0 = Math.max(0, xSrc);
  const x1 = Math.min(width, xSrc + W);
  const y0 = Math.max(0, top);
  const y1 = Math.min(rows, top + H);
  const px = cropPixels(img.px, x0, y0, x1 - x0, y1 - y0);
  if (!px) return;
  const sx = Math.sign(w) || 1;
  const sy = Math.sign(h) || 1;
  out.image(x + sx * (x0 - xSrc), y + sy * (y0 - top), sx * (x1 - x0), sy * (y1 - y0), `data:image/png;base64,${base64(encodePngStored(px))}`);
}

/** WMF (Placeable ヘッダ付き、または無し) → SVG。読めなければ undefined */
export function wmfToSvg(b: Uint8Array, widthPx?: number, heightPx?: number): string | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 18) return undefined;
  let p = 0;
  let bbox: [number, number, number, number] | undefined;
  if (v.getUint32(0, true) === 0x9ac6cdd7) {
    bbox = [v.getInt16(6, true), v.getInt16(8, true), v.getInt16(10, true), v.getInt16(12, true)];
    const inch = v.getUint16(14, true) || 1440;
    widthPx ??= (Math.abs(bbox[2] - bbox[0]) / inch) * 96;
    heightPx ??= (Math.abs(bbox[3] - bbox[1]) / inch) * 96;
    p = 22;
  }
  if (p + 18 > b.length || (v.getUint16(p, true) !== 1 && v.getUint16(p, true) !== 2)) return undefined;
  p += v.getUint16(p + 2, true) * 2; // ヘッダの大きさ (語数)
  const out = new SvgOut();
  const objs: Array<Obj | undefined> = [];
  // オブジェクトは、空いている一番小さい番号に入れる ([MS-WMF] 3.1.4.1)。空きを探し始める位置 (low) を覚えて、
  // 消さずに作り続ける記録が多いファイルでも、毎回先頭から探さない
  let low = 0;
  const add = (o: Obj) => {
    let k = low;
    while (k < objs.length && objs[k]) k++;
    objs[k] = o;
    low = k + 1;
  };
  const i16 = (o: number) => v.getInt16(o, true);
  records: for (let guard = 0; p + 6 <= b.length && guard < 1e6; guard++) {
    const size = v.getUint32(p, true) * 2;
    const fn = v.getUint16(p + 4, true);
    const a = p + 6;
    if (fn === 0 || size < 6) break;
    // 記録の終わり (RecordSize: [MS-WMF] 2.3 の記録の長さ。ファイルの終わりを超えない)。点・字・番号の並びは記録の中にある
    // ([MS-WMF] 2.3.3 の各記録) ので、数の欄が記録に入りきらなければ、途中で切れた記録と同じに扱う (そこで読むのをやめる)。
    // 数の欄だけを信じると、短い記録を並べたファイルで、記録ごとにファイルの終わりまでを読み、出力が入力の 2 乗で増える
    const end = Math.min(p + size, b.length);
    const fit = (at: number, n: number, unit: number): number => {
      if (n > 0 && at + n * unit > end) throw new RangeError('記録に入りきらない数');
      return Math.max(0, n);
    };
    const pts = (at: number, n: number) => Array.from({ length: fit(at, n, 4) }, (_, k) => [i16(at + k * 4), i16(at + k * 4 + 2)]);
    // 途中で切れた記録 (ファイルの外を読む) は、そこで読むのをやめ、それまでに描いたものを出す
    try {
    switch (fn) {
      case 0x020b: // SETWINDOWORG (y, x)
        out.dc.winOrg = [i16(a + 2), i16(a)];
        break;
      case 0x020c: // SETWINDOWEXT (y, x)
        out.dc.winExt = [i16(a + 2), i16(a)];
        break;
      case 0x0106: // SETPOLYFILLMODE
        out.dc.fillRule = v.getUint16(a, true) === 2 ? 'nonzero' : 'evenodd';
        break;
      case 0x0209: // SETTEXTCOLOR
        out.dc.textColor = colorRef(v.getUint32(a, true));
        break;
      case 0x012e: // SETTEXTALIGN
        out.dc.textAlign = v.getUint16(a, true);
        break;
      case 0x0102: // SETBKMODE (BkMode)
        out.dc.bkMode = v.getUint16(a, true);
        break;
      case 0x0201: // SETBKCOLOR (ColorRef)
        out.dc.bkColor = colorRef(v.getUint32(a, true));
        break;
      case 0x02fa: // CREATEPENINDIRECT
        add({
          kind: 'pen',
          none: (v.getUint16(a, true) & 0xf) === 5,
          width: Math.abs(i16(a + 2)),
          color: colorRef(v.getUint32(a + 6, true)),
          style: v.getUint16(a, true),
        });
        break;
      case 0x02fc: // CREATEBRUSHINDIRECT (BrushStyle, ColorRef, BrushHatch)
        add(
          v.getUint16(a, true) === 2
            ? hatchBrush(colorRef(v.getUint32(a + 2, true)), v.getUint16(a + 6, true))
            : { kind: 'brush', none: v.getUint16(a, true) === 1, color: colorRef(v.getUint32(a + 2, true)) },
        );
        break;
      case 0x02fb: {
        // CREATEFONTINDIRECT
        const nameBytes = b.subarray(a + 18, Math.min(a + 18 + 32, end));
        const charset = b[a + 13];
        const nul = nameBytes.indexOf(0);
        add({
          kind: 'font',
          height: i16(a),
          escapement: i16(a + 4),
          weight: i16(a + 8),
          italic: !!b[a + 10],
          underline: !!b[a + 11],
          charset,
          face: decoderFor(charset).decode(nameBytes.subarray(0, nul < 0 ? undefined : nul)),
        });
        break;
      }
      case 0x00f7: // CREATEPALETTE (Palette オブジェクト: Start, NumberOfEntries, PaletteEntry (Red, Green, Blue, Values)…)
        add({ kind: 'palette', entries: wmfPaletteEntries(b, a, end) });
        break;
      case 0x0234: {
        // SELECTPALETTE
        const o = objs[v.getUint16(a, true)];
        if (o?.kind === 'palette') out.dc.palette = o;
        break;
      }
      case 0x0037: {
        // SETPALENTRIES (Palette オブジェクト。Start から NumberOfEntries 個を置き換える)
        const pal = out.dc.palette;
        if (pal) wmfPaletteEntries(b, a, end).forEach((e, k) => (pal.entries[v.getUint16(a, true) + k] = e));
        break;
      }
      case 0x0436: {
        // ANIMATEPALETTE: 今のパレットの、PC_RESERVED (0x01) の付いた項だけを置き換える ([MS-WMF] 2.3.5.1)
        const pal = out.dc.palette;
        if (pal)
          wmfPaletteEntries(b, a, end).forEach((e, k) => {
            const at = v.getUint16(a, true) + k;
            if (pal.entries[at] && pal.entries[at][3] & 1) pal.entries[at] = e;
          });
        break;
      }
      case 0x0139: // RESIZEPALETTE
        if (out.dc.palette) out.dc.palette.entries.length = v.getUint16(a, true);
        break;
      case 0x0103: // SETMAPMODE
        out.dc.mapMode = v.getUint16(a, true);
        break;
      case 0x020e: // SETVIEWPORTEXT (y, x)
        out.dc.vpExt = [i16(a + 2), i16(a)];
        break;
      case 0x0142: {
        // DIBCREATEPATTERNBRUSH (Style, ColorUsage, DIB)。BS_PATTERN (3) なら DIB_RGB_COLORS
        const usage = v.getUint16(a, true) === 3 ? 0 : v.getUint16(a + 2, true);
        add(patternBrush(b, { bmi: a + 4, end, usage }));
        break;
      }
      case 0x01f9: // CREATEPATTERNBRUSH (Bitmap16: 装置に依る形式で、画素の色の決まりが無いので描かない)
        add({ kind: 'other' });
        break;
      case 0x06ff: // CREATEREGION (Region オブジェクト: [MS-WMF] 2.2.1.5)
        add({ kind: 'region', rects: wmfRegion(v, a + 22, end) });
        break;
      case 0x0416: // INTERSECTCLIPRECT (bottom, right, top, left)
      case 0x0415: // EXCLUDECLIPRECT
        out.clipRects([normRect(i16(a + 6), i16(a + 4), i16(a + 2), i16(a))], fn === 0x0416 ? 1 : 4);
        break;
      case 0x0220: // OFFSETCLIPRGN (y, x)
        out.offsetClip(i16(a + 2), i16(a));
        break;
      case 0x012c: {
        // SELECTCLIPREGION (Region の番号)
        const o = objs[v.getUint16(a, true)];
        if (o?.kind === 'region') out.clipRects(o.rects, 5);
        break;
      }
      case 0x0228: // FILLREGION (Region, Brush)
      case 0x012b: {
        // PAINTREGION (Region。今のブラシ)
        const o = objs[v.getUint16(a, true)];
        const br = fn === 0x0228 ? objs[v.getUint16(a + 2, true)] : out.dc.brush;
        if (o?.kind === 'region' && br?.kind === 'brush') out.fillRects(o.rects, out.paintOf(br));
        break;
      }
      case 0x0817: // ARC (yEnd, xEnd, yStart, xStart, bottom, right, top, left)
      case 0x0830: // CHORD (yRadial2, xRadial2, yRadial1, xRadial1, bottom, right, top, left)
      case 0x081a: // PIE (同じ並び)
        out.arc(i16(a + 14), i16(a + 12), i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4), i16(a + 2), i16(a), fn === 0x0817 ? 'arc' : fn === 0x0830 ? 'chord' : 'pie');
        break;
      case 0x041f: // SETPIXEL (ColorRef, y, x)
        out.fillRects([[i16(a + 6), i16(a + 4), i16(a + 6) + 1, i16(a + 4) + 1]], colorRef(v.getUint32(a, true)));
        break;
      case 0x061d: // PATBLT (RasterOperation, height, width, y, x)
        blit(out, b, v.getUint32(a, true), [i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4)]);
        break;
      case 0x0940: {
        // DIBBITBLT (RasterOperation, ySrc, xSrc, [Reserved], height, width, yDest, xDest, [DIB])。DIB の有無は RecordSize で見分ける
        const noSrc = size / 2 === (fn >> 8) + 3;
        const k = noSrc ? 2 : 0;
        const w = i16(a + 10 + k);
        const h = i16(a + 8 + k);
        const src = noSrc ? undefined : { bmi: a + 16, end, usage: 0 };
        blit(out, b, v.getUint32(a, true), [i16(a + 14 + k), i16(a + 12 + k), w, h], src, [i16(a + 6), i16(a + 4), w, h]);
        break;
      }
      case 0x0b41: {
        // DIBSTRETCHBLT (RasterOperation, srcHeight, srcWidth, ySrc, xSrc, [Reserved], destHeight, destWidth, yDest, xDest, [DIB])
        const noSrc = size / 2 === (fn >> 8) + 3;
        const k = noSrc ? 2 : 0;
        const src = noSrc ? undefined : { bmi: a + 20, end, usage: 0 };
        blit(out, b, v.getUint32(a, true), [i16(a + 18 + k), i16(a + 16 + k), i16(a + 14 + k), i16(a + 12 + k)], src, [i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4)]);
        break;
      }
      case 0x0f43: // STRETCHDIB (RasterOperation, ColorUsage, srcHeight, srcWidth, ySrc, xSrc, destHeight, destWidth, yDst, xDst, DIB)
        blit(out, b, v.getUint32(a, true), [i16(a + 20), i16(a + 18), i16(a + 16), i16(a + 14)], { bmi: a + 22, end, usage: v.getUint16(a + 4, true) }, [
          i16(a + 12),
          i16(a + 10),
          i16(a + 8),
          i16(a + 6),
        ]);
        break;
      case 0x0d33: {
        // SETDIBTODEV (ColorUsage, ScanCount, StartScan, yDib, xDib, height, width, yDest, xDest, DIB)
        const w = i16(a + 12);
        const h = i16(a + 10);
        const scans = v.getUint16(a + 2, true);
        setDibToDevice(
          out,
          b,
          [i16(a + 16), i16(a + 14), w, h],
          { bmi: a + 18, end, usage: v.getUint16(a, true), scans },
          v.getUint16(a + 8, true),
          v.getUint16(a + 6, true),
          v.getUint16(a + 4, true),
        );
        break;
      }
      case 0x012d: {
        // SELECTOBJECT
        const o = objs[v.getUint16(a, true)];
        if (o?.kind === 'pen') out.dc.pen = o;
        else if (o?.kind === 'brush') out.dc.brush = o;
        else if (o?.kind === 'font') out.dc.font = o;
        break;
      }
      case 0x01f0: // DELETEOBJECT
        {
          const k = v.getUint16(a, true);
          objs[k] = undefined;
          low = Math.min(low, k);
        }
        break;
      case 0x001e: // SAVEDC
        out.save();
        break;
      case 0x0127: // RESTOREDC
        out.restore(i16(a));
        break;
      case 0x0214: // MOVETO (y, x)
        out.moveTo(i16(a + 2), i16(a));
        break;
      case 0x0213: // LINETO (y, x)
        out.lineTo(i16(a + 2), i16(a));
        break;
      case 0x0324: // POLYGON
        out.shape(out.poly(pts(a + 2, i16(a)), true), true);
        break;
      case 0x0325: // POLYLINE
        out.shape(out.poly(pts(a + 2, i16(a)), false), false);
        break;
      case 0x0538: {
        // POLYPOLYGON
        const n = fit(a + 2, v.getUint16(a, true), 2);
        let at = a + 2 + n * 2;
        let d = '';
        for (let k = 0; k < n; k++) {
          const c = v.getUint16(a + 2 + k * 2, true);
          d += out.poly(pts(at, c), true);
          at += c * 4;
        }
        out.shape(d, true);
        break;
      }
      case 0x041b: // RECTANGLE (bottom, right, top, left)
        out.rect(i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x0418: // ELLIPSE
        out.ellipse(i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x061c: // ROUNDRECT (h, w, bottom, right, top, left)
        out.roundRect(i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x0521: {
        // TEXTOUT (count, string, y, x)
        const n = fit(a + 2, i16(a), 1);
        const s = decoderFor(out.dc.font.charset).decode(b.subarray(a + 2, a + 2 + n));
        const at = a + 2 + n + (n % 2);
        out.text(i16(at + 2), i16(at), s);
        break;
      }
      case 0x0a32: {
        // EXTTEXTOUT (y, x, count, options, [rect], string)
        const opts = v.getUint16(a + 6, true);
        const at = a + 8 + (opts & 6 ? 8 : 0);
        const n = fit(at, i16(a + 4), 1);
        const bytes = b.subarray(at, at + n);
        const str = decoderFor(out.dc.font.charset).decode(bytes);
        // Dx (任意): 文字列 (奇数の長さなら 1 バイト埋める) の後ろ、記録の終わりまで。字の数と同じ数の 16 ビットの符号付き整数
        const dxAt = at + n + (n % 2);
        const cnt = Math.max(0, Math.floor((end - dxAt) / 2));
        let dx: number[] | undefined;
        if (cnt > 0) {
          const raw = Array.from({ length: cnt }, (_, k) => i16(dxAt + 2 * k));
          const chars = Array.from(str);
          if (raw.length === chars.length) dx = raw;
          else if (raw.length === n) {
            // 2 バイトの文字コード (Shift_JIS など) で、バイトごとに値があるとき: 字のバイトの値を足す
            const lens = byteLengths(bytes, out.dc.font.charset);
            if (lens.length === chars.length) {
              let k = 0;
              dx = lens.map((len) => {
                const d = raw.slice(k, k + len).reduce((t, x) => t + x, 0);
                k += len;
                return d;
              });
            }
          }
        }
        // Rectangle (ETO_OPAQUE 2・ETO_CLIPPED 4 のとき): Rect オブジェクト (left, top, right, bottom。[MS-WMF] 2.2.2.18)
        const rect = opts & 6 ? ([i16(a + 8), i16(a + 10), i16(a + 12), i16(a + 14)] as [number, number, number, number]) : undefined;
        out.textBox(rect, opts, () => out.text(i16(a + 2), i16(a), str, dx));
        break;
      }
      default:
        break;
    }
    } catch (e) {
      if (e instanceof RangeError || e instanceof TypeError) break records;
      throw e;
    }
    p += size;
  }
  const ext = out.dc.winExt;
  const vb: [number, number, number, number] = bbox
    ? [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.abs(bbox[2] - bbox[0]), Math.abs(bbox[3] - bbox[1])]
    : ext
      ? [out.dc.winOrg[0], out.dc.winOrg[1], ext[0], ext[1]]
      : [0, 0, widthPx ?? 100, heightPx ?? 100];
  const w = widthPx ?? vb[2];
  const h = heightPx ?? vb[3];
  return finish(out, vb, w, h);
}

/** 細い線 (幅 0 のペン) を、出来上がりの 1px 相当にしてから SVG にする */
function finish(out: SvgOut, vb: [number, number, number, number], w: number, h: number): string {
  const hair = Math.abs(vb[2]) / Math.max(w, 1);
  return out.toSvg(vb, w, h).split(HAIR).join(num(hair));
}

/** EMF → SVG。読めなければ undefined */
export function emfToSvg(b: Uint8Array, widthPx?: number, heightPx?: number): string | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 88 || v.getUint32(0, true) !== 1 || v.getUint32(40, true) !== 0x464d4520) return undefined;
  const bounds = [v.getInt32(8, true), v.getInt32(12, true), v.getInt32(16, true), v.getInt32(20, true)];
  const frame = [v.getInt32(24, true), v.getInt32(28, true), v.getInt32(32, true), v.getInt32(36, true)];
  // 左右・上下が逆に書かれた枠でも、大きさは正の値 (imageInfo の emfInfo と同じ)
  widthPx ??= (Math.abs(frame[2] - frame[0]) / 100) * (96 / 25.4);
  heightPx ??= (Math.abs(frame[3] - frame[1]) / 100) * (96 / 25.4);
  const out = new SvgOut();
  // 装置の 1 画素の大きさ: 参照装置の大きさ (Device: 画素・Millimeters: mm。[MS-EMF] 2.2.9) から mm、
  // 出来上がりは rclFrame (0.01 mm) の大きさに viewBox を合わせるので、ページの座標の 1 単位は frame の幅 ÷ viewBox の幅
  const dev = [v.getInt32(72, true), v.getInt32(76, true)];
  const mm = [v.getInt32(80, true), v.getInt32(84, true)];
  if (dev[0] > 0 && dev[1] > 0 && mm[0] > 0 && mm[1] > 0 && frame[2] !== frame[0] && frame[3] !== frame[1])
    out.pixelSize = (vb) => [mm[0] / dev[0] / ((frame[2] - frame[0]) / 100 / vb[2]), mm[1] / dev[1] / ((frame[3] - frame[1]) / 100 / vb[3])];
  const objs = new Map<number, Obj>();
  const stock = (k: number): Obj | undefined => {
    switch (k & 0x7fffffff) {
      case 0:
        return { kind: 'brush', none: false, color: '#ffffff' };
      case 1:
        return { kind: 'brush', none: false, color: '#c0c0c0' };
      case 2:
        return { kind: 'brush', none: false, color: '#808080' };
      case 3:
        return { kind: 'brush', none: false, color: '#404040' };
      case 4:
        return { kind: 'brush', none: false, color: '#000000' };
      case 5:
        return { kind: 'brush', none: true, color: '#000000' };
      case 6:
        return { kind: 'pen', none: false, width: 0, color: '#ffffff' };
      case 7:
        return BLACK_PEN;
      case 8:
        return { kind: 'pen', none: true, width: 0, color: '#000000' };
      default:
        return k & 0x80000000 ? DEFAULT_FONT : undefined;
    }
  };
  const i32 = (o: number) => v.getInt32(o, true);
  const u32 = (o: number) => v.getUint32(o, true);
  const i16 = (o: number) => v.getInt16(o, true);
  const xform = (o: number): Xf => [0, 4, 8, 12, 16, 20].map((k) => v.getFloat32(o + k, true)) as Xf;
  let p = 0;
  records: for (let guard = 0; p + 8 <= b.length && guard < 1e6; guard++) {
    const type = u32(p);
    const size = u32(p + 4);
    const a = p + 8;
    if (size < 8) break;
    // 記録の終わり (Size: [MS-EMF] 2.3 の記録の長さ。ファイルの終わりを超えない)。点・字・番号の並びは記録の中にある
    // ([MS-EMF] 2.3.5 の各記録の Count・aPoints、2.2.5 の EmrText の Chars・offString) ので、数の欄が記録に入りきらなければ、
    // 途中で切れた記録と同じに扱う (そこで読むのをやめる)。数の欄だけを信じると、短い記録を並べたファイルで、記録ごとに
    // ファイルの終わりまでを読み、出力が入力の 2 乗で増える
    const end = Math.min(p + size, b.length);
    const fit = (at: number, n: number, unit: number): number => {
      if (n > 0 && at + n * unit > end) throw new RangeError('記録に入りきらない数');
      return n;
    };
    const pts16 = (at: number, n: number) => Array.from({ length: fit(at, n, 4) }, (_, k) => [i16(at + k * 4), i16(at + k * 4 + 2)]);
    const pts32 = (at: number, n: number) => Array.from({ length: fit(at, n, 8) }, (_, k) => [i32(at + k * 8), i32(at + k * 8 + 4)]);
    // 途中で切れた記録 (ファイルの外を読む)・点の無い記録は、そこで読むのをやめ、それまでに描いたものを出す
    try {
    switch (type) {
      case 9: // SETWINDOWEXTEX
        out.dc.winExt = [i32(a), i32(a + 4)];
        break;
      case 10: // SETWINDOWORGEX
        out.dc.winOrg = [i32(a), i32(a + 4)];
        break;
      case 19: // SETPOLYFILLMODE
        out.dc.fillRule = u32(a) === 2 ? 'nonzero' : 'evenodd';
        break;
      case 22: // SETTEXTALIGN
        out.dc.textAlign = u32(a);
        break;
      case 18: // SETBKMODE
        out.dc.bkMode = u32(a);
        break;
      case 25: // SETBKCOLOR
        out.dc.bkColor = colorRef(u32(a));
        break;
      case 58: // SETMITERLIMIT
        out.dc.miterLimit = u32(a);
        break;
      case 24: // SETTEXTCOLOR
        out.dc.textColor = colorRef(u32(a));
        break;
      case 38: // CREATEPEN (ih, style, width.x, width.y, color)
        objs.set(u32(a), {
          kind: 'pen',
          none: (u32(a + 4) & 0xf) === 5,
          width: Math.abs(i32(a + 8)),
          color: colorRef(u32(a + 16)),
          style: u32(a + 4),
        });
        break;
      case 95: {
        // EXTCREATEPEN (ih, offBmi, cbBmi, offBits, cbBits, LogPenEx: PenStyle, Width, BrushStyle, ColorRef, BrushHatch, NumStyleEntries, StyleEntry)
        const style = u32(a + 20);
        const nStyle = u32(a + 40);
        const dash = (style & 0x0f) === 7 && nStyle > 0 && a + 44 + nStyle * 4 <= end ? Array.from({ length: nStyle }, (_, k) => u32(a + 44 + 4 * k)) : undefined;
        objs.set(u32(a), {
          kind: 'pen',
          none: (style & 0xf) === 5,
          width: Math.abs(u32(a + 24)),
          color: colorRef(u32(a + 32)),
          style,
          ...(dash ? { dash } : {}),
        });
        break;
      }
      case 94: // CREATEDIBPATTERNBRUSHPT (ihBrush, Usage, offBmi, cbBmi, offBits, cbBits)
      case 93: // CREATEMONOBRUSH
        objs.set(u32(a), patternBrush(b, { bmi: p + u32(a + 8), bits: p + u32(a + 16), end: Math.min(end, p + u32(a + 16) + u32(a + 20)), usage: u32(a + 4) }));
        break;
      case 49: {
        // CREATEPALETTE (ihPal, LogPalette: Version, NumberOfEntries, LogPaletteEntry (Reserved, Blue, Green, Red)…)
        const n = Math.min(v.getUint16(a + 6, true), Math.max(0, Math.floor((end - (a + 8)) / 4))); // (項は記録の中にあるものだけ)
        objs.set(u32(a), { kind: 'palette', entries: Array.from({ length: n }, (_, k) => [b[a + 8 + 4 * k + 3], b[a + 8 + 4 * k + 2], b[a + 8 + 4 * k + 1], 0] as [number, number, number, number]) });
        break;
      }
      case 48: {
        // SELECTPALETTE (DEFAULT_PALETTE は装置に依る ([MS-EMF] 2.1.31) ので、色を決められない)
        const o = objs.get(u32(a));
        out.dc.palette = o?.kind === 'palette' ? o : undefined;
        break;
      }
      case 50: {
        // SETPALETTEENTRIES (ihPal, Start, NumberOfEntries, LogPaletteEntry…)
        const o = objs.get(u32(a));
        if (o?.kind === 'palette')
          for (let k = 0; k < u32(a + 8) && a + 12 + 4 * k + 4 <= end; k++) o.entries[u32(a + 4) + k] = [b[a + 12 + 4 * k + 3], b[a + 12 + 4 * k + 2], b[a + 12 + 4 * k + 1], 0];
        break;
      }
      case 51: {
        // RESIZEPALETTE (ihPal, NumberOfEntries)
        const o = objs.get(u32(a));
        if (o?.kind === 'palette') o.entries.length = u32(a + 4);
        break;
      }
      case 13: // SETBRUSHORGEX
        out.dc.brushOrg = [i32(a), i32(a + 4)];
        break;
      case 39: // CREATEBRUSHINDIRECT (ih, style, color, hatch)
        objs.set(u32(a), u32(a + 4) === 2 ? hatchBrush(colorRef(u32(a + 8)), u32(a + 12)) : { kind: 'brush', none: u32(a + 4) === 1, color: colorRef(u32(a + 8)) });
        break;
      case 82: {
        // EXTCREATEFONTINDIRECTW (ih, LOGFONTW)
        const lf = a + 4;
        const name = new TextDecoder('utf-16le').decode(b.subarray(lf + 28, lf + 28 + 64)).replace(/\0.*$/s, '');
        objs.set(u32(a), {
          kind: 'font',
          height: i32(lf),
          escapement: i32(lf + 8),
          weight: i32(lf + 16),
          italic: !!b[lf + 20],
          underline: !!b[lf + 21],
          charset: b[lf + 23],
          face: name,
        });
        break;
      }
      case 37: {
        // SELECTOBJECT
        const ih = u32(a);
        const o = ih & 0x80000000 ? stock(ih) : objs.get(ih);
        if (o?.kind === 'pen') out.dc.pen = o;
        else if (o?.kind === 'brush') out.dc.brush = o;
        else if (o?.kind === 'font') out.dc.font = o;
        break;
      }
      case 40: // DELETEOBJECT
        objs.delete(u32(a));
        break;
      case 33: // SAVEDC
        out.save();
        break;
      case 34: // RESTOREDC
        out.restore(i32(a));
        break;
      case 27: // MOVETOEX
        out.moveTo(i32(a), i32(a + 4));
        break;
      case 54: // LINETO
        out.lineTo(i32(a), i32(a + 4));
        break;
      case 3: // POLYGON
      case 4: // POLYLINE
        out.shape(out.poly(pts32(a + 20, u32(a + 16)), type === 3), type === 3);
        break;
      case 86: // POLYGON16
      case 87: // POLYLINE16
        out.shape(out.poly(pts16(a + 20, u32(a + 16)), type === 86), type === 86);
        break;
      case 6: // POLYLINETO
      case 89: {
        // POLYLINETO16
        const n = u32(a + 16);
        const ps = type === 6 ? pts32(a + 20, n) : pts16(a + 20, n);
        for (const q of ps) out.lineTo(q[0], q[1]);
        break;
      }
      case 2: // POLYBEZIER
      case 85: // POLYBEZIER16
      case 5: // POLYBEZIERTO
      case 88: {
        // POLYBEZIERTO16
        const n = u32(a + 16);
        const ps = type === 2 || type === 5 ? pts32(a + 20, n) : pts16(a + 20, n);
        const to = type === 5 || type === 88;
        let d = to ? `M${num(out.dc.x)} ${num(out.dc.y)}` : `M${num(ps[0][0])} ${num(ps[0][1])}`;
        for (let k = to ? 0 : 1; k + 2 < ps.length + (to ? 0 : 0); k += 3) d += `C${[ps[k], ps[k + 1], ps[k + 2]].map((q) => `${num(q[0])} ${num(q[1])}`).join(' ')}`;
        if (out.path !== null && to) d = d.replace(/^M[^C]*/, '');
        out.shape(d, false);
        const last = ps[ps.length - 1];
        if (last) {
          out.dc.x = last[0];
          out.dc.y = last[1];
        }
        break;
      }
      case 8: // POLYPOLYGON
      case 91: // POLYPOLYGON16
      case 7: // POLYPOLYLINE
      case 90: {
        // POLYPOLYLINE16
        const nPolys = fit(a + 24, u32(a + 16), 4);
        const wide = type === 8 || type === 7;
        let at = a + 24 + nPolys * 4;
        let d = '';
        for (let k = 0; k < nPolys; k++) {
          const c = u32(a + 24 + k * 4);
          const ps = wide ? pts32(at, c) : pts16(at, c);
          d += out.poly(ps, type === 8 || type === 91);
          at += c * (wide ? 8 : 4);
        }
        out.shape(d, type === 8 || type === 91);
        break;
      }
      case 43: // RECTANGLE
        out.rect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12));
        break;
      case 118: {
        // GRADIENTFILL ([MS-EMF] 2.3.5.12): Bounds, nVer, nTri, ulMode, TriVertex (x・y・Red・Green・Blue・Alpha の 16 バイト) の並び、
        // GradientRectangle (左上・右下の頂点の番号) か GradientTriangle (3 つの頂点の番号) の並び。Alpha は使わない
        const nVer = u32(a + 16);
        const nTri = u32(a + 20);
        const mode = u32(a + 24);
        const vat = a + 28;
        if (nVer > 1e5 || nTri > 1e5 || vat + nVer * 16 > end) break;
        const vx = Array.from({ length: nVer }, (_, k) => {
          const o = vat + k * 16;
          return { x: i32(o), y: i32(o + 4), c: [v.getUint16(o + 8, true) >> 8, v.getUint16(o + 10, true) >> 8, v.getUint16(o + 12, true) >> 8] };
        });
        const iat = vat + nVer * 16;
        const hex = (c: number[]) => `#${c.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
        if (mode === 0 || mode === 1) {
          // 矩形: RECT_H は左から右、RECT_V は上から下へ色を変える
          for (let k = 0; k < nTri && iat + k * 8 + 8 <= end; k++) {
            const p0 = vx[u32(iat + k * 8)];
            const p1 = vx[u32(iat + k * 8 + 4)];
            if (!p0 || !p1) continue;
            out.gradientRect(p0.x, p0.y, p1.x, p1.y, hex(p0.c), hex(p1.c), mode === 1);
          }
        } else if (mode === 2) {
          // 三角形: 各辺を 8 等分した小さな三角形に分け、それぞれを重心の色 (3 つの頂点の色の重み付きの平均) で塗る
          const N = 8;
          for (let k = 0; k < nTri && iat + k * 12 + 12 <= end; k++) {
            const t = [0, 4, 8].map((d) => vx[u32(iat + k * 12 + d)]);
            if (t.some((q) => !q)) continue;
            const at = (i: number, j: number) => {
              const w0 = 1 - (i + j) / N;
              const w1 = i / N;
              const w2 = j / N;
              return [t[0].x * w0 + t[1].x * w1 + t[2].x * w2, t[0].y * w0 + t[1].y * w1 + t[2].y * w2];
            };
            const col = (i: number, j: number) => {
              const w1 = i / N;
              const w2 = j / N;
              const w0 = 1 - w1 - w2;
              return hex([0, 1, 2].map((ch) => t[0].c[ch] * w0 + t[1].c[ch] * w1 + t[2].c[ch] * w2));
            };
            for (let i = 0; i < N; i++)
              for (let j = 0; j + i < N; j++) {
                out.solidPolygon([at(i, j), at(i + 1, j), at(i, j + 1)], col(i + 1 / 3, j + 1 / 3));
                if (i + j + 1 < N) out.solidPolygon([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], col(i + 2 / 3, j + 2 / 3));
              }
          }
        }
        break;
      }
      case 42: // ELLIPSE
        out.ellipse(i32(a), i32(a + 4), i32(a + 8), i32(a + 12));
        break;
      case 44: // ROUNDRECT
        out.roundRect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20));
        break;
      case 30: // INTERSECTCLIPRECT
      case 29: // EXCLUDECLIPRECT
        out.clipRects([normRect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12))], type === 30 ? 1 : 4);
        break;
      case 26: // OFFSETCLIPRGN
        out.offsetClip(i32(a), i32(a + 4));
        break;
      case 75: {
        // EXTSELECTCLIPRGN (RgnDataSize, RegionMode, RgnData)。RGN_COPY で RgnData が無ければ、既定 (切り抜き無し) に戻す
        const mode = u32(a + 4);
        if (u32(a) >= 32) out.clipRects(emfRegion(v, a + 8, end), mode);
        else if (mode === 5) out.combineClip(undefined, 5);
        break;
      }
      case 67: {
        // SELECTCLIPPATH (RegionMode): 今のパスを切り抜きに組み合わせる
        const d = out.path;
        out.path = null;
        if (d)
          out.combineClip(
            {
              layer: {
                d,
                evenodd: out.dc.fillRule === 'evenodd',
                ...(out.dc.xf ? { m: out.dc.xf } : {}),
              },
            },
            u32(a),
          );
        break;
      }
      case 71: // FILLRGN (Bounds, RgnDataSize, ihBrush, RgnData)
      case 74: {
        // PAINTRGN (Bounds, RgnDataSize, RgnData。今のブラシ)
        const ih = u32(a + 20);
        const br = type === 71 ? (ih & 0x80000000 ? stock(ih) : objs.get(ih)) : out.dc.brush;
        if (br?.kind === 'brush') out.fillRects(emfRegion(v, type === 71 ? a + 24 : a + 20, end), out.paintOf(br));
        break;
      }
      case 45: // ARC (Box, Start, End)
      case 46: // CHORD
      case 47: // PIE
      case 55: // ARCTO
        out.arc(i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20), i32(a + 24), i32(a + 28), type === 45 ? 'arc' : type === 46 ? 'chord' : type === 47 ? 'pie' : 'arcto');
        break;
      case 41: // ANGLEARC (Center, Radius, StartAngle, SweepAngle)
        out.angleArc(i32(a), i32(a + 4), u32(a + 8), v.getFloat32(a + 12, true), v.getFloat32(a + 16, true));
        break;
      case 57: // SETARCDIRECTION
        out.dc.arcCw = u32(a) === 2;
        break;
      case 35: // SETWORLDTRANSFORM
        out.dc.xf = xform(a);
        break;
      case 36: {
        // MODIFYWORLDTRANSFORM (Xform, Mode: 1 恒等・2 左から掛ける・3 右から掛ける・4 置き換える)
        const x = xform(a);
        const cur: Xf = out.dc.xf ?? [1, 0, 0, 1, 0, 0];
        const mode = u32(a + 24);
        out.dc.xf = mode === 1 ? undefined : mode === 2 ? mul(cur, x) : mode === 3 ? mul(x, cur) : mode === 4 ? x : out.dc.xf;
        break;
      }
      case 15: // SETPIXELV (Pixel, Color)
        out.fillRects([[i32(a), i32(a + 4), i32(a) + 1, i32(a + 4) + 1]], colorRef(u32(a + 8)));
        break;
      case 76: // BITBLT
      case 77: {
        // STRETCHBLT (Bounds, xDest, yDest, cxDest, cyDest, rop, xSrc, ySrc, XformSrc, BkColorSrc, UsageSrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, [cxSrc, cySrc])
        const cx = i32(a + 24);
        const cy = i32(a + 28);
        const src =
          u32(a + 80) > 0
            ? {
                bmi: p + u32(a + 76),
                bits: p + u32(a + 84),
                end: Math.min(end, p + u32(a + 84) + u32(a + 88)),
                usage: u32(a + 72),
              }
            : undefined;
        const sr: [number, number, number, number] = [i32(a + 36), i32(a + 40), type === 77 ? i32(a + 92) : cx, type === 77 ? i32(a + 96) : cy];
        blit(out, b, u32(a + 32), [i32(a + 16), i32(a + 20), cx, cy], src, sr);
        break;
      }
      case 114: {
        // ALPHABLEND (Bounds, xDest, yDest, cxDest, cyDest, BLENDFUNCTION (BlendOperation, BlendFlags, SrcConstantAlpha, AlphaFormat),
        // xSrc, ySrc, XformSrc, BkColorSrc, UsageSrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, cxSrc, cySrc)
        if (b[a + 32] !== 0 || u32(a + 80) === 0) break;
        const src = {
          bmi: p + u32(a + 76),
          bits: p + u32(a + 84),
          end: Math.min(end, p + u32(a + 84) + u32(a + 88)),
          usage: u32(a + 72),
        };
        alphaBlend(out, b, [i32(a + 16), i32(a + 20), i32(a + 24), i32(a + 28)], src, [i32(a + 36), i32(a + 40), i32(a + 92), i32(a + 96)], b[a + 34], b[a + 35] === 1);
        break;
      }
      case 81: // STRETCHDIBITS (Bounds, xDest, yDest, xSrc, ySrc, cxSrc, cySrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, UsageSrc, rop, cxDest, cyDest)
        blit(
          out,
          b,
          u32(a + 60),
          [i32(a + 16), i32(a + 20), i32(a + 64), i32(a + 68)],
          {
            bmi: p + u32(a + 40),
            bits: p + u32(a + 48),
            end: Math.min(end, p + u32(a + 48) + u32(a + 52)),
            usage: u32(a + 56),
          },
          [i32(a + 24), i32(a + 28), i32(a + 32), i32(a + 36)],
        );
        break;
      case 80: // SETDIBITSTODEVICE (Bounds, xDest, yDest, xSrc, ySrc, cxSrc, cySrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, UsageSrc, iStartScan, cScans)
        setDibToDevice(
          out,
          b,
          [i32(a + 16), i32(a + 20), i32(a + 32), i32(a + 36)],
          {
            bmi: p + u32(a + 40),
            bits: p + u32(a + 48),
            end: Math.min(end, p + u32(a + 48) + u32(a + 52)),
            usage: u32(a + 56),
            scans: u32(a + 64),
          },
          i32(a + 24),
          i32(a + 28),
          u32(a + 60),
        );
        break;
      case 59: // BEGINPATH
        out.path = '';
        break;
      case 61: // CLOSEFIGURE
        if (out.path !== null) out.path += 'Z';
        break;
      case 60: // ENDPATH
        break;
      case 62: // FILLPATH
      case 63: // STROKEANDFILLPATH
      case 64: {
        // STROKEPATH
        const d = out.path ?? '';
        out.path = null;
        if (d) {
          const fill = type !== 64 ? out.fillAttrs() : 'fill="none"';
          const stroke = type !== 62 ? out.strokeAttrs() : 'stroke="none"';
          out.emit(`<path d="${d}" ${fill} ${stroke}/>`);
        }
        break;
      }
      case 83: // EXTTEXTOUTA
      case 84: {
        // EXTTEXTOUTW (bounds, graphicsMode, exScale, eyScale, EMRTEXT)
        const t = a + 28;
        const x = i32(t);
        const y = i32(t + 4);
        const off = p + u32(t + 12);
        const n = fit(off, u32(t + 8), type === 84 ? 2 : 1);
        const s = type === 84 ? new TextDecoder('utf-16le').decode(b.subarray(off, off + n * 2)) : decoderFor(out.dc.font.charset).decode(b.subarray(off, off + n));
        // EmrText ([MS-EMF] 2.2.5): Options の ETO_NO_RECT (0x100) が無ければ Rectangle (16 バイト) の後ろに offDx。
        // OutputDx は字の数 (ETO_PDY (0x2000) なら 2 倍: 横・縦の組) の 32 ビットの整数
        const eopts = u32(t + 16);
        const offDx = u32(t + (eopts & 0x100 ? 20 : 36));
        let dx: number[] | undefined;
        let dy: number[] | undefined;
        const pdy = !!(eopts & 0x2000);
        if (offDx > 0 && p + offDx + n * 4 * (pdy ? 2 : 1) <= end) {
          const at = p + offDx;
          const vals = Array.from({ length: n * (pdy ? 2 : 1) }, (_, k) => i32(at + 4 * k));
          dx = pdy ? vals.filter((_, k) => k % 2 === 0) : vals;
          if (pdy) dy = vals.filter((_, k) => k % 2 === 1);
          // EXTTEXTOUTA: 値はバイトごと (n はバイトの数)。2 バイトの文字コード (Shift_JIS など) の字は、その字のバイトの値を足す (WMF の EXTTEXTOUT と同じ)
          if (type === 83 && Array.from(s).length !== n) {
            const lens = byteLengths(b.subarray(off, off + n), out.dc.font.charset);
            if (lens.length === Array.from(s).length) {
              const merge = (arr: number[]) => {
                let k = 0;
                return lens.map((len) => {
                  const d = arr.slice(k, k + len).reduce((t2, x2) => t2 + x2, 0);
                  k += len;
                  return d;
                });
              };
              dx = merge(dx);
              if (dy) dy = merge(dy);
            }
          }
        }
        // Rectangle (RectL: left, top, right, bottom。ETO_NO_RECT が無いとき)
        const rect = eopts & 0x100 ? undefined : ([i32(t + 20), i32(t + 24), i32(t + 28), i32(t + 32)] as [number, number, number, number]);
        out.textBox(rect, eopts, () => out.text(x, y, s, dx, dy));
        break;
      }
      case 14: // EOF
        p = b.length;
        continue;
      default:
        break;
    }
    } catch (e) {
      if (e instanceof RangeError || e instanceof TypeError) break records;
      throw e;
    }
    p += size;
  }
  const ext = out.dc.winExt;
  // 座標系: window の原点・大きさ (SETWINDOW*) があればそれ、無ければ装置座標の外接矩形
  const vb: [number, number, number, number] = ext ? [out.dc.winOrg[0], out.dc.winOrg[1], ext[0], ext[1]] : [bounds[0], bounds[1], bounds[2] - bounds[0] + 1, bounds[3] - bounds[1] + 1];
  return finish(out, vb, widthPx, heightPx);
}
