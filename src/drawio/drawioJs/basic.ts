/**
 * drawioJs/basic — draw.io の JavaScript で書かれた形のうち、基本の形 (mxgraph.basic.*) と SysML の形 (mxgraph.sysml.*) を、
 * drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/mxBasic.js・mxSysML.js の各形の paintVertexShape・
 * background・foreground (と、その中で呼ぶ drawIn・drawSymb などの関数)、js/grapheditor/Shapes.js の mxShapeBasicRect2
 * (mxgraph.basic.rect の strictDrawShape と、角・辺を描く moveNW・paintNW・paintTopInner などの関数)、
 * mxGraph の mxStylesheet.getCellStyle (スタイルの値は、数に読める文字なら数にする)・mxShape.getArcSize・mxShape.updateTransform。
 * 呼ぶ側 (drawio.ts) がセルの位置へ移し、向き・反転を済ませるので、ソースの paintVertexShape(c, x, y, w, h) の x・y は 0 として書く。
 * スタイルに無いキーの既定の値は、ソースの mxUtils.getValue に渡す値 (形の作り方 (コンストラクタ) で決める this.dx など) にする。
 * customProperties の defVal は、画面で形を作るときに書き込む値で、スタイルに無いときの描き方は変えない。
 * 接続点 (getConstraints)・取っ手 (handleFactory)・文字の置き場 (getLabelMargins)・影は移植しない
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxCellRenderer.js: Copyright (c) 2006-2017, JGraph Holdings Ltd; Copyright (c) 2006-2017, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxStylesheet.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxBasic.js: Copyright (c) 2006-2018, JGraph Ltd
 *   shapes/mxSysML.js: Copyright (c) 2006-2014, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';
import { SHAPES_A } from '../drawioShapesA';
import { SHAPES_B } from '../drawioShapesB';

// ───────────── スタイルの値の読み方 ─────────────

const NO_VALUE = '\u0000';

/** mxUtils.isNumeric (16 進の 0x… は数としない) */
const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && !Number.isNaN(parseFloat(s)) && !s.toLowerCase().includes('0x');

/**
 * スタイルの生の値 (mxStylesheet.getCellStyle: 数に読める文字は数にする。none は無いものとする)。無ければ undefined。
 * ソースの真偽の判定 (if (top) など) を、そのまま写すために使う
 */
const raw = (e: ShapeEnv, key: string): string | number | undefined => {
  const s = e.str(key, NO_VALUE);
  if (s === NO_VALUE) return undefined;
  return isNumeric(s) ? parseFloat(s) : s;
};

/** mxUtils.getValue(style, key, def) を JavaScript の真偽で読む (0 と空の文字は偽、ほかの文字・数は真) */
const truthy = (e: ShapeEnv, key: string, def: boolean) => {
  const v = raw(e, key);
  return v === undefined ? def : !!v;
};

/** parseFloat(mxUtils.getValue(style, key, def)) を [lo, hi] に収める (Math.max(lo, Math.min(hi, …))) */
const clampNum = (e: ShapeEnv, key: string, def: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, e.num(key, def)));

/** mxShape.getArcSize: 角の丸めの半径 (absoluteArcSize=1 なら arcSize / 2、ほかは短い辺の arcSize % (既定 15 %)) */
const arcSizeOf = (e: ShapeEnv, w: number, h: number) =>
  e.num('absoluteArcSize', 0) === 1 ? Math.min(w / 2, Math.min(h / 2, e.num('arcSize', 20) / 2)) : Math.min(w, h) * (e.num('arcSize', 15) / 100);

/** 点を順に結んで閉じ、塗って線を引く */
const poly = (c: ShapeCanvas, pts: number[][]) => {
  c.begin();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.close();
  c.fillAndStroke();
};

// ───────────── 基本の形 (draw.io の shapes/mxBasic.js) ─────────────

// mxShapeBasicCross: 十字 (腕の半分の太さ dx。既定 0.5)
const cross2: ShapePainter = (c, w, h, e) => {
  const dx = clampNum(e, 'dx', 0.5, 0, w);
  poly(c, [
    [w * 0.5 + dx, 0],
    [w * 0.5 + dx, h * 0.5 - dx],
    [w, h * 0.5 - dx],
    [w, h * 0.5 + dx],
    [w * 0.5 + dx, h * 0.5 + dx],
    [w * 0.5 + dx, h],
    [w * 0.5 - dx, h],
    [w * 0.5 - dx, h * 0.5 + dx],
    [0, h * 0.5 + dx],
    [0, h * 0.5 - dx],
    [w * 0.5 - dx, h * 0.5 - dx],
    [w * 0.5 - dx, 0],
  ]);
};

// mxShapeBasicRectCallout: 吹き出し (口の位置 dx・口の大きさ dy。既定 0.5)
const rectCallout: ShapePainter = (c, w, h, e) => {
  const dx = clampNum(e, 'dx', 0.5, 0, w);
  const dy = clampNum(e, 'dy', 0.5, 0, h);
  poly(c, [
    [dx - dy * 0.5, h - dy],
    [0, h - dy],
    [0, 0],
    [w, 0],
    [w, h - dy],
    [dx + dy * 0.5, h - dy],
    [dx - dy, h],
  ]);
};

// mxShapeBasicRoundRectCallout: 角の丸い吹き出し (丸め size 既定 10。口は 2 つの弧)
const roundRectCallout: ShapePainter = (c, w, h, e) => {
  let dx = clampNum(e, 'dx', 0.5, 0, w);
  const dy = clampNum(e, 'dy', 0.5, 0, h);
  let r = clampNum(e, 'size', 10, 0, h);
  r = Math.min((h - dy) / 2, w / 2, r);
  dx = Math.max(r + dy * 0.5, dx);
  dx = Math.min(w - r - dy * 0.5, dx);
  c.begin();
  c.moveTo(dx - dy * 0.5, h - dy);
  c.lineTo(r, h - dy);
  c.arcTo(r, r, 0, 0, 1, 0, h - dy - r);
  c.lineTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - dy - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h - dy);
  c.lineTo(dx + dy * 0.5, h - dy);
  c.arcTo(1.9 * dy, 1.4 * dy, 0, 0, 1, dx - dy, h);
  c.arcTo(0.9 * dy, 1.4 * dy, 0, 0, 0, dx - dy * 0.5, h - dy);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicWave: 上下が波の帯 (波の高さ dy は高さの割合。既定 0.5)
const wave2: ShapePainter = (c, w, h, e) => {
  const dy = h * clampNum(e, 'dy', 0.5, 0, h);
  const fy = 1.4;
  c.begin();
  c.moveTo(0, dy / 2);
  c.quadTo(w / 6, dy * (1 - fy), w / 3, dy / 2);
  c.quadTo(w / 2, dy * fy, (w * 2) / 3, dy / 2);
  c.quadTo((w * 5) / 6, dy * (1 - fy), w, dy / 2);
  c.lineTo(w, h - dy / 2);
  c.quadTo((w * 5) / 6, h - dy * fy, (w * 2) / 3, h - dy / 2);
  c.quadTo(w / 2, h - dy * (1 - fy), w / 3, h - dy / 2);
  c.quadTo(w / 6, h - dy * fy, 0, h - dy / 2);
  c.close();
  c.fillAndStroke();
};

/** 角を切る・丸める形の大きさ (dx の 2 倍を、幅・高さの半分までに収める) */
const cut2 = (e: ShapeEnv, w: number, h: number) => Math.min(w * 0.5, h * 0.5, clampNum(e, 'dx', 0.5, 0, w) * 2);
/** 枠の太さ (dx を、幅・高さの k 倍までに収める) */
const cutK = (e: ShapeEnv, w: number, h: number, k: number) => Math.min(w * k, h * k, clampNum(e, 'dx', 0.5, 0, w));

// mxShapeBasicOctagon: 八角形
const octagon2: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  poly(c, [
    [dx, 0],
    [w - dx, 0],
    [w, dx],
    [w, h - dx],
    [w - dx, h],
    [dx, h],
    [0, h - dx],
    [0, dx],
  ]);
};

// mxShapeBasicIsoCube: 等角の立方体 (isoAngle 既定 15。角度の単位は 200 で半周)
const isocube: ShapePainter = (c, w, h, e) => {
  const isoAngle = (clampNum(e, 'isoAngle', 15, 0.01, 94) * Math.PI) / 200;
  const isoH = Math.min(w * Math.tan(isoAngle), h * 0.5);
  poly(c, [
    [w * 0.5, 0],
    [w, isoH],
    [w, h - isoH],
    [w * 0.5, h],
    [0, h - isoH],
    [0, isoH],
  ]);
  c.begin();
  c.moveTo(0, isoH);
  c.lineTo(w * 0.5, 2 * isoH);
  c.lineTo(w, isoH);
  c.moveTo(w * 0.5, 2 * isoH);
  c.lineTo(w * 0.5, h);
  c.stroke();
};

// mxShapeBasicTriangleAcute: 頂点が上 (dx は幅の割合。既定 0.5) の三角形
const acuteTriangle: ShapePainter = (c, w, h, e) => {
  const dx = w * clampNum(e, 'dx', 0.5, 0, w);
  poly(c, [
    [0, h],
    [dx, 0],
    [w, h],
  ]);
};

// mxShapeBasicTriangleObtuse: 鈍角の三角形 (下の頂点 dx は幅の割合。既定 0.5)
const obtuseTriangle: ShapePainter = (c, w, h, e) => {
  const dx = w * clampNum(e, 'dx', 0.5, 0, w);
  poly(c, [
    [dx, h],
    [0, 0],
    [w, h],
  ]);
};

