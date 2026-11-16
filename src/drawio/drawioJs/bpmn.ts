/**
 * drawioJs/bpmn — draw.io の JavaScript で書かれた形のうち、BPMN・リーン生産 (バリューストリームマップ)・間取り図・ER 図の形を、
 * drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (v24.7.5。Apache License 2.0) の src/main/webapp/shapes/bpmn/mxBpmnShape2.js・mxLeanMap.js・mxFloorplan.js・
 * er/mxER.js の各形の paintVertexShape (と、それが呼ぶ background・foreground・strictDrawShape など)。基底の形として
 * js/grapheditor/Shapes.js の mxShapeBasicRect2 (mxgraph.basic.rect) と NoteShape (note)、mxGraph の mxSwimlane も移す。
 * 呼ぶ側 (drawio.ts の jsShape) がセルの位置へ移し、向き・反転を済ませるので、ソースの paintVertexShape(c, x, y, w, h) の x・y は 0 として書く。
 * 接続点 (constraints・getConstraints)・取っ手 (handleFactory)・customProperties の画面・影は移さない。
 * 後の版で足された mxgraph.bpmn.task2・data2・conversation2 (mxShapeBpmn2Task2・Data2・Conversation2) は v24.7.5 に無いので除いた。
 *
 * スタイルの値は mxGraph の mxStylesheet.getCellStyle と同じく読む: none の値は無いものとし (既定の値になる)、数の字は数として真偽を見る。
 * mxSvgCanvas2D は、塗る・線を引くと今の要素を手放す (addNode の終わりで node = null) ので、begin をせずに続けた経路は描かれない。
 * ソースにそういう経路 (mxLeanCrossDock の 2 本目より後・mxShapeERInfEng の最後の線) があるときは、draw.io の見た目に合わせて描かない。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxSwimlane.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxCellRenderer.js: Copyright (c) 2006-2017, JGraph Holdings Ltd; Copyright (c) 2006-2017, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxStylesheet.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/bpmn/mxBpmnShape2.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/er/mxER.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mxFloorplan.js: Copyright (c) 2006-2014, JGraph Ltd
 *   shapes/mxLeanMap.js: Copyright (c) 2006-2013, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';
import { SHAPES_A } from '../drawioShapesA';
import { textWidth } from '../drawioText';

// ───────────── スタイルの読み方 ─────────────

const NO = '\u0000';

/** mxUtils.getValue(style, k, d) の真偽 (0 以外の数か、空でない文字なら真。無ければ d) */
const truthy = (e: ShapeEnv, k: string, d: boolean) => {
  const v = e.str(k, NO);
  if (v === NO) return d;
  if (v === '') return false;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
};

/** mxUtils.getValue(style, k, d) の色 (none の値は mxStylesheet が消すので、既定の d になる) */
const gv = (e: ShapeEnv, k: string, d: string) => (e.str(k, NO) === NO ? d : (e.color(k, d) ?? d));

/**
 * 繰り返しで描く部分 (リーン生産の斜めの線・間取り図の階段の段) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値 (大きさ) で描き終わらないのを防ぐため、上限までは描いて、そこで止める。
 * ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_LINES = 10000;

/** 線の列 (moveTo・lineTo を交互に。[x0, y0, x1, y1] ごとに 1 本) */
const segs = (c: ShapeCanvas, list: number[][]) => {
  for (const [x0, y0, x1, y1] of list) {
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
  }
};

/** 折れ線 (先頭は moveTo) */
const poly = (c: ShapeCanvas, pts: number[][], close = true) => {
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  if (close) c.close();
};

// ───────────── Shapes.js の mxShapeBasicRect2 (mxgraph.basic.rect) の strictDrawShape ─────────────

/** strictDrawShape の os (外から上書きする値。BPMN の作業の形が使う分) */
interface RectOverride {
  rectOutline?: string;
  indent?: number;
  dashed?: boolean;
  strokeWidth?: number;
}

/**
 * 角の形 (rectStyle と、角ごとの topLeftStyle など) を変えられる四角。外形を塗り、内側 (indent) を fillColor2 で塗り、
 * 辺 (top・right・bottom・left) の組み合わせごとに線を引く (rectOutline: single・double・frame)。fold の角には折り目を引く
 */
function basicRect(c: ShapeCanvas, w: number, h: number, e: ShapeEnv, os: RectOverride = {}) {
  const rectStyle = e.str('rectStyle', 'square');
  const absoluteCornerSize = truthy(e, 'absoluteCornerSize', true);
  let size = Math.max(0, Math.min(w, e.num('size', 10)));
  const rectOutline = os.rectOutline || e.str('rectOutline', 'single');
  let indent = os.indent || Math.max(0, Math.min(w, e.num('indent', 2)));
  const dashed = os.dashed || truthy(e, 'dashed', false);
  const dashPattern = e.str('dashPattern', '');
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
  const strokeWidth = os.strokeWidth || e.num('strokeWidth', 1);
  const fillColor2 = e.str('fillColor2', 'none');
  const gradientColor2 = e.str('gradientColor2', 'none');
  const gdir2 = e.str('gradientDirection2', 'south');
  const relSize = Math.max(0, Math.min(50, size));

  c.setDashed(dashed);
  if (dashPattern) c.setDashPattern(dashPattern);
  c.setStrokeWidth(strokeWidth);
  size = Math.min(h * 0.5, w * 0.5, size);
  if (!absoluteCornerSize) size = (relSize * Math.min(w, h)) / 100;
  size = Math.min(size, Math.min(w, h) * 0.5);
  if (!absoluteCornerSize) indent = (relIndent * Math.min(w, h)) / 100;
  indent = Math.min(indent, Math.min(w, h) * 0.5 - size);
  const i = indent;

  /** 角の形が v か (角の値が default なら rectStyle で見る) */
  const is = (st: string, v: string) => st === v || (st === 'default' && rectStyle === v);
  const M = (x: number, y: number) => c.moveTo(x, y);
  const L = (x: number, y: number) => c.lineTo(x, y);
  const A = (r: number, sweep: number, x: number, y: number) => c.arcTo(r, r, 0, 0, sweep, x, y);
  const round = (st: string) => is(st, 'rounded') || is(st, 'invRound');
  const cut = (st: string) => is(st, 'snip') || is(st, 'fold');
  const rs = (st: string) => is(st, 'rounded') || is(st, 'snip');
  const fi = (st: string) => is(st, 'invRound') || is(st, 'fold');

  // moveNW・paintNW などの各部分 (mxShapeBasicRect2.prototype の同じ名前の関数)。st は角の形
  const ops: Record<string, (st?: string) => void> = {
    mNW: (st = tl) => (is(st, 'square') || !left ? M(0, 0) : M(0, size)),
    mNE: (st = tr) => (is(st, 'square') || !top ? M(w, 0) : M(w - size, 0)),
    mSE: (st = br) => (is(st, 'square') || !right ? M(w, h) : M(w, h - size)),
    mSW: (st = bl) => (is(st, 'square') || !bottom ? M(0, h) : M(size, h)),
    pNW: (st = tl) => (!left ? L(0, 0) : round(st) ? A(size, is(st, 'rounded') ? 1 : 0, size, 0) : cut(st) ? L(size, 0) : undefined),
    pTop: (st = tr) => (is(st, 'square') || !right ? L(w, 0) : L(w - size, 0)),
    pNE: (st = tr) => (!top ? L(w, 0) : round(st) ? A(size, is(st, 'rounded') ? 1 : 0, w, size) : cut(st) ? L(w, size) : undefined),
    pRight: (st = br) => (is(st, 'square') || !bottom ? L(w, h) : L(w, h - size)),
    pLeft: (st = tl) => (is(st, 'square') || !top ? L(0, 0) : L(0, size)),
    pSE: (st = br) => (!right ? L(w, h) : round(st) ? A(size, is(st, 'rounded') ? 1 : 0, w - size, h) : cut(st) ? L(w - size, h) : undefined),
    pBottom: (st = bl) => (is(st, 'square') || !left ? L(0, h) : L(size, h)),
    pSW: (st = bl) => (!bottom ? L(0, h) : round(st) ? A(size, is(st, 'rounded') ? 1 : 0, 0, h - size) : cut(st) ? L(0, h - size) : undefined),
    pNWI: (st = tl) => {
      if (is(st, 'rounded')) A(size - i * 0.5, 0, i, i * 0.5 + size);
      else if (is(st, 'invRound')) A(size + i, 1, i, i + size);
      else if (is(st, 'snip')) L(i, i * 0.5 + size);
      else if (is(st, 'fold')) {
        L(i + size, i + size);
        L(i, i + size);
      }
    },
    pTopI: (st = tl) => {
      if (!left && !top) L(0, 0);
      else if (!left) L(0, i);
      else if (!top) L(i, 0);
      else if (is(st, 'square')) L(i, i);
      else if (rs(st)) L(size + i * 0.5, i);
      else L(size + i, i);
    },
    pNEI: (st = tr) => {
      if (is(st, 'rounded')) A(size - i * 0.5, 0, w - size - i * 0.5, i);
      else if (is(st, 'invRound')) A(size + i, 1, w - size - i, i);
      else if (is(st, 'snip')) L(w - size - i * 0.5, i);
      else if (is(st, 'fold')) {
        L(w - size - i, size + i);
        L(w - size - i, i);
      }
    },
    pRightI: (st = tr) => {
      if (!top && !right) L(w, 0);
      else if (!top) L(w - i, 0);
      else if (!right) L(w, i);
      else if (is(st, 'square')) L(w - i, i);
      else if (rs(st)) L(w - i, size + i * 0.5);
      else L(w - i, size + i);
    },
    pLeftI: (st = bl) => {
      if (!bottom && !left) L(0, h);
      else if (!bottom) L(i, h);
      else if (!left) L(0, h - i);
      else if (is(st, 'square')) L(i, h - i);
      else if (rs(st)) L(i, h - size - i * 0.5);
      else L(i, h - size - i);
    },
    pSEI: (st = br) => {
      if (is(st, 'rounded')) A(size - i * 0.5, 0, w - i, h - size - i * 0.5);
      else if (is(st, 'invRound')) A(size + i, 1, w - i, h - size - i);
      else if (is(st, 'snip')) L(w - i, h - size - i * 0.5);
      else if (is(st, 'fold')) {
        L(w - size - i, h - size - i);
        L(w - i, h - size - i);
      }
    },
    pBottomI: (st = br) => {
      if (!right && !bottom) L(w, h);
      else if (!right) L(w, h - i);
      else if (!bottom) L(w - i, h);
      else if (is(st, 'square')) L(w - i, h - i);
      else if (rs(st)) L(w - size - i * 0.5, h - i);
      else L(w - size - i, h - i);
    },
    pSWI: (st = bl) => {
      if (!bottom) L(i, h);
      else if (is(st, 'square')) L(i, h - i);
      else if (is(st, 'rounded')) A(size - i * 0.5, 0, size + i * 0.5, h - i);
      else if (is(st, 'invRound')) A(size + i, 1, size + i, h - i);
      else if (is(st, 'snip')) L(size + i * 0.5, h - i);
      else if (is(st, 'fold')) {
        L(i + size, h - size - i);
        L(i + size, h - i);
      }
    },
    // moveSWInner・lineSWInner など (M は moveTo、L は lineTo で、同じ点)
    ...Object.fromEntries(
      (
        [
          ['SWI', bl, (st: string) => (!left ? [0, h - i] : is(st, 'square') ? [i, h - i] : rs(st) ? [i, h - size - i * 0.5] : fi(st) ? [i, h - size - i] : undefined)],
          ['SEI', br, (st: string) => (!bottom ? [w - i, h] : is(st, 'square') ? [w - i, h - i] : rs(st) ? [w - i, h - size - i * 0.5] : fi(st) ? [w - i, h - size - i] : undefined)],
          // moveNEInner・lineNEInner は「|| right」のため、right なら角の形に関わらず (w - indent, indent)
          ['NEI', tr, () => (!right ? [w, i] : [w - i, i])],
          ['NWI', tl, (st: string) => (!top && !left ? [0, 0] : !top ? [i, 0] : !left ? [0, i] : is(st, 'square') ? [i, i] : rs(st) ? [i, size + i * 0.5] : fi(st) ? [i, size + i] : undefined)],
        ] as Array<[string, string, (st: string) => number[] | undefined]>
      ).flatMap(([n, d, pt]) => [
        [`m${n}`, (st = d) => ((p) => p && M(p[0], p[1]))(pt(st))],
        [`l${n}`, (st = d) => ((p) => p && L(p[0], p[1]))(pt(st))],
      ]),
    ),
  };
  /** 部分の列を描く (「mSW@tl」は角の形に topLeftStyle を渡す。ソースのまま。Z は close) */
  const run = (seq: string) => {
    for (const t of seq.split(' ')) {
      if (t === 'Z') c.close();
      else {
        const [n, s] = t.split('@');
        ops[n](s === 'tl' ? tl : undefined);
      }
    }
  };

  if ((top || right || bottom || left) && rectOutline !== 'frame') {
    // 外形を塗る
    c.begin();
    if (!top) M(0, 0);
    else ops.mNW();
    if (top) ops.pNW();
    ops.pTop();
    if (right) ops.pNE();
    ops.pRight();
    if (bottom) ops.pSE();
    ops.pBottom();
    if (left) ops.pSW();
    ops.pLeft();
    c.close();
    c.fill();
    c.setShadow(false);
    // 内側を fillColor2 (gradientColor2 があればグラデーション) で塗る。この後の塗りの色は fillColor2 のまま (ソースのまま)
    c.setFillColor(fillColor2);
    c.setGradient(fillColor2, gradientColor2, gdir2);
    c.begin();
    if (!top) M(i, 0);
    else ops.mNWI();
    ops.pLeftI();
    if (left && bottom) ops.pSWI();
    ops.pBottomI();
    if (bottom && right) ops.pSEI();
    ops.pRightI();
    if (right && top) ops.pNEI();
    ops.pTopI();
    if (top && left) ops.pNWI();
    c.fill();
    if (fillColor === 'none') {
      c.begin();
      folds();
      c.stroke();
    }
  }

  // 辺の組み合わせ (上・右・下・左) ごとの線: [外の線, double の内の線] の組の列と、frame の経路の列
  const COMBOS: Record<string, [Array<[string, string]>, string[]]> = {
    '0001': [[['mSW@tl pLeft', 'mNWI pLeftI']], ['mSW@tl pLeft lNWI pLeftI Z']],
    '0010': [[['mSE pBottom', 'mSWI pBottomI']], ['mSE pBottom lSWI pBottomI Z']],
    '0011': [[['mSE pBottom pSW pLeft', 'mNWI pLeftI pSWI pBottomI']], ['mSE pBottom pSW pLeft lNWI pLeftI pSWI pBottomI Z']],
    '0100': [[['mNE pRight', 'mSEI pRightI']], ['mNE pRight lSEI pRightI Z']],
    '0101': [
      [
        ['mSW@tl pLeft', 'mNWI pLeftI'],
        ['mNE pRight', 'mSEI pRightI'],
      ],
      ['mSW@tl pLeft lNWI pLeftI Z', 'mNE pRight lSEI pRightI Z'],
    ],
    '0110': [[['mNE pRight pSE pBottom', 'mSWI pBottomI pSEI pRightI']], ['mNE pRight pSE pBottom lSWI pBottomI pSEI pRightI Z']],
    '0111': [[['mNE pRight pSE pBottom pSW pLeft', 'mNWI pLeftI pSWI pBottomI pSEI pRightI']], ['mNE pRight pSE pBottom pSW pLeft lNWI pLeftI pSWI pBottomI pSEI pRightI Z']],
    '1000': [[['mNW pTop', 'mNEI pTopI']], ['mNW pTop lNEI pTopI Z']],
    '1001': [[['mSW pLeft pNW pTop', 'mNEI pTopI pNWI pLeftI']], ['mSW pLeft pNW pTop lNEI pTopI pNWI pLeftI Z']],
    '1010': [
      [
        ['mNW pTop', 'mNEI pTopI'],
        ['mSE pBottom', 'mSWI pBottomI'],
      ],
      ['mNW pTop lNEI pTopI Z', 'mSE pBottom lSWI pBottomI Z'],
    ],
    '1011': [[['mSE pBottom pSW pLeft pNW pTop', 'mNEI pTopI pNWI pLeftI pSWI pBottomI']], ['mSE pBottom pSW pLeft pNW pTop lNEI pTopI pNWI pLeftI pSWI pBottomI Z']],
    '1100': [[['mNW pTop pNE pRight', 'mSEI pRightI pNEI pTopI']], ['mNW pTop pNE pRight lSEI pRightI pNEI pTopI Z']],
    '1101': [[['mSW pLeft pNW pTop pNE pRight', 'mSEI pRightI pNEI pTopI pNWI pLeftI']], ['mSW pLeft pNW pTop pNE pRight lSEI pRightI pNEI pTopI pNWI pLeftI Z']],
    '1110': [[['mNW pTop pNE pRight pSE pBottom', 'mSWI pBottomI pSEI pRightI pNEI pTopI']], ['mNW pTop pNE pRight pSE pBottom lSWI pBottomI pSEI pRightI pNEI pTopI Z']],
    '1111': [
      [['mNW pNW pTop pNE pRight pSE pBottom pSW pLeft Z', 'mSWI pSWI pBottomI pSEI pRightI pNEI pTopI pNWI pLeftI Z']],
      ['mNW pNW pTop pNE pRight pSE pBottom pSW pLeft Z mSWI pSWI pBottomI pSEI pRightI pNEI pTopI pNWI pLeftI Z'],
    ],
  };
  const combo = COMBOS[[top, right, bottom, left].map((b) => (b ? '1' : '0')).join('')];
  if (combo) {
    if (rectOutline !== 'frame') {
      for (const [outer, inner] of combo[0]) {
        c.begin();
        run(outer);
        if (rectOutline === 'double') run(inner);
        c.stroke();
      }
    } else {
      for (const seq of combo[1]) {
        c.begin();
        run(seq);
        c.fillAndStroke();
      }
    }
  }
  c.begin();
  folds();
  c.stroke();

  /** paintFolds: fold の角の折り目 */
  function folds() {
    if (![rectStyle, tl, tr, br, bl].includes('fold')) return;
    if (is(tl, 'fold') && top && left) poly(c, [[0, size], [size, size], [size, 0]], false);
    if (is(tr, 'fold') && top && right) poly(c, [[w - size, 0], [w - size, size], [w, size]], false);
    if (is(br, 'fold') && bottom && right) poly(c, [[w - size, h], [w - size, h - size], [w, h - size]], false);
    if (is(bl, 'fold') && bottom && left) poly(c, [[0, h - size], [size, h - size], [size, h]], false);
  }
}

