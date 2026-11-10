/**
 * ウェブフォント (WOFF・WOFF2) を、ふつうの書体のファイル (sfnt) に戻す (src/webFont.ts) と、組版での使い方:
 *  - WOFF 1.0・変換なしの WOFF2: 手元の既定の書体 (Arimo) から、テストの中で組み立てて戻し、元の表と同じになるか
 *  - glyf を変換した WOFF2 (Google Fonts の配信のもの): .cache/fonts に取得して戻し、fontkit が WOFF2 を直に読んだ字形と同じか
 *  - @font-face の WOFF2 を http(s) で参照する CSS: unicode-range が文書の字と重なる書体だけを取る
 * 書体のファイルはリポジトリに入れない (CLAUDE.md)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { brotliCompressSync, brotliDecompressSync, deflateSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { toSfnt, webFontKind } from '../src/webFont';
import { cssRefs, cssStringChars, documentChars, parseUnicodeRange, rebaseFontFaceUrls } from '../src/resources';
import { collectionFaces } from '../src/fontLoader';
import { defaultFontBuffer, ensureFonts, extraTestFont, fontDir } from './helpers';
import { DEFAULT_FONTS, typeset, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';


/** sfnt の表 (名前 → 中身) */
function tablesOf(buf: ArrayBuffer): Map<string, Uint8Array> {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < v.getUint16(4); k++) {
    const at = 12 + 16 * k;
    out.set(String.fromCharCode(...b.slice(at, at + 4)), b.slice(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12)));
  }
  return out;
}

/** WOFF 1.0 を組み立てる (W3C WOFF 1.0 §3〜5。表は zlib で圧縮) */
function makeWoff(ttf: ArrayBuffer): Uint8Array {
  const tables = [...tablesOf(ttf)];
  const parts = tables.map(([tag, data]) => ({ tag, data, comp: new Uint8Array(deflateSync(data)) }));
  let offset = 44 + 20 * parts.length;
  const total = offset + parts.reduce((a, p) => a + ((Math.min(p.comp.length, p.data.length) + 3) & ~3), 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46], 0); // wOFF
  v.setUint32(4, new DataView(ttf).getUint32(0));
  v.setUint32(8, total);
  v.setUint16(12, parts.length);
  parts.forEach((p, k) => {
    const body = p.comp.length < p.data.length ? p.comp : p.data;
    const at = 44 + 20 * k;
    for (let i = 0; i < 4; i++) out[at + i] = p.tag.charCodeAt(i);
    v.setUint32(at + 4, offset);
    v.setUint32(at + 8, body.length);
    v.setUint32(at + 12, p.data.length);
    out.set(body, offset);
    offset += (body.length + 3) & ~3;
  });
  return out;
}

/** UIntBase128 (W3C WOFF2 §3.1) */
function base128(n: number): number[] {
  const out = [n & 0x7f];
  for (n >>>= 7; n; n >>>= 7) out.unshift((n & 0x7f) | 0x80);
  return out;
}

/** 変換しない WOFF2 を組み立てる (W3C WOFF2 §4。glyf・loca は変換の版 3 (変換なし)、ほかは版 0。表の名前は 0x3f の任意の名前で書く) */
function makeWoff2Null(ttf: ArrayBuffer): Uint8Array {
  const tables = [...tablesOf(ttf)];
  const dir: number[] = [];
  for (const [tag, data] of tables) {
    const version = tag === 'glyf' || tag === 'loca' ? 3 : 0;
    dir.push((version << 6) | 0x3f, ...Array.from(tag, (c) => c.charCodeAt(0)), ...base128(data.length));
  }
  const joined = new Uint8Array(tables.reduce((a, [, d]) => a + d.length, 0));
  let at = 0;
  for (const [, d] of tables) {
    joined.set(d, at);
    at += d.length;
  }
  const comp = new Uint8Array(brotliCompressSync(joined));
  const total = 48 + dir.length + comp.length;
  const out = new Uint8Array((total + 3) & ~3);
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32], 0); // wOF2
  v.setUint32(4, new DataView(ttf).getUint32(0));
  v.setUint32(8, out.length);
  v.setUint16(12, tables.length);
  v.setUint32(16, ttf.byteLength);
  v.setUint32(20, comp.length);
  out.set(dir, 48);
  out.set(comp, 48 + dir.length);
  return out;
}

