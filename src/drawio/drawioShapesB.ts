/**
 * drawioShapesB — draw.io の標準の形のうち、JavaScript で書かれたもの (UML・流れ図・mermaid・git など) を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/js/grapheditor/Shapes.js の各形の paintVertexShape・paintBackground・
 * paintForeground・redrawPath と、mxGraph の基底のクラス (mxShape・mxActor・mxCylinder・mxEllipse・mxRhombus・mxRectangleShape) の描き方。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移してから呼ぶので、元のソースの x・y は 0 とみなす。
 * 文字の置き場 (getLabelBounds・getLabelMargins)・接続点 (getConstraints)・影は移さない。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxActor.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxCylinder.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxEllipse.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxRectangleShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxRhombus.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxPoint.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import type { ShapeCanvas, Pt } from './drawioCanvas';
import type { ShapeEnv, ShapePainter } from './drawioShapes';

// ───────────── 基底のクラスの描き方 ─────────────

/** mxConstants.LINE_ARCSIZE (addPoints で丸める大きさの既定。各形は arcSize / 2 を使う) */
const LINE_ARCSIZE = 20;
/** mxConstants.RECTANGLE_ROUNDING_FACTOR */
const RECTANGLE_ROUNDING_FACTOR = 0.15;

/** addPoints で角を丸める大きさ (mxUtils.getValue(style, arcSize, LINE_ARCSIZE) / 2) */
const lineArc = (e: ShapeEnv) => e.num('arcSize', LINE_ARCSIZE) / 2;

/** 点の並び (draw.io の new mxPoint の並び) */
const pts = (...a: number[]): Pt[] => {
  const r: Pt[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) r.push({ x: a[i], y: a[i + 1] });
  return r;
};

/** mxActor.paintVertexShape: 経路を作り、塗って線を引く */
const actor =
  (redrawPath: (c: ShapeCanvas, w: number, h: number, e: ShapeEnv) => void): ShapePainter =>
  (c, w, h, e) => {
    c.begin();
    redrawPath(c, w, h, e);
    c.fillAndStroke();
  };

/** mxCylinder.paintVertexShape: 背景の経路を塗って線を引き、前景の経路は線だけ */
const cylinder =
  (redrawPath: (c: ShapeCanvas, w: number, h: number, e: ShapeEnv, fg: boolean) => void): ShapePainter =>
  (c, w, h, e) => {
    c.begin();
    redrawPath(c, w, h, e, false);
    c.fillAndStroke();
    c.setShadow(false);
    c.begin();
    redrawPath(c, w, h, e, true);
    c.stroke();
  };

/** mxEllipse.paintVertexShape: 楕円を塗って線を引く */
const ellipseVS = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.ellipse(x, y, w, h);
  c.fillAndStroke();
};

/** mxRectangleShape.paintBackground: 四角 (rounded なら、absoluteArcSize=1 は arcSize / 2、ほかは短い辺 × arcSize% の半径で丸める) を塗って線を引く */
const rectBg = (c: ShapeCanvas, x: number, y: number, w: number, h: number, e: ShapeEnv) => {
  if (e.rounded) {
    let r: number;
    if (e.str('absoluteArcSize', '0') === '1') r = Math.min(w / 2, Math.min(h / 2, e.num('arcSize', LINE_ARCSIZE) / 2));
    else {
      const k = e.num('arcSize', RECTANGLE_ROUNDING_FACTOR * 100) / 100;
      r = Math.min(w * k, h * k);
    }
    c.roundrect(x, y, w, h, r, r);
  } else c.rect(x, y, w, h);
  c.fillAndStroke();
};

/** 線分 (begin・moveTo・lineTo・stroke) */
const seg = (c: ShapeCanvas, x0: number, y0: number, x1: number, y1: number) => {
  c.begin();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
};

// ───────────── UML ─────────────

// draw.io の Shapes.js の UmlActorShape
/** 棒の人: 頭の楕円 (塗る) と、胴・腕・脚の線 */
const umlActor: ShapePainter = (c, w, h) => {
  c.ellipse(w / 4, 0, w / 2, h / 4);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w / 2, h / 4);
  c.lineTo(w / 2, (2 * h) / 3);
  c.moveTo(w / 2, h / 3);
  c.lineTo(0, h / 3);
  c.moveTo(w / 2, h / 3);
  c.lineTo(w, h / 3);
  c.moveTo(w / 2, (2 * h) / 3);
  c.lineTo(0, h);
  c.moveTo(w / 2, (2 * h) / 3);
  c.lineTo(w, h);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の UmlBoundaryShape
/** 境界: 左の縦線と、そこから右の円へつなぐ横線 */
const umlBoundary: ShapePainter = (c, w, h) => {
  seg(c, 0, h / 4, 0, (h * 3) / 4);
  seg(c, 0, h / 2, w / 6, h / 2);
  ellipseVS(c, w / 6, 0, (w * 5) / 6, h);
};

// draw.io の Shapes.js の UmlEntityShape (x・y は makeSeqIcon が使う)
/** 実体: 円と、その下に接する横線 */
const umlEntityAt = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  ellipseVS(c, x, y, w, h);
  seg(c, x + w / 8, y + h, x + (w * 7) / 8, y + h);
};
const umlEntity: ShapePainter = (c, w, h) => umlEntityAt(c, 0, 0, w, h);

// draw.io の Shapes.js の UmlDestroyShape
/** 破棄: 斜めの × */
const umlDestroy: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(w, 0);
  c.lineTo(0, h);
  c.moveTo(0, 0);
  c.lineTo(w, h);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の UmlControlShape (paintBackground で移した座標のまま、paintForeground を描く)