// ───────────── BPMN の印 (mxBpmnShape・mxShapeBpmnEvent の symbols) ─────────────

/** 印の経路 (begin から閉じるまで) */
const SYM_PATH: Record<string, (c: ShapeCanvas, w: number, h: number) => void> = {
  escalation: (c, w, h) => poly(c, [[0, h], [w * 0.5, 0], [w, h], [w * 0.5, h * 0.5]]),
  link: (c, w, h) => poly(c, [[0, h * 0.76], [0, h * 0.24], [w * 0.63, h * 0.24], [w * 0.63, 0], [w, h * 0.5], [w * 0.63, h], [w * 0.63, h * 0.76]]),
  error: (c, w, h) => poly(c, [[0, h], [w * 0.3287, h * 0.123], [w * 0.6194, h * 0.6342], [w, 0], [w * 0.6625, h * 0.939], [w * 0.3717, h * 0.5064]]),
  cancel: (c, w, h) =>
    poly(c, [[w * 0.1051, 0], [w * 0.5, h * 0.3738], [w * 0.8909, 0], [w, h * 0.1054], [w * 0.623, h * 0.5], [w, h * 0.8926], [w * 0.8909, h], [w * 0.5, h * 0.6242], [w * 0.1051, h], [0, h * 0.8926], [w * 0.373, h * 0.5], [0, h * 0.1054]]),
  compensation: (c, w, h) => {
    poly(c, [[0, h * 0.5], [w * 0.5, 0], [w * 0.5, h]]);
    poly(c, [[w * 0.5, h * 0.5], [w, 0], [w, h]]);
  },
  signal: (c, w, h) => poly(c, [[0, h], [w * 0.5, 0], [w, h]]),
  multiple: (c, w, h) => poly(c, [[0, h * 0.39], [w * 0.5, 0], [w, h * 0.39], [w * 0.815, h], [w * 0.185, h]]),
  /** 十字 (parallelMultiple・parallelGw・gateway2 の parallel) */
  plus: (c, w, h) =>
    poly(c, [[w * 0.38, 0], [w * 0.62, 0], [w * 0.62, h * 0.38], [w, h * 0.38], [w, h * 0.62], [w * 0.62, h * 0.62], [w * 0.62, h], [w * 0.38, h], [w * 0.38, h * 0.62], [0, h * 0.62], [0, h * 0.38], [w * 0.38, h * 0.38]]),
  /** ×印 (exclusiveGw・gateway2 の exclusive) */
  cross: (c, w, h) =>
    poly(c, [[w * 0.105, 0], [w * 0.5, h * 0.38], [w * 0.895, 0], [w, h * 0.11], [w * 0.6172, h * 0.5], [w, h * 0.89], [w * 0.895, h], [w * 0.5, h * 0.62], [w * 0.105, h], [0, h * 0.89], [w * 0.3808, h * 0.5], [0, h * 0.11]]),
  /** 米印 (complexGw・gateway2 の complex) */
  complex: (c, w, h) =>
    poly(c, [
      [0, h * 0.44], [w * 0.36, h * 0.44], [w * 0.1, h * 0.18], [w * 0.18, h * 0.1], [w * 0.44, h * 0.36], [w * 0.44, 0], [w * 0.56, 0], [w * 0.56, h * 0.36], [w * 0.82, h * 0.1], [w * 0.9, h * 0.18], [w * 0.64, h * 0.44], [w, h * 0.44],
      [w, h * 0.56], [w * 0.64, h * 0.56], [w * 0.9, h * 0.82], [w * 0.82, h * 0.9], [w * 0.56, h * 0.64], [w * 0.56, h], [w * 0.44, h], [w * 0.44, h * 0.64], [w * 0.18, h * 0.9], [w * 0.1, h * 0.82], [w * 0.36, h * 0.56], [0, h * 0.56],
    ]),
};

const symMessage = (c: ShapeCanvas, w: number, h: number, inv: boolean, e: ShapeEnv) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  if (e.str('fillColor', 'none') === 'none' && inv) c.setStrokeColor('#ffffff');
  c.begin();
  poly(c, [[0, 0], [w * 0.5, h * 0.5], [w, 0]], false);
  c.stroke();
};

const symTimer = (c: ShapeCanvas, w: number, h: number) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  segs(c, [
    [w * 0.5, 0, w * 0.5, h * 0.0642], [w * 0.7484, h * 0.0654, w * 0.7126, h * 0.1281], [w * 0.93, h * 0.2471, w * 0.8673, h * 0.2854], [w, h * 0.5, w * 0.9338, h * 0.5],
    [w * 0.93, h * 0.7509, w * 0.8673, h * 0.7126], [w * 0.7484, h * 0.9326, w * 0.7126, h * 0.8699], [w * 0.5, h * 0.9338, w * 0.5, h], [w * 0.2496, h * 0.9325, w * 0.2854, h * 0.8699],
    [w * 0.068, h * 0.7509, w * 0.1307, h * 0.7126], [0, h * 0.5, w * 0.0642, h * 0.5], [w * 0.068, h * 0.2471, w * 0.1307, h * 0.2854], [w * 0.2496, h * 0.0654, w * 0.2854, h * 0.1281],
  ]);
  c.moveTo(w * 0.5246, h * 0.0706);
  c.lineTo(w * 0.5, h * 0.5);
  c.lineTo(w * 0.7804, h * 0.5118);
  c.stroke();
};

