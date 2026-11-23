/**
 * 悪い入力 (小さな入力で時間を使い切らせるもの) の時間の試験を 1 か所に集めたもの。
 * 0.5.0 までの読み直し・脆弱性検査で見つけた入力のうち、ほかの試験に時間の確かめが無いものと、まだ直していないものを置く
 * (直したものの多くは、それぞれの試験 (audit*.test.ts・selectorChain・structureQuadratic・htmlLimits など) に時間の上限つきである)。
 *
 * 時間は、機械の速さに揺れないように、絶対の秒ではなく比で縛る (test/timing.ts):
 *  - expectRatio: 悪い入力と、同じ量のふつうの入力 (閉じた要素・飾りの無い規則など) を交互に測り、CPU の時間の比を見る
 *  - expectGrowth: 大きさ n と 4n で測り、比を見る (線形なら 4、2 乗なら 16。上限は 8)
 *
 * まだ直していない入力は it.skip にしてある。直す束は、直したら skip を外し、通ることを確かめる
 * (いまの main で測った時間を、それぞれのコメントに書いた。外したときに上限を超えれば、直しが足りない)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { expectGrowth, expectRatio } from './timing';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
  // 書体の読み込みと JIT を温める (初めの 1 回の手間が、比の片方にだけ入らないように)
  await typesetHtml('<p>温め warm</p>', { loadFont: loadCachedFont });
}, 300_000);

const H = (body: string, css = '') => `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;
const html = (text: string, o: Record<string, unknown> = {}) => typesetHtml(text, { loadFont: loadCachedFont, ...o });

describe('まだ直していない悪い入力 (直す束が skip を外す)', () => {
  // 深い入れ子の表の手間 (0.7.0 で直す。台帳の HTM-204): 閉じない <li> を並べると、128 段の入れ子の上限で平らにした後も、入れ子の表
  // (リストも表で組む) の深い段を組む手間が大きい。ページの残りが無く分けられない深い段で、測る組みを段ごとにやり直すため。
  // 閉じない <ul><li> × 500 は 3.7 秒、閉じた <li> 500 個の文書は 0.37 秒 (比 10)。× 1 万で 49 秒・3.7GB (レビューの値)
  it.skip('閉じない <ul><li> を並べた文書も、閉じた同じ数の <li> の文書の数倍で組む (深い入れ子の表。0.7.0)', async () => {
    const n = 500;
    await expectRatio(4, () => html(H('<ul><li>x'.repeat(n))), () => html(H('<ul>' + '<li>x</li>'.repeat(n) + '</ul>')), { label: '閉じない <li>' });
  }, 300_000);

  // 深い入れ子の表の手間 (0.7.0 で直す。台帳の HTM-204・LAY-22): 閉じない <table><tr><td> を並べると、128 段の入れ子の中に表が並び、
  // 祖先の段ごとの計測で中の表を組み直す。× 250 は 4.5 秒、× 1000 は 22 秒。閉じた行 250 個の表は 0.35 秒 (比 13)
  it.skip('閉じない <table><tr><td> を並べた文書も、閉じた同じ数の行の表の数倍で組む (深い入れ子の表。0.7.0)', async () => {
    const n = 250;
    await expectRatio(4, () => html(H('<table><tr><td>x'.repeat(n))), () => html(H('<table>' + '<tr><td>x</td></tr>'.repeat(n) + '</table>')), { label: '閉じない <td>' });
  }, 300_000);
});

describe('直した悪い入力', () => {
  // HTM-202 の一部 (直した): 入れ子の表 (リストも表で組む) で、外の段の行をページで分けるたびに、中の段の行を測る組みをやり直し、段 k の表を k 回組んだ。
  // 直す前の main で、32 段の入れ子のリストの中の <p> 1000 個は、入れ子の無い <p> 1000 個の 2.7 倍 (0.97 秒と 0.36 秒)。
  // 分けると決まる行では、前に測った高さを使って測る組みを省く直しで 1.3 倍。ページの残りが無く分けられない深い段の手間 (閉じない <li> を並べたもの) は、上の skip のもの
  it('入れ子のリストの中の長い中身も、入れ子の無い同じ中身の 2 倍までで組む (HTM-202 の一部)', async () => {
    const body = '<p>y</p>'.repeat(1000);
    await expectRatio(2, () => html(H('<ul><li>x'.repeat(32) + body)), () => html(H(body)), { label: '32 段の入れ子のリスト' });
  }, 300_000);

  // HTM-201 (直した): 後続の兄弟の結合子 (A ~ B) の照合が、規則 × 要素 × 前の兄弟の手間。.cN ~ * の規則 4,500 個と <p> 400 個で 52 秒 (直す前の main。CPU)。
  // 規則 500 個と <p> 400 個で、~ の規則は 6.1 秒、同じ数の隣の兄弟の結合子 (+) の規則は 0.31 秒 (比 20)。
  // 親ごと・左の部分ごとに、初めに合う子の位置を覚える直しで通る (規則 4,500 個と <p> 400 個で 1.4 秒。+ の規則は 1.3 秒)
  it('後続の兄弟の結合子 (~) の規則が多くても、隣の兄弟の結合子 (+) の同じ数の規則の数倍で組む (HTM-201)', async () => {
    const rules = Array.from({ length: 500 }, (_, i) => `.c${i} ~ * { color: red }`).join('\n');
    const body = '<p>x</p>'.repeat(400);
    await expectRatio(3, () => html(H(body, rules)), () => html(H(body, rules.replaceAll(' ~ ', ' + '))), { label: '.cN ~ * の規則 500 個' });
  }, 300_000);

  // OUT-89 (直した): PNG の画素化で、グラデーションの止まり点を 1 画素ごとに先頭から探していたので、1 画素の手間が止まり点の数に比例した。
  // 直す前の main で、周期 0.02px の箱 40 個は 2.7 秒、周期 20px の同じ箱は 0.33 秒 (比 8)。周期 0.005px の箱 10 個は比 11。止まり点を二分で探す直しで通る
  it('止まり点の多い繰り返しのグラデーションも、止まり点の少ないものの数倍で PNG にする (OUT-89)', async () => {
    const page = (period: number) =>
      html(H('<div class=g></div>'.repeat(10), `.g { height: 20px; background: repeating-linear-gradient(90deg, red 0, blue ${period}px, red ${2 * period}px) }`));
    const [fine, coarse] = await Promise.all([page(0.005), page(20)]);
    await expectRatio(3, () => fine.renderPageToPng(0, { dpi: 96 }), () => coarse.renderPageToPng(0, { dpi: 96 }), { label: '周期 0.005px のグラデーション' });
  }, 300_000);

  it('<col span> と colspan の大きな表は、上限 (1000) で抑え、1 セルの表の数倍で組む', async () => {
    // 前は <col span="4000000"> で列を 400 万作り、<td colspan="100000"> で組版が 7.4 秒
    await expectRatio(4, () => html(H('<table><col span="4000000"><tr><td colspan="100000">a</td></tr></table>')), () => html(H('<table><tr><td>a</td></tr></table>')), { label: '大きな span' });
  }, 120_000);

  it('深い入れ子 (div 1600 段と span 1600 段) は、上限で平らにし、同じ数の並んだ要素の数倍で組む', async () => {
    // 前は div 800 段・span 1200 段でスタックを使い切った (入れ子の上限 128 段の外は平らに読む)
    const d = 1600;
    await expectRatio(
      4,
      () => html(H('<div>'.repeat(d) + 'x' + '</div>'.repeat(d) + '<span>'.repeat(d) + 'y' + '</span>'.repeat(d))),
      () => html(H('<div>x</div>'.repeat(d) + '<span>y</span>'.repeat(d))),
      { label: '深い入れ子' },
    );
  }, 120_000);

  it('入れ子の深い calc() (4000 段) は、深い所へ入らずに読み、calc の無い文書の数倍で組む', async () => {
    // 前は段ごとに再帰して、スタックがあふれた (48KB で 9 秒の後に例外)
    const d = 4000;
    await expectRatio(3, () => html(H('<p class=c>x</p>', `.c { filter: blur(${'calc('.repeat(d)}1px + 10%${')'.repeat(d)}) }`)), () => html(H('<p class=c>x</p>', '.c { filter: blur(1px) }')), {
      label: '深い calc()',
    });
  }, 120_000);

  it('自分を 5 回 @import する CSS は、循環を切り、@import の無い文書の数倍で組む', async () => {
    // 前は展開が指数的に膨らみ、ヒープを使い切った
    const files = [{ name: 'a.css', data: '@import "a.css";'.repeat(5) + 'p { color: red }' }];
    const r = await html(H('<p>x</p>', '@import "a.css";'), { files });
    expect(r.pageCount).toBe(1);
    await expectRatio(3, () => html(H('<p>x</p>', '@import "a.css";'), { files }), () => html(H('<p>x</p>', 'p { color: red }')), { label: '自分を @import する CSS' });
  }, 120_000);

  it('::footnote-call の前の選択子の、後続の兄弟の結合子の長い並びも、すぐに照合する', async () => {
    // 前は css-select の総当たりで、兄弟 60 個 (742 バイト) で 137 秒
    const sel = '.nope' + ' ~ div'.repeat(30);
    const doc = (css: string) => H('<div>x</div>'.repeat(60) + '<p>本文<span class=f>注</span></p>', css);
    await expectRatio(3, () => html(doc(`.f { float: footnote } ${sel} .f::footnote-call { content: "*" }`)), () => html(doc('.f { float: footnote } .f::footnote-call { content: "*" }')), {
      label: '::footnote-call の兄弟の並び',
    });
  }, 120_000);

  it('閉じた <li> を並べた文書の手間は、<li> の数に比例する', async () => {
    // 閉じない <li> の形 (上の skip のもの) と比べる元。1 万個で 2.5 秒ほど
    await expectGrowth(8, (n) => html(H('<ul>' + '<li>x</li>'.repeat(n) + '</ul>')), 500, { label: '<li> の並び' });
  }, 120_000);
});
