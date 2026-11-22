import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { badEntryName, checkTar, packTar, readTarEntries, unpackTar } from '../scripts/sampleTar.mjs';

/**
 * scripts/fetch-samples.mjs の --pack・--unpack の tar の確かめ (scripts/sampleTar.mjs)。
 * 細工した tar は、ここで Node で組み立てる (ネットワークを使わない)。展開は GNU tar を使うので、GNU tar の無い所では、展開の試しを飛ばす
 */

/** tar の見出し 1 つ (512 バイト)。形は既定で POSIX の ustar */
function header(name: string, type: string, size: number, o: { linkname?: string; mode?: number; uid?: number; prefix?: string; gnu?: boolean } = {}): Buffer {
  const h = Buffer.alloc(512);
  const put = (s: string, off: number, len: number) => Buffer.from(s, 'utf8').copy(h, off, 0, len);
  const num = (n: number, off: number, len: number) => put(n.toString(8).padStart(len - 1, '0') + '\0', off, len);
  put(name, 0, 100);
  num(o.mode ?? 0o644, 100, 8);
  num(o.uid ?? 0, 108, 8);
  num(0, 116, 8);
  num(size, 124, 12);
  num(0, 136, 12);
  h[156] = type.charCodeAt(0);
  put(o.linkname ?? '', 157, 100);
  if (o.gnu) put('ustar  \0', 257, 8);
  else put('ustar\x0000', 257, 8);
  if (o.prefix) put(o.prefix, 345, 155);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const x of h) sum += x;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

/** 中身を 512 バイトの区切りまで埋める */
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

type Item = { name: string; type?: string; data?: string; linkname?: string; mode?: number; uid?: number; prefix?: string; gnu?: boolean };

