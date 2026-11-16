/**
 * drawioJs/mockupIos — draw.io の JavaScript で書かれた形のうち、モックアップの iOS・マークアップ・ナビゲーションの形 (mxgraph.ios.*・
 * mxgraph.mockup.markup.*・mxgraph.mockup.navigation.*) を、drawioCanvas.ts の道具で描く。
 * 根拠: draw.io の公開のソース (Apache License 2.0) の shapes/mockup/mxMockupiOS.js・mxMockupMarkup.js・mxMockupNavigation.js の
 * 各形の paintVertexShape (と、それが呼ぶ background・foreground などの関数)。形ごとのクラスの名前は、ソースの関数の名前から mxShape を除いたもの。
 *
 * ソースの書き方を変えずに写すため、形をクラスにし、関数の引数の値は (ソースと同じく) 型を決めない (any)。スタイルの値は mxUtils.getValue と同じく、
 * 書いてあれば文字のまま、無ければ既定の値 (数のことも文字のこともある) を返す (gv)。色は Kumiori の色の解き方 (default・light-dark など) を通す (gc)。
 * ソースと違えたところ:
 * - mxSvgCanvas2D の setGradient は、塗りの枠 (objectBoundingBox) に掛けるので、位置と大きさの引数は使わない。
 * - mxUtils.getSizeForString (画面で測る字の幅) は、描く側の書体で測るか、Helvetica の字の幅で見積もる (sizeForString。drawioText.ts)。
 * - 道具の命令には、mxSvgCanvas2D の format と同じく、文字の値を数にしてから渡す (formatted)。
 * - スタイルに無い fillColor・strokeColor・fontColor・fontSize は、draw.io の既定のスタイル (defaultVertex) の値 (default の色・Kumiori の既定の字の大きさ) とする。
 * - ソースは文字の値 (buttonText など) を decodeURIComponent で解くが、解けない文字 (「100%」など) で投げると図の全体が描けないので、解けなければ元の文字のままにする (safeDecode)。
 * - 繰り返しで描く部分 (縞・アイコンの升目) の回数に上限を付けた (MAX_STRIPES・MAX_ICONS。Kumiori の守り)。
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。shapes/ の下は v24.7.5、そのほかは v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxAbstractCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxUtils.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   shapes/mockup/mxMockupMarkup.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupNavigation.js: Copyright (c) 2006-2010, JGraph Ltd
 *   shapes/mockup/mxMockupiOS.js: Copyright (c) 2006-2010, JGraph Ltd
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 * shapes/ の下のファイルは、draw.io が shapes/ に利用の制限 (shapes/LICENSE。v29.3.2 から) を付ける前の、Apache License 2.0 だけの版から移した。
 */
import type { ShapeCanvas } from '../drawioCanvas';
import type { ShapeEnv, ShapePainter } from '../drawioShapes';
import { textWidth } from '../drawioText';
import { prefixSums } from '../prefixSums';

/** スタイルに無いことを表す印 */
const MISSING = '\u0000';

/** 形の基底 (mxShape のうち、ここで使う分。fill・stroke・strokewidth は呼ぶ側が解いた値) */
abstract class MockupShape {
  fill: string | undefined;
  stroke: string | undefined;
  strokewidth: number;
  constructor(readonly e: ShapeEnv) {
    this.fill = e.fill;
    this.stroke = e.stroke;
    this.strokewidth = e.strokeWidth;
  }
  abstract paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number): void;
  /** mxUtils.getValue(this.style, key, def): 書いてあれば文字のまま、無ければ def */
  gv(key: string, def: any): any {
    const v = this.e.str(key, MISSING);
    if (v !== MISSING) return v;
    // 字の大きさは、draw.io の既定のスタイルにあるので、ソースの既定の値には落ちない
    return key === 'fontSize' ? String(this.e.fontSize) : def;
  }
  /** 色の値 (none は 'none'。無ければ def。fillColor・strokeColor・fontColor は既定のスタイルの default の色) */
  gc(key: string, def: any): any {
    const fallback = key === 'fillColor' ? '#ffffff' : key === 'strokeColor' ? '#000000' : key === 'fontColor' ? this.e.fontColor : MISSING;
    const v = this.e.color(key, fallback);
    if (v === MISSING) return def;
    return v ?? 'none';
  }
  /** c.setFillColor */
  fillColor(c: ShapeCanvas, color: any) {
    c.setFillColor(color);
  }
  /**
   * 塗りのグラデーション (mxAbstractCanvas2D.setGradient(c1, c2, x, y, w, h, dir, alpha1, alpha2))。mxSvgCanvas2D は塗る経路の枠に掛けるので、
   * 位置と大きさは使わない。alpha1・alpha2 は両端の不透明度 (stop-opacity)
   */
  grad(c: ShapeCanvas, c1: any, c2: any, dir: string, a1: number, a2: number) {
    c.setGradient(c1, c2, dir, a1, a2);
  }
}

/** 数を取る命令 (mxSvgCanvas2D は、座標・大きさ・太さなどを format (parseFloat) で数にしてから書く) */
const NUMERIC = new Set(['moveTo', 'lineTo', 'quadTo', 'curveTo', 'arcTo', 'rect', 'roundrect', 'ellipse', 'translate', 'setStrokeWidth', 'setAlpha', 'setFillAlpha', 'setStrokeAlpha', 'setFontSize', 'setFontStyle', 'setMiterLimit']);
const toNum = (v: unknown) => (typeof v === 'string' ? parseFloat(v) : v);
/**
 * 道具の命令の引数を、mxSvgCanvas2D と同じく数にしてから渡す (ソースは、スタイルの文字の値を、そのまま座標や字の大きさに渡すことがある。
 * 文字のまま足すと、数の足し算でなく、文字をつなぐことになる)。text は、枠の 4 つを数に、文字を文字にする
 */
function formatted(c: ShapeCanvas): ShapeCanvas {
  return new Proxy(c, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== 'function') return v;
      if (k === 'text') return (...a: any[]) => t.text(toNum(a[0]) as number, toNum(a[1]) as number, toNum(a[2]) as number, toNum(a[3]) as number, a[4] == null ? '' : String(a[4]), a[5], a[6]);
      if (typeof k === 'string' && NUMERIC.has(k)) return (...a: unknown[]) => v.apply(t, a.map(toNum));
      return v.bind(t);
    },
  });
}

/** ソースの decodeURIComponent。解けなければ (投げずに) 元の文字 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 繰り返しで描く部分 (iPhone・iPad・iBgStriped の縞・アイコンの升目) の回数の上限 (Kumiori の守り)。v24.7.5 のソースには上限が無い。
 * とても大きい値 (大きさ) で描き終わらないのを防ぐため、上限までは描いて、そこで止める。ふつうの値では上限に届かないので、描き方は変わらない
 */
const MAX_STRIPES = 10000;
const MAX_ICONS = 1000;

/** mxUtils.getSizeForString: 幅は drawioText.ts の textWidth (描く側の書体で測るか、Helvetica の字の幅で見積もる) と、1 行の高さ */
function sizeForString(text: any, fontSize: any, fontFamily = 'Helvetica'): { width: number; height: number } {
  const size = parseFloat(fontSize) || 12;
  return { width: textWidth(String(text), size, fontFamily), height: 1.2 * size };
}

