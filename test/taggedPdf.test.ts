/**
 * タグ付き PDF (ISO 32000-1 §14.6・§14.7・§14.8) の回帰テスト (OUT-51 の段階 1: HTML の見出し・段落・リスト・図・リンク、段階 2: 表・脚注、
 * 段階 3: XSL-FO、段階 4: PDF/UA-1):
 *  - 構造の木: 要素を標準の構造の型 (Document・H1〜H6・P・L/LI/Lbl/LBody・Div・Figure・Caption・Link・Span) に当て、入力の順に並べる
 *  - 図の代わりの文 (Alt)・言語 (Lang。カタログと、親と違う節)
 *  - 背景・罫線は Artifact (Layout)、柱 (余白の箱) は Artifact (Pagination)。alt の空の画像・aria-hidden は飾り
 *  - MCID と ParentTree・StructParents の対応、ページをまたぐ段落 (MCR)
 *  - リンクの注釈: Link の構造の節の OBJR、StructParent、Contents、ページの Tabs /S
 *  - 表: Table・Caption・THead・TBody・TFoot・TR・TH・TD、見出しのセルの Scope、RowSpan・ColSpan、Headers と ID・IDTree、空のセル、
 *    ページをまたぐ表。並べるための表 (role="presentation")・display: table の div は表の構造にしない
 *  - 脚注 (float: footnote): 本文の参照の印は Reference、本体はその後ろの Note (ID) で、頭の番号は Lbl。本体の中のリンク
 *  - XSL-FO: 要素の型 (Part・P・Div・L・Table・Link・Note・Figure)、role・axf:pdftag (RoleMap)・axf:alttext・axf:expansion-text、
 *    fo:static-content と fo:leader は飾り、言語、行の要素の無いセルの TR、柱の中のリンクと注釈 (Annot)
 *  - PDF/UA-1 (pdfua): XMP の pdfuaid:part・dc:title、DisplayDocTitle、足りないものの警告、文書の言語の指定 (documentLang)。
 *    柱の Header・Footer、ルビ (Ruby・RB・RT)・圏点 (飾り)、フォームの欄 (Form・TU)、不透明度のグループの中の MCID
 *  - タグを付けないとき (既定) は、構造の木も印も書かない。PDF/X-1a とは一緒に使えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib';
import { DEFAULT_FONTS, typesetFo, typesetHtml, typesetToPdf } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'%3E%3Crect width='40' height='20' fill='red'/%3E%3C/svg%3E";
const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 30pt; @bottom-center { content: counter(page) } } body { margin: 0; font-size: 10pt } ${css}</style></head><body>${body}</body></html>`;

async function pdfOf(body: string, css = '', tagged = true): Promise<PDFDocument> {
  const r = await typesetHtml(doc(body, css), { loadFont: loadCachedFont, ...(tagged ? { tagged: true } : {}) });
  return PDFDocument.load(await r.toPdf(), { updateMetadata: false });
}

const text = (o: PDFObject | undefined) => (o instanceof PDFHexString || o instanceof PDFString ? o.decodeText() : undefined);

interface Elem {
  role: string;
  dict: PDFDict;
  kids: Array<Elem | { mcid: number; page?: PDFRef } | { annot: PDFRef }>;
}
/** 構造の木を読む (StructTreeRoot の K から) */
function structTree(pdf: PDFDocument): Elem {
  const ctx = pdf.context;
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const read = (d: PDFDict): Elem => {
    const role = String(d.get(PDFName.of('S'))).slice(1);
    const pg = d.get(PDFName.of('Pg')) as PDFRef | undefined;
    const k = d.get(PDFName.of('K'));
    const list = k instanceof PDFArray ? k.asArray() : k ? [k] : [];
    const kids: Elem['kids'] = list.map((x) => {
      if (x instanceof PDFNumber) return { mcid: x.asNumber(), page: pg };
      const obj = x instanceof PDFRef ? ctx.lookup(x) : x;
      if (!(obj instanceof PDFDict)) throw new Error('bad K');
      const type = String(obj.get(PDFName.of('Type')));
      if (type === '/MCR') return { mcid: (obj.get(PDFName.of('MCID')) as PDFNumber).asNumber(), page: obj.get(PDFName.of('Pg')) as PDFRef };
      if (type === '/OBJR') return { annot: obj.get(PDFName.of('Obj')) as PDFRef };
      return read(obj);
    });
    return { role, dict: d, kids };
  };
  return read(root.lookup(PDFName.of('K'), PDFDict));
}
/** 型だけの木 (字の項目は省く): "Document(H1,P(Link))" */
function shape(e: Elem): string {
  const kids = e.kids.filter((k): k is Elem => 'role' in k);
  return kids.length ? `${e.role}(${kids.map(shape).join(',')})` : e.role;
}
function find(e: Elem, role: string): Elem[] {
  const out: Elem[] = [];
  const go = (x: Elem) => {
    if (x.role === role) out.push(x);
    for (const k of x.kids) if ('role' in k) go(k);
  };
  go(e);
  return out;
}
/** ページの内容の流れ (Contents。配列なら、つないだもの) */
function content(pdf: PDFDocument, k: number): string {
  const c = pdf.getPages()[k].node.get(PDFName.of('Contents'));
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return refs.map((r) => new TextDecoder('latin1').decode(decodePDFRawStream(pdf.context.lookup(r as PDFRef) as PDFRawStream).decode())).join('\n');
}
/** 印の付いた内容の並び: [型, MCID か Artifact の Type] */
function marked(s: string): Array<[string, string]> {
  return [...s.matchAll(/\/(\w+)\s*<<\s*\/(MCID|Type)\s*\/?(\w+)[^>]*>>\s*BDC/g)].map((m) => [m[1], m[3]]);
}

