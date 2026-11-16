/**
 * 行内の要素の境目をまたぐ改行 (segment break) の扱い (HTM-85。CSS Text 3 §4.1.1・§4.1.3・§1.5)。
 * 改行を空白にするか消すかは、前後の字で決める (前後が和文なら消し、ほかは空白)。前は、前後の字を同じテキストの節の中でしか見なかったので、
 * タグのすぐ内側・外側の改行 (<b>\n強調\n</b>・これは\n<b>強調</b>\nです) が、和文の間でも空白になった (「これは 強調 です」)。
 * 0.2.0 は <b>\n強調\n</b> の形を詰めていた (行内の要素の端の空白を消していたため)。境目をまたいだ前後の字で決めるようにした
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';

function load(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css }).document;
}

type N = { type?: string; children?: unknown[]; absolutePosition?: boolean };
/** 最初の段落 (文字列か行内の要素を子に持つ最初のブロック) の字。行内の要素の中もつなぎ、ほかの箱は [type] と書く */
function paraText(doc: unknown): string {
  const text = (n: unknown): string =>
    typeof n === 'string' ? n : n && typeof n === 'object' && (n as N).type === 'inline' ? ((n as N).children ?? []).map(text).join('') : n && typeof n === 'object' ? `[${(n as N).type}]` : '';
  let found: string | undefined;
  const visit = (n: unknown) => {
    if (found !== undefined || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as N;
    if (o.type === 'block' && o.children?.some((c) => typeof c === 'string' || (c as N)?.type === 'inline')) {
      found = o.children.map(text).join('');
      return;
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(doc);
  return found ?? '';
}

describe('行内の要素の境目をまたぐ改行 (CSS Text 3 §4.1.3・§1.5。HTM-85)', () => {
  const cases: Array<[string, string, string?]> = [
    // 和文どうし: タグのすぐ内側の改行 (0.2.0 は詰めていた)・すぐ外側の改行 (0.2.0 も空白が入っていた)
    ['<p>これは<b>\n強調\n</b>です</p>', 'これは強調です'],
    ['<p>これは\n<b>強調</b>\nです</p>', 'これは強調です'],
    // 改行の前後の字下げの空白・タブ
    ['<p>これは<b>\n    強調\n  </b>です</p>', 'これは強調です'],
    ['<p>これは<b>\n\t強調\t\n</b>です</p>', 'これは強調です'],
    ['<p>これは<a href="#x">\n  リンク\n</a>です</p>', 'これはリンクです'],
    ['<p>これは<span>\n強調\n</span>です</p>', 'これは強調です'],
    // 改行の前の空白が別の節にあっても、改行の前後の空白は消える (同じ節の中の「これは \n強調」と同じ)
    ['<p>これは <b>\n強調</b>です</p>', 'これは強調です'],
    // 入れ子の行内の要素・間の空の行内の要素
    ['<p>これは<span><b>\n強調</b></span>\nです</p>', 'これは強調です'],
    ['<p>これは<b></b>\n<i>\n強調</i>です</p>', 'これは強調です'],
    // 段落の頭・終わりの改行
    ['<p>\n  これは\n  <b>強調</b>\n</p>', 'これは強調'],
    // 欧文どうし・和欧の境は空白 (今の、同じ節の中の決まりと同じ)
    ['<p>word\n<b>bold</b>\nword</p>', 'word bold word'],
    ['<p>word<b>\nbold\n</b>word</p>', 'word bold word'],
    ['<p>和文\n<b>word</b>\n和文</p>', '和文 word 和文'],
    ['<p>これは<code>\ncode\n</code>です</p>', 'これは code です'],
    // 行内の要素でない境目 (強制改行・画像・inline-block・ルビ) は、またがない
    ['<p>これは<br>\n<b>強調</b></p>', 'これは\n強調'],
    ['<p>これは<img src="a.png">\n<b>強調</b></p>', 'これは[image] 強調'],
    ['<p>これは<span style="display:inline-block">箱</span>\n<b>強調</b></p>', 'これは[inline-container] 強調'],
    ['<p>これは<ruby>漢<rt>かん</rt></ruby>\nです</p>', 'これは[ruby] です'],
    // 流れの外の箱 (回り込み) はまたぐ (§1.5)
    ['<p>これは<span style="float:left">F</span>\n<b>強調</b></p>', 'これは[float]強調'],
    // white-space が空白を残す所は変えない
    ['<p style="white-space: pre">これは<b>\n強調\n</b>です</p>', 'これは\n強調\nです'],
    ['<p>これは<span style="white-space: pre">\n強調\n</span>です</p>', 'これは\n強調\nです'],
    ['<p>これは<span style="white-space: pre-line">\n強調</span></p>', 'これは\n強調'],
    // 空白を残すブロックの中の、空白を詰める行内の要素の端の改行
    ['<p style="white-space: pre">あ<span style="white-space: normal">\nい\n</span>x</p>', 'あい x'],
    // 4f46255 が直した形は変えない
    ['<p>word <b>bold </b>word</p>', 'word bold word'],
  ];
  for (const [body, want, css] of cases) {
    it(body, () => {
      expect(paraText(load(body, css))).toBe(want);
    });
  }

  it('中のブロックで分けた所はまたがない (HTM-88)', () => {
    const doc = load('<p>これは<span><div>塊</div>\n強調</span></p>');
    expect(JSON.stringify(doc)).toContain('"強調"');
    expect(JSON.stringify(doc)).not.toContain('これは強調');
  });

  it('決めない改行の印を、文書に残さない (脚注・回り込み・余白の箱の中も)', () => {
    const doc = load(
      '<p>これは<span class="fn">\n脚注\n</span>です<span style="float:left">\n回り込み\n</span>。<span style="position:absolute">\n絶対\n</span></p><div class="r">\n柱\n</div>',
      '.fn{float:footnote} .r{position:running(r)} @page{@top-center{content:element(r)}}',
    );
    expect(JSON.stringify(doc)).not.toContain(' ');
    expect(JSON.stringify(doc)).not.toContain('\\u2000');
  });

  it('長い入力でも、手間は字の数に比例する (行内の要素の続く 2 万個の和文)', () => {
    const body = '<p>' + '<b>\n字\n</b>'.repeat(20000) + '</p>';
    const t0 = Date.now();
    const s = paraText(load(body));
    expect(s).toBe('字'.repeat(20000));
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});
