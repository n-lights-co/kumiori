/**
 * paint — Area Tree を再帰走査し、描画命令 (Painter) に落とす共通ウォーカー。
 * Canvas / PDF レンダラーは Painter を実装するだけで、座標計算は完全に共有される。
 * 座標はすべて「Sheet 左上原点・y 下向き・pt」。PDF 側で下原点に変換する。
 */
import { parseColor } from './color';
import type { Matrix, Seg } from './matrix';
import type { Area, BorderRadius, BorderSide, GlyphArea, ImageArea, Rect, SheetArea } from './types';

export type { Matrix } from './matrix';

/** 疑似斜体の傾き (tan 12°) */
export const ITALIC_SLANT = 0.2126;
/** 疑似太字で輪郭をなぞる太さ (字の大きさに対する比) */
export const FAKE_BOLD = 0.03;

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 図形の輪郭 (Sheet 座標)。C は 3 次ベジェ (matrix.ts の Seg と同じ形) */
export type PathSeg = Seg;

/** 角を楕円 (半径 rx・ry) で丸めた矩形 */
export function roundRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): PathSeg[] {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  const k = 0.5523; // 1/4 円をベジェで近似する係数
  const cx = rx * k;
  const cy = ry * k;
  return [
    { op: 'M', x: x + rx, y },
    { op: 'L', x: x + w - rx, y },
    { op: 'C', x1: x + w - rx + cx, y1: y, x2: x + w, y2: y + ry - cy, x: x + w, y: y + ry },
    { op: 'L', x: x + w, y: y + h - ry },
    { op: 'C', x1: x + w, y1: y + h - ry + cy, x2: x + w - rx + cx, y2: y + h, x: x + w - rx, y: y + h },
    { op: 'L', x: x + rx, y: y + h },
    { op: 'C', x1: x + rx - cx, y1: y + h, x2: x, y2: y + h - ry + cy, x, y: y + h - ry },
    { op: 'L', x, y: y + ry },
    { op: 'C', x1: x, y1: y + ry - cy, x2: x + rx - cx, y2: y, x: x + rx, y },
    { op: 'Z' },
  ];
}

/** 角ごとの半径の角丸の輪郭 (radii: 左上・右上・右下・左下の [水平, 垂直])。半径の和が辺より長ければ、すべてを同じ比で縮める (CSS) */
export function roundRectPathCorners(x: number, y: number, w: number, h: number, radii: Array<[number, number]>): PathSeg[] {
  const r = radii.map(([a, b]) => [Math.max(a, 0), Math.max(b, 0)] as [number, number]);
  // 隣り合う半径の和が辺の長さを超えれば、すべての半径を同じ比で縮める (CSS Backgrounds 3 §4.5)。和が 0 の辺は制限しない
  const fit = (len: number, sum: number) => (sum > 0 ? len / sum : Infinity);
  const f = Math.min(1, fit(w, r[0][0] + r[1][0]), fit(w, r[3][0] + r[2][0]), fit(h, r[0][1] + r[3][1]), fit(h, r[1][1] + r[2][1]));
  const [tl, tr, br, bl] = r.map(([a, b]) => [a * f, b * f]);
  const k = 0.5523;
  return [
    { op: 'M', x: x + tl[0], y },
    { op: 'L', x: x + w - tr[0], y },
    { op: 'C', x1: x + w - tr[0] + tr[0] * k, y1: y, x2: x + w, y2: y + tr[1] - tr[1] * k, x: x + w, y: y + tr[1] },
    { op: 'L', x: x + w, y: y + h - br[1] },
    { op: 'C', x1: x + w, y1: y + h - br[1] + br[1] * k, x2: x + w - br[0] + br[0] * k, y2: y + h, x: x + w - br[0], y: y + h },
    { op: 'L', x: x + bl[0], y: y + h },
    { op: 'C', x1: x + bl[0] - bl[0] * k, y1: y + h, x2: x, y2: y + h - bl[1] + bl[1] * k, x, y: y + h - bl[1] },
    { op: 'L', x, y: y + tl[1] },
    { op: 'C', x1: x, y1: y + tl[1] - tl[1] * k, x2: x + tl[0] - tl[0] * k, y2: y, x: x + tl[0], y },
    { op: 'Z' },
  ];
}

export interface Painter {
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  /** x, y: GlyphArea 左上の Sheet 座標 */
  drawGlyph(g: GlyphArea, x: number, y: number): void;
  /** 画像 (画像データがある場合のみ。無い場合は paint が灰色のプレースホルダを描く) */
  drawImage(a: ImageArea, x: number, y: number): void;
  /**
   * 画像 a を (x, y) から a.width・a.height の間隔で縦横に繰り返して region を埋める (背景画像の repeat)。
   * 描画先がタイルを 1 つの模様 (PDF のタイリングパターンなど) にできるときに実装する。扱えなければ false を返し、呼び手が 1 枚ずつ描く
   */
  drawImageTiled?(a: ImageArea, x: number, y: number, region: Rect): boolean;
  /** 座標変換 m = [a,b,c,d,e,f] (局所 → Sheet 座標, x' = a·x + c·y + e, y' = b·x + d·y + f) の中で draw を実行する */
  transform(m: Matrix, draw: () => void): void;
  strokeLine(l: Line, width: number, color?: string): void;
  clipRect(r: Rect): void;
  restore(): void;
  /**
   * 閉じた図形を塗る (角丸・影・罫線の角の台形)。evenOdd: 偶奇規則で塗る (重なった部分は抜ける)。opacity: 塗りの不透明度 (影)。
   * fillPath・clipPath・strokePath は Canvas・PDF のどちらも実装する (必須)
   */
  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity?: number): void;
  /** 図形で切り抜く (restore で戻す)。evenOdd: 偶奇規則 */
  clipPath(path: PathSeg[], evenOdd?: boolean): void;
  /** 図形を線で描く (角丸の罫線・波線・細い線)。dash は [線の長さ, 間隔] */
  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]): void;
  /** リンク・注釈・フォームの欄 (a.link / a.annotation / a.formField を持つ領域)。PDF は注釈・欄を作り、Canvas は目印・欄の見本を描く */
  mark?(a: Area, x: number, y: number): void;
}

/**
 * 紙の端にぴったり接する辺を、端の外へ少し伸ばす量 (pt)。低い解像度で描いたとき (比較の画像・画面の表示)、紙の幅が画素の整数倍でないと
 * 端の画素は部分的にしか覆われず、紙の端まで塗った箱や画像の端が薄い線に見える。紙の外にはみ出した分は描かれないので、見た目は変わらない。
 * トンボを付けるとき (塗り足しの外にトンボの領域がある) は伸ばさない
 */
