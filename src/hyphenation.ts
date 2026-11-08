/**
 * hyphenation — 欧文の分綴の位置 (hyphen パッケージ、ISC。TeX の分綴パターン)。
 *
 * パターンは大きいので、分綴を使う文書を開いたときだけ読み込む (loadHyphenator)。
 * 英語 (en・en-US・en-GB) とラテン語 (la) の規則を読み込む (LOADERS)。ほかの言語は分綴しない。
 */

type Sync = (text: string, opts?: { hyphenChar?: string; minWordLength?: number }) => string;
type Mod = { default?: { hyphenateSync: Sync }; hyphenateSync?: Sync };

const cache = new Map<string, Sync>();

/** 言語ごとの分綴の規則 (hyphen パッケージの言語。必要になったときだけ読み込む) */
const LOADERS: Record<string, () => Promise<unknown>> = {
  'en-us': () => import('hyphen/en-us/index.js'),
  'en-gb': () => import('hyphen/en-gb/index.js'),
  la: () => import('hyphen/la/index.js'),
};

/** 言語の名前 (BCP 47) → 規則の名前。英語は en-GB だけ英国式、ほかの英語 (と言語の指定の無いもの) は米国式 */
function keyOf(language: string | undefined): string | undefined {
  const l = (language ?? 'en').toLowerCase().replace(/_/g, '-');
  if (/^en-gb/.test(l)) return 'en-gb';
  if (/^en\b/.test(l)) return 'en-us';
  const primary = l.split('-')[0];
  return LOADERS[primary] ? primary : undefined;
}

/** 言語に合う分綴の規則を読み込む。対応していない言語は undefined */
export async function loadHyphenator(language: string | undefined): Promise<Sync | undefined> {
  const key = keyOf(language);
  if (!key) return undefined;
  if (!cache.has(key)) {
    const mod = (await LOADERS[key]()) as Mod;
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
  for (const l of langs) await loadHyphenator(l);
}

/** 読み込み済みの規則で、語の分綴の位置 (その字の後ろで分けてよい、0 始まりの字の位置) を返す */
export function hyphenPositions(word: string, language: string | undefined): number[] | undefined {
  const key = keyOf(language);
  const h = key ? cache.get(key) : undefined;
  if (!h) return undefined;
  const parts = h(word, { hyphenChar: '\u00AD', minWordLength: 5 }).split('\u00AD');
  const out: number[] = [];
  let at = -1;
  for (let k = 0; k < parts.length - 1; k++) {
    at += [...parts[k]].length;
    out.push(at);
  }
  return out;
}
