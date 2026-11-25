/**
 * 続きから組む作り (design/resumable-flow.md の 4.4): 1 段の page-sequence の、続きから組める境目のすべてで、1 ページ先まで組んでから
 * 境目に戻り、境目の写しから続けて組む (resumeProbe.check)。結果 (領域の木・警告) が、戻らずに組んだときと同じで、戻って同じ境目に来たときの
 * 指紋も同じことを確かめる。境目の状態 (2.1〜2.3) のそれぞれが境目にかかる小さな文書で試す。
 * 手元の大きな文書は scripts/check-resume.mjs で試す。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, serializeAreaTree, typeset } from '../src/index';
import { resumeProbe, type ResumeStats } from '../src/layoutEngine';
import { ensureFonts } from './helpers';
import { RESUME_SHAPES } from '../scripts/gen-stress-docs.mjs';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

afterEach(() => {
  resumeProbe.check = false;
  resumeProbe.fromStart = false;
  resumeProbe.late = undefined;
  resumeProbe.lateOnly = undefined;
  resumeProbe.onStats = undefined;
});

/** 組んだ結果を、比べる形 (領域の木の JSON と警告) にする */
async function run(text: string, options: Record<string, unknown>, check: boolean, fromStart = false, late?: number): Promise<{ tree: string; warnings: string[]; stats?: ResumeStats }> {
  resumeProbe.check = check;
  resumeProbe.fromStart = fromStart;
  resumeProbe.late = late;
  let stats: ResumeStats | undefined;
  resumeProbe.onStats = (s) => (stats = structuredClone(s));
  const r = await typeset(text, options as never);
  resumeProbe.check = false;
  resumeProbe.fromStart = false;
  resumeProbe.late = undefined;
  return { tree: serializeAreaTree(r.areaTree), warnings: r.warnings, stats };
}

const para = (n: number, words = 60) => Array.from({ length: n }, (_, k) => `<p>段落 ${k + 1}。${'これは続きから組む試しの文です。'.repeat(words / 10)} Lorem ipsum dolor sit amet ${k}.</p>`).join('\n');

const html = (body: string, css = '') => `<!DOCTYPE html><html lang="ja"><head><style>@page { size: A6; margin: 12mm } body { font-size: 10pt } ${css}</style></head><body>${body}</body></html>`;