describe('タグ付き PDF: 構造の木', () => {
  it('見出し・段落・リンク・リスト・図・キャプション・言語の違う段落を、入力の順に並べる', async () => {
    const pdf = await pdfOf(`<h1>見出し</h1><p>段落の<a href="https://example.com/">リンク</a>です。</p><ul><li>一つ目</li><li>二つ目</li></ul><figure><img src="${SVG}" alt="赤い四角"><figcaption>図 1</figcaption></figure><p lang="en">English.</p>`);
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(H1,P(Link),L(LI(Lbl,LBody),LI(Lbl,LBody)),Div(Figure,Caption),P)');
    expect(find(tree, 'Figure').map((f) => text(f.dict.get(PDFName.of('Alt'))))).toEqual(['赤い四角']);
    // 言語: カタログは文書の言語、親と違う段落だけに Lang
    expect(text(pdf.catalog.get(PDFName.of('Lang')))).toBe('ja');
    expect(find(tree, 'P').map((p) => text(p.dict.get(PDFName.of('Lang'))))).toEqual([undefined, 'en']);
    expect(pdf.catalog.lookup(PDFName.of('MarkInfo'), PDFDict).get(PDFName.of('Marked'))?.toString()).toBe('true');
  });

  it('ARIA の役: role="heading" と aria-level は見出し、alt の空の画像と aria-hidden の中身は飾り (構造の木に入れない)', async () => {
    const pdf = await pdfOf(`<div role="heading" aria-level="3">見出し</div><p>本文</p><img src="${SVG}" alt=""><p aria-hidden="true">隠す</p>`);
    expect(shape(structTree(pdf))).toBe('Document(H3,P)');
    const c = content(pdf, 0);
    // 飾りの画像と隠した段落の字は、Artifact で包む
    expect(marked(c).filter(([t]) => t === 'Artifact').length).toBeGreaterThanOrEqual(2);
  });

  it('aria-hidden の中のルビは、親文字もルビも飾り (構造の木に入らない MCID を付けない)', async () => {
    const pdf = await pdfOf('<p>本文</p><p aria-hidden="true">隠す<ruby>漢<rt>かん</rt></ruby></p>');
    expect(shape(structTree(pdf))).toBe('Document(P)');
    expect(marked(content(pdf, 0)).filter(([t]) => t !== 'Artifact').map(([t]) => t)).toEqual(['P']);
  });

  it('後で描く子 (絶対配置の段落) があっても、後ろの兄弟とじかの字を、その子の後ろへ回さない (文書の順)', async () => {
    const pdf = await pdfOf('<table><tr><td>セルの字<p style="position: absolute; top: 200pt">絶対</p><p>段落</p>続き</td></tr></table>');
    const td = find(structTree(pdf), 'TD')[0];
    // じかの字 (MCID)・P (絶対)・P (段落)・じかの字 (前は、じかの字が 2 つ並んでから、P が 2 つ並んだ)
    expect(td.kids.map((k) => ('role' in k ? k.role : 'mcid' in k ? 'MC' : 'annot'))).toEqual(['MC', 'P', 'P', 'MC']);
  });

  it('絶対配置の要素・段抜きの見出し・直交する縦書きの箱も、要素の構造の型と入力の順を保つ', async () => {
    const pdf = await pdfOf('<p>前</p><h2 style="position: absolute; top: 90pt">絶対</h2><div style="columns: 2"><p>段</p><h2 style="column-span: all">段抜き</h2><p>段</p></div><p style="writing-mode: vertical-rl; height: 60pt">縦</p><p>後</p>');
    expect(shape(structTree(pdf))).toBe('Document(P,H2,Div(P,H2,P),P,P)');
  });

  it('画像として組む object (SVG) は Figure。代わりの文は aria-label、無ければ title。中の代わりの内容は使わない。画像が無ければ代わりの内容を親の構造に入れる', async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='red'/></svg>";
    const body =
      '<p><object data="s.svg" type="image/svg+xml" aria-label="赤い四角" title="題">図1</object></p>' +
      '<p><object data="s.svg" type="image/svg+xml" title="題の四角">図2</object></p>' +
      '<p><object data="s.svg" type="image/svg+xml">図3</object></p>' +
      '<p><object data="s.svg" type="image/svg+xml" role="presentation">図4</object></p>' +
      '<p><object data="nai.svg" type="image/svg+xml">図5</object></p>';
    const warnings: string[] = [];
    const r = await typesetHtml(doc(body), { loadFont: loadCachedFont, pdfua: { warnings }, files: [{ name: 's.svg', data: new TextEncoder().encode(svg) }] });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const tree = structTree(pdf);
    // role="presentation" の画像は飾り (中身が飾りだけの段落は、構造に入れない)。最後の P は、画像が無いので代わりの内容を組んだ段落
    expect(shape(tree)).toBe('Document(P(Figure),P(Figure),P(Figure),P)');
    expect(find(tree, 'Figure').map((f) => text(f.dict.get(PDFName.of('Alt'))))).toEqual(['赤い四角', '題の四角', undefined]);
    // 代わりの文の無い図 (3 つ目) は、img と同じく警告に出す
    expect(warnings.join('\n')).toMatch(/図が 1 個|1 figure/);
  });

  it('記号の無いリスト (list-style: none) の項目も、LI の中の LBody にする', async () => {
    const pdf = await pdfOf('<ul style="list-style: none"><li>一つ目</li><li>二つ目</li></ul>');
    expect(shape(structTree(pdf))).toBe('Document(L(LI(LBody),LI(LBody)))');
  });
});

