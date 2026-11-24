/**
 * OS の書体を探す部品 (src/nodeSystemFonts.ts。kumiori/node の createSystemFonts・systemFontDirs)。
 * 手元の OS の書体に頼らないよう、試験の中で小さな書体を組み立て (test/sfntTestFont.ts)、一時のディレクトリを探す場所に渡す
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fontkit from '@pdf-lib/fontkit';
import { createSystemFonts, systemFontDirs } from '../src/node';
import { classifyFontKind, kindRank } from '../src/fontKind';
import { buildTestCollection, buildTestFont } from './sfntTestFont';

let tmp: string;
const write = (rel: string, data: Uint8Array | string) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
};
const cp = (...cps: number[]) => cps.map((c) => String.fromCodePoint(c));

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-sysfonts-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('systemFontDirs (OS の書体の場所)', () => {
  it('Windows: %WINDIR%\\Fonts と %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts', () => {
    expect(systemFontDirs({ WINDIR: 'D:\\Win', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toEqual(['D:\\Win\\Fonts', 'C:\\Users\\a\\AppData\\Local\\Microsoft\\Windows\\Fonts']);
    expect(systemFontDirs({}, 'win32', 'C:\\Users\\a')).toEqual(['C:\\Windows\\Fonts', 'C:\\Users\\a\\AppData\\Local\\Microsoft\\Windows\\Fonts']);
  });
  it('macOS: /System/Library/Fonts・/Library/Fonts・~/Library/Fonts', () => {
    expect(systemFontDirs({}, 'darwin', '/Users/a')).toEqual(['/System/Library/Fonts', '/Library/Fonts', '/Users/a/Library/Fonts']);
  });
  it('Linux: 設定のファイルが無ければ XDG の決まりの場所と ~/.fonts', () => {
    const env = { FONTCONFIG_FILE: path.join(tmp, 'none.conf'), XDG_DATA_HOME: '/h/data', XDG_DATA_DIRS: '/a:/b' };
    expect(systemFontDirs(env, 'linux', '/h')).toEqual(['/h/data/fonts', '/a/fonts', '/b/fonts', '/h/.fonts']);
    expect(systemFontDirs({ FONTCONFIG_FILE: path.join(tmp, 'none.conf') }, 'linux', '/h')).toEqual(['/h/.local/share/fonts', '/usr/local/share/fonts', '/usr/share/fonts', '/h/.fonts']);
  });
  it('Linux: fontconfig の設定の <dir> と <include> (prefix・~・ディレクトリの include・循環)', () => {
    const conf = write(
      'fc/fonts.conf',
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <!-- <dir>/commented</dir> -->
  <dir>/usr/share/fonts</dir>
  <dir prefix="xdg">fonts</dir>
  <dir>~/.fonts</dir>
  <dir prefix="relative">local&amp;more</dir>
  <include ignore_missing="yes">conf.d</include>
  <include ignore_missing="yes">missing.conf</include>
  <include>fonts.conf</include>
</fontconfig>`,
    );
    write('fc/conf.d/10-extra.conf', '<fontconfig><dir>/opt/fonts</dir><include>../fonts.conf</include></fontconfig>');
    write('fc/conf.d/README', '<fontconfig><dir>/not-read</dir></fontconfig>');
    write('fc/conf.d/x-late.conf', '<fontconfig><dir>/not-read-either</dir></fontconfig>');
    const dirs = systemFontDirs({ FONTCONFIG_FILE: conf, XDG_DATA_HOME: '/h/data' }, 'linux', '/h');
    expect(dirs).toEqual(['/usr/share/fonts', '/h/data/fonts', '/h/.fonts', path.join(tmp, 'fc', 'local&more'), '/opt/fonts']);
  });
  it('Linux: FONTCONFIG_PATH の fonts.conf', () => {
    write('fcpath/fonts.conf', '<fontconfig><dir>/from/path</dir></fontconfig>');
    expect(systemFontDirs({ FONTCONFIG_PATH: `/nowhere:${path.join(tmp, 'fcpath')}` }, 'linux', '/h')).toEqual(['/from/path']);
  });
});

describe('createSystemFonts (索引と書体の選び方)', () => {
  it('欠けた字を、なるべく少ない書体で覆う (貪欲法)。持たない字は返さない', async () => {
    write('greedy/a.ttf', buildTestFont({ family: 'Test A', chars: [0xf0001, 0xf0002] }));
    write('greedy/b.ttf', buildTestFont({ family: 'Test B', chars: [0xf0002, 0xf0003, 0xf0004] }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'greedy')] });
    const r = await src.find({ chars: cp(0xf0001, 0xf0002, 0xf0003, 0xf0004, 0xf0005) });
    expect(r.map((m) => [m.name, m.chars, m.embeddable])).toEqual([
      ['Test B (b.ttf)', cp(0xf0002, 0xf0003, 0xf0004), true],
      ['Test A (a.ttf)', cp(0xf0001), true],
    ]);
    // 書体の中身は fontkit で開け、字を持つ
    const fk = fontkit.create(new Uint8Array(await r[1].data()));
    expect(fk.hasGlyphForCodePoint(0xf0001)).toBe(true);
    expect(r[0].key).not.toBe(r[1].key);
    // maxFaces で返す書体の数を絞る (同じ字の数なので、パスの順で a.ttf)
    expect((await src.find({ chars: cp(0xf0001, 0xf0003), maxFaces: 1 })).map((m) => m.chars)).toEqual([cp(0xf0001)]);
    expect(await src.find({ chars: cp(0xf0009) })).toEqual([]);
  });

  it('名前は英語のファミリー名: 英語の nameID 1 を、英語でない nameID 16 より先にする', async () => {
    write('names/a.ttf', buildTestFont({ family: 'English Family', chars: [0xf0050], typographicFamily: { name: '日本語の名前', lang: 0x411 } }));
    write('names/b.ttf', buildTestFont({ family: 'Family One', chars: [0xf0051], typographicFamily: { name: 'Typographic', lang: 0x409 } }));
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'names')] }).find({ chars: cp(0xf0050, 0xf0051) });
    expect(r.map((m) => m.name).sort()).toEqual(['English Family (a.ttf)', 'Typographic (b.ttf)']);
  });

  it('索引の作り直し: 索引を作った後に書体のファイルが変わったら、読むのは誤りにし、次に探すときに索引を作り直す', async () => {
    const dir = path.join(tmp, 'rescan');
    write('rescan/a.ttf', buildTestFont({ family: 'Rescan A', chars: [0xf0060] }));
    const src = createSystemFonts({ dirs: [dir] });
    const [a] = await src.find({ chars: cp(0xf0060, 0xf0061) });
    expect(a.name).toBe('Rescan A (a.ttf)');
    // 書体を入れ直す (大きさが変わる) と、索引の書体は読めない
    write('rescan/a.ttf', buildTestFont({ family: 'Rescan A', chars: [0xf0060, 0xf0061] }));
    await expect(a.data()).rejects.toThrow(/changed|変わりました/);
    // 次に探すときは、作り直した索引で探す (入れ直した書体の字も見つかり、読める)
    const again = await src.find({ chars: cp(0xf0060, 0xf0061) });
    expect(again.map((m) => m.chars)).toEqual([cp(0xf0060, 0xf0061)]);
    expect((await again[0].data()).byteLength).toBeGreaterThan(0);
  });

  it('索引の作り直し: 索引を作った後に書体のファイルを消したら、読むのは誤りにし、次に探すときは消えた書体を選ばない', async () => {
    const dir = path.join(tmp, 'removed');
    write('removed/a.ttf', buildTestFont({ family: 'Removed A', chars: [0xf0062] }));
    write('removed/b.ttf', buildTestFont({ family: 'Removed B', chars: [0xf0062] }));
    const src = createSystemFonts({ dirs: [dir] });
    const [a] = await src.find({ chars: cp(0xf0062) });
    fs.rmSync(path.join(dir, path.basename(a.name.replace(/^.*\((.*)\)$/, '$1'))));
    await expect(a.data()).rejects.toThrow(/無くなりました|disappeared/);
    // 前は、作り直さずに、消えた書体を選び続けた
    const again = await src.find({ chars: cp(0xf0062) });
    expect(again.map((m) => m.name)).not.toContain(a.name);
    expect(again).toHaveLength(1);
    expect((await again[0].data()).byteLength).toBeGreaterThan(0);
  });

  it('索引は間をあけて作り、止める合図で待つのをやめる (作るのは続け、次に探すときに使う)', async () => {
    for (let i = 0; i < 300; i++) write(`slow/n${String(i).padStart(3, '0')}.txt`, 'x');
    write('slow/z.ttf', buildTestFont({ family: 'Slow Z', chars: [0xf0070] }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'slow')] });
    const ac = new AbortController();
    const p = src.find({ chars: cp(0xf0070), signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect((await src.find({ chars: cp(0xf0070) })).map((m) => m.name)).toEqual(['Slow Z (z.ttf)']);
  });

  it('cmap の format 4 も読む', async () => {
    write('fmt4/a.ttf', buildTestFont({ family: 'Test Fmt4', chars: [0xe001, 0xe005], cmapFormat: 4 }));
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'fmt4')] }).find({ chars: cp(0xe001, 0xe002, 0xe005) });
    expect(r.map((m) => m.chars)).toEqual([cp(0xe001, 0xe005)]);
  });

  it('TTC の中の書体を選び、その 1 つだけを取り出す', async () => {
    const ttc = buildTestCollection([buildTestFont({ family: 'Coll One', chars: [0xf0010] }), buildTestFont({ family: 'Coll Two', chars: [0xf0011] })]);
    write('ttc/c.ttc', ttc);
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'ttc')] }).find({ chars: cp(0xf0011) });
    expect(r.map((m) => m.name)).toEqual(['Coll Two (c.ttc #1)']);
    const fk = fontkit.create(new Uint8Array(await r[0].data())) as unknown as { familyName: string; hasGlyphForCodePoint(c: number): boolean };
    expect(fk.familyName).toBe('Coll Two');
    expect(fk.hasGlyphForCodePoint(0xf0011)).toBe(true);
  });

  it('埋め込めない書体 (fsType) は選ばず、知らせるためだけに返す', async () => {
    write('fstype/a-restricted.ttf', buildTestFont({ family: 'Restricted', chars: [0xf0020, 0xf0021], fsType: 0x0002 }));
    write('fstype/b-nosubset.ttf', buildTestFont({ family: 'No Subset', chars: [0xf0020, 0xf0021], fsType: 0x0100 }));
    write('fstype/c-print.ttf', buildTestFont({ family: 'Print', chars: [0xf0021], fsType: 0x0006 }));
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'fstype')] }).find({ chars: cp(0xf0020, 0xf0021) });
    // Restricted と Preview & Print を両方立てた書体は、緩い印に従って埋め込める
    expect(r.map((m) => [m.name, m.chars, m.embeddable])).toEqual([
      ['Print (c-print.ttf)', cp(0xf0021), true],
      ['Restricted (a-restricted.ttf)', cp(0xf0020), false],
    ]);
  });

  it('漢字は文書の言語に合う書体 (OS/2 の ulCodePageRange1) を先に。無ければ日本語', async () => {
    write('han/a-zh.ttf', buildTestFont({ family: 'Han SC', chars: [0x4e00], codePages: 1 << 18 }));
    write('han/b-ja.ttf', buildTestFont({ family: 'Han JP', chars: [0x4e00], codePages: 1 << 17 }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'han')] });
    expect((await src.find({ chars: cp(0x4e00) }))[0].name).toBe('Han JP (b-ja.ttf)');
    expect((await src.find({ chars: cp(0x4e00), lang: 'ja-JP' }))[0].name).toBe('Han JP (b-ja.ttf)');
    expect((await src.find({ chars: cp(0x4e00), lang: 'zh-CN' }))[0].name).toBe('Han SC (a-zh.ttf)');
  });

  it('同じ字の数なら、太さが 400 に近い・傾いていない・幅が普通の書体、次にパスの順', async () => {
    write('shape/a-bold.ttf', buildTestFont({ family: 'Shape Bold', chars: [0xf0030], weight: 700 }));
    write('shape/b-italic.ttf', buildTestFont({ family: 'Shape Italic', chars: [0xf0030], italic: true }));
    write('shape/c-regular.ttf', buildTestFont({ family: 'Shape Regular', chars: [0xf0030] }));
    write('shape/d-regular.ttf', buildTestFont({ family: 'Shape Regular 2', chars: [0xf0030] }));
    expect((await createSystemFonts({ dirs: [path.join(tmp, 'shape')] }).find({ chars: cp(0xf0030) }))[0].name).toBe('Shape Regular (c-regular.ttf)');
  });

  it('リンクの循環で止まらず、同じ実体のファイルは 1 度だけ数える。ふつうのファイルだけを開く', async () => {
    write('links/real/a.ttf', buildTestFont({ family: 'Linked', chars: [0xf0040] }));
    fs.symlinkSync(path.join(tmp, 'links'), path.join(tmp, 'links/real/loop'));
    fs.symlinkSync(path.join(tmp, 'links/real/a.ttf'), path.join(tmp, 'links/b.ttf'));
    let fifo = false;
    try {
      execFileSync('mkfifo', [path.join(tmp, 'links/pipe.ttf')]);
      fifo = true;
    } catch {
      // mkfifo の無い環境では、FIFO の確かめを飛ばす
    }
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'links'), path.join(tmp, 'links/real')] }).find({ chars: cp(0xf0040) });
    expect(r.map((m) => m.name)).toEqual(['Linked (a.ttf)']);
    if (fifo) expect(fs.statSync(path.join(tmp, 'links/pipe.ttf')).isFIFO()).toBe(true);
  });

  it('壊れたファイル・書体でないファイル・輪郭の無い書体は飛ばす', async () => {
    write('broken/a.ttf', 'not a font at all');
    write('broken/b.ttf', new Uint8Array([0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0]));
    write('broken/c.otf', buildTestFont({ family: 'Fine', chars: [0xf0050] }));
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'broken'), path.join(tmp, 'no-such-dir')] }).find({ chars: cp(0xf0050) });
    expect(r.map((m) => m.name)).toEqual(['Fine (c.otf)']);
  });

  it('maxFiles より多いファイルは探さない (名前の順)', async () => {
    write('many/a.ttf', buildTestFont({ family: 'Many A', chars: [0xf0060] }));
    write('many/b.ttf', buildTestFont({ family: 'Many B', chars: [0xf0061] }));
    const r = await createSystemFonts({ dirs: [path.join(tmp, 'many')], maxFiles: 1 }).find({ chars: cp(0xf0060, 0xf0061) });
    expect(r.map((m) => m.name)).toEqual(['Many A (a.ttf)']);
    expect(() => createSystemFonts({ maxFiles: -1 })).toThrow(TypeError);
  });

  it('索引を作った後にファイルが変わったら、中身を読まない。索引は部品ごとに 1 度だけ作る', async () => {
    const file = write('changed/a.ttf', buildTestFont({ family: 'Changing', chars: [0xf0070] }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'changed')] });
    const [m] = await src.find({ chars: cp(0xf0070) });
    // 後から足した書体は、同じ部品では探さない (索引は 1 度だけ作る)
    write('changed/b.ttf', buildTestFont({ family: 'Later', chars: [0xf0071] }));
    expect(await src.find({ chars: cp(0xf0071) })).toEqual([]);
    fs.writeFileSync(file, buildTestFont({ family: 'Changing', chars: [0xf0070, 0xf0072] }));
    await expect(m.data()).rejects.toThrow(/changed|変わり/);
  });

  it('dirs は文字列の配列。文字列そのもの・字でない値・空の文字列は TypeError。相対の道は、部品を作ったときのカレントディレクトリから', async () => {
    // 文字列を渡すと 1 字ずつに分かれ、ルート (/) から探してしまうので、配列でなければ誤りにする
    expect(() => createSystemFonts({ dirs: '/usr/share/fonts' as never })).toThrow(TypeError);
    expect(() => createSystemFonts({ dirs: '/usr/share/fonts' as never })).toThrow(/dirs/);
    expect(() => createSystemFonts({ dirs: [1] as never })).toThrow(TypeError);
    expect(() => createSystemFonts({ dirs: [''] })).toThrow(TypeError);
    expect(() => createSystemFonts({ dirs: null as never })).toThrow(TypeError);
    expect(() => createSystemFonts(null as never)).toThrow(TypeError);
    expect(() => createSystemFonts('/usr/share/fonts' as never)).toThrow(TypeError);
    expect(() => createSystemFonts({ maxFiles: '3' as never })).toThrow(TypeError);
    // undefined は省略と同じ。空の配列は、どこも探さない
    expect(() => createSystemFonts({ dirs: undefined })).not.toThrow();
    expect(await createSystemFonts({ dirs: [] }).find({ chars: cp(0xf0090) })).toEqual([]);
    write('relative/a.ttf', buildTestFont({ family: 'Relative', chars: [0xf0090] }));
    const rel = path.relative(process.cwd(), path.join(tmp, 'relative'));
    expect(path.isAbsolute(rel)).toBe(false);
    expect((await createSystemFonts({ dirs: [rel] }).find({ chars: cp(0xf0090) })).map((m) => m.name)).toEqual(['Relative (a.ttf)']);
  });

  it('止める合図を渡せば、探さずに失敗する', async () => {
    const c = new AbortController();
    c.abort();
    await expect(createSystemFonts({ dirs: [tmp] }).find({ chars: cp(0x41), signal: c.signal })).rejects.toThrow();
  });
});

describe('書体の種類 (明朝・ゴシック) を合わせる', () => {
  it('classifyFontKind: PANOSE → sFamilyClass → 名前の順に決める', () => {
    expect(classifyFontKind({ panose: [2, 2, 6, 9], familyClass: 0x0800 })).toBe('serif');
    expect(classifyFontKind({ panose: [2, 11, 6, 4] })).toBe('sans');
    expect(classifyFontKind({ panose: [2, 15] })).toBe('sans');
    expect(classifyFontKind({ panose: [3, 1] })).toBe('other');
    expect(classifyFontKind({ panose: [5] })).toBe('other');
    // PANOSE が Any・No Fit なら sFamilyClass
    expect(classifyFontKind({ panose: [0, 0], familyClass: 0x0800 })).toBe('sans');
    expect(classifyFontKind({ panose: [2, 1], familyClass: 0x0105 })).toBe('serif');
    expect(classifyFontKind({ familyClass: 0x0700 })).toBe('serif');
    expect(classifyFontKind({ familyClass: 0x0a00 })).toBe('other');
    // どちらも決めなければ名前
    expect(classifyFontKind({ family: 'MS Mincho' })).toBe('serif');
    expect(classifyFontKind({ family: '游明朝' })).toBe('serif');
    expect(classifyFontKind({ family: 'Noto Serif CJK JP' })).toBe('serif');
    expect(classifyFontKind({ family: 'Noto Sans CJK JP' })).toBe('sans');
    expect(classifyFontKind({ family: 'Microsoft Sans Serif' })).toBe('sans');
    expect(classifyFontKind({ family: 'Hiragino Kaku Gothic ProN' })).toBe('sans');
    expect(classifyFontKind({ family: 'Batang' })).toBe('serif');
    expect(classifyFontKind({ family: 'Test Font' })).toBe('unknown');
  });

  it('kindRank: 同じ種類 → unknown → ほかの種類 → other。求めが unknown なら serif の側', () => {
    expect(['serif', 'unknown', 'sans', 'other'].map((k) => kindRank('serif', k as never))).toEqual([0, 1, 2, 3]);
    expect(['sans', 'unknown', 'serif', 'other'].map((k) => kindRank('sans', k as never))).toEqual([0, 1, 2, 3]);
    expect(kindRank('unknown', 'serif')).toBe(0);
  });

  it('種類ごとに選び、合う書体が無い字は unknown → ほかの種類で補う。maxFaces は種類に 1 つずつ割り当てる', async () => {
    write('kinds/a-serif.ttf', buildTestFont({ family: 'Kind Serif', chars: [0xf0080], panose: [2, 2] }));
    write('kinds/b-sans.ttf', buildTestFont({ family: 'Kind Sans', chars: [0xf0080], familyClass: 0x0800 }));
    write('kinds/c-plain.ttf', buildTestFont({ family: 'Kind Plain', chars: [0xf0080, 0xf0081] }));
    write('kinds/d-script.ttf', buildTestFont({ family: 'Kind Script', chars: [0xf0082], panose: [3] }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'kinds')] });
    const r = await src.find({ chars: cp(0xf0080, 0xf0081, 0xf0082) });
    expect(r.map((m) => [m.name, m.chars, m.kind, m.forKind])).toEqual([
      ['Kind Serif (a-serif.ttf)', cp(0xf0080), 'serif', 'serif'],
      ['Kind Sans (b-sans.ttf)', cp(0xf0080), 'sans', 'sans'],
      ['Kind Plain (c-plain.ttf)', cp(0xf0081), 'unknown', 'serif'],
      ['Kind Script (d-script.ttf)', cp(0xf0082), 'other', 'serif'],
    ]);
    expect((await src.find({ chars: cp(0xf0080, 0xf0081), maxFaces: 2 })).map((m) => m.name)).toEqual(['Kind Serif (a-serif.ttf)', 'Kind Sans (b-sans.ttf)']);
    // 求める種類を 1 つにすれば、その種類の書体を先に
    expect((await src.find({ chars: cp(0xf0080), kinds: ['sans'] })).map((m) => m.name)).toEqual(['Kind Sans (b-sans.ttf)']);
    // sans の書体が無ければ、sans の求めは unknown → serif の書体で補う
    write('kinds2/a-serif.ttf', buildTestFont({ family: 'Only Serif', chars: [0xf0080], panose: [2, 2] }));
    write('kinds2/b-plain.ttf', buildTestFont({ family: 'Only Plain', chars: [0xf0080] }));
    const r2 = await createSystemFonts({ dirs: [path.join(tmp, 'kinds2')] }).find({ chars: cp(0xf0080), kinds: ['sans'] });
    expect(r2.map((m) => [m.name, m.forKind])).toEqual([['Only Plain (b-plain.ttf)', 'sans']]);
  });

  it('charsByKind を渡せば、種類ごとに、その種類の文脈に出る字だけを探す', async () => {
    write('bykind/a-serif.ttf', buildTestFont({ family: 'By Serif', chars: [0xf00a0, 0xf00a1], panose: [2, 2] }));
    write('bykind/b-sans.ttf', buildTestFont({ family: 'By Sans', chars: [0xf00a0, 0xf00a1], familyClass: 0x0800 }));
    const src = createSystemFonts({ dirs: [path.join(tmp, 'bykind')] });
    const r = await src.find({ chars: cp(0xf00a0, 0xf00a1), kinds: ['serif', 'sans'], charsByKind: { serif: cp(0xf00a0), sans: cp(0xf00a1) } });
    expect(r.map((m) => [m.name, m.chars, m.forKind])).toEqual([
      ['By Serif (a-serif.ttf)', cp(0xf00a0), 'serif'],
      ['By Sans (b-sans.ttf)', cp(0xf00a1), 'sans'],
    ]);
    // 求める種類だけを探す (serif の文脈にしか無ければ、sans の書体を返さない)
    expect((await src.find({ chars: cp(0xf00a0), kinds: ['serif'], charsByKind: { serif: cp(0xf00a0) } })).map((m) => m.name)).toEqual(['By Serif (a-serif.ttf)']);
    // chars に無い字は、charsByKind にあっても探さない
    expect(await src.find({ chars: cp(0xf00a0), kinds: ['sans'], charsByKind: { sans: cp(0xf00a1) } })).toEqual([]);
  });
});