/** 字形の輪郭・送り幅・外枠を、全部の字形で比べる (違う字形の数) */
function glyphDiffs(a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): number {
  const fa = fontkit.create(new Uint8Array(a as ArrayBuffer)) as unknown as { numGlyphs: number; getGlyph(i: number): { path: { toSVG(): string }; advanceWidth: number; bbox: unknown } };
  const fb = fontkit.create(new Uint8Array(b as ArrayBuffer)) as unknown as typeof fa;
  let n = 0;
  for (let i = 0; i < fa.numGlyphs; i++) {
    const ga = fa.getGlyph(i);
    const gb = fb.getGlyph(i);
    if (ga.path.toSVG() !== gb.path.toSVG() || ga.advanceWidth !== gb.advanceWidth || JSON.stringify(ga.bbox) !== JSON.stringify(gb.bbox)) n++;
  }
  return n + Math.abs(fa.numGlyphs - fb.numGlyphs);
}

/** Google Fonts の配信の WOFF2 (glyf・loca を変換したもの)。Lobster の欧文 (latin) の部分。.cache/fonts に無ければ取得する */
async function lobsterWoff2(): Promise<Uint8Array> {
  return new Uint8Array(fs.readFileSync(await extraTestFont('Lobster-latin.woff2')));
}

/** WOFF2 の表の目録の 1 つ (テストの組み立て用。flags・名前・長さ・変換した長さと、展開した中身) */
type W2 = { tag: string; flags: number; origLength: number; transformLength?: number; data: Uint8Array };

/** 255UInt16 (W3C WOFF2 §3.1) を書く */
function u255(n: number): number[] {
  return n < 253 ? [n] : n < 506 ? [255, n - 253] : n < 759 ? [254, n - 506] : [253, n >> 8, n & 0xff];
}

/** 1 つの書体の WOFF2 を読んで、表の目録と展開した中身にする (Node の Brotli で展開。変換した表は変換したまま) */
function readWoff2(w: Uint8Array): { flavor: number; tables: W2[] } {
  const v = new DataView(w.buffer, w.byteOffset, w.byteLength);
  const known = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB'];
  let at = 48;
  const b128 = () => {
    let r = 0;
    for (;;) {
      const c = w[at++];
      r = r * 128 + (c & 0x7f);
      if (!(c & 0x80)) return r;
    }
  };
  const tables: W2[] = [];
  for (let k = 0; k < v.getUint16(12); k++) {
    const flags = w[at++];
    const tag = (flags & 0x3f) === 0x3f ? String.fromCharCode(...w.slice(at, (at += 4))) : known[flags & 0x3f];
    const origLength = b128();
    const ver = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? ver === 0 : ver !== 0;
    tables.push({ tag, flags, origLength, ...(transformed ? { transformLength: b128() } : {}), data: new Uint8Array() });
  }
  const data = new Uint8Array(brotliDecompressSync(w.subarray(at, at + v.getUint32(20))));
  let p = 0;
  for (const t of tables) {
    const n = t.transformLength ?? t.origLength;
    t.data = data.slice(p, p + n);
    p += n;
  }
  return { flavor: v.getUint32(4), tables };
}

/** 書体の集まりの WOFF2 を組み立てる (§4.2: 表の目録は重ならない表を 1 つずつ、書体ごとに使う表の番号) */
function makeWoff2Collection(tables: W2[], fonts: Array<{ flavor: number; indices: number[] }>): Uint8Array {
  const dir: number[] = [];
  for (const t of tables) {
    dir.push(t.flags);
    if ((t.flags & 0x3f) === 0x3f) dir.push(...Array.from(t.tag, (c) => c.charCodeAt(0)));
    dir.push(...base128(t.origLength), ...(t.transformLength !== undefined ? base128(t.transformLength) : []));
  }
  const coll: number[] = [0, 1, 0, 0, ...u255(fonts.length)];
  for (const f of fonts) coll.push(...u255(f.indices.length), (f.flavor >>> 24) & 0xff, (f.flavor >> 16) & 0xff, (f.flavor >> 8) & 0xff, f.flavor & 0xff, ...f.indices.flatMap(u255));
  const joined = new Uint8Array(tables.reduce((a, t) => a + t.data.length, 0));
  let p = 0;
  for (const t of tables) {
    joined.set(t.data, p);
    p += t.data.length;
  }
  const comp = new Uint8Array(brotliCompressSync(joined));
  const out = new Uint8Array((48 + dir.length + coll.length + comp.length + 3) & ~3);
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32]);
  v.setUint32(4, 0x74746366); // ttcf
  v.setUint32(8, out.length);
  v.setUint16(12, tables.length);
  v.setUint32(20, comp.length);
  out.set(dir, 48);
  out.set(coll, 48 + dir.length);
  out.set(comp, 48 + dir.length + coll.length);
  return out;
}