/** mxShapeMockupiPhone (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiPhone extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    let rSize = w < 100 ? 4 : 25;
    this.background(c, x, y, w, h, rSize);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, rSize);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    this.fillColor(c, '#000000');
    c.setStrokeColor('#000000');
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    c.setStrokeWidth(1.5);

    c.begin();
    this.grad(c, '#808080', '#000000', 'south', 1, 1);
    c.moveTo(w * 0.325, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.7, h * 0.5);
    c.close();
    c.fill();

    let fillColor = this.gc('fillColor', '');
    let bgStyle = this.gv('bgStyle', 'bgGreen');

    c.setStrokeWidth(1);
    if (bgStyle === 'bgWhite')
    {
      this.fillColor(c, '#ffffff');
      c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
      c.fill();
    }
    else if (bgStyle === 'bgGreen')
    {
      this.fillColor(c, '#1f2923');
      c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
      c.fill();
    }
    else if (bgStyle === 'bgGray')
    {
      this.fillColor(c, '#dddddd');
      c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
      c.fill();
    }
    else if (bgStyle === 'bgFlat')
    {
      this.fillColor(c, fillColor);
      c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
      c.fill();
    }
    else if (bgStyle === 'bgStriped')
    {
      let wOld = w;
      let hOld = h;
      c.translate(w * 0.0625, h * 0.15);
      w = w * 0.875;
      h = h * 0.7;

      this.fillColor(c, '#5D7585');
      c.rect(0, 0, w, h);
      c.fillAndStroke();

      let strokeColor = '#18211b';
      let strokeColor2 = '#657E8F';

      c.setStrokeColor(strokeColor2);
      let i = 5;
      c.begin();

      // 縞は MAX_STRIPES 本まで (Kumiori の守り)
      while (i < w && i <= 5 * MAX_STRIPES)
      {
        c.moveTo(i, 0);
        c.lineTo(i, h);
        i = i + 5;
      }

      c.stroke();

      c.setStrokeColor(strokeColor);
      c.begin();
      c.rect(0, 0, w, h);
      c.stroke();

      w = wOld;
      h = hOld;
      c.translate( - w * 0.0625, - h * 0.15);
    }
    else if (bgStyle === 'bgMap')
    {
      let wOld = w;
      let hOld = h;
      c.translate(w * 0.0625, h * 0.15);
      w = w * 0.875;
      h = h * 0.7;

      this.fillColor(c, '#ffffff');
      c.rect(0, 0, w, h);
      c.fillAndStroke();

      let fillColor2 = '#96D1FF';
      let strokeColor2 = '#008cff';

      this.fillColor(c, fillColor2);
      c.setStrokeColor(strokeColor2);
      c.setStrokeWidth(1);

      c.begin();
      c.moveTo(0, 0);
      c.lineTo(w * 0.1171, 0);
      c.lineTo(w * 0.1136, h * 0.0438);
      c.lineTo(w * 0.0993, h * 0.054);
      c.lineTo(0, h * 0.0446);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1993, 0);
      c.lineTo(w * 0.1914, h * 0.03884);
      c.lineTo(w * 0.1536, h * 0.0362);
      c.lineTo(w * 0.1586, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.24, 0);
      c.lineTo(w * 0.2257, h * 0.054);
      c.lineTo(w * 0.2414, h * 0.0674);
      c.lineTo(w * 0.4707, h * 0.0835);
      c.lineTo(w * 0.5264, h * 0.0906);
      c.lineTo(w * 0.6429, h * 0.0929);
      c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.7193, h * 0.0621);
      c.arcTo(w * 0.48, h * 0.2143, 0, 0, 0, w * 0.7286, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8, 0);
      c.lineTo(w * 0.7886, h * 0.04554);
      c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.8164, h * 0.0875);
      c.arcTo(w * 0.1429, h * 0.0893, 0, 0, 0, w * 0.88, h * 0.1036);
      c.lineTo(w, h * 0.1112);
      c.lineTo(w, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.0933);
      c.lineTo(w * 0.08, h * 0.1036);
      c.lineTo(w * 0.1021, h * 0.1246);
      c.lineTo(w * 0.1007, h * 0.1768);
      c.lineTo(w * 0.0471, h * 0.2241);
      c.lineTo(0, h * 0.2527);
      c.close();
      c.fillAndStroke();

      c.ellipse(w * 0.1214, h * 0.0603, w * 0.0843, h * 0.0576);
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1293, h * 0.1924);
      c.lineTo(w * 0.1729, h * 0.142);
      c.lineTo(w * 0.1407, h * 0.1411);
      c.lineTo(w * 0.14, h * 0.1777);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4586, h * 0.1241);
      c.lineTo(w * 0.455, h * 0.1835);
      c.lineTo(w * 0.3893, h * 0.2246);
      c.lineTo(w * 0.2171, h * 0.1362);
      c.lineTo(w * 0.2171, h * 0.1308);
      c.lineTo(w * 0.2293, h * 0.1214);
      c.lineTo(w * 0.2857, h * 0.1174);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5079, h * 0.1134);
      c.lineTo(w * 0.7307, h * 0.1223);
      c.lineTo(w * 0.7279, h * 0.1625);
      c.lineTo(w * 0.715, h * 0.1772);
      c.lineTo(w * 0.6929, h * 0.1688);
      c.lineTo(w * 0.625, h * 0.1795);
      c.lineTo(w * 0.4779, h * 0.2835);
      c.lineTo(w * 0.395, h * 0.2299);
      c.lineTo(w * 0.4657, h * 0.1826);
      c.lineTo(w * 0.4707, h * 0.1223);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.1362);
      c.lineTo(w * 0.7643, h * 0.1237);
      c.lineTo(w * 0.7543, h * 0.1562);
      c.lineTo(w * 0.7643, h * 0.1585);
      c.lineTo(w * 0.9186, h * 0.2366);
      c.lineTo(w, h * 0.1732);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2079, h * 0.1545);
      c.lineTo(w * 0.3886, h * 0.2536);
      c.lineTo(w * 0.3414, h * 0.2933);
      c.lineTo(w * 0.1743, h * 0.1969);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1579, h * 0.2134);
      c.lineTo(w * 0.3221, h * 0.3067);
      c.lineTo(w * 0.2957, h * 0.3237);
      c.lineTo(w * 0.1157, h * 0.2424);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.405, h * 0.2656);
      c.lineTo(w * 0.31, h * 0.3353);
      c.lineTo(w * 0.3693, h * 0.3661);
      c.lineTo(w * 0.4571, h * 0.2982);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.7121, h * 0.1848);
      c.lineTo(w * 0.6879, h * 0.1754);
      c.lineTo(w * 0.6329, h * 0.1844);
      c.lineTo(w * 0.61, h * 0.2018);
      c.lineTo(w * 0.6207, h * 0.2085);
      c.lineTo(w * 0.4986, h * 0.2982);
      c.lineTo(w * 0.535, h * 0.3237);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5557, h * 0.3379);
      c.lineTo(w * 0.7464, h * 0.1826);
      c.lineTo(w * 0.8036, h * 0.2076);
      c.lineTo(w * 0.595, h * 0.3616);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8293, h * 0.2188);
      c.lineTo(w * 0.8979, h * 0.2509);
      c.lineTo(w * 0.6936, h * 0.4125);
      c.lineTo(w * 0.6171, h * 0.3737);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.2138);
      c.lineTo(w * 0.6821, h * 0.4603);
      c.lineTo(w * 0.815, h * 0.5277);
      c.lineTo(w, h * 0.4);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.317);
      c.lineTo(w * 0.0971, h * 0.2554);
      c.lineTo(w * 0.4121, h * 0.4143);
      c.lineTo(w * 0.3736, h * 0.4415);
      c.lineTo(w * 0.315, h * 0.4076);
      c.lineTo(w * 0.3093, h * 0.4116);
      c.lineTo(w * 0.3686, h * 0.4455);
      c.lineTo(w * 0.285, h * 0.5045);
      c.lineTo(w * 0.1114, h * 0.4134);
      c.lineTo(w * 0.025, h * 0.4603);
      c.lineTo(w * 0.0371, h * 0.4723);
      c.lineTo(w * 0.1114, h * 0.4371);
      c.lineTo(w * 0.2871, h * 0.5312);
      c.lineTo(w * 0.1929, h * 0.6058);
      c.lineTo(w * 0.2271, h * 0.6705);
      c.lineTo(w * 0.17, h * 0.7147);
      c.lineTo(w * 0.0314, h * 0.6321);
      c.lineTo(0, h * 0.6246);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.48, h * 0.3121);
      c.lineTo(w * 0.5157, h * 0.3375);
      c.lineTo(w * 0.4314, h * 0.3982);
      c.lineTo(w * 0.3929, h * 0.3786);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3086, h * 0.5179);
      c.lineTo(w * 0.53, h * 0.3518);
      c.lineTo(w * 0.5757, h * 0.3745);
      c.lineTo(w * 0.3479, h * 0.5411);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5964, h * 0.3884);
      c.lineTo(w * 0.6736, h * 0.4277);
      c.lineTo(w * 0.445, h * 0.5991);
      c.lineTo(w * 0.3664, h * 0.5531);
      c.lineTo(w * 0.5057, h * 0.4545);
      c.lineTo(w * 0.5507, h * 0.4754);
      c.lineTo(w * 0.5571, h * 0.4723);
      c.lineTo(w * 0.5114, h * 0.4504);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4793, h * 0.6161);
      c.lineTo(w * 0.6771, h * 0.4643);
      c.lineTo(w * 0.8086, h * 0.5326);
      c.lineTo(w * 0.7471, h * 0.5817);
      c.lineTo(w * 0.7214, h * 0.567);
      c.lineTo(w * 0.715, h * 0.571);
      c.lineTo(w * 0.7421, h * 0.5871);
      c.lineTo(w * 0.6014, h * 0.6933);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.4371);
      c.lineTo(w * 0.8443, h * 0.546);
      c.lineTo(w * 0.9071, h * 0.5701);
      c.lineTo(w, h * 0.5022);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8407, h * 0.5504);
      c.lineTo(w * 0.8993, h * 0.5759);
      c.lineTo(w * 0.6757, h * 0.7416);
      c.lineTo(w * 0.6286, h * 0.7139);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.5321);
      c.lineTo(w * 0.6979, h * 0.7549);
      c.lineTo(w * 0.7457, h * 0.7781);
      c.lineTo(w * 0.9814, h * 0.6094);
      c.lineTo(w, h * 0.6067);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.6254);
      c.lineTo(w * 0.7664, h * 0.792);
      c.lineTo(w * 0.9586, h * 0.9062);
      c.lineTo(w, h * 0.8786);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3093, h * 0.5464);
      c.lineTo(w * 0.4271, h * 0.6152);
      c.lineTo(w * 0.245, h * 0.7643);
      c.lineTo(w * 0.185, h * 0.7228);
      c.lineTo(w * 0.2493, h * 0.6728);
      c.lineTo(w * 0.2214, h * 0.6143);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.65);
      c.lineTo(w * 0.2179, h * 0.7826);
      c.lineTo(w * 0.1136, h * 0.8424);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.7272);
      c.lineTo(w * 0.0821, h * 0.859);
      c.lineTo(0, h * 0.9085);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4529, h * 0.6366);
      c.lineTo(w * 0.575, h * 0.7143);
      c.lineTo(w * 0.39, h * 0.8621);
      c.lineTo(w * 0.2657, h * 0.7902);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.9415);
      c.lineTo(w * 0.1036, h * 0.8821);
      c.lineTo(w * 0.2343, h * 0.959);
      c.lineTo(w * 0.1721, h);
      c.lineTo(0, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2586, h * 0.7951);
      c.lineTo(w * 0.3829, h * 0.8674);
      c.lineTo(w * 0.2543, h * 0.9451);
      c.lineTo(w * 0.1279, h * 0.8692);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2836, h * 0.9639);
      c.lineTo(w * 0.4207, h * 0.8772);
      c.lineTo(w * 0.605, h * 0.7321);
      c.lineTo(w * 0.6521, h * 0.7634);
      c.lineTo(w * 0.3486, h);
      c.lineTo(w * 0.3393, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3879, h);
      c.lineTo(w * 0.6721, h * 0.7759);
      c.lineTo(w * 0.7171, h * 0.7982);
      c.lineTo(w * 0.4564, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4986, h);
      c.lineTo(w * 0.7386, h * 0.8125);
      c.lineTo(w * 0.9307, h * 0.925);
      c.lineTo(w * 0.8264, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8671, h);
      c.lineTo(w * 0.9464, h * 0.9491);
      c.lineTo(w, h * 0.975);
      c.lineTo(w, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2295, h);
      c.lineTo(w * 0.2648, h * 0.9792);
      c.lineTo(w * 0.2981, h);
      c.close();
      c.fillAndStroke();

      w = wOld;
      h = hOld;
      c.translate( - w * 0.0625, - h * 0.15);
    }

    c.setStrokeWidth(1);
    c.setStrokeColor('#18211b');
    c.rect(w * 0.0625, h * 0.15, w * 0.875, h * 0.7);
    c.stroke();

    c.setStrokeWidth(1.5);
    c.setAlpha(0.8);
    c.setStrokeColor('#dddddd');
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.stroke();

    if (w > 50)
    {
      rSize = w < 100? 3 : 22.5;
      c.begin();
      c.setStrokeColor('#666666');
      c.roundrect(5, 5, w - 10, h - 10, rSize, rSize);
      c.stroke();
    }

    c.setAlpha(1);
    c.ellipse(w * 0.4875, h * 0.04125, w * 0.025, h * 0.0125);
    c.setStrokeWidth(2.5);
    c.setStrokeColor('#000000');
    this.fillColor(c, '#000099');
    c.fillAndStroke();

    c.begin();
    c.setStrokeWidth(1.5);
    this.fillColor(c, '#444444');
    c.setStrokeColor('#333333');
    rSize = 4;

    c.roundrect(w * 0.375, h * 0.075, w * 0.25, h * 0.01875, w * 0.02, h * 0.01);
    c.fillAndStroke();

    this.grad(c, '#bbbbbb', '#000000', 'south', 1, 1);
    c.ellipse(w * 0.4, h * 0.875, w * 0.2, h * 0.1);
    c.fill();

    c.setAlpha(0.5);
    c.ellipse(w * 0.404, h * 0.876, w * 0.19, h * 0.095);
    c.stroke();

    c.begin();
    c.setAlpha(0.85);
    this.fillColor(c, '#000000');
    c.moveTo(w * 0.4025, h * 0.925);
    c.arcTo(w * 0.0975, h * 0.04625, 0, 0, 1, w * 0.5975, h * 0.925);
    c.arcTo(w * 0.2, h * 0.1, 0, 0, 1, w * 0.4025, h * 0.925);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.setAlpha(0.7);
    c.setStrokeWidth(1.5);
    c.setStrokeColor('#dddddd');
    rSize = 4;
    c.roundrect(w * 0.4575, h * 0.905, w * 0.0875, h * 0.04375, h * 0.00625, h * 0.00625);
    c.stroke();
  }
}

/** mxShapeMockupiBgFlat (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiBgFlat extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
}

/** mxShapeMockupiBgStriped (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiBgStriped extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setStrokeWidth(1);
    c.begin();
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '');
    let strokeColor2 = this.gc('strokeColor2', '');

    c.setStrokeColor(strokeColor2);
    let i = 5;
    c.begin();

    // 縞は MAX_STRIPES 本まで (Kumiori の守り)
    while (i < w && i <= 5 * MAX_STRIPES)
    {
      c.moveTo(i, 0);
      c.lineTo(i, h);
      i = i + 5;
    }

    c.stroke();

    c.setStrokeColor(strokeColor);
    c.begin();
    c.rect(0, 0, w, h);
    c.stroke();
  }
}

/** mxShapeMockupiBgMap (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiBgMap extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor2 = this.gc('fillColor2', '');
    let strokeColor = this.gc('strokeColor', '');
    let strokeColor2 = this.gc('strokeColor2', '');

    this.fillColor(c, fillColor2);
    c.setStrokeColor(strokeColor2);
    c.setStrokeWidth(0.5);

    c.begin();
    c.moveTo(0, 0);
    c.lineTo(w * 0.1171, 0);
    c.lineTo(w * 0.1136, h * 0.0438);
    c.lineTo(w * 0.0993, h * 0.054);
    c.lineTo(0, h * 0.0446);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.1993, 0);
    c.lineTo(w * 0.1914, h * 0.03884);
    c.lineTo(w * 0.1536, h * 0.0362);
    c.lineTo(w * 0.1586, 0);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.24, 0);
    c.lineTo(w * 0.2257, h * 0.054);
    c.lineTo(w * 0.2414, h * 0.0674);
    c.lineTo(w * 0.4707, h * 0.0835);
    c.lineTo(w * 0.5264, h * 0.0906);
    c.lineTo(w * 0.6429, h * 0.0929);
    c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.7193, h * 0.0621);
    c.arcTo(w * 0.48, h * 0.2143, 0, 0, 0, w * 0.7286, 0);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8, 0);
    c.lineTo(w * 0.7886, h * 0.04554);
    c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.8164, h * 0.0875);
    c.arcTo(w * 0.1429, h * 0.0893, 0, 0, 0, w * 0.88, h * 0.1036);
    c.lineTo(w, h * 0.1112);
    c.lineTo(w, 0);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, h * 0.0933);
    c.lineTo(w * 0.08, h * 0.1036);
    c.lineTo(w * 0.1021, h * 0.1246);
    c.lineTo(w * 0.1007, h * 0.1768);
    c.lineTo(w * 0.0471, h * 0.2241);
    c.lineTo(0, h * 0.2527);
    c.close();
    c.fillAndStroke();

    c.ellipse(w * 0.1214, h * 0.0603, w * 0.0843, h * 0.0576);
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.1293, h * 0.1924);
    c.lineTo(w * 0.1729, h * 0.142);
    c.lineTo(w * 0.1407, h * 0.1411);
    c.lineTo(w * 0.14, h * 0.1777);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.4586, h * 0.1241);
    c.lineTo(w * 0.455, h * 0.1835);
    c.lineTo(w * 0.3893, h * 0.2246);
    c.lineTo(w * 0.2171, h * 0.1362);
    c.lineTo(w * 0.2171, h * 0.1308);
    c.lineTo(w * 0.2293, h * 0.1214);
    c.lineTo(w * 0.2857, h * 0.1174);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.5079, h * 0.1134);
    c.lineTo(w * 0.7307, h * 0.1223);
    c.lineTo(w * 0.7279, h * 0.1625);
    c.lineTo(w * 0.715, h * 0.1772);
    c.lineTo(w * 0.6929, h * 0.1688);
    c.lineTo(w * 0.625, h * 0.1795);
    c.lineTo(w * 0.4779, h * 0.2835);
    c.lineTo(w * 0.395, h * 0.2299);
    c.lineTo(w * 0.4657, h * 0.1826);
    c.lineTo(w * 0.4707, h * 0.1223);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w, h * 0.1362);
    c.lineTo(w * 0.7643, h * 0.1237);
    c.lineTo(w * 0.7543, h * 0.1562);
    c.lineTo(w * 0.7643, h * 0.1585);
    c.lineTo(w * 0.9186, h * 0.2366);
    c.lineTo(w, h * 0.1732);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.2079, h * 0.1545);
    c.lineTo(w * 0.3886, h * 0.2536);
    c.lineTo(w * 0.3414, h * 0.2933);
    c.lineTo(w * 0.1743, h * 0.1969);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.1579, h * 0.2134);
    c.lineTo(w * 0.3221, h * 0.3067);
    c.lineTo(w * 0.2957, h * 0.3237);
    c.lineTo(w * 0.1157, h * 0.2424);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.405, h * 0.2656);
    c.lineTo(w * 0.31, h * 0.3353);
    c.lineTo(w * 0.3693, h * 0.3661);
    c.lineTo(w * 0.4571, h * 0.2982);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.7121, h * 0.1848);
    c.lineTo(w * 0.6879, h * 0.1754);
    c.lineTo(w * 0.6329, h * 0.1844);
    c.lineTo(w * 0.61, h * 0.2018);
    c.lineTo(w * 0.6207, h * 0.2085);
    c.lineTo(w * 0.4986, h * 0.2982);
    c.lineTo(w * 0.535, h * 0.3237);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.5557, h * 0.3379);
    c.lineTo(w * 0.7464, h * 0.1826);
    c.lineTo(w * 0.8036, h * 0.2076);
    c.lineTo(w * 0.595, h * 0.3616);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8293, h * 0.2188);
    c.lineTo(w * 0.8979, h * 0.2509);
    c.lineTo(w * 0.6936, h * 0.4125);
    c.lineTo(w * 0.6171, h * 0.3737);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w, h * 0.2138);
    c.lineTo(w * 0.6821, h * 0.4603);
    c.lineTo(w * 0.815, h * 0.5277);
    c.lineTo(w, h * 0.4);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, h * 0.317);
    c.lineTo(w * 0.0971, h * 0.2554);
    c.lineTo(w * 0.4121, h * 0.4143);
    c.lineTo(w * 0.3736, h * 0.4415);
    c.lineTo(w * 0.315, h * 0.4076);
    c.lineTo(w * 0.3093, h * 0.4116);
    c.lineTo(w * 0.3686, h * 0.4455);
    c.lineTo(w * 0.285, h * 0.5045);
    c.lineTo(w * 0.1114, h * 0.4134);
    c.lineTo(w * 0.025, h * 0.4603);
    c.lineTo(w * 0.0371, h * 0.4723);
    c.lineTo(w * 0.1114, h * 0.4371);
    c.lineTo(w * 0.2871, h * 0.5312);
    c.lineTo(w * 0.1929, h * 0.6058);
    c.lineTo(w * 0.2271, h * 0.6705);
    c.lineTo(w * 0.17, h * 0.7147);
    c.lineTo(w * 0.0314, h * 0.6321);
    c.lineTo(0, h * 0.6246);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.48, h * 0.3121);
    c.lineTo(w * 0.5157, h * 0.3375);
    c.lineTo(w * 0.4314, h * 0.3982);
    c.lineTo(w * 0.3929, h * 0.3786);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.3086, h * 0.5179);
    c.lineTo(w * 0.53, h * 0.3518);
    c.lineTo(w * 0.5757, h * 0.3745);
    c.lineTo(w * 0.3479, h * 0.5411);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.5964, h * 0.3884);
    c.lineTo(w * 0.6736, h * 0.4277);
    c.lineTo(w * 0.445, h * 0.5991);
    c.lineTo(w * 0.3664, h * 0.5531);
    c.lineTo(w * 0.5057, h * 0.4545);
    c.lineTo(w * 0.5507, h * 0.4754);
    c.lineTo(w * 0.5571, h * 0.4723);
    c.lineTo(w * 0.5114, h * 0.4504);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.4793, h * 0.6161);
    c.lineTo(w * 0.6771, h * 0.4643);
    c.lineTo(w * 0.8086, h * 0.5326);
    c.lineTo(w * 0.7471, h * 0.5817);
    c.lineTo(w * 0.7214, h * 0.567);
    c.lineTo(w * 0.715, h * 0.571);
    c.lineTo(w * 0.7421, h * 0.5871);
    c.lineTo(w * 0.6014, h * 0.6933);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w, h * 0.4371);
    c.lineTo(w * 0.8443, h * 0.546);
    c.lineTo(w * 0.9071, h * 0.5701);
    c.lineTo(w, h * 0.5022);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8407, h * 0.5504);
    c.lineTo(w * 0.8993, h * 0.5759);
    c.lineTo(w * 0.6757, h * 0.7416);
    c.lineTo(w * 0.6286, h * 0.7139);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w, h * 0.5321);
    c.lineTo(w * 0.6979, h * 0.7549);
    c.lineTo(w * 0.7457, h * 0.7781);
    c.lineTo(w * 0.9814, h * 0.6094);
    c.lineTo(w, h * 0.6067);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w, h * 0.6254);
    c.lineTo(w * 0.7664, h * 0.792);
    c.lineTo(w * 0.9586, h * 0.9062);
    c.lineTo(w, h * 0.8786);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.3093, h * 0.5464);
    c.lineTo(w * 0.4271, h * 0.6152);
    c.lineTo(w * 0.245, h * 0.7643);
    c.lineTo(w * 0.185, h * 0.7228);
    c.lineTo(w * 0.2493, h * 0.6728);
    c.lineTo(w * 0.2214, h * 0.6143);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, h * 0.65);
    c.lineTo(w * 0.2179, h * 0.7826);
    c.lineTo(w * 0.1136, h * 0.8424);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, h * 0.7272);
    c.lineTo(w * 0.0821, h * 0.859);
    c.lineTo(0, h * 0.9085);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.4529, h * 0.6366);
    c.lineTo(w * 0.575, h * 0.7143);
    c.lineTo(w * 0.39, h * 0.8621);
    c.lineTo(w * 0.2657, h * 0.7902);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(0, h * 0.9415);
    c.lineTo(w * 0.1036, h * 0.8821);
    c.lineTo(w * 0.2343, h * 0.959);
    c.lineTo(w * 0.1721, h);
    c.lineTo(0, h);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.2586, h * 0.7951);
    c.lineTo(w * 0.3829, h * 0.8674);
    c.lineTo(w * 0.2543, h * 0.9451);
    c.lineTo(w * 0.1279, h * 0.8692);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.2836, h * 0.9639);
    c.lineTo(w * 0.4207, h * 0.8772);
    c.lineTo(w * 0.605, h * 0.7321);
    c.lineTo(w * 0.6521, h * 0.7634);
    c.lineTo(w * 0.3486, h);
    c.lineTo(w * 0.3393, h);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.3879, h);
    c.lineTo(w * 0.6721, h * 0.7759);
    c.lineTo(w * 0.7171, h * 0.7982);
    c.lineTo(w * 0.4564, h);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.4986, h);
    c.lineTo(w * 0.7386, h * 0.8125);
    c.lineTo(w * 0.9307, h * 0.925);
    c.lineTo(w * 0.8264, h);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8671, h);
    c.lineTo(w * 0.9464, h * 0.9491);
    c.lineTo(w, h * 0.975);
    c.lineTo(w, h);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.2295, h);
    c.lineTo(w * 0.2648, h * 0.9792);
    c.lineTo(w * 0.2981, h);
    c.close();
    c.fillAndStroke();

    c.setStrokeWidth(1);
    c.setStrokeColor(strokeColor);
    c.begin();
    c.rect(0, 0, w, h);
    c.stroke();
  }
}

/** mxShapeMockupiButtonBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiButtonBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let textStrings = safeDecode(this.gv('buttonText', '+Button 1, Button 2, Button 3').toString()).split(',');
    let fontColor = this.gc('textColor', '#666666');
    let selectedFontColor = this.gc('textColor2', '#ffffff');
    let fontSize = this.gv('fontSize', '17').toString();
    let frameColor = this.gc('strokeColor', '#666666');
    let separatorColor = this.gc('strokeColor2', '#c4c4c4');
    let bgColor = this.gc('fillColor', '#ffffff');
    let buttonNum = textStrings.length;
    let maxButtonWidth = 0;
    let selectedButton = -1;
    let rSize = 2.5; //rounding size
    let labelOffset = 2.5;

    for (let i = 0; i < buttonNum; i++)
    {
      let buttonText = textStrings[i];

      if(buttonText.charAt(0) === '+')
      {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      let currWidth = sizeForString(buttonText, fontSize, 'Helvetica').width;

      if (currWidth > maxButtonWidth)
      {
        maxButtonWidth = currWidth;
      }
    }

    let minButtonHeight =  fontSize * 1.5;
    let minH = buttonNum * minButtonHeight;
    let trueH = Math.max(h, minH);
    let minW = 2 * labelOffset + maxButtonWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);

    this.background(c, trueW, trueH, rSize, buttonNum, labelOffset, buttonNum * minButtonHeight, frameColor, separatorColor, bgColor, selectedButton, minButtonHeight);
    c.setShadow(false);

    this.foreground(c, trueW, trueH, rSize, buttonNum, labelOffset, buttonNum * minButtonHeight, frameColor, separatorColor, bgColor, selectedButton, minButtonHeight);
    let currWidth = 0;

    for (let i = 0; i < buttonNum; i++)
    {
      if (i === selectedButton)
      {
        c.setFontColor(selectedFontColor);
      }
      else
      {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      let currHeight = (i * minButtonHeight + minButtonHeight * 0.5) * trueH / minH;
      this.buttonText(c, trueW, currHeight, textStrings[i], fontSize, separatorColor);
    }
  }
  background(c: ShapeCanvas, w: number, h: number, rSize: any, _buttonNum: any, _labelOffset: any, _minH: any, frameColor: any, _separatorColor: any, bgColor: any, _selectedButton: any, _minButtonHeight: any) {
    c.begin();
    c.setStrokeWidth(1);

    //draw the frame
    c.setStrokeColor(frameColor);
    this.fillColor(c, bgColor);
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
  }
  foreground(c: ShapeCanvas, w: number, h: number, rSize: any, buttonNum: any, _labelOffset: any, minH: any, frameColor: any, separatorColor: any, bgColor: any, selectedButton: any, minButtonHeight: any) {
    //draw the button separators
    let strokeWidth = this.gv('strokeWidth', '1');
    c.setStrokeWidth(strokeWidth);
    c.setStrokeColor(separatorColor);
    c.begin();

    for (let i = 1; i < buttonNum; i++)
    {
      if (i !== selectedButton && i !== (selectedButton + 1))
      {
        let currHeight = i * minButtonHeight * h / minH;

        c.moveTo(0, currHeight);
        c.lineTo(w, currHeight);
      }
    }

    c.stroke();

    //draw the selected button
    c.setStrokeColor('none');

    if (selectedButton === 0)
    {
      // we draw a path for the first button
      c.begin();
      let buttonBottom = minButtonHeight * h / minH;
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, buttonBottom);
      c.lineTo(0, buttonBottom);
      c.close();
      c.fill();
    }
    else if (selectedButton === buttonNum - 1)
    {
      // we draw a path for the last button
      c.begin();
      let buttonTop = h - minButtonHeight * h / minH;
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.moveTo(0, buttonTop);
      c.lineTo(w, buttonTop);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
      c.close();
      c.fill();
    }
    else if (selectedButton !== -1)
    {
      // we draw a path rectangle for one of the buttons in the middle
      c.begin();
      let buttonTop = minButtonHeight * selectedButton * h / minH;
      let buttonBottom = minButtonHeight * (selectedButton + 1) * h / minH;
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.moveTo(0, buttonTop);
      c.lineTo(w, buttonTop);
      c.lineTo(w, buttonBottom);
      c.lineTo(0, buttonBottom);
      c.close();
      c.fill();
    }

  //  //draw the frame again, to achieve a nicer effect
    c.begin();
    c.setStrokeColor(frameColor);
    this.fillColor(c, bgColor);
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
  buttonText(c: ShapeCanvas, w: number, h: number, textString: any, fontSize: any, separatorColor: any) {
    if(textString.charAt(0) === '+')
    {
      textString = textString.substring(1);
    }

    c.setFontSize(fontSize);
    c.text(10, h, 0, 0, textString, 'left', 'middle');

    let mSize = fontSize * 0.5;
    c.setStrokeWidth(fontSize * 0.3);
    c.setStrokeColor(separatorColor);
    c.begin();
    c.moveTo(w - 20 - mSize, h - mSize);
    c.lineTo(w - 20, h);
    c.lineTo(w - 20 - mSize, h + mSize);
    c.stroke();
  }
}

/** mxShapeMockupiAppBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiAppBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.grad(c, '#eeeeee', '#999999', 'south', 1, 1);
    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.fillColor(c, '#0099ff');
    c.rect(5, h * 0.5 + 1.75, 1.5, 2.5);
    c.fill();

    c.rect(7, h * 0.5 + 0.75, 1.5, 3.5);
    c.fill();

    c.rect(9, h * 0.5 - 0.25, 1.5, 4.5);
    c.fill();

    c.rect(11, h * 0.5 - 1.25, 1.5, 5.5);
    c.fill();

    c.rect(13, h * 0.5 - 2.25, 1.5, 6.5);
    c.fill();

    c.rect(15, h * 0.5 - 3.25, 1.5, 7.5);
    c.fill();

    this.fillColor(c, '#999999');
    c.ellipse(w - 56.5, h * 0.5 - 4, 8, 8);
    c.fill();

    c.setStrokeColor('#cccccc');
    c.begin();
    c.moveTo(w - 52.5, h * 0.5 - 3);
    c.lineTo(w - 52.5, h * 0.5);
    c.lineTo(w - 54.5, h * 0.5);
    c.stroke();

    c.setStrokeWidth(0.5);
    c.setStrokeColor('#333333');
    this.fillColor(c, '#990000');
    c.begin();
    c.moveTo(w - 45.5, h * 0.5);
    c.lineTo(w - 37.5, h * 0.5 - 5);
    c.lineTo(w - 41.5, h * 0.5 + 4);
    c.lineTo(w - 42, h * 0.5 + 0.5);
    c.close();
    c.fillAndStroke();

    this.fillColor(c, '#999999');
    c.setStrokeColor('#999999');
    c.begin();
    c.moveTo(w - 28.5, h * 0.5 + 3.5);
    c.arcTo(3.5, 3.5, 0, 1, 1, w - 26.5, h * 0.5 + 1);
    c.stroke();

    c.begin();
    c.moveTo(w - 27.25, h * 0.5 + 0.25);
    c.lineTo(w - 25.75, h * 0.5 + 0.25);
    c.lineTo(w - 26.5, h * 0.5 + 1.5);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w - 31, h * 0.5 - 0.5);
    c.arcTo(1, 1.5, 0, 0, 1, w - 29, h * 0.5 - 0.5);
    c.stroke();

    c.rect(w - 31.5, h * 0.5 - 0.5, 3, 2);
    c.fillAndStroke();

    this.grad(c, '#eeeeee', '#444444', 'north', 1, 1);
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
    c.fill();

    this.grad(c, '#E2FFEB', '#008215', 'south', 1, 1);
    c.begin();
    c.moveTo(w - 20, h * 0.5 - 3);
    c.lineTo(w - 10, h * 0.5 - 3);
    c.lineTo(w - 10, h * 0.5 + 3);
    c.lineTo(w - 20, h * 0.5 + 3);
    c.close();
    c.fill();

    c.setStrokeColor('#666666');
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

  }
}

/** mxShapeMockupiTopBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiTopBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setAlpha(0.5);
    this.fillColor(c, '#999999');
    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.fillColor(c, '#cccccc');
    c.setStrokeColor('#cccccc');
    c.setFontColor('#cccccc');
    c.setFontSize(7.5);

    c.rect(5, h * 0.5 + 1.75, 1.5, 2.5);
    c.fill();

    c.rect(7, h * 0.5 + 0.75, 1.5, 3.5);
    c.fill();

    c.rect(9, h * 0.5 - 0.25, 1.5, 4.5);
    c.fill();

    c.rect(11, h * 0.5 - 1.25, 1.5, 5.5);
    c.fill();

    c.rect(13, h * 0.5 - 2.25, 1.5, 6.5);
    c.fill();

    c.rect(15, h * 0.5 - 3.25, 1.5, 7.5);
    c.fill();

    c.text(18, h * 0.5, 0, 0, 'CARRIER', 'left', 'middle');
    c.text(w * 0.5, h * 0.5, 0, 0, '11:15AM', 'center', 'middle');

    c.begin();
    c.moveTo(w - 19, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 + 2);
    c.lineTo(w - 19, h * 0.5 + 2);
    c.close();
    c.fill();

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
  }
}

/** mxShapeMockupiTopBar2 (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiTopBar2 extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '#000000');
    this.fillColor(c, strokeColor);
    c.setStrokeColor(strokeColor);

    c.rect(5, h * 0.5 + 1.75, 1.5, 2.5);
    c.fill();

    c.rect(7, h * 0.5 + 0.75, 1.5, 3.5);
    c.fill();

    c.rect(9, h * 0.5 - 0.25, 1.5, 4.5);
    c.fill();

    c.rect(11, h * 0.5 - 1.25, 1.5, 5.5);
    c.fill();

    c.rect(13, h * 0.5 - 2.25, 1.5, 6.5);
    c.fill();

    c.rect(15, h * 0.5 - 3.25, 1.5, 7.5);
    c.fill();

    c.begin();
    c.moveTo(w - 19, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 + 2);
    c.lineTo(w - 19, h * 0.5 + 2);
    c.close();
    c.fill();

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
  }
}

/** mxShapeMockupiTopBarLocked (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiTopBarLocked extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.fillColor(c, '#000000');
    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.fillColor(c, '#cccccc');
    c.setStrokeColor('#cccccc');

    c.rect(5, h * 0.5 + 1.75, 1.5, 2.5);
    c.fill();

    c.rect(7, h * 0.5 + 0.75, 1.5, 3.5);
    c.fill();

    c.rect(9, h * 0.5 - 0.25, 1.5, 4.5);
    c.fill();

    c.rect(11, h * 0.5 - 1.25, 1.5, 5.5);
    c.fill();

    c.rect(13, h * 0.5 - 2.25, 1.5, 6.5);
    c.fill();

    c.rect(15, h * 0.5 - 3.25, 1.5, 7.5);
    c.fill();

    c.begin();
    c.moveTo(w * 0.5 - 2, h * 0.5 - 1);
    c.arcTo(2, 3, 0, 0, 1, w * 0.5 + 2, h * 0.5 - 1);
    c.stroke();

    c.rect(w * 0.5 - 3, h * 0.5 - 1, 6, 4);
    c.fillAndStroke();


    c.begin();
    c.moveTo(w - 19, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 - 2);
    c.lineTo(w - 10, h * 0.5 + 2);
    c.lineTo(w - 19, h * 0.5 + 2);
    c.close();
    c.fill();

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

  }
}

/** mxShapeMockupiButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text'));
    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '8.5').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.roundrect(0, 0, w, h, 2.5, 2.5);
    c.fill();
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, text: any, fontSize: any, fontColor: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(w / 2, h / 2, 0, 0, text, 'center', 'middle');
  }
}

/** mxShapeMockupiButtonBack (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiButtonBack extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text'));
    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '17').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    let rSize = 2.5;
    c.begin();
    c.moveTo(w, rSize);
    c.arcTo(rSize, rSize, 0, 0, 0, w - rSize, 0);
    c.lineTo(10, 0);
    c.lineTo(0.87, h * 0.5 - 0.75);
    c.arcTo(rSize, rSize, 0, 0, 0, 0.87, h * 0.5 + 0.75);
    c.lineTo(10, h);
    c.lineTo(w - rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 0, w, h - rSize);
    c.close();
    c.fill();
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, text: any, fontSize: any, fontColor: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(w * 0.5 + 2.5, h * 0.5, 0, 0, text, 'center', 'middle');
  }
}

/** mxShapeMockupiButtonForward (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiButtonForward extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text'));
    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '17').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    let rSize = 2.5;
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - 10, 0);
    c.lineTo(w - 0.87, h * 0.5 - 0.75);
    c.arcTo(rSize, rSize, 0, 0, 1, w - 0.87, h * 0.5 + 0.75);
    c.lineTo(w - 10, h);
    c.lineTo(rSize, h);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    c.close();
    c.fill();
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, text: any, fontSize: any, fontColor: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(w * 0.5 - 2.5, h * 0.5, 0, 0, text, 'center', 'middle');
  }
}

/** mxShapeMockupiPrevNextButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiPrevNextButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    let rSize = 5;
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fill();

    c.begin();
    c.moveTo(w * 0.5, 0);
    c.lineTo(w * 0.5, h);
    c.stroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor3 = this.gc('fillColor3', '').toString();
    this.fillColor(c, fillColor3);

    c.begin();
    c.moveTo(w * 0.25, h * 0.25);
    c.lineTo(w * 0.35, h * 0.75);
    c.lineTo(w * 0.15, h * 0.75);
    c.close();
    c.fill();

    c.begin();
    c.moveTo(w * 0.75, h * 0.75);
    c.lineTo(w * 0.85, h * 0.25);
    c.lineTo(w * 0.65, h * 0.25);
    c.close();
    c.fill();
  }
}

/** mxShapeMockupiTextInput (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiTextInput extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text'));
    let fontColor = this.gc('textColor2', '#000000').toString();
    let fontSize = this.gv('fontSize', '8').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.roundrect(0, 0, w, h, 2.5, 2.5);
    c.fillAndStroke();
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, _w: number, h: number, text: any, fontSize: any, fontColor: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(2, h * 0.5, 0, 0, text, 'left', 'middle');
  }
}

/** mxShapeMockupiRadioGroup (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiRadioGroup extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '8').toString();
    let optionText = safeDecode(this.gv('buttonText', 'Option 1').toString()).split(',');
    let optionNum = optionText.length;
    let buttonSize = 5;
    let lineH = Math.max(fontSize * 1.5, buttonSize);
    let maxTextWidth = 0;
    let selected = -1;
    let labelOffset = 2.5;
    let minH = optionNum * lineH;
    let trueH = Math.max(h, minH);

    //get min width and selected option
    for (let i = 0; i < optionNum; i++)
    {
      let currText = optionText[i];

      if(currText.charAt(0) === '+')
      {
        currText = optionText[i].substring(1);
        selected = i;
      }

      let currWidth = sizeForString(currText, fontSize, 'Helvetica').width;

      if (currWidth > maxTextWidth)
      {
        maxTextWidth = currWidth;
      }
    }

    let minW = 2 * labelOffset + maxTextWidth + 2 * buttonSize;
    let trueW = Math.max(w, minW);

    //draw the background
    c.roundrect(0, 0, trueW, trueH, 2.5, 2.5);
    c.fillAndStroke();
    c.setShadow(false);

    c.setFontSize(fontSize);
    c.setFontColor(fontColor);

    for (let i = 0; i < optionNum; i++)
    {
      let currHeight = (i * lineH + lineH * 0.5) * trueH / minH;

      let currText = optionText[i];

      if(currText.charAt(0) === '+')
      {
        currText = optionText[i].substring(1);
        selected = i;
      }

      c.text(buttonSize * 2 + labelOffset, currHeight, 0, 0, currText, 'left', 'middle');

      let iconX = buttonSize * 0.5;
      let iconY = currHeight - buttonSize * 0.5;
      this.fillColor(c, '#dddddd');
      c.setStrokeColor('#000000');

      if (selected === i)
      {
        this.grad(c, '#aaaaaa', '#666666', 'south', 1, 1);
        c.ellipse(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
        this.fillColor(c, '#333333');
        c.setStrokeColor('#333333');
        c.ellipse(iconX + buttonSize * 0.25, iconY + buttonSize * 0.25, buttonSize * 0.5, buttonSize * 0.5);
        c.fillAndStroke();
      }
      else
      {
        this.grad(c, '#eeeeee', '#cccccc', 'south', 1, 1);
        c.ellipse(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
      }
    }
  }
}

/** mxShapeMockupiCheckboxGroup (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCheckboxGroup extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '8').toString();
    let optionText = safeDecode(this.gv('buttonText', 'Option 1').toString()).split(',');
    let optionNum = optionText.length;
    let buttonSize = 5;
    let lineH = Math.max(fontSize * 1.5, buttonSize);
    let maxTextWidth = 0;
    let selected = -1;
    let labelOffset = 2.5;
    let minH = optionNum * lineH;
    let trueH = Math.max(h, minH);

    //get min width and selected option
    for (let i = 0; i < optionNum; i++)
    {
      let currText = optionText[i];

      if(currText.charAt(0) === '+')
      {
        currText = optionText[i].substring(1);
        selected = i;
      }

      let currWidth = sizeForString(currText, fontSize, 'Helvetica').width;

      if (currWidth > maxTextWidth)
      {
        maxTextWidth = currWidth;
      }
    }

    let minW = 2 * labelOffset + maxTextWidth + 2 * buttonSize;
    let trueW = Math.max(w, minW);

    //draw the background
    c.roundrect(0, 0, trueW, trueH, 2.5, 2.5);
    c.fillAndStroke();
    c.setShadow(false);

    c.setFontSize(fontSize);
    c.setFontColor(fontColor);

    for (let i = 0; i < optionNum; i++)
    {
      let currHeight = (i * lineH + lineH * 0.5) * trueH / minH;

      let currText = optionText[i];

      if(currText.charAt(0) === '+')
      {
        currText = optionText[i].substring(1);
        selected = i;
      }

      c.text(buttonSize * 2 + labelOffset, currHeight, 0, 0, currText, 'left', 'middle');

      let iconX = buttonSize * 0.5;
      let iconY = currHeight - buttonSize * 0.5;
      this.fillColor(c, '#dddddd');
      c.setStrokeColor('#000000');

      if (selected === i)
      {
        this.grad(c, '#aaaaaa', '#666666', 'south', 1, 1);
        c.rect(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
        c.setStrokeColor('#333333');
        c.begin();
        c.moveTo(iconX + buttonSize * 0.25, iconY + buttonSize * 0.5);
        c.lineTo(iconX + buttonSize * 0.5, iconY + buttonSize * 0.75);
        c.lineTo(iconX + buttonSize * 0.75, iconY + buttonSize * 0.25);
        c.stroke();
      }
      else
      {
        this.grad(c, '#eeeeee', '#cccccc', 'south', 1, 1);
        c.rect(iconX, iconY, buttonSize, buttonSize);
        c.fillAndStroke();
      }

      selected = -1;
    }
  }
}

/** mxShapeMockupiComboBox (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiComboBox extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text'));
    let fontColor = this.gc('textColor2', '#666666').toString();
    let fontSize = this.gv('fontSize', '8.5').toString();
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
    this.mainText(c, x, y, w, h, mainText, fontSize, fontColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.fillColor(c, '#ffffff');
    c.roundrect(0, 0, w, h, 2.5, 2.5);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);
    c.begin();
    c.moveTo(w - 15, 0);
    c.lineTo(w - 2.5, 0);
    c.arcTo(2.5, 2.5, 0, 0, 1, w, 2.5);
    c.lineTo(w, h - 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, w - 2.5, h);
    c.lineTo(w - 15, h);
    c.close();
    c.fillAndStroke();

    this.fillColor(c, '#ffffff');
    c.begin();
    c.moveTo(w - 11, 5);
    c.lineTo(w - 7.5, 10);
    c.lineTo(w - 4, 5);
    c.fill();
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, _w: number, h: number, text: any, fontSize: any, fontColor: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.setFontColor(fontColor);
    c.text(2.5, h * 0.5, 0, 0, text, 'left', 'middle');
  }
}

/** mxShapeMockupiOnOffButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiOnOffButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    w = Math.max(w, 2 * h);
    let state = this.gv('buttonState', 'on');
    this.background(c, x, y, w, h, state);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, state);
    this.mainText(c, x, y, w, h, state);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, state: any) {
    if (state === 'on')
    {
      this.grad(c, '#E2FFEB', '#008215', 'south', 1, 1);
      c.roundrect(0, 0, w, h, h * 0.5, h * 0.5);
      c.fillAndStroke();
    }
    else if (state === 'off')
    {
      this.grad(c, '#cc9999', '#881100', 'south', 1, 1);
      c.roundrect(0, 0, w, h, h * 0.5, h * 0.5);
      c.fillAndStroke();
    }
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, state: any) {

    if (state === 'on')
    {
      this.grad(c, '#ffffff', '#888888', 'south', 1, 1);
      c.ellipse(w - h, 0, h, h);
      c.fillAndStroke();
    }
    else
    {
      this.grad(c, '#ffffff', '#888888', 'south', 1, 1);
      c.ellipse(0, 0, h, h);
      c.fillAndStroke();
    }
  }
  mainText(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, state: any) {
    let mainText = this.gv('mainText', null);
    c.setFontColor('#ffffff');
    c.setFontSize(8.5);

    if (mainText != '')
    {
      if(state === 'on')
      {
        c.text(w * 0.5 - h * 0.4, h * 0.5, 0, 0, mainText || 'ON', 'center', 'middle');
      }
      else if (state === 'off')
      {
        c.text(w * 0.5 + h * 0.4, h * 0.5, 0, 0, mainText || 'OFF', 'center', 'middle');
      }
    }
  }
}

/** mxShapeMockupiAlertBox (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiAlertBox extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    w = Math.max(w, 15);
    h = Math.max(h, 15);
    c.translate(x, y);
    let rSize = 7.5;
    this.background(c, x, y, w, h, rSize);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, rSize);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    this.grad(c, '#497198', '#193168', 'south', 1, 1);
    c.setAlpha(0.8);
    c.setStrokeWidth(1);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text').toString()).split(',');

    c.setStrokeColor('#497198');
    this.grad(c, '#497198', '#c5cee1', 'south', 1, 1);
    c.setAlpha(0.5);
    c.begin();
    c.moveTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, 17.5);
    c.arcTo(w * 1.67, h * 2.5, 0, 0, 1, 0, 17.5);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.close();
    c.fillAndStroke();

    c.setAlpha(0.8);
    c.setStrokeColor('#ffffff');
    c.setStrokeWidth(1);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.stroke();

    this.grad(c, '#497198', '#c5cee1', 'south', 1, 1);
    c.roundrect(5, h - 25, w - 10, 20, 2.5, 2.5);
    c.fillAndStroke();

    c.setAlpha(0.9);
    c.setFontSize(9.5);
    c.setFontColor('#ffffff');
    c.text(w * 0.5, h * 0.15, 0, 0, mainText[0], 'center', 'middle');

    c.setFontSize(8);
    c.text(w * 0.5, h * 0.4, 0, 0, mainText[2], 'center', 'middle');
    c.text(w * 0.5, h * 0.55, 0, 0, mainText[3], 'center', 'middle');

    c.setFontSize(8.5);
    c.text(w * 0.5, h - 15, 0, 0, mainText[1], 'center', 'middle');
  }
}

/** mxShapeMockupiDialogBox (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiDialogBox extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    w = Math.max(w, 15);
    h = Math.max(h, 15);
    c.translate(x, y);
    let rSize = 7.5;
    this.background(c, x, y, w, h, rSize);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, rSize);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    this.grad(c, '#497198', '#193168', 'south', 1, 1);
    c.setAlpha(0.8);
    c.setStrokeWidth(1);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    let mainText = safeDecode(this.gv('buttonText', 'Main Text').toString()).split(',');

    c.setStrokeColor('#497198');
    this.grad(c, '#497198', '#c5cee1', 'south', 1, 1);
    c.setAlpha(0.5);
    c.begin();
    c.moveTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, 17.5);
    c.arcTo(w * 1.67, h * 2.5, 0, 0, 1, 0, 17.5);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.close();
    c.fillAndStroke();

    c.setAlpha(0.8);
    c.setStrokeColor('#ffffff');
    c.setStrokeWidth(1);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.stroke();

    this.grad(c, '#497198', '#c5cee1', 'south', 1, 1);
    c.roundrect(5, h - 25, w * 0.5 - 10, 20, 2.5, 2.5);
    c.fillAndStroke();

    c.roundrect(w * 0.5 + 2.5, h - 25, w * 0.5 - 10, 20, 2.5, 2.5);
    c.fillAndStroke();

    c.setAlpha(0.9);
    c.setFontSize(9.5);
    c.setFontColor('#ffffff');
    c.text(w * 0.5, h * 0.15, 0, 0, mainText[0], 'center', 'middle');

    c.setFontSize(8);
    c.text(w * 0.5, h * 0.4, 0, 0, mainText[3], 'center', 'middle');
    c.text(w * 0.5, h * 0.55, 0, 0, mainText[4], 'center', 'middle');

    c.setFontSize(8.5);
    c.text(w * 0.25, h - 15, 0, 0, mainText[1], 'center', 'middle');
    c.text(w * 0.75, h - 15, 0, 0, mainText[2], 'center', 'middle');
  }
}

/** mxShapeMockupiLockButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiLockButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.setShadow(false);

    c.setAlpha(0.7);
    this.grad(c, '#4A4F56', '#70757B', 'north', 1, 1);
    c.rect(0, 0, w, h);
    c.fill();

    c.setAlpha(0.8);
    this.grad(c, '#18232D', '#1F2933', 'north', 1, 1);
    c.roundrect(10, h * 0.5 - 15, w - 20, 30, 7.5, 7.5);
    c.fill();

    c.setAlpha(1);
    this.grad(c, '#E9F3FD', '#ADB7C1', 'south', 1, 1);
    c.roundrect(12.5, h * 0.5 - 12.5, 40, 25, 5, 5);
    c.fill();

    c.setAlpha(0.8);
    c.setStrokeWidth(0.5);
    c.setStrokeColor('#aabbbb');
    this.grad(c, '#AEB7C1', '#667079', 'south', 1, 1);
    c.begin();
    c.moveTo(20, h * 0.5 - 3.5);
    c.lineTo(35, h * 0.5 - 3.5);
    c.lineTo(35, h * 0.5 - 7.5);
    c.lineTo(45, h * 0.5);
    c.lineTo(35, h * 0.5 + 7.5);
    c.lineTo(35, h * 0.5 + 3.5);
    c.lineTo(20, h * 0.5 + 3.5);
    c.close();
    c.fillAndStroke();

    let mainText = this.gv('mainText', null);

    if (mainText != '')
    {
      c.setFontSize(12.5);
      c.setFontColor('#cccccc');
      c.text(w / 2 + 20.5, h / 2, 0, 0, 'slide to unlock', 'center', 'middle');
    }
  }
}

/** mxShapeMockupiArrowIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiArrowIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.4, h * 0.22);
    c.lineTo(w * 0.65, h * 0.5);
    c.lineTo(w * 0.4, h * 0.78);
    c.stroke();
  }
}

/** mxShapeMockupiDeleteIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiDeleteIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.25, h * 0.5);
    c.lineTo(w * 0.75, h * 0.5);
    c.stroke();
  }
}

/** mxShapeMockupiAddIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiAddIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);
    c.setStrokeColor(strokeColor);


    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(1.5);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.25, h * 0.5);
    c.lineTo(w * 0.75, h * 0.5);
    c.moveTo(w * 0.5, h * 0.25);
    c.lineTo(w * 0.5, h * 0.75);
    c.stroke();
  }
}

/** mxShapeMockupiInfoIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiInfoIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(2.5);
    c.begin();
    this.fillColor(c, '#ffffff');
    c.moveTo(w * 0.47, h * 0.334);
    c.arcTo(w * 0.1, h * 0.15, 60, 0, 1, w * 0.61, h * 0.42);
    c.lineTo(w * 0.51, h * 0.7);
    c.arcTo(w * 0.026, h * 0.03, 30, 0, 0, w * 0.54, h * 0.74);
    c.lineTo(w * 0.608, h * 0.684);
    c.arcTo(w * 0.02, h * 0.015, 0, 0, 1, w * 0.638, h * 0.706);
    c.arcTo(w * 0.45, h * 0.45, 0, 0, 1, w * 0.42, h * 0.865);
    c.arcTo(w * 0.1, h * 0.08, -15, 0, 1, w * 0.325, h * 0.77);
    c.lineTo(w * 0.358, h * 0.66);
    c.lineTo(w * 0.435, h * 0.46);
    c.arcTo(w * 0.023, h * 0.03, 0, 0, 0, w * 0.4, h * 0.43);
    c.lineTo(w * 0.338, h * 0.484);
    c.arcTo(w * 0.01, h * 0.015, 45, 0, 1, w * 0.31, h * 0.47);
    c.arcTo(w * 0.3, h * 0.3, 0, 0, 1, w * 0.47, h * 0.334);
    c.fill();

    c.begin();
    c.moveTo(w * 0.5438, h * 0.141);
    c.arcTo(w * 0.0776, h * 0.0898, 40, 0, 1, w * 0.6671, h * 0.2308);
    c.arcTo(w * 0.0776, h * 0.0898, 40, 0, 1, w * 0.5438, h * 0.141);
    c.close();
    c.fill();
  }
}

/** mxShapeMockupiSortFindIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiSortFindIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.roundrect(0, 0, w, h, w * 0.1, h * 0.1);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth((Math.min(h, w)) / 20);
    c.begin();
    this.fillColor(c, '#ffffff');
    c.moveTo(w * 0.1, h * 0.25);
    c.lineTo(w * 0.9, h * 0.25);
    c.moveTo(w * 0.1, h * 0.4);
    c.lineTo(w * 0.9, h * 0.4);
    c.moveTo(w * 0.1, h * 0.55);
    c.lineTo(w * 0.6, h * 0.55);
    c.moveTo(w * 0.1, h * 0.7);
    c.lineTo(w * 0.5, h * 0.7);
    c.stroke();

    c.begin();
    c.ellipse(w * 0.6, h * 0.6, w * 0.2, h * 0.2);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.77, h * 0.77);
    c.lineTo(w * 0.85, h * 0.85);
    c.stroke();
  }
}

/** mxShapeMockupiCheckIcon (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCheckIcon extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, strokeColor);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.25, h * 0.5);
    c.lineTo(w * 0.5, h * 0.65);
    c.lineTo(w * 0.75, h * 0.25);
    c.stroke();
  }
}

/** mxShapeMockupiKeybLetters (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiKeybLetters extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(true);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.grad(c, '#8A97A7', '#425163', 'south', 1, 1);

    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    this.grad(c, '#EEF3F9', '#DBE2E9', 'south', 1, 1);
    let rSizeX = w * 0.0144;
    let rSizeY = h * 0.025;
    c.setFontSize(10.5);
    c.setFontColor('#000000');

    c.roundrect(w * 0.0086, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0474, h * 0.125, 0, 0, 'Q', 'center', 'middle');

    c.roundrect(w * 0.1092, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.148, h * 0.125, 0, 0, 'W', 'center', 'middle');

    c.roundrect(w * 0.2098, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2486, h * 0.125, 0, 0, 'E', 'center', 'middle');

    c.roundrect(w * 0.3103, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3491, h * 0.125, 0, 0, 'R', 'center', 'middle');

    c.roundrect(w * 0.4109, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4497, h * 0.125, 0, 0, 'T', 'center', 'middle');

    c.roundrect(w * 0.5115, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5503, h * 0.125, 0, 0, 'Y', 'center', 'middle');

    c.roundrect(w * 0.6121, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6509, h * 0.125, 0, 0, 'U', 'center', 'middle');

    c.roundrect(w * 0.7126, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7514, h * 0.125, 0, 0, 'I', 'center', 'middle');

    c.roundrect(w * 0.8132, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.852, h * 0.125, 0, 0, 'O', 'center', 'middle');

    c.roundrect(w * 0.9138, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9526, h * 0.125, 0, 0, 'P', 'center', 'middle');

    c.roundrect(w * 0.0632, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.102, h * 0.375, 0, 0, 'A', 'center', 'middle');

    c.roundrect(w * 0.1638, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2026, h * 0.375, 0, 0, 'S', 'center', 'middle');

    c.roundrect(w * 0.2644, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3032, h * 0.375, 0, 0, 'D', 'center', 'middle');

    c.roundrect(w * 0.3649, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4037, h * 0.375, 0, 0, 'F', 'center', 'middle');

    c.roundrect(w * 0.4655, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5043, h * 0.375, 0, 0, 'G', 'center', 'middle');

    c.roundrect(w * 0.5661, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6049, h * 0.375, 0, 0, 'H', 'center', 'middle');

    c.roundrect(w * 0.6667, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7055, h * 0.375, 0, 0, 'J', 'center', 'middle');

    c.roundrect(w * 0.7672, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.806, h * 0.375, 0, 0, 'K', 'center', 'middle');

    c.roundrect(w * 0.8678, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9066, h * 0.375, 0, 0, 'L', 'center', 'middle');


    c.roundrect(w * 0.1638, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2026, h * 0.625, 0, 0, 'Z', 'center', 'middle');

    c.roundrect(w * 0.2644, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3032, h * 0.625, 0, 0, 'X', 'center', 'middle');

    c.roundrect(w * 0.3649, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4037, h * 0.625, 0, 0, 'C', 'center', 'middle');

    c.roundrect(w * 0.4655, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5043, h * 0.625, 0, 0, 'V', 'center', 'middle');

    c.roundrect(w * 0.5661, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6049, h * 0.625, 0, 0, 'B', 'center', 'middle');

    c.roundrect(w * 0.6667, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7055, h * 0.625, 0, 0, 'N', 'center', 'middle');

    c.roundrect(w * 0.7672, h * 0.53, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.806, h * 0.625, 0, 0, 'M', 'center', 'middle');


    c.roundrect(w * 0.2644, h * 0.78, w * 0.4799, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.setFontColor('#666666');
    c.text(w * 0.5043, h * 0.875, 0, 0, 'space', 'center', 'middle');

    c.setFontColor('#ffffff');

    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.roundrect(w * 0.0115, h * 0.53, w * 0.1207, h * 0.19, rSizeX, rSizeY);
    c.fill();

    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.roundrect(w * 0.8736, h * 0.53, w * 0.115, h * 0.19, rSizeX, rSizeY);
    c.fill();
    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.roundrect(w * 0.0115, h * 0.78, w * 0.2299, h * 0.19, rSizeX, rSizeY);
    c.fill();
    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.roundrect(w * 0.7672, h * 0.78, w * 0.2213, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.1264, h * 0.875, 0, 0, '.?123', 'center', 'middle');
    c.text(w * 0.8779, h * 0.875, 0, 0, 'return', 'center', 'middle');

    c.setShadow(false);
    c.setLineJoin('round');
    c.setStrokeColor('#ffffff');
    this.fillColor(c, '#ffffff');
    c.setStrokeWidth(1.5);
    c.begin();
    c.moveTo(w * 0.0402, h * 0.635);
    c.lineTo(w * 0.0718, h * 0.58);
    c.lineTo(w * 0.1034, h * 0.635);
    c.lineTo(w * 0.0862, h * 0.635);
    c.lineTo(w * 0.0862, h * 0.67);
    c.lineTo(w * 0.0575, h * 0.67);
    c.lineTo(w * 0.0575, h * 0.635);
    c.close();
    c.stroke();

    c.begin();
    c.moveTo(w * 0.9109, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.665);
    c.lineTo(w * 0.9109, h * 0.665);
    c.lineTo(w * 0.8879, h * 0.625);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor('#677488');
    c.begin();
    c.moveTo(w * 0.9224, h * 0.605);
    c.lineTo(w * 0.9454, h * 0.645);
    c.moveTo(w * 0.9224, h * 0.645);
    c.lineTo(w * 0.9454, h * 0.605);
    c.stroke();
  }
}

/** mxShapeMockupiKeybNumbers (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiKeybNumbers extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(true);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.grad(c, '#8A97A7', '#425163', 'south', 1, 1);

    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    this.grad(c, '#EEF3F9', '#DBE2E9', 'south', 1, 1);
    let rSizeX = w * 0.0144;
    let rSizeY = h * 0.025;
    c.setFontSize(10.5);
    c.setFontColor('#000000');

    c.roundrect(w * 0.0086, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0474, h * 0.125, 0, 0, '1', 'center', 'middle');

    c.roundrect(w * 0.1092, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.148, h * 0.125, 0, 0, '2', 'center', 'middle');

    c.roundrect(w * 0.2098, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2486, h * 0.125, 0, 0, '3', 'center', 'middle');

    c.roundrect(w * 0.3103, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3491, h * 0.125, 0, 0, '4', 'center', 'middle');

    c.roundrect(w * 0.4109, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4497, h * 0.125, 0, 0, '5', 'center', 'middle');

    c.roundrect(w * 0.5115, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5503, h * 0.125, 0, 0, '6', 'center', 'middle');

    c.roundrect(w * 0.6121, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6509, h * 0.125, 0, 0, '7', 'center', 'middle');

    c.roundrect(w * 0.7126, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7514, h * 0.125, 0, 0, '8', 'center', 'middle');

    c.roundrect(w * 0.8132, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.852, h * 0.125, 0, 0, '9', 'center', 'middle');

    c.roundrect(w * 0.9138, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9526, h * 0.125, 0, 0, '0', 'center', 'middle');

    c.roundrect(w * 0.0086, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0474, h * 0.375, 0, 0, '-', 'center', 'middle');

    c.roundrect(w * 0.1092, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.148, h * 0.375, 0, 0, '/', 'center', 'middle');

    c.roundrect(w * 0.2098, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2486, h * 0.375, 0, 0, ':', 'center', 'middle');

    c.roundrect(w * 0.3103, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3491, h * 0.375, 0, 0, ';', 'center', 'middle');

    c.roundrect(w * 0.4109, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4497, h * 0.375, 0, 0, '(', 'center', 'middle');

    c.roundrect(w * 0.5115, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5503, h * 0.375, 0, 0, ')', 'center', 'middle');

    c.roundrect(w * 0.6121, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6509, h * 0.375, 0, 0, '$', 'center', 'middle');

    c.roundrect(w * 0.7126, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7514, h * 0.375, 0, 0, '&', 'center', 'middle');

    c.roundrect(w * 0.8132, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.852, h * 0.375, 0, 0, '@', 'center', 'middle');

    c.roundrect(w * 0.9138, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9526, h * 0.375, 0, 0, '\"', 'center', 'middle');

    c.roundrect(w * 0.1638, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2227, h * 0.625, 0, 0, '.', 'center', 'middle');

    c.roundrect(w * 0.3046, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3635, h * 0.625, 0, 0, ',', 'center', 'middle');

    c.roundrect(w * 0.4454, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5043, h * 0.625, 0, 0, '?', 'center', 'middle');

    c.roundrect(w * 0.5862, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6451, h * 0.625, 0, 0, '!', 'center', 'middle');

    c.roundrect(w * 0.727, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7859, h * 0.625, 0, 0, '\'', 'center', 'middle');


    c.roundrect(w * 0.2644, h * 0.78, w * 0.4799, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.setFontColor('#666666');
    c.text(w * 0.5043, h * 0.875, 0, 0, 'space', 'center', 'middle');

    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.setFontColor('#ffffff');

    c.roundrect(w * 0.0115, h * 0.53, w * 0.1207, h * 0.19, rSizeX, rSizeY);
    c.fill();

    c.roundrect(w * 0.8736, h * 0.53, w * 0.115, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.roundrect(w * 0.0115, h * 0.78, w * 0.2299, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.roundrect(w * 0.7672, h * 0.78, w * 0.2213, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0718, h * 0.625, 0, 0, '#+=', 'center', 'middle');
    c.text(w * 0.1264, h * 0.875, 0, 0, 'ABC', 'center', 'middle');
    c.text(w * 0.8779, h * 0.875, 0, 0, 'return', 'center', 'middle');

    c.setShadow(false);
    c.setLineJoin('round');
    c.setStrokeColor('#ffffff');
    this.fillColor(c, '#ffffff');
    c.setStrokeWidth(1.5);
    c.begin();
    c.moveTo(w * 0.9109, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.665);
    c.lineTo(w * 0.9109, h * 0.665);
    c.lineTo(w * 0.8879, h * 0.625);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor('#677488');
    c.begin();
    c.moveTo(w * 0.9224, h * 0.605);
    c.lineTo(w * 0.9454, h * 0.645);
    c.moveTo(w * 0.9224, h * 0.645);
    c.lineTo(w * 0.9454, h * 0.605);
    c.stroke();
  }
}

/** mxShapeMockupiKeybSymbols (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiKeybSymbols extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(true);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    this.grad(c, '#8A97A7', '#425163', 'south', 1, 1);

    c.rect(0, 0, w, h);
    c.fill();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, _strokeColor?: any) {
    this.grad(c, '#EEF3F9', '#DBE2E9', 'south', 1, 1);
    let rSizeX = w * 0.0144;
    let rSizeY = h * 0.025;
    c.setFontSize(10.5);
    c.setFontColor('#000000');

    c.roundrect(w * 0.0086, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0474, h * 0.125, 0, 0, '[', 'center', 'middle');

    c.roundrect(w * 0.1092, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.148, h * 0.125, 0, 0, ']', 'center', 'middle');

    c.roundrect(w * 0.2098, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2486, h * 0.125, 0, 0, '{', 'center', 'middle');

    c.roundrect(w * 0.3103, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3491, h * 0.125, 0, 0, '}', 'center', 'middle');

    c.roundrect(w * 0.4109, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4497, h * 0.125, 0, 0, '#', 'center', 'middle');

    c.roundrect(w * 0.5115, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5503, h * 0.125, 0, 0, '%', 'center', 'middle');

    c.roundrect(w * 0.6121, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6509, h * 0.125, 0, 0, '^', 'center', 'middle');

    c.roundrect(w * 0.7126, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7514, h * 0.125, 0, 0, '*', 'center', 'middle');

    c.roundrect(w * 0.8132, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.852, h * 0.125, 0, 0, '+', 'center', 'middle');

    c.roundrect(w * 0.9138, h * 0.03, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9526, h * 0.125, 0, 0, '=', 'center', 'middle');

    c.roundrect(w * 0.0086, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0474, h * 0.375, 0, 0, '_', 'center', 'middle');

    c.roundrect(w * 0.1092, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.148, h * 0.375, 0, 0, '\\', 'center', 'middle');

    c.roundrect(w * 0.2098, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2486, h * 0.375, 0, 0, '|', 'center', 'middle');

    c.roundrect(w * 0.3103, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3491, h * 0.375, 0, 0, '~', 'center', 'middle');

    c.roundrect(w * 0.4109, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.4497, h * 0.375, 0, 0, '<', 'center', 'middle');

    c.roundrect(w * 0.5115, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5503, h * 0.375, 0, 0, '>', 'center', 'middle');

    c.roundrect(w * 0.6121, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6509, h * 0.375, 0, 0, String.fromCharCode(128), 'center', 'middle');

    c.roundrect(w * 0.7126, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7514, h * 0.375, 0, 0, String.fromCharCode(parseInt('00A3', 16)), 'center', 'middle');

    c.roundrect(w * 0.8132, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.852, h * 0.375, 0, 0, String.fromCharCode(parseInt('00A5', 16)), 'center', 'middle');

    c.roundrect(w * 0.9138, h * 0.28, w * 0.0776, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.9526, h * 0.375, 0, 0, String.fromCharCode(parseInt('0095', 16)), 'center', 'middle');

    c.roundrect(w * 0.1638, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.2227, h * 0.625, 0, 0, '.', 'center', 'middle');

    c.roundrect(w * 0.3046, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.3635, h * 0.625, 0, 0, ',', 'center', 'middle');

    c.roundrect(w * 0.4454, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.5043, h * 0.625, 0, 0, '?', 'center', 'middle');

    c.roundrect(w * 0.5862, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.6451, h * 0.625, 0, 0, '!', 'center', 'middle');

    c.roundrect(w * 0.727, h * 0.53, w * 0.1178, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.7859, h * 0.625, 0, 0, '\'', 'center', 'middle');

    c.roundrect(w * 0.2644, h * 0.78, w * 0.4799, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.setFontColor('#666666');
    c.text(w * 0.5043, h * 0.875, 0, 0, 'space', 'center', 'middle');

    this.grad(c, '#8B98A8', '#677488', 'south', 1, 1);
    c.setFontColor('#ffffff');

    c.roundrect(w * 0.0115, h * 0.53, w * 0.1207, h * 0.19, rSizeX, rSizeY);
    c.fill();

    c.roundrect(w * 0.8736, h * 0.53, w * 0.115, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.roundrect(w * 0.0115, h * 0.78, w * 0.2299, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.roundrect(w * 0.7672, h * 0.78, w * 0.2213, h * 0.19, rSizeX, rSizeY);
    c.fill();
    c.text(w * 0.0718, h * 0.625, 0, 0, '123', 'center', 'middle');
    c.text(w * 0.1264, h * 0.875, 0, 0, 'ABC', 'center', 'middle');
    c.text(w * 0.8779, h * 0.875, 0, 0, 'return', 'center', 'middle');

    c.setShadow(false);
    c.setLineJoin('round');
    c.setStrokeColor('#ffffff');
    this.fillColor(c, '#ffffff');
    c.setStrokeWidth(1.5);
    c.begin();
    c.moveTo(w * 0.9109, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.585);
    c.lineTo(w * 0.9655, h * 0.665);
    c.lineTo(w * 0.9109, h * 0.665);
    c.lineTo(w * 0.8879, h * 0.625);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor('#677488');
    c.begin();
    c.moveTo(w * 0.9224, h * 0.605);
    c.lineTo(w * 0.9454, h * 0.645);
    c.moveTo(w * 0.9224, h * 0.645);
    c.lineTo(w * 0.9454, h * 0.605);
    c.stroke();
  }
}

/** mxShapeMockupiDeleteApp (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiDeleteApp extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let strokeColor = this.gc('strokeColor', '').toString();

    c.translate(x, y);
    this.background(c, x, y, w, h, strokeColor);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, strokeColor: any) {
    let fillColor = this.gc('fillColor', '').toString();
    let fillColor2 = this.gc('fillColor2', '').toString();
    this.grad(c, fillColor, fillColor2, 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor(strokeColor);
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.3, h * 0.3);
    c.lineTo(w * 0.7, h * 0.7);
    c.moveTo(w * 0.3, h * 0.7);
    c.lineTo(w * 0.7, h * 0.3);
    c.stroke();
  }
}

/** mxShapeMockupiDirection (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiDirection extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setStrokeWidth(0.5);
    c.setStrokeColor('#008cff');
    c.ellipse(0, 0, w, h);
    c.stroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setAlpha(1);
    this.grad(c, '#ffffff', '#ffffff', 'north', 1, 0);
    c.begin();
    c.moveTo(w * 0.29, h * 0.2);
    c.lineTo(w * 0.5, h * 0.5);
    c.lineTo(w * 0.71, h * 0.2);
    c.fillAndStroke();

    c.setStrokeColor('#006cdf');
    this.grad(c, '#ffffff', '#007cef', 'south', 1, 1);
    c.setAlpha(1);
    c.ellipse(w * 0.47, h * 0.47, w * 0.06, h * 0.06);
    c.fillAndStroke();

    this.fillColor(c, '#ffffff');
    c.setAlpha(0.8);
    c.ellipse(w * 0.4825, h * 0.4825, w * 0.015, h * 0.015);
    c.fill();
  }
}

/** mxShapeMockupiLocationBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiLocationBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let pointerPos = this.gv('pointerPos', 'bottom');
    let rSize = 2.5;
    let deadzone = rSize + 7.5; // rounding + pointer width / 2
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;
    c.setStrokeWidth(0.5);
    c.setStrokeColor('#000000');
    c.setAlpha(0.7);
    c.begin();

    if (pointerPos === 'bottom')
    {
      this.grad(c, '#000000', '#888888', 'north', 1, 1);
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, h - rSize - 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h - 7.5);
      c.lineTo(truePos + 7.5, h - 7.5);
      c.lineTo(truePos, h);
      c.lineTo(truePos - 7.5, h - 7.5);
      c.lineTo(rSize, h - 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize - 7.5);
    }
    else if (pointerPos === 'top')
    {
      this.grad(c, '#000000', '#888888', 'north', 1, 1);
      c.moveTo(0, rSize + 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 7.5);
      c.lineTo(truePos - 7.5, 7.5);
      c.lineTo(truePos, 0);
      c.lineTo(truePos + 7.5, 7.5);
      c.lineTo(w - rSize, 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize + 7.5);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    }

    c.close();
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let pointerPos = this.gv('pointerPos', 'bottom');
    let locText = safeDecode(this.gv('buttonText', 'Some Location'));
    c.setAlpha(1);
    c.setFontColor('#ffffff');
    c.setFontSize(9.5);

    if (pointerPos === 'bottom')
    {
      c.text(5, (h - 7.5) * 0.5, 0, 0, locText, 'left', 'middle');
      c.translate(w - 20, (h - 7.5) * 0.5 - 7.5);
    }
    else
    {
      c.text(5, (h + 7.5) * 0.5, 0, 0, locText, 'left', 'middle');
      c.translate(w - 20, (h + 7.5) * 0.5 - 7.5);
    }

    w = 15;
    h = 15;

    this.grad(c, '#8BbEff', '#135Ec8', 'south', 1, 1);

    c.setStrokeWidth(1.5);
    c.setStrokeColor('#ffffff');
    c.ellipse(0, 0, w, h);
    c.fillAndStroke();

    c.setStrokeWidth(2.5);
    c.begin();
    c.moveTo(w * 0.4, h * 0.22);
    c.lineTo(w * 0.65, h * 0.5);
    c.lineTo(w * 0.4, h * 0.78);
    c.stroke();
  }
}

/** mxShapeMockupiCallDialog (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCallDialog extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let rSize = 5;
    c.translate(x, y);
    this.background(c, x, y, w, h, rSize);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, rSize);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    c.setAlpha(0.8);
    c.setStrokeColor('#888888');
    c.setStrokeWidth(1.5);
    this.fillColor(c, '#000000');
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {

    c.begin();
    c.moveTo(w * 0.33, 0);
    c.lineTo(w * 0.33, h);
    c.moveTo(w * 0.67, 0);
    c.lineTo(w * 0.67, h);
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.stroke();

    c.setStrokeColor('#000000');
    this.fillColor(c, '#ffffff');
    c.setStrokeWidth(0.5);
    c.roundrect(w * 0.1433, h * 0.104, w * 0.0417, h * 0.148, w * 0.02, h * 0.024);
    c.fill();

    c.begin();
    c.moveTo(w * 0.14, h * 0.188);
    c.lineTo(w * 0.14, h * 0.228);
    c.arcTo(w * 0.025, h * 0.03, 0, 0, 0, w * 0.19, h * 0.228);
    c.lineTo(w * 0.19, h * 0.188);
    c.lineTo(w * 0.2, h * 0.188);
    c.lineTo(w * 0.2, h * 0.228);
    c.arcTo(w * 0.0367, h * 0.044, 0, 0, 1, w * 0.17, h * 0.27);
    c.lineTo(w * 0.17, h * 0.296);
    c.lineTo(w * 0.195, h * 0.296);
    c.lineTo(w * 0.195, h * 0.308);
    c.lineTo(w * 0.1367, h * 0.308);
    c.lineTo(w * 0.1367, h * 0.296);
    c.lineTo(w * 0.16, h * 0.296);
    c.lineTo(w * 0.16, h * 0.27);
    c.arcTo(w * 0.0367, h * 0.044, 0, 0, 1, w * 0.13, h * 0.228);
    c.lineTo(w * 0.13, h * 0.188);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.1033, h * 0.108);
    c.lineTo(w * 0.24, h * 0.286);
    c.lineTo(w * 0.2317, h * 0.298);
    c.lineTo(w * 0.095, h * 0.12);
    c.close();
    c.fillAndStroke();

    c.rect(w * 0.44, h * 0.128, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.485, h * 0.128, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.53, h * 0.128, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.44, h * 0.186, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.485, h * 0.186, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.53, h * 0.186, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.44, h * 0.244, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.485, h * 0.244, w * 0.033, h * 0.04);
    c.fill();
    c.rect(w * 0.53, h * 0.244, w * 0.033, h * 0.04);
    c.fill();

    c.begin();
    c.moveTo(w * 0.7567, h * 0.18);
    c.lineTo(w * 0.785, h * 0.18);
    c.lineTo(w * 0.825, h * 0.128);
    c.lineTo(w * 0.825, h * 0.28);
    c.lineTo(w * 0.79, h * 0.234);
    c.lineTo(w * 0.7567, h * 0.234);
    c.close();
    c.fill();

    c.setStrokeWidth(1.5);
    c.setStrokeColor('#ffffff');
    c.begin();
    c.moveTo(w * 0.8383, h * 0.16);
    c.arcTo(w * 0.0533, h * 0.064, 0, 0, 1, w * 0.8383, h * 0.252);
    c.moveTo(w * 0.8583, h * 0.134);
    c.arcTo(w * 0.0817, h * 0.098, 0, 0, 1, w * 0.8583, h * 0.276);
    c.moveTo(w * 0.8767, h * 0.11);
    c.arcTo(w * 0.1133, h * 0.136, 0, 0, 1, w * 0.8767, h * 0.304);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.1467, h * 0.62);
    c.lineTo(w * 0.1833, h * 0.62);
    c.lineTo(w * 0.1833,h * 0.676);
    c.lineTo(w * 0.2267,h * 0.676);
    c.lineTo(w * 0.2267,h * 0.724);
    c.lineTo(w * 0.1833,h * 0.724);
    c.lineTo(w * 0.1833,h * 0.78);
    c.lineTo(w * 0.1467,h * 0.78);
    c.lineTo(w * 0.1467,h * 0.724);
    c.lineTo(w * 0.105,h * 0.724);
    c.lineTo(w * 0.105,h * 0.676);
    c.lineTo(w * 0.1467,h * 0.676);
    c.close();
    c.fill();

    c.rect(w * 0.4517, h * 0.624, w * 0.0333, h * 0.152);
    c.fill();

    c.rect(w * 0.5183, h * 0.624, w * 0.0333, h * 0.152);
    c.fill();

    c.begin();
    c.moveTo(w * 0.76, h * 0.752);
    c.arcTo(w * 0.1, h * 0.12, 0, 0, 1, w * 0.8033, h * 0.728);
    c.arcTo(w * 0.0167, h * 0.02, 0, 0, 0, w * 0.8167, h * 0.712);
    c.lineTo(w * 0.8175, h * 0.7);
    c.arcTo(w * 0.0267, h * 0.06, 0, 0, 1, w * 0.8067, h * 0.644);
    c.arcTo(w * 0.0287, h * 0.0344, 0, 0, 1, w * 0.8633, h * 0.644);
    c.arcTo(w * 0.0267, h * 0.06, 0, 0, 1, w * 0.855, h * 0.7);
    c.arcTo(w * 0.05, h * 0.724, 0, 0, 1, w * 0.8633, h * 0.724);
    c.arcTo(w * 0.1667, h * 0.75, 0, 0, 1, w * 0.9083, h * 0.75);
    c.lineTo(w * 0.9083, h * 0.78);
    c.lineTo(w * 0.76, h * 0.78);
    c.close();
    c.fill();

    c.setFontColor('#ffffff');
    c.setFontSize(8.5);
    c.text(w * 0.1667, h * 0.35, 0, 0, 'mute', 'center', 'middle');
    c.text(w * 0.5, h * 0.35, 0, 0, 'keypad', 'center', 'middle');
    c.text(w * 0.8333, h * 0.35, 0, 0, 'speaker', 'center', 'middle');
    c.text(w * 0.1667, h * 0.85, 0, 0, 'add', 'center', 'middle');
    c.text(w * 0.5, h * 0.85, 0, 0, 'pause', 'center', 'middle');
    c.text(w * 0.8333, h * 0.85, 0, 0, 'contacts', 'center', 'middle');

    this.grad(c, '#808080', '#ffffff', 'north', 1, 1);
    c.setAlpha(0.4);
    c.begin();
    c.moveTo(0, h * 0.308);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h * 0.308);
    c.arcTo(w * 1.5, h * 1.8, 0, 0, 1, 0, h * 0.308);
    c.close();
    c.fill();
  }
}

/** mxShapeMockupiCallButtons (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCallButtons extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.setStrokeWidth(0.5);
    c.setStrokeColor('#008cff');
    this.grad(c, '#0F1B2B', '#4F5B6B', 'north', 1, 1);
    c.rect(0, 0, w, h);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    c.begin();
    c.moveTo(0, h * 0.1667);
    c.lineTo(w, h * 0.1667);
    c.moveTo(0, h * 0.3333);
    c.lineTo(w, h * 0.3333);
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.moveTo(0, h * 0.6667);
    c.lineTo(w, h * 0.6667);
    c.moveTo(0, h * 0.8333);
    c.lineTo(w, h * 0.8333);
    c.moveTo(w * 0.3333, h * 0.1667);
    c.lineTo(w * 0.3333, h);
    c.moveTo(w * 0.6667, h * 0.1667);
    c.lineTo(w * 0.6667, h);
    c.stroke();

    c.setFontSize(15.5);
    c.setFontColor('#ffffff');
    c.setFontStyle(1);

    c.text(w * 0.5, h * 0.0834, 0, 0, '(123) 456-7890', 'center', 'middle');

    c.text(w * 0.1667, h * 0.22, 0, 0, '1', 'center', 'middle');
    c.text(w * 0.5, h * 0.22, 0, 0, '2', 'center', 'middle');
    c.text(w * 0.8333, h * 0.22, 0, 0, '3', 'center', 'middle');

    c.text(w * 0.1667, h * 0.3867, 0, 0, '3', 'center', 'middle');
    c.text(w * 0.5, h * 0.3867, 0, 0, '4', 'center', 'middle');
    c.text(w * 0.8333, h * 0.3867, 0, 0, '5', 'center', 'middle');

    c.text(w * 0.1667, h * 0.5534, 0, 0, '6', 'center', 'middle');
    c.text(w * 0.5, h * 0.5534, 0, 0, '7', 'center', 'middle');
    c.text(w * 0.8333, h * 0.5534, 0, 0, '8', 'center', 'middle');

    c.setFontSize(27.5);
    c.text(w * 0.1667, h * 0.76, 0, 0, '*', 'center', 'middle');
    c.setFontSize(15.5);
    c.text(w * 0.5, h * 0.72, 0, 0, '0', 'center', 'middle');
    c.text(w * 0.8333, h * 0.75, 0, 0, '#', 'center', 'middle');

    this.grad(c, '#E2FFEB', '#008215', 'south', 1, 1);
    c.rect(w * 0.3333, h * 0.8333, w * 0.3333, h * 0.1667);
    c.fillAndStroke();

    c.text(w * 0.5, h * 0.9168, 0, 0, 'Call', 'center', 'middle');

    c.setFontStyle(0);
    c.setFontSize(8);
    c.setFontColor('#bbbbbb');

    c.text(w * 0.5, h * 0.28, 0, 0, 'ABC', 'center', 'middle');
    c.text(w * 0.8333, h * 0.28, 0, 0, 'DEF', 'center', 'middle');

    c.text(w * 0.1667, h * 0.4467, 0, 0, 'GHI', 'center', 'middle');
    c.text(w * 0.5, h * 0.4467, 0, 0, 'JKL', 'center', 'middle');
    c.text(w * 0.8333, h * 0.4467, 0, 0, 'MNO', 'center', 'middle');

    c.text(w * 0.1667, h * 0.6134, 0, 0, 'PQRS', 'center', 'middle');
    c.text(w * 0.5, h * 0.6134, 0, 0, 'TUV', 'center', 'middle');
    c.text(w * 0.8333, h * 0.6134, 0, 0, 'WXYZ', 'center', 'middle');

    c.text(w * 0.5, h * 0.78, 0, 0, '+', 'center', 'middle');

    this.fillColor(c, '#ffffff');
    c.begin();
    c.moveTo(w * 0.1028, h * 0.9464);
    c.arcTo(w * 0.0862, h * 0.0652, 0, 0, 1, w * 0.1402, h * 0.9333);
    c.arcTo(w * 0.0144, h * 0.0109, 0, 0, 0, w * 0.1517, h * 0.9246);
    c.lineTo(w * 0.1524, h * 0.9181);
    c.arcTo(w * 0.023, h * 0.0326, 0, 0, 1, w * 0.143, h * 0.8877);
    c.arcTo(w * 0.0247, h * 0.0187, 0, 0, 1, w * 0.1919, h * 0.8877);
    c.arcTo(w * 0.023, h * 0.0326, 0, 0, 1, w * 0.1847, h * 0.9181);
    c.arcTo(w * 0.0431, h * 0.0174, 0, 0, 0, w * 0.1919, h * 0.9311);
    c.arcTo(w * 0.1437, h * 0.1087, 0, 0, 1, w * 0.2307, h * 0.9453);
    c.lineTo(w * 0.2307, h * 0.9616);
    c.lineTo(w * 0.1028, h * 0.9616);
    c.close();
    c.fill();

    c.setStrokeColor('#ffffff');
    c.setStrokeWidth(2.5);
    c.setLineJoin('round');
    c.begin();
    c.moveTo(w * 0.79, h * 0.89);
    c.lineTo(w * 0.9, h * 0.89);
    c.lineTo(w * 0.9, h * 0.95);
    c.lineTo(w * 0.79, h * 0.95);
    c.lineTo(w * 0.76, h * 0.92);
    c.close();
    c.fillAndStroke();

    c.setStrokeColor('#0F1B2B');
    c.begin();
    c.moveTo(w * 0.82, h * 0.907);
    c.lineTo(w * 0.85, h * 0.933);
    c.moveTo(w * 0.82, h * 0.933);
    c.lineTo(w * 0.85, h * 0.907);
    c.stroke();
  }
}

/** mxShapeMockupiOption (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiOption extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
    c.setShadow(false);
    this.foreground(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let pointerPos = this.gv('pointerPos', 'bottom');
    let rSize = 2.5;
    let deadzone = rSize + 7.5; // rounding + pointer width / 2
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;
    c.setStrokeWidth(0.5);
    c.setStrokeColor('#000000');
    c.setAlpha(0.9);
    c.begin();

    if (pointerPos === 'bottom')
    {
      this.grad(c, '#000000', '#888888', 'north', 1, 1);
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(w - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
      c.lineTo(w, h - rSize - 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h - 7.5);
      c.lineTo(truePos + 7.5, h - 7.5);
      c.lineTo(truePos, h);
      c.lineTo(truePos - 7.5, h - 7.5);
      c.lineTo(rSize, h - 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize - 7.5);
    }
    else if (pointerPos === 'top')
    {
      this.grad(c, '#000000', '#888888', 'north', 1, 1);
      c.moveTo(0, rSize + 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 7.5);
      c.lineTo(truePos - 7.5, 7.5);
      c.lineTo(truePos, 0);
      c.lineTo(truePos + 7.5, 7.5);
      c.lineTo(w - rSize, 7.5);
      c.arcTo(rSize, rSize, 0, 0, 1, w, rSize + 7.5);
      c.lineTo(w, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
    }

    c.close();
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let locText = safeDecode(this.gv('buttonText', 'Some Location'));
    let pointerPos = this.gv('pointerPos', 'bottom');
    c.setAlpha(1);
    c.setFontColor('#ffffff');
    c.setFontSize(9.5);

    if (pointerPos === 'bottom')
    {
      c.text(w * 0.5, (h - 7.5) * 0.5, 0, 0, locText, 'center', 'middle');
    }
    else
    {
      c.text(w * 0.5, (h + 7.5) * 0.5, 0, 0, locText, 'center', 'middle');
    }
  }
}

/** mxShapeMockupiAlphaList (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiAlphaList extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.setShadow(false);
    let fontSize = this.gv('fontSize', '8');

    c.setFontColor('#999999');
    c.setFontSize(fontSize);
    c.text(w * 0.5, h * 0.069, 0, 0, 'A', 'center', 'middle');
    c.text(w * 0.5, h * 0.1035, 0, 0, 'B', 'center', 'middle');
    c.text(w * 0.5, h * 0.138, 0, 0, 'C', 'center', 'middle');
    c.text(w * 0.5, h * 0.1725, 0, 0, 'D', 'center', 'middle');
    c.text(w * 0.5, h * 0.207, 0, 0, 'E', 'center', 'middle');
    c.text(w * 0.5, h * 0.2415, 0, 0, 'F', 'center', 'middle');
    c.text(w * 0.5, h * 0.276, 0, 0, 'G', 'center', 'middle');
    c.text(w * 0.5, h * 0.3105, 0, 0, 'H', 'center', 'middle');
    c.text(w * 0.5, h * 0.345, 0, 0, 'I', 'center', 'middle');
    c.text(w * 0.5, h * 0.3795, 0, 0, 'J', 'center', 'middle');
    c.text(w * 0.5, h * 0.414, 0, 0, 'K', 'center', 'middle');
    c.text(w * 0.5, h * 0.4485, 0, 0, 'L', 'center', 'middle');
    c.text(w * 0.5, h * 0.483, 0, 0, 'M', 'center', 'middle');
    c.text(w * 0.5, h * 0.5175, 0, 0, 'N', 'center', 'middle');
    c.text(w * 0.5, h * 0.552, 0, 0, 'O', 'center', 'middle');
    c.text(w * 0.5, h * 0.5865, 0, 0, 'P', 'center', 'middle');
    c.text(w * 0.5, h * 0.621, 0, 0, 'Q', 'center', 'middle');
    c.text(w * 0.5, h * 0.6555, 0, 0, 'R', 'center', 'middle');
    c.text(w * 0.5, h * 0.69, 0, 0, 'S', 'center', 'middle');
    c.text(w * 0.5, h * 0.7245, 0, 0, 'T', 'center', 'middle');
    c.text(w * 0.5, h * 0.759, 0, 0, 'U', 'center', 'middle');
    c.text(w * 0.5, h * 0.7935, 0, 0, 'V', 'center', 'middle');
    c.text(w * 0.5, h * 0.828, 0, 0, 'W', 'center', 'middle');
    c.text(w * 0.5, h * 0.8625, 0, 0, 'X', 'center', 'middle');
    c.text(w * 0.5, h * 0.897, 0, 0, 'Y', 'center', 'middle');
    c.text(w * 0.5, h * 0.9315, 0, 0, 'Z', 'center', 'middle');
    c.text(w * 0.5, h * 0.966, 0, 0, '#', 'center', 'middle');

    c.setStrokeColor('#999999');
    c.ellipse(w * 0.5 - 2.25, h * 0.0345 - 3.5, 4.5, 4.5);
    c.stroke();

    c.begin();
    c.moveTo(w * 0.5 - 4.25, h * 0.0345 + 3);
    c.lineTo(w * 0.5 - 1.75, h * 0.0345);
    c.stroke();
  }
}

/** mxShapeMockupiHorButtonBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiHorButtonBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let textStrings = safeDecode(this.gv('buttonText', '+Button 1, Button 2, Button 3').toString()).split(',');
    let fontColor = this.gc('textColor', '#666666');
    let selectedFontColor = this.gc('textColor2', '#ffffff');
    let fontSize = this.gv('fontSize', '8.5').toString();
    let frameColor = this.gc('strokeColor', '#666666');
    let separatorColor = this.gc('strokeColor2', '#c4c4c4');
    let bgColor = this.gc('fillColor', '#ffffff');
    let selectedFillColor = this.gc('fillColor2', '#008cff');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let selectedButton = -1;
    let rSize = 2.5; //rounding size
    let labelOffset = 2.5;

    for (let i = 0; i < buttonNum; i++)
    {
      let buttonText = textStrings[i];

      if(buttonText.charAt(0) === '+')
      {
        buttonText = textStrings[i].substring(1);
        selectedButton = i;
      }

      buttonWidths[i] = sizeForString(buttonText, fontSize, 'Helvetica').width;

      buttonTotalWidth += buttonWidths[i];
    }

    let trueH = Math.max(h, fontSize * 1.5, 10);
    let minW = 2 * labelOffset * buttonNum + buttonTotalWidth;
    let trueW = Math.max(w, minW);

    c.translate(x, y);
    this.background(c, trueW, trueH, rSize, buttonNum, buttonWidths, labelOffset, minW, frameColor, separatorColor, bgColor, selectedFillColor, selectedButton);
    c.setShadow(false);

    let currWidth = 0;

    for (let i = 0; i < buttonNum; i++)
    {
      if (i === selectedButton)
      {
        c.setFontColor(selectedFontColor);
      }
      else
      {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  background(c: ShapeCanvas, w: number, h: number, rSize: any, buttonNum: any, buttonWidths: any, labelOffset: any, minW: any, frameColor: any, separatorColor: any, bgColor: any, _selectedFillColor: any, selectedButton: any) {
    c.begin();

    //draw the frame
    c.setStrokeColor(frameColor);
    this.fillColor(c, bgColor);
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

    //draw the button separators
    c.setStrokeColor(separatorColor);
    c.begin();
    const pre0 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (let i = 1; i < buttonNum; i++)
    {
      if (i !== selectedButton && i !== (selectedButton + 1))
      {
        let currWidth = pre0[i];

        currWidth = currWidth * w / minW;
        c.moveTo(currWidth, 0);
        c.lineTo(currWidth, h);
      }
    }

    c.stroke();

    //draw the selected button
    let buttonLeft = 0;
    c.setStrokeColor('none');

    for (let i = 0; i < selectedButton; i++)
    {
      buttonLeft += buttonWidths[i] + 2 * labelOffset;
    }

    buttonLeft = buttonLeft * w / minW;
    let buttonRight = (buttonWidths[selectedButton] + 2 * labelOffset) * w / minW;
    buttonRight += buttonLeft;

    if (selectedButton === 0)
    {
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.begin();
      // we draw a path for the first button
      c.moveTo(0, rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
      c.lineTo(buttonRight, 0);
      c.lineTo(buttonRight, h);
      c.lineTo(rSize, h);
      c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize);
      c.close();
      c.fill();
    }
    else if (selectedButton === buttonNum - 1)
    {
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.begin();
      // we draw a path for the last button
      c.moveTo(buttonLeft, 0);
      c.lineTo(buttonRight - rSize, 0);
      c.arcTo(rSize, rSize, 0, 0, 1, buttonRight, rSize);
      c.lineTo(buttonRight, h - rSize);
      c.arcTo(rSize, rSize, 0, 0, 1, buttonRight - rSize, h);
      c.lineTo(buttonLeft, h);
      c.close();
      c.fill();
    }
    else if (selectedButton !== -1)
    {
      this.grad(c, '#5D7585', '#008cff', 'south', 1, 1);
      c.begin();
      // we draw a path rectangle for one of the buttons in the middle
      c.moveTo(buttonLeft, 0);
      c.lineTo(buttonRight, 0);
      c.lineTo(buttonRight, h);
      c.lineTo(buttonLeft, h);
      c.close();
      c.fill();
    }

    //draw the frame again, to achieve a nicer effect
    c.setStrokeColor(frameColor);
    this.fillColor(c, bgColor);
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
  buttonText(c: ShapeCanvas, w: number, h: number, textString: any, buttonWidth: any, fontSize: any, minW: any, trueW: any) {
    if(textString.charAt(0) === '+')
    {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text((w + buttonWidth * 0.5) * trueW / minW, h * 0.5, 0, 0, textString, 'center', 'middle');
  }
}

/** mxShapeMockupiPin (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiPin extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let fillColor2 = this.gc('fillColor2', '#000000');
    let fillColor3 = this.gc('fillColor3', '#000000');
    let strokeColor = this.gc('strokeColor', '#000000');
    c.setShadow(false);
    c.translate(x, y);

    c.setStrokeWidth(1.5);
    c.setStrokeColor('#666666');
    c.begin();
    c.moveTo(w * 0.5, h * 0.4);
    c.lineTo(w * 0.5, h);
    c.stroke();

    c.setStrokeWidth(1);
    c.setStrokeColor(strokeColor);
    this.grad(c, fillColor2, fillColor3, 'south', 1, 1);
    c.setAlpha(0.9);
    c.ellipse(0, 0, w, h * 0.4);
    c.fillAndStroke();

    this.fillColor(c, '#ffffff');
    c.setAlpha(0.5);
    c.ellipse(w * 0.2, h * 0.08, w * 0.3, h * 0.12);
    c.fill();
  }
}

/** mxShapeMockupiVideoControls (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiVideoControls extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    let rSize = 5;
    c.setStrokeWidth(1);
    this.fillColor(c, '#000000');
    c.setStrokeColor('#bbbbbb');
    c.setAlpha(0.7);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
    c.setShadow(false);

    this.foreground(c, w, h, rSize);
  }
  foreground(c: ShapeCanvas, w: number, h: number, rSize: any) {
    this.grad(c, '#ffffff', '#ffffff', 'south', 0.8, 0.1);
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h * 0.5);
    c.lineTo(0, h * 0.5);
    c.close();
    c.fill();

    c.setAlpha(1);
    this.fillColor(c, '#ffffff');
    c.setStrokeColor('#ffffff');
    let iconX = w * 0.1;
    let iconY = h * 0.35;

    c.begin();
    c.moveTo(iconX - 7.5, iconY - 2.5);
    c.arcTo(6, 6, 0, 0, 1, iconX, iconY - 2.5);
    c.arcTo(6, 6, 0, 0, 1, iconX + 7.5, iconY - 2.5);
    c.lineTo(iconX + 7.5, iconY + 4);
    c.arcTo(6, 6, 0, 0, 0, iconX, iconY + 4);
    c.arcTo(6, 6, 0, 0, 0, iconX - 7.5, iconY + 4);
    c.close();
    c.stroke();

    c.begin();
    c.moveTo(iconX, iconY - 2.5);
    c.lineTo(iconX, iconY + 4);
    c.stroke();

    iconX = w * 0.3;
    c.rect(iconX - 7.5, iconY - 5, 1, 10);
    c.fill();

    c.begin();
    c.moveTo(iconX - 6.5, iconY);
    c.lineTo(iconX + 0.5, iconY - 5);
    c.lineTo(iconX + 0.5, iconY + 5);
    c.close();
    c.fill();

    c.begin();
    c.moveTo(iconX + 0.5, iconY);
    c.lineTo(iconX + 7.5, iconY - 5);
    c.lineTo(iconX + 7.5, iconY + 5);
    c.close();
    c.fill();

    iconX = w * 0.5;
    c.begin();
    c.moveTo(iconX - 6, iconY - 5);
    c.lineTo(iconX + 6, iconY);
    c.lineTo(iconX - 6, iconY + 5);
    c.close();
    c.fill();

    iconX = w * 0.7;
    c.begin();
    c.moveTo(iconX - 7.5, iconY - 5);
    c.lineTo(iconX - 0.5, iconY);
    c.lineTo(iconX - 7.5, iconY + 5);
    c.close();
    c.fill();
    c.begin();
    c.moveTo(iconX - 0.5, iconY - 5);
    c.lineTo(iconX + 6.5, iconY);
    c.lineTo(iconX - 0.5, iconY + 5);
    c.close();
    c.fill();
    c.rect(iconX + 6.5, iconY - 5, 1, 10);
    c.fill();

    iconX = w * 0.9;
    c.rect(iconX - 7.5, iconY - 4, 15, 8);
    c.stroke();
    c.setStrokeWidth(0.5);
    c.begin();
    c.moveTo(iconX - 7.5, iconY - 4);
    c.lineTo(iconX, iconY + 1.5);
    c.lineTo(iconX + 7.5, iconY - 4);
    c.stroke();
    c.begin();
    c.moveTo(iconX - 7.5, iconY + 4);
    c.lineTo(iconX - 2, iconY);
    c.stroke();
    c.begin();
    c.moveTo(iconX + 7.5, iconY + 4);
    c.lineTo(iconX + 2, iconY);
    c.stroke();

    this.grad(c, '#444444', '#ffffff', 'south', 1, 1);
    c.roundrect(w * 0.1, h * 0.75 - 2.5, w * 0.8, 5, 2.5, 2.5);
    c.fill();

    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = w * 0.1;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;

    this.grad(c, '#96D1FF', '#003377', 'south', 1, 1);
    c.begin();
    c.moveTo(truePos, h * 0.75 - 2.5);
    c.lineTo(truePos, h * 0.75 + 2.5);
    c.lineTo(w * 0.1 + 2.5, h * 0.75 + 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, w * 0.1 + 2.5, h * 0.75 - 2.5);
    c.close();
    c.fill();

    c.setStrokeColor('#999999');
    this.grad(c, '#444444', '#ffffff', 'north', 1, 1);
    c.ellipse(truePos - 5, h * 0.75 - 5, 10, 10);
    c.fillAndStroke();

    c.setStrokeColor('#dddddd');
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.stroke();
  }
}

/** mxShapeMockupiURLBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiURLBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    this.grad(c, '#cccccc', '#003377', 'south', 1, 1);
    c.rect(0, 0, w, h);
    c.fill();
    c.setShadow(false);

    this.foreground(c, w, h);
  }
  foreground(c: ShapeCanvas, w: number, h: number) {
    c.setStrokeWidth(0.5);
    this.fillColor(c, '#ffffff');
    c.setStrokeColor('#008cff');
    c.roundrect(w * 0.0287, h * 0.625 - 6.25, w * 0.7184, 12.5, 6.25, 6.25);
    c.fillAndStroke();

    this.grad(c, '#cccccc', '#001144', 'south', 1, 1);
    c.setStrokeColor('#000000');
    c.roundrect(w * 0.7816, h * 0.625 - 6.25, w * 0.1868, 12.5, 2.5, 2.5);
    c.fillAndStroke();

    this.fillColor(c, '#bbbbbb');
    c.ellipse(w * 0.7471 - 11.5, h * 0.625 - 5, 10, 10);
    c.fill();

    c.setStrokeColor('#ffffff');
    c.setStrokeWidth(1.5);
    c.begin();
    c.moveTo(w * 0.7471 - 8.5, h * 0.625 - 2.5);
    c.lineTo(w * 0.7471 - 3.5, h * 0.625 + 2.5);
    c.moveTo(w * 0.7471 - 8.5, h * 0.625 + 2.5);
    c.lineTo(w * 0.7471 - 3.5, h * 0.625 - 2.5);
    c.stroke();

    let fieldText = safeDecode(this.gv('buttonText', '').toString()).split(',');
    c.setFontColor('#425664');
    c.setFontStyle(1);
    c.setFontSize(8);
    c.text(w * 0.5, h * 0.2, 0, 0, fieldText[0], 'center', 'middle');
    c.setFontColor('#000000');
    c.text(w * 0.06, h * 0.625, 0, 0, fieldText[1], 'left', 'middle');
    c.setFontColor('#ffffff');
    c.text(w * 0.875, h * 0.625, 0, 0, fieldText[2], 'center', 'middle');
  }
}

/** mxShapeMockupiSlider (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiSlider extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.setShadow(false);

    this.foreground(c, w, h);
  }
  foreground(c: ShapeCanvas, w: number, h: number) {

    c.setStrokeWidth(0.5);
    this.grad(c, '#444444', '#ffffff', 'south', 1, 1);
    c.roundrect(0, h * 0.5 - 2.5, w, 5, 2.5, 2.5);
    c.fill();

    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = 0;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;

    this.grad(c, '#96D1FF', '#003377', 'south', 1, 1);
    c.begin();
    c.moveTo(truePos, h * 0.5 - 2.5);
    c.lineTo(truePos, h * 0.5 + 2.5);
    c.lineTo(2.5, h * 0.5 + 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, 2.5, h * 0.5 - 2.5);
    c.close();
    c.fill();

    c.setStrokeColor('#999999');
    this.grad(c, '#444444', '#ffffff', 'north', 1, 1);
    c.ellipse(truePos - 5, h * 0.5 - 5, 10, 10);
    c.fillAndStroke();
  }
}

/** mxShapeMockupiProgressBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiProgressBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.setShadow(false);

    this.foreground(c, w, h);
  }
  foreground(c: ShapeCanvas, w: number, h: number) {
    c.setStrokeWidth(0.5);
    this.grad(c, '#444444', '#ffffff', 'south', 1, 1);
    c.roundrect(0, h * 0.5 - 2.5, w, 5, 2.5, 2.5);
    c.fill();

    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = 0;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;

    this.grad(c, '#96D1FF', '#003377', 'south', 1, 1);
    c.begin();
    c.moveTo(truePos, h * 0.5 - 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, truePos, h * 0.5 + 2.5);
    c.lineTo(2.5, h * 0.5 + 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, 2.5, h * 0.5 - 2.5);
    c.close();
    c.fill();
  }
}

/** mxShapeMockupiCloudProgressBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCloudProgressBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.setShadow(false);

    this.foreground(c, w, h);
  }
  foreground(c: ShapeCanvas, w: number, h: number) {
    c.setStrokeWidth(0.5);
    this.fillColor(c, '#5C6E86');
    c.rect(0, h * 0.5 - 2.5, w, 5);
    c.fill();

    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = 0;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;

    this.fillColor(c, '#8AD155');
    c.rect(0, h * 0.5 - 2.5, truePos, 5);
    c.fill();
  }
}

/** mxShapeMockupiDownloadBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiDownloadBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    this.grad(c, '#00ccff', '#0066cc', 'south', 1, 1);
    c.rect(0, 0, w, h);
    c.fill();
    c.setShadow(false);

    this.foreground(c, w, h);
  }
  foreground(c: ShapeCanvas, w: number, h: number) {
    let fieldText = safeDecode(this.gv('buttonText', ''));
    c.setFontColor('#ffffff');
    c.setFontStyle(1);
    c.setFontSize(8);
    c.text(w * 0.5, h * 0.2, 0, 0, fieldText, 'center', 'middle');

    let barPos = this.gv('barPos', '80');
    barPos = Math.min(barPos, 100);
    barPos = Math.max(barPos, 0);
    let deadzone = w * 0.1;
    let virRange = w - 2 * deadzone;
    let truePos = deadzone + virRange * barPos / 100;

    c.setStrokeWidth(0.5);
    this.grad(c, '#96D1FF', '#003377', 'north', 1, 1);
    c.roundrect(deadzone, h * 0.65 - 2.5, w - 2 * deadzone, 5, 2.5, 2.5);
    c.fill();

    this.grad(c, '#aaaaaa', '#ffffff', 'north', 1, 1);
    c.begin();
    c.moveTo(truePos, h * 0.65 - 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, truePos, h * 0.65 + 2.5);
    c.lineTo(deadzone + 2.5, h * 0.65 + 2.5);
    c.arcTo(2.5, 2.5, 0, 0, 1, deadzone + 2.5, h * 0.65 - 2.5);
    c.close();
    c.fill();
  }
}

/** mxShapeMockupiScreenNameBar (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiScreenNameBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    let rSize = 5;
    c.setStrokeWidth(0.5);
    let fillColor2 = this.gc('fillColor2', '#00ff00');
    this.fillColor(c, fillColor2);
    c.rect(0, 0, w, h);
    c.fill();
    c.setShadow(false);

    this.foreground(c, w, h, rSize);
  }
  foreground(c: ShapeCanvas, w: number, h: number, _rSize: any) {
    let fillColor3 = this.gc('fillColor3', '#00ff00');
    this.grad(c, fillColor3, fillColor3, 'south', 0.8, 0.1);
    c.rect(0, 0, w, h * 0.5);
    c.fill();

    let fieldText = safeDecode(this.gv('buttonText', ''));
    let textColor = this.gc('textColor', '#00ff00');
    c.setFontColor(textColor);
    c.setFontSize(9.5);
    c.text(w * 0.5, h * 0.45, 0, 0, fieldText, 'center', 'middle');
  }
}

/** mxShapeMockupiIconGrid (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiIconGrid extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    let gridSize = safeDecode(this.gv('gridSize', '3,3').toString()).split(',');
    this.background(c, w, h, gridSize);
    c.setShadow(false);

    this.foreground(c, w, h, gridSize);
  }
  background(c: ShapeCanvas, w: number, h: number, gridSize: any) {
    let fillColor = this.gc('fillColor', '#00ff00');
    let strokeColor = this.gc('strokeColor', '#00ff00');
    c.setStrokeColor(strokeColor);
    this.fillColor(c, fillColor);

    let boxSizeX = w / (parseInt(gridSize[0],10) + (gridSize[0]-1) * 0.5);
    let boxSizeY = h / (parseInt(gridSize[1],10) + (gridSize[1]-1) * 0.5);

    // アイコンは、列も合わせた数も MAX_ICONS 個まで (Kumiori の守り)
    for (let i = 0, n = 0; i < gridSize[0] && i < MAX_ICONS; i++)
    {
      for (let j = 0; j < gridSize[1] && n < MAX_ICONS; j++, n++)
      {
        c.rect(boxSizeX * 1.5 * i, boxSizeY * 1.5 * j, boxSizeX, boxSizeY);
        c.fillAndStroke();
      }
    }
  }
  foreground(c: ShapeCanvas, w: number, h: number, gridSize: any) {
    let boxSizeX = w / (parseInt(gridSize[0],10) + (gridSize[0]-1) * 0.5);
    let boxSizeY = h / (parseInt(gridSize[1],10) + (gridSize[1]-1) * 0.5);

    // アイコンは、列も合わせた数も MAX_ICONS 個まで (Kumiori の守り)
    for (let i = 0, n = 0; i < gridSize[0] && i < MAX_ICONS; i++)
    {
      for (let j = 0; j < gridSize[1] && n < MAX_ICONS; j++, n++)
      {
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

/** mxShapeMockupiCopy (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCopy extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let rSize = 5;
    c.translate(x, y);
    this.background(c, w, h, rSize);
    c.setShadow(false);

    this.foreground(c, w, h, rSize);
  }
  background(c: ShapeCanvas, w: number, h: number, rSize: any) {
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h - rSize - 7.5);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize, h - 7.5);
    c.lineTo(w * 0.5 + 7.5, h - 7.5);
    c.lineTo(w * 0.5, h);
    c.lineTo(w * 0.5 - 7.5, h - 7.5);
    c.lineTo(rSize, h - 7.5);
    c.arcTo(rSize, rSize, 0, 0, 1, 0, h - rSize - 7.5);
    c.close();
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, w: number, h: number, rSize: any) {
    let fillColor3 = this.gc('fillColor3', '#00ff00');
    this.grad(c, fillColor3, fillColor3, 'south', 0.8, 0.1);
    c.begin();
    c.moveTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, (h - 7.5) * 0.5);
    c.lineTo(0, (h - 7.5) * 0.5);
    c.close();
    c.fill();

    let fieldText = safeDecode(this.gv('buttonText', ''));
    let textColor = this.gc('textColor', '#00ff00');
    c.setFontColor(textColor);
    c.setFontSize(8.5);
    c.text(w * 0.5, (h - 7.5)* 0.45, 0, 0, fieldText, 'center', 'middle');
  }
}

/** mxShapeMockupiCopyArea (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiCopyArea extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let rSize = 5;
    c.translate(x, y);
    this.background(c, w, h, rSize);
    c.setShadow(false);

    this.foreground(c, w, h, rSize);
  }
  background(c: ShapeCanvas, w: number, _h: number, rSize: any) {
    c.begin();
    c.moveTo(w * 0.5 - 20, 0 + rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 - 20 + rSize, 0);
    c.lineTo(w * 0.5 + 20 - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 + 20, rSize);
    c.lineTo(w * 0.5 + 20, 20 - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 + 20 - rSize, 20);
    c.lineTo(w * 0.5 + 7.5, 20);
    c.lineTo(w * 0.5, 27.5);
    c.lineTo(w * 0.5 - 7.5, 20);
    c.lineTo(w * 0.5 - 20 + rSize, 20);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 - 20, 20 - rSize);
    c.close();
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, w: number, h: number, rSize: any) {
    c.setAlpha(0.3);
    this.fillColor(c, '#2266ff');
    c.rect(2.5, 27.5, w - 5, h - 30);
    c.fill();
    c.setAlpha(1);

    if (h > 27.5)
    {
      c.setStrokeColor('#ffffff');
      this.grad(c, '#88ddff', '#2266ff', 'south', 1, 1);
      c.ellipse(w * 0.5 - 2.5, 25, 5, 5);
      c.fillAndStroke();
      this.grad(c, '#88ddff', '#2266ff', 'south', 1, 1);
      c.ellipse(w * 0.5 - 2.5, h - 5, 5, 5);
      c.fillAndStroke();
      this.grad(c, '#88ddff', '#2266ff', 'south', 1, 1);
      c.ellipse(0, h * 0.5 + 10, 5, 5);
      c.fillAndStroke();
      this.grad(c, '#88ddff', '#2266ff', 'south', 1, 1);
      c.ellipse(w - 5, h * 0.5 + 10, 5, 5);
      c.fillAndStroke();
    }

    let fillColor2 = this.gc('fillColor2', '#00ff00');
    let strokeColor = this.gc('strokeColor', '#00ff00');

    this.fillColor(c, fillColor2);
    c.setStrokeColor(strokeColor);
    c.begin();
    c.moveTo(w * 0.5 - 20, 0 + rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 - 20 + rSize, 0);
    c.lineTo(w * 0.5 + 20 - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 + 20, rSize);
    c.lineTo(w * 0.5 + 20, 20 - rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 + 20 - rSize, 20);
    c.lineTo(w * 0.5 + 7.5, 20);
    c.lineTo(w * 0.5, 27.5);
    c.lineTo(w * 0.5 - 7.5, 20);
    c.lineTo(w * 0.5 - 20 + rSize, 20);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 - 20, 20 - rSize);
    c.close();
    c.fillAndStroke();

    let fillColor3 = this.gc('fillColor3', '#00ff00');
    this.grad(c, fillColor3, fillColor3, 'south', 0.8, 0.1);
    c.begin();
    c.moveTo(w * 0.5 - 20, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 - 20 + rSize, 0);
    c.lineTo(w * 0.5 + 20 - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w * 0.5 + 20, rSize);
    c.lineTo(w * 0.5 + 20, 10);
    c.lineTo(w * 0.5 - 20, 10);
    c.close();
    c.fill();

    let fieldText = safeDecode(this.gv('buttonText', ''));
    let textColor = this.gc('textColor', '#00ff00');
    c.setFontColor(textColor);
    c.setFontSize(8.5);

    c.text(w * 0.5, 8.75, 0, 0, fieldText, 'center', 'middle');
  }
}

/** mxShapeMockupiHomePageControl (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiHomePageControl extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);


    let fillColor = this.gc('fillColor', '#000000');
    let strokeColor = this.gc('strokeColor', '#000000');
    c.setStrokeColor(strokeColor);
    this.fillColor(c, fillColor);

    let rSize = Math.min(h * 0.5, w * 0.05);
    c.ellipse(w * 0.35 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w * 0.65 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w - 2 * rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();

    c.ellipse(rSize * 0.2, h * 0.5 - rSize * 0.8, rSize * 1.2, rSize * 1.2);
    c.stroke();
    c.begin();
    c.moveTo(rSize * 1.15, h * 0.5 + rSize * 0.25);
    c.lineTo(rSize * 1.6, h * 0.5 + rSize * 0.8);
    c.stroke();
  }
}

/** mxShapeMockupiPageControl (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiPageControl extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);


    let fillColor = this.gc('fillColor', '#000000');
    let strokeColor = this.gc('strokeColor', '#000000');

    let rSize = Math.min(h * 0.5, w * 0.05);
    this.fillColor(c, strokeColor);
    c.ellipse(0, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    this.fillColor(c, fillColor);
    c.ellipse(w * 0.35 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w * 0.65 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w - 2 * rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
  }
}

/** mxShapeMockupiPad (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupiPad extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let rSize = 25;
    c.translate(x, y);
    this.background(c, x, y, w, h, rSize);
    c.setShadow(false);
    this.foreground(c, x, y, w, h, rSize);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    this.fillColor(c, '#000000');
    c.setStrokeColor('#000000');
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, _x: number, _y: number, w: number, h: number, rSize: any) {
    c.setStrokeWidth(1.5);
    c.setStrokeColor('#999999');

    c.begin();
    c.setStrokeColor('none');
    this.fillColor(c, '#808080');
    this.grad(c, '#808080', '#000000', 'south', 1, 1);
    c.moveTo(w * 0.325, 0);
    c.lineTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, h * 0.5);
    c.lineTo(w * 0.7, h * 0.5);
    c.close();
    c.fillAndStroke();

    c.begin();
    this.fillColor(c, '#1f2923');
    c.setStrokeColor('#18211b');
    c.setStrokeWidth(1);

    let fillColor = this.gc('fillColor', '');
    let bgStyle = this.gv('bgStyle', 'bgGreen');

    c.setStrokeWidth(1);

    if (bgStyle === 'bgWhite')
    {
      this.fillColor(c, '#ffffff');
      c.rect(w * 0.0928, h * 0.08, w * 0.8144, h * 0.816);
      c.fill();
    }
    else if (bgStyle === 'bgGreen')
    {
      this.fillColor(c, '#1f2923');
      c.rect(w * 0.0928, h * 0.08, w * 0.8144, h * 0.816);
      c.fill();
    }
    else if (bgStyle === 'bgGray')
    {
      this.fillColor(c, '#dddddd');
      c.rect(w * 0.0928, h * 0.08, w * 0.8144, h * 0.816);
      c.fill();
    }
    else if (bgStyle === 'bgFlat')
    {
      this.fillColor(c, fillColor);
      c.rect(w * 0.0928, h * 0.08, w * 0.8144, h * 0.816);
      c.fill();
    }
    else if (bgStyle === 'bgStriped')
    {
      let wOld = w;
      let hOld = h;
      c.translate(w * 0.0928, h * 0.08);
      w = w * 0.8144;
      h = h * 0.816;

      this.fillColor(c, '#5D7585');
      c.rect(0, 0, w, h);
      c.fillAndStroke();

      let strokeColor = '#18211b';
      let strokeColor2 = '#657E8F';

      c.setStrokeColor(strokeColor2);
      let i = 7;
      c.begin();

      // 縞は MAX_STRIPES 本まで (Kumiori の守り)
      while (i < w && i <= 7 * MAX_STRIPES)
      {
        c.moveTo(i, 0);
        c.lineTo(i, h);
        i = i + 7;
      }

      c.stroke();

      c.setStrokeColor(strokeColor);
      c.begin();
      c.rect(0, 0, w, h);
      c.stroke();

      w = wOld;
      h = hOld;
      c.translate( - w * 0.0928, - h * 0.08);
    }
    else if (bgStyle === 'bgMap')
    {
      let wOld = w;
      let hOld = h;
      c.translate(w * 0.0928, h * 0.08);
      w = w * 0.8144;
      h = h * 0.816;

      this.fillColor(c, '#ffffff');
      c.rect(0, 0, w, h);
      c.fillAndStroke();

      let fillColor2 = '#96D1FF';
      let strokeColor2 = '#008cff';

      this.fillColor(c, fillColor2);
      c.setStrokeColor(strokeColor2);
      c.setStrokeWidth(0.5);

      c.begin();
      c.moveTo(0, 0);
      c.lineTo(w * 0.1171, 0);
      c.lineTo(w * 0.1136, h * 0.0438);
      c.lineTo(w * 0.0993, h * 0.054);
      c.lineTo(0, h * 0.0446);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1993, 0);
      c.lineTo(w * 0.1914, h * 0.03884);
      c.lineTo(w * 0.1536, h * 0.0362);
      c.lineTo(w * 0.1586, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.24, 0);
      c.lineTo(w * 0.2257, h * 0.054);
      c.lineTo(w * 0.2414, h * 0.0674);
      c.lineTo(w * 0.4707, h * 0.0835);
      c.lineTo(w * 0.5264, h * 0.0906);
      c.lineTo(w * 0.6429, h * 0.0929);
      c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.7193, h * 0.0621);
      c.arcTo(w * 0.48, h * 0.2143, 0, 0, 0, w * 0.7286, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8, 0);
      c.lineTo(w * 0.7886, h * 0.04554);
      c.arcTo(w * 0.0857, h * 0.0536, 0, 0, 0, w * 0.8164, h * 0.0875);
      c.arcTo(w * 0.1429, h * 0.0893, 0, 0, 0, w * 0.88, h * 0.1036);
      c.lineTo(w, h * 0.1112);
      c.lineTo(w, 0);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.0933);
      c.lineTo(w * 0.08, h * 0.1036);
      c.lineTo(w * 0.1021, h * 0.1246);
      c.lineTo(w * 0.1007, h * 0.1768);
      c.lineTo(w * 0.0471, h * 0.2241);
      c.lineTo(0, h * 0.2527);
      c.close();
      c.fillAndStroke();

      c.ellipse(w * 0.1214, h * 0.0603, w * 0.0843, h * 0.0576);
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1293, h * 0.1924);
      c.lineTo(w * 0.1729, h * 0.142);
      c.lineTo(w * 0.1407, h * 0.1411);
      c.lineTo(w * 0.14, h * 0.1777);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4586, h * 0.1241);
      c.lineTo(w * 0.455, h * 0.1835);
      c.lineTo(w * 0.3893, h * 0.2246);
      c.lineTo(w * 0.2171, h * 0.1362);
      c.lineTo(w * 0.2171, h * 0.1308);
      c.lineTo(w * 0.2293, h * 0.1214);
      c.lineTo(w * 0.2857, h * 0.1174);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5079, h * 0.1134);
      c.lineTo(w * 0.7307, h * 0.1223);
      c.lineTo(w * 0.7279, h * 0.1625);
      c.lineTo(w * 0.715, h * 0.1772);
      c.lineTo(w * 0.6929, h * 0.1688);
      c.lineTo(w * 0.625, h * 0.1795);
      c.lineTo(w * 0.4779, h * 0.2835);
      c.lineTo(w * 0.395, h * 0.2299);
      c.lineTo(w * 0.4657, h * 0.1826);
      c.lineTo(w * 0.4707, h * 0.1223);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.1362);
      c.lineTo(w * 0.7643, h * 0.1237);
      c.lineTo(w * 0.7543, h * 0.1562);
      c.lineTo(w * 0.7643, h * 0.1585);
      c.lineTo(w * 0.9186, h * 0.2366);
      c.lineTo(w, h * 0.1732);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2079, h * 0.1545);
      c.lineTo(w * 0.3886, h * 0.2536);
      c.lineTo(w * 0.3414, h * 0.2933);
      c.lineTo(w * 0.1743, h * 0.1969);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.1579, h * 0.2134);
      c.lineTo(w * 0.3221, h * 0.3067);
      c.lineTo(w * 0.2957, h * 0.3237);
      c.lineTo(w * 0.1157, h * 0.2424);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.405, h * 0.2656);
      c.lineTo(w * 0.31, h * 0.3353);
      c.lineTo(w * 0.3693, h * 0.3661);
      c.lineTo(w * 0.4571, h * 0.2982);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.7121, h * 0.1848);
      c.lineTo(w * 0.6879, h * 0.1754);
      c.lineTo(w * 0.6329, h * 0.1844);
      c.lineTo(w * 0.61, h * 0.2018);
      c.lineTo(w * 0.6207, h * 0.2085);
      c.lineTo(w * 0.4986, h * 0.2982);
      c.lineTo(w * 0.535, h * 0.3237);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5557, h * 0.3379);
      c.lineTo(w * 0.7464, h * 0.1826);
      c.lineTo(w * 0.8036, h * 0.2076);
      c.lineTo(w * 0.595, h * 0.3616);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8293, h * 0.2188);
      c.lineTo(w * 0.8979, h * 0.2509);
      c.lineTo(w * 0.6936, h * 0.4125);
      c.lineTo(w * 0.6171, h * 0.3737);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.2138);
      c.lineTo(w * 0.6821, h * 0.4603);
      c.lineTo(w * 0.815, h * 0.5277);
      c.lineTo(w, h * 0.4);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.317);
      c.lineTo(w * 0.0971, h * 0.2554);
      c.lineTo(w * 0.4121, h * 0.4143);
      c.lineTo(w * 0.3736, h * 0.4415);
      c.lineTo(w * 0.315, h * 0.4076);
      c.lineTo(w * 0.3093, h * 0.4116);
      c.lineTo(w * 0.3686, h * 0.4455);
      c.lineTo(w * 0.285, h * 0.5045);
      c.lineTo(w * 0.1114, h * 0.4134);
      c.lineTo(w * 0.025, h * 0.4603);
      c.lineTo(w * 0.0371, h * 0.4723);
      c.lineTo(w * 0.1114, h * 0.4371);
      c.lineTo(w * 0.2871, h * 0.5312);
      c.lineTo(w * 0.1929, h * 0.6058);
      c.lineTo(w * 0.2271, h * 0.6705);
      c.lineTo(w * 0.17, h * 0.7147);
      c.lineTo(w * 0.0314, h * 0.6321);
      c.lineTo(0, h * 0.6246);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.48, h * 0.3121);
      c.lineTo(w * 0.5157, h * 0.3375);
      c.lineTo(w * 0.4314, h * 0.3982);
      c.lineTo(w * 0.3929, h * 0.3786);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3086, h * 0.5179);
      c.lineTo(w * 0.53, h * 0.3518);
      c.lineTo(w * 0.5757, h * 0.3745);
      c.lineTo(w * 0.3479, h * 0.5411);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.5964, h * 0.3884);
      c.lineTo(w * 0.6736, h * 0.4277);
      c.lineTo(w * 0.445, h * 0.5991);
      c.lineTo(w * 0.3664, h * 0.5531);
      c.lineTo(w * 0.5057, h * 0.4545);
      c.lineTo(w * 0.5507, h * 0.4754);
      c.lineTo(w * 0.5571, h * 0.4723);
      c.lineTo(w * 0.5114, h * 0.4504);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4793, h * 0.6161);
      c.lineTo(w * 0.6771, h * 0.4643);
      c.lineTo(w * 0.8086, h * 0.5326);
      c.lineTo(w * 0.7471, h * 0.5817);
      c.lineTo(w * 0.7214, h * 0.567);
      c.lineTo(w * 0.715, h * 0.571);
      c.lineTo(w * 0.7421, h * 0.5871);
      c.lineTo(w * 0.6014, h * 0.6933);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.4371);
      c.lineTo(w * 0.8443, h * 0.546);
      c.lineTo(w * 0.9071, h * 0.5701);
      c.lineTo(w, h * 0.5022);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8407, h * 0.5504);
      c.lineTo(w * 0.8993, h * 0.5759);
      c.lineTo(w * 0.6757, h * 0.7416);
      c.lineTo(w * 0.6286, h * 0.7139);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.5321);
      c.lineTo(w * 0.6979, h * 0.7549);
      c.lineTo(w * 0.7457, h * 0.7781);
      c.lineTo(w * 0.9814, h * 0.6094);
      c.lineTo(w, h * 0.6067);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w, h * 0.6254);
      c.lineTo(w * 0.7664, h * 0.792);
      c.lineTo(w * 0.9586, h * 0.9062);
      c.lineTo(w, h * 0.8786);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3093, h * 0.5464);
      c.lineTo(w * 0.4271, h * 0.6152);
      c.lineTo(w * 0.245, h * 0.7643);
      c.lineTo(w * 0.185, h * 0.7228);
      c.lineTo(w * 0.2493, h * 0.6728);
      c.lineTo(w * 0.2214, h * 0.6143);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.65);
      c.lineTo(w * 0.2179, h * 0.7826);
      c.lineTo(w * 0.1136, h * 0.8424);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.7272);
      c.lineTo(w * 0.0821, h * 0.859);
      c.lineTo(0, h * 0.9085);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4529, h * 0.6366);
      c.lineTo(w * 0.575, h * 0.7143);
      c.lineTo(w * 0.39, h * 0.8621);
      c.lineTo(w * 0.2657, h * 0.7902);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(0, h * 0.9415);
      c.lineTo(w * 0.1036, h * 0.8821);
      c.lineTo(w * 0.2343, h * 0.959);
      c.lineTo(w * 0.1721, h);
      c.lineTo(0, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2586, h * 0.7951);
      c.lineTo(w * 0.3829, h * 0.8674);
      c.lineTo(w * 0.2543, h * 0.9451);
      c.lineTo(w * 0.1279, h * 0.8692);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2836, h * 0.9639);
      c.lineTo(w * 0.4207, h * 0.8772);
      c.lineTo(w * 0.605, h * 0.7321);
      c.lineTo(w * 0.6521, h * 0.7634);
      c.lineTo(w * 0.3486, h);
      c.lineTo(w * 0.3393, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.3879, h);
      c.lineTo(w * 0.6721, h * 0.7759);
      c.lineTo(w * 0.7171, h * 0.7982);
      c.lineTo(w * 0.4564, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.4986, h);
      c.lineTo(w * 0.7386, h * 0.8125);
      c.lineTo(w * 0.9307, h * 0.925);
      c.lineTo(w * 0.8264, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.8671, h);
      c.lineTo(w * 0.9464, h * 0.9491);
      c.lineTo(w, h * 0.975);
      c.lineTo(w, h);
      c.close();
      c.fillAndStroke();

      c.begin();
      c.moveTo(w * 0.2295, h);
      c.lineTo(w * 0.2648, h * 0.9792);
      c.lineTo(w * 0.2981, h);
      c.close();
      c.fillAndStroke();

      w = wOld;
      h = hOld;
      c.translate( - w * 0.0928, - h * 0.08);
    }

    c.setStrokeWidth(1);
    c.setStrokeColor('#18211b');
    c.rect(w * 0.0928, h * 0.08, w * 0.8144, h * 0.816);
    c.stroke();

    c.setStrokeWidth(1.5);
    c.setAlpha(0.8);
    c.setStrokeColor('#dddddd');
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

    rSize = 22.5;
    c.begin();
    c.setStrokeColor('#666666');
    c.begin();
    c.moveTo(2.5, 2.5 + rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, 2.5 + rSize, 2.5);
    c.lineTo(w - rSize - 5, 2.5);
    c.arcTo(rSize, rSize, 0, 0, 1, w - 2.5, rSize + 2.5);
    c.lineTo(w - 2.5, h - rSize - 2.5);
    c.arcTo(rSize, rSize, 0, 0, 1, w - rSize - 2.5, h - 2.5);
    c.lineTo(rSize + 2.5, h - 2.5);
    c.arcTo(rSize, rSize, 0, 0, 1, 2.5, h - rSize - 2.5);
    c.close();
    c.stroke();

    c.setAlpha(1);
    c.ellipse(w * 0.4948, h * 0.0444, w * 0.0103, h * 0.008);
    c.setStrokeWidth(2.5);
    c.setStrokeColor('#000000');
    this.fillColor(c, '#000099');
    c.fillAndStroke();

    this.grad(c, '#bbbbbb', '#000000', 'south', 1, 1);
    c.ellipse(w * 0.4588, h * 0.912, w * 0.0825, h * 0.064);
    c.fill();

    c.setAlpha(0.5);
    c.ellipse(w * 0.4588, h * 0.912, w * 0.0825, h * 0.064);
    c.stroke();

    c.begin();
    c.setAlpha(0.85);
    this.fillColor(c, '#000000');
    c.moveTo(w * 0.4598, h * 0.944);
    c.arcTo(w * 0.0402, h * 0.0296, 0, 0, 1, w * 0.5402, h * 0.944);
    c.arcTo(w * 0.0825, h * 0.064, 0, 0, 1, w * 0.4598, h * 0.944);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.setAlpha(0.7);
    c.setStrokeWidth(1.5);
    c.setStrokeColor('#dddddd');
    rSize = 4;
    c.roundrect(w * 0.4814, h * 0.9296, w * 0.0371, h * 0.0288, h * 0.00515, h * 0.004);
    c.stroke();
  }
}

/** mxShapeMockupRRect (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupRRect extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let rSize = parseInt(this.gv('rSize', '10'));
    c.roundrect(0, 0, w, h, rSize, rSize); // ソースは dy を渡さない (mxSvgCanvas2D は ry を書かず、SVG の ry は rx と同じになる)
    c.fillAndStroke();
  }
}

/** mxShapeIosTopButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class IosTopButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let rSize = parseInt(this.gv('rSize', '10'));

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

/** mxShapeIosBottomButton (draw.io の shapes/mockup/mxMockupiOS.js) */
class IosBottomButton extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let rSize = parseInt(this.gv('rSize', '10'));

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