const symConditional = (c: ShapeCanvas, w: number, h: number) => {
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  segs(c, [0.1027, 0.3669, 0.6311, 0.8953].map((k) => [0, h * k, w * 0.798, h * k]));
  c.stroke();
};

const symTerminate = (c: ShapeCanvas, w: number, h: number) => {
  c.ellipse(0, 0, w, h);
  c.fillAndStroke();
};

/** star: 枠の中の 12 角の星 (色の入れ替えは呼ぶ側) */
const symStar = (c: ShapeCanvas, w0: number, h0: number) => {
  c.translate(w0 / 5, h0 / 6);
  const h = (h0 * 2) / 3;
  const w = (w0 * 3) / 5;
  c.begin();
  poly(c, [[0, h / 4], [w / 3, h / 4], [w / 2, 0], [(2 * w) / 3, h / 4], [w, h / 4], [(5 * w) / 6, h / 2], [w, (3 * h) / 4], [(2 * w) / 3, (3 * h) / 4], [w / 2, h], [w / 3, (3 * h) / 4], [0, (3 * h) / 4], [w / 6, h / 2]]);
  c.fillAndStroke();
};

type SymFn = (c: ShapeCanvas, w: number, h: number, inv: boolean, e: ShapeEnv) => void;

/** 経路を塗って線を引く (inverse なら塗るだけ。miter は先に setMiterLimit) */
const symFill =
  (name: string, invFill: boolean, miter?: number): SymFn =>
  (c, w, h, inv) => {
    if (miter !== undefined) c.setMiterLimit(miter);
    c.begin();
    SYM_PATH[name](c, w, h);
    if (invFill && inv) c.fill();
    else c.fillAndStroke();
  };

/** 塗りと線の色を入れ替えて、経路を塗って線を引く (mxBpmnShape の exclusiveGw・parallelGw・complexGw) */
const symGw =
  (name: string): SymFn =>
  (c, w, h) => {
    const sc = c.strokeColor;
    const fc = c.fillColor;
    c.setStrokeColor(fc);
    c.setFillColor(sc);
    c.begin();
    SYM_PATH[name](c, w, h);
    c.fillAndStroke();
    c.setStrokeColor(sc);
    c.setFillColor(fc);
  };

/** mxShapeBpmnEvent.prototype.symbols */
const EVENT_SYMBOLS: Record<string, SymFn> = {
  general: () => {},
  message: symMessage,
  timer: symTimer,
  escalation: symFill('escalation', true, 6),
  conditional: symConditional,
  link: symFill('link', true),
  error: symFill('error', true, 7),
  cancel: symFill('cancel', true),
  compensation: symFill('compensation', true, 1),
  signal: symFill('signal', true),
  multiple: symFill('multiple', true),
  parallelMultiple: symFill('plus', true),
  terminate: symTerminate,
  star: symStar,
};

/** mxBpmnShape.prototype.symbols (古い形。逆の色でも線を引く印が多く、ゲートウェイの印がある) */
const LEGACY_SYMBOLS: Record<string, SymFn> = {
  general: () => {},
  message: symMessage,
  timer: symTimer,
  escalation: symFill('escalation', false),
  conditional: symConditional,
  link: symFill('link', false),
  error: symFill('error', true),
  cancel: symFill('cancel', false),
  compensation: symFill('compensation', false),
  signal: symFill('signal', false),
  multiple: symFill('multiple', false),
  parallelMultiple: symFill('plus', false),
  terminate: symTerminate,
  exclusiveGw: symGw('cross'),
  parallelGw: symGw('plus'),
  complexGw: symGw('complex'),
  star: symStar,
};

/** 印ごとの置き場 (枠に対する左上と大きさの割合) */
const SYM_BOX: Record<string, [number, number, number, number]> = {
  message: [0.15, 0.3, 0.7, 0.4],
  timer: [0.11, 0.11, 0.78, 0.78],
  escalation: [0.19, 0.15, 0.62, 0.57],
  conditional: [0.3, 0.16, 0.4, 0.68],
  link: [0.27, 0.33, 0.46, 0.34],
  error: [0.212, 0.243, 0.58, 0.507],
  cancel: [0.22, 0.22, 0.56, 0.56],
  compensation: [0.28, 0.35, 0.44, 0.3],
  signal: [0.19, 0.15, 0.62, 0.57],
  multiple: [0.2, 0.19, 0.6, 0.565],
  parallelMultiple: [0.2, 0.2, 0.6, 0.6],
  terminate: [0.05, 0.05, 0.9, 0.9],
};

/** 縁 (mxShapeBpmnEvent・mxBpmnShape の outlines)。dashed は今の破線の状態 (c.state.dashed) */
const OUTLINES: Record<string, (c: ShapeCanvas, w: number, h: number, dashed: boolean) => void> = {
  none: () => {},
  standard: (c, w, h) => {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  },
  eventInt: (c, w, h) => {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  },
  eventNonint: (c, w, h, dashed) => {
    c.setDashed(true);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.setDashed(dashed);
  },
  catching: (c, w, h) => {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.ellipse(2, 2, w - 4, h - 4);
    c.stroke();
  },
  boundInt: (c, w, h) => {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.ellipse(2, 2, w - 4, h - 4);
    c.stroke();
  },
  boundNonint: (c, w, h, dashed) => {
    c.setDashed(true);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.ellipse(2, 2, w - 4, h - 4);
    c.stroke();
    c.setDashed(dashed);
  },
  throwing: (c, w, h) => {
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.ellipse(w * 0.02 + 2, h * 0.02 + 2, w * 0.96 - 4, h * 0.96 - 4);
    c.stroke();
  },
  end: (c, w, h) => {
    const sw = c.strokeWidth;
    c.setStrokeWidth(sw * 3);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
    c.setStrokeWidth(sw);
  },
};

/**
 * 印を描く (mxShapeBpmnEvent.strictDrawShape・mxBpmnShape.redrawPath の SYMBOL の層の共通の部分): 置き場へ移し、
 * star は塗りを線の色に、throwing・end の縁なら塗りと線の色を入れ替えて描き、色を戻す
 */
function drawSymbol(c: ShapeCanvas, e: ShapeEnv, table: Record<string, SymFn>, symbol: string, outline: string, w: number, h: number, legacy: boolean) {
  if (!Object.hasOwn(table, symbol)) return;
  const sc = c.strokeColor;
  const fc = c.fillColor;
  const box = Object.hasOwn(SYM_BOX, symbol) ? SYM_BOX[symbol] : legacy && symbol === 'exclusiveGw' ? ([0.12, 0, 0.76, 1] as const) : undefined;
  if (box) {
    c.translate(w * box[0], h * box[1]);
    w *= box[2];
    h *= box[3];
  }
  const swap = symbol !== 'star' && (outline === 'throwing' || outline === 'end');
  if (symbol === 'star') c.setFillColor(sc);
  else if (swap) {
    c.setStrokeColor(fc);
    c.setFillColor(sc);
  }
  table[symbol](c, w, h, swap, e);
  if (symbol === 'star') c.setFillColor(fc);
  else if (swap) {
    c.setStrokeColor(sc);
    c.setFillColor(fc);
  }
}

/** mxShapeBpmnEvent.prototype.strictDrawShape: (x, y) へ移して縁を描き、印を描く (移しは戻さない) */
function eventShape(c: ShapeCanvas, e: ShapeEnv, x: number, y: number, w: number, h: number, outline: string, symbol: string, dashed: boolean) {
  if (Object.hasOwn(OUTLINES, outline)) {
    c.translate(x, y);
    OUTLINES[outline](c, w, h, dashed);
  }
  drawSymbol(c, e, EVENT_SYMBOLS, symbol, outline, w, h, false);
}

// ───────────── BPMN (bpmn/mxBpmnShape2.js) ─────────────

