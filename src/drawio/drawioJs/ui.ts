/**
 * drawioJs/ui — draw.io の JavaScript で書かれた画面の部品の形 (iOS 7・ラック・Android・Bootstrap・Google Material Design Lite) を、
 * drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/ の下の
 * ios7/mxIOS7Ui.js・rack/mxRack.js・mxAndroid.js・mxBootstrap.js・mxGmdl.js の各形の paintVertexShape と、
 * それが呼ぶ background・foreground・sideText などの関数 (既定の値は、ソースの mxUtils.getValue の既定と、形の初期の値 (this.dx など))。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移し、向き・反転を済ませるので、ソースの paintVertexShape(c, x, y, w, h) の x・y は 0 として書く。
 * 接続点 (getConstraints)・つまみ (handleFactory)・customProperties の画面の部分・影は移植しない。
 *
 * mxGraph の決まりで、ソースと読み方を合わせたところ:
 * - スタイルの値は、数に読める字なら数、ほかは字 (mxStylesheet.getCellStyle)。JavaScript の真偽で読む値は jsTrue で読む。
 * - roundrect の角の半径は SVG の rect の rx・ry (片方だけなら、もう片方も同じ。mxSvgCanvas2D.roundrect)。
 * - 文字の幅 (mxUtils.getSizeForString) は、Helvetica の字の幅の表で見積もる (ブラウザで測らない)
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxStylesheet.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/ios7/mxIOS7Ui.js: Copyright (c) 2006-2013, JGraph Ltd
 *   shapes/mxAndroid.js: Copyright (c) 2006-2013, JGraph Ltd
 *   shapes/mxBootstrap.js: Copyright (c) 2006-2014, JGraph Ltd
 *   shapes/mxGmdl.js: Copyright (c) 2006-2015, JGraph Ltd
 *   shapes/rack/mxRack.js: Copyright (c) 2006-2013, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';
import { prefixSums } from '../prefixSums';

// ───────────── 共通の道具 ─────────────

/** mxConstants.FONT_BOLD */
const BOLD = 1;

/** 数 (parseFloat(mxUtils.getValue(style, k, d)))。読めなければ d */
const nm = (e: ShapeEnv, k: string, d: number) => e.num(k, d);

/** parseInt(mxUtils.getValue(style, k, d)) (小数は切り捨て。読めなければ d) */
const int = (e: ShapeEnv, k: string, d: number) => {
  const n = parseInt(e.str(k, String(d)), 10);
  return Number.isFinite(n) ? n : d;
};

/** スタイルの値を JavaScript の真偽で読む (数に読める字は 0 以外が真、ほかの字は空でなければ真。無ければ d) */
const jsTrue = (e: ShapeEnv, k: string, d: boolean) => {
  const v = e.str(k, '');
  if (v === '') return d;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
};

/** スタイルの値 == true (数の 1 だけが真。字の 'true' は偽。無ければ d) */
const looseTrue = (e: ShapeEnv, k: string, d: boolean) => {
  const v = e.str(k, '');
  if (v === '') return d;
  return Number(v) === 1;
};

/**
 * 色 (mxUtils.getValue(style, k, d)。none は塗らない)。fillColor・strokeColor は、draw.io では既定のスタイルから必ず値があり、
 * ソースの既定の値は使われないので、スタイルに無ければ形の塗りと線の色 (呼ぶ側が既定のスタイルから決めた色) にする
 */
const col = (e: ShapeEnv, k: string, d: string | undefined) => e.color(k, k === 'fillColor' ? e.fill : k === 'strokeColor' ? e.stroke : d);

/** mxSvgCanvas2D.roundrect: SVG の rect の rx・ry (0 より大きい方だけ書き、片方だけなら、もう片方も同じ) */
const rr = (c: ShapeCanvas, x: number, y: number, w: number, h: number, dx: number, dy?: number) => {
  const rx = dx > 0 ? dx : undefined;
  const ry = dy !== undefined && dy > 0 ? dy : undefined;
  if (rx === undefined && ry === undefined) c.rect(x, y, w, h);
  else c.roundrect(x, y, w, h, rx ?? ry!, ry ?? rx!);
};

/** Helvetica の字の幅 (1000 分の 1 em。空白 (32) から ~ (126) まで) */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** mxUtils.getSizeForString(str, size, Helvetica).width の見積もり (表に無い字は、全角なら 1 em、ほかは 0.556 em) */
export const textWidth = (str: string, size: number) => {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) w += HELV[code - 32];
    else w += code >= 0x1100 ? 1000 : 556;
  }
  return (w * size) / 1000;
};

/** 点 (x, y) を真ん中にして文字を置く (c.text(x, y, 0, 0, str, align, middle)) */
const label = (c: ShapeCanvas, x: number, y: number, str: string, align = 'center') => c.text(x, y, 0, 0, str, align, 'middle');

/** 四角を塗るだけ (c.rect(0, 0, w, h); c.fill()) */
const fillBox = (c: ShapeCanvas, w: number, h: number) => {
  c.rect(0, 0, w, h);
  c.fill();
};

/** 縁の上下の線 (horLines: 塗った四角と、上と下の辺) */
const horLines: ShapePainter = (c, w, h) => {
  fillBox(c, w, h);
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.moveTo(0, h);
  c.lineTo(w, h);
  c.stroke();
};

/** 角の半径 rSize (既定 10) の角丸の四角 (rrect) */
const rrect: ShapePainter = (c, w, h, e) => {
  const r = int(e, 'rSize', 10);
  rr(c, 0, 0, w, h, r);
  c.fillAndStroke();
};

/** 何も描かない (anchor: 接続のための見えない形) */
const nothing: ShapePainter = () => {};

/** 縦の電話 (iOS 7・Android の phone: 角の半径 25 の本体・画面・受話口・カメラ・ボタン) */
const phone: ShapePainter = (c, w, h) => {
  rr(c, 0, 0, w, h, 25, 25);
  c.fillAndStroke();
  c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
  c.stroke();
  c.ellipse(w * 0.4875, h * 0.04125, w * 0.025, h * 0.0125);
  c.stroke();
  rr(c, w * 0.375, h * 0.075, w * 0.25, h * 0.01875, w * 0.02, h * 0.01);
  c.stroke();
  c.ellipse(w * 0.4, h * 0.875, w * 0.2, h * 0.1);
  c.stroke();
  rr(c, w * 0.4575, h * 0.905, w * 0.085, h * 0.04375, h * 0.00625, h * 0.00625);
  c.stroke();
};

/** 余白を取った四角 (marginRect: rectMargin と上下左右の余白。round なら角の半径 rx・ry) */
const marginRect =
  (round: boolean): ShapePainter =>
  (c, w, h, e) => {
    const margin = nm(e, 'rectMargin', 0);
    const x1 = margin + nm(e, 'rectMarginLeft', 0);
    const y1 = margin + nm(e, 'rectMarginTop', 0);
    const w1 = w - nm(e, 'rectMarginRight', 0) - x1 - margin;
    const h1 = h - nm(e, 'rectMarginBottom', 0) - y1 - margin;
    if (w1 > 0 && h1 > 0) {
      c.begin();
      if (round) rr(c, x1, y1, w1, h1, nm(e, 'rx', 0), nm(e, 'ry', 0));
      else c.rect(x1, y1, w1, h1);
      c.fillAndStroke();
    }
  };

/** 片側だけ角を丸めたボタン (leftButton・rightButton・topButton・bottomButton。ソースの経路の点の並び) */
type Side = 'left' | 'right' | 'top' | 'bottom';
const sideButton =
  (side: Side, bottomSweep: 0 | 1): ShapePainter =>
  (c, w, h, e) => {
    const r = int(e, 'rSize', 10);
    c.begin();
    if (side === 'left') {
      c.moveTo(w, 0);
      c.lineTo(w, h);
      c.lineTo(r, h);
      c.arcTo(r, r, 0, 0, 1, 0, h - r);
      c.lineTo(0, r);
      c.arcTo(r, r, 0, 0, 1, r, 0);
    } else if (side === 'right') {
      c.moveTo(0, 0);
      c.lineTo(w - r, 0);
      c.arcTo(r, r, 0, 0, 1, w, r);
      c.lineTo(w, h - r);
      c.arcTo(r, r, 0, 0, 1, w - r, h);
      c.lineTo(0, h);
    } else if (side === 'top') {
      c.moveTo(w, h);
      c.lineTo(0, h);
      c.lineTo(0, r);
      c.arcTo(r, r, 0, 0, 1, r, 0);
      c.lineTo(w - r, 0);
      c.arcTo(r, r, 0, 0, 1, w, r);
    } else if (bottomSweep === 0) {
      // iOS 7 の bottomButton (右上から左へ回る)
      c.moveTo(w, 0);
      c.lineTo(0, 0);
      c.lineTo(0, h - r);
      c.arcTo(r, r, 0, 0, 0, r, h);
      c.lineTo(w - r, h);
      c.arcTo(r, r, 0, 0, 0, w, h - r);
    } else {
      // Bootstrap の bottomButton (左上から右へ回る)
      c.moveTo(0, 0);
      c.lineTo(w, 0);
      c.lineTo(w, h - r);
      c.arcTo(r, r, 0, 0, 1, w - r, h);
      c.lineTo(r, h);
      c.arcTo(r, r, 0, 0, 1, 0, h - r);
    }
    c.close();
    c.fillAndStroke();
  };

/** 文字の並びのボタン (iOS 7 の horButtonBar・Android の tabBar) の、各ボタンの文字と幅。'+' で始まる字が選んだボタン */
const buttonsOf = (texts: string[], size: number) => {
  let selected = -1;
  const widths = texts.map((t, i) => {
    let s = t;
    if (s.charAt(0) === '+') {
      s = s.substring(1);
      selected = i;
    }
    return textWidth(s, size);
  });
  return { selected, widths, total: widths.reduce((a, b) => a + b, 0) };
};

