/** fo:inline の axf:border-radius (アンテナハウスの拡張。行内の箱の角を丸める)。受け皿は LInline.borderRadius (HTML の行内の border-radius と同じ) */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const BOTH = ['spec', 'antenna'] as const;

describe('fo:inline の axf:border-radius', () => {
  it('行内の箱の角を丸める (ブロックと同じ書き方)', () => {
    for (const c of BOTH) {
      const r = importXslFo(fo('<fo:block>a<fo:inline background-color="red" axf:border-radius="2pt 1pt">b</fo:inline><fo:inline axf:border-radius="3pt">c</fo:inline></fo:block>'), parse, { compat: c });
      const kids = (r.document.sequences[0].flow.children[0] as { children: Array<{ borderRadius?: unknown }> }).children;
      expect(kids[1].borderRadius).toEqual({ rx: 2, ry: 1 });
      expect(kids[2].borderRadius).toEqual({ rx: 3, ry: 3 });
      expect(r.report.unsupported).toEqual({});
    }
  });
});
