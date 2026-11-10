import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { formatPageNumber, withGrouping } from '../src/pageNumber';
import { importXslFo } from '../src/xslfoImport';
import { doc, makeEngine, walk } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

describe('ページ番号の書式 (§7.26.1)', () => {
  it('10 進・0 埋め・ローマ数字・アルファベット・全角・漢数字、前後の文字', () => {
    expect(formatPageNumber(7)).toBe('7');
    expect(formatPageNumber(7, '01')).toBe('07');
    expect(formatPageNumber(14, 'i')).toBe('xiv');
    expect(formatPageNumber(14, 'I')).toBe('XIV');
    expect(formatPageNumber(28, 'a')).toBe('ab');
    expect(formatPageNumber(3, 'A')).toBe('C');
    expect(formatPageNumber(12, '１')).toBe('１２');
    expect(formatPageNumber(125, '一')).toBe('百二十五');
    expect(formatPageNumber(3, '- 1 -')).toBe('- 3 -');
  });

  it('桁区切り (grouping-separator・grouping-size。XSLT 1.0 §7.7.1): 10 進の書式の数を、後ろから grouping-size 桁ごとに区切る', () => {
    expect(formatPageNumber(1234567, withGrouping('1', ',', 3))).toBe('1,234,567');
    expect(formatPageNumber(999, withGrouping('1', ',', 3))).toBe('999');
    expect(formatPageNumber(1000, withGrouping('1', ',', 3))).toBe('1,000');
    expect(formatPageNumber(12345, withGrouping(undefined, ' ', 2))).toBe('1 23 45');
    // 0 埋めした桁も区切る。前後の文字はそのまま
    expect(formatPageNumber(12, withGrouping('(0001)', ',', 3))).toBe('(0,012)');
    expect(formatPageNumber(1234, withGrouping('１', '，', 3))).toBe('１，２３４');
    // 10 進でない書式 (ローマ数字・アルファベット・漢数字) は区切らない
    expect(formatPageNumber(1234, withGrouping('i', ',', 3))).toBe('mccxxxiv');
    expect(formatPageNumber(1234, withGrouping('一', ',', 3))).toBe('千二百三十四');
  });

  it('fo:page-sequence の grouping-separator・grouping-size。片方だけなら無視する。letter-value は値を確かめるだけ', () => {
    const fo = (attrs: string) =>
      `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="60mm" page-height="40mm" margin="5mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:page-sequence master-reference="m" initial-page-number="1234" ${attrs}><fo:flow flow-name="xsl-region-body"><fo:block>p<fo:page-number/></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const text = (attrs: string) => {
      const im = importXslFo(fo(attrs), (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never, { compat: 'spec' });
      let s = '';
      walk(E.engine.layout(im.document).sheets[0] as never, (a) => {
        if (a.type === 'glyph') s += (a as { text: string }).text;
      });
      return { s, miss: Object.keys(im.report.unsupported) };
    };
    expect(text('grouping-separator="," grouping-size="3"').s).toBe('p1,234');
    expect(text('format="01" grouping-separator="." grouping-size="2"').s).toBe('p12.34');
    expect(text('grouping-separator=","').s).toBe('p1234');
    expect(text('grouping-size="3"').s).toBe('p1234');
    expect(text('letter-value="alphabetic" format="a"')).toEqual({ s: 'paul', miss: [] });
    expect(text('letter-value="traditional"').miss).toEqual([]);
    expect(text('letter-value="x"').miss.join(' ')).toContain('letter-value');
    expect(text('grouping-separator="," grouping-size="0"').miss.join(' ')).toContain('grouping-size');
    expect(text('grouping-separator=",," grouping-size="3"').miss.join(' ')).toContain('grouping-separator');
  });

  it('page-number-citation は参照先のページの書式で、-last は最後のページを返す', () => {
    const t = E.engine.layout({
      type: 'document',
      sequences: [
        {
          type: 'page-sequence',
          master: doc([]).sequences[0].master,
          pageNumberFormat: 'i',
          flow: {
            type: 'flow',
            fontSize: 10,
            children: [
              { type: 'block', children: ['参照', { type: 'page-number-citation', refId: 'x' }, '〜', { type: 'page-number-citation', refId: 'x', last: true }] },
              { type: 'block', id: 'x', breakBefore: 'page', children: ['あ\n'.repeat(30)] },
            ],
          },
        },
      ],
    });
    const text: string[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') text.push(a.text);
    });
    expect(text.join('')).toContain('参照ii〜iv'); // 30 行は 2〜4 ページ目にまたがる
  });
});

describe('ローマ数字の字・丸数字', () => {
  it('Ⅰ / ⅰ / ①', async () => {
    const { formatPageNumber: f } = await import('../src/pageNumber');
    expect([1, 4, 12, 13].map((n) => f(n, 'Ⅰ'))).toEqual(['Ⅰ', 'Ⅳ', 'Ⅻ', 'XIII']);
    expect(f(3, 'ⅰ')).toBe('ⅲ');
    expect([1, 20, 21, 36, 50, 51].map((n) => f(n, '①'))).toEqual(['①', '⑳', '㉑', '㊱', '㊿', '51']);
    expect(f(3, '*1')).toBe('*3');
  });
});

describe('ページ番号の書式 (XSLT 1.0 §7.7.1)', () => {
  it('最初のトークンだけを使い、前後の区切りを残す', () => {
    expect(formatPageNumber(3, '- 1 -')).toBe('- 3 -');
    expect(formatPageNumber(3, '01')).toBe('03');
    expect(formatPageNumber(4, 'i')).toBe('iv');
    expect(formatPageNumber(28, 'A')).toBe('AB');
    expect(formatPageNumber(12, '一')).toBe('十二');
  });
  it('知らないトークンは 1 とみなす。2 つ目以降のトークンは使わない', () => {
    expect(formatPageNumber(3, 'Page 1')).toBe('3');
    expect(formatPageNumber(3, '(1.a)')).toBe('(3)');
  });
});

describe('ページ番号参照の収束: 2 回目以降の組版で、変わらない page-sequence は組み直さない', () => {
  const master = () => doc([]).sequences[0].master;
  const seq = (children: unknown[]) => ({ type: 'page-sequence', master: master(), flow: { type: 'flow', fontSize: 10, children } });
  /** layoutSequence (page-sequence を 1 回組む) の回数と、ページごとの字 */
  const run = async (d: unknown) => {
    const { vi } = await import('vitest');
    const { LayoutEngine } = await import('../src/layoutEngine');
    const spy = vi.spyOn(LayoutEngine.prototype as unknown as Record<string, (...a: unknown[]) => unknown>, 'layoutSequence');
    try {
      const t = E.engine.layout(d as never);
      const pages = t.sheets.map((s) => {
        let text = '';
        walk(s.page.regionBody, (a) => {
          if (a.type === 'glyph') text += a.text;
        });
        return text;
      });
      return { calls: spy.mock.calls.length, pages };
    } finally {
      spy.mockRestore();
    }
  };
  const cite = (refId: string) => ({ type: 'page-number-citation', refId });
  const pageBreaks = (n: number) => Array.from({ length: n }, (_, k) => ({ type: 'block', breakBefore: 'page', children: [`p${k}`] }));

  it('参照の無い page-sequence は、2 回目の組版で前回のページをそのまま使う', async () => {
    const r = await run({ type: 'document', sequences: [seq([{ type: 'block', children: ['目次 ', cite('x')] }]), seq([{ type: 'block', id: 'x', children: ['本文'] }])] });
    // 1 回目: 2 つの sequence。2 回目: 参照の値が変わる目次の sequence だけ
    expect(r.calls).toBe(3);
    expect(r.pages[0]).toBe('目次 2');
    expect(r.pages[1]).toBe('本文');
  });

  it('前のページへの参照は 1 回目から正しい値、幅の同じ数字になる前方参照は字を差し替えて組み直さない', async () => {
    // 2 ページ目から 5 ページ目への参照: 1 回目は仮の値 (いまのページ番号 2)。Noto Serif JP の 2 と 5 は送りが同じなので字を差し替えて済む
    const r = await run({
      type: 'document',
      sequences: [seq([{ type: 'block', id: 'a', children: ['A'] }, { type: 'block', breakBefore: 'page', children: ['C→', cite('b')] }, ...pageBreaks(2), { type: 'block', id: 'b', breakBefore: 'page', children: ['B→', cite('a')] }])],
    });
    expect(r.calls).toBe(1);
    expect(r.pages[1]).toBe('C→5');
    expect(r.pages[4]).toBe('B→1');
  });

  it('幅の違う数字になる前方参照は組み直す (Noto Serif JP の 1 と 2)', async () => {
    const r = await run({ type: 'document', sequences: [seq([{ type: 'block', children: ['→', cite('x')] }, { type: 'block', id: 'x', breakBefore: 'page', children: ['X'] }])] });
    expect(r.calls).toBe(2);
    expect(r.pages[0]).toBe('→2');
  });

  it('桁数の違う前方参照は組み直す', async () => {
    const r = await run({ type: 'document', sequences: [seq([{ type: 'block', children: ['→', cite('x')] }, ...pageBreaks(10), { type: 'block', id: 'x', breakBefore: 'page', children: ['X'] }])] });
    expect(r.calls).toBe(2);
    expect(r.pages[0]).toBe('→12');
    expect(r.pages[11]).toBe('X');
  });
});
