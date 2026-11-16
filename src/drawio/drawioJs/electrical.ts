/**
 * drawioJs/electrical — draw.io の電気の図 (mxgraph.electrical.*) と P&ID (mxgraph.pid2valves.*・mxgraph.pid2inst.*・mxgraph.pid2misc.*) の
 * JavaScript で書かれた形を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/mxElectrical.js・pid2/mxPidValves.js・pid2/mxPidInstruments.js・
 * pid2/mxPidMisc.js の各形の paintVertexShape と、それが呼ぶ background・foreground・draw… の関数。
 * 形ごとに、ソースのクラス (名前の頭の mxShape を除いた名前) と同じ名前・同じ中身のクラスに写した (継ぐ形の中身の差し替えも同じに読むため)。
 * 変数は、ソースと同じく var で書く (if の枝で宣言して枝の外で使う変数があり、関数の全体を範囲にする JavaScript の決まりのまま読むため)。
 * ソースの cst の定数 (mxShapePidValve.prototype.cst.GATE など) は、その値の字 ('gate' など) に置き換えた。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移し、向き・反転を済ませるので、paintVertexShape(c, x, y, w, h) の x・y は 0 で呼ぶ。
 * 接続点 (getConstraints・constraints)・つまみ (handleFactory)・影・customProperties の画面の部分は移植しない。
 * スタイルに無い値の既定は、ソースの mxUtils.getValue の既定 (描くときに効く値) で、customProperties の defVal (画面の表示) ではない
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxAbstractCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxElectrical.js: Copyright (c) 2006-2016, JGraph Ltd
 *   shapes/pid2/mxPidInstruments.js: Copyright (c) 2006-2013, JGraph Ltd
 *   shapes/pid2/mxPidMisc.js: Copyright (c) 2006-2013, JGraph Ltd
 *   shapes/pid2/mxPidValves.js: Copyright (c) 2006-2013, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';

/**
 * mxSvgCanvas2D と同じ順の決まりで、ShapeCanvas へ命令を渡す口。根拠: mxGraph の mxSvgCanvas2D.js の begin・rect・ellipse・addNode と
 * mxAbstractCanvas2D.js の addOp・setDashed。
 * - mxSvgCanvas2D は、begin で経路の要素を作り、rect・ellipse で要素をその形に差し替え、fill・stroke で要素を出して要素を無くす。
 *   それで、begin の無いまま rect・ellipse を呼ぶと、その前の経路は捨てられ、fill・stroke の後に begin の無いまま足した経路は描かれない。
 *   経路の要素に点が一つも無いうちの fill・stroke は、何も出さず、要素を残す。ここでも同じにする
 * - setDashed(value, fixDash) は、値を JavaScript の真偽で読む (文字の '0' も真)。fixDash を渡さなければ偽になる
 */
class Mx {
  /** 今の要素 (none: 無い・path: begin で作った経路・shape: rect・ellipse の形) */
  private node: 'none' | 'path' | 'shape' = 'none';
  /** 経路の要素に足した命令の数 */
  private ops = 0;
  constructor(readonly c: ShapeCanvas) {}
  begin() {
    this.node = 'path';
    this.ops = 0;
    this.c.begin();
  }
  private op() {
    if (this.node !== 'path') return false;
    this.ops++;
    return true;
  }
  moveTo(x: number, y: number) {
    if (this.op()) this.c.moveTo(x, y);
  }
  lineTo(x: number, y: number) {
    if (this.op()) this.c.lineTo(x, y);
  }
  quadTo(x1: number, y1: number, x2: number, y2: number) {
    if (this.op()) this.c.quadTo(x1, y1, x2, y2);
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    if (this.op()) this.c.curveTo(x1, y1, x2, y2, x3, y3);
  }
  arcTo(rx: number, ry: number, rot: number, large: number | boolean, sweep: number | boolean, x: number, y: number) {
    if (this.op()) this.c.arcTo(rx, ry, rot, large, sweep, x, y);
  }
  close() {
    if (this.op()) this.c.close();
  }
  rect(x: number, y: number, w: number, h: number) {
    this.node = 'shape';
    this.c.begin();
    this.c.rect(x, y, w, h);
  }
  ellipse(x: number, y: number, w: number, h: number) {
    this.node = 'shape';
    this.c.begin();
    this.c.ellipse(x, y, w, h);
  }
  private emit(fill: boolean, stroke: boolean) {
    if (this.node === 'none' || (this.node === 'path' && this.ops === 0)) return;
    if (fill && stroke) this.c.fillAndStroke();
    else if (fill) this.c.fill();
    else this.c.stroke();
    this.node = 'none';
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
  translate(dx: number, dy: number) {
    this.c.translate(dx, dy);
  }
  setShadow(_on: boolean) {}
  setFillColor(v: string | undefined) {
    this.c.setFillColor(v);
  }
  setDashed(v: unknown, fixDash?: boolean) {
    this.c.setDashed(!!v, !!fixDash);
  }
  setLineJoin(v: string) {
    this.c.setLineJoin(v);
  }
  setFontColor(v: string | undefined) {
    if (v) this.c.setFontColor(v);
  }
  setFontSize(v: number) {
    this.c.setFontSize(v);
  }
  setFontStyle(v: number) {
    this.c.setFontStyle(v);
  }
  setFontFamily(v: string) {
    this.c.setFontFamily(v);
  }
  /**
   * 文字 (mxSvgCanvas2D.text。wrap・format・overflow・clip は、ここの形では使わない)。rotation は、(x, y) を中心に回す
   * (mxSvgCanvas2D の rotate(rotation, x, y)。ここの形は、どれも大きさ 0 の枠で呼ぶ)
   */
  text(x: number, y: number, w: number, h: number, str: string, align: string, valign: string, _wrap?: unknown, _format?: unknown, _overflow?: unknown, _clip?: unknown, rotation = 0) {
    if (!rotation) return this.c.text(x, y, w, h, str, align, valign);
    this.c.save();
    this.c.rotate(rotation, false, false, x, y);
    this.c.text(x, y, w, h, str, align, valign);
    this.c.restore();
  }
}

/**
 * ソースの decodeURIComponent。解けない字の並び (「100%」など) で投げると図の全体が描けないので、解けなければ元の字のまま
 * (Kumiori の守り。v24.7.5 のソースは投げる)
 */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * 繰り返しで描く部分 (入りの線・足・電池・段・受け) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値や 0 の間隔 (間隔が 0 以下・高さが 0 など) で描き終わらないのを防ぐため、上限までは描いて、そこで止める。
 * ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_REPEAT = 1000;
/** mux の選ぶ足 (selectorPins) の回数の上限 (Kumiori の守り。上と同じ扱い)。入り・出の足は、その 2 乗 (1024) まで */
const MAX_SELECTOR_PINS = 10;

/** 形の基底 (mxShape の、スタイルを読む部分) */
class MxShape {
  constructor(readonly e: ShapeEnv) {}
  /** mxUtils.getValue(this.style, k, d) (字の既定) */
  gv(k: string, d: string) {
    return this.e.str(k, d);
  }
  /** mxUtils.getValue(this.style, k, d) (数の既定。スタイルにあれば字) */
  gvn(k: string, d: number): string | number {
    const v = this.e.str(k, '\u0000');
    return v === '\u0000' ? d : v;
  }
  /** 色の mxUtils.getValue (default などを解いた値) */
  col(k: string, d: string) {
    return this.e.color(k, d);
  }
}

type ShapeClass = new (e: ShapeEnv) => { paintVertexShape(c: Mx, x: number, y: number, w: number, h: number): void };
const paint =
  (K: ShapeClass): ShapePainter =>
  (c, w, h, e) =>
    new K(e).paintVertexShape(new Mx(c), 0, 0, w, h);

/** mxShapeElectricalTestPoint (draw.io の shapes/mxElectrical.js) */
class ElectricalTestPoint extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var strokeColor = this.col('strokeColor', '#000000');
    var size = Math.min(w, h);
    c.setFillColor(strokeColor);
    c.begin();
    c.ellipse(w * 0.5 - size / 2, 0, size, size);
    c.fillAndStroke();
    if (h > w) {
      c.begin();
      c.moveTo(w * 0.5, size);
      c.lineTo(w * 0.5, h);
      c.stroke();
    }
  }
}

/** mxShapeElectricalStraightBus (draw.io の shapes/mxElectrical.js) */
class ElectricalStraightBus extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var x1 = w * 0.2;
    var y1 = 0;
    if (w > h) {
      y1 = h * 0.5;
    } else {
      y1 = w / 2;
    }
    c.begin();
    c.moveTo(w - x1, 0);
    c.lineTo(w - x1, h - y1);
    c.lineTo(w, h - y1);
    c.lineTo(w * 0.5, h);
    c.lineTo(0, h - y1);
    c.lineTo(x1, h - y1);
    c.lineTo(x1, 0);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalTwoLineBusElbow (draw.io の shapes/mxElectrical.js) */
class ElectricalTwoLineBusElbow extends MxShape {
  notch = 0;
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var notch = Math.max(0, Math.min(w, parseFloat(String(this.gvn('notch', this.notch)))));
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w, h);
    c.lineTo(w, 0);
    c.stroke();
    var wn = Math.min(w, notch);
    var hn = Math.min(h, notch);
    c.begin();
    c.moveTo(0, h - hn);
    c.lineTo(w - wn, h - hn);
    c.lineTo(w - wn, 0);
    c.stroke();
  }
}

/** mxShapeElectricalThreeLineBusElbow (draw.io の shapes/mxElectrical.js) */
class ElectricalThreeLineBusElbow extends MxShape {
  notch = 0;
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var notch = Math.max(0, Math.min(w, parseFloat(String(this.gvn('notch', this.notch)))));
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w, h);
    c.lineTo(w, 0);
    c.stroke();
    var wn = Math.min(w, notch);
    var hn = Math.min(h, notch);
    c.begin();
    c.moveTo(0, h - hn);
    c.lineTo(w - wn, h - hn);
    c.lineTo(w - wn, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn / 2);
    c.lineTo(w - wn / 2, h - hn / 2);
    c.lineTo(w - wn / 2, 0);
    c.stroke();
  }
}

/** mxShapeElectricalFourLineBusElbow (draw.io の shapes/mxElectrical.js) */
class ElectricalFourLineBusElbow extends MxShape {
  notch = 0;
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var notch = Math.max(0, Math.min(w, parseFloat(String(this.gvn('notch', this.notch)))));
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w, h);
    c.lineTo(w, 0);
    c.stroke();
    var wn = Math.min(w, notch);
    var hn = Math.min(h, notch);
    c.begin();
    c.moveTo(0, h - hn);
    c.lineTo(w - wn, h - hn);
    c.lineTo(w - wn, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn / 3);
    c.lineTo(w - wn / 3, h - hn / 3);
    c.lineTo(w - wn / 3, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 2 / 3);
    c.lineTo(w - wn * 2 / 3, h - hn * 2 / 3);
    c.lineTo(w - wn * 2 / 3, 0);
    c.stroke();
  }
}

/** mxShapeElectricalEightLineBusElbow (draw.io の shapes/mxElectrical.js) */
class ElectricalEightLineBusElbow extends MxShape {
  notch = 0;
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var notch = Math.max(0, Math.min(w, parseFloat(String(this.gvn('notch', this.notch)))));
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w, h);
    c.lineTo(w, 0);
    c.stroke();
    var wn = Math.min(w, notch);
    var hn = Math.min(h, notch);
    c.begin();
    c.moveTo(0, h - hn);
    c.lineTo(w - wn, h - hn);
    c.lineTo(w - wn, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn / 7);
    c.lineTo(w - wn / 7, h - hn / 7);
    c.lineTo(w - wn / 7, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 2 / 7);
    c.lineTo(w - wn * 2 / 7, h - hn * 2 / 7);
    c.lineTo(w - wn * 2 / 7, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 3 / 7);
    c.lineTo(w - wn * 3 / 7, h - hn * 3 / 7);
    c.lineTo(w - wn * 3 / 7, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 4 / 7);
    c.lineTo(w - wn * 4 / 7, h - hn * 4 / 7);
    c.lineTo(w - wn * 4 / 7, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 5 / 7);
    c.lineTo(w - wn * 5 / 7, h - hn * 5 / 7);
    c.lineTo(w - wn * 5 / 7, 0);
    c.stroke();
    c.begin();
    c.moveTo(0, h - hn * 6 / 7);
    c.lineTo(w - wn * 6 / 7, h - hn * 6 / 7);
    c.lineTo(w - wn * 6 / 7, 0);
    c.stroke();
  }
}

/** mxShapeElectricalLogicGate (draw.io の shapes/mxElectrical.js) */
class ElectricalLogicGate extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var numInputs = parseInt(this.gv('numInputs', '2'));
    var spacing = h / numInputs;
    var currH = spacing * 0.5;
    c.begin();
    c.moveTo(w * 0.8, h * 0.5);
    c.lineTo(w, h * 0.5);
    var operation = this.gv('operation', 'and');
    // 入りの線は MAX_REPEAT 本まで (Kumiori の守り)
    for (var i = 0; i < numInputs && i < MAX_REPEAT; i++) {
      c.moveTo(0, currH);
      if (operation == 'and') {
        c.lineTo(w * 0.2, currH);
      } else {
        c.lineTo(w * 0.23, currH);
      }
      currH = currH + spacing;
    }
    c.stroke();
    switch (operation) {
      // xor は、or の前に入りの弧を足す (ソースは case 'xor' から case 'or' へ続けて通る)
      case 'xor':
      case 'or':
        if (operation == 'xor') {
          c.begin();
          c.moveTo(w * 0.1, 0);
          c.arcTo(w * 0.6, h, 0, 0, 1, w * 0.1, h);
          c.stroke();
        }
        c.begin();
        c.moveTo(w * 0.4, 0);
        c.arcTo(w * 0.45, h * 0.83, 0, 0, 1, w * 0.8, h * 0.5);
        c.arcTo(w * 0.45, h * 0.83, 0, 0, 1, w * 0.4, h);
        c.lineTo(w * 0.15, h);
        c.arcTo(w * 0.6, h, 0, 0, 0, w * 0.15, 0);
        c.close();
        c.fillAndStroke();
        break;
      default:
        c.begin();
        c.moveTo(w * 0.2, 0);
        c.lineTo(w * 0.5, 0);
        c.arcTo(w * 0.3, h * 0.5, 0, 0, 1, w * 0.5, h);
        c.lineTo(w * 0.2, h);
        c.close();
        c.fillAndStroke();
    }
    var negating = this.gv('negating', '0');
    if (negating == '1') {
      var negSize;
      if (this.e.str('negSize', '')) {
        var tmpSize = parseFloat(this.gv('negSize', '0.13'));
        negSize = Math.min(w * tmpSize * 0.5, h * tmpSize);
      } else {
        negSize = Math.min(w * 0.04, h * 0.07);
      }
      c.begin();
      c.ellipse(w * 0.8, h * 0.5 - negSize * 0.5, negSize, negSize);
      c.fillAndStroke();
    }
  }
}

/** mxShapeElectricalBuffer (draw.io の shapes/mxElectrical.js) */
class ElectricalBuffer extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.2, h * 0.5);
    c.moveTo(w * 0.8, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.stroke();
    c.begin();
    c.moveTo(w * 0.2, 0);
    c.lineTo(w * 0.8, h * 0.5);
    c.lineTo(w * 0.2, h);
    c.close();
    c.fillAndStroke();
    var negating = this.gv('negating', '0');
    if (negating == '1') {
      var negSize = Math.min(w * 0.04, h * 0.07);
      c.begin();
      c.ellipse(w * 0.8, h * 0.5 - negSize * 0.5, negSize, negSize);
      c.fillAndStroke();
    }
  }
}

/**
 * mxShapeElectricalDualInLineIC (draw.io の shapes/mxElectrical.js)。
 * 足の番号が 1 より小さい (形が小さく、足の数の計算が負になる) ときは、ソース (v24.7.5) は labelNames[番号 - 1] の無い値の
 * toString で投げるが、図の全体が描けなくなるので、その足の名前は描かない (Kumiori の守り。QFPIC も同じ)
 */