/**
 * 繰り返しで描く部分 (アイコン・区切りの線・ラックの番号と溝・縞・評価の印) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値や 0 の間隔で描き終わらないのを防ぐため、上限までは描いて、そこで止める。ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_ICONS = 1000;
const MAX_LINES = 10000;
const MAX_UNITS = 1000;
const MAX_STRIPES = 1000;

// ───────────── iOS 7 (draw.io の shapes/ios7/mxIOS7Ui.js) ─────────────

const ios7AppBar: ShapePainter = (c, w, h, e) => {
  // 塗った帯に、左の 5 つの点・電波の扇・右の電池
  fillBox(c, w, h);
  c.setFillColor(col(e, 'fillColor2', '#222222'));
  for (const x of [5, 9, 13, 17, 21]) {
    c.ellipse(x, h * 0.5 - 1.5, 3, 3);
    c.fill();
  }
  c.ellipse(54, h * 0.5 + 2, 2, 2);
  c.fillAndStroke();
  c.setStrokeWidth(2);
  c.begin();
  c.moveTo(52, h * 0.5 + 1);
  c.arcTo(3.5, 3.5, 0, 0, 1, 58, h * 0.5 + 1);
  c.stroke();
  c.begin();
  c.moveTo(50, h * 0.5 - 1);
  c.arcTo(6, 6, 0, 0, 1, 60, h * 0.5 - 1);
  c.stroke();
  c.begin();
  c.moveTo(w - 19, h * 0.5 - 2);
  c.lineTo(w - 6, h * 0.5 - 2);
  c.lineTo(w - 6, h * 0.5 + 2);
  c.lineTo(w - 19, h * 0.5 + 2);
  c.close();
  c.fill();
  c.setStrokeWidth(1);
  c.begin();
  c.moveTo(w - 44, h * 0.5 - 2.5);
  c.lineTo(w - 36, h * 0.5 + 2.5);
  c.lineTo(w - 40, h * 0.5 + 5);
  c.lineTo(w - 40, h * 0.5 - 5);
  c.lineTo(w - 36, h * 0.5 - 2.5);
  c.lineTo(w - 44, h * 0.5 + 2.5);
  c.stroke();
  c.begin();
  c.moveTo(w - 20, h * 0.5 - 3);
  c.lineTo(w - 5, h * 0.5 - 3);
  c.lineTo(w - 5, h * 0.5 - 1);
  c.lineTo(w - 3.5, h * 0.5 - 1);
  c.lineTo(w - 3.5, h * 0.5 + 1);
  c.lineTo(w - 5, h * 0.5 + 1);
  c.lineTo(w - 5, h * 0.5 + 3);
  c.lineTo(w - 20, h * 0.5 + 3);
  c.close();
  c.stroke();
};

const ios7OnOffButton: ShapePainter = (c, w0, h, e) => {
  // 幅は高さの 2 倍以上。buttonState (既定 on) が on なら右に白い丸、off なら strokeColor2・fillColor2 の枠と左の丸の輪郭
  const w = Math.max(w0, 2 * h);
  const state = e.str('buttonState', 'on');
  if (state === 'on') {
    rr(c, 0, 0, w, h, h * 0.5, h * 0.5);
    c.fillAndStroke();
  } else if (state === 'off') {
    c.setStrokeColor(col(e, 'strokeColor2', '#aaaaaa'));
    c.setFillColor(col(e, 'fillColor2', '#ffffff'));
    rr(c, 0, 0, w, h, h * 0.5, h * 0.5);
    c.fillAndStroke();
  }
  c.setFillColor('#ffffff');
  if (state === 'on') {
    c.ellipse(w - h + 1, 1, h - 2, h - 2);
    c.fill();
  } else {
    c.ellipse(0, 0, h, h);
    c.stroke();
  }
};

const ios7Slider: ShapePainter = (c, w, h, e) => {
  // mxShapeIOS7Slider2 (同じ名前で後から登録した方): 灰色 (#bbbbbb) の線、barPos (%) までの線、つまみの丸
  const hSize = nm(e, 'handleSize', 10);
  const barPos = Math.max(0, Math.min(1, nm(e, 'barPos', 40) / 100));
  c.save();
  c.setStrokeColor('#bbbbbb');
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.fillAndStroke();
  c.restore();
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(barPos * w, h * 0.5);
  c.fillAndStroke();
  c.setStrokeColor('#bbbbbb');
  c.begin();
  c.ellipse(barPos * w - hSize * 0.5, h * 0.5 - hSize * 0.5, hSize, hSize);
  c.fillAndStroke();
};

const ios7DownloadBar: ShapePainter = (c, w, h, e) => {
  // 上に buttonText (太字)、真ん中に塗りの色の線と、barPos (%) までの線の色の線
  c.setFontStyle(BOLD);
  label(c, w * 0.5, h * 0.2, e.str('buttonText', ''));
  const barPos = Math.max(0, Math.min(100, nm(e, 'barPos', 80)));
  const truePos = (w * barPos) / 100;
  c.setStrokeWidth(2);
  c.setStrokeColor(col(e, 'fillColor', ''));
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.stroke();
  c.setStrokeColor(col(e, 'strokeColor', ''));
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(truePos, h * 0.5);
  c.stroke();
};

const ios7Icon: ShapePainter = (c, w, h, e) => {
  // #00D0F0 から #0080F0 へのグラデーションの角丸の四角と、白い太字の buttonText
  c.setGradient('#00D0F0', '#0080F0', 'south');
  rr(c, 0, 0, w, h, w * 0.1, h * 0.1);
  c.fill();
  c.setFontColor('#ffffff');
  c.setFontStyle(BOLD);
  c.setFontSize(8);
  label(c, w * 0.5, h * 0.5, e.str('buttonText', ''));
};

const ios7HorButtonBar: ShapePainter = (c, w, h, e) => {
  const texts = e.str('buttonText', '+Button 1, Button 2, Button 3').split(',');
  // ソースは mxIOS7C.STYLE_TEXTCOLOR (textColor)・STYLE_TEXTCOLOR2 (textColor2) を読む
  const fontColor = e.str('textColor', '#666666');
  const selectedFontColor = e.str('textColor2', '#ffffff');
  const fontSize = nm(e, 'fontSize', 8.5);
  const frameColor = col(e, 'strokeColor', '#666666');
  const bgColor = col(e, 'fillColor', '#ffffff');
  const n = texts.length;
  const { selected, widths, total } = buttonsOf(texts, fontSize);
  const rSize = 2.5;
  const labelOffset = 2.5;
  const trueH = Math.max(h, fontSize * 1.5, 10);
  const minW = 2 * labelOffset * n + total;
  const trueW = Math.max(w, minW);
  const W = trueW;
  const H = trueH;
  const frame = () => {
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(W - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, W, rSize);
    c.lineTo(W, H - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, W - rSize, H);
    c.lineTo(rSize, H);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, H - rSize);
    c.close();
  };
  // background: 枠・区切りの線・選んだボタン・枠をもう一度
  c.setStrokeColor(frameColor);
  c.setFillColor(bgColor);
  frame();
  c.fillAndStroke();
  c.setStrokeColor(frameColor);
  c.begin();
  const pre0 = prefixSums(widths.length, (j) => widths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
  for (let i = 1; i < n; i++) {
    if (i !== selected && i !== selected + 1) {
      let x = pre0[i];
      x = (x * W) / minW;
      c.moveTo(x, 0);
      c.lineTo(x, H);
    }
  }
  c.stroke();
  let left = 0;
  c.setStrokeColor('none');
  for (let i = 0; i < selected; i++) left += widths[i] + 2 * labelOffset;
  left = (left * W) / minW;
  const right = selected >= 0 ? left + ((widths[selected] + 2 * labelOffset) * W) / minW : 0;
  c.setFillColor('#0080F0');
  if (selected === 0) {
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(right, 0);
    c.lineTo(right, H);
    c.lineTo(rSize, H);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, H - rSize);
    c.close();
    c.fill();
  } else if (selected === n - 1) {
    c.begin();
    c.moveTo(left, 0);
    c.lineTo(right - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, right, rSize);
    c.lineTo(right, H - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, right - rSize, H);
    c.lineTo(left, H);
    c.close();
    c.fill();
  } else if (selected !== -1) {
    c.begin();
    c.moveTo(left, 0);
    c.lineTo(right, 0);
    c.lineTo(right, H);
    c.lineTo(left, H);
    c.close();
    c.fill();
  }
  c.setStrokeColor(frameColor);
  c.setFillColor(bgColor);
  frame();
  c.stroke();
  // 文字
  let x = 0;
  for (let i = 0; i < n; i++) {
    c.setFontColor(i === selected ? selectedFontColor : fontColor);
    x += labelOffset;
    const t = texts[i].charAt(0) === '+' ? texts[i].substring(1) : texts[i];
    c.begin();
    c.setFontSize(fontSize);
    label(c, ((x + widths[i] * 0.5) * trueW) / minW, trueH * 0.5, t);
    x += widths[i] + labelOffset;
  }
};

const ios7PageControl: ShapePainter = (c, w, h, e) => {
  // 線の色の 4 つの点と、塗りの色の右端の点
  const fillColor = col(e, 'fillColor', '#000000');
  const strokeColor = col(e, 'strokeColor', '#000000');
  const r = Math.min(h * 0.5, w * 0.05);
  c.setFillColor(strokeColor);
  for (const x of [0, w * 0.25 - r * 0.5, w * 0.5 - r, w * 0.75 - r * 1.5]) {
    c.ellipse(x, h * 0.5 - r, 2 * r, 2 * r);
    c.fill();
  }
  c.setFillColor(fillColor);
  c.ellipse(w - 2 * r, h * 0.5 - r, 2 * r, 2 * r);
  c.fill();
};

const ios7IconGrid: ShapePainter = (c, w, h, e) => {
  // gridSize (既定 4,7) の升目に四角を並べる
  let g: string[];
  try {
    g = decodeURIComponent(e.str('gridSize', '4,7')).split(',');
  } catch {
    // ソースの decodeURIComponent は、読めない % の書き方で例外を投げ、四角を 1 つも描かない
    return;
  }
  const gx = parseInt(g[0], 10);
  const gy = parseInt(g[1], 10);
  const bx = w / (gx + (Number(g[0]) - 1) * 0.1);
  const by = h / (gy + (Number(g[1]) - 1) * 0.1);
  // アイコンは、列も合わせた数も MAX_ICONS 個まで (Kumiori の守り)
  for (let i = 0, n = 0; i < Number(g[0]) && i < MAX_ICONS; i++) {
    for (let j = 0; j < Number(g[1]) && n < MAX_ICONS; j++, n++) {
      c.rect(bx * 1.1 * i, by * 1.1 * j, bx, by);
      c.fill();
    }
  }
};

const ios7SearchBox: ShapePainter = (c, w, h, e) => {
  fillBox(c, w, h);
  const r = Math.min(w, h) * 0.1;
  c.setFillColor('#ffffff');
  rr(c, w * 0.05, h * 0.15, w * 0.5, h * 0.7, r, r);
  c.fillAndStroke();
  c.setFontColor(e.str('textColor', '#666666'));
  c.setFontSize(Math.min(h * 0.7, w * 0.1));
  label(c, 5, h * 0.5, e.str('buttonText', 'Search'), 'left');
  c.setStrokeColor(col(e, 'strokeColor2', '#008cff'));
  c.ellipse(w * 0.05 + 3, h * 0.5 - 3, 4, 4);
  c.stroke();
  c.begin();
  c.moveTo(w * 0.05 + 8, h * 0.5 + 3.5);
  c.lineTo(w * 0.05 + 6, h * 0.5 + 0.5);
  c.stroke();
};

const ios7Url: ShapePainter = (c, w, h, e) => {
  fillBox(c, w, h);
  const r = Math.min(w, h) * 0.1;
  const strokeColor2 = col(e, 'strokeColor2', '#008cff');
  c.setFillColor('#d8d8d8');
  rr(c, w * 0.05, h * 0.15, w * 0.9, h * 0.7, r, r);
  c.fill();
  c.setFontColor(e.str('textColor', '#666666'));
  c.setFontSize(Math.min(h * 0.7, w * 0.1));
  label(c, w * 0.5, h * 0.5, e.str('buttonText', 'draw.io'), 'left');
  c.setStrokeColor(strokeColor2);
  c.begin();
  c.moveTo(w * 0.95 - 5, h * 0.5);
  c.arcTo(3, 3, 0, 1, 1, w * 0.95 - 8, h * 0.5 - 3);
  c.stroke();
  c.setFillColor(strokeColor2);
  c.begin();
  c.moveTo(w * 0.95 - 8, h * 0.5 - 4);
  c.lineTo(w * 0.95 - 6, h * 0.5 - 3);
  c.lineTo(w * 0.95 - 8, h * 0.5 - 2);
  c.close();
  c.fillAndStroke();
};

const ios7ActionDialog: ShapePainter = (c, w, h, e) => {
  const mainText = e.str('mainText', 'Main Text');
  const subText = e.str('subText', 'Sub Text');
  const fontColor = e.str('textColor', '#666666');
  const fontSize = nm(e, 'textSize', 17);
  fillBox(c, w, h);
  c.setFillColor('#e0e0e0');
  rr(c, w * 0.05, h * 0.1, w * 0.9, h * 0.35, w * 0.025, h * 0.05);
  c.fill();
  rr(c, w * 0.05, h * 0.55, w * 0.9, h * 0.35, w * 0.025, h * 0.05);
  c.fill();
  c.setFontStyle(BOLD);
  c.begin();
  c.setFontSize(fontSize);
  c.setFontColor(fontColor);
  label(c, w * 0.5, h * 0.4, mainText);
  c.begin();
  c.setFontSize(fontSize / 1.4);
  label(c, w * 0.5, h * 0.7, subText);
};

const ios7Callout: ShapePainter = (c, w, h) => {
  // 左下に尾の付いた吹き出し (幅 30・高さ 20 以上のときだけ)
  const r = 10;
  if (w >= 30 && h >= 20) {
    c.begin();
    c.moveTo(15, h - r * 0.3);
    c.arcTo(r * 2, r, 0, 0, 1, 0, h);
    c.arcTo(r * 1.5, r * 1.5, 0, 0, 0, 10, h - r);
    c.lineTo(r, r);
    c.arcTo(r, r, 0, 0, 1, r * 2, 0);
    c.lineTo(w - r, 0);
    c.arcTo(r, r, 0, 0, 1, w, r);
    c.lineTo(w, h - r);
    c.arcTo(r, r, 0, 0, 1, w - r, h);
    c.lineTo(r * 2, h);
    c.arcTo(r, r, 0, 0, 1, r * 1.5, h - r * 0.3);
    c.close();
    c.fillAndStroke();
  }
};

const ios7SelectBar: ShapePainter = (c, w, h, e) => {
  // 下に尖りの付いた角丸の帯・右の区切り・dx2 ごとの区切り・右の三角 (既定は形の初期の値 dx 0.5・dx2 70・size 10・dy 0.5)
  let dx = Math.max(0, Math.min(w, nm(e, 'dx', 0.5)));
  const dx2 = Math.max(0, Math.min(w, nm(e, 'dx2', 70)));
  let r = Math.max(0, Math.min(h, nm(e, 'size', 10)));
  const dy = Math.max(0, Math.min(h, (w - Math.max(20, r) - r) / 2, nm(e, 'dy', 0.5)));
  r = Math.min(h / 2, w / 2, r);
  dx = Math.max(r + dy, dx);
  dx = Math.min(w - r - dy, w - 20 - dy, dx);
  c.begin();
  c.moveTo(dx - dy, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h - r);
  c.lineTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(dx + dy, h);
  c.lineTo(dx, h + dy);
  c.close();
  c.fillAndStroke();
  const edge = w - Math.max(20, r);
  c.begin();
  c.moveTo(edge, 0);
  c.lineTo(edge, h);
  c.stroke();
  c.begin();
  // dx2 ごとの区切りは MAX_LINES 本まで (Kumiori の守り。dx2 が 0 だと、x = 0 の線が尽きない)
  for (let x = dx2, n = 0; x < edge && n < MAX_LINES; x += dx2, n++) {
    c.moveTo(x, 0);
    c.lineTo(x, h);
  }
  c.stroke();
  const w1 = Math.min(Math.max(20, r), h);
  const x1 = w - w1 * 0.5;
  const y1 = h * 0.5;
  c.setFillColor(col(e, 'strokeColor', ''));
  c.begin();
  c.moveTo(x1 - w1 * 0.15, y1 - w1 * 0.225);
  c.lineTo(x1 + w1 * 0.25, y1);
  c.lineTo(x1 - w1 * 0.15, y1 + w1 * 0.225);
  c.close();
  c.fill();
};

// ───────────── ラック (draw.io の shapes/rack/mxRack.js) ─────────────

/** 枠の上下の帯 (21)・左右の柱 (9)・四隅のねじの丸 (ラックの棚) */
const rackFrame = (c: ShapeCanvas, w: number, h: number) => {
  c.rect(0, 0, w, 21);
  c.fillAndStroke();
  c.rect(0, h - 21, w, 21);
  c.fillAndStroke();
  c.rect(0, 21, 9, h - 42);
  c.fillAndStroke();
  c.rect(w - 9, 21, 9, h - 42);
  c.fillAndStroke();
  c.ellipse(2.5, 7.5, 6, 6);
  c.stroke();
  c.ellipse(w - 8.5, 7.5, 6, 6);
  c.stroke();
  c.ellipse(2.5, h - 13.5, 6, 6);
  c.stroke();
  c.ellipse(w - 8.5, h - 13.5, 6, 6);
  c.stroke();
};

