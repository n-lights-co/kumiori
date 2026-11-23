/**
 * pdfStreamGuard — 外から来た PDF (PDF の画像) の流れの圧縮を、大きさと時間を縛って解く (design/pdf-as-image.md の 4 節・8 節の 5)。
 *
 * - 流れの方式 (Filter。ISO 32000-1 §7.4 Table 6) を 1 段ずつ解き、どの段の出力も、残りのバイト (left) を超えたら止める。
 *   二重の Flate・DecodeParms 付き・LZW も、解く前・解く間に縛る (中の段が膨らむのを、外の段の出力だけ見て見逃さない)。
 *   Flate は、展開した長さを先に数えてから展開する (inflateFast)。ほかの方式は pdf-lib の復号器から少しずつ取り、取るたびに長さを見る。
 *   DecodeParms の予測 (Predictor) は、pdf-lib と同じに当てない (いままでの読み方と変えない)
 * - 締め切り (deadline。Date.now() の値) を過ぎたら止める。解く間はイベントループが止まるので、時限の setTimeout は効かない
 * - pdf-lib の読み手は、読み込みのときに、オブジェクトの流れ (ObjStm。§7.5.7) と相互参照の流れ (XRef。§7.5.8) を縛り無しに解く
 *   (core/parser/PDFParser.js の parseIndirectObject)。loadPdfGuarded は、読み手が読んだ流れを、解く前に、この縛りで解いた流れに替える。
 *   ObjStm の中のオブジェクトの数 (N) も、解く前に数に入れる (読む前の obj の語の数の見積もりには、ObjStm の中のオブジェクトが入らないため)
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFParser, PDFRawStream, PDFStream, decodePDFRawStream, type PDFContext, type PDFObject } from 'pdf-lib';
import { rejoin, thisCall } from './callContext';
import { inflateFast, inflatedLength } from './inflateFast';

/** 解いた結果: バイト列、上限を超えた ('limit')、締め切りを過ぎた ('time')、解けない (undefined) */
export type GuardedDecode = Uint8Array | 'limit' | 'time' | undefined;

/** pdf-lib の復号器から 1 度に取るバイトの数 (取るたびに、長さと締め切りを見る) */
const CHUNK = 1 << 16;

/** 流れの圧縮を解く (どの段の出力も left バイトまで。deadline を過ぎたら 'time') */
export function decodeGuarded(dict: PDFDict, contents: Uint8Array, left: number, deadline = Infinity): GuardedDecode {
  try {
    const filter = dict.lookup(PDFName.of('Filter'));
    const parms = dict.lookup(PDFName.of('DecodeParms'));
    const filters = filter === undefined ? [] : filter instanceof PDFArray ? filter.asArray().map((f) => dict.context.lookup(f)) : [filter];
    let b = contents;
    if (b.length > left) return 'limit';
    for (let i = 0; i < filters.length; i++) {
      if (Date.now() > deadline) return 'time';
      const f = filters[i];
      if (!(f instanceof PDFName)) return undefined;
      if (f.asString() === '/FlateDecode') {
        // deflate は、展開した長さを先に数える (展開したバイト列を持たない)
        if (inflatedLength(b, left + 1) > left) return 'limit';
        b = inflateFast(b, left + 1);
        continue;
      }
      // ほかの方式 (LZW・ASCII85・ASCIIHex・RunLength。§7.4.4〜§7.4.6): pdf-lib の復号器から少しずつ取る
      const p = filter instanceof PDFArray ? (parms instanceof PDFArray ? dict.context.lookup(parms.get(i)) : undefined) : parms;
      const one = PDFDict.withContext(dict.context);
      one.set(PDFName.of('Filter'), f);
      if (p instanceof PDFDict) one.set(PDFName.of('DecodeParms'), p);
      const stream = decodePDFRawStream(PDFRawStream.of(one, b));
      const parts: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const got = stream.getBytes(CHUNK);
        if (!got.length) break;
        total += got.length;
        if (total > left) return 'limit';
        parts.push(new Uint8Array(got));
        if (Date.now() > deadline) return 'time';
      }
      b = concatBytes(parts, total);
    }
    return b;
  } catch {
    return undefined;
  }
}