class ElectricalDualInLineIC extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var fontColor = this.col('fontColor', '#000000');
    c.setFontColor(fontColor);
    var startPin = this.gv('startPin', 'n');
    var pinLabelType = this.gv('pinLabelType', 'gen');
    var labelNames = safeDecode(this.gv('labelNames', '').toString()).split(',');
    c.begin();
    if (startPin == 'n' || startPin == 's') {
      c.rect(10, 0, w - 20, h);
    } else {
      c.rect(0, 10, w, h - 20);
    }
    c.fillAndStroke();
    var pinSpacing = parseFloat(this.gv('pinSpacing', '20'));
    // 足は、それぞれの辺で MAX_REPEAT 本まで (Kumiori の守り。間隔が 0 以下でも、そこで止まる)
    var pinStyle = this.gv('pinStyle', 'line');
    var fontSize = parseFloat(this.gv('fontSize', '12'));
    if (startPin == 'n' || startPin == 's') {
      var pinsOne = Math.trunc(h / pinSpacing);
    } else {
      var pinsOne = Math.trunc(w / pinSpacing);
    }
    if (pinStyle == 'line') {
      c.setFontSize(fontSize * 0.8);
      var pinCount = 1;
      var currH = pinSpacing * 0.5;
      c.begin();
      if (startPin == 'n' || startPin == 's') {
        while (pinCount * pinSpacing <= h && pinCount <= MAX_REPEAT) {
          c.moveTo(0, currH);
          c.lineTo(10, currH);
          c.moveTo(w - 10, currH);
          c.lineTo(w, currH);
          if (startPin == 'n') {
            var currPinNum = pinCount;
          } else {
            var currPinNum = pinsOne + pinCount;
          }
          if (pinLabelType == 'gen') {
            c.text(20, currH, 0, 0, currPinNum.toString(), 'left', 'middle', 0, null, 0, 0, 0);
          } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
            c.text(20, currH, 0, 0, labelNames[currPinNum - 1].toString(), 'left', 'middle', 0, null, 0, 0, 0);
          }
          if (startPin == 'n') {
            var pc2 = 2 * pinsOne - pinCount + 1;
          } else {
            var pc2 = pinsOne - pinCount + 1;
          }
          if (pinLabelType == 'gen') {
            c.text(w - 20, currH, 0, 0, pc2.toString(), 'right', 'middle', 0, null, 0, 0, 0);
          } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
            c.text(w - 20, currH, 0, 0, labelNames[pc2 - 1].toString(), 'right', 'middle', 0, null, 0, 0, 0);
          }
          currH = currH + pinSpacing;
          pinCount++;
        }
      } else {
        while (pinCount * pinSpacing <= w && pinCount <= MAX_REPEAT) {
          c.moveTo(currH, 0);
          c.lineTo(currH, 10);
          c.moveTo(currH, h - 10);
          c.lineTo(currH, h);
          if (startPin == 'e') {
            var currPinNum = pinsOne - pinCount + 1;
          } else {
            var currPinNum = 2 * pinsOne - pinCount + 1;
          }
          if (pinLabelType == 'gen') {
            c.text(currH, 20, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
            c.text(currH, 20, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          if (startPin == 'e') {
            var pc2 = pinsOne + pinCount;
          } else {
            var pc2 = pinCount;
          }
          if (pinLabelType == 'gen') {
            c.text(currH, h - 20, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
            c.text(currH, h - 20, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          currH = currH + pinSpacing;
          pinCount++;
        }
      }
      c.stroke();
    } else {
      c.setFontSize(fontSize * 0.5);
      var pinCount = 1;
      var currH = pinSpacing * 0.5;
      if (startPin == 'n' || startPin == 's') {
        while (pinCount * pinSpacing <= h && pinCount <= MAX_REPEAT) {
          c.begin();
          c.rect(0, currH - pinSpacing * 0.25, 10, pinSpacing * 0.5);
          c.fillAndStroke();
          c.begin();
          c.rect(w - 10, currH - pinSpacing * 0.25, 10, pinSpacing * 0.5);
          c.fillAndStroke();
          if (startPin == 'n') {
            var currPinNum = pinCount;
          } else {
            var currPinNum = pinsOne + pinCount;
          }
          if (pinLabelType == 'gen') {
            c.text(5, currH + 1, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
            c.text(5, currH + 1, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          if (startPin == 'n') {
            var pc2 = 2 * pinsOne - pinCount + 1;
          } else {
            var pc2 = pinsOne - pinCount + 1;
          }
          if (pinLabelType == 'gen') {
            c.text(w - 5, currH + 1, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
            c.text(w - 5, currH + 1, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          currH = currH + pinSpacing;
          pinCount++;
        }
      } else {
        while (pinCount * pinSpacing <= w && pinCount <= MAX_REPEAT) {
          c.begin();
          c.rect(currH - pinSpacing * 0.25, 0, pinSpacing * 0.5, 10);
          c.fillAndStroke();
          c.begin();
          c.rect(currH - pinSpacing * 0.25, h - 10, pinSpacing * 0.5, 10);
          c.fillAndStroke();
          if (startPin == 'e') {
            var currPinNum = pinsOne - pinCount + 1;
          } else {
            var currPinNum = 2 * pinsOne - pinCount + 1;
          }
          if (pinLabelType == 'gen') {
            c.text(currH, 5, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
            c.text(currH, 5, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          if (startPin == 'e') {
            var pc2 = pinsOne + pinCount;
          } else {
            var pc2 = pinCount;
          }
          if (pinLabelType == 'gen') {
            c.text(currH, h - 5, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
          } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
            c.text(currH, h - 5, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
          }
          currH = currH + pinSpacing;
          pinCount++;
        }
      }
    }
    c.setShadow(false);
    c.begin();
    switch (startPin) {
      case 'e':
        if (h > 40) {
          c.moveTo(w, h * 0.5 - 10);
          c.arcTo(12, 12, 0, 0, 0, w, h * 0.5 + 10);
        }
        break;
      case 's':
        if (w > 40) {
          c.moveTo(w * 0.5 - 10, h);
          c.arcTo(12, 12, 0, 0, 1, w * 0.5 + 10, h);
        }
        break;
      case 'w':
        if (h > 40) {
          c.moveTo(0, h * 0.5 - 10);
          c.arcTo(12, 12, 0, 0, 1, 0, h * 0.5 + 10);
        }
        break;
      default:
        if (w > 40) {
          c.moveTo(w * 0.5 - 10, 0);
          c.arcTo(12, 12, 0, 0, 0, w * 0.5 + 10, 0);
        }
    }
    c.stroke();
  }
}

/** mxShapeElectricalQFPIC (draw.io の shapes/mxElectrical.js) */
class ElectricalQFPIC extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(15, 10);
    c.lineTo(w - 15, 10);
    c.lineTo(w - 10, 15);
    c.lineTo(w - 10, h - 15);
    c.lineTo(w - 15, h - 10);
    c.lineTo(15, h - 10);
    c.lineTo(10, h - 15);
    c.lineTo(10, 15);
    c.close();
    c.fillAndStroke();
    var pinSpacing = parseFloat(this.gv('pinSpacing', '20'));
    // 足は、それぞれの辺で MAX_REPEAT 本まで (Kumiori の守り。間隔が 0 以下でも、そこで止まる)
    var pinStyle = this.gv('pinStyle', 'line');
    var pinLabelType = this.gv('pinLabelType', 'gen');
    var labelNames = safeDecode(this.gv('labelNames', '').toString()).split(',');
    var fontSize = parseFloat(this.gv('fontSize', '12'));
    var fontColor = this.col('fontColor', '#000000');
    c.setFontColor(fontColor);
    var startPin = this.gv('startPin', 'sw');
    if (pinStyle == 'line') {
      c.setFontSize(fontSize * 0.8);
      var pinCount = 1;
      var currH = pinSpacing * 0.5 + 20;
      c.begin();
      var pinsVOne = Math.trunc((h - pinSpacing - 40) / pinSpacing) + 1;
      var pinsHOne = Math.trunc((w - pinSpacing - 40) / pinSpacing) + 1;
      while (currH <= h - pinSpacing * 0.5 - 20 && pinCount <= MAX_REPEAT) {
        c.moveTo(0, currH);
        c.lineTo(10, currH);
        c.moveTo(w - 10, currH);
        c.lineTo(w, currH);
        switch (startPin) {
          case 'nw':
            var currPinNum = pinCount;
            break;
          case 'ne':
            var currPinNum = pinsHOne + pinCount;
            break;
          case 'se':
            var currPinNum = pinsVOne + pinsHOne + pinCount;
            break;
          default:
            var currPinNum = pinsVOne + 2 * pinsHOne + pinCount;
        }
        if (pinLabelType == 'gen') {
          c.text(20, currH, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
          c.text(20, currH, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        switch (startPin) {
          case 'nw':
            var pc2 = pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'ne':
            var pc2 = 2 * pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'se':
            var pc2 = pinsVOne - pinCount + 1;
            break;
          default:
            var pc2 = pinsHOne + pinsVOne - pinCount + 1;
        }
        if (pinLabelType == 'gen') {
          c.text(w - 20, currH, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
          c.text(w - 20, currH, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        currH = currH + pinSpacing;
        pinCount++;
      }
      var pinCount = 1;
      var currH = pinSpacing * 0.5 + 20;
      while (currH <= w - pinSpacing * 0.5 - 20 && pinCount <= MAX_REPEAT) {
        c.moveTo(currH, 0);
        c.lineTo(currH, 10);
        c.moveTo(currH, h - 10);
        c.lineTo(currH, h);
        switch (startPin) {
          case 'nw':
            var currPinNum = pinsVOne + pinCount;
            break;
          case 'ne':
            var currPinNum = pinsVOne + pinsHOne + pinCount;
            break;
          case 'se':
            var currPinNum = 2 * pinsVOne + pinsHOne + pinCount;
            break;
          default:
            var currPinNum = pinCount;
        }
        if (pinLabelType == 'gen') {
          c.text(currH, h - 20, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
          c.text(currH, h - 20, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        switch (startPin) {
          case 'nw':
            var pc2 = 2 * pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'ne':
            var pc2 = pinsHOne - pinCount + 1;
            break;
          case 'se':
            var pc2 = pinsHOne + pinsVOne - pinCount + 1;
            break;
          default:
            var pc2 = 2 * pinsHOne + pinsVOne - pinCount + 1;
        }
        if (pinLabelType == 'gen') {
          c.text(currH, 20, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
          c.text(currH, 20, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        currH = currH + pinSpacing;
        pinCount++;
      }
      c.stroke();
    } else {
      c.setFontSize(fontSize * 0.5);
      var pinCount = 1;
      var currH = pinSpacing * 0.5 + 20;
      var pinsVOne = Math.trunc((h - pinSpacing - 40) / pinSpacing) + 1;
      var pinsHOne = Math.trunc((w - pinSpacing - 40) / pinSpacing) + 1;
      while (currH <= h - pinSpacing * 0.5 - 20 && pinCount <= MAX_REPEAT) {
        c.begin();
        c.rect(0, currH - pinSpacing * 0.25, 10, pinSpacing * 0.5);
        c.fillAndStroke();
        c.begin();
        c.rect(w - 10, currH - pinSpacing * 0.25, 10, pinSpacing * 0.5);
        c.fillAndStroke();
        switch (startPin) {
          case 'nw':
            var currPinNum = pinCount;
            break;
          case 'ne':
            var currPinNum = pinsHOne + pinCount;
            break;
          case 'se':
            var currPinNum = pinsVOne + pinsHOne + pinCount;
            break;
          default:
            var currPinNum = pinsVOne + 2 * pinsHOne + pinCount;
        }
        if (pinLabelType == 'gen') {
          c.text(5, currH + 1, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
          c.text(5, currH + 1, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        switch (startPin) {
          case 'nw':
            var pc2 = pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'ne':
            var pc2 = 2 * pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'se':
            var pc2 = pinsVOne - pinCount + 1;
            break;
          default:
            var pc2 = pinsHOne + pinsVOne - pinCount + 1;
        }
        if (pinLabelType == 'gen') {
          c.text(w - 5, currH + 1, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
          c.text(w - 5, currH + 1, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        currH = currH + pinSpacing;
        pinCount++;
      }
      var pinCount = 1;
      var currH = pinSpacing * 0.5 + 20;
      while (currH <= w - pinSpacing * 0.5 - 20 && pinCount <= MAX_REPEAT) {
        c.begin();
        c.rect(currH - pinSpacing * 0.25, 0, pinSpacing * 0.5, 10);
        c.fillAndStroke();
        c.begin();
        c.rect(currH - pinSpacing * 0.25, h - 10, pinSpacing * 0.5, 10);
        c.fillAndStroke();
        switch (startPin) {
          case 'nw':
            var currPinNum = pinsVOne + pinCount;
            break;
          case 'ne':
            var currPinNum = pinsVOne + pinsHOne + pinCount;
            break;
          case 'se':
            var currPinNum = 2 * pinsVOne + pinsHOne + pinCount;
            break;
          default:
            var currPinNum = pinCount;
        }
        if (pinLabelType == 'gen') {
          c.text(currH, h - 4, 0, 0, currPinNum.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (currPinNum - 1 < labelNames.length && currPinNum >= 1) {
          c.text(currH, h - 4, 0, 0, labelNames[currPinNum - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        switch (startPin) {
          case 'nw':
            var pc2 = 2 * pinsHOne + 2 * pinsVOne - pinCount + 1;
            break;
          case 'ne':
            var pc2 = pinsHOne - pinCount + 1;
            break;
          case 'se':
            var pc2 = pinsHOne + pinsVOne - pinCount + 1;
            break;
          default:
            var pc2 = 2 * pinsHOne + pinsVOne - pinCount + 1;
        }
        if (pinLabelType == 'gen') {
          c.text(currH, 6, 0, 0, pc2.toString(), 'center', 'middle', 0, null, 0, 0, 0);
        } else if (pc2 - 1 < labelNames.length && pc2 >= 1) {
          c.text(currH, 6, 0, 0, labelNames[pc2 - 1].toString(), 'center', 'middle', 0, null, 0, 0, 0);
        }
        currH = currH + pinSpacing;
        pinCount++;
      }
    }
    c.setShadow(false);
    if (w > 40) {
      c.setFillColor(this.col('strokeColor', '#000000'));
      c.begin();
      switch (startPin) {
        case 'nw':
          c.ellipse(15, 15, 10, 10);
          break;
        case 'ne':
          c.ellipse(w - 25, 15, 10, 10);
          break;
        case 'se':
          c.ellipse(w - 25, h - 25, 10, 10);
          break;
        default:
          c.ellipse(15, h - 25, 10, 10);
      }
      c.fillAndStroke();
    }
  }
}

/** mxShapeElectricalMux (draw.io の shapes/mxElectrical.js) */
class ElectricalMux extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var selectorPins = parseInt(this.gv('selectorPins', '1'));
    // 選ぶ足は MAX_SELECTOR_PINS 本まで、入り・出の足は、その 2 乗 (1024) 本まで (Kumiori の守り)
    var maxPins = Math.pow(2, MAX_SELECTOR_PINS);
    var operation = this.gv('operation', 'mux');
    var fontSize = parseFloat(this.gv('fontSize', '12'));
    c.setFontSize(fontSize * 0.5);
    var fontColor = this.col('fontColor', '#000000');
    c.setFontColor(fontColor);
    var dir = this.gv('direction', 'east');
    var txtRot = 0;
    switch (dir) {
      case 'south' :
        txtRot = 270;
        break;
      case 'west' :
        txtRot = 180;
        break;
      case 'north' :
        txtRot = 90;
        break;
    }
    switch (operation) {
      case 'demux':
        c.begin();
        c.moveTo(w - 10, 0);
        c.lineTo(10, h * 0.1);
        c.lineTo(10, h * 0.9 - 10);
        c.lineTo(w - 10, h - 10);
        c.close();
        c.fillAndStroke();
        break;
      default:
        c.begin();
        c.moveTo(10, 0);
        c.lineTo(w - 10, h * 0.1);
        c.lineTo(w - 10, h * 0.9 - 10);
        c.lineTo(10, h - 10);
        c.close();
        c.fillAndStroke();
    }
    var numInputs = 1;
    var numOutputs = 1;
    if (operation == 'mux') {
      numInputs = Math.pow(2, selectorPins);
      var spacing = (h - 16) / numInputs;
    } else {
      numOutputs = Math.pow(2, selectorPins);
      var spacing = (h - 16) / numOutputs;
    }
    var currH = 3 + spacing * 0.5;
    c.begin();
    if (numInputs == 1) {
      c.moveTo(0, (h - 10) * 0.5);
      c.lineTo(10, (h - 10) * 0.5);
    } else {
      for (var i = 0; i < numInputs && i < maxPins; i++) {
        c.moveTo(0, currH);
        c.lineTo(10, currH);
        c.text(14, currH + 1, 0, 0, '' + i.toString(), 'center', 'middle', 0, null, 0, 0, txtRot);
        currH = currH + spacing;
      }
    }
    if (numOutputs == 1) {
      c.moveTo(w - 10, (h - 10) * 0.5);
      c.lineTo(w, (h - 10) * 0.5);
    } else {
      for (var i = 0; i < numOutputs && i < maxPins; i++) {
        c.moveTo(w - 10, currH);
        c.lineTo(w, currH);
        c.text(w - 14, currH + 1, 0, 0, '' + i.toString(), 'center', 'middle', 0, null, 0, 0, txtRot);
        currH = currH + spacing;
      }
    }
    var spacing = (w - 20) / selectorPins;
    var currW = 10 + spacing * 0.5;
    for (var i = 0; i < selectorPins && i < MAX_SELECTOR_PINS; i++) {
      if (operation == 'mux') {
        c.moveTo(currW, h - 10 - (currW - 10) / (w - 20) * h * 0.1);
      } else {
        c.moveTo(currW, h - 10 - (w - currW - 10) / (w - 20) * h * 0.1);
      }
      c.lineTo(currW, h);
      c.text(currW + 5, h -4, 0, 0, 'S' + (selectorPins - i - 1).toString(), 'center', 'middle', 0, null, 0, 0, txtRot);
      currW = currW + spacing;
    }
    c.stroke();
  }
}

/** mxShapeElectricalBatteryStack (draw.io の shapes/mxElectrical.js) */
class ElectricalBatteryStack extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var bw = h * 0.3;
    var strokeColor = this.col('strokeColor', '#000000');
    var dashed = this.gv('dashed', '0');
    var bNum = Math.floor((w - 20) / bw);
    var startX = (w - bNum * bw) * 0.5;
    if (bNum > 0) {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(startX + bw * 0.2, h * 0.5);
      c.moveTo(w - startX - bw * 0.2, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
      var currX = startX;
      c.setFillColor(strokeColor);
      // 電池は MAX_REPEAT 個まで (Kumiori の守り。高さが 0 だと数が無限になる)
      for (var i = 0; i < bNum && i < MAX_REPEAT; i++) {
        c.rect(currX + bw * 0.2, h * 0.25, bw * 0.2, h * 0.5);
        c.fillAndStroke();
        c.begin();
        c.moveTo(currX + bw * 0.8, 0);
        c.lineTo(currX + bw * 0.8, h);
        c.stroke();
        if (i > 0) {
          c.setDashed('1');
          c.begin();
          c.moveTo(currX - bw * 0.2, h * 0.5);
          c.lineTo(currX + bw * 0.2, h * 0.5);
          c.stroke();
          c.setDashed(dashed);
        }
        currX = currX + bw;
      }
    }
  }
}

/** mxShapeElectricalDCSource3_v2 (draw.io の shapes/mxElectrical.js) */
class ElectricalDCSource3_v2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var ss = Math.max(3, Math.min(h, w) * 0.05);
    var i = 3;
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.5 - ss, h * 0.05 + i);
    c.lineTo(w * 0.5 + ss, h * 0.05 + i);
    c.moveTo(w * 0.5, h * 0.05 - ss + i);
    c.lineTo(w * 0.5, h * 0.05 + ss + i);
    c.moveTo(w * 0.5 - ss, h * 0.95 - i);
    c.lineTo(w * 0.5 + ss, h * 0.95 - i);
    c.stroke();
  }
}

/** mxShapeElectricalSource (draw.io の shapes/mxElectrical.js) */
class ElectricalSource extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var sourceType = this.gv('elSourceType', 'independent');
    var signalType = this.gv('elSignalType', 'none');
    switch (sourceType) {
      case "independent" :
          c.ellipse(0, 0, w, h);
          c.fillAndStroke();
        break;
      case "dependent" :
          c.begin();
          c.moveTo(0, h * 0.5);
          c.lineTo(w * 0.5, 0);
          c.lineTo(w, h * 0.5);
          c.lineTo(w * 0.5, h);
          c.lineTo(0, h * 0.5);
          c.close();
          c.fillAndStroke();
        break;
    }
    switch (signalType) {
      case "ac" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.5);
          c.quadTo(w * 0.34, h * 0.35, w * 0.4, h * 0.35);
          c.quadTo(w * 0.46, h * 0.35, w * 0.5, h * 0.5);
          c.quadTo(w * 0.53, h * 0.65, w * 0.6, h * 0.65);
          c.quadTo(w * 0.66, h * 0.65, w * 0.7, h * 0.5);
          c.stroke();
        break;
      case "square" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.5);
          c.lineTo(w * 0.3, h * 0.35);
          c.lineTo(w * 0.5, h * 0.35);
          c.lineTo(w * 0.5, h * 0.65);
          c.lineTo(w * 0.7, h * 0.65);
          c.lineTo(w * 0.7, h * 0.5);
          c.stroke();
        break;
      case "triangular" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.65);
          c.lineTo(w * 0.4, h * 0.35);
          c.lineTo(w * 0.5, h * 0.65);
          c.lineTo(w * 0.6, h * 0.35);
          c.lineTo(w * 0.7, h * 0.65);
          c.stroke();
        break;
      case "sawtooth" :
          c.begin();
          c.moveTo(w * 0.24, h * 0.65);
          c.lineTo(w * 0.42, h * 0.35);
          c.lineTo(w * 0.42, h * 0.65);
          c.lineTo(w * 0.58, h * 0.35);
          c.lineTo(w * 0.58, h * 0.65);
          c.lineTo(w * 0.76, h * 0.35);
          c.lineTo(w * 0.76, h * 0.65);
          c.stroke();
        break;
      case "noise" :
          c.begin();
          c.moveTo(w * 0.5, h * 0.17);
          c.lineTo(w * 0.5, h * 0.5);
          c.moveTo(w * 0.18, h * 0.42);
          c.lineTo(w * 0.5, h * 0.5);
          c.moveTo(w * 0.32, h * 0.78);
          c.lineTo(w * 0.5, h * 0.5);
          c.moveTo(w * 0.82, h * 0.42);
          c.lineTo(w * 0.5, h * 0.5);
          c.moveTo(w * 0.68, h * 0.78);
          c.lineTo(w * 0.5, h * 0.5);
          c.stroke();
        break;
      case "ideal" :
          c.begin();
          c.moveTo(0, h * 0.5);
          c.lineTo(w, h * 0.5);
          c.stroke();
        break;
      case "expSquib" :
          c.ellipse(0, h * 0.43, w * 0.14, h * 0.14);
          c.stroke();
          c.ellipse(w * 0.86, h * 0.43, w * 0.14, h * 0.14);
          c.stroke();
          c.begin();
          c.moveTo(w * 0.83, h * 0.63);
          c.lineTo(w * 0.73, h * 0.73);
          c.lineTo(w * 0.27, h * 0.27);
          c.lineTo(w * 0.17, h * 0.37);
          c.stroke();
          c.begin();
          var strokeColor = this.col('strokeColor', '#000000');
          c.setFillColor(strokeColor);
          c.moveTo(w * 0.2, h * 0.25);
          c.lineTo(w * 0.13, h * 0.4);
          c.lineTo(w * 0.28, h * 0.33);
          c.close();
          c.fillAndStroke();
        break;
      case "pulse" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.65);
          c.lineTo(w * 0.4, h * 0.65);
          c.lineTo(w * 0.4, h * 0.35);
          c.lineTo(w * 0.6, h * 0.35);
          c.lineTo(w * 0.6, h * 0.65);
          c.lineTo(w * 0.7, h * 0.65);
          c.stroke();
        break;
      case "invPulse" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.35);
          c.lineTo(w * 0.4, h * 0.35);
          c.lineTo(w * 0.4, h * 0.65);
          c.lineTo(w * 0.6, h * 0.65);
          c.lineTo(w * 0.6, h * 0.35);
          c.lineTo(w * 0.7, h * 0.35);
          c.stroke();
        break;
      case "chopSquare" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.5);
          c.lineTo(w * 0.33, h * 0.35);
          c.lineTo(w * 0.47, h * 0.35);
          c.lineTo(w * 0.53, h * 0.65);
          c.lineTo(w * 0.67, h * 0.65);
          c.lineTo(w * 0.7, h * 0.5);
          c.stroke();
        break;
      case "stepOn" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.65);
          c.lineTo(w * 0.5, h * 0.65);
          c.lineTo(w * 0.5, h * 0.35);
          c.lineTo(w * 0.7, h * 0.35);
          c.stroke();
        break;
      case "stepOff" :
          c.begin();
          c.moveTo(w * 0.3, h * 0.35);
          c.lineTo(w * 0.5, h * 0.35);
          c.lineTo(w * 0.5, h * 0.65);
          c.lineTo(w * 0.7, h * 0.65);
          c.stroke();
        break;
      case "dc1" :
          c.begin();
          c.moveTo(w * 0.17, h * 0.5);
          c.lineTo(w * 0.83, h * 0.5);
          c.moveTo(w * 0.67, h * 0.42);
          c.lineTo(w * 0.83, h * 0.5);
          c.lineTo(w * 0.67, h * 0.58);
          c.stroke();
        break;
      case "dc2" :
          c.begin();
          c.moveTo(w * 0.5, h * 0.17);
          c.lineTo(w * 0.5, h * 0.83);
          c.moveTo(w * 0.42, h * 0.67);
          c.lineTo(w * 0.5, h * 0.83);
          c.lineTo(w * 0.58, h * 0.67);
          c.stroke();
        break;
      case "dc3" :
          var ss = Math.max(3, Math.min(h, w) * 0.05);
          var i = 3;
          if (sourceType == 'dependent') {
            i += 3;
          }
          c.begin();
          c.moveTo(w * 0.5 - ss, h * 0.05 + i);
          c.lineTo(w * 0.5 + ss, h * 0.05 + i);
          c.moveTo(w * 0.5, h * 0.05 - ss + i);
          c.lineTo(w * 0.5, h * 0.05 + ss + i);
          c.moveTo(w * 0.5 - ss, h * 0.95 - i);
          c.lineTo(w * 0.5 + ss, h * 0.95 - i);
          c.stroke();
        break;
    }
  }
}

/** mxShapeElectricalTwoWaySwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalTwoWaySwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.8 * w, 0.88 * h);
    c.lineTo(w, 0.88 * h);
    c.moveTo(0.8 * w, 0.12 * h);
    c.lineTo(w, 0.12 * h);
    if (switchState == '2') {
      c.moveTo(0.28 * w, 0.48 * h);
      c.lineTo(0.72 * w, 0.15 * h);
    } else {
      c.moveTo(0.28 * w, 0.52 * h);
      c.lineTo(0.72 * w, 0.85 * h);
    }
    c.stroke();
    c.ellipse(0.72 * w, 0.77 * h, 0.08 * w, 0.23 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0, 0.08 * w, 0.23 * h);
    c.fillAndStroke();
    c.ellipse(0.2 * w, 0.385 * h, 0.08 * w, 0.23 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalPushbutton (draw.io の shapes/mxElectrical.js) */
class ElectricalPushbutton extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.2 * w, 0.8 * h);
    c.moveTo(0.8 * w, 0.8 * h);
    c.lineTo(w, 0.8 * h);
    if (switchState == 'off') {
      c.moveTo(0.5 * w, 0.5 * h);
      c.lineTo(0.5 * w, 0);
      c.moveTo(0.46 * w, 0);
      c.lineTo(0.54 * w, 0);
      c.moveTo(0.2 * w, 0.5 * h);
      c.lineTo(0.8 * w, 0.5 * h);
    } else {
      c.moveTo(0.5 * w, h);
      c.lineTo(0.5 * w, 0.5 * h);
      c.moveTo(0.46 * w, 0.5 * h);
      c.lineTo(0.54 * w, 0.5 * h);
      c.moveTo(0.2 * w, h);
      c.lineTo(0.8 * w, h);
    }
    c.stroke();
    c.ellipse(0.72 * w, 0.65 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
    c.ellipse(0.2 * w, 0.65 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalSingleSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalSingleSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.2 * w, 0.8 * h);
    c.moveTo(0.8 * w, 0.8 * h);
    c.lineTo(w, 0.8 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.75 * h);
      c.lineTo(0.76 * w, 0);
    } else {
      c.moveTo(0.2 * w, 0.8 * h);
      c.lineTo(0.8 * w, 0.8 * h);
    }
    c.stroke();
    c.ellipse(0.72 * w, 0.65 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
    c.ellipse(0.2 * w, 0.65 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalSwitchDisconnector (draw.io の shapes/mxElectrical.js) */
class ElectricalSwitchDisconnector extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.84 * h);
    c.lineTo(w, 0.84 * h);
    c.moveTo(0.8 * w, 0.68 * h);
    c.lineTo(0.8 * w, h);
    c.moveTo(0, 0.84 * h);
    c.lineTo(0.24 * w, 0.84 * h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0);
    } else {
      c.lineTo(0.8 * w, 0.84 * h);
    }
    c.stroke();
    c.ellipse(0.72 * w, 0.68 * h, 0.08 * w, 0.32 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalFuse2 (draw.io の shapes/mxElectrical.js) */
class ElectricalFuse2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.8 * h);
    c.lineTo(w, 0.8 * h);
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.25 * w, 0.8 * h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.348 * w, 0.47 * h);
      c.lineTo(0.563 * w, 0.13 * h);
      c.lineTo(0.603 * w, 0.46 * h);
      c.lineTo(0.387 * w, 0.78 * h);
      c.close();
    } else {
      c.lineTo(0.8 * w, 0.8 * h);
      c.moveTo(0.38 * w, 0.6 * h);
      c.lineTo(0.62 * w, 0.6 * h);
      c.lineTo(0.62 * w, h);
      c.lineTo(0.38 * w, h);
      c.close();
    }
    c.stroke();
  }
}

/** mxShapeElectricalLiquidLevelActuatedSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalLiquidLevelActuatedSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.27 * h);
    c.lineTo(w, 0.27 * h);
    c.moveTo(0, 0.27 * h);
    c.lineTo(0.2 * w, 0.27 * h);
    if (switchState == 'off') {
      c.moveTo(0.24 * w, 0);
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.5 * w, 0);
      c.lineTo(0.5 * w, 0.47 * h);
      c.stroke();
      c.ellipse(0.45 * w, 0.47 * h, 0.1 * w, 0.26 * h);
      c.fillAndStroke();
    } else {
      c.moveTo(0.28 * w, 0.27 * h);
      c.lineTo(0.72 * w, 0.27 * h);
      c.moveTo(0.5 * w, 0.27 * h);
      c.lineTo(0.5 * w, 0.74 * h);
      c.stroke();
      c.ellipse(0.45 * w, 0.74 * h, 0.1 * w, 0.26 * h);
      c.fillAndStroke();
    }
    c.ellipse(0.2 * w, 0.17 * h, 0.08 * w, 0.2 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.17 * h, 0.08 * w, 0.2 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalLiquidLevelActuatedSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalLiquidLevelActuatedSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.76 * w, h);
    c.lineTo(w, h);
    c.moveTo(0, h);
    c.lineTo(0.24 * w, h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0.5 * h);
      c.moveTo(0.42 * w, 0);
      c.lineTo(0.58 * w, 0);
      c.lineTo(0.58 * w, 0.4 * h);
      c.lineTo(0.42 * w, 0.4 * h);
      c.close();
      c.moveTo(0.46 * w, 0.22 * h);
      c.arcTo(0.05 * w, 0.1 * h, 0, 0, 1, 0.54 * w, 0.22 * h);
      c.arcTo(0.05 * w, 0.1 * h, 0, 0, 1, 0.46 * w, 0.22 * h);
      c.close();
      c.moveTo(0.5 * w, 0.1 * h);
      c.lineTo(0.5 * w, 0.17 * h);
      c.moveTo(0.5 * w, 0.4 * h);
      c.lineTo(0.5 * w, 0.55 * h);
      c.moveTo(0.5 * w, 0.63 * h);
      c.lineTo(0.5 * w, 0.75 * h);
      c.stroke();
    } else {
      c.lineTo(0.76 * w, h);
      c.moveTo(0.42 * w, 0.25 * h);
      c.lineTo(0.58 * w, 0.25 * h);
      c.lineTo(0.58 * w, 0.65 * h);
      c.lineTo(0.42 * w, 0.65 * h);
      c.close();
      c.moveTo(0.46 * w, 0.47 * h);
      c.arcTo(0.05 * w, 0.1 * h, 0, 0, 1, 0.54 * w, 0.47 * h);
      c.arcTo(0.05 * w, 0.1 * h, 0, 0, 1, 0.46 * w, 0.47 * h);
      c.close();
      c.moveTo(0.5 * w, 0.35 * h);
      c.lineTo(0.5 * w, 0.42 * h);
      c.moveTo(0.5 * w, 0.65 * h);
      c.lineTo(0.5 * w, 0.8 * h);
      c.moveTo(0.5 * w, 0.88 * h);
      c.lineTo(0.5 * w, h);
      c.stroke();
      c.stroke();
    }
  }
}

/** mxShapeElectricalGasFlowActuatedSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalGasFlowActuatedSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.76 * w, h);
    c.lineTo(w, h);
    c.moveTo(0, h);
    c.lineTo(0.24 * w, h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0.5 * h);
      c.moveTo(0.42 * w, 0);
      c.lineTo(0.58 * w, 0);
      c.lineTo(0.58 * w, 0.4 * h);
      c.lineTo(0.42 * w, 0.4 * h);
      c.close();
      c.moveTo(0.54 * w, 0.34 * h);
      c.lineTo(0.54 * w, 0.09 * h);
      c.lineTo(0.46 * w, 0.09 * h);
      c.lineTo(0.46 * w, 0.26 * h);
      c.lineTo(0.54 * w, 0.26 * h);
      c.moveTo(0.5 * w, 0.4 * h);
      c.lineTo(0.5 * w, 0.55 * h);
      c.moveTo(0.5 * w, 0.63 * h);
      c.lineTo(0.5 * w, 0.75 * h);
      c.stroke();
      c.ellipse(0.475 * w, 0.165 * h, 0.025 * w, 0.06 * h);
      c.stroke();
    } else {
      c.lineTo(0.76 * w, h);
      c.moveTo(0.42 * w, 0.25 * h);
      c.lineTo(0.58 * w, 0.25 * h);
      c.lineTo(0.58 * w, 0.65 * h);
      c.lineTo(0.42 * w, 0.65 * h);
      c.close();
      c.moveTo(0.54 * w, 0.59 * h);
      c.lineTo(0.54 * w, 0.34 * h);
      c.lineTo(0.46 * w, 0.34 * h);
      c.lineTo(0.46 * w, 0.51 * h);
      c.lineTo(0.54 * w, 0.51 * h);
      c.moveTo(0.5 * w, 0.65 * h);
      c.lineTo(0.5 * w, 0.80 * h);
      c.moveTo(0.5 * w, 0.88 * h);
      c.lineTo(0.5 * w, h);
      c.stroke();
      c.ellipse(0.475 * w, 0.415 * h, 0.025 * w, 0.06 * h);
      c.stroke();
    }
  }
}

/** mxShapeElectricalFlowActuatedSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalFlowActuatedSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.1 * h);
    c.lineTo(w, 0.1 * h);
    c.moveTo(0, 0.1 * h);
    c.lineTo(0.2 * w, 0.1 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.13 * h);
      c.lineTo(0.76 * w, 0.61 * h);
      c.moveTo(0.5 * w, 0.35 * h);
      c.lineTo(0.5 * w, h);
      c.lineTo(0.6 * w, h);
      c.lineTo(0.5 * w, 0.68 * h);
    } else {
      c.moveTo(0.28 * w, 0.1 * h);
      c.lineTo(0.72 * w, 0.1 * h);
      c.moveTo(0.5 * w, 0.1 * h);
      c.lineTo(0.5 * w, 0.85 * h);
      c.lineTo(0.6 * w, 0.85 * h);
      c.lineTo(0.5 * w, 0.53 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
    c.ellipse(0.72 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
  }
}

/** mxShapeElectricalPressureActuatedSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalPressureActuatedSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.1 * h);
    c.lineTo(w, 0.1 * h);
    c.moveTo(0, 0.1 * h);
    c.lineTo(0.2 * w, 0.1 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.13 * h);
      c.lineTo(0.76 * w, 0.61 * h);
      c.moveTo(0.5 * w, 0.35 * h);
      c.lineTo(0.5 * w, 0.74 * h);
      c.moveTo(0.39 * w, h);
      c.arcTo(0.11 * w, 0.26 * h, 0, 0, 1, 0.5 * w, 0.74 * h);
      c.arcTo(0.11 * w, 0.26 * h, 0, 0, 1, 0.61 * w, h);
      c.close();
    } else {
      c.moveTo(0.28 * w, 0.1 * h);
      c.lineTo(0.72 * w, 0.1 * h);
      c.moveTo(0.5 * w, 0.1 * h);
      c.lineTo(0.5 * w, 0.49 * h);
      c.moveTo(0.39 * w, 0.75 * h);
      c.arcTo(0.11 * w, 0.26 * h, 0, 0, 1, 0.5 * w, 0.49 * h);
      c.arcTo(0.11 * w, 0.26 * h, 0, 0, 1, 0.61 * w, 0.75 * h);
      c.close();
    }
    c.stroke();
    c.ellipse(0.2 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
    c.ellipse(0.72 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
  }
}

/** mxShapeElectricalTemperatureActuatedSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalTemperatureActuatedSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.1 * h);
    c.lineTo(w, 0.1 * h);
    c.moveTo(0, 0.1 * h);
    c.lineTo(0.2 * w, 0.1 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.13 * h);
      c.lineTo(0.76 * w, 0.61 * h);
      c.moveTo(0.5 * w, 0.35 * h);
      c.lineTo(0.5 * w, 0.64 * h);
      c.lineTo(0.57 * w, 0.64 * h);
      c.lineTo(0.57 * w, 0.81 * h);
      c.lineTo(0.5 * w, 0.81 * h);
      c.lineTo(0.5 * w, h);
    } else {
      c.moveTo(0.28 * w, 0.1 * h);
      c.lineTo(0.72 * w, 0.1 * h);
      c.moveTo(0.5 * w, 0.1 * h);
      c.lineTo(0.5 * w, 0.39 * h);
      c.lineTo(0.57 * w, 0.39 * h);
      c.lineTo(0.57 * w, 0.56 * h);
      c.lineTo(0.5 * w, 0.56 * h);
      c.lineTo(0.5 * w, 0.75 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
    c.ellipse(0.72 * w, 0, 0.08 * w, 0.2 * h);
    c.stroke();
  }
}

/** mxShapeElectricalSafetyInterlockSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalSafetyInterlockSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.34 * h);
    c.lineTo(w, 0.34 * h);
    c.moveTo(0, 0.34 * h);
    c.lineTo(0.2 * w, 0.34 * h);
    if (switchState == 'off') {
      c.moveTo(0.25 * w, 0);
      c.lineTo(0.75 * w, 0);
      c.lineTo(0.5 * w, 0.81 * h);
      c.close();
    } else {
      c.moveTo(0.25 * w, 0.19 * h);
      c.lineTo(0.75 * w, 0.19 * h);
      c.lineTo(0.5 * w, h);
      c.close();
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.27 * h, 0.08 * w, 0.14 * h);
    c.stroke();
    c.ellipse(0.72 * w, 0.27 * h, 0.08 * w, 0.14 * h);
    c.stroke();
  }
}

/** mxShapeElectricalTemperatureSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalTemperatureSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.76 * w, h);
    c.lineTo(w, h);
    c.moveTo(0, h);
    c.lineTo(0.24 * w, h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0.1 * h);
    } else {
      c.lineTo(0.76 * w, h);
    }
    c.stroke();
    c.ellipse(0.43 * w, 0, 0.1 * w, 0.22 * h);
    c.fillAndStroke();
    c.begin();
    c.moveTo(0.48 * w, 0);
    c.lineTo(0.48 * w, 0.22 * h);
    c.stroke();
  }
}

/** mxShapeElectricalThermostat2 (draw.io の shapes/mxElectrical.js) */
class ElectricalThermostat2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.86 * h);
    c.lineTo(w, 0.86 * h);
    c.moveTo(0, 0.86 * h);
    c.lineTo(0.2 * w, 0.86 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.82 * h);
      c.lineTo(0.76 * w, 0.2 * h);
    } else {
      c.moveTo(0.28 * w, 0.86 * h);
      c.lineTo(0.72 * w, 0.85 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.72 * h, 0.08 * w, 0.28 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.72 * h, 0.08 * w, 0.28 * h);
    c.fillAndStroke();
    c.text(0.5 * w, 0.2 * h, 0, 0, 'tº', 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxShapeElectricalLimitSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalLimitSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.84 * h);
    c.lineTo(w, 0.84 * h);
    c.moveTo(0, 0.84 * h);
    c.lineTo(0.2 * w, 0.84 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.8 * h);
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.46 * w, 0.5 * h);
      c.lineTo(0.545 * w, 0.07 * h);
      c.lineTo(0.57 * w, 0.3 * h);
    } else {
      c.moveTo(0.28 * w, 0.84 * h);
      c.lineTo(0.72 * w, 0.84 * h);
      c.moveTo(0.47 * w, 0.84 * h);
      c.lineTo(0.58 * w, 0.57 * h);
      c.lineTo(0.58 * w, 0.84 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.68 * h, 0.08 * w, 0.32 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.68 * h, 0.08 * w, 0.32 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalCircuitBreaker2 (draw.io の shapes/mxElectrical.js) */
class ElectricalCircuitBreaker2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, 0.8 * h);
    c.lineTo(w, 0.8 * h);
    c.moveTo(0.75 * w, 0.6 * h);
    c.lineTo(0.85 * w, h);
    c.moveTo(0.85 * w, 0.6 * h);
    c.lineTo(0.75 * w, h);
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.24 * w, 0.8 * h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0);
    } else {
      c.lineTo(0.8 * w, 0.8 * h);
    }
    c.stroke();
  }
}

/** mxShapeElectricalSelectorSwitch3Position2 (draw.io の shapes/mxElectrical.js) */
class ElectricalSelectorSwitch3Position2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    var strokeColor = this.col('strokeColor', '#000000');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.68 * w, 0.06 * h);
    c.lineTo(w, 0.06 * h);
    c.moveTo(0.75 * w, 0.5 * h);
    c.lineTo(w, 0.5 * h);
    c.moveTo(0.68 * w, 0.94 * h);
    c.lineTo(w, 0.94 * h);
    c.stroke();
    c.ellipse(0.2 * w, 0.435 * h, 0.08 * w, 0.13 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0, 0.08 * w, 0.13 * h);
    c.fillAndStroke();
    c.ellipse(0.67 * w, 0.435 * h, 0.08 * w, 0.13 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0.87 * h, 0.08 * w, 0.13 * h);
    c.fillAndStroke();
    c.setFillColor(strokeColor);
    if (switchState == '1') {
      c.begin();
      c.moveTo(0.27 * w, 0.47 * h);
      c.lineTo(0.59 * w, 0.12 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.52 * w, 0.12 * h);
      c.lineTo(0.61 * w, 0.095 * h);
      c.lineTo(0.565 * w, 0.22 * h);
      c.close();
      c.fill();
    } else if (switchState == '2') {
      c.begin();
      c.moveTo(0.28 * w, 0.5 * h);
      c.lineTo(0.64 * w, 0.5 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.59 * w, 0.44 * h);
      c.lineTo(0.67 * w, 0.5 * h);
      c.lineTo(0.59 * w, 0.56 * h);
      c.close();
      c.fill();
    } else {
      c.begin();
      c.moveTo(0.27 * w, 0.53 * h);
      c.lineTo(0.59 * w, 0.88 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.52 * w, 0.88 * h);
      c.lineTo(0.61 * w, 0.905 * h);
      c.lineTo(0.565 * w, 0.78 * h);
      c.close();
      c.fill();
    }
  }
}

/** mxShapeElectricalSelectorSwitch4Position2 (draw.io の shapes/mxElectrical.js) */
class ElectricalSelectorSwitch4Position2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    var strokeColor = this.col('strokeColor', '#000000');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.68 * w, 0.045 * h);
    c.lineTo(w, 0.045 * h);
    c.moveTo(0.8 * w, 0.35 * h);
    c.lineTo(w, 0.35 * h);
    c.moveTo(0.8 * w, 0.65 * h);
    c.lineTo(w, 0.65 * h);
    c.moveTo(0.68 * w, 0.955 * h);
    c.lineTo(w, 0.955 * h);
    c.stroke();
    c.ellipse(0.2 * w, 0.455 * h, 0.08 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0, 0.08 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.305 * h, 0.08 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.605 * h, 0.08 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0.91 * h, 0.08 * w, 0.09 * h);
    c.fillAndStroke();
    c.setFillColor(strokeColor);
    if (switchState == '1') {
      c.begin();
      c.moveTo(0.27 * w, 0.47 * h);
      c.lineTo(0.58 * w, 0.11 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.515 * w, 0.115 * h);
      c.lineTo(0.61 * w, 0.08 * h);
      c.lineTo(0.58 * w, 0.18 * h);
      c.close();
      c.fill();
    } else if (switchState == '2') {
      c.begin();
      c.moveTo(0.28 * w, 0.485 * h);
      c.lineTo(0.69 * w, 0.37 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.62 * w, 0.34 * h);
      c.lineTo(0.72 * w, 0.36 * h);
      c.lineTo(0.64 * w, 0.43 * h);
      c.close();
      c.fill();
    } else if (switchState == '3') {
      c.begin();
      c.moveTo(0.28 * w, 0.515 * h);
      c.lineTo(0.69 * w, 0.63 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.62 * w, 0.66 * h);
      c.lineTo(0.72 * w, 0.64 * h);
      c.lineTo(0.64 * w, 0.57 * h);
      c.close();
      c.fill();
    } else {
      c.begin();
      c.moveTo(0.27 * w, 0.53 * h);
      c.lineTo(0.58 * w, 0.89 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.515 * w, 0.885 * h);
      c.lineTo(0.61 * w, 0.92 * h);
      c.lineTo(0.58 * w, 0.82 * h);
      c.close();
      c.fill();
    }
  }
}

/** mxShapeElectricalSelectorSwitch6Position2 (draw.io の shapes/mxElectrical.js) */
class ElectricalSelectorSwitch6Position2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    var strokeColor = this.col('strokeColor', '#000000');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.39 * w, 0.03 * h);
    c.lineTo(w, 0.03 * h);
    c.moveTo(0.68 * w, 0.22 * h);
    c.lineTo(w, 0.22 * h);
    c.moveTo(0.8 * w, 0.405 * h);
    c.lineTo(w, 0.405 * h);
    c.moveTo(0.8 * w, 0.595 * h);
    c.lineTo(w, 0.595 * h);
    c.moveTo(0.68 * w, 0.78 * h);
    c.lineTo(w, 0.78 * h);
    c.moveTo(0.39 * w, 0.97 * h);
    c.lineTo(w, 0.97 * h);
    c.stroke();
    c.ellipse(0.2 * w, 0.47 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.31 * w, 0, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0.19 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.375 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.565 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.6 * w, 0.75 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.ellipse(0.31 * w, 0.94 * h, 0.08 * w, 0.06 * h);
    c.fillAndStroke();
    c.setFillColor(strokeColor);
    if (switchState == '1') {
      c.begin();
      c.moveTo(0.25 * w, 0.47 * h);
      c.lineTo(0.34 * w, 0.08 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.29 * w, 0.115 * h);
      c.lineTo(0.34 * w, 0.06 * h);
      c.lineTo(0.37 * w, 0.12 * h);
      c.close();
      c.fill();
    } else if (switchState == '2') {
      c.begin();
      c.moveTo(0.27 * w, 0.48 * h);
      c.lineTo(0.595 * w, 0.25 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.52 * w, 0.265 * h);
      c.lineTo(0.61 * w, 0.24 * h);
      c.lineTo(0.58 * w, 0.302 * h);
      c.close();
      c.fill();
    } else if (switchState == '3') {
      c.begin();
      c.moveTo(0.28 * w, 0.495 * h);
      c.lineTo(0.69 * w, 0.42 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.63 * w, 0.405 * h);
      c.lineTo(0.72 * w, 0.415 * h);
      c.lineTo(0.65 * w, 0.455 * h);
      c.close();
      c.fill();
    } else if (switchState == '4') {
      c.begin();
      c.moveTo(0.28 * w, 0.505 * h);
      c.lineTo(0.69 * w, 0.58 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.63 * w, 0.595 * h);
      c.lineTo(0.72 * w, 0.585 * h);
      c.lineTo(0.65 * w, 0.545 * h);
      c.close();
      c.fill();
    } else if (switchState == '5') {
      c.begin();
      c.moveTo(0.27 * w, 0.52 * h);
      c.lineTo(0.595 * w, 0.75 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.52 * w, 0.735 * h);
      c.lineTo(0.61 * w, 0.76 * h);
      c.lineTo(0.58 * w, 0.698 * h);
      c.close();
      c.fill();
    } else {
      c.begin();
      c.moveTo(0.25 * w, 0.53 * h);
      c.lineTo(0.34 * w, 0.92 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.29 * w, 0.885 * h);
      c.lineTo(0.34 * w, 0.94 * h);
      c.lineTo(0.37 * w, 0.88 * h);
      c.close();
      c.fill();
    }
  }
}

/** mxShapeElectricalShortingSelectorSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalShortingSelectorSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.25 * w, 0.5 * h);
    c.stroke();
    c.ellipse(0.25 * w, 0.455 * h, 0.1 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.75 * w, 0, 0.1 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.9 * w, 0.305 * h, 0.1 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.9 * w, 0.605 * h, 0.1 * w, 0.09 * h);
    c.fillAndStroke();
    c.ellipse(0.75 * w, 0.91 * h, 0.1 * w, 0.09 * h);
    c.fillAndStroke();
    if (switchState == '1') {
      c.begin();
      c.moveTo(0.33 * w, 0.47 * h);
      c.lineTo(0.72 * w, 0.12 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.617 * w, 0.044 * h);
      c.arcTo(0.21 * w, 0.17 *  h, 0, 0, 1, 0.818 * w, 0.182 * h);
      c.lineTo(0.766 * w, 0.198 * h);
      c.arcTo(0.15 * w, 0.13 *  h, 0, 0, 0, 0.617 * w, 0.092 * h);
      c.close();
      c.fillAndStroke();
    } else if (switchState == '2') {
      c.begin();
      c.moveTo(0.34 * w, 0.49 * h);
      c.lineTo(0.83 * w, 0.375 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.791 * w, 0.263 * h);
      c.arcTo(0.24 * w, 0.2 *  h, 0, 0, 1, 0.889 * w, 0.474 * h);
      c.lineTo(0.837 * w, 0.465 * h);
      c.arcTo(0.16 * w, 0.14 *  h, 0, 0, 0, 0.767 * w, 0.303 * h);
      c.close();
      c.fillAndStroke();
    } else if (switchState == '3') {
      c.begin();
      c.moveTo(0.34 * w, 0.51 * h);
      c.lineTo(0.83 * w, 0.625 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.791 * w, 0.737 * h);
      c.arcTo(0.24 * w, 0.2 *  h, 0, 0, 0, 0.889 * w, 0.526 * h);
      c.lineTo(0.837 * w, 0.535 * h);
      c.arcTo(0.16 * w, 0.14 *  h, 0, 0, 1, 0.767 * w, 0.697 * h);
      c.close();
      c.fillAndStroke();
    } else {
      c.begin();
      c.moveTo(0.33 * w, 0.53 * h);
      c.lineTo(0.72 * w, 0.88 * h);
      c.stroke();
      c.begin();
      c.moveTo(0.617 * w, 0.956 * h);
      c.arcTo(0.21 * w, 0.17 *  h, 0, 0, 0, 0.818 * w, 0.818 * h);
      c.lineTo(0.766 * w, 0.802 * h);
      c.arcTo(0.15 * w, 0.13 *  h, 0, 0, 1, 0.617 * w, 0.908 * h);
      c.close();
      c.fillAndStroke();
    }
  }
}

/** mxShapeElectricalProximityLimitSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalProximityLimitSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.8 * w, 0.5 * h);
    c.lineTo(w, 0.5 * h);
    c.moveTo(0.13 * w, 0.5 * h);
    c.lineTo(0.5 * w, 0);
    c.lineTo(0.87 * w, 0.5 * h);
    c.lineTo(0.5 * w, h);
    c.close();
    c.stroke();
    if (switchState == 'off') {
      c.begin();
      c.moveTo(0.755 * w, 0.355 * h);
      c.lineTo(0.22 * w, 0.5 * h);
      c.lineTo(0.625 * w, 0.61 * h);
      c.lineTo(0.72 * w, 0.36 * h);
      c.stroke();
    } else {
      c.begin();
      c.moveTo(0.76 * w, 0.43 * h);
      c.lineTo(0.235 * w, 0.5 * h);
      c.lineTo(0.615 * w, 0.66 * h);
      c.lineTo(0.72 * w, 0.44 * h);
      c.stroke();
    }
    c.ellipse(0.2 * w, 0.445 * h, 0.08 * w, 0.11 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.445 * h, 0.08 * w, 0.11 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalInertiaSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalInertiaSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0, 0.85 * h);
    c.lineTo(0.2 * w, 0.85 * h);
    c.moveTo(0.8 * w, 0.85 * h);
    c.lineTo(w, 0.85 * h);
    c.stroke();
    if (switchState == 'off') {
      c.begin();
      c.moveTo(0.28 * w, 0.79 * h);
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.493 * w, 0.45 * h);
      c.lineTo(0.493 * w, 0.26 * h);
      c.lineTo(0.43 * w, 0.26 * h);
      c.stroke();
      c.ellipse(0.35 * w, 0.1 * h, 0.08 * w, 0.3 * h);
      c.fillAndStroke();
    } else {
      c.begin();
      c.moveTo(0.28 * w, 0.85 * h);
      c.lineTo(0.76 * w, 0.85 * h);
      c.moveTo(0.51 * w, 0.85 * h);
      c.lineTo(0.51 * w, 0.26 * h);
      c.lineTo(0.43 * w, 0.26 * h);
      c.stroke();
      c.ellipse(0.35 * w, 0.1 * h, 0.08 * w, 0.3 * h);
      c.fillAndStroke();
    }
    c.ellipse(0.2 * w, 0.7 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.7 * h, 0.08 * w, 0.3 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalPushbuttonBreak2 (draw.io の shapes/mxElectrical.js) */
