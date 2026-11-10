/**
 * linkPolicy — 文書の外への飛び先 (HTML の <a href>・XSL-FO の external-destination) を、PDF のどの動作にするかと、その動作を書いてよいかの判定。
 * 取り込み (htmlImport・xslfoImport) と PDF の書き出し (pdfRenderer の externalAction) が、同じ判定 (judgeExternalLink) を使う。
 *
 * 他人の書いた文書を組み、できた PDF を別の人が開く使い方を守るため、既定では次のものだけを通す:
 *  - スキームが http・https・mailto・tel の URL (URI 動作。ISO 32000-1 §12.6.4.7)
 *  - 相対参照の PDF (別の PDF を開く動作 GoToR。§12.6.4.3)
 * ほかのスキーム (javascript:・data:・file:・vbscript: など、すべて)、ファイルを開く動作 (Launch。§12.6.4.5。PDF でない相対のファイル)、
 * 絶対パスのファイル、スキームの無い //host/… の参照は、動作を書かない (字はそのまま組む)。LinkPolicy で、許すスキームと Launch を選べる
 */
import { msg } from './messages';

/** 外への飛び先のうち、PDF に動作を書いてよいもの */
export interface LinkPolicy {
  /**
   * 許す URL のスキーム (コロンは付けない。大文字と小文字は区別しない)。既定は http・https・mailto・tel。
   * 指定すれば、既定の一覧と置き換わる。'*' を入れれば、すべてのスキームを許す
   */
  schemes?: readonly string[];
  /**
   * ファイルを開く動作を許すか。既定 false。true なら、PDF でない相対のファイル (Launch 動作)・絶対パスのファイル・
   * スキームの無い //host/… の参照も、動作として書く
   */
  launch?: boolean;
}

/** 既定で許すスキーム */
export const DEFAULT_LINK_SCHEMES: readonly string[] = ['http', 'https', 'mailto', 'tel'];

/**
 * URL の前処理 (WHATWG URL §4.4 URL parsing の basic URL parser の始めの手順): 前後の C0 制御文字と空白 (U+0000〜U+0020) を取り、
 * タブと改行 (U+0009・U+000A・U+000D) を、どこにあっても取り除く。ブラウザは、この後の文字列でスキームを読むので、
 * "java\tscript:"・" javascript:" は javascript: の URL になる。判定も PDF への書き出しも、この後の文字列で行う
 */
export function cleanUrl(u: string): string {
  // eslint-disable-next-line no-control-regex
  return u.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
}

/**
 * URL のスキーム (小文字)。無ければ undefined。前処理 (cleanUrl) の後の文字列で読む。
 * 文法は WHATWG URL §4.4 の scheme start state・scheme state: 英字で始まり、英数字・+・-・. が続き、: で終わる
 * (RFC 3986 §3.1 の scheme と同じ)。大文字は小文字にする
 */
export function urlScheme(u: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(cleanUrl(u))?.[1].toLowerCase();
}

/** 外への飛び先の判定の結果 */
export interface LinkJudgement {
  /** PDF の動作の種類。uri: URI 動作、gotor: 別の PDF を開く、launch: ファイルを開く */
  kind: 'uri' | 'gotor' | 'launch';
  /** 前処理 (cleanUrl) の後の文字列。PDF には、これを書く */
  url: string;
  /** 動作を書いてよいか */
  allowed: boolean;
  /** 書かない理由の見出し (警告に出す。スキームの名前 "javascript:"、"起動 (Launch)" など)。allowed なら無い */
  reason?: string;
}

/** ファイルの指定が絶対パスか (/…・\…・C:… の形。%xx を戻した後の文字列で見る) */
const isAbsoluteFile = (file: string) => /^[\\/]|^[a-z]:/i.test(file);

