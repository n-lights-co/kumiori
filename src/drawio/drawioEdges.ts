/**
 * drawioEdges — draw.io の線の形 (shape=flexArrow・link・arrow) を、drawioCanvas.ts の道具で描く。
 * 根拠: mxGraph の公開のソース (Apache License 2.0) の mxArrowConnector.paintEdgeShape・paintMarker・getCurvePoints・
 * trimCurveForMarker、mxArrow.paintEdgeShape、mxUtils.relativeCcw と、draw.io の Shapes.js の FlexArrowShape・LinkShape の既定の値。
 * 線を 2 回引く形 (wire・pipe・filledEdge) は drawio.ts の drawEdge で描く
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Graph.js: Copyright (c) 2006-2012, JGraph Holdings Ltd
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxArrow.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxArrowConnector.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxConnector.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxMarker.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraphView.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/er/mxER.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mxSysML.js: Copyright (c) 2006-2014, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { Pt, ShapeCanvas } from './drawioCanvas';

/** 点 (px, py) が、線 (x1, y1)→(x2, y2) のどちら側にあるか (mxUtils.relativeCcw: -1・0・1) */
function relativeCcw(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
  x2 -= x1;
  y2 -= y1;
  px -= x1;
  py -= y1;
  let ccw = px * y2 - py * x2;
  if (ccw === 0) {
    ccw = px * x2 + py * y2;
    if (ccw > 0) {
      px -= x2;
      py -= y2;
      ccw = px * x2 + py * y2;
      if (ccw < 0) ccw = 0;
    }
  }
  return ccw < 0 ? -1 : ccw > 0 ? 1 : 0;
}

export interface ArrowConnectorOptions {
  /** 軸の太さ (getEdgeWidth) */
  edgeWidth: number;
  /** 始まり・終わりの矢の頭の幅 (getStartArrowWidth・getEndArrowWidth) */
  startWidth: number;
  endWidth: number;
  /** 矢の頭の長さ (style の startSize・endSize の 3 倍。既定は ARROW_SIZE / 5 の 3 倍) */
  startSize: number;
  endSize: number;
  markerStart: boolean;
  markerEnd: boolean;
  /** 両端を閉じない (link: 2 本の平行な線) */
  openEnded: boolean;
  rounded: boolean;
  curved: boolean;
  strokeWidth: number;
}

/** 曲線の線を、折れ線の点に分ける (mxArrowConnector.getCurvePoints。2 次の曲線を 4〜64 に分ける) */
function curvePoints(pts: Pt[]): Pt[] {
  const out = [pts[0]];
  const n = pts.length;
  let p0 = pts[0];
  for (let i = 1; i < n - 1; i++) {
    const pc = pts[i];
    const pe = i < n - 2 ? { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 } : pts[i + 1];
    const len = Math.hypot(pc.x - p0.x, pc.y - p0.y) + Math.hypot(pe.x - pc.x, pe.y - pc.y);
    const steps = Math.max(4, Math.min(Math.ceil(len / 8), 64));
    for (let j = 1; j <= steps; j++) {
      const u = j / steps;
      const iu = 1 - u;
      out.push({ x: iu * iu * p0.x + 2 * iu * u * pc.x + u * u * pe.x, y: iu * iu * p0.y + 2 * iu * u * pc.y + u * u * pe.y });
    }
    p0 = pe;
  }
  return out;
}

/** 曲線の端を、矢の頭の分 (端から dist の円) だけ切る (mxArrowConnector.trimCurveForMarker) */
function trimCurve(pts: Pt[], dist: number, source: boolean): Pt[] {
  const n = pts.length;
  const pc = source ? pts[0] : pts[n - 1];
  const cut = (p0: Pt, p1: Pt): Pt => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const fx = p0.x - pc.x;
    const fy = p0.y - pc.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - dist * dist;
    const disc = b * b - 4 * a * c;
    if (a === 0 || disc < 0) return p0;
    const t = Math.max(0, Math.min(1, (-b - Math.sqrt(disc)) / (2 * a)));
    return { x: p0.x + t * dx, y: p0.y + t * dy };
  };
  if (source) {
    for (let i = 1; i < n - 1; i++) if ((pts[i].x - pc.x) ** 2 + (pts[i].y - pc.y) ** 2 >= dist * dist) return [pc, cut(pts[i], pts[i - 1]), ...pts.slice(i)];
  } else {
    for (let i = n - 2; i > 0; i--) if ((pts[i].x - pc.x) ** 2 + (pts[i].y - pc.y) ** 2 >= dist * dist) return [...pts.slice(0, i + 1), cut(pts[i], pts[i + 1]), pc];
  }
  return pts;
}

