/**
 * drawioCanvas — draw.io の JavaScript で書かれた形 (drawioShapes.ts) を描くための道具。mxGraph の mxAbstractCanvas2D・mxSvgCanvas2D と
 * 同じ名前の命令 (begin・moveTo・lineTo・arcTo・rect・ellipse・fill・stroke・setFillColor・translate・save・restore など) を持ち、SVG の要素を書く。
 * 図形ライブラリの形 (ステンシル) は stencil で、今の色・線の状態のまま描く (mxStencil.drawShape)。
 * 根拠: mxGraph の公開のソース (Apache License 2.0) の mxAbstractCanvas2D・mxSvgCanvas2D・mxShape.addPoints
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencil.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxAbstractCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import { esc, f, type XEl } from './drawioXml';
import { stencilSvg, type StencilContext } from './drawioStencil';

export interface Pt {
  x: number;
  y: number;
}

interface CanvasState {
  fill?: string;
  stroke?: string;
  sw: number;
  alpha: number;
  fillAlpha: number;
  strokeAlpha: number;
  dashed: boolean;
  dash: string;
  fixDash: boolean;
  cap: string;
  join: string;
  miter: number;
  fontColor: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: number;
  /** 座標の写し方 (x' = a x + c y + e、y' = b x + d y + f。translate・rotate が積む) */
  m: [number, number, number, number, number, number];
}

export interface CanvasHost {
  /** 図形ライブラリの形を引く (無ければ、呼ぶ側が警告し、足りないライブラリを覚える) */
  stencil: (name: string) => XEl | undefined;
  /** グラデーションを作って url(#…) を返す (dir: south・north・east・west・radial。alpha1・alpha2: 両端の不透明度 (stop-opacity)) */
  gradient: (c1: string, c2: string, dir: string, alpha1?: number, alpha2?: number) => string;
  /** ステンシルを描くときの文脈 */
  stencilCtx: StencilContext;
  /** セルのスタイル (ステンシルの色の属性に書いたキーの名前を引く) */
  style: Record<string, string>;
  /**
   * 画像 (src: draw.io の配布物の画像の道。img/lib/sap/<名前>.svg など) を、枠 b (今の座標系) に置く SVG の要素を返す。
   * 描けなければ undefined (呼ぶ側が警告し、足りない画像を覚える)
   */
  image?: (src: string, b: { x: number; y: number; w: number; h: number }, aspect: boolean) => string | undefined;
}

/**
 * 書いてよい SVG の字の数 (StencilContext.budget.chars。drawio.ts の LIMITS.svgChars の残り) を使い切った。
 * 道具が投げ、drawio.ts がそのセルを描くのをやめる (形の JavaScript の繰り返しが、どれだけ長くても、そこで止まる)
 */
export class SvgBudgetExceeded extends Error {}

/** 色の値 (none・空は塗らない) */
const paintOf = (c: string | undefined | null) => (!c || c === 'none' ? undefined : c);

export class ShapeCanvas {
  readonly out: string[] = [];
  private st: CanvasState;
  private stack: CanvasState[] = [];
  private d = '';
  /**
   * 最後の命令が移動 (moveTo) なら、その命令 (まだ d に足していない)。次の移動は、これを置き換える。
   * 前は、移動のたびに、伸びていく経路の文字列の全体に置き換え (/M[^A-Za-z]*$/) をかけた: 経路の長い形 (step=0.0001 の patternFillRect。
   * 1 つで線 2 万本) で、移動ごとに経路の全体を写して 2 乗の手間になった (10 個・420 バイトで 41.8 秒)
   */
  private pm = '';

