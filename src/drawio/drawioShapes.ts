/**
 * drawioShapes — draw.io の JavaScript で書かれた形を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の各形の paintVertexShape (ファイルの名前は、形ごとのコメントに書く)。
 * 形の中に図形ライブラリの形 (アイコン) を描くものは、そのライブラリが要る (無ければ、呼ぶ側が警告して、ライブラリを求める)
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/grapheditor/Shapes.js: Copyright (c) 2006-2015, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxRectangleShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxAWS4.js: Copyright (c) 2006-2018, JGraph Ltd
 *   shapes/mxCisco19.js: Copyright (c) 2006-2020, JGraph Ltd
 *   shapes/mxCiscoSafe.js: Copyright (c) 2006-2020, JGraph Ltd
 *   shapes/mxGCP2.js: Copyright (c) 2006-2018, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from './drawioCanvas';
import { SHAPES_A } from './drawioShapesA';
import { SHAPES_B } from './drawioShapesB';
import { SHAPES_ARCHIMATE } from './drawioJs/archimate';
import { EDGES_ARROWS, SHAPES_ARROWS } from './drawioJs/arrows';
import { EDGES_MISC } from './drawioJs/edges';
import { SHAPES_AWS3D } from './drawioJs/aws3d';
import { SHAPES_BASIC } from './drawioJs/basic';
import { SHAPES_BPMN } from './drawioJs/bpmn';
import { SHAPES_ELECTRICAL } from './drawioJs/electrical';
import { SHAPES_MISC } from './drawioJs/misc';
import { SHAPES_MOCKUP } from './drawioJs/mockup';
import { SHAPES_MOCKUP_IOS } from './drawioJs/mockupIos';
import { SHAPES_UI } from './drawioJs/ui';

/** 形を描くときに、セルのスタイルを読む口 */
export interface ShapeEnv {
  /** スタイルの値 (無ければ fallback。draw.io の mxUtils.getValue と同じく、none と書いたキーは無いものとして読む) */
  str: (key: string, fallback: string) => string;
  num: (key: string, fallback: number) => number;
  /** 色 (default・inherit・light-dark を解いた値。無ければ fallback。none は undefined) */
  color: (key: string, fallback: string | undefined) => string | undefined;
  /** 真偽の値 (1・true) */
  flag: (key: string, fallback?: boolean) => boolean;
  /** 形の塗りと線の色 (mxShape の fill・stroke。グラデーションは url(#…))・線の太さ (strokewidth)・角を丸めるか (isRounded) */
  fill: string | undefined;
  stroke: string | undefined;
  strokeWidth: number;
  rounded: boolean;
  /** 形の向き (direction。east・north・south・west。回すのは呼ぶ側で、w・h は回した後の幅と高さ) */
  direction: string;
  /** セルの文字 (値。HTML のラベルなら、タグを除いた文字。形の中に値を描く形 (モックアップなど) が使う) */
  value: string;
  /** 文字の大きさ・書体・色 (fontSize・fontFamily・fontColor。形の中に文字を描くときの既定) */
  fontSize: number;
  fontFamily: string;
  fontColor: string;
}

export type ShapePainter = (c: ShapeCanvas, w: number, h: number, e: ShapeEnv) => void;

// ───────────── AWS (draw.io の shapes/mxAWS4.js) ─────────────

/** 枠の全体の四角 */
const box = (c: ShapeCanvas, w: number, h: number) => {
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.close();
};

const awsProductIcon: ShapePainter = (c, w, h, e) => {
  // 外の四角を線の色で塗り、内側 (1 px 内) の正方形を塗りの色 (グラデーション) で塗る。アイコン (prIcon) は線の色で上寄せに
  const ind = 1;
  const strokeColor = e.color('strokeColor', undefined);
  c.setFillColor(strokeColor);
  box(c, w, h);
  c.fill();
  const fill = e.color('fillColor', '#ffffff');
  c.setGradient(fill, e.color('gradientColor', fill), e.str('gradientDirection', 'south'));
  c.begin();
  c.moveTo(ind, ind);
  c.lineTo(w - ind, ind);
  c.lineTo(w - ind, w - ind);
  c.lineTo(ind, w - ind);
  c.close();
  c.fill();
  c.setFillColor(strokeColor);
  c.setStrokeColor('none');
  c.stencil(e.str('prIcon', ''), ind + w * 0.15, ind + w * 0.15, w * 0.7 - 2 * ind, w * 0.7 - 2 * ind);
};

