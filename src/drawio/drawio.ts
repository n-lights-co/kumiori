/**
 * drawio — draw.io (diagrams.net) の図のファイル (.drawio・.dio。mxGraph の XML) を SVG にする。
 *
 * 根拠: draw.io のファイルの形には公開の仕様書が無い。形・既定の値・描き方は、draw.io (jgraph/drawio) と mxGraph (jgraph/mxgraph) の
 * 公開のソース (Apache License 2.0) と、draw.io で作った見本に合わせる (CLAUDE.md「他の組版ソフトの拡張の中身は、その製品の公開の説明と見本に合わせる」)。
 * ソースの名前は、以下のコメントで「mxGraph の mxConstants」「draw.io の Shapes.js」のように書く。
 *
 * ファイルの形:
 *   <mxfile><diagram name="…">(中身)</diagram>…</mxfile> か、<mxGraphModel> だけのもの。中身は <mxGraphModel> の要素か、
 *   圧縮した文字 (encodeURIComponent した XML を deflate (頭の無い形。RFC 1951) で縮め、base64 にしたもの。draw.io の Graph.compress)。
 *   <mxGraphModel><root> の下に <mxCell> (と、属性を持たせた <UserObject>・<object> で包んだ <mxCell>) が並ぶ。
 *   セルは parent で木になり、id "0" の根の子が層 (layer)、層の子が図形 (vertex="1") と線 (edge="1")。
 *   図形の <mxGeometry> の x・y は親の図形の左上からの位置 (層の子はページの原点から)。単位は px (CSS px と同じ 96dpi とみなす)。
 *   見た目は style 属性 (「名前;キー=値;…」。名前は draw.io の既定のスタイルの表の名前) で決まる。
 *
 * ページ: 描くページ (<diagram>) は、画像の参照の URL の fragment (# の後ろ。DrawioOptions.page) で選ぶ (pageOf)。無ければ最初のページ。
 *
 * 描くもの: 選んだページの、見えるセル (visible="0" の層・セルと、たたんだ容器の中は描かない)。
 *   図形: mxGraph の形 (四角・楕円・ひし形・三角形・円柱・雲・人・スイムレーン・線・画像。shapeSvg) と、draw.io の Shapes.js の形
 *     (drawioShapesA.ts・drawioShapesB.ts。UML・シーケンス図・フローチャート・git・mermaid など) と包みの形 (AWS・GCP・Cisco など。drawioShapes.ts)。
 *     図形ライブラリの形 (mxgraph.* の名前の形) と、図に埋め込んだ形 (stencil(…)) は drawioStencil.ts で描く (ライブラリは呼ぶ側が渡す)。
 *   線: まっすぐ・直角に曲げる (orthogonal・elbow・sideToSide・topToBottom・entityRelation)・自分へ戻る線 (Loop)・シーケンス図の線・
 *     角の丸め・曲線・破線・跳び越し (jumpStyle)、線の形 (flexArrow・link・arrow・pipe・wire・filledEdge。drawioEdges.ts、taperedArrow。drawioTapered.ts)、
 *     線の端の形 (mxMarker と draw.io が足した 34 種類。drawioEdges.ts の edgeMarker)、端の位置 (図形の周の形と周の間隔)。
 *   文字: HTML の文字の書式 (太字・斜体・下線・色・大きさ・書体)・行ごとの揃え (text-align)、折り返し (whiteSpace=wrap)・揃え・
 *     内側の余白・図形の外の位置・縦の文字 (horizontal=0)・文字の背景と枠。
 *   塗り・線の色・不透明度・グラデーション・影 (shadow)・回転・反転・向き (direction)。
 *   draw.io が JavaScript で描く形 (shapes/*.js の約 800 種類) は、ソースを移して描く (drawioJs/)。曲げた文字 (curvedText) も描く。
 *   形ごとの文字の置き場 (getLabelMargins・getLabelBounds) は shapeLabelBounds (図形ライブラリの labelBounds も読む)。
 *   ガラスの光沢 (glass。glassSvg)、両端の不透明度の付いたグラデーション (stop-opacity)。
 *   手書き風 (sketch・comic。drawioSketch.ts)、形の影・文字の影 (shadow・textShadow)・図の全体の影 (mxGraphModel の shadow)。
 *   data: でない画像 (draw.io の配布物の画像 img/… と http(s) の URL) は、描く側が取って登録所に入れたものを描く (無ければ missingImages で求める)。
 * 描かないもの (警告に出す): 図形ライブラリの無い形・取っていない画像・ほかの道の画像 (相対の URL など)、知らない線の形・線の端の形・曲げ方
 *
 * 文字の幅: 折り返しと背景の枠の大きさは、描く側が渡す測り方 (DrawioOptions.measureText。Node は PDF に SVG の文字を描く書体、
 *   画面はブラウザの canvas) で測る。無ければ見積もる (drawioText.ts。ASCII は Helvetica の字の幅、全角の字は 1em、そのほかは 0.6em)。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/diagramly/Editor.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   js/diagramly/GraphViewer.js: Copyright (c) 2006-2016, JGraph Holdings Ltd
 *   js/grapheditor/Graph.js: Copyright (c) 2006-2012, JGraph Holdings Ltd
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/model/mxCell.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/model/mxGeometry.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/model/mxGraphModel.js: Copyright (c) 2006-2018, JGraph Holdings Ltd; Copyright (c) 2006-2018, draw.io AG
 *   mxgraph/src/shape/mxActor.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxArrowConnector.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxCloud.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxConnector.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxCylinder.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxDoubleEllipse.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxEllipse.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxLine.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxMarker.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxPolyline.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/shape/mxRectangleShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxRhombus.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencil.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencilRegistry.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxSwimlane.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxText.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxPoint.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxCellRenderer.js: Copyright (c) 2006-2017, JGraph Holdings Ltd; Copyright (c) 2006-2017, draw.io AG
 *   mxgraph/src/view/mxEdgeStyle.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraphView.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxPerimeter.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxStylesheet.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   styles/default.xml: (元のファイルに著作権表示は無い)
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import { isWide, textWidth, withMeasure, type DrawioMeasure } from './drawioText';
import { sketchKind, sketchSvg } from './drawioSketch';
import { DRAWIO_MIME, isDrawio } from './sniff';
import { msg, withLang, type Lang } from './messages';

export { DRAWIO_MIME, isDrawio };
import { inflateBytes } from './inflate';
import { decodeEntities, esc, f, HTML_ENT, kids, num, parseXml, type XEl } from './drawioXml';
import { decodeInlineStencil, isDrawioImagePath, isRemoteImage, libraryOf, stencilSvg, type DrawioImage, type StencilContext, type StencilRegistry } from './drawioStencil';
import { base64 } from './base64';
import { ShapeCanvas, SvgBudgetExceeded } from './drawioCanvas';
import { edgeMarker, lineJumps, MAX_LINE_JUMPS, paintArrow, paintArrowConnector, paintLineJumps, paintSankeyLink } from './drawioEdges';
import { paintTaperedArrow, taperedArrowGrow } from './drawioTapered';
import { JS_EDGES, JS_SHAPES, type ShapeEnv, type ShapePainter } from './drawioShapes';


export interface DrawioResult {
  svg: string;
  /** SVG の大きさ (px) */
  width: number;
  height: number;
  /** 描けなかったもの */
  warnings: string[];
  /** 形を描けなかった図形ライブラリ (手元に無いライブラリ。mxgraph.aws4.lambda なら aws4) */
  missingLibraries: string[];
  /** 描けなかった、draw.io の配布物の画像 (手元に無い画像。SAP のアイコンの img/lib/sap/<名前>.svg など) */
  missingImages: string[];
}

export interface DrawioOptions {
  /** 図形ライブラリ (mxgraph.* の名前の形を引く。drawioStencil.ts) */
  stencils?: StencilRegistry;
  /**
   * 文字の幅を測る (折り返し・文字の背景の枠・モックアップのボタンの幅など。drawioText.ts)。描く側の書体で測れば、描いた文字が枠に収まる。
   * 無ければ見積もる (Helvetica の字の幅)
   */
  measureText?: DrawioMeasure;
  /** 警告の文の言語 (既定は日本語。messages.ts) */
  lang?: Lang;
  /**
   * 描くページ: 画像の参照の URL の fragment (# の後ろ。ImageFormatContext.fragment)。書き方は pageOf。
   * 無い・空なら最初のページ
   */
  page?: string;
}

/**
 * draw.io の v24.7.5 より後に足された、JavaScript で描く形 (draw.io の shapes/ の形)。Kumiori は v24.7.5 の shapes/ から移したので
 * 描かない (draw.io は v29.3.2 から shapes/ に利用の制限を付けた。THIRD_PARTY_NOTICES.md の 13.2 節)。図形ライブラリ (stencils/ の XML) の形
 * ではないので、図形ライブラリを渡しても取っても描けない。「図形ライブラリが無い」とは別の警告にし、取りにも行かない
 */
const NEWER_SHAPES = new Set(['mxgraph.c4.mobileDeviceContainer', 'mxgraph.bpmn.task2', 'mxgraph.bpmn.data2', 'mxgraph.bpmn.conversation2', 'mxgraph.atlassian2.icon', 'mxgraph.networks2.icon']);
const isNewerShape = (shape: string) => shape.startsWith('mxgraph.archimate4.') || NEWER_SHAPES.has(shape);

/** 読む上限 (小さなファイルで大量のメモリ・時間を使わせない) */
const LIMITS = {
  /** 圧縮した図を戻した大きさ (字) */
  inflated: 64 << 20,
  /** セルの数 */
  cells: 20000,
  /** 1 本の線の折れ点の数 */
  points: 2000,
  /** 文字のラベルの長さ (html=0 のラベルと、placeholders の %名前% を置き換えた後の値にも当てる) */
  label: 100000,
  /**
   * 1 つの図のラベルの長さの合計 (置き換えた後の字の数)。超えたら、その後のラベルは描かない (警告を出す)。
   * ラベルは字ごとに幅を測って折り返す (wrapLines) ので、字の数に比例して時間とメモリを使う。前は html=0 のラベルと、placeholders の
   * 置き換えの結果に上限が無く、圧縮した 49KB の図 (500 万行のラベル) で 28.6 秒・2.76GB、732 バイトの図 (%a% を 2 万個、a に 1 万字) で
   * 32.9 秒・3.1GB を使って落ちた。200 万字は、ラベルが 100 字のセルを 2 万個 (セルの数の上限) 並べた図の 1 倍、
   * HTML の書式の多いラベル (1 つで数 KB) を数百個並べた図が入る値
   */
  labelTotal: 2_000_000,
  /**
   * 1 つの図を SVG にした文字列の長さの上限 (字)。超えたら、その後のセル・形を描かない (警告を出す)。
   * 前は上限が無く、手書き風のジグザグの塗りの巨大なセル 20 個 (448 バイト) で 42 秒かかって落ち、線の跳び越しの 1 組で SVG が 44MB になった。
   * 1,600 万字は、図形ライブラリの込み入った形 (AWS・Cisco のアイコンは 1 つで 2〜10KB) を 1,000 個以上並べた図が入る値。
   * Kumiori は SVG を XML として読んで図形にするので、上限いっぱいの SVG (模様の細い線を並べたもの) でも、組むのは 8 秒ほど・900MB ほどで終わる
   */
  svgChars: 16 << 20,
  /**
   * 1 つの図で書く SVG の字の数の合計 (上限を超えて捨てたセルの分も数える)。SVG の長さの上限 (svgChars) を 1 つで超えるセルは、
   * そのセルだけを描かずに、後ろのセルを描き続ける (前は、そこから後ろのセルを全部描かなかったので、最初のセルが超えると図が空になり、
   * 読めない画像になった。, で区切る項目が 10 万個を超えるボタンの列など)。捨てたセルの分も数えて、ここを使い切ったら後ろのセルを描かない
   * (超えるセルを並べて、svgChars 分ずつ書いては捨てるのを繰り返させない)。svgChars の 2 倍なので、手間は上限いっぱいの図の 2 倍まで
   */
  svgWork: 32 << 20,
  /**
   * 図の大きさ (外接の枠の幅・高さ。px) の上限。描いたら図がこれより大きくなるセルは、そのセルだけを描かない (警告を出す)。
   * 本体は、画像の形式の結果の大きさを 1,000 万 px までにしている (imageFormats.ts の FORMAT_MAX_SIZE。超えた図は全体が読めない画像になる)。
   * 前は、線の太さ (strokeWidth) が 1,000 万 px のセルが 1 つあるだけで、図の全体が読めなかった (線の太さ・字の大きさ・矢印の大きさ・
   * 影のずれなど、外接の枠に入るどの値でも同じ)。FORMAT_MAX_SIZE と同じ値。外接の枠は、図の全体の影 (6 px) と大きさの切り上げ (1 px) を
   * 足しても超えないように、これより 8 px 小さい所までにする
   */
  size: 1e7,
  /**
   * セルの位置・大きさ・線の点の座標の絶対値の上限 (px)。超えたセルは描かない (警告を出す)。
   * 前は x=-1e308 と x=1e308 のセルで図の幅が Infinity になり、文書の全体が誤りで終わった。
   * 1,000 万 px (96dpi で約 2.6km) は、draw.io の画面で扱える図 (広くても数万 px) よりずっと大きい
   */
  coord: 1e7,
  /**
   * 埋め込んだ形 stencil(…) の 1 つを戻した大きさ (バイト)。draw.io の形 (<shape>) の XML は、配布物の全部の図形ライブラリ
   * (stencils.min.js。約 6.6MB に圧縮) の中の 1 つの形が数 KB〜数十 KB、点の多い形でも数百 KB なので、その 10 倍ほどにした
   */
  inlineStencil: 4 << 20,
  /**
   * 1 つの図で、埋め込んだ形を戻す大きさの合計 (バイト。読めなかったものも、戻した分を数える)。超えたら、その後の埋め込んだ形は描かない (文字だけ描く)。
   * 前は 1 つの形を 64MB まで戻せ、形ごとに覚えたので、少しずつ違う形を 100 個並べた 66KB の図で 12.4 秒かかって落ちた
   */
  inlineStencilTotal: 16 << 20,
  /**
   * 1 つの図で、線の跳び越し (jumpStyle) の交わりを調べる線分の組の数の合計。超えたら、その後の線は跳ばずに描く (警告を出す)。
   * 1 億組は、5 つの線分の線を 2,000 本 (どれも jumpStyle の付いた大きな図) 描くときの組の数 (約 5,000 万) の倍で、1〜2 秒で調べられる
   */
  jumpPairs: 100_000_000,
};

// ───────────── ファイル → 図のモデル ─────────────

/**
 * 描くページ (<diagram>) を、画像の参照の URL の fragment (# の後ろ) で選ぶ。
 * draw.io の形式には fragment の決まりが無い (draw.io の GraphViewer.js は、何ページ目かを設定・URL の問い合わせの page (0 から数える) で、
 * ページの id を pageId・page-id で選ぶ。URL の # の後ろは見ない)。そこで、次の 3 つの書き方を読む:
 *   page=N      N ページ目 (1 から数える。PDF の fragment の page=N (RFC 8118 §3) と同じ数え方。draw.io の page (0 から) とは 1 ずれる)
 *   page-id=ID  id が ID のページ (draw.io の page-id と同じ名前)
 *   名前        name が その名前のページ (無ければ id が その名前のページ)
 * fragment は %xx を戻して読む (RFC 3986 §2.1)。見つからなければ、最初のページを描いて警告する (PDF の page=N の範囲の外と同じく、
 * 文書を開く側の既定に戻す)。fragment が無い・空なら、最初のページ
 */
function pageOf(pages: XEl[], fragment: string | undefined, warn: (m: string) => void): XEl | undefined {
  if (fragment === undefined || fragment === '') return pages[0];
  let frag = fragment;
  try {
    frag = decodeURIComponent(fragment);
  } catch {
    /* 戻せない %xx はそのまま */
  }
  const shown = frag.slice(0, 200);
  const n = /^page=(\d+)$/.exec(frag);
  if (n) {
    const k = Number(n[1]);
    if (k >= 1 && k <= pages.length) return pages[k - 1];
    warn(msg(`draw.io の図に ${shown.slice(5)} ページ目がありません (${pages.length} ページ。最初のページを描きます)`, `the draw.io diagram has no page ${shown.slice(5)} (it has ${pages.length}; the first page is drawn)`));
    return pages[0];
  }
  const id = /^page-id=(.*)$/s.exec(frag);
  const found = id ? pages.find((p) => p.attrs.get('id') === id[1]) : (pages.find((p) => p.attrs.get('name') === frag) ?? pages.find((p) => p.attrs.get('id') === frag));
  if (found) return found;
  warn(msg(`draw.io の図に、指したページがありません: #${shown} (最初のページを描きます)`, `the draw.io diagram has no such page: #${shown} (the first page is drawn)`));
  return pages[0];
}

