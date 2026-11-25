/**
 * verapdf-lib — veraPDF (https://verapdf.org/ 。PDF/UA・PDF/A の検査をする無償のソフト) を取って置き、動かして結果を読む部品。
 * scripts/verapdf.mjs (コマンド) と scripts/pdf-checks-lib.mjs (出来た PDF の検査) で使う。
 *
 * veraPDF は、Maven Central (repo1.maven.org) から、コマンドの部品 (org.verapdf.apps:greenfield-apps) と、それが使う jar を取って
 * <dir>/<版>/ に置く (.cache は .gitignore 済み。リポジトリにも配る物にも入れない)。jar ごとに、ここに書いた SHA-256 と比べ、
 * 合わなければ消して止まる (配布元の差し替え・壊れたファイルを動かさない)。置いてあれば取り直さない。
 * jar の並びは、Maven で greenfield-apps の依存を集めたもの (mvn dependency:copy-dependencies。2026-11-19)。版を上げるときは、
 * 同じ手順で集め直し、座標と SHA-256 を書き直す。
 * 動かすには Java が要る (PATH の java。Java 21 で確かめた)。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '1.28.2';
const MAVEN = 'https://repo1.maven.org/maven2';
/** [groupId, artifactId, 版, SHA-256] */
export const JARS = [
  ['org.verapdf.apps', 'greenfield-apps', VERSION, '687d4d8bcfec48c9f7e931cf78ed061f1eeccfba55d4cdc000ba9b4d8aa46ce6'],
  ['org.verapdf.apps', 'gui', VERSION, 'b3382c806dfc11f780cdc51d398bdacc7cc23c0ba1899d687ad26dbef533c114'],
  ['org.verapdf', 'core', VERSION, '847b0d5ac9effa76d310db92dfb8e11a67c94f70271f54971fcbc75a358abf01'],
  ['org.verapdf', 'feature-reporting', VERSION, 'b11601c1644fc06ac09190632b7fc172946a707b55e976acbe804a25ab8500be'],
  ['org.verapdf', 'metadata-fixer', VERSION, '7a005db32a5781ea34502c0c4d99aeb0f97a742c7d6fd80756fd10e8a987862f'],
  ['org.verapdf', 'parser', VERSION, 'b51d39394b2d24f1e0303a0cffbaffc238604d4bb6010ea90a85150b4a2659f6'],
  ['org.verapdf', 'pdf-model', VERSION, '7f4695701faefaa9efd3a39265f0020dc622edbc66d528e96118c392c03ec4d2'],
  ['org.verapdf', 'validation-model', VERSION, '8d5891939a8302a9b5b1b4791fb63328ad5edb51728866e935bf89b3c6f469df'],
  ['org.verapdf', 'verapdf-xmp-core', VERSION, 'e7b827185f0480cc1a4347522eaea51a826e0177689d623b39646a02edfab421'],
  ['com.fasterxml.jackson.core', 'jackson-annotations', '2.15.0', '91adcd3dcf5fd9a16499934e7536a23d456692a0093e3d4fd52f138c3936348c'],
  ['com.fasterxml.jackson.core', 'jackson-core', '2.15.0', '5b483f68fa9dd6aa37da37d1f79dd5c4b9464238f4f0660a242cb6b5c724950c'],
  ['com.fasterxml.jackson.core', 'jackson-databind', '2.15.0', '00c5a5d5ae71ac8e8d5b8da606841e2251c806355939cb5d51c4cdc6b644a0dc'],
  ['javax.activation', 'javax.activation-api', '1.2.0', '43fdef0b5b6ceb31b0424b208b930c74ab58fac2ceeb7b3f6fd3aeb8b5ca4393'],
  ['javax.xml.bind', 'jaxb-api', '2.3.1', '88b955a0df57880a26a74708bc34f74dcaf8ebf4e78843a28b50eae945732b06'],
  ['com.sun.xml.bind', 'jaxb-core', '2.3.0.1', 'd2ecba63615f317a11fb55c6468f6a9480f6411c10951d9881bafd9a9a8d0467'],
  ['com.sun.xml.bind', 'jaxb-impl', '2.3.2', 'b3a3d3aeaa5503cadc24dca9539b87efcd7bc3bd8c48018887a1489f2a77bdc0'],
  ['com.beust', 'jcommander', '1.81', '9d8b42979c99f3daa99102fe9ba1fb25f52226cb48cf58bc18acb93132e41a05'],
  ['org.mozilla', 'rhino', '1.7.13', '931dda33789d8e004ff5b5478ee3d6d224305de330c48266df7c3e49d52fc606'],
  ['net.java.dev.stax-utils', 'stax-utils', '20070216', '7c7fd0892cb3362ed2e43ce2f76c8f18f2d7ff1d371ed7490775b7368f3fee9a'],
];
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** jar を取って置く (置いてあり、SHA-256 が合えば取り直さない)。取れなければ Error を投げる */
export async function fetchJars(dir, log = (m) => console.error(m)) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [g, a, v, hash] of JARS) {
    const file = path.join(dir, `${a}-${v}.jar`);
    if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash) continue;
    const url = `${MAVEN}/${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}.jar`;
    // 一時的な誤り (429 Too Many Requests・5xx・つながらない) は、間を空けて取り直す (4 回まで)
    let r;
    let why = '';
    for (let k = 0; k < 4; k++) {
      if (k) await new Promise((ok) => setTimeout(ok, 2000 * 2 ** (k - 1)));
      try {
        r = await fetch(url);
      } catch (e) {
        r = undefined;
        why = String(e?.cause?.message ?? e?.message ?? e);
        continue;
      }
      if (r.ok || !(r.status === 429 || r.status >= 500)) break;
      why = String(r.status);
    }
    if (!r) throw new Error(`取れません: ${url}\n  ${why}\n  (プロキシを通す環境では NODE_USE_ENV_PROXY=1 を付けてください。repo1.maven.org へのネットワークが要ります)`);
    if (!r.ok) throw new Error(`取れません: ${url} (${r.status})`);
    const b = Buffer.from(await r.arrayBuffer());
    if (sha256(b) !== hash) throw new Error(`SHA-256 が合いません: ${url}\n  期待 ${hash}\n  実際 ${sha256(b)}\n  (取ったものは置きません)`);
    fs.writeFileSync(file, b);
    log(`取りました: ${a}-${v}.jar (${(b.length / 1024).toFixed(0)}KB)`);
  }
}