// mxShapeBasicDrop: しずく (下の円と、上の頂点からの接線)
const drop: ShapePainter = (c, w, h) => {
  const r = Math.min(h, w) * 0.5;
  const d = h - r;
  const a = Math.sqrt(d * d - r * r);
  const angle = Math.atan(a / r);
  const x1 = r * Math.sin(angle);
  const y1 = r * Math.cos(angle);
  c.begin();
  c.moveTo(w * 0.5, 0);
  c.lineTo(w * 0.5 + x1, h - r - y1);
  c.arcTo(r, r, 0, 0, 1, w * 0.5 + r, h - r);
  c.arcTo(r, r, 0, 0, 1, w * 0.5, h);
  c.arcTo(r, r, 0, 0, 1, w * 0.5 - r, h - r);
  c.arcTo(r, r, 0, 0, 1, w * 0.5 - x1, h - r - y1);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicCone2: 円錐 (頂点 dx 既定 0.5・底の楕円の上端 dy 既定 0.9。どちらも割合)
const cone2: ShapePainter = (c, w, h, e) => {
  const dx = w * clampNum(e, 'dx', 0.5, 0, w);
  const dy = h * clampNum(e, 'dy', 0.9, 0, h);
  const ry = h - dy;
  c.begin();
  c.moveTo(dx, 0);
  if (ry > 0) {
    c.lineTo(w, h - ry);
    c.arcTo(w * 0.5, ry, 0, 0, 1, w * 0.5, h);
    c.arcTo(w * 0.5, ry, 0, 0, 1, 0, h - ry);
  } else {
    c.lineTo(w, h);
    c.lineTo(0, h);
  }
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicPyramid: 角錐 (dx1 0.5・dx2 0.6・dy1 0.9・dy2 0.8。どれも割合) と、手前の稜線
const pyramid: ShapePainter = (c, w, h, e) => {
  const dx1 = w * clampNum(e, 'dx1', 0.5, 0, w);
  const dx2 = w * clampNum(e, 'dx2', 0.6, 0, w);
  const dy1 = h * clampNum(e, 'dy1', 0.9, 0, h);
  const dy2 = h * clampNum(e, 'dy2', 0.8, 0, h);
  poly(c, [
    [dx1, 0],
    [w, dy2],
    [dx2, h],
    [0, dy1],
  ]);
  c.begin();
  c.moveTo(dx1, 0);
  c.lineTo(dx2, h);
  c.stroke();
};

// mxShapeBasic4PointStar2: 4 つの尖りの星 (くびれ dx 既定 0.8 の半分を割合に)
const fourPointStar2: ShapePainter = (c, w, h, e) => {
  const dx = 0.5 * clampNum(e, 'dx', 0.8, 0, w);
  poly(c, [
    [0, h * 0.5],
    [dx * w, dx * h],
    [w * 0.5, 0],
    [w - dx * w, dx * h],
    [w, h * 0.5],
    [w - dx * w, h - dx * h],
    [w * 0.5, h],
    [dx * w, h - dx * h],
  ]);
};

// mxShapeBasicDiagSnipRect: 対角の 2 つの角を切った四角
const diagSnipRect: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  poly(c, [
    [dx, 0],
    [w, 0],
    [w, h - dx],
    [w - dx, h],
    [0, h],
    [0, dx],
  ]);
};

// mxShapeBasicDiagRoundRect: 対角の 2 つの角を丸めた四角
const diagRoundRect: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  c.begin();
  c.moveTo(dx, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h - dx);
  c.arcTo(dx, dx, 0, 0, 1, w - dx, h);
  c.lineTo(0, h);
  c.lineTo(0, dx);
  c.arcTo(dx, dx, 0, 0, 1, dx, 0);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicCornerRoundRect: 左上の角だけ丸めた四角
const cornerRoundRect: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  c.begin();
  c.moveTo(dx, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, dx);
  c.arcTo(dx, dx, 0, 0, 1, dx, 0);
  c.close();
  c.fillAndStroke();
};

/** 4 つの角を内へえぐった四角 (plaque・plaque_frame の外側) */
const plaquePath = (c: ShapeCanvas, w: number, h: number, dx: number) => {
  c.moveTo(w - dx, 0);
  c.arcTo(dx, dx, 0, 0, 0, w, dx);
  c.lineTo(w, h - dx);
  c.arcTo(dx, dx, 0, 0, 0, w - dx, h);
  c.lineTo(dx, h);
  c.arcTo(dx, dx, 0, 0, 0, 0, h - dx);
  c.lineTo(0, dx);
  c.arcTo(dx, dx, 0, 0, 0, dx, 0);
  c.close();
};

// mxShapeBasicPlaque: 角をえぐった札
const plaque: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  c.begin();
  plaquePath(c, w, h, dx);
  c.fillAndStroke();
};

// mxShapeBasicFrame: 四角の枠 (太さ dx)
const frame: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  c.begin();
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, 0);
  c.close();
  c.moveTo(dx, dx);
  c.lineTo(dx, h - dx);
  c.lineTo(w - dx, h - dx);
  c.lineTo(w - dx, dx);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicPlaqueFrame: 角をえぐった枠 (内側は角を丸める)
const plaqueFrame: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.25);
  c.begin();
  plaquePath(c, w, h, dx);
  c.moveTo(dx * 2, dx);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, dx, dx * 2);
  c.lineTo(dx, h - 2 * dx);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, dx * 2, h - dx);
  c.lineTo(w - 2 * dx, h - dx);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, w - dx, h - 2 * dx);
  c.lineTo(w - dx, dx * 2);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, w - 2 * dx, dx);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicRoundedFrame: 角の丸い枠
const roundedFrame: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.25);
  c.begin();
  c.moveTo(w - 2 * dx, 0);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, w, 2 * dx);
  c.lineTo(w, h - 2 * dx);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, w - 2 * dx, h);
  c.lineTo(dx * 2, h);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, 0, h - 2 * dx);
  c.lineTo(0, 2 * dx);
  c.arcTo(dx * 2, dx * 2, 0, 0, 1, 2 * dx, 0);
  c.close();
  c.moveTo(dx * 2, dx);
  c.arcTo(dx, dx, 0, 0, 0, dx, dx * 2);
  c.lineTo(dx, h - 2 * dx);
  c.arcTo(dx, dx, 0, 0, 0, dx * 2, h - dx);
  c.lineTo(w - 2 * dx, h - dx);
  c.arcTo(dx, dx, 0, 0, 0, w - dx, h - 2 * dx);
  c.lineTo(w - dx, dx * 2);
  c.arcTo(dx, dx, 0, 0, 0, w - 2 * dx, dx);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicFrameCorner: 枠の左上の角
const frameCorner: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  poly(c, [
    [0, 0],
    [w, 0],
    [w - dx, dx],
    [dx, dx],
    [dx, h - dx],
    [0, h],
  ]);
};

// mxShapeBasicDiagStripe: 斜めの帯 (幅 dx。端の位置は dx × 100 / 幅・高さ)
const diagStripe: ShapePainter = (c, w, h, e) => {
  const dx = Math.min(w, h, clampNum(e, 'dx', 0.5, 0, w));
  poly(c, [
    [0, h],
    [w, 0],
    [w, Math.min((dx * 100) / w, h)],
    [Math.min((dx * 100) / h, w), h],
  ]);
};

// mxShapeBasicDonut: ドーナツ (輪の太さ dx)
const donut: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  const rx = w * 0.5 - dx;
  const ry = h * 0.5 - dx;
  c.begin();
  c.moveTo(0, h * 0.5);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.5, 0);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w, h * 0.5);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.5, h);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, 0, h * 0.5);
  c.close();
  c.moveTo(w * 0.5, dx);
  c.arcTo(rx, ry, 0, 0, 0, dx, h * 0.5);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5, h - dx);
  c.arcTo(rx, ry, 0, 0, 0, w - dx, h * 0.5);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5, dx);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicLayeredRect: 3 枚を重ねた四角 (ずれ dx)