/** mxBpmnShape (古い形。background=gateway なら菱形の中に半分の大きさで縁と印) */
const bpmnShape: ShapePainter = (c, w, h, e) => {
  const bg = e.str('background', 'none');
  const gateway = bg === 'gateway';
  // BACKGROUND の層
  if (gateway) {
    c.begin();
    poly(c, [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    c.fillAndStroke();
  }
  // OUTLINE の層
  const outline = e.str('outline', 'none');
  let ow = w;
  let oh = h;
  if (gateway) {
    c.translate(w / 4, h / 4);
    oh /= 2;
    ow /= 2;
  }
  if (Object.hasOwn(OUTLINES, outline)) OUTLINES[outline](c, ow, oh, truthy(e, 'dashed', false));
  // SYMBOL の層
  const symbol = e.str('symbol', NO);
  if (symbol !== NO) drawSymbol(c, e, LEGACY_SYMBOLS, symbol, outline, gateway ? w / 2 : w, gateway ? h / 2 : h, true);
};

/** mxShapeBpmn2SendMarker.paintVertexShape: (x, y) へ移して (戻さない) 封筒 */
const sendMarkerAt = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.translate(x, y);
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  c.begin();
  poly(c, [[0, 0], [w * 0.5, h * 0.5], [w, 0]], false);
  c.stroke();
};

const bpmnEvent: ShapePainter = (c, w, h, e) => eventShape(c, e, 0, 0, w, h, e.str('outline', 'none'), e.str('symbol', NO), truthy(e, 'dashed', false));

/** mxShapeBpmnGateway: 菱形と、種類 (gwType) の印 (event なら縁と印を 6 割の大きさで) */
const bpmnGateway: ShapePainter = (c, w, h, e) => {
  c.begin();
  poly(c, [[w * 0.5, 0], [w, h * 0.5], [w * 0.5, h], [0, h * 0.5]]);
  c.fillAndStroke();
  const sw = w * 0.6;
  const sh = h * 0.6;
  const gwType = e.str('gwType', 'event');
  const outline = e.str('outline', 'none');
  const symbol = e.str('symbol', 'standard');
  let tw = w * 0.5;
  const th = h * 0.5;
  const mark = (name: string) => {
    const fc = c.fillColor;
    c.setFillColor(c.strokeColor);
    c.begin();
    SYM_PATH[name](c, tw, th);
    c.fillAndStroke();
    c.setFillColor(fc);
  };
  if (gwType === 'event' && outline !== 'none') eventShape(c, e, (w - sw) * 0.5, (h - sh) * 0.5, sw, sh, outline, symbol, truthy(e, 'dashed', false));
  else if (gwType === 'exclusive') {
    c.translate(w * 0.31, h * 0.25);
    tw *= 0.76;
    mark('cross');
    c.translate(-tw * 0.12, 0);
  } else if (gwType === 'parallel') {
    c.translate(w * 0.25, h * 0.25);
    mark('plus');
  } else if (gwType === 'complex') {
    c.translate(w * 0.25, h * 0.25);
    mark('complex');
  }
};

/** 小さな四角の中の + (サブプロセスの印。左上が (x, y)) */
const subMarker = (c: ShapeCanvas) => {
  c.rect(0, 0, 14, 14);
  c.stroke();
  c.begin();
  segs(c, [
    [4, 7, 10, 7],
    [7, 4, 7, 10],
  ]);
  c.stroke();
};

/** 縦の 3 本線 (多重のインスタンスの並列の印。12 × 12) */
const parallelMarker = (c: ShapeCanvas) => {
  c.begin();
  segs(c, [
    [2.4, 0, 2.4, 12],
    [6, 0, 6, 12],
    [9.6, 0, 9.6, 12],
  ]);
  c.stroke();
};

/**
 * mxShapeBpmn2Task: mxgraph.basic.rect の四角 (transaction は二重、subprocess は破線、
 * call は太線) と、下の真ん中に並べる繰り返しなどの印、左上の作業の印 (taskMarker) と、左上の事象 (outline・symbol)
 */
const bpmnTask: ShapePainter = (c, w, h, e) => {
  const type = e.str('bpmnShapeType', 'task');
  const taskMarker = e.str('taskMarker', 'abstract');
  const strokeWidth = e.num('strokeWidth', 1);
  const dashed = truthy(e, 'dashed', false);
  const inset = e.num('indent', 3);
  let offsetY = 14;
  const os: RectOverride = {};
  if (type === 'transaction') {
    offsetY += inset;
    os.rectOutline = 'double';
    os.indent = 3;
  } else if (type === 'subprocess') os.dashed = true;
  else if (type === 'call') os.strokeWidth = 4;
  basicRect(c, w, h, e, os);
  c.setStrokeWidth(strokeWidth);
  c.setDashed(dashed);
  c.setDashed(false);
  const on = (k: string) => truthy(e, k, false);
  const loopStd = on('isLoopStandard');
  const loopPar = on('isLoopMultiParallel');
  const loopSeq = on('isLoopMultiSeq');
  const loopComp = on('isLoopComp');
  const loopSub = on('isLoopSub');
  const adHoc = on('isAdHoc');
  const n = [loopStd, loopPar, loopSeq, loopComp, loopSub, adHoc].filter(Boolean).length;
  const space = 14;
  let cx = -space * n * 0.5;
  if (loopStd && c.stencil('mxgraph.bpmn.loop', w * 0.5 + cx + 1, h - offsetY + 1, 12, 12)) cx += space;
  if (loopPar) {
    c.translate(w * 0.5 + cx + 1, h - offsetY + 1);
    parallelMarker(c);
    c.translate(-w * 0.5 - cx - 1, offsetY - 1 - h);
    cx += space;
  }
  if (loopSeq) {
    c.translate(w * 0.5 + cx + 1, h - offsetY + 1);
    c.begin();
    segs(c, [
      [0, 2.4, 12, 2.4],
      [0, 6, 12, 6],
      [0, 9.6, 12, 9.6],
    ]);
    c.stroke();
    c.translate(-w * 0.5 - cx - 1, offsetY - 1 - h);
    cx += space;
  }
  if (loopComp && c.stencil('mxgraph.bpmn.compensation', w * 0.5 + cx, h - offsetY + 1, 14, 12)) cx += space;
  if (loopSub) {
    c.translate(w * 0.5 + cx, h - offsetY);
    subMarker(c);
    c.translate(-w * 0.5 - cx, offsetY - h);
    cx += space;
  }
  if (adHoc) {
    const sc = gv(e, 'strokeColor', '#000000');
    const fc = gv(e, 'fillColor', '#ffffff');
    // 形が無ければ (ソースの stencil == null)、色を変えないので、今の色に戻す
    const prev = [c.strokeColor, c.fillColor];
    c.setStrokeColor('none');
    c.setFillColor(sc);
    if (c.stencil('mxgraph.bpmn.ad_hoc', w * 0.5 + cx + 1, h - offsetY + 4, 12, 6)) {
      cx += space;
      c.setStrokeColor(sc);
      c.setFillColor(fc);
    } else {
      c.setStrokeColor(prev[0]);
      c.setFillColor(prev[1]);
    }
  }
  const icon = (name: string, d: number, iw: number, ih: number) => c.stencil(name, d, d, iw, ih);
  switch (taskMarker) {
    case 'service':
      c.setFillColor(gv(e, 'fillColor', '#ffffff'));
      icon('mxgraph.bpmn.service_task', 2, 16, 16);
      break;
    case 'send':
      c.setStrokeColor(gv(e, 'fillColor', '#ffffff'));
      c.setFillColor(gv(e, 'strokeColor', '#000000'));
      sendMarkerAt(c, 4, 4, 18, 13);
      break;
    case 'receive':
      sendMarkerAt(c, 4, 4, 18, 13);
      break;
    case 'user':
      icon('mxgraph.bpmn.user_task', 2, 16, 16);
      break;
    case 'manual':
      icon('mxgraph.bpmn.manual_task', 3, 18, 14);
      break;
    case 'businessRule':
      icon('mxgraph.bpmn.business_rule_task', 4, 18, 14);
      break;
    case 'script':
      icon('mxgraph.bpmn.script_task', 3, 19, 18);
      break;
    default:
      break;
  }
  // 左上の事象 (20 × 20)
  eventShape(c, e, 0, 0, 20, 20, e.str('outline', 'none'), e.str('symbol', 'standard'), false);
};

/** mxShapeBpmn2Data: 付箋 (note) と、左上の矢印 (input は線、output は塗り)、下の真ん中の 3 本線 (isCollection) */
const bpmnData: ShapePainter = (c, w, h, e) => {
  SHAPES_A.note(c, w, h, e);
  const trType = e.str('bpmnTransferType', 'none');
  if (trType === 'input' || trType === 'output') {
    const ax = 3;
    const ay = ax;
    const aw = 14;
    const ah = 12;
    c.translate(ax, ay);
    c.begin();
    poly(c, [[0, ah * 0.3], [aw * 0.55, ah * 0.3], [aw * 0.55, 0], [aw, ah * 0.5], [aw * 0.55, ah], [aw * 0.55, ah * 0.7], [0, ah * 0.7]]);
    c.translate(-ax, -ay);
    if (trType === 'input') c.stroke();
    else {
      c.setFillColor(gv(e, 'strokeColor', '#000000'));
      c.fillAndStroke();
      c.setFillColor(gv(e, 'fillColor', '#ffffff'));
    }
  }
  if (truthy(e, 'isCollection', false)) {
    c.translate(w * 0.5 - 6, h - 12);
    parallelMarker(c);
    c.translate(-w * 0.5 + 6, -h + 12);
  }
};

/**
 * mxGraph の mxSwimlane.paintVertexShape (paintSwimlane・paintRoundedSwimlane・paintFooter・paintDivider・paintSeparator)。
 * 見出しの帯 (startSize、既定 mxConstants.DEFAULT_STARTSIZE の 40) と本体 (swimlaneFillColor) を描く。光沢 (glass)・画像は描かない
 */
function swimlane(c: ShapeCanvas, w: number, h: number, e: ShapeEnv) {
  let start = Math.max(0, e.num('startSize', 40));
  if (start === 0 && !truthy(e, 'fixedHeader', true)) return;
  const horiz = e.num('horizontal', 1) === 1;
  start = Math.min(start, horiz ? h : w);
  const fill = gv(e, 'swimlaneFillColor', 'none');
  const line = e.num('swimlaneLine', 1) === 1;
  const head = e.num('swimlaneHead', 1) === 1;
  const body = e.num('swimlaneBody', 1) === 1;
  let r = 0;
  if (e.rounded) {
    r = e.str('absoluteArcSize', '0') === '1' ? Math.min(w / 2, Math.min(h / 2, e.num('arcSize', 20) / 2)) : start * (e.num('arcSize', 15) / 100) * 3;
    r = Math.min((horiz ? h : w) - start, Math.min(start, r));
  }
  const paintHead = () => (head ? c.fillAndStroke() : c.fill());
  const paintBody = () => {
    if (body) fill === 'none' ? c.stroke() : c.fillAndStroke();
    else if (fill !== 'none') c.fill();
  };
  c.begin();
  if (!e.rounded) {
    if (horiz) poly(c, [[0, start], [0, 0], [w, 0], [w, start]], false);
    else poly(c, [[start, 0], [0, 0], [0, h], [start, h]], false);
  } else if (horiz) {
    c.moveTo(w, start);
    c.lineTo(w, r);
    c.quadTo(w, 0, w - Math.min(w / 2, r), 0);
    c.lineTo(Math.min(w / 2, r), 0);
    c.quadTo(0, 0, 0, r);
    c.lineTo(0, start);
  } else {
    c.moveTo(start, 0);
    c.lineTo(r, 0);
    c.quadTo(0, 0, 0, Math.min(h / 2, r));
    c.lineTo(0, h - Math.min(h / 2, r));
    c.quadTo(0, h, r, h);
    c.lineTo(start, h);
  }
  paintHead();
  if (start < (horiz ? h : w)) {
    if (fill !== 'none') c.setFillColor(fill);
    c.begin();
    if (!e.rounded) {
      if (horiz) poly(c, [[0, start], [0, h], [w, h], [w, start]], false);
      else poly(c, [[start, 0], [w, 0], [w, h], [start, h]], false);
    } else if (horiz) {
      c.moveTo(0, start);
      c.lineTo(0, h - r);
      c.quadTo(0, h, Math.min(w / 2, r), h);
      c.lineTo(w - Math.min(w / 2, r), h);
      c.quadTo(w, h, w, h - r);
      c.lineTo(w, start);
    } else {
      c.moveTo(start, h);
      c.lineTo(w - r, h);
      c.quadTo(w, h, w, h - Math.min(h / 2, r));
      c.lineTo(w, Math.min(h / 2, r));
      c.quadTo(w, 0, w - r, 0);
      c.lineTo(start, 0);
    }
    paintBody();
  }
  if (line && start !== 0) {
    c.begin();
    if (horiz) poly(c, [[0, start], [w, start]], false);
    else poly(c, [[start, 0], [start, h]], false);
    c.stroke();
  }
  // paintFooter: 本体の下 (縦の帯なら右) の footerSize の帯を、見出しの塗りで塗る
  const size = horiz ? h : w;
  const footer = Math.min(Math.max(0, e.num('footerSize', 0)), size - start);
  if (footer > 0) {
    if (e.fill) c.setFillColor(e.fill);
    c.begin();
    if (horiz) {
      const rr = Math.min(w / 2, r);
      if (footer >= r) {
        c.moveTo(0, h - footer);
        c.lineTo(0, h - r);
        c.quadTo(0, h, rr, h);
        c.lineTo(w - rr, h);
        c.quadTo(w, h, w, h - r);
        c.lineTo(w, h - footer);
      } else {
        const t = 1 - Math.sqrt(footer / r);
        const px = rr * t * t;
        const bx = rr * t;
        c.moveTo(px, h - footer);
        c.quadTo(bx, h, rr, h);
        c.lineTo(w - rr, h);
        c.quadTo(w - bx, h, w - px, h - footer);
      }
    } else {
      const rr = Math.min(h / 2, r);
      if (footer >= r) {
        c.moveTo(w - footer, 0);
        c.lineTo(w - r, 0);
        c.quadTo(w, 0, w, rr);
        c.lineTo(w, h - rr);
        c.quadTo(w, h, w - r, h);
        c.lineTo(w - footer, h);
      } else {
        const t = 1 - Math.sqrt(footer / r);
        const py = rr * t * t;
        const by = rr * t;
        c.moveTo(w - footer, py);
        c.quadTo(w, by, w, rr);
        c.lineTo(w, h - rr);
        c.quadTo(w, h - by, w - footer, h - py);
      }
    }
    c.close();
    if (e.fill) c.fillAndStroke();
    else c.stroke();
  }
  // paintSeparator: separatorColor の破線 (本体の右の縁、縦の帯なら上の縁)
  const sep = gv(e, 'separatorColor', 'none');
  if (sep !== 'none') {
    c.setStrokeColor(sep);
    c.setDashed(true);
    c.begin();
    if (horiz) poly(c, [[w, start], [w, h]], false);
    else poly(c, [[start, 0], [w, 0]], false);
    c.stroke();
    c.setDashed(false);
  }
}

/** mxShapeBpmn2Swimlane: スイムレーンと、下の真ん中の 3 本線 (isCollection) */
const bpmnSwimlane: ShapePainter = (c, w, h, e) => {
  swimlane(c, w, h, e);
  if (truthy(e, 'isCollection', false)) {
    c.translate(w * 0.5 - 6, h - 12);
    parallelMarker(c);
    c.translate(-w * 0.5 + 6, -h + 12);
  }
};

/** mxShapeBpmn2Conversation: 六角形 (call は 4 倍の太線) と、下の真ん中のサブプロセスの印 */
const bpmnConversation: ShapePainter = (c, w, h, e) => {
  const call = e.str('bpmnConversationType', 'conv') === 'call';
  const sw = e.num('strokeWidth', 1);
  if (call) c.setStrokeWidth(sw * 4);
  c.begin();
  poly(c, [[0, h * 0.5], [w * 0.25, 0], [w * 0.75, 0], [w, h * 0.5], [w * 0.75, h], [w * 0.25, h]]);
  c.fillAndStroke();
  if (call) c.setStrokeWidth(sw);
  if (truthy(e, 'isLoopSub', false)) {
    c.translate(w * 0.5 - 7, h - 14);
    subMarker(c);
  }
};

// ───────────── リーン生産 (mxLeanMap.js) ─────────────

/** 塗って線を引く四角 (c.rect の後の fillAndStroke) */
const box = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.rect(x, y, w, h);
  c.fillAndStroke();
};
const oval = (c: ShapeCanvas, x: number, y: number, w: number, h: number) => {
  c.ellipse(x, y, w, h);
  c.fillAndStroke();
};
const strokeOf = (e: ShapeEnv) => gv(e, 'strokeColor', '#000000');

