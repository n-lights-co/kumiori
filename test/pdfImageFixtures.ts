/**
 * 試験の PDF (PDF を図として貼る試験で使う)。他の人の著作物を入れないように、試験の中で pdf-lib で作る
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFRawStream, StandardFonts, cmyk, rgb } from 'pdf-lib';

export interface FixturePage {
  /** MediaBox [左, 下, 右, 上] (pt) */
  media?: [number, number, number, number];
  crop?: [number, number, number, number];
  trim?: [number, number, number, number];
  rotate?: number;
  userUnit?: number;
  /** 中身に描く矩形の色 (0〜1 の RGB) */
  color?: [number, number, number];
  /** 矩形を CMYK (DeviceCMYK) で塗る */
  cmyk?: boolean;
  /** 埋め込まない標準の書体 (Helvetica) で書く字 */
  text?: string;
  /** このページに、別のページ (0 から数える) を行き先にしたリンクの注釈を置く */
  linkToPage?: number;
  /** 中身の流れを、MCID の付いた印の付いた内容 (/P <</MCID 0>> BDC … EMC) で包む */
  mcid?: boolean;
  /** ページの透明のグループ (Group。S Transparency) */
  group?: boolean;
  /**
   * ページの資源に、入れ子の Form XObject (名前 Fm0) を置いて描く。mcid: Form の流れを MCID の付いた印の付いた内容で包み、Form に StructParents 0 を書く。
   * content: Form の流れ (圧縮した中身と Filter。圧縮の爆弾の試験に使う)
   */
  nestedForm?: { mcid?: boolean; content?: { bytes: Uint8Array; filter: string[] } };
  /** 任意の内容 (資源の Properties の OCG を指す /OC /oc1 BDC … EMC) で矩形を包む */
  optionalContent?: boolean;
}

/** 試験の PDF を作る。inheritMedia なら、1 ページ目の MediaBox をページの木 (Pages) に置き、ページから消す (受け継ぐ箱) */
export async function makePdf(pages: FixturePage[], opts: { inheritMedia?: boolean; encrypt?: boolean; cyclePages?: boolean; count?: number } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const m = p.media ?? [0, 0, 200, 100];
    const page = pdf.addPage([m[2] - m[0], m[3] - m[1]]);
    page.node.set(PDFName.of('MediaBox'), pdf.context.obj(m));
    if (p.crop) page.node.set(PDFName.of('CropBox'), pdf.context.obj(p.crop));
    if (p.trim) page.node.set(PDFName.of('TrimBox'), pdf.context.obj(p.trim));
    if (p.rotate !== undefined) page.node.set(PDFName.of('Rotate'), PDFNumber.of(p.rotate));
    if (p.userUnit !== undefined) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(p.userUnit));
    const c = p.color ?? [1, 0, 0];
    if (p.mcid) page.pushOperators(PDFOperator.of('BDC' as never, [PDFName.of('P'), pdf.context.obj({ MCID: 0 }) as never]));
    if (p.optionalContent) {
      const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('layer') }));
      page.node.Resources()!.set(PDFName.of('Properties'), pdf.context.obj({ oc1: ocg }));
      page.pushOperators(PDFOperator.of('BDC' as never, [PDFName.of('OC'), PDFName.of('oc1')]));
    }
    if (p.nestedForm) {
      const f = p.nestedForm;
      const dict = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50], ...(f.mcid ? { StructParents: 0 } : {}) };
      const stream = f.content
        ? PDFRawStream.of(pdf.context.obj({ ...dict, Filter: f.content.filter.map((x) => PDFName.of(x)), Length: f.content.bytes.length }) as PDFDict, f.content.bytes)
        : pdf.context.stream(`${f.mcid ? '/P <</MCID 0>> BDC ' : ''}0 0 1 rg 0 0 10 10 re f${f.mcid ? ' EMC' : ''}`, dict);
      const name = page.node.newXObject('Fm', pdf.context.register(stream));
      page.pushOperators(PDFOperator.of('q' as never), PDFOperator.of('Do' as never, [name]), PDFOperator.of('Q' as never));
    }
    page.drawRectangle({ x: m[0] + 10, y: m[1] + 10, width: 20, height: 20, color: p.cmyk ? cmyk(c[0], c[1], c[2], 0) : rgb(c[0], c[1], c[2]) });
    if (p.text) page.drawText(p.text, { x: m[0] + 40, y: m[1] + 10, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
    if (p.mcid) page.pushOperators(PDFOperator.of('EMC' as never));
    if (p.optionalContent) page.pushOperators(PDFOperator.of('EMC' as never));
    if (p.group) page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' }));
  }
  for (const [k, p] of pages.entries()) {
    if (p.linkToPage === undefined) continue;
    const page = pdf.getPage(k);
    const annot = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [pdf.getPage(p.linkToPage).ref, PDFName.of('Fit')] }));
    page.node.set(PDFName.of('Annots'), pdf.context.obj([annot]));
  }
  const root = pdf.catalog.lookup(PDFName.of('Pages'), PDFDict);
  if (opts.inheritMedia) {
    const first = pdf.getPage(0).node;
    root.set(PDFName.of('MediaBox'), first.get(PDFName.of('MediaBox'))!);
    for (const p of pdf.getPages()) p.node.delete(PDFName.of('MediaBox'));
  }
  if (opts.count !== undefined) root.set(PDFName.of('Count'), PDFNumber.of(opts.count));
  if (opts.cyclePages) root.lookup(PDFName.of('Kids'), PDFArray).push(pdf.catalog.get(PDFName.of('Pages'))!);
  if (opts.encrypt) pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFArray.withContext(pdf.context), U: PDFArray.withContext(pdf.context), P: -4 }));
  return pdf.save({ useObjectStreams: false });
}

