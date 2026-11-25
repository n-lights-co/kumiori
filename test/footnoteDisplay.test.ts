/**
 * 脚注を行内に並べる置き方の確認: CSS の footnote-display (CSS GCPM 3 §2.3) の inline・compact と、アンテナハウスの拡張
 * axf:footnote-stacking="inline"。1 段のページ (Flow.pushFootnote)・段組のページ (placeColumnFoots)・次のページへの続き (splitEntry) で、
 * 脚注を 1 つの段落に続けて組み、block (既定) の組み方は変えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetFo, typesetHtml, type AreaNode, type GlyphArea, type AreaTree } from '../src/index';
import { unsupportedCssReport } from '../src/cssUnsupported';
import { parseCss } from '../src/htmlPaged';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの行の字 (上から。同じ高さの行は、左から 1 つにまとめる: 段組の段の行を分けずに読む) */
function pageLines(t: AreaTree): string[][] {
  const out: string[][] = [];
  for (const s of t.sheets) {
    const ls: Array<{ y: number; x: number; text: string }> = [];
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'line') ls.push({ y, x, text: '' });
      if (a.type === 'glyph') ls[ls.length - 1].text += (a as GlyphArea).text;
      for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0), y + a.padding.top + (a.border.top?.width ?? 0));
    };
    rec(s, 0, 0);
    out.push(ls.filter((l) => l.text).sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.text));
  }
  return out;
}

