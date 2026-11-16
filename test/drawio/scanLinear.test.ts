/**
 * draw.io の図と XML の読み込みで、閉じない開きの記号 ('<a'・'<!--'・'<svg'・'<!DOCTYPE' など) のたびに文字列の終わりまで読み直す
 * 正規表現 (長さの 2 乗の手間) を、長さに比例する読み方にしたことの確かめ。
 * どれも、前の正規表現と同じ結果になること (いろいろな字の並びで比べる) と、2 乗なら終わらない長さの入力が、すぐ読み終わることを見る
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { drawioToSvg, htmlTokens, svgOpenTag } from '../../src/drawio/drawio';
import { replaceTags } from '../../src/drawio/drawioSketch';
import { expandInternalEntities } from '../../src/api';

/** 決まった種の乱数 (xorshift32) */
const rng = (seed: number) => () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 2 ** 32;
};
/** 部品をでたらめに並べた文字 */
const fuzz = (parts: string[], count: number, seed: number) => {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const n = 1 + Math.floor(r() * 40);
    let s = '';
    for (let k = 0; k < n; k++) s += parts[Math.floor(r() * parts.length)];
    return s;
  });
};

const xa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const compressed = (xml: string) => `<mxfile><diagram id="p" name="p">${deflateRawSync(Buffer.from(encodeURIComponent(xml), 'latin1')).toString('base64')}</diagram></mxfile>`;
const enc = (s: string) => new TextEncoder().encode(s);

describe('HTML のラベルの字句 (drawio.ts の htmlTokens)', () => {
  const OLD = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)|</g;
  const old = (s: string) => [...s.matchAll(OLD)].map((m) => [m[0], m[1] ?? '', m[2] ?? '', m[3] ?? '', m[4]]);
  it('前の正規表現と同じ字句に分ける', () => {
    const parts = ['<', '>', '<a', '</a>', '<b x="1">', '<br/>', '<!--', '-->', '--', '!', 'a', ' ', '\n', '/', '"', '<div', 'é', '<1', '<-'];
    for (const s of fuzz(parts, 3000, 7)) expect([...htmlTokens(s)]).toEqual(old(s));
    expect([...htmlTokens('')]).toEqual([]);
  });
  it("'>' の無い '<a' と、閉じない '<!--' を 100 万個並べても、すぐ読み終わる (前は長さの 2 乗)", () => {
    for (const unit of ['<a', '<!--']) {
      const s = unit.repeat(1_000_000);
      let n = 0;
      for (const _ of htmlTokens(s)) n++;
      expect(n).toBe(2_000_000);
    }
  });
  it('<script> と閉じない <a を並べた HTML のラベル 20 個の図 (ラベルの長さと合計の上限の内) を、すぐ描く (前は 88 秒)', () => {
    const label = '<script>' + '<a'.repeat(49_990);
    let cells = '';
    for (let k = 0; k < 20; k++)
      cells += `<mxCell id="c${k}" value="${xa(label)}" style="html=1;" vertex="1" parent="1"><mxGeometry x="${k * 120}" y="0" width="100" height="40" as="geometry"/></mxCell>`;
    const r = drawioToSvg(enc(compressed(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`)));
    expect(r?.width).toBeGreaterThan(2000);
  }, 60_000);
});

describe('入れ子の svg の開きのタグ (drawio.ts の svgOpenTag)', () => {
  const OLD = /<svg\b[^>]*>/i;
  it('前の正規表現と同じタグを見つける', () => {
    const parts = ['<svg', '<SVG', '<svgx', '>', ' ', 'a', '/', '<', '"', 'width="1"'];
    for (const s of fuzz(parts, 3000, 11)) {
      const m = OLD.exec(s);
      const t = svgOpenTag(s);
      expect(t && { 0: t[0], index: t.index }).toEqual(m ? { 0: m[0], index: m.index } : undefined);
    }
  });
  it("'>' の無い '<svg' を 100 万個並べても、すぐ読み終わる", () => {
    expect(svgOpenTag('<svg'.repeat(1_000_000))).toBeUndefined();
  });
});

describe('手書き風の形のタグの置き換え (drawioSketch.ts の replaceTags)', () => {
  const OLD = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const mark = (_tag: string, close: string, name: string, rest: string, self: string) => `[${close}|${name}|${rest}|${self}]`;
  it('前の正規表現と同じタグを、同じ組で置き換える', () => {
    const parts = ['<', '>', '/>', '<a', '</a', '<path', ' d="M0 0"', '"', "'", '/', ' ', 'x', '<a:b', '<1', '="<>"', "='>'"];
    for (const s of fuzz(parts, 3000, 13)) expect(replaceTags(s, mark)).toBe(s.replace(OLD, mark));
  });
  it("閉じない '<a ' を 100 万個と、閉じない ' を 1 つ置いても、すぐ読み終わる (前は長さの 2 乗)", () => {
    const s = '<g>' + '<a '.repeat(1_000_000) + "'</g>";
    expect(replaceTags(s, mark)).toBe('[|g||]' + '<a '.repeat(1_000_000) + "'[/|g||]");
  });
});

describe('XML の内部実体の展開 (api.ts の expandInternalEntities)', () => {
  /** 前の実装 (正規表現で DOCTYPE と、CDATA 区間・コメント・実体参照を探す)。上限の確かめは省く */
  const oldExpand = (xml: string): string => {
    const dt = /<!DOCTYPE\s[^[>]*\[([\s\S]*?)\]\s*>/i.exec(xml);
    if (!dt) return xml;
    const ents = new Map<string, string>();
    for (const m of dt[1].matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) if (!ents.has(m[1])) ents.set(m[1], m[2] ?? m[3] ?? '');
    if (!ents.size) return xml;
    const expand = (t: string, depth: number): string =>
      t.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|&([A-Za-z_:][\w.:-]*);/g, (all, name?: string) => {
        if (name === undefined) return all;
        const v = ents.get(name);
        return v === undefined || depth >= 8 ? all : expand(v, depth + 1);
      });
    const bodyAt = dt.index + dt[0].length;
    return xml.slice(0, bodyAt) + expand(xml.slice(bodyAt), 0);
  };
  it('前の実装と同じに展開する', () => {
    const parts = ['<!DOCTYPE r [', '<!doctype r [', '<!DOCTYPE r>', '<!ENTITY e "E">', '<!ENTITY f \'&e;F\'>', ']>', '] >', ']', '>', '[', '&e;', '&f;', '&g;', '&', ';', '<!--', '-->', '<![CDATA[', ']]>', '<r>', 'x', ' '];
    for (const s of fuzz(parts, 4000, 17)) expect(expandInternalEntities(s)).toBe(oldExpand(s));
  });
  it("閉じない '<!--'・'<![CDATA[' と、内部サブセットの無い '<!DOCTYPE a' を数十万個並べても、すぐ読み終わる (前は長さの 2 乗)", () => {
    const head = '<!DOCTYPE r [<!ENTITY e "E">]>';
    for (const unit of ['<!--', '<![CDATA[']) expect(expandInternalEntities(head + '<r>&e;' + unit.repeat(500_000))).toBe(head + '<r>E' + unit.repeat(500_000));
    const many = '<!DOCTYPE a'.repeat(300_000);
    expect(expandInternalEntities(many)).toBe(many);
  });
});
