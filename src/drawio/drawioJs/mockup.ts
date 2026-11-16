/**
 * drawioJs/mockup — draw.io のモックアップの形 (mxgraph.mockup.*。ボタン・入れ物・入力欄・図表・そのほか・文字) を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/mockup/ の mxMockupButtons.js・mxMockupContainers.js・
 * mxMockupForms.js・mxMockupGraphics.js・mxMockupMisc.js・mxMockupText.js。形ごとのクラスの paintVertexShape と、それが呼ぶ
 * background・foreground などを、同じ名前のメソッドとして、同じ順の命令に写した (クラスの名前は mxShapeMockup を除いたもの)。
 * スタイルの値は、draw.io と同じく文字列のまま扱い (mxUtils.getValue)、計算は JavaScript の型の変換に任せる (そのため any で受ける)。
 * 描かないもの: 取っ手 (Graph.handleFactory)・customProperties の画面・影 (setShadow)・ラベルの置き場を変える指定 (Ruler2 の spacingLeft)。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/util/mxAbstractCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mockup/mxMockupButtons.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupContainers.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupForms.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupGraphics.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupMisc.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupText.js: Copyright (c) 2006-2010, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';
import { textWidth } from '../drawioText';
import { prefixSums } from '../prefixSums';

type N = number | string;

/**
 * mxSvgCanvas2D と同じ決まりで、ShapeCanvas へ命令を渡す口。モックアップの形は、次の決まりに頼って書かれているので、それを写す
 * (根拠: mxGraph の mxSvgCanvas2D.js の begin・rect・roundrect・ellipse・addNode・updateStroke、mxAbstractCanvas2D.js の addOp)。
 * - 塗る・線を引くのは「今の要素」。begin は経路の要素を、rect・roundrect・ellipse はその形の要素を新しく作り、それまでの経路は捨てる。
 *   塗ると今の要素は無くなり、begin の無いまま続けた経路の命令は描かれない。begin の後に命令の無いまま塗っても、要素は残る (addNode の早い戻り)。
 * - roundrect の角の半径は、片方だけ書けば、もう片方も同じ (SVG の rect の rx・ry)。
 * - 線の太さは 1 より細くしない (minStrokeWidth)。
 * - 値は文字列のこともあるので、数に直して渡す。
 */
class Canvas {
  /** 今の要素 (path: 経路。shape: 四角・楕円。undefined: 無い) と、経路の命令の数 */
  private node: 'path' | 'shape' | undefined;
  private ops = 0;
  constructor(private c: ShapeCanvas) {}
  private op() {
    if (this.node !== 'path') return false;
    this.ops++;
    return true;
  }
  begin() {
    this.node = 'path';
    this.ops = 0;
    this.c.begin();
  }
  moveTo(x: N, y: N) {
    if (this.op()) this.c.moveTo(+x, +y);
  }
  lineTo(x: N, y: N) {
    if (this.op()) this.c.lineTo(+x, +y);
  }
  quadTo(x1: N, y1: N, x2: N, y2: N) {
    if (this.op()) this.c.quadTo(+x1, +y1, +x2, +y2);
  }
  curveTo(x1: N, y1: N, x2: N, y2: N, x3: N, y3: N) {
    if (this.op()) this.c.curveTo(+x1, +y1, +x2, +y2, +x3, +y3);
  }
  arcTo(rx: N, ry: N, rot: N, large: N, sweep: N, x: N, y: N) {
    if (this.op()) this.c.arcTo(+rx, +ry, +rot, +large, +sweep, +x, +y);
  }
  close() {
    if (this.op()) this.c.close();
  }
  rect(x: N, y: N, w: N, h: N) {
    this.node = 'shape';
    this.c.begin();
    this.c.rect(+x, +y, +w, +h);
  }
  roundrect(x: N, y: N, w: N, h: N, dx?: N, dy?: N) {
    const rx = dx !== undefined && +dx > 0 ? +dx : undefined;
    const ry = dy !== undefined && +dy > 0 ? +dy : undefined;
    this.node = 'shape';
    this.c.begin();
    this.c.roundrect(+x, +y, +w, +h, rx ?? ry ?? 0, ry ?? rx ?? 0);
  }
  ellipse(x: N, y: N, w: N, h: N) {
    this.node = 'shape';
    this.c.begin();
    this.c.ellipse(+x, +y, +w, +h);
  }
  private paint(fill: boolean, stroke: boolean) {
    if (!this.node || (this.node === 'path' && !this.ops)) return;
    if (fill && stroke) this.c.fillAndStroke();
    else if (fill) this.c.fill();
    else this.c.stroke();
    this.node = undefined;
  }
  fill() {
    this.paint(true, false);
  }
  stroke() {
    this.paint(false, true);
  }
  fillAndStroke() {
    this.paint(true, true);
  }
  /** 文字 (mxSvgCanvas2D.text。折り返し・書式・回転などの続きの引数は、モックアップの形ではどれも既定なので読まない) */
  text(x: N, y: N, w: N, h: N, str: unknown, align?: string, valign?: string, ..._rest: unknown[]) {
    if (str == null) return;
    this.c.text(+x, +y, +w, +h, String(str), align, valign);
  }
  /** グラデーション (色・範囲・方向。範囲は、SVG では塗る形の枠になる) */
  setGradient(c1: string, c2: string, _x: N, _y: N, _w: N, _h: N, dir?: string, alpha1?: N, alpha2?: N) {
    this.c.setGradient(c1, c2, dir ?? 'south', alpha1 == null ? 1 : +alpha1, alpha2 == null ? 1 : +alpha2);
  }
  setFillColor(v: unknown) {
    this.c.setFillColor(v == null ? undefined : String(v));
  }
  setStrokeColor(v: unknown) {
    this.c.setStrokeColor(v == null ? undefined : String(v));
  }
  setStrokeWidth(v: N) {
    const w = +v;
    this.c.setStrokeWidth(w > 0 ? Math.max(1, w) : w);
  }
  setFontColor(v: unknown) {
    this.c.setFontColor(v == null ? '#000000' : String(v));
  }
  setFontSize(v: N) {
    this.c.setFontSize(+v);
  }
  setFontStyle(v: N) {
    this.c.setFontStyle(+v || 0);
  }
  setFontFamily(v: unknown) {
    this.c.setFontFamily(String(v));
  }
  setAlpha(v: N) {
    this.c.setAlpha(+v);
  }
  setLineCap(v: string) {
    this.c.setLineCap(v);
  }
  setLineJoin(v: string) {
    this.c.setLineJoin(v);
  }
  translate(dx: N, dy: N) {
    this.c.translate(+dx, +dy);
  }
  save() {
    this.c.save();
  }
  restore() {
    this.c.restore();
  }
  setShadow(_on: unknown) {}
}

/** 形のクラスの共通の部分 (スタイルを読む mxUtils.getValue) */
abstract class Mock {
  constructor(readonly e: ShapeEnv) {}
  /** mxUtils.getValue (文字列のまま。無ければ既定の値をそのまま返す) */
  sv(key: string, def: any, ..._ignored: unknown[]): any {
    return this.e.str(key, def);
  }
  /** 色の値 (default・inherit などを解く。none は 'none'。区切りの , で並べた色の列は、そのまま読む) */
  sc(key: string, def: any): any {
    if (typeof def === 'string' && def.includes(',')) return this.e.str(key, def);
    const raw = this.e.str(key, '');
    if (raw.includes(',')) return raw;
    return this.e.color(key, def) ?? 'none';
  }
  /** cst に無い名前のキー (undefined) を読むとき (いつも既定の値になる) */
  noKey(def: any): any {
    return def;
  }
  abstract paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any): void;
}

/** 形のクラスを ShapePainter にする (呼ぶ側が、セルの位置へ移してあるので、x・y は 0) */
const run =
  (K: new (e: ShapeEnv) => Mock): ShapePainter =>
  (c, w, h, e) =>
    new K(e).paintVertexShape(new Canvas(c), 0, 0, w, h);

// ───────────── 文字の幅 (mxUtils.getSizeForString) ─────────────

/**
 * 文字の幅と高さ (mxUtils.getSizeForString。draw.io は画面の上で測る)。幅は drawioText.ts の textWidth (描く側の書体で測るか、
 * Helvetica の字の幅で見積もる)。高さは 1 行 1.2em (mxConstants.LINE_HEIGHT)
 */
function sizeForString(text: unknown, fontSize: N, family = 'Helvetica'): { width: number; height: number } {
  const size = Math.round(+fontSize || 11);
  const lines = String(text ?? '').split('\n');
  const width = Math.max(0, ...lines.map((l) => textWidth(l, size, family)));
  return { width, height: lines.length * size * 1.2 };
}

