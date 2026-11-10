import { beforeAll, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { inflateSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument, PDFName, type PDFDict } from 'pdf-lib';
import { attachResources } from '../src/areaResources';
import { parseAreaTree, serializeAreaTree, walkAreaTree } from '../src/areaTree';
import { renderPdf } from '../src/pdfRenderer';
import type { GlyphArea } from '../src/types';
import { importXslFo } from '../src/xslfoImport';
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

describe('fo:bookmark の external-destination を PDF のしおりに出す (FO-16。XSL 1.1 §6.11.2・§7.23.6)', () => {
  const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
  /** すべての飛び先を通す設定 (既定では、ファイルを開く動作のしおりは書かない。test/linkPolicy.test.ts) */
  const LEGACY_LINKS = { schemes: ['*'], launch: true };
  const bm = (attrs: string, title: string, kids = '') => `<fo:bookmark ${attrs}><fo:bookmark-title>${title}</fo:bookmark-title>${kids}</fo:bookmark>`;
  const xml = `<?xml version="1.0"?><fo:root ${NS}>
    <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
    <fo:bookmark-tree>${bm('internal-destination="c1"', '中', bm('external-destination="url(other.pdf#page=3)"', '別の PDF'))}${bm(`external-destination="url('https://example.com/a?x=1#f')"`, '外')}${bm(
      'internal-destination="c1" external-destination="url(https://example.com/both)"',
      '両方',
    )}${bm('external-destination="notes/memo.txt"', 'ファイル')}${bm('', '無し')}</fo:bookmark-tree>
    <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block id="c1">章</fo:block></fo:flow></fo:page-sequence></fo:root>`;

  it('組版の結果のしおりが外への飛び先を持ち、Area Tree の直列化で落ちない', async () => {
    const { engine } = await makeEngine();
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { links: LEGACY_LINKS });
    expect(Object.keys(r.report.unsupported).join()).not.toContain('bookmark');
    const tree = engine.layout(r.document);
    const flat = (t: typeof tree) => t.bookmarks!.map((b) => [b.title, b.sheet, b.external]);
    expect(flat(tree)).toEqual([
      ['中', 0, undefined],
      ['外', -1, 'https://example.com/a?x=1#f'],
      // internal-destination もあれば、そちらを使う (§6.11.2)
      ['両方', 0, undefined],
      ['ファイル', -1, 'notes/memo.txt'],
      ['無し', -1, undefined],
    ]);
    expect(tree.bookmarks![0].children[0]).toMatchObject({ title: '別の PDF', sheet: -1, external: 'other.pdf#page=3' });
    const back = parseAreaTree(serializeAreaTree(tree));
    expect(back.bookmarks).toEqual(JSON.parse(JSON.stringify(tree.bookmarks)));
    expect(flat(back)).toEqual(flat(tree));
  });

  it('PDF のしおり: URL は URI の動作、相対の PDF は GoToR、ほかのファイルは Launch (リンクの注釈と同じ決まり)。中の飛び先は Dest のまま', async () => {
    const { fonts, engine } = await makeEngine();
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { links: LEGACY_LINKS });
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts, { links: LEGACY_LINKS }));
    const N = (n: string) => PDFName.of(n);
    const items: PDFDict[] = [];
    const root = pdf.context.lookup(pdf.catalog.get(N('Outlines'))) as PDFDict;
    for (let ref = root.get(N('First')); ref; ) {
      const d = pdf.context.lookup(ref) as PDFDict;
      items.push(d);
      ref = d.get(N('Next'));
    }
    expect(items.length).toBe(5);
    const action = (d: PDFDict) => d.lookup(N('A')) as PDFDict | undefined;
    const [inner, outer, both, file, none] = items;
    expect(inner.get(N('Dest'))).toBeDefined();
    expect(action(inner)).toBeUndefined();
    expect(String(action(outer)!.get(N('S')))).toBe('/URI');
    expect(String(action(outer)!.get(N('URI')))).toBe('(https://example.com/a?x=1#f)');
    expect(outer.get(N('Dest'))).toBeUndefined();
    expect(both.get(N('Dest'))).toBeDefined();
    expect(action(both)).toBeUndefined();
    expect(String(action(file)!.get(N('S')))).toBe('/Launch');
    expect(String(action(file)!.get(N('F')))).toBe('(notes/memo.txt)');
    expect(none.get(N('Dest'))).toBeUndefined();
    expect(action(none)).toBeUndefined();
    const child = pdf.context.lookup(inner.get(N('First'))) as PDFDict;
    expect(String(action(child)!.get(N('S')))).toBe('/GoToR');
    expect(String(action(child)!.get(N('F')))).toBe('(other.pdf)');
    expect(String(action(child)!.get(N('D')))).toBe('[ 2 /Fit ]');
  });
});
