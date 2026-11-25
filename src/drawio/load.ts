/**
 * load — draw.io の図を、Kumiori の画像の形式の受け口 (ImageFormat.load) の形で読み込む (index.ts が、draw.io の図が出てきたときに import() する)。
 *
 * 1. 図を SVG にする (drawio.ts)。文字の幅は Kumiori の道具 (ctx.measureText: 描く書体で測る) で測る
 * 2. 足りない図形ライブラリ・draw.io の配布物の画像があれば、登録所 (DrawioState.provide) に求める
 *    (選択肢の stencils のファイルと、fetchStencils で許したときだけ取る配布物。provideStencils を渡されたら、それに求める)
 * 3. 図が URL (http(s)) で指す画像は、Kumiori の道具 (ctx.fetchResource: 文書の画像と同じ決まり) で取る
 * 4. 足りないものを得られたら、描き直す (大きさはセルの位置で決まるので変わらない)
 */

import type { ImageFormatContext, ImageFormatResult } from '../imageFormats';
import { drawioPage, drawioToSvg, type DrawioLimits } from './drawio';
import { MAX_DEPTH } from './drawioXml';
import { DRAWIO_STENCILS_PATH, DRAWIO_STENCILS_URL, drawioImageUrl, fetchDrawioImage, fetchStencilBundle, isDrawioImagePath, isRemoteImage, StencilRegistry, type Fetcher } from './drawioStencil';
import { checkPinned, DRAWIO_HASH_TAG } from './drawioPin';
import type { DrawioFile, DrawioFileData, DrawioOptions } from './options';
import { msgIn, type Lang } from './messages';
import { rejoin, thisCall } from '../callContext';

/** 1 つの形式 (選択肢) で取る、配布物の画像の数の上限 (図に書いた名前の数だけネットワークに行かせない) */
const MAX_BUNDLE_IMAGES = 200;
/** 1 つの図で取る、URL の画像の数の上限 */
const MAX_REMOTE_IMAGES = 200;

const bytesOf = (d: DrawioFileData): Uint8Array => (typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));
const textOf = (d: DrawioFileData) => (typeof d === 'string' ? d : new TextDecoder().decode(bytesOf(d)));

/**
 * 1 つのファイルを fragment の違う参照 (図.drawio#page=2・#名前 など) で読んだときに使い回す、描いた図。
 * 最後に描いたファイルの分だけ持つ。図形ライブラリ・配布物の画像に頼らずに描けた図 (足りないものの無い図) だけを入れる
 * (頼った図は、登録所の中身で変わりうるので、いつも描き直す)。文字の幅を測る道具と言語が同じときだけ使う
 */
interface RenderCache {
  bytes: Uint8Array;
  lang: string | undefined;
  measure: unknown;
  /** 描いたときの上限 (ImageFormatContext.limits の drawio*・formatSize。上限の違う呼び出しでは使い回さない) */
  limits: string;
  pages: Map<number, ImageFormatResult>;
}