class ElectricalPushbuttonBreak2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.2 * w, 0.8 * h);
    c.moveTo(0.8 * w, 0.8 * h);
    c.lineTo(w, 0.8 * h);
    c.stroke();
    if (switchState == 'off') {
      c.begin();
      c.moveTo(0.24 * w, h);
      c.lineTo(0.76 * w, h);
      c.moveTo(0.5 * w, h);
      c.lineTo(0.5 * w, 0.1 * h);
      c.stroke();
    } else {
      c.begin();
      c.moveTo(0.24 * w, 0.9 * h);
      c.lineTo(0.76 * w, 0.9 * h);
      c.moveTo(0.5 * w, 0.9 * h);
      c.lineTo(0.5 * w, 0);
      c.stroke();
    }
    c.ellipse(0.2 * w, 0.725 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.725 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalManualSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalManualSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'on');
    c.begin();
    c.moveTo(0.8 * w, h);
    c.lineTo(w, h);
    c.moveTo(0, h);
    c.lineTo(0.25 * w, h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0.1 * h);
      c.moveTo(0.49 * w, 0);
      c.lineTo(0.49 * w, 0.2 * h);
      c.moveTo(0.49 * w, 0.3 * h);
      c.lineTo(0.49 * w, 0.55 * h);
      c.moveTo(0.41 * w, 0);
      c.lineTo(0.57 * w, 0);
    } else {
      c.lineTo(0.8 * w, h);
      c.moveTo(0.49 * w, 0.45 * h);
      c.lineTo(0.49 * w, 0.65 * h);
      c.moveTo(0.49 * w, 0.75 * h);
      c.lineTo(0.49 * w, h);
      c.moveTo(0.41 * w, 0.45 * h);
      c.lineTo(0.57 * w, 0.45 * h);
    }
    c.stroke();
  }
}

