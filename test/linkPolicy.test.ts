/**
 * 文書の外へのリンクのうち、PDF に動作を書くもの (HTM-20。src/linkPolicy.ts)。
 * 既定では http・https・mailto・tel の URL と相対の PDF (GoToR) だけを書き、ほか (javascript: など・Launch) は字だけを組んで警告する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
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

describe('コマンドの引数: --link-schemes・--link-launch', () => {
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
