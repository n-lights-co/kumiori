/**
 * fontLoader — ユーザーが選んだフォントファイル (TTF / OTF / TTC) を、1 書体ずつの sfnt に分けて名前を読む。
 *
 * MS 明朝・MS ゴシックのような TTC (複数書体が 1 ファイル) は、Canvas の FontFace も PDF の埋め込みも
 * そのままでは扱えないので、選んだ書体のテーブルだけを集めて単独の sfnt に組み直す。
 * フォントは利用者の PC からだけ読み込み、リポジトリや配布物には含めない。
 */
import { toSfnt } from './webFont';
import { msg } from './messages';
import fontkit from '@pdf-lib/fontkit';

export interface UserFont {
  /** 英語のファミリ名 (例: "MS Mincho") */
  family: string;
  /** 日本語のファミリ名など、FO から指定され得る別名 */
  names: string[];
  weight: number;
  buffer: ArrayBuffer;
  /** 書体の usWeightClass (OS/2)。以前の版 (weight を 400・700 の 2 段にしていた) との互換のために残す。今は weight と同じ */
  weightClass?: number;
}

const tagOf = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/** 壊れた書体ファイル (短い・表の位置が範囲外) の誤り。呼ぶ側は読めない書体として扱う */
export class FontFileError extends Error {}

/** 位置と長さがファイルの中に収まっているか。収まっていなければ FontFileError (DataView の RangeError を外に出さない) */
const check = (buf: ArrayBuffer, offset: number, length: number) => {
  if (!(offset >= 0 && length >= 0 && offset + length <= buf.byteLength)) throw new FontFileError(msg('書体ファイルが壊れています (表の位置が範囲外)', 'the font file is broken (table offset out of range)'));
};

/** TTC 内の index 番目の書体を、単独の sfnt として取り出す。壊れたファイルは FontFileError */
export function extractFromCollection(buf: ArrayBuffer, index: number): ArrayBuffer {
  const v = new DataView(buf);
  if (countFonts(buf) <= index) throw new FontFileError(msg('TTC に該当の書体がありません', 'the TTC has no such font'));
  check(buf, 12 + index * 4, 4);
  const off = v.getUint32(12 + index * 4);
  check(buf, off, 12);
  const numTables = v.getUint16(off + 4);
  check(buf, off + 12, numTables * 16);
  const recs: { tag: string; sum: number; offset: number; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + i * 16;
    recs.push({ tag: tagOf(v, r), sum: v.getUint32(r + 4), offset: v.getUint32(r + 8), length: v.getUint32(r + 12) });
  }
  for (const r of recs) check(buf, r.offset, r.length);
  const headLen = 12 + numTables * 16;
  let total = headLen;
  for (const r of recs) total += (r.length + 3) & ~3;
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  out.set(new Uint8Array(buf, off, 12));
  let pos = headLen;
  recs.forEach((r, i) => {
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[d + k] = r.tag.charCodeAt(k);
    ov.setUint32(d + 4, r.sum);
    ov.setUint32(d + 8, pos);
    ov.setUint32(d + 12, r.length);
    out.set(new Uint8Array(buf, r.offset, r.length), pos);
    pos += (r.length + 3) & ~3;
  });
  return out.buffer;
}

/** TTC (書体の集まり) のファイルか */
export function isCollection(buf: ArrayBuffer): boolean {
  return buf.byteLength >= 12 && tagOf(new DataView(buf), 0) === 'ttcf';
}

/** ファイル内の書体の数 (TTF / OTF は 1)。sfnt の頭 (12 バイト) も無いファイルは FontFileError */
export function countFonts(buf: ArrayBuffer): number {
  if (buf.byteLength < 12) throw new FontFileError(msg('書体ファイルが短すぎます', 'the font file is too short'));
  if (!isCollection(buf)) return 1;
  const n = new DataView(buf).getUint32(8);
  // 書体の位置の表 (4 バイトずつ) がファイルに収まらない数は壊れている
  check(buf, 12, n * 4);
  return n;
}

/**
 * ファイルの中の書体を 1 つずつの sfnt にする (TTF・OTF はそのまま 1 つ、TTC は中の書体をすべて取り出す)。
 * 壊れたファイルは FontFileError (書体の中身の解釈はしない)
 */
export function collectionFaces(buf: ArrayBuffer): ArrayBuffer[] {
  // WOFF・WOFF2 は、ふつうの書体のファイルに戻してから読む (webFont.ts)
  buf = toSfnt(buf);
  const n = countFonts(buf);
  return isCollection(buf) ? Array.from({ length: n }, (_, i) => extractFromCollection(buf, i)) : [buf];
}

/** ファイルから使える書体をすべて取り出す。読めない書体 (壊れたファイルを含む) は黙って飛ばす */
export function splitFontFile(buf: ArrayBuffer): UserFont[] {
  const out: UserFont[] = [];
  let faces: ArrayBuffer[];
  try {
    faces = collectionFaces(buf);
  } catch {
    return out;
  }
  for (const single of faces) {
    try {
      const fk = fontkit.create(new Uint8Array(single)) as unknown as {
        familyName?: string;
        name?: { records?: { fontFamily?: Record<string, string>; preferredFamily?: Record<string, string> } };
        'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } };
        directory?: { tables?: Record<string, unknown> };
      };
      // 可変フォント (fvar を持つ) は、太さ・幅をまとめたファミリー名 (nameID 16。無ければ nameID 1) で登録する
      // (nameID 1 は、既定の形の名前 (「Anybody Thin」など) のことがある。太さ・幅は、軸の値で選ぶ)
      const variable = !!fk.directory?.tables?.fvar;
      const typographic = variable ? fk.name?.records?.preferredFamily : undefined;
      const fam = typographic?.en ?? fk.familyName;
      if (!fam) continue;
      // 斜体の書体は、標準の書体の代わりにしない (Kumiori の斜体は字を傾けて描く)
      if (fk['OS/2']?.fsSelection?.italic) continue;
      const names = new Set<string>([fam]);
      for (const v of Object.values(typographic ?? {})) if (typeof v === 'string' && v) names.add(v);
      for (const v of Object.values(fk.name?.records?.fontFamily ?? {})) if (typeof v === 'string' && v) names.add(v);
      // 太さは OS/2 の usWeightClass そのまま (公開 API の fonts・CLI の --font と同じ持ち方。Medium (500) は 500 で登録する)。無ければ 400
      const wc = fk['OS/2']?.usWeightClass;
      out.push({ family: fam, names: [...names], weight: wc || 400, buffer: single, ...(wc ? { weightClass: wc } : {}) });
    } catch {
      /* 読めない書体は無視 */
    }
  }
  return out;
}

/** FO の font-family 名 / フォントの名前の照合用: 全角→半角・小文字・空白除去、和名を英名へ */
export function normalizeFamily(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/['"]/g, '')
    .toLowerCase()
    .replace(/明朝/g, 'mincho')
    .replace(/ゴシック/g, 'gothic')
    .replace(/\s+/g, '');
}
