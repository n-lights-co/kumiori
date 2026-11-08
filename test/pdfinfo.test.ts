import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument, PDFName } from 'pdf-lib';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf } from '../src/pdfRenderer';
import { doc, makeEngine } from './helpers';

const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const xml = `<?xml version="1.0"?><fo:root ${NS}>
  <axf:document-info name="title" value="題名"/><axf:document-info name="author" value="著者"/><axf:document-info name="keywords" value="a, b"/>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:bookmark-tree><fo:bookmark internal-destination="c1" starting-state="hide"><fo:bookmark-title>第 1 章</fo:bookmark-title><fo:bookmark internal-destination="s1"><fo:bookmark-title>1.1 節</fo:bookmark-title></fo:bookmark></fo:bookmark></fo:bookmark-tree>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block id="c1">章</fo:block><fo:block id="s1" break-before="page">節</fo:block>
    <fo:block axf:outline-level="1">見出し A</fo:block><fo:block axf:outline-level="2" axf:outline-title="小見出し">本文</fo:block>
    <fo:block axf:outline-level="1" axf:outline-group="図">図 1</fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;

describe('PDF の文書情報・しおり (I-04)', () => {
  it('axf:document-info・fo:bookmark-tree・axf:outline-level (outline-group) を取り込む', () => {
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    expect(r.document.info).toEqual({ title: '題名', author: '著者', keywords: 'a, b' });
    const bm = r.document.bookmarks!;
    expect(bm.map((b) => b.title)).toEqual(['第 1 章', '見出し A', '図']);
    expect(bm[0].open).toBe(false);
    expect(bm[0].children![0]).toMatchObject({ title: '1.1 節', ref: 's1' });
    expect(bm[1].children![0].title).toBe('小見出し');
    expect(bm[2].children![0].title).toBe('図 1');
  });

  it('PDF に文書情報とアウトラインが入り、しおりの飛び先はそのページ', async () => {
    const { fonts, engine } = await makeEngine();
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const tree = engine.layout(r.document);
    expect(tree.bookmarks![0].sheet).toBe(0);
    expect(tree.bookmarks![0].children[0].sheet).toBe(1);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    expect(pdf.getTitle()).toBe('題名');
    expect(pdf.getAuthor()).toBe('著者');
    expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  });
});

describe('リンクと注釈 (I-04)', () => {
  const linkXml = `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block>外部へ<fo:basic-link external-destination="url('https://example.com/')">リンク</fo:basic-link>、<fo:basic-link internal-destination="t">2 ページ目</fo:basic-link>へ。</fo:block>
    <fo:block>注釈<fo:inline axf:annotation-type="Text" axf:annotation-contents="中身" axf:annotation-title="題" axf:annotation-color="#008080" axf:annotation-icon-name="Key" axf:annotation-position-vertical="-20pt" axf:annotation-width="100pt" axf:annotation-height="80pt">ここ</fo:inline>と<fo:inline axf:annotation-type="Stamp" axf:annotation-icon-name="Approved" axf:annotation-width="80pt" axf:annotation-height="30pt">印</fo:inline></fo:block>
    <fo:block id="t" break-before="page">飛び先</fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;

  it('basic-link と axf:annotation-* を取り込む', () => {
    const r = importXslFo(linkXml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const json = JSON.stringify(r.document);
    expect(json).toContain('"link":{"external":"https://example.com/"}');
    expect(json).toContain('"link":{"internal":"t"}');
    expect(json).toContain('"annotation":{"kind":"text","contents":"中身","title":"題","color":"#008080","icon":"Key","dy":-20,"width":100,"height":80}');
  });

  it('PDF のページにリンク注釈・テキスト注釈 (Popup つき)・スタンプが付き、文書内リンクは飛び先のページを指す', async () => {
    const { fonts, engine } = await makeEngine();
    const r = importXslFo(linkXml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const tree = engine.layout(r.document);
    expect(tree.destinations!.t).toBe(1);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const [p1, p2] = pdf.getPages();
    const annots = p1.node.Annots()!;
    const dicts = annots.asArray().map((ref) => pdf.context.lookup(ref) as import('pdf-lib').PDFDict);
    const sub = dicts.map((d) => String(d.get(PDFName.of('Subtype'))));
    expect(sub.sort()).toEqual(['/Link', '/Link', '/Popup', '/Stamp', '/Text']);
    const internal = dicts.find((d) => d.get(PDFName.of('Dest')))!;
    const dest = internal.get(PDFName.of('Dest')) as import('pdf-lib').PDFArray;
    expect(dest.get(0)).toBe(p2.ref);
    const uri = dicts.find((d) => d.get(PDFName.of('A')))!.get(PDFName.of('A')) as import('pdf-lib').PDFDict;
    expect(String(uri.get(PDFName.of('URI')))).toContain('https://example.com/');
    const text = dicts.find((d) => String(d.get(PDFName.of('Subtype'))) === '/Text')!;
    expect(String(text.get(PDFName.of('Name')))).toBe('/Key');
    expect(p2.node.Annots()?.size() ?? 0).toBe(0);
  });
});