/** 形式 (選択肢) ごとの状態 (図形ライブラリの登録所。1 度だけ作り、ネットワークから取るのも、それぞれ 1 回だけ) */
export interface DrawioState {
  provide(libraries: string[], images: string[], ctx: ImageFormatContext): Promise<StencilRegistry | undefined>;
  /** 描いた図 (RenderCache) */
  renders?: RenderCache;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const merged = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** ファイル (DrawioOptions.stencils の 1 つ) を登録所に足す。図形ライブラリ・配布物の画像として読めなければ false */
async function addStencilFile(registry: StencilRegistry, f: DrawioFile): Promise<{ name: string; ok: boolean }> {
  const name = f.name.split(/[\\/]/).pop()!;
  const data = typeof f.data === 'function' ? rejoin(thisCall(), await f.data()) : f.data;
  // 画像のファイル (.png・.jpg) は、図の画像 (draw.io の配布物の画像。ファイルの名前で引く) として足す (.svg は add が画像として足す)
  const ok = /\.(png|jpe?g)$/i.test(name) ? registry.addImage(name, bytesOf(data)) : !!registry.add(textOf(data), name);
  return { name, ok };
}

/** createDrawioStencilRegistry (index.ts) の中身: files を読んだ登録所。読めないファイルがあれば Error で拒む */
export async function createStencilRegistry(files: DrawioFile[], lang?: Lang): Promise<StencilRegistry> {
  const registry = new StencilRegistry();
  for (const f of files) {
    const { name, ok } = rejoin(thisCall(), await addStencilFile(registry, f));
    if (!ok) throw new Error(msgIn(lang, `draw.io の図形ライブラリとして読めません: ${name}`, `not a draw.io shape library: ${name}`));
  }
  return registry;
}

export function createState(options: DrawioOptions): DrawioState {
  if (options.provideStencils) {
    const provide = options.provideStencils;
    return { provide: (libraries, images) => provide(libraries, images) };
  }
  let registry: StencilRegistry | undefined;
  let fetched = false;
  const tried = new Set<string>();
  return {
    async provide(libraries, images, ctx) {
      const warn = (m: string) => ctx.warn?.(m);
      if (!registry) {
        registry = new StencilRegistry();
        for (const f of options.stencils ?? []) {
          const { name, ok } = rejoin(thisCall(), await addStencilFile(registry, f));
          if (!ok) warn(msgIn(ctx.lang, `draw.io の図形ライブラリとして読めません: ${name}`, `not a draw.io shape library: ${name}`));
        }
      }
      const fs = options.fetchStencils;
      const fetch: Fetcher | undefined = ctx.fetch;
      if (!fs || !fetch) return registry.empty ? undefined : registry;
      const bundleUrl = typeof fs === 'string' ? fs : (options.stencilsUrl ?? DRAWIO_STENCILS_URL);
      /** 配布物の中の道のファイル (関数なら呼ぶ。そうでなければ、配布物の URL からの道で取る) */
      const fetchFile = async (path: string, url: string): Promise<Uint8Array | undefined> => {
        if (typeof fs === 'function') {
          const d = rejoin(thisCall(), await fs(path, { url, fetch }).catch(() => undefined));
          return d === undefined ? undefined : bytesOf(d);
        }
        if (path === DRAWIO_STENCILS_PATH) return fetchStencilBundle(fetch, bundleUrl);
        return fetchDrawioImage(fetch, path, bundleUrl);
      };
      /**
       * 配布物の中の道のファイルを取る。取れなければ undefined。既定の取り先 (版を決めたタグの URL) から取ったものは、版の SHA-256 の
       * 一覧 (drawioPin.ts) と照らし、合わない (一覧に無い) ものは使わずに警告して null (取れないの警告は重ねない)。
       * 関数の fetchStencils も、既定の取り先の URL を渡したときは照らす (手元に覚えたものも、その版の中身であること)
       */
      const get = async (path: string): Promise<Uint8Array | undefined | null> => {
        const url = path === DRAWIO_STENCILS_PATH ? bundleUrl : drawioImageUrl(path, bundleUrl);
        const b = rejoin(thisCall(), await fetchFile(path, url));
        if (b === undefined) return undefined;
        const pin = checkPinned(path, url, b);
        if (pin === 'mismatch' || pin === 'unlisted') {
          const p = path.slice(0, 200);
          warn(
            pin === 'mismatch'
              ? msgIn(ctx.lang, `draw.io の配布物 (${DRAWIO_HASH_TAG}) から取得したファイルの中身が、そのバージョンの SHA-256 の一覧と合わないので使いません (fetchStencils): ${p}`, `the file fetched from draw.io's distribution (${DRAWIO_HASH_TAG}) does not match the SHA-256 listed for that version, so it is not used (fetchStencils): ${p}`)
              : msgIn(ctx.lang, `draw.io の配布物 (${DRAWIO_HASH_TAG}) の SHA-256 の一覧に無いファイルなので使いません (fetchStencils): ${p}`, `the file is not in the SHA-256 list of draw.io's distribution (${DRAWIO_HASH_TAG}), so it is not used (fetchStencils): ${p}`),
          );
          return null;
        }
        return b;
      };
      if (!fetched && libraries.some((l) => !registry!.hasLibrary(l))) {
        fetched = true;
        const b = rejoin(thisCall(), await get(DRAWIO_STENCILS_PATH));
        if (b !== null && (b === undefined || !registry.add(new TextDecoder().decode(b)))) warn(msgIn(ctx.lang, 'draw.io の図形ライブラリを取得できません (fetchStencils)', 'could not fetch the draw.io shape libraries (fetchStencils)'));
      }
      const want = images.filter((p) => isDrawioImagePath(p) && !registry!.image(p) && !tried.has(p)).slice(0, Math.max(0, (ctx.limits?.drawioImages ?? MAX_BUNDLE_IMAGES) - tried.size));
      for (const p of want) tried.add(p);
      const got = rejoin(thisCall(), await Promise.all(want.map((p) => get(p))));
      want.forEach((p, k) => {
        const b = got[k];
        if (b === null) return;
        if (b === undefined) warn(msgIn(ctx.lang, `draw.io の配布物の画像を取得できません (fetchStencils): ${p.slice(0, 200)}`, `could not fetch the image from draw.io's distribution (fetchStencils): ${p.slice(0, 200)}`));
        else if (!registry!.addImage(p, b)) warn(msgIn(ctx.lang, `draw.io の図の画像として読めません (PNG・JPEG・SVG でない): ${p.slice(0, 200)}`, `not a PNG, JPEG or SVG image for a draw.io diagram: ${p.slice(0, 200)}`));
      });
      return registry.empty ? undefined : registry;
    },
  };
}

export async function loadDrawio(bytes: Uint8Array, ctx: ImageFormatContext, state: DrawioState): Promise<ImageFormatResult | undefined> {
  // 描くページは、画像の参照の URL の fragment (ctx.fragment。drawio.ts の pageOf) で選ぶ。先にページの番号を決め、同じファイルの
  // 同じページ (fragment の書き方の違うもの・無いページを指して最初のページになるもの) は、描いた図を使い回す (RenderCache)。
  // 前は参照ごとに描き直したので、重い図を、無いページを指す fragment の違う 30 個の参照で指すと、30 回描いて 84.9 秒かかって落ちた
  // 上限 (TypesetOptions.limits。ImageFormatContext.limits): 図を SVG にする上限と、取る画像の数
  const lim = ctx.limits;
  const limits: DrawioLimits | undefined = lim ? { chars: lim.drawioChars, cells: lim.drawioCells, labelChars: lim.drawioLabelChars, svgChars: lim.drawioSvgChars, size: lim.formatSize, depth: Math.min(MAX_DEPTH, lim.nestingDepth) } : undefined;
  const limitsKey = limits ? JSON.stringify(limits) : '';
  const sel = drawioPage(bytes, ctx.fragment, ctx.lang, limits);
  if (!sel) return undefined;
  const measure = { ...(ctx.measureText ? { measureText: ctx.measureText } : {}), ...(ctx.lang ? { lang: ctx.lang } : {}), ...(sel.index > 0 ? { page: `page=${sel.index + 1}` } : {}), ...(limits ? { limits } : {}) };
  const c = state.renders;
  const same = !!c && c.lang === ctx.lang && c.measure === ctx.measureText && c.limits === limitsKey && sameBytes(c.bytes, bytes);
  const hit = same ? c!.pages.get(sel.index) : undefined;
  if (hit) return { ...hit, warnings: merged(sel.warnings, hit.warnings) };
  let r = drawioToSvg(bytes, measure);
  if (!r) return undefined;
  if (!r.missingLibraries.length && !r.missingImages.length) {
    const out: ImageFormatResult = { svg: r.svg, width: r.width, height: r.height, warnings: r.warnings };
    if (!same) state.renders = { bytes, lang: ctx.lang, measure: ctx.measureText, limits: limitsKey, pages: new Map() };
    state.renders!.pages.set(sel.index, out);
    return { ...out, warnings: merged(sel.warnings, out.warnings) };
  }
  // 足りない図形ライブラリ・配布物の画像があれば、登録所に求めて描き直す
  let reg = rejoin(thisCall(), await state.provide(r.missingLibraries, r.missingImages, ctx).catch(() => undefined));
  // URL の画像は、Kumiori が文書の画像と同じ決まりで取る
  const remote = r.missingImages.filter((p) => isRemoteImage(p) && !reg?.image(p)).slice(0, ctx.limits?.drawioImages ?? MAX_REMOTE_IMAGES);
  if (remote.length && ctx.fetchResource) {
    const got = rejoin(thisCall(), await Promise.all(remote.map((u) => ctx.fetchResource!(u).catch(() => undefined))));
    // 取った画像は、この呼び出しの間だけの層に入れる (state.provide の返す登録所は、選択肢を使い回す文書の間で共有される。
    // そこへ入れると、別の文書が、自分の fetchImages・resolveResource の決まりを通さずに、その画像を描いてしまう)
    if (got.some(Boolean)) reg = StencilRegistry.overlay(reg);
    remote.forEach((u, k) => {
      const b = got[k];
      if (!b) return;
      reg ??= new StencilRegistry();
      // PNG・JPEG・SVG でなければ足さない (描かずに警告が残る)
      reg.addImage(u, b);
    });
  }
  if (reg) r = drawioToSvg(bytes, { stencils: reg, ...measure }) ?? r;
  return { svg: r.svg, width: r.width, height: r.height, warnings: merged(sel.warnings, r.warnings) };
}
