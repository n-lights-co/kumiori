/**
 * font-synthesis (CSS Fonts 4 §2.8): 書体に無い字形 (太字・斜体・small caps) を作ってよいか。
 * none なら、太字の無い書体を太らせない・斜体の無い書体を傾けない・small caps の字形の無い書体で大文字を縮めて代わりにしない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { expand, supportsCssDeclaration } from '../src/cssCascade';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree } from '../src/index';
import type { GlyphArea } from '../src/types';
import { ensureFonts, fontDir, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 120_000);

/** 標準の太さ・立体だけの書体 (Arimo の Regular) を F として読み込み、p の字 a の字形を返す */
async function glyphA(pStyle: string, body = 'ab') {
  const data = fs.readFileSync(path.join(fontDir, 'Arimo-Regular.ttf'));
  const css = `@font-face { font-family: F; src: url(f.ttf); font-weight: 300 500 } p { font-family: F; ${pStyle} }`;
  const r = await typesetHtml(`<!DOCTYPE html><p>${body}</p>`, { loadFont: loadCachedFont, files: [{ name: 'c.css', data: css }, { name: 'f.ttf', data }] });
  const gs: GlyphArea[] = [];
  walkAreaTree(r.areaTree, (a) => {
    if (a.type === 'glyph') gs.push(a as GlyphArea);
  });
  return { g: gs.find((g) => g.text === 'a' || g.text === 'A')!, gs, warnings: r.warnings };
}

describe('font-synthesis (CSS Fonts 4 §2.8)', () => {
  it('太字の無い書体: 既定は太らせて描く。font-synthesis-weight: none・font-synthesis: none なら太らせない', async () => {
    expect((await glyphA('font-weight: 900')).g.fakeBold).toBe(true);
    expect((await glyphA('font-weight: 900; font-synthesis-weight: none')).g.fakeBold).toBeFalsy();
    expect((await glyphA('font-weight: 900; font-synthesis: none')).g.fakeBold).toBeFalsy();
    // 一括指定に weight を書けば作る (style だけなら作らない)
    expect((await glyphA('font-weight: 900; font-synthesis: weight')).g.fakeBold).toBe(true);
    expect((await glyphA('font-weight: 900; font-synthesis: style')).g.fakeBold).toBeFalsy();
    // 未対応の警告は出さない
    expect((await glyphA('font-weight: 900; font-synthesis: none')).warnings.filter((w) => /synthesis/.test(w))).toEqual([]);
  });
  it('斜体の無い書体: 既定は傾けて描く。font-synthesis-style: none なら傾けない', async () => {
    expect((await glyphA('font-style: italic')).g.italic).toBe(true);
    expect((await glyphA('font-style: italic; font-synthesis-style: none')).g.italic).toBeFalsy();
    // oblique-only (§2.8.2): 斜め (oblique) は作り、italic は作らない
    expect((await glyphA('font-style: italic; font-synthesis-style: oblique-only')).g.italic).toBeFalsy();
    expect((await glyphA('font-style: oblique; font-synthesis-style: oblique-only')).g.italic).toBe(true);
  });
  it('small caps の字形の無い書体: 既定は大文字を縮めて代わりにする。font-synthesis-small-caps: none ならそのままの字', async () => {
    expect((await glyphA('font-variant-caps: small-caps')).g.text).toBe('A');
    expect((await glyphA('font-variant-caps: small-caps; font-synthesis-small-caps: none')).g.text).toBe('a');
  });
  it('受け継ぐ。一括指定の展開と読めない値 (@supports)', () => {
    expect(Object.fromEntries(expand('font-synthesis', 'weight small-caps'))).toEqual({ 'font-synthesis-weight': 'auto', 'font-synthesis-style': 'none', 'font-synthesis-small-caps': 'auto', 'font-synthesis-position': 'none' });
    expect(expand('font-synthesis', 'weight weight')).toEqual([]);
    expect(supportsCssDeclaration('font-synthesis', 'none')).toBe(true);
    expect(supportsCssDeclaration('font-synthesis-weight', 'auto')).toBe(true);
    expect(supportsCssDeclaration('font-synthesis-weight', 'bold')).toBe(false);
  });
});
