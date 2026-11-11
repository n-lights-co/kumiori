/**
 * 文書の外へのリンクのうち、PDF に動作を書くもの (HTM-20。src/linkPolicy.ts)。
 * 既定では http・https・mailto・tel の URL と相対の PDF (GoToR) だけを書き、ほか (javascript: など・Launch) は字だけを組んで警告する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { cleanUrl, judgeExternalLink, urlScheme } from '../src/linkPolicy';
import { DEFAULT_FONTS, parseAreaTree, serializeAreaTree, typeset } from '../src/index';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf } from '../src/pdfRenderer';
import { parseArgs, UsageError } from '../src/cli';
import { ensureFonts, loadCachedFont, makeEngine } from './helpers';

// 既定の書体は置き場 (.cache/fonts) から読む。無ければ、テストの前に 1 度だけ取得して置く (helpers の ensureFonts)
const loadFont = loadCachedFont;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
/** PDF の中の動作 (/S /名前) の並び。圧縮していない PDF の文字から拾う */
const actionsOf = async (bytes: Uint8Array) => {
  const pdf = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    const s = String(obj);
    for (const m of s.matchAll(/\/S \/(URI|GoToR|Launch|JavaScript|SubmitForm)\b[^>]*/g)) out.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return out;
};

describe('リンクの判定 (linkPolicy)', () => {
  it('スキームは、ブラウザと同じ前処理 (前後の空白・制御文字と、タブ・改行を取り除く。WHATWG URL §4.4) の後の文字列で読む', () => {
    expect(cleanUrl(' \u0001java\tscr\nipt:\ralert(1) \u0000')).toBe('javascript:alert(1)');
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:x', '\u0001javascript:x', 'java\tscript:x', 'java\nscr\ript:x', 'javascript\n:x']) {
      expect(urlScheme(u), JSON.stringify(u)).toBe('javascript');
      expect(judgeExternalLink(u)).toMatchObject({ kind: 'uri', allowed: false, reason: 'javascript:' });
    }
    // Node の URL (WHATWG URL の実装) と同じ見え方
    for (const u of ['java\tscript:x', ' \u0001JAVASCRIPT:x', 'https://example.com/', 'mailto:a@example.com', 'a+b.c-d:x']) expect(urlScheme(u) + ':').toBe(new URL(u).protocol);
    // スキームでないもの (途中の空白・英字で始まらない・: が無い)
    for (const u of ['java script:x', '1a:x', 'a/b:c', './a:b', 'file.pdf', '#x', '?q=a:b']) expect(urlScheme(u), u).toBeUndefined();
  });

  it('既定: http・https・mailto・tel と相対の PDF だけを通す', () => {
    const ok = (u: string) => judgeExternalLink(u).allowed;
    expect(['http://example.com/', 'HTTPS://example.com/a?b#c', 'mailto:a@example.com', 'tel:+81-3-0000-0000', 'other.pdf', '../a/b.pdf#page=2', 'dir/a%20b.PDF?x=1'].map(ok)).toEqual([true, true, true, true, true, true, true]);
    const reason = (u: string) => judgeExternalLink(u).reason;
    expect(reason('javascript:alert(1)')).toBe('javascript:');
    expect(reason('data:text/html,<script>alert(1)</script>')).toBe('data:');
    expect(reason('file:///etc/passwd')).toBe('file:');
    expect(reason('vbscript:x')).toBe('vbscript:');
    expect(reason('ftp://example.com/a.pdf')).toBe('ftp:');
    // Windows のドライブの絶対パスは、1 字のスキームとして落ちる
    expect(reason('C:\\Windows\\system32\\calc.exe')).toBe('c:');
    // PDF でない相対のファイルは Launch
    expect(judgeExternalLink('x.exe')).toMatchObject({ kind: 'launch', allowed: false, reason: 'Launch' });
    expect(reason('doc/memo.docx')).toBe('Launch');
    expect(reason('\\\\host\\share\\x.exe')).toBe('Launch');
    // 絶対パスの PDF (%xx で書いたものも) は GoToR にしない
    for (const u of ['/etc/a.pdf', '\\\\host\\share\\a.pdf', '%2Fetc%2Fa.pdf', '%5C%5Chost%5Ca.pdf', 'c%3A/a.pdf']) expect(judgeExternalLink(u), u).toMatchObject({ kind: 'gotor', allowed: false });
    // スキームの無い //host/… は、ファイルを開く動作と同じ扱い
    expect(judgeExternalLink('//example.com/x')).toMatchObject({ kind: 'uri', allowed: false, reason: '//host' });
    expect(judgeExternalLink(' /\t/example.com/x')).toMatchObject({ kind: 'uri', allowed: false });
  });

  it('設定: schemes は既定の一覧と置き換わる (* はすべて)。launch で、ファイルを開く動作を通す', () => {
    expect(judgeExternalLink('ftp://example.com/', { schemes: ['FTP:'] }).allowed).toBe(true);
    expect(judgeExternalLink('https://example.com/', { schemes: ['ftp'] }).allowed).toBe(false);
    expect(judgeExternalLink('javascript:x', { schemes: ['*'] }).allowed).toBe(true);
    expect(judgeExternalLink('x.exe', { schemes: ['*'] }).allowed).toBe(false);
    expect(judgeExternalLink('javascript:x', { launch: true }).allowed).toBe(false);
    for (const u of ['x.exe', '/etc/a.pdf', '//example.com/x']) expect(judgeExternalLink(u, { launch: true }).allowed, u).toBe(true);
  });
});

