/**
 * 公開 API (src/index.ts) のテスト: typeset で HTML+CSS・XSL-FO を組み、Area Tree と PDF を得る。
 * 既定の書体は .cache/fonts (KUMIORI_FONT_DIR で上書き可) に無ければ Google Fonts 配信元から取得して置き、loadFont で渡す。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { childrenOf } from '../src/areaTree';
import { encodeJpeg } from '../src/jpeg';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, createTypesetter, typeset, typesetFo, typesetHtml, walkAreaTree, serializeAreaTree, parseAreaTree, type FontSpec, type GlyphArea } from '../src/index';

const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
/** Arimo の OS/2 の typo の上下を 0.75em・−0.25em (ちょうど 1em。基準線の比 0.75) に書き換えた書体 (和文の書体と基準線の比が違う欧文の書体) */
function typo1emArimo(): Uint8Array {
  const buf = new Uint8Array(fs.readFileSync(path.join(fontDir, 'Arimo-Regular.ttf')));
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let k = 0; k < v.getUint16(4); k++) {
    const at = 12 + 16 * k;
    if (String.fromCharCode(...buf.slice(at, at + 4)) !== 'OS/2') continue;
    const off = v.getUint32(at + 8);
    v.setInt16(off + 68, Math.round(2048 * 0.75));
    v.setInt16(off + 70, -Math.round(2048 * 0.25));
  }
  return buf;
}

/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  fs.mkdirSync(fontDir, { recursive: true });
  // 基本の書体と、TTC のテストで読む等幅の書体 (Cousine)
  for (const spec of [...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono.filter((m) => m.family === 'Cousine')]) {
    const file = fileOf(spec);
    if (fs.existsSync(file)) continue;
    const url = spec.urls.find((u) => /^https:/.test(u))!;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font download failed: ${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}, 300_000);

const textOf = (tree: Awaited<ReturnType<typeof typeset>>['areaTree']) => {
  let t = '';
  walkAreaTree(tree, (a) => {
    if (a.type === 'glyph') t += (a as GlyphArea).text;
  });
  return t;
};

/** 書体ファイルをまとめて TTC (OpenType 1.9 の TTC Header version 1.0) を作る。表の位置は TTC の先頭からの位置に直す */
function makeTtc(faces: Buffer[]): ArrayBuffer {
  const head = 12 + 4 * faces.length;
  const total = head + faces.reduce((n, f) => n + f.length + ((4 - (f.length % 4)) % 4), 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x74746366); // 'ttcf'
  v.setUint32(4, 0x00010000);
  v.setUint32(8, faces.length);
  let at = head;
  faces.forEach((f, i) => {
    v.setUint32(12 + 4 * i, at);
    out.set(f, at);
    const numTables = v.getUint16(at + 4);
    for (let k = 0; k < numTables; k++) {
      const rec = at + 12 + 16 * k;
      v.setUint32(rec + 8, v.getUint32(rec + 8) + at);
    }
    at += f.length + ((4 - (f.length % 4)) % 4);
  });
  return out.buffer;
}

