/**
 * grid-template-columns の列の幅を決める (CSS Grid 1 §7.2・§11・§12)。HTML の読み込み (行に項目を並べる列の数・auto-fill の回数) と、
 * 組版エンジン (grid の行の表を置くときの、容器の実際の内容の幅で、列の幅を決める: LTable.gridTemplate) の両方から呼ぶ。
 * どちらからも循環せずに import できるように、CSS の字句と長さの読み手だけに頼る
 */
import { lengthPx } from './cssCascade';
import { cssLen, gridMinmaxArgs, GRID_REPEAT, gridTrackListInvalid, gridTrackTokens } from './cssText';

const PT_PER_PX = 0.75;

/**
 * grid-template-columns の列の数の上限。CSS Grid 1 §5.4 (Limiting Large Grids) は、実装がグリッドの大きさを実装の決めた上限に
 * 切ってよいとし、その上限は [-10000, 10000] の線を収めるべきとする。repeat() の回数 (§7.2.3 の <integer [1,∞]>) が大きくても
 * 宣言は有効のままなので、無効にはせず、列の数がこの上限に収まる回数に切る (ブラウザも repeat() の回数を自分の上限に切る)
 */
export const MAX_GRID_REPEAT = 10000;

/**
 * grid-template-columns の 1 つの列の大きさの長さ (pt。読めなければ undefined = 中身で決まる列として扱う): 計算値の長さ (px) と、
 * 百分率を含む calc()・min()・max()・clamp() (百分率は容器の内容の幅 W に対する割合。CSS Grid 1 §7.2.1・CSS Values 4 §10)
 */
