/**
 * xhtml — XHTML (application/xhtml+xml) の文書を、同じ中身の HTML の文字列に書き直す。
 *
 * XHTML は XML の構文で読む文書で、要素の名前空間は接頭辞と xmlns で決まる (HTML Living Standard の「The XML syntax」)。
 * 例えば `<s:svg xmlns:s="http://www.w3.org/2000/svg">` は SVG の svg 要素、`<m:math xmlns:m="…/MathML">` は MathML の math 要素。
 * HTML の構文ではこの接頭辞は名前空間として働かないので、名前空間に従って接頭辞の無い名前 (svg・math・HTML の要素) に書き直し、
 * あとは HTML と同じ処理 (CSS の適用・組版) に渡す。
 * XML として正しくない (整形式でない) 文書は、XML の構文の規則どおり誤りとする (例外)。
 */
import { msg } from './messages';
import { DOMParser } from '@xmldom/xmldom';

const NS = {
  html: 'http://www.w3.org/1999/xhtml',
  svg: 'http://www.w3.org/2000/svg',
  math: 'http://www.w3.org/1998/Math/MathML',
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
};
/** HTML の空要素 (終了タグを書かない) */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** 中身を文字のまま書く HTML の要素 (HTML の構文では、中身の & や < を文字参照として読まない) */
const RAW = new Set(['script', 'style']);

interface XNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  namespaceURI?: string | null;
  nodeValue?: string | null;
  data?: string;
  target?: string;
  childNodes: ArrayLike<XNode>;
  attributes?: ArrayLike<{ name: string; localName?: string | null; namespaceURI?: string | null; value: string }>;
  documentElement?: XNode;
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** XHTML の文字列 → HTML の文字列。XML として読めなければ例外 */
export function xhtmlToHtml(text: string): string {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level: string, msg: string) => void (level !== 'warning' && errors.push(msg)) }).parseFromString(text, 'application/xhtml+xml') as unknown as XNode;
  if (errors.length || !doc.documentElement) throw new Error(msg(`XHTML (XML) の解析に失敗しました: ${(errors[0] ?? '文書の要素がありません').slice(0, 200)}`, `XHTML (XML) parse error: ${(errors[0] ?? 'no document element').slice(0, 200)}`));
  // xml-stylesheet の処理命令 (type が text/css のもの) は、HTML の link 要素にする
  const sheets: string[] = [];
  for (const n of Array.from(doc.childNodes)) {
    if (n.nodeType === 7 && n.target === 'xml-stylesheet') {
      const d = n.data ?? '';
      const href = /href\s*=\s*["']([^"']*)["']/.exec(d)?.[1];
      const type = /type\s*=\s*["']([^"']*)["']/.exec(d)?.[1];
      if (href && (!type || type === 'text/css')) sheets.push(`<link rel="stylesheet" href="${escAttr(href)}">`);
    }
  }
  const out: string[] = ['<!DOCTYPE html>'];
  const write = (n: XNode, rawParent: boolean) => {
    if (n.nodeType === 3 || n.nodeType === 4) {
      const t = n.nodeValue ?? n.data ?? '';
      out.push(rawParent ? t : escText(t));
      return;
    }
    if (n.nodeType === 8) {
      out.push(`<!--${(n.nodeValue ?? '').replace(/--/g, '- -')}-->`);
      return;
    }
    if (n.nodeType !== 1) return;
    const ns = n.namespaceURI ?? '';
    const known = ns === NS.html || ns === NS.svg || ns === NS.math;
    // 名前空間の分かる要素は接頭辞を外す (SVG の要素の大文字小文字はそのまま)。ほかの名前空間の要素は、名前をそのまま書く
    const name = known ? (n.localName ?? n.nodeName) : n.nodeName;
    let tag = `<${name}`;
    const attrs = Array.from(n.attributes ?? []);
    // xml:lang だけを持つ要素には lang も書く (HTML の文書では :lang() は lang 属性だけを見る。HTML Living Standard §3.2.6.2)
    const xmlLang = attrs.find((a) => a.namespaceURI === NS.xml && a.localName === 'lang');
    if (xmlLang && !attrs.some((a) => !a.namespaceURI && (a.localName ?? a.name) === 'lang')) tag += ` lang="${escAttr(xmlLang.value)}"`;
    for (const a of attrs) {
      // 名前空間の宣言は書かない (HTML の構文では意味を持たない)
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:') || a.namespaceURI === NS.xmlns) continue;
      const an = a.namespaceURI === NS.xlink ? `xlink:${a.localName}` : a.namespaceURI === NS.xml ? `xml:${a.localName}` : a.namespaceURI ? a.name : (a.localName ?? a.name);
      tag += ` ${an}="${escAttr(a.value)}"`;
    }
    const kids = Array.from(n.childNodes);
    if (ns === NS.html && VOID.has(name)) {
      out.push(tag + '>');
      return;
    }
    // SVG・MathML の中身の無い要素は、HTML の構文でも自己終了の形で書ける
    if (ns !== NS.html && known && !kids.length) {
      out.push(tag + '/>');
      return;
    }
    out.push(tag + '>');
    if (ns === NS.html && name === 'head') out.push(...sheets);
    const raw = ns === NS.html && RAW.has(name);
    for (const c of kids) write(c, raw);
    out.push(`</${name}>`);
  };
  write(doc.documentElement, false);
  return out.join('');
}

/** 入力のファイル名が XHTML (拡張子 .xhtml・.xht) か */
export const isXhtmlFile = (name: string) => /\.(xhtml|xht)$/i.test(name);