const layeredRect: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  const box = (x0: number, y0: number, x1: number, y1: number) =>
    poly(c, [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  box(dx, dx, w, h);
  box(dx * 0.5, dx * 0.5, w - dx * 0.5, h - dx * 0.5);
  box(0, 0, w - dx, h - dx);
};

// mxShapeBasicButton: 縁の 4 つの台形を重ねたボタン (左の台形は 2 度描く。ソースのとおり)
const button: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  poly(c, [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
  c.setLineJoin('round');
  const left = [
    [0, h],
    [0, 0],
    [dx, dx],
    [dx, h - dx],
  ];
  poly(c, left);
  poly(c, [
    [0, 0],
    [w, 0],
    [w - dx, dx],
    [dx, dx],
  ]);
  poly(c, [
    [w, 0],
    [w, h],
    [w - dx, h - dx],
    [w - dx, dx],
  ]);
  poly(c, [
    [0, h],
    [dx, h - dx],
    [w - dx, h - dx],
    [w, h],
  ]);
  poly(c, left);
};

// mxShapeBasicShadedButton: 縁を白・黒の半透明で塗ったボタン (線は引かない)
const shadedButton: ShapePainter = (c, w, h, e) => {
  const dx = cutK(e, w, h, 0.5);
  const fillPoly = (pts: number[][]) => {
    c.begin();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.close();
    c.fill();
  };
  fillPoly([
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
  c.setFillColor('#ffffff');
  c.setAlpha(0.25);
  fillPoly([
    [0, h],
    [0, 0],
    [dx, dx],
    [dx, h - dx],
  ]);
  c.setAlpha(0.5);
  fillPoly([
    [0, 0],
    [w, 0],
    [w - dx, dx],
    [dx, dx],
  ]);
  c.setFillColor('#000000');
  c.setAlpha(0.25);
  fillPoly([
    [w, 0],
    [w, h],
    [w - dx, h - dx],
    [w - dx, dx],
  ]);
  c.setAlpha(0.5);
  fillPoly([
    [0, h],
    [dx, h - dx],
    [w - dx, h - dx],
    [w, h],
  ]);
};

/** 角度 (0〜1 の割合。0 が上、時計回り) の楕円の上の点 (中心 cx・cy、半径 rx・ry) */
const onEllipse = (a: number, cx: number, cy: number, rx: number, ry: number) => [cx + Math.sin(a) * rx, cy - Math.cos(a) * ry];

// mxShapeBasicPie: 扇形 (startAngle 0.25・endAngle 0.75)
const pie: ShapePainter = (c, w, h, e) => {
  const s0 = clampNum(e, 'startAngle', 0.25, 0, 1);
  const e0 = clampNum(e, 'endAngle', 0.75, 0, 1);
  const startAngle = 2 * Math.PI * s0;
  const endAngle = 2 * Math.PI * e0;
  const rx = w * 0.5;
  const ry = h * 0.5;
  const [startX, startY] = onEllipse(startAngle, rx, ry, rx, ry);
  const [endX, endY] = onEllipse(endAngle, rx, ry, rx, ry);
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  const bigArc = angDiff >= Math.PI ? 1 : 0;
  c.begin();
  c.moveTo(rx, ry);
  c.lineTo(startX, startY);
  // 半周ちょうどは、1 つの弧では向きが定まらないので、四半周ずつ描く
  if (s0 % 1 === 0 && e0 % 1 === 0.5) {
    c.arcTo(rx, ry, 0, 0, 1, w, h * 0.5);
    c.arcTo(rx, ry, 0, 0, 1, w * 0.5, h);
  } else if (s0 % 1 === 0.5 && e0 % 1 === 0) {
    c.arcTo(rx, ry, 0, 0, 1, 0, h * 0.5);
    c.arcTo(rx, ry, 0, 0, 1, w * 0.5, 0);
  } else c.arcTo(rx, ry, 0, bigArc, 1, endX, endY);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicArc: 楕円の弧 (startAngle 0.25・endAngle 0.75)。線の端の形 (startArrow・endArrow) は読まない (v24.7.5 の形は付けない)
const arc: ShapePainter = (c, w, h, e) => {
  const s0 = clampNum(e, 'startAngle', 0.25, 0, 1);
  const e0 = clampNum(e, 'endAngle', 0.75, 0, 1);
  const startAngle = 2 * Math.PI * s0;
  const endAngle = 2 * Math.PI * e0;
  const rx = w * 0.5;
  const ry = h * 0.5;
  const [startX, startY] = onEllipse(startAngle, rx, ry, rx, ry);
  const [endX, endY] = onEllipse(endAngle, rx, ry, rx, ry);
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  const bigArc = angDiff > Math.PI ? 1 : 0;
  c.begin();
  c.moveTo(startX, startY);
  // 半周ちょうどは、1 つの弧では向きが定まらないので、四半周ずつ描く
  if (s0 % 1 === 0 && e0 % 1 === 0.5) {
    c.arcTo(rx, ry, 0, 0, 1, w, h * 0.5);
    c.arcTo(rx, ry, 0, 0, 1, w * 0.5, h);
  } else if (s0 % 1 === 0.5 && e0 % 1 === 0) {
    c.arcTo(rx, ry, 0, 0, 1, 0, h * 0.5);
    c.arcTo(rx, ry, 0, 0, 1, w * 0.5, 0);
  } else c.arcTo(rx, ry, 0, bigArc, 1, endX, endY);
  c.stroke();
};

/** 内と外の楕円の弧の間の帯 (partConcEllipse・bendingArch) */
const arcBand = (c: ShapeCanvas, w: number, h: number, startAngle: number, endAngle: number, arcWidth: number, bigArc: number) => {
  const rx = w * 0.5;
  const ry = h * 0.5;
  const rx2 = rx * arcWidth;
  const ry2 = ry * arcWidth;
  const [startX, startY] = onEllipse(startAngle, rx, ry, rx, ry);
  const [innerStartX, innerStartY] = onEllipse(startAngle, rx, ry, rx2, ry2);
  const [endX, endY] = onEllipse(endAngle, rx, ry, rx, ry);
  const [innerEndX, innerEndY] = onEllipse(endAngle, rx, ry, rx2, ry2);
  c.begin();
  c.moveTo(startX, startY);
  c.arcTo(rx, ry, 0, bigArc, 1, endX, endY);
  c.lineTo(innerEndX, innerEndY);
  c.arcTo(rx2, ry2, 0, bigArc, 0, innerStartX, innerStartY);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicPartConcEllipse: 同心の楕円の一部の帯 (startAngle 0.25・endAngle 0.75・arcWidth 0.5)
const partConcEllipse: ShapePainter = (c, w, h, e) => {
  const startAngle = 2 * Math.PI * clampNum(e, 'startAngle', 0.25, 0, 1);
  let endAngle = 2 * Math.PI * clampNum(e, 'endAngle', 0.75, 0, 1);
  const arcWidth = 1 - clampNum(e, 'arcWidth', 0.5, 0, 1);
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  else if (angDiff === Math.PI) endAngle += 0.00001;
  arcBand(c, w, h, startAngle, endAngle, arcWidth, angDiff >= Math.PI ? 1 : 0);
};

// mxShapeBasicNumEntryVert: 上に番号の丸 (直径 dy。既定 0.5) を置いた札
const numberedEntryVert: ShapePainter = (c, w, h, e) => {
  const dy = clampNum(e, 'dy', 0.5, 0, w);
  const inset = 5;
  const d = Math.min(dy, w - 2 * inset, h - inset);
  c.ellipse(w * 0.5 - d * 0.5, 0, d, d);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, d * 0.5);
  c.lineTo(w * 0.5 - d * 0.5 - inset, d * 0.5);
  c.arcTo(d * 0.5 + inset, d * 0.5 + inset, 0, 0, 0, w * 0.5 + d * 0.5 + inset, d * 0.5);
  c.lineTo(w, d * 0.5);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicBendingArch: 曲がった帯と、内側の楕円 (内の半径より 5 小さい)
const bendingArch: ShapePainter = (c, w, h, e) => {
  const startAngle = 2 * Math.PI * clampNum(e, 'startAngle', 0.25, 0, 1);
  const endAngle = 2 * Math.PI * clampNum(e, 'endAngle', 0.75, 0, 1);
  const arcWidth = 1 - clampNum(e, 'arcWidth', 0.5, 0, 1);
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  const rx3 = w * 0.5 * arcWidth - 5;
  const ry3 = h * 0.5 * arcWidth - 5;
  c.ellipse(w * 0.5 - rx3, h * 0.5 - ry3, 2 * rx3, 2 * ry3);
  c.fillAndStroke();
  arcBand(c, w, h, startAngle, endAngle, arcWidth, angDiff > Math.PI ? 1 : 0);
};

// mxShapeBasicThreeCornerRoundRect: 左下を除く 3 つの角を丸めた四角
const threeCornerRoundRect: ShapePainter = (c, w, h, e) => {
  const dx = cut2(e, w, h);
  c.begin();
  c.moveTo(dx, 0);
  c.lineTo(w - dx, 0);
  c.arcTo(dx, dx, 0, 0, 1, w, dx);
  c.lineTo(w, h - dx);
  c.arcTo(dx, dx, 0, 0, 1, w - dx, h);
  c.lineTo(0, h);
  c.lineTo(0, dx);
  c.arcTo(dx, dx, 0, 0, 1, dx, 0);
  c.close();
  c.fillAndStroke();
};

// mxShapeBasicPolygon: 多角形 (polyCoords: 割合の点の JSON の配列。polyline が偽 (0・無い) なら閉じる)。
// 辺は直線だけ (v24.7.5 の形は polyCurves を読まない)。JSON が読めないときは描かない (ソースは例外を無視する)
const polygon: ShapePainter = (c, w, h, e) => {
  let coords: unknown;
  try {
    coords = JSON.parse(e.str('polyCoords', '[]'));
  } catch {
    return;
  }
  if (!Array.isArray(coords) || coords.length === 0) return;
  const pt = (k: number) => {
    const p = coords[k] as unknown;
    const x = Array.isArray(p) ? Number(p[0]) * w : NaN;
    const y = Array.isArray(p) ? Number(p[1]) * h : NaN;
    return [x, y];
  };
  // 数でない座標は描けない (ソースでは NaN の経路になる)
  const all = coords.map((_, k) => pt(k));
  if (all.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return;
  // polyline == false (JavaScript の緩い比較: 無い・0・空の文字なら閉じる)
  const pl = raw(e, 'polyline');
  const closed = pl === undefined || Number(pl) === 0;
  c.begin();
  c.moveTo(all[0][0], all[0][1]);
  for (let i = 1; i < all.length; i++) c.lineTo(all[i][0], all[i][1]);
  if (closed) c.close();
  c.fillAndStroke();
};

// mxShapeBasicPatternFillRect: 模様 (fillStyle: diag・diagRev・vert・hor・grid・diagGrid。間隔 step 既定 5、
// 線の色 fillStrokeColor 既定 #cccccc・太さ fillStrokeWidth 既定 1) で埋めた四角と、辺ごとに引ける (top・right・bottom・left) 縁
/**
 * 繰り返しで描く部分 (模様の線) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値や 0 の間隔で描き終わらないのを防ぐため、上限までは描いて、そこで止める。ふつうの値では上限に届かないので、描き方は変わらない
 */
const PATTERN_MAX_LINES = 10000;
const patternFillRect: ShapePainter = (c, w, h, e) => {
  const strokeColor = e.color('strokeColor', '#000000');
  const strokeWidth = e.num('strokeWidth', 1);
  c.rect(0, 0, w, h);
  c.fill();
  c.setStrokeColor(e.color('fillStrokeColor', '#cccccc'));
  c.setStrokeWidth(e.num('fillStrokeWidth', 1));
  let step = e.num('step', 5);
  const fillStyle = e.str('fillStyle', 'none');
  // 線は、模様の向きごとに PATTERN_MAX_LINES 本まで (Kumiori の守り。間隔が 0 以下だと尽きない)
  if (fillStyle === 'diag' || fillStyle === 'diagGrid') {
    step *= 1.41;
    c.begin();
    for (let i = 0, n = 0; i < h + w && n < PATTERN_MAX_LINES; i += step, n++) {
      if (i <= h) c.moveTo(0, i);
      else c.moveTo(i - h, h);
      if (i <= w) c.lineTo(i, 0);
      else c.lineTo(w, i - w);
    }
    c.stroke();
  } else if (fillStyle === 'vert' || fillStyle === 'grid') {
    c.begin();
    for (let i = 0, n = 0; i <= w && n < PATTERN_MAX_LINES; i += step, n++) {
      c.moveTo(i, 0);
      c.lineTo(i, h);
    }
    c.stroke();
  }
  if (fillStyle === 'diagRev' || fillStyle === 'diagGrid') {
    if (fillStyle === 'diagRev') step *= 1.41;
    c.begin();
    for (let i = 0, n = 0; i < h + w && n < PATTERN_MAX_LINES; i += step, n++) {
      if (i <= h) {
        c.moveTo(w, i);
        if (i <= w) c.lineTo(w - i, 0);
        else c.lineTo(w - w, i - w);
      } else {
        c.moveTo(w - i + h, h);
        if (i <= w) c.lineTo(w - i, 0);
        else c.lineTo(0, i - w);
      }
    }
    c.stroke();
  } else if (fillStyle === 'hor' || fillStyle === 'grid') {
    c.begin();
    for (let i = 0, n = 0; i <= h && n < PATTERN_MAX_LINES; i += step, n++) {
      c.moveTo(0, i);
      c.lineTo(w, i);
    }
    c.stroke();
  }
  c.setStrokeColor(strokeColor);
  c.setStrokeWidth(strokeWidth);
  // getValue(style, key, '1') == '1' (数の 1 か、無いとき)
  const side = (k: string) => {
    const v = raw(e, k);
    return v === undefined || v === 1;
  };
  c.begin();
  c.moveTo(0, 0);
  if (side('top')) c.lineTo(w, 0);
  else c.moveTo(w, 0);
  if (side('right')) c.lineTo(w, h);
  else c.moveTo(w, h);
  if (side('bottom')) c.lineTo(0, h);
  else c.moveTo(0, h);
  if (side('left')) c.lineTo(0, 0);
  c.stroke();
};

// ───────────── 四角 (draw.io の js/grapheditor/Shapes.js の mxShapeBasicRect2) ─────────────

/**
 * 角の形 (rectStyle: square・rounded・snip・invRound・fold。角ごとに topLeftStyle などで変えられ、default は rectStyle)、
 * 辺ごとの線 (top・right・bottom・left)、縁の形 (rectOutline: single・double (内にもう 1 本)・frame (縁の間を塗る))、
 * 内側の塗り (fillColor2・gradientColor2・gradientDirection2) の四角。
 * 角・辺を描く関数は、ソースと同じ引数で呼ぶ (呼ぶ場所によって、名前と違う角の形を渡すところもあるが、そのまま写す)
 */
const rect2: ShapePainter = (c, w, h, e) => {
  const rectStyle = e.str('rectStyle', 'square');
  const absoluteCornerSize = truthy(e, 'absoluteCornerSize', true);
  let size = clampNum(e, 'size', 10, 0, w);
  const rectOutline = e.str('rectOutline', 'single');
  let indent = clampNum(e, 'indent', 2, 0, w);
  const relIndent = Math.max(0, Math.min(50, indent));
  const top = truthy(e, 'top', true);
  const right = truthy(e, 'right', true);
  const bottom = truthy(e, 'bottom', true);
  const left = truthy(e, 'left', true);
  const tl = e.str('topLeftStyle', 'default');
  const tr = e.str('topRightStyle', 'default');
  const br = e.str('bottomRightStyle', 'default');
  const bl = e.str('bottomLeftStyle', 'default');
  const fillColor = e.str('fillColor', '#ffffff');
  const fillColor2 = e.color('fillColor2', undefined);
  const gradientColor2 = e.color('gradientColor2', undefined);
  const gdir2 = e.str('gradientDirection2', 'south');
  const relSize = Math.max(0, Math.min(50, size));
  c.setDashed(truthy(e, 'dashed', false));
  const dashPattern = e.str('dashPattern', '');
  if (dashPattern) c.setDashPattern(dashPattern);
  c.setStrokeWidth(e.num('strokeWidth', 1));
  size = Math.min(h * 0.5, w * 0.5, size);
  if (!absoluteCornerSize) size = (relSize * Math.min(w, h)) / 100;
  size = Math.min(size, Math.min(w, h) * 0.5);
  if (!absoluteCornerSize) indent = (relIndent * Math.min(w, h)) / 100;
  indent = Math.min(indent, Math.min(w, h) * 0.5 - size);

  /** 角の形 (default は rectStyle) */
  const k = (cs: string) => (cs === 'default' ? rectStyle : cs);
  const M = (x: number, y: number) => c.moveTo(x, y);
  const L = (x: number, y: number) => c.lineTo(x, y);
  const A = (r: number, sweep: number, x: number, y: number) => c.arcTo(r, r, 0, 0, sweep, x, y);

  // 外側の角と辺
  const moveNW = (cs: string, s: number, lf: boolean) => (k(cs) === 'square' || !lf ? M(0, 0) : M(0, s));
  const moveNE = (cs: string, s: number, tp: boolean) => (k(cs) === 'square' || !tp ? M(w, 0) : M(w - s, 0));
  const moveSE = (cs: string, s: number, rt: boolean) => (k(cs) === 'square' || !rt ? M(w, h) : M(w, h - s));
  const moveSW = (cs: string, s: number, bt: boolean) => (k(cs) === 'square' || !bt ? M(0, h) : M(s, h));
  /** 角を回る (丸め・逆の丸めは弧、切る・折るは直線、四角は何もしない) */
  const corner = (cs: string, s: number, on: boolean, ox: number, oy: number, x: number, y: number) => {
    const t = k(cs);
    if (!on) L(ox, oy);
    else if (t === 'rounded' || t === 'invRound') A(s, t === 'rounded' ? 1 : 0, x, y);
    else if (t === 'snip' || t === 'fold') L(x, y);
  };
  const paintNW = (cs: string, s: number, lf: boolean) => corner(cs, s, lf, 0, 0, s, 0);
  const paintNE = (cs: string, s: number, tp: boolean) => corner(cs, s, tp, w, 0, w, s);
  const paintSE = (cs: string, s: number, rt: boolean) => corner(cs, s, rt, w, h, w - s, h);
  const paintSW = (cs: string, s: number, bt: boolean) => corner(cs, s, bt, 0, h, 0, h - s);
  const paintTop = (cs: string, s: number, rt: boolean) => (k(cs) === 'square' || !rt ? L(w, 0) : L(w - s, 0));
  const paintRight = (cs: string, s: number, bt: boolean) => (k(cs) === 'square' || !bt ? L(w, h) : L(w, h - s));
  const paintLeft = (cs: string, s: number, tp: boolean) => (k(cs) === 'square' || !tp ? L(0, 0) : L(0, s));
  const paintBottom = (cs: string, s: number, lf: boolean) => (k(cs) === 'square' || !lf ? L(0, h) : L(s, h));

  // 内側の角 (四角は、paintSWInner だけが直線を引く。ソースのとおり)
  const paintNWInner = (cs: string, s: number, ind: number) => {
    const t = k(cs);
    if (t === 'rounded') A(s - ind * 0.5, 0, ind, ind * 0.5 + s);
    else if (t === 'invRound') A(s + ind, 1, ind, ind + s);
    else if (t === 'snip') L(ind, ind * 0.5 + s);
    else if (t === 'fold') {
      L(ind + s, ind + s);
      L(ind, ind + s);
    }
  };
  const paintNEInner = (cs: string, s: number, ind: number) => {
    const t = k(cs);
    if (t === 'rounded') A(s - ind * 0.5, 0, w - s - ind * 0.5, ind);
    else if (t === 'invRound') A(s + ind, 1, w - s - ind, ind);
    else if (t === 'snip') L(w - s - ind * 0.5, ind);
    else if (t === 'fold') {
      L(w - s - ind, s + ind);
      L(w - s - ind, ind);
    }
  };
  const paintSEInner = (cs: string, s: number, ind: number) => {
    const t = k(cs);
    if (t === 'rounded') A(s - ind * 0.5, 0, w - ind, h - s - ind * 0.5);
    else if (t === 'invRound') A(s + ind, 1, w - ind, h - s - ind);
    else if (t === 'snip') L(w - ind, h - s - ind * 0.5);
    else if (t === 'fold') {
      L(w - s - ind, h - s - ind);
      L(w - ind, h - s - ind);
    }
  };
  const paintSWInner = (cs: string, s: number, ind: number, bt: boolean) => {
    const t = k(cs);
    if (!bt) L(ind, h);
    else if (t === 'square') L(ind, h - ind);
    else if (t === 'rounded') A(s - ind * 0.5, 0, s + ind * 0.5, h - ind);
    else if (t === 'invRound') A(s + ind, 1, s + ind, h - ind);
    else if (t === 'snip') L(s + ind * 0.5, h - ind);
    else if (t === 'fold') {
      L(ind + s, h - s - ind);
      L(ind + s, h - ind);
    }
  };
  // 内側の辺
  const paintTopInner = (cs: string, s: number, ind: number, lf: boolean, tp: boolean) => {
    const t = k(cs);
    if (!lf && !tp) L(0, 0);
    else if (!lf && tp) L(0, ind);
    else if (lf && !tp) L(ind, 0);
    else if (t === 'square') L(ind, ind);
    else if (t === 'rounded' || t === 'snip') L(s + ind * 0.5, ind);
    else L(s + ind, ind);
  };
  const paintRightInner = (cs: string, s: number, ind: number, tp: boolean, rt: boolean) => {
    const t = k(cs);
    if (!tp && !rt) L(w, 0);
    else if (!tp && rt) L(w - ind, 0);
    else if (tp && !rt) L(w, ind);
    else if (t === 'square') L(w - ind, ind);
    else if (t === 'rounded' || t === 'snip') L(w - ind, s + ind * 0.5);
    else L(w - ind, s + ind);
  };
  const paintLeftInner = (cs: string, s: number, ind: number, bt: boolean, lf: boolean) => {
    const t = k(cs);
    if (!bt && !lf) L(0, h);
    else if (!bt && lf) L(ind, h);
    else if (bt && !lf) L(0, h - ind);
    else if (t === 'square') L(ind, h - ind);
    else if (t === 'rounded' || t === 'snip') L(ind, h - s - ind * 0.5);
    else L(ind, h - s - ind);
  };
  const paintBottomInner = (cs: string, s: number, ind: number, rt: boolean, bt: boolean) => {
    const t = k(cs);
    if (!rt && !bt) L(w, h);
    else if (!rt && bt) L(w, h - ind);
    else if (rt && !bt) L(w - ind, h);
    else if (t === 'square') L(w - ind, h - ind);
    else if (t === 'rounded' || t === 'snip') L(w - s - ind * 0.5, h - ind);
    else L(w - s - ind, h - ind);
  };
  // 内側の縁の始まり (ソースの move…Inner・line…Inner。P が moveTo なら移動、lineTo なら直線)
  const startSWInner = (P: typeof M, cs: string, s: number, ind: number, lf: boolean) => {
    const t = k(cs);
    if (!lf) P(0, h - ind);
    else if (t === 'square') P(ind, h - ind);
    else if (t === 'rounded' || t === 'snip') P(ind, h - s - ind * 0.5);
    else if (t === 'invRound' || t === 'fold') P(ind, h - s - ind);
  };
  const startSEInner = (P: typeof M, cs: string, s: number, ind: number, bt: boolean) => {
    const t = k(cs);
    if (!bt) P(w - ind, h);
    else if (t === 'square') P(w - ind, h - ind);
    else if (t === 'rounded' || t === 'snip') P(w - ind, h - s - ind * 0.5);
    else if (t === 'invRound' || t === 'fold') P(w - ind, h - s - ind);
  };
  // 右の辺があれば、角の形に関わらず (w - indent, indent) (ソースの条件の「|| right」のとおり)
  const startNEInner = (P: typeof M, _cs: string, _s: number, ind: number, rt: boolean) => (!rt ? P(w, ind) : P(w - ind, ind));
  const startNWInner = (P: typeof M, cs: string, s: number, ind: number, tp: boolean, lf: boolean) => {
    const t = k(cs);
    if (!tp && !lf) P(0, 0);
    else if (!tp && lf) P(ind, 0);
    else if (tp && !lf) P(0, ind);
    else if (t === 'square') P(ind, ind);
    else if (t === 'rounded' || t === 'snip') P(ind, s + ind * 0.5);
    else if (t === 'invRound' || t === 'fold') P(ind, s + ind);
  };
  const moveSWInner = (cs: string, s: number, ind: number, lf: boolean) => startSWInner(M, cs, s, ind, lf);
  const moveNWInner = (cs: string, s: number, ind: number, tp: boolean, lf: boolean) => startNWInner(M, cs, s, ind, tp, lf);
  // 折った角の線
  const paintFolds = () => {
    if (rectStyle === 'fold' || tl === 'fold' || tr === 'fold' || br === 'fold' || bl === 'fold') {
      if (k(tl) === 'fold' && top && left) {
        M(0, size);
        L(size, size);
        L(size, 0);
      }
      if (k(tr) === 'fold' && top && right) {
        M(w - size, 0);
        L(w - size, size);
        L(w, size);
      }
      if (k(br) === 'fold' && bottom && right) {
        M(w - size, h);
        L(w - size, h - size);
        L(w, h - size);
      }
      if (k(bl) === 'fold' && bottom && left) {
        M(0, h - size);
        L(size, h - size);
        L(size, h);
      }
    }
  };

  if ((top || right || bottom || left) && rectOutline !== 'frame') {
    // 外の縁の内側を塗る
    c.begin();
    if (!top) M(0, 0);
    else moveNW(tl, size, left);
    if (top) paintNW(tl, size, left);
    paintTop(tr, size, right);
    if (right) paintNE(tr, size, top);
    paintRight(br, size, bottom);
    if (bottom) paintSE(br, size, right);
    paintBottom(bl, size, left);
    if (left) paintSW(bl, size, bottom);
    paintLeft(tl, size, top);
    c.close();
    c.fill();
    // 内側の塗り (setGradient(fillColor2, gradientColor2, …)。片方が none なら、もう片方の色で塗る)
    c.setGradient(fillColor2, gradientColor2, gdir2);
    c.begin();
    if (!top) M(indent, 0);
    else moveNWInner(tl, size, indent, top, left);
    paintLeftInner(bl, size, indent, bottom, left);
    if (left && bottom) paintSWInner(bl, size, indent, bottom);
    paintBottomInner(br, size, indent, right, bottom);
    if (bottom && right) paintSEInner(br, size, indent);
    paintRightInner(tr, size, indent, top, right);
    if (right && top) paintNEInner(tr, size, indent);
    paintTopInner(tl, size, indent, left, top);
    if (top && left) paintNWInner(tl, size, indent);
    c.fill();
    if (fillColor === 'none') {
      c.begin();
      paintFolds();
      c.stroke();
    }
  }

  const double = rectOutline === 'double';
  /**
   * 縁の 1 つの続き (outer: 外の縁を描く。inner: 内の縁を描く (始まりは move…Inner の形で、frame なら line…Inner に置き換える))。
   * frame でなければ線を引くだけ (double なら内の縁も)、frame なら外と内を結んで閉じ、塗って線を引く
   */
  const run = (outer: () => void, inner: (P: typeof M) => void) => {
    c.begin();
    outer();
    if (rectOutline !== 'frame') {
      if (double) inner(M);
      c.stroke();
    } else {
      inner(L);
      c.close();
      c.fillAndStroke();
    }
  };

  // 辺の組み合わせごとに描く (ソースの strictDrawShape の場合分けのとおり)
  if (!top && !right && !bottom && left) {
    run(
      () => {
        moveSW(tl, size, bottom);
        paintLeft(tl, size, top);
      },
      (P) => {
        startNWInner(P, tl, size, indent, top, left);
        paintLeftInner(bl, size, indent, bottom, left);
      },
    );
  } else if (!top && !right && bottom && !left) {
    run(
      () => {
        moveSE(br, size, right);
        paintBottom(bl, size, left);
      },
      (P) => {
        startSWInner(P, bl, size, indent, left);
        paintBottomInner(br, size, indent, right, bottom);
      },
    );
  } else if (!top && !right && bottom && left) {
    run(
      () => {
        moveSE(br, size, right);
        paintBottom(bl, size, left);
        paintSW(bl, size, bottom);
        paintLeft(tl, size, top);
      },
      (P) => {
        startNWInner(P, tl, size, indent, top, left);
        paintLeftInner(bl, size, indent, bottom, left);
        paintSWInner(bl, size, indent, bottom);
        paintBottomInner(br, size, indent, right, bottom);
      },
    );
  } else if (!top && right && !bottom && !left) {
    run(
      () => {
        moveNE(tr, size, top);
        paintRight(br, size, bottom);
      },
      (P) => {
        startSEInner(P, br, size, indent, bottom);
        paintRightInner(tr, size, indent, top, right);
      },
    );
  } else if (!top && right && !bottom && left) {
    run(
      () => {
        moveSW(tl, size, bottom);
        paintLeft(tl, size, top);
      },
      (P) => {
        startNWInner(P, tl, size, indent, top, left);
        paintLeftInner(bl, size, indent, bottom, left);
      },
    );
    run(
      () => {
        moveNE(tr, size, top);
        paintRight(br, size, bottom);
      },
      (P) => {
        startSEInner(P, br, size, indent, bottom);
        paintRightInner(tr, size, indent, top, right);
      },
    );
  } else if (!top && right && bottom && !left) {
    run(
      () => {
        moveNE(tr, size, top);
        paintRight(br, size, bottom);
        paintSE(br, size, right);
        paintBottom(bl, size, left);
      },
      (P) => {
        startSWInner(P, bl, size, indent, left);
        paintBottomInner(br, size, indent, right, bottom);
        paintSEInner(br, size, indent);
        paintRightInner(tr, size, indent, top, right);
      },
    );
  } else if (!top && right && bottom && left) {
    run(
      () => {
        moveNE(tr, size, top);
        paintRight(br, size, bottom);
        paintSE(br, size, right);
        paintBottom(bl, size, left);
        paintSW(bl, size, bottom);
        paintLeft(tl, size, top);
      },
      (P) => {
        startNWInner(P, tl, size, indent, top, left);
        paintLeftInner(bl, size, indent, bottom, left);
        paintSWInner(bl, size, indent, bottom);
        paintBottomInner(br, size, indent, right, bottom);
        paintSEInner(br, size, indent);
        paintRightInner(tr, size, indent, top, right);
      },
    );
  } else if (top && !right && !bottom && !left) {
    run(
      () => {
        moveNW(tl, size, left);
        paintTop(tr, size, right);
      },
      (P) => {
        startNEInner(P, tr, size, indent, right);
        paintTopInner(tl, size, indent, left, top);
      },
    );
  } else if (top && !right && !bottom && left) {
    run(
      () => {
        moveSW(bl, size, bottom);
        paintLeft(tl, size, top);
        paintNW(tl, size, left);
        paintTop(tr, size, right);
      },
      (P) => {
        startNEInner(P, tr, size, indent, right);
        paintTopInner(tl, size, indent, left, top);
        paintNWInner(tl, size, indent);
        paintLeftInner(bl, size, indent, bottom, left);
      },
    );
  } else if (top && !right && bottom && !left) {
    run(
      () => {
        moveNW(tl, size, left);
        paintTop(tr, size, right);
      },
      (P) => {
        startNEInner(P, tr, size, indent, right);
        paintTopInner(tl, size, indent, left, top);
      },
    );
    run(
      () => {
        moveSE(br, size, right);
        paintBottom(bl, size, left);
      },
      (P) => {
        startSWInner(P, bl, size, indent, left);
        paintBottomInner(br, size, indent, right, bottom);
      },
    );
  } else if (top && !right && bottom && left) {
    run(
      () => {
        moveSE(br, size, right);
        paintBottom(bl, size, left);
        paintSW(bl, size, bottom);
        paintLeft(tl, size, top);
        paintNW(tl, size, left);
        paintTop(tr, size, right);
      },
      (P) => {
        startNEInner(P, tr, size, indent, right);
        paintTopInner(tl, size, indent, left, top);
        paintNWInner(tl, size, indent);
        paintLeftInner(bl, size, indent, bottom, left);
        paintSWInner(bl, size, indent, bottom);
        paintBottomInner(br, size, indent, right, bottom);
      },
    );
  } else if (top && right && !bottom && !left) {
    run(
      () => {
        moveNW(tl, size, left);
        paintTop(tr, size, right);
        paintNE(tr, size, top);
        paintRight(br, size, bottom);
      },
      (P) => {
        startSEInner(P, br, size, indent, bottom);
        paintRightInner(tr, size, indent, top, right);
        paintNEInner(tr, size, indent);
        paintTopInner(tl, size, indent, left, top);
      },
    );
  } else if (top && right && !bottom && left) {
    run(
      () => {
        moveSW(bl, size, bottom);
        paintLeft(tl, size, top);
        paintNW(tl, size, left);
        paintTop(tr, size, right);
        paintNE(tr, size, top);
        paintRight(br, size, bottom);
      },
      (P) => {
        startSEInner(P, br, size, indent, bottom);
        paintRightInner(tr, size, indent, top, right);
        paintNEInner(tr, size, indent);
        paintTopInner(tl, size, indent, left, top);
        paintNWInner(tl, size, indent);
        paintLeftInner(bl, size, indent, bottom, left);
      },
    );
  } else if (top && right && bottom && !left) {
    run(
      () => {
        moveNW(tl, size, left);
        paintTop(tr, size, right);
        paintNE(tr, size, top);
        paintRight(br, size, bottom);
        paintSE(br, size, right);
        paintBottom(bl, size, left);
      },
      (P) => {
        startSWInner(P, bl, size, indent, left);
        paintBottomInner(br, size, indent, right, bottom);
        paintSEInner(br, size, indent);
        paintRightInner(tr, size, indent, top, right);
        paintNEInner(tr, size, indent);
        paintTopInner(tl, size, indent, left, top);
      },
    );
  } else if (top && right && bottom && left) {
    // 4 辺: 外の縁を閉じ、内の縁 (double・frame) は左下から始めて閉じる (frame でも移動から始める)
    c.begin();
    moveNW(tl, size, left);
    paintNW(tl, size, left);
    paintTop(tr, size, right);
    paintNE(tr, size, top);
    paintRight(br, size, bottom);
    paintSE(br, size, right);
    paintBottom(bl, size, left);
    paintSW(bl, size, bottom);
    paintLeft(tl, size, top);
    c.close();
    if (double || rectOutline === 'frame') {
      moveSWInner(bl, size, indent, left);
      paintSWInner(bl, size, indent, bottom);
      paintBottomInner(br, size, indent, right, bottom);
      paintSEInner(br, size, indent);
      paintRightInner(tr, size, indent, top, right);
      paintNEInner(tr, size, indent);
      paintTopInner(tl, size, indent, left, top);
      paintNWInner(tl, size, indent);
      paintLeftInner(bl, size, indent, bottom, left);
      c.close();
    }
    if (rectOutline === 'frame') c.fillAndStroke();
    else c.stroke();
  }
  c.begin();
  paintFolds();
  c.stroke();
};

// ───────────── SysML (draw.io の shapes/mxSysML.js) ─────────────

/** mxShape.getShapeRotation の向きの分 (north 270・west 180・south 90 度) */
const directionRotation = (d: string | undefined) => (d === 'north' ? 270 : d === 'west' ? 180 : d === 'south' ? 90 : 0);

// mxShapeSysMLComposite: 記号 (symbol0 は形の全体、symbol1… は …Align・…VerticalAlign・…Width・…Height・…Spacing・
// …VSpacing・…ArcSpacing・…Direction で置き場を決める) を重ねる (mxShape の paintBackground は何も描かない)。
// 記号の形は、このファイルと drawioShapesA.ts・drawioShapesB.ts の形を描ける (mxCellRenderer.defaultShapes に当たる)
const composite: ShapePainter = (c, w, h, e) => {
  const lookup = (name: string): ShapePainter | undefined =>
    Object.hasOwn(SHAPES_BASIC, name) ? SHAPES_BASIC[name] : Object.hasOwn(SHAPES_A, name) ? SHAPES_A[name] : Object.hasOwn(SHAPES_B, name) ? SHAPES_B[name] : undefined;
  // 記号は、その形を新しく作って描く (ソースの new shape()。スタイルは同じものを渡し、線の太さ・塗り・線・丸めは形の既定のまま)
  const sub: ShapeEnv = { ...e, fill: undefined, stroke: undefined, strokeWidth: 1, rounded: false };
  const shape0 = lookup(e.str('symbol0', ''));
  if (shape0 && shape0 !== composite) {
    c.save();
    shape0(c, w, h, sub);
    c.restore();
  }
  c.setDashed(false);
  for (let counter = 1; ; counter++) {
    const key = `symbol${counter}`;
    const shape = lookup(e.str(key, ''));
    if (!shape) break;
    if (shape === composite) continue;
    const align = e.str(`${key}Align`, '');
    const valign = e.str(`${key}VerticalAlign`, '');
    const width = e.num(`${key}Width`, NaN);
    const height = e.num(`${key}Height`, NaN);
    let spacing = e.num(`${key}Spacing`, 0) || 0;
    let vspacing = e.num(`${key}VSpacing`, 0) || 0;
    const arcspacing = e.num(`${key}ArcSpacing`, NaN);
    const direction = e.str(`${key}Direction`, '') || undefined;
    if (!Number.isNaN(arcspacing)) {
      const a = arcSizeOf(e, w + e.strokeWidth, h + e.strokeWidth) * arcspacing;
      spacing += a;
      vspacing += a;
    }
    // 幅・高さの無い記号は置けない (ソースでは位置が NaN になる)
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    let x2 = 0;
    let y2 = 0;
    if (align === 'center') x2 += (w - width) / 2;
    else if (align === 'right') x2 += w - width - spacing;
    else x2 += spacing;
    if (valign === 'middle') y2 += (h - height) / 2;
    else if (valign === 'bottom') y2 += h - height - vspacing;
    else y2 += vspacing;
    c.save();
    // mxShape.updateTransform: 記号の中心で、向きの分だけ回す (幅と高さは入れ替えない)
    c.rotate(directionRotation(direction), false, false, x2 + width / 2, y2 + height / 2);
    c.translate(x2, y2);
    shape(c, width, height, { ...sub, direction: direction ?? 'east' });
    c.restore();
  }
};

/** 左上の見出しの札 (幅 xSize・高さ 20。x0 から。closed なら上の辺まで閉じて塗る、でなければ線だけ) */
const tabHeader = (c: ShapeCanvas, w: number, x0: number, xSize0: number, closed: boolean) => {
  const ySize = 20;
  const xSize = Math.min(xSize0, w);
  if (xSize > ySize) {
    c.begin();
    c.moveTo(x0, ySize);
    c.lineTo(xSize - ySize * 0.5, ySize);
    c.lineTo(xSize, ySize * 0.5);
    c.lineTo(xSize, 0);
    if (closed) {
      c.lineTo(x0, 0);
      c.close();
      c.fillAndStroke();
    } else c.stroke();
  }
};

// mxShapeSysMLPackage: 四角と、左上の見出し (幅 labelX。既定 90) の線
const sysPackage: ShapePainter = (c, w, h, e) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  tabHeader(c, w, 0, parseInt(e.str('labelX', '90'), 10), false);
};

// mxShapeSysMLPackage2: 線だけの四角と、塗った見出し
const sysPackage2: ShapePainter = (c, w, h, e) => {
  c.rect(0, 0, w, h);
  c.stroke();
  tabHeader(c, w, 0, parseInt(e.str('labelX', '90'), 10), true);
};

// mxShapeSysMLNone: 何も描かない
const sysNone: ShapePainter = () => {};

/** 四角を塗って線を引く */
const R = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.rect(x, y, w, h);
  c.fillAndStroke();
};

// mxShapeSysMLRect・PortOne・PortTwo・PortFour: 四角
const sysRect: ShapePainter = (c, w, h) => R(c, 0, 0, w, h);
const port1: ShapePainter = (c, w, h) => R(c, w * 0.05, 0, w - w * 0.1, h);
const port2: ShapePainter = (c, w, h) => R(c, w * 0.05, 0, w * 0.8, h);
const port4: ShapePainter = (c, w, h) => R(c, w * 0.05, 0, w - w * 0.05, h);

/** 矢印 (mxShapeSysMLItemFlow の drawRight・drawLeft・drawDown・drawUp、PortThree の drawIn・drawOut・drawInOut) */
const arrowRight = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.begin();
  c.moveTo(x, y + h * 0.5);
  c.lineTo(x + w, y + h * 0.5);
  c.moveTo(x + w * 0.75, y);
  c.lineTo(x + w, y + h * 0.5);
  c.lineTo(x + w * 0.75, y + h);
  c.stroke();
};
const arrowLeft = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.begin();
  c.moveTo(x, y + h * 0.5);
  c.lineTo(x + w, y + h * 0.5);
  c.moveTo(x + w * 0.25, y);
  c.lineTo(x, y + h * 0.5);
  c.lineTo(x + w * 0.25, y + h);
  c.stroke();
};
const arrowDown = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.begin();
  c.moveTo(x + w * 0.5, y);
  c.lineTo(x + w * 0.5, y + h);
  c.moveTo(x, y + h * 0.75);
  c.lineTo(x + w * 0.5, y + h);
  c.lineTo(x + w, y + h * 0.75);
  c.stroke();
};
const arrowUp = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.begin();
  c.moveTo(x + w * 0.5, y + h);
  c.lineTo(x + w * 0.5, y);
  c.moveTo(x, y + h * 0.25);
  c.lineTo(x + w * 0.5, y);
  c.lineTo(x + w, y + h * 0.25);
  c.stroke();
};
const arrowInOut = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.begin();
  c.moveTo(x + w * 0.75, y);
  c.lineTo(x + w, y + h * 0.5);
  c.lineTo(x + w * 0.75, y + h);
  c.moveTo(x + w * 0.25, y);
  c.lineTo(x, y + h * 0.5);
  c.lineTo(x + w * 0.25, y + h);
  c.stroke();
};

