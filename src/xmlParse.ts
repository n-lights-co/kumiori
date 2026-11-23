/**
 * XML (XSL-FO) の読み取り: DOCTYPE の内部実体を展開してから、@xmldom/xmldom で読む (ライブラリ・コマンド・画面で同じ)。
 * xmldom は、要素の行・列 (lineNumber・columnNumber) を持つので、診断の場所に使える (sourceLocation.ts)
 */
import { limits } from './limits';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { KumioriInputError, KumioriLimitError } from './errors';
import { KUMIORI_NS, type XNode } from './foDom';
import { msg } from './messages';
import { setDocumentSource } from './sourceLocation';

/** 内部実体の展開の上限: 入れ子の深さと、展開後の長さ (元の長さの倍数) */
export const ENTITY_MAX_DEPTH = 8;
const ENTITY_MAX_GROWTH = 16;
/**
 * 展開で増える長さの上限 (字の数)。展開後の長さを V8 の文字列の長さの上限 (約 2^29 字) より十分小さくする (それを超えると、
 * 分かる文の誤りの前に「Invalid string length」で終わる)。2^27 字 (約 1.3 億字) 増える展開は、実在の FO・XHTML には無い
 */
export const ENTITY_MAX_ADDED = 2 ** 27;
/**
 * 内部サブセットのある DOCTYPE (正規表現 /<!DOCTYPE\s[^[>]*\[([\s\S]*?)\]\s*>/i の exec と同じ結果: index・[0] 全体・[1] 内部サブセット)。
 * 正規表現のままだと、閉じない '<!DOCTYPE a' のたびに文字列の終わりまで読むので、長さの 2 乗の手間になった ('<!DOCTYPE a' を
 * 2 万個並べた 22 万字で 4.3 秒)。次の '[' か '>' の位置を覚えて使い回す (見つからなければ、それより後ろにも無い)
 */
function doctypeSubset(xml: string): { index: number; 0: string; 1: string } | undefined {
  const open = /<!DOCTYPE\s/gi;
  const close = /\]\s*>/g;
  let stop = -2;
  for (let m: RegExpExecArray | null; (m = open.exec(xml)); ) {
    const from = m.index + m[0].length;
    if (stop !== -1 && stop < from) {
      stop = -1;
      for (let k = from; k < xml.length; k++) {
        const c = xml.charCodeAt(k);
        if (c === 0x5b || c === 0x3e) {
          stop = k;
          break;
        }
      }
    }
    if (stop < 0) return undefined;
    if (xml.charCodeAt(stop) !== 0x5b) continue;
    // 内部サブセットの閉じ (最初の ']' + 空白 + '>')。無ければ、後ろの DOCTYPE にも無い
    close.lastIndex = stop + 1;
    const end = close.exec(xml);
    if (!end) return undefined;
    return { index: m.index, 0: xml.slice(m.index, end.index + end[0].length), 1: xml.slice(stop + 1, end.index) };
  }
  return undefined;
}

/**
 * 文字の中の実体参照 &name; を fn の返す文字に置き換える。CDATA 区間とコメントの中は置き換えない。正規表現
 * /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|&([A-Za-z_:][\w.:-]*);/g の replace (CDATA 区間とコメントはそのまま) と同じ結果。
 * 正規表現のままだと、閉じない '<!--' と '<![CDATA[' のたびに文字列の終わりまで読むので、長さの 2 乗の手間になった
 * ('<!--' を 2 万個並べた 8 万字で 0.9 秒)。閉じが見つからなければ、それより後ろの開きにも無いので、もう探さない
 */
function replaceEntityRefs(t: string, fn: (all: string, name: string) => string): string {
  const re = /<!\[CDATA\[|<!--|&([A-Za-z_:][\w.:-]*);/g;
  let noCdataEnd = false;
  let noCommentEnd = false;
  const out: string[] = [];
  let done = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(t)); ) {
    if (m[1] === undefined) {
      const comment = m[0] === '<!--';
      const e = (comment ? noCommentEnd : noCdataEnd) ? -1 : t.indexOf(comment ? '-->' : ']]>', m.index + m[0].length);
      if (e < 0) {
        if (comment) noCommentEnd = true;
        else noCdataEnd = true;
        re.lastIndex = m.index + 1;
      } else re.lastIndex = e + 3;
      continue;
    }
    out.push(t.slice(done, m.index), fn(m[0], m[1]));
    done = re.lastIndex;
  }
  out.push(t.slice(done));
  return out.join('');
}

/**
 * DOCTYPE の内部サブセットに宣言された内部実体 (<!ENTITY name "値">) を、文書の中の &name; に置き換える
 * (@xmldom/xmldom は内部実体を展開しないので、読み込みの前に自前で展開する。ブラウザの DOMParser と同じ結果にする)。
 * 外部実体 (SYSTEM・PUBLIC) と引数実体 (%) は展開しない。CDATA 区間とコメントの中は置き換えない。
 * 値の中の実体参照も展開する (深さ ENTITY_MAX_DEPTH まで。展開後の長さが元の ENTITY_MAX_GROWTH 倍を超えたら止める)
 */
