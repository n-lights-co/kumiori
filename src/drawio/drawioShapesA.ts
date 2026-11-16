/**
 * drawioShapesA — draw.io の JavaScript で書かれた標準の形 (cube・note・folder・document・callout など) を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/js/grapheditor/Shapes.js の各形の paintVertexShape・redrawPath と、
 * 基底のクラス (mxGraph の mxActor・mxCylinder・mxRectangleShape・mxShape) の paintVertexShape・paintBackground・getArcSize。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移し、向き・反転を済ませるので、ソースの paintVertexShape(c, x, y, w, h) の x・y は 0 として書く。
 * 文字の置き場 (getLabelMargins・getLabelBounds)・接続点 (getConstraints)・影は移植しない
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Graph.js: Copyright (c) 2006-2012, JGraph Holdings Ltd
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxActor.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxCylinder.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxRectangleShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import type { Pt, ShapeCanvas } from './drawioCanvas';
import type { ShapeEnv, ShapePainter } from './drawioShapes';

const P = (x: number, y: number): Pt => ({ x, y });

/** mxConstants.LINE_ARCSIZE (20) の半分を既定にした、折れ線の角の丸めの大きさ (getValue(style, arcSize, LINE_ARCSIZE) / 2) */
const lineArc = (e: ShapeEnv) => e.num('arcSize', 20) / 2;

/** 0 以外の数か、空でない文字なら真 (mxGraph のスタイルの値を JavaScript の真偽で読むときと同じ。無ければ d) */
const truthy = (e: ShapeEnv, k: string, d: boolean) => {
  const v = e.str(k, '');
  if (v === '') return d;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
};

/** getValue(style, 'fixedSize', '0') != '0' (数の 0 と字の '0' は偽) */
const fixedOf = (e: ShapeEnv) => {
  const v = e.str('fixedSize', '0');
  const n = Number(v);
  return Number.isNaN(n) ? v !== '0' : n !== 0;
};

/** mxActor.paintVertexShape: 経路を作って塗り、線を引く */
const actor =
  (path: (c: ShapeCanvas, w: number, h: number, e: ShapeEnv) => void): ShapePainter =>
  (c, w, h, e) => {
    c.begin();
    path(c, w, h, e);
    c.fillAndStroke();
  };

/** mxCylinder.paintVertexShape: 背景の経路を塗って線を引き、前景の経路は線だけ (座標の移しは積み重なったまま) */
const cylinder =
  (path: (c: ShapeCanvas, w: number, h: number, e: ShapeEnv, fg: boolean) => void): ShapePainter =>
  (c, w, h, e) => {
    c.begin();
    path(c, w, h, e, false);
    c.fillAndStroke();
    c.setShadow(false);
    c.begin();
    path(c, w, h, e, true);
    c.stroke();
  };

/** mxShape.getArcSize: 角の丸めの半径 (absoluteArcSize=1 なら arcSize / 2、ほかは短い辺の arcSize % (既定 15 %)) */
const arcSizeOf = (e: ShapeEnv, w: number, h: number) =>
  e.num('absoluteArcSize', 0) === 1 ? Math.min(w / 2, Math.min(h / 2, e.num('arcSize', 20) / 2)) : Math.min(w, h) * (e.num('arcSize', 15) / 100);

/** mxRectangleShape.paintBackground: 四角 (rounded なら角を丸める) を塗って線を引く */
const rectBackground = (c: ShapeCanvas, x: number, y: number, w: number, h: number, e: ShapeEnv) => {
  if (e.rounded) {
    const r = arcSizeOf(e, w, h);
    c.roundrect(x, y, w, h, r, r);
  } else c.rect(x, y, w, h);
  c.fillAndStroke();
};

/** mxShape.paintVertexShape (mxRectangleShape の派生): 背景の四角を描いてから、前景を描く (光沢 glass は描かない) */
const rectShape =
  (fg: (c: ShapeCanvas, w: number, h: number, e: ShapeEnv) => void): ShapePainter =>
  (c, w, h, e) => {
    rectBackground(c, 0, 0, w, h, e);
    c.setShadow(false);
    fg(c, w, h, e);
  };

const tan30 = Math.tan((30 * Math.PI) / 180);
const tan30Dx = (0.5 - tan30) / 2;

// draw.io の Shapes.js の TableLineShape
// 表の行・列の区切りの線。線の点 (line) は表の組み方 (Graph.js) がコードで渡すもので、スタイルからは来ないので、何も描かない
const tableLine: ShapePainter = () => {};