/** 矢の頭 (mxArrowConnector.paintMarker) */
function marker(c: ShapeCanvas, x: number, y: number, nx: number, ny: number, size: number, arrowWidth: number, edgeWidth: number, spacing: number, initialMove: boolean) {
  const ratio = edgeWidth / arrowWidth;
  const ox = (edgeWidth * ny) / 2;
  const oy = (-edgeWidth * nx) / 2;
  const sx = (spacing + size) * nx;
  const sy = (spacing + size) * ny;
  if (initialMove) c.moveTo(x - ox + sx, y - oy + sy);
  else c.lineTo(x - ox + sx, y - oy + sy);
  c.lineTo(x - ox / ratio + sx, y - oy / ratio + sy);
  c.lineTo(x + spacing * nx, y + spacing * ny);
  c.lineTo(x + ox / ratio + sx, y + oy / ratio + sy);
  c.lineTo(x + ox + sx, y + oy + sy);
}

/** 太い矢印の線 (flexArrow・link。mxArrowConnector.paintEdgeShape): 軸の輪郭を折れ点ごとに外・内へずらして作り、両端に矢の頭を付けて塗る */
export function paintArrowConnector(c: ShapeCanvas, points: Pt[], o: ArrowConnectorOptions) {
  const curved = o.curved && points.length > 2;
  let pts = curved ? curvePoints(points) : points;
  const startWidth = o.startWidth + o.strokeWidth;
  const endWidth = o.endWidth + o.strokeWidth;
  const edgeWidth = o.edgeWidth;
  const spacing = o.openEnded ? 0 : o.strokeWidth / 2;
  const startSize = o.startSize + o.strokeWidth;
  const endSize = o.endSize + o.strokeWidth;
  const rounded = !curved && o.rounded;
  if (curved && !o.openEnded) {
    if (o.markerStart) pts = trimCurve(pts, spacing + startSize, true);
    if (o.markerEnd) pts = trimCurve(pts, spacing + endSize, false);
  }
  if (pts.length < 2) return;
  const pe = pts[pts.length - 1];
  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  if (dist === 0) return;
  let nx = (pts[1].x - pts[0].x) / dist;
  let ny = (pts[1].y - pts[0].y) / dist;
  let nx1 = nx;
  let ny1 = ny;
  let orthx = edgeWidth * ny;
  let orthy = -edgeWidth * nx;
  const fns: Array<() => void> = [];
  if (rounded) c.setLineJoin('round');
  else if (pts.length > 2) c.setMiterLimit(1.42);
  c.begin();
  const startNx = nx;
  const startNy = ny;
  if (o.markerStart && !o.openEnded) marker(c, pts[0].x, pts[0].y, nx, ny, startSize, startWidth, edgeWidth, spacing, true);
  else {
    const outX = pts[0].x + orthx / 2 + spacing * nx;
    const outY = pts[0].y + orthy / 2 + spacing * ny;
    const inX = pts[0].x - orthx / 2 + spacing * nx;
    const inY = pts[0].y - orthy / 2 + spacing * ny;
    if (o.openEnded) {
      c.moveTo(outX, outY);
      fns.push(() => c.lineTo(inX, inY));
    } else {
      c.moveTo(inX, inY);
      c.lineTo(outX, outY);
    }
  }
  for (let i = 0; i < pts.length - 2; i++) {
    const pos = relativeCcw(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pts[i + 2].x, pts[i + 2].y);
    const dx1 = pts[i + 2].x - pts[i + 1].x;
    const dy1 = pts[i + 2].y - pts[i + 1].y;
    const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    if (dist1 === 0) continue;
    nx1 = dx1 / dist1;
    ny1 = dy1 / dist1;
    const tmp = Math.max(Math.sqrt((nx * nx1 + ny * ny1 + 1) / 2), 0.04);
    let nx2 = nx + nx1;
    let ny2 = ny + ny1;
    const dist2 = Math.sqrt(nx2 * nx2 + ny2 * ny2);
    if (dist2 === 0) continue;
    nx2 /= dist2;
    ny2 /= dist2;
    const swf = Math.max(tmp, Math.min(o.strokeWidth / 200 + 0.04, 0.35));
    const af = pos !== 0 && rounded ? Math.max(0.1, swf) : Math.max(tmp, 0.06);
    const outX = pts[i + 1].x + (ny2 * edgeWidth) / 2 / af;
    const outY = pts[i + 1].y - (nx2 * edgeWidth) / 2 / af;
    const inX = pts[i + 1].x - (ny2 * edgeWidth) / 2 / af;
    const inY = pts[i + 1].y + (nx2 * edgeWidth) / 2 / af;
    if (pos === 0 || !rounded) {
      c.lineTo(outX, outY);
      fns.push(() => c.lineTo(inX, inY));
    } else if (pos === -1) {
      const c1x = inX + ny * edgeWidth;
      const c1y = inY - nx * edgeWidth;
      const c2x = inX + ny1 * edgeWidth;
      const c2y = inY - nx1 * edgeWidth;
      c.lineTo(c1x, c1y);
      c.quadTo(outX, outY, c2x, c2y);
      fns.push(() => c.lineTo(inX, inY));
    } else {
      c.lineTo(outX, outY);
      const c1x = outX - ny * edgeWidth;
      const c1y = outY + nx * edgeWidth;
      const c2x = outX - ny1 * edgeWidth;
      const c2y = outY + nx1 * edgeWidth;
      fns.push(() => c.quadTo(inX, inY, c1x, c1y));
      fns.push(() => c.lineTo(c2x, c2y));
    }
    nx = nx1;
    ny = ny1;
  }
  orthx = edgeWidth * ny1;
  orthy = -edgeWidth * nx1;
  if (o.markerEnd && !o.openEnded) marker(c, pe.x, pe.y, -nx, -ny, endSize, endWidth, edgeWidth, spacing, false);
  else {
    c.lineTo(pe.x - spacing * nx1 + orthx / 2, pe.y - spacing * ny1 + orthy / 2);
    const inX = pe.x - spacing * nx1 - orthx / 2;
    const inY = pe.y - spacing * ny1 - orthy / 2;
    if (!o.openEnded) c.lineTo(inX, inY);
    else {
      c.moveTo(inX, inY);
      fns.unshift(() => c.moveTo(inX, inY));
    }
  }
  for (let i = fns.length - 1; i >= 0; i--) fns[i]();
  if (o.openEnded) c.stroke();
  else {
    c.close();
    c.fillAndStroke();
  }
  c.setMiterLimit(4);
  if (rounded) c.setLineJoin('miter');
  // 折れのある線は、矢の頭の付け根の線を引き直す (継ぎ目の角で欠けないように)
  if (pts.length > 2) {
    if (o.markerStart && !o.openEnded) {
      c.begin();
      marker(c, pts[0].x, pts[0].y, startNx, startNy, startSize, startWidth, edgeWidth, spacing, true);
      c.stroke();
    }
    if (o.markerEnd && !o.openEnded) {
      c.begin();
      marker(c, pe.x, pe.y, -nx, -ny, endSize, endWidth, edgeWidth, spacing, true);
      c.stroke();
    }
  }
}