/** 相対参照の、パスの部分 (? と # の前) */
export function referencePath(u: string): string {
  const q = u.search(/[?#]/);
  return q < 0 ? u : u.slice(0, q);
}

/** パスの %xx を戻す (正しくない %xx はそのまま) */
export function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * 外への飛び先を、PDF のどの動作にするかと、書いてよいかを決める。
 *  - スキームのある URL: URI 動作。スキームが policy.schemes (既定 http・https・mailto・tel) にあれば通す
 *  - スキームの無い //host/… (RFC 3986 §4.2 の network-path reference): URI 動作。基準の URL のスキームを継ぐ参照で、PDF には基準が無く、
 *    手元のファイルとして開いた PDF では file://host/… (ほかの機械の共有フォルダ) になり得るので、ファイルを開く動作と同じ扱い (policy.launch) にする。
 *    \\host\… は、ブラウザでは // と同じに読まれる (WHATWG URL §4.4 の relative state。特別なスキームでは \ を / として扱う) が、
 *    PDF ではファイルの指定になるので、下の絶対パスのファイルとして扱う (どちらも policy.launch のときだけ通る)
 *  - 相対参照 (§4.2) で、パスが .pdf で終わるもの: GoToR。絶対パス (/…・\…・C:…。%xx を戻した後で見る) は policy.launch のときだけ通す
 *  - ほかの相対参照: Launch。policy.launch のときだけ通す
 */
export function judgeExternalLink(raw: string, policy: LinkPolicy = {}): LinkJudgement {
  const url = cleanUrl(raw);
  const launch = policy.launch === true;
  const scheme = urlScheme(url);
  if (scheme !== undefined) {
    const allow = (policy.schemes ?? DEFAULT_LINK_SCHEMES).map((s) => String(s).trim().replace(/:$/, '').toLowerCase());
    const allowed = allow.includes('*') || allow.includes(scheme);
    return { kind: 'uri', url, allowed, ...(allowed ? {} : { reason: `${scheme}:` }) };
  }
  if (url.startsWith('//')) return { kind: 'uri', url, allowed: launch, ...(launch ? {} : { reason: '//host' }) };
  const path = referencePath(url);
  if (/\.pdf$/i.test(path)) {
    const allowed = launch || !isAbsoluteFile(decodePath(path));
    return { kind: 'gotor', url, allowed, ...(allowed ? {} : { reason: 'GoToR (absolute path)' }) };
  }
  return { kind: 'launch', url, allowed: launch, ...(launch ? {} : { reason: 'Launch' }) };
}

/** 動作を書かなかった飛び先の集計 (理由の見出しごとの件数と、最初の 1 件の先頭) */
export type DroppedLinks = Record<string, { count: number; sample: string }>;

/** 警告に出す URL の長さ (先頭だけ) */
const SAMPLE_LENGTH = 60;

/** 書かなかった飛び先を集計に足す */
export function countDroppedLink(into: DroppedLinks, j: LinkJudgement): void {
  const key = j.reason ?? j.kind;
  const e = (into[key] ??= { count: 0, sample: j.url.length > SAMPLE_LENGTH ? j.url.slice(0, SAMPLE_LENGTH) + '…' : j.url });
  e.count++;
}

/** 集計を 1 つにまとめる */
export function mergeDroppedLinks(into: DroppedLinks, from: DroppedLinks | undefined): DroppedLinks {
  for (const [k, v] of Object.entries(from ?? {})) {
    const e = (into[k] ??= { count: 0, sample: v.sample });
    e.count += v.count;
  }
  return into;
}

/** 集計を、警告の文の中身にする ("javascript: ×2 (javascript:alert(1)), Launch ×1 (x.exe)")。無ければ undefined */
export function summarizeDroppedLinks(d: DroppedLinks | undefined): string | undefined {
  const parts = Object.entries(d ?? {}).map(([k, v]) => `${k} ×${v.count} (${v.sample})`);
  return parts.length ? parts.join(', ') : undefined;
}

/** 動作を書かなかった飛び先の警告の文 (summary は summarizeDroppedLinks の結果) */
export function droppedLinkWarning(summary: string): string {
  return msg(
    `安全のため、リンクの動作を PDF に書きませんでした (字はそのまま組みます。links の設定で許せます): ${summary}`,
    `for safety, link actions were not written to the PDF (the text is typeset as is; the links option can allow them): ${summary}`,
  );
}
