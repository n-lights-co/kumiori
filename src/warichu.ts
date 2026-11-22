/**
 * warichu — 割注 (JLREQ §3.4「割注処理」。https://www.w3.org/TR/jlreq/#inline_cutting_note 、2026-11-20 取得)。
 *
 * 割注は、行の途中に、本文より小さい字で 2 行に割って入れる注 (§3.4.1)。組み方 (§3.4.2・§3.4.3):
 *  - 割注の 2 行の間は 0 (行間を取らない)。ただし、2 行の間に入るルビ (2 行目の前側のルビ・1 行目の後側のルビ) があるときは、その分を空ける
 *    (§3.4 は割注の中のルビを定めない。空けないと、ルビがもう 1 つの行の字に重なる。warichuBox)
 *  - 割注の中の字でない箱 (画像・inline-block など) と、割注の中の割注は、割注の中では組まない (読み込みが警告に出す。dropWarichuBoxes)
 *  - 割注全体の前後を、割注の字の 2 倍の大きさの括弧 (割注始め括弧類 cl-28・割注終わり括弧類 cl-29) でくくる。括弧と前後の
 *    漢字・仮名の間はベタ。括弧を付けない形もある (LWarichu の open・close が空の文字列)
 *  - 割注の 2 行の幅の中心を、本文の行の幅の中心にそろえる。はみ出しは両側に均等に出し、本文の行間は割注の無い所の行間のまま
 *    (割注で行を高くしない)
 *  - 2 行は、分割できる所 (本文と同じ決まり) のうち、割注の字の並びの半分に最も近い所で分ける。2 行目を 1 行目より長くしない
 *  - 本文の 1 行に収まらない割注は、行末で分けて次の行に続ける。行ごとの部分を、それぞれ 2 行に割る (§3.4.3)
 *  - 禁則 (§3.1.7・§3.1.8・§3.1.10): 割注終わり括弧類を行頭に、割注始め括弧類を行末に置かない。割注始め括弧類の後ろ・割注終わり括弧類の前では分けない
 *
 * 組版の流れ:
 *  1. 平らにする (inlineFlatten.ts の flattenInlineElement): 割注の中身を、字ごとの atom (wari の印つき) にし、前後に括弧の atom を置く
 *  2. 行を分ける前 (prepareWarichu): 字の送りを、2 字で 1 字分 (2 行に割ったときの幅の見積もり) にし、分けてよい所を、2 字ごとの切れ目だけにする
 *  3. 行を作るとき (packWarichu。inlineLayout.ts の makeLine): 行に入った割注の atom を、2 行に割った 1 つの行内の箱にする。箱の行の高さへの
 *     効き方は、本文の字 1 字 (まわりの字の大きさの em の箱) と同じ
 */
import type { LNode, ResolvedStyle } from './lnode';
import { newNode } from './lnode';
import type { LFootnote, LInlineLevel, WritingMode } from './types';
import { buildLineNode, glyphNode, lineMetrics, positionLine, reorderLine, type Atom, type InlineContentArea, type InlineFrame } from './inlineLayout';

