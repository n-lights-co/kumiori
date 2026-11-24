/**
 * documentResources — 文書を組む前に用意する資源のうち、画面 (main.ts) と公開 API (api.ts) が同じ手順で行うもの:
 * MathML のある文書の数式用の書体の読み込みと、読み込みの報告にある data URI・http(s) の画像の取得。
 * (以前は main.ts と api.ts に同じ手順が別々に書かれていた)
 */
import { limits } from './limits';
import type { FontManager } from './fontManager';
import type { AssetStore } from './assets';
import { readMathFont, type FkFont, type MathFont } from './mathFont';
import { MATH_SPEC, MATHML_HINT } from './fontMapping';
import { SERIF } from './sampleData';
import { fetchGuarded, resolveRef, type FetchedResource } from './resources';
import { fetchLimits } from './imageLimits';
import { hrefOfTag } from './xmlAttr';
import { rejoin, thisCall } from './callContext';

/** 読み込み (importXslFo・importHtml) に渡す数式の設定 */
export type MathOptions = { mathFont?: MathFont; mathFallback?: (ch: string) => FkFont | undefined };

/**
 * MathML のある文書 (MATHML_HINT) なら、数式用の書体 (MATH_SPEC) を load で読み込み、数式の設定を返す。
 * 読めなければ空 (数式は本文の書体で組む)。数式の書体に無い字 (和字など) は本文の明朝の書体 (mathFallback) で描く
 */
export async function mathOptionsFor(text: string, fonts: FontManager, load: () => Promise<unknown>): Promise<MathOptions> {
  if (!MATHML_HINT.test(text)) return {};
  rejoin(thisCall(), await load());
  if (!fonts.has(MATH_SPEC.family)) return {};
  return {
    mathFont: readMathFont(fonts.get(MATH_SPEC.family).fk as unknown as FkFont),
    mathFallback: (ch: string) => fonts.getForChar(SERIF, 400, ch).fk as unknown as FkFont,
  };
}

/**
 * 読み込みの報告にある画像 (report.images) のうち、まだ assets に無いものを取り込む: fragment の付いた参照は、fragment の無い参照の画像から
 * (本体の外の形式の画像だけ。AssetStore.addFragment)、data URI はその場で、http(s) の URL は allow が許すものだけ
 * ネットワークから (timeoutMs の時限つき。省けば時限なし。転送の先の URL も allow に聞く)。相対パスの画像は、文書と一緒に渡したファイルから既に入っているので触らない。
 * 同じ URL は 1 度だけ試す (取れなかったものを取り直さない)。許さなかった URL を返す (呼ぶ側が警告にする。同じ URL は 1 つ)。
 * SVG の画像 (インラインの svg を data: にしたもの・文書と一緒に渡した SVG・取った SVG) の中の image 要素が http(s) の URL
 * (SVG の場所を基準に引いたもの) を指すときは、その画像も同じ決まり (allow) で取る (SVG 1.1 §5.7 の image 要素。前は取りに行かず、
 * 許さなかったとも言わずに「見つからない」にした)。取るのは 1 段だけ (SVG の中の image は PNG・JPEG などだけを描くので、その先は無い)
 */
