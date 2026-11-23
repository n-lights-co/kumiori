/**
 * drawioXml — draw.io の図 (drawio.ts) と図形ライブラリ (drawioStencil.ts) の XML を読む、小さな XML の読み取り (Kumiori で書いたもの)。
 * 本体の XML のパーサ (Node は @xmldom/xmldom、ブラウザは DOMParser) を使わずにここで読むのは:
 *  - 図と図形ライブラリは大きい (取ってくる stencils.min.js は約 6.6MB の圧縮で、解くと数十 MB になる)。形 10 万個 (20MB) の XML で、
 *    xmldom の約 1/5 の時間・約 1/3 のメモリで読める
 *  - 要素の数 (maxNodes)・入れ子の深さ (MAX_DEPTH)・読み飛ばす宣言の数の上限を、読みながら守る (読み終えてから数えるのでは、
 *    細工した小さなファイルでメモリを使い切るのを防げない。xmldom・DOMParser には、途中で止める仕組みが無い)
 *  - ブラウザと Node で同じに読む (本体のパーサは環境ごとに違い、壊れた XML をどこまで読むかが違う)
 */

/** XML の要素の数の上限の既定 (小さなファイルで大量のメモリ・時間を使わせない) */
const MAX_NODES = 200000;
/**
 * 要素の入れ子の深さの上限。これより深い要素は木に入れない (中身ごと読み飛ばす)。
 * draw.io の図は、セルの親子を parent の属性で書くので、XML の入れ子は浅い (mxfile/diagram/mxGraphModel/root/UserObject/mxCell/mxGeometry/Array/mxPoint の 9 段)。
 * 図形ライブラリの形も shapes/shape/foreground/path/move の 5 段ほど。深い入れ子 (<path> を 20 万段) は、木をたどる処理 (drawioStencil.ts の
 * stencilSvg の path の中の path など) の再帰で呼び出しの深さを使い切り、図の全体が読めない画像になった
 */
export const MAX_DEPTH = 256;


export interface XEl {
  name: string;
  attrs: Map<string, string>;
  children: XEl[];
  text: string;
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
/**
 * HTML のラベルでよく使う名前付きの文字参照 (HTML Living Standard §13.5 の表のうちの一部)。表に無い名前はそのまま残す
 */
export const HTML_ENT: Record<string, string> = {
  ...ENT,
  nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '\u00ad', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', bull: '\u2022', middot: '\u00b7', times: '\u00d7', divide: '\u00f7', deg: '\u00b0',
  plusmn: '\u00b1', yen: '\u00a5', euro: '\u20ac', pound: '\u00a3', cent: '\u00a2', sect: '\u00a7', para: '\u00b6', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', harr: '\u2194',
  le: '\u2264', ge: '\u2265', ne: '\u2260', micro: '\u00b5', alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', lambda: '\u03bb', mu: '\u03bc', pi: '\u03c0', sigma: '\u03c3', omega: '\u03c9',
};
/** XML の実体参照を戻す (XML 1.0 §4.1・§4.6 の 5 つと文字参照。DTD の実体は読まない)。table を渡せば、その名前も戻す */
export function decodeEntities(s: string, table: Record<string, string> = ENT): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return Object.hasOwn(table, e) ? table[e] : m;
  });
}

/**
 * 小さな XML の読み取り (要素・属性・文字。コメント・処理命令・DOCTYPE は飛ばし、CDATA は文字にする)。
 * 形式の判定 (ImageFormat.sniff) は同期で、XML のパーサを渡されないので、ここで読む。壊れた所からあとは捨てる
 */
export function parseXml(src: string, maxNodes = MAX_NODES, maxDepth = MAX_DEPTH): XEl | undefined {
  const root: XEl = { name: '#root', attrs: new Map(), children: [], text: '' };
  const stack: XEl[] = [root];
  // 開いている要素の名前ごとの数 (閉じのタグが、開いていない名前なら、並びをたどらずに飛ばす)。
  // 前は、閉じのタグごとに開いている要素の並びを後ろから探した: 開きのタグ 10 万段と、対応しない閉じのタグ 17 万個 (980KB) で 75 秒
  const open = new Map<string, number>();
  const attrRe = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  let count = 0;
  // 読み飛ばした宣言・処理命令・コメントの数 (要素の数と同じ上限。<!x> を 400 万個並べたものを読ませない)
  let skipped = 0;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      if (++skipped > maxNodes) break;
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? src.length : e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      if (++skipped > maxNodes) break;
      // 処理命令・DOCTYPE (内部サブセットの [ … ] も飛ばす。実体の定義は読まない)。
      // [ は、その宣言の > までの間だけで探す (前は文字列の終わりまで探した: <!x> を並べると、宣言ごとに残りの全部を探して 2 乗になった)
      const gt = src.indexOf('>', lt);
      const end = gt < 0 ? src.length : gt;
      let br = -1;
      if (src[lt + 1] === '!')
        for (let k = lt + 2; k < end; k++)
          if (src.charCodeAt(k) === 0x5b) {
            br = k;
            break;
          }
      const e = br >= 0 ? src.indexOf(']>', br) : gt;
      i = e < 0 ? src.length : e + (br >= 0 ? 2 : 1);
    } else if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      const name = src.slice(lt + 2, gt < 0 ? src.length : gt).trim();
      // 対応する開きの要素まで閉じる (閉じの無い要素は、そこで閉じたとみなす)。開いていない名前の閉じのタグは飛ばす
      if (open.get(name))
        for (let k = stack.length - 1; k > 0; k--) {
          const el = stack[k];
          open.set(el.name, open.get(el.name)! - 1);
          if (el.name === name) {
            stack.length = k;
            break;
          }
        }
      i = gt < 0 ? src.length : gt + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(src.slice(lt, lt + 256));
      if (!m) {
        top.text += '<';
        i = lt + 1;
        continue;
      }
      if (++count > maxNodes) break;
      const el: XEl = { name: m[1], attrs: new Map(), children: [], text: '' };
      let p = lt + m[0].length;
      for (;;) {
        attrRe.lastIndex = p;
        const a = attrRe.exec(src);
        if (!a) break;
        el.attrs.set(a[1], decodeEntities(a[2] ?? a[3] ?? ''));
        p = attrRe.lastIndex;
      }
      const gt = src.indexOf('>', p);
      if (gt < 0) break;
      // 深すぎる要素は木に入れない (閉じのタグを合わせるために、開いている並びには入れる。中身は、木に無い要素の下に入るので捨てる)
      if (stack.length <= maxDepth) top.children.push(el);
      if (src[gt - 1] !== '/') {
        stack.push(el);
        open.set(el.name, (open.get(el.name) ?? 0) + 1);
      }
      i = gt + 1;
    }
  }
  return root.children[0];
}

export const kids = (el: XEl | undefined, name?: string) => (el?.children ?? []).filter((c) => !name || c.name === name);

/** 数の属性 (読めなければ d) */
export const num = (v: string | undefined, d: number) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
/** SVG に書く数 (小数 2 桁まで) */
export const f = (n: number) => String(Math.round(n * 100) / 100);
/** SVG の属性と文字に書く字を逃がす (XML に書けない制御文字は落とす) */
export const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