// mxShapeSysMLPortThree: 本体と 3 つの小さな四角 (入・出・入出の矢印)
const port3: ShapePainter = (c, w, h) => {
  R(c, w * 0.07, 0, w * 0.86, h);
  R(c, 0, h * 0.125, w * 0.14, h * 0.25);
  R(c, 0, h * 0.625, w * 0.14, h * 0.25);
  R(c, w * 0.86, h * 0.375, w * 0.14, h * 0.25);
  arrowRight(c, w * 0.01, h * 0.2, w * 0.11, h * 0.1);
  arrowLeft(c, w * 0.02, h * 0.7, w * 0.11, h * 0.1);
  arrowInOut(c, w * 0.88, h * 0.45, w * 0.1, h * 0.1);
};

// mxShapeSysMLItemFlow: 辺 (flowDir: n・s・e・w) に 20 の四角を付けた四角。flowType (in・out) で矢印の向き
const itemFlow: ShapePainter = (c, w, h, e) => {
  const flowDir = e.str('flowDir', 'none').toLowerCase();
  const flowType = e.str('flowType', 'none');
  if (flowDir === 'n') {
    R(c, 0, 10, w, h - 10);
    R(c, w * 0.5 - 10, 0, 20, 20);
    if (flowType === 'in') arrowDown(c, w * 0.5 - 5, 2, 10, 16);
    else if (flowType === 'out') arrowUp(c, w * 0.5 - 5, 2, 10, 16);
  } else if (flowDir === 's') {
    R(c, 0, 0, w, h - 10);
    R(c, w * 0.5 - 10, h - 20, 20, 20);
    if (flowType === 'in') arrowUp(c, w * 0.5 - 5, h - 18, 10, 16);
    else if (flowType === 'out') arrowDown(c, w * 0.5 - 5, h - 18, 10, 16);
  } else if (flowDir === 'w') {
    R(c, 10, 0, w - 10, h);
    R(c, 0, h * 0.5 - 10, 20, 20);
    if (flowType === 'in') arrowRight(c, 2, h * 0.5 - 5, 16, 10);
    else if (flowType === 'out') arrowLeft(c, 2, h * 0.5 - 5, 16, 10);
  } else if (flowDir === 'e') {
    R(c, 0, 0, w - 10, h);
    R(c, w - 20, h * 0.5 - 10, 20, 20);
    if (flowType === 'in') arrowLeft(c, w - 18, h * 0.5 - 5, 16, 10);
    else if (flowType === 'out') arrowRight(c, w - 18, h * 0.5 - 5, 16, 10);
  }
};

