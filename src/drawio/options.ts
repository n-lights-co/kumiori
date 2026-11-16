/** draw.io の図の選択肢 (TypesetOptions.drawio) */

import type { StencilRegistry } from './drawioStencil';

/** ファイルの中身 */
export type DrawioFileData = Uint8Array | ArrayBuffer | string;

/** ファイル (名前と中身。中身は、要るときに呼ぶ関数でもよい) */
export interface DrawioFile {
  name: string;
  data: DrawioFileData | (() => Promise<DrawioFileData>);
}

/**
 * 配布物のファイルを取る関数 (fetchStencils に渡す。手元に覚えておくときに使う)。
 * path: 配布物 (draw.io の webapp) の中の道。図形ライブラリは "js/stencils.min.js"、画像は "img/lib/sap/<名前>.svg" など。
 * url: 既定の取り先 (版を決めた draw.io の公開のリポジトリ)。fetch: Kumiori の取る道具 (大きさの上限・時限・転送の守りは本体と同じ)
 */
export type DrawioStencilFetcher = (path: string, ctx: { url: string; fetch: (url: string) => Promise<Uint8Array | undefined> }) => Promise<DrawioFileData | undefined>;

export interface DrawioOptions {
  /**
   * 図形ライブラリのファイル: draw.io の配布物の js/stencils.min.js (draw.io のすべてのライブラリ) か、ライブラリの XML (<shapes name="mxgraph.…">)。
   * 名前が .svg・.png・.jpg のファイルは、draw.io の配布物の画像 (SAP のアイコンの中の画像 img/lib/sap/<名前>.svg・クリップアート
   * img/lib/clip_art/…png など) として、ファイルの名前で引く。
   * Kumiori は図形ライブラリを持たない (draw.io の図形ライブラリには、利用の条件 (draw.io の stencils/LICENSE) がある)
   */
  stencils?: DrawioFile[];
  /**
   * 図が使う図形ライブラリ・配布物の画像が stencils に無いとき、draw.io の配布物からネットワークで取るか。既定 false (取らない。
   * 描けない形は文字だけ描いて警告する)。true なら、版を決めた draw.io の公開のリポジトリから (図形ライブラリは stencils.min.js。約 6.6MB)、
   * 文字列なら、その URL の stencils.min.js と、同じ場所の下の画像 (…/js/stencils.min.js に対して …/img/lib/…) から取る。
   * 関数なら、要るときに配布物の中の道を渡して呼ぶ (取り先は stencilsUrl か、文字列の fetchStencils)。
   * 取ったものは、同じ URL について、プロセス・画面の中で使い回す
   */
  fetchStencils?: boolean | string | DrawioStencilFetcher;
  /** 取り先の stencils.min.js の URL (fetchStencils が true か関数のとき。無ければ、版を決めた draw.io の公開のリポジトリ) */
  stencilsUrl?: string;
  /**
   * 図形ライブラリの登録所を、組版の外で持つとき (要るライブラリ・画像だけを、利用者の決めた所から取って足すときなど)。
   * 足りないライブラリの名前 (aws4 など) と配布物の画像の道を渡して呼ぶ。登録所を返せば、それで描き直す。
   * 登録所は createDrawioStencilRegistry で作り、足りないものを add・addImage で足して返す (同じ登録所を返し続けてよい)。
   * これを渡すと、stencils・fetchStencils は使わない
   */
  provideStencils?: (libraries: string[], images: string[]) => Promise<StencilRegistry | undefined>;
}