/**
 * mxUtils.safeDecodeURIComponent に当たるもの。ソース (v24.7.5) は decodeURIComponent で解くが、解けない文字 (壊れた %xx) で投げると
 * 図の全体が描けないので、解けなければ元の文字のままにする (Kumiori の守り。mockupIos.ts・electrical.ts と同じ)
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 繰り返しで描く部分 (暦の日・アイコンの升目・評価の印・物差しの目盛り) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値で描き終わらないのを防ぐため、上限までは描いて、そこで止める。ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_DAYS = 1000;
const MAX_ICONS = 1000;
const MAX_TICKS = 10000;

// ───────────── ボタン (draw.io の shapes/mockup/mxMockupButtons.js) ─────────────

/** mxgraph.mockup.buttons.multiButton: 2 行の文字 (mainText・subText) のボタン。buttonStyle は round・chevron (mxMockupButtons.js の mxShapeMockupMultiButton) */
class MultiButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let mainText = this.sv('mainText', 'Main Text');
    let subText = this.sv('subText', 'Sub Text');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17');
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    c.setFontStyle(1);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
    this.subText(c, x, y, w, h, subText, fontSize / 1.4, fontColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let buttonStyle = this.sv('buttonStyle', 'round').toString();
    let rSize = 10;
    c.begin();

    if (buttonStyle === 'round') {
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    } else if (buttonStyle === 'chevron') {
      c.moveTo(0, h * 0.1);
      c.arcTo(w * 0.0372, h * 0.1111, 0, 0, 1, w * 0.0334, 0);
      c.lineTo(w * 0.768, 0);
      c.arcTo(w * 0.0722, h * 0.216, 0, 0, 1, w * 0.8014, h * 0.0399);
      c.lineTo(w * 0.99, h * 0.4585);
      c.arcTo(w * 0.09, h * 0.1, 0, 0, 1, w * 0.99, h * 0.5415);
      c.lineTo(w * 0.8014, h * 0.9568);
      c.arcTo(w * 0.0722, h * 0.216, 0, 0, 1, w * 0.768, h);
      c.lineTo(w * 0.0334, h);
      c.arcTo(w * 0.0372, h * 0.1111, 0, 0, 1, 0, h * 0.9);
    }

    c.close();
    c.fillAndStroke();
  }
  mainText(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, text?: any, fontSize?: any, fontColor?: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(w * 0.5, h * 0.4, 0, 0, text, 'center', 'middle', 0, null, 0, 0, 0);
  }
  subText(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, text?: any, fontSize?: any, _fontColor?: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.text(w * 0.5, h * 0.7, 0, 0, text, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.buttons.button: 文字 (mainText) のボタン。buttonStyle は round・chevron (mxMockupButtons.js の mxShapeMockupButton) */
class Button extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let mainText = this.sv('mainText', 'Main Text');
    let fontColor = this.sc('textColor', '#666666').toString();
    let fontSize = this.sv('textSize', '17').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let buttonStyle = this.sv('buttonStyle', 'round').toString();
    let rSize = 10;
    c.begin();

    if (buttonStyle === 'round') {
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    } else if (buttonStyle === 'chevron') {
      c.moveTo(0, h * 0.1);
      c.arcTo(w * 0.0372, h * 0.1111, 0, 0, 1, w * 0.0334, 0);
      c.lineTo(w * 0.768, 0);
      c.arcTo(w * 0.0722, h * 0.216, 0, 0, 1, w * 0.8014, h * 0.0399);
      c.lineTo(w * 0.99, h * 0.4585);
      c.arcTo(w * 0.09, h * 0.1, 0, 0, 1, w * 0.99, h * 0.5415);
      c.lineTo(w * 0.8014, h * 0.9568);
      c.arcTo(w * 0.0722, h * 0.216, 0, 0, 1, w * 0.768, h);
      c.lineTo(w * 0.0334, h);
      c.arcTo(w * 0.0372, h * 0.1111, 0, 0, 1, 0, h * 0.9);
    }

    c.close();
    c.fillAndStroke();
  }
  mainText(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, text?: any, fontSize?: any, fontColor?: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.setFontStyle(1);
    c.text(w / 2, h / 2, 0, 0, text, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.buttons.horButtonBar: 横に並べたボタン (mainText を , で分ける。+ で始まる名前が選んだボタン)。幅は文字の幅の割合 (mxMockupButtons.js の mxShapeMockupHorButtonBar) */
class HorButtonBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, buttonText: any;
    let textStrings = this.sv('mainText', '+Button 1, Button 2, Button 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let selectedFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();
    let frameColor = this.sc('strokeColor', '#666666');
    let separatorColor = this.sc('strokeColor2', '#c4c4c4');
    let bgColor = this.sc('fillColor', '#ffffff');
    let selectedFillColor = this.sc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let selectedButton = -1;
    let rSize = 10;
    let labelOffset = 5;

    for (i = 0; i < buttonNum; i++) {
      buttonText = textStrings[i];

      if (buttonText.charAt(0) === '+') {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      buttonWidths[i] = sizeForString(buttonText, fontSize, 'Helvetica').width;

      buttonTotalWidth += buttonWidths[i];
    }

    let trueH = Math.max(h, fontSize * 1.5, 20);
    let minW = 2 * labelOffset * buttonNum + buttonTotalWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);
    this.background(c, trueW, trueH, rSize, buttonNum, buttonWidths, labelOffset, minW, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton);
    c.setShadow(false);

    c.setFontStyle(1);
    let currWidth = 0;

    for (i = 0; i < buttonNum; i++) {
      if (i === selectedButton) {
        c.setFontColor(selectedFontColor);
      } else {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  background(
    c: Canvas,
    w?: any,
    h?: any,
    rSize?: any,
    buttonNum?: any,
    buttonWidths?: any,
    labelOffset?: any,
    minW?: any,
    frameColor?: any,
    separatorColor?: any,
    bgColor?: any,
    selectedFillColor?: any,
    selectedButton?: any,
  ) {
    let i: any, currWidth: any;
    c.begin();

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor(separatorColor);
    c.begin();

    const pre0 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (i = 1; i < buttonNum; i++) {
      if (i !== selectedButton && i !== selectedButton + 1) {
        currWidth = pre0[i];

        currWidth = (currWidth * w) / minW;
        c.moveTo(currWidth, 0);
        c.lineTo(currWidth, h);
      }
    }

    c.stroke();

    let buttonLeft = 0;
    c.setFillColor(selectedFillColor);

    for (i = 0; i < selectedButton; i++) {
      buttonLeft += buttonWidths[i] + 2 * labelOffset;
    }

    buttonLeft = (buttonLeft * w) / minW;
    let buttonRight = ((buttonWidths[selectedButton] + 2 * labelOffset) * w) / minW;
    buttonRight += buttonLeft;

    if (selectedButton === 0) {
      c.begin();

      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(buttonRight, 0);
      c.lineTo(buttonRight, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
      c.close();
      c.fill();
    } else if (selectedButton === buttonNum - 1) {
      c.begin();

      c.moveTo(buttonLeft, 0);
      c.lineTo(buttonRight - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, buttonRight, rSize);
      c.lineTo(buttonRight, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, buttonRight - rSize, h);
      c.lineTo(buttonLeft, h);
      c.close();
      c.fill();
    } else if (selectedButton !== -1) {
      c.begin();

      c.moveTo(buttonLeft, 0);
      c.lineTo(buttonRight, 0);
      c.lineTo(buttonRight, h);
      c.lineTo(buttonLeft, h);
      c.close();
      c.fill();
    }

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.stroke();
  }
  buttonText(c: Canvas, w?: any, h?: any, textString?: any, buttonWidth?: any, fontSize?: any, minW?: any, trueW?: any) {
    if (textString.charAt(0) === '+') {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text(((w + buttonWidth * 0.5) * trueW) / minW, h * 0.5, 0, 0, textString, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.buttons.verButtonBar: 縦に並べたボタン (mainText を , で分ける。+ で始まる名前が選んだボタン) (mxMockupButtons.js の mxShapeMockupVerButtonBar) */
class VerButtonBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, buttonText: any, currWidth: any, currHeight: any;
    let textStrings = this.sv('mainText', '+Button 1, Button 2, Button 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let selectedFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();
    let frameColor = this.sc('strokeColor', '#666666');
    let separatorColor = this.sc('strokeColor2', '#c4c4c4');
    let bgColor = this.sc('fillColor', '#ffffff');
    let selectedFillColor = this.sc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let maxButtonWidth = 0;
    let selectedButton = -1;
    let rSize = 10;
    let labelOffset = 5;

    for (i = 0; i < buttonNum; i++) {
      buttonText = textStrings[i];

      if (buttonText.charAt(0) === '+') {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      currWidth = sizeForString(buttonText, fontSize, 'Helvetica').width;

      if (currWidth > maxButtonWidth) {
        maxButtonWidth = currWidth;
      }
    }

    let minButtonHeight = fontSize * 1.5;
    let minH = buttonNum * minButtonHeight;
    let trueH = Math.max(h, minH);
    let minW = 2 * labelOffset + maxButtonWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);

    this.background(c, trueW, trueH, rSize, buttonNum, labelOffset, buttonNum * minButtonHeight, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton, minButtonHeight);
    c.setShadow(false);

    currWidth = 0;
    c.setFontStyle(1);

    for (i = 0; i < buttonNum; i++) {
      if (i === selectedButton) {
        c.setFontColor(selectedFontColor);
      } else {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      currHeight = ((i * minButtonHeight + minButtonHeight * 0.5) * trueH) / minH;
      this.buttonText(c, trueW, currHeight, textStrings[i], fontSize);
    }
  }
  background(
    c: Canvas,
    w?: any,
    h?: any,
    rSize?: any,
    buttonNum?: any,
    _labelOffset?: any,
    minH?: any,
    frameColor?: any,
    separatorColor?: any,
    bgColor?: any,
    selectedFillColor?: any,
    selectedButton?: any,
    minButtonHeight?: any,
  ) {
    let i: any, currHeight: any, buttonBottom: any, buttonTop: any;
    c.begin();

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor(separatorColor);
    c.begin();

    for (i = 1; i < buttonNum; i++) {
      if (i !== selectedButton && i !== selectedButton + 1) {
        currHeight = (i * minButtonHeight * h) / minH;

        c.moveTo(0, currHeight);
        c.lineTo(w, currHeight);
      }
    }

    c.stroke();

    c.setFillColor(selectedFillColor);

    if (selectedButton === 0) {
      c.begin();
      buttonBottom = (minButtonHeight * h) / minH;
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, buttonBottom);
      c.lineTo(0, buttonBottom);
      c.close();
      c.fill();
    } else if (selectedButton === buttonNum - 1) {
      c.begin();
      buttonTop = h - (minButtonHeight * h) / minH;
      c.moveTo(0, buttonTop);
      c.lineTo(w, buttonTop);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
      c.close();
      c.fill();
    } else if (selectedButton !== -1) {
      c.begin();
      buttonTop = (minButtonHeight * selectedButton * h) / minH;
      buttonBottom = (minButtonHeight * (selectedButton + 1) * h) / minH;
      c.moveTo(0, buttonTop);
      c.lineTo(w, buttonTop);
      c.lineTo(w, buttonBottom);
      c.lineTo(0, buttonBottom);
      c.close();
      c.fill();
    }

    c.begin();
    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.stroke();
  }
  buttonText(c: Canvas, w?: any, h?: any, textString?: any, fontSize?: any) {
    if (textString.charAt(0) === '+') {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text(w * 0.5, h, 0, 0, textString, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.buttons.onOffButton: オン・オフのスイッチ (buttonState) (mxMockupButtons.js の mxShapeMockupOnOffButton) */
class OnOffButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    w = Math.max(w, 10);
    h = Math.max(h, 10);

    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    c.roundrect(0, 0, w, h, 10, 10);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let state = this.sv('buttonState', 'on');
    let fillColor2 = this.sc('fillColor2', '#008cff');
    let textColor = this.sc('textColor', '#ffffff,#999999').toString().split(',');
    let mainText = this.sv('mainText', 'ON,OFF').toString().split(',');
    let textSize = this.sv('textSize', '17');

    if (state === 'on') {
      c.setFillColor(fillColor2);
      c.setFontColor(textColor[0]);
      c.roundrect(0, 0, w * 0.75, h, 10, 10);
    } else {
      c.setFontColor(textColor[1]);
      c.roundrect(w * 0.25, 0, w * 0.75, h, 10, 10);
    }

    c.fillAndStroke();
    c.setFontSize(textSize);
    c.setFontStyle(1);

    if (state === 'on') {
      c.text(w * 0.375, h * 0.5, 0, 0, mainText[0], 'center', 'middle', 0, null, 0, 0, 0);
    } else if (state === 'off') {
      c.text(w * 0.625, h * 0.5, 0, 0, mainText[1], 'center', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.rrect: 角の丸い四角 (rSize) (mxMockupButtons.js の mxShapeMockupRRect) */
class RRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.anchor: 繋ぐ点だけの形 (何も描かない) (mxMockupButtons.js の mxShapeMockupAnchor) */
class Anchor extends Mock {
  paintVertexShape(_c: Canvas, _x: any, _y: any, _w: any, _h: any) {}
}

/** mxgraph.mockup.topButton: 上の角だけ丸い四角 (rSize) (mxMockupButtons.js の mxShapeMockupTopButton) */
class TopButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.bottomButton: 下の角だけ丸い四角 (rSize) (mxMockupButtons.js の mxShapeMockupBottomButton) */
class BottomButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.rightButton: 右の角だけ丸い四角 (rSize) (mxMockupButtons.js の mxShapeMockupRightButton) */
class RightButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.leftButton: 左の角だけ丸い四角 (rSize) (mxMockupButtons.js の mxShapeMockupLeftButton) */
class LeftButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.close();
    c.fillAndStroke();
  }
}

// ───────────── 入れ物 (draw.io の shapes/mockup/mxMockupContainers.js) ─────────────

/** mxgraph.mockup.containers.videoPlayer: 動画の再生の画面 (下の棒の位置 barPos・高さ barHeight) (mxMockupContainers.js の mxShapeMockupVideoPlayer) */
class VideoPlayer extends Mock {
  barPos: any = 20;
  barHeight: any = 30;
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let buttonColor = this.sc('fillColor2', '#c4c4c4');
    let frameColor = this.sc('strokeColor', '#666666');
    let filledColor = this.sc('strokeColor2', '#008cff');
    let emptyColor = this.sc('strokeColor3', '#c4c4c4');
    let barHeight = this.sv('barHeight', '30');

    w = Math.max(w, 5 * barHeight);
    h = Math.max(h, barHeight + 10);

    c.translate(x, y);
    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.otherShapes(c, x, y, w, h, buttonColor, frameColor, filledColor, emptyColor, barHeight);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
  otherShapes(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, buttonColor?: any, frameColor?: any, filledColor?: any, emptyColor?: any, barHeight?: any) {
    let barPos = this.sv('barPos', '20');
    barPos = Math.max(0, barPos);
    barPos = Math.min(100, barPos);

    let strokeWidth = this.sv('strokeWidth', '1');
    let buttonR = 8;
    let barY = h - barHeight;

    let barMin = buttonR;
    let barMax = w - buttonR;
    let barRange = barMax - barMin;
    let realBarPos = (barRange * barPos) / 100;
    let barEnd = barMin + realBarPos;

    c.setStrokeColor(filledColor);
    c.begin();
    c.moveTo(0, barY);
    c.lineTo(barEnd, barY);
    c.stroke();
    c.setStrokeColor(emptyColor);
    c.begin();
    c.moveTo(barEnd, barY);
    c.lineTo(w, barY);
    c.stroke();

    c.setStrokeColor(frameColor);
    c.begin();
    c.ellipse(barEnd - buttonR, barY - buttonR, 2 * buttonR, 2 * buttonR);
    c.fillAndStroke();

    c.begin();
    c.setStrokeWidth(strokeWidth / 2);
    c.ellipse(barEnd - buttonR * 0.5, barY - buttonR * 0.5, buttonR, buttonR);
    c.fillAndStroke();
    c.setStrokeWidth(strokeWidth);

    let iconSize = barHeight * 0.3;
    let iconY = h - (barHeight + iconSize) * 0.5;
    let iconX = barHeight * 0.3;
    c.setFillColor(buttonColor);
    c.setStrokeColor(buttonColor);

    c.begin();
    c.moveTo(iconX, iconY);
    c.lineTo(iconX + iconSize, iconY + iconSize * 0.5);
    c.lineTo(iconX, iconY + iconSize);
    c.close();
    c.fillAndStroke();

    let speakerX = barHeight;
    let speakerY = h - barHeight;
    c.moveTo(speakerX + barHeight * 0.05, speakerY + barHeight * 0.4);
    c.lineTo(speakerX + barHeight * 0.15, speakerY + barHeight * 0.4);
    c.lineTo(speakerX + barHeight * 0.3, speakerY + barHeight * 0.25);
    c.lineTo(speakerX + barHeight * 0.3, speakerY + barHeight * 0.75);
    c.lineTo(speakerX + barHeight * 0.15, speakerY + barHeight * 0.6);
    c.lineTo(speakerX + barHeight * 0.05, speakerY + barHeight * 0.6);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(speakerX + barHeight * 0.4, speakerY + barHeight * 0.35);
    c.arcTo(barHeight * 0.2, barHeight * 0.3, 0, 0, 1, speakerX + barHeight * 0.4, speakerY + barHeight * 0.65);
    c.moveTo(speakerX + barHeight * 0.425, speakerY + barHeight * 0.25);
    c.arcTo(barHeight * 0.225, barHeight * 0.35, 0, 0, 1, speakerX + barHeight * 0.425, speakerY + barHeight * 0.75);
    c.stroke();

    let screenX = w - barHeight * 1.3;
    c.begin();
    c.moveTo(screenX + barHeight * 0.1, speakerY + barHeight * 0.4);
    c.lineTo(screenX + barHeight * 0.1, speakerY + barHeight * 0.3);
    c.lineTo(screenX + barHeight * 0.25, speakerY + barHeight * 0.3);

    c.moveTo(screenX + barHeight * 0.1, speakerY + barHeight * 0.6);
    c.lineTo(screenX + barHeight * 0.1, speakerY + barHeight * 0.7);
    c.lineTo(screenX + barHeight * 0.25, speakerY + barHeight * 0.7);

    c.moveTo(screenX + barHeight * 0.9, speakerY + barHeight * 0.4);
    c.lineTo(screenX + barHeight * 0.9, speakerY + barHeight * 0.3);
    c.lineTo(screenX + barHeight * 0.75, speakerY + barHeight * 0.3);

    c.moveTo(screenX + barHeight * 0.9, speakerY + barHeight * 0.6);
    c.lineTo(screenX + barHeight * 0.9, speakerY + barHeight * 0.7);
    c.lineTo(screenX + barHeight * 0.75, speakerY + barHeight * 0.7);
    c.stroke();

    let textColor = this.sc('textColor', '#666666');
    c.begin();
    c.setFontSize(barHeight * 0.5);
    c.setFontColor(textColor);
    c.text(barHeight * 1.9, h - barHeight * 0.45, 0, 0, '0:00/3:53', 'left', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.containers.accordion: 開け閉めする欄の並び (mainText を , で分ける。+ で始まる名前が開いた欄) (mxMockupContainers.js の mxShapeMockupAccordion) */
class Accordion extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, buttonText: any, currWidth: any, currHeight: any;
    let textStrings = this.sv('mainText', '+Group 1, Group 2, Group 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let selectedFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();
    let frameColor = this.sc('strokeColor', '#666666');
    let separatorColor = this.sc('strokeColor2', '#c4c4c4');
    let bgColor = this.sc('fillColor', '#ffffff');
    let selectedFillColor = this.sc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let maxButtonWidth = 0;
    let selectedButton = -1;
    let rSize = 10;
    let labelOffset = 5;

    for (i = 0; i < buttonNum; i++) {
      buttonText = textStrings[i];

      if (buttonText.charAt(0) === '+') {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      currWidth = sizeForString(buttonText, fontSize, 'Helvetica').width;

      if (currWidth > maxButtonWidth) {
        maxButtonWidth = currWidth;
      }
    }

    let minButtonHeight = fontSize * 1.5;
    let minH = buttonNum * minButtonHeight;
    let trueH = Math.max(h, minH);
    let minW = 2 * labelOffset + maxButtonWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);

    this.background(c, trueW, trueH, rSize, buttonNum, labelOffset, buttonNum * minButtonHeight, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton, minButtonHeight);
    c.setShadow(false);

    currWidth = 0;

    for (i = 0; i < buttonNum; i++) {
      if (i === selectedButton) {
        c.setFontColor(selectedFontColor);
      } else {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      currHeight = 0;

      if (selectedButton === -1 || i <= selectedButton) {
        currHeight = i * minButtonHeight + minButtonHeight * 0.5;
      } else {
        currHeight = trueH - (buttonNum - i - 0.5) * minButtonHeight;
      }

      this.buttonText(c, trueW, currHeight, textStrings[i], fontSize);
    }
  }
  background(
    c: Canvas,
    w?: any,
    h?: any,
    _rSize?: any,
    buttonNum?: any,
    _labelOffset?: any,
    _minH?: any,
    frameColor?: any,
    separatorColor?: any,
    bgColor?: any,
    selectedFillColor?: any,
    selectedButton?: any,
    minButtonHeight?: any,
  ) {
    let i: any, currHeight: any, buttonTop: any, buttonBottom: any;
    c.begin();

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor(separatorColor);
    c.begin();

    for (i = 1; i < buttonNum; i++) {
      if (i !== selectedButton) {
        if (selectedButton === -1 || i < selectedButton) {
          currHeight = i * minButtonHeight;
          c.moveTo(0, currHeight);
          c.lineTo(w, currHeight);
        } else {
          currHeight = h - (buttonNum - i) * minButtonHeight;
          c.moveTo(0, currHeight);
          c.lineTo(w, currHeight);
        }
      }
    }

    c.stroke();

    c.setStrokeColor('none');
    c.setFillColor(selectedFillColor);

    if (selectedButton !== -1) {
      c.begin();
      buttonTop = minButtonHeight * selectedButton;
      buttonBottom = minButtonHeight * (selectedButton + 1);
      c.moveTo(0, buttonTop);
      c.lineTo(w, buttonTop);
      c.lineTo(w, buttonBottom);
      c.lineTo(0, buttonBottom);
      c.close();
      c.fill();
    }

    c.begin();
    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.stroke();
  }
  buttonText(c: Canvas, w?: any, h?: any, textString?: any, fontSize?: any) {
    if (textString.charAt(0) === '+') {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text(w * 0.5, h, 0, 0, textString, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.containers.browserWindow: ブラウザーの窓 (mainText は アドレス,タブの名前) (mxMockupContainers.js の mxShapeMockupBrowserWindow) */
class BrowserWindow extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let closeColor = this.sc('strokeColor2', '#008cff');
    let insideColor = this.sc('strokeColor3', '#c4c4c4');
    w = Math.max(w, 260);
    h = Math.max(h, 110);
    c.translate(x, y);
    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.otherShapes(c, x, y, w, h, frameColor, insideColor, closeColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
  otherShapes(c: Canvas, _x?: any, _y?: any, w?: any, _h?: any, frameColor?: any, insideColor?: any, closeColor?: any) {
    let strokeWidth = this.sv('strokeWidth', '1');
    let mainText = this.sv('mainText', 'http://www.draw.io,Page 1').toString().split(',');

    c.setStrokeColor(frameColor);
    c.ellipse(w - 75, 5, 20, 20);
    c.stroke();

    c.ellipse(w - 50, 5, 20, 20);
    c.stroke();

    c.setStrokeColor(closeColor);
    c.ellipse(w - 25, 5, 20, 20);
    c.stroke();

    c.setStrokeColor(insideColor);

    c.begin();
    c.moveTo(0, 40);
    c.lineTo(30, 40);
    c.lineTo(30, 15);
    c.arcTo(5, 5, 0, 0, 1, 35, 10);
    c.lineTo(170, 10);
    c.arcTo(5, 5, 0, 0, 1, 175, 15);
    c.lineTo(175, 40);
    c.lineTo(w, 40);
    c.stroke();

    c.begin();
    c.moveTo(0, 110);
    c.lineTo(w, 110);
    c.stroke();

    c.begin();
    c.moveTo(100, 60);
    c.arcTo(5, 5, 0, 0, 1, 105, 55);
    c.lineTo(w - 15, 55);
    c.arcTo(5, 5, 0, 0, 1, w - 10, 60);
    c.lineTo(w - 10, 85);
    c.arcTo(5, 5, 0, 0, 1, w - 15, 90);
    c.lineTo(105, 90);
    c.arcTo(5, 5, 0, 0, 1, 100, 85);
    c.close();
    c.stroke();

    let textColor = this.noKey('#666666');
    c.setFontColor(textColor);
    c.setFontSize(17);
    c.text(65, 25, 0, 0, mainText[1], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(130, 73, 0, 0, mainText[0], 'left', 'middle', 0, null, 0, 0, 0);
    c.stroke();

    c.translate(37, 17);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(11, 0);
    c.lineTo(15, 4);
    c.lineTo(15, 18);
    c.lineTo(0, 18);
    c.close();
    c.stroke();

    c.setStrokeWidth(strokeWidth * 0.5);
    c.begin();
    c.moveTo(11, 0);
    c.lineTo(11, 4);
    c.lineTo(15, 5);
    c.stroke();

    c.setStrokeWidth(strokeWidth * 2);
    c.translate(70, 47);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(11, 0);
    c.lineTo(15, 4);
    c.lineTo(15, 18);
    c.lineTo(0, 18);
    c.close();
    c.stroke();

    c.setStrokeWidth(strokeWidth * 0.5);
    c.begin();
    c.moveTo(11, 0);
    c.lineTo(11, 4);
    c.lineTo(15, 5);
    c.stroke();

    let iSi = 20;
    c.setFillColor(insideColor);
    c.begin();
    c.setStrokeWidth(strokeWidth * 2);
    c.translate(-95, 0);
    c.moveTo(0, iSi * 0.5);
    c.lineTo(iSi * 0.5, 0);
    c.lineTo(iSi * 0.5, iSi * 0.3);
    c.lineTo(iSi, iSi * 0.3);
    c.lineTo(iSi, iSi * 0.7);
    c.lineTo(iSi * 0.5, iSi * 0.7);
    c.lineTo(iSi * 0.5, iSi);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.translate(30, 0);
    c.moveTo(iSi, iSi * 0.5);
    c.lineTo(iSi * 0.5, 0);
    c.lineTo(iSi * 0.5, iSi * 0.3);
    c.lineTo(0, iSi * 0.3);
    c.lineTo(0, iSi * 0.7);
    c.lineTo(iSi * 0.5, iSi * 0.7);
    c.lineTo(iSi * 0.5, iSi);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.translate(30, 0);
    c.moveTo(iSi * 0.78, iSi * 0.665);
    c.arcTo(iSi * 0.3, iSi * 0.3, 0, 1, 1, iSi * 0.675, iSi * 0.252);
    c.lineTo(iSi * 0.595, iSi * 0.325);
    c.lineTo(iSi * 0.99, iSi * 0.415);
    c.lineTo(iSi * 0.9, iSi * 0.04);
    c.lineTo(iSi * 0.815, iSi * 0.12);
    c.arcTo(iSi * 0.49, iSi * 0.49, 0, 1, 0, iSi * 0.92, iSi * 0.8);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.containers.userMale: 男の人の顔の線画の枠 (mxMockupContainers.js の mxShapeMockupUserMale) */
class UserMale extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let insideColor = this.sc('strokeColor2', '#008cff');
    c.translate(x, y);
    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.otherShapes(c, x, y, w, h, insideColor, frameColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
  otherShapes(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, insideColor?: any, frameColor?: any) {
    c.setStrokeColor(insideColor);
    c.setLineCap('round');
    c.setLineJoin('round');
    c.begin();
    c.moveTo(w * 0.5, h * 0.6721);
    c.curveTo(w * 0.3891, h * 0.6721, w * 0.31, h * 0.5648, w * 0.31, h * 0.3962);
    c.curveTo(w * 0.31, h * 0.3656, w * 0.3012, h * 0.3473, w * 0.3051, h * 0.3227);
    c.curveTo(w * 0.3126, h * 0.2762, w * 0.3124, h * 0.2212, w * 0.332, h * 0.1939);
    c.curveTo(w * 0.354, h * 0.1633, w * 0.4382, h * 0.12, w * 0.5, h * 0.12);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3046, h * 0.3716);
    c.curveTo(w * 0.3046, h * 0.3716, w * 0.3046, h * 0.341, w * 0.2826, h * 0.3594);
    c.curveTo(w * 0.2606, h * 0.3778, w * 0.2661, h * 0.4452, w * 0.266, h * 0.4452);
    c.quadTo(w * 0.2715, h * 0.4942, w * 0.277, h * 0.5065);
    c.curveTo(w * 0.2825, h * 0.5187, w * 0.277, h * 0.5187, w * 0.2935, h * 0.5371);
    c.curveTo(w * 0.31, h * 0.5554, w * 0.3375, h * 0.5615, w * 0.3375, h * 0.5616);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3829, h * 0.6213);
    c.curveTo(w * 0.3829, h * 0.6213, w * 0.405, h * 0.7704, w * 0.2921, h * 0.7888);
    c.curveTo(w * 0.2536, h * 0.795, w * 0.1328, h * 0.85, w * 0.1052, h * 0.8745);
    c.curveTo(w * 0.0776, h * 0.899, w * 0.0641, h * 0.9316, w * 0.0571, h * 0.9622);
    c.quadTo(w * 0.05, h, w * 0.05, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3427, h * 0.4185);
    c.curveTo(w * 0.3427, h * 0.4185, w * 0.3427, h * 0.3839, w * 0.3427, h * 0.3593);
    c.curveTo(w * 0.3427, h * 0.3348, w * 0.3663, h * 0.3103, w * 0.3718, h * 0.3041);
    c.curveTo(w * 0.3773, h * 0.298, w * 0.3822, h * 0.2673, w * 0.3877, h * 0.2551);
    c.curveTo(w * 0.3932, h * 0.2429, w * 0.4095, h * 0.2429, w * 0.4259, h * 0.2367);
    c.curveTo(w * 0.4424, h * 0.2306, w * 0.4984, h * 0.2357, w * 0.4984, h * 0.2357);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.365, h * 0.7427);
    c.curveTo(w * 0.365, h * 0.7427, w * 0.3772, h * 0.8076, w * 0.4286, h * 0.8224);
    c.curveTo(w * 0.4816, h * 0.8377, w * 0.5028, h * 0.8347, w * 0.5028, h * 0.8347);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3322, h * 0.7764);
    c.curveTo(w * 0.3322, h * 0.7764, w * 0.3556, h * 0.8386, w * 0.4038, h * 0.8684);
    c.curveTo(w * 0.4533, h * 0.8991, w * 0.5029, h * 0.8929, w * 0.5029, h * 0.8929);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.2717, h * 0.9);
    c.lineTo(w * 0.2717, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.1671, h * 0.8991);
    c.curveTo(w * 0.1671, h * 0.8991, w * 0.1726, h * 0.9114, w * 0.1836, h * 0.9481);
    c.curveTo(w * 0.1946, h * 0.9849, w * 0.2, h, w * 0.2, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.5, h * 0.6721);
    c.curveTo(w * 0.6109, h * 0.6721, w * 0.69, h * 0.5648, w * 0.69, h * 0.3962);
    c.curveTo(w * 0.69, h * 0.3656, w * 0.6988, h * 0.3473, w * 0.6949, h * 0.3227);
    c.curveTo(w * 0.6847, h * 0.2762, w * 0.6876, h * 0.2212, w * 0.668, h * 0.1939);
    c.curveTo(w * 0.646, h * 0.1633, w * 0.5618, h * 0.12, w * 0.5, h * 0.12);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6954, h * 0.3716);
    c.curveTo(w * 0.6954, h * 0.3716, w * 0.6954, h * 0.341, w * 0.7174, h * 0.3594);
    c.curveTo(w * 0.7394, h * 0.3778, w * 0.7339, h * 0.4452, w * 0.734, h * 0.4452);
    c.quadTo(w * 0.7285, h * 0.4942, w * 0.723, h * 0.5065);
    c.curveTo(w * 0.7175, h * 0.5187, w * 0.723, h * 0.5187, w * 0.7065, h * 0.5371);
    c.curveTo(w * 0.69, h * 0.5554, w * 0.6625, h * 0.5615, w * 0.6625, h * 0.5616);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6171, h * 0.6213);
    c.curveTo(w * 0.6171, h * 0.6213, w * 0.595, h * 0.7704, w * 0.7079, h * 0.7888);
    c.curveTo(w * 0.7464, h * 0.795, w * 0.8672, h * 0.85, w * 0.8948, h * 0.8745);
    c.curveTo(w * 0.9224, h * 0.899, w * 0.9359, h * 0.9316, w * 0.9429, h * 0.9622);
    c.quadTo(w * 0.95, h, w * 0.95, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6573, h * 0.4185);
    c.curveTo(w * 0.6573, h * 0.4185, w * 0.6573, h * 0.3839, w * 0.6573, h * 0.3593);
    c.curveTo(w * 0.6573, h * 0.3348, w * 0.6337, h * 0.3103, w * 0.6282, h * 0.3041);
    c.curveTo(w * 0.6227, h * 0.298, w * 0.6178, h * 0.2673, w * 0.6123, h * 0.2551);
    c.curveTo(w * 0.6068, h * 0.2429, w * 0.5905, h * 0.2429, w * 0.5741, h * 0.2367);
    c.curveTo(w * 0.5576, h * 0.2306, w * 0.5016, h * 0.2357, w * 0.5016, h * 0.2357);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.635, h * 0.7427);
    c.curveTo(w * 0.635, h * 0.7427, w * 0.6228, h * 0.8076, w * 0.5714, h * 0.8224);
    c.curveTo(w * 0.5184, h * 0.8377, w * 0.4972, h * 0.8347, w * 0.4972, h * 0.8347);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6678, h * 0.7764);
    c.curveTo(w * 0.6678, h * 0.7764, w * 0.6444, h * 0.8386, w * 0.5962, h * 0.8684);
    c.curveTo(w * 0.5467, h * 0.8991, w * 0.4971, h * 0.8929, w * 0.4971, h * 0.8929);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.7283, h * 0.9);
    c.lineTo(w * 0.7283, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.8329, h * 0.8991);
    c.curveTo(w * 0.8329, h * 0.8991, w * 0.8274, h * 0.9114, w * 0.8164, h * 0.9481);
    c.curveTo(w * 0.8054, h * 0.9849, w * 0.8, h, w * 0.8, h);
    c.stroke();

    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.stroke();
  }
}

/** mxgraph.mockup.containers.userFemale: 女の人の顔の線画の枠 (mxMockupContainers.js の mxShapeMockupUserFemale) */
class UserFemale extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let insideColor = this.sc('strokeColor2', '#008cff');
    c.translate(x, y);
    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.otherShapes(c, x, y, w, h, insideColor, frameColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
  otherShapes(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, insideColor?: any, frameColor?: any) {
    c.setStrokeColor(insideColor);
    c.setLineCap('round');
    c.setLineJoin('round');
    c.begin();
    c.moveTo(w * 0.3148, h * 0.468);
    c.curveTo(w * 0.3045, h * 0.3195, w * 0.3176, h * 0.2383, w * 0.3302, h * 0.2069);
    c.curveTo(w * 0.3508, h * 0.1557, w * 0.44, h * 0.1156, w * 0.5026, h * 0.1156);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.5029, h * 0.6728);
    c.curveTo(w * 0.4616, h * 0.6728, w * 0.4018, h * 0.6177, w * 0.3663, h * 0.5653);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3108, h * 0.4021);
    c.curveTo(w * 0.3108, h * 0.4021, w * 0.3091, h * 0.3765, w * 0.2891, h * 0.3933);
    c.curveTo(w * 0.2691, h * 0.4101, w * 0.2782, h * 0.4661, w * 0.2782, h * 0.4661);
    c.quadTo(w * 0.2862, h * 0.5067, w * 0.2922, h * 0.5166);
    c.curveTo(w * 0.2982, h * 0.5265, w * 0.2929, h * 0.5268, w * 0.3097, h * 0.5412);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.4038, h * 0.6176);
    c.curveTo(w * 0.4038, h * 0.6176, w * 0.4324, h * 0.7778, w * 0.3375, h * 0.7963);
    c.curveTo(w * 0.3054, h * 0.8026, w * 0.1753, h * 0.8578, w * 0.15, h * 0.8826);
    c.curveTo(w * 0.1247, h * 0.9074, w * 0.1126, h * 0.9412, w * 0.1063, h * 0.9722);
    c.curveTo(w * 0.1, h * 1.0032, w * 0.1, h, w * 0.1, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6377, h * 0.3365);
    c.curveTo(w * 0.5927, h * 0.2634, w * 0.5206, h * 0.2634, w * 0.5206, h * 0.2634);
    c.quadTo(w * 0.3769, h * 0.2591, w * 0.3713, h * 0.2659);
    c.curveTo(w * 0.3657, h * 0.2727, w * 0.3405, h * 0.3674, w * 0.3405, h * 0.3946);
    c.curveTo(w * 0.3405, h * 0.4218, w * 0.3405, h * 0.4602, w * 0.3405, h * 0.4602);
    c.quadTo(w * 0.3546, h * 0.6401, w * 0.3546, h * 0.6626);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.2931, h * 0.818);
    c.curveTo(w * 0.2931, h * 0.818, w * 0.3224, h * 0.9159, w * 0.3826, h * 0.9677);
    c.curveTo(w * 0.4446, h * 1.01, w * 0.5065, h, w * 0.5065, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.2995, h * 0.9106);
    c.lineTo(w * 0.2995, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.2081, h * 0.907);
    c.curveTo(w * 0.2081, h * 0.907, w * 0.2131, h * 0.9194, w * 0.2232, h * 0.9565);
    c.curveTo(w * 0.2333, h * 0.9936, w * 0.24, h, w * 0.24, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6951, h * 0.4988);
    c.curveTo(w * 0.6951, h * 0.4662, w * 0.7042, h * 0.3453, w * 0.7, h * 0.32);
    c.curveTo(w * 0.6923, h * 0.273, w * 0.6926, h * 0.2175, w * 0.6727, h * 0.19);
    c.curveTo(w * 0.6504, h * 0.159, w * 0.5651, h * 0.1157, w * 0.5025, h * 0.1157);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.5029, h * 0.6728);
    c.curveTo(w * 0.5546, h * 0.6728, w * 0.6107, h * 0.6316, w * 0.6461, h * 0.5602);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.696, h * 0.4022);
    c.curveTo(w * 0.696, h * 0.4022, w * 0.6983, h * 0.3766, w * 0.7179, h * 0.4106);
    c.curveTo(w * 0.7375, h * 0.4278, w * 0.7273, h * 0.4836, w * 0.7273, h * 0.4836);
    c.quadTo(w * 0.7184, h * 0.5241, w * 0.7123, h * 0.5338);
    c.curveTo(w * 0.7062, h * 0.5436, w * 0.7114, h * 0.544, w * 0.6943, h * 0.558);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.5995, h * 0.6278);
    c.curveTo(w * 0.5995, h * 0.6278, w * 0.5724, h * 0.7777, w * 0.6663, h * 0.7963);
    c.curveTo(w * 0.6984, h * 0.8026, w * 0.8386, h * 0.8578, w * 0.8638, h * 0.8826);
    c.curveTo(w * 0.8891, h * 0.9074, w * 0.9016, h * 0.9412, w * 0.9079, h * 0.9722);
    c.curveTo(w * 0.9142, h * 1.0032, w * 0.91, h, w * 0.91, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6545, h * 0.6802);
    c.lineTo(w * 0.6545, h * 0.3986);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.7132, h * 0.8078);
    c.curveTo(w * 0.7132, h * 0.8078, w * 0.6839, h * 0.916, w * 0.6237, h * 0.9678);
    c.curveTo(w * 0.5617, h * 1.01, w * 0.4998, h, w * 0.4998, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.7111, h * 0.9106);
    c.lineTo(w * 0.7111, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.8075, h * 0.907);
    c.curveTo(w * 0.8075, h * 0.907, w * 0.8025, h * 0.9194, w * 0.7924, h * 0.9565);
    c.curveTo(w * 0.7823, h * 0.9936, w * 0.775, h, w * 0.775, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.3148, h * 0.5448);
    c.curveTo(w * 0.3148, h * 0.5448, w * 0.32, h * 0.6216, w * 0.3148, h * 0.6677);
    c.quadTo(w * 0.2891, h * 0.7343, w * 0.2891, h * 0.7343);
    c.lineTo(w * 0.3303, h * 0.7625);
    c.lineTo(w * 0.39, h * 0.7625);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.6852, h * 0.5448);
    c.curveTo(w * 0.6852, h * 0.5448, w * 0.68, h * 0.6216, w * 0.6852, h * 0.6677);
    c.quadTo(w * 0.7109, h * 0.7343, w * 0.7109, h * 0.7343);
    c.lineTo(w * 0.6697, h * 0.7625);
    c.lineTo(w * 0.62, h * 0.7625);
    c.stroke();

    c.setStrokeColor(frameColor);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.stroke();
  }
}

/** mxgraph.mockup.containers.group: 見出しの付いたまとまりの枠 (mxMockupContainers.js の mxShapeMockupGroup) */
class Group extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let groupString = this.sv('mainText', 'Group').toString();
    let fontSize = this.sv('textSize', '17');

    let textWidth = sizeForString(groupString, fontSize, 'Helvetica').width;

    if (textWidth === 0) {
      textWidth = Math.max(80, textWidth);
    }

    c.translate(x, y);

    w = Math.max(w, textWidth + 15);
    h = Math.max(h, fontSize + 10);

    this.background(c, w, h, textWidth, fontSize);
    c.setShadow(false);
    this.foreground(c, w, h, textWidth, fontSize);
    this.buttonText(c, w, h, groupString, fontSize);
  }
  background(c: Canvas, w?: any, h?: any, _textWidth?: any, fontSize?: any) {
    c.roundrect(0, fontSize * 0.5, w, h - fontSize * 0.5, 5, 5);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, _h?: any, textWidth?: any, fontSize?: any) {
    let fillColor = this.sc('fillColor2', '#000000');
    c.setFillColor(fillColor);
    c.roundrect(3, 0, textWidth + 6, fontSize * 1.5, fontSize * 0.25, fontSize * 0.25);
    c.fill();
  }
  buttonText(c: Canvas, _w?: any, _h?: any, textString?: any, fontSize?: any) {
    let fontColor = this.sc('textColor', '#ffffff');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);
    c.text(6, 0, 0, 0, textString, 'left', 'top', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.containers.window: 見出しの棒と閉じる印の付いた窓 (mxMockupContainers.js の mxShapeMockupWindow) */
class Window extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let closeColor = this.sc('strokeColor2', '#008cff');
    let insideColor = this.sc('strokeColor3', '#c4c4c4');
    c.translate(x, y);

    h = Math.max(h, 30);
    w = Math.max(w, 90);

    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.otherShapes(c, x, y, w, h, frameColor, insideColor, closeColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  otherShapes(c: Canvas, _x?: any, _y?: any, w?: any, _h?: any, frameColor?: any, insideColor?: any, closeColor?: any) {
    c.setStrokeColor(frameColor);
    c.ellipse(w - 75, 5, 20, 20);
    c.stroke();

    c.ellipse(w - 50, 5, 20, 20);
    c.stroke();

    c.setStrokeColor(closeColor);
    c.ellipse(w - 25, 5, 20, 20);
    c.stroke();

    c.setStrokeColor(insideColor);

    c.begin();
    c.moveTo(0, 30);
    c.lineTo(w, 30);
    c.stroke();

    let windowTitle = this.sv('mainText', 'Window Title');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17').toString();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);
    c.text(10, 15, 0, 0, windowTitle, 'left', 'middle', 0, null, 0, 0, 0);
    c.stroke();
  }
}

/** mxgraph.mockup.containers.horTabBar: 横のタブの並び (mainText を , で分ける。+ で始まる名前が選んだタブ) (mxMockupContainers.js の mxShapeMockupHorTabBar) */
class HorTabBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, currLabel: any, currW: any;
    let fontSize = this.sv('textSize', '17').toString();
    let tabNames = this.sv('tabs', 'Tab 1,+Tab 2,Tab 3').toString().split(',');

    let tabH = fontSize * 1.5;
    let startOffset = 10;
    let tabOffset = 5;
    let labelOffset = 10;
    let tabCount = tabNames.length;
    let minW = 2 * startOffset + (tabCount - 1) * tabOffset + tabCount * 2 * labelOffset;
    let rSize = 5;
    let labelWidths = new Array();
    let selectedTab = -1;

    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
        selectedTab = i;
      }

      currW = sizeForString(currLabel, fontSize, 'Helvetica').width;

      if (currW === 0) {
        labelWidths[i] = 40;
      } else {
        labelWidths[i] = currW;
      }

      minW = minW + labelWidths[i];
    }

    w = Math.max(w, minW);
    h = Math.max(h, tabH + rSize);

    c.translate(x, y);

    this.background(c, w, h, rSize, tabH);
    c.setShadow(false);
    this.backTabs(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.focusTab(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.tabText(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab, tabNames);
  }
  background(c: Canvas, w?: any, h?: any, rSize?: any, tabH?: any) {
    c.begin();
    c.moveTo(0, tabH + rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, tabH);
    c.lineTo(w - rSize, tabH);
    c.arcTo(rSize, rSize, 0, 0, 1, w, tabH + rSize);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
  backTabs(c: Canvas, _w?: any, _h?: any, rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, tabCount?: any, labelWidths?: any, selectedTab?: any) {
    let i: any, tabW: any;
    let tabStyle = this.sv('tabStyle', 'block');

    let currW = startOffset;
    for (i = 0; i < tabCount; i++) {
      tabW = labelWidths[i] + 2 * labelOffset;

      if (selectedTab !== i) {
        if (tabStyle === 'block') {
          c.rect(currW, 0, tabW, tabH);
        } else if (tabStyle === 'cone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW - labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'halfCone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'round') {
          c.begin();
          c.moveTo(currW - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 0, currW, tabH - rSize);
          c.lineTo(currW, rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + rSize, 0);
          c.lineTo(currW + tabW - rSize, 0);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + tabW, rSize);
          c.lineTo(currW + tabW, tabH - rSize);
          c.arcTo(rSize, rSize, 0, 0, 0, currW + tabW + rSize, tabH);
        }

        c.fillAndStroke();
      }

      currW = currW + tabW + tabOffset;
    }
  }
  focusTab(c: Canvas, w?: any, _h?: any, rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, _tabCount?: any, labelWidths?: any, selectedTab?: any) {
    let i: any, tabW: any;
    let tabStyle = this.sv('tabStyle', 'block');
    let selectedFill = this.sc('fillColor2', '#008cff');

    let currW = startOffset;
    c.setStrokeColor(selectedFill);
    c.setFillColor(selectedFill);

    for (i = 0; i <= selectedTab; i++) {
      tabW = labelWidths[i] + 2 * labelOffset;

      if (selectedTab === i) {
        if (tabStyle === 'block') {
          c.begin();
          c.moveTo(0, tabH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, rSize, tabH);
          c.lineTo(currW, tabH);
          c.lineTo(currW, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
          c.lineTo(w - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 1, w, tabH + rSize);
          c.close();
        } else if (tabStyle === 'cone') {
          c.begin();
          c.moveTo(0, tabH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, rSize, tabH);
          c.lineTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW - labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, tabH);
          c.lineTo(w - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 1, w, tabH + rSize);
          c.close();
        } else if (tabStyle === 'halfCone') {
          c.begin();
          c.moveTo(0, tabH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, rSize, tabH);
          c.lineTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
          c.lineTo(w - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 1, w, tabH + rSize);
          c.close();
        } else if (tabStyle === 'round') {
          c.begin();
          c.moveTo(0, tabH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, rSize, tabH);
          c.lineTo(currW - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 0, currW, tabH - rSize);
          c.lineTo(currW, rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + rSize, 0);
          c.lineTo(currW + tabW - rSize, 0);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + tabW, rSize);
          c.lineTo(currW + tabW, tabH - rSize);
          c.arcTo(rSize, rSize, 0, 0, 0, currW + tabW + rSize, tabH);
          c.lineTo(w - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 1, w, tabH + rSize);
          c.close();
        }

        c.fillAndStroke();
      }

      currW = currW + tabW + tabOffset;
    }
  }
  tabText(c: Canvas, _w?: any, _h?: any, _rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, tabCount?: any, labelWidths?: any, selectedTab?: any, tabNames?: any) {
    let i: any, currLabel: any, tabW: any;
    let fontColor = this.sc('textColor', '#666666');
    let selFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    let currW = startOffset;

    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (i === selectedTab) {
        c.setFontColor(selFontColor);
      }

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
      }

      tabW = labelWidths[i] + 2 * labelOffset;

      c.text(currW + labelOffset, tabH * 0.5, 0, 0, currLabel, 'left', 'middle', 0, null, 0, 0, 0);

      currW = currW + tabW + tabOffset;

      if (i === selectedTab) {
        c.setFontColor(fontColor);
      }
    }
  }
}

