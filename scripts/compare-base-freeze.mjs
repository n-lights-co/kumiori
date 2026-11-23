/**
 * compare-base-freeze — 組むたびに変わる値 (時計と乱数) を止める、Node の前読みのモジュール (node --import <このファイル> …)。
 * scripts/compare-base.mjs が、前と後のコミットの Kumiori のコマンドを、どちらも同じ値で動かすために使う。
 * いまの Kumiori は、PDF の日時を SOURCE_DATE_EPOCH で決め、文書の識別子を中身から作るので、止めなくても同じバイトの PDF になる。
 * それより前の版 (日時を組んだ時刻で書き、識別子を乱数で作る版) を前のコミットとして組み比べるために、その版を組むときだけ止める
 * (compare-base.mjs の needsFreeze。src/pdfStandard.ts に finishDocumentId の無い版)。
 *
 * 止めるもの:
 *  - 時計: 引数の無い new Date() と Date.now() を、SOURCE_DATE_EPOCH (秒。無ければ 2000-01-01T00:00:00Z) にする。
 *    PDF の作成日時・更新日時 (情報の辞書と XMP)・埋め込みファイルの更新日時が、この値になる。
 *    引数のある new Date(…)・Date.parse・Date.UTC は、そのまま (日付の書き方を読む処理を変えない)
 *  - 乱数: crypto.getRandomValues・crypto.randomUUID・Math.random を、決まった種から作る値にする (プロセスごとに同じ種から始める)。
 *    PDF の文書の識別子 (trailer の /ID・XMP の DocumentID・InstanceID) と、pdf-lib の付ける名前の後ろの字が、毎回同じになる
 *
 * 同じコードで同じ入力を組めば、同じバイトの PDF になる (はず) なので、比べる道具は、バイト列が同じ PDF を「変わっていない」として、絵と字の比べを省ける。
 * 時計の止まった Date.now() は、時間を測る処理 (組版の秒) を 0 にし、Date.now() の値で決める時間の上限 (EPS の epsMs・資源の取得の締め切りなど) を効かなくする。
 * そうした文書は手数などの別の上限で止まるので、終わりはするが、時間の上限に当たるときとは結果や知らせが違うことがある。
 * 止めの要らない版 (いまの版) は、止めずに組むので、時間の上限が効く。
 * setTimeout で数える待ちは、止めても終わる
 */
const epochSec = Number(process.env.SOURCE_DATE_EPOCH ?? 946684800);
const FIXED = Number.isFinite(epochSec) ? epochSec * 1000 : 946684800000;

const RealDate = globalThis.Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED);
    else super(...args);
  }
  static now() {
    return FIXED;
  }
}
// new を付けずに呼んだ Date() は、いまの日時の文字列を返す
globalThis.Date = new Proxy(FrozenDate, {
  apply: () => new RealDate(FIXED).toString(),
});

/** 決まった種の乱数 (xorshift32。種は 1 つ。暗号には使えないが、比べるためには足りる) */
let state = 0x9e3779b9;
const next32 = () => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state;
};
Math.random = () => next32() / 0x100000000;
const webCrypto = globalThis.crypto;
if (webCrypto) {
  const fill = (arr) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = next32() & 0xff;
    return arr;
  };
  Object.defineProperty(webCrypto, 'getRandomValues', { value: fill, configurable: true, writable: true });
  Object.defineProperty(webCrypto, 'randomUUID', {
    value: () => {
      const b = fill(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    configurable: true,
    writable: true,
  });
}
