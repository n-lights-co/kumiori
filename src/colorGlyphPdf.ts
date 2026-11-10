/**
 * colorGlyphPdf — 色つきの字形を持つ書体 (colorGlyph.ts) の字を、PDF に書く。
 *
 * 書き方: Type 3 書体 (ISO 32000-1 §9.6.5)。字形ごとの手続き (CharProcs の内容ストリーム) を d0 で始め (字形が、形と色の両方を決める)、
 * その中で、層の塗り・網かけ (グラデーション)・画像 (ビットマップ) を描く。ページには、ふつうの文字として置く (Tf・Tm・Tj)。
 *  - 字は文字のまま: 取り出し・検索・選択が、ふつうの字と同じに効く (字形ごとの ToUnicode。字形と字の並びが対応しないときは /ActualText)
 *  - 同じ字形を何度使っても、手続き (と画像) は文書に 1 つ
 *  - 前景色 (文字の色。COLR の色の番号 0xFFFF) の塗りは、手続きの中で色を決めず、文字を置くときの塗りの色を引き継ぐ
 *    (d0 の手続きは、置くときの描画の状態を引き継ぐ)。特色・CMYK の文字の色も、そのまま使える
 *  - 色つきの表を持つ書体の、色つきでない字形 (輪郭だけ) も、同じ Type 3 書体に入れる (@pdf-lib/fontkit は、COLR・CBDT の書体の
 *    部分書体を作れないので、色つきの書体は、ふつうの埋め込みを通さない)
 * 選ばなかった形: (a) ページの中身にじかに図形を描く形は、字が文字として残らず、同じ字形を使うたびに図形を書く。(c) 形の XObject を
 * 字形ごとに作る形は、図形は 1 つで済むが、字を取り出せるようにするには、見えない文字を別に重ねる必要がある (輪郭の表を持たない書体は
 * 埋め込めないので、重ねる文字の書体が無い)。
 *
 * グラデーションは、網かけ (shading。ISO 32000-1 §8.7.4.3) を、字形の輪郭で切り抜いた中に sh で描く (模様 (pattern) の色空間は使わない:
 * 模様の行列がどの座標に掛かるかが、Type 3 の手続きの中では表示の実装によって違う)。線形は軸の網かけ (ShadingType 2)、放射は
 * 放射の網かけ (ShadingType 3。2 つの円の間)、掃引 (sweep) は三角形の網 (ShadingType 4) で近似する。
 * 止まり点の不透明度は、同じ形の灰色の網かけを輝度のソフトマスク (§11.6.5.2) にする。合成 (PaintComposite) は、透明のグループ
 * (§11.6.6) と、描画モード (§11.3.5)・不透明度のソフトマスクで表す。
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Ops, PDFPage, PDFRef, popGraphicsState, pushGraphicsState, type PDFImage } from 'pdf-lib';
import type { FontManager, LoadedFont } from './fontManager';
import { walkAreaTree } from './areaTree';
import { parseColor } from './color';
import { ITALIC_SLANT } from './paint';
import { invert, type Seg } from './matrix';
import { embedCmykImage } from './pdfLibPatches';
import { areaGlyphs, boxThrough, colorFontOf, COMPOSITE, paletteKey, plainStops, segsBox, sweepSampler, unrollStops, type Box, type ColorFill, type ColorFont, type ColorOp, type ColorStop, type Rgb } from './colorGlyph';
import { svgGlyphReader } from './colorGlyphSvg';
import type { XmlNode } from './svg';
import type { AreaTree, GlyphArea } from './types';

/** RGB → CMYK の変換 (PDF/X の出力。icc.ts の CmykConverter と同じ形) */
type ToCmyk = (r: number, g: number, b: number) => number[];

export interface PdfColorGlyphOptions {
  /** RGB の色を CMYK にして書く (PDF/X)。無ければ DeviceRGB */
  cmyk?: ToCmyk;
  /** 警告を足す配列 (PDF/X の透明など) */
  warnings?: string[];
  /** XML を読む関数 (SVG の表の字形を読むのに使う。無ければブラウザの DOMParser。どちらも無ければ、SVG だけの字形は輪郭で描く) */
  parseXml?: (xml: string) => XmlNode;
}

/** 1 つの Type 3 書体に入れる字形の符号: 0x21〜0xFF (空白 0x20 は、語の間隔 Tw が掛かるので使わない) */
const FIRST_CODE = 0x21;
const LAST_CODE = 0xff;

/** 数値を PDF の数にする (小数 3 桁。指数表記にしない) */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(3);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 行列・拡大率などの、細かい数 (小数 6 桁) */
function fine(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function pathOps(segs: readonly Seg[]): string {
  let s = '';
  for (const g of segs) {
    if (g.op === 'M') s += `${num(g.x)} ${num(g.y)} m\n`;
    else if (g.op === 'L') s += `${num(g.x)} ${num(g.y)} l\n`;
    else if (g.op === 'C') s += `${num(g.x1)} ${num(g.y1)} ${num(g.x2)} ${num(g.y2)} ${num(g.x)} ${num(g.y)} c\n`;
    else s += 'h\n';
  }
  return s;
}

function utf16Hex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return out;
}

/** 1 つの Type 3 書体 (字形 223 個まで) */
interface Type3Font {
  ref: PDFRef;
  /** 符号 − FIRST_CODE の順の、字形の手続き・送り・元の字 */
  procs: PDFRef[];
  widths: number[];
  texts: string[];
  bbox?: Box;
}

