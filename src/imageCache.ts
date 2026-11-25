/**
 * imageCache — 描画 (renderPage。Canvas・OffscreenCanvas) で使う、デコードした画像 (ImageBitmap) のキャッシュ (design/pdf-writer.md の 13)。
 *
 * ブラウザーでは、画像の格納先 (AssetStore) は、読み込みのときに画像を画素にしない (大きさは画像の頭から読む)。renderPage は、描画する前に、
 * そのページの画像をこのキャッシュから引き、無ければデコードして入れ、そろってから同期で 1 度に描画する。
 * キャッシュは Typesetter 全体で 1 つ (Typesetter を使わない typeset の結果は、結果ごとに 1 つ)。鍵は画像の中身 (種類と中身の SHA-256) なので、
 * 同じ中身の画像は、結果をまたいで 1 つの画素を分け合う。
 *
 * 上限 (maxBytes。画素の幅 × 高さ × 4 の合計) を超えたら、捨てる: 使っている結果 (dispose していない結果) の無くなった画像を先に、
 * 残りは使った順の古いものから (LRU)。描画のために引いている間の画像 (pin) は捨てない。捨てた画像は close() する (HTML §8.10 の close。
 * GC を待たずに画素のメモリを返す)。引いている間は捨てないので、描画が閉じた ImageBitmap を引くことはない (閉じた ImageBitmap は幅 0 で、描画されない)。
 * 1 枚のページの画像の合計が上限を超えるときは、描画の間だけ上限を超えて持ち、描画を終えたら上限まで捨てる。
 */
import { rejoin, thisCall } from './callContext';
import { sha256Js } from './sha256';

/** 既定の上限 (256MB。1,000 × 1,000 の画像で 64 枚ほど) */
export const IMAGE_CACHE_DEFAULT_BYTES = 256 * 1024 * 1024;

/**
 * 画像の中身の鍵 (種類と、中身の SHA-256。FIPS 180-4)。当たったときに中身を比べないので、別の中身が同じ鍵にならないように、
 * 暗号のハッシュにする (共有の Typesetter で、別の文書の画像と鍵が重なるように作った画像を混ぜても、別の画像を描画しない)。
 * WebCrypto (crypto.subtle.digest。ブラウザーと Node) で求め、使えないとき (安全でないコンテキストのブラウザーなど) は自前の計算 (sha256Js) にする。
 * 同じバイト列 (Uint8Array) は覚えて返す (呼ぶ側が中身を書き換えて使い回すと古い鍵が残るので、描画に渡すバイト列は書き換えない。docs/library.md)
 */
const keyMemo = new WeakMap<Uint8Array, Promise<string>>();
export function imageKey(b: Uint8Array, mime: string): Promise<string> {
  let k = keyMemo.get(b);
  if (k === undefined) {
    k = digestHex(b);
    keyMemo.set(b, k);
  }
  return k.then((h) => `${mime}|${h}`);
}

async function digestHex(b: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    try {
      const d = new Uint8Array(rejoin(thisCall(), await subtle.digest('SHA-256', b as BufferSource)));
      let s = '';
      for (const x of d) s += x.toString(16).padStart(2, '0');
      return s;
    } catch {
      // SharedArrayBuffer の上のバイト列などで WebCrypto が受け付けないときは、自前の計算にする
    }
  }
  return sha256Js(b);
}

/** 画像の持ち主 (組んだ結果ごとに 1 つ)。dispose した結果は release で外す */
export type ImageCacheOwner = object;

interface Entry {
  key: string;
  /** デコードした画像 (デコードの途中は undefined) */
  element?: CanvasImageSource;
  /** デコードの途中 (同じ画像を 2 度デコードしない) */
  pending?: Promise<CanvasImageSource | undefined>;
  /** 画素の大きさ (幅 × 高さ × 4) */
  bytes: number;
  /** この画像を使う結果 (dispose していないもの) */
  owners: Set<ImageCacheOwner>;
  /** 描画のために引いている数 (0 でない間は捨てない) */
  pins: number;
  /** 引いている間に clear (releaseCaches) を呼ばれた (引くのを終えたら捨てる) */
  cleared?: boolean;
}

/** 画像の中身をデコードする (ブラウザーの createImageBitmap。読めなければ投げる) */
async function decodeImage(bytes: Uint8Array, mime: string): Promise<CanvasImageSource> {
  return rejoin(thisCall(), await createImageBitmap(new Blob([bytes as BlobPart], { type: mime })));
}

/** 画像の画素の大きさ (幅 × 高さ × 4 バイト。大きさの分からないものは 0) */
function pixelBytes(el: CanvasImageSource): number {
  const e = el as { width?: unknown; height?: unknown };
  return typeof e.width === 'number' && typeof e.height === 'number' ? e.width * e.height * 4 : 0;
}