const awsResourceIcon: ShapePainter = (c, w, h, e) => {
  // 塗りの色の四角に、アイコン (resIcon) を線の色で 8 割の大きさに
  box(c, w, h);
  c.fill();
  c.setFillColor(e.color('strokeColor', '#000000'));
  c.setStrokeColor('none');
  c.stencil(e.str('resIcon', ''), w * 0.1, h * 0.1, w * 0.8, h * 0.8);
};

/** グループの枠 (grStroke=0 なら線を引かない) と、左上 (center なら上の真ん中) のアイコン (grIcon。大きさ grIconSize、既定 25) */
const awsGroup =
  (center: boolean): ShapePainter =>
  (c, w, h, e) => {
    box(c, w, h);
    if (e.str('grStroke', '1') === '1') c.fillAndStroke();
    else c.fill();
    const size = e.num('grIconSize', 25);
    c.setFillAlpha(e.num('strokeOpacity', 100) / 100);
    c.setFillColor(e.color('strokeColor', '#000000'));
    c.setStrokeColor('none');
    c.stencil(e.str('grIcon', ''), center ? (w - size) * 0.5 : 0, 0, size, size);
  };

const awsGroup2: ShapePainter = (c, w, h, e) => {
  // 枠と、左上の 25 px の四角 (線の色) の中の白いアイコン
  box(c, w, h);
  c.fillAndStroke();
  c.setFillColor(e.color('strokeColor', '#000000'));
  c.begin();
  c.moveTo(0, 0);
  c.lineTo(25, 0);
  c.lineTo(25, 25);
  c.lineTo(0, 25);
  c.close();
  c.fill();
  const size = e.num('grIconSize', 25);
  c.setFillAlpha(e.num('strokeOpacity', 100) / 100);
  c.setFillColor('#ffffff');
  c.setStrokeColor('none');
  c.stencil(e.str('grIcon', ''), size * 0.1, size * 0.1, size * 0.8, size * 0.8);
};

// ───────────── Google Cloud (draw.io の shapes/mxGCP2.js) ─────────────

const gcpDoubleRect: ShapePainter = (c, w0, h0) => {
  // 右下へ 8 px ずらした角の丸い四角を 2 つ重ねる
  const w = w0 - 8;
  const h = h0 - 8;
  c.begin();
  c.roundrect(8, 8, w, h, 1, 1);
  c.fillAndStroke();
  c.roundrect(0, 0, w, h, 1, 1);
  c.fillAndStroke();
};