/** 書体・パレット (・文字の色) ごとの、字形 → 符号 の割り当て */
interface GlyphSet {
  font: LoadedFont;
  cf: ColorFont;
  /** 字形の番号 → [Type 3 書体, 符号] */
  codes: Map<number, { t3: Type3Font; code: number }>;
  fonts: Type3Font[];
}

/** 合成の種類 → PDF の描画モード (ISO 32000-1 §11.3.5 の、分けられる・分けられない描画モード) */
const BLEND_MODE: Record<number, string> = {
  [COMPOSITE.SCREEN]: 'Screen',
  [COMPOSITE.OVERLAY]: 'Overlay',
  [COMPOSITE.DARKEN]: 'Darken',
  [COMPOSITE.LIGHTEN]: 'Lighten',
  [COMPOSITE.COLOR_DODGE]: 'ColorDodge',
  [COMPOSITE.COLOR_BURN]: 'ColorBurn',
  [COMPOSITE.HARD_LIGHT]: 'HardLight',
  [COMPOSITE.SOFT_LIGHT]: 'SoftLight',
  [COMPOSITE.DIFFERENCE]: 'Difference',
  [COMPOSITE.EXCLUSION]: 'Exclusion',
  [COMPOSITE.MULTIPLY]: 'Multiply',
  [COMPOSITE.HSL_HUE]: 'Hue',
  [COMPOSITE.HSL_SATURATION]: 'Saturation',
  [COMPOSITE.HSL_COLOR]: 'Color',
  [COMPOSITE.HSL_LUMINOSITY]: 'Luminosity',
};

export class PdfColorGlyphs {
  private sets = new Map<string, GlyphSet>();
  /** Type 3 書体が共有する資源 (ExtGState・Shading・XObject)。名前は文書の中で 1 つずつ */
  private resources: PDFDict;
  private resourcesRef: PDFRef;
  private names = 0;
  private gstates = new Map<string, string>();
  private images = new Map<string, PDFImage>();
  private pageFonts = new WeakMap<PDFPage, Map<Type3Font, PDFName>>();
  private warned = new Set<string>();
  /** 透明 (不透明度・ソフトマスク・描画モード) を使ったか (PDF/X の確認用) */
  usedAlpha = false;

  private constructor(
    private pdf: PDFDocument,
    private fonts: FontManager,
    private opts: PdfColorGlyphOptions,
  ) {
    this.resources = pdf.context.obj({});
    this.resourcesRef = pdf.context.register(this.resources);
  }