/** mxgraph.mockup.containers.verTabBar: 縦のタブの並び (mainText を , で分ける。+ で始まる名前が選んだタブ) (mxMockupContainers.js の mxShapeMockupVerTabBar) */
class VerTabBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, currLabel: any, currW: any;
    let fontSize = this.sv('textSize', '17').toString();
    let tabNames = this.sv('tabs', 'Tab 1,+Tab 2,Tab 3').toString().split(',');

    let tabH = fontSize * 1.5;
    let startOffset = 10;
    let tabOffset = 5;
    let labelOffset = 10;
    let tabCount = tabNames.length;
    let rSize = 5;
    let labelWidths = new Array();
    let selectedTab = -1;
    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
        selectedTab = i;
      }

      currW = sizeForString(currLabel, fontSize, 'Helvetica').width;

      if (currW === 0) {
        labelWidths[i] = 42;
      } else {
        labelWidths[i] = currW;
      }
    }

    let tabW = 2 * labelOffset + Math.max.apply(Math, labelWidths);
    let minW = tabW + rSize;
    w = Math.max(w, minW);
    h = Math.max(h, 2 * startOffset + tabCount * tabH + (tabCount - 1) * tabOffset);

    c.translate(x, y);

    this.background(c, w, h, rSize, tabW);
    c.setShadow(false);
    this.backTabs(c, w, h, rSize, tabH, tabW, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.focusTab(c, w, h, rSize, tabH, tabW, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.tabText(c, w, h, rSize, tabH, tabW, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab, tabNames);
  }
  background(c: Canvas, w?: any, h?: any, rSize?: any, tabW?: any) {
    c.begin();
    c.moveTo(tabW + rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, tabW, h - rSize);
    c.lineTo(tabW, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, tabW + rSize, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.close();
    c.fillAndStroke();
  }
  backTabs(c: Canvas, _w?: any, _h?: any, rSize?: any, tabH?: any, tabW?: any, startOffset?: any, tabOffset?: any, _labelOffset?: any, tabCount?: any, _labelWidths?: any, selectedTab?: any) {
    let i: any;
    let tabStyle = this.sv('tabStyle', 'block');

    let currH = startOffset;

    for (i = 0; i < tabCount; i++) {
      if (selectedTab !== i) {
        if (tabStyle === 'block') {
          c.rect(0, currH, tabW, tabH);
        } else if (tabStyle === 'round') {
          c.begin();
          c.moveTo(tabW, currH + tabH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 0, tabW - rSize, currH + tabH);
          c.lineTo(rSize, currH + tabH);
          c.arcTo(rSize, rSize, 0, 0, 1, 0, currH + tabH - rSize);
          c.lineTo(0, currH + rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, rSize, currH);
          c.lineTo(tabW - rSize, currH);
          c.arcTo(rSize, rSize, 0, 0, 0, tabW, currH - rSize);
        }

        c.fillAndStroke();
      }

      currH = currH + tabH + tabOffset;
    }
  }
  focusTab(c: Canvas, _w?: any, h?: any, rSize?: any, tabH?: any, tabW?: any, startOffset?: any, tabOffset?: any, _labelOffset?: any, _tabCount?: any, _labelWidths?: any, selectedTab?: any) {
    let currH: any;
    let tabStyle = this.sv('tabStyle', 'block');
    let selectedFill = this.sc('fillColor2', '#008cff');

    if (selectedTab !== -1) {
      currH = startOffset + (tabH + tabOffset) * selectedTab;
      c.setStrokeColor(selectedFill);
      c.setFillColor(selectedFill);

      if (tabStyle === 'block') {
        c.begin();
        c.moveTo(tabW + rSize, h);
        c.arcTo(rSize, rSize, 0, 0, 1, tabW, h - rSize);
        c.lineTo(tabW, currH + tabH);
        c.lineTo(0, currH + tabH);
        c.lineTo(0, currH);
        c.lineTo(tabW, currH);
        c.lineTo(tabW, rSize);
        c.arcTo(rSize, rSize, 0, 0, 1, tabW + rSize, 0);
        c.close();
      } else if (tabStyle === 'round') {
        c.begin();
        c.moveTo(tabW + rSize, h);
        c.arcTo(rSize, rSize, 0, 0, 1, tabW, h - rSize);
        c.lineTo(tabW, currH + tabH + rSize);
        c.arcTo(rSize, rSize, 0, 0, 0, tabW - rSize, currH + tabH);
        c.lineTo(rSize, currH + tabH);
        c.arcTo(rSize, rSize, 0, 0, 1, 0, currH + tabH - rSize);
        c.lineTo(0, currH + rSize);
        c.arcTo(rSize, rSize, 0, 0, 1, rSize, currH);
        c.lineTo(tabW - rSize, currH);
        c.arcTo(rSize, rSize, 0, 0, 0, tabW, currH - rSize);
        c.lineTo(tabW, rSize);
        c.arcTo(rSize, rSize, 0, 0, 1, tabW + rSize, 0);
        c.close();
      }

      c.fillAndStroke();
    }
  }
  tabText(
    c: Canvas,
    _w?: any,
    _h?: any,
    _rSize?: any,
    tabH?: any,
    tabW?: any,
    startOffset?: any,
    tabOffset?: any,
    _labelOffset?: any,
    tabCount?: any,
    _labelWidths?: any,
    selectedTab?: any,
    tabNames?: any,
  ) {
    let i: any, currLabel: any;
    let fontColor = this.sc('textColor', '#666666');
    let selFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    let currH = startOffset;

    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (i === selectedTab) {
        c.setFontColor(selFontColor);
      }

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
      }

      c.text(tabW * 0.5, currH + tabH * 0.5, 0, 0, currLabel, 'center', 'middle', 0, null, 0, 0, 0);

      currH = currH + tabH + tabOffset;

      if (i === selectedTab) {
        c.setFontColor(fontColor);
      }
    }
  }
}

/** mxgraph.mockup.containers.alertBox: 知らせの箱 (見出しの棒と閉じる印) (mxMockupContainers.js の mxShapeMockupAlertBox) */
class AlertBox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let closeColor = this.sc('strokeColor2', '#008cff');
    let insideColor = this.sc('strokeColor3', '#c4c4c4');
    c.translate(x, y);

    h = Math.max(h, 75);
    w = Math.max(w, 90);

    this.background(c, x, y, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, frameColor, insideColor, closeColor);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _frameColor?: any, insideColor?: any, closeColor?: any) {
    let i: any;
    c.setStrokeColor(closeColor);
    c.ellipse(w - 25, 5, 20, 20);
    c.stroke();

    c.setStrokeColor(insideColor);
    c.begin();
    c.moveTo(0, 30);
    c.lineTo(w, 30);
    c.stroke();

    let windowTitle = this.sv('mainText', 'Window Title').toString();
    let subText = this.sv('subText', 'Sub Text').toString().split(',');
    let buttonText = this.sv('buttonText', 'OK,Cancel').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17').toString();

    let buttonCount = buttonText.length;
    let buttonOffset = 10;
    let buttonW = (w - buttonOffset * (buttonCount + 1)) / buttonCount;

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);
    c.text(10, 15, 0, 0, windowTitle, 'left', 'middle', 0, null, 0, 0, 0);

    let currW = buttonOffset;

    for (i = 0; i < buttonText.length; i++) {
      if (buttonText[i] !== '') {
        c.rect(currW, h - 10 - fontSize * 1.5, buttonW, fontSize * 1.5);
        c.stroke();
        c.text(currW + buttonW * 0.5, h - 10 - fontSize * 0.75, 0, 0, buttonText[i], 'center', 'middle', 0, null, 0, 0, 0);
      }

      currW = currW + buttonW + buttonOffset;
    }

    for (i = 0; i < subText.length; i++) {
      c.text(w * 0.5, 30 + fontSize * (i * 1.5 + 0.75), 0, 0, subText[i], 'center', 'middle', 0, null, 0, 0, 0);
    }

    c.stroke();
  }
}

/** mxgraph.mockup.containers.rrect: 角の丸い四角 (rSize) (mxMockupContainers.js の mxShapeMockupContainersRRect) */
class ContainersRRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.containers.anchor: 繋ぐ点だけの形 (何も描かない) (mxMockupContainers.js の mxShapeMockupContainersAnchor) */
class ContainersAnchor extends Mock {
  paintVertexShape(_c: Canvas, _x: any, _y: any, _w: any, _h: any) {}
}

/** mxgraph.mockup.containers.topButton: 上の角だけ丸い四角 (rSize。名前の綴りは draw.io のまま) (mxMockupContainers.js の mxShapeMockupContrainersTopButton) */
class ContrainersTopButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.containers.leftButton: 左の角だけ丸い四角 (rSize) (mxMockupContainers.js の mxShapeMockupContainersLeftButton) */
class ContainersLeftButton extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));

    c.begin();
    c.moveTo(w, 0);
    c.lineTo(w, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.containers.marginRect: 外の枠から余白 (rectMargin*) だけ内側の、角の丸い四角 (mxMockupContainers.js の mxShapeMockupContainersMarginRect) */
class ContainersMarginRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _state?: any) {
    let margin = parseFloat(this.sv('rectMargin', '0'));
    let marginTop = parseFloat(this.sv('rectMarginTop', '0'));
    let marginLeft = parseFloat(this.sv('rectMarginLeft', '0'));
    let marginBottom = parseFloat(this.sv('rectMarginBottom', '0'));
    let marginRight = parseFloat(this.sv('rectMarginRight', '0'));

    let x1 = margin + marginLeft;
    let y1 = margin + marginTop;
    let w1 = w - marginRight - x1 - margin;
    let h1 = h - marginBottom - y1 - margin;

    if (w1 > 0 && h1 > 0) {
      c.begin();
      c.roundrect(x1, y1, w1, h1, 10, 10);
      c.fillAndStroke();
    }
  }
}

/** mxgraph.mockup.containers.marginRect2: 外の枠から余白 (rectMargin*) だけ内側の四角 (mxMockupContainers.js の mxShapeMockupContainersMarginRect2) */
class ContainersMarginRect2 extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _state?: any) {
    let margin = parseFloat(this.sv('rectMargin', '0'));
    let marginTop = parseFloat(this.sv('rectMarginTop', '0'));
    let marginLeft = parseFloat(this.sv('rectMarginLeft', '0'));
    let marginBottom = parseFloat(this.sv('rectMarginBottom', '0'));
    let marginRight = parseFloat(this.sv('rectMarginRight', '0'));

    let x1 = margin + marginLeft;
    let y1 = margin + marginTop;
    let w1 = w - marginRight - x1 - margin;
    let h1 = h - marginBottom - y1 - margin;

    if (w1 > 0 && h1 > 0) {
      c.begin();
      c.rect(x1, y1, w1, h1);
      c.fillAndStroke();
    }
  }
}

// ───────────── 入力の欄 (draw.io の shapes/mockup/mxMockupForms.js) ─────────────

/** mxgraph.mockup.forms.checkboxGroup: チェックボックスの並び (旧版。mainText を , で分ける。+ で始まる名前が選んだもの) (mxMockupForms.js の mxShapeMockupCheckboxGroup) */
class CheckboxGroup extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, currText: any, currWidth: any, currHeight: any, iconX: any, iconY: any;
    c.translate(x, y);

    let fontColor = this.sc('textColor', '#666666,#008cff').toString().split(',');
    let fontSize = this.sv('textSize', '17').toString();
    let optionText = this.sv('mainText', 'Option 1').toString().split(',');
    let optionNum = optionText.length;
    let buttonSize = 15;
    let lineH = Math.max(fontSize * 1.5, buttonSize);
    let maxTextWidth = 0;
    let selected = -1;
    let labelOffset = 2.5;
    let minH = optionNum * lineH;
    let trueH = Math.max(h, minH);

    for (i = 0; i < optionNum; i++) {
      currText = optionText[i];

      if (currText.charAt(0) === '+') {
        currText = optionText[i].substring(1);
        selected = i;
      }

      currWidth = sizeForString(currText, fontSize, 'Helvetica').width;

      if (currWidth > maxTextWidth) {
        maxTextWidth = currWidth;
      }
    }

    let minW = 2 * labelOffset + maxTextWidth + 2 * buttonSize;
    let trueW = Math.max(w, minW);

    c.rect(0, 0, trueW, trueH);
    c.fillAndStroke();
    c.setShadow(false);

    c.setFontSize(fontSize);

    for (i = 0; i < optionNum; i++) {
      currHeight = ((i * lineH + lineH * 0.5) * trueH) / minH;

      currText = optionText[i];

      if (currText.charAt(0) === '+') {
        c.setFontColor(fontColor[1]);
        currText = optionText[i].substring(1);
        selected = i;
      } else {
        c.setFontColor(fontColor[0]);
      }

      c.text(buttonSize * 2 + labelOffset, currHeight, 0, 0, currText, 'left', 'middle', 0, null, 0, 0, 0);

      iconX = buttonSize * 0.5;
      iconY = currHeight - buttonSize * 0.5;
      c.setFillColor('#dddddd');
      c.setStrokeColor('#999999');

      if (selected === i) {
        c.setGradient('#aaaaaa', '#666666', iconX, iconY, buttonSize, buttonSize, 'south', 1, 1);
        c.rect(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
        c.setStrokeColor('#333333');
        c.begin();
        c.moveTo(iconX + buttonSize * 0.25, iconY + buttonSize * 0.5);
        c.lineTo(iconX + buttonSize * 0.5, iconY + buttonSize * 0.75);
        c.lineTo(iconX + buttonSize * 0.75, iconY + buttonSize * 0.25);
        c.stroke();
      } else {
        c.setGradient('#eeeeee', '#cccccc', iconX, iconY, buttonSize, buttonSize, 'south', 1, 1);
        c.rect(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
      }

      selected = -1;
    }
  }
}

