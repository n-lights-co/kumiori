/**
 * drawioJs/archimate — draw.io の ArchiMate (2・3)・C4・UML 2.5・DFD の JavaScript で書かれた形を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io (v24.7.5) の公開のソース (Apache License 2.0) の src/main/webapp/shapes/ の mxArchiMate.js・mxArchiMate3.js・
 * mxC4.js・mxUML25.js・mxDFD.js の各形の paintVertexShape・background・foreground と、mxGraph の mxEllipse.paintVertexShape。
 * v24.7.5 に無い形 (mxArchiMate4.js の ArchiMate 4 の形と、mxC4.js の mxShapeC4MobileDeviceContainer) は除いた。
 * 呼ぶ側 (drawio.ts) がセルの位置へ移してから呼ぶので、元のソースの x・y は 0 とみなす。
 * 接続点 (getConstraints)・文字の置き場・customProperties の画面の部分・影は移さない。
 *
 * 元のソースは、ある形の背景を、別の形のプロトタイプの関数として呼ぶ (mxArchiMate3Plateau.prototype.background(c, …) など)。
 * そのときの this はプロトタイプで、スタイルを持たないので、mxUtils.getValue(this.style, …) は既定の値になる
 * (たとえば、ArchiMate 3 の application の右上の印の塗りは、セルの線の色に関わらず #000000)。これに合わせ、その呼び出しでは
 * スタイルを読まない口 (bare) を渡す。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/shape/mxActor.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxEllipse.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencilRegistry.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxCellRenderer.js: Copyright (c) 2006-2017, JGraph Holdings Ltd; Copyright (c) 2006-2017, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxArchiMate.js: Copyright (c) 2006-2014, JGraph Ltd
 *   shapes/mxArchiMate3.js: Copyright (c) 2006-2016, JGraph Ltd
 *   shapes/mxC4.js: Copyright (c) 2006-2018, JGraph Ltd
 *   shapes/mxDFD.js: Copyright (c) 2006-2018, JGraph Ltd
 *   shapes/mxUML25.js: (元のファイルに著作権表示は無い)
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';

/** 形の部分を描く関数 (元のソースの background・foreground。w・h はその部分の幅と高さ) */
type Bg = (c: ShapeCanvas, w: number, h: number, e: ShapeEnv) => void;

/** スタイルを読まない口 (プロトタイプを this にして呼ぶ関数に渡す。どのキーも既定の値になる) */
const bare = (e: ShapeEnv): ShapeEnv => ({
  ...e,
  str: (_k, d) => d,
  num: (_k, d) => d,
  color: (_k, d) => d,
  flag: (_k, d = false) => d,
});

/** JavaScript の真偽 (mxUtils.getValue(style, key, false) をそのまま if に使う書き方。スタイルの値は文字なので、空でなければ真。'0' も真) */
const jsTruthy = (e: ShapeEnv, key: string) => e.str(key, '') !== '';

/**
 * mxUML25.js の action の角の半径: parseFloat(mxUtils.getValue(style, 'arcSize', this.arcSize))。this.arcSize は定義が無いので、
 * arcSize が無ければ NaN。absoluteArcSize が無ければ、arcSize を短い辺に掛ける (元のソースのとおり、100 で割らない)。
 * 幅・高さの半分までに抑える (v24.7.5 は 0 より下を抑えない。NaN は NaN のまま)
 */
const umlArcSize = (w: number, h: number, e: ShapeEnv) => {
  const absArcSize = jsTruthy(e, 'absoluteArcSize');
  let arcSize = parseFloat(e.str('arcSize', ''));
  if (!absArcSize) arcSize = Math.min(w, h) * arcSize;
  return Math.min(arcSize, w * 0.5, h * 0.5);
};

// ───────────── ArchiMate 3 (draw.io の shapes/mxArchiMate3.js) ─────────────

const application: Bg = (c, w, h, e) => {
  applicationBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  applicationFg(c, 15, 15, e);
};

const applicationBg: Bg = (c, w, h, e) => {
  const archiType = e.str('archiType', 'square');
  if (archiType === 'rounded') {
    c.roundrect(0, 0, w, h, 10, 10);
  } else if ((archiType === 'oct') && w >= 20 && h >= 20) {
    c.begin();
    c.moveTo(0, 10);
    c.lineTo(10, 0);
    c.lineTo(w - 10, 0);
    c.lineTo(w, 10);
    c.lineTo(w, h - 10);
    c.lineTo(w - 10, h);
    c.lineTo(10, h);
    c.lineTo(0, h - 10);
    c.close();
    c.fillAndStroke();
  } else {
    c.rect(0, 0, w, h);
  }
  c.fillAndStroke();
};

const applicationFg: Bg = (c, w, h, e) => {
  const type = e.str('appType', '');
  c.setDashed(false);
  if (type === 'comp') {
    c.translate(1, 0);
    w = w - 2;
    componentBg(c, w, h, bare(e));
  } else if (type === 'collab') {
    c.translate(0, 3);
    h = h - 6;
    collaborationBg(c, w, h, bare(e));
  } else if (type === 'interface') {
    c.translate(0, 4);
    h = h - 8;
    interfaceBg(c, w, h, bare(e));
  } else if (type === 'interface2') {
    c.translate(0, 1);
    h = h - 2;
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.6, h * 0.5);
    c.moveTo(w, 0);
    c.arcTo(w * 0.4, h * 0.5, 0, 0, 0, w, h);
    c.stroke();
  } else if (type === 'facility') {
    facilityBg(c, w, h, bare(e));
  } else if (type === 'func') {
    functionBg(c, w, h, bare(e));
  } else if (type === 'gap') {
    gapIconBg(c, w, h, bare(e));
  } else if (type === 'interaction') {
    interactionBg(c, w, h, bare(e));
  } else if (type === 'location') {
    locationIconBg(c, w, h, bare(e));
  } else if (type === 'serv') {
    c.translate(0, 3);
    h = h - 6;
    serviceBg(c, w, h, bare(e));
  } else if (type === 'equipment') {
    equipmentBg(c, w, h, bare(e));
  } else if (type === 'event') {
    c.translate(0, 3);
    h = h - 6;
    eventBg(c, w, h, bare(e));
  } else if (type === 'event2') {
    c.translate(0, 3);
    h = h - 6;
    event2Bg(c, w, h, bare(e));
  } else if (type === 'node') {
    nodeBg(c, w, h, bare(e));
  } else if (type === 'generic') {
  } else if (type === 'netw') {
    networkBg(c, w, h, bare(e));
  } else if (type === 'commPath') {
    c.translate(0, 5);
    h = h - 10;
    c.begin();
    c.moveTo(w * 0.1, 0);
    c.lineTo(0, h * 0.5);
    c.lineTo(w * 0.1, h);
    c.moveTo(w * 0.9, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.9, h);
    c.stroke();
    c.setDashed(true);
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.stroke();
  } else if (type === 'artifact') {
    c.translate(2, 0);
    w = w - 4;
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.7, 0);
    c.lineTo(w, h * 0.22);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.moveTo(w * 0.7, 0);
    c.lineTo(w * 0.7, h * 0.22);
    c.lineTo(w, h * 0.22);
    c.stroke();
  } else if (type === 'actor') {
    c.translate(3, 0);
    w = w - 6;
    actorBg(c, w, h, bare(e));
  } else if (type === 'role') {
    c.translate(0, 3);
    h = h - 6;
    roleBg(c, w, h, bare(e));
  } else if (type === 'passive') {
    c.translate(0, 3);
    h = h - 6;
    passiveBg(c, w, h, bare(e));
  } else if (type === 'plateau') {
    c.translate(0, 2);
    h = h - 4;
    plateauBg(c, w, h, bare(e));
  } else if (type === 'product') {
    c.translate(0, 3);
    h = h - 6;
    productSmallBg(c, w, h, bare(e));
  } else if (type === 'contract') {
    c.translate(0, 3);
    h = h - 6;
    contractSmallBg(c, w, h, bare(e));
  } else if (type === 'proc') {
    c.translate(0, 3);
    h = h - 6;
    processBg(c, w, h, bare(e));
  } else if (type === 'deliverable') {
    c.translate(0, 2);
    h = h - 4;
    deliverableBg(c, w, h, bare(e));
  } else if (type === 'device') {
    deviceBg(c, w, h, bare(e));
  } else if (type === 'driver') {
    driverBg(c, w, h, bare(e));
  } else if (type === 'assess') {
    assessmentBg(c, w, h, bare(e));
  } else if (type === 'goal') {
    goalBg(c, w, h, bare(e));
  } else if (type === 'grouping') {
    c.translate(0, 2);
    h = h - 4;
    c.setDashed(true);
    groupingBg(c, w, h, bare(e));
  } else if (type === 'outcome') {
    outcomeBg(c, w, h, bare(e));
  } else if (type === 'principle') {
    principleBg(c, w, h, bare(e));
  } else if (type === 'representation') {
    c.translate(0, 3);
    h = h - 6;
    representationSmallBg(c, w, h, bare(e));
  } else if (type === 'requirement') {
    c.translate(0, 4);
    h = h - 8;
    requirementBg(c, w, h, bare(e));
  } else if (type === 'constraint') {
    c.translate(0, 4);
    h = h - 8;
    constraintBg(c, w, h, bare(e));
  } else if (type === 'material') {
    c.translate(0, 1);
    h = h - 2;
    materialBg(c, w, h, bare(e));
  } else if (type === 'meaning') {
    c.translate(0, 2);
    h = h - 4;
    // mxStencilRegistry.getStencil('mxgraph.basic.cloud_callout').drawShape (図形ライブラリ basic の形。無ければ描かない)
    c.stencil('mxgraph.basic.cloud_callout', 0, 0, w, h);
  } else if (type === 'distribution') {
    c.translate(0, 4);
    h = h - 8;
    distributionBg(c, w, h, bare(e));
  } else if (type === 'resource') {
    c.translate(0, 1);
    h = h - 2;
    resourceBg(c, w, h, bare(e));
  } else if (type === 'capability') {
    capabilityBg(c, w, h, bare(e));
  } else if (type === 'course') {
    courseBg(c, w, h, bare(e));
  } else if (type === 'sysSw') {
    sysSwBg(c, w, h, bare(e));
  // (元のソースは、ここに 2 つ目の artifact の分岐 (artifact の背景を描く) を持つが、上の artifact の分岐が先に当たるので、通らない)
  } else if (type === 'path') {
    c.translate(0, 5);
    h = h - 10;
    pathBg(c, w, h, bare(e));
  } else if (type === 'amValue') {
    c.translate(0, 3);
    h = h - 6;
    // mxEllipse.paintVertexShape
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  } else if (type === 'valueStream') {
    c.translate(0, 2);
    h = h - 4;
    valueStreamBg(c, w, h, bare(e));
  } else if (type === 'workPackage') {
    c.translate(0, 1);
    h = h - 2;
    workPackageBg(c, w, h, bare(e));
  }
};

