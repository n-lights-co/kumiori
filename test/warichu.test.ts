/**
 * 割注 (JLREQ §3.4。Kumiori の拡張の CSS の -kumiori-warichu・-kumiori-warichu-brackets、XSL-FO の kumiori:warichu・kumiori:warichu-brackets。
 * src/warichu.ts):
 *  - 2 行に割る: 2 行目を 1 行目より長くしない、字の数の差は 1 まで。2 行の間は 0
 *  - 前後の括弧は割注の字の 2 倍の大きさ。指定で無しにも、ほかの括弧にもできる
 *  - 割注の 2 行の中心を本文の字の中心にそろえ、行の高さを変えない
 *  - 縦書き: 1 行目が右、2 行目が左
 *  - 行をまたぐ割注は、行ごとの部分をそれぞれ 2 行に割る。括弧は最初と最後の部分だけ。開きの括弧を行末に、閉じの括弧を行頭に置かない
 *  - ページをまたぐ割注、割注の中のルビ
 *  - XSL-FO の名前空間の属性、読めない値の警告
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf } from '../src/areaTree';
import { DEFAULT_FONTS, typeset } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const opts = { loadFont: loadCachedFont, fetchImages: false } as const;

type Tree = Awaited<ReturnType<typeof typeset>>['areaTree'];
type Node = Parameters<typeof childrenOf>[0];
interface G {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  page: number;
}
/** 字の、紙面の上での位置 (領域の位置は親からの相対なので、たどりながら足す)・大きさ・ページ。文書の順 (領域の木の順) */
function glyphs(tree: Tree): G[] {
  const out: G[] = [];
  tree.sheets.forEach((sheet, page) => {
    const visit = (a: Node, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') out.push({ text: a.text, x, y, w: a.width, h: a.height, size: a.fontSize, page });
      for (const c of childrenOf(a)) visit(c, x, y);
    };
    visit(sheet, 0, 0);
  });
  return out;
}

const html = (body: string, css = '', wm = 'horizontal-tb') =>
  `<!DOCTYPE html><html lang="ja"><head><style>@page { size: 120mm 80mm; margin: 10mm } body { margin: 0; font-size: 12pt; line-height: 2; writing-mode: ${wm} } .w { -kumiori-warichu: auto; font-size: 6pt } ${css}</style></head><body>${body}</body></html>`;

/** 割注の中身の字 (大きさ 6pt) を、本文の行ごとの部分に分け、部分ごとに 2 行 [1 行目, 2 行目] の字の並びにする (横書き: y、縦書き: x で分ける) */
function pieces(gs: G[], vertical = false): string[][] {
  const w = gs.filter((g) => Math.abs(g.size - 6) < 0.01);
  const key = (g: G) => (vertical ? -g.x : g.y) + g.page * 1e4;
  const sorted = [...w].sort((a, b) => key(a) - key(b));
  const out: G[][][] = [];
  let cur: G[][] | undefined;
  let last = -Infinity;
  let rowKey = -Infinity;
  for (const g of sorted) {
    const k = key(g);
    if (k - last > 10) {
      cur = [[g]];
      out.push(cur);
      rowKey = k;
    } else if (k - rowKey > 3) {
      if (cur!.length < 2) cur!.push([]);
      cur![1].push(g);
    } else cur![cur!.length - 1].push(g);
    last = k;
  }
  // 行の中の字は、行の進む向き (横書きは x、縦書きは y) の順
  return out.map((p) => p.map((row) => row.sort((a, b) => (vertical ? a.y - b.y : a.x - b.x)).map((g) => g.text).join('')));
}

describe('割注: 横書き', () => {
  it('2 行に割り、2 倍の大きさの括弧でくくって、本文の字の中央にそろえる', async () => {
    const r = await typeset(html('<p>本文の字<span class="w">割注の中身です</span>の後ろ。</p>'), opts);
    const gs = glyphs(r.areaTree);
    // 7 字は 4 字と 3 字 (2 行目を 1 行目より長くしない。JLREQ §3.4.2)
    expect(pieces(gs)).toEqual([['割注の中', '身です']]);
    const open = gs.find((g) => g.text === '（')!;
    const close = gs.find((g) => g.text === '）')!;
    expect(open.size).toBeCloseTo(12, 5);
    expect(close.size).toBeCloseTo(12, 5);
    const ji = gs.find((g) => g.text === '字')!;
    const no = gs.filter((g) => g.text === 'の' && g.size === 12)[1];
    const wari = gs.filter((g) => g.size === 6);
    // 並び: 本文 → 開きの括弧 → 割注 → 閉じの括弧 → 本文。括弧と前後の字の間はベタ (全角の括弧の外側の二分を詰める: 開きの括弧の字の箱は、
    // 二分だけ前の字に重ねて置く)
    expect(open.x + open.w / 2).toBeCloseTo(ji.x + ji.w, 1);
    expect(Math.min(...wari.map((g) => g.x))).toBeGreaterThan(open.x);
    expect(Math.max(...wari.map((g) => g.x + g.w))).toBeLessThanOrEqual(close.x + 6 + 0.01);
    expect(no.x).toBeGreaterThan(close.x);
    // 2 行の間は 0 (行の字の上端の差が、割注の字の大きさ)。2 行の中心は、本文の字の em の箱の中心
    const tops = [...new Set(wari.map((g) => Math.round(g.y * 100) / 100))].sort((a, b) => a - b);
    expect(tops.length).toBe(2);
    expect(tops[1] - tops[0]).toBeCloseTo(6, 1);
    expect((tops[0] + tops[1] + 6) / 2).toBeCloseTo(ji.y + ji.h / 2, 0);
  });

  it('割注で行の高さを変えない (JLREQ §3.4.2: 行間は割注の無い所の行間のまま)', async () => {
    const a = glyphs((await typeset(html('<p>本文<span class="w">割注の中身</span><br>次の行</p>'), opts)).areaTree);
    const b = glyphs((await typeset(html('<p>本文割注<br>次の行</p>'), opts)).areaTree);
    const nextA = a.find((g) => g.text === '次')!;
    const nextB = b.find((g) => g.text === '次')!;
    expect(nextA.y).toBeCloseTo(nextB.y, 3);
    expect(a.find((g) => g.text === '本')!.y).toBeCloseTo(b.find((g) => g.text === '本')!.y, 3);
  });

  it('括弧は指定で無しにも、ほかの括弧にもできる', async () => {
    const none = glyphs((await typeset(html('<p>本文<span class="w" style="-kumiori-warichu-brackets: none">括弧なし</span>後</p>'), opts)).areaTree);
    expect(none.some((g) => g.size === 12 && /[（）]/.test(g.text))).toBe(false);
    expect(pieces(none)).toEqual([['括弧', 'なし']]);
    const kikko = glyphs((await typeset(html(`<p>本文<span class="w" style="-kumiori-warichu-brackets: '〔' '〕'">亀甲</span>後</p>`), opts)).areaTree);
    expect(kikko.filter((g) => g.size === 12 && /[〔〕]/.test(g.text)).map((g) => g.text)).toEqual(['〔', '〕']);
  });

  it('読めない値は警告に出し、割注にしない', async () => {
    const r = await typeset(html('<p>本文<span class="w" style="-kumiori-warichu: yes">割注</span>後</p>'), opts);
    expect(r.warnings.join('\n')).toContain('-kumiori-warichu: yes');
    expect(glyphs(r.areaTree).some((g) => g.text === '（')).toBe(false);
    const ok = await typeset(html('<p>本文<span class="w">割注</span>後</p>'), opts);
    expect(ok.warnings.join('\n')).not.toContain('kumiori');
  });
});

