/**
 * 対応仕様説明書 (docs/conformance) の見本が使う、既定の書体のほかの書体の一覧と、その取得。
 * 既定の書体 (src/fontMapping.ts) には、中国語・韓国語・アラビア文字・インド系の文字・タイ文字などの字、色の付いた絵文字、可変フォントが無いので、
 * 言語ごとの見本・絵文字の見本・可変フォントの見本は、ここの書体で組む。
 *
 * 書体のファイルはリポジトリに入れない (CLAUDE.md)。組むとき・テストのときに、Google Fonts の配信元 (fonts.gstatic.com) の、
 * 版の付いた URL (…/vNN/… の形。中身が変わらない) から取得して、置き場に置く。
 *  - HTML と CSS 編: 見本の @font-face の src が、この URL を直に指す (利用者がそのまま真似できる書き方)。
 *    説明書を組むとき (scripts/build-conformance.mjs) は、先に置き場へ取得したファイルを、組む文書の隣に URL の末尾の名前で置く
 *    (Kumiori は、@font-face の url() を、一緒に渡したファイルの名前でも突き合わせるので、組むたびにネットワークへ取りに行かない)。
 *  - XSL-FO 編: XSL-FO には書体のファイルを指す書き方が無いので、fo: true の書体を、コマンドの --font で渡す (見本の font-family は family の名前)。
 *  - テスト (test/conformance.test.ts): 置き場 (.cache/fonts) へ取得して、HTML には resolveResource で、XSL-FO には fonts で渡す。
 *
 * 説明書の中の fonts.gstatic.com の URL は、すべてこの一覧にあること (test/conformance.test.ts が確かめる)。
 * 書体を足す・版を上げるときは、ここと説明書 (4 冊) の URL・書体の一覧の表を一緒に直す。
 *
 * どの書体も SIL Open Font License 1.1 (Google Fonts で配られているもの)。file は置き場での名前で、test/helpers.ts の EXTRA_TEST_FONTS に
 * 同じ書体があれば、同じ名前・同じ URL にしてある (置き場のファイルを共用する)。
 * 大きさの目安 (2026-11 に取得したもの): 合わせて約 29MB。大きいのは Noto Sans SC (約 10.5MB)・Noto Sans TC (約 7.1MB)・Noto Sans KR (約 6.2MB)。
 * Noto Color Emoji は、全体 (約 25MB) ではなく、配信元が字の範囲で分けた WOFF2 のうち、見本の絵文字を持つものだけを使う。
 */
import fs from 'node:fs';
import path from 'node:path';

const G = 'https://fonts.gstatic.com/s/';

/**
 * @typedef {object} ConformanceFont
 * @property {string} file 置き場でのファイルの名前
 * @property {string} url 配信元の、版の付いた URL
 * @property {string} family 書体の名前 (name 表のファミリー名。XSL-FO の font-family に書く名前)
 * @property {boolean} [fo] XSL-FO 編でも使う (--font で渡す)
 */

