
import { rejoin, thisCall } from './callContext';
import { parseLanguageTag, type LanguageTagParts } from './languageTag';

/**
 * hyphenation — 欧文の分綴の位置 (hyphen パッケージ、ISC。TeX の分綴パターン)。
 *
 * パターンは大きいので、分綴を使う文書を開いたときだけ読み込む (loadHyphenator)。
 * 英語・ラテン語・ロシア語・ウクライナ語・現代ギリシャ語 (単調の綴りの規則)・ドイツ語 (新正書法・旧正書法・スイスの旧正書法)・フランス語・スペイン語・
 * イタリア語・ポルトガル語・オランダ語・ポーランド語・デンマーク語・ノルウェー語・フィンランド語・スロバキア語・スロベニア語・クロアチア語・
 * エストニア語・リトアニア語・アイルランド語・ウェールズ語・ガリシア語・バスク語・ブルガリア語・スウェーデン語・カタルーニャ語・アイスランド語・
 * トルコ語・セルビア語 (セルビア・クロアチア語のラテン文字とキリル文字)・ハンガリー語の規則を読み込む (PATTERNS)。
 * 言語のタグから規則を選ぶ決まりは hyphenationKey (XSL-FO の ISO 639-2 の 3 字の符号も読む)。
 * ほかの言語は分綴しない (CSS Text 3 §5.3: 自動の分綴は、文の言語が分かり、その言語に合う分綴の資源があるときだけ)。
 * 多調の綴りのギリシャ語 (el-polyton など)・古典ギリシャ語 (grc) は、規則を入れていないので分綴しない。
 */

type Sync = (text: string, opts?: { hyphenChar?: string; minWordLength?: number }) => string;
type Mod = { default?: { hyphenateSync: Sync }; hyphenateSync?: Sync };

const cache = new Map<string, Sync>();

/** 分綴の規則 (hyphen パッケージのパターン) の、読み込み方と、綴る文字 (ISO 15924 の符号を小文字にしたもの) */
interface Pattern {
  load: () => Promise<unknown>;
  script: 'latn' | 'cyrl' | 'grek';
  /**
   * 語の初めと終わりに残す最小の字数 (上流の hyph-utf8 の hyphenmins の typesetting。TeX の lefthyphenmin・righthyphenmin)。
   * 2・2 と違うものだけ書く。hyphenate-limit-chars の auto (CSS Text 4: 言語に合わせて UA が決めてよい) と、XSL-FO で
   * hyphenation-push/remain-character-count を指定しないときの値にする。前からある言語 (en・la・ru・uk・el) には書かない (組版の結果を変えないため)
   */
  mins?: readonly [number, number];
}

/**
 * 言語ごとの分綴の規則 (hyphen パッケージのパターン。必要になったときだけ読み込む)。名前はパターンの名前。
 * hyphen の別名の入口 (hyphen/de・hyphen/sr など) は使わず、パターンの名前の入口を書く (別名の先に、配れないライセンスのパターンがあるため)。
 * ここに足すパターンは、vite.config.ts の HYPHEN_NOTICES に著作権とライセンスの表示を、THIRD_PARTY_NOTICES.md の 1.4 節に上流の表示を足す
 */