/** 下の矢じり (かんばんの形の、左下の線の先。線の色で塗る) */
const kanbanHead = (c: ShapeCanvas, e: ShapeEnv, h: number) => {
  c.setFillColor(strokeOf(e));
  c.begin();
  poly(c, [[0, h - 10], [4, h], [8, h - 10]]);
  c.fillAndStroke();
};

/** かんばんの形の破線 (左下から上がって右へ。y は横の線の高さ) */
const kanbanLine = (c: ShapeCanvas, w: number, h: number, y: number) => {
  c.setDashed(true);
  c.begin();
  poly(c, [[4, h - 10], [4, y], [w, y]], false);
  c.stroke();
  c.setDashed(false);
};

/** 角を折ったかんばんの札 (右上の 60 × 50) */
const kanbanCard = (c: ShapeCanvas, w: number) => {
  c.begin();
  poly(c, [[w - 75, 0], [w - 30, 0], [w - 15, 15], [w - 15, 50], [w - 75, 50]]);
  c.fillAndStroke();
};

/** 見出しの線の高さ (fontSize (既定 8) の 1.5 倍。高さを超えない) */
const leanLineH = (e: ShapeEnv, h: number) => Math.min(e.num('fontSize', 8) * 1.5, h);

const LEAN: Record<string, ShapePainter> = {
  boat_shipment: (c, w, h) => {
    c.begin();
    poly(c, [[w * 0.15, h * 0.77], [w * 0.5, 0], [w * 0.85, h * 0.77]]);
    poly(c, [[w * 0.2, h], [0, h * 0.8], [w, h * 0.8], [w * 0.8, h]]);
    c.fillAndStroke();
  },
  buffer_or_safety_stock: (c, w, h) => {
    box(c, 0, 0, w, h);
    c.begin();
    segs(c, [
      [0, h * 0.34, w, h * 0.34],
      [0, h * 0.66, w, h * 0.66],
    ]);
    c.fillAndStroke();
  },
  data_box: (c, w, h) => {
    c.begin();
    poly(c, [[0, h], [0, 0], [w, 0], [w, h]], false);
    c.fillAndStroke();
    c.begin();
    segs(c, [0.2, 0.4, 0.6, 0.8].map((k) => [0, h * k, w, h * k]));
    c.stroke();
  },
  outside_sources: (c, w, h) => {
    c.begin();
    poly(c, [[0, h], [0, h * 0.3], [w * 0.33, h * 0.02], [w * 0.33, h * 0.3], [w * 0.67, h * 0.02], [w * 0.67, h * 0.3], [w, h * 0.02], [w, h]]);
    c.fillAndStroke();
  },
  manufacturing_process: (c, w, h, e) => {
    box(c, 0, 0, w, h);
    const lh = leanLineH(e, h);
    c.begin();
    poly(c, [[0, lh], [w, lh]], false);
    c.stroke();
  },
  manufacturing_process_shared: (c, w, h, e) => {
    // 見出しの下を、10 ずつずらした斜めの線 (太さは strokeWidth (既定 2) の半分) で埋める
    box(c, 0, 0, w, h);
    const lh = leanLineH(e, h);
    c.begin();
    poly(c, [[0, lh], [w, lh]], false);
    c.stroke();
    c.begin();
    c.setStrokeWidth(e.num('strokeWidth', 2) * 0.5);
    // 線は MAX_LINES 本まで (Kumiori の守り)
    for (let start = 0, n = 0; start < h + w && n < MAX_LINES; n++) {
      start += 10;
      if (start > lh) {
        const sx = Math.max(0, start - h);
        const sy = Math.min(start, h);
        const ex = Math.min(start - lh, w);
        const ey = Math.max(start - w, lh);
        if (sx < w) {
          c.moveTo(sx, sy);
          c.lineTo(ex, ey);
        }
      }
    }
    c.stroke();
  },
  work_cell: (c, w, h) => {
    c.begin();
    poly(c, [[0, 0], [w, 0], [w, h], [w * 0.65, h], [w * 0.65, h * 0.4], [w * 0.35, h * 0.4], [w * 0.35, h], [0, h]]);
    c.fillAndStroke();
  },
  inventory_box: (c, w, h) => {
    c.begin();
    poly(c, [[0, h], [w * 0.5, 0], [w, h]]);
    c.fillAndStroke();
    c.begin();
    segs(c, [
      [w * 0.4, h * 0.45, w * 0.6, h * 0.45],
      [w * 0.5, h * 0.45, w * 0.5, h * 0.85],
      [w * 0.4, h * 0.85, w * 0.6, h * 0.85],
    ]);
    c.stroke();
  },
  push_arrow: (c, w, h, e) => {
    c.begin();
    poly(c, [[0, h * 0.17], [w * 0.75, h * 0.17], [w * 0.75, 0], [w, h * 0.5], [w * 0.75, h], [w * 0.75, h * 0.83], [0, h * 0.83]]);
    c.fillAndStroke();
    c.setFillColor(strokeOf(e));
    for (const x of [0, 0.24, 0.48]) {
      c.rect(w * x, h * 0.17, w * 0.12, h * 0.66);
      c.fill();
    }
    c.begin();
    poly(c, [[w * 0.72, h * 0.17], [w * 0.75, h * 0.17], [w * 0.75, 0], [w, h * 0.5], [w * 0.75, h], [w * 0.75, h * 0.83], [w * 0.72, h * 0.83]]);
    c.fill();
  },
  supermarket: (c, w, h) => {
    c.begin();
    poly(c, [[0, 0], [w, 0], [w, h], [0, h]], false);
    segs(c, [
      [0, h * 0.33, w, h * 0.33],
      [0, h * 0.67, w, h * 0.67],
    ]);
    c.fillAndStroke();
  },
  physical_pull: (c, w, h) => {
    c.begin();
    c.moveTo(w * 0.732, h * 0.0736);
    c.arcTo(w * 0.4827, h * 0.4959, 0, 1, 0, w * 0.9553, h * 0.6191);
    c.stroke();
    c.begin();
    poly(c, [[w * 0.9071, h * 0.6191], [w * 0.9794, h * 0.4951], [w, h * 0.6438]]);
    c.fillAndStroke();
  },
  fifo_lane: (c, w, h, e) => {
    const lh = leanLineH(e, h);
    c.begin();
    segs(c, [
      [0, lh, w, lh],
      [0, h, w, h],
    ]);
    c.stroke();
    box(c, w * 0.02, lh + 4, w * 0.26, h - lh - 8);
    oval(c, w * 0.35, lh + 4, w * 0.26, h - lh - 8);
    c.begin();
    poly(c, [[w * 0.69, lh + 4], [w * 0.98, lh + 4], [w * 0.835, h - 4]]);
    c.fillAndStroke();
  },
  truck_shipment: (c, w, h, e) => {
    box(c, 0, 0, w * 0.6, h * 0.8);
    box(c, w * 0.6, h * 0.35, w * 0.4, h * 0.45);
    c.setFillColor(strokeOf(e));
    oval(c, w * 0.15, h * 0.8, w * 0.2, h * 0.2);
    oval(c, w * 0.65, h * 0.8, w * 0.2, h * 0.2);
  },
  schedule: (c, w, h) => box(c, 0, 0, w, h),
  fifo_sequence_flow: (c, w, h, e) => {
    c.begin();
    segs(c, [
      [0, 0, w, 0],
      [0, h, w, h],
      [w * 0.05, h * 0.5, w * 0.15, h * 0.5],
      [w * 0.75, h * 0.5, w * 0.88, h * 0.5],
    ]);
    c.stroke();
    c.setFillColor(strokeOf(e));
    c.begin();
    poly(c, [[w * 0.88, h * 0.39], [w * 0.98, h * 0.5], [w * 0.88, h * 0.61]], false);
    c.fillAndStroke();
  },
  production_kanban: (c, w, h, e) => {
    kanbanLine(c, w, h, 25);
    kanbanCard(c, w);
    kanbanHead(c, e, h);
  },
  withdrawal_kanban: (c, w, h, e) => {
    kanbanLine(c, w, h, 25);
    kanbanCard(c, w);
    c.begin();
    segs(c, [
      [w - 75, 45, w - 70, 50],
      [w - 75, 35, w - 60, 50],
      [w - 75, 25, w - 50, 50],
      [w - 75, 15, w - 40, 50],
      [w - 75, 5, w - 30, 50],
      [w - 70, 0, w - 20, 50],
      [w - 60, 0, w - 15, 45],
      [w - 50, 0, w - 15, 35],
      [w - 40, 0, w - 15, 25],
    ]);
    c.stroke();
    kanbanHead(c, e, h);
  },
  signal_kanban: (c, w, h, e) => {
    kanbanLine(c, w, h, 15);
    c.begin();
    poly(c, [[w - 65, 0], [w - 25, 0], [w - 45, 45]]);
    c.fillAndStroke();
    kanbanHead(c, e, h);
  },
  sequenced_pull_ball: (c, w, h, e) => {
    oval(c, 0, 0, w, h);
    c.setFillColor(strokeOf(e));
    oval(c, w * 0.15, h * 0.15, w * 0.7, h * 0.7);
  },
  rail_shipment: (c, w, h) => {
    box(c, w * 0.1, 0, w * 0.35, h * 0.8);
    box(c, w * 0.55, 0, w * 0.35, h * 0.8);
    c.begin();
    segs(c, [
      [0, h, w, h],
      [w * 0.45, h * 0.7, w * 0.55, h * 0.7],
    ]);
    c.stroke();
    for (const x of [0.15, 0.34, 0.6, 0.79]) oval(c, w * x, h * 0.8, w * 0.06, h * 0.2);
  },
  warehouse: (c, w, h) => {
    box(c, 0, 0, w, h);
    c.begin();
    segs(c, [[0, h * 0.4, w, h * 0.4]]);
    poly(c, [[w * 0.15, h], [w * 0.15, h * 0.55], [w * 0.3, h * 0.55], [w * 0.3, h]], false);
    c.stroke();
    c.ellipse(w * 0.27, h * 0.75, w * 0.02, w * 0.02);
    c.stroke();
  },
  timeline: (c, w, h, e) => {
    // mainText は「時間,名前,時間,名前,…」。時間の割合で横に区切り、偶数番の区間は下に、奇数番は上に名前を書く
    const info = e.str('mainText', '20,Time 1,50,Time 2,30,Time 3,40,Time 4,30,Time 5,50,Time 6,20,Time 7').split(',');
    const fontSize = e.num('fontSize', 12);
    const times: number[] = [];
    const names: string[] = [];
    info.forEach((s, k) => (k % 2 ? names.push(s) : times.push(parseFloat(s))));
    const total = times.reduce((a, b) => a + b, 0);
    const scaleX = w / total;
    c.begin();
    let x = 0;
    c.moveTo(0, h);
    names.forEach((name, k) => {
      const t = times[k] * scaleX;
      x += t;
      if (k % 2 === 0) {
        c.lineTo(x, h);
        c.lineTo(x, fontSize * 1.5);
        c.text(x - t * 0.5, h - fontSize * 0.75, 0, 0, name, 'center', 'middle');
      } else {
        c.lineTo(x, fontSize * 1.5);
        c.lineTo(x, h);
        c.text(x - t * 0.5, fontSize * 0.75, 0, 0, name, 'center', 'middle');
      }
    });
    c.stroke();
  },
  crossDock: (c, w, h) => {
    box(c, 0, 0, w, h);
    c.begin();
    segs(c, [[0, h * 0.25, w, h * 0.25]]);
    c.moveTo(w * 0.1, h * 0.4);
    c.lineTo(w * 0.35, h * 0.4);
    c.arcTo(w * 0.15, h * 0.15, 0, 0, 1, w * 0.5, h * 0.5);
    c.arcTo(w * 0.15, h * 0.15, 0, 0, 0, w * 0.65, h * 0.6);
    c.lineTo(w * 0.9, h * 0.6);
    c.stroke();
    // ソースは続けて 4 本の曲線を begin なしで描くが、mxSvgCanvas2D では要素が無いので描かれない (ファイルの先頭の注)
  },
  orders: (c, w, h, e) => {
    box(c, 0, h * 0.56, w, h * 0.44);
    c.setStrokeWidth(e.num('strokeWidth', 2) * 0.5);
    c.begin();
    segs(
      c,
      (
        [
          [0.04, 0.5418, 0.94], [0.0522, 0.5088, 0.9522], [0.05, 0.4738, 0.95], [0.0456, 0.4427, 0.9456], [0.0422, 0.4135, 0.9422], [0.0533, 0.3804, 0.9533], [0.0556, 0.3454, 0.9556], [0.05, 0.3143, 0.95],
          [0.0489, 0.2832, 0.0489], [0.0544, 0.254, 0.9544], [0.0489, 0.221, 0.9489], [0.0556, 0.1918, 0.9556], [0.0522, 0.1587, 0.9522], [0.0544, 0.1276, 0.9544], [0.0544, 0.0965, 0.9544], [0.0556, 0.0654, 0.9556],
          [0.0533, 0.0304, 0.9533], [0.0556, 0, 0.9556],
        ] as number[][]
      ).map(([x0, y, x1]) => [w * x0, h * y, w * x1, h * y]),
    );
    c.stroke();
  },
  control_center: (c, w, h) => {
    box(c, w * 0.15, 0, w * 0.7, h * 0.8);
    box(c, 0, h * 0.8, w, h * 0.2);
  },
  timeline2: (c, w, h, e) => {
    // dy1〜dy6 (0.5 以下なら上、より大きいなら下) と dx2〜dx5 (横の位置) の、上下に行き来する折れ線
    let up = e.num('dy1', 0) <= 0.5;
    c.begin();
    c.moveTo(0, up ? 0 : h);
    const step = (x: number, dy: number) => {
      const goUp = dy <= 0.5;
      if (goUp && up) c.lineTo(x, 0);
      else if (!goUp && !up) c.lineTo(x, h);
      else if (goUp) {
        c.lineTo(x, h);
        c.lineTo(x, 0);
      } else {
        c.lineTo(x, 0);
        c.lineTo(x, h);
      }
      up = goUp;
    };
    for (const k of [2, 3, 4, 5]) step(e.num(`dx${k}`, 0), e.num(`dy${k}`, 0));
    step(w, e.num('dy6', 0));
    c.stroke();
  },
};

