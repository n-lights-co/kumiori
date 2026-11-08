import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256 } from '../src/sha256';
import { walkAreaTree, parseAreaTree, serializeAreaTree } from '../src/areaTree';
import { AssetStore } from '../src/assets';
import { doc, makeEngine } from './helpers';
import type { GlyphArea } from '../src/types';

const node = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('SHA-256 (FIPS 180-4)', () => {
  it('長さの境目 (55・56・64 バイトなど) を含め、Node の crypto と同じ値', () => {
    for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 100003]) {
      const b = new Uint8Array(n).map((_, k) => (k * 131 + n) & 0xff);
      expect(sha256(b)).toBe(node(b));
    }
    expect(sha256(new TextEncoder().encode('abc'))).toBe(node(new TextEncoder().encode('abc')));
  });
});

describe('Area Tree の書体・画像の一覧と字形の番号 (resources)', () => {
  it('字に書体の id と字形の番号、木に書体 (SHA-256) と画像の一覧が付く', async () => {
    const { fonts, measurer } = await makeEngine();
    const { LayoutEngine } = await import('../src/layoutEngine');
    const assets = new AssetStore();
    const png = new Uint8Array([1, 2, 3, 4]);
    assets.register('a.png', { mime: 'image/png', bytes: png, width: 10, height: 10 });
    const f = fonts.all()[0];
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: f.family, assets });
    const tree = engine.layout(doc([{ type: 'block', children: ['あいA', { type: 'image', src: 'a.png' }] }] as never));
    expect(tree.resources!.fonts).toEqual([{ id: f.key, family: f.family, weight: f.weight, ...(f.postscriptName ? { postscriptName: f.postscriptName } : {}), sha256: node(new Uint8Array(f.buffer)), unitsPerEm: f.unitsPerEm }]);
    expect(tree.resources!.images).toEqual([{ src: 'a.png', mime: 'image/png', sha256: node(png), width: 10, height: 10 }]);
    const glyphs: GlyphArea[] = [];
    walkAreaTree(tree, (a) => {
      if (a.type === 'glyph') glyphs.push(a);
    });
    expect(glyphs.length).toBe(3);
    for (const g of glyphs) {
      expect(g.fontId).toBe(f.key);
      expect(g.glyphIds).toEqual(f.fk.layout(g.text).glyphs.map((x) => x.id));
      expect(g.glyphIds![0]).toBeGreaterThan(0);
    }
    // JSON にして読み直しても残る
    expect(parseAreaTree(serializeAreaTree(tree)).resources).toEqual(tree.resources);
  });
});

describe('PDF は木の字形の番号から書く', () => {
  it('glyphIds があれば、その字形を書く (字を組み直さない)', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    const { fonts, engine } = await makeEngine();
    const tree = engine.layout(doc([{ type: 'block', children: ['A'] }] as never));
    const f = fonts.all()[0];
    const idA = f.fk.glyphForCodePoint(0x41).id;
    const idB = f.fk.glyphForCodePoint(0x42).id;
    const content = async () => {
      const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { subset: false }));
      const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
      const objs = [pdf.context.lookup(ref)].flat() as unknown[];
      const streams = objs.flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
      return streams.map((st) => new TextDecoder('latin1').decode(decodePDFRawStream(st as never).decode())).join('\n');
    };
    const hex = (id: number) => `<${id.toString(16).padStart(4, '0').toUpperCase()}>`;
    expect((await content()).toUpperCase()).toContain(hex(idA));
    // 木の字形の番号を B の字形にすると、PDF には B の字形が書かれる
    walkAreaTree(tree, (a) => {
      if (a.type === 'glyph') a.glyphIds = [idB];
    });
    const c = (await content()).toUpperCase();
    expect(c).toContain(hex(idB));
    expect(c).not.toContain(hex(idA));
  });
});

describe('PDF は GPOS の位置 (glyphPositions) で字形を置く', () => {
  it('字形ごとに、送りの合計とずらしの位置に行列を置いて書く', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    const { fonts, engine } = await makeEngine();
    const tree = engine.layout(doc([{ type: 'block', fontSize: 10, children: ['A'] }] as never));
    const f = fonts.all()[0];
    const idA = f.fk.glyphForCodePoint(0x41).id;
    const idB = f.fk.glyphForCodePoint(0x42).id;
    let x0 = 0;
    walkAreaTree(tree, (a) => {
      if (a.type !== 'glyph') return;
      a.glyphIds = [idA, idB];
      // A の送りは 1 em、B は横に 0.1 em・上に 0.2 em ずらす
      a.glyphPositions = [[f.unitsPerEm, 0, 0], [0, f.unitsPerEm / 10, f.unitsPerEm / 5]];
    });
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { subset: false }));
    const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
    const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
    const c = st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
    const tms = [...c.matchAll(/([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]+)>/g)].map((m) => ({ x: +m[1], y: +m[2], id: parseInt(m[3], 16) }));
    expect(tms.map((t) => t.id)).toEqual([idA, idB]);
    x0 = tms[0].x;
    // 文字の大きさ 10pt: B は A から 10 + 1 = 11pt 右、2pt 上
    expect(tms[1].x - x0).toBeCloseTo(11, 3);
    expect(tms[1].y - tms[0].y).toBeCloseTo(2, 3);
  });
});
