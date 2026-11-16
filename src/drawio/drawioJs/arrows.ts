/**
 * drawioJs/arrows — draw.io の矢印 (arrows2)・インフォグラフィック・EIP・Kubernetes・キャビネットの形を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/ の mxArrows.js・mxInfographic.js・mxEip.js・mxKubernetes.js・
 * mxCabinets.js の各形の paintVertexShape・background・foreground と、コンストラクタの既定の値 (this.dx など。mxUtils.getValue の既定に使われる)。
 * スタイルの値の読み方は mxGraph の mxStylesheet.getCellStyle (数に読める値は数にする。none は無いものとする) と mxUtils.getValue。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移し、向き・反転を済ませるので、ソースの paintVertexShape(c, x, y, w, h) の x・y は 0 として書く。
 * 文字の置き場 (getLabelBounds)・接続点 (getConstraints)・ハンドル・影は移植しない。
 * mxSvgCanvas2D の rect・ellipse は新しい要素を作る (それまでの経路を捨てる) ので、経路を始めずに呼ぶところは begin を足して同じにする
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/shape/mxArrow.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxCellRenderer.js: Copyright (c) 2006-2017, JGraph Holdings Ltd; Copyright (c) 2006-2017, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxStylesheet.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxArrows.js: Copyright (c) 2006-2016, JGraph Ltd
 *   shapes/mxCabinets.js: Copyright (c) 2006-2014, JGraph Ltd
 *   shapes/mxEip.js: Copyright (c) 2006-2015, JGraph Ltd
 *   shapes/mxInfographic.js: Copyright (c) 2006-2018, JGraph Ltd
 *   shapes/mxKubernetes.js: Copyright (c) 2006-2020, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { Pt, ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';

/** 線の形 (mxArrow 派生の paintEdgeShape) の描き方: 経路の点 (ページの座標) を受ける */
export type EdgePainter = (c: ShapeCanvas, pts: Pt[], e: ShapeEnv) => void;

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v));

/** 点の列を moveTo・lineTo でつなぎ、閉じる */
const poly = (c: ShapeCanvas, pts: number[][]) => {
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.close();
};

/** 1 つの多角形を塗って線を引く (begin・…・close・fillAndStroke) */
const polyShape = (c: ShapeCanvas, pts: number[][]) => {
  c.begin();
  poly(c, pts);
  c.fillAndStroke();
};

/**
 * mxUtils.getValue(style, k, false) を JavaScript の真偽で読む: 数に読める値は 0 以外なら真、ほかの空でない文字は真 (mxStylesheet が数を数にする)
 */
const truthy = (e: ShapeEnv, k: string) => {
  const v = e.str(k, '');
  if (v === '') return false;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
};

/** スタイルの値が数の 1 か (== 1・=== 1 の比べ。mxStylesheet が数に読んだ値だけ 1 になる) */
const isOne = (e: ShapeEnv, k: string) => {
  const v = e.str(k, '');
  return v.trim() !== '' && Number(v) === 1;
};

// ───────────── 矢印 (mxArrows.js) ─────────────