const PATTERNS: Record<string, Pattern> = {
  'en-us': { load: () => import('hyphen/en-us/index.js'), script: 'latn' },
  'en-gb': { load: () => import('hyphen/en-gb/index.js'), script: 'latn' },
  la: { load: () => import('hyphen/la/index.js'), script: 'latn' },
  ru: { load: () => import('hyphen/ru/index.js'), script: 'cyrl' },
  uk: { load: () => import('hyphen/uk/index.js'), script: 'cyrl' },
  'el-monoton': { load: () => import('hyphen/el-monoton/index.js'), script: 'grek' },
  'de-1996': { load: () => import('hyphen/de-1996/index.js'), script: 'latn' },
  'de-1901': { load: () => import('hyphen/de-1901/index.js'), script: 'latn' },
  'de-ch-1901': { load: () => import('hyphen/de-ch-1901/index.js'), script: 'latn' },
  fr: { load: () => import('hyphen/fr/index.js'), script: 'latn' },
  es: { load: () => import('hyphen/es/index.js'), script: 'latn' },
  it: { load: () => import('hyphen/it/index.js'), script: 'latn' },
  pt: { load: () => import('hyphen/pt/index.js'), script: 'latn', mins: [2, 3] },
  nl: { load: () => import('hyphen/nl/index.js'), script: 'latn' },
  pl: { load: () => import('hyphen/pl/index.js'), script: 'latn' },
  da: { load: () => import('hyphen/da/index.js'), script: 'latn' },
  nb: { load: () => import('hyphen/nb/index.js'), script: 'latn' },
  fi: { load: () => import('hyphen/fi/index.js'), script: 'latn' },
  sk: { load: () => import('hyphen/sk/index.js'), script: 'latn', mins: [2, 3] },
  sl: { load: () => import('hyphen/sl/index.js'), script: 'latn' },
  hr: { load: () => import('hyphen/hr/index.js'), script: 'latn' },
  et: { load: () => import('hyphen/et/index.js'), script: 'latn', mins: [2, 3] },
  lt: { load: () => import('hyphen/lt/index.js'), script: 'latn' },
  ga: { load: () => import('hyphen/ga/index.js'), script: 'latn', mins: [2, 3] },
  cy: { load: () => import('hyphen/cy/index.js'), script: 'latn', mins: [2, 3] },
  gl: { load: () => import('hyphen/gl/index.js'), script: 'latn' },
  eu: { load: () => import('hyphen/eu/index.js'), script: 'latn' },
  bg: { load: () => import('hyphen/bg/index.js'), script: 'cyrl' },
  sv: { load: () => import('hyphen/sv/index.js'), script: 'latn' },
  ca: { load: () => import('hyphen/ca/index.js'), script: 'latn' },
  is: { load: () => import('hyphen/is/index.js'), script: 'latn' },
  tr: { load: () => import('hyphen/tr/index.js'), script: 'latn' },
  'sh-latn': { load: () => import('hyphen/sh-latn/index.js'), script: 'latn' },
  'sh-cyrl': { load: () => import('hyphen/sh-cyrl/index.js'), script: 'cyrl' },
  hu: { load: () => import('hyphen/hu/index.js'), script: 'latn' },
};

/** 読み込む分綴の規則の名前 (試験から照らす) */
export const HYPHENATION_PATTERNS: readonly string[] = Object.keys(PATTERNS);

/**
 * 言語のタグ (BCP 47。RFC 5646) → 分綴の規則の名前。RFC 4647 §3.4 の lookup と同じに、言語の符号を主にして、文字・地域・異形で選ぶ。
 * 言語の指定の無いもの (undefined) は英語 (米国式)。空のタグ・規則の無い言語は undefined (CSS Text 3 §5.3: 資源の無い言語は分綴しない)。
 * タグに文字 (script) があって、規則の文字と違えば当てない (ru-Latn など)
 */
export function hyphenationKey(language: string | undefined): string | undefined {
  const t = parseLanguageTag(language ?? 'en');
  if (!t) return undefined;
  const key = patternOf(t);
  if (!key || !PATTERNS[key]) return undefined;
  if (t.script && t.script !== PATTERNS[key].script) return undefined;
  return key;
}

function patternOf(t: LanguageTagParts): string | undefined {
  switch (t.language) {
    // 英語は英国 (GB) だけ英国式、ほかは米国式
    case 'en':
      return t.region === 'gb' ? 'en-gb' : 'en-us';
    // 現代ギリシャ語は単調の綴りの規則。多調の綴り (el-polyton など) には当てない
    case 'el':
      return t.variants.includes('polyton') ? undefined : 'el-monoton';
    // ドイツ語: 旧正書法 (異形 1901) は、スイス・リヒテンシュタインはスイスの旧正書法、ほかは旧正書法。ほか (異形 1996・無し。スイスの新正書法も) は新正書法
    case 'de':
      if (t.variants.includes('1901')) return t.region === 'ch' || t.region === 'li' ? 'de-ch-1901' : 'de-1901';
      return 'de-1996';
    // ノルウェー語: ブークモール・ニーノシュク・ノルウェー語は、hyphen では同じパターン (並びが違うだけ)
    case 'nb':
    case 'nn':
    case 'no':
      return 'nb';
    // セルビア語: 文字で選ぶ。文字の無いものは、モンテネグロ (ME) はラテン文字、ほかはキリル文字 (CLDR の likely subtags)。
    // hyphen の sr-cyrl (GPL) ではなく、セルビア・クロアチア語の sh-latn・sh-cyrl (LPPL) を使う
    case 'sr':
      if (t.script) return t.script === 'latn' ? 'sh-latn' : 'sh-cyrl';
      return t.region === 'me' ? 'sh-latn' : 'sh-cyrl';
    // セルビア・クロアチア語 (古いタグ): キリル文字のほかはラテン文字
    case 'sh':
      return t.script === 'cyrl' ? 'sh-cyrl' : 'sh-latn';
    default:
      return t.language;
  }
}

