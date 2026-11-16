/**
 * drawioTapered — draw.io の線の形 shape=taperedArrow (先細りの矢印) を、drawioCanvas.ts の道具で描く。
 * 線の中心線に沿って、始まりの幅 startWidth から終わりの幅 endWidth へ (長さに比べて) 直線的に細る帯を作り、
 * 塗りの色で塗って線の色で縁を引く。矢の頭は、帯の幅に合わせて大きくし、
 * classic・block (と細い形) は帯の輪郭の一部として、diamond・doubleBlock・box などは帯と同じ経路に足して、帯と 1 回で塗る。
 * それ以外の矢の頭は、帯を塗ったあとに、帯の塗りの色 (startFillColor・endFillColor で変えられる) で別に描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の Shapes.js の TaperedArrowShape (paintEdgeShape・paintLine・paintCurvedLine・
 * paintBezierLine・getRoundedPoints・paintTaperedLine・createMarker・removeLoops・isMergedMarker と既定の値)、
 * Graph.js の Graph.getCurvePoints、mxGraph の mxPolyline.paintEdgeShape・mxUtils.intersection・mxConstants (DEFAULT_MARKERSIZE・LINE_ARCSIZE)。
 * 矢の頭の形 (mxMarker.createMarker) は drawioEdges.ts の edgeMarker を使う
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Graph.js: Copyright (c) 2006-2012, JGraph Holdings Ltd
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxMarker.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxPolyline.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import type { Pt, ShapeCanvas } from './drawioCanvas';
import { edgeMarker } from './drawioEdges';

/**
 * taperedArrow の値 (呼ぶ側が style から読んで渡す)。省いた項目は、ソースの既定の値になる
 */
export interface TaperedArrowOptions {
  /** 始まりの帯の幅 (style の startWidth。既定 12 = defaultStartWidth。負は 0) */
  startWidth?: number;
  /** 終わりの帯の幅 (style の endWidth。既定 2 = defaultEndWidth。負は 0) */
  endWidth?: number;
  /** 始まり・終わりの矢の頭の形 (style の startArrow・endArrow。既定は無し) */
  startArrow?: string;
  endArrow?: string;
  /** 矢の頭の大きさ (style の startSize・endSize。既定 6 = mxConstants.DEFAULT_MARKERSIZE)。帯の幅の分を足して描く */
  startSize?: number;
  endSize?: number;
  /** 矢の頭を塗るか (style の startFill・endFill が 0 でない。既定 true) */
  startFill?: boolean;
  endFill?: boolean;
  /** 矢の頭の塗りの色 (style の startFillColor・endFillColor。既定は無し。書くと、帯と別に、この色で描く) */
  startFillColor?: string;
  endFillColor?: string;
  /** 折れ点を丸める (style の rounded が 1) */
  rounded?: boolean;
  /** 丸めの大きさ (style の arcSize。既定 20 = mxConstants.LINE_ARCSIZE。半分を使う) */
  arcSize?: number;
  /** 曲線 (style の curved が 1) */
  curved?: boolean;
  /** 3 次の曲線 (style の bezier が 1。curved より先に見る) */
  bezier?: boolean;
  /** 線の太さ (style の strokeWidth。既定 1) */
  strokeWidth?: number;
  /** 塗りの色 (style の fillColor = mxShape.fill)。別に描く矢の頭の塗りの既定 */
  fill?: string;
  /** 線の色 (style の strokeColor = mxShape.stroke)。ER・SysML の印が使う */
  stroke?: string;
}

/** 線の囲みを広げる量 (TaperedArrowShape.augmentBoundingBox: 帯と、幅に合わせた矢の頭の分) */
export function taperedArrowGrow(o: TaperedArrowOptions): number {
  return Math.max(Math.max(0, o.startWidth ?? 12), Math.max(0, o.endWidth ?? 2));
}