// draw.io の Shapes.js の CubeShape
// 立方体 (右上と左下を size だけ切った六角形に、手前の面の縁の線)。darkOpacity・darkOpacity2 は上の面・左の面を暗く (負なら明るく) する
const cube: ShapePainter = (c, w, h, e) => {
  const s = Math.max(0, Math.min(w, Math.min(h, e.num('size', 20))));
  const op = Math.max(-1, Math.min(1, e.num('darkOpacity', 0)));
  const op2 = Math.max(-1, Math.min(1, e.num('darkOpacity2', 0)));
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w - s, 0);
  c.lineTo(w, s);
  c.lineTo(w, h);
  c.lineTo(s, h);
  c.lineTo(0, h - s);
  c.lineTo(0, 0);
  c.close();
  c.end();
  c.fillAndStroke();
  c.setShadow(false);
  if (op !== 0) {
    c.setFillAlpha(Math.abs(op));
    c.setFillColor(op < 0 ? '#FFFFFF' : '#000000');
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w - s, 0);
    c.lineTo(w, s);
    c.lineTo(s, s);
    c.close();
    c.fill();
  }
  if (op2 !== 0) {
    c.setFillAlpha(Math.abs(op2));
    c.setFillColor(op2 < 0 ? '#FFFFFF' : '#000000');
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(s, s);
    c.lineTo(s, h);
    c.lineTo(0, h - s);
    c.close();
    c.fill();
  }
  c.begin();
  c.moveTo(s, h);
  c.lineTo(s, s);
  c.lineTo(0, 0);
  c.moveTo(s, s);
  c.lineTo(w, s);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の IsoRectangleShape
// 等角図の平たいひし形 (幅と高さに収まる大きさ m の正方形を 30 度で見た形)
const isoRectangle: ShapePainter = actor((c, w, h) => {
  const m = Math.min(w, h / tan30);
  c.translate((w - m) / 2, (h - m) / 2 + m / 4);
  c.moveTo(0, 0.25 * m);
  c.lineTo(0.5 * m, m * tan30Dx);
  c.lineTo(m, 0.25 * m);
  c.lineTo(0.5 * m, (0.5 - tan30Dx) * m);
  c.lineTo(0, 0.25 * m);
  c.close();
  c.end();
});

// draw.io の Shapes.js の WaypointShape
// 経由点。真ん中に線の色で塗った円 (直径は size - 2 + 線の太さの 2 倍。size の既定 6)。枠の四角は塗らない (当たりの判定のためのもの)
const waypoint: ShapePainter = (c, w, h, e) => {
  c.setFillColor(e.stroke);
  const s = Math.max(0, e.num('size', 6) - 2) + 2 * e.strokeWidth;
  c.ellipse((w - s) * 0.5, (h - s) * 0.5, s, s);
  c.fill();
  c.setFillColor('none');
  c.rect(0, 0, w, h);
  c.fill();
};

// draw.io の Shapes.js の IsoCubeShape
// 等角図の立方体 (外形の六角形と、手前の 3 つの面の境の線)
const isoCube: ShapePainter = cylinder((c, w, h, _e, fg) => {
  const m = Math.min(w, h / (0.5 + tan30));
  if (fg) {
    c.moveTo(0, 0.25 * m);
    c.lineTo(0.5 * m, (0.5 - tan30Dx) * m);
    c.lineTo(m, 0.25 * m);
    c.moveTo(0.5 * m, (0.5 - tan30Dx) * m);
    c.lineTo(0.5 * m, (1 - tan30Dx) * m);
    c.end();
  } else {
    c.translate((w - m) / 2, (h - m) / 2);
    c.moveTo(0, 0.25 * m);
    c.lineTo(0.5 * m, m * tan30Dx);
    c.lineTo(m, 0.25 * m);
    c.lineTo(m, 0.75 * m);
    c.lineTo(0.5 * m, (1 - tan30Dx) * m);
    c.lineTo(0, 0.75 * m);
    c.close();
    c.end();
  }
});

// draw.io の Shapes.js の DataStoreShape
// データの置き場 (上下を膨らませた筒に、上に 3 本の弧)。塗りがあれば弧は前景の線、無ければ背景で 1 本ずつ線を引く
const datastore: ShapePainter = cylinder((c, w, h, e, fg) => {
  const dy = Math.min(h / 2, Math.round(h / 8) + e.strokeWidth - 1);
  const hasFill = e.fill !== undefined;
  if ((fg && hasFill) || (!fg && !hasFill)) {
    for (let k = 0; k < 3; k++) {
      if (k > 0) c.translate(0, dy / 2);
      c.moveTo(0, dy);
      c.curveTo(0, 2 * dy, w, 2 * dy, w, dy);
      if (!fg) {
        c.stroke();
        c.begin();
      }
    }
    c.translate(0, -dy);
  }
  if (!fg) {
    c.moveTo(0, dy);
    c.curveTo(0, -dy / 3, w, -dy / 3, w, dy);
    c.lineTo(w, h - dy);
    c.curveTo(w, h + dy / 3, 0, h + dy / 3, 0, h - dy);
    c.close();
  }
});