/** 古い形の太い矢印 (shape=arrow。mxArrow.paintEdgeShape): 始まりと終わりを結ぶ、幅 30 の軸と長さ 30 の頭 (mxConstants.ARROW_WIDTH・ARROW_SIZE) */
export function paintArrow(c: ShapeCanvas, pts: Pt[]) {
  const width = 30;
  const arrow = 30;
  const p0 = pts[0];
  const pe = pts[pts.length - 1];
  const dist = Math.hypot(pe.x - p0.x, pe.y - p0.y);
  if (dist === 0) return;
  const length = dist - arrow;
  const nx = (pe.x - p0.x) / dist;
  const ny = (pe.y - p0.y) / dist;
  const floorx = (width * ny) / 3;
  const floory = (-width * nx) / 3;
  const p0x = p0.x - floorx / 2;
  const p0y = p0.y - floory / 2;
  const p1x = p0x + floorx;
  const p1y = p0y + floory;
  const p2x = p1x + length * nx;
  const p2y = p1y + length * ny;
  const p3x = p2x + floorx;
  const p3y = p2y + floory;
  const p5x = p3x - 3 * floorx;
  const p5y = p3y - 3 * floory;
  c.begin();
  c.moveTo(p0x, p0y);
  c.lineTo(p1x, p1y);
  c.lineTo(p2x, p2y);
  c.lineTo(p3x, p3y);
  c.lineTo(pe.x, pe.y);
  c.lineTo(p5x, p5y);
  c.lineTo(p5x + floorx, p5y + floory);
  c.close();
  c.fillAndStroke();
}

// ───────────── 線の端の形 ─────────────

/**
 * 線の端の形を描く (mxMarker の形。根拠: mxGraph の mxMarker.js (classic・block と細い形・open・oval・baseDash・doubleBlock・diamond・
 * manyOptional)、draw.io の Shapes.js (dash・box・cross・circle・circlePlus・halfCircle・async・openAsync・mermaidExtension・mermaidDiamond)、
 * shapes/er/mxER.js (ER の 6 つ)、shapes/mxSysML.js (sysML の 6 つ))。
 * pe: 線の端 (形によっては、線を縮めた端に書き換える)。unitX・unitY: 線の向き (端へ向かう単位ベクトル)。size: startSize・endSize (既定 6)。
 * source: 始まりの端か。sw: 線の太さ。filled: startFill・endFill が 0 でない。strokeColor: 線の色 (塗る形の色に使う)。fillColor: 線のスタイルの塗りの色。
 * 描き方の関数を返す (知らない形は undefined)
 */
