/**
 * structure — タグ付き PDF の構造の木 (ISO 32000-1 §14.7・§14.8)。
 *
 * 読み込み (HTML) が、要素ごとの構造の節 (StructNode) の並びを LDocument.structure に入れ、入力の節 (LBlock・LInline・LImage…) の
 * tag に、その節の構造の節の番号を付ける。組版は入力の節の通し番号 (sourceRef) を Area に付けるので、ここでは「通し番号 → 構造の節の番号」
 * の表 (AreaStructure.tags) を作り、描くとき (paint.ts・pdfRenderer.ts) に Area の sourceRef から構造の節を引く。
 *
 * 構造の木の順 (kids の順) は入力の順 (文書の論理の順) で、これがそのまま読む順になる (§14.8.2.3: 構造の木のある文書では、
 * 内容の流れの順 (描く順) は読む順を決めない)。段組み・回り込み・絶対配置で描く順が入れ替わっても、読む順は変わらない。
 */
import { documentNodes } from './sourceRef';
import type { LDocument } from './types';

/**
 * 構造の節 1 つ。role は PDF の標準の構造の型 (ISO 32000-1 §14.8.4) の名前か、'Artifact' (飾り。構造の木に入れず、中身を
 * Artifact として包む。§14.8.2.2)。
 */
export interface StructNode {
  /** 構造の型 (P・H1・Figure・Table など。PDF の標準の構造の型の名前) か 'Artifact' */
  role: string;
  /**
   * 独自の構造の型の名前 (XSL-FO の role・axf:pdftag に、標準の型でない名前を書いたもの)。PDF にはこの名前で書き、StructTreeRoot の
   * RoleMap で role (標準の型) に写す (§14.7.3)
   */
  custom?: string;
  /** 親の構造の節の番号 (根元の文書は -1。Artifact も -1) */
  parent: number;
  /** 子の構造の節の番号 (入力の順) */
  kids: number[];
  /** 言語 (BCP 47)。親と違うときだけ (§14.9.2) */
  lang?: string;
  /** 代わりの説明 (図・数式の Alt。§14.9.3) */
  alt?: string;
  /** 略語の展開 (E。§14.9.5) */
  expansion?: string;
  /**
   * Artifact の種類 (§14.8.2.2 の Type と Subtype): pagination (柱・ノンブル)・header・footer (ページの上・下の柱。Type Pagination の
   * Subtype Header・Footer)・layout (飾り)。role が 'Artifact' のときだけ
   */
  artifact?: ArtifactKind;
  /**
   * 構造の節の ID (§14.7.2 の Table 323 の ID。StructTreeRoot の IDTree から引く)。注 (Note) には必ず付ける (ISO 14289-1 §7.9)。
   * 表の見出しのセル (Headers で指すもの) にも付ける。同じ値が 2 つ以上あれば、書くときに後のものの後ろに番号を足す
   */
  sid?: string;
  /** 表の見出しのセル (TH) の向き (§14.8.5.7 の Table 349 の Scope) */
  scope?: 'Row' | 'Column' | 'Both';
  /** 表のセル (TH・TD) が、またぐ行・列の数 (Table 349 の RowSpan・ColSpan。1 より大きいときだけ) */
  rowSpan?: number;
  /** またぐ列の数 (rowSpan と同じく、1 より大きいときだけ) */
  colSpan?: number;
  /** 表のセルの見出しのセル (Table 349 の Headers): 見出しのセルの構造の節の番号の並び (書くときに、その ID の並びにする) */
  headers?: number[];
  /**
   * 親の中身の項目 (MCID) の間で、この節を置く所の目印にする構造の節の番号: その節の最初の項目のすぐ後ろに置く。
   * 脚注の本体 (Note) は、ページの下に描くが、読む順では本文の参照の印 (Reference) のすぐ後ろに置く (ISO 14289-1 §7.9)
   */
  anchor?: number;
}

/**
 * PDF の標準の構造の型 (ISO 32000-1 §14.8.4 の Table 333〜Table 340)。XSL-FO の role・axf:pdftag に、これらの名前を書けば、その型にする
 * (ほかの名前は、独自の型として書き、RoleMap で既定の型に写す)
 */
export const STANDARD_STRUCT_TYPES = new Set([
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody', 'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP',
  'Figure', 'Formula', 'Form',
]);

/** 飾り (Artifact) の種類 (StructNode.artifact) */
export type ArtifactKind = 'pagination' | 'header' | 'footer' | 'layout';

/** 領域の木の構造の情報: 構造の節の並び (0 番が文書) と、入力の節の通し番号 (sourceRef) → 構造の節の番号の表 (-1: 無し) */
export interface AreaStructure {
  /** 構造の節の並び (0 番が文書) */
  nodes: StructNode[];
  /** 入力の節の通し番号 (Area の sourceRef) → 構造の節の番号 (-1: 無し) */
  tags: number[];
}

/** 入力の文書の構造の情報 (構造の木を持たない文書は undefined)。nodes は、組版が番号を付けた入力の節の並び (無ければ作る) */
export function areaStructure(doc: LDocument, nodes?: readonly object[]): AreaStructure | undefined {
  if (!doc.structure?.length) return undefined;
  const list = nodes ?? documentNodes(doc);
  const tags = list.map((n) => {
    const t = (n as { tag?: unknown }).tag;
    return typeof t === 'number' ? t : -1;
  });
  return { nodes: doc.structure, tags };
}

/** 構造の節の番号に当たる飾り (Artifact) の種類。飾りでなければ undefined */
export function artifactOf(s: AreaStructure, id: number): ArtifactKind | undefined {
  const n = s.nodes[id];
  return n?.role === 'Artifact' ? (n.artifact ?? 'layout') : undefined;
}
