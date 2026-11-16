/**
 * 行内の要素 (span・a) の flex の項目は、ブロック化する (Flexbox 1 §4・CSS Display 3 §2.7)。罫線・内側の余白・背景は項目の箱にだけ付ける。
 * 直す前は、項目の箱と、中身の行内の箱の両方に罫線・内側の余白が付き、罫線が二重に描かれ、行内の罫線・余白の分だけ中身が項目の幅を超えて、
 * 和字だけの短い中身 (「モードの使い方」) でも、最後の字が次の行に送られていた
 *
 * テストの書体は Noto Sans JP。@font-face で読み、欧文もその書体で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

type A = { type: string; text?: string; border?: object; link?: unknown; children?: A[] };

/** 行の箱ごとの字の並び・罫線のある箱の数・リンクの数 (本文の領域の中) */
async function run(body: string) {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K} .f{display:flex}</style>` + body;
  const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
  const lines: string[] = [];
  let bordered = 0;
  let links = 0;
  const text = (a: A): string => (a.type === 'glyph' ? (a.text ?? '') : (a.children ?? []).map(text).join(''));
  const visit = (a: A) => {
    if (a.border && Object.keys(a.border).length) bordered++;
    if (a.link) links++;
    if (a.type === 'line') lines.push(text(a));
    for (const c of a.children ?? []) visit(c);
  };
  visit(r.areaTree.sheets[0].page.regionBody as never);
  return { lines, bordered, links };
}

describe('行内の要素の flex の項目の罫線・内側の余白は、項目の箱にだけ付ける', () => {
  it('罫線のある span の項目が折り返されず、罫線は 1 つの箱だけに付く (直す前は「方」が次の行に送られ、罫線の箱が項目と行内の断片の 3 つ)', async () => {
    expect(await run('<div class="f"><span style="border:1pt solid red">モードの使い方</span></div>')).toMatchObject({ lines: ['モードの使い方'], bordered: 1 });
  });
  it('内側の余白・背景のある span の項目も折り返されない', async () => {
    expect((await run('<div class="f"><span style="padding:0 2pt;background:#fcc">モードの使い方</span></div>')).lines).toEqual(['モードの使い方']);
  });
  it('a の項目は、リンクを残す (目次の行)', async () => {
    const r = await run('<div class="f"><a href="#x" style="border:1pt solid red;color:inherit">モードの使い方</a></div><p id="x">x</p>');
    expect(r.lines).toEqual(['モードの使い方', 'x']);
    expect(r.bordered).toBe(1);
    expect(r.links).toBeGreaterThan(0);
  });
});
