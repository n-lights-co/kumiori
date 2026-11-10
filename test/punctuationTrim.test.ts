/**
 * 約物の詰め。
 * - 中点類の後ろに始め括弧類が続くときは、始め括弧類の前の二分アキを詰める (JLREQ https://www.w3.org/TR/jlreq/?lang=ja
 *   2026-11-03 取得: 「中点類（cl-05） の後ろに 始め括弧類（cl-01） が連続する場合は，前の中点類の後ろを原則として 四分アキ とする」)
 * - text-spacing-trim の trim-start・trim-both は行頭の始め括弧類を二分に、trim-both は行末の終わり括弧類も二分に
 *   (CSS Text 4 §8.5 https://www.w3.org/TR/css-text-4/ 2026-11-05 取得)
 * - -ah-punctuation-trim の start・end などの組を、text-spacing-trim に読み替える
 * - text-autospace の初期値は normal (CSS Text 4 §8.4: ideograph-alpha ideograph-numeric と同じ)。none は値に無い (無効)。
 *   アンテナハウス互換 (jaDefaultsAh) では none を「空きを入れない」と読み、段落の 1 行目の行頭の始め括弧類を詰める
 * - 句読点 (、。，．) とコロン類 (：；) を、終わり括弧類として詰めるか・中点類として詰めるかは、字形の墨が字の枠のどこにあるかで決める
 *   (CSS Text 4 §8.5.3 https://drafts.csswg.org/css-text-4/ 2026-11-10 取得: 「If the punctuation is centered, then it should be considered
 *   middle dot punctuation. If the punctuation is drawn to one side … and the other half is therefore blank then the punctuation should be
 *   considered closing punctuation and trimmed accordingly」「The UA may rely on language conventions and the writing mode …, and/or font information」。
 *   繁体字の書体の句読点は字の枠の中央 (clreq §5.1 https://www.w3.org/TR/clreq/ 2026-11-10 取得)。
 *   繁体字・簡体字の書体は大きい (7〜10MB) のでテストでは取得せず、字形の外接枠を返す仮の書体で確かめる。実際の書体では日本語の書体が今までどおりであることを確かめる)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { adjustJapaneseSpacing, type Atom } from '../src/inlineLayout';
import { AH_ALIASES } from '../src/htmlPaged';
import { importHtml } from '../src/htmlImport';
import { cascadeStyles } from '../src/cssCascade';
import type { LPageSequence } from '../src/types';
import type { LBlock } from '../src/types';
import type { GlyphMetrics, RunStyle } from '../src/measurer';
import { verticalTreatment } from '../src/jis';
import { FAMILY, makeEngine } from './helpers';

const st = { fontSize: 10 } as unknown as Atom['st'];
const glyph = (ch: string): Atom => ({ kind: 'glyph', first: ch, last: ch, advance: 10, isSpace: false, runId: 0, st }) as Atom;

describe('約物の詰め', () => {
  it('』・『: 』の後ろの二分と、『の前の二分を詰める (中点の前後の四分は残す)', () => {
    const a = ['』', '・', '『', '句'].map(glyph);
    adjustJapaneseSpacing(a);
    expect(a.map((x) => x.advance)).toEqual([5, 10, 5, 10]);
    expect(a[2].dx).toBe(-5);
  });
  it('-ah-punctuation-trim の読み替え', () => {
    const v = AH_ALIASES['-ah-punctuation-trim'].value;
    expect(v('none')).toBe('space-all');
    expect(v('start end adjacent')).toBe('trim-both');
    expect(v('start allow-end adjacent')).toBe('trim-both');
    expect(v('start')).toBe('trim-start');
    expect(v('adjacent')).toBe('normal');
    expect(v('all')).toBe('trim-all');
  });
  it('text-spacing-trim: trim-start は行頭の詰め、trim-both は行末の詰めも', () => {
    const conv = (css: string) => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body><p>「あ」</p></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } }), { css });
      // body の箱の中の p
      return (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LBlock;
    };
    expect(conv('p { text-spacing-trim: trim-start }')).toMatchObject({ punctuationTrimStart: true });
    expect(conv('p { text-spacing-trim: trim-both }')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(conv('p { -ah-punctuation-trim: start end adjacent }')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(conv('p { color: red }').punctuationTrimStart).toBeUndefined();
  });
  it('text-autospace: 既定で和欧間アキを入れる。none は無効 (既定のまま)、アンテナハウス互換では空きを入れない', () => {
    const conv = (style: string, ah: boolean) => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body><p style="${style}">日本語global</p></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } }), { css: '', ...(ah ? { jaDefaultsAh: true } : {}) });
      const seq = r.document.sequences[0] as LPageSequence;
      const p = (seq.flow.children[0] as LBlock).children[0] as LBlock;
      return { root: seq.textAutospace, p: p.textAutospace, paraStart: seq.punctuationTrimParagraphStart };
    };
    expect(conv('', false)).toEqual({ root: true, p: undefined, paraStart: undefined });
    expect(conv('text-autospace: none', false).p).toBeUndefined();
    expect(conv('text-autospace: no-autospace', false).p).toBe(false);
    expect(conv('text-autospace: none', true)).toEqual({ root: true, p: false, paraStart: true });
  });
});

/** 字形の外接枠 (1000 単位の全角の枠の中) を返す仮の書体。box は [minX, minY, maxX, maxY] */
const fakeFont = (boxes: Record<string, [number, number, number, number]>) =>
  ({
    unitsPerEm: 1000,
    baselineRatio: 0.88,
    fk: {
      layout: (ch: string) => {
        const b = boxes[ch];
        return { glyphs: b ? [{ id: 1, advanceWidth: 1000, bbox: { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] } }] : [{ id: 0, advanceWidth: 1000, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }] };
      },
    },
  }) as unknown as GlyphMetrics['font'];