/** mxgraph.mockup.forms.radioGroup: ラジオボタンの並び (mainText を , で分ける。+ で始まる名前が選んだもの) (mxMockupForms.js の mxShapeMockupRadioGroup) */
class RadioGroup extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, currText: any, currWidth: any, currHeight: any, iconX: any, iconY: any;
    c.translate(x, y);

    let fontColor = this.sc('textColor', '#666666,#008cff').toString().split(',');
    let fontSize = this.sv('textSize', '17').toString();
    let optionText = this.sv('mainText', 'Option 1').toString().split(',');
    let optionNum = optionText.length;
    let buttonSize = 15;
    let lineH = Math.max(fontSize * 1.5, buttonSize);
    let maxTextWidth = 0;
    let selected = -1;
    let labelOffset = 2.5;
    let minH = optionNum * lineH;
    let trueH = Math.max(h, minH);

    for (i = 0; i < optionNum; i++) {
      currText = optionText[i];

      if (currText.charAt(0) === '+') {
        currText = optionText[i].substring(1);
        selected = i;
      }

      currWidth = sizeForString(currText, fontSize, 'Helvetica').width;

      if (currWidth > maxTextWidth) {
        maxTextWidth = currWidth;
      }
    }

    let minW = 2 * labelOffset + maxTextWidth + 2 * buttonSize;
    let trueW = Math.max(w, minW);

    c.rect(0, 0, trueW, trueH);
    c.fillAndStroke();
    c.setShadow(false);

    c.setFontSize(fontSize);

    for (i = 0; i < optionNum; i++) {
      currHeight = ((i * lineH + lineH * 0.5) * trueH) / minH;

      currText = optionText[i];

      if (currText.charAt(0) === '+') {
        c.setFontColor(fontColor[1]);
        currText = optionText[i].substring(1);
        selected = i;
      } else {
        c.setFontColor(fontColor[0]);
      }

      c.text(buttonSize * 2 + labelOffset, currHeight, 0, 0, currText, 'left', 'middle', 0, null, 0, 0, 0);

      iconX = buttonSize * 0.5;
      iconY = currHeight - buttonSize * 0.5;
      c.setStrokeColor('#999999');

      if (selected === i) {
        c.setGradient('#aaaaaa', '#666666', iconX, iconY, buttonSize, buttonSize, 'south', 1, 1);
        c.ellipse(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
        c.setFillColor('#333333');
        c.setStrokeColor('#333333');
        c.ellipse(iconX + buttonSize * 0.25, iconY + buttonSize * 0.25, buttonSize * 0.5, buttonSize * 0.5);
        c.fillAndStroke();
      } else {
        c.setGradient('#eeeeee', '#cccccc', iconX, iconY, buttonSize, buttonSize, 'south', 1, 1);
        c.ellipse(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
      }
    }
  }
}

/** mxgraph.mockup.forms.colorPicker: 色を選ぶ欄 (chosenColor) (mxMockupForms.js の mxShapeMockupColorPicker) */
class ColorPicker extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let chosenColor = this.sc('chosenColor', '#aaddff');

    c.translate(x, y);

    c.setStrokeColor('#999999');
    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();
    c.setShadow(false);

    c.setFillColor(chosenColor);
    c.rect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    c.fill();

    c.setFillColor('#ffffff');
    c.begin();
    c.moveTo(w * 0.75, h * 0.75);
    c.lineTo(w * 0.75, h);
    c.lineTo(w * 0.95, h);
    c.arcTo(w * 0.05, h * 0.05, 0, 0, 0, w, h * 0.95);
    c.lineTo(w, h * 0.75);
    c.close();
    c.fill();

    c.setFillColor('#999999');
    c.begin();
    c.moveTo(w * 0.77, h * 0.77);
    c.lineTo(w * 0.875, h * 0.98);
    c.lineTo(w * 0.98, h * 0.77);
    c.close();
    c.fill();

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.stroke();
  }
}