/** mxShapeIosAnchor (draw.io の shapes/mockup/mxMockupiOS.js) */
class IosAnchor extends MockupShape {
  paintVertexShape(_c: ShapeCanvas, _x: number, _y: number, _w: number, _h: number) {
  }
}

/** mxShapeIosCheckbox (draw.io の shapes/mockup/mxMockupiOS.js) */
class IosCheckbox extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
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

/** mxShapeMockupFancyRRect (draw.io の shapes/mockup/mxMockupiOS.js) */
class MockupFancyRRect extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    let rSize = parseInt(this.gv('rSize', '10'));
    let fillColor = this.gc('fillColor', '#ffffff');
    let strokeColor = this.gc('strokeColor', '#000000');

  //  c.setAlpha(0.8);
    c.roundrect(0, 0, w, h, rSize, rSize); // ソースは dy を渡さない (mxSvgCanvas2D は ry を書かず、SVG の ry は rx と同じになる)
    c.fillAndStroke();

    c.setShadow(false);

    c.setStrokeColor(fillColor);
    this.grad(c, fillColor, '#ffffff', 'south', 1, 1);
    c.setAlpha(0.3);
    c.begin();
    c.moveTo(w - rSize, 0);
    c.arcTo(rSize, rSize, 0, 0, 1, w, rSize);
    c.lineTo(w, 17.5);
    c.arcTo(w * 1.67, h * 2.5, 0, 0, 1, 0, 17.5);
    c.lineTo(0, rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, 0);
    c.close();
    c.fillAndStroke();

    c.setAlpha(0.8);
    c.setStrokeColor(strokeColor);
    c.setStrokeWidth(1);
    c.roundrect(0, 0, w, h, rSize, rSize);
    c.stroke();
  }
}

