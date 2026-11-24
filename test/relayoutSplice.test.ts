/**
 * 器で組み直すとき、変わったページから組み直し、境目の状態が前の文書の組版と揃ったら、残りのページを前の組版から繋ぐ
 * (design/resumable-flow.md の 6.2 の 2・3。R7)。種を決めた乱数の所で直しながら組み、使い回しをする器と使い回さない器で、
 * 領域の木・診断・警告・PDF のバイト列が同じこと (scripts/relayout-check-lib.mjs)、繋いだこと、繋ぐ確かめ (揃った境目で繋がずに
 * 終わりまで組み、繋いだはずのページと同じか。resumeProbe.spliceVerify) がどれも同じことを確かめる。
 * 大きな文書は scripts/check-relayout.mjs (--subjects reuse,splice-verify) で確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTypesetter, DEFAULT_FONTS, serializeAreaTree } from '../src/index';
import fs from 'node:fs';
import { EXTRA_TEST_FONTS, cachedFont, ensureFonts } from './helpers';
import { checkRelayout, editSequence, type RelayoutRow } from '../scripts/relayout-check-lib.mjs';
import { SHAPES } from '../scripts/gen-stress-docs.mjs';
import { LayoutEngine, resumeProbe } from '../src/layoutEngine';

const lib = { createTypesetter, serializeAreaTree } as never;

// 前の組版と繋いだ回数とページの数 (LayoutEngine.spliceAdopt)
let spliced = 0;
let splicedPages = 0;
// 前の文書から page-sequence を使い回した回数 (LayoutEngine.adoptPrev。R6)
let adopted = 0;
// 前を飛ばした回数 (境目の写しを、いまの文書の物に移せた回数。LayoutEngine.remapBoundary)
let skipped = 0;
const proto = LayoutEngine.prototype as unknown as { spliceAdopt: (...a: unknown[]) => unknown[]; adoptPrev: (...a: unknown[]) => boolean; remapBoundary: (...a: unknown[]) => unknown };
const remapBoundary = proto.remapBoundary;
proto.remapBoundary = function (...a: unknown[]) {
  const r = remapBoundary.apply(this, a);
  if (r) skipped++;
  return r;
};
const adopt = proto.spliceAdopt;
const adoptPrev = proto.adoptPrev;
proto.spliceAdopt = function (...a: unknown[]) {
  const r = adopt.apply(this, a);
  // 初めのページから使うのは前を飛ばしたとき (skipped で数える)
  if ((a[1] as number) > 0) {
    spliced++;
    splicedPages += r.length;
  }
  return r;
};
proto.adoptPrev = function (...a: unknown[]) {
  const r = adoptPrev.apply(this, a);
  if (r) adopted++;
  return r;
};
afterAll(() => {
  proto.spliceAdopt = adopt;
  proto.adoptPrev = adoptPrev;
  proto.remapBoundary = remapBoundary;
});

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

const failures = (rows: RelayoutRow[]) => rows.flatMap((r) => r.subjects.filter((s) => s.diff).map((s) => `${r.index}: ${r.label}: ${s.name}: ${JSON.stringify(s.diff)}`));

const paras = Array.from({ length: 300 }, (_, k) => `<p>段落 ${k} の文。${'字を並べて行を作る。'.repeat(8 + (k % 5))}</p>`).join('\n');
/** 目次 (target-counter) のある HTML: 1 回目の組版で目次は仮の値になり、2 回目の組版で字を差し替える */
const toc = `<!DOCTYPE html><html><head><style>.toc a::after { content: " " leader(dotted) " " target-counter(attr(href url), page); } h2 { break-before: page; }</style></head><body>
<ul class="toc">${Array.from({ length: 6 }, (_, k) => `<li><a href="#c${k}">章 ${k}</a></li>`).join('')}</ul>
${Array.from({ length: 6 }, (_, k) => `<h2 id="c${k}">章 ${k}</h2>${Array.from({ length: 40 }, (_, j) => `<p>章 ${k} の段落 ${j}。${'字を並べて行を作る。'.repeat(6 + (j % 4))}${j === 20 ? `<a href="#c${Math.max(0, k - 1)}">前の章 (p. <span style="content: target-counter(attr(href url), page)"></span>)</a>` : ''}</p>`).join('')}`).join('\n')}
</body></html>`;
/** XSL-FO の、本文に前と後ろを指すページ番号の参照 (page-number-citation) のある文書 */
const foCites = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${Array.from({ length: 200 }, (_, k) => `<fo:block id="b${k}">段落 ${k}。${'字を並べて行を作る。'.repeat(5 + (k % 4))}${k % 25 === 10 ? `(段落 ${k - 10} は <fo:page-number-citation ref-id="b${k - 10}"/> ページ${k % 50 === 10 ? `、段落 ${k + 30} は <fo:page-number-citation ref-id="b${k + 30}"/> ページ` : ''})` : ''}</fo:block>`).join('')}</fo:flow></fo:page-sequence></fo:root>`;
const docs: Array<[string, string, 'html' | 'fo', boolean?]> = [
  ['段落の多い HTML', `<!DOCTYPE html><html><body>${paras}</body></html>`, 'html', true],
  // 目次のページは、組み直しの 1 回目では仮の値で組むので、前の文書のページ (決まった値) と揃わず、前は飛ばせない
  ['目次 (target-counter) のある HTML', toc, 'html'],
  ['本文にページ番号の参照のある XSL-FO', foCites, 'fo'],
  // 効果 (opacity・transform・outline) のある節: 組んだ箱の効果の印 (fxRef) も、入力の節の番号と同じくずらす
  [
    '効果 (opacity・transform・outline) のある HTML',
    `<!DOCTYPE html><html><body>${Array.from({ length: 200 }, (_, k) => `<p${k % 7 === 3 ? ' style="opacity: 0.5"' : k % 11 === 5 ? ' style="transform: rotate(1deg)"' : ''}>段落 ${k}。<span${k % 5 === 1 ? ' style="outline: 1px solid red; opacity: 0.7"' : ''}>${'字を並べて行を作る。'.repeat(6 + (k % 4))}</span></p>`).join('')}</body></html>`,
    'html',
  ],
  ['gen:para (長い段落)', SHAPES.para.make(4), 'html'],
  ['gen:fotable (XSL-FO の大きな表)', SHAPES.fotable.make(40), 'fo'],
  ['gen:fonest (XSL-FO の入れ子)', SHAPES.fonest.make(120), 'fo'],
];

describe('変わったページから組み直して、前の組版と繋ぐ', () => {
  for (const [name, text, kind, skip] of docs)
    it(`${name}: 使い回さない器と同じ結果で、繋いだ所の確かめも同じ`, async () => {
      const versions = editSequence(text, { seed: 3, edits: 4 });
      const s0 = spliced;
      const k0 = skipped;
      const r = await checkRelayout({ lib, options: { kind }, versions });
      expect(failures(r.versions)).toEqual([]);
      expect(spliced - s0, '前の組版と繋いだ').toBeGreaterThan(0);
      if (skip) expect(skipped - k0, '前を飛ばした').toBeGreaterThan(0);
      // 繋ぐ確かめ: 同じ版の並びを、揃った境目で繋がずに組む
      const res: Array<{ same: boolean; prefix?: boolean; why?: string }> = [];
      resumeProbe.spliceVerify = (x) => res.push(x);
      try {
        await checkRelayout({ lib, options: { kind }, versions, pdf: false });
      } finally {
        resumeProbe.spliceVerify = undefined;
      }
      expect(res.length, '揃った境目').toBeGreaterThan(0);
      expect(res.filter((x) => !x.same).map((x) => JSON.stringify(x))).toEqual([]);
      if (skip) expect(res.some((x) => x.prefix), '前を飛ばす所の確かめ').toBe(true);
    }, 300_000);

  it('次のページへ送った float のある境目の写しは、境目の後で float を置いても変わらない (前を飛ばす所の確かめが同じ)', async () => {
    // 1 ページ目の終わりの 2 つの float (高い箱) は 1 ページ目に入らず、次のページへ送る (2 つ目は、次のページで 1 つ目の下に置く)。
    // その後の強制の改ページが、送った float のある境目。直すのは、その次のページの段落 (境目の前を前の文書から使う)
    const float = (h: number) => `<fo:float float="start"><fo:block-container width="80mm" height="${h}mm" border="1pt solid black"><fo:block>float</fo:block></fo:block-container></fo:float>`;
    const doc = (extra: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block-container height="110mm"><fo:block>高い箱</fo:block></fo:block-container><fo:block>${float(50)}${float(40)}</fo:block><fo:block break-before="page">改ページ</fo:block>${Array.from({ length: 40 }, (_, k) => `<fo:block>段落 ${k}。${k === 2 ? extra : ''}</fo:block>`).join('')}</fo:flow></fo:page-sequence></fo:root>`;
    const versions = [
      { label: '元の文書', text: doc('') },
      { label: '後ろの段落を直す', text: doc('足した字。') },
    ];
    const k0 = skipped;
    const r = await checkRelayout({ lib, options: { kind: 'fo' }, versions });
    expect(failures(r.versions)).toEqual([]);
    expect(skipped - k0, '前を飛ばした').toBeGreaterThan(0);
    const res: Array<{ same: boolean; prefix?: boolean; why?: string }> = [];
    resumeProbe.spliceVerify = (x) => res.push(x);
    try {
      await checkRelayout({ lib, options: { kind: 'fo' }, versions, pdf: false });
    } finally {
      resumeProbe.spliceVerify = undefined;
    }
    expect(res.some((x) => x.prefix), '前を飛ばす所の確かめ').toBe(true);
    expect(res.filter((x) => !x.same).map((x) => JSON.stringify(x))).toEqual([]);
  }, 300_000);

  it('ページのマスターだけを替えて組み直したら、前の文書のページを繋がない (背景・紙の大きさ・master-reference・選択肢の print)', async () => {
    const body = Array.from({ length: 60 }, (_, j) => `<fo:block>段落 ${j}。${'字を並べて行を作る。'.repeat(4)}</fo:block>`).join('');
    const doc = (master: string, ref = 'p', extra = '') =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set>${master}${extra}</fo:layout-master-set><fo:page-sequence master-reference="${ref}"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
    const spm = (name: string, region = '', size = 'page-height="148mm" margin="8mm"') => `<fo:simple-page-master master-name="${name}" page-width="105mm" ${size}><fo:region-body${region}/></fo:simple-page-master>`;
    const q = spm('q', ' background-color="#ffc"');
    const a = doc(spm('p'));
    const cases: Array<[string, string, string, Record<string, unknown>, Record<string, unknown>]> = [
      ['region-body の背景', a, doc(spm('p', ' background-color="#ffc"')), {}, {}],
      ['紙の大きさと余白 (本文の大きさは同じ)', a, doc(spm('p', '', 'page-height="158mm" margin="8mm" margin-bottom="18mm"')), {}, {}],
      ['選択肢の print', a, a, {}, { print: true }],
      ['master-reference を背景だけ違うマスターへ', doc(spm('p'), 'p', q), doc(spm('p'), 'q', q), {}, {}],
    ];
    for (const [name, before, after, o1, o2] of cases) {
      const t = await createTypesetter({});
      await t.typeset(before, { kind: 'fo', ...o1 });
      const r = await t.typeset(after, { kind: 'fo', ...o2 });
      const f = await (await createTypesetter({ reuse: false })).typeset(after, { kind: 'fo', ...o2 });
      expect(serializeAreaTree(r.areaTree) === serializeAreaTree(f.areaTree), name).toBe(true);
    }
  }, 300_000);

  it('@font-face の書体のある文書も、前を飛ばす所の確かめが同じ (書体の物は文書ごとに作り直すが、同じ書体として比べる)', async () => {
    // 書体のファイルは ttf (fontkit が字形を読むたびに、読み取りの位置が動く)
    const name = 'NotoSansThai-Regular-v29.ttf';
    const font = new Uint8Array(fs.readFileSync(await cachedFont(name, EXTRA_TEST_FONTS[name])));
    const text = `<!DOCTYPE html><html><head><style>@font-face { font-family: F; src: url(${name}); } p.l { font-family: F }</style></head><body>${Array.from({ length: 200 }, (_, k) => `<p${k % 3 === 0 ? ' class="l"' : ''}>Paragraph ${k} ${'abcdefghijklmnopqrstuvwxyz'.slice(k % 20, (k % 20) + 6)} with some words to fill the line and make the page break.</p>`).join('')}</body></html>`;
    const at = text.indexOf('Paragraph 150 ');
    const versions = [
      { label: '元の文書', text },
      { label: '後ろの段落を直す', text: text.slice(0, at) + 'Edited. ' + text.slice(at) },
    ];
    const options = { kind: 'html', files: [{ name, data: font }] };
    const res: Array<{ same: boolean; prefix?: boolean; why?: string }> = [];
    resumeProbe.spliceVerify = (x) => res.push(x);
    try {
      await checkRelayout({ lib, options, versions, pdf: false });
    } finally {
      resumeProbe.spliceVerify = undefined;
    }
    expect(res.some((x) => x.prefix), '前を飛ばす所の確かめ').toBe(true);
    expect(res.filter((x) => !x.same).map((x) => JSON.stringify(x))).toEqual([]);
  }, 300_000);

  it('直した所でページ数が変わり、後ろのページの番号がずれたら繋がない (結果は同じ)', async () => {
    // 段落に長い字を足して、ページを増やす (後ろの境目は、前の組版の同じ番号の境目と揃わない)
    const text = `<!DOCTYPE html><html><body>${paras}</body></html>`;
    const at = text.indexOf('段落 150 の文。');
    const longer = text.slice(0, at) + '足した字。'.repeat(400) + text.slice(at);
    const s0 = spliced;
    const r = await checkRelayout({ lib, options: { kind: 'html' }, versions: [{ label: '元の文書', text }, { label: 'ページの増える直し', text: longer }] });
    expect(failures(r.versions)).toEqual([]);
    expect(spliced - s0).toBe(0);
  }, 300_000);

  it('ページ番号の参照のある page-sequence も、中身が同じなら前の文書から使い回す (参照を引き直して、組んだ字と同じとき)', async () => {
    // 章ごとの page-sequence。どの章にも、前と後ろの章を指す参照があり、直すのは 1 つの章だけ
    const chap = (k: number, extra = '') =>
      `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block id="c${k}">章 ${k}${extra}</fo:block>${Array.from({ length: 30 }, (_, j) => `<fo:block>章 ${k} の段落 ${j}。${'字を並べて行を作る。'.repeat(5 + (j % 3))}${j === 5 ? `章 ${(k + 1) % 5} は <fo:page-number-citation ref-id="c${(k + 1) % 5}"/> ページ、章 ${(k + 4) % 5} は <fo:page-number-citation ref-id="c${(k + 4) % 5}"/> ページ。` : ''}</fo:block>`).join('')}</fo:flow></fo:page-sequence>`;
    const doc = (extra: string) => `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>${Array.from({ length: 5 }, (_, k) => chap(k, k === 2 ? extra : '')).join('')}</fo:root>`;
    const a0 = adopted;
    const r = await checkRelayout({ lib, options: { kind: 'fo' }, versions: [{ label: '元の文書', text: doc('') }, { label: '章 2 を直す', text: doc('。足した字') }, { label: '章 2 をまた直す', text: doc('。足した字。もっと') }] });
    expect(failures(r.versions)).toEqual([]);
    expect(adopted - a0, '使い回した page-sequence').toBeGreaterThan(0);
  }, 300_000);
});
