/**
 * 透明の字の色 (color: transparent・alpha が 0 の rgba() など)。CSS Color 4 §4.1・§6.3: transparent は alpha が 0 の色で、color の値にもなる。
 * 字は場所を取り (行分け・幅・位置は color を書かないときと同じ)、塗らない。currentColor を受ける下線・圏点・罫線も透明になる
 * (CSS Color 4 §6.4)。子が color を書き直せば、その色で描く。前は色が無いものとして親の色を受け継ぎ、親の色で描いていた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, decodePDFRawStream, type PDFArray } from 'pdf-lib';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const doc = (css: string, body: string) =>
  `<!doctype html><html lang="en"><head><style>@page { size: 120mm 60mm; margin: 10mm } body { margin: 0; font-size: 12pt; line-height: 20pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;

interface G { text: string; x: number; y: number; color: string }
async function glyphs(html: string): Promise<G[]> {
  const t = (await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' })).areaTree;
  const out: G[] = [];
  const rec = (a: AreaNode, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ text: (a as GlyphArea).text, x, y, color: (a as GlyphArea).color });
    for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0), y + a.padding.top + (a.border.top?.width ?? 0));
  };
  rec(t.sheets[0], 0, 0);
  return out.filter((g) => g.text.trim());
}
/** 1 ページ目の内容の命令 */
async function pdfOps(html: string): Promise<string> {
  const r = await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' });
  const d = await PDFDocument.load(await r.toPdf());
  const c = d.getPage(0).node.Contents()!;
  const streams = 'asArray' in c ? (c as PDFArray).asArray().map((x) => d.context.lookup(x)) : [c];
  return streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st as never).decode())).join('\n');
}
/** 字を描く命令 (Tj・TJ) で描く字の数 (字の番号は 2 バイト = 16 進の 4 桁) */
const shows = (ops: string) =>
  ops.split('\n').filter((l) => /\b(Tj|TJ)$/.test(l.trim())).reduce((n, l) => n + [...l.matchAll(/<([0-9a-fA-F]*)>/g)].reduce((k, m) => k + m[1].length / 4, 0), 0);
/** 塗り・線の命令 (f・S・B) の数 */
const paints = (ops: string) => (ops.match(/(^|\s)(f\*?|S|B\*?)(?=\s|$)/g) ?? []).length;

describe('透明の字の色', () => {
  const plain = doc('', '<p>AA<span>BB</span>CC</p>');
  // 8 ビットの透明度で 0 になる色 (rgba(…, 0.001)・0.1%) も、描いても見えないので、透明と同じに描かない
  for (const v of ['transparent', 'rgba(255, 0, 0, 0)', '#ff000000', 'rgba(255, 0, 0, 0.001)', 'rgb(255 0 0 / 0.1%)']) {
    it(`color: ${v} の字は塗らず、場所はそのまま (親の色で描かない)`, async () => {
      const html = doc('', `<p>AA<span style="color: ${v}">BB</span>CC</p>`);
      const g = await glyphs(html);
      const base = await glyphs(plain);
      expect(g.map((x) => x.text).join('')).toBe(base.map((x) => x.text).join(''));
      for (let i = 0; i < g.length; i++) {
        expect(g[i].x).toBeCloseTo(base[i].x, 2);
        expect(g[i].y).toBeCloseTo(base[i].y, 2);
      }
      expect(g.filter((x) => x.text.includes('B')).every((x) => x.color === 'transparent')).toBe(true);
      expect(g.filter((x) => !x.text.includes('B')).every((x) => x.color !== 'transparent')).toBe(true);
      // PDF: 「BB」の字を描かない (「AA」「CC」の 4 字だけ)
      expect(shows(await pdfOps(plain))).toBe(6);
      expect(shows(await pdfOps(html))).toBe(4);
    });
  }
  it('子が color を書き直せば、その色で描く', async () => {
    const g = await glyphs(doc('', '<p>AA<span style="color: transparent">B<span style="color: #ff0000">R</span>B</span></p>'));
    expect(g.find((x) => x.text.includes('R'))!.color).toBe('#ff0000');
    expect(g.filter((x) => x.text.includes('B')).every((x) => x.color === 'transparent')).toBe(true);
  });
  it('currentColor を受ける下線・罫線も描かない (CSS Color 4 §6.4)', async () => {
    const deco = (col: string) => doc('', `<p>AA<span style="color: ${col}; text-decoration: underline; border: 1pt solid currentColor">BB</span></p>`);
    const vis = await pdfOps(deco('#000000'));
    const none = await pdfOps(doc('', '<p>AA<span>BB</span></p>'));
    expect(paints(vis)).toBeGreaterThan(paints(none));
    expect(paints(await pdfOps(deco('transparent')))).toBe(paints(none));
  });
  it('見えない親 (visibility: hidden) の中の visible の子も、自分の color: transparent のまま', async () => {
    const g = await glyphs(doc('', '<p>AA<span style="visibility: hidden">H<span style="visibility: visible; color: transparent">V</span></span></p>'));
    expect(g.find((x) => x.text.includes('V'))!.color).toBe('transparent');
  });
});
