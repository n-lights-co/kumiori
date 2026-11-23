/**
 * iccRegistry — ICC の登録簿 (registry.color.org) の印刷条件の名前と、ICC プロファイルの頭・タグの表を読む小さな関数。
 * 出力の規格の印 (pdfStandard.ts) と、書き出した PDF の検査 (pdfxVerify.ts) の両方で使う。
 */

/** ICC プロファイルの機器の種類 (頭の 12〜15 バイト目。ICC.1:2010 §7.2.5。prtr は出力機器、mntr は表示機器) */
export function iccDeviceClass(profile: Uint8Array): string {
  return profile.length >= 16 ? String.fromCharCode(...profile.subarray(12, 16)) : '';
}

/** ICC プロファイルがタグ sig を持つか (タグの表は 128 バイト目から: 数と、12 バイトずつの署名・位置・大きさ。ICC.1:2010 §7.3) */
export function iccHasTag(profile: Uint8Array, sig: string): boolean {
  if (profile.length < 132) return false;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const count = view.getUint32(128);
  for (let k = 0; k < count && 132 + k * 12 + 12 <= profile.length; k++) {
    const at = 132 + k * 12;
    if (String.fromCharCode(...profile.subarray(at, at + 4)) === sig) return true;
  }
  return false;
}

/** 大きい方が先の 4 バイトの数 */
const u32At = (p: Uint8Array, o: number) => (((p[o]! << 24) | (p[o + 1]! << 16) | (p[o + 2]! << 8) | p[o + 3]!) >>> 0);
const sigAt = (p: Uint8Array, o: number) => String.fromCharCode(...p.subarray(o, o + 4));

/**
 * ICC プロファイルの形を、頭とタグの表まで確かめる。合わなければ、その理由 (日本語と英語) を返す (合えば undefined)。
 *  - 頭 (ICC.1:2010 §7.2): 128 バイトの頭とタグの数があり、頭の大きさの欄 (0〜3 バイト目。§7.2.2) がファイルの長さ以下で、
 *    タグの表の終わり以上。36〜39 バイト目が 'acsp' (§7.2.9)
 *  - タグの表 (§7.3): 数と 12 バイトずつの署名・位置・大きさが、頭の大きさの中に収まる。どのタグの中身も、タグの表の後ろから
 *    プロファイルの終わりまでの間にあり、型の署名と予約の 8 バイト (§10.1) 以上ある。同じ署名のタグを 2 つ書かない (§7.3.1)
 *  - 説明のタグ desc (§8.2 で、どのプロファイルにも要る) があり、文を読める (版 2 の textDescriptionType か、版 4 の multiLocalizedUnicodeType)。
 * 中身の色の表 (A2B0・B2A0 など) が変換に使えるかは見ない (表の読めないプロファイルは、変換に式を使って警告する。pdfRenderer.ts の pdfxConverter)
 */
export function iccProfileProblem(profile: Uint8Array): { ja: string; en: string } | undefined {
  if (profile.length < 132) return { ja: `大きさが ${profile.length} バイトで、頭とタグの表 (132 バイト以上) がありません`, en: `the size is ${profile.length} bytes, too small for the header and tag table (132 bytes or more)` };
  const size = u32At(profile, 0);
  if (size > profile.length) return { ja: `頭の大きさの欄 (${size} バイト) が、ファイルの長さ (${profile.length} バイト) を超えます`, en: `the profile size in the header (${size} bytes) exceeds the file length (${profile.length} bytes)` };
  if (sigAt(profile, 36) !== 'acsp') return { ja: '頭の 36〜39 バイト目が acsp ではありません', en: 'bytes 36 to 39 of the header are not acsp' };
  const count = u32At(profile, 128);
  const tableEnd = 132 + 12 * count;
  if (count === 0 || tableEnd > size) return { ja: `タグの表 (タグの数 ${count}) が、頭の大きさの欄 (${size} バイト) に収まりません`, en: `the tag table (tag count ${count}) does not fit in the profile size in the header (${size} bytes)` };
  const seen = new Set<string>();
  for (let k = 0; k < count; k++) {
    const at = 132 + 12 * k;
    const sig = sigAt(profile, at);
    const ofs = u32At(profile, at + 4);
    const len = u32At(profile, at + 8);
    if (seen.has(sig)) return { ja: `タグ ${sig} が 2 つあります`, en: `the tag ${sig} appears twice` };
    seen.add(sig);
    if (ofs < tableEnd || len < 8 || ofs + len > size) return { ja: `タグ ${sig} の中身 (位置 ${ofs}・大きさ ${len}) が、タグの表の後ろからプロファイルの終わりまでの間にありません`, en: `the data of the tag ${sig} (offset ${ofs}, size ${len}) is not between the end of the tag table and the end of the profile` };
  }
  if (!iccDescription(profile)) return { ja: '説明のタグ (desc) が無いか、その文を読めません', en: 'the description tag (desc) is missing or unreadable' };
  return undefined;
}

