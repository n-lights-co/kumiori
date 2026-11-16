/**
 * messages — 警告の文の言語 (日本語・英語)。Kumiori が受け口で渡す言語 (ImageFormatContext.lang。TypesetOptions.lang・コマンドの --lang) に従う。
 * 図を SVG にする処理 (drawio.ts の drawioToSvg) は同期なので、その間だけ withLang で言語を決め、中の警告は msg で書く
 * (Kumiori の src/messages.ts と同じく、文は呼ぶ所に msg('日本語', 'English') の対で書く)
 */

export type Lang = 'ja' | 'en';

let current: Lang = 'ja';

/** fn の間だけ lang にする (無ければ日本語) */
export function withLang<T>(lang: Lang | undefined, fn: () => T): T {
  const prev = current;
  current = lang === 'en' ? 'en' : 'ja';
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** 今の言語の文 */
export const msg = (ja: string, en: string): string => (current === 'en' ? en : ja);

/** lang の言語の文 (非同期の処理の中など、withLang の外で書くとき) */
export const msgIn = (lang: Lang | undefined, ja: string, en: string): string => (lang === 'en' ? en : ja);