function gridTrackLen(t: string, W: number): number | undefined {
  const abs = cssLen(t);
  if (abs !== undefined) return abs;
  // 百分率だけの語 (10%): 容器の内容の幅 W に対する割合 (CSS Grid 1 §7.2.1)
  if (/^[\d.]+%$/.test(t.trim())) return (parseFloat(t) * W) / 100;
  if (!/^(calc|min|max|clamp)\(/i.test(t)) return undefined;
  const px = lengthPx(t, { fs: 16, rootFs: 16, vw: NaN, vh: NaN, pct: W / PT_PER_PX });
  return px !== undefined && Number.isFinite(px) ? Math.max(px * PT_PER_PX, 0) : undefined;
}

/**
 * 展開した列の並びと、列ごとの決まり方 (gridTrackPlan)。
 * fixed: 決まった幅の列 (長さ・百分率・0fr)。それ以外 (fr・auto・minmax()・中身で決まる列) は undefined で、余りを分ける列 (share)。
 * pct: 決まった幅が容器の幅で変わる列 (百分率を含む長さ。中身の幅を測るときは auto: CSS Grid 1 §7.2.1)。
 * share の列の、余りを分ける比 (w)・下限 (b: 基準の大きさ。minmax() の最小の大きさか、項目の自動の最小の大きさ。CSS Grid 1 §6.6・§12.4・§12.5)・
 * 上限 (c: 最大の大きさが長さの minmax() の、成長の上限。§12.4・§12.6。無ければ Infinity)
 */
export interface GridTrackPlan {
  toks: string[];
  fixed: Array<number | undefined>;
  pct: boolean[];
  w: number[];
  b: number[];
  c: number[];
}

/**
 * 列の下限・幅の決め方の付け足し (gridTrackPlan・gridTracks)。
 * minOf: 列の項目の、書いた大きさから決まる最小の寄与の最大 (min-width の長さ・決まった width・スクロールの容器の枠と内側の余白。外側の幅)。
 * floorOf (項目の中身から測る自動の最小の大きさ) と違い、minmax(auto, <長さ>) の最大の大きさで抑えない (CSS Grid 1 §12.5 の minimum contribution:
 * 好みの大きさが auto なら、使う最小の大きさ (書いた min-width) を好みの大きさとしたときの外側の大きさ、決まっていれば min-content の寄与。
 * §6.6 の、最大の大きさの関数での抑えは、中身による最小の大きさ (content-based minimum size) だけに掛かる)。
 * indefinite: 容器の幅が決まらない (中身の幅を測る組版。W は 0)。百分率の最大の大きさは、決まった大きさとして数えない (§7.2.1・CSS Sizing 3 §5.2.1)
 */
export interface GridTrackOptions {
  minOf?: (k: number) => number;
  indefinite?: boolean;
}

/**
 * 百分率の列の幅の上限 (pt)。1e400% は Infinity に読める。範囲を超える値は、実装の扱える範囲の値に収める (CSS Values 4 §10.9・§5.1。
 * 0 にすると、範囲に収める向きと逆で、列が幅 0 になって字がはみ出す)。和・差が Infinity・NaN にならない大きさにする
 */
const MAX_TRACK_PT = 1e7;

/**
 * 1 つの語 (展開した列の大きさ) の、列の位置に依らない読み取り (gridTrackPlan)。kind は決まった幅の決まり方
 * (fixed: 長さ・百分率の決まった幅 (fixed が undefined なら余りを分ける列)、zfr: 0fr の列で、幅は項目の下限: §7.2.4・§12.7.1)。
 * w: 余りを分ける列の比 (縮める前)、mn: minmax() の最小の大きさの長さ、cap: minmax(auto, <長さ>) の、中身による最小の大きさの上限 (§6.6)、
 * max: minmax() の最大の大きさの長さ (成長の上限: §12.4)、hasPct: 語が百分率を含む (§7.2.1)
 */
interface TrackInfo {
  kind: 'fixed' | 'zfr';
  fixed?: number;
  hasPct: boolean;
  w: number;
  mn?: number;
  cap?: number;
  max?: number;
}

function trackInfo(t: string, W: number, isFr: (t: string) => boolean, pctOf: (t: string) => number, indefinite: boolean | undefined): TrackInfo {
  const hasPct = /%/.test(t);
  if (/%$/.test(t)) return { kind: 'fixed', fixed: pctOf(t), hasPct, w: 0 };
  if (isFr(t) && !(parseFloat(t) > 0)) return { kind: 'zfr', hasPct, w: 0 };
  const fixed = isFr(t) || /^auto$|^minmax/i.test(t) ? undefined : gridTrackLen(t, W);
  if (fixed !== undefined) return { kind: 'fixed', fixed, hasPct, w: 0 };
  const mm = gridMinmaxArgs(t);
  const top = mm ? mm[1] : t;
  const w = isFr(top) ? Math.max(parseFloat(top) || 0, 0) : 1;
  const mn = mm ? gridTrackLen(mm[0], W) : undefined;
  const cap = mm && /^auto$/i.test(mm[0]) && !isFr(mm[1]) && !(indefinite && /%/.test(mm[1])) ? gridTrackLen(mm[1], W) : undefined;
  const max = mm && !isFr(mm[1]) ? gridTrackLen(mm[1], W) : undefined;
  return { kind: 'fixed', hasPct, w, mn, cap, max };
}

/**
 * gridTrackPlan の覚え: 列の下限 (floorOf・opt.minOf) を渡さない呼び出しの結果は、入力 (並びの文字列・W・gap・auto-fill の回数・indefinite) だけで
 * 決まるので、覚えて返す (HTML の読み込みは、容器ごとに、同じ並びで何度も呼ぶ。同じ並びの容器も多い)。
 * 列の数は上限 MAX_GRID_REPEAT まであるので、覚える数に上限を置き、古いものから捨てる。返す計画は凍らせて、呼び手が書き換えないようにする
 */
const PLAN_MEMO_MAX = 16;
/** 覚えた計画と、auto-fill の回数 (times)、その計画での W の列の幅 (tracks: gridTracks。求めたときに入れる) */
interface PlanMemoEntry {
  plan: GridTrackPlan | undefined;
  times?: number;
  tracks?: readonly number[];
}
const planMemo = new Map<string, PlanMemoEntry>();

/**
 * grid-template-columns を、列の並びと、列ごとの決まり方にする (gridTracks の前半)。none・無効な並びは undefined (容器の幅いっぱいの 1 列)。
 * rep は repeat(auto-fill | auto-fit, …) の回数の受け渡し: rep.times が有れば、その回数で展開し、無ければ W から数えた回数を rep.times に入れる
 * (読み込みのときの幅の見積もりで決めた回数を、組むときに、容器の実際の幅で列の幅を決め直すときにも使う: 行に並べた項目の数を変えないため)
 */
export function gridTrackPlan(v: string, W: number, gap: number, floorOf?: (k: number) => number, rep?: { times?: number }, opt?: GridTrackOptions): GridTrackPlan | undefined {
  const hit = planMemoEntry(v, W, gap, floorOf, rep, opt);
  return hit ? hit.plan : computeTrackPlan(v, W, gap, floorOf, rep, opt);
}

/** 覚えた計画 (planMemo) を引く。覚えられない呼び出し (列の下限を渡すもの) は undefined。rep.times は、計画を作ったときと同じに入れる */
function planMemoEntry(v: string, W: number, gap: number, floorOf: ((k: number) => number) | undefined, rep: { times?: number } | undefined, opt: GridTrackOptions | undefined): PlanMemoEntry | undefined {
  // (-0 は鍵の文字列で 0 と区別できないので覚えない)
  if (floorOf || opt?.minOf || Object.is(W, -0) || Object.is(gap, -0)) return undefined;
  const key = JSON.stringify([v ?? '', W, gap, rep?.times ?? null, !!opt?.indefinite]);
  let hit = planMemo.get(key);
  if (hit) {
    // 新しく使ったものを後ろへ (捨てるのは前から)
    planMemo.delete(key);
    planMemo.set(key, hit);
  } else {
    const r: { times?: number } = { times: rep?.times };
    const plan = computeTrackPlan(v, W, gap, undefined, r, opt);
    if (plan) for (const a of Object.values(plan)) Object.freeze(a);
    hit = { plan: plan && Object.freeze(plan), times: r.times };
    planMemo.set(key, hit);
    if (planMemo.size > PLAN_MEMO_MAX) planMemo.delete(planMemo.keys().next().value!);
  }
  if (rep && hit.times !== undefined) rep.times = hit.times;
  return hit;
}

/**
 * 展開した列の並びと、語ごとの読み取り (TrackInfo) の覚え: 列の下限に依らず、入力 (並びの文字列・W・gap・auto-fill の回数・indefinite) だけで決まる。
 * 組版エンジンは、grid の容器ごとに、項目の下限を付けて計画を作るので (覚えの planMemo に入らない)、並びの展開と語の読み取りだけでも使い回す
 */
const baseMemo = new Map<string, { base: TrackBase | undefined; times?: number }>();

/** 展開した列の並び (凍らせてある) と、列ごとの語の読み取り */
interface TrackBase {
  toks: readonly string[];
  ix: TrackInfo[];
}

function computeTrackPlan(v: string, W: number, gap: number, floorOf?: (k: number) => number, rep?: { times?: number }, opt?: GridTrackOptions): GridTrackPlan | undefined {
  let base: TrackBase | undefined;
  if (Object.is(W, -0) || Object.is(gap, -0)) base = trackBase(v, W, gap, rep, opt?.indefinite);
  else {
    const key = JSON.stringify([v ?? '', W, gap, rep?.times ?? null, !!opt?.indefinite]);
    let hit = baseMemo.get(key);
    if (hit) {
      baseMemo.delete(key);
      baseMemo.set(key, hit);
    } else {
      const r: { times?: number } = { times: rep?.times };
      hit = { base: trackBase(v, W, gap, r, opt?.indefinite), times: r.times };
      baseMemo.set(key, hit);
      if (baseMemo.size > PLAN_MEMO_MAX) baseMemo.delete(baseMemo.keys().next().value!);
    }
    if (rep && hit.times !== undefined) rep.times = hit.times;
    base = hit.base;
  }
  if (!base) return undefined;
  const { ix } = base;
  // 0fr の列は、項目の書いた大きさからの最小の寄与 (minOf) よりも狭くならない
  const minOf = (k: number) => opt?.minOf?.(k) ?? 0;
  const n = ix.length;
  const fixed: Array<number | undefined> = new Array(n);
  const pct: boolean[] = new Array(n);
  const w: number[] = new Array(n);
  const b: number[] = new Array(n);
  const c: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const x = ix[k];
    const f = x.kind === 'zfr' ? Math.max(floorOf?.(k) ?? 0, minOf(k)) : x.fixed;
    fixed[k] = f;
    pct[k] = f !== undefined && x.hasPct;
    // 余りを分ける列の比 (fr の係数は 0 以上。CSS Grid 1 §7.2.4: 0fr も有効で、余りを取らない。minmax(a, Nfr) は N。
    // auto・中身で決まる列・ほかの minmax() は 1 (等分))
    w[k] = f !== undefined ? 0 : x.w;
    // 余りを分ける列の下限 (CSS Grid 1 §12.4 の基準の大きさ。§12.7.1: fr の列も、基準の大きさより狭くならない): minmax() の最小の大きさが
    // 長さ・百分率なら、それ。auto・中身で決まる語 (minmax() でない fr・auto の列も、最小の大きさは auto: §7.2.4) は、項目の自動の最小の大きさ
    // (floorOf。組版エンジンが、組むときに、項目の中身を測る。§6.6・§12.5)。minmax(auto, <長さ>) では、それを最大の大きさで抑える
    // (§6.6: 最大の大きさの関数が決まった大きさなら、中身による最小の大きさは、それより大きくならない。百分率の最大の大きさも、容器の幅が
    // 決まっていれば決まった大きさ。中身の幅を測るとき (opt.indefinite) は数えない: §7.2.1)。項目の書いた大きさからの最小の寄与 (opt.minOf:
    // min-width の長さ・決まった width) は抑えない (§12.5 の minimum contribution。抑えると、項目が隣の列に重なる)。
    // 最大の大きさが長さの minmax() は、その長さが上限 (§12.4 の成長の上限。上限が最小より小さければ最小。§7.2.3)
    let bk = 0;
    if (f === undefined) {
      if (x.mn !== undefined) bk = x.mn;
      else {
        const fl = floorOf?.(k) ?? 0;
        bk = Math.max(x.cap !== undefined ? Math.min(fl, x.cap) : fl, minOf(k));
      }
    }
    b[k] = bk;
    const max = f === undefined ? x.max : undefined;
    c[k] = max === undefined ? Infinity : Math.max(max, bk);
  }
  // とても大きい係数 (1e307fr) と、有限でない係数 (1e400fr は Infinity に読める) は、比を変えずに、最大の係数が 1 になるように縮める
  // (CSS Values 4 §5.1・§10.9: 範囲を超える値は、実装の扱える値に収める。和・積が Infinity・NaN にならないように)。
  // 縮める前の係数の和は 1 以上なので、和が 1 より小さいときの扱い (§12.7.1) は変わらない
  {
    let top = 0;
    for (const x of w) if (x > top) top = x;
    if (top > 1e6) for (let k = 0; k < w.length; k++) w[k] = top === Infinity ? (w[k] === Infinity ? 1 : 0) : w[k] / top;
  }
  return { toks: base.toks as string[], fixed, pct, w, b, c };
}