/** name の表の、書体のファミリー名 (nameID 1) を書き換えた写し (英語の名前を同じ長さの別の名前にする) */
function renamed(name: Uint8Array, from: string, to: string): Uint8Array {
  const out = name.slice();
  const enc16 = (t: string) => Array.from(t).flatMap((c) => [0, c.charCodeAt(0)]);
  const a = enc16(from);
  const b = enc16(to);
  for (let k = 0; k + a.length <= out.length; k++) if (a.every((x, i) => out[k + i] === x)) out.set(b, k);
  return out;
}

let arimo: ArrayBuffer;
beforeAll(async () => {
  arimo = await defaultFontBuffer('Arimo-Regular.ttf');
}, 300_000);

describe('WOFF・WOFF2 を sfnt に戻す (webFont.ts)', () => {
  it('先頭の印で見分ける。ほかの書体のファイルはそのまま', () => {
    expect(webFontKind(makeWoff(arimo))).toBe('woff');
    expect(webFontKind(makeWoff2Null(arimo))).toBe('woff2');
    expect(webFontKind(arimo)).toBeUndefined();
    expect(toSfnt(arimo)).toBe(arimo);
  });
  it('WOFF 1.0 (zlib の表) を戻すと、元の TTF と表が同じ (head の checkSumAdjustment を除く)', () => {
    const w = makeWoff(arimo);
    const back = toSfnt(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer);
    const a = tablesOf(arimo);
    const b = tablesOf(back);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [tag, d] of a) {
      if (tag === 'head') expect([...b.get(tag)!.slice(0, 8), ...b.get(tag)!.slice(12)]).toEqual([...d.slice(0, 8), ...d.slice(12)]);
      else expect(b.get(tag)).toEqual(d);
    }
  });
  it('変換しない WOFF2 (Brotli で圧縮した表) を戻すと、元の TTF と表が同じ', () => {
    const w = makeWoff2Null(arimo);
    const back = toSfnt(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer);
    const a = tablesOf(arimo);
    const b = tablesOf(back);
    for (const [tag, d] of a) if (tag !== 'head') expect(b.get(tag)).toEqual(d);
  });
  it('glyf・loca を変換した WOFF2 (Google Fonts) を戻すと、fontkit が WOFF2 を直に読んだ字形と全部同じ', async () => {
    const w = await lobsterWoff2();
    const back = toSfnt(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer);
    expect(webFontKind(back)).toBeUndefined();
    expect(glyphDiffs(w, back)).toBe(0);
    // ふつうの TrueType の表がそろう (glyf・loca を組み立て直した)
    expect([...tablesOf(back).keys()]).toEqual(expect.arrayContaining(['glyf', 'loca', 'hmtx', 'cmap', 'head']));
  }, 120_000);
  it('書体の集まりの WOFF2 (表を分け合う 2 書体) は TTC に戻り、書体ごとに元の字形と同じ (§4.2)', async () => {
    const w = await lobsterWoff2();
    const { flavor, tables } = readWoff2(w);
    // 2 つめの書体は name の表だけが別 (ファミリー名を Lobster → Lobstar)。glyf・loca・hmtx (変換した表) は分け合う
    const ni = tables.findIndex((t) => t.tag === 'name');
    const name2 = renamed(tables[ni].data, 'Lobster', 'Lobstar');
    const all = [...tables, { tag: 'name', flags: 0x05, origLength: name2.length, data: name2 }];
    const base = tables.map((_, k) => k);
    const ttc = toSfnt(makeWoff2Collection(all, [{ flavor, indices: base }, { flavor, indices: base.map((k) => (k === ni ? all.length - 1 : k)) }]).buffer as ArrayBuffer);
    expect(String.fromCharCode(...new Uint8Array(ttc, 0, 4))).toBe('ttcf');
    const faces = collectionFaces(ttc);
    expect(faces.length).toBe(2);
    for (const f of faces) expect(glyphDiffs(w, f)).toBe(0);
    const names = faces.map((f) => (fontkit.create(new Uint8Array(f)) as unknown as { familyName: string }).familyName);
    expect(names).toEqual(['Lobster', 'Lobstar']);
    // 分け合う表は TTC の中に 1 度だけ置く (書体ごとの表の記録が、同じ位置を指す)
    const dv = new DataView(ttc);
    const glyfAt = [0, 1].map((f) => {
      const d = dv.getUint32(12 + 4 * f);
      for (let k = 0; k < dv.getUint16(d + 4); k++) if (String.fromCharCode(...new Uint8Array(ttc, d + 12 + 16 * k, 4)) === 'glyf') return dv.getUint32(d + 12 + 16 * k + 8);
      return -1;
    });
    expect(glyfAt[0]).toBe(glyfAt[1]);
  }, 120_000);
  it('glyf・loca の組が 2 つある書体の集まり (変換した Lobster と、変換しない Arimo) も戻る。組が合わなければ投げる', async () => {
    const w = await lobsterWoff2();
    const lob = readWoff2(w);
    const ari = [...tablesOf(arimo)].map(([tag, data]): W2 => ({ tag, flags: (tag === 'glyf' || tag === 'loca' ? 3 << 6 : 0) | 0x3f, origLength: data.length, data }));
    // 表の目録では、それぞれの glyf のすぐ後ろに、組の loca を置く (§5.5)
    const order = (ts: W2[]) => {
      const rest = ts.filter((t) => t.tag !== 'loca');
      const loca = ts.find((t) => t.tag === 'loca')!;
      const g = rest.findIndex((t) => t.tag === 'glyf');
      return [...rest.slice(0, g + 1), loca, ...rest.slice(g + 1)];
    };
    const a = order(lob.tables);
    const b = order(ari);
    const all = [...a, ...b];
    const fonts = [
      { flavor: lob.flavor, indices: a.map((_, k) => k) },
      { flavor: 0x00010000, indices: b.map((_, k) => a.length + k) },
    ];
    const faces = collectionFaces(toSfnt(makeWoff2Collection(all, fonts).buffer as ArrayBuffer));
    expect(faces.length).toBe(2);
    expect(glyphDiffs(w, faces[0])).toBe(0);
    // 変換しない Arimo は、元の TTF と表が同じ (fontkit は Arimo の一部の字形の外枠を読めないので、字形ではなく表で比べる)
    const ta = tablesOf(arimo);
    const tb = tablesOf(faces[1]);
    expect([...tb.keys()].sort()).toEqual([...ta.keys()].sort());
    for (const [tag, d] of ta) expect(tb.get(tag)).toEqual(d);
    // 2 つめの書体が 1 つめの書体の loca を使う (glyf と loca の組が合わない): 投げる (§4.2)
    const bad = [{ ...fonts[0] }, { ...fonts[1], indices: fonts[1].indices.map((ix) => (all[ix].tag === 'loca' ? a.findIndex((t) => t.tag === 'loca') : ix)) }];
    expect(() => toSfnt(makeWoff2Collection(all, bad).buffer as ArrayBuffer)).toThrow(/paired/);
  }, 120_000);
  it('壊れた WOFF2 は投げる (黙って違う書体にしない)', () => {
    const w = makeWoff2Null(arimo).slice(0, 60);
    expect(() => toSfnt(w.buffer as ArrayBuffer)).toThrow();
  });
});

