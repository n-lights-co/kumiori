/**
 * CSS Paged Media 3 付録 A の、ページ文脈・余白の箱に効く CSS 2.1 の性質のうち、前は読んでいなかったもの:
 *  - @page の border (一括指定・個別の指定) と outline (§3: ページの箱は margin・border・padding・内容の領域を持つ)
 *  - 余白の箱の background-image (url()・グラデーション) と outline、min-width・max-width・min-height・max-height (§5.3・§5.3.2.3)
 * と、CSS GCPM 3 §2.4.2 の @footnote の max-height (脚注の領域の高さの上限)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import type { AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const MM = 72 / 25.4;
interface Box { x: number; y: number; w: number; h: number; a: AreaNode }
interface Pg { boxes: Box[]; glyphs: Array<{ text: string; x: number; y: number }> }
/** ページごとの、罫線か背景のある箱 (ページの左上からの位置) と字 */
function pages(t: AreaTree): Pg[] {
  const out: Pg[] = [];
  const rec = (a: AreaNode, ox: number, oy: number, pg: Pg) => {
    const x = ox + a.x;
    const y = oy + a.y;
    const any = a as { backgroundColor?: string; backgroundImage?: unknown };
    if (a.type !== 'page' && (a.border?.top || a.border?.bottom || a.border?.left || a.outline || any.backgroundColor || any.backgroundImage)) pg.boxes.push({ x, y, w: a.width, h: a.height, a });
    if (a.type === 'glyph') pg.glyphs.push({ text: (a as GlyphArea).text, x, y });
    for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0), y + a.padding.top + (a.border.top?.width ?? 0), pg);
  };
  for (const s of t.sheets) for (const p of childrenOf(s)) {
    const pg: Pg = { boxes: [], glyphs: [] };
    rec(p, 0, 0, pg);
    out.push(pg);
  }
  return out;
}
const run = async (css: string, body = '<p>B</p>') =>
  pages((await typesetHtml(`<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 20mm } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont, style: 'browser' })).areaTree);
/** 1 × 1 の PNG (赤) */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const g = (p: Pg, t: string) => p.glyphs.find((x) => x.text === t)!;

describe('@page の border と outline', () => {
  it('border はページの余白の内側に描き、本文の領域をその太さだけ狭める (余白の箱は動かない)', async () => {
    const [plain] = await run('@page { @top-left { content: "H" } }');
    const [p] = await run('@page { border: 3pt solid red; @top-left { content: "H" } }');
    const b = p.boxes.find((x) => x.a.border?.top?.width === 3)!;
    expect(b.x).toBeCloseTo(20 * MM, 1);
    expect(b.y).toBeCloseTo(20 * MM, 1);
    expect(b.w).toBeCloseTo(80 * MM, 1);
    expect(b.h).toBeCloseTo(40 * MM, 1);
    expect(g(p, 'B').x - g(plain, 'B').x).toBeCloseTo(3, 1);
    expect(g(p, 'B').y - g(plain, 'B').y).toBeCloseTo(3, 1);
    expect(g(p, 'H').y).toBeCloseTo(g(plain, 'H').y, 2);
  });
  it('個別の指定 (border-top-width・-style・-color) も読む', async () => {
    const [p] = await run('@page { border-top-width: 2pt; border-top-style: solid; border-top-color: blue }');
    const b = p.boxes.find((x) => x.a.border?.top?.width === 2)!;
    expect(b.a.border.top?.color).toBe('blue');
    expect(b.a.border.bottom).toBeUndefined();
  });
  it('outline は場所を取らず、ページの箱の罫線の箱の外に、offset だけ離して描く', async () => {
    const [plain] = await run('');
    const [p] = await run('@page { outline: 1pt solid red; outline-offset: 2pt }');
    // 輪郭線は、ページの箱の罫線の箱 (ページの余白の内側) の Area の輪郭線として描く (文書の要素と同じ)
    const b = p.boxes.find((x) => x.a.outline?.color === 'red')!;
    expect(b.x).toBeCloseTo(20 * MM, 1);
    expect(b.w).toBeCloseTo(80 * MM, 1);
    expect(b.a.outline).toMatchObject({ width: 1, offset: 2 });
    expect(g(p, 'B').y).toBeCloseTo(g(plain, 'B').y, 2);
  });
});

describe('余白の箱の background-image と outline', () => {
  it('グラデーションの背景', async () => {
    const [p] = await run('@page { @top-left { content: "H"; background-image: linear-gradient(red, blue) } }');
    // グラデーションは、組んだ後で箱の大きさの画像 (SVG) にする
    expect(p.boxes.some((x) => /^kumiori-gradient-/.test((x.a as { backgroundImage?: { src: string } }).backgroundImage?.src ?? ''))).toBe(true);
  });
  it('url() の背景の位置の初期値は左上 (0% 0%)', async () => {
    const [p] = await run(`@page { @top-left { content: "H"; background: url(${PNG}) no-repeat } }`);
    const img = p.boxes.map((x) => (x.a as { backgroundImage?: { src: string; x?: string; y?: string } }).backgroundImage).find(Boolean)!;
    expect(img.src).toMatch(/^data:image\/png/);
    expect([img.x ?? '0%', img.y ?? '0%']).toEqual(['0%', '0%']);
  });
  it('outline は箱の外に描き、箱の位置・大きさは変えない', async () => {
    const [plain] = await run('@page { @top-left { content: "H"; background-color: #eeeeee } }');
    const [p] = await run('@page { @top-left { content: "H"; background-color: #eeeeee; outline: 2pt dashed red } }');
    const box = (q: Pg) => q.boxes.find((x) => (x.a as { backgroundColor?: string }).backgroundColor === '#eeeeee')!;
    expect(box(p).x).toBeCloseTo(box(plain).x, 2);
    expect(box(p).w).toBeCloseTo(box(plain).w, 2);
    // 輪郭線は、余白の箱の Area の輪郭線として描く (文書の要素と同じ。角丸にも沿う)
    expect(box(p).a.outline).toMatchObject({ width: 2, color: 'red', style: 'dashed' });
    expect(p.boxes.some((x) => x.a.border?.top?.color === 'red')).toBe(false);
  });
});

describe('余白の箱の min-*・max-* (CSS Page 3 §5.3)', () => {
  const box = (p: Pg) => p.boxes.find((x) => (x.a as { backgroundColor?: string }).backgroundColor === '#eeeeee')!;
  it('上の箱の高さ (決まった向きの寸法): max-height で縮め、ページの本文の側に寄せる', async () => {
    const [p] = await run('@page { @top-left { content: "H"; background-color: #eeeeee; max-height: 5mm } }');
    expect(box(p).h).toBeCloseTo(5 * MM, 1);
    expect(box(p).y + box(p).h).toBeCloseTo(20 * MM, 1);
  });
  it('上の箱の幅 (変わる向きの寸法。§5.3.2.3): max-width で縮め、min-width で広げる', async () => {
    const [a] = await run('@page { @top-left { content: "Header text"; background-color: #eeeeee; max-width: 10mm } }');
    expect(box(a).w).toBeCloseTo(10 * MM, 1);
    const [b] = await run('@page { @top-left { content: "H"; background-color: #eeeeee; min-width: 30mm } @top-right { content: "R" } }');
    expect(box(b).w).toBeGreaterThanOrEqual(30 * MM - 0.1);
  });
  it('左の箱の高さ (変わる向きの寸法): max-height', async () => {
    const [p] = await run('@page { @left-middle { content: "L"; background-color: #eeeeee; max-height: 10mm } }');
    expect(box(p).h).toBeCloseTo(10 * MM, 1);
  });
});

describe('@footnote の max-height (GCPM 3 §2.4.2)', () => {
  const notes = Array.from({ length: 6 }, (_, k) => `<span class="fn">Note ${k + 1} text.</span>`).join('');
  const css = '.fn { float: footnote } @page { size: 120mm 160mm; @footnote { max-height: 40pt } }';
  it('脚注の領域は上限の高さを超えず、入らない脚注は次のページへ送る', async () => {
    const ps = await run(css, `<p>A${notes}</p>`);
    const free = await run(css.replace('max-height: 40pt', ''), `<p>A${notes}</p>`);
    // 上限が無ければ 1 ページに収まる脚注を、上限があれば複数のページに分ける
    expect(free.length).toBe(1);
    expect(ps.length).toBeGreaterThan(1);
    // 送った脚注も消えない (6 つの脚注の本文が、どれかのページにある)
    expect(ps.flatMap((p) => p.glyphs).filter((x) => x.text === 'N').length).toBe(6);
    for (const p of ps) {
      const ns = p.glyphs.filter((x) => x.text === 'N');
      if (ns.length < 2) continue;
      // 同じページの脚注の行の上下の幅は、上限の中
      expect(Math.max(...ns.map((x) => x.y)) - Math.min(...ns.map((x) => x.y))).toBeLessThan(40);
    }
  });
});

describe('@page の背景画像の位置 (CSS Backgrounds 3 §2.6)', () => {
  /** 用紙の背景画像の位置 (x・y の値) */
  const pos = async (decl: string) => {
    const r = await typesetHtml(`<!doctype html><html><head><style>@page { size: 120mm 80mm; margin: 20mm; ${decl} }</style></head><body><p>B</p></body></html>`, {
      loadFont: loadCachedFont,
      style: 'browser',
    });
    const bi = (r.areaTree.sheets[0] as { backgroundImage?: { x?: unknown; y?: unknown } }).backgroundImage;
    return [bi?.x ?? '0%', bi?.y ?? '0%'];
  };
  it('指定が無ければ初期値の左上 (前は中央)', async () => {
    expect(await pos(`background: url(${PNG}) no-repeat`)).toEqual(['0%', '0%']);
  });
  it('値が 1 つなら、もう一方は center', async () => {
    expect(await pos(`background: url(${PNG}) no-repeat right`)).toEqual(['100%', '50%']);
    expect(await pos(`background-image: url(${PNG}); background-repeat: no-repeat; background-position: 30%`)).toEqual(['30%', '50%']);
  });
  it('center と、2 つの値', async () => {
    expect(await pos(`background: url(${PNG}) no-repeat center`)).toEqual(['50%', '50%']);
    expect(await pos(`background: url(${PNG}) no-repeat bottom left`)).toEqual(['0%', '100%']);
  });
});

