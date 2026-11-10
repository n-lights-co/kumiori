import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Interp, latin1, strText, type PSObj } from '../src/psInterp';
import { filterSource, inflate } from '../src/psFilters';
import { decryptCharstring, runType1Charstring } from '../src/psFonts';
import { cffGlyph, parseCff } from '../src/psCff';
import { Graphics } from '../src/psGraphics';
import { epsProgram, epsToSvg, runEps } from '../src/eps';
import { epsPreview, imageInfo } from '../src/imageInfo';
import { extraTestFont } from './helpers';

/** プログラムを実行して、オペランドスタックを返す */
function run(src: string): { stack: PSObj[]; error?: string } {
  const I = new Interp();
  new Graphics(I, { bbox: [0, 0, 100, 100] });
  const error = I.run(latin1(src));
  return { stack: I.ostack, error };
}
const nums = (src: string) => run(src).stack.map((o) => (o.t === 'int' || o.t === 'real' ? o.v : o.t === 'bool' ? o.v : o.t === 'string' ? strText(o) : o.t === 'name' ? '/' + o.v : o.t));
const bytesOf = (src: { read(): number }) => {
  const out: number[] = [];
  for (let c = src.read(); c >= 0; c = src.read()) out.push(c);
  return out;
};
const source = (b: ArrayLike<number>) => {
  let i = 0;
  return { read: () => (i < b.length ? b[i++] : -1) };
};

describe('PostScript: 言語 (PLRM 第 3 章)', () => {
  it('算術・スタック', () => {
    expect(nums('40 60 add 2 div')).toEqual([50]);
    expect(nums('7 2 idiv 7 2 mod -7 2 idiv')).toEqual([3, 1, -3]);
    expect(nums('1 2 3 3 1 roll')).toEqual([3, 1, 2]);
    expect(nums('1 2 3 2 copy count')).toEqual([1, 2, 3, 2, 3, 5]);
    expect(nums('16#FF 8#17 2#101')).toEqual([255, 15, 5]);
    expect(nums('2.5 round -2.5 round 3.7 truncate')).toEqual([3, -2, 3]);
  });
  it('手続き・制御・辞書', () => {
    expect(nums('/average {add 2 div} def 40 60 average')).toEqual([50]);
    expect(nums('0 1 1 4 {add} for')).toEqual([10]);
    expect(nums('3 {1} repeat')).toEqual([1, 1, 1]);
    expect(nums('0 {1 add dup 5 eq {exit} if} loop')).toEqual([5]);
    expect(nums('1 2 gt {(a)} {(b)} ifelse')).toEqual(['b']);
    expect(nums('/d 2 dict def d /k 3 put d /k get d /x known')).toEqual([3, false]);
    expect(nums('{1 0 div} stopped')).toEqual([1, 0, true]);
    expect(nums('[1 2 3] {2 mul} forall')).toEqual([2, 4, 6]);
  });
  it('文字列の字句: 括弧・エスケープ・16 進・ASCII85 (§3.2)', () => {
    expect(nums('(a(b)c\\051\\n) length')).toEqual([7]);
    expect(nums('<41 42 4> ')).toEqual(['AB@']);
    expect(nums('<~87cURD]i,"Ebo80~>')).toEqual(['Hello World!']);
  });
  it('save と restore: 辞書の値を戻す (§3.7.3)', () => {
    expect(nums('/x 1 def save /x 2 def restore x')).toEqual([1]);
  });
  it('手続きの中の注釈の直後の }', () => {
    expect(nums('{1 % 注釈\n} exec')).toEqual([1]);
  });
  it('資源: Generic の分類を写して新しい分類を作る (§3.9.3)', () => {
    const r = nums('true setglobal /Widget /Generic /Category findresource dup length dict copy /Category defineresource pop false setglobal /F 7 /Widget defineresource pop /F /Widget findresource');
    expect(r[r.length - 1]).toBe(7);
  });
});

