/**
 * 言語のタグの道具 (src/languageTag.ts): XSL-FO の country (XSL 1.1 §7.10.1。ISO 3166 の符号) を、言語のタグの地域 (RFC 5646 §2.2.4) に直す
 */
import { describe, expect, it } from 'vitest';
import { countryToRegion, parseLanguageTag } from '../src/languageTag';

describe('countryToRegion', () => {
  it('2 字・3 字・3 桁の数字の符号を、2 字の地域にする', () => {
    expect(countryToRegion('GB')).toBe('GB');
    expect(countryToRegion('gb')).toBe('GB');
    expect(countryToRegion('GBR')).toBe('GB');
    expect(countryToRegion(' usa ')).toBe('US');
    expect(countryToRegion('JPN')).toBe('JP');
    expect(countryToRegion('826')).toBe('GB');
    expect(countryToRegion('392')).toBe('JP');
    expect(countryToRegion('004')).toBe('AF');
  });

  it('知らない符号・形の合わないものは undefined', () => {
    expect(countryToRegion('XXX')).toBeUndefined();
    expect(countryToRegion('999')).toBeUndefined();
    expect(countryToRegion('none')).toBeUndefined();
    expect(countryToRegion('')).toBeUndefined();
    expect(countryToRegion('G')).toBeUndefined();
  });

  it('直した地域は、言語のタグの地域として読まれる (3 字のままでは拡張の言語として外れる)', () => {
    expect(parseLanguageTag(`en-${countryToRegion('GBR')}`)?.region).toBe('gb');
    expect(parseLanguageTag('en-GBR')?.region).toBeUndefined();
  });
});