/** 棚の番号 (rackCabinet・rackCabinet2・rackCabinet3 の sideText。番号の列は x < 0 の側) */
const cabinetNumbers = (c: ShapeCanvas, e: ShapeEnv, h: number, unitNum: number, unitH: number, fontSize: number, numDisp: string) => {
  const fontColor = e.str('textColor', '#666666');
  const startUnit = nm(e, 'startUnit', 1);
  // 番号と目盛りの線は MAX_UNITS (と 1 本) まで (Kumiori の守り)
  const count = Math.min(unitNum, MAX_UNITS);
  c.setFontSize(fontSize);
  c.setFontColor(fontColor);
  if (numDisp === 'ascend') {
    for (let i = 0; i < count; i++) label(c, -fontSize, 21 + unitH * 0.5 + i * unitH, String(i + startUnit));
  } else if (numDisp === 'descend') {
    // ソースは cst.DIR_DESC か cst.DIR_ON と比べるが、cst に DIR_ON は無い (undefined) ので、既定の on では番号を書かない (目盛りの線だけ)
    for (let i = 0; i < count; i++) label(c, -fontSize, h - 21 - unitH * 0.5 - i * unitH, String(i + startUnit));
  }
  c.setStrokeColor(fontColor);
  c.begin();
  for (let i = 0; i < count + 1; i++) {
    c.moveTo(-2 * fontSize, 21 + i * unitH);
    c.lineTo(0, 21 + i * unitH);
  }
  c.stroke();
};

const rackContainer: ShapePainter = (c, w0, h, e) => {
  // numDisp (既定 ascend) が off でなければ、左に番号の列 (2 × 12) を空ける。単位の高さは rackUnitSize (既定 20。0 以下でもそのまま使う)
  const fontSize = 12;
  const numDisp = e.str('numDisp', 'ascend');
  let w = w0;
  if (numDisp !== 'off') {
    c.translate(fontSize * 2, 0);
    w = Math.max(w - fontSize * 2, 0);
  }
  c.setFillColor(col(e, 'fillColor', '#ffffff'));
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.setFillColor(col(e, 'fillColor2', '#f4f4f4'));
  if (w > 18 + fontSize * 2 && h > 42) rackFrame(c, w, h);
  if (numDisp !== 'off' && w > 18 + fontSize * 2) {
    const unitSize = nm(e, 'rackUnitSize', 20);
    c.setFontSize(fontSize);
    c.setFontColor(e.str('textColor', '#666666'));
    const units = Math.floor((Math.abs(h) - 42) / unitSize);
    // 番号と目盛りの線は MAX_UNITS (と 1 本) まで (Kumiori の守り)
    const count = Math.min(units, MAX_UNITS);
    for (let i = 0; i < count; i++) label(c, -fontSize, 21 + unitSize * 0.5 + i * unitSize, String(numDisp === 'descend' ? i + 1 : units - i));
    c.begin();
    for (let i = 0; i < count + 1; i++) {
      c.moveTo(-2 * fontSize, 21 + i * unitSize);
      c.lineTo(0, 21 + i * unitSize);
    }
    c.stroke();
  }
};

