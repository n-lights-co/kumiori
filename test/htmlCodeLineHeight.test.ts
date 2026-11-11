/**
 * 既定のスタイル (kumiori) の、行内の等幅の要素 (code・kbd・samp・tt) の line-height: 1 (htmlPrepare.ts の KUMIORI_BOOK_CSS)。
 *
 * HTML の横書きの行は、行の中身ごとの箱 (A′ = A + L/2・D′ = D + L/2、L = line-height − (A + D)) を基線でそろえて囲む
 * (CSS 2.1 §10.8.1・CSS Inline 3 §5.3)。本文 (総称の serif = 最初に使える書体は Tinos) の中の、総称の monospace (Cousine) の要素は、
 * 同じ line-height だと、Cousine の下の深さ (A − D が小さい) の分だけ、箱の下端が本文の支柱より下に出て、行が高くなる (Chromium と同じ)。
 * 既定のスタイルでは、行内の等幅の要素を line-height: 1 にして、その箱 (高さ 1em) を本文の支柱の中に収める:
 *   支柱の下 (L − (A_t − D_t) F) / 2 ≥ 箱の下 (f − (A_c − D_c) f) / 2  ⇔  L ≥ 0.468 f + 0.675 F  (F・f は本文・要素の字の大きさ)
 * なので、line-height が字の大きさの 1.15 倍以上の本文なら、同じ大きさの等幅の字で行は高くならない (既定のスタイルの本文は 1.75、見出しは 1.4)。
 * 行内の箱の背景・罫線 (内容の領域) は、line-height に関わらず書体の上下で決まる (CSS 2.1 §10.6.1) ので変わらない。
 * pre の中 (と、pre の中の display: block の code) は、pre の line-height を受け継ぐ (規則の無いときと同じ)。
 * 作成者の指定 (line-height) が勝つ。browser・browser-margin・ah・weasyprint・vivliostyle には入れない (それぞれのお手本に合わせる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

const FS = 20;
const TINOS = { a: 1825 / 2048, d: 443 / 2048 };
const COUSINE = { a: 1705 / 2048, d: 615 / 2048 };

interface Line { y: number; h: number; text: string; base?: number }
interface Found { lines: Line[]; bg: Array<{ y: number; h: number }> }
function scan(tree: AreaTree): Found {
  const f: Found = { lines: [], bg: [] };
  const rec = (a: Area, ox: number, oy: number, line?: Line) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    let cur = line;
    if (a.type === 'line') f.lines.push((cur = { y, h: a.height, text: '' }));
    const g = a as unknown as { text?: string; baselineY?: number; backgroundColor?: string };
    if (g.backgroundColor?.toLowerCase() === '#ff0000') f.bg.push({ y, h: a.height });
    if (a.type === 'glyph' && cur) {
      cur.text += g.text ?? '';
      cur.base ??= y + (g.baselineY ?? 0) - cur.y;
    }
    for (const c of childrenOf(a)) rec(c as Area, x, y, cur);
  };
  rec(tree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  return f;
}
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 600pt; margin: 20pt }
body { margin: 0; font-size: ${FS}pt } p { margin: 0; text-indent: 0; text-align: left } pre { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
type Style = 'kumiori' | 'browser' | 'browser-margin' | 'ah' | 'weasyprint' | 'vivliostyle';
const html = async (body: string, style: Style = 'kumiori', css = '') => scan((await typesetHtml(page(body, css), { loadFont: loadCachedFont, style })).areaTree);

/** 行の高さ (pt): 本文の支柱の上と、等幅の要素 (line-height は lhc、字の大きさは f) の箱の下の、大きい方どうしを囲む */
const lineWith = (lh: number, lhc: number, f = FS) => Math.max((lh + (TINOS.a - TINOS.d) * FS) / 2, (lhc + (COUSINE.a - COUSINE.d) * f) / 2) + Math.max((lh - (TINOS.a - TINOS.d) * FS) / 2, (lhc - (COUSINE.a - COUSINE.d) * f) / 2);