describe('割注: 行・ページをまたぐ', () => {
  const long = 'ここに長い割注を入れて、行末で分けて次の行に続ける例。分けた所に括弧は付けない。さらに続けて三行目に入る。';
  it('行ごとの部分をそれぞれ 2 行に割り、括弧は最初と最後の部分だけに付ける', async () => {
    const r = await typeset(html(`<p>本文の字が続きます<span class="w">${long}</span>の後ろの本文。</p>`, '@page { size: 70mm 80mm } p { text-align: justify }'), opts);
    const gs = glyphs(r.areaTree);
    const ps = pieces(gs);
    expect(ps.length).toBeGreaterThanOrEqual(3);
    // 字の順 (部分ごとに 1 行目 → 2 行目。JLREQ §3.4.3) は、元の並び
    expect(ps.flat().join('')).toBe(long);
    for (const [r1, r2 = ''] of ps) {
      const [n1, n2] = [[...r1].length, [...r2].length];
      expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
      // 2 行目を 1 行目より長くしない。ただし、半分の所で分けると 2 行目の頭が行頭に置けない字 (。など) になり、全部を 1 行目にすると
      // 行を分けたときの見積もりより広くなる部分 (ここでは最後の「入る。」) は、2 行目を 1 字長くする (warichu.ts の splitIndex)
      if (n2 > n1) expect([...(r1 + r2)][Math.ceil((n1 + n2) / 2)]).toMatch(/^[、。）」]$/);
    }
    // 行の途中の部分 (最後でない部分) は、行いっぱい: 2 行の字の数がそろう
    for (const [r1, r2] of ps.slice(0, -1)) expect([...r1].length).toBe([...r2].length);
    expect(gs.filter((g) => g.text === '（').length).toBe(1);
    expect(gs.filter((g) => g.text === '）').length).toBe(1);
  });

  it('開きの括弧を行末に、閉じの括弧を行頭に置かない (JLREQ §3.1.7・§3.1.8・§3.1.10)', async () => {
    for (let mm = 40; mm <= 60; mm++) {
      const doc = html('<p>本文の字<span class="w">割注の中身の字です。</span>後ろの本文が続きます。</p>').replace('size: 120mm 80mm', `size: ${mm + 20}mm 80mm`);
      const gs = glyphs((await typeset(doc, opts)).areaTree);
      const lineOf = (g: G) => Math.round((g.y + g.h / 2) / 4);
      const open = gs.find((g) => g.text === '（' && g.size === 12)!;
      const close = gs.find((g) => g.text === '）' && g.size === 12)!;
      const sameLine = (b: G) => gs.filter((g) => Math.abs(g.y + g.h / 2 - (b.y + b.h / 2)) < 4);
      // 開きの括弧の後ろ (同じ行) に割注の字がある。閉じの括弧の前 (同じ行) に割注の字がある
      expect(sameLine(open).some((g) => g.size === 6 && g.x > open.x), `${mm}mm`).toBe(true);
      expect(sameLine(close).some((g) => g.size === 6 && g.x < close.x), `${mm}mm`).toBe(true);
      void lineOf;
    }
  });

  it('ページをまたぐ割注は、次のページに続ける', async () => {
    // 1 ページに 2 行 (1 行 15 字)。割注は 2 行目の後ろの 4 字分から始まる
    const doc = html(`<p>${'本文'.repeat(13)}<span class="w">${long}</span>後ろ。</p>`, '@page { size: 80mm 40mm; margin: 8mm }');
    const gs = glyphs((await typeset(doc, opts)).areaTree);
    const wari = gs.filter((g) => g.size === 6);
    const pages = [...new Set(wari.map((g) => g.page))];
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(gs.find((g) => g.text === '（')!.page).toBe(pages[0]);
    expect(gs.find((g) => g.text === '）')!.page).toBe(pages[pages.length - 1]);
    expect(pieces(gs).flat().join('')).toBe(long);
  });
});

describe('割注: 縦書き', () => {
  it('1 行目を右、2 行目を左に置き、字は上から下へ並べる', async () => {
    const r = await typeset(html('<p>本文の字<span class="w">割注の中身です</span>の後ろ。</p>', '', 'vertical-rl'), opts);
    const gs = glyphs(r.areaTree);
    const wari = gs.filter((g) => g.size === 6);
    const xs = [...new Set(wari.map((g) => Math.round(g.x * 100) / 100))].sort((a, b) => b - a);
    expect(xs.length).toBe(2);
    expect(xs[0] - xs[1]).toBeCloseTo(6, 1);
    expect(pieces(gs, true)).toEqual([['割注の中', '身です']]);
    // 2 行の中心は、本文の字の中心
    const ji = gs.find((g) => g.text === '字')!;
    expect((xs[1] + xs[0] + 6) / 2).toBeCloseTo(ji.x + ji.w / 2, 0);
    const open = gs.find((g) => g.text === '（')!;
    expect(open.y).toBeGreaterThan(ji.y);
    expect(Math.min(...wari.map((g) => g.y))).toBeGreaterThan(open.y);
  });
});

