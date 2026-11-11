/**
 * 縦書きの行の、PDF からの字の取り出し (OUT-26 の (1))。
 * 縦書きの行の正立の字を、横書きの書体の字として 1 字ずつ位置を決めて置くと、字を取り出す側 (Poppler など) は、1 字ずつ別の行と見る。
 * 縦書きの書体 (CMap の WMode が 1 の Type 0 書体。ISO 32000-1 §9.7.5) の字として、1 行をひと続きの字の並び (TJ) で書く:
 * 字は縦書きの原点 (§9.7.4.3 の位置のベクトル) で置かれ、上から下へ送られる。字形の位置は変えない (テキストの位置を、位置のベクトルの分ずらす)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { DEFAULT_FONTS, typeset, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const MM = 72 / 25.4;
/** 用紙 100mm × 120mm、余白 10mm、字は 10pt、行の幅は字の大きさと同じ (行の中央 = 字の中央)。字下げは無し */
const W = 100 * MM;
const H = 120 * MM;
const M = 10 * MM;
const PAGE = '<style>@page { size: 100mm 120mm; margin: 10mm } body { font-size: 10pt; line-height: 1; margin: 0 } p { margin: 0; text-indent: 0 } .j { text-align: justify; text-align-last: justify }</style>';

interface Shown {
  /** 字を書く命令 (Tj・TJ) のときの書体の名前 (資源の名前) */
  font: string;
  /** 命令の前の Tm (続きの命令なら undefined) */
  tm?: number[];
  /** TJ の中身 (字の符号と数) */
  items: Array<string | number>;
  /** 印の付いた内容の中なら、その ActualText */
  actual?: string;
}

/** HTML を組んで、PDF と 1 ページ目の内容 (命令の文字列) を返す */
async function build(body: string, root = ''): Promise<{ pdf: PDFDocument; content: string; bytes: Uint8Array }> {
  const r = await typeset(`<!doctype html><html lang="ja"${root}><head><meta charset="utf-8">${PAGE}</head><body>${body}</body></html>`, { loadFont });
  const bytes = await r.toPdf();
  const pdf = await PDFDocument.load(bytes);
  const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
  const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((x) => pdf.context.lookup(x as never)) : [o]));
  const content = st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
  return { pdf, content, bytes };
}