/** 字の符号の並びを、少しずつ (8192 字ずつ) 字にする (String.fromCharCode に大きな配列を広げると、引数の数の上限でスタックを使い切る) */
function latin1(codes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < codes.length; i += 8192) out += String.fromCharCode(...Array.prototype.slice.call(codes, i, i + 8192));
  return out;
}

/**
 * ICC プロファイルの説明 (desc のタグの文。ICC.1:2010 §9.2.41)。版 2 の textDescriptionType ('desc'。ICC.1:2001-04 §6.5.17) は ASCII の文、
 * 版 4 の multiLocalizedUnicodeType ('mluc'。ICC.1:2010 §10.13) は英語 (en) の記録、無ければ初めの記録 (UTF-16BE)。
 * 前後の空白は除く。無いか読めなければ undefined
 */
export function iccDescription(profile: Uint8Array): string | undefined {
  if (profile.length < 132) return undefined;
  const size = Math.min(profile.length, u32At(profile, 0) || profile.length);
  const count = u32At(profile, 128);
  for (let k = 0; k < count && 132 + 12 * k + 12 <= size; k++) {
    const at = 132 + 12 * k;
    if (sigAt(profile, at) !== 'desc') continue;
    const ofs = u32At(profile, at + 4);
    const len = u32At(profile, at + 8);
    if (ofs + len > size || len < 12) return undefined;
    const type = sigAt(profile, ofs);
    let text: string | undefined;
    if (type === 'desc') {
      const n = u32At(profile, ofs + 8);
      if (n < 1 || 12 + n > len) return undefined;
      // 字は ASCII で、0 で終わる (ICC.1:2001-04 §6.5.17)。0 の前までを、少しずつ字にする (大きな配列を引数に広げると、スタックを使い切る)
      const bytes = profile.subarray(ofs + 12, ofs + 12 + n);
      const end = bytes.indexOf(0);
      text = latin1(end < 0 ? bytes : bytes.subarray(0, end));
    } else if (type === 'mluc') {
      const records = u32At(profile, ofs + 8);
      const recSize = u32At(profile, ofs + 12);
      if (records < 1 || recSize < 12 || 16 + records * recSize > len) return undefined;
      let pick = 0;
      for (let r = 0; r < records; r++) if (sigAt(profile, ofs + 16 + r * recSize).startsWith('en')) {
        pick = r;
        break;
      }
      const rec = ofs + 16 + pick * recSize;
      const n = u32At(profile, rec + 4);
      const o = u32At(profile, rec + 8);
      if (n % 2 || o + n > len) return undefined;
      const units: number[] = [];
      for (let i = 0; i < n; i += 2) units.push((profile[ofs + o + i]! << 8) | profile[ofs + o + i + 1]!);
      text = latin1(units);
    } else return undefined;
    return text.trim() || undefined;
  }
  return undefined;
}

/**
 * ICC の登録簿 (registry.color.org の CMYK Characterization Data) の Reference name の一覧 (2026 年 11 月に登録簿で確かめたもの)。
 * 出力意図の OutputConditionIdentifier がこのどれかと完全に一致するときだけ、RegistryName (http://www.color.org) を書く
 * (ISO 15930-1 §6.3.2・ISO 15930-7 §6.4.2.1: RegistryName を書くなら、OutputConditionIdentifier は登録簿の名前と完全に一致しなければならない)
 */
export const ICC_CMYK_REGISTRY: ReadonlySet<string> = new Set([
  'APTEC CCNB', 'APTEC Coated CardBoard', 'APTEC_CTV_3', 'APTEC_CTV_4', 'APTEC_CTV_5', 'APTEC_CTV_6', 'APTEC_CTV_7', 'APTEC_CTV_8',
  'CGATS TR 001', 'CGATS TR 002', 'CGATS TR 003', 'CGATS TR 005', 'CGATS TR 006',
  'CGATS21-2-CRPC1', 'CGATS21-2-CRPC2', 'CGATS21-2-CRPC3', 'CGATS21-2-CRPC4', 'CGATS21-2-CRPC5', 'CGATS21-2-CRPC6', 'CGATS21-2-CRPC7',
  'EUROSB104', 'EUROSB204',
  'FOGRA27', 'FOGRA28', 'FOGRA29', 'FOGRA30', 'FOGRA31', 'FOGRA32', 'FOGRA33', 'FOGRA34', 'FOGRA35', 'FOGRA36', 'FOGRA37', 'FOGRA38', 'FOGRA39',
  'FOGRA40', 'FOGRA41', 'FOGRA42', 'FOGRA43', 'FOGRA44', 'FOGRA45', 'FOGRA46', 'FOGRA47', 'FOGRA48', 'FOGRA49', 'FOGRA50', 'FOGRA51', 'FOGRA52',
  'FOGRA53', 'FOGRA54',
  'IFRA26',
  'JC200103', 'JC200104', 'JCN2002', 'JCS2011', 'JCW2003',
]);

/** 出力意図の RegistryName の値 (ICC の登録簿。ISO 15930-1 §6.3.2) */
export const ICC_REGISTRY_NAME = 'http://www.color.org';