const rackPlate: ShapePainter = (c, w, h) => {
  // 板と、左右の 9 の帯 (黒の 23 %)
  const b = 9;
  c.begin();
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  if (w > b * 2) {
    c.save();
    c.setFillColor('#000000');
    c.setAlpha(0.23);
    c.rect(0, 0, b, h);
    c.fill();
    c.rect(w - b, 0, b, h);
    c.fill();
    c.restore();
    c.rect(0, 0, w, h);
    c.stroke();
    c.rect(b, 0, w - b * 2, h);
    c.stroke();
  }
};

const rackHorCableDuct: ShapePainter = (c, w, h) => {
  // 33 ごとの溝 (幅 3 の上下の四角)
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  const spaceBuffer = 20;
  const unitSpacing = 33;
  const across = Math.floor((w - spaceBuffer) / unitSpacing);
  let x = spaceBuffer / 2 + Math.floor((w - spaceBuffer - across * unitSpacing) / 2);
  if (across > 0) {
    // 溝は MAX_UNITS 個まで (Kumiori の守り)
    for (let i = 0; i <= across && i < MAX_UNITS; i++) {
      c.rect(x, 0, 3, 7);
      c.stroke();
      c.rect(x, 7, 3, 7.8);
      c.stroke();
      x += unitSpacing;
    }
  }
};

const rackHorRoutingBank: ShapePainter = (c, w, h) => {
  // 外の四角だけ。ソースの foreground は段の数を h / mxRackContainer.unitSize で数えるが、
  // mxRackContainer.unitSize は無く (prototype.unitSize だけ)、段の数が NaN になるので、穴の四角は描かれない
  c.rect(0, 0, w, h);
  c.fillAndStroke();
};

/** NEAT-PATCH の白い太字 (12) */
const neatText = (c: ShapeCanvas, x: number, y: number) => {
  c.setFontSize(12);
  c.setFontColor('#ffffff');
  c.setFontStyle(BOLD);
  label(c, x, y, 'NEAT-PATCH');
};

const rackNeatPatch: ShapePainter = (c, w, h) => {
  c.setFillColor('#666666');
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  neatText(c, w / 2, h - 6);
};

/** 棚 (左・下・右の 3 辺。太さ 2) */
const shelfPath = (c: ShapeCanvas, x0: number, x1: number, y1: number, yEnd: number) => {
  c.setStrokeWidth(2);
  c.begin();
  c.moveTo(x0, 0);
  c.lineTo(x0, y1);
  c.lineTo(x1, y1);
  c.lineTo(x1, yEnd);
  c.fillAndStroke();
};

const rackShelf: ShapePainter = (c, w, h) => shelfPath(c, 1, w - 1, h - 1, 1);
const rackShelfU =
  (hh: number): ShapePainter =>
  (c) =>
    shelfPath(c, 0, 160.9, hh, 0);

const rackRackNumbering: ShapePainter = (c, _w, _h, e) => {
  // unitNum (既定 42) × unitHeight (既定 14.8) の高さの帯と、左の番号 (numDir 既定 descend)
  const unitNum = nm(e, 'unitNum', 42);
  const unitH = nm(e, 'unitHeight', 14.8);
  const fontSize = nm(e, 'textSize', 12);
  const h = unitNum * unitH;
  c.rect(fontSize * 3, 0, 160.9, h);
  c.fillAndStroke();
  // 番号と目盛りの線は MAX_UNITS (と 1 本) まで (Kumiori の守り)
  const count = Math.min(unitNum, MAX_UNITS);
  c.setFontSize(fontSize);
  c.setFontColor(e.str('textColor', '#666666'));
  const asc = e.str('numDir', 'descend') === 'ascend';
  for (let i = 0; i < count; i++) label(c, fontSize, asc ? unitH * 0.5 + i * unitH : h - unitH * 0.5 - i * unitH, String(i + 1));
  c.setStrokeColor('#dddddd');
  c.begin();
  for (let i = 0; i < count + 1; i++) {
    c.moveTo(0, i * unitH);
    c.lineTo(fontSize * 3, i * unitH);
  }
  c.stroke();
};

const rackRackCabinet: ShapePainter = (c, _w, _h, e) => {
  // 幅 180 の棚 (古い形)。高さは unitNum (既定 12) × unitHeight (既定 14.8) + 42
  const unitNum = nm(e, 'unitNum', 12);
  const unitH = nm(e, 'unitHeight', 14.8);
  const fontSize = nm(e, 'textSize', 12);
  const numDisp = e.str('numDisp', 'on');
  if (numDisp !== 'off') c.translate(fontSize * 2, 0);
  const h = unitNum * unitH + 42;
  c.setFillColor('#ffffff');
  c.rect(0, 0, 180, h);
  c.fillAndStroke();
  c.setFillColor('#f4f4f4');
  rackFrame(c, 180, h);
  if (numDisp !== 'off') cabinetNumbers(c, e, h, unitNum, unitH, fontSize, numDisp);
};

const rackRackCabinet2: ShapePainter = (c, w0, _h, e) => {
  const unitNum = nm(e, 'unitNum', 12);
  const unitH = nm(e, 'rackUnitSize', 14.8);
  const fontSize = nm(e, 'textSize', 12);
  const numDisp = e.str('numDisp', 'on');
  let w = w0;
  if (numDisp !== 'off') {
    c.translate(fontSize * 2, 0);
    w -= fontSize * 2;
  }
  const h = unitNum * unitH + 42;
  c.setFillColor(col(e, 'fillColor2', '#ffffff'));
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.setFillColor(col(e, 'fillColor', '#f4f4f4'));
  rackFrame(c, w, h);
  if (numDisp !== 'off') cabinetNumbers(c, e, h, unitNum, unitH, fontSize, numDisp);
};

const rackRackCabinet3: ShapePainter = (c, w0, h0, e) => {
  // 単位の数は高さから (round((h - 42) / rackUnitSize))。番号は左
  const unitH = nm(e, 'rackUnitSize', 14.8);
  const unitNum = Math.round((h0 - 42) / unitH);
  const fontSize = nm(e, 'textSize', 12);
  const numDisp = e.str('numDisp', 'on');
  let w = w0;
  if (numDisp !== 'off') {
    c.translate(fontSize * 2, 0);
    w -= fontSize * 2;
  }
  const h = unitNum * unitH + 42;
  c.setFillColor(col(e, 'fillColor2', '#ffffff'));
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.setFillColor(col(e, 'fillColor', '#f4f4f4'));
  rackFrame(c, w, h);
  if (numDisp !== 'off') cabinetNumbers(c, e, h, unitNum, unitH, fontSize, numDisp);
};

/** 大きさの決まった古いラックの部品 (幅 160.9。高さ hh。溝・穴の四角の並び) */
const fixedRack =
  (hh: number, holes: [number, number, number, number][]): ShapePainter =>
  (c) => {
    c.rect(0, 0, 160.9, hh);
    c.fillAndStroke();
    for (const [x, y, w, h] of holes) {
      c.rect(x, y, w, h);
      c.stroke();
    }
  };
const ductHoles = (lower: number) => [12, 45.5, 79, 112.5, 146].flatMap((x): [number, number, number, number][] => [
  [x, 0, 3, 7],
  [x, 7, 3, lower],
]);
const bankHoles = (rows: number[]) => rows.flatMap((y) => [10, 31, 52, 73, 94, 115, 136].map((x): [number, number, number, number] => [x, y, 17, 6.8]));

const rackNeatPatch2U: ShapePainter = (c) => {
  c.setFillColor('#666666');
  c.rect(0, 0, 160.9, 29.6);
  c.fillAndStroke();
  neatText(c, 80.45, 24);
};

const rackChannelBase: ShapePainter = (c, w0, h0) => {
  // 台と、左右の黒い足。幅・高さは 20 以上
  const w = Math.max(w0, 20);
  const h = Math.max(h0, 20);
  const feet = () => {
    c.rect(10, h - 15, 5, 15);
    c.fillAndStroke();
    c.rect(w - 15, h - 15, 5, 15);
    c.fillAndStroke();
  };
  feet();
  c.rect(0, 0, w, h - 5);
  c.fillAndStroke();
  c.setFillColor('#000000');
  feet();
};