// draw.io の Shapes.js の NoteShape (note2 の NoteShape2 も描き方は同じ)
// 付箋 (右上の角を size だけ折った四角と、折り目の線)。darkOpacity は折った三角を暗く (負なら明るく) する
const note: ShapePainter = (c, w, h, e) => {
  const s = Math.max(0, Math.min(w, Math.min(h, e.num('size', 30))));
  const op = Math.max(-1, Math.min(1, e.num('darkOpacity', 0)));
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w - s, 0);
  c.lineTo(w, s);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, 0);
  c.close();
  c.end();
  c.fillAndStroke();
  c.setShadow(false);
  if (op !== 0) {
    c.setFillAlpha(Math.abs(op));
    c.setFillColor(op < 0 ? '#FFFFFF' : '#000000');
    c.begin();
    c.moveTo(w - s, 0);
    c.lineTo(w - s, s);
    c.lineTo(w, s);
    c.close();
    c.fill();
  }
  c.begin();
  c.moveTo(w - s, 0);
  c.lineTo(w - s, s);
  c.lineTo(w, s);
  c.end();
  c.stroke();
};

// draw.io の Shapes.js の IsoCubeShape2
// 角度を変えられる等角図の立方体 (isoAngle の既定 15。外形の六角形と、面の境の線)
const isoCube2: ShapePainter = (c, w, h, e) => {
  const isoAngle = (Math.max(0.01, Math.min(94, e.num('isoAngle', 15))) * Math.PI) / 200;
  const isoH = Math.min(w * Math.tan(isoAngle), h * 0.5);
  c.begin();
  c.moveTo(w * 0.5, 0);
  c.lineTo(w, isoH);
  c.lineTo(w, h - isoH);
  c.lineTo(w * 0.5, h);
  c.lineTo(0, h - isoH);
  c.lineTo(0, isoH);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(0, isoH);
  c.lineTo(w * 0.5, 2 * isoH);
  c.lineTo(w, isoH);
  c.moveTo(w * 0.5, 2 * isoH);
  c.lineTo(w * 0.5, h);
  c.stroke();
};

// draw.io の Shapes.js の CylinderShape (古い形)
// 円柱 (上下の楕円の高さは size。既定 15、高さの半分まで) と、蓋の手前の弧
const cylinder2: ShapePainter = (c, w, h, e) => {
  const size = Math.max(0, Math.min(h * 0.5, e.num('size', 15)));
  if (size === 0) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
    return;
  }
  c.begin();
  c.moveTo(0, size);
  c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 0);
  c.arcTo(w * 0.5, size, 0, 0, 1, w, size);
  c.lineTo(w, h - size);
  c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, h);
  c.arcTo(w * 0.5, size, 0, 0, 1, 0, h - size);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(w, size);
  c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 2 * size);
  c.arcTo(w * 0.5, size, 0, 0, 1, 0, size);
  c.stroke();
};

// draw.io の Shapes.js の CylinderShape3
// 円柱 (size の既定 15)。lid=0 なら蓋を描かず、上の縁を内へ凹ませる
const cylinder3: ShapePainter = (c, w, h, e) => {
  const size = Math.max(0, Math.min(h * 0.5, e.num('size', 15)));
  const lid = truthy(e, 'lid', true);
  if (size === 0) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
    return;
  }
  c.begin();
  if (lid) {
    c.moveTo(0, size);
    c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 0);
    c.arcTo(w * 0.5, size, 0, 0, 1, w, size);
  } else {
    c.moveTo(0, 0);
    c.arcTo(w * 0.5, size, 0, 0, 0, w * 0.5, size);
    c.arcTo(w * 0.5, size, 0, 0, 0, w, 0);
  }
  c.lineTo(w, h - size);
  c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, h);
  c.arcTo(w * 0.5, size, 0, 0, 1, 0, h - size);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  if (lid) {
    c.begin();
    c.moveTo(w, size);
    c.arcTo(w * 0.5, size, 0, 0, 1, w * 0.5, 2 * size);
    c.arcTo(w * 0.5, size, 0, 0, 1, 0, size);
    c.stroke();
  }
};

