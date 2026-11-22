/**
 * 診断と誤りの名前 (src/diagnostics.ts) と、説明書の一覧 (docs/diagnostics.md・docs/en/diagnostics.md) が食い違わないこと。
 * 診断の集め方 (同じものを数える・名前ごとの上限) と、誤りの型
 */
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_CODES, DiagnosticList, ERROR_CODES, MAX_DIAGNOSTICS_PER_CODE, diag, errorKindOf, isOmittedDiagnostic, severityOf } from '../src/diagnostics';
import { KumioriError, KumioriFontError, KumioriInputError, KumioriLimitError, KumioriOptionError, KumioriPdfError, isKumioriError } from '../src/errors';
import { AreaTreeFormatError } from '../src/areaTree';
import { FontFileError } from '../src/fontLoader';
import { DEFAULT_FONTS, createTypesetter, typeset, typesetFo, typesetHtml, typesetToPdf, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

/** 説明書の表の行 (| `名前` | 2 列目 | …) を、見出しで分けた節ごとに読む */
function tableRows(md: string, section: RegExp): Array<[string, string]> {
  const parts = md.split(/^## /m);
  const body = parts.find((p) => section.test(p.split('\n')[0]));
  if (!body) throw new Error(`no section ${section}`);
  return [...body.matchAll(/^\| `([a-z0-9/-]+)` \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()]);
}

const KIND_TYPE = { option: '`KumioriOptionError`', input: '`KumioriInputError`', limit: '`KumioriLimitError`', font: '`KumioriFontError`', pdf: '`KumioriPdfError`', internal: '`KumioriError`' } as const;

describe('診断と誤りの名前の一覧', () => {
  for (const [file, diagSection, errorSection] of [
    ['docs/diagnostics.md', /^診断の名前/, /^誤りの型と名前/],
    ['docs/en/diagnostics.md', /^Diagnostic codes/, /^Error types and codes/],
  ] as const) {
    const md = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    it(`${file} の診断の表は、src の表と同じ名前・同じ重さ・同じ順`, () => {
      const rows = tableRows(md, diagSection);
      expect(rows.map((r) => r[0])).toEqual([...DIAGNOSTIC_CODES]);
      for (const [code, sev] of rows) expect(sev, code).toBe(severityOf(code as (typeof DIAGNOSTIC_CODES)[number]));
    });
    it(`${file} の誤りの表は、src の表と同じ名前・同じ型・同じ順`, () => {
      const rows = tableRows(md, errorSection);
      expect(rows.map((r) => r[0])).toEqual([...ERROR_CODES]);
      for (const [code, type] of rows) expect(type, code).toBe(KIND_TYPE[errorKindOf(code as (typeof ERROR_CODES)[number])]);
    });
  }
  it('名前は「段/中身」の形', () => {
    for (const c of [...DIAGNOSTIC_CODES, ...ERROR_CODES]) expect(c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('DiagnosticList', () => {
  it('同じ診断 (名前・文・場所) は 1 件にして数える', () => {
    const l = new DiagnosticList();
    l.add(diag('layout/line-overflow', 'a'));
    l.add(diag('layout/line-overflow', 'a'));
    l.add(diag('layout/line-overflow', 'b'));
    l.add({ ...diag('css/unknown-property', 'c', { property: 'x' }), count: 3 });
    expect(l.list).toEqual([
      { code: 'layout/line-overflow', severity: 'error', message: 'a', count: 2 },
      { code: 'layout/line-overflow', severity: 'error', message: 'b' },
      { code: 'css/unknown-property', severity: 'warning', message: 'c', args: { property: 'x' }, count: 3 },
    ]);
  });
  it('名前ごとに上限の件数まで残し、超えた分は残した診断に数えず、「ほかに n 件 (m 種)」の 1 件にまとめる', () => {
    const l = new DiagnosticList();
    for (let i = 0; i < MAX_DIAGNOSTICS_PER_CODE + 5; i++) l.add(diag('image/not-found', `x${i}`));
    // 省いた種類の繰り返し (数は omitted に数え、種類は増やさない)・数を持つ診断
    l.add(diag('image/not-found', `x${MAX_DIAGNOSTICS_PER_CODE}`));
    l.add({ ...diag('image/not-found', 'y'), count: 3 });
    l.add(diag('layout/line-overflow', 'a'));
    expect(l.list).toHaveLength(MAX_DIAGNOSTICS_PER_CODE + 2);
    expect(l.list[MAX_DIAGNOSTICS_PER_CODE - 1]).toEqual({ code: 'image/not-found', severity: 'error', message: `x${MAX_DIAGNOSTICS_PER_CODE - 1}` });
    const o = l.list[MAX_DIAGNOSTICS_PER_CODE]!;
    expect(o).toMatchObject({ code: 'image/not-found', severity: 'error', args: { omitted: 9, omittedKinds: 6 } });
    expect(o.count).toBeUndefined();
    expect(o.message).toBe(`同じ種類の誤りがほかに 9 件 (6 種) あります (1 つの名前につき ${MAX_DIAGNOSTICS_PER_CODE} 件まで残します)`);
    expect(isOmittedDiagnostic(o)).toBe(true);
    expect(l.list[MAX_DIAGNOSTICS_PER_CODE + 1]!.code).toBe('layout/line-overflow');
    // 別の入れ物に移しても (組版の後に、結果の診断へまとめるとき)、省いた分は 1 件のまま数を足す
    const m = new DiagnosticList();
    m.addAll(l.list);
    m.add(diag('image/not-found', 'z'));
    expect(m.list).toHaveLength(MAX_DIAGNOSTICS_PER_CODE + 2);
    expect(m.list.filter(isOmittedDiagnostic).map((d) => d.args)).toEqual([{ omitted: 10, omittedKinds: 7 }]);
  });
});

describe('誤りの型', () => {
  it('どれも code を持ち、isKumioriError で見分けられる', () => {
    const errs = [new KumioriError('internal/page-sealed', 'm'), new KumioriInputError('input/xml-parse', 'm'), new KumioriLimitError('limit/nesting-depth', 'm'), new KumioriFontError('font/load-failed', 'm'), new KumioriPdfError('pdfx/not-conforming', 'm')];
    for (const e of errs) {
      expect(e).toBeInstanceOf(KumioriError);
      expect(e).toBeInstanceOf(Error);
      expect(isKumioriError(e)).toBe(true);
      expect(e.name).toBe(e.constructor.name);
    }
    const o = new KumioriOptionError('m', 'pageSize');
    expect(o).toBeInstanceOf(TypeError);
    expect(o.code).toBe('api/invalid-option');
    expect(o.option).toBe('pageSize');
    expect(isKumioriError(o)).toBe(true);
    expect(isKumioriError(new Error('x'))).toBe(false);
  });
  it('AreaTreeFormatError・FontFileError は、入力・書体の誤りの下の型', () => {
    const a = new AreaTreeFormatError('m');
    expect(a).toBeInstanceOf(KumioriInputError);
    expect(a.code).toBe('area-tree/format');
    const f = new FontFileError('m');
    expect(f).toBeInstanceOf(KumioriFontError);
    expect(f.code).toBe('font/broken-file');
  });
});

describe('組版の結果の diagnostics', () => {
  it('HTML: 未対応・知らない CSS は名前ごとに 1 件 (warnings の文はいまのまま)。見つからない画像・溢れも名前が付く', async () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>.g { display: grid; grid-template-areas: "a b" } .s { position: sticky }</style></head>' +
      '<body><div class="g"><p>a</p><p>b</p></div><p class="s" style="image-rendering: pixelated; colr: red; colr: blue">s</p><img src="none.png"></body></html>';
    const r = await typesetHtml(html, { name: 't.html', loadFont });
    expect(r.warnings).toContain('未対応の CSS を無視しました: grid-template-areas、image-rendering、position: sticky');
    expect(r.warnings).toContain('知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr (2)');
    const css = r.diagnostics.filter((d) => d.code === 'css/unsupported');
    expect(css.map((d) => d.args?.item)).toEqual(['grid-template-areas', 'image-rendering', 'position: sticky']);
    expect(css.every((d) => d.severity === 'warning')).toBe(true);
    expect(r.diagnostics.find((d) => d.code === 'css/unknown-property')).toMatchObject({
      code: 'css/unknown-property',
      severity: 'warning',
      message: '知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr',
      args: { property: 'colr' },
      count: 2,
    });
    const img = r.diagnostics.find((d) => d.code === 'image/not-found');
    expect(img).toMatchObject({ severity: 'error', args: { src: 'none.png' } });
    expect(r.warnings).toContain(img!.message);
    // 診断の文は、どれも warnings の文か、まとめた文の項目
    for (const d of r.diagnostics) expect(r.warnings.some((w) => w === d.message || w.startsWith(d.message.split(': ')[0]))).toBe(true);
  });
  it('警告の無い文書は、diagnostics が空で、Area Tree に diagnostics の欄が無い', async () => {
    const r = await typesetHtml('<!DOCTYPE html><html lang="ja"><head><title>t</title></head><body><p>x</p></body></html>', { name: 't.html', loadFont });
    expect(r.warnings).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect('diagnostics' in r.areaTree).toBe(false);
  });
  it('XSL-FO: 読めない要素の診断、組版の診断 (参照先の id が無い) は Area Tree にも入る', async () => {
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>x<fo:nonexistent>y</fo:nonexistent> <fo:page-number-citation ref-id="nowhere"/></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typesetFo(fo, { name: 't.fo', loadFont });
    expect(r.diagnostics.find((d) => d.code === 'fo/unsupported')?.args).toEqual({ item: 'fo:nonexistent' });
    const missing = r.diagnostics.find((d) => d.code === 'layout/missing-id');
    expect(missing).toMatchObject({ severity: 'warning', args: { id: 'nowhere', kind: 'page-number-citation' } });
    expect(r.areaTree.diagnostics).toContainEqual(missing);
  });
  it('PDF を書く途中の診断は、toPdf の後の diagnostics と typesetToPdf の diagnostics に入る', async () => {
    const html = '<!DOCTYPE html><html><head></head><body><p>x</p></body></html>';
    const r = await typesetHtml(html, { name: 't.html', loadFont, pdfua: true });
    expect(r.diagnostics.some((d) => d.code.startsWith('pdfua/'))).toBe(false);
    await r.toPdf();
    await r.toPdf();
    const ua = r.diagnostics.filter((d) => d.code.startsWith('pdfua/')).map((d) => d.code);
    expect(ua).toEqual(['pdfua/missing-title', 'pdfua/missing-lang']);
    // 題の名前は、XSL-FO では axf:document-info の document-title (title は書き換えを勧める名前)
    expect(r.diagnostics.find((d) => d.code === 'pdfua/missing-title')!.message).toContain('axf:document-info の document-title');
    // 2 度目の toPdf は、同じ文を足さない (診断も)
    expect(r.diagnostics.filter((d) => d.code === 'pdfua/missing-title')[0].count).toBeUndefined();
    const p = await typesetToPdf(html, { name: 't.html', loadFont, pdfua: true });
    expect(p.diagnostics.filter((d) => d.code.startsWith('pdfua/')).map((d) => d.code)).toEqual(['pdfua/missing-title', 'pdfua/missing-lang']);
    expect(p.warnings).toEqual(r.warnings);
  });
  it('誤り: 選択肢の誤りは KumioriOptionError (TypeError)、XML の解析の誤りは KumioriInputError', async () => {
    const e1 = await typesetHtml('<p>x</p>', { loadFont, pageSize: 'nope' }).catch((e) => e);
    expect(e1).toBeInstanceOf(KumioriOptionError);
    expect(e1).toBeInstanceOf(TypeError);
    expect(e1.option).toBe('pageSize');
    const e2 = await typesetFo('<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:x>', { loadFont }).catch((e) => e);
    expect(e2).toBeInstanceOf(KumioriInputError);
    expect(e2.code).toBe('input/xml-parse');
  });
  it('誤り: 型の外の選択肢 (documentLang: 123・tagged: "yes"・options の null など) も KumioriOptionError (前は documentLang: 123 で読めない PDF を返し、null は生の TypeError)', async () => {
    const opt = async (p: Promise<unknown>, option: string) => {
      const e = (await p.catch((x: unknown) => x)) as KumioriOptionError;
      expect(e, option).toBeInstanceOf(KumioriOptionError);
      expect(e.option).toBe(option);
    };
    await opt(typesetToPdf('<p>x</p>', { loadFont, documentLang: 123 as never }), 'documentLang');
    await opt(typesetToPdf('<p>x</p>', { loadFont, documentLang: 'ja jp' }), 'documentLang');
    await opt(typesetToPdf('<p>x</p>', { loadFont, tagged: 'yes' as never }), 'tagged');
    await opt(typesetToPdf('<p>x</p>', { loadFont, print: 1 as never }), 'print');
    await opt(typesetToPdf('<p>x</p>', { loadFont, pdfua: 'on' as never }), 'pdfua');
    await opt(typesetToPdf('<p>x</p>', { loadFont, name: 5 as never }), 'name');
    await opt(typesetToPdf('<p>x</p>', { loadFont, unreferencedCss: 'drop' as never }), 'unreferencedCss');
    await opt(typesetToPdf('<p>x</p>', null as never), 'options');
    await opt(typesetToPdf('<p>x</p>', { loadFont }, null as never), 'pdf');
    await opt(typeset('<p>x</p>', 'ja' as never), 'options');
    await opt(createTypesetter(null as never), 'setup');
    const ts = await createTypesetter({ loadFont });
    await opt(ts.typeset('<p>x</p>', null as never), 'options');
    // 正しい値は通る
    const ok = await typesetToPdf('<p>x</p>', { loadFont, documentLang: 'en-US', tagged: true, pdfua: { warnings: [] } });
    expect(ok.pageCount).toBe(1);
  });
});

describe('診断の場所 (source)', () => {
  it('XSL-FO: 読まなかった属性・値の表に無い値の診断にも、その要素の場所を付ける (前は場所が無かった)', async () => {
    const fo = [
      '<?xml version="1.0"?>',
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>',
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">',
      '  <fo:block>a</fo:block>',
      '  <fo:block foo-bar="1" hyphenate="yes">b</fo:block>',
      '</fo:flow></fo:page-sequence></fo:root>',
    ].join('\n');
    const r = await typesetFo(fo, { name: 'doc.fo', loadFont });
    const un = r.diagnostics.filter((d) => d.code === 'fo/unsupported');
    for (const item of ['foo-bar', 'hyphenate="yes"']) {
      const d = un.find((x) => String(x.args?.item).startsWith(item));
      expect(d, item).toBeDefined();
      expect(d!.source, item).toMatchObject({ file: 'doc.fo', line: 5, element: 'fo:block' });
    }
  });
  it('XSL-FO: 未対応の要素は、その要素の行・列・名前とファイル。組版の診断 (見つからない画像) は、その要素の場所と sourceRef', async () => {
    const fo = [
      '<?xml version="1.0"?>',
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>',
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">',
      '  <fo:block id="b1">x<fo:nonexistent>y</fo:nonexistent></fo:block>',
      '  <fo:block><fo:external-graphic src="none.png"/></fo:block>',
      '</fo:flow></fo:page-sequence></fo:root>',
    ].join('\n');
    const r = await typesetFo(fo, { name: 'doc.fo', loadFont });
    expect(r.diagnostics.find((d) => d.code === 'fo/unsupported')?.source).toEqual({ file: 'doc.fo', line: 4, column: 22, element: 'fo:nonexistent' });
    const img = r.diagnostics.find((d) => d.code === 'image/not-found');
    expect(img?.source).toMatchObject({ file: 'doc.fo', line: 5, column: 13, element: 'fo:external-graphic' });
    expect(typeof img?.source?.sourceRef).toBe('number');
  });
  it('HTML (linkedom): 要素の行・列。CSS の知らないプロパティは、CSS のファイルの行・列 (style 属性なら文書の行)', async () => {
    const html = ['<!DOCTYPE html>', '<html><head><title>t</title><link rel="stylesheet" href="a.css"></head>', '<body>', '<p>x</p>', '  <img src="none.png" id="pic">', '<p style="colr2: red">y</p>', '</body></html>'].join('\n');
    const css = 'p {\n  margin: 0;\n  colr: red;\n}\n';
    const r = await typesetHtml(html, { name: 'doc.html', loadFont, files: [{ name: 'a.css', data: css }] });
    expect(r.diagnostics.find((d) => d.args?.property === 'colr')?.source).toEqual({ file: 'a.css', line: 3, column: 3 });
    expect(r.diagnostics.find((d) => d.args?.property === 'colr2')?.source).toEqual({ file: 'doc.html', line: 6, column: 11 });
    const img = r.diagnostics.find((d) => d.code === 'image/not-found');
    expect(img?.source).toMatchObject({ file: 'doc.html', line: 5, column: 3, element: 'img#pic' });
  });
  it('CSS の項目の場所を字面で探すのは、診断に残る分 (名前ごとに 200 件) だけ。出さない名前は探さない', async () => {
    // 知らないプロパティ 1 万種 (前は、項目ごとに CSS の全体を探し、見つけた所までを行に分けていた)
    const n = 10_000;
    const css = Array.from({ length: n }, (_, k) => `p { zz${k}: 1; }`).join('\n');
    const html = `<!DOCTYPE html><html><head><title>t</title><style>\n${css}\n</style></head><body><p>x</p></body></html>`;
    // 時間でなく、文書の全体を字面で探した回数で確かめる (時間の上限では、直す前のコードでも通っていた): 場所を探すのは
    // RegExp.prototype.exec で文書の全体の字に当てる所 (locateCssItem) だけなので、その回数を数える
    const exec = RegExp.prototype.exec;
    let searches = 0;
    const spy = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, s: string) {
      if (typeof s === 'string' && s.length === html.length && s === html) searches++;
      return exec.call(this, s);
    });
    let r: Awaited<ReturnType<typeof typesetHtml>>;
    try {
      r = await typesetHtml(html, { name: 'doc.html', loadFont });
    } finally {
      spy.mockRestore();
    }
    // 診断に残る 200 件の分と、ほかの読み取りの十数回だけ (前は 1 万種のすべてで 1 万回を超えていた)
    expect(searches).toBeGreaterThan(0);
    expect(searches).toBeLessThan(MAX_DIAGNOSTICS_PER_CODE + 100);
    const ds = r.diagnostics.filter((d) => d.code === 'css/unknown-property' && !isOmittedDiagnostic(d));
    expect(ds.length).toBe(MAX_DIAGNOSTICS_PER_CODE);
    // 残った診断の場所 (行は、改行の位置の表から引く)
    expect(ds.find((x) => x.args?.property === 'zz0')!.source).toEqual({ file: 'doc.html', line: 2, column: 5 });
    expect(ds.find((x) => x.args?.property === 'zz10')!.source).toEqual({ file: 'doc.html', line: 12, column: 5 });
    const omitted = r.diagnostics.find((x) => x.code === 'css/unknown-property' && isOmittedDiagnostic(x));
    expect(omitted?.args).toEqual({ omitted: n - MAX_DIAGNOSTICS_PER_CODE, omittedKinds: n - MAX_DIAGNOSTICS_PER_CODE });
    const ignored = await typesetHtml(html, { name: 'doc.html', loadFont, diagnostics: { ignore: ['css/unknown-property'] } });
    expect(ignored.diagnostics.some((x) => x.code === 'css/unknown-property')).toBe(false);
  }, 60_000);
  it('XHTML は、読む前に字を変えるので、行・列を付けない (要素の手がかりとファイルは付ける)', async () => {
    const x = '<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>\n<img src="none.png" class="c"/></body></html>';
    const r = await typeset(x, { name: 'doc.xhtml', kind: 'xhtml', loadFont });
    const img = r.diagnostics.find((d) => d.code === 'image/not-found');
    expect(img?.source?.line).toBeUndefined();
    expect(img?.source).toMatchObject({ file: 'doc.xhtml', element: 'img.c' });
  });
  it('PDF を書く途中の診断は、描いていたページの番号 (0 から) を持つ', async () => {
    const r = await typesetHtml('<!DOCTYPE html><html><head><title>t</title></head><body><p>x</p><p style="break-before: page">y</p></body></html>', { name: 't.html', loadFont });
    expect(r.pageCount).toBe(2);
    await r.toPdf({ pdfx: { version: 'X-3', condition: 'FOGRA39' } });
    for (const d of r.diagnostics.filter((d) => d.code.startsWith('pdf/'))) expect(typeof d.source?.page).toBe('number');
  });
});

describe('出さない診断 (diagnostics.ignore)', () => {
  it('名前を指定した診断は、warnings にも diagnostics にも (Area Tree にも、PDF を書く途中にも) 入れない。知らない名前は警告して続ける', async () => {
    const html = '<!DOCTYPE html><html><head><style>p { colr: red; position: sticky }</style></head><body><p>x</p><img src="none.png"></body></html>';
    const all = await typesetHtml(html, { name: 't.html', loadFont, pdfua: true });
    expect(all.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['css/unknown-property', 'css/unsupported', 'image/not-found']));
    const r = await typesetHtml(html, { name: 't.html', loadFont, pdfua: true, diagnostics: { ignore: ['css/unknown-property', 'image/not-found', 'pdfua/missing-title', 'nope/x'] } });
    await r.toPdf();
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).not.toContain('css/unknown-property');
    expect(codes).not.toContain('image/not-found');
    expect(codes).not.toContain('pdfua/missing-title');
    expect(codes).toContain('css/unsupported');
    expect(codes).toContain('pdfua/missing-lang');
    expect(r.diagnostics.find((d) => d.code === 'api/unknown-diagnostic-code')?.args).toEqual({ code: 'nope/x' });
    expect(r.warnings.some((w) => w.includes('colr') || w.includes('none.png') || w.includes('文書の題がありません'))).toBe(false);
    expect(r.areaTree.diagnostics ?? []).toEqual([]);
    const e = await typesetHtml(html, { loadFont, diagnostics: { ignore: 'x' as never } }).catch((x) => x);
    expect(e).toBeInstanceOf(KumioriOptionError);
    expect(e.option).toBe('diagnostics.ignore');
  });
});
