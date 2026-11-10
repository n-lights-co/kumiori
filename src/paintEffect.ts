/**
 * paintEffect — 描くときだけに効く効果 (CSS の transform・opacity) を、組んだ後の Area Tree に付ける。
 *
 * 変換 (CSS Transforms 1 §3) も不透明度 (CSS Color 4 §3.3) も、組版 (箱の位置・大きさ・あふれ・ページ分け) には関わらない:
 *  - Transforms 1 §3: 変換は見た目に効くが、あふれの範囲のほかは CSS の配置に影響しない (まわりの中身の流れを変えない)
 *  - CSS Fragmentation 3 §5.5: ページ分けは変換などの見た目の効果より前に起こり、効果は断片ごとに掛ける
 * そこで、組版エンジンは効果を知らないまま組み、できた Area のうち、効果を持つ入力の節 (BaseNode.paintEffect) から作ったものに、
 * transform (行列)・opacity を付ける。節と Area は sourceRef (入力の節の通し番号) で結ぶ。
 *
 *  - 変換は、その節そのものから作った Area (sourceRef が節の番号と同じもの) のうち、いちばん外のものに付ける。
 *    行列は、Area の大きさ (断片ごと) から作る (百分率と変換の原点は、基準の箱の大きさに対して。Transforms 1 §5・§6・§9)
 *  - 不透明度は、その節と子孫から作った Area のうち、いちばん外のものに付ける。行の中に並ぶ字 (枠の無い span の字) は、
 *    続いているものを 1 つの inline の Area にまとめてから付ける (まとめて 1 枚の絵にして重ねるため。Color 4 §3.3:
 *    不透明度は要素の全体に掛かり、字の重なりは濃くならない)
 * 効果を持つ節が 1 つも無い文書では、何もしない (Area Tree をたどらない)
 */
import { isIdentity, mul, type Matrix } from './matrix';
import { sourceRef } from './sourceRef';
import type { Area, InlineArea, PaintEffect, SheetArea, TransformLength } from './types';

/**
 * 組版エンジンが、効果を持つ節の箱から作った Area に付ける印 (値は節の PaintEffect)。sourceRef の無い Area (写した節から作った表・
 * 回り込みの箱など) も、効果を持つ節の箱だと分かるようにする。applyPaintEffects が読んで消す (Area Tree には残らない)
 */
export const PAINT_EFFECT_MARK = '__paintEffect';
/**
 * sourceRef を持たない Area (字の背景の箱) に付ける、節の番号の印。効果を持つ節のある文書を組んでいる間 (paintEffectState.on) だけ付け、
 * applyPaintEffects が読んで消す
 */
export const PAINT_REF_MARK = '__paintRef';
/** いま組んでいる文書に、効果を持つ節があるか (組版エンジンが組み始めに決める。組版は同期なので、文書ごとに混ざらない) */
export const paintEffectState = { on: false };
type Marked = { [PAINT_EFFECT_MARK]?: PaintEffect; [PAINT_REF_MARK]?: number };

/** 効果を持つ節: 番号 k と、その子孫の番号の範囲 [k, end) */
export interface PaintEffectEntry {
  k: number;
  end: number;
  fx: PaintEffect;
  /** この節を含む、いちばん近い効果の節 */
  parent?: PaintEffectEntry;
}

/** 節の子孫の番号の最大 (番号は深さ優先・前順なので、子孫は [k, 最大] に並ぶ) */
function lastRefIn(node: object, k: number): number {
  let max = k;
  const seen = new Set<object>();
  const stack: unknown[] = [node];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    const r = sourceRef(v);
    if (r !== undefined && r > max) max = r;
    for (const x of Object.values(v)) stack.push(x);
  }
  return max;
}

/** 入力の節の並び (indexDocument の結果) から、効果を持つ節を番号の順に集める。無ければ undefined */
export function collectPaintEffects(nodes: readonly object[]): PaintEffectEntry[] | undefined {
  let out: PaintEffectEntry[] | undefined;
  const open: PaintEffectEntry[] = [];
  nodes.forEach((n, k) => {
    const fx = (n as { paintEffect?: PaintEffect }).paintEffect;
    if (!fx || (!fx.transform && fx.opacity === undefined)) return;
    while (open.length && open[open.length - 1].end <= k) open.pop();
    const e: PaintEffectEntry = { k, end: lastRefIn(n, k) + 1, fx, parent: open[open.length - 1] };
    open.push(e);
    (out ??= []).push(e);
  });
  return out;
}

