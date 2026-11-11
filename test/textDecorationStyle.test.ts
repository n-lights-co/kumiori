/**
 * 文字の飾り (HTML+CSS):
 *  - 線の種類 text-decoration-style (CSS Text Decoration 3 §2.2: solid・double・dotted・dashed・wavy)
 *  - 一括指定 text-decoration (同 §2.4。太さを含む形は CSS Text Decoration 4 §2.6)
 *  - 線の太さ text-decoration-thickness (CSS Text Decoration 4 §2.4)、下線のずらし text-underline-offset (同 §2.8)
 *  - 圏点の色 text-emphasis-color (CSS Text Decoration 3 §3.2)、側 text-emphasis-position (同 §3.4)、一括指定 text-emphasis (同 §3.3)
 * 指定の無い文書では、線は今までと同じ形 (字の大きさの 6% の実線の箱) で、Area Tree に新しい欄は出ない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { childrenOf, serializeAreaTree } from '../src/areaTree';
import { paintSheet } from '../src/paint';
import { matchSupports } from '../src/htmlPaged';
import { makeEngine } from './helpers';
import type { Area, BlockArea, GlyphArea, LRuby } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

function load(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const styles = cascadeStyles(d, css, { viewport: { width: 600, height: 800 } });
  return { ...importHtml(d, styles, { css }), styles, d };
}
/** 計算値 (最初に見つかった要素) */
function computed(body: string, sel: string, prop: string, css = '') {
  const r = load(body, css);
  const el = Array.from(r.d.getElementsByTagName(sel))[0] as unknown as Element;
  return r.styles.style(el).getPropertyValue(prop).trim();
}
interface Placed {
  a: Area;
  x: number;
  y: number;
}
/** 組んだ領域 (ページの左上からの位置) */
function areas(body: string, css = ''): Placed[] {
  const out: Placed[] = [];
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    out.push({ a, x, y });
    for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
  };
  E.engine.layout(load(body, css).document).sheets.forEach((s) => rec(s.page, 0, 0));
  return out;
}
/** 飾りの線の箱 (行の中の、子の無い薄い箱: 背景で塗る実線か、1 辺の罫線で描く線)。本文は 10pt、線は横書きで試す */
const decoLines = (ps: Placed[]) =>
  ps.filter((p) => p.a.type === 'block' && childrenOf(p.a).length === 0 && p.a.height < 5 && p.a.width > 5 && (p.a.backgroundColor || p.a.border?.top)) as Array<Placed & { a: BlockArea }>;
const glyphs = (ps: Placed[]) => ps.filter((p) => p.a.type === 'glyph') as Array<Placed & { a: GlyphArea }>;
/** 字の基線の位置 (ページの上から) */
const baselineOf = (g: Placed & { a: GlyphArea }) => g.y + g.a.baselineY;
const P = 'font-size: 10pt; line-height: 20pt;';