describe('タグ付き PDF: 印の付いた内容と ParentTree', () => {
  it('背景・罫線は Layout、柱 (余白の箱) は Pagination の Artifact。字は構造の型の MCID', async () => {
    const pdf = await pdfOf('<p style="background: #eee; border: 1pt solid #000">背景と罫線</p>');
    const m = marked(content(pdf, 0));
    expect(m).toContainEqual(['Artifact', 'Layout']);
    expect(m).toContainEqual(['Artifact', 'Pagination']);
    expect(m).toContainEqual(['P', '0']);
    // BDC と EMC の数が合う (印の付いた内容は閉じている)。ActualText の Span も数える
    const c = content(pdf, 0);
    expect((c.match(/\bBDC\b/g) ?? []).length).toBe((c.match(/\bEMC\b/g) ?? []).length);
  });

  it('ページの MCID と ParentTree の並びが合い、ページの StructParents が ParentTree の鍵を指す', async () => {
    const pdf = await pdfOf('<h1>題</h1><p>一つ目の段落</p><p>二つ目の段落</p>');
    const page = pdf.getPages()[0].node;
    const key = (page.get(PDFName.of('StructParents')) as PDFNumber).asNumber();
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const nums = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray).asArray();
    const at = nums.findIndex((x, k) => k % 2 === 0 && (x as PDFNumber).asNumber() === key);
    const parents = pdf.context.lookup(nums[at + 1], PDFArray).asArray().map((r) => String(pdf.context.lookup(r, PDFDict).get(PDFName.of('S'))));
    const mcids = marked(content(pdf, 0)).filter(([t]) => t !== 'Artifact' && t !== 'Span');
    expect(mcids.map(([, n]) => Number(n))).toEqual(mcids.map((_, k) => k));
    expect(parents).toEqual(mcids.map(([t]) => `/${t}`));
  });

  it('ページをまたぐ段落は、1 つの P に、両方のページの MCID を持つ (2 ページ目は MCR)', async () => {
    const long = '長い段落の字。'.repeat(220);
    const pdf = await pdfOf(`<p>${long}</p>`);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const ps = find(structTree(pdf), 'P');
    expect(ps.length).toBe(1);
    const pages = new Set(ps[0].kids.map((k) => ('mcid' in k ? String(k.page) : '')));
    expect(pages.size).toBeGreaterThan(1);
  });

  it('2 ページ目から繰り返した表の見出しは Pagination の Artifact (最初の見出しは中身)', async () => {
    const rows = Array.from({ length: 60 }, (_, k) => `<tr><td>行${k}</td></tr>`).join('');
    const r = await typesetHtml(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 30pt } body { margin: 0; font-size: 10pt }</style></head><body><table><thead><tr><th>見出し</th></tr></thead><tbody>${rows}</tbody></table></body></html>`, { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    // どのページにもノンブル (既定のスタイルの下の中央) の Pagination がある。2 ページ目は、それに繰り返した見出しの分が足される
    const pagination = (k: number) => marked(content(pdf, k)).filter(([t, v]) => t === 'Artifact' && v === 'Pagination').length;
    expect(pagination(1)).toBeGreaterThan(pagination(0));
    // 最初の見出しの字は中身 (構造の木の見出しのセル)
    expect(JSON.stringify(marked(content(pdf, 0)))).toMatch(/"TH"/);
  });

  it('不透明度のグループ (Form XObject) の中の内容にも MCID を付け、構造の木から MCR の Stm で Form を指す (Form に StructParents)', async () => {
    const pdf = await pdfOf('<div style="opacity: 0.5"><h2>半透明の見出し</h2><p>半透明の段落</p></div><p>後の段落</p>');
    const tree = structTree(pdf);
    // グループの中の見出しと段落も、それぞれの構造の節になる (前は、グループ全体が外の箱の構造に入っていた)
    expect(shape(tree)).toBe('Document(Div(H2,P),P)');
    const h2 = find(tree, 'H2')[0];
    const mcr = (h2.dict.get(PDFName.of('K')) as PDFArray | PDFDict);
    const first = mcr instanceof PDFArray ? pdf.context.lookup(mcr.get(0)) : mcr;
    expect(first).toBeInstanceOf(PDFDict);
    const stm = (first as PDFDict).get(PDFName.of('Stm'));
    expect(stm).toBeInstanceOf(PDFRef);
    const form = pdf.context.lookup(stm as PDFRef) as PDFRawStream;
    expect(form.dict.get(PDFName.of('StructParents'))).toBeInstanceOf(PDFNumber);
    const body = new TextDecoder('latin1').decode(decodePDFRawStream(form).decode());
    expect(body).toMatch(/\/H2\s*<<\s*\/MCID\s+0\s*>>\s*BDC/);
    // ページの内容の流れの Do は、印で包まない
    expect(content(pdf, 0)).not.toMatch(/BDC\s+q\b[^]*?\/KmG\S*\s+Do\s+Q\s+EMC/);
  });
});

describe('タグ付き PDF: リンク', () => {
  it('リンクの注釈は Link の構造の節の OBJR で、StructParent・Contents (リンクの字) を持ち、ページの Tabs は S', async () => {
    const pdf = await pdfOf('<p>前の字<a href="https://example.com/">例のサイト</a>後の字</p>');
    const links = find(structTree(pdf), 'Link');
    expect(links.length).toBe(1);
    const objr = links[0].kids.find((k): k is { annot: PDFRef } => 'annot' in k);
    expect(objr).toBeDefined();
    const annot = pdf.context.lookup(objr!.annot, PDFDict);
    expect(text(annot.get(PDFName.of('Contents')))).toBe('例のサイト');
    expect(annot.get(PDFName.of('StructParent'))).toBeInstanceOf(PDFNumber);
    // リンクの字も、同じ Link の MCID
    expect(links[0].kids.some((k) => 'mcid' in k)).toBe(true);
    expect(String(pdf.getPages()[0].node.get(PDFName.of('Tabs')))).toBe('/S');
  });

  it('aria-label があれば、注釈の Contents にする', async () => {
    const pdf = await pdfOf('<p><a href="https://example.com/" aria-label="例のサイトへ">こちら</a></p>');
    const link = find(structTree(pdf), 'Link')[0];
    const objr = link.kids.find((k): k is { annot: PDFRef } => 'annot' in k)!;
    expect(text(pdf.context.lookup(objr.annot, PDFDict).get(PDFName.of('Contents')))).toBe('例のサイトへ');
  });
});

/** 構造の節の属性 (A の辞書) の値 */
function attr(e: Elem, key: string): string | undefined {
  const a = e.dict.get(PDFName.of('A'));
  const d = a instanceof PDFRef ? (e.dict.context.lookup(a) as PDFDict) : (a as PDFDict | undefined);
  const v = d?.get(PDFName.of(key));
  if (v === undefined) return undefined;
  if (v instanceof PDFArray) return v.asArray().map((x) => text(x) ?? String(x)).join(' ');
  return text(v) ?? String(v);
}
/** 構造の節の ID */
const idOf = (e: Elem) => text(e.dict.get(PDFName.of('ID')));
/** 中身の項目と子の並び (型の名前か、'mcid') */
const kidKinds = (e: Elem) => e.kids.map((k) => ('role' in k ? k.role : 'mcid' in k ? 'mcid' : 'annot'));

describe('タグ付き PDF: 表', () => {
  it('表の要素を Table・Caption・THead・TBody・TR・TH・TD にし、見出しのセルに向き (Scope) を書く', async () => {
    const pdf = await pdfOf('<table><caption>表の題</caption><thead><tr><th>名前</th><th>値</th></tr></thead><tbody><tr><th>行</th><td>1</td></tr></tbody></table>');
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Table(Caption,THead(TR(TH,TH)),TBody(TR(TH,TD))))');
    expect(find(tree, 'TH').map((h) => attr(h, 'Scope'))).toEqual(['/Column', '/Column', '/Row']);
    expect(attr(find(tree, 'TH')[0], 'O')).toBe('/Table');
  });

  it('scope 属性・ARIA の役の向き、結合したセルの RowSpan・ColSpan。中身の無いセルも書く (行と列の並びをずらさない)', async () => {
    const pdf = await pdfOf('<table><tr><th scope="col">a</th><th scope="row">b</th><th role="columnheader">c</th></tr><tr><td rowspan="2">結合</td><td colspan="2">横</td></tr><tr><td></td><td>x</td></tr></table>');
    const tree = structTree(pdf);
    expect(find(tree, 'TH').map((h) => attr(h, 'Scope'))).toEqual(['/Column', '/Row', '/Column']);
    const tds = find(tree, 'TD');
    expect(tds.length).toBe(4);
    expect(attr(tds[0], 'RowSpan')).toBe('2');
    expect(attr(tds[1], 'ColSpan')).toBe('2');
    expect(tds[2].kids.length).toBe(0);
    expect(shape(tree)).toBe('Document(Table(TR(TH,TH,TH),TR(TD,TD),TR(TD,TD)))');
  });

  it('headers 属性は Headers (見出しのセルの ID の並び) にし、指された見出しのセルに ID を付けて IDTree に入れる', async () => {
    const pdf = await pdfOf('<table><tr><th id="h1">一</th><th id="h2">二</th></tr><tr><td headers="h1 h2">値</td><td headers="nai">無い id</td></tr></table>');
    const tree = structTree(pdf);
    const [th1, th2] = find(tree, 'TH');
    expect([idOf(th1), idOf(th2)]).toEqual(['h1', 'h2']);
    const [td1, td2] = find(tree, 'TD');
    expect(attr(td1, 'Headers')).toBe('h1 h2');
    expect(attr(td2, 'Headers')).toBeUndefined();
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const names = root.lookup(PDFName.of('IDTree'), PDFDict).lookup(PDFName.of('Names'), PDFArray).asArray();
    expect(names.filter((_, k) => k % 2 === 0).map((x) => text(x))).toEqual(['h1', 'h2']);
    expect(pdf.context.lookup(names[1])).toBe(th1.dict);
  });

  it('見出し (thead) のある表の、tbody に入っていない行は TBody に入れる', async () => {
    const pdf = await pdfOf('<table><thead><tr><th>見出し</th></tr></thead><tr><td>一</td></tr><tr><td>二</td></tr></table>');
    expect(shape(structTree(pdf))).toBe('Document(Table(THead(TR(TH)),TBody(TR(TD),TR(TD))))');
  });

  it('並べるための表 (role="presentation") と、display: table・grid で並べた div は、表の構造にしない', async () => {
    const pdf = await pdfOf('<table role="presentation"><tr><td><p>左</p></td><td><p>右</p></td></tr></table><div style="display: table"><div style="display: table-cell">セル</div></div><div style="display: grid; grid-template-columns: 1fr 1fr"><div>甲</div><div>乙</div></div>');
    const tree = structTree(pdf);
    expect(find(tree, 'Table').length).toBe(0);
    expect(find(tree, 'TD').length).toBe(0);
    expect(shape(tree)).toBe('Document(P,P,Div(Div),Div(Div,Div))');
  });

  it('ページをまたぐ表は 1 つの Table で、行を両方のページから指す。罫線を重ねる表 (collapse) でも同じ', async () => {
    const rows = Array.from({ length: 60 }, (_, k) => `<tr><td>行${k}</td><td>${k}</td></tr>`).join('');
    for (const css of ['', 'table { border-collapse: collapse } td { border: 1pt solid #000 }']) {
      const pdf = await pdfOf(`<table><thead><tr><th>名前</th><th>値</th></tr></thead><tbody>${rows}</tbody></table>`, css);
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      const tree = structTree(pdf);
      expect(find(tree, 'Table').length).toBe(1);
      expect(find(tree, 'TR').length).toBe(61);
      // 繰り返した見出しは構造に入れない (TH は最初の見出しの 2 つだけ)
      expect(find(tree, 'TH').length).toBe(2);
      const pages = new Set(find(tree, 'TD').flatMap((td) => td.kids.filter((k) => 'mcid' in k).map((k) => String((k as { page?: PDFRef }).page))));
      expect(pages.size).toBeGreaterThan(1);
    }
  });
});

describe('タグ付き PDF: 脚注', () => {
  const css = '.fn { float: footnote }';
  it('本文の参照の印は Reference、本体はその直後の Note (ID を持つ) で、頭の番号は Note の中の Lbl。読む順は参照の所', async () => {
    const pdf = await pdfOf('<p>前の字<span class="fn">脚注の本文。</span>後の字</p><p>次の段落</p>', css);
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(P(Reference,Note(Lbl)),P)');
    const p = find(tree, 'P')[0];
    // 段落の中: 前の字 → 参照の印 → 注 → 後の字
    expect(kidKinds(p)).toEqual(['mcid', 'Reference', 'Note', 'mcid']);
    const note = find(tree, 'Note')[0];
    expect(idOf(note)).toMatch(/^note-/);
    expect(kidKinds(note)).toEqual(['Lbl', 'mcid']);
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const names = root.lookup(PDFName.of('IDTree'), PDFDict).lookup(PDFName.of('Names'), PDFArray).asArray();
    expect(text(names[0])).toBe(idOf(note));
  });

  it('要素の id は Note の ID になる。本体の中のリンクは Note の中の Link で、注釈に Contents を付ける', async () => {
    const pdf = await pdfOf('<p>本文<span class="fn" id="fn-a">詳しくは<a href="https://example.com/">例のサイト</a>へ。</span>の続き</p>', css);
    const tree = structTree(pdf);
    const note = find(tree, 'Note')[0];
    expect(idOf(note)).toBe('fn-a');
    const link = find(note, 'Link')[0];
    expect(link).toBeDefined();
    const objr = link.kids.find((k): k is { annot: PDFRef } => 'annot' in k)!;
    expect(text(pdf.context.lookup(objr.annot, PDFDict).get(PDFName.of('Contents')))).toBe('例のサイト');
  });

  it('DPUB-ARIA の doc-footnote は Note、doc-noteref は Reference (リンクの注釈は、その中の Link)', async () => {
    const pdf = await pdfOf('<p>本文<a role="doc-noteref" href="#n1">1</a></p><aside role="doc-footnote" id="n1"><p>注の本文</p></aside>');
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(P(Reference(Link)),Note(P))');
    expect(idOf(find(tree, 'Note')[0])).toBe('n1');
  });

  it('脚注の区切りの線は飾り (Artifact)', async () => {
    const pdf = await pdfOf('<p>本文<span class="fn">脚注</span></p>', `${css} @page { @footnote { border-top: 1pt solid #000 } }`);
    const c = content(pdf, 0);
    // 線 (S か re f) を描く所は、どれも Artifact の中
    const parts = c.split(/(\/\w+\s*<<[^>]*>>\s*BDC|\bEMC\b)/);
    let open = '';
    let lines = 0;
    for (const part of parts) {
      const m = /^\/(\w+)/.exec(part);
      if (m && /BDC$/.test(part)) open = m[1];
      else if (part === 'EMC') open = '';
      else if (/\b(re|l)\b[^]*?\b(S|f)\b/.test(part)) {
        lines++;
        expect(open, part.slice(0, 80)).toBe('Artifact');
      }
    }
    expect(lines).toBeGreaterThan(0);
  });
});

const FO_HEAD = '<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
/** XSL-FO の文書 (body は fo:flow の中身、statics は fo:static-content の並び) を組んだ PDF */
async function foPdfOf(body: string, opts: { rootAttrs?: string; seqAttrs?: string; statics?: string } = {}): Promise<PDFDocument> {
  const fo = `${FO_HEAD} ${opts.rootAttrs ?? 'xml:lang="ja"'}><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200mm" page-height="150mm" margin="10mm"><fo:region-body margin-top="10mm" margin-bottom="10mm"/><fo:region-before extent="8mm"/><fo:region-after extent="8mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p" ${opts.seqAttrs ?? ''}>${opts.statics ?? ''}<fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
  const r = await typesetFo(fo, { loadFont: loadCachedFont, tagged: true });
  return PDFDocument.load(await r.toPdf(), { updateMetadata: false });
}
const FO_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'%3E%3Crect width='40' height='20' fill='red'/%3E%3C/svg%3E";

describe('タグ付き PDF: XSL-FO', () => {
  it('要素を構造の型にする: page-sequence は Part、行のある block は P、ブロックだけの block は Div、リスト・リンク・図 (axf:alttext)', async () => {
    const pdf = await foPdfOf(
      `<fo:block>本文の<fo:basic-link external-destination="url(https://example.com/)">リンク</fo:basic-link></fo:block><fo:block><fo:block>中の段落</fo:block></fo:block>` +
        `<fo:block><fo:external-graphic src="${FO_SVG}" axf:alttext="赤い四角"/></fo:block>` +
        '<fo:list-block><fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block>・</fo:block></fo:list-item-label><fo:list-item-body start-indent="body-start()"><fo:block>項目</fo:block></fo:list-item-body></fo:list-item></fo:list-block>',
    );
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(P(Link),Div(P),P(Figure),L(LI(Lbl(P),LBody(P)))))');
    expect(text(find(tree, 'Figure')[0].dict.get(PDFName.of('Alt')))).toBe('赤い四角');
    expect(text(pdf.catalog.get(PDFName.of('Lang')))).toBe('ja');
  });

  it('role の標準の型の名前は、その型。ほかの名前と axf:pdftag は独自の型で RoleMap に写す。axf:pdftag="Artifact" は飾り、空は構造を作らない', async () => {
    const pdf = await foPdfOf('<fo:block role="H1">見出し</fo:block><fo:block role="MyPara">独自</fo:block><fo:block axf:pdftag="Title">題</fo:block><fo:block axf:pdftag="Artifact">飾り</fo:block><fo:block-container axf:pdftag="\'\'"><fo:block>中</fo:block></fo:block-container>');
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(H1,MyPara,Title,P))');
    const roleMap = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('RoleMap'), PDFDict);
    expect(String(roleMap.get(PDFName.of('MyPara')))).toBe('/P');
    expect(String(roleMap.get(PDFName.of('Title')))).toBe('/P');
  });

  it('言語の違う inline は Span (Lang)、axf:expansion-text は E。文書の言語は、fo:root に無ければ最初の page-sequence の言語', async () => {
    const pdf = await foPdfOf('<fo:block>前<fo:inline xml:lang="en">English</fo:inline>と<fo:inline axf:expansion-text="Doctor">Dr.</fo:inline>と<fo:inline>透明</fo:inline></fo:block>', { rootAttrs: '', seqAttrs: 'language="ja" country="JP"' });
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(P(Span,Span)))');
    const [en, dr] = find(tree, 'Span');
    expect(text(en.dict.get(PDFName.of('Lang')))).toBe('en');
    expect(text(dr.dict.get(PDFName.of('E')))).toBe('Doctor');
    expect(text(pdf.catalog.get(PDFName.of('Lang')))).toBe('ja-JP');
  });

  it('表: table-and-caption は Div、table-caption は Caption、table-header のセルは TH (Scope Column)、またぐ数。行の要素の無いセルは TR に入れる', async () => {
    const pdf = await foPdfOf(
      '<fo:table-and-caption><fo:table-caption><fo:block>表の題</fo:block></fo:table-caption><fo:table><fo:table-header><fo:table-row><fo:table-cell number-columns-spanned="2"><fo:block>見出し</fo:block></fo:table-cell></fo:table-row></fo:table-header>' +
        '<fo:table-body><fo:table-cell starts-row="true"><fo:block>a</fo:block></fo:table-cell><fo:table-cell ends-row="true"><fo:block>b</fo:block></fo:table-cell><fo:table-cell starts-row="true"><fo:block>c</fo:block></fo:table-cell><fo:table-cell ends-row="true"><fo:block>d</fo:block></fo:table-cell></fo:table-body></fo:table></fo:table-and-caption>',
    );
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(Div(Caption(P),Table(THead(TR(TH(P))),TBody(TR(TD(P),TD(P)),TR(TD(P),TD(P)))))))');
    const th = find(tree, 'TH')[0];
    expect(attr(th, 'Scope')).toBe('/Column');
    expect(attr(th, 'ColSpan')).toBe('2');
  });

  it('脚注: 参照の印は Reference、fo:footnote-body は、その直後の Note (ID)', async () => {
    const pdf = await foPdfOf('<fo:block>本文<fo:footnote><fo:inline baseline-shift="super">1</fo:inline><fo:footnote-body id="fn1"><fo:block>1 脚注</fo:block></fo:footnote-body></fo:footnote>の続き</fo:block>');
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(P(Reference,Note(P))))');
    expect(kidKinds(find(tree, 'P')[0])).toEqual(['mcid', 'Reference', 'Note', 'mcid']);
    expect(idOf(find(tree, 'Note')[0])).toBe('fn1');
  });

  it('fo:static-content は Pagination の飾り、fo:leader は飾り (字を構造に入れない)。柱の中のリンクの注釈は Link に入れ、飛び先を Contents にする', async () => {
    const pdf = await foPdfOf('<fo:block>目次<fo:leader leader-pattern="dots"/>12</fo:block>', {
      statics: '<fo:static-content flow-name="xsl-region-before"><fo:block><fo:basic-link external-destination="url(https://example.com/)">柱のリンク</fo:basic-link></fo:block></fo:static-content>',
    });
    const tree = structTree(pdf);
    expect(shape(tree)).toBe('Document(Part(P),Link)');
    const m = marked(content(pdf, 0));
    expect(m).toContainEqual(['Artifact', 'Pagination']);
    // 段落の字は 2 つの MCID (リーダーの前後)。リーダーの点は飾り
    expect(find(tree, 'P')[0].kids.filter((k) => 'mcid' in k).length).toBe(2);
    const link = find(tree, 'Link')[0];
    const objr = link.kids.find((k): k is { annot: PDFRef } => 'annot' in k)!;
    expect(text(pdf.context.lookup(objr.annot, PDFDict).get(PDFName.of('Contents')))).toBe('https://example.com/');
  });

  it('リンクでない注釈 (axf:annotation-type) は Annot の構造の節に入れる (ポップアップも)', async () => {
    const pdf = await foPdfOf('<fo:block>注釈<fo:inline axf:annotation-type="Text" axf:annotation-contents="中身" axf:annotation-title="題">ここ</fo:inline></fo:block>');
    const annots = find(structTree(pdf), 'Annot');
    expect(annots.length).toBeGreaterThanOrEqual(1);
    for (const a of annots) {
      const objr = a.kids.find((k): k is { annot: PDFRef } => 'annot' in k)!;
      expect(pdf.context.lookup(objr.annot, PDFDict).get(PDFName.of('StructParent'))).toBeInstanceOf(PDFNumber);
    }
  });
});

describe('タグ付き PDF: 表の行のセルの数', () => {
  it('セルの足りない行の終わりに、中身の無い TD を足して、行ごとの列の数をそろえる (前の行からまたぐセルを数える)', async () => {
    const pdf = await pdfOf('<table><tr><td rowspan="2">a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr><tr><td>e</td></tr></table>');
    const trs = find(structTree(pdf), 'TR');
    expect(trs.map((tr) => tr.kids.filter((k) => 'role' in k).length)).toEqual([3, 2, 3]);
  });

  it('行と列をまたぐセルの覆う列は、次の行で飛ばして数える', async () => {
    const pdf = await pdfOf('<table><tr><td rowspan="2" colspan="2">a</td><td>b</td></tr><tr><td>c</td></tr><tr><td>d</td></tr></table>');
    const trs = find(structTree(pdf), 'TR');
    expect(trs.map((tr) => tr.kids.filter((k) => 'role' in k).length)).toEqual([2, 1, 3]);
  });

  it('足す空のセルの合計は、文書のセルの数か 1 万の大きい方まで。超える表は、行ごとに列をまたぐ空のセルを 1 つ足し、診断に出す', async () => {
    // 1 行目に列を 1000 またぐセル、ほかの行は 1 つのセル: 空のセルが 20 × 999 個要る (予算の 1 万を超える)
    const big = `<table><tr><td colspan="1000">a</td></tr>${'<tr><td>b</td></tr>'.repeat(20)}</table>`;
    // 予算の内の表 (空のセル 9 × 3 個) は、前の表が予算を使わないので、そろえる
    const small = `<table><tr><td colspan="4">x</td></tr>${'<tr><td>y</td></tr>'.repeat(9)}</table>`;
    const r = await typesetHtml(doc(big + small), { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const tables = find(structTree(pdf), 'Table');
    const cells = (t: Elem) => find(t, 'TR').map((tr) => tr.kids.filter((k) => 'role' in k).length);
    expect(cells(tables[0])).toEqual([1, ...Array(20).fill(2)]);
    const pads = find(tables[0], 'TD').filter((td) => td.kids.length === 0);
    expect(pads.length).toBe(20);
    expect(pads.every((td) => attr(td, 'ColSpan') === '999')).toBe(true);
    expect(cells(tables[1])).toEqual(Array(10).fill(1).map((_, k) => (k ? 4 : 1)));
    const d = r.diagnostics.find((x) => x.code === 'limit/table-structure-cells');
    expect(d?.args).toEqual({ tables: 1 });
    expect(d?.severity).toBe('warning');
  });
});

describe('タグ付き PDF: 長いリンクの注釈の説明', () => {
  it('行をまたぐ長いリンクの注釈の Contents は、2000 字で切る。切ったら診断に出す', async () => {
    const words = Array.from({ length: 700 }, (_, k) => `w${k}`).join(' ');
    const r = await typesetHtml(doc(`<p><a href="https://example.com/">${words}</a></p>`), { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const link = find(structTree(pdf), 'Link')[0];
    const annots = link.kids.filter((k): k is { annot: PDFRef } => 'annot' in k);
    expect(annots.length).toBeGreaterThan(10);
    const contents = annots.map((a) => text(pdf.context.lookup(a.annot, PDFDict).get(PDFName.of('Contents'))));
    // 説明は、その注釈を書いた所までに描いたリンクの字 (切った後は、どの注釈も同じ 2000 字)
    expect(Math.max(...contents.map((c) => c!.length))).toBe(2000);
    expect(contents.at(-1)!.startsWith('w0 w1 w2')).toBe(true);
    expect(new Set(contents.filter((c) => c!.length === 2000)).size).toBe(1);
    expect(r.diagnostics.find((x) => x.code === 'limit/link-description')?.args).toEqual({ links: 1 });
  });

  it('空白の多いリンクは、空白をまとめた後の長さで切る (上限に届かなければ、後ろの字も説明に入れ、診断も出さない)', async () => {
    const r = await typesetHtml(doc(`<pre><a href="https://example.com/">a${' '.repeat(5000)}END</a></pre>`), { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const link = find(structTree(pdf), 'Link')[0];
    const annots = link.kids.filter((k): k is { annot: PDFRef } => 'annot' in k);
    const last = text(pdf.context.lookup(annots.at(-1)!.annot, PDFDict).get(PDFName.of('Contents')));
    expect(last).toBe('a END');
    expect(r.diagnostics.some((x) => x.code === 'limit/link-description')).toBe(false);
    // 空白をまとめても上限を超えれば、切って診断に出す
    const words = Array.from({ length: 700 }, (_, k) => `w${k}`).join('   ');
    const r2 = await typesetHtml(doc(`<pre style="white-space: pre-wrap"><a href="https://example.com/">${words}</a></pre>`), { loadFont: loadCachedFont, tagged: true });
    await r2.toPdf();
    expect(r2.diagnostics.find((x) => x.code === 'limit/link-description')?.args).toEqual({ links: 1 });
  });

  it('行をまたぐリンクの注釈は、同じ飛び先の 1 つの動作 (間接の物) を指す (URL の全文を注釈ごとに書かない)', async () => {
    const url = `https://example.com/${'x'.repeat(3000)}`;
    const words = Array.from({ length: 300 }, (_, k) => `w${k}`).join(' ');
    for (const tagged of [true, false]) {
      const r = await typesetHtml(doc(`<p><a href="${url}">${words}</a> <a href="https://example.org/">別</a></p>`), { loadFont: loadCachedFont, tagged });
      const bytes = await r.toPdf();
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const links = pdf.getPages().flatMap((pg) => (pg.node.Annots()?.asArray() ?? []).map((a) => pdf.context.lookup(a, PDFDict))).filter((d) => String(d.get(PDFName.of('Subtype'))) === '/Link');
      expect(links.length).toBeGreaterThan(5);
      const refs = links.map((d) => d.get(PDFName.of('A')));
      expect(refs.every((a) => a instanceof PDFRef)).toBe(true);
      const uris = new Set(refs.map((a) => (pdf.context.lookup(a as PDFRef, PDFDict).get(PDFName.of('URI')) as PDFString).decodeText()));
      expect([...uris].sort()).toEqual([url, 'https://example.org/'].sort());
      expect(new Set(refs.map(String)).size).toBe(2);
    }
  });

  it('短いリンクは切らず、診断も出さない', async () => {
    const r = await typesetHtml(doc('<p><a href="https://example.com/">例のサイト</a></p>'), { loadFont: loadCachedFont, tagged: true });
    await r.toPdf();
    expect(r.diagnostics.some((x) => x.code === 'limit/link-description')).toBe(false);
  });
});

