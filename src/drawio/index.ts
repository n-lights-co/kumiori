/**
 * drawio — draw.io (diagrams.net) の図のファイル (.drawio・.dio) を読む、本体と一緒に配る画像の形式 (imageFormats.ts の IMAGE_FORMATS)。
 *
 *   const r = await typeset(html, { files, drawio: { fetchStencils: true } });
 *
 * 図のページを SVG にし、Kumiori が PDF に図形と文字のまま入れる。形・線・矢印は draw.io と mxGraph の公開のソース
 * (Apache License 2.0) を移して描く (THIRD_PARTY_NOTICES.md の 13 節)。このファイルで読むのは見分けだけで、図を描く処理 (約 0.9MB) は、
 * draw.io の図が出てきたときに import() する (CGM・EPS・WMF・EMF と同じ)
 */

import type { ImageFormat } from '../imageFormats';
import type { DrawioFile, DrawioOptions } from './options';
import type { StencilRegistry as DrawioStencilRegistry } from './drawioStencil';
import { DRAWIO_MIME, isDrawio } from './sniff';
import type { DrawioState } from './load';

export type { DrawioFile, DrawioFileData, DrawioOptions, DrawioStencilFetcher } from './options';
export { DRAWIO_MIME, isDrawio } from './sniff';
/**
 * 図形ライブラリの登録所 (DrawioOptions.provideStencils が返すもの。createDrawioStencilRegistry で作る)。
 * 作った後に足すときは add (ライブラリの XML・stencils.min.js・.svg の画像の文字列。2 つ目の引数はファイルの名前) と
 * addImage (配布物の中の道 img/lib/… かファイルの名前と、PNG・JPEG・SVG の中身) を使う。ほかのメソッドは版の間で変わることがある
 */
export type { StencilRegistry as DrawioStencilRegistry } from './drawioStencil';

/**
 * 図形ライブラリの登録所を作る (DrawioOptions.provideStencils で返すため)。files は DrawioOptions.stencils と同じ形
 * (stencils.min.js・ライブラリの XML・配布物の画像)。図形ライブラリ・画像として読めないファイルがあれば Error で拒む (lang: その文の言語)。
 * 図を描く処理と一緒に読み込む (import())
 */
export async function createDrawioStencilRegistry(files: DrawioFile[] = [], options: { lang?: 'ja' | 'en' } = {}): Promise<DrawioStencilRegistry> {
  const m = await import('./load');
  return m.createStencilRegistry(files, options.lang);
}

/** 画像の形式の名前 (描けない画像の警告に出す。形式の説明なので、ファイルの種類の名前にする) */
export const DRAWIO_FORMAT_NAME = 'draw.io';

/** 選択肢ごとに作った形式 (同じ選択肢のオブジェクトなら、図形ライブラリの登録所 (取ったもの) を、組むたびに作り直さずに使い回す) */
const made = new WeakMap<DrawioOptions, ImageFormat>();

/**
 * draw.io の図を読む画像の形式を作る。選択肢 (TypesetOptions.drawio) が同じオブジェクトなら、同じ形式を返す
 * (図形ライブラリの登録所と、取った図形ライブラリ・画像を使い回す)
 */
export function drawioFormat(options: DrawioOptions = {}): ImageFormat {
  const had = made.get(options);
  if (had) return had;
  let state: DrawioState | undefined;
  const format: ImageFormat = {
    name: DRAWIO_FORMAT_NAME,
    mime: DRAWIO_MIME,
    extensions: ['drawio', 'dio'],
    sniff: isDrawio,
    load: async (bytes, ctx) => {
      const m = await import('./load');
      state ??= m.createState(options);
      return m.loadDrawio(bytes, ctx, state);
    },
  };
  made.set(options, format);
  return format;
}

/** 既定の選択肢 (図形ライブラリを渡さず、取らない) の形式 (IMAGE_FORMATS に載せる) */
export const DRAWIO_FORMAT: ImageFormat = drawioFormat();