/** 曲線を折れ線の点に分ける (Graph.getCurvePoints。1 つの曲線を Graph.curvePointSteps = 16 に分ける) */
function getCurvePoints(pts: Pt[], bezier: boolean): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const steps = 16;
  const result: Pt[] = [pts[0]];
  const quad = (p0: Pt, pc: Pt, p1: Pt) => {
    for (let t = 1; t <= steps; t++) {
      const u = t / steps;
      const iu = 1 - u;
      result.push({ x: iu * iu * p0.x + 2 * iu * u * pc.x + u * u * p1.x, y: iu * iu * p0.y + 2 * iu * u * pc.y + u * u * p1.y });
    }
  };
  if (bezier && (n - 1) % 3 === 0) {
    // 点は 3 次の曲線の制御点 [端, 制御, 制御, 端, …]
    for (let i = 1; i + 2 < n; i += 3) {
      const p0 = pts[i - 1];
      const c1 = pts[i];
      const c2 = pts[i + 1];
      const p1 = pts[i + 2];
      for (let t = 1; t <= steps; t++) {
        const u = t / steps;
        const iu = 1 - u;
        result.push({
          x: iu * iu * iu * p0.x + 3 * iu * iu * u * c1.x + 3 * iu * u * u * c2.x + u * u * u * p1.x,
          y: iu * iu * iu * p0.y + 3 * iu * iu * u * c1.y + 3 * iu * u * u * c2.y + u * u * u * p1.y,
        });
      }
    }
  } else {
    // 続く制御点の中点を通る 2 次の曲線 (mxPolyline.paintCurvedLine と同じ)
    let prev = pts[0];
    for (let i = 1; i < n - 2; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      quad(prev, pts[i], mid);
      prev = mid;
    }
    quad(prev, pts[n - 2], pts[n - 1]);
  }
  return result;
}

/** 丸めた角を細かい折れ線にする (TaperedArrowShape.getRoundedPoints: mxShape.addPoints の丸めと同じ、角を制御点にした 2 次の曲線を 8 に分ける) */
function getRoundedPoints(pts: Pt[], arcSize: number): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const steps = 8;
  const result: Pt[] = [pts[0]];
  let pt = pts[0];
  for (let i = 1; i < n - 1; i++) {
    const tmp = pts[i];
    let dx = pt.x - tmp.x;
    let dy = pt.y - tmp.y;
    if (dx === 0 && dy === 0) continue;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const p1 = { x: tmp.x + (dx * Math.min(arcSize, dist / 2)) / dist, y: tmp.y + (dy * Math.min(arcSize, dist / 2)) / dist };
    result.push(p1);
    // 重ならない次の点を使う
    let next = pts[i + 1];
    while (i < n - 2 && Math.round(next.x - tmp.x) === 0 && Math.round(next.y - tmp.y) === 0) {
      next = pts[i + 2];
      i++;
    }
    dx = next.x - tmp.x;
    dy = next.y - tmp.y;
    dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const p2 = { x: tmp.x + (dx * Math.min(arcSize, dist / 2)) / dist, y: tmp.y + (dy * Math.min(arcSize, dist / 2)) / dist };
    for (let t = 1; t <= steps; t++) {
      const u = t / steps;
      const iu = 1 - u;
      result.push({ x: iu * iu * p1.x + 2 * iu * u * tmp.x + u * u * p2.x, y: iu * iu * p1.y + 2 * iu * u * tmp.y + u * u * p2.y });
    }
    pt = p2;
  }
  result.push(pts[n - 1]);
  return result;
}