const EDGE_SNAP = 2;
let edgeSnap: Rect | undefined;
/** 矩形の、紙の端に接する辺を EDGE_SNAP だけ外へ伸ばす (edgeSnap が無ければそのまま) */
function snapToEdge(r: Rect): Rect {
  const s = edgeSnap;
  if (!s) return r;
  const eps = 0.02;
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.width;
  let y1 = r.y + r.height;
  if (Math.abs(x0 - s.x) < eps) x0 -= EDGE_SNAP;
  if (Math.abs(y0 - s.y) < eps) y0 -= EDGE_SNAP;
  if (Math.abs(x1 - (s.x + s.width)) < eps) x1 += EDGE_SNAP;
  if (Math.abs(y1 - (s.y + s.height)) < eps) y1 += EDGE_SNAP;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function paintSheet(sheet: SheetArea, p: Painter, opts: { guides?: boolean } = {}) {
  // 紙の端まで塗る箱・画像の辺を、端の外へ少し伸ばす (塗り足し (bleedBox) が用紙そのものの (トンボの無い) ときだけ)
  const bb = sheet.bleedBox;
  edgeSnap = !sheet.trimMarks && Math.abs(bb.x) < 0.02 && Math.abs(bb.y) < 0.02 && Math.abs(bb.width - sheet.width) < 0.02 && Math.abs(bb.height - sheet.height) < 0.02 ? bb : undefined;
  // 1) 塗り足しを含む領域に用紙全体の背景
  if (sheet.backgroundColor) {
    const b = snapToEdge(sheet.backgroundBox ?? sheet.bleedBox);
    p.fillRect(b.x, b.y, b.width, b.height, sheet.backgroundColor);
  }
  // 1') 用紙全体の背景画像 (塗り足しを含む範囲。本文の下)
  if (sheet.backgroundImage) {
    const b = sheet.backgroundBox ?? sheet.bleedBox;
    paintBackgroundImage({ ...sheet, width: b.width, height: b.height, border: {}, backgroundImage: sheet.backgroundImage } as unknown as Area, b.x, b.y, p);
  }
  // 2) 内容は塗り足し領域までで裁ち落とす (トンボ領域には描かない)
  p.clipRect(snapToEdge(sheet.bleedBox));
  paintArea(sheet.page, 0, 0, p);
  p.restore();
  edgeSnap = undefined;
  // 3) トンボ
  if (sheet.trimMarks) for (const l of trimMarkLines(sheet)) p.strokeLine(l, sheet.trimMarkLineWidth ?? TRIM_MARK_WIDTH);
  if (opts.guides) {
    const t = sheet.trimBox;
    const b = sheet.bleedBox;
    for (const r of [t, b]) {
      const c = r === t ? '#e0006a' : '#00a0e9';
      for (const l of rectLines(r)) p.strokeLine(l, 0.3, c);
    }
  }
}

export const TRIM_MARK_WIDTH = 0.3; // pt ≒ 0.1mm

/**
 * 角丸の箱の形を作る関数 (rad が無ければ角の無い矩形)。boxW × boxH は百分率の基準 (border の箱の大きさ)。
 * inset は内側の形 (padding の箱など) にするときに角の半径から引く量 (CSS Backgrounds 3 §5.1: 内側の半径 = 外側の半径 − 罫線の太さ)
 */
export function radiusShape(rad: BorderRadius | undefined, boxW: number, boxH: number) {
  const corners = rad?.corners?.map(([h, v]) => [typeof h === 'string' ? (parseFloat(h) * boxW) / 100 : h, typeof v === 'string' ? (parseFloat(v) * boxH) / 100 : v] as [number, number]);
  return (sx: number, sy: number, sw: number, sh: number, inset = 0) =>
    corners
      ? roundRectPathCorners(sx, sy, sw, sh, corners.map(([h, v]) => [Math.max(h - inset, 0), Math.max(v - inset, 0)]))
      : roundRectPath(sx, sy, sw, sh, Math.max((rad?.rx ?? 0) - inset, 0), Math.max((rad?.ry ?? 0) - inset, 0));
}

function rectLines(r: Rect): Line[] {
  return [
    { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y },
    { x1: r.x + r.width, y1: r.y, x2: r.x + r.width, y2: r.y + r.height },
    { x1: r.x + r.width, y1: r.y + r.height, x2: r.x, y2: r.y + r.height },
    { x1: r.x, y1: r.y + r.height, x2: r.x, y2: r.y },
  ];
}

/** 画像データが無いとき: 薄い灰色の枠に対角線 */
function paintPlaceholder(a: ImageArea, x: number, y: number, p: Painter) {
  p.fillRect(x, y, a.width, a.height, '#f0f0f0');
  const c = '#b0b0b0';
  const corners = [
    { x1: x, y1: y, x2: x + a.width, y2: y },
    { x1: x + a.width, y1: y, x2: x + a.width, y2: y + a.height },
    { x1: x + a.width, y1: y + a.height, x2: x, y2: y + a.height },
    { x1: x, y1: y + a.height, x2: x, y2: y },
    { x1: x, y1: y, x2: x + a.width, y2: y + a.height },
    { x1: x + a.width, y1: y, x2: x, y2: y + a.height },
  ];
  for (const l of corners) p.strokeLine(l, 0.4, c);
}

/**
 * 回転した箱 (反時計回り θ) の、局所座標 → Sheet 座標の変換。
 * (x, y) は回転後の外接矩形の左上、w × h は回転前の局所サイズ。
 *   90°  : 局所の右 → 上、下 → 右        x' = x + v,     y' = y + w − u
 *   270° : 局所の右 → 下、下 → 左        x' = x + h − v, y' = y + u
 *   180° : 両方反転                      x' = x + w − u, y' = y + h − v
 */
export function rotationMatrix(rot: 90 | 180 | 270, x: number, y: number, w: number, h: number): Matrix {
  if (rot === 90) return [0, -1, 1, 0, x, y + w];
  if (rot === 270) return [0, 1, -1, 0, x + h, y];
  return [-1, 0, 0, -1, x + w, y + h];
}

/**
 * 描く段 (CSS 2.1 §9.9.1 の、重ね合わせの文脈の中で描く層の順)。回り込み (float) を子に持つ箱では、
 * 流れの中のブロックの背景・罫線 ('bg') → 回り込み ('all') → 流れの中の行内の中身 ('fg') の順に描く
 * (§9.5: 回り込みは、位置指定の無い流れの中のブロックより手前、行内の中身より奥に描く)。
 * 'all' は箱をまるごと描く
 */
export type PaintPhase = 'all' | 'bg' | 'fg';

/**
 * 描いている途中の箱 (子を持つ領域)。Area Tree の入れ子は、呼び出しの入れ子 (再帰) ではなく、この物の並び (明示のスタック) でたどる
 * (OUT-14)。再帰でたどると、入れ子の 1 段ごとに、局所変数の多い paintArea と paintChildren の 2 つの枠を積み、Node の既定の
 * スタック (984KB) では、領域の入れ子が約 1000 段 (flex・grid の入れ子は要素の 1 段で領域が 4 段になるので、要素の約 250 段) で
 * スタックを使い切った。描く順 (Painter の呼び出しの並び) は、再帰でたどっていたときと同じ
 */
interface OpenBox {
  a: Area;
  /** 箱の border-box の左上 (Sheet 座標) */
  x: number;
  y: number;
  /** 箱の影・背景・罫線を描くか (中身の段 'fg' では描かない) */
  box: boolean;
  /** 子の原点 (content-box の左上) */
  cx: number;
  cy: number;
  /** 子を描く順に並べたもの。phases は子ごとの描く段 (無ければ、どの子も 'all') */
  kids: Area[];
  phases: PaintPhase[] | undefined;
  /** 次に描く子の位置 */
  i: number;
}

/**
 * 回転した箱 (orientation) の入れ子の上限。回転した箱だけは、Painter.transform(m, draw) が「draw の中で描く」形なので、
 * 再帰でたどる (1 つの回転で、paintArea・openArea・transform・draw の 4 枠と、Painter の中の枠)。組版が回転した領域を作るのは
 * 回転した箱 1 つにつき 1 つで、XSL-FO の入れ子は 250 段 (xslfoImport.ts の MAX_FO_NEST)、HTML の入れ子は MAX_TREE_DEPTH
 * までなので、読み込んだ文書はここに届かない。外から渡された Area Tree (parseAreaTree で読んだ木) がこれより深く回転を重ねていたら、
 * スタックを使い切る前に誤りで止める (Node の既定のスタック (984KB) で、PDF の描画は 900 段まで通り、1000 段で切れると測った。その 1/3)
 */
export const MAX_NESTED_ORIENTATIONS = 300;
let orientationDepth = 0;

/** 子を、描く順に並べる。回り込みの子があれば、上の段の順に分けて描く */
function childOrder(kids: Area[], phase: PaintPhase): { kids: Area[]; phases: PaintPhase[] | undefined } {
  if (phase === 'all' && !kids.some((c) => c.float)) return { kids, phases: undefined };
  const order: Area[] = [];
  const phases: PaintPhase[] = [];
  if (phase !== 'fg') {
    for (const c of kids)
      if (!c.float) {
        order.push(c);
        phases.push('bg');
      }
    for (const c of kids)
      if (c.float) {
        order.push(c);
        phases.push('all');
      }
  }
  if (phase !== 'bg')
    for (const c of kids)
      if (!c.float) {
        order.push(c);
        phases.push('fg');
      }
  return { kids: order, phases };
}

/** 領域 a (とその子孫) を描く。(ox, oy) は a の親の content-box の左上 (Sheet 座標) */
export function paintArea(a: Area, ox: number, oy: number, p: Painter, phase: PaintPhase = 'all') {
  const first = openArea(a, ox, oy, p, phase);
  if (!first) return;
  const stack: OpenBox[] = [first];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.kids.length) {
      stack.pop();
      closeArea(top, p);
      continue;
    }
    const k = top.i++;
    const child = openArea(top.kids[k], top.cx, top.cy, p, top.phases ? top.phases[k] : 'all');
    if (child) stack.push(child);
  }
}