/** mxShapeArrows2Arrow (既定 dx 0.5・dy 0.5・notch 0)。headCrossline・tailCrossline は矢の頭・尾の横線 */
const arrow: ShapePainter = (c, w, h, e) => {
  const dy = h * 0.5 * clamp(0, 1, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  polyShape(c, [[0, dy], [w - dx, dy], [w - dx, 0], [w, h * 0.5], [w - dx, h], [w - dx, h - dy], [0, h - dy], [notch, h * 0.5]]);
  c.setShadow(false);
  if (truthy(e, 'headCrossline')) {
    c.begin();
    c.moveTo(w - dx, dy);
    c.lineTo(w - dx, h - dy);
    c.stroke();
  }
  if (truthy(e, 'tailCrossline')) {
    c.begin();
    c.moveTo(notch, dy);
    c.lineTo(notch, h - dy);
    c.stroke();
  }
};

/** mxShapeArrows2TwoWayArrow (既定 dx 0.5・dy 0.5) */
const twoWayArrow: ShapePainter = (c, w, h, e) => {
  const dy = h * 0.5 * clamp(0, 1, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  polyShape(c, [[dx, dy], [w - dx, dy], [w - dx, 0], [w, h * 0.5], [w - dx, h], [w - dx, h - dy], [dx, h - dy], [dx, h], [0, h * 0.5], [dx, 0]]);
};

/** mxShapeArrows2StylisedArrow (既定 dx 0.5・dy 0.5・notch 0・feather 0.5) */
const stylisedArrow: ShapePainter = (c, w, h, e) => {
  const dy = h * 0.5 * clamp(0, 1, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  const feather = h * 0.5 * clamp(0, 1, e.num('feather', 0.5));
  polyShape(c, [[0, feather], [w - dx, dy], [w - dx - 10, 0], [w, h * 0.5], [w - dx - 10, h], [w - dx, h - dy], [0, h - feather], [notch, h * 0.5]]);
};

/** mxShapeArrows2SharpArrow (既定 dx1 0.5・dy1 0.5・dx2 0.5・notch 0。dy1a はソースのとおり h で抑える) */
const sharpArrow: ShapePainter = (c, w, h, e) => {
  const dy1 = h * 0.5 * clamp(0, 1, e.num('dy1', 0.5));
  const dx1 = clamp(0, w, e.num('dx1', 0.5));
  const dx2 = clamp(0, w, e.num('dx2', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  const dx1a = clamp(0, w, e.num('dx1', 0.5));
  const dy1a = h * 0.5 * clamp(0, h, e.num('dy1', 0.5));
  const x2 = h !== 0 ? dx1a + (dx2 * dy1a * 2) / h : 0;
  polyShape(c, [[0, dy1], [w - dx1, dy1], [w - x2, 0], [w - dx2, 0], [w, h * 0.5], [w - dx2, h], [w - x2, h], [w - dx1, h - dy1], [0, h - dy1], [notch, h * 0.5]]);
};

/** mxShapeArrows2SharpArrow2 (既定 dx1・dy1・dx2・dx3・dy3 は 0.5、notch 0) */
const sharpArrow2: ShapePainter = (c, w, h, e) => {
  const dy1 = h * 0.5 * clamp(0, 1, e.num('dy1', 0.5));
  const dx1 = clamp(0, w, e.num('dx1', 0.5));
  const dx2 = clamp(0, w, e.num('dx2', 0.5));
  const dy3 = h * 0.5 * clamp(0, 1, e.num('dy3', 0.5));
  const dx3 = clamp(0, w, e.num('dx3', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  polyShape(c, [[0, dy1], [w - dx1, dy1], [w - dx3, dy3], [w - dx2, 0], [w, h * 0.5], [w - dx2, h], [w - dx3, h - dy3], [w - dx1, h - dy1], [0, h - dy1], [notch, h * 0.5]]);
};

/** mxShapeArrows2CalloutArrow (既定 dx 0.5・dy 0.5・notch 0・arrowHead 0) */
const calloutArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const m = h * 0.5;
  polyShape(c, [[0, 0], [notch, 0], [notch, m - dy], [w - dx, m - dy], [w - dx, m - dy - ah], [w, m], [w - dx, m + dy + ah], [w - dx, m + dy], [notch, m + dy], [notch, h], [0, h]]);
};

/** mxShapeArrows2BendArrow (既定 dx 0.5・dy 0.5・notch 0・arrowHead 40。rounded=1 なら内と外の角を円弧に) */
const bendArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, h, e.num('notch', 0));
  const ah = clamp(0, h, e.num('arrowHead', 40));
  const rounded = isOne(e, 'rounded');
  c.begin();
  c.moveTo(w - dx, 0);
  c.lineTo(w, ah * 0.5);
  c.lineTo(w - dx, ah);
  c.lineTo(w - dx, ah / 2 + dy);
  if (rounded) {
    c.lineTo(dy * 2.2, ah / 2 + dy);
    c.arcTo(dy * 0.2, dy * 0.2, 0, 0, 0, dy * 2, ah / 2 + dy * 1.2);
  } else c.lineTo(dy * 2, ah / 2 + dy);
  c.lineTo(dy * 2, h);
  c.lineTo(dy, h - notch);
  c.lineTo(0, h);
  if (rounded) {
    c.lineTo(0, ah / 2 + dy);
    c.arcTo(dy * 2, dy * 2, 0, 0, 1, dy * 2, ah / 2 - dy);
  } else c.lineTo(0, ah / 2 - dy);
  c.lineTo(w - dx, ah / 2 - dy);
  c.close();
  c.fillAndStroke();
};

/** mxShapeArrows2BendDoubleArrow (既定 dx 0.5・dy 0.5・arrowHead 40。arrowHead はソースのとおり w で抑える) */
const bendDoubleArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const ah = clamp(0, w, e.num('arrowHead', 40));
  const rounded = isOne(e, 'rounded');
  c.begin();
  c.moveTo(w - dx, 0);
  c.lineTo(w, ah * 0.5);
  c.lineTo(w - dx, ah);
  c.lineTo(w - dx, ah / 2 + dy);
  if (rounded) {
    c.lineTo(ah / 2 + dy * 1.2, ah / 2 + dy);
    c.arcTo(dy * 0.2, dy * 0.2, 0, 0, 0, ah / 2 + dy, ah / 2 + dy * 1.2);
  } else c.lineTo(ah / 2 + dy, ah / 2 + dy);
  c.lineTo(ah / 2 + dy, h - dx);
  c.lineTo(ah, h - dx);
  c.lineTo(ah / 2, h);
  c.lineTo(0, h - dx);
  c.lineTo(ah / 2 - dy, h - dx);
  if (rounded) {
    c.lineTo(ah / 2 - dy, ah / 2 + dy);
    c.arcTo(dy * 2, dy * 2, 0, 0, 1, ah / 2 + dy, ah / 2 - dy);
  } else c.lineTo(ah / 2 - dy, ah / 2 - dy);
  c.lineTo(w - dx, ah / 2 - dy);
  c.close();
  c.fillAndStroke();
};

/** mxShapeArrows2CalloutDoubleArrow (既定 dx 0.5・dy 0.5・notch 0・arrowHead 0) */
const calloutDoubleArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const m = h * 0.5;
  const cx = w / 2;
  polyShape(c, [
    [cx - notch, 0], [cx + notch, 0], [cx + notch, m - dy], [w - dx, m - dy], [w - dx, m - dy - ah], [w, m], [w - dx, m + dy + ah], [w - dx, m + dy], [cx + notch, m + dy],
    [cx + notch, h], [cx - notch, h], [cx - notch, m + dy], [dx, m + dy], [dx, m + dy + ah], [0, m], [dx, m - dy - ah], [dx, m - dy], [cx - notch, m - dy],
  ]);
};

/** mxShapeArrows2CalloutQuadArrow (既定 dx 0.5・dy 0.5・notch 0・arrowHead 0) */
const calloutQuadArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const cx = w * 0.5;
  const cy = h * 0.5;
  polyShape(c, [
    [cx + dy, cy - notch], [cx + notch, cy - notch], [cx + notch, cy - dy], [w - dx, cy - dy], [w - dx, cy - dy - ah], [w, cy], [w - dx, cy + dy + ah], [w - dx, cy + dy],
    [cx + notch, cy + dy], [cx + notch, cy + notch], [cx + dy, cy + notch], [cx + dy, h - dx], [cx + dy + ah, h - dx], [cx, h], [cx - dy - ah, h - dx], [cx - dy, h - dx],
    [cx - dy, cy + notch], [cx - notch, cy + notch], [cx - notch, cy + dy], [dx, cy + dy], [dx, cy + dy + ah], [0, cy], [dx, cy - dy - ah], [dx, cy - dy], [cx - notch, cy - dy],
    [cx - notch, cy - notch], [cx - dy, cy - notch], [cx - dy, dx], [cx - dy - ah, dx], [cx, 0], [cx + dy + ah, dx], [cx + dy, dx],
  ]);
};

/** mxShapeArrows2CalloutDouble90Arrow (既定 dx1 0.5・dy1 0.5・dx2 0・dy2 0・arrowHead 0。dy2 はソースのとおり w で抑える) */
const calloutDouble90Arrow: ShapePainter = (c, w, h, e) => {
  const dy1 = clamp(0, h, e.num('dy1', 0.5));
  const dx1 = clamp(0, w, e.num('dx1', 0.5));
  const dx2 = clamp(0, w, e.num('dx2', 0));
  const dy2 = clamp(0, w, e.num('dy2', 0));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const m = dy2 * 0.5;
  polyShape(c, [
    [0, 0], [dx2, 0], [dx2, m - dy1], [w - dx1, m - dy1], [w - dx1, m - dy1 - ah], [w, m], [w - dx1, m + dy1 + ah], [w - dx1, m + dy1], [dx2, m + dy1], [dx2, dy2],
    [dx2 / 2 + dy1, dy2], [dx2 / 2 + dy1, h - dx1], [dx2 / 2 + dy1 + ah, h - dx1], [dx2 / 2, h], [dx2 / 2 - dy1 - ah, h - dx1], [dx2 / 2 - dy1, h - dx1], [dx2 / 2 - dy1, dy2], [0, dy2],
  ]);
};

/** mxShapeArrows2QuadArrow (既定 dx 0.5・dy 0.5・arrowHead 0) */
const quadArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const cx = w * 0.5;
  const cy = h * 0.5;
  polyShape(c, [
    [cx + dy, cy - dy], [w - dx, cy - dy], [w - dx, cy - dy - ah], [w, cy], [w - dx, cy + dy + ah], [w - dx, cy + dy], [cx + dy, cy + dy], [cx + dy, h - dx], [cx + dy + ah, h - dx],
    [cx, h], [cx - dy - ah, h - dx], [cx - dy, h - dx], [cx - dy, cy + dy], [dx, cy + dy], [dx, cy + dy + ah], [0, cy], [dx, cy - dy - ah], [dx, cy - dy], [cx - dy, cy - dy],
    [cx - dy, dx], [cx - dy - ah, dx], [cx, 0], [cx + dy + ah, dx], [cx + dy, dx],
  ]);
};

/** mxShapeArrows2TriadArrow (既定 dx 0.5・dy 0.5・arrowHead 0) */
const triadArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const ah = clamp(0, h, e.num('arrowHead', 0));
  const cx = w * 0.5;
  polyShape(c, [
    [cx + ah * 0.5 - dy, h - ah + dy], [w - dx, h - ah + dy], [w - dx, h - ah], [w, h - ah * 0.5], [w - dx, h], [w - dx, h - dy], [dx, h - dy], [dx, h], [0, h - ah * 0.5], [dx, h - ah],
    [dx, h - ah + dy], [cx - ah * 0.5 + dy, h - ah + dy], [cx - ah * 0.5 + dy, dx], [cx - ah * 0.5, dx], [cx, 0], [cx + ah * 0.5, dx], [cx + ah * 0.5 - dy, dx],
  ]);
};

/**
 * mxShapeArrows2TailedArrow・TailedNotchedArrow (既定 notch 0・arrowHead 0)。尾の斜めの辺の x2 の求め方だけが違う。
 * v24.7.5 のコンストラクタは dx1・dy1・dx2・dy2 の既定を持たない (this.dx1 などが undefined) ので、style に無いキーは NaN になる
 * (customProperties の defVal の 20・10・25・30 は、編集の画面の既定で、描き方には使われない)。
 * NaN の座標の点から先は、SVG の経路の誤りになり、誤りの手前までを描く (SVG 1.1 の F.2。閉じる Z にも届かない) ので、ここでもそこまでで止める
 */
