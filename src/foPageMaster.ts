/**
 * foPageMaster — XSL-FO の fo:simple-page-master の読み取り: ページの大きさ・余白、リージョン (before・after・start・end・body) の矩形と
 * 背景・罫線・書字方向、段組、アンテナハウス拡張のトンボ (axf:printer-marks など)。
 * 属性・長さ・色・罫線の読み方は Importer (xslfoImport.ts) のものを FoPageHost として借りる。処理は Importer にあったものをそのまま移した
 */
import type { BackgroundImage, BorderInput, BorderSide, PageMaster, Rotation, WritingMode } from './types';
import { PT_PER_MM } from './units';
import { normBorder } from './geometry';
import type { XEl } from './foDom';
import { WS_INITIAL, type Ctx } from './foContext';

export interface RegionProps {
  wm?: WritingMode;
  ro: Rotation;
  align?: string;
  /** overflow="hidden" 等: リージョンからはみ出した内容を切り抜く */
  clip?: boolean;
}
export type RegionRect = { x: number; y: number; w: number; h: number } & Partial<RegionProps>;

/** リージョンの背景 (色・画像) */
export interface RegionBg {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  image?: BackgroundImage;
  border?: BorderInput;
}

export interface MasterInfo {
  name: string;
  regionBgs: RegionBg[];
  master: PageMaster;
  regionRects: Map<string, RegionRect>;
  bodyOrigin: { x: number; y: number };
  bodySize: { w: number; h: number };
  bodyWm?: WritingMode;
  /** region-body (またはページ) の writing-mode の値そのもの (裏返しの値 bt-lr・lr-bt などを見る) */
  bodyWmAttr?: string;
  /** region-body (またはページ) が rl-tb */
  bodyRtl?: boolean;
  bodyName: string;
  pageW: number;
  pageH: number;
}

/** ページマスターの読み取りが Importer から借りる読み方 (属性・長さ・色・罫線・背景画像など) と設定 */
export interface FoPageHost {
  /** 仕上がり・塗り足し・トンボ (FO に無い印刷設定) */
  readonly opts: { bleedMm?: number; trimMarks?: boolean };
  /** XSL-FO 1.1 の初期値どおりに組む (アンテナハウス互換の既定を使わない) */
  readonly spec: boolean;
  /** font-size=medium の大きさ (pt) */
  readonly defaultFontSize: number;
  attr(n: XEl, k: string): string | undefined;
  els(n: XEl): XEl[];
  name(n: XEl): string;
  len(v: string | undefined, fs: number, pct?: number, lh?: number): number | undefined;
  color(v: string | undefined): string | undefined;
  miss(what: string, n?: number): void;
  posInt(v: string | undefined): number;
  box4(el: XEl, k: string): string[] | undefined;
  wmOf(v: string): WritingMode | undefined;
  phys(rel: 'before' | 'after' | 'start' | 'end', wm: WritingMode, rtl?: boolean): 'top' | 'right' | 'bottom' | 'left';
  border(el: XEl, ctx: Ctx): Partial<Record<'top' | 'right' | 'bottom' | 'left', BorderSide>> | undefined;
  columnRule(el: XEl, fs: number): BorderSide | undefined;
  backgroundImage(el: XEl, ctx: Ctx, prefix?: string): BackgroundImage | undefined;
  refOrientation(el: XEl): Rotation;
}