// draw.io の Shapes.js の SwitchShape
// 四辺を内へ反らせた四角 (2 次の曲線 4 本)
const switchShape: ShapePainter = actor((c, w, h) => {
  const curve = 0.5;
  c.moveTo(0, 0);
  c.quadTo(w / 2, h * curve, w, 0);
  c.quadTo(w * (1 - curve), h / 2, w, h);
  c.quadTo(w / 2, h * (1 - curve), 0, h);
  c.quadTo(w * curve, h / 2, 0, 0);
  c.end();
});

// draw.io の Shapes.js の FolderShape
// フォルダ (上に見出しの耳 (tabWidth 60・tabHeight 20、tabPosition の既定は右) の付いた四角)。rounded なら角を arcSize (既定 0.1) で丸める。
// folderSymbol=triangle なら右上に三角の印
const folder: ShapePainter = (c, w, h, e) => {
  let dx = Math.max(0, Math.min(w, e.num('tabWidth', 60)));
  const dy = Math.max(0, Math.min(h, e.num('tabHeight', 20)));
  const tp = e.str('tabPosition', 'right');
  const rounded = truthy(e, 'rounded', false);
  const absArcSize = truthy(e, 'absoluteArcSize', false);
  let arcSize = e.num('arcSize', 0.1);
  if (!absArcSize) arcSize = Math.min(w, h) * arcSize;
  arcSize = Math.min(arcSize, w * 0.5, (h - dy) * 0.5);
  dx = Math.max(dx, arcSize);
  dx = Math.min(w - arcSize, dx);
  if (!rounded) arcSize = 0;
  c.begin();
  if (tp === 'left') {
    c.moveTo(Math.max(arcSize, 0), dy);
    c.lineTo(Math.max(arcSize, 0), 0);
    c.lineTo(dx, 0);
    c.lineTo(dx, dy);
  } else {
    c.moveTo(w - dx, dy);
    c.lineTo(w - dx, 0);
    c.lineTo(w - Math.max(arcSize, 0), 0);
    c.lineTo(w - Math.max(arcSize, 0), dy);
  }
  if (rounded) {
    c.moveTo(0, arcSize + dy);
    c.arcTo(arcSize, arcSize, 0, 0, 1, arcSize, dy);
    c.lineTo(w - arcSize, dy);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w, arcSize + dy);
    c.lineTo(w, h - arcSize);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w - arcSize, h);
    c.lineTo(arcSize, h);
    c.arcTo(arcSize, arcSize, 0, 0, 1, 0, h - arcSize);
  } else {
    c.moveTo(0, dy);
    c.lineTo(w, dy);
    c.lineTo(w, h);
    c.lineTo(0, h);
  }
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  if (e.str('folderSymbol', '') === 'triangle') {
    c.begin();
    c.moveTo(w - 30, dy + 20);
    c.lineTo(w - 20, dy + 10);
    c.lineTo(w - 10, dy + 20);
    c.close();
    c.stroke();
  }
};

// draw.io の Shapes.js の UMLStateShape
// UML の状態 (rounded なら角を arcSize (既定 0.1) で丸めた四角)。umlStateSymbol=collapseState なら右下に畳んだ印、
// umlStateConnection (connPointRefEntry・connPointRefExit) なら左に接続点の円 (Exit は × 付き) を置き、四角を 10 だけ右へ寄せる
const umlState: ShapePainter = (c, w, h, e) => {
  const rounded = truthy(e, 'rounded', false);
  const absArcSize = truthy(e, 'absoluteArcSize', false);
  let arcSize = e.num('arcSize', 0.1);
  const connPoint = e.str('umlStateConnection', '');
  if (!absArcSize) arcSize = Math.min(w, h) * arcSize;
  arcSize = Math.min(arcSize, w * 0.5, h * 0.5);
  if (!rounded) arcSize = 0;
  const dx = connPoint !== '' ? 10 : 0;
  c.begin();
  c.moveTo(dx, arcSize);
  c.arcTo(arcSize, arcSize, 0, 0, 1, dx + arcSize, 0);
  c.lineTo(w - arcSize, 0);
  c.arcTo(arcSize, arcSize, 0, 0, 1, w, arcSize);
  c.lineTo(w, h - arcSize);
  c.arcTo(arcSize, arcSize, 0, 0, 1, w - arcSize, h);
  c.lineTo(dx + arcSize, h);
  c.arcTo(arcSize, arcSize, 0, 0, 1, dx, h - arcSize);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  if (e.str('umlStateSymbol', '') === 'collapseState') {
    c.roundrect(w - 40, h - 20, 10, 10, 3, 3);
    c.stroke();
    c.roundrect(w - 20, h - 20, 10, 10, 3, 3);
    c.stroke();
    c.begin();
    c.moveTo(w - 30, h - 15);
    c.lineTo(w - 20, h - 15);
    c.stroke();
  }
  if (connPoint === 'connPointRefEntry') {
    c.ellipse(0, h * 0.5 - 10, 20, 20);
    c.fillAndStroke();
  } else if (connPoint === 'connPointRefExit') {
    c.ellipse(0, h * 0.5 - 10, 20, 20);
    c.fillAndStroke();
    c.begin();
    c.moveTo(5, h * 0.5 - 5);
    c.lineTo(15, h * 0.5 + 5);
    c.moveTo(15, h * 0.5 - 5);
    c.lineTo(5, h * 0.5 + 5);
    c.stroke();
  }
};

