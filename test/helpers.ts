/**
 * テスト用ヘルパー: Node 上で fontkit バックエンド (Canvas 不要) のエンジンを組み立てる。
 * フォントは .cache/fonts に無ければ Google Fonts 配信元から取得する (KUMIORI_FONT_DIR で上書き可)。
 */
import { walkAreas } from '../src/areaTree';
import fs from 'node:fs';
import path from 'node:path';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { FONT_SPECS, LATIN_SPECS, MONO_SPECS } from '../src/fontMapping';
import type { FontSpec, Area, LBlockLevel, LDocument, PageMaster, WritingMode, LPageSequence } from '../src/types';

const FONT_URL = 'https://fonts.gstatic.com/s/notoserifjp/v34/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwxOubA.ttf';
export const FAMILY = 'Noto Serif JP';

/** テストの書体の置き場 (.cache/fonts。KUMIORI_FONT_DIR で上書き可) */
export const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');

/** 同じワーカーの中で、同じファイルを 2 度取りに行かないための控え (ファイルの場所 → 取得の約束) */
const fetching = new Map<string, Promise<string>>();

/**
 * テストの書体を置き場に用意して、その場所を返す。無ければ url から取得して置く。
 * テストの書体の取得は、すべてここを通す (PKG-06。呼ぶのは下の fontBuffer・ensureFonts・defaultFontBuffer・extraTestFont・mathFontBuffer): vitest はテストのファイルごとに別のワーカーで並列に走るので、
 * 置き場へ直接書くと、書きかけのファイルを別のワーカーが「ある」と見て読んでしまう。
 * 一時ファイル (ワーカーごと・呼び出しごとに別の名前) に書き終えてから名前を変える (同じディレクトリの中の rename は、途中の状態が見えない) ので、
 * 置き場にある名前のファイルは、いつも全体が書かれている。2 つのワーカーが同時に取りに行ったときは、どちらも同じ中身を取り、後の rename が前のものを置き換えるだけ
 */