/** 描画のために引いた画像 (描画を終えたら done を呼ぶ) */
export interface ImageCacheLease {
  /** 中身 bytes (lease に渡したもの) の画像。デコードできなかった画像は undefined */
  get(bytes: Uint8Array): CanvasImageSource | undefined;
  /** 引くのを終える (捨てられるようになる。上限を超えていれば捨てる) */
  done(): void;
}

export class ImageCache {
  /** 使った順 (古いものが先。Map の並び) */
  private readonly entries = new Map<string, Entry>();
  private total = 0;
  /** デコードする関数 (試しで差し替える) */
  decode: (bytes: Uint8Array, mime: string) => Promise<CanvasImageSource> = decodeImage;

  constructor(public maxBytes = IMAGE_CACHE_DEFAULT_BYTES) {}

  /** 持っている画素の大きさの合計 (バイト。Typesetter.memoryUsage の caches の images) */
  memoryBytes(): number {
    return this.total;
  }

  /** 持っている画像の数 */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 画像 (中身 bytes・種類 mime) を、持ち主 owner が描画のために引く (無ければデコードして入れる)。images の全部をそろえてから返す。
   * 返したものの done を呼ぶまで、引いた画像は捨てない
   */
  async lease(owner: ImageCacheOwner, images: ReadonlyArray<{ bytes: Uint8Array; mime: string }>): Promise<ImageCacheLease> {
    // 鍵 (中身の SHA-256) を先にそろえる (非同期)
    const keys = rejoin(thisCall(), await Promise.all(images.map((im) => imageKey(im.bytes, im.mime))));
    const held: Entry[] = [];
    const byKey = new Map<string, Entry>();
    const byBytes = new Map<Uint8Array, Entry>();
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const key = keys[i];
      const had = byKey.get(key);
      if (had) {
        byBytes.set(im.bytes, had);
        continue;
      }
      let e = this.entries.get(key);
      if (e) {
        // 使った順の後ろへ
        this.entries.delete(key);
        this.entries.set(key, e);
        // clear の後に引き直したものは、また持つ
        e.cleared = false;
      } else {
        e = { key, bytes: 0, owners: new Set(), pins: 0 };
        this.entries.set(key, e);
        const entry = e;
        entry.pending = this.decode(im.bytes, im.mime).then(
          (el) => {
            entry.pending = undefined;
            // デコードの間に、手放した (clear) なら持たない
            if (this.entries.get(entry.key) !== entry) {
              (el as { close?: () => void }).close?.();
              return undefined;
            }
            entry.element = el;
            entry.bytes = pixelBytes(el);
            this.total += entry.bytes;
            return el;
          },
          () => {
            entry.pending = undefined;
            // デコードできなかった画像は覚えない (次の描画でデコードし直す。一時的な失敗で、ずっと描画しないままにしない)。
            // この lease の中では undefined (描画しない)
            if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
            return undefined;
          },
        );
      }
      e.owners.add(owner);
      e.pins++;
      held.push(e);
      byKey.set(key, e);
      byBytes.set(im.bytes, e);
    }
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      for (const e of held) {
        e.pins--;
        // 引いている間に clear を呼ばれた画像は、どれも引いていなければ捨てる
        if (e.pins === 0 && e.cleared && this.entries.get(e.key) === e) this.drop(e);
      }
      this.trim();
    };
    try {
      for (const e of held) if (e.pending) rejoin(thisCall(), await e.pending);
    } catch (err) {
      done();
      throw err;
    }
    return { get: (bytes) => byBytes.get(bytes)?.element, done };
  }

  /** 持ち主 owner (dispose した結果) を外す。その結果だけが使っていた画像は、捨てるときに先に捨てる (いまは捨てない) */
  release(owner: ImageCacheOwner): void {
    for (const e of this.entries.values()) e.owners.delete(owner);
    this.trim();
  }

  /** 上限まで捨てる: 使う結果の無い画像を古いものから、まだ超えていれば、残りを古いものから (引いている画像は捨てない) */
  trim(limit = this.maxBytes): void {
    if (this.total <= limit) return;
    for (const pass of [0, 1])
      for (const e of [...this.entries.values()]) {
        if (this.total <= limit) return;
        if (e.pins > 0 || e.pending || (pass === 0 && e.owners.size > 0)) continue;
        this.drop(e);
      }
  }

  /** 画像を全部捨てる (Typesetter.releaseCaches({ images: true }))。引いている画像は、引くのを終えたときに捨てる */
  clear(): void {
    for (const e of [...this.entries.values()]) {
      if (e.pins === 0) this.drop(e);
      else e.cleared = true;
    }
  }

  private drop(e: Entry): void {
    this.entries.delete(e.key);
    this.total -= e.bytes;
    (e.element as { close?: () => void } | undefined)?.close?.();
    e.element = undefined;
  }
}
