/**
 * measure-png-embed の、Node と Web Worker の両方で使う部分: 試しの文書 (HTML) と、α 付き PNG を PDF に入れる処理を 4 つに分けて測る関数。
 * Worker の側は、測る道具 (scripts/measure-png-embed.mjs) が、このファイルを Kumiori の部品と一緒に束ねて読む。
 * ここでは Node の部品 (node:*) を読まない。
 */

/**
 * 試しの文書: pages ページに、images 枚の画像 (img0.png〜) を 1 ページに 1〜2 枚ずつ、短い段落と一緒に置く。
 * 2 枚のページを先に並べ、残りを 1 枚のページにする (197 ページ・333 枚なら、2 枚が 136 ページ・1 枚が 61 ページ)
 */
export function bookHtml(pages, images) {
  const two = Math.max(0, Math.min(pages, images - pages));
  const para = '画面の写しを並べた手引きの頁です。操作の手順と、そのときの画面を順に示します。'.repeat(2);
  let k = 0;
  const body = [];
  for (let p = 0; p < pages && k < images; p++) {
    const n = p < two ? 2 : 1;
    const imgs = Array.from({ length: n }, () => `<p class="fig"><img src="img${k}.png" alt="画面 ${++k}"></p>`).join('');
    body.push(`<section><h2>手順 ${p + 1}</h2><p>${para}</p>${imgs}</section>`);
  }
  const style = '@page { size: A4; margin: 15mm } section { break-after: page } section:last-child { break-after: auto } .fig { margin: 2mm 0 } .fig img { width: 150mm }';
  return `<!doctype html><html lang="ja"><head><title>画像の多い手引き</title><style>${style}</style></head><body>${body.join('\n')}</body></html>`;
}

/** PNG の IDAT をつないだもの (zlib の列) と、展開した走査線の大きさ (飛び越しでない 8 ビットの PNG。(幅 × 成分 + 1) × 高さ) */
export function idatOf(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts = [];
  let need = 0;
  for (let at = 8; at + 12 <= png.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    if (type === 'IHDR') {
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[png[at + 17]] ?? 0;
      need = (dv.getUint32(at + 8) * channels + 1) * dv.getUint32(at + 12);
    } else if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + len));
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  return { all, need };
}

/**
 * α 付き PNG を PDF に入れる処理のうち、画像ごとの 3 つを、pngs のすべてについて測る (ミリ秒の合計)。
 *  (a) 展開: IDAT の zlib を走査線に戻す (埋め込みと同じ関数。imageDeflate.ts の inflateZlib があればそれ、無ければ
 *      元の作り (Node の zlib、ブラウザでは自前の inflateFast))
 *  (b) フィルタを戻す・RGB と α に分ける: pixels.ts の decodePngForPdf の全体の時間から (a) を引いたもの
 *  (c) 画素の圧縮: decodePngForPdf の RGB と α を、imageDeflate.ts の imageDeflater() (Node は zlib、ブラウザは CompressionStream) で圧縮する
 * mods は { pixels, inflateFast, imageDeflate } (その版の Kumiori の部品)
 */
export async function measureStages(mods, pngs) {
  const now = () => performance.now();
  const inflate = mods.imageDeflate.inflateZlib
    ? (all, need) => mods.imageDeflate.inflateZlib(all, need)
    : (all, need) => {
        const fast = mods.imageDeflate.inflateNode(all, need);
        return fast && fast.length >= need ? fast : mods.inflateFast.inflateFast(all, need);
      };
  const deflate = mods.imageDeflate.imageDeflater();
  const t = { inflate: 0, decode: 0, deflate: 0, rawMB: 0, rgbMB: 0, alphaMB: 0, outMB: 0 };
  for (const png of pngs) {
    const { all, need } = idatOf(png);
    let s = now();
    const raw = await inflate(all, need);
    t.inflate += now() - s;
    if (raw.length < need) throw new Error('測る画像の展開に失敗しました');
    t.rawMB += need / 1e6;
    s = now();
    const px = await mods.pixels.decodePngForPdf(png);
    t.decode += now() - s;
    if (!px || px === 'broken') throw new Error('測る画像が、自前の展開の形 (8 ビットの α 付き PNG) ではありません');
    t.rgbMB += px.rgb.length / 1e6;
    t.alphaMB += (px.alpha?.length ?? 0) / 1e6;
    s = now();
    const z = await deflate(px.rgb);
    const za = px.alpha ? await deflate(px.alpha) : undefined;
    t.deflate += now() - s;
    t.outMB += (z.length + (za?.length ?? 0)) / 1e6;
  }
  const r = (v) => Math.round(v);
  const mb = (v) => Math.round(v * 10) / 10;
  return { inflateMs: r(t.inflate), unfilterMs: r(t.decode - t.inflate), decodeMs: r(t.decode), deflateMs: r(t.deflate), rawMB: mb(t.rawMB), rgbMB: mb(t.rgbMB), alphaMB: mb(t.alphaMB), outMB: mb(t.outMB) };
}

/**
 * 利用者 (Tigral) と同じ流れで組んで PDF にする: createTypesetter → typeset → toPdf({ title, date, onProgress })。deflate は渡さない。
 * 組版の時間・最初の onProgress (phase 'pdf') までの時間・toPdf の時間・全体の時間 (ミリ秒) と、PDF の大きさを返す
 */
export async function measureTypeset(api, setup, html, files) {
  const now = () => performance.now();
  const ts = await api.createTypesetter(setup);
  const t0 = now();
  const res = await ts.typeset(html, { name: 'book.html', files });
  const t1 = now();
  let first;
  const pdf = await res.toPdf({ title: '画像の多い手引き', date: new Date('2026-01-01T00:00:00Z'), onProgress: (p) => { if (p.phase === 'pdf' && first === undefined) first = now(); } });
  const t2 = now();
  const imgWarnings = res.warnings.filter((w) => /PNG|画像|image/i.test(w));
  return { pages: res.pageCount, layoutMs: Math.round(t1 - t0), firstProgressMs: Math.round((first ?? t2) - t0), toPdfMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0), pdfMB: Math.round(pdf.length / 1e5) / 10, pdf, imgWarnings };
}