const concatBytes = (parts: Uint8Array[], total: number) => {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** 読み込みの縛り (loadPdfGuarded が、読みながら減らす) */
export interface LoadGuard {
  /** ObjStm の中のオブジェクトの数の残り (pdfImageObjects) */
  objects: number;
  /** ObjStm・XRef の流れを解いた大きさの残り (バイト) */
  streamBytes: number;
  /** 締め切り (Date.now() の値。pdfImageLoadMs) */
  deadline: number;
  /** 時限が切れた (読み手を止める) */
  aborted?: boolean;
}

/** 読み込みの縛りに当たった (limit: 当たった上限の名前) */
export class PdfLoadLimitError extends Error {
  constructor(readonly limit: 'pdfImageObjects' | 'pdfImageStreamBytes' | 'pdfImageLoadMs') {
    super(limit);
  }
}

/**
 * 縛りを付けて PDF を読む (pdfxVerify の loadWithoutCopy と同じに、元のバイト列を写さずに読む)。
 * 縛りに当たったら PdfLoadLimitError を投げる (読み手は、オブジェクトを読むときの誤りを握りつぶして読み続けるので、当たった後のオブジェクトは
 * 読まずに飛ばさせ、読み終えてから投げる)
 */
export async function loadPdfGuarded(bytes: Uint8Array, guard: LoadGuard): Promise<PDFDocument> {
  const parser = PDFParser.forBytesWithOptions(bytes, 100);
  const raw = parser as unknown as { bytes?: { slice?: (start: number, end: number) => Uint8Array }; parseObject: () => PDFObject };
  if (raw.bytes && typeof raw.bytes.slice === 'function') raw.bytes.slice = (start: number, end: number) => bytes.subarray(start, end);
  let hit: PdfLoadLimitError | undefined;
  const parseObject = raw.parseObject.bind(parser);
  raw.parseObject = () => {
    if (!hit && (guard.aborted || Date.now() > guard.deadline)) hit = new PdfLoadLimitError('pdfImageLoadMs');
    if (hit) throw hit;
    const o = parseObject();
    if (!(o instanceof PDFRawStream)) return o;
    const type = o.dict.lookup(PDFName.of('Type'));
    const objStm = type === PDFName.of('ObjStm');
    if (!objStm && type !== PDFName.of('XRef')) return o;
    const r = guardedStream(o, objStm, guard);
    if (r instanceof PdfLoadLimitError) throw (hit = r);
    return r;
  };
  const context = rejoin(thisCall(), await parser.parseDocument());
  if (hit) throw hit;
  // PDFDocument.load と同じに、読んだ文脈から文書を作る (作り方の関数は公開されていない)
  const Doc = PDFDocument as unknown as new (context: unknown, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  return new Doc(context, true, false);
}

/** 読み手が読んだ ObjStm・XRef の流れを、縛りの中で解いた流れ (Filter の無いもの) に替える。解けないものは、中身の無い流れにする */
function guardedStream(o: PDFRawStream, objStm: boolean, guard: LoadGuard): PDFRawStream | PdfLoadLimitError {
  const num = (k: string) => {
    const v = o.dict.lookup(PDFName.of(k));
    return v instanceof PDFNumber ? v.asNumber() : 0;
  };
  if (objStm) {
    guard.objects -= Math.max(0, num('N'));
    if (guard.objects < 0) return new PdfLoadLimitError('pdfImageObjects');
  }
  const decoded = decodeGuarded(o.dict, o.contents, guard.streamBytes, guard.deadline);
  if (decoded === 'limit') return new PdfLoadLimitError('pdfImageStreamBytes');
  if (decoded === 'time') return new PdfLoadLimitError('pdfImageLoadMs');
  const dict = o.dict.clone();
  dict.delete(PDFName.of('Filter'));
  dict.delete(PDFName.of('DecodeParms'));
  const body = decoded ?? new Uint8Array(0);
  guard.streamBytes -= body.length;
  if (objStm) {
    if (!decoded) dict.set(PDFName.of('N'), PDFNumber.of(0));
  } else {
    // 相互参照の流れの項の数 × 1 項のバイトの数 (W の和) が、解いた長さに収まらなければ、項を読まない (読み手は、尽きたバイト列を項の数だけ回って読む)
    const w = o.dict.lookup(PDFName.of('W'));
    const width = w instanceof PDFArray ? w.asArray().reduce((s: number, x) => s + (x instanceof PDFNumber ? Math.max(0, x.asNumber()) : 0), 0) : 0;
    const index = o.dict.lookup(PDFName.of('Index'));
    let entries = 0;
    if (index instanceof PDFArray) for (let i = 1; i < index.size(); i += 2) entries += Math.max(0, (index.lookup(i) as PDFNumber | undefined)?.asNumber?.() ?? 0);
    else entries = Math.max(0, num('Size'));
    if (!decoded || !(entries * Math.max(1, width) <= body.length)) dict.set(PDFName.of('Index'), PDFArray.withContext(o.dict.context));
  }
  return PDFRawStream.of(dict, body);
}

/**
 * 写し手を作る (PDFObjectCopier。写すときに、置き換えの表 (replaced) にある流れを、置き換えたものにする。
 * 入れ子の Form などの、MCID を外した流れと、StructParent・StructParents を消した流れ (pdfImageEmbed.ts))
 */
export function copierWith(src: PDFContext, dest: PDFContext, replaced: WeakMap<PDFStream, PDFStream>): PDFObjectCopier {
  const copier = PDFObjectCopier.for(src, dest);
  const c = copier as unknown as { copyPDFStream: (s: PDFStream) => PDFStream };
  const copyStream = c.copyPDFStream;
  c.copyPDFStream = (s: PDFStream) => copyStream(replaced.get(s) ?? s);
  return copier;
}