/** mxShapeMockupCurlyBrace (draw.io の shapes/mockup/mxMockupMarkup.js) */
class MockupCurlyBrace extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, x, y, w, h);
  }
  background(c: ShapeCanvas, _x: number, _y: number, w: number, h: number) {
    let midY = h * 0.5;
    let rSize = Math.min(w * 0.125, midY);
    c.begin();
    c.moveTo(0, midY + rSize);
    c.arcTo(rSize, rSize, 0, 0, 1, rSize, midY);
    c.lineTo(w * 0.5 - rSize, midY);
    c.arcTo(rSize, rSize, 0, 0, 0, w * 0.5, midY - rSize);
    c.arcTo(rSize, rSize, 0, 0, 0, w * 0.5 + rSize, midY);
    c.lineTo(w - rSize, midY);
    c.arcTo(rSize, rSize, 0, 0, 1, w, midY + rSize);
    c.stroke();
  }
}

/** mxShapeMockupLine (draw.io の shapes/mockup/mxMockupMarkup.js) */
class MockupLine extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(0, h * 0.5);
    c.lineTo(w, h * 0.5);
    c.stroke();
  }
}

/** mxShapeMockupScratchOut (draw.io の shapes/mockup/mxMockupMarkup.js) */
class MockupScratchOut extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(w * 0.038, h * 0.095);
    c.curveTo(w * 0.038, h * 0.095, w * 0.289, h * -0.045, w * 0.186, h * 0.05);
    c.curveTo(w * 0.084, h * 0.145, w * -0.046, h * 0.251, w * 0.072, h * 0.208);
    c.curveTo(w * 0.191, h * 0.164, w * 0.522, h * -0.09, w * 0.366, h * 0.062);
    c.curveTo(w * 0.21, h * 0.215, w * -0.094, h * 0.38, w * 0.108, h * 0.304);
    c.curveTo(w * 0.309, h * 0.228, w * 0.73, h * -0.126, w * 0.544, h * 0.096);
    c.curveTo(w * 0.358, h * 0.319, w * -0.168, h * 0.592, w * 0.108, h * 0.476);
    c.curveTo(w * 0.382, h * 0.36, w * 0.972, h * -0.138, w * 0.779, h * 0.114);
    c.curveTo(w * 0.585, h * 0.365, w * -0.12, h * 0.688, w * 0.071, h * 0.639);
    c.curveTo(w * 0.262, h * 0.59, w * 1.174, h * 0.012, w * 0.936, h * 0.238);
    c.curveTo(w * 0.699, h * 0.462, w * -0.216, h * 0.855, w * 0.085, h * 0.806);
    c.curveTo(w * 0.386, h * 0.758, w * 1.185, h * 0.26, w * 0.935, h * 0.534);
    c.curveTo(w * 0.685, h * 0.808, w * -0.186, h * 0.94, w * 0.236, h * 0.895);
    c.curveTo(w * 0.659, h * 0.85, w * 1.095, h * 0.608, w * 0.905, h * 0.769);
    c.curveTo(w * 0.715, h * 0.93, w * 0.286, h * 0.962, w * 0.661, h * 0.931);
    c.stroke();
  }
}

