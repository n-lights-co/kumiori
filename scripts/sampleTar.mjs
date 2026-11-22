/**
 * sampleTar — scripts/fetch-samples.mjs の --pack・--unpack が扱う tar を、作るときと展開するときに確かめる。
 *
 * 包み (samples-NN.js) と、その SHA-256 を書いた samples-index.json は同じ置き場 (Artifact) にあるので、
 * SHA-256 で分かるのは包みが壊れていないことで、出どころではない。なので、展開する前に tar の中身を自分で確かめ、
 * 展開先 (既定で .cache/samples) の外に書けないこと、通常のファイルとディレクトリだけを展開することを守る。
 *
 * 自分で確かめること (GNU tar に頼らない):
 *  - tar の見出し (512 バイトの区切り) を読み、チェックサムを確かめ、種類が通常のファイル ('0'・'\0') とディレクトリ ('5') だけであること
 *    (シンボリックリンク・ハードリンク・装置ファイル・FIFO・GNU の疎なファイルなどは断る)。名前を長くする見出し (GNU の 'L'、pax の 'x') は、
 *    次の見出しの名前に当てて読む。全体に掛かる pax の見出し ('g')・リンク先を長くする見出し ('K') は断る
 *  - 名前が、相対のパスで、空の区切り・'.'・'..' を含まず、制御文字・'\' を含まず、UTF-8 として読めること。同じ名前が 2 度出ないこと
 *  - 終わりの印 (0 の区切り) の後が 0 だけであること
 *  - 自分の読んだ名前の並びが、GNU tar の `tar -tf` の並びと同じであること (読み方の食い違いで、確かめていない名前が展開されないため)
 *  - 展開先の中の、名前のたどる途中のディレクトリと、書く先に、既にシンボリックリンクが無いこと (リンクを通して外に書かないため)
 * GNU tar に頼ること:
 *  - 展開そのもの。`--no-same-owner`・`--no-same-permissions` を付けて、root で動かしても、tar の中の所有者・権限のままにせず、
 *    動かした人の所有で、umask に従った権限で書く
 *  - 重ねての守り: GNU tar は、名前の先頭の '/' を外し、'..' を含む名前を展開しない (上の確かめで、ここまで来ることは無い)
 *
 * --pack の側では、包む名前を同じ決まりで確かめ、どれも通常のファイル (シンボリックリンクでない) であることを確かめてから包み、
 * できた tar も上と同じに確かめる (通常のファイルだけで、名前の並びが包んだものと同じ)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BLOCK = 512;

/**
 * tar の中の名前として受け付けるか。受け付けないときは、その訳を返す
 * @param {string} name
 * @returns {string | null}
 */
export function badEntryName(name) {
  if (name === '') return '名前が空です';
  // 制御文字 (改行を含む) と '\' は、tar -tf の出力との突き合わせが崩れるのと、Windows の区切りと読まれるので断る
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return '制御文字か \\ を含みます';
  if (name.startsWith('/')) return '絶対パスです';
  const segs = name.split('/');
  for (const s of segs) {
    if (s === '' || s === '.') return '空の区切りか . を含みます';
    if (s === '..') return '.. を含みます';
  }
  return null;
}

/** 見出しの数の欄 (8 進の字。NUL・空白で終わる) を読む。GNU の 256 進 (先頭のビットが立つもの) は扱わない */
function octal(h, off, len) {
  const f = h.subarray(off, off + len);
  if (f[0] & 0x80) throw new Error('tar の数の欄が 256 進です (扱いません)');
  const s = f.toString('latin1').replace(/[\0 ]+$/, '').replace(/^ +/, '');
  if (!/^[0-7]*$/.test(s)) throw new Error('tar の数の欄が 8 進の字ではありません');
  return s === '' ? 0 : parseInt(s, 8);
}

/** NUL までの字を UTF-8 として読む (読めないものは断る) */
function cstr(b) {
  const end = b.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? b : b.subarray(0, end));
}