/** 束ねたかんばん: 幅は 110 以上。横の線と、ずらして重ねた 3 枚の札と、右の端の矢じり */
LEAN.batched_kanban = (c, w0, h, e) => {
  const w = Math.max(110, w0);
  c.begin();
  poly(c, [[4, h * 0.5], [w, h * 0.5]], false);
  c.stroke();
  const m = w * 0.5;
  const y = h * 0.5;
  // 3 枚の札 (右上から左下へ 10 ずつずらす)
  for (const d of [0, -10, -20]) {
    c.begin();
    poly(c, [[m - 20 + d, y - 35 - d], [m + 25 + d, y - 35 - d], [m + 40 + d, y - 20 - d], [m + 40 + d, y + 15 - d], [m - 20 + d, y + 15 - d]]);
    c.fillAndStroke();
  }
  c.setFillColor(strokeOf(e));
  c.begin();
  poly(c, [[w - 10, y - 4], [w, y], [w - 10, y + 4]]);
  c.fillAndStroke();
};

// ───────────── 間取り図 (mxFloorplan.js) ─────────────

/** 壁の厚さ (wallThickness、既定 10) */
const wallTh = (e: ShapeEnv) => e.num('wallThickness', 10);
/** 戸の大きさ: dx (割合。既定はクラスごと) に幅を掛ける (min(w, dx) で切るのはソースのまま) */
const doorDx = (e: ShapeEnv, w: number, d: number) => w * Math.max(0, Math.min(w, e.num('dx', d)));

/** 戸の開く弧 (from から弧を描いて to へ、続けて最後の点へ線) */
const swing = (c: ShapeCanvas, x0: number, y0: number, r: number, sweep: number, x1: number, y1: number, x2: number, y2: number) => {
  c.moveTo(x0, y0);
  c.arcTo(r, r, 0, 0, sweep, x1, y1);
  c.lineTo(x2, y2);
};

const FLOORPLAN: Record<string, ShapePainter> = {
  wall: (c, w, h, e) => box(c, 0, h * 0.5 - wallTh(e) * 0.5, w, wallTh(e)),
  wallCorner: (c, w, h, e) => {
    const t = wallTh(e);
    c.begin();
    poly(c, [[0, h], [0, 0], [w, 0], [w, t], [t, t], [t, h]]);
    c.fillAndStroke();
  },
  wallU: (c, w, h, e) => {
    const t = wallTh(e);
    c.begin();
    poly(c, [[0, h], [0, 0], [w, 0], [w, h], [w - t, h], [w - t, t], [t, t], [t, h]]);
    c.fillAndStroke();
  },
  room: (c, w, h, e) => {
    const t = wallTh(e);
    c.begin();
    poly(c, [[0, h], [0, 0], [w, 0], [w, h]]);
    poly(c, [[t, t], [t, h - t], [w - t, h - t], [w - t, t]]);
    c.fillAndStroke();
  },
  window: (c, w, h, e) => {
    box(c, 0, h * 0.5 - wallTh(e) * 0.5, w, wallTh(e));
    c.begin();
    poly(c, [[0, h * 0.5], [w, h * 0.5]], false);
    c.stroke();
  },
  dimension: (c, w, h) => {
    c.begin();
    segs(c, [[0, 20, w, 20]]);
    poly(c, [[10, 15], [0, 20], [10, 25]], false);
    poly(c, [[w - 10, 15], [w, 20], [w - 10, 25]], false);
    segs(c, [
      [0, 15, 0, h],
      [w, 15, w, h],
    ]);
    c.stroke();
  },
  dimensionBottom: (c, w, h) => {
    c.begin();
    segs(c, [[0, h - 20, w, h - 20]]);
    poly(c, [[10, h - 15], [0, h - 20], [10, h - 25]], false);
    poly(c, [[w - 10, h - 15], [w, h - 20], [w - 10, h - 25]], false);
    segs(c, [
      [0, h - 15, 0, 0],
      [w, h - 15, w, 0],
    ]);
    c.stroke();
  },
  stairs: (c, w0, h) => {
    // 幅は 50 以上。25 ごとの段の線と、真ん中の矢印
    const w = Math.max(w0, 50);
    box(c, 0, 0, w, h);
    c.begin();
    // 段は MAX_LINES 本まで (Kumiori の守り)
    for (let x = 25, n = 0; x < w && n < MAX_LINES; x += 25, n++) segs(c, [[x, 0, x, h]]);
    c.stroke();
    c.begin();
    segs(c, [[0, h * 0.5, w, h * 0.5]]);
    poly(c, [[w - 25, 0], [w, h * 0.5], [w - 25, h]], false);
    c.stroke();
  },
  stairsRest: (c, w0, h) => {
    // 幅は 50 と高さ以上。右の端の踊り場 (高さの半分の幅) の手前まで段の線
    const w = Math.max(w0, 50, h);
    box(c, 0, 0, w, h);
    c.begin();
    // 段は MAX_LINES 本まで (Kumiori の守り)
    for (let x = 25, n = 0; x < w - h * 0.5 && n < MAX_LINES; x += 25, n++) segs(c, [[x, 0, x, h]]);
    c.stroke();
    c.begin();
    segs(c, [[0, h * 0.5, w, h * 0.5]]);
    poly(c, [[w, 0], [w - h * 0.5, h * 0.5], [w, h]], false);
    segs(c, [
      [w - h * 0.5, 0, w - h * 0.5, h],
      [0, h * 0.5, w, h * 0.5],
    ]);
    c.stroke();
  },
  doorLeft: (c, w) => {
    box(c, 0, 0, w, 5);
    c.begin();
    swing(c, w, 5, w, 1, 0, 5 + w, 0, 5);
    c.stroke();
  },
  doorRight: (c, w) => {
    box(c, 0, 0, w, 5);
    c.begin();
    swing(c, 0, 5, w, 0, w, 5 + w, w, 5);
    c.stroke();
  },
  doorDouble: (c, w) => {
    const hw = w * 0.5;
    box(c, 0, 0, w, 5);
    c.begin();
    segs(c, [[hw, 0, hw, 5]]);
    swing(c, hw, 5, hw, 1, 0, 5 + hw, 0, 5);
    swing(c, hw, 5, hw, 0, w, 5 + hw, w, 5);
    c.stroke();
  },
  doorUneven: (c, w, _h, e) => {
    const dx = doorDx(e, w, 0.3);
    box(c, 0, 0, w, 5);
    c.begin();
    c.moveTo(dx, 0);
    c.lineTo(dx, 5);
    c.arcTo(dx, dx, 0, 0, 1, 0, 5 + dx);
    c.lineTo(0, 5);
    swing(c, dx, 5, w - dx, 0, w, 5 + w - dx, w, 5);
    c.stroke();
  },
  doorOpposing: (c, w, _h, e) => {
    const dx = doorDx(e, w, 0.3);
    box(c, 0, dx, w, 5);
    c.begin();
    c.moveTo(dx, dx);
    c.lineTo(dx, dx + 5);
    c.arcTo(dx, dx, 0, 0, 0, 0, 0);
    c.lineTo(0, dx);
    swing(c, dx, dx + 5, w - dx, 0, w, 5 + w, w, dx + 5);
    c.stroke();
  },
  doorRevolving: (c, w, h) => {
    const d = Math.min(w, h);
    box(c, (w - d) * 0.5, h * 0.5 - 2.5, d, 5);
    box(c, w * 0.5 - 2.5, (h - d) * 0.5, 5, d);
    c.begin();
    c.ellipse((w - d) * 0.5, (h - d) * 0.5, d, d);
    c.stroke();
  },
  doorPocket: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    box(c, dx, h * 0.5 - 5, 5, 10);
    box(c, w - 5, h * 0.5 - 5, 5, 10);
    box(c, 0, h * 0.5 - 2.5, w - dx, 5);
  },
  doorDoublePocket: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    box(c, dx, h * 0.5 - 5, 5, 10);
    box(c, w - dx - 5, h * 0.5 - 5, 5, 10);
    box(c, 0, h * 0.5 - 2.5, w * 0.5 - dx, 5);
    box(c, w * 0.5 + dx, h * 0.5 - 2.5, w * 0.5 - dx, 5);
  },
  doorBypass: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    box(c, 0, h * 0.5 - 5, 5, 10);
    box(c, w - 5, h * 0.5 - 5, 5, 10);
    box(c, 0, h * 0.5, w * 0.5, 5);
    box(c, dx, h * 0.5 - 5, w * 0.5, 5);
  },
  doorBifold: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    // 線の太さの既定はソースのまま this.dx (0.5)
    const sw = e.num('strokeWidth', 0.5);
    box(c, 0, h - 10, 5, 10);
    box(c, w - 5, h - 10, 5, 10);
    c.setStrokeWidth(sw * 3);
    c.begin();
    poly(c, [[5, h - 10], [Math.max((dx - 10) * 0.5 + 5, 5), 0], [Math.max(dx, 5), h - 10]], false);
    poly(c, [[w - 5, h - 10], [w - Math.max((dx - 10) * 0.5 + 5, 5), 0], [w - Math.max(dx, 5), h - 10]], false);
    c.stroke();
  },
  doorSlidingGlass: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    box(c, 0, h * 0.5 - 5, 5, 10);
    box(c, w - 5, h * 0.5 - 5, 5, 10);
    box(c, 0, h * 0.5, w * 0.5, 2);
    box(c, dx, h * 0.5 - 2, w * 0.5, 2);
  },
  doorOverhead: (c, w, h) => {
    box(c, 0, h - 10, 5, 10);
    box(c, w - 5, h - 10, 5, 10);
    box(c, 5, 0, w - 10, h - 5);
  },
  opening: (c, w, h) => {
    box(c, 0, 0, 5, h);
    box(c, w - 5, 0, 5, h);
  },
  windowGlider: (c, w, h, e) => {
    const dx = doorDx(e, w, 0.5);
    box(c, 0, h * 0.5 - 5, w, 10);
    box(c, 0, h * 0.5, w * 0.5, 1);
    box(c, dx, h * 0.5 - 1, w * 0.5, 1);
  },
  windowGarden: (c, w, h, e) => {
    // 窓の枚数 (windowPanes、既定 3、20 まで) の枠を 1 つの経路で
    const panes = Math.min(e.num('windowPanes', 3), 20);
    const d = 2;
    const pw = (w - 14 - (panes - 1) * d) / panes;
    box(c, 0, h - 10, 5, 10);
    box(c, w - 5, h - 10, 5, 10);
    c.begin();
    poly(c, [[5, h], [5, 0], [w - 5, 0], [w - 5, h], [w - 5 - d, h], [w - 5 - d, d]], false);
    for (let k = 1; k < panes; k++) {
      const x0 = w - 5 - d - k * pw - (k - 1) * d;
      const x1 = w - 5 - 2 * d - (k - 1) * d - k * pw;
      c.lineTo(x0, d);
      c.lineTo(x0, h);
      c.lineTo(x1, h);
      c.lineTo(x1, d);
    }
    c.lineTo(5 + d, d);
    c.lineTo(5 + d, h);
    c.close();
    c.fillAndStroke();
  },
  windowBow: (c, w, h) => {
    const d = Math.min(w * 0.5, h);
    c.begin();
    poly(c, [[0, (h - d) * 0.5], [d, (h + d) * 0.5], [w - d, (h + d) * 0.5], [w, (h - d) * 0.5]], false);
    c.stroke();
  },
  windowBay: (c, w, h) => {
    c.begin();
    poly(c, [[0, 0], [w * 0.15, h * 0.6], [w * 0.35, h], [w * 0.65, h], [w * 0.85, h * 0.6], [w, 0]], false);
    c.stroke();
  },
  doorAccordion: (c, w, h, e) => {
    const dx = Math.min(w - 5, Math.max(5, doorDx(e, w, 0.5)));
    const sw = e.num('strokeWidth', 0.5);
    box(c, 0, h * 0.5 - 5, 5, 10);
    box(c, w - 5, h * 0.5 - 5, 5, 10);
    c.setStrokeWidth(sw * 3);
    const l = dx - 5;
    c.begin();
    poly(c, [[5, h * 0.5], [5 + l * 0.1, 0], [5 + l * 0.3, h], [5 + l * 0.5, 0], [5 + l * 0.7, h], [5 + l * 0.9, 0], [5 + l, h * 0.5]], false);
    c.stroke();
  },
  doorDoubleAction: (c, w, h) => {
    box(c, 0, h * 0.5 - 2.5, w, 5);
    c.begin();
    swing(c, w, h * 0.5 + 2.5, w, 1, 0, h * 0.5 + 2.5 + w, 0, h * 0.5 + 2.5);
    c.stroke();
    c.setDashed(true);
    c.begin();
    swing(c, w, h * 0.5 - 2.5, w, 0, 0, h * 0.5 - 2.5 - w, 0, h * 0.5 - 2.5);
    c.stroke();
  },
};