/** @type {ConformanceFont[]} */
export const CONFORMANCE_FONTS = [
  // ── 言語・文字ごとの見本 (1 つの太さの TTF)
  { file: 'NotoSansSC-Regular-v41.ttf', url: `${G}notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf`, family: 'Noto Sans SC', fo: true },
  { file: 'NotoSansTC-Regular-v40.ttf', url: `${G}notosanstc/v40/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf`, family: 'Noto Sans TC', fo: true },
  { file: 'NotoSansKR-Regular-v40.ttf', url: `${G}notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf`, family: 'Noto Sans KR', fo: true },
  { file: 'NotoSansArabic-Regular-v33.ttf', url: `${G}notosansarabic/v33/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfyGyvuw.ttf`, family: 'Noto Sans Arabic', fo: true },
  { file: 'NotoSansHebrew-Regular-v50.ttf', url: `${G}notosanshebrew/v50/or3HQ7v33eiDljA1IufXTtVf7V6RvEEdhQlk0LlGxCyaeNKYZC0sqk3xXGiXd4qtog.ttf`, family: 'Noto Sans Hebrew', fo: true },
  { file: 'NotoSansDevanagari-Regular-v33.ttf', url: `${G}notosansdevanagari/v33/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlXQly-A.ttf`, family: 'Noto Sans Devanagari', fo: true },
  { file: 'NotoSansBengali-Regular-v33.ttf', url: `${G}notosansbengali/v33/Cn-SJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mcSPVFpVEqE-6KmsolLudA.ttf`, family: 'Noto Sans Bengali', fo: true },
  { file: 'NotoSansGurmukhi-Regular-v29.ttf', url: `${G}notosansgurmukhi/v29/w8g9H3EvQP81sInb43inmyN9zZ7hb7ATbSWo4q8dJ74a3cVrYFQ_bogT0-gPeG1Oenbx.ttf`, family: 'Noto Sans Gurmukhi' },
  { file: 'NotoSansGujarati-Regular-v27.ttf', url: `${G}notosansgujarati/v27/wlpWgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMR2Gw4VceEl7MA_ypFwPM.ttf`, family: 'Noto Sans Gujarati' },
  { file: 'NotoSansTamil-Regular-v31.ttf', url: `${G}notosanstamil/v31/ieVc2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-0429tBManUktuex7vGo70R.ttf`, family: 'Noto Sans Tamil', fo: true },
  { file: 'NotoSansTelugu-Regular-v30.ttf', url: `${G}notosanstelugu/v30/0FlxVOGZlE2Rrtr-HmgkMWJNjJ5_RyT8o8c7fHkeg-esVC5dzHkHIJQqrEntezbqQQ.ttf`, family: 'Noto Sans Telugu' },
  { file: 'NotoSansKannada-Regular-v32.ttf', url: `${G}notosanskannada/v32/8vIs7xs32H97qzQKnzfeXycxXZyUmySvZWItmf1fe6TVmgop9ndpS-BqHEyGrDvNzSI.ttf`, family: 'Noto Sans Kannada' },
  { file: 'NotoSansMalayalam-Regular-v29.ttf', url: `${G}notosansmalayalam/v29/sJoi3K5XjsSdcnzn071rL37lpAOsUThnDZIfPdbeSNzVakglNM-Qw8EaeB8Nss-_RuD9BA.ttf`, family: 'Noto Sans Malayalam' },
  { file: 'NotoSansSinhala-Regular-v36.ttf', url: `${G}notosanssinhala/v36/yMJ2MJBya43H0SUF_WmcBEEf4rQVO2P524V5N_MxQzQtb-tf5dJbC30Fu9zUwg2a5lg.ttf`, family: 'Noto Sans Sinhala' },
  { file: 'NotoSansThai-Regular-v29.ttf', url: `${G}notosansthai/v29/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU5RtpzE.ttf`, family: 'Noto Sans Thai', fo: true },
  { file: 'NotoSansLao-Regular-v33.ttf', url: `${G}notosanslao/v33/bx6lNx2Ol_ixgdYWLm9BwxM3NW6BOkuf763Clj73CiQ_J1Djx9pidOt4ccbdfw.ttf`, family: 'Noto Sans Lao' },
  { file: 'NotoSansKhmer-Regular-v29.ttf', url: `${G}notosanskhmer/v29/ijw3s5roRME5LLRxjsRb-gssOenAyendxrgV2c-Zw-9vbVUti_Z_dWgtWYuNAJz4.ttf`, family: 'Noto Sans Khmer' },
  { file: 'NotoSansMyanmar-Regular-v27.ttf', url: `${G}notosansmyanmar/v27/AlZU_y1ZtY3ymOryg38hOCSdOnFq0FP9_gnYM_ME0QeqLzz8-kqmtY3KLEbEGTOZltU.ttf`, family: 'Noto Sans Myanmar' },
  { file: 'NotoSerifTibetan-Regular-v24.ttf', url: `${G}notoseriftibetan/v24/gokGH7nwAEdtF9N45n0Vaz7O-pk0wsvxHeDXMfqguoCmIrYcPS4.ttf`, family: 'Noto Serif Tibetan', fo: true },
  { file: 'NotoSansMongolian-Regular-v23.ttf', url: `${G}notosansmongolian/v23/VdGCAYADGIwE0EopZx8xQfHlgEAMsrToxLs.ttf`, family: 'Noto Sans Mongolian', fo: true },
  // ── 絵文字: 色の付いた絵文字 (Noto Color Emoji。COLR version 1。配信元が字の範囲で分けた WOFF2 のうち、国旗・記号とキーキャップ・人・顔と手) と、
  //    単色の輪郭の絵文字 (Noto Emoji)。パレットを 7 つ持つ色つきの書体 (Nabla。欧文の部分の WOFF2)
  { file: 'NotoColorEmoji-v50-0.woff2', url: `${G}notocoloremoji/v50/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.0.woff2`, family: 'Noto Color Emoji' },
  { file: 'NotoColorEmoji-v50-2.woff2', url: `${G}notocoloremoji/v50/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.2.woff2`, family: 'Noto Color Emoji' },
  { file: 'NotoColorEmoji-v50-8.woff2', url: `${G}notocoloremoji/v50/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.8.woff2`, family: 'Noto Color Emoji' },
  { file: 'NotoColorEmoji-v50-9.woff2', url: `${G}notocoloremoji/v50/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFabsE4tq3luCC7p-aXxcn.9.woff2`, family: 'Noto Color Emoji', fo: true },
  { file: 'NotoEmoji-Regular-v65.ttf', url: `${G}notoemoji/v65/bMrnmSyK7YY-MEu6aWjPDs-ar6uWaGWuob-r0jwv.ttf`, family: 'Noto Emoji' },
  { file: 'Nabla-v17-latin.woff2', url: `${G}nabla/v17/j8_D6-LI0Lvpe7Makz5UhJt9C3uqg_X_75gyGS4jAxsNIjrRBRdeFQx8.woff2`, family: 'Nabla' },
  // ── 可変フォント (TrueType の輪郭。欧文の部分の WOFF2): Anybody (幅 wdth 50〜150・太さ wght 100〜900)、
  //    Roboto Flex (光学サイズ opsz 8〜144・太さ wght 100〜1000・幅 wdth 25〜151・傾き slnt -10〜0)
  { file: 'Anybody-v13-latin.woff2', url: `${G}anybody/v13/VuJxdNvK2Ib2ppdWSKHdOQ.woff2`, family: 'Anybody' },
  {
    file: 'RobotoFlex-v31-latin.woff2',
    url: `${G}robotoflex/v31/NaNTepOXO_NexZs0b5QrzlOHb8wCikXpYqmZsWI-__OGbt8jZktqc2V3Zs0KvDLdBP8SBZtOs2IifRuUZQMsPJtUsR4DEK6cULNeUx9XgTnH37Ha_FIAp4Fm0PP1hw45DntW2x0wZGzhPmr1YNMYKYn9_1IQXGwJAiUJVUMdN5YUW4O8HtSCUhhK.woff2`,
    family: 'Roboto Flex',
    fo: true,
  },
];