const rackCabinetLeg: ShapePainter = (c, w0, h0) => {
  const w = Math.max(w0, 20);
  const h = Math.max(h0, 20);
  c.begin();
  c.moveTo(0, h - 10);
  c.lineTo(5, h - 10);
  c.lineTo(5, h - 12);
  c.lineTo(9, h - 12);
  c.lineTo(9, h - 10);
  c.lineTo(w - 10, h - 10);
  c.lineTo(w - 10, 9);
  c.lineTo(w - 12, 9);
  c.lineTo(w - 12, 5);
  c.lineTo(w - 10, 5);
  c.lineTo(w - 10, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
};

// ───────────── Android (draw.io の shapes/mxAndroid.js) ─────────────

const androidTabBar: ShapePainter = (c, w, h, e) => {
  const texts = e.str('mainText', '+Tab 1, Tab 2, Tab 3').split(',');
  const fontColor = e.str('textColor', 'none');
  const selectedFontColor = e.str('textColor2', 'none');
  const fontSize = nm(e, 'textSize', 17);
  const n = texts.length;
  const { selected, widths, total } = buttonsOf(texts, fontSize);
  const labelOffset = 5;
  const trueH = Math.max(h, fontSize * 1.5, 7);
  const minW = 2 * labelOffset * n + total;
  const trueW = Math.max(w, minW);
  const W = trueW;
  const H = trueH;
  c.begin();
  c.setStrokeColor(col(e, 'strokeColor', 'none'));
  c.setFillColor(col(e, 'fillColor', 'none'));
  c.rect(0, 0, W, H);
  c.fillAndStroke();
  c.setStrokeColor(col(e, 'strokeColor2', 'none'));
  c.begin();
  const pre1 = prefixSums(widths.length, (j) => widths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
  for (let i = 1; i < n; i++) {
    if (i !== selected && i !== selected + 1) {
      let x = pre1[i];
      x = (x * W) / minW;
      c.moveTo(x, H * 0.2);
      c.lineTo(x, H * 0.8);
    }
  }
  c.stroke();
  // 選んだタブ (選んだものが無ければ、ソースでは幅が NaN の四角になり、何も描かない)
  if (selected >= 0) {
    let left = 0;
    c.setFillColor(col(e, 'fillColor2', 'none'));
    for (let i = 0; i < selected; i++) left += widths[i] + 2 * labelOffset;
    left = (left * W) / minW;
    const right = left + ((widths[selected] + 2 * labelOffset) * W) / minW;
    c.rect(left, 0, right - left, H);
    c.fill();
    c.setAlpha(1);
    c.setFillColor('#33b5e5');
    c.rect(left, H * 0.9, right - left, H * 0.1);
    c.fill();
  }
  c.setFontStyle(BOLD);
  let x = 0;
  for (let i = 0; i < n; i++) {
    c.setFontColor(i === selected ? selectedFontColor : fontColor);
    x += labelOffset;
    const t = texts[i].charAt(0) === '+' ? texts[i].substring(1) : texts[i];
    c.begin();
    c.setFontSize(fontSize);
    label(c, ((x + widths[i] * 0.5) * trueW) / minW, trueH * 0.5, t);
    x += widths[i] + labelOffset;
  }
};

const androidStatusBar: ShapePainter = (c, w, h, e) => {
  // 帯と、右の時刻・電池・電波
  fillBox(c, w, h);
  fillBox(c, w, h);
  c.setFontColor(e.color('fontColor', '#222222') ?? '#222222');
  c.setFontSize(nm(e, 'fontSize', 5));
  label(c, w - 30, h * 0.5 + 1, '12:00', 'left');
  c.setFillColor('#444444');
  c.begin();
  c.moveTo(w - 37, h * 0.5 + 6);
  c.lineTo(w - 37, h * 0.5 - 5);
  c.lineTo(w - 36, h * 0.5 - 5);
  c.lineTo(w - 36, h * 0.5 - 6);
  c.lineTo(w - 32, h * 0.5 - 6);
  c.lineTo(w - 32, h * 0.5 - 5);
  c.lineTo(w - 31, h * 0.5 - 5);
  c.lineTo(w - 31, h * 0.5 + 6);
  c.close();
  c.fill();
  c.setFillColor(col(e, 'strokeColor', 'none'));
  c.ellipse(w - 56, h * 0.5 + 2, 2, 2);
  c.fillAndStroke();
  c.setStrokeWidth(2);
  c.begin();
  c.moveTo(w - 52, h * 0.5 + 1);
  c.arcTo(3.5, 3.5, 0, 0, 0, w - 58, h * 0.5 + 1);
  c.stroke();
  c.begin();
  c.moveTo(w - 50, h * 0.5 - 1);
  c.arcTo(6, 6, 0, 0, 0, w - 60, h * 0.5 - 1);
  c.stroke();
  c.setStrokeWidth(1);
  for (const [x, y, ww, hh] of [
    [w - 51, h * 0.5 + 5, 2, 1],
    [w - 48, h * 0.5 + 2, 2, 4],
    [w - 45, h * 0.5 - 1, 2, 7],
    [w - 42, h * 0.5 - 4, 2, 10],
    [w - 37, h * 0.5 - 2, 6, 8],
  ]) {
    c.rect(x, y, ww, hh);
    c.fill();
  }
};

/** 選択肢の群 (checkboxGroup・radioGroup)。buttonText を ',' で分け、'+' で始まるものを選んだもの */
const optionGroup =
  (radio: boolean): ShapePainter =>
  (c, w, h, e) => {
    // ソースは mxConstants.STYLE_TEXTCOLOR (定義の無い名前) を読むので、字の色はいつも既定の #666666
    const fontColor = '#666666';
    const fontSize = nm(e, 'fontSize', 8);
    const texts = e.str('buttonText', 'Option 1').split(',');
    const strokeColor = col(e, 'strokeColor', 'none');
    c.setStrokeColor(col(e, 'strokeColor2', 'none'));
    const n = texts.length;
    const size = 5;
    const lineH = Math.max(fontSize * 1.5, size);
    const labelOffset = 2.5;
    const minH = n * lineH;
    const trueH = Math.max(h, minH);
    let maxW = 0;
    for (const t of texts) maxW = Math.max(maxW, textWidth(t.charAt(0) === '+' ? t.substring(1) : t, fontSize));
    const minW = 2 * labelOffset + maxW + 2 * size;
    const trueW = Math.max(w, minW);
    rr(c, 0, 0, trueW, trueH, 2.5, 2.5);
    c.fillAndStroke();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.setStrokeColor(strokeColor);
    if (radio) c.setFillColor(strokeColor);
    for (let i = 0; i < n; i++) {
      const y = ((i * lineH + lineH * 0.5) * trueH) / minH;
      const sel = texts[i].charAt(0) === '+';
      const t = sel ? texts[i].substring(1) : texts[i];
      label(c, size * 2 + labelOffset, y, t, 'left');
      const ix = size * 0.5;
      const iy = y - size * 0.5;
      if (radio) {
        c.ellipse(ix, iy, size, size);
        c.stroke();
        if (sel) {
          c.ellipse(ix + size * 0.25, iy + size * 0.25, size * 0.5, size * 0.5);
          c.fillAndStroke();
        }
      } else {
        c.rect(ix, iy, size, size);
        c.fillAndStroke();
        if (sel) {
          c.begin();
          c.moveTo(ix + size * 0.25, iy + size * 0.5);
          c.lineTo(ix + size * 0.5, iy + size * 0.75);
          c.lineTo(ix + size * 0.75, iy + size * 0.25);
          c.stroke();
        }
      }
    }
  };

const androidMenuBar: ShapePainter = (c, w, h, e) => {
  const texts = e.str('menuText', 'Item 1, Item 2, Item 3').split(',');
  const fontSize = nm(e, 'fontSize', 12);
  const n = texts.length;
  const minBH = fontSize * 1.5;
  const minH = n * minBH;
  const trueH = Math.max(h, minH);
  c.rect(0, 0, w, trueH);
  c.fillAndStroke();
  c.begin();
  for (let i = 1; i < n; i++) {
    const y = (i * minBH * trueH) / minH;
    c.moveTo(0, y);
    c.lineTo(w, y);
  }
  c.stroke();
  for (let i = 0; i < n; i++) label(c, 10, ((i * minBH + minBH * 0.5) * trueH) / minH, texts[i], 'left');
};

const androidTextSelHandles: ShapePainter = (c, w, h, e) => {
  const strokeColor = col(e, 'strokeColor', 'none');
  const s = 15;
  const barH = Math.max(0, h - s * 1.5);
  c.setAlpha(0.5);
  c.rect(s, 0, w - 2 * s, barH);
  c.fill();
  c.begin();
  c.moveTo(0, h - s);
  c.lineTo(s * 0.5, h - s * 1.5);
  c.lineTo(s, h - s);
  c.close();
  c.moveTo(w - s, h - s);
  c.lineTo(w - s * 0.5, h - s * 1.5);
  c.lineTo(w, h - s);
  c.close();
  c.fill();
  c.setFillColor(strokeColor);
  c.rect(0, h - s, s, s);
  c.fill();
  c.rect(w - s, h - s, s, s);
  c.fill();
};

const androidIndeterminateSpinner: ShapePainter = (c, w, h) => {
  // 2 つの半円の輪を、#aaaaaa から #dddddd、#ffffff から #dddddd へのグラデーションで塗る
  c.setGradient('#aaaaaa', '#dddddd', 'south');
  c.begin();
  c.moveTo(w * 0.5, h * 0.1);
  c.arcTo(w * 0.4, h * 0.4, 0, 0, 0, w * 0.5, h * 0.9);
  c.lineTo(w * 0.5, h);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 1, w * 0.5, 0);
  c.close();
  c.fill();
  c.setGradient('#ffffff', '#dddddd', 'south');
  c.begin();
  c.moveTo(w * 0.5, h * 0.1);
  c.arcTo(w * 0.4, h * 0.4, 0, 0, 1, w * 0.5, h * 0.9);
  c.lineTo(w * 0.5, h);
  c.arcTo(w * 0.5, h * 0.5, 0, 0, 0, w * 0.5, 0);
  c.close();
  c.fill();
};

const androidCheckbox: ShapePainter = (c, w, h) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  c.moveTo(w * 0.8, h * 0.2);
  c.lineTo(w * 0.4, h * 0.8);
  c.lineTo(w * 0.25, h * 0.6);
  c.stroke();
};

/** 真ん中の横線 (0 から x まで) */
const hline = (c: ShapeCanvas, x0: number, x1: number, y: number) => {
  c.begin();
  c.moveTo(x0, y);
  c.lineTo(x1, y);
  c.stroke();
};

/** 位置の割合 (w × min(w, max(0, dx))。ソースのとおり、割合を w でも切る) */
const posOf = (e: ShapeEnv, k: string, d: number, w: number) => w * Math.max(0, Math.min(w, nm(e, k, d)));

const androidProgressBar: ShapePainter = (c, w, h, e) => {
  const dx1 = posOf(e, 'dx1', 0.8, w);
  const dx2 = posOf(e, 'dx2', 0.6, w);
  c.save();
  c.save();
  c.setStrokeColor('#444444');
  hline(c, 0, w, h * 0.5);
  c.restore();
  hline(c, 0, dx1, h * 0.5);
  c.setStrokeColor('#000000');
  c.setAlpha(0.2);
  hline(c, 0, dx1, h * 0.5);
  c.restore();
  hline(c, 0, dx2, h * 0.5);
};

