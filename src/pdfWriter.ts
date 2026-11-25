/**
 * pdfWriter — PDF の書き出しの層 (オブジェクトを番号の順に並べ、相互参照を書く所)。
 *
 * pdf-lib の PDFDocument.save (1.17.1) と同じ前の手順を踏み、同じ書き方 (PDFStreamWriter・PDFWriter の写し) で書くので、
 * 同じ文書からは save と 1 バイトも違わない PDF になる (test/pdfWriter.test.ts が save の結果とバイトで比べる)。
 * 書き方は pdf-lib (MIT。ライセンスの本文は THIRD_PARTY_NOTICES.md の 1 節、派生元の説明は 3.5 節) の書き手を写したもの。
 * 派生元の著作権の表示: pdf-lib — Copyright (c) 2019 Andrew Dillon (MIT License)
 * オブジェクトの中身のバイト列は、いままでどおりオブジェクト自身 (pdf-lib の sizeInBytes・copyBytesInto) が作る。
 * save と違うのは次のこと (どれもバイト列には関わらない):
 *  - 見出しの版を選べる (version)。前は 1.7 で書いてから、先頭の 8 バイトを同じ長さの版で書き換えていた
 *  - 圧縮する流れ (PDFFlateStream) を、渡した関数で圧縮する (deflate)。前は pdfLibPatches.ts の useDeflate で差し替えていた
 *  - 50 個ごとに間をあける所 (pdf-lib の waitForTick。setTimeout(0)) を、Kumiori の止める合図の間 (callContext.ts の pause) にする
 *  - 書き終えた流れを、保存の前に先に書いて文書から除ける (PdfWriter の release・releaseAll。PDF をページごとに流して書くための口)
 *  - 書き出し先 (PdfOutputPort) を渡せば、先に書いたバイト列を 64KB ずつ書き出し先へ流し、finish で残りを流す (PDF の全体を 1 つの配列に持たない)。
 *    文書の ID (pdfStandard.ts の DocumentIdStream) も、流した塊を順に足して、最後の塊の印の値を書き換える
 *
 * 書き方 (ISO 32000-1 §7.5):
 *  - オブジェクトの流れで書く (objectStreams。既定): 見出し (§7.5.2。2 進の印の行を含む) → 流れと、まとめないもの (暗号化の辞書・
 *    PDFInvalidObject・世代が 0 でないもの) を番号の順に (§7.5.3) → 流れでないものを、番号の順に 50 個ずつオブジェクトの流れ (§7.5.7) に
 *    まとめたもの (番号は largestObjectNumber + 1 から) → 相互参照の流れ (§7.5.8。その次の番号) → startxref と %%EOF (§7.5.5)
 *  - 相互参照の表で書く: 見出し → 全部を番号の順に → 相互参照の表 (§7.5.4) → trailer の辞書 (§7.5.5) → startxref と %%EOF
 *
 * 暗号化 (PdfWriteOptions.encryption。pdfEncrypt.ts) するときは、書くオブジェクトの文字列とストリームを、書く所で (同期で) 暗号化する。
 * 暗号化の辞書・相互参照のストリームは暗号化しない。オブジェクトストリームにまとめるオブジェクトの文字列は個別に暗号化せず、オブジェクトストリームの全体を
 * 暗号化する (ISO 32000-2 §7.6.2・§7.5.7)。読めなかったオブジェクト (PDFInvalidObject) は中身を読めないので、そのまま書く
 */
import { PDFCrossRefSection, PDFCrossRefStream, PDFDocument, PDFFlateStream, PDFHeader, PDFInvalidObject, PDFName, PDFNumber, PDFObjectStream, PDFRef, PDFStream, PDFTrailer, PDFTrailerDict, Cache } from 'pdf-lib';
import type { PDFContext, PDFDict, PDFObject } from 'pdf-lib';
import { KumioriError } from './errors';
import { msg } from './messages';
import { pacing, pause, rejoin, thisCall } from './callContext';
import type { PdfOutputPort } from './pdfOutput';
import type { DocumentIdStream } from './pdfStandard';
import type { PdfEncryption } from './pdfEncrypt';

