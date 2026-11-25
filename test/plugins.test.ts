/**
 * プラグイン (TypesetOptions.plugins。imageFormats.ts の KumioriPlugin) の公開の受け口のテスト:
 * プラグインの画像の形式で画像を読む・本体の道具を渡す・本体と一緒に配る形式 (draw.io の図) と一緒に動き、それより先に判定する・選択肢の検証・型の公開。
 * draw.io の図は本体の形式になった (IMG-34) ので、受け口を使う実例は、このテストの試しのプラグインと、test/cli.test.ts の --plugin のもの
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, PLUGIN_API_VERSION, typeset, walkAreaTree, type FontSpec, type ImageFormatContext, type KumioriPlugin } from '../src/index';
import { parseArgs } from '../src/cli';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (s: FontSpec) => path.join(fontDir, path.basename(s.urls.find((u) => !/^https:/.test(u)) ?? s.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(() => ensureFonts([...DEFAULT_FONTS.base]), 120000);

/** 試しのプラグイン: 中身が「BOX <幅> <高さ> <文字>」のファイルを、その大きさの四角にする。文字の幅を測り、URL の画像を取る */
function boxPlugin(seen: ImageFormatContext[] = [], color = '#ff0000'): KumioriPlugin {
  return {
    apiVersion: 1,
    name: 'box',
    imageFormats: [
      {
        name: 'box',
        mime: 'application/x-box',
        extensions: ['box'],
        sniff: (b) => new TextDecoder().decode(b.subarray(0, 4)) === 'BOX ',
        load: async (b, ctx) => {
          seen.push(ctx);
          const m = /^BOX (\d+) (\d+) (\S*)/.exec(new TextDecoder().decode(b));
          if (!m) return undefined;
          const tw = ctx.measureText?.(m[3], { family: 'Helvetica', size: 10, bold: false, italic: false });
          if (m[3].startsWith('http')) await ctx.fetchResource?.(m[3]);
          ctx.warn?.('箱のプラグインの知らせ');
          return {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${m[1]}" height="${m[2]}"><rect width="${m[1]}" height="${m[2]}" fill="${color}"/></svg>`,
            width: Number(m[1]),
            height: Number(m[2]),
            warnings: tw !== undefined && tw > Number(m[1]) ? ['文字が枠に収まらない'] : [],
          };
        },
      },
    ],
  };
}