const withFont = (ch: string, font: GlyphMetrics['font'], vertical?: GlyphMetrics['vertical'], style: Atom['st'] = st): Atom =>
  ({ ...glyph(ch), st: style, g: { ch, font, fontSize: 10, advance: 10, cross: 10, naturalWidth: 10, ...(vertical ? { vertical } : {}) } }) as Atom;
/** Noto Sans TC・Noto Sans SC の字形の外接枠 (v40・v41 の Regular を fontkit で測った値) */
const TC = fakeFont({ '、': [356, 235, 645, 514], '。': [351, 227, 655, 531], '，': [396, 188, 591, 530], '：': [424, 54, 576, 694], '；': [396, -103, 592, 694] });
const SC = fakeFont({ '、': [52, -56, 341, 224], '。': [42, -61, 347, 244], '，': [135, -107, 330, 235], '：': [174, -4, 326, 636], '；': [146, -161, 342, 636] });
/** 簡体字の書体の、縦書き用のコロンの字形 (vert。枠の右に寄り、上下いっぱい) */
const SC_VERT = fakeFont({ '：': [648, 128, 800, 768], '。': [653, 515, 953, 815] });
const trimAll = { fontSize: 10, punctuationTrimAll: true } as unknown as Atom['st'];

describe('句読点・コロン類の詰め方は、字形の墨の位置で決める (CSS Text 4 §8.5.3)', () => {
  it('繁体字の書体 (字の枠の中央の句読点): 後ろの二分を詰めない (。」 ，」 、） が重ならない)。終わり括弧類の後ろに続けば、括弧の後ろを詰める', () => {
    for (const p of ['。', '，', '、']) {
      const a = [withFont(p, TC), glyph('」'), glyph('字')];
      adjustJapaneseSpacing(a);
      expect(a.map((x) => x.advance), p).toEqual([10, 10, 10]);
    }
    // 」。 は、終わり括弧類の後ろに中点類が続く並び: 」の後ろの二分を詰める (§8.5.2)
    const b = [glyph('」'), withFont('。', TC), glyph('「'), glyph('字')];
    adjustJapaneseSpacing(b);
    expect(b.map((x) => x.advance)).toEqual([5, 10, 5, 10]);
    expect(b[2].dx).toBe(-5);
  });
  it('繁体字の書体の句読点は中点類 (前後の四分ずつ)、簡体字・日本語の書体の句読点は終わり括弧類 (後ろの二分)', () => {
    const tc = [withFont('，', TC, undefined, trimAll)];
    adjustJapaneseSpacing(tc);
    expect([tc[0].advance, tc[0].dx]).toEqual([5, -2.5]);
    const sc = [withFont('，', SC, undefined, trimAll)];
    adjustJapaneseSpacing(sc);
    expect([sc[0].advance, sc[0].dx]).toEqual([5, undefined]);
    const a = [withFont('。', SC), glyph('”')];
    adjustJapaneseSpacing(a);
    expect(a[0].advance).toBe(5);
  });
  it('コロン類: 簡体字の書体 (枠の前半) は終わり括弧類、繁体字・日本語の書体 (枠の中央) は中点類', () => {
    const sc = [withFont('：', SC, undefined, trimAll), withFont('；', SC, undefined, trimAll)];
    adjustJapaneseSpacing(sc);
    expect(sc.map((x) => [x.advance, x.dx])).toEqual([[5, undefined], [5, undefined]]);
    const tc = [withFont('：', TC, undefined, trimAll)];
    adjustJapaneseSpacing(tc);
    expect([tc[0].advance, tc[0].dx]).toEqual([5, -2.5]);
  });
  it('縦書き: 正立の字は字形の上下で決める。枠の前半にも中央にも収まらない字形 (簡体字の書体の縦書きのコロン) は詰めない', () => {
    const v = { glyph: '：', mode: 'upright' as const, dx: 0, dy: 0, features: ['vert'] };
    const a = [withFont('：', SC_VERT, v, trimAll)];
    adjustJapaneseSpacing(a);
    expect([a[0].advance, a[0].dx]).toEqual([10, undefined]);
    // 縦書き用の字形が枠の上半分にある句点は、終わり括弧類
    const b = [withFont('。', SC_VERT, { ...v, glyph: '。' }), glyph('」')];
    adjustJapaneseSpacing(b);
    expect(b[0].advance).toBe(5);
    // 繁体字の書体 (縦書きでも同じ字形で、枠の中央) は詰めない
    const c = [withFont('。', TC, { glyph: '。', mode: 'upright', dx: 0, dy: 0 }), glyph('」')];
    adjustJapaneseSpacing(c);
    expect(c[0].advance).toBe(10);
  });
  it('字形の分からない字 (書体を引いていない・書体に無い・位置をずらして代える字) は、字で決まる既定のまま', () => {
    const a = [withFont('。', fakeFont({})), glyph('」')];
    adjustJapaneseSpacing(a);
    expect(a[0].advance).toBe(5);
    const b = [withFont('。', TC, { glyph: '。', mode: 'upright', dx: 0.55, dy: -0.6 }), glyph('」')];
    adjustJapaneseSpacing(b);
    expect(b[0].advance).toBe(5);
  });
  it('日本語の書体 (Noto Serif JP) は今までどおり: 句読点は終わり括弧類、コロン類は中点類 (横書き・縦書き)', async () => {
    const { measurer } = await makeEngine();
    const rs = { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 } as RunStyle;
    for (const wm of ['horizontal-tb', 'vertical-rl'] as const) {
      for (const p of ['、', '。', '，', '．']) {
        const a = [{ ...glyph(p), g: measurer.glyph(p, rs, wm) } as Atom, glyph('」')];
        adjustJapaneseSpacing(a);
        expect(a[0].advance, `${wm} ${p}`).toBe(5);
        const t = [{ ...glyph(p), st: trimAll, g: measurer.glyph(p, rs, wm) } as Atom];
        adjustJapaneseSpacing(t);
        expect([t[0].advance, t[0].dx], `${wm} ${p}`).toEqual([5, undefined]);
      }
      for (const p of ['：', '；']) {
        const t = [{ ...glyph(p), st: trimAll, g: measurer.glyph(p, rs, wm) } as Atom];
        adjustJapaneseSpacing(t);
        expect([t[0].advance, t[0].dx], `${wm} ${p}`).toEqual([5, -2.5]);
      }
    }
  });
});