export interface PdfWriteOptions {
  /** オブジェクトの流れ (ISO 32000-1 §7.5.7) と相互参照の流れ (§7.5.8) で書く (既定 true)。false なら相互参照の表 (§7.5.4) と trailer (§7.5.5) */
  objectStreams?: boolean;
  /** 見出しの版 ('1.x'。既定 '1.7')。PDF/X-1a は '1.3'、X-3 は '1.4'、X-4 は '1.6' */
  version?: string;
  /**
   * 圧縮する流れ (PDFFlateStream。ページの中身・書体のファイルなど) を、この関数で圧縮する。書体と画像を埋め込んだ (flush の) 後で、
   * ページを足す・フォームの欄の見た目を作り直す前に当てる (前の useDeflate と同じ所)。オブジェクトの流れと相互参照の流れには当てない (pdf-lib の pako のまま)
   */
  deflate?: (data: Uint8Array) => Uint8Array;
  /** ページが無ければ 1 枚足す (pdf-lib の save と同じ。既定 true) */
  addDefaultPage?: boolean;
  /**
   * 暗号化 (pdfEncrypt.ts の PdfEncryption)。暗号化の辞書は、finish の前の手順 (フォントを埋め込む flush) の後で文書に足す
   * (ほかのオブジェクトの番号を、暗号化しないときと同じにする。流して書くときも、辞書は流れでないので先に書かず、最後に書く)
   */
  encryption?: PdfEncryption;
}

/** 流して書くとき (PdfWriter の 3 つ目の引数) */
export interface PdfStreamTarget {
  /** 書き出し先 */
  output: PdfOutputPort;
  /** 文書の ID の印の値を書き換えるもの (流した塊を順に足し、最後の塊の印を書き換える) */
  documentId?: DocumentIdStream;
}

/** 流して書くときに、ためてから書き出し先へ渡す大きさ (design/pdf-writer.md の 3.1) */
const CHUNK_BYTES = 1 << 16;

/** 番号と中身 (pdf-lib の enumerateIndirectObjects の並びの 1 つ) */
type Indirect = [PDFRef, PDFObject];
/** 先に書いた流れ (番号と、ファイルの中の位置) */
interface Written {
  ref: PDFRef;
  offset: number;
}

/** pdf-lib の中の欄が見つからないときの誤り */
const internalsChanged = (what: string) => new KumioriError('internal/patch-mismatch', msg(`pdf-lib の ${what} が見つかりません (pdf-lib のバージョンが変わり、pdfWriter.ts のライターが合いません)`, `pdf-lib ${what} not found (the pdf-lib version has changed and the writer in pdfWriter.ts no longer fits)`));

/** pdf-lib の書き手の、間をあける数 (save の objectsPerTick の既定) と、1 つのオブジェクトの流れにまとめる数 (PDFStreamWriter の objectsPerStream の既定) */
const OBJECTS_PER_TICK = 50;
const OBJECTS_PER_STREAM = 50;

/** ASCII の字を書く (pdf-lib の copyStringIntoBuffer と同じ) */
function putAscii(s: string, buf: Uint8Array, at: number): number {
  for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  return s.length;
}

/** 1 つのオブジェクトを書いたときの大きさ ('n g obj\n' + 中身 + '\nendobj\n\n'。pdf-lib の PDFWriter.computeIndirectObjectSize) */
function indirectSize([ref, obj]: Indirect): number {
  return ref.sizeInBytes() + 3 + obj.sizeInBytes() + 9;
}

/** 1 つのオブジェクトを書く (pdf-lib の PDFWriter.serializeToBuffer の中の形)。書いたバイト数を返す */
function putIndirect([ref, obj]: Indirect, buf: Uint8Array, at: number): number {
  const start = at;
  at += putAscii(`${ref.objectNumber} ${ref.generationNumber} obj\n`, buf, at);
  at += obj.copyBytesInto(buf, at);
  at += putAscii('\nendobj\n\n', buf, at);
  return at - start;
}

/** 見出しの版 ('1.7' など) を、pdf-lib の見出しにする */
function headerOf(version = '1.7'): PDFHeader {
  const m = /^(\d)\.(\d)$/.exec(version);
  if (!m) throw new Error(`Kumiori: bad PDF version ${version}`);
  return PDFHeader.forVersion(Number(m[1]), Number(m[2]));
}

