/** pako 1.x の、draw.io の図を読む処理が使う部分の型 (raw deflate の圧縮を解く Inflate) */
declare module 'pako' {
  class Inflate {
    constructor(options?: { raw?: boolean; chunkSize?: number });
    push(data: Uint8Array, mode?: boolean): boolean;
    onData: (chunk: Uint8Array) => void;
    err: number;
  }
  const pako: { Inflate: typeof Inflate };
  export default pako;
}