describe('注釈のフラグ (axf:annotation-flags → ISO 32000-2 §12.5.3 Table 167)', () => {
  it('名前を空白区切りで並べたものをビットにして F に書く。指定が無ければ F を書かない (既定値 0)', async () => {
    const xml = `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block><fo:inline axf:annotation-type="Stamp" axf:annotation-flags="Print noZoom" axf:annotation-width="80pt" axf:annotation-height="30pt">印</fo:inline><fo:inline axf:annotation-type="FreeText" axf:annotation-contents="中身" axf:annotation-width="80pt" axf:annotation-height="30pt">x</fo:inline></fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;
    const { fonts, engine } = await makeEngine();
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const dicts = pdf.getPages()[0].node.Annots()!.asArray().map((ref) => pdf.context.lookup(ref) as import('pdf-lib').PDFDict);
    const of = (t: string) => dicts.find((d) => String(d.get(PDFName.of('Subtype'))) === t)!;
    // Print は 3 番目 (4)、NoZoom は 4 番目 (8) のビット
    expect(String(of('/Stamp').get(PDFName.of('F')))).toBe('12');
    expect(of('/FreeText').get(PDFName.of('F'))).toBeUndefined();
  });
});

describe('リンクの URI の書き方 (ISO 32000-2 §7.3.4.2・§12.6.4.8)', () => {
  it('括弧と \\ を逃がし、ASCII 以外の字は UTF-8 の %xx にする (PDF の構文が壊れない)', async () => {
    const { fonts, engine } = await makeEngine();
    const xml = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>
      <fo:basic-link external-destination="url('http://example.com/a(b')">x</fo:basic-link>
      <fo:basic-link external-destination="url('https://ja.wikipedia.org/wiki/組版')">y</fo:basic-link>
      </fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const uris = pdf
      .getPages()[0]
      .node.Annots()!
      .asArray()
      .map((ref) => (pdf.context.lookup(ref) as import('pdf-lib').PDFDict).get(PDFName.of('A')) as import('pdf-lib').PDFDict)
      .map((a) => String(a.get(PDFName.of('URI'))));
    expect(uris).toEqual(['(http://example.com/a\\(b)', '(https://ja.wikipedia.org/wiki/%E7%B5%84%E7%89%88)']);
  });
});

describe('角丸と影 (axf:border-radius / axf:box-shadow, I-04)', () => {
  it('取り込み、領域に載せ、角丸の背景・影・罫線を図形として描く', async () => {
    const { paintArea } = await import('../src/paint');
    const { engine } = await makeEngine();
    const fo = `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block padding="5pt" border="solid #7777FF 4pt" background-color="#eeeeee" axf:border-radius="15pt 10pt" axf:box-shadow="6pt 6pt 0pt #777777">角丸</fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;
    const r = importXslFo(fo, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const blk = r.document.sequences[0].flow.children[0] as unknown as Record<string, unknown>;
    expect(blk.borderRadius).toEqual({ rx: 15, ry: 10 });
    expect(blk.boxShadow).toEqual({ dx: 6, dy: 6, color: '#777777' });
    const tree = engine.layout(r.document);
    const area = tree.sheets[0].page.regionBody.children[0];
    expect(area.borderRadius).toEqual({ rx: 15, ry: 10 });
    const calls: string[] = [];
    const rec = {
      fillRect: () => calls.push('fillRect'),
      drawGlyph: () => {},
      drawImage: () => {},
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine: () => calls.push('strokeLine'),
      clipRect: () => {},
      restore: () => {},
      fillPath: (_p: unknown, c: string) => calls.push(`fillPath ${c}`),
      clipPath: () => {},
      strokePath: (_p: unknown, w: number, c: string) => calls.push(`strokePath ${w} ${c}`),
    };
    paintArea(area, 0, 0, rec);
    expect(calls).toEqual(['fillPath #777777', 'fillPath #eeeeee', 'strokePath 4 #7777FF']);
  });

  it('角丸の罫線の箱でも、対角罫を描く', async () => {
    const { paintArea } = await import('../src/paint');
    const { engine } = await makeEngine();
    const fo = `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block border="solid #7777FF 2pt" axf:border-radius="5pt" axf:diagonal-border="1pt solid red">角丸</fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;
    const r = importXslFo(fo, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const area = engine.layout(r.document).sheets[0].page.regionBody.children[0];
    const calls: string[] = [];
    const rec = {
      fillRect: () => {},
      drawGlyph: () => {},
      drawImage: () => {},
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      fillPath: () => {},
      clipPath: () => {},
      strokePath: (_p: unknown, w: number, c: string) => calls.push(`strokePath ${w} ${c}`),
    };
    paintArea(area, 0, 0, rec);
    expect(calls).toEqual(['strokePath 2 #7777FF', 'strokePath 1 red']);
  });
});

describe('フォーム (axf:form-field, I-04)', () => {
  const formXml = `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <axf:form external-destination="url('https://example.com/submit')" axf:field-submit-method="get">
    <fo:block>名前 <axf:form-field axf:field-name="name" axf:field-type="text" axf:field-default-text="Your name" axf:field-maxlen="20" border="solid thin gray" width="50mm" height="6mm"/></fo:block>
    <fo:block><axf:form-field axf:field-name="sex" axf:field-type="radio" axf:field-value="M" axf:field-checked="true"/> M <axf:form-field axf:field-name="sex" axf:field-type="radio" axf:field-value="F"/> F</fo:block>
    <fo:block><axf:form-field axf:field-name="fruit" axf:field-type="combobox"><axf:form-field-option field-value="a">Apple</axf:form-field-option><axf:form-field-option field-value="o">Orange</axf:form-field-option></axf:form-field></fo:block>
    <fo:block><axf:form-field axf:field-type="button" axf:action-type="submit" axf:field-button-face="SUBMIT" width="30mm" height="6mm"/></fo:block>
    </axf:form>
  </fo:flow></fo:page-sequence></fo:root>`;

  it('取り込み: 欄の種類・名前・初期値・選択肢・送信先', () => {
    const r = importXslFo(formXml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const json = JSON.stringify(r.document);
    expect(json).toContain('"formField":{"kind":"text","name":"name","value":"Your name","maxLength":20');
    // 最初の選択項目は axf:field-top-index (既定 1) の項目
    expect(json).toContain('"options":[{"value":"a","label":"Apple","selected":true},{"value":"o","label":"Orange"}]');
    expect(json).toContain('"action":"submit","submitUrl":"https://example.com/submit","submitMethod":"get"');
    expect(r.report.unsupported).toEqual({});
  });

  it('PDF に AcroForm の欄 (テキスト・ラジオの組・コンボボックス・送信ボタン) ができる', async () => {
    const { fonts, engine } = await makeEngine();
    const r = importXslFo(formXml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const form = pdf.getForm();
    const names = form.getFields().map((f) => `${f.constructor.name}:${f.getName()}`);
    expect(names).toEqual(['PDFTextField:name', 'PDFRadioGroup:sex', 'PDFDropdown:fruit', 'PDFButton:button-1']);
    expect(form.getTextField('name').getText()).toBe('Your name');
    expect(form.getRadioGroup('sex').getSelected()).toBe('M');
    expect(form.getRadioGroup('sex').getOptions()).toEqual(['M', 'F']);
  });

  it('選択肢は [送る値, 表示] の組で、選んだ値は送る値 (ISO 32000-2 §12.7.5.4)。axf:field-top-index で最初の選択項目', async () => {
    const { fonts, engine } = await makeEngine();
    const x = formXml.replace('axf:field-type="combobox">', 'axf:field-type="combobox" axf:field-top-index="2">');
    const r = importXslFo(x, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const d = pdf.getForm().getDropdown('fruit').acroField.dict;
    expect(d.lookup(PDFName.of('Opt'))!.toString()).toBe('[ [ (a) (Apple) ] [ (o) (Orange) ] ]');
    expect(d.lookup(PDFName.of('V'))!.toString()).toBe('(o)');
    expect(d.lookup(PDFName.of('I'))!.toString()).toBe('[ 1 ]');
  });

  it('欄 (ウィジェット) には背景・罫線を描かない。ラジオのチェックは ZapfDingbats の字 (axf:field-checked-style)', async () => {
    const { fonts, engine } = await makeEngine();
    const x = formXml.replace('axf:field-value="M"', 'axf:field-value="M" axf:field-checked-style="star"');
    const r = importXslFo(x, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    expect(r.report.unsupported).toEqual({});
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const form = pdf.getForm();
    for (const f of form.getFields())
      for (const w of f.acroField.getWidgets()) {
        const mk = w.getAppearanceCharacteristics();
        expect(mk?.getBackgroundColor()).toBeUndefined();
        expect(mk?.getBorderColor()).toBeUndefined();
      }
    const [m, f] = form.getRadioGroup('sex').acroField.getWidgets();
    expect(m.getAppearanceCharacteristics()!.getCaptions().normal).toBe('H'); // ★ (a35)
    expect(f.getAppearanceCharacteristics()!.getCaptions().normal).toBe('4'); // 既定 checkmark ✔ (a20)
    const { decodePDFRawStream, PDFDict } = await import('pdf-lib');
    const n = m.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
    const on = n.lookup(m.getOnValue()!) as import('pdf-lib').PDFRawStream;
    expect(new TextDecoder().decode(decodePDFRawStream(on).decode())).toMatch(/Tf .* Td <48> Tj/);
  });

  it('axf:field-font-size: 長さはその大きさ、auto は DA の大きさ 0 (自動。ISO 32000-2 §12.7.4.3)', async () => {
    const { fonts, engine } = await makeEngine();
    const x = formXml
      .replace('axf:field-maxlen="20"', 'axf:field-maxlen="20" axf:field-font-size="9pt"')
      .replace('axf:field-type="combobox">', 'axf:field-type="combobox" axf:field-font-size="auto">');
    const r = importXslFo(x, (s) => new DOMParser().parseFromString(s, 'text/xml') as never);
    expect(r.report.unsupported).toEqual({});
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(r.document), fonts));
    const form = pdf.getForm();
    const da = (d: import('pdf-lib').PDFDict) => (d.lookup(PDFName.of('DA')) as import('pdf-lib').PDFString).decodeText();
    expect(da(form.getTextField('name').acroField.dict)).toMatch(/ 9 Tf/);
    const dd = form.getDropdown('fruit').acroField;
    expect(da(dd.dict)).toMatch(/ 0 Tf/);
    for (const w of dd.getWidgets()) if (w.dict.has(PDFName.of('DA'))) expect(da(w.dict)).toMatch(/ 0 Tf/);
  });

  it('欄は正規行内領域: 罫線・パディングは行の高さに入れず (XSL 1.1 §4.2.3)、字下げで左へずらさない', async () => {
    const { fonts, engine } = await makeEngine();
    const mk = (pad: string) => `<?xml version="1.0"?><fo:root ${NS}>
  <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">
    <fo:block font-size="10pt" line-height="12pt">AB <axf:form-field axf:field-name="t" axf:field-type="text" width="20mm" height="10mm" ${pad} border="1pt solid black"/></fo:block>
  </fo:flow></fo:page-sequence></fo:root>`;
    const lay = (pad: string) => engine.layout(importXslFo(mk(pad), (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat: 'antenna' }).document);
    const { walkAreaTree } = await import('../src/areaTree');
    const lines: number[] = [];
    walkAreaTree(lay('padding="2mm"'), (a) => {
      if (a.type === 'line') lines.push(a.height);
    });
    // 行の高さ = 欄の内容の高さ (10mm) + 半行間 × 2 (12pt − 10pt)
    expect(lines[0]).toBeCloseTo((10 * 72) / 25.4 + 2, 1);
    const rectX = async (pad: string) => {
      const pdf = await PDFDocument.load(await renderPdf(lay(pad), fonts));
      return pdf.getForm().getTextField('t').acroField.getWidgets()[0].getRectangle();
    };
    const a = await rectX('padding="2mm"');
    const b = await rectX('');
    // 欄の矩形 (罫線の内側) の左端は、パディングがあっても同じ所 (罫線の外側の端が空白の後に来る)
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.height - b.height).toBeCloseTo((4 * 72) / 25.4, 3);
  });
});

describe('PDF/X の印 (O-03)', () => {
  it('RGB → CMYK は ISO 32000-2 §10.4.2.4 の式 (黒の生成・下色の除去 = k)。逆の変換 (§10.4.2.3) で元に戻る', async () => {
    const { rgbToCmyk } = await import('../src/pdfRenderer');
    const cases: Array<[number, number, number]> = [[0.5, 0, 0], [0.2, 0.7, 0.4], [1, 1, 1], [0, 0, 0], [0.3, 0.3, 0.3]];
    expect(rgbToCmyk(0.5, 0, 0)).toEqual([0, 0.5, 0.5, 0.5]);
    expect(rgbToCmyk(0.3, 0.3, 0.3).slice(0, 3)).toEqual([0, 0, 0]);
    for (const [r, g, b] of cases) {
      const [c, m, y, k] = rgbToCmyk(r, g, b);
      expect([1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)].map((v) => +v.toFixed(9))).toEqual([r, g, b]);
    }
  });
  it('OutputIntent・GTS_PDFXVersion・Trapped・ID、PDF 1.4、透明があれば警告', async () => {
    const { fonts, engine } = await makeEngine();
    const tree = engine.layout(doc([{ type: 'block', children: ['本文'] }]));
    const warnings: string[] = [];
    const bytes = await renderPdf(tree, fonts, { pdfx: { warnings } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const pdf = await PDFDocument.load(bytes);
    const oi = pdf.catalog.lookup(PDFName.of('OutputIntents')) as import('pdf-lib').PDFArray;
    const intent = oi.lookup(0) as import('pdf-lib').PDFDict;
    expect(String(intent.get(PDFName.of('S')))).toBe('/GTS_PDFX');
    expect(String(intent.get(PDFName.of('OutputConditionIdentifier')))).toContain('JC200103');
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info) as import('pdf-lib').PDFDict;
    expect(String(info.get(PDFName.of('GTS_PDFXVersion')))).toContain('PDF/X-3:2003');
    expect(String(info.get(PDFName.of('Trapped')))).toBe('/False');
    expect(pdf.context.trailerInfo.ID).toBeDefined();
    expect(warnings).toEqual([]);
  });
});

/** 内容ストリームで描いた字の符号を、描いた順に取り出す (Tj の <…> と、TJ の配列の中の <…>) */
const shownCodes = (text: string) => [...text.matchAll(/<([0-9A-Fa-f]+)> Tj|\[([^\]]*)\] TJ/g)].flatMap((m) => (m[1] !== undefined ? [m[1]] : [...m[2].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])));

describe('PDF の字の符号化 (性能)', () => {
  it('同じ字の符号化 (字形の並べ直し) は書体ごとに 1 度だけで、字の並びは変わらない', async () => {
    const { vi } = await import('vitest');
    const { CustomFontSubsetEmbedder, PDFDocument: Doc, decodePDFRawStream } = await import('pdf-lib');
    const { fonts, engine } = await makeEngine();
    const spy = vi.spyOn(CustomFontSubsetEmbedder.prototype, 'encodeText');
    try {
      const tree = engine.layout(doc([{ type: 'block', children: ['あいあいあ'.repeat(20)] }]));
      const bytes = await renderPdf(tree, fonts);
      // 字は 100 個、違う字は 2 種類 → 符号化は 2 回
      expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['あ', 'い']);
      // 描いた字の並び (Tj の符号) は、元の文字列の並びのまま
      const pdf = await Doc.load(bytes);
      const page = pdf.getPages()[0];
      const contents = page.node.Contents()!;
      const streams = 'asArray' in contents ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
      const text = streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as import('pdf-lib').PDFRawStream).decode())).join('\n');
      const codes = shownCodes(text);
      expect(codes).toHaveLength(100);
      expect(new Set(codes).size).toBe(2);
      const code = { あ: codes[0], い: codes[1] } as Record<string, string>;
      expect(codes).toEqual([...'あいあいあ'.repeat(20)].map((c) => code[c]));
    } finally {
      spy.mockRestore();
    }
  });

  it('同じ書体・大きさ・色の字は 1 つのテキストの区切り (BT…ET) にまとめ、色が変わると分ける', async () => {
    const { PDFDocument: Doc, decodePDFRawStream } = await import('pdf-lib');
    const { fonts, engine } = await makeEngine();
    const content = async (children: unknown[]) => {
      const pdf = await Doc.load(await renderPdf(engine.layout(doc([{ type: 'block', children } as never])), fonts));
      const c = pdf.getPages()[0].node.Contents()!;
      const streams = 'asArray' in c ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
      return streams.map((x) => new TextDecoder().decode(decodePDFRawStream(x as import('pdf-lib').PDFRawStream).decode())).join('\n');
    };
    const one = await content(['あいうえお'.repeat(4)]);
    expect(one.match(/\bBT\b/g)).toHaveLength(1);
    expect(shownCodes(one)).toHaveLength(20);
    // 同じ基線に並ぶ 1 行の字は 1 つの TJ (字ごとに Tm と Tj を書かない)
    expect(one.match(/ TJ/g)).toHaveLength(1);
    expect(one.match(/ Tm$/gm)).toHaveLength(1);
    const two = await content(['あいう', { type: 'inline', color: '#ff0000', children: ['えお'] }, 'かき']);
    expect(two.match(/\bBT\b/g)).toHaveLength(3);
    expect(shownCodes(two)).toHaveLength(7);
    // 字の行列 (Tm) の数値は、指数表記にならない 1/10000 の精度
    const tm = one.match(/^(.*) Tm$/m)![1].split(' ');
    expect(tm).toHaveLength(6);
    for (const v of tm) expect(v).toMatch(/^-?\d+(\.\d{1,4})?$/);
  });

  it('同じ基線の字の間隔は TJ の字送りの調整 (1/1000 em) で表し、縦書きの正立の字は字ごとに Tm から書く', async () => {
    const { PDFDocument: Doc, decodePDFRawStream } = await import('pdf-lib');
    const { fonts, engine } = await makeEngine();
    const content = async (children: unknown[], wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') => {
      const pdf = await Doc.load(await renderPdf(engine.layout(doc([{ type: 'block', textAlign: 'start', children } as never], wm)), fonts));
      const c = pdf.getPages()[0].node.Contents()!;
      const streams = 'asArray' in c ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
      return streams.map((x) => new TextDecoder().decode(decodePDFRawStream(x as import('pdf-lib').PDFRawStream).decode())).join('\n');
    };
    // 字間 2pt (字の大きさ 10pt) → 字の間の調整は -200 (左へ戻す向きが正なので、右へ 0.2em 進める)
    const ls = await content([{ type: 'inline', letterSpacing: 2, children: ['あいう'] }]);
    const tj = ls.match(/\[([^\]]*)\] TJ/)![1];
    expect([...tj.matchAll(/<[0-9A-Fa-f]+>/g)]).toHaveLength(3);
    const adj = [...tj.replace(/<[^>]*>/g, ' ').matchAll(/(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(adj).toHaveLength(2);
    for (const a of adj) expect(a).toBeCloseTo(-200, 2);
    // 縦書きの正立の字は基線 (行) が同じでも並ぶ向きが違うので、字ごとに Tm
    const v = await content(['あいう'], 'vertical-rl');
    expect(v.match(/ Tm$/gm)).toHaveLength(3);
    expect(v.match(/ TJ/g)).toBeNull();
    expect(shownCodes(v)).toHaveLength(3);
  });

  it('deflate を渡すと、保存のときの圧縮にその関数を使う (展開した中身は同じ)', async () => {
    const { PDFDocument: Doc, decodePDFRawStream } = await import('pdf-lib');
    const { deflateSync } = await import('node:zlib');
    const { fonts, engine } = await makeEngine();
    const tree = engine.layout(doc([{ type: 'block', children: ['あいうえお'] } as never]));
    let calls = 0;
    const text = async (bytes: Uint8Array) => {
      const pdf = await Doc.load(bytes);
      const c = pdf.getPages()[0].node.Contents()!;
      const streams = 'asArray' in c ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
      return streams.map((x) => new TextDecoder().decode(decodePDFRawStream(x as import('pdf-lib').PDFRawStream).decode())).join('\n');
    };
    const a = await text(await renderPdf(tree, fonts));
    const b = await text(await renderPdf(tree, fonts, { deflate: (d) => (calls++, deflateSync(d)) }));
    expect(calls).toBeGreaterThan(0);
    expect(b).toBe(a);
  });
});

describe('PDF の書き方 (全体のレビュー)', () => {
  it('部分書体の名前は「大文字 6 字 + 書体の名前」(ISO 32000-2 §9.6.4)', async () => {
    const { fonts, engine } = await makeEngine();
    const pdf = await PDFDocument.load(await renderPdf(engine.layout(doc([{ type: 'block', children: ['組版 abc'] }] as never)), fonts));
    const names: string[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      const d = obj as unknown as { get?: (k: PDFName) => unknown };
      const t = d.get?.(PDFName.of('Type'));
      if (String(t) !== '/Font') continue;
      const bf = d.get?.(PDFName.of('BaseFont'));
      if (bf) names.push(String(bf));
    }
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^\/[A-Z]{6}\+/);
  });

  it('FreeText 注釈の表示 (AP) は、ページの資源の特色の色空間を使わない', async () => {
    const { fonts, engine } = await makeEngine();
    const xml = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>
      <fo:inline axf:annotation-type="FreeText" axf:annotation-contents="中身" axf:annotation-color="rgb-icc(255,0,0,#Separation,'DIC 156',1)" axf:annotation-width="100pt" axf:annotation-height="30pt">x</fo:inline>
      </fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = importXslFo(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { spotColors: { 'DIC 156': [0, 1, 1, 0] } });
    expect(JSON.stringify(r.document)).toContain('spot(');
    const bytes = await renderPdf(engine.layout(r.document), fonts);
    const pdf = await PDFDocument.load(bytes);
    const annot = pdf.context.lookup(pdf.getPages()[0].node.Annots()!.get(0)) as import('pdf-lib').PDFDict;
    expect(String(annot.get(PDFName.of('Subtype')))).toBe('/FreeText');
    const ap = (annot.get(PDFName.of('AP')) as import('pdf-lib').PDFDict).get(PDFName.of('N'));
    const stream = pdf.context.lookup(ap as never) as unknown as { getContentsString?: () => string; contents?: Uint8Array };
    const { inflateSync } = await import('node:zlib');
    const raw = stream.contents ? Buffer.from(stream.contents) : Buffer.alloc(0);
    let text = '';
    try {
      text = inflateSync(raw).toString('latin1');
    } catch {
      text = raw.toString('latin1');
    }
    expect(text).not.toMatch(/KmSp\d+ cs/);
  });
});

describe('PDF の書体の埋め込み', () => {
  it('OpenType の機能を使う字 (縦書きの vert など) があっても、書体は 1 回だけ埋め込む', async () => {
    const { fonts, engine } = await makeEngine();
    const tree = engine.layout(doc([{ type: 'block', children: ['横書き「あ」'] }, { type: 'block-container', writingMode: 'vertical-rl', width: 60, height: 60, children: [{ type: 'block', children: ['縦書き「い」ー'] }] }] as never));
    let featured = 0;
    const { walkAreaTree } = await import('../src/areaTree');
    walkAreaTree(tree, (a) => {
      if (a.type === 'glyph' && a.features?.length) featured++;
    });
    expect(featured).toBeGreaterThan(0);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const type0 = pdf.context.enumerateIndirectObjects().filter(([, o]) => (o as { get?: (n: PDFName) => unknown }).get?.(PDFName.of('Subtype'))?.toString() === '/Type0');
    expect(type0.length).toBe(1);
  });
});
