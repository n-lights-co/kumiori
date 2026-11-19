/**
 * 余白の箱・@footnote の領域の宣言の読み方を、文書の要素とそろえる:
 *  - 余白の箱の罫線の個別の指定 (border-bottom-width・-style・-color、border-width・border-style・border-color)。前は一括指定
 *    (border・border-<辺>) だけを読み、個別の指定の罫線を描かなかった (Sphinx の印刷用の CSS のヘッダーの下の線)
 *  - 余白の箱の半透明の罫線・背景の色は、透明度つきのまま (前は白い紙に重ねた不透明の色)。背景の色の名前 (red など) も読む (前は # で始まる色だけ)
 *  - @footnote の区切り線の個別の指定 (border-top-width など) と、margin・padding の一括指定
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 余白の箱 (@top-right) の罫線 (辺 → 太さ・色) */
async function borders(decls: string) {
  return (await marginBox(decls)).borders;
}
/** 余白の箱 (@top-right) の罫線 (辺 → 太さ・色) と背景の色 */
async function marginBox(decls: string) {
  const r = await typesetHtml(
    `<!doctype html><html><head><style>html { color: #336699 } @page { size: 120mm 80mm; margin: 20mm; @top-right { content: "H"; ${decls} } }</style></head><body><p>x</p></body></html>`,
    { loadFont: loadCachedFont, style: 'browser' },
  );
  const out: Record<string, { width: number; color: string }> = {};
  let background: string | undefined;
  const rec = (a: AreaNode) => {
    background ??= (a as { backgroundColor?: string }).backgroundColor;
    for (const sd of ['top', 'right', 'bottom', 'left'] as const) {
      const b = a.border?.[sd];
      if (b?.width) out[sd] = { width: +b.width.toFixed(2), color: b.color };
    }
    for (const c of childrenOf(a)) rec(c);
  };
  rec(r.areaTree.sheets[0]);
  return { borders: out, background };
}

describe('余白の箱の罫線の個別の指定', () => {
  it('border-bottom-color・-style・-width', async () => {
    expect(await borders('border-bottom-color: red; border-bottom-style: solid; border-bottom-width: 2pt;')).toEqual({ bottom: { width: 2, color: 'red' } });
  });
  it('線種の無い指定は描かない (border-style の初期値は none)', async () => {
    expect(await borders('border-bottom-width: 2pt; border-bottom-color: red;')).toEqual({});
  });
  it('色を書かなければ、字の色 (currentcolor。根の要素から受け継いだ色)', async () => {
    expect((await borders('border-bottom-style: solid; border-bottom-width: 2pt;')).bottom?.color.toLowerCase()).toBe('#336699');
  });
  it('border-width・border-style・border-color (上・右・下・左)', async () => {
    const b = await borders('border-style: solid none; border-width: 1pt 2pt 3pt; border-color: red;');
    expect(b).toEqual({ top: { width: 1, color: 'red' }, bottom: { width: 3, color: 'red' } });
  });
  it('後の宣言が勝つ: 一括指定の後の個別の指定は、その部分だけを変える', async () => {
    expect(await borders('border-bottom: 2pt solid red; border-bottom-color: blue;')).toEqual({ bottom: { width: 2, color: 'blue' } });
    // 個別の指定の後の一括指定は、書かれなかった部分を初期値に戻す
    expect(await borders('border-bottom-color: blue; border-bottom: 2pt solid;')).toEqual({ bottom: { width: 2, color: '#336699' } });
  });
});

describe('余白の箱の色', () => {
  it('半透明の罫線・背景は、透明度つきのまま (文書の要素と同じ。下の色と重ねて描く)', async () => {
    const r = await marginBox('border-bottom: 2pt solid rgba(150, 26, 26, .5); background-color: rgba(150, 26, 26, .5);');
    expect(r.borders.bottom?.color).toBe('#961a1a80');
    expect(r.background).toBe('#961a1a80');
  });
  it('opacity は、半透明の背景の透明度に掛ける', async () => {
    expect((await marginBox('background-color: rgba(150, 26, 26, .5); opacity: .5;')).background).toBe('#961a1a40');
  });
  it('背景の色の名前', async () => {
    expect((await marginBox('background-color: red;')).background).toBe('red');
    expect((await marginBox('background: red;')).background).toBe('red');
  });
});

describe('@footnote の領域', () => {
  /** 脚注の区切り線 (本文の領域の下の方にある、背景を塗った細い箱) の太さ・色と、脚注の本文の字の左の端 */
  async function footnote(decls: string) {
    const r = await typesetHtml(
      `<!doctype html><html><head><style>@page { size: 120mm 80mm; margin: 20mm; @footnote { ${decls} } } .f { float: footnote }</style></head><body><p>x<span class="f">Note</span></p></body></html>`,
      { loadFont: loadCachedFont, style: 'browser' },
    );
    let rule: { h: number; color: string } | undefined;
    let noteX: number | undefined;
    const rec = (a: AreaNode, ox: number) => {
      const x = ox + a.x;
      const bg = (a as { backgroundColor?: string }).backgroundColor;
      if (bg && a.type === 'block' && a.height < 5) rule = { h: +a.height.toFixed(2), color: bg };
      if (a.type === 'glyph' && (a as { text: string }).text === 'N') noteX ??= x;
      for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0));
    };
    rec(r.areaTree.sheets[0], 0);
    return { rule, noteX };
  }
  it('区切り線の個別の指定 (border-top-width・-style・-color)', async () => {
    expect((await footnote('border-top-width: 2pt; border-top-style: solid; border-top-color: red;')).rule).toEqual({ h: 2, color: 'red' });
  });
  it('padding の一括指定 (左は脚注の本文の始め側の空き)', async () => {
    const plain = (await footnote('')).noteX!;
    expect((await footnote('padding: 0 0 0 15pt;')).noteX! - plain).toBeCloseTo(15, 1);
    // 一括指定の後の個別の指定が勝つ
    expect((await footnote('padding: 0 0 0 15pt; padding-left: 5pt;')).noteX! - plain).toBeCloseTo(5, 1);
  });
});