function cachedFont(name: string, url: string): Promise<string> {
  const file = path.join(fontDir, name);
  if (fs.existsSync(file)) return Promise.resolve(file);
  let p = fetching.get(file);
  if (!p) {
    p = (async () => {
      fs.mkdirSync(fontDir, { recursive: true });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font download failed: ${res.status} ${url}`);
      const data = Buffer.from(await res.arrayBuffer());
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      return file;
    })();
    fetching.set(file, p);
    // 失敗したら控えを消す (次の呼び出しで取り直せるように)
    p.catch(() => fetching.delete(file));
  }
  return p;
}

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** 既定の書体の、置き場でのファイルの名前 (urls の、https でない方の名前。無ければ配信元の URL の末尾) */
export const fontFileName = (spec: FontSpec): string => path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]);

/** 既定の書体 (FontSpec) を置き場に用意する (無いものだけ取得する) */
export async function ensureFonts(specs: readonly FontSpec[]): Promise<void> {
  await Promise.all(
    specs.map((spec) => {
      const url = spec.urls.find((u) => /^https:/.test(u));
      if (!url) throw new Error(`no download url: ${spec.family}`);
      return cachedFont(fontFileName(spec), url);
    }),
  );
}

/** 置き場の書体を読む、API の loadFont (ネットワークを使わない。置き場に無ければ undefined。先に ensureFonts で用意しておく) */
export const loadCachedFont = async (spec: FontSpec): Promise<ArrayBuffer | undefined> => {
  const f = path.join(fontDir, fontFileName(spec));
  return fs.existsSync(f) ? toArrayBuffer(fs.readFileSync(f)) : undefined;
};

export async function fontBuffer(): Promise<ArrayBuffer> {
  return toArrayBuffer(fs.readFileSync(await cachedFont('NotoSerifJP-Regular.ttf', FONT_URL)));
}

/**
 * 既定の書体 (src/fontMapping.ts の FONT_SPECS・LATIN_SPECS・MONO_SPECS) のファイルを読む。
 * 置き場に無ければ配信元から取得して置く (cachedFont)
 */
export async function defaultFontBuffer(name: string): Promise<ArrayBuffer> {
  const spec = [...FONT_SPECS, ...LATIN_SPECS, ...MONO_SPECS].find((s) => s.urls.some((u) => !/^https:/.test(u) && path.basename(u) === name));
  const url = spec?.urls.find((u) => /^https:/.test(u));
  if (!url) throw new Error(`not a default font: ${name}`);
  return toArrayBuffer(fs.readFileSync(await cachedFont(name, url)));
}

export async function makeEngine() {
  const fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  const measurer = new Measurer(fonts, 'fontkit');
  return { fonts, measurer, engine: new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY }) };
}

export const pt = (mm: number) => (mm * 72) / 25.4;

/** 100mm 角、余白 10mm → 本文領域 80mm (226.77pt) */
export const master = (over: Partial<PageMaster> = {}): PageMaster => ({
  width: 100,
  height: 100,
  bleed: 3,
  trimMarks: false,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  ...over,
});

export function doc(children: LBlockLevel[], wm: WritingMode = 'horizontal-tb', seq: Partial<LPageSequence> = {}): LDocument {
  return {
    type: 'document',
    sequences: [
      { type: 'page-sequence', master: master(), flow: { type: 'flow', writingMode: wm, fontSize: 10, children }, ...seq },
    ],
  };
}

export const lines = (n: number, prefix = '行') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n');

/** Area Tree を深さ優先・前順にたどる (子の欄は areaTree.ts の childrenOf で決める) */
export function walk(a: Area, f: (a: Area) => void) {
  walkAreas(a, (x) => void f(x as Area));
}

/**
 * 既定の書体 (src/fontMapping.ts) のほかに、テストが取得して使う書体 (置き場でのファイルの名前 → 配信元)。どれも SIL Open Font License 1.1 で、リポジトリには入れない。
 * テストが取得する書体は、fontMapping.ts の一覧とこの表ですべて (CI の書体のキャッシュのキーは、この 2 つのファイルから作る。.github/workflows/ci.yml)。
 * テストに書体を足すときは、ここに足す (テストのファイルに URL を直に書かない)
 */
export const EXTRA_TEST_FONTS = {
  // Google Fonts の配信の WOFF2 (glyf・loca を変換したもの)。Lobster の欧文 (latin) の部分 (test/webFont.test.ts)
  'Lobster-latin.woff2': 'https://fonts.gstatic.com/s/lobster/v32/neILzCirqoswsqX9zoKmMw.woff2',
  // 名前で引く CFF (PostScript の FontType 2。test/postscript.test.ts): Source Sans 3 の OTF (配布元のリポジトリの、版のタグ 3.052R のファイル)。
  // 字の名前が H・i のような Adobe の標準の名前であることが要る ((Hi) show が、標準の符号化の名前で字を引くため。
  // リポジトリから 1 つのファイルで取れる Inter の OTF (3.x) は、字の名前が uni0048 の形なので使えない)
  'SourceSans3-Regular-3.052R.otf': 'https://raw.githubusercontent.com/adobe-fonts/source-sans/3.052R/OTF/SourceSans3-Regular.otf',
  // CID で引く CFF (test/postscript.test.ts): Noto Sans JP の OTF (Google Fonts の配信元の、版の付いた URL。今の版は TrueType の輪郭なので、CFF だった版を指す)
  'NotoSansJP-Regular-v25.otf': 'https://fonts.gstatic.com/s/notosansjp/v25/-F62fjtqLzI2JPCgQBnw7HFowAIO2lZ9hg.otf',
  // アラビア文字・ヘブライ文字 (test/rtlScripts.test.ts): Noto Sans Arabic・Noto Sans Hebrew の標準の太さ (Google Fonts の配信元の、版の付いた URL)
  'NotoSansArabic-Regular-v33.ttf': 'https://fonts.gstatic.com/s/notosansarabic/v33/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfyGyvuw.ttf',
  'NotoSansHebrew-Regular-v50.ttf': 'https://fonts.gstatic.com/s/notosanshebrew/v50/or3HQ7v33eiDljA1IufXTtVf7V6RvEEdhQlk0LlGxCyaeNKYZC0sqk3xXGiXd4qtog.ttf',
  // タイ文字・デーヴァナーガリー・ハングル (test/complexScripts.test.ts・test/hangul.test.ts): 既定の書体には、これらの字が無い。
  // Google Fonts の配信元の、版の付いた TTF (可変フォントから取り出した 1 つの太さ)
  'NotoSansThai-Regular-v29.ttf': 'https://fonts.gstatic.com/s/notosansthai/v29/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU5RtpzE.ttf',
  'NotoSansDevanagari-Regular-v33.ttf': 'https://fonts.gstatic.com/s/notosansdevanagari/v33/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlXQly-A.ttf',
  'NotoSansKR-Regular-v40.ttf': 'https://fonts.gstatic.com/s/notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf',
  // デーヴァナーガリー以外のインド系の文字 (test/indicScripts.test.ts): 直した誤りを固定するのに要る書体だけ (各 58〜245KB、合わせて約 1MB)。
  // Google Fonts の配信元の、版の付いた TTF
  'NotoSansBengali-Regular-v33.ttf': 'https://fonts.gstatic.com/s/notosansbengali/v33/Cn-SJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mcSPVFpVEqE-6KmsolLudA.ttf',
  'NotoSerifBengali-Regular-v31.ttf': 'https://fonts.gstatic.com/s/notoserifbengali/v31/hYkuPvggTvnzO14VSXltirUdnnkt1pwmWrprmO7RjE0a5BtdATYU1crFaM_5JfcAHnqn.ttf',
  'NotoSansGurmukhi-Regular-v29.ttf': 'https://fonts.gstatic.com/s/notosansgurmukhi/v29/w8g9H3EvQP81sInb43inmyN9zZ7hb7ATbSWo4q8dJ74a3cVrYFQ_bogT0-gPeG1Oenbx.ttf',
  'NotoSansTamil-Regular-v31.ttf': 'https://fonts.gstatic.com/s/notosanstamil/v31/ieVc2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-0429tBManUktuex7vGo70R.ttf',
  'NotoSansKannada-Regular-v32.ttf': 'https://fonts.gstatic.com/s/notosanskannada/v32/8vIs7xs32H97qzQKnzfeXycxXZyUmySvZWItmf1fe6TVmgop9ndpS-BqHEyGrDvNzSI.ttf',
  'NotoSansMalayalam-Regular-v29.ttf': 'https://fonts.gstatic.com/s/notosansmalayalam/v29/sJoi3K5XjsSdcnzn071rL37lpAOsUThnDZIfPdbeSNzVakglNM-Qw8EaeB8Nss-_RuD9BA.ttf',
  'NotoSansSinhala-Regular-v36.ttf': 'https://fonts.gstatic.com/s/notosanssinhala/v36/yMJ2MJBya43H0SUF_WmcBEEf4rQVO2P524V5N_MxQzQtb-tf5dJbC30Fu9zUwg2a5lg.ttf',
  // ラオ・クメール・ミャンマー・チベット・モンゴルの字 (test/seaScripts.test.ts): Google Fonts の配信元の、版の付いた TTF (1 つの太さ)
  'NotoSansLao-Regular-v33.ttf': 'https://fonts.gstatic.com/s/notosanslao/v33/bx6lNx2Ol_ixgdYWLm9BwxM3NW6BOkuf763Clj73CiQ_J1Djx9pidOt4ccbdfw.ttf',
  'NotoSansKhmer-Regular-v29.ttf': 'https://fonts.gstatic.com/s/notosanskhmer/v29/ijw3s5roRME5LLRxjsRb-gssOenAyendxrgV2c-Zw-9vbVUti_Z_dWgtWYuNAJz4.ttf',
  'NotoSansMyanmar-Regular-v27.ttf': 'https://fonts.gstatic.com/s/notosansmyanmar/v27/AlZU_y1ZtY3ymOryg38hOCSdOnFq0FP9_gnYM_ME0QeqLzz8-kqmtY3KLEbEGTOZltU.ttf',
  'NotoSerifTibetan-Regular-v24.ttf': 'https://fonts.gstatic.com/s/notoseriftibetan/v24/gokGH7nwAEdtF9N45n0Vaz7O-pk0wsvxHeDXMfqguoCmIrYcPS4.ttf',
  'NotoSansMongolian-Regular-v23.ttf': 'https://fonts.gstatic.com/s/notosansmongolian/v23/VdGCAYADGIwE0EopZx8xQfHlgEAMsrToxLs.ttf',
  // 語をアイコンにする合字の書体 (test/iconLigatures.test.ts): Material Icons (Google。Apache-2.0)。配布元のリポジトリの、版のタグの付いたファイル。
  // 3.0.1 は名前の合字を liga (標準の合字) に、4.0.0 は rlig (必須の合字) に入れている
  'MaterialIcons-Regular-3.0.1.ttf': 'https://raw.githubusercontent.com/google/material-design-icons/3.0.1/iconfont/MaterialIcons-Regular.ttf',
  'MaterialIcons-Regular-4.0.0.ttf': 'https://raw.githubusercontent.com/google/material-design-icons/4.0.0/font/MaterialIcons-Regular.ttf',
  // 可変フォント (test/variableFonts.test.ts): Anybody (欧文。幅 wdth 50〜150 と太さ wght 100〜900 の 2 軸。TrueType の輪郭。約 200KB)。
  // 配布元 (google/fonts) のリポジトリの、コミットを決めた URL。比べる相手は、同じ書体の静的な書体 (Google Fonts の配信元が可変フォントから
  // 取り出したもの。版の付いた URL。各約 60KB): 幅 150・太さ 900、幅 75・太さ 400、幅 100・太さ 700
  'Anybody-wdth-wght-5bb2873.ttf': 'https://raw.githubusercontent.com/google/fonts/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/anybody/Anybody%5Bwdth%2Cwght%5D.ttf',
  'Anybody-ExpandedBlack-v13.ttf': 'https://fonts.gstatic.com/s/anybody/v13/VuJbdNvK2Ib2ppdWYq311GH32hxIv0vD5wrncSUi2F_Wim4JfmfPrg.ttf',
  'Anybody-CondensedRegular-v13.ttf': 'https://fonts.gstatic.com/s/anybody/v13/VuJbdNvK2Ib2ppdWYq311GH32hxIv0tD5grncSUi2F_Wim4J12DPrg.ttf',
  'Anybody-Bold-v13.ttf': 'https://fonts.gstatic.com/s/anybody/v13/VuJbdNvK2Ib2ppdWYq311GH32hxIv0sd5grncSUi2F_Wim4JMGfPrg.ttf',
} as const;

/** EXTRA_TEST_FONTS の書体を置き場に用意して、その場所を返す (無ければ取得する。取得できなければ投げるので、テストは飛ばされずに失敗する) */
export const extraTestFont = (name: keyof typeof EXTRA_TEST_FONTS): Promise<string> => cachedFont(name, EXTRA_TEST_FONTS[name]);

/** 数式の書体 (STIX Two Math)。置き場に無ければ Google Fonts 配信元から取得する */
export async function mathFontBuffer(): Promise<ArrayBuffer> {
  return toArrayBuffer(fs.readFileSync(await cachedFont('STIXTwoMath-Regular.ttf', 'https://fonts.gstatic.com/s/stixtwomath/v12/pONg1hwwL_6M9EkZySr_yteUi1o.ttf')));
}