describe('@font-face の WOFF・WOFF2 で組む', () => {
  const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  const loadFont = async (spec: FontSpec) => {
    const f = fileOf(spec);
    if (!fs.existsSync(f)) return undefined;
    const b = fs.readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const firstFamily = (r: Awaited<ReturnType<typeof typeset>>) => {
    let f: string | undefined;
    walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (f ??= (a as GlyphArea).fontFamily)));
    return f;
  };

  it('files で渡した WOFF・WOFF2 を @font-face の書体として使い、PDF に TrueType として埋め込む', async () => {
    for (const [name, data] of [
      ['a.woff', makeWoff(arimo)],
      ['a.woff2', await lobsterWoff2()],
    ] as const) {
      const r = await typeset(`<style>@font-face { font-family: W; src: url(${name}) }</style><p style="font-family: W">Hello</p>`, { loadFont, files: [{ name, data }] });
      expect(firstFamily(r)).toBe('css:W');
      // PDF の書体の記述 (FontDescriptor) に、TrueType の書体のファイル (FontFile2) がある書体の名前
      const pdf = await PDFDocument.load(await r.toPdf());
      const names: string[] = [];
      for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue;
        if (obj.get(PDFName.of('FontFile2'))) names.push(String(obj.get(PDFName.of('FontName'))));
      }
      expect(names.some((n) => (name === 'a.woff' ? /Arimo/ : /Lobster/).test(n))).toBe(true);
    }
  }, 120_000);
  it('@font-face で書体の集まりの WOFF2 を指すと、最初の書体を使う', async () => {
    const { flavor, tables } = readWoff2(await lobsterWoff2());
    const base = tables.map((_, k) => k);
    const coll = makeWoff2Collection(tables, [{ flavor, indices: base }, { flavor, indices: base }]);
    const r = await typeset('<style>@font-face { font-family: C; src: url(c.woff2) }</style><p style="font-family: C">Hello</p>', { loadFont, files: [{ name: 'c.woff2', data: coll }] });
    expect(firstFamily(r)).toBe('css:C');
    expect(r.warnings).toEqual([]);
  }, 120_000);
  it('CSS の @font-face が http(s) で参照する書体を取る (fetchStyles)。unicode-range が文書の字と重ならない書体は取らない', async () => {
    const woff2 = await lobsterWoff2();
    const asked: string[] = [];
    const server = http.createServer((req, res) => {
      asked.push(req.url ?? '');
      if (req.url === '/font.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('@font-face { font-family: G; src: url(/latin.woff2) format("woff2"); unicode-range: U+0000-00FF } @font-face { font-family: G; src: url(/greek.woff2) format("woff2"); unicode-range: U+0370-03FF }');
      } else if (req.url === '/latin.woff2') {
        res.writeHead(200, { 'content-type': 'font/woff2' });
        res.end(Buffer.from(woff2));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await typeset(`<link rel="stylesheet" href="http://127.0.0.1:${port}/font.css"><p style="font-family: G">Hello</p>`, { loadFont });
      expect(asked.sort()).toEqual(['/font.css', '/latin.woff2']);
      expect(firstFamily(r)).toMatch(/^css:G/);
    } finally {
      server.close();
    }
  }, 120_000);
});