// draw.io の Shapes.js の SmileyFaceShape
// 顔の絵 (円に目 2 つと口)。smileyType は happy (既定)・neutral・sad。目と口の線は smileyFeatureColor (既定 #666666)
const smileyFace: ShapePainter = (c, w, h, e) => {
  const smileyType = e.str('smileyType', 'happy');
  const featureColor = e.color('smileyFeatureColor', '#666666');
  const r = Math.min(w, h) / 2;
  c.ellipse(w / 2 - r, h / 2 - r, r * 2, r * 2);
  c.fillAndStroke();
  const s = Math.min(w, h) / 30;
  const cx = w / 2;
  const cy = h / 2;
  c.setFillColor(featureColor);
  c.setStrokeColor(featureColor);
  c.setStrokeWidth(2 * s);
  const eyeR = 1.5 * s;
  const eyeXOffset = 5 * s;
  const eyeYOffset = 5 * s;
  c.ellipse(cx - eyeXOffset - eyeR, cy - eyeYOffset - eyeR, eyeR * 2, eyeR * 2);
  c.fillAndStroke();
  c.ellipse(cx + eyeXOffset - eyeR, cy - eyeYOffset - eyeR, eyeR * 2, eyeR * 2);
  c.fillAndStroke();
  c.setStrokeWidth(1 * s);
  c.setFillColor('#000000');
  if (smileyType === 'happy') {
    const mcy = cy + 2 * s;
    c.begin();
    c.moveTo(cx + 7.5 * s, mcy);
    c.arcTo(7.5 * s, 7.5 * s, 0, 1, 1, cx - 7.5 * s, mcy);
    c.lineTo(cx - 6.818 * s, mcy);
    c.arcTo(6.818 * s, 6.818 * s, 0, 1, 0, cx + 6.818 * s, mcy);
    c.close();
    c.fillAndStroke();
  } else if (smileyType === 'sad') {
    const mcy = cy + 7 * s;
    c.begin();
    c.moveTo(cx - 7.5 * s, mcy);
    c.arcTo(7.5 * s, 7.5 * s, 0, 1, 1, cx + 7.5 * s, mcy);
    c.lineTo(cx + 6.818 * s, mcy);
    c.arcTo(6.818 * s, 6.818 * s, 0, 1, 0, cx - 6.818 * s, mcy);
    c.close();
    c.fillAndStroke();
  } else {
    c.begin();
    c.moveTo(cx - 5 * s, cy + 7 * s);
    c.lineTo(cx + 5 * s, cy + 7 * s);
    c.stroke();
  }
};

// draw.io の Shapes.js の CardShape
// カード (左上の角を size (既定 30) だけ切った四角。rounded なら角を丸める)
const card: ShapePainter = actor((c, w, h, e) => {
  const s = Math.max(0, Math.min(w, Math.min(h, e.num('size', 30))));
  c.addPoints([P(s, 0), P(w, 0), P(w, h), P(0, h), P(0, s)], e.rounded, lineArc(e), true);
  c.end();
});

// draw.io の Shapes.js の TapeShape
// テープ (上下の縁を波打たせた帯。波の高さは size × 高さ、size の既定 0.4)
const tape: ShapePainter = actor((c, w, h, e) => {
  const dy = h * Math.max(0, Math.min(1, e.num('size', 0.4)));
  const fy = 1.4;
  c.addCurvedPath(
    0,
    dy / 2,
    [
      [w / 4, dy * fy, w / 2, dy / 2],
      [(w * 3) / 4, dy * (1 - fy), w, dy / 2],
      [w, h - dy / 2],
      [(w * 3) / 4, h - dy * fy, w / 2, h - dy / 2],
      [w / 4, h - dy * (1 - fy), 0, h - dy / 2],
      [0, dy / 2],
    ],
    e.rounded,
    lineArc(e),
  );
  c.end();
});