/** つまみの付いた進み具合 (progressScrubberDisabled・Focused・Pressed) */
const scrubber =
  (kind: 'disabled' | 'focused' | 'pressed'): ShapePainter =>
  (c, w, h, e) => {
    const dx = posOf(e, 'dx', 0.3, w);
    const fillColor = col(e, 'fillColor', '#ffffff');
    c.save();
    c.save();
    c.setStrokeColor('#444444');
    hline(c, 0, w, h * 0.5);
    c.restore();
    let r = Math.min(h, w * 0.1) / 2;
    if (kind === 'disabled') {
      c.setAlpha(0.5);
      c.setFillColor('#666666');
    } else if (kind === 'focused') c.setAlpha(0.75);
    else {
      c.setStrokeColor(fillColor);
      c.setAlpha(0.5);
    }
    c.begin();
    c.ellipse(dx - r, h * 0.5 - r, 2 * r, 2 * r);
    if (kind === 'pressed') c.fillAndStroke();
    else c.fill();
    c.restore();
    if (kind !== 'disabled') {
      c.setStrokeColor(fillColor);
      hline(c, 0, dx, h * 0.5);
    }
    c.begin();
    r = Math.min(h, w * 0.1) / 8;
    c.ellipse(dx - r, h * 0.5 - r, 2 * r, 2 * r);
    c.fill();
  };

const androidQuickscroll2: ShapePainter = (c, w, h, e) => {
  const dy = Math.min(h - 20, Math.max(20, h * Math.max(0, Math.min(h, nm(e, 'dy', 0.5)))));
  c.save();
  c.save();
  c.setStrokeColor('#cccccc');
  c.begin();
  c.moveTo(w - 3, 0);
  c.lineTo(w - 3, h);
  c.stroke();
  c.restore();
  c.begin();
  rr(c, w - 6, dy - 10, 6, 20, 1, 1);
  c.fillAndStroke();
  c.setFillColor('#cccccc');
  c.begin();
  c.rect(0, dy - 20, w - 18, 40);
  c.fill();
  c.setFillColor('#666666');
  c.begin();
  c.moveTo(w - 18, dy - 20);
  c.lineTo(w - 6, dy);
  c.lineTo(w - 18, dy + 20);
  c.close();
  c.fill();
  c.setFontSize(12);
  label(c, (w - 18) * 0.5, dy, 'Aa');
};

const androidQuickscroll3: ShapePainter = (c, w, h, e) => {
  const dy = Math.min(h - 10, Math.max(10, h * Math.max(0, Math.min(h, nm(e, 'dy', 0.5)))));
  c.save();
  c.setStrokeColor('#cccccc');
  c.begin();
  c.moveTo(w * 0.5, 0);
  c.lineTo(w * 0.5, h);
  c.stroke();
  c.restore();
  c.begin();
  rr(c, w * 0.5 - 3, dy - 10, 6, 20, 1, 1);
  c.fillAndStroke();
};

const androidScrollbars2: ShapePainter = (c, w, h) => {
  c.begin();
  c.rect(w - 5, 0, 5, h - 7);
  c.fillAndStroke();
  c.begin();
  c.rect(0, h - 5, w - 7, 5);
  c.fillAndStroke();
};

const androidSpinner2: ShapePainter = (c, w, h) => {
  hline(c, 0, w, h);
  const s = Math.min(w / 10, h);
  c.begin();
  c.moveTo(w - s, h);
  c.lineTo(w, h - s);
  c.lineTo(w, h);
  c.close();
  c.fillAndStroke();
};

// ───────────── Bootstrap (draw.io の shapes/mxBootstrap.js) ─────────────

const bsLeftButtonStriped: ShapePainter = (c, w, h) => {
  // 左の角を丸めたボタンに、白の 20 % の斜めの縞 (MAX_STRIPES 本まで。Kumiori の守り。高さが 0 だと尽きない)
  const r = 5;
  c.begin();
  c.moveTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h - r);
  c.lineTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.close();
  c.fill();
  c.setAlpha(0.2);
  const sw = h * 0.5;
  c.setFillColor('#ffffff');
  c.begin();
  c.moveTo(0, h * 0.75);
  c.lineTo(0, h * 0.25);
  c.lineTo(h * 0.75, h);
  c.lineTo(h * 0.25, h);
  c.close();
  c.fill();
  let x = sw * 0.5;
  for (let n = 0; ; ) {
    c.begin();
    c.moveTo(x, 0);
    if (x + sw >= w) {
      c.lineTo(w, 0);
      c.lineTo(w, w - x);
    } else {
      c.lineTo(x + sw, 0);
      if (x + sw + h > w) {
        c.lineTo(w, w - x - sw);
        if (w - x > h) {
          c.lineTo(w, h);
          c.lineTo(x + h, h);
        } else c.lineTo(w, w - x);
      } else {
        c.lineTo(x + sw + h, h);
        c.lineTo(x + h, h);
      }
    }
    c.close();
    c.fill();
    x += 2 * sw;
    n++;
    if (x > w || n >= MAX_STRIPES) break;
  }
};

const bsRoundedButton: ShapePainter = (c, w, h) => {
  // 短い辺の半分の半径で両端を丸めたボタン
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

const bsArrow: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.moveTo(w * 0.9, 0);
  c.lineTo(w, h * 0.5);
  c.lineTo(w * 0.9, h);
  c.stroke();
};

const bsTabTop: ShapePainter = (c, w, h, e) => {
  // 上の角を丸めたタブを、塗りの色の線で塗ってから、下の辺の無い縁を線の色で引く
  const r = int(e, 'rSize', 10);
  const strokeColor = col(e, 'strokeColor', '#000000');
  c.setStrokeColor(col(e, 'fillColor', '#ffffff'));
  c.begin();
  c.moveTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
  c.fillAndStroke();
  c.setStrokeColor(strokeColor);
  c.begin();
  c.moveTo(0, h);
  c.lineTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h);
  c.stroke();
};

/** 角を丸めた四角の経路 (角の半径 r) */
const roundPath = (c: ShapeCanvas, w: number, h: number, r: number) => {
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
};

const bsImage: ShapePainter = (c, w0, h0, e) => {
  // 角丸の縁 (線だけ) と、その内側 (半径の半分だけ内) を塗る
  const r = Math.max(0, int(e, 'rSize', 10));
  roundPath(c, w0, h0, r);
  c.stroke();
  const half = r * 0.5;
  c.translate(half, half);
  roundPath(c, Math.max(0, w0 - r), Math.max(0, h0 - r), half);
  c.fill();
};

const bsCheckbox: ShapePainter = (c, w, h) => {
  rr(c, 0, 0, w, h, 3, 3);
  c.fillAndStroke();
  c.setStrokeWidth(3);
  c.begin();
  c.moveTo(w * 0.8, h * 0.2);
  c.lineTo(w * 0.4, h * 0.8);
  c.lineTo(w * 0.25, h * 0.6);
  c.stroke();
};

const bsCheckbox2: ShapePainter = (c, w, h, e) => {
  // checked (既定 偽) なら checkedFill で塗り、checkedStroke の印 (太さ 2)
  if (jsTrue(e, 'checked', false)) {
    c.setFillColor(col(e, 'checkedFill', '#ffffff'));
    c.setStrokeColor(col(e, 'checkedStroke', '#000000'));
    rr(c, 0, 0, w, h, 2, 2);
    c.fill();
    c.setStrokeWidth(2);
    c.begin();
    c.moveTo(w * 0.8, h * 0.2);
    c.lineTo(w * 0.4, h * 0.75);
    c.lineTo(w * 0.25, h * 0.6);
    c.stroke();
  } else {
    rr(c, 0, 0, w, h, 2, 2);
    c.fillAndStroke();
  }
};

const bsRadioButton: ShapePainter = (c, w, h, e) => {
  const strokeColor = col(e, 'strokeColor', '#000000');
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.setFillColor(strokeColor);
  c.ellipse(w * 0.25, h * 0.25, w * 0.5, h * 0.5);
  c.fill();
};

