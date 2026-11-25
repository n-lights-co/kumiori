/**
 * コマンドの出力の上書きの検査 (src/cli.ts の checkOutputFiles) と、同じ入力のまとめ (planJobs)、
 * PDF を一時のファイルに流して書いて名前を替える所 (streamTarget・streamOutput) の単体の試験
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkOutputFiles, inputPaths, planJobs, streamOutput, streamTarget } from '../src/cli';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-guard-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('出力の上書きの検査', () => {
  it('入力の実体 (i ノード) は、確かめるたびに取り直す (名前の変更で保存した後、前の i ノードの出力を誤りにしない)', () => {
    const input = path.join(dir, 'w.html');
    fs.writeFileSync(input, '<p>1</p>');
    inputPaths.push(input);
    try {
      // 出力が、入力の (保存の前の) i ノードを持つ: ハードリンクで作る (名前の変更の保存の後、解放された番号を新しい出力が受け継いだのと同じ)
      const out = path.join(dir, 'w-2.svg');
      fs.linkSync(input, out);
      // 保存の前は、出力は入力の実体なので誤り
      expect(() => checkOutputFiles([out], input, new Set())).toThrow(/上書きしません|not overwritten/);
      // 新しいファイルに書いて名前を変える保存 (入力の i ノードが変わる)
      fs.writeFileSync(`${input}.tmp`, '<p>2</p>');
      fs.renameSync(`${input}.tmp`, input);
      // 前は、起動のときに覚えた入力の i ノードと比べていたので、ここでも誤りになった
      expect(() => checkOutputFiles([out], input, new Set())).not.toThrow();
    } finally {
      inputPaths.splice(inputPaths.indexOf(input), 1);
    }
  });
});

describe('同じ入力のまとめ', () => {
  it('まとめるのは、ディレクトリの実体と名前が同じときだけ (別のディレクトリのシンボリックリンク・ハードリンクの別名は別の入力)', () => {
    const d1 = path.join(dir, 'd1');
    const d2 = path.join(dir, 'd2');
    const d3 = path.join(dir, 'd3');
    for (const d of [d1, d2, d3]) fs.mkdirSync(d);
    const a = path.join(d1, 'a.html');
    fs.writeFileSync(a, '<p>a</p>');
    fs.symlinkSync(path.join('..', 'd1', 'a.html'), path.join(d2, 'a.html'));
    fs.linkSync(a, path.join(d3, 'a.html'));
    const notes: string[] = [];
    const jobs = planJobs({ inputs: [a, path.join(d2, 'a.html'), path.join(d3, 'a.html')], watch: false }, undefined, undefined, notes);
    // 前は、実体 (realpath・i ノード) が同じなので 1 つにまとめ、d2・d3 の隣には書かなかった
    expect(jobs.map((j) => j.output)).toEqual([path.join(d1, 'a.pdf'), path.join(d2, 'a.pdf'), path.join(d3, 'a.pdf')]);
    expect(notes).toEqual([]);
    // 同じディレクトリの同じ名前 (書き方の違い) は、まとめる
    const same = planJobs({ inputs: [a, path.join(d1, '.', 'a.html'), path.join(d2, '..', 'd1', 'a.html')], watch: false }, undefined, undefined, notes);
    expect(same.map((j) => j.output)).toEqual([path.join(d1, 'a.pdf')]);
    expect(notes.length).toBe(2);
  });
});

describe('一時のファイルに流して書き、名前を替える', () => {
  const parts = (d: string) => fs.readdirSync(d).filter((n) => n.includes('.part-'));
  it('書き終えたら名前を替える。前のファイルの許可の印を写す', async () => {
    const d = fs.mkdtempSync(path.join(dir, 's-'));
    const out = path.join(d, 'o.pdf');
    fs.writeFileSync(out, 'old');
    fs.chmodSync(out, 0o640);
    const r = await streamOutput(out, async (write) => {
      write(new TextEncoder().encode('ab'));
      // 書いている間は、前のファイルのまま
      expect(fs.readFileSync(out, 'utf8')).toBe('old');
      write(new TextEncoder().encode('c'));
      return 7;
    });
    expect(r).toBe(7);
    expect(fs.readFileSync(out, 'utf8')).toBe('abc');
    expect(fs.statSync(out).mode & 0o777).toBe(0o640);
    expect(parts(d)).toEqual([]);
  });

  it('書いた量が holdBytes を超えるまでは一時のファイルを作らず、合図の受け手も置かない (組んでいる間の Ctrl+C がすぐ止まるように)', async () => {
    const d = fs.mkdtempSync(path.join(dir, 's-'));
    const out = path.join(d, 'o.pdf');
    // 前の試験の受け手が外れるのを待つ (受け手は、書き終えた次の回りで外す)
    await new Promise((r) => setImmediate(r));
    const before = process.listenerCount('SIGINT');
    const seen: Array<[number, number]> = [];
    await streamOutput(
      out,
      async (write) => {
        // 書き出し側が塊を使い回しても、持っている塊は変わらない
        const head = new Uint8Array([1, 2, 3]);
        await write(head);
        head.fill(9);
        seen.push([parts(d).length, process.listenerCount('SIGINT') - before]);
        await write(new Uint8Array(8));
        seen.push([parts(d).length, process.listenerCount('SIGINT') - before]);
      },
      () => {},
      50,
      8,
    );
    // 3 バイトは持つ (一時のファイルも受け手も無い)。3 + 8 バイトで 8 を超えたので、一時のファイルを作り、受け手を置く
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect([...fs.readFileSync(out)]).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parts(d)).toEqual([]);
  });

  it('失敗したら一時のファイルを消し、前のファイルを残す (名前を替える前の確かめの誤りも)', async () => {
    const d = fs.mkdtempSync(path.join(dir, 's-'));
    const out = path.join(d, 'o.pdf');
    fs.writeFileSync(out, 'old');
    await expect(streamOutput(out, async (write) => (write(new Uint8Array([1])), Promise.reject(new Error('止めた'))))).rejects.toThrow('止めた');
    await expect(
      streamOutput(
        out,
        async () => 1,
        () => {
          throw new Error('読むファイル');
        },
      ),
    ).rejects.toThrow('読むファイル');
    expect(fs.readFileSync(out, 'utf8')).toBe('old');
    expect(parts(d)).toEqual([]);
  });

  it('名前を替える先: まだ無いファイルとふつうのファイル。シンボリックリンク (/dev/stdout も) とふつうのファイルでないものは流さない', () => {
    const d = fs.mkdtempSync(path.join(dir, 's-'));
    const real = path.join(d, 'real.pdf');
    fs.writeFileSync(real, 'x');
    fs.symlinkSync('real.pdf', path.join(d, 'link.pdf'));
    expect(streamTarget(path.join(d, 'new.pdf'))).toBe(path.join(d, 'new.pdf'));
    expect(streamTarget(real)).toBe(real);
    expect(streamTarget(path.join(d, 'link.pdf'))).toBeUndefined();
    expect(streamTarget(d)).toBeUndefined();
    fs.symlinkSync('missing.pdf', path.join(d, 'dangling.pdf'));
    expect(streamTarget(path.join(d, 'dangling.pdf'))).toBeUndefined();
    for (const dev of ['/dev/null', '/dev/stdout']) if (fs.existsSync(dev)) expect(streamTarget(dev)).toBeUndefined();
    // 一時のファイルを作れない所 (名前が長すぎる・ディレクトリが無い) は、流さずに前のとおり直に書く。確かめに作ったファイルは残さない
    const long = path.join(d, `${'a'.repeat(250)}.pdf`);
    expect(streamTarget(long)).toBeUndefined();
    expect(streamTarget(path.join(d, 'nodir', 'o.pdf'))).toBeUndefined();
    expect(parts(d)).toEqual([]);
  });

  it('確かめのファイルを作れたが消せない (Windows の EBUSY など) ときも、誤りにせず、流して書く先として返す', () => {
    const d = fs.mkdtempSync(path.join(dir, 'busy-'));
    const orig = fs.rmSync;
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (/\.part-[0-9a-f]+$/.test(String(p))) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return orig(p, o);
    });
    try {
      // 前は、消せない誤りが投げられて、その入力の変換が失敗した
      expect(streamTarget(path.join(d, 'o.pdf'))).toBe(path.join(d, 'o.pdf'));
      // 待って消し直す (maxRetries) を頼んだ
      expect(spy.mock.calls.some(([, o]) => (o as { maxRetries?: number } | undefined)?.maxRetries === 3)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('合図で止めたときに一時のファイルが残る窓が無い', () => {
  afterEach(() => vi.restoreAllMocks());
  // 受け手は次の回りで外すので、前の試験の受け手が外れるのを待ってから数える
  beforeEach(() => new Promise((r) => setImmediate(r)));

  it('流せるかの確かめ (streamTarget) は、実際に作って消し、その間も合図の受け手を置いている (受け手は次の回りで外す)', async () => {
    const d = fs.mkdtempSync(path.join(dir, 'w-'));
    const before = process.listenerCount('SIGTERM');
    const atOpen: number[] = [];
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).includes('.part-')) atOpen.push(process.listenerCount('SIGTERM'));
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    expect(streamTarget(path.join(d, 'o.pdf'))).toBe(path.join(d, 'o.pdf'));
    expect(atOpen).toEqual([before + 1]);
    expect(fs.readdirSync(d)).toEqual([]);
    await new Promise((r) => setImmediate(r));
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('ディレクトリに書けても一時のファイルを作れない所 (ACL・短い NAME_MAX など) では流さない', () => {
    const d = fs.mkdtempSync(path.join(dir, 'w-'));
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).includes('.part-')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    expect(streamTarget(path.join(d, 'o.pdf'))).toBeUndefined();
  });

  it('一時のファイルを開く前に、合図の受け手を置いている', async () => {
    const d = fs.mkdtempSync(path.join(dir, 'w-'));
    const before = process.listenerCount('SIGTERM');
    let atOpen = -1;
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).includes('.part-')) atOpen = process.listenerCount('SIGTERM');
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    await streamOutput(path.join(d, 'o.pdf'), async (write) => void (await write(new Uint8Array([1]))));
    // 確かめ (streamTarget) を通らずに書くので、受け手は一時のファイルを開く前に置いたもの
    expect(atOpen).toBe(before + 1);
    await new Promise((r) => setImmediate(r));
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