/** mxShapeElectricalTwoWayContact2 (draw.io の shapes/mxElectrical.js) */
class ElectricalTwoWayContact2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.21 * w, 0.5 * h);
    c.moveTo(0.67 * w, 0);
    c.lineTo(w, 0);
    c.moveTo(0.67 * w, h);
    c.lineTo(w, h);
    if (switchState == '1') {
      c.moveTo(0.28 * w, 0.46 * h);
      c.lineTo(0.67 * w, 0);
    } else if (switchState == '2') {
      c.moveTo(0.28 * w, 0.54 * h);
      c.lineTo(0.67 * w, h);
    } else {
      c.moveTo(0.28 * w, 0.5 * h);
      c.lineTo(0.67 * w, 0.5 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.4 * h, 0.08 * w, 0.2 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalPassingMakeContact2 (draw.io の shapes/mxElectrical.js) */
class ElectricalPassingMakeContact2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(w, 0.7 * h);
    c.lineTo(0.77 * w, 0.7 * h);
    c.lineTo(0.93 * w, h);
    c.moveTo(0, 0.7 * h);
    c.lineTo(0.25 * w, 0.7 * h);
    if (switchState == 'off') {
      c.lineTo(0.76 * w, 0);
    } else {
      c.lineTo(0.76 * w, 0.7 * h);
    }
    c.stroke();
  }
}

