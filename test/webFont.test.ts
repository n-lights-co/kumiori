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
import { brotliCompressSync, deflateSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { toSfnt, webFontKind } from '../src/webFont';
import { cssRefs, parseUnicodeRange } from '../src/resources';
import { defaultFontBuffer } from './helpers';
import { DEFAULT_FONTS, typeset, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';

const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');

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
const LOBSTER_WOFF2 = 'https://fonts.gstatic.com/s/lobster/v32/neILzCirqoswsqX9zoKmMw.woff2';
async function lobsterWoff2(): Promise<Uint8Array> {
  const file = path.join(fontDir, 'Lobster-latin.woff2');
  if (!fs.existsSync(file)) {
    const res = await fetch(LOBSTER_WOFF2);
    if (!res.ok) throw new Error(`font download failed: ${res.status} ${LOBSTER_WOFF2}`);
    fs.mkdirSync(fontDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return new Uint8Array(fs.readFileSync(file));
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
    for (const s of DEFAULT_FONTS.base) if (!fs.existsSync(fileOf(s))) await defaultFontBuffer(path.basename(fileOf(s)));
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
