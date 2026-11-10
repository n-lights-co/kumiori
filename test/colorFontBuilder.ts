/**
 * テスト用: 色つきの字形の表 (COLR・CPAL・CBDT/CBLC・sbix・SVG) を、テストの中で組み立てる補助。
 * 手元の書体 (既定の欧文の書体 Tinos。輪郭・cmap・hmtx を借りる) の表を差し替え・追加・削除して、小さな色つきの書体を作る
 * (色つきの絵文字の書体は数 MB〜数十 MB あり、ビットマップの書体はテストで取得するには大きい。書体のファイルはリポジトリに入れない)。
 * 表の形は OpenType の仕様の各章 (https://learn.microsoft.com/typography/opentype/spec/ の colr・cpal・cbdt・cblc・eblc・sbix・svg) のとおり
 */

/** バイト列を順に書く */
export class Bytes {
  private out: number[] = [];
  u8(...v: number[]) {
    for (const x of v) this.out.push(x & 0xff);
    return this;
  }
  u16(...v: number[]) {
    for (const x of v) this.out.push((x >> 8) & 0xff, x & 0xff);
    return this;
  }
  u24(...v: number[]) {
    for (const x of v) this.out.push((x >> 16) & 0xff, (x >> 8) & 0xff, x & 0xff);
    return this;
  }
  u32(...v: number[]) {
    for (const x of v) this.out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
    return this;
  }
  i8(...v: number[]) {
    return this.u8(...v.map((x) => (x < 0 ? x + 0x100 : x)));
  }
  i16(...v: number[]) {
    return this.u16(...v.map((x) => (x < 0 ? x + 0x10000 : x)));
  }
  /** F2DOT14 */
  f2(...v: number[]) {
    return this.i16(...v.map((x) => Math.round(x * 16384)));
  }
  /** Fixed (16.16) */
  fixed(...v: number[]) {
    return this.u32(...v.map((x) => Math.round(x * 65536) >>> 0));
  }
  tag(t: string) {
    return this.u8(...[...t].map((c) => c.charCodeAt(0)));
  }
  raw(b: Uint8Array | Bytes) {
    for (const x of b instanceof Bytes ? b.out : b) this.out.push(x);
    return this;
  }
  get length() {
    return this.out.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** 書体のファイル (sfnt) の表を差し替え・追加する (null は削除)。表の検査の合計は 0 のまま (fontkit は見ない) */
export function withTables(font: ArrayBuffer, tables: Record<string, Uint8Array | null>): ArrayBuffer {
  const src = new Uint8Array(font);
  const dv = new DataView(font);
  const all = new Map<string, Uint8Array>();
  for (let k = 0; k < dv.getUint16(4); k++) {
    const at = 12 + 16 * k;
    all.set(String.fromCharCode(...src.slice(at, at + 4)), src.slice(dv.getUint32(at + 8), dv.getUint32(at + 8) + dv.getUint32(at + 12)));
  }
  for (const [tag, data] of Object.entries(tables)) {
    if (data) all.set(tag, data);
    else all.delete(tag);
  }
  const tags = [...all.keys()].sort();
  let offset = 12 + 16 * tags.length;
  const total = offset + tags.reduce((n, t) => n + ((all.get(t)!.length + 3) & ~3), 0);
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  out.set(src.slice(0, 4), 0);
  o.setUint16(4, tags.length);
  tags.forEach((t, k) => {
    const data = all.get(t)!;
    const at = 12 + 16 * k;
    for (let i = 0; i < 4; i++) out[at + i] = t.charCodeAt(i);
    o.setUint32(at + 8, offset);
    o.setUint32(at + 12, data.length);
    out.set(data, offset);
    offset += (data.length + 3) & ~3;
  });
  return out.buffer;
}

/** CPAL: palettes は、パレットごとの色 [r, g, b, a] (0〜255) の並び。types を渡すと version 1 (パレットの種類の配列つき) */
export function cpal(palettes: Array<Array<[number, number, number, number]>>, types?: number[]): Uint8Array {
  const entries = palettes[0].length;
  const b = new Bytes();
  const headerSize = 12 + palettes.length * 2 + (types ? 12 : 0);
  const recordsAt = headerSize + (types ? types.length * 4 : 0);
  b.u16(types ? 1 : 0, entries, palettes.length, entries * palettes.length).u32(recordsAt);
  palettes.forEach((_, i) => b.u16(i * entries));
  if (types) {
    b.u32(headerSize, 0, 0);
    b.u32(...types);
  }
  // ColorRecord は 青・緑・赤・不透明度の順
  for (const p of palettes) for (const [r, g, bl, a] of p) b.u8(bl, g, r, a);
  return b.done();
}

/** COLR version 0: 基底の字形ごとの層 [字形の番号, 色の番号] */
export function colr0(glyphs: Array<{ gid: number; layers: Array<[number, number]> }>): Uint8Array {
  const sorted = [...glyphs].sort((a, b) => a.gid - b.gid);
  const b = new Bytes();
  const total = sorted.reduce((n, g) => n + g.layers.length, 0);
  b.u16(0, sorted.length).u32(14, 14 + sorted.length * 6).u16(total);
  let first = 0;
  for (const g of sorted) {
    b.u16(g.gid, first, g.layers.length);
    first += g.layers.length;
  }
  for (const g of sorted) for (const [gid, color] of g.layers) b.u16(gid, color);
  return b.done();
}

type Stop = [offset: number, paletteIndex: number, alpha: number];
const colorLine = (extend: number, stops: Stop[]) => {
  const b = new Bytes().u8(extend).u16(stops.length);
  for (const [off, pi, a] of stops) b.f2(off).u16(pi).f2(a);
  return b;
};

/** COLR version 1 の Paint の表 (子は、親のすぐ後ろに置く。位置は親の先頭から) */
export const paint = {
  colrLayers: (count: number, first: number) => new Bytes().u8(1, count).u32(first).done(),
  solid: (paletteIndex: number, alpha = 1) => new Bytes().u8(2).u16(paletteIndex).f2(alpha).done(),
  linear: (stops: Stop[], p: [number, number, number, number, number, number], extend = 0) => new Bytes().u8(4).u24(16).i16(...p).raw(colorLine(extend, stops)).done(),
  radial: (stops: Stop[], c: [x0: number, y0: number, r0: number, x1: number, y1: number, r1: number], extend = 0) =>
    new Bytes().u8(6).u24(16).i16(c[0], c[1]).u16(c[2]).i16(c[3], c[4]).u16(c[5]).raw(colorLine(extend, stops)).done(),
  /** 角度は度 (反時計回り)。表には、180 で割って 1 を引いた値を書く */
  sweep: (stops: Stop[], cx: number, cy: number, startDeg: number, endDeg: number, extend = 0) =>
    new Bytes().u8(8).u24(12).i16(cx, cy).f2(startDeg / 180 - 1, endDeg / 180 - 1).raw(colorLine(extend, stops)).done(),
  glyph: (gid: number, child: Uint8Array) => new Bytes().u8(10).u24(6).u16(gid).raw(child).done(),
  colrGlyph: (gid: number) => new Bytes().u8(11).u16(gid).done(),
  transform: (m: [number, number, number, number, number, number], child: Uint8Array) => new Bytes().u8(12).u24(7 + 24, 7).fixed(...m).raw(child).done(),
  translate: (dx: number, dy: number, child: Uint8Array) => new Bytes().u8(14).u24(8).i16(dx, dy).raw(child).done(),
  scale: (sx: number, sy: number, child: Uint8Array) => new Bytes().u8(16).u24(8).f2(sx, sy).raw(child).done(),
  scaleAround: (sx: number, sy: number, cx: number, cy: number, child: Uint8Array) => new Bytes().u8(18).u24(12).f2(sx, sy).i16(cx, cy).raw(child).done(),
  scaleUniform: (s: number, child: Uint8Array) => new Bytes().u8(20).u24(6).f2(s).raw(child).done(),
  scaleUniformAround: (s: number, cx: number, cy: number, child: Uint8Array) => new Bytes().u8(22).u24(10).f2(s).i16(cx, cy).raw(child).done(),
  /** 角度は度 (表には 180 で割った値) */
  rotate: (deg: number, child: Uint8Array) => new Bytes().u8(24).u24(6).f2(deg / 180).raw(child).done(),
  rotateAround: (deg: number, cx: number, cy: number, child: Uint8Array) => new Bytes().u8(26).u24(10).f2(deg / 180).i16(cx, cy).raw(child).done(),
  skew: (xDeg: number, yDeg: number, child: Uint8Array) => new Bytes().u8(28).u24(8).f2(xDeg / 180, yDeg / 180).raw(child).done(),
  skewAround: (xDeg: number, yDeg: number, cx: number, cy: number, child: Uint8Array) => new Bytes().u8(30).u24(12).f2(xDeg / 180, yDeg / 180).i16(cx, cy).raw(child).done(),
  composite: (source: Uint8Array, mode: number, backdrop: Uint8Array) => new Bytes().u8(32).u24(8).u8(mode).u24(8 + source.length).raw(source).raw(backdrop).done(),
};

/**
 * COLR version 1: glyphs は基底の字形ごとの根の Paint、layers は LayerList の Paint、clips は ClipBox [xMin, yMin, xMax, yMax]。
 * v0 を渡すと、version 0 の記録も入れる (version 0 と 1 の混在)
 */
export function colr1(opts: { glyphs: Array<{ gid: number; paint: Uint8Array }>; layers?: Uint8Array[]; clips?: Array<{ start: number; end: number; box: [number, number, number, number] }>; v0?: Array<{ gid: number; layers: Array<[number, number]> }> }): Uint8Array {
  const glyphs = [...opts.glyphs].sort((a, b) => a.gid - b.gid);
  const v0 = opts.v0 ? colr0(opts.v0).slice(14) : new Uint8Array(0);
  const v0Count = opts.v0?.length ?? 0;
  const v0Layers = opts.v0?.reduce((n, g) => n + g.layers.length, 0) ?? 0;
  const base = new Bytes().u32(glyphs.length);
  let at = 4 + glyphs.length * 6;
  for (const g of glyphs) {
    base.u16(g.gid).u32(at);
    at += g.paint.length;
  }
  for (const g of glyphs) base.raw(g.paint);
  const layers = opts.layers ?? [];
  const list = new Bytes().u32(layers.length);
  at = 4 + layers.length * 4;
  for (const l of layers) {
    list.u32(at);
    at += l.length;
  }
  for (const l of layers) list.raw(l);
  const clips = [...(opts.clips ?? [])].sort((a, b) => a.start - b.start);
  const clip = new Bytes().u8(1).u32(clips.length);
  at = 5 + clips.length * 7;
  for (const c of clips) {
    clip.u16(c.start, c.end).u24(at);
    at += 9;
  }
  for (const c of clips) clip.u8(1).i16(...c.box);
  const header = 34;
  const baseAt = header + v0.length;
  const listAt = baseAt + base.length;
  const clipAt = listAt + list.length;
  return new Bytes()
    .u16(1, v0Count)
    .u32(v0Count ? header : 0, v0Count ? header + v0Count * 6 : 0)
    .u16(v0Layers)
    .u32(baseAt, layers.length ? listAt : 0, clips.length ? clipAt : 0, 0, 0)
    .raw(v0)
    .raw(base)
    .raw(list)
    .raw(clip)
    .done();
}

/**
 * CBDT と CBLC: 大きさ (strike) 1 つ、字形 gid の PNG 1 つ。画像の形式 17 (小さい寸法つき)、索引の形式 1。
 * width・height・bearingX・bearingY は画素 (ppem での値)
 */
export function cbdt(gid: number, png: Uint8Array, m: { ppem: number; width: number; height: number; bearingX: number; bearingY: number; advance: number }): { CBDT: Uint8Array; CBLC: Uint8Array } {
  const data = new Bytes().u16(3, 0).u8(m.height, m.width).i8(m.bearingX, m.bearingY).u8(m.advance).u32(png.length).raw(png).done();
  const glyphLength = data.length - 4;
  const sub = new Bytes().u16(1, 17).u32(4).u32(0, glyphLength);
  const array = new Bytes().u16(gid, gid).u32(8);
  const CBLC = new Bytes()
    .u16(3, 0)
    .u32(1)
    // BitmapSize: 索引の位置・大きさ・数、colorRef、横・縦の行の寸法 (12 バイトずつ)、字形の範囲、ppem、ビットの深さ (32)、向き
    .u32(8 + 48, array.length + sub.length, 1, 0)
    .u8(...new Array<number>(24).fill(0))
    .u16(gid, gid)
    .u8(m.ppem, m.ppem, 32, 1)
    .raw(array)
    .raw(sub)
    .done();
  return { CBDT: data, CBLC };
}

/** sbix: 大きさ (strike) 1 つ。glyphs は、字形の番号 → 画像 (種類のタグ・原点からのずれ・中身) */
export function sbix(numGlyphs: number, ppem: number, glyphs: Map<number, { type: string; x: number; y: number; data: Uint8Array }>): Uint8Array {
  const strike = new Bytes().u16(ppem, 72);
  let at = 4 + (numGlyphs + 1) * 4;
  const body = new Bytes();
  for (let g = 0; g <= numGlyphs; g++) {
    strike.u32(at);
    const d = glyphs.get(g);
    if (d && g < numGlyphs) {
      body.i16(d.x, d.y).tag(d.type).raw(d.data);
      at += 8 + d.data.length;
    }
  }
  return new Bytes().u16(1, 1).u32(1, 12).raw(strike).raw(body).done();
}

/** SVG の表: 文書ごとに、字形の番号の範囲 [始め, 終わり] と中身 (文字列か、圧縮したバイト列) */
export function svgTable(docs: Array<{ start: number; end: number; doc: string | Uint8Array }>): Uint8Array {
  const sorted = [...docs].sort((a, b) => a.start - b.start).map((d) => ({ ...d, bytes: typeof d.doc === 'string' ? new TextEncoder().encode(d.doc) : d.doc }));
  const list = new Bytes().u16(sorted.length);
  let at = 2 + sorted.length * 12;
  for (const d of sorted) {
    list.u16(d.start, d.end).u32(at, d.bytes.length);
    at += d.bytes.length;
  }
  for (const d of sorted) list.raw(d.bytes);
  return new Bytes().u16(0).u32(10, 0).raw(list).done();
}