/** mxShapeElectricalDPST2 (draw.io の shapes/mxElectrical.js) */
class ElectricalDPST2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(0, 0.4 * h);
    c.lineTo(0.2 * w, 0.4 * h);
    c.moveTo(0.8 * w, 0.4 * h);
    c.lineTo(w, 0.4 * h);
    c.moveTo(0, 0.92 * h);
    c.lineTo(0.2 * w, 0.92 * h);
    c.moveTo(0.8 * w, 0.92 * h);
    c.lineTo(w, 0.92 * h);
    if (switchState == 'off') {
      c.moveTo(0.28 * w, 0.38 * h);
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.28 * w, 0.9 * h);
      c.lineTo(0.76 * w, 0.52 * h);
      c.moveTo(0.5 * w, 0.2 * h);
      c.lineTo(0.5 * w, 0.33 * h);
      c.moveTo(0.5 * w, 0.38 * h);
      c.lineTo(0.5 * w, 0.51 * h);
      c.moveTo(0.5 * w, 0.56 * h);
      c.lineTo(0.5 * w, 0.69 * h);
    } else {
      c.moveTo(0.28 * w, 0.4 * h);
      c.lineTo(0.72 * w, 0.4 * h);
      c.moveTo(0.28 * w, 0.92 * h);
      c.lineTo(0.72 * w, 0.92 * h);
      c.moveTo(0.5 * w, 0.4 * h);
      c.lineTo(0.5 * w, 0.53 * h);
      c.moveTo(0.5 * w, 0.58 * h);
      c.lineTo(0.5 * w, 0.71 * h);
      c.moveTo(0.5 * w, 0.76 * h);
      c.lineTo(0.5 * w, 0.89 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.325 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
    c.ellipse(0.2 * w, 0.845 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.325 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.845 * h, 0.08 * w, 0.15 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalSpringReturn3 (draw.io の shapes/mxElectrical.js) */
class ElectricalSpringReturn3 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(0, 0.62 * h);
    c.lineTo(0.21 * w, 0.62 * h);
    c.stroke();
    if (switchState == 'off') {
      c.begin();
      c.moveTo(0.28 * w, 0.57 * h);
      c.lineTo(0.76 * w, 0);
      c.moveTo(w, 0.62 * h);
      c.lineTo(0.625 * w, 0.62 * h);
      c.lineTo(0.695 * w, 0.31 * h);
      c.lineTo(0.765 * w, 0.62 * h);
      c.fillAndStroke();
    } else {
      c.begin();
      c.moveTo(0.28 * w, 0.64 * h);
      c.lineTo(0.76 * w, h);
      c.moveTo(w, 0.62 * h);
      c.lineTo(0.625 * w, 0.62 * h);
      c.lineTo(0.695 * w, 0.93 * h);
      c.lineTo(0.765 * w, 0.62 * h);
      c.fillAndStroke();
    }
    c.ellipse(0.205 * w, 0.5 * h, 0.08 * w, 0.24 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalLimitSwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalLimitSwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(0, 0.16 * h);
    c.lineTo(0.2 * w, 0.16 * h);
    c.moveTo(0.8 * w, 0.16 * h);
    c.lineTo(w, 0.16 * h);
    c.stroke();
    if (switchState == 'off') {
      c.begin();
      c.moveTo(0.725 * w, 0.75 * h);
      c.lineTo(0.24 * w, 0.16 * h);
      c.lineTo(0.515 * w, h);
      c.lineTo(0.69 * w, 0.72 * h);
      c.fillAndStroke();
    } else {
      c.begin();
      c.moveTo(0.76 * w, 0);
      c.lineTo(0.24 * w, 0.16 * h);
      c.lineTo(0.615 * w, 0.52 * h);
      c.lineTo(0.72 * w, 0.02 * h);
      c.fillAndStroke();
    }
    c.ellipse(0.2 * w, 0.04 * h, 0.08 * w, 0.24 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.04 * h, 0.08 * w, 0.24 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalDPDT3 (draw.io の shapes/mxElectrical.js) */
class ElectricalDPDT3 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'neutral');
    c.begin();
    c.moveTo(0, 0.23 * h);
    c.lineTo(0.27 * w, 0.23 * h);
    c.moveTo(0, 0.79 * h);
    c.lineTo(0.27 * w, 0.79 * h);
    c.moveTo(0.74 * w, 0.05 * h);
    c.lineTo(w, 0.05 * h);
    c.moveTo(0.74 * w, 0.39 * h);
    c.lineTo(w, 0.39 * h);
    c.moveTo(0.74 * w, 0.61 * h);
    c.lineTo(w, 0.61 * h);
    c.moveTo(0.74 * w, 0.95 * h);
    c.lineTo(w, 0.95 * h);
    if (switchState == '1') {
      c.moveTo(0.37   * w, 0.215 * h);
      c.lineTo(0.69 * w, 0.105 * h);
      c.moveTo(0.37   * w, 0.775 * h);
      c.lineTo(0.69 * w, 0.665 * h);
      c.moveTo(0.515 * w, 0.17 * h);
      c.lineTo(0.515 * w, 0.245 * h);
      c.moveTo(0.515 * w, 0.28 * h);
      c.lineTo(0.515 * w, 0.355 * h);
      c.moveTo(0.515 * w, 0.39 * h);
      c.lineTo(0.515 * w, 0.465 * h);
      c.moveTo(0.515 * w, 0.5 * h);
      c.lineTo(0.515 * w, 0.575 * h);
      c.moveTo(0.515 * w, 0.61 * h);
      c.lineTo(0.515 * w, 0.685 * h);
    } else {
      c.moveTo(0.37   * w, 0.245 * h);
      c.lineTo(0.69 * w, 0.335 * h);
      c.moveTo(0.37   * w, 0.805 * h);
      c.lineTo(0.69 * w, 0.895 * h);
      c.moveTo(0.515 * w, 0.29 * h);
      c.lineTo(0.515 * w, 0.365 * h);
      c.moveTo(0.515 * w, 0.4 * h);
      c.lineTo(0.515 * w, 0.475 * h);
      c.moveTo(0.515 * w, 0.51 * h);
      c.lineTo(0.515 * w, 0.585 * h);
      c.moveTo(0.515 * w, 0.62 * h);
      c.lineTo(0.515 * w, 0.695 * h);
      c.moveTo(0.515 * w, 0.73 * h);
      c.lineTo(0.515 * w, 0.805 * h);
    }
    c.stroke();
    c.ellipse(0.265 * w, 0.18 * h, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
    c.ellipse(0.265 * w, 0.745 * h, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
    c.ellipse(0.635 * w, 0, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
    c.ellipse(0.635 * w, 0.345 * h, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
    c.ellipse(0.635 * w, 0.56 * h, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
    c.ellipse(0.635 * w, 0.905 * h, 0.105 * w, 0.095 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalTwoPositionSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalTwoPositionSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.8 * w, 0.5 * h);
    c.lineTo(w, 0.5 * h);
    c.moveTo(0.5 * w, 0);
    c.lineTo(0.5 * w, 0.18 * h);
    c.moveTo(0.5 * w, 0.82 * h);
    c.lineTo(0.5 * w, h);
    c.moveTo(0.63 * w, 0.145 * h);
    c.arcTo(0.2 * w, 0.22 * h, 0, 0, 1, 0.835 * w, 0.36 * h);
    if (switchState == '1') {
      c.moveTo(0.24 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 1, 0.5 * w, 0.78 * h);
      c.moveTo(0.76 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 1, 0.5 * w, 0.22 * h);
      c.moveTo(0.39 * w, 0.56 * h);
      c.lineTo(0.55 * w, 0.39 * h);
      c.moveTo(0.39 * w, 0.56 * h);
      c.lineTo(0.55 * w, 0.39 * h);
      c.moveTo(0.61 * w, 0.44 * h);
      c.lineTo(0.45 * w, 0.61 * h);
      c.moveTo(0.61 * w, 0.44 * h);
      c.lineTo(0.45 * w, 0.61 * h);
    } else {
      c.moveTo(0.76 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 0, 0.5 * w, 0.78 * h);
      c.moveTo(0.24 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 0, 0.5 * w, 0.22 * h);
      c.moveTo(0.61 * w, 0.56 * h);
      c.lineTo(0.45 * w, 0.39 * h);
      c.moveTo(0.61 * w, 0.56 * h);
      c.lineTo(0.45 * w, 0.39 * h);
      c.moveTo(0.39 * w, 0.44 * h);
      c.lineTo(0.55 * w, 0.61 * h);
      c.moveTo(0.39 * w, 0.44 * h);
      c.lineTo(0.55 * w, 0.61 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.4575 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.4575 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.46 * w, 0.18 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.46 * w, 0.735 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    var strokeColor = this.col('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(0.633 * w, 0.1 * h);
    c.lineTo(0.633 * w, 0.185 * h);
    c.lineTo(0.56 * w, 0.1425 * h);
    c.close();
    c.moveTo(0.795 * w, 0.355 * h);
    c.lineTo(0.875 * w, 0.355 * h);
    c.lineTo(0.835 * w, 0.435 * h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxShapeElectricalThreePositionSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalThreePositionSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0.5 * w, 0);
    c.lineTo(0.5 * w, 0.2 * h);
    c.moveTo(0, h);
    c.lineTo(0.215 * w, 0.825 * h);
    c.moveTo(w, h);
    c.lineTo(0.785 * w, 0.825 * h);
    c.moveTo(0.12 * w, 0.62 * h);
    c.arcTo(0.38 * w, 0.38 * h, 0, 0, 1, 0.31 * w, 0.26 * h);
    if (switchState == '1') {
      c.moveTo(0.5 * w, 0.26 * h);
      c.arcTo(0.65 * w, 0.65 * h, 0, 0, 1, 0.25 * w, 0.79 * h);
    } else if (switchState == '2') {
      c.moveTo(0.5 * w, 0.26 * h);
      c.arcTo(0.65 * w, 0.65 * h, 0, 0, 0, 0.75 * w, 0.79 * h);
    } else {
      c.moveTo(0.25 * w, 0.79 * h);
      c.arcTo(0.5 * w, 0.5 * h, 0, 0, 1, 0.75 * w, 0.79 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.74 * h, 0.1 * w, 0.1 * h);
    c.fillAndStroke();
    c.ellipse(0.45 * w, 0.21 * h, 0.1 * w, 0.1 * h);
    c.fillAndStroke();
    c.ellipse(0.7 * w, 0.74 * h, 0.1 * w, 0.1 * h);
    c.fillAndStroke();
    var strokeColor = this.col('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(0.285 * w, 0.215 * h);
    c.lineTo(0.39 * w, 0.2 * h);
    c.lineTo(0.345 * w, 0.295 * h);
    c.close();
    c.moveTo(0.07 * w, 0.63 * h);
    c.lineTo(0.18 * w, 0.61 * h);
    c.lineTo(0.14 * w, 0.71 * h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxShapeElectricalFourPositionSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalFourPositionSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.2 * w, 0.5 * h);
    c.moveTo(0.8 * w, 0.5 * h);
    c.lineTo(w, 0.5 * h);
    c.moveTo(0.5 * w, 0);
    c.lineTo(0.5 * w, 0.18 * h);
    c.moveTo(0.5 * w, 0.82 * h);
    c.lineTo(0.5 * w, h);
    c.moveTo(0.37 * w, 0.145 * h);
    c.arcTo(0.2 * w, 0.22 * h, 0, 0, 0, 0.165 * w, 0.36 * h);
    if (switchState == '1') {
      c.moveTo(0.32 * w, 0.7 * h);
      c.arcTo(0.25 * w, 0.25 * h, 0, 0, 1, 0.68 * w, 0.7 * h);
      c.moveTo(0.32 * w, 0.3 * h);
      c.arcTo(0.25 * w, 0.25 * h, 0, 0, 0, 0.68 * w, 0.3 * h);
      c.moveTo(0.46 * w, 0.37 * h);
      c.lineTo(0.46 * w, 0.63 * h);
      c.moveTo(0.54 * w, 0.37 * h);
      c.lineTo(0.54 * w, 0.63 * h);
      c.moveTo(0.28 * w, 0.5 * h);
      c.lineTo(0.72 * w, 0.5 * h);
    } else if (switchState == '2') {
      c.moveTo(0.24 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 1, 0.5 * w, 0.78 * h);
      c.moveTo(0.76 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 1, 0.5 * w, 0.22 * h);
      c.moveTo(0.39 * w, 0.56 * h);
      c.lineTo(0.55 * w, 0.39 * h);
      c.moveTo(0.39 * w, 0.56 * h);
      c.lineTo(0.55 * w, 0.39 * h);
      c.moveTo(0.61 * w, 0.44 * h);
      c.lineTo(0.45 * w, 0.61 * h);
      c.moveTo(0.61 * w, 0.44 * h);
      c.lineTo(0.45 * w, 0.61 * h);
      c.moveTo(0.32 * w, 0.32 * h);
      c.lineTo(0.68 * w, 0.68 * h);
    } else if (switchState == '3') {
      c.moveTo(0.7 * w, 0.32 * h);
      c.arcTo(0.25 * w, 0.25 * h, 0, 0, 0, 0.7 * w, 0.68 * h);
      c.moveTo(0.3 * w, 0.32 * h);
      c.arcTo(0.25 * w, 0.25 * h, 0, 0, 1, 0.3 * w, 0.68 * h);
      c.moveTo(0.37 * w, 0.46 * h);
      c.lineTo(0.63 * w, 0.46 * h);
      c.moveTo(0.37 * w, 0.54 * h);
      c.lineTo(0.63 * w, 0.54 * h);
      c.moveTo(0.5 * w, 0.26 * h);
      c.lineTo(0.5 * w, 0.74 * h);
    } else {
      c.moveTo(0.76 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 0, 0.5 * w, 0.78 * h);
      c.moveTo(0.24 * w, 0.5 * h);
      c.arcTo(0.27 * w, 0.27 * h, 0, 0, 0, 0.5 * w, 0.22 * h);
      c.moveTo(0.61 * w, 0.56 * h);
      c.lineTo(0.45 * w, 0.39 * h);
      c.moveTo(0.61 * w, 0.56 * h);
      c.lineTo(0.45 * w, 0.39 * h);
      c.moveTo(0.39 * w, 0.44 * h);
      c.lineTo(0.55 * w, 0.61 * h);
      c.moveTo(0.39 * w, 0.44 * h);
      c.lineTo(0.55 * w, 0.61 * h);
      c.moveTo(0.68 * w, 0.32 * h);
      c.lineTo(0.32 * w, 0.68 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.4575 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.4575 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.46 * w, 0.18 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    c.ellipse(0.46 * w, 0.735 * h, 0.08 * w, 0.085 * h);
    c.fillAndStroke();
    var strokeColor = this.col('strokeColor', '#000000');
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(0.367 * w, 0.1 * h);
    c.lineTo(0.367 * w, 0.185 * h);
    c.lineTo(0.44 * w, 0.1425 * h);
    c.close();
    c.moveTo(0.205 * w, 0.355 * h);
    c.lineTo(0.125 * w, 0.355 * h);
    c.lineTo(0.165 * w, 0.435 * h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxShapeElectricalPushbuttonMakeSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalPushbuttonMakeSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.94 * h);
    c.lineTo(0.2 * w, 0.94 * h);
    c.moveTo(0.8 * w, 0.94 * h);
    c.lineTo(w, 0.94 * h);
    if (switchState == '1') {
      c.moveTo(0.5 * w, 0);
      c.lineTo(0.5 * w, 0.8 * h);
      c.moveTo(0.24 * w, 0.8 * h);
      c.lineTo(0.76 * w, 0.8 * h);
    } else {
      c.moveTo(0.5 * w, 0.07 * h);
      c.lineTo(0.5 * w, 0.87 * h);
      c.moveTo(0.24 * w, 0.87 * h);
      c.lineTo(0.76 * w, 0.87 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.88 * h, 0.08 * w, 0.12 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.88 * h, 0.08 * w, 0.12 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalPushbuttonTwoCircuitSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalPushbuttonTwoCircuitSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, 0.68 * h);
    c.lineTo(0.2 * w, 0.68 * h);
    c.moveTo(0.8 * w, 0.68 * h);
    c.lineTo(w, 0.68 * h);
    c.moveTo(0, 0.96 * h);
    c.lineTo(0.2 * w, 0.96 * h);
    c.moveTo(0.8 * w, 0.96 * h);
    c.lineTo(w, 0.96 * h);
    if (switchState == '1') {
      c.moveTo(0.5 * w, 0);
      c.lineTo(0.5 * w, 0.73 * h);
      c.moveTo(0.24 * w, 0.73 * h);
      c.lineTo(0.76 * w, 0.73 * h);
    } else {
      c.moveTo(0.5 * w, 0.18 * h);
      c.lineTo(0.5 * w, 0.91 * h);
      c.moveTo(0.24 * w, 0.91 * h);
      c.lineTo(0.76 * w, 0.91 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.92 * h, 0.08 * w, 0.08 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.92 * h, 0.08 * w, 0.08 * h);
    c.fillAndStroke();
    c.ellipse(0.2 * w, 0.64 * h, 0.08 * w, 0.08 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.64 * h, 0.08 * w, 0.08 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalTimeDelaySwitch (draw.io の shapes/mxElectrical.js) */
class ElectricalTimeDelaySwitch extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'off');
    c.begin();
    c.moveTo(0, 0.13 * h);
    c.lineTo(0.2 * w, 0.13 * h);
    c.moveTo(0.8 * w, 0.13 * h);
    c.lineTo(w, 0.13 * h);
    if (switchState == 'off') {
      c.moveTo(0.5 * w, 0.37 * h);
      c.lineTo(0.5 * w, 0.83 * h);
      c.moveTo(0.28 * w, 0.16 * h);
      c.lineTo(0.76 * w, 0.62 * h);
      c.moveTo(0.44 * w, h);
      c.lineTo(0.5 * w, 0.83 * h);
      c.lineTo(0.56 * w, h);
    } else {
      c.moveTo(0.5 * w, 0.04 * h);
      c.lineTo(0.5 * w, 0.5 * h);
      c.moveTo(0.28 * w, 0.09 * h);
      c.lineTo(0.76 * w, 0);
      c.moveTo(0.44 * w, 0.67 * h);
      c.lineTo(0.5 * w, 0.5 * h);
      c.lineTo(0.56 * w, 0.67 * h);
    }
    c.stroke();
    c.ellipse(0.2 * w, 0.03 * h, 0.08 * w, 0.19 * h);
    c.fillAndStroke();
    c.ellipse(0.72 * w, 0.03 * h, 0.08 * w, 0.19 * h);
    c.fillAndStroke();
  }
}

/** mxShapeElectricalTimeDelaySwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalTimeDelaySwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'off');
    c.begin();
    c.moveTo(0, 0.45 * h);
    c.lineTo(0.23 * w, 0.45 * h);
    if (switchState == 'off') {
      c.lineTo(0.75 * w, 0);
      c.moveTo(w, 0.45 * h);
      c.lineTo(0.8 * w, 0.45 * h);
      c.moveTo(0.465 * w, 0.25 * h);
      c.lineTo(0.465 * w, 0.76 * h);
      c.moveTo(0.535 * w, 0.19 * h);
      c.lineTo(0.535 * w, 0.76 * h);
      c.moveTo(0.4 * w, 0.89 * h);
      c.arcTo(0.11 * w, 0.25 * h, 0, 0, 1, 0.6 * w, 0.89 * h);
    } else {
      c.lineTo(0.73 * w, 0.25 * h);
      c.moveTo(w, 0.45 * h);
      c.lineTo(0.67 * w, 0.45 * h);
      c.lineTo(0.67 * w, 0.16 * h);
      c.moveTo(0.465 * w, 0.36 * h);
      c.lineTo(0.465 * w, 0.87 * h);
      c.moveTo(0.535 * w, 0.33 * h);
      c.lineTo(0.535 * w, 0.87 * h);
      c.moveTo(0.4 * w, h);
      c.arcTo(0.11 * w, 0.25 * h, 0, 0, 1, 0.6 * w, h);
    }
    c.stroke();
  }
}

/** mxShapeElectricalIsolatorSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalIsolatorSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'off');
    c.begin();
    c.moveTo(w, 0.8 * h);
    c.lineTo(0.8 * w, 0.8 * h);
    c.moveTo(0.8 * w, 0.6 * h);
    c.lineTo(0.8 * w, h);
    c.moveTo(0, 0.8 * h);
    c.lineTo(0.23 * w, 0.8 * h);
    if (switchState == 'off') {
      c.lineTo(0.75 * w, 0);
    } else {
      c.lineTo(0.8 * w, 0.8 * h);
    }
    c.stroke();
  }
}

/** mxShapeElectricalChangeoverContactSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalChangeoverContactSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', '1');
    c.begin();
    c.moveTo(0, h);
    c.lineTo(0.25 * w, h);
    if (switchState == '1') {
      c.lineTo(0.76 * w, 0.2 * h);
      c.moveTo(w, 0);
      c.lineTo(0.67 * w, 0);
      c.lineTo(0.67 * w, 0.5 * h);
      c.moveTo(w, h);
      c.lineTo(0.8 * w, h);
    } else {
      c.lineTo(0.77 * w, 0.6 * h);
      c.moveTo(w, h);
      c.lineTo(0.67 * w, h);
      c.lineTo(0.67 * w, 0.5 * h);
      c.moveTo(w, 0);
      c.lineTo(0.8 * w, 0);
    }
    c.stroke();
  }
}

/** mxShapeElectricalReedSwitch2 (draw.io の shapes/mxElectrical.js) */
class ElectricalReedSwitch2 extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    var switchState = this.gv('elSwitchState', 'off');
    c.begin();
    c.moveTo(0.69 * w, 0);
    c.arcTo(0.13 * w, 0.5 * h, 0, 0, 1, 0.82 * w, 0.5 * h);
    c.arcTo(0.13 * w, 0.5 * h, 0, 0, 1, 0.69 * w, h);
    c.lineTo(0.31 * w, h);
    c.arcTo(0.13 * w, 0.5 * h, 0, 0, 1, 0.18 * w, 0.5 * h);
    c.arcTo(0.13 * w, 0.5 * h, 0, 0, 1, 0.31 * w, 0);
    c.close();
    c.fillAndStroke();
    c.begin();
    c.moveTo(w, 0.5 * h);
    c.lineTo(0.65 * w, 0.5 * h);
    c.moveTo(0, 0.5 * h);
    c.lineTo(0.35 * w, 0.5 * h);
    if (switchState == 'on') {
      c.lineTo(0.65 * w, 0.5 * h);
    } else {
      c.lineTo(0.65 * w, 0.25 * h);
    }
    c.stroke();
  }
}

/** mxShapePidValve (draw.io の shapes/pid2/mxPidValves.js) */
class PidValve extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var valveType = this.gv('valveType', 'gate');
    var actuator = this.gv('actuator', 'none');
    var actH = 0;
    if (actuator !== 'none') {
      if (this.isAngleVariant(valveType)) {
        actH = h * 0.3333;
      } else {
        actH = h * 0.4;
      }
    }
    c.translate(x, y);
    c.setLineJoin('round');
    this.background(c, x, y, w, h, valveType, actuator, actH);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, valveType, actuator, actH);
  }
  background(c: Mx, x: number, y: number, w: number, h: number, valveType: string, actuator: string, actH: number) {
    if (actuator !== 'none') {
      if (this.isAngleVariant(valveType)) {
        this.drawActuatorBg(c, x, y, w, h / 1.2, actuator);
      } else {
        this.drawActuatorBg(c, x, y, w, h, actuator);
      }
    }
    if (this.isGateVariant(valveType)) {
      this.drawGateVariantBg(c, 0, 0, w, h, valveType, actuator, actH);
    } else if (this.isAngleVariant(valveType)) {
      this.drawAngleVariantBg(c, 0, 0, w, h, valveType, actuator, actH);
    } else if (valveType === 'butterfly') {
      this.drawButterflyValve(c, 0, 0, w, h, actuator, actH);
    } else if (valveType === 'check') {
      this.drawCheckValve(c, 0, 0, w, h, actuator, actH);
    }
  }
  foreground(c: Mx, x: number, y: number, w: number, h: number, valveType: string, actuator: string, actH: number) {
    var valveType = this.gv('valveType', 'gate');
    if (actuator !== 'none') {
      if (this.isAngleVariant(valveType)) {
        this.drawActuatorFg(c, x, y, w, h / 1.2, actuator);
      } else {
        this.drawActuatorFg(c, x, y, w, h, actuator);
      }
    }
    if (this.isGateVariant(valveType)) {
      this.drawGateVariantFg(c, 0, 0, w, h, valveType, actuator, actH);
    }
    if (this.isAngleVariant(valveType)) {
      this.drawAngleVariantFg(c, 0, 0, w, h, valveType, actuator, actH);
    }
  }
  drawActuatorBg(c: Mx, _x: number, _y: number, w: number, h: number, actuator: string) {
    if (this.isSquareVariant(actuator)) {
      c.translate(w * 0.325, 0);
      this.drawSquareAct(c, w * 0.35, h * 0.7, actuator);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'man') {
      c.translate(w * 0.25, h * 0.15);
      this.drawManAct(c, w * 0.5, h * 0.55);
      c.translate(- w * 0.25, - h * 0.15);
    } else if (actuator === 'diaph') {
      c.translate(w * 0.25, h * 0.1);
      this.drawDiaphAct(c, w * 0.5, h * 0.6);
      c.translate(- w * 0.25, - h * 0.1);
    } else if (actuator === 'balDiaph') {
      c.translate(w * 0.25, h * 0.1);
      this.drawBalDiaphActBg(c, w * 0.5, h * 0.6);
      c.translate(- w * 0.25, - h * 0.1);
    } else if (actuator === 'motor' || actuator === 'elHyd') {
      c.translate(w * 0.325, 0);
      this.drawCircleAct(c, w * 0.35, h * 0.7, actuator);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'spring') {
      c.translate(w * 0.36, 0);
      this.drawSpringAct(c, w * 0.28, h * 0.7);
      c.translate(- w * 0.36, 0);
    } else if (actuator === 'solenoidManRes') {
      c.translate(w * 0.325, 0);
      this.drawSolenoidManResetAct(c, w * 0.575, h * 0.7);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'singActing') {
      c.translate(w * 0.35, 0);
      this.drawSingActingActBg(c, w * 0.65, h * 0.7);
      c.translate(- w * 0.35, 0);
    } else if (actuator === 'dblActing') {
      c.translate(w * 0.35, 0);
      this.drawDblActingActBg(c, w * 0.65, h * 0.7);
      c.translate(- w * 0.35, 0);
    } else if (actuator === 'pilotCyl') {
      c.translate(w * 0.35, 0);
      this.drawPilotCylinderActBg(c, w * 0.65, h * 0.7);
      c.translate(- w * 0.35, 0);
    } else if (actuator === 'angBlow') {
      c.translate(w * 0.5, h * 0.2);
      this.drawAngleBlowdownAct(c, w * 0.4, h * 0.5);
      c.translate(- w * 0.5, - h * 0.2);
    }
  }
  drawActuatorFg(c: Mx, _x: number, _y: number, w: number, h: number, actuator: string) {
    if (actuator === 'balDiaph') {
      c.translate(w * 0.25, h * 0.1);
      this.drawBalDiaphActFg(c, w * 0.5, h * 0.6);
      c.translate(- w * 0.25, - h * 0.1);
    } else if (actuator === 'singActing' ||
        actuator === 'dblActing' ||
        actuator === 'pilotCyl') {
      c.translate(w * 0.35, 0);
      this.drawActingActFg(c, w * 0.65, h * 0.7);
      c.translate(- w * 0.35, 0);
    }
  }
  drawManAct(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.5, h);
    c.stroke();
  }
  drawDiaphAct(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(w * 0.5, h * 0.2);
    c.lineTo(w * 0.5, h);
    c.stroke();
    c.begin();
    c.moveTo(0, h * 0.2);
    c.arcTo(w * 0.6, h * 0.4, 0, 0, 1, w, h * 0.2);
    c.close();
    c.fillAndStroke();
  }
  drawBalDiaphActBg(c: Mx, w: number, h: number) {
    c.ellipse(0, 0, w, h * 0.3);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.5, h * 0.3);
    c.lineTo(w * 0.5, h);
    c.stroke();
  }
  drawBalDiaphActFg(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(0, h * 0.15);
    c.lineTo(w, h * 0.15);
    c.stroke();
  }
  drawCircleAct(c: Mx, w: number, h: number, actuator: string) {
    c.ellipse(0, 0, w, h * 0.5);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.5, h * 0.5);
    c.lineTo(w * 0.5, h);
    c.stroke();
    var m = '';
    if (actuator === 'motor') {
      m = 'M';
    } else if (actuator === 'elHyd') {
      m = 'E/H';
    }
    c.setFontStyle(1);
    c.setFontFamily('Helvetica');
    c.setFontSize(Math.min(w, h) * 0.4);
    c.text(w * 0.5, h * 0.25, 0, 0, m, 'center', 'middle', 0, null, 0, 0, 0);
  }
  drawSpringAct(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.5, h);
    c.moveTo(w * 0.32, h * 0.16);
    c.lineTo(w * 0.68, h * 0.08);
    c.moveTo(w * 0.21, h * 0.32);
    c.lineTo(w * 0.79, h * 0.20);
    c.moveTo(w * 0.1, h * 0.52);
    c.lineTo(w * 0.9, h * 0.36);
    c.moveTo(0, h * 0.72);
    c.lineTo(w, h * 0.5);
    c.stroke();
  }
  drawSolenoidManResetAct(c: Mx, w: number, h: number) {
    c.rect(0, 0, w * 0.61, h * 0.46);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.56, h * 0.6);
    c.lineTo(w * 0.78, h * 0.5);
    c.lineTo(w, h * 0.6);
    c.lineTo(w * 0.78, h * 0.7);
    c.close();
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.305, h * 0.46);
    c.lineTo(w * 0.305, h);
    c.moveTo(w * 0.305, h * 0.6);
    c.lineTo(w * 0.56, h * 0.6);
    c.stroke();
    c.setFontStyle(1);
    c.setFontFamily('Helvetica');
    c.setFontSize(Math.min(w, h) * 0.4);
    c.text(w * 0.305, h * 0.23, 0, 0, 'S', 'center', 'middle', 0, null, 0, 0, 0);
    c.setFontStyle(0);
    c.setFontSize(Math.min(w, h) * 0.15);
    c.text(w * 0.78, h * 0.6, 0, 0, 'R', 'center', 'middle', 0, null, 0, 0, 0);
  }
  drawSingActingActBg(c: Mx, w: number, h: number) {
    c.rect(0, 0, w * 0.46, h * 0.46);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.23, h * 0.46);
    c.lineTo(w * 0.23, h);
    c.moveTo(w * 0.46, h * 0.23);
    c.lineTo(w, h * 0.23);
    c.moveTo(w * 0.77, h * 0.15);
    c.lineTo(w * 0.69, h * 0.31);
    c.moveTo(w * 0.82, h * 0.15);
    c.lineTo(w * 0.74, h * 0.31);
    c.stroke();
  }
  drawActingActFg(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(w * 0.23, h * 0.23);
    c.lineTo(w * 0.23, h * 0.46);
    c.moveTo(0, h * 0.23);
    c.lineTo(w * 0.46, h * 0.23);
    c.stroke();
  }
  drawDblActingActBg(c: Mx, w: number, h: number) {
    c.rect(0, 0, w * 0.46, h * 0.46);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.23, h * 0.46);
    c.lineTo(w * 0.23, h);
    c.moveTo(w * 0.46, h * 0.115);
    c.lineTo(w, h * 0.115);
    c.moveTo(w * 0.77, h * 0.035);
    c.lineTo(w * 0.69, h * 0.195);
    c.moveTo(w * 0.82, h * 0.035);
    c.lineTo(w * 0.74, h * 0.195);
    c.moveTo(w * 0.46, h * 0.345);
    c.lineTo(w, h * 0.345);
    c.moveTo(w * 0.77, h * 0.265);
    c.lineTo(w * 0.69, h * 0.425);
    c.moveTo(w * 0.82, h * 0.265);
    c.lineTo(w * 0.74, h * 0.425);
    c.stroke();
  }
  drawPilotCylinderActBg(c: Mx, w: number, h: number) {
    c.rect(0, 0, w * 0.46, h * 0.46);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.23, h * 0.46);
    c.lineTo(w * 0.23, h);
    c.moveTo(w * 0.46, h * 0.23);
    c.lineTo(w * 0.77, h * 0.23);
    c.stroke();
    c.rect(w * 0.77, h * 0.115, w * 0.23, h * 0.23);
    c.fillAndStroke();
    c.setFontStyle(0);
    c.setFontFamily('Helvetica');
    c.setFontSize(Math.min(w, h) * 0.15);
    c.text(w * 0.885, h * 0.23, 0, 0, 'P', 'center', 'middle', 0, null, 0, 0, 0);
  }
  drawAngleBlowdownAct(c: Mx, w: number, h: number) {
    c.begin();
    c.moveTo(w * 0.34, 0);
    c.lineTo(w, h * 0.405);
    c.moveTo(0, h);
    c.lineTo(w * 0.665, h * 0.205);
    c.stroke();
  }
  drawSquareAct(c: Mx, w: number, h: number, actuator: string) {
    c.rect(0, 0, w, h * 0.5);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.5, h * 0.5);
    c.lineTo(w * 0.5, h);
    c.stroke();
    var m = '';
    if (actuator === 'pilot') {
      m = 'P';
    } else if (actuator === 'solenoid') {
      m = 'S';
    } else if (actuator === 'digital') {
      m = 'D';
    } else if (actuator === 'weight') {
      m = 'W';
    } else if (actuator === 'key') {
      m = 'K';
    }
    c.setFontStyle(1);
    c.setFontFamily('Helvetica');
    c.setFontSize(Math.min(w, h) * 0.4);
    c.text(w * 0.5, h * 0.25, 0, 0, m, 'center', 'middle', 0, null, 0, 0, 0);
  }
  drawGateVariantFg(c: Mx, x: number, y: number, w: number, h: number, valveType: string, _actuator: string, actH: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    if (valveType === 'ball') {
      c.ellipse(x + w * 0.3, y + actH + (h - actH) * 0.18, w * 0.4, (h - actH) * 0.64);
      c.fillAndStroke();
    } else if (valveType === 'globe') {
      c.ellipse(x + w * 0.3, y + actH + (h - actH) * 0.18, w * 0.4, (h - actH) * 0.64);
      c.setFillColor(strokeColor);
      c.fillAndStroke();
      c.setFillColor(fillColor);
    } else if (valveType === 'plug') {
      this.drawPlug(c, x + w * 0.4, y + actH + (h - actH) * 0.25, w * 0.2, (h - actH) * 0.5);
    } else if (valveType === 'needle') {
      this.drawNeedle(c, x + w * 0.45, y + actH + (h - actH) * 0.1, w * 0.1, (h - actH) * 0.9);
    } else if (valveType === 'selfDrain') {
      this.drawDrain(c, x + w * 0.48, y + actH + (h - actH) * 0.5, w * 0.04, (h - actH) * 0.49);
    }
  }
  drawAngleVariantFg(c: Mx, _x: number, _y: number, w: number, h: number, valveType: string, actuator: string, _actH: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    if (valveType === 'angleGlobe') {
      if (actuator === 'none') {
        c.ellipse(w * 0.34, h * 0.175, w * 0.32, h * 0.4);
      } else {
        c.ellipse(w * 0.34, h * 0.45, w * 0.32, h * 0.2667);
      }
      c.setFillColor(strokeColor);
      c.fillAndStroke();
      c.setFillColor(fillColor);
    }
  }
  drawGateVariantBg(c: Mx, x: number, y: number, w: number, h: number, valveType: string, _actuator: string, actH: number) {
    if (valveType === 'gate') {
      this.drawGateValve(c, x, y + actH, w, h - actH);
    } else if (valveType === 'ball' || valveType === 'globe') {
      c.ellipse(x + w * 0.3, y + actH + (h - actH) * 0.18, w * 0.4, (h - actH) * 0.64);
      c.fillAndStroke();
      this.drawGateValve(c, x, y + actH, w, h - actH);
    } else if (valveType === 'plug') {
      this.drawPlug(c, x + w * 0.4, y + actH + (h - actH) * 0.25, w * 0.2, (h - actH) * 0.5);
      this.drawGateValve(c, x, y + actH, w, h - actH);
    } else if (valveType === 'needle') {
      this.drawNeedle(c, x + w * 0.45, y + actH + (h - actH) * 0.1, w * 0.1, (h - actH) * 0.9);
      this.drawGateValve(c, x, y + actH, w, h - actH);
    } else if (valveType === 'selfDrain') {
      this.drawDrain(c, x + w * 0.48, y + actH + (h - actH) * 0.5, w * 0.04, (h - actH) * 0.49);
      this.drawGateValve(c, x, y + actH, w, h - actH);
    }
  }
  drawAngleVariantBg(c: Mx, x: number, y: number, w: number, h: number, valveType: string, _actuator: string, actH: number) {
    if (valveType === 'angle') {
      this.drawAngleValve(c, w * 0.2, y + actH, w * 0.8, h - actH);
    } else if (valveType === 'angleGlobe') {
      this.drawAngleGlobeValveBg(c, w * 0.2, y + actH, w * 0.8, h - actH);
    } else if (valveType === 'threeWay') {
      this.drawThreeWayValve(c, 0, y + actH, w, h - actH);
    } else if (valveType === 'angBlow') {
      this.drawAngleBlowdownValve(c, x, y + actH, w, h - actH);
    }
  }
  drawPlug(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.5, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.5, h);
    c.close();
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawNeedle(c: Mx, x: number, y: number, w: number, h: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    c.translate(x, y);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w * 0.5, h);
    c.close();
    c.setFillColor(strokeColor);
    c.fillAndStroke();
    c.setFillColor(fillColor);
    c.translate(-x, -y);
  }
  drawDrain(c: Mx, x: number, y: number, w: number, h: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    c.translate(x, y);
    c.begin();
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.5, h * 0.96);
    c.stroke();
    c.begin();
    c.moveTo(0, h * 0.9);
    c.lineTo(w, h * 0.9);
    c.lineTo(w * 0.5, h);
    c.close();
    c.setFillColor(strokeColor);
    c.fillAndStroke();
    c.setFillColor(fillColor);
    c.translate(-x, -y);
  }
  drawGateValve(c: Mx, x: number, y: number, w: number, h: number) {
    var defState = this.gv('defState', 'open');
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    c.translate(x, y);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.5, h * 0.5);
    c.lineTo(0, h);
    c.close();
    c.moveTo(w, 0);
    c.lineTo(w * 0.5, h * 0.5);
    c.lineTo(w, h);
    c.close();
    if (defState === 'closed') {
      c.setFillColor(strokeColor);
      c.fillAndStroke();
      c.setFillColor(fillColor);
    } else {
      c.fillAndStroke();
    }
    c.translate(-x, -y);
  }
  drawAngleValve(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(w * 0.375, h * 0.375);
    c.lineTo(w, 0);
    c.lineTo(w, h * 0.75);
    c.close();
    c.moveTo(w * 0.375, h * 0.375);
    c.lineTo(w * 0.75, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawAngleGlobeValveBg(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.ellipse(w * 0.175, h * 0.175, w * 0.4, h * 0.4);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.375, h * 0.375);
    c.lineTo(w, 0);
    c.lineTo(w, h * 0.75);
    c.close();
    c.moveTo(w * 0.375, h * 0.375);
    c.lineTo(w * 0.75, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawAngleGlobeValveFg(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.ellipse(w * 0.275, h * 0.275, w * 0.2, h * 0.2);
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawThreeWayValve(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.5, h * 0.375);
    c.lineTo(0, h * 0.75);
    c.close();
    c.moveTo(w, 0);
    c.lineTo(w * 0.5, h * 0.375);
    c.lineTo(w, h * 0.75);
    c.close();
    c.moveTo(w * 0.5, h * 0.375);
    c.lineTo(w * 0.8, h);
    c.lineTo(w * 0.2, h);
    c.close();
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawAngleBlowdownValve(_c: Mx, _x: number, _y: number, _w: number, _h: number) {
  }
  drawButterflyValve(c: Mx, x: number, y: number, w: number, h: number, _actuator: string, actH: number) {
    var yv = y + actH;
    var hv = h - actH;
    c.translate(x, yv);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, hv);
    c.moveTo(w, 0);
    c.lineTo(w, hv);
    c.moveTo(w * 0.05, hv * 0.05);
    c.lineTo(w * 0.95, hv * 0.95);
    c.fillAndStroke();
    c.ellipse(w * 0.4, hv * 0.33, w * 0.2, hv * 0.33);
    c.fillAndStroke();
    c.translate(-x, -y);
  }
  drawCheckValve(c: Mx, x: number, y: number, w: number, h: number, _actuator: string, actH: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    var yv = y + actH;
    var hv = h - actH;
    c.translate(x, yv);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, hv);
    c.moveTo(w, 0);
    c.lineTo(w, hv);
    c.moveTo(w * 0.05, hv * 0.05);
    c.lineTo(w * 0.95, hv * 0.95);
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.8925, hv * 0.815);
    c.lineTo(w * 0.957, hv * 0.955);
    c.lineTo(w * 0.85, hv * 0.928);
    c.close();
    c.setFillColor(strokeColor);
    c.fillAndStroke();
    c.setFillColor(fillColor);
    c.translate(-x, -y);
  }
  isGateVariant(valveType: string) {
    if (valveType === 'gate' ||
        valveType === 'ball' ||
        valveType === 'plug' ||
        valveType === 'needle' ||
        valveType === 'selfDrain' ||
        valveType === 'globe') {
      return true;
    } else {
      return false;
    }
  }
  isAngleVariant(valveType: string) {
    if (valveType === 'angle' ||
        valveType === 'angleGlobe' ||
        valveType === 'threeWay' ||
        valveType === 'angBlow') {
      return true;
    } else {
      return false;
    }
  }
  isSquareVariant(actType: string) {
    if (actType === 'pilot' ||
        actType === 'solenoid' ||
        actType === 'powered' ||
        actType === 'digital' ||
        actType === 'weight' ||
        actType === 'key') {
      return true;
    } else {
      return false;
    }
  }
}