const fo = (body: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja">
  <fo:layout-master-set>
    <fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master>
    <fo:simple-page-master master-name="last" page-width="105mm" page-height="148mm" margin="20mm"><fo:region-body/></fo:simple-page-master>
    <fo:page-sequence-master master-name="m">
      <fo:repeatable-page-master-alternatives>
        <fo:conditional-page-master-reference master-reference="last" page-position="last"/>
        <fo:conditional-page-master-reference master-reference="p"/>
      </fo:repeatable-page-master-alternatives>
    </fo:page-sequence-master>
  </fo:layout-master-set>
  <fo:page-sequence master-reference="${extra.includes('last') ? 'm' : 'p'}"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence>
</fo:root>`;

const foPara = (n: number) => Array.from({ length: n }, (_, k) => `<fo:block space-before="4pt" space-after="4pt">段落 ${k + 1}。${'これは続きから組む試しの文です。'.repeat(8)}</fo:block>`).join('');

const cases: Array<{ name: string; text: string; options: Record<string, unknown> }> = [
  { name: '段落の途中で改ページ', text: html(para(12)), options: { kind: 'html' } },
  { name: '入れ子のブロックの中の段落', text: html(`<div style="border: 1pt solid; padding: 4pt"><section style="margin: 6pt">${para(10)}</section></div>`), options: { kind: 'html' } },
  { name: 'break-before・break-after', text: html(`${para(2)}<h2 style="break-before: page">見出し</h2>${para(3)}<div style="break-after: right">${para(1)}</div>${para(3)}`), options: { kind: 'html' } },
  { name: 'keep-with-next の改ページ', text: html(`${para(4)}<h2 style="break-after: avoid">見出し</h2>${para(2)}<h3 style="break-after: avoid">小見出し</h3>${para(3)}`), options: { kind: 'html' } },
  { name: 'break-inside: avoid の改ページ', text: html(`${para(3)}<div style="break-inside: avoid">${para(2, 30)}</div>${para(3)}`), options: { kind: 'html' } },
  { name: 'widows・orphans', text: html(para(10), 'p { widows: 3; orphans: 3 }'), options: { kind: 'html' } },
  { name: 'ルビ', text: html(Array.from({ length: 20 }, () => '<p><ruby>漢字<rt>かんじ</rt></ruby>の段落の文。'.repeat(4) + '</p>').join('')), options: { kind: 'html' } },
  { name: '縦書き', text: html(para(8), 'html { writing-mode: vertical-rl }'), options: { kind: 'html' } },
  { name: '脚注の持ち越し', text: fo(Array.from({ length: 8 }, (_, k) => `<fo:block>本文 ${k}<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>${'長い脚注の文。'.repeat(40)}</fo:block></fo:footnote-body></fo:footnote>${'本文の続き。'.repeat(20)}</fo:block>`).join('')), options: { kind: 'fo' } },
  { name: 'XSL の余白 (retain)', text: fo(Array.from({ length: 10 }, (_, k) => `<fo:block space-before="12pt" space-before.conditionality="retain" border="1pt solid" padding="3pt">段落 ${k}。${'余白を残す段落の文。'.repeat(12)}</fo:block>`).join('')), options: { kind: 'fo' } },
  { name: '最後のページのマスター', text: fo(foPara(14), 'last'), options: { kind: 'fo' } },
  { name: 'page-sequence の初めのページ番号', text: fo(foPara(10)).replace('<fo:page-sequence ', '<fo:page-sequence initial-page-number="5" force-page-count="even" '), options: { kind: 'fo' } },
  { name: '前方 float と送った float', text: fo(Array.from({ length: 6 }, (_, k) => `<fo:block>${'本文。'.repeat(30)}<fo:float float="before"><fo:block-container height="60mm" border="1pt solid"><fo:block>図 ${k}</fo:block></fo:block-container></fo:float>${'本文の続き。'.repeat(30)}</fo:block>`).join('')), options: { kind: 'fo' } },
  { name: '長いリスト (リストの項目は表の行)', text: html(`<ul>${Array.from({ length: 60 }, (_, k) => `<li>項目 ${k}。${'リストの項目の文。'.repeat(k % 5 + 1)}</li>`).join('')}</ul>`), options: { kind: 'html' } },
  { name: '入れ子のリストと、ページをまたぐ項目', text: html(`<ol>${Array.from({ length: 12 }, (_, k) => `<li>項目 ${k}<p>${'ページをまたぐ長い項目の段落。'.repeat(20)}</p><ul><li>中の項目 a</li><li>中の項目 b</li></ul></li>`).join('')}</ol>`), options: { kind: 'html' } },
  { name: '見出しとフッターを繰り返す表', text: html(`<table border="1"><thead><tr><th>見出し</th><th>列</th></tr></thead><tfoot><tr><td>フッター</td><td>列</td></tr></tfoot><tbody>${Array.from({ length: 80 }, (_, k) => `<tr><td>行 ${k}</td><td>${'表のセルの文。'.repeat(k % 4 + 1)}</td></tr>`).join('')}</tbody></table>`), options: { kind: 'html' } },
  { name: '行をまたぐセルとページをまたぐ行', text: html(`<table border="1" style="border-collapse: collapse">${Array.from({ length: 20 }, (_, k) => (k % 5 === 0 ? `<tr><td rowspan="2">またぐ ${k}</td><td>${'長いセル。'.repeat(k === 10 ? 200 : 6)}</td></tr><tr><td>下の行</td></tr>` : `<tr><td>行 ${k}</td><td>${'セルの文。'.repeat(8)}</td></tr>`)).join('')}</table>`), options: { kind: 'html' } },
  { name: 'FO の表 (header・footer・keep)', text: fo(`<fo:table table-layout="fixed" width="100%" border-collapse="collapse"><fo:table-column column-width="30%"/><fo:table-column column-width="70%"/><fo:table-header><fo:table-row><fo:table-cell border="1pt solid"><fo:block>見出し</fo:block></fo:table-cell><fo:table-cell border="1pt solid"><fo:block>説明</fo:block></fo:table-cell></fo:table-row></fo:table-header><fo:table-footer><fo:table-row><fo:table-cell border="1pt solid" number-columns-spanned="2"><fo:block>続く</fo:block></fo:table-cell></fo:table-row></fo:table-footer><fo:table-body>${Array.from({ length: 50 }, (_, k) => `<fo:table-row${k % 7 === 3 ? ' keep-with-next="always"' : ''}${k === 25 ? ' break-before="page"' : ''}><fo:table-cell border="1pt solid"><fo:block>行 ${k}</fo:block></fo:table-cell><fo:table-cell border="1pt solid"><fo:block>${'FO の表のセルの文。'.repeat(k % 6 + 1)}</fo:block></fo:table-cell></fo:table-row>`).join('')}</fo:table-body></fo:table>`), options: { kind: 'fo' } },
  { name: 'FO の block-container (高さの指定なし)', text: fo(`<fo:block-container border="1pt solid" padding="4pt">${foPara(12)}<fo:block-container start-indent="10mm">${foPara(6)}</fo:block-container></fo:block-container>`), options: { kind: 'fo' } },
  { name: 'HTML の flow-root の箱', text: html(`<div style="display: flow-root; border: 1pt solid">${para(10)}</div>`), options: { kind: 'html' } },
  { name: 'マーカー', text: fo(Array.from({ length: 8 }, (_, k) => `<fo:block><fo:marker marker-class-name="h">見出し ${k}</fo:marker>${'マーカーのある段落。'.repeat(20)}</fo:block>`).join('')), options: { kind: 'fo' } },
  // 左右・奇数偶数で本文の幅が違い、ページをまたぐ長い段落 (続けた流れが写した境目から、もう 1 度続ける)
  { name: '左右で本文の幅の違うページをまたぐ長い段落 (HTML の @page :left)', text: RESUME_SHAPES.sidewidth.make(6), options: { kind: 'html' } },
  { name: '奇数・偶数で本文の幅の違うマスターと、最後のページのマスター', text: RESUME_SHAPES.fosidewidth.make(6), options: { kind: 'fo' } },
];

describe('続きから組む (resumeCheck)', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const a = await run(c.text, c.options, false);
      const b = await run(c.text, c.options, true);
      expect(b.stats, '境目を写した').toBeDefined();
      expect(b.stats!.mismatched, '指紋').toBe(0);
      expect(b.warnings).toEqual(a.warnings);
      expect(b.tree === a.tree, '領域の木').toBe(true);
      if (process.env.RESUME_DEBUG) console.log(c.name, JSON.stringify(b.stats));
      expect(b.stats!.resumed, `続けた境目 ${JSON.stringify(b.stats)}`).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe('遅く戻る試し (page-sequence を終わりまで組んだ後、前の境目から終わりまで組み直す)', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const a = await run(c.text, c.options, false);
      const b = await run(c.text, c.options, false, false, 4);
      expect(b.stats!.mismatched, '指紋').toBe(0);
      expect(b.warnings).toEqual(a.warnings);
      expect(b.tree === a.tree, '領域の木').toBe(true);
      expect(b.stats!.resumed, `続けた境目 ${JSON.stringify(b.stats)}`).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe('遅く戻る試し: 罫線をつぶした表の、改ページの境目で決め直す罫線', () => {
  // 罫線をつぶした表 (rowspan のセル・break-inside: avoid の行・繰り返す見出しの行) がページをまたぐ文書。終わりまで組んだ後に前の境目から
  // 組み直すと、前は、7 ページ目の最後の行のセルに下の罫線が 1 本増えた: 前の組みで、次のページの最初の行のセルの前側の線を、
  // 表ヘッダーの後の線として書き換えたまま残り、組み直しで、ページの最後の行の後ろ側の線を決めるときに、その線を使っていた
  // (書き換える前の線に戻してから決め直す。layoutEngine.ts の BREAK_SIDE_ORIG)
  const text = fs.readFileSync(path.join(import.meta.dirname, 'relayout', 'collapse-rowspan-late.html'), 'utf8');
  for (const [late, only] of [
    [1, 6],
    [4, undefined],
  ] as const) {
    it(`境目 ${late} 個${only ? ` (${only} ページ目の後の境目)` : ''}から組み直す`, async () => {
      const a = await run(text, { kind: 'html' }, false);
      resumeProbe.lateOnly = only;
      const b = await run(text, { kind: 'html' }, false, false, late);
      resumeProbe.lateOnly = undefined;
      expect(b.stats!.resumed, '組み直した境目').toBeGreaterThan(0);
      expect(b.stats!.mismatched, '指紋').toBe(0);
      expect(b.warnings).toEqual(a.warnings);
      expect(b.tree === a.tree, '領域の木').toBe(true);
    }, 60_000);
  }
});

/** 偶数のページの左の余白が広いマスターと、最後のページのマスター (余白の広い) のある XSL-FO。1 つ目の段落はページをまたいで長い */
const widthAlternating = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja" font-size="9pt"><fo:layout-master-set>
<fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="8mm"><fo:region-body margin-top="8mm"/></fo:simple-page-master>
<fo:simple-page-master master-name="last" page-width="105mm" page-height="148mm" margin="35mm"><fo:region-body margin-top="8mm"/></fo:simple-page-master>
<fo:simple-page-master master-name="even" page-width="105mm" page-height="148mm" margin="8mm" margin-left="14mm"><fo:region-body margin-top="8mm"/></fo:simple-page-master>
<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="last" page-position="last"/><fo:conditional-page-master-reference master-reference="even" odd-or-even="even"/><fo:conditional-page-master-reference master-reference="p"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>
<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block line-height="2" font-size="19pt">${'本文の字を並べる。'.repeat(59)}${'hyphenation considerations apply. '.repeat(30)}</fo:block><fo:block line-height="2" font-size="9pt">${'本文の字を並べる。'.repeat(3)}${'hyphenation considerations apply. '.repeat(2)}</fo:block></fo:flow></fo:page-sequence></fo:root>`;

describe('最後のページのマスター (組版の中で境目から続けて組む)', () => {
  const lastCases = [
    { name: '最後のページだけ余白の違うマスター', text: fo(foPara(14), 'last') },
    { name: '最後のページで本文が溢れて、ページ数が増える', text: fo(foPara(15), 'last').replace('margin="20mm"', 'margin="45mm"') },
    { name: '強制の改ページと白ページの後の最後のページ', text: fo(`${foPara(5)}<fo:block break-before="odd-page">${foPara(6)}</fo:block>`, 'last') },
    // 偶数のページだけ本文の幅が狭く、ページをまたぐ長い段落。最後のページのマスターの組み直しが 2 回走り、2 回目は、1 回目に段落の途中の
    // 境目から続けた流れが写した境目から続ける (行の長さが変わって残りを組み直す間の境目の続きの位置が古いと、本文が重なる)
    { name: '幅の違う奇数・偶数のページをまたぐ長い段落の最後のページ', text: widthAlternating },
  ];
  for (const c of lastCases) {
    it(c.name, async () => {
      const a = await run(c.text, { kind: 'fo' }, false, true);
      const b = await run(c.text, { kind: 'fo' }, false);
      expect(a.stats?.lastFromStart ?? 0, '初めから組んだ').toBeGreaterThan(0);
      expect(b.stats?.lastFromBoundary ?? 0, `境目から組んだ ${JSON.stringify(b.stats)}`).toBeGreaterThan(0);
      expect(b.warnings).toEqual(a.warnings);
      expect(b.tree === a.tree, '領域の木').toBe(true);
    }, 60_000);
  }
});