/** URL の末尾の名前 (? # を除く)。HTML 編を組むとき、この名前で文書の隣に置く */
export const urlBasename = (url) => decodeURIComponent(url.split(/[?#]/)[0].split('/').pop());

/** 文書の中の、配信元 (fonts.gstatic.com) の URL の並び (重なりは除く) */
export function fontUrlsIn(text) {
  return [...new Set(text.match(/https:\/\/fonts\.gstatic\.com\/[^\s)"'<>]+/g) ?? [])];
}

/**
 * 一覧の書体を置き場 (dir) に用意する (無いものだけ取得する)。戻り値は、URL → 置き場のファイルの場所。
 * 取得できなければ投げる (字の出ない説明書を、気付かずに作らない)。
 * 書きかけのファイルが残らないように、一時ファイルに書き終えてから名前を変える (test/helpers.ts の cachedFont と同じ)
 */
export async function ensureConformanceFonts(dir, fonts = CONFORMANCE_FONTS) {
  fs.mkdirSync(dir, { recursive: true });
  const out = new Map();
  for (const f of fonts) {
    const file = path.join(dir, f.file);
    if (!fs.existsSync(file)) {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`見本の書体を取得できません: ${res.status} ${f.url}`);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
        fs.renameSync(tmp, file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    }
    out.set(f.url, file);
  }
  return out;
}