/** 2 本の線分の交わる点 (mxUtils.intersection。交わらなければ undefined) */
function intersection(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Pt | undefined {
  const denom = (y3 - y2) * (x1 - x0) - (x3 - x2) * (y1 - y0);
  const ua = ((x3 - x2) * (y0 - y2) - (y3 - y2) * (x0 - x2)) / denom;
  const ub = ((x1 - x0) * (y0 - y2) - (y1 - y0) * (x0 - x2)) / denom;
  const eps = 0.000001;
  if (ua >= -eps && ua <= 1 + eps && ub >= -eps && ub <= 1 + eps) return { x: x0 + ua * (x1 - x0), y: y0 + ua * (y1 - y0) };
  return undefined;
}

/** 切る輪の点の数の上限 (TaperedArrowShape.maxLoopPoints) */
const MAX_LOOP_POINTS = 1000;

/**
 * ずらした折れ線の小さな輪を、自分と交わる点で切って除く (TaperedArrowShape.removeLoops)。
 * 交わる 2 か所の中心線に沿った隔たり (lengths の差) が span 以下のものだけを切り、線そのものの交差は残す
 */
function removeLoops(pts: Pt[], lengths: number[], span: number): Pt[] {
  const n = pts.length;
  let cur = pts[0];
  const result = [cur];
  let i = 0;
  while (i < n - 1) {
    let ip: Pt | undefined;
    let j = i + 2;
    while (j < n - 1 && j < i + 2 + MAX_LOOP_POINTS && lengths[j] - lengths[i + 1] <= span) j++;
    // 最後の交わる点を使って、入れ子の輪も除く
    for (j--; j >= i + 2 && !ip; j--) ip = intersection(cur.x, cur.y, pts[i + 1].x, pts[i + 1].y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y);
    if (ip) {
      cur = ip;
      i = j + 1;
    } else {
      cur = pts[i + 1];
      i++;
    }
    result.push(cur);
  }
  return result;
}

/** 輪郭の一部として描く矢の頭と、その幅の割合 (TaperedArrowShape.outlineHeads。mxMarker.createArrow の widthFactor) */
const OUTLINE_HEADS: Record<string, number> = { classic: 2, block: 2, classicThin: 3, blockThin: 3 };

/** 帯と同じ経路に足して塗る矢の頭 (TaperedArrowShape.mergedMarkers) */
const MERGED_MARKERS = ['classic', 'classicThin', 'block', 'blockThin', 'diamond', 'diamondThin', 'doubleBlock', 'box'];

/** 輪郭の一部の矢の頭の 3 つの角 (cl: 帯の左側の角、tip: 先、cr: 右側の角) */
interface Head {
  cl: Pt;
  tip: Pt;
  cr: Pt;
}

/**
 * 先細りの矢印を描く (TaperedArrowShape.paintEdgeShape)。pts は線の点 (絶対の座標)。
 * 帯は、今の塗り (グラデーションを含む)・線の状態のまま塗って縁を引く
 */
export function paintTaperedArrow(c: ShapeCanvas, points: Pt[], o: TaperedArrowOptions): void {
  // 端の点を矢の頭の分だけ縮めて書き換えるので、写しを使う (mxShape.paint も点を写してから描く)
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const sw = o.strokeWidth ?? 1;
  const startWidth = Math.max(0, o.startWidth ?? 12);
  const endWidth = Math.max(0, o.endWidth ?? 2);
  const arrowOf = (source: boolean) => (source ? o.startArrow : o.endArrow);
  const fillOf = (source: boolean) => (source ? o.startFill : o.endFill) ?? true;
  const fillColorOf = (source: boolean) => (source ? o.startFillColor : o.endFillColor);
  // 帯と同じ経路に足す矢の頭か (TaperedArrowShape.isMergedMarker: 形が mergedMarkers にあり、塗り、塗りの色を書いていない)
  const isMerged = (source: boolean) => {
    const t = arrowOf(source);
    return t !== undefined && MERGED_MARKERS.includes(t) && fillOf(source) && fillColorOf(source) == null;
  };
  const heads: [Head | undefined, Head | undefined] = [undefined, undefined];

  // 矢の頭 (TaperedArrowShape.createMarker): 帯の端の幅に合わせて大きくする。輪郭の一部の頭は heads に置き、描く関数は返さない
  const createMarker = (source: boolean): (() => void) | undefined => {
    const n = pts.length;
    const type = arrowOf(source);
    const p0 = source ? pts[1] : pts[n - 2];
    const pe = source ? pts[0] : pts[n - 1];
    if (type == null || !p0 || !pe) return undefined;
    const dx = pe.x - p0.x;
    const dy = pe.y - p0.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist > 0)) return undefined;
    const ux = dx / dist;
    const uy = dy / dist;
    const w = source ? startWidth : endWidth;
    const wf = isMerged(source) ? OUTLINE_HEADS[type] : undefined;
    let size = (source ? o.startSize : o.endSize) ?? 6;
    if (wf !== undefined) {
      // mxMarker.createArrow と同じ形で、頭の半分の幅を帯の半分の幅より大きくする
      size += (w * wf) / 2;
      const endOffsetX = ux * sw * 1.118;
      const endOffsetY = uy * sw * 1.118;
      const unitX = ux * (size + sw);
      const unitY = uy * (size + sw);
      const tip = { x: pe.x - endOffsetX, y: pe.y - endOffsetY };
      const f = type === 'classic' || type === 'classicThin' ? 3 / 4 : 1;
      pe.x += -unitX * f - endOffsetX;
      pe.y += -unitY * f - endOffsetY;
      const c1 = { x: tip.x - unitX - unitY / wf, y: tip.y - unitY + unitX / wf };
      const c2 = { x: tip.x + unitY / wf - unitX, y: tip.y - unitY - unitX / wf };
      // 帯の左側・右側の角 (始まりでは帯の向きが逆)
      heads[source ? 0 : 1] = source ? { cl: c2, tip, cr: c1 } : { cl: c1, tip, cr: c2 };
      return undefined;
    }
    return edgeMarker(c, type, pe, ux, uy, size + w, source, sw, fillOf(source), o.stroke, o.fill);
  };

  const sourceMarker = createMarker(true);
  const targetMarker = createMarker(false);
  const merged: Array<{ paint: () => void; source: boolean }> = [];
  const separate: Array<{ paint: () => void; source: boolean }> = [];
  if (sourceMarker) (isMerged(true) ? merged : separate).push({ paint: sourceMarker, source: true });
  if (targetMarker) (isMerged(false) ? merged : separate).push({ paint: targetMarker, source: false });

  // 帯 (TaperedArrowShape.paintTaperedLine): 今の経路に足す。塗るのは、矢の頭を足してから
  let bandPainted = false;
  const paintTaperedLine = (line: Pt[]) => {
    // 重なる点を除く
    const p: Pt[] = [];
    for (const q of line) if (q && (p.length === 0 || q.x !== p[p.length - 1].x || q.y !== p[p.length - 1].y)) p.push(q);
    if (p.length < 2) return;
    // 区間の法線と、始まりからの長さ
    const normals: Pt[] = [];
    const lengths = [0];
    for (let i = 1; i < p.length; i++) {
      const dx = p[i].x - p[i - 1].x;
      const dy = p[i].y - p[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      normals.push({ x: -dy / dist, y: dx / dist });
      lengths.push(lengths[i - 1] + dist);
    }
    const total = lengths[lengths.length - 1];
    let left: Pt[] = [];
    let right: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const w = (startWidth + ((endWidth - startWidth) * lengths[i]) / total) / 2;
      const n0 = normals[Math.max(0, i - 1)];
      const n1 = normals[Math.min(normals.length - 1, i)];
      let nx = n0.x + n1.x;
      let ny = n0.y + n1.y;
      const nl = Math.sqrt(nx * nx + ny * ny);
      // 角で突き出す量 (マイター) は、鋭い角では幅の 2 倍までにする
      const cos = nl === 0 ? 0 : nl / 2;
      const f = w / Math.max(0.5, cos);
      nx = nl === 0 ? n1.x : nx / nl;
      ny = nl === 0 ? n1.y : ny / nl;
      left.push({ x: p[i].x + nx * f, y: p[i].y + ny * f });
      right.push({ x: p[i].x - nx * f, y: p[i].y - ny * f });
    }
    // 半分の幅より小さい半径の角・曲線の内側は、折り返して輪になる
    const span = 2 * Math.max(startWidth, endWidth);
    left = removeLoops(left, lengths, span);
    right = removeLoops(right, lengths, span);
    c.begin();
    c.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) c.lineTo(left[i].x, left[i].y);
    // 輪郭の一部の頭は、左右の辺の間に足す
    const [startHead, endHead] = heads;
    if (endHead) {
      c.lineTo(endHead.cl.x, endHead.cl.y);
      c.lineTo(endHead.tip.x, endHead.tip.y);
      c.lineTo(endHead.cr.x, endHead.cr.y);
    }
    for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
    if (startHead) {
      c.lineTo(startHead.cr.x, startHead.cr.y);
      c.lineTo(startHead.tip.x, startHead.tip.y);
      c.lineTo(startHead.cl.x, startHead.cl.y);
    }
    c.close();
    bandPainted = true;
  };

  // mxPolyline.paintEdgeShape: bezier → paintBezierLine、curved → paintCurvedLine、ほかは paintLine (丸めは arcSize の半分)
  if (o.bezier) paintTaperedLine(getCurvePoints(pts, true));
  else if (o.curved) paintTaperedLine(getCurvePoints(pts, false));
  else paintTaperedLine(o.rounded ? getRoundedPoints(pts, (o.arcSize ?? 20) / 2) : pts);

  if (merged.length > 0) {
    if (!bandPainted) {
      c.begin();
      bandPainted = true;
    }
    // 矢の頭の経路を、今の経路に集める (ソースと同じく、描く間 begin・fill・stroke・fillAndStroke を何もしない命令に差し替える)
    const keep = { begin: c.begin, fill: c.fill, stroke: c.stroke, fillAndStroke: c.fillAndStroke };
    const nop = () => {};
    Object.assign(c, { begin: nop, fill: nop, stroke: nop, fillAndStroke: nop });
    try {
      for (const m of merged) m.paint();
    } finally {
      Object.assign(c, keep);
    }
  }
  if (bandPainted) c.fillAndStroke();

  // ほかの矢の頭は、帯の塗りの色 (グラデーションは無し) で描く
  if (separate.length > 0) {
    c.setShadow(false);
    c.setDashed(false);
    for (const s of separate) {
      c.setFillColor(fillColorOf(s.source) ?? o.fill);
      s.paint();
    }
  }
}
