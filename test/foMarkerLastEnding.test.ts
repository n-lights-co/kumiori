/**
 * fo:retrieve-marker の retrieve-position="last-ending-within-page" (XSL 1.1 §6.13.6・§7.25.4):
 * このページで終わる親の marker の最後。無ければ、このページに断片のある親の marker の最後。それも無ければ前のページから持ち越し
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const doc = (pos: string, flow: string) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="60mm" page-height="60mm" margin="5mm"><fo:region-body margin-top="10mm"/><fo:region-before extent="8mm"/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m">` +
  `<fo:static-content flow-name="xsl-region-before"><fo:block>柱<fo:retrieve-marker retrieve-class-name="h" retrieve-position="${pos}"/></fo:block></fo:static-content>` +
  `<fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;

/** ページごとの、柱 (「柱」の後ろの字) と、本文に A の字 (あ)・B の字 (い) があるか */
const pagesOf = (pos: string, flow: string) => {
  const t = E.engine.layout(importXslFo(doc(pos, flow), parse, { compat: 'spec' }).document);
  return t.sheets.map((sh) => {
    let s = '';
    walk(sh as unknown as Area, (a) => {
      if (a.type === 'glyph') s += (a as GlyphArea).text;
    });
    return { head: /柱([AB]?)/.exec(s)?.[1] ?? '?', a: s.includes('あ'), b: s.includes('い') };
  });
};

describe('retrieve-position="last-ending-within-page"', () => {
  // A は数ページにわたり、B は A の終わるページで始まって、さらに数ページ続く
  const flow = `<fo:block><fo:marker marker-class-name="h">A</fo:marker>${'あ'.repeat(260)}</fo:block><fo:block><fo:marker marker-class-name="h">B</fo:marker>${'い'.repeat(300)}</fo:block>`;
  it('このページで終わる親の marker。無ければ、このページに断片のある親の marker', () => {
    const ps = pagesOf('last-ending-within-page', flow);
    const both = ps.findIndex((p) => p.a && p.b);
    expect(both).toBeGreaterThan(0);
    // A の途中のページ: 終わる親は無いので、断片のある A
    expect(ps.slice(0, both).map((p) => p.head)).toEqual(Array(both).fill('A'));
    // A が終わり B が始まるページ: そこで終わる A (B はまだ終わらない)
    expect(ps[both].head).toBe('A');
    // B の途中と終わりのページ: B
    expect(ps.slice(both + 1).map((p) => p.head)).toEqual(Array(ps.length - both - 1).fill('B'));
  });
  it('last-starting-within-page なら、A が終わり B が始まるページは、そこで始まる B', () => {
    const ps = pagesOf('last-starting-within-page', flow);
    expect(ps[ps.findIndex((p) => p.a && p.b)].head).toBe('B');
  });
});
