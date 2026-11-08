/**
 * areaResources — 組版の結果 (AreaTree) に、使う書体・画像の一覧と、字ごとの字形の番号を付ける。
 *
 * 字形の番号は、PDF に書くときと同じやり方 (字を書体の OpenType の機能で組む。改行しない空白は空白の字形) で決める。
 * 書体・画像は、ファイルのバイト列の SHA-256 で識別する。
 */
import type { AssetStore } from './assets';
import type { FontManager, LoadedFont } from './fontManager';
import { walkAreaTree } from './areaTree';
import { sha256 } from './sha256';
import type { AreaTree, FontResource, ImageResource } from './types';

const fontHash = new WeakMap<ArrayBuffer, string>();
const imageHash = new WeakMap<Uint8Array, string>();

function hashFont(f: LoadedFont): string {
  let h = fontHash.get(f.buffer);
  if (!h) fontHash.set(f.buffer, (h = sha256(new Uint8Array(f.buffer))));
  return h;
}

/** tree.resources と、字の fontId・glyphIds を付ける */
export function attachResources(tree: AreaTree, fonts: FontManager, assets?: AssetStore): void {
  const fontRes = new Map<string, FontResource>();
  const images = new Map<string, ImageResource>();
  const glyphCache = new Map<LoadedFont, Map<string, { ids: number[]; pos?: Array<[number, number, number]> }>>();
  const addImage = (src: string) => {
    if (images.has(src)) return;
    const a = assets?.get(src);
    let h: string | undefined;
    if (a?.bytes) {
      h = imageHash.get(a.bytes);
      if (!h) imageHash.set(a.bytes, (h = sha256(a.bytes)));
    }
    images.set(src, { src, ...(a?.mime ? { mime: a.mime } : {}), ...(h ? { sha256: h } : {}), ...(a ? { width: a.width, height: a.height } : {}) });
  };
  walkAreaTree(tree, (a) => {
    if (a.type === 'image' && a.src) addImage(a.src);
    if (a.backgroundImage?.src) addImage(a.backgroundImage.src);
    if (a.type !== 'glyph') return;
    const f = fonts.get(a.fontFamily, a.fontWeight);
    if (!f) return;
    if (!fontRes.has(f.key))
      fontRes.set(f.key, { id: f.key, family: f.family, weight: f.weight, ...(f.postscriptName ? { postscriptName: f.postscriptName } : {}), sha256: hashFont(f), unitsPerEm: f.unitsPerEm });
    a.fontId = f.key;
    let cache = glyphCache.get(f);
    if (!cache) glyphCache.set(f, (cache = new Map()));
    const text = a.text.replace(/ /g, ' ');
    const key = text + '\u0000' + (a.features ?? []).join(',');
    let hit = cache.get(key);
    if (!hit) {
      try {
        // 測るとき (measurer.ts) と同じ機能の組で組む (字の間の kern・任意の合字は、組版が別に扱う)
        const run = f.fk.layout(text, { kern: false, liga: false, clig: false, ...Object.fromEntries((a.features ?? []).map((x) => [x, true])) } as never);
        const ids = run.glyphs.map((g) => g.id);
        const adjusted = ids.length > 1 && run.positions.some((p, k) => p.xAdvance !== run.glyphs[k].advanceWidth || p.xOffset || p.yOffset);
        hit = { ids, ...(adjusted ? { pos: run.positions.map((p) => [p.xAdvance, p.xOffset, p.yOffset] as [number, number, number]) } : {}) };
      } catch {
        hit = { ids: [] };
      }
      cache.set(key, hit);
    }
    if (hit.ids.length) a.glyphIds = hit.ids;
    if (hit.pos) a.glyphPositions = hit.pos;
  });
  tree.resources = { fonts: [...fontRes.values()], images: [...images.values()] };
}
