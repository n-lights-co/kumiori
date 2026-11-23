/**
 * epsInfo — EPS の処理のうち、本体が最初から使う軽い部分: 外接矩形の注釈 (画像の大きさの見積もり。imageInfo.ts)、
 * 文書あたりの時間の予算 (assets.ts・main.ts)、PostScript の書体の名前の読み (cgm.ts も使う)。
 *
 * PostScript の解釈系 (eps.ts・psInterp.ts・psGraphics.ts など) は、文書に EPS が出てきたときだけ読み込む (assets.ts の import())。
 * ここに置くものは解釈系を読まないので、EPS の無い文書では、解釈系を読み込まずに済む (画面・ブラウザ向けのライブラリでは、解釈系は別のチャンクになる)。
 * eps.ts は、ここのものを同じ名前で出し直す (前から eps.ts を読んでいた所は、そのまま使える)
 */
import { limits } from './limits';

/** DSC の注釈の外接矩形 [x0, y0, x1, y1] (pt)。%%HiResBoundingBox を優先し、無ければ %%BoundingBox。どちらも無ければ undefined */
export function epsBoundingBox(head: string): [number, number, number, number] | undefined {
  const m = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head) ?? /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head);
  if (!m) return undefined;
  // 数として読めない値 (1.2.3 は NaN) と、有限でない値 (何百桁もの数は Infinity) の外接矩形は、無いものとして扱う (EPS として読まない)。
  // そのまま通すと、幅・高さが NaN・Infinity の画像になり、PDF を書く所で文書の全体が誤りになる
  const box = m.slice(1).map(Number) as [number, number, number, number];
  return box.every(Number.isFinite) ? box : undefined;
}

/**
 * 1 つの文書 (画像の登録の入れ物 1 つ。assets.ts の AssetStore) で、EPS を実行して SVG にする時間の合計の上限 (ミリ秒)。
 * EPS 1 つごとの上限 (20 秒・512MB) だけでは、名前を変えて同じ EPS を何個も参照する文書 (8 個で 280 秒を超えた) が、個数の分だけ
 * 時間を使う。実在の EPS は 1 つが数十〜数百ミリ秒 (見本の docs/conformance の EPS は、どれも 1 秒未満) なので、60 秒は数百個の図を
 * 持つ文書でも届かない。使い切ったら、残りの EPS は実行しない (epsToSvg が undefined を返し、プレビューがあればプレビューで、
 * 無ければ描けない画像として警告に出す)
 */
export const EPS_DOCUMENT_MILLIS = 60_000;

/** 文書あたりの EPS の時間の予算 (EPS_DOCUMENT_MILLIS の説明) */
export class EpsBudget {
  // 既定は、呼び出しの上限 (limits.epsDocumentMs。既定 EPS_DOCUMENT_MILLIS)
  constructor(public millisLeft = limits().epsDocumentMs) {}
}
const budgets = new WeakMap<object, EpsBudget>();
/**
 * 予算を初めの値に戻す。画面 (main.ts) は、画像の入れ物を 1 つだけ作り、別の文書を開いても使い続ける (前に読んだ画像を残す) ので、
 * 文書を開くたびに戻す (戻さないと、「文書あたり」の予算が「画面を開いている間の合計」になり、重い EPS を何度か開いた後は、どの EPS も描けなくなる)
 */
export function resetEpsBudget(owner: object): void {
  budgets.delete(owner);
}
/** 文書 (画像の登録の入れ物など、文書ごとに 1 つのもの) に結び付けた予算。初めて引いたときに作る */
export function epsBudgetOf(owner: object): EpsBudget {
  let b = budgets.get(owner);
  if (!b) budgets.set(owner, (b = new EpsBudget()));
  return b;
}

/** PostScript の書体の名前から、SVG の font-family (系統) と太さ・斜体を決める */
export function fontFamilyOf(psName: string): { family: string; bold: boolean; italic: boolean } {
  const n = psName.replace(/^[A-Z]{6}\+/, '');
  const bold = /Bold|Black|Heavy|Demi|W[6-9]\b|-B\b/i.test(n);
  const italic = /Italic|Oblique/i.test(n);
  let family = 'sans-serif';
  if (/Courier|Mono|Consol/i.test(n)) family = 'monospace';
  else if (/Times|Roman|Serif|Garamond|Century|Minion|Georgia|Mincho|Ryumin|Ming|明朝/i.test(n) && !/Sans/i.test(n)) family = 'serif';
  else if (/Symbol/i.test(n)) family = 'serif';
  return { family, bold, italic };
}