const gcpHexIcon: ShapePainter = (c, w, h, e) => {
  // 種類 (prType) ごとの背景の形を重ねてから、アイコン (mxgraph.gcp2.<prIcon>) を塗りの色で描く。不透明度はセルの全体に掛かるので、ここでは割合だけ
  const prIcon = e.str('prIcon', 'compute_engine');
  const fill = e.color('fillColor', '#ffffff');
  const strokeWidth = e.num('strokeWidth', 1);
  const iconSize = Math.min(w, h);
  const st = (name: string, x: number, y: number, ww: number, hh: number) => c.stencil(`mxgraph.gcp2.${name}`, x, y, ww, hh);
  switch (e.str('prType', '')) {
    case 'dynamic':
      c.setAlpha(0.5);
      c.setStrokeColor('none');
      st('outline_blank_2', w * 0.21, h * 0.12, w * 0.58, h * 0.76);
      break;
    case 'multiple':
      c.setAlpha(0.5);
      c.setStrokeColor('none');
      st('outline_blank_2', w * 0.21, h * 0.12, w * 0.58, h * 0.76);
      c.setAlpha(0.7);
      st('outline_blank_3', w * 0.17, h * 0.13, w * 0.66, h * 0.74);
      break;
    case 'shared':
    case 'replica':
      c.setStrokeWidth(iconSize * 0.038);
      c.setAlpha(0.4);
      c.setStrokeColor(fill);
      c.setFillColor('none');
      st('outline_blank_1', w * 0.02, 0, w * 0.96, h);
      c.setAlpha(0.7);
      if (e.str('prType', '') === 'shared') st('outline_blank_2', w * 0.14, h * 0.01, w * 0.72, h * 0.98);
      else st('outline_blank_1', w * 0.075, h * 0.06, w * 0.85, h * 0.88);
      c.setAlpha(1);
      c.setFillColor('#ffffff');
      st('outline_blank_1', w * 0.13, h * 0.12, w * 0.74, h * 0.76);
      c.setStrokeWidth(strokeWidth);
      break;
    case 'dynamic2':
    case 'dynamic3':
      if (e.str('prType', '') === 'dynamic2') c.setAlpha(0.5);
      c.setStrokeColor('none');
      st('outline_blank_2', w * 0.14, h * 0.01, w * 0.72, h * 0.98);
      c.setStrokeWidth(iconSize * 0.01);
      c.setStrokeColor(fill);
      c.setAlpha(1);
      c.setFillColor('#ffffff');
      st('outline_blank_1', w * 0.13, h * 0.12, w * 0.74, h * 0.76);
      c.setStrokeWidth(strokeWidth);
      break;
    case 'highmem':
      c.setAlpha(0.5);
      c.setStrokeColor('none');
      st('outline_highmem', 0, h * 0.56, w, h * 0.28);
      break;
    case 'highcomp':
      c.setAlpha(0.5);
      c.setStrokeColor('none');
      st('outline_highcomp', 0, h * 0.16, w, h * 0.28);
      break;
    case 'backend':
      c.setFillColor('#FCC64D');
      st('outline_blank_1', w * 0.12, h * 0.11, w * 0.76, h * 0.78);
      break;
    case 'input':
      c.setFillColor('#A5DA40');
      st('outline_blank_1', w * 0.12, h * 0.11, w * 0.76, h * 0.78);
      break;
    default:
      break;
  }
  c.setAlpha(1);
  c.setFillColor(fill);
  c.setStrokeColor('none');
  st(prIcon, w * 0.17, h * 0.16, w * 0.66, h * 0.68);
  // インスタンスの数 (instNum): 左上の白い丸の中の数字
  const inst = Math.trunc(e.num('instNum', 0));
  if (inst > 0) {
    c.setFillColor('#ffffff');
    c.setStrokeColor('#ffffff');
    c.setStrokeWidth(iconSize * 0.038);
    c.begin();
    c.ellipse(w * 0.2, 0, w * 0.18, h * 0.22);
    c.fillAndStroke();
    c.setAlpha(0.5);
    c.setStrokeColor(fill);
    c.ellipse(w * 0.2, 0, w * 0.18, h * 0.22);
    c.stroke();
    c.setAlpha(1);
    c.setFontColor('#4E6B89');
    c.setFontStyle(1);
    c.setFontSize(Math.min(w, h) * 0.1);
    c.text(w * 0.29, h * 0.11 + 1, 0, 0, String(inst), 'center', 'middle');
  }
};

// ───────────── Cisco (draw.io の shapes/mxCisco19.js) ─────────────

/** アイコンの名前ごとの背景の形 (bg2〜bg10・円・ACI。表に無い名前は bg1) */
const CISCO19_BG: Array<[string, string[]]> = [
  ['bg2', ['l2_modular', 'l3_modular', '6500_vss', 'nexus_9500', 'nexus_7k']],
  ['bg3', ['l2_switch_with_dual_supervisor', 'l3_switch_with_dual_supervisor']],
  ['bg4', ['l2_modular2']],
  ['bg5', ['l3_modular2', '6500_vss2', 'hypervisor', 'collab1']],
  ['circle', ['router', 'csr_1000v', 'wireless_router', 'l3_modular3', 'ucs_express', 'router_with_voice', 'router_with_firewall', 'netflow_router', 'secure_router', 'ip_telephone_router', 'asr_9000', 'clock', 'vbond', 'vmanage', 'vsmart']],
  [
    'bg6',
    [
      'content_router', 'router_with_firewall2', 'netflow_router2', 'nam_virtual_service_blade', 'ucs_5108_blade_chassis', 'storage', 'nexus_1kv_vsm', 'nexus_1k', 'nexus_1010', 'dual mode access point', 'wireless_lan_controller', 'primary_codec', 'virtual_desktop_service', 'video_gateway',
      'video_analytics', 'telepresence_exchange', 'meeting_scheduling_and_management_server', 'content_recording_streaming_server', 'communications_manager', 'cisco_unified_presence_service', 'cisco_unified_contact_center_enterprise_and_hosted', 'h323', 'monitor',
      'telepresence_endpoint_twin_data_display', 'operations_manager', 'transcoder', 'contact_center_express', 'ip_ip_gateway', 'shield', 'set_top', 'da_encoder', 'ad_encoder', 'da_decoder', 'ad_decoder', 'acs', 'email_security', 'vpn_concentrator', 'ssl_terminator',
      'cisco_security_manager', 'web_security', 'nac_appliance', 'ironport', 'ips_ids', 'firewall', 'asa_5500', 'flow_collector', 'load_balancer', 'web_application_firewall', 'analysis_correlation', 'flow_analytics', 'virtual_private_network2', 'web_security_services',
      'web_security_services2', 'virtual_private_network_connector',
    ],
  ],
  ['bg7', ['asr_1000']],
  ['bg8', ['fibre_channel_director_mds_9000', 'fibre_channel_fabric_switch']],
  ['bg9', ['ucs_c_series_server']],
  ['aci', ['aci']],
  ['bg10', ['immersive_telepresence_endpoint']],
];

