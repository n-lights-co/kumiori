/**
 * 利用者に見せる文言の言語 (日本語・英語)。
 *  - 既定は日本語。Node のコマンドは --lang・環境変数 KUMIORI_LANG・OS のロケール (LC_ALL・LC_MESSAGES・LANG) で決める (detectMessageLang)
 *  - ライブラリは TypesetOptions.lang (その呼び出しの間だけ。呼び出しごとの文脈 (callContext.ts) に持つので、同時に走る呼び出しの間で混ざらない)
 *  - 対象は、組版の警告 (typeset の warnings)・入口の誤りの文・Node のコマンドの出力。XSL-FO の読み込みが数える名前
 *    (fo:xxx・プロパティ名) はどちらの言語でも同じ
 * 文言は呼び出し側に msg('日本語', 'English') の対で書く (辞書のキーを増やすより、その場で読める方を選んだ)
 */
import { currentCall, runInCall } from './callContext';

export type MessageLang = 'ja' | 'en';

export const MESSAGE_LANGS: readonly MessageLang[] = ['ja', 'en'];

/** 既定の言語 (setMessageLang で決める。呼び出しの外と、lang を省いた呼び出しで使う) */
let base: MessageLang = 'ja';

/** 今の言語 (呼び出しの文脈の言語。呼び出しの外なら既定の言語) */
export function messageLang(): MessageLang {
  return currentCall()?.lang ?? base;
}

/** 既定の言語を切り替える (以後の msg に効く。進行中の呼び出しの言語は変えない) */
export function setMessageLang(lang: MessageLang): void {
  base = lang;
}

/** 今の言語の文を返す */
export function msg(ja: string, en: string): string {
  return messageLang() === 'en' ? en : ja;
}

/**
 * fn の間だけ lang に切り替える (lang が無ければそのまま)。呼び出しごとの文脈 (callContext.ts の runInCall) で切り替えるので、
 * 非同期の呼び出しが重なっても、それぞれの呼び出しの言語になる (AsyncLocalStorage の無い環境では、await の後で文脈を置き直した所まで)
 */
export async function withMessageLang<T>(lang: MessageLang | undefined, fn: () => Promise<T>): Promise<T> {
  if (!lang) return fn();
  return runInCall({ ...currentCall(), lang }, fn);
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
