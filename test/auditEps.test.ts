/**
 * EPS (自前の PostScript の解釈器) の、小さな入力で時間・メモリを使い切らせる問題の修正の確かめ。
 * 上限は小さな値に差し替えて試す (既定の値のままだと、数百 MB・数十秒を使ってから止まる)
 */
import { describe, expect, it } from 'vitest';
import { Interp, latin1, strText, type InterpOptions } from '../src/psInterp';
import { Graphics, type GraphicsOptions } from '../src/psGraphics';
import { EpsBudget, epsBudgetOf, epsToSvg, runEps } from '../src/eps';

const eps = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n`);

/** プログラムを実行する。上限は opts で差し替える */
function run(src: string, opts: InterpOptions & Partial<GraphicsOptions> = {}) {
  const I = new Interp({ maxMillis: 5000, ...opts });
  const G = new Graphics(I, { bbox: [0, 0, 100, 100], maxPathPoints: opts.maxPathPoints, maxDrawCost: opts.maxDrawCost });
  const error = I.run(latin1(src));
  return { I, G, error };
}

describe('模様の線の輪郭', () => {
  it('模様を選んでいない「/Pattern setcolorspace」だけの線は、輪郭を作らずに警告にする', () => {
    const t = Date.now();
    const r = run('/Pattern setcolorspace 1 setlinejoin 0 0 moveto 100000 { 1 0 rlineto 0 1 rlineto } repeat stroke');
    expect(r.error).toBeUndefined();
    expect(r.G.items.length).toBe(0);
    expect([...r.I.warnings]).toContain('模様の塗り');
    // 前は 20 万点の輪郭 (丸いつなぎ目で 1 つ 25 点) を作ってから捨てていた
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it('模様の線の輪郭は、作りながら点の上限を確かめる (作り切ってから数えない)', () => {
    const r = run(
      '/P << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /PaintProc { pop 0 0 5 5 rectfill } >> matrix makepattern def ' +
        '/Pattern setcolorspace P setcolor 1 setlinejoin 0 0 moveto 20000 { 1 0 rlineto 0 1 rlineto } repeat stroke',
      { maxPathPoints: 200_000 },
    );
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.G.pathPoints).toBeLessThan(200_000 + 10_000);
    // 作る間だけ持つ点の分は、作り終えたら (止まったときも) メモリの勘定から戻す
    expect(r.I.memUsed).toBeLessThan(200_000 * 200);
  });
  it('模様の線は、前と同じ形に塗る (輪郭を機器の座標に直しながら作る)', () => {
    const r = run(
      '/P << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /PaintProc { pop 0 0 10 10 rectfill } >> matrix makepattern def ' +
        '2 2 scale /Pattern setcolorspace P setcolor 4 setlinewidth 10 10 moveto 30 10 lineto stroke',
    );
    expect(r.error).toBeUndefined();
    // 線の輪郭のクリップ: 機器の座標で (20, 16)〜(60, 24)
    const clip = r.G.items.find((it) => it.clip)!.clip!;
    const xs = clip.segs.flatMap((s) => (s.op === 'Z' ? [] : [s.x]));
    const ys = clip.segs.flatMap((s) => (s.op === 'Z' ? [] : [s.y]));
    expect(Math.min(...xs)).toBeCloseTo(20);
    expect(Math.max(...xs)).toBeCloseTo(60);
    expect(Math.min(...ys)).toBeCloseTo(16);
    expect(Math.max(...ys)).toBeCloseTo(24);
  });
});

describe('模様の中の画像の写し', () => {
  it('写した画像の画素も、画素の合計の上限に数える', () => {
    // 400 万画素の画像の模様を 100 個並べる (4 億画素)。画素の合計の上限 (1 億) で limitcheck
    const r = runEps(
      eps(
        '/S 2000 string def /P << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1 ' +
          '/PaintProc { pop 2000 2000 8 [2000 0 0 2000 0 0] { S } image } >> matrix makepattern def /Pattern setcolorspace P setcolor 0 0 10 10 rectfill',
      ),
    )!;
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.items.filter((it) => it.k === 'image').length).toBeLessThanOrEqual(25);
  });
  it('画素を共有する写しは、PNG に 1 度だけ圧縮して使い回す (同じ data: の URI になる)', async () => {
    const r = (await epsToSvg(
      eps(
        '/P << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 20 20] /XStep 20 /YStep 20 ' +
          '/PaintProc { pop gsave 20 20 scale 2 2 8 [2 0 0 2 0 0] <00ff80c0> image grestore } >> matrix makepattern def /Pattern setcolorspace P setcolor 5 5 90 90 rectfill',
      ),
    ))!;
    expect(r.error).toBeUndefined();
    const uris = [...r.svg.matchAll(/href="(data:[^"]+)"/g)].map((m) => m[1]);
    expect(uris.length).toBeGreaterThan(10);
    expect(new Set(uris).size).toBe(1);
  });
});

describe('描画の件数の上限', () => {
  it('図形の件数が上限を超えれば limitcheck で、そこまでを残す', () => {
    const r = run('0 0 moveto 1 1 lineto 2 0 lineto { gsave fill grestore } loop', { maxDrawCost: 1000 });
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.G.items.length).toBe(1000);
  });
  it('文字 (代わりの書体の show) は 1 回を 5 と数える', () => {
    const r = run('/Helvetica findfont 10 scalefont setfont 0 0 moveto { gsave (a) show grestore } loop', { maxDrawCost: 1000 });
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.G.items.length).toBe(200);
  });
  it('画像は 1 枚を 20 と数える', () => {
    const r = run('/S 1 string def /M [1 0 0 1 0 0] def { 1 1 8 M S image } loop', { maxDrawCost: 1000 });
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.G.items.length).toBe(50);
  });
  it('模様の写しは、残りの手間で描けるところまでにして警告にし、模様の後の絵も描く', () => {
    const r = run(
      '/P << /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1 /PaintProc { pop 0 0 0.5 0.5 rectfill } >> matrix makepattern def ' +
        'gsave /Pattern setcolorspace P setcolor 0 0 100 100 rectfill grestore 0 0 10 10 rectfill',
      { maxDrawCost: 1000 },
    );
    expect(r.error).toBeUndefined();
    expect([...r.I.warnings]).toContain('模様の写しが多すぎるので、途中まで描きます');
    expect(r.G.items.length).toBeLessThanOrEqual(1000);
    // 最後の黒い四角が描かれている
    const last = r.G.items[r.G.items.length - 1];
    expect(last.k).toBe('fill');
  });
});

describe('文字列の字句', () => {
  it('長い文字列 (括弧・16 進・ASCII85) を、バイトの入れ物にためて読む', () => {
    const n = 300_000;
    const lit = 'ab\\(c\\)'.repeat(n / 5);
    const r = run(`(${lit}) length <${'4142'.repeat(n / 2)}> length <~${'87cUR'.repeat(n / 4)}~> length`);
    expect(r.error).toBeUndefined();
    expect(r.I.ostack.map((o) => (o.t === 'int' ? o.v : -1))).toEqual([(n / 5) * 5, n, n]);
  });
  it('中身は前と同じ (エスケープ・8 進・16 進の奇数の桁)', () => {
    const r = run('(a\\101\\n\\)b) <414> ');
    expect(r.error).toBeUndefined();
    expect(r.I.ostack.map((o) => (o.t === 'string' ? strText(o) : ''))).toEqual(['aA\n)b', 'A@']);
  });
});

describe('文書あたりの EPS の時間の予算', () => {
  it('予算の残りを時間の上限にし、使った時間を引く。使い切ったら実行しない', async () => {
    const budget = new EpsBudget(300);
    const burn = eps('0 0 moveto 1 1 lineto stroke { 1 pop } loop');
    const t = Date.now();
    const r1 = await epsToSvg(burn, { budget });
    expect(r1?.error).toMatch(/time/);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(budget.millisLeft).toBeLessThanOrEqual(0);
    expect(await epsToSvg(burn, { budget })).toBeUndefined();
    // EPS として読めないものは、予算を使わない
    const b2 = new EpsBudget(1000);
    expect(await epsToSvg(latin1('no eps'), { budget: b2 })).toBeUndefined();
    expect(b2.millisLeft).toBe(1000);
  });
  it('予算は、結び付けたもの (文書の画像の入れ物) ごとに 1 つ', () => {
    const a = {};
    expect(epsBudgetOf(a)).toBe(epsBudgetOf(a));
    expect(epsBudgetOf(a)).not.toBe(epsBudgetOf({}));
  });
});

describe('勘定に入らない確保と、2 乗の手間', () => {
  it('version・product の文字列も、メモリの勘定に積む', () => {
    const r = run('{ version product } loop', { maxMemory: 1024 * 1024 });
    expect(r.error).toMatch(/^VMerror/);
  });
  it('DeviceN の成分は 32 まで', () => {
    const names = (n: number) => '[' + Array.from({ length: n }, (_, k) => `/C${k}`).join(' ') + ']';
    expect(run(`[/DeviceN ${names(32)} /DeviceGray { 32 { pop } repeat 0 }] setcolorspace`).error).toBeUndefined();
    expect(run(`[/DeviceN ${names(33)} /DeviceGray { 33 { pop } repeat 0 }] setcolorspace`).error).toMatch(/^limitcheck/);
  });
  it('setcolor の成分の順は前と同じ', () => {
    const r = run('[/DeviceN [/A /B /C] /DeviceRGB {}] setcolorspace 0.1 0.2 0.3 setcolor currentcolor');
    expect(r.error).toBeUndefined();
    expect(r.I.ostack.map((o) => (o.t === 'real' || o.t === 'int' ? Math.round(o.v * 10) : -1))).toEqual([1, 2, 3]);
  });
  it('CMap の範囲を足し続けるループは limitcheck で終わる', () => {
    const t = Date.now();
    const r = run('/CIDInit /ProcSet findresource begin 12 dict begin begincmap { 1 begincidrange <00> <ff> 1 endcidrange } loop', { maxMillis: 20_000 });
    expect(r.error).toMatch(/^limitcheck/);
    expect(Date.now() - t).toBeLessThan(10_000);
  });
  it('長いパスの pathbbox を繰り返すループは、手間に数えられて止まる', () => {
    const r = run('0 0 moveto 200000 { 1 1 rlineto } repeat pathbbox { pathbbox pop pop pop pop } loop', { maxSteps: 2_000_000 });
    expect(r.error).toMatch(/steps|limitcheck|time/);
  });
});
