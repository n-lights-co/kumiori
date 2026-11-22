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
