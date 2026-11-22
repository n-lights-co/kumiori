/**
 * pdfContentStreams — 書き出した PDF を読み直して調べるとき (PDF/X・PDF/A の確かめ) の、内容の流れ (命令の並び) を集める。
 * 内容の流れは、ページの Contents、Form XObject、タイルの模様 (PatternType 1)、Type3 の書体の字形 (CharProcs)、注釈の見え方
 * (/AP の N・R・D。流れか、見え方の状態ごとの流れの辞書) (ISO 32000-1 §7.8.2・§8.10・§8.7.3・§9.6.5・§12.5.5)。
 * 書体のファイルなどほかの流れは、圧縮を解いたバイト列に命令と同じ字が偶然に現れるので、命令を探さない。
 * Type3 の書体と注釈は、間接オブジェクトでなく、Resources や Annots の中にじかに書かれていることもあるので、辞書と配列の中もたどる
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib';

export function contentStreams(pdf: PDFDocument): Set<PDFObject> {
  const ctx = pdf.context;
  const contents = new Set<PDFObject>();
  const add = (v: PDFObject | undefined) => {
    const o = v instanceof PDFRef ? ctx.lookup(v) : v;
    if (o instanceof PDFRawStream) contents.add(o);
    else if (o instanceof PDFArray) o.asArray().forEach(add);
  };
  /** 見え方の流れ (流れそのものか、見え方の状態の名前 → 流れの辞書。§12.5.5) */
  const addAppearance = (v: PDFObject | undefined) => {
    const o = v instanceof PDFRef ? ctx.lookup(v) : v;
    if (o instanceof PDFRawStream) contents.add(o);
    else if (o instanceof PDFDict) for (const x of o.values()) add(x);
  };
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject | undefined): void => {
    if (!o || o instanceof PDFRef || seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFRawStream) {
      const d = o.dict;
      const pt = d.get(PDFName.of('PatternType'));
      if (String(d.get(PDFName.of('Subtype'))) === '/Form' || (pt instanceof PDFNumber && pt.asNumber() === 1)) contents.add(o);
      visit(d);
    } else if (o instanceof PDFDict) {
      if (String(o.get(PDFName.of('Subtype'))) === '/Type3') for (const v of o.lookupMaybe(PDFName.of('CharProcs'), PDFDict)?.values() ?? []) add(v);
      const ap = o.lookup(PDFName.of('AP'));
      if (ap instanceof PDFDict) for (const k of ['N', 'R', 'D']) addAppearance(ap.get(PDFName.of(k)));
      for (const v of o.values()) visit(v);
    } else if (o instanceof PDFArray) o.asArray().forEach(visit);
  };
  for (const page of pdf.getPages()) add(page.node.get(PDFName.of('Contents')));
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj);
  return contents;
}