const componentBg: Bg = (c, w, h) => {
  c.rect(w * 0.25, 0, w * 0.75, h);
  c.fillAndStroke();
  c.rect(0, h * 0.25, w * 0.5, h * 0.15);
  c.fillAndStroke();
  c.rect(0, h * 0.6, w * 0.5, h * 0.15);
  c.fillAndStroke();
};

const collaborationBg: Bg = (c, w, h) => {
  c.ellipse(0, 0, w * 0.6, h);
  c.fillAndStroke();
  c.ellipse(w * 0.4, 0, w * 0.6, h);
  c.fillAndStroke();
};

const interfaceBg: Bg = (c, w, h) => {
  c.ellipse(w * 0.5, 0, w * 0.5, h);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w * 0.5, h * 0.5);
  c.stroke();
};

const contractSmallBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, h * 0.2);
  c.lineTo(w, h * 0.2);
  c.moveTo(0, h * 0.8);
  c.lineTo(w, h * 0.8);
  c.fillAndStroke();
};

const representationSmallBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.moveTo(0, h * 0.2);
  c.lineTo(w, h * 0.2);
  c.fillAndStroke();
};

const passiveBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, h * 0.2);
  c.lineTo(w, h * 0.2);
  c.fillAndStroke();
};

const plateauBg: Bg = (c, w, h, e) => {
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.rect(w * 0.4, 0, w * 0.6, h * 0.2);
  c.fill();
  c.rect(w * 0.2, h * 0.4, w * 0.6, h * 0.2);
  c.fill();
  c.rect(0, h * 0.8, w * 0.6, h * 0.2);
  c.fill();
};

const productSmallBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, h * 0.2);
  c.lineTo(w * 0.5, h * 0.2);
  c.lineTo(w * 0.5, 0);
  c.fillAndStroke();
};

const processBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, h * 0.3);
  c.lineTo(w * 0.6, h * 0.3);
  c.lineTo(w * 0.6, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.6, h);
  c.lineTo(w * 0.6, h * 0.7);
  c.lineTo(0, h * 0.7);
  c.close();
  c.fillAndStroke();
};

const driverBg: Bg = (c, w, h, e) => {
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.moveTo(w * 0.5, 0);
  c.lineTo(w * 0.5, h);
  c.moveTo(w * 0.145, h * 0.145);
  c.lineTo(w * 0.855, h * 0.855);
  c.moveTo(w * 0.145, h * 0.855);
  c.lineTo(w * 0.855, h * 0.145);
  c.stroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.ellipse(w * 0.35, h * 0.35, w * 0.3, h * 0.3);
  c.fillAndStroke();
  c.setStrokeWidth(2);
  c.ellipse(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
  c.stroke();
};

const assessmentBg: Bg = (c, w, h) => {
  c.ellipse(w * 0.2, 0, w * 0.8, h * 0.8);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, h);
  c.lineTo(w * 0.32, h * 0.68);
  c.stroke();
};

const goalBg: Bg = (c, w, h, e) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.ellipse(w * 0.15, h * 0.15, w * 0.7, h * 0.7);
  c.stroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.ellipse(w * 0.3, h * 0.3, w * 0.4, h * 0.4);
  c.fillAndStroke();
};

const outcomeBg: Bg = (c, w, h, e) => {
  const sw = e.num('strokeWidth', 1);
  c.ellipse(0, w * 0.2, w * 0.8, h * 0.8);
  c.fillAndStroke();
  c.ellipse(w * 0.15, w * 0.35, w * 0.5, h * 0.5);
  c.stroke();
  c.ellipse(w * 0.3, w * 0.5, w * 0.2, h * 0.2);
  c.stroke();
  c.setStrokeWidth(3 * sw);
  c.setLineCap('round');    
  c.begin();
  c.moveTo(w * 0.4, h * 0.6);
  c.lineTo(w * 0.9, h * 0.1);
  c.moveTo(w * 0.42, h * 0.4);
  c.lineTo(w * 0.4, h * 0.6);
  c.lineTo(w * 0.6, h * 0.58);
  c.moveTo(w * 0.8, 0);
  c.lineTo(w * 0.75, h * 0.25);
  c.lineTo(w, h * 0.2);
  c.stroke();
};

const principleBg: Bg = (c, w, h, e) => {
  c.begin();
  c.moveTo(w * 0.05, h * 0.05);
  c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.95, h * 0.05);
  c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.95, h * 0.95);
  c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.05, h * 0.95);
  c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.05, h * 0.05);
  c.close();
  c.fillAndStroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.begin();
  c.moveTo(w * 0.45, h * 0.7);
  c.lineTo(w * 0.42, h * 0.15);
  c.lineTo(w * 0.58, h * 0.15);
  c.lineTo(w * 0.55, h * 0.7);
  c.close();
  c.fill();
  c.rect(w * 0.45, h * 0.75, w * 0.1, h * 0.1);
  c.fill();
};

const facilityBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, h);
  c.lineTo(0, 0);
  c.lineTo(w * 0.13, 0);
  c.lineTo(w * 0.13, h * 0.7);
  c.lineTo(w * 0.42, h * 0.55);
  c.lineTo(w * 0.42, h * 0.7);
  c.lineTo(w * 0.71, h * 0.55);
  c.lineTo(w * 0.71, h * 0.7);
  c.lineTo(w, h * 0.55);
  c.lineTo(w, h);
  c.close();
  c.fillAndStroke();
};

const functionBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.5, 0);
  c.lineTo(w, h * 0.2);
  c.lineTo(w, h);
  c.lineTo(w * 0.5, h * 0.8);
  c.lineTo(0, h);
  c.lineTo(0, h * 0.2);
  c.close();
  c.fillAndStroke();
};

const groupingBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, h * 0.3);
  c.lineTo(w, h * 0.3);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, h * 0.3);
  c.lineTo(0, 0);
  c.lineTo(w * 0.75, 0);
  c.lineTo(w * 0.75, h * 0.3);
  c.fillAndStroke();
};

const interactionBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.55, 0);
  c.arcTo(w * 0.45, h * 0.5, 0, 0, 1, w * 0.55, h);
  c.close();
  c.moveTo(w * 0.45, 0);
  c.arcTo(w * 0.45, h * 0.5, 0, 0, 0, w * 0.45, h);
  c.close();
  c.fillAndStroke();
};

const materialBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w * 0.25, 0);
  c.lineTo(w * 0.75, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.75, h);
  c.lineTo(w * 0.25, h);
  c.close();
  c.moveTo(w * 0.15, h * 0.5);
  c.lineTo(w * 0.31, h * 0.2);
  c.moveTo(w * 0.69, h * 0.2);
  c.lineTo(w * 0.85, h * 0.5);
  c.moveTo(w * 0.68, h * 0.80);
  c.lineTo(w * 0.32, h * 0.80);
  c.fillAndStroke();
};

const locationIconBg: Bg = (c, w, h) => {
  c.translate(3, 0);
  w = w - 6;
  c.begin();
  c.moveTo(w * 0.5, 0);
  c.curveTo(w * 0.2842, 0, 0, h * 0.1006, 0, h * 0.3001);
  c.curveTo(0, h * 0.4071, w * 0.0776, h * 0.4777, w * 0.1524, h * 0.5485);
  c.curveTo(w * 0.2901, h * 0.6788, w * 0.4275, h * 0.7993, w * 0.5, h);
  c.curveTo(w * 0.5725, h * 0.7993, w * 0.7099, h * 0.6788, w * 0.8476, h * 0.5485);
  c.curveTo(w * 0.9224, h * 0.4777, w, h * 0.4071, w, h * 0.3001);
  c.curveTo(w, h * 0.1006, w * 0.7158, 0, w * 0.5, 0);
  c.close();
  c.fillAndStroke();
};