/**
 * 領域の、子より前に描くもの (影・背景・切り抜きの始まり) を描く。子を持つ領域なら、続き (子と、子より後に描く罫線) のための
 * OpenBox を返す。子の無い領域 (字・画像) と、この段では描かない領域は、ここで描き終えて undefined を返す
 */
function openArea(a: Area, ox: number, oy: number, p: Painter, phase: PaintPhase): OpenBox | undefined {
  if (a.orientation) {
    // 局所座標系 (原点 = 箱の左上) へ移って、回転なしの箱として描く
    const m = rotationMatrix(a.orientation as 90 | 180 | 270, ox + a.x, oy + a.y, a.width, a.height);
    if (orientationDepth >= MAX_NESTED_ORIENTATIONS) throw new Error(`回転した領域 (orientation) の入れ子が深すぎます (${MAX_NESTED_ORIENTATIONS} 段まで)`);
    orientationDepth++;
    try {
      p.transform(m, () => paintArea({ ...a, x: 0, y: 0, orientation: undefined } as Area, 0, 0, p, phase));
    } finally {
      orientationDepth--;
    }
    return undefined;
  }
  const x = ox + a.x;
  const y = oy + a.y;
  // 行と行内の中身 (字・画像・ルビ・縦中横) は、背景の段では描かず、中身の段でまるごと描く
  const inlineLevel = a.type === 'glyph' || a.type === 'image' || a.type === 'line' || a.type === 'inline' || a.type === 'ruby' || a.type === 'tate-chu-yoko';
  if (inlineLevel && phase === 'bg') return undefined;
  if (inlineLevel) phase = 'all';
  // 中身の段では、箱の影・背景・罫線は描かない (背景の段で描いた)
  const box = phase !== 'fg';
  if (a.type === 'glyph') {
    // 見えない字 (CSS の visibility: hidden。色が transparent) は描かない
    if (a.color !== 'transparent') p.drawGlyph(a, x, y);
    return undefined;
  }
  if (a.type === 'image' && a.hidden) return undefined;
  if (a.type === 'image') {
    // 角丸 (border-radius): 画像 (置換要素の中身) も角丸で切り抜く (CSS Backgrounds 3 §5.3)
    const round = a.borderRadius && !a.missing;
    if (round) p.clipPath(radiusShape(a.borderRadius, a.width, a.height)(x, y, a.width, a.height));
    if (a.missing) paintPlaceholder(a, x, y, p);
    else if (a.fit && a.naturalWidth && a.naturalHeight) {
      // object-fit: 縦横比を保って、枠を覆う (cover) / 枠に収める (contain) 大きさで中央に置き、枠で切り抜く
      const s = (a.fit === 'cover' ? Math.max : Math.min)(a.width / a.naturalWidth, a.height / a.naturalHeight);
      const w = a.naturalWidth * s;
      const h = a.naturalHeight * s;
      p.clipRect({ x, y, width: a.width, height: a.height });
      p.drawImage({ ...a, width: w, height: h }, x + (a.width - w) / 2, y + (a.height - h) / 2);
      p.restore();
    } else p.drawImage(a, x, y);
    if (round) p.restore();
    return undefined;
  }
  if (box && (a.link || a.annotation || a.formField)) p.mark?.(a, x, y);
  // 角丸 (axf:border-radius)
  const rad = a.borderRadius;
  // 角ごとの半径 (百分率は箱の大きさに対して)
  const shape = radiusShape(rad, a.width, a.height);
  // 影 (axf:box-shadow): 箱の形をずらしたもの。箱の内側には出さない (背景が透明でも、影は箱の外だけに見える)
  // CSS の box-shadow: 広がり (spread) だけ太らせ、ぼかし (blur。σ = blur / 2) は 0・0.5σ・σ・1.5σ・2σ 太らせた半透明の形の重ねで表す
  // (縁で約半分、2σ でほぼ 0 の濃さ)。複数なら、後のものから描く (先のものが上)
  for (const sh of box && a.boxShadow ? [a.boxShadow].flat().reverse() : []) {
    if (sh.inset) continue; // 内側の影は背景の上に描く (下)
    {
      const std = (sh.blur ?? 0) / 2;
      const spread = sh.spread ?? 0;
      const op = sh.opacity ?? 1;
      const grows = std > 0 ? [2, 1.5, 1, 0.5, 0].map((k) => k * std) : [0];
      const cum = std > 0 ? [0.03, 0.08, 0.17, 0.32, 0.6].map((c) => c * op) : [op];
      grows.forEach((g, k) => {
        const e = spread + g;
        const alpha = 1 - (1 - cum[k]) / (1 - (k ? cum[k - 1] : 0));
        if (a.width + 2 * e <= 0 || a.height + 2 * e <= 0) return;
        // 角丸の無い箱の広がりは角を丸めない (CSS と同じ)。ぼかしの層は太らせた分だけ丸める
        const round = rad ? -e : -g;
        // 箱の内側には出さない。背景があれば隠れるので、くり抜かない (くり抜きの縁と箱の縁が重なって、細い線に見えるのを避ける)
        const outer = shape(x + sh.dx - e, y + sh.dy - e, a.width + 2 * e, a.height + 2 * e, round);
        if (a.backgroundColor && !/^#[0-9a-f]{8}$/i.test(a.backgroundColor)) p.fillPath(outer, sh.color, false, alpha);
        else {
          // 箱の外だけに塗る (CSS Backgrounds 3 §7.1: 外側の影は、箱の境界の箱の内側では切り取る): 影と箱を囲む矩形から箱を抜いた形で切り抜く
          const bx = Math.min(x, x + sh.dx - e) - 1;
          const by = Math.min(y, y + sh.dy - e) - 1;
          const bw = Math.max(x + a.width, x + sh.dx + a.width + e) + 1 - bx;
          const bh = Math.max(y + a.height, y + sh.dy + a.height + e) + 1 - by;
          p.clipPath([...roundRectPath(bx, by, bw, bh, 0, 0), ...shape(x, y, a.width, a.height)], true);
          p.fillPath(outer, sh.color, false, alpha);
          p.restore();
        }
      });
    }
  }
  // 半透明の背景 (#rrggbbaa): 下の色と重ねて塗る
  const bgA = a.backgroundColor && /^#[0-9a-f]{8}$/i.test(a.backgroundColor) ? parseInt(a.backgroundColor.slice(7), 16) / 255 : undefined;
  if (box && a.backgroundColor && bgA !== undefined) {
    p.fillPath(shape(x, y, a.width, a.height), a.backgroundColor.slice(0, 7), false, bgA);
  } else if (box && a.backgroundColor && a.backgroundColor !== 'transparent') {
    if (rad) p.fillPath(shape(x, y, a.width, a.height), a.backgroundColor);
    else {
      const r = snapToEdge({ x, y, width: a.width, height: a.height });
      p.fillRect(r.x, r.y, r.width, r.height, a.backgroundColor);
    }
  }
  if (box && a.backgroundImage) paintBackgroundImage(a, x, y, p);
  const bt = a.border.top?.width ?? 0;
  const br = a.border.right?.width ?? 0;
  const bb = a.border.bottom?.width ?? 0;
  const bl = a.border.left?.width ?? 0;
  // 内側の影 (box-shadow: inset。CSS Backgrounds 3 §7.1): 背景の上・中身の下に、padding の箱の内側だけに描く。
  // 影の形 = padding の箱を dx・dy だけずらし、広がり (spread) とぼかしの層の分だけ縮めた矩形。その外側 (padding の箱との間) を塗る。
  // ぼかしは外側の影と同じく、0・0.5σ・σ・1.5σ・2σ 縮めた層の重ねで表す (縁がいちばん濃い)
  if (box && a.boxShadow) {
    const pbx = x + bl;
    const pby = y + bt;
    const pbw = Math.max(a.width - bl - br, 0);
    const pbh = Math.max(a.height - bt - bb, 0);
    for (const sh of [a.boxShadow].flat().reverse()) {
      if (!sh.inset || pbw <= 0 || pbh <= 0) continue;
      const std = (sh.blur ?? 0) / 2;
      const spread = sh.spread ?? 0;
      const op = sh.opacity ?? 1;
      const grows = std > 0 ? [2, 1.5, 1, 0.5, 0].map((k) => k * std) : [0];
      const cum = std > 0 ? [0.03, 0.08, 0.17, 0.32, 0.6].map((c) => c * op) : [op];
      const padBox = shape(pbx, pby, pbw, pbh, bt);
      p.clipPath(padBox);
      grows.forEach((g, k) => {
        const e = spread + g;
        const alpha = 1 - (1 - cum[k]) / (1 - (k ? cum[k - 1] : 0));
        const iw = pbw - 2 * e;
        const ih = pbh - 2 * e;
        if (iw <= 0 || ih <= 0) p.fillPath(padBox, sh.color, false, alpha);
        else p.fillPath([...padBox, ...shape(pbx + sh.dx + e, pby + sh.dy + e, iw, ih, bt + e)], sh.color, true, alpha);
      });
      p.restore();
    }
  }
  // 子の原点 = border + padding の内側 (content-box 左上)
  const cx = x + bl + a.padding.left;
  const cy = y + bt + a.padding.top;
  // overflow="hidden": 子を padding の外端 (border の内側) で切り抜く
  // 角丸の箱は、padding の箱の角丸 (外側の半径 − 罫線の太さ) で切り抜く (CSS Backgrounds 3 §5.3)
  if (a.clip && rad) p.clipPath(shape(x + bl, y + bt, Math.max(a.width - bl - br, 0), Math.max(a.height - bt - bb, 0), bt));
  else if (a.clip) p.clipRect({ x: x + bl, y: y + bt, width: Math.max(a.width - bl - br, 0), height: Math.max(a.height - bt - bb, 0) });
  // 子は、paintArea の繰り返しが描く (描く順は areaTree.ts の childrenOf と同じ)
  let order: { kids: Area[]; phases: PaintPhase[] | undefined };
  switch (a.type) {
    case 'page':
      order = { kids: [...a.behindAreas, a.regionBody, ...a.absoluteAreas], phases: undefined };
      break;
    case 'ruby':
      order = { kids: [...a.base, ...a.ruby], phases: undefined };
      break;
    case 'tate-chu-yoko':
      order = { kids: a.glyphs, phases: undefined };
      break;
    case 'sheet':
      order = { kids: [], phases: undefined };
      break;
    default:
      order = childOrder(a.children, phase);
  }
  return { a, x, y, box, cx, cy, kids: order.kids, phases: order.phases, i: 0 };
}

/** 領域の、子より後に描くもの (切り抜きの終わり・罫線・斜めの罫線) を描く */
function closeArea(o: OpenBox, p: Painter) {
  const { a, x, y, box } = o;
  if (a.clip) p.restore();
  if (!box) return;
  const rad = a.borderRadius;
  const shape = radiusShape(rad, a.width, a.height);
  const bt = a.border.top?.width ?? 0;
  const br = a.border.right?.width ?? 0;
  const bb = a.border.bottom?.width ?? 0;
  const bl = a.border.left?.width ?? 0;
  // 角丸の罫線は、4 辺が同じ (太さ・線種・色) ときだけ輪郭として描く。辺ごとに違えば角を丸めない
  const sides = [a.border.top, a.border.right, a.border.bottom, a.border.left];
  const roundBorder = rad && bt > 0 && sides.every((b) => b && b.width === bt && (b.style ?? 'solid') === (a.border.top!.style ?? 'solid') && b.color === a.border.top!.color);
  // 罫線は子 (負の margin ではみ出した子の背景・罫線を含む) より前面に描く
  if (roundBorder) {
    const b = a.border.top!;
    const style = b.style ?? 'solid';
    if (style === 'double' && bt >= 2.4) {
      p.strokePath(shape(x + bt / 6, y + bt / 6, a.width - bt / 3, a.height - bt / 3, bt / 6), bt / 3, b.color);
      p.strokePath(shape(x + (5 * bt) / 6, y + (5 * bt) / 6, a.width - (5 * bt) / 3, a.height - (5 * bt) / 3, (5 * bt) / 6), bt / 3, b.color);
    } else {
      p.strokePath(shape(x + bt / 2, y + bt / 2, a.width - bt, a.height - bt, bt / 2), bt, b.color, dashOf(style, bt));
    }
    paintDiagonals(a, x, y, p);
    return;
  }
  // 表の罫線の重ね合わせで半分ずつ持つ辺 (BorderSide.collapse): noPaint は描かない。paintWidth は、その太さで箱の外へはみ出して描く
  const B = a.border;
  const pw = (s: BorderSide | undefined, w: number) => (s?.collapse?.noPaint ? 0 : (s?.collapse?.paintWidth ?? w));
  const pt = pw(B.top, bt);
  const pb = pw(B.bottom, bb);
  const pl = pw(B.left, bl);
  const pr = pw(B.right, br);
  // ごく細い実線 (0.25pt 未満) の辺は、辺ごとに中心線を線 (stroke) として描く (台形で切り抜いた線にする)。
  // 台形を塗ると、表示では細くかすれるが、線で描けば表示でも 1 画素以上の太さになる
  const plain = (sd: BorderSide | undefined, w: number) => !!sd && w > 0 && w < 0.25 && !sd.collapse?.noPaint && sd.collapse?.paintWidth === undefined && (sd.style ?? 'solid') === 'solid';
  const W = a.width;
  const H = a.height;
  const kt = plain(B.top, bt) ? bt : 0;
  const kb = plain(B.bottom, bb) ? bb : 0;
  const kl = plain(B.left, bl) ? bl : 0;
  const kr = plain(B.right, br) ? br : 0;
  const trap = (sd: BorderSide, x1: number, y1: number, x2: number, y2: number, w: number) => {
    if (sd.color === 'transparent') return;
    p.strokePath([{ op: 'M', x: x1, y: y1 }, { op: 'L', x: x2, y: y2 }], w, sd.color);
  };

  // 表とセルの罫線は対象にしない (表の罫線は線として描くので、細くても表示では 1 画素以上の太さになる)
  const traps = a.type !== 'table' && a.type !== 'table-cell';
  const ph = dashPhases([B.top, B.right, B.bottom, B.left], [pt, pr, pb, pl], [W, H, W, H]);
  // 角を斜めに突き合わせる (台形で描く) ときの、隣の辺の太さ (始めの端・終わりの端)。突き合わせないなら 0
  // 表のセルは、表の外の角 (両方の辺が表の外周) だけを突き合わせる。中の罫線との交わりは、線を切らずに通す
  const cell = a.type === 'table-cell';
  const ok = (sd: BorderSide | undefined, adj: BorderSide | undefined) => mitreWith(sd, adj) && (!cell || (!!sd?.collapse?.tableEdge && !!adj?.collapse?.tableEdge));
  const mi = (sd: BorderSide | undefined, a1: BorderSide | undefined, w1: number, a2: BorderSide | undefined, w2: number): [number, number] => [ok(sd, a1) ? w1 : 0, ok(sd, a2) ? w2 : 0];
  const mT = mi(B.top, B.left, pl, B.right, pr);
  const mB = mi(B.bottom, B.left, pl, B.right, pr);
  const mL = mi(B.left, B.top, pt, B.bottom, pb);
  const mR = mi(B.right, B.top, pt, B.bottom, pb);
  if (traps && kt) trap(B.top!, x, y + bt / 2, x + W, y + bt / 2, bt);
  else if (pt) paintBorderSide(p, B.top!, 'top', x, y - (pt - bt), W, pt, ph[0], mT);
  if (traps && kb) trap(B.bottom!, x, y + H - bb / 2, x + W, y + H - bb / 2, bb);
  else if (pb) paintBorderSide(p, B.bottom!, 'bottom', x, y + H - bb, W, pb, ph[2], mB);
  // 表のセルの縦の辺は、突き合わせない角では、横の辺の帯の分だけ短くする (横の線を切らずに通す)
  const cut = (sd: BorderSide | undefined, adj: BorderSide | undefined, w: number) => (cell && w > 0 && mitreWith(sd, adj) && !ok(sd, adj) ? w : 0);
  const lt = cut(B.left, B.top, pt);
  const lb = cut(B.left, B.bottom, pb);
  const rt = cut(B.right, B.top, pt);
  const rb = cut(B.right, B.bottom, pb);
  if (traps && kl) trap(B.left!, x + bl / 2, y, x + bl / 2, y + H, bl);
  else if (pl) paintBorderSide(p, B.left!, 'left', x - (pl - bl), y + lt, pl, H - lt - lb, ph[3], mL);
  if (traps && kr) trap(B.right!, x + W - br / 2, y, x + W - br / 2, y + H, br);
  else if (pr) paintBorderSide(p, B.right!, 'right', x + W - br, y + rt, pr, H - rt - rb, ph[1], mR);
  paintDiagonals(a, x, y, p);
}

/** 線で描く破線・点線の、線と隙間の長さ (実線は undefined) */
function dashOf(style: string, w: number): [number, number] | undefined {
  return style === 'dashed' ? [Math.max(w * 4, 2), Math.max(w * 2, 1)] : style === 'dotted' ? [Math.max(w, 0.6), Math.max(w * 1.5, 0.9)] : undefined;
}

/**
 * 斜めの罫線 (対角罫・逆対角罫): 外枠の内側 (padding-box) の角どうしを結ぶ線。線の中心が角を通り、外枠の内側で切り抜く
 * (太い罫でも外枠に重ならず、罫の中心が内側の角に来る)
 */
function paintDiagonals(a: Area, x0: number, y0: number, p: Painter) {
  if (!a.diagonals?.length) return;
  const bl = a.border.left?.width ?? 0;
  const br = a.border.right?.width ?? 0;
  const bt = a.border.top?.width ?? 0;
  const bb = a.border.bottom?.width ?? 0;
  const x = x0 + bl;
  const y = y0 + bt;
  const W = Math.max(a.width - bl - br, 0);
  const H = Math.max(a.height - bt - bb, 0);
  p.clipRect({ x, y, width: W, height: H });
  for (const { kind, side } of a.diagonals) {
    const path: PathSeg[] = kind === 'tlbr' ? [{ op: 'M', x, y }, { op: 'L', x: x + W, y: y + H }] : [{ op: 'M', x: x + W, y }, { op: 'L', x, y: y + H }];
    p.strokePath(path, side.width, side.color, dashOf(side.style ?? 'solid', side.width));
  }
  p.restore();
}

/**
 * トンボ (日本式二重トンボ) とセンタートンボ。
 *   コーナー: 仕上がり線と塗り足し線を、塗り足しの端から外へ 10mm (紙の端まで) 伸ばす。塗り足し線は、内側の仕上がり線の位置まで
 *   伸ばして、仕上がり線と L 字につなぐ。
 *   センター: 各辺中央に、塗り足しの端から外へ 10mm の中心線と、塗り足しの幅だけ外に長さ 20mm の十字の棒。
 */
export function trimMarkLines(sheet: SheetArea): Line[] {
  const t = sheet.trimBox;
  const bleed = sheet.bleed;
  const MM = 72 / 25.4;
  // 塗り足しの端から紙の端までの長さ (辺ごと)
  const M = sheet.trimMarkMargins ?? { top: sheet.trimMarkMargin, right: sheet.trimMarkMargin, bottom: sheet.trimMarkMargin, left: sheet.trimMarkMargin };
  // 外へ伸ばす長さ: 10mm (紙の端まで)
  const Lx = (sx: number) => Math.min(10 * MM, sx < 0 ? M.left : M.right);
  const Ly = (sy: number) => Math.min(10 * MM, sy < 0 ? M.top : M.bottom);
  const lines: Line[] = [];
  if (sheet.cornerMarks !== false) {
    const corners: [number, number, number, number][] = [
      [t.x, t.y, -1, -1],
      [t.x + t.width, t.y, 1, -1],
      [t.x, t.y + t.height, -1, 1],
      [t.x + t.width, t.y + t.height, 1, 1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      const x0 = cx + sx * bleed;
      const x1 = cx + sx * (bleed + Lx(sx));
      const y0 = cy + sy * bleed;
      const y1 = cy + sy * (bleed + Ly(sy));
      // 水平線: 仕上がり線 (塗り足しの端まで) / 塗り足し線 (仕上がりの位置まで伸ばして、仕上がりの縦線とつなぐ)
      lines.push({ x1: x0, y1: cy, x2: x1, y2: cy });
      lines.push({ x1: cx, y1: y0, x2: x1, y2: y0 });
      // 垂直線: 仕上がり線 / 塗り足し線 (仕上がりの位置まで)
      lines.push({ x1: cx, y1: y0, x2: cx, y2: y1 });
      lines.push({ x1: x0, y1: cy, x2: x0, y2: y1 });
    }
  }
  if (sheet.centerMarks === false) return lines;
  // センタートンボ: 十字の棒は塗り足しの幅だけ外 (塗り足しが無ければ 3mm)、長さ 20mm (紙の中に収める)
  const barOff = bleed > 0 ? bleed : 3 * MM;
  const half = 10 * MM;
  const mx = t.x + t.width / 2;
  const my = t.y + t.height / 2;
  // 上下
  for (const sy of [-1, 1]) {
    const L = Ly(sy);
    const yEdge = sy < 0 ? t.y - bleed : t.y + t.height + bleed;
    lines.push({ x1: mx, y1: yEdge, x2: mx, y2: yEdge + sy * L });
    const yb = yEdge + sy * Math.min(barOff, L);
    lines.push({ x1: mx - half, y1: yb, x2: mx + half, y2: yb });
  }
  // 左右
  for (const sx of [-1, 1]) {
    const L = Lx(sx);
    const xEdge = sx < 0 ? t.x - bleed : t.x + t.width + bleed;
    lines.push({ x1: xEdge, y1: my, x2: xEdge + sx * L, y2: my });
    const xb = xEdge + sx * Math.min(barOff, L);
    lines.push({ x1: xb, y1: my - half, x2: xb, y2: my + half });
  }
  return lines;
}

// ───────────────────────── 罫線の線種 ─────────────────────────

/** 色を明るく (f>0, 白へ) / 暗く (f<0, 黒へ) する。CMYK は K と CMY で近似 */
function shade(css: string, f: number): string {
  const c = parseColor(css);
  const k = (v: number) => Math.max(0, Math.min(1, v));
  if (c.mode === 'rgb') {
    const m = (v: number) => Math.round(255 * k(f >= 0 ? v + (1 - v) * f : v * (1 + f)));
    return `#${[c.r, c.g, c.b].map((v) => m(v).toString(16).padStart(2, '0')).join('')}`;
  }
  // CMYK の色は、RGB (R = (1 − C)(1 − K) など) に直してから RGB で明るく・暗くする (たとえば cmyk(1,1,0,0) の groove は、
  // 暗い側が RGB (0, 0, 0.667)、明るい側が (0.502, 0.502, 1)。CSS Backgrounds 3 §3.2 は立体の罫線の色の作り方を決めていない)
  if (c.mode === 'cmyk') {
    const rgb = [c.c, c.m, c.y].map((v) => (1 - k(v)) * (1 - k(c.k)));
    const hex = `#${rgb.map((v) => Math.round(255 * v).toString(16).padStart(2, '0')).join('')}`;
    return shade(hex, f);
  }
  return css;
}

/** 長さ len の線を、dash 長の線分と gap 以上の隙間で、端まできっちり並べる位置 (開始, 長さ) */
/**
 * 破線・点線の模様の始めの位相 (上・右・下・左の順)。辺を時計回り (上は左から右、右は上から下、下は右から左、左は下から上) に描き、
 * 破線は [線 4w・空き 2w] を位相 2w (半分の長さの線) から、点線は [0・空き 2.5w] の丸い点を位相 0 から始める。
 * 時計回りで前の辺が同じ種類・太さ・色なら、模様は角をまたいで続く (位相が前の辺の長さ − w だけ進む)
 */
function dashPhases(sides: Array<BorderSide | undefined>, widths: number[], lens: number[]): number[] {
  const kind = (k: number) => {
    const sd = sides[k];
    const st = sd?.style ?? 'solid';
    return sd && widths[k] > 0 && !sd.collapse?.noPaint && sd.color !== 'transparent' && (st === 'dashed' || st === 'dotted') ? `${st} ${widths[k]} ${sd.color}` : '';
  };
  const kinds = [0, 1, 2, 3].map(kind);
  return kinds.map((kd, k) => {
    if (!kd) return 0;
    const w = widths[k];
    let phase = kd.startsWith('dashed') ? 2 * Math.max(w, 0.5) : 0;
    // 時計回りで前へたどれるだけたどる (4 辺とも同じなら上から)
    let j = k;
    let n = 0;
    while (j !== 0 && n < 3 && kinds[(j + 3) % 4] === kd) {
      j = (j + 3) % 4;
      n++;
    }
    for (let i = j; i !== k; i = (i + 1) % 4) phase += lens[i] - w;
    return phase;
  });
}

const THREE_D = new Set(['groove', 'ridge', 'inset', 'outset']);
/**
 * 立体の罫線の暗い側・明るい側の色。明るい側は白と半々に混ぜた色 (green なら #80C080)、暗い側は元の色の 2/3 (#005500)。
 * 黒の罫線は、明るい側が #808080、暗い側が黒
 */
const DARK = -1 / 3;
/**
 * 辺の角を、隣の辺と斜めに突き合わせるか。立体の罫線 (groove・ridge・inset・outset) は辺ごとに色が違うので、
 * 角を外の角と内の角を結ぶ線で分ける。実線は隣の辺と色か種類が違うときだけ
 * (同じ色の実線を台形に分けると、継ぎ目に細い隙間が見えることがある)
 */
function mitreWith(sd: BorderSide | undefined, adj: BorderSide | undefined): boolean {
  if (!sd || !adj || adj.collapse?.noPaint || adj.color === 'transparent') return false;
  const st = sd.style ?? 'solid';
  const at = adj.style ?? 'solid';
  // 波線は、隣の辺の中心線との交わりから描く (隣の辺の太さを使う)
  if (THREE_D.has(st) || st === 'wave') return true;
  // 対称に置く破線は、角 (隣の辺の太さの部分) を線にするので、隣の辺の太さを使う
  if (sd.symmetric && st === 'dashed') return true;
  // 二重線は、角で外の線どうし・内の線どうしがつながるように斜めに突き合わせる
  // (突き合わせないと、縦の辺の 2 本の線が横の辺の線を横切る)
  if (st === 'double') return true;
  return st === 'solid' && (adj.color !== sd.color || at !== 'solid');
}

function dashes(len: number, dash: number, gap: number): Array<[number, number]> {
  if (len <= dash * 1.5) return [[0, len]];
  const n = Math.max(2, Math.round((len + gap) / (dash + gap)));
  const g = (len - n * dash) / (n - 1);
  return Array.from({ length: n }, (_, i) => [i * (dash + g), dash] as [number, number]);
}

/** 罫線 1 辺。x, y, w, h は辺の矩形。線の太さは短い方の寸法 */
function paintBorderSide(
  p: Painter,
  s: BorderSide,
  edge: 'top' | 'bottom' | 'left' | 'right',
  x: number,
  y: number,
  w: number,
  h: number,
  phase?: number,
  mitre: [number, number] = [0, 0],
) {
  // 透明の罫線は場所だけ取り、描かない
  if (s.color === 'transparent') return;
  const horizontal = edge === 'top' || edge === 'bottom';
  const t = horizontal ? h : w;
  const len = horizontal ? w : h;
  const outerFirst0 = edge === 'top' || edge === 'left';
  const [m0, m1] = mitre;
  const bar = (off: number, thick: number, color: string, from = 0, to = len) => {
    // 立体の罫線の細い帯 (0.5pt 未満) は、帯の中心線を線 (stroke) で描く (表示では 1 画素以上の太さになる)。
    // 端は、角の突き合わせの線の上 (帯の中ほどの深さ)
    if (THREE_D.has(s.style ?? 'solid') && thick < 0.5 && from === 0 && to === len && t > 0) {
      const dm = (outerFirst0 ? off : t - off - thick) + thick / 2;
      const across = outerFirst0 ? dm : t - dm;
      const a0 = (m0 * dm) / t;
      const a1 = len - (m1 * dm) / t;
      const P = (along: number) => (horizontal ? { x: x + along, y: y + across } : { x: x + across, y: y + along });
      p.strokePath([{ op: 'M', ...P(a0) }, { op: 'L', ...P(a1) }], thick, color);
      return;
    }
    if ((m0 || m1) && from === 0 && to === len && t > 0) {
      // 台形: 外側からの深さ d で、始めの端は m0・終わりの端は m1 の割合で内へ寄る (外の角と内の角を結ぶ線)
      const d0 = outerFirst0 ? off : t - off - thick;
      const d1 = d0 + thick;
      const at = (d: number, along: number): { x: number; y: number } => {
        const across = outerFirst0 ? d : t - d;
        return horizontal ? { x: x + along, y: y + across } : { x: x + across, y: y + along };
      };
      const poly = (q: Array<{ x: number; y: number }>) => p.fillPath([{ op: 'M', ...q[0] }, ...q.slice(1).map((v) => ({ op: 'L' as const, ...v })), { op: 'Z' }], color);
      // 長い真ん中は矩形で描き (表示で画素の境に合う)、角の斜めの部分だけを図形にする
      const s0 = (m0 * d1) / t;
      const s1 = len - (m1 * d1) / t;
      if (s1 > s0) {
        if (horizontal) p.fillRect(x + s0, y + (outerFirst0 ? d0 : t - d1), s1 - s0, thick, color);
        else p.fillRect(x + (outerFirst0 ? d0 : t - d1), y + s0, thick, s1 - s0, color);
        if (m0) poly([at(d0, (m0 * d0) / t), at(d0, s0), at(d1, s0)]);
        if (m1) poly([at(d0, len - (m1 * d0) / t), at(d0, s1), at(d1, s1)]);
      } else poly([at(d0, (m0 * d0) / t), at(d0, len - (m1 * d0) / t), at(d1, len - (m1 * d1) / t), at(d1, (m0 * d1) / t)]);
      return;
    }
    if (horizontal) p.fillRect(x + from, y + off, to - from, thick, color);
    else p.fillRect(x + off, y + from, thick, to - from, color);
  };
  const style = s.style ?? 'solid';
  const outerFirst = edge === 'top' || edge === 'left'; // 辺の外側が先頭側 (top/left) か
  // 辺の中央に対して対称に置く模様 (BorderSide.symmetric)。模様の 1 周期の中の線 (始め, 長さ) と周期、辺の中央に来る位置。
  // 破線: 両端の角 (隣の辺の太さの部分) は線。その間の長さ L' を「半分の線 (2) ・(間 (2) ・線 (4)) × k・間 (2)・半分の線 (2)」で割り付け、
  // k は L' に合う整数 (L' を 6(k + 1) 等分した長さが太さに近くなる数)。短い辺 (k = 0) は、L' を線・間・線に 3 等分する
  if (s.symmetric && style === 'dashed') {
    const u = Math.max(t, 0.5);
    const inner = Math.max(len - m0 - m1, 0);
    const k = Math.max(0, Math.round(inner / (6 * u) - 1));
    const un = inner / (6 * (k + 1));
    bar(0, t, s.color, 0, Math.min(m0 + 2 * un, len));
    for (let j = 0; j < k; j++) {
      const a0 = m0 + 4 * un + j * 6 * un;
      bar(0, t, s.color, a0, a0 + 4 * un);
    }
    bar(0, t, s.color, Math.max(len - m1 - 2 * un, 0), len);
    return;
  }
  // 鎖線: 一点鎖線は点の中央、二点鎖線は線の中央が辺の中央に来る。一点鎖線は線・間・点・間が 4:1:1:1、二点鎖線は線・間・点・間・点・間が 5:1:1:1:1:1
  if (s.symmetric && (style === 'dot-dash' || style === 'dot-dot-dash')) {
    const u = Math.max(t, 0.5);
    const [unit, period, centre]: [Array<[number, number]>, number, number] =
      style === 'dot-dash' ? [[[0, 4 * u], [5 * u, u]], 7 * u, 5.5 * u] : [[[0, 5 * u], [6 * u, u], [8 * u, u]], 10 * u, 2.5 * u];
    // 1 周期に満たない短い辺は、模様にせず実線
    if (len < period) {
      bar(0, t, s.color);
      return;
    }
    const q0 = len / 2 - centre;
    for (let q = q0 - Math.ceil(q0 / period) * period; q < len; q += period)
      for (const [o, l] of unit) {
        const a0 = Math.max(q + o, 0);
        const a1 = Math.min(q + o + l, len);
        if (a1 > a0) bar(0, t, s.color, a0, a1);
      }
    return;
  }
  // 点線は、両端の角に点を置き、間を等分する (対称)
  if (s.symmetric && style === 'dotted') phase = undefined;
  switch (style) {
    // 破線は太さの 4 倍の線と 2 倍の間隔、点線は太さの点と 1.5 倍の間隔。
    // 位相を渡されたら、時計回りの向きに、その位相から模様を当てる (dashPhases)。下と左の辺は終わりの端から描く
    case 'dashed': {
      const u = Math.max(t, 0.5);
      if (phase !== undefined) {
        const rev = edge === 'bottom' || edge === 'left';
        // 道の上の位置 q (0〜len) で、模様の位置 phase + q が [0, 4u) (周期 6u) に入るところが線
        for (let q = -((phase % (6 * u)) + 6 * u) % (6 * u); q < len; q += 6 * u) {
          const a0 = Math.max(q, 0);
          const a1 = Math.min(q + 4 * u, len);
          if (a1 > a0) rev ? bar(0, t, s.color, len - a1, len - a0) : bar(0, t, s.color, a0, a1);
        }
        return;
      }
      for (const [a, l] of dashes(len, Math.max(t * 4, 2), Math.max(t * 2, 1))) bar(0, t, s.color, a, a + l);
      return;
    }
    case 'dotted': {
      const d = Math.max(t, 0.6);
      // 位相を渡されたら: 線の中心を通る道 (両端から太さの半分だけ内側) に、時計回りに、位相から 2.5 倍ごとに丸い点
      if (phase !== undefined) {
        const rev = edge === 'bottom' || edge === 'left';
        const g = 2.5 * d;
        const lc = len - t;
        const path: PathSeg[] = [];
        for (let q = (g - (phase % g)) % g; q <= lc + 1e-6; q += g) {
          const c = t / 2 + (rev ? lc - q : q);
          path.push(...(horizontal ? roundRectPath(x + c - t / 2, y, t, t, t / 2, t / 2) : roundRectPath(x, y + c - t / 2, t, t, t / 2, t / 2)));
        }
        if (path.length) p.fillPath(path, s.color);
        return;
      }
      // 点は丸く描く (四角い点は面積が大きく、線が太く見える)
      {
        const path: PathSeg[] = [];
        for (const [a, l] of dashes(len, d, Math.max(t * 1.5, 0.9))) {
          const w = Math.min(l, t);
          path.push(...(horizontal ? roundRectPath(x + a, y, w, t, w / 2, t / 2) : roundRectPath(x, y + a, t, w, t / 2, w / 2)));
        }
        if (path.length) p.fillPath(path, s.color);
        return;
      }
    }
    case 'dot-dash':
    case 'dot-dot-dash': {
      // 鎖線 (アンテナハウスの拡張): 線 (一点鎖線は太さの 3.8 倍、二点鎖線は 5.2 倍) と、太さと同じ間隔・点の繰り返し
      const u = Math.max(t, 0.5);
      const dots = style === 'dot-dash' ? 1 : 2;
      const dash = (dots === 1 ? 3.8 : 5.2) * u;
      const unit: Array<[number, number]> = [[0, dash]];
      for (let k = 0; k < dots; k++) unit.push([dash + u + 2 * k * u, u]);
      const period = dash + 2 * dots * u;
      const rev = edge === 'bottom' || edge === 'left';
      const start = phase !== undefined ? -((phase % period) + period) % period : 0;
      for (let q = start; q < len; q += period)
        for (const [o, l] of unit) {
          const a0 = Math.max(q + o, 0);
          const a1 = Math.min(q + o + l, len);
          if (a1 > a0) rev ? bar(0, t, s.color, len - a1, len - a0) : bar(0, t, s.color, a0, a1);
        }
      return;
    }
    case 'wave': {
      // 波線 (アンテナハウスの拡張): 太さの 1/8 の細い線が、罫線の幅の中で上下する。周期は太さの約 6 倍。
      // 角では、隣の辺の中心線との交わり (罫線の幅の中ほど) から、波の中ほどの高さで始まる。辺の長さに半波がちょうど収まるように
      // 周期を伸び縮みさせ、横の辺は上へ、縦の辺は内側へ振れて始まる (上下の辺は同じ形、左右の辺は鏡に映した形)
      const sw = Math.max(t / 8, 0.25);
      const amp = Math.max((t - sw) / 2, 0);
      const a0 = m0 / 2;
      const a1 = Math.max(len - m1 / 2, a0);
      const span = a1 - a0;
      const half = Math.max(1, Math.round(span / (3 * Math.max(t, 0.5))));
      // 振れの向き: +1 で座標の増える向き (下・右)
      const dir = horizontal ? -1 : edge === 'left' ? 1 : -1;
      const steps = Math.max(8, half * 16);
      const path: PathSeg[] = [];
      for (let k = 0; k <= steps; k++) {
        const along = a0 + (span * k) / steps;
        const across = t / 2 + dir * amp * Math.sin((Math.PI * half * k) / steps);
        const pt = horizontal ? { x: x + along, y: y + across } : { x: x + across, y: y + along };
        path.push({ op: k ? 'L' : 'M', ...pt });
      }
      p.strokePath(path, sw, s.color);
      return;
    }
    case 'double':
      if (t < 2.4) bar(0, t, s.color);
      else {
        // 外の線は辺の全長、内の線は隣の辺の内の線の位置 (隣の辺の太さの 2/3) から。角は直角につなぐ
        const rect = (off: number, from: number, to: number) => {
          if (to <= from) return;
          if (horizontal) p.fillRect(x + from, y + off, to - from, t / 3, s.color);
          else p.fillRect(x + off, y + from, t / 3, to - from, s.color);
        };
        rect(outerFirst ? 0 : (2 * t) / 3, 0, len);
        rect(outerFirst ? (2 * t) / 3 : 0, (2 * m0) / 3, len - (2 * m1) / 3);
      }
      return;
    case 'groove':
    case 'ridge': {
      const dark = shade(s.color, DARK);
      const light = shade(s.color, 0.5);
      // groove: 外側が暗く内側が明るい (top/left)。bottom/right は逆。ridge はその反対
      const first = (style === 'groove') === outerFirst ? dark : light;
      const second = first === dark ? light : dark;
      bar(0, t / 2, outerFirst ? first : second);
      bar(t / 2, t / 2, outerFirst ? second : first);
      return;
    }
    case 'inset':
    case 'outset': {
      const darkSide = (style === 'inset') === outerFirst;
      bar(0, t, darkSide ? shade(s.color, DARK) : shade(s.color, 0.5));
      return;
    }
    default:
      bar(0, t, s.color);
  }
}

/** 背景画像: padding の外端 (border の内側) の範囲に、位置と繰り返しの指定どおりに並べる */
function paintBackgroundImage(a: Area, x: number, y: number, p: Painter) {
  const bi = { ...a.backgroundImage! };
  const bl = a.border.left?.width ?? 0;
  const br = a.border.right?.width ?? 0;
  const bt = a.border.top?.width ?? 0;
  const bb = a.border.bottom?.width ?? 0;
  const W0 = Math.max(a.width - bl - br, 0);
  const H0 = Math.max(a.height - bt - bb, 0);
  if (W0 <= 0 || H0 <= 0) return;
  // 紙の端に接する箱は、切り抜きと繰り返しの範囲を端の外へ少し伸ばす (端の画素が薄く見えないように)。
  // cover の画像は、伸ばした範囲を覆う大きさ・位置にする
  const clipR = snapToEdge({ x: x + bl, y: y + bt, width: W0, height: H0 });
  const cover = bi.size === 'cover';
  const bx = cover ? clipR.x : x + bl;
  const by = cover ? clipR.y : y + bt;
  const W = cover ? clipR.width : W0;
  const H = cover ? clipR.height : H0;
  const pos = (v: unknown, room: number) => {
    if (typeof v === 'number') return v;
    if (v === 'center') return room / 2;
    if (v === 'right' || v === 'bottom') return room;
    if (typeof v === 'string' && v.endsWith('%')) return (room * parseFloat(v)) / 100;
    return 0;
  };
  // background-size: cover / contain は、箱の大きさに合わせて縮尺する (画像本来の縦横比を保つ)
  if (bi.size) {
    const s = (bi.size === 'cover' ? Math.max : Math.min)(W / bi.width, H / bi.height);
    bi.width *= s;
    bi.height *= s;
  }
  // 大きさの無い (0・NaN・Infinity) タイルは描けない (壊れた画像で 0 除算のループにしない)
  if (!(bi.width > 0) || !(bi.height > 0) || !Number.isFinite(bi.width) || !Number.isFinite(bi.height)) return;
  const ox = bi.xFromEnd && typeof bi.x === 'number' ? W - bi.width - bi.x : pos(bi.x, W - bi.width);
  const oy = bi.yFromEnd && typeof bi.y === 'number' ? H - bi.height - bi.y : pos(bi.y, H - bi.height);
  const rx = bi.repeat === undefined || bi.repeat === 'repeat' || bi.repeat === 'repeat-x';
  const ry = bi.repeat === undefined || bi.repeat === 'repeat' || bi.repeat === 'repeat-y';
  const startX = rx ? ox - Math.ceil(ox / bi.width) * bi.width : ox;
  const startY = ry ? oy - Math.ceil(oy / bi.height) * bi.height : oy;
  const tile = { type: 'image', src: bi.src, missing: false, x: 0, y: 0, width: bi.width, height: bi.height, margin: a.margin, padding: a.padding, border: {}, writingMode: a.writingMode } as ImageArea;
  // 角丸の箱の背景画像は、padding の箱の角丸 (外側の半径 − 罫線の太さ) で切り抜く (CSS Backgrounds 3 §5.3)
  if (a.borderRadius) p.clipPath(radiusShape(a.borderRadius, a.width, a.height)(clipR.x, clipR.y, clipR.width, clipR.height, bt));
  else p.clipRect(clipR);
  // 繰り返す方向だけ箱いっぱいに、繰り返さない方向は 1 枚の幅だけの範囲を、1 つの模様で埋める (タイルの数だけ命令を出さない)
  const region: Rect = { x: rx ? clipR.x : bx + startX, y: ry ? clipR.y : by + startY, width: rx ? clipR.width : bi.width, height: ry ? clipR.height : bi.height };
  if ((rx || ry) && p.drawImageTiled?.(tile, bx + startX, by + startY, region)) {
    p.restore();
    return;
  }
  for (let ty = startY; ty < H; ty += bi.height) {
    for (let tx = startX; tx < W; tx += bi.width) {
      p.drawImage(tile, bx + tx, by + ty);
      if (!rx) break;
    }
    if (!ry) break;
  }
  p.restore();
}