export function expandInternalEntities(xml: string): string {
  const dt = doctypeSubset(xml);
  if (!dt) return xml;
  const ents = new Map<string, string>();
  for (const m of dt[1].matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) if (!ents.has(m[1])) ents.set(m[1], m[2] ?? m[3] ?? '');
  if (!ents.size) return xml;
  // 上限は、元の長さの ENTITY_MAX_GROWTH 倍と、元の長さ + ENTITY_MAX_ADDED の小さい方
  const lim = limits();
  const entityDepth = lim.entityDepth;
  const limit = Math.min(xml.length * ENTITY_MAX_GROWTH, xml.length + lim.entityChars);
  const tooLarge = () => new KumioriLimitError('limit/entity-expansion', msg('XML の解析に失敗しました: 内部実体の展開が大きすぎます', 'XML parse error: the expansion of internal entities is too large'));
  const tooDeep = (name: string) => new KumioriLimitError('limit/entity-expansion', msg(`XML の解析に失敗しました: 実体 &${name}; の入れ子が深すぎます`, `XML parse error: entity &${name}; is nested too deeply`), { args: { entity: name } });
  // 実体ごとに、展開した値と入れ子の高さ (自分を 1 段と数え、中で参照する実体の段を足したもの) を 1 度だけ作って覚える
  // (XML 1.0 §4.4.5: 内部実体の置換文は、参照のたびに同じ)。参照のたびに展開し直すと、空に展開される実体を入れ子で n 個ずつ参照する
  // 文書 (長さは増えない) で、手間が n の段数乗になっていた (1KB で 100 秒を超える)
  // refs: 実体の値の中で参照する実体の名前 (現れた順)。覚えた実体を深い所で参照して上限を超えたときに、覚える前と同じ実体
  // (覚えずに前から順に展開したとき、最初に上限の深さで参照される実体) を誤りに名指すため (tooDeepAt)
  const memo = new Map<string, { text: string; height: number; refs: string[] }>();
  /** 実体 name を深さ depth で参照したとき、前から順に展開して最初に上限に当たる参照の名前 */
  const tooDeepAt = (name: string, depth: number): string => {
    for (let n = name, d = depth; ; d++) {
      if (d >= entityDepth) return n;
      const next = memo.get(n)?.refs.find((r) => d + 1 + (memo.get(r)?.height ?? 0) > entityDepth);
      if (next === undefined) return n;
      n = next;
    }
  };
  const expand = (t: string, depth: number): { text: string; height: number; refs: string[] } => {
    // 置き換えた結果の長さを、置き換えるたびに数える。置き換えを終えてから長さを見ると、1 つずつは上限の内の大きな実体を
    // 何万回も参照する文書 (6 万字の実体 × 2 万個の参照。120KB) で、replace の結果が文字列の長さの上限を超え、
    // 分かる文の誤りの前に「Invalid string length」で終わっていた
    let size = t.length;
    let height = 0;
    const refs: string[] = [];
    const text = replaceEntityRefs(t, (all, name) => {
      const v = ents.get(name);
      if (v === undefined) return all;
      // 入れ子の深さ: 参照した所の深さ depth と、実体の高さの和が ENTITY_MAX_DEPTH まで (覚える前と同じ決まり。循環する実体も、ここで止まる)
      if (depth >= entityDepth) throw tooDeep(name);
      refs.push(name);
      let e = memo.get(name);
      if (!e) {
        const inner = expand(v, depth + 1);
        e = { text: inner.text, height: inner.height + 1, refs: inner.refs };
        if (e.text.length > limit) throw new KumioriLimitError('limit/entity-expansion', msg(`XML の解析に失敗しました: 実体 &${name}; の展開が大きすぎます`, `XML parse error: the expansion of entity &${name}; is too large`), { args: { entity: name } });
        memo.set(name, e);
      } else if (depth + e.height > entityDepth) throw tooDeep(tooDeepAt(name, depth));
      height = Math.max(height, e.height);
      size += e.text.length - all.length;
      if (size > limit) throw tooLarge();
      return e.text;
    });
    return { text, height, refs };
  };
  const bodyAt = dt.index + dt[0].length;
  const body = expand(xml.slice(bodyAt), 0).text;
  if (body.length > limit) throw tooLarge();
  return xml.slice(0, bodyAt) + body;
}

/** FO を読む: xmldom で解析する (解析の誤りは例外)。DOCTYPE の内部実体は先に展開する */
export const xmlParse = (xml: string, sourceName?: string): XNode => {
  const errors: string[] = [];
  // Kumiori の拡張の属性 (kumiori:warichu など) を、名前空間を宣言せずに書いた文書は、接頭辞の宣言が無いので XML の誤りになる
  // (Namespaces in XML 1.0 §5.1: 接頭辞は宣言しなければ使えない)。宣言の書き方を案内する
  const undeclared = /\skumiori:[\w.-]+\s*=/.test(xml) && !/\sxmlns:kumiori\s*=/.test(xml);
  const hint = undeclared ? msg(` (kumiori: の属性を使うときは、fo:root に xmlns:kumiori="${KUMIORI_NS}" を書いてください)`, ` (to use kumiori: attributes, write xmlns:kumiori="${KUMIORI_NS}" on fo:root)`) : '';
  const parseError = (m: string, cause?: unknown) => new KumioriInputError('input/xml-parse', msg(`XML の解析に失敗しました: ${m.slice(0, 200)}`, `XML parse error: ${m.slice(0, 200)}`) + hint, cause !== undefined ? { cause } : {});
  const expanded = expandInternalEntities(xml);
  let d: unknown;
  try {
    d = new XmlDOMParser({ onError: (level, msg) => void (level !== 'warning' && errors.push(msg)) }).parseFromString(expanded, 'text/xml');
  } catch (e) {
    // 致命的な誤り (閉じていない要素など) では、xmldom が自分の ParseError を投げる: 入力の誤りとして、同じ文にする
    throw parseError(errors[0] ?? (e instanceof Error ? e.message : String(e)), e);
  }
  if (errors.length) throw parseError(errors[0]);
  // 診断の場所: xmldom の行・列は、展開した後の字のもの。展開で改行の数が変われば行を、字が変われば列を使わない
  const newlines = (t: string) => t.split('\n').length;
  setDocumentSource(d as object, undefined, sourceName, { lines: newlines(expanded) === newlines(xml), columns: expanded === xml });
  return d as XNode;
};