const tailedArrow =
  (notched: boolean): ShapePainter =>
  (c, w, h, e) => {
    const dy1 = clamp(0, h, e.num('dy1', NaN));
    const dx1 = clamp(0, w, e.num('dx1', NaN));
    const dy2 = clamp(0, h, e.num('dy2', NaN));
    const dx2 = clamp(0, w, e.num('dx2', NaN));
    const notch = clamp(0, w, e.num('notch', 0));
    const ah = clamp(0, h, e.num('arrowHead', 0));
    // dy2 != 0 は NaN でも真 (x2 も NaN)
    const x2 = dy2 !== 0 ? dx2 + ((notched ? notch : dy2) * (dy2 - dy1)) / dy2 : 0;
    const m = h * 0.5;
    const pts = [[0, m - dy2], [dx2, m - dy2], [x2, m - dy1], [w - dx1, m - dy1], [w - dx1, m - dy1 - ah], [w, m], [w - dx1, m + dy1 + ah], [w - dx1, m + dy1], [x2, m + dy1], [dx2, m + dy2], [0, m + dy2], [notch, m]];
    const k = pts.findIndex((p) => Number.isNaN(p[0]) || Number.isNaN(p[1]));
    if (k < 0) {
      polyShape(c, pts);
      return;
    }
    // 始めの点だけ (k が 0・1) なら、何も見えない
    if (k < 2) return;
    c.begin();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < k; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.fillAndStroke();
  };

/** mxShapeArrows2StripedArrow (既定 dx 0.5・dy 0.5・notch 0): 矢と、尾の 2 本の縞 */
const stripedArrow: ShapePainter = (c, w, h, e) => {
  const dy = h * 0.5 * clamp(0, 1, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const notch = clamp(0, w, e.num('notch', 0));
  c.begin();
  poly(c, [[notch, dy], [w - dx, dy], [w - dx, 0], [w, h * 0.5], [w - dx, h], [w - dx, h - dy], [notch, h - dy]]);
  poly(c, [[0, h - dy], [notch * 0.16, h - dy], [notch * 0.16, dy], [0, dy]]);
  poly(c, [[notch * 0.32, h - dy], [notch * 0.8, h - dy], [notch * 0.8, dy], [notch * 0.32, dy]]);
  c.fillAndStroke();
};

/** mxShapeArrows2JumpInArrow (既定 dx 0.5・dy 0.5・arrowHead 40) */
const jumpInArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const dx = clamp(0, w, e.num('dx', 0.5));
  const ah = clamp(0, h, e.num('arrowHead', 40));
  c.begin();
  c.moveTo(w - dx, 0);
  c.lineTo(w, ah * 0.5);
  c.lineTo(w - dx, ah);
  c.lineTo(w - dx, ah / 2 + dy);
  c.arcTo(w - dx, h - ah / 2 - dy, 0, 0, 0, 0, h);
  c.arcTo(w - dx, h - ah / 2 + dy, 0, 0, 1, w - dx, ah / 2 - dy);
  c.close();
  c.fillAndStroke();
};

/**
 * mxShapeArrows2UTurnArrow (既定 dy 0.5・arrowHead 40)。dx2 は 0 以上 (v24.7.5 は上を抑えない)。
 * v24.7.5 のコンストラクタは dx2 の既定を持たない (this.dx2 が undefined) ので、style に dx2 が無いと NaN になる
 */
const uTurnArrow: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h, e.num('dy', 0.5));
  const ah = clamp(0, h, e.num('arrowHead', 40));
  const dx = (h - ah / 2 + dy) / 2;
  const dx2 = Math.max(0, e.num('dx2', NaN));
  // dx2 が NaN なら、2 つ目の点から NaN の経路になる。SVG の経路は誤りの手前までを描くので (SVG 1.1 の F.2)、始めの点だけになり、何も見えない
  if (Number.isNaN(dx2)) return;
  c.begin();
  c.moveTo(dx, 0);
  c.lineTo(dx + dx2, ah * 0.5);
  c.lineTo(dx, ah);
  c.lineTo(dx, ah / 2 + dy);
  c.arcTo(dx - 2 * dy, dx - 2 * dy, 0, 0, 0, dx, h - 2 * dy);
  c.lineTo(Math.max(w, dx), h - 2 * dy);
  c.lineTo(Math.max(w, dx), h);
  c.lineTo(dx, h);
  c.arcTo(dx, dx, 0, 0, 1, dx, ah / 2 - dy);
  c.close();
  c.fillAndStroke();
};

// ───────────── 線の形 (mxArrows.js の mxShapeArrowsWedgeArrow 系。mxArrow の派生で、paintEdgeShape は線の点を受ける) ─────────────

/** mxShapeArrowsWedgeArrow: 始めの点で幅 startWidth (既定 20) の 2 倍、終わりの点で尖る三角 */
const wedgeArrow: EdgePainter = (c, pts, e) => {
  if (pts.length < 2) return;
  const sw = Math.max(0, e.num('startWidth', 20));
  const p0 = pts[0];
  const pe = pts[pts.length - 1];
  const dx = pe.x - p0.x;
  const dy = pe.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (!dist) return; // ソースでは 0 で割って NaN の経路になる (何も見えない)
  const nx = (dx * sw) / dist;
  const ny = (dy * sw) / dist;
  c.begin();
  c.moveTo(p0.x + ny, p0.y - nx);
  c.lineTo(p0.x - ny, p0.y + nx);
  c.lineTo(pe.x, pe.y);
  c.close();
  c.fillAndStroke();
};

/**
 * 繰り返しで描く部分 (楔の段・EIP の管の四角) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値や 0 の間隔で描き終わらないのを防ぐため、上限までは描いて、そこで止める。
 * ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_WEDGE_STEPS = 10000;
const MAX_MARKERS = 1000;

/** 楔の形を steps 本の横の線で描く (mxShapeArrowsWedgeArrowDashed・Dashed2 の paintEdgeShape の共通の中身) */
const wedgeLines = (c: ShapeCanvas, pts: Pt[], startWidth: number, steps: (dist: number) => number) => {
  if (pts.length < 2) return;
  const p0 = pts[0];
  const pe = pts[pts.length - 1];
  const dx = pe.x - p0.x;
  const dy = pe.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const n = steps(dist);
  // 長さ 0・段の数 0 は、ソースでは 0 で割って NaN の経路になる (何も見えない) ので描かない
  if (!dist || !(n > 0)) return;
  const nx = (dx * startWidth) / dist;
  const ny = (dy * startWidth) / dist;
  let pcx = p0.x;
  let pcy = p0.y;
  c.begin();
  // 段は MAX_WEDGE_STEPS 本まで (Kumiori の守り。段の間はソースと同じ dist / n のまま)
  for (let i = 0; i <= n && i < MAX_WEDGE_STEPS; i++) {
    const k = i === n ? (n - i * 0.98) / n : (n - i) / n;
    const cnx = nx * k;
    const cny = ny * k;
    c.moveTo(pcx + cny, pcy - cnx);
    c.lineTo(pcx - cny, pcy + cnx);
    pcx += dx / n;
    pcy += dy / n;
  }
  c.stroke();
};

/** mxShapeArrowsWedgeArrowDashed: 8 段 */
const wedgeArrowDashed: EdgePainter = (c, pts, e) => wedgeLines(c, pts, Math.max(0, e.num('startWidth', 20)), () => 8);

/**
 * mxShapeArrowsWedgeArrowDashed2: 段の間を stepSize (既定 10) に (段は MAX_WEDGE_STEPS 本まで)。
 * stepSize が 0 なら、段の数が無限になり、どの点も NaN (∞ / ∞ の比) の経路になって何も見えないので、描かない
 */
const wedgeArrowDashed2: EdgePainter = (c, pts, e) => {
  const stepSize = Math.max(0, e.num('stepSize', 10));
  wedgeLines(c, pts, Math.max(0, e.num('startWidth', 20)), (dist) => {
    const n = Math.floor(dist / stepSize);
    return Number.isFinite(n) ? n : 0;
  });
};

// ───────────── インフォグラフィック (mxInfographic.js) ─────────────