// mxShapeSysMLItemFlowLeft・ItemFlowRight: 左・右の辺に 3 つの四角
const itemFlowLeft: ShapePainter = (c, w, h) => {
  R(c, 10, 0, w - 10, h);
  for (const k of [0.25, 0.5, 0.75]) R(c, 0, h * k - 10, 20, 20);
};
const itemFlowRight: ShapePainter = (c, w, h) => {
  R(c, 0, 0, w - 10, h);
  for (const k of [0.25, 0.5, 0.75]) R(c, w - 20, h * k - 10, 20, 20);
};

// mxShapeSysMLNestedPort: 入れ子の端子
const nestedPort: ShapePainter = (c, w, h) => {
  R(c, w * 0.08, 0, w * 0.92, h);
  R(c, w * 0.03, h * 0.1, w * 0.1, h * 0.8);
  R(c, 0, h * 0.15, w * 0.06, h * 0.16);
  R(c, 0, h * 0.42, w * 0.06, h * 0.16);
  R(c, 0, h * 0.69, w * 0.06, h * 0.16);
};

// mxShapeSysMLParametricDiagram: 角の丸い四角と、高さ 60 を超えれば左の辺の 2 つの四角 (線だけ)
const paramDgm: ShapePainter = (c, w, h) => {
  c.roundrect(0, 0, w, h, 10, 10);
  c.fillAndStroke();
  if (h > 60) {
    c.rect(0, h * 0.25 - 10, 20, 20);
    c.stroke();
    c.rect(0, h * 0.75 - 10, 20, 20);
    c.stroke();
  }
};