/**
 * tar を読み、項目 (名前・種類・大きさ) を並べる。形の崩れたものは例外にする
 * @param {Uint8Array} buf
 * @returns {{ name: string, type: string, size: number }[]}
 */
export function readTarEntries(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = [];
  let longName;
  let paxPath;
  let paxSize;
  let p = 0;
  for (;;) {
    if (p + BLOCK > b.length) throw new Error('tar の終わりの印がありません');
    const h = b.subarray(p, p + BLOCK);
    if (h.every((x) => x === 0)) {
      // 終わりの印。その後 (印の 2 つ目と、区切りの埋め) は 0 だけ
      if (!b.subarray(p).every((x) => x === 0)) throw new Error('tar の終わりの印の後に中身があります');
      if (longName !== undefined || paxPath !== undefined || paxSize !== undefined) throw new Error('tar の名前の見出しの後に項目がありません');
      return entries;
    }
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (sum !== octal(h, 148, 8)) throw new Error(`tar の見出しのチェックサムが合いません (${p} バイト目)`);
    const type = String.fromCharCode(h[156]);
    let size = octal(h, 124, 12);
    const dataStart = p + BLOCK;
    const next = () => dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'L' || type === 'x') {
      if (dataStart + size > b.length) throw new Error('tar が途中で切れています');
      const data = b.subarray(dataStart, dataStart + size);
      if (type === 'L') longName = cstr(data);
      else {
        // pax の見出し: 「長さ 空白 鍵=値 改行」の並び (POSIX.1-2008 の pax の節)。path と size だけを次の項目に当てる
        for (let q = 0; q < data.length; ) {
          const sp = data.indexOf(0x20, q);
          const len = sp < 0 ? NaN : Number(data.subarray(q, sp).toString('latin1'));
          if (!Number.isInteger(len) || len <= sp - q || q + len > data.length || data[q + len - 1] !== 0x0a) throw new Error('tar の pax の見出しが崩れています');
          const rec = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(sp + 1, q + len - 1));
          const eq = rec.indexOf('=');
          const key = rec.slice(0, eq);
          const value = rec.slice(eq + 1);
          if (key === 'path') paxPath = value;
          else if (key === 'size') paxSize = Number(value);
          else if (key.startsWith('GNU.sparse')) throw new Error('tar に疎なファイルがあります');
          q += len;
        }
      }
      p = next();
      continue;
    }
    if (paxSize !== undefined) size = paxSize;
    let name = paxPath ?? longName;
    if (name === undefined) {
      name = cstr(h.subarray(0, 100));
      // POSIX の ustar (印が "ustar\0") は、前置き (345〜500 バイト目) を名前の前に足す。GNU の形 (印が "ustar  \0") は、そこを別に使う
      if (h.subarray(257, 263).toString('latin1') === 'ustar\0') {
        const prefix = cstr(h.subarray(345, 500));
        if (prefix) name = `${prefix}/${name}`;
      }
    }
    longName = paxPath = paxSize = undefined;
    if (!Number.isSafeInteger(size) || size < 0 || dataStart + size > b.length) throw new Error('tar が途中で切れています');
    entries.push({ name, type, size });
    p = next();
  }
}

/**
 * tar を確かめ、展開してよい項目を返す。通常のファイルとディレクトリ以外の項目、受け付けない名前、同じ名前の重なりがあれば例外にする
 * @param {Uint8Array} buf
 * @returns {{ name: string, type: 'file' | 'dir', size: number }[]}
 */
export function checkTar(buf) {
  const seen = new Set();
  return readTarEntries(buf).map((e) => {
    let type;
    if (e.type === '0' || e.type === '\0') type = 'file';
    else if (e.type === '5') type = 'dir';
    else throw new Error(`tar に通常のファイルとディレクトリでない項目があります (種類 '${e.type === '\0' ? '\\0' : e.type}'): ${JSON.stringify(e.name)}`);
    // ディレクトリの名前は '/' で終わる。ファイルの名前が '/' で終わるもの (古い形でディレクトリと読まれる) は断る
    const name = type === 'dir' ? e.name.replace(/\/$/, '') : e.name;
    const bad = badEntryName(name);
    if (bad) throw new Error(`tar の中の名前を受け付けません (${bad}): ${JSON.stringify(e.name)}`);
    if (seen.has(name)) throw new Error(`tar の中に同じ名前が 2 度あります: ${JSON.stringify(name)}`);
    seen.add(name);
    return { name, type, size: e.size };
  });
}