/** mxShapePidIntBlockBleedValve (draw.io の shapes/pid2/mxPidValves.js) */
class PidIntBlockBleedValve extends PidValve {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    var actuator = this.gv('actuator', 'none');
    var actH = 0;
    if (actuator !== 'none') {
      actH = h * 0.2353;
    }
    c.translate(x, y);
    c.setLineJoin('round');
    this.bleedBackground(c, x, y, w, h, actuator, actH);
    c.setShadow(false);
    this.bleedForeground(c, x, y, w, h, actuator, actH);
  }
  /** ソースの background (引数の並びが基底と違うので、名前を変えた) */
  bleedBackground(c: Mx, x: number, y: number, w: number, h: number, actuator: string, actH: number) {
    if (actuator !== 'none') {
      this.drawActuatorBg(c, x, y, w, h, actuator);
    }
    this.drawValveBg(c, 0, actH, w, h - actH);
  }
  /** ソースの foreground (同上) */
  bleedForeground(c: Mx, x: number, y: number, w: number, h: number, actuator: string, _actH: number) {
    if (actuator !== 'none') {
      this.drawActuatorFg(c, x, y, w, h, actuator);
    }
  }
  drawValveBg(c: Mx, x: number, y: number, w: number, h: number) {
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    c.translate(x, y);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.5, h * 0.23);
    c.lineTo(0, h * 0.46);
    c.close();
    c.moveTo(w * 0.5, h * 0.23);
    c.lineTo(w, 0);
    c.lineTo(w, h * 0.46);
    c.close();
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.5, h * 0.23);
    c.lineTo(w * 0.5, h * 0.5);
    c.stroke();
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.3, h * 0.5);
    c.lineTo(w * 0.7, h * 0.5);
    c.lineTo(w * 0.5, h * 0.75);
    c.close();
    c.fillAndStroke();
    c.begin();
    c.moveTo(w * 0.3, h);
    c.lineTo(w * 0.5, h * 0.75);
    c.lineTo(w * 0.7, h);
    c.fillAndStroke();
    c.setFillColor(fillColor);
    c.translate(-x, -y);
  }
  drawActuatorBg(c: Mx, _x: number, _y: number, w: number, h: number, actuator: string) {
    if (this.isSquareVariant(actuator)) {
      c.translate(w * 0.325, 0);
      this.drawSquareAct(c, w * 0.35, h * 0.4112, actuator);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'man') {
      c.translate(w * 0.25, h * 0.0882);
      this.drawManAct(c, w * 0.5, h * 0.323);
      c.translate(- w * 0.25, - h * 0.0882);
    } else if (actuator === 'diaph') {
      c.translate(w * 0.25, h * 0.0588);
      this.drawDiaphAct(c, w * 0.5, h * 0.3524);
      c.translate(- w * 0.25, - h * 0.0588);
    } else if (actuator === 'balDiaph') {
      c.translate(w * 0.25, h * 0.0588);
      this.drawBalDiaphActBg(c, w * 0.5, h * 0.3524);
      c.translate(- w * 0.25, - h * 0.0588);
    } else if (actuator === 'motor' || actuator === 'elHyd') {
      c.translate(w * 0.325, 0);
      this.drawCircleAct(c, w * 0.35, h * 0.4112, actuator);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'spring') {
      c.translate(w * 0.36, 0);
      this.drawSpringAct(c, w * 0.28, h * 0.4112);
      c.translate(- w * 0.36, 0);
    } else if (actuator === 'solenoidManRes') {
      c.translate(w * 0.325, 0);
      this.drawSolenoidManResetAct(c, w * 0.575, h * 0.4112);
      c.translate(- w * 0.325, 0);
    } else if (actuator === 'singActing') {
      c.translate(w * 0.35, 0);
      this.drawSingActingActBg(c, w * 0.65, h * 0.4112);
      c.translate(- w * 0.35, 0);
    } else if (actuator === 'dblActing') {
      c.translate(w * 0.35, 0);
      this.drawDblActingActBg(c, w * 0.65, h * 0.4112);
      c.translate(- w * 0.35, 0);
    } else if (actuator === 'pilotCyl') {
      c.translate(w * 0.35, 0);
      this.drawPilotCylinderActBg(c, w * 0.65, h * 0.4112);
      c.translate(- w * 0.35, 0);
    }
  }
  drawActuatorFg(c: Mx, _x: number, _y: number, w: number, h: number, actuator: string) {
    if (actuator === 'balDiaph') {
      c.translate(w * 0.25, h * 0.0588);
      this.drawBalDiaphActFg(c, w * 0.5, h * 0.3524);
      c.translate(- w * 0.25, - h * 0.0588);
    } else if (actuator === 'singActing' ||
        actuator === 'dblActing' ||
        actuator === 'pilotCyl') {
      c.translate(w * 0.35, 0);
      this.drawActingActFg(c, w * 0.65, h * 0.4112);
      c.translate(- w * 0.35, 0);
    }
  }
}

/** mxShapePidAutoRecircValve (draw.io の shapes/pid2/mxPidValves.js) */
class PidAutoRecircValve extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.setLineJoin('round');
    c.translate(x, y);
    c.rect(0, 0, w, h);
    c.fillAndStroke();
    c.setShadow(false);
    c.begin();
    c.moveTo(w * 0.08, h * 0.08);
    c.lineTo(w * 0.08, h * 0.92);
    c.moveTo(w * 0.92, h * 0.08);
    c.lineTo(w * 0.92, h * 0.92);
    c.moveTo(w * 0.12, h * 0.122);
    c.lineTo(w * 0.8738, h * 0.8837);
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.55, h * 0.05);
    c.lineTo(w * 0.45, h * 0.15);
    c.lineTo(w * 0.55, h * 0.25);
    c.lineTo(w * 0.45, h * 0.35);
    c.lineTo(w * 0.55, h * 0.45);
    c.lineTo(w * 0.49, h * 0.5);
    c.stroke();
    var fillColor = this.col('fillColor', '#ffffff');
    var strokeColor = this.col('strokeColor', '#000000');
    c.begin();
    c.moveTo(w * 0.8257, h * 0.7695);
    c.lineTo(w * 0.8797, h * 0.888);
    c.lineTo(w * 0.79, h * 0.8651);
    c.close();
    c.setFillColor(strokeColor);
    c.fillAndStroke();
    c.setFillColor(fillColor);
  }
}

/** mxShapePidDiscInst (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidDiscInst extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var mounting = this.gv('mounting', 'field');
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.005, h * 0.48);
      c.lineTo(w * 0.995, h * 0.48);
      c.moveTo(w * 0.005, h * 0.52);
      c.lineTo(w * 0.995, h * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidSharedCont (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidSharedCont extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var mounting = this.gv('mounting', 'field');
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.005, h * 0.48);
      c.lineTo(w * 0.995, h * 0.48);
      c.moveTo(w * 0.005, h * 0.52);
      c.lineTo(w * 0.995, h * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidCompFunc (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidCompFunc extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.25, 0);
    c.lineTo(w * 0.75, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.75, h);
    c.lineTo(w * 0.25, h);
    c.close();
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var mounting = this.gv('mounting', 'field');
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.01, h * 0.48);
      c.lineTo(w * 0.99, h * 0.48);
      c.moveTo(w * 0.01, h * 0.52);
      c.lineTo(w * 0.99, h * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidProgLogCont (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidProgLogCont extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var mounting = this.gv('mounting', 'field');
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.5, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.5, h);
    c.close();
    c.stroke();
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.02, h * 0.48);
      c.lineTo(w * 0.98, h * 0.48);
      c.moveTo(w * 0.02, h * 0.52);
      c.lineTo(w * 0.98, h * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidIndicator (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidIndicator extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    var type = this.gv('indType', 'inst');
    c.begin();
    c.moveTo(w * 0.5, w);
    c.lineTo(w * 0.5, h);
    c.stroke();
    if (type === 'inst') {
      c.ellipse(0, 0, w, w);
      c.fillAndStroke();
    } else if (type === 'ctrl') {
      c.rect(0, 0, w, w);
      c.fillAndStroke();
    } else if (type === 'func') {
      c.begin();
      c.moveTo(0, w * 0.5);
      c.lineTo(w * 0.25, 0);
      c.lineTo(w * 0.75, 0);
      c.lineTo(w, w * 0.5);
      c.lineTo(w * 0.75, w);
      c.lineTo(w * 0.25, w);
      c.close();
      c.fillAndStroke();
    } else if (type === 'plc') {
      c.rect(0, 0, w, w);
      c.fillAndStroke();
    }
  }
  foreground(c: Mx, _x: number, _y: number, w: number, _h: number) {
    var mounting = this.gv('mounting', 'field');
    var type = this.gv('indType', 'inst');
    if (type === 'ctrl') {
      c.ellipse(0, 0, w, w);
      c.stroke();
    } else if (type === 'plc') {
      c.begin();
      c.moveTo(0, w * 0.5);
      c.lineTo(w * 0.5, 0);
      c.lineTo(w, w * 0.5);
      c.lineTo(w * 0.5, w);
      c.close();
      c.stroke();
    }
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, w * 0.5);
      c.lineTo(w, w * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, w * 0.5);
      c.lineTo(w, w * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.005, w * 0.48);
      c.lineTo(w * 0.995, w * 0.48);
      c.moveTo(w * 0.005, w * 0.52);
      c.lineTo(w * 0.995, w * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidLogic (draw.io の shapes/pid2/mxPidInstruments.js) */