// draw.io の Shapes.js の DocumentShape
// 書類 (下の縁を波打たせた四角。波の高さは size × 高さ、size の既定 0.3)。rounded なら左の辺は角まで伸ばす
const documentShape: ShapePainter = actor((c, w, h, e) => {
  const dy = h * Math.max(0, Math.min(1, e.num('size', 0.3)));
  const fy = 1.4;
  c.addCurvedPath(
    0,
    0,
    [
      [w, 0],
      [w, h - dy / 2],
      [(w * 3) / 4, h - dy * fy, w / 2, h - dy / 2],
      [w / 4, h - dy * (1 - fy), 0, h - dy / 2],
      [0, e.rounded ? 0 : dy / 2],
    ],
    e.rounded,
    lineArc(e),
  );
  c.end();
});

// draw.io の Shapes.js の ParallelogramShape
// 平行四辺形 (ずらしは size × 幅、size の既定 0.2。fixedSize なら size は px で、既定 20)
const parallelogram: ShapePainter = actor((c, w, h, e) => {
  const dx = fixedOf(e) ? Math.max(0, Math.min(w, e.num('size', 20))) : w * Math.max(0, Math.min(1, e.num('size', 0.2)));
  c.addPoints([P(0, h), P(dx, 0), P(w, 0), P(w - dx, h)], e.rounded, lineArc(e), true);
  c.end();
});

