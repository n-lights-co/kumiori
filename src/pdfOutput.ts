/**
 * pdfOutput — PDF を流して書くときの書き出し先 (typesetToPdfStream・Typesetter.typesetToPdfStream・TypesetResult.toPdfStream)。
 *
 * 書き出し先は 2 つの形: WritableStream (WHATWG Streams §5) と、バイト列の塊を受ける関数。
 *  - WritableStream の扱いは、ReadableStream.prototype.pipeTo の既定 (WHATWG Streams §4.2.5。preventClose・preventAbort が false) に合わせる:
 *    書くたびに書き手の ready を待ち (背圧)、書き終えたら close、誤り・止める合図で終えたら abort(理由)。どちらでも、終えたら書き手のロックを放す。
 *  - 関数が Promise を返したら、次の塊を渡す前に待つ。値を返さなければ、待たずに次を渡す (Node の fs.writeSync など)。
 *  - 書き出し先が誤りになったら (WritableStream の write の失敗・関数が投げた・Promise が失敗した)、その誤りをそのまま投げ、書き出し先は abort しない。
 * 渡した塊は、渡した後に書き換えない (書き出し先が持っていてよい)。
 */
import { KumioriOptionError } from './errors';
import { msg } from './messages';
import { rejoin, thisCall } from './callContext';

/** PDF の書き出し先。WritableStream か、バイト列の塊を受ける関数 (Promise を返したら、次の塊を渡す前に待つ) */
export type PdfOutput = WritableStream<Uint8Array> | ((chunk: Uint8Array) => void | Promise<void>);

/** 書き出し先が誤りになったこと (その誤りは cause。投げるときは、包まずに cause を投げる) */
interface Failed {
  cause: unknown;
}

const isWritableStream = (o: unknown): o is WritableStream<Uint8Array> => typeof o === 'object' && o !== null && typeof (o as WritableStream).getWriter === 'function';

/** 書き出し先 (PdfOutput) を確かめる。形が違えば選択肢の誤り (KumioriOptionError。option は path) */
export function checkPdfOutput(o: unknown, path = 'output'): asserts o is PdfOutput {
  if (typeof o === 'function' || isWritableStream(o)) {
    if (isWritableStream(o) && o.locked) throw new KumioriOptionError(msg(`${path} の WritableStream は、ほかの書き手がロックしています`, `the WritableStream in ${path} is locked by another writer`), path);
    return;
  }
  throw new KumioriOptionError(msg(`${path} は WritableStream か、バイト列の塊を受ける関数にしてください (Node の Writable は Writable.toWeb で WritableStream にして渡します)`, `${path} must be a WritableStream or a function that takes chunks of bytes (pass a Node Writable as Writable.toWeb(writable))`), path);
}

/**
 * 書き出し先への口: 塊を順に渡し (前の塊を待ってから次を渡す)、書いたバイト数を数える。
 * write は、書き出し先が待たせないとき (値を返さない関数) は、その場で渡し終える。待たせるときは、渡す順に並べて、後で渡す (idle で待てる)
 */
export class PdfOutputPort {
  /** 書き出し先に渡したバイト数 (渡し終えた分) */
  bytes = 0;
  private readonly fn: (chunk: Uint8Array) => void | Promise<void>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  /** まだ渡し終えていない塊の終わり (渡す順に繋ぐ) */
  private inflight?: Promise<void>;
  private failed?: Failed;
  private done = false;

  constructor(output: PdfOutput) {
    checkPdfOutput(output);
    if (typeof output === 'function') this.fn = output;
    else {
      const w = (this.writer = output.getWriter());
      this.fn = async (c) => {
        rejoin(thisCall(), await w.ready);
        rejoin(thisCall(), await w.write(c));
      };
    }
  }

  /** 書き出し先が誤りになっていたら、その誤りを投げる */
  check(): void {
    if (this.failed) throw this.failed.cause;
  }

  /** 塊を渡す (渡した後に書き換えない)。前の塊を待っているときは、その後に並べる */
  write(chunk: Uint8Array): void {
    this.check();
    if (this.done) throw new Error('Kumiori: PdfOutputPort.write after close');
    if (!chunk.length) return;
    if (this.inflight) {
      this.inflight = this.inflight.then(() => (this.failed ? undefined : this.call(chunk)));
      this.track();
      return;
    }
    const r = this.call(chunk);
    if (r) {
      this.inflight = r;
      this.track();
    }
  }

  /** 1 つの塊を書き出し先に渡す (待たせるなら Promise) */
  private call(chunk: Uint8Array): Promise<void> | undefined {
    let r: void | Promise<void>;
    try {
      r = this.fn(chunk);
    } catch (e) {
      this.failed ??= { cause: e };
      throw e;
    }
    if (r && typeof (r as Promise<void>).then === 'function') return Promise.resolve(r).then(() => void (this.bytes += chunk.length));
    this.bytes += chunk.length;
    return undefined;
  }

  /** 並べた塊の終わりを見張る (誤りは覚えて、次の write・idle で投げる。Promise の誤りを、見ないまま残さない) */
  private track(): void {
    const mine: Promise<void> = (this.inflight = this.inflight!.then(
      () => {
        if (this.inflight === mine) this.inflight = undefined;
      },
      (e: unknown) => {
        this.failed ??= { cause: e };
        if (this.inflight === mine) this.inflight = undefined;
      },
    ));
  }

  /** 並べた塊を渡し終えるまで待つ (待つものが無ければ undefined)。書き出し先の誤りは投げる */
  idle(): Promise<void> | undefined {
    this.check();
    const p = this.inflight;
    if (!p) return undefined;
    return p.then(() => this.check());
  }

  /** 書き終えた: 並べた塊を渡し終え、WritableStream なら close して書き手のロックを放す */
  async close(): Promise<void> {
    rejoin(thisCall(), await this.idle());
    this.done = true;
    const w = this.writer;
    if (!w) return;
    try {
      rejoin(thisCall(), await w.close());
    } catch (e) {
      this.failed ??= { cause: e };
      throw e;
    } finally {
      w.releaseLock();
    }
  }

  /**
   * 誤り・止める合図で終えた: WritableStream なら abort(理由) して書き手のロックを放す。関数の書き出し先には何もしない。
   * 書き出し先の誤りで終えたときは、abort しない (ロックは放す)
   */
  async abort(reason: unknown): Promise<void> {
    if (this.done) return;
    this.done = true;
    const w = this.writer;
    if (!w) return;
    try {
      if (!this.failed) rejoin(thisCall(), await w.abort(reason));
    } catch {
      // abort の誤りは、元の誤りを隠さないように捨てる
    } finally {
      w.releaseLock();
    }
  }
}
