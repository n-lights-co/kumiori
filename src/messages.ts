/**
 * 利用者に見せる文言の言語 (日本語・英語)。
 *  - 既定は日本語。Node のコマンドは --lang・環境変数 KUMIORI_LANG・OS のロケール (LC_ALL・LC_MESSAGES・LANG) で決める (detectMessageLang)
 *  - ライブラリは TypesetOptions.lang (その呼び出しの間だけ切り替える。withMessageLang)
 *  - 対象は、組版の警告 (typeset の warnings)・入口の誤りの文・Node のコマンドの出力。XSL-FO の読み込みが数える名前
 *    (fo:xxx・プロパティ名) はどちらの言語でも同じ
 * 文言は呼び出し側に msg('日本語', 'English') の対で書く (辞書のキーを増やすより、その場で読める方を選んだ)
 */
export type MessageLang = 'ja' | 'en';

export const MESSAGE_LANGS: readonly MessageLang[] = ['ja', 'en'];

let current: MessageLang = 'ja';

/** 今の言語 */
export function messageLang(): MessageLang {
  return current;
}

/** 言語を切り替える (以後の msg に効く) */
export function setMessageLang(lang: MessageLang): void {
  current = lang;
}

/** 今の言語の文を返す */
export function msg(ja: string, en: string): string {
  return current === 'en' ? en : ja;
}

/** fn の間だけ lang に切り替える (lang が無ければそのまま)。非同期の呼び出しが重なると、後の切り替えが先の呼び出しにも効く */
export async function withMessageLang<T>(lang: MessageLang | undefined, fn: () => Promise<T>): Promise<T> {
  if (!lang || lang === current) return fn();
  const prev = current;
  current = lang;
  try {
    return await fn();
  } finally {
    current = prev;
  }
}

/**
 * 環境から言語を決める: KUMIORI_LANG (ja・en) → LC_ALL・LC_MESSAGES・LANG の先頭 (en… なら英語、ja… なら日本語)。
 * どれでも決まらなければ日本語 (C・POSIX・未設定も日本語)
 */
export function detectMessageLang(env: Record<string, string | undefined>): MessageLang {
  const pick = (v: string | undefined): MessageLang | undefined => {
    const s = (v ?? '').trim().toLowerCase();
    if (!s) return undefined;
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('ja')) return 'ja';
    return undefined;
  };
  return pick(env.KUMIORI_LANG) ?? pick(env.LC_ALL) ?? pick(env.LC_MESSAGES) ?? pick(env.LANG) ?? 'ja';
}