/** mxShapeInfographicNumEntryVert (既定 dy 0.5): 上の丸と、丸を避けて凹んだ四角 */
const numEntryVert: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, w, e.num('dy', 0.5));
  const inset = 5;
  const d = Math.min(dy, w - 2 * inset, h - inset);
  c.begin();
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

/** 楕円の上の角度 a (0 が上、時計回り) の点 (rx・ry は中心 (cx, cy) からの半径) */
const onEllipse = (cx: number, cy: number, rx: number, ry: number, a: number): [number, number] => [cx + Math.sin(a) * rx, cy - Math.cos(a) * ry];

/** mxShapeInfographicBendingArch (既定 startAngle 0.25・endAngle 0.75・arcWidth 0.5): 内の楕円と、弧の帯 */
const bendingArch: ShapePainter = (c, w, h, e) => {
  const startAngle = 2 * Math.PI * clamp(0, 1, e.num('startAngle', 0.25));
  const endAngle = 2 * Math.PI * clamp(0, 1, e.num('endAngle', 0.75));
  const arcWidth = 1 - clamp(0, 1, e.num('arcWidth', 0.5));
  const rx = w * 0.5;
  const ry = h * 0.5;
  const rx2 = rx * arcWidth;
  const ry2 = ry * arcWidth;
  const [startX, startY] = onEllipse(rx, ry, rx, ry, startAngle);
  const [innerStartX, innerStartY] = onEllipse(rx, ry, rx2, ry2, startAngle);
  const [endX, endY] = onEllipse(rx, ry, rx, ry, endAngle);
  const [innerEndX, innerEndY] = onEllipse(rx, ry, rx2, ry2, endAngle);
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  const bigArc = angDiff > Math.PI ? 1 : 0;
  const rx3 = rx2 - 5;
  const ry3 = ry2 - 5;
  c.begin();
  c.ellipse(w * 0.5 - rx3, h * 0.5 - ry3, 2 * rx3, 2 * ry3);
  c.fillAndStroke();
  c.begin();
  c.moveTo(startX, startY);
  c.arcTo(rx, ry, 0, bigArc, 1, endX, endY);
  c.lineTo(innerEndX, innerEndY);
  c.arcTo(rx2, ry2, 0, bigArc, 0, innerStartX, innerStartY);
  c.close();
  c.fillAndStroke();
};

/** mxShapeInfographicParallelogram (既定 dx 10) */
const parallelogram: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w * 0.5, e.num('dx', 10));
  polyShape(c, [[0, h], [2 * dx, 0], [w, 0], [w - 2 * dx, h]]);
};

/** 形を塗って線を引き、影の面を黒 (または白) の薄い色で塗り、最後に形の線を引き直す (インフォグラフィックの多くの形の決まった手順) */
const shaded = (c: ShapeCanvas, outline: () => void, shade: () => void) => {
  c.begin();
  outline();
  c.fillAndStroke();
  c.setShadow(false);
  shade();
  c.begin();
  outline();
  c.stroke();
};

/** リボンの外形 (RibbonRolled・RibbonDoubleFolded) */
const ribbonOutline = (c: ShapeCanvas, w: number, h: number, dx: number, dy: number) => poly(c, [[0, dy], [dx, 0], [dx, dy], [w, dy], [w, h - dy], [w - dx, h], [w - dx, h - dy], [0, h - dy]]);

/** mxShapeInfographicRibbonRolled (既定 dx 185・dy 15) */
const ribbonRolled: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w, e.num('dx', 185));
  const dy = clamp(0, h * 0.5, e.num('dy', 15));
  shaded(
    c,
    () => ribbonOutline(c, w, h, dx, dy),
    () => {
      c.setFillAlpha(0.2);
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[0, dy], [dx, 0], [dx, dy]]);
      poly(c, [[w, h - dy], [w - dx, h], [w - dx, h - dy]]);
      c.fill();
    },
  );
};

/** mxShapeInfographicRibbonDoubleFolded (既定 dx 25・dy 15) */
const ribbonDoubleFolded: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w, e.num('dx', 25));
  const dy = clamp(0, h * 0.5, e.num('dy', 15));
  shaded(
    c,
    () => ribbonOutline(c, w, h, dx, dy),
    () => {
      c.setFillAlpha(0.2);
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[0, dy], [dx, 0], [dx, h - 2 * dy], [0, h - dy]]);
      poly(c, [[w, h - dy], [w - dx, h], [w - dx, h - dy]]);
      c.fill();
    },
  );
};

/** mxShapeInfographicRibbonFrontFolded・RibbonBackFolded (既定 dx・dy・notch 0.5)。影の面だけが違う */
const ribbonFolded =
  (front: boolean): ShapePainter =>
  (c, w, h, e) => {
    const dx = clamp(0, w, e.num('dx', 0.5));
    const dy = clamp(0, h * 0.5, e.num('dy', 0.5));
    const notch = clamp(0, w - dx, e.num('notch', 0.5));
    shaded(
      c,
      () => poly(c, [[0, dy], [dx, 0], [dx, dy], [w, dy], [w - notch, (h - dy) / 2 + dy], [w, h], [0, h]]),
      () => {
        c.setFillAlpha(0.2);
        c.setFillColor('#000000');
        c.begin();
        poly(c, front ? [[0, dy], [dx, 0], [dx, h - dy], [0, h]] : [[0, dy], [dx, 0], [dx, dy]]);
        c.fill();
      },
    );
  };

/** mxShapeInfographicBanner (既定 dx・dy・notch 0.5): 線は外形だけ (引き直さない) */
const banner: ShapePainter = (c, w, h, e) => {
  let dx = clamp(0, w / 2, e.num('dx', 0.5));
  const dy = clamp(0, h * 0.5, e.num('dy', 0.5));
  let notch = clamp(0, w, e.num('notch', 0.5));
  dx = Math.min(w / 2 - 2 * dy, dx);
  notch = Math.min(dx, notch);
  const my = (h - dy) * 0.5 + dy;
  polyShape(c, [[0, dy], [dx, dy], [dx, 0], [w - dx, 0], [w - dx, dy], [w, dy], [w - notch, my], [w, h], [w - dx - 2 * dy, h], [w - dx - 2 * dy, h - dy], [dx + 2 * dy, h - dy], [dx + 2 * dy, h], [0, h], [notch, my]]);
  c.setShadow(false);
  c.setFillAlpha(0.2);
  c.setFillColor('#000000');
  c.begin();
  poly(c, [[0, dy], [dx, dy], [dx, h - dy], [dx + 2 * dy, h], [0, h], [notch, my]]);
  poly(c, [[w, dy], [w - dx, dy], [w - dx, h - dy], [w - dx - 2 * dy, h], [w, h], [w - notch, my]]);
  c.fill();
  c.setFillAlpha(0.4);
  c.begin();
  poly(c, [[dx, h - dy], [dx + 2 * dy, h - dy], [dx + 2 * dy, h]]);
  poly(c, [[w - dx, h - dy], [w - dx - 2 * dy, h - dy], [w - dx - 2 * dy, h]]);
  c.fill();
};

/** mxShapeInfographicCircularCallout (既定 dy 0.5): 右上が角の楕円と、内の楕円の穴 */
const circularCallout: ShapePainter = (c, w, h, e) => {
  const dy = clamp(0, h * 0.5, e.num('dy', 0.5));
  const rx = clamp(0, w * 0.5, w * 0.5 - dy);
  const ry = clamp(0, h * 0.5, h * 0.5 - dy);
  c.begin();
  c.moveTo(w, h * 0.5);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.5, h);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, 0, h * 0.5);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.5, 0);
  c.lineTo(w, 0);
  c.close();
  c.moveTo(w * 0.5, dy);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5 - rx, h * 0.5);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5, h * 0.5 + ry);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5 + rx, h * 0.5);
  c.arcTo(rx, ry, 0, 0, 0, w * 0.5, h * 0.5 - ry);
  c.close();
  c.fillAndStroke();
};