// mxShapeSysMLConstraintProperty: 四角と、高さ 60 を超えれば左の 2 つの四角 (上から 50・80)
const consProp: ShapePainter = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  if (h > 60) {
    c.rect(0, 50, 20, 20);
    c.stroke();
    c.rect(0, 80, 20, 20);
    c.stroke();
  }
};

// mxShapeSysMLCallBehaviorAction: 角の丸い四角と、右下の熊手の記号 (drawSymb)
const callBehAct: ShapePainter = (c, w, h) => {
  c.roundrect(0, 0, w, h, 10, 10);
  c.fillAndStroke();
  if (h > 30 && w > 40) {
    const x = w - 30;
    const y = h - 30;
    c.begin();
    c.moveTo(x + 10, y);
    c.lineTo(x + 10, y + 20);
    c.moveTo(x, y + 20);
    c.lineTo(x, y + 10);
    c.lineTo(x + 20, y + 10);
    c.lineTo(x + 20, y + 20);
    c.stroke();
  }
};

// mxShapeSysMLAcceptEventAction: 左がえぐれた五角形
const accEvent: ShapePainter = (c, w, h) =>
  poly(c, [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
    [h * 0.3, h * 0.5],
  ]);

// mxShapeSysMLTimeEvent: 砂時計
const timeEvent: ShapePainter = (c, w, h) =>
  poly(c, [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]);

