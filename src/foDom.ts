/**
 * foDom — XSL-FO の読み込みが使う最小の DOM のインターフェースと、名前空間・SVG の書き戻し・base64 の補助。
 * xslfoImport (Importer)・foMathFallback・foPageMaster が共に使う。
 * DOM は最小限のインターフェース (XNode) だけを使う。ブラウザの DOMParser でも @xmldom/xmldom でも動く
 */

export interface XNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  namespaceURI?: string | null;
  textContent?: string | null;
  childNodes: ArrayLike<XNode>;
  hasAttribute?(name: string): boolean;
  getAttribute?(name: string): string | null;
  attributes?: ArrayLike<{ name: string; value: string }>;
}

export const FO_NS = 'http://www.w3.org/1999/XSL/Format';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

const escXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t: string) => escXml(t).replace(/"/g, '&quot;');

/**
 * FO の中の SVG 要素を、単独の SVG 文書の XML に書き戻す。svg: の接頭辞は外し、既定の名前空間を SVG にする。
 * 名前空間の宣言 (xmlns:*) は捨て、xlink:href のために xlink の宣言だけ付け直す
 */
export function serializeSvg(root: XNode): string {
  const walk = (n: XNode, isRoot: boolean): string => {
    if (n.nodeType === 3) return escXml(n.textContent ?? '');
    if (n.nodeType === 4) return `<![CDATA[${n.textContent ?? ''}]]>`;
    if (n.nodeType !== 1) return '';
    const name = n.namespaceURI === SVG_NS || n.nodeName.startsWith('svg:') ? (n.localName ?? n.nodeName.replace(/^svg:/, '')) : n.nodeName;
    let attrs = '';
    for (const a of Array.from(n.attributes ?? [])) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
      attrs += ` ${a.name}="${escAttr(a.value)}"`;
    }
    if (isRoot) attrs = ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"${attrs}`;
    const kids = Array.from(n.childNodes)
      .map((c) => walk(c, false))
      .join('');
    return kids ? `<${name}${attrs}>${kids}</${name}>` : `<${name}${attrs}/>`;
  };
  return walk(root, true);
}

/** 文字列の UTF-8 バイト列の base64 */
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(bin);
}

/** 要素 (XNode のうち nodeType が 1 のもの) */
export type XEl = XNode;