/** mxShapeMockupRedX (draw.io の shapes/mockup/mxMockupMarkup.js) */
class MockupRedX extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    c.begin();
    c.moveTo(w * 0.1, 0);
    c.lineTo(w * 0.5, h * 0.4);
    c.lineTo(w * 0.9, 0);
    c.lineTo(w, h * 0.1);
    c.lineTo(w * 0.6, h * 0.5);
    c.lineTo(w, h * 0.9);
    c.lineTo(w * 0.9, h);
    c.lineTo(w * 0.5, h * 0.6);
    c.lineTo(w * 0.1, h);
    c.lineTo(0, h * 0.9);
    c.lineTo(w * 0.4, h * 0.5);
    c.lineTo(0, h * 0.1);
    c.close();
    c.fillAndStroke();
  }
}

/** mxShapeMockupBreadcrumb (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupBreadcrumb extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let textStrings = safeDecode(this.gv('mainText', 'Layer 1, Layer 2, Layer 3').toString()).split(',');
    let fontColor = this.gc('textColor', '#666666');
    let selectedFontColor = this.gc('textColor2', '#008cff');
    let fontSize = this.gv('textSize', '17').toString();
    let separatorColor = this.gc('strokeColor', '#c4c4c4');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let labelOffset = 10;

    for (let i = 0; i < buttonNum; i++)
    {
      buttonWidths[i] = sizeForString(textStrings[i], fontSize, 'Helvetica').width;
      buttonTotalWidth += buttonWidths[i];
    }

    let trueH = Math.max(h, fontSize * 1.5, 20);
    let minW = 2 * labelOffset * buttonNum + buttonTotalWidth;
    let trueW = Math.max(w, minW);
    c.translate(x, y);
    c.setShadow(false);

    this.separators(c, trueW, trueH, buttonNum, buttonWidths, labelOffset, minW, separatorColor);
    let currWidth = 0;

    for (let i = 0; i < buttonNum; i++)
    {
      if (i + 1 === buttonNum)
      {
        c.setFontColor(selectedFontColor);
      }
      else
      {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  separators(c: ShapeCanvas, w: number, h: number, buttonNum: any, buttonWidths: any, labelOffset: any, minW: any, separatorColor: any) {
    //draw the button separators
    c.setStrokeColor(separatorColor);
    let midY = h * 0.5;
    let size = 5;
    c.begin();

    const pre1 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (let i = 1; i < buttonNum; i++)
    {
      let currWidth = pre1[i];

      currWidth = currWidth * w / minW;
      c.moveTo(currWidth - size * 0.5, midY - size);
      c.lineTo(currWidth + size * 0.5, midY);
      c.lineTo(currWidth - size * 0.5, midY + size);
    }
    c.stroke();
  }
  buttonText(c: ShapeCanvas, w: number, h: number, textString: any, buttonWidth: any, fontSize: any, minW: any, trueW: any) {
    c.begin();
    c.setFontSize(fontSize);
    c.text((w + buttonWidth * 0.5) * trueW / minW, h * 0.5, 0, 0, textString, 'center', 'middle');
  }
}

/** mxShapeMockupStepBar (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupStepBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let textStrings = safeDecode(this.gv('mainText', 'Step 1, Step 2, Step 3').toString()).split(',');
    let fontColor = this.gc('textColor', '#666666');
    let currColor = this.gc('textColor2', '#008cff');
    let fontSize = this.gv('textSize', '17').toString();
    let bgColor = this.gc('strokeColor', '#c4c4c4');
    let doneColor = this.gc('fillColor', '#666666');
    let buttonNum = textStrings.length;
    let buttonWidths = new Array(buttonNum);
    let buttonTotalWidth = 0;
    let labelOffset = 10;
    let selectedButton = -1;

    for (let i = 0; i < buttonNum; i++)
    {
      let buttonText = textStrings[i];

      if(buttonText.charAt(0) === '+')
      {
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

    this.stepLineBg(c, trueW, trueH, buttonNum, buttonWidths, labelOffset, minW, bgColor, fontSize, trueW);
    c.setShadow(false);

    this.stepLineFg(c, trueW, trueH, buttonNum, buttonWidths, labelOffset, minW, bgColor, doneColor, currColor, fontSize, trueW, selectedButton);
    let currWidth = 0;

    for (let i = 0; i < buttonNum; i++)
    {
      if (i >= selectedButton)
      {
        c.setFontColor(currColor);
      }
      else
      {
        c.setFontColor(fontColor);
      }

      currWidth = currWidth + labelOffset;
      this.buttonText(c, currWidth, trueH, textStrings[i], buttonWidths[i], fontSize, minW, trueW);
      currWidth = currWidth + buttonWidths[i] + labelOffset;
    }
  }
  stepLineBg(c: ShapeCanvas, w: number, _h: number, buttonNum: any, buttonWidths: any, labelOffset: any, minW: any, bgColor: any, fontSize: any, _trueW: any) {
    //draw the button separators
    c.setStrokeColor(bgColor);
    this.fillColor(c, bgColor);
    let midY = fontSize * 2;
    let size = 10;
    let startX = 0;
    let endX = 0;

    const pre2 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (let i = 0; i < buttonNum; i++)
    {
      let currWidth = pre2[i];

      currWidth += buttonWidths[i] * 0.5 + labelOffset;

      currWidth = currWidth * w / minW;

      if (i === 0)
      {
        startX = currWidth;
      }
      else if (i + 1 === buttonNum)
      {
        endX = currWidth;
      }

      c.begin();
      c.ellipse(currWidth - size, midY - size, 2 * size, 2 * size);
      c.fillAndStroke();
    }

    c.begin();
    c.rect(startX, midY - size * 0.2, endX - startX, size * 0.4);
    c.fillAndStroke();
  }
  stepLineFg(c: ShapeCanvas, w: number, _h: number, _buttonNum: any, buttonWidths: any, labelOffset: any, minW: any, bgColor: any, doneColor: any, currColor: any, fontSize: any, _trueW: any, selectedButton: any) {
    //draw the button separators
    c.setStrokeColor(doneColor);
    let midY = fontSize * 2;
    let size = 10 * 0.75;
    let startX = 0;
    let endX = 0;
    let strokeWidth = this.gv('strokeWidth', '1');

    const pre3 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (let i = 0; i <= selectedButton; i++)
    {
      let currWidth = pre3[i];

      currWidth += buttonWidths[i] * 0.5 + labelOffset;

      currWidth = currWidth * w / minW;

      if (i === 0)
      {
        startX = currWidth;
      }
      else if (i === selectedButton)
      {
        endX = currWidth;
      }
    }

    this.fillColor(c, doneColor);
    c.begin();
    c.rect(startX, midY - size * 0.15, endX - startX, size * 0.3);
    c.fill();
    this.fillColor(c, bgColor);

    const pre4 = prefixSums(buttonWidths.length, (j) => buttonWidths[j] + 2 * labelOffset); // 途中の和の表 (prefixSums.ts。毎回足し直すと、項目の数の 2 乗の手間)
    for (let i = 0; i <= selectedButton; i++)
    {
      let currWidth = pre4[i];

      currWidth += buttonWidths[i] * 0.5 + labelOffset;

      currWidth = currWidth * w / minW;

      if (i === 0)
      {
        startX = currWidth;
      }
      else if (i + 1 === selectedButton)
      {
        endX = currWidth;
      }

      if (i < selectedButton)
      {
        c.setStrokeWidth(strokeWidth);
        c.begin();
        c.ellipse(currWidth - size, midY - size, 2 * size, 2 * size);
        c.fillAndStroke();

        c.setStrokeWidth(strokeWidth * 0.5);
        c.begin();
        c.ellipse(currWidth - size * 0.6, midY - size * 0.6, 2 * size * 0.6, 2 * size * 0.6);
        c.fillAndStroke();
      }
      else
      {
        c.setStrokeWidth(strokeWidth);
        this.fillColor(c, bgColor);
        c.setStrokeColor(bgColor);
        c.begin();
        c.ellipse(currWidth - size / 0.75, midY - size / 0.75, 2 * size / 0.75, 2 * size / 0.75);
        c.fillAndStroke();

        c.setStrokeWidth(strokeWidth);
        this.fillColor(c, '#ffffff');
        c.setStrokeColor('#ffffff');
        c.begin();
        c.ellipse(currWidth - size, midY - size, 2 * size, 2 * size);
        c.fillAndStroke();

        this.fillColor(c, currColor);
        c.setStrokeColor(currColor);
        c.setStrokeWidth(strokeWidth * 0.5);
        c.begin();
        c.ellipse(currWidth - size * 0.7, midY - size * 0.7, 2 * size * 0.7, 2 * size * 0.7);
        c.fillAndStroke();
      }
    }
  }
  buttonText(c: ShapeCanvas, w: number, _h: number, textString: any, buttonWidth: any, fontSize: any, minW: any, trueW: any) {
    if(textString.charAt(0) === '+')
    {
      textString = textString.substring(1);
    }

    c.begin();
    c.setFontSize(fontSize);
    c.text((w + buttonWidth * 0.5) * trueW / minW, fontSize * 0.5, 0, 0, textString, 'center', 'middle');
  }
}

/** mxShapeMockupCoverFlow (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupCoverFlow extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);

    c.begin();
    c.moveTo(w * 0.0924, h * 0.07);
    c.lineTo(w * 0.005, h * 0.01);
    c.lineTo(w * 0.005, h * 0.99);
    c.lineTo(w * 0.0924, h * 0.93);

    c.moveTo(w * 0.1774, h * 0.09);
    c.lineTo(w * 0.0924, h * 0.01);
    c.lineTo(w * 0.0924, h * 0.99);
    c.lineTo(w * 0.1774, h * 0.91);

    c.moveTo(w * 0.3373, h * 0.22);
    c.lineTo(w * 0.1774, h * 0.01);
    c.lineTo(w * 0.1774, h * 0.99);
    c.lineTo(w * 0.3373, h * 0.78);

    c.moveTo(w * 0.912, h * 0.07);
    c.lineTo(w * 0.998, h * 0.01);
    c.lineTo(w * 0.998, h * 0.99);
    c.lineTo(w * 0.912, h * 0.93);

    c.moveTo(w * 0.8271, h * 0.09);
    c.lineTo(w * 0.912, h * 0.01);
    c.lineTo(w * 0.912, h * 0.99);
    c.lineTo(w * 0.8271, h * 0.91);

    c.moveTo(w * 0.6672, h * 0.22);
    c.lineTo(w * 0.8271, h * 0.01);
    c.lineTo(w * 0.8271, h * 0.99);
    c.lineTo(w * 0.6672, h * 0.78);

    c.moveTo(w * 0.3373, h * 0.005);
    c.lineTo(w * 0.3373, h * 0.995);
    c.lineTo(w * 0.6672, h * 0.995);
    c.lineTo(w * 0.6672, h * 0.005);
    c.close();
    c.fillAndStroke();
  }
}

/** mxShapeMockupScrollBar (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupScrollBar extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    h = 20;
    let buttonX = 20;
    w = Math.max(w, 2 * buttonX);

    c.translate(x, y);
    this.background(c, w, h, buttonX);
    c.setShadow(false);
    this.foreground(c, w, h, buttonX);
    // (ソースはここで this.barPos = 20 とする。動かす取っ手の既定の値で、描くことには使わない)
  }
  background(c: ShapeCanvas, w: number, h: number, buttonX: any) {
    c.rect(0, 0, w, h);
    c.fillAndStroke();
    c.begin();
    c.moveTo(buttonX, 0);
    c.lineTo(buttonX, h);
    c.moveTo(w - buttonX, 0);
    c.lineTo(w - buttonX, h);
    c.stroke();
  }
  foreground(c: ShapeCanvas, w: number, h: number, buttonX: any) {
    let barPos = this.gv('barPos', '20');
    let fillColor2 = this.gc('fillColor2', '#99ddff');
    let strokeColor2 = this.gc('strokeColor2', 'none');

    barPos = Math.max(0, barPos);
    barPos = Math.min(100, barPos);

    c.setStrokeColor(strokeColor2);
    this.fillColor(c, fillColor2);

    c.begin();
    c.moveTo(buttonX * 0.2, h * 0.5);
    c.lineTo(buttonX * 0.8, h * 0.2);
    c.lineTo(buttonX * 0.8, h * 0.8);
    c.close();
    c.moveTo(w - buttonX * 0.2, h * 0.5);
    c.lineTo(w - buttonX * 0.8, h * 0.2);
    c.lineTo(w - buttonX * 0.8, h * 0.8);
    c.close();
    c.fillAndStroke();

    //draw the handle based on arg.barPos
    let barWidth = 60;
    let barMin = buttonX;
    let barMax = w - buttonX;
    barWidth = Math.min(barWidth, barMax - barMin);
    let barCenterMin = barMin + barWidth / 2;
    let barCenterMax = barMax - barWidth / 2;
    let barCenterRange = barCenterMax - barCenterMin;
    let barCenterPos = barCenterRange * barPos / 100;
    let barStart = barMin + barCenterPos;

    c.roundrect(barStart, h * 0.15, barWidth, h * 0.7, 5, 5);
    c.fillAndStroke();
  }
}

/** mxShapeMockupPagination (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupPagination extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    let mainText = safeDecode(this.gv('linkText', '0-9 A B C D E F G H I J K L M N O P Q R S T U V X Y Z'));
    let textSize = this.gv('textSize', '17');
    let textColor = this.gc('textColor', '#0000ff');

    c.translate(x, y);
    let width = sizeForString(mainText, textSize, 'Helvetica').width;
    c.setStrokeColor(textColor);
    c.setFontSize(textSize);
    c.setFontColor(textColor);
    c.text(w * 0.5, h * 0.5, 0, 0, mainText, 'center', 'middle');
    c.begin();
    c.moveTo(w * 0.5 - width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.lineTo(w * 0.5 + width * 0.5, (h + parseInt(textSize, 10)) * 0.5);
    c.stroke();
  }
}

/** mxShapeMockupPageControl (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupPageControl extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);


    let fillColor = this.gc('fillColor', '#000000');
    let strokeColor = this.gc('strokeColor', '#000000');

    let rSize = Math.min(h * 0.5, w * 0.05);
    this.fillColor(c, strokeColor);
    c.ellipse(0, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    this.fillColor(c, fillColor);
    c.ellipse(w * 0.35 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w * 0.65 - rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
    c.ellipse(w - 2 * rSize, h * 0.5 - rSize, 2 * rSize, 2 * rSize);
    c.fill();
  }
}

/** mxShapeMockupMapNavigator (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupMapNavigator extends MockupShape {
  paintVertexShape(c: ShapeCanvas, x: number, y: number, w: number, h: number) {
    c.translate(x, y);
    this.background(c, w, h);
    c.setShadow(false);
    this.foreground(c, w, h);
  }
  background(c: ShapeCanvas, w: number, h: number) {
    c.ellipse(0, 0, w, h * 0.6);
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.35, h * 0.584);
    c.lineTo(w * 0.35, h * 0.95);
    c.arcTo(w * 0.083, h * 0.05, 0, 0, 0, w * 0.43, h);
    c.lineTo(w * 0.56, h);
    c.arcTo(w * 0.083, h * 0.05, 0, 0, 0, w * 0.65, h * 0.95);
    c.lineTo(w * 0.65, h * 0.584);
    c.fillAndStroke();
  }
  foreground(c: ShapeCanvas, w: number, h: number) {
    let fillColor2 = this.gc('fillColor2', '#99ddff');
    let strokeColor2 = this.gc('strokeColor2', 'none');
    let strokeColor3 = this.gc('strokeColor3', '#ffffff');

    this.fillColor(c, fillColor2);
    c.setStrokeColor(strokeColor2);
    c.ellipse(w * 0.4, h * 0.65, w * 0.2, h * 0.12);
    c.fillAndStroke();
    c.ellipse(w * 0.4, h * 0.85, w * 0.2, h * 0.12);
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.1806, h * 0.34);
    c.lineTo(w * 0.1357, h * 0.366);
    c.lineTo(w * 0.0228, h * 0.3);
    c.lineTo(w * 0.1357, h * 0.234);
    c.lineTo(w * 0.1806, h * 0.26);
    c.lineTo(w * 0.1142, h * 0.3);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.433, h * 0.108);
    c.lineTo(w * 0.3881, h * 0.08);
    c.lineTo(w * 0.4994, h * 0.012);
    c.lineTo(w * 0.6123, h * 0.08);
    c.lineTo(w * 0.5658, h * 0.108);
    c.lineTo(w * 0.4994, h * 0.068);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.8198, h * 0.262);
    c.lineTo(w * 0.868, h * 0.233);
    c.lineTo(w * 0.9776, h * 0.3);
    c.lineTo(w * 0.868, h * 0.367);
    c.lineTo(w * 0.8198, h * 0.341);
    c.lineTo(w * 0.8863, h * 0.3);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.5641, h * 0.493);
    c.lineTo(w * 0.6123, h * 0.522);
    c.lineTo(w * 0.4994, h * 0.588);
    c.lineTo(w * 0.3881, h * 0.521);
    c.lineTo(w * 0.4363, h * 0.493);
    c.lineTo(w * 0.4994, h * 0.533);
    c.close();
    c.fillAndStroke();

    c.begin();
    c.moveTo(w * 0.3333, h * 0.32);
    c.lineTo(w * 0.3333, h * 0.28);
    c.lineTo(w * 0.4163, h * 0.3);
    c.close();
    c.moveTo(w * 0.4662, h * 0.2);
    c.lineTo(w * 0.5326, h * 0.2);
    c.lineTo(w * 0.4994, h * 0.25);
    c.close()
    c.moveTo(w * 0.6654, h * 0.28);
    c.lineTo(w * 0.6654, h * 0.32);
    c.lineTo(w * 0.5824, h * 0.3);
    c.close();
    c.moveTo(w * 0.5326, h * 0.4);
    c.lineTo(w * 0.4662, h * 0.4);
    c.lineTo(w * 0.4994, h * 0.35);
    c.close();
    c.fillAndStroke();

    c.setStrokeWidth(2);
    c.setStrokeColor(strokeColor3);

    c.begin();
    c.moveTo(w * 0.5, h * 0.67);
    c.lineTo(w * 0.5, h * 0.75);
    c.moveTo(w * 0.43, h * 0.71);
    c.lineTo(w * 0.57, h * 0.71);
    c.moveTo(w * 0.43, h * 0.91);
    c.lineTo(w * 0.57, h * 0.91);
    c.stroke();
  }
}

/** mxShapeMockupNavigationAnchor (draw.io の shapes/mockup/mxMockupNavigation.js) */
class MockupNavigationAnchor extends MockupShape {
  paintVertexShape(_c: ShapeCanvas, _x: number, _y: number, _w: number, _h: number) {
  }
}

