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

/**
 * <svg> の要素 → 単独の SVG 文書 (XML) の文字列。
 *
 * 接頭辞つきの名前 (inkscape:label・sodipodi:namedview など) は、接頭辞の宣言が有効な範囲にあるときだけ書き出す
 * (Namespaces in XML 1.0 §5・§6 の制約「Prefix Declared」: 宣言の無い接頭辞は、整形式の文書に書けない)。
 * HTML の構文で読んだ文書では、xmlns:* は名前空間を持たないただの属性だが (HTML Living Standard §13.2.6.1 の
 * 「adjust foreign attributes」の表にあるのは xlink:*・xml:*・xmlns・xmlns:xlink だけ)、元の文書の書き手の宣言なので、そのまま宣言として書き出す。
 * 宣言の無い接頭辞の属性は落とし、宣言の無い接頭辞の要素は中身ごと落とす (どちらも SVG の描画には使われない)。
 * xlink は根元でいつも宣言し、xml は宣言なしで使える (同 §3)
 *
 * styleOf があれば、文書の CSS が決めた SVG の表示の性質 (fill・stroke・color など) を、要素の style 属性の終わりに書き足す。
 * HTML の文書のスタイルシートは、文書の中の SVG の内容にも効く (SVG 2 §6.4)。表示の属性は詳細度 0 の作成者の規則なので
 * (同 §6.6)、スタイルシートの規則が勝った性質は、属性より強い style 属性に書く (style 属性の同じ性質より後ろに書くので、
 * !important の規則が style 属性に勝ったときも、書き足した値が使われる)。
 * 根元の color (外から継承した値を含む) は、中で currentColor を使っているときだけ書く (color は、SVG では currentColor の値を決めるだけ。同 §13.3)。
 * styleOf が何も返さない文書では、書き出す SVG は styleOf の無いときと同じ
 */
export type InlineSvgStyle = (el: Element, isRoot: boolean) => Array<[string, string]>;
export function serializeInlineSvg(root: Element, styleOf?: InlineSvgStyle): string {
  const prefixOf = (name: string) => (name.includes(':') ? name.slice(0, name.indexOf(':')) : '');
  // 書ける接頭辞つきの名前か: 接頭辞と残りがどちらも空でなく、残りに : が無く、接頭辞の宣言が有効な範囲にある
  const usable = (name: string, scope: Set<string>) => {
    const p = prefixOf(name);
    const rest = name.slice(p.length + 1);
    return !!p && !!rest && !rest.includes(':') && scope.has(p);
  };
  // 書き出す宣言 (xmlns:接頭辞="…"): 値が空のもの (接頭辞の宣言の取り消しは XML 1.0 の名前空間では書けない)・xml・xmlns・xlink (根元で宣言する) は除く
  const declared = (a: Attr) => {
    const p = a.name.startsWith('xmlns:') ? a.name.slice(6) : '';
    return p && !p.includes(':') && a.value && !/^(xml|xmlns|xlink)$/.test(p) ? p : '';
  };
  const walk = (n: Node, isRoot: boolean, outer: Set<string>): string => {
    if (n.nodeType === 3 || n.nodeType === 4) return escText(n.nodeValue ?? '');
    if (n.nodeType !== 1) return '';
    const e = n as Element;
    const local = e.localName;
    const name = e.namespaceURI === SVG_NS ? (SVG_TAG_CASE[local] ?? local) : local;
    const all = Array.from(e.attributes);
    let scope = outer;
    let decls = '';
    for (const a of all) {
      const p = declared(a);
      if (!p) continue;
      if (scope === outer) scope = new Set(outer);
      scope.add(p);
      decls += ` ${a.name}="${escAttr(a.value)}"`;
    }
    if (isRoot) {
      // XML として読んだ文書 (XHTML) では、svg の外の祖先の宣言も有効: 中で使う接頭辞のうち、中に宣言の無いものを根元で宣言する
      const used = new Set<string>();
      const collect = (x: Element) => {
        for (const a of Array.from(x.attributes)) if (!a.name.startsWith('xmlns:')) used.add(prefixOf(a.name));
        used.add(prefixOf(x.localName));
        for (const c of Array.from(x.childNodes)) if (c.nodeType === 1) collect(c as Element);
      };
      collect(e);
      for (const p of used) {
        if (!p || scope.has(p)) continue;
        const ns = typeof e.lookupNamespaceURI === 'function' ? e.lookupNamespaceURI(p) : null;
        if (!ns) continue;
        if (scope === outer) scope = new Set(outer);
        scope.add(p);
        decls += ` xmlns:${p}="${escAttr(ns)}"`;
      }
    }
    if (name.includes(':') && !usable(name, scope)) return '';
    const kids = Array.from(e.childNodes)
      .map((c) => walk(c, false, scope))
      .join('');
    // 文書の CSS が決めた性質 (値に ; を含むものは、style 属性に書けないので渡さない)
    let extra = styleOf && e.namespaceURI === SVG_NS ? styleOf(e, isRoot).filter(([, v]) => !v.includes(';')) : [];
    if (isRoot && extra.some(([p]) => p === 'color')) {
      const rest = extra.filter(([p]) => p !== 'color');
      const uses = (t: string) => /currentcolor/i.test(t);
      if (!uses(kids) && !rest.some(([, v]) => uses(v)) && !all.some((a) => uses(a.value))) extra = rest;
    }
    const added = extra.map(([p, v]) => `${p}: ${v}`).join('; ');
    let attrs = '';
    let styled = !added;
    for (const a of all) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
      if (a.name.includes(':') && !usable(a.name, scope)) continue;
      let value = a.value;
      if (added && a.name === 'style' && !styled) {
        const own = value.trim().replace(/;\s*$/, '');
        value = own ? `${own}; ${added}` : added;
        styled = true;
      }
      attrs += ` ${a.name}="${escAttr(value)}"`;
    }
    if (!styled) attrs += ` style="${escAttr(added)}"`;
    attrs = (isRoot ? ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"` : '') + decls + attrs;
    return kids ? `<${name}${attrs}>${kids}</${name}>` : `<${name}${attrs}/>`;
  };
  return walk(root, true, new Set(['xlink', 'xml']));
}

/** <svg> の要素 → data:image/svg+xml;base64,… */
export function inlineSvgDataUri(root: Element, styleOf?: InlineSvgStyle): string {
  const bytes = new TextEncoder().encode(serializeInlineSvg(root, styleOf));
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}