const DEG = Math.PI / 180;

/**
 * 変換の行列 (CSS Transforms 1 §3: 単位行列から始め、変換の原点だけ移し、関数を左から掛け、原点の分を戻す)。
 * (bx, by) と bw × bh は、基準の箱 (transform-box) の、Area の左上からの位置と大きさ。行列の座標の原点は Area の左上
 */
export function transformMatrix(t: NonNullable<PaintEffect['transform']>, bx: number, by: number, bw: number, bh: number): Matrix {
  const len = (v: TransformLength, room: number) => (typeof v === 'number' ? v : (parseFloat(v) * room) / 100);
  const ox = bx + len(t.origin?.[0] ?? '50%', bw);
  const oy = by + len(t.origin?.[1] ?? '50%', bh);
  let m: Matrix = [1, 0, 0, 1, ox, oy];
  for (const f of t.functions) {
    let k: Matrix;
    switch (f.fn) {
      case 'matrix':
        k = [...f.m];
        break;
      case 'translate':
        k = [1, 0, 0, 1, len(f.x, bw), len(f.y, bh)];
        break;
      case 'scale':
        k = [f.x, 0, 0, f.y, 0, 0];
        break;
      case 'rotate': {
        // 時計回り (y は下向き): x' = x·cos − y·sin、y' = x·sin + y·cos (§14)
        const c = Math.cos(f.deg * DEG);
        const s = Math.sin(f.deg * DEG);
        k = [c, s, -s, c, 0, 0];
        break;
      }
      default:
        // skew(α, β): x' = x + y·tan α、y' = x·tan β + y (§14)
        k = [1, Math.tan(f.y * DEG), Math.tan(f.x * DEG), 1, 0, 0];
    }
    m = mul(m, k);
  }
  m = mul(m, [1, 0, 0, 1, -ox, -oy]);
  // 誤差だけの成分 (rotate(90deg) の cos など) を 0 にそろえる
  return m.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)) as Matrix;
}

/** Area a を基準の箱にする行列。座標の原点は、a の左上から (dx, dy) だけ戻った点 (a を含む Area の左上) */
function areaMatrix(a: Area, t: NonNullable<PaintEffect['transform']>, dx = 0, dy = 0): Matrix {
  const turned = a.orientation === 90 || a.orientation === 270;
  const w = turned ? a.height : a.width;
  const h = turned ? a.width : a.height;
  // 基準の箱 (Transforms 1 §6): border の箱か、内容の箱 (回転した箱は、回転後の外接矩形)
  if (t.box !== 'content-box' || a.orientation) return transformMatrix(t, dx, dy, w, h);
  const l = (a.border.left?.width ?? 0) + a.padding.left;
  const tp = (a.border.top?.width ?? 0) + a.padding.top;
  const r = (a.border.right?.width ?? 0) + a.padding.right;
  const b = (a.border.bottom?.width ?? 0) + a.padding.bottom;
  return transformMatrix(t, dx + l, dy + tp, Math.max(w - l - r, 0), Math.max(h - tp - b, 0));
}

/** 外接矩形 (回転した箱は、回転後の大きさ) */
function boundsOf(a: Area): { x0: number; y0: number; x1: number; y1: number } {
  const turned = a.orientation === 90 || a.orientation === 270;
  return { x0: a.x, y0: a.y, x1: a.x + (turned ? a.height : a.width), y1: a.y + (turned ? a.width : a.height) };
}

/** 行の中の Area を、1 つの inline の Area (枠・余白の無い箱) にまとめる。子の座標は、まとめた箱の左上からに直す */
function wrapRun(run: Area[]): InlineArea {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of run) {
    const b = boundsOf(c);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    type: 'inline',
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    margin: zero,
    padding: zero,
    border: {},
    writingMode: run[0].writingMode,
    children: run.map((c) => ({ ...c, x: c.x - x0, y: c.y - y0 })),
  };
}

/** 子を持つ Area の子 (字・画像・ルビ・縦中横・ページは、ここでは子を持たないものとして扱う) */
const kidsOf = (a: Area): Area[] | undefined => (a.type === 'glyph' || a.type === 'image' || a.type === 'ruby' || a.type === 'tate-chu-yoko' || a.type === 'page' ? undefined : (a as InlineArea).children);