/** 圧縮する流れ (PDFFlateStream の encode) を、deflate で圧縮するようにする (前の pdfLibPatches.ts の useDeflate と同じ差し替え) */
function deflateWith(obj: PDFObject, deflate: (data: Uint8Array) => Uint8Array): void {
  if (!(obj instanceof PDFFlateStream)) return;
  const s = obj as unknown as { encode?: unknown; contentsCache?: unknown; getUnencodedContents(): Uint8Array };
  if (typeof s.encode !== 'boolean' || !(s.contentsCache instanceof Cache)) throw internalsChanged('PDFFlateStream.encode・contentsCache');
  if (s.encode) s.contentsCache = Cache.populatedBy(() => deflate(s.getUnencodedContents()));
}

/** 保存の前の手順で作り直すフォームの欄 (pdf-lib の save が、getForm で作ったフォームがあれば updateFieldAppearances を呼ぶのと同じ) */
function formOf(pdf: PDFDocument): { updateFieldAppearances(): void } | undefined {
  const cache = (pdf as unknown as { formCache?: unknown }).formCache;
  if (!(cache instanceof Cache)) throw internalsChanged('PDFDocument.formCache');
  return cache.getValue() as { updateFieldAppearances(): void } | undefined;
}

/** 書き手の 1 回分の時間の区切り (pdf-lib の shouldWaitForTick と同じ数え方で、50 個ごとに pause を呼ぶ) */
class Ticks {
  private n = 0;
  constructor(private readonly ctx = thisCall()) {}
  /** n 個書いた。区切りに当たれば間をあける (止める合図も確かめる) */
  async step(n: number): Promise<void> {
    this.n += n;
    if (this.n % OBJECTS_PER_TICK !== 0 || !pacing(this.ctx)) return;
    rejoin(thisCall(), await pause(this.ctx));
  }
}

/**
 * PDF の書き手。finish で、PDFDocument.save と同じ PDF を書く。
 * release で、書き終えた流れ (中身も辞書も、もう変わらないもの) を、保存の前に先に書いて、文書から除ける (書いたバイト列は written に残る)。
 * 先に書くのは、番号の小さいほうから、切れ目無く続く所まで: それより小さい番号に、まだ書いてよいと知らされていない流れか、
 * まだ中身の無い番号 (nextRef で取って、後で入れるもの) があれば、そこで待たせる。流れでないオブジェクトは、オブジェクトの流れでまとめて最後に書くので
 * 待たせない (相互参照の表で書くときは、全部を番号の順に書くので待たせる)。こうすると、保存のときに番号の順に書くのと同じ並びになり、
 * 先に書いた文書も save と同じバイト列になる (流れでないと見て進めた番号に、後で流れが入ったときだけ、その流れが後ろに回る)
 */