describe('text-decoration-style (CSS Text Decoration 3 §2.2)', () => {
  it('計算値: 個別の指定と一括指定。読めない値の宣言は捨てる', () => {
    expect(computed('<p><u style="text-decoration-style: wavy">a</u></p>', 'u', 'text-decoration-style')).toBe('wavy');
    expect(computed('<p><u style="text-decoration: underline dotted red">a</u></p>', 'u', 'text-decoration-style')).toBe('dotted');
    expect(computed('<p><u style="text-decoration-style: wavy; text-decoration-style: groove">a</u></p>', 'u', 'text-decoration-style')).toBe('wavy');
    // 一括指定は、書いていない線の種類を初期値に戻す (§2.4: Omitted values are set to their initial values)
    expect(computed('<p><u style="text-decoration-style: wavy; text-decoration: underline">a</u></p>', 'u', 'text-decoration-style')).toBe('solid');
    // 受け継がない
    expect(computed('<p style="text-decoration-style: double"><u>a</u></p>', 'u', 'text-decoration-style')).toBe('solid');
  });

  it('@supports は、対応していると答える', () => {
    for (const c of ['text-decoration-style: wavy', 'text-decoration: underline wavy', 'text-decoration: underline 2px', 'text-decoration-thickness: from-font', 'text-underline-offset: 2px', 'text-emphasis-position: under', 'text-emphasis-position: over left', 'text-emphasis-color: red'])
      expect(matchSupports(`(${c})`), c).toBe(true);
    for (const c of ['text-decoration-style: groove', 'text-decoration-thickness: thin', 'text-underline-offset: from-font', 'text-emphasis-position: left', 'text-emphasis-position: over under']) expect(matchSupports(`(${c})`), c).toBe(false);
  });

  it('solid (初期値) は、今までと同じ 1 つの塗りの箱 (字の大きさの 6% の太さ)', () => {
    const a = decoLines(areas(`<p style="${P}"><u>下線の字</u></p>`));
    const b = decoLines(areas(`<p style="${P}"><u style="text-decoration-style: solid">下線の字</u></p>`));
    expect(a).toHaveLength(1);
    expect(a[0].a.height).toBeCloseTo(0.6, 3);
    expect(a[0].a.border?.top).toBeUndefined();
    expect(b.map((l) => [l.x, l.y, l.a.width, l.a.height, l.a.backgroundColor])).toEqual(a.map((l) => [l.x, l.y, l.a.width, l.a.height, l.a.backgroundColor]));
  });

  it('double は、同じ太さの線 2 本を、太さと同じだけ空けて引く。2 本目は字から離れる側 (下線は下、上線は上)', () => {
    const solid = decoLines(areas(`<p style="${P}"><u>下線の字</u></p>`))[0];
    const u = decoLines(areas(`<p style="${P}"><u style="text-decoration-style: double">下線の字</u></p>`));
    expect(u).toHaveLength(2);
    expect(u[0].y).toBeCloseTo(solid.y, 3);
    expect(u[1].y - u[0].y).toBeCloseTo(1.2, 3);
    expect(u.map((l) => l.a.height)).toEqual([solid.a.height, solid.a.height]);
    expect(u.map((l) => l.a.width)).toEqual([solid.a.width, solid.a.width]);
    const osolid = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline">上線の字</span></p>`))[0];
    const o = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline double">上線の字</span></p>`));
    expect(o[0].y).toBeCloseTo(osolid.y, 3);
    expect(o[1].y - o[0].y).toBeCloseTo(-1.2, 3);
    // 取り消し線は、実線の位置を中心に両側
    const ssolid = decoLines(areas(`<p style="${P}"><s>取り消しの字</s></p>`))[0];
    const s = decoLines(areas(`<p style="${P}"><s style="text-decoration-style: double">取り消しの字</s></p>`));
    expect((s[0].y + s[1].y) / 2).toBeCloseTo(ssolid.y, 3);
    expect(s[1].y - s[0].y).toBeCloseTo(1.2, 3);
  });

  it('dotted・dashed は、線の種類を持つ罫線 1 本。wavy は、線の太さと周期を持つ波線', () => {
    const solid = decoLines(areas(`<p style="${P}"><u>下線の字</u></p>`))[0];
    for (const st of ['dotted', 'dashed'] as const) {
      const [l, ...rest] = decoLines(areas(`<p style="${P}"><u style="text-decoration-style: ${st}; text-decoration-color: #ff0000">下線の字</u></p>`));
      expect(rest).toHaveLength(0);
      expect(l.a.border?.top).toEqual({ width: expect.closeTo(0.6, 3), color: '#ff0000', style: st });
      expect(l.a.backgroundColor).toBeUndefined();
      expect([l.x, l.y, l.a.width, l.a.height]).toEqual([solid.x, solid.y, solid.a.width, solid.a.height]);
    }
    const [w, ...rest] = decoLines(areas(`<p style="${P}"><u style="text-decoration-style: wavy">下線の字</u></p>`));
    expect(rest).toHaveLength(0);
    expect(w.a.border?.top).toEqual({ width: expect.closeTo(1.8, 3), color: '#000000', style: 'wave', waveStroke: expect.closeTo(0.6, 3), waveLength: expect.closeTo(3.6, 3) });
    // 波は、実線の位置を中心に振れる
    expect(w.y + w.a.height / 2).toBeCloseTo(solid.y + solid.a.height / 2, 3);
  });

  it('線の種類は、線を指定した要素のもの。子が線を指定し直せば子の種類、指定し直さなければ親の種類のまま', () => {
    const kinds = (body: string) =>
      decoLines(areas(body))
        .sort((a, b) => a.x - b.x)
        .map((l) => l.a.border?.top?.style ?? 'solid');
    // 子孫の text-decoration-style は、祖先の線を変えない (§2.2「even if descendant boxes specify a different style」)
    expect(kinds(`<p style="${P}"><u style="text-decoration-style: dotted">あ<span style="text-decoration-style: dashed">い</span></u></p>`)).toEqual(['dotted', 'dotted']);
    expect(kinds(`<p style="${P}"><u style="text-decoration-style: dotted">あ<u>い</u></u></p>`)).toEqual(['dotted', 'solid']);
    expect(kinds(`<p style="${P}"><u>あ<u style="text-decoration-style: dashed">い</u></u></p>`)).toEqual(['solid', 'dashed']);
  });

  it('UA の既定のスタイルシートの abbr[title] { text-decoration: dotted underline } (HTML の Rendering の節) は、点線の下線になる', () => {
    const l = decoLines(areas(`<p style="${P}"><abbr title="HyperText Markup Language">HTML</abbr> と <abbr>CSS</abbr></p>`));
    expect(l).toHaveLength(1);
    expect(l[0].a.border?.top?.style).toBe('dotted');
  });

  it('縦書き: 線の種類を持つ罫線は、行の進む向きに沿う辺 (vertical-rl は右、vertical-lr は左) に付く', () => {
    const v = (wm: string) =>
      areas(`<div style="writing-mode: ${wm}"><p style="${P}"><u style="text-decoration-style: dashed">縦の下線</u></p></div>`).filter((p) => p.a.type === 'block' && childrenOf(p.a).length === 0 && p.a.width < 5 && p.a.height > 5 && p.a.border) as Array<Placed & { a: BlockArea }>;
    const rl = v('vertical-rl');
    expect(rl).toHaveLength(1);
    expect(rl[0].a.border?.right).toEqual({ width: expect.closeTo(0.6, 3), color: '#000000', style: 'dashed' });
    expect(rl[0].a.width).toBeCloseTo(0.6, 3);
    const lr = v('vertical-lr');
    expect(lr[0].a.border?.left?.style).toBe('dashed');
    // 下線は字の左 (今までの実線と同じ位置)
    const g = glyphs(areas(`<div style="writing-mode: vertical-rl"><p style="${P}"><u style="text-decoration-style: dashed">縦の下線</u></p></div>`))[0];
    expect(rl[0].x).toBeLessThan(g.x);
  });

  it('描く: 点線は丸い点の並び、波線は線の太さの折れ線 (PDF と Canvas の共通の描き方)', () => {
    const paint = (style: string) => {
      const t = E.engine.layout(load(`<p style="${P}"><u style="text-decoration-style: ${style}">下線の字を描く</u></p>`).document);
      const calls: Array<[string, unknown[]]> = [];
      const p = new Proxy({} as Record<string, unknown>, {
        get: (_t, k: string) => (k === 'transform' ? (_m: unknown, d: () => void) => d() : (...args: unknown[]) => void calls.push([k, args])),
      });
      paintSheet(t.sheets[0], p as never);
      return calls;
    };
    const wavy = paint('wavy').filter(([k]) => k === 'strokePath');
    expect(wavy).toHaveLength(1);
    const [path, width, color] = wavy[0][1] as [Array<{ op: string; x: number; y: number }>, number, string];
    expect(width).toBeCloseTo(0.6, 3);
    expect(color).toBe('#000000');
    // 波の振れ幅は、線の中心で上下に太さの分ずつ (帯の高さ 3 × 太さ − 線の太さ)
    const ys = path.map((s) => s.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.2, 3);
    // 周期は太さの約 6 倍 (範囲に半波がちょうど収まるように伸び縮みする)
    const xs = path.map((s) => s.x);
    const mid = (Math.max(...ys) + Math.min(...ys)) / 2;
    let crossings = 0;
    for (let i = 1; i < path.length; i++) if ((ys[i - 1] - mid) * (ys[i] - mid) < 0 || (ys[i] === mid && i < path.length - 1)) crossings++;
    const period = ((Math.max(...xs) - Math.min(...xs)) / (crossings + 1)) * 2;
    expect(period).toBeGreaterThan(3);
    expect(period).toBeLessThan(4.2);
    expect(paint('dotted').filter(([k]) => k === 'fillPath').length).toBeGreaterThan(0);
    expect(paint('solid').filter(([k]) => k === 'strokePath' || k === 'fillPath')).toHaveLength(0);
  });
});