describe('PostScript: フィルタ (§3.13)', () => {
  it('LZWDecode: 仕様の例 (表 3.18 の符号 80 0B 60 50 22 0C 0E 02)', () => {
    // 9 ビットの符号 256 45 258 258 65 259 257 (表 3.18 の出力の列。最後の 66 は表にも出力されない)
    const out = bytesOf(filterSource('LZWDecode', source([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0e, 0x02])));
    expect(out).toEqual([45, 45, 45, 45, 45, 65, 45, 45, 45]);
  });
  it('FlateDecode: zlib で圧縮したものを元に戻す', () => {
    const data = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7 + (i >> 5)) & 255);
    const z = deflateSync(data);
    expect(Uint8Array.from(bytesOf(inflate(source(z))))).toEqual(data);
  });
  it('RunLengthDecode・ASCIIHexDecode', () => {
    expect(bytesOf(filterSource('RunLengthDecode', source([2, 1, 2, 3, 254, 9, 128])))).toEqual([1, 2, 3, 9, 9, 9]);
    expect(bytesOf(filterSource('ASCIIHexDecode', source(latin1('41 4 2>'))))).toEqual([0x41, 0x42]);
  });
  it('予測関数 (PNG の Up)', () => {
    // 2 行 × 2 バイト: 1 行目は None、2 行目は Up
    const data = Uint8Array.from([0, 10, 20, 2, 1, 1]);
    const params = new Interp().newDict();
    params.put('Predictor', { t: 'int', v: 12 });
    params.put('Columns', { t: 'int', v: 2 });
    expect(bytesOf(filterSource('FlateDecode', source(deflateSync(data)), params))).toEqual([10, 20, 11, 21]);
  });
});

describe('EPS (EPSF 3.0)', () => {
  const eps = (body: string, bbox = '0 0 100 50') => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: ${bbox}\n${body}\nshowpage\n`);
  it('塗り・線・クリップを描く', () => {
    const r = runEps(eps('1 0 0 setrgbcolor 10 10 moveto 50 10 lineto 50 40 lineto closepath fill 0 0 1 setrgbcolor 2 setlinewidth 0 0 moveto 100 50 lineto stroke'))!;
    expect(r.error).toBeUndefined();
    expect(r.items.map((i) => i.k)).toEqual(['fill', 'stroke']);
    const f = r.items[0];
    expect(f.k === 'fill' && f.color).toEqual([1, 0, 0]);
  });
  it('CMYK の色は CMYK の値も持つ (§7.2.4 の RGB と一緒に)', () => {
    const r = runEps(eps('0 1 0 0 setcmykcolor 0 0 10 10 rectfill'))!;
    const f = r.items[0];
    expect(f.k === 'fill' && f.color).toEqual([1, 0, 1]);
    expect(f.k === 'fill' && f.cmyk).toEqual([0, 1, 0, 0]);
  });
  it('色材の名前が None の Separation は描かない (§4.8.4)', () => {
    const r = runEps(eps('[/Separation /None /DeviceGray {pop 0}] setcolorspace 1 setcolor 0 0 10 10 rectfill [/Separation /Spot /DeviceCMYK {dup dup dup}] setcolorspace 1 setcolor 0 0 10 10 rectfill'))!;
    expect(r.items.length).toBe(1);
    const f = r.items[0];
    expect(f.k === 'fill' && f.cmyk).toEqual([1, 1, 1, 1]);
  });
  it('画像 (colorimage・手続きのデータの元) を描く', async () => {
    const r = await epsToSvg(eps('/s 6 string def 2 1 8 [2 0 0 1 0 0] {currentfile s readhexstring pop} false 3 colorimage\nff000000ff00', '0 0 2 1'));
    expect(r?.svg).toMatch(/<image [^>]*href="data:image\/png;base64,/);
  });
  it('埋め込まれていない書体の文字は SVG の text にする', async () => {
    const r = await epsToSvg(eps('/Helvetica findfont 12 scalefont setfont 10 10 moveto (Hi) show'));
    expect(r?.svg).toMatch(/<text [^>]*font-family="sans-serif"[^>]*>Hi<\/text>/);
  });
});

describe('Type 1 の書体 (Adobe Type 1 Font Format)', () => {
  const eps = (body: string, bbox = '0 0 100 50') => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: ${bbox}\n${body}\nshowpage\n`);
  // T1 §6.6 と §7.3 の例: 字「C」の字形の命令と、その暗号 (鍵 4330、先頭の 4 バイトは 0)
  const cipher = '10BF31704FAB5B1F03F9B68B1F39A66521B1841F1481697F8E12B7F7DDD6E3D7248D965B1CD45E2114';
  const plain = 'BDF9B40D8BEF038BEF01F8ECEF018B16F95006EF07FCEC06F88807F8EC06EF07FD5006090E';
  const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  it('字形の命令の暗号を解く (§7.3 の例)', () => {
    expect(decryptCharstring(hex(cipher), 4)).toEqual(hex(plain));
  });
  it('字形の命令を実行して輪郭と送りを作る (§6.6 の例)', () => {
    const g = runType1Charstring(hex(plain), { subr: () => undefined })!;
    expect([g.wx, g.wy]).toEqual([800, 0]);
    const pts = g.segs.filter((s) => s.op !== 'Z').map((s) => (s.op === 'C' ? [] : [s.x, s.y]));
    expect(pts).toEqual([
      [50, 0],
      [750, 0],
      [750, 100],
      [150, 100],
      [150, 600],
      [750, 600],
      [750, 700],
      [50, 700],
    ]);
  });
  it('埋め込んだ Type 1 の書体の字を、塗りとして描く (送りは字の幅)', () => {
    // 字形の命令は暗号のまま、CharStrings に入れる
    const r = runEps(
      eps(
        `/F 10 dict dup begin /FontName /T1Test def /FontType 1 def /PaintType 0 def /FontMatrix [0.001 0 0 0.001 0 0] def /FontBBox [0 0 1000 1000] def ` +
          `/Encoding 256 array 0 1 255 {1 index exch /.notdef put} for dup 67 /C put def ` +
          `/Private 2 dict dup begin /lenIV 4 def end def /CharStrings 2 dict dup begin /C <${cipher}> def /.notdef <${cipher}> def end def end def ` +
          `/T1Test F definefont 10 scalefont setfont 0 0 moveto (CC) show currentpoint`,
        '0 0 100 100',
      ),
    )!;
    expect(r.error).toBeUndefined();
    const f = r.items[0];
    expect(f.k).toBe('fill');
    // 2 字目は 8 (800 × 10/1000) 右にある
    const xs = f.k === 'fill' ? f.segs.filter((s) => s.op === 'M').map((s) => (s.op === 'M' ? s.x : 0)) : [];
    expect(xs[0]).toBeCloseTo(0.5, 5);
    expect(xs[1]).toBeCloseTo(8.5, 5);
  });
  it('eexec の暗号を解く (§7.2: 鍵 55665、先頭の 4 バイトを捨てる)', () => {
    // 平文「0 0 0 0」に続けて「userdict /x 5 put」を、鍵 55665 で暗号にして 16 進にする
    // (暗号を解いたプログラムは systemdict を辞書スタックに積んで実行するので、辞書を指定して定義する。PLRM §8.2 eexec)
    const text = latin1('\u0000\u0000\u0000\u0000userdict /x 5 put currentfile closefile ');
    let r = 55665;
    let h = '';
    for (const p of text) {
      const c = p ^ (r >> 8);
      r = ((c + r) * 52845 + 22719) & 0xffff;
      h += c.toString(16).padStart(2, '0');
    }
    expect(nums(`currentfile eexec ${h}\n x`)).toEqual([5]);
  });
});