/** 列の並びを展開し、語ごとに読む (computeTrackPlan の前半)。none・無効な並びは undefined */
function trackBase(v: string, W: number, gap: number, rep: { times?: number } | undefined, indefinite: boolean | undefined): TrackBase | undefined {
  const src = (v ?? '').trim();
  if (!src || src === 'none') return undefined;
  // 列の並び (CSS Grid 1 §7.2: <track-list>) を、括弧の外の空白で語に分ける。線の名前 ([a b]。<line-names>) は列ではないので飛ばす
  // (前は括弧の中の空白でも分け、calc(10% + 16px) を 3 つの列に数えて、幅が NaN になっていた。線の名前も列に数えていた)。
  // repeat(n, a b) は展開する。回数は、中の列の数 × 回数が上限 (MAX_GRID_REPEAT) に収まる数に切る (巨大な回数で配列・文字列を作らない)。
  // repeat(auto-fill | auto-fit, …) (§7.2.3.2) の回数は、容器の幅に入る最大の数 (1 以上): 列の大きさは、最大の大きさの関数が
  // 決まった長さならそれ、そうでなければ最小の大きさの関数 (minmax(80px, 1fr) は 80px)。どちらも決まらなければ 1 回。
  // auto-fit の空の列を畳む (§7.2.3.2) のは見ず、auto-fill と同じに数える
  const trackTokens = gridTrackTokens;
  const repeatOf = GRID_REPEAT;
  const minmaxOf = gridMinmaxArgs;
  // 無効な列の並び (宣言ごと無効: 初期値 none と同じ 1 列。CSS Grid 1 §7.2。カスケードも、同じ検査で宣言を捨てる: cssText の gridTrackListInvalid)
  if (gridTrackListInvalid(src, (t) => gridTrackLen(t, W) !== undefined)) return undefined;
  const definite = (t: string): number | undefined => {
    const mm = minmaxOf(t);
    if (mm) return gridTrackLen(mm[1], W) ?? gridTrackLen(mm[0], W);
    return gridTrackLen(t, W);
  };
  const expandTracks = (list: string[]): string[] =>
    list.flatMap((t) => {
      const m = repeatOf.exec(t);
      if (!m) return [t];
      const body = expandTracks(trackTokens(m[2]));
      let times: number;
      if (/^auto-(fill|fit)$/i.test(m[1])) {
        const sizes = body.map(definite);
        const one = sizes.every((x) => x !== undefined) ? (sizes as number[]).reduce((a, b) => a + b, 0) + gap * body.length : undefined;
        // (幅は mm と pt を行き来した値なので、丸めの誤差で 1 列少なく数えないように、わずかに余裕を見る)
        // 容器の幅から、ほかの列 (どれも決まった大きさ。上の確かめ) とその間隔を引いた残りに入る回数 (§7.2.3.2)
        const others = list.filter((x) => x !== t).map(definite);
        const used = others.reduce<number>((a, x) => a + (x ?? 0) + gap, 0);
        times = rep?.times ?? (one !== undefined && one > 0 ? Math.max(1, Math.floor((W - used + gap) / one + 1e-6)) : 1);
        if (rep) rep.times = times;
      } else times = parseInt(m[1], 10) || 1;
      times = Math.min(times, Math.max(1, Math.floor(MAX_GRID_REPEAT / Math.max(body.length, 1))));
      return Array.from({ length: times }, () => body).flat();
    });
  const toks = expandTracks(trackTokens(src)).slice(0, MAX_GRID_REPEAT);
  const isFr = (t: string) => /fr$/i.test(t);
  // 0fr の列は余りを取らず、項目の自動の最小の大きさ (floorOf。min-content) になる (CSS Grid 1 §7.2.4・§12.7.1: fr の列の基準の大きさは、
  // 最小の大きさの関数 auto による中身の大きさ。0fr ではそれより広がらない)
  // (とても大きい百分率は、大きい有限の幅に収める: MAX_TRACK_PT。W が 0 (中身の幅を測るとき) の 1e400% は 0 × Infinity = NaN なので 0)
  const pctOf = (t: string) => {
    const v = (parseFloat(t) * W) / 100;
    return Number.isNaN(v) ? 0 : Math.min(Math.max(v, 0), MAX_TRACK_PT);
  };
  // 語ごとの読み取り (正規表現・長さ) は、列の位置 k に依らないので、語の種類ごとに 1 度だけ行う
  // (repeat() を展開した語は、ふつう数種類で、列は上限 MAX_GRID_REPEAT まである。列ごとに読み直すと、その数だけ正規表現を繰り返す)
  const infos = new Map<string, TrackInfo>();
  const ix = toks.map((t) => {
    let x = infos.get(t);
    if (!x) infos.set(t, (x = trackInfo(t, W, isFr, pctOf, indefinite)));
    return x;
  });
  return { toks: Object.freeze(toks), ix };
}

