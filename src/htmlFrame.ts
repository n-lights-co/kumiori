/**
 * htmlFrame — 画面で HTML を読み、スタイルを確定させる (htmlImport の ① の部分。ブラウザ専用)。
 *
 *  - noFrame (既定の「CSS の解釈: Kumiori」): iframe を使わない。HTML は DOMParser で読み、計算値は自前のカスケード (cssCascade) で決める
 *    (ブラウザの配置 rect は無い。Node のコマンドと同じ)
 *  - noFrame でないとき (「CSS の解釈: ブラウザ」。比較用): 見えない iframe に読み込み、ブラウザの計算値と配置を使う
 *
 * どちらでも (CSS の集め方は htmlPrepare で共通):
 *  - スクリプトは実行しない (sandbox。<script> も取り除く)
 *  - <link rel="stylesheet"> は、一緒に選んだ CSS ファイルの中身を <style> にして差し込む (ファイル名で突き合わせる)。
 *    参照されていない CSS ファイルは、利用者のスタイルシートとして文書の CSS の後に足す
 *  - 既定のスタイル: browser はブラウザの既定のまま、kumiori は本の組版向けの既定 (KUMIORI_BOOK_CSS) を作成者スタイルシート より前に入れる。
 *    ah はアンテナハウスと同じ CSS 2.1 の既定のスタイルシート (CSS21_DEFAULT_CSS) を入れる。
 *    browser-margin 以外は、印刷向けに body の余白を 0 にする (PRINT_UA_CSS。Vivliostyle・アンテナハウスと同じ)。
 *    browser-margin は、ブラウザの印刷・WeasyPrint と同じく 8px を残す
 *  - ブラウザ経由のとき、iframe の幅は本文の幅にする (百分率の幅などを、ページに合わせて確定させる。自前のカスケードでは viewport の幅)
 */
import type { StyleSource } from './htmlImport';
import { cascadeStyles, HTML_UA_CSS } from './cssCascade';
import { ahCascadeOptions } from './compat';
import { documentMode, prepareHtml, type HtmlDefaults } from './htmlPrepare';

export { KUMIORI_BOOK_CSS, PRINT_UA_CSS, CSS21_DEFAULT_CSS, type HtmlDefaults } from './htmlPrepare';

export interface LoadedHtml {
  doc: Document;
  styles: StyleSource;
  /** 文書の CSS の文字列 (既定のスタイル + <style> + 差し込んだ CSS ファイル)。@page を読むのに使う */
  css: string;
  /** 使い終わったら iframe を消す */
  dispose(): void;
}

/** %xx を戻す。不正な % の並び (100%.css など) は、そのままにする */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const basename = (s: string) => safeDecode(s.split(/[?#]/)[0].split('/').pop() ?? s).toLowerCase();

/**
 * HTML の文字列と一緒に選んだファイル (CSS) から、スタイルを確定させた文書を作る。
 * pageCss: ページの大きさ・余白を読むための CSS (無ければ文書の CSS から読む)
 */
export async function loadHtml(
  html: string,
  files: File[],
  defaults: HtmlDefaults,
  defaultPage = { width: 210, height: 297, margin: 20 },
  opts: { noFrame?: boolean } = {},
): Promise<LoadedHtml> {
  const { doc: parsed, css, uaSheet, authorSheet, bodyWidthPx, pageHeightPx } = await prepareHtml(html, files, defaults, defaultPage, (t) => new DOMParser().parseFromString(t, 'text/html'));
  // @font-face の書体のファイルは、一緒に選んだファイルの blob URL にする (iframe の中でも書体を読み、その字幅で flex・grid などを置かせる)
  const fontFiles = new Map(files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name)).map((f) => [f.name.toLowerCase(), f]));
  const fontUrls = new Map<string, string>();
  const fontUrl = (u: string) => {
    const name = basename(u);
    const f = fontFiles.get(name);
    if (!f) return undefined;
    if (!fontUrls.has(name)) fontUrls.set(name, URL.createObjectURL(f));
    return fontUrls.get(name);
  };
  // iframe に入れる CSS だけを置き換える (Kumiori が読む CSS は元のファイル名のまま。@font-face をファイル名で突き合わせる)
  const withFonts = (text: string) =>
    text.replace(/@font-face\s*\{[^}]*\}/gi, (block) =>
      block.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, _q: string, u: string) => {
        const url = fontUrl(u);
        return url ? `url("${url}")` : m;
      }),
    );
  if (!opts.noFrame) parsed.querySelectorAll('style').forEach((s) => (s.textContent = withFonts(s.textContent ?? '')));
  // 画像 (<img>) は、元のパスを data-kumiori-src に残し、iframe では一緒に選んだファイルの blob URL にする
  // (iframe の中で画像の大きさが決まり、max-width などが効いた大きさを読める。Kumiori の画像はファイル名で突き合わせる)
  const imageFiles = new Map(files.filter((f) => /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(f.name)).map((f) => [f.name.toLowerCase(), f]));
  parsed.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const f = imageFiles.get(basename(src));
    if (!f) return;
    img.setAttribute('data-kumiori-src', src);
    if (opts.noFrame) return;
    if (!fontUrls.has('img:' + f.name)) fontUrls.set('img:' + f.name, URL.createObjectURL(f));
    img.setAttribute('src', fontUrls.get('img:' + f.name)!);
  });

  // iframe を使わない: 読んだ文書に、自前のカスケードの計算値 (vw・vh と根元の幅は、ページの領域の大きさ)
  if (opts.noFrame) {
    return {
      doc: parsed,
      styles: cascadeStyles(parsed, authorSheet, { uaCss: HTML_UA_CSS, uaExtraCss: uaSheet, quirksMode: documentMode(parsed), viewport: { width: Math.max(bodyWidthPx, 100), height: pageHeightPx }, ...(defaults === 'ah' ? ahCascadeOptions(css) : {}) }),
      css,
      dispose: () => {
        for (const u of fontUrls.values()) URL.revokeObjectURL(u);
      },
    };
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:absolute;left:-100000px;top:0;width:${Math.max(bodyWidthPx, 100)}px;height:${Math.round(pageHeightPx)}px;border:0;visibility:hidden`;
  document.body.append(frame);
  await new Promise<void>((res) => {
    frame.onload = () => res();
    frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
  });
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  // 書体の読み込み (@font-face) を待つ
  await doc.fonts?.ready;
  const styles: StyleSource = {
    style: (el, pseudo) => win.getComputedStyle(el, pseudo),
    rect: (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + win.scrollX, y: r.top + win.scrollY, width: r.width, height: r.height };
    },
    isAuto: (el, prop) => {
      const map = (el as Element & { computedStyleMap?: () => { get(p: string): unknown } }).computedStyleMap?.();
      if (!map) return undefined;
      const v = map.get(prop) as { value?: unknown } | undefined;
      return typeof v?.value === 'string' ? v.value === 'auto' : false;
    },
  };
  return {
    doc,
    styles,
    css,
    dispose: () => {
      frame.remove();
      for (const u of fontUrls.values()) URL.revokeObjectURL(u);
    },
  };
}
