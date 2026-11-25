/**
 * 描画のためにデコードした画像のキャッシュ (imageCache.ts。design/pdf-writer.md の 13) の確認:
 * 同じ中身の画像を分け合う・上限で捨てる順 (使う結果の無い画像が先、残りは古いものから)・引いている間は捨てない・
 * dispose した結果と分け合う画像を、生きている結果が描画しても、閉じた画像を引かない
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ImageCache, imageKey } from '../src/imageCache';

/** 偽の ImageBitmap (幅・高さと、閉じたか) */
class FakeBitmap {
  closed = false;
  constructor(
    public width: number,
    public height: number,
  ) {}
  close() {
    this.closed = true;
    this.width = 0;
    this.height = 0;
  }
}
/** 中身の 1 バイト目を 1 辺の画素の数にする偽のデコード (デコードした数も数える) */
function cache(maxBytes: number) {
  const c = new ImageCache(maxBytes);
  const decoded: number[] = [];
  c.decode = async (bytes) => {
    decoded.push(bytes[0]);
    return new FakeBitmap(bytes[0], bytes[0]) as unknown as CanvasImageSource;
  };
  return { c, decoded };
}
const img = (side: number, tag = 0) => ({ bytes: new Uint8Array([side, tag]), mime: 'image/png' });