/** mxgraph.mockup.forms.comboBox: 選ぶ欄 (右に下向きの三角) (mxMockupForms.js の mxShapeMockupComboBox) */
class ComboBox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
    this.mainText(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    c.setFillColor('#ffffff');
    c.roundrect(0, 0, w, h, 5, 5);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let fillColor = this.sc('fillColor', '').toString();
    let fillColor2 = this.sc('fillColor2', '').toString();
    c.setGradient(fillColor, fillColor2, w - 30, 0, 30, h, 'south', 1, 1);
    c.begin();
    c.moveTo(w - 30, 0);
    c.lineTo(w - 5, 0);
    c.arcTo(5, 5, 0, 0, 1, w, 5);
    c.lineTo(w, h - 5);
    c.arcTo(5, 5, 0, 0, 1, w - 5, h);
    c.lineTo(w - 30, h);
    c.close();
    c.fillAndStroke();

    c.setFillColor('#ffffff');
    c.begin();
    c.moveTo(w - 22, h * 0.5 - 5);
    c.lineTo(w - 15, h * 0.5 + 5);
    c.lineTo(w - 8, h * 0.5 - 5);
    c.fill();
  }
  mainText(c: Canvas, _x?: any, _y?: any, _w?: any, h?: any) {
    let mainText = this.sv('mainText', 'Main Text');
    let fontColor = this.sc('textColor', '#666666').toString();
    let fontSize = this.sv('textSize', '17').toString();

    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(5, h * 0.5, 0, 0, mainText, 'left', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.forms.spinner: 数を上げ下げする欄 (spinLayout・spinStyle) (mxMockupForms.js の mxShapeMockupSpinner) */
class Spinner extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let spinnerLayout = this.sv('spinLayout', 'right');
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h, spinnerLayout);
    this.mainText(c, w, h, spinnerLayout);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.setFillColor('#ffffff');
    c.roundrect(0, 0, w, h, 10, 10);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any, spinnerLayout?: any) {
    let spinnerStyle = this.sv('spinStyle', 'normal');
    let adjStyle = this.sv('adjStyle', 'triangle');
    let fillColor = this.sc('fillColor', '#ffffff');

    c.setFillColor(fillColor);

    if (spinnerStyle === 'normal') {
      if (spinnerLayout === 'right') {
        c.begin();
        c.moveTo(w - 20, 0);
        c.lineTo(w - 20, h);
        c.moveTo(w - 20, h * 0.5);
        c.lineTo(w, h * 0.5);
        c.stroke();
      } else if (spinnerLayout === 'left') {
        c.begin();
        c.moveTo(20, 0);
        c.lineTo(20, h);
        c.moveTo(20, h * 0.5);
        c.lineTo(0, h * 0.5);
        c.stroke();
      } else if (spinnerLayout === 'top') {
        c.begin();
        c.moveTo(0, 15);
        c.lineTo(w, 15);
        c.moveTo(w * 0.5, 15);
        c.lineTo(w * 0.5, 0);
        c.stroke();
      } else if (spinnerLayout === 'bottom') {
        c.begin();
        c.moveTo(0, h - 15);
        c.lineTo(w, h - 15);
        c.moveTo(w * 0.5, h - 15);
        c.lineTo(w * 0.5, h);
        c.stroke();
      } else if (spinnerLayout === 'vertical') {
        c.begin();
        c.moveTo(0, 15);
        c.lineTo(w, 15);
        c.moveTo(0, h - 15);
        c.lineTo(w, h - 15);
        c.stroke();
      } else if (spinnerLayout === 'horizontal') {
        c.begin();
        c.moveTo(20, 0);
        c.lineTo(20, h);
        c.moveTo(w - 20, 0);
        c.lineTo(w - 20, h);
        c.stroke();
      }
    }

    c.setStrokeColor(fillColor);

    if (spinnerLayout === 'right') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w - 14, h * 0.25 + 4.5);
        c.lineTo(w - 10, h * 0.25 - 2.5);
        c.lineTo(w - 6, h * 0.25 + 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w - 10, h * 0.25 - 4);
        c.lineTo(w - 10, h * 0.25 + 4);
        c.moveTo(w - 14, h * 0.25);
        c.lineTo(w - 6, h * 0.25);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w - 14, h * 0.25 + 1.5);
        c.lineTo(w - 10, h * 0.25 - 2.5);
        c.lineTo(w - 6, h * 0.25 + 1.5);
        c.close();
        c.moveTo(w - 10, h * 0.25 + 4.5);
        c.lineTo(w - 10, h * 0.25 - 2.5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'left') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(14, h * 0.25 + 4.5);
        c.lineTo(10, h * 0.25 - 2.5);
        c.lineTo(6, h * 0.25 + 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(10, h * 0.25 - 4);
        c.lineTo(10, h * 0.25 + 4);
        c.moveTo(14, h * 0.25);
        c.lineTo(6, h * 0.25);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(14, h * 0.25 + 1.5);
        c.lineTo(10, h * 0.25 - 2.5);
        c.lineTo(6, h * 0.25 + 1.5);
        c.close();
        c.moveTo(10, h * 0.25 + 4.5);
        c.lineTo(10, h * 0.25 - 2.5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'top') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.75 + 4, 12);
        c.lineTo(w * 0.75, 5);
        c.lineTo(w * 0.75 - 4, 12);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.75, 3.5);
        c.lineTo(w * 0.75, 11.5);
        c.moveTo(w * 0.75 + 4, 7.5);
        c.lineTo(w * 0.75 - 4, 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.75 + 4, 9);
        c.lineTo(w * 0.75, 5);
        c.lineTo(w * 0.75 - 4, 9);
        c.close();
        c.moveTo(w * 0.75, 12);
        c.lineTo(w * 0.75, 5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'bottom') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.75 + 4, h - 5);
        c.lineTo(w * 0.75, h - 12);
        c.lineTo(w * 0.75 - 4, h - 5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.75, h - 3.5);
        c.lineTo(w * 0.75, h - 11.5);
        c.moveTo(w * 0.75 + 4, h - 7.5);
        c.lineTo(w * 0.75 - 4, h - 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.75 + 4, h - 6);
        c.lineTo(w * 0.75, h - 10);
        c.lineTo(w * 0.75 - 4, h - 6);
        c.close();
        c.moveTo(w * 0.75, h - 3);
        c.lineTo(w * 0.75, h - 10);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'vertical') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.5 + 4, 12);
        c.lineTo(w * 0.5, 5);
        c.lineTo(w * 0.5 - 4, 12);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.5, 3.5);
        c.lineTo(w * 0.5, 11.5);
        c.moveTo(w * 0.5 + 4, 7.5);
        c.lineTo(w * 0.5 - 4, 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.5 + 4, 9);
        c.lineTo(w * 0.5, 5);
        c.lineTo(w * 0.5 - 4, 9);
        c.close();
        c.moveTo(w * 0.5, 12);
        c.lineTo(w * 0.5, 5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'horizontal') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w - 6, h * 0.5 + 4.5);
        c.lineTo(w - 10, h * 0.5 - 2.5);
        c.lineTo(w - 14, h * 0.5 + 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w - 10, h * 0.5 - 4);
        c.lineTo(w - 10, h * 0.5 + 4);
        c.moveTo(w - 14, h * 0.5);
        c.lineTo(w - 6, h * 0.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w - 14, h * 0.5 + 1.5);
        c.lineTo(w - 10, h * 0.5 - 2.5);
        c.lineTo(w - 6, h * 0.5 + 1.5);
        c.close();
        c.moveTo(w - 10, h * 0.5 + 4.5);
        c.lineTo(w - 10, h * 0.5 - 2.5);
        c.fillAndStroke();
      }
    }

    if (spinnerLayout === 'right') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w - 14, h * 0.75 - 4.5);
        c.lineTo(w - 10, h * 0.75 + 2.5);
        c.lineTo(w - 6, h * 0.75 - 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w - 14, h * 0.75);
        c.lineTo(w - 6, h * 0.75);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w - 14, h * 0.75 - 1.5);
        c.lineTo(w - 10, h * 0.75 + 2.5);
        c.lineTo(w - 6, h * 0.75 - 1.5);
        c.close();
        c.moveTo(w - 10, h * 0.75 - 4.5);
        c.lineTo(w - 10, h * 0.75 + 2.5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'left') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(14, h * 0.75 - 4.5);
        c.lineTo(10, h * 0.75 + 2.5);
        c.lineTo(6, h * 0.75 - 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(14, h * 0.75);
        c.lineTo(6, h * 0.75);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(14, h * 0.75 - 1.5);
        c.lineTo(10, h * 0.75 + 2.5);
        c.lineTo(6, h * 0.75 - 1.5);
        c.close();
        c.moveTo(10, h * 0.75 - 4.5);
        c.lineTo(10, h * 0.75 + 2.5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'top') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.25 + 4, 5);
        c.lineTo(w * 0.25, 12);
        c.lineTo(w * 0.25 - 4, 5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.25 + 4, 7.5);
        c.lineTo(w * 0.25 - 4, 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.25 + 4, 6);
        c.lineTo(w * 0.25, 10);
        c.lineTo(w * 0.25 - 4, 6);
        c.close();
        c.moveTo(w * 0.25, 3);
        c.lineTo(w * 0.25, 10);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'bottom') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.25 + 4, h - 12);
        c.lineTo(w * 0.25, h - 5);
        c.lineTo(w * 0.25 - 4, h - 12);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.25 + 4, h - 7.5);
        c.lineTo(w * 0.25 - 4, h - 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.25 + 4, h - 9);
        c.lineTo(w * 0.25, h - 5);
        c.lineTo(w * 0.25 - 4, h - 9);
        c.close();
        c.moveTo(w * 0.25, h - 12);
        c.lineTo(w * 0.25, h - 5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'vertical') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(w * 0.5 + 4, h - 12);
        c.lineTo(w * 0.5, h - 5);
        c.lineTo(w * 0.5 - 4, h - 12);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(w * 0.5 + 4, h - 7.5);
        c.lineTo(w * 0.5 - 4, h - 7.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(w * 0.5 + 4, h - 9);
        c.lineTo(w * 0.5, h - 5);
        c.lineTo(w * 0.5 - 4, h - 9);
        c.close();
        c.moveTo(w * 0.5, h - 12);
        c.lineTo(w * 0.5, h - 5);
        c.fillAndStroke();
      }
    } else if (spinnerLayout === 'horizontal') {
      if (adjStyle === 'triangle') {
        c.begin();
        c.moveTo(6, h * 0.5 - 4.5);
        c.lineTo(10, h * 0.5 + 2.5);
        c.lineTo(14, h * 0.5 - 4.5);
        c.close();
        c.fillAndStroke();
      } else if (adjStyle === 'plusMinus') {
        c.begin();
        c.moveTo(14, h * 0.5);
        c.lineTo(6, h * 0.5);
        c.stroke();
      } else if (adjStyle === 'arrow') {
        c.begin();
        c.moveTo(14, h * 0.5 - 1.5);
        c.lineTo(10, h * 0.5 + 2.5);
        c.lineTo(6, h * 0.5 - 1.5);
        c.close();
        c.moveTo(10, h * 0.5 - 4.5);
        c.lineTo(10, h * 0.5 + 2.5);
        c.fillAndStroke();
      }
    }
  }
  mainText(c: Canvas, w?: any, h?: any, spinnerLayout?: any) {
    let spinnerText = this.sv('mainText', '100').toString();
    let fontSize = this.sv('textSize', '17');
    let fontColor = this.sc('textColor', '#666666');
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);

    if (spinnerLayout === 'right') {
      c.text((w - 20) * 0.5, h * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (spinnerLayout === 'left') {
      c.text((w + 20) * 0.5, h * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (spinnerLayout === 'top') {
      c.text(w * 0.5, (h + 15) * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (spinnerLayout === 'bottom') {
      c.text(w * 0.5, (h - 15) * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (spinnerLayout === 'vertical') {
      c.text(w * 0.5, h * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (spinnerLayout === 'horizontal') {
      c.text(w * 0.5, h * 0.5, 0, 0, spinnerText, 'center', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.forms.menuBar: メニューの棒 (旧版) (mxMockupForms.js の mxShapeMockupMenuBar) */
class MenuBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, buttonText: any;
    let textStrings = this.sv('mainText', '+Menu 1, Menu 2, Menu 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let selectedFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();
    let frameColor = this.sc('strokeColor', '#666666');
    let separatorColor = this.sc('strokeColor2', '#c4c4c4');
    let bgColor = this.sc('fillColor', '#ffffff');
    let selectedFillColor = this.sc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let selectedButton = -1;
    let rSize = 10;
    let labelOffset = 5;

    for (i = 0; i < buttonNum; i++) {
      buttonText = textStrings[i];

      if (buttonText.charAt(0) === '+') {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      buttonWidths[i] = sizeForString(buttonText, fontSize, 'Helvetica').width;

      buttonTotalWidth += buttonWidths[i];
    }

    let trueH = Math.max(h, fontSize * 1.5, 20);
    let minW = 2 * labelOffset * buttonNum + buttonTotalWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);
    this.background(c, trueW, trueH, rSize, buttonNum, buttonWidths, labelOffset, minW, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton);
    c.setShadow(false);

    let currWidth = 0;

    for (i = 0; i < buttonNum; i++) {
      if (i === selectedButton) {
        c.setFontColor(selectedFontColor);
      } else {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  background(
    c: Canvas,
    w?: any,
    h?: any,
    _rSize?: any,
    buttonNum?: any,
    buttonWidths?: any,
    labelOffset?: any,
    minW?: any,
    frameColor?: any,
    separatorColor?: any,
    bgColor?: any,
    selectedFillColor?: any,
    selectedButton?: any,
  ) {
    let i: any, currWidth: any, buttonLeft: any, buttonRight: any;
    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.rect(0, 0, w, h);
    c.fillAndStroke();

    c.setStrokeColor(separatorColor);
    c.begin();

    const pre1 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (i = 1; i < buttonNum; i++) {
      if (i !== selectedButton && i !== selectedButton + 1) {
        currWidth = pre1[i];

        currWidth = (currWidth * w) / minW;
        c.moveTo(currWidth, 0);
        c.lineTo(currWidth, h);
      }
    }

    c.stroke();

    if (selectedButton !== -1) {
      buttonLeft = 0;
      c.setFillColor(selectedFillColor);

      for (i = 0; i < selectedButton; i++) {
        buttonLeft += buttonWidths[i] + 2 * labelOffset;
      }

      buttonLeft = (buttonLeft * w) / minW;
      buttonRight = ((buttonWidths[selectedButton] + 2 * labelOffset) * w) / minW;
      buttonRight += buttonLeft;

      c.rect(buttonLeft, 0, buttonRight - buttonLeft, h);
      c.fill();
    }

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.rect(0, 0, w, h);
    c.stroke();
  }
  buttonText(c: Canvas, w?: any, h?: any, textString?: any, buttonWidth?: any, fontSize?: any, minW?: any, trueW?: any) {
    if (textString.charAt(0) === '+') {
      textString = textString.substring(1);
    }

    c.setFontSize(fontSize);
    c.text(((w + buttonWidth * 0.5) * trueW) / minW, h * 0.5, 0, 0, textString, 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.forms.horSlider: 横のつまみ (sliderPos・sliderStyle・handleStyle) (mxMockupForms.js の mxShapeMockupHorSlider) */
class HorSlider extends Mock {
  sliderPos: any;
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let sliderStyle = this.sv('sliderStyle', 'basic');
    let rSize = 5;

    c.translate(x, y);
    this.background(c, w, h, rSize, sliderStyle);
    c.setShadow(false);
    this.foreground(c, w, h, rSize, sliderStyle);
    this.sliderPos = 20;
  }
  background(c: Canvas, w?: any, h?: any, rSize?: any, sliderStyle?: any) {
    if (sliderStyle === 'basic') {
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(w, h * 0.5);
      c.stroke();
    } else if (sliderStyle === 'fancy') {
      c.roundrect(0, h * 0.5 - rSize, w, 2 * rSize, rSize, rSize);
      c.fillAndStroke();
    }
  }
  foreground(c: Canvas, w?: any, h?: any, rSize?: any, sliderStyle?: any) {
    let barCenterPos: any;
    let sliderPos = this.sv('sliderPos', '20');
    let handleStyle = this.sv('handleStyle', 'circle');
    let fillColor = this.sc('fillColor', '#ffffff');
    let fillColor2 = this.sc('fillColor2', '#ddeeff');
    let strokeColor = this.sc('strokeColor', '#999999');
    sliderPos = Math.min(100, sliderPos);
    sliderPos = Math.max(0, sliderPos);

    if (sliderStyle === 'basic') {
      c.setStrokeColor(fillColor2);
      barCenterPos = (w * sliderPos) / 100;
      c.begin();
      c.moveTo(0, h * 0.5);
      c.lineTo(barCenterPos, h * 0.5);
      c.stroke();
      c.setStrokeColor(strokeColor);
    } else if (sliderStyle === 'fancy') {
      barCenterPos = 10 + ((w - 10) * sliderPos) / 100;
      c.setFillColor(fillColor2);
      c.roundrect(0, h * 0.5 - rSize, barCenterPos, 2 * rSize, rSize, rSize);
      c.fillAndStroke();
      c.setFillColor(fillColor);
    }

    let handleCenterPos = 5 + ((w - 10) * sliderPos) / 100;

    if (handleStyle === 'circle') {
      c.ellipse(handleCenterPos - 10, h * 0.5 - 10, 20, 20);
      c.fillAndStroke();
    } else if (handleStyle === 'triangle') {
      c.begin();
      c.moveTo(handleCenterPos - 10, h * 0.5 + 10);
      c.lineTo(handleCenterPos, h * 0.5 - 10);
      c.lineTo(handleCenterPos + 10, h * 0.5 + 10);
      c.close();
      c.fillAndStroke();
    } else if (handleStyle === 'handle') {
      c.begin();
      c.moveTo(handleCenterPos - 7, h * 0.5 + 10);
      c.lineTo(handleCenterPos - 7, h * 0.5);
      c.lineTo(handleCenterPos, h * 0.5 - 10);
      c.lineTo(handleCenterPos + 7, h * 0.5);
      c.lineTo(handleCenterPos + 7, h * 0.5 + 10);
      c.close();
      c.fillAndStroke();
    }
  }
}

/** mxgraph.mockup.forms.listBox: 一覧の箱 (旧版) (mxMockupForms.js の mxShapeMockupListBox) */
class ListBox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, itemText: any, currWidth: any;
    let bgColor = this.sc('fillColor', '#ffffff');
    let frameColor = this.sc('strokeColor', '#666666');
    let fontSize = this.sv('textSize', '17').toString();

    let selectedButton = -1;
    let maxShapeWidth = w;
    let subText = this.sv('subText', 'Sub Text').toString().split(',');

    for (i = 0; i < subText.length; i++) {
      itemText = subText[i];

      if (itemText.charAt(0) === '+') {
        itemText = subText[i].substring(1);
        selectedButton = i;
      }

      currWidth = sizeForString(itemText, fontSize, 'Helvetica').width;

      if (currWidth > maxShapeWidth) {
        maxShapeWidth = currWidth;
      }
    }

    c.translate(x, y);

    w = Math.min(w, maxShapeWidth);
    h = Math.max(h, 30 + subText.length * fontSize * 1.5);

    this.background(c, w, h, bgColor, frameColor);
    c.setShadow(false);
    this.foreground(c, w, h, frameColor, selectedButton, subText, fontSize);
  }
  background(c: Canvas, w?: any, h?: any, bgColor?: any, frameColor?: any) {
    c.setFillColor(bgColor);
    c.setStrokeColor(frameColor);
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any, _frameColor?: any, selectedButton?: any, subText?: any, fontSize?: any) {
    let i: any, currText: any;
    let selectedColor = this.sc('selectedColor', '#ddeeff');

    if (selectedButton !== -1) {
      c.setFillColor(selectedColor);
      c.rect(0, 30 + selectedButton * fontSize * 1.5, w, fontSize * 1.5);
      c.fill();
    }

    c.begin();
    c.moveTo(0, 30);
    c.lineTo(w, 30);
    c.stroke();

    let windowTitle = this.sv('mainText', 'Window Title').toString();
    let fontColor = this.sc('textColor', '#666666,#008cff').toString().split(',');

    c.setFontColor(fontColor[1]);
    c.setFontSize(fontSize);
    c.text(10, 15, 0, 0, windowTitle, 'left', 'middle', 0, null, 0, 0, 0);
    c.setFontColor(fontColor[0]);

    for (i = 0; i < subText.length; i++) {
      currText = subText[i];

      if (currText.charAt(0) === '+') {
        currText = subText[i].substring(1);
      }

      c.text(10, 30 + fontSize * (i * 1.5 + 0.75), 0, 0, currText, 'left', 'middle', 0, null, 0, 0, 0);
    }

    c.rect(0, 0, w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.forms.pwField: パスワードの欄 (伏せ字の点) (mxMockupForms.js の mxShapeMockupPwField) */
class PwField extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, h?: any) {
    let mainText = this.sv('mainText', '******');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    c.text(5, h * 0.5, 0, 0, mainText, 'left', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.forms.splitter: 仕切り (splitterStyle) (mxMockupForms.js の mxShapeMockupSplitter) */
class Splitter extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    w = Math.max(w, 35);
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.begin();
    c.moveTo(0, h * 0.5 - 5);
    c.lineTo(w, h * 0.5 - 5);
    c.lineTo(w, h * 0.5 + 5);
    c.lineTo(0, h * 0.5 + 5);
    c.close();
    c.fill();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.begin();
    c.moveTo(0, h * 0.5 - 5);
    c.lineTo(w, h * 0.5 - 5);
    c.moveTo(w, h * 0.5 + 5);
    c.lineTo(0, h * 0.5 + 5);
    c.stroke();

    c.setFillColor(strokeColor);
    c.ellipse(w * 0.5 - 17, h * 0.5 - 2, 4, 4);
    c.fill();
    c.ellipse(w * 0.5 - 2, h * 0.5 - 2, 4, 4);
    c.fill();
    c.ellipse(w * 0.5 + 13, h * 0.5 - 2, 4, 4);
    c.fill();
  }
}

/** mxgraph.mockup.forms.wedgeBar: くさび形のタブの並び (mxMockupForms.js の mxShapeMockupWedgeBar) */
class WedgeBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, currLabel: any, currW: any;
    let fontSize = this.sv('textSize', '17').toString();
    let tabNames = this.sv('tabs', 'Tab 1,+Tab 2,Tab 3').toString().split(',');

    let tabH = fontSize * 1.5;
    let startOffset = 10;
    let tabOffset = 5;
    let labelOffset = 10;
    let tabCount = tabNames.length;
    let minW = 2 * startOffset + (tabCount - 1) * tabOffset + tabCount * 2 * labelOffset;
    let rSize = 5;
    let labelWidths = new Array();
    let selectedTab = -1;

    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
        selectedTab = i;
      }

      currW = sizeForString(currLabel, fontSize, 'Helvetica').width;

      if (currW === 0) {
        labelWidths[i] = 42;
      } else {
        labelWidths[i] = currW;
      }

      minW = minW + labelWidths[i];
    }

    w = Math.max(w, minW);
    h = Math.max(h, tabH + rSize);

    c.translate(x, y);

    c.setShadow(false);
    this.backTabs(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.focusTab(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab);
    this.tabText(c, w, h, rSize, tabH, startOffset, tabOffset, labelOffset, tabCount, labelWidths, selectedTab, tabNames);
  }
  backTabs(c: Canvas, _w?: any, _h?: any, rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, tabCount?: any, labelWidths?: any, selectedTab?: any) {
    let i: any, tabW: any;
    let tabStyle = this.sv('tabStyle', 'block');

    let currW = startOffset;
    for (i = 0; i < tabCount; i++) {
      tabW = labelWidths[i] + 2 * labelOffset;

      if (selectedTab !== i) {
        if (tabStyle === 'block') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'cone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW - labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'halfCone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'round') {
          c.begin();
          c.moveTo(currW - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 0, currW, tabH - rSize);
          c.lineTo(currW, rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + rSize, 0);
          c.lineTo(currW + tabW - rSize, 0);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + tabW, rSize);
          c.lineTo(currW + tabW, tabH - rSize);
          c.arcTo(rSize, rSize, 0, 0, 0, currW + tabW + rSize, tabH);
        }

        c.fillAndStroke();
      }

      currW = currW + tabW + tabOffset;
    }
  }
  focusTab(c: Canvas, _w?: any, _h?: any, rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, _tabCount?: any, labelWidths?: any, selectedTab?: any) {
    let i: any, tabW: any;
    let tabStyle = this.sv('tabStyle', 'block');
    let selectedFill = this.sc('fillColor2', '#008cff');

    let currW = startOffset;
    c.setStrokeColor(selectedFill);
    c.setFillColor(selectedFill);

    for (i = 0; i <= selectedTab; i++) {
      tabW = labelWidths[i] + 2 * labelOffset;

      if (selectedTab === i) {
        if (tabStyle === 'block') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'cone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW - labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'halfCone') {
          c.begin();
          c.moveTo(currW, tabH);
          c.lineTo(currW + labelOffset * 0.5, 0);
          c.lineTo(currW + tabW, 0);
          c.lineTo(currW + tabW, tabH);
        } else if (tabStyle === 'round') {
          c.begin();
          c.moveTo(currW - rSize, tabH);
          c.arcTo(rSize, rSize, 0, 0, 0, currW, tabH - rSize);
          c.lineTo(currW, rSize);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + rSize, 0);
          c.lineTo(currW + tabW - rSize, 0);
          c.arcTo(rSize, rSize, 0, 0, 1, currW + tabW, rSize);
          c.lineTo(currW + tabW, tabH - rSize);
          c.arcTo(rSize, rSize, 0, 0, 0, currW + tabW + rSize, tabH);
        }

        c.fillAndStroke();
      }

      currW = currW + tabW + tabOffset;
    }
  }
  tabText(c: Canvas, _w?: any, _h?: any, _rSize?: any, tabH?: any, startOffset?: any, tabOffset?: any, labelOffset?: any, tabCount?: any, labelWidths?: any, selectedTab?: any, tabNames?: any) {
    let i: any, currLabel: any, tabW: any;
    let fontColor = this.sc('textColor', '#666666');
    let selFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    let currW = startOffset;

    for (i = 0; i < tabCount; i++) {
      currLabel = tabNames[i];

      if (i === selectedTab) {
        c.setFontColor(selFontColor);
      }

      if (currLabel.charAt(0) === '+') {
        currLabel = currLabel.substring(1);
      }

      tabW = labelWidths[i] + 2 * labelOffset;

      c.text(currW + labelOffset, tabH * 0.5, 0, 0, currLabel, 'left', 'middle', 0, null, 0, 0, 0);

      currW = currW + tabW + tabOffset;

      if (i === selectedTab) {
        c.setFontColor(fontColor);
      }
    }
  }
}

/** mxgraph.mockup.forms.searchBox: 検索の欄 (虫眼鏡の印) (mxMockupForms.js の mxShapeMockupSearchBox) */
class SearchBox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let mainText = this.sv('mainText', 'Search');
    let fontColor = this.sc('textColor', '#666666');
    let strokeColor2 = this.sc('strokeColor2', '#008cff');
    let fontSize = this.sv('textSize', '17');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    c.text(5, h * 0.5, 0, 0, mainText, 'left', 'middle', 0, null, 0, 0, 0);

    c.setStrokeColor(strokeColor2);
    c.ellipse(w - 15, h * 0.5 - 8, 10, 10);
    c.stroke();
    c.begin();
    c.moveTo(w - 19, h * 0.5 + 9);
    c.lineTo(w - 13, h * 0.5 + 1);
    c.stroke();
  }
}

/** mxgraph.mockup.forms.signIn: サインインの書式 (mxMockupForms.js の mxShapeMockupSignIn) */
class SignIn extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let mainText = this.sv('mainText', 'Sign In,User Name:,johndoe,Password:,********,Forgot Password?,New User,SIGN IN,SIGN UP').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let fontColor2 = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '12');
    let fontSize2 = this.sv('textSize2', '15');
    let strokeColor2 = this.sc('strokeColor2', '#ddeeff');
    let fillColor2 = this.sc('fillColor2', '#66bbff');

    c.setFillColor(fillColor2);
    c.roundrect(w * 0.09, h * 0.52, w * 0.36, h * 0.09, 5, 5);
    c.fill();

    c.roundrect(w * 0.09, h * 0.84, w * 0.36, h * 0.09, 5, 5);
    c.fill();

    c.rect(w * 0.05, h * 0.22, w * 0.75, h * 0.08);
    c.stroke();

    c.rect(w * 0.05, h * 0.4, w * 0.75, h * 0.08);
    c.stroke();

    c.setStrokeColor(strokeColor2);
    c.setStrokeWidth(2);

    c.begin();
    c.moveTo(w * 0.05, h * 0.12);
    c.lineTo(w * 0.95, h * 0.12);
    c.moveTo(w * 0.05, h * 0.72);
    c.lineTo(w * 0.95, h * 0.72);
    c.stroke();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);
    c.text(w * 0.05, h * 0.1, 0, 0, mainText[0], 'left', 'bottom', 0, null, 0, 0, 0);
    c.text(w * 0.05, h * 0.2, 0, 0, mainText[1], 'left', 'bottom', 0, null, 0, 0, 0);
    c.text(w * 0.075, h * 0.26, 0, 0, mainText[2], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.05, h * 0.38, 0, 0, mainText[3], 'left', 'bottom', 0, null, 0, 0, 0);
    c.text(w * 0.075, h * 0.44, 0, 0, mainText[4], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.05, h * 0.8, 0, 0, mainText[6], 'left', 'middle', 0, null, 0, 0, 0);

    c.setStrokeWidth(1);
    c.setFontColor('#9999ff');
    c.setStrokeColor('#9999ff');
    let forgotW = sizeForString(mainText[5], fontSize, 'Helvetica').width;
    c.text(w * 0.05, h * 0.7, 0, 0, mainText[5], 'left', 'bottom', 0, null, 0, 0, 0);

    c.begin();
    c.moveTo(w * 0.05, h * 0.7);
    c.lineTo(w * 0.05 + forgotW, h * 0.7);
    c.stroke();

    c.setFontColor(fontColor2);
    c.setFontStyle(1);
    c.setFontSize(fontSize2);
    c.text(w * 0.27, h * 0.565, 0, 0, mainText[7], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.27, h * 0.885, 0, 0, mainText[8], 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.forms.calendar: 暦 (startOn・days・selDay など) (mxMockupForms.js の mxShapeMockupCalendar) */
class Calendar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.roundrect(0, 0, w, h, w * 0.0312, h * 0.0286);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let i: any, currX: any, j: any, diff: any, tmp: any, d: any, currY: any;
    let strokeColor = this.sc('strokeColor', '#999999');
    let fillColor = this.sc('fillColor', '#ffffff');
    let strokeColor2 = this.sc('strokeColor2', '#008cff');
    let fillColor2 = this.sc('fillColor2', '#ddeeff');
    let mainText = this.sv('mainText', '');
    let textSize = this.sv('textSize', '15');
    let textColor = this.sc('textColor', '#999999');
    let textColor2 = this.sc('textColor2', '#ffffff');
    let days = parseInt(this.sv('days', '30'), 10);
    let prevDays = parseInt(this.sv('prevDays', '31'), 10);

    let firstDay = parseInt(this.sv('firstDay', '0'), 10);

    let startOn = parseInt(this.sv('startOn', '6', 10));
    let dayNames = this.sv('dayNames', 'Mo,Tu,We,Th,Fr,Sa,Su').toString().split(',');
    let selDay = parseInt(this.sv('selDay', '24'), 10);

    // v24.7.5 の元は firstDay を fistDay (別の変数) に入れ違えているので、firstDay は 0〜6 に収めない (そのまま写す)
    startOn = Math.max(startOn, 0);
    startOn = Math.min(startOn, 6);

    c.roundrect(w * 0.05, h * 0.0457, w * 0.1438, h * 0.1029, w * 0.025, h * 0.0229);
    c.stroke();
    c.roundrect(w * 0.8125, h * 0.0457, w * 0.1438, h * 0.1029, w * 0.025, h * 0.0229);
    c.stroke();

    c.setStrokeWidth(2);
    c.setStrokeColor(strokeColor2);
    c.begin();
    c.moveTo(w * 0.1438, h * 0.0743);
    c.lineTo(w * 0.1, h * 0.0971);
    c.lineTo(w * 0.1438, h * 0.12);
    c.moveTo(w * 0.8625, h * 0.0743);
    c.lineTo(w * 0.9062, h * 0.0971);
    c.lineTo(w * 0.8625, h * 0.12);
    c.stroke();

    c.setFontSize(textSize);
    c.setFontColor(textColor);
    c.text(w * 0.5, h * 0.0971, 0, 0, mainText, 'center', 'middle', 0, null, 0, 0, 0);

    let range = w * 0.875;
    let cellSize = range / 7;

    for (i = 0; i < 7; i++) {
      currX = w * 0.0625 + cellSize * 0.5 + i * cellSize;
      j = i + startOn;

      if (j > 6) {
        j = j - 7;
      }

      c.text(currX, h * 0.2114, 0, 0, dayNames[j], 'center', 'middle', 0, null, 0, 0, 0);
    }

    c.setStrokeWidth(1);

    let x = 0;
    let selX = -1;
    let selY = -1;

    if (firstDay !== startOn) {
      c.setStrokeColor(strokeColor);
      c.setFillColor(fillColor2);

      diff = firstDay - startOn;
      if (diff < 0) {
        diff = diff + 7;
      }

      // 前の月の日も、今の月の日も、MAX_DAYS 日まで (Kumiori の守り。firstDay は 0〜6 に収めないので、diff が大きくなりうる)
      for (i = 0; i < diff && i < MAX_DAYS; i++) {
        currX = w * 0.0625 + i * cellSize;
        c.rect(currX, h * 0.2686, cellSize, h * 0.1143);
        c.fillAndStroke();
        tmp = prevDays - diff + i + 1;

        c.text(currX + cellSize * 0.5, h * 0.2686 + cellSize * 0.5, 0, 0, tmp.toString(), 'center', 'middle', 0, null, 0, 0, 0);
      }

      x = diff;
    }

    c.setFillColor(fillColor);
    c.setStrokeColor(strokeColor);

    let y = 0;

    for (i = 0; i < days && i < MAX_DAYS; i++) {
      d = i + 1;
      currX = w * 0.0625 + x * cellSize;
      currY = h * 0.2686 + y * h * 0.1143;

      if (d === selDay) {
        selX = currX;
        selY = currY;
      } else {
        c.rect(currX, currY, cellSize, h * 0.1143);
        c.fillAndStroke();
        c.text(currX + cellSize * 0.5, currY + cellSize * 0.5, 0, 0, d.toString(), 'center', 'middle', 0, null, 0, 0, 0);
      }

      if (x < 6) {
        x++;
      } else {
        x = 0;
        y++;
      }
    }

    i = 1;
    c.setFillColor(fillColor2);

    while (y < 6) {
      currX = w * 0.0625 + x * cellSize;
      currY = h * 0.2686 + y * h * 0.1143;
      c.rect(currX, currY, cellSize, h * 0.1143);
      c.fillAndStroke();

      c.text(currX + cellSize * 0.5, currY + cellSize * 0.5, 0, 0, i.toString(), 'center', 'middle', 0, null, 0, 0, 0);

      if (x < 6) {
        x++;
      } else {
        x = 0;
        y++;
      }

      i++;
    }

    if (selX >= 0) {
      c.setStrokeColor('#ff0000');
      c.setStrokeWidth(2);
      c.setFillColor(strokeColor2);
      c.setFontColor(textColor2);

      c.rect(selX, selY, cellSize, h * 0.1143);
      c.fillAndStroke();
      c.text(selX + cellSize * 0.5, selY + cellSize * 0.5, 0, 0, selDay.toString(), 'center', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.forms.emailForm: メールの書式 (mxMockupForms.js の mxShapeMockupEmailForm) */
class EmailForm extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let fontSize = this.sv('textSize', '12');
    let showCC = this.sv('showCC', 'true');
    let showBCC = this.sv('showBCC', 'true');
    let tabX = fontSize * 4;

    let optCount = 0;

    if (showCC === 'true') {
      optCount++;
    }

    if (showBCC === 'true') {
      optCount++;
    }

    w = Math.max(w, fontSize * 5);
    h = Math.max(h, fontSize * 10.5 + optCount * fontSize * 3);

    c.translate(x, y);
    this.background(c, w, h, fontSize, tabX, showCC, showBCC);
    c.setShadow(false);
    this.foreground(c, w, h, fontSize, tabX, showCC, showBCC);
  }
  background(c: Canvas, w?: any, h?: any, fontSize?: any, tabX?: any, showCC?: any, showBCC?: any) {
    let messX = fontSize * 9;

    if (showCC === 'true') {
      messX = messX + fontSize * 3;
      c.rect(tabX, fontSize * 9, w - tabX, fontSize * 1.5);
      c.fillAndStroke();
    }

    if (showBCC === 'true') {
      c.rect(tabX, messX, w - tabX, fontSize * 1.5);
      messX = messX + fontSize * 3;
      c.fillAndStroke();
    }

    c.rect(tabX, 0, w - tabX, fontSize * 1.5);
    c.fillAndStroke();
    c.rect(tabX, fontSize * 3, w - tabX, fontSize * 1.5);
    c.fillAndStroke();
    c.rect(tabX, fontSize * 6, w - tabX, fontSize * 1.5);
    c.fillAndStroke();
    c.rect(0, messX, w, h - messX);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, _h?: any, fontSize?: any, tabX?: any, showCC?: any, showBCC?: any) {
    let mainText = this.sv('mainText', 'john@jgraph.com,Greeting,fred@jgraph.com,,,Lorem ipsum').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    c.text(tabX - fontSize * 0.5, fontSize * 0.75, 0, 0, 'From', 'right', 'middle', 0, null, 0, 0, 0);
    c.text(tabX - fontSize * 0.5, fontSize * 3.75, 0, 0, 'Subject', 'right', 'middle', 0, null, 0, 0, 0);
    c.text(tabX - fontSize * 0.5, fontSize * 6.75, 0, 0, 'To', 'right', 'middle', 0, null, 0, 0, 0);

    c.text(tabX + fontSize * 0.5, fontSize * 0.75, 0, 0, mainText[0], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(tabX + fontSize * 0.5, fontSize * 3.75, 0, 0, mainText[1], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(tabX + fontSize * 0.5, fontSize * 6.75, 0, 0, mainText[2], 'left', 'middle', 0, null, 0, 0, 0);

    let messX = fontSize * 9;

    if (showCC === 'true') {
      messX = messX + fontSize * 3;
      c.text(tabX - fontSize * 0.5, fontSize * 9.75, 0, 0, 'CC', 'right', 'middle', 0, null, 0, 0, 0);
      c.text(tabX + fontSize * 0.5, fontSize * 9.75, 0, 0, mainText[3], 'left', 'middle', 0, null, 0, 0, 0);
    }

    if (showBCC === 'true') {
      c.text(tabX - fontSize * 0.5, messX + fontSize * 0.75, 0, 0, 'BCC', 'right', 'middle', 0, null, 0, 0, 0);
      c.text(tabX + fontSize * 0.5, messX + fontSize * 0.75, 0, 0, mainText[4], 'left', 'middle', 0, null, 0, 0, 0);
      messX = messX + fontSize * 3;
    }

    c.text(fontSize * 0.5, messX + fontSize * 0.75, 0, 0, mainText[5], 'left', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.forms.rrect: 角の丸い四角 (rSize) (mxMockupForms.js の mxShapeMockupFormsRRect) */
class FormsRRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.forms.anchor: 繋ぐ点だけの形 (何も描かない) (mxMockupForms.js の mxShapeMockupFormsAnchor) */
class FormsAnchor extends Mock {
  paintVertexShape(_c: Canvas, _x: any, _y: any, _w: any, _h: any) {}
}

/** mxgraph.mockup.forms.checkbox: チェックボックス 1 つ (checked) (mxMockupForms.js の mxShapeMockupFormsCheckbox) */
class FormsCheckbox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    c.rect(0, 0, w, h);
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8, h * 0.2);
    c.lineTo(w * 0.4, h * 0.8);
    c.lineTo(w * 0.25, h * 0.6);
    c.stroke();
  }
}

/** mxgraph.mockup.forms.uRect: 上の開いた四角 (mxMockupForms.js の mxShapeMockupFormsURect) */
class FormsURect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    c.begin();
    c.moveTo(0, h);
    c.lineTo(0, 0);
    c.lineTo(w, 0);
    c.lineTo(w, h);
    c.fillAndStroke();
  }
}

// ───────────── 図表 (draw.io の shapes/mockup/mxMockupGraphics.js) ─────────────

/** mxgraph.mockup.graphics.barChart: 横棒のグラフ (mxMockupGraphics.js の mxShapeMockupBarChart) */
class BarChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, x, y, w, h);

    let bgFill = this.sc('fillColor', 'none');

    if (bgFill !== 'none') {
      c.setShadow(false);
    }

    this.bars(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  bars(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let barStroke = this.sc('strokeColor2', 'none');
    let coordStroke = this.sc('strokeColor3', '#666666');
    let barFill1 = this.sc('fillColor2', '#008cff');
    let barFill2 = this.sc('fillColor3', '#dddddd');

    let strokeWidth = this.sv('strokeWidth', '1');

    c.setStrokeColor(barStroke);
    c.setFillColor(barFill1);
    c.rect(0, h * 0.2, w * 0.75, h * 0.05);
    c.fillAndStroke();
    c.rect(0, h * 0.45, w * 0.6, h * 0.05);
    c.fillAndStroke();
    c.rect(0, h * 0.7, w * 0.95, h * 0.05);
    c.fillAndStroke();

    c.setFillColor(barFill2);
    c.rect(0, h * 0.25, w * 0.85, h * 0.05);
    c.fillAndStroke();
    c.rect(0, h * 0.5, w * 0.65, h * 0.05);
    c.fillAndStroke();
    c.rect(0, h * 0.75, w * 0.8, h * 0.05);
    c.fillAndStroke();

    c.setStrokeWidth(strokeWidth * 2);
    c.setStrokeColor(coordStroke);

    c.setShadow(false);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.columnChart: 縦棒のグラフ (mxMockupGraphics.js の mxShapeMockupColumnChart) */
class ColumnChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, x, y, w, h);

    let bgFill = this.sc('fillColor', 'none');

    if (bgFill !== 'none') {
      c.setShadow(false);
    }

    this.bars(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  bars(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let barStroke = this.sc('strokeColor2', 'none');
    let coordStroke = this.sc('strokeColor3', '#666666');
    let barFill1 = this.sc('fillColor2', '#008cff');
    let barFill2 = this.sc('fillColor3', '#dddddd');

    let strokeWidth = this.sv('strokeWidth', '1');

    c.setStrokeColor(barStroke);
    c.setFillColor(barFill1);
    c.rect(w * 0.2, h * 0.25, w * 0.05, h * 0.75);
    c.fillAndStroke();
    c.rect(w * 0.45, h * 0.4, w * 0.05, h * 0.6);
    c.fillAndStroke();
    c.rect(w * 0.7, h * 0.05, w * 0.05, h * 0.95);
    c.fillAndStroke();

    c.setFillColor(barFill2);
    c.rect(w * 0.25, h * 0.15, w * 0.05, h * 0.85);
    c.fillAndStroke();
    c.rect(w * 0.5, h * 0.35, w * 0.05, h * 0.65);
    c.fillAndStroke();
    c.rect(w * 0.75, h * 0.2, w * 0.05, h * 0.8);
    c.fillAndStroke();

    c.setStrokeWidth(strokeWidth * 2);
    c.setStrokeColor(coordStroke);

    c.setShadow(false);

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.lineChart: 折れ線のグラフ (mxMockupGraphics.js の mxShapeMockupLineChart) */
class LineChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, x, y, w, h);

    let bgFill = this.sc('fillColor', 'none');

    if (bgFill !== 'none') {
      c.setShadow(false);
    }

    this.bars(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  bars(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let coordStroke = this.sc('strokeColor2', '#666666');
    let line1Stroke = this.sc('strokeColor3', '#008cff');
    let line2Stroke = this.sc('strokeColor4', '#dddddd');

    let strokeWidth = this.sv('strokeWidth', '1');

    c.setStrokeWidth(strokeWidth * 2);
    c.setStrokeColor(line2Stroke);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w * 0.3, h * 0.5);
    c.lineTo(w * 0.6, h * 0.74);
    c.lineTo(w * 0.9, h * 0.24);
    c.stroke();

    c.setStrokeColor(line1Stroke);
    c.begin();
    c.moveTo(0, h);
    c.lineTo(w * 0.3, h * 0.65);
    c.lineTo(w * 0.6, h * 0.6);
    c.lineTo(w * 0.9, h * 0.35);
    c.stroke();

    c.setStrokeColor(coordStroke);
    c.setShadow(false);

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.pieChart: 円グラフ (parts の割合を partColors の色で) (mxMockupGraphics.js の mxShapeMockupPieChart) */
class PieChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let i: any, beginPerc: any, endPerc: any, currPerc: any, startAngle: any, endAngle: any, x1: any, y1: any, x2: any, y2: any, largeArc: any;
    let parts = this.sv('parts', '10,20,30').toString().split(',');
    let partNum = parts.length;
    let partColors = this.sv('partColors', '#333333,#666666,#999999').toString().split(',');
    let total = 0;

    for (i = 0; i < partNum; i++) {
      total = total + parseInt(parts[i], 10);
    }

    const pre2 = prefixSums(parts.length, (j) => parseInt(parts[j], 10) / total); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (i = 0; i < partNum; i++) {
      if (partColors.length > i) {
        c.setFillColor(partColors[i]);
      } else {
        c.setFillColor('#ff0000');
      }

      beginPerc = pre2[i];
      endPerc = 0;
      currPerc = parseInt(parts[i], 10) / total;

      if (currPerc === 0.5) {
        currPerc = 0.501;
      }


      endPerc = currPerc + beginPerc;
      startAngle = 2 * Math.PI * beginPerc;
      endAngle = 2 * Math.PI * endPerc;

      x1 = w * 0.5 - w * Math.sin(startAngle) * 0.5;
      y1 = h * 0.5 - h * Math.cos(startAngle) * 0.5;
      x2 = w * 0.5 - w * Math.sin(endAngle) * 0.5;
      y2 = h * 0.5 - h * Math.cos(endAngle) * 0.5;
      largeArc = 1;

      if (endPerc - beginPerc < 0.5) {
        largeArc = 0;
      }

      c.begin();
      c.moveTo(w * 0.5, h * 0.5);
      c.lineTo(x2, y2);
      c.arcTo(w * 0.5, h * 0.5, 0, largeArc, 1, x1, y1);
      c.close();
      c.fillAndStroke();
    }
  }
}

/** mxgraph.mockup.graphics.iconGrid: アイコンの升目 (gridSize は 列,行) (mxMockupGraphics.js の mxShapeMockupIconGrid) */
class IconGrid extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    let gridSize = this.sv('gridSize', '3,3').toString().split(',');
    this.background(c, w, h, gridSize);
    c.setShadow(false);

    this.foreground(c, w, h, gridSize);
  }
  background(c: Canvas, w?: any, h?: any, gridSize?: any) {
    let i: any, j: any, n: any;
    let boxSizeX = w / (parseInt(gridSize[0], 10) + (gridSize[0] - 1) * 0.5);
    let boxSizeY = h / (parseInt(gridSize[1], 10) + (gridSize[1] - 1) * 0.5);

    // アイコンは、列も合わせた数も MAX_ICONS 個まで (Kumiori の守り)
    for (i = 0, n = 0; i < gridSize[0] && i < MAX_ICONS; i++) {
      for (j = 0; j < gridSize[1] && n < MAX_ICONS; j++, n++) {
        c.rect(boxSizeX * 1.5 * i, boxSizeY * 1.5 * j, boxSizeX, boxSizeY);
        c.fillAndStroke();
      }
    }
  }
  foreground(c: Canvas, w?: any, h?: any, gridSize?: any) {
    let i: any, j: any, n: any;
    let boxSizeX = w / (parseInt(gridSize[0], 10) + (gridSize[0] - 1) * 0.5);
    let boxSizeY = h / (parseInt(gridSize[1], 10) + (gridSize[1] - 1) * 0.5);

    // アイコンは、列も合わせた数も MAX_ICONS 個まで (Kumiori の守り)
    for (i = 0, n = 0; i < gridSize[0] && i < MAX_ICONS; i++) {
      for (j = 0; j < gridSize[1] && n < MAX_ICONS; j++, n++) {
        c.begin();
        c.moveTo(boxSizeX * 1.5 * i, boxSizeY * 1.5 * j);
        c.lineTo(boxSizeX * 1.5 * i + boxSizeX, boxSizeY * 1.5 * j + boxSizeY);
        c.moveTo(boxSizeX * 1.5 * i + boxSizeX, boxSizeY * 1.5 * j);
        c.lineTo(boxSizeX * 1.5 * i, boxSizeY * 1.5 * j + boxSizeY);
        c.stroke();
      }
    }
  }
}

/** mxgraph.mockup.graphics.bubbleChart: 泡のグラフ (mxMockupGraphics.js の mxShapeMockupBubbleChart) */
class BubbleChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, x, y, w, h);

    let bgFill = this.sc('fillColor', 'none');

    if (bgFill !== 'none') {
      c.setShadow(false);
    }

    this.bars(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  bars(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let barStroke = this.sc('strokeColor2', 'none');
    let coordStroke = this.sc('strokeColor3', '#666666');
    let barFill1 = this.sc('fillColor2', '#008cff');
    let barFill2 = this.sc('fillColor3', '#dddddd');

    let strokeWidth = this.sv('strokeWidth', '1');

    c.setStrokeColor(barStroke);
    c.setFillColor(barFill1);

    let cx = w * 0.4;
    let cy = h * 0.45;
    let r = Math.min(h, w) * 0.14;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    cx = w * 0.1;
    cy = h * 0.8;
    r = Math.min(h, w) * 0.1;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    cx = w * 0.7;
    cy = h * 0.7;
    r = Math.min(h, w) * 0.22;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    c.setFillColor(barFill2);
    cx = w * 0.15;
    cy = h * 0.25;
    r = Math.min(h, w) * 0.19;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    cx = w * 0.48;
    cy = h * 0.7;
    r = Math.min(h, w) * 0.12;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    cx = w * 0.74;
    cy = h * 0.17;
    r = Math.min(h, w) * 0.1;
    c.ellipse(cx - r, cy - r, 2 * r, 2 * r);
    c.fillAndStroke();

    c.setStrokeWidth(strokeWidth * 2);
    c.setStrokeColor(coordStroke);

    c.setShadow(false);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.gauge: 針の付いた計器 (gaugePos・scaleColors・gaugeLabels) (mxMockupGraphics.js の mxShapeMockupGauge) */
class Gauge extends Mock {
  gaugePos: any = 25;
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let gaugePos = this.sv('gaugePos', '0');
    let scaleColors = safeDecode(this.sv('scaleColors', '#888888,#aaaaaa,#444444').toString()).split(',');
    let gaugeLabels = this.sv('gaugeLabels', 'CPU[%],0,100').toString().split(',');
    let needleColor = this.sc('needleColor', '#008cff');
    let fillColor = this.sc('fillColor', '#ffffff');
    let textColor = this.sc('textColor', '#666666');
    let textSize = this.sv('textSize', '12');

    gaugePos = Math.max(0, gaugePos);
    gaugePos = Math.min(100, gaugePos);

    c.setFillColor(scaleColors[1]);
    c.begin();
    c.moveTo(w * 0.05, h * 0.5);
    c.arcTo(w * 0.4, h * 0.4, 0, 0, 1, w * 0.95, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.arcTo(w * 0.5, h * 0.5, 0, 0, 0, 0, h * 0.5);
    c.close();
    c.fill();

    c.setFillColor(scaleColors[0]);
    c.begin();
    c.moveTo(w * 0.05, h * 0.5);
    c.arcTo(w * 0.45, h * 0.45, 0, 0, 0, w * 0.182, h * 0.818);
    c.lineTo(w * 0.146, h * 0.854);
    c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, 0, h * 0.5);
    c.close();
    c.fill();

    c.setFillColor(scaleColors[2]);
    c.begin();
    c.moveTo(w, h * 0.5);
    c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.854, h * 0.854);
    c.lineTo(w * 0.818, h * 0.818);
    c.arcTo(w * 0.45, h * 0.45, 0, 0, 0, w * 0.95, h * 0.5);
    c.close();
    c.fill();

    c.setFontSize(textSize);
    c.setFontColor(textColor);
    c.text(w * 0.5, h * 0.3, 0, 0, gaugeLabels[0], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.2, h * 0.85, 0, 0, gaugeLabels[1], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.8, h * 0.85, 0, 0, gaugeLabels[2], 'right', 'middle', 0, null, 0, 0, 0);

    let needlePos = 0.75 * ((2 * Math.PI * parseFloat(gaugePos)) / 100) + 1.25 * Math.PI;

    let x1 = w * 0.5 + w * 0.38 * Math.sin(needlePos);
    let y1 = h * 0.5 - h * 0.38 * Math.cos(needlePos);
    let x2 = 0;
    let y2 = 0;
    c.setFillColor(needleColor);
    c.begin();
    c.moveTo(x1, y1);

    x1 = w * 0.5 + w * 0.05 * Math.cos(needlePos);
    y1 = h * 0.5 + h * 0.05 * Math.sin(needlePos);
    c.lineTo(x1, y1);

    x2 = w * 0.5 + w * -0.05 * Math.sin(needlePos);
    y2 = h * 0.5 - h * -0.05 * Math.cos(needlePos);
    c.arcTo(w * 0.05, h * 0.05, 0, 0, 1, x2, y2);

    x1 = x2;
    y1 = y2;
    x2 = w * 0.5 - w * 0.05 * Math.cos(needlePos);
    y2 = h * 0.5 - h * 0.05 * Math.sin(needlePos);
    c.arcTo(w * 0.05, h * 0.05, 0, 0, 1, x2, y2);
    c.close();
    c.fill();

    c.setFillColor(fillColor);
    c.begin();
    c.moveTo(w * 0.49, h * 0.49);
    c.lineTo(w * 0.51, h * 0.49);
    c.lineTo(w * 0.51, h * 0.51);
    c.lineTo(w * 0.49, h * 0.51);
    c.close();
    c.fill();

    c.begin();
    c.ellipse(0, 0, w, h);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.146, h * 0.854);
    c.lineTo(w * 0.219, h * 0.781);
    c.moveTo(w * 0.854, h * 0.854);
    c.lineTo(w * 0.781, h * 0.781);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.plotChart: 点のグラフ (mxMockupGraphics.js の mxShapeMockupPlotChart) */
class PlotChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, x, y, w, h);

    let bgFill = this.sc('fillColor', 'none');

    if (bgFill !== 'none') {
      c.setShadow(false);
    }

    this.foreground(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let shapeStroke = this.sc('strokeColor2', '#dddddd');
    let coordStroke = this.sc('strokeColor3', '#666666');
    let shapesColors = safeDecode(this.sc('fillColor2', '#00aaff,#0044ff,#008cff').toString()).split(',');

    let strokeWidth = this.sv('strokeWidth', '1');
    let shapeSize = Math.min(w, h) * 0.03;

    c.setStrokeColor(shapeStroke);
    c.setFillColor(shapesColors[0]);

    let cx = w * 0.2;
    let cy = h * 0.8;
    c.begin();
    c.moveTo(cx - shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    cx = w * 0.3;
    cy = h * 0.65;
    c.begin();
    c.moveTo(cx - shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    cx = w * 0.6;
    cy = h * 0.44;
    c.begin();
    c.moveTo(cx - shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    cx = w * 0.85;
    cy = h * 0.9;
    c.begin();
    c.moveTo(cx - shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    c.setFillColor(shapesColors[1]);
    cx = w * 0.08;
    cy = h * 0.65;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    cx = w * 0.58;
    cy = h * 0.85;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    cx = w * 0.72;
    cy = h * 0.92;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.5);
    c.lineTo(cx + shapeSize * 0.5, cy + shapeSize * 0.5);
    c.lineTo(cx - shapeSize * 0.5, cy + shapeSize * 0.5);
    c.close();
    c.fillAndStroke();

    c.setFillColor(shapesColors[2]);
    cx = w * 0.32;
    cy = h * 0.28;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.75);
    c.lineTo(cx + shapeSize * 0.75, cy);
    c.lineTo(cx, cy + shapeSize * 0.75);
    c.lineTo(cx - shapeSize * 0.75, cy);
    c.close();
    c.fillAndStroke();

    cx = w * 0.92;
    cy = h * 0.45;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.75);
    c.lineTo(cx + shapeSize * 0.75, cy);
    c.lineTo(cx, cy + shapeSize * 0.75);
    c.lineTo(cx - shapeSize * 0.75, cy);
    c.close();
    c.fillAndStroke();

    cx = w * 0.81;
    cy = h * 0.37;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.75);
    c.lineTo(cx + shapeSize * 0.75, cy);
    c.lineTo(cx, cy + shapeSize * 0.75);
    c.lineTo(cx - shapeSize * 0.75, cy);
    c.close();
    c.fillAndStroke();

    cx = w * 0.51;
    cy = h * 0.7;
    c.begin();
    c.moveTo(cx, cy - shapeSize * 0.75);
    c.lineTo(cx + shapeSize * 0.75, cy);
    c.lineTo(cx, cy + shapeSize * 0.75);
    c.lineTo(cx - shapeSize * 0.75, cy);
    c.close();
    c.fillAndStroke();

    c.setStrokeWidth(strokeWidth * 2);
    c.setStrokeColor(coordStroke);

    c.setShadow(false);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    c.lineTo(w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.ganttChart: ガントチャート (mxMockupGraphics.js の mxShapeMockupGanttChart) */
class GanttChart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Canvas, _x?: any, _y?: any, w?: any, h?: any, _bgColor?: any, _frameColor?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let shapesColors = safeDecode(this.sc('fillColor2', '#888888,#bbbbbb').toString()).split(',');

    c.begin();
    c.moveTo(0, h * 0.13);
    c.lineTo(w, h * 0.13);
    c.moveTo(w * 0.4, 0);
    c.lineTo(w * 0.4, h);
    c.moveTo(w * 0.4, h * 0.065);
    c.lineTo(w, h * 0.065);
    c.moveTo(w * 0.03, 0);
    c.lineTo(w * 0.03, h * 0.13);
    c.moveTo(w * 0.1, 0);
    c.lineTo(w * 0.1, h * 0.13);
    c.moveTo(w * 0.315, 0);
    c.lineTo(w * 0.315, h * 0.13);
    c.moveTo(w * 0.45, h * 0.065);
    c.lineTo(w * 0.45, h * 0.13);
    c.moveTo(w * 0.5, h * 0.065);
    c.lineTo(w * 0.5, h);
    c.moveTo(w * 0.55, h * 0.065);
    c.lineTo(w * 0.55, h * 0.13);
    c.moveTo(w * 0.6, h * 0.065);
    c.lineTo(w * 0.6, h);
    c.moveTo(w * 0.65, h * 0.065);
    c.lineTo(w * 0.65, h * 0.13);
    c.moveTo(w * 0.7, h * 0.065);
    c.lineTo(w * 0.7, h);
    c.moveTo(w * 0.75, 0);
    c.lineTo(w * 0.75, h * 0.13);
    c.moveTo(w * 0.8, h * 0.065);
    c.lineTo(w * 0.8, h);
    c.moveTo(w * 0.85, h * 0.065);
    c.lineTo(w * 0.85, h * 0.13);
    c.moveTo(w * 0.9, h * 0.065);
    c.lineTo(w * 0.9, h);
    c.moveTo(w * 0.95, h * 0.065);
    c.lineTo(w * 0.95, h * 0.13);
    c.stroke();

    c.setFillColor(shapesColors[0]);
    c.begin();
    c.moveTo(w * 0.41, h * 0.15);
    c.lineTo(w * 0.64, h * 0.15);
    c.lineTo(w * 0.64, h * 0.18);
    c.lineTo(w * 0.625, h * 0.21);
    c.lineTo(w * 0.61, h * 0.18);
    c.lineTo(w * 0.44, h * 0.18);
    c.lineTo(w * 0.425, h * 0.21);
    c.lineTo(w * 0.41, h * 0.18);
    c.close();
    c.moveTo(w * 0.41, h * 0.24);
    c.lineTo(w * 0.49, h * 0.24);
    c.lineTo(w * 0.49, h * 0.275);
    c.lineTo(w * 0.41, h * 0.275);
    c.close();
    c.moveTo(w * 0.46, h * 0.31);
    c.lineTo(w * 0.64, h * 0.31);
    c.lineTo(w * 0.64, h * 0.345);
    c.lineTo(w * 0.46, h * 0.345);
    c.close();
    c.moveTo(w * 0.56, h * 0.39);
    c.lineTo(w * 0.69, h * 0.39);
    c.lineTo(w * 0.69, h * 0.425);
    c.lineTo(w * 0.56, h * 0.425);
    c.close();
    c.fill();

    c.setFillColor(shapesColors[1]);
    c.begin();
    c.moveTo(w * 0.46, h * 0.32);
    c.lineTo(w * 0.58, h * 0.32);
    c.lineTo(w * 0.58, h * 0.335);
    c.lineTo(w * 0.46, h * 0.335);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.graphics.simpleIcon: ばつ印の入った四角 (絵の置き場) (mxMockupGraphics.js の mxShapeMockupSimpleIcon) */
class SimpleIcon extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    c.rect(0, 0, w, h);
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w, h);
    c.moveTo(0, h);
    c.lineTo(w, 0);
    c.stroke();
  }
}

/** mxgraph.mockup.graphics.anchor: 繋ぐ点だけの形 (何も描かない) (mxMockupGraphics.js の mxShapeMockupGraphicsAnchor) */
class GraphicsAnchor extends Mock {
  paintVertexShape(_c: Canvas, _x: any, _y: any, _w: any, _h: any) {}
}

/** mxgraph.mockup.graphics.rrect: 角の丸い四角 (rSize) (mxMockupGraphics.js の mxShapeMockupGraphicsRRect) */
class GraphicsRRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

// ───────────── そのほか (draw.io の shapes/mockup/mxMockupMisc.js) ─────────────

/** mxgraph.mockup.misc.playbackControls: 再生の操作の印の並び (mxMockupMisc.js の mxShapeMockupPlaybackControls) */
class PlaybackControls extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let controlBarHeight = 30;
    let buttonSize = 22;
    h = Math.max(h, controlBarHeight);
    w = Math.max(225, w);

    c.translate(x, y);
    this.background(c, w, h, controlBarHeight);
    c.setShadow(false);
    this.foreground(c, w, h, controlBarHeight, buttonSize);
  }
  background(c: Canvas, w?: any, h?: any, controlBarHeight?: any) {
    c.rect(0, (h - controlBarHeight) * 0.5, w, controlBarHeight);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, h?: any, controlBarHeight?: any, buttonSize?: any) {
    let fillColor2 = this.sc('fillColor2', '#99ddff');
    let strokeColor2 = this.sc('strokeColor2', 'none');
    let fillColor3 = this.sc('fillColor3', '#ffffff');
    let strokeColor3 = this.sc('strokeColor3', 'none');

    c.setStrokeColor(strokeColor2);
    c.setFillColor(fillColor2);
    c.ellipse(10, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(40, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(70, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(100, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(130, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(160, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();
    c.ellipse(190, h * 0.5 - buttonSize * 0.5, buttonSize, buttonSize);
    c.fillAndStroke();

    c.setStrokeColor(strokeColor3);
    c.setFillColor(fillColor3);

    let t = h * 0.5 - controlBarHeight * 0.5;
    c.begin();
    c.moveTo(16, t + 10);
    c.lineTo(16, t + 20);
    c.lineTo(18, t + 20);
    c.lineTo(18, t + 10);
    c.close();
    c.moveTo(20, t + 15);
    c.lineTo(25, t + 20);
    c.lineTo(25, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(44, t + 15);
    c.lineTo(49, t + 20);
    c.lineTo(49, t + 10);
    c.close();
    c.moveTo(51, t + 15);
    c.lineTo(56, t + 20);
    c.lineTo(56, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(77, t + 15);
    c.lineTo(82, t + 20);
    c.lineTo(82, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(108, t + 10);
    c.lineTo(108, t + 20);
    c.lineTo(110, t + 20);
    c.lineTo(110, t + 10);
    c.close();
    c.moveTo(117, t + 15);
    c.lineTo(112, t + 20);
    c.lineTo(112, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(144, t + 15);
    c.lineTo(139, t + 20);
    c.lineTo(139, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(171, t + 15);
    c.lineTo(166, t + 20);
    c.lineTo(166, t + 10);
    c.close();
    c.moveTo(178, t + 15);
    c.lineTo(173, t + 20);
    c.lineTo(173, t + 10);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(203, t + 10);
    c.lineTo(203, t + 20);
    c.lineTo(205, t + 20);
    c.lineTo(205, t + 10);
    c.close();
    c.moveTo(201, t + 15);
    c.lineTo(196, t + 20);
    c.lineTo(196, t + 10);
    c.close();
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.misc.progressBar: 進み具合の棒 (barPos) (mxMockupMisc.js の mxShapeMockupProgressBar) */
class ProgressBar extends Mock {
  barPos: any = 20;
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.roundrect(0, h * 0.5 - 5, w, 10, 5, 5);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let fillColor2 = this.sc('fillColor2', '#ddeeff');
    let barPos = this.sv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = 0;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + (virRange * barPos) / 100;

    c.setFillColor(fillColor2);
    c.roundrect(0, h * 0.5 - 5, truePos, 10, 5, 5);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.misc.shoppingCart: 買い物かごの印 (mxMockupMisc.js の mxShapeMockupShoppingCart) */
class ShoppingCart extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#000000');
    c.translate(x, y);

    c.setStrokeWidth(3);
    c.begin();
    c.moveTo(w * 0.975, h * 0.025);
    c.lineTo(w * 0.82, h * 0.055);
    c.lineTo(w * 0.59, h * 0.66);
    c.lineTo(w * 0.7, h * 0.765);
    c.arcTo(w * 0.06, h * 0.06, 0, 0, 1, w * 0.665, h * 0.86);
    c.lineTo(w * 0.05, h * 0.86);
    c.moveTo(w * 0.74, h * 0.26);
    c.lineTo(w * 0.03, h * 0.28);
    c.lineTo(w * 0.065, h * 0.61);
    c.lineTo(w * 0.59, h * 0.66);
    c.stroke();

    c.setStrokeWidth(1);
    c.begin();
    c.moveTo(w * 0.15, h * 0.28);
    c.lineTo(w * 0.15, h * 0.62);
    c.moveTo(w * 0.265, h * 0.275);
    c.lineTo(w * 0.265, h * 0.63);
    c.moveTo(w * 0.38, h * 0.27);
    c.lineTo(w * 0.38, h * 0.64);
    c.moveTo(w * 0.495, h * 0.265);
    c.lineTo(w * 0.495, h * 0.65);
    c.moveTo(w * 0.61, h * 0.265);
    c.lineTo(w * 0.61, h * 0.61);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.69, h * 0.405);
    c.lineTo(w * 0.045, h * 0.405);
    c.moveTo(w * 0.645, h * 0.52);
    c.lineTo(w * 0.055, h * 0.52);
    c.stroke();
    c.setFillColor(strokeColor);
    c.ellipse(w * 0.075, h * 0.89, w * 0.1, h * 0.1);
    c.fillAndStroke();
    c.ellipse(w * 0.62, h * 0.89, w * 0.1, h * 0.1);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.misc.rating: 評価の星・心の印 (ratingStyle・ratingScale・emptyFillColor) (mxMockupMisc.js の mxShapeMockupRating) */
class Rating extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, _w: any, h: any) {
    let i: any, n: any;
    let ratingStyle = this.sv('ratingStyle', 'star');
    let grade = this.sv('grade', '5');
    let ratingScale = this.sv('ratingScale', '10');

    c.translate(x, y);

    if (ratingStyle === 'star') {
      for (i = 0; i < grade && i < MAX_ICONS; i++) {
        c.begin();
        c.moveTo(i * h * 1.5, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.364 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.475 * h, 0);
        c.lineTo(i * h * 1.5 + 0.586 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.95 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.66 * h, 0.551 * h);
        c.lineTo(i * h * 1.5 + 0.775 * h, 0.9 * h);
        c.lineTo(i * h * 1.5 + 0.475 * h, 0.684 * h);
        c.lineTo(i * h * 1.5 + 0.175 * h, 0.9 * h);
        c.lineTo(i * h * 1.5 + 0.29 * h, 0.551 * h);
        c.close();
        c.fillAndStroke();
      }
    } else if (ratingStyle === 'heart') {
      for (i = 0; i < grade && i < MAX_ICONS; i++) {
        c.begin();
        c.moveTo(i * h * 1.5 + h * 0.519, h * 0.947);
        c.curveTo(i * h * 1.5 + h * 0.558, h * 0.908, i * h * 1.5 + h * 0.778, h * 0.682, i * h * 1.5 + h * 0.916, h * 0.54);
        c.curveTo(i * h * 1.5 + h * 1.039, h * 0.414, i * h * 1.5 + h * 1.036, h * 0.229, i * h * 1.5 + h * 0.924, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.812, 0, i * h * 1.5 + h * 0.631, 0, i * h * 1.5 + h * 0.519, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.408, 0, i * h * 1.5 + h * 0.227, 0, i * h * 1.5 + h * 0.115, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.03, h * 0.229, i * h * 1.5, h * 0.414, i * h * 1.5 + h * 0.123, h * 0.54);
        c.close();
        c.fillAndStroke();
      }
    }

    let emptyFillColor = this.sc('emptyFillColor', '#ffffff');
    c.setFillColor(emptyFillColor);

    if (ratingStyle === 'star') {
      for (i = grade, n = 0; i < ratingScale && n < MAX_ICONS; i++, n++) {
        c.begin();
        c.moveTo(i * h * 1.5, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.364 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.475 * h, 0);
        c.lineTo(i * h * 1.5 + 0.586 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.95 * h, 0.33 * h);
        c.lineTo(i * h * 1.5 + 0.66 * h, 0.551 * h);
        c.lineTo(i * h * 1.5 + 0.775 * h, 0.9 * h);
        c.lineTo(i * h * 1.5 + 0.475 * h, 0.684 * h);
        c.lineTo(i * h * 1.5 + 0.175 * h, 0.9 * h);
        c.lineTo(i * h * 1.5 + 0.29 * h, 0.551 * h);
        c.close();
        c.fillAndStroke();
      }
    } else if (ratingStyle === 'heart') {
      for (i = grade, n = 0; i < ratingScale && n < MAX_ICONS; i++, n++) {
        c.begin();
        c.moveTo(i * h * 1.5 + h * 0.519, h * 0.947);
        c.curveTo(i * h * 1.5 + h * 0.558, h * 0.908, i * h * 1.5 + h * 0.778, h * 0.682, i * h * 1.5 + h * 0.916, h * 0.54);
        c.curveTo(i * h * 1.5 + h * 1.039, h * 0.414, i * h * 1.5 + h * 1.036, h * 0.229, i * h * 1.5 + h * 0.924, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.812, 0, i * h * 1.5 + h * 0.631, 0, i * h * 1.5 + h * 0.519, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.408, 0, i * h * 1.5 + h * 0.227, 0, i * h * 1.5 + h * 0.115, h * 0.115);
        c.curveTo(i * h * 1.5 + h * 0.03, h * 0.229, i * h * 1.5, h * 0.414, i * h * 1.5 + h * 0.123, h * 0.54);
        c.close();
        c.fillAndStroke();
      }
    }
  }
}

/** mxgraph.mockup.misc.mail2: 封筒の印 (mxMockupMisc.js の mxShapeMockupMail) */
class Mail extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    c.rect(0, 0, w, h);
    c.fillAndStroke();

    c.setShadow(false);
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.5, h * 0.5);
    c.lineTo(w, 0);
    c.stroke();
  }
}

/** mxgraph.mockup.misc.volumeSlider: 音量のつまみ (barPos) (mxMockupMisc.js の mxShapeMockupVolumeSlider) */
class VolumeSlider extends Mock {
  barPos: any = 80;
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let barPos = this.sv('barPos', '80');
    let fillColor2 = this.sc('fillColor2', '#ddeeff');

    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let controlBarHeight = 25;
    h = Math.max(h, controlBarHeight);
    w = Math.max(w, 3.5 * controlBarHeight);

    let speakerStartX = w - controlBarHeight;
    let speakerStartY = (h - controlBarHeight) * 0.5;
    c.begin();
    c.moveTo(speakerStartX + controlBarHeight * 0.05, speakerStartY + controlBarHeight * 0.35);
    c.lineTo(speakerStartX + controlBarHeight * 0.15, speakerStartY + controlBarHeight * 0.35);
    c.lineTo(speakerStartX + controlBarHeight * 0.3, speakerStartY + controlBarHeight * 0.2);
    c.lineTo(speakerStartX + controlBarHeight * 0.3, speakerStartY + controlBarHeight * 0.8);
    c.lineTo(speakerStartX + controlBarHeight * 0.15, speakerStartY + controlBarHeight * 0.65);
    c.lineTo(speakerStartX + controlBarHeight * 0.05, speakerStartY + controlBarHeight * 0.65);
    c.close();
    c.fill();

    let barMin = 0;
    let barMax = w - controlBarHeight * 1.3;
    let videoBarStartY = (h - controlBarHeight) * 0.5;
    let barRange = barMax - barMin;
    barPos = (barRange * barPos) / 100;
    let barEnd = barMin + barPos;

    let soundStartX = w - controlBarHeight;
    let soundStartY = (h - controlBarHeight) * 0.5;
    c.begin();
    c.moveTo(soundStartX + controlBarHeight * 0.4, soundStartY + controlBarHeight * 0.35);
    c.arcTo(controlBarHeight * 0.2, controlBarHeight * 0.3, 0, 0, 1, soundStartX + controlBarHeight * 0.4, soundStartY + controlBarHeight * 0.65);
    c.moveTo(soundStartX + controlBarHeight * 0.425, soundStartY + controlBarHeight * 0.25);
    c.arcTo(controlBarHeight * 0.225, controlBarHeight * 0.35, 0, 0, 1, soundStartX + controlBarHeight * 0.425, soundStartY + controlBarHeight * 0.75);
    c.moveTo(soundStartX + controlBarHeight * 0.5, soundStartY + controlBarHeight * 0.2);
    c.arcTo(controlBarHeight * 0.25, controlBarHeight * 0.4, 0, 0, 1, soundStartX + controlBarHeight * 0.5, soundStartY + controlBarHeight * 0.8);
    c.fillAndStroke();

    let videoBarStartX = 0;
    videoBarStartY = (h - controlBarHeight) * 0.5;
    let videoBarEndX = w - controlBarHeight * 1.3;
    c.roundrect(videoBarStartX, videoBarStartY + controlBarHeight * 0.35, videoBarEndX, controlBarHeight * 0.3, 5, 5);
    c.fill();
    c.setShadow(false);
    c.setFillColor(fillColor2);
    c.roundrect(barMin, videoBarStartY + controlBarHeight * 0.35, barEnd, controlBarHeight * 0.3, 5, 5);
    c.fill();

    c.ellipse(barEnd - controlBarHeight * 0.25, videoBarStartY + controlBarHeight * 0.25, controlBarHeight * 0.5, controlBarHeight * 0.5);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.misc.editIcon: 編集の印 (鉛筆) (mxMockupMisc.js の mxShapeMockupEdit) */
class Edit extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.11, h * 0.8);
    c.lineTo(w * 0.2, h * 0.89);
    c.lineTo(w * 0.05, h * 0.95);
    c.close();
    c.moveTo(w * 0.74, h * 0.16);
    c.lineTo(w * 0.84, h * 0.26);
    c.lineTo(w * 0.22, h * 0.88);
    c.lineTo(w * 0.12, h * 0.78);
    c.close();
    c.moveTo(w * 0.755, h * 0.145);
    c.lineTo(w * 0.82, h * 0.08);
    c.lineTo(w * 0.92, h * 0.18);
    c.lineTo(w * 0.855, h * 0.245);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.misc.printIcon: 印刷の印 (mxMockupMisc.js の mxShapeMockupPrint) */
class Print extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.15, h * 0.58);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.18, h * 0.55);
    c.lineTo(w * 0.82, h * 0.55);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.85, h * 0.58);
    c.lineTo(w * 0.85, h * 0.82);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.82, h * 0.85);
    c.lineTo(w * 0.18, h * 0.85);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.15, h * 0.82);
    c.close();
    c.moveTo(w * 0.7, h * 0.52);
    c.lineTo(w * 0.3, h * 0.52);
    c.lineTo(w * 0.3, h * 0.15);
    c.lineTo(w * 0.55, h * 0.15);
    c.lineTo(w * 0.55, h * 0.3);
    c.lineTo(w * 0.7, h * 0.3);
    c.close();
    c.moveTo(w * 0.57, h * 0.15);
    c.lineTo(w * 0.7, h * 0.28);
    c.lineTo(w * 0.57, h * 0.28);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.misc.shareIcon: 共有の印 (mxMockupMisc.js の mxShapeMockupShare) */
class Share extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.15, h * 0.18);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.18, h * 0.15);
    c.lineTo(w * 0.82, h * 0.15);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.85, h * 0.18);
    c.lineTo(w * 0.85, h * 0.82);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.82, h * 0.85);
    c.lineTo(w * 0.18, h * 0.85);
    c.arcTo(w * 0.03, h * 0.03, 0, 0, 1, w * 0.15, h * 0.82);
    c.close();
    c.fill();

    let fillColor = this.sc('fillColor', '#ffffff');
    c.setFillColor(fillColor);
    c.begin();
    c.moveTo(w * 0.563, h * 0.34);
    c.arcTo(w * 0.095, h * 0.095, 0, 1, 1, w * 0.603, h * 0.42);
    c.lineTo(w * 0.44, h * 0.5);
    c.lineTo(w * 0.602, h * 0.582);
    c.arcTo(w * 0.095, h * 0.095, 0, 1, 1, w * 0.563, h * 0.653);
    c.lineTo(w * 0.403, h * 0.575);
    c.arcTo(w * 0.095, h * 0.095, 0, 1, 1, w * 0.4, h * 0.42);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.misc.trashcanIcon: ごみ箱の印 (mxMockupMisc.js の mxShapeMockupTrashcan) */
