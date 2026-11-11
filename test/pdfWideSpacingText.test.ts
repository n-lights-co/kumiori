/**
 * 字の間を広げた字の並びの、PDF からの字の取り出し (OUT-24)。
 * PDF に空白の字が無くても、字を取り出す側 (Poppler・PDFium など) は、字の間の広さから空白を推測する。字の間を、字の大きさの 0.1 倍以上に
 * 広げた字の並び (最後の行の両端揃え・letter-spacing・ルビの均等割り) には、元の字の並びを ActualText で書き添える
 * (ISO 32000-1 §14.9.4 置き換えの文字列・§14.6 印の付いた内容)。字の位置は変えない。広げていない行には付けない。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
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

const PAGE = '<style>@page { size: 120mm 80mm; margin: 10mm } body { font-size: 9pt; margin: 0 } p { margin: 0 } .j { text-align: justify; text-align-last: justify }</style>';

/** HTML を組んで、1 ページ目の内容 (命令の文字列) を返す */
async function contentOf(body: string): Promise<string> {
  const r = await typeset(`<!doctype html><html lang="ja"><head><meta charset="utf-8">${PAGE}</head><body>${body}</body></html>`, { loadFont });
  const pdf = await PDFDocument.load(await r.toPdf());
  const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
  const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((x) => pdf.context.lookup(x as never)) : [o]));
  return st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
}

/** 内容の中の ActualText (書かれた順)。BDC と EMC が入れ子にならずに対になっていることも確かめる */
function actualTexts(content: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const m of content.matchAll(/\/Span <<\/ActualText <FEFF([0-9A-F]*)>>> BDC|\bEMC\b/g)) {
    if (m[0] === 'EMC') depth--;
    else {
      depth++;
      out.push((m[1].match(/.{4}/g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join(''));
    }
    // ActualText の入れ子は不可 (ISO 32000-1 §14.9.4)
    expect(depth === 0 || depth === 1).toBe(true);
  }
  expect(depth).toBe(0);
  return out;
}

/** 内容から、印の付いた内容の区切り (BDC・EMC) を除き、分けた TJ・Tj をつなげた、字と字送りの並び (字の位置を表す) */
function glyphRuns(content: string): string {
  return content
    .replace(/\/Span <<\/ActualText <[0-9A-F]*>>> BDC\s*/g, '')
    .replace(/\s*\bEMC\b/g, '')
    .replace(/(<[0-9A-F]+>) Tj/g, '[$1] TJ')
    .replace(/\] TJ\s*\[/g, '');
}

describe('字の間を広げた字の並びの ActualText (OUT-24)', () => {
  it('最後の行も両端にそろえた和文の行: 行の字の並びを 1 つの ActualText で書き添える', async () => {
    const c = await contentOf('<p class="j">最後の行も両端にそろえる</p>');
    expect(actualTexts(c)).toEqual(['最後の行も両端にそろえる']);
  });
  it('letter-spacing で広げた字の並び (和文・欧文)。ほんものの空白の字は、ActualText の中にそのまま入る', async () => {
    expect(actualTexts(await contentOf('<p style="letter-spacing: 0.5em">字間を広げた行</p>'))).toEqual(['字間を広げた行']);
    expect(actualTexts(await contentOf('<p style="letter-spacing: 1em; font-family: sans-serif">type set</p>'))).toEqual(['type set']);
  });
  it('境 (字の大きさの 0.1 倍) より狭い字間・ふつうの行・語の間だけを広げた欧文の両端揃えには付けない', async () => {
    expect(actualTexts(await contentOf('<p style="letter-spacing: 0.05em">字間を少し広げた行</p>'))).toEqual([]);
    expect(actualTexts(await contentOf('<p style="text-align: justify">ふつうの段落です。約物（かっこ）や、句読点。が続いても、字の間は広がらないはずの行で、二行目に折り返します。これは二行目です。</p>'))).toEqual([]);
    expect(actualTexts(await contentOf('<p class="j">abc def ghi</p>'))).toEqual([]);
  });
  it('字の位置 (字送りの調整) は、ActualText を付けても変わらない', async () => {
    // 境のすぐ下 (付かない) と、すぐ上 (付く) で、字の並びの書き方が同じ形 (1 つの TJ) になる
    const c = await contentOf('<p class="j">最後の行も両端にそろえる</p>');
    const run = glyphRuns(c).match(/\[(<[0-9A-F]+>(-?[\d.]+)?)+\] TJ/g) ?? [];
    // 12 字が、11 個の同じ空きで並ぶ (1 つの並び)
    const line = run.find((x) => (x.match(/</g) ?? []).length === 12)!;
    expect(line).toBeDefined();
    const gaps = [...line.matchAll(/>(-?[\d.]+)</g)].map((m) => Number(m[1]));
    expect(gaps.length).toBe(11);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 1);
    expect(gaps[0]).toBeLessThan(-100);
  });
  it('別の領域の字 (表の別のセル) は、同じ高さに並んでいても 1 つの ActualText にまとめない', async () => {
    const c = await contentOf('<table style="width: 80mm"><tr><th style="text-align: left">値</th><th style="text-align: left">意味</th></tr></table>');
    expect(actualTexts(c)).toEqual([]);
  });
  it('行内の箱で分かれた字の並びは、箱ごとに付ける (箱の境の空きは、並びの切れ目)', async () => {
    const c = await contentOf('<p class="j">最後の<span>行も</span>両端にそろえる</p>');
    expect(actualTexts(c)).toEqual(['最後の', '行も', '両端にそろえる']);
  });
  it('ルビの均等割り: ルビの字の並びに付ける。親文字 (広げていない) には付けない', async () => {
    const c = await contentOf('<p><ruby>均等割付<rt>きん</rt></ruby></p>');
    expect(actualTexts(c)).toEqual(['きん']);
  });
  it('字の単位に ActualText を付ける用字 (デーヴァナーガリー)・右から左の文字 (アラビア文字) を広げても、ActualText は入れ子にならない', async () => {
    // actualTexts が、入れ子でないこと・対になっていることを確かめる
    const c = await contentOf('<p style="letter-spacing: 0.4em">हिन्दी की पंक्ति</p><p style="letter-spacing: 0.4em">كتاب بلا</p><p class="j">和文と हिन्दी と كتاب の混じる行</p>');
    expect(actualTexts(c).length).toBeGreaterThan(0);
  });
  it('縦書きの行 (縦書きの書体の字の並び。OUT-26) も、広げた行には付ける。広げていない行には付けない', async () => {
    const c = await contentOf('<div style="writing-mode: vertical-rl"><p class="j">最後の行も両端にそろえる</p><p style="letter-spacing: 0.5em">字間を広げた行</p><p>ふつうの行</p></div>');
    expect(actualTexts(c)).toEqual(['最後の行も両端にそろえる', '字間を広げた行']);
  });
});
