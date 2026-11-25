/**
 * HTM-122 見つからない飛び先 (ページ番号の参照・しおり) の警告を、種類ごとに 1 行にまとめる。前は id ごとに 1 行ずつ出し、
 * 目次の深い項目の飛び先が無い文書 (Sphinx の 1 ファイルの HTML) で 1154 行になった
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { groupMissingIdWarnings } from '../src/layoutEngine';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const cite = (id: string) => `ページ番号参照の対象 id="${id}" が見つかりません`;

describe('見つからない飛び先の警告のまとめ', () => {
  it('1 件だけなら元の行のまま。ほかの警告の並びも変えない', () => {
    expect(groupMissingIdWarnings(['a', cite('x'), 'b'])).toEqual(['a', cite('x'), 'b']);
  });
  it('2 件以上は、最初の行の位置に 1 行で (件数と id)', () => {
    expect(groupMissingIdWarnings(['a', cite('x'), 'b', cite('y')])).toEqual(['a', 'ページ番号参照の対象が見つかりません (2 件): id="x"、id="y"', 'b']);
  });
  it('id は初めの 10 個を並べ、残りは「ほか N 件」。しおりの警告は別の行', () => {
    const list = [...Array.from({ length: 13 }, (_, k) => cite(`i${k}`)), 'しおりのリンク先 id="p" が見つかりません', 'しおりのリンク先 id="q" が見つかりません'];
    const out = groupMissingIdWarnings(list);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(`ページ番号参照の対象が見つかりません (13 件): ${Array.from({ length: 10 }, (_, k) => `id="i${k}"`).join('、')} …ほか 3 件`);
    expect(out[1]).toBe('しおりのリンク先が見つかりません (2 件): id="p"、id="q"');
  });
  it('組版の警告: target-counter() の見つからない参照 3 つは 1 行', async () => {
    const r = await typesetHtml(
      '<!doctype html><html lang="en"><head><style>a::after { content: target-counter(attr(href url), page) }</style></head><body><p><a href="#a">1</a> <a href="#b">2</a> <a href="#c">3</a></p></body></html>',
      { loadFont: loadCachedFont, style: 'browser' },
    );
    expect(r.warnings.filter((w) => w.includes('ページ番号参照の対象'))).toEqual(['ページ番号参照の対象が見つかりません (3 件): id="a"、id="b"、id="c"']);
  });
});
