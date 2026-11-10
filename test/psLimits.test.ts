/**
 * PostScript (EPS) の処理系の上限: 信頼できないプログラムが、メモリと時間を使い切る前に PostScript のエラーで終わること。
 * 上限は小さな値に差し替えて試す (既定の値のままだと、数百 MB を使ってから止まる)
 */
import { describe, expect, it } from 'vitest';
import { Interp, latin1, strText, type InterpOptions, type PSObj } from '../src/psInterp';
import { filterSource } from '../src/psFilters';
import { Graphics } from '../src/psGraphics';
import { matchTemplate, parseTemplate } from '../src/psResources';
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

describe('PostScript の上限: 網の網かけ (ShadingType 4〜7) の画素の手間', () => {
  /** 範囲の半分を覆う三角形を n 個重ねた Type 4 の網かけ */
  const mesh = (n: number) => {
    const P = ['0 0', '100 0', '0 100', '100 100'];
    let d = `0 ${P[0]} 0 0 ${P[1]} 0 0 ${P[2]} 0 `;
    for (let i = 0; i < n; i++) d += `1 ${P[(i + 3) % 4]} ${i % 2} `;
    return `<< /ShadingType 4 /ColorSpace /DeviceGray /DataSource [${d}] >> shfill`;
  };
  it('三角形ごとに見る画素を、ステップとして数える', () => {
    // 三角形 1 つが 200 × 200 画素の範囲を見る = 2500 ステップ。200 個で 50 万ステップ
    const r = run(mesh(200), { maxSteps: 100000 });
    expect(r.error).toBe('limit:steps');
    expect(r.G.items.length).toBe(0);
  });
  it('少ない三角形の網かけは、前と同じに描ける', () => {
    const r = run(mesh(2));
    expect(r.error).toBeUndefined();
    expect(r.G.items.length).toBe(1);
    expect(r.I.steps).toBeGreaterThan(3 * 2500);
    expect(r.I.steps).toBeLessThan(20000);
  });
});

describe('PostScript: resourceforall の型紙 (PLRM §8.2 filenameforall の型紙の決まり)', () => {
  const m = (pat: string, text: string) => matchTemplate(parseTemplate(pat), text);
  it('* は 0 字以上、? は 1 字、\\ は次の 1 字を文字通りに', () => {
    expect(m('*', '')).toBe(true);
    expect(m('*', 'abc')).toBe(true);
    expect(m('a*c', 'ac')).toBe(true);
    expect(m('a*c', 'abbbc')).toBe(true);
    expect(m('a*c', 'abbbd')).toBe(false);
    expect(m('a?c', 'abc')).toBe(true);
    expect(m('a?c', 'ac')).toBe(false);
    expect(m('?', '')).toBe(false);
    expect(m('', '')).toBe(true);
    expect(m('', 'a')).toBe(false);
    expect(m('abc', 'abc')).toBe(true);
    expect(m('abc', 'abcd')).toBe(false);
    expect(m('*a*b', 'xxaxxbxxab')).toBe(true);
    expect(m('*a*b', 'xxaxxbxxa')).toBe(false);
    expect(m('a**b', 'ab')).toBe(true);
    // 正規表現の特別な字は、ただの字
    expect(m('a.c', 'abc')).toBe(false);
    expect(m('a.c', 'a.c')).toBe(true);
    expect(m('[a]+(b)|$^', '[a]+(b)|$^')).toBe(true);
    // \ の逃がし
    expect(m('a\\*c', 'a*c')).toBe(true);
    expect(m('a\\*c', 'abc')).toBe(false);
    expect(m('a\\?c', 'a?c')).toBe(true);
    expect(m('a\\?c', 'abc')).toBe(false);
    expect(m('a\\\\c', 'a\\c')).toBe(true);
    expect(m('a\\bc', 'abc')).toBe(true);
    expect(m('a\\', 'a\\')).toBe(true);
    // 改行を含む名前にも一致する
    expect(m('a*', 'a\nb')).toBe(true);
  });
  it('resourceforall は、型紙に合う実例だけを渡す', () => {
    const defs = ['ab', 'axb', 'a*b', 'b'].map((n) => `(${n}) cvn 1 dict /Pattern defineresource pop`).join(' ');
    const names = (pat: string) =>
      vals(`${defs} [ (${pat}) { dup length string copy } 100 string /Pattern resourceforall ]  { } forall`)
        .map(String)
        .sort();
    expect(names('a*b')).toEqual(['a*b', 'ab', 'axb']);
    expect(names('a?b')).toEqual(['a*b', 'axb']);
    expect(names('a\\\\*b')).toEqual(['a*b']);
    expect(names('*')).toEqual(['a*b', 'ab', 'axb', 'b']);
  });
  it('* の多い型紙でも、後戻りが爆発しない', { timeout: 5000 }, () => {
    const r = run(`/${'a'.repeat(40)} 1 dict /Pattern defineresource pop (${'*a'.repeat(9)}*b) { pop } 100 string /Pattern resourceforall (done)`);
    expect(r.error).toBeUndefined();
    expect(r.stack.map(show)).toEqual(['done']);
    // 長い型紙と長い名前の照合 (長さの積に比例する) は、手間として数える
    // (名前は a が 12 万字、型紙は * と a が 6 万字と b: どの位置からも 6 万字まで合って外れる)
    const setup = '/s 120000 string def 0 1 119999 { s exch 97 put } for s cvn 1 dict /Pattern defineresource pop /t 60002 string def 0 1 60000 { t exch 97 put } for t 0 42 put t 60001 98 put ';
    const before = run(setup).I.steps;
    const long = run(setup + 't { pop } 100 string /Pattern resourceforall', { maxSteps: before + 500000 });
    expect(long.error).toBe('limit:steps');
  });
});

