/**
 * 総称の書体の差し替え (TODO-24): API の genericFonts・コマンドの --generic-font。
 * CSS Fonts 4 §2.1.3: 総称の書体に当てる書体は、処理系が決める (利用者が選べてよい)。
 *  - serif・sans-serif・monospace: 欧文の字の書体 (既定は Tinos・Arimo・Cousine)
 *  - serif-cjk・sans-serif-cjk: 和文 (欧文の書体に無い字) の書体 (既定は Noto Serif JP・Noto Sans JP)。
 *    等幅の和文は、HTML は sans-serif-cjk、XSL-FO は serif-cjk の書体 (等幅の和文の既定と同じ側)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, createTypesetter, walkAreaTree, type FontSpec, type GlyphArea, type TypesetResult } from '../src/index';
import { parseArgs } from '../src/cli';
import { ensureFonts, extraTestFont, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loaded: string[] = [];
const loadFont = async (spec: FontSpec) => {
  loaded.push(spec.family);
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
let sc: Buffer;
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
  sc = fs.readFileSync(await extraTestFont('NotoSansKR-Regular-v40.ttf'));
}, 300_000);

/** 字 → その字を組んだ書体のファミリー名 */
const families = (r: TypesetResult) => {
  const out: Record<string, string> = {};
  walkAreaTree(r.areaTree, (a) => {
    if (a.type === 'glyph') out[(a as GlyphArea).text] = (a as GlyphArea).fontFamily;
  });
  return out;
};
const FO = (body: string) =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

describe('genericFonts (API)', () => {
  it('monospace: 等幅の欧文の書体を差し替える (和文は既定のまま)。等幅の既定の書体 (Cousine) は読まない', async () => {
    loaded.length = 0;
    const t = await createTypesetter({ loadFont, genericFonts: { monospace: 'Tinos' } });
    const r = await t.typeset('<p><code>ab字</code></p>', { kind: 'html' });
    const f = families(r);
    expect([f['a'], f['b'], f['字']]).toEqual(['Tinos', 'Tinos', 'Noto Sans JP']);
    expect(loaded).not.toContain('Cousine');
    // 名指しの Courier New は、字幅を合わせた Cousine のまま (総称ではない)
    const c = families(await t.typeset('<p style="font-family: \'Courier New\'">x</p>', { kind: 'html' }));
    expect(c['x']).toBe('Cousine');
  });

  it('serif-cjk・sans-serif-cjk: 総称の和文の書体を差し替える (欧文は既定の Tinos・Arimo のまま)', async () => {
    const t = await createTypesetter({ loadFont, fonts: [{ name: 'kr.ttf', data: sc }], genericFonts: { 'serif-cjk': 'Noto Sans JP', 'sans-serif-cjk': 'Noto Sans KR' } });
    const r = await t.typeset('<p>字a</p><p style="font-family: sans-serif">漢b</p><p><code>語c</code></p>', { kind: 'html' });
    expect(r.warnings).toEqual([]);
    const f = families(r);
    expect([f['字'], f['a'], f['漢'], f['b'], f['語']]).toEqual(['Noto Sans JP', 'Tinos', 'Noto Sans KR', 'Arimo', 'Noto Sans KR']);
    // XSL-FO も (等幅の和文は明朝の側 = serif-cjk)
    const fo = families(await t.typeset(FO('<fo:block>字a</fo:block><fo:block font-family="sans-serif">漢b</fo:block><fo:block font-family="monospace">語</fo:block>'), { kind: 'fo' }));
    expect([fo['字'], fo['a'], fo['漢'], fo['b'], fo['語']]).toEqual(['Noto Sans JP', 'Tinos', 'Noto Sans KR', 'Arimo', 'Noto Sans JP']);
  });

  it('欧文と和文を両方差し替える', async () => {
    const t = await createTypesetter({ loadFont, fonts: [{ name: 'kr.ttf', data: sc }], genericFonts: { serif: 'Arimo', 'serif-cjk': 'Noto Sans KR' } });
    const f = families(await t.typeset('<p>字a</p>', { kind: 'html' }));
    expect([f['字'], f['a']]).toEqual(['Noto Sans KR', 'Arimo']);
  });

  it('読み込んでいない書体は警告、知らない総称の名前は誤り', async () => {
    const t = await createTypesetter({ loadFont, genericFonts: { monospace: 'No Such Font' } });
    const r = await t.typeset('<p><code>a</code></p>', { kind: 'html' });
    expect(r.warnings.some((w) => /No Such Font/.test(w))).toBe(true);
    await expect(createTypesetter({ loadFont, genericFonts: { cursive: 'Tinos' } as never })).rejects.toThrow(/genericFonts/);
  });
});

describe('--generic-font (コマンド)', () => {
  it('serif・sans-serif・monospace・serif-cjk・sans-serif-cjk を受け付ける', () => {
    const a = parseArgs(['in.html', '--generic-font', 'monospace=Source Code Pro', '--generic-font', 'serif-cjk=BIZ UDMincho', '--generic-font', 'sans-serif-cjk=BIZ UDGothic', '--generic-font', 'serif=EB Garamond']);
    expect(a.genericFonts).toEqual({ monospace: 'Source Code Pro', 'serif-cjk': 'BIZ UDMincho', 'sans-serif-cjk': 'BIZ UDGothic', serif: 'EB Garamond' });
    expect(() => parseArgs(['in.html', '--generic-font', 'cursive=X'])).toThrow(/--generic-font/);
  });
});
