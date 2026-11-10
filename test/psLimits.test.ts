/**
 * PostScript (EPS) の処理系の上限: 信頼できないプログラムが、メモリと時間を使い切る前に PostScript のエラーで終わること。
 * 上限は小さな値に差し替えて試す (既定の値のままだと、数百 MB を使ってから止まる)
 */
import { describe, expect, it } from 'vitest';
import { Interp, latin1, strText, type InterpOptions, type PSObj } from '../src/psInterp';
import { filterSource } from '../src/psFilters';
import { Graphics } from '../src/psGraphics';
import { epsToSvg, runEps } from '../src/eps';

const MB = 1024 * 1024;

/** プログラムを実行する。上限は opts で差し替える (時間は、直す前の実装でも止まるように短くしておく) */
function run(src: string, opts: InterpOptions & { maxPathPoints?: number } = {}) {
  const I = new Interp({ maxMillis: 3000, ...opts });
  const G = new Graphics(I, { bbox: [0, 0, 100, 100], maxPathPoints: opts.maxPathPoints });
  const error = I.run(latin1(src));
  return { I, G, error, stack: I.ostack };
}
const show = (o: PSObj) => (o.t === 'int' || o.t === 'real' || o.t === 'bool' ? o.v : o.t === 'string' ? strText(o) : o.t === 'name' ? '/' + o.v : o.t);
const vals = (src: string, opts: InterpOptions = {}) => {
  const r = run(src, opts);
  expect(r.error).toBeUndefined();
  return r.stack.map(show);
};
const eps = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n`);

describe('PostScript の上限: VM の使用量 (PLRM 付録 B。超えれば VMerror)', () => {
  it('配列を作り続けるループは VMerror で終わる', () => {
    const r = run('{ 1000 array } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(array\)/);
    expect(r.I.vmUsed).toBeLessThanOrEqual(MB);
    // 1 つ 8000 バイトなので、100 個あまりで止まる
    expect(r.stack.length).toBeLessThan(140);
  });
  it('文字列を辞書にため続けるループは VMerror で終わる', () => {
    const r = run('0 { dup 10000 string userdict 3 1 roll put 1 add } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(string\)/);
    expect(r.I.userdict.size).toBeLessThan(110);
  });
  it('辞書の項を増やし続けるループは VMerror で終わる', () => {
    const r = run('0 { dup dup userdict 3 1 roll put 1 add } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(put\)/);
    expect(r.I.userdict.size).toBeLessThan(MB / 100);
  });
  it('長い名前を作り続けるループは VMerror で終わる。短い名前 (127 字まで) は何度作っても増えない', () => {
    const r = run('/s 1000 string def { s cvn } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(cvn\)/);
    // エラーの文に、長い名前をそのまま入れない
    expect(r.error!.length).toBeLessThan(1000);
    expect(vals('/s 100 string def 20000 { s cvn pop } repeat (done)', { maxVM: MB })).toEqual(['done']);
  });
  it('save を積み続けるループは VMerror で終わる。restore は save の記録の分を戻す', () => {
    const r = run('{ save pop } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(save\)/);
    expect(r.I.saves.length).toBeLessThan(MB / 256);
    // エラーの記録 ($error への書き込み) は、VM が尽きていてもできる
    expect(run('{ save pop } loop $error /errorname get', { maxVM: MB }).I.$error.get('errorname')).toEqual({ t: 'name', v: 'VMerror', x: false });
    // save と restore の組は、何度くり返しても増えない (配列の書き換えの控えも戻る)
    expect(vals('/a 10 array def 20000 { save a 0 1 put restore } repeat (done)', { maxVM: MB })).toEqual(['done']);
  });
  it('restore は、save のあとに作ったオブジェクトの分を戻さない (捨てたはずのものが、まだ指されていないことを確かめていないので)', () => {
    const r = run('{ save 10000 string exch restore } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(string\)/);
    expect(r.stack.length).toBeLessThan(110);
  });
  it('字句として読む文字列・手続きも数える (文字列をプログラムとして実行し続けるループ)', () => {
    const lit = '\\(' + 'x'.repeat(5000) + '\\)';
    expect(run(`/s (${lit}) def { s cvx exec } loop`, { maxVM: MB }).error).toMatch(/^VMerror/);
    const proc = '{' + ' 0'.repeat(2000) + ' }';
    expect(run(`/s (${proc}) def { s cvx exec } loop`, { maxVM: MB }).error).toMatch(/^VMerror/);
  });
  it('gstate のオブジェクトと currentdash の配列も数える', () => {
    expect(run('{ gstate } loop', { maxVM: MB }).error).toMatch(/^VMerror \(gstate\)/);
    expect(run('[ 1000 { 1 } repeat ] 0 setdash { currentdash pop } loop', { maxVM: MB }).error).toMatch(/^VMerror \(currentdash\)/);
  });
  it('VMerror は stopped で受けられ、そのあとも実行を続けられる', () => {
    expect(vals('{ { 1000 array } stopped { exit } if } loop $error /errorname get count 1 sub', { maxVM: MB }).slice(-2)).toEqual(['/VMerror', expect.any(Number)]);
  });
  it('組み込みの辞書を作る分は数えない (上限が小さくても、空のプログラムは通る)', () => {
    expect(vals('1 2 add', { maxVM: 4096 })).toEqual([3]);
  });
});

describe('PostScript の上限: パスの点の合計 (PLRM 付録 B の表 B.1。超えれば limitcheck)', () => {
  it('同じパスを塗り続けるループは limitcheck で終わる', () => {
    const r = run('0 0 moveto 1 1 1000 { dup lineto } for { gsave fill grestore } loop', { maxPathPoints: 10000 });
    expect(r.error).toMatch(/^limitcheck \(fill\)/);
    // 描画の並びに写せるのは、上限の 2 倍の点まで (1001 点のパスを 19 回)
    expect(r.G.items.length).toBe(19);
  });
  it('線を足し続けるループ・短い線を描き続けるループは limitcheck で終わる', () => {
    const a = run('0 0 moveto { 1 1 lineto } loop', { maxPathPoints: 10000 });
    expect(a.error).toMatch(/^limitcheck \(lineto\)/);
    expect(a.G.g.path.length).toBe(10000);
    const b = run('{ 0 0 moveto 1 1 lineto stroke } loop', { maxPathPoints: 10000 });
    expect(b.error).toMatch(/^limitcheck/);
    expect(b.G.items.length).toBeLessThan(10000 / 6 + 1);
  });
  it('クリップを重ね続けるループ・文字を描き続けるループは limitcheck で終わる', () => {
    expect(run('0 0 moveto 10 0 lineto 10 10 lineto closepath { clip } loop', { maxPathPoints: 10000 }).error).toMatch(/^limitcheck \(clip\)/);
    const t = run('/Helvetica findfont 10 scalefont setfont { 0 0 moveto (abcdefgh) show } loop', { maxPathPoints: 10000 });
    expect(t.error).toMatch(/^limitcheck \(show\)/);
    expect(t.G.items.length).toBeLessThan(1000);
  });
  it('gsave のあとでパスを書き換え続けるループ (パスの写しがグラフィックス状態のスタックにたまる) は limitcheck で終わる', () => {
    const r = run('0 0 moveto 1 1 2000 { dup lineto } for { gsave 0 0 lineto } loop', { maxPathPoints: 10000 });
    expect(r.error).toMatch(/^limitcheck/);
    expect(r.G.stack.length).toBeLessThan(40);
  });
  it('clipsave の入れ子は 1000 段まで', () => {
    const r = run('{ clipsave } loop');
    expect(r.error).toMatch(/^limitcheck \(clipsave\)/);
    expect(r.G.g.clipStack.length).toBe(1000);
  });
  it('runEps・epsToSvg は、上限に当たった所までの絵とエラーを返す (例外を投げない)', async () => {
    const b = eps('0 0 moveto 1 1 1000 { dup lineto } for { gsave fill grestore } loop');
    const r = runEps(b, { maxPathPoints: 10000, maxMillis: 3000 });
    expect(r!.error).toMatch(/^limitcheck \(fill\)/);
    expect(r!.items.length).toBe(19);
    const svg = await epsToSvg(b, { maxPathPoints: 10000, maxMillis: 3000 });
    expect(svg!.error).toMatch(/^limitcheck \(fill\)/);
    expect(svg!.count).toBe(19);
    const v = runEps(eps('{ 1000 array } loop'), { maxVM: MB, maxMillis: 3000 });
    expect(v!.error).toMatch(/^VMerror \(array\)/);
  });
  it('ふつうの絵は、既定の上限のままで変わらない', () => {
    const r = runEps(eps('10 10 moveto 90 10 lineto 90 90 lineto closepath gsave 1 0 0 setrgbcolor fill grestore stroke'));
    expect(r!.error).toBeUndefined();
    expect(r!.items.map((it) => it.k)).toEqual(['fill', 'stroke']);
  });
});

describe('PostScript の上限: フィルタが読みためる量 (超えれば limitcheck)', () => {
  it('ReusableStreamDecode・DCTDecode は、終わらない元を上限まで読んで limitcheck にする', () => {
    for (const f of ['ReusableStreamDecode', 'DCTDecode']) {
      const r = run(`/s 1000 string def { s } /${f} filter`, { maxFilterBytes: 100000 });
      expect(r.error).toMatch(/^limitcheck \(filter\)/);
      // 元の手続きを呼ぶのは、上限の分だけ
      expect(r.I.steps).toBeLessThan(1000);
    }
  });
  it('読みためた分は VM に数える (フィルタを作り続けるループは VMerror で終わる)', () => {
    const r = run('/s 10000 string def { s /ReusableStreamDecode filter } loop', { maxVM: MB });
    expect(r.error).toMatch(/^VMerror \(filter\)/);
    expect(r.stack.length).toBeLessThan(60);
    expect(run('/s 10 string def { s /FlateDecode filter } loop', { maxVM: MB }).error).toMatch(/^VMerror \(filter\)/);
  });
  it('上限までのデータは、前と同じに読める', () => {
    expect(vals('(abcdef) /ReusableStreamDecode filter 6 string readstring pop')).toEqual(['abcdef']);
    const big = Uint8Array.from({ length: 20000 }, (_, i) => (i * 7) & 255);
    const src = filterSource('ReusableStreamDecode', { read: (() => { let i = 0; return () => (i < big.length ? big[i++] : -1); })() });
    expect(src.length).toBe(20000);
    const out: number[] = [];
    for (let c = src.read(); c >= 0; c = src.read()) out.push(c);
    expect(out).toEqual([...big]);
    src.reset!();
    expect(src.read()).toBe(0);
  });
  it('予測関数の 1 行の長さ (Columns) にも上限を置く', () => {
    expect(run('(x) << /Predictor 12 /Columns 1000000000 >> /FlateDecode filter').error).toMatch(/^limitcheck \(filter\)/);
  });
  it('LZWDecode: 同じ字が続くデータ (表の並びが長くなる) も、前と同じに解ける', () => {
    // 符号器 (EarlyChange 1・上位のビットから。PLRM §3.13.3 LZWEncode)
    const encode = (data: number[]): number[] => {
      const out: number[] = [];
      let bits = 0;
      let nbits = 0;
      let width = 9;
      const put = (code: number) => {
        bits = (bits << width) | code;
        nbits += width;
        while (nbits >= 8) {
          out.push((bits >> (nbits - 8)) & 255);
          nbits -= 8;
        }
        bits &= (1 << nbits) - 1;
      };
      let table = new Map<string, number>();
      let next = 258;
      put(256);
      let w = '';
      for (const c of data) {
        const wc = w + String.fromCharCode(c);
        if (wc.length === 1 || table.has(wc)) {
          w = wc;
          continue;
        }
        put(w.length === 1 ? w.charCodeAt(0) : table.get(w)!);
        table.set(wc, next++);
        if (next >= 1 << width && width < 12) width++;
        if (next >= 4094) {
          put(256);
          table = new Map();
          next = 258;
          width = 9;
        }
        w = String.fromCharCode(c);
      }
      if (w) put(w.length === 1 ? w.charCodeAt(0) : table.get(w)!);
      put(257);
      if (nbits) out.push((bits << (8 - nbits)) & 255);
      return out;
    };
    const decode = (data: number[]) => {
      const enc = encode(data);
      let i = 0;
      const src = filterSource('LZWDecode', { read: () => (i < enc.length ? enc[i++] : -1) });
      const out: number[] = [];
      for (let c = src.read(); c >= 0; c = src.read()) out.push(c);
      return out;
    };
    const same = new Array<number>(30000).fill(7);
    expect(decode(same)).toEqual(same);
    const mixed = Array.from({ length: 30000 }, (_, k) => (k * k) % 5);
    expect(decode(mixed)).toEqual(mixed);
  });
});

describe('PostScript の上限: Type 3 の画像のマスク (MaskDict。PLRM §4.10.6)', () => {
  const image3 = (il: number, w: number, h: number, mw: number, mh: number, src = true) =>
    `/DeviceGray setcolorspace << /ImageType 3 /InterleaveType ${il} ` +
    `/DataDict << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0] /DataSource (a) /Decode [0 1] >> ` +
    `/MaskDict << /ImageType 1 /Width ${mw} /Height ${mh} /BitsPerComponent 1 /ImageMatrix [1 0 0 1 0 0] ${src ? '/DataSource (a) ' : ''}/Decode [0 1] >> >> image`;
  it('マスクの画素の数が画像の上限を超えれば、どの InterleaveType でも limitcheck', () => {
    expect(run(image3(3, 1, 1, 12000, 12000)).error).toMatch(/^limitcheck \(image\)/);
    expect(run(image3(2, 1, 1, 8, 200000000, false)).error).toMatch(/^limitcheck \(image\)/);
    expect(run(image3(1, 1, 1, 12000, 12000, false)).error).toMatch(/^limitcheck \(image\)/);
  });
  it('マスクの画素も手間として数える (ステップの上限に当たる)', () => {
    // 4000 × 4000 のマスクは 64 画素で 1 ステップ = 25 万ステップ
    for (const il of [2, 3]) {
      const r = run(image3(il, 1, 1, 4000, 4000, il === 3), { maxSteps: 10000 });
      expect(r.error).toBe('limit:steps');
      expect(r.G.items.length).toBe(0);
    }
  });
  it('小さなマスクの画像は、前と同じに描ける', () => {
    const r = run(image3(3, 2, 2, 2, 2));
    expect(r.error).toBeUndefined();
    const it0 = r.G.items[0];
    expect(it0.k).toBe('image');
    if (it0.k === 'image') expect([it0.width, it0.height, it0.rgba!.length]).toEqual([2, 2, 16]);
  });
});