/** 選んだページ (pageOf) の <mxGraphModel>。圧縮した中身は戻す (draw.io の Graph.decompress: base64 → inflateRaw → decodeURIComponent) */
function graphModel(root: XEl, fragment: string | undefined, warn: (m: string) => void): XEl | undefined {
  if (root.name === 'mxGraphModel') {
    // ページの無い形 (<mxGraphModel> だけ) は 1 ページの図 (名前・id は無い)。page=1 のほかの指定は、無いページとして警告する
    pageOf([root], fragment, warn);
    return root;
  }
  if (root.name !== 'mxfile') return undefined;
  const page = pageOf(kids(root, 'diagram'), fragment, warn);
  if (!page) return undefined;
  const direct = kids(page, 'mxGraphModel')[0];
  if (direct) return direct;
  const data = page.text.trim();
  if (!data) return undefined;
  let bin: string;
  try {
    bin = atob(data.replace(/\s+/g, ''));
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const raw = inflateBytes(bytes, LIMITS.inflated);
  if (!raw) return undefined;
  let text = new TextDecoder('latin1').decode(raw);
  try {
    text = decodeURIComponent(text);
  } catch {
    /* encodeURIComponent をしていない古い形は、そのまま読む */
  }
  const m = parseXml(text);
  return m?.name === 'mxGraphModel' ? m : undefined;
}

interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo extends Box {
  relative: boolean;
  points: Pt[];
  sourcePoint?: Pt;
  targetPoint?: Pt;
  offset?: Pt;
}
type Style = Record<string, string>;
interface Cell {
  id: string;
  parentId?: string;
  parent?: Cell;
  children: Cell[];
  value: string;
  /** 包みの要素 (UserObject・object) の属性 (placeholders の %名前% に使う) */
  vars?: Map<string, string>;
  style: Style;
  vertex: boolean;
  edge: boolean;
  sourceId?: string;
  targetId?: string;
  geo?: Geo;
  visible: boolean;
  collapsed: boolean;
}


/**
 * セルの位置 (mxGeometry)。座標の絶対値が上限 (LIMITS.coord) を超えるときは huge を呼び、位置の無いセル (図形は描かない) にする。
 * 線の点で上限を超えるものは落とす
 */
function readGeo(g: XEl | undefined, huge: () => void = () => {}): Geo | undefined {
  if (!g) return undefined;
  const a = (k: string) => num(g.attrs.get(k), 0);
  const ok = (...v: number[]) => v.every((n) => Math.abs(n) <= LIMITS.coord) || (huge(), false);
  const pt = (e: XEl): Pt => ({ x: num(e.attrs.get('x'), 0), y: num(e.attrs.get('y'), 0) });
  const geo: Geo = { x: a('x'), y: a('y'), w: a('width'), h: a('height'), relative: g.attrs.get('relative') === '1', points: [] };
  if (!ok(geo.x, geo.y, geo.w, geo.h)) return undefined;
  for (const c of g.children) {
    const as = c.attrs.get('as');
    const p = c.name === 'mxPoint' ? pt(c) : undefined;
    if (p && !ok(p.x, p.y)) continue;
    if (p && as === 'sourcePoint') geo.sourcePoint = p;
    else if (p && as === 'targetPoint') geo.targetPoint = p;
    else if (p && as === 'offset') geo.offset = p;
    else if (c.name === 'Array' && as === 'points')
      geo.points = kids(c, 'mxPoint')
        .slice(0, LIMITS.points)
        .map(pt)
        .filter((q) => ok(q.x, q.y));
  }
  return geo;
}

// ───────────── スタイル ─────────────

/**
 * draw.io の既定のスタイル (draw.io の styles/default.xml)。defaultVertex・defaultEdge と、名前で引くスタイル。
 * 色の "default" は、明るい背景の既定の色 (下の color)
 */
const DEFAULT_VERTEX: Style = { shape: 'label', perimeter: 'rectanglePerimeter', fontSize: '12', fontFamily: 'Helvetica', align: 'center', verticalAlign: 'middle', fillColor: 'default', strokeColor: 'default', fontColor: 'default' };
const DEFAULT_EDGE: Style = { shape: 'connector', labelBackgroundColor: 'default', endArrow: 'classic', fontSize: '11', fontFamily: 'Helvetica', align: 'center', verticalAlign: 'middle', strokeColor: 'default', fontColor: 'default' };
const NAMED: Record<string, Style> = {
  text: { fillColor: 'none', gradientColor: 'none', strokeColor: 'none', align: 'left', verticalAlign: 'top' },
  edgeLabel: { fillColor: 'none', gradientColor: 'none', strokeColor: 'none', align: 'left', verticalAlign: 'top', labelBackgroundColor: 'default', fontSize: '11' },
  label: { fontStyle: '1', align: 'left', verticalAlign: 'middle', spacing: '2', spacingLeft: '52', imageWidth: '42', imageHeight: '42', rounded: '1' },
  icon: { fontStyle: '0', align: 'center', imageAlign: 'center', verticalLabelPosition: 'bottom', verticalAlign: 'top', labelBackgroundColor: 'default', spacing: '0', spacingLeft: '0', spacingTop: '6', imageWidth: '48', imageHeight: '48', rounded: '1' },
  swimlane: { shape: 'swimlane', fontSize: '12', fontStyle: '1', startSize: '23' },
  group: { verticalAlign: 'top', fillColor: 'none', strokeColor: 'none', gradientColor: 'none' },
  ellipse: { shape: 'ellipse', perimeter: 'ellipsePerimeter' },
  rhombus: { shape: 'rhombus', perimeter: 'rhombusPerimeter' },
  triangle: { shape: 'triangle', perimeter: 'trianglePerimeter' },
  line: { shape: 'line', strokeWidth: '4', labelBackgroundColor: 'default', verticalAlign: 'top', spacingTop: '8' },
  image: { shape: 'image', labelBackgroundColor: 'default', verticalAlign: 'top', verticalLabelPosition: 'bottom' },
  roundImage: { shape: 'image', labelBackgroundColor: 'default', verticalAlign: 'top', verticalLabelPosition: 'bottom', perimeter: 'ellipsePerimeter' },
  rhombusImage: { shape: 'image', labelBackgroundColor: 'default', verticalAlign: 'top', verticalLabelPosition: 'bottom', perimeter: 'rhombusPerimeter' },
  arrow: { shape: 'arrow', edgeStyle: 'none', fillColor: 'default' },
};

/**
 * スタイルの文字 (「名前;キー=値;…」) を、既定のスタイルに重ねる (mxGraph の mxStylesheet.getCellStyle と同じ順)。
 * 値が none のキーは消す (mxConstants.NONE)。画像の data: は、draw.io は ; を区切りに使うので「data:image/png,…」と書く
 */
function parseStyle(s: string, base: Style): Style {
  const out: Style = { ...base };
  for (const tok of s.split(';')) {
    const t = tok.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq < 0) {
      Object.assign(out, NAMED[t] ?? {});
      continue;
    }
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k === '__proto__' || k === 'constructor') continue;
    if (v === 'none') delete out[k];
    else out[k] = v;
  }
  return out;
}

const flag = (s: Style, k: string, d = false) => (s[k] === undefined ? d : s[k] === '1' || s[k] === 'true');

// ───────────── 色・数・文字の書き出し ─────────────


/**
 * 色の値。none・空は undefined、default は明るい背景の既定の色 (線・字は黒、塗りは白)、light-dark(a, b) は明るい方の a、
 * inherit は親のセルの同じキーの値 (draw.io の表の行・セルが使う)。SVG に書けない値は捨てる
 */
function color(cell: Cell | undefined, key: string, def: string, depth = 0): string | undefined {
  let v = cell?.style[key]?.trim();
  if (!v || v === 'none') return undefined;
  if (v === 'inherit') return depth < 64 ? color(cell?.parent, key, def, depth + 1) : undefined;
  if (v === 'default') return def;
  const ld = /^light-dark\(\s*([^,]+),/i.exec(v);
  if (ld) v = ld[1].trim();
  if (v === 'default') return def;
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(v) || /^[a-z]+$/i.test(v) ? v : undefined;
}


// ───────────── ラベルの文字 ─────────────

interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  size: number;
  family: string;
  /** 行の揃え (HTML のブロックの要素の text-align・align の属性。無ければセルの align) */
  align?: string;
}
interface Run extends RunStyle {
  text: string;
}
type Line = Run[];

/** HTML の font 要素の size (1〜7) の大きさ (HTML Living Standard §15.3.4 の表。3 が既定の 16px) */
const FONT_SIZES = [10, 13, 16, 18, 24, 32, 48];
const HEADING: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
const BLOCK = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr']);

