/**
 * 文言の言語 (src/messages.ts):
 *  - detectMessageLang: KUMIORI_LANG → LC_ALL・LC_MESSAGES・LANG。決まらなければ日本語
 *  - withMessageLang: 呼び出しの間だけ切り替え、終わったら戻す
 *  - typeset の lang: 警告が英語になり、ほかの呼び出しには残らない
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { detectMessageLang, messageLang, msg, setMessageLang, withMessageLang } from '../src/messages';
import { typesetHtml, type FontSpec } from '../src/index';

const fontDir = process.env.KUMIORI_FONT_DIR ?? path.resolve(__dirname, '../.cache/fonts');
const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('文言の言語', () => {
  it('環境から決める: KUMIORI_LANG → LC_ALL → LC_MESSAGES → LANG。決まらなければ日本語', () => {
    expect(detectMessageLang({})).toBe('ja');
    expect(detectMessageLang({ LANG: 'C' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'ja_JP.UTF-8', LC_ALL: 'en_GB' })).toBe('en');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8', KUMIORI_LANG: 'ja' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'fr_FR.UTF-8' })).toBe('ja');
    expect(detectMessageLang({ KUMIORI_LANG: 'EN' })).toBe('en');
  });
  it('withMessageLang は呼び出しの間だけ切り替える', async () => {
    expect(messageLang()).toBe('ja');
    expect(msg('あ', 'a')).toBe('あ');
    const inside = await withMessageLang('en', async () => msg('あ', 'a'));
    expect(inside).toBe('a');
    expect(messageLang()).toBe('ja');
    await expect(withMessageLang('en', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(messageLang()).toBe('ja');
    setMessageLang('en');
    expect(msg('あ', 'a')).toBe('a');
    setMessageLang('ja');
  });
  it('typeset の lang: 警告が英語になり、次の呼び出し (lang 無し) は日本語のまま', async () => {
    const html = '<!DOCTYPE html><html><head><title>t</title><style>.g { display: grid; grid-template-areas: "a b" } p { colr: red }</style></head><body><div class="g"><p>a</p></div></body></html>';
    const en = await typesetHtml(html, { name: 't.html', loadFont, lang: 'en' });
    expect(en.warnings).toContain('ignored unsupported CSS: grid-template-areas');
    expect(en.warnings).toContain('ignored unknown CSS properties (misspelled or unsupported): colr');
    const ja = await typesetHtml(html, { name: 't.html', loadFont });
    expect(ja.warnings).toContain('未対応の CSS を無視しました: grid-template-areas');
    expect(ja.warnings.some((w) => /^ignored/.test(w))).toBe(false);
    // 知らない値は誤り
    await expect(typesetHtml(html, { name: 't.html', loadFont, lang: 'fr' as never })).rejects.toThrow(/lang/);
  });
});
