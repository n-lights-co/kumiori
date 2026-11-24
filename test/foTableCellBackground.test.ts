/**
 * fo:table-cell の background-image (XSL 1.1 §7.8.3。§6.7.10 の fo:table-cell の性質の一覧に「7.8 Common Border, Padding, and
 * Background Properties」がある)。前は読み込みがセルに写さず、描かなかった
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, walkAreaTree, type FontSpec } from '../src/index';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (cellAttrs: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:table><fo:table-body><fo:table-row>` +
  `<fo:table-cell ${cellAttrs} height="30mm"><fo:block>a</fo:block></fo:table-cell>` +
  `</fo:table-row></fo:table-body></fo:table></fo:flow></fo:page-sequence></fo:root>`;
const png = encodePngStored({ width: 4, height: 4, rgba: new Uint8Array(64).fill(200) });

describe('fo:table-cell の background-image', () => {
  for (const compat of ['spec', 'antenna'] as const)
    for (const v of ['a.png', 'url(a.png)'])
      it(`${compat}: background-image="${v}" をセルの領域の背景にする`, async () => {
        const r = await typesetFo(fo(`background-image="${v}" background-repeat="no-repeat"`), { loadFont, compat, files: [{ name: 'a.png', data: png }] });
        const bgs: string[] = [];
        walkAreaTree(r.areaTree, (a) => void ('backgroundImage' in a && a.backgroundImage && bgs.push(a.backgroundImage.src)));
        expect(bgs).toEqual(['a.png']);
        expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
      });

  it('empty-cells="hide" の罫線を分ける表の、中身の無いセルには描かない (§7.28.10)', async () => {
    const doc = fo('background-image="a.png"')
      .replace('<fo:table>', '<fo:table border-collapse="separate" empty-cells="hide">')
      .replace('<fo:block>a</fo:block>', '<fo:block/>');
    const r = await typesetFo(doc, { loadFont, files: [{ name: 'a.png', data: png }] });
    let n = 0;
    walkAreaTree(r.areaTree, (a) => void ('backgroundImage' in a && a.backgroundImage && n++));
    expect(n).toBe(0);
  });
});