/** fo:simple-page-master を読む。root・lms (fo:root・fo:layout-master-set) は、継承される font-size (em の基準) のため */
export function readPageMaster(fo: FoPageHost, m: XEl, root?: XEl, lms?: XEl): MasterInfo {
  const name = fo.attr(m, 'master-name') ?? 'master';
  // em の基準: font-size は継承される (fo:root → layout-master-set → simple-page-master)
  const fsOf = (el: XEl | null | undefined, base: number): number => {
    const v = el ? fo.attr(el, 'font-size') : undefined;
    if (!v) return base;
    const pct = /^([\d.]+)%$/.exec(v.trim());
    return pct ? (base * parseFloat(pct[1])) / 100 : (fo.len(v, base) ?? base);
  };
  const fs = fsOf(m, fsOf(lms, fsOf(root, fo.defaultFontSize)));
  const W = fo.len(fo.attr(m, 'page-width'), fs) ?? 595.28;
  const H = fo.len(fo.attr(m, 'page-height'), fs) ?? 841.89;
  // margin の略記は 1〜4 値 (上 右 下 左)
  const side4 = (el: XEl, p: string) => fo.box4(el, 'margin')?.[['top', 'right', 'bottom', 'left'].indexOf(p)];
  // margin の百分率は、包含ブロックの幅に対する割合 (simple-page-master はページの幅)
  const box = (p: string, rel: string) => fo.len(fo.attr(m, `margin-${p}`) ?? fo.attr(m, `margin-${rel}`) ?? side4(m, p), fs, W) ?? 0;
  const mt = box('top', 'before');
  const mb = box('bottom', 'after');
  const ml = box('left', 'start');
  const mr = box('right', 'end');
  const regions: Record<string, { name: string; extent: number }> = {};
  const regionBg: Record<string, string | undefined> = {};
  const regionBorder: Record<string, BorderInput | undefined> = {};
  const regionImg: Record<string, BackgroundImage | undefined> = {};
  const regionProps: Record<string, RegionProps> = {};
  let body = { top: 0, right: 0, bottom: 0, left: 0 };
  let bodyWm: WritingMode | undefined;
  let bodyRtl = false;
  let bodyWmAttr: string | undefined;
  let columns = 1;
  let sideNotes = false;
  let columnGapPt: number | undefined;
  let footPos: 'page' | 'column' = 'page';
  let colFill = false;
  let colRule: BorderSide | undefined;
  let bodyRo: Rotation = 0;
  let bodyName = 'xsl-region-body';
  for (const r of fo.els(m)) {
    const n = fo.name(r);
    if (n === 'region-body') {
      // region-body の margin の百分率は、ページの余白の内側 (page-reference-area) の幅に対する割合
      const p = (s: string, rel: string) => fo.len(fo.attr(r, `margin-${s}`) ?? fo.attr(r, `margin-${rel}`) ?? side4(r, s), fs, W - ml - mr) ?? 0;
      body = { top: p('top', 'before'), right: p('right', 'end'), bottom: p('bottom', 'after'), left: p('left', 'start') };
      const wm = fo.attr(r, 'writing-mode') ?? fo.attr(m, 'writing-mode');
      if (wm) bodyWm = fo.wmOf(wm);
      bodyWmAttr = wm;
      bodyRtl = wm === 'rl-tb' || wm === 'rl' || wm === 'rl-bt';
      columns = fo.posInt(fo.attr(r, 'column-count')) || 1;
      // column-gap は符号の無い長さ。負の値は 0pt にする (XSL 1.1 §7.27.3)
      const gapR = fo.len(fo.attr(r, 'column-gap'), fs);
      columnGapPt = gapR === undefined ? undefined : Math.max(gapR, 0);
      if (fo.attr(r, 'axf:footnote-position') === 'column') footPos = 'column';
      if (fo.attr(r, 'axf:footnote-position') === 'outside') sideNotes = true;
      if ((fo.attr(r, 'axf:column-fill') ?? fo.attr(r, 'column-fill')) === 'balance') colFill = true;
      colRule = fo.columnRule(r, fs);
      // 互換モード: 段罫が段の間隔より太ければ、段の間隔に段罫の太さを足す (例: 段罫 0.25in なら、
      // 段の間は column-gap の既定 12pt と段罫の太さの和。column-gap="20mm" と段罫 thick なら、段の間は 20mm のまま)
      if (!fo.spec && colRule && columns > 1 && colRule.width > (columnGapPt ?? 12)) columnGapPt = (columnGapPt ?? 12) + colRule.width;
      bodyName = fo.attr(r, 'region-name') ?? bodyName;
      regionBg.body = fo.color(fo.attr(r, 'background-color') ?? fo.attr(r, 'axf:background-color'));
      regionBorder.body = regionBorderOf(fo, r, fs);
      regionImg.body = fo.backgroundImage(r, { fontSize: fs } as Ctx);
      bodyRo = fo.refOrientation(r);
    } else if (n.startsWith('region-')) {
      const rn = n.slice('region-'.length);
      // extent の百分率は、ページの block 方向 (before・after) または inline 方向 (start・end) の寸法に対する割合。負の値は 0 (§7.27.4)
      const pageWmR = fo.wmOf(fo.attr(m, 'writing-mode') ?? '') ?? 'horizontal-tb';
      const blockSide = rn === 'before' || rn === 'after';
      const extBase = (pageWmR === 'horizontal-tb') === blockSide ? H : W;
      regions[rn] = { name: fo.attr(r, 'region-name') ?? `xsl-region-${rn}`, extent: Math.max(fo.len(fo.attr(r, 'extent'), fs, extBase) ?? 0, 0) };
      regionBg[rn] = fo.color(fo.attr(r, 'background-color') ?? fo.attr(r, 'axf:background-color'));
      regionBorder[rn] = regionBorderOf(fo, r, fs);
      regionImg[rn] = fo.backgroundImage(r, { fontSize: fs } as Ctx);
      regionProps[rn] = { wm: fo.wmOf(fo.attr(r, 'writing-mode') ?? ''), ro: fo.refOrientation(r), align: fo.attr(r, 'display-align'), clip: ['hidden', 'scroll', 'error-if-overflow'].includes(fo.attr(r, 'overflow') ?? '') };
    }
  }
  // アンテナハウス互換: リージョンの枠線 (regionBorderOf。互換モードだけ) は、リージョンの内側に描き、中身はその内側に置く
  // (thin の枠なら中身が 1pt、medium の枠なら中身が 3pt 内側)
  const bwOf = (k: string) => {
    const b = normBorder(regionBorder[k]);
    const w = (s: BorderSide | undefined) => (s && s.width > 0 ? s.width : 0);
    return { top: w(b.top), right: w(b.right), bottom: w(b.bottom), left: w(b.left) };
  };
  const bb = bwOf('body');
  const pm: PageMaster = {
    width: W / PT_PER_MM,
    height: H / PT_PER_MM,
    bleed: fo.opts.bleedMm ?? 0,
    trimMarks: fo.opts.trimMarks ?? false,
    trimMarkMargin: 10,
    ...printerMarks(fo, m, fs),
    ...(bodyRo ? { bodyRotation: bodyRo } : {}),
    ...(columns > 1 ? { columns: { count: columns, ...(columnGapPt !== undefined ? { gap: columnGapPt / PT_PER_MM } : {}), ...(footPos === 'column' ? { footnotePosition: 'column' as const } : {}), ...(colRule ? { rule: colRule } : {}), ...(colFill ? { fill: 'balance' as const } : {}) } } : {}),
    backgroundColor: fo.color(fo.attr(m, 'axf:background-color') ?? fo.attr(m, 'background-color')),
    margins: {
      top: (mt + body.top + bb.top) / PT_PER_MM,
      right: (mr + body.right + bb.right) / PT_PER_MM,
      bottom: (mb + body.bottom + bb.bottom) / PT_PER_MM,
      left: (ml + body.left + bb.left) / PT_PER_MM,
    },
  };
  // 各リージョンの矩形 (ページ原点基準 pt)。
  // precedence (before / after の属性、既定 false): false のとき before / after は start / end の間に収まり、
  // start / end が上下端まで通る。true なら before / after が全幅になり、start / end はその間に収まる。
  const ext = (k: 'before' | 'after' | 'start' | 'end') => regions[k]?.extent ?? 0;
  const prec = (k: 'before' | 'after') => {
    const el = fo.els(m).find((r) => fo.name(r) === `region-${k}`);
    return !!el && fo.attr(el, 'precedence') === 'true';
  };
  // リージョンは、ページ (simple-page-master) の書字方向で決まる before / after / start / end の辺に置く (§6.4.15-18)。
  // lr-tb なら before = 上・start = 左、tb-rl なら before = 右・start = 上、tb-lr なら before = 左・start = 上
  const pageWm = fo.wmOf(fo.attr(m, 'writing-mode') ?? '') ?? 'horizontal-tb';
  const pageWmAttr = fo.attr(m, 'writing-mode');
  const edgeOf = (k: 'before' | 'after' | 'start' | 'end') => fo.phys(k, pageWm, pageWmAttr === 'rl-tb' || pageWmAttr === 'rl');
  const regionOn = (side: 'top' | 'right' | 'bottom' | 'left') => (['before', 'after', 'start', 'end'] as const).find((k) => edgeOf(k) === side)!;
  const inner = { x: ml, y: mt, w: W - ml - mr, h: H - mt - mb };
  /** 隣の辺のリージョンが、この角を取るか (before / after は precedence=true のとき角を取る。start / end はその逆) */
  const cut = (k: 'before' | 'after' | 'start' | 'end', side: 'top' | 'right' | 'bottom' | 'left') => {
    const other = regionOn(side);
    const otherIsBA = other === 'before' || other === 'after';
    const meIsBA = k === 'before' || k === 'after';
    if (meIsBA === otherIsBA) return 0;
    if (meIsBA) return prec(k as 'before' | 'after') ? 0 : ext(other);
    return prec(other as 'before' | 'after') ? ext(other) : 0;
  };
  const rectOf = (k: 'before' | 'after' | 'start' | 'end') => {
    const side = edgeOf(k);
    const t = ext(k);
    if (side === 'top' || side === 'bottom') {
      const l = cut(k, 'left');
      const r = cut(k, 'right');
      return { x: inner.x + l, y: side === 'top' ? inner.y : inner.y + inner.h - t, w: inner.w - l - r, h: t };
    }
    const tp = cut(k, 'top');
    const bt = cut(k, 'bottom');
    return { x: side === 'left' ? inner.x : inner.x + inner.w - t, y: inner.y + tp, w: t, h: inner.h - tp - bt };
  };
  const rect = { before: rectOf('before'), after: rectOf('after'), start: rectOf('start'), end: rectOf('end') };
  // 傍注 (axf:footnote-position="outside"): 横書きのページの region-start (左)・region-end (右) を、傍注の領域にする
  // (奇数ページは region-end、偶数ページは region-start の幅いっぱいに、参照する行の高さから置く)
  if (sideNotes && pageWm === 'horizontal-tb') {
    const bodyX = ml + body.left + bb.left;
    const side = (k: 'start' | 'end') => (regions[k] && rect[k].w > 0 ? { x: (rect[k].x - bodyX) / PT_PER_MM, width: rect[k].w / PT_PER_MM } : undefined);
    const st = side('start');
    const en = side('end');
    if (st || en) pm.sideNotes = { ...(st ? { start: st } : {}), ...(en ? { end: en } : {}) };
  }
  // リージョンの書字方向の既定は、ページの書字方向 (writing-mode は継承される)
  for (const k of ['before', 'after', 'start', 'end'] as const) if (regionProps[k] && !regionProps[k].wm && pageWm !== 'horizontal-tb') regionProps[k].wm = pageWm;
  const byName = new Map<string, RegionRect>();
  for (const k of ['before', 'after', 'start', 'end'] as const) {
    const nm = regions[k]?.name ?? `xsl-region-${k}`;
    const w = bwOf(k);
    const r = rect[k];
    const inset = { x: r.x + w.left, y: r.y + w.top, w: Math.max(0, r.w - w.left - w.right), h: Math.max(0, r.h - w.top - w.bottom) };
    byName.set(nm, { ...inset, ...(regionProps[k] ?? { ro: 0 as Rotation }) });
  }
  // 背景色を持つリージョン (本文の背面に敷く)
  const bgs: RegionBg[] = [];
  for (const k of ['before', 'after', 'start', 'end'] as const) {
    if ((regionBg[k] || regionImg[k] || regionBorder[k]) && rect[k].w > 0 && rect[k].h > 0) bgs.push({ ...rect[k], color: regionBg[k], image: regionImg[k], border: regionBorder[k] });
  }
  if (regionBg.body || regionImg.body || regionBorder.body) {
    bgs.push({ x: ml + body.left, y: mt + body.top, w: W - ml - mr - body.left - body.right, h: H - mt - mb - body.top - body.bottom, color: regionBg.body, image: regionImg.body, border: regionBorder.body });
  }
  return {
    name,
    master: pm,
    regionBgs: bgs,
    regionRects: byName,
    bodyOrigin: { x: ml + body.left + bb.left, y: mt + body.top + bb.top },
    bodySize: { w: W - ml - mr - body.left - body.right - bb.left - bb.right, h: H - mt - mb - body.top - body.bottom - bb.top - bb.bottom },
    bodyWm,
    bodyWmAttr,
    bodyRtl,
    bodyName,
    pageW: W,
    pageH: H,
  };
}