describe('タグ付き PDF: PDF/UA-1 (pdfua)', () => {
  const metadata = (pdf: PDFDocument) => new TextDecoder().decode(decodePDFRawStream(pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream).decode());
  it('XMP に pdfuaid:part と dc:title を書き、DisplayDocTitle を true にする。タグ付き PDF を含む', async () => {
    const warnings: string[] = [];
    const r = await typesetHtml(doc('<h1>見出し</h1><p>本文</p>'), { loadFont: loadCachedFont, pdfua: { warnings } });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const xmp = metadata(pdf);
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>');
    expect(xmp).toMatch(/<dc:title>.*>t<\/rdf:li>/);
    expect(String(pdf.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('DisplayDocTitle')))).toBe('true');
    expect(shape(structTree(pdf))).toBe('Document(H1,P)');
    expect(warnings).toEqual([]);
  });

  it('足りないもの (言語・図の代わりの文・見出しの段の跳び) を警告に出す。documentLang は、入力に言語が無いときの文書の言語', async () => {
    const html = (lang: string) => `<!DOCTYPE html><html${lang}><head><meta charset="utf-8"><title>t</title></head><body><h2>いきなり H2</h2><img src="${SVG}"><h4>H4</h4></body></html>`;
    const warnings: string[] = [];
    const r = await typesetHtml(html(''), { loadFont: loadCachedFont, pdfua: { warnings } });
    await r.toPdf();
    expect(warnings.join('\n')).toMatch(/言語がありません|no language/);
    expect(warnings.join('\n')).toMatch(/図が 1 個|1 figure/);
    expect(warnings.join('\n')).toMatch(/2 か所|2 place/);
    const r2 = await typesetHtml(html(''), { loadFont: loadCachedFont, pdfua: true, documentLang: 'en-GB' });
    expect(text((await PDFDocument.load(await r2.toPdf(), { updateMetadata: false })).catalog.get(PDFName.of('Lang')))).toBe('en-GB');
    // 入力に言語があれば、それを使う
    const r3 = await typesetHtml(html(' lang="ja"'), { loadFont: loadCachedFont, pdfua: true, documentLang: 'en-GB' });
    expect(text((await PDFDocument.load(await r3.toPdf(), { updateMetadata: false })).catalog.get(PDFName.of('Lang')))).toBe('ja');
  });

  it('PDF/A-2b と合わせると、pdfuaid を PDF/A の拡張のスキーマで定義する', async () => {
    const r = await typesetHtml(doc('<p>本文</p>'), { loadFont: loadCachedFont, pdfua: true });
    const pdf = await PDFDocument.load(await r.toPdf({ pdfa: { version: 'A-2b' } }), { updateMetadata: false });
    const xmp = metadata(pdf);
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>');
  });

  it('上・下の余白の箱と、XSL-FO の region-before・region-after は、Pagination の Subtype Header・Footer', async () => {
    const c = content(await pdfOf('<p>本文</p>', '@page { @top-center { content: "柱" } }'), 0);
    expect(c).toMatch(/\/Artifact\s*<<[^>]*\/Subtype\s*\/Header/);
    expect(c).toMatch(/\/Artifact\s*<<[^>]*\/Subtype\s*\/Footer/);
    const fo = content(
      await foPdfOf('<fo:block>本文</fo:block>', { statics: '<fo:static-content flow-name="xsl-region-before"><fo:block>上</fo:block></fo:static-content><fo:static-content flow-name="xsl-region-after"><fo:block>下</fo:block></fo:static-content>' }),
      0,
    );
    expect(fo).toMatch(/\/Subtype\s*\/Header/);
    expect(fo).toMatch(/\/Subtype\s*\/Footer/);
  });

  it('ルビは Ruby (RB・RT)、圏点の点は飾り', async () => {
    const pdf = await pdfOf('<p>前<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>と<em style="text-emphasis: sesame">強調</em></p>');
    expect(shape(structTree(pdf))).toBe('Document(P(Ruby(RB,RT),Ruby(RB,RT)))');
  });

  it('割注は Warichu (前後の括弧は WP、中身は WT。ISO 32000-1 §14.8.4.4)', async () => {
    const css = '.w { -kumiori-warichu: auto; font-size: 5pt } .n { -kumiori-warichu-brackets: none }';
    const pdf = await pdfOf('<p>前<span class="w">割注の<ruby>中身<rt>なかみ</rt></ruby>です</span>後<span class="w n">括弧なし</span></p>', css);
    expect(shape(structTree(pdf))).toBe('Document(P(Warichu(WP,WT(Ruby(RB,RT)),WP),Warichu(WT)))');
    const fo = await foPdfOf('<fo:block>前<fo:inline xmlns:k="https://github.com/n-lights-co/kumiori/ns" k:warichu="auto" font-size="5pt">割注の中身</fo:inline>後</fo:block>');
    expect(shape(structTree(fo))).toContain('P(Warichu(WP,WT,WP))');
  });

  it('割注にしたリンクは Link の構造のまま (割注の括弧はリンクの中身)', async () => {
    const pdf = await pdfOf('<p>前<a href="https://example.com/" style="-kumiori-warichu: auto; font-size: 5pt">割注のリンク</a>後</p>');
    expect(shape(structTree(pdf))).toBe('Document(P(Link))');
    const fo = await foPdfOf('<fo:block>前<fo:inline xmlns:k="https://github.com/n-lights-co/kumiori/ns" k:warichu="auto"><fo:block>ブロック</fo:block></fo:inline></fo:block>');
    expect(shape(structTree(fo))).not.toContain('Warichu');
  });

  it('中身の無い割注・入れ子の中にブロックを含む fo:inline には、Warichu の構造を作らない', async () => {
    const pdf = await pdfOf('<p>前<span id="n" style="-kumiori-warichu: auto"></span>後<span class="g" style="-kumiori-warichu: auto; font-size: 5pt"></span></p>', '.g::before { content: "生成" }');
    // 生成内容のある割注は Warichu (前後の括弧の WP と中身の WT)
    expect(shape(structTree(pdf))).toBe('Document(P(Warichu(WP,WT,WP)))');
    // 空白だけの割注・割注の中の割注 (内側) にも作らない
    const sp = await pdfOf('<p>前<span class="w"> </span>後<span class="w">外の<span class="w">内の</span>割注</span></p>', '.w { -kumiori-warichu: auto; font-size: 5pt }');
    expect(shape(structTree(sp))).toBe('Document(P(Warichu(WP,WT,WP)))');
    const fo = await foPdfOf('<fo:block>前<fo:inline xmlns:k="https://github.com/n-lights-co/kumiori/ns" k:warichu="auto"><fo:wrapper><fo:block>ブロック</fo:block></fo:wrapper></fo:inline><fo:inline xmlns:k="https://github.com/n-lights-co/kumiori/ns" k:warichu="auto"> </fo:inline></fo:block>');
    expect(shape(structTree(fo))).not.toContain('Warichu');
  });

  it('フォームの欄の注釈は Form の構造の節に入れ、欄に説明 (TU) を付ける', async () => {
    const pdf = await foPdfOf('<fo:block>名前: <axf:form-field field-type="text" field-name="name" field-description="名前を入れる" width="100pt" height="12pt"/></fo:block>');
    const forms = find(structTree(pdf), 'Form');
    expect(forms.length).toBe(1);
    const objr = forms[0].kids.find((k): k is { annot: PDFRef } => 'annot' in k)!;
    const widget = pdf.context.lookup(objr.annot, PDFDict);
    expect(widget.get(PDFName.of('StructParent'))).toBeInstanceOf(PDFNumber);
    const field = widget.get(PDFName.of('T')) ? widget : pdf.context.lookup(widget.get(PDFName.of('Parent')) as PDFRef, PDFDict);
    expect(text(field.get(PDFName.of('TU')))).toBe('名前を入れる');
  });
});

