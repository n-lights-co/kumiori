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

/** 最初の画像の画素 (RGBA。標本の並びの順) */
function imageOf(src: string) {
  const r = draw(src);
  expect(r.error, src).toBeUndefined();
  const it = r.G.items.find((i) => i.k === 'image');
  if (!it || it.k !== 'image' || !it.rgba) throw new Error('画像でない: ' + src);
  const px = (i: number) => Array.from(it.rgba!.subarray(i * 4, i * 4 + 4));
  return { it, px, alpha: Array.from({ length: it.width * it.height }, (_, i) => it.rgba![i * 4 + 3]) };
}
/** stopped で受けたエラーの名前 (誤りが無ければ undefined) */
function errorName(src: string): string | undefined {
  const s = run(`{ ${src} } stopped { $error /errorname get } { null } ifelse`).stack;
  const top = s[s.length - 1];
  return top.t === 'name' ? top.v : undefined;
}
const hex = (b: ArrayLike<number>) => `<${Array.from(b, (c) => c.toString(16).padStart(2, '0')).join('')}>`;

describe('PostScript: 画像 (PLRM §4.10)', () => {
  it('image: 画像の空間からユーザ空間への対応は ImageMatrix の逆 (§4.10.3)', () => {
    // ImageMatrix [w 0 0 -h 0 h] は、上の行から並ぶ標本を単位の正方形に置く。標本の (0, 0) はユーザ空間の (0, 1)
    const a = imageOf('8 8 8 [8 0 0 -8 0 8] <80> image');
    expect(a.it.mat.map((v) => +v.toFixed(9))).toEqual([0.125, 0, 0, -0.125, 0, 1]);
    // CTM を掛けた後: (0, 1) は (10, 60)、標本 1 つは横 30/8・縦 40/8
    const b = imageOf('10 20 translate 30 40 scale 8 8 8 [8 0 0 -8 0 8] <80> image');
    expect(b.it.mat.map((v) => +v.toFixed(9))).toEqual([3.75, 0, 0, -5, 10, 60]);
    expect([b.it.width, b.it.height]).toEqual([8, 8]);
  });

  it('image: 標本の復号は Dmin + i × (Dmax − Dmin) / (2^n − 1) (§4.10.5 Sample Decoding)', () => {
    // 4 ビット: 標本 0・5・15 (行は 1 バイトの境まで詰め物をする。幅 3 なら 1 行 2 バイト)
    const dict = (decode: string) => `/DeviceGray setcolorspace << /ImageType 1 /Width 3 /Height 2 /BitsPerComponent 4 /Decode [${decode}] /ImageMatrix [3 0 0 2 0 0] /DataSource <05F0 F500> >> image`;
    const g = (src: string) => {
      const a = imageOf(src);
      return [0, 1, 2, 3, 4, 5].map((i) => a.px(i)[0]);
    };
    expect(g(dict('0 1'))).toEqual([0, 85, 255, 255, 85, 0]);
    expect(g(dict('1 0'))).toEqual([255, 170, 0, 0, 170, 255]);
    // 色は不透明
    expect(imageOf(dict('0 1')).alpha).toEqual([255, 255, 255, 255, 255, 255]);
    // 1 ビット (幅 3: 行ごとに 1 バイト)。5 つのオペランドの形の image は DeviceGray で、0 が黒
    expect(g('3 2 1 [3 0 0 2 0 0] <A0 40> image')).toEqual([255, 0, 255, 0, 255, 0]);
    // 12 ビット: 標本 0xFFF と 0x800 (2 つで 3 バイト)
    const a = imageOf('2 1 12 [2 0 0 1 0 0] <FFF800> image');
    expect([a.px(0)[0], a.px(1)[0]]).toEqual([255, Math.round((0x800 / 4095) * 255)]);
  });

  it('image: 文字列のデータの元は、足りるまで繰り返し使う (§4.10.2)', () => {
    const a = imageOf('4 2 8 [4 0 0 2 0 0] <40C0> image');
    expect(Array.from({ length: 8 }, (_, i) => a.px(i)[0])).toEqual([64, 192, 64, 192, 64, 192, 64, 192]);
  });

  it('image: データの元が途中で終わったら、残りは描かない (§4.10.2)', () => {
    // 手続きは 1 度めに 1 行ぶんを返し、2 度めからは長さ 0 の文字列を返す
    const a = imageOf('/n 0 def 2 2 8 [2 0 0 2 0 0] { n 0 eq { /n 1 def <FFFF> } { () } ifelse } image');
    expect(a.alpha).toEqual([255, 255, 0, 0]);
  });

  it('colorimage: 成分ごとの元 (multi が true) と、1 つの元に標本ごとに並べた形 (§8.2 colorimage)', () => {
    const multi = imageOf('2 1 8 [2 0 0 1 0 0] <FF00> <00FF> <0000> true 3 colorimage');
    expect([multi.px(0), multi.px(1)]).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const single = imageOf('2 1 8 [2 0 0 1 0 0] <FF0000 00FF00> false 3 colorimage');
    expect([single.px(0), single.px(1)]).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    // 4 成分は DeviceCMYK (RGB への変換は §7.2.4): マゼンタだけ・黒だけ
    const cmyk = imageOf('2 1 8 [2 0 0 1 0 0] <00FF0000 000000FF> false 4 colorimage');
    expect([cmyk.px(0), cmyk.px(1)]).toEqual([
      [255, 0, 255, 255],
      [0, 0, 0, 255],
    ]);
    // 成分の数は 1・3・4 だけ
    expect(errorName('2 1 8 [2 0 0 1 0 0] <0000> false 2 colorimage')).toBe('rangecheck');
  });

  it('imagemask: 塗る所は現在の色、塗らない所は透明。行は 1 バイトの境まで詰め物をする (§4.10.6 Stencil Masking)', () => {
    // 幅 3・高さ 2。1 行めは 101、2 行めは 010 (残りの 5 ビットは詰め物)
    const a = imageOf('1 0 0 setrgbcolor 3 2 true [3 0 0 2 0 0] <A0 40> imagemask');
    expect(a.alpha).toEqual([255, 0, 255, 0, 255, 0]);
    expect(a.px(0)).toEqual([255, 0, 0, 255]);
    expect(a.px(4)).toEqual([255, 0, 0, 255]);
    // 詰め物のビットが 1 でも、幅の外は描かない
    expect(imageOf('3 2 true [3 0 0 2 0 0] <BF 5F> imagemask').alpha).toEqual([255, 0, 255, 0, 255, 0]);
    // 現在の色空間が何であっても、成分は 1 つ (DeviceCMYK の色でも標本は 1 ビット)
    const c = imageOf('0 1 1 0 setcmykcolor 3 2 false [3 0 0 2 0 0] <A0 40> imagemask');
    expect(c.alpha).toEqual([0, 255, 0, 255, 0, 255]);
    expect(c.px(1)).toEqual([255, 0, 0, 255]);
    // 辞書の形でデータの元が手続きのもの
    const d = imageOf('0 0 1 setrgbcolor << /ImageType 1 /Width 3 /Height 2 /BitsPerComponent 1 /Decode [1 0] /ImageMatrix [3 0 0 2 0 0] /DataSource { <A0 40> } >> imagemask');
    expect(d.alpha).toEqual([255, 0, 255, 0, 255, 0]);
    expect(d.px(0)).toEqual([0, 0, 255, 255]);
  });

  it('Type 3 の画像: 隠した所も色の標本は読み進め、描く所は画像の色になる (§4.10.6 Explicit Masking・表 4.22)', () => {
    // InterleaveType 1 (標本ごと)。RGB の 2×1: マスクの成分・R・G・B。マスクが 0 と 1 以外の値 (0x55) は 1 として扱う
    const one = (mask: string) => imageOf(`/DeviceRGB setcolorspace << /ImageType 3 /InterleaveType 1
      /DataDict << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /ImageMatrix [2 0 0 1 0 0] /Decode [0 1 0 1 0 1] /DataSource <${mask}FF0000 0000FF00> >>
      /MaskDict << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /ImageMatrix [2 0 0 1 0 0] /Decode [0 1] >> >> image`);
    for (const m of ['FF', '55']) {
      const a = one(m);
      expect(a.alpha, m).toEqual([0, 255]);
      expect(a.px(1), m).toEqual([0, 255, 0, 255]);
    }
    expect(one('00').px(0)).toEqual([255, 0, 0, 255]);
  });

  it('Type 3 の画像: 行ごとの組 (InterleaveType 2) は、高さの比のぶんだけマスクの行と画像の行が並ぶ (表 4.22)', () => {
    // 画像は 2×2 (灰色)、マスクは 2×1: マスクの 1 行 (1 バイトに詰める) のあとに画像の 2 行
    const a = imageOf(`/DeviceGray setcolorspace << /ImageType 3 /InterleaveType 2
      /DataDict << /ImageType 1 /Width 2 /Height 2 /BitsPerComponent 8 /ImageMatrix [2 0 0 2 0 0] /Decode [0 1] /DataSource <40 1020 3040> >>
      /MaskDict << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 1 /ImageMatrix [2 0 0 1 0 0] /Decode [0 1] >> >> image`);
    // マスクは 01: 左の列を描き、右の列は隠す (復号した値の 0 が描く所。表 4.24)
    expect(a.alpha).toEqual([255, 0, 255, 0]);
    expect([a.px(0)[0], a.px(2)[0]]).toEqual([0x10, 0x30]);
  });

  it('Type 3 の画像: 別の元 (InterleaveType 3) のマスクは、画像と違う寸法でも同じ所に重なる。色は成分ごとの元でもよい (表 4.22)', () => {
    // 画像は 4×2 の RGB (成分ごとの元)、マスクは 2×1 (左半分を隠し、右半分を描く)
    const a = imageOf(`/DeviceRGB setcolorspace << /ImageType 3 /InterleaveType 3
      /DataDict << /ImageType 1 /Width 4 /Height 2 /BitsPerComponent 8 /ImageMatrix [4 0 0 2 0 0] /Decode [0 1 0 1 0 1]
        /MultipleDataSources true /DataSource [ <FF> <00> <80> ] >>
      /MaskDict << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 1 /ImageMatrix [2 0 0 1 0 0] /Decode [0 1] /DataSource <80> >> >> image`);
    expect(a.alpha).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
    expect(a.px(2)).toEqual([255, 0, 128, 255]);
  });

  it('Type 3 の画像: DataDict・MaskDict が無ければ typecheck (§4.10.6)', () => {
    expect(errorName('<< /ImageType 3 /InterleaveType 3 /MaskDict << >> >> image')).toBe('typecheck');
    expect(errorName('<< /ImageType 3 /InterleaveType 3 /DataDict << >> >> image')).toBe('typecheck');
  });

  it('Type 4 の画像: MaskColor に合う標本は描かない。比べるのは Decode を当てる前の値 (§4.10.6 Color Key Masking・表 4.25)', () => {
    const rgb = (maskColor: string, decode = '0 1 0 1 0 1') =>
      imageOf(`/DeviceRGB setcolorspace << /ImageType 4 /MaskColor [${maskColor}] /Width 3 /Height 1 /BitsPerComponent 8 /ImageMatrix [3 0 0 1 0 0]
        /Decode [${decode}] /DataSource <FF0000 FA0505 00FF00> >> image`);
    // n 個の数: その色だけ
    const exact = rgb('255 0 0');
    expect(exact.alpha).toEqual([0, 255, 255]);
    expect(exact.px(1)).toEqual([250, 5, 5, 255]);
    expect(exact.px(2)).toEqual([0, 255, 0, 255]);
    // 2n 個の数: 成分ごとの範囲。全部の成分が範囲に入る標本だけを隠す
    expect(rgb('250 255 0 5 0 5').alpha).toEqual([0, 0, 255]);
    expect(rgb('250 255 0 4 0 5').alpha).toEqual([0, 255, 255]);
    // Decode で反転しても、隠すのは元の標本の値が合う所。描く所の色は Decode を当てた値
    const inv = rgb('255 0 0', '1 0 1 0 1 0');
    expect(inv.alpha).toEqual([0, 255, 255]);
    expect(inv.px(2)).toEqual([255, 0, 255, 255]);
    // 1 ビットの灰色: 標本の 0 を隠す
    const gray = imageOf('/DeviceGray setcolorspace << /ImageType 4 /MaskColor [0] /Width 4 /Height 1 /BitsPerComponent 1 /ImageMatrix [4 0 0 1 0 0] /Decode [0 1] /DataSource <A0> >> image');
    expect(gray.alpha).toEqual([255, 0, 255, 0]);
    expect(gray.px(0)).toEqual([255, 255, 255, 255]);
  });

  it('画像の辞書: ImageType が 1・3・4 以外、BitsPerComponent が決まった値以外は rangecheck (表 4.20)', () => {
    const d = (extra: string) => `/DeviceGray setcolorspace << /Width 1 /Height 1 /ImageMatrix [1 0 0 1 0 0] /Decode [0 1] /DataSource <00> ${extra} >> image`;
    expect(errorName(d('/ImageType 1 /BitsPerComponent 8'))).toBeUndefined();
    expect(errorName(d('/ImageType 5 /BitsPerComponent 8'))).toBe('rangecheck');
    expect(errorName(d('/ImageType 1 /BitsPerComponent 3'))).toBe('rangecheck');
  });
});