/** 深いページの木 (Pages の中に Pages を depth 段重ね、いちばん下に 1 ページ) */
export async function makeDeepPdf(depth: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([100, 100]);
  const ctx = pdf.context;
  const rootRef = pdf.catalog.get(PDFName.of('Pages'))!;
  const root = pdf.catalog.lookup(PDFName.of('Pages'), PDFDict);
  const leafRef = root.lookup(PDFName.of('Kids'), PDFArray).get(0);
  let parentRef = rootRef;
  let parent = root;
  for (let i = 0; i < depth; i++) {
    const node = ctx.obj({ Type: 'Pages', Count: 1, Parent: parentRef, Kids: [] }) as PDFDict;
    const ref = ctx.register(node);
    parent.set(PDFName.of('Kids'), ctx.obj([ref]));
    parentRef = ref;
    parent = node;
  }
  parent.set(PDFName.of('Kids'), ctx.obj([leafRef]));
  ctx.lookup(leafRef, PDFDict).set(PDFName.of('Parent'), parentRef);
  return pdf.save({ useObjectStreams: false });
}

/**
 * 手で書いた PDF (pdf-lib では作れない形: オブジェクトの流れの中身や、流れの圧縮の方式を自由に決めたもの)。
 * objects は [番号, 辞書の字, 流れの中身 (あれば)]。1 は Catalog、2 は Pages、3 は 100 × 100 のページにする。相互参照の表は書かない (読み手は頭から読む)
 */
export function rawPdf(objects: Array<[number, string, Uint8Array?]>, pageExtra = ''): Uint8Array {
  const enc = (t: string) => new TextEncoder().encode(t);
  const parts: Uint8Array[] = [enc('%PDF-1.5\n')];
  const all: Array<[number, string, Uint8Array?]> = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${pageExtra} >>`],
    ...objects,
  ];
  for (const [n, dict, stream] of all) {
    if (stream) parts.push(enc(`${n} 0 obj\n${dict.replace(/>>\s*$/, ` /Length ${stream.length} >>`)}\nstream\n`), stream, enc('\nendstream\nendobj\n'));
    else parts.push(enc(`${n} 0 obj\n${dict}\nendobj\n`));
  }
  parts.push(enc(`trailer\n<< /Root 1 0 R /Size ${Math.max(...all.map(([n]) => n)) + 1} >>\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