const serviceBg: Bg = (c, w, h) => {
  const w1 = Math.max(w - h * 0.5, w * 0.5);
  const w2 = Math.min(h * 0.5, w * 0.5);
  c.begin();
  c.moveTo(w1, 0);
  c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w1, h);
  c.lineTo(w2, h);
  c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w2, 0);
  c.close();
  c.fillAndStroke();
};

const requirementBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.25, 0);
  c.lineTo(w, 0);
  c.lineTo(w * 0.75, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
};

const constraintBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.25, 0);
  c.lineTo(w, 0);
  c.lineTo(w * 0.75, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(w * 0.45, 0);
  c.lineTo(w * 0.2, h);
  c.fillAndStroke();
};

/** 設備 (equipment) の 2 つの歯車の経路 (元のソースの曲線の制御点には、y に w を掛けたものがあるが、そのまま写す) */
const equipmentPath = (c: ShapeCanvas, w: number, h: number) => {
  c.begin();
  c.moveTo(w * 0.72, h * 0.38);
  c.curveTo(w * 0.78, w * 0.38, w * 0.85, h * 0.34, w * 0.85, h * 0.26);
  c.curveTo(w * 0.85, w * 0.18, w * 0.78, h * 0.14, w * 0.73, h * 0.14);
  c.curveTo(w * 0.64, w * 0.14, w * 0.59, h * 0.2, w * 0.59, h * 0.26);
  c.curveTo(w * 0.59, h * 0.33, w * 0.65, w * 0.38, w * 0.72, h * 0.38);
  c.close();
  c.moveTo(w * 0.68, h * 0.52);
  c.lineTo(w * 0.67, h * 0.45);
  c.lineTo(w * 0.61, h * 0.43);
  c.lineTo(w * 0.56, h * 0.48);
  c.lineTo(w * 0.5, h * 0.42);
  c.lineTo(w * 0.54, h * 0.36);
  c.lineTo(w * 0.52, h * 0.31);
  c.lineTo(w * 0.45, h * 0.31);
  c.lineTo(w * 0.45, h * 0.22);
  c.lineTo(w * 0.52, h * 0.21);
  c.lineTo(w * 0.54, h * 0.16);
  c.lineTo(w * 0.5, h * 0.11);
  c.lineTo(w * 0.56, h * 0.05);
  c.lineTo(w * 0.62, h * 0.09);
  c.lineTo(w * 0.67, h * 0.07);
  c.lineTo(w * 0.68, 0);
  c.lineTo(w * 0.77, 0);
  c.lineTo(w * 0.78, h * 0.07);
  c.lineTo(w * 0.83, h * 0.09);
  c.lineTo(w * 0.89, h * 0.05);
  c.lineTo(w * 0.95, h * 0.11);
  c.lineTo(w * 0.91, h * 0.16);
  c.lineTo(w * 0.93, h * 0.21);
  c.lineTo(w, h * 0.22);
  c.lineTo(w, h * 0.31);
  c.lineTo(w * 0.93, h * 0.31);
  c.lineTo(w * 0.91, h * 0.36);
  c.lineTo(w * 0.95, h * 0.41);
  c.lineTo(w * 0.89, h * 0.47);
  c.lineTo(w * 0.83, h * 0.43);
  c.lineTo(w * 0.78, h * 0.45);
  c.lineTo(w * 0.77, h * 0.52);
  c.lineTo(w * 0.68, h * 0.52);
  c.close();
  c.moveTo(w * 0.36, h * 0.81);
  c.curveTo(w * 0.44, h * 0.81, w * 0.52, h * 0.75, w * 0.52, h * 0.67);
  c.curveTo(w * 0.52, h * 0.59, w * 0.45, h * 0.51, w * 0.35, h * 0.51);
  c.curveTo(w * 0.27, h * 0.51, w * 0.19, h * 0.58, w * 0.19, h * 0.67);
  c.curveTo(w * 0.19, h * 0.74, w * 0.27, h * 0.82, w * 0.36, h * 0.81);
  c.close();
  c.moveTo(w * 0.21, h * 0.98);
  c.lineTo(w * 0.22, h * 0.89);
  c.lineTo(w * 0.16, h * 0.85);
  c.lineTo(w * 0.08, h * 0.88);
  c.lineTo(w * 0.02, h * 0.79);
  c.lineTo(w * 0.09, h * 0.74);
  c.lineTo(w * 0.08, h * 0.67);
  c.lineTo(0, h * 0.63);
  c.lineTo(w * 0.03, h * 0.53);
  c.lineTo(w * 0.12, h * 0.54);
  c.lineTo(w * 0.16, h * 0.48);
  c.lineTo(w * 0.13, h * 0.4);
  c.lineTo(w * 0.22, h * 0.35);
  c.lineTo(w * 0.28, h * 0.42);
  c.lineTo(w * 0.36, h * 0.41);
  c.lineTo(w * 0.39, h * 0.33);
  c.lineTo(w * 0.5, h * 0.36);
  c.lineTo(w * 0.49, h * 0.45);
  c.lineTo(w * 0.55, h * 0.49);
  c.lineTo(w * 0.63, h * 0.45);
  c.lineTo(w * 0.69, h * 0.54);
  c.lineTo(w * 0.62, h * 0.6);
  c.lineTo(w * 0.63, h * 0.67);
  c.lineTo(w * 0.71, h * 0.7);
  c.lineTo(w * 0.68, h * 0.8);
  c.lineTo(w * 0.59, h * 0.79);
  c.lineTo(w * 0.55, h * 0.85);
  c.lineTo(w * 0.59, h * 0.79);
  c.lineTo(w * 0.55, h * 0.85);
  c.lineTo(w * 0.59, h * 0.93);
  c.lineTo(w * 0.49, h * 0.98);
  c.lineTo(w * 0.43, h * 0.91);
  c.lineTo(w * 0.36, h * 0.92);
  c.lineTo(w * 0.32, h);
  c.lineTo(w * 0.21, h * 0.98);
  c.close();
};

const equipmentBg: Bg = (c, w, h) => {
  equipmentPath(c, w, h);
  c.fillAndStroke();
};

const eventBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w - h * 0.5, 0);
  c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w - h * 0.5, h);
  c.lineTo(0, h);
  c.lineTo(h * 0.5, h * 0.5);
  c.lineTo(0, 0);
  c.close();
  c.fillAndStroke();
};

const event2Bg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w - h * 0.5, 0);
  c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w - h * 0.5, h);
  c.lineTo(0, h);
  c.arcTo(h * 0.5, h * 0.5, 0, 0, 0, 0, 0);
  c.close();
  c.fillAndStroke();
};

const actorBg: Bg = (c, w, h) => {
  c.ellipse(w * 0.2, 0, w * 0.6, h * 0.3);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.5, h * 0.3);
  c.lineTo(w * 0.5, h * 0.75);
  c.moveTo(0, h * 0.45);
  c.lineTo(w, h * 0.45);
  c.moveTo(0, h);
  c.lineTo(w * 0.5, h * 0.75);
  c.lineTo(w, h);
  c.stroke();
};

const roleBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.8, 0);
  c.lineTo(w * 0.2, 0);
  c.arcTo(w * 0.2, h * 0.5, 0, 0, 0, w * 0.2, h);
  c.lineTo(w * 0.8, h);
  c.fillAndStroke();
  c.ellipse(w * 0.6, 0, w * 0.4, h);
  c.fillAndStroke();
};

const businessObject: Bg = (c, w, h, e) => {
  businessObjectBg(c, w, h, e);
  c.setShadow(false);
  businessObjectFg(c, w, h, e);
};

const businessObjectBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const businessObjectFg: Bg = (c, w, h) => {
  if (h >= 15) {
    c.begin();
    c.moveTo(0, 15);
    c.lineTo(w, 15);
    c.stroke();
  }
};

const contract: Bg = (c, w, h, e) => {
  contractBg(c, w, h, e);
  c.setShadow(false);
  contractFg(c, w, h, e);
};

const contractBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const contractFg: Bg = (c, w, h) => {
  if (h >= 15) {
    c.begin();
    c.moveTo(0, 15);
    c.lineTo(w, 15);
    c.stroke();
  }
  if (h >= 30) {
    c.begin();
    c.moveTo(0, h - 15);
    c.lineTo(w,  h - 15);
    c.stroke();
  }

};

const product: Bg = (c, w, h, e) => {
  productBg(c, w, h, e);
  c.setShadow(false);
  productFg(c, w, h, e);
};

const productBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const productFg: Bg = (c, w, h) => {
  if (h >= 15) {
    c.begin();
    c.moveTo(0, 15);
    c.lineTo(w * 0.6, 15);
    c.lineTo(w * 0.6, 0);
    c.stroke();
  }
};

const representationBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.fillAndStroke();
  // 元のソースの if (h >= 20) は c.begin() だけに掛かる。経路は塗った後で空なので、高さに関わらず線を引く
  c.begin();
  c.moveTo(0, 15);
  c.lineTo(w, 15);
  c.stroke();
};

const deliverableBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.fillAndStroke();
};

const location: Bg = (c, w, h, e) => {
  locationBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  locationFg(c, 15, 15, e);
};

const locationBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const locationFg: Bg = (c, w, h) => {
  c.setDashed(false);
  c.translate(3 ,0);
  w = w - 6;
  c.begin();
  c.moveTo(w * 0.5, h);
  c.arcTo(w * 0.1775, h * 0.3, 0, 0, 0, w * 0.345, h * 0.7);
  c.arcTo(w * 0.538, h * 0.364, 0, 0, 1, w * 0.5, 0);
  c.arcTo(w * 0.538, h * 0.364, 0, 0, 1, w * 0.655, h * 0.7);
  c.arcTo(w * 0.1775, h * 0.3, 0, 0, 0, w * 0.5, h);
  c.stroke();
};

const gap: Bg = (c, w, h, e) => {
  gapBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  gapFg(c, 15, 15, e);
};

const gapBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.fillAndStroke();
};

const gapFg: Bg = (c, w, h) => {
  c.setDashed(false);
  c.translate(0, 2);
  h = h - 4;
  c.ellipse(w * 0.15, 0, w * 0.7, h);
  c.stroke();
  c.begin();
  c.moveTo(0, h * 0.35);
  c.lineTo(w, h * 0.35);
  c.moveTo(0, h * 0.65);
  c.lineTo(w, h * 0.65);
  c.stroke();
};

const gapIconBg: Bg = (c, w, h) => {
  c.setDashed(false);
  c.translate(0, 2);
  h = h - 4;
  c.ellipse(w * 0.15, 0, w * 0.7, h);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, h * 0.35);
  c.lineTo(w, h * 0.35);
  c.moveTo(0, h * 0.65);
  c.lineTo(w, h * 0.65);
  c.stroke();
};

const tech: Bg = (c, w, h, e) => {
  techBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 30, 15);
  techFg(c, 15, 15, e);
};

const techBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 10);
  c.lineTo(10, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h - 10);
  c.lineTo(w - 10, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, 10);
  c.lineTo(w - 10, 10);
  c.lineTo(w - 10, h);
  c.moveTo(w, 0);
  c.lineTo(w - 10, 10);
  c.fillAndStroke();
};

const techFg: Bg = (c, w, h, e) => {
  const type = e.str('techType', 'device');
  c.setDashed(false);
  if (type === 'plateau') {
    const strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.rect(w * 0.4, 0, w * 0.6, h * 0.2);
    c.fill();
    c.rect(w * 0.2, h * 0.4, w * 0.6, h * 0.2);
    c.fill();
    c.rect(0, h * 0.8, w * 0.6, h * 0.2);
    c.fill();
  } else if (type === 'facility') {
    c.begin();
    c.moveTo(0, h);
    c.lineTo(0, 0);
    c.lineTo(w * 0.13, 0);
    c.lineTo(w * 0.13, h * 0.7);
    c.lineTo(w * 0.42, h * 0.55);
    c.lineTo(w * 0.42, h * 0.7);
    c.lineTo(w * 0.71, h * 0.55);
    c.lineTo(w * 0.71, h * 0.7);
    c.lineTo(w, h * 0.55);
    c.lineTo(w, h);
    c.close();
    c.stroke();
  } else if (type === 'equipment') {
    equipmentPath(c, w, h);
    c.stroke();
  } else if (type === 'sysSw') {
    sysSwBg(c, w, h, bare(e));
  } else if (type === 'device') {
    deviceBg(c, w, h, bare(e));
  }
};

const distributionBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.1, h * 0.25);
  c.lineTo(w * 0.9, h * 0.25);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.9, h * 0.75);
  c.lineTo(w * 0.1, h * 0.75);
  c.lineTo(0, h * 0.5);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.2, 0);
  c.lineTo(0, h * 0.5);
  c.lineTo(w * 0.2, h);
  c.moveTo(w * 0.8, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.8, h);
  c.stroke();
};

const resourceBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.51, h * 0.34);
  c.lineTo(w * 0.51, h * 0.65);
  c.moveTo(w * 0.35, h * 0.34);
  c.lineTo(w * 0.35, h * 0.65);
  c.moveTo(w * 0.19, h * 0.34);
  c.lineTo(w * 0.19, h * 0.65);
  c.moveTo(w * 0.91, h * 0.4);
  c.curveTo(w * 0.93, h * 0.39, w * 0.95, h * 0.39, w * 0.97, h * 0.40);
  c.curveTo(w * 0.99, h * 0.4, w, h * 0.41, w, h * 0.43);
  c.curveTo(w, h * 0.48, w, h * 0.52, w, h * 0.57);
  c.curveTo(w, h * 0.58, w * 0.99, h * 0.59, w * 0.98, h * 0.6);
  c.curveTo(w * 0.96, h * 0.6, w * 0.93, h * 0.6, w * 0.91, h * 0.6);
  c.moveTo(0, h * 0.73);
  c.curveTo(0, h * 0.6, 0, h * 0.43, 0, h * 0.27);
  c.curveTo(0, h * 0.24, w * 0.03, h * 0.21, w * 0.08, h * 0.21);
  c.curveTo(w * 0.33, h * 0.2, w * 0.61, h * 0.2, w * 0.84, h * 0.21);
  c.curveTo(w * 0.88, h * 0.22, w * 0.89, h * 0.24, w * 0.9, h * 0.26);
  c.curveTo(w * 0.91, h * 0.41, w * 0.91, h * 0.57, w * 0.9, h * 0.72);
  c.curveTo(w * 0.9, h * 0.74, w * 0.88, h * 0.78, w * 0.83, h * 0.79);
  c.curveTo(w * 0.57, h * 0.79, w * 0.32, h * 0.79, w * 0.06, h * 0.79);
  c.curveTo(w * 0.02, h * 0.78, 0, h * 0.76, 0, h * 0.73);
  c.close();
  c.fillAndStroke();
};

const capabilityBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, h * 0.67);
  c.lineTo(w * 0.33, h * 0.67);
  c.lineTo(w * 0.33, h * 0.33);
  c.lineTo(w * 0.67, h * 0.33);
  c.lineTo(w * 0.67, 0);
  c.close();
  c.moveTo(w * 0.67, h * 0.33);
  c.lineTo(w, h * 0.33);
  c.moveTo(w * 0.33, h * 0.67);
  c.lineTo(w, h * 0.67);
  c.moveTo(w * 0.33, h * 0.67);
  c.lineTo(w * 0.33, h);
  c.moveTo(w * 0.67, h * 0.33);
  c.lineTo(w * 0.67, h);
  c.fillAndStroke();
};

const courseBg: Bg = (c, w, h, e) => {
  let sw = e.num('strokeWidth', 1);
  c.ellipse(w * 0.4, 0, w * 0.6, h * 0.6);
  c.fillAndStroke();
  c.ellipse(w * 0.5, h * 0.1, w * 0.4, h * 0.4);
  c.stroke();
  c.setStrokeWidth(3 * sw);
  c.setLineCap('round');    
  c.begin();
  c.moveTo(0, h);
  c.arcTo(w * 0.7, h * 0.7, 0, 0, 1, w * 0.41, h * 0.56);
  c.moveTo(w * 0.14, h * 0.54);
  c.lineTo(w * 0.41, h * 0.56);
  c.lineTo(w * 0.3, h * 0.78);
  c.stroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.ellipse(w * 0.6, h * 0.2, w * 0.2, h * 0.2);
  c.fill();
};

const nodeBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, h * 0.25);
  c.lineTo(w * 0.25, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.75);
  c.lineTo(w * 0.75, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, h * 0.25);
  c.lineTo(w * 0.75, h * 0.25);
  c.lineTo(w * 0.75, h);
  c.moveTo(w, 0);
  c.lineTo(w * 0.75, h * 0.25);
  c.fillAndStroke();
};

const networkBg: Bg = (c, w, h, e) => {
  c.translate(0, 2);
  h = h - 4;
  c.begin();
  c.moveTo(w * 0.4, h * 0.2);
  c.lineTo(w * 0.85, h * 0.2);
  c.lineTo(w * 0.6, h * 0.8);
  c.lineTo(w * 0.15, h * 0.8);
  c.close();
  c.stroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.ellipse(w * 0.25, 0, w * 0.3, h * 0.4);
  c.fill();
  c.ellipse(w * 0.7, 0, w * 0.3, h * 0.4);
  c.fill();
  c.ellipse(0, h * 0.6, w * 0.3, h * 0.4);
  c.fill();
  c.ellipse(w * 0.45, h * 0.6, w * 0.3, h * 0.4);
  c.fill();
};

const deviceBg: Bg = (c, w, h) => {
  c.roundrect(0, 0, w, h * 0.88, w * 0.1, h * 0.1);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.1, h * 0.88);
  c.lineTo(0, h);
  c.lineTo(w, h);
  c.lineTo(w * 0.9, h * 0.88);
  c.fillAndStroke();
};