describe('公開 API: typeset', () => {
  it('HTML と CSS (files で渡す) を組み、Area Tree と PDF を返す', async () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><h1>組み織り</h1><p>本文です。</p></body></html>';
    const css = '@page { size: A5; margin: 15mm } p { break-before: page }';
    const r = await typeset(html, { name: 'doc.html', files: [{ name: 's.css', data: css }], loadFont });
    expect(r.pageCount).toBe(2);
    expect(r.areaTree.sheets[0].width).toBeCloseTo((148 * 72) / 25.4, 0);
    expect(textOf(r.areaTree)).toContain('組み織り');
    const pdf = await PDFDocument.load(await r.toPdf({ title: '見本' }), { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe('見本');
    expect(pdf.getProducer()).toContain('Kumiori');
  });

  it('リンクの動作: スキームのある URL は URI、相対の PDF は GoToR (#page=N・#名前)、ほかの相対のファイルは Launch (ISO 32000-1 §12.6.4)', async () => {
    const r = await typeset(
      '<p><a href="pdf-media-link://x">m</a></p><a style="display: block" href="other.pdf#page=3">p</a><a style="display: flex" href="dir/memo%20a.docx"><span>d</span></a><a style="display: block" href="b.pdf#sec">n</a>',
      { loadFont },
    );
    const pdf = await PDFDocument.load(await r.toPdf());
    const { PDFName } = await import('pdf-lib');
    const acts = (pdf.getPages()[0].node.lookup(PDFName.of('Annots')) as unknown as { asArray(): unknown[] }).asArray().map((ref) => String((pdf.context.lookup(ref as never) as unknown as { lookup(n: unknown): unknown }).lookup(PDFName.of('A'))).replace(/\s+/g, ' '));
    expect(acts).toEqual(['<< /S /URI /URI (pdf-media-link://x) >>', '<< /S /GoToR /F (other.pdf) /D [ 2 /Fit ] >>', '<< /S /Launch /F (dir/memo a.docx) >>', '<< /S /GoToR /F (b.pdf) /D (sec) >>']);
  });
  it('見出しのしおり: どの既定のスタイルでも h1〜h6 にしおりが付く (GCPM 3 の付録 B)。bookmark-level: none で外せる', async () => {
    const html = '<h1>One</h1><h2>Two</h2><h3 style="bookmark-level: none">No</h3>';
    for (const style of ['browser', 'kumiori', 'weasyprint'] as const) {
      const r = await typeset(html, { loadFont, style });
      const bm = r.areaTree.bookmarks ?? [];
      expect(bm.map((b) => b.title)).toEqual(['One']);
      expect((bm[0].children ?? []).map((b) => b.title)).toEqual(['Two']);
    }
    // 見えない見出し (position: absolute; visibility: hidden) のしおりも、飛び先が見つかる (CSS 2.1 §11.2)
    const hidden = await typeset('<h1 style="position: absolute; visibility: hidden">Title</h1><p>x</p>', { loadFont });
    expect(hidden.areaTree.bookmarks?.map((b) => [b.title, b.sheet])).toEqual([['Title', 0]]);
    expect(hidden.warnings.filter((w) => /しおり|bookmark/.test(w))).toEqual([]);
  });
  it('resolveResource: files に無い参照 (file://・相対) の中身を返す。CSS の中の相対参照は CSS の URL を基準に解決して問い合わせる', async () => {
    const asked: string[] = [];
    const store: Record<string, string> = {
      'file:///work/css/main.css': '@import "parts/color.css"; h1 { font-size: 30pt }',
      'file:///work/css/parts/color.css': 'h1 { color: #ff0000 }',
    };
    const r = await typeset('<link rel="stylesheet" href="file:///work/css/main.css"><h1>H</h1><p><a href="other.pdf">x</a></p>', {
      loadFont,
      resolveResource: (u) => (asked.push(u), store[u]),
    });
    expect(asked).toEqual(['file:///work/css/main.css', 'file:///work/css/parts/color.css']);
    let g: GlyphArea | undefined;
    walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (a as GlyphArea).text === 'H' && (g ??= a as GlyphArea)));
    expect(g!.color).toBe('#ff0000');
    expect(g!.fontSize).toBeCloseTo(30, 3);
  });
  it('問い合わせ (?…) だけが違う CSS は、別の CSS として両方が効く (<link> と @import)', async () => {
    const store: Record<string, string> = {
      'https://fonts.googleapis.com/css2?family=A': 'p { color: #ff0000 } .a { font-size: 30pt }',
      'https://fonts.googleapis.com/css2?family=B': 'p { color: #0000ff } .b { font-size: 40pt }',
      'https://fonts.googleapis.com/css2?family=C': '@import "css2?family=D"; .c { font-size: 50pt }',
      'https://fonts.googleapis.com/css2?family=D': '.d { font-size: 60pt }',
      // 属性の値の文字参照 (&amp;) は解いてから問い合わせる (HTML Living Standard §13.2.5.36 の属性の値の中の文字参照)
      'https://fonts.googleapis.com/css2?family=E&display=swap': '.e { font-size: 70pt }',
      'https://fonts.googleapis.com/css2?family=F&display=swap': '.f { font-size: 80pt }',
    };
    const asked: string[] = [];
    const r = await typeset(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=A"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=B">
       <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=E&amp;display=swap"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=F&#38;display=swap">
       <style>@import url("https://fonts.googleapis.com/css2?family=C");</style>
       <p class="a">a</p><p class="b">b</p><p class="c">c</p><p class="d">d</p><p class="e">e</p><p class="f">f</p>`,
      { loadFont, fetchStyles: false, resolveResource: (u) => (asked.push(u), store[u]) },
    );
    expect(asked.sort()).toEqual(Object.keys(store));
    const seen: Record<string, [number, string]> = {};
    walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && /^[a-f]$/.test((a as GlyphArea).text) && (seen[(a as GlyphArea).text] = [Math.round((a as GlyphArea).fontSize), (a as GlyphArea).color])));
    // 後の <link> (family=B) の色が勝つ (文書の順)。どの CSS も 1 度だけ使う (利用者のスタイルシートとして足し直さない)
    expect(seen).toEqual({ a: [30, '#0000ff'], b: [40, '#0000ff'], c: [50, '#0000ff'], d: [60, '#0000ff'], e: [70, '#0000ff'], f: [80, '#0000ff'] });
    expect(r.warnings).toEqual([]);
  });
  it('問い合わせ (?…) だけが違う画像は、別の画像として組む (参照の URL の全体を先に見て、無ければ名前で突き合わせる)', async () => {
    const png = (w: number, h: number, c: number[]) => encodePngStored({ width: w, height: h, rgba: new Uint8Array(Array.from({ length: w * h }, () => c).flat()) });
    for (const base of ['https://example.com/a.png', 'pic/a.png']) {
      const store: Record<string, Uint8Array> = { [`${base}?id=1`]: png(10, 10, [255, 0, 0, 255]), [`${base}?id=2`]: png(20, 5, [0, 0, 255, 255]) };
      const asked: string[] = [];
      // 3 つ目の参照 (問い合わせなし) は中身が返らないので、今までどおり名前で突き合わせる (後に取った画像)
      const r = await typeset(`<p><img src="${base}?id=1"></p><p><img src="${base}?id=2"></p><p><img src="${base}"></p>`, {
        loadFont,
        fetchImages: false,
        resolveResource: (u) => (asked.push(u), store[u]),
      });
      expect(asked).toEqual([`${base}?id=1`, `${base}?id=2`, base]);
      const got: Array<[string, boolean, number, number]> = [];
      walkAreaTree(r.areaTree, (a) => void (a.type === 'image' && got.push([a.src, a.missing, a.width, a.height])));
      // 10×10 px と 20×5 px (1px = 0.75pt)
      expect(got).toEqual([
        [`${base}?id=1`, false, 7.5, 7.5],
        [`${base}?id=2`, false, 15, 3.75],
        [base, false, 15, 3.75],
      ]);
      expect(r.warnings).toEqual([]);
      // PDF にも 2 つの別の画像が入る (画像は参照ごとに埋め込む)
      const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
      const { PDFName: Name } = await import('pdf-lib');
      const sizes = pdf.context
        .enumerateIndirectObjects()
        .map(([, o]) => (o as { dict?: import('pdf-lib').PDFDict }).dict)
        .filter((d) => d && String(d.get(Name.of('Subtype'))) === '/Image')
        .map((d) => `${d!.get(Name.of('Width'))}x${d!.get(Name.of('Height'))}`);
      expect([...new Set(sizes)].sort()).toEqual(['10x10', '20x5']);
    }
  });
  it('ASCII でない名前のカウンターとカスタム プロパティ (counter(章)・var(--色)) が、通しで効く', async () => {
    const r = await typeset('<style>body { counter-reset: 章; --色: #ff0000 } p { counter-increment: 章; color: var(--色) } p::before { content: counter(章) "." }</style><p>a</p><p>b</p>', { loadFont });
    // 末尾は既定のノンブル
    expect(textOf(r.areaTree)).toBe('1.a2.b1');
    let g: GlyphArea | undefined;
    walkAreaTree(r.areaTree, (x) => void (x.type === 'glyph' && (g ??= x as GlyphArea)));
    expect(g!.color).toBe('#ff0000');
  });
  it('flex の項目の中の target-counter(…, page): 箱の幅は組んだ番号の桁に合い、折り返しを許す指定があっても番号が割れない', async () => {
    // 目次の行: 題・点線 (::before、flex: 1)・ページ番号 (::after)。sanitize.css などが html に付ける word-break: break-word があると、
    // 1 桁分の幅の箱の中で「10」が「1 / 0」に折り返していた (番号の桁の数は、組むまで分からない)
    const secs = Array.from({ length: 12 }, (_, i) => `<h2 id="s${i + 1}" style="break-before: page">S</h2><p>b</p>`).join('');
    const toc = [1, 9, 10, 12].map((i) => `<li><a href="#s${i}">T</a></li>`).join('');
    const css = `@page { size: A5; margin: 15mm } html { word-break: break-word } ul { list-style: none; padding: 0 }
      a { display: flex; color: inherit; text-decoration: none }
      a::before { content: ""; flex: 1; order: 1; border-bottom: 1px dotted #000; margin: 0 4pt }
      a::after { content: target-counter(attr(href), page); order: 2 }
      .lit a::after { content: "10" }`;
    const r = await typeset(`<style>${css}</style><ul>${toc}</ul><ul class="lit">${toc}</ul>${secs}`, { loadFont });
    expect(r.pageCount).toBe(13);
    // 1 ページ目の数字の字を、行 (字の領域の上端の、紙面の上での位置) ごとにまとめる。領域の位置は親からの相対なので、たどりながら足す
    const rows = new Map<number, Array<{ x: number; right: number; text: string }>>();
    const visit = (a: Parameters<typeof childrenOf>[0], ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph' && /^[0-9]+$/.test(a.text)) {
        const key = Math.round(y);
        rows.set(key, [...(rows.get(key) ?? []), { x, right: x + a.width, text: a.text }]);
      }
      for (const c of childrenOf(a)) visit(c, x, y);
    };
    visit(r.areaTree.sheets[0], 0, 0);
    const lines = [...rows.entries()].sort((p, q) => p[0] - q[0]).map(([, gs]) => gs.sort((p, q) => p.x - q.x));
    // 目次の 8 行 (番号は 1 行に 1 つ。割れていれば行が増える) の番号: 飛び先のページ (1 ページ目は目次) と、じかに書いた "10"
    const toc8 = lines.slice(0, 8);
    expect(toc8.map((gs) => gs.map((g) => g.text).join(''))).toEqual(['2', '10', '11', '13', '10', '10', '10', '10']);
    // 番号の右端は、どの行も容器の右端 (じかに書いた "10" の行と同じ位置) に揃う
    const right = (gs: Array<{ right: number }>) => gs[gs.length - 1].right;
    for (const gs of toc8) expect(right(gs)).toBeCloseTo(right(toc8[4]), 1);
  });
  it('入れ子が上限より深い HTML は、警告を出して組む (typeset の warnings)', async () => {
    const r = await typeset('<div>'.repeat(300) + '<p>x</p>' + '</div>'.repeat(300), { loadFont });
    expect(r.pageCount).toBe(1);
    expect(r.warnings.some((w) => w.includes('入れ子が深すぎます'))).toBe(true);
    const en = await typeset('<div>'.repeat(300) + '<p>x</p>' + '</div>'.repeat(300), { loadFont, lang: 'en' });
    expect(en.warnings.some((w) => w.includes('nested too deeply'))).toBe(true);
    expect((await typeset('<div><p>x</p></div>', { loadFont })).warnings.some((w) => w.includes('入れ子'))).toBe(false);
  });
  it('http(s) の CSS は取りに行く (fetchStyles。既定 true)。false なら取らずに警告。拡張子の無い CSS (css2?family=…) も CSS として読む', async () => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/css2')) {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('@import "/b.css"; h1 { color: #00ff00 }');
      } else if (req.url === '/b.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('h1 { font-size: 25pt }');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as { port: number }).port;
    try {
      const html = `<link rel="stylesheet" href="http://127.0.0.1:${port}/css2?family=Noto"><h1>H</h1>`;
      const glyph = (r: Awaited<ReturnType<typeof typeset>>) => {
        let g: GlyphArea | undefined;
        walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (g ??= a as GlyphArea)));
        return g!;
      };
      const on = await typeset(html, { loadFont });
      expect(glyph(on).color).toBe('#00ff00');
      expect(glyph(on).fontSize).toBeCloseTo(25, 3);
      const off = await typeset(html, { loadFont, fetchStyles: false });
      expect(glyph(off).color).not.toBe('#00ff00');
      expect(off.warnings.some((w) => /fetchStyles/.test(w))).toBe(true);
    } finally {
      server.close();
    }
  });
  it('fetchStyles・fetchImages の関数には、転送 (redirect) の先の URL も聞く。許されない先へは要求を出さない', async () => {
    const http = await import('node:http');
    const hits: string[] = [];
    const png = encodePngStored({ width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) });
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/public/a.css' || req.url === '/public/a.png') {
        // 許したパスが、許していないパス (内部のアドレスの代わり) へ転送する
        res.writeHead(302, { location: req.url.replace('/public/', '/internal/') });
        res.end();
      } else if (req.url === '/internal/a.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('h1 { color: #00ff00 }');
      } else if (req.url === '/internal/a.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const html = `<link rel="stylesheet" href="${base}/public/a.css"><h1>H</h1><img src="${base}/public/a.png">`;
      const color = (r: Awaited<ReturnType<typeof typeset>>) => {
        let g: GlyphArea | undefined;
        walkAreaTree(r.areaTree, (a) => void (a.type === 'glyph' && (g ??= a as GlyphArea)));
        return g!.color;
      };
      const allow = (u: string) => u.startsWith(`${base}/public/`);
      const guarded = await typeset(html, { loadFont, fetchStyles: allow, fetchImages: allow });
      expect(hits.filter((u) => u.startsWith('/internal/'))).toEqual([]);
      expect(color(guarded)).not.toBe('#00ff00');
      // 取れなかった CSS は、これまでの警告の経路で知らせる
      expect(guarded.warnings.some((w) => w.includes(`${base}/public/a.css`))).toBe(true);
      // 真偽の true (既定) なら、転送をたどって取る (これまでどおり)
      hits.length = 0;
      const open = await typeset(html, { loadFont });
      expect(color(open)).toBe('#00ff00');
      expect(hits.filter((u) => u.startsWith('/internal/')).sort()).toEqual(['/internal/a.css', '/internal/a.png']);
    } finally {
      server.close();
    }
  });
  it('XSL-FO を中身で見分けて組む (kind を省略)。typesetFo と同じ結果', async () => {
    const fo = `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set>
      <fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
      <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>あいう</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const a = await typeset(fo, { loadFont });
    const b = await typesetFo(fo, { loadFont });
    expect(a.pageCount).toBe(1);
    expect(textOf(a.areaTree)).toBe('あいう');
    expect(serializeAreaTree(a.areaTree)).toBe(serializeAreaTree(b.areaTree));
  });

  it('files の data は、使うときだけ呼ぶ関数でもよい (使わないファイルは読まない)', async () => {
    let read = 0;
    const r = await typesetHtml('<p>a</p>', {
      loadFont,
      files: [
        { name: 's.css', data: async () => (read++, 'p { color: red }') },
        { name: 'unused.png', data: async () => (read++, new Uint8Array()) },
      ],
    });
    expect(r.pageCount).toBe(1);
    // CSS は読む (利用者のスタイルシートとして足す)、文書に名前の出てこない画像は読まない
    expect(read).toBe(1);
    // Area Tree は JSON で読み書きできる
    expect(parseAreaTree(serializeAreaTree(r.areaTree)).sheets).toHaveLength(1);
  });

  it('toPdf の imageMaxDpi: 細かすぎる JPEG を縮めて PDF を小さくする', async () => {
    const w = 1200, h = 800;
    const data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) data.fill((i * 7) % 256, 3 * i, 3 * i + 3);
    const jpg = encodeJpeg({ width: w, height: h, components: 3, data }, { quantScale: 0.2 });
    const r = await typesetHtml('<img src="p.jpg" style="width: 1in">', { loadFont, files: [{ name: 'p.jpg', data: jpg }] });
    const full = await r.toPdf();
    const small = await r.toPdf({ imageMaxDpi: 150 });
    expect(full.length).toBeGreaterThan(jpg.length);
    expect(small.length).toBeLessThan(full.length - jpg.length / 2);
  });

  it('toPdf の pdfx: RGB の色・画像を CMYK にして書く (灰色は DeviceGray のまま)', async () => {
    const w = 8, h = 8;
    const data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) data.set([200, 40, (i * 30) % 256], 3 * i);
    const jpg = encodeJpeg({ width: w, height: h, components: 3, data }, { quantScale: 0.5 });
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([0, 128, 255, 255], 4 * i);
    const png = encodePngStored({ width: w, height: h, rgba });
    const html = '<p style="color: #c03020; background: #2060c0">色の字</p><p style="color: #333">灰色の字</p><img src="p.jpg" style="width: 1in"><img src="q.png" style="width: 1in">';
    const r = await typesetHtml(html, { loadFont, files: [{ name: 'p.jpg', data: jpg }, { name: 'q.png', data: png }] });
    const warnings: string[] = [];
    const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { warnings } }), { updateMetadata: false });
    const { decodePDFRawStream, PDFRawStream, PDFName: Name } = await import('pdf-lib');
    const streams: string[] = [];
    const spaces: string[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (String(dict.get(Name.of('Subtype'))) === '/Image') spaces.push(String(dict.get(Name.of('ColorSpace'))));
      else if (!dict.get(Name.of('Subtype')) && !dict.get(Name.of('Length1'))) {
        try {
          streams.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
        } catch {
          /* 書体などの読めないストリーム */
        }
      }
    }
    const content = streams.join('\n');
    // 色は k / K (CMYK) と g (灰色) で、rg / RG (RGB) は使わない
    expect(content).toMatch(/ k\b/);
    expect(content).not.toMatch(/\d rg\b|\d RG\b/);
    // 色のある画像は DeviceCMYK
    expect(spaces.filter((c) => c === '/DeviceCMYK').length).toBe(2);
    expect(warnings).toEqual([]);
  });

  it('toPdf の pdfx に CMYK の ICC プロファイルを渡すと、その表 (BToA) で RGB を CMYK にする。読めない表なら警告して式で変換', async () => {
    // どの色も C 0.1・M 0.2・Y 0.3・K 0.4 にする表 (lut16Type・格子 2 点)
    const u16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 255, x & 255]);
    const u32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
    const lin = u16(0, 65535);
    const clut = Array.from({ length: 8 }, () => u16(6554, 13107, 19661, 26214)).flat();
    const body = [...Array.from('mft2', (c) => c.charCodeAt(0)), 0, 0, 0, 0, 3, 4, 2, 0, ...u32(65536, 0, 0, 0, 65536, 0, 0, 0, 65536), ...u16(2, 2), ...lin, ...lin, ...lin, ...clut, ...lin, ...lin, ...lin, ...lin];
    const head = new Array(128).fill(0);
    const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
    put(12, 'prtr');
    put(16, 'CMYK');
    put(20, 'Lab ');
    put(36, 'acsp');
    const profile = Uint8Array.from([...head, ...u32(1), ...Array.from('B2A1', (c) => c.charCodeAt(0)), ...u32(144, body.length), ...body]);
    const r = await typesetHtml('<p style="color: #c03020">色の字</p>', { loadFont });
    const contentOf = async (bytes: Uint8Array) => {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const { decodePDFRawStream, PDFRawStream, PDFName: Name } = await import('pdf-lib');
      const out: string[] = [];
      for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream) || obj.dict.get(Name.of('Subtype')) || obj.dict.get(Name.of('Length1')) || obj.dict.get(Name.of('N'))) continue;
        try {
          out.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
        } catch {
          /* 書体などの読めないストリーム */
        }
      }
      return out.join('\n');
    };
    const warnings: string[] = [];
    expect(await contentOf(await r.toPdf({ pdfx: { profile, warnings } }))).toMatch(/0\.1 0\.2 0\.3 0\.4 k/);
    expect(warnings).toEqual([]);
    // 表の無いプロファイル: 式で変換して、警告する
    const bad = Uint8Array.from([...head, ...u32(0)]);
    const w2: string[] = [];
    expect(await contentOf(await r.toPdf({ pdfx: { profile: bad, warnings: w2 } }))).not.toMatch(/0\.1 0\.2 0\.3 0\.4 k/);
    expect(w2.some((w) => w.includes('ICC'))).toBe(true);
  });

  it('createTypesetter: 書体を 1 度だけ読み、何度組んでも typeset と同じ結果', async () => {
    const calls = new Map<string, number>();
    const counting = async (spec: FontSpec) => {
      const k = `${spec.family}|${spec.weight ?? 400}`;
      calls.set(k, (calls.get(k) ?? 0) + 1);
      return loadFont(spec);
    };
    const t = await createTypesetter({ loadFont: counting });
    const css = '@page { size: A6; margin: 10mm }';
    const a = await t.typeset('<h1>一つ目</h1><p>本文</p>', { kind: 'html', files: [{ name: 'p.css', data: css }] });
    const b = await t.typeset('<p>二つ目の文書。<code>mono</code></p>', { kind: 'html', files: [{ name: 'p.css', data: css }] });
    const c = await t.typeset('<p>二つ目の文書。<code>mono</code></p>', { kind: 'html', files: [{ name: 'p.css', data: css }] });
    expect(textOf(a.areaTree)).toContain('一つ目');
    expect(textOf(b.areaTree)).toContain('二つ目');
    // どの書体も 1 度だけ読む (等幅の書体は、使う文書を初めて組むときに読む)
    expect(Math.max(...calls.values())).toBe(1);
    expect(DEFAULT_FONTS.mono.some((m) => calls.has(`${m.family}|${m.weight ?? 400}`))).toBe(true);
    // 同じ文書は、毎回 typeset するのと同じに組める
    const ref = await typeset('<p>二つ目の文書。<code>mono</code></p>', { kind: 'html', files: [{ name: 'p.css', data: css }], loadFont });
    expect(serializeAreaTree(c.areaTree)).toBe(serializeAreaTree(ref.areaTree));
    expect(serializeAreaTree(b.areaTree)).toBe(serializeAreaTree(ref.areaTree));
  });

  it('createTypesetter: fonts の書体を font-family から使う。TTC (書体の集まり) は中の書体をそれぞれ登録する', async () => {
    const t = await createTypesetter({ loadFont, fonts: [{ name: 'cousine.ttc', data: makeTtc([fs.readFileSync(path.join(fontDir, 'Cousine-Regular.ttf')), fs.readFileSync(path.join(fontDir, 'Cousine-Bold.ttf'))]) }] });
    const r = await t.typeset('<p style="font-family: Cousine">a<b>b</b></p>', { kind: 'html' });
    expect(r.warnings.filter((w) => /cousine\.ttc/.test(w))).toEqual([]);
    const got: string[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'glyph' && /[ab]/.test((a as GlyphArea).text)) got.push(`${(a as GlyphArea).text}:${(a as GlyphArea).fontFamily}:${(a as GlyphArea).fontWeight}`);
    });
    expect(got).toEqual(['a:Cousine:400', 'b:Cousine:700']);
    // FO の font-family でも使う
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Cousine">a<fo:inline font-weight="bold">b</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const f = await t.typeset(fo, { kind: 'fo' });
    const got2: string[] = [];
    walkAreaTree(f.areaTree, (a) => {
      if (a.type === 'glyph') got2.push(`${(a as GlyphArea).text}:${(a as GlyphArea).fontFamily}:${(a as GlyphArea).fontWeight}`);
    });
    expect(got2).toEqual(['a:Cousine:400', 'b:Cousine:700']);
  });

  it('font-family の並びの先頭の書体 (@font-face) に無い和字は、並びの後ろの読み込んだ書体で組む (CSS Fonts 4 §5)', async () => {
    const css = '@font-face { font-family: lat; src: url(Arimo-Regular.ttf) } @font-face { font-family: myjp; src: url(NotoSansJP-Regular.ttf) } p { font-family: lat, myjp }';
    const files = ['Arimo-Regular.ttf', 'NotoSansJP-Regular.ttf'].map((n) => ({ name: n, data: fs.readFileSync(path.join(fontDir, n)) }));
    const r = await typesetHtml('<!DOCTYPE html><p lang="ja">a字</p>', { loadFont, files: [{ name: 'c.css', data: css }, ...files] });
    const got: Record<string, string> = {};
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'glyph') got[(a as GlyphArea).text] = (a as GlyphArea).fontFamily;
    });
    expect(got['a']).toMatch(/lat/);
    // 既定の和文の書体 (Noto Serif JP) でなく、並びの後ろの myjp
    expect(got['字']).toMatch(/myjp/);
  });

  it('アンテナハウス互換: lang="ja" の行の基準線は、和文の字の書体の上下で決める (既定は最初に使える書体。CSS Inline 3 §5.3)', async () => {
    // OS/2 の typo の上下を 750・−250 (ちょうど 1em。基準線の比 0.75) に書き換えた欧文の書体
    const buf = typo1emArimo();
    const css = '@font-face { font-family: lat; src: url(lat.ttf) } @font-face { font-family: myjp; src: url(NotoSansJP-Regular.ttf) } body { margin: 0 } p { margin: 0; font: 10pt/20pt lat, myjp }';
    const files = [{ name: 'c.css', data: css }, { name: 'lat.ttf', data: buf }, { name: 'NotoSansJP-Regular.ttf', data: fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')) }];
    const baseline = async (style?: 'ah') => {
      const r = await typesetHtml('<!DOCTYPE html><p lang="ja">字字</p>', { loadFont, files, ...(style ? { style } : {}) });
      let y = NaN;
      walkAreaTree(r.areaTree, (a) => {
        if (a.type === 'glyph' && (a as GlyphArea).text === '字' && Number.isNaN(y)) y = (a as GlyphArea).y + (a as GlyphArea).baselineY;
      });
      return y;
    };
    const plain = await baseline();
    const ah = await baseline('ah');
    // 既定: 最初に使える書体 (lat、比 0.75)。互換: 和文の字の書体 (Noto Sans JP、比 0.88) で、基準線が 1.3pt 下がる
    expect(ah - plain).toBeCloseTo((0.88 - 0.75) * 10, 1);
  });

  it('ルビの親文字が代わりの書体の字でも、行の高さは最初に使える書体の上下で決める (字と同じ。CSS Inline 3 §5.3)', async () => {
    const css = '@font-face { font-family: lat; src: url(lat.ttf) } @font-face { font-family: myjp; src: url(NotoSansJP-Regular.ttf) } body { margin: 0 } p { margin: 0; font: 10pt/20pt lat, myjp }';
    const files = [{ name: 'c.css', data: css }, { name: 'lat.ttf', data: typo1emArimo() }, { name: 'NotoSansJP-Regular.ttf', data: fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')) }];
    const secondY = async (first: string) => {
      const r = await typesetHtml(`<!DOCTYPE html><p>${first}</p><p>後</p>`, { loadFont, files });
      // 領域の位置は親からの相対位置なので、親をたどって足す
      const abs = new Map<unknown, number>();
      let y = NaN;
      walkAreaTree(r.areaTree, (a, parent) => {
        const top = (parent ? (abs.get(parent) ?? 0) : 0) + ((a as { y?: number }).y ?? 0);
        abs.set(a, top);
        if (a.type === 'glyph' && (a as GlyphArea).text === '後') y = top + (a as GlyphArea).baselineY;
      });
      return y;
    };
    // ルビ (行間に収まる大きさ) のある行も、ルビの無い行と同じ高さ
    expect(await secondY('字<ruby>字<rt>じ</rt></ruby>')).toBeCloseTo(await secondY('字字'), 2);
  });

  it('display: block の画像の行は画像の高さ (行内の箱の高さに line-height を使わない。CSS 2.1 §10.8.1)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>';
    const css = '@page { size: A6; margin: 10mm } body { font-size: 9.5pt; line-height: 13pt; margin: 0 } p { margin: 0 }';
    const r = await typesetHtml('<p>Antenna House<img src="a.svg" style="display: block; height: 9pt"/>Formatter</p>', { files: [{ name: 'c.css', data: css }, { name: 'a.svg', data: svg }], loadFont });
    const hits: Array<{ type: string; y: number; h: number }> = [];
    const go = (a: { type: string; y?: number; height?: number; children?: unknown[] }, y: number) => {
      const ny = y + (a.y ?? 0);
      if (a.type === 'line' || a.type === 'image') hits.push({ type: a.type, y: ny, h: a.height ?? 0 });
      for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
    };
    go(r.areaTree.sheets[0].page.regionBody as never, 0);
    const img = hits.find((h) => h.type === 'image')!;
    const lines = hits.filter((h) => h.type === 'line');
    // 画像の行は 9pt、画像はその上端に置かれ、次の行は画像の下端から始まる
    const imgLine = lines.find((l) => Math.abs(l.y - img.y) < 0.01)!;
    expect(imgLine.h).toBeCloseTo(9, 2);
    expect(lines.some((l) => Math.abs(l.y - (img.y + 9)) < 0.01)).toBe(true);
  });

  it('強制改行 (br) の後の行頭の空白は取り除く (CSS Text 3 §4.1.2)。pre では残す', async () => {
    const css = '@page { size: A6; margin: 10mm } body { margin: 0 } p, pre { margin: 0 }';
    const r = await typesetHtml('<p>Antenna<br /> House</p><pre>a\n  b</pre>', { files: [{ name: 'c.css', data: css }], loadFont });
    const lines: string[] = [];
    const go = (a: { type: string; text?: string; children?: unknown[] }, acc: string[] | null) => {
      if (a.type === 'line') {
        const t: string[] = [];
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, t);
        lines.push(t.join(''));
        return;
      }
      if (a.type === 'glyph' && acc) acc.push(a.text ?? '');
      for (const c of (a.children ?? []) as (typeof a)[]) go(c, acc);
    };
    go(r.areaTree.sheets[0].page.regionBody as never, null);
    expect(lines.slice(0, 4)).toEqual(['Antenna', 'House', 'a', '  b']);
  });

  it('-ah-display-align: center の高さの決まった float は、中身を上下の中央に置く', async () => {
    const css = '@page { size: A6; margin: 10mm } body { margin: 0; font-size: 9.5pt } p { margin: 0 } span.f { float: left; height: 30pt; line-height: 10pt }';
    const top = async (extra: string) => {
      const r = await typesetHtml('<p><span class="f">A<br />B</span>x</p>', { files: [{ name: 'c.css', data: css + extra }], loadFont });
      let y: number | undefined;
      const go = (a: { type: string; y?: number; text?: string; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text === 'A' && y === undefined) y = ny;
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return y!;
    };
    // 2 行 (20pt) を 30pt の中の中央に置くので、5pt 下がる
    expect((await top(' span.f { -ah-display-align: center }')) - (await top(''))).toBeCloseTo(5, 2);
  });

  it('float のある縦書きの箱 (横書きの親と直交) の margin-top は、箱の上に空ける (右にずらさない)', async () => {
    const css = '@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt } div.v { writing-mode: vertical-rl; height: 10em; margin-top: 1em; border: solid 1pt green } div.f { float: before; border: solid 1pt orange }';
    const r = await typesetHtml('<div class="v"><div class="f"><p>前</p></div><p>本文の段落です。</p></div>', { files: [{ name: 'c.css', data: css }], loadFont });
    const body = r.areaTree.sheets[0].page.regionBody as unknown as { x: number; y: number; children: Array<{ x: number; y: number; children?: Array<{ x: number; y: number }> }> };
    // 箱 (枠のあるもの) を探す
    const find = (a: { x?: number; y?: number; border?: { top?: { width: number } }; children?: unknown[] }, x: number, y: number): { x: number; y: number } | undefined => {
      const nx = x + (a.x ?? 0);
      const ny = y + (a.y ?? 0);
      if ((a.border?.top?.width ?? 0) > 0) return { x: nx, y: ny };
      for (const c of (a.children ?? []) as (typeof a)[]) {
        const hit = find(c, nx, ny);
        if (hit) return hit;
      }
      return undefined;
    };
    const box = find(body as never, 0, 0)!;
    expect(box.x).toBeCloseTo(body.x, 2);
    expect(box.y - body.y).toBeCloseTo(10, 2);
  });

  it('collapse の表の外枠の罫線: 仕様では半分が余白へはみ出し、アンテナハウス互換では表全体を内側に置く', async () => {
    const cellX = async (style: 'browser' | 'ah', bw: number) => {
      const css = `@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } table { border-collapse: collapse; border: solid ${bw}pt black; margin: 10pt 0 0 20pt } td { border: solid ${bw}pt black; padding: 0 }`;
      const r = await typesetHtml('<table><tr><td>A</td></tr></table>', { style, files: [{ name: 'c.css', data: css }], loadFont });
      let x: number | undefined;
      // 子の位置は、親の内容の箱 (罫線・padding の内側) からの位置
      const go = (a: { type: string; x?: number; text?: string; padding?: { left?: number }; border?: { left?: { width: number } }; children?: unknown[] }, ox: number) => {
        const nx = ox + (a.x ?? 0);
        if (a.type === 'glyph' && a.text === 'A' && x === undefined) x = nx;
        const cx = nx + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, cx);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return x!;
    };
    // 罫線を 2pt 太くすると、互換では線全体 (2pt) だけ中身が右へ動く (仕様では、外へ出る半分は余白に重なるので内側の半分だけ)
    expect((await cellX('browser', 4)) - (await cellX('browser', 2))).toBeCloseTo(1, 0);
    expect((await cellX('ah', 4)) - (await cellX('ah', 2))).toBeCloseTo(2, 0);
  });

  it('左右の余白が auto の collapse の表 (幅は中身から): アンテナハウス互換でも、外枠の罫線の外側までを中央に置く', async () => {
    const cellX = async (style: 'browser' | 'ah') => {
      const css = '@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } table { border-collapse: collapse; border: solid 4pt black; margin: 0 auto } td { border: solid 4pt black; padding: 0 }';
      const r = await typesetHtml('<table><tr><td>A</td></tr></table>', { style, files: [{ name: 'c.css', data: css }], loadFont });
      let x: number | undefined;
      const go = (a: { type: string; x?: number; text?: string; padding?: { left?: number }; border?: { left?: { width: number } }; children?: unknown[] }, ox: number) => {
        const nx = ox + (a.x ?? 0);
        if (a.type === 'glyph' && a.text === 'A' && x === undefined) x = nx;
        const cx = nx + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, cx);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return x!;
    };
    // 仕様では罫線の中心の線までの箱を中央に置き、外へ出る半分は左右に同じだけ出る。互換では線全体を内側に置き、
    // 罫線の外側までを中央に置く。どちらも中身の位置は同じ (以前は互換で、外へ出る半分 (2pt) だけ右にずれていた)
    expect(await cellX('ah')).toBeCloseTo(await cellX('browser'), 1);
  });

  it('左右の余白が auto の collapse の表: 列の幅 (col の width) を罫線の分だけ縮めない', async () => {
    const css = '@page { size: A4; margin: 10mm } body { margin: 0 } table { border-collapse: collapse; table-layout: fixed; border: 1pt solid black; margin: 0 auto } col.a { width: 100pt } col.b { width: 200pt } td { border: 0.5pt solid black; padding: 0 }';
    const r = await typesetHtml('<table><colgroup><col class="a"/><col class="b"/></colgroup><tr><td>A</td><td>B</td></tr></table>', { files: [{ name: 'c.css', data: css }], loadFont });
    const cells: number[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'table-cell') cells.push((a as unknown as { width: number }).width);
    });
    expect(cells.map((w) => Math.round(w * 100) / 100)).toEqual([100, 200]);
  });

  it('行グリッドの中の keep (break-before: avoid) の判定: 最後の行の下の半行間を数えず、本番と同じくグリッドに揃えて試す', async () => {
    // 高さ 100pt の領域に、字 9pt・行送り 15pt の行グリッド。5 行の後に、分けない 2 行 (見出し + 説明) が来る。
    // 7 行目は字の下端 (約 99pt) で入り、行の下の半行間まで数えると入らない。グリッドの最後の行の下の半行間は空けないので、2 行とも入る
    const css = '@page { size: 200pt 160pt; margin: 30pt 10pt } body { margin: 0; font-size: 9pt; line-height: 15pt } div { -ah-baseline-grid: new } p { margin: 0 } .g { break-before: avoid }';
    const ps = Array.from({ length: 5 }, (_, k) => `<p>L${k}</p>`).join('');
    const r = await typesetHtml(`<div>${ps}<p>H</p><p class="g">G</p></div>`, { style: 'ah', files: [{ name: 'c.css', data: css }], loadFont });
    const onFirst = new Set<string>();
    const go = (a: { type: string; text?: string; children?: unknown[] }) => {
      if (a.type === 'glyph' && a.text) onFirst.add(a.text);
      for (const c of (a.children ?? []) as (typeof a)[]) go(c);
    };
    go(r.areaTree.sheets[0].page.regionBody as never);
    expect(onFirst.has('H') && onFirst.has('G')).toBe(true);
  });

  it('-ah-display-align: after (アンテナハウスの拡張): 高さの決まったブロックの中身を下端に寄せる', async () => {
    const y = async (da: string) => {
      const css = `@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } .b { height: 200pt;${da} }`;
      const r = await typesetHtml('<!DOCTYPE html><div class="b">A</div>', { style: 'ah', files: [{ name: 'c.css', data: css }], loadFont, css: [css] } as never);
      let at: number | undefined;
      const go = (a: { type: string; y?: number; text?: string; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text === 'A' && at === undefined) at = ny;
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return at!;
    };
    const top = await y('');
    expect((await y(' -ah-display-align: after')) - top).toBeGreaterThan(150);
    expect((await y(' -ah-display-align: center')) - top).toBeGreaterThan(75);
  });

  it('float: multicol top (アンテナハウスの拡張) の width: 1gr は、box-sizing: border-box なら罫線・内側の余白込みで段の幅', async () => {
    const width = async (bs: string) => {
      const css = `@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt } .m { columns: 3; column-gap: 12pt } .f { float: multicol top; width: 1gr; border: solid 2pt black; padding: 3pt; box-sizing: ${bs} }`;
      const r = await typesetHtml('<!DOCTYPE html><div class="m"><div class="f">F</div><p>' + 'text '.repeat(80) + '</p></div>', { style: 'ah', files: [{ name: 'c.css', data: css }], loadFont, css: [css] } as never);
      let w: number | undefined;
      walkAreaTree(r.areaTree, (a) => {
        const b = a as unknown as { type: string; width: number; border?: { top?: unknown } };
        if (w === undefined && b.type === 'block' && b.border?.top) w = b.width;
      });
      return w!;
    };
    // 本文の幅 (A5 − 20mm ≒ 363.0pt) から、段の幅 = (363.0 − 2 × 12) / 3 ≒ 113.0pt
    const col = (148 * 72 / 25.4 - 20 * 72 / 25.4 - 24) / 3;
    expect(await width('border-box')).toBeCloseTo(col, 0);
    expect(await width('content-box')).toBeCloseTo(col + 10, 0);
  });

  it('表の下の見出し (caption-side: bottom) も、上の見出しと同じく表の幅の中央に置く (collapse の外枠のはみ出しを足す前の幅)', async () => {
    const capX = async (side: string) => {
      const css = `body{margin:0;font-size:10pt} table{border-collapse:collapse;border:solid 0.85pt black;margin:0 auto;caption-side:${side}} td{border:solid 0.85pt black;padding:2pt}`;
      const r = await typesetHtml(`<!DOCTYPE html><table><caption>Cap</caption><tr><td>A</td><td>BBBBB</td></tr></table>`, { style: 'ah', loadFont, css: [css] } as never);
      let x: number | undefined;
      const go = (a: { type: string; x?: number; text?: string; padding?: { left?: number }; border?: { left?: { width: number } }; children?: unknown[] }, ox: number) => {
        const nx = ox + (a.x ?? 0);
        if (a.type === 'glyph' && a.text === 'C' && x === undefined) x = nx;
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, nx + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0));
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return x!;
    };
    expect(await capX('bottom')).toBeCloseTo(await capX('top'), 2);
  });

  it('行内の要素の float (float: sidenote など) にも text-indent を渡す。@sidenote の width は箱 (内側の余白込み) の幅', async () => {
    const css = '@page { size: A5; margin: 10mm; @sidenote { float: left; width: 30% } } body { margin: 0; font-size: 10pt } p { text-indent: 2em; margin: 0 } .s { float: sidenote; text-indent: 0; padding: 0 5pt }';
    const r = await typesetHtml('<!DOCTYPE html><p>Body text<span class="s">SIDE note</span> continues here.</p>', { style: 'ah', files: [{ name: 'c.css', data: css }], loadFont, css: [css] } as never);
    const xs: Record<string, number> = {};
    const go = (a: { type: string; x?: number; text?: string; padding?: { left?: number }; border?: { left?: { width: number } }; children?: unknown[] }, ox: number) => {
      const nx = ox + (a.x ?? 0);
      if (a.type === 'glyph' && a.text && !(a.text in xs)) xs[a.text] = nx;
      for (const c of (a.children ?? []) as (typeof a)[]) go(c, nx + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0));
    };
    go(r.areaTree.sheets[0].page.regionBody as never, 0);
    const m = 10 * 72 / 25.4; // 座標はページの左上から (余白 10mm を含む)
    const body = 148 * 72 / 25.4 - 2 * m;
    // 傍注は字下げせず、内側の余白 5pt の内から始まる
    expect(xs.S - m).toBeCloseTo(5, 0);
    // 本文は傍注の箱 (内側の余白込みで本文の幅の 30%) の右から、字下げ 2em を空けて始まる
    expect(xs.B - m).toBeCloseTo(body * 0.3 + 20, 0);
  });

  it('表の行 (tr) に付けた font-size を、その行のセル (と中の入れ子の表) に受け継ぐ', async () => {
    const css = 'body { font-size: 10pt } .r { font-size: 0.8em }';
    const r = await typesetHtml('<!DOCTYPE html><table><tr class="r"><td>A<table><tr><td>B</td></tr></table></td></tr><tr><td>C</td></tr></table>', { files: [{ name: 'c.css', data: css }], loadFont, css: [css] } as never);
    const size: Record<string, number> = {};
    walkAreaTree(r.areaTree, (a) => {
      const g = a as unknown as { type: string; text?: string; fontSize: number };
      if (g.type === 'glyph' && g.text && !(g.text in size)) size[g.text] = g.fontSize;
    });
    expect(size.A).toBeCloseTo(8, 1);
    expect(size.B).toBeCloseTo(8, 1);
    expect(size.C).toBeCloseTo(10, 1);
  });

  it('段組の最初の段の頭の、最初の子の上の余白: 仕様では残り、アンテナハウス互換では捨てる', async () => {
    const top = async (style: 'browser' | 'ah') => {
      const css = '@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 12pt } div { columns: 2; column-fill: auto; height: 100pt } p { margin: 10pt 0 0 }';
      const r = await typesetHtml('<div><p>A</p></div>', { style, files: [{ name: 'c.css', data: css }], loadFont });
      let y: number | undefined;
      const go = (a: { type: string; y?: number; text?: string; baselineY?: number; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text === 'A' && y === undefined) y = ny + (a.baselineY ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return y!;
    };
    expect((await top('browser')) - (await top('ah'))).toBeCloseTo(10, 1);
  });

  it('行をまたぐセルの中央寄せ: 仕様ではまたいだ行の真ん中、アンテナハウス互換では行の間の間隔を除いた高さの真ん中', async () => {
    const lift = async (style: 'browser' | 'ah') => {
      const css = '@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } table { border-spacing: 6pt } tr { height: 30pt } td { padding: 0; border: 0; vertical-align: middle }';
      const html = '<table><tr><td rowspan="3">A</td><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td></tr></table>';
      const r = await typesetHtml(html, { style, files: [{ name: 'c.css', data: css }], loadFont });
      const ys: Record<string, number> = {};
      const go = (a: { type: string; y?: number; text?: string; baselineY?: number; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text && !(a.text in ys)) ys[a.text] = ny + (a.baselineY ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      // 真ん中の行の C より、どれだけ上にあるか
      console.log(style, JSON.stringify(ys));
      return ys.C - ys.A;
    };
    expect(await lift('browser')).toBeCloseTo(0, 1);
    // 間隔 6pt × 2 の半分だけ上
    expect(await lift('ah')).toBeCloseTo(6, 1);
  });

  it('vertical-align: super の上げ幅: 既定は親の字の大きさの 0.35、アンテナハウス互換では 1/3 (脚注の参照番号も)', async () => {
    const rise = async (style: 'browser' | 'ah', html: string, ch: string) => {
      const css = '@page { size: A6; margin: 10mm; @footnote { } } body { margin: 0; font-size: 12pt } .fn { float: footnote }';
      const r = await typesetHtml(html, { style, files: [{ name: 'c.css', data: css }], loadFont });
      const ys: Record<string, number> = {};
      // 字の基線の位置 (glyph area の y と、その中の基線の位置)
      const go = (a: { type: string; y?: number; text?: string; baselineY?: number; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text && !(a.text in ys)) ys[a.text] = ny + (a.baselineY ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, ny);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return ys.A - ys[ch];
    };
    expect(await rise('browser', '<p>A<sup>B</sup></p>', 'B')).toBeCloseTo(12 * 0.35, 1);
    expect(await rise('ah', '<p>A<sup>B</sup></p>', 'B')).toBeCloseTo(4, 1);
    expect(await rise('ah', '<p>A<span class="fn">x</span></p>', '1')).toBeCloseTo(4, 1);
  });

  it('hanging-punctuation: first: 段落の 1 行目の行頭の始め括弧類を、字下げの中へぶら下げる (CSS Text 3 §8.2.1)', async () => {
    const xs = async (hang: boolean) => {
      const css = `@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } p { margin: 0; text-indent: 1em; text-spacing-trim: space-all;${hang ? ' hanging-punctuation: first;' : ''} }`;
      const r = await typesetHtml('<p>「あ」</p><p>い「う」</p>', { files: [{ name: 'c.css', data: css }], loadFont });
      const out: Record<string, number> = {};
      const go = (a: { type: string; x?: number; text?: string; padding?: { left?: number }; border?: { left?: { width: number } }; children?: unknown[] }, ox: number) => {
        const nx = ox + (a.x ?? 0);
        if (a.type === 'glyph' && a.text && !(a.text in out)) out[a.text] = nx;
        const cx = nx + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, cx);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return out;
    };
    const plain = await xs(false);
    const hung = await xs(true);
    // ぶら下げないときは「が字下げの位置に、ぶら下げると「は 1 字分前 (行の始まり) へ出て、あが字下げの位置に来る
    // (座標はページの左端から。本文の領域は余白 10mm の内側)
    const left = (10 * 72) / 25.4;
    expect(plain['「'] - left).toBeCloseTo(10, 1);
    expect(hung['「'] - left).toBeCloseTo(0, 1);
    expect(hung['あ'] - left).toBeCloseTo(10, 1);
    // 行の途中の「は動かない (2 つ目の段落の い の後ろ)
    expect(hung['う'] - hung['い']).toBeCloseTo(plain['う'] - plain['い'], 1);
  });

  it('縦書きの行の inline-block の上下の余白は、行の中の空き (CSS 2.1 §10.3.9。縦中横を margin-top: 0.15em で下げる)', async () => {
    const ys = async (margin: string) => {
      const css = `@page { size: A6; margin: 10mm } body { margin: 0; font-size: 10pt } div { writing-mode: vertical-rl; height: 20em; line-height: 1.2 } p { margin: 0 }
        span { display: inline-block; writing-mode: horizontal-tb; line-height: 1; ${margin} }`;
      const r = await typesetHtml('<div><p>あ<span>12</span>年</p></div>', { files: [{ name: 'c.css', data: css }], loadFont });
      const out: Record<string, number> = {};
      const go = (a: { type: string; y?: number; text?: string; padding?: { top?: number }; border?: { top?: { width: number } }; children?: unknown[] }, oy: number) => {
        const ny = oy + (a.y ?? 0);
        if (a.type === 'glyph' && a.text && !(a.text in out)) out[a.text] = ny;
        const cy = ny + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0);
        for (const c of (a.children ?? []) as (typeof a)[]) go(c, cy);
      };
      go(r.areaTree.sheets[0].page.regionBody as never, 0);
      return out;
    };
    const plain = await ys('');
    const moved = await ys('margin-top: 0.15em; margin-bottom: -0.15em');
    // 数字は 0.15em (1.5pt) 下がり、送りは同じ (次の字の位置は変わらない)
    expect(moved['1'] - plain['1']).toBeCloseTo(1.5, 1);
    expect(moved['年']).toBeCloseTo(plain['年'], 1);
    // 上の余白だけなら、次の字もその分下がる
    const spaced = await ys('margin-top: 0.5em');
    expect(spaced['年'] - plain['年']).toBeCloseTo(5, 1);
  });

  it('書体を読めなければ、その名前を挙げた例外', async () => {
    await expect(typesetHtml('<p>a</p>', { loadFont: async () => undefined, fetchTimeoutMs: 1 })).rejects.toThrow(/書体を読めません/);
  });
});
