/**
 * 記号の書体にも無い絵文字があるときだけ、絵文字の書体 (Noto Emoji。DEFAULT_FONTS.emoji) を読み込む (台帳の OUT-33)。
 * 前は既定の書体に絵文字の書体が無く、😀・国旗・肌の色の指定は字形の無い字の形 (豆腐) で組まれ、警告が出ていた。
 * 絵文字の字は UTS #51 ED-3 (emoji character)。どの書体にも無い字を処理系の後備の書体で組むのは CSS Fonts 4 §5.2
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(() => ensureFonts([...DEFAULT_FONTS.base, DEFAULT_FONTS.symbol, DEFAULT_FONTS.emoji]), 300_000);

const TOFU = /^読み込んだどの書体にも字形の無い字があります/;
const page = (body: string) => `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title></head><body><p>${body}</p></body></html>`;
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>${body}</fo:block></fo:flow></fo:page-sequence></fo:root>`;

/** 読み込みを頼まれた書体の名前を控える loadFont */
function recorder() {
  const asked: string[] = [];
  const loadFont = async (spec: FontSpec) => {
    asked.push(spec.family);
    return loadCachedFont(spec);
  };
  return { asked, loadFont };
}

/** 組んだ結果の字ごとの書体 (字 → 書体の名前) */
function fontsOf(tree: Parameters<typeof walkAreaTree>[0]): Map<string, string> {
  const m = new Map<string, string>();
  walkAreaTree(tree, (a) => void (a.type === 'glyph' && m.set((a as GlyphArea).text, (a as GlyphArea).fontFamily)));
  return m;
}

describe('絵文字の書体 (OUT-33)', () => {
  const text = '晴れ😀です。👍🏽 🇯🇵 ✈';

  it('HTML: 絵文字を絵文字の書体で組み、字形の無い字の警告を出さない。記号の書体が持つ字は、これまでどおり記号の書体', async () => {
    const { asked, loadFont } = recorder();
    const r = await typesetHtml(page(text), { name: 't.html', loadFont });
    expect(asked).toContain('Noto Emoji');
    expect(r.warnings.filter((w) => TOFU.test(w))).toEqual([]);
    const f = fontsOf(r.areaTree);
    expect(f.get('😀')).toBe('Noto Emoji');
    expect(f.get('👍🏽')).toBe('Noto Emoji'); // 肌の色の指定の並びは 1 つの字の単位で、1 つの書体で組む
    expect(f.get('🇯🇵')).toBe('Noto Emoji');
    expect(f.get('✈')).toBe('Noto Sans Symbols 2');
    expect(f.get('晴')).toBe('Noto Serif JP');
  });

  it('XSL-FO: 同じ経路で読み込む', async () => {
    const { asked, loadFont } = recorder();
    const r = await typesetFo(fo(text), { name: 't.fo', loadFont });
    expect(asked).toContain('Noto Emoji');
    expect(r.warnings.filter((w) => TOFU.test(w))).toEqual([]);
    expect(fontsOf(r.areaTree).get('😀')).toBe('Noto Emoji');
  });

  it('記号の書体が持つ字 (✈・❤) だけ、絵文字の無い文書、絵文字でない字形の無い字 (私用領域) では読み込まない', async () => {
    for (const body of ['✈ ❤', 'あいう abc 123 © ®', '']) {
      const { asked, loadFont } = recorder();
      await typesetHtml(page(body), { name: 't.html', loadFont });
      expect(asked, body).not.toContain('Noto Emoji');
    }
  });

  it('絵文字の書体が取れなければ、これまでどおり警告を出して組む', async () => {
    const loadFont = async (spec: FontSpec) => (spec.family === 'Noto Emoji' ? undefined : loadCachedFont(spec));
    const r = await typesetHtml(page('😀'), { name: 't.html', loadFont, fetchTimeoutMs: 1 });
    expect(r.warnings.find((w) => TOFU.test(w))).toMatch(/😀 \(U\+1F600\)/);
  });
});