const sysSwBg: Bg = (c, w, h) => {
  c.ellipse(w * 0.3, 0, w * 0.7, h * 0.7);
  c.fillAndStroke();
  c.ellipse(0, h * 0.02, w * 0.98, h * 0.98);
  c.fillAndStroke();
};

const artifactBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w * 0.7, 0);
  c.lineTo(w, h * 0.22);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.7, 0);
  c.lineTo(w * 0.7, h * 0.22);
  c.lineTo(w, h * 0.22);
  c.stroke();
};

const commNetwBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.2, h);
  c.lineTo(0, h * 0.5);
  c.lineTo(w * 0.2, 0);
  c.moveTo(w * 0.8, h);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.8, 0);
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.stroke();
};

const pathBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(w * 0.2, h);
  c.lineTo(0, h * 0.5);
  c.lineTo(w * 0.2, 0);
  c.moveTo(w * 0.8, h);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.8, 0);
  c.stroke();
  c.setDashed(true);
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.stroke();
};

const valueStreamBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w * 0.75, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.75, h);
  c.lineTo(w * 0, h);
  c.lineTo(w * 0.25, h * 0.5);
  c.close();
  c.fillAndStroke();
  
};

const workPackageBg: Bg = (c, w, h, e) => {
  c.begin();
  c.moveTo(w * 0.733, h * 0.7765);
  c.lineTo(w * 0.3308, h * 0.7765);
  c.curveTo(w * 0.1856, h * 0.7765, w * 0.034, h * 0.6281, w * 0.034, h * 0.3939);
  c.curveTo(w * 0.0314, h * 0.2015, w * 0.1742, h * 0.0381, w * 0.3308, h * 0.0381);
  c.curveTo(w * 0.5106, h * 0.0381, w * 0.6267, h * 0.2026, w * 0.6267, h * 0.3939);
  c.curveTo(w * 0.6267, h * 0.4924, w * 0.5785, h * 0.603, w * 0.4776, h * 0.6743);
  c.stroke();
  const strokeColor = e.color('strokeColor', '#000000');
  c.setFillColor(strokeColor);
  c.begin();
  c.moveTo(w * 0.7247, h * 0.908);
  c.lineTo(w * 0.7247, h * 0.6418);
  c.lineTo(w * 0.9147, h * 0.7749);
  c.close();
  c.fillAndStroke();
};

// ───────────── ArchiMate 2 (draw.io の shapes/mxArchiMate.js) ─────────────

const amLocation: Bg = (c, w, h, e) => {
  amLocationBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  amLocationFg(c, 15, 15, e);
};

const amLocationBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const amLocationFg: Bg = (c, w, h) => {
  c.setDashed(false);
  c.translate(3 ,0);
  w = w - 6;
  c.begin();
  c.moveTo(w * 0.5, h);
  c.arcTo(w * 0.1775, h * 0.3, 0, 0, 0, w * 0.345, h * 0.7);
  c.arcTo(w * 0.538, h * 0.364, 0, 0, 1, w * 0.5, 0);
  c.arcTo(w * 0.538, h * 0.364, 0, 0, 1, w * 0.655, h * 0.7);
  c.arcTo(w * 0.1775, h * 0.3, 0, 0, 0, w * 0.5, h);
  c.stroke();
};

const amBusiness: Bg = (c, w, h, e) => {
  amBusinessBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  amBusinessFg(c, 15, 15, e);
};

const amBusinessBg: Bg = (c, w, h) => {
  c.roundrect(0, 0, w, h, 10, 10);
  c.fillAndStroke();
};

const amBusinessFg: Bg = (c, w, h, e) => {
  const type = e.str('busType', 'process');
  c.setDashed(false);
  if (type === 'process') {
    c.translate(0, 2);
    h = h - 4;
    c.begin();
    c.moveTo(0, h * 0.15);
    c.lineTo(w * 0.65, h * 0.15);
    c.lineTo(w * 0.65, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.65, h);
    c.lineTo(w * 0.65, h * 0.85);
    c.lineTo(0, h * 0.85);
    c.close();
    c.stroke();
  } else if (type === 'function') {
    c.translate(2, 0);
    w = w - 4;
    c.begin();
    c.moveTo(0, h * 0.15);
    c.lineTo(w * 0.5, 0);
    c.lineTo(w, h * 0.15);
    c.lineTo(w, h);
    c.lineTo(w * 0.5, h * 0.85);
    c.lineTo(0, h);
    c.close();
    c.stroke();
  } else if (type === 'interaction') {
    c.begin();
    c.moveTo(w * 0.55, 0);
    c.arcTo(w * 0.45, h * 0.5, 0, 0, 1, w * 0.55, h);
    c.close();
    c.moveTo(w * 0.45, 0);
    c.arcTo(w * 0.45, h * 0.5, 0, 0, 0, w * 0.45, h);
    c.close();
    c.stroke();
  } else if (type === 'event') {
    c.translate(0, 3);
    h = h - 6;
    c.begin();
    c.moveTo(w - h * 0.5, 0);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w - h * 0.5, h);
    c.lineTo(0, h);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 0, 0, 0);
    c.close();
    c.stroke();
  } else if (type === 'service') {
    c.translate(0, 3);
    h = h - 6;
    c.begin();
    c.moveTo(w - h * 0.5, 0);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w - h * 0.5, h);
    c.lineTo(0, h);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, 0, 0);
    c.close();
    c.stroke();
  }
};

const amBusinessObject: Bg = (c, w, h, e) => {
  amBusinessObjectBg(c, w, h, e);
  c.setShadow(false);
  amBusinessObjectFg(c, w, h, e);
};

const amBusinessObjectBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const amBusinessObjectFg: Bg = (c, w, h) => {
  if (h >= 15) {
    c.begin();
    c.moveTo(0, 15);
    c.lineTo(w, 15);
    c.stroke();
  }
};

const amRepresentationBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.fillAndStroke();
};

const amProduct: Bg = (c, w, h, e) => {
  amProductBg(c, w, h, e);
  c.setShadow(false);
  amProductFg(c, w, h, e);
};

const amProductBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const amProductFg: Bg = (c, w, h) => {
  if (h >= 15) {
    c.begin();
    c.moveTo(0, 15);
    c.lineTo(w * 0.6, 15);
    c.lineTo(w * 0.6, 0);
    c.stroke();
  }
};

const amApplication: Bg = (c, w, h, e) => {
  amApplicationBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  amApplicationFg(c, 15, 15, e);
};

const amApplicationBg: Bg = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

