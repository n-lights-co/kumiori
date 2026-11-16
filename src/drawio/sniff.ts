/**
 * sniff — draw.io (diagrams.net) の図のファイル (.drawio・.dio。mxGraph の XML) の見分け。
 * 形式を作るとき (index.ts) に読むのは、このファイルだけ (図を描く処理は、draw.io の図が出てきたときに import() する)
 */

export const DRAWIO_MIME = 'application/vnd.jgraph.mxfile';

/**
 * XML の注釈 1 つ (XML 1.0 §2.5 Comments: '<!--' ((Char - '-') | ('-' (Char - '-')))* '-->') を表す正規表現の文字。
 * 中身は「'-->' で始まらない字」の並びにして、最初の '-->' で必ず閉じる (注釈は入れ子にならず、最初の '-->' で終わる。
 * 中身の '--' は仕様では誤りだが、見分けではゆるく読んで許す)。
 * '<!--[\s\S]*?-->' を '(?:…\s*)*' で繰り返すと、遅延の中身が '-->' を越えて次の注釈まで伸びられるので、注釈 n 個の分け方が
 * 2^(n-1) 通りになり、後ろが合わないときに全部を試して終わらなくなる。この形なら分け方は 1 通りで、手間は長さに比例する。
 * 頭の注釈を飛ばす判定 (isDrawio・drawioStencil の isSvgText・画面の isStencilFile) は、どれもこれを使う
 */
export const XML_COMMENT = String.raw`<!--(?:(?!-->)[\s\S])*-->`;

/** draw.io の図の頭: XML 宣言・注釈・空白 (XML 1.0 §2.8 の prolog の XMLDecl・Misc) の後ろに <mxfile か <mxGraphModel */
const DRAWIO_HEAD = new RegExp(String.raw`^\s*(?:<\?xml[^>]*\?>\s*)?(?:${XML_COMMENT}\s*)*<(?:mxfile|mxGraphModel)[\s>/]`);

/** 先頭が <mxfile か <mxGraphModel の XML (前の XML 宣言・コメント・空白は飛ばす) */
export function isDrawio(b: Uint8Array): boolean {
  let head = new TextDecoder().decode(b.subarray(0, 2048));
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  return DRAWIO_HEAD.test(head);
}