  /**
   * 木が、色つきの表を持つ書体の字を含めば、その描き手を作る (含まなければ undefined。色つきの書体を使わない文書では、何もしない)。
   * ビットマップの字形 (CBDT・sbix) の画像は、ここで先に埋め込む (画像の埋め込みは非同期)
   */
  static async create(pdf: PDFDocument, tree: AreaTree, fonts: FontManager, opts: PdfColorGlyphOptions = {}): Promise<PdfColorGlyphs | undefined> {
    if (!fonts.all().some((f) => colorFontOf(f))) return undefined;
    const self = new PdfColorGlyphs(pdf, fonts, opts);
    const xml = opts.parseXml ?? (typeof DOMParser !== 'undefined' ? (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml') as unknown as XmlNode : undefined);
    const svgReader = xml && svgGlyphReader(xml);
    const pending = new Map<string, { kind: 'png' | 'jpg'; data: Uint8Array }>();
    let any = false;
    walkAreaTree(tree, (a) => {
      if (a.type !== 'glyph') return;
      const font = fonts.get(a.fontFamily, a.fontWeight);
      const cf = colorFontOf(font);
      if (!cf) return;
      any = true;
      if (svgReader && !cf.svgReader) cf.svgReader = svgReader;
      if (!cf.tables.cbdt && !cf.tables.sbix && !cf.tables.svg) return;
      const collect = (ops: readonly ColorOp[]) => {
        for (const o of ops) {
          if (o.op === 'image') pending.set(self.imageKey(o.data), { kind: o.kind, data: o.data });
          else if (o.op === 'clip' || o.op === 'transform') collect(o.ops);
          else if (o.op === 'composite') (collect(o.source), collect(o.backdrop));
        }
      };
      for (const { id } of areaGlyphs(a, font)) collect(cf.glyph(id, a.fontPalette)?.ops ?? []);
    });
    if (!any) return undefined;
    let alpha = false;
    for (const [key, { kind, data }] of pending) {
      try {
        const cmyk = opts.cmyk ? await embedCmykImage(pdf, data, kind, opts.cmyk) : undefined;
        if (cmyk?.hasAlpha) alpha = true;
        self.images.set(key, cmyk?.image ?? (kind === 'png' ? await pdf.embedPng(data) : await pdf.embedJpg(data)));
      } catch (e) {
        console.warn('PDF: 色つきの字形の画像を埋め込めません', e);
      }
    }
    if (alpha) self.usedAlpha = true;
    return self;
  }

  /** 字の領域 g を、この描き手が描くか (書体が色つきの表を持つか) */
  handles(g: GlyphArea): boolean {
    return !!colorFontOf(this.fonts.get(g.fontFamily, g.fontWeight));
  }

  /** 画像のバイト列ごとの鍵 (同じ画像の命令は、同じバイト列の物を指す。ColorFont が字形ごとに覚えている) */
  private imageKey(data: Uint8Array): string {
    let id = this.dataIds.get(data);
    if (id === undefined) this.dataIds.set(data, (id = this.names++));
    return String(id);
  }
  private dataIds = new WeakMap<Uint8Array, number>();

  /**
   * 字の領域 g (左上が Sheet の (x, y)) を描く命令。この描き手が描かない字 (色つきの表の無い書体) は undefined。
   * H はページの高さ、fillOps は文字の色を塗りの色にする命令 (特色・CMYK を含む。pdfRenderer.ts の colorOps)
   */
  draw(g: GlyphArea, x: number, y: number, page: PDFPage, H: number, fillOps: (css: string) => PDFOperator[]): PDFOperator[] | undefined {
    const font = this.fonts.get(g.fontFamily, g.fontWeight);
    const cf = colorFontOf(font);
    if (!cf) return undefined;
    const glyphs = areaGlyphs(g, font);
    if (!glyphs.length) return [];
    // 文字の色 (前景色)。字形の手続きの中のグラデーションに前景色を使う字形は、色ごとに手続きを分ける
    const pc = parseColor(g.color);
    const fg: Rgb = pc.mode === 'rgb' ? [pc.r, pc.g, pc.b] : [(1 - pc.c) * (1 - pc.k), (1 - pc.m) * (1 - pc.k), (1 - pc.y) * (1 - pc.k)];
    const phi = (-g.rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const m = [g.scaleX * cos, g.scaleX * sin, (g.italic ? g.scaleX * cos * ITALIC_SLANT : 0) - sin, (g.italic ? g.scaleX * sin * ITALIC_SLANT : 0) + cos, x + g.baselineX, H - (y + g.baselineY)];
    const k = g.fontSize / cf.unitsPerEm;
    const text = g.text.replace(/ /g, ' ');
    const chars = [...text];
    // 字形ごとの元の字 (ToUnicode): 字形と字が同じ数なら 1 対 1、字形が 1 つなら並びの全体、ほかは最初の字形に全体
    const textOf = (i: number) => (chars.length === glyphs.length ? chars[i] : i === 0 ? text : '');
    const placed = glyphs.map((gl, i) => ({ ...gl, ...this.codeOf(font, cf, gl.id, g, fg, textOf(i)) }));
    // 字形に登録された字 (最初に使ったときの字) をつないでも元の字の並びにならないときは、/ActualText で元の字の並びを付ける
    // (ISO 32000-1 §14.9.4。印の付いた内容は、テキストの区切りの中に置ける)
    // 字の無い字形 (並びの 2 つ目以降の字形) があるときも付ける: ToUnicode に無い符号を、符号の値のままの字として返す取り出し方がある
    const registered = placed.map((p) => p.t3.texts[p.code - FIRST_CODE]);
    const needActual = registered.join('') !== text || (registered.length > 1 && registered.some((t) => !t));
    const out: PDFOperator[] = [pushGraphicsState(), ...fillOps(g.color), PDFOperator.of(Ops.BeginText)];
    if (needActual) out.push(PDFOperator.of('BDC' as never, ['/Span', `<</ActualText <FEFF${utf16Hex(text)}>>>`] as never));
    let current: Type3Font | undefined;
    for (const p of placed) {
      if (p.t3 !== current) {
        current = p.t3;
        out.push(PDFOperator.of(Ops.SetFontAndSize, [this.fontName(page, p.t3), PDFNumber.of(g.fontSize)]));
      }
      const px = m[4] + m[0] * p.u * k + m[2] * p.v * k;
      const py = m[5] + m[1] * p.u * k + m[3] * p.v * k;
      out.push(PDFOperator.of(Ops.SetTextMatrix, [fine(m[0]), fine(m[1]), fine(m[2]), fine(m[3]), num(px), num(py)] as never));
      out.push(PDFOperator.of(Ops.ShowText, [PDFHexString.of(p.code.toString(16).toUpperCase().padStart(2, '0'))]));
    }
    if (needActual) out.push(PDFOperator.of('EMC' as never));
    out.push(PDFOperator.of(Ops.EndText), popGraphicsState());
    return out;
  }

  /** ページの資源に Type 3 書体を登録して、その名前を返す (ページごと・書体ごとに 1 つ) */
  private fontName(page: PDFPage, t3: Type3Font): PDFName {
    let names = this.pageFonts.get(page);
    if (!names) this.pageFonts.set(page, (names = new Map()));
    let name = names.get(t3);
    if (!name) names.set(t3, (name = page.node.newFontDictionary('KmC', t3.ref)));
    return name;
  }

  /** 字形の符号 (と、それを入れた Type 3 書体)。初めての字形なら、手続きを作って登録する */
  private codeOf(font: LoadedFont, cf: ColorFont, gid: number, g: GlyphArea, fg: Rgb, text: string): { t3: Type3Font; code: number } {
    const glyph = cf.glyph(gid, g.fontPalette);
    const pal = paletteKey(g.fontPalette);
    // 手続きは、書体・パレットごと。グラデーションに前景色を使う字形だけ、文字の色ごと
    const key = `${font.key}\u0000${pal}${glyph?.foregroundInGradient ? `\u0000${fg.map((c) => Math.round(c * 255)).join(',')}` : ''}`;
    let set = this.sets.get(key);
    if (!set) this.sets.set(key, (set = { font, cf, codes: new Map(), fonts: [] }));
    let hit = set.codes.get(gid);
    if (hit) return hit;
    let t3 = set.fonts[set.fonts.length - 1];
    if (!t3 || t3.procs.length > LAST_CODE - FIRST_CODE) set.fonts.push((t3 = { ref: this.pdf.context.nextRef(), procs: [], widths: [], texts: [] }));
    const fk = font.fk as unknown as { getGlyph(id: number): { advanceWidth: number } };
    let width = 0;
    try {
      width = fk.getGlyph(gid).advanceWidth || 0;
    } catch {
      width = 0;
    }
    // 字形の手続き: 「送り 0 d0」で始め (ISO 32000-1 §9.6.5 の Table 113: d0 は、形と色の両方を手続きが決める字形)、中身を描く
    let body: string;
    let box: Box | undefined;
    if (glyph) {
      box = glyph.bbox;
      const clip = glyph.clip ? `${num(box[0])} ${num(box[1])} ${num(box[2] - box[0])} ${num(box[3] - box[1])} re W n\n` : '';
      body = clip + this.emit(glyph.ops, { cf, fg, box: this.pad(box) });
    } else {
      // 色つきでない字形: 輪郭を、文字の色 (置くときの塗りの色) で塗る
      const outline = cf.outline(gid);
      box = segsBox(outline);
      body = outline.length ? `${pathOps(outline)}f\n` : '';
    }
    const proc = this.pdf.context.register(this.pdf.context.flateStream(`${num(width)} 0 d0\n${body}`));
    t3.procs.push(proc);
    t3.widths.push(width);
    t3.texts.push(text);
    if (box) t3.bbox = t3.bbox ? [Math.min(t3.bbox[0], box[0]), Math.min(t3.bbox[1], box[1]), Math.max(t3.bbox[2], box[2]), Math.max(t3.bbox[3], box[3])] : [...box];
    hit = { t3, code: FIRST_CODE + t3.procs.length - 1 };
    set.codes.set(gid, hit);
    return hit;
  }

  /** 範囲を少し広げる (切り抜きの縁の、位置の丸めの分) */
  private pad(b: Box): Box {
    const e = Math.max(b[2] - b[0], b[3] - b[1], 1) * 0.01 + 1;
    return [b[0] - e, b[1] - e, b[2] + e, b[3] + e];
  }

  private resource(kind: 'ExtGState' | 'Shading' | 'XObject', prefix: string, value: PDFRef | PDFDict): string {
    const ctx = this.pdf.context;
    let dict = this.resources.lookupMaybe(PDFName.of(kind), PDFDict);
    if (!dict) {
      dict = ctx.obj({});
      this.resources.set(PDFName.of(kind), dict);
    }
    const name = `${prefix}${this.names++}`;
    dict.set(PDFName.of(name), value);
    return name;
  }

  /** ExtGState (不透明度・描画モード) の名前 */
  private gstate(key: string, dict: Record<string, unknown>): string {
    let name = this.gstates.get(key);
    if (!name) this.gstates.set(key, (name = this.resource('ExtGState', 'G', this.dict({ Type: 'ExtGState', ...dict }))));
    this.usedAlpha = true;
    return name;
  }

  /** 辞書を作る (値の文字列は名前になる) */
  private dict(o: Record<string, unknown>): PDFDict {
    return this.pdf.context.obj(o as never) as unknown as PDFDict;
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  /** 色を塗りの色にする命令 (前景色は、置くときの色を引き継ぐので、何も書かない) */
  private setColor(rgb: Rgb | null, stroke = false): string {
    if (!rgb) return '';
    const cmyk = this.opts.cmyk;
    if (!cmyk) return rgb[0] === rgb[1] && rgb[1] === rgb[2] ? `${num(rgb[0])} ${stroke ? 'G' : 'g'}\n` : `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} ${stroke ? 'RG' : 'rg'}\n`;
    // PDF/X: 灰色は DeviceGray のまま、ほかは CMYK (pdfRenderer.ts の toPdfColor と同じ)
    if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) return `${num(rgb[0])} ${stroke ? 'G' : 'g'}\n`;
    return `${cmyk(rgb[0], rgb[1], rgb[2]).map(num).join(' ')} ${stroke ? 'K' : 'k'}\n`;
  }

  /** 透明のグループの形の XObject (ISO 32000-1 §11.6.6) を作って、その名前を返す */
  private group(content: string, box: Box, gray = false): string {
    const ctx = this.pdf.context;
    const form = ctx.register(
      ctx.flateStream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: box,
        Resources: this.resourcesRef,
        Group: { S: 'Transparency', I: true, CS: gray ? 'DeviceGray' : this.opts.cmyk ? 'DeviceCMYK' : 'DeviceRGB' },
      } as never),
    );
    return this.resource('XObject', 'X', form);
  }

  /** 命令の並びを、内容ストリームの文字列にする。st.box は、いまの切り抜きの範囲 (いまの座標) */
  private emit(ops: readonly ColorOp[], st: { cf: ColorFont; fg: Rgb; box: Box }): string {
    let s = '';
    for (const o of ops) {
      if (o.op === 'fill') {
        if (o.fill.kind === 'solid') {
          const c = o.fill.color;
          if (c.a <= 0) continue;
          // 色・不透明度は q…Q の中で決める (後の、前景色を引き継ぐ塗りに残さない)
          const wrap = c.rgb !== null || c.a < 1;
          s += `${wrap ? 'q\n' : ''}${c.a < 1 ? `/${this.gstate(`a${c.a.toFixed(4)}`, { ca: c.a, CA: c.a })} gs\n` : ''}${this.setColor(c.rgb)}${pathOps(o.path)}${o.evenOdd ? 'f*' : 'f'}\n${wrap ? 'Q\n' : ''}`;
        } else {
          const pb = segsBox(o.path);
          if (!pb) continue;
          s += `q\n${pathOps(o.path)}${o.evenOdd ? 'W*' : 'W'} n\n${this.gradient(o.fill, { ...st, box: this.pad(pb) })}Q\n`;
        }
      } else if (o.op === 'clip') {
        const pb = segsBox(o.path);
        if (!pb) continue;
        s += `q\n${pathOps(o.path)}${o.evenOdd ? 'W*' : 'W'} n\n${this.emit(o.ops, { ...st, box: this.pad(pb) })}Q\n`;
      } else if (o.op === 'paint') {
        if (o.fill.kind === 'solid') {
          const c = o.fill.color;
          if (c.a <= 0) continue;
          const b = st.box;
          s += `q\n${c.a < 1 ? `/${this.gstate(`a${c.a.toFixed(4)}`, { ca: c.a, CA: c.a })} gs\n` : ''}${this.setColor(c.rgb)}${num(b[0])} ${num(b[1])} ${num(b[2] - b[0])} ${num(b[3] - b[1])} re f\nQ\n`;
        } else s += `q\n${this.gradient(o.fill, st)}Q\n`;
      } else if (o.op === 'transform') {
        const inv = invert(o.m, 1e-12);
        // 逆の無い変換 (面積が 0 になる) の中身は、見えない
        if (!inv) continue;
        s += `q\n${o.m.map(fine).join(' ')} cm\n${this.emit(o.ops, { ...st, box: boxThrough(st.box, inv) })}Q\n`;
      } else if (o.op === 'composite') s += this.composite(o, st);
      else if (o.op === 'image') {
        const img = this.images.get(this.imageKey(o.data));
        if (!img) continue;
        // 画像の XObject は単位正方形 (左下が原点) なので、(幅, 高さ) に伸ばして左下 (x, y) に置く
        s += `q\n${num(o.w)} 0 0 ${num(o.h)} ${num(o.x)} ${num(o.y)} cm\n/${this.imageName(img)} Do\nQ\n`;
      } else if (o.op === 'stroke') {
        // 線 (SVG の表の字形)。グラデーションの線は、最初の止まり点の色で描く
        const c = o.fill.kind === 'solid' ? o.fill.color : o.fill.stops[0]?.color;
        if (!c || c.a <= 0 || o.width <= 0) continue;
        s += `q\n${c.a < 1 ? `/${this.gstate(`a${c.a.toFixed(4)}`, { ca: c.a, CA: c.a })} gs\n` : ''}${c.rgb ? this.setColor(c.rgb, true) : this.setColor(st.fg, true)}${num(o.width)} w ${o.cap} J ${o.join} j ${num(o.miter)} M\n${o.dash?.length ? `[${o.dash.map(num).join(' ')}] ${num(o.dashOffset ?? 0)} d\n` : ''}${pathOps(o.path)}S\nQ\n`;
      }
    }
    return s;
  }

  private imageNames = new Map<PDFImage, string>();
  private imageName(img: PDFImage): string {
    let name = this.imageNames.get(img);
    if (!name) this.imageNames.set(img, (name = this.resource('XObject', 'I', img.ref)));
    return name;
  }

  /**
   * 合成 (COLR の PaintComposite)。backdrop と source を、それぞれ透明のグループにして重ねる。
   *  - 描画モードのあるもの (screen〜luminosity): グループの中で、backdrop の上に source を、その描画モードで描く (グループの外の
   *    下地とは混ざらない = 切り離したグループ。COLR は、2 つを別々に描いてから混ぜる)
   *  - Porter-Duff の種類: 相手の不透明度を、不透明度のソフトマスク (ISO 32000-1 §11.6.5.2 の S = Alpha。「相手の無い所」は、
   *    伝達関数 TR で反転する) にする。SRC_ATOP・DEST_ATOP・XOR は、不透明度が 0 か 1 の絵では同じ結果、半透明の重なりでは近似。
   *    PLUS (足し算) は PDF に無いので、ふつうの重ね (SRC_OVER) で描く
   */
  private composite(o: Extract<ColorOp, { op: 'composite' }>, st: { cf: ColorFont; fg: Rgb; box: Box }): string {
    const box = st.box;
    const form = (ops: readonly ColorOp[]) => this.group(this.emit(ops, st), box);
    const mask = (ops: readonly ColorOp[], inverted: boolean) => {
      const ctx = this.pdf.context;
      const g = ctx.register(
        ctx.flateStream(this.emit(ops, st), { Type: 'XObject', Subtype: 'Form', BBox: box, Resources: this.resourcesRef, Group: { S: 'Transparency', I: true, CS: this.opts.cmyk ? 'DeviceCMYK' : 'DeviceRGB' } } as never),
      );
      const dict: Record<string, unknown> = { Type: 'Mask', S: 'Alpha', G: g };
      if (inverted) dict.TR = { FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 };
      this.usedAlpha = true;
      return this.resource('ExtGState', 'G', this.dict({ Type: 'ExtGState', SMask: dict }));
    };
    const masked = (what: readonly ColorOp[], by: readonly ColorOp[], inverted: boolean) => `q\n/${mask(by, inverted)} gs\n/${form(what)} Do\nQ\n`;
    const blend = BLEND_MODE[o.mode];
    if (blend) {
      const inner = `${this.emit(o.backdrop, st)}q\n/${this.gstate(`b${blend}`, { BM: blend })} gs\n/${form(o.source)} Do\nQ\n`;
      return `/${this.group(inner, box)} Do\n`;
    }
    switch (o.mode) {
      case COMPOSITE.SRC_IN:
        return masked(o.source, o.backdrop, false);
      case COMPOSITE.DEST_IN:
        return masked(o.backdrop, o.source, false);
      case COMPOSITE.SRC_OUT:
        return masked(o.source, o.backdrop, true);
      case COMPOSITE.DEST_OUT:
        return masked(o.backdrop, o.source, true);
      case COMPOSITE.SRC_ATOP:
        return `/${form(o.backdrop)} Do\n${masked(o.source, o.backdrop, false)}`;
      case COMPOSITE.DEST_ATOP:
        return `/${form(o.source)} Do\n${masked(o.backdrop, o.source, false)}`;
      case COMPOSITE.XOR:
        return masked(o.source, o.backdrop, true) + masked(o.backdrop, o.source, true);
      default:
        this.warnOnce('plus', 'PDF: 色つきの字形の合成の種類 PLUS (足し算) は、ふつうの重ねで描きます');
        return `/${form(o.backdrop)} Do\n/${form(o.source)} Do\n`;
    }
  }

  /** 止まり点の値 (色か不透明度) の関数 (ISO 32000-1 §7.10: 2 点なら指数の補間 (型 2)、3 点以上なら、つなぎ合わせ (型 3)) */
  private stopFunction(stops: Array<{ offset: number }>, value: (i: number) => number[]): PDFDict {
    const ctx = this.pdf.context;
    const list = stops.map((s, i) => ({ offset: s.offset, v: value(i) }));
    // Bounds は増加の順でなければならないので、同じ位置の止まり点 (色の段差) は、後ろをわずかに進める (pdfRenderer.ts の shading と同じ)
    for (let k = 1; k < list.length; k++) {
      if (list[k].offset > list[k - 1].offset) continue;
      const next = list[k - 1].offset + 1e-5;
      if (next <= 1) list[k] = { ...list[k], offset: next };
      else list.splice(--k, 1);
    }
    if (list[0].offset > 0) list.unshift({ ...list[0], offset: 0 });
    if (list[list.length - 1].offset < 1) list.push({ ...list[list.length - 1], offset: 1 });
    const seg = (a: number[], b: number[]) => ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: a, C1: b, N: 1 });
    if (list.length === 2) return seg(list[0].v, list[1].v);
    return ctx.obj({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: list.slice(1).map((s, k) => seg(list[k].v, s.v)),
      Bounds: list.slice(1, -1).map((s) => s.offset),
      Encode: list.slice(1).flatMap(() => [0, 1]),
    });
  }

  /** 色の値 (DeviceRGB か、PDF/X なら DeviceCMYK) */
  private colorValue(rgb: Rgb): number[] {
    const cmyk = this.opts.cmyk;
    if (!cmyk) return rgb;
    return rgb[0] === rgb[1] && rgb[1] === rgb[2] ? [0, 0, 0, 1 - rgb[0]] : cmyk(rgb[0], rgb[1], rgb[2]);
  }

  /** グラデーションを、いまの切り抜きの中に描く命令 (呼び出し側が q…Q で囲む) */
  private gradient(fill: Exclude<ColorFill, { kind: 'solid' }>, st: { cf: ColorFont; fg: Rgb; box: Box }): string {
    const ctx = this.pdf.context;
    const b = st.box;
    const corners: Array<[number, number]> = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]];
    const space = this.opts.cmyk ? 'DeviceCMYK' : 'DeviceRGB';
    /** 色の網かけと、(不透明度が一様でなければ) 不透明度の網かけを作って描く */
    const paint = (stops: ColorStop[], shading: (fn: PDFDict, cs: string) => PDFDict | PDFRef): string => {
      const plain = plainStops(stops, st.fg);
      if (!plain.length) return '';
      const alphas = plain.map((p) => p.a);
      const minA = Math.min(...alphas);
      const maxA = Math.max(...alphas);
      if (maxA <= 0) return '';
      const color = this.resource('Shading', 'S', shading(this.stopFunction(plain, (i) => this.colorValue(plain[i].rgb)), space));
      let pre = '';
      if (maxA - minA < 1e-4) {
        if (maxA < 1) pre = `/${this.gstate(`a${maxA.toFixed(4)}`, { ca: maxA, CA: maxA })} gs\n`;
      } else {
        // 止まり点の不透明度: 不透明度を灰色にした同じ形の網かけを、形の XObject に描き、輝度のソフトマスクにする (ISO 32000-1 §11.6.5.2)。
        // ソフトマスクの形の XObject の座標は、gs を実行したときの座標 (いまの座標) になる
        const gray = this.resource('Shading', 'S', shading(this.stopFunction(plain, (i) => [plain[i].a]), 'DeviceGray'));
        const g = ctx.register(ctx.flateStream(`/${gray} sh\n`, { Type: 'XObject', Subtype: 'Form', BBox: b, Resources: this.resourcesRef, Group: { S: 'Transparency', CS: 'DeviceGray' } } as never));
        this.usedAlpha = true;
        pre = `/${this.resource('ExtGState', 'G', this.dict({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: g } }))} gs\n`;
      }
      return `${pre}/${color} sh\n`;
    };
    if (fill.kind === 'linear') {
      const vx = fill.x1 - fill.x0;
      const vy = fill.y1 - fill.y0;
      const len2 = vx * vx + vy * vy;
      if (!(len2 > 0)) return '';
      // 繰り返し・折り返し: 切り抜きの範囲の角を、色の線の位置 t に直し、その範囲を覆うだけ色の線を並べる
      const ts = corners.map(([px, py]) => ((px - fill.x0) * vx + (py - fill.y0) * vy) / len2);
      const { stops, lo, hi } = unrollStops(fill.stops, fill.extend, Math.min(...ts), Math.max(...ts));
      const coords = [fill.x0 + vx * lo, fill.y0 + vy * lo, fill.x0 + vx * hi, fill.y0 + vy * hi];
      return paint(stops, (fn, cs) => ctx.obj({ ShadingType: 2, ColorSpace: cs, Coords: coords, Function: fn, Extend: [true, true] }));
    }
    if (fill.kind === 'radial') {
      const dx = fill.x1 - fill.x0;
      const dy = fill.y1 - fill.y0;
      const dr = fill.r1 - fill.r0;
      // 繰り返し・折り返し: 切り抜きの範囲に届きうる円の位置の範囲 (中心の動きか半径の変化の大きい方で見積もる)
      const far = Math.max(...corners.map(([px, py]) => Math.hypot(px - fill.x0, py - fill.y0)));
      const step = Math.max(Math.abs(dr), Math.hypot(dx, dy));
      const reach = step > 0 ? (far + fill.r0) / step + 2 : 1;
      let { stops, lo, hi } = unrollStops(fill.stops, fill.extend, -reach, reach);
      // 半径が負になる位置は描かれないので、範囲を、半径が 0 になる位置までにする
      if (dr !== 0 && (lo !== 0 || hi !== 1)) {
        const tip = -fill.r0 / dr;
        const cut = (from: number, to: number) => {
          const a = (from - lo) / (hi - lo);
          const z = (to - lo) / (hi - lo);
          const plain = stops.filter((s) => s.offset >= a && s.offset <= z).map((s) => ({ offset: (s.offset - a) / (z - a), color: s.color }));
          return plain.length >= 2 ? plain : stops;
        };
        if (dr > 0 && lo < tip) {
          const from = Math.ceil(tip);
          const next = cut(from, hi);
          if (next !== stops) [stops, lo] = [next, from];
        } else if (dr < 0 && hi > tip) {
          const to = Math.floor(tip);
          const next = cut(lo, to);
          if (next !== stops) [stops, hi] = [next, to];
        }
      }
      const at = (t: number) => [fill.x0 + dx * t, fill.y0 + dy * t, Math.max(fill.r0 + dr * t, 0)];
      const coords = [...at(lo), ...at(hi)];
      return paint(stops, (fn, cs) => ctx.obj({ ShadingType: 3, ColorSpace: cs, Coords: coords, Function: fn, Extend: [true, true] }));
    }
    // 掃引 (sweep): PDF に同じ網かけが無いので、中心のまわりの細い三角形 (1° ごと。止まり点の角度でも区切る) の網 (ShadingType 4。
    // ISO 32000-1 §8.7.4.5.5) で近似する。三角形の外の 2 つの頂点に、その角度の色を置く。描くのは 0°〜360° (COLR の「Sweep gradients」)
    const sweep = sweepSampler(fill, st.fg);
    if (!sweep) return '';
    const { sample } = sweep;
    const angles = new Set<number>(sweep.angles);
    for (let d = 0; d <= 360; d++) angles.add(d);
    const sorted = [...angles].sort((p, q) => p - q);
    const radius = Math.max(...corners.map(([px, py]) => Math.hypot(px - fill.cx, py - fill.cy))) * 1.05 + 1;
    const lim = [fill.cx - radius, fill.cx + radius, fill.cy - radius, fill.cy + radius];
    const mesh = (cs: string, value: (c: { rgb: Rgb; a: number }) => number[]): PDFRef => {
      const comps = value(sample(0, 1)).length;
      const size = 1 + 8 + comps;
      const data = new Uint8Array((sorted.length - 1) * 3 * size);
      const dv = new DataView(data.buffer);
      let at = 0;
      const put = (px: number, py: number, v: number[]) => {
        dv.setUint8(at, 0);
        dv.setUint32(at + 1, Math.round(((px - lim[0]) / (lim[1] - lim[0])) * 0xffffffff));
        dv.setUint32(at + 5, Math.round(((py - lim[2]) / (lim[3] - lim[2])) * 0xffffffff));
        v.forEach((c, k) => dv.setUint8(at + 9 + k, Math.round(Math.min(Math.max(c, 0), 1) * 255)));
        at += size;
      };
      for (let i = 0; i + 1 < sorted.length; i++) {
        const a0 = sorted[i];
        const a1 = sorted[i + 1];
        const c0 = value(sample(a0, 1));
        const c1 = value(sample(a1, -1));
        const rad = (d: number) => (d * Math.PI) / 180;
        put(fill.cx, fill.cy, c0.map((c, k) => (c + c1[k]) / 2));
        put(fill.cx + radius * Math.cos(rad(a0)), fill.cy + radius * Math.sin(rad(a0)), c0);
        put(fill.cx + radius * Math.cos(rad(a1)), fill.cy + radius * Math.sin(rad(a1)), c1);
      }
      return ctx.register(
        ctx.flateStream(data, { ShadingType: 4, ColorSpace: cs, BitsPerCoordinate: 32, BitsPerComponent: 8, BitsPerFlag: 8, Decode: [lim[0], lim[1], lim[2], lim[3], ...Array.from({ length: comps }, () => [0, 1]).flat()] } as never),
      );
    };
    const color = this.resource('Shading', 'S', mesh(space, (c) => this.colorValue(c.rgb)));
    const alphas = sorted.flatMap((d) => [sample(d, -1).a, sample(d, 1).a]);
    let pre = '';
    if (Math.max(...alphas) <= 0) return '';
    if (Math.max(...alphas) - Math.min(...alphas) < 1e-4) {
      if (alphas[0] < 1) pre = `/${this.gstate(`a${alphas[0].toFixed(4)}`, { ca: alphas[0], CA: alphas[0] })} gs\n`;
    } else {
      const gray = this.resource('Shading', 'S', mesh('DeviceGray', (c) => [c.a]));
      const g = ctx.register(ctx.flateStream(`/${gray} sh\n`, { Type: 'XObject', Subtype: 'Form', BBox: b, Resources: this.resourcesRef, Group: { S: 'Transparency', CS: 'DeviceGray' } } as never));
      this.usedAlpha = true;
      pre = `/${this.resource('ExtGState', 'G', this.dict({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: g } }))} gs\n`;
    }
    return `${pre}/${color} sh\n`;
  }

  /**
   * Type 3 書体の辞書を書く (ページを描き終えてから 1 度だけ呼ぶ)。
   * ISO 32000-1 §9.6.5 の Table 112: FontBBox・FontMatrix (字形の座標 → 文字の座標。書体の単位なので 1/unitsPerEm)・CharProcs・
   * Encoding (符号 → 字形の名前の Differences)・FirstChar・LastChar・Widths (字形の座標での送り)・Resources・ToUnicode (§9.10.3)
   */
  finish() {
    const ctx = this.pdf.context;
    for (const set of this.sets.values()) {
      const upm = set.cf.unitsPerEm;
      for (const t3 of set.fonts) {
        const n = t3.procs.length;
        const names = t3.procs.map((_, i) => `g${i}`);
        const charProcs = ctx.obj({});
        t3.procs.forEach((ref, i) => charProcs.set(PDFName.of(names[i]), ref));
        // 元の字 (ToUnicode の CMap。1 バイトの符号 → UTF-16BE の字の並び)。字の無い字形 (並びの 2 つ目以降) は書かない
        const mapped = t3.texts.map((t, i) => ({ code: FIRST_CODE + i, t })).filter((e) => e.t);
        let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n';
        for (let i = 0; i < mapped.length; i += 100) {
          const part = mapped.slice(i, i + 100);
          cmap += `${part.length} beginbfchar\n${part.map((e) => `<${e.code.toString(16).toUpperCase().padStart(2, '0')}> <${utf16Hex(e.t)}>`).join('\n')}\nendbfchar\n`;
        }
        cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
        // 字の高さの目安に、書体の上下 (ascent・descent) も枠に含める (字を取り出す側が、行の高さを FontBBox から見積もる)
        const asc = (set.font.ascent ?? 0.88) * upm;
        const desc = -(set.font.descent ?? 0.12) * upm;
        const bb = t3.bbox ?? [0, desc, upm, asc];
        // 字を取り出す側 (poppler) は、Type 3 書体の字の大きさを、名前が m の字形の送りが 0.6 em だとして見積もる (無ければ、
        // どれかの字形の送りが 0.5 em だとする。絵文字は送りが 1 em を超えるので、字の高さが 2 倍以上に見積もられ、行の順が乱れる)。
        // 使わない符号 (0x20) に、送り 0.6 em の空の字形 m を置いて、見積もりが字の大きさどおりになるようにする
        const em = ctx.register(ctx.flateStream(`${num(upm * 0.6)} 0 d0\n`));
        charProcs.set(PDFName.of('m'), em);
        const dict = ctx.obj({
          Type: 'Font',
          Subtype: 'Type3',
          FontBBox: [Math.floor(Math.min(bb[0], 0)), Math.floor(Math.min(bb[1], desc)), Math.ceil(Math.max(bb[2], 0)), Math.ceil(Math.max(bb[3], asc))],
          FontMatrix: [1 / upm, 0, 0, 1 / upm, 0, 0],
          CharProcs: charProcs,
          Encoding: { Type: 'Encoding', Differences: [FIRST_CODE - 1, 'm', ...names] },
          FirstChar: FIRST_CODE - 1,
          LastChar: FIRST_CODE + n - 1,
          Widths: [upm * 0.6, ...t3.widths],
          Resources: this.resourcesRef,
          ToUnicode: ctx.register(ctx.flateStream(cmap)),
        } as never);
        ctx.assign(t3.ref, dict);
      }
    }
    if (this.usedAlpha && this.opts.cmyk) this.opts.warnings?.push('PDF/X-3 では透明 (色つきの字形の不透明度) を使えません');
  }
}