/**
 * 余りを分ける列 (share) の幅: 余り L を、比 w で分ける。どの列も、下限 b より狭くしない (CSS Grid 1 §12.7.1: 下限に当たった列は、
 * その幅で決まった列として、残りを分け直す)。比の和が 1 より小さければ、余りのその割合だけを配る (§12.7.1 の「Find the Size of an fr」:
 * 和を 1 とみなす)。下限に当たる列は、比 1 あたりの幅 f の区切り (b / w) を並べ、Σ max(w × f, b) が L になる区間を 2 分探しで見つけて
 * 決める (手間は、列の数 × その対数。1 本ずつ止めて分け直すと、列の数の 2 乗)
 */
function shareSizes(L: number, S0: number[], w: number[], b: number[], out: number[]): void {
  // 比 0 の列 (minmax(a, 0fr)) は、下限の幅 (余りから引く)
  const S: number[] = [];
  for (const k of S0) {
    if (w[k] > 0) S.push(k);
    else L -= out[k] = b[k];
  }
  if (!S.length) return;
  let baseSum = 0;
  for (const k of S) baseSum += b[k];
  if (baseSum >= L) {
    for (const k of S) out[k] = b[k];
    return;
  }
  const g = (f: number) => {
    let s = 0;
    for (const k of S) s += Math.max(w[k] * f, b[k]);
    return s;
  };
  const P = [0];
  for (const k of S) if (b[k] > 0) P.push(b[k] / w[k]);
  P.sort((x, y) => x - y);
  // g(P[lo]) ≦ L となる最後の区切り
  let lo = 0;
  let hi = P.length - 1;
  if (g(P[hi]) <= L) lo = hi;
  else
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g(P[mid]) <= L) lo = mid;
      else hi = mid;
    }
  // 区間 (P[lo], P[lo + 1]) の中で、下限に当たる列 (区切り b / w が P[lo] より後ろ) と、比で分ける列を分ける。
  // 区間の中の 1 点 (中ほど) の比 1 あたりの幅と比べると、比のとても小さい列 (1e307fr 1fr を縮めた 1e-307) の区切りが Infinity に溢れ、
  // 中ほども Infinity になって、下限に当たる列まで比で分けていた (列の和が容器からはみ出す)。区切りどうしを比べれば溢れても順は保つ
  let rem = L;
  let wAct = 0;
  const act: number[] = [];
  for (const k of S) {
    if (b[k] > 0 && b[k] / w[k] > P[lo]) rem -= out[k] = b[k];
    else {
      act.push(k);
      wAct += w[k];
    }
  }
  const div = Math.max(wAct, 1);
  rem = Math.max(rem, 0);
  for (const k of act) out[k] = Math.max((rem * w[k]) / div, b[k]);
}