describe('CFF の書体 (The Compact Font Format Specification・The Type 2 Charstring Format)', () => {
  // 書体は、機械に入っているものに頼らず、ほかのテストと同じく置き場 (.cache/fonts) に取得して使う (PKG-12。前は /usr/share/fonts に無ければ黙って飛ばしていた)。
  // 取得できなければ、テストは失敗する (飛ばさない)。書体と配信元は helpers の EXTRA_TEST_FONTS
  /** OpenType の CFF 表 */
  const cffTable = (file: string) => {
    const b = new Uint8Array(readFileSync(file));
    const dv = new DataView(b.buffer, b.byteOffset);
    for (let i = 0; i < dv.getUint16(4); i++)
      if (String.fromCharCode(...b.subarray(12 + i * 16, 16 + i * 16)) === 'CFF ') {
        const off = dv.getUint32(12 + i * 16 + 8);
        return b.subarray(off, off + dv.getUint32(12 + i * 16 + 12));
      }
    throw new Error('no CFF');
  };
  /** EPS の中に FontSetInit の StartData で CFF を埋め込む */
  const withCff = (cff: Uint8Array, body: string) => {
    const head = latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n/FontSetInit /ProcSet findresource begin /KumioriSet ${cff.length} StartData `);
    const tail = latin1(`\n${body}\nshowpage\n`);
    const out = new Uint8Array(head.length + cff.length + tail.length);
    out.set(head);
    out.set(cff, head.length);
    out.set(tail, head.length + cff.length);
    return out;
  };
  it('FontType 2 の書体の字を描く (幅は字の送り)', async () => {
    const cff = cffTable(await extraTestFont('SourceSans3-Regular-3.052R.otf'));
    const fname = parseCff(cff)[0].name;
    const r = runEps(withCff(cff, `/${fname} findfont 20 scalefont setfont 10 10 moveto (Hi) show currentpoint`))!;
    expect(r.error).toBeUndefined();
    const f = r.items[0];
    expect(f.k).toBe('fill');
    // 字の送り = 2 字の幅 (fontkit の送りと同じことは、全部の字で別に確かめた)
    const g = parseCff(cff)[0];
    const w = (cffGlyph(g, g.byName.get('H')!)!.wx + cffGlyph(g, g.byName.get('i')!)!.wx) * 0.02;
    expect(w).toBeGreaterThan(10);
  });
  it('CID の CFF を composefont の複合書体で描く (Identity-H)', async () => {
    const cff = cffTable(await extraTestFont('NotoSansJP-Regular-v25.otf'));
    // CID で引く書体であること (名前で引く書体に替わっていたら、このテストは CID の経路を通らない)
    expect(parseCff(cff)[0].cid).toBe(true);
    const cname = parseCff(cff)[0].name;
    const r = runEps(withCff(cff, `/U /Identity-H [/${cname}] composefont 16 scalefont setfont 10 10 moveto <0041 0042> show`))!;
    expect(r.error).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(r.items[0]?.k).toBe('fill');
  });
});

/** プログラムを実行して、描いたもの (Graphics) も返す */
function draw(src: string) {
  const I = new Interp();
  const G = new Graphics(I, { bbox: [0, 0, 100, 100] });
  const error = I.run(latin1(src));
  return { I, G, error, stack: I.ostack };
}
const epsOf = (body: string) => latin1(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n${body}\n`);

describe('PostScript: 結果の誤りの修正', () => {
  it('imagemask: polarity が true なら標本の 1 を、false なら 0 を塗る (PLRM §8.2 imagemask・§4.10.6)', () => {
    // 8×8。偶数の行が FF (全部 1)、奇数の行が 00
    const alphaOf = (polarity: boolean) => {
      const r = draw(`8 8 ${polarity} [8 0 0 8 0 0] {<FF00FF00FF00FF00>} imagemask`);
      expect(r.error).toBeUndefined();
      const it = r.G.items[0];
      if (it.k !== 'image' || !it.rgba) throw new Error('画像でない');
      return [0, 1].map((row) => it.rgba![row * 8 * 4 + 3]);
    };
    expect(alphaOf(true)).toEqual([255, 0]);
    expect(alphaOf(false)).toEqual([0, 255]);
    // 辞書の形: Decode [1 0] は 1 を塗る、[0 1] は 0 を塗る
    const dictAlpha = (decode: string) => {
      const r = draw(`<< /ImageType 1 /Width 8 /Height 8 /BitsPerComponent 1 /Decode [${decode}] /ImageMatrix [8 0 0 8 0 0] /DataSource <FF00FF00FF00FF00> >> imagemask`);
      const it = r.G.items[0];
      if (it.k !== 'image' || !it.rgba) throw new Error('画像でない');
      return [0, 1].map((row) => it.rgba![row * 8 * 4 + 3]);
    };
    expect(dictAlpha('1 0')).toEqual([255, 0]);
    expect(dictAlpha('0 1')).toEqual([0, 255]);
  });

  it('ImageType 3 のマスクの極性は imagemask と同じ: Decode [0 1] は標本の 0 を描き、[1 0] は 1 を描く (PLRM §4.10.6。PS-17)', () => {
    // 8×2 の灰色の画像。マスクは 1 行めが 0F (左の 4 つが 0、右の 4 つが 1)、2 行めが FF (全部 1)
    const alphaOf = (il: number, decode: string) => {
      const dataDict = (src: string) => `/DataDict << /ImageType 1 /Width 8 /Height 2 /BitsPerComponent 8 /ImageMatrix [8 0 0 2 0 0] /Decode [0 1] /DataSource ${src} >>`;
      const maskDict = (src: string) => `/MaskDict << /ImageType 1 /Width 8 /Height 2 /BitsPerComponent 1 /ImageMatrix [8 0 0 2 0 0] /Decode [${decode}] ${src} >>`;
      const g = '80'.repeat(8);
      let body: string;
      if (il === 3) body = `${dataDict(`<${g}${g}>`)} ${maskDict('/DataSource <0FFF>')}`;
      // 行ごとの組: マスクの行 (1 ビット) のあとに画像の行
      else if (il === 2) body = `${dataDict(`<0F${g}FF${g}>`)} ${maskDict('')}`;
      // 標本ごとの組: マスクの成分 (画像と同じ 8 ビット。0 か 255) が色の前に付く
      else body = `${dataDict(`<${'0080'.repeat(4)}${'FF80'.repeat(12)}>`)} ${maskDict('')}`;
      const r = draw(`/DeviceGray setcolorspace << /ImageType 3 /InterleaveType ${il} ${body} >> image`);
      expect(r.error).toBeUndefined();
      const it = r.G.items[0];
      if (it.k !== 'image' || !it.rgba) throw new Error('画像でない');
      // 1 行めの左・1 行めの右・2 行めの左
      return [0, 7, 8].map((i) => it.rgba![i * 4 + 3]);
    };
    for (const il of [1, 2, 3]) {
      expect(alphaOf(il, '0 1'), `InterleaveType ${il}`).toEqual([255, 0, 0]);
      expect(alphaOf(il, '1 0'), `InterleaveType ${il} の Decode [1 0]`).toEqual([0, 255, 255]);
    }
  });

  it('SubFileDecode は、EODCount・EODString を辞書に入れた形 (LanguageLevel 3) でも使える (PLRM §3.13.3。PS-13)', () => {
    // 辞書の形: EODCount 0 は EODString の手前まで
    expect(nums('(abcXdef) << /EODCount 0 /EODString (X) >> /SubFileDecode filter 10 string readstring')).toEqual(['abc', false]);
    // EODCount 1 は 1 つめの EODString まで (EODString も含む)
    expect(nums('(abcXdefXg) << /EODCount 1 /EODString (X) >> /SubFileDecode filter 20 string readstring')).toEqual(['abcX', false]);
    // EODString が空なら EODCount バイト
    expect(nums('(abcXdef) << /EODCount 5 /EODString () >> /SubFileDecode filter 10 string readstring')).toEqual(['abcXd', false]);
    // これまでの形 (オペランドで渡す。辞書を前に置く形も) は同じ
    expect(nums('(abcXdef) 0 (X) /SubFileDecode filter 10 string readstring')).toEqual(['abc', false]);
    expect(nums('(abcXdef) << >> 0 (X) /SubFileDecode filter 10 string readstring')).toEqual(['abc', false]);
  });

  it('フィルタのエラーは PostScript のエラーになり、stopped で受けられる (PLRM §8.2 filter・§3.13.3)', async () => {
    // 持っていないフィルタ: undefined (オペランドは元に戻る。§3.11.1)
    expect(nums('{currentfile /CCITTFaxDecode filter} stopped $error /errorname get')).toEqual(['file', '/CCITTFaxDecode', true, '/undefined']);
    // 読み出し中に壊れたデータ (ASCII85 に無い字): ioerror
    expect(nums('{(!!!!!\\200) /ASCII85Decode filter 10 string readstring} stopped $error /errorname get').slice(-2)).toEqual([true, '/ioerror']);
    // 壊れたデータを通したファイルを実行する
    expect(nums('{(1 2 add \\200) /ASCII85Decode filter cvx exec} stopped $error /errorname get').slice(-2)).toEqual([true, '/ioerror']);
    // 壊れた ASCII85 の文字列の字句は syntaxerror (§3.2.2)
    expect(run('<~!!\x80~>').error).toMatch(/^syntaxerror/);
    // 受けなくても、それまでに描いたものは残る (EPS 全体が描けなくならない)
    const r = (await epsToSvg(epsOf('0 0 moveto 50 50 lineto stroke currentfile /CCITTFaxDecode filter pop 0 50 moveto 50 0 lineto stroke')))!;
    expect(r.count).toBe(1);
    expect(r.error).toMatch(/^undefined/);
    expect(r.svg).toContain('<path');
  });

  it('字の名前が Object.prototype の名前 (constructor など) でも落ちない', async () => {
    // Encoding の全部の字の名前を constructor にした書体。字は表に無いので、符号のままの字を代わりの書体で描く
    const r = (await epsToSvg(
      epsOf('/Helvetica findfont dup length dict copy dup /Encoding 256 array dup 0 1 255 { 1 index exch /constructor put } for pop put /Q exch definefont 10 scalefont setfont 10 10 moveto (A) show 0 0 moveto 50 50 lineto stroke'),
    ))!;
    expect(r.error).toBeUndefined();
    expect(r.svg).toContain('>A</text>');
    expect(r.count).toBe(2);
  });

  it('show は、gsave と共有しているパスを書き換えない (下線の書き方)', () => {
    const strokes = (src: string) => {
      const r = draw(src);
      expect(r.error).toBeUndefined();
      return r.G.items.filter((i) => i.k === 'stroke').map((i) => (i.k === 'stroke' ? i.segs : []));
    };
    const plain = strokes('0 0 moveto 50 0 rlineto stroke');
    expect(plain[0]).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 50, y: 0 },
    ]);
    // 文字を描いてから grestore で戻り、初めの点から線を引く
    expect(strokes('/Helvetica findfont 10 scalefont setfont 0 0 moveto gsave (abc) show grestore 50 0 rlineto stroke')).toEqual(plain);
  });

  it('currentgstate は、渡された gstate を現在の状態の写しで置き換える (PLRM §8.2)', () => {
    expect(nums('/gs gstate def 5 setlinewidth gs currentgstate pop 1 setlinewidth gs setgstate currentlinewidth')).toEqual([5]);
    // 返すのは、渡されたのと同じ gstate
    expect(nums('/gs gstate def gs currentgstate gs eq')).toEqual([true]);
    // 書き換えた後に現在の状態を変えても、gstate の中身は変わらない
    expect(nums('/gs gstate def 0 0 moveto 3 setlinewidth gs currentgstate pop 10 10 lineto 7 setlinewidth gs setgstate currentlinewidth currentpoint')).toEqual([3, 0, 0]);
  });

  it('rectfill・rectstroke は現在のパスに触れず、部分パスの始まりも元のまま (PLRM §8.2)', () => {
    const strokes = (src: string) => {
      const r = draw(src);
      expect(r.error).toBeUndefined();
      return r.G.items.filter((i) => i.k === 'stroke').map((i) => (i.k === 'stroke' ? i.segs : []));
    };
    // closepath は (0, 0) に戻るので、続く rlineto は (20, 0) へ
    const plain = strokes('0 0 moveto 10 0 lineto 10 10 lineto closepath 20 0 rlineto stroke');
    expect(plain[0][plain[0].length - 1]).toEqual({ op: 'L', x: 20, y: 0 });
    expect(strokes('0 0 moveto 10 0 lineto 50 50 5 5 rectfill 10 10 lineto closepath 20 0 rlineto stroke')).toEqual(plain);
    expect(strokes('0 0 moveto 10 0 lineto 1 setgray 50 50 5 5 rectstroke 0 setgray 10 10 lineto closepath 20 0 rlineto stroke')[1]).toEqual(plain[0]);
  });

  it('rectstroke: numarray matrix・x y width height matrix の形で行列を取る (PLRM §8.2)', () => {
    for (const src of ['[0 0 10 10] [2 0 0 2 0 0] rectstroke count', '0 0 10 10 [2 0 0 2 0 0] rectstroke count', '[0 0 10 10 20 20 5 5] [2 0 0 2 0 0] rectstroke count']) {
      const r = draw(src);
      expect(r.error, src).toBeUndefined();
      expect(r.stack.map((o) => (o.t === 'int' ? o.v : o.t)), src).toEqual([0]);
      const it = r.G.items[0];
      if (it.k !== 'stroke') throw new Error('線でない');
      // 矩形は元の座標のまま、線だけに行列が掛かる
      expect(it.segs[0]).toEqual({ op: 'M', x: 0, y: 0 });
      expect(it.segs[1]).toEqual({ op: 'L', x: 10, y: 0 });
      expect(it.ctm.slice(0, 4)).toEqual([2, 0, 0, 2]);
    }
    // 行列の無い形はこれまでどおり
    const r = draw('[0 0 10 10] rectstroke 0 0 10 10 rectstroke count');
    expect(r.stack.map((o) => (o.t === 'int' ? o.v : o.t))).toEqual([0]);
    expect(r.G.items.length).toBe(2);
  });

  it('DOS 形式の頭が途中で切れた EPS は、読めない EPS として扱う (例外を投げない)', async () => {
    for (const n of [4, 6, 11, 12, 20, 27]) {
      const b = new Uint8Array(n);
      b.set([0xc5, 0xd0, 0xd3, 0xc6]);
      expect(epsProgram(b), String(n)).toBeUndefined();
      expect(runEps(b), String(n)).toBeUndefined();
      expect(await epsToSvg(b), String(n)).toBeUndefined();
      expect(epsPreview(b), String(n)).toBeUndefined();
      expect(imageInfo(b), String(n)).toBeUndefined();
    }
  });
});