export function edgeMarker(c: ShapeCanvas, type: string, pe: Pt, unitX: number, unitY: number, size: number, source: boolean, sw: number, filled: boolean, strokeColor: string | undefined, fillColor: string | undefined): (() => void) | undefined {
  const paint = (fillIt: boolean) => (fillIt ? c.fillAndStroke() : c.stroke());
  // classic・block (と細い形): 三角形 (classic は根元をえぐる)。線は頭の 3/4 (classic)・全部だけ縮める
  const arrow = (widthFactor: number) => {
    const ex = unitX * sw * 1.118;
    const ey = unitY * sw * 1.118;
    const ux = unitX * (size + sw);
    const uy = unitY * (size + sw);
    const pt = { x: pe.x - ex, y: pe.y - ey };
    const classic = type === 'classic' || type === 'classicThin';
    const k = classic ? 3 / 4 : 1;
    pe.x += -ux * k - ex;
    pe.y += -uy * k - ey;
    return () => {
      c.begin();
      c.moveTo(pt.x, pt.y);
      c.lineTo(pt.x - ux - uy / widthFactor, pt.y - uy + ux / widthFactor);
      if (classic) c.lineTo(pt.x - (ux * 3) / 4, pt.y - (uy * 3) / 4);
      c.lineTo(pt.x + uy / widthFactor - ux, pt.y - uy - ux / widthFactor);
      c.close();
      paint(filled);
    };
  };
  const nx = unitX * (size + sw + 1);
  const ny = unitY * (size + sw + 1);
  switch (type) {
    case 'classic':
    case 'block':
      return arrow(2);
    case 'classicThin':
    case 'blockThin':
      return arrow(3);
    case 'open':
    case 'openThin': {
      const wf = type === 'open' ? 2 : 3;
      const ex = unitX * sw * 1.118;
      const ey = unitY * sw * 1.118;
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { x: pe.x - ex, y: pe.y - ey };
      pe.x += -ex * 2;
      pe.y += -ey * 2;
      return () => {
        c.begin();
        c.moveTo(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
        c.lineTo(pt.x, pt.y);
        c.lineTo(pt.x + uy / wf - ux, pt.y - uy - ux / wf);
        c.stroke();
      };
    }
    case 'oval': {
      // 線の端を中心にした円。線は半径だけ縮める
      const a = size / 2;
      const pt = { ...pe };
      pe.x -= unitX * a;
      pe.y -= unitY * a;
      return () => {
        c.begin();
        c.ellipse(pt.x - a, pt.y - a, size, size);
        paint(filled);
      };
    }
    case 'baseDash': {
      const p = { ...pe };
      return () => {
        c.begin();
        c.moveTo(p.x - ny / 2, p.y + nx / 2);
        c.lineTo(p.x + ny / 2, p.y - nx / 2);
        c.stroke();
      };
    }
    case 'doubleBlock': {
      const ex = unitX * sw * 1.118;
      const ey = unitY * sw * 1.118;
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { x: pe.x - ex, y: pe.y - ey };
      pe.x += -ux * 2 - ex;
      pe.y += -uy * 2 - ey;
      return () => {
        c.begin();
        c.moveTo(pt.x, pt.y);
        c.lineTo(pt.x - ux - uy / 2, pt.y - uy + ux / 2);
        c.lineTo(pt.x + uy / 2 - ux, pt.y - uy - ux / 2);
        c.close();
        c.moveTo(pt.x - ux, pt.y - uy);
        c.lineTo(pt.x - 2 * ux - 0.5 * uy, pt.y + 0.5 * ux - 2 * uy);
        c.lineTo(pt.x - 2 * ux + 0.5 * uy, pt.y - 0.5 * ux - 2 * uy);
        c.close();
        paint(filled);
      };
    }
    case 'diamond':
    case 'diamondThin': {
      const f0 = type === 'diamond' ? 0.7071 : 0.9862;
      const ex = unitX * sw * f0;
      const ey = unitY * sw * f0;
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { x: pe.x - ex, y: pe.y - ey };
      pe.x += -ux - ex;
      pe.y += -uy - ey;
      const tk = type === 'diamond' ? 2 : 3.4;
      return () => {
        c.begin();
        c.moveTo(pt.x, pt.y);
        c.lineTo(pt.x - ux / 2 - uy / tk, pt.y + ux / tk - uy / 2);
        c.lineTo(pt.x - ux, pt.y - uy);
        c.lineTo(pt.x - ux / 2 + uy / tk, pt.y - uy / 2 - ux / tk);
        c.close();
        paint(filled);
      };
    }
    case 'manyOptional': {
      const a = size / 2;
      const px = pe.x;
      const py = pe.y;
      pe.x -= 2 * nx - (unitX * sw) / 2;
      pe.y -= 2 * ny - (unitY * sw) / 2;
      return () => {
        c.begin();
        c.ellipse(px - 1.5 * nx - a, py - 1.5 * ny - a, 2 * a, 2 * a);
        paint(filled);
        c.begin();
        c.moveTo(px, py);
        c.lineTo(px - nx, py - ny);
        c.moveTo(px + ny / 2, py - nx / 2);
        c.lineTo(px - nx, py - ny);
        c.lineTo(px - ny / 2, py + nx / 2);
        c.stroke();
      };
    }
    case 'dash': {
      const p = { ...pe };
      return () => {
        c.begin();
        c.moveTo(p.x - nx / 2 - ny / 2, p.y - ny / 2 + nx / 2);
        c.lineTo(p.x + ny / 2 - (3 * nx) / 2, p.y - (3 * ny) / 2 - nx / 2);
        c.stroke();
      };
    }
    case 'box': {
      const px = pe.x + nx / 2;
      const py = pe.y + ny / 2;
      pe.x -= nx;
      pe.y -= ny;
      return () => {
        c.begin();
        c.moveTo(px - nx / 2 - ny / 2, py - ny / 2 + nx / 2);
        c.lineTo(px - nx / 2 + ny / 2, py - ny / 2 - nx / 2);
        c.lineTo(px + ny / 2 - (3 * nx) / 2, py - (3 * ny) / 2 - nx / 2);
        c.lineTo(px - ny / 2 - (3 * nx) / 2, py - (3 * ny) / 2 + nx / 2);
        c.close();
        paint(filled);
      };
    }
    case 'cross': {
      const p = { ...pe };
      return () => {
        c.begin();
        c.moveTo(p.x - nx / 2 - ny / 2, p.y - ny / 2 + nx / 2);
        c.lineTo(p.x + ny / 2 - (3 * nx) / 2, p.y - (3 * ny) / 2 - nx / 2);
        c.moveTo(p.x - nx / 2 + ny / 2, p.y - ny / 2 - nx / 2);
        c.lineTo(p.x - ny / 2 - (3 * nx) / 2, p.y - (3 * ny) / 2 + nx / 2);
        c.stroke();
      };
    }
    case 'circle':
    case 'circlePlus': {
      // 円 (draw.io の Shapes.js の circleMarker): 半径 size + 線の太さ。線は 2 × 半径 + 線の太さだけ縮める。circlePlus は中に + を書く
      const r = size + sw;
      const pt = { ...pe };
      pe.x -= unitX * (2 * r + sw);
      pe.y -= unitY * (2 * r + sw);
      const ux = unitX * (r + sw);
      const uy = unitY * (r + sw);
      const plus = type === 'circlePlus';
      const px = unitX * (size + 2 * sw);
      const py = unitY * (size + 2 * sw);
      return () => {
        c.begin();
        c.ellipse(pt.x - ux - r, pt.y - uy - r, 2 * r, 2 * r);
        paint(filled);
        if (plus) {
          c.begin();
          c.moveTo(pt.x - unitX * sw, pt.y - unitY * sw);
          c.lineTo(pt.x - 2 * px + unitX * sw, pt.y - 2 * py + unitY * sw);
          c.moveTo(pt.x - px - py + unitY * sw, pt.y - py + px - unitX * sw);
          c.lineTo(pt.x + py - px - unitY * sw, pt.y - py - px + unitX * sw);
          c.stroke();
        }
      };
    }
    case 'halfCircle': {
      const pt = { ...pe };
      pe.x -= nx;
      pe.y -= ny;
      const q = { ...pe };
      return () => {
        c.begin();
        c.moveTo(pt.x - ny, pt.y + nx);
        c.quadTo(q.x - ny, q.y + nx, q.x, q.y);
        c.quadTo(q.x + ny, q.y - nx, pt.x + ny, pt.y - nx);
        c.stroke();
      };
    }
    case 'async': {
      // 片側だけの矢印。始まりの端と終わりの端で、羽を出す側が逆
      const ex = unitX * sw * 1.118;
      const ey = unitY * sw * 1.118;
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { x: pe.x - ex, y: pe.y - ey };
      pe.x += -ux - ex;
      pe.y += -uy - ey;
      return () => {
        c.begin();
        c.moveTo(pt.x, pt.y);
        if (source) c.lineTo(pt.x - ux - uy / 2, pt.y - uy + ux / 2);
        else c.lineTo(pt.x + uy / 2 - ux, pt.y - uy - ux / 2);
        c.lineTo(pt.x - ux, pt.y - uy);
        c.close();
        paint(filled);
      };
    }
    case 'openAsync': {
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { ...pe };
      return () => {
        c.begin();
        c.moveTo(pt.x, pt.y);
        if (source) c.lineTo(pt.x - ux - uy / 2, pt.y - uy + ux / 2);
        else c.lineTo(pt.x + uy / 2 - ux, pt.y - uy - ux / 2);
        c.stroke();
      };
    }
    case 'mermaidExtension':
    case 'mermaidDiamond': {
      const wf = 17 / 6;
      const ux = unitX * (size + sw);
      const uy = unitY * (size + sw);
      const pt = { ...pe };
      pe.x -= ux;
      pe.y -= uy;
      const diamond = type === 'mermaidDiamond';
      return () => {
        c.begin();
        c.moveTo(pt.x, pt.y);
        if (diamond) {
          c.lineTo(pt.x - ux / 2 - uy / wf, pt.y - uy / 2 + ux / wf);
          c.lineTo(pt.x - ux, pt.y - uy);
          c.lineTo(pt.x - ux / 2 + uy / wf, pt.y - uy / 2 - ux / wf);
        } else {
          c.lineTo(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
          c.lineTo(pt.x - ux + uy / wf, pt.y - uy - ux / wf);
        }
        c.close();
        paint(filled);
      };
    }
    // ER 図の印 (draw.io の shapes/er/mxER.js): 線は縮めない (0 の円の形は、塗らないときだけ縮める)
    case 'ERone':
    case 'ERmandOne':
    case 'ERmany':
    case 'ERoneToMany': {
      const p = { ...pe };
      return () => {
        c.begin();
        if (type === 'ERone' || type === 'ERmandOne') {
          c.moveTo(p.x - nx / 2 - ny / 2, p.y - ny / 2 + nx / 2);
          c.lineTo(p.x - nx / 2 + ny / 2, p.y - ny / 2 - nx / 2);
        }
        if (type === 'ERmandOne' || type === 'ERoneToMany') {
          c.moveTo(p.x - nx - ny / 2, p.y - ny + nx / 2);
          c.lineTo(p.x - nx + ny / 2, p.y - ny - nx / 2);
        }
        if (type === 'ERmany' || type === 'ERoneToMany') {
          c.moveTo(p.x + ny / 2, p.y - nx / 2);
          c.lineTo(p.x - nx, p.y - ny);
          c.lineTo(p.x - ny / 2, p.y + nx / 2);
        }
        c.stroke();
      };
    }
    case 'ERzeroToMany':
    case 'ERzeroToOne': {
      const a = size / 2;
      const px = pe.x;
      const py = pe.y;
      if (!filled) {
        pe.x -= 2 * nx - (unitX * sw) / 2;
        pe.y -= 2 * ny - (unitY * sw) / 2;
      }
      return () => {
        c.begin();
        c.ellipse(px - 1.5 * nx - a, py - 1.5 * ny - a, 2 * a, 2 * a);
        if (filled) {
          // 塗る形 (既定) は、円を白で塗って線を隠す
          c.setFillColor('#ffffff');
          c.fillAndStroke();
          c.setFillColor(strokeColor);
        } else c.stroke();
        c.begin();
        if (type === 'ERzeroToMany') {
          c.moveTo(px + ny / 2, py - nx / 2);
          c.lineTo(px - nx, py - ny);
          c.lineTo(px - ny / 2, py + nx / 2);
          if (!filled) {
            c.moveTo(px - nx, py - ny);
            c.lineTo(px, py);
          }
        } else {
          c.moveTo(px - nx / 2 - ny / 2, py - ny / 2 + nx / 2);
          c.lineTo(px - nx / 2 + ny / 2, py - ny / 2 - nx / 2);
          if (!filled) {
            c.moveTo(px - nx - (unitX * sw) / 2, py - ny - (unitY * sw) / 2);
            c.lineTo(px, py);
          }
        }
        c.stroke();
      };
    }
    // SysML の印 (draw.io の shapes/mxSysML.js)。線は縮めない
    case 'sysMLPackCont':
    case 'sysMLReqInt':
    case 'sysMLProvInt':
    case 'sysMLx':
    case 'sysMLLost':
    case 'sysMLFound': {
      const a = size / 2;
      const p = { ...pe };
      return () => {
        const circle = () => c.ellipse(p.x - 0.5 * nx - a, p.y - 0.5 * ny - a, 2 * a, 2 * a);
        if (type === 'sysMLPackCont') {
          c.begin();
          c.moveTo(p.x - nx / 2 - ny / 2, p.y - ny / 2 + nx / 2);
          c.lineTo(p.x - nx / 2 + ny / 2, p.y - ny / 2 - nx / 2);
          c.stroke();
          circle();
          c.stroke();
        } else if (type === 'sysMLReqInt') {
          c.setFillColor(fillColor);
          circle();
          c.fillAndStroke();
        } else if (type === 'sysMLProvInt') {
          c.setFillColor(fillColor);
          c.begin();
          c.moveTo(p.x - ny / 2, p.y + nx / 2);
          c.arcTo(a, a, 0, 0, 1, p.x + ny / 2, p.y - nx / 2);
          c.fillAndStroke();
        } else if (type === 'sysMLx') {
          c.begin();
          c.moveTo(p.x - nx / 2 - ny / 2, p.y - ny / 2 + nx / 2);
          c.lineTo(p.x + nx / 2 + ny / 2, p.y + ny / 2 - nx / 2);
          c.moveTo(p.x + nx / 2 - ny / 2, p.y + ny / 2 + nx / 2);
          c.lineTo(p.x - nx / 2 + ny / 2, p.y - ny / 2 - nx / 2);
          c.stroke();
        } else {
          if (type === 'sysMLLost') {
            c.begin();
            c.moveTo(p.x - 1.5 * nx - ny / 2, p.y - 1.5 * ny + nx / 2);
            c.lineTo(p.x - nx / 2, p.y - ny / 2);
            c.lineTo(p.x - 1.5 * nx + ny / 2, p.y - 1.5 * ny - nx / 2);
            c.stroke();
          }
          circle();
          c.setFillColor(strokeColor);
          c.fillAndStroke();
        }
      };
    }
    default:
      return undefined;
  }
}

// ───────────── 線の跳び越し ─────────────

/** 跳び越しの点の付いた経路の点 (jump: 先に描いた線と交わる点) */
export interface RoutedPt extends Pt {
  jump?: boolean;
}

/**
 * 線の跳び越しの点を探す (draw.io の Graph.js の mxGraphView.updateLineJumps): 線分ごとに、先に描いた線 (others。noJump=1 の線は除く) の線分との
 * 交わる点を、始まりからの距離の順に足す。線分の端から 0.5 以内の交わり・同じ所の交わりは跳ばない。
 * (draw.io は、交わる相手の線分の前後の点が一直線に並ぶ所も見るが、ここでは相手の線分の端の近くの交わりを跳ばないことで近似する)
 */
/**
 * 線の跳び越しの手間の上限 (lineJumps の budget)。pairs: 交わりを調べる線分の組の数の残り (図の全体で数える)。
 * limited: 上限を超えて、跳ばずに描いた線があったか (呼ぶ側が警告を出す)
 */
export interface JumpBudget {
  pairs: number;
  limited: boolean;
}

/**
 * 1 本の線の跳ぶ点の数の上限。超えたら、その線は跳ばずに描く (budget.limited)。
 * 前は上限が無く、点 2,000 の縦横の線の 1 組 (14KB) で、交わり 100 万個を、重なりの確かめ (list.some) の 2 乗の手間で探して 23.6 秒・1.75GB を使い、
 * SVG が 44MB になった。1 本の線が 1,000 本の線をまたぐ図は無い (またぐ所が見分けられない)
 */
export const MAX_LINE_JUMPS = 1000;

export function lineJumps(pts: Pt[], others: Pt[][], budget?: JumpBudget): RoutedPt[] | undefined {
  const thresh = 0.5;
  const out: RoutedPt[] = [];
  let any = false;
  if (budget) {
    // 調べる線分の組の数 (この線の線分の数 × 先に描いた線の線分の数の合計)。残りを超えるなら、跳ばない
    let segs = 0;
    for (const line of others) segs += Math.max(0, line.length - 1);
    const pairs = Math.max(0, pts.length - 1) * segs;
    if (pairs > budget.pairs) {
      budget.limited = true;
      return undefined;
    }
    budget.pairs -= pairs;
  }
  let jumps = 0;
  const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) <= thresh && Math.abs(a.y - b.y) <= thresh;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    out.push(p0);
    const list: Array<RoutedPt & { d: number }> = [];
    for (const line of others) {
      for (let j = 0; j < line.length - 1; j++) {
        const p2 = line[j];
        const p3 = line[j + 1];
        // 線分の交わる点 (mxUtils.intersection)
        const den = (p3.y - p2.y) * (p1.x - p0.x) - (p3.x - p2.x) * (p1.y - p0.y);
        if (den === 0) continue;
        const ua = ((p3.x - p2.x) * (p0.y - p2.y) - (p3.y - p2.y) * (p0.x - p2.x)) / den;
        const ub = ((p1.x - p0.x) * (p0.y - p2.y) - (p1.y - p0.y) * (p0.x - p2.x)) / den;
        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) continue;
        const pt = { x: p0.x + ua * (p1.x - p0.x), y: p0.y + ua * (p1.y - p0.y) };
        if (near(pt, p0) || near(pt, p1) || near(pt, p2) || near(pt, p3)) continue;
        const d = (pt.x - p0.x) ** 2 + (pt.y - p0.y) ** 2;
        if (list.some((q) => near(q, pt))) continue;
        if (++jumps > MAX_LINE_JUMPS) {
          if (budget) budget.limited = true;
          return undefined;
        }
        list.push({ ...pt, d, jump: true });
      }
    }
    list.sort((a, b) => a.d - b.d);
    for (const q of list) out.push({ x: q.x, y: q.y, jump: true });
    if (list.length) any = true;
  }
  out.push(pts[pts.length - 1]);
  return any ? out : undefined;
}