/**
 * 余り L を、余りを分ける列 idx に配る (CSS Grid 1 §12.6・§12.7)。まず、どの列も下限 (基準の大きさ) にする。下限の和が L を超えれば、
 * そのまま (はみ出す)。残りは、上限のある列 (最大の大きさが長さの minmax()) を、上限まで等しく伸ばす (§12.6「Maximize Tracks」: 残りを
 * 基準の大きさに等しく配り、成長の上限に当たった列は止める。fr の列の成長の上限は基準の大きさ: §12.5 の終わり)。その残りを、fr・auto の列で
 * 比で分ける (§12.7「Expand Flexible Tracks」。auto の列も、fr の列と同じく、比 1 で分ける)。上限まで伸ばすのは、上限までの余地の小さい順に
 * 並べて、1 度で決める (手間は、列の数 × その対数)
 */
function distribute(L: number, idx: number[], w: number[], b: number[], c: number[], out: number[]): void {
  let baseSum = 0;
  for (const k of idx) baseSum += b[k];
  if (baseSum >= L) {
    for (const k of idx) out[k] = b[k];
    return;
  }
  const K = idx.filter((k) => Number.isFinite(c[k]));
  const O = idx.filter((k) => !Number.isFinite(c[k]));
  let free = L - baseSum;
  if (K.length) {
    const room = K.map((k) => c[k] - b[k]).sort((x, y) => x - y);
    let t = Infinity;
    let acc = 0;
    for (let i = 0; i < room.length; i++) {
      if (acc + room[i] * (room.length - i) >= free) {
        t = (free - acc) / (room.length - i);
        break;
      }
      acc += room[i];
    }
    for (const k of K) {
      const add = Math.min(c[k] - b[k], t);
      out[k] = add >= c[k] - b[k] ? c[k] : b[k] + add;
      free -= add;
    }
  }
  if (O.length) {
    let oBase = 0;
    for (const k of O) oBase += b[k];
    shareSizes(oBase + Math.max(free, 0), O, w, b, out);
  }
}