// ───────────── ER 図 (er/mxER.js) ─────────────

/** 文字の大きさ (fontSize、既定 17) と色 (textColor、既定 #666666) */
const erFont = (e: ShapeEnv) => ({ size: e.num('fontSize', 17), color: gv(e, 'textColor', '#666666') });

/** 点 (x, y) を真ん中にした文字 */
const erText = (c: ShapeCanvas, x: number, y: number, s: string | undefined, align = 'center') => c.text(x, y, 0, 0, s ?? '', align, 'middle');

/** 角を半径 r で丸めた四角の経路 (arcTo の 4 つの角) */
const roundBox = (c: ShapeCanvas, w: number, h: number, r: number) => {
  c.moveTo(0, r);
  c.arcTo(r, r, 0, 0, 1, r, 0);
  c.lineTo(w - r, 0);
  c.arcTo(r, r, 0, 0, 1, w, r);
  c.lineTo(w, h - r);
  c.arcTo(r, r, 0, 0, 1, w - r, h);
  c.lineTo(r, h);
  c.arcTo(r, r, 0, 0, 1, 0, h - r);
};

/** buttonStyle の背景 (round・rect・dblFrame。dblFrame の塗りは fillColor (既定 fill)、内に 1 割の枠) */
const erBack = (c: ShapeCanvas, e: ShapeEnv, w: number, h: number, r: number, style: string, dblFill: string) => {
  if (style === 'round') {
    c.begin();
    roundBox(c, w, h, r);
    c.close();
    c.fillAndStroke();
  } else if (style === 'rect') {
    c.begin();
    poly(c, [[0, 0], [w, 0], [w, h], [0, h]]);
    c.fillAndStroke();
  } else if (style === 'dblFrame') {
    c.setFillColor(gv(e, 'fillColor', dblFill));
    c.begin();
    poly(c, [[0, 0], [w, 0], [w, h], [0, h]]);
    c.fillAndStroke();
    const k = Math.min(w, h) * 0.1;
    c.begin();
    poly(c, [[k, k], [w - k, k], [w - k, h - k], [k, h - k]]);
    c.stroke();
  }
};

/** 1 つの文字を真ん中に置く ER の形の共通 (mxShapeEREntity・Attribute・Has・Cloud: 幅・高さは 20 以上) */
const erSimple =
  (back: (c: ShapeCanvas, e: ShapeEnv, w: number, h: number) => void): ShapePainter =>
  (c, w0, h0, e) => {
    const text = e.str('buttonText', 'Entity');
    const font = erFont(e);
    const w = Math.max(w0, 20);
    const h = Math.max(h0, 20);
    back(c, e, w, h);
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, w * 0.5, h * 0.5, text);
  };

/** 菱形の経路 (枠の k の割合の内側) */
const rhombus = (c: ShapeCanvas, w: number, h: number, k: number) =>
  poly(c, [
    [w * k, h * 0.5],
    [w * 0.5, h * k],
    [w * (1 - k), h * 0.5],
    [w * 0.5, h * (1 - k)],
  ]);

/** 凡例の形の外の四角 */
const erFrame = (c: ShapeCanvas, w: number, h: number) => {
  c.begin();
  poly(c, [[0, 0], [w, 0], [w, h], [0, h]]);
  c.fillAndStroke();
};