const amApplicationFg: Bg = (c, w, h, e) => {
  const type = e.str('appType', 'comp');
  c.setDashed(false);
  if (type === 'comp') {
    c.translate(1, 0);
    w = w - 2;
    c.rect(w * 0.25, 0, w * 0.75, h);
    c.stroke();
    c.rect(0, h * 0.25, w * 0.5, h * 0.15);
    c.fillAndStroke();
    c.rect(0, h * 0.6, w * 0.5, h * 0.15);
    c.fillAndStroke();
  } else if (type === 'collab') {
    c.translate(0, 3);
    h = h - 6;
    c.ellipse(0, 0, w * 0.6, h);
    c.stroke();
    c.ellipse(w * 0.4, 0, w * 0.6, h);
    c.fillAndStroke();
  } else if (type === 'interface') {
    c.translate(0, 4);
    h = h - 8;
    c.ellipse(w * 0.5, 0, w * 0.5, h);
    c.stroke();
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.5, h * 0.5);
    c.stroke();
  } else if (type === 'interface2') {
    c.translate(0, 1);
    h = h - 2;
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.6, h * 0.5);
    c.moveTo(w, 0);
    c.arcTo(w * 0.4, h * 0.5, 0, 0, 0, w, h);
    c.stroke();
  } else if (type === 'function') {
    c.begin();
    c.moveTo(w * 0.5, 0);
    c.lineTo(w, h * 0.2);
    c.lineTo(w, h);
    c.lineTo(w * 0.5, h * 0.8);
    c.lineTo(0, h);
    c.lineTo(0, h * 0.2);
    c.close();
    c.stroke();
  } else if (type === 'interaction') {
    c.begin();
    c.moveTo(w * 0.55, 0);
    c.arcTo(w * 0.45, h * 0.5, 0, 0, 1, w * 0.55, h);
    c.close();
    c.moveTo(w * 0.45, 0);
    c.arcTo(w * 0.45, h * 0.5, 0, 0, 0, w * 0.45, h);
    c.close();
    c.stroke();
  } else if (type === 'service') {
    c.translate(0, 3);
    h = h - 6;
    c.begin();
    c.moveTo(w - h * 0.5, 0);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, w - h * 0.5, h);
    c.lineTo(0, h);
    c.arcTo(h * 0.5, h * 0.5, 0, 0, 1, 0, 0);
    c.close();
    c.stroke();
  } else if (type === 'node') {
    c.begin();
    c.moveTo(0, h * 0.25);
    c.lineTo(w * 0.25, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h * 0.75);
    c.lineTo(w * 0.75, h);
    c.lineTo(0, h);
    c.close();
    c.moveTo(0, h * 0.25);
    c.lineTo(w * 0.75, h * 0.25);
    c.lineTo(w * 0.75, h);
    c.moveTo(w, 0);
    c.lineTo(w * 0.75, h * 0.25);
    c.stroke();
  } else if (type === 'network') {
    c.translate(0, 2);
    h = h - 4;
    c.begin();
    c.moveTo(w * 0.4, h * 0.2);
    c.lineTo(w * 0.85, h * 0.2);
    c.lineTo(w * 0.6, h * 0.8);
    c.lineTo(w * 0.15, h * 0.8);
    c.close();
    c.stroke();
    const strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.ellipse(w * 0.25, 0, w * 0.3, h * 0.4);
    c.fill();
    c.ellipse(w * 0.7, 0, w * 0.3, h * 0.4);
    c.fill();
    c.ellipse(0, h * 0.6, w * 0.3, h * 0.4);
    c.fill();
    c.ellipse(w * 0.45, h * 0.6, w * 0.3, h * 0.4);
    c.fill();
  } else if (type === 'commPath') {
    c.translate(0, 5);
    h = h - 10;
    c.begin();
    c.moveTo(w * 0.1, 0);
    c.lineTo(0, h * 0.5);
    c.lineTo(w * 0.1, h);
    c.moveTo(w * 0.9, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.9, h);
    c.stroke();
    c.setDashed(true);
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.stroke();
  } else if (type === 'sysSw') {
    c.ellipse(w * 0.3, 0, w * 0.7, h * 0.7);
    c.stroke();
    c.ellipse(0, h * 0.02, w * 0.98, h * 0.98);
    c.fillAndStroke();
  } else if (type === 'artifact') {
    c.translate(2, 0);
    w = w - 4;
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.7, 0);
    c.lineTo(w, h * 0.22);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.moveTo(w * 0.7, 0);
    c.lineTo(w * 0.7, h * 0.22);
    c.lineTo(w, h * 0.22);
    c.stroke();
  } else if (type === 'actor') {
    c.translate(3, 0);
    w = w - 6;
    c.ellipse(w * 0.2, 0, w * 0.6, h * 0.3);
    c.stroke();
    c.begin();
    c.moveTo(w * 0.5, h * 0.3);
    c.lineTo(w * 0.5, h * 0.75);
    c.moveTo(0, h * 0.45);
    c.lineTo(w, h * 0.45);
    c.moveTo(0, h);
    c.lineTo(w * 0.5, h * 0.75);
    c.lineTo(w, h);
    c.stroke();
  }
  if (type === 'role') {
    c.translate(0, 4);
    h = h - 8;
    c.begin();
    c.moveTo(w * 0.8, 0);
    c.lineTo(w * 0.2, 0);
    c.arcTo(w * 0.2, h * 0.5, 0, 0, 0, w * 0.2, h);
    c.lineTo(w * 0.8, h);
    c.stroke();
    c.ellipse(w * 0.6, 0, w * 0.4, h);
    c.stroke();
  }
};

const amTech: Bg = (c, w, h, e) => {
  amTechBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 30, 15);
  amTechFg(c, 15, 15, e);
};

const amTechBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 10);
  c.lineTo(10, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h - 10);
  c.lineTo(w - 10, h);
  c.lineTo(0, h);
  c.close();
  c.moveTo(0, 10);
  c.lineTo(w - 10, 10);
  c.lineTo(w - 10, h);
  c.moveTo(w, 0);
  c.lineTo(w - 10, 10);
  c.fillAndStroke();
};

const amTechFg: Bg = (c, w, h, e) => {
  const type = e.str('techType', 'device');
  c.setDashed(false);
  if (type === 'device') {
    c.roundrect(0, 0, w, h * 0.88, w * 0.05, h * 0.05);
    c.stroke();
    c.begin();
    c.moveTo(w * 0.1, h * 0.88);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.lineTo(w * 0.9, h * 0.88);
    c.stroke();
  } else if (type === 'plateau') {
    const strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.rect(w * 0.4, 0, w * 0.6, h * 0.2);
    c.fill();
    c.rect(w * 0.2, h * 0.4, w * 0.6, h * 0.2);
    c.fill();
    c.rect(0, h * 0.8, w * 0.6, h * 0.2);
    c.fill();
  }
};

const amMotivational: Bg = (c, w, h, e) => {
  amMotivationalBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  amMotivationalFg(c, 15, 15, e);
};

const amMotivationalBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(10, 0);
  c.lineTo(w - 10, 0);
  c.lineTo(w, 10);
  c.lineTo(w, h - 10);
  c.lineTo(w - 10, h);
  c.lineTo(10, h);
  c.lineTo(0, h - 10);
  c.lineTo(0, 10);
  c.close();
  c.fillAndStroke();
};

const amMotivationalFg: Bg = (c, w, h, e) => {
  const type = e.str('motivType', 'stake');
  c.setDashed(false);
  if (type === 'stake') {
    c.translate(0, 4);
    h = h - 8;
    c.begin();
    c.moveTo(w * 0.8, 0);
    c.lineTo(w * 0.2, 0);
    c.arcTo(w * 0.2, h * 0.5, 0, 0, 0, w * 0.2, h);
    c.lineTo(w * 0.8, h);
    c.stroke();
    c.ellipse(w * 0.6, 0, w * 0.4, h);
    c.stroke();
  } else if (type === 'driver') {
    c.ellipse(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    c.stroke();
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.5, h);
    c.moveTo(w * 0.145, h * 0.145);
    c.lineTo(w * 0.855, h * 0.855);
    c.moveTo(w * 0.145, h * 0.855);
    c.lineTo(w * 0.855, h * 0.145);
    c.stroke();
    let strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.ellipse(w * 0.35, h * 0.35, w * 0.3, h * 0.3);
    c.fillAndStroke();
  } else if (type === 'assess') {
    c.ellipse(w * 0.2, 0, w * 0.8, h * 0.8);
    c.stroke();
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w * 0.32, h * 0.68);
    c.stroke();
  } else if (type === 'goal') {
    c.ellipse(0, 0, w, h);
    c.stroke();
    c.ellipse(w * 0.15, h * 0.15, w * 0.7, h * 0.7);
    c.stroke();
    let strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.ellipse(w * 0.3, h * 0.3, w * 0.4, h * 0.4);
    c.fillAndStroke();
  } else if (type === 'req') {
    c.translate(0, 4);
    h = h - 8;
    c.begin();
    c.moveTo(w * 0.25, 0);
    c.lineTo(w, 0);
    c.lineTo(w * 0.75, h);
    c.lineTo(0, h);
    c.close();
    c.stroke();
  } else if (type === 'const') {
    c.translate(0, 4);
    h = h - 8;
    c.begin();
    c.moveTo(w * 0.25, 0);
    c.lineTo(w, 0);
    c.lineTo(w * 0.75, h);
    c.lineTo(0, h);
    c.close();
    c.moveTo(w * 0.45, 0);
    c.lineTo(w * 0.2, h);
    c.stroke();
  } else if (type === 'princ') {
    c.begin();
    c.moveTo(w * 0.05, h * 0.05);
    c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.95, h * 0.05);
    c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.95, h * 0.95);
    c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.05, h * 0.95);
    c.arcTo(w * 2.3, h * 2.3, 0, 0, 1, w * 0.05, h * 0.05);
    c.close();
    c.stroke();
    let strokeColor = e.color('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.45, h * 0.7);
    c.lineTo(w * 0.42, h * 0.15);
    c.lineTo(w * 0.58, h * 0.15);
    c.lineTo(w * 0.55, h * 0.7);
    c.close();
    c.fill();
    c.rect(w * 0.45, h * 0.75, w * 0.1, h * 0.1);
    c.fill();
  }
};

const amGap: Bg = (c, w, h, e) => {
  amGapBg(c, w, h, e);
  c.setShadow(false);
  c.translate(w - 20, 5);
  amGapFg(c, 15, 15, e);
};

const amGapBg: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 0, w * 0.5, h * 0.85);
  c.arcTo(w * 0.35, h * 0.35, 0, 0, 1, 0, h * 0.85);
  c.close();
  c.fillAndStroke();
};

const amGapFg: Bg = (c, w, h) => {
  c.setDashed(false);
  c.translate(0, 2);
  h = h - 4;
  c.ellipse(w * 0.15, 0, w * 0.7, h);
  c.stroke();
  c.begin();
  c.moveTo(0, h * 0.35);
  c.lineTo(w, h * 0.35);
  c.moveTo(0, h * 0.65);
  c.lineTo(w, h * 0.65);
  c.stroke();
};

// ───────────── C4 (draw.io の shapes/mxC4.js) ─────────────

const c4Person: Bg = (c, w, h) => {
  const headSize = Math.min(w / 2, h / 3);
  const r = headSize / 2;
  c.ellipse(w * 0.5 - headSize * 0.5, 0, headSize, headSize);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, headSize * 0.8 + r);
  c.arcTo(r, r, 0, 0, 1, r, headSize * 0.8);
  c.lineTo(w - r, headSize * 0.8);
  c.arcTo(r, r, 0, 0, 1, w, headSize * 0.8 + r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h -r);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.ellipse(w * 0.5 - headSize * 0.5, 0, headSize, headSize);
  c.fillAndStroke();

};