describe('PostScript: フィルタのエラーと終わり (PLRM §3.13.2・§3.13.3)', () => {
  /** フィルタから読めるだけ読んだ文字列と、readstring の結果 */
  const readAll = (data: string, filter: string) => nums(`${data} ${filter} filter 100 string readstring`);

  it('ASCIIHexDecode: 16 進の字・空白・> 以外は ioerror。奇数個で終われば 0 を補う', () => {
    expect(readAll('(41 4)', '/ASCIIHexDecode')).toEqual(['A@', false]);
    expect(readAll('(4>)', '/ASCIIHexDecode')).toEqual(['@', false]);
    expect(readAll('(4a\\t4B\\n\\0004c>4d)', '/ASCIIHexDecode')).toEqual(['JKL', false]);
    expect(errorName('(41 4G 42>) /ASCIIHexDecode filter 10 string readstring')).toBe('ioerror');
    expect(errorName('(41<42>) /ASCIIHexDecode filter 10 string readstring')).toBe('ioerror');
  });

  it('ASCII85Decode: 符号化の決まりに反する並びは ioerror', () => {
    expect(readAll('(87cURD]i,"Ebo80~>)', '/ASCII85Decode')).toEqual(['Hello World!', false]);
    // z は 4 つの 0。空白は読み飛ばす
    expect(nums('(z !!!!! ~>) /ASCII85Decode filter 20 string readstring exch length exch')).toEqual([8, false]);
    // 5 字の組の値が 2^32 − 1 を超える (s8W-! がちょうど 2^32 − 1)
    expect(nums('(s8W-!~>) /ASCII85Decode filter 20 string readstring exch length exch')).toEqual([4, false]);
    expect(errorName('(s8W-"~>) /ASCII85Decode filter 20 string readstring')).toBe('ioerror');
    // 組の途中の z
    expect(errorName('(!!z!!~>) /ASCII85Decode filter 20 string readstring')).toBe('ioerror');
    // 最後の半端な組が 1 字だけ
    expect(errorName('(!!!!!!~>) /ASCII85Decode filter 20 string readstring')).toBe('ioerror');
    // ! 〜 u・z・空白・~ 以外の字
    expect(errorName('(!!v!!~>) /ASCII85Decode filter 20 string readstring')).toBe('ioerror');
    // ~ の次は > でなければならない
    expect(errorName('(!!!!!~x) /ASCII85Decode filter 20 string readstring')).toBe('ioerror');
  });

  it('RunLengthDecode: 長さ 128 が終わり。元が途中で尽きたら、そこまでで EOF になる (エラーにしない)', () => {
    expect(readAll('<02 414243 FE 5A 80 41>', '/RunLengthDecode')).toEqual(['ABCZZZ', false]);
    expect(readAll('<02 4142>', '/RunLengthDecode')).toEqual(['AB', false]);
    expect(readAll('<00 41 FE>', '/RunLengthDecode')).toEqual(['A', false]);
    expect(readAll('<00 41>', '/RunLengthDecode')).toEqual(['A', false]);
  });

  it('LZWDecode: 表に無い符号は ioerror。終わりの符号の前に元が尽きたら EOF', () => {
    // 9 ビットの符号 256 (表の初期化)・300 (まだ表に無い)
    expect(errorName('<804B00> /LZWDecode filter 10 string readstring')).toBe('ioerror');
    // 256・45 のあと、符号の途中で元が尽きる
    expect(readAll('<800B60>', '/LZWDecode')).toEqual(['-', false]);
  });

  it('FlateDecode: 壊れたデータは ioerror。途中で切れたデータは、そこまでで EOF', () => {
    // zlib の頭 (78 9C) のあと、種類が 3 (予約。RFC 1951 §3.2.3) のブロック
    expect(errorName('<789C07> /FlateDecode filter 10 string readstring')).toBe('ioerror');
    // 圧縮しないブロック (RFC 1951 §3.2.4) を、中身の 5 バイトめで切る
    const z = deflateSync(Buffer.from('hello world'), { level: 0 });
    expect(Array.from(z.subarray(2, 7))).toEqual([1, 11, 0, 0xf4, 0xff]);
    expect(readAll(hex(z), '/FlateDecode')).toEqual(['hello world', false]);
    expect(readAll(hex(z.subarray(0, 12)), '/FlateDecode')).toEqual(['hello', false]);
    // 距離が窓の外・長さの符号が表の外などの細工はここでは見ない (robustness のテストにある)
  });

  it('終わり (EOD) まで読んだフィルタは、元のファイルの EOD の直後で止まる (§3.13.2)', () => {
    // フィルタを最後まで読んだあと、プログラムの続き (pop 7) は元のファイルから読まれる (データは readstring の次の行から)
    expect(nums('currentfile /ASCIIHexDecode filter 10 string readstring\n4142> pop 7')).toEqual(['AB', 7]);
    expect(nums('currentfile /ASCII85Decode filter 20 string readstring\n87cURD]i,"Ebo80~> pop 7')).toEqual(['Hello World!', 7]);
    // EOF になったフィルタからは読めない (read は false)
    expect(nums('/f (41>) /ASCIIHexDecode filter def f read f read')).toEqual([65, true, false]);
  });

  it('filter 演算子: 名前でないフィルタの名前・データの元にならないものは typecheck、持たないフィルタは undefined (§8.2 filter)', () => {
    expect(errorName('(41>) (ASCIIHexDecode) filter')).toBe('typecheck');
    expect(errorName('42 /ASCIIHexDecode filter')).toBe('typecheck');
    expect(errorName('(x) /CCITTFaxDecode filter')).toBe('undefined');
    expect(errorName('(x) /NoSuchDecode filter')).toBe('undefined');
    expect(errorName('/ASCIIHexDecode filter')).toBe('stackunderflow');
  });

  it('Filter の資源の分類は、使えるフィルタだけを実例に持つ (§3.9.2 表 3.8。CCITTFaxDecode は無い)', () => {
    const r = run('[ (*) { cvn } 40 string /Filter resourceforall ]');
    expect(r.error).toBeUndefined();
    const top = r.stack[0];
    if (top.t !== 'array') throw new Error('配列でない');
    const names = top.a.slice(top.o, top.o + top.n).map((o) => (o.t === 'name' ? o.v : ''));
    expect(names).toContain('FlateDecode');
    expect(names).not.toContain('CCITTFaxDecode');
    expect(nums('/CCITTFaxDecode /Filter resourcestatus')).toEqual([false]);
    expect(nums('/FlateDecode /Filter resourcestatus { pop pop true } { false } ifelse')).toEqual([true]);
    // 実例に挙げたフィルタは、どれも作れる (undefined にならない)
    for (const n of names) {
      const operands = n === 'SubFileDecode' ? '() 0 ()' : '()';
      expect(errorName(`${operands} /${n} filter`), n).toBeUndefined();
    }
  });
});