  constructor(
    init: { fill?: string; stroke?: string; strokeWidth: number; dashed: boolean; dashPattern: string; fixDash: boolean; fillAlpha: number; strokeAlpha: number; fontColor?: string; fontSize?: number; fontFamily?: string },
    private host: CanvasHost,
  ) {
    this.st = {
      fill: paintOf(init.fill),
      stroke: paintOf(init.stroke),
      sw: init.strokeWidth,
      alpha: 1,
      fillAlpha: init.fillAlpha,
      strokeAlpha: init.strokeAlpha,
      dashed: init.dashed,
      dash: init.dashPattern,
      fixDash: init.fixDash,
      cap: 'butt',
      join: 'miter',
      miter: 10,
      fontColor: init.fontColor ?? '#000000',
      fontSize: init.fontSize ?? 11,
      fontFamily: init.fontFamily ?? 'Arial',
      fontStyle: 0,
      m: [1, 0, 0, 1, 0, 0],
    };
  }

  // ───── 状態 ─────
  save() {
    this.stack.push({ ...this.st });
  }
  restore() {
    this.st = this.stack.pop() ?? this.st;
  }
  translate(dx: number, dy: number) {
    const [a, b, c, d, e, f0] = this.st.m;
    this.st.m = [a, b, c, d, e + a * dx + c * dy, f0 + b * dx + d * dy];
  }
  /** 今の座標系に、行列を右から掛ける */
  private multiply(n: [number, number, number, number, number, number]) {
    const [a, b, c, d, e, f0] = this.st.m;
    this.st.m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f0];
  }
  /** (cx, cy) を中心に、反転してから theta 度回す (mxSvgCanvas2D.rotate) */
  rotate(theta: number, flipH: boolean, flipV: boolean, cx: number, cy: number) {
    if (!theta && !flipH && !flipV) return;
    this.translate(cx, cy);
    if (flipH || flipV) this.multiply([flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, 0, 0]);
    if (theta) {
      const r = (theta * Math.PI) / 180;
      this.multiply([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    }
    this.translate(-cx, -cy);
  }
  /** 何もしない (mxGraph の影・経路の終わり。Kumiori は影を図形の外で付ける) */
  setShadow(_on: boolean) {}
  end() {}
  setFillColor(c: string | undefined | null) {
    this.st.fill = paintOf(c);
  }
  /**
   * 塗りのグラデーション (mxAbstractCanvas2D.setGradient: 方向の既定 south は、上が c1・下が c2)。
   * alpha1・alpha2 は両端の不透明度 (mxSvgCanvas2D.getSvgGradient の stop-opacity。既定 1。0〜1 に収める。塗りの不透明度とは別に掛かる)
   */
  setGradient(c1: string | undefined, c2: string | undefined, dir = 'south', alpha1 = 1, alpha2 = 1) {
    const a = paintOf(c1);
    const b = paintOf(c2);
    const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
    this.st.fill = a && b ? this.host.gradient(a, b, dir, clamp(alpha1), clamp(alpha2)) : (a ?? b);
  }
  setStrokeColor(c: string | undefined | null) {
    this.st.stroke = paintOf(c);
  }
  setStrokeWidth(w: number) {
    this.st.sw = w;
  }
  setAlpha(a: number) {
    this.st.alpha = a;
  }
  setFillAlpha(a: number) {
    this.st.fillAlpha = a;
  }
  setStrokeAlpha(a: number) {
    this.st.strokeAlpha = a;
  }
  setDashed(on: boolean, fixDash?: boolean) {
    this.st.dashed = on;
    if (fixDash !== undefined) this.st.fixDash = fixDash;
  }
  setDashPattern(p: string) {
    this.st.dash = p;
  }
  setLineCap(c: string) {
    this.st.cap = c === 'round' ? 'round' : c === 'square' ? 'square' : 'butt';
  }
  setLineJoin(j: string) {
    this.st.join = j === 'round' ? 'round' : j === 'bevel' ? 'bevel' : 'miter';
  }
  setMiterLimit(m: number) {
    this.st.miter = m;
  }
  setFontColor(c: string) {
    this.st.fontColor = c;
  }
  setFontSize(s: number) {
    this.st.fontSize = s;
  }
  setFontStyle(s: number) {
    this.st.fontStyle = s;
  }
  setFontFamily(s: string) {
    this.st.fontFamily = s;
  }
  get fillColor() {
    return this.st.fill;
  }
  get strokeColor() {
    return this.st.stroke;
  }
  get strokeWidth() {
    return this.st.sw;
  }

  // ───── 経路 ─────
  private P = (x: number, y: number) => {
    const [a, b, c, d, e, f0] = this.st.m;
    return `${f(a * x + c * y + e)} ${f(b * x + d * y + f0)}`;
  };
  /** 回転・反転の無い写し方か (平行移動だけ) */
  private get plain() {
    const [a, b, c, d] = this.st.m;
    return a === 1 && b === 0 && c === 0 && d === 1;
  }
  /** 円弧の半径・傾き・向きを写す (回転は傾きに足し、反転は向きを逆にする。拡大は無い) */
  private A(rx: number, ry: number, rot: number, large: number | boolean, sweep: number | boolean, x: number, y: number) {
    const [a, b, c, d] = this.st.m;
    const det = a * d - b * c;
    const ang = rot + (Math.atan2(b, a) * 180) / Math.PI;
    const sw = det < 0 ? !sweep : !!sweep;
    return `A${f(Math.abs(rx) * Math.hypot(a, b))} ${f(Math.abs(ry) * Math.hypot(c, d))} ${f(ang)} ${large ? 1 : 0} ${sw ? 1 : 0} ${this.P(x, y)}`;
  }
  begin() {
    this.d = '';
    this.pm = '';
  }
  /** 書いた字の数を、字の数の残り (StencilContext.budget.chars) から引く。使い切ったら投げる */
  private spend(n: number) {
    const b = this.host.stencilCtx?.budget;
    if (b?.chars !== undefined && (b.chars -= n) < 0) throw new SvgBudgetExceeded();
  }
  /** 経路に命令を足す (置き換えを待っている移動があれば、先に足す) */
  private add(s: string) {
    if (this.pm) {
      this.spend(this.pm.length);
      this.d += this.pm;
      this.pm = '';
    }
    this.spend(s.length);
    this.d += s;
  }
  /** 要素を書く (extra: 字の数の勘定に入れない分。経路の d は足すときに数えた) */
  private put(el: string, extra = 0) {
    this.spend(el.length - extra);
    this.out.push(el);
  }
  moveTo(x: number, y: number) {
    // 移動だけで終わっている経路の、続く移動は置き換える (同じ図になる)。前の置き換えと同じく、移動の座標に英字 (NaN・1e+21 など) が
    // 入るときは置き換えない
    if (this.pm && /[A-Za-z]/.test(this.pm.slice(1))) this.d += this.pm;
    this.pm = `M${this.P(x, y)}`;
  }
  lineTo(x: number, y: number) {
    this.add(`L${this.P(x, y)}`);
  }
  quadTo(x1: number, y1: number, x2: number, y2: number) {
    this.add(`Q${this.P(x1, y1)} ${this.P(x2, y2)}`);
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.add(`C${this.P(x1, y1)} ${this.P(x2, y2)} ${this.P(x3, y3)}`);
  }
  arcTo(rx: number, ry: number, rot: number, large: number | boolean, sweep: number | boolean, x: number, y: number) {
    this.add(this.A(rx, ry, rot, large, sweep, x, y));
  }
  close() {
    this.add('Z');
  }
  /** 四角 (今の経路に足す。mxSvgCanvas2D の rect は新しい要素だが、塗るまでの経路として同じ) */
  rect(x: number, y: number, w: number, h: number) {
    this.add(`M${this.P(x, y)}L${this.P(x + w, y)}L${this.P(x + w, y + h)}L${this.P(x, y + h)}Z`);
  }
  /** 角を丸めた四角 (dx・dy は角の半径) */
  roundrect(x: number, y: number, w: number, h: number, dx: number, dy: number) {
    const rx = Math.max(0, Math.min(dx, w / 2));
    const ry = Math.max(0, Math.min(dy, h / 2));
    if (!rx || !ry) return this.rect(x, y, w, h);
    const A = (px: number, py: number) => this.A(rx, ry, 0, 0, 1, px, py);
    this.add(`M${this.P(x + rx, y)}L${this.P(x + w - rx, y)}${A(x + w, y + ry)}L${this.P(x + w, y + h - ry)}${A(x + w - rx, y + h)}L${this.P(x + rx, y + h)}${A(x, y + h - ry)}L${this.P(x, y + ry)}${A(x + rx, y)}Z`);
  }
  ellipse(x: number, y: number, w: number, h: number) {
    const rx = w / 2;
    const ry = h / 2;
    this.add(`M${this.P(x, y + ry)}${this.A(rx, ry, 0, 1, 1, x + w, y + ry)}${this.A(rx, ry, 0, 1, 1, x, y + ry)}Z`);
  }

  /**
   * 折れ線 (mxShape.addPoints)。rounded なら、角から arcSize だけ手前で曲げ始め、角を制御点にした 2 次の曲線で曲げる。
   * close なら閉じる (丸めるときは、最後と最初の点の中点から始める)
   */
  addPoints(points: Pt[], rounded: boolean, arcSize: number, close: boolean, exclude?: number[], initialMove = true) {
    if (!points.length) return;
    let pts = points;
    const pe = pts[pts.length - 1];
    if (close && rounded) {
      pts = pts.slice();
      const p0 = pts[0];
      pts.unshift({ x: pe.x + (p0.x - pe.x) / 2, y: pe.y + (p0.y - pe.y) / 2 });
    }
    let pt = pts[0];
    let i = 1;
    if (initialMove) this.moveTo(pt.x, pt.y);
    else this.lineTo(pt.x, pt.y);
    const n = pts.length;
    const at = (k: number) => pts[((k % n) + n) % n];
    while (i < (close ? n : n - 1)) {
      let tmp = at(i);
      let dx = pt.x - tmp.x;
      let dy = pt.y - tmp.y;
      if (rounded && (dx !== 0 || dy !== 0) && (!exclude || !exclude.includes(i - 1))) {
        let dist = Math.sqrt(dx * dx + dy * dy);
        const x1 = tmp.x + (dx * Math.min(arcSize, dist / 2)) / dist;
        const y1 = tmp.y + (dy * Math.min(arcSize, dist / 2)) / dist;
        this.lineTo(x1, y1);
        let next = at(i + 1);
        while (i < n - 2 && Math.round(next.x - tmp.x) === 0 && Math.round(next.y - tmp.y) === 0) {
          next = at(i + 2);
          i++;
        }
        dx = next.x - tmp.x;
        dy = next.y - tmp.y;
        dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const x2 = tmp.x + (dx * Math.min(arcSize, dist / 2)) / dist;
        const y2 = tmp.y + (dy * Math.min(arcSize, dist / 2)) / dist;
        this.quadTo(tmp.x, tmp.y, x2, y2);
        tmp = { x: x2, y: y2 };
      } else this.lineTo(tmp.x, tmp.y);
      pt = tmp;
      i++;
    }
    if (close) this.close();
    else this.lineTo(pe.x, pe.y);
  }

  /**
   * 直線と 2 次の曲線でできた閉じた経路 (draw.io の Shapes.js の addCurvedPath)。segs の各項は [x, y] (直線) か [cx, cy, x, y] (2 次の曲線)。
   * rounded なら、向きの変わる継ぎ目を arcSize の大きさで丸める (曲線の上の点は、2 次の曲線の極の形 getQuadPolar で求める)
   */
  addCurvedPath(x0: number, y0: number, segs: number[][], rounded: boolean, arcSize: number) {
    if (!rounded || !(arcSize > 0)) {
      this.moveTo(x0, y0);
      for (const s of segs) s.length === 2 ? this.lineTo(s[0], s[1]) : this.quadTo(s[0], s[1], s[2], s[3]);
      this.close();
      return;
    }
    const last = segs[segs.length - 1];
    if (last[last.length - 2] !== x0 || last[last.length - 1] !== y0) segs = [...segs, [x0, y0]];
    interface Q {
      p0: Pt;
      p1: Pt;
      c: Pt;
      line: boolean;
      corner: boolean;
      t0: number;
      t1: number;
    }
    const curves: Q[] = [];
    let p: Pt = { x: x0, y: y0 };
    for (const s of segs) {
      const pe = { x: s[s.length - 2], y: s[s.length - 1] };
      const line = s.length === 2;
      curves.push({ p0: p, p1: pe, line, corner: false, t0: 0, t1: 0, c: line ? { x: (p.x + pe.x) / 2, y: (p.y + pe.y) / 2 } : { x: s[0], y: s[1] } });
      p = pe;
    }
    const polar = (q: Q, u: number, v: number): Pt => {
      const a = (1 - u) * (1 - v);
      const b = u * (1 - v) + v * (1 - u);
      return { x: a * q.p0.x + b * q.c.x + u * v * q.p1.x, y: a * q.p0.y + b * q.c.y + u * v * q.p1.y };
    };
    for (let i = 0; i < curves.length; i++) {
      const q0 = curves[i];
      const q1 = curves[(i + 1) % curves.length];
      const dx0 = q0.p1.x - q0.c.x;
      const dy0 = q0.p1.y - q0.c.y;
      const dx1 = q1.c.x - q1.p0.x;
      const dy1 = q1.c.y - q1.p0.y;
      const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      if (Math.abs(dx0 * dy1 - dy0 * dx1) > 1e-6 * d0 * d1) {
        q0.corner = true;
        q0.t1 = Math.min(0.5, arcSize / Math.max(1, 2 * d0));
        q1.t0 = Math.min(0.5, arcSize / Math.max(1, 2 * d1));
      }
    }
    p = polar(curves[0], curves[0].t0, curves[0].t0);
    this.moveTo(p.x, p.y);
    for (let i = 0; i < curves.length; i++) {
      const q0 = curves[i];
      const t = 1 - q0.t1;
      const pe = polar(q0, t, t);
      if (q0.line) this.lineTo(pe.x, pe.y);
      else {
        const pc = polar(q0, q0.t0, t);
        this.quadTo(pc.x, pc.y, pe.x, pe.y);
      }
      if (q0.corner) {
        const q1 = curves[(i + 1) % curves.length];
        const pn = polar(q1, q1.t0, q1.t0);
        const c0 = polar(q0, t, 1);
        const c1 = polar(q1, 0, q1.t0);
        this.curveTo(pe.x + ((c0.x - pe.x) * 4) / 3, pe.y + ((c0.y - pe.y) * 4) / 3, pn.x + ((c1.x - pn.x) * 4) / 3, pn.y + ((c1.y - pn.y) * 4) / 3, pn.x, pn.y);
      }
    }
    this.close();
  }

  // ───── 塗る・線を引く ─────
  private emit(doFill: boolean, doStroke: boolean) {
    this.add('');
    if (!this.d) return;
    const st = this.st;
    const fill = doFill ? st.fill : undefined;
    const stroke = doStroke && st.sw > 0 ? st.stroke : undefined;
    if (fill || stroke) {
      const a = [`d="${this.d}"`, `fill="${esc(fill ?? 'none')}"`];
      const fa = st.alpha * st.fillAlpha;
      if (fill && fa < 1) a.push(`fill-opacity="${f(Math.max(0, fa))}"`);
      if (stroke) {
        a.push(`stroke="${esc(stroke)}"`, `stroke-width="${f(st.sw)}"`);
        const sa = st.alpha * st.strokeAlpha;
        if (sa < 1) a.push(`stroke-opacity="${f(Math.max(0, sa))}"`);
        if (st.cap !== 'butt') a.push(`stroke-linecap="${st.cap}"`);
        if (st.join !== 'miter') a.push(`stroke-linejoin="${st.join}"`);
        a.push(`stroke-miterlimit="${f(st.miter)}"`);
        if (st.dashed) {
          const k = st.fixDash ? 1 : st.sw;
          const pat = st.dash.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
          if (pat.some((n) => n > 0)) a.push(`stroke-dasharray="${pat.map((n) => f(n * k)).join(' ')}"`);
        }
      } else a.push('stroke="none"');
      this.put(`<path ${a.join(' ')}/>`, this.d.length);
    }
    this.d = '';
  }
  fill() {
    this.emit(true, false);
  }
  stroke() {
    this.emit(false, true);
  }
  fillAndStroke() {
    this.emit(true, true);
  }

  /** 文字 (枠 x, y, w, h の中に、揃えて置く。大きさ 0 の枠は点。基線は 1 行 1.2em の上から 0.95em の見積もり) */
  text(x: number, y: number, w: number, h: number, str: string, align = 'center', valign = 'middle') {
    if (!str) return;
    const lines = str.split('\n');
    const size = this.st.fontSize;
    const total = lines.length * 1.2 * size;
    const top = valign === 'top' ? y : valign === 'bottom' ? y + h - total : y + (h - total) / 2;
    const ax = align === 'left' ? x : align === 'right' ? x + w : x + w / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    lines.forEach((l, k) => {
      const a = [`x="${f(ax)}"`, `y="${f(top + k * 1.2 * size + 0.95 * size)}"`, `transform="matrix(${this.st.m.map(f).join(' ')})"`, `text-anchor="${anchor}"`, `font-size="${f(size)}"`, `font-family="${esc(this.st.fontFamily.split(',')[0].trim())}"`, `fill="${esc(this.st.fontColor)}"`];
      if (this.st.fontStyle & 1) a.push('font-weight="bold"');
      if (this.st.fontStyle & 2) a.push('font-style="italic"');
      if (this.st.alpha < 1) a.push(`opacity="${f(this.st.alpha)}"`);
      this.put(`<text ${a.join(' ')}>${esc(l)}</text>`);
    });
  }

  /** SVG の要素をそのまま置く (座標は今の座標系。写し方の要素で包む。曲げた文字の textPath など、道具の命令で書けないもの) */
  raw(svg: string) {
    const [a, b, c, d, e, f0] = this.st.m;
    this.put(a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f0 === 0 ? svg : `<g transform="matrix(${this.st.m.map(f).join(' ')})">${svg}</g>`);
  }

  /**
   * 画像を枠に置く (mxSvgCanvas2D.image。aspect の既定は true: 縦横の比を保って真ん中に置く)。今の不透明度を掛ける。
   * 置けなければ false
   */
  image(x: number, y: number, w: number, h: number, src: string, aspect = true): boolean {
    const svg = this.host.image?.(src, { x, y, w, h }, aspect);
    if (svg === undefined) return false;
    this.raw(this.st.alpha < 1 ? `<g opacity="${f(this.st.alpha)}">${svg}</g>` : svg);
    return true;
  }

  /** 図形ライブラリの形を、今の色・線の状態のまま、枠に描く (mxStencil.drawShape)。形が無ければ false */
  stencil(name: string | XEl, x: number, y: number, w: number, h: number): boolean {
    const shape = typeof name === 'string' ? this.host.stencil(name) : name;
    if (!shape) return false;
    const st = this.st;
    const svg =
      stencilSvg(
        shape,
        this.plain ? { x: x + st.m[4], y: y + st.m[5], w, h } : { x, y, w, h },
        {
          fill: st.fill,
          stroke: st.stroke,
          strokeWidth: st.sw,
          dashed: st.dashed,
          dashPattern: st.dash,
          fixDash: st.fixDash,
          fillOpacity: st.alpha * st.fillAlpha,
          strokeOpacity: st.alpha * st.strokeAlpha,
          style: this.host.style,
        },
        this.host.stencilCtx,
      );
    // 回す・反転するときは、形を写し方の要素で包む (形の字の数は stencilSvg が数えた)
    this.put(this.plain ? svg : `<g transform="matrix(${st.m.map(f).join(' ')})">${svg}</g>`, svg.length);
    return true;
  }
}
