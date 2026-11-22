/**
 * linkedom と、linkedom が使う構文解析器 htmlparser2 を読み込む (ブラウザに備わった DOMParser の無い所で、HTML・SVG を読むため)。
 *
 * ライブラリ (dist-lib) とコマンド (dist-cli) は Node で動かすので、名前を変数で渡して、その場で読み込む
 * (使う側のバンドラーが、ブラウザ向けに 1 つのファイルにまとめるときに、linkedom を取り込まずに済むように)。
 * ブラウザ向けの 1 ファイル (dist-browser) は、DOMParser の無い Web Worker の中でも組めるように、
 * linkedomModules.browser.ts に差し替えて、linkedom と htmlparser2 を、使うときだけ読む別のファイルとして取り込む (vite.browser.config.ts)
 */
const LINKEDOM = 'linkedom';
const HTMLPARSER2 = 'htmlparser2';

export const importLinkedom = async (): Promise<typeof import('linkedom')> => (await import(/* @vite-ignore */ /* webpackIgnore: true */ LINKEDOM)) as typeof import('linkedom');

export const importHtmlparser2 = async (): Promise<{ Parser?: unknown }> => (await import(/* @vite-ignore */ /* webpackIgnore: true */ HTMLPARSER2)) as { Parser?: unknown };