const c4Person2: Bg = (c, w, h) => {
  const headSize = Math.min(w * 0.45, h * 0.45);
  const r = headSize / 2;
  c.ellipse(w * 0.5 - headSize * 0.5, 0, headSize, headSize);
  c.fillAndStroke();
  c.begin();
  c.moveTo(0, headSize * 0.8 + r);
  c.arcTo(r, r, 0, 0, 1, r, headSize * 0.8);
  c.lineTo(w - r, headSize * 0.8);
  c.arcTo(r, r, 0, 0, 1, w, headSize * 0.8 + r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h -r);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.ellipse(w * 0.5 - headSize * 0.5, 0, headSize, headSize);
  c.fillAndStroke();

};

const c4WebBrowserContainer: Bg = (c, w, h) => {
  const r = 8;
  c.begin();
  c.moveTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h - r);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  const ins = 5;
  const r2 = 3;
  const h2 = 12;
  if (w > (ins * 5 + h2 * 3) && h > (2 * h2 + 3 * ins)) {
    c.setFillColor('#23A2D9');
    c.begin();
    c.moveTo(ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, ins + r2, ins);
    c.lineTo(w - 3 * h2 - 4 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 4 * ins, ins + r2);
    c.lineTo(w - 3 * h2 - 4 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 4 * ins - r2, ins + h2);
    c.lineTo(ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - 3 * h2 - 3 * ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 3 * ins + r2, ins);
    c.lineTo(w - 2 * h2 - 3 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 3 * ins, ins + r2);
    c.lineTo(w - 2 * h2 - 3 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 3 * ins - r2, ins + h2);
    c.lineTo(w - 3 * h2 - 3 * ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 3 * ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - 2 * h2 - 2 * ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 2 * ins + r2, ins);
    c.lineTo(w - h2 - 2 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - 2 * ins, ins + r2);
    c.lineTo(w - h2 - 2 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - 2 * ins - r2, ins + h2);
    c.lineTo(w - 2 * h2 - 2 * ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 2 * ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - h2 - ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - ins + r2, ins);
    c.lineTo(w - ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - ins, ins + r2);
    c.lineTo(w - ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - ins - r2, ins + h2);
    c.lineTo(w - h2 - ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - ins, ins + h2 - r2);
    c.close();
    c.moveTo(ins, h2 + 2 * ins + r);
    c.arcTo(r, r, 0, 0, 1, ins + r, h2 + 2 * ins);
    c.lineTo(w - r - ins, h2 + 2 * ins);
    c.arcTo(r, r, 0, 0, 1, w - ins, h2 + 2 * ins + r);
    c.lineTo(w - ins, h - r - ins);
    c.arcTo(r, r, 0, 0, 1, w - r - ins, h - ins);
    c.lineTo(ins + r, h - ins);
    c.arcTo(r, r, 0, 0, 1, ins, h - r - ins);
    c.close();
    c.fill();
    c.fill();
  }
};

const c4WebBrowserContainer2: Bg = (c, w, h, e) => {
  const r = 8;
  const fillColor = e.color('fillColor', '#ffffff');
  const strokeColor = e.color('strokeColor', '#000000');
  const strokeColor2 = e.color('strokeColor2', '#0E7DAD');
  c.setStrokeColor(strokeColor2);
  c.setFillColor(strokeColor);
  c.begin();
  c.moveTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h - r);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  const ins = 5;
  const r2 = 3;
  const h2 = 12;
  if (w > (ins * 5 + h2 * 3) && h > (2 * h2 + 3 * ins)) {
    // 中の窓は塗りの色 (外の枠は線の色で塗る)
    c.setFillColor(fillColor);
    c.begin();
    c.moveTo(ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, ins + r2, ins);
    c.lineTo(w - 3 * h2 - 4 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 4 * ins, ins + r2);
    c.lineTo(w - 3 * h2 - 4 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 4 * ins - r2, ins + h2);
    c.lineTo(ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - 3 * h2 - 3 * ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 3 * ins + r2, ins);
    c.lineTo(w - 2 * h2 - 3 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 3 * ins, ins + r2);
    c.lineTo(w - 2 * h2 - 3 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 3 * ins - r2, ins + h2);
    c.lineTo(w - 3 * h2 - 3 * ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - 3 * h2 - 3 * ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - 2 * h2 - 2 * ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 2 * ins + r2, ins);
    c.lineTo(w - h2 - 2 * ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - 2 * ins, ins + r2);
    c.lineTo(w - h2 - 2 * ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - 2 * ins - r2, ins + h2);
    c.lineTo(w - 2 * h2 - 2 * ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - 2 * h2 - 2 * ins, ins + h2 - r2);
    c.close();
    c.moveTo(w - h2 - ins, ins + r2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - ins + r2, ins);
    c.lineTo(w - ins - r2, ins);
    c.arcTo(r2, r2, 0, 0, 1, w - ins, ins + r2);
    c.lineTo(w - ins, ins + h2 - r2);
    c.arcTo(r2, r2, 0, 0, 1, w - ins - r2, ins + h2);
    c.lineTo(w - h2 - ins + r2, ins + h2);
    c.arcTo(r2, r2, 0, 0, 1, w - h2 - ins, ins + h2 - r2);
    c.close();
    c.moveTo(ins, h2 + 2 * ins + r);
    c.arcTo(r, r, 0, 0, 1, ins + r, h2 + 2 * ins);
    c.lineTo(w - r - ins, h2 + 2 * ins);
    c.arcTo(r, r, 0, 0, 1, w - ins, h2 + 2 * ins + r);
    c.lineTo(w - ins, h - r - ins);
    c.arcTo(r, r, 0, 0, 1, w - r - ins, h - ins);
    c.lineTo(ins + r, h - ins);
    c.arcTo(r, r, 0, 0, 1, ins, h - r - ins);
    c.close();
    c.fill();
    c.fill();
  }
};

// ───────────── UML 2.5 (draw.io の shapes/mxUML25.js。mxActor を継ぐが、paintVertexShape を上書きする) ─────────────

const umlInputPin: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(w * 0.75, h * 0.5);
  c.lineTo(w * 0.25, h * 0.5);
  c.moveTo(w * 0.4, h * 0.4);
  c.lineTo(w * 0.25, h * 0.5);
  c.lineTo(w * 0.4, h * 0.6);
  c.stroke();
};

const umlBehaviorAction: Bg = (c, w, h, e) => {
  const rounded = jsTruthy(e, 'rounded');
  let arcSize = umlArcSize(w, h, e);
  if (!rounded) {
    arcSize = 0;
  }
  // arcSize が NaN なら、元のソースでは NaN の経路になり、何も見えない (v24.7.5。v32.6.10 は 10 px にする) ので描かない
  if (!isNaN(arcSize)) {
    c.begin();
    if (rounded) {
      c.moveTo(0, arcSize);
      c.arcTo(arcSize, arcSize, 0, 0, 1, arcSize, 0);
      c.lineTo(w - arcSize, 0);
      c.arcTo(arcSize, arcSize, 0, 0, 1, w, arcSize);
      c.lineTo(w, h - arcSize);
      c.arcTo(arcSize, arcSize, 0, 0, 1, w - arcSize, h);
      c.lineTo(arcSize, h);
      c.arcTo(arcSize, arcSize, 0, 0, 1, 0, h - arcSize);
    } else {
      c.moveTo(0, 0);
      c.lineTo(w, 0);
      c.lineTo(w, h);
      c.lineTo(0, h);
    }
    c.close();
    c.fillAndStroke();
  }
  c.setShadow(false);
  if (w >= 60 && h >= 40) {
    c.begin();
    c.moveTo(w - 60, h * 0.5 + 20);
    c.lineTo(w - 60, h * 0.5);
    c.lineTo(w - 20, h * 0.5);
    c.lineTo(w - 20, h * 0.5 + 20);
    c.moveTo(w - 40, h * 0.5 - 20);
    c.lineTo(w - 40, h * 0.5 + 20);
    c.stroke();
  }
};

const umlAction: Bg = (c, w, h, e) => {
  const arcSize = umlArcSize(w, h, e);
  // arcSize が NaN なら、元のソースでは NaN の経路になり、何も見えない (v24.7.5。v32.6.10 は 10 px にする) ので描かない
  if (!isNaN(arcSize)) {
    c.begin();
    c.moveTo(0, arcSize);
    c.arcTo(arcSize, arcSize, 0, 0, 1, arcSize, 0);
    c.lineTo(w - arcSize - 10, 0);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w - 10, arcSize);
    c.lineTo(w - 10, h - arcSize);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w - arcSize - 10, h);
    c.lineTo(arcSize, h);
    c.arcTo(arcSize, arcSize, 0, 0, 1, 0, h - arcSize);
    c.close();
    c.fillAndStroke();
  }
  c.rect(w - 10, h * 0.5 - 10, 10, 20);
  c.fillAndStroke();
};