describe('@font-face の書体のファイルの突き合わせ (CSS Fonts 4 §4.3: url() は CSS の場所を基準に解決する)', () => {
  const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  const loadFont = async (spec: FontSpec) => {
    const b = fs.readFileSync(fileOf(spec));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const font = (n: string) => new Uint8Array(fs.readFileSync(path.join(fontDir, n)));
  /** family の書体で組んだ字の幅の合計 */
  const widthOf = (r: Awaited<ReturnType<typeof typeset>>, family: string) => {
    let w = 0;
    walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (a as GlyphArea).fontFamily.startsWith(`css:${family}`) && (w += a.width)));
    return w;
  };
  const body = '<p style="font-family: A; font-size: 40pt">Hamburgefonstiv</p><p style="font-family: B; font-size: 40pt">Hamburgefonstiv</p>';
  // 同じ名前 (Regular.ttf) で、ディレクトリの違う 2 つの書体。字の幅が違う
  const files = [
    { name: 'noto/Regular.ttf', data: font('Arimo-Regular.ttf') },
    { name: 'roboto/Regular.ttf', data: font('Tinos-Regular.ttf') },
  ];
  let arimo = 0;
  let tinos = 0;
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
    const ref = await typeset(`<style>@font-face { font-family: A; src: url(a.ttf) } @font-face { font-family: B; src: url(t.ttf) }</style>${body}`, {
      loadFont,
      files: [{ name: 'a.ttf', data: font('Arimo-Regular.ttf') }, { name: 't.ttf', data: font('Tinos-Regular.ttf') }],
    });
    arimo = widthOf(ref, 'A');
    tinos = widthOf(ref, 'B');
    expect(Math.abs(arimo - tinos)).toBeGreaterThan(5);
  }, 300_000);
  it('<style> の url(noto/Regular.ttf) と url(roboto/Regular.ttf) を、パスで区別する (ファイル名だけで取り違えない)', async () => {
    for (const fs2 of [files, [...files].reverse()]) {
      const r = await typeset(`<style>@font-face { font-family: A; src: url(noto/Regular.ttf) } @font-face { font-family: B; src: url("./roboto/Regular.ttf?v=2#x") }</style>${body}`, { loadFont, files: fs2 });
      expect(widthOf(r, 'A')).toBeCloseTo(arimo, 3);
      expect(widthOf(r, 'B')).toBeCloseTo(tinos, 3);
    }
  }, 120_000);
  it('CSS のファイルの中の相対の url() は、その CSS の場所を基準に解決する', async () => {
    const css = '@font-face { font-family: A; src: url(../noto/Regular.ttf) } @font-face { font-family: B; src: url("../roboto/Regular.ttf") }';
    for (const fs2 of [files, [...files].reverse()]) {
      const r = await typeset(`<link rel="stylesheet" href="css/s.css">${body}`, { loadFont, files: [{ name: 'css/s.css', data: css }, ...fs2] });
      expect(widthOf(r, 'A')).toBeCloseTo(arimo, 3);
      expect(widthOf(r, 'B')).toBeCloseTo(tinos, 3);
    }
    // CSS の隣の書体 (css/Regular.ttf) を、文書の隣の同じ名前の書体 (Regular.ttf) と取り違えない
    const near = await typeset(`<link rel="stylesheet" href="css/s.css">${body}`, {
      loadFont,
      files: [{ name: 'css/s.css', data: '@font-face { font-family: A; src: url(Regular.ttf) }' }, { name: 'css/Regular.ttf', data: font('Arimo-Regular.ttf') }, { name: 'Regular.ttf', data: font('Tinos-Regular.ttf') }],
    });
    expect(widthOf(near, 'A')).toBeCloseTo(arimo, 3);
  }, 120_000);
  it('解決したパスに無ければ、これまでどおりファイル名で探す。resolveResource の返した書体は URL で突き合わせる', async () => {
    const css = '@font-face { font-family: A; src: url(fonts/Regular.ttf) }';
    const r = await typeset(`<link rel="stylesheet" href="css/s.css">${body}`, { loadFont, files: [{ name: 'css/s.css', data: css }, { name: 'noto/Regular.ttf', data: font('Arimo-Regular.ttf') }] });
    expect(widthOf(r, 'A')).toBeCloseTo(arimo, 3);
    // 取った CSS (https://…/x/css/s.css) の相対の書体は、その URL を基準に解決した URL で問い合わせ、その URL で突き合わせる
    const store: Record<string, string | Uint8Array> = {
      'https://example.test/x/css/s.css': '@font-face { font-family: A; src: url(../noto/Regular.ttf?v=1) } @font-face { font-family: B; src: url(../roboto/Regular.ttf?v=1) }',
      'https://example.test/x/noto/Regular.ttf?v=1': font('Arimo-Regular.ttf'),
      'https://example.test/x/roboto/Regular.ttf?v=1': font('Tinos-Regular.ttf'),
    };
    const net = await typeset(`<link rel="stylesheet" href="https://example.test/x/css/s.css">${body}`, { loadFont, fetchStyles: false, resolveResource: (u) => store[u] });
    expect(widthOf(net, 'A')).toBeCloseTo(arimo, 3);
    expect(widthOf(net, 'B')).toBeCloseTo(tinos, 3);
  }, 120_000);
  it('rebaseFontFaceUrls: @font-face の中の相対の url() だけを書き換える', () => {
    const css = '@font-face { font-family: A; src: url(../f/a.woff2) format("woff2"), url(\'b.ttf\'), url(data:font/ttf;base64,AAAA), url(https://x.test/c.ttf) } p { background: url(bg.png) }';
    expect(rebaseFontFaceUrls(css, 'css/sub/s.css')).toBe('@font-face { font-family: A; src: url("css/f/a.woff2") format("woff2"), url("css/sub/b.ttf"), url(data:font/ttf;base64,AAAA), url(https://x.test/c.ttf) } p { background: url(bg.png) }');
    expect(rebaseFontFaceUrls(css, 'https://y.test/css/s.css')).toContain('url("https://y.test/f/a.woff2") format("woff2"), url("https://y.test/css/b.ttf")');
    // 文書と同じ場所の CSS (s.css) では変わらない
    const same = '@font-face { font-family: A; src: url(f/a.woff2), url("b.ttf") }';
    expect(rebaseFontFaceUrls(same, 's.css')).toBe(same);
  });
});

