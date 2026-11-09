/**
 * 未対応の CSS・XSL-FO の指定を、黙って無視せずに warnings で知らせる:
 *  - 作成者スタイルシート と style 属性の、未対応のプロパティ (説明書 16 章の一覧)・未対応の値・知らないプロパティを数える (cssUnsupported)
 *  - typeset の warnings に 1 行ずつ出す (HTML と XSL-FO)
 *  - XSL-FO の数え方の誤り (読めるものを未対応と数えていた) を直したことの確認
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCss } from '../src/htmlPaged';
import { isPrintIrrelevantCssProperty, splitStyleAttribute, summarizeCounts, unsupportedCssReport, UNSUPPORTED_CSS_PROPERTIES } from '../src/cssUnsupported';
import { DEFAULT_FONTS, typesetFo, typesetHtml, type FontSpec } from '../src/index';

const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  fs.mkdirSync(fontDir, { recursive: true });
  for (const spec of DEFAULT_FONTS.base) {
    const file = fileOf(spec);
    if (fs.existsSync(file)) continue;
    const res = await fetch(spec.urls.find((u) => /^https:/.test(u))!);
    if (!res.ok) throw new Error(`font download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
});

describe('未対応の CSS の数え上げ (cssUnsupported)', () => {
  it('style 属性の宣言を分ける (括弧・引用符の中の ; と : は区切りにしない)', () => {
    expect(splitStyleAttribute('color: red; background: url("a;b.png"); font-family: "A:B", serif;')).toEqual([
      ['color', 'red'],
      ['background', 'url("a;b.png")'],
      ['font-family', '"A:B", serif'],
    ]);
  });
  it('未対応のプロパティ・値・知らないプロパティを数える (対応しているもの・接頭辞付き・カスタム プロパティは数えない)', () => {
    const css = parseCss(
      '.g { display: grid; grid-template-areas: "a b"; grid-template-columns: 1fr 1fr } .s { position: sticky; top: 0 } .t { writing-mode: sideways-lr }' +
        ' p { hyphens: auto; opacity: .5; -webkit-line-clamp: 2; --gap: 1em; margin-inline: 1em; colr: red } h1 { text-shadow: 0 0 1px #000; opacity: 1 !important }',
    );
    const r = unsupportedCssReport(css);
    expect(r.unsupported).toEqual({ 'grid-template-areas': 1, 'position: sticky': 1, 'writing-mode: sideways-lr': 1, opacity: 2, 'text-shadow': 1 });
    expect(r.unknown).toEqual({ colr: 1 });
  });
  it('一覧は対応仕様説明書 16 章の「対応していないプロパティ」と同じ', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../docs/conformance/html/kumiori-html-css.html'), 'utf8');
    const i = doc.indexOf('対応していないプロパティ (');
    const j = doc.indexOf('<h3', i + 10);
    const props = [...doc.slice(i, j).matchAll(/<tr><td><code>([^<]+)<\/code>/g)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(50);
    expect(new Set(props)).toEqual(UNSUPPORTED_CSS_PROPERTIES);
  });
  it('印刷では意味のないプロパティ (cursor・resize・appearance・アニメーション・スクロールなど) は数えない。sanitize.css の書き方', () => {
    const css = parseCss(
      'button { cursor: pointer; appearance: button } textarea { resize: vertical } a { transition: color .2s; animation-name: x; scroll-margin-top: 1em; touch-action: manipulation; user-select: none; pointer-events: none } svg { fill: currentColor }',
    );
    const r = unsupportedCssReport(css);
    expect(r.unsupported).toEqual({});
    // fill は印刷にも効く (Kumiori は読まない) ので、知らないプロパティとして残す
    expect(r.unknown).toEqual({ fill: 1 });
  });
  it('印刷では意味のないプロパティの一覧は、対応仕様説明書の「印刷に関わらないプロパティ」の表を含む', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../docs/conformance/html/kumiori-html-css.html'), 'utf8');
    const i = doc.indexOf('<h3>印刷に関わらないプロパティ (');
    const j = doc.indexOf('</table>', i);
    const props = [...doc.slice(i, j).matchAll(/<tr><td><code>([^<]+)<\/code>/g)].map((m) => m[1]);
    expect(props.length).toBe(22);
    for (const p of props) expect(isPrintIrrelevantCssProperty(p)).toBe(true);
  });
  it('警告の文: 多い順に「名前 (数)」。多すぎれば残りの数', () => {
    expect(summarizeCounts({ a: 1, b: 3, c: 2 })).toBe('b (3)、c (2)、a');
    expect(summarizeCounts(Object.fromEntries(Array.from({ length: 25 }, (_, k) => [`p${k}`, 1])), 20)).toMatch(/…ほか 5 種$/);
    expect(summarizeCounts({})).toBe('');
  });
});

describe('typeset の warnings', () => {
  it('HTML: 未対応の CSS と知らないプロパティを 1 行ずつ知らせる (style 属性も数える)。無ければ出さない', async () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>.g { display: grid; grid-template-areas: "a b" } .s { position: sticky }</style></head>' +
      '<body><div class="g"><p>a</p><p>b</p></div><p class="s" style="opacity: .5; colr: red">s</p></body></html>';
    const r = await typesetHtml(html, { name: 't.html', loadFont });
    const miss = r.warnings.find((w) => w.startsWith('未対応の CSS を無視しました: '));
    expect(miss).toBe('未対応の CSS を無視しました: grid-template-areas、opacity、position: sticky');
    const unknown = r.warnings.find((w) => w.startsWith('知らない CSS のプロパティを無視しました'));
    expect(unknown).toBe('知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr');
    const clean = await typesetHtml('<!DOCTYPE html><html><head><title>t</title><style>p { margin: 1em; text-indent: 1em; hyphens: auto }</style></head><body><p>x</p></body></html>', { name: 't.html', loadFont });
    expect(clean.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
  });
  it('XSL-FO: 読めない要素・プロパティを知らせる', async () => {
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block>x<fo:nonexistent>y</fo:nonexistent></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typesetFo(fo, { name: 't.fo', loadFont });
    const miss = r.warnings.find((w) => w.startsWith('未対応の XSL-FO の要素・プロパティを無視しました: '));
    expect(miss).toContain('fo:nonexistent');
  });
  it('XSL-FO: 読めるものを未対応と数えない (axf:box-shadow の長さ・空白入りの rgb()・font-stretch・writing-mode の from-page-master-region())', async () => {
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      '<fo:page-sequence master-reference="m" writing-mode="from-page-master-region()"><fo:flow flow-name="xsl-region-body">' +
      '<fo:block axf:box-shadow="2pt 2pt 3pt #9a8f80, inset 1pt 1pt #000" border="1pt solid rgb(0, 0, 0)" border-color="rgb(10, 20, 30)" background-color="rgb(220, 220, 220)" padding="2pt">x</fo:block>' +
      '<fo:block><fo:inline font-stretch="75%">y</fo:inline><fo:inline font-stretch="expanded">z</fo:inline></fo:block>' +
      '</fo:flow></fo:page-sequence></fo:root>';
    const r = await typesetFo(fo, { name: 't.fo', loadFont });
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
    // 空白入りの rgb() は 1 つの色として読む (罫の色)
    const colors = new Set<string>();
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(visit);
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === 'color' && typeof v === 'string') colors.add(v);
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(r.areaTree);
    expect([...colors].some((c) => /^rgb\(10,20,30\)$|^rgb\(10, 20, 30\)$/.test(c))).toBe(true);
    expect([...colors].some((c) => /^rgb\(10,$|^0,$|^0\)$|^30\)$/.test(c))).toBe(false);
  });
});