const bsRadioButton2: ShapePainter = (c, w, h, e) => {
  if (jsTrue(e, 'checked', false)) {
    const checkedFill = col(e, 'checkedFill', '#ffffff');
    c.setFillColor(checkedFill);
    c.setStrokeColor(checkedFill);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.setFillColor(col(e, 'checkedStroke', '#000000'));
    c.ellipse(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    c.fill();
  } else {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
};

const bsUser2: ShapePainter = (c, w, h) => {
  // 人の形 (円弧をつないだ外形を塗る)
  const A = (rx: number, ry: number, sweep: number, x: number, y: number) => c.arcTo(w * rx, h * ry, 0, 0, sweep, w * x, h * y);
  c.begin();
  c.moveTo(0, h * 0.95);
  A(0.3, 0.3, 1, 0.02, 0.87);
  A(0.1, 0.1, 1, 0.08, 0.812);
  A(3, 3, 1, 0.29, 0.732);
  A(0.15, 0.15, 0, 0.385, 0.607);
  A(0.11, 0.11, 0, 0.355, 0.53);
  A(0.3, 0.3, 1, 0.305, 0.44);
  A(0.33, 0.38, 1, 0.312, 0.15);
  A(0.218, 0.218, 1, 0.688, 0.15);
  A(0.33, 0.38, 1, 0.693, 0.44);
  A(0.25, 0.25, 1, 0.645, 0.53);
  A(0.1, 0.1, 0, 0.612, 0.6);
  A(0.15, 0.15, 0, 0.7, 0.726);
  A(3, 3, 1, 0.92, 0.812);
  A(0.1, 0.1, 1, 0.97, 0.865);
  A(0.2, 0.2, 1, 0.995, 0.952);
  c.close();
  c.fill();
};

const bsRating: ShapePainter = (c, _w, h, e) => {
  // grade (既定 5) 個の星 (ratingStyle 既定 star) か心臓 (heart) を塗りの色で、ratingScale (既定 10) までの残りを emptyFillColor で
  // (塗った印も空の印も MAX_ICONS 個まで。Kumiori の守り)
  const style = e.str('ratingStyle', 'star');
  const grade = nm(e, 'grade', 5);
  const scale = nm(e, 'ratingScale', 10);
  const icon = (i: number) => {
    const x = i * h * 1.2;
    c.begin();
    if (style === 'star') {
      c.moveTo(x, 0.33 * h);
      c.lineTo(x + 0.364 * h, 0.33 * h);
      c.lineTo(x + 0.475 * h, 0);
      c.lineTo(x + 0.586 * h, 0.33 * h);
      c.lineTo(x + 0.95 * h, 0.33 * h);
      c.lineTo(x + 0.66 * h, 0.551 * h);
      c.lineTo(x + 0.775 * h, 0.9 * h);
      c.lineTo(x + 0.475 * h, 0.684 * h);
      c.lineTo(x + 0.175 * h, 0.9 * h);
      c.lineTo(x + 0.29 * h, 0.551 * h);
    } else {
      c.moveTo(x + h * 0.519, h * 0.947);
      c.curveTo(x + h * 0.558, h * 0.908, x + h * 0.778, h * 0.682, x + h * 0.916, h * 0.54);
      c.curveTo(x + h * 1.039, h * 0.414, x + h * 1.036, h * 0.229, x + h * 0.924, h * 0.115);
      c.curveTo(x + h * 0.812, 0, x + h * 0.631, 0, x + h * 0.519, h * 0.115);
      c.curveTo(x + h * 0.408, 0, x + h * 0.227, 0, x + h * 0.115, h * 0.115);
      c.curveTo(x + h * 0.03, h * 0.229, x, h * 0.414, x + h * 0.123, h * 0.54);
    }
    c.close();
    c.fillAndStroke();
  };
  const known = style === 'star' || style === 'heart';
  if (known) for (let i = 0; i < grade && i < MAX_ICONS; i++) icon(i);
  c.setFillColor(col(e, 'emptyFillColor', '#ffffff'));
  if (known) for (let i = grade, n = 0; i < scale && n < MAX_ICONS; i++, n++) icon(i);
};

const bsRangeInput: ShapePainter = (c, w, h, e) => {
  // 溝 (rangeStyle 既定 rounded) とつまみ (handleStyle 既定 circle)。位置は dx (割合、既定 0.3)
  const dx = posOf(e, 'dx', 0.3, w);
  const gradientColor = col(e, 'gradientColor', 'none');
  const fillColor = col(e, 'fillColor', '#ffffff');
  const strokeColor = col(e, 'strokeColor', '#000000');
  const dir = e.str('gradientDirection', 'south');
  const rangeStyle = e.str('rangeStyle', 'rounded');
  const handleStyle = e.str('handleStyle', 'circle');
  const barH = Math.min(h * 0.5, w * 0.5);
  const r = barH * 0.5;
  // 両端の不透明度 (ソースは opacity (0〜100) をそのまま渡し、SVG の stop-opacity は 1 に収まる。塗り・グラデーションの色が none なら 0)
  const opacity = Math.max(0, Math.min(1, e.num('opacity', 100)));
  const op1 = fillColor === 'none' ? 0 : opacity;
  const op2 = gradientColor === 'none' ? 0 : opacity;
  if (rangeStyle === 'rect') {
    // 塗りの色から塗りの色へのグラデーション (gradientColor が none なら、終わりの不透明度が 0)
    c.setGradient(fillColor, fillColor, dir, op1, op2);
    c.rect(0, h * 0.5 - 2, w, 4);
    c.fill();
  } else if (rangeStyle === 'rounded') {
    c.begin();
    c.moveTo(0, h * 0.5);
    c.arcTo(r, r, 0, 0, 1, r, h * 0.5 - r);
    c.lineTo(w - r, h * 0.5 - r);
    c.arcTo(r, r, 0, 0, 1, w, h * 0.5);
    c.arcTo(r, r, 0, 0, 1, w - r, h * 0.5 + r);
    c.lineTo(r, h * 0.5 + r);
    c.arcTo(r, r, 0, 0, 1, 0, h * 0.5);
    c.close();
    c.fill();
  }
  if (handleStyle === 'rect') {
    c.setGradient(fillColor, gradientColor, dir, op1, op2);
    const hw = h * 0.5;
    c.rect(dx - hw * 0.5, 0, hw, h);
    c.fillAndStroke();
    c.begin();
    for (const y of [0.3, 0.5, 0.7]) {
      c.moveTo(dx - hw * 0.25, h * y);
      c.lineTo(dx + hw * 0.25, h * y);
    }
    c.stroke();
  } else if (handleStyle === 'circle') {
    c.setFillColor(strokeColor);
    c.ellipse(dx - barH, 0, 2 * barH, 2 * barH);
    c.fill();
  }
};

const bsSwitch: ShapePainter = (c, w0, h, e) => {
  // buttonState == true (既定 真) なら onFillColor の溝と右の onStrokeColor の丸、偽なら溝の縁と左の線の色の丸
  const w = Math.max(w0, 2 * h);
  const on = looseTrue(e, 'buttonState', true);
  const r = h * 0.8;
  if (on) {
    c.setStrokeColor(col(e, 'onStrokeColor', '#ffffff'));
    c.setFillColor(col(e, 'onFillColor', '#0085FC'));
    rr(c, 0, 0, w, h, h * 0.5, h * 0.5);
    c.fill();
    c.setFillColor(col(e, 'onStrokeColor', '#ffffff'));
    c.ellipse(w - h * 0.9, h * 0.1, r, r);
    c.fill();
  } else {
    rr(c, 0, 0, w, h, h * 0.5, h * 0.5);
    c.fillAndStroke();
    c.setFillColor(col(e, 'strokeColor', '#000000'));
    c.ellipse(h * 0.1, h * 0.1, r, r);
    c.fill();
  }
};

const bsX: ShapePainter = (c, w, h) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, h);
  c.moveTo(w, 0);
  c.lineTo(0, h);
  c.stroke();
};

const bsPopover: ShapePainter = (c, w, h, e) => {
  // 下に尖りの付いた角丸の吹き出し (既定は形の初期の値 dx 0.5・dy 0.5。角の半径 rSize 既定 10)
  const r = int(e, 'rSize', 10);
  const dx = Math.max(0, Math.min(w, nm(e, 'dx', 0.5)));
  const dy = Math.max(0, Math.min(h, nm(e, 'dy', 0.5)));
  const x1 = Math.max(dx - dy, 0);
  const x2 = Math.min(dx + dy, w);
  c.begin();
  c.moveTo(r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - dy - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h - dy);
  c.lineTo(x2, h - dy);
  c.lineTo(dx, h);
  c.lineTo(x1, h - dy);
  c.lineTo(r, h - dy);
  c.arcTo(r, r, 0, 0, 1, 0, h - dy - r);
  c.lineTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.close();
  c.fillAndStroke();
};

// ───────────── Google Material Design Lite (draw.io の shapes/mxGmdl.js) ─────────────

const gmdlPlayer: ShapePainter = (c, w, h) => {
  // 帯と、上の黄色 (#FFED00) の進み具合 (幅の 8 割) と、右の灰色 (#717171) の一時停止の印
  c.begin();
  c.rect(0, 0, w, h);
  c.fill();
  if (h >= 4) {
    c.setFillColor('#FFED00');
    c.begin();
    c.rect(0, 0, w * 0.8, 4);
    c.fill();
  }
  if (h >= 14 && w >= 33) {
    c.setFillColor('#717171');
    c.begin();
    c.rect(w - 33, h * 0.5 - 7, 4, 14);
    c.fill();
    c.begin();
    c.rect(w - 25, h * 0.5 - 7, 4, 14);
    c.fill();
  }
};

const gmdlSwitch: ShapePainter = (c, w, h, e) => {
  // switchState (既定 on) が on なら半透明の溝と右の丸、off なら灰色 (#BCBBBB) の溝と左の薄い灰色 (#F1F1F1) の丸
  const on = e.str('switchState', 'on') === 'on';
  c.begin();
  if (on) {
    c.save();
    c.setAlpha(0.5);
    c.moveTo(w * 0.135, h * 0.8);
    c.arcTo(w * 0.135, h * 0.3, 0, 0, 1, w * 0.135, h * 0.2);
    c.lineTo(w * 0.675, h * 0.2);
    c.arcTo(w * 0.135, h * 0.3, 0, 0, 1, w * 0.675, h * 0.8);
    c.close();
    c.fillAndStroke();
    c.restore();
  } else {
    c.setFillColor('#BCBBBB');
    c.moveTo(w * 0.225, h * 0.8);
    c.arcTo(w * 0.135, h * 0.3, 0, 0, 1, w * 0.225, h * 0.2);
    c.lineTo(w * 0.865, h * 0.2);
    c.arcTo(w * 0.135, h * 0.3, 0, 0, 1, w * 0.865, h * 0.8);
    c.close();
    c.fillAndStroke();
  }
  c.begin();
  if (on) c.ellipse(w * 0.36, 0, w * 0.64, h);
  else {
    c.setFillColor('#F1F1F1');
    c.ellipse(0, 0, w * 0.64, h);
  }
  c.fillAndStroke();
};

const gmdlSliderNormal: ShapePainter = (c, w, h, e) => {
  const s = nm(e, 'handleSize', 10);
  c.ellipse(0, h * 0.5 - s * 0.5, s, s);
  c.stroke();
  c.begin();
  c.moveTo(s, h * 0.5);
  c.lineTo(w, h * 0.5);
  c.fillAndStroke();
};

/** 溝の線 (gmdl の slider2・sliderFocused・sliderDiscrete。y は線の高さ) */
const gmdlTrack = (c: ShapeCanvas, w: number, y: number, inactive: string) => {
  c.save();
  c.setStrokeColor(inactive);
  c.begin();
  c.moveTo(0, y);
  c.lineTo(w, y);
  c.fillAndStroke();
  c.restore();
};
const barPosOf = (e: ShapeEnv) => Math.max(0, Math.min(1, nm(e, 'barPos', 40) / 100));

const gmdlSlider2: ShapePainter = (c, w, h, e) => {
  const s = nm(e, 'handleSize', 10);
  const p = barPosOf(e);
  gmdlTrack(c, w, h * 0.5, '#bbbbbb');
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(p * w, h * 0.5);
  c.fillAndStroke();
  c.begin();
  c.ellipse(p * w - s * 0.5, h * 0.5 - s * 0.5, s, s);
  c.fillAndStroke();
};