/** 制御: 円と、上の矢じり (2 本の線) */
const umlControlAt = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.translate(x, y);
  seg(c, (w * 3) / 8, (h / 8) * 1.1, (w * 5) / 8, 0);
  ellipseVS(c, 0, h / 8, w, (h * 7) / 8);
  c.setShadow(false);
  seg(c, (w * 3) / 8, (h / 8) * 1.1, (w * 5) / 8, h / 4);
};
const umlControl: ShapePainter = (c, w, h) => umlControlAt(c, 0, 0, w, h);

// draw.io の Shapes.js の makeSeqIcon (seqControl・seqEntity。アイコンの大きさ 44)
/** 順序図の参加者のアイコン: 元の形を、44 (と幅・高さの小さい方) の正方形にして、横の真ん中・上寄せに描く */
const seqIcon =
  (paint: (c: ShapeCanvas, x: number, y: number, w: number, h: number) => void, iconSize: number): ShapePainter =>
  (c, w, h) => {
    const size = Math.min(iconSize, w, h);
    paint(c, (w - size) / 2, 0, size, size);
  };

// draw.io の Shapes.js の SeqBoundaryShape
/** 順序図の境界: 左の縦の棒・横の線・セルの横の真ん中に中心を置いた円 */
const seqBoundary: ShapePainter = (c, w, h) => {
  const size = Math.min(44, w, h);
  const circleR = size / 2;
  const handlerW = size * 0.9;
  const barH = size * 0.45;
  const circleX = w / 2 - circleR;
  const cy = size / 2;
  const handlerEndX = circleX + handlerW * 0.175;
  const leftX = handlerEndX - handlerW;
  seg(c, leftX, cy - barH / 2, leftX, cy + barH / 2);
  seg(c, leftX, cy, handlerEndX, cy);
  ellipseVS(c, circleX, 0, size, size);
};

// draw.io の Shapes.js の SeqQueueShape
/** 順序図の待ち行列: 横向きの円筒 (両端が楕円の弧の帯) と、右の奥行きの弧 */
const seqQueue: ShapePainter = (c, w, h) => {
  const ry = h / 2;
  const rx = ry / (2.5 + h / 50);
  c.begin();
  c.moveTo(rx, 0);
  c.lineTo(w - rx, 0);
  c.arcTo(rx, ry, 0, 0, 1, w - rx, h);
  c.lineTo(rx, h);
  c.arcTo(rx, ry, 0, 0, 1, rx, 0);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(w - rx, 0);
  c.arcTo(rx, ry, 0, 0, 0, w - rx, h);
  c.stroke();
};

// draw.io の Shapes.js の SeqCollectionsShape
/** 順序図の集まり: 右上へ 6 ずらした四角の上に、四角を重ねる */
const seqCollections: ShapePainter = (c, w, h) => {
  const off = 6;
  c.rect(off, -off, w, h);
  c.fillAndStroke();
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

// draw.io の Shapes.js の SeqDatabaseShape
/** 順序図のデータベース: 幅の 1/3 の大きさの縦の円筒を、横の真ん中・上寄せに */
const seqDatabase: ShapePainter = (c, w) => {
  const iconW = w / 3;
  const iconH = w / 3;
  const rx = iconW / 2;
  const ry = rx / (2.5 + iconW / 50);
  c.translate((w - iconW) / 2, 0);
  c.begin();
  c.moveTo(0, ry);
  c.arcTo(rx, ry, 0, 0, 0, iconW, ry);
  c.arcTo(rx, ry, 0, 0, 0, 0, ry);
  c.lineTo(0, iconH - ry);
  c.arcTo(rx, ry, 0, 0, 0, iconW, iconH - ry);
  c.lineTo(iconW, ry);
  c.fillAndStroke();
};

// draw.io の Shapes.js の SeqActorStickShape
/** 順序図の棒の人: 大きさの決まった棒の人 (頭の半径 15) を、横の真ん中・上寄せに */
const seqActorStick: ShapePainter = (c, w) => {
  const headR = 15;
  const torsoH = 20;
  const armsW = 36;
  const legsH = 15;
  const legsW = 32;
  const cx = w / 2;
  const headCY = headR;
  const torsoTop = headCY + headR;
  const torsoBot = torsoTop + torsoH;
  const armsY = torsoTop + torsoH / 2;
  const legsBot = torsoBot + legsH;
  ellipseVS(c, cx - headR, headCY - headR, headR * 2, headR * 2);
  c.begin();
  c.moveTo(cx, torsoTop);
  c.lineTo(cx, torsoBot);
  c.moveTo(cx - armsW / 2, armsY);
  c.lineTo(cx + armsW / 2, armsY);
  c.moveTo(cx, torsoBot);
  c.lineTo(cx - legsW / 2, legsBot);
  c.moveTo(cx, torsoBot);
  c.lineTo(cx + legsW / 2, legsBot);
  c.stroke();
};

// draw.io の Shapes.js の UmlLifeline
/**
 * 生存線: 見出し (高さ size。既定 40) の四角か、participant に書いた形と、その下の真ん中の縦の線 (lifelineDashed の既定は破線。lifelineColor で線の色)。
 * lifelineMirror=1 なら、見出しを足にも描く (見出しは高さの半分まで)。
 * participant の形は、このファイルの形から引く (無い名前・umlLifeline 自身は、draw.io と同じく何も描かない)
 */
const umlLifeline: ShapePainter = (c, w, h, e) => {
  const mirror = e.str('lifelineMirror', '0') === '1';
  const size = Math.max(0, Math.min(mirror ? h / 2 : h, e.num('size', 40)));
  const participant = e.str('participant', '');
  if (!participant) {
    rectBg(c, 0, 0, w, size, e);
    if (mirror) rectBg(c, 0, h - size, w, size, e);
  } else if (participant !== 'umlLifeline' && Object.hasOwn(SHAPES_B, participant)) {
    const p = SHAPES_B[participant];
    c.save();
    p(c, w, size, e);
    c.restore();
    if (mirror) {
      c.save();
      c.translate(0, h - size);
      p(c, w, size, e);
      c.restore();
    }
  }
  const lineEnd = mirror ? h - size : h;
  if (size < lineEnd) {
    c.setDashed(e.str('lifelineDashed', '1') === '1');
    if (e.str('lifelineColor', '') !== '') c.setStrokeColor(e.color('lifelineColor', undefined));
    c.begin();
    c.moveTo(w / 2, size);
    c.lineTo(w / 2, lineEnd);
    c.end();
    c.stroke();
  }
  // 足の見出しの文字の写し (paintMirrorLabel) は、セルの文字が ShapeEnv に無いので描かない
};

// draw.io の Shapes.js の UmlFrame
/** 枠: 左上の見出し (幅 width 既定 60・高さ height 既定 30。右下の角を切る) を塗って線を引き、残りの枠の線を引く。swimlaneFillColor は全体の背景 */
const umlFrame: ShapePainter = (c, w, h, e) => {
  const co = 10;
  const w0 = Math.min(w, Math.max(co, e.num('width', 60)));
  const h0 = Math.min(h, Math.max(co * 1.5, e.num('height', 30)));
  const bg = e.color('swimlaneFillColor', undefined);
  if (bg) {
    c.setFillColor(bg);
    c.rect(0, 0, w, h);
    c.fill();
  }
  c.setFillColor(e.fill);
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w0, 0);
  c.lineTo(w0, Math.max(0, h0 - co * 1.5));
  c.lineTo(Math.max(0, w0 - co), h0);
  c.lineTo(0, h0);
  c.close();
  c.fillAndStroke();
  c.begin();
  c.moveTo(w0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, h0);
  c.stroke();
};