class Trashcan extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.24, h * 0.24);
    c.arcTo(w * 0.04, h * 0.04, 0, 0, 1, w * 0.24, h * 0.16);
    c.lineTo(w * 0.4, h * 0.16);
    c.lineTo(w * 0.4, h * 0.12);
    c.lineTo(w * 0.6, h * 0.12);
    c.lineTo(w * 0.6, h * 0.16);
    c.lineTo(w * 0.76, h * 0.16);
    c.arcTo(w * 0.04, h * 0.04, 0, 0, 1, w * 0.76, h * 0.24);
    c.close();
    c.fill();

    c.roundrect(w * 0.26, h * 0.3, w * 0.1, h * 0.6, w * 0.06, h * 0.06);
    c.fill();
    c.roundrect(w * 0.44, h * 0.3, w * 0.1, h * 0.6, w * 0.06, h * 0.06);
    c.fill();
    c.roundrect(w * 0.62, h * 0.3, w * 0.1, h * 0.6, w * 0.06, h * 0.06);
    c.fill();
  }
}

/** mxgraph.mockup.misc.copyrightIcon: 著作権の印 (C を丸で囲む) (mxMockupMisc.js の mxShapeMockupCopyright) */
class Copyright extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.ellipse(0, 0, w, h);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.713, h * 0.288);
    c.arcTo(w * 0.3, h * 0.3, 0, 1, 0, w * 0.713, h * 0.712);
    c.lineTo(w * 0.784, h * 0.783);
    c.arcTo(w * 0.4, h * 0.4, 0, 1, 1, w * 0.784, h * 0.217);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.misc.registeredIcon: 登録商標の印 (R を丸で囲む) (mxMockupMisc.js の mxShapeMockupRegistered) */
