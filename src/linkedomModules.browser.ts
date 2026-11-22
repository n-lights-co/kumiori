/**
 * linkedomModules.ts の、ブラウザ向けの 1 ファイル (dist-browser) の版 (vite.browser.config.ts が差し替える)。
 *
 * 名前を書いたまま読み込むので、linkedom と htmlparser2 は、使うときだけ読む別のファイル (chunks/) としてまとめられる。
 * 読むのは、ブラウザに備わった DOMParser の無い所 (Web Worker の中) で HTML・SVG を読むときだけ (画面の中では読まない)。
 * htmlparser2 は、linkedom が使うものと同じものを読む (htmlParserStack.ts が、その構文解析器に仕掛けを入れる)
 */
export const importLinkedom = (): Promise<typeof import('linkedom')> => import('linkedom');

export const importHtmlparser2 = async (): Promise<{ Parser?: unknown }> => (await import('htmlparser2')) as { Parser?: unknown };