const html = async (body: string, css: string) =>
  pageLines(
    (await typesetHtml(`<!doctype html><html lang="en"><head><style>p { margin: 0 } ${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont, style: 'browser' }))
      .areaTree,
  );

/** 脚注の領域の行 (脚注の本文の語「w<k>」か番号の頭「N<k>:」を含む行) */
const footLines = (pages: string[][]) => pages.map((p) => p.filter((l) => /N\d+:|w\d+/.test(l)));

/** 段落 n 個。脚注 k の本文は、long(k) なら size 語、ほかは「N<k>: w<k>」 */
function paras(n: number, long: (k: number) => boolean = () => false, size = 40): string {
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const words = long(k) ? Array.from({ length: size }, () => `w${k}`).join(' ') : `w${k}`;
    return `<p>Body text here<span class="f">N${k}: ${words}</span> and more.</p>`;
  }).join('');
}

const PAGE = '@page { size: 120mm 90mm; margin: 12mm }';

describe('footnote-display (CSS GCPM 3 §2.3)', () => {
  it('block (既定) は脚注ごとに行を改め、inline は同じページの脚注を 1 つの段落に続けて組む', async () => {
    const block = footLines(await html(paras(3), `${PAGE} .f { float: footnote }`));
    expect(block[0]).toHaveLength(3);
    const inline = footLines(await html(paras(3), `${PAGE} .f { float: footnote; footnote-display: inline; margin-right: 1em }`));
    expect(inline[0]).toHaveLength(1);
    expect(inline[0][0]).toMatch(/N1:\s*w1.*N2:\s*w2.*N3:\s*w3/);
  });

  it('inline の長い脚注は、行の途中で分けて、後ろの脚注を続ける', async () => {
    const pages = footLines(await html(paras(3, (k) => k === 2), `${PAGE} .f { float: footnote; footnote-display: inline }`));
    const all = pages.flat().join(' ');
    // 脚注 1 の後ろに脚注 2 が同じ行で始まり、脚注 2 の最後の行に脚注 3 が続く
    expect(pages[0][0]).toMatch(/N1:\s*w1.*N2:/);
    expect(pages[0].some((l) => /w2.*N3:\s*w3/.test(l))).toBe(true);
    expect([...all.matchAll(/w2/g)]).toHaveLength(40);
  });

  it('compact は、1 行に収まる脚注を行内に並べ、収まらない脚注はブロックにする', async () => {
    const pages = footLines(await html(paras(4, (k) => k === 2), `${PAGE} .f { float: footnote; footnote-display: compact; margin-right: 1em }`));
    const ls = pages[0];
    // 脚注 1 は 1 行、脚注 2 (長い) は自分の行から始まるブロック、脚注 3・4 は、ブロックの後ろの行に並ぶ
    expect(ls[0]).toMatch(/^\d?N1:\s*w1\s*$/);
    expect(ls[1]).toMatch(/^\d?N2:/);
    expect(ls.some((l) => /N3:\s*w3.*N4:\s*w4/.test(l))).toBe(true);
    expect(ls.some((l) => /w2.*N3:/.test(l))).toBe(false);
  });

  it('ページに入りきらない inline の脚注は、つないだ段落を行で分けて次のページへ続け、本文を欠かさない', async () => {
    const pages = footLines(await html(paras(6, (k) => k % 2 === 0, 150), `@page { size: 120mm 70mm; margin: 10mm } .f { float: footnote; footnote-display: inline }`));
    const all = pages.flat().join(' ');
    // 語の数 (w<k> の後ろに数字が続くときは、次の脚注の番号の字)
    for (let k = 1; k <= 6; k++) expect([...all.matchAll(new RegExp(`w${k}(?=\\s|\\d+N|$)`, 'g'))], `脚注 ${k}`).toHaveLength(k % 2 === 0 ? 150 : 1);
    const heads = [...all.matchAll(/N(\d+):/g)].map((m) => Number(m[1]));
    expect(heads).toEqual([1, 2, 3, 4, 5, 6]);
    // 本文の段落より脚注の続きのほうが長いので、脚注だけのページが続く (脚注の続きが、次のページの脚注の領域の頭に来る)
    expect(pages.length).toBeGreaterThan(2);
  });

  it('footnote-display は、どの値も未対応の CSS に数えない', () => {
    const r = unsupportedCssReport(parseCss('.a { footnote-display: block } .b { footnote-display: inline } .c { footnote-display: compact }'));
    expect(r.unsupported).toEqual({});
    expect(r.unknown).toEqual({});
  });
});

const FO_NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
/** 脚注の本体を fo:block にした FO (本体の頭の番号は、本体に書く。アンテナハウスのサンプル FO 集の axf-footnote-1 と同じ形) */
function fo(stacking: string, notes: string[], columns = 1): string {
  const refs = notes
    .map((t, i) => `Text ${i + 1}<fo:footnote><fo:inline baseline-shift="super" font-size="6pt">(${i + 1})</fo:inline><fo:footnote-body><fo:block font-size="8pt">(${i + 1}) ${t}</fo:block></fo:footnote-body></fo:footnote> more.`)
    .join(' ');
  return `<fo:root ${FO_NS} font-family="serif" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="120mm" page-height="90mm" margin="10mm"><fo:region-body column-count="${columns}" column-gap="5mm"${stacking ? ` axf:footnote-stacking="${stacking}"` : ''}/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>${refs}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
}
const foLines = async (src: string) => {
  const pages = pageLines((await typesetFo(src, { loadFont: loadCachedFont })).areaTree);
  return pages.map((p) => p.filter((l) => /^\(\d\) /.test(l)));
};

describe('axf:footnote-stacking="inline" (アンテナハウスの拡張)', () => {
  it('脚注を行の進む方向に並べ、1 行に収まる脚注は、行の途中で分けずに次の行から置く', async () => {
    const block = await foLines(fo('', ['alpha', 'beta', 'gamma']));
    expect(block[0]).toHaveLength(3);
    const long = Array.from({ length: 12 }, () => 'lorem').join(' ');
    const inl = await foLines(fo('inline', ['alpha', 'beta', long]));
    expect(inl[0][0]).toMatch(/\(1\) alpha.*\(2\) beta/);
    // (3) は 1 行に収まるので、(2) の後ろの残りに入らなければ、次の行から置く (行の途中で分けない)
    const l3 = inl[0].find((l) => l.includes('(3)'))!;
    expect(l3.startsWith('(3)')).toBe(true);
    expect([...l3.matchAll(/lorem/g)]).toHaveLength(12);
  });

  it('page-sequence に書いても効き、段組のページでも並べる', async () => {
    const src = fo('', ['alpha', 'beta', 'gamma'], 2).replace('<fo:page-sequence master-reference="m">', '<fo:page-sequence master-reference="m" axf:footnote-stacking="inline">');
    const ls = await foLines(src);
    expect(ls[0]).toHaveLength(1);
    expect(ls[0][0]).toMatch(/\(1\) alpha.*\(2\) beta.*\(3\) gamma/);
  });
});