describe('PostScript の上限: 長さに比例して回る演算子の手間', () => {
  it('search は、前と同じ結果を返す', () => {
    expect(vals('(abbc) (bb) search')).toEqual(['c', 'bb', 'a', true]);
    expect(vals('(abbc) (bc) search')).toEqual(['', 'bc', 'ab', true]);
    expect(vals('(abbc) (ab) search')).toEqual(['bc', 'ab', '', true]);
    expect(vals('(abbc) (x) search')).toEqual(['abbc', false]);
    expect(vals('(abbc) (abbcd) search')).toEqual(['abbc', false]);
    expect(vals('(abc) () search')).toEqual(['abc', '', '', true]);
    expect(vals('() () search')).toEqual(['', '', '', true]);
    expect(vals('() (a) search')).toEqual(['', false]);
    // 途中まで合って外れる並び (探す側の先頭に戻る位置)
    expect(vals('(aaab) (aab) search')).toEqual(['', 'aab', 'a', true]);
    expect(vals('(abababc) (ababc) search')).toEqual(['', 'ababc', 'ab', true]);
    expect(vals('(aabaabaac) (aabaac) search')).toEqual(['', 'aabaac', 'aab', true]);
    // 最初に見つかった所
    expect(vals('(xabxab) (ab) search')).toEqual(['xab', 'ab', 'x', true]);
    // 部分の文字列 (getinterval) の中を探す
    expect(vals('(xxabcxx) 2 3 getinterval (bc) search')).toEqual(['', 'bc', 'a', true]);
  });
  it('search の手間は長さの和に比例し、ステップとして数える', () => {
    // 10 万字の中から 5 万字を探す (どこも 49999 字まで合って外れる): 素朴な探し方では 50 億回の比較
    const src = '/s 100000 string def /k 50000 string def k 49999 1 put s k search';
    const r = run(src);
    expect(r.error).toBeUndefined();
    expect(r.stack.map(show).slice(-1)).toEqual([false]);
    expect(r.I.steps).toBeGreaterThan(150000 / 64);
    expect(r.I.steps).toBeLessThan(10000);
    expect(run(src, { maxSteps: 1000 }).error).toBe('limit:steps');
  });
  it('長い文字列の比較・名前への変換・辞書の鍵・写しも、ステップとして数える', () => {
    const big = '/s 640000 string def /t 640000 string def ';
    const steps = (op: string) => run(big + op).I.steps - run(big).I.steps;
    for (const op of ['s t eq pop', 's t ne pop', 's t lt pop', 's t anchorsearch pop pop pop', 'userdict s known pop', 's where pop', 's 640000 string readonly eq pop']) {
      expect(steps(op), op).toBeGreaterThanOrEqual(10000);
      expect(steps(op), op).toBeLessThan(40000);
    }
    // 短い文字列では数えない
    expect(run('(abc) (abc) eq pop (abc) (b) search pop pop pop pop').I.steps).toBeLessThan(20);
  });
  it('長い文字列を名前・鍵にしても、前と同じ値になる (まとめて文字にする)', () => {
    expect(vals('/s 20000 string def 0 1 19999 { s exch dup 256 mod put } for s cvn length s cvn s eq s dup length string copy s eq')).toEqual([20000, true, true]);
    expect(vals('/s 300 string def 0 1 299 { s exch dup 256 mod put } for /d 2 dict def d s 5 put d s get d s cvn get d s known')).toEqual([5, 5, true]);
  });
});