describe('プラグイン (plugins)', () => {
  it('プラグインの形式で画像を読み、PDF に描く。拡張子の名前のファイルも画像として拾う。本体の道具 (文字の幅・時限・警告) を渡す', async () => {
    const seen: ImageFormatContext[] = [];
    const html = '<p><img src="a.box" style="width:40px"></p>';
    const r = await typeset(html, { loadFont, files: [{ name: 'a.box', data: 'BOX 40 20 WWWWWWWWWWWW' }], plugins: [boxPlugin(seen)], fetchTimeoutMs: 4321 });
    expect(seen).toHaveLength(1);
    expect(seen[0].fetchTimeoutMs).toBe(4321);
    // 警告の文の言語 (TypesetOptions.lang。既定は日本語)
    expect(seen[0].lang).toBe('ja');
    expect(typeof seen[0].fetch).toBe('function');
    // 文字の幅は本体の書体で測る (12 字の W は 40px を超える)
    expect(r.warnings).toContain('画像 a.box の一部を描画できません: 文字が枠に収まらない');
    expect(r.warnings).toContain('箱のプラグインの知らせ');
    // 画像の枠は、形式の決めた大きさの比 (40 × 20) で置き、描けない画像の仮の枠にしない
    const got: unknown[] = [];
    walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, a.missing ?? false, Math.round(a.width), Math.round(a.height)])));
    expect(got).toEqual([['a.box', false, 30, 15]]);
    expect(r.warnings.filter((w) => w.includes('読めない') || w.includes('見つかりません'))).toEqual([]);
  }, 60000);

  it('形式が URL の資源を取るときに onProgress が投げた誤りは、形式の読み込みに飲まれずに、返す Promise の失敗になる。その後は onProgress を呼ばない', async () => {
    const oops = new Error('進み具合の誤り');
    let after = 0;
    let thrown = false;
    const e = await typeset('<p><img src="a.box"></p>', {
      loadFont,
      files: [{ name: 'a.box', data: 'BOX 10 10 https://example.com/x.png' }],
      plugins: [boxPlugin()],
      resolveResource: async () => new Uint8Array([1, 2, 3]),
      onProgress: (p) => {
        if (thrown) after++;
        if (p.phase === 'resources') {
          thrown = true;
          throw oops;
        }
      },
    }).catch((x: unknown) => x);
    expect(thrown).toBe(true);
    expect(e).toBe(oops);
    expect(after).toBe(0);
  }, 60000);

  it('lang: \'en\' なら、プラグインに渡す言語も英語', async () => {
    const seen: ImageFormatContext[] = [];
    await typeset('<p><img src="a.box"></p>', { loadFont, lang: 'en', files: [{ name: 'a.box', data: 'BOX 10 10 x' }], plugins: [boxPlugin(seen)] });
    expect(seen[0].lang).toBe('en');
  }, 60000);

  it('プラグインが無ければ、その形式は画像として読まない', async () => {
    const r = await typeset('<p><img src="a.box"></p>', { loadFont, files: [{ name: 'a.box', data: 'BOX 40 20 x' }] });
    expect(r.warnings.some((w) => w.includes('a.box'))).toBe(true);
  }, 60000);

  it('図が URL で指す資源は、文書の画像と同じ決まり (resolveResource・fetchImages) で取る', async () => {
    const asked: string[] = [];
    const files = [{ name: 'a.box', data: 'BOX 10 10 https://example.com/x.png' }];
    await typeset('<p><img src="a.box"></p>', { loadFont, files, plugins: [boxPlugin()], resolveResource: (u) => (asked.push(u), 'x') });
    expect(asked).toContain('https://example.com/x.png');
    const refused = await typeset('<p><img src="a.box"></p>', { loadFont, files, plugins: [boxPlugin()], fetchImages: false });
    expect(refused.warnings).toContain('画像を取得しません (fetchImages): https://example.com/x.png');
  }, 60000);

  it('本体と一緒に配る形式 (draw.io の図) と一緒に動く。プラグインの形式を先に判定する。drawio: false でもプラグインは動く', async () => {
    const drawio = '<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="" style="rounded=0;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
    const html = '<p><img src="a.box"><img src="fig.drawio"></p>';
    const files = [
      { name: 'a.box', data: 'BOX 40 20 x' },
      { name: 'fig.drawio', data: drawio },
    ];
    const images = (r: Awaited<ReturnType<typeof typeset>>) => {
      const got: unknown[] = [];
      walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, a.missing ?? false])));
      return got;
    };
    // プラグインの箱と、本体の draw.io の図の両方を読む
    const both = await typeset(html, { loadFont, files, plugins: [boxPlugin()] });
    expect(images(both)).toEqual([['a.box', false], ['fig.drawio', false]]);
    // draw.io の図を読まない設定でも、プラグインの形式は読む (draw.io の図は読めない画像になる)
    const noDrawio = await typeset(html, { loadFont, files, plugins: [boxPlugin()], drawio: false });
    expect(images(noDrawio)).toEqual([['a.box', false], ['fig.drawio', true]]);
    // 同じファイルに当たるプラグインの形式は、本体の形式 (draw.io) より先に判定する (利用者が渡した形式で読む)
    const seen: string[] = [];
    const own: KumioriPlugin = {
      apiVersion: 1,
      name: 'my-drawio',
      imageFormats: [{ name: 'my-drawio', mime: 'application/x-my', extensions: ['drawio'], sniff: (b) => new TextDecoder().decode(b.subarray(0, 7)) === '<mxfile', load: async () => (seen.push('mine'), { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', width: 10, height: 10, warnings: [] }) }],
    };
    const mine = await typeset('<p><img src="fig.drawio"></p>', { loadFont, files, plugins: [own] });
    expect(seen).toEqual(['mine']);
    expect(images(mine)).toEqual([['fig.drawio', false]]);
  }, 60000);

  it('選択肢の検証: 配列・名前・受け口の版・画像の形式の形', async () => {
    expect(PLUGIN_API_VERSION).toBe(1);
    const bad = async (plugins: unknown) => expect(typeset('<p>x</p>', { plugins: plugins as never })).rejects.toThrow(TypeError);
    await bad({});
    await bad([null]);
    await bad([{ apiVersion: 1 }]);
    await bad([{ name: 'p' }]);
    await bad([{ apiVersion: 2, name: 'p' }]);
    await bad([{ apiVersion: 1, name: 'p', imageFormats: {} }]);
    await bad([{ apiVersion: 1, name: 'p', imageFormats: [{ name: 'f', mime: 'x', extensions: ['f'], sniff: () => false }] }]);
    await expect(typeset('<p>x</p>', { plugins: [{ apiVersion: 2, name: 'p' } as never] })).rejects.toThrow('apiVersion 2');
  });

  it('コマンドの引数: --plugin (何度でも) と、その前の --plugin に渡す --plugin-option', () => {
    const a = parseArgs(['a.html', '--plugin', './p.js', '--plugin-option', 'x=1', '--plugin-option', 'y=a=b', '--plugin', 'pkg']);
    expect(a.plugins).toEqual([
      { spec: './p.js', options: { x: '1', y: 'a=b' } },
      { spec: 'pkg', options: {} },
    ]);
    expect(() => parseArgs(['a.html', '--plugin-option', 'x=1'])).toThrow();
    expect(() => parseArgs(['a.html', '--plugin', 'p', '--plugin-option', 'x'])).toThrow();
  });
});