describe('text-decoration-thickness (CSS Text Decoration 4 §2.4)', () => {
  it('計算値: 長さは絶対の長さ、百分率と from-font はそのまま。一括指定からも読み、書かなければ auto に戻す (§2.6)', () => {
    expect(computed('<p><u style="font-size: 20px; text-decoration-thickness: 0.1em">a</u></p>', 'u', 'text-decoration-thickness')).toBe('2px');
    expect(computed('<p><u style="text-decoration-thickness: 10%">a</u></p>', 'u', 'text-decoration-thickness')).toBe('10%');
    expect(computed('<p><u style="text-decoration-thickness: from-font">a</u></p>', 'u', 'text-decoration-thickness')).toBe('from-font');
    expect(computed('<p><u style="text-decoration: underline 3px wavy blue">a</u></p>', 'u', 'text-decoration-thickness')).toBe('3px');
    expect(computed('<p><u style="text-decoration: underline 3px wavy blue">a</u></p>', 'u', 'text-decoration-color')).toBe('rgb(0, 0, 255)');
    expect(computed('<p><u style="text-decoration-thickness: 3px; text-decoration: underline">a</u></p>', 'u', 'text-decoration-thickness')).toBe('auto');
    expect(computed('<p style="text-decoration-thickness: 3px"><u>a</u></p>', 'u', 'text-decoration-thickness')).toBe('auto');
  });

  it('長さ: 下線・上線は、字に近い側の端を動かさずに外へ太る。取り消し線は中心を保つ', () => {
    const solid = decoLines(areas(`<p style="${P}"><u>下線の字</u></p>`))[0];
    const u = decoLines(areas(`<p style="${P}"><u style="text-decoration-thickness: 2pt">下線の字</u></p>`))[0];
    expect(u.a.height).toBeCloseTo(2, 3);
    expect(u.y).toBeCloseTo(solid.y, 3);
    const osolid = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline">上線の字</span></p>`))[0];
    const o = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline 2pt">上線の字</span></p>`))[0];
    expect(o.y + o.a.height).toBeCloseTo(osolid.y + osolid.a.height, 3);
    const ssolid = decoLines(areas(`<p style="${P}"><s>取り消しの字</s></p>`))[0];
    const s = decoLines(areas(`<p style="${P}"><s style="text-decoration-thickness: 2pt">取り消しの字</s></p>`))[0];
    expect(s.y + s.a.height / 2).toBeCloseTo(ssolid.y + ssolid.a.height / 2, 3);
  });

  it('百分率は、線を指定した要素の 1em に対する割合。子孫の字の大きさが違っても、同じ太さ', () => {
    const ls = decoLines(areas(`<p style="${P}"><u style="text-decoration-thickness: 20%">あ<span style="font-size: 20pt">大</span></u></p>`));
    expect(ls.length).toBeGreaterThanOrEqual(2);
    for (const l of ls) expect(l.a.height).toBeCloseTo(2, 3);
  });

  it('from-font は、書体の下線の太さ (post の表)。線の種類と組み合わせられる', () => {
    const font = E.fonts.get(undefined, 400);
    const expected = ((font.fk as unknown as { underlineThickness: number }).underlineThickness / font.unitsPerEm) * 10;
    expect(expected).toBeGreaterThan(0);
    const u = decoLines(areas(`<p style="${P}"><u style="text-decoration-thickness: from-font">下線の字</u></p>`))[0];
    expect(u.a.height).toBeCloseTo(expected, 3);
    const d = decoLines(areas(`<p style="${P}"><u style="text-decoration: underline double 1pt">下線の字</u></p>`));
    for (const l of d) expect(l.a.height).toBeCloseTo(1, 3);
    expect(d[1].y - d[0].y).toBeCloseTo(2, 3);
  });
});