/** GNU tar であることを確かめる (--quoting-style・--no-same-permissions などを使うため) */
function requireGnuTar() {
  const v = execFileSync('tar', ['--version'], { encoding: 'utf8' });
  if (!/GNU tar/.test(v.split('\n')[0])) throw new Error('GNU tar が要ります (tar --version が GNU tar ではありません)');
}

/** GNU tar の読んだ名前の並び (末尾の '/' は外す) */
function gnuTarNames(buf) {
  const out = execFileSync('tar', ['--quoting-style=literal', '-tf', '-'], { input: buf, maxBuffer: 2 ** 31 });
  return out.toString('utf8').split('\n').filter((s) => s !== '').map((s) => s.replace(/\/$/, ''));
}

/** 名前を、dir の下の区切りごとのパスに分ける (dir/a, dir/a/b, …) */
function prefixes(dir, name) {
  const segs = name.split('/');
  return segs.map((_, i) => path.join(dir, ...segs.slice(0, i + 1)));
}

/**
 * 確かめてから、tar を dir に展開する。確かめに通らなければ、何も書かずに例外にする
 * @param {Uint8Array} buf
 * @param {string} dir
 * @returns {{ name: string, type: 'file' | 'dir', size: number }[]} 展開した項目
 */
export function unpackTar(buf, dir) {
  requireGnuTar();
  const entries = checkTar(buf);
  const theirs = gnuTarNames(buf);
  const ours = entries.map((e) => e.name);
  if (theirs.length !== ours.length || theirs.some((n, i) => n !== ours[i])) throw new Error('tar の中の名前の読み方が GNU tar と食い違います');
  for (const e of entries) {
    for (const p of prefixes(dir, e.name)) {
      let st;
      try {
        st = fs.lstatSync(p);
      } catch {
        break; // ここから先はまだ無い (tar が作る)
      }
      if (st.isSymbolicLink()) throw new Error(`展開先にシンボリックリンクがあります (通して書かないため断ります): ${p}`);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-x', '--no-same-owner', '--no-same-permissions', '-f', '-', '-C', dir], { input: buf, maxBuffer: 2 ** 31 });
  return entries;
}

/**
 * dir の下の names (通常のファイル) を tar に包む。名前が決まりに合わないか、通常のファイルでないもの
 * (シンボリックリンク・ディレクトリなど。途中のディレクトリがシンボリックリンクのものも) があれば例外にする
 * @param {string} dir
 * @param {string[]} names
 * @returns {Buffer}
 */
export function packTar(dir, names) {
  requireGnuTar();
  for (const name of names) {
    const bad = badEntryName(name);
    if (bad) throw new Error(`包む名前を受け付けません (${bad}): ${JSON.stringify(name)}`);
    const ps = prefixes(dir, name);
    ps.forEach((p, i) => {
      const st = fs.lstatSync(p);
      const ok = i === ps.length - 1 ? st.isFile() : st.isDirectory();
      if (!ok) throw new Error(`包むものが通常のファイルではありません (${i === ps.length - 1 ? 'ファイル' : '途中のディレクトリ'}が${st.isSymbolicLink() ? 'シンボリックリンク' : '別の種類'}): ${p}`);
    });
  }
  // --no-recursion: 名前に挙げたものだけを入れる。-- の後は名前だけ (- で始まる名前を指定と読まない)
  const tar = execFileSync('tar', ['-cf', '-', '--no-recursion', '-C', dir, '--', ...names], { maxBuffer: 2 ** 31 });
  const entries = checkTar(tar);
  if (entries.length !== names.length || entries.some((e, i) => e.type !== 'file' || e.name !== names[i])) throw new Error('包んだ tar の中身が、包んだものと合いません');
  return tar;
}
