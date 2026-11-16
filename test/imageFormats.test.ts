import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { AssetStore, IMAGE_EXTENSIONS, looksLikeImage, mentionedFiles } from '../src/assets';
import { formatExtensions, formatOf, formatsOf, IMAGE_FORMATS, type ImageFormat, type ImageFormatContext } from '../src/imageFormats';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * 試しの形式: 中身が「BOX <幅> <高さ> <文字>」なら、その大きさの四角と文字の SVG にする。
 * 文字の幅は ctx.measureText で測り、color (プラグインの選択肢。作るときに渡す) で塗る。「BOX」で始まって読めなければ undefined
 */
function boxFormat(calls: Array<{ ctx: ImageFormatContext }> = [], color: () => string = () => '#000000'): ImageFormat {
  return {
    name: 'box',
    mime: 'application/x-box',
    extensions: ['box'],
    sniff: (b) => new TextDecoder().decode(b.subarray(0, 4)) === 'BOX ',
    load: async (b, ctx) => {
      calls.push({ ctx });
      const m = /^BOX (\d+) (\d+) (.*)$/.exec(new TextDecoder().decode(b));
      if (!m) return undefined;
      const [w, h] = [Number(m[1]), Number(m[2])];
      const tw = ctx.measureText?.(m[3], { family: 'Helvetica', size: 10, bold: false, italic: false }) ?? 0;
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color()}"/><rect width="${tw}" height="1" fill="#fff"/></svg>`,
        width: w,
        height: h,
        warnings: tw > w ? ['文字が枠に収まらない'] : [],
      };
    },
  };
}