const ciscoRect: ShapePainter = (c, w, h, e) => {
  const prIcon = e.str('prIcon', 'l2_switch');
  const bg = CISCO19_BG.find(([, list]) => list.includes(prIcon))?.[0] ?? 'bg1';
  if (bg === 'circle') {
    c.begin();
    if (prIcon === 'wireless_router') c.ellipse(0, h * 0.17, w, h * 0.83);
    else c.ellipse(0, 0, w, h);
    c.fill();
  } else if (bg === 'aci') c.stencil('mxgraph.cisco19.acibg', w * 0.195, h * 0.195, w * 0.61, h * 0.61);
  else c.stencil(`mxgraph.cisco19.${bg}`, 0, 0, w, h);
  c.setFillColor(e.color('strokeColor', '#000000'));
  c.stencil(`mxgraph.cisco19.${prIcon}`, 0, 0, w, h);
};

// ───────────── Cisco SAFE (draw.io の shapes/mxCiscoSafe.js) ─────────────

const ciscoSafeCompositeIcon: ShapePainter = (c, w, h, e) => {
  // 背景 (bgIcon: 楕円・threat1〜5・汎用の機器の形・図形ライブラリの形) を線の色で塗り、アイコン (resIcon) を塗りの色で重ねる
  const stroke = e.color('strokeColor', undefined);
  const bgColor = e.color('bgColor', '#C2E0AE');
  const fill = e.color('fillColor', undefined);
  const bgIcon = e.str('bgIcon', '');
  const resIcon = e.str('resIcon', '');
  const appliance = bgIcon === 'mxgraph.cisco_safe.architecture.generic_appliance';
  if (!appliance) c.stencil(resIcon, 0, 0, w, h);
  c.setFillColor(stroke);
  c.setStrokeColor('none');
  const oval = (x: number, y: number, ww: number, hh: number) => {
    c.begin();
    c.ellipse(x, y, ww, hh);
    c.fill();
  };
  if (bgIcon === 'ellipse') w < 100 ? oval(w * 0.01, h * 0.01, w * 0.98, h * 0.98) : oval(1, 1, w - 2, h - 2);
  else if (bgIcon === 'threat1') oval(w * 0.18, h * 0.16, w * 0.66, h * 0.65);
  else if (bgIcon === 'threat2') oval(w * 0.01, h * 0.01, w * 0.98, h * 0.6);
  else if (bgIcon === 'threat3') oval(w * 0.18, h * 0.2, w * 0.64, h * 0.79);
  else if (bgIcon === 'threat4') oval(w * 0.09, h * 0.03, w * 0.82, h * 0.77);
  else if (bgIcon === 'threat5') oval(w * 0.16, h * 0.01, w * 0.67, h * 0.72);
  else if (appliance) {
    c.setFillColor(bgColor);
    c.begin();
    c.moveTo(0, h * 0.3);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, w * 0.3, 0);
    c.lineTo(w * 0.7, 0);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, w, h * 0.3);
    c.lineTo(w, h * 0.7);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, w * 0.7, h);
    c.lineTo(w * 0.3, h);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, 0, h * 0.7);
    c.close();
    c.fill();
    c.setFillColor(stroke);
    c.stencil(bgIcon, w * 0.26, h * 0.26, w * 0.48, h * 0.48);
    c.setAlpha(0.5);
    c.setFillColor('#ffffff');
    for (const [x, y] of [
      [0.105, 0.48],
      [0.855, 0.48],
      [0.48, 0.105],
      [0.48, 0.855],
      [0.17, 0.17],
      [0.79, 0.17],
      [0.79, 0.79],
      [0.17, 0.79],
    ])
      oval(w * x, h * y, w * 0.04, h * 0.04);
    c.setAlpha(1);
  } else if (bgIcon) w < 100 ? c.stencil(bgIcon, w * 0.01, h * 0.01, w * 0.98, h * 0.98) : c.stencil(bgIcon, 1, 1, w - 2, h - 2);
  c.setFillColor(fill);
  if (appliance) c.stencil(resIcon, w * 0.25, h * 0.25, w * 0.5, h * 0.5);
  else c.stencil(resIcon, 0, 0, w, h);
};

