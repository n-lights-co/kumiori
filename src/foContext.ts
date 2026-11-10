/**
 * foContext — XSL-FO の読み込みで、親から子へ渡す文脈 (Ctx: 字の大きさ・書字方向・字下げ・包含ブロックの寸法・空白の扱いなど) と、
 * 空白・改行の扱い (WhiteSpace)。xslfoImport (Importer) と foPageMaster が共に使う
 */
import type { TextStyle, WritingMode } from './types';

export interface Ctx {
  fontSize: number;
  wm: WritingMode;
  /** 親から継承した start/end-indent (pt)。子の margin は差分で表す */
  startIndent: number;
  endIndent: number;
  /** 絶対配置の基準 (本文領域の左上, pt) */
  refOrigin: { x: number; y: number };
  /** 絶対配置の基準の領域の大きさ (pt)。right・bottom の位置と、上下 (左右) の両方の指定からの寸法に使う */
  refSize?: { w: number | undefined; h: number | undefined };
  /** ブロックコンテナの中 (絶対配置の基準は、そのコンテナの内容の箱) */
  inContainer?: boolean;
  /** ページの大きさ (pt)。absolute-position="fixed" の基準と、ページ座標の right・bottom に使う */
  pageSize?: { w: number; h: number };
  /** 包含ブロック (親のブロックの内容の矩形) の inline 方向の寸法。margin・padding・text-indent の百分率の基準 (§7.11.1 など)。無ければ width */
  cbW?: number;
  /** 包含ブロックの高さ (明示されているときだけ)。height・block-progression-dimension の百分率の基準 (§7.15.6・§7.15.3)。無ければ百分率は auto */
  cbH?: number;
  /** 空白・改行の扱い (継承される。§7.16.7 / 7.16.8 / 7.16.12 / 7.16.13) */
  ws: WhiteSpace;
  /** 親の本文幅 (pt)。% の解決に使う */
  width?: number;
  /** 段組のページの、段をまたぐ (span="all") ブロックの幅 (pt)。flow の直下の要素だけが使う */
  spanW?: number;
  /** 右から左へ書く横組み (writing-mode="rl-tb" / direction="rtl")。start は右 */
  rtl?: boolean;
  /** 横・縦の書字方向に無い向き (bt-lr・lr-bt など)。組んだ後に軸を裏返す (WritingFlip) */
  flip?: import('./types').WritingFlip;
  /** 言語 (xml:lang / language。継承される) */
  lang?: string;
  /** language・xml:lang に書いたままの言語 (country を足す前。継承される) */
  langBase?: string;
  /** 国 (country。XSL 1.1 §7.10.1。継承される) */
  country?: string;
  /** 分綴の制限 (hyphenation-character などをまとめたもの。継承される) */
  hyph?: import('./types').HyphenLimits;
  /** この要素を含む fo:page-sequence (fo:page-number の番号の前後に付ける fo:folio-prefix・fo:folio-suffix を探す。XSL 1.1 §6.6.10) */
  seqEl?: import('./foDom').XEl;
  /** static-content の中 (文字の「{pageNumber}」をページ番号の印にしない) */
  inStatic?: boolean;
  /** 外のリストの provisional-distance-between-starts・provisional-label-separation (pt。継承される) */
  listPdbs?: number;
  listSep?: number;
  /** 字の色 (継承される)。数式の図形 (伸ばした括弧・根号など) をこの色で描く */
  color?: string;
  /** relative-align (継承される。XSL 1.1 §7.14.6。初期値 before) */
  relAlign?: 'before' | 'baseline';
  /** 祖先で指定した axf:revision-bar-* の値 (どれも継承される) */
  revBar?: Partial<Record<'style' | 'color' | 'width' | 'offset' | 'position', string>>;
  /** font-variant="small-caps" (継承される。§7.9.8)。字の並びに small caps の印を付ける */
  smallCaps?: boolean;
  /** 受け継いだ word-spacing (pt。§7.17.8)。normal で 0 に戻すかどうかを決めるのに使う */
  wordSpacing?: number;
  /** 受け継いだ glyph-orientation-vertical (§7.29.3) を写した字の向き。auto (mixed) に戻すかどうかを決めるのに使う */
  textOrientation?: 'mixed' | 'upright' | 'sideways';
  /** visibility が hidden・collapse (継承される。§7.30.17)。字の色を transparent にし、背景・罫線を描かない。color は見えるときの色のまま持つ */
  hidden?: boolean;
  /** text-transform (継承される。§7.17.6)。none は省略 */
  textTransform?: 'capitalize' | 'uppercase' | 'lowercase';
  /** 祖先の font-family の並び (太さだけを指定した要素で、書体を選び直すのに使う) */
  families?: string[];
  /** 祖先から継承している書体・揃えなど (脚注本体は本文のブロックの外見を引き継ぐ) */
  inh?: { fontFamily?: string; fontWeight?: number; fontStyle?: 'italic' | 'normal'; color?: string; textAlign?: TextStyle['textAlign']; lineHeight?: number; lineHeightPt?: number; fontStretch?: number };
}

/** 空白・改行の扱い。値と初期値は XSL 1.1 のとおり */
export interface WhiteSpace {
  /** linefeed-treatment (初期値 treat-as-space) */
  linefeed: 'ignore' | 'preserve' | 'treat-as-space' | 'treat-as-zero-width-space';
  /** white-space-treatment (初期値 ignore-if-surrounding-linefeed) */
  treatment: 'ignore' | 'preserve' | 'ignore-if-before-linefeed' | 'ignore-if-after-linefeed' | 'ignore-if-surrounding-linefeed';
  /** white-space-collapse (初期値 true) */
  collapse: boolean;
}
export const WS_INITIAL: WhiteSpace = { linefeed: 'treat-as-space', treatment: 'ignore-if-surrounding-linefeed', collapse: true };