/**
 * アンテナハウス拡張のトンボの指定 (simple-page-master の axf:printer-marks・axf:crop-offset・axf:bleed・
 * axf:printer-marks-line-width)。printer-marks の crop は角のトンボ、cross はセンタートンボ。
 * crop-offset は紙の端から仕上がり位置まで (1〜4 値。上・右・下・左)。カラーバーなどの画像 (url(...)) は描かない
 */
function printerMarks(fo: FoPageHost, m: XEl, fs: number): Partial<PageMaster> {
  const marks = fo.attr(m, 'axf:printer-marks');
  const off = fo.attr(m, 'axf:crop-offset');
  const bl = fo.attr(m, 'axf:bleed');
  const lw = fo.attr(m, 'axf:printer-marks-line-width');
  const out: Partial<PageMaster> = {};
  const bleedPt = bl !== undefined ? fo.len(bl, fs) : undefined;
  if (bleedPt !== undefined) out.bleed = bleedPt / PT_PER_MM;
  if (marks && marks !== 'none') {
    const toks = marks.replace(/url\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
    const crop = toks.includes('crop');
    const cross = toks.includes('cross');
    if (crop || cross) {
      out.trimMarks = true;
      if (!crop) out.cornerMarks = false;
      if (!cross) out.centerMarks = false;
    }
    if (/url\(/.test(marks)) fo.miss('axf:printer-marks の画像 (url)');
  }
  if (off) {
    const v = off.trim().split(/\s+/).map((t) => fo.len(t, fs));
    if (v.every((x) => x !== undefined)) {
      const [t, r = t, b = t, l = r] = v as number[];
      const bleedMm = out.bleed ?? fo.opts.bleedMm ?? 0;
      const side = (x: number) => Math.max(x / PT_PER_MM - bleedMm, 0);
      out.trimMarkMargins = { top: side(t), right: side(r), bottom: side(b), left: side(l) };
      // crop-offset があれば、トンボを描かなくても紙は大きくする (仕上がりの外側に余白を取る)
      if (!out.trimMarks) {
        out.trimMarks = true;
        out.cornerMarks = false;
        out.centerMarks = false;
      }
    }
  }
  if (lw) {
    const w = fo.len(lw, fs);
    if (w !== undefined && w > 0) out.trimMarkLineWidth = w;
  }
  return out;
}

/**
 * リージョンの罫線。仕様 (§6.4.13 など) ではリージョンの border・padding は 0 でなければならないが、
 * 互換モードでは 0 以外も受け付けて描く
 */
function regionBorderOf(fo: FoPageHost, r: XEl, fs: number): BorderInput | undefined {
  if (fo.spec) return undefined;
  const b = fo.border(r, { fontSize: fs, wm: 'horizontal-tb', startIndent: 0, endIndent: 0, refOrigin: { x: 0, y: 0 }, ws: WS_INITIAL } as Ctx);
  if (!b || !Object.values(b).some((v) => v && v.width > 0)) return undefined;
  return b;
}