// ───────────── 標準の形 (draw.io の Shapes.js) ─────────────

/**
 * draw.io の Shapes.js の ZigzagShape: 塗りがあれば四角を塗り (線は引かない)、真ん中から始まって上下の端 (線の太さだけ内側) を行き来する
 * ジグザグの線 (山の幅は size (既定 10、5 以上) に近い数で割り切る)。rounded なら 3 次の曲線でなめらかに
 */
const zigzag: ShapePainter = (c, w, h, e) => {
  const fill = e.color('fillColor', undefined);
  if (fill) {
    c.setStrokeColor('none');
    c.begin();
    c.rect(0, 0, w, h);
    c.fillAndStroke();
    c.setStrokeColor(e.stroke);
  }
  const size = Math.max(5, e.num('size', 10));
  const cy = h / 2;
  const sw = e.strokeWidth;
  const inset = e.rounded ? sw / 2 : sw;
  const top = inset;
  const bottom = h - inset;
  const n = Math.min(Math.max(1, Math.round(w / size) - 1), 10000);
  const half = w / (n + 1);
  const halfEnd = half / 2;
  c.begin();
  c.moveTo(0, cy);
  if (e.rounded) {
    const k = 0.4;
    c.curveTo(k * halfEnd, cy - (cy - top) * k, (1 - k) * halfEnd, top, halfEnd, top);
    for (let j = 0; j < n; j++) {
      const sx = halfEnd + j * half;
      const ex = sx + half;
      const sy = j % 2 === 0 ? top : bottom;
      const ey = j % 2 === 0 ? bottom : top;
      c.curveTo(sx + k * half, sy, ex - k * half, ey, ex, ey);
    }
    const lastX = halfEnd + n * half;
    const lastY = n % 2 === 0 ? top : bottom;
    const dir = lastY === top ? 1 : -1;
    c.curveTo(lastX + k * halfEnd, lastY, w - k * halfEnd, cy - dir * (cy - top) * k, w, cy);
  } else {
    c.lineTo(halfEnd, top);
    for (let j = 0; j < n; j++) c.lineTo(halfEnd + (j + 1) * half, j % 2 === 0 ? bottom : top);
    c.lineTo(w, cy);
  }
  c.stroke();
};

/** 曲げた文字の経路の id の通し番号 (1 つの SVG の中で重ならないように) */
let curvedTextIds = 0;

/**
 * 曲げた文字 (draw.io の Shapes.js の CurvedTextShape): 四角 (mxRectangleShape。ふつうは塗りも線も無し) と、セルの文字を、
 * 始まり (arcStartY。既定 25)・真ん中のずれ (arcMidY。既定 -25)・終わり (arcEndY。既定 25) の高さを通る円弧 (curveType=round。既定)
 * か 2 次の曲線に沿って、textPath で書く。字の間は、経路の長さにそろえる (textLength・lengthAdjust=spacing)。
 * 縦の位置は verticalAlign (曲線の上下の端と、字の大きさの半分の余白)。字の中心を経路に合わせる (dominant-baseline: central) 代わりに、
 * 経路を字の大きさの 0.35 倍だけ下げる (Kumiori の文字の基線の見積もりと同じ)。ふつうの文字は noLabel=1 で止める (draw.io の図形の一覧の形)
 */