export class PdfWriter {
  private readonly context: PDFContext;
  private readonly header: PDFHeader;
  private readonly objectStreams: boolean;
  /** 先に書いたバイト列 (見出しを含む) */
  private readonly chunks: Uint8Array[] = [];
  /** 先に書いたバイト数 */
  private offset = 0;
  /** 先に書いた流れ (番号ごと) */
  private readonly written = new Map<number, Written>();
  /** 書いてよいと知らされた流れの番号 (まだ書いていないもの) */
  private readonly released = new Set<number>();
  /** 最後に書くと決めた番号 (先に書く数え方で、待たずに飛ばす。defer・releaseAll) */
  private readonly deferred = new Set<number>();
  /** 書き出し先へまだ渡していない、先に書いたバイト列 (流して書くとき) */
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  /** releaseAll がなめ終えたいちばん大きい番号 */
  private scanned = 0;
  /** 見出しを書いたか (最初の流れを先に書くときに、その前に書く) */
  private headerDone = false;
  /** 書いたオブジェクトの、ファイルの中の範囲 [初め, 終わり) (番号ごと。文書の ID の印を探す所を、Kumiori が書いた XMP の流れに絞るため) */
  private readonly ranges = new Map<number, [number, number]>();
  /** 次に見る番号 (これより小さい番号は、書いたか、最後に書くと決めたもの) */
  private cursor = 1;
  private finished = false;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly opts: PdfWriteOptions = {},
    /** 流して書くときの書き出し先 (無ければ、finish が PDF の全体を返す) */
    private readonly stream?: PdfStreamTarget,
  ) {
    this.context = pdf.context;
    this.header = headerOf(opts.version);
    this.objectStreams = opts.objectStreams ?? true;
  }

  /** 先に書いたバイト列 (見出しから、先に書いた流れの終わりまで。流して書くときは、書き出し先へまだ渡していない分) */
  get early(): readonly Uint8Array[] {
    return this.stream ? this.pending : this.chunks;
  }

  /** 書いたオブジェクト (番号 n) の、ファイルの中の範囲 [初め, 終わり)。まだ書いていなければ undefined */
  rangeOf(n: number): readonly [number, number] | undefined {
    return this.ranges.get(n);
  }

  /**
   * XMP の流れ (catalog の Metadata) の、ファイルの中の範囲。XMP が無ければ null。文書の ID の印を探す所 (pdfStandard.ts の DocumentIdPlaces)。
   * 流して書くとき、XMP の流れは最後に作るので、最後の塊に入る (先に書いていたら、印を書き換えられないので誤り)
   */
  xmpRange(): readonly [number, number] | null {
    const ref = this.pdf.catalog.get(PDFName.of('Metadata'));
    if (!(ref instanceof PDFRef)) return null;
    const r = this.ranges.get(ref.objectNumber);
    if (!r) throw new Error('Kumiori: the XMP stream was not written');
    if (this.written.has(ref.objectNumber)) throw new Error('Kumiori: the XMP stream was written before the last part of the PDF');
    return r;
  }

  /** 先に書いたバイト数 (見出しを含む) */
  get earlyBytes(): number {
    return this.offset;
  }

  /**
   * 番号 ref を、最後に書くと決める (先に書く数え方で、ここで待たない)。まだ中身の無い番号 (書体の辞書など、後で流れでないものが入る番号) や、
   * 後で辞書を書き足す流れ (タグ付き PDF の、中に印を持つ Form XObject の StructParents) に使う。
   * 最後に書くと決めた番号に後で流れが入ったら、その流れは、先に書いた流れの後ろに回る (save と並びが違う。オブジェクトは同じ)
   */
  defer(ref: PDFRef): void {
    if (this.finished) throw new Error('Kumiori: PdfWriter.defer after finish');
    if (this.written.has(ref.objectNumber)) throw new Error(`Kumiori: PdfWriter.defer of ${ref.tag}, which is already written`);
    this.released.delete(ref.objectNumber);
    this.deferred.add(ref.objectNumber);
    this.advance();
  }

  /**
   * いまある流れを全部、書いてよいと知らせる (hold の番号の流れは、最後に書く)。まだ中身の無い番号は、最後に書くと決める (defer)。
   * ページを描き終えた所で呼ぶ (描いたページの中身の流れ・Form XObject・画像は、もう変わらない)。いま書けるものを、番号の順に書いて除く
   */
  releaseAll(hold: ReadonlySet<number> = new Set()): void {
    if (this.finished) throw new Error('Kumiori: PdfWriter.releaseAll after finish');
    const ctx = this.context;
    // 前になめた所の続きから (前になめた番号は、知らせたか、最後に書くと決めたか、流れでないもの。先に書く所が止まっている間も、なめ直さない)
    for (let n = Math.max(this.cursor, this.scanned + 1); n <= ctx.largestObjectNumber; n++) {
      this.scanned = n;
      if (this.deferred.has(n) || this.released.has(n)) continue;
      const obj = ctx.lookup(PDFRef.of(n));
      if (obj === undefined || (obj instanceof PDFStream && hold.has(n))) this.deferred.add(n);
      else if (obj instanceof PDFStream) this.released.add(n);
    }
    this.advance();
  }

  /**
   * たまった先のバイト列を、書き出し先へ渡す (ページの終わりに呼ぶ)。書き出し先が待たせるなら、渡し終えるまでの Promise
   * (待たせないなら undefined)。書き出し先の誤りは投げる
   */
  drain(): Promise<void> | undefined {
    if (!this.stream) return undefined;
    this.emit();
    return this.stream.output.idle();
  }

  /** たまった先のバイト列を、1 つの塊にして書き出し先へ渡す */
  private emit(): void {
    if (!this.pending.length) return;
    const parts = this.pending;
    let chunk: Uint8Array;
    if (parts.length === 1) chunk = parts[0];
    else {
      chunk = new Uint8Array(this.pendingBytes);
      let at = 0;
      for (const b of parts) {
        chunk.set(b, at);
        at += b.length;
      }
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.stream!.output.write(chunk);
  }

  /**
   * 書き終えた流れ ref を、書いてよいと知らせる。番号の小さいほうから切れ目無く続く所までを、いま書いて、文書から除く
   * (除いた後で引くと、lookup が undefined を返す)。流れでないもの・もう書いたものは誤り
   */
  release(ref: PDFRef): void {
    if (this.finished) throw new Error('Kumiori: PdfWriter.release after finish');
    if (this.written.has(ref.objectNumber)) throw new Error(`Kumiori: PdfWriter.release of ${ref.tag} twice`);
    if (!(this.context.lookup(ref) instanceof PDFStream) || ref.generationNumber !== 0) throw new Error(`Kumiori: PdfWriter.release of ${ref.tag}, which is not a stream`);
    this.released.add(ref.objectNumber);
    this.advance();
  }

  /** 番号の順の切れ目まで、書いてよい流れを書く */
  private advance(): void {
    const ctx = this.context;
    const encrypt = ctx.trailerInfo.Encrypt;
    for (; this.cursor <= ctx.largestObjectNumber; this.cursor++) {
      // 最後に書くと決めた番号は飛ばす
      if (this.deferred.has(this.cursor)) continue;
      const ref = PDFRef.of(this.cursor);
      const obj = ctx.lookup(ref);
      // まだ中身の無い番号 (後で流れが入りうる)
      if (obj === undefined) return;
      const stream = obj instanceof PDFStream;
      if (!stream) {
        // 流れでないものは、オブジェクトの流れで最後に書く。相互参照の表で書くときと、暗号化の辞書は、番号の順に書くので待つ
        if (this.objectStreams && ref !== encrypt && !(obj instanceof PDFInvalidObject)) continue;
        // 読めなかったオブジェクト (PDFInvalidObject。PDF の画像の写しに入りうる) は、save でも流れと同じに番号の順に、そのまま書く。
        // 中身は変わらないので、知らせを待たずに、いま書く (待つと、後ろの流れが全部、最後まで先に書かれない)
        if (this.objectStreams && obj instanceof PDFInvalidObject) {
          this.writeEarly([ref, obj]);
          continue;
        }
        return;
      }
      if (!this.released.has(this.cursor)) return;
      this.writeEarly([ref, obj]);
    }
  }

  /** 流れを 1 つ、いま書いて、文書から除く */
  private writeEarly(o: Indirect): void {
    if (!this.headerDone) {
      this.headerDone = true;
      this.push(this.headerBytes());
    }
    if (this.opts.deflate) deflateWith(o[1], this.opts.deflate);
    const sealed = this.seal(o);
    const buf = new Uint8Array(indirectSize(sealed));
    const n = putIndirect(sealed, buf, 0);
    // 数えた大きさと書いた大きさが違えば、pdf-lib の部品の書き方が変わっている (相互参照の位置が狂う)
    if (n !== buf.length) throw internalsChanged(`sizeInBytes と copyBytesInto (${o[0].tag}: ${n} / ${buf.length} バイト)`);
    this.written.set(o[0].objectNumber, { ref: o[0], offset: this.offset });
    this.ranges.set(o[0].objectNumber, [this.offset, this.offset + buf.length]);
    this.released.delete(o[0].objectNumber);
    this.context.delete(o[0]);
    if (releasedLookupCheck) watchReleased(this.context, o[0]);
    this.push(buf);
  }

  /**
   * 書くオブジェクトを暗号化したもの (暗号化しないときと、暗号化の辞書・読めなかったオブジェクトは、そのまま)。
   * 相互参照のストリームは、ここを通さずに書く
   */
  private seal(o: Indirect): Indirect {
    const enc = this.opts.encryption;
    if (!enc || o[0] === this.context.trailerInfo.Encrypt || o[1] instanceof PDFInvalidObject) return o;
    return [o[0], enc.encryptObject(o[1])];
  }

  /** 先に書いたバイト列を足す (流して書くときは、文書の ID のハッシュに足し、64KB たまったら書き出し先へ渡す) */
  private push(b: Uint8Array): void {
    this.offset += b.length;
    if (!this.stream) {
      this.chunks.push(b);
      return;
    }
    this.stream.output.check();
    this.stream.documentId?.see(b);
    this.pending.push(b);
    this.pendingBytes += b.length;
    if (this.pendingBytes >= CHUNK_BYTES) this.emit();
  }

  /** 見出しと、その後の改行 2 つ */
  private headerBytes(): Uint8Array {
    const b = new Uint8Array(this.header.sizeInBytes() + 2);
    const n = this.header.copyBytesInto(b, 0);
    b[n] = 0x0a;
    b[n + 1] = 0x0a;
    return b;
  }

  /** 前の手順 (pdf-lib の save と同じ順。deflate は flush の後、ページを足す前) */
  private async prepare(): Promise<void> {
    const pdf = this.pdf;
    if (this.opts.deflate) {
      rejoin(thisCall(), await pdf.flush());
      for (const [, obj] of this.context.enumerateIndirectObjects()) deflateWith(obj, this.opts.deflate);
    }
    if ((this.opts.addDefaultPage ?? true) && pdf.getPageCount() === 0) pdf.addPage();
    formOf(pdf)?.updateFieldAppearances();
    rejoin(thisCall(), await pdf.flush());
  }

  /** trailer の辞書の中身 (pdf-lib の PDFWriter.createTrailerDict と同じ並び。無いものは書かない) */
  private trailerDict(): PDFDict {
    const ctx = this.context;
    return ctx.obj({ Size: ctx.largestObjectNumber + 1, Root: ctx.trailerInfo.Root, Encrypt: ctx.trailerInfo.Encrypt, Info: ctx.trailerInfo.Info, ID: ctx.trailerInfo.ID });
  }

  /** 残りのオブジェクトと、先に書いた流れを、番号の順に並べたもの (先に書いた流れは、中身の代わりに位置) */
  private merged(): (Indirect | Written)[] {
    const rest: (Indirect | Written)[] = this.context.enumerateIndirectObjects();
    if (!this.written.size) return rest;
    const all = [...rest, ...this.written.values()];
    const num = (x: Indirect | Written) => (Array.isArray(x) ? x[0].objectNumber : x.ref.objectNumber);
    return all.sort((a, b) => num(a) - num(b));
  }

  /**
   * 残りを書き、先に書いたものを含めた PDF の全体を返す (save と同じ前の手順の後)。
   * 流して書くときは、残り (最後の塊) を書き出し先へ渡して (文書の ID の印を書き換えてから)、その最後の塊を返す。書き出し先を閉じるのは、呼ぶ側
   */
  async finish(): Promise<Uint8Array> {
    if (this.finished) throw new Error('Kumiori: PdfWriter.finish twice');
    this.finished = true;
    rejoin(thisCall(), await this.prepare());
    if (this.opts.encryption && !this.context.trailerInfo.Encrypt) this.opts.encryption.register(this.context, this.pdf.catalog);
    const ticks = new Ticks();
    // 流して書くとき、先に書いたバイト列は書き出し先にあるので、最後の塊は先の位置 (offset) から始まる
    const tailStart = this.stream ? this.offset : 0;
    const headerSize = this.headerDone ? 0 : this.header.sizeInBytes() + 2;
    let size = this.offset + headerSize;
    /** 残りの書くもの (番号の順) */
    const out: Indirect[] = [];
    /** 暗号化したオブジェクトストリーム (PDFRawStream になる) の中のオブジェクトの数 (間をあける数え方を、暗号化しないときと同じにする) */
    const objectsIn = new Map<PDFObject, number>();
    let xref: PDFCrossRefSection | undefined;
    let trailerDict: PDFTrailerDict | undefined;
    let trailer: PDFTrailer;
    const items = this.merged();
    if (this.objectStreams) {
      // pdf-lib の PDFStreamWriter.computeBufferSize の写し
      let objectNumber = this.context.largestObjectNumber + 1;
      const xrefStream = PDFCrossRefStream.create(this.trailerDict(), true);
      const compressed: Indirect[][] = [];
      const streamRefs: PDFRef[] = [];
      const encrypt = this.context.trailerInfo.Encrypt;
      for (const item of items) {
        if (!Array.isArray(item)) {
          xrefStream.addUncompressedEntry(item.ref, item.offset);
          continue;
        }
        const [ref, obj] = item;
        if (ref === encrypt || obj instanceof PDFStream || obj instanceof PDFInvalidObject || ref.generationNumber !== 0) {
          const sealed = this.seal(item);
          out.push(sealed);
          xrefStream.addUncompressedEntry(ref, size);
          this.ranges.set(ref.objectNumber, [size, size + indirectSize(sealed)]);
          size += indirectSize(sealed);
          rejoin(thisCall(), await ticks.step(1));
        } else {
          let chunk = compressed[compressed.length - 1];
          let streamRef = streamRefs[streamRefs.length - 1];
          if (!chunk || chunk.length % OBJECTS_PER_STREAM === 0) {
            chunk = [];
            compressed.push(chunk);
            streamRef = PDFRef.of(objectNumber++);
            streamRefs.push(streamRef);
          }
          xrefStream.addCompressedEntry(ref, streamRef, chunk.length);
          chunk.push(item);
        }
      }
      for (let i = 0; i < compressed.length; i++) {
        // オブジェクトストリームは、全体を暗号化する (中のオブジェクトの文字列は暗号化しない。§7.5.7)
        const o = this.seal([streamRefs[i], PDFObjectStream.withContextAndObjects(this.context, compressed[i], true)]);
        objectsIn.set(o[1], compressed[i].length);
        xrefStream.addUncompressedEntry(o[0], size);
        this.ranges.set(o[0].objectNumber, [size, size + indirectSize(o)]);
        size += indirectSize(o);
        out.push(o);
        rejoin(thisCall(), await ticks.step(compressed[i].length));
      }
      const xrefRef = PDFRef.of(objectNumber++);
      xrefStream.dict.set(PDFName.of('Size'), PDFNumber.of(objectNumber));
      xrefStream.addUncompressedEntry(xrefRef, size);
      const xrefOffset = size;
      const x: Indirect = [xrefRef, xrefStream];
      size += indirectSize(x);
      out.push(x);
      trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefOffset);
    } else {
      // pdf-lib の PDFWriter.computeBufferSize の写し
      xref = PDFCrossRefSection.create();
      for (const item of items) {
        if (!Array.isArray(item)) {
          xref.addEntry(item.ref, item.offset);
          continue;
        }
        const sealed = this.seal(item);
        xref.addEntry(sealed[0], size);
        this.ranges.set(sealed[0].objectNumber, [size, size + indirectSize(sealed)]);
        size += indirectSize(sealed);
        out.push(sealed);
        rejoin(thisCall(), await ticks.step(1));
      }
      const xrefOffset = size;
      size += xref.sizeInBytes() + 1;
      trailerDict = PDFTrailerDict.of(this.trailerDict());
      size += trailerDict.sizeInBytes() + 2;
      trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefOffset);
    }
    size += trailer.sizeInBytes();
    // 書く (pdf-lib の PDFWriter.serializeToBuffer の写し。先に書いたバイト列は、そのまま写す。流して書くときは、最後の塊だけ)
    const buf = new Uint8Array(size - tailStart);
    let at = 0;
    if (!this.stream)
      for (const c of this.chunks) {
        buf.set(c, at);
        at += c.length;
      }
    if (headerSize) {
      buf.set(this.headerBytes(), at);
      at += headerSize;
    }
    // 書き終えた所から、先に書いたバイト列は要らない
    this.chunks.length = 0;
    for (const o of out) {
      at += putIndirect(o, buf, at);
      rejoin(thisCall(), await ticks.step(o[1] instanceof PDFObjectStream ? o[1].getObjectsCount() : objectsIn.get(o[1]) ?? 1));
    }
    if (xref) {
      at += xref.copyBytesInto(buf, at);
      buf[at++] = 0x0a;
    }
    if (trailerDict) {
      at += trailerDict.copyBytesInto(buf, at);
      buf[at++] = 0x0a;
      buf[at++] = 0x0a;
    }
    at += trailer.copyBytesInto(buf, at);
    // 数えた大きさと書いた大きさが違えば、pdf-lib の部品の書き方が変わっている
    if (at + tailStart !== size) throw internalsChanged(`sizeInBytes と copyBytesInto (${at + tailStart} / ${size} バイト)`);
    if (!this.stream) return buf;
    // 流して書く: 先の塊を渡し、最後の塊の文書の ID を決めて、64KB ずつ渡す
    this.emit();
    const tail = this.stream.documentId ? this.stream.documentId.finish(buf, tailStart, { xmp: this.xmpRange() }) : buf;
    for (let i = 0; i < tail.length; i += CHUNK_BYTES) {
      this.stream.output.write(tail.subarray(i, Math.min(tail.length, i + CHUNK_BYTES)));
      const wait = this.stream.output.idle();
      if (wait) rejoin(thisCall(), await wait);
    }
    return tail;
  }
}