describe('text-underline-offset (CSS Text Decoration 4 §2.8)', () => {
  it('計算値: 受け継ぐ。百分率は % のまま受け継ぐ', () => {
    expect(computed('<p style="text-underline-offset: 3px"><u>a</u></p>', 'u', 'text-underline-offset')).toBe('3px');
    expect(computed('<p style="text-underline-offset: 50%"><u>a</u></p>', 'u', 'text-underline-offset')).toBe('50%');
    expect(computed('<p><u>a</u></p>', 'u', 'text-underline-offset')).toBe('auto');
    // 一括指定 text-decoration は、下線のずらしを戻さない (§2.6)
    expect(computed('<p><u style="text-underline-offset: 3px; text-decoration: underline">a</u></p>', 'u', 'text-underline-offset')).toBe('3px');
  });

  it('長さ: 欧文の基線から、字から離れる向きへその長さだけ離れた所から、外へ太さの分だけ引く (§2.8.1)', () => {
    const top = (css: string) => {
      const ps = areas(`<p style="${P}"><u style="${css}">Underline</u></p>`);
      return decoLines(ps)[0].y - baselineOf(glyphs(ps)[0]);
    };
    expect(top('text-underline-offset: 3pt')).toBeCloseTo(3, 3);
    expect(top('text-underline-offset: 0')).toBeCloseTo(0, 3);
    // 負の値は字の側へ
    expect(top('text-underline-offset: -1pt')).toBeCloseTo(-1, 3);
    // 太さを変えても、字に近い側の端は同じ
    expect(top('text-underline-offset: 3pt; text-decoration-thickness: 2pt')).toBeCloseTo(3, 3);
    // 百分率は、線を指定した要素の 1em に対する割合
    expect(top('text-underline-offset: 25%')).toBeCloseTo(2.5, 3);
  });

  it('祖先の要素が指定した下線には、子孫の指定は効かない。上線・取り消し線には効かない', () => {
    const a = decoLines(areas(`<p style="${P}"><u>あ<span style="text-underline-offset: 4pt">い</span></u></p>`));
    expect(new Set(a.map((l) => l.y.toFixed(4))).size).toBe(1);
    const o = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline line-through">線の字</span></p>`)).map((l) => l.y);
    const o2 = decoLines(areas(`<p style="${P}"><span style="text-decoration: overline line-through; text-underline-offset: 4pt">線の字</span></p>`)).map((l) => l.y);
    expect(o2).toEqual(o);
  });

  it('縦書き: 欧文の基線 (字面の中央から下線の側へ) を基準に、左 (vertical-rl) へ離す', () => {
    const lineX = (css: string) => {
      const ps = areas(`<div style="writing-mode: vertical-rl"><p style="${P}"><u style="${css}">縦の下線</u></p></div>`);
      const l = ps.filter((p) => p.a.type === 'block' && childrenOf(p.a).length === 0 && p.a.width < 5 && p.a.height > 5 && p.a.backgroundColor)[0];
      const g = glyphs(ps)[0];
      // 字面の中央から、線の右端 (字に近い側) までの距離 (左が正)
      return g.x + g.a.width / 2 - (l.x + l.a.width);
    };
    const zero = lineX('text-underline-offset: 0');
    expect(zero).toBeCloseTo((0.88 - 0.5) * 10, 3);
    expect(lineX('text-underline-offset: 3pt') - zero).toBeCloseTo(3, 3);
  });
});