/**
 * 跳び越しの付いた線を引く (draw.io の Graph.js の mxConnector.prototype.paintLine): 交わる点の前後 size (jumpSize。既定 6) で線を切り、
 * jumpStyle に従って跳ぶ (arc: 弧、sharp: 角、line: 2 本の短い棒、gap: 切れ目)。ends: 矢印の分だけ縮めた両端
 */
export function paintLineJumps(c: ShapeCanvas, routed: RoutedPt[], ends: [Pt, Pt], rounded: boolean, arcSize: number, size: number, style: string) {
  let moveTo = true;
  let last: Pt | undefined;
  let len = 0;
  let pts: Pt[] = [];
  let n: Pt | undefined;
  c.begin();
  for (let i = 0; i < routed.length; i++) {
    const rpt = routed[i];
    const pt = i === 0 ? ends[0] : i === routed.length - 1 ? ends[1] : { x: rpt.x, y: rpt.y };
    let done = false;
    if (last && rpt.jump) {
      const next = routed[i + 1];
      const dist = (next.x - pt.x) ** 2 + (next.y - pt.y) ** 2;
      if (!n) {
        n = { x: pt.x - last.x, y: pt.y - last.y };
        len = Math.sqrt(n.x * n.x + n.y * n.y);
        if (len > 0) n = { x: (n.x * size) / len, y: (n.y * size) / len };
        else n = undefined;
      }
      if (n && dist > size * size && len > 0) {
        const back = (last.x - pt.x) ** 2 + (last.y - pt.y) ** 2;
        if (back > size * size) {
          const p0 = { x: pt.x - n.x, y: pt.y - n.y };
          const p1 = { x: pt.x + n.x, y: pt.y + n.y };
          pts.push(p0);
          c.addPoints(pts, rounded, arcSize, false, undefined, moveTo);
          let f = Math.round(n.x) < 0 || (Math.round(n.x) === 0 && Math.round(n.y) <= 0) ? 1 : -1;
          moveTo = false;
          if (style === 'sharp') {
            c.lineTo(p0.x - n.y * f, p0.y + n.x * f);
            c.lineTo(p1.x - n.y * f, p1.y + n.x * f);
            c.lineTo(p1.x, p1.y);
          } else if (style === 'line') {
            c.moveTo(p0.x + n.y * f, p0.y - n.x * f);
            c.lineTo(p0.x - n.y * f, p0.y + n.x * f);
            c.moveTo(p1.x - n.y * f, p1.y + n.x * f);
            c.lineTo(p1.x + n.y * f, p1.y - n.x * f);
            c.moveTo(p1.x, p1.y);
          } else if (style === 'arc') {
            f *= 1.3;
            c.curveTo(p0.x - n.y * f, p0.y + n.x * f, p1.x - n.y * f, p1.y + n.x * f, p1.x, p1.y);
          } else {
            c.moveTo(p1.x, p1.y);
            moveTo = true;
          }
          pts = [p1];
          done = true;
        }
      }
    } else n = undefined;
    if (!done) pts.push(pt);
    last = pt;
  }
  c.addPoints(pts, rounded, arcSize, false, undefined, moveTo);
  c.stroke();
}