/** 項目を並べて tar にする (終わりの印の 0 の区切り 2 つまで) */
function tar(items: Item[]): Buffer {
  const parts: Buffer[] = [];
  for (const it of items) {
    const data = Buffer.from(it.data ?? '', 'utf8');
    parts.push(header(it.name, it.type ?? '0', data.length, it), pad(data));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

/** pax の見出しの 1 行 (長さは、その行の全体のバイト数) */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

const valid = (): Buffer =>
  tar([
    { name: 'manifest.json', data: '{"files":{}}' },
    { name: 'fo/', type: '5', mode: 0o755 },
    { name: 'fo/ref/a.pdf', data: '%PDF-1.4', mode: 0o4777, uid: 1234 },
    { name: 'css-print/CSS-Print-ja.pdf', data: '%PDF-1.7' },
  ]);

describe('tar の名前の決まり', () => {
  it('相対のパスだけを受け付ける', () => {
    expect(badEntryName('fo/ref/a.pdf')).toBeNull();
    expect(badEntryName('見本/例.pdf')).toBeNull();
    for (const n of ['', '/etc/passwd', '../x', 'a/../../x', 'a/..', './a', 'a//b', 'a/./b', 'a\\b', 'a\nb', 'a\0b']) expect(badEntryName(n), n).not.toBeNull();
  });
});

describe('tar の確かめ (展開しない)', () => {
  it('正当な tar の項目を読む', () => {
    expect(checkTar(valid())).toEqual([
      { name: 'manifest.json', type: 'file', size: 12 },
      { name: 'fo', type: 'dir', size: 0 },
      { name: 'fo/ref/a.pdf', type: 'file', size: 8 },
      { name: 'css-print/CSS-Print-ja.pdf', type: 'file', size: 8 },
    ]);
  });

  it('ustar の前置き・GNU の長い名前・pax の path を、名前に当てて読む', () => {
    const long = `${'d'.repeat(120)}/f.txt`;
    const b = tar([
      { name: 'b.txt', prefix: 'a', data: 'x' },
      { name: '././@LongLink', type: 'L', data: `${long}\0`, gnu: true },
      { name: long.slice(0, 99), data: 'y', gnu: true },
      { name: 'PaxHeaders/x', type: 'x', data: paxRecord('path', 'p/長い名前.txt') },
      { name: 'short', data: 'z' },
    ]);
    expect(checkTar(b).map((e) => e.name)).toEqual(['a/b.txt', long, 'p/長い名前.txt']);
  });

  const bad: [string, Item[]][] = [
    ['絶対パス', [{ name: '/tmp/kumiori-evil.txt', data: 'x' }]],
    ['..', [{ name: '../evil.txt', data: 'x' }]],
    ['途中の ..', [{ name: 'fo/../../evil.txt', data: 'x' }]],
    ['ustar の前置きの ..', [{ name: 'evil.txt', prefix: '..', data: 'x' }]],
    ['GNU の長い名前の ..', [{ name: '././@LongLink', type: 'L', data: '../evil.txt\0', gnu: true }, { name: 'ok.txt', data: 'x', gnu: true }]],
    ['pax の path の ..', [{ name: 'PaxHeaders/x', type: 'x', data: paxRecord('path', '../evil.txt') }, { name: 'ok.txt', data: 'x' }]],
    ['シンボリックリンク', [{ name: 'link', type: '2', linkname: '/etc' }, { name: 'link/evil.txt', data: 'x' }]],
    ['ハードリンク', [{ name: 'hard', type: '1', linkname: 'manifest.json' }]],
    ['文字の装置', [{ name: 'tty', type: '3' }]],
    ['ブロックの装置', [{ name: 'disk', type: '4' }]],
    ['FIFO', [{ name: 'fifo', type: '6' }]],
    ['全体の pax の見出し', [{ name: 'g', type: 'g', data: paxRecord('comment', 'x') }, { name: 'ok.txt', data: 'x' }]],
    ['同じ名前の重なり', [{ name: 'a.txt', data: 'x' }, { name: 'a.txt', data: 'y' }]],
    ['/ で終わるファイルの名前', [{ name: 'a/', data: '' }]],
  ];
  for (const [what, items] of bad) {
    it(`${what}を含む tar を断る`, () => {
      expect(() => checkTar(tar([{ name: 'ok.txt', data: 'ok' }, ...items]))).toThrow();
    });
  }

  it('チェックサムの合わない見出し・切れた tar・終わりの印の後の中身を断る', () => {
    const b = valid();
    b[0] ^= 1;
    expect(() => readTarEntries(b)).toThrow(/チェックサム/);
    expect(() => readTarEntries(valid().subarray(0, 512 + 100))).toThrow();
    const tail = Buffer.concat([valid(), header('late.txt', '0', 0)]);
    expect(() => readTarEntries(tail)).toThrow(/終わりの印の後/);
  });
});

const gnuTar = (() => {
  try {
    return /GNU tar/.test(execFileSync('tar', ['--version'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
})();

/** 絶対パスの試しの名前 (展開を断るので、ここには書かれない) */
const ABS_EVIL = path.join(os.tmpdir(), `kumiori-evil-abs-${process.pid}.txt`);

describe.skipIf(!gnuTar)('tar の展開 (GNU tar)', () => {
  let work: string;
  let dest: string;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-sampletar-'));
    dest = path.join(work, 'samples');
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  /** 展開先の下 (と、その外の work) にあるもの */
  const listAll = (dir: string): string[] =>
    fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/')).sort() : [];

  it('正当な包みを展開する。所有者・特別な権限のビットは tar のままにしない', () => {
    const entries = unpackTar(valid(), dest);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'fo', 'fo/ref/a.pdf', 'css-print/CSS-Print-ja.pdf']);
    expect(listAll(dest)).toEqual(['css-print', 'css-print/CSS-Print-ja.pdf', 'fo', 'fo/ref', 'fo/ref/a.pdf', 'manifest.json']);
    expect(fs.readFileSync(path.join(dest, 'fo/ref/a.pdf'), 'utf8')).toBe('%PDF-1.4');
    const st = fs.statSync(path.join(dest, 'fo/ref/a.pdf'));
    if (process.getuid) expect(st.uid).toBe(process.getuid());
    expect(st.mode & 0o7000).toBe(0);
  });

  for (const [what, items] of [
    ['絶対パス', [{ name: ABS_EVIL, data: 'x' }]],
    ['..', [{ name: '../evil.txt', data: 'x' }]],
    ['シンボリックリンク', [{ name: 'link', type: '2', linkname: '..' }, { name: 'link/evil.txt', data: 'x' }]],
    ['ハードリンク', [{ name: 'hard', type: '1', linkname: '../evil.txt' }]],
  ] as [string, Item[]][]) {
    it(`${what}を含む tar は、何も展開せずに断る`, () => {
      expect(() => unpackTar(tar([{ name: 'ok.txt', data: 'ok' }, ...items]), dest)).toThrow();
      expect(listAll(work)).toEqual([]);
      expect(fs.existsSync(ABS_EVIL)).toBe(false);
    });
  }

  it('展開先に既にあるシンボリックリンクを通しては書かない', () => {
    const outside = path.join(work, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(dest);
    fs.symlinkSync(outside, path.join(dest, 'fo'));
    expect(() => unpackTar(valid(), dest)).toThrow(/シンボリックリンク/);
    expect(listAll(outside)).toEqual([]);
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(false);
  });

  it('包む側は通常のファイルだけを入れ、包んだものは今どおり戻せる (GNU の長い名前を含む)', () => {
    const src = path.join(work, 'src');
    const long = `fo/zip/${'n'.repeat(110)}.zip`;
    for (const [f, d] of [['manifest.json', '{}'], ['fo/ref/a.pdf', 'pdf'], [long, 'zip']]) {
      fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
      fs.writeFileSync(path.join(src, f), d);
    }
    const names = ['manifest.json', 'fo/ref/a.pdf', long];
    const b = packTar(src, names);
    expect(checkTar(b).map((e) => [e.name, e.type])).toEqual(names.map((n) => [n, 'file']));
    unpackTar(b, dest);
    expect(fs.readFileSync(path.join(dest, long), 'utf8')).toBe('zip');
  });

  it('包む側は、シンボリックリンク・ディレクトリ・受け付けない名前を断る', () => {
    const src = path.join(work, 'src');
    fs.mkdirSync(path.join(src, 'fo'), { recursive: true });
    fs.writeFileSync(path.join(work, 'secret.txt'), 's');
    fs.symlinkSync(path.join(work, 'secret.txt'), path.join(src, 'link.pdf'));
    fs.symlinkSync(work, path.join(src, 'up'));
    expect(() => packTar(src, ['link.pdf'])).toThrow(/シンボリックリンク/);
    expect(() => packTar(src, ['up/secret.txt'])).toThrow(/シンボリックリンク/);
    expect(() => packTar(src, ['fo'])).toThrow(/通常のファイル/);
    expect(() => packTar(src, ['../secret.txt'])).toThrow(/\.\./);
    expect(() => packTar(src, ['-x'])).toThrow();
  });
});