/** 試験だけで使う: 先に書いて除いた流れを、後で引いたら投げるか */
let releasedLookupCheck = false;
/** 試験だけで使う: 先に書いて除いた流れを後で引いたら投げるようにする (除いたものを黙って引かないことの確かめ。design/pdf-writer.md の 3.2) */
export function __setReleasedLookupCheckForTest(on: boolean): void {
  releasedLookupCheck = on;
}
/** 文脈の中の番号の表の引き (Map の get) を包み、除いた番号を引いたら投げる (試験だけ) */
function watchReleased(ctx: PDFContext, ref: PDFRef): void {
  const map = (ctx as unknown as { indirectObjects: Map<PDFRef, PDFObject> & { kumioriGone?: Set<PDFRef> } }).indirectObjects;
  if (!map.kumioriGone) {
    const gone = (map.kumioriGone = new Set<PDFRef>());
    const get = map.get.bind(map);
    map.get = (r: PDFRef) => {
      if (gone.has(r)) throw new Error(`Kumiori: ${r.tag} was looked up after it was written early and removed`);
      return get(r);
    };
  }
  map.kumioriGone.add(ref);
}

/** 試験だけで使う: writePdf の代わりに書く関数 (pdf-lib の save で書き、自前の書き手と比べるため) */
let writeOverride: ((pdf: PDFDocument, opts: PdfWriteOptions) => Promise<Uint8Array>) | undefined;
/** 試験だけで使う: writePdf の代わりに書く関数を置く (undefined で戻す) */
export function __setPdfWriterForTest(f: typeof writeOverride): void {
  writeOverride = f;
}

/** PDFDocument.save と同じ PDF を書く (前の手順・オブジェクトの並び・バイト列が同じ。見出しの版と圧縮の関数を選べる) */
export async function writePdf(pdf: PDFDocument, opts: PdfWriteOptions = {}): Promise<Uint8Array> {
  if (writeOverride) return rejoin(thisCall(), await writeOverride(pdf, opts));
  const w = new PdfWriter(pdf, opts);
  const bytes = rejoin(thisCall(), await w.finish());
  xmpRanges.set(bytes, w.xmpRange());
  return bytes;
}

/** writePdf が書いた PDF ごとの、XMP の流れの範囲 (null は XMP 無し) */
const xmpRanges = new WeakMap<Uint8Array, readonly [number, number] | null>();
/**
 * writePdf が書いた PDF の、XMP の流れの範囲 (文書の ID の印を探す所)。null は XMP が無いこと。
 * writePdf が書いたものでなければ (試験で pdf-lib の save に替えたとき) undefined
 */
export function writtenXmpRange(bytes: Uint8Array): readonly [number, number] | null | undefined {
  return xmpRanges.get(bytes);
}
