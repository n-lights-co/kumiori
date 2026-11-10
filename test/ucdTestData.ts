/**
 * Unicode の公式の適合試験のデータ (UCD の LineBreakTest.txt・BidiTest.txt・BidiCharacterTest.txt) を用意する。
 *
 * 試験のデータは他の人の著作物なのでリポジトリには入れない。.cache/unicode に無ければ unicode.org から取得して置く
 * (KUMIORI_UCD_DIR で場所を上書きできる)。版は、src/unicodeData.ts の表を作った UCD の版 (scripts/gen-unicode-data.mjs) に合わせる。
 * CI は .cache/unicode を、このファイルのハッシュを鍵にして持ち越す (.github/workflows/ci.yml)。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 試験のデータの版。src/unicodeData.ts の先頭に書いてある UCD の版と同じにする (lineBreakConformance.test.ts が確かめる) */
export const UCD_VERSION = '18.0.0';

/** 試験のデータの置き場 (.cache/unicode。KUMIORI_UCD_DIR で上書き可) */
const ucdDir = process.env.KUMIORI_UCD_DIR ?? path.resolve(__dirname, '../.cache/unicode');

/**
 * UCD の試験のファイル (ucd/ からの相対の場所。例: 'auxiliary/LineBreakTest.txt') の中身。取得できなければ undefined。
 * 置き場には「名前-版.txt」で置く。一時ファイルに書き終えてから名前を変えるので、別のワーカーが書きかけを読むことは無い
 */
export async function ucdTestData(relPath: string): Promise<string | undefined> {
  const file = path.join(ucdDir, `${path.basename(relPath, '.txt')}-${UCD_VERSION}.txt`);
  if (!fs.existsSync(file)) {
    try {
      const res = await fetch(`https://www.unicode.org/Public/${UCD_VERSION}/ucd/${relPath}`);
      if (!res.ok) return undefined;
      fs.mkdirSync(ucdDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      fs.renameSync(tmp, file);
    } catch {
      return undefined;
    }
  }
  return fs.readFileSync(file, 'utf8');
}