describe('縦書きの句読点の字形', () => {
  const has = () => true;
  it('書体に vert が無ければ、Unicode の縦書き用字形に替える (今までどおり)', () => {
    expect(verticalTreatment('、', has).glyph).toBe('︑');
    expect(verticalTreatment('。', has, 'mixed', () => false, false).glyph).toBe('︒');
    expect(verticalTreatment('、', () => false)).toMatchObject({ glyph: '、', dx: 0.55, dy: -0.6 });
  });
  it('書体の vert が句読点を替えれば、その字形 (今までどおり)', () => {
    expect(verticalTreatment('、', has, 'mixed', () => true, true)).toMatchObject({ glyph: '、', features: ['vert'] });
  });
  it('書体に vert があるのに句読点を替えない (繁体字の書体): 既定の字形のまま、位置も動かさない (Writing Modes 3 §5.1.1)', () => {
    for (const p of ['、', '。', '，', '．']) expect(verticalTreatment(p, has, 'mixed', () => false, true)).toEqual({ glyph: p, mode: 'upright', dx: 0, dy: 0 });
    // 括弧類は、vert が替えなければ今までどおり (縦書き用字形か、横倒し)
    expect(verticalTreatment('「', has, 'mixed', () => false, true).glyph).toBe('﹁');
  });
});

