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
 * ネットワークから (timeoutMs の時限つき。省けば時限なし)。相対パスの画像は、文書と一緒に渡したファイルから既に入っているので触らない。
 * 許さなかった URL を返す (呼ぶ側が警告にする)
 */
export async function fetchReportedImages(assets: AssetStore, images: readonly string[], allow: (url: string) => boolean, timeoutMs?: number): Promise<string[]> {
  const refused: string[] = [];
  for (const src of images) {
    if (assets.get(src)) continue;
    if (src.startsWith('data:')) await assets.addDataUri(src);
    else if (/^https?:/i.test(src)) {
      if (allow(src)) await assets.addUrl(src, timeoutMs);
      else refused.push(src);
    }
  }
  return refused;
}