describe('描画のための画像のキャッシュ', () => {
  it('同じ中身の画像は、別のバイト列・別の結果でも 1 つの画像を分け合う', async () => {
    const { c, decoded } = cache(1 << 20);
    const a = {};
    const b = {};
    const x = img(10);
    const y = img(10);
    const l1 = await c.lease(a, [x]);
    const l2 = await c.lease(b, [y]);
    expect(l1.get(x.bytes)).toBe(l2.get(y.bytes));
    expect(decoded).toEqual([10]);
    expect(c.memoryBytes()).toBe(10 * 10 * 4);
    l1.done();
    l2.done();
    expect(await imageKey(x.bytes, 'image/png')).toBe(await imageKey(y.bytes, 'image/png'));
    expect(await imageKey(x.bytes, 'image/png')).not.toBe(await imageKey(x.bytes, 'image/jpeg'));
  });

  it('鍵は中身の SHA-256 で、中身が違えば (長さが同じでも) 別の画像にする', async () => {
    const x = new Uint8Array(1000).map((_, i) => i * 7);
    expect(await imageKey(x, 'image/png')).toBe(`image/png|${createHash('sha256').update(x).digest('hex')}`);
    // WebCrypto の無い所 (安全でないコンテキストのブラウザーなど) でも、同じ鍵になる
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const z = new Uint8Array(x);
      expect(await imageKey(z, 'image/png')).toBe(await imageKey(x, 'image/png'));
    } finally {
      if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
    // 1 バイトだけ違う画像は、別にデコードして、別の画像を描画する
    const { c, decoded } = cache(1 << 20);
    const p = { bytes: new Uint8Array([10, 1, 2, 3]), mime: 'image/png' };
    const q = { bytes: new Uint8Array([10, 1, 2, 4]), mime: 'image/png' };
    const l = await c.lease({}, [p, q]);
    expect(l.get(p.bytes)).not.toBe(l.get(q.bytes));
    expect(decoded).toEqual([10, 10]);
    l.done();
  });

  it('上限を超えたら、使う結果の無くなった画像を先に捨て、残りは使った順の古いものから捨てる', async () => {
    // 1 枚 400 バイト (10 × 10 × 4)。上限 1,200 バイトで 3 枚まで
    const { c } = cache(1200);
    const live = {};
    const gone = {};
    const p = img(10, 1);
    const q = img(10, 2);
    const r = img(10, 3);
    (await c.lease(live, [p])).done();
    (await c.lease(gone, [q])).done();
    (await c.lease(live, [r])).done();
    c.release(gone);
    const lp = await c.lease(live, [p, r]);
    const pEl = lp.get(p.bytes) as unknown as FakeBitmap;
    lp.done();
    // 4 枚目: 使う結果の無い q を先に捨てる (いちばん古い p は残る)
    (await c.lease(live, [img(10, 4)])).done();
    expect(c.size).toBe(3);
    expect(pEl.closed).toBe(false);
    // 5 枚目: 使う結果の無い画像が無いので、使った順の古いもの (p。r は後で引いた) を捨てる
    const s = await c.lease(live, [img(10, 5)]);
    s.done();
    expect(pEl.closed).toBe(true);
    expect(c.memoryBytes()).toBe(1200);
  });

  it('引いている間の画像は、上限を超えても releaseCaches でも捨てない (閉じた画像を引かない)。終えたら上限まで捨てる', async () => {
    const { c } = cache(400);
    const owner = {};
    const a = img(10, 1);
    const b = img(10, 2);
    const big = await c.lease(owner, [a, b]);
    expect(c.memoryBytes()).toBe(800);
    c.clear();
    c.trim();
    for (const x of [a, b]) expect((big.get(x.bytes) as unknown as FakeBitmap).closed).toBe(false);
    big.done();
    expect(c.memoryBytes()).toBeLessThanOrEqual(400);
    c.clear();
    expect(c.memoryBytes()).toBe(0);
    expect(c.size).toBe(0);
  });

  it('デコードを待っている間 (renderPage を await している間) に releaseCaches を呼んでも、引いた画像を捨てずに渡す (閉じた画像を引かない)', async () => {
    const c = new ImageCache(1 << 20);
    const waiting: Array<() => void> = [];
    c.decode = (bytes) => new Promise((ok) => waiting.push(() => ok(new FakeBitmap(bytes[0], bytes[0]) as unknown as CanvasImageSource)));
    const a = img(10, 1);
    const b = img(10, 2);
    // 1 枚は先にデコードしてキャッシュに入れておく (描画の途中に、キャッシュにある画像を引く形も確かめる)
    // 鍵 (中身の SHA-256) を非同期に求めてからデコードを始めるので、デコードが始まるまで待つ
    const started = async () => {
      while (waiting.length === 0) await new Promise((ok) => setTimeout(ok, 0));
    };
    const first = c.lease({}, [a]);
    await started();
    waiting.shift()!();
    (await first).done();
    const pending = c.lease({}, [a, b]);
    await started();
    // デコードの途中に手放す (Typesetter.releaseCaches は、引数なしでも { images: true } でも clear を呼ぶ)
    c.clear();
    c.clear();
    waiting.shift()!();
    const l = await pending;
    for (const x of [a, b]) {
      const el = l.get(x.bytes) as unknown as FakeBitmap;
      expect(el).toBeDefined();
      expect(el.closed).toBe(false);
      expect(el.width).toBe(10);
    }
    expect(c.size).toBe(2);
    // 描画を終えたら、引いている間に手放すように言われた画像を捨てる (上限に余裕があっても)
    l.done();
    expect(c.size).toBe(0);
    expect(c.memoryBytes()).toBe(0);
    // 手放した後に引き直した画像は、また持つ
    const again = c.lease({}, [a]);
    await started();
    waiting.shift()!();
    const l2 = await again;
    c.clear();
    // キャッシュにある画像を引き直す (デコードしない)
    const l3 = await c.lease({}, [a]);
    l2.done();
    l3.done();
    expect(c.size).toBe(1);
  });

  it('dispose した結果と同じ画像を分け合う生きている結果は、画像を捨てた後も、デコードし直して描画する (閉じた画像を引かない)', async () => {
    const { c, decoded } = cache(1 << 20);
    const disposedResult = {};
    const liveResult = {};
    const shared = img(8);
    const first = await c.lease(disposedResult, [shared]);
    const firstEl = first.get(shared.bytes) as unknown as FakeBitmap;
    first.done();
    // 生きている結果も同じ画像を引く
    const other = img(8);
    const second = await c.lease(liveResult, [other]);
    expect(second.get(other.bytes)).toBe(firstEl);
    second.done();
    // dispose した結果を外し、画像のキャッシュを手放す (Typesetter.releaseCaches({ images: true }))
    c.release(disposedResult);
    // dispose だけでは、生きている結果と分け合う画像を閉じない
    expect(firstEl.closed).toBe(false);
    c.clear();
    expect(firstEl.closed).toBe(true);
    // 生きている結果の次の描画: デコードし直した、閉じていない画像を引く
    const again = await c.lease(liveResult, [shared]);
    const el = again.get(shared.bytes) as unknown as FakeBitmap;
    expect(el.closed).toBe(false);
    expect(el.width).toBe(8);
    expect(decoded).toEqual([8, 8]);
    again.done();
  });

  it('デコードできない画像は undefined (ほかの画像は描画できる)', async () => {
    const c = new ImageCache();
    c.decode = async (b) => {
      if (b[0] === 0) throw new Error('broken');
      return new FakeBitmap(b[0], 1) as unknown as CanvasImageSource;
    };
    const bad = img(0);
    const good = img(3);
    const l = await c.lease({}, [bad, good]);
    expect(l.get(bad.bytes)).toBeUndefined();
    expect(l.get(good.bytes)).toBeDefined();
    l.done();
  });

  it('デコードに失敗した画像は覚えず、次に引くときにデコードし直す (一時的な失敗で、描画しないままにしない)', async () => {
    const c = new ImageCache();
    let fail = true;
    let calls = 0;
    c.decode = async (b) => {
      calls++;
      if (fail) throw new Error('out of memory');
      return new FakeBitmap(b[0], 1) as unknown as CanvasImageSource;
    };
    const x = img(4);
    const l = await c.lease({}, [x]);
    expect(l.get(x.bytes)).toBeUndefined();
    l.done();
    expect(c.size).toBe(0);
    fail = false;
    const l2 = await c.lease({}, [x]);
    expect(l2.get(x.bytes)).toBeDefined();
    expect(calls).toBe(2);
    l2.done();
  });
});