describe('圏点の色と側 (CSS Text Decoration 3 §3.2〜§3.4)', () => {
  const rubies = (body: string, css = '') => {
    const out: LRuby[] = [];
    const w = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(w);
      const o = n as Record<string, unknown>;
      if (o.type === 'ruby') out.push(o as unknown as LRuby);
      for (const k of Object.keys(o)) w(o[k]);
    };
    w(load(body, css).document.sequences[0].flow);
    return out;
  };

  it('text-emphasis-color の計算値: 初期値 currentcolor は、受け継いだ先の要素の字の色になる', () => {
    expect(computed('<p style="color: red; text-emphasis: dot"><b style="color: blue">字</b></p>', 'b', 'text-emphasis-color')).toBe('rgb(0, 0, 255)');
    expect(computed('<p style="color: red; text-emphasis: dot green"><b style="color: blue">字</b></p>', 'b', 'text-emphasis-color')).toBe('rgb(0, 128, 0)');
    expect(computed('<p style="text-emphasis-color: green"><b style="color: blue; text-emphasis-color: currentcolor">字</b></p>', 'b', 'text-emphasis-color')).toBe('rgb(0, 0, 255)');
    expect(computed('<p style="text-emphasis-color: green"><b style="color: blue; text-emphasis-color: initial"><i style="color: red">字</i></b></p>', 'i', 'text-emphasis-color')).toBe('rgb(255, 0, 0)');
  });

  it('一括指定 text-emphasis は、形と色に分ける。書いていない色は currentcolor に戻す。位置は戻さない (§3.3)', () => {
    expect(computed('<p><b style="text-emphasis: filled sesame #00f">字</b></p>', 'b', 'text-emphasis-style')).toBe('filled sesame');
    expect(computed('<p><b style="text-emphasis: red \'＊\'">字</b></p>', 'b', 'text-emphasis-style')).toBe("'＊'");
    expect(computed('<p><b style="text-emphasis: red \'＊\'">字</b></p>', 'b', 'text-emphasis-color')).toBe('rgb(255, 0, 0)');
    expect(computed('<p><b style="color: blue; text-emphasis-color: red; text-emphasis: dot">字</b></p>', 'b', 'text-emphasis-color')).toBe('rgb(0, 0, 255)');
    expect(computed('<p><b style="text-emphasis-position: under; text-emphasis: dot">字</b></p>', 'b', 'text-emphasis-position')).toBe('under');
  });

  it('色: 字の色と同じ (初期値) なら何も付けない。指定があれば圏点だけその色', () => {
    expect(rubies('<p><span style="text-emphasis: dot">圏点</span></p>')).toEqual([
      { type: 'ruby', baseText: '圏', rubyText: '•' },
      { type: 'ruby', baseText: '点', rubyText: '•' },
    ]);
    expect(rubies('<p style="color: blue"><span style="text-emphasis: dot; color: red">圏</span></p>')).toEqual([{ type: 'ruby', baseText: '圏', rubyText: '•' }]);
    expect(rubies('<p><span style="text-emphasis: dot red">圏</span></p>')).toEqual([{ type: 'ruby', baseText: '圏', rubyText: '•', rubyColor: '#ff0000' }]);
    const g = glyphs(areas(`<p style="${P}"><span style="text-emphasis-style: dot; text-emphasis-color: #ff0000">圏</span></p>`));
    expect(g.map((x) => [x.a.text, x.a.color])).toEqual([
      ['圏', '#000000'],
      ['•', '#ff0000'],
    ]);
  });

  it('横書き: over (初期値) は字の上、under は字の下。right・left は効かない', () => {
    const dy = (pos: string) => {
      const g = glyphs(areas(`<p style="${P}"><span style="text-emphasis-style: dot; ${pos}">圏</span></p>`));
      const [base, mark] = [g.find((x) => x.a.text === '圏')!, g.find((x) => x.a.text === '•')!];
      expect(mark.x + mark.a.width / 2).toBeCloseTo(base.x + base.a.width / 2, 3);
      return mark.y - base.y;
    };
    expect(dy('')).toBeCloseTo(-5, 3);
    expect(dy('text-emphasis-position: over left')).toBeCloseTo(-5, 3);
    expect(dy('text-emphasis-position: under')).toBeCloseTo(10, 3);
    expect(dy('text-emphasis-position: left under')).toBeCloseTo(10, 3);
    // 受け継ぐ
    expect(rubies('<div style="text-emphasis-position: under right"><p><span style="text-emphasis: dot blue">圏</span></p></div>')).toEqual([{ type: 'ruby', baseText: '圏', rubyText: '', rubyTextUnder: '•', rubyColorUnder: '#0000ff' }]);
  });

  it('縦書き (vertical-rl): right (初期値・省略) は字の右、left は字の左。over・under は効かない', () => {
    const dx = (pos: string) => {
      const g = glyphs(areas(`<div style="writing-mode: vertical-rl"><p style="${P}"><span style="text-emphasis-style: dot; ${pos}">圏</span></p></div>`));
      const [base, mark] = [g.find((x) => x.a.text === '圏')!, g.find((x) => x.a.text === '•')!];
      expect(mark.y + mark.a.height / 2).toBeCloseTo(base.y + base.a.height / 2, 3);
      return mark.x - base.x;
    };
    expect(dx('')).toBeCloseTo(10, 3);
    expect(dx('text-emphasis-position: under')).toBeCloseTo(10, 3);
    expect(dx('text-emphasis-position: under right')).toBeCloseTo(10, 3);
    expect(dx('text-emphasis-position: over left')).toBeCloseTo(-5, 3);
    expect(dx('text-emphasis-position: under left')).toBeCloseTo(-5, 3);
  });

  it('下・左の圏点も、行の高さにルビと同じだけ場所を取る (§3.4)', () => {
    const lineH = (pos: string) => areas(`<p style="font-size: 10pt; line-height: 10pt"><span style="text-emphasis-style: dot; ${pos}">圏</span></p>`).filter((p) => p.a.type === 'line')[0].a.height;
    expect(lineH('text-emphasis-position: under')).toBeCloseTo(lineH(''), 3);
    expect(lineH('')).toBeGreaterThan(10);
  });

  it('vertical-lr でも、right (初期値・省略) は字の右、left は字の左 (§3.4 の right・left は物理の向き。行の並ぶ向きでは、右が後ろの側)', () => {
    const r = (pos: string) => rubies(`<div style="writing-mode: vertical-lr"><p><span style="text-emphasis-style: dot; ${pos}">圏</span></p></div>`);
    // 右 = 行の並ぶ向きの後ろの側 (LRuby.rubyPosition: 'under')、左 = 前の側
    expect(r('')).toEqual([{ type: 'ruby', baseText: '圏', rubyText: '•', rubyPosition: 'under' }]);
    expect(r('text-emphasis-position: under right')).toEqual(r(''));
    expect(r('text-emphasis-position: over left')).toEqual([{ type: 'ruby', baseText: '圏', rubyText: '•' }]);
    const dx = (pos: string) => {
      const g = glyphs(areas(`<div style="writing-mode: vertical-lr"><p style="${P}"><span style="text-emphasis-style: dot; ${pos}">圏</span></p></div>`));
      const [base, mark] = [g.find((x) => x.a.text === '圏')!, g.find((x) => x.a.text === '•')!];
      return mark.x - base.x;
    };
    expect(dx('')).toBeCloseTo(10, 3);
    expect(dx('text-emphasis-position: over left')).toBeCloseTo(-5, 3);
  });
});

describe('飾りの指定を使わない文書', () => {
  it('Area Tree に新しい欄 (waveStroke・waveLength) は出ず、線は塗りの箱のまま', () => {
    const t = E.engine.layout(load(`<p style="${P}"><u>下線</u>と<s>取り消し</s>と<span style="text-decoration: overline #f00">上線</span>、<em style="text-emphasis: sesame">圏点</em></p>`).document);
    const json = serializeAreaTree(t);
    expect(json).not.toMatch(/waveStroke|waveLength|"wave"/);
    const r = load('<p><u>下線</u><em style="text-emphasis: sesame">圏点</em></p>');
    expect(JSON.stringify(r.document)).not.toMatch(/styles|thickness|underlineOffset|rubyColor|rubyTextUnder/);
  });
});