/** 言語に合う分綴の規則を読み込む。対応していない言語は undefined */
export async function loadHyphenator(language: string | undefined): Promise<Sync | undefined> {
  const key = hyphenationKey(language);
  if (!key) return undefined;
  if (!cache.has(key)) {
    const mod = rejoin(thisCall(), await PATTERNS[key].load()) as Mod;
    const h = mod.default?.hyphenateSync ?? mod.hyphenateSync;
    if (!h) return undefined;
    cache.set(key, h);
  }
  return cache.get(key);
}

/**
 * 分綴を使う文書 (CSS か要素の style 属性に hyphens: auto がある) なら、文書に出てくる言語 (lang・xml:lang。無ければ en) の分綴の規則を読み込む
 */
export async function loadDocumentHyphenators(doc: Document, css: string): Promise<void> {
  const auto = /hyphens\s*:\s*auto/;
  let used = auto.test(css);
  const langs = new Set<string>([doc.documentElement.getAttribute('lang') || 'en']);
  const walk = (e: Element) => {
    for (const a of ['lang', 'xml:lang']) {
      const v = e.getAttribute(a);
      if (v) langs.add(v);
    }
    if (!used && auto.test(e.getAttribute('style') ?? '')) used = true;
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) walk(c);
  };
  walk(doc.documentElement);
  if (!used) return;
  for (const l of langs) rejoin(thisCall(), await loadHyphenator(l));
}

/**
 * その言語の分綴の規則の、語の初めと終わりに残す最小の字数 (上流の hyphenmins。Pattern の mins)。書いていない言語・規則の無い言語は undefined
 */
export function hyphenationMinimums(language: string | undefined): readonly [number, number] | undefined {
  const key = hyphenationKey(language);
  return key ? PATTERNS[key].mins : undefined;
}

/**
 * その言語の分綴で、語の字に数える字 (ラテン文字のほかに)。キリル文字の言語 (ロシア語・ウクライナ語・ブルガリア語・キリル文字のセルビア語) はキリル文字、
 * 現代ギリシャ語はギリシャ文字、ウェールズ語はラテン拡張追加の字。
 * 規則を持たない言語・ラテン文字の言語は undefined (語の字はラテン文字だけ)
 */
export function hyphenationLetters(language: string | undefined): RegExp | undefined {
  const key = language ? hyphenationKey(language) : undefined;
  const script = key ? PATTERNS[key].script : undefined;
  return script === 'cyrl' ? CYRILLIC_WORD : script === 'grek' ? GREEK_WORD : key === 'cy' ? LATIN_EXTENDED_ADDITIONAL_WORD : undefined;
}
const CYRILLIC_WORD = /^[\u0400-\u052F]+$/;
const GREEK_WORD = /^[\u0370-\u03FF\u1F00-\u1FFF]+$/;
/** ウェールズ語の ẁ・ẃ・ẅ・ỳ など (ラテン拡張追加。語の字の既定の範囲 (Latin-1 補助・ラテン拡張 A・B) の外) */
const LATIN_EXTENDED_ADDITIONAL_WORD = /^[\u1E00-\u1EFF]+$/;

/**
 * 分綴する語の字数 (コードポイント) の上限。実在の語で最も長いものは、辞書の英語で 45 字 (pneumonoultramicroscopicsilicovolcanoconiosis)、
 * 複合語のドイツ語で 80 字ほど (Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft) なので、
 * その 1.5 倍を超える 128 字あれば、実在の文の語には届かない
 */
const MAX_HYPHENATE_WORD = 128;

/**
 * 読み込み済みの規則で、語の分綴の位置 (その字の後ろで分けてよい、0 始まりの字の位置) を返す。
 * minWordLength は分綴する語の最小の字数 (既定 5。hyphenate-limit-chars の 1 つ目の値を指定したときに渡る)。
 * 切れ目の前後は、規則の決まりで 2 字以上 (それより小さい制限を指定しても、2 字より短くは分けない)
 */
export function hyphenPositions(word: string, language: string | undefined, minWordLength = 5): number[] | undefined {
  const key = hyphenationKey(language);
  const h = key ? cache.get(key) : undefined;
  if (!h) return undefined;
  // 長すぎる語は分綴しない (切れ目なし)。分綴の規則 (依存の hyphen) は語の長さの 2 乗の時間がかかり、空白の無い欧文の 1 語が
  // 34KB で 4 秒、135KB で 47 秒かかった
  if (word.length > MAX_HYPHENATE_WORD && [...word].length > MAX_HYPHENATE_WORD) return [];
  const parts = h(word, { hyphenChar: '\u00AD', minWordLength: Math.max(1, minWordLength) }).split('\u00AD');
  const out: number[] = [];
  let at = -1;
  for (let k = 0; k < parts.length - 1; k++) {
    at += [...parts[k]].length;
    out.push(at);
  }
  return out;
}