class PidLogic extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w * 0.5, 0);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.5, h);
    c.close();
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var mounting = this.gv('mounting', 'field');
    if (mounting === 'room') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'inaccessible') {
      c.setDashed(true);
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (mounting === 'local') {
      c.begin();
      c.moveTo(w * 0.02, h * 0.48);
      c.lineTo(w * 0.98, h * 0.48);
      c.moveTo(w * 0.02, h * 0.52);
      c.lineTo(w * 0.98, h * 0.52);
      c.stroke();
    }
  }
}

/** mxShapePidFan (draw.io の shapes/pid2/mxPidMisc.js) */
class PidFan extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.moveTo(w * 0.3, h * 0.045);
    c.lineTo(w * 0.97, h * 0.33);
    c.moveTo(w * 0.3, h * 0.955);
    c.lineTo(w * 0.97, h * 0.67);
    c.moveTo(w * 0.4228, h * 0.3655);
    c.arcTo(w * 0.15, h * 0.03, 50, 0, 1, w * 0.5, h * 0.5);
    c.arcTo(w * 0.15, h * 0.03, 50, 0, 1, w * 0.3772, h * 0.4045);
    c.arcTo(w * 0.15, h * 0.03, 50, 0, 1, w * 0.3025, h * 0.271);
    c.arcTo(w * 0.15, h * 0.03, 50, 0, 1, w * 0.4228, h * 0.3655);
    c.close();
    c.moveTo(w * 0.377, h * 0.5973);
    c.arcTo(w * 0.15, h * 0.03, -50, 0, 1, w * 0.4966, h * 0.5019);
    c.arcTo(w * 0.15, h * 0.03, -50, 0, 1, w * 0.423, h * 0.636);
    c.arcTo(w * 0.15, h * 0.03, -50, 0, 1, w * 0.3034, h * 0.7314);
    c.arcTo(w * 0.15, h * 0.03, -50, 0, 1, w * 0.377, h * 0.5973);
    c.close();
    c.stroke();
    c.ellipse(w * 0.5, h * 0.47, w * 0.3, h * 0.06);
    c.stroke();
    var type = this.gv('fanType', 'common');
    if (type === 'axial') {
      c.begin();
      c.moveTo(w * 0.1, h * 0.5);
      c.lineTo(w * 0.3, h * 0.5);
      c.stroke();
    } else if (type === 'radial') {
      c.begin();
      c.moveTo(w * 0.2, h * 0.4);
      c.lineTo(w * 0.2, h * 0.6);
      c.stroke();
    }
  }
}

/** mxShapePidColumn (draw.io の shapes/pid2/mxPidMisc.js) */
class PidColumn extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    h = Math.max(h, 30);
    c.begin();
    c.moveTo(0, 15);
    c.arcTo(w * 0.5, 15, 0, 0, 1, w, 15);
    c.lineTo(w, h - 15);
    c.arcTo(w * 0.5, 15, 0, 0, 1, 0, h - 15);
    c.close();
    c.fillAndStroke();
  }
  foreground(c: Mx, _x: number, _y: number, w: number, h: number) {
    var type = this.gv('columnType', 'common');
    // 中の段は MAX_REPEAT 段まで (Kumiori の守り。段の間は幅に比べる (幅の 0.1 倍から) ので、幅が 0 以下だと尽きない)
    if (type === 'fixed') {
      var step = w * 1.2;
      var range = h - 50;
      var rem = range % step;
      var off = rem * 0.5 + 25;
      c.begin();
      for (var i = 0, n = 0; i <= range - step && n < MAX_REPEAT; i += step, n++) {
        c.moveTo(0, i + off + step * 0.1);
        c.lineTo(w, i + off + step * 0.1);
        c.moveTo(0, i + off + step * 0.9);
        c.lineTo(w, i + off + step * 0.9);
        c.moveTo(0, i + off + step * 0.1);
        c.lineTo(w, i + off + step * 0.9);
        c.moveTo(0, i + off + step * 0.9);
        c.lineTo(w, i + off + step * 0.1);
      }
      c.stroke();
    } else if (type === 'tray') {
      var step = w * 0.2;
      var range = h - 50;
      var rem = range % step;
      var off = rem * 0.5 + 25;
      c.setDashed(true);
      c.begin();
      for (var i = 0, n = 0; i <= range && n < MAX_REPEAT; i += step, n++) {
        c.moveTo(0, i + off);
        c.lineTo(w, i + off);
      }
      c.stroke();
    } else if (type === 'fluid') {
      var stepY = w * 0.1;
      var stepX = w * 0.1;
      var range = h - 50;
      var rem = range % stepY;
      var off = 25;
      var dot = Math.min(w, h) * 0.02;
      var dashed = this.gv('dashed', '0');
      var strokeColor = this.col('strokeColor', '#000000');
      var odd = 0;
      c.setFillColor(strokeColor);
      c.setDashed(true);
      c.begin();
      c.moveTo(0, 25);
      c.lineTo(w, 25);
      c.moveTo(0, h - 25);
      c.lineTo(w, h - 25);
      c.stroke();
      if (dashed === '0') {
        c.setDashed(false);
      } else {
        c.setDashed(true);
      }
      var counter = 0;
      for (var i = off + stepY * 0.5; i < range + off - dot && counter < MAX_REPEAT; i += stepY) {
        var startJ = stepX;
        odd = counter % 2;
        if (odd === 0) {
          startJ = stepX * 0.5;
        }
        for (var j = startJ; j < w; j += stepX ) {
          c.ellipse(j, i, dot, dot);
          c.fillAndStroke();
        }
        counter++;
      }
    } else if (type === 'baffle') {
      var stepY = w * 0.2;
      var range = h - 50 - stepY;
      var rem = range % stepY;
      var off = 25 + stepY * 0.5;
      var odd = 0;
      c.setDashed(true);
      c.begin();
      c.moveTo(0, 25);
      c.lineTo(w, 25);
      c.moveTo(0, h - 25);
      c.lineTo(w, h - 25);
      c.stroke();
      var counter = 0;
      c.begin();
      for (var i = off + stepY * 0.5; i < range + off && counter < MAX_REPEAT; i += stepY) {
        odd = counter % 2;
        if (odd === 0) {
          c.moveTo(0, i);
          c.lineTo(w * 0.9, i);
          c.lineTo(w * 0.9, i - stepY * 0.3);
        } else {
          c.moveTo(w * 0.1, i - stepY * 0.5);
          c.lineTo(w * 0.1, i);
          c.lineTo(w, i);
        }
        counter++;
      }
      c.stroke();
    } else if (type === 'valve' || type === 'bubble') {
      var stepY = w * 0.2;
      var range = h - 50 - stepY;
      var rem = range % stepY;
      var off = 25 + stepY * 0.5;
      var dashed = this.gv('dashed', '0');
      var odd = 0;
      c.setFillColor(strokeColor);
      c.setDashed(true);
      c.begin();
      c.moveTo(0, 25);
      c.lineTo(w, 25);
      c.moveTo(0, h - 25);
      c.lineTo(w, h - 25);
      c.stroke();
      if (dashed === '0') {
        c.setDashed(false);
      } else {
        c.setDashed(true);
      }
      c.begin();
      for (var i = off + stepY * 0.5, n = 0; i < range + off && n < MAX_REPEAT; i += stepY, n++) {
          c.moveTo(0, i);
          c.lineTo(w * 0.4, i);
          if (type === 'valve') {
            c.moveTo(w * 0.4, i - stepY * 0.2);
            c.lineTo(w * 0.6, i - stepY * 0.2);
          } else if (type === 'bubble') {
            c.moveTo(w * 0.25, i - stepY * 0.2);
            c.arcTo(stepY * 3, stepY * 3, 0, 0, 1, w * 0.75, i - stepY * 0.2);
          }
          c.moveTo(w * 0.6, i);
          c.lineTo(w, i);
      }
      c.stroke();
    } else if (type === 'nozzle') {
      var step = w * 1.2;
      var range = h - 50;
      var rem = range % step;
      var off = rem * 0.5 + 25;
      var dashedN = this.gvn('dashed', 0);
      for (var i = 0, n = 0; i <= range - step && n < MAX_REPEAT; i += step, n++) {
        c.setDashed(true);
        c.begin();
        c.moveTo(0, i + off + step * 0.2);
        c.lineTo(w, i + off + step * 0.2);
        c.moveTo(0, i + off + step * 0.8);
        c.lineTo(w, i + off + step * 0.8);
        c.stroke();
        if (dashedN === 0) {
          c.setDashed(false);
        } else {
          c.setDashed(true);
        }
        c.begin();
        c.moveTo(0, i + off + step * 0.2);
        c.lineTo(w, i + off + step * 0.8);
        c.moveTo(0, i + off + step * 0.8);
        c.lineTo(w, i + off + step * 0.2);
        if (i !== 0) {
          c.moveTo(0, i + off);
          c.lineTo(w * 0.5, i + off);
          c.moveTo(w * 0.5 - step * 0.08, i + off + step * 0.08);
          c.lineTo(w * 0.5, i + off);
          c.lineTo(w * 0.5 + step * 0.08, i + off + step * 0.08);
          c.moveTo(w * 0.5, i + off);
          c.lineTo(w * 0.5, i + off + step * 0.08);
        }
        c.stroke();
      }
      c.stroke();
    }
  }
}

/** mxShapePidConveyor (draw.io の shapes/pid2/mxPidMisc.js) */
class PidConveyor extends MxShape {
  paintVertexShape(c: Mx, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
  }
  background(c: Mx, _x: number, _y: number, w: number, h: number) {
    var wheelSize = Math.min(h, w * 0.5);
    c.begin();
    c.moveTo(wheelSize * 0.5, 0);
    c.lineTo(w - wheelSize * 0.5, 0);
    c.stroke();
    c.ellipse(0, 0, wheelSize, wheelSize);
    c.fillAndStroke();
    c.ellipse(w - wheelSize, 0, wheelSize, wheelSize);
    c.fillAndStroke();
    c.begin();
    c.moveTo(wheelSize * 0.5, wheelSize);
    c.lineTo(w - wheelSize * 0.5, wheelSize);
    c.stroke();
    var dist = w - wheelSize * 1.8;
    var startX = wheelSize * 0.9;
    var step = wheelSize * 0.7;
    // 受けは MAX_REPEAT 組まで (Kumiori の守り。高さが 0 だと間 (step) が 0 になり、尽きない)
    for (var i = 0, n = 0; i < dist && n < MAX_REPEAT; i = i + step, n++) {
      c.rect(startX + i, 0, wheelSize * 0.2, wheelSize * 0.1);
      c.fillAndStroke();
      c.rect(startX + i, wheelSize * 0.9, wheelSize * 0.2, wheelSize * 0.1);
      c.fillAndStroke();
    }
  }
}

export const SHAPES_ELECTRICAL: Record<string, ShapePainter> = {
  'mxgraph.electrical.transmission.testPoint': paint(ElectricalTestPoint),
  'mxgraph.electrical.transmission.straightBus': paint(ElectricalStraightBus),
  'mxgraph.electrical.transmission.twoLineBusElbow': paint(ElectricalTwoLineBusElbow),
  'mxgraph.electrical.transmission.threeLineBusElbow': paint(ElectricalThreeLineBusElbow),
  'mxgraph.electrical.transmission.fourLineBusElbow': paint(ElectricalFourLineBusElbow),
  'mxgraph.electrical.transmission.eightLineBusElbow': paint(ElectricalEightLineBusElbow),
  'mxgraph.electrical.logic_gates.logic_gate': paint(ElectricalLogicGate),
  'mxgraph.electrical.logic_gates.buffer2': paint(ElectricalBuffer),
  'mxgraph.electrical.logic_gates.dual_inline_ic': paint(ElectricalDualInLineIC),
  'mxgraph.electrical.logic_gates.qfp_ic': paint(ElectricalQFPIC),
  'mxgraph.electrical.abstract.mux2': paint(ElectricalMux),
  'mxgraph.electrical.miscellaneous.batteryStack': paint(ElectricalBatteryStack),
  'mxgraph.electrical.signal_sources.dc_source_3_v2': paint(ElectricalDCSource3_v2),
  'mxgraph.electrical.signal_sources.source': paint(ElectricalSource),
  'mxgraph.electrical.electro-mechanical.twoWaySwitch': paint(ElectricalTwoWaySwitch),
  'mxgraph.electrical.electro-mechanical.pushbutton': paint(ElectricalPushbutton),
  'mxgraph.electrical.electro-mechanical.singleSwitch': paint(ElectricalSingleSwitch),
  'mxgraph.electrical.electro-mechanical.switchDisconnector': paint(ElectricalSwitchDisconnector),
  'mxgraph.electrical.electro-mechanical.fuse2': paint(ElectricalFuse2),
  'mxgraph.electrical.electro-mechanical.liquidLevelActuatedSwitch': paint(ElectricalLiquidLevelActuatedSwitch),
  'mxgraph.electrical.electro-mechanical.liquidLevelActuatedSwitch2': paint(ElectricalLiquidLevelActuatedSwitch2),
  'mxgraph.electrical.electro-mechanical.gasFlowActuatedSwitch': paint(ElectricalGasFlowActuatedSwitch),
  'mxgraph.electrical.electro-mechanical.flowActuatedSwitch': paint(ElectricalFlowActuatedSwitch),
  'mxgraph.electrical.electro-mechanical.pressureActuatedSwitch': paint(ElectricalPressureActuatedSwitch),
  'mxgraph.electrical.electro-mechanical.temperatureActuatedSwitch': paint(ElectricalTemperatureActuatedSwitch),
  'mxgraph.electrical.electro-mechanical.safetyInterlockSwitch': paint(ElectricalSafetyInterlockSwitch),
  'mxgraph.electrical.electro-mechanical.temperatureSwitch': paint(ElectricalTemperatureSwitch),
  'mxgraph.electrical.electro-mechanical.thermostat2': paint(ElectricalThermostat2),
  'mxgraph.electrical.electro-mechanical.limitSwitch2': paint(ElectricalLimitSwitch2),
  'mxgraph.electrical.electro-mechanical.circuitBreaker2': paint(ElectricalCircuitBreaker2),
  'mxgraph.electrical.electro-mechanical.selectorSwitch3Position2': paint(ElectricalSelectorSwitch3Position2),
  'mxgraph.electrical.electro-mechanical.selectorSwitch4Position2': paint(ElectricalSelectorSwitch4Position2),
  'mxgraph.electrical.electro-mechanical.selectorSwitch6Position2': paint(ElectricalSelectorSwitch6Position2),
  'mxgraph.electrical.electro-mechanical.shortingSelectorSwitch2': paint(ElectricalShortingSelectorSwitch2),
  'mxgraph.electrical.electro-mechanical.proximityLimitSwitch2': paint(ElectricalProximityLimitSwitch2),
  'mxgraph.electrical.electro-mechanical.inertiaSwitch2': paint(ElectricalInertiaSwitch2),
  'mxgraph.electrical.electro-mechanical.pushbuttonBreak2': paint(ElectricalPushbuttonBreak2),
  'mxgraph.electrical.electro-mechanical.manualSwitch2': paint(ElectricalManualSwitch2),
  'mxgraph.electrical.electro-mechanical.twoWayContact2': paint(ElectricalTwoWayContact2),
  'mxgraph.electrical.electro-mechanical.passingMakeContact2': paint(ElectricalPassingMakeContact2),
  'mxgraph.electrical.electro-mechanical.dpst2': paint(ElectricalDPST2),
  'mxgraph.electrical.electro-mechanical.springReturn3': paint(ElectricalSpringReturn3),
  'mxgraph.electrical.electro-mechanical.limitSwitch': paint(ElectricalLimitSwitch),
  'mxgraph.electrical.electro-mechanical.dpdt3': paint(ElectricalDPDT3),
  'mxgraph.electrical.electro-mechanical.twoPositionSwitch2': paint(ElectricalTwoPositionSwitch2),
  'mxgraph.electrical.electro-mechanical.threePositionSwitch2': paint(ElectricalThreePositionSwitch2),
  'mxgraph.electrical.electro-mechanical.fourPositionSwitch2': paint(ElectricalFourPositionSwitch2),
  'mxgraph.electrical.electro-mechanical.pushbuttonMakeSwitch2': paint(ElectricalPushbuttonMakeSwitch2),
  'mxgraph.electrical.electro-mechanical.pushbuttonTwoCircuitSwitch2': paint(ElectricalPushbuttonTwoCircuitSwitch2),
  'mxgraph.electrical.electro-mechanical.timeDelaySwitch': paint(ElectricalTimeDelaySwitch),
  'mxgraph.electrical.electro-mechanical.timeDelaySwitch2': paint(ElectricalTimeDelaySwitch2),
  'mxgraph.electrical.electro-mechanical.isolatorSwitch2': paint(ElectricalIsolatorSwitch2),
  'mxgraph.electrical.electro-mechanical.changeoverContactSwitch2': paint(ElectricalChangeoverContactSwitch2),
  'mxgraph.electrical.electro-mechanical.reedSwitch2': paint(ElectricalReedSwitch2),
  'mxgraph.pid2valves.valve': paint(PidValve),
  'mxgraph.pid2valves.blockBleedValve': paint(PidIntBlockBleedValve),
  'mxgraph.pid2valves.autoRecircValve': paint(PidAutoRecircValve),
  'mxgraph.pid2inst.discInst': paint(PidDiscInst),
  'mxgraph.pid2inst.sharedCont': paint(PidSharedCont),
  'mxgraph.pid2inst.compFunc': paint(PidCompFunc),
  'mxgraph.pid2inst.progLogCont': paint(PidProgLogCont),
  'mxgraph.pid2inst.indicator': paint(PidIndicator),
  'mxgraph.pid2inst.logic': paint(PidLogic),
  'mxgraph.pid2misc.fan': paint(PidFan),
  'mxgraph.pid2misc.column': paint(PidColumn),
  'mxgraph.pid2misc.conveyor': paint(PidConveyor),
};