// draw.io の Shapes.js の LollipopShape
/** 提供インタフェース: 上の小さな円 (直径 size。既定 10) と、その下の縦の線 */
const lollipop: ShapePainter = (c, w, h, e) => {
  const sz = e.num('size', 10);
  ellipseVS(c, (w - sz) / 2, 0, sz, sz);
  seg(c, w / 2, sz, w / 2, h);
};

// draw.io の Shapes.js の RequiresShape
/** 要求インタフェース: 下の縦の線と、上の受け口の弧 (size 既定 10・inset 既定 2 に線の太さを足す) */
const requires: ShapePainter = (c, w, h, e) => {
  const sz = e.num('size', 10);
  const inset = e.num('inset', 2) + e.strokeWidth;
  seg(c, w / 2, sz + inset, w / 2, h);
  c.begin();
  c.moveTo((w - sz) / 2 - inset, sz / 2);
  c.quadTo((w - sz) / 2 - inset, sz + inset, w / 2, sz + inset);
  c.quadTo((w + sz) / 2 + inset, sz + inset, (w + sz) / 2 + inset, sz / 2);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の RequiredInterfaceShape
/** 要求インタフェース (半円): 左の上下の端を結ぶ、右へふくらんだ弧 */
const requiredInterface: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.quadTo(w, 0, w, h / 2);
  c.quadTo(w, h, 0, h);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の ProvidedRequiredInterfaceShape
/** 提供と要求のインタフェース: 左の円と、それを右から囲む弧 (inset 既定 2 に線の太さを足す) */
const providedRequiredInterface: ShapePainter = (c, w, h, e) => {
  const inset = e.num('inset', 2) + e.strokeWidth;
  ellipseVS(c, 0, inset, w - 2 * inset, h - 2 * inset);
  c.begin();
  c.moveTo(w / 2, 0);
  c.quadTo(w, 0, w, h / 2);
  c.quadTo(w, h, w / 2, h);
  c.end();
  c.stroke();
};

/** ModuleShape・ComponentShape の共通の経路 (x0 から右の本体と、左に突き出た 2 つの端子) */
const jettyPath = (c: ShapeCanvas, w: number, h: number, dx: number, dy: number, y0: number, y1: number, fg: boolean) => {
  const x0 = dx / 2;
  const x1 = x0 + dx / 2;
  if (fg) {
    c.moveTo(x0, y0);
    c.lineTo(x1, y0);
    c.lineTo(x1, y0 + dy);
    c.lineTo(x0, y0 + dy);
    c.moveTo(x0, y1);
    c.lineTo(x1, y1);
    c.lineTo(x1, y1 + dy);
    c.lineTo(x0, y1 + dy);
  } else {
    c.addPoints(pts(x0, 0, w, 0, w, h, x0, h, x0, y1 + dy, 0, y1 + dy, 0, y1, x0, y1, x0, y0 + dy, 0, y0 + dy, 0, y0, x0, y0), false, 0, true);
  }
};

// draw.io の Shapes.js の ModuleShape (mxCylinder)
/** モジュール: 左に 2 つの端子 (jettyWidth 既定 20・jettyHeight 既定 10。上から dy と 3dy の位置) の付いた四角 */
const moduleShape: ShapePainter = cylinder((c, w, h, e, fg) => {
  const dx = e.num('jettyWidth', 20);
  const dy = e.num('jettyHeight', 10);
  const y0 = Math.min(dy, h - dy);
  const y1 = Math.min(y0 + 2 * dy, h - dy);
  jettyPath(c, w, h, dx, dy, y0, y1, fg);
});

// draw.io の Shapes.js の ComponentShape (mxCylinder)
/** 部品: 左に 2 つの端子 (jettyWidth 既定 32・jettyHeight 既定 12。高さの 3 割と 7 割を中心に) の付いた四角 */
const componentShape: ShapePainter = cylinder((c, w, h, e, fg) => {
  const dx = e.num('jettyWidth', 32);
  const dy = e.num('jettyHeight', 12);
  jettyPath(c, w, h, dx, dy, 0.3 * h - dy / 2, 0.7 * h - dy / 2, fg);
});

// draw.io の Shapes.js の AssociativeEntity (mxRectangleShape)
/** 関連実体: 四角と、その中に接する菱形 (線だけ) */
const associativeEntity: ShapePainter = (c, w, h, e) => {
  rectBg(c, 0, 0, w, h, e);
  c.setShadow(false);
  c.begin();
  c.addPoints(pts(w / 2, 0, w, h / 2, w / 2, h, 0, h / 2), e.rounded, lineArc(e), true);
  c.stroke();
};

// draw.io の Shapes.js の StateShape (endState) と StartStateShape (startState。外の円を描かない)
/** 状態の終わり・始まり: 内側 (4 と幅・高さの 1/5 の小さい方) の円を塗り、終わりは外の円の線も引く */
const stateShape =
  (outerStroke: boolean): ShapePainter =>
  (c, w, h) => {
    const inset = Math.min(4, Math.min(w / 5, h / 5));
    if (w > 0 && h > 0) ellipseVS(c, inset, inset, w - 2 * inset, h - 2 * inset);
    c.setShadow(false);
    if (outerStroke) {
      c.ellipse(0, 0, w, h);
      c.stroke();
    }
  };

// ───────────── 流れ図など ─────────────

// draw.io の Shapes.js の ManualInputShape (mxActor)
/** 手入力: 左上を size (既定 30) だけ下げた台形 */
const manualInput: ShapePainter = actor((c, w, h, e) => {
  const s = Math.min(h, e.num('size', 30));
  c.addPoints(pts(0, h, 0, s, w, 0, w, h), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の InternalStorageShape (mxRectangleShape)
/** 内部記憶: 四角と、上から dy・左から dx (既定 20。丸めるときは角の半径より小さくしない) の線 */
const internalStorage: ShapePainter = (c, w, h, e) => {
  rectBg(c, 0, 0, w, h, e);
  c.setShadow(false);
  let inset = 0;
  if (e.rounded) {
    const k = e.num('arcSize', RECTANGLE_ROUNDING_FACTOR * 100) / 100;
    inset = Math.max(inset, Math.min(w * k, h * k));
  }
  const dx = Math.max(inset, Math.min(w, e.num('dx', 20)));
  const dy = Math.max(inset, Math.min(h, e.num('dy', 20)));
  seg(c, 0, dy, w, dy);
  seg(c, dx, 0, dx, h);
};

// draw.io の Shapes.js の CornerShape (mxActor)
/** 角: 上の帯 (高さ dy) と左の帯 (幅 dx) でできた L の字 (既定 20) */
const corner: ShapePainter = actor((c, w, h, e) => {
  const dx = Math.max(0, Math.min(w, e.num('dx', 20)));
  const dy = Math.max(0, Math.min(h, e.num('dy', 20)));
  c.addPoints(pts(0, 0, w, 0, w, dy, dx, dy, dx, h, 0, h), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の CrossbarShape (mxActor)
/** 横木: 左右の縦の線と、真ん中の横の線 (閉じない経路を塗って線を引く) */
const crossbar: ShapePainter = actor((c, w, h) => {
  c.moveTo(0, 0);
  c.lineTo(0, h);
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.moveTo(0, h / 2);
  c.lineTo(w, h / 2);
});

// draw.io の Shapes.js の TeeShape (mxActor)
/** T の字: 上の帯 (高さ dy) と真ん中の柱 (幅 dx)。既定 20 */
const tee: ShapePainter = actor((c, w, h, e) => {
  const dx = Math.max(0, Math.min(w, e.num('dx', 20)));
  const dy = Math.max(0, Math.min(h, e.num('dy', 20)));
  c.addPoints(pts(0, 0, w, 0, w, dy, (w + dx) / 2, dy, (w + dx) / 2, h, (w - dx) / 2, h, (w - dx) / 2, dy, 0, dy), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の SingleArrowShape (mxActor)
/** 片矢印: 軸の太さ arrowWidth (高さの割合。既定 0.3)・矢じりの長さ arrowSize (幅の割合。既定 0.2) */
const singleArrow: ShapePainter = actor((c, w, h, e) => {
  const aw = h * Math.max(0, Math.min(1, e.num('arrowWidth', 0.3)));
  const as = w * Math.max(0, Math.min(1, e.num('arrowSize', 0.2)));
  const at = (h - aw) / 2;
  const ab = at + aw;
  c.addPoints(pts(0, at, w - as, at, w - as, 0, w, h / 2, w - as, h, w - as, ab, 0, ab), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の DoubleArrowShape (mxActor。既定は SingleArrowShape のもの)
/** 両矢印 */
const doubleArrow: ShapePainter = actor((c, w, h, e) => {
  const aw = h * Math.max(0, Math.min(1, e.num('arrowWidth', 0.3)));
  const as = w * Math.max(0, Math.min(1, e.num('arrowSize', 0.2)));
  const at = (h - aw) / 2;
  const ab = at + aw;
  c.addPoints(pts(0, h / 2, as, 0, as, at, w - as, at, w - as, 0, w, h / 2, w - as, h, w - as, ab, as, ab, as, h), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の DataStorageShape (mxActor)
/** 記憶データ: 左が外へ・右が内へふくらむ弧の帯 (size は幅の割合 0.1。fixedSize なら長さで既定 20) */
const dataStorage: ShapePainter = actor((c, w, h, e) => {
  const fixed = e.str('fixedSize', '0') !== '0';
  const s = fixed ? Math.max(0, Math.min(w, e.num('size', 20))) : w * Math.max(0, Math.min(1, e.num('size', 0.1)));
  c.addCurvedPath(
    s,
    0,
    [
      [w, 0],
      [w - s * 2, h / 2, w, h],
      [s, h],
      [s - s * 2, h / 2, s, 0],
    ],
    e.rounded,
    lineArc(e),
  );
});

// draw.io の Shapes.js の OrShape (mxActor)
/** 論理和 (D の字): 左の縦の辺と、右の 2 つの 2 次の曲線 */
const orShape: ShapePainter = actor((c, w, h, e) => {
  c.addCurvedPath(
    0,
    0,
    [
      [w, 0, w, h / 2],
      [w, h, 0, h],
    ],
    e.rounded,
    lineArc(e),
  );
});

// draw.io の Shapes.js の XorShape (mxActor)
/** 排他的論理和: 右の 2 つの曲線と、左の内へへこむ曲線 */
const xorShape: ShapePainter = actor((c, w, h, e) => {
  c.addCurvedPath(
    0,
    0,
    [
      [w, 0, w, h / 2],
      [w, h, 0, h],
      [w / 2, h / 2, 0, 0],
    ],
    e.rounded,
    lineArc(e),
  );
});

// draw.io の Shapes.js の LoopLimitShape (mxActor)
/** 繰り返しの端: 上の両角を size (既定 20) で切った四角 */
const loopLimit: ShapePainter = actor((c, w, h, e) => {
  const s = Math.min(w / 2, Math.min(h, e.num('size', 20)));
  c.addPoints(pts(s, 0, w - s, 0, w, s * 0.8, w, h, 0, h, 0, s * 0.8), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の OffPageConnectorShape (mxActor)
/** 他ページへの結合子: 下が尖った五角形 (尖りの高さ size は高さの割合。既定 3/8) */
const offPageConnector: ShapePainter = actor((c, w, h, e) => {
  const s = h * Math.max(0, Math.min(1, e.num('size', 3 / 8)));
  c.addPoints(pts(0, 0, w, 0, w, h - s, w / 2, h, 0, h - s), e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の TapeDataShape (mxEllipse)
/** 磁気テープ: 円と、下の真ん中から右への線 */
const tapeData: ShapePainter = (c, w, h) => {
  ellipseVS(c, 0, 0, w, h);
  seg(c, w / 2, h, w, h);
};

// draw.io の Shapes.js の OrEllipseShape (mxEllipse)
/** 円の中の十字 */
const orEllipse: ShapePainter = (c, w, h) => {
  ellipseVS(c, 0, 0, w, h);
  c.setShadow(false);
  seg(c, 0, h / 2, w, h / 2);
  seg(c, w / 2, 0, w / 2, h);
};

// draw.io の Shapes.js の SumEllipseShape (mxEllipse)
/** 円の中の × (円に接する 0.145 の位置から) */
const sumEllipse: ShapePainter = (c, w, h) => {
  ellipseVS(c, 0, 0, w, h);
  const s2 = 0.145;
  c.setShadow(false);
  seg(c, w * s2, h * s2, w * (1 - s2), h * (1 - s2));
  seg(c, w * (1 - s2), h * s2, w * s2, h * (1 - s2));
};

// draw.io の Shapes.js の SortShape (mxRhombus)
/** 分類: 菱形と、真ん中の横の線 */
const sortShape: ShapePainter = (c, w, h, e) => {
  c.begin();
  c.addPoints(pts(w / 2, 0, w, h / 2, w / 2, h, 0, h / 2), e.rounded, lineArc(e), true);
  c.fillAndStroke();
  c.setShadow(false);
  seg(c, 0, h / 2, w, h / 2);
};

// draw.io の Shapes.js の CollateShape
/** 照合: 上下の頂点が真ん中で合う 2 つの三角 (砂時計) */
const collate: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w / 2, h / 2);
  c.close();
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, h);
  c.lineTo(w, h);
  c.lineTo(w / 2, h / 2);
  c.close();
  c.fillAndStroke();
};

// draw.io の Shapes.js の DimensionShape
/** 寸法線: 左右の縦の線と、下の両矢印の線 (矢じりの大きさは 10 + 線の太さ) */
const dimension: ShapePainter = (c, w, h) => {
  const sw = c.strokeWidth / 2;
  const al = 10 + 2 * sw;
  const cy = h - al / 2;
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(0, h);
  c.moveTo(sw, cy);
  c.lineTo(sw + al, cy - al / 2);
  c.moveTo(sw, cy);
  c.lineTo(sw + al, cy + al / 2);
  c.moveTo(sw, cy);
  c.lineTo(w - sw, cy);
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.moveTo(w - sw, cy);
  c.lineTo(w - al - sw, cy - al / 2);
  c.moveTo(w - sw, cy);
  c.lineTo(w - al - sw, cy + al / 2);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の PartialRectangleShape
/** 一部の辺だけの四角: 全体を塗り、top・right・bottom・left (既定 1) の辺だけ線を引く (線の端は四角) */
const partialRectangle: ShapePainter = (c, w, h, e) => {
  c.setStrokeColor(null);
  const top = e.str('top', '1') === '1';
  const left = e.str('left', '1') === '1';
  const right = e.str('right', '1') === '1';
  const bottom = e.str('bottom', '1') === '1';
  // drawHidden が真なので、どの辺も無くても、塗りと線の段に入る
  c.rect(0, 0, w, h);
  c.fill();
  c.setStrokeColor(e.stroke);
  c.setLineCap('square');
  c.begin();
  c.moveTo(0, 0);
  if (top) c.lineTo(w, 0);
  else c.moveTo(w, 0);
  if (right) c.lineTo(w, h);
  else c.moveTo(w, h);
  if (bottom) c.lineTo(0, h);
  else c.moveTo(0, h);
  if (left) c.lineTo(0, 0);
  c.end();
  c.stroke();
  c.setLineCap('flat');
  // 表の格子の線の描き直し (Graph.paintTableCellLines) は、表のセルのときだけで、表は drawio.ts で描くので移さない
};

// draw.io の Shapes.js の LineEllipseShape (mxEllipse)
/** 円と、真ん中の横の線 (line=vertical なら縦の線) */
const lineEllipse: ShapePainter = (c, w, h, e) => {
  ellipseVS(c, 0, 0, w, h);
  c.setShadow(false);
  if (e.str('line', '') === 'vertical') seg(c, w / 2, 0, w / 2, h);
  else seg(c, 0, h / 2, w, h / 2);
};

// draw.io の Shapes.js の DelayShape (mxActor)
/** 遅延: 右が半円 (2 次の曲線) の四角 */
const delay: ShapePainter = actor((c, w, h) => {
  const dx = Math.min(w, h / 2);
  c.moveTo(0, 0);
  c.lineTo(w - dx, 0);
  c.quadTo(w, 0, w, h / 2);
  c.quadTo(w, h, w - dx, h);
  c.lineTo(0, h);
  c.close();
});

// draw.io の Shapes.js の CrossShape (mxActor)
/** 十字: 腕の太さ size (幅・高さの小さい方の割合。既定 0.2) */
const cross: ShapePainter = actor((c, w, h, e) => {
  const m = Math.min(h, w);
  const size = Math.max(0, Math.min(m, m * e.num('size', 0.2)));
  const t = (h - size) / 2;
  const b = t + size;
  const l = (w - size) / 2;
  const r = l + size;
  c.moveTo(0, t);
  c.lineTo(l, t);
  c.lineTo(l, 0);
  c.lineTo(r, 0);
  c.lineTo(r, t);
  c.lineTo(w, t);
  c.lineTo(w, b);
  c.lineTo(r, b);
  c.lineTo(r, h);
  c.lineTo(l, h);
  c.lineTo(l, b);
  c.lineTo(0, b);
  c.close();
});

// draw.io の Shapes.js の DisplayShape (mxActor)
/** 表示: 左が尖り (size は幅の割合。既定 0.25)、右が半円の形 */
const display: ShapePainter = actor((c, w, h, e) => {
  const dx = Math.min(w, h / 2);
  const s = Math.min(w - dx, Math.max(0, e.num('size', 0.25)) * w);
  c.moveTo(0, h / 2);
  c.lineTo(s, 0);
  c.lineTo(w - dx, 0);
  c.quadTo(w, 0, w, h / 2);
  c.quadTo(w, h, w - dx, h);
  c.lineTo(s, h);
  c.close();
});

// ───────────── git・mindmap・mermaid ─────────────

// draw.io の Shapes.js の GitTagShape (mxActor に、穴の円を足す)
/** git の札: 左が尖った札 (tabSize 既定 8・先の平らな高さ tabInset 既定 4) と、尖りの中の穴 (holeSize 既定 1・holeColor は既定で文字の色か #333333) */
const gitTag: ShapePainter = (c, w, h, e) => {
  const tabSize = Math.max(0, Math.min(w, e.num('tabSize', 8)));
  const tabInset = Math.max(0, Math.min(h, e.num('tabInset', 4)));
  const tabY1 = (h - tabInset) / 2;
  const tabY2 = tabY1 + tabInset;
  c.begin();
  c.moveTo(0, tabY1);
  c.lineTo(0, tabY2);
  c.lineTo(tabSize, h);
  c.lineTo(w, h);
  c.lineTo(w, 0);
  c.lineTo(tabSize, 0);
  c.close();
  c.fillAndStroke();
  const holeSize = Math.max(0, e.num('holeSize', 1));
  if (!(holeSize > 0)) return;
  // 穴の位置は、元のソースのとおり、上の範囲に収める前の tabSize で決める
  const tab = e.num('tabSize', 8);
  const holeColor = e.color('holeColor', e.color('fontColor', '#333333'));
  c.setFillColor(holeColor);
  c.setStrokeColor(holeColor);
  c.begin();
  c.ellipse(tab / 2 - holeSize, h / 2 - holeSize, holeSize * 2, holeSize * 2);
  c.fillAndStroke();
};

// draw.io の Shapes.js の GitMergeCommitShape
/** git の合流のコミット: 外の円と、内の円 (直径は短い辺の 6 割。innerColor 既定 #ECECFF) */
const gitMergeCommit: ShapePainter = (c, w, h, e) => {
  const innerColor = e.color('innerColor', '#ECECFF');
  ellipseVS(c, 0, 0, w, h);
  const innerD = Math.min(w, h) * 0.6;
  c.setFillColor(innerColor);
  c.setStrokeColor(innerColor);
  ellipseVS(c, (w - innerD) / 2, (h - innerD) / 2, innerD, innerD);
};

// draw.io の Shapes.js の GitCherryPickShape
/** git の cherry-pick: 円と、中の 2 つの小さな円と逆 V の字の 2 本の線 (featureColor 既定 #fff) */
const gitCherryPick: ShapePainter = (c, w, h, e) => {
  const featureColor = e.color('featureColor', '#fff');
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) / 20;
  ellipseVS(c, 0, 0, w, h);
  c.setFillColor(featureColor);
  c.setStrokeColor(featureColor);
  c.setStrokeWidth(0);
  const eyeR = 2.75 * s;
  ellipseVS(c, cx - 3 * s - eyeR, cy + 2 * s - eyeR, eyeR * 2, eyeR * 2);
  ellipseVS(c, cx + 3 * s - eyeR, cy + 2 * s - eyeR, eyeR * 2, eyeR * 2);
  c.setStrokeWidth(1 * s);
  seg(c, cx + 3 * s, cy + 1 * s, cx, cy - 5 * s);
  seg(c, cx - 3 * s, cy + 1 * s, cx, cy - 5 * s);
};

// draw.io の Shapes.js の MindmapBangShape (mxActor)
/** mindmap の bang: 弧の山でできた星形 (上下 4・左右 3 の弧。セルの 8 割の枠を、1 割ずらして置く) */
const mindmapBang: ShapePainter = actor((c, w, h) => {
  const W = w * 0.8;
  const H = h * 0.8;
  const r = W * 0.15;
  const r80 = r * 0.8;
  let px = W * 0.1;
  let py = H * 0.1;
  c.moveTo(px, py);
  const arc = (dx: number, dy: number, rr = r) => {
    px += dx;
    py += dy;
    c.arcTo(rr, rr, 0, 0, 0, px, py);
  };
  arc(W * 0.25, -H * 0.1);
  arc(W * 0.25, 0);
  arc(W * 0.25, 0);
  arc(W * 0.25, H * 0.1);
  arc(W * 0.15, H * 0.33);
  arc(0, H * 0.34, r80);
  arc(-W * 0.15, H * 0.33);
  arc(-W * 0.25, H * 0.15);
  arc(-W * 0.25, 0);
  arc(-W * 0.25, 0);
  arc(-W * 0.25, -H * 0.15);
  arc(-W * 0.1, -H * 0.33);
  arc(0, -H * 0.34, r80);
  arc(W * 0.1, -H * 0.33);
  c.close();
});

// draw.io の Shapes.js の IshikawaHeadShape (mxActor)
/** 特性要因図の頭: 左の縦の辺と、右へ尖る 2 次の曲線 */
const ishikawaHead: ShapePainter = actor((c, w, h) => {
  c.moveTo(0, 0);
  c.lineTo(0, h);
  c.quadTo(2 * w, h / 2, 0, 0);
  c.close();
});

// draw.io の Shapes.js の OddShape (mermaidOdd。mxActor)
/** mermaid の odd: 左に内へ入る切り込み (深さは高さの 1/4) の付いた四角 */
const mermaidOdd: ShapePainter = actor((c, w, h) => {
  const notch = h / 4;
  c.moveTo(0, 0);
  c.lineTo(notch, h / 2);
  c.lineTo(0, h);
  c.lineTo(w, h);
  c.lineTo(w, 0);
  c.close();
});

// draw.io の Shapes.js の MermaidPersonShape
/** mermaid の人: 角の丸い胴 (角は幅の 0.177、胴の高さの 0.45 まで) の上に、頭の円 (半径は幅の 0.23 を 16〜56 に収める) を重ねる */
const mermaidPerson: ShapePainter = (c, w, h) => {
  const r = Math.min(Math.max(w * 0.23, 16), 56);
  const bodyTop = Math.min(h, 2 * r - r * 0.27);
  const bodyHeight = h - bodyTop;
  const bodyRadius = Math.max(0, Math.min(w * 0.177, bodyHeight * 0.45));
  c.roundrect(0, bodyTop, w, bodyHeight, bodyRadius, bodyRadius);
  c.fillAndStroke();
  c.setShadow(false);
  ellipseVS(c, w / 2 - r, 0, 2 * r, 2 * r);
};

/** MermaidUsecaseActorShape の頭 (中心の y と半径。56 × 72 の図の中心を原点に) */
const USECASE_HEADS: Record<string, [number, number]> = { normal: [-24, 12], hollow: [-23, 9], awesome: [-21, 13] };

// draw.io の Shapes.js の MermaidUsecaseActorShape
/** mermaid のユースケースの行為者: 56 × 72 の図 (actorType: normal 棒の人・hollow 白抜き・awesome 胸像) をセルの大きさに伸ばす。business=1 は頭に斜めの弦 */
const mermaidUsecaseActor: ShapePainter = (c, w, h, e) => {
  let type = e.str('actorType', 'normal');
  if (!Object.hasOwn(USECASE_HEADS, type)) type = 'normal';
  const sx = w / 56;
  const sy = h / 72;
  const px = (v: number) => w / 2 + v * sx;
  const py = (v: number) => h / 2 + v * sy;
  // 4 つの 3 次の曲線の円 (mermaid の頭の描き方)
  const circle = (ccy: number, r: number) => {
    const k = r * 0.55228;
    c.moveTo(px(0), py(ccy + r));
    c.curveTo(px(k), py(ccy + r), px(r), py(ccy + k), px(r), py(ccy));
    c.curveTo(px(r), py(ccy - k), px(k), py(ccy - r), px(0), py(ccy - r));
    c.curveTo(px(-k), py(ccy - r), px(-r), py(ccy - k), px(-r), py(ccy));
    c.curveTo(px(-r), py(ccy + k), px(-k), py(ccy + r), px(0), py(ccy + r));
    c.close();
  };
  const poly = (...a: number[]) => {
    c.moveTo(px(a[0]), py(a[1]));
    for (let i = 2; i + 1 < a.length; i += 2) c.lineTo(px(a[i]), py(a[i + 1]));
  };
  c.begin();
  if (type === 'hollow') {
    circle(-23, 9);
    poly(-22, -10, 22, -10, 22, 0, 6, 0, 22, 17, 13, 28, 0, 13, -13, 28, -22, 17, -6, 0, -22, 0);
    c.close();
    c.stroke();
  } else if (type === 'awesome') {
    circle(-21, 13);
    c.moveTo(px(-24), py(25));
    c.curveTo(px(-24), py(7), px(-14), py(-3), px(0), py(-3));
    c.curveTo(px(14), py(-3), px(24), py(7), px(24), py(25));
    c.curveTo(px(24), py(28), px(21), py(30), px(18), py(30));
    c.lineTo(px(-18), py(30));
    c.curveTo(px(-21), py(30), px(-24), py(28), px(-24), py(25));
    c.close();
    c.fillAndStroke();
  } else {
    // 線は面を囲まないので、塗られるのは頭だけ
    circle(-24, 12);
    poly(0, -12, 0, 8);
    poly(-17, -5, 17, -5);
    poly(0, 8, -15, 28);
    poly(0, 8, 15, 28);
    c.fillAndStroke();
  }
  if (e.str('business', '0') === '1') {
    // 頭の中心から半径の 0.6 だけ離れた、60 度の弦 (mermaid の businessMarkerPathForCircle)
    const [hy, r] = USECASE_HEADS[type];
    const offset = r * 0.6;
    const half = r * Math.sqrt(1 - 0.36);
    const dx = Math.cos(Math.PI / 3);
    const dy = -Math.sin(Math.PI / 3);
    const mx = offset * -dy;
    const my = hy + offset * dx;
    c.setShadow(false);
    c.begin();
    c.moveTo(px(mx - half * dx), py(my - half * dy));
    c.lineTo(px(mx + half * dx), py(my + half * dy));
    c.stroke();
  }
};

/** MermaidBlockArrowShape の点の並び (y は下の辺からの上向き。dirs の向きの組み合わせごと) */
const blockArrowPoints = (dirs: Set<string>, w: number, h: number, pad: number): number[][] => {
  const has = (...d: string[]) => d.every((k) => dirs.has(k));
  const m = h / 2;
  if (has('right', 'left', 'up', 'down'))
    return [[0, 0], [m, 0], [w / 2, 2 * pad], [w - m, 0], [w, 0], [w, -h / 3], [w + 2 * pad, -h / 2], [w, (-2 * h) / 3], [w, -h], [w - m, -h], [w / 2, -h - 2 * pad], [m, -h], [0, -h], [0, (-2 * h) / 3], [-2 * pad, -h / 2], [0, -h / 3]];
  if (has('right', 'left', 'up')) return [[m, 0], [w - m, 0], [w, -h / 2], [w - m, -h], [m, -h], [0, -h / 2]];
  if (has('right', 'left', 'down')) return [[0, 0], [m, -h], [w - m, -h], [w, 0]];
  if (has('right', 'up', 'down')) return [[0, 0], [w, -m], [w, -h + m], [0, -h]];
  if (has('left', 'up', 'down')) return [[w, 0], [0, -m], [0, -h + m], [w, -h]];
  if (has('right', 'left')) return [[m, 0], [m, -pad], [w - m, -pad], [w - m, 0], [w, -h / 2], [w - m, -h], [w - m, -h + pad], [m, -h + pad], [m, -h], [0, -h / 2]];
  if (has('up', 'down')) return [[w / 2, 0], [0, -pad], [m, -pad], [m, -h + pad], [0, -h + pad], [w / 2, -h], [w, -h + pad], [w - m, -h + pad], [w - m, -pad], [w, -pad]];
  if (has('right', 'up')) return [[0, 0], [w, -m], [0, -h]];
  if (has('right', 'down')) return [[0, 0], [w, 0], [0, -h]];
  if (has('left', 'up')) return [[w, 0], [0, -m], [w, -h]];
  if (has('left', 'down')) return [[w, 0], [0, 0], [w, -h]];
  if (has('right')) return [[m, -pad], [w - m, -pad], [w - m, 0], [w, -h / 2], [w - m, -h], [w - m, -h + pad], [m, -h + pad]];
  if (has('left')) return [[m, 0], [m, -pad], [w - m, -pad], [w - m, -h + pad], [m, -h + pad], [m, -h], [0, -h / 2]];
  if (has('up')) return [[m, -pad], [m, -h + pad], [0, -h + pad], [w / 2, -h], [w, -h + pad], [w - m, -h + pad], [w - m, -pad]];
  if (has('down')) return [[w / 2, 0], [0, -pad], [m, -pad], [m, -h + pad], [w - m, -h + pad], [w - m, -pad], [w, -pad]];
  return [[0, 0], [w, 0], [w, -h], [0, -h]];
};

// draw.io の Shapes.js の MermaidBlockArrowShape (mxActor。線の継ぎ目は丸)
/** mermaid のブロック図の矢印: dirs (right・left・up・down・x・y を , | 空白で区切る。既定 right) の向きの組み合わせの多角形。nodePadding 既定 8 */
const mermaidBlockArrow: ShapePainter = (c, w, h, e) => {
  c.setLineJoin('round');
  const dirs = new Set<string>();
  for (const d0 of e.str('dirs', 'right').split(/[,| ]+/)) {
    const d = d0.trim().toLowerCase();
    if (d === 'x') dirs.add('right').add('left');
    else if (d === 'y') dirs.add('up').add('down');
    else if (d) dirs.add(d);
  }
  const p = blockArrowPoints(dirs, w, h, e.num('nodePadding', 8) / 2);
  c.begin();
  c.moveTo(p[0][0], h + p[0][1]);
  for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], h + p[i][1]);
  c.close();
  c.fillAndStroke();
};

/** JavaScript で書かれた標準の形 (形の名前 → 描き方) */
export const SHAPES_B: Record<string, ShapePainter> = {
  umlActor,
  umlBoundary,
  umlEntity,
  umlDestroy,
  umlControl,
  seqBoundary,
  seqControl: seqIcon(umlControlAt, 44),
  seqEntity: seqIcon(umlEntityAt, 44),
  seqQueue,
  seqCollections,
  seqDatabase,
  seqActorStick,
  umlLifeline,
  umlFrame,
  lollipop,
  requires,
  requiredInterface,
  providedRequiredInterface,
  module: moduleShape,
  component: componentShape,
  associativeEntity,
  endState: stateShape(true),
  startState: stateShape(false),
  manualInput,
  internalStorage,
  corner,
  crossbar,
  tee,
  singleArrow,
  doubleArrow,
  dataStorage,
  or: orShape,
  xor: xorShape,
  loopLimit,
  offPageConnector,
  tapeData,
  orEllipse,
  sumEllipse,
  sortShape,
  collate,
  dimension,
  partialRectangle,
  lineEllipse,
  delay,
  cross,
  display,
  gitTag,
  gitMergeCommit,
  gitCherryPick,
  mindmapBang,
  ishikawaHead,
  mermaidOdd,
  mermaidPerson,
  mermaidUsecaseActor,
  mermaidBlockArrow,
};
