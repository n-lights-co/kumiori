/**
 * HTML のルビの配置 (CSS Ruby Annotation Layout 1。https://www.w3.org/TR/2022/WD-css-ruby-1-20221231/ ):
 *  - ruby-position (§4.1): over・under・alternate の組・inter-character
 *  - ruby-merge (§4.2): separate・merge (auto は未対応)
 *  - ruby-align (§4.3): start・center・space-between・space-around
 *  - ruby-overhang (§5.1): auto・none
 * 指定の無いルビは、ruby-align だけ初期値 space-around (HTML の入力の既定)。ほかは、これまでの組み方のまま (LRuby に新しい項目を付けない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importHtml } from '../src/htmlImport';
import { matchSupports, parseCss } from '../src/htmlPaged';
import { unsupportedCssReport } from '../src/cssUnsupported';
import type { Area, GlyphArea, LRuby, RubyArea } from '../src/types';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { childrenOf } from '../src/areaTree';
import { doc, makeEngine, walk } from './helpers';

describe('HTML: ルビの配置 (CSS Ruby 1 §4・§5.1)', () => {
  let E: Awaited<ReturnType<typeof makeEngine>>;
  beforeAll(async () => {
    E = await makeEngine();
  });
  const imp = (body: string, extraCss = '') => {
    const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const css = `@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 2 } p { margin: 0 } ${extraCss}`;
    return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
  };
  const rubiesOf = (body: string, css = '') => {
    const out: LRuby[] = [];
    JSON.stringify(imp(body, css).document.sequences[0].flow, (_k, v) => (v && v.type === 'ruby' && out.push(v), v));
    // rubyScale は、字の大きさの換算 (pt → px) の端数で付くことがある (ここでは見ない)
    return out.map(({ rubyScale: _s, ...r }) => r as LRuby);
  };
  /** 組んだルビの領域。親文字・ルビの字は、ページの左上からの位置 (x・y) にして返す */
  const laid = (body: string, css = '') => {
    const out: Array<{ x: number; y: number; width: number; height: number; base: GlyphArea[]; ruby: GlyphArea[] }> = [];
    const rec = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'ruby') {
        const abs = (g: GlyphArea) => ({ ...g, x: x + g.x, y: y + g.y });
        out.push({ x, y, width: a.width, height: a.height, base: (a as RubyArea).base.map(abs), ruby: (a as RubyArea).ruby.map(abs) });
      }
      for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
    };
    for (const s of E.engine.layout(imp(body, css).document).sheets) rec(s.page, 0, 0);
    return out;
  };
  /** 字の、ルビの領域の始めの端からの位置 (横書き) */
  const offs = (r: { x: number }, gs: GlyphArea[]) => gs.map((g) => +(g.x - r.x).toFixed(2));

  describe('ruby-position (§4.1)', () => {
    it('指定が無ければ、LRuby に新しい項目を付けない (これまでの組み方のまま)', () => {
      expect(rubiesOf('<p><ruby>漢字<rt>かんじ</rt></ruby></p>')).toEqual([{ type: 'ruby', baseText: '漢字', rubyText: 'かんじ' }]);
      expect(rubiesOf('<p><ruby>東<rt>とう</rt>京<rt>きょう</rt><rtc>Tokyo</rtc></ruby></p>')).toEqual([{ type: 'ruby', baseText: '東京', rubyText: 'とうきょう', rubyTextUnder: 'Tokyo' }]);
    });
    it('under・alternate under は下側、over・alternate・alternate over は上側。継承する', () => {
      const pos = (v: string) => rubiesOf(`<p style="ruby-position: ${v}"><ruby>漢<rt>かん</rt></ruby></p>`)[0].rubyPosition;
      expect(pos('under')).toBe('under');
      expect(pos('alternate under')).toBe('under');
      expect(pos('under alternate')).toBe('under');
      expect(pos('over')).toBeUndefined();
      expect(pos('alternate')).toBeUndefined();
      expect(pos('alternate over')).toBeUndefined();
      // 規則 (スタイルシート) の指定も読む。近い祖先の指定が勝ち、initial は指定の無いものと同じ
      expect(rubiesOf('<p><ruby>漢<rt>かん</rt></ruby></p>', 'ruby { ruby-position: under }')[0].rubyPosition).toBe('under');
      expect(rubiesOf('<p><ruby style="ruby-position: over">漢<rt>かん</rt></ruby></p>', 'p { ruby-position: under }')[0].rubyPosition).toBeUndefined();
      expect(rubiesOf('<p><ruby style="ruby-position: initial">漢<rt>かん</rt></ruby></p>', 'p { ruby-position: under }')[0].rubyPosition).toBeUndefined();
    });
    it('横書き: under のルビは親文字の下に置く (over は上)', () => {
      const [over] = laid('<p>あ<ruby>漢字<rt>かんじ</rt></ruby>い</p>');
      const [under] = laid('<p>あ<ruby style="ruby-position: under">漢字<rt>かんじ</rt></ruby>い</p>');
      expect(over.ruby[0].y + over.ruby[0].height).toBeLessThanOrEqual(over.base[0].y + 1e-6);
      expect(under.ruby[0].y).toBeGreaterThanOrEqual(under.base[0].y + under.base[0].height - 1e-6);
      // 親文字の位置は、行の中で同じ (ルビの側だけが変わる)
      expect(under.base[0].x).toBeCloseTo(over.base[0].x, 6);
      expect(under.ruby.map((g) => g.text).join('')).toBe('かんじ');
    });
    it('縦書き: under のルビは親文字の左に置く (over は右)', () => {
      const v = (style: string) => laid(`<div style="writing-mode: vertical-rl; height: 60mm"><p>あ<ruby style="${style}">漢字<rt>かんじ</rt></ruby>い</p></div>`)[0];
      const over = v('');
      const under = v('ruby-position: under');
      expect(over.ruby[0].x).toBeGreaterThanOrEqual(over.base[0].x + over.base[0].width - 1e-6);
      expect(under.ruby[0].x + under.ruby[0].width).toBeLessThanOrEqual(under.base[0].x + 1e-6);
      // 字の進む向き (上から下) の位置は同じ
      expect(under.base.map((g) => g.y)).toEqual(over.base.map((g) => g.y));
      expect(under.ruby.map((g) => +(g.y - under.y).toFixed(3))).toEqual(over.ruby.map((g) => +(g.y - over.y).toFixed(3)));
    });
    it('下側のルビも行の高さに数えない (§3.6): 行間に収まれば行送りは変わらず、収まらなければ上側のルビと同じだけ空ける', () => {
      const pitch = (st: string, lh: number) => {
        const p = `<p style="line-height: ${lh}">あ<ruby style="${st}">漢<rt>かん</rt></ruby></p>`;
        const rs = laid(p + p + p);
        return [+(rs[1].base[0].y - rs[0].base[0].y).toFixed(2), +(rs[2].base[0].y - rs[1].base[0].y).toFixed(2)];
      };
      // 行間 (10pt) にルビ (5pt) が収まる: 行送りは line-height のまま
      expect(pitch('ruby-position: under', 2)).toEqual([20, 20]);
      // 行間 (2pt) に収まらない: 足りない 3pt を空ける (上側のルビと同じ)
      expect(pitch('ruby-position: under', 1.2)).toEqual([15, 15]);
      expect(pitch('', 1.2)).toEqual([15, 15]);
      // 縦書きも同じ (行は右から左へ進む)
      const v = (st: string) => {
        const p = `<p>あ<ruby style="${st}">漢<rt>かん</rt></ruby></p>`;
        const rs = laid(`<div style="writing-mode: vertical-rl; height: 50mm; line-height: 1.2">${p}${p}${p}</div>`);
        return +(rs[0].base[0].x - rs[1].base[0].x).toFixed(2);
      };
      expect(v('ruby-position: under')).toBe(15);
      expect(v('')).toBe(15);
    });
    it('2 段のルビ: 1 段目が under なら、2 段目 (alternate) は上側', () => {
      const body = (st: string) => `<p><ruby style="${st}">東<rt>とう</rt>京<rt>きょう</rt><rtc>Tokyo</rtc></ruby></p>`;
      expect(rubiesOf(body('ruby-position: under'))[0]).toMatchObject({ rubyText: 'とうきょう', rubyTextUnder: 'Tokyo', rubyPosition: 'under' });
      const [r] = laid(body('ruby-position: alternate under'));
      const kana = r.ruby.filter((g) => /[ぁ-ん]/.test(g.text));
      const latin = r.ruby.filter((g) => /[A-Za-z]/.test(g.text));
      expect(kana[0].y).toBeGreaterThanOrEqual(r.base[0].y + r.base[0].height - 1e-6);
      expect(latin[0].y + latin[0].height).toBeLessThanOrEqual(r.base[0].y + 1e-6);
    });
    it('2 段とも同じ側 (外へ重ねる) は未対応: 逆の側に置いて、知らせる', () => {
      const r = imp('<p><ruby>東<rt>とう</rt>京<rt>きょう</rt><rtc style="ruby-position: over">Tokyo</rtc></ruby></p>');
      expect(r.report.unsupported).toMatchObject({ 'ruby-position (同じ側の 2 段)': 1 });
      // alternate を含めば、1 段目の逆の側 (知らせない)
      expect(imp('<p><ruby>東<rt>とう</rt>京<rt>きょう</rt><rtc style="ruby-position: alternate over">Tokyo</rtc></ruby></p>').report.unsupported).toEqual({});
    });
    it('inter-character: 縦書きでは over と同じ。横書きでは未対応 (over として組み、知らせる)', () => {
      const h = imp('<p><ruby style="ruby-position: inter-character">漢<rt>かん</rt></ruby></p>');
      expect(h.report.unsupported).toEqual({ 'ruby-position: inter-character (横書き)': 1 });
      const v = imp('<div style="writing-mode: vertical-rl"><p><ruby style="ruby-position: inter-character">漢<rt>かん</rt></ruby></p></div>');
      expect(v.report.unsupported).toEqual({});
      const st = 'ruby-position: inter-character';
      expect(rubiesOf(`<p><ruby style="${st}">漢<rt>かん</rt></ruby></p>`)).toEqual([{ type: 'ruby', baseText: '漢', rubyText: 'かん' }]);
      expect(rubiesOf(`<div style="writing-mode: vertical-rl"><p><ruby style="${st}">漢<rt>かん</rt></ruby></p></div>`)).toEqual([{ type: 'ruby', baseText: '漢', rubyText: 'かん' }]);
    });
  });

  describe('ruby-align (§4.3)', () => {
    // 字は 10pt、ルビは 5pt。親文字 4 字 (40pt) に仮名 2 字 (10pt) のルビ
    const short = (st: string, rt = 'かな') => laid(`<p><ruby style="${st}">漢字漢字<rt>${rt}</rt></ruby></p>`)[0];
    it('ルビが親文字より短いとき: start・center・space-between・space-around', () => {
      const at = (st: string) => {
        const r = short(st);
        return offs(r, r.ruby);
      };
      expect(at('ruby-align: start')).toEqual([0, 5]);
      expect(at('ruby-align: center')).toEqual([15, 20]);
      expect(at('ruby-align: space-between')).toEqual([0, 35]);
      // 字の間 1 つ + 両端で 1 つ分: アキ 30pt を 2 つに分け、その半分を前後に
      expect(at('ruby-align: space-around')).toEqual([7.5, 27.5]);
    });
    it('指定の無いときは、初期値 space-around と同じ (和文のルビは字の間と両端を空ける)', () => {
      const r = short('');
      expect(offs(r, r.ruby)).toEqual([7.5, 27.5]);
      // 3 字のルビ・親文字のほうが短いルビも、明示したときと同じ位置
      for (const body of ['<ruby STYLE>漢字漢字<rt>かなか</rt></ruby>', '<ruby STYLE>漢字<rt>かきくけこさ</rt></ruby>', '<ruby STYLE>東<rt>とう</rt>京<rt>きょう</rt><rtc>Tokyo</rtc></ruby>']) {
        const pos = (st: string) => laid(`<p>${body.replace(' STYLE', st)}</p>`).map((x) => [offs(x, x.base), offs(x, x.ruby)]);
        expect(pos('')).toEqual(pos(' style="ruby-align: space-around"'));
      }
    });
    it('space-between・space-around は、欧文の字の間を空けない (中央にそろえる)。指定の無いとき (初期値 space-around) も同じ', () => {
      const w = (st: string) => {
        const r = short(st, 'ab');
        return { span: r.ruby[1].x - (r.ruby[0].x + r.ruby[0].width), mid: (r.ruby[0].x + r.ruby[1].x + r.ruby[1].width) / 2 - r.x };
      };
      for (const v of ['ruby-align: space-between', 'ruby-align: space-around', '']) {
        expect(w(v).span).toBeCloseTo(0, 6);
        expect(w(v).mid).toBeCloseTo(20, 3);
      }
    });
    it('XSL-FO などの入力 (rubyAlign の無い文書) は、これまでどおり字ごとに前後へ同じアキ (欧文の字の間も空ける)', () => {
      const t = E.engine.layout(doc([{ type: 'block', fontSize: 10, children: [{ type: 'ruby', baseText: '漢字漢字', rubyText: 'ab' }] }] as never));
      let ruby: RubyArea | undefined;
      walk(t.sheets[0].page, (a) => {
        if (a.type === 'ruby') ruby = a as RubyArea;
      });
      const [a, b] = ruby!.ruby;
      expect(b.x - (a.x + a.width)).toBeGreaterThan(5);
      // 字の間のアキは、前の端のアキの 2 倍 (どの字にも前後に同じアキ)
      expect(b.x - (a.x + a.width)).toBeCloseTo(2 * a.x, 3);
    });
    it('親文字がルビより短いとき、親文字を ruby-align で配る (ルビは詰めて置く)', () => {
      // 親文字 2 字 (20pt) に仮名 6 字 (30pt)
      const r = (st: string) => laid(`<p><ruby style="${st}">漢字<rt>かきくけこさ</rt></ruby></p>`)[0];
      const at = (st: string) => offs(r(st), r(st).base);
      expect(at('ruby-align: start')).toEqual([0, 10]);
      expect(at('ruby-align: center')).toEqual([5, 15]);
      expect(at('ruby-align: space-between')).toEqual([0, 20]);
      expect(at('ruby-align: space-around')).toEqual([2.5, 17.5]);
      expect(at('')).toEqual([2.5, 17.5]);
      expect(offs(r('ruby-align: center'), r('ruby-align: center').ruby)).toEqual([0, 5, 10, 15, 20, 25]);
    });
    it('rt と rb に別々に指定できる (親文字・注釈の箱ごとの値)', () => {
      const [r] = rubiesOf('<p><ruby><rb style="ruby-align: start">漢</rb><rt style="ruby-align: center">かんかん</rt></ruby></p>');
      expect(r).toMatchObject({ rubyAlign: 'center', rubyAlignBase: 'start' });
      const [q] = rubiesOf('<p><ruby>漢<rt>かん</rt></ruby></p>', 'rt { ruby-align: space-between }');
      expect(q.rubyAlign).toBe('space-between');
      expect(q.rubyAlignBase).toBeUndefined();
    });
    it('縦書き: start は上の端、center は中央', () => {
      const v = (st: string) => {
        const r = laid(`<div style="writing-mode: vertical-rl; height: 60mm"><p><ruby style="${st}">漢字漢字<rt>かな</rt></ruby></p></div>`)[0];
        return r.ruby.map((g) => +(g.y - r.y).toFixed(2));
      };
      expect(v('ruby-align: start')).toEqual([0, 5]);
      expect(v('ruby-align: center')).toEqual([15, 20]);
      expect(v('ruby-align: space-between')).toEqual([0, 35]);
    });
  });

  describe('ruby-overhang (§5.1)', () => {
    // 親文字 1 字 (10pt) に仮名 4 字 (20pt) のルビ。前後は仮名
    const span = (st: string) => {
      const [r] = laid(`<p style="${st}">あ<ruby>日<rt>にちよう</rt></ruby>い</p>`);
      return r;
    };
    it('auto を明示すると、前後の仮名に掛ける。none と指定の無いときは掛けない', () => {
      const none = span('ruby-overhang: none');
      const def = span('');
      const auto = span('ruby-overhang: auto');
      // 掛けないとき: 「あ」(10pt) の後ろからルビの領域 (20pt)
      expect(def.x).toBeCloseTo(none.x, 6);
      expect(def.base[0].x).toBeCloseTo(none.base[0].x, 6);
      // 掛けるとき: ルビの領域は前の字に 5pt 掛かり、親文字は「あ」のすぐ後ろ
      expect(auto.x).toBeCloseTo(none.x - 5, 3);
      expect(auto.base[0].x).toBeCloseTo(none.x, 3);
      expect(rubiesOf('<p><ruby style="ruby-overhang: auto">日<rt>にちよう</rt></ruby></p>')[0].rubyOverhang).toBe(true);
      expect(rubiesOf('<p><ruby style="ruby-overhang: none">日<rt>にちよう</rt></ruby></p>')[0].rubyOverhang).toBe(false);
      expect(rubiesOf('<p><ruby>日<rt>にちよう</rt></ruby></p>')[0].rubyOverhang).toBeUndefined();
    });
    it('下側のルビ (ruby-position: under) も、auto なら前後の仮名に掛ける。縦書きも同じ', () => {
      const a = laid('<p style="ruby-overhang: auto; ruby-position: under">あ<ruby>日<rt>にちよう</rt></ruby>い</p>')[0];
      const n = laid('<p style="ruby-position: under">あ<ruby>日<rt>にちよう</rt></ruby>い</p>')[0];
      expect(a.x).toBeCloseTo(n.x - 5, 3);
      const v = (st: string) => laid(`<div style="writing-mode: vertical-rl; height: 60mm; ${st}"><p>あ<ruby>日<rt>にちよう</rt></ruby>い</p></div>`)[0];
      expect(v('ruby-overhang: auto').y).toBeCloseTo(v('').y - 5, 3);
    });
  });

  describe('ruby-merge (§4.2)', () => {
    const body = (st: string) => `<p><ruby style="${st}"><rb>無</rb><rb>常</rb><rt>む</rt><rt>じょう</rt></ruby></p>`;
    const pairs = (st: string) => rubiesOf(body(st)).map((r) => `${r.baseText}:${r.rubyText}`);
    it('separate (初期値) は親文字ごとの組、merge は区切りの注釈をつなげた 1 組', () => {
      expect(pairs('')).toEqual(['無:む', '常:じょう']);
      expect(pairs('ruby-merge: separate')).toEqual(['無:む', '常:じょう']);
      expect(pairs('ruby-merge: merge')).toEqual(['無常:むじょう']);
    });
    it('merge した注釈の ruby-align は、段の入れ物 (ruby・rtc) の値を使い、rt の値は使わない', () => {
      const [r] = rubiesOf('<p><ruby style="ruby-merge: merge; ruby-align: center"><rb>無</rb><rb>常</rb><rt style="ruby-align: start">む</rt><rt>じょう</rt></ruby></p>');
      expect(r).toMatchObject({ baseText: '無常', rubyText: 'むじょう', rubyAlign: 'center' });
    });
    it('auto は未対応 (separate として組み、未対応の値として数える)', () => {
      expect(pairs('ruby-merge: auto')).toEqual(['無:む', '常:じょう']);
      // @supports: 対応した値は真、ruby-merge: auto は偽
      expect(['(ruby-position: under)', '(ruby-align: center)', '(ruby-overhang: auto)', '(ruby-merge: merge)', '(ruby-merge: auto)'].map((c) => matchSupports(c))).toEqual([true, true, true, true, false]);
      expect(unsupportedCssReport(parseCss('ruby { ruby-merge: auto } .a { ruby-merge: merge; ruby-position: under; ruby-align: center; ruby-overhang: auto }'))).toEqual({ unsupported: { 'ruby-merge: auto': 1 }, unknown: {} });
    });
  });
});
