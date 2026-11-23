/**
 * url(…) の中身を取り出す urlFunctionBody: 前に使っていた正規表現と同じ結果になることと、「url(」と空白の長い並びの値でも
 * 長さに比例した手間で終わること (前は、正規表現の前後の \s* と中身が同じ空白を取り合い、空白 2,000 個で 8 秒、6,000 個で 200 秒を超えた)
 */
import { describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import { DOMParser } from '@xmldom/xmldom';
import { urlFunctionBody } from '../src/resources';
import { normalizeSrc } from '../src/assets';
import { importXslFo } from '../src/xslfoImport';

const MATCH = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i;
const ANY = /^url\(\s*['"]?([\s\S]*?)['"]?\s*\)$/i;
const ANY_DOT = /^url\(\s*['"]?(.*?)['"]?\s*\)$/i;

/** 短い乱数の値 (正規表現でも手間のかからない長さ) */
function samples(n: number): string[] {
  const parts = ['url(', 'URL(', ' ', '\t', '\n', '　', '"', "'", 'a', 'b.png', ')', '(', ' ', 'x y'];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: string[] = ['url()', 'url( )', 'url(")', "url('')", 'url("a\')', 'url( "a" )', "url(' a ')", 'url(a b)', 'url("a)', 'url(a")', 'url(\n"a"\n)', 'url("a\nb")'];
  for (let i = 0; i < n; i++) {
    let s = rnd() < 0.8 ? 'url(' : '';
    const k = Math.floor(rnd() * 8);
    for (let j = 0; j < k; j++) s += parts[Math.floor(rnd() * parts.length)];
    if (rnd() < 0.8) s += ')';
    out.push(s);
  }
  return out;
}

describe('urlFunctionBody', () => {
  it('前の正規表現と同じ結果 (引用符をそろえて外すもの・別々に外すもの・改行を中身に含めないもの)', () => {
    for (const v of samples(20000)) {
      const m = MATCH.exec(v);
      expect(urlFunctionBody(v, 'match', false), JSON.stringify(v)).toBe(m ? m[2] : undefined);
      const a = ANY.exec(v);
      expect(urlFunctionBody(v, 'any'), JSON.stringify(v)).toBe(a ? a[1] : undefined);
      const d = ANY_DOT.exec(v);
      expect(urlFunctionBody(v, 'any', false), JSON.stringify(v)).toBe(d ? d[1] : undefined);
    }
  });

  it('「url(」と空白の長い並びの値でも、すぐに終わる', () => {
    const long = 'url(' + ' '.repeat(200_000) + 'x';
    const t = cpuClock();
    expect(urlFunctionBody(long, 'match', false)).toBeUndefined();
    expect(urlFunctionBody(long, 'any')).toBeUndefined();
    expect(urlFunctionBody(long + ')', 'any')).toBe('x');
    normalizeSrc(long);
    expect(cpuClock() - t).toBeLessThan(scaled(500));
  });

  it('画像の src (normalizeSrc) と XSL-FO の external-destination・送り先・添付の url(…) が、空白の長い並びで時間をかけない', () => {
    const spaces = ' '.repeat(6000);
    let t = cpuClock();
    normalizeSrc(`url(${spaces}x`);
    expect(cpuClock() - t).toBeLessThan(scaled(500));
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:bookmark-tree><fo:bookmark external-destination="url(${spaces}x"><fo:bookmark-title>b</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block><fo:basic-link external-destination="url(${spaces}x">a</fo:basic-link><fo:inline axf:annotation-file-attachment="url(${spaces}x">f</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    t = cpuClock();
    importXslFo(fo, (x) => new DOMParser().parseFromString(x, 'text/xml') as never);
    expect(cpuClock() - t).toBeLessThan(scaled(3000));
  });
});