/** 版ごとの jar の置き場 (<dir>/<版>) */
export const jarDir = (dir) => path.resolve(dir, VERSION);

/** jar がそろっていて (中身は比べない。大きさが 0 でないことだけ)、java が動くか */
export function verapdfReady(dir) {
  const d = jarDir(dir);
  if (!JARS.every(([, a, v]) => fs.statSync(path.join(d, `${a}-${v}.jar`), { throwIfNoEntry: false })?.size > 0)) return false;
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  return !java.error && java.status === 0;
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** veraPDF を動かす (format は mrr か text)。spawnSync の結果を返す */
export function spawnVerapdf(dir, flavour, format, files) {
  return spawnSync('java', ['-cp', `${jarDir(dir)}${path.sep}*`, 'org.verapdf.apps.GreenfieldCliWrapper', '-f', flavour, '--format', format, ...(format === 'text' ? ['-v'] : []), ...files], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
}

/**
 * PDF を veraPDF の flavour (ua1・2b など) で検査し、PDF ごとに { name (veraPDF の報告の名前), compliant (合えば true、検査できなければ undefined),
 * rules ([{ clause (規格の節), test (検査の番号), failed (落ちた数), description }]), error (検査できなかった理由) } を返す。
 * veraPDF そのものを動かせなければ Error を投げる
 */
export function runVerapdf(dir, flavour, files) {
  const r = spawnVerapdf(dir, flavour, 'mrr', files);
  if (r.error || !/<report/.test(r.stdout))
    throw new Error(
      `veraPDF を動かせませんでした\n${(r.stderr ?? '')
        .split('\n')
        .filter((l) => !/^Picked up /.test(l))
        .join('\n')}`,
    );
  const out = [];
  for (const job of r.stdout.split('<job>').slice(1)) {
    const name = decode(/<name>([^<]*)<\/name>/.exec(job)?.[1] ?? '?');
    const rep = /<validationReport [^>]*isCompliant="(true|false)"[^>]*>/.exec(job);
    const ex = /<taskException[^>]*>[\s\S]*?<exceptionMessage>([^<]*)/.exec(job);
    if (!rep) {
      out.push({ name, compliant: undefined, rules: [], error: ex ? decode(ex[1]) : '検査できませんでした' });
      continue;
    }
    const rules = [...job.matchAll(/<rule [^>]*clause="([^"]*)" testNumber="([^"]*)" status="failed" failedChecks="(\d+)"[^>]*>\s*<description>([^<]*)<\/description>/g)].map(
      ([, clause, test, n, description]) => ({ clause, test, failed: Number(n), description: decode(description) }),
    );
    out.push({ name, compliant: rep[1] === 'true', rules });
  }
  return out;
}