// ───────────── サンキー図の線 ─────────────

/**
 * サンキー図の線 (draw.io の Shapes.js の MermaidSankeyLinkShape): 始まりから終わりへ、横に出て横に入る 3 次の曲線 (制御点は両端の x の真ん中) を
 * 32 に分け、幅 width (既定 10、1 以上) の帯にして塗る。帯の重なりは乗算 (mix-blend-mode: multiply) で塗る
 */
export function paintSankeyLink(c: ShapeCanvas, pts: Pt[], width: number) {
  const p0 = pts[0];
  const pe = pts[pts.length - 1];
  const mx = (p0.x + pe.x) / 2;
  const hw = Math.max(1, width) / 2;
  const n = 32;
  const side1: Pt[] = [];
  const side2: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * pe.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p0.y + 3 * u * t * t * pe.y + t * t * t * pe.y;
    let dx = 3 * u * u * (mx - p0.x) + 3 * t * t * (pe.x - mx);
    let dy = 6 * u * t * (pe.y - p0.y);
    let len = Math.hypot(dx, dy);
    if (len === 0) [dx, dy, len] = [1, 0, 1];
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    side1.push({ x: x + nx, y: y + ny });
    side2.push({ x: x - nx, y: y - ny });
  }
  c.begin();
  c.moveTo(side1[0].x, side1[0].y);
  for (let i = 1; i <= n; i++) c.lineTo(side1[i].x, side1[i].y);
  for (let i = n; i >= 0; i--) c.lineTo(side2[i].x, side2[i].y);
  c.close();
  const before = c.out.length;
  c.fillAndStroke();
  for (let i = before; i < c.out.length; i++) c.out[i] = c.out[i].replace(/^<path /, '<path style="mix-blend-mode:multiply" ');
}
