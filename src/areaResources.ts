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

/**
 * 書体で text を組む。右から左の並び (アラビア文字・ヘブライ文字など。fontkit は字形を左から右へ描く順に返す) は、字形ごとの字も返す
 * (texts。字形と同じ順)。fontkit は、字形の置き換え (GSUB) の後、字形ごとに、元の字 (符号位置の並び。合字は成分の字すべて、
 * 1 字を分けた字形は最初の字形だけ) を付けて字形を作る (font.getGlyph(番号, 符号位置))。字形のオブジェクトは番号ごとに 1 つを使い回すので、
 * 字形から後で字を引くことはできない (同じ字形を別の字に使う: 点の無い ب の字形を ب・ت・ث に使うなど)。作るときの呼び出しを見て写し取る
 */
function layoutWithGlyphTexts(fk: LoadedFont['fk'], text: string, feats: Record<string, boolean>): { run: ReturnType<LoadedFont['fk']['layout']>; texts?: string[] } {
  if (!RTL_SCRIPT.test(text)) return { run: fk.layout(text, feats as never) };
  const host = fk as unknown as { getGlyph(id: number, cps?: number[]): unknown };
  const orig = host.getGlyph;
  const calls: Array<{ id: number; cps: number[] }> = [];
  host.getGlyph = function (this: unknown, id: number, cps?: number[]) {
    calls.push({ id, cps: cps ? [...cps] : [] });
    return orig.call(this, id, cps);
  };
  let run: ReturnType<LoadedFont['fk']['layout']>;
  try {
    run = fk.layout(text, feats as never);
  } finally {
    host.getGlyph = orig;
  }
  const n = run.glyphs.length;
  if ((run as unknown as { direction?: string }).direction !== 'rtl' || n < 2 || calls.length < n) return { run };
  // 置き換えの後の字形を作る n 回の呼び出し (字の順。描く順はその逆) を、後ろから探す (その後ろに、空白の字形を引く呼び出しなどが続く)。
  // 番号の並びが合うものが無ければ (fontkit の作りが変わったとき) 使わない
  for (let end = calls.length; end >= n; end--) {
    const win = calls.slice(end - n, end).reverse();
    // 描かない字 (ZWNJ など) の字形は、fontkit が後で空白の字形に替えるので、番号が違ってよい
    const same = (c: { id: number; cps: number[] }, k: number) => c.id === run.glyphs[k].id || (c.cps.length > 0 && c.cps.every((cp) => DEFAULT_IGNORABLE.test(String.fromCodePoint(cp))));
    if (win.every(same)) return { run, texts: win.map((c) => String.fromCodePoint(...c.cps)) };
  }
  return { run };
}
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
/** 右から左に組む文字を含みうる文字列 (ヘブライ文字・アラビア文字・シリア文字・ターナ文字・ンコ文字など、提示形、補助面の右から左の文字) */
const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** tree.resources と、字の fontId・glyphIds を付ける */
export function attachResources(tree: AreaTree, fonts: FontManager, assets?: AssetStore): void {
  const fontRes = new Map<string, FontResource>();
  const images = new Map<string, ImageResource>();
  const glyphCache = new Map<LoadedFont, Map<string, { ids: number[]; pos?: Array<[number, number, number]>; texts?: string[] }>>();
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
        const feats = { kern: false, liga: false, clig: false, ...Object.fromEntries((a.features ?? []).map((x) => [x, true])) };
        const shaped = layoutWithGlyphTexts(f.fk, text, feats);
        const run = shaped.run;
        const ids = run.glyphs.map((g) => g.id);
        // 縦書き用の字形の並び (正立の字のクラスタ) の位置は、横書きの位置 (uprightPositions)
        const positions = uprightPositions(f.fk, text, feats, run);
        // 右から左の並びは、字形ごとの字を付け、位置も必ず付ける (PDF が字形を 1 つずつ、その字とともに書く)
        const texts = ids.length > 1 ? shaped.texts : undefined;
        const adjusted = ids.length > 1 && (!!texts || positions.some((p, k) => p.xAdvance !== run.glyphs[k].advanceWidth || p.xOffset || p.yOffset));
        hit = { ids, ...(adjusted ? { pos: positions.map((p) => [p.xAdvance, p.xOffset, p.yOffset] as [number, number, number]) } : {}), ...(texts ? { texts } : {}) };
      } catch {
        hit = { ids: [] };
      }
      cache.set(key, hit);
    }
    if (hit.ids.length) a.glyphIds = hit.ids;
    if (hit.pos) a.glyphPositions = hit.pos;
    if (hit.texts) a.glyphTexts = hit.texts;
  });
  tree.resources = { fonts: [...fontRes.values()], images: [...images.values()] };
}
