/**
 * pdfCheck — 入稿用の PDF (PDF/X) を書き出した後の検査。Ghent Workgroup の入稿の仕様 GWG 2022-R1 の要件のうち、
 * Kumiori の出力で起こりうるものを調べ、警告の文にする。書き出しの方針 (pdfStandard.ts) とは別にして、出力は変えない。
 *
 * GWG 2022-R1 は、ISO 15930-7 (PDF/X-4) の上に、用途 (variant) ごとの要件と値を足した仕様 (公開の表で読んだ。要件の番号 Rxxxx は
 * その表のもの)。値は、商業印刷の枚葉の CMYK の用途 (SheetCMYK CMYK) のものを使う。調べるもの:
 *  - R0004 (警告): 全ページの TrimBox を同じ大きさにする
 *  - R0020 (誤り。値 0): 特色を使わない。Cyan・Magenta・Yellow・Black・All・None は特色の名前に数えない (I00003)
 *  - R0031 (149ppi 以下は誤り、224ppi 以下は警告): 幅か高さが 16 画素を超える画像の実際の解像度
 * 調べないもの: 空のページ (R0005。本の作りで白ページは要るので)、ノセ (R0007〜R0013。書き出しの方針で満たす)、
 * 網点の総量 (R0026)、1 ビットの画像の解像度 (R0032)
 */
import { msg } from './messages';

/** 検査の値 (GWG 2022-R1 の用途ごとの値) */
export interface GwgVariant {
  /** 用途の名前 (警告に書く) */
  readonly name: string;
  /** 使ってよい特色の数 (R0020) */
  readonly maxSpots: number;
  /** 画像の実際の解像度: これ以下は誤り、warn 以下は警告 (R0031。ppi) */
  readonly imageError: number;
  readonly imageWarn: number;
}

/** 商業印刷の枚葉の CMYK の用途 (GWG 2022-R1 の SheetCMYK CMYK) */
export const GWG_SHEET_CMYK: GwgVariant = { name: 'SheetCMYK', maxSpots: 0, imageError: 149, imageWarn: 224 };

/** 検査に渡すもの */
export interface PdfCheckInput {
  /** ページごとの仕上がりの大きさ (TrimBox。pt) */
  trimSizes: ReadonlyArray<{ width: number; height: number }>;
  /** 埋め込んだ画像: 画素の数と、いちばん大きく置かれた大きさ (pt) */
  images: ReadonlyArray<{ src: string; pixels: { width: number; height: number }; placed: { width: number; height: number } }>;
  /** 使った特色の名前 */
  spots: Iterable<string>;
}

/** 特色の名前に数えない名前 (GWG 2022-R1 の I00003) */
const NOT_SPOTS = new Set(['Cyan', 'Magenta', 'Yellow', 'Black', 'All', 'None']);

/** 警告に書く画像の名前 (data: の URL は中身を書かない。長い名前は縮める) */
function imageName(src: string): string {
  if (/^data:/i.test(src)) return msg('(文書に埋め込まれた画像)', '(an image embedded in the document)');
  return src.length > 60 ? `…${src.slice(-59)}` : src;
}

/** mm の数 (小数 1 桁まで) */
const mm = (pt: number) => String(Math.round((pt * 25.4) / 72 * 10) / 10);

/** GWG 2022-R1 の要件に合わないものを、警告の文の並びにする */
export function gwgWarnings(input: PdfCheckInput, v: GwgVariant = GWG_SHEET_CMYK): string[] {
  const out: string[] = [];
  const head = (id: string) => msg(`GWG 2022 (${v.name}、${id})`, `GWG 2022 (${v.name}, ${id})`);
  // R0004: 仕上がりの大きさ (0.01pt 未満の違いは同じとみなす)
  const sizes = new Map<string, { width: number; height: number }>();
  for (const s of input.trimSizes) sizes.set(`${Math.round(s.width * 100)}x${Math.round(s.height * 100)}`, s);
  if (sizes.size > 1) {
    const list = [...sizes.values()].map((s) => `${mm(s.width)}×${mm(s.height)}mm`).join(msg('・', ', '));
    out.push(
      msg(
        `${head('R0004')}: ページの仕上がりの大きさ (TrimBox) が、ページによって違います (${list})。入稿では、全ページを同じ大きさにします`,
        `${head('R0004')}: the finished page size (TrimBox) differs between pages (${list}); for submission, make all pages the same size`,
      ),
    );
  }
  // R0020: 特色
  const spots = [...new Set(input.spots)].filter((n) => !NOT_SPOTS.has(n));
  if (spots.length > v.maxSpots) {
    out.push(
      msg(
        `${head('R0020')}: 特色を使っています (${spots.join('・')})。この用途では、特色は${v.maxSpots === 0 ? '使えません' : ` ${v.maxSpots} 色まで`}`,
        `${head('R0020')}: spot colors are used (${spots.join(', ')}); ${v.maxSpots === 0 ? 'this variant allows no spot colors' : `this variant allows up to ${v.maxSpots} spot color${v.maxSpots === 1 ? '' : 's'}`}`,
      ),
    );
  }
  // R0031: 画像の解像度 (幅か高さが 16 画素を超えるもの。縦横で低い方)
  for (const im of input.images) {
    if (im.pixels.width <= 16 && im.pixels.height <= 16) continue;
    if (im.placed.width <= 0 || im.placed.height <= 0) continue;
    const ppi = Math.min(im.pixels.width / (im.placed.width / 72), im.pixels.height / (im.placed.height / 72));
    const shown = Math.floor(ppi);
    if (ppi <= v.imageError) {
      out.push(
        msg(
          `${head('R0031')}: 画像 ${imageName(im.src)} の実際の解像度が ${shown}ppi です。${v.imageError}ppi を超える解像度が要ります (${v.imageWarn}ppi を超える解像度を勧めます)`,
          `${head('R0031')}: the effective resolution of image ${imageName(im.src)} is ${shown}ppi; more than ${v.imageError}ppi is required (more than ${v.imageWarn}ppi is recommended)`,
        ),
      );
    } else if (ppi <= v.imageWarn) {
      out.push(
        msg(
          `${head('R0031')}: 画像 ${imageName(im.src)} の実際の解像度が ${shown}ppi です。${v.imageWarn}ppi を超える解像度を勧めます`,
          `${head('R0031')}: the effective resolution of image ${imageName(im.src)} is ${shown}ppi; more than ${v.imageWarn}ppi is recommended`,
        ),
      );
    }
  }
  return out;
}