describe('リンクの動作を安全なものに限る (HTM-20)', () => {
  const HTML =
    '<p><a href="https://example.com/a">ok</a> <a href="javascript:alert(1)">js</a> <a href="java&#9;script:alert(2)">js2</a> <a href=" JAVASCRIPT:alert(3)">js3</a> <a href="data:text/html,x">d</a> ' +
    '<a href="x.exe">exe</a> <a href="other.pdf#page=3">pdf</a> <a href="mailto:a@example.com">m</a> <a href="//example.com/x">n</a> <a href="#t">in</a></p><a style="display: block" href="file:///etc/passwd">blk</a><p id="t">t</p>';

  it('相対の PDF の名前・# の後ろの字で、動作の辞書に項目を足せない (括弧と、下位 8 ビットが括弧になる字。ISO 32000-2 §7.3.4.2)', async () => {
    // ) で文字列を閉じて /S /JavaScript を書き足す形 (辞書の同じ名前の項目は、後のものを読む実装が多い)。
    // 2 つ目は、逃がされる ( ) の代わりに、下位 8 ビットが 0x28・0x29 になる字 (U+0128・U+0129) を使う形
    const r = await typeset('<p><a href="a.pdf#x)/S/JavaScript/JS(app.alert(1)">a</a> <a href="aĩ/S/JavaScript/JSĨapp.alertĨ1ĩĩ/XĨ.pdf">b</a> <a href="資料.pdf#第1章">c</a></p>', { loadFont });
    const pdf = await PDFDocument.load(await r.toPdf());
    const acts: PDFDict[] = [];
    for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o instanceof PDFDict && o.get(PDFName.of('A'))) acts.push(o.lookup(PDFName.of('A'), PDFDict));
    // 読み戻した動作は、どれも GoToR で、項目は S・F・D だけ
    expect(acts.map((a) => [String(a.get(PDFName.of('S'))), a.keys().map(String).sort().join(' ')])).toEqual(Array.from({ length: 3 }, () => ['/GoToR', '/D /F /S']));
    expect(String(acts[0].get(PDFName.of('D')))).toBe('(x\\)/S/JavaScript/JS\\(app.alert\\(1\\))');
    // ASCII でない字のある名前は、ファイル指定の辞書 (§7.11.3 Table 43): UF に Unicode の名前、F は同じ名前の UTF-8 のバイト列 (16 進の文字列)
    const spec = (a: PDFDict) => a.lookup(PDFName.of('F'), PDFDict);
    expect((spec(acts[1]).lookup(PDFName.of('UF')) as PDFHexString).decodeText()).toBe('aĩ/S/JavaScript/JSĨapp.alertĨ1ĩĩ/XĨ.pdf');
    expect(String(spec(acts[1]).get(PDFName.of('F')))).toBe(`<${Buffer.from('aĩ/S/JavaScript/JSĨapp.alertĨ1ĩĩ/XĨ.pdf').toString('hex')}>`);
    expect((spec(acts[2]).lookup(PDFName.of('UF')) as PDFHexString).decodeText()).toBe('資料.pdf');
    // 名前付きの飛び先の名前は、UTF-8 のバイト列 (16 進の文字列)
    expect(String(acts[2].get(PDFName.of('D')))).toBe(`<${Buffer.from('第1章').toString('hex')}>`);
  });
  it('HTML: 既定では javascript:・data:・file:・Launch・//host の動作を書かず、字は組み、警告に件数と理由を出す', async () => {
    const r = await typeset(HTML, { loadFont });
    const acts = await actionsOf(await r.toPdf());
    expect(acts.sort()).toEqual(['/S /GoToR /F (other.pdf) /D [ 2 /Fit ]', '/S /URI /URI (https://example.com/a)', '/S /URI /URI (mailto:a@example.com)']);
    // Area Tree にも、落とした飛び先は入らない
    const json = serializeAreaTree(r.areaTree);
    expect(json).not.toMatch(/javascript|x\.exe|passwd/i);
    // 字はそのまま
    let text = '';
    JSON.parse(json, (k, v) => (k === 'text' && typeof v === 'string' && (text += v), v));
    for (const t of ['js', 'exe', 'blk']) expect(text).toContain(t);
    const w = r.warnings.filter((x) => x.includes('リンクの動作'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('javascript: ×3 (javascript:alert(1))');
    expect(w[0]).toContain('data: ×1');
    expect(w[0]).toContain('file: ×1');
    expect(w[0]).toContain('Launch ×1 (x.exe)');
    expect(w[0]).toContain('//host ×1');
  });

  it('警告の URL は先頭だけ', async () => {
    const r = await typeset(`<p><a href="javascript:${'a'.repeat(5000)}">x</a></p>`, { loadFont });
    const w = r.warnings.find((x) => x.includes('リンクの動作'))!;
    expect(w.length).toBeLessThan(400);
    expect(w).toContain('…');
  });

  it('links の設定で、以前と同じ動き (すべて書く) に戻せる。スキームだけ・Launch だけも選べる', async () => {
    const all = await typeset(HTML, { loadFont, links: { schemes: ['*'], launch: true } });
    expect(all.warnings.filter((x) => x.includes('リンクの動作'))).toEqual([]);
    const acts = await actionsOf(await all.toPdf());
    expect(acts).toContain('/S /URI /URI (javascript:alert\\(1\\))');
    expect(acts).toContain('/S /Launch /F (x.exe)');
    expect(acts).toContain('/S /URI /URI (//example.com/x)');
    expect(acts).toHaveLength(10);
    const launch = await actionsOf(await (await typeset(HTML, { loadFont, links: { launch: true } })).toPdf());
    expect(launch.filter((a) => /Launch/.test(a))).toHaveLength(1);
    expect(launch.join()).not.toMatch(/javascript|data:|file:/i);
    const only = await actionsOf(await (await typeset(HTML, { loadFont, links: { schemes: ['mailto'] } })).toPdf());
    expect(only.sort()).toEqual(['/S /GoToR /F (other.pdf) /D [ 2 /Fit ]', '/S /URI /URI (mailto:a@example.com)']);
    await expect(typeset(HTML, { loadFont, links: { schemes: 'http' as never } })).rejects.toThrow(/links\.schemes/);
    await expect(typeset(HTML, { loadFont, links: { launch: 1 as never } })).rejects.toThrow(/links\.launch/);
  });

  const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
  const FO = `<?xml version="1.0"?><fo:root ${NS}>
    <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
    <fo:bookmark-tree><fo:bookmark external-destination="url('javascript:alert(1)')"><fo:bookmark-title>js</fo:bookmark-title></fo:bookmark><fo:bookmark external-destination="url(run.bat)"><fo:bookmark-title>bat</fo:bookmark-title></fo:bookmark><fo:bookmark external-destination="url(https://example.com/b)"><fo:bookmark-title>ok</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>
    <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>
      <fo:basic-link external-destination="url(https://example.com/a)">ok</fo:basic-link>
      <fo:basic-link external-destination="url('java&#10;script:alert(1)')">js</fo:basic-link>
      <fo:basic-link external-destination="url(setup.exe)">exe</fo:basic-link>
      <fo:basic-link external-destination="url(next.pdf)">pdf</fo:basic-link>
    </fo:block></fo:flow></fo:page-sequence></fo:root>`;

  it('XSL-FO: fo:basic-link・fo:bookmark の external-destination も同じ決まり', async () => {
    const r = await typeset(FO, { loadFont, kind: 'fo' });
    const acts = await actionsOf(await r.toPdf());
    expect(acts.sort()).toEqual(['/S /GoToR /F (next.pdf) /D [ 0 /Fit ]', '/S /URI /URI (https://example.com/a)', '/S /URI /URI (https://example.com/b)']);
    // 動作を落としたしおりも、題は残る
    expect(r.areaTree.bookmarks!.map((b) => [b.title, b.external])).toEqual([['js', undefined], ['bat', undefined], ['ok', 'https://example.com/b']]);
    const w = r.warnings.filter((x) => x.includes('リンクの動作'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('javascript: ×2');
    expect(w[0]).toContain('Launch ×2');
    const all = await actionsOf(await (await typeset(FO, { loadFont, kind: 'fo', links: { schemes: ['*'], launch: true } })).toPdf());
    expect(all).toHaveLength(7);
  });

  it('Area Tree をそのまま PDF にする経路 (取り込みを通らない木) でも、書き出しの手前で落とす', async () => {
    const { fonts, engine } = await makeEngine();
    // すべて通す設定で取り込んだ木 (危ない飛び先が入っている) を、直列化して読み直し、既定の設定で PDF にする
    const r = importXslFo(FO, (s) => new DOMParser().parseFromString(s, 'text/xml') as never, { links: { schemes: ['*'], launch: true } });
    const tree = parseAreaTree(serializeAreaTree(engine.layout(r.document)));
    expect(serializeAreaTree(tree)).toContain('setup.exe');
    const linkWarnings: string[] = [];
    const acts = await actionsOf(await renderPdf(tree, fonts, { linkWarnings }));
    expect(acts.sort()).toEqual(['/S /GoToR /F (next.pdf) /D [ 0 /Fit ]', '/S /URI /URI (https://example.com/a)', '/S /URI /URI (https://example.com/b)']);
    expect(linkWarnings).toHaveLength(1);
    expect(linkWarnings[0]).toContain('javascript: ×2');
    expect(linkWarnings[0]).toContain('Launch ×2');
    // 書き出しの設定で許せば書く
    expect(await actionsOf(await renderPdf(tree, fonts, { links: { schemes: ['*'], launch: true } }))).toHaveLength(7);
  });

  it('フォームの送り先 (axf:form の external-destination) も、スキームを同じ決まりで見る', async () => {
    const form = (url: string) => `<?xml version="1.0"?><fo:root ${NS}>
    <fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
    <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block><axf:form external-destination="${url}" axf:field-submit-method="post">
      <axf:form-field axf:field-type="button" axf:action-type="submit" axf:field-button-face="send" width="20mm" height="6mm"/></axf:form></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const ok = await typeset(form('https://example.com/post'), { loadFont, kind: 'fo', compat: 'antenna' });
    const okActs = await actionsOf(await ok.toPdf());
    // このテストは、送る動作が書かれる形の FO であることを先に確かめる (書かれなければ、下の「書かない」は何も確かめていない)
    expect(okActs.filter((a) => /SubmitForm/.test(a))).toHaveLength(1);
    const bad = await typeset(form('javascript:alert(1)'), { loadFont, kind: 'fo', compat: 'antenna' });
    expect((await actionsOf(await bad.toPdf())).filter((a) => /SubmitForm/.test(a))).toEqual([]);
    expect(bad.warnings.some((x) => x.includes('javascript: ×1'))).toBe(true);
  });
});

describe('ASCII でない字のあるファイルの名前 (ISO 32000-1 §7.11)', () => {
  it('GoToR・Launch の F は UTF-8 のバイト列、UF は同じ名前のテキスト文字列 (UTF-16BE、BOM 付き)。%xx で書いた名前は戻す', async () => {
    const NAME = 'Bluetoothスピーカー 取扱説明書';
    const enc = encodeURIComponent(NAME);
    const r = await typeset(`<p><a href="${enc}.pdf">a</a> <a href="${enc}.mp3">b</a> <a href="plain.pdf">c</a></p>`, { loadFont, links: { launch: true } });
    const pdf = await PDFDocument.load(await r.toPdf());
    const acts: PDFDict[] = [];
    for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o instanceof PDFDict && o.get(PDFName.of('A'))) acts.push(o.lookup(PDFName.of('A'), PDFDict));
    expect(acts.map((a) => String(a.get(PDFName.of('S'))))).toEqual(['/GoToR', '/Launch', '/GoToR']);
    for (const [k, ext] of [[0, '.pdf'], [1, '.mp3']] as const) {
      const spec = acts[k].lookup(PDFName.of('F'), PDFDict);
      expect(String(spec.get(PDFName.of('Type')))).toBe('/Filespec');
      const uf = spec.lookup(PDFName.of('UF'), PDFHexString);
      expect(uf.decodeText()).toBe(NAME + ext);
      expect(uf.asString().toLowerCase().startsWith('feff')).toBe(true);
      const f = spec.lookup(PDFName.of('F'), PDFHexString);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(f.asBytes())).toBe(NAME + ext);
    }
    // ASCII だけの名前は、今までどおりファイル指定の文字列
    expect(String(acts[2].get(PDFName.of('F')))).toBe('(plain.pdf)');
  });
});

describe("相対参照を URI の動作に書く (links.relative: 'uri')", () => {
  const ENC = 'Bluetooth%E3%82%B9%E3%83%94%E3%83%BC%E3%82%AB%E3%83%BC%20%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B8.pdf';
  const HREFS = ['001-sibutomo.mp3', ENC, './a.pdf', 'b.pdf#page=3', 'pdf-media-link://a.pdf', 'https://example.com/a.pdf', '#sec'];
  const DOC = HREFS.map((h) => `<p><a href="${h}">x</a></p>`).join('') + '<h2 id="sec">sec</h2>';
  /** リンクの注釈を、文書の順に、動作の文字か "Dest" にする */
  const linksOf = async (bytes: Uint8Array) => {
    const pdf = await PDFDocument.load(bytes);
    const out: string[] = [];
    for (const page of pdf.getPages())
      for (const ref of page.node.Annots()?.asArray() ?? []) {
        const annot = pdf.context.lookup(ref, PDFDict);
        const a = annot.lookup(PDFName.of('A'));
        out.push(a ? String(a).replace(/\s+/g, ' ') : annot.get(PDFName.of('Dest')) ? 'Dest' : '?');
      }
    return out;
  };

  it('判定: 相対参照は relative-uri。PDF でないファイルも launch 無しで通し、絶対パスと //host は launch のときだけ', () => {
    const uri = { relative: 'uri' } as const;
    for (const u of ['a.mp3', 'x.pdf', './a.pdf#page=2', '../dir/a%20b.html?q=1']) expect(judgeExternalLink(u, uri), u).toMatchObject({ kind: 'relative-uri', allowed: true, url: u });
    for (const u of ['/etc/passwd', '%2Fetc/a.pdf', '\\\\host\\share\\x.exe']) {
      expect(judgeExternalLink(u, uri), u).toMatchObject({ kind: 'relative-uri', allowed: false, reason: 'URI (absolute path)' });
      expect(judgeExternalLink(u, { ...uri, launch: true }).allowed, u).toBe(true);
    }
    expect(judgeExternalLink('//example.com/x', uri)).toMatchObject({ kind: 'uri', allowed: false, reason: '//host' });
    // スキームのある URL の判定は変わらない (C:\… は c: のスキームとして落ちる)
    expect(judgeExternalLink('javascript:alert(1)', uri)).toMatchObject({ kind: 'uri', allowed: false });
    expect(judgeExternalLink('C:\\x.pdf', uri)).toMatchObject({ kind: 'uri', allowed: false, reason: 'c:' });
    expect(judgeExternalLink('https://example.com/', uri)).toMatchObject({ kind: 'uri', allowed: true });
    // 'file' は、指定しないときと同じ
    for (const u of ['a.mp3', 'x.pdf', '/a.pdf']) expect(judgeExternalLink(u, { relative: 'file' })).toEqual(judgeExternalLink(u));
  });

  it("'uri': 相対の href を、書かれたまま (%xx も解かずに) URI の動作に書く。#id・https・独自のスキームは今までどおり", async () => {
    const r = await typeset(DOC, { loadFont, links: { schemes: ['*'], relative: 'uri' } });
    expect(await linksOf(await r.toPdf())).toEqual([
      '<< /S /URI /URI (001-sibutomo.mp3) >>',
      `<< /S /URI /URI (${ENC}) >>`,
      '<< /S /URI /URI (./a.pdf) >>',
      '<< /S /URI /URI (b.pdf#page=3) >>',
      '<< /S /URI /URI (pdf-media-link://a.pdf) >>',
      '<< /S /URI /URI (https://example.com/a.pdf) >>',
      'Dest',
    ]);
    expect(r.warnings.filter((x) => x.includes('リンクの動作'))).toEqual([]);
    // スキームの制限は、'uri' でも変わらない (既定では、独自のスキームは書かない)。相対のファイルは launch 無しで書く
    const d = await typeset(DOC, { loadFont, links: { relative: 'uri' } });
    const acts = await linksOf(await d.toPdf());
    expect(acts).toHaveLength(6);
    expect(acts.join()).not.toContain('pdf-media-link');
    expect(acts[0]).toBe('<< /S /URI /URI (001-sibutomo.mp3) >>');
    expect(d.warnings.find((x) => x.includes('リンクの動作'))).toContain('pdf-media-link: ×1');
  });

  it("'uri': URI は 7 ビットの ASCII (§12.6.4.7)。ASCII でない字と空白は UTF-8 の %xx にし、括弧は逃がす。絶対パスは書かずに警告する", async () => {
    const r = await typeset('<p><a href="資料 1.pdf">a</a> <a href="a(1).pdf">b</a> <a href="/etc/passwd">c</a></p>', { loadFont, links: { relative: 'uri' } });
    expect(await linksOf(await r.toPdf())).toEqual(['<< /S /URI /URI (%E8%B3%87%E6%96%99%201.pdf) >>', '<< /S /URI /URI (a\\(1\\).pdf) >>']);
    expect(r.warnings.find((x) => x.includes('リンクの動作'))).toContain('URI (absolute path) ×1 (/etc/passwd)');
  });

  it("既定 (指定しない) と 'file' の出力は同じ: 相対の PDF は GoToR、ほかのファイルは Launch", async () => {
    const all = { schemes: ['*'], launch: true };
    const expected = [
      '<< /S /Launch /F (001-sibutomo.mp3) >>',
      expect.stringMatching(/^<< \/S \/GoToR \/F << \/Type \/Filespec \/F <[0-9a-f]+> \/UF <FEFF[0-9A-F]+> >> \/D \[ 0 \/Fit \] >>$/),
      '<< /S /GoToR /F (./a.pdf) /D [ 0 /Fit ] >>',
      '<< /S /GoToR /F (b.pdf) /D [ 2 /Fit ] >>',
      '<< /S /URI /URI (pdf-media-link://a.pdf) >>',
      '<< /S /URI /URI (https://example.com/a.pdf) >>',
      'Dest',
    ];
    const none = await linksOf(await (await typeset(DOC, { loadFont, links: all })).toPdf());
    expect(none).toEqual(expected);
    expect(await linksOf(await (await typeset(DOC, { loadFont, links: { ...all, relative: 'file' } })).toPdf())).toEqual(none);
    await expect(typeset(DOC, { loadFont, links: { relative: 'url' as never } })).rejects.toThrow(/links\.relative/);
  });

  it('XSL-FO の fo:basic-link の external-destination と、しおりにも同じように効く', async () => {
    const fo =
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:bookmark-tree><fo:bookmark external-destination="url(notes.html)"><fo:bookmark-title>n</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>' +
      '<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block><fo:basic-link external-destination="url(next.pdf)">a</fo:basic-link> <fo:basic-link external-destination="url(a.mp3)">b</fo:basic-link></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typeset(fo, { loadFont, kind: 'fo', links: { relative: 'uri' } });
    expect((await actionsOf(await r.toPdf())).sort()).toEqual(['/S /URI /URI (a.mp3)', '/S /URI /URI (next.pdf)', '/S /URI /URI (notes.html)']);
  });
});

describe('コマンドの引数: --link-schemes・--link-launch・--link-relative', () => {
  it('--link-relative は file か uri (既定は指定なし)', () => {
    expect(parseArgs(['a.html']).linkRelative).toBeUndefined();
    expect(parseArgs(['a.html', '--link-relative', 'uri']).linkRelative).toBe('uri');
    expect(parseArgs(['a.html', '--link-relative', 'file']).linkRelative).toBe('file');
    expect(() => parseArgs(['a.html', '--link-relative', 'url'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--link-relative'])).toThrow(UsageError);
  });

  it('既定は指定なし (API の既定)。--link-schemes はカンマ区切り、--link-launch は真偽', () => {
    const d = parseArgs(['a.html']);
    expect([d.linkSchemes, d.linkLaunch]).toEqual([undefined, false]);
    const a = parseArgs(['a.html', '--link-schemes', 'HTTP, https:,ftp', '--link-launch']);
    expect([a.linkSchemes, a.linkLaunch]).toEqual([['http', 'https', 'ftp'], true]);
    expect(parseArgs(['a.html', '--link-schemes', '*']).linkSchemes).toEqual(['*']);
    expect(() => parseArgs(['a.html', '--link-schemes', 'ht tp'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--link-schemes', ','])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--link-schemes'])).toThrow(UsageError);
  });
});