const gmdlSliderFocused: ShapePainter = (c, w, h, e) => {
  const s = nm(e, 'handleSize', 10);
  const p = barPosOf(e);
  const strokeColor = col(e, 'strokeColor', '#ffffff');
  gmdlTrack(c, w, h * 0.5, '#bbbbbb');
  c.begin();
  c.moveTo(0, h * 0.5);
  c.lineTo(p * w, h * 0.5);
  c.fillAndStroke();
  c.begin();
  c.ellipse(p * w - s * 0.167, h * 0.5 - s * 0.167, s * 0.33, s * 0.33);
  c.fillAndStroke();
  c.setFillColor(strokeColor);
  c.setAlpha(0.15);
  c.begin();
  c.ellipse(p * w - s * 0.5, h * 0.5 - s * 0.5, s, s);
  c.fill();
};

const gmdlSliderDisabled: ShapePainter = (c, w, h, e) => {
  // hPos (%、既定 50) のつまみと、その左右 7 を空けた線
  const s = nm(e, 'handleSize', 10);
  const p = Math.min(Math.max(nm(e, 'hPos', 50) / 100, 0), 1);
  c.ellipse(w * p - s * 0.5, (h - s) * 0.5, s, s);
  c.fillAndStroke();
  const endL = w * p - 7;
  const startR = w * p + 7;
  if (endL > 0) hline(c, 0, endL, h * 0.5);
  if (startR < w) hline(c, startR, w, h * 0.5);
};

/** 値の吹き出しの付いたつまみ (sliderDiscrete・sliderDiscreteDots) */
const gmdlDiscrete =
  (dots: boolean): ShapePainter =>
  (c, w, h, e) => {
    const p = barPosOf(e);
    const fontSize = nm(e, 'fontSize', 12);
    const fontColor = e.color('fontColor', '#000000') ?? '#000000';
    const inactive = dots ? '#bebebe' : '#bbbbbb';
    const y = h * 0.5 + 22.5;
    gmdlTrack(c, w, y, inactive);
    if (dots && p <= 0.1) c.setFillColor(inactive);
    c.begin();
    c.moveTo(0, y);
    c.lineTo(p * w, y);
    c.fillAndStroke();
    c.begin();
    c.moveTo(p * w, h * 0.5 + 15.5);
    c.lineTo(p * w - 10.5, h * 0.5 + 2.5);
    c.arcTo(15, 15, 0, 0, 1, p * w, h * 0.5 - 22.5);
    c.arcTo(15, 15, 0, 0, 1, p * w + 10.5, h * 0.5 + 2.5);
    c.close();
    if (dots) {
      c.fill();
      // bright (既定 1) == '1' なら黒、ほかは白
      c.setFillColor(Number(e.str('bright', '1')) === 1 ? '#000000' : '#ffffff');
      for (const x of [-1.5, w * 0.2 - 1.5, w * 0.4 - 1.5, w * 0.6 - 1.5, w * 0.8 - 1.5, w - 1.5]) {
        c.ellipse(x, h * 0.5 + 21, 3, 3);
        c.fill();
      }
    } else c.fillAndStroke();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    label(c, p * w, h * 0.5 - 9, String(Math.round(p * 100)));
  };

const gmdlProgressBar: ShapePainter = (c, w, h, e) => {
  const dx1 = posOf(e, 'dx1', 0.8, w);
  c.save();
  c.setStrokeColor('#aaaaaa');
  hline(c, 0, w, h * 0.5);
  c.restore();
  hline(c, 0, dx1, h * 0.5);
};

// ───────────── 登録の名前 (registerShape の名前) ─────────────

export const SHAPES_UI: Record<string, ShapePainter> = {
  // iOS 7
  'mxgraph.ios7ui.appBar': ios7AppBar,
  'mxgraph.ios7ui.onOffButton': ios7OnOffButton,
  'mxgraph.ios7ui.slider': ios7Slider,
  'mxgraph.ios7ui.downloadBar': ios7DownloadBar,
  'mxgraph.ios7ui.icon': ios7Icon,
  'mxgraph.ios7ui.horButtonBar': ios7HorButtonBar,
  'mxgraph.ios7ui.pageControl': ios7PageControl,
  'mxgraph.ios7ui.iconGrid': ios7IconGrid,
  'mxgraph.ios7ui.phone': phone,
  'mxgraph.ios7ui.searchBox': ios7SearchBox,
  'mxgraph.ios7ui.url': ios7Url,
  'mxgraph.ios7ui.actionDialog': ios7ActionDialog,
  'mxgraph.ios7ui.anchor': nothing,
  'mxgraph.ios7ui.rrect': rrect,
  'mxgraph.ios7ui.leftButton': sideButton('left', 1),
  'mxgraph.ios7ui.rightButton': sideButton('right', 1),
  'mxgraph.ios7ui.topButton': sideButton('top', 1),
  'mxgraph.ios7ui.bottomButton': sideButton('bottom', 0),
  'mxgraph.ios7ui.horLines': horLines,
  'mxgraph.ios7ui.marginRect': marginRect(true),
  'mxgraph.ios7ui.callout': ios7Callout,
  'mxgraph.ios7ui.selectBar': ios7SelectBar,
  // ラック
  'mxgraph.rackGeneral.container': rackContainer,
  'mxgraph.rackGeneral.rackCabinet': rackRackCabinet,
  'mxgraph.rackGeneral.rackCabinet2': rackRackCabinet2,
  'mxgraph.rackGeneral.rackCabinet3': rackRackCabinet3,
  'mxgraph.rackGeneral.rackNumbering': rackRackNumbering,
  'mxgraph.rackGeneral.plate': rackPlate,
  'mxgraph.rackGeneral.horCableDuct': rackHorCableDuct,
  'mxgraph.rackGeneral.horRoutingBank': rackHorRoutingBank,
  'mxgraph.rackGeneral.neatPatch': rackNeatPatch,
  'mxgraph.rackGeneral.shelf': rackShelf,
  'mxgraph.rackGeneral.horCableDuct1U': fixedRack(14.8, ductHoles(7.8)),
  'mxgraph.rackGeneral.horCableDuct2U': fixedRack(29.6, ductHoles(22.6)),
  'mxgraph.rackGeneral.horRoutingBank1U': fixedRack(14.8, bankHoles([4])),
  'mxgraph.rackGeneral.horRoutingBank2U': fixedRack(29.6, bankHoles([4, 18.8])),
  'mxgraph.rackGeneral.neatPatch2U': rackNeatPatch2U,
  'mxgraph.rackGeneral.shelf1U': rackShelfU(14.8),
  'mxgraph.rackGeneral.shelf2U': rackShelfU(29.6),
  'mxgraph.rackGeneral.shelf4U': rackShelfU(59.2),
  'mxgraph.rackGeneral.channelBase': rackChannelBase,
  'mxgraph.rackGeneral.cabinetLeg': rackCabinetLeg,
  // Android
  'mxgraph.android.tabBar': androidTabBar,
  'mxgraph.android.phone': phone,
  'mxgraph.android.statusBar': androidStatusBar,
  'mxgraph.android.checkboxGroup': optionGroup(false),
  'mxgraph.android.radioGroup': optionGroup(true),
  'mxgraph.android.menuBar': androidMenuBar,
  'mxgraph.android.textSelHandles': androidTextSelHandles,
  'mxgraph.android.indeterminateSpinner': androidIndeterminateSpinner,
  'mxgraph.android.anchor': nothing,
  'mxgraph.android.rrect': rrect,
  'mxgraph.android.checkbox': androidCheckbox,
  'mxgraph.android.progressBar': androidProgressBar,
  'mxgraph.android.progressScrubberDisabled': scrubber('disabled'),
  'mxgraph.android.progressScrubberFocused': scrubber('focused'),
  'mxgraph.android.progressScrubberPressed': scrubber('pressed'),
  'mxgraph.android.quickscroll2': androidQuickscroll2,
  'mxgraph.android.quickscroll3': androidQuickscroll3,
  'mxgraph.android.scrollbars2': androidScrollbars2,
  'mxgraph.android.spinner2': androidSpinner2,
  // Bootstrap
  'mxgraph.bootstrap.rrect': rrect,
  'mxgraph.bootstrap.topButton': sideButton('top', 1),
  'mxgraph.bootstrap.bottomButton': sideButton('bottom', 1),
  'mxgraph.bootstrap.rightButton': sideButton('right', 1),
  'mxgraph.bootstrap.leftButton': sideButton('left', 1),
  'mxgraph.bootstrap.leftButtonStriped': bsLeftButtonStriped,
  'mxgraph.bootstrap.roundedButton': bsRoundedButton,
  'mxgraph.bootstrap.arrow': bsArrow,
  'mxgraph.bootstrap.tabTop': bsTabTop,
  'mxgraph.bootstrap.image': bsImage,
  'mxgraph.bootstrap.checkbox': bsCheckbox,
  'mxgraph.bootstrap.checkbox2': bsCheckbox2,
  'mxgraph.bootstrap.radioButton': bsRadioButton,
  'mxgraph.bootstrap.radioButton2': bsRadioButton2,
  'mxgraph.bootstrap.horLines': horLines,
  'mxgraph.bootstrap.user2': bsUser2,
  'mxgraph.bootstrap.rating': bsRating,
  'mxgraph.bootstrap.anchor': nothing,
  'mxgraph.bootstrap.rangeInput': bsRangeInput,
  'mxgraph.bootstrap.switch': bsSwitch,
  'mxgraph.bootstrap.x': bsX,
  'mxgraph.bootstrap.popover': bsPopover,
  // Google Material Design Lite
  'mxgraph.gmdl.player': gmdlPlayer,
  'mxgraph.gmdl.switch': gmdlSwitch,
  'mxgraph.gmdl.marginRect': marginRect(false),
  'mxgraph.gmdl.sliderNormal': gmdlSliderNormal,
  'mxgraph.gmdl.slider2': gmdlSlider2,
  'mxgraph.gmdl.sliderFocused': gmdlSliderFocused,
  'mxgraph.gmdl.sliderDisabled': gmdlSliderDisabled,
  'mxgraph.gmdl.sliderDisabled2': gmdlSliderDisabled,
  'mxgraph.gmdl.sliderDiscrete': gmdlDiscrete(false),
  'mxgraph.gmdl.sliderDiscreteDots': gmdlDiscrete(true),
  'mxgraph.gmdl.progressBar': gmdlProgressBar,
};