/** 1 つの割注 (LInline.warichu の inline 1 つ) の、組むのに要る値 */
export interface WarichuGroup {
  /** 割注の中身の書式 (割注の inline の書式。字の大きさが、割注の字の大きさ) */
  st: ResolvedStyle;
  /** 割注を置く行の、まわりの書式 (割注の inline の親) */
  outer: ResolvedStyle;
  /**
   * まわりの書式の、行の高さに使う基線の比 (字の大きさの箱の上端から基線まで)。割注の箱の行の中での上下 (BoxSpec の above・below) は、
   * この比で、本文の字 1 字と同じにする (HTML の行は、書体の上下から決めた比。inlineFlatten.ts の fontBaselineRatio)
   */
  outerRatio: number;
  /**
   * まわりの字の em の箱 (字を描く箱) の基線の比 (横書きは最初に使える書体の値、縦書きは中央の基線で 0.5)。割注の 2 行と括弧は、
   * この em の箱の中央に置く。outerRatio と違うとき (HTML の行) は、その差だけ箱の中でずらす
   */
  outerEmRatio: number;
  /** 割注の書式の基線の比 (横書きは最初に使える書体の値、縦書きは中央の基線で 0.5)。割注の 2 行を、この基線でそろえて置く */
  innerRatio: number;
  wm: WritingMode;
  /** 右から左の段落 (割注の 2 行の中の字を、行ごとに並べ替えるとき (reorderLine) の段落の向き) */
  rtl: boolean;
  /** 割注の inline の背景の色 (割注の箱の内容の領域 area に塗る) */
  bg?: string;
  /** まわりから引き継いだ背景の色 (割注の inline に背景が無いとき、割注の箱に塗る) */
  outerBg?: string;
  /**
   * 割注の内容の領域 (割注の inline の罫線・余白・背景・リンクの範囲の block 方向の広がり。warichuArea): 割注の 2 行と括弧 (厚さ 2s) を、
   * まわりの字の em の箱の中央に置いた範囲。行の基線からの上・下の長さ
   */
  area: InlineContentArea;
}

/**
 * 割注の内容の領域 (WarichuGroup.area)。割注の inline は、ほかの行内の箱 (inline) と同じく、内容の領域の外側に余白・罫線を付ける
 * (CSS 2.1 §8.3・§10.6.1、XSL 1.1 §4.2.3)。内容の領域は、割注の 2 行と括弧の厚さ 2s を、まわりの字 (大きさ E) の em の箱の中央に置いた範囲
 * (JLREQ §3.4.2: 割注の 2 行の幅の中心を、本文の行の中心にそろえる)。横書きの基線は em の箱の上端から outerRatio·E、縦書きは中央の基線。
 * 上下の余白・罫線は、行の高さに数えない (CSS 2.1 §10.6.1: 置換でないインラインの箱の上下の padding・罫線・margin は、内容の領域の
 * 上端・下端から外へ取り、line-height とは関わらない。XSL 1.1 §4.2.3 の normal-allocation-rectangle も、
 * block 方向は内容の矩形まで)
 */
export function warichuArea(s: number, outerSize: number, outerRatio: number, wm: WritingMode): InlineContentArea {
  if (wm !== 'horizontal-tb') return { above: s, below: s, shift: 0 };
  // em の箱の中央の、基線からの高さ
  const c = outerRatio * outerSize - outerSize / 2;
  return { above: c + s, below: s - c, shift: 0 };
}

/**
 * 割注の中身から、字でない行内の箱 (画像・数式・inline-block・fo:inline-container など) を除く。割注の 2 行は、割注の字の大きさの刻みで
 * 重ねる (JLREQ §3.4.2: 2 行の間は 0) ので、字より高い箱は、もう 1 つの行や本文の行に重なる。割注の中では組まずに、読み込みが警告に出す。
 * 中の inline の中も見る。除いた数を返す
 */
export function dropWarichuBoxes(kids: LInlineLevel[]): number {
  let n = 0;
  for (let k = kids.length - 1; k >= 0; k--) {
    const c = kids[k];
    if (typeof c === 'string') continue;
    if (c.type === 'image' || c.type === 'inline-container') {
      kids.splice(k, 1);
      n++;
    } else if (c.type === 'inline') n += dropWarichuBoxes(c.children);
  }
  return n;
}

/** 割注の atom の印 (Atom.wari) */
export interface WarichuMark {
  g: WarichuGroup;
  /** open・close: 前後の括弧の字。text: 中身 */
  part: 'open' | 'close' | 'text';
  /**
   * 割注を平らにしたときに、この atom に付いていた枠の数 (割注の中の inline の枠。Atom.frames の後ろの方。外側から並ぶので、割注の inline と
   * その祖先の枠は、後から前に足される)。割注の箱の外側に描く枠と、2 行の中で描く枠を分けるのに使う
   */
  inner?: number;
  /** prepareWarichu が書き換える前の、送りと改行の機会 (組むときは、これに戻す) */
  adv?: number;
  lb?: boolean;
  glue?: boolean;
}