describe('割注: ルビ', () => {
  it('割注の中のルビは割注の字の大きさで組み、割注の前のルビもそのまま組む', async () => {
    const r = await typeset(html('<p><ruby>漢字<rt>かんじ</rt></ruby><span class="w">中に<ruby>難読<rt>なんどく</rt></ruby>語</span>後</p>'), opts);
    const gs = glyphs(r.areaTree);
    expect(gs.filter((g) => Math.abs(g.size - 3) < 0.01).map((g) => g.text).join('')).toBe('なんどく');
    // 6pt の字: 本文のルビ (12pt の半分) と、割注の中身
    expect(gs.filter((g) => Math.abs(g.size - 6) < 0.01).map((g) => g.text).join('')).toBe('かんじ中に難読語');
    const kan = gs.find((g) => g.text === 'か')!;
    const naka = gs.find((g) => g.text === '中')!;
    expect(kan.y).toBeLessThan(naka.y);
  });
});

describe('割注: XSL-FO', () => {
  const fo = (attrs: string, ns = 'xmlns:k="https://github.com/n-lights-co/kumiori/ns"') =>
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" ${ns} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-size="12pt">本文<fo:inline ${attrs} font-size="6pt">割注の中身です</fo:inline>後</fo:block></fo:flow></fo:page-sequence></fo:root>`;
  it('Kumiori の名前空間の属性 (接頭辞は文書が決める) で割注にする', async () => {
    const r = await typeset(fo('k:warichu="auto"'), { ...opts, kind: 'fo' });
    expect(pieces(glyphs(r.areaTree))).toEqual([['割注の中', '身です']]);
    expect(r.warnings.join('\n')).not.toMatch(/warichu/);
    const b = await typeset(fo(`k:warichu="auto" k:warichu-brackets="'〔' '〕'"`), { ...opts, kind: 'fo' });
    expect(glyphs(b.areaTree).filter((g) => g.size === 12 && /[〔〕]/.test(g.text)).length).toBe(2);
  });
  it('読めない値は警告に出す', async () => {
    const r = await typeset(fo('k:warichu="yes"'), { ...opts, kind: 'fo' });
    expect(r.warnings.join('\n')).toContain('kumiori:warichu="yes"');
    expect(glyphs(r.areaTree).some((g) => g.text === '（')).toBe(false);
  });
});

/** 本文の領域の右端 (pt。紙の幅 − 余白) を超える字 (行から溢れた字)。本文の行末でぶら下げた句読点は除く */
const overflowing = (gs: G[], right: number) => gs.filter((g) => g.x + g.w / 2 > right + 0.01 && !/^[（）]$/.test(g.text) && !(g.size === 12 && /^[、。，．]$/.test(g.text)));

describe('割注: 見積もりと行の幅', () => {
  it('禁則で半分の所で分けられない短い割注でも、本文の行から溢れない', async () => {
    for (let mm = 40; mm <= 52; mm++) {
      const doc = html('<p style="text-align: justify">本文の字が並ぶ段落<span class="w">注。</span>の後ろにも本文が続く段落です。</p>').replace('size: 120mm 80mm', `size: ${mm + 20}mm 80mm`);
      const gs = glyphs((await typeset(doc, opts)).areaTree);
      const right = ((mm + 10) * 72) / 25.4;
      expect(overflowing(gs, right), `${mm}mm`).toEqual([]);
      // 「。」の前では分けられないが、全部を 1 行目にすると見積もり (1 字分) より広くなるので、2 行に分ける
      expect(pieces(gs)).toEqual([['注', '。']]);
    }
  });

  it('空白・幅の無い目印を含む割注を行で分けても、組の数え方がずれない', async () => {
    const text = '割注 の 中に 空白を 入れた 例です が かなり 長く 続いて 次の 行に 入る';
    for (let mm = 40; mm <= 60; mm += 2) {
      const doc = html(`<p style="text-align: justify">本文の字<span class="w"><a id="x"></a>${text}</span>の後ろの本文。</p>`).replace('size: 120mm 80mm', `size: ${mm + 20}mm 80mm`);
      const gs = glyphs((await typeset(doc, opts)).areaTree);
      expect(overflowing(gs, ((mm + 10) * 72) / 25.4), `${mm}mm`).toEqual([]);
      expect(pieces(gs).flat().join('').replace(/ /g, ''), `${mm}mm`).toBe(text.replace(/ /g, ''));
    }
  });

  it('割注の中では分綴しない (ハイフンを割注の箱の外に出さない)', async () => {
    const doc = html('<p lang="en" style="hyphens: auto; text-align: justify">Some text before <span class="w">internationalization characterization representation</span> and after.</p>', '@page { size: 60mm 80mm }');
    const gs = glyphs((await typeset(doc, opts)).areaTree);
    // 本文の語の分綴 (af-ter など) はよいが、割注の字・括弧の直後 (領域の木の順) にハイフンを置かない
    gs.forEach((g, k) => {
      if (/^[-\u2010]$/.test(g.text)) expect(k > 0 && gs[k - 1].size === 12 && !/[（）]/.test(gs[k - 1].text), `${gs[k - 1]?.text}${g.text}`).toBe(true);
    });
  });

  it('::first-line のある段落でも、1 行目の割注を 2 行に割った幅で分ける', async () => {
    const long = 'ここに長い割注を入れて、行末で分けて次の行に続ける例。分けた所に括弧は付けない。';
    const doc = html(`<p>本文の字が続きます<span class="w">${long}</span>の後ろの本文。</p>`, '@page { size: 70mm 80mm } p { text-align: justify } p::first-line { color: #c00 }');
    const gs = glyphs((await typeset(doc, opts)).areaTree);
    const ps = pieces(gs);
    expect(ps.flat().join('')).toBe(long);
    for (const [r1, r2] of ps.slice(0, -1)) expect([...r1].length).toBe([...r2].length);
    expect(gs.filter((g) => g.text === '（').length).toBe(1);
    expect(gs.filter((g) => g.text === '）').length).toBe(1);
    expect(overflowing(gs, (60 * 72) / 25.4)).toEqual([]);
  });
});

