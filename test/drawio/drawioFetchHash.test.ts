/**
 * draw.io の配布物を既定の取り先 (版を決めたタグの URL) から取るとき、取った中身を、版の SHA-256 の一覧 (src/drawio/drawioHashes.ts。
 * scripts/drawio-hashes.mjs で作る) と照らし、合わない・一覧に無いものは使わずに警告する (タグは付け替えられるので、中身で決める)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typeset, type FontSpec } from 'kumiori';
import { DRAWIO_HASHES, DRAWIO_HASH_TAG } from '../../src/drawio/drawioHashes';
import { base64url, checkPinned } from '../../src/drawio/drawioPin';
import { DRAWIO_STENCILS_PATH, DRAWIO_STENCILS_URL, drawioImageUrl, isDrawioImagePath } from '../../src/drawio/drawioStencil';
import { cachedFetcher } from '../../src/drawio/nodeFiles';
import { sha256 } from '../../src/sha256';
import { ensureFonts, fontDir } from '../helpers';

const LIBRARY = `<shapes name="mxgraph.test"><shape name="Box" w="10" h="10" aspect="variable"><background><rect x="0" y="0" w="10" h="10"/></background><foreground><fillstroke/></foreground></shape></shapes>`;
const model = (cells: string) => `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const cell = (id: string, style: string) => `<mxCell id="${id}" value="" style="${style}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell>`;

/** 一覧の道 (js/stencils.min.js・img/…) */
const listed = (): string[] => {
  const out: string[] = [];
  let dir = '';
  for (const line of DRAWIO_HASHES.split('\n')) {
    if (line.endsWith('/')) dir = line;
    else out.push(dir + line.slice(0, -44));
  }
  return out;
};

describe('draw.io の配布物の SHA-256 の一覧', () => {
  it('一覧の版は、既定の取り先 (DRAWIO_STENCILS_URL) のタグと同じ。図形ライブラリと、配布物の画像の道を持つ', () => {
    expect(DRAWIO_STENCILS_URL).toContain(`/jgraph/drawio/${DRAWIO_HASH_TAG}/`);
    const paths = listed();
    expect(paths[0]).toBe(DRAWIO_STENCILS_PATH);
    expect(paths.length).toBeGreaterThan(1000);
    expect(new Set(paths).size).toBe(paths.length);
    // 画像は、配布物の画像として認める道 (isDrawioImagePath) のものがほとんど (名前の空白も含む)
    expect(paths.filter((p) => p.startsWith('img/') && isDrawioImagePath(p)).length).toBeGreaterThan(1800);
    expect(paths).toContain('img/lib/allied_telesis/computer_and_terminals/Personal Computer Wireless.svg');
  });

  it('SHA-256 の base64url は、Node の crypto と同じ (RFC 4648 §5。詰め物の = は無し)', () => {
    for (const n of [0, 1, 2, 3, 100, 1000]) {
      const b = crypto.randomBytes(n);
      expect(base64url(sha256(b))).toBe(crypto.createHash('sha256').update(b).digest('base64url'));
    }
  });

  it('既定の取り先の中身だけを照らす: 別の取り先は照らさない。合わない中身・一覧に無いファイルを見分ける', () => {
    const fake = new TextEncoder().encode(LIBRARY);
    expect(checkPinned(DRAWIO_STENCILS_PATH, 'https://example.com/w/js/stencils.min.js', fake)).toBe('unpinned');
    expect(checkPinned(DRAWIO_STENCILS_PATH, DRAWIO_STENCILS_URL, fake)).toBe('mismatch');
    expect(checkPinned('img/lib/sap/Foo.svg', drawioImageUrl('img/lib/sap/Foo.svg'), fake)).toBe('unlisted');
    expect(checkPinned('img/lib/sap/Foo.svg', drawioImageUrl('img/lib/sap/Foo.svg', 'https://example.com/w/js/stencils.min.js'), fake)).toBe('unpinned');
    const p = 'img/lib/allied_telesis/computer_and_terminals/Personal Computer Wireless.svg';
    expect(checkPinned(p, drawioImageUrl(p), fake)).toBe('mismatch');
  });
});

