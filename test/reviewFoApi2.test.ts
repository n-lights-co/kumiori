/**
 * コードレビュー (XSL-FO の読み込みと公開 API・コマンド・書体まわり) の指摘の回帰テスト:
 *  - H3: page-sequence-master の既定のマスターに白ページ (blank) の候補を選ばない
 *  - H5: 入力の文字の符号化 (BOM・XML 宣言の encoding・<meta charset>)
 *  - M2: fonts に渡した壊れた書体ファイルは警告にする
 *  - M3: 公開 API の経路では書体を document.fonts に登録しない (canvas: false)
 *  - M5: DOCTYPE の内部実体の展開
 *  - M6: fetchImages で http(s) の画像の取得を止める
 *  - M9・L8: -o に既存のディレクトリ、使い方の誤りは UsageError
 *  - L1: 太さの後備 (CSS Fonts 4 §5.2)、L2: foExpr の単項 + と min/max の 0、L3: color="inherit"、L4: font-family の引用符、
 *    L5: files の書体の太さは usWeightClass、L6: --spot-colors の配列の 1 を超える値は誤り
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { createTypesetter, decodeDocumentText, typeset, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
import { DEFAULT_FONTS } from '../src/index';
import { expandInternalEntities } from '../src/api';
import { FontManager, nearestWeightIndex } from '../src/fontManager';
import { collectionFaces, countFonts, splitFontFile, FontFileError } from '../src/fontLoader';
import { createFontMapping } from '../src/fontMapping';
import { evalLength } from '../src/foExpr';
import { UsageError, parseArgs, parseSpotColors, planJobs } from '../src/cli';
import type { LBlockContainer, LPageSequence } from '../src/types';
import { ensureFonts, fontDir } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const imp = (xml: string, o: ImportOptions = {}) => importXslFo(xml, parse, { compat: 'spec', ...o });
const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>`;
const fo = (flow: string, rootAttrs = '') => `<?xml version="1.0"?><fo:root ${NS} ${rootAttrs}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const fontFile = (name: string): ArrayBuffer => {
  const b = fs.readFileSync(path.join(fontDir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const textOf = (tree: Awaited<ReturnType<typeof typeset>>['areaTree']) => {
  let t = '';
  walkAreaTree(tree, (a) => {
    if (a.type === 'glyph') t += (a as GlyphArea).text;
  });
  return t;
};

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('H3: page-sequence-master の既定のマスター', () => {
  // 白ページ用のマスター (余白 40mm) を alternatives の先頭に置き、奇数・偶数のマスター (余白 10mm) を後ろに置く
  const masters = `<fo:layout-master-set>
    <fo:simple-page-master master-name="blank" page-width="100mm" page-height="100mm" margin="40mm"><fo:region-body/></fo:simple-page-master>
    <fo:simple-page-master master-name="odd" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master>
    <fo:simple-page-master master-name="even" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master>
    <fo:page-sequence-master master-name="seq"><fo:repeatable-page-master-alternatives>
      <fo:conditional-page-master-reference master-reference="blank" blank-or-not-blank="blank"/>
      <fo:conditional-page-master-reference master-reference="odd" odd-or-even="odd"/>
      <fo:conditional-page-master-reference master-reference="even" odd-or-even="even"/>
    </fo:repeatable-page-master-alternatives></fo:page-sequence-master>
  </fo:layout-master-set>`;
  const doc = (flow: string) => `<fo:root ${NS}>${masters}<fo:page-sequence master-reference="seq"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  it('白ページ (blank) の候補は既定のマスターにしない (百分率の基準と seq.master が白ページでないマスターになる)', () => {
    const seq = imp(doc('<fo:block-container width="50%"><fo:block>a</fo:block></fo:block-container>')).document.sequences[0] as LPageSequence;
    expect(seq.master.margins.left).toBe(10);
    // 本文幅 80mm の半分 = 40mm = 113.39pt (白ページの本文幅 20mm の半分 28.35pt ではない)
    expect((seq.flow.children[0] as LBlockContainer).width).toBeCloseTo((40 * 72) / 25.4, 1);
  });
  it('白ページでない候補が無ければ先頭の候補を使う', () => {
    const only = masters.replace(/<fo:conditional-page-master-reference master-reference="(odd|even)"[^>]*\/>/g, '');
    const seq = imp(`<fo:root ${NS}>${only}<fo:page-sequence master-reference="seq"><fo:flow flow-name="xsl-region-body"><fo:block>a</fo:block></fo:flow></fo:page-sequence></fo:root>`).document.sequences[0];
    expect(seq.master.margins.left).toBe(40);
  });
});

describe('H5: 文書の文字の符号化 (decodeDocumentText)', () => {
  const enc = (s: string, label: string) => {
    // Node の TextEncoder は UTF-8 だけなので、Shift_JIS・EUC-JP のバイト列は iconv 無しで手で作る
    const bytes: Record<string, number[]> = { shift_jis: [0x93, 0xfa, 0x96, 0x7b], 'euc-jp': [0xc6, 0xfc, 0xcb, 0xdc] };
    return new Uint8Array([...new TextEncoder().encode(s), ...bytes[label], ...new TextEncoder().encode('</r>')]);
  };
  it('XML 宣言の encoding (Shift_JIS・EUC-JP) で復号する', () => {
    expect(decodeDocumentText(enc('<?xml version="1.0" encoding="Shift_JIS"?><r>', 'shift_jis'))).toBe('<?xml version="1.0" encoding="Shift_JIS"?><r>日本</r>');
    expect(decodeDocumentText(enc('<?xml version="1.0" encoding="EUC-JP"?>\n<r>', 'euc-jp'))).toBe('<?xml version="1.0" encoding="EUC-JP"?>\n<r>日本</r>');
  });
  it('宣言が無ければ UTF-8。UTF-8 の BOM は取り除き、UTF-16 の BOM は UTF-16 として読む', () => {
    expect(decodeDocumentText(new TextEncoder().encode('<r>日本</r>'))).toBe('<r>日本</r>');
    expect(decodeDocumentText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<r>日本</r>')]))).toBe('<r>日本</r>');
    const u16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('<r>日本</r>', 'utf16le')]);
    expect(decodeDocumentText(u16)).toBe('<r>日本</r>');
  });
  it('HTML の <meta charset>・content="…; charset=…" で復号する。知らない名前は UTF-8', () => {
    expect(decodeDocumentText(enc('<html><head><meta charset="shift_jis"></head><body><r>', 'shift_jis'))).toContain('日本');
    expect(decodeDocumentText(enc('<html><head><meta http-equiv="Content-Type" content="text/html; charset=EUC-JP"></head><r>', 'euc-jp'))).toContain('日本');
    expect(decodeDocumentText(new TextEncoder().encode('<?xml version="1.0" encoding="x-nonsense"?><r>日本</r>'))).toContain('日本');
  });
});

describe('M2: fonts の壊れた書体ファイル', () => {
  it('短いファイル・壊れた TTC は FontFileError (RangeError を出さない)', () => {
    expect(() => countFonts(new Uint8Array([1, 2, 3]).buffer)).toThrow(FontFileError);
    const ttc = new Uint8Array(32);
    ttc.set([0x74, 0x74, 0x63, 0x66]); // 'ttcf'
    new DataView(ttc.buffer).setUint32(8, 1_000_000);
    expect(() => collectionFaces(ttc.buffer)).toThrow(FontFileError);
    expect(splitFontFile(new Uint8Array([1, 2, 3]).buffer)).toEqual([]);
    expect(splitFontFile(ttc.buffer)).toEqual([]);
  });
  it('createTypesetter は壊れた書体を警告にして、ほかの書体を登録する', async () => {
    const ttc = new Uint8Array(32);
    ttc.set([0x74, 0x74, 0x63, 0x66]);
    new DataView(ttc.buffer).setUint32(8, 1_000_000);
    const t = await createTypesetter({ loadFont, fonts: [{ name: 'bad.ttc', data: ttc }, { name: 'short.ttf', data: new Uint8Array([1, 2, 3]) }, { name: 'Arimo-Regular.ttf', data: fontFile('Arimo-Regular.ttf') }] });
    const r = await t.typeset('<p style="font-family: Arimo">abc</p>', { kind: 'html' });
    expect(r.warnings.filter((w) => /bad\.ttc の書体を読めません/.test(w))).toHaveLength(1);
    expect(r.warnings.filter((w) => /short\.ttf の書体を読めません/.test(w))).toHaveLength(1);
    expect(r.pageCount).toBe(1);
    expect(r.areaTree.resources?.fonts.some((f) => /Arimo/.test(f.family))).toBe(true);
  });
});

describe('M3: 公開 API の書体はブラウザの document.fonts に登録しない', () => {
  afterEach(() => vi.restoreAllMocks());
  it('FO と一緒に渡した書体と、HTML の @font-face の書体を canvas: false で登録する', async () => {
    const spy = vi.spyOn(FontManager.prototype, 'registerBuffer');
    const t = await createTypesetter({ loadFont });
    const foDoc = fo('<fo:block font-family="Arimo">abc</fo:block>');
    await t.typeset(foDoc, { kind: 'fo', files: [{ name: 'Arimo-Regular.ttf', data: fontFile('Arimo-Regular.ttf') }] });
    const css = `@font-face { font-family: "My Face"; src: url(Arimo-Regular.ttf); } p { font-family: "My Face"; }`;
    await t.typeset('<p>abc</p>', { kind: 'html', files: [{ name: 's.css', data: css }, { name: 'Arimo-Regular.ttf', data: fontFile('Arimo-Regular.ttf') }] });
    const userCalls = spy.mock.calls.filter(([family]) => family === 'Arimo' || /^css:/.test(family));
    expect(userCalls.length).toBeGreaterThanOrEqual(2);
    expect(userCalls.every(([, , , canvas]) => canvas === false)).toBe(true);
  });
  it('createFontMapping の canvas の選択肢 (画面は true のまま)', async () => {
    const spy = vi.spyOn(FontManager.prototype, 'registerBuffer');
    const fonts = new FontManager();
    await fonts.registerBuffer('Arimo', 400, fontFile('Arimo-Regular.ttf'), false);
    const file = { name: 'arimo-bold.ttf', arrayBuffer: async () => fontFile('Arimo-Bold.ttf') };
    const css = `@font-face { font-family: F; font-weight: 700; src: url(arimo-bold.ttf); }`;
    await createFontMapping(fonts).loadFontFaces(css, [file]);
    await createFontMapping(fonts, undefined, { canvas: false }).loadFontFaces(css, [file]);
    const calls = spy.mock.calls.filter(([family]) => family === 'css:F').map(([, , , canvas]) => canvas);
    expect(calls).toEqual([true, false]);
  });
});

describe('M5: DOCTYPE の内部実体', () => {
  it('内部実体を &name; に展開する (CDATA・コメントの中は触らない。既定の実体・数値参照はそのまま)', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY co "Kumiori"><!ENTITY nb "&#160;"><!ENTITY both "&co;&nb;">]><r>&co;&nb;&both;&amp;&lt;&#65;<![CDATA[&co;]]><!-- &co; --></r>`;
    expect(expandInternalEntities(xml)).toBe(`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY co "Kumiori"><!ENTITY nb "&#160;"><!ENTITY both "&co;&nb;">]><r>Kumiori&#160;Kumiori&#160;&amp;&lt;&#65;<![CDATA[&co;]]><!-- &co; --></r>`);
    expect(expandInternalEntities('<r>&x;</r>')).toBe('<r>&x;</r>');
  });
  it('外部実体と引数実体は展開しない。入れ子の深すぎる実体・大きすぎる展開は誤り', () => {
    expect(expandInternalEntities(`<!DOCTYPE r [<!ENTITY ext SYSTEM "file:///etc/passwd"><!ENTITY % p "x">]><r>&ext;%p;</r>`)).toBe(`<!DOCTYPE r [<!ENTITY ext SYSTEM "file:///etc/passwd"><!ENTITY % p "x">]><r>&ext;%p;</r>`);
    expect(() => expandInternalEntities(`<!DOCTYPE r [<!ENTITY a "&a;">]><r>&a;</r>`)).toThrow(/入れ子が深すぎ/);
    const lol = `<!DOCTYPE r [<!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]><r>&d;&d;&d;&d;&d;&d;&d;&d;</r>`;
    expect(() => expandInternalEntities(lol)).toThrow(/大きすぎ/);
  });
  it('typeset (xmldom) で内部実体を使う FO が組める', async () => {
    const doc = `<?xml version="1.0"?><!DOCTYPE fo:root [<!ENTITY co "Kumiori"><!ENTITY nb "&#160;">]><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>&co;&nb;X</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(doc, { kind: 'fo', loadFont });
    expect(textOf(r.areaTree)).toContain('Kumiori');
    expect(textOf(r.areaTree)).toContain('X');
  });
});

describe('M6: http(s) の画像の取得 (fetchImages)', () => {
  afterEach(() => vi.restoreAllMocks());
  const doc = fo('<fo:block><fo:external-graphic src="url(http://169.254.169.254/latest/meta-data)"/><fo:external-graphic src="https://example.com/ok.png"/>a</fo:block>');
  it('fetchImages: false なら取らない (警告に入れる)。関数なら URL ごとに決める。既定は取る', async () => {
    const fetched: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      fetched.push(String(u));
      return new Response(null, { status: 404 });
    });
    const off = await typeset(doc, { kind: 'fo', loadFont, fetchImages: false });
    expect(fetched).toEqual([]);
    expect(off.warnings.filter((w) => /画像を取りません/.test(w))).toHaveLength(2);
    await typeset(doc, { kind: 'fo', loadFont, fetchImages: (u) => /^https:\/\/example\.com\//.test(u) });
    expect(fetched).toEqual(['https://example.com/ok.png']);
    fetched.length = 0;
    await typeset(doc, { kind: 'fo', loadFont });
    expect(fetched.sort()).toEqual(['http://169.254.169.254/latest/meta-data', 'https://example.com/ok.png']);
  });
  it('CLI の --no-fetch-images', () => {
    expect(parseArgs(['a.fo']).fetchImages).toBe(true);
    expect(parseArgs(['a.fo', '--no-fetch-images']).fetchImages).toBe(false);
  });
});

describe('M9・L8: CLI の出力先と使い方の誤り', () => {
  const isDir = (p: string) => /outdir$/.test(p);
  it('入力が 1 つでも -o が既存のディレクトリなら、その中に <入力名>.pdf を書く', () => {
    expect(planJobs({ inputs: ['/doc/plain.fo'], output: '/x/outdir', watch: false }, isDir)).toEqual([{ input: path.resolve('/doc/plain.fo'), output: path.resolve('/x/outdir/plain.pdf') }]);
    expect(planJobs({ inputs: ['/doc/plain.fo'], output: '/x/out.pdf', watch: false }, isDir)).toEqual([{ input: path.resolve('/doc/plain.fo'), output: path.resolve('/x/out.pdf') }]);
    expect(planJobs({ inputs: ['/doc/plain.fo'], watch: false }, isDir)).toEqual([{ input: path.resolve('/doc/plain.fo'), output: path.resolve('/doc/plain.pdf') }]);
  });
  it('入力が複数なら -o はディレクトリ (無くても)。同じ名前の出力には -2・-3 を付ける', () => {
    expect(planJobs({ inputs: ['/a/doc.fo', '/b/doc.html'], output: '/x/new', watch: false }, isDir).map((j) => j.output)).toEqual([path.resolve('/x/new/doc.pdf'), path.resolve('/x/new/doc-2.pdf')]);
  });
  it('使い方の誤りは UsageError (スタックトレースを出さない)', () => {
    expect(() => planJobs({ inputs: ['a.fo', '-'], watch: false }, isDir)).toThrow(UsageError);
    expect(() => planJobs({ inputs: ['-'], watch: true }, isDir)).toThrow(UsageError);
    expect(() => planJobs({ inputs: ['a.fo', 'b.fo'], output: '-', watch: false }, isDir)).toThrow(UsageError);
    expect(planJobs({ inputs: ['-'], output: '-', watch: false }, isDir)).toEqual([{ input: '-', output: '-' }]);
  });
});

describe('L1: 太さの後備 (CSS Fonts 4 §5.2)', () => {
  it('400 は 500 → 軽い方 → 重い方、500 は 400、400 未満は軽い方、500 より重いときは重い方', () => {
    const pick = (ws: number[], w: number) => ws[nearestWeightIndex(ws, w)];
    expect(pick([400, 900], 600)).toBe(900);
    expect(pick([400, 900], 500)).toBe(400);
    expect(pick([300, 500, 900], 400)).toBe(500);
    expect(pick([300, 900], 400)).toBe(300);
    expect(pick([900], 400)).toBe(900);
    expect(pick([400, 700], 300)).toBe(400);
    expect(pick([200, 400, 700], 300)).toBe(200);
    expect(pick([400, 700], 600)).toBe(700);
    expect(pick([100, 400], 600)).toBe(400);
    expect(pick([400, 700], 700)).toBe(700);
  });
  it('FontManager.get も同じ規則で選ぶ (400 と 900 で 600 を求めると 900)', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer('A', 400, fontFile('Arimo-Regular.ttf'), false);
    await fonts.registerBuffer('A', 900, fontFile('Arimo-Bold.ttf'), false);
    expect(fonts.get('A', 600).weight).toBe(900);
    expect(fonts.get('A', 500).weight).toBe(400);
    expect(fonts.get('A', 400).weight).toBe(400);
  });
});

describe('L2: foExpr の細かな非対応', () => {
  const L = (s: string) => evalLength(s, { fs: 10 });
  it('括弧の中・演算子の後の単項 + を受け付ける', () => {
    expect(L('(+12pt)')).toBe(12);
    expect(L('2pt + +3pt')).toBe(5);
    expect(L('+12pt')).toBe(12);
  });
  it('min・max の単位の無い 0 を長さとして扱う (加算と同じ)', () => {
    expect(L('min(0, 2pt)')).toBe(0);
    expect(L('max(0, 1em)')).toBe(10);
    expect(L('max(2pt, 0)')).toBe(2);
    expect(L('max(1, 1em)')).toBeUndefined();
  });
});

describe('L3・L4: color="inherit" と font-family の引用符', () => {
  it('color="inherit" は未対応の色として報告しない (親の色を継承する)', () => {
    const r = imp(fo('<fo:block color="red"><fo:inline color="inherit">a</fo:inline></fo:block>'));
    expect(Object.keys(r.report.unsupported).filter((k) => /^color:/.test(k))).toEqual([]);
    expect(Object.keys(imp(fo('<fo:block color="bogus">a</fo:block>')).report.unsupported)).toContain('color:bogus');
  });
  it("font-family=\"'A, B', serif\" は 2 つの名前 (引用符の中のカンマでは分けない)", () => {
    const seen: string[][] = [];
    imp(fo(`<fo:block font-family="'A, B', serif">a</fo:block>`), {
      mapFont: (names) => {
        seen.push(names);
        return undefined;
      },
    });
    expect(seen).toContainEqual(['A, B', 'serif']);
  });
});

describe('L5: files の書体の太さ', () => {
  it('splitFontFile の weight は usWeightClass そのまま (Medium 500 を 400 にしない)', () => {
    const buf = new Uint8Array(fontFile('Arimo-Regular.ttf'));
    const v = new DataView(buf.buffer);
    for (let k = 0; k < v.getUint16(4); k++) {
      const at = 12 + 16 * k;
      if (String.fromCharCode(...buf.slice(at, at + 4)) !== 'OS/2') continue;
      v.setUint16(v.getUint32(at + 8) + 4, 500); // usWeightClass
    }
    expect(splitFontFile(buf.buffer).map((u) => u.weight)).toEqual([500]);
    expect(splitFontFile(fontFile('Arimo-Bold.ttf')).map((u) => u.weight)).toEqual([700]);
  });
});

describe('L6: --spot-colors の配列', () => {
  it('0〜1 の 4 つの数。1 を超える要素は誤り ([100, 50, 1, 0] の 1 を 100% にしない)', () => {
    expect(parseSpotColors({ A: [0.2, 0.4, 0.6, 0.8], B: 'cmyk(20%,40%,60%,80%)' })).toEqual({ A: [0.2, 0.4, 0.6, 0.8], B: [0.2, 0.4, 0.6, 0.8] });
    expect(() => parseSpotColors({ A: [100, 50, 1, 0] })).toThrow(UsageError);
    expect(() => parseSpotColors({ A: [0.2, 0.4, 0.6] })).toThrow(UsageError);
  });
});