const umlActionParams: Bg = (c, w, h, e) => {
  const arcSize = umlArcSize(w, h, e);
  // arcSize が NaN なら、元のソースでは NaN の経路になり、何も見えない (v24.7.5。v32.6.10 は 10 px にする) ので描かない
  if (!isNaN(arcSize)) {
    c.begin();
    c.moveTo(20, arcSize);
    c.arcTo(arcSize, arcSize, 0, 0, 1, 20 + arcSize, 0);
    c.lineTo(w - arcSize, 0);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w, arcSize);
    c.lineTo(w, h - arcSize);
    c.arcTo(arcSize, arcSize, 0, 0, 1, w - arcSize, h);
    c.lineTo(20 + arcSize, h);
    c.arcTo(arcSize, arcSize, 0, 0, 1, 20, h - arcSize);
    c.close();
    c.fillAndStroke();
  }
  c.rect(5, h * 0.5 - 17, 20, 34);
  c.fillAndStroke();
  c.rect(0, h * 0.5 - 13, 10, 10);
  c.fillAndStroke();
  c.rect(0, h * 0.5 + 3, 10, 10);
  c.fillAndStroke();
};

// ───────────── DFD (draw.io の shapes/mxDFD.js) ─────────────

const dfdStart: Bg = (c, w, h) => {
  const r = Math.min(h * 0.5, w * 0.5);
  c.begin();
  c.moveTo(w - r, h * 0.5 - r);
  c.arcTo(r, r, 0, 0, 1, w, h * 0.5);
  c.arcTo(r, r, 0, 0, 1, w - r, h * 0.5 + r);
  c.lineTo(r, h * 0.5 + r);
  c.arcTo(r, r, 0, 0, 1, 0, h * 0.5);
  c.arcTo(r, r, 0, 0, 1, r, h * 0.5 - r);
  c.close();
  c.fillAndStroke();
};

const dfdArchive: Bg = (c, w, h) => {
  c.begin();
  c.moveTo(0,0);
  c.lineTo(w, 0);
  c.lineTo(w * 0.5, h);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(w * 0.1, h * 0.2);
  c.lineTo(w * 0.9, h * 0.2);
  c.stroke();
};

const dfdCheck2: Bg = (c, w, h) => {
  const size = Math.min(h * 0.5, w * 0.5);
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(size, 0);
  c.lineTo(w - size, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w - size, h);
  c.lineTo(size, h);
  c.lineTo(0, h * 0.5);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.begin();
  c.moveTo(w - size, 0);
  c.lineTo(w - 2 * size, h * 0.5);
  c.lineTo(w - size, h);
  c.stroke();
};

const dfdDataStoreID: Bg = (c, w, h) => {
  // (元のソースは、ここで使わない size = min(h, w) / 2 を求める)
  c.begin();
  c.moveTo(w, h);
  c.lineTo(0, h);
  c.lineTo(0, 0);
  c.lineTo(w, 0);
  c.fillAndStroke();
  c.setShadow(false);
  const s = Math.min(30, w);
  c.begin();
  c.moveTo(s, 0);
  c.lineTo(s, h);
  c.stroke();
};

const dfdExternalEntity: Bg = (c, w, h) => {
  const size = 10;
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w - size, 0);
  c.lineTo(w, size);
  c.lineTo(w, h);
  c.lineTo(size, h);
  c.lineTo(0, h - size);
  c.close();
  c.fillAndStroke();
  c.setShadow(false);
  c.setFillColor('#000000');
  c.setAlpha(0.5);
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w - size, 0);
  c.lineTo(w, size);
  c.lineTo(size, size);
  c.lineTo(size, h);
  c.lineTo(0, h - size);
  c.close();
  c.fill();
  // 元のソースは setAlpha(opacity / 100) で、セルの不透明度に戻す。Kumiori はセルの不透明度を形の全体に掛けるので、ここでは 1 に戻す
  c.setAlpha(1);
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w - size, 0);
  c.lineTo(w, size);
  c.lineTo(w, h);
  c.lineTo(size, h);
  c.lineTo(0, h - size);
  c.close();
  c.moveTo(size, h);
  c.lineTo(size, size);
  c.lineTo(w, size);
  c.moveTo(0, 0);
  c.lineTo(size, size);
  c.stroke();
};

const dfdLoop: Bg = (c, w, h) => {
  const r = Math.min(h * 0.8, w * 0.8);
  c.begin();
  c.moveTo(w - r * 0.25, 0);
  c.arcTo(r, r, 0, 0, 1, w - r * 0.25, h);
  c.lineTo(r * 0.25, h);
  c.arcTo(r, r, 0, 0, 1, r * 0.25, 0);
  c.close();
  c.fillAndStroke();
};

// ───────────── 形の名前 (mxCellRenderer.registerShape の名前) ─────────────

/** 形の名前 → 描き方。ArchiMate 3 の形の多くは、paintVertexShape が背景 (background) を描くだけなので、背景の関数をそのまま使う */
export const SHAPES_ARCHIMATE: Record<string, ShapePainter> = {
  'mxgraph.archimate3.application': application,
  'mxgraph.archimate3.component': componentBg,
  'mxgraph.archimate3.collaboration': collaborationBg,
  'mxgraph.archimate3.interface': interfaceBg,
  'mxgraph.archimate3.contractSmall': contractSmallBg,
  'mxgraph.archimate3.representationSmall': representationSmallBg,
  'mxgraph.archimate3.passive': passiveBg,
  'mxgraph.archimate3.plateau': plateauBg,
  'mxgraph.archimate3.productSmall': productSmallBg,
  'mxgraph.archimate3.process': processBg,
  'mxgraph.archimate3.driver': driverBg,
  'mxgraph.archimate3.assess': assessmentBg,
  'mxgraph.archimate3.goal': goalBg,
  'mxgraph.archimate3.outcome': outcomeBg,
  'mxgraph.archimate3.principle': principleBg,
  'mxgraph.archimate3.facility': facilityBg,
  'mxgraph.archimate3.function': functionBg,
  'mxgraph.archimate3.grouping': groupingBg,
  'mxgraph.archimate3.interaction': interactionBg,
  'mxgraph.archimate3.material': materialBg,
  'mxgraph.archimate3.locationIcon': locationIconBg,
  'mxgraph.archimate3.service': serviceBg,
  'mxgraph.archimate3.requirement': requirementBg,
  'mxgraph.archimate3.constraint': constraintBg,
  'mxgraph.archimate3.equipment': equipmentBg,
  'mxgraph.archimate3.event': eventBg,
  'mxgraph.archimate3.event2': event2Bg,
  'mxgraph.archimate3.actor': actorBg,
  'mxgraph.archimate3.role': roleBg,
  'mxgraph.archimate3.businessObject': businessObject,
  'mxgraph.archimate3.contract': contract,
  'mxgraph.archimate3.product': product,
  'mxgraph.archimate3.representation': representationBg,
  'mxgraph.archimate3.deliverable': deliverableBg,
  'mxgraph.archimate3.location': location,
  'mxgraph.archimate3.gap': gap,
  'mxgraph.archimate3.gapIcon': gapIconBg,
  'mxgraph.archimate3.tech': tech,
  'mxgraph.archimate3.distribution': distributionBg,
  'mxgraph.archimate3.resource': resourceBg,
  'mxgraph.archimate3.capability': capabilityBg,
  'mxgraph.archimate3.course': courseBg,
  'mxgraph.archimate3.node': nodeBg,
  'mxgraph.archimate3.network': networkBg,
  'mxgraph.archimate3.device': deviceBg,
  'mxgraph.archimate3.sysSw': sysSwBg,
  'mxgraph.archimate3.artifact': artifactBg,
  'mxgraph.archimate3.commNetw': commNetwBg,
  'mxgraph.archimate3.path': pathBg,
  'mxgraph.archimate3.valueStream': valueStreamBg,
  'mxgraph.archimate3.workPackage': workPackageBg,
  'mxgraph.archimate.location': amLocation,
  'mxgraph.archimate.business': amBusiness,
  'mxgraph.archimate.businessObject': amBusinessObject,
  'mxgraph.archimate.representation': amRepresentationBg,
  'mxgraph.archimate.product': amProduct,
  'mxgraph.archimate.application': amApplication,
  'mxgraph.archimate.tech': amTech,
  'mxgraph.archimate.motiv': amMotivational,
  'mxgraph.archimate.gap': amGap,
  'mxgraph.c4.person': c4Person,
  'mxgraph.c4.person2': c4Person2,
  'mxgraph.c4.webBrowserContainer': c4WebBrowserContainer,
  'mxgraph.c4.webBrowserContainer2': c4WebBrowserContainer2,
  'mxgraph.uml25.inputPin': umlInputPin,
  'mxgraph.uml25.behaviorAction': umlBehaviorAction,
  'mxgraph.uml25.action': umlAction,
  'mxgraph.uml25.actionParams': umlActionParams,
  'mxgraph.dfd.start': dfdStart,
  'mxgraph.dfd.archive': dfdArchive,
  'mxgraph.dfd.check2': dfdCheck2,
  'mxgraph.dfd.dataStoreID': dfdDataStoreID,
  'mxgraph.dfd.externalEntity': dfdExternalEntity,
  'mxgraph.dfd.loop': dfdLoop,
};