describe('PostScript の上限: StartData の長さ (PLRM §8.2 StartData)', () => {
  it('長さのオペランドをそのまま信じて確保しない (ファイルに残っている分だけ読む)', () => {
    const r = run('/CIDInit /ProcSet findresource begin 4 dict begin /CIDFontName /X def (Binary) 2000000000 StartData ABCD');
    expect(r.error).toBeUndefined();
    expect(r.I.vmUsed).toBeLessThan(MB);
    expect(vals('/CIDInit /ProcSet findresource begin 4 dict begin /CIDFontName /X def (Binary) 2000000000 StartData ABCD')).toEqual([]);
    const f = run('/FontSetInit /ProcSet findresource begin /S 2000000000 StartData ABCD');
    expect(f.I.vmUsed).toBeLessThan(MB);
  });
  it('負の長さは rangecheck', () => {
    expect(run('/CIDInit /ProcSet findresource begin 4 dict begin /CIDFontName /X def (Binary) -1 StartData').error).toMatch(/^rangecheck/);
  });
  it('長さどおりのデータは、前と同じに読める (続きはプログラムとして実行する)', () => {
    const body = (fmt: string, n: number, data: string) => `/CIDInit /ProcSet findresource begin 4 dict begin /CIDFontName /X def (${fmt}) ${n} StartData ${data} /X /CIDFont findresource /GlyphData get`;
    expect(vals(body('Binary', 4, 'ABCD'))).toEqual(['ABCD']);
    expect(vals(body('Hex', 4, '41 42\n4344'))).toEqual(['ABCD']);
    // 64KB を超えるデータ (倍々に伸ばして読む)
    const big = 'x'.repeat(200000);
    const r = run(body('Binary', 200000, big) + ' length');
    expect(r.error).toBeUndefined();
    expect(r.stack.map(show)).toEqual([200000]);
  });
  it('終わらない元から読む StartData は VMerror で終わる', () => {
    // 手続きを元にしたファイルを実行する: 初めに StartData までのプログラムを返し、あとは 1000 字の文字列を返し続ける
    const r = run(
      '/s 1000 string def /n 0 def /CIDInit /ProcSet findresource begin 4 dict begin /CIDFontName /X def ' +
        '{ n 0 eq { /n 1 store ((Binary) 2000000000 StartData ) } { s } ifelse } /NullEncode filter cvx exec',
      { maxVM: MB },
    );
    expect(r.error).toMatch(/^VMerror \(StartData\)/);
    expect(r.I.vmUsed).toBeLessThanOrEqual(MB);
  });
});