describe('既定の取り先から取った中身を照らす (組版)', () => {
  const loadFont = async (spec: FontSpec) => {
    const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
    if (!fs.existsSync(f)) return undefined;
    const b = fs.readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  beforeAll(async () => {
    await ensureFonts([...DEFAULT_FONTS.base]);
  }, 300_000);
  const html = '<p><img src="fig.drawio"></p>';

  it('一覧と合わない図形ライブラリ・一覧に無い画像は使わずに警告する (取れないの警告は重ねない)。別の取り先なら照らさない', async () => {
    const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>';
    const fig = model(cell('a', 'shape=mxgraph.test.box;') + cell('b', 'shape=image;image=img/lib/clip_art/a/b.svg;'));
    const asked: string[] = [];
    const fetchStencils = async (p: string, { url }: { url: string }) => (asked.push(url), p.endsWith('.svg') ? svgIcon : LIBRARY);
    const r = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: { fetchStencils } });
    expect(asked.sort()).toEqual([drawioImageUrl('img/lib/clip_art/a/b.svg'), DRAWIO_STENCILS_URL]);
    const w = r.warnings.filter((x) => /draw\.io|drawio/.test(x));
    expect(w).toContain(`draw.io の配布物 (${DRAWIO_HASH_TAG}) から取ったファイルの中身が、版の SHA-256 の一覧と合わないので使いません (fetchStencils): js/stencils.min.js`);
    expect(w).toContain(`draw.io の配布物 (${DRAWIO_HASH_TAG}) の SHA-256 の一覧に無いファイルなので使いません (fetchStencils): img/lib/clip_art/a/b.svg`);
    expect(w.some((x) => x.includes('を取れません'))).toBe(false);
    // 使わなかったので、形は描けない
    expect(w.some((x) => x.includes('mxgraph.test.box') && x.includes('描けない'))).toBe(true);
    // 英語の文
    const en = await typeset(html, { loadFont, lang: 'en', files: [{ name: 'fig.drawio', data: fig }], drawio: { fetchStencils } });
    expect(en.warnings).toContain(`the file fetched from draw.io's distribution (${DRAWIO_HASH_TAG}) does not match the SHA-256 listed for that version, so it is not used (fetchStencils): js/stencils.min.js`);
    expect(en.warnings).toContain(`the file is not in the SHA-256 list of draw.io's distribution (${DRAWIO_HASH_TAG}), so it is not used (fetchStencils): img/lib/clip_art/a/b.svg`);
    // 別の取り先 (stencilsUrl) なら照らさずに使う
    const other = await typeset(html, { loadFont, files: [{ name: 'fig.drawio', data: fig }], drawio: { stencilsUrl: 'https://example.com/w/js/stencils.min.js', fetchStencils } });
    expect(other.warnings.filter((x) => /draw\.io|drawio/.test(x))).toEqual([]);
  }, 60000);

  it('コマンドの覚え (cachedFetcher): 既定の取り先の、一覧と合わない中身は覚えず、合わない覚えは使わずに取り直す', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-drawio-hash-'));
    try {
      const f = cachedFetcher(dir);
      let calls = 0;
      const fetch = async () => (calls++, new TextEncoder().encode(LIBRARY));
      await f(DRAWIO_STENCILS_PATH, { url: DRAWIO_STENCILS_URL, fetch });
      expect(fs.readdirSync(dir)).toEqual([]);
      // 別の取り先なら覚える
      const other = 'https://example.com/w/js/stencils.min.js';
      await f(DRAWIO_STENCILS_PATH, { url: other, fetch });
      expect(fs.readdirSync(dir)).toHaveLength(1);
      // 既定の取り先の覚えに、合わない中身を置いても、使わずに取り直す
      const saved = path.join(dir, fs.readdirSync(dir)[0]);
      const pinnedName = path.basename(saved).replace(/-[0-9a-f]{16}\./, `-${crypto.createHash('sha256').update(DRAWIO_STENCILS_URL).digest('hex').slice(0, 16)}.`);
      fs.copyFileSync(saved, path.join(dir, pinnedName));
      calls = 0;
      await f(DRAWIO_STENCILS_PATH, { url: DRAWIO_STENCILS_URL, fetch });
      expect(calls).toBe(1);
      calls = 0;
      await f(DRAWIO_STENCILS_PATH, { url: other, fetch });
      expect(calls).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
