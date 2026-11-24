/**
 * 組み直しの組み比べ (scripts/relayout-check-lib.mjs) の速い版: リポジトリの小さな文書と、種を決めた乱数の文書 (scripts/gen-stress-docs.mjs) を、
 * 種を決めた乱数の所で直しながら組み、使い回しをする器 (createTypesetter の reuse) と、使い回さない器 (reuse: false) で、
 * 領域の木・診断 (場所まで)・警告・PDF のバイト列が同じことを確かめる。
 * 大きな文書 (対応仕様説明書・アンテナハウスのサンプル FO 集・『CSSページ組版入門』第 4 版・WeasyPrint の見本) は、
 * scripts/check-relayout.mjs で組み比べる (重いので、npm test には入れない)。
 * 部品そのもの (字の部分の切り出し・直し方) も、ここで確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTypesetter, DEFAULT_FONTS, serializeAreaTree } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { checkRelayout, editOnce, editSequence, seededRandom, textRanges, type RelayoutRow } from '../scripts/relayout-check-lib.mjs';
import { SHAPES } from '../scripts/gen-stress-docs.mjs';
import { SharedLineMemo } from '../src/layoutEngine';

// 使い回した段落の数 (SharedLineMemo.get が覚えを返した回数)。使い回しが当たらなくなる後退 (鍵が毎回違うなど) では、結果はいつも同じなので、
// 当たったことも確かめる
let hits = 0;
const sharedGet = SharedLineMemo.prototype.get;
SharedLineMemo.prototype.get = function (...a: Parameters<typeof sharedGet>) {
  const r = sharedGet.apply(this, a);
  if (r) hits++;
  return r;
};
afterAll(() => {
  SharedLineMemo.prototype.get = sharedGet;
});

const root = path.resolve(import.meta.dirname, '..');
const lib = { createTypesetter, serializeAreaTree } as never;

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

/** 違った版を、分かる文にする (落ちたときの報告) */
const failures = (rows: RelayoutRow[]) => rows.flatMap((r) => r.subjects.filter((s) => s.diff).map((s) => `${r.index}: ${r.label}: ${s.name}: ${JSON.stringify(s.diff)}`));