export const SHAPES_MOCKUP_IOS: Record<string, ShapePainter> = {
  'mxgraph.ios.iPhone': (c, w, h, e) => new MockupiPhone(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iBgFlat': (c, w, h, e) => new MockupiBgFlat(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iBgStriped': (c, w, h, e) => new MockupiBgStriped(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iBgMap': (c, w, h, e) => new MockupiBgMap(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iButtonBar': (c, w, h, e) => new MockupiButtonBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iAppBar': (c, w, h, e) => new MockupiAppBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iTopBar': (c, w, h, e) => new MockupiTopBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iTopBar2': (c, w, h, e) => new MockupiTopBar2(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iTopBarLocked': (c, w, h, e) => new MockupiTopBarLocked(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iButton': (c, w, h, e) => new MockupiButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iButtonBack': (c, w, h, e) => new MockupiButtonBack(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iButtonFw': (c, w, h, e) => new MockupiButtonForward(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iPrevNext': (c, w, h, e) => new MockupiPrevNextButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iTextInput': (c, w, h, e) => new MockupiTextInput(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iRadioGroup': (c, w, h, e) => new MockupiRadioGroup(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCheckboxGroup': (c, w, h, e) => new MockupiCheckboxGroup(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iComboBox': (c, w, h, e) => new MockupiComboBox(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iOnOffButton': (c, w, h, e) => new MockupiOnOffButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iAlertBox': (c, w, h, e) => new MockupiAlertBox(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iDialogBox': (c, w, h, e) => new MockupiDialogBox(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iLockButton': (c, w, h, e) => new MockupiLockButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iArrowIcon': (c, w, h, e) => new MockupiArrowIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iDeleteIcon': (c, w, h, e) => new MockupiDeleteIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iAddIcon': (c, w, h, e) => new MockupiAddIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iInfoIcon': (c, w, h, e) => new MockupiInfoIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iSortFindIcon': (c, w, h, e) => new MockupiSortFindIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCheckIcon': (c, w, h, e) => new MockupiCheckIcon(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iKeybLett': (c, w, h, e) => new MockupiKeybLetters(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iKeybNumb': (c, w, h, e) => new MockupiKeybNumbers(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iKeybSymb': (c, w, h, e) => new MockupiKeybSymbols(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iDeleteApp': (c, w, h, e) => new MockupiDeleteApp(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iDir': (c, w, h, e) => new MockupiDirection(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iLocBar': (c, w, h, e) => new MockupiLocationBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCallDialog': (c, w, h, e) => new MockupiCallDialog(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCallButtons': (c, w, h, e) => new MockupiCallButtons(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iOption': (c, w, h, e) => new MockupiOption(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iAlphaList': (c, w, h, e) => new MockupiAlphaList(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iHorButtonBar': (c, w, h, e) => new MockupiHorButtonBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iPin': (c, w, h, e) => new MockupiPin(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iVideoControls': (c, w, h, e) => new MockupiVideoControls(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iURLBar': (c, w, h, e) => new MockupiURLBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iSlider': (c, w, h, e) => new MockupiSlider(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iProgressBar': (c, w, h, e) => new MockupiProgressBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCloudProgressBar': (c, w, h, e) => new MockupiCloudProgressBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iDownloadBar': (c, w, h, e) => new MockupiDownloadBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iScreenNameBar': (c, w, h, e) => new MockupiScreenNameBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iIconGrid': (c, w, h, e) => new MockupiIconGrid(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCopy': (c, w, h, e) => new MockupiCopy(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iCopyArea': (c, w, h, e) => new MockupiCopyArea(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iHomePageControl': (c, w, h, e) => new MockupiHomePageControl(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iPageControl': (c, w, h, e) => new MockupiPageControl(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.iPad': (c, w, h, e) => new MockupiPad(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.rrect': (c, w, h, e) => new MockupRRect(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.topButton': (c, w, h, e) => new IosTopButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.bottomButton': (c, w, h, e) => new IosBottomButton(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.anchor': (c, w, h, e) => new IosAnchor(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.checkbox': (c, w, h, e) => new IosCheckbox(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.ios.fancyRRect': (c, w, h, e) => new MockupFancyRRect(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.markup.curlyBrace': (c, w, h, e) => new MockupCurlyBrace(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.markup.line': (c, w, h, e) => new MockupLine(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.markup.scratchOut': (c, w, h, e) => new MockupScratchOut(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.markup.redX': (c, w, h, e) => new MockupRedX(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.breadcrumb': (c, w, h, e) => new MockupBreadcrumb(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.stepBar': (c, w, h, e) => new MockupStepBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.coverFlow': (c, w, h, e) => new MockupCoverFlow(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.scrollBar': (c, w, h, e) => new MockupScrollBar(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.pagination': (c, w, h, e) => new MockupPagination(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.pageControl': (c, w, h, e) => new MockupPageControl(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.mapNavigator': (c, w, h, e) => new MockupMapNavigator(e).paintVertexShape(formatted(c), 0, 0, w, h),
  'mxgraph.mockup.navigation.anchor': (c, w, h, e) => new MockupNavigationAnchor(e).paintVertexShape(formatted(c), 0, 0, w, h),
};