// mxShapeSysMLSendSignalAction: 右が尖った五角形
const sendSigAct: ShapePainter = (c, w, h) =>
  poly(c, [
    [0, 0],
    [w - h * 0.3, 0],
    [w, h * 0.5],
    [w - h * 0.3, h],
    [0, h],
  ]);

// mxShapeSysMLActivityFinal: 円と、5 内側の線の色で塗った円
const actFinal: ShapePainter = (c, w, h, e) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.setFillColor(e.color('strokeColor', '#000000'));
  c.ellipse(5, 5, w - 10, h - 10);
  c.fillAndStroke();
};

// mxShapeSysMLActivityParameterNode: 左右の括弧の線・左上の見出し・3 つの四角
const actParamNode: ShapePainter = (c, w, h) => {
  const minX = Math.max(w * 0.35, 70);
  const maxX = Math.min(w * 0.65, w - 10);
  c.begin();
  c.moveTo(minX, h);
  c.lineTo(10, h);
  c.lineTo(10, 0);
  c.lineTo(minX, 0);
  c.moveTo(maxX, h);
  c.lineTo(w - 10, h);
  c.lineTo(w - 10, 0);
  c.lineTo(maxX, 0);
  c.stroke();
  tabHeader(c, w, 10, 50, true);
  R(c, 0, h * 0.35 - 10, 20, 20);
  R(c, 0, h * 0.65 - 10, 20, 20);
  R(c, w - 20, h * 0.5 - 10, 20, 20);
};

// mxShapeSysMLControlOperator: 四角と、左上の見出し (幅 130) の線
const contOper: ShapePainter = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  tabHeader(c, w, 0, 130, false);
};

// mxShapeSysMLFlowFinal: 円と × の線
const flowFinal: ShapePainter = (c, w, h) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.145, h * 0.145);
  c.lineTo(w * 0.855, h * 0.855);
  c.moveTo(w * 0.855, h * 0.145);
  c.lineTo(w * 0.145, h * 0.855);
  c.stroke();
};

// mxShapeSysMLIsControl: 角の丸い四角の左右に小さな四角
const isControl: ShapePainter = (c, w, h) => {
  R(c, 0, h * 0.5 - 10, 10, 20);
  c.roundrect(10, 0, w - 20, h, 10, 10);
  c.fillAndStroke();
  R(c, w - 10, h * 0.5 - 10, 10, 20);
};

// mxShapeSysMLIsStream: isControl の左右の四角を線の色で塗る
const isStream: ShapePainter = (c, w, h, e) => {
  const strokeColor = e.color('strokeColor', '#000000');
  const fillColor = e.color('fillColor', '#ffffff');
  c.setFillColor(strokeColor);
  R(c, 0, h * 0.5 - 10, 10, 20);
  c.setFillColor(fillColor);
  c.roundrect(10, 0, w - 20, h, 10, 10);
  c.fillAndStroke();
  c.setFillColor(strokeColor);
  R(c, w - 10, h * 0.5 - 10, 10, 20);
};

// mxShapeSysMLIsActStream: 四角・左上の見出し (幅 40)・右の四角
const isActStream: ShapePainter = (c, w, h) => {
  R(c, 0, 0, w - 10, h);
  tabHeader(c, w, 0, 40, true);
  R(c, w - 20, h * 0.5 - 10, 20, 20);
};

// mxShapeSysMLParameterSet: 角の丸い四角の左右に、縦長の四角と 2 つずつの小さな四角
const paramSet: ShapePainter = (c, w, h) => {
  R(c, 0, h * 0.5 - 28, 10, 56);
  c.roundrect(10, 0, w - 20, h, 10, 10);
  c.fillAndStroke();
  R(c, w - 10, h * 0.5 - 28, 10, 56);
  R(c, 4, h * 0.5 - 24, 6, 20);
  R(c, 4, h * 0.5 + 4, 6, 20);
  R(c, w - 10, h * 0.5 - 24, 6, 20);
  R(c, w - 10, h * 0.5 + 4, 6, 20);
};

// mxShapeSysMLParameterActivitySet: 四角・見出し (幅 50)・高さ 70 を超えれば左右の四角の組
const paramActSet: ShapePainter = (c, w, h) => {
  R(c, 10, 0, w - 20, h);
  tabHeader(c, w, 10, 50, true);
  if (h > 70) {
    R(c, 0, h * 0.5 - 28, 15, 56);
    R(c, 4, h * 0.5 - 24, 15, 20);
    R(c, 4, h * 0.5 + 4, 15, 20);
    R(c, w - 15, h * 0.5 - 28, 15, 56);
    R(c, w - 19, h * 0.5 - 24, 15, 20);
    R(c, w - 19, h * 0.5 + 4, 15, 20);
  }
};

// mxShapeSysMLProbability: 角の丸い四角の右に、2 組の四角
const probability: ShapePainter = (c, w, h) => {
  c.roundrect(0, 0, w - 10, h, 10, 10);
  c.fillAndStroke();
  R(c, w - 10, h * 0.25 - 28, 10, 56);
  R(c, w - 10, h * 0.75 - 28, 10, 56);
  R(c, w - 10, h * 0.25 - 24, 6, 20);
  R(c, w - 10, h * 0.25 + 4, 6, 20);
  R(c, w - 10, h * 0.75 - 24, 6, 20);
  R(c, w - 10, h * 0.75 + 4, 6, 20);
};

// mxShapeSysMLActivityProbability: 四角・見出し (幅 40)・高さ 70 を超えれば右の 2 組の四角
const actProb: ShapePainter = (c, w, h) => {
  R(c, 0, 0, w - 10, h);
  tabHeader(c, w, 0, 40, true);
  if (h > 70) {
    for (const k of [0.25, 0.75]) {
      R(c, w - 15, h * k - 28, 15, 56);
      R(c, w - 19, h * k - 24, 15, 20);
      R(c, w - 19, h * k + 4, 15, 20);
    }
  }
};

// mxShapeSysMLObjectFlowRight・ObjectFlowLeft: 角の丸い四角と、右・左の小さな四角
const objFlowR: ShapePainter = (c, w, h) => {
  c.roundrect(0, 0, w - 10, h, 10, 10);
  c.fillAndStroke();
  R(c, w - 10, h * 0.5 - 10, 10, 20);
};
const objFlowL: ShapePainter = (c, w, h) => {
  R(c, 0, h * 0.5 - 10, 10, 20);
  c.roundrect(10, 0, w - 10, h, 10, 10);
  c.fillAndStroke();
};