const EPS = 1e-6;

/**
 * 割注の括弧の指定 (CSS の -kumiori-warichu-brackets・XSL-FO の kumiori:warichu-brackets) を読む: auto (既定の括弧)・none (付けない)・
 * 2 つの文字列 (開き・閉じ)。読めなければ undefined。既定の括弧は、全角の丸括弧 (JLREQ §3.4.2: 始め小括弧・終わり小括弧)。
 * unescape を渡すと CSS の文字列として読み、中のエスケープ (「\」の後ろの字・16 進の符号位置。CSS Syntax 3 §4.3.7) を、その関数で戻す。
 * 渡さなければ XSL の式の文字列 (XSL 1.1 §5.9 の式の Literal: 引用符で囲んだ字の並び。エスケープは無い) として読む
 */
export function parseWarichuBrackets(v: string | undefined, unescape?: (s: string) => string): { open: string; close: string } | undefined {
  const s = (v ?? '').trim();
  if (s === '' || s === 'auto') return { open: '\uFF08', close: '\uFF09' };
  if (s === 'none') return { open: '', close: '' };
  const str = unescape ? String.raw`("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')` : String.raw`("[^"]*"|'[^']*')`;
  const m = new RegExp(String.raw`^${str}\s+${str}$`).exec(s);
  if (!m) return undefined;
  const unq = (t: string) => (unescape ? unescape(t.slice(1, -1)) : t.slice(1, -1));
  return { open: unq(m[1]), close: unq(m[2]) };
}

/**
 * 行を分ける前に、割注の atom の送りと改行の機会を決め直す (和文の字間の調整 adjustJapaneseSpacing の後、行を分ける前に 1 度だけ)。
 *  - 中身の字: 2 行に割ると、2 字が 1 字分の幅を占める。2 字ずつの組の、最初の字の送りを 2 字の送りの平均にし、2 つ目を 0 にする
 *    (字の数が奇数なら、最後の字は 1 字で 1 列を占めるので、その字の送りのまま)。
 *    行を分けてよいのは組の切れ目 (割注の始めから偶数字の後ろ) だけ: 行の中の部分の字の数が偶数なら、2 行の字の数がそろい、
 *    その幅は見積もりと同じ (§3.4.2: 2 行の行長をそろえる)。分けてよいかは、その切れ目の前後の字の決まり (本文と同じ) による。
 *    幅の無い目印 (中身の無い inline の id など) は組に数えず、前で分けない。空白の前でも分けない (行末の空白を飛ばして次の行を始めると、
 *    次の行の部分が組の途中から始まるため)。割注の中では分綴しない (分綴のハイフンは、割注の 2 行の箱の外に出てしまう)
 *  - 括弧: 全角の括弧は、字の外側の二分を詰める (前後の字との間はベタ。§3.4.2)。最初の字の前 (割注始め括弧類の後ろ)・
 *    閉じの括弧の前 (割注終わり括弧類の前) では分けない (§3.1.10)
 */