describe('unicode-range の絞り込みに使う字 (CSS Fonts 4 §4.5)', () => {
  const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  const loadFont = async (spec: FontSpec) => {
    const b = fs.readFileSync(fileOf(spec));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  // 日 (U+65E5)・第 (U+7B2C)・α (U+03B1)・… (U+2026) のそれぞれだけに使う書体
  const faces = ['65E5', '7B2C', '03B1', '2026', '0-7F'].map((r) => `@font-face { font-family: W; src: url(https://example.test/u${r}.woff2); unicode-range: U+${r} }`).join('\n');
  /** 問い合わせた書体 (u65E5 など) */
  const asked = async (body: string, css = '', more: Record<string, string> = {}) => {
    const urls: string[] = [];
    await typeset(`<html><head><link rel="stylesheet" href="s.css"></head><body>${body}</body></html>`, {
      loadFont,
      fetchImages: false,
      fetchStyles: false,
      files: [{ name: 's.css', data: `${faces}\n${css}` }],
      resolveResource: (u) => (urls.push(u), more[u]),
    });
    return urls.filter((u) => /\.woff2$/.test(u)).map((u) => u.replace(/^.*\/u|\.woff2$/g, '')).sort();
  };
  it('書かれたままの字と、文字参照 (数値・名前) を解いた字を見る', async () => {
    expect(await asked('<h1>日</h1>')).toEqual(['0-7F', '65E5']);
    expect(await asked('<h1>x</h1>')).toEqual(['0-7F']);
    expect(await asked('<h1>&#x65E5;&#31532;</h1>')).toEqual(['0-7F', '65E5', '7B2C']);
    expect(await asked('<h1>&alpha;&hellip;</h1>')).toEqual(['0-7F', '03B1', '2026']);
  }, 120_000);
  it('CSS の content の文字列の字 (逃がしも解く) を見る。一緒に渡した CSS・<style>・後から取った CSS のどれでも', async () => {
    expect(await asked('<h1>x</h1>', 'h1::before { content: "第" }')).toEqual(['0-7F', '7B2C']);
    expect(await asked('<h1>x</h1>', "h1::before { content: '\\65E5 \\7b2c' }")).toEqual(['0-7F', '65E5', '7B2C']);
    expect(await asked('<style>h1::before { content: "\\0003B1" }</style><h1>x</h1>')).toEqual(['0-7F', '03B1']);
    // 注釈の中の字は使う字ではない
    expect(await asked('<h1>x</h1>', '/* 日 "第" */ h1 { color: red }')).toEqual(['0-7F']);
    // 書体の参照より後に読む CSS (@import で取ったもの) の content の字でも、書体を取る
    expect(await asked('<h1>x</h1>', '', { 'https://example.test/late.css': 'h1::after { content: "日" }' })).toEqual(['0-7F']);
    expect(await asked('<link rel="stylesheet" href="https://example.test/late.css"><h1>x</h1>', '', { 'https://example.test/late.css': 'h1::after { content: "日" }' })).toEqual(['0-7F', '65E5']);
  }, 120_000);
  it('documentChars・cssStringChars', () => {
    expect([...documentChars('a&#x65E5;&#31532;\\7b2c')].sort((p, q) => p - q).filter((c) => c > 0x7f)).toEqual([0x65e5, 0x7b2c]);
    const s = new Set<number>();
    cssStringChars('a::before { content: "A\\42  \\"\\\n\\0\\d800 " } /* "Z" */ b { font-family: \'C\' }', s);
    // A・B (\\42 と後ろの空白 1 つ)・空白・"・(\\ と改行は無し)・U+FFFD (\\0 と代用符号)・C
    expect([...s].sort((p, q) => p - q)).toEqual([0x20, 0x22, 0x41, 0x42, 0x43, 0xfffd]);
  });
});

describe('CSS の書体の参照', () => {
  it('@font-face の url() は書体として、unicode-range と一緒に拾う', () => {
    expect(cssRefs('@font-face { font-family: X; src: url(a.woff2) format("woff2"), url("a.ttf"); unicode-range: U+0-7F, U+30??; } p { background: url(b.png) }')).toEqual([
      { url: 'a.woff2', kind: 'font', ranges: [[0, 0x7f], [0x3000, 0x30ff]] },
      { url: 'a.ttf', kind: 'font', ranges: [[0, 0x7f], [0x3000, 0x30ff]] },
      { url: 'b.png', kind: 'other' },
    ]);
    expect(parseUnicodeRange('U+26')).toEqual([[0x26, 0x26]]);
    expect(parseUnicodeRange('bad')).toBeUndefined();
  });
});
