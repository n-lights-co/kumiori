/**
 * 対応仕様説明書の見本の確認で見つかった 2 点:
 *  - 欧文の合字: liga を持たない書体 (Tinos・Arimo) でも、合字の字形 (U+FB01 など) があればそれを使う。等幅の書体は使わない
 *  - 内側の影 (box-shadow: inset・axf:box-shadow の inset): padding の箱の内側に描く
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { flattenInline } from '../src/inlineLayout';
import { resolveStyle, type ResolvedStyle } from '../src/lnode';
import { shadowsOf } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
import { paintSheet } from '../src/paint';
import { defaultFontBuffer, doc, makeEngine } from './helpers';
import type { LBlock } from '../src/types';


let fonts: FontManager;
let m: Measurer;
let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer('Tinos', 400, await defaultFontBuffer('Tinos-Regular.ttf'), false);
  await fonts.registerBuffer('Cousine', 400, await defaultFontBuffer('Cousine-Regular.ttf'), false);
  await fonts.registerBuffer('Noto Serif JP', 400, await defaultFontBuffer('NotoSerifJP-Regular.ttf'), false);
  m = new Measurer(fonts, 'fontkit');
  E = await makeEngine();
});

const base = (over: Partial<ResolvedStyle> = {}): ResolvedStyle => ({
  fontFamily: 'Tinos',
  fontWeight: 400,
  italic: false,
  fontSize: 10,
  lineHeight: 1.7,
  color: '#000',
  textAlign: 'start',
  textIndent: 0,
  letterSpacing: 0,
  rubyScale: 0.5,
  hanging: false,
  orphans: 2,
  widows: 2,
  wm: 'horizontal-tb',
  latinLigatures: true,
  ...over,
});
const texts = (family: string, text: string) => flattenInline([text], resolveStyle(base({ fontFamily: family }), {}), m).map((a) => a.first);

describe('欧文の合字: liga の無い書体の合字の字形', () => {
  it('Tinos (liga 無し・ﬁ ﬂ ﬃ ﬄ の字形あり) は、office を o ﬃ c e と組む', () => {
    expect(texts('Tinos', 'office')).toEqual(['o', 'ﬃ', 'c', 'e']);
    expect(texts('Tinos', 'flat')).toEqual(['ﬂ', 'a', 't']);
  });
  it('等幅の Cousine (liga 無し・ﬁ の字形あり) は、字幅を保つために合字にしない', () => {
    expect(texts('Cousine', 'office')).toEqual(['o', 'f', 'f', 'i', 'c', 'e']);
  });
  it('liga を持つ Noto Serif JP は従来どおり liga で決める (ffi を合字にする)', () => {
    expect(texts('Noto Serif JP', 'office')).toEqual(['o', 'ﬃ', 'c', 'e']);
  });
  it('letter-spacing があれば合字にしない (Text 3 §7.2)', () => {
    expect(flattenInline(['office'], resolveStyle(base({ letterSpacing: 1 }), {}), m).map((a) => a.first)).toEqual(['o', 'f', 'f', 'i', 'c', 'e']);
  });
});

describe('内側の影 (inset)', () => {
  it('box-shadow の inset を読む (位置は自由)', () => {
    expect(shadowsOf('inset 0 0 6pt #4f7a64')).toEqual([{ dx: 0, dy: 0, blur: 6, color: '#4f7a64', inset: true }]);
    expect(shadowsOf('2pt 2pt #000 inset, 1pt 1pt #fff')).toEqual([
      { dx: 2, dy: 2, color: '#000000', inset: true },
      { dx: 1, dy: 1, color: '#ffffff' },
    ]);
  });
  it('axf:box-shadow の inset を読む', () => {
    const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block axf:box-shadow="inset 2pt 2pt #ff0000, 1pt 1pt #0000ff">x</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
    const b = importXslFo(xml, parse, { compat: 'spec' }).document.sequences[0].flow.children[0] as LBlock;
    expect(b.boxShadow).toEqual([
      { dx: 2, dy: 2, color: '#ff0000', inset: true },
      { dx: 1, dy: 1, color: '#0000ff' },
    ]);
  });
  it('描くときは、padding の箱で切り抜き、箱と内側の矩形の間 (偶奇) を影の色で塗る。外側には描かない', () => {
    const t = E.engine.layout(
      doc([{ type: 'block', width: 100, padding: { top: 5, right: 5, bottom: 5, left: 5 }, boxShadow: { dx: 0, dy: 0, blur: 6, color: '#4f7a64', inset: true }, children: ['a'] } as never]),
    );
    const fills: Array<{ evenOdd?: boolean; color: string; alpha?: number; n: number }> = [];
    let clips = 0;
    const painter = {
      fillRect: () => {},
      fillPath: (p: unknown[], c: string, evenOdd?: boolean, alpha?: number) => fills.push({ evenOdd, color: c, alpha, n: p.length }),
      strokePath: () => {},
      clipPath: () => {
        clips++;
      },
      drawGlyph: () => {},
      drawImage: () => {},
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      transform: (_m: number[], draw: () => void) => draw(),
    };
    paintSheet(t.sheets[0], painter as never);
    const shadow = fills.filter((f) => f.color === '#4f7a64');
    // ぼかし 6pt (σ = 3) → 5 層。いずれも偶奇で塗り、padding の箱で 1 回切り抜く
    expect(shadow.length).toBe(5);
    expect(shadow.every((f) => f.evenOdd === true)).toBe(true);
    expect(clips).toBe(1);
    expect(shadow.every((f) => (f.alpha ?? 1) > 0 && (f.alpha ?? 1) <= 1)).toBe(true);
  });
});