describe('PS-18: PostScript のメモリの合計の上限 (PLRM 付録 B の冒頭。VM・パス・画像を 1 つの勘定に積み、超えれば VMerror)', () => {
  // どの上限も、それぞれには届かない使い方を並べる: 合わせた量が合計の上限 (2MB) を超える所で止まる
  const image = '/s 1000 string def 300 300 8 [1 0 0 1 0 0] { s } image'; // 9 万画素 = 360KB
  const path = '0 0 moveto 1 1 6000 { dup lineto } for stroke'; // 6000 点 = 576KB
  const strings = '0 1 9 { 100000 string def } for'; // 1MB
  const array = '/a 5000 array def'; // 440KB
  it('VM・パスの点・画像は、それぞれの上限に届かなくても、合計の上限で VMerror になる', () => {
    const each = { maxVM: 2 * MB, maxPathPoints: 20000, maxMillis: 3000 };
    // 1 つずつなら通る
    for (const src of [image, path, strings, array]) expect(run(src, { ...each, maxMemory: 2 * MB }).error).toBeUndefined();
    // 並べると、合計が 2MB を超える所 (文字列の途中) で止まる。合計の上限を上げれば通る
    const all = `${image} ${path} ${array} ${strings}`;
    const r = run(all, { ...each, maxMemory: 2 * MB });
    expect(r.error).toMatch(/^VMerror \(string\)/);
    expect(r.I.memUsed).toBeLessThanOrEqual(2 * MB);
    expect(r.I.vmUsed).toBeLessThan(MB);
    expect(r.G.pathPoints).toBeLessThan(7000);
    expect(r.G.items.map((it) => it.k)).toEqual(['image', 'stroke']);
    expect(run(all, { ...each, maxMemory: 4 * MB }).error).toBeUndefined();
    // 並べる順を変えれば、止まる所 (演算子) が変わる: どの確保も同じ勘定に積んでいる
    expect(run(`${strings} ${array} ${image} ${path}`, { ...each, maxMemory: 2 * MB }).error).toMatch(/^VMerror \(lineto\)/);
    expect(run(`${strings} ${array} ${path} ${image}`, { ...each, maxMemory: 2 * MB }).error).toMatch(/^VMerror \(image\)/);
  });
  it('勘定に積む量は、実際に使う量に近い: 配列は 1 要素 88 バイト、辞書は 1 項 192 バイト、文字列は長さ + 256 バイト、パスは 1 点 96 バイト、画像は 1 画素 4 バイト', () => {
    const used = (src: string) => {
      const r = run(src);
      expect(r.error).toBeUndefined();
      return r.I.memUsed;
    };
    const base = used('');
    expect(used('1000 array pop') - base).toBe(88000);
    expect(used('1000 string pop') - base).toBe(1256);
    expect(used('(abc) pop') - base).toBe(256 + 3);
    // 辞書 1 つ (320 バイト) と 10 項、2 要素の手続き。save の外なので、書き換えの控えは積まない
    expect(used('10 dict begin 1 1 10 { dup def } for end') - base).toBe(320 + 10 * 192 + 2 * 88);
    expect(used('0 0 moveto 1 1 99 { dup lineto } for') - base).toBe(100 * 96 + 2 * 88);
    // 画像: 画素の RGBA と、描画の並びの 1 件 (4 点ぶん)。行列 (6 要素) と手続き (1 要素) の配列
    expect(used('/s 100 string def 10 10 8 [1 0 0 1 0 0] { s } image') - used('/s 100 string def')).toBe(400 + 4 * 96 + 7 * 88);
    // VM の勘定 (PLRM の数え方。1 要素 8 バイト) は変えない
    expect(run('1000 array pop').I.vmUsed - run('').I.vmUsed).toBe(8000);
  });
  it('別々の数を詰めた配列を作り続けるループは、VM の上限 (1 要素 8 バイト) より先に、合計の上限で止まる', () => {
    // 直す前は、VM の勘定 8MB (100 万要素) まで作れて、実際には数十 MB を使った
    const r = run('0 { dup [ 1 1 1000 { } for ] userdict 3 1 roll put 1 add } loop', { maxVM: 8 * MB, maxMemory: 2 * MB });
    expect(r.error).toMatch(/^VMerror/);
    expect(r.I.memUsed).toBeLessThanOrEqual(2 * MB);
    expect(r.I.vmUsed).toBeLessThan(MB / 2);
    expect(r.I.userdict.size).toBeLessThan(30);
  });
  it('restore は、save の記録と書き換えの控えの分を戻す (save と restore の組をくり返しても増えない)', () => {
    const one = run('/a 10 array def 1 { save a 0 1 put a 1 2 put restore } repeat').I.memUsed;
    const many = run('/a 10 array def 1000 { save a 0 1 put a 1 2 put restore } repeat').I.memUsed;
    expect(many).toBe(one);
    expect(vals('/a 10 array def 5000 { save a 0 1 put restore } repeat (done)', { maxMemory: MB })).toEqual(['done']);
  });
  it('VMerror は stopped で受けられる。エラーの記録は、合計が尽きていてもできる', () => {
    expect(vals('{ { 1000 array } loop } stopped { clear (ok) } if', { maxMemory: MB })).toEqual(['ok']);
    expect(run('{ 1000 array } loop', { maxMemory: MB }).I.$error.get('errorname')).toEqual({ t: 'name', v: 'VMerror', x: false });
    // 組み込みの辞書を作る分は数えない (上限が小さくても、空のプログラムは通る)
    expect(run('', { maxMemory: 1 }).error).toBeUndefined();
  });
  it('runEps・epsToSvg の maxMemory で差し替えられる。上限に当たった所までの絵とエラーを返す', async () => {
    const b = eps(`${path} ${image} ${path}`);
    const r = runEps(b, { maxMemory: 1.2 * MB, maxMillis: 3000 });
    expect(r!.error).toMatch(/^VMerror \(lineto\)/);
    expect(r!.items.map((it) => it.k)).toEqual(['stroke', 'image']);
    const svg = await epsToSvg(b, { maxMemory: 1.2 * MB, maxMillis: 3000 });
    expect(svg!.error).toMatch(/^VMerror \(lineto\)/);
    expect(svg!.count).toBe(2);
    expect(svg!.svg).toContain('<image ');
    // 既定の上限 (512MB) なら、終わりまで描く
    const full = await epsToSvg(b, { maxMillis: 3000 });
    expect(full!.error).toBeUndefined();
    expect(full!.count).toBe(3);
  });
  it('網かけの画像も、同じ勘定に積む', () => {
    const sh = '<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >> shfill';
    const one = run(sh);
    expect(one.error).toBeUndefined();
    const px = one.G.imagePixels!;
    expect(px).toBeGreaterThan(1000);
    expect(one.I.memUsed - run('').I.memUsed).toBeGreaterThanOrEqual(px * 4);
    expect(run(`{ ${sh} } loop`, { maxMemory: px * 4 * 3 }).error).toMatch(/^VMerror \(shfill\)/);
  });
});