/** CSS の長さ (font-size) を px に。em・% は親の大きさに対して */
function cssSize(v: string, parent: number): number | undefined {
  const m = /^\s*([\d.]+)\s*(px|pt|em|rem|%)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = (m[2] ?? 'px').toLowerCase();
  return u === 'pt' ? (n * 4) / 3 : u === 'em' || u === 'rem' ? n * parent : u === '%' ? (n / 100) * parent : n;
}
function applyCss(css: string, st: RunStyle) {
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    if (k === 'color') st.color = cssColor(v) ?? st.color;
    else if (k === 'text-align' && /^(left|center|right|start|end|justify)$/i.test(v)) st.align = v.toLowerCase() === 'start' || v.toLowerCase() === 'justify' ? 'left' : v.toLowerCase() === 'end' ? 'right' : v.toLowerCase();
    else if (k === 'font-weight') st.bold = v === 'bold' || v === 'bolder' || parseInt(v, 10) >= 600;
    else if (k === 'font-style') st.italic = v === 'italic' || v === 'oblique';
    else if (k === 'font-size') st.size = cssSize(v, st.size) ?? st.size;
    else if (k === 'font-family') st.family = v.replace(/["']/g, '').split(',')[0].trim() || st.family;
    else if (k === 'text-decoration' || k === 'text-decoration-line') {
      if (/underline/.test(v)) st.underline = true;
      if (/line-through/.test(v)) st.strike = true;
      if (v === 'none') st.underline = st.strike = false;
    }
  }
}
const cssColor = (v: string) => {
  const t = v.trim();
  return /^#[0-9a-f]{3,8}$/i.test(t) || /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(t) || /^[a-z]+$/i.test(t) ? t : undefined;
};
const attrOf = (attrs: string, k: string) => decodeEntities(new RegExp(`\\b${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)?.slice(1).find((x) => x !== undefined) ?? '');

/**
 * HTML のラベルの字句 (注釈・開きと閉じのタグ・文字・閉じない '<')。正規表現
 * /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)|</g の matchAll と同じ並びを、同じ組 ([全体, '/', 名前, 属性, 文字]。無い組は空の文字、文字は undefined) で返す。
 * 正規表現のままだと、'>' の無い '<a' と閉じない '<!--' のたびに文字列の終わりまで読んで失敗するので、長さの 2 乗の手間になった
 * ('<a' を 4 万個並べた 8 万字のラベルで 3.9 秒)。次の '>' と '-->' の位置を覚えて使い回し、長さに比例する手間にする
 * (見つからなければ、それより後ろにも無いので、もう探さない)
 */
export function* htmlTokens(s: string): Generator<[all: string, slash: string, name: string, attrs: string, text: string | undefined]> {
  const tagHead = /<(\/?)([a-zA-Z][\w-]*)/y;
  // 次の '>'・'-->' の位置 (from より前のものを覚えていたら探し直す。-1 は、それより後ろに無い)
  let gt = -2;
  let cmt = -2;
  const nextGt = (from: number) => (gt === -1 || gt >= from ? gt : (gt = s.indexOf('>', from)));
  const nextCmt = (from: number) => (cmt === -1 || cmt >= from ? cmt : (cmt = s.indexOf('-->', from)));
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) !== 0x3c) {
      const lt = s.indexOf('<', i);
      const end = lt < 0 ? s.length : lt;
      yield [s.slice(i, end), '', '', '', s.slice(i, end)];
      i = end;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const e = nextCmt(i + 4);
      if (e >= 0) {
        yield [s.slice(i, e + 3), '', '', '', undefined];
        i = e + 3;
        continue;
      }
    }
    tagHead.lastIndex = i;
    const h = tagHead.exec(s);
    const g = h ? nextGt(i + h[0].length) : -1;
    if (h && g >= 0) {
      yield [s.slice(i, g + 1), h[1], h[2], s.slice(i + h[0].length, g), undefined];
      i = g + 1;
      continue;
    }
    yield ['<', '', '', '', undefined];
    i++;
  }
}

/**
 * ラベルの値を、行と書式の付いた文字の並びにする。html=1 なら HTML として読む (draw.io の HTML のラベル)。
 * 空白は HTML のとおりにまとめる (CSS Text 3 §4.1.1)。改行は br と、ブロックの要素 (div・p など) の切れ目
 */
function labelLines(value: string, html: boolean, base: RunStyle): Line[] {
  const lines: Line[] = [[]];
  const cur = () => lines[lines.length - 1];
  const breakLine = (force: boolean) => {
    if (force || cur().some((r) => r.text.trim())) lines.push([]);
  };
  const push = (text: string, st: RunStyle) => {
    if (text) cur().push({ ...st, text });
  };
  if (!html) {
    // html=0 のラベルにも長さの上限 (LIMITS.label) を当てる (前は当てず、500 万行のラベルを行ごとに組んだ)
    for (const [k, l] of value.slice(0, LIMITS.label).split(/\r\n|\r|\n/).entries()) {
      if (k) breakLine(true);
      push(l, base);
    }
    return lines;
  }
  const stack: Array<{ tag: string; st: RunStyle }> = [{ tag: '', st: base }];
  let skip = 0;
  for (const m of htmlTokens(value.slice(0, LIMITS.label))) {
    const st = stack[stack.length - 1].st;
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined || m[0] === '<') {
      if (skip) continue;
      // 空白のまとめは書式の切れ目もまたぐ (前の文字が空白で終わっていれば、頭の空白を落とす)
      let t = decodeEntities(m[4] ?? '<', HTML_ENT).replace(/[ \t\n\r\f]+/g, ' ');
      if (t.startsWith(' ') && (cur().at(-1)?.text.endsWith(' ') ?? true)) t = t.slice(1);
      push(t, st);
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      if (tag === 'script' || tag === 'style') skip = Math.max(0, skip - 1);
      if (BLOCK.has(tag)) breakLine(false);
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      continue;
    }
    if (tag === 'script' || tag === 'style') {
      skip++;
      continue;
    }
    if (tag === 'br') {
      breakLine(true);
      continue;
    }
    if (BLOCK.has(tag)) breakLine(false);
    if (tag === 'img' || tag === 'hr' || tag === 'wbr' || m[3].trimEnd().endsWith('/')) continue;
    const ns: RunStyle = { ...st };
    if (tag === 'b' || tag === 'strong') ns.bold = true;
    else if (tag === 'i' || tag === 'em') ns.italic = true;
    else if (tag === 'u') ns.underline = true;
    else if (tag === 's' || tag === 'strike' || tag === 'del') ns.strike = true;
    else if (tag === 'sup' || tag === 'sub') ns.size = st.size * 0.83;
    else if (HEADING[tag]) {
      ns.bold = true;
      ns.size = st.size * HEADING[tag];
    } else if (tag === 'font') {
      const c = cssColor(attrOf(m[3], 'color'));
      if (c) ns.color = c;
      const face = attrOf(m[3], 'face');
      if (face) ns.family = face.split(',')[0].trim();
      const sz = parseInt(attrOf(m[3], 'size'), 10);
      if (sz >= 1 && sz <= 7) ns.size = FONT_SIZES[sz - 1];
    }
    if (tag === 'li') push('• ', ns);
    // ブロックの要素の align の属性 (HTML の古い書き方。draw.io の HTML のラベルに残る) は text-align と同じ
    const al = BLOCK.has(tag) ? attrOf(m[3], 'align').toLowerCase() : '';
    if (al === 'left' || al === 'center' || al === 'right') ns.align = al;
    else if (al === 'justify') ns.align = 'left';
    const css = attrOf(m[3], 'style');
    if (css) applyCss(css, ns);
    stack.push({ tag, st: ns });
  }
  // 行の頭と末尾の空白を落とす
  for (const l of lines) {
    while (l.length && !(l[0].text = l[0].text.replace(/^ +/, ''))) l.shift();
    while (l.length && !(l[l.length - 1].text = l[l.length - 1].text.replace(/ +$/, ''))) l.pop();
  }
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** 書式の付いた文字の幅 (drawioText.ts の textWidth。描く側の測り方か、見積もり) */
const runWidth = (r: Run) => textWidth(r.text, r.size, r.family, r.bold, r.italic);
const lineWidth = (l: Line) => l.reduce((s, r) => s + runWidth(r), 0);

/** 行の頭に来てはいけない字 (JIS X 4051 の行頭禁則のおもなもの) */
const NO_START = /[、。，．・：；？！ー々ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ」』）］｝〕〉》】,.;:!?)\]}]/;

/**
 * 幅 maxW で折り返す (whiteSpace=wrap)。空白の後と、全角の字の前後で折る。語は分けない (draw.io の HTML のラベルの
 * word-wrap: normal と同じ)
 */
function wrapLines(lines: Line[], maxW: number): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    // 字ごとに分けて、折れる所を探す
    const units: Array<{ ch: string; st: Run; w: number }> = [];
    for (const r of line) for (const ch of r.text) units.push({ ch, st: r, w: textWidth(ch, r.size, r.family, r.bold, r.italic) });
    let start = 0;
    while (start < units.length) {
      let w = 0;
      let lastBreak = -1;
      let k = start;
      for (; k < units.length; k++) {
        const cp = units[k].ch.codePointAt(0)!;
        if (k > start && (units[k - 1].ch === ' ' || ((isWide(cp) || isWide(units[k - 1].ch.codePointAt(0)!)) && !NO_START.test(units[k].ch)))) lastBreak = k;
        if (w + units[k].w > maxW + 0.01 && k > start && units[k].ch !== ' ') {
          if (lastBreak > start) k = lastBreak;
          else {
            // 折れる所が無い (長い語): 次の折れる所まで続ける
            while (k < units.length && !(units[k - 1].ch === ' ' || isWide(units[k].ch.codePointAt(0)!) || isWide(units[k - 1].ch.codePointAt(0)!))) k++;
          }
          break;
        }
        w += units[k].w;
      }
      const seg = units.slice(start, k);
      while (seg.length && seg[seg.length - 1].ch === ' ') seg.pop();
      // 同じ書式の字をつなげて、元の書式の文字に戻す
      const l: Line = [];
      let from: Run | undefined;
      for (const u of seg) {
        if (from === u.st) l[l.length - 1].text += u.ch;
        else l.push({ ...u.st, text: u.ch });
        from = u.st;
      }
      out.push(l);
      start = k;
      while (start < units.length && units[start].ch === ' ') start++;
    }
    if (!units.length) out.push([]);
  }
  return out;
}

/**
 * 最初の svg の開きのタグ (正規表現 /<svg\b[^>]*>/i の exec と同じ結果)。正規表現のままだと、'>' の無い '<svg' のたびに文字列の
 * 終わりまで読んで失敗するので、長さの 2 乗の手間になった ('<svg' を 2 万個並べた画像で 1.3 秒)。最初の '<svg' の後ろに '>' が無ければ、
 * それより後ろの '<svg' の後ろにも無いので、最初の '<svg' だけを見ればよい
 */
export function svgOpenTag(svg: string): { 0: string; index: number } | undefined {
  const at = /<svg\b/i.exec(svg);
  if (!at) return undefined;
  const gt = svg.indexOf('>', at.index + 4);
  return gt < 0 ? undefined : { 0: svg.slice(at.index, gt + 1), index: at.index };
}

/**
 * SVG の文字を、枠 b に入れ子の svg として置く (Node でも図形で描けるように)。aspect なら縦横の比を保って真ん中に置く。
 * 根の svg が無ければ undefined
 */
function svgInBox(svg: string, b: { x: number; y: number; w: number; h: number }, aspect: boolean): string | undefined {
  svg = scopeIds(svg);
  const open = svgOpenTag(svg);
  if (!open) return undefined;
  // 根の svg の開きのタグを属性の無いものに替え、閉じのタグの後ろは捨てる (外の svg の大きさと置き方で描く)
  const end = svg.lastIndexOf('</svg>');
  if (!open[0].endsWith('/>') && end < open.index) return undefined;
  // 根の xmlns:xlink などの名前空間の宣言は残す (xlink:href を使う画像がある)
  const ns = [...open[0].matchAll(/\sxmlns:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*')/g)].map((m) => m[0]).join('');
  const inner = open[0].endsWith('/>') ? '<svg/>' : `<svg${ns}>` + svg.slice(open.index + open[0].length, end + 6);
  // 入れ子の svg の大きさは、外の svg の枠で決める (SVG 1.1 §7.9)。元の viewBox が無ければ、width・height から作る
  const vb = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(open[0])?.[1];
  const wh = (k: string) => parseFloat(new RegExp(`\\b${k}\\s*=\\s*["']\\s*([\\d.]+)`, 'i').exec(open[0])?.[1] ?? '');
  const view = vb ?? (wh('width') > 0 && wh('height') > 0 ? `0 0 ${wh('width')} ${wh('height')}` : undefined);
  const par = aspect ? 'xMidYMid meet' : 'none';
  return `<svg x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}"${view ? ` viewBox="${esc(view)}"` : ''} preserveAspectRatio="${par}" overflow="hidden">${inner}</svg>`;
}

/** 取って渡された画像を枠 b に置く (SVG は入れ子の svg、PNG・JPEG は data: の image 要素) */
function imageMarkup(img: DrawioImage, b: { x: number; y: number; w: number; h: number }, aspect: boolean): string | undefined {
  if (img.mime === 'image/svg+xml') return svgInBox(new TextDecoder().decode(img.bytes), b, aspect);
  return `<image x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="${aspect ? 'xMidYMid meet' : 'none'}" href="data:${img.mime};base64,${base64(img.bytes)}"/>`;
}

/** 入れ子にする SVG の id の頭に付ける番号 */
let nestedSvgs = 0;

/**
 * 入れ子にする SVG の id (と、それを指す url(#…)・href="#…") に、画像ごとの頭を付ける。
 * 1 つの図に置く SVG どうしで id がぶつかると (draw.io の SAP のアイコンは、どれも A・B… の名前のグラデーションを持つ)、後の画像が前の画像の定義を指す
 */
function scopeIds(svg: string): string {
  const ids = new Set([...svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  if (!ids.size) return svg;
  const pre = `dio-i${nestedSvgs++}-`;
  const ref = (id: string) => (ids.has(id) ? pre + id : id);
  return svg
    .replace(/(\sid\s*=\s*["'])([^"']+)(["'])/g, (_, a, id, z) => a + ref(id) + z)
    .replace(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g, (_, q, id) => `url(${q}#${ref(id)}${q})`)
    .replace(/(\s(?:xlink:)?href\s*=\s*["'])#([^"']+)(["'])/g, (_, a, id, z) => a + '#' + ref(id) + z);
}

/** 手書き風の線が形の枠からはみ出す分の見積もり (px。図の大きさに足す) */
const SKETCH_MARGIN = 4;

/** 太い矢印の線の形 (矢の頭も含めて 1 つの形で塗る。startArrow・endArrow は頭の有無と形) */
const THICK_EDGES = new Set(['flexArrow', 'link', 'arrowConnector', 'arrow', 'taperedArrow', 'mermaidSankeyLink']);
/** 直角に曲げる線の曲げ方の名前 (ほかの名前は、まっすぐの線で描いて警告する) */
const KNOWN_EDGE_STYLES = new Set(['orthogonalEdgeStyle', 'elbowEdgeStyle', 'entityRelationEdgeStyle', 'segmentEdgeStyle', 'isometricEdgeStyle']);
/** 直角に曲げない、知っている曲げ方 (loopEdgeStyle は自分へ戻る線の曲げ方。sequenceEdgeStyle はシーケンス図の線) */
const OTHER_EDGE_STYLES = new Set(['loopEdgeStyle', 'sequenceEdgeStyle']);

// ───────────── 本体 ─────────────

/** draw.io のファイルを SVG にする。draw.io のファイルでない・セルが無ければ undefined */
export function drawioToSvg(bytes: Uint8Array, opts: DrawioOptions = {}): DrawioResult | undefined {
  try {
    return isDrawio(bytes) ? withLang(opts.lang, () => withMeasure(opts.measureText, () => render(bytes, opts))) : undefined;
  } catch {
    return undefined;
  }
}

/** ファイルの XML の根 (頭の BOM は落とす) */
function rootOf(bytes: Uint8Array): XEl | undefined {
  let text = new TextDecoder().decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseXml(text);
}

/**
 * 描くページの番号 (0 から) と、選ぶときの警告 (fragment の指すページが無いなど。pageOf)。draw.io のファイルでない・ページが無ければ undefined。
 * 同じファイルを fragment の違う参照で指したとき、同じページになる参照の図を、描き直さずに使い回すため (load.ts)
 */
export function drawioPage(bytes: Uint8Array, fragment: string | undefined, lang?: Lang): { index: number; warnings: string[] } | undefined {
  try {
    if (!isDrawio(bytes)) return undefined;
    return withLang(lang, () => {
      const root = rootOf(bytes);
      const warnings: string[] = [];
      const warn = (m: string) => void (warnings.includes(m) || warnings.push(m));
      if (root?.name === 'mxGraphModel') {
        pageOf([root], fragment, warn);
        return { index: 0, warnings };
      }
      if (root?.name !== 'mxfile') return undefined;
      const pages = kids(root, 'diagram');
      const page = pageOf(pages, fragment, warn);
      return page ? { index: pages.indexOf(page), warnings } : undefined;
    });
  } catch {
    return undefined;
  }
}

function render(bytes: Uint8Array, opts: DrawioOptions): DrawioResult | undefined {
  const root = rootOf(bytes);
  if (!root) return undefined;
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);
  const model = graphModel(root, opts.page, warn);
  if (!model) return undefined;

  // セルを集める (<root> の直下。UserObject・object は、中の mxCell を包みの id と label で読む)
  const hugeGeo = () => warn(msg(`位置・大きさの値が大きすぎるセルを描かない (絶対値が ${LIMITS.coord} px まで)`, `cells with too large a position or size are not drawn (absolute values up to ${LIMITS.coord} px)`));
  const cells = new Map<string, Cell>();
  const order: Cell[] = [];
  for (const el of kids(kids(model, 'root')[0])) {
    if (order.length >= LIMITS.cells) {
      warn(msg(`セルが多すぎる (${LIMITS.cells} 個までを描く)`, `too many cells (only the first ${LIMITS.cells} are drawn)`));
      break;
    }
    let mx: XEl | undefined = el;
    let id = el.attrs.get('id');
    let value = el.attrs.get('value') ?? '';
    let vars: Map<string, string> | undefined;
    if (el.name === 'UserObject' || el.name === 'object') {
      mx = kids(el, 'mxCell')[0];
      value = el.attrs.get('label') ?? '';
      vars = el.attrs;
    } else if (el.name !== 'mxCell') continue;
    if (!mx || id === undefined || cells.has(id)) continue;
    const a = mx.attrs;
    const vertex = a.get('vertex') === '1';
    const edge = a.get('edge') === '1';
    const cell: Cell = {
      id,
      parentId: a.get('parent'),
      children: [],
      value,
      ...(vars ? { vars } : {}),
      style: parseStyle(a.get('style') ?? '', edge ? DEFAULT_EDGE : vertex ? DEFAULT_VERTEX : {}),
      vertex,
      edge,
      sourceId: a.get('source'),
      targetId: a.get('target'),
      geo: readGeo(kids(mx, 'mxGeometry')[0], hugeGeo),
      visible: a.get('visible') !== '0',
      collapsed: a.get('collapsed') === '1',
    };
    cells.set(id, cell);
    order.push(cell);
  }
  // 木にする (親の見つからないセル・親をたどると輪になるセルは描かない)
  for (const c of order) {
    const p = c.parentId !== undefined ? cells.get(c.parentId) : undefined;
    if (p && p !== c) c.parent = p;
  }
  const orphan = (c: Cell) => c.parentId !== undefined && !c.parent;
  const tops: Cell[] = [];
  for (const c of order) {
    let p = c.parent;
    let depth = 0;
    while (p && p !== c && depth < 256) {
      p = p.parent;
      depth++;
    }
    if (p === c || depth >= 256 || orphan(c)) continue;
    if (c.parent) c.parent.children.push(c);
    else tops.push(c);
  }

  // 図形の絶対の位置 (親の図形の左上を足す。親が線のもの (線のラベル) は、線を引いてから決める)
  /** 方眼の大きさ (mxGraphModel の gridSize。自分へ戻る線の既定の segment) */
  const gridSize = num(model.attrs.get('gridSize'), 10);
  const absBox = new Map<Cell, Box>();
  const originOf = (c: Cell | undefined): Pt => {
    let x = 0;
    let y = 0;
    for (let p = c; p; p = p.parent) {
      if (p.vertex && p.geo && !p.geo.relative) {
        x += p.geo.x;
        y += p.geo.y;
      } else if (p.vertex && p.geo?.relative && p.parent?.vertex && p.parent.geo) {
        // 親の図形の大きさに対する割合の位置 (mxGraph の mxGraphView.updateVertexState)
        x += p.geo.x * p.parent.geo.w + (p.geo.offset?.x ?? 0);
        y += p.geo.y * p.parent.geo.h + (p.geo.offset?.y ?? 0);
      }
    }
    return { x, y };
  };
  const boxOf = (c: Cell): Box | undefined => {
    if (!c.vertex || !c.geo) return undefined;
    const hit = absBox.get(c);
    if (hit) return hit;
    if (c.geo.relative && c.parent?.edge) return undefined;
    const o = originOf(c);
    const b = { x: o.x, y: o.y, w: c.geo.w, h: c.geo.h };
    absBox.set(c, b);
    return b;
  };

  const body: string[] = [];
  const defs: string[] = [];
  let gradients = 0;
  /**
   * 影 (形の shadow=1・文字の textShadow=1)。mxGraph の mxShape.getShadowStyle・createDropShadow (CSS の drop-shadow(dx dy ぼかし 色)):
   * ずらす量 shadowOffsetX・shadowOffsetY (既定 mxConstants.SHADOW_OFFSET_X 2・SHADOW_OFFSET_Y 3)、ぼかし shadowBlur (既定 SHADOW_BLUR 2)、
   * 色 shadowColor (既定 #000000)・不透明度 shadowOpacity (既定 25。draw.io の Graph.js が SHADOWCOLOR・SHADOW_OPACITY を書き換える)。
   * feDropShadow で書く (Filter Effects 1 §15.11。drop-shadow() の同じ働きのフィルタ (§13.2) は、ぼかしの値をそのまま stdDeviation にする)。
   * 同じ値の影は 1 つのフィルタを使う。影の範囲は図の全体 (高さ 0 の線にも効くように、図の座標で。最後に決める)
   */
  interface ShadowStyle {
    dx: number;
    dy: number;
    blur: number;
    color: string;
    opacity: number;
  }
  const shadowFilters = new Map<string, { id: string; st: ShadowStyle }>();
  const shadowStyle = (c: Cell): ShadowStyle => ({
    dx: num(c.style.shadowOffsetX, 2),
    dy: num(c.style.shadowOffsetY, 3),
    blur: Math.max(0, num(c.style.shadowBlur, 2)),
    color: color(c, 'shadowColor', '#000000') ?? '#000000',
    opacity: Math.max(0, Math.min(100, num(c.style.shadowOpacity, 25))) / 100,
  });
  const filterOf = (st: ShadowStyle) => {
    const key = `${st.dx} ${st.dy} ${st.blur} ${st.color} ${st.opacity}`;
    let hit = shadowFilters.get(key);
    if (!hit) shadowFilters.set(key, (hit = { id: `dio-shadow${shadowFilters.size || ''}`, st }));
    return ` filter="url(#${hit.id})"`;
  };
  /** 形の影 (shadow=1) のフィルタの属性。text なら文字の影 (textShadow=1) */
  const shadowAttr = (c: Cell, text = false) => (flag(c.style, text ? 'textShadow' : 'shadow') ? filterOf(shadowStyle(c)) : '');
  /** 影の付いた枠の外接 (ずらした分と、ぼかしの広がり (標準偏差の 3 倍)) */
  const addShadowBox = (c: Cell, pts: Pt[]) => {
    const st = shadowStyle(c);
    for (const p of pts) {
      addPt(p.x + st.dx + 3 * st.blur, p.y + st.dy + 3 * st.blur);
      addPt(p.x + st.dx - 3 * st.blur, p.y + st.dy - 3 * st.blur);
    }
  };
  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const addPt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bb.x0 = Math.min(bb.x0, x);
    bb.y0 = Math.min(bb.y0, y);
    bb.x1 = Math.max(bb.x1, x);
    bb.y1 = Math.max(bb.y1, y);
  };
  /** 点を、中心 (cx, cy) のまわりに deg 度 (SVG の rotate と同じ向き) 回す */
  const rotPt = (p: Pt, deg: number, cx: number, cy: number): Pt => {
    const r = (deg * Math.PI) / 180;
    const cs = Math.cos(r);
    const sn = Math.sin(r);
    return { x: cx + (p.x - cx) * cs - (p.y - cy) * sn, y: cy + (p.x - cx) * sn + (p.y - cy) * cs };
  };
  /** 枠を回した (rot 度。中心 cx, cy) 4 隅を外接の枠に足す。pad は線の太さの半分など */
  const addBox = (b: Box, rot = 0, cx = b.x + b.w / 2, cy = b.y + b.h / 2, pad = 0) => {
    for (const [x, y] of [
      [b.x - pad, b.y - pad],
      [b.x + b.w + pad, b.y - pad],
      [b.x + b.w + pad, b.y + b.h + pad],
      [b.x - pad, b.y + b.h + pad],
    ]) {
      const p = rotPt({ x, y }, rot, cx, cy);
      addPt(p.x, p.y);
    }
  };

  /** 線と塗りの属性 (mxGraph の mxShape.configureCanvas。dashPattern は線の太さ倍 (fixDash=1 なら倍にしない)) */
  /** セルの塗り (gradientColor があればグラデーションを作って url(#…))。塗らなければ undefined */
  /** グラデーションを作って url(#…) を返す (dir の既定 south は、上が c1・下が c2。radial は中心が c1) */
  /** グラデーション (alpha1・alpha2: 両端の不透明度。1 でなければ stop-opacity に書く。mxSvgCanvas2D.getSvgGradient) */
  const makeGradient = (fill: string, grad: string, dir: string, alpha1 = 1, alpha2 = 1) => {
      const id = `dio-g${gradients++}`;
      const [x1, y1, x2, y2] = dir === 'north' ? [0, 1, 0, 0] : dir === 'east' ? [0, 0, 1, 0] : dir === 'west' ? [1, 0, 0, 0] : [0, 0, 0, 1];
      const op = (a: number) => (a < 1 ? ` stop-opacity="${f(a)}"` : '');
      const stops = `<stop offset="0" stop-color="${esc(fill)}"${op(alpha1)}/><stop offset="1" stop-color="${esc(grad)}"${op(alpha2)}/>`;
      defs.push(
        dir === 'radial'
          ? `<radialGradient id="${id}">${stops}</radialGradient>`
          : `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
      );
      return `url(#${id})`;
  };
  const fillPaint = (c: Cell): string | undefined => {
    const fill = color(c, 'fillColor', '#ffffff');
    const grad = color(c, 'gradientColor', '#ffffff');
    return fill && grad ? makeGradient(fill, grad, c.style.gradientDirection ?? 'south') : fill;
  };
  const paint = (c: Cell, opts: { fill?: string | 'none'; stroke?: boolean; box?: Box } = {}) => {
    const s = c.style;
    const a: string[] = [];
    const fill = opts.fill ?? fillPaint(c);
    a.push(`fill="${esc(fill ?? 'none')}"`);
    const fo = num(s.fillOpacity, 100);
    if (fill && fill !== 'none' && fo < 100) a.push(`fill-opacity="${f(Math.max(0, fo) / 100)}"`);
    const stroke = opts.stroke === false ? undefined : color(c, 'strokeColor', '#000000');
    if (stroke) {
      const sw = num(s.strokeWidth, 1);
      a.push(`stroke="${esc(stroke)}"`, `stroke-width="${f(sw)}"`, 'stroke-miterlimit="10"');
      const so = num(s.strokeOpacity, 100);
      if (so < 100) a.push(`stroke-opacity="${f(Math.max(0, so) / 100)}"`);
      if (flag(s, 'dashed')) {
        const k = flag(s, 'fixDash') ? 1 : sw;
        const pat = (s.dashPattern ?? '3 3').split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
        if (pat.length && pat.some((n) => n > 0)) a.push(`stroke-dasharray="${pat.map((n) => f(n * k)).join(' ')}"`);
      }
    } else a.push('stroke="none"');
    return a.join(' ');
  };

  /**
   * ガラスの光沢 (glass=1。塗りのある四角・ラベル・楕円・ひし形): 上の部分を、白の不透明度 0.9 から 0.1 へのグラデーションで塗る。
   * 根拠: mxGraph の mxRectangleShape.paintForeground (角の丸めは getArcSize(w + 線の太さ, h + 線の太さ))、
   * draw.io の Shapes.js の mxShape.paintGlassEffect・paintGlassEffectPath と、mxEllipse・mxRhombus の paintGlassEffectPath
   */
  const glassSvg = (c: Cell, shape: 'rect' | 'ellipse' | 'rhombus', b: Box): string => {
    const s = c.style;
    if (!flag(s, 'glass') || !color(c, 'fillColor', '#ffffff')) return '';
    const { x, y, w, h } = b;
    const canvas = makeCanvas(c, shape);
    const swRaw = num(s.strokeWidth, 1);
    const sw = Math.ceil(swRaw / 2);
    const rounded = flag(s, 'rounded');
    canvas.setStrokeColor('none');
    canvas.setGradient('#ffffff', '#ffffff', 'south', 0.9, 0.1);
    canvas.begin();
    if (shape === 'ellipse') {
      const kappa = 0.5522847498;
      const rx = w / 2 + sw;
      const ry = h / 2 + sw;
      const cx = x + w / 2;
      const cy = y + h / 2;
      canvas.moveTo(cx - rx, cy);
      canvas.curveTo(cx - rx, cy - ry * kappa, cx - rx * kappa, cy - ry, cx, cy - ry);
      canvas.curveTo(cx + rx * kappa, cy - ry, cx + rx, cy - ry * kappa, cx + rx, cy);
      canvas.quadTo(cx, cy + h * 0.2, cx - rx, cy);
    } else if (shape === 'rhombus') {
      // 角の丸めは arcSize (既定 mxConstants.LINE_ARCSIZE 20) の半分
      canvas.addPoints([{ x, y: y + h / 2 }, { x: x + w / 2, y }, { x: x + w, y: y + h / 2 }], rounded, num(s.arcSize, 20) / 2, false);
      canvas.quadTo(x + w / 2, y + h * 0.7, x, y + h / 2);
    } else {
      // mxRectangleShape.getArcSize: absoluteArcSize なら arcSize (既定 LINE_ARCSIZE 20) の半分、そうでなければ短い辺の arcSize (既定 15) %
      const ww = w + swRaw;
      const hh = h + swRaw;
      const arc0 = flag(s, 'absoluteArcSize') ? Math.min(ww / 2, hh / 2, num(s.arcSize, 20) / 2) : Math.min(ww, hh) * (num(s.arcSize, 15) / 100);
      const arc = arc0 + 2 * sw;
      if (rounded) {
        canvas.moveTo(x - sw + arc, y - sw);
        canvas.quadTo(x - sw, y - sw, x - sw, y - sw + arc);
        canvas.lineTo(x - sw, y + h * 0.4);
        canvas.quadTo(x + w * 0.5, y + h * 0.7, x + w + sw, y + h * 0.4);
        canvas.lineTo(x + w + sw, y - sw + arc);
        canvas.quadTo(x + w + sw, y - sw, x + w + sw - arc, y - sw);
      } else {
        canvas.moveTo(x - sw, y - sw);
        canvas.lineTo(x - sw, y + h * 0.4);
        canvas.quadTo(x + w * 0.5, y + h * 0.7, x + w + sw, y + h * 0.4);
        canvas.lineTo(x + w + sw, y - sw);
      }
    }
    canvas.close();
    canvas.fill();
    return canvas.out.join('');
  };

  /** 図形 (枠 b の中。向きの回転は呼ぶ側) の SVG。描けない形は undefined */
  const shapeSvg = (c: Cell, shape: string, b: Box): string | undefined => {
    const s = c.style;
    const { x, y, w, h } = b;
    const P = paint(c);
    const L = paint(c, { fill: 'none' });
    const poly = (pts: Array<[number, number]>) => `<path d="M${pts.map(([px, py]) => `${f(x + px)} ${f(y + py)}`).join('L')}Z" ${P}/>`;
    const path = (d: string, attrs = P) => `<path d="${d}" ${attrs}/>`;
    const X = (v: number) => f(x + v);
    const Y = (v: number) => f(y + v);
    switch (shape) {
      case 'label':
      case 'rectangle':
      case 'rect':
      case 'table':
      case 'tableCell': {
        // 表と表の枡は光沢を描かない (draw.io の TableShape・TableRowShape の isGlassable は false)
        const glass = shape === 'table' || shape === 'tableCell' ? '' : glassSvg(c, 'rect', b);
        if (flag(s, 'rounded')) {
          // 角の丸め (mxGraph の mxRectangleShape: arcSize は短い辺に対する百分率 (既定 15。mxConstants.RECTANGLE_ROUNDING_FACTOR)、
          // absoluteArcSize=1 なら px の直径)
          const as = num(s.arcSize, 15);
          const r = flag(s, 'absoluteArcSize') ? Math.min(w / 2, h / 2, as / 2) : Math.min(w, h) * (as / 100);
          return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ry="${f(r)}" ${P}/>` + glass;
        }
        return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${P}/>` + glass;
      }
      case 'ellipse':
        return `<ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}" ${P}/>` + glassSvg(c, 'ellipse', b);
      case 'doubleEllipse': {
        // 内側の楕円 (mxGraph の mxDoubleEllipse: 間隔は 3 + 線の太さ、幅・高さの 1/5 まで)
        const k = Math.max(0, Math.min(3 + num(s.strokeWidth, 1), w / 5, h / 5));
        return `<ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}" ${P}/><ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2 - k)}" ry="${f(h / 2 - k)}" ${L}/>`;
      }
      case 'rhombus':
        return (
          poly([
            [w / 2, 0],
            [w, h / 2],
            [w / 2, h],
            [0, h / 2],
          ]) + glassSvg(c, 'rhombus', b)
        );
      case 'triangle':
        return poly([
          [0, 0],
          [w, h / 2],
          [0, h],
        ]);
      case 'cylinder': {
        // 円柱 (mxGraph の mxCylinder: ふたの高さは h / 5 で 40 まで)
        const dy = Math.min(40, Math.floor(h / 5));
        return (
          path(`M${X(0)} ${Y(dy)}C${X(0)} ${Y(-dy / 3)} ${X(w)} ${Y(-dy / 3)} ${X(w)} ${Y(dy)}V${Y(h - dy)}C${X(w)} ${Y(h + dy / 3)} ${X(0)} ${Y(h + dy / 3)} ${X(0)} ${Y(h - dy)}Z`) +
          path(`M${X(0)} ${Y(dy)}C${X(0)} ${Y(2 * dy)} ${X(w)} ${Y(2 * dy)} ${X(w)} ${Y(dy)}`, L)
        );
      }
      case 'cloud':
        // mxGraph の mxCloud の形 (枠に対する割合で書いた 6 本の曲線)
        return path(
          `M${X(0.25 * w)} ${Y(0.25 * h)}C${X(0.05 * w)} ${Y(0.25 * h)} ${X(0)} ${Y(0.5 * h)} ${X(0.16 * w)} ${Y(0.55 * h)}C${X(0)} ${Y(0.66 * h)} ${X(0.18 * w)} ${Y(0.9 * h)} ${X(0.31 * w)} ${Y(0.8 * h)}C${X(0.4 * w)} ${Y(h)} ${X(0.7 * w)} ${Y(h)} ${X(0.8 * w)} ${Y(0.8 * h)}C${X(w)} ${Y(0.8 * h)} ${X(w)} ${Y(0.6 * h)} ${X(0.875 * w)} ${Y(0.5 * h)}C${X(w)} ${Y(0.3 * h)} ${X(0.8 * w)} ${Y(0.1 * h)} ${X(0.625 * w)} ${Y(0.2 * h)}C${X(0.5 * w)} ${Y(0.05 * h)} ${X(0.3 * w)} ${Y(0.05 * h)} ${X(0.25 * w)} ${Y(0.25 * h)}Z`,
        );
      case 'actor': {
        // mxGraph の mxActor (人の上半身)
        const k = w / 3;
        return path(
          `M${X(0)} ${Y(h)}C${X(0)} ${Y((3 * h) / 5)} ${X(0)} ${Y((2 * h) / 5)} ${X(w / 2)} ${Y((2 * h) / 5)}C${X(w / 2 - k)} ${Y((2 * h) / 5)} ${X(w / 2 - k)} ${Y(0)} ${X(w / 2)} ${Y(0)}C${X(w / 2 + k)} ${Y(0)} ${X(w / 2 + k)} ${Y((2 * h) / 5)} ${X(w / 2)} ${Y((2 * h) / 5)}C${X(w)} ${Y((2 * h) / 5)} ${X(w)} ${Y((3 * h) / 5)} ${X(w)} ${Y(h)}Z`,
        );
      }
      case 'line': {
        // 真ん中を通る横の線 (mxGraph の mxLine。向き (direction) は呼ぶ側で回す)
        const stroke = color(c, 'strokeColor', '#000000');
        if (!stroke) return '';
        return path(`M${X(0)} ${Y(h / 2)}H${X(w)}`, L);
      }
      case 'partialRectangle':
      case 'tableRow': {
        // draw.io の PartialRectangleShape: top・left・bottom・right (既定 1) の辺だけ線を引く
        const fill = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${paint(c, { stroke: false })}/>`;
        const on = (k: string) => flag(s, k, shape === 'partialRectangle');
        const d = [on('top') ? `M${X(0)} ${Y(0)}H${X(w)}` : '', on('right') ? `M${X(w)} ${Y(0)}V${Y(h)}` : '', on('bottom') ? `M${X(0)} ${Y(h)}H${X(w)}` : '', on('left') ? `M${X(0)} ${Y(0)}V${Y(h)}` : ''].join('');
        return fill + (d ? path(d, L) : '');
      }
      case 'swimlane': {
        // スイムレーン (mxGraph の mxSwimlane): 見出し (startSize。horizontal=0 なら左の帯) を fillColor で塗り、
        // 本体は swimlaneFillColor (既定は塗らない) で塗る。swimlaneLine=0 なら見出しと本体の間の線を引かない
        const k = Math.max(0, num(s.startSize, 23));
        const horiz = s.horizontal !== '0';
        const hs = horiz ? Math.min(h, k) : Math.min(w, k);
        const bodyFill = color(c, 'swimlaneFillColor', '#ffffff');
        const head = horiz ? { x, y, w, h: hs } : { x, y, w: hs, h };
        const rest = horiz ? { x, y: y + hs, w, h: h - hs } : { x: x + hs, y, w: w - hs, h };
        const out: string[] = [];
        if (bodyFill) out.push(`<rect x="${f(rest.x)}" y="${f(rest.y)}" width="${f(rest.w)}" height="${f(rest.h)}" ${paint(c, { fill: bodyFill, stroke: false })}/>`);
        out.push(`<rect x="${f(head.x)}" y="${f(head.y)}" width="${f(head.w)}" height="${f(head.h)}" ${paint(c, { stroke: false })}/>`);
        out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${L}/>`);
        if (s.swimlaneLine !== '0') out.push(path(horiz ? `M${X(0)} ${Y(hs)}H${X(w)}` : `M${X(hs)} ${Y(0)}V${Y(h)}`, L));
        return out.join('');
      }
      case 'image':
        return imageSvg(c, b) ?? '';
      default:
        return undefined;
    }
  };

  /**
   * data: でない画像 (src: http(s) の URL か、draw.io の配布物の画像の道 img/…)。描く側が取って渡したもの (opts.stencils の画像) で描く。
   * 無ければ、描く側に求める (missingImages) と警告する。ほかの道 (相対の URL など) は読まない
   */
  const externalImage = (src: string, b: Box, aspect: boolean, what: { ja: string; en: string }): string | undefined => {
    if (!isRemoteImage(src) && !isDrawioImagePath(src)) {
      warn(msg(`${what.ja}の URL は読まない (${src.slice(0, 120)})`, `${what.en}: URL not read (${src.slice(0, 120)})`));
      return undefined;
    }
    const img = opts.stencils?.image(src);
    if (!img) {
      missingImages.add(src);
      warn(
        isRemoteImage(src)
          ? msg(`${what.ja} ${src.slice(0, 120)} は描けない (取れない・取るのを許していない)`, `${what.en} ${src.slice(0, 120)} cannot be drawn (it could not be fetched, or fetching is not allowed)`)
          : msg(
              `${what.ja} ${src.slice(0, 120)} は描けない (draw.io の配布物の画像が無い。図形ライブラリと一緒に渡すか、取るのを許す)`,
              `${what.en} ${src.slice(0, 120)} cannot be drawn (the image from draw.io's distribution is missing; pass it with the shape libraries or allow fetching)`,
            ),
      );
      return undefined;
    }
    return imageMarkup(img, b, aspect);
  };

  /**
   * 画像 (style の image。draw.io は data: の URI を「data:image/png,<base64>」と ; を抜いて書く)。PNG・JPEG は image 要素、
   * SVG は中身を入れ子の svg にして入れる (Node でも図形で描けるように)。imageAspect=0 なら枠に引き伸ばす
   */
  const imageSvg = (c: Cell, b: Box): string | undefined => {
    const src = c.style.image?.trim();
    if (!src) return undefined;
    const aspect = c.style.imageAspect !== '0';
    // data: でない画像 (http(s) の URL・draw.io の配布物の画像の道 img/…) は、描く側が取って渡したものを使う
    if (!/^data:/i.test(src)) return externalImage(src, b, aspect, { ja: '画像', en: 'image' });
    const m = /^data:image\/(png|jpeg|jpg|svg\+xml)(;base64)?,([\s\S]*)$/i.exec(src);
    if (!m) {
      warn(msg('画像の形式が読めない (PNG・JPEG・SVG の data: の画像だけを描く)', 'unreadable image format (only data: PNG, JPEG and SVG images are drawn)'));
      return undefined;
    }
    const kind = m[1].toLowerCase();
    if (kind === 'svg+xml') {
      let svg: string;
      try {
        // draw.io は SVG の画像も base64 で書く (;base64 は書かない)。base64 と読めなければ %xx の文字として読む
        svg = new TextDecoder().decode(Uint8Array.from(atob(m[3].replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)));
      } catch {
        try {
          svg = decodeURIComponent(m[3]);
        } catch {
          return undefined;
        }
      }
      return svgInBox(svg, b, aspect);
    }
    const data = m[3].replace(/\s+/g, '');
    return `<image x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="${aspect ? 'xMidYMid meet' : 'none'}" href="data:image/${kind === 'jpg' ? 'jpeg' : kind};base64,${esc(data)}"/>`;
  };

  // ───── 文字 ─────

  const baseRun = (c: Cell): RunStyle => {
    const fs = num(c.style.fontStyle, 0);
    return {
      bold: (fs & 1) !== 0,
      italic: (fs & 2) !== 0,
      underline: (fs & 4) !== 0,
      strike: (fs & 8) !== 0,
      color: color(c, 'fontColor', '#000000'),
      size: Math.max(1, num(c.style.fontSize, 12)),
      family: (c.style.fontFamily ?? 'Helvetica').split(',')[0].trim(),
    };
  };
  /** ラベルの字の数の、図の全体の残り (LIMITS.labelTotal) */
  let labelLeft = LIMITS.labelTotal;
  /** セルごとのラベル (placeholders を置き換え、長さの上限で切ったもの。drawLabel と形の値 (makeEnv) で 2 度引くので覚える) */
  const labelCache = new Map<Cell, string>();
  const labelText = (c: Cell): string => {
    const hit = labelCache.get(c);
    if (hit !== undefined) return hit;
    let v = c.value.slice(0, LIMITS.label);
    // placeholders=1: %名前% を包みの要素の属性で置き換える (draw.io の Graph.replacePlaceholders)。
    // 置き換えた結果も長さの上限 (LIMITS.label) までにする (前は、%a% を 2 万個と、1 万字の a で、2 億字のラベルを作った)
    if (c.vars && flag(c.style, 'placeholders')) {
      let n = 0;
      v = v.replace(/%([^%\s]+)%/g, (m, k: string) => {
        if (n > LIMITS.label) return '';
        const r = c.vars!.get(k) ?? m;
        n += r.length;
        return r;
      });
      v = v.slice(0, LIMITS.label);
    }
    // 図の全体のラベルの字の数の上限 (LIMITS.labelTotal)。超えたら、そのラベルからあとは描かない
    if (v.length > labelLeft) {
      if (v.trim()) warn(msg(`ラベルの字が多すぎる (1 つの図で ${LIMITS.labelTotal} 字まで。それを超えるラベルは描かない)`, `too many label characters (up to ${LIMITS.labelTotal} per diagram; labels beyond that are not drawn)`));
      v = '';
    }
    labelLeft -= v.length;
    labelCache.set(c, v);
    return v;
  };

  /**
   * 文字の塊を描く。box: 置く枠 (図形の枠、線のラベルは点 (大きさ 0))。揃え (align・verticalAlign) と内側の余白 (spacing。既定 2) で置く。
   * 1 行の高さは字の大きさの 1.2 倍 (mxConstants.LINE_HEIGHT)、基線は行の上から 0.95 倍 (Helvetica・Arial の字の上下の比で見積もる)
   */
  const drawLabel = (c: Cell, box: Box, opts: { wrapW?: number; out: string[]; rot?: number; cx?: number; cy?: number }) => {
    const s = c.style;
    if (flag(s, 'noLabel')) return;
    const value = labelText(c);
    if (!value.trim()) return;
    const html = flag(s, 'html');
    let lines = labelLines(value, html, baseRun(c));
    if (!lines.some((l) => l.length)) return;
    const sp = num(s.spacing, 2);
    const spL = sp + num(s.spacingLeft, 0);
    const spR = sp + num(s.spacingRight, 0);
    const spT = sp + num(s.spacingTop, 0);
    const spB = sp + num(s.spacingBottom, 0);
    // horizontal=0: 文字を左へ 90 度回す (下から上へ読む)。枠の縦横を入れ替えて組み、中心で回す
    const vert = s.horizontal === '0';
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const bx = vert ? { x: cx - box.h / 2, y: cy - box.w / 2, w: box.h, h: box.w } : box;
    if (opts.wrapW !== undefined && s.whiteSpace === 'wrap') {
      const maxW = (vert ? bx.w : opts.wrapW) - spL - spR;
      if (maxW > 0) lines = wrapLines(lines, maxW);
    }
    const heights = lines.map((l) => 1.2 * l.reduce((m, r) => Math.max(m, r.size), baseRun(c).size));
    const total = heights.reduce((a, b) => a + b, 0);
    const maxLine = lines.reduce((m, l) => Math.max(m, lineWidth(l)), 0);
    const align = s.align ?? 'center';
    const valign = s.verticalAlign ?? 'middle';
    let top = valign === 'top' ? bx.y + spT : valign === 'bottom' ? bx.y + bx.h - spB - total : bx.y + (bx.h - total) / 2 + (spT - spB) / 2;
    const ax = align === 'left' ? bx.x + spL : align === 'right' ? bx.x + bx.w - spR : bx.x + bx.w / 2 + (spL - spR) / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const out: string[] = [];
    // 文字の背景と枠 (labelBackgroundColor・labelBorderColor。文字の塊の外接の枠に、余白 1 を足して描く)
    const bg = color(c, 'labelBackgroundColor', '#ffffff');
    const border = color(c, 'labelBorderColor', '#000000');
    const tx = anchor === 'start' ? ax : anchor === 'end' ? ax - maxLine : ax - maxLine / 2;
    const tb = { x: tx - 1, y: top - 1, w: maxLine + 2, h: total + 2 };
    // 行ごとの揃え (HTML の text-align): 文字の塊 (幅は、折り返すなら折り返しの幅、そうでなければ最も長い行) の中で揃える。
    // draw.io の HTML のラベルは、塊の要素の text-align をセルの align にし、中のブロックの要素の text-align で行を揃える
    const wrapped = opts.wrapW !== undefined && s.whiteSpace === 'wrap';
    const blockW = wrapped ? Math.max(maxLine, (vert ? bx.w : opts.wrapW!) - spL - spR) : maxLine;
    const blockX = anchor === 'start' ? ax : anchor === 'end' ? ax - blockW : ax - blockW / 2;
    const lineX = (a: string) => (a === 'left' ? blockX : a === 'right' ? blockX + blockW : blockX + blockW / 2);
    if (bg || border) out.push(`<rect x="${f(tb.x)}" y="${f(tb.y)}" width="${f(tb.w)}" height="${f(tb.h)}" fill="${esc(bg ?? 'none')}" stroke="${esc(border ?? 'none')}"/>`);
    const to = num(s.textOpacity, 100);
    for (const [k, l] of lines.entries()) {
      const lh = heights[k];
      if (l.length) {
        const baseline = top + lh / 2 + (0.95 - 0.6) * l.reduce((m, r) => Math.max(m, r.size), 0);
        const spans = l
          .map((r) => {
            const a = [`font-size="${f(r.size)}"`, `font-family="${esc(r.family)}"`, `fill="${esc(r.color ?? 'none')}"`];
            if (r.bold) a.push('font-weight="bold"');
            if (r.italic) a.push('font-style="italic"');
            const deco = [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ');
            if (deco) a.push(`text-decoration="${deco}"`);
            return `<tspan ${a.join(' ')}>${esc(r.text)}</tspan>`;
          })
          .join('');
        const la = l[0].align ?? align;
        const lx = l[0].align ? lineX(la) : ax;
        const lanchor = la === 'left' ? 'start' : la === 'right' ? 'end' : 'middle';
        out.push(`<text x="${f(lx)}" y="${f(baseline)}" text-anchor="${lanchor}" xml:space="preserve"${to < 100 ? ` opacity="${f(Math.max(0, to) / 100)}"` : ''}>${spans}</text>`);
      }
      top += lh;
    }
    const tr: string[] = [];
    if (opts.rot) tr.push(`rotate(${f(opts.rot)} ${f(opts.cx ?? cx)} ${f(opts.cy ?? cy)})`);
    if (vert) tr.push(`rotate(-90 ${f(cx)} ${f(cy)})`);
    opts.out.push(tr.length ? `<g transform="${tr.join(' ')}">${out.join('')}</g>` : out.join(''));
    // 外接の枠: 文字の塊の 4 隅を、縦の文字の回転 (枠の中心で) と図形の回転 (図形の中心で) の順に写す
    let corners: Pt[] = [
      { x: tb.x, y: tb.y },
      { x: tb.x + tb.w, y: tb.y },
      { x: tb.x + tb.w, y: tb.y + tb.h },
      { x: tb.x, y: tb.y + tb.h },
    ];
    if (vert) corners = corners.map((p) => rotPt(p, -90, cx, cy));
    if (opts.rot) corners = corners.map((p) => rotPt(p, opts.rot!, opts.cx ?? cx, opts.cy ?? cy));
    for (const p of corners) addPt(p.x, p.y);
  };

  /** 図形の文字を置く枠 (labelPosition・verticalLabelPosition で図形の外に出す。スイムレーンは見出しの中) */
  const labelBox = (c: Cell, b: Box, shape: string): Box => {
    const s = c.style;
    // 形ごとの文字の置き場は、文字が形の内側にあるときだけ (mxCellRenderer.getLabelBounds: labelPosition が center、verticalLabelPosition が middle)
    const inside = (s.labelPosition ?? 'center') === 'center' && (s.verticalLabelPosition ?? 'middle') === 'middle';
    let { x, y, w, h } = inside ? shapeLabelBounds(c, b, shape) : b;
    if (s.labelPosition === 'left') x -= w;
    else if (s.labelPosition === 'right') x += w;
    if (s.verticalLabelPosition === 'top') y -= h;
    else if (s.verticalLabelPosition === 'bottom') y += h;
    return { x, y, w, h };
  };

  /**
   * 形ごとの文字の置き場 (mxShape.getLabelBounds と、形ごとの getLabelMargins・getLabelBounds。mxGraph の mxSwimlane・mxDoubleEllipse と
   * draw.io の Shapes.js)。余白 (左・上・右・下) で決める形は、東向きの形の余白を、向き (direction) と反転で回す (mxUtils.getDirectedBounds)。
   * 多くの形は boundedLbl=1 のときだけ (draw.io の図形の一覧は、円柱・書類などにこれを付けて図に入れる)
   */
  const shapeLabelBounds = (c: Cell, r: Box, shape: string): Box => {
    const s = c.style;
    const bounded = flag(s, 'boundedLbl');
    const sw = num(s.strokeWidth, 1);
    let m: [number, number, number, number] | undefined;
    switch (shape) {
      case 'swimlane': {
        // 見出しの帯 (startSize。horizontal=0 なら左の帯)
        const k = Math.max(0, num(s.startSize, 23));
        return s.horizontal !== '0' ? { ...r, h: Math.min(r.h, k) } : { ...r, w: Math.min(r.w, k) };
      }
      case 'umlLifeline':
        // 頭の箱 (高さ size。既定 40。lifelineMirror なら高さの半分まで)
        return { ...r, h: Math.max(0, Math.min(s.lifelineMirror === '1' ? r.h / 2 : r.h, num(s.size, 40))) };
      case 'doubleEllipse': {
        const k = num(s.margin, Math.min(3 + sw, r.w / 5, r.h / 5));
        return { x: r.x + k, y: r.y + k, w: r.w - 2 * k, h: r.h - 2 * k };
      }
      case 'rhombus':
      case 'ext': {
        if (s.double !== '1') return r;
        const k = Math.max(2, sw + 1) * (shape === 'rhombus' ? 2 : 1) + num(s.margin, 0);
        return { x: r.x + k, y: r.y + k, w: r.w - 2 * k, h: r.h - 2 * k };
      }
      case 'tape': {
        if (!bounded) return r;
        const k = num(s.size, 0.4);
        const dir = s.direction ?? 'east';
        return dir === 'east' || dir === 'west' ? { x: r.x, y: r.y + r.h * k, w: r.w, h: r.h - 2 * r.h * k } : { x: r.x + r.w * k, y: r.y, w: r.w - 2 * r.w * k, h: r.h };
      }
      case 'process':
      case 'process2': {
        // 縦の線の内側 (文字の向きと形の向きがそろうとき)
        const dir = s.direction ?? 'east';
        if ((s.horizontal !== '0') !== (dir === 'east' || dir === 'west')) return r;
        let inset = flag(s, 'fixedSize') ? Math.max(0, Math.min(r.w, num(s.size, 0.1))) : r.w * Math.max(0, Math.min(1, num(s.size, 0.1)));
        if (flag(s, 'rounded')) {
          const f2 = num(s.arcSize, 15) / 100;
          inset = Math.max(inset, Math.min(r.w * f2, r.h * f2));
        }
        return { x: r.x + Math.round(inset), y: r.y, w: r.w - Math.round(2 * inset), h: r.h };
      }
      case 'umlControl':
        return { x: r.x, y: r.y + r.h / 8, w: r.w, h: (r.h * 7) / 8 };
      case 'gitTag': {
        const k = num(s.tabSize, 8);
        return { x: r.x + k, y: r.y, w: r.w - k, h: r.h };
      }
      case 'mindmapBang':
        return { x: r.x + r.w * 0.1, y: r.y + r.h * 0.1, w: r.w * 0.8, h: r.h * 0.8 };
      case 'mermaidOdd':
        return { x: r.x + r.h / 4, y: r.y, w: r.w - r.h / 4, h: r.h };
      case 'mermaidPerson': {
        const rad = Math.min(Math.max(r.w * 0.23, 16), 56);
        const top = Math.min(r.h, 2 * rad - rad * 0.27);
        return { x: r.x, y: r.y + top, w: r.w, h: r.h - top };
      }
      // 余白で決める形
      case 'cube':
        if (bounded) m = [num(s.size, 20), num(s.size, 20), 0, 0];
        break;
      case 'datastore':
        m = [0, 2.5 * Math.min(r.h / 2, Math.round(r.h / 8) + sw - 1), 0, 0];
        break;
      case 'note2':
        if (bounded) m = [0, Math.min(r.h, num(s.size, 15)), 0, Math.max(0, num(s.size, 15))];
        break;
      case 'umlState':
        if (bounded && s.umlStateConnection) m = [10, 0, 0, 0];
        break;
      case 'document':
        if (bounded) m = [0, 0, 0, num(s.size, 0.3) * r.h];
        break;
      case 'cylinder':
      case 'note':
      case 'isoCube':
      case 'module':
      case 'component':
      case 'message':
      case 'waypoint':
        // mxGraph の mxCylinder を土台にする形 (draw.io の Shapes.js の mxCylinder.prototype.getLabelMargins。ふたの高さ 40 まで)
        if (bounded) m = [0, Math.min(40, r.h * num(s.size, 0.15) * 2), 0, 0];
        break;
      case 'cylinder3': {
        if (!bounded) break;
        const size = num(s.size, 15) / (s.lid === '0' ? 2 : 1);
        m = [0, Math.min(r.h, size * 2), 0, Math.max(0, size * 0.3)];
        break;
      }
      case 'folder': {
        if (!bounded) break;
        const ty = num(s.tabHeight, 15);
        if (flag(s, 'labelInHeader')) {
          const tx = num(s.tabWidth, 15);
          let arc = num(s.arcSize, 0.1);
          if (!flag(s, 'absoluteArcSize')) arc = Math.min(r.w, r.h) * arc;
          arc = flag(s, 'rounded') ? Math.min(arc, r.w * 0.5, (r.h - ty) * 0.5) : 0;
          m = s.tabPosition === 'left' ? [arc, 0, Math.min(r.w, r.w - tx), Math.min(r.h, r.h - ty)] : [Math.min(r.w, r.w - tx), 0, arc, Math.min(r.h, r.h - ty)];
        } else m = [0, Math.min(r.h, ty), 0, 0];
        break;
      }
      case 'callout':
        m = [0, 0, 0, num(s.size, 20)];
        break;
      case 'umlBoundary':
        m = [r.w / 6, 0, 0, 0];
        break;
      case 'umlFrame':
        m = [0, 0, r.w - num(s.width, 60), r.h - num(s.height, 30)];
        break;
      case 'manualInput':
        if (bounded) m = [0, num(s.size, 30), 0, 0];
        break;
      default: {
        // 図形ライブラリの形の labelBounds (draw.io の Shapes.js の mxShape.prototype.getLabelMargins): 形の座標で書いた文字の枠
        // (if の属性のキーが 1 のときだけ。w・h の既定は形の大きさ) を、形の写し方 (mxStencil.computeAspect) で枠に写して、余白にする
        if (!shape.startsWith('mxgraph.') && !shape.startsWith('stencil(')) break;
        const st = stencilCtx.lookup(shape);
        if (!st) break;
        const all: XEl[] = [];
        const walk = (el: XEl) => {
          for (const k of el.children) {
            if (k.name === 'labelBounds') all.push(k);
            else walk(k);
          }
        };
        walk(st);
        const lb = all.find((b) => {
          const cond = b.attrs.get('if');
          return cond === undefined || s[cond] === '1';
        });
        if (!lb) break;
        const w0 = num(st.attrs.get('w'), 100) || 100;
        const h0 = num(st.attrs.get('h'), 100) || 100;
        let sx = r.w / w0;
        let sy = r.h / h0;
        let ax = 0;
        let ay = 0;
        if (st.attrs.get('aspect') === 'fixed') {
          sx = sy = Math.min(sx, sy);
          ax = (r.w - w0 * sx) / 2;
          ay = (r.h - h0 * sy) / 2;
        }
        const x0 = ax + num(lb.attrs.get('x'), 0) * sx;
        const y0 = ay + num(lb.attrs.get('y'), 0) * sy;
        m = [x0, y0, r.w - x0 - num(lb.attrs.get('w'), w0) * sx, r.h - y0 - num(lb.attrs.get('h'), h0) * sy];
        break;
      }
    }
    return m ? directedBounds(r, m, s) : r;
  };
  /**
   * 東向きの形の余白 m (左・上・右・下) を、形の向きと反転に合わせて回し、枠から引く (mxUtils.getDirectedBounds)。余白は枠の大きさまでに丸める
   */
  const directedBounds = (r: Box, m0: [number, number, number, number], s: Style): Box => {
    const d = s.direction ?? 'east';
    const fh = flag(s, 'flipH');
    const fv = flag(s, 'flipV');
    let [mx, my, mw, mh] = [Math.round(Math.max(0, Math.min(r.w, m0[0]))), Math.round(Math.max(0, Math.min(r.h, m0[1]))), Math.round(Math.max(0, Math.min(r.w, m0[2]))), Math.round(Math.max(0, Math.min(r.h, m0[3])))];
    const vertical = d === 'south' || d === 'north';
    if ((fv && vertical) || (fh && !vertical)) [mx, mw] = [mw, mx];
    if ((fh && vertical) || (fv && !vertical)) [my, mh] = [mh, my];
    let m2 = [mx, my, mw, mh];
    if (d === 'south') m2 = [mh, mx, my, mw];
    else if (d === 'west') m2 = [mw, mh, mx, my];
    else if (d === 'north') m2 = [my, mw, mh, mx];
    return { x: r.x + m2[0], y: r.y + m2[1], w: r.w - m2[2] - m2[0], h: r.h - m2[3] - m2[1] };
  };

  // ───── 線 ─────

  /** 枠 b の周の点のうち、中心から点 p へ向かう半直線と交わる点 (mxGraph の mxPerimeter の rectangle・ellipse・rhombus・triangle) */
  const perimeterPoint = (c: Cell, b: Box, p: Pt): Pt => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if ((dx === 0 && dy === 0) || b.w <= 0 || b.h <= 0) return { x: cx, y: cy };
    const s = c.style;
    const per = s.perimeter ?? '';
    // 中心 (draw.io の Shapes.js の CenterPerimeter)
    if (per === 'centerPerimeter') return { x: cx, y: cy };
    // 生存線 (LifelinePerimeter): 縦の線の上 (頭の高さ size (既定 40) から下)。背骨 (BackbonePerimeter): 横 (縦向きなら縦) の線の上
    if (per === 'lifelinePerimeter') {
      const size = num(s.size, 40);
      const max = b.y + b.h - (s.lifelineMirror === '1' ? size : 0);
      const half = num(s.strokeWidth, 1) / 2;
      return { x: cx + (p.x < cx ? -half : half), y: Math.min(max, Math.max(b.y + size, p.y)) };
    }
    if (per === 'backbonePerimeter') {
      const half = num(s.strokeWidth, 1) / 2 + (s.backboneSize !== undefined ? num(s.backboneSize, 0) / 2 : 0);
      if (s.direction === 'south' || s.direction === 'north') return { x: cx + (p.x < cx ? -half : half), y: Math.min(b.y + b.h, Math.max(b.y, p.y)) };
      return { x: Math.min(b.x + b.w, Math.max(b.x, p.x)), y: cy + (p.y < cy ? -half : half) };
    }
    // 多角形の輪郭の周 (三角形・六角形・平行四辺形・台形・ステップ・吹き出し。mxGraph の mxPerimeter と draw.io の Shapes.js の *Perimeter):
    // 中心から点へ向かう半直線と、形の輪郭の交わる点。輪郭は、描く形と同じに向き (direction) で回す
    const poly = outlineOf(c, b);
    if (poly) {
      let best: Pt | undefined;
      let bt = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const e2 = poly[(k + 1) % poly.length];
        const ex = e2.x - a.x;
        const ey = e2.y - a.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((a.x - cx) * ey - (a.y - cy) * ex) / den;
        const u = ((a.x - cx) * dy - (a.y - cy) * dx) / den;
        if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < bt) {
          bt = t;
          best = { x: cx + dx * t, y: cy + dy * t };
        }
      }
      if (best) return best;
    }
    if (per === 'ellipsePerimeter' || per === 'cloudPerimeter' || s.shape === 'ellipse' || s.shape === 'doubleEllipse') {
      const a = b.w / 2;
      const bb2 = b.h / 2;
      const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (bb2 * bb2));
      return { x: cx + dx * t, y: cy + dy * t };
    }
    if (per === 'rhombusPerimeter' || c.style.shape === 'rhombus') {
      const t = 1 / (Math.abs(dx) / (b.w / 2) + Math.abs(dy) / (b.h / 2));
      return { x: cx + dx * t, y: cy + dy * t };
    }
    const t = Math.min(dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  };

  /**
   * 周の形の輪郭の多角形 (枠 b の中。向き (direction) で回す)。多角形でない周は undefined。
   * 形の大きさの既定は、形と同じ (六角形・平行四辺形・台形・ステップ: size は幅に対する割合 (fixedSize=1 なら px。既定 20)、吹き出し: draw.io の CalloutShape)
   */
  const outlineOf = (c: Cell, b: Box): Pt[] | undefined => {
    const s = c.style;
    const per = s.perimeter ?? '';
    const dir = s.direction ?? 'east';
    const swap = dir === 'north' || dir === 'south';
    const w = swap ? b.h : b.w;
    const h = swap ? b.w : b.h;
    const fixed = flag(s, 'fixedSize');
    const frac = (def: number, max: number) => (fixed ? Math.max(0, Math.min(max, num(s.size, 20))) : w * Math.max(0, Math.min(1, num(s.size, def))));
    let pts: Array<[number, number]>;
    if (per === 'trianglePerimeter') pts = [[0, 0], [w, h / 2], [0, h]];
    else if (per === 'hexagonPerimeter' || per === 'hexagonPerimeter2') {
      const k = frac(0.25, w / 2);
      pts = [[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]];
    } else if (per === 'parallelogramPerimeter') {
      const k = frac(0.2, w / 2);
      pts = [[k, 0], [w, 0], [w - k, h], [0, h]];
    } else if (per === 'trapezoidPerimeter') {
      const k = frac(0.2, w / 2);
      pts = [[k, 0], [w - k, 0], [w, h], [0, h]];
    } else if (per === 'stepPerimeter') {
      const k = frac(0.2, w);
      pts = [[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h], [k, h / 2]];
    } else if (per === 'calloutPerimeter') {
      const size = Math.max(0, Math.min(h, num(s.size, 20)));
      const dx = w * Math.max(0, Math.min(1, num(s.position, 0.5)));
      const dx2 = w * Math.max(0, Math.min(1, num(s.position2, 0.5)));
      const base = Math.max(0, Math.min(w, num(s.base, 20)));
      pts = [[0, 0], [w, 0], [w, h - size], [Math.min(w, dx + base), h - size], [dx2, h], [Math.max(0, dx), h - size], [0, h - size]];
    } else return undefined;
    const rot = dir === 'south' ? 90 : dir === 'north' ? -90 : dir === 'west' ? 180 : 0;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return pts.map(([x, y]) => rotPt({ x: cx + x - w / 2, y: cy + y - h / 2 }, rot, cx, cy));
  };

  type Dir = 'E' | 'W' | 'N' | 'S';
  const dirVec: Record<Dir, Pt> = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } };
  const horiz = (d: Dir) => d === 'E' || d === 'W';
  /** 決まった接続点 (exitX・exitY / entryX・entryY。枠に対する割合) と、そこから出る向き */
  const fixedPort = (c: Cell, b: Box | undefined, kind: 'exit' | 'entry'): { p: Pt; d: Dir } | undefined => {
    const s = c.style;
    if (!b || s[`${kind}X`] === undefined || s[`${kind}Y`] === undefined) return undefined;
    const fx = num(s[`${kind}X`], 0.5);
    const fy = num(s[`${kind}Y`], 0.5);
    let p = { x: b.x + fx * b.w + num(s[`${kind}Dx`], 0), y: b.y + fy * b.h + num(s[`${kind}Dy`], 0) };
    const term = kind === 'exit' ? c.sourceId : c.targetId;
    const tc = term !== undefined ? cells.get(term) : undefined;
    if (s[`${kind}Perimeter`] !== '0' && tc) p = perimeterPoint(tc, b, p);
    // 向き: いちばん近い辺の外向き
    const dl = Math.abs(p.x - b.x);
    const dr = Math.abs(b.x + b.w - p.x);
    const dt = Math.abs(p.y - b.y);
    const db = Math.abs(b.y + b.h - p.y);
    const m = Math.min(dl, dr, dt, db);
    const d: Dir = m === dl ? 'W' : m === dr ? 'E' : m === dt ? 'N' : 'S';
    return { p, d };
  };
  const sideMid = (b: Box, d: Dir): Pt => (d === 'E' ? { x: b.x + b.w, y: b.y + b.h / 2 } : d === 'W' ? { x: b.x, y: b.y + b.h / 2 } : d === 'N' ? { x: b.x + b.w / 2, y: b.y } : { x: b.x + b.w / 2, y: b.y + b.h });
  /** 両端の向きの決まっていないとき、枠どうしの位置で、出る辺と入る辺を決める */
  const chooseSides = (a: Box, b: Box, pref?: 'horizontal' | 'vertical'): [Dir, Dir] => {
    const gh = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const gv = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    const right = b.x + b.w / 2 >= a.x + a.w / 2;
    const down = b.y + b.h / 2 >= a.y + a.h / 2;
    const H: [Dir, Dir] = right ? ['E', 'W'] : ['W', 'E'];
    const V: [Dir, Dir] = down ? ['S', 'N'] : ['N', 'S'];
    if (pref === 'horizontal') return H;
    if (pref === 'vertical') return V;
    if (gh > 0 && gv > 0) return gh >= gv ? [H[0], V[1]] : [V[0], H[1]];
    if (gh > 0) return H;
    if (gv > 0) return V;
    return Math.abs(b.x + b.w / 2 - (a.x + a.w / 2)) >= Math.abs(b.y + b.h / 2 - (a.y + a.h / 2)) ? H : V;
  };
  /** 直角に曲げる線 (向きの決まった 2 点を結ぶ。mxGraph の mxEdgeStyle.OrthConnector を簡単にしたもの) */
  const orthRoute = (p0: Pt, d0: Dir, p1: Pt, d1: Dir, seg = 20): Pt[] => {
    const v0 = dirVec[d0];
    const v1 = dirVec[d1];
    if (horiz(d0) && horiz(d1)) {
      if (Math.abs(p0.y - p1.y) < 0.5 && (p1.x - p0.x) * v0.x > 0) return [p0, p1];
      if (d0 !== d1 && (p1.x - p0.x) * v0.x >= 0) {
        const xm = (p0.x + p1.x) / 2;
        return [p0, { x: xm, y: p0.y }, { x: xm, y: p1.y }, p1];
      }
      if (d0 === d1) {
        const xe = v0.x > 0 ? Math.max(p0.x, p1.x) + seg : Math.min(p0.x, p1.x) - seg;
        return [p0, { x: xe, y: p0.y }, { x: xe, y: p1.y }, p1];
      }
      const a = { x: p0.x + v0.x * seg, y: p0.y };
      const b = { x: p1.x + v1.x * seg, y: p1.y };
      const ym = (p0.y + p1.y) / 2;
      return [p0, a, { x: a.x, y: ym }, { x: b.x, y: ym }, b, p1];
    }
    if (!horiz(d0) && !horiz(d1)) {
      if (Math.abs(p0.x - p1.x) < 0.5 && (p1.y - p0.y) * v0.y > 0) return [p0, p1];
      if (d0 !== d1 && (p1.y - p0.y) * v0.y >= 0) {
        const ym = (p0.y + p1.y) / 2;
        return [p0, { x: p0.x, y: ym }, { x: p1.x, y: ym }, p1];
      }
      if (d0 === d1) {
        const ye = v0.y > 0 ? Math.max(p0.y, p1.y) + seg : Math.min(p0.y, p1.y) - seg;
        return [p0, { x: p0.x, y: ye }, { x: p1.x, y: ye }, p1];
      }
      const a = { x: p0.x, y: p0.y + v0.y * seg };
      const b = { x: p1.x, y: p1.y + v1.y * seg };
      const xm = (p0.x + p1.x) / 2;
      return [p0, a, { x: xm, y: a.y }, { x: xm, y: b.y }, b, p1];
    }
    if (horiz(d0)) {
      // 横に出て縦に入る: 角が 1 つで結べるなら L の形
      if ((p1.x - p0.x) * v0.x >= 0 && (p0.y - p1.y) * v1.y >= 0) return [p0, { x: p1.x, y: p0.y }, p1];
      const a = { x: p0.x + v0.x * seg, y: p0.y };
      const b = { x: p1.x, y: p1.y + v1.y * seg };
      return [p0, a, { x: a.x, y: b.y }, b, p1];
    }
    if ((p1.y - p0.y) * v0.y >= 0 && (p0.x - p1.x) * v1.x >= 0) return [p0, { x: p0.x, y: p1.y }, p1];
    const a = { x: p0.x, y: p0.y + v0.y * seg };
    const b = { x: p1.x + v1.x * seg, y: p1.y };
    return [p0, a, { x: b.x, y: a.y }, b, p1];
  };
  /** 折れ点を通って直角に結ぶ (折れ点の間は、横、縦の順に曲げる) */
  const orthThrough = (pts: Pt[]): Pt[] => {
    const out: Pt[] = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = out[out.length - 1];
      const b = pts[k];
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
        const prev = out[out.length - 2];
        // 前の線分が横なら縦から、縦なら横から曲げる
        const prevHoriz = prev ? Math.abs(prev.y - a.y) < 0.5 : true;
        out.push(prevHoriz ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
      }
      out.push(b);
    }
    return out;
  };
  /** 同じ直線の上に並ぶ点・重なる点を除く */
  const simplify = (pts: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of pts) {
      const a = out[out.length - 1];
      if (a && Math.abs(a.x - p.x) < 0.01 && Math.abs(a.y - p.y) < 0.01) continue;
      const b = out[out.length - 2];
      if (a && b && Math.abs((a.x - b.x) * (p.y - b.y) - (a.y - b.y) * (p.x - b.x)) < 0.01 && (a.x - b.x) * (p.x - a.x) + (a.y - b.y) * (p.y - a.y) >= 0) out[out.length - 1] = p;
      else out.push(p);
    }
    return out;
  };

  /** 線の経路 (絶対の座標の点の並び) */
  const routeEdge = (e: Cell): Pt[] | undefined => {
    const g = e.geo ?? { x: 0, y: 0, w: 0, h: 0, relative: true, points: [] };
    const o = originOf(e.parent);
    const abs = (p: Pt) => ({ x: p.x + o.x, y: p.y + o.y });
    const src = e.sourceId !== undefined ? cells.get(e.sourceId) : undefined;
    const tgt = e.targetId !== undefined ? cells.get(e.targetId) : undefined;
    // 周の間隔 (mxGraphView.getPerimeterBounds): 線の perimeterSpacing と sourcePerimeterSpacing・targetPerimeterSpacing、図形の perimeterSpacing だけ、
    // 端を図形から離す (枠を広げて、その周に端を置く)
    const grow = (b: Box | undefined, cell: Cell | undefined, key: string): Box | undefined => {
      if (!b || !cell) return b;
      const k = num(e.style.perimeterSpacing, 0) + num(e.style[key], 0) + num(cell.style.perimeterSpacing, 0);
      return k ? { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k } : b;
    };
    const sb = grow(src ? boxOf(src) : undefined, src, 'sourcePerimeterSpacing');
    const tb = grow(tgt ? boxOf(tgt) : undefined, tgt, 'targetPerimeterSpacing');
    const sp = sb ? undefined : g.sourcePoint && abs(g.sourcePoint);
    const tp = tb ? undefined : g.targetPoint && abs(g.targetPoint);
    if (!sb && !sp) return undefined;
    if (!tb && !tp) return undefined;
    const way = g.points.map(abs);
    const sBox = sb ?? { x: sp!.x, y: sp!.y, w: 0, h: 0 };
    const tBox = tb ?? { x: tp!.x, y: tp!.y, w: 0, h: 0 };
    // 曲げ方の名前 (mxConstants の EDGESTYLE_* と draw.io の Shapes.js が登録する名前)。sideToSide・topToBottom は、
    // elbow の横・縦と同じ曲げ方 (mxEdgeStyle.ElbowConnector は elbow の向きで SideToSide・TopToBottom を呼ぶ)。
    // isometricEdgeStyle (斜めの等角の線) は、直角に曲げる線で近似する
    const raw = e.style.edgeStyle ?? '';
    const es = raw === 'sideToSideEdgeStyle' || raw === 'topToBottomEdgeStyle' ? 'elbowEdgeStyle' : raw;
    const elbow = raw === 'topToBottomEdgeStyle' ? 'vertical' : raw === 'sideToSideEdgeStyle' ? 'horizontal' : e.style.elbow === 'vertical' ? 'vertical' : 'horizontal';
    if (es && es !== 'none' && !KNOWN_EDGE_STYLES.has(es) && !OTHER_EDGE_STYLES.has(es)) warn(msg(`線の曲げ方 "${es.slice(0, 80)}" は知らない (まっすぐの線で描く)`, `unknown edge style "${es.slice(0, 80)}" (drawn as a straight line)`));
    const exit = fixedPort(e, sb, 'exit');
    const entry = fixedPort(e, tb, 'entry');
    const ctr = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    // 自分へ戻る線 (始まりと終わりが同じ図形。曲げ方の指定によらず mxEdgeStyle.Loop): 図形の右 (direction で変わる) に、
    // segment (既定は方眼の大きさ) の 2 倍だけ出た所の 2 点を通る。折れ点が図形の外にあれば、その点の側へ出す
    if (src && src === tgt && sb && !exit && !entry) {
      let pt: Pt | undefined = way[0];
      if (pt && pt.x >= sb.x && pt.x <= sb.x + sb.w && pt.y >= sb.y && pt.y <= sb.y + sb.h) pt = undefined;
      const seg = num(e.style.segment, gridSize);
      const dir = e.style.direction ?? 'west';
      let x = 0;
      let y = 0;
      let dx = 0;
      let dy = 0;
      if (dir === 'north' || dir === 'south') {
        x = sb.x + sb.w / 2;
        dx = seg;
      } else {
        y = sb.y + sb.h / 2;
        dy = seg;
      }
      if (!pt || pt.x < sb.x || pt.x > sb.x + sb.w) {
        if (pt) {
          x = pt.x;
          dy = Math.max(Math.abs(y - pt.y), dy);
        } else if (dir === 'north') y = sb.y - 2 * dx;
        else if (dir === 'south') y = sb.y + sb.h + 2 * dx;
        else if (dir === 'east') x = sb.x - 2 * dy;
        else x = sb.x + sb.w + 2 * dy;
      } else {
        x = sb.x + sb.w / 2;
        dx = Math.max(Math.abs(x - pt.x), dy);
        y = pt.y;
        dy = 0;
      }
      const a = { x: x - dx, y: y - dy };
      const b2 = { x: x + dx, y: y + dy };
      return simplify([perimeterPoint(src, sb, a), a, b2, perimeterPoint(src, sb, b2)]);
    }
    // シーケンス図の線 (draw.io の Shapes.js の SequenceMessage): 折れ点が 2 つ以上なら、それを通る。無ければ、両方の図形の
    // 上下の範囲の重なりの中の高さ (折れ点があればその高さ、無ければ中心の間) に、横の線を引く (端は図形の周。生存線なら縦の線の上)
    if (es === 'sequenceEdgeStyle' && src && tgt && sb && tb && src !== tgt && way.length < 2 && !exit && !entry) {
      const top = Math.max(sb.y, tb.y);
      const bottom = Math.min(sb.y + sb.h, tb.y + tb.h);
      if (top <= bottom) {
        const y = Math.min(bottom, Math.max(top, way[0]?.y ?? (sb.y + sb.h / 2 + tb.y + tb.h / 2) / 2));
        let x = (sb.x + sb.w / 2 + tb.x + tb.w / 2) / 2;
        const right = sb.x + sb.w / 2 <= tb.x + tb.w / 2 ? 1 : -1;
        for (const [b, side] of [
          [sb, right],
          [tb, -right],
        ] as const)
          if (x > b.x && x < b.x + b.w) x = side > 0 ? b.x + b.w : b.x;
        const m = { x, y };
        return simplify([perimeterPoint(src, sb, m), perimeterPoint(tgt, tb, m)]);
      }
    }
    if (KNOWN_EDGE_STYLES.has(es)) {
      const pref = es === 'entityRelationEdgeStyle' ? 'horizontal' : es === 'elbowEdgeStyle' ? elbow : undefined;
      if (way.length && es !== 'entityRelationEdgeStyle') {
        if (es === 'elbowEdgeStyle' && way.length === 1 && !exit && !entry) {
          // 折れ点 1 つの elbow: 折れ点の x (縦なら y) で曲げる (mxGraph の mxEdgeStyle.ElbowConnector)
          const [d0, d1] = chooseSides(sBox, tBox, pref);
          const p0 = sideMid(sBox, d0);
          const p1 = sideMid(tBox, d1);
          return simplify(pref === 'vertical' ? [p0, { x: p0.x, y: way[0].y }, { x: p1.x, y: way[0].y }, p1] : [p0, { x: way[0].x, y: p0.y }, { x: way[0].x, y: p1.y }, p1]);
        }
        // 折れ点のある直角の線: 端は、最初 (最後) の折れ点が枠の幅 (高さ) に入るなら、その位置から縦 (横) に出す
        const endFor = (b: Box, fixed: { p: Pt } | undefined, q: Pt): Pt => {
          if (fixed) return fixed.p;
          if (q.x >= b.x && q.x <= b.x + b.w && b.w > 0) return { x: q.x, y: q.y < b.y ? b.y : b.y + b.h };
          if (q.y >= b.y && q.y <= b.y + b.h && b.h > 0) return { x: q.x < b.x ? b.x : b.x + b.w, y: q.y };
          return perimeterPoint(src ?? e, b, q);
        };
        const p0 = sb ? endFor(sb, exit, way[0]) : sp!;
        const p1 = tb ? endFor(tb, entry, way[way.length - 1]) : tp!;
        return simplify(orthThrough([p0, ...way, p1]));
      }
      let d0: Dir;
      let d1: Dir;
      let p0: Pt;
      let p1: Pt;
      if (exit && entry) {
        ({ p: p0, d: d0 } = exit);
        ({ p: p1, d: d1 } = entry);
      } else if (exit) {
        ({ p: p0, d: d0 } = exit);
        d1 = chooseSides({ x: p0.x, y: p0.y, w: 0, h: 0 }, tBox, pref)[1];
        p1 = sideMid(tBox, d1);
      } else if (entry) {
        ({ p: p1, d: d1 } = entry);
        d0 = chooseSides(sBox, { x: p1.x, y: p1.y, w: 0, h: 0 }, pref)[0];
        p0 = sideMid(sBox, d0);
      } else {
        [d0, d1] = chooseSides(sBox, tBox, pref);
        p0 = sideMid(sBox, d0);
        p1 = sideMid(tBox, d1);
      }
      if (es === 'entityRelationEdgeStyle') {
        // 両端から横に segment (既定 30。mxConstants.ENTITY_SEGMENT) だけ出してから結ぶ
        const k = num(e.style.segment, 30);
        return simplify([p0, { x: p0.x + dirVec[d0].x * k, y: p0.y }, { x: p1.x + dirVec[d1].x * k, y: p1.y }, p1]);
      }
      return simplify(orthRoute(p0, d0, p1, d1, num(e.style.jettySize, NaN) || 20));
    }
    // まっすぐの線 (折れ点があれば、それを通る): 端は、次の点へ向かう半直線と枠の周の交わる点
    const first = way[0] ?? (tb ? (entry?.p ?? ctr(tb)) : tp!);
    const last = way[way.length - 1] ?? (sb ? (exit?.p ?? ctr(sb)) : sp!);
    const p0 = exit?.p ?? (sb ? perimeterPoint(src!, sb, first) : sp!);
    const p1 = entry?.p ?? (tb ? perimeterPoint(tgt!, tb, last) : tp!);
    return simplify([p0, ...way, p1]);
  };

  /** 経路の d (rounded=1 なら角を arcSize の半分 (既定 20。mxConstants.LINE_ARCSIZE) の半径で丸める。curved=1 なら曲線) */
  const edgePath = (pts: Pt[], s: Style): string => {
    const P = (p: Pt) => `${f(p.x)} ${f(p.y)}`;
    if (pts.length < 3) return `M${pts.map(P).join('L')}`;
    if (flag(s, 'curved')) {
      // 2 次の曲線で、折れ点を制御点にして、折れ点の間の中点を通る (mxGraph の mxPolyline の curved)
      let d = `M${P(pts[0])}`;
      for (let k = 1; k < pts.length - 2; k++) d += `Q${P(pts[k])} ${P({ x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 })}`;
      return d + `Q${P(pts[pts.length - 2])} ${P(pts[pts.length - 1])}`;
    }
    if (flag(s, 'rounded')) {
      const r = num(s.arcSize, 20) / 2;
      let d = `M${P(pts[0])}`;
      for (let k = 1; k < pts.length - 1; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        const c2 = pts[k + 1];
        const la = Math.hypot(b.x - a.x, b.y - a.y);
        const lb = Math.hypot(c2.x - b.x, c2.y - b.y);
        const ra = Math.min(r, la / 2);
        const rb = Math.min(r, lb / 2);
        const q1 = { x: b.x - ((b.x - a.x) / (la || 1)) * ra, y: b.y - ((b.y - a.y) / (la || 1)) * ra };
        const q2 = { x: b.x + ((c2.x - b.x) / (lb || 1)) * rb, y: b.y + ((c2.y - b.y) / (lb || 1)) * rb };
        d += `L${P(q1)}Q${P(b)} ${P(q2)}`;
      }
      return d + `L${P(pts[pts.length - 1])}`;
    }
    return `M${pts.map(P).join('L')}`;
  };

  /** 経路の上の位置 (x: -1〜1。0 が真ん中) と、そこから線に直角に y だけ離れた点 (mxGraph の mxGraphView.getPoint) */
  const pointOnPath = (pts: Pt[], gx: number, gy: number): Pt => {
    const lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
    const total = lens.reduce((a, b) => a + b, 0);
    let dist = ((Math.max(-1, Math.min(1, gx)) + 1) / 2) * total;
    for (let k = 0; k < lens.length; k++) {
      if (dist <= lens[k] || k === lens.length - 1) {
        const t = lens[k] ? Math.min(1, dist / lens[k]) : 0;
        const a = pts[k];
        const b = pts[k + 1];
        const nx = lens[k] ? (b.y - a.y) / lens[k] : 0;
        const ny = lens[k] ? (b.x - a.x) / lens[k] : 0;
        return { x: a.x + (b.x - a.x) * t - nx * gy, y: a.y + (b.y - a.y) * t + ny * gy };
      }
      dist -= lens[k];
    }
    return pts[0];
  };

  /** 描いた線の経路 (後の線の跳び越しの相手。noJump=1 の線は入れない) */
  const drawnLines: Pt[][] = [];
  /** 線の跳び越しの手間の残り (drawioEdges.ts の lineJumps) */
  const jumpBudget = { pairs: LIMITS.jumpPairs, limited: false };
  /** 線の手書き風 (sketch・comic): 線・矢の頭を rough.js の線にする。大きさは線の点の枠 */
  const sketchEdge = (e: Cell, svg: string, pts: Array<{ x: number; y: number }>) => {
    if (!sketchKind(e.style)) return svg;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    for (const p of pts) addBox({ x: p.x - SKETCH_MARGIN, y: p.y - SKETCH_MARGIN, w: 2 * SKETCH_MARGIN, h: 2 * SKETCH_MARGIN });
    return sketchSvg(svg, { id: e.id, style: e.style, size: Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys), budget: stencilCtx.budget });
  };
  const drawEdge = (e: Cell, out: string[]) => {
    const pts = routeEdge(e);
    if (!pts || pts.length < 2) return;
    const s = e.style;
    const shape = s.shape ?? 'connector';
    const stroke = color(e, 'strokeColor', '#000000');
    const sw = num(s.strokeWidth, 1);
    const op = num(s.opacity, 100);
    const opAttr = op < 100 ? ` opacity="${f(Math.max(0, op) / 100)}"` : '';
    // 太い矢印の線 (flexArrow・link・arrowConnector・arrow。drawioEdges.ts): 矢の頭も含めて 1 つの形で塗る (startArrow・endArrow は頭の有無だけ)
    if (Object.hasOwn(JS_EDGES, shape)) {
      // JavaScript で書かれた線の形 (drawioShapes.ts の JS_EDGES。矢の頭も形の中で描く)
      const canvas = makeCanvas(e, shape);
      JS_EDGES[shape](canvas, pts, makeEnv(e, canvas));
      const half = 15 + sw;
      for (const p of pts) addBox({ x: p.x - half, y: p.y - half, w: 2 * half, h: 2 * half });
      if (flag(s, 'shadow')) addShadowBox(e, pts);
      out.push(`<g${shadowAttr(e)}${opAttr}>${sketchEdge(e, canvas.out.join(''), pts)}</g>`);
    } else if (THICK_EDGES.has(shape)) {
      const canvas = makeCanvas(e, shape);
      let half = 15;
      if (shape === 'arrow') paintArrow(canvas, pts);
      else if (shape === 'mermaidSankeyLink') {
        const width = Math.max(1, num(s.width, 10));
        paintSankeyLink(canvas, pts, width);
        half = width / 2 + sw;
      }
      else if (shape === 'taperedArrow') {
        // 先細りの矢印 (drawioTapered.ts。draw.io の Shapes.js の TaperedArrowShape): 始まりの幅 startWidth (既定 12) から終わりの幅 endWidth (既定 2) へ細る帯
        const o = {
          ...(s.startWidth !== undefined ? { startWidth: num(s.startWidth, 12) } : {}),
          ...(s.endWidth !== undefined ? { endWidth: num(s.endWidth, 2) } : {}),
          ...(s.startArrow ? { startArrow: s.startArrow } : {}),
          ...(s.endArrow ? { endArrow: s.endArrow } : {}),
          startSize: num(s.startSize, 6),
          endSize: num(s.endSize, 6),
          startFill: s.startFill !== '0',
          endFill: s.endFill !== '0',
          ...(color(e, 'startFillColor', '#ffffff') ? { startFillColor: color(e, 'startFillColor', '#ffffff') } : {}),
          ...(color(e, 'endFillColor', '#ffffff') ? { endFillColor: color(e, 'endFillColor', '#ffffff') } : {}),
          rounded: flag(s, 'rounded'),
          arcSize: num(s.arcSize, 20),
          curved: flag(s, 'curved'),
          bezier: flag(s, 'bezier'),
          strokeWidth: sw,
          ...(color(e, 'fillColor', '#ffffff') ? { fill: color(e, 'fillColor', '#ffffff') } : {}),
          ...(stroke ? { stroke } : {}),
        };
        paintTaperedArrow(canvas, pts, o);
        half = taperedArrowGrow(o) / 2 + sw;
      }
      else {
        // 軸の太さと矢の頭の幅・長さ (draw.io の Shapes.js の FlexArrowShape・LinkShape、mxArrowConnector の既定: 幅 30・軸 10、頭の長さは startSize・endSize (既定 6) の 3 倍)
        const flex = shape === 'flexArrow';
        const edgeWidth = shape === 'arrowConnector' ? 10 : num(s.width, flex ? 10 : 4) + Math.max(0, sw - 1);
        const startWidth = flex ? edgeWidth + num(s.startWidth, 20) : 30;
        const endWidth = flex ? edgeWidth + num(s.endWidth, 20) : 30;
        paintArrowConnector(canvas, pts, {
          edgeWidth,
          startWidth,
          endWidth,
          startSize: num(s.startSize, 6) * 3,
          endSize: num(s.endSize, 6) * 3,
          markerStart: !!s.startArrow,
          markerEnd: !!s.endArrow,
          openEnded: shape === 'link',
          rounded: flag(s, 'rounded'),
          curved: flag(s, 'curved'),
          strokeWidth: sw,
        });
        half = Math.max(edgeWidth, s.startArrow ? startWidth : 0, s.endArrow ? endWidth : 0) / 2 + sw;
      }
      for (const p of pts) addBox({ x: p.x - half, y: p.y - half, w: 2 * half, h: 2 * half });
      if (flag(s, 'shadow')) addShadowBox(e, pts);
      out.push(`<g${shadowAttr(e)}${opAttr}>${sketchEdge(e, canvas.out.join(''), pts)}</g>`);
    }
    const layered = shape === 'wire' || shape === 'pipe' || shape === 'filledEdge';
    if (shape !== 'connector' && !layered && !THICK_EDGES.has(shape) && !Object.hasOwn(JS_EDGES, shape)) warn(msg(`線の形 "${shape}" は描けない (ふつうの線で描く)`, `edge shape "${shape}" cannot be drawn (drawn as a plain line)`));
    const line = [...pts];
    // 線の端の形 (drawioEdges.ts の edgeMarker。mxConnector.createMarker: 始まりの端を先に決め、端の点を縮めた端に置き換える)。
    // 塗りは線の色 (startFillColor・endFillColor で変えられる)、破線にしない
    const markerCanvas = makeCanvas(e, shape);
    const painters: Array<() => void> = [];
    const thick = THICK_EDGES.has(shape) || Object.hasOwn(JS_EDGES, shape);
    for (const [end, k] of [
      ['start', 0],
      ['end', line.length - 1],
    ] as const) {
      const type = s[`${end}Arrow`];
      if (!type || !stroke || thick) continue;
      const tip = line[k];
      const from = line[end === 'end' ? k - 1 : 1];
      const len = Math.hypot(tip.x - from.x, tip.y - from.y);
      if (!len) continue;
      const size = num(s[`${end}Size`], 6);
      const pe = { ...tip };
      const fn = edgeMarker(markerCanvas, type, pe, (tip.x - from.x) / len, (tip.y - from.y) / len, size, end === 'start', sw, s[`${end}Fill`] !== '0', stroke, color(e, 'fillColor', '#ffffff'));
      if (!fn) {
        warn(msg(`線の端の形 "${type}" は描けない`, `edge end "${type}" cannot be drawn`));
        continue;
      }
      const fillCol = color(e, `${end}FillColor`, '#ffffff') ?? stroke;
      painters.push(() => {
        markerCanvas.setFillColor(fillCol);
        fn();
      });
      const r = 2 * (size + sw + 1);
      addBox({ x: tip.x - r, y: tip.y - r, w: 2 * r, h: 2 * r });
      line[k] = pe;
    }
    markerCanvas.setDashed(false);
    for (const p of painters) p();
    const parts = markerCanvas.out;
    for (const p of pts) addPt(p.x, p.y);
    const so = num(s.strokeOpacity, 100);
    if (stroke && !THICK_EDGES.has(shape) && !Object.hasOwn(JS_EDGES, shape)) {
      const dashOf = (w: number) => {
        const dash = flag(s, 'dashed') ? (s.dashPattern ?? '3 3').split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
        const k = flag(s, 'fixDash') ? 1 : w;
        return dash.length && dash.some((n) => n > 0) ? ` stroke-dasharray="${dash.map((n) => f(n * k)).join(' ')}"` : '';
      };
      const d = edgePath(line, s);
      const path = (col: string, w: number, dashed: boolean) => `<path d="${d}" fill="none" stroke="${esc(col)}" stroke-width="${f(w)}" stroke-miterlimit="10"${dashed ? dashOf(w) : ''}/>`;
      // 線を 2 回引く形 (draw.io の Shapes.js): pipe は太さ width (既定 4) + 線の太さの 2 倍を線の色で、中を width で塗りの色で (破線は中だけ)。
      // wire は線の色で引いてから、塗りの色の破線を重ねる。filledEdge は線の太さが 3 以上なら、太さ - 2 の塗りの色の線を重ねる
      const fillCol = color(e, 'fillColor', '#ffffff');
      const layers: string[] = [];
      if (shape === 'pipe') {
        const width = Math.max(0, num(s.width, 4));
        layers.push(path(stroke, width + 2 * sw, false));
        if (fillCol) layers.push(path(fillCol, width, true));
        for (const p of pts) addBox({ x: p.x - width / 2 - sw, y: p.y - width / 2 - sw, w: width + 2 * sw, h: width + 2 * sw });
      } else if (shape === 'wire') {
        layers.push(path(stroke, sw, false));
        if (fillCol) layers.push(path(fillCol, sw, true));
      } else {
        // 線の跳び越し (jumpStyle: arc・gap・sharp・line。先に描いた線との交わりで跳ぶ。曲線の線は跳ばない)
        const jump = s.jumpStyle && !flag(s, 'curved') ? lineJumps(pts, drawnLines, jumpBudget) : undefined;
        if (jumpBudget.limited) {
          jumpBudget.limited = false;
          warn(msg(`線の跳び越し (jumpStyle) の交わりが多すぎる線は、跳ばずに描く (1 本で ${MAX_LINE_JUMPS} 個まで、1 つの図で調べる線分の組 ${LIMITS.jumpPairs} まで)`, `lines with too many line-jump crossings (jumpStyle) are drawn without jumps (up to ${MAX_LINE_JUMPS} per line, and ${LIMITS.jumpPairs} segment pairs checked per diagram)`));
        }
        if (jump) {
          const jc = makeCanvas(e, shape);
          jc.setFillColor('none');
          jc.setStrokeColor(stroke);
          paintLineJumps(jc, jump, [line[0], line[line.length - 1]], flag(s, 'rounded'), num(s.arcSize, 20) / 2, num(s.jumpSize, 6), s.jumpStyle);
          layers.push(...jc.out);
        } else layers.push(path(stroke, sw, true));
        if (shape === 'filledEdge' && sw >= 3 && fillCol) layers.push(path(fillCol, sw - 2, true));
      }
      if (flag(s, 'shadow')) addShadowBox(e, pts);
      out.push(`<g${shadowAttr(e)}${opAttr}${so < 100 ? ` stroke-opacity="${f(Math.max(0, so) / 100)}" fill-opacity="${f(Math.max(0, so) / 100)}"` : ''}>${sketchEdge(e, layers.join('') + parts.join(''), pts)}</g>`);
    }
    if (s.noJump !== '1') drawnLines.push(pts);
    // 線のラベル (線そのものの値と、線を親に持つ図形 (geometry の relative=1))
    const g = e.geo;
    const lp = pointOnPath(pts, g?.relative ? (g?.x ?? 0) : 0, g?.relative ? (g?.y ?? 0) : 0);
    // 文字の影 (textShadow) は線のラベルの文字だけに付ける
    const edgeLabel: string[] = [];
    drawLabel(e, { x: lp.x + (g?.offset?.x ?? 0), y: lp.y + (g?.offset?.y ?? 0), w: 0, h: 0 }, { out: edgeLabel });
    if (edgeLabel.length) out.push(flag(s, 'textShadow') ? `<g${shadowAttr(e, true)}>${edgeLabel.join('')}</g>` : edgeLabel.join(''));
    for (const ch of e.children) {
      if (!ch.visible || !ch.vertex || !ch.geo?.relative) continue;
      const cp = pointOnPath(pts, ch.geo.x, ch.geo.y);
      const ox = cp.x + (ch.geo.offset?.x ?? 0);
      const oy = cp.y + (ch.geo.offset?.y ?? 0);
      absBox.set(ch, { x: ox - ch.geo.w / 2, y: oy - ch.geo.h / 2, w: ch.geo.w, h: ch.geo.h });
    }
  };

  // ───── 図形ライブラリの形 (ステンシル) ─────

  const inline = new Map<string, XEl | undefined>();
  const missing = new Set<string>();
  const missingImages = new Set<string>();
  const stencilCtx: StencilContext = {
    lookup: (name) => (name.startsWith('stencil(') ? inlineStencil(name) : opts.stencils?.get(name)),
    warn,
    budget: { ops: 0 } as { ops: number; chars?: number },
  };
  /** 埋め込んだ形を戻した大きさの合計 (LIMITS.inlineStencilTotal) */
  const inlineInflated = { bytes: 0 };
  /**
   * style に埋め込んだ形 stencil(<圧縮した XML>) (draw.io の mxStencilRegistry.getStencil の stencil( の扱い)。
   * 1 つの形は LIMITS.inlineStencil まで、図の全体で LIMITS.inlineStencilTotal まで戻す (超えたら、読めない形として文字だけ描く)
   */
  const inlineStencil = (shape: string): XEl | undefined => {
    if (!inline.has(shape)) {
      const left = LIMITS.inlineStencilTotal - inlineInflated.bytes;
      if (left <= 0) warn(msg(`埋め込んだ形 (stencil) が多すぎる (1 つの図で戻して ${LIMITS.inlineStencilTotal} バイトまで)`, `too many embedded shapes (stencil) (up to ${LIMITS.inlineStencilTotal} bytes inflated per diagram)`));
      inline.set(shape, shape.endsWith(')') && left > 0 ? decodeInlineStencil(shape.slice(8, -1), Math.min(LIMITS.inlineStencil, left), inlineInflated) : undefined);
    }
    return inline.get(shape);
  };
  /** 図形ライブラリの形と、埋め込んだ形。描けなければ警告して undefined (文字だけ描く) */
  const stencilShape = (c: Cell, shape: string, b: Box): string | undefined => {
    const st = stencilCtx.lookup(shape);
    if (!st) {
      if (shape.startsWith('stencil(')) warn(msg('埋め込んだ形 (stencil) が読めない (文字だけ描く)', 'embedded shape (stencil) cannot be read (only its text is drawn)'));
      else {
        const lib = libraryOf(shape) ?? shape;
        if (isNewerShape(shape))
          warn(msg(`形 "${shape.slice(0, 120)}" は描かない (draw.io の v24.7.5 より後に足された形。Kumiori は v24.7.5 の形を描く。文字だけ描く)`, `shape "${shape.slice(0, 120)}" is not drawn (it was added to draw.io after v24.7.5, and Kumiori draws the shapes of v24.7.5; only its text is drawn)`));
        else if (opts.stencils?.hasLibrary(lib)) warn(msg(`形 "${shape.slice(0, 120)}" は図形ライブラリ ${lib} に無い (JavaScript で書かれた形など。文字だけ描く)`, `shape "${shape.slice(0, 120)}" is not in the shape library ${lib} (such as a shape written in JavaScript; only its text is drawn)`));
        else {
          missing.add(lib);
          warn(msg(`形 "${shape.slice(0, 120)}" は描けない (図形ライブラリ ${lib} が無い。文字だけ描く)`, `shape "${shape.slice(0, 120)}" cannot be drawn (the shape library ${lib} is missing; only its text is drawn)`));
        }
      }
      return undefined;
    }
    const s = c.style;
    return stencilSvg(
      st,
      b,
      {
        // lineShape=1 (線として描く形): 塗りを線の色にする (draw.io の Editor.js の mxStencil.prototype.drawShape の上書き)
        fill: s.lineShape === '1' ? color(c, 'strokeColor', '#000000') : fillPaint(c),
        stroke: color(c, 'strokeColor', '#000000'),
        strokeWidth: num(s.strokeWidth, 1),
        dashed: flag(s, 'dashed'),
        dashPattern: s.dashPattern ?? '3 3',
        fixDash: flag(s, 'fixDash'),
        fillOpacity: Math.max(0, Math.min(100, num(s.fillOpacity, 100))) / 100,
        strokeOpacity: Math.max(0, Math.min(100, num(s.strokeOpacity, 100))) / 100,
        style: s,
      },
      stencilCtx,
    );
  };

  /** JavaScript で書かれた形 (drawioShapes.ts) を、道具 (drawioCanvas.ts) で描く。中で使う図形ライブラリの形が無ければ警告し、ライブラリを求める */
  /** セルの塗り・線の状態で、形を描く道具を作る (shape: 警告に出す形の名前) */
  const makeCanvas = (c: Cell, shape: string): ShapeCanvas => {
    const s = c.style;
    return new ShapeCanvas(
      {
        fill: fillPaint(c),
        stroke: color(c, 'strokeColor', '#000000'),
        strokeWidth: num(s.strokeWidth, 1),
        dashed: flag(s, 'dashed'),
        dashPattern: s.dashPattern ?? '3 3',
        fixDash: flag(s, 'fixDash'),
        fillAlpha: Math.max(0, Math.min(100, num(s.fillOpacity, 100))) / 100,
        strokeAlpha: Math.max(0, Math.min(100, num(s.strokeOpacity, 100))) / 100,
      },
      {
        stencil: (name) => {
          // 名前の無いアイコン (prIcon などを書いていない包みの形。名前が . で終わる) は、draw.io と同じく黙って描かない
          if (!name || name.endsWith('.')) return undefined;
          const st = stencilCtx.lookup(name);
          if (!st) {
            const lib = libraryOf(name);
            if (lib && !opts.stencils?.hasLibrary(lib)) {
              missing.add(lib);
              warn(msg(`形 "${shape}" の中の "${name.slice(0, 120)}" は描けない (図形ライブラリ ${lib} が無い)`, `"${name.slice(0, 120)}" in shape "${shape}" cannot be drawn (the shape library ${lib} is missing)`));
            } else warn(msg(`形 "${shape}" の中の "${name.slice(0, 120)}" は描けない (図形ライブラリに無い形)`, `"${name.slice(0, 120)}" in shape "${shape}" cannot be drawn (not in the shape libraries)`));
          }
          return st;
        },
        gradient: makeGradient,
        stencilCtx,
        style: s,
        // draw.io の配布物の画像 (mxSvgCanvas2D.image の src。GRAPH_IMAGE_PATH (img) からの道)。渡されたか取ったものだけを描く
        image: (path, b, aspect) => externalImage(path, b, aspect, { ja: `形 "${shape}" の画像`, en: `image in shape "${shape}"` }),
      },
    );
  };
  /** 形を描く口 (セルのスタイルを読む。canvas: 塗りと線の初めの色) */
  const makeEnv = (c: Cell, canvas: ShapeCanvas): ShapeEnv => {
    const s = c.style;
    return {
      str: (k, d) => (Object.hasOwn(s, k) ? s[k] : d),
      num: (k, d) => num(s[k], d),
      color: (k, d) => (Object.hasOwn(s, k) ? color(c, k, k === 'fillColor' || /^bg|Fill/i.test(k) ? '#ffffff' : '#000000') : d),
      flag: (k, d = false) => flag(s, k, d),
      fill: canvas.fillColor,
      stroke: canvas.strokeColor,
      strokeWidth: num(s.strokeWidth, 1),
      rounded: flag(s, 'rounded'),
      direction: s.direction ?? 'east',
      value: flag(s, 'html') ? labelLines(labelText(c), true, baseRun(c)).map((l) => l.map((r) => r.text).join('')).join('\n') : labelText(c),
      fontSize: num(s.fontSize, 12),
      fontFamily: (s.fontFamily ?? 'Helvetica').split(',')[0].trim(),
      fontColor: color(c, 'fontColor', '#000000') ?? '#000000',
    };
  };
  const jsShape = (c: Cell, shape: string, b: Box, painter: ShapePainter): string => {
    const canvas = makeCanvas(c, shape);
    canvas.translate(b.x, b.y);
    painter(canvas, b.w, b.h, makeEnv(c, canvas));
    return canvas.out.join('');
  };

  // ───── 図形 ─────

  const drawVertex = (c: Cell, out: string[]) => {
    const b = boxOf(c);
    if (!b) return;
    const s = c.style;
    const shape = s.shape ?? 'label';
    const rot = num(s.rotation, 0) % 360;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const parts: string[] = [];
    // 向き (direction): 東 (既定) を基に、north は左へ、south は右へ 90 度、west は 180 度回す (縦横の入れ替わる向きは、枠の縦横を入れ替えて描く)
    const dir = s.direction ?? 'east';
    const turn = dir === 'south' ? 90 : dir === 'north' ? -90 : dir === 'west' ? 180 : 0;
    const swap = turn === 90 || turn === -90;
    const sb = swap ? { x: cx - b.h / 2, y: cy - b.w / 2, w: b.h, h: b.w } : b;
    // 図形ライブラリの形 (mxgraph.*) と埋め込んだ形 (stencil(…)) は drawioStencil.ts で描く (描けないときの警告は stencilShape が出す)
    const library = shape.startsWith('mxgraph.') || shape.startsWith('stencil(');
    const painter = Object.hasOwn(JS_SHAPES, shape) ? JS_SHAPES[shape] : undefined;
    const drawn = painter ? jsShape(c, shape, sb, painter) : library ? stencilShape(c, shape, sb) : shapeSvg(c, shape, sb);
    // 手書き風 (sketch・comic): 形の線と塗りを rough.js の線と塗りにする (drawioSketch.ts。文字・画像は変えない)
    const sketch = sketchKind(s);
    const svg = drawn && sketch ? sketchSvg(drawn, { id: c.id, style: s, size: sb.w + sb.h, budget: stencilCtx.budget }) : drawn;
    if (svg === undefined && !library) warn(msg(`形 "${shape}" は描けない (文字だけ描く)`, `shape "${shape}" cannot be drawn (only its text is drawn)`));
    else if (svg) {
      const tr: string[] = [];
      if (turn) tr.push(`rotate(${turn} ${f(cx)} ${f(cy)})`);
      const fh = flag(s, 'flipH');
      const fv = flag(s, 'flipV');
      if (fh || fv) tr.push(`translate(${f(fh ? 2 * cx : 0)} ${f(fv ? 2 * cy : 0)}) scale(${fh ? -1 : 1} ${fv ? -1 : 1})`);
      parts.push(tr.length ? `<g transform="${tr.join(' ')}">${svg}</g>` : svg);
    }
    // label の形に画像 (style の image) があれば、左に置く (draw.io の label: imageWidth・imageHeight、imageAlign (既定 left)、spacing の内側)
    if (shape === 'label' && s.image) {
      const iw = num(s.imageWidth, 42);
      const ih = num(s.imageHeight, 42);
      const ia = s.imageAlign ?? 'left';
      const sp = num(s.spacing, 2);
      const ix = ia === 'center' ? cx - iw / 2 : ia === 'right' ? b.x + b.w - iw - sp : b.x + sp;
      const iy = (s.imageVerticalAlign ?? 'middle') === 'top' ? b.y + sp : s.imageVerticalAlign === 'bottom' ? b.y + b.h - ih - sp : cy - ih / 2;
      const img = imageSvg(c, { x: ix, y: iy, w: iw, h: ih });
      if (img) parts.push(img);
    }
    // 手書き風の線は形の枠から少しはみ出す (rough.js のゆれ。draw.io は描いた形の枠を足す)
    addBox(b, rot, cx, cy, (color(c, 'strokeColor', '#000000') ? num(s.strokeWidth, 1) / 2 : 0) + (sketch ? SKETCH_MARGIN : 0));
    // 文字 (図形の回転は drawLabel が文字に付ける)
    const labels: string[] = [];
    const lb = labelBox(c, b, shape);
    drawLabel(c, lb, { wrapW: lb.w, out: labels, ...(rot ? { rot, cx, cy } : {}) });
    if (!parts.length && !labels.length) return;
    const op = num(s.opacity, 100);
    let shapes = rot && parts.length ? `<g transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})">${parts.join('')}</g>` : parts.join('');
    // 形の影 (shadow) は図形だけに、文字の影 (textShadow) は文字だけに付ける (mxShape・mxText の updateSvgFilters)。ずらす向きはページの向き (回した図形の外で付ける)
    const corners = [0, 1, 2, 3].map((k) => rotPt({ x: k % 3 ? b.x + b.w : b.x, y: k < 2 ? b.y : b.y + b.h }, rot, cx, cy));
    if (parts.length && flag(s, 'shadow')) {
      shapes = `<g${shadowAttr(c)}>${shapes}</g>`;
      addShadowBox(c, corners);
    }
    let text = labels.join('');
    if (text && flag(s, 'textShadow')) {
      text = `<g${shadowAttr(c, true)}>${text}</g>`;
      addShadowBox(c, corners);
    }
    out.push(op < 100 ? `<g opacity="${f(Math.max(0, op) / 100)}">${shapes}${text}</g>` : shapes + text);
  };

  // 木の順に描く (親の後に子。mxGraph の描く順)。線のラベルの図形は、線を描いた後に置く。
  // SVG の長さの上限 (LIMITS.svgChars) の残りを超えるセルと、図を大きさの上限 (LIMITS.size) より大きくするセルは、そのセルだけを描かない
  // (セルの中の形・道具は、残りを使い切ったら、そこでやめる)。書いた字の合計の上限 (LIMITS.svgWork) を使い切ったら、その後のセルは描かない
  let svgLeft = LIMITS.svgChars;
  // 書いて捨てた分も含めた、書く字の数の残り (LIMITS.svgWork)
  let workLeft = LIMITS.svgWork;
  let svgFull = false;
  const visit = (c: Cell, depth: number) => {
    if (!c.visible || depth > 256 || svgFull) return;
    if (c.edge || c.vertex) {
      const n0 = body.length;
      const bb0 = { ...bb };
      const lines0 = drawnLines.length;
      const given = Math.min(svgLeft, workLeft);
      stencilCtx.budget.chars = given;
      let over = false;
      try {
        if (c.edge) drawEdge(c, body);
        else drawVertex(c, body);
      } catch (e) {
        if (!(e instanceof SvgBudgetExceeded)) throw e;
        over = true;
      }
      // 形・道具が数えた字 (投げたときは、渡した残りを使い切っている) と、セルの SVG の字の、多い方を書いた字とする
      const counted = given - (stencilCtx.budget.chars ?? given);
      stencilCtx.budget.chars = undefined;
      let n = 0;
      for (let k = n0; k < body.length; k++) n += body[k].length;
      workLeft -= Math.max(n, counted);
      const tooLarge = () => bb.x1 - bb.x0 > LIMITS.size - 8 || bb.y1 - bb.y0 > LIMITS.size - 8;
      // 描かないセルは、線の跳び越しの相手 (drawnLines) に入れない。keepBox なら、外接の枠には入れたままにする (図の中の空白として場所を取る)
      const undo = (keepBox: boolean) => {
        body.length = n0;
        drawnLines.length = lines0;
        if (!keepBox) Object.assign(bb, bb0);
      };
      if (over || n > given) {
        // SVG の長さの上限 (の残り) を 1 つで超えるセルは描かない。後ろのセルは描く (書いた字の合計の上限 LIMITS.svgWork を使い切ったら、後ろも描かない)。
        // 場所は空けておく (図の大きさの上限を超えなければ)。全部のセルが超えても、図は空の画像として描け、警告が残る
        undo(!tooLarge());
        if (workLeft <= 0) {
          svgFull = true;
          warn(msg(`図が大きすぎるので、途中までを描く (SVG にして ${LIMITS.svgChars} 字まで)`, `the diagram is too large; only part of it is drawn (up to ${LIMITS.svgChars} characters of SVG)`));
          return;
        }
        warn(msg(`SVG が大きすぎるセルを描かない (図を SVG にして ${LIMITS.svgChars} 字まで)`, `cells whose SVG is too large are not drawn (up to ${LIMITS.svgChars} characters of SVG per diagram)`));
      } else if (tooLarge()) {
        // 描いたら図が大きさの上限を超えるセル (線の太さ・字の大きさなどの値が大きすぎるか、ほかのセルから遠く離れたセル) は描かない
        undo(false);
        warn(msg(`図を大きさの上限より大きくするセルを描かない (図の幅・高さは ${LIMITS.size} px まで)`, `cells that would make the diagram larger than the size limit are not drawn (width and height up to ${LIMITS.size} px)`));
      } else svgLeft -= n;
    }
    if (c.collapsed && c.vertex) return;
    for (const ch of c.children) visit(ch, depth + 1);
  };
  for (const t of tops) visit(t, 0);

  if (!(bb.x1 > bb.x0) || !(bb.y1 > bb.y0)) return undefined;
  // 大きさは整数の px に切り上げる (draw.io の書き出しと同じく、図の左上を原点に)
  const x0 = Math.round(bb.x0 * 100) / 100;
  const y0 = Math.round(bb.y0 * 100) / 100;
  // 図の全体の影 (mxGraphModel の shadow="1"。draw.io の Graph.addSvgShadow・updateShadowFilter: 図の全体を
  // drop-shadow(3px 3px 1.7px #3D4574 の 0.4) で包み、大きさを ceil(svgShadowSize 3 × svgShadowBlur 1.7) = 6 だけ広げる)
  const pageShadow = model.attrs.get('shadow') === '1';
  const grow = pageShadow ? Math.ceil(3 * 1.7) : 0;
  const W = Math.ceil(bb.x1 - x0 - 1e-6) + grow;
  const H = Math.ceil(bb.y1 - y0 - 1e-6) + grow;
  const pageFilter = pageShadow ? filterOf({ dx: 3, dy: 3, blur: 1.7, color: '#3D4574', opacity: 0.4 }) : '';
  // 背景 (mxGraphModel の background。none・無しは透明)
  const bgRaw = model.attrs.get('background');
  const bgCell: Cell = { id: '', children: [], value: '', style: bgRaw ? { c: bgRaw } : {}, vertex: false, edge: false, visible: true, collapsed: false };
  const bg = color(bgCell, 'c', '#ffffff');
  for (const { id, st } of shadowFilters.values())
    defs.push(
      `<filter id="${id}" filterUnits="userSpaceOnUse" x="${f(x0 - 10)}" y="${f(y0 - 10)}" width="${W + 20}" height="${H + 20}"><feDropShadow dx="${f(st.dx)}" dy="${f(st.dy)}" stdDeviation="${f(st.blur)}" flood-color="${esc(st.color)}" flood-opacity="${f(st.opacity)}"/></filter>`,
    );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    (bg ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${esc(bg)}"/>` : '') +
    `<g transform="translate(${-x0} ${-y0})"${pageFilter}>${body.join('')}</g></svg>`;
  return { svg, width: W, height: H, warnings: [...warnings], missingLibraries: [...missing], missingImages: [...missingImages] };
}
