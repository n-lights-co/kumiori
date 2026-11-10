import { beforeAll, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { attachResources } from '../src/areaResources';
import { walkAreaTree } from '../src/areaTree';
import { renderPdf } from '../src/pdfRenderer';
import type { GlyphArea } from '../src/types';
import { doc, fontBuffer, makeEngine } from './helpers';

/** 全体のレビューで見つけた、出力まわりの結果の誤り (OUT-15・FO-16・OUT-05 の残り) */

/** PDF の中の流れ (圧縮を解いたもの) の文字列 */
async function streams(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, o] of pdf.context.enumerateIndirectObjects()) {
    const raw = (o as unknown as { contents?: Uint8Array }).contents;
    if (!raw) continue;
    try {
      out.push(inflateSync(Buffer.from(raw)).toString('latin1'));
    } catch {
      out.push(Buffer.from(raw).toString('latin1'));
    }
  }
  return out;
}

describe('異体字の並び (IVS) の字形 (OUT-15。OpenType cmap format 14)', () => {
  const IVS = '\u{E0100}';
  let E: Awaited<ReturnType<typeof makeEngine>>;
  type Uvs = { varSelector: number; defaultUVS?: Array<{ startUnicodeValue: number; additionalCount: number }>; nonDefaultUVS?: Array<{ unicodeValue: number; glyphID: number }> };
  type Fk = { _cmapProcessor: { uvs: { varSelectors: { toArray(): Uvs[] } }; lookup(cp: number, vs?: number): number }; layout(t: string): { glyphs: Array<{ id: number; codePoints: number[] }> } };
  let fk: Fk;
  beforeAll(async () => {
    E = await makeEngine();
    fk = E.fonts.all()[0].fk as unknown as Fk;
  });

  it('非既定の表 (Non-Default UVS) の並びは、その表の字形。既定の表 (Default UVS) の並びは、基底の字の字形', () => {
    const cmap = fk._cmapProcessor;
    const sels = cmap.uvs.varSelectors.toArray();
    let nonDefault = 0;
    let wrong = 0;
    let defaults = 0;
    let wrongDefault = 0;
    for (const s of sels) {
      const inDefault = (cp: number) => (s.defaultUVS ?? []).some((r) => cp >= r.startUnicodeValue && cp <= r.startUnicodeValue + r.additionalCount);
      for (const m of s.nonDefaultUVS ?? []) {
        if (inDefault(m.unicodeValue)) continue;
        nonDefault++;
        if (cmap.lookup(m.unicodeValue, s.varSelector) !== m.glyphID) wrong++;
      }
      for (const r of s.defaultUVS ?? []) {
        defaults++;
        if (cmap.lookup(r.startUnicodeValue, s.varSelector) !== cmap.lookup(r.startUnicodeValue)) wrongDefault++;
      }
    }
    expect(nonDefault).toBeGreaterThan(1000);
    expect(wrong).toBe(0);
    expect(defaults).toBeGreaterThan(1000);
    expect(wrongDefault).toBe(0);
    // 兎 U+514E + U+E0100 は非既定の並び (基底の字とは別の字形)。書体が持たない並び (あ + U+E0100) は、基底の字の字形
    const rec = sels.find((s) => s.varSelector === 0xe0100)!;
    const gid = rec.nonDefaultUVS!.find((m) => m.unicodeValue === 0x514e)!.glyphID;
    expect(gid).not.toBe(cmap.lookup(0x514e));
    expect(fk.layout('兎' + IVS).glyphs.map((g) => [g.id, g.codePoints])).toEqual([[gid, [0x514e, 0xe0100]]]);
    expect(cmap.lookup(0x3042, 0xe0100)).toBe(cmap.lookup(0x3042));
  });

  it('pdf-lib が書体を読み直しても (別の fontkit の書体)、同じ引き方になる', async () => {
    const other = fontkit.create(new Uint8Array(await fontBuffer())) as unknown as Fk;
    expect(other).not.toBe(fk);
    expect(other.layout('兎' + IVS).glyphs[0].id).toBe(fk.layout('兎' + IVS).glyphs[0].id);
    expect(other.layout('兎' + IVS).glyphs[0].id).not.toBe(other.layout('兎').glyphs[0].id);
  });

  it('組んだ字の字形の番号・PDF に埋め込む字形・ToUnicode が、異体字の並びのものになる', async () => {
    const tree = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['兎' + IVS + '兎'] }] as never));
    attachResources(tree, E.fonts);
    const glyphs: GlyphArea[] = [];
    walkAreaTree(tree, (a) => {
      if (a.type === 'glyph') glyphs.push(a);
    });
    expect(glyphs.map((g) => g.text)).toEqual(['兎' + IVS, '兎']);
    const variant = fk.layout('兎' + IVS).glyphs[0].id;
    const base = fk.layout('兎').glyphs[0].id;
    expect(glyphs.map((g) => g.glyphIds)).toEqual([[variant], [base]]);
    // 送りは、異体字の字形の送り (全角) で、次の字はその分だけ進む
    expect(glyphs[1].x - glyphs[0].x).toBeCloseTo(10, 3);

    const all = await streams(await renderPdf(tree, E.fonts));
    // ToUnicode (ISO 32000-1 §9.10.3): 異体字の字形の符号は、基底の字 + 異体字セレクタ (UTF-16BE) を返す。基底の字の符号とは別
    const toUnicode = all.find((s) => s.includes('beginbfchar') || s.includes('beginbfrange'))!;
    const seq = /<([0-9A-Fa-f]{4})>\s*<514EDB40DD00>/i.exec(toUnicode);
    const plain = /<([0-9A-Fa-f]{4})>\s*<514E>/i.exec(toUnicode);
    expect(seq).not.toBeNull();
    expect(plain).not.toBeNull();
    expect(seq![1]).not.toBe(plain![1]);
    // ページの中身は、2 つの別の符号を書く
    const content = all.find((s) => /\bTj\b|\bTJ\b/.test(s))!;
    expect(content.toUpperCase()).toContain(seq![1].toUpperCase());
    expect(content.toUpperCase()).toContain(plain![1].toUpperCase());
  });
});