describe('割注: そのほか', () => {
  it('割注の中の右から左の字は、行ごとに並べ替える', async () => {
    const r = await typeset(html('<p>本文<span class="w">ab \u05e9\u05dc\u05d5\u05dd cd</span>後</p>'), opts);
    const gs = glyphs(r.areaTree).filter((g) => /[\u05d0-\u05ea]/.test(g.text));
    expect(gs.length).toBe(4);
    // 同じ行 (y) の字は、論理の順 (領域の木の順) に右から左へ並ぶ
    const rows = new Map<number, G[]>();
    for (const g of gs) rows.set(Math.round(g.y), [...(rows.get(Math.round(g.y)) ?? []), g]);
    for (const row of rows.values()) for (let k = 1; k < row.length; k++) expect(row[k].x).toBeLessThan(row[k - 1].x);
  });

  it('割注の背景の色を、括弧の所にも塗る', async () => {
    const r = await typeset(html('<p>本文<span class="w" style="background-color: #ff0">割注の中身</span>後</p>'), opts);
    const fills: Array<{ x: number; w: number }> = [];
    const visit = (a: Node, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if ((a as { backgroundColor?: string }).backgroundColor === '#ffff00') fills.push({ x, w: a.width });
      for (const c of childrenOf(a)) visit(c, x, y);
    };
    visit(r.areaTree.sheets[0], 0, 0);
    const gs = glyphs(r.areaTree);
    for (const b of ['（', '）']) {
      const g = gs.find((x) => x.text === b)!;
      const mid = g.x + g.w / 2;
      expect(fills.some((f) => f.x <= mid + 0.01 && mid - 0.01 <= f.x + f.w), b).toBe(true);
    }
  });

  it('CSS の文字列のエスケープを戻す (CSS Syntax 3 §4.3.7)', async () => {
    const r = await typeset(html(String.raw`<p>本文<span class="w" style="-kumiori-warichu-brackets: '\3014' '\3015 '">亀甲</span>後</p>`), opts);
    expect(glyphs(r.areaTree).filter((g) => g.size === 12 && /[〔〕]/.test(g.text)).map((g) => g.text)).toEqual(['〔', '〕']);
  });

  it('XSL-FO: ブロックを含む fo:inline は割注にせず、警告に出す', async () => {
    const fo = `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:k="https://github.com/n-lights-co/kumiori/ns" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>本文<fo:inline k:warichu="auto"><fo:block>ブロック</fo:block></fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(fo, { ...opts, kind: 'fo' });
    expect(r.warnings.join('\n')).toContain('kumiori:warichu');
    expect(glyphs(r.areaTree).some((g) => g.text === '（')).toBe(false);
  });
});


/** 罫線か背景のある領域 (紙面の上の位置と大きさ、罫線のある辺) */
function boxes(tree: Tree) {
  const out: Array<{ x: number; y: number; w: number; h: number; bg?: string; sides: string; page: number }> = [];
  tree.sheets.forEach((sheet, page) => {
    const visit = (a: Node, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      const b = a.border as Record<string, { width: number } | undefined> | undefined;
      const sides = ['top', 'right', 'bottom', 'left'].filter((k) => (b?.[k]?.width ?? 0) > 0).join(',');
      if (sides || a.backgroundColor) out.push({ x, y, w: a.width, h: a.height, ...(a.backgroundColor ? { bg: a.backgroundColor } : {}), sides, page });
      for (const c of childrenOf(a)) visit(c, x, y);
    };
    visit(sheet, 0, 0);
  });
  return out;
}

describe('割注の要素の罫線・余白・背景', () => {
  const css = '.f { border: 1pt solid #c00; padding: 0 2pt; margin: 0 3pt } .b { background-color: #ff0 }';
  /** 字の領域の範囲 (紙面の上) */
  const extent = (gs: G[]) => ({ x0: Math.min(...gs.map((g) => g.x)), x1: Math.max(...gs.map((g) => g.x + g.w)), y0: Math.min(...gs.map((g) => g.y)), y1: Math.max(...gs.map((g) => g.y + g.h)) });
  const covers = (b: { x: number; y: number; w: number; h: number }, e: ReturnType<typeof extent>) => b.x <= e.x0 + 0.01 && e.x1 <= b.x + b.w + 0.01 && b.y <= e.y0 + 0.01 && e.y1 <= b.y + b.h + 0.01;

  it('横書き: 罫線・余白は括弧の外側に 1 つ付け、2 行の中には描かない。背景は括弧を含む全体に塗る', async () => {
    const r = await typeset(html('<p>本文<span class="w f b">割注の中身です</span>後</p>', css), opts);
    const gs = glyphs(r.areaTree);
    const bs = boxes(r.areaTree);
    const framed = bs.filter((b) => b.sides);
    expect(framed.length).toBe(1);
    expect(framed[0].sides).toBe('top,right,bottom,left');
    // 罫線の箱は、括弧と割注の 2 行を囲む (縦は 2 行の厚さ 12pt + 余白 0 + 罫線 1pt × 2)
    const wari = gs.filter((g) => g.size === 6 || /[（）]/.test(g.text));
    const rows = gs.filter((g) => g.size === 6);
    expect(framed[0].h).toBeCloseTo(12 + 2, 1);
    const open = gs.find((g) => g.text === '（')!;
    const close = gs.find((g) => g.text === '）')!;
    expect(framed[0].x).toBeLessThan(open.x + open.w / 2);
    expect(framed[0].x + framed[0].w).toBeGreaterThan(close.x + close.w / 2);
    expect(framed[0].y).toBeLessThanOrEqual(extent(rows).y0);
    expect(framed[0].y + framed[0].h).toBeGreaterThanOrEqual(extent(rows).y1);
    // 背景は、括弧から括弧までと 2 行の厚さを覆う (2 行の中だけに塗る小さな箱は無い)。枠の背景と字の背景の 2 つの箱で塗るのは、
    // ほかの行内の要素と同じ
    const fills = bs.filter((b) => b.bg === '#ffff00');
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(covers(f, { ...extent(rows), x0: open.x + open.w / 2, x1: close.x + close.w / 2 })).toBe(true);
    void wari;
    // 外側の余白 (margin 3pt) と余白・罫線 (2pt + 1pt) の分、前後の字から離れる
    const hon = gs.find((g) => g.text === '文')!;
    expect(framed[0].x - (hon.x + hon.w)).toBeCloseTo(3, 1);
  });

  it('上下の余白・罫線で行の高さを変えない (CSS 2.1 §10.6.1)', async () => {
    const a = glyphs((await typeset(html('<p>本文<span class="w f" style="padding: 4pt">割注の中身</span><br>次の行</p>', css), opts)).areaTree);
    const b = glyphs((await typeset(html('<p>本文<span class="w">割注の中身</span><br>次の行</p>', css), opts)).areaTree);
    expect(a.find((g) => g.text === '次')!.y).toBeCloseTo(b.find((g) => g.text === '次')!.y, 3);
  });

  it('縦書き: 罫線の箱は、割注の 2 行 (右と左) と括弧を囲む', async () => {
    const r = await typeset(html('<p>本文<span class="w f b">割注の中身です</span>後</p>', css, 'vertical-rl'), opts);
    const gs = glyphs(r.areaTree);
    const framed = boxes(r.areaTree).filter((b) => b.sides);
    expect(framed.length).toBe(1);
    const rows = gs.filter((g) => g.size === 6);
    // 縦書きの block 方向 (左右) の余白は padding-left・padding-right の 2pt ずつ。2 行の厚さ 12pt + 余白 4pt + 罫線 2pt
    expect(framed[0].w).toBeCloseTo(12 + 4 + 2, 1);
    expect(covers(framed[0], extent(rows))).toBe(true);
    const open = gs.find((g) => g.text === '（')!;
    expect(framed[0].y).toBeLessThan(open.y + open.h / 2);
  });

  const long = 'ここに長い割注を入れて、行末で分けて次の行に続ける例。分けた所の罫線。';
  for (const [decoration, wm] of [['slice', 'horizontal-tb'], ['clone', 'horizontal-tb'], ['slice', 'vertical-rl'], ['clone', 'vertical-rl']] as const) {
    it(`行をまたぐ割注の罫線 (box-decoration-break: ${decoration}、${wm})`, async () => {
      // margin は 0 (clone は行末にも罫線・余白・margin を付け直すので、margin があると 1 行目に割注の 1 列が入らない)
      const doc = html(`<p>本文の字が続きます<span class="w f" style="box-decoration-break: ${decoration}; margin: 0">${long}</span>の後ろの本文。</p>`, `${css} @page { size: 70mm 70mm }`, wm);
      const r = await typeset(doc, opts);
      const framed = boxes(r.areaTree).filter((b) => b.sides);
      const ps = pieces(glyphs(r.areaTree), wm !== 'horizontal-tb');
      expect(ps.length).toBe(2);
      expect(framed.length).toBe(2);
      // 行の並ぶ向きの順 (横書きは上から、縦書きは右から)
      framed.sort((p, q) => (wm === 'horizontal-tb' ? p.y - q.y : q.x - p.x));
      const [start, end] = wm === 'horizontal-tb' ? ['left', 'right'] : ['top', 'bottom'];
      const has = (b: { sides: string }, side: string) => b.sides.split(',').includes(side);
      // slice: 分けた所の側 (1 つ目の終わり・2 つ目の始まり) には付けない。clone: どちらにも付ける
      expect(has(framed[0], start)).toBe(true);
      expect(has(framed[1], end)).toBe(true);
      expect(has(framed[0], end)).toBe(decoration === 'clone');
      expect(has(framed[1], start)).toBe(decoration === 'clone');
    });
  }
});

describe('割注の要素の罫線・余白: XSL-FO', () => {
  const fo = (attrs: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:k="https://github.com/n-lights-co/kumiori/ns" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-size="12pt" line-height="2">本文<fo:inline k:warichu="auto" font-size="6pt" ${attrs}>割注の中身です</fo:inline>後<fo:block/>次の行</fo:block></fo:flow></fo:page-sequence></fo:root>`;
  it('罫線の箱は括弧と 2 行を囲み、上下の余白・罫線で行の高さを変えない (XSL 1.1 §4.2.3)', async () => {
    const r = await typeset(fo('border="1pt solid red" padding="4pt"'), { ...opts, kind: 'fo' });
    const plain = await typeset(fo(''), { ...opts, kind: 'fo' });
    const gs = glyphs(r.areaTree);
    expect(gs.find((g) => g.text === '次')!.y).toBeCloseTo(glyphs(plain.areaTree).find((g) => g.text === '次')!.y, 3);
    const framed = boxes(r.areaTree).filter((b) => b.sides);
    expect(framed.length).toBe(1);
    // 2 行の厚さ 12pt + 上下の余白 8pt + 罫線 2pt
    expect(framed[0].h).toBeCloseTo(12 + 8 + 2, 1);
    const rows = gs.filter((g) => g.size === 6);
    expect(framed[0].y).toBeLessThan(Math.min(...rows.map((g) => g.y)));
    expect(framed[0].y + framed[0].h).toBeGreaterThan(Math.max(...rows.map((g) => g.y + g.h)));
  });
});

describe('割注: 2 度目のレビューの指摘', () => {
  const css = '.f { border: 1pt solid #c00; padding: 0 2pt } .b { background-color: #ff0 } .n { -kumiori-warichu-brackets: none }';
  const extent = (gs: G[]) => ({ x0: Math.min(...gs.map((g) => g.x)), x1: Math.max(...gs.map((g) => g.x + g.w)), y0: Math.min(...gs.map((g) => g.y)), y1: Math.max(...gs.map((g) => g.y + g.h)) });

  it('括弧なしの割注の先頭に、別の背景の要素や目印があっても、割注の背景を 2 行の全体に塗る', async () => {
    for (const head of ['<b style="background-color: #f00">先</b>', '<a id="x"></a>先']) {
      const r = await typeset(html(`<p>本文<span class="w b n">${head}頭の割注の中身</span>後</p>`, css), opts);
      const rows = extent(glyphs(r.areaTree).filter((g) => g.size === 6));
      const yellow = boxes(r.areaTree).filter((b) => b.bg === '#ffff00');
      expect(yellow.length, head).toBeGreaterThan(0);
      expect(yellow.some((b) => b.x <= rows.x0 + 0.01 && rows.x1 <= b.x + b.w + 0.01 && b.y <= rows.y0 + 0.01 && rows.y1 <= b.y + b.h + 0.01), head).toBe(true);
      // 中の要素の背景 (赤) は、2 行の中の、その字の所だけ
      for (const red of boxes(r.areaTree).filter((b) => b.bg === '#ff0000')) expect(red.h, head).toBeLessThan(7);
    }
  });

  it('行をまたいだ割注の 2 つ目の部分 (開きの括弧の無い部分) にも、割注の背景を塗る', async () => {
    const long = 'ここに長い割注を入れて、行末で分けて次の行に続ける例。分けた所の背景。';
    const r = await typeset(html(`<p>本文の字が続きます<span class="w b">${long}</span>の後ろの本文。</p>`, `${css} @page { size: 70mm 70mm }`), opts);
    const gs = glyphs(r.areaTree).filter((g) => g.size === 6);
    const lines = [...new Set(gs.map((g) => Math.round(g.y / 20)))];
    expect(lines.length).toBe(2);
    const yellow = boxes(r.areaTree).filter((b) => b.bg === '#ffff00');
    for (const ln of lines) {
      const e = extent(gs.filter((g) => Math.round(g.y / 20) === ln));
      expect(yellow.some((b) => b.x <= e.x0 + 0.01 && e.x1 <= b.x + b.w + 0.01 && b.y <= e.y0 + 0.01 && e.y1 <= b.y + b.h + 0.01)).toBe(true);
    }
  });

  it('割注の中の要素の罫線は、括弧なしで中身の全部を覆っていても、2 行の中に描く', async () => {
    const r = await typeset(html('<p>本文<span class="w n"><b class="f">全部の中身です</b></span>後</p>', css), opts);
    const framed = boxes(r.areaTree).filter((b) => b.sides);
    expect(framed.length).toBe(2);
    // どちらも 1 行分の高さ (6pt + 罫線 2pt) の箱
    for (const f of framed) expect(f.h).toBeLessThan(9);
  });

  it('割注の中の要素の罫線・余白の空きは 2 字の組に数えず、本文の行から溢れない', async () => {
    for (let mm = 40; mm <= 60; mm++) {
      const doc = html('<p style="text-align: justify">本文の字が並ぶ<span class="w">割注の<b style="border: 1pt solid #c00; padding: 0 5pt">中の要素</b>を含む長めの中身が続いて次の行に入る</span>の後ろの本文です。</p>', css).replace('size: 120mm 80mm', `size: ${mm + 20}mm 80mm`);
      const r = await typeset(doc, opts);
      const right = ((mm + 10) * 72) / 25.4;
      // 割注の字と、中の要素の罫線の箱の右端が、本文の領域の右端を超えない
      const wari = glyphs(r.areaTree).filter((g) => g.size === 6);
      expect(Math.max(...wari.map((g) => g.x + g.w)), `${mm}mm`).toBeLessThanOrEqual(right + 0.01);
      for (const f of boxes(r.areaTree).filter((b) => b.sides)) expect(f.x + f.w, `${mm}mm`).toBeLessThanOrEqual(right + 0.01);
    }
  });

  it('::first-line のある段落の 1 行目でも、割注の中の約物を詰める', async () => {
    const body = '<p>本文<span class="w">「注、「例」」と括弧の続く割注</span>の後ろ。</p>';
    const a = glyphs((await typeset(html(body, 'p::first-line { color: #c00 }'), opts)).areaTree).filter((g) => g.size === 6);
    const b = glyphs((await typeset(html(body), opts)).areaTree).filter((g) => g.size === 6);
    expect(a.map((g) => [g.text, Math.round(g.x * 100) / 100, Math.round(g.y * 100) / 100])).toEqual(b.map((g) => [g.text, Math.round(g.x * 100) / 100, Math.round(g.y * 100) / 100]));
  });
});

describe('割注: 組めない中身と、効かない指定', () => {
  const foDoc = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:k="https://github.com/n-lights-co/kumiori/ns" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-size="12pt">${body}</fo:block></fo:flow></fo:page-sequence></fo:root>`;

  it('割注の中の割注は、内側を割注にせず、警告に出す (括弧は外側の 1 組だけ)', async () => {
    const r = await typeset(html('<p>本文の字<span class="w">外の割注の字と<span class="w">内の割注</span>の続き</span>の後ろ。</p>'), opts);
    expect(r.warnings.join('\n')).toContain('-kumiori-warichu (割注の中の割注)');
    const gs = glyphs(r.areaTree);
    expect(gs.filter((g) => /[（）]/.test(g.text)).map((g) => `${g.text}${g.size}`)).toEqual(['（12', '）12']);
    expect(pieces(gs)).toEqual([['外の割注の字と', '内の割注の続き']]);
    const f = await typeset(foDoc('本文<fo:inline k:warichu="auto" font-size="6pt">外の割注の字と<fo:inline k:warichu="auto">内の割注</fo:inline>の続き</fo:inline>後'), { ...opts, kind: 'fo' });
    expect(f.warnings.join('\n')).toContain('kumiori:warichu (割注の中の割注)');
    expect(glyphs(f.areaTree).filter((g) => /[（）]/.test(g.text)).length).toBe(2);
  });

  it('XSL-FO: ブロックを含む fo:inline を重ねた中の割注は、どれも割注にする。数が多くても、判定の手間が数の 2 乗にならない', async () => {
    const W = '<fo:inline k:warichu="auto">';
    const doc = (n: number, d: number) =>
      `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:k="https://github.com/n-lights-co/kumiori/ns" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>本文${W.repeat(d)}${`${W}割注</fo:inline>`.repeat(n)}<fo:block/>${'</fo:inline>'.repeat(d)}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const small = await typeset(doc(3, 5), { ...opts, kind: 'fo' });
    expect(glyphs(small.areaTree).filter((g) => g.text === '（').length).toBe(3);
    expect(small.warnings.join('\n')).not.toContain('割注の中の割注');
    // 100 段の中の 600 個 (前は、割注ごとに祖先の部分木を見直して 20 秒を超えていた)
    const t0 = Date.now();
    await typeset(doc(600, 100), { ...opts, kind: 'fo' });
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 60_000);

  it('ブロックを含む割注の、そのブロックの中の割注は、入れ子と見なさずに割注にする', async () => {
    const r = await typeset(html('<p>本文<span class="w">前<div>ブロック<span class="w">内側の割注の字の並び</span>続き</div>後</span>終わり</p>'), opts);
    expect(r.warnings.join('\n')).not.toContain('割注の中の割注');
    const gs = glyphs(r.areaTree);
    // 外側はブロックの前後の 2 つの割注、内側はブロックの中の割注 (括弧は 3 組)
    expect(gs.filter((g) => /[（）]/.test(g.text)).length).toBe(6);
    // 内側の割注は 2 行に割る (ブロックの字は、外側の割注の字の大きさを受け継ぐ)
    const y = (t: string) => gs.find((g) => g.text === t)!.y;
    expect(y('並')).toBeGreaterThan(y('内') + 2);
    // 行内の要素だけを挟んだ割注の中の割注は、これまでどおり入れ子 (内側は割注にしない)
    const nested = await typeset(html('<p>本文<span class="w">外の割注の字と<em><span class="w">内の割注</span></em>の続き</span>後</p>'), opts);
    expect(nested.warnings.join('\n')).toContain('-kumiori-warichu (割注の中の割注)');
  });

  it('割注の中の字でない箱 (inline-block・fo:inline-container) の中の割注は、箱の警告だけを出す (HTML と XSL-FO で同じ)', async () => {
    const h = await typeset(html('<p>本文<span class="w">外の割注<span style="display:inline-block"><span class="w">内の割注</span></span>続き</span>後</p>'), opts);
    const fo = await typeset(foDoc('本文<fo:inline k:warichu="auto" font-size="6pt">外の割注<fo:inline-container><fo:block><fo:inline k:warichu="auto">内の割注</fo:inline></fo:block></fo:inline-container>続き</fo:inline>後'), { ...opts, kind: 'fo' });
    for (const r of [h, fo]) {
      const w = r.warnings.join('\n');
      expect(w).toContain('割注の中の文字でないボックス');
      expect(w).not.toContain('割注の中の割注');
    }
  });

  it('中身が空白だけの割注は、割注にしない (空の括弧を描かない)', async () => {
    const r = await typeset(html('<p>本文の後<span class="w"> </span>ろ。</p>'), opts);
    expect(glyphs(r.areaTree).some((g) => /[（）]/.test(g.text))).toBe(false);
    const f = await typeset(foDoc('本文の後<fo:inline k:warichu="auto" font-size="6pt"> </fo:inline>ろ。'), { ...opts, kind: 'fo' });
    expect(glyphs(f.areaTree).some((g) => /[（）]/.test(g.text))).toBe(false);
  });

  it('画像・inline-block などの字でない箱は、割注の中では組まず、警告に出す', async () => {
    const r = await typeset(html('<p>本文<span class="w">中に<span style="display: inline-block; width: 20pt; height: 10pt; background: #f00"></span>箱と</span>後</p>'), opts);
    expect(r.warnings.join('\n')).toContain('割注の中の文字でないボックス');
    expect(boxes(r.areaTree).some((b) => b.bg === '#ff0000')).toBe(false);
    expect(pieces(glyphs(r.areaTree))).toEqual([['中に', '箱と']]);
    // 字でない箱だけの割注は、中身の無い割注と同じく、括弧を置かない
    const only = await typeset(html('<p>本文<span class="w"><span style="display: inline-block; width: 20pt; height: 10pt"></span></span>後</p>'), opts);
    expect(glyphs(only.areaTree).some((g) => /[（）]/.test(g.text))).toBe(false);
    const f = await typeset(foDoc('本文<fo:inline k:warichu="auto" font-size="6pt">中に<fo:inline-container width="20pt" height="10pt" background-color="#ff0000"><fo:block/></fo:inline-container>箱と</fo:inline>後'), { ...opts, kind: 'fo' });
    expect(f.warnings.join('\n')).toContain('割注の中の文字でないボックス');
    expect(boxes(f.areaTree).some((b) => b.bg === '#ff0000')).toBe(false);
  });

  it('display が inline でない要素の -kumiori-warichu: auto は、警告に出す', async () => {
    const r = await typeset(html('<div style="-kumiori-warichu: auto">ブロック</div><p>本文<span class="w" style="display: inline-block">箱</span>後</p>'), opts);
    const w = r.warnings.join('\n');
    expect(w).toContain('-kumiori-warichu (行内の要素 (display: inline) でないもの');
    expect(r.diagnostics.find((d) => d.message.includes('行内の要素 (display: inline) でないもの'))?.count).toBe(2);
    expect(glyphs(r.areaTree).some((g) => /[（）]/.test(g.text))).toBe(false);
    // 割注にできる要素には出さない
    const ok = await typeset(html('<p>本文<span class="w">割注</span>後</p>'), opts);
    expect(ok.warnings.join('\n')).not.toContain('kumiori');
  });

  it('ブロックの箱になる要素 (リスト項目・絶対配置・float・フレックスやグリッドの項目) の -kumiori-warichu: auto は、割注にせず警告に出す', async () => {
    for (const body of [
      '<ul><li class="w">項目</li></ul>',
      '<p>本文<span class="w" style="position: absolute">絶対配置</span>後</p>',
      '<p>本文<span class="w" style="float: left">回り込み</span>後</p>',
      '<p style="display: flex"><span class="w">フレックスの項目</span></p>',
      '<p style="display: grid"><span style="display: contents"><span class="w">グリッドの項目</span></span></p>',
    ]) {
      const r = await typeset(html(body), opts);
      expect(r.warnings.join('\n'), body).toContain('-kumiori-warichu (行内の要素 (display: inline) でないもの');
      expect(r.diagnostics.find((d) => d.message.includes('行内の要素 (display: inline) でないもの'))?.count, body).toBeUndefined();
      expect(glyphs(r.areaTree).some((g) => /[（）]/.test(g.text)), body).toBe(false);
    }
    // 組まない要素 (display: none) には出さない
    const none = await typeset(html('<p>本文<span class="w" style="display: none">隠す</span>後</p>'), opts);
    expect(none.warnings.join('\n')).not.toContain('kumiori');
  });

  it('XSL-FO: 名前空間を宣言せずに kumiori: の属性を書くと、宣言の書き方を案内する', async () => {
    const src = foDoc('本文<fo:inline kumiori:warichu="auto" font-size="6pt">割注</fo:inline>後').replace(' xmlns:k="https://github.com/n-lights-co/kumiori/ns"', '');
    await expect(typeset(src, { ...opts, kind: 'fo' })).rejects.toThrow('xmlns:kumiori="https://github.com/n-lights-co/kumiori/ns"');
  });
});

describe('割注: ルビのある 2 行目と、互換モードの行送り', () => {
  it('上付き・下付きの字は、はみ出す分だけ 2 行の間を空けて、もう 1 つの行の字に重ねない', async () => {
    const sup = glyphs((await typeset(html('<p>本文<span class="w">割注の一行目の字の並び<sup>上付き</sup>二行目の字</span>後。</p>'), opts)).areaTree);
    const one = sup.find((g) => g.text === '一')!;
    const up = sup.find((g) => g.text === '上')!;
    const two = sup.find((g) => g.text === '二')!;
    expect(up.y).toBeGreaterThanOrEqual(one.y + one.h - 0.01);
    expect(up.y).toBeLessThan(two.y);
    // 空けた分は上下に半分ずつ (2 行の中心は本文の字の中心のまま)
    const hon = sup.find((g) => g.text === '本')!;
    expect((one.y + two.y + two.h) / 2).toBeCloseTo(hon.y + hon.h / 2, 1);
    const sub = glyphs((await typeset(html('<p>本文<span class="w">一行目<sub>下付き</sub>の字の並び二行目の字の並び</span>後。</p>'), opts)).areaTree);
    const down = sub.find((g) => g.text === '下')!;
    const ni = sub.find((g) => g.text === '二')!;
    expect(down.y + down.h).toBeLessThanOrEqual(ni.y + 0.01);
    expect(down.y + down.h).toBeGreaterThan(sub.find((g) => g.text === '一')!.y + 6);
    // XSL-FO の baseline-shift も同じ
    const fo = `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:k="https://github.com/n-lights-co/kumiori/ns" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="60mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-size="12pt">本文<fo:inline k:warichu="auto" font-size="6pt">割注の一行目の字の並び<fo:inline baseline-shift="super" font-size="5pt">上付き</fo:inline>二行目の字</fo:inline>後</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const f = glyphs((await typeset(fo, { ...opts, kind: 'fo' })).areaTree);
    expect(f.find((g) => g.text === '上')!.y).toBeGreaterThanOrEqual(f.find((g) => g.text === '一')!.y + 6 - 0.01);
  });

  it('1 行目だけで組む割注は、下付き・大きい字があっても 2 行の間を空けず、1 行目をずらさない', async () => {
    // 割注の外の同じ字の並び (同じ基線) での、下付き・大きい字と、ふつうの字の上下の差
    const y = async (body: string, t: string) => glyphs((await typeset(html(body), opts)).areaTree).find((g) => g.text === t)!.y;
    for (const [inner, t] of [['<sub>下</sub>', '下'], ['<span style="font-size:10pt">大</span>', '大']] as const) {
      const plain = await y(`<p>本文<span style="font-size:6pt">字${inner}</span>後</p>`, '字');
      const odd = await y(`<p>本文<span style="font-size:6pt">字${inner}</span>後</p>`, t);
      // 1 字だけの割注 (1 行目だけ) の、ふつうの字と、下付き・大きい字の位置。行の基線は中身によらないので、差は割注の外と同じ
      const w1 = await y('<p>本文<span class="w">字</span>後</p>', '字');
      const w2 = await y(`<p>本文<span class="w">${inner}</span>後</p>`, t);
      expect(w2 - w1, inner).toBeCloseTo(odd - plain, 2);
    }
  });

  it('2 行目にルビがあれば、2 行の間をルビの分空けて、ルビを 1 行目に重ねない', async () => {
    const r = await typeset(html('<p>本文<span class="w">割注の一行目の字の並び<ruby>漢字<rt>かんじ</rt></ruby>二行目</span>後</p>'), opts);
    const gs = glyphs(r.areaTree);
    const ruby = gs.filter((g) => Math.abs(g.size - 3) < 0.01);
    expect(ruby.map((g) => g.text).join('')).toBe('かんじ');
    const [row1, row2] = pieces(gs);
    expect(row1).toEqual(['割注の一行目の字', 'の並び漢字二行目']);
    const one = gs.find((g) => g.text === '一')!;
    const kan = gs.find((g) => g.text === '漢')!;
    // ルビは、1 行目の字の下端と 2 行目の親文字の上端の間に収まる
    for (const g of ruby) {
      expect(g.y).toBeGreaterThanOrEqual(one.y + one.h - 0.01);
      expect(g.y + g.h).toBeLessThanOrEqual(kan.y + 0.01);
    }
    expect(row2).toBeUndefined();
    // 空けた分は、割注の 2 行の上下に半分ずつ出す (2 行の中心は、本文の字の中心のまま)。行の高さは変えない
    const ji = gs.find((g) => g.text === '本')!;
    expect((one.y + kan.y + kan.h) / 2).toBeCloseTo(ji.y + ji.h / 2, 1);
    const plain = glyphs((await typeset(html('<p>本文<span class="w">割注の一行目の字の並び漢字二行目</span>後</p>'), opts)).areaTree);
    expect(gs.find((g) => g.text === '本')!.y).toBeCloseTo(plain.find((g) => g.text === '本')!.y, 3);
    // 2 行目にルビの無い割注は、2 行の間を空けない
    expect(plain.find((g) => g.text === '漢')!.y - plain.find((g) => g.text === '一')!.y).toBeCloseTo(6, 3);
  });

  it('1 行目のルビは、2 行の間を空けない (本文の行の上へ出る)', async () => {
    const gs = glyphs((await typeset(html('<p>本文<span class="w"><ruby>漢字<rt>かんじ</rt></ruby>の並ぶ一行目と二行目</span>後</p>'), opts)).areaTree);
    const [first] = pieces(gs);
    expect(first[0].startsWith('漢字')).toBe(true);
    const kan = gs.find((g) => g.text === '漢')!;
    const two = gs.find((g) => g.text === '二')!;
    expect(two.y - kan.y).toBeCloseTo(6, 3);
  });

  it('HTML の互換モード (DOCTYPE の無い文書) でも、割注だけの行の行送りを詰めない', async () => {
    const body = `<p>本文<span class="w">${'長い割注の字の並び'.repeat(30)}</span>後</p>`;
    const rows = async (src: string) => [...new Set(glyphs((await typeset(src, opts)).areaTree).filter((g) => g.size === 6).map((g) => Math.round(g.y * 100) / 100))];
    const std = await rows(html(body));
    const quirks = await rows(html(body).replace('<!DOCTYPE html>', ''));
    expect(std.length).toBeGreaterThanOrEqual(6);
    expect(quirks).toEqual(std);
  });
});
