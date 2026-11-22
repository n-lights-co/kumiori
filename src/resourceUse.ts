/**
 * 文書を組むときに、実際に使った資源を呼ぶ側 (Node のコマンド) に知らせる、内部の仕組み (公開の API ではない)。
 * TypesetOptions に RESOURCE_USE の鍵で ResourceUse を入れておくと、組版が画像を引くたびに、その画像の鍵 (登録した名前を normalizeSrc したもの) を
 * usedKeys に、渡されたファイルのうち画像として扱ったものの名前を imageNames に入れる。コマンドは、出力で上書きしてはいけないファイルを、
 * 「中身を読んだファイル」ではなく「組版が実際に引いた画像」で決める (文書の字に名前が出てくるだけの画像や、名前の末尾だけが同じ別の
 * ディレクトリの画像は、中身を読んでも使っていないので、前に書き出したページの SVG・PNG を、次の書き出しで書き直せる)
 */
export const RESOURCE_USE: unique symbol = Symbol('kumiori.resourceUse');

export interface ResourceUse {
  /** 渡されたファイル (files) のうち、画像として扱ったものの名前 (KumioriFile.name のまま) */
  imageNames: Set<string>;
  /** 組版が引いた画像の鍵 (normalizeSrc した登録の名前) */
  usedKeys: Set<string>;
}

/** 選択肢から、内部の仕組みを取り出す (無ければ undefined) */
export function resourceUseOf(options: object): ResourceUse | undefined {
  return (options as { [RESOURCE_USE]?: ResourceUse })[RESOURCE_USE];
}