// mxShapeSysMLActivityPartition: 左右の縦の線
const actPart: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(0, h);
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.stroke();
};

// mxShapeSysMLContinuation: 両端が半円の形 (長い向きに)
const cont: ShapePainter = (c, w, h) => {
  c.begin();
  if (w > h) {
    const r = h * 0.5;
    c.moveTo(w - r, 0);
    c.arcTo(r, r, 0, 0, 1, w - r, h);
    c.lineTo(r, h);
    c.arcTo(r, r, 0, 0, 1, r, 0);
  } else {
    const r = w * 0.5;
    c.moveTo(0, h - r);
    c.arcTo(r, r, 0, 0, 0, w, h - r);
    c.lineTo(w, r);
    c.arcTo(r, r, 0, 0, 0, 0, r);
  }
  c.close();
  c.fillAndStroke();
};

// mxShapeSysMLCoregion: 上下の角括弧 (深さ 10)
const coregion: ShapePainter = (c, w, h) => {
  const brack = Math.min(10, h);
  c.begin();
  c.moveTo(0, brack);
  c.lineTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, brack);
  c.moveTo(0, h - brack);
  c.lineTo(0, h);
  c.lineTo(w, h);
  c.lineTo(w, h - brack);
  c.stroke();
};

// mxShapeSysMLDimension: 寸法線 (上から 20 の両矢印と、左右の縦の線)
const dimension: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 20);
  c.lineTo(w, 20);
  c.moveTo(10, 15);
  c.lineTo(0, 20);
  c.lineTo(10, 25);
  c.moveTo(w - 10, 15);
  c.lineTo(w, 20);
  c.lineTo(w - 10, 25);
  c.moveTo(0, 15);
  c.lineTo(0, h);
  c.moveTo(w, 15);
  c.lineTo(w, h);
  c.stroke();
};

// mxShapeSysMLCompositeState: 角の丸い四角と、上の札 (幅 110・高さ 20)
const compState: ShapePainter = (c, w, h) => {
  c.roundrect(0, 20, w, h - 20, 10, 10);
  c.fillAndStroke();
  R(c, 15, 0, 110, 20);
};

// mxShapeSysMLRegion: 角の丸い四角・太い線 (strokeWidth の整数の部分の 2 倍) の札・真ん中の破線
const region: ShapePainter = (c, w, h, e) => {
  const tabH = 20;
  const tabW = 50;
  const strokeW = parseInt(e.str('strokeWidth', '1'), 10);
  c.roundrect(0, tabH, w, h - tabH, 10, 10);
  c.fillAndStroke();
  c.setStrokeWidth(strokeW * 2);
  R(c, 15, 0, tabW, tabH);
  c.setStrokeWidth(strokeW);
  c.setDashed(true);
  c.begin();
  c.moveTo(w * 0.5, tabH);
  c.lineTo(w * 0.5, h);
  c.stroke();
};

// mxShapeSysMLSimpleState: 角の丸い四角 (foreground の線は、ソースでは呼ばない)
const simpleState: ShapePainter = (c, w, h) => {
  c.roundrect(0, 0, w, h, 10, 10);
  c.fillAndStroke();
};

// mxShapeSysMLStateMachine・SubmachineState: 角の丸い四角と、右の辺の二重丸 (内は線の色で塗る)
const stateMachine: ShapePainter = (c, w, h, e) => {
  c.roundrect(0, 0, w - 10, h, 10, 10);
  c.fillAndStroke();
  c.setFillColor(e.color('strokeColor', '#000000'));
  c.ellipse(w - 20, h * 0.5 - 10, 20, 20);
  c.stroke();
  c.ellipse(w - 17, h * 0.5 - 7, 14, 14);
  c.fillAndStroke();
};

// mxShapeSysMLX: × (開いた経路を fillAndStroke。ソースのとおり)
const sysX: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, h);
  c.moveTo(0, h);
  c.lineTo(w, 0);
  c.fillAndStroke();
};

// mxShapeSysMLUseCaseExtensionPoints: 楕円と、高さ 35 % の横の線
const useCaseExtPt: ShapePainter = (c, w, h) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.02, h * 0.35);
  c.lineTo(w * 0.98, h * 0.35);
  c.stroke();
};

// mxShapeSysMLPort: 四角と、種類 (sysMLPortType: flowN・flowE・flowS・flowW・doubleH・doubleV) の矢印
const PORT_LINES: Record<string, number[][]> = {
  // [移動, 線, 線, 移動, 線 (, 線)] の順の点 (幅・高さの割合)
  flowN: [[0.25, 0.5], [0.5, 0.25], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]],
  flowE: [[0.5, 0.25], [0.75, 0.5], [0.5, 0.75], [0.75, 0.5], [0.25, 0.5]],
  flowS: [[0.25, 0.5], [0.5, 0.75], [0.75, 0.5], [0.5, 0.75], [0.5, 0.25]],
  flowW: [[0.5, 0.25], [0.25, 0.5], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]],
  doubleH: [[0.6, 0.25], [0.85, 0.5], [0.6, 0.75], [0.4, 0.25], [0.15, 0.5], [0.4, 0.75]],
  doubleV: [[0.25, 0.6], [0.5, 0.85], [0.75, 0.6], [0.25, 0.4], [0.5, 0.15], [0.75, 0.4]],
};
const sysPort: ShapePainter = (c, w, h, e) => {
  R(c, 0, 0, w, h);
  const type = e.str('sysMLPortType', 'empty');
  if (!Object.hasOwn(PORT_LINES, type)) return;
  const pts = PORT_LINES[type];
  c.begin();
  pts.forEach(([x, y], i) => (i === 0 || i === 3 ? c.moveTo(x * w, y * h) : c.lineTo(x * w, y * h)));
  c.stroke();
};

/** 基本の形と SysML の形 (形の名前 → 描き方) */
export const SHAPES_BASIC: Record<string, ShapePainter> = {
  'mxgraph.basic.cross2': cross2,
  'mxgraph.basic.rectCallout': rectCallout,
  'mxgraph.basic.roundRectCallout': roundRectCallout,
  'mxgraph.basic.wave2': wave2,
  'mxgraph.basic.octagon2': octagon2,
  'mxgraph.basic.isocube': isocube,
  'mxgraph.basic.acute_triangle': acuteTriangle,
  'mxgraph.basic.obtuse_triangle': obtuseTriangle,
  'mxgraph.basic.drop': drop,
  'mxgraph.basic.cone2': cone2,
  'mxgraph.basic.pyramid': pyramid,
  'mxgraph.basic.4_point_star_2': fourPointStar2,
  'mxgraph.basic.diag_snip_rect': diagSnipRect,
  'mxgraph.basic.diag_round_rect': diagRoundRect,
  'mxgraph.basic.corner_round_rect': cornerRoundRect,
  'mxgraph.basic.plaque': plaque,
  'mxgraph.basic.frame': frame,
  'mxgraph.basic.plaque_frame': plaqueFrame,
  'mxgraph.basic.rounded_frame': roundedFrame,
  'mxgraph.basic.frame_corner': frameCorner,
  'mxgraph.basic.diag_stripe': diagStripe,
  'mxgraph.basic.donut': donut,
  'mxgraph.basic.layered_rect': layeredRect,
  'mxgraph.basic.button': button,
  'mxgraph.basic.shaded_button': shadedButton,
  'mxgraph.basic.pie': pie,
  'mxgraph.basic.arc': arc,
  'mxgraph.basic.partConcEllipse': partConcEllipse,
  'mxgraph.basic.numberedEntryVert': numberedEntryVert,
  'mxgraph.basic.bendingArch': bendingArch,
  'mxgraph.basic.three_corner_round_rect': threeCornerRoundRect,
  'mxgraph.basic.polygon': polygon,
  'mxgraph.basic.patternFillRect': patternFillRect,
  'mxgraph.basic.rect': rect2,
  'mxgraph.sysml.composite': composite,
  'mxgraph.sysml.package': sysPackage,
  'mxgraph.sysml.package2': sysPackage2,
  'mxgraph.sysml.none': sysNone,
  'mxgraph.sysml.rect': sysRect,
  'mxgraph.sysml.port1': port1,
  'mxgraph.sysml.port2': port2,
  'mxgraph.sysml.port3': port3,
  'mxgraph.sysml.port4': port4,
  'mxgraph.sysml.itemFlow': itemFlow,
  'mxgraph.sysml.itemFlowLeft': itemFlowLeft,
  'mxgraph.sysml.itemFlowRight': itemFlowRight,
  'mxgraph.sysml.nestedPort': nestedPort,
  'mxgraph.sysml.paramDgm': paramDgm,
  'mxgraph.sysml.consProp': consProp,
  'mxgraph.sysml.callBehAct': callBehAct,
  'mxgraph.sysml.accEvent': accEvent,
  'mxgraph.sysml.timeEvent': timeEvent,
  'mxgraph.sysml.sendSigAct': sendSigAct,
  'mxgraph.sysml.actFinal': actFinal,
  'mxgraph.sysml.actParamNode': actParamNode,
  'mxgraph.sysml.contOper': contOper,
  'mxgraph.sysml.flowFinal': flowFinal,
  'mxgraph.sysml.isControl': isControl,
  'mxgraph.sysml.isStream': isStream,
  'mxgraph.sysml.isActStream': isActStream,
  'mxgraph.sysml.paramSet': paramSet,
  'mxgraph.sysml.paramActSet': paramActSet,
  'mxgraph.sysml.probability': probability,
  'mxgraph.sysml.actProb': actProb,
  'mxgraph.sysml.objFlowR': objFlowR,
  'mxgraph.sysml.objFlowL': objFlowL,
  'mxgraph.sysml.actPart': actPart,
  'mxgraph.sysml.cont': cont,
  'mxgraph.sysml.coregion': coregion,
  'mxgraph.sysml.dimension': dimension,
  'mxgraph.sysml.compState': compState,
  'mxgraph.sysml.region': region,
  'mxgraph.sysml.simpleState': simpleState,
  'mxgraph.sysml.stateMachine': stateMachine,
  'mxgraph.sysml.x': sysX,
  'mxgraph.sysml.submState': stateMachine,
  'mxgraph.sysml.useCaseExtPt': useCaseExtPt,
  'mxgraph.sysml.port': sysPort,
};