const curvedText: ShapePainter = (c, w, h, e) => {
  c.begin();
  c.rect(0, 0, w, h);
  c.fillAndStroke();
  const label = e.value;
  if (!label) return;
  const fontSize = e.fontSize;
  const inset = fontSize / 2;
  const startY = e.num('arcStartY', 25);
  const endY = e.num('arcEndY', 25);
  const chordMidY = (startY + endY) / 2;
  const maxMid = Math.max(25, Math.min(chordMidY, h - chordMidY));
  const midY = chordMidY + Math.max(-maxMid, Math.min(maxMid, e.num('arcMidY', -25)));
  const top = Math.min(startY, endY, midY);
  const bottom = Math.max(startY, endY, midY);
  const valign = e.str('verticalAlign', 'middle');
  const yOff = (valign === 'top' ? inset - top : valign === 'bottom' ? h - inset - bottom : (h - (bottom - top)) / 2 - top) + 0.35 * fontSize;
  const [x0, y0, x2, y2] = [inset, startY + yOff, w - inset, endY + yOff];
  const x1 = (x0 + x2) / 2;
  const y1 = midY + yOff;
  const P = (n: number) => String(Math.round(n * 100) / 100);
  let d: string;
  let len: number;
  if (e.str('curveType', 'round') === 'round') {
    const chord = Math.hypot(x2 - x0, y2 - y0);
    const sag = Math.hypot(x1 - (x0 + x2) / 2, y1 - (y0 + y2) / 2);
    if (sag < 0.5) {
      d = `M${P(x0)} ${P(y0)}L${P(x2)} ${P(y2)}`;
      len = chord;
    } else {
      const half = chord / 2;
      const r = (half * half) / (2 * sag) + sag / 2;
      const sweep = (x2 - x0) * (y1 - y0) - (y2 - y0) * (x1 - x0) > 0 ? 0 : 1;
      const large = sag > half ? 1 : 0;
      d = `M${P(x0)} ${P(y0)}A${P(r)} ${P(r)} 0 ${large} ${sweep} ${P(x2)} ${P(y2)}`;
      const theta = 2 * Math.asin(Math.min(1, half / r));
      len = r * (large ? 2 * Math.PI - theta : theta);
    }
  } else {
    d = `M${P(x0)} ${P(y0)}Q${P(x1)} ${P(y1)} ${P(x2)} ${P(y2)}`;
    len = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x2 - x0, y2 - y0)) / 2;
  }
  const align = e.str('align', 'center');
  const [anchor, offset] = align === 'left' ? ['start', '0%'] : align === 'right' ? ['end', '100%'] : ['middle', '50%'];
  const fs = e.num('fontStyle', 0);
  const id = `dio-ct${curvedTextIds++}`;
  const attrs = [`font-size="${P(fontSize)}"`, `font-family="${escAttr(e.fontFamily)}"`, `fill="${escAttr(e.fontColor)}"`, `text-anchor="${anchor}"`];
  if (fs & 1) attrs.push('font-weight="bold"');
  if (fs & 2) attrs.push('font-style="italic"');
  const deco = [fs & 4 ? 'underline' : '', fs & 8 ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) attrs.push(`text-decoration="${deco}"`);
  c.raw(`<defs><path id="${id}" d="${d}"/></defs><text ${attrs.join(' ')}><textPath href="#${id}" startOffset="${offset}" textLength="${P(len)}" lengthAdjust="spacing">${escAttr(label)}</textPath></text>`);
};
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JavaScript で書かれた形 (形の名前 → 描き方)。標準の形は drawioShapesA.ts・drawioShapesB.ts (draw.io の Shapes.js を移したもの) */
export const JS_SHAPES: Record<string, ShapePainter> = {
  ...SHAPES_A,
  ...SHAPES_B,
  // draw.io の shapes/ の下の JavaScript で書かれた形 (src/drawioJs/)
  ...SHAPES_AWS3D,
  ...SHAPES_ARCHIMATE,
  ...SHAPES_ARROWS,
  ...SHAPES_BASIC,
  ...SHAPES_BPMN,
  ...SHAPES_ELECTRICAL,
  ...SHAPES_MISC,
  ...SHAPES_MOCKUP,
  ...SHAPES_MOCKUP_IOS,
  ...SHAPES_UI,
  'mxgraph.aws4.productIcon': awsProductIcon,
  'mxgraph.aws4.resourceIcon': awsResourceIcon,
  'mxgraph.aws4.group': awsGroup(false),
  'mxgraph.aws4.groupCenter': awsGroup(true),
  'mxgraph.aws4.group2': awsGroup2,
  'mxgraph.gcp2.doubleRect': gcpDoubleRect,
  'mxgraph.gcp2.hexIcon': gcpHexIcon,
  'mxgraph.cisco19.rect': ciscoRect,
  'mxgraph.cisco_safe.compositeIcon': ciscoSafeCompositeIcon,
  zigzag,
  curvedText,
};

/** JavaScript で書かれた線の形 (線の点で描く。形の名前 → 描き方) */
export const JS_EDGES: Record<string, (c: ShapeCanvas, pts: Array<{ x: number; y: number }>, e: ShapeEnv) => void> = {
  ...EDGES_ARROWS,
  ...EDGES_MISC,
};