/** mxShapeInfographicShadedTriangle: 左の面を白、右の面を黒で薄く塗る */
const shadedTriangle: ShapePainter = (c, w, h) =>
  shaded(
    c,
    () => poly(c, [[0, h], [w * 0.5, 0], [w, h]]),
    () => {
      c.setFillColor('#ffffff');
      c.setFillAlpha(0.2);
      c.begin();
      poly(c, [[0, h], [w * 0.5, 0], [w * 0.5, h * 0.67]]);
      c.fill();
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[w, h], [w * 0.5, h * 0.67], [w * 0.5, 0]]);
      c.fill();
    },
  );

/** mxShapeInfographicShadedPyramid */
const shadedPyramid: ShapePainter = (c, w, h) => {
  const h1 = Math.max(h - w * 0.3, 0);
  shaded(
    c,
    () => poly(c, [[0, h1], [w * 0.5, 0], [w, h1], [w * 0.5, h]]),
    () => {
      c.setFillColor('#ffffff');
      c.setFillAlpha(0.2);
      c.begin();
      poly(c, [[0, h1], [w * 0.5, 0], [w * 0.5, h]]);
      c.fill();
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[w, h1], [w * 0.5, h], [w * 0.5, 0]]);
      c.fill();
    },
  );
};

/** mxShapeInfographicPyramidStep */
const pyramidStep: ShapePainter = (c, w, h) => {
  const h1 = Math.max(w * 0.1, 0);
  shaded(
    c,
    () => poly(c, [[0, h1], [w * 0.5, 0], [w, h1], [w, h], [0, h]]),
    () => {
      c.setFillColor('#ffffff');
      c.setFillAlpha(0.2);
      c.begin();
      poly(c, [[0, h1], [w * 0.5, 0], [w * 0.5, h], [0, h]]);
      c.fill();
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[w, h1], [w, h], [w * 0.5, h], [w * 0.5, 0]]);
      c.fill();
    },
  );
};

/**
 * mxShapeInfographicCylinder: 円柱の外形を塗り、黒から白への東向きのグラデーション (両端の不透明度 0.4) を重ねる。
 */
const infographicCylinder: ShapePainter = (c, w, h) => {
  const dy = 20;
  const rx = w * 0.5;
  const ry = dy * 0.5;
  const outline = (sweep: number) => {
    c.moveTo(0, dy * 0.5);
    c.arcTo(rx, ry, 0, 0, sweep, w, ry);
    c.lineTo(w, h - ry);
    c.arcTo(rx, ry, 0, 0, 1, 0, h - ry);
    c.close();
  };
  c.begin();
  outline(1);
  c.fillAndStroke();
  c.setShadow(false);
  c.setGradient('#000000', '#ffffff', 'east', 0.4, 0.4);
  c.begin();
  outline(0);
  c.fill();
  c.begin();
  outline(1);
  c.stroke();
};

/** mxShapeInfographicCircularCallout2: 線の色で吹き出しの丸と下の小さい丸を塗り、塗りの色で内の丸を塗る */
const circularCallout2: ShapePainter = (c, w, h, e) => {
  const fillColor = e.color('fillColor', 'none');
  const strokeColor = e.color('strokeColor', 'none');
  c.setFillColor(strokeColor);
  const rx = Math.max(0, Math.min(w * 0.5, h * 0.4, h * 0.5 - 7));
  const rxMin = Math.max(rx * 0.1, 6);
  const cx = w * 0.5;
  const holes = () => {
    c.moveTo(cx, rx * 0.2);
    c.arcTo(rx * 0.8, rx * 0.8, 0, 0, 0, cx - rx * 0.8, rx * 0.8);
    c.arcTo(rx * 0.8, rx * 0.8, 0, 0, 0, cx, rx * 1.8);
    c.arcTo(rx * 0.8, rx * 0.8, 0, 0, 0, cx + rx * 0.8, rx * 0.8);
    c.arcTo(rx * 0.8, rx * 0.8, 0, 0, 0, cx, rx * 0.2);
    c.close();
    const r = rxMin * 0.75;
    c.moveTo(cx, h - rxMin * 1.75);
    c.arcTo(r, r, 0, 0, 0, cx - r, h - rxMin);
    c.arcTo(r, r, 0, 0, 0, cx, h - rxMin * 0.25);
    c.arcTo(r, r, 0, 0, 0, cx + r, h - rxMin);
    c.arcTo(r, r, 0, 0, 0, cx, h - rxMin * 1.75);
    c.close();
  };
  c.begin();
  c.moveTo(cx - 2, 2.15 * rx);
  c.arcTo(rx * 0.23, rx * 0.23, 0, 0, 0, cx - rx * 0.2, rx * 1.97);
  c.arcTo(rx, rx, 0, 0, 1, cx - rx, rx);
  c.arcTo(rx, rx, 0, 0, 1, cx, 0);
  c.arcTo(rx, rx, 0, 0, 1, cx + rx, rx);
  c.arcTo(rx, rx, 0, 0, 1, cx + rx * 0.2, rx * 1.97);
  c.arcTo(rx * 0.23, rx * 0.23, 0, 0, 0, cx + 2, 2.15 * rx);
  const big = rx * 0.04 > 4;
  if (big) {
    c.lineTo(cx + 2, h - rx * 0.22);
    c.arcTo(rx * 0.05, rx * 0.05, 0, 0, 0, cx + rx * 0.04, h - rx * 0.19);
  } else c.lineTo(cx + 2, h - 2 * rxMin);
  c.arcTo(rxMin, rxMin, 0, 0, 1, cx + rxMin, h - rxMin);
  c.arcTo(rxMin, rxMin, 0, 0, 1, cx, h);
  c.arcTo(rxMin, rxMin, 0, 0, 1, cx - rxMin, h - rxMin);
  if (big) {
    c.arcTo(rxMin, rxMin, 0, 0, 1, cx - rx * 0.04, h - rx * 0.19);
    c.arcTo(rxMin * 0.5, rxMin * 0.5, 0, 0, 0, cx - 2, h - rx * 0.22);
  } else c.arcTo(rxMin, rxMin, 0, 0, 1, cx - 2, h - 2 * rxMin);
  c.close();
  holes();
  c.fill();
  c.setFillColor(fillColor);
  c.setShadow(false);
  c.begin();
  holes();
  c.fill();
};

/** mxShapeInfographicBannerSingleFold (既定 dx・dy・dx2・notch 0.5) */
const bannerSingleFold: ShapePainter = (c, w, h, e) => {
  let dx = clamp(0, w, e.num('dx', 0.5));
  const dy = clamp(0, h * 0.5, e.num('dy', 0.5));
  let notch = clamp(0, w, e.num('notch', 0.5));
  dx = Math.min(w - 2 * dy, dx);
  const dx2 = clamp(0, w - dx - 2 * dy, e.num('dx2', 0.5));
  notch = Math.min(dx, notch);
  const my = (h - dy) * 0.5 + dy;
  shaded(
    c,
    () => poly(c, [[dx2, 0], [w - dx, 0], [w - dx, dy], [w, dy], [w - notch, my], [w, h], [w - dx - 2 * dy, h], [w - dx - 2 * dy, h - dy], [dx2, h - dy], [0, (h - dy) * 0.5]]),
    () => {
      c.setFillAlpha(0.05);
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[w, dy], [w - dx, dy], [w - dx, h - dy], [w - dx - 2 * dy, h], [w, h], [w - notch, my]]);
      c.fill();
      c.setFillAlpha(0.4);
      c.begin();
      poly(c, [[w - dx, h - dy], [w - dx - 2 * dy, h - dy], [w - dx - 2 * dy, h]]);
      c.fill();
    },
  );
};

