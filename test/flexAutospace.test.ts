/**
 * 中身の幅 (max-content) の見積もりにも、行を組むときと同じ和欧間アキ (text-autospace。CSS Text 4 §8.4) を足す (利用者の報告: 目次)。
 * フレックスの項目 (display: flex の子) の幅は、HTML の読み込みで中身の幅を見積もって決める (htmlImport.ts の textWidth)。
 * 見積もりが和欧間アキを足さず、行を組むときは足すので、「ecoモードの使い方」のような、和字と欧文の字の混じる項目が幅に入りきらず、
 * 最後の字 (「方」) が次の行に送られていた (目次の、項目名・リーダー・ページ番号を flex で並べる組み方)
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

/** 行の箱ごとの字の並び (本文の領域の中を、上から順に) */
function lineTexts(r: Awaited<ReturnType<typeof typeset>>): string[] {
  const out: string[] = [];
  const visit = (a: { type: string; text?: string; children?: unknown[] }) => {
    if (a.type === 'line') {
      let t = '';
      const v = (b: { type: string; text?: string; children?: unknown[] }) => {
        if (b.type === 'glyph') t += b.text;
        for (const c of (b.children ?? []) as (typeof b)[]) v(c);
      };
      v(a);
      out.push(t);
      return;
    }
    for (const c of (a.children ?? []) as (typeof a)[]) visit(c);
  };
  visit(r.areaTree.sheets[0].page.regionBody as never);
  return out;
}

const run = async (body: string, extra = '') => {
  const html =
    `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;${extra}} .f{display:flex} .l{flex:1}</style>` + body;
  return lineTexts(await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] }));
};

describe('フレックスの項目の幅 (max-content) に、行を組むときと同じ和欧間アキを足す', () => {
  it('項目名・リーダー・ページ番号の目次の行で、「ecoモードの使い方」が折り返されない (直す前は「方」が次の行に送られた)', async () => {
    expect(await run('<div class="f"><span>ecoモードの使い方</span><span class="l"></span><span>16</span></div>')).toEqual(['ecoモードの使い方', '16']);
  });
  it('数字と和字の間 (「第2章」)・語の後ろの欧文 (「モードeco」) も数える', async () => {
    expect(await run('<div class="f"><span>第2章の概要</span><span class="l"></span><span>3</span></div>')).toEqual(['第2章の概要', '3']);
    expect(await run('<div class="f"><span>モードの使い方eco</span><span class="l"></span><span>3</span></div>')).toEqual(['モードの使い方eco', '3']);
  });
  it('要素の境目をまたぐ組 (<b>eco</b>モード) も数える', async () => {
    expect(await run('<div class="f"><span><b>eco</b>モードの使い方</span><span class="l"></span><span>16</span></div>')).toEqual(['ecoモードの使い方', '16']);
  });
  it('-ah-text-autospace-width で広げたアキも数える', async () => {
    expect(await run('<div class="f"><span>ecoモードの使い方</span><span class="l"></span><span>16</span></div>', '-ah-text-autospace-width:50%')).toEqual(['ecoモードの使い方', '16']);
  });
  it('text-autospace: no-autospace でも、これまでどおり折り返されない', async () => {
    expect(await run('<div class="f"><span>ecoモードの使い方</span><span class="l"></span><span>16</span></div>', 'text-autospace:no-autospace')).toEqual(['ecoモードの使い方', '16']);
  });
});
