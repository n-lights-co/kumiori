import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { countFonts, normalizeFamily, splitFontFile } from '../src/fontLoader';
import { importXslFo } from '../src/xslfoImport';
import { FAMILY, fontBuffer, fontDir, makeEngine } from './helpers';

// 下の ttf() と、置き場のファイルを直に読むテストのために、Noto Serif JP を置き場に用意しておく (このファイルだけを走らせても、置き場が空でも通るように)
beforeAll(async () => {
  await fontBuffer();
}, 300_000);
const ttf = (): ArrayBuffer => {
  const b = fs.readFileSync(path.join(fontDir, 'NotoSerifJP-Regular.ttf'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** 同じ書体を n 個並べた TTC を作る (テーブルは共有。オフセットは絶対位置) */
function makeTtc(src: ArrayBuffer, n: number): ArrayBuffer {
  const v = new DataView(src);
  const numTables = v.getUint16(4);
  const dirLen = 12 + numTables * 16;
  const headLen = 12 + n * 4;
  const tablesStart = headLen + n * dirLen;
  // 元の sfnt からテーブル本体を丸ごと (ディレクトリの後ろ) 持ってくる
  const body = new Uint8Array(src, dirLen);
  const out = new Uint8Array(tablesStart + body.length);
  const ov = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
  ov.setUint32(4, 0x00010000);
  ov.setUint32(8, n);
  for (let i = 0; i < n; i++) {
    const off = headLen + i * dirLen;
    ov.setUint32(12 + i * 4, off);
    out.set(new Uint8Array(src, 0, dirLen), off);
    for (let t = 0; t < numTables; t++) {
      const r = off + 12 + t * 16 + 8;
      ov.setUint32(r, v.getUint32(12 + t * 16 + 8) - dirLen + tablesStart);
    }
  }
  out.set(body, tablesStart);
  return out.buffer;
}

describe('書体の読み込み (TTF / TTC)', () => {
  it('TTF はそのまま 1 書体、名前が読める', () => {
    const list = splitFontFile(ttf());
    expect(list).toHaveLength(1);
    expect(list[0].family).toMatch(/Noto Serif/);
    expect(list[0].weight).toBe(400);
  });

  it('TTC は書体ごとの sfnt に分けられ、字形・幅が元と一致する', async () => {
    const buf = makeTtc(ttf(), 2);
    expect(countFonts(buf)).toBe(2);
    const list = splitFontFile(buf);
    expect(list).toHaveLength(2);
    const { fonts } = await makeEngine();
    const orig = fonts.get(FAMILY, 400);
    await fonts.registerBuffer('FromTtc', 400, list[1].buffer, false);
    const copy = fonts.get('FromTtc', 400);
    for (const ch of ['あ', 'A', '漢']) {
      expect(copy.fk.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth).toBe(orig.fk.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth);
    }
  });

  it('和名・全角・空白の違いを吸収して照合する', () => {
    expect(normalizeFamily('ＭＳ 明朝')).toBe(normalizeFamily('MS Mincho'));
    expect(normalizeFamily('ＭＳ ゴシック')).toBe(normalizeFamily('ms gothic'));
    expect(normalizeFamily("'ＭＳ Ｐゴシック'")).toBe(normalizeFamily('MS PGothic'));
  });
});

describe('書体の並び (font-family) の扱い', () => {
  it('等幅の指定 (monospace・Courier・source-code-pro, monospace など) は、欧文 Cousine・和文 Noto Sans JP (XSL-FO は Noto Serif JP) の組にし、使ったことを覚える', async () => {
    const { fonts } = await makeEngine();
    const { createFontMapping } = await import('../src/fontMapping');
    const m = createFontMapping(fonts);
    expect(m.usesMono()).toBe(false);
    // 並びの中で最初に見分けられる名前で決める (知らない source-code-pro は飛ばす)
    expect(m.mapHtmlFont(['Arial', 'monospace'], false)).not.toBe('Kumiori Mono');
    expect(m.usesMono()).toBe(false);
    expect(m.mapHtmlFont(['source-code-pro', 'monospace'], false)).toBe('Kumiori Mono');
    // XSL-FO (mapFont) の等幅の和文は明朝
    expect(m.mapFont(['monospace'], false)).toBe('Kumiori Mono Serif');
    expect(m.mapHtmlFont(['Courier New'], false)).toBe('Kumiori Mono');
    expect(m.usesMono()).toBe(true);
    // Cousine が読み込まれていなければ、欧文も和文の書体で組む
    expect(fonts.getForChar('Kumiori Mono', 400, 'A').family).not.toBe('Cousine');
  });

  it('@font-face の書体に無い和文の字は、並びの次の総称で組む (source-sans-pro, serif は明朝、source-sans-pro, sans-serif はゴシック)', async () => {
    const { fonts } = await makeEngine();
    const { createFontMapping } = await import('../src/fontMapping');
    const { SANS, SERIF } = await import('../src/sampleData');
    const m = createFontMapping(fonts);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const b = fs.readFileSync(path.resolve(fontDir, 'NotoSerifJP-Regular.ttf'));
    const file = { name: 'face.ttf', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    await m.loadFontFaces('@font-face { font-family: source-sans-pro; src: url(face.ttf) }', [file]);
    expect(m.mapHtmlFont(['source-sans-pro', 'serif'], false)).toContain(`+${SERIF}`);
    expect(m.mapHtmlFont(['source-sans-pro', 'sans-serif'], false)).toContain(`+${SANS}`);
    // 後に総称が無ければ、ファミリ名 (sans) から
    expect(m.mapHtmlFont(['source-sans-pro'], false)).toContain(`+${SANS}`);
  });

  it('PostScript 名・完全な名前で書体を探す (アンテナハウス互換の SVG の font-family 用。ファミリー名とは別)', async () => {
    const { FontManager } = await import('../src/fontManager');
    const fonts = new FontManager();
    await fonts.registerBuffer('Serif JP', 700, ttf(), false);
    const lf = fonts.uniqueName('notoserifjp-regular');
    expect([lf?.family, lf?.weight]).toEqual(['Serif JP', 700]);
    expect(fonts.uniqueName('Noto Serif JP Regular')?.family).toBe('Serif JP');
    expect(fonts.uniqueName('Serif JP')).toBeUndefined();
  });

  it('並びの途中の書体 (欧文用 Times など) とその後ろの書体 (MS 明朝) を区別して、欧文・和文で別の書体で組む', async () => {
    const { fonts } = await makeEngine();
    await fonts.registerBuffer('JP', 400, ttf(), false);
    await fonts.registerBuffer('Lat', 400, ttf(), false);
    fonts.defineStack('JP+Lat', 'JP', 'Lat');
    expect(fonts.get('JP+Lat', 400).family).toBe('JP');
    expect(fonts.getForChar('JP+Lat', 400, 'A').family).toBe('Lat');
    expect(fonts.getForChar('JP+Lat', 400, 'あ').family).toBe('JP');
    // latin 無しの stack は、欧文も base の字形
    fonts.defineStack('JPonly', 'JP');
    expect(fonts.getForChar('JPonly', 400, 'A').family).toBe('JP');
  });

  it('字ごとの書体の選択は覚えておくが、書体の組・欧文の書体・書体の登録が変わったら選び直す', async () => {
    const { fonts } = await makeEngine();
    await fonts.registerBuffer('JP', 400, ttf(), false);
    fonts.defineStack('Mix', 'JP');
    expect(fonts.getForChar('Mix', 400, 'A').family).toBe('JP');
    // 同じ名前の組を、欧文の書体つきで定義し直す → 選び直す (欧文の書体はまだ無いので JP のまま)
    fonts.defineStack('Mix', 'JP', 'Lat');
    expect(fonts.getForChar('Mix', 400, 'A').family).toBe('JP');
    // 欧文の書体を登録する → 選び直す
    await fonts.registerBuffer('Lat', 400, ttf(), false);
    expect(fonts.getForChar('Mix', 400, 'A').family).toBe('Lat');
    // 基本の書体の欧文の書体の指定 → 選び直す
    expect(fonts.getForChar('JP', 400, 'A').family).toBe('JP');
    fonts.setLatinFallback('JP', 'Lat');
    expect(fonts.getForChar('JP', 400, 'A').family).toBe('Lat');
  });

  it('symbol を付けた並び: 欧文の書体が持たない記号は、和文の字・空白を除いて、基本の書体より先に記号用の書体で組む', async () => {
    const { fonts } = await makeEngine();
    await fonts.registerBuffer('JP', 400, ttf(), false);
    await fonts.registerBuffer('Sym', 400, ttf(), false);
    fonts.defineStack('JP+Sym', 'JP', 'NoSuchLatin', { symbol: 'Sym' });
    expect(fonts.getForChar('JP+Sym', 400, '●').family).toBe('Sym');
    expect(fonts.getForChar('JP+Sym', 400, 'あ').family).toBe('JP');
    expect(fonts.getForChar('JP+Sym', 400, '「').family).toBe('JP');
    fonts.defineStack('JPonly2', 'JP', 'NoSuchLatin');
    expect(fonts.getForChar('JPonly2', 400, '●').family).toBe('JP');
  });

  it('first を付けた並び (CSS の先頭の書体) は、欧文に限らず、先頭の書体が持つ字をすべてその書体で組む', async () => {
    const { fonts } = await makeEngine();
    await fonts.registerBuffer('JP', 400, ttf(), false);
    await fonts.registerBuffer('Lat', 400, ttf(), false);
    fonts.defineStack('JP+Lat', 'JP', 'Lat');
    fonts.defineStack('Lat,JP', 'JP', 'Lat', { first: true });
    expect(fonts.getForChar('JP+Lat', 400, '…').family).toBe('JP');
    expect(fonts.getForChar('Lat,JP', 400, '…').family).toBe('Lat');
    expect(fonts.getForChar('Lat,JP', 400, 'あ').family).toBe('Lat');
  });

  it('インポーターは font-family の並び全体を mapFont に渡す', () => {
    const seen: string[][] = [];
    const xml = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Times New Roman, ＭＳ 明朝">a</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never, {
      mapFont: (names) => {
        seen.push(names);
        return undefined;
      },
    });
    expect(seen).toContainEqual(['Times New Roman', 'ＭＳ 明朝']);
  });
});