/**
 * 組んだシートの Area に、効果 (transform・opacity) を付ける。entries は collectPaintEffects の結果 (番号の順)。
 *
 * 行の中 (line・inline の子) では、1 つの効果に当たる Area をまとめて 1 つの inline の Area にしてから付ける: 枠 (罫線・余白) の付いた
 * 行内の箱は、枠の Area と中身の Area が行の別々の子になり、枠の無い span の字は、書式の変わり目ごとに別々の子になる。
 * まとめた Area は、最初の中身の位置に置く (効果の付いた箱は重ね合わせの文脈を作り、行内の中身より後に描く。Color 4 §3.3・Transforms 1 §3)
 */
export function applyPaintEffects(sheets: readonly SheetArea[], entries: readonly PaintEffectEntry[]): void {
  if (!entries.length) return;
  type Active = readonly PaintEffectEntry[];
  /** 印 (PAINT_EFFECT_MARK) の付いた Area → その効果。印は読んだら消す */
  const marks = new Map<object, PaintEffectEntry>();
  const byFx = new Map<PaintEffect, PaintEffectEntry>();
  for (const e of entries) if (!byFx.has(e.fx)) byFx.set(e.fx, e);
  const refMarks = new Map<object, number>();
  const refOf = (c: Area) => c.sourceRef ?? refMarks.get(c);
  const unmark = (c: Area) => {
    const ref = (c as Marked)[PAINT_REF_MARK];
    if (ref !== undefined) {
      delete (c as Marked)[PAINT_REF_MARK];
      refMarks.set(c, ref);
    }
    const fx = (c as Marked)[PAINT_EFFECT_MARK];
    if (!fx) return;
    delete (c as Marked)[PAINT_EFFECT_MARK];
    const e = byFx.get(fx);
    if (e) marks.set(c, e);
  };
  /** 番号 r を範囲に含む効果のうち、いちばん内のもの */
  const innermost = (r: number): PaintEffectEntry | undefined => {
    let lo = 0;
    let hi = entries.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid].k <= r) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let e: PaintEffectEntry | undefined = at < 0 ? undefined : entries[at];
    while (e && r >= e.end) e = e.parent;
    return e;
  };
  // 同じ要素から作った 2 つの節 (回り込みの箱と中のブロックなど) は、同じ効果の物を持つ: 1 度だけ付ける
  const on = (active: Active, e: PaintEffectEntry) => active.some((x) => x.fx === e.fx);
  const fades = (e: PaintEffectEntry) => e.fx.opacity !== undefined && e.fx.opacity < 1;
  /** この Area が、効果 e の節の箱そのものか (変換の基準の箱) */
  const isBox = (c: Area, e: PaintEffectEntry) => (marks.has(c) ? marks.get(c)!.fx === e.fx : c.sourceRef === e.k);
  /** この Area に付ける効果: まだ付けていない (祖先の Area に付いていない) もののうち、いちばん外のもの */
  const match = (c: Area, active: Active): PaintEffectEntry | undefined => {
    let found: PaintEffectEntry | undefined;
    // 印の付いた Area は、その効果の節の箱そのもの
    const own = marks.get(c);
    if (own && !on(active, own)) found = own;
    const r = refOf(c);
    if (r === undefined) return found;
    for (let e = innermost(r); e; e = e.parent) {
      if (on(active, e)) continue;
      // 変換だけの効果は、節の箱そのものの Area にだけ付ける。不透明度は子孫の Area にも付ける
      if (e.k === r || fades(e)) found = e;
    }
    return found;
  };
  /**
   * 行の中の Area に付ける効果。番号も印も無い inline (書式の変わり目ごとの字の並び) は、中の Area がみな同じ効果に当たれば、
   * その効果に当たるものとする
   */
  const lifted = (c: Area, active: Active, depth = 0): PaintEffectEntry | undefined => {
    unmark(c);
    const m = match(c, active);
    if (m || c.type !== 'inline' || c.sourceRef !== undefined || marks.has(c) || !c.children.length || depth > 4) return m;
    const first = lifted(c.children[0], active, depth + 1);
    return first && c.children.every((k) => lifted(k, active, depth + 1) === first) ? first : undefined;
  };
  /** root の中から、効果 e の節の箱の Area を探す。x・y は root の左上からの位置 */
  const findBox = (root: Area, e: PaintEffectEntry, x = 0, y = 0, depth = 0): { a: Area; x: number; y: number } | undefined => {
    if (isBox(root, e)) return { a: root, x, y };
    const kids = depth < 6 ? kidsOf(root) : undefined;
    if (!kids) return undefined;
    const cx = x + (root.border.left?.width ?? 0) + root.padding.left;
    const cy = y + (root.border.top?.width ?? 0) + root.padding.top;
    for (const k of kids) {
      unmark(k);
      const hit = findBox(k, e, cx + k.x, cy + k.y, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  /** Area c に効果 e を付ける。変換は、c の中の e の節の箱 (c そのものか、まとめた中の枠・画像) を基準にする */
  const set = (c: Area, e: PaintEffectEntry) => {
    if (fades(e)) c.opacity = Math.max(e.fx.opacity!, 0) * (c.opacity ?? 1);
    const box = e.fx.transform && findBox(c, e);
    if (box) {
      const m = areaMatrix(box.a, e.fx.transform!, box.x, box.y);
      const cur = c.transform ? mul(m, c.transform) : m;
      if (isIdentity(cur)) delete c.transform;
      else c.transform = cur;
    }
  };
  const done = new WeakSet<object>();
  const settled = new WeakSet<object>();
  const stack: Array<{ a: Area | SheetArea; active: Active }> = sheets.map((s) => ({ a: s, active: [] }));
  /** c に、当たる効果を外のものから順にすべて付けて、中をたどる */
  const settle = (c: Area, first: PaintEffectEntry, active: Active) => {
    // 2 つのシートが同じ Area の物を持つときも、効果は 1 度だけ付ける
    if (settled.has(c)) return;
    settled.add(c);
    let act = active;
    for (let m: PaintEffectEntry | undefined = first; m; m = match(c, act)) {
      set(c, m);
      act = [...act, m];
    }
    stack.push({ a: c, active: act });
  };
  const list = (kids: Area[], active: Active, inLine: boolean): Area[] => {
    for (const c of kids) unmark(c);
    const eff = kids.map((c) => (inLine ? lifted(c, active) : match(c, active)));
    if (!eff.some(Boolean)) {
      for (const c of kids) stack.push({ a: c, active });
      return kids;
    }
    // 行の中: 同じ効果に当たる Area (枠と中身) をまとめる。枠 (印の付いた、行内の箱の罫線・背景の Area) は行の子の先頭に
    // あるので、まとめた Area は最初の中身の位置に置く
    // (同じ要素から作った 2 つの節は、別の PaintEffectEntry でも同じ効果の物 fx を持つので、fx でまとめる)
    const groups = new Map<PaintEffect, number[]>();
    if (inLine) eff.forEach((e, i) => e && groups.set(e.fx, [...(groups.get(e.fx) ?? []), i]));
    const out: Area[] = [];
    kids.forEach((c, i) => {
      const e = eff[i];
      const members = e && groups.get(e.fx);
      if (!e) {
        out.push(c);
        stack.push({ a: c, active });
      } else if (!members || members.length === 1) {
        out.push(c);
        // 1 つだけなら、まとめない。中の Area がみな当たるだけの inline は、そのまま中をたどる (中の Area に付く)
        if (match(c, active) === e) settle(c, e, active);
        else stack.push({ a: c, active });
      } else if (i === (members.find((j) => marks.get(kids[j])?.fx !== e.fx) ?? members[0])) {
        const run = members.map((j) => kids[j]);
        const w = wrapRun(run);
        // 印は、写した子に引き継ぐ
        run.forEach((c0, n) => {
          if (marks.has(c0)) marks.set(w.children[n], marks.get(c0)!);
          if (refMarks.has(c0)) refMarks.set(w.children[n], refMarks.get(c0)!);
        });
        out.push(w);
        settle(w, e, active);
      }
    });
    return out;
  };
  while (stack.length) {
    const { a, active } = stack.pop()!;
    if (done.has(a)) continue;
    done.add(a);
    switch (a.type) {
      case 'sheet':
        stack.push({ a: a.page, active });
        break;
      case 'page':
        a.behindAreas = list(a.behindAreas, active, false) as typeof a.behindAreas;
        list([a.regionBody], active, false);
        a.absoluteAreas = list(a.absoluteAreas, active, false) as typeof a.absoluteAreas;
        break;
      case 'glyph':
      case 'image':
      case 'ruby':
      case 'tate-chu-yoko':
        break;
      default:
        // (子の持ち方は areaTree.ts の childrenOf と同じ)
        a.children = list(a.children, active, a.type === 'line' || a.type === 'inline');
    }
  }
}
