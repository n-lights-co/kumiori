/**
 * documentResources — 文書を組む前に用意する資源のうち、画面 (main.ts) と公開 API (api.ts) が同じ手順で行うもの:
 * MathML のある文書の数式用の書体の読み込みと、読み込みの報告にある data URI・http(s) の画像の取得。
 * (以前は main.ts と api.ts に同じ手順が別々に書かれていた)
 */
import type { FontManager } from './fontManager';
import type { AssetStore } from './assets';
import { readMathFont, type FkFont, type MathFont } from './mathFont';
import { MATH_SPEC, MATHML_HINT } from './fontMapping';
import { SERIF } from './sampleData';
import { fetchGuarded, type FetchedResource } from './resources';
import { fetchLimits } from './imageLimits';

/** 読み込み (importXslFo・importHtml) に渡す数式の設定 */
export type MathOptions = { mathFont?: MathFont; mathFallback?: (ch: string) => FkFont | undefined };

/**
 * MathML のある文書 (MATHML_HINT) なら、数式用の書体 (MATH_SPEC) を load で読み込み、数式の設定を返す。
 * 読めなければ空 (数式は本文の書体で組む)。数式の書体に無い字 (和字など) は本文の明朝の書体 (mathFallback) で描く
 */
export async function mathOptionsFor(text: string, fonts: FontManager, load: () => Promise<unknown>): Promise<MathOptions> {
  if (!MATHML_HINT.test(text)) return {};
  await load();
  if (!fonts.has(MATH_SPEC.family)) return {};
  return {
    mathFont: readMathFont(fonts.get(MATH_SPEC.family).fk as unknown as FkFont),
    mathFallback: (ch: string) => fonts.getForChar(SERIF, 400, ch).fk as unknown as FkFont,
  };
}

/**
 * 読み込みの報告にある画像 (report.images) のうち、まだ assets に無いものを取り込む: data URI はその場で、http(s) の URL は allow が許すものだけ
 * ネットワークから (timeoutMs の時限つき。省けば時限なし。転送の先の URL も allow に聞く)。相対パスの画像は、文書と一緒に渡したファイルから既に入っているので触らない。
 * 同じ URL は 1 度だけ試す (取れなかったものを取り直さない)。許さなかった URL を返す (呼ぶ側が警告にする。同じ URL は 1 つ)
 */
export async function fetchReportedImages(assets: AssetStore, images: readonly string[], allow: (url: string) => boolean, timeoutMs?: number): Promise<string[]> {
  const refused: string[] = [];
  const remote: string[] = [];
  // 同じ URL は 1 度だけ試す: 取れなかった URL (assets に入らない) を、出てくるたびに時限まで待って取り直さない
  for (const src of new Set(images)) {
    if (assets.get(src)) continue;
    if (src.startsWith('data:')) await assets.addDataUri(src);
    else if (/^https?:/i.test(src)) {
      if (allow(src)) remote.push(src);
      else refused.push(src);
    }
  }
  // ネットワークの画像は、同時に IMAGE_FETCH_PARALLEL 個まで取る (CSS・書体の取得 (resources.ts) と同じ数)。時限 (timeoutMs) があるときは、
  // 文書の画像の取得の全体にも時限を置く (1 つの時限の IMAGE_FETCH_BUDGET 倍)。1 つずつ順に取ると、応答しない URL を並べた文書
  // (1,000 個で 30 秒 × 1,000) が、何時間も取りに行き続ける。全体の時限を過ぎたら、残りは取らない (読めない画像として組み、警告に出る)
  const deadline = timeoutMs ? Date.now() + timeoutMs * IMAGE_FETCH_BUDGET : Infinity;
  // 取るのは同時に、登録は文書に出てきた順に行う (名前だけで引く参照には、後に登録した画像が当たる。取り終えた順で登録すると、
  // 同じ名前の画像のどれが当たるかが、応答の速さで変わってしまう)
  const got: Array<FetchedResource | undefined> = new Array(remote.length);
  let next = 0;
  const worker = async () => {
    while (next < remote.length) {
      const k = next++;
      const left = deadline - Date.now();
      if (left <= 0) return;
      got[k] = await fetchGuarded(remote[k], { timeoutMs: timeoutMs ? Math.min(timeoutMs, left) : undefined, maxBytes: fetchLimits.imageBytes, allow });
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_FETCH_PARALLEL, remote.length) }, worker));
  for (let k = 0; k < remote.length; k++) {
    const g = got[k];
    got[k] = undefined;
    // 画像として読めない中身は、取れなかった画像と同じ扱い (assets.addUrl と同じ)
    if (g) await assets.addBlob(remote[k], new Blob([g.bytes as BlobPart], { type: g.type })).catch(() => undefined);
  }
  return refused;
}

/** ネットワークの画像を同時に取る数 */
const IMAGE_FETCH_PARALLEL = 8;
/** 文書の画像の取得の全体の時限 (1 つの取得の時限の何倍か。既定の 30 秒なら 5 分) */
const IMAGE_FETCH_BUDGET = 10;
