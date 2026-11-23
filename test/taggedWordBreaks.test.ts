/**
 * タグ付き PDF を構造の順に読んだときの、行の区切り (ISO 32000-1 §14.8.2.5 の語の区切りと分綴のハイフン、§14.9.4 の置き換えの文字列):
 *  - 空白の所で分けた行は、行の最後の字の後ろに、行末で捨てた空白を字として書く (前の行の終わりの語と次の行の初めの語がつながらない)
 *  - 分綴で行末に足したハイフンは、その印の付いた内容の ActualText をソフトハイフン (U+00AD) にする (読む字のハイフンにしない)
 *  - 段落の終わり・強制改行の行・分綴した行には、空白を足さない。タグを付けない PDF は変えない
 * 領域の木には、GlyphArea.hyphen (分綴で足した字) と GlyphArea.breakSpace (行末で捨てた空白) の印を付ける
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const decode = (s: PDFRawStream) => new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());

/** 書体の ToUnicode (bfchar・bfrange。ISO 32000-1 §9.10.3) を、2 バイトの符号 → 字の表にする */
function toUnicodeOf(font: PDFDict): Map<string, string> {
  const map = new Map<string, string>();
  const s = font.lookup(PDFName.of('ToUnicode'));
  if (!(s instanceof PDFRawStream)) return map;
  const cmap = decode(s);
  const hexText = (h: string) => {
    let t = '';
    for (let i = 0; i + 4 <= h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return t;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(m[1].toUpperCase(), hexText(m[2]));
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const dst = m[3].startsWith('[') ? [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexText(x[1])) : undefined;
      for (let c = lo; c <= hi; c++) {
        const key = c.toString(16).toUpperCase().padStart(m[1].length, '0');
        if (dst) map.set(key, dst[c - lo] ?? '');
        else {
          const base = m[3].slice(1, -1);
          const last = parseInt(base.slice(-4), 16) + (c - lo);
          map.set(key, hexText(base.slice(0, -4) + last.toString(16).padStart(4, '0')));
        }
      }
    }
  return map;
}

/** 1 ページ目の印の付いた内容 (MCID) ごとの字 (ActualText があれば、それに置き換えたもの) */
function mcidTexts(pdf: PDFDocument): Map<number, string> {
  const page = pdf.getPage(0).node;
  const fonts = page.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const tables = new Map<string, Map<string, string>>();
  for (const [name, ref] of fonts.entries()) tables.set(name.asString(), toUnicodeOf(pdf.context.lookup(ref) as PDFDict));
  const c = page.get(PDFName.of('Contents'));
  const ops = (c instanceof PDFArray ? c.asArray() : [c]).map((r) => decode(pdf.context.lookup(r as PDFRef) as PDFRawStream)).join('\n');
  const out = new Map<number, string>();
  const stack: Array<{ mcid?: number; actual?: string; text: string }> = [];
  let font: Map<string, string> | undefined;
  const show = (hex: string) => {
    const h = hex.replace(/\s/g, '');
    let t = '';
    for (let i = 0; i + 4 <= h.length; i += 4) t += font?.get(h.slice(i, i + 4).toUpperCase()) ?? '?';
    const top = stack[stack.length - 1];
    if (top) top.text += t;
  };
  const re = /\/([^\s<>/[\]]+)\s*<<([\s\S]*?)>>\s*BDC|\/[^\s/]+\s+BMC|\bEMC\b|\/([^\s/]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>\s*Tj|\[([^\]]*)\]\s*TJ/g;
  for (const m of ops.matchAll(re)) {
    if (m[1] !== undefined) {
      const mcid = /\/MCID\s+(\d+)/.exec(m[2])?.[1];
      const actual = /\/ActualText\s*<([0-9A-Fa-f]+)>/.exec(m[2])?.[1];
      stack.push({ mcid: mcid === undefined ? undefined : Number(mcid), actual: actual === undefined ? undefined : PDFHexString.of(actual).decodeText(), text: '' });
    } else if (m[0].endsWith('BMC')) stack.push({ text: '' });
    else if (m[0] === 'EMC') {
      const top = stack.pop()!;
      const text = top.actual ?? top.text;
      if (top.mcid !== undefined) out.set(top.mcid, (out.get(top.mcid) ?? '') + text);
      else if (stack.length) stack[stack.length - 1].text += text;
    } else if (m[3] !== undefined) font = tables.get(`/${m[3]}`);
    else if (m[4] !== undefined) show(m[4]);
    else if (m[5] !== undefined) for (const h of m[5].matchAll(/<([0-9A-Fa-f\s]*)>/g)) show(h[1]);
  }
  return out;
}

/** 構造の型 role の節ごとの、構造の順に読んだ字 (子の節の字も、K の順に入れる) */
function structTexts(pdf: PDFDocument, role: string): string[] {
  const texts = mcidTexts(pdf);
  const ctx = pdf.context;
  const read = (d: PDFDict): string => {
    const k = d.get(PDFName.of('K'));
    const list = k instanceof PDFArray ? k.asArray() : k ? [k] : [];
    return list
      .map((x) => {
        if (x instanceof PDFNumber) return texts.get(x.asNumber()) ?? '';
        const obj = x instanceof PDFRef ? ctx.lookup(x) : x;
        if (!(obj instanceof PDFDict)) return '';
        if (String(obj.get(PDFName.of('Type'))) === '/MCR') return texts.get((obj.get(PDFName.of('MCID')) as PDFNumber).asNumber()) ?? '';
        return read(obj);
      })
      .join('');
  };
  const found: string[] = [];
  const walk = (d: PDFDict) => {
    if (String(d.get(PDFName.of('S'))) === `/${role}`) found.push(read(d));
    const k = d.get(PDFName.of('K'));
    for (const x of k instanceof PDFArray ? k.asArray() : k ? [k] : []) {
      const obj = x instanceof PDFRef ? ctx.lookup(x) : x;
      if (obj instanceof PDFDict && obj.get(PDFName.of('S'))) walk(obj);
    }
  };
  walk(pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('K'), PDFDict));
  return found;
}