const ER: Record<string, ShapePainter> = {
  entity: erSimple((c, e, w, h) => erBack(c, e, w, h, 10, e.str('buttonStyle', 'round'), '#ffffff')),
  entityExt: (c, w0, h0, e) => {
    // 見出し (buttonText) の帯を fillColor (既定 #008cff) で、属性 (subText をコンマで区切る) の欄を fillColor2 (既定 #ffffff) で塗る
    const text = e.str('buttonText', 'Entity');
    const attrs = e.str('subText', '+ attribute 1,+ attribute 2,+ attribute 3').split(',');
    const strokeColor = gv(e, 'strokeColor', '#666666');
    const fontSize = e.num('fontSize', 17);
    const attrColor = gv(e, 'fillColor2', '#ffffff');
    const r = 10;
    const barY = fontSize * 1.25;
    const maxW = Math.max(0, ...attrs.map((s) => textWidth(s, fontSize)));
    const w = Math.max(w0, 2 * r, maxW + r);
    const h = Math.max(h0, 2 * r, (attrs.length + 1) * barY);
    const style = e.str('buttonStyle', 'round');
    const outline = () => {
      if (style === 'round') roundBox(c, w, h, r);
      else if (style === 'rect') poly(c, [[0, 0], [w, 0], [w, h], [0, h]], false);
      c.close();
    };
    c.begin();
    outline();
    c.fillAndStroke();
    if (style === 'round') {
      c.begin();
      c.moveTo(0, r);
      c.arcTo(r, r, 0, 0, 1, r, 0);
      c.lineTo(w - r, 0);
      c.arcTo(r, r, 0, 0, 1, w, r);
      c.lineTo(w, barY);
      c.lineTo(0, barY);
      c.close();
      c.fill();
      c.setFillColor(attrColor);
      c.begin();
      c.moveTo(w, barY);
      c.lineTo(w, h - r);
      c.arcTo(r, r, 0, 0, 1, w - r, h);
      c.lineTo(r, h);
      c.arcTo(r, r, 0, 0, 1, 0, h - r);
      c.lineTo(0, barY);
      c.close();
      c.fill();
    } else if (style === 'rect') {
      c.begin();
      poly(c, [[0, 0], [w, 0], [w, barY], [0, barY]]);
      c.fill();
      c.setFillColor(attrColor);
      c.begin();
      poly(c, [[0, barY], [w, barY], [w, h], [0, h]]);
      c.fill();
    }
    c.begin();
    outline();
    c.stroke();
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(attrColor);
    erText(c, w * 0.5, fontSize * 0.5, text);
    attrs.forEach((a, k) => {
      c.begin();
      c.setFontSize(fontSize);
      c.setFontColor(strokeColor);
      erText(c, r * 0.5, (k + 1.5) * barY, a, 'left');
    });
  },
  attribute: erSimple((c, e, w, h) => {
    const style = e.str('buttonStyle', 'simple');
    if (style === 'simple') {
      c.begin();
      c.ellipse(0, 0, w, h);
      c.fillAndStroke();
    } else if (style === 'dblFrame') {
      c.setFillColor(gv(e, 'fillColor', '#666666'));
      c.begin();
      c.ellipse(0, 0, w, h);
      c.fillAndStroke();
      const k = Math.min(w, h);
      c.begin();
      c.ellipse(k * 0.1, k * 0.1, w - k * 0.2, h - k * 0.2);
      c.stroke();
    }
  }),
  has: erSimple((c, e, w, h) => {
    const style = e.str('buttonStyle', 'rhombus');
    if (style === 'rhombus') {
      c.begin();
      rhombus(c, w, h, 0);
      c.fillAndStroke();
    } else if (style === 'dblFrame') {
      c.setFillColor(gv(e, 'fillColor', '#666666'));
      c.begin();
      rhombus(c, w, h, 0);
      c.fillAndStroke();
      c.begin();
      rhombus(c, w, h, 0.1);
      c.stroke();
    }
  }),
  cloud: erSimple((c, _e, w, h) => {
    c.begin();
    c.moveTo(0.25 * w, 0.25 * h);
    c.curveTo(0.05 * w, 0.25 * h, 0, 0.5 * h, 0.16 * w, 0.55 * h);
    c.curveTo(0, 0.66 * h, 0.18 * w, 0.9 * h, 0.31 * w, 0.8 * h);
    c.curveTo(0.4 * w, h, 0.7 * w, h, 0.8 * w, 0.8 * h);
    c.curveTo(w, 0.8 * h, w, 0.6 * h, 0.875 * w, 0.5 * h);
    c.curveTo(w, 0.3 * h, 0.8 * w, 0.1 * h, 0.625 * w, 0.2 * h);
    c.curveTo(0.5 * w, 0.05 * h, 0.3 * w, 0.05 * h, 0.25 * w, 0.25 * h);
    c.fillAndStroke();
  }),
  hierarchy: (c, w0, h0, e) => {
    // 外の枠と、右半分の内の枠。左に buttonText、右に subText の 2 つずつ (コンマで区切る)
    const main = e.str('buttonText', 'main').split(',');
    const sub = e.str('subText', 'sub').split(',');
    const font = erFont(e);
    const r = 10;
    const W = Math.max(w0, 2 * r);
    const H = Math.max(h0, 2 * r);
    const style = e.str('buttonStyle', 'round');
    erBack(c, e, W, H, r, style, '#666666');
    let tx = 0;
    let ty = 0;
    if (style === 'round' || style === 'rect') {
      tx = W * 0.5;
      ty = r;
      c.translate(tx, ty);
      const w = W * 0.5 - r;
      const h = H - 2 * r;
      c.begin();
      if (style === 'round') {
        roundBox(c, w, h, r);
        c.close();
      } else poly(c, [[0, 0], [w, 0], [w, h], [0, h]]);
      c.fillAndStroke();
    } else if (style === 'dblFrame') {
      tx = W * 0.5;
      ty = r * 0.15;
      c.translate(tx, ty);
      erBack(c, e, W * 0.5 - r * 0.15, H - r * 0.3, r, 'dblFrame', '#666666');
    }
    c.translate(-tx, -ty);
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, W * 0.25, (H - font.size) * 0.5, main[0]);
    erText(c, W * 0.25, (H + font.size) * 0.5, main[1]);
    erText(c, W * 0.7, (H - font.size) * 0.5, sub[0]);
    erText(c, W * 0.7, (H + font.size) * 0.5, sub[1]);
  },
  note: (c, w0, h0, e) => {
    // 右上を 20 折った付箋。折った三角は fillColor2 (既定 #ffffff) で塗り、角を丸く結ぶ
    const text = e.str('buttonText', 'Entity');
    const font = erFont(e);
    const back = gv(e, 'fillColor2', '#ffffff');
    const fs = 20;
    const w = Math.max(w0, fs * 2);
    const h = Math.max(h0, fs * 2);
    c.begin();
    poly(c, [[0, 0], [w - fs, 0], [w, fs], [w, h], [0, h]]);
    c.fillAndStroke();
    c.setLineJoin('round');
    c.setFillColor(back);
    c.begin();
    poly(c, [[w - fs, 0], [w, fs], [w - fs, fs]]);
    c.fillAndStroke();
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, w * 0.5, h * 0.5, text);
  },
  chens: (c, w0, h0, e) => {
    // Chen の記法の凡例 (表の線と決まった文字)
    const font = erFont(e);
    const w = Math.max(w0, 40);
    const h = Math.max(h0, 40);
    erFrame(c, w, h);
    c.begin();
    segs(c, [
      [0, h * 0.25, w, h * 0.25],
      [0, h * 0.5, w, h * 0.5],
      [0, h * 0.75, w, h * 0.75],
      [w * 0.25, h * 0.5, w * 0.25, h],
      [w * 0.5, h * 0.25, w * 0.5, h],
      [w * 0.75, h * 0.5, w * 0.75, h],
    ]);
    c.stroke();
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, w * 0.5, h * 0.125, "ERD Peter Chen's Notation");
    c.setFontSize(font.size * 0.85);
    erText(c, w * 0.25, h * 0.375, 'Cardinality');
    erText(c, w * 0.75, h * 0.375, 'Optionality');
    c.setFontSize(font.size * 0.7);
    const cells: Array<[number, number, string]> = [
      [0.125, 0.625, '1'], [0.375, 0.625, 'One'], [0.625, 0.625, '0'], [0.875, 0.625, 'Optional'],
      [0.125, 0.875, 'N'], [0.375, 0.875, 'Many'], [0.625, 0.875, '1'], [0.875, 0.875, 'Mandatory'],
    ];
    for (const [x, y, s] of cells) erText(c, w * x, h * y, s);
  },
  bachmans: (c, w, h, e) => {
    // Bachman の記法の凡例。左の欄に線の見本、右の欄に名前
    const font = erFont(e);
    erFrame(c, w, h);
    c.begin();
    segs(c, [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((k) => [0, h * k, w, h * k]));
    segs(c, [[w * 0.5, h * 0.125, w * 0.5, h]]);
    c.stroke();
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, w * 0.5, h * 0.0625, "ERD Bachman's Notation");
    c.setFontSize(font.size * 0.85);
    const names: Array<[number, string]> = [
      [0.1875, 'Relationship'], [0.3125, 'Cardinality (One)'], [0.4375, 'Cardinality (Many)'], [0.5625, 'Mandatory, One'], [0.6875, 'Mandatory, Many'], [0.8125, 'Optional, One'], [0.9375, 'Optional, Many'],
    ];
    for (const [y, s] of names) erText(c, w * 0.52, h * y, s, 'left');
    // has/forms の幅は、ソースでは mxUtils.getSizeForString で測る (ここは見積もり)。大きさは今の文字の大きさ (font.size × 0.85) ではなく font.size
    const tw = textWidth('has/forms', font.size);
    c.begin();
    segs(c, [
      [w * 0.04, h * 0.1875, w * 0.25 - tw * 0.5, h * 0.1875],
      [w * 0.25 + tw * 0.5, h * 0.1875, w * 0.46, h * 0.1875],
    ]);
    erText(c, w * 0.25, h * 0.1875, 'has/forms');
    segs(c, [
      [w * 0.04, h * 0.3125, w * 0.46, h * 0.3125],
      [w * 0.04, h * 0.4375, w * 0.46, h * 0.4375],
    ]);
    poly(c, [[w * 0.46, h * 0.405], [w * 0.4, h * 0.4375], [w * 0.46, h * 0.47]], false);
    segs(c, [
      [w * 0.04, h * 0.5625, w * 0.46, h * 0.5625],
      [w * 0.38, h * 0.53, w * 0.38, h * 0.595],
      [w * 0.04, h * 0.6875, w * 0.46, h * 0.6875],
    ]);
    poly(c, [[w * 0.46, h * 0.655], [w * 0.4, h * 0.6875], [w * 0.46, h * 0.72]], false);
    segs(c, [
      [w * 0.38, h * 0.655, w * 0.38, h * 0.72],
      [w * 0.04, h * 0.8125, w * 0.46, h * 0.8125],
      [w * 0.04, h * 0.9375, w * 0.46, h * 0.9375],
    ]);
    poly(c, [[w * 0.46, h * 0.905], [w * 0.4, h * 0.9375], [w * 0.46, h * 0.97]], false);
    c.stroke();
    const s = h / 15;
    c.begin();
    oval(c, w * 0.46 - s, h * 0.8125 - s * 0.5, s, s);
    c.begin();
    oval(c, w * 0.4 - s, h * 0.9375 - s * 0.5, s, s);
  },
  ie: (c, w0, h0, e) => {
    // Information Engineering の記法の凡例
    const font = erFont(e);
    const w = Math.max(w0, h0 / 1.5);
    const h = Math.max(h0, font.size * 5);
    erFrame(c, w, h);
    c.begin();
    segs(c, [0.2, 0.4, 0.6, 0.8].map((k) => [0, h * k, w, h * k]));
    segs(c, [[w * 0.5, h * 0.2, w * 0.5, h]]);
    c.stroke();
    c.begin();
    c.setFontSize(font.size);
    c.setFontColor(font.color);
    erText(c, w * 0.5, h * 0.1, 'ERD Information Engineering Notation');
    c.setFontSize(font.size * 0.85);
    for (const [y, s] of [
      [0.3, 'Zero or one'],
      [0.5, 'One only'],
      [0.7, 'Zero or more'],
      [0.9, 'One or more'],
    ] as Array<[number, string]>)
      erText(c, w * 0.52, h * y, s, 'left');
    const s = h / 12;
    c.begin();
    segs(c, [
      [w * 0.04, h * 0.3, w * 0.46, h * 0.3],
      [w * 0.46 - s, h * 0.25, w * 0.46 - s, h * 0.35],
      [w * 0.04, h * 0.5, w * 0.46, h * 0.5],
      [w * 0.46 - s * 2, h * 0.45, w * 0.46 - s * 2, h * 0.55],
      [w * 0.46 - s * 2.5, h * 0.45, w * 0.46 - s * 2.5, h * 0.55],
      [w * 0.04, h * 0.7, w * 0.46, h * 0.7],
    ]);
    poly(c, [[w * 0.46, h * 0.65], [w * 0.46 - s * 2, h * 0.7], [w * 0.46, h * 0.75]], false);
    c.stroke();
    // ソースは続けて「1 つ以上」の線を begin なしで描くが、mxSvgCanvas2D では描かれない (ファイルの先頭の注)
    c.begin();
    oval(c, w * 0.46 - s * 3, h * 0.3 - s * 0.5, s, s);
    c.begin();
    oval(c, w * 0.46 - s * 3, h * 0.7 - s * 0.5, s, s);
  },
  rrect: (c, w, h, e) => {
    // rSize (既定 10。整数に切る) の角の丸い四角 (ソースは roundrect の dy を渡さないが、SVG の rect は ry を rx と同じにする)
    const r = parseInt(e.str('rSize', '10'), 10);
    c.roundrect(0, 0, w, h, r, r);
    c.fillAndStroke();
  },
  // 何も描かない (線をつなぐための形)
  anchor: () => {},
};

/** 形の名前 → 描き方 (draw.io の mxCellRenderer.registerShape の名前) */
export const SHAPES_BPMN: Record<string, ShapePainter> = {
  'mxgraph.bpmn.shape': bpmnShape,
  'mxgraph.bpmn.sendMarker': (c, w, h) => sendMarkerAt(c, 0, 0, w, h),
  'mxgraph.bpmn.event': bpmnEvent,
  'mxgraph.bpmn.gateway2': bpmnGateway,
  'mxgraph.bpmn.task': bpmnTask,
  'mxgraph.bpmn.data': bpmnData,
  'mxgraph.bpmn.swimlane': bpmnSwimlane,
  'mxgraph.bpmn.conversation': bpmnConversation,
  ...Object.fromEntries(Object.entries(LEAN).map(([k, v]) => [`mxgraph.lean_mapping.${k}`, v])),
  ...Object.fromEntries(Object.entries(FLOORPLAN).map(([k, v]) => [`mxgraph.floorplan.${k}`, v])),
  ...Object.fromEntries(Object.entries(ER).map(([k, v]) => [`mxgraph.er.${k}`, v])),
};