/**
 * grid-template-columns → 列の幅 (pt)。W は容器の内容の幅、gap は列の間隔 (pt)。px・%・fr・auto・minmax()・repeat() を読む
 * (fr・auto・中身で決まる列は、残りを比で分ける。最大の大きさが長さの minmax() は、先に、その長さまで伸ばす。minmax() の最小の大きさは、
 * その列の下限: distribute)。floorOf は、列の項目の自動の最小の大きさの最大 (0fr の列の幅で、最小の大きさが auto の列の下限。CSS Grid 1 §6.6・§12.5。
 * 組版エンジンが、組むときに、項目の中身を測る: LTable.gridTemplate.items)、
 * rep は auto-fill・auto-fit の回数の受け渡し (gridTrackPlan)、opt は書いた大きさからの下限など (GridTrackOptions)
 */
export function gridTracks(v: string, W: number, gap: number, floorOf?: (k: number) => number, rep?: { times?: number }, opt?: GridTrackOptions): number[] {
  const hit = planMemoEntry(v, W, gap, floorOf, rep, opt);
  if (!hit) return trackSizes(computeTrackPlan(v, W, gap, floorOf, rep, opt), W, gap);
  // (覚えた列の幅は、呼び手が書き換えても覚えが変わらないように、写しを返す)
  return (hit.tracks ??= trackSizes(hit.plan, W, gap)).slice();
}

/** 計画 (gridTrackPlan) と容器の内容の幅 W・列の間隔 gap から、列の幅を決める (gridTracks の後半) */
function trackSizes(plan: GridTrackPlan | undefined, W: number, gap: number): number[] {
  if (!plan) return [W];
  const { toks, fixed, w, b, c } = plan;
  const free0 = W - gap * Math.max(toks.length - 1, 0);
  const rest = Math.max(free0 - fixed.reduce<number>((a, x) => a + (x ?? 0), 0), 0);
  const out = fixed.map((x) => x ?? 0);
  distribute(
    rest,
    toks.map((_t, k) => k).filter((k) => fixed[k] === undefined),
    w,
    b,
    c,
    out,
  );
  return out;
}