export async function fetchReportedImages(assets: AssetStore, images: readonly string[], allow: (url: string) => boolean, timeoutMs?: number): Promise<string[]> {
  const refused: string[] = [];
  const remote: string[] = [];
  const total = limits().imageFetchTotalMs || (timeoutMs ? timeoutMs * IMAGE_FETCH_BUDGET : 0);
  const deadline = total ? Date.now() + total : Infinity;
  const seen = new Set(images);
  // 同じ URL は 1 度だけ試す: 取れなかった URL (assets に入らない) を、出てくるたびに時限まで待って取り直さない
  for (const src of seen) {
    // fragment の付いた参照 (図.drawio#page=2): fragment の無い参照で読んだ画像があれば、その形式に fragment を渡して読み直す (assets.addFragment)。
    // assets.get はファイル名でも引く (# の後ろを落とす) ので、fragment の無い画像が当たっても、先に作る
    if (rejoin(thisCall(), await assets.addFragment(src))) continue;
    if (assets.get(src)) continue;
    if (src.startsWith('data:')) rejoin(thisCall(), await assets.addDataUri(src));
    else if (/^https?:/i.test(src)) {
      if (allow(src)) remote.push(src);
      else refused.push(src);
    }
  }
  // ネットワークの画像は、同時に IMAGE_FETCH_PARALLEL 個まで取る (CSS・書体の取得 (resources.ts) と同じ数)。時限 (timeoutMs) があるときは、
  // 文書の画像の取得の全体にも時限を置く (1 つの時限の IMAGE_FETCH_BUDGET 倍)。1 つずつ順に取ると、応答しない URL を並べた文書
  // (1,000 個で 30 秒 × 1,000) が、何時間も取りに行き続ける。全体の時限を過ぎたら、残りは取らない (読めない画像として組み、警告に出る)
  // 全体の時限は、呼び出しの上限 (limits.imageFetchTotalMs) があればそれ、無ければ 1 つの時限の IMAGE_FETCH_BUDGET 倍 (SVG の中の画像の取得も含めて)
  rejoin(thisCall(), await fetchRemote(assets, remote, allow, timeoutMs, deadline));
  // SVG の画像の中の image 要素の http(s) の画像 (2 段目)
  // 重なりの確かめは Set で (並びは配列のまま)
  const inner: string[] = [];
  const innerSet = new Set<string>();
  const refusedSet = new Set(refused);
  for (const src of seen) {
    const a = assets.get(src);
    if (!a?.bytes || a.mime !== 'image/svg+xml') continue;
    for (const href of svgImageRefs(new TextDecoder().decode(a.bytes))) {
      const url = resolveRef(href, /^data:/i.test(src) ? undefined : src);
      if (!/^https?:/i.test(url) || seen.has(url) || innerSet.has(url) || assets.get(url)) continue;
      if (allow(url)) {
        inner.push(url);
        innerSet.add(url);
      } else if (!refusedSet.has(url)) {
        refused.push(url);
        refusedSet.add(url);
      }
    }
  }
  rejoin(thisCall(), await fetchRemote(assets, inner, allow, timeoutMs, deadline));
  return refused;
}

/** remote の URL の画像を、同時に IMAGE_FETCH_PARALLEL 個まで取って、出てきた順に登録する (deadline を過ぎたら残りは取らない) */
async function fetchRemote(assets: AssetStore, remote: readonly string[], allow: (url: string) => boolean, timeoutMs: number | undefined, deadline: number): Promise<void> {
  if (!remote.length) return;
  // 取るのは同時に、登録は文書に出てきた順に行う (名前だけで引く参照には、後に登録した画像が当たる。取り終えた順で登録すると、
  // 同じ名前の画像のどれが当たるかが、応答の速さで変わってしまう)
  const got: Array<FetchedResource | undefined> = new Array(remote.length);
  let next = 0;
  const worker = async () => {
    while (next < remote.length) {
      const k = next++;
      const left = deadline - Date.now();
      if (left <= 0) return;
      got[k] = rejoin(thisCall(), await fetchGuarded(remote[k], { timeoutMs: timeoutMs ? Math.min(timeoutMs, left) : undefined, maxBytes: fetchLimits.imageBytes, allow }));
    }
  };
  rejoin(thisCall(), await Promise.all(Array.from({ length: Math.min(IMAGE_FETCH_PARALLEL, remote.length) }, worker)));
  for (let k = 0; k < remote.length; k++) {
    const g = got[k];
    got[k] = undefined;
    // 画像として読めない中身は、取れなかった画像と同じ扱い (assets.addUrl と同じ)
    if (g) rejoin(thisCall(), await assets.addBlob(remote[k], new Blob([g.bytes as BlobPart], { type: g.type })).catch(() => undefined));
  }
}

/**
 * SVG の文の中の image 要素の href (xlink:href)。data: は除く。layoutEngine.ts の svgMissingImages (見つからない画像の警告) と同じ読み方
 * (要素の開きのタグを字面で探す。名前空間の接頭辞の付いた svg:image も)
 */
export function svgImageRefs(text: string): string[] {
  // 重なりは Set で除く (配列の includes だと、違う参照の数の 2 乗の手間になる)。並びは出てきた順
  const out = new Set<string>();
  for (const m of text.matchAll(/<(?:[\w-]+:)?image\b[^>]*>/gi)) {
    const href = hrefOfTag(m[0]);
    if (href && !/^data:/i.test(href)) out.add(href);
  }
  return [...out];
}

/** ネットワークの画像を同時に取る数 */
const IMAGE_FETCH_PARALLEL = 8;
/** 文書の画像の取得の全体の時限 (1 つの取得の時限の何倍か。既定の 30 秒なら 5 分) */
export const IMAGE_FETCH_BUDGET = 10;