/** mxShapeInfographicShadedCube (既定 isoAngle 15。角度はソースのとおり π / 200 を掛ける): 線は外形だけ */
const shadedCube: ShapePainter = (c, w, h, e) => {
  const isoAngle = (clamp(0.01, 94, e.num('isoAngle', 15)) * Math.PI) / 200;
  const isoH = Math.min(w * Math.tan(isoAngle), h * 0.5);
  polyShape(c, [[w * 0.5, 0], [w, isoH], [w, h - isoH], [w * 0.5, h], [0, h - isoH], [0, isoH]]);
  c.setShadow(false);
  c.setFillAlpha(0.2);
  c.setFillColor('#000000');
  c.begin();
  poly(c, [[w * 0.5, 2 * isoH], [w, isoH], [w, h - isoH], [w * 0.5, h]]);
  c.fill();
  c.setFillColor('#ffffff');
  c.begin();
  poly(c, [[w * 0.5, 2 * isoH], [0, isoH], [0, h - isoH], [w * 0.5, h]]);
  c.fill();
};

/** 中心 (cx, cy)・半径 rx・ry の楕円を、上から 4 つの円弧で (sweep の向きに) 回る */
const ellipseArcs = (c: ShapeCanvas, cx: number, cy: number, rx: number, ry: number, sweep: number) => {
  c.moveTo(cx, cy - ry);
  const pts: Array<[number, number]> = sweep ? [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]] : [[cx - rx, cy], [cx, cy + ry], [cx + rx, cy], [cx, cy - ry]];
  for (const [x, y] of pts) c.arcTo(rx, ry, 0, 0, sweep, x, y);
  c.close();
};

/** mxShapeInfographicPartConcEllipse (既定 startAngle 0.25・endAngle 0.75・arcWidth 0.5): 輪と、白の弧の帯と、内の縁の黒の輪 */
const partConcEllipse: ShapePainter = (c, w, h, e) => {
  const startAngle = 2 * Math.PI * clamp(0, 1, e.num('startAngle', 0.25));
  let endAngle = 2 * Math.PI * clamp(0, 1, e.num('endAngle', 0.75));
  const arcWidth = 1 - clamp(0, 1, e.num('arcWidth', 0.5));
  const rx = w * 0.5;
  const ry = h * 0.5;
  const rx2 = rx * arcWidth;
  const ry2 = ry * arcWidth;
  let angDiff = endAngle - startAngle;
  if (angDiff < 0) angDiff += Math.PI * 2;
  else if (angDiff === Math.PI) endAngle += 0.00001;
  const [startX, startY] = onEllipse(rx, ry, rx, ry, startAngle);
  const [innerStartX, innerStartY] = onEllipse(rx, ry, rx2, ry2, startAngle);
  const [endX, endY] = onEllipse(rx, ry, rx, ry, endAngle);
  const [innerEndX, innerEndY] = onEllipse(rx, ry, rx2, ry2, endAngle);
  const bigArc = angDiff <= Math.PI ? 1 : 0;
  c.begin();
  ellipseArcs(c, rx, ry, rx, ry, 1);
  // ソースの内の楕円は (rx, h/2 - ry2) から始まり、左回りで戻る
  ellipseArcs(c, rx, h * 0.5, rx2, ry2, 0);
  c.fillAndStroke();
  c.setShadow(false);
  c.setFillAlpha(0.2);
  c.setFillColor('#ffffff');
  c.begin();
  c.moveTo(startX, startY);
  c.arcTo(rx, ry, 0, bigArc, 0, endX, endY);
  c.lineTo(innerEndX, innerEndY);
  c.arcTo(rx2, ry2, 0, bigArc, 1, innerStartX, innerStartY);
  c.close();
  c.fill();
  const rx3 = rx2 + (rx - rx2) * 0.25;
  const ry3 = ry2 + (ry - ry2) * 0.25;
  c.setFillColor('#000000');
  c.begin();
  ellipseArcs(c, rx, h * 0.5, rx2, ry2, 1);
  ellipseArcs(c, rx, h * 0.5, rx3, ry3, 0);
  c.fill();
};

/** mxShapeInfographicBannerHalfFold (既定 dx・dx2・notch 0.5) */
const bannerHalfFold: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w, e.num('dx', 0.5));
  const dx2 = clamp(0, w - dx, e.num('dx2', 0.5));
  const notch = clamp(0, h - dx, e.num('notch', 0.5));
  shaded(
    c,
    () => poly(c, [[dx2, 0], [w - dx, 0], [w, dx], [w, h], [w - dx * 0.5, h - notch], [w - dx, h], [w - dx, dx], [dx2, dx], [0, dx * 0.5]]),
    () => {
      c.setFillAlpha(0.2);
      c.setFillColor('#000000');
      c.begin();
      poly(c, [[w - dx, dx], [w, dx], [w, h], [w - dx * 0.5, h - notch], [w - dx, h], [w - dx, dx], [0, dx]]);
      c.fill();
    },
  );
};

/** mxShapeInfographicCircularDial (既定 dy 0.5): 上が半円の柱と、内の丸の穴。下の四角を黒で薄く */
const circularDial: ShapePainter = (c, w, h, e) => {
  const dy = Math.max(0, Math.min(h * 0.5 - 10, w * 0.5, e.num('dy', 0.5)));
  const rx = clamp(0, w * 0.5, h * 0.5 - 10);
  const rx2 = rx - dy;
  c.begin();
  c.moveTo(w * 0.5 - rx, h);
  c.lineTo(w * 0.5 - rx, rx);
  c.arcTo(rx, rx, 0, 0, 1, w * 0.5, 0);
  c.arcTo(rx, rx, 0, 0, 1, w * 0.5 + rx, rx);
  c.lineTo(w * 0.5 + rx, h);
  c.close();
  c.moveTo(w * 0.5, dy);
  c.arcTo(rx2, rx2, 0, 0, 0, w * 0.5 - rx2, rx);
  c.arcTo(rx2, rx2, 0, 0, 0, w * 0.5, rx + rx2);
  c.arcTo(rx2, rx2, 0, 0, 0, w * 0.5 + rx2, rx);
  c.arcTo(rx2, rx2, 0, 0, 0, w * 0.5, dy);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.setFillAlpha(0.2);
  c.setFillColor('#000000');
  c.begin();
  poly(c, [[w * 0.5 - rx, 2 * rx], [w * 0.5 + rx, 2 * rx], [w * 0.5 + rx, h], [w * 0.5 - rx, h]]);
  c.fill();
};

/** mxShapeInfographicRibbonSimple (既定 notch1・notch2 0.5。notch1 の既定はソースのとおり notch2 の既定) */
const ribbonSimple: ShapePainter = (c, w, h, e) => {
  const notch1 = clamp(0, w, e.num('notch1', 0.5));
  const notch2 = clamp(0, w, e.num('notch2', 0.5));
  polyShape(c, [[0, h], [notch1, h * 0.5], [0, 0], [w - notch2, 0], [w, h * 0.5], [w - notch2, h]]);
};

/** mxShapeInfographicBarCallout (既定 dx・dy 0.5) */
const barCallout: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w, e.num('dx', 0.5));
  const dy = clamp(0, h, e.num('dy', 0.5));
  const x1 = Math.max(dx - dy * 0.35, 0);
  const x2 = Math.min(dx + dy * 0.35, w);
  polyShape(c, [[0, 0], [w, 0], [w, h - dy], [x2, h - dy], [dx, h], [x1, h - dy], [0, h - dy]]);
};

/** mxShapeInfographicFlag (既定 dx・dy 0.5): 左の帯を白で薄く */
const flag: ShapePainter = (c, w, h, e) => {
  const dx = clamp(0, w, e.num('dx', 0.5));
  const dy = clamp(0, h, e.num('dy', 0.5));
  polyShape(c, [[0, 0], [w, 0], [w, h - dy], [dx, h - dy], [dx * 0.5, h], [0, h - dy]]);
  c.setShadow(false);
  c.setFillAlpha(0.2);
  c.setFillColor('#ffffff');
  c.begin();
  poly(c, [[0, 0], [dx, 0], [dx, h - dy], [dx * 0.5, h], [0, h - dy]]);
  c.fill();
};