describe('PostScript: 矩形と資源の演算子 (PLRM §4.6.5・§3.9)', () => {
  const segsOf = (src: string, kind: 'fill' | 'stroke') => {
    const r = draw(src);
    expect(r.error, src).toBeUndefined();
    const it = r.G.items.find((i) => i.k === kind);
    if (!it || (it.k !== 'fill' && it.k !== 'stroke')) throw new Error('塗り・線でない');
    return it.segs;
  };
  /** 閉じた形の向き (符号つきの面積。正なら反時計まわり) */
  const area = (pts: Array<{ x: number; y: number }>) => pts.reduce((s, p, i) => s + (p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y) / 2, 0);

  it('rectstroke・rectfill: x y moveto、width 0 rlineto、0 height rlineto、width neg 0 rlineto、closepath の形 (§8.2)', () => {
    for (const [src, kind] of [
      ['10 20 30 40 rectstroke', 'stroke'],
      ['10 20 30 40 rectfill', 'fill'],
    ] as const) {
      const s = segsOf(src, kind);
      expect(s.map((p) => p.op), src).toEqual(['M', 'L', 'L', 'L', 'Z']);
      expect(s.slice(0, 4).map((p) => ('x' in p ? [p.x, p.y] : [])), src).toEqual([
        [10, 20],
        [40, 20],
        [40, 60],
        [10, 60],
      ]);
    }
  });

  it('rectstroke: 線の太さ・色・CTM は現在のグラフィックス状態のもの。配列の形は矩形ごとの部分パス (§4.6.5)', () => {
    const r = draw('3 setlinewidth 0 0 1 setrgbcolor 2 2 scale [0 0 10 10 20 20 5 5] rectstroke');
    expect(r.error).toBeUndefined();
    expect(r.G.items.length).toBe(1);
    const it = r.G.items[0];
    if (it.k !== 'stroke') throw new Error('線でない');
    expect(it.color).toEqual([0, 0, 1]);
    expect(it.lineWidth).toBe(3);
    expect(it.segs.map((p) => p.op).join('')).toBe('MLLLZMLLLZ');
    // パスは機器の座標 (2 倍)
    expect(it.segs[5]).toEqual({ op: 'M', x: 40, y: 40 });
  });

  it('矩形は、幅・高さの符号によらず、ユーザ空間で反時計まわりに描く (§4.6.5)', () => {
    for (const wh of ['30 40', '-30 40', '30 -40', '-30 -40']) {
      const s = segsOf(`50 50 ${wh} rectfill`, 'fill');
      const pts = s.filter((p) => p.op !== 'Z') as Array<{ x: number; y: number }>;
      expect(pts[0], wh).toMatchObject({ x: 50, y: 50 });
      expect(area(pts), wh).toBe(1200);
    }
  });

  it('rectfill・rectstroke のオペランドの型 (§8.2)', () => {
    expect(errorName('(a) /x 1 2 rectfill')).toBe('typecheck');
    expect(errorName('1 2 3 rectfill')).toBe('stackunderflow');
    expect(errorName('/x rectstroke')).toBe('typecheck');
  });

  it('resourceforall: 名前を scratch に写し、使った分の部分文字列を手続きに渡す (§8.2)', () => {
    const defs = '/abc 1 dict /Pattern defineresource pop ';
    // 渡すのは文字列。scratch と同じ領域を指す
    expect(nums(defs + '/s 20 string def (ab*) { dup type exch length } s /Pattern resourceforall s 0 3 getinterval')).toEqual(['/stringtype', 3, 'abc']);
    // 合う実例が無ければ、手続きを呼ばない (エラーにもしない)
    expect(nums(defs + '(zz*) { pop 1 } 20 string /Pattern resourceforall')).toEqual([]);
    // 文字列の鍵で定義した実例も、名前と同じに扱う
    expect(nums('(xyz) 1 dict /Pattern defineresource pop (x*) { dup length string copy } 20 string /Pattern resourceforall')).toEqual(['xyz']);
    // 分類が無ければ undefined
    expect(errorName('(*) { pop } 20 string /NoSuchCategory resourceforall')).toBe('undefined');
    // オペランドの型
    expect(errorName('(*) { pop } 20 /Pattern resourceforall')).toBe('typecheck');
  });

  it('resourceforall: 手続きの中の exit で止まる (§8.2 exit)', () => {
    const defs = ['a1', 'a2', 'a3'].map((n) => `/${n} 1 dict /Pattern defineresource pop`).join(' ');
    expect(nums(defs + ' 0 (a*) { pop 1 add } 20 string /Pattern resourceforall')).toEqual([3]);
    expect(nums(defs + ' 0 (a*) { pop 1 add exit } 20 string /Pattern resourceforall')).toEqual([1]);
  });

  it('resourceforall: 同じ実例は 1 度だけ。名前でも文字列でもない鍵は型紙 (*) だけに合い、鍵をそのまま渡す (§8.2)', () => {
    // 同じ名前を global と local の両方に定義する
    const both = 'true setglobal /dup1 1 dict /Pattern defineresource pop false setglobal /dup1 1 dict /Pattern defineresource pop ';
    expect(nums(both + '0 (dup*) { pop 1 add } 20 string /Pattern resourceforall')).toEqual([1]);
    // 整数の鍵
    const intKey = '7 1 dict /Pattern defineresource pop ';
    expect(nums(intKey + '(*) { } 20 string /Pattern resourceforall')).toEqual([7]);
    expect(nums(intKey + '(7) { } 20 string /Pattern resourceforall')).toEqual([]);
    expect(nums(intKey + '(?) { } 20 string /Pattern resourceforall')).toEqual([]);
  });

  it('resourcestatus: defineresource で定義した実例の status は 0。無ければ false (§8.2)', () => {
    expect(nums('/abc 1 dict /Pattern defineresource pop /abc /Pattern resourcestatus exch pop')).toEqual([0, true]);
    expect(nums('/nothere /Pattern resourcestatus')).toEqual([false]);
    expect(errorName('/abc /NoSuchCategory resourcestatus')).toBe('undefined');
  });
});