export function prepareWarichu(atoms: Atom[]): void {
  let k = 0;
  while (k < atoms.length) {
    const w = atoms[k].wari;
    if (!w) {
      k++;
      continue;
    }
    let e = k + 1;
    while (e < atoms.length && atoms[e].wari?.g === w.g) e++;
    // 分綴の位置は、書き換えた後 (::first-line の 1 行目を先に組んだ後) に付いたものも捨てる
    for (let q = k; q < e; q++) delete atoms[q].hyphen;
    // 2 度目 (同じ並びを組み直すとき) は、書き換えない
    if (w.adv === undefined) {
      let t = 0;
      let opened = false;
      // 組に数えない atom: 幅の無い目印と、中の inline の罫線・余白の空き (frameOpen・frameClose)・外側の余白の空き (edgeGap)。
      // 空きは、2 行のどちらかに、そのままの幅で入る (見積もりには、その幅をそのまま数える)
      const blank = (a: Atom) => (a.advance === 0 && (!!a.idMark || !!a.hidden || a.kind === 'box')) || !!a.frameOpen || !!a.frameClose || !!a.edgeGap;
      for (let q = k; q < e; q++) {
        const a = atoms[q];
        // 印は atom ごとに写してから書く (つながる字の語を分けた断片 (splitJoinedAtoms) は、元の atom の印を共有している)
        const m: WarichuMark = (a.wari = { ...a.wari! });
        m.adv = a.advance;
        m.lb = a.lbBefore;
        m.glue = a.glue;
        if (m.part === 'text') {
          if (blank(a)) {
            a.glue = true;
            continue;
          }
          // 組の最初の字は、2 字の送りの平均 (組の相手の無い最後の字は、1 字で 1 列を占めるので、その字の送り)
          let r = q + 1;
          while (r < e && atoms[r].wari?.part === 'text' && blank(atoms[r])) r++;
          const next = r < e && atoms[r].wari?.part === 'text' ? atoms[r] : undefined;
          a.advance = t % 2 === 1 ? 0 : next ? (a.advance + next.advance) / 2 : a.advance;
          if (t % 2 === 1 || (t === 0 && opened) || a.isSpace) a.glue = true;
          t++;
        } else {
          trimBracket(a, m.part);
          if (m.part === 'open') {
            if (opened) a.glue = true;
            opened = true;
          } else a.glue = true;
        }
      }
    }
    k = e;
  }
}

/** 全角の括弧 (字の大きさの 9 割以上の送り) の、外側の二分を詰める。開きは前、閉じは後ろ */
function trimBracket(a: Atom, part: 'open' | 'close' | 'text'): void {
  delete a.trail;
  const fs = a.st.fontSize;
  const base = a.g?.advance ?? a.advance;
  a.advance = base;
  delete a.dx;
  if (base > fs * 0.9) {
    a.advance = base - fs / 2;
    if (part === 'open') a.dx = -fs / 2;
  }
}

/** 行の字 (items) の中の割注の atom を、割注ごとに 1 つの行内の箱にする (割注が無ければ items のまま) */
export function packWarichu(items: Atom[]): Atom[] {
  if (!items.some((a) => a.wari)) return items;
  const out: Atom[] = [];
  let k = 0;
  while (k < items.length) {
    const w = items[k].wari;
    if (!w) {
      out.push(items[k++]);
      continue;
    }
    let e = k + 1;
    while (e < items.length && items[e].wari?.g === w.g) e++;
    out.push(warichuBox(items.slice(k, e)));
    k = e;
  }
  return out;
}

/** 書き換える前の atom (送り・改行の機会を戻し、割注の印を外したもの) */
function restored(a: Atom): Atom {
  const m = a.wari!;
  const { wari: _w, ...rest } = a;
  const r: Atom = { ...rest, advance: m.adv ?? a.advance };
  if (m.adv !== undefined) {
    if (m.lb === undefined) delete r.lbBefore;
    else r.lbBefore = m.lb;
    if (m.glue === undefined) delete r.glue;
    else r.glue = m.glue;
  }
  return r;
}

/**
 * 中身の字を 2 行に分ける位置 (2 行目の最初の字の番号)。2 行の長い方が、行を分けたときの見積もりの幅 (limit) に収まる所から選ぶ
 * (見積もりより広くすると、本文の行から溢れる)。その中で、次の順に:
 *  1. 分割できる所 (前で改行してよい字。本文と同じ決まり) で、2 行目が 1 行目より長くならない所 (§3.4.2) のうち、1 行目がいちばん短い所
 *     (割注の字の並びの半分に最も近い所)
 *  2. 分割できる所のうち、2 行の長い方がいちばん短い所 (禁則で半分の所で分けられないとき。2 行目が 1 行目より 1 字ほど長くなる)
 *  3. 分割できる所が無ければ、字の間 (字の単位の途中を除く) で 1 と同じ所 (2 行目の頭に、行頭に置けない字 (。など) が来る。
 *     分けられない語 (欧文の語など) は、語の途中で分ける)
 * 見積もりに収まる所が無ければ (行を分ける前に組んでいないとき)、2 行の長い方がいちばん短い所。字が 1 つなら、全部を 1 行目にする
 */