class Registered extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.ellipse(0, 0, w, h);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.29, h * 0.9);
    c.lineTo(w * 0.29, h * 0.09);
    c.lineTo(w * 0.5, h * 0.09);
    c.arcTo(w * 0.2195, h * 0.2195, 0, 0, 1, w * 0.545, h * 0.525);
    c.lineTo(w * 0.738, h * 0.91);
    c.lineTo(w * 0.674, h * 0.91);
    c.lineTo(w * 0.4825, h * 0.53);
    c.lineTo(w * 0.35, h * 0.53);
    c.lineTo(w * 0.35, h * 0.9);
    c.close();
    c.moveTo(w * 0.35, h * 0.47);
    c.lineTo(w * 0.5, h * 0.47);
    c.arcTo(w * 0.15, h * 0.15, 0, 0, 0, w * 0.5, h * 0.15);
    c.lineTo(w * 0.35, h * 0.15);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.misc.volumeIcon: 音量の印 (スピーカー) (mxMockupMisc.js の mxShapeMockupVolume) */
class Volume extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let strokeColor = this.sc('strokeColor', '#999999');

    c.translate(x, y);

    c.roundrect(0, 0, w, h, w * 0.05, h * 0.05);
    c.fillAndStroke();

    c.setShadow(false);
    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.1, h * 0.3);
    c.lineTo(w * 0.3, h * 0.3);
    c.lineTo(w * 0.5, h * 0.15);
    c.lineTo(w * 0.5, h * 0.85);
    c.lineTo(w * 0.3, h * 0.7);
    c.lineTo(w * 0.1, h * 0.7);
    c.close();
    c.fill();

    c.begin();
    c.moveTo(w * 0.6, h * 0.4);
    c.arcTo(w * 0.2, h * 0.2, 0, 0, 1, w * 0.6, h * 0.6);

    c.moveTo(w * 0.7, h * 0.3);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, w * 0.7, h * 0.7);

    c.moveTo(w * 0.8, h * 0.2);
    c.arcTo(w * 0.4, h * 0.4, 0, 0, 1, w * 0.8, h * 0.8);
    c.stroke();
  }
}

/** mxgraph.mockup.misc.ruler: 物差し (rulerOrient・unitSize) (mxMockupMisc.js の mxShapeMockupRuler) */
class Ruler extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let remainder: any;
    let facing = this.sv('rulerOrient', 'down');
    let unitSize = this.sv('unitSize', '10');

    unitSize = Math.max(unitSize, 1);

    let currX = unitSize;
    let i = 1;

    if (facing === 'down') {
      c.begin();

      while (currX < w && i <= MAX_TICKS) {
        remainder = i % 10;

        if (remainder === 0) {
          c.moveTo(currX, h * 0.5);
          c.lineTo(currX, h);
        } else if (remainder === 5) {
          c.moveTo(currX, h * 0.7);
          c.lineTo(currX, h);
        } else {
          c.moveTo(currX, h * 0.8);
          c.lineTo(currX, h);
        }

        currX = currX + unitSize;
        i = i + 1;
      }

      c.stroke();
    } else if (facing === 'up') {
      c.begin();

      while (currX < w && i <= MAX_TICKS) {
        remainder = i % 10;

        if (remainder === 0) {
          c.moveTo(currX, h * 0.5);
          c.lineTo(currX, 0);
        } else if (remainder === 5) {
          c.moveTo(currX, h * 0.3);
          c.lineTo(currX, 0);
        } else {
          c.moveTo(currX, h * 0.2);
          c.lineTo(currX, 0);
        }

        currX = currX + unitSize;
        i = i + 1;
      }

      c.stroke();
    }
  }
}

/** mxgraph.mockup.misc.ruler2: 物差し (目盛りの間隔 dx。セルの値を単位として数を書く) (mxMockupMisc.js の mxShapeMockupRuler2) */
class Ruler2 extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _x?: any, _y?: any, w?: any, h?: any) {
    let remainder: any, unit: any, num: any;
    let facing = this.sv('rulerOrient', 'down');
    let fontColor = this.sc('fontColor', '#000000');
    let dx = this.sv('dx', '100');
    let unitSize = dx / 10;

    unitSize = Math.max(unitSize, 1);

    c.setFontColor(fontColor);

    let currX = unitSize;
    let i = 1;

    if (facing === 'down') {
      c.begin();

      while (currX < w && i <= MAX_TICKS) {
        remainder = i % 10;

        if (remainder === 0) {
          c.moveTo(currX, h - 10);
          c.lineTo(currX, h);

          unit = this.e.value;

          if (!isNaN(unit)) {
            c.stroke();

            num = (i * Math.round(100 * unit)) / 1000;

            if (i != 10 && num != 0) {
              c.text(currX, (h - 10) * 0.5, 0, 0, num.toString(), 'center', 'middle', 0, null, 0, 0, 0);
            }
            c.begin();
          }
        } else if (remainder === 5) {
          c.moveTo(currX, h - 6);
          c.lineTo(currX, h);
        } else {
          c.moveTo(currX, h - 4);
          c.lineTo(currX, h);
        }

        currX = currX + unitSize;
        i = i + 1;
      }

      c.stroke();
    } else if (facing === 'up') {
      c.begin();

      while (currX < w && i <= MAX_TICKS) {
        remainder = i % 10;

        if (remainder === 0) {
          c.moveTo(currX, 10);
          c.lineTo(currX, 0);

          unit = this.e.value;

          if (!isNaN(unit)) {
            c.stroke();

            num = (i * Math.round(100 * unit)) / 1000;

            if (i != 10 && num != 0) {
              c.text(currX, (h + 10) * 0.5, 0, 0, num.toString(), 'center', 'middle', 0, null, 0, 0, 0);
            }
            c.begin();
          }
        } else if (remainder === 5) {
          c.moveTo(currX, 6);
          c.lineTo(currX, 0);
        } else {
          c.moveTo(currX, 4);
          c.lineTo(currX, 0);
        }

        currX = currX + unitSize;
        i = i + 1;
      }

      c.stroke();
    }
  }
}

/** mxgraph.mockup.misc.revisionTable: 改訂の表 (mxMockupMisc.js の mxShapeMockupRevisionTable) */
class RevisionTable extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let mainText = this.sv('mainText', '').toString().split(',');
    let textColor = this.sc('textColor', '#999999');
    let textSize = this.sv('textSize', '17');

    c.begin();
    c.moveTo(0, h * 0.33);
    c.lineTo(w, h * 0.33);
    c.moveTo(0, h * 0.67);
    c.lineTo(w, h * 0.67);
    c.moveTo(w * 0.125, h * 0.33);
    c.lineTo(w * 0.125, h);
    c.moveTo(w * 0.5, h * 0.33);
    c.lineTo(w * 0.5, h);
    c.stroke();

    c.setFontSize(textSize);
    c.setFontColor(textColor);

    c.text(w * 0.5, h * 0.165, 0, 0, mainText[0], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.0625, h * 0.5, 0, 0, mainText[1], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.3125, h * 0.5, 0, 0, mainText[2], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.75, h * 0.5, 0, 0, mainText[3], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.0625, h * 0.835, 0, 0, mainText[4], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.3125, h * 0.835, 0, 0, mainText[5], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(w * 0.75, h * 0.835, 0, 0, mainText[6], 'center', 'middle', 0, null, 0, 0, 0);
  }
}

/** mxgraph.mockup.misc.statusBar: 状態の棒 (mxMockupMisc.js の mxShapeMockupStatusBar) */
class StatusBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    w = Math.max(w, 105);

    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, h * 0.5 - 15, w, 30);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let fillColor2 = this.sc('fillColor2', '#ddeeff');
    let strokeColor2 = this.sc('strokeColor2', '#008cff');
    let mainText = this.sv('mainText', '').toString().split(',');
    let textColor = this.sc('textColor', '#999999');
    let textSize = this.sv('textSize', '17');

    c.setFillColor(fillColor2);
    c.roundrect(5, h * 0.5 - 10, (w - 75) * 0.46, 20, 5, 5);
    c.fill();

    c.roundrect(10 + (w - 75) * 0.46, h * 0.5 - 10, (w - 75) * 0.23, 20, 5, 5);
    c.fill();
    c.roundrect(15 + (w - 75) * 0.69, h * 0.5 - 10, (w - 75) * 0.276, 20, 5, 5);
    c.fill();

    c.setFontSize(textSize);
    c.setFontColor(textColor);
    c.text(10, h * 0.5, 0, 0, mainText[0], 'left', 'middle', 0, null, 0, 0, 0);
    c.text(10 + (w - 75) * 0.575, h * 0.5, 0, 0, mainText[1], 'center', 'middle', 0, null, 0, 0, 0);
    c.text(15 + (w - 75) * 0.828, h * 0.5, 0, 0, mainText[2], 'center', 'middle', 0, null, 0, 0, 0);

    c.setStrokeColor(strokeColor2);
    c.ellipse(w - 25, h * 0.5 - 10, 20, 20);
    c.stroke();
    c.begin();
    c.moveTo(w - 55, h * 0.5 + 10);
    c.lineTo(w - 35, h * 0.5 + 10);
    c.stroke();
  }
}