const utf16 = (hex: string) => (hex.match(/.{4}/g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join('');

/** 内容の中の、字を書く命令の並び (書いた順) */
function shown(content: string): Shown[] {
  const out: Shown[] = [];
  let font = '';
  let tm: number[] | undefined;
  let actual: string | undefined;
  const re = /\/(\S+) [\d.]+ Tf|((?:-?[\d.]+ ){6})Tm|\[((?:<[0-9A-F]+>|-?[\d.]+)+)\] TJ|(<[0-9A-F]+>) Tj|\/Span <<\/ActualText <FEFF([0-9A-F]*)>>> BDC|\bEMC\b/g;
  for (const m of content.matchAll(re)) {
    if (m[1]) font = m[1];
    else if (m[2]) tm = m[2].trim().split(' ').map(Number);
    else if (m[3] || m[4]) {
      const items = [...(m[3] ?? m[4]).matchAll(/<([0-9A-F]+)>|(-?[\d.]+)/g)].map((x) => (x[1] !== undefined ? x[1] : Number(x[2])));
      out.push({ font, tm, items, actual });
      tm = undefined;
    } else if (m[5] !== undefined) actual = utf16(m[5]);
    else actual = undefined;
  }
  return out;
}

/** ページの資源の書体の辞書 (資源の名前 → Type 0 書体の辞書) */
function fontDicts(pdf: PDFDocument): Map<string, PDFDict> {
  const fonts = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  return new Map(fonts.entries().map(([k, v]) => [k.decodeText(), pdf.context.lookup(v, PDFDict)]));
}
const isVertical = (d: PDFDict) => d.get(PDFName.of('Encoding')) === PDFName.of('Identity-V');
const cidFontOf = (pdf: PDFDocument, d: PDFDict) => pdf.context.lookup(d.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict);

/** CIDFont の W (CID → 横の送り) */
function widths(cid: PDFDict): Map<number, number> {
  const out = new Map<number, number>();
  const w = cid.lookup(PDFName.of('W'), PDFArray);
  for (let i = 0; i < w.size(); ) {
    const first = (w.lookup(i) as PDFNumber).asNumber();
    const next = w.lookup(i + 1);
    if (next instanceof PDFArray) {
      for (let k = 0; k < next.size(); k++) out.set(first + k, (next.lookup(k) as PDFNumber).asNumber());
      i += 2;
    } else {
      for (let c = first; c <= (next as PDFNumber).asNumber(); c++) out.set(c, (w.lookup(i + 2) as PDFNumber).asNumber());
      i += 3;
    }
  }
  return out;
}

describe('縦書きの行を、縦書きの書体の字の並びで書く (OUT-26)', () => {
  it('縦書きの行の正立の字は、縦書きの書体 (Identity-V) の、行ごとに 1 つの字の並びになる', async () => {
    const { pdf, content } = await build('<p>縦書きの文を検索する。</p><p>二行目の文も、続けて読める</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const runs = shown(content).filter((s) => isVertical(fonts.get(s.font)!));
    // 2 つの行が、それぞれ Tm 1 つで始まる字の並び (1 行目は 2 つの命令に分かれる: 下の「隣の行」の試験)
    expect(runs.filter((s) => s.tm).length).toBe(2);
    expect(runs.flatMap((s) => s.items).filter((x) => typeof x === 'string').length).toBe(11 + 13);
    // 字を詰める向き・広げる向きの調整は無い (全角の字が、送り 1000 で並ぶ)。あるのは、字ごとの位置の丸めの差 (0.01/1000 em ほど) だけ
    for (const n of runs.flatMap((s) => s.items).filter((x): x is number => typeof x === 'number')) expect(Math.abs(n)).toBeLessThan(0.02);
    // 書体: Encoding が Identity-V の Type 0 書体で、横書きの書体と同じ CIDFont・ToUnicode を指す
    const v = [...fonts.values()].find(isVertical)!;
    // (横書きの書体の辞書は、このページでは使っていないので、文書の中から探す)
    const h = pdf.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .find((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Subtype')) === PDFName.of('Type0') && !isVertical(o) && o.get(PDFName.of('BaseFont')) === v.get(PDFName.of('BaseFont')))!;
    expect(h).toBeDefined();
    expect(v.get(PDFName.of('Subtype'))).toBe(PDFName.of('Type0'));
    expect((v.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0) as PDFRef).objectNumber).toBe((h.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0) as PDFRef).objectNumber);
    expect(v.get(PDFName.of('ToUnicode'))).toBe(h.get(PDFName.of('ToUnicode')));
    // 縦書きの字の送りと原点 (DW2 = [原点の縦の位置, 縦の送り])
    const dw2 = cidFontOf(pdf, v).lookup(PDFName.of('DW2'), PDFArray);
    expect([0, 1].map((k) => (dw2.lookup(k) as PDFNumber).asNumber())).toEqual([880, -1000]);
  });

  it('字形の位置は変わらない: テキストの位置は、横書きの原点 + 位置のベクトル (送りの半分, 880)/1000 em = 行の中央の上端', async () => {
    const { pdf, content } = await build('<p>縦書きの文</p><p>二行目</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const starts = shown(content).filter((s) => isVertical(fonts.get(s.font)!) && s.tm);
    // 1 行目: 版面の右端から半字、上端。2 行目: その 1 行 (10pt) 左
    expect(starts[0].tm!.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(starts[0].tm![4]).toBeCloseTo(W - M - 5, 2);
    expect(starts[0].tm![5]).toBeCloseTo(H - M, 2);
    expect(starts[1].tm![4]).toBeCloseTo(W - M - 15, 2);
    expect(starts[1].tm![5]).toBeCloseTo(H - M, 2);
  });

  it('字の間を広げた行 (両端揃え) は、字の間の空きを TJ の正の数 (下へ送る) で書く。字を詰める所は Tm から書き直す (TJ に負の数を書かない)', async () => {
    const { pdf, content } = await build('<div style="height: 60mm"><p class="j">両端にそろえる行</p><p>読点、。も「かぎ」（括弧）も続く。</p></div>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const runs = shown(content).filter((s) => isVertical(fonts.get(s.font)!));
    const nums = runs.flatMap((s) => s.items).filter((x): x is number => typeof x === 'number');
    // 8 字を 60mm に: 空きは (60mm − 80pt) / 7 = 12.87pt = 1287/1000 em
    expect(nums.filter((n) => n > 1000).length).toBe(7);
    for (const n of nums.filter((x) => x > 1000)) expect(n).toBeCloseTo(((60 * MM - 80) / 7) * 100, 1);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(-20);
    // 続く約物を詰めた所で、字の並びが分かれている (2 行目の Tm が 2 つ以上)
    const second = runs.filter((s) => s.tm && Math.abs(s.tm[4] - (W - M - 15)) < 0.01);
    expect(second.length).toBeGreaterThan(1);
    // 広げた行には、元の字の並びを書き添える (OUT-24 と同じ)
    expect(runs.find((s) => s.actual)?.actual).toBe('両端にそろえる行');
  });

  it('上端のそろった左隣の行が続く行は、字の並びを 2 つの命令に分ける (PDFium が、行の順を入れ替えないように)', async () => {
    const { pdf, content } = await build('<p>一行目の文です</p><p>二行目の文です</p><p>三</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const runs = shown(content).filter((s) => isVertical(fonts.get(s.font)!));
    // 1 行目・2 行目: Tm で始まる命令と、続きの命令 (後ろの 2 字)。3 行目 (最後の行) は分けない
    const glyphs = (s: Shown) => s.items.filter((x) => typeof x === 'string').length;
    expect(runs.map((s) => [!!s.tm, glyphs(s)])).toEqual([[true, 5], [false, 2], [true, 5], [false, 2], [true, 1]]);
    expect(content).toMatch(/\] TJ\n\[<[0-9A-F]{4}>(-?[\d.]+)?<[0-9A-F]{4}>\] TJ/);
  });

  it('縦中横: 枠の字を縦書きの書体の字として置き、枠に字の並び (ActualText) を書き添える。1 字の縦中横は、ふつうの字と同じ', async () => {
    const { pdf, content } = await build('<p>平成<span style="text-combine-upright: all">12</span>年<span style="text-combine-upright: all">5</span>月</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const all = shown(content);
    // 字はすべて縦書きの書体 (ノンブルを除く)
    const body = all.filter((s) => !s.tm || s.tm[5] > M + 1);
    expect(body.every((s) => isVertical(fonts.get(s.font)!))).toBe(true);
    const tcy = body.filter((s) => s.actual === '12');
    // 2 字が、同じ高さに、左右に並ぶ (1 字ずつ Tm から)
    expect(tcy.length).toBe(2);
    expect(tcy[0].tm![5]).toBeCloseTo(H - M - 20, 2);
    expect(tcy[1].tm![5]).toBeCloseTo(tcy[0].tm![5], 4);
    expect(tcy[1].tm![4]).toBeGreaterThan(tcy[0].tm![4]);
    // 印の付いた内容は入れ子にならず、対になっている
    expect((content.match(/ BDC/g) ?? []).length).toBe(1);
    expect((content.match(/\bEMC\b/g) ?? []).length).toBe(1);
    // 1 字の縦中横 (5) には付けない
    expect(body.filter((s) => s.actual !== undefined && s.actual !== '12')).toEqual([]);
  });

  it('全角でない正立の字 (text-orientation: upright の欧字): 縦書きの原点の横の位置を W2 に書き、テキストの位置は行の中央', async () => {
    const { pdf, content } = await build('<p style="text-orientation: upright">AiW</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const runs = shown(content).filter((s) => isVertical(fonts.get(s.font)!));
    expect(runs.flatMap((s) => s.items).filter((x) => typeof x === 'string').length).toBe(3);
    const cid = cidFontOf(pdf, fonts.get(runs[0].font)!);
    const w = widths(cid);
    const w2 = cid.lookup(PDFName.of('W2'), PDFArray);
    // W2 = [c [w1y vx vy …] …]: 縦の送り −1000、原点は (横の送りの半分を整数に丸めた値, 880)
    const seen = new Map<number, number[]>();
    for (let i = 0; i < w2.size(); i += 2) {
      const first = (w2.lookup(i) as PDFNumber).asNumber();
      const list = w2.lookup(i + 1, PDFArray);
      for (let k = 0; k < list.size(); k += 3) seen.set(first + k / 3, [0, 1, 2].map((j) => (list.lookup(k + j) as PDFNumber).asNumber()));
    }
    const codes = runs.flatMap((s) => s.items).filter((x): x is string => typeof x === 'string').map((x) => parseInt(x, 16));
    for (const c of codes) expect(seen.get(c)).toEqual([-1000, Math.round(w.get(c)! / 2), 880]);
    // 字は行の中央にそろうので、テキストの位置 (縦書きの原点) の横の位置は、どの字も行の中央 (丸めの分の差は 1/1000 em 未満)
    for (const s of runs.filter((x) => x.tm)) expect(Math.abs(s.tm![4] - (W - M - 5))).toBeLessThan(0.01);
  });

  it('横倒しの字 (欧文) は、これまでどおり、回したテキストの行列の横書きの書体の字の並び', async () => {
    const { pdf, content } = await build('<p>縦書きとABCの行</p>', ' style="writing-mode: vertical-rl"');
    const fonts = fontDicts(pdf);
    const side = shown(content).filter((s) => s.tm && s.tm[0] === 0 && s.tm[1] === -1 && s.tm[2] === 1 && s.tm[3] === 0);
    expect(side.length).toBe(1);
    expect(isVertical(fonts.get(side[0].font)!)).toBe(false);
    expect(side[0].items.filter((x) => typeof x === 'string').join('').length).toBe(3 * 4);
  });

  it('横書きの文書には、縦書きの書体も、縦書きの字の送りも書かない (これまでと同じ)', async () => {
    const { pdf, bytes } = await build('<p>横書きの文です。ABC と 12 も入れる。</p>');
    expect([...fontDicts(pdf).values()].some(isVertical)).toBe(false);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).not.toContain('Identity-V');
    for (const d of fontDicts(pdf).values()) expect(cidFontOf(pdf, d).get(PDFName.of('DW2'))).toBeUndefined();
  });

  it('入稿用 (PDF/X) の出力・部分書体にしない埋め込みでも、縦書きの書体の辞書が書かれ、読み直せる', async () => {
    const r = await typeset(`<!doctype html><html lang="ja" style="writing-mode: vertical-rl"><head><meta charset="utf-8">${PAGE}</head><body><p>縦書きの文</p></body></html>`, { loadFont });
    for (const opts of [{ pdfx: {} }, { subset: false }]) {
      const pdf = await PDFDocument.load(await r.toPdf(opts as never), { updateMetadata: false });
      const v = [...fontDicts(pdf).values()].filter(isVertical);
      expect(v.length).toBe(1);
      // 縦書きの書体の辞書が指す CIDFont は、書体のデータ (FontFile2・FontFile3) を持つ
      const desc = cidFontOf(pdf, v[0]).lookup(PDFName.of('FontDescriptor'), PDFDict);
      expect(desc.get(PDFName.of('FontFile2')) ?? desc.get(PDFName.of('FontFile3'))).toBeDefined();
    }
  });

  it('横書きの文書の中の縦書きの箱・表のセルの中の縦書きも、縦書きの書体の字の並びになる。箱の外の横書きの行は変わらない', async () => {
    const { pdf, content } = await build(
      '<p>横書きの行</p><div style="writing-mode: vertical-rl; height: 40mm"><p>縦書きの箱の文</p><table><tr><td>表のセル</td></tr></table></div>',
    );
    const fonts = fontDicts(pdf);
    const runs = shown(content);
    const count = (s: Shown) => s.items.filter((x) => typeof x === 'string').join('').length / 4;
    const v = runs.filter((s) => isVertical(fonts.get(s.font)!));
    expect(v.map(count).reduce((a, b) => a + b, 0)).toBe(7 + 4);
    const horiz = runs.filter((s) => !isVertical(fonts.get(s.font)!) && s.tm && s.tm[5] > H - M - 12);
    expect(horiz.map(count).reduce((a, b) => a + b, 0)).toBe(5);
  });
});
