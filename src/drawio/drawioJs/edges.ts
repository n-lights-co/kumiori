/**
 * drawioJs/edges — draw.io の JavaScript で書かれた線の形のうち、リーン生産 (バリューストリームマップ) の情報の流れの線と、
 * ネットワークの通信の線を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の src/main/webapp/shapes/mxLeanMap.js の mxLeanElectronicInfoShape・
 * mxLeanManualInfoShape と、mxNetworks.js の mxShapeNetworksCommLinkEdge の paintEdgeShape (どれも mxArrow の派生)。
 * 経路の点はページの座標で受け、最初と最後の点だけを使う (途中の点は使わない。ソースと同じ)。
 * ソースは最初と最後の点 (pts の要素) を書き換えるが、ここでは写しを使う (呼ぶ側の点を変えない)。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/shape/mxArrow.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mxLeanMap.js: Copyright (c) 2006-2013, JGraph Ltd
 *   shapes/mxNetworks.js: Copyright (c) 2006-2015, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */

import type { ShapeCanvas } from '../drawioCanvas';
import type { EdgePainter } from './arrows';

/** 両端を、端と端の差の 5% ずつ内側へ寄せた点と、向きの単位ベクトル。長さ 0 は undefined (ソースでは 0 で割って NaN の経路になり、何も見えない) */
const inset = (pts: { x: number; y: number }[]) => {
  if (pts.length < 2) return undefined;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ddx = b.x - a.x;
  const ddy = b.y - a.y;
  const p0 = { x: a.x + ddx * 0.05, y: a.y + ddy * 0.05 };
  const pe = { x: b.x - ddx * 0.05, y: b.y - ddy * 0.05 };
  const dx = pe.x - p0.x;
  const dy = pe.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (!dist) return undefined;
  return { p0, pe, dx, dy, dist, nx: dx / dist, ny: dy / dist };
};

/** 終わりの点 pe に、向き (nx, ny) の矢の頭 (長さ 10・幅 10) を、線の色で塗って線を引く */
const head = (c: ShapeCanvas, pe: { x: number; y: number }, nx: number, ny: number, stroke: string | undefined) => {
  c.setFillColor(stroke ?? '#000000');
  c.begin();
  c.moveTo(pe.x - nx * 10 - ny * 5, pe.y - ny * 10 + nx * 5);
  c.lineTo(pe.x, pe.y);
  c.lineTo(pe.x - nx * 10 + ny * 5, pe.y - ny * 10 - nx * 5);
  c.fillAndStroke();
};

/** mxLeanElectronicInfoShape (mxgraph.lean_mapping.electronic_info_flow_edge): 真ん中で稲妻の形に折れる線と、矢の頭 */
const electronicInfo: EdgePainter = (c, pts, e) => {
  const v = inset(pts);
  if (!v) return;
  const { p0, pe, dx, dy, dist, nx, ny } = v;
  const midX = p0.x + dx * 0.5;
  const midY = p0.y + dy * 0.5;
  const p1x = midX - nx * dist * 0.1 - (ny / 3) * dist * 0.1;
  const p1y = midY - ny * dist * 0.1 + (nx / 3) * dist * 0.1;
  const p4x = midX + nx * dist * 0.1 + (ny / 3) * dist * 0.1;
  const p4y = midY + ny * dist * 0.1 - (nx / 3) * dist * 0.1;
  c.begin();
  c.moveTo(p0.x, p0.y);
  c.lineTo(p4x, p4y);
  c.lineTo(p1x, p1y);
  c.lineTo(pe.x, pe.y);
  c.stroke();
  // 矢の頭の向きは、折れた後の点 p1 から終わりの点へ
  const hx = pe.x - p1x;
  const hy = pe.y - p1y;
  const hd = Math.sqrt(hx * hx + hy * hy);
  if (!hd) return;
  head(c, pe, hx / hd, hy / hd, e.color('strokeColor', '#000000'));
};

/** mxLeanManualInfoShape (mxgraph.lean_mapping.manual_info_flow_edge): まっすぐの線と、矢の頭 */
const manualInfo: EdgePainter = (c, pts, e) => {
  const v = inset(pts);
  if (!v) return;
  const { p0, pe, nx, ny } = v;
  c.begin();
  c.moveTo(p0.x, p0.y);
  c.lineTo(pe.x, pe.y);
  c.stroke();
  head(c, pe, nx, ny, e.color('strokeColor', '#000000'));
};

/** mxShapeNetworksCommLinkEdge (mxgraph.networks.comm_link_edge): 真ん中で稲妻の形に折れる帯を塗って線を引く */
const commLink: EdgePainter = (c, pts) => {
  const v = inset(pts);
  if (!v) return;
  const { p0, pe, dx, dy, dist, nx, ny } = v;
  const midX = p0.x + dx * 0.5;
  const midY = p0.y + dy * 0.5;
  const p1x = midX + ((nx * dist) / 3) * 0.1 - (ny / 3) * dist * 0.1;
  const p1y = midY + ((ny * dist) / 3) * 0.1 + (nx / 3) * dist * 0.1;
  const p2x = midX + nx * dist * 0.1 + ny * dist * 0.1;
  const p2y = midY + ny * dist * 0.1 - nx * dist * 0.1;
  const p3x = midX - ((nx * dist) / 3) * 0.1 + (ny / 3) * dist * 0.1;
  const p3y = midY - ((ny * dist) / 3) * 0.1 - (nx / 3) * dist * 0.1;
  const p4x = midX - nx * dist * 0.1 - ny * dist * 0.1;
  const p4y = midY - ny * dist * 0.1 + nx * dist * 0.1;
  c.begin();
  c.moveTo(p0.x, p0.y);
  c.lineTo(p2x, p2y);
  c.lineTo(p1x, p1y);
  c.lineTo(pe.x, pe.y);
  c.lineTo(p4x, p4y);
  c.lineTo(p3x, p3y);
  c.close();
  c.fillAndStroke();
};

export const EDGES_MISC: Record<string, EdgePainter> = {
  'mxgraph.lean_mapping.electronic_info_flow_edge': electronicInfo,
  'mxgraph.lean_mapping.manual_info_flow_edge': manualInfo,
  'mxgraph.networks.comm_link_edge': commLink,
};
