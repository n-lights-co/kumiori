/**
 * htmlSvg — HTML の文書の中に直接書いた <svg> (HTML の構文で読んだ、SVG の名前空間の要素) を、単独の SVG 文書の data URI にする。
 * 組版では <img> の画像と同じに扱う。
 *
 * HTML の構文で読むと、SVG の要素名は小文字になる。仕様では、SVG の名前空間の中の要素名を、次の表で正しい大文字小文字に戻す
 * (W3C HTML 5.2 勧告 8.2.5.5「外部の内容の字句の処理」の表。https://www.w3.org/TR/2017/REC-html52-20171214/syntax.html 、2026-11-03 取得)。
 * 解析器 (linkedom) がこの表を当てないことがあるので、書き出すときに当てる。属性名の大文字小文字は解析器が残す。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** 要素名 (小文字) → SVG の要素名 */
const SVG_TAG_CASE: Record<string, string> = Object.fromEntries(
  [
    'altGlyph',
    'altGlyphDef',
    'altGlyphItem',
    'animateColor',
    'animateMotion',
    'animateTransform',
    'clipPath',
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feComposite',
    'feConvolveMatrix',
    'feDiffuseLighting',
    'feDisplacementMap',
    'feDistantLight',
    'feDropShadow',
    'feFlood',
    'feFuncA',
    'feFuncB',
    'feFuncG',
    'feFuncR',
    'feGaussianBlur',
    'feImage',
    'feMerge',
    'feMergeNode',
    'feMorphology',
    'feOffset',
    'fePointLight',
    'feSpecularLighting',
    'feSpotLight',
    'feTile',
    'feTurbulence',
    'foreignObject',
    'glyphRef',
    'linearGradient',
    'radialGradient',
    'textPath',
  ].map((n) => [n.toLowerCase(), n]),
);

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** HTML の中の SVG の要素か */
export const isInlineSvg = (el: Element) => el.localName === 'svg' && el.namespaceURI === SVG_NS;

/** <svg> の要素 → 単独の SVG 文書 (XML) の文字列 */
export function serializeInlineSvg(root: Element): string {
  const walk = (n: Node, isRoot: boolean): string => {
    if (n.nodeType === 3 || n.nodeType === 4) return escText(n.nodeValue ?? '');
    if (n.nodeType !== 1) return '';
    const e = n as Element;
    const local = e.localName;
    const name = e.namespaceURI === SVG_NS ? (SVG_TAG_CASE[local] ?? local) : local;
    let attrs = '';
    for (const a of Array.from(e.attributes)) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
      attrs += ` ${a.name}="${escAttr(a.value)}"`;
    }
    if (isRoot) attrs = ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"${attrs}`;
    const kids = Array.from(e.childNodes)
      .map((c) => walk(c, false))
      .join('');
    return kids ? `<${name}${attrs}>${kids}</${name}>` : `<${name}${attrs}/>`;
  };
  return walk(root, true);
}

/** <svg> の要素 → data:image/svg+xml;base64,… */
export function inlineSvgDataUri(root: Element): string {
  const bytes = new TextEncoder().encode(serializeInlineSvg(root));
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}