function splitIndex(text: Atom[], limit: number): number {
  const n = text.length;
  if (n < 2) return n;
  const total = text.reduce((s, a) => s + a.advance, 0);
  const allowed = (a: Atom) => !a.glue && a.lbBefore !== false && !a.isSpace;
  const between = (a: Atom) => !a.clusterCont && !a.joinPiece && !(a.advance === 0 && (a.idMark || a.hidden));
  let best1 = -1;
  let best2 = -1;
  let best3 = -1;
  let w1Of1 = Infinity;
  let wideOf2 = Infinity;
  let w1Of3 = Infinity;
  let any = n;
  let anyWide = Infinity;
  let w1 = 0;
  for (let m = 1; m < n; m++) {
    w1 += text[m - 1].advance;
    const a = text[m];
    const w2 = total - w1;
    const wide = Math.max(w1, w2);
    const fits = wide <= limit + EPS;
    const longer1 = w2 <= w1 + EPS;
    if (allowed(a) && fits) {
      if (longer1 && w1 < w1Of1) [best1, w1Of1] = [m, w1];
      if (wide < wideOf2 - EPS || (Math.abs(wide - wideOf2) <= EPS && longer1)) [best2, wideOf2] = [m, wide];
    }
    if (between(a)) {
      if (fits && longer1 && w1 < w1Of3) [best3, w1Of3] = [m, w1];
      if (wide < anyWide - EPS || (Math.abs(wide - anyWide) <= EPS && longer1)) [any, anyWide] = [m, wide];
    }
  }
  return best1 >= 0 ? best1 : best2 >= 0 ? best2 : best3 >= 0 ? best3 : any;
}