describe('組み比べの部品', () => {
  it('字の部分: タグ・注釈・CDATA・処理命令・style と script の中を除き、属性の値の中の > で切れない', () => {
    const text = '<?xml version="1.0"?><!DOCTYPE html><!-- 注釈 --><p title="a > b">字<b>太字</b> </p><style>p { color: red }</style><script>x < 1</script><![CDATA[ 生 ]]>終わり';
    const parts = textRanges(text).map(([s, e]) => text.slice(s, e));
    expect(parts).toEqual(['字', '太字', '終わり']);
  });

  it('直し方: 種が同じなら同じ直し。文字参照の中とサロゲートの対の間は切らない。タグは壊さない', () => {
    const text = '<p>a&amp;b&#x3042;c😀d</p><p>和文の段落。</p>';
    const a = editSequence(text, { seed: 5, edits: 6 });
    const b = editSequence(text, { seed: 5, edits: 6 });
    expect(a.map((v) => v.text)).toEqual(b.map((v) => v.text));
    expect(a[0].text).toBe(text);
    expect(a[a.length - 1].text).toBe(text);
    const rng = seededRandom(1);
    for (let k = 0; k < 300; k++) {
      const { text: t } = editOnce(text, rng);
      // タグの数と並びは変わらない。文字参照は、そのままか、まるごと消えるか
      expect(t.match(/<[^>]*>/g)).toEqual(['<p>', '</p>', '<p>', '</p>']);
      expect(t).not.toMatch(/&(?!amp;|#x3042;)/);
      expect(t).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });
});

/** 組み比べる文書 (名前・文字列・器の設定・文書ごとの設定) */
function docs() {
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const drawio = new Uint8Array(fs.readFileSync(path.join(root, 'examples/drawio-pages/diagrams.drawio')));
  const files = () => [{ name: 'diagrams.drawio', data: drawio.slice() }];
  return [
    { name: 'samples/check/fo/indent-inheritance-1.fo (spec)', hits: true, text: read('samples/check/fo/indent-inheritance-1.fo'), options: { kind: 'fo', compat: 'spec' } },
    { name: 'samples/check/fo/indent-inheritance-1.fo (antenna)', text: read('samples/check/fo/indent-inheritance-1.fo'), options: { kind: 'fo', compat: 'antenna' } },
    { name: 'examples/drawio-pages/pages.html', text: read('examples/drawio-pages/pages.html'), options: () => ({ kind: 'html', files: files() }) },
    { name: 'examples/drawio-pages/pages.fo', text: read('examples/drawio-pages/pages.fo'), options: () => ({ kind: 'fo', files: files() }) },
    // 表 (列の幅を測る組み・セルの短い段落の多いもの)・XSL-FO の表と入れ子・長い段落
    { name: 'gen:table', hits: true, text: SHAPES.table.make(40), options: { kind: 'html' } },
    { name: 'gen:fotable', hits: true, text: SHAPES.fotable.make(40), options: { kind: 'fo' } },
    { name: 'gen:fonest', hits: true, text: SHAPES.fonest.make(120), options: { kind: 'fo' } },
    { name: 'gen:para', hits: true, text: SHAPES.para.make(4), options: { kind: 'html' } },
  ];
}

/** 段落をまたぐ変更バーと改訂バーのある XSL-FO。edits の番号の段落に字を足す */
function barsFo(edits: number[] = []): string {
  const p = (i: number) => `<fo:block space-after="3pt">段落 ${i}。${edits.includes(i) ? '直した所。' : ''}変更バーの中の段落の行は、隣の行と繋いで 1 本の線にする。The bar joins adjacent lines into one.</fo:block>`;
  const run = (from: number, n: number) => Array.from({ length: n }, (_, k) => p(from + k)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" xml:lang="ja">
<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${run(0, 2)}
<fo:block><fo:change-bar-begin change-bar-class="a" change-bar-color="blue" change-bar-style="solid" change-bar-width="2pt"/>${run(2, 6)}<fo:change-bar-end change-bar-class="a"/></fo:block>
<fo:block axf:revision-bar-color="red" axf:revision-bar-width="2pt" axf:revision-bar-position="end">${run(8, 6)}</fo:block>${run(14, 2)}</fo:flow></fo:page-sequence></fo:root>`;
}

describe('使い回しの有無で、決めた所を直しながら組んだ結果が同じ', () => {
  it('段落をまたぐ変更バー (fo:change-bar-begin) と改訂バー (axf:revision-bar-*) が、違う文書で覚えた段落の行の間で切れない', async () => {
    // バーは、文書の中のバーのオブジェクトの同じものどうしで隣の行と繋ぐ。2 つ目の文書で直した段落 (3・9) を、3 つ目の文書で
    // 2 つ目の文書の覚えから、ほかの段落を 1 つ目の文書の覚えから使うと、前は、そこでバーが切れていた
    const versions = [[], [3, 9], [3, 9, 5, 11], []].map((e, k) => ({ text: barsFo(e), label: `${k}` }));
    const r = await checkRelayout({ lib, setup: { loadFont: loadCachedFont }, options: { kind: 'fo', compat: 'antenna' }, versions });
    expect(failures(r.versions)).toEqual([]);
  }, 300_000);
});

describe('使い回しの有無で、乱数の所を直しながら組んだ結果が同じ (scripts/relayout-check-lib.mjs)', () => {
  for (const d of docs()) {
    it(d.name, async () => {
      const versions = editSequence(d.text, { seed: 11, edits: 3 });
      expect(versions.length).toBe(5);
      let last = hits;
      const subjects = [
        {
          name: 'reuse',
          stats: () => {
            const n = hits - last;
            last = hits;
            return { sharedLineHits: n };
          },
        },
      ];
      const r = await checkRelayout({ lib, setup: { loadFont: loadCachedFont }, options: d.options, versions, subjects });
      expect(failures(r.versions)).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.versions.every((v) => v.pages > 0)).toBe(true);
      // 2 つ目からの版は、前の版で覚えた段落を使い回す (直したのは数か所なので、ほとんどの段落は当たる)
      const per = r.versions.map((v) => (v.subjects[0].stats as { sharedLineHits: number }).sharedLineHits);
      if (d.hits) expect(per.slice(1).every((n) => n > 0), `使い回した段落 ${per.join('/')}`).toBe(true);
    }, 300_000);
  }
});