describe('既定のスタイル (kumiori): 行内の等幅の要素 (code・kbd・samp・tt) は、本文の行を高くしない (line-height: 1)', () => {
  for (const tag of ['code', 'kbd', 'samp', 'tt']) {
    it(`<${tag}> のある行も、ない行も、行送りは本文の line-height (1.75) のまま。基線の位置も同じ`, async () => {
      const f = await html(`<p>abc <${tag}>xyz</${tag}> abc<br>abc</p>`);
      expect(f.lines).toHaveLength(2);
      expect(f.lines[0].h).toBeCloseTo(1.75 * FS, 2);
      expect(f.lines[1].h).toBeCloseTo(1.75 * FS, 2);
      expect(f.lines[0].base!).toBeCloseTo(f.lines[1].base!, 2);
      // 規則の無いとき (line-height: 1.75 を受け継ぐ) は、等幅の書体の下の深さの分だけ高くなる (CSS 2.1 §10.8.1)
      expect(lineWith(1.75 * FS, 1.75 * FS)).toBeGreaterThan(1.75 * FS + 1);
    });
  }

  it('説明書と同じ形 (本文 9pt・line-height: 1.75、code は 0.92em) と、見出し (line-height: 1.4) の中の code も、行は高くならない', async () => {
    const f = await html('<p style="font-size: 9pt">abc <code style="font-size: 0.92em">xyz</code> abc<br>abc</p><h2 style="margin: 0">abc <code>xyz</code><br>abc</h2>');
    expect(f.lines[0].h).toBeCloseTo(1.75 * 9, 2);
    expect(f.lines[1].h).toBeCloseTo(1.75 * 9, 2);
    expect(f.lines[2].h).toBeCloseTo(f.lines[3].h, 2);
  });

  it('作成者が line-height を指定した要素は、作成者の値 (行は、その箱の下の深さの分だけ高くなる)', async () => {
    const a = await html('<p>abc <code style="line-height: 1.75">xyz</code> abc</p>');
    expect(a.lines[0].h).toBeCloseTo(lineWith(1.75 * FS, 1.75 * FS), 1);
    const b = await html('<p>abc <code>xyz</code> abc</p>', 'kumiori', 'code { line-height: inherit }');
    expect(b.lines[0].h).toBeCloseTo(lineWith(1.75 * FS, 1.75 * FS), 1);
  });

  it('行内の箱の背景 (内容の領域) は、line-height に関わらず、書体の上の高さ + 下の深さ (CSS 2.1 §10.6.1)', async () => {
    const a = await html('<p>abc <code style="background: #ff0000">xyz</code> abc</p>');
    const b = await html('<p>abc <code style="background: #ff0000; line-height: 1.75">xyz</code> abc</p>');
    expect(a.bg.length).toBeGreaterThan(0);
    expect(a.bg[0].h).toBeCloseTo((COUSINE.a + COUSINE.d) * FS, 1);
    expect(b.bg[0].h).toBeCloseTo(a.bg[0].h, 2);
    // 背景の上端は、字の基線から書体の上の高さだけ上
    expect(a.lines[0].y + a.lines[0].base! - a.bg[0].y).toBeCloseTo(COUSINE.a * FS, 1);
  });

  it('pre の中の行は変わらない: pre の line-height (1.5) を受け継ぐ。pre の中の display: block の code も同じ', async () => {
    const lh = 1.5 * 0.9 * FS;
    for (const body of ['<pre>abc\n<code>xyz</code>\nabc</pre>', '<pre><code style="display: block">abc\nxyz\nabc</code></pre>', '<pre>abc\n<span><code>xyz</code></span>\nabc</pre>']) {
      const f = await html(body);
      expect(f.lines, body).toHaveLength(3);
      for (const l of f.lines) expect(l.h, body).toBeCloseTo(lh, 2);
    }
  });
});

describe('ほかの既定のスタイル (browser・browser-margin・weasyprint・vivliostyle・ah) には、この規則を入れない', () => {
  it('browser・browser-margin・weasyprint・vivliostyle: 本文の中の code のある行は、仕様どおり高くなる (Chromium と同じ)', async () => {
    for (const style of ['browser', 'browser-margin', 'weasyprint', 'vivliostyle'] as const) {
      const f = await html('<p style="line-height: 1.75">abc <code>xyz</code> abc<br>abc</p>', style);
      expect(f.lines[0].h, style).toBeCloseTo(lineWith(1.75 * FS, 1.75 * FS), 1);
      expect(f.lines[1].h, style).toBeCloseTo(1.75 * FS, 2);
    }
  });
  it('ah: code の line-height は受け継いだ値のまま (行は、字の枠の位置の基線で組むので、もとから高くならない)', async () => {
    const f = await html('<p style="line-height: 1.75">abc <code style="background: #ff0000">xyz</code> abc<br>abc</p>', 'ah');
    expect(f.lines[0].h).toBeCloseTo(1.75 * FS, 2);
    expect(f.lines[1].h).toBeCloseTo(1.75 * FS, 2);
  });
});