/** 行の中の 1 つの割注の部分 (run: 同じ割注の atom の並び) を、2 行に割った行内の箱にする */
function warichuBox(run: Atom[]): Atom {
  const g = run[0].wari!.g;
  const { wm, st } = g;
  // 括弧は、prepareWarichu が詰めた送り (前後の字との間をベタにしたもの) のまま使う
  const opens = run.filter((a) => a.wari!.part === 'open');
  const closes = run.filter((a) => a.wari!.part === 'close');
  const textRun = run.filter((a) => a.wari!.part === 'text');
  // 割注の inline とその祖先の枠 (罫線・余白・リンク) は、割注の箱の外側に 1 つだけ描く (行の中の割注の箱の atom に付ける)。2 行の中では
  // 描かない。割注の中の inline の枠 (平らにしたときに付いていた枠。WarichuMark.inner) は、2 行の中で描く
  const shared = outerFrames(run[0]);
  const text = textRun.map((a) => {
    const r = restored(a);
    const inner = innerFrames(a);
    if (inner.length) r.frames = inner;
    else delete r.frames;
    // 割注の inline の背景 (内容の領域が割注の領域のもの) は、割注の箱に塗るので、2 行の中では塗らない
    if (r.bgArea === g.area) {
      delete r.bg;
      delete r.bgArea;
    }
    return r;
  });
  // 行を分けたときの見積もりの幅 (prepareWarichu の送りの合計)。組み直さずに組んだとき (見積もりの無いとき) は、半分
  const estimate = textRun.reduce((t, a) => t + a.advance, 0);
  const m = splitIndex(text, textRun[0]?.wari!.adv !== undefined ? estimate : text.reduce((t, a) => t + a.advance, 0) / 2);
  const rows = [text.slice(0, m), text.slice(m)];
  // 2 行目の行頭の空白は捨てる (行末の空白は、行を作るときに捨てる)
  while (rows[1].length && rows[1][0].isSpace) rows[1].shift();
  const s = st.fontSize;
  const rowSt: ResolvedStyle = { ...st, textAlign: 'start', textAlignLast: 'start' };
  // まわりの字の大きさの em の箱 (割注の箱の、行の中での大きさ)。割注の 2 行 (厚さ 2s) と括弧 (大きさ 2s) は、その中央に置く
  const E = g.outer.fontSize;
  // 横書き: 箱の上端は行の基線から outerRatio·E の所、まわりの字の em の箱の上端は outerEmRatio·E の所。その em の箱の中央に、厚さ 2s を置く。
  // 縦書き: 箱は中央の基線を挟んで半分ずつ (lineMetrics.ts の atomAboveBelow) で、em の箱と同じ
  // 2 行の間 (JLREQ §3.4.2 では 0)。2 行目の親文字の前側 (横書きは上、縦書きは右) のルビと、1 行目の後側 (ruby-position: under) のルビは、
  // 2 行の間に入るので、その分だけ 2 行の間を空ける (空けないと、もう 1 つの行の字に重なる)。2 行と括弧は、空けた分を含めて em の箱の中央に
  // 置くので、割注は本文の行から前後に gap / 2 ずつはみ出しうる (行の高さは変えない)。
  // 上付き・下付き (vertical-align: super・sub・長さ。CSS 2.1 §10.8.1。XSL の baseline-shift) でずらした字と、割注の字より大きい字も、
  // 2 行目の前側・1 行目の後側へ、割注の字の大きさの箱からはみ出すので、ルビと同じく、はみ出した分だけ 2 行の間を空ける。
  // はみ出しは、行の基線の比 (innerRatio) で測った字の大きさの箱で比べる (割注の字と同じ大きさの、ずらしていない字は 0。書体ごとの比の違いでは空けない)
  const ratio = g.innerRatio;
  const over = (a: Atom) => (a.kind === 'glyph' && !a.isSpace) || a.kind === 'ruby';
  const gapBefore = rows[1].reduce((t, a) => (over(a) ? Math.max(t, ratio * a.st.fontSize + (a.shift ?? 0) - ratio * s + (a.r?.rubyExtent ?? 0)) : t), 0);
  // 2 行目が無い (1 行目だけで組む) ときは、1 行目の後側のはみ出しが重なる相手が無いので、空けない (空けると、1 行目が gap / 2 だけ前へずれる)
  const gapAfter = rows[1].some(over) ? rows[0].reduce((t, a) => (over(a) ? Math.max(t, (1 - ratio) * a.st.fontSize - (a.shift ?? 0) - (1 - ratio) * s + (a.r?.underExtent ?? 0)) : t), 0) : 0;
  const gap = gapBefore + gapAfter;
  const top0 = (wm === 'horizontal-tb' ? (g.outerRatio - g.outerEmRatio) * E : 0) + (E - 2 * s - gap) / 2;
  const openW = opens.reduce((t, a) => t + a.advance, 0);
  const closeW = closes.reduce((t, a) => t + a.advance, 0);
  // 右から左の深さの括弧 (右から左の段落で、まわりの字が右から左の向きのとき。UAX #9 の L4 で鏡像の字にしてある): 割注の箱の中を
  // 右から左に置く (開きを右、閉じを左)。括弧の外側の詰め (trimBracket) も、鏡像の字の外側 (開きは右、閉じは左) にする
  const rtlBox = wm === 'horizontal-tb' && [...opens, ...closes].some((a) => (a.bidiLevel ?? 0) % 2 === 1);
  const leftW = rtlBox ? closeW : openW;
  const rowNodes: LNode[] = [];
  let bodyW = 0;
  const fns: LFootnote[] = [];
  rows.forEach((row, r) => {
    for (const a of row) if (a.fnRef) fns.push(a.fnRef);
    if (!row.length) return;
    const raw = { items: trimEnd(row), last: true, indent: 0 };
    const len = raw.items.reduce((t, a) => t + a.advance, 0);
    const pl = positionLine(raw, len, rowSt);
    // 右から左の字は、行ごとに並べ替える (UAX #9 の L2。本文の行と同じ。inlineLayout.ts の reorderLine)
    if (wm === 'horizontal-tb') reorderLine(pl, len, g.rtl);
    const lm = lineMetrics(pl, wm, rowSt);
    const line = buildLineNode(pl, lm, 0, wm, pl.contentLength);
    // 行の基線 (buildLineNode の baseline) を、r 行目の字の大きさの箱 (上端 top0 + r·s) の基線にそろえる。行の上端でそろえると、
    // 中の目印の箱 (幅の無い inline の支柱) などで行の上の高さが変わったとき、2 行の間が空いたり重なったりする
    const base = line.baseline ?? lm.leading / 2 + lm.above;
    const node = newNode('inline', wm, { i: leftW, b: top0 + r * (s + gap) + g.innerRatio * s - base, isize: pl.contentLength, bsize: lm.base });
    node.children = line.children;
    rowNodes.push(node);
    bodyW = Math.max(bodyW, pl.contentLength);
  });
  const isize = openW + bodyW + closeW;
  const box = newNode('inline', wm, { isize, bsize: E });
  // 括弧: 大きさ 2s の字の em の箱を、割注の 2 行の厚さ (2s) にそろえて置く
  const bracket = (list: Atom[], x0: number, part: 'open' | 'close') => {
    let x = x0;
    for (const a of list) {
      if (a.g && !a.hidden) {
        const gn = glyphNode(a.g, a.st, wm, a.first, a.st.fontSize, a.st.color, a.src);
        if (a.ref !== undefined) gn.ref = a.ref;
        // 詰めた幅 (字の送りと atom の送りの差)。左から右は、開きの前 (左) を詰めてある (dx)。右から左は、閉じの左を詰める
        const trimmed = Math.max(0, a.g.advance - a.advance);
        gn.i = x + (rtlBox ? (part === 'close' ? -trimmed : 0) : (a.dx ?? 0));
        gn.b = top0 + s + gap / 2 - a.st.fontSize / 2;
        box.children.push(gn);
      }
      x += a.advance;
    }
  };
  if (rtlBox) {
    bracket(closes, 0, 'close');
    box.children.push(...rowNodes);
    bracket(opens, closeW + bodyW, 'open');
  } else {
    bracket(opens, 0, 'open');
    box.children.push(...rowNodes);
    bracket(closes, openW + bodyW, 'close');
  }
  if (fns.length) box.fns = fns;
  const first = run[0];
  const br = g.outerRatio;
  const boxSt: ResolvedStyle = { ...g.outer, textDecoration: undefined };
  const atom: Atom = {
    kind: 'box',
    first: '￼',
    last: '￼',
    advance: isize,
    isSpace: false,
    runId: first.runId,
    st: boxSt,
    box: { node: box, adv: isize, cross: E, above: br * E, below: (1 - br) * E },
    wariBox: true,
  };
  for (const key of ['bidiLevel', 'bidiPara', 'ref', 'src', 'paraStart', 'afterBreak'] as const) if (first[key] !== undefined) (atom as unknown as Record<string, unknown>)[key] = first[key];
  // 割注の箱の背景: 割注の inline の背景は、割注の内容の領域に塗る。無ければ、まわりから引き継いだ背景 (その背景の inline の領域)
  if (g.bg) Object.assign(atom, { bg: g.bg, bgArea: g.area });
  else if (g.outerBg) {
    const from = run.find((a) => a.bg === g.outerBg);
    Object.assign(atom, { bg: g.outerBg, ...(from?.bgArea ? { bgArea: from.bgArea } : {}) });
  }
  if (shared.length) atom.frames = shared;
  return atom;
}

/** 割注の inline とその祖先の枠 (外側から) */
function outerFrames(a: Atom): InlineFrame[] {
  const fs = a.frames ?? [];
  return fs.slice(0, fs.length - (a.wari?.inner ?? 0));
}

/** 割注の中の inline の枠 (外側から) */
function innerFrames(a: Atom): InlineFrame[] {
  const fs = a.frames ?? [];
  return fs.slice(fs.length - (a.wari?.inner ?? 0));
}

/** 行末の空白を捨てる */
function trimEnd(row: Atom[]): Atom[] {
  let e = row.length;
  while (e > 0 && row[e - 1].isSpace) e--;
  return row.slice(0, e);
}