// ───────────── EIP (mxEip.js) ─────────────

/** mxShapeEipMessageExpiration: 時計の丸 (線だけ) と針 (v24.7.5 は #808080 に決まっている) */
const messExp: ShapePainter = (c, w, h) => {
  c.begin();
  c.ellipse(0, 0, w, h);
  c.stroke();
  c.setStrokeColor('#808080');
  c.begin();
  c.moveTo(w * 0.5, h * 0.1);
  c.lineTo(w * 0.5, h * 0.5);
  c.lineTo(w * 0.6, h * 0.8);
  c.stroke();
};

/** mxShapeEipReturnAddress: 封筒の四角・差出人の 3 本の線・宛先の 3 本の線 (太さ 2。mxSvgCanvas2D は線を引くときの太さを全体に使う)・切手 (v24.7.5 は #EDEDED に決まっている) */
const retAddr: ShapePainter = (c, w, h) => {
  c.begin();
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  for (const y of [0.11, 0.18, 0.25]) {
    c.moveTo(w * 0.05, h * y);
    c.lineTo(w * 0.25, h * y);
  }
  c.setStrokeWidth(2);
  for (const y of [0.63, 0.72, 0.8]) {
    c.moveTo(w * 0.3, h * y);
    c.lineTo(w * 0.8, h * y);
  }
  c.stroke();
  c.setFillColor('#EDEDED');
  c.begin();
  c.rect(w * 0.8, h * 0.1, w * 0.12, h * 0.19);
  c.fillAndStroke();
};

/** mxShapeEipAnchor: ソースの paintVertexShape は何も描かない */
const anchor: ShapePainter = () => {};

/** EIP のチャネルの管 (#e6e6e6 から #808080 への南向きのグラデーション) と、右の端の楕円 (#e6e6e6)。v24.7.5 は色が決まっている */
const channelPipe = (c: ShapeCanvas, w: number, h: number) => {
  const c1 = '#e6e6e6';
  c.setGradient(c1, '#808080', 'south');
  c.begin();
  c.moveTo(8, h * 0.5 + 10);
  c.arcTo(12, 12, 0, 0, 1, 8, h * 0.5 - 10);
  c.lineTo(w - 8, h * 0.5 - 10);
  c.arcTo(12, 12, 0, 0, 1, w - 8, h * 0.5 + 10);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.setFillColor(c1);
  c.begin();
  c.moveTo(w - 8, h * 0.5 - 10);
  c.arcTo(12, 12, 0, 0, 1, w - 8, h * 0.5 + 10);
  c.arcTo(12, 12, 0, 0, 1, w - 8, h * 0.5 - 10);
  c.fillAndStroke();
};

/** mxShapeEipMessageChannel */
const messageChannel: ShapePainter = (c, w, h) => channelPipe(c, w, h);

/** mxShapeEipDatatypeChannel: 管の中に、20 ごとの 10 × 10 の四角 (#fffbc0。MAX_MARKERS 個まで) */
const dataChannel: ShapePainter = (c, w, h) => {
  channelPipe(c, w, h);
  c.setFillColor('#fffbc0');
  c.setStrokeWidth(1);
  // 四角は MAX_MARKERS 個まで (Kumiori の守り)
  for (let i = 1; i * 20 + 10 < w - 14 && i <= MAX_MARKERS; i++) {
    c.begin();
    c.rect(i * 20, h * 0.5 - 5, 10, 10);
    c.fillAndStroke();
  }
};

/** mxShapeEipDeadLetterChannel: 管の真ん中の八角形 (#ff0000) と横線 (#ffffff、太さ 2) */
const deadLetterChannel: ShapePainter = (c, w, h) => {
  channelPipe(c, w, h);
  c.setFillColor('#ff0000');
  c.setStrokeWidth(1);
  const cx = w * 0.5;
  const cy = h * 0.5;
  polyShape(c, [[cx - 6, cy - 3], [cx - 3, cy - 6], [cx + 3, cy - 6], [cx + 6, cy - 3], [cx + 6, cy + 3], [cx + 3, cy + 6], [cx - 3, cy + 6], [cx - 6, cy + 3]]);
  c.setStrokeWidth(2);
  c.setStrokeColor('#ffffff');
  c.begin();
  c.moveTo(cx - 4, cy);
  c.lineTo(cx + 4, cy);
  c.stroke();
};

/** mxShapeEipInvalidMessageChannel: 管の真ん中の三角 (#ffe040) と感嘆符 */
const invalidMessageChannel: ShapePainter = (c, w, h) => {
  channelPipe(c, w, h);
  c.setFillColor('#ffe040');
  c.setStrokeWidth(1);
  const cx = w * 0.5;
  const cy = h * 0.5;
  polyShape(c, [[cx - 6, cy + 5], [cx, cy - 5], [cx + 6, cy + 5]]);
  c.setStrokeWidth(1);
  c.begin();
  c.moveTo(cx, cy - 2);
  c.lineTo(cx, cy + 2);
  c.moveTo(cx, cy + 3);
  c.lineTo(cx, cy + 4);
  c.stroke();
};

// ───────────── Kubernetes (mxKubernetes.js) ─────────────

/** 枠 (mxgraph.kubernetes.frame) を線の色 (既定 #ffffff) で塗り、3 % 内側に塗りの色 (既定 #ffffff) で重ねる */
const kubeFrame = (c: ShapeCanvas, w: number, h: number, fill: string | undefined, stroke: string | undefined) => {
  c.setFillColor(stroke);
  c.stencil('mxgraph.kubernetes.frame', 0, 0, w, h);
  c.setFillColor(fill);
  c.stencil('mxgraph.kubernetes.frame', w * 0.03, h * 0.03, w * 0.94, h * 0.94);
};

/** mxShapeKubernetesIcon: 枠と、真ん中 6 割のアイコン (mxgraph.kubernetes.<prIcon>) */
const kubeIcon: ShapePainter = (c, w, h, e) => {
  const fill = e.color('fillColor', '#ffffff');
  const stroke = e.color('strokeColor', '#ffffff');
  kubeFrame(c, w, h, fill, stroke);
  c.setFillColor(stroke);
  c.stencil(`mxgraph.kubernetes.${e.str('prIcon', '')}`, w * 0.2, h * 0.2, w * 0.6, h * 0.6);
};

/**
 * mxShapeKubernetesIcon2 のアイコンごとの置き方 [x の中心からのずれ (w2 に掛ける)・y (h に掛ける)・幅 (w2 に掛ける)・高さ (h2 に掛ける)]。
 * 表に無い名前は ICON2_DEFAULT。ラベルの文字は名前の _ を - にしたもの (control_plane は 2 行)
 */
const ICON2_DEFAULT: [number, number, number, number] = [0.3, 0.2, 0.6, 0.6];
const ICON2_PLACE: Record<string, [number, number, number, number]> = {
  cm: [0.3, 0.25, 0.6, 0.5],
  c_role: [0.25, 0.2, 0.5, 0.6],
  crb: [0.25, 0.3, 0.5, 0.3],
  crd: [0.25, 0.2, 0.6, 0.6],
  deploy: [0.27, 0.25, 0.6, 0.55],
  hpa: [0.4, 0.1, 0.8, 0.8],
};
const ICON2_NAMES = new Set(
  'api c_c_m cm c_m c_role control_plane crb crd cronjob deploy ds ep etcd group hpa ing job k_proxy kubelet limits netpol node ns pod psp pv pvc quota rb role rs sa sc sched secret sts svc user vol'.split(' '),
);

