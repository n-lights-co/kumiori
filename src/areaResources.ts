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

/** 書体で組んだ字形の位置 (fontkit の GlyphPosition の、使う欄) */
export interface ShapedPosition {
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

/**
 * 縦書き用の字形 (vert・vrt2) で組んだ 2 つ以上の字形の並び (正立の字の書記素クラスタ: か + U+3099 など) の、字形の位置。
 * 正立の字は、横書きと同じ原点 (基線の左端) で 1 字分の枠に描くので、字形どうしの位置は横書きのものを使う: 字形は縦書き用のまま、
 * 位置だけ、縦書きの機能を外して組んだものにする。書体によっては、GPOS の vert で結合文字を縦書きの原点 (字の上端の中央) に合わせて
 * ずらすので (Noto Serif JP の濁点 U+3099 など)、そのまま使うと結合文字が基底の字から 1 字分離れる。
 * 縦書きの機能が無いとき・字形が 1 つのとき・字形の数が変わるときは、run の位置のまま
 */
export function uprightPositions(fk: LoadedFont['fk'], text: string, features: Record<string, boolean>, run: { glyphs: unknown[]; positions: ShapedPosition[] }): ShapedPosition[] {
  if (run.glyphs.length < 2 || !(features.vert || features.vrt2)) return run.positions;
  try {
    const h = fk.layout(text, { ...features, vert: false, vrt2: false } as never);
    return h.glyphs.length === run.glyphs.length ? h.positions : run.positions;
  } catch {
    return run.positions;
  }
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
      fontRes.set(f.key, {
        id: f.key,
        family: f.family,
        weight: f.weight,
        ...(f.postscriptName ? { postscriptName: f.postscriptName } : {}),
        sha256: hashFont(f),
        unitsPerEm: f.unitsPerEm,
        // 可変フォントの実体: 軸の値と、元の書体のファイル (sha256 は、実体にした静的な書体のバイト列のもの)
        ...(f.instanceOf ? { variation: f.instanceOf.coords, sourceSha256: hashFont(f.instanceOf.master) } : {}),
      });
    a.fontId = f.key;
    let cache = glyphCache.get(f);
    if (!cache) glyphCache.set(f, (cache = new Map()));
    const text = a.text.replace(/ /g, ' ');
    const key = text + '\u0000' + (a.features ?? []).join(',');
    let hit = cache.get(key);
    if (!hit) {
      try {
        // 測るとき (measurer.ts) と同じ機能の組で組む (字の間の kern・任意の合字は、組版が別に扱う)
        const feats = { kern: false, liga: false, clig: false, ...Object.fromEntries((a.features ?? []).map((x) => [x, true])) };
        const run = f.fk.layout(text, feats as never);
        const ids = run.glyphs.map((g) => g.id);
        // 縦書き用の字形の並び (正立の字のクラスタ) の位置は、横書きの位置 (uprightPositions)
        const positions = uprightPositions(f.fk, text, feats, run);
        const adjusted = ids.length > 1 && positions.some((p, k) => p.xAdvance !== run.glyphs[k].advanceWidth || p.xOffset || p.yOffset);
        hit = { ids, ...(adjusted ? { pos: positions.map((p) => [p.xAdvance, p.xOffset, p.yOffset] as [number, number, number]) } : {}) };
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