describe('タグ付き PDF: ページを 1 枚ずつ書く経路 (typesetToPdf)', () => {
  it('lowMemory でも、そうでなくても、typeset → toPdf と同じ構造の木になる', async () => {
    const body = '<h1>見出し</h1><p>段落の<a href="https://example.com/">リンク</a></p><ol><li>項目</li></ol><table><tr><th>名前</th><td>値</td></tr></table><p>本文<span style="float: footnote">脚注</span></p>';
    const want = shape(structTree(await pdfOf(body)));
    for (const lowMemory of [false, true]) {
      const r = await typesetToPdf(doc(body), { loadFont: loadCachedFont, tagged: true }, { lowMemory });
      expect(shape(structTree(await PDFDocument.load(r.pdf, { updateMetadata: false })))).toBe(want);
    }
  });
});

describe('タグを付けないとき', () => {
  it('既定ではタグを付ける。tagged: false なら構造の木も印も書かない (読み込みも構造の木を作らない)', async () => {
    const def = await typesetHtml(doc('<h1>見出し</h1><p>本文</p>'), { loadFont: loadCachedFont });
    expect(def.areaTree.structure).toBeDefined();
    expect((await PDFDocument.load(await def.toPdf(), { updateMetadata: false })).catalog.get(PDFName.of('StructTreeRoot'))).toBeDefined();
    const r = await typesetHtml(doc('<h1>見出し</h1><p>本文</p>'), { loadFont: loadCachedFont, tagged: false });
    expect(r.areaTree.structure).toBeUndefined();
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    expect(pdf.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
    expect(pdf.catalog.get(PDFName.of('MarkInfo'))).toBeUndefined();
    expect(content(pdf, 0)).not.toMatch(/\bBDC\b/);
  });

  it('PDF/X-1a (透明を平らにする出力) は、tagged: true と書けば誤り。既定のままなら、タグを付けずに書く', async () => {
    const r = await typesetHtml(doc('<p>本文</p>'), { loadFont: loadCachedFont, tagged: true });
    await expect(r.toPdf({ pdfx: { version: 'X-1a' } })).rejects.toThrow(/タグ付き PDF|tagged PDF/);
    const d = await typesetHtml(doc('<p>本文</p>'), { loadFont: loadCachedFont });
    const pdf = await PDFDocument.load(await d.toPdf({ pdfx: { version: 'X-1a' } }), { updateMetadata: false });
    expect(pdf.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
    expect(content(pdf, 0)).not.toMatch(/\/MCID/);
    // PDF だけを作る経路 (typesetToPdf) も同じ
    const t = await typesetToPdf(doc('<p>本文</p>'), { loadFont: loadCachedFont }, { pdfx: { version: 'X-1a' } });
    expect((await PDFDocument.load(t.pdf, { updateMetadata: false })).catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
  });
});

describe('タグ付き PDF: 大きな入力の手間と、独自の型の名前', () => {
  it('同じ id の注の ID は、2 つ目から番号を足す (番号は、その値で次に試す所から。文書の中の id とぶつかる番号は飛ばす)', async () => {
    const pdf = await pdfOf('<aside role="doc-footnote" id="x-2"><p>一</p></aside>' + '<aside role="doc-footnote" id="x"><p>注</p></aside>'.repeat(3));
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const names = root.lookup(PDFName.of('IDTree'), PDFDict).lookup(PDFName.of('Names'), PDFArray).asArray();
    expect(names.filter((_, k) => k % 2 === 0).map((x) => text(x))).toEqual(['x', 'x-2', 'x-3', 'x-4']);
    expect(find(structTree(pdf), 'Note').map(idOf)).toEqual(['x-2', 'x', 'x-3', 'x-4']);
  });

  it('見出しのセルの向き: td の無い行の th は列、td のある行の th は行 (行ごとに 1 度だけ調べる)', async () => {
    const pdf = await pdfOf(`<table><tr>${'<th>a</th>'.repeat(50)}</tr><tr><th>b</th>${'<td>c</td>'.repeat(49)}</tr></table>`);
    const scopes = find(structTree(pdf), 'TH').map((h) => attr(h, 'Scope'));
    expect(scopes).toEqual([...Array(50).fill('/Column'), '/Row']);
  });

  it('XSL-FO: 独自の構造の型の名前は、UTF-8 のバイトで書く (印の付いた内容・StructElem の S・RoleMap の鍵)', async () => {
    const pdf = await foPdfOf('<fo:block axf:pdftag="名前タグ">字</fo:block>');
    const roleMap = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('RoleMap'), PDFDict);
    const key = roleMap.keys()[0];
    // 名前の字のバイトは UTF-8 (#E5#90#8D…)。読み戻すと、元の字になる
    expect(key.asString()).toBe('/#E5#90#8D#E5#89#8D#E3#82#BF#E3#82#B0');
    expect(new TextDecoder().decode(key.asBytes())).toBe('名前タグ');
    expect(find(structTree(pdf), key.asString().slice(1)).length).toBe(1);
    expect(content(pdf, 0)).toContain(`${key.asString()} <<`);
  });

  it('XSL-FO: 127 バイトを超える独自の型の名前は、UTF-8 のバイトで数えて使わず、標準の型にする (PDF/A を出せる)', async () => {
    const long = '長'.repeat(50); // 50 字・150 バイト
    const ok = '長'.repeat(42); // 126 バイト
    const fo = `${FO_HEAD} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block axf:pdftag="${long}">字</fo:block><fo:block axf:pdftag="${ok}">字</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typesetFo(fo, { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf({ pdfa: { version: 'A-3b' } }), { updateMetadata: false });
    const roleMap = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('RoleMap'), PDFDict);
    expect(roleMap.keys().map((k) => new TextDecoder().decode(k.asBytes()))).toEqual([ok]);
    expect(shape(structTree(pdf))).toBe(`Document(Part(P,${roleMap.keys()[0].asString().slice(1)}))`);
  });

  it('XSL-FO: role="JavaScript" の独自の型は、PDF/A の確かめで動作と見なさない', async () => {
    const fo = `${FO_HEAD} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block role="JavaScript">字</fo:block><fo:block role="Launch">字</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typesetFo(fo, { loadFont: loadCachedFont, tagged: true });
    const pdf = await PDFDocument.load(await r.toPdf({ pdfa: { version: 'A-3b' } }), { updateMetadata: false });
    expect(shape(structTree(pdf))).toBe('Document(Part(JavaScript,Launch))');
  });
});
