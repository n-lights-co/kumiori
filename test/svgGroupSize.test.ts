/**
 * SVG の透明のグループ (<g opacity> など) とマスクの Form XObject が、ページの資源の辞書を間接オブジェクトで参照すること (OUT-34)。
 * 辞書をじかに渡すと、保存のとき Form ごとに辞書 (全部の Form の名前を並べたもの) の写しが書かれ、グループの数の 2 乗で PDF が大きくなる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 半透明のグループ (rect を 2 つ) を n 個並べた SVG。mask: 各グループにマスクも付ける (マスクは n 個の別のもの) */
function svgOf(n: number, mask = false): Uint8Array {
  let defs = '';
  let body = '';
  for (let i = 0; i < n; i++) {
    const x = (i % 50) * 4;
    const y = Math.floor(i / 50) * 4;
    if (mask) defs += `<mask id="m${i}"><rect x="${x}" y="${y}" width="3" height="3" fill="#fff"/></mask>`;
    body += `<g opacity=".5"${mask ? ` mask="url(#m${i})"` : ''}><rect x="${x}" y="${y}" width="3" height="3" fill="#f00"/><rect x="${x + 1}" y="${y + 1}" width="2" height="2" fill="#00f"/></g>`;
  }
  return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`);
}

async function pdfOf(n: number, mask = false): Promise<Uint8Array> {
  const r = await typesetHtml('<img src="a.svg" style="width:200px">', { loadFont, files: [{ name: 'a.svg', data: svgOf(n, mask) }] });
  return r.toPdf();
}

describe('SVG の透明のグループ・マスクの数と PDF の大きさ (OUT-34)', () => {
  for (const mask of [false, true]) {
    it(`${mask ? 'マスク付きの' : ''}グループを 2 倍にしても、PDF はほぼ 2 倍にしかならない (2 乗でない)`, async () => {
      const a = (await pdfOf(200, mask)).length;
      const b = (await pdfOf(400, mask)).length;
      // 2 乗なら 4 倍近く。書体などの決まった部分があるので 2 倍よりは小さい
      expect(b / a).toBeLessThan(2.5);
    }, 120_000);
  }

  it('グループの Form の資源の参照が解け、描いた中身が変わらない', async () => {
    const doc = await PDFDocument.load(await pdfOf(20, true));
    const page = doc.getPage(0).node;
    const resRef = page.get(PDFName.of('Resources'));
    expect(resRef).toBeInstanceOf(PDFRef);
    const res = page.Resources()!;
    // SVG の画像の Form → 中のグループの Form (/KmG…) を、ページの XObject の辞書でたどる
    const xo = res.lookup(PDFName.of('XObject'), PDFDict);
    const groups = xo.keys().filter((k) => /^\/KmG/.test(k.asString()));
    expect(groups.length).toBeGreaterThanOrEqual(20);
    for (const k of groups) {
      const form = xo.lookup(k) as PDFRawStream;
      // Form の資源は、ページと同じ辞書を間接オブジェクトで参照する
      expect(form.dict.get(PDFName.of('Resources'))).toBe(resRef);
      const ops = new TextDecoder().decode(decodePDFRawStream(form).decode());
      // 中の rect の色 (赤・青) と、その中で使う名前が資源で解ける
      expect(ops).toMatch(/1 0 0 rg/);
      expect(ops).toMatch(/0 0 1 rg/);
      for (const m of ops.matchAll(/\/(\S+) (gs|Do)\b/g)) {
        const cat = m[2] === 'gs' ? 'ExtGState' : 'XObject';
        expect(res.lookup(PDFName.of(cat), PDFDict).get(PDFName.of(m[1])), `${cat} ${m[1]}`).toBeDefined();
      }
    }
    // マスクの ExtGState (/KmM…) の Form も同じ辞書を参照する
    const gs = res.lookup(PDFName.of('ExtGState'), PDFDict);
    const maskNames = gs.keys().filter((k) => /^\/KmM/.test(k.asString()));
    expect(maskNames.length).toBe(20);
    for (const k of maskNames) {
      const smask = (gs.lookup(k, PDFDict)).lookup(PDFName.of('SMask'), PDFDict);
      const g = smask.lookup(PDFName.of('G')) as PDFRawStream;
      expect(g.dict.get(PDFName.of('Resources'))).toBe(resRef);
    }
  }, 120_000);
});