describe('本体の外の画像の形式 (imageFormats.ts)', () => {
  it('本体と一緒に配る形式は、draw.io の図 (drawio: false なら無い)', () => {
    expect(IMAGE_FORMATS.map((f) => f.name)).toEqual(['draw.io']);
    expect(formatExtensions()).toEqual(['drawio', 'dio']);
    expect(formatsOf(undefined, false)).toEqual([]);
    expect(formatsOf(undefined)).toBe(IMAGE_FORMATS);
    // 選択肢のオブジェクトごとに形式を作り、同じオブジェクトなら同じ形式 (図形ライブラリの登録所を使い回す)
    const o = { fetchStencils: false };
    expect(formatsOf(undefined, o)[0]).toBe(formatsOf(undefined, o)[0]);
    expect(formatsOf(undefined, o)[0]).not.toBe(IMAGE_FORMATS[0]);
  });

  it('形式は中身で判定する (判定が投げる形式は当たらないとみなす)', () => {
    const throwing: ImageFormat = { ...boxFormat(), name: 'bad', sniff: () => { throw new Error('x'); } };
    const box = boxFormat();
    expect(formatOf(enc('BOX 1 1 a'), [throwing, box])).toBe(box);
    expect(formatOf(enc('<svg/>'), [box])).toBeUndefined();
    expect(formatExtensions([box])).toEqual(['box']);
  });

  it('形式が読み込んだ SVG を、形式の決めた大きさの画像にする。本体の道具を渡し、警告は notes にする', async () => {
    const calls: Array<{ ctx: ImageFormatContext }> = [];
    const assets = new AssetStore({
      parseXml: parse,
      formats: [boxFormat(calls, () => '#ff0000')],
      formatContext: { measureText: (t, ft) => t.length * ft.size, fetchTimeoutMs: 1234 },
    });
    const a = await assets.addBlob('a.box', new Blob([enc('BOX 40 20 abcde')]));
    expect(a).toMatchObject({ mime: 'image/svg+xml', width: 40, height: 20, notes: ['文字が枠に収まらない'], formatSource: { format: 'box' } });
    const svg = new TextDecoder().decode(a!.bytes);
    expect(svg).toContain('fill="#ff0000"');
    // 文字の幅は渡した道具で測る (5 字 × 10)
    expect(svg).toContain('<rect width="50" height="1"');
    expect(calls[0].ctx.fetchTimeoutMs).toBe(1234);
    // 読めない中身 (形式が undefined を返す・投げる) は画像にしない
    expect(await assets.addBlob('b.box', new Blob([enc('BOX x')]))).toBeUndefined();
    const failing = new AssetStore({ parseXml: parse, formats: [{ ...boxFormat(), load: () => Promise.reject(new Error('x')) }] });
    expect(await failing.addBlob('c.box', new Blob([enc('BOX 1 1 a')]))).toBeUndefined();
  });

  it('図形にできない SVG は、形式の大きさの仮の枠にする (Node では警告に出す)', async () => {
    const fmt: ImageFormat = { ...boxFormat(), load: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', width: 30, height: 10, warnings: [] }) };
    const assets = new AssetStore({ parseXml: () => { throw new Error('no'); }, formats: [fmt] });
    const a = await assets.addBlob('a.box', new Blob([enc('BOX 1 1 a')]));
    expect(a).toMatchObject({ mime: 'application/x-box', width: 30, height: 10, drawable: false, unsupported: 'box' });
  });

  it('形式の選択肢が変わったら、元の中身から登録し直す (画面の手順)', async () => {
    const opts = { box: { color: '#ff0000' } };
    const assets = new AssetStore({ parseXml: parse, formats: [boxFormat([], () => opts.box.color)] });
    const blob = new Blob([enc('BOX 10 10 a')]);
    await assets.addBlob('a.box', blob);
    opts.box = { color: '#0000ff' };
    await assets.addBlob('a.box', blob);
    expect(new TextDecoder().decode(assets.get('a.box')!.bytes)).toContain('fill="#0000ff"');
  });

  it('元の画像を登録し直す・除くと、fragment の付いた参照の画像も捨てる (画面で、形式の選択肢を変えた・図を開き直した)', async () => {
    const opts = { color: '#ff0000' };
    const assets = new AssetStore({ parseXml: parse, formats: [boxFormat([], () => opts.color)] });
    const blob = new Blob([enc('BOX 10 10 a')]);
    await assets.addBlob('fig/a.box', blob);
    expect(await assets.addFragment('fig/a.box#p2')).toBeDefined();
    // ファイル名だけで引く参照 (別のディレクトリ) の fragment も、同じ元の画像から作る
    expect(await assets.addFragment('other/a.box#p3')).toBeDefined();
    // 選択肢を変えて、元の中身から登録し直す: 作った画像は捨て、次の addFragment が新しい選択肢で作り直す
    opts.color = '#0000ff';
    await assets.addBlob('fig/a.box', blob);
    expect(assets.get('fig/a.box#p2')).toBeUndefined();
    expect(assets.get('other/a.box#p3')).toBeUndefined();
    expect(new TextDecoder().decode((await assets.addFragment('fig/a.box#p2'))!.bytes)).toContain('fill="#0000ff"');
    // 形式を外す (読めなくなったものの登録を除く): 作った画像も残さない
    assets.setFormats([]);
    expect(await assets.addBlob('fig/a.box', blob)).toBeUndefined();
    assets.unregister('fig/a.box');
    expect(assets.get('fig/a.box#p2')).toBeUndefined();
    expect(await assets.addFragment('fig/a.box#p2')).toBeUndefined();
    // 中身の違うファイルを同じ名前で開き直す
    assets.setFormats([boxFormat()]);
    await assets.addBlob('fig/a.box', new Blob([enc('BOX 10 10 a')]));
    expect((await assets.addFragment('fig/a.box#p2'))?.width).toBe(10);
    await assets.addBlob('fig/a.box', new Blob([enc('BOX 30 20 a')]));
    expect(assets.get('fig/a.box#p2')).toBeUndefined();
    expect((await assets.addFragment('fig/a.box#p2'))?.width).toBe(30);
    // 読んでいる間に元の画像が登録し直されたら、古い中身から作ったものは残さない
    const pending = assets.addFragment('fig/a.box#p4');
    await assets.addBlob('fig/a.box', new Blob([enc('BOX 50 20 a')]));
    await pending;
    expect(assets.get('fig/a.box#p4')).toBeUndefined();
    expect((await assets.addFragment('fig/a.box#p4'))?.width).toBe(50);
  });

  it('形式を差し替えたら (プラグインを切ったら)、読み直して読めない画像は登録から外す', async () => {
    const assets = new AssetStore({ parseXml: parse, formats: [boxFormat()] });
    await assets.addBlob('a.box', new Blob([enc('BOX 10 10 a')]));
    expect(assets.get('a.box')).toBeDefined();
    assets.setFormats([]);
    expect(await assets.addBlob('a.box', new Blob([enc('BOX 10 10 a')]))).toBeUndefined();
    assets.unregister('a.box');
    expect(assets.get('a.box')).toBeUndefined();
    assets.setFormats([boxFormat()]);
    expect(await assets.addBlob('a.box', new Blob([enc('BOX 10 10 a')]))).toMatchObject({ width: 10 });
    assets.unregister('a.box');
    expect(assets.get('a.box')).toBeUndefined();
  });

  it('本体の画像の拡張子と判定は、これまでどおり (形式が無いとき)', async () => {
    expect(IMAGE_EXTENSIONS).toContain('cgm');
    expect([...mentionedFiles(['<img src="a.box"><img src="b.png">'])]).toEqual(['b.png']);
    expect(await looksLikeImage(enc('BOX 1 1 a'))).toBe(false);
  });
});