const SENTENCE = 'Typesetting internationalization extraordinarily comprehensive documentation characteristically demonstrates hyphenation behaviour.';
const html = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title><style>@page { size: 200pt 400pt; margin: 20pt } body { margin: 0; font-size: 10pt } p { width: 110pt; hyphens: auto } ${css}</style></head><body>${body}</body></html>`;

describe('タグ付き PDF を構造の順に読んだときの、行の区切り (OUT-90)', () => {
  it('領域の木: 分綴で足したハイフンに hyphen、空白の所で分けた行の最後の字に breakSpace (段落の終わり・強制改行の行には付けない)', async () => {
    const r = await typesetHtml(html(`<p>${SENTENCE}</p><p>alpha beta<br>gamma delta</p>`), { loadFont: loadCachedFont });
    const lines: GlyphArea[][] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'line') lines.push([]);
      if (a.type === 'glyph') lines[lines.length - 1].push(a);
    });
    const texts = lines.map((l) => l.map((g) => g.text).join(''));
    // 分綴した行は、行末のハイフンにだけ hyphen が付き、breakSpace は付かない
    const hyphenated = lines.filter((l) => l[l.length - 1].hyphen);
    expect(hyphenated.length).toBeGreaterThan(0);
    for (const l of hyphenated) {
      expect(l[l.length - 1].text).toBe('-');
      expect(l.some((g) => g.breakSpace !== undefined)).toBe(false);
      expect(l.slice(0, -1).some((g) => g.hyphen)).toBe(false);
    }
    // 空白の所で分けた行は、行の最後の字にだけ breakSpace が付く
    const spaced = lines.filter((l) => l[l.length - 1].breakSpace !== undefined);
    expect(spaced.length).toBeGreaterThan(0);
    for (const l of spaced) {
      expect(l[l.length - 1].breakSpace).toBe(' ');
      expect(l.slice(0, -1).some((g) => g.breakSpace !== undefined)).toBe(false);
    }
    // 段落の終わりの行と、強制改行で終わる行 (alpha beta) には付かない
    const lastOf = (t: string) => lines[texts.findIndex((x) => x.includes(t))];
    expect(lastOf('behaviour.').at(-1)!.breakSpace).toBeUndefined();
    expect(lastOf('alpha beta').at(-1)!.breakSpace).toBeUndefined();
    expect(lastOf('gamma delta').at(-1)!.breakSpace).toBeUndefined();
    // 組版の結果 (字の位置) は、印のほかは変わらない: 入力の字は、行をつないで空白を戻すと元の文になる
    const joined = lines
      .slice(0, texts.findIndex((x) => x.includes('behaviour.')) + 1)
      .map((l) => l.map((g) => (g.hyphen ? '' : g.text + (g.breakSpace ?? ''))).join(''))
      .join('');
    expect(joined).toBe(SENTENCE);
  });

  it('タグ付き PDF: 構造の順に読むと、行末の空白があり、分綴のハイフンはソフトハイフン (U+00AD)', async () => {
    const r = await typesetHtml(html(`<p>${SENTENCE}</p><p>Words in a <span lang="fr">span élément</span> wrap along the narrow column width here.</p>`), { loadFont: loadCachedFont });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const [p1, p2] = structTexts(pdf, 'P');
    // 読む字では、分綴のハイフンをソフトハイフンにした元の文になる
    expect(p1.replace(/­/g, '')).toBe(SENTENCE);
    expect(p1).toMatch(/­/);
    expect(p1).not.toMatch(/[a-z]-[a-z]/);
    // 行の終わりの語と次の行の初めの語の間に空白がある (Span の中で行が分かれても)
    expect(p2.replace(/­/g, '')).toBe('Words in a span élément wrap along the narrow column width here.');
    // ハイフンの印の付いた内容は入れ子にせず、構造の節の印の付いた内容 (MCID) の辞書に ActualText を書く
    const ops = (() => {
      const c = pdf.getPage(0).node.get(PDFName.of('Contents'));
      return (c instanceof PDFArray ? c.asArray() : [c]).map((x) => decode(pdf.context.lookup(x as PDFRef) as PDFRawStream)).join('\n');
    })();
    expect(ops).toMatch(/\/P <<\s*\/MCID \d+\s*\/ActualText <FEFF00AD>\s*>> BDC/);
    expect(ops).not.toMatch(/\/Span <<\s*\/ActualText <FEFF00AD>/);
  });

  it('XSL-FO も同じ (分綴は hyphenate="true")', async () => {
    const fo = `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150pt" page-height="400pt"><fo:region-body margin="20pt"/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block hyphenate="true" font-size="10pt">${SENTENCE}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typesetFo(fo, { loadFont: loadCachedFont });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const [p] = structTexts(pdf, 'P');
    expect(p.replace(/­/g, '')).toBe(SENTENCE);
    expect(p).toMatch(/­/);
  });

  it('タグを付けない PDF には、空白の字もソフトハイフンの置き換えの文字列も書かない', async () => {
    const r = await typesetHtml(html(`<p>${SENTENCE}</p>`), { loadFont: loadCachedFont, tagged: false });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const c = pdf.getPage(0).node.get(PDFName.of('Contents'));
    const ops = (c instanceof PDFArray ? c.asArray() : [c]).map((x) => decode(pdf.context.lookup(x as PDFRef) as PDFRawStream)).join('\n');
    expect(ops).not.toContain('FEFF00AD');
    expect(pdf.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
  });
});