/** mxgraph.mockup.misc.pin: 押しピンの印 (mxMockupMisc.js の mxShapeMockupPin) */
class Pin extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let fillColor2 = this.sc('fillColor2', '#000000');
    let fillColor3 = this.sc('fillColor3', '#000000');
    let strokeColor = this.sc('strokeColor', '#000000');
    c.setShadow(false);
    c.translate(x, y);

    c.setStrokeWidth(3);
    c.setStrokeColor('#666666');
    c.begin();
    c.moveTo(w * 0.5, h * 0.4);
    c.lineTo(w * 0.5, h);
    c.stroke();

    c.setStrokeWidth(2);
    c.setStrokeColor(strokeColor);
    c.setGradient(fillColor2, fillColor3, 0, 0, w, h * 0.4, 'south', 1, 1);
    c.setAlpha(0.9);
    c.ellipse(0, 0, w, h * 0.4);
    c.fillAndStroke();

    c.setFillColor('#ffffff');
    c.setAlpha(0.5);
    c.ellipse(w * 0.2, h * 0.08, w * 0.3, h * 0.12);
    c.fill();
  }
}

/** mxgraph.mockup.misc.rrect: 角の丸い四角 (rSize) (mxMockupMisc.js の mxShapeMockupMiscRRect) */
class MiscRRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

/** mxgraph.mockup.misc.anchor: 繋ぐ点だけの形 (何も描かない) (mxMockupMisc.js の mxShapeMockupMiscAnchor) */
class MiscAnchor extends Mock {
  paintVertexShape(_c: Canvas, _x: any, _y: any, _w: any, _h: any) {}
}

// ───────────── 文字 (draw.io の shapes/mockup/mxMockupText.js) ─────────────

/** mxgraph.mockup.text.link: 下線の付いたリンクの文字 (linkText) (mxMockupText.js の mxShapeMockupLink) */
class Link extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let linkText = this.sv('linkText', 'Link');
    let textSize = this.sv('textSize', '17');
    let textColor = this.sc('textColor', '#0000ff');

    c.translate(x, y);
    let width = sizeForString(linkText, textSize, 'Helvetica').width;
    c.setStrokeColor(textColor);
    c.setFontSize(textSize);
    c.setFontColor(textColor);

    c.text(w * 0.5, h * 0.5, 0, 0, linkText, 'center', 'middle', 0, null, 0, 0, 0);

    c.begin();
    c.moveTo(w * 0.5 - width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.lineTo(w * 0.5 + width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.stroke();
  }
}

/** mxgraph.mockup.text.linkBar: リンクの文字の並び (mainText を , で分ける) (mxMockupText.js の mxShapeMockupLinkBar) */
class LinkBar extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let i: any, buttonText: any, currW: any;
    let textStrings = this.sv('mainText', '+Button 1, Button 2, Button 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let selectedFontColor = this.sc('textColor2', '#ffffff');
    let fontSize = this.sv('textSize', '17').toString();
    let frameColor = this.sc('strokeColor', '#666666');
    let separatorColor = this.sc('strokeColor2', '#c4c4c4');
    let bgColor = this.sc('fillColor', '#ffffff');
    let selectedFillColor = this.sc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let selectedButton = -1;
    let rSize = 10;
    let labelOffset = 5;

    for (i = 0; i < buttonNum; i++) {
      buttonText = textStrings[i];

      if (buttonText.charAt(0) === '+') {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      currW = sizeForString(buttonText, fontSize, 'Helvetica').width;

      if (currW === 0) {
        buttonWidths[i] = 42;
      } else {
        buttonWidths[i] = currW;
      }

      buttonTotalWidth += buttonWidths[i];
    }

    let trueH = Math.max(h, fontSize * 1.5, 20);
    let minW = 2 * labelOffset * buttonNum + buttonTotalWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);
    this.background(c, trueW, trueH, rSize, buttonNum, buttonWidths, labelOffset, minW, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton);
    c.setShadow(false);

    let currWidth = 0;

    for (i = 0; i < buttonNum; i++) {
      if (i === selectedButton) {
        c.setFontColor(selectedFontColor);
        c.setStrokeColor(selectedFontColor);
      } else {
        c.setFontColor(fontColor);
        c.setStrokeColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  background(
    c: Canvas,
    w?: any,
    h?: any,
    _rSize?: any,
    buttonNum?: any,
    buttonWidths?: any,
    labelOffset?: any,
    minW?: any,
    frameColor?: any,
    separatorColor?: any,
    bgColor?: any,
    selectedFillColor?: any,
    selectedButton?: any,
  ) {
    let i: any, currWidth: any;
    c.begin();

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.rect(0, 0, w, h);
    c.fillAndStroke();

    c.setStrokeColor(separatorColor);
    c.begin();

    const pre3 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (i = 1; i < buttonNum; i++) {
      if (i !== selectedButton && i !== selectedButton + 1) {
        currWidth = pre3[i];

        currWidth = (currWidth * w) / minW;
        c.moveTo(currWidth, 0);
        c.lineTo(currWidth, h);
      }
    }

    c.stroke();

    let buttonLeft = 0;
    c.setFillColor(selectedFillColor);

    for (i = 0; i < selectedButton; i++) {
      buttonLeft += buttonWidths[i] + 2 * labelOffset;
    }

    buttonLeft = (buttonLeft * w) / minW;
    let buttonRight = ((buttonWidths[selectedButton] + 2 * labelOffset) * w) / minW;
    buttonRight += buttonLeft;

    if (selectedButton === 0) {
      c.rect(0, 0, buttonRight, h);
      c.fill();
    } else if (selectedButton === buttonNum - 1) {
      c.rect(buttonLeft, 0, buttonRight - buttonLeft, h);
      c.fill();
    } else if (selectedButton !== -1) {
      c.rect(buttonLeft, 0, buttonRight - buttonLeft, h);
      c.fill();
    }

    c.setStrokeColor(frameColor);
    c.setFillColor(bgColor);
    c.rect(0, 0, w, h);
    c.stroke();
  }
  buttonText(c: Canvas, w?: any, h?: any, textString?: any, buttonWidth?: any, fontSize?: any, minW?: any, trueW?: any) {
    if (textString.charAt(0) === '+') {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text(((w + buttonWidth * 0.5) * trueW) / minW, h * 0.5, 0, 0, textString, 'center', 'middle', 0, null, 0, 0, 0);

    let textW = sizeForString(textString, fontSize, 'Helvetica').width * 0.5;

    if (textString !== null && textString !== '') {
      c.begin();
      c.moveTo(((w + buttonWidth * 0.5) * trueW) / minW - textW, h * 0.5 + fontSize * 0.5);
      c.lineTo(((w + buttonWidth * 0.5) * trueW) / minW + textW, h * 0.5 + fontSize * 0.5);
      c.stroke();
    }
  }
}

/** mxgraph.mockup.text.callout: 吹き出しの線 (callStyle・callDir) (mxMockupText.js の mxShapeMockupCallout) */
class Callout extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let calloutText = this.sv('linkText', 'Callout');
    let textSize = this.sv('textSize', '17');
    let textColor = this.sc('textColor', '#666666');
    let callStyle = this.sv('callStyle', 'line');
    let callDir = this.sv('callDir', 'NW');
    let textWidth = sizeForString(calloutText, textSize, 'Helvetica').width;
    textWidth = textWidth * 1.2;

    if (textWidth == 0) {
      textWidth = 70;
    }

    c.translate(x, y);
    c.setFontSize(textSize);
    c.setFontColor(textColor);
    let callH = textSize * 1.5;

    if (callDir === 'NW') {
      if (callStyle === 'line') {
        c.begin();
        c.moveTo(0, callH);
        c.lineTo(textWidth, callH);
        c.lineTo(w, h);
        c.stroke();
      } else if (callStyle === 'rect') {
        c.rect(0, 0, textWidth, callH);
        c.fillAndStroke();
        c.begin();
        c.moveTo(textWidth * 0.5, callH);
        c.lineTo(w, h);
        c.stroke();
      } else if (callStyle === 'roundRect') {
        c.roundrect(0, 0, textWidth, callH, callH * 0.25, callH * 0.25);
        c.fillAndStroke();
        c.begin();
        c.moveTo(textWidth * 0.5, callH);
        c.lineTo(w, h);
        c.stroke();
      }

      c.text(textWidth * 0.5, callH * 0.5, 0, 0, calloutText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (callDir === 'NE') {
      if (callStyle === 'line') {
        c.begin();
        c.moveTo(w, callH);
        c.lineTo(w - textWidth, callH);
        c.lineTo(0, h);
        c.stroke();
      } else if (callStyle === 'rect') {
        c.rect(w - textWidth, 0, textWidth, callH);
        c.fillAndStroke();
        c.begin();
        c.moveTo(w - textWidth * 0.5, callH);
        c.lineTo(0, h);
        c.stroke();
      } else if (callStyle === 'roundRect') {
        c.roundrect(w - textWidth, 0, textWidth, callH, callH * 0.25, callH * 0.25);
        c.fillAndStroke();
        c.begin();
        c.moveTo(w - textWidth * 0.5, callH);
        c.lineTo(0, h);
        c.stroke();
      }

      c.text(w - textWidth * 0.5, callH * 0.5, 0, 0, calloutText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (callDir === 'SE') {
      if (callStyle === 'line') {
        c.begin();
        c.moveTo(w, h);
        c.lineTo(w - textWidth, h);
        c.lineTo(0, 0);
        c.stroke();
      } else if (callStyle === 'rect') {
        c.rect(w - textWidth, h - callH, textWidth, callH);
        c.fillAndStroke();
        c.begin();
        c.moveTo(w - textWidth * 0.5, h - callH);
        c.lineTo(0, 0);
        c.stroke();
      } else if (callStyle === 'roundRect') {
        c.roundrect(w - textWidth, h - callH, textWidth, callH, callH * 0.25, callH * 0.25);
        c.fillAndStroke();
        c.begin();
        c.moveTo(w - textWidth * 0.5, h - callH);
        c.lineTo(0, 0);
        c.stroke();
      }

      c.text(w - textWidth * 0.5, h - callH * 0.5, 0, 0, calloutText, 'center', 'middle', 0, null, 0, 0, 0);
    } else if (callDir === 'SW') {
      if (callStyle === 'line') {
        c.begin();
        c.moveTo(0, h);
        c.lineTo(textWidth, h);
        c.lineTo(w, 0);
        c.stroke();
      } else if (callStyle === 'rect') {
        c.rect(0, h - callH, textWidth, callH);
        c.fillAndStroke();
        c.begin();
        c.moveTo(textWidth * 0.5, h - callH);
        c.lineTo(w, 0);
        c.stroke();
      } else if (callStyle === 'roundRect') {
        c.roundrect(0, h - callH, textWidth, callH, callH * 0.25, callH * 0.25);
        c.fillAndStroke();
        c.begin();
        c.moveTo(textWidth * 0.5, h - callH);
        c.lineTo(w, 0);
        c.stroke();
      }

      c.text(textWidth * 0.5, h - callH * 0.5, 0, 0, calloutText, 'center', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.text.stickyNote: 付箋 (黄色の紙と、文字の行) (mxMockupText.js の mxShapeMockupStickyNote) */
class StickyNote extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.setFillColor('#ffffcc');
    c.begin();
    c.moveTo(w * 0.03, h * 0.07);
    c.lineTo(w * 0.89, h * 0.06);
    c.arcTo(2.81 * w, 2.92 * h, 1, 0, 0, w * 0.99, h * 0.98);
    c.lineTo(w * 0.09, h * 0.99);
    c.arcTo(2.81 * w, 2.92 * h, 1, 0, 1, w * 0.03, h * 0.07);
    c.close();
    c.fill();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let i: any;
    let mainText = this.sv('mainText', 'Note line 1,Note line 2,Note line 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666').toString();
    let fontSize = this.sv('textSize', '17').toString();

    c.setFillColor('#ff3300');
    c.begin();
    c.moveTo(w * 0.28, 0);
    c.lineTo(w * 0.59, 0);
    c.lineTo(w * 0.6, h * 0.12);
    c.lineTo(w * 0.28, h * 0.13);
    c.close();
    c.fill();

    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    let lineNum = mainText.length;
    let textH = lineNum * fontSize * 1.5;

    for (i = 0; i < mainText.length; i++) {
      c.text(w / 2, (h - textH) / 2 + i * fontSize * 1.5 + fontSize * 0.75, 0, 0, mainText[i], 'center', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.text.stickyNote2: 付箋 (紙と、上の留めテープ) (mxMockupText.js の mxShapeMockupStickyNote2) */
class StickyNote2 extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.begin();
    c.moveTo(w * 0.03, h * 0.07);
    c.lineTo(w * 0.89, h * 0.06);
    c.arcTo(2.81 * w, 2.92 * h, 1, 0, 0, w * 0.99, h * 0.98);
    c.lineTo(w * 0.09, h * 0.99);
    c.arcTo(2.81 * w, 2.92 * h, 1, 0, 1, w * 0.03, h * 0.07);
    c.close();
    c.fill();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let strokeColor = this.sc('strokeColor', '#000000');

    c.setFillColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.28, 0);
    c.lineTo(w * 0.59, 0);
    c.lineTo(w * 0.6, h * 0.12);
    c.lineTo(w * 0.28, h * 0.13);
    c.close();
    c.fill();
  }
}

/** mxgraph.mockup.text.bulletedList: 箇条書き (mainText を , で分ける。bulletStyle) (mxMockupText.js の mxShapeMockupBulletedList) */
class BulletedList extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, _h?: any) {
    let i: any, currText: any;
    let mainText = this.sv('mainText', 'Note line 1,Note line 2,Note line 3').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17');
    let bulletStyle = this.sv('bulletStyle', 'none');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    for (i = 0; i < mainText.length; i++) {
      currText = '';

      if (bulletStyle === 'number') {
        currText = i + 1 + ') ' + mainText[i];
      } else if (bulletStyle === 'hyphen') {
        currText = '- ' + mainText[i];
      } else if (bulletStyle === 'dot') {
        currText = String.fromCharCode(8226) + ' ' + mainText[i];
      } else {
        currText = '  ' + mainText[i];
      }

      c.text(10, i * fontSize * 1.5 + fontSize * 0.75, 0, 0, currText, 'left', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.text.textBox: 文字の欄 (mainText を , で分けて行に) (mxMockupText.js の mxShapeMockupTextBox) */
class TextBox extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, _w?: any, _h?: any) {
    let i: any;
    let mainText = this.sv('mainText', 'Note line 1').toString().split(',');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '17');

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    for (i = 0; i < mainText.length; i++) {
      c.text(5, i * fontSize * 1.5 + fontSize * 0.75, 0, 0, mainText[i], 'left', 'middle', 0, null, 0, 0, 0);
    }
  }
}

/** mxgraph.mockup.text.captcha: 画像認証の欄 (mxMockupText.js の mxShapeMockupCaptcha) */
class Captcha extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: Canvas, w?: any, h?: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: Canvas, w?: any, h?: any) {
    let mainText = this.sv('mainText', 'Note line 1');
    let fontColor = this.sc('textColor', '#666666');
    let fontSize = this.sv('textSize', '25');

    c.setFillColor('#88aaff');
    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.35, 0);
    c.lineTo(w * 0.55, h * 0.85);
    c.lineTo(w * 0.4, h * 0.75);
    c.close();
    c.fill();

    c.begin();
    c.moveTo(w * 0.7, h * 0.1);
    c.lineTo(w * 0.95, h * 0.23);
    c.lineTo(w, h * 0.4);
    c.lineTo(w, h * 0.9);
    c.lineTo(w, h);
    c.lineTo(w * 0.8, h);
    c.close();
    c.fill();

    c.setFontColor(fontColor);
    c.setFontSize(fontSize);

    c.text(w * 0.5, h * 0.5, 0, 0, mainText, 'center', 'middle', 0, null, 0, 0, 0);

    c.rect(0, 0, w, h);
    c.stroke();
  }
}

/** mxgraph.mockup.text.alphanumeric: 英数字の並びの文字 (下線付き) (mxMockupText.js の mxShapeMockupAlphanumeric) */
class Alphanumeric extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    let mainText = this.sv('linkText', '0-9 A B C D E F G H I J K L M N O P Q R S T U V X Y Z');
    let textSize = this.sv('textSize', '17');
    let textColor = this.sc('textColor', '#0000ff');

    c.translate(x, y);
    let width = sizeForString(mainText, textSize, 'Helvetica').width;
    c.setStrokeColor(textColor);
    c.setFontSize(textSize);
    c.setFontColor(textColor);
    c.text(w * 0.5, h * 0.5, 0, 0, mainText, 'center', 'middle', 0, null, 0, 0, 0);
    c.begin();
    c.moveTo(w * 0.5 - width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.lineTo(w * 0.5 + width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.stroke();
  }
}

/** mxgraph.mockup.text.rrect: 角の丸い四角 (rSize) (mxMockupText.js の mxShapeMockupTextRRect) */
class TextRRect extends Mock {
  paintVertexShape(c: Canvas, x: any, y: any, w: any, h: any) {
    c.translate(x, y);

    let rSize = parseInt(this.sv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize);
    c.fillAndStroke();
  }
}

export const SHAPES_MOCKUP: Record<string, ShapePainter> = {
  'mxgraph.mockup.buttons.multiButton': run(MultiButton),
  'mxgraph.mockup.buttons.button': run(Button),
  'mxgraph.mockup.buttons.horButtonBar': run(HorButtonBar),
  'mxgraph.mockup.buttons.verButtonBar': run(VerButtonBar),
  'mxgraph.mockup.buttons.onOffButton': run(OnOffButton),
  'mxgraph.mockup.rrect': run(RRect),
  'mxgraph.mockup.anchor': run(Anchor),
  'mxgraph.mockup.topButton': run(TopButton),
  'mxgraph.mockup.bottomButton': run(BottomButton),
  'mxgraph.mockup.rightButton': run(RightButton),
  'mxgraph.mockup.leftButton': run(LeftButton),
  'mxgraph.mockup.containers.videoPlayer': run(VideoPlayer),
  'mxgraph.mockup.containers.accordion': run(Accordion),
  'mxgraph.mockup.containers.browserWindow': run(BrowserWindow),
  'mxgraph.mockup.containers.userMale': run(UserMale),
  'mxgraph.mockup.containers.userFemale': run(UserFemale),
  'mxgraph.mockup.containers.group': run(Group),
  'mxgraph.mockup.containers.window': run(Window),
  'mxgraph.mockup.containers.horTabBar': run(HorTabBar),
  'mxgraph.mockup.containers.verTabBar': run(VerTabBar),
  'mxgraph.mockup.containers.alertBox': run(AlertBox),
  'mxgraph.mockup.containers.rrect': run(ContainersRRect),
  'mxgraph.mockup.containers.anchor': run(ContainersAnchor),
  'mxgraph.mockup.containers.topButton': run(ContrainersTopButton),
  'mxgraph.mockup.containers.leftButton': run(ContainersLeftButton),
  'mxgraph.mockup.containers.marginRect': run(ContainersMarginRect),
  'mxgraph.mockup.containers.marginRect2': run(ContainersMarginRect2),
  'mxgraph.mockup.forms.checkboxGroup': run(CheckboxGroup),
  'mxgraph.mockup.forms.radioGroup': run(RadioGroup),
  'mxgraph.mockup.forms.colorPicker': run(ColorPicker),
  'mxgraph.mockup.forms.comboBox': run(ComboBox),
  'mxgraph.mockup.forms.spinner': run(Spinner),
  'mxgraph.mockup.forms.menuBar': run(MenuBar),
  'mxgraph.mockup.forms.horSlider': run(HorSlider),
  'mxgraph.mockup.forms.listBox': run(ListBox),
  'mxgraph.mockup.forms.pwField': run(PwField),
  'mxgraph.mockup.forms.splitter': run(Splitter),
  'mxgraph.mockup.forms.wedgeBar': run(WedgeBar),
  'mxgraph.mockup.forms.searchBox': run(SearchBox),
  'mxgraph.mockup.forms.signIn': run(SignIn),
  'mxgraph.mockup.forms.calendar': run(Calendar),
  'mxgraph.mockup.forms.emailForm': run(EmailForm),
  'mxgraph.mockup.forms.rrect': run(FormsRRect),
  'mxgraph.mockup.forms.anchor': run(FormsAnchor),
  'mxgraph.mockup.forms.checkbox': run(FormsCheckbox),
  'mxgraph.mockup.forms.uRect': run(FormsURect),
  'mxgraph.mockup.graphics.barChart': run(BarChart),
  'mxgraph.mockup.graphics.columnChart': run(ColumnChart),
  'mxgraph.mockup.graphics.lineChart': run(LineChart),
  'mxgraph.mockup.graphics.pieChart': run(PieChart),
  'mxgraph.mockup.graphics.iconGrid': run(IconGrid),
  'mxgraph.mockup.graphics.bubbleChart': run(BubbleChart),
  'mxgraph.mockup.graphics.gauge': run(Gauge),
  'mxgraph.mockup.graphics.plotChart': run(PlotChart),
  'mxgraph.mockup.graphics.ganttChart': run(GanttChart),
  'mxgraph.mockup.graphics.simpleIcon': run(SimpleIcon),
  'mxgraph.mockup.graphics.anchor': run(GraphicsAnchor),
  'mxgraph.mockup.graphics.rrect': run(GraphicsRRect),
  'mxgraph.mockup.misc.playbackControls': run(PlaybackControls),
  'mxgraph.mockup.misc.progressBar': run(ProgressBar),
  'mxgraph.mockup.misc.shoppingCart': run(ShoppingCart),
  'mxgraph.mockup.misc.rating': run(Rating),
  'mxgraph.mockup.misc.mail2': run(Mail),
  'mxgraph.mockup.misc.volumeSlider': run(VolumeSlider),
  'mxgraph.mockup.misc.editIcon': run(Edit),
  'mxgraph.mockup.misc.printIcon': run(Print),
  'mxgraph.mockup.misc.shareIcon': run(Share),
  'mxgraph.mockup.misc.trashcanIcon': run(Trashcan),
  'mxgraph.mockup.misc.copyrightIcon': run(Copyright),
  'mxgraph.mockup.misc.registeredIcon': run(Registered),
  'mxgraph.mockup.misc.volumeIcon': run(Volume),
  'mxgraph.mockup.misc.ruler': run(Ruler),
  'mxgraph.mockup.misc.ruler2': run(Ruler2),
  'mxgraph.mockup.misc.revisionTable': run(RevisionTable),
  'mxgraph.mockup.misc.statusBar': run(StatusBar),
  'mxgraph.mockup.misc.pin': run(Pin),
  'mxgraph.mockup.misc.rrect': run(MiscRRect),
  'mxgraph.mockup.misc.anchor': run(MiscAnchor),
  'mxgraph.mockup.text.link': run(Link),
  'mxgraph.mockup.text.linkBar': run(LinkBar),
  'mxgraph.mockup.text.callout': run(Callout),
  'mxgraph.mockup.text.stickyNote': run(StickyNote),
  'mxgraph.mockup.text.stickyNote2': run(StickyNote2),
  'mxgraph.mockup.text.bulletedList': run(BulletedList),
  'mxgraph.mockup.text.textBox': run(TextBox),
  'mxgraph.mockup.text.captcha': run(Captcha),
  'mxgraph.mockup.text.alphanumeric': run(Alphanumeric),
  'mxgraph.mockup.text.rrect': run(TextRRect),
};
