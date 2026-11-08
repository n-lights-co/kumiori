/**
 * 型の無い依存パッケージ (utif・hyphen) のうち、Kumiori が呼んでいる部分だけの型。
 * 根拠は各パッケージの README と、公開している関数の引数 (node_modules の中の定義) だけ。
 */

declare module 'utif' {
  /** TIFF の 1 枚分のディレクトリ (IFD)。タグは "t" + タグ番号のキーで入る (例: t262) */
  interface TiffDirectory {
    /** decodeImage の後に入る: 画像の幅・高さ (px) と、展開した画素 */
    width: number;
    height: number;
    data?: Uint8Array;
    [tagKey: string]: unknown;
  }
  interface Utif {
    /** TIFF のバイト列から、IFD の並びを読む (画素はまだ展開しない) */
    decode(buffer: ArrayBuffer): TiffDirectory[];
    /** ifd の画素を展開し、width・height・data を ifd に足す */
    decodeImage(buffer: ArrayBuffer, ifd: TiffDirectory, all?: TiffDirectory[]): void;
    /** decodeImage 済みの ifd を、1 画素 4 バイト (RGBA、各 8 ビット) にする */
    toRGBA8(ifd: TiffDirectory): Uint8Array;
  }
  const utif: Utif;
  export default utif;
}

/** 分綴の設定 (README の Options) */
interface KumioriHyphenOptions {
  /** 分けてよい位置に入れる字 (既定は U+00AD) */
  hyphenChar?: string;
  /** これより短い語は分けない (既定 5) */
  minWordLength?: number;
}

declare module 'hyphen/en-us' {
  export function hyphenateSync(text: string, options?: KumioriHyphenOptions): string;
}

declare module 'hyphen/en-gb' {
  export function hyphenateSync(text: string, options?: KumioriHyphenOptions): string;
}

/** ほかの言語の規則 (hyphen/de・hyphen/la など)。どの言語も export-contract.js で同じ形 (hyphenateSync など) を書き出す */
declare module 'hyphen/*' {
  export function hyphenateSync(text: string, options?: KumioriHyphenOptions): string;
}