describe('PS-18: epsToSvg の出力の長さの上限 (超えたら、そこまでを SVG にして limitcheck を返す)', () => {
  it('上限を超える所で止め、閉じた SVG を返す (クリップの g も閉じる)', async () => {
    // 入れ子のクリップ: 描くものごとに、クリップの g を外側から開き直すので、SVG は件数の 2 乗で伸びる
    const b = eps('1 1 200 { pop 0 0 moveto 90 90 lineto 90 0 lineto closepath clip newpath 0 0 moveto 50 50 lineto stroke } for');
    const full = await epsToSvg(b);
    expect(full!.error).toBeUndefined();
    expect(full!.svg.length).toBeGreaterThan(600_000);
    const cut = await epsToSvg(b, { maxSvgChars: 100_000 });
    expect(cut!.error).toMatch(/^limitcheck/);
    expect(cut!.svg.length).toBeLessThanOrEqual(100_000 + 400);
    expect(cut!.svg.length).toBeGreaterThan(90_000);
    // 途中までの SVG は、全体の SVG の先頭と同じ並びで、タグが閉じている
    expect(cut!.svg.endsWith('</g></svg>')).toBe(true);
    expect((cut!.svg.match(/<g[ >]/g) ?? []).length).toBe((cut!.svg.match(/<\/g>/g) ?? []).length);
    const body = (s: string) => s.slice(s.indexOf('<g transform='));
    const head = body(cut!.svg).replace(/(<\/g>)+<\/svg>$/, '');
    expect(body(full!.svg).startsWith(head)).toBe(true);
    // 描いたものの数は、実行した分
    expect(cut!.count).toBe(200);
  });
  it('画像は、base64 にする前に長さを確かめる。実行のエラーがあれば、そちらを返す', async () => {
    const img = '/s 3000 string def 0 1 2999 { s exch dup 251 mod put } for 100 100 8 [1 0 0 1 0 0] { s } false 3 colorimage';
    const b = eps(`0 0 moveto 9 9 lineto stroke ${img} 0 0 moveto 5 5 lineto stroke`);
    const full = await epsToSvg(b);
    expect(full!.error).toBeUndefined();
    expect(full!.svg).toContain('<image ');
    const cut = await epsToSvg(b, { maxSvgChars: 1000 });
    expect(cut!.error).toMatch(/^limitcheck/);
    expect(cut!.svg).not.toContain('<image ');
    expect((cut!.svg.match(/<path /g) ?? []).length).toBe(1);
    const both = await epsToSvg(eps(`0 0 moveto 9 9 lineto stroke ${img} foo`), { maxSvgChars: 1000 });
    expect(both!.error).toMatch(/^undefined \(foo\)/);
  });
  it('ふつうの絵の SVG は、前と同じ (断片をまとめて持っても、並びは変わらない)', async () => {
    const r = await epsToSvg(eps('10 10 moveto 90 10 lineto 90 90 lineto closepath clip newpath 1 0 0 setrgbcolor 0 0 100 100 rectfill 0 setgray 20 20 moveto 80 80 lineto stroke'));
    expect(r!.error).toBeUndefined();
    expect(r!.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100pt" height="100pt" viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<defs><clipPath id="c0" clipPathUnits="userSpaceOnUse"><path d="M10 10L90 10L90 90Z" clip-rule="nonzero"/></clipPath></defs>' +
        '<g transform="matrix(1 0 0 -1 0 100)"><g clip-path="url(#c0)"><path d="M0 0L100 0L100 100L0 100Z" fill="#ff0000"/>' +
        '<path transform="matrix(1 0 0 1 0 0)" d="M20 20L80 80" fill="none" stroke="#000000" stroke-width="1" stroke-miterlimit="10"/></g></g></svg>',
    );
  });
});