/** mxShapeKubernetesIcon2: 枠と、アイコン (mxgraph.kubernetes2.<prIcon>)。kubernetesLabel=1 なら、アイコンを小さくして下に名前を書く */
const kubeIcon2: ShapePainter = (c, w, h, e) => {
  const prIcon = e.str('prIcon', '');
  const fill = e.color('fillColor', '#ffffff');
  const stroke = e.color('strokeColor', '#ffffff');
  const hasLabel = isOne(e, 'kubernetesLabel');
  kubeFrame(c, w, h, fill, stroke);
  const name = `mxgraph.kubernetes2.${prIcon}`;
  c.setFillColor(stroke);
  if (stroke) c.setFontColor(stroke);
  c.setFontSize(Math.min(w, h) * 0.2);
  let w2 = Math.min(h, w);
  let h2 = w2;
  if (hasLabel) {
    w2 *= 0.8;
    h2 = w2 * 0.9;
  }
  if (!ICON2_NAMES.has(prIcon)) {
    c.stencil(name, w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    return;
  }
  const [ox, y, sw, sh] = ICON2_PLACE[prIcon] ?? ICON2_DEFAULT;
  c.stencil(name, w * 0.5 - w2 * ox, h * y, w2 * sw, h2 * sh);
  if (!hasLabel) return;
  if (prIcon === 'control_plane') {
    c.setFontSize(Math.min(w, h) * 0.12);
    c.text(w * 0.5, h * 0.78, 0, 0, 'control\nplane', 'center', 'middle');
  } else c.text(w * 0.5, h * 0.75, 0, 0, prIcon.replace(/_/g, '-'), 'center', 'middle');
};

// ───────────── キャビネット (mxCabinets.js) ─────────────

/**
 * mxCabinetsCabinet: 箱・上の板 (15)・左右の壁の線・下の台。台は hasStand が数の 1 なら高さ 40、ほかは 15。
 * ソースは getValue(style, 'hasStand', '1') === 1 で比べるので、キーの無いときの既定 ('1' の字) は 1 と等しくなく、高さ 15 になる
 */
const cabinet: ShapePainter = (c, w, h, e) => {
  const wallTh = 15;
  c.begin();
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.rect(0, 0, w, wallTh);
  c.stroke();
  c.begin();
  c.moveTo(wallTh, wallTh);
  c.lineTo(wallTh, h);
  c.moveTo(w - wallTh, wallTh);
  c.lineTo(w - wallTh, h);
  c.stroke();
  c.begin();
  if (isOne(e, 'hasStand')) c.rect(0, h - 40, w, 40);
  else c.rect(0, h - wallTh, w, wallTh);
  c.fillAndStroke();
};

/** mxCabinetsCoverPlate: 板と、真ん中の高さ 25 の穴 */
const coverPlate: ShapePainter = (c, w, h) => {
  c.begin();
  poly(c, [[0, 0], [w, 0], [w, h], [0, h]]);
  poly(c, [[10, h * 0.5 - 12.5], [10, h * 0.5 + 12.5], [w - 10, h * 0.5 + 12.5], [w - 10, h * 0.5 - 12.5]]);
  c.fillAndStroke();
};

/** mxCabinetsDimension・DimensionBottom: 寸法の線 (両端の矢と、縦の線)。bottom なら上下が逆 */
const dimension =
  (bottom: boolean): ShapePainter =>
  (c, w, h) => {
    const Y = (y: number) => (bottom ? h - y : y);
    c.begin();
    c.moveTo(0, Y(20));
    c.lineTo(w, Y(20));
    c.moveTo(10, Y(15));
    c.lineTo(0, Y(20));
    c.lineTo(10, Y(25));
    c.moveTo(w - 10, Y(15));
    c.lineTo(w, Y(20));
    c.lineTo(w - 10, Y(25));
    c.moveTo(0, Y(15));
    c.lineTo(0, bottom ? 0 : h);
    c.moveTo(w, Y(15));
    c.lineTo(w, bottom ? 0 : h);
    c.stroke();
  };

/** 形の名前 (mxCellRenderer.registerShape の名前) → 描き方 */
export const SHAPES_ARROWS: Record<string, ShapePainter> = {
  'mxgraph.arrows2.arrow': arrow,
  'mxgraph.arrows2.twoWayArrow': twoWayArrow,
  'mxgraph.arrows2.stylisedArrow': stylisedArrow,
  'mxgraph.arrows2.sharpArrow': sharpArrow,
  'mxgraph.arrows2.sharpArrow2': sharpArrow2,
  'mxgraph.arrows2.calloutArrow': calloutArrow,
  'mxgraph.arrows2.bendArrow': bendArrow,
  'mxgraph.arrows2.bendDoubleArrow': bendDoubleArrow,
  'mxgraph.arrows2.calloutDoubleArrow': calloutDoubleArrow,
  'mxgraph.arrows2.calloutQuadArrow': calloutQuadArrow,
  'mxgraph.arrows2.calloutDouble90Arrow': calloutDouble90Arrow,
  'mxgraph.arrows2.quadArrow': quadArrow,
  'mxgraph.arrows2.triadArrow': triadArrow,
  'mxgraph.arrows2.tailedArrow': tailedArrow(false),
  'mxgraph.arrows2.tailedNotchedArrow': tailedArrow(true),
  'mxgraph.arrows2.stripedArrow': stripedArrow,
  'mxgraph.arrows2.jumpInArrow': jumpInArrow,
  'mxgraph.arrows2.uTurnArrow': uTurnArrow,
  'mxgraph.infographic.numberedEntryVert': numEntryVert,
  'mxgraph.infographic.bendingArch': bendingArch,
  'mxgraph.infographic.parallelogram': parallelogram,
  'mxgraph.infographic.ribbonRolled': ribbonRolled,
  'mxgraph.infographic.ribbonDoubleFolded': ribbonDoubleFolded,
  'mxgraph.infographic.ribbonFrontFolded': ribbonFolded(true),
  'mxgraph.infographic.ribbonBackFolded': ribbonFolded(false),
  'mxgraph.infographic.banner': banner,
  'mxgraph.infographic.circularCallout': circularCallout,
  'mxgraph.infographic.shadedTriangle': shadedTriangle,
  'mxgraph.infographic.shadedPyramid': shadedPyramid,
  'mxgraph.infographic.pyramidStep': pyramidStep,
  'mxgraph.infographic.cylinder': infographicCylinder,
  'mxgraph.infographic.circularCallout2': circularCallout2,
  'mxgraph.infographic.bannerSingleFold': bannerSingleFold,
  'mxgraph.infographic.shadedCube': shadedCube,
  'mxgraph.infographic.partConcEllipse': partConcEllipse,
  'mxgraph.infographic.bannerHalfFold': bannerHalfFold,
  'mxgraph.infographic.circularDial': circularDial,
  'mxgraph.infographic.ribbonSimple': ribbonSimple,
  'mxgraph.infographic.barCallout': barCallout,
  'mxgraph.infographic.flag': flag,
  'mxgraph.eip.messExp': messExp,
  'mxgraph.eip.retAddr': retAddr,
  'mxgraph.eip.anchor': anchor,
  'mxgraph.eip.messageChannel': messageChannel,
  'mxgraph.eip.dataChannel': dataChannel,
  'mxgraph.eip.deadLetterChannel': deadLetterChannel,
  'mxgraph.eip.invalidMessageChannel': invalidMessageChannel,
  'mxgraph.kubernetes.icon': kubeIcon,
  'mxgraph.kubernetes.icon2': kubeIcon2,
  'mxgraph.cabinets.cabinet': cabinet,
  'mxgraph.cabinets.coverPlate': coverPlate,
  'mxgraph.cabinets.dimension': dimension(false),
  'mxgraph.cabinets.dimensionBottom': dimension(true),
};

/**
 * 線の形 (mxArrow 派生。paintEdgeShape(c, pts) を移したもの)。頂点の形の SHAPES_ARROWS とは描き方の引数が違う
 * (経路の点を受ける) ので分けておく。呼ぶ側 (線を描く drawio.ts) が経路の点で呼ぶ
 */
export const EDGES_ARROWS: Record<string, EdgePainter> = {
  'mxgraph.arrows2.wedgeArrow': wedgeArrow,
  'mxgraph.arrows2.wedgeArrowDashed': wedgeArrowDashed,
  'mxgraph.arrows2.wedgeArrowDashed2': wedgeArrowDashed2,
};