// draw.io の Shapes.js の TrapezoidShape
// 台形 (上の辺を左右から size × 幅ずつ縮める。size の既定 0.2、幅の半分まで。fixedSize なら px で、既定 20)
const trapezoid: ShapePainter = actor((c, w, h, e) => {
  const dx = fixedOf(e) ? Math.max(0, Math.min(w * 0.5, e.num('size', 20))) : w * Math.max(0, Math.min(0.5, e.num('size', 0.2)));
  c.addPoints([P(0, h), P(dx, 0), P(w - dx, 0), P(w, h)], e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の CurlyBracketShape
// 波括弧 (縦の線は size × 幅 (既定 0.5) の位置。塗らない)
const curlyBracket: ShapePainter = actor((c, w, h, e) => {
  c.setFillColor(null);
  const s = w * Math.max(0, Math.min(1, e.num('size', 0.5)));
  c.addPoints([P(w, 0), P(s, 0), P(s, h / 2), P(0, h / 2), P(s, h / 2), P(s, h), P(w, h)], e.rounded, lineArc(e), false);
  c.end();
});

// draw.io の Shapes.js の ParallelMarkerShape
// 並列の印 (幅を 5 つに分けた 1・3・5 番目に、線の色で塗った縦の棒。線の太さは 1)
const parallelMarker: ShapePainter = actor((c, w, h, e) => {
  c.setStrokeWidth(1);
  c.setFillColor(e.stroke);
  const w2 = w / 5;
  c.rect(0, 0, w2, h);
  c.fillAndStroke();
  c.rect(2 * w2, 0, w2, h);
  c.fillAndStroke();
  c.rect(4 * w2, 0, w2, h);
  c.fillAndStroke();
});

// draw.io の Shapes.js の ProcessShape (process2 も同じ)
// 処理 (定義済みの処理) の四角に、左右から size × 幅 (既定 0.1。fixedSize なら px) の内側の縦の線。rounded なら線を角の丸めの外へ出す
const process: ShapePainter = rectShape((c, w, h, e) => {
  let inset = e.num('size', 0.1);
  if (truthy(e, 'fixedSize', false)) inset = Math.max(0, Math.min(w, inset));
  else inset = w * Math.max(0, Math.min(1, inset));
  if (e.rounded) {
    const f = e.num('arcSize', 15) / 100;
    inset = Math.max(inset, Math.min(w * f, h * f));
  }
  inset = Math.round(inset);
  c.begin();
  c.moveTo(inset, 0);
  c.lineTo(inset, h);
  c.moveTo(w - inset, 0);
  c.lineTo(w - inset, h);
  c.end();
  c.stroke();
});

// draw.io の Shapes.js の TransparentShape
// 透明の四角 (塗りも線も無い。当たりの判定のためのもので、何も見えない)
const transparent: ShapePainter = (c, w, h) => {
  c.setFillColor('none');
  c.rect(0, 0, w, h);
  c.fill();
};

// draw.io の Shapes.js の CalloutShape
// 吹き出し (下に size (既定 30) の高さの尾。尾の根元は position (既定 0.5) から base (既定 20) の幅、先は position2 (既定 0.5))
const callout: ShapePainter = actor((c, w, h, e) => {
  const s = Math.max(0, Math.min(h, e.num('size', 30)));
  const dx = w * Math.max(0, Math.min(1, e.num('position', 0.5)));
  const dx2 = w * Math.max(0, Math.min(1, e.num('position2', 0.5)));
  const base = Math.max(0, Math.min(w, e.num('base', 20)));
  c.addPoints(
    [P(0, 0), P(w, 0), P(w, h - s), P(Math.min(w, dx + base), h - s), P(dx2, h), P(Math.max(0, dx), h - s), P(0, h - s)],
    e.rounded,
    lineArc(e),
    true,
    [4],
  );
});

// draw.io の Shapes.js の WedgeCalloutShape
// 先を自由に置ける吹き出し (四角に、くさびの尾。先は真ん中から幅・高さの tipX (既定 -0.25)・tipY (既定 1) 倍の所 (±100 倍まで)、
// 根元の幅は base (既定 20)。先が四角の中なら尾は無い)
const wedgeCallout: ShapePainter = actor((c, w, h, e) => {
  const max = 100;
  const tx0 = e.num('tipX', -0.25);
  const ty0 = e.num('tipY', 1);
  const tx = Math.max(-max, Math.min(max, Number.isFinite(tx0) ? tx0 : -0.25));
  const ty = Math.max(-max, Math.min(max, Number.isFinite(ty0) ? ty0 : 1));
  const arcSize = lineArc(e);
  const pts = [P(0, 0), P(w, 0), P(w, h), P(0, h)];
  let exclude: number[] | undefined;
  // getTailPoints: 尾の根元・先・根元と、時計回りの経路に差し込む位置
  const dx = tx * w;
  const dy = ty * h;
  let tail: { points: Pt[]; index: number } | undefined;
  if (!(Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2)) {
    const b0 = e.num('base', 20);
    const base = Number.isFinite(b0) ? Math.max(0, b0) : 20;
    let inset = e.rounded ? arcSize : 0;
    const tp = P(w / 2 + dx, h / 2 + dy);
    if (Math.abs(dx) * h >= Math.abs(dy) * w && dx !== 0) {
      // 尾は左か右の辺から出る
      inset = Math.min(inset, h / 2);
      const hb = Math.max(0, Math.min(base, h - 2 * inset)) / 2;
      let ey = h / 2 + (dy * (w / 2)) / Math.abs(dx);
      ey = Math.max(inset + hb, Math.min(h - inset - hb, ey));
      tail = dx > 0 ? { points: [P(w, ey - hb), tp, P(w, ey + hb)], index: 2 } : { points: [P(0, ey + hb), tp, P(0, ey - hb)], index: 4 };
    } else {
      // 尾は上か下の辺から出る
      inset = Math.min(inset, w / 2);
      const hb = Math.max(0, Math.min(base, w - 2 * inset)) / 2;
      let ex = w / 2 + (dx * (h / 2)) / Math.abs(dy);
      ex = Math.max(inset + hb, Math.min(w - inset - hb, ex));
      tail = dy > 0 ? { points: [P(ex + hb, h), tp, P(ex - hb, h)], index: 3 } : { points: [P(ex - hb, 0), tp, P(ex + hb, 0)], index: 1 };
    }
  }
  if (tail) {
    pts.splice(tail.index, 0, ...tail.points);
    exclude = [tail.index, tail.index + 1, tail.index + 2];
  }
  c.addPoints(pts, e.rounded, arcSize, true, exclude);
});

// draw.io の Shapes.js の StepShape
// 工程の矢羽 (右を尖らせ、左を凹ませた形。深さは size × 幅、size の既定 0.2。fixedSize なら px で、既定 20)
const step: ShapePainter = actor((c, w, h, e) => {
  const s = fixedOf(e) ? Math.max(0, Math.min(w, e.num('size', 20))) : w * Math.max(0, Math.min(1, e.num('size', 0.2)));
  c.addPoints([P(0, 0), P(w - s, 0), P(w, h / 2), P(w - s, h), P(0, h), P(s, h / 2)], e.rounded, lineArc(e), true);
  c.end();
});

// draw.io の Shapes.js の HexagonShape
// 横長の六角形 (左右の尖りの深さは size × 幅、size の既定 0.25。fixedSize なら px で、既定 20、幅の半分まで)
const hexagon: ShapePainter = actor((c, w, h, e) => {
  const s = fixedOf(e) ? Math.max(0, Math.min(w * 0.5, e.num('size', 20))) : w * Math.max(0, Math.min(1, e.num('size', 0.25)));
  c.addPoints([P(s, 0), P(w - s, 0), P(w, 0.5 * h), P(w - s, h), P(s, h), P(0, 0.5 * h)], e.rounded, lineArc(e), true);
});

// draw.io の Shapes.js の PlusShape
// 四角の中に十字 (縁から短い辺の 1/5 + 1 だけ内側)
const plus: ShapePainter = rectShape((c, w, h) => {
  const border = Math.min(w / 5, h / 5) + 1;
  c.begin();
  c.moveTo(w / 2, border);
  c.lineTo(w / 2, h - border);
  c.moveTo(border, h / 2);
  c.lineTo(w - border, h / 2);
  c.end();
  c.stroke();
});

// draw.io の Shapes.js の ExtendedShape
// 四角 (double=1 なら内側にもう 1 つ) に、記号 (symbol0・symbol1… に形の名前、…Align・…VerticalAlign・…Width・…Height・
// …Spacing・…VSpacing・…ArcSpacing で置き場) を重ねる。記号の形は、このファイルの形だけを描ける
const ext: ShapePainter = (c, w0, h0, e) => {
  rectBackground(c, 0, 0, w0, h0, e);
  c.setShadow(false);
  let x = 0;
  let y = 0;
  let w = w0;
  let h = h0;
  if (e.num('double', 0) === 1) {
    const margin = Math.max(2, e.strokeWidth + 1) + (e.num('margin', 0) || 0);
    x += margin;
    y += margin;
    w -= 2 * margin;
    h -= 2 * margin;
    if (w > 0 && h > 0) rectBackground(c, x, y, w, h, e);
  }
  c.setDashed(false);
  // 記号は、その形を新しく作って描く (ソースの new shape()。スタイルは同じものを渡し、線の太さ・塗り・線・丸めは形の既定のまま)
  const sub: ShapeEnv = { ...e, fill: undefined, stroke: undefined, strokeWidth: 1, rounded: false };
  for (let counter = 0; ; counter++) {
    const name = e.str(`symbol${counter}`, '');
    const shape = Object.hasOwn(SHAPES_A, name) ? SHAPES_A[name] : undefined;
    if (!shape) break;
    const k = `symbol${counter}`;
    const align = e.str(`${k}Align`, '');
    const valign = e.str(`${k}VerticalAlign`, '');
    const width = e.num(`${k}Width`, NaN);
    const height = e.num(`${k}Height`, NaN);
    let spacing = e.num(`${k}Spacing`, 0) || 0;
    let vspacing = e.num(`${k}VSpacing`, 0) || spacing;
    const arcspacing = e.num(`${k}ArcSpacing`, NaN);
    if (!Number.isNaN(arcspacing)) {
      const arc = arcSizeOf(e, w + e.strokeWidth, h + e.strokeWidth) * arcspacing;
      spacing += arc;
      vspacing += arc;
    }
    // 幅・高さの無い記号は置けない (ソースでは位置が NaN になる)
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    let x2 = x;
    let y2 = y;
    if (align === 'center') x2 += (w - width) / 2;
    else if (align === 'right') x2 += w - width - spacing;
    else x2 += spacing;
    if (valign === 'middle') y2 += (h - height) / 2;
    else if (valign === 'bottom') y2 += h - height - vspacing;
    else y2 += vspacing;
    c.save();
    c.translate(x2, y2);
    shape(c, width, height, sub);
    c.restore();
  }
};

// draw.io の Shapes.js の MessageShape
// 封筒 (四角と、上の角から真ん中へ下がる V の線)
const message: ShapePainter = cylinder((c, w, h, _e, fg) => {
  if (fg) {
    c.moveTo(0, 0);
    c.lineTo(w / 2, h / 2);
    c.lineTo(w, 0);
    c.end();
  } else {
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
  }
});

/** draw.io の Shapes.js の標準の形 (形の名前 → 描き方) */
export const SHAPES_A: Record<string, ShapePainter> = {
  tableLine,
  cube,
  isoRectangle,
  waypoint,
  isoCube,
  datastore,
  note,
  note2: note,
  isoCube2,
  cylinder2,
  cylinder3,
  switch: switchShape,
  folder,
  umlState,
  smileyFace,
  card,
  tape,
  document: documentShape,
  parallelogram,
  trapezoid,
  curlyBracket,
  parallelMarker,
  process,
  process2: process,
  transparent,
  callout,
  wedgeCallout,
  step,
  hexagon,
  plus,
  ext,
  message,
};
