import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importHtml, parsePageRule, type StyleSource, shadowsOf } from '../src/htmlImport';
import type { Area, LBlock, LTable } from '../src/types';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';

const DEF = { width: 210, height: 297, margin: 20 };

describe('HTML: @page の読み取り', () => {
  it('size のキーワード・向き・長さ、margin の省略形と各辺', () => {
    expect(parsePageRule('@page { size: A5; margin: 15mm 10mm; }', DEF)).toEqual({ width: 148, height: 210, margins: { top: 15, right: 10, bottom: 15, left: 10 } });
    expect(parsePageRule('@page { size: a4 landscape }', DEF).width).toBe(297);
    const p = parsePageRule('/* x */ @page { size: 100mm 150mm; margin-top: 30mm; @top-center { content: "x" } } @page :first { size: A3 }', DEF);
    expect([Math.round(p.width), Math.round(p.height), Math.round(p.margins.top), p.margins.left]).toEqual([100, 150, 30, 20]);
  });

  it('margin・size の em・rem・calc()・vw (em は @page の font-size、無ければ根元の字の大きさ)', () => {
    const mm = (px: number) => (px * 25.4) / 96;
    const p = parsePageRule('@page { margin: 2em calc(10mm + 1rem) 10vh 10vw }', DEF);
    expect(p.margins.top).toBeCloseTo(mm(32), 6);
    expect(p.margins.right).toBeCloseTo(10 + mm(16), 6);
    expect(p.margins.bottom).toBeCloseTo(29.7, 6);
    expect(p.margins.left).toBeCloseTo(21, 6);
    const q = parsePageRule('@page { font-size: 10px; margin: 3em; size: 50em 60em }', DEF);
    expect(q.margins.top).toBeCloseTo(mm(30), 6);
    expect(q.width).toBeCloseTo(mm(500), 6);
    expect(q.height).toBeCloseTo(mm(600), 6);
  });
});

/** 確定したスタイルの代わり: 要素の data-css 属性 (prop:value;…) と、display の既定 (タグ名から) */
export function fakeStyles(): StyleSource {
  const display: Record<string, string> = { body: 'block', section: 'block', p: 'block', h1: 'block', div: 'block', ul: 'block', li: 'list-item', table: 'table', tr: 'table-row', td: 'table-cell', tbody: 'table-row-group' };
  const base: Record<string, string> = { 'font-size': '16px', 'font-weight': '400', 'font-family': 'serif', color: 'rgb(0, 0, 0)', 'line-height': 'normal', 'white-space': 'normal', 'list-style-type': 'disc', 'padding-left': '0px' };
  return {
    style: (el, pseudo) => ({
      getPropertyValue: (name: string) => {
        if (pseudo) {
          const w = pseudo === '::before' ? 'before' : 'after';
          return name === 'content' ? (el.getAttribute(`data-${w}`) ?? 'none') : (el.getAttribute(`data-${w}-${name}`) ?? '');
        }
        const own = Object.fromEntries(
          (el.getAttribute('data-css') ?? '')
            .split(';')
            .filter(Boolean)
            .map((d) => d.split(':').map((x) => x.trim())),
        );
        if (own[name] !== undefined) return own[name];
        if (name === 'display') return display[el.localName] ?? 'inline';
        // 継承 (簡易): 祖先の data-css
        for (let p = el.parentNode as Element | null; p && p.getAttribute; p = p.parentNode as Element | null) {
          const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(p.getAttribute('data-css') ?? '');
          if (m && !/^(margin|padding|border|background|display|width|height|break|counter)/.test(name)) return m[1].trim();
        }
        return base[name] ?? '';
      },
    }),
    rect: (el) => {
      const r = el.getAttribute('data-rect');
      if (!r) return undefined;
      const [x, y, width, height] = r.split(/\s+/).map(Number);
      return { x, y, width, height };
    },
    isAuto: (el, prop) => !new RegExp(`(?:^|;)\\s*${prop}\\s*:`).test(el.getAttribute('data-css') ?? ''),
  };
}

/** セレクタ (tag・.class・#id とその組み合わせ、子孫結合子) に合う要素 (テスト用の簡易版) */
export function fakeSelect(doc: Document): (sel: string) => Element[] {
  const one = (el: Element, simple: string) => {
    const m = /^([a-z0-9*]+)?((?:[.#][\w-]+)*)$/i.exec(simple);
    if (!m) throw new Error(`selector: ${simple}`);
    if (m[1] && m[1] !== '*' && el.localName !== m[1]) return false;
    for (const [, k, v] of m[2].matchAll(/([.#])([\w-]+)/g)) {
      if (k === '.' && !(el.getAttribute('class') ?? '').split(/\s+/).includes(v)) return false;
      if (k === '#' && el.getAttribute('id') !== v) return false;
    }
    return true;
  };
  return (sel) => {
    const parts = sel.trim().split(/\s+/);
    return Array.from(doc.getElementsByTagName('*')).filter((el) => {
      if (!one(el, parts[parts.length - 1])) return false;
      let p = el.parentNode as Element | null;
      for (let k = parts.length - 2; k >= 0; k--) {
        while (p && typeof p.getAttribute === "function" && !one(p, parts[k])) p = p.parentNode as Element | null;
        if (!p || typeof p.getAttribute !== "function") return false;
        p = p.parentNode as Element | null;
      }
      return true;
    });
  };
}

const load = (body: string) =>
  importHtml(new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document, fakeStyles(), { css: '@page { size: A5 }' });

describe('HTML: 論理ツリーへの変換', () => {
  it('ブロックの子があっても、インラインの間の空白は残す (行の頭・終わりの空白だけを除く。CSS 2.1 §9.2.1.1・CSS Text 3 §4.1.2)', () => {
    const css = '.s::before { content: leader(dotted) }';
    const doc = new DOMParser().parseFromString('<html><head></head><body><p><span>A</span> <span class="s"></span><div>x</div> </p></body></html>', 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } }), { css });
    const p = (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LBlock;
    // A と点線の間の空白は残り、ブロック (div) の後ろの空白は除く
    expect(p.children.map((c) => (typeof c === 'string' ? c : c.type))).toEqual(['inline', ' ', 'inline', 'block']);
  });
  it('-ah-content-width の割合の基準の本来の大きさは、画像に書かれた解像度で決める (intrinsicFromImage)', () => {
    const doc = new DOMParser().parseFromString('<html><head></head><body><img id="a" src="x.png" style="-ah-content-width: 50%"/><img id="b" src="y.png"/></body></html>', 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } }), { css: '@page { size: A5 }' });
    const imgs: Array<Record<string, unknown>> = [];
    const walkJ = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walkJ);
      else if (v && typeof v === 'object') {
        if ((v as { type?: string }).type === 'image') imgs.push(v as Record<string, unknown>);
        Object.values(v).forEach(walkJ);
      }
    };
    walkJ(r.document.sequences[0].flow);
    expect(imgs.find((i) => i.src === 'x.png')).toMatchObject({ widthScale: 0.5, intrinsicFromImage: true });
    expect(imgs.find((i) => i.src === 'y.png')?.intrinsicFromImage).toBeUndefined();
  });
  it('::marker の色と書体は、リストの記号だけに当てる (印刷の色 rgb-icc も。CSS Lists 3 §3.1)', () => {
    const css = 'li::marker { color: red; font-family: monospace } li.s::marker { color: rgb-icc(0, 0, 0, #Separation, "Ink", 1) }';
    const doc = new DOMParser().parseFromString('<html><head></head><body><ul><li>a</li><li class="s">b</li></ul><ol><li style="list-style-position: inside">c</li></ol></body></html>', 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } }), { css, mapFont: (names) => names[0] });
    const inl: Array<Record<string, unknown>> = [];
    const texts: string[] = [];
    const walkJ = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walkJ);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.type === 'inline' && Array.isArray(o.children) && o.children.length === 1 && typeof o.children[0] === 'string') inl.push(o);
        Object.values(o).forEach(walkJ);
      } else if (typeof v === 'string') texts.push(v);
    };
    walkJ(r.document.sequences[0].flow);
    const marks = inl.filter((o) => /^(•|1\. ?)$/.test(o.children as unknown as string));
    expect(marks.map((o) => [String((o.children as string[])[0]).trim(), o.fontFamily])).toEqual([
      ['•', 'monospace'],
      ['•', 'monospace'],
      ['1.', 'monospace'],
    ]);
    expect(marks[0].color).toBe('#ff0000');
    expect(marks[1].color).not.toBe(marks[0].color);
    // 本文 (a・b・c) は包まない
    expect(inl.some((o) => /^[abc]$/.test(String((o.children as string[])[0])))).toBe(false);
  });
  it('アンテナハウス互換: list-style-type の check などを古い仕様の記号にする。互換でなければ decimal。表の列の幅の配り方を ah-html にする', () => {
    const conv = (ah: boolean) => {
      const doc = new DOMParser().parseFromString(
        '<html><head></head><body><ul><li style="list-style-type: check">a</li><li style="list-style-type: box">b</li><li style="list-style-type: diamond">c</li><li style="list-style-type: hyphen">d</li></ul><table><tr><td>x</td></tr></table></body></html>',
        'text/html',
      ) as unknown as Document;
      return importHtml(doc, cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } }), { css: '@page { size: A5 }', ...(ah ? { ahObsoleteListStyles: true, tableAutoWidthAh: true } : {}) });
    };
    const ah = JSON.stringify(conv(true).document.sequences[0].flow);
    for (const ch of ['\u2713', '\u25A1', '\u25C6', '\u2043']) expect(ah).toContain(ch);
    expect(ah).toContain('"fitContentRule":"ah-html"');
    const std = JSON.stringify(conv(false).document.sequences[0].flow);
    expect(std).not.toContain('\u2713');
    expect(std).toContain('"1."');
    expect(std).not.toContain('fitContentRule');
  });
  it('閉じた details は summary だけを出し、summary には開閉の印 (▸・▾) を付ける (HTML Living Standard §15.5.5)', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head></head><body><details><summary>見出し</summary><p>中身</p></details><details open><summary>開</summary><p>見える</p></details><div hidden="until-found">隠す</div></body></html>',
      'text/html',
    ) as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } }), { css: '@page { size: A5 }' });
    const text = JSON.stringify(r.document.sequences[0].flow);
    expect(text).toContain('▸ ');
    expect(text).toContain('見出し');
    expect(text).not.toContain('中身');
    expect(text).toContain('▾ ');
    expect(text).toContain('見える');
    expect(text).not.toContain('隠す');
  });
  it('style 属性のアンテナハウスの別名 (-ah-line-height-shift-adjustment) を読み、子孫に継承する', () => {
    const r = load('<div style="-ah-line-height-shift-adjustment: consider-shifts"><p>a<sup>b</sup></p></div>');
    expect(JSON.stringify(r.document.sequences[0].flow)).toContain('"lineHeightShiftAdjustment":"consider-shifts"');
  });
  it('縦書きの中の横書きの inline-block (縦中横) は、箱の中を横書きで組む。-ah-line-stacking-strategy を読む', () => {
    const css = '.v { writing-mode: tb-rl } .t { display: inline-block; writing-mode: lr-tb } .s { -ah-line-stacking-strategy: font-height }';
    const doc = new DOMParser().parseFromString(`<html><head><style>${css}</style></head><body><div class="v"><p>年<span class="t">12</span>月</p></div><div class="s"><p>a</p></div></body></html>`, 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
    const ics: Array<{ writingMode?: string }> = [];
    const text = JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'inline-container' && ics.push(v), v));
    expect(ics.map((x) => x.writingMode)).toEqual(['horizontal-tb']);
    expect(text).toContain('"lineStackingStrategy":"font-height"');
  });
  it('脚注の参照番号 (::footnote-call) の字の大きさと太さは、置く所 (太字の見出し) でなく、脚注の要素と ::footnote-call の規則から', () => {
    const css = 'h3 { font-weight: bold; font-size: 12pt } .f { float: footnote; font-weight: normal; font-size: 7.5pt; line-height: 1.2 } ::footnote-call { content: counter(footnote) ")"; font-size: 6pt; font-weight: normal }';
    const doc = new DOMParser().parseFromString(`<html><head><style>${css}</style></head><body><h3>見出し<span class="f">注</span></h3></body></html>`, 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
    const fns: Array<{ referenceScale?: number; referenceWeight?: number; referenceLineHeight?: number }> = [];
    JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'footnote' && fns.push(v), v));
    expect(fns).toHaveLength(1);
    expect(fns[0].referenceWeight).toBe(400);
    expect(fns[0].referenceScale).toBeCloseTo(0.5, 5);
    // 行の高さも脚注の要素から (line-height: 1.2 を参照番号の 6pt に掛ける)
    expect(fns[0].referenceLineHeight).toBeCloseTo(7.2, 5);
    // アンテナハウス互換: 行の高さは置く所の要素から (数値の 1.3 を参照番号の 6pt に掛ける)
    const css2 = css + ' h3 { line-height: 1.3 }';
    const doc2 = new DOMParser().parseFromString(`<html><head><style>${css2}</style></head><body><h3>見出し<span class="f">注</span></h3></body></html>`, 'text/html') as unknown as Document;
    const r2 = importHtml(doc2, cascadeStyles(doc2, css2, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: css2, footnoteCallLineHeightFromParent: true });
    const fns2: Array<{ referenceLineHeight?: number }> = [];
    JSON.stringify(r2.document.sequences[0].flow, (_k, v) => (v && v.type === 'footnote' && fns2.push(v), v));
    expect(fns2[0].referenceLineHeight).toBeCloseTo(7.8, 5);
  });
  it('::before の印刷の色 (rgb-icc の特色) を使う', () => {
    const css = `h3::before { content: "1.1 "; color: rgb(0, 61, 25); color: rgb-icc(0, 61, 25, #Separation, 'PANTONE 627 PC') }`;
    const doc = new DOMParser().parseFromString(`<html><head><style>${css}</style></head><body><h3>見出し</h3></body></html>`, 'text/html') as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css, spotColors: { 'PANTONE 627 PC': [0.94, 0.34, 0.6, 0.82] } });
    expect(JSON.stringify(r.document.sequences[0].flow)).toMatch(/"color":"spot\(/);
  });
  it('ブロックの間の br は改行の行として残す (空白だけの文字列は捨てる)', () => {
    const r = load('<div><div>a</div>\n<br />\n<div>b</div>\n</div>');
    const text = JSON.stringify(r.document.sequences[0].flow);
    expect(text).toContain('"\\n"');
    expect(text).not.toContain('" "');
  });
  it('ルビの字の大きさは rt の計算値 (UA の既定は 50%。CSS Ruby 1 付録 A.1)', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><style>.b rt { font-size: 60% }</style></head><body><p><ruby>漢<rt>かん</rt></ruby><ruby class="b">字<rt>じ</rt></ruby></p></body></html>',
      'text/html',
    ) as unknown as Document;
    const styles = cascadeStyles(doc, '.b rt { font-size: 60% }', { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } });
    expect(styles.style(doc.getElementsByTagName('rt')[0] as unknown as Element).getPropertyValue('white-space')).toBe('nowrap');
    const r = importHtml(doc, styles, { css: '@page { size: A5 }' });
    const rubies: Array<{ rubyScale?: number }> = [];
    JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'ruby' && rubies.push(v), v));
    expect(rubies.map((x) => x.rubyScale)).toEqual([undefined, 0.6]);
  });
  it('互換モード: 幅が auto のセルの中の行内の img に、最小の幅で前後を改行しない印を付ける (Quirks Mode Standard §3.8)', () => {
    const marks = (mode: 'quirks' | 'no-quirks') => {
      const doc = new DOMParser().parseFromString(
        '<html><head></head><body><table><tr><td><img src="a.png" width="10" height="10"> <span><img src="b.png" width="10" height="10"></span></td><td width="100"><img src="c.png" width="10" height="10"></td><td><div><img src="d.png" width="10" height="10"></div></td></tr></table></body></html>',
        'text/html',
      ) as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, '', { uaCss: HTML_UA_CSS, quirksMode: mode, viewport: { width: 600, height: 800 } }), { css: '@page { size: A5 }' });
      const out: string[] = [];
      JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'image' && v.noWrapInCellMin && out.push(v.src), v));
      return out;
    };
    expect(marks('quirks')).toEqual(['a.png', 'b.png']);
    expect(marks('no-quirks')).toEqual([]);
  });
  it('互換モード: body は html を、html はページの本文領域を満たす (Quirks Mode Standard §3.6・§3.7)', () => {
    const minB = (mode: 'quirks' | 'no-quirks', bodyCss = '') => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body style="border: 1px solid black; ${bodyCss}"><p>短い本文</p></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, '', { uaCss: HTML_UA_CSS, quirksMode: mode, viewport: { width: 600, height: 800 } }), { css: '@page { size: A5; margin: 20mm }' });
      return (r.document.sequences[0].flow.children[0] as LBlock).minBlockSize;
    };
    // A5 の本文領域の高さ 170mm から、body の余白 (8px × 2) と罫線 (1px × 2) を引いた内容の高さ (pt)
    expect(minB('quirks')).toBeCloseTo((170 * 72) / 25.4 - 12 - 1.5, 1);
    expect(minB('no-quirks')).toBeUndefined();
    // 高さの指定がある・float の body は広げない
    expect(minB('quirks', 'height: 100px')).toBeUndefined();
    expect(minB('quirks', 'float: left')).toBeUndefined();
  });
  it('pageGroupFirst (アンテナハウス互換): 同じ名前のページでも、強制改ページの要素ごとにページの組 (シーケンス) を分ける', () => {
    const css = 'section { page: Chapter; break-before: page }';
    const seqs = (pageGroupFirst: boolean) => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body><section><p>一</p></section><section><p>二</p></section></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css, pageGroupFirst });
      return r.document.sequences.length;
    };
    expect(seqs(false)).toBe(1);
    expect(seqs(true)).toBe(2);
  });
  it('-ah-linefeed-treatment: ignore は改行を捨てる (空白にしない。XSL §7.16.7。子孫にも継承する)', () => {
    const text = (css: string) => {
      const doc = new DOMParser().parseFromString('<html><head></head><body><div>ab\n<span>cd</span></div></body></html>', 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
      return JSON.stringify(r.document.sequences[0].flow).replace(/[^a-d ]/g, '');
    };
    expect(text('')).toContain('ab cd');
    expect(text('div { -ah-linefeed-treatment: ignore }')).toContain('abcd');
  });
  it('罫線の印刷の色 (device-cmyk・アンテナハウスの cmyk()) を、辺ごとに読む', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head></head><body><p id="a" style="border: solid 2px; border-color: cmyk(1,1,0,0)">a</p><p style="border: solid 2px black; border-left-color: device-cmyk(0 1 0 0)">b</p></body></html>',
      'text/html',
    ) as unknown as Document;
    const r = importHtml(doc, cascadeStyles(doc, '', { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: '' });
    // body の余白の箱の中
    const [a, b] = (r.document.sequences[0].flow.children[0] as LBlock).children as LBlock[];
    const col = (x: LBlock, sd: string) => (x.border as Record<string, { color?: string }> | undefined)?.[sd]?.color;
    expect(['top', 'right', 'bottom', 'left'].map((sd) => col(a, sd))).toEqual(['cmyk(1,1,0,0)', 'cmyk(1,1,0,0)', 'cmyk(1,1,0,0)', 'cmyk(1,1,0,0)']);
    expect(col(b, 'left')).toBe('cmyk(0,1,0,0)');
    expect(col(b, 'top')).toBe('#000000');
  });
  it('ブロック・文字の書式・余白・改ページ、空白の畳み込み (和文どうしの改行は詰める)', () => {
    const r = load('<p data-css="font-size:20px; margin-top:8px; break-before:page; color:rgb(255, 0, 0)">組み織りの\n組版  です</p>');
    const seq = r.document.sequences[0];
    expect([Math.round(seq.master.width), seq.fontSize]).toEqual([148, 12]);
    const p = seq.flow.children[0] as LBlock;
    expect([p.fontSize, p.color, p.breakBefore, (p.margin as { top: number }).top]).toEqual([15, '#ff0000', 'page', 6]);
    expect(p.children).toEqual(['組み織りの組版 です']);
    expect(r.document.title).toBe('t');
  });
  it('list-item の並びは、記号の列と本文の列の表になる', () => {
    const r = load('<ul data-css="padding-left:40px"><li>一</li><li>二</li></ul>');
    const ul = r.document.sequences[0].flow.children[0] as LBlock;
    const t = ul.children[0] as LTable;
    expect(t.columns[0].width).toBe(30);
    expect(t.body.rows.map((row) => row.cells[0].children)).toEqual([['•'], ['•']]);
  });
});

describe('影 (box-shadow・filter: drop-shadow())', () => {
  it('横・縦・ぼかし・広がり・色 (前でも後でも)、色の alpha は不透明度、inset は内側の影、複数', () => {
    expect(shadowsOf('0px 4px 8px 0px rgba(0, 0, 0, 0.3)')).toEqual([{ dx: 0, dy: 3, color: '#000000', blur: 6, opacity: 0.3 }]);
    expect(shadowsOf('rgb(255, 0, 0) 2px 2px 4px 1px, 1px 1px #00f')).toEqual([
      { dx: 1.5, dy: 1.5, color: '#ff0000', blur: 3, spread: 0.75 },
      { dx: 0.75, dy: 0.75, color: '#0000ff' },
    ]);
    expect(shadowsOf('inset 0 0 3px #000')).toEqual([{ dx: 0, dy: 0, blur: 2.25, color: '#000000', inset: true }]);
    expect(shadowsOf('none')).toEqual([]);
    // drop-shadow は広がりを持たない
    expect(shadowsOf('none', 'blur(2px) drop-shadow(rgba(0, 0, 0, 0.5) 3px 3px 2px)')).toEqual([{ dx: 2.25, dy: 2.25, color: '#000000', blur: 1.5, opacity: 0.5 }]);
  });
});

describe('HTML: position (CSS 2.1 §9.3・§10.1・§10.3.7)', () => {
  let E: Awaited<ReturnType<typeof makeEngine>>;
  beforeAll(async () => {
    E = await makeEngine();
  });
  const PT = 72 / 25.4;
  /** 組んだページの、ブロック・表のセルの箱 (ページの左上からの位置。中の字 (空白を除く) をつないだ文字列つき)。罫線は px で書く (pt は画素に丸められる) */
  type Box = { text: string; x: number; y: number; w: number; h: number; page: number };
  const layoutBoxes = (body: string, css = '') => {
    const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const all = `@page { size: A5; margin: 10mm } body { margin: 0 } p { margin: 0 } ${css}`;
    const r = importHtml(d, cascadeStyles(d, all, { viewport: { width: 600, height: 800 } }), { css: all });
    const tree = E.engine.layout(r.document);
    const boxes: Box[] = [];
    const textOf = (a: Area): string => (a.type === 'glyph' ? a.text : childrenOf(a).map(textOf).join(''));
    const rec = (a: Area, ox: number, oy: number, page: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'block' || a.type === 'table-cell') boxes.push({ text: textOf(a), x, y, w: a.width, h: a.height, page });
      if (a.type === 'line') return;
      for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0), page);
    };
    tree.sheets.forEach((sh, k) => rec(sh.page, 0, 0, k));
    /** 中身がちょうど text の、いちばん内側の箱 */
    const box = (text: string, page?: number) => boxes.filter((b) => b.text === text && (page === undefined || b.page === page)).pop()!;
    return { box, boxes, pages: tree.sheets.length };
  };

  it('絶対配置の箱は、position: relative の祖先の padding の箱を基準にし、幅の指定が無ければ中身に合わせる', () => {
    const html = (top: string) =>
      `<p>前</p><div style="position: relative; ${top} height: 16mm; border: 2px solid #999; padding: 3pt">box <div style="position: absolute; top: 2mm; right: 2mm; background: #222; color: #fff">札</div></div><p>後</p>`;
    const { box } = layoutBoxes(html(''));
    const cb = box('box札');
    const tag = box('札');
    // 基準の箱の padding の箱 (罫線 1.5pt の内側。padding は含む) の右上から 2mm
    expect(tag.y).toBeCloseTo(cb.y + 1.5 + 2 * PT, 3);
    expect(tag.x + tag.w).toBeCloseTo(cb.x + cb.w - 1.5 - 2 * PT, 3);
    // 幅は中身 (1 字) に合わせる (本文の幅いっぱいにしない)
    expect(tag.w).toBeLessThan(20);
    // 位置の基準の祖先が無ければ、本文領域が基準。幅は同じく中身に合わせる
    const page = layoutBoxes('<p>x</p><div style="position: absolute; top: 5mm; left: 5mm">印</div>').box('印');
    expect([page.x, page.y]).toEqual([expect.closeTo(15 * PT, 3), expect.closeTo(15 * PT, 3)]);
    expect(page.w).toBeLessThan(20);
  });

  it('自動の配置の表: 列をまたぐセルの最小・最大の幅も列に配り、表の幅は max-content にする (CSS 2.1 §17.5.2.2)', () => {
    const td = 'style="border: 1px solid #888; padding: 2pt 5pt;"';
    const span = `<tr><td colspan="2" ${td}>spanning both columns here and wider</td></tr>`;
    const xy = `<tr><td ${td}>x</td><td ${td}>y</td></tr>`;
    for (const rows of [span + xy, xy + span]) {
      const { box } = layoutBoxes(`<table style="border-collapse: collapse; font-size: 8pt">${rows}</table>`);
      const s = box('spanning both columns here and wider');
      const x = box('x');
      const y = box('y');
      // 折り返さない (1 行の高さは、1 字のセルと同じ)
      expect(s.h).toBeCloseTo(x.h, 1);
      // 列をまたぐセルは 2 列の幅いっぱい (はみ出さない)
      expect(s.x).toBeCloseTo(x.x, 1);
      expect(s.x + s.w).toBeCloseTo(y.x + y.w, 1);
      // 表の幅は中身 (max-content) に合わせ、本文の幅 (128mm) いっぱいにはしない
      expect(s.w).toBeLessThan(128 * PT * 0.8);
    }
  });

  it('position: relative は組んだ箱だけをずらし、後ろの箱は動かさない (中の絶対配置の箱もいっしょに動く)', () => {
    const html = (off: string) =>
      `<p>前</p><div style="position: relative; ${off} border: 4px solid">box <div style="position: absolute; top: 0; left: 0">札</div></div><p>後</p>`;
    const a = layoutBoxes(html(''));
    const b = layoutBoxes(html('top: 3mm; left: 4mm;'));
    expect(b.box('box札').y - a.box('box札').y).toBeCloseTo(3 * PT, 3);
    expect(b.box('box札').x - a.box('box札').x).toBeCloseTo(4 * PT, 3);
    expect(b.box('札').y - a.box('札').y).toBeCloseTo(3 * PT, 3);
    expect(b.box('後').y).toBeCloseTo(a.box('後').y, 3);
    // right・bottom は逆向き (left・top が無いとき)
    const c = layoutBoxes(html('bottom: 3mm; right: 4mm;'));
    expect(c.box('box札').y - a.box('box札').y).toBeCloseTo(-3 * PT, 3);
    expect(c.box('box札').x - a.box('box札').x).toBeCloseTo(-4 * PT, 3);
  });

  it('高さの指定の無い基準の箱の下端・左端から置く。上下の指定が無ければ、置かれるはずだった高さ (static position)', () => {
    const { box } = layoutBoxes(
      '<div style="position: relative; padding: 5pt; border: 4px solid">a<div style="position: absolute; bottom: 0; left: 0">下</div><p>b</p><p>c</p><div style="position: absolute; right: 0">静</div><p>d</p></div>',
    );
    const cb = box('abcd下静');
    const low = box('下');
    expect(low.y + low.h).toBeCloseTo(cb.y + cb.h - 3, 3);
    expect(low.x).toBeCloseTo(cb.x + 3, 3);
    // 上下の指定が無い箱は、前の段落 (c) の下の高さ。右端は padding の箱の右端
    const st = box('静');
    expect(st.y).toBeCloseTo(box('c').y + box('c').h, 3);
    expect(st.x + st.w).toBeCloseTo(cb.x + cb.w - 3, 3);
  });

  it('ページをまたぐ基準の箱: top は最初の断片、bottom は最後の断片が基準', () => {
    const { box, boxes, pages } = layoutBoxes(
      `<div style="position: relative; border: 4px solid">${'<p>行</p>'.repeat(40)}<div style="position: absolute; right: 0; top: 0">上</div><div style="position: absolute; right: 0; bottom: 0">下</div></div>`,
    );
    expect(pages).toBe(2);
    const up = box('上');
    const low = box('下');
    expect([up.page, low.page]).toEqual([0, 1]);
    // 最初の断片の上の罫線の内側、最後の断片の下の罫線の内側
    expect(up.y).toBeCloseTo(10 * PT + 3, 3);
    // 2 ページ目の基準の箱の断片 (いちばん外側の、行と「下」を含む箱)
    const frag = boxes.filter((b) => b.page === 1 && b.text.endsWith('行下'))[0];
    expect(low.y + low.h).toBeCloseTo(frag.y + frag.h - 3, 3);
    expect(low.x + low.w).toBeCloseTo(frag.x + frag.w - 3, 3);
  });

  it('絶対配置の ::after は、position: relative の要素自身を基準にする', () => {
    const { box } = layoutBoxes('<p class="r">本文</p>', '.r { position: relative; border: 4px solid; padding-right: 30pt } .r::after { content: "印"; position: absolute; right: 0; top: 0 }');
    const cb = box('本文印');
    const mark = box('印');
    expect(mark.x + mark.w).toBeCloseTo(cb.x + cb.w - 3, 3);
    expect(mark.y).toBeCloseTo(cb.y + 3, 3);
  });
});

describe('HTML: display: inline-table', () => {
  let E: Awaited<ReturnType<typeof makeEngine>>;
  beforeAll(async () => {
    E = await makeEngine();
  });
  /** 組んだページの字 (glyph) の、ページの左上からの位置 */
  const glyphs = (body: string) => {
    const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const css = '@page { size: A5; margin: 10mm } body { margin: 0 }';
    const r = importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
    const out: Array<{ text: string; x: number; w: number }> = [];
    const rec = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') out.push({ text: a.text, x, w: a.width });
      for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), oy);
    };
    rec(E.engine.layout(r.document).sheets[0].page, 0, 0);
    return { flow: r.document.sequences[0].flow, out };
  };

  it('行内の箱に入れた表として組み、表の左右の余白は箱の外側に取る (余白で表が潰れない)', () => {
    const td = 'style="border: 1px solid #000"';
    const { flow, out } = glyphs(`<div><table style="display: inline-table; border-collapse: collapse; margin-right: 10mm"><tr><td ${td}>aaa</td><td ${td}>bbb</td></tr></table>x</div>`);
    const ics: Array<{ margin?: { right: number }; children: Array<{ type: string }> }> = [];
    JSON.stringify(flow, (_k, v) => (v && v.type === 'inline-container' && ics.push(v), v));
    expect(ics).toHaveLength(1);
    expect(ics[0].children[0].type).toBe('table');
    expect(ics[0].margin?.right).toBeCloseTo((10 * 72) / 25.4, 3);
    // 字は 1 字ずつの箱
    const a = out.filter((g) => g.text === 'a').pop()!;
    const bs = out.filter((g) => g.text === 'b');
    const x = out.find((g) => g.text === 'x')!;
    expect([out.filter((g) => g.text === 'a').length, bs.length, !!x]).toEqual([3, 3, true]);
    const b = bs[bs.length - 1];
    // 2 つのセルは重ならない。後の字 x は、表の右端から 10mm (28.3pt) 以上離れる
    expect(bs[0].x).toBeGreaterThanOrEqual(a.x + a.w);
    expect(x.x - (b.x + b.w)).toBeGreaterThan(28);
  });
});

describe('HTML: 表ヘッダーの break-after: avoid', () => {
  it('thead に break-after: avoid があれば、表ヘッダーを本体の最初の行と同じページに置く (CSS 2.1 §13.3.3)', () => {
    const run = (css: string) => {
      const d = new DOMParser().parseFromString('<html><head><title>t</title></head><body><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></body></html>', 'text/html') as unknown as Document;
      const r = importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
      const tables: LTable[] = [];
      JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'table' && tables.push(v), v));
      return tables[0];
    };
    expect(run('thead { break-after: avoid }').keepHeaderWithBodyAh).toBe(true);
    expect(run('thead { page-break-after: avoid }').keepHeaderWithBodyAh).toBe(true);
    expect(run('').keepHeaderWithBodyAh).toBeUndefined();
  });
});

describe('HTML: display: contents・background-size の百分率・定義済みの数え方', () => {
  let E: Awaited<ReturnType<typeof makeEngine>>;
  beforeAll(async () => {
    E = await makeEngine();
  });
  const imp = (body: string, extraCss = '') => {
    const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const css = `@page { size: A5; margin: 10mm } body { margin: 0 } ${extraCss}`;
    return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
  };
  const texts = (body: string, css = '') => {
    const out: string[] = [];
    const rec = (a: Area) => {
      if (a.type === 'glyph') out.push(a.text);
      for (const c of childrenOf(a)) rec(c);
    };
    for (const s of E.engine.layout(imp(body, css).document).sheets) rec(s.page);
    return out.join('');
  };

  it('display: contents の要素のブロックの子を組み、要素自身の罫線・背景は付けない (CSS Display 3 §2.5)', () => {
    const css = '.c { display: contents; border: 2pt solid red; background: yellow; padding: 10pt; color: blue }';
    expect(texts('<p>前</p><div class="c"><p>中の一</p><p>中の二</p></div><p>後</p>', css)).toBe('前中の一中の二後');
    const flow = JSON.stringify(imp('<div class="c"><p>中</p></div><p>行の<span class="c">中</span>です</p>', css).document.sequences[0].flow);
    expect(flow).not.toContain('"backgroundColor"');
    expect(flow).not.toContain('"border"');
    // 受け継ぐ書式 (字の色) は中身に渡る
    expect(flow).toContain('"color":"#0000ff"');
  });

  it('background-size の百分率は、ブラウザの配置が無くても箱の大きさで決める (CSS Backgrounds 3 §3.9)', () => {
    const r = imp('<div style="width: 200pt; height: 100pt; background: url(a.png) no-repeat; background-size: 50%"></div>');
    const bi = JSON.stringify(r.document.sequences[0].flow);
    expect(bi).toContain('"widthPct":0.5');
    expect(bi).toContain('"pctAuto":"height"');
  });

  it('定義済みの数え方 (CSS Counter Styles 3 §6・§7) をリストの目印に使う', () => {
    const li = (type: string, start: number) => texts(`<ol style="list-style-type: ${type}" start="${start}"><li>x</li></ol>`).replace(/x$/, '');
    expect(li('japanese-informal', 11)).toBe('十一、');
    expect(li('japanese-formal', 6001)).toBe('六阡壱、');
    expect(li('hiragana', 1)).toBe('あ、');
    expect(li('lower-greek', 2)).toBe('β.');
    expect(li('simp-chinese-informal', 101)).toBe('一百零一、');
    expect(li('simp-chinese-informal', 12)).toBe('十二、');
    expect(li('trad-chinese-formal', 6001)).toBe('陸仟零壹、');
    // 定義の無い名前は decimal (§5)
    expect(li('foo-bar', 3)).toBe('3.');
  });
});

describe('HTML: 組版の指摘 (描く順・飾り線・揃え・字下げ・改ページ・段組・flex・ルビ・表・書字方向・縦中横)', () => {
  let E: Awaited<ReturnType<typeof makeEngine>>;
  beforeAll(async () => {
    E = await makeEngine();
  });
  const imp = (body: string, extraCss = '', html = '<html>') => {
    const d = new DOMParser().parseFromString(`${html}<head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const css = `@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt } p { margin: 0 } ${extraCss}`;
    return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css });
  };
  const flowJson = (body: string, css = '', html?: string) => JSON.stringify(imp(body, css, html).document.sequences[0].flow);
  /** 組んだページの領域 (ページの左上からの位置) */
  const areas = (body: string, css = '', html?: string) => {
    const out: Array<{ a: Area; x: number; y: number; page: number }> = [];
    const rec = (a: Area, ox: number, oy: number, page: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      out.push({ a, x, y, page });
      for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0), page);
    };
    E.engine.layout(imp(body, css, html).document).sheets.forEach((s, i) => rec(s.page, 0, 0, i));
    return out;
  };
  const glyphs = (body: string, css = '', html?: string) =>
    areas(body, css, html)
      .filter((g) => g.a.type === 'glyph')
      .map((g) => ({ ...g, text: (g.a as { text: string }).text }));

  it('回り込みは、後に続く流れの中のブロックの背景より手前、行の字より奥に描く (CSS 2.1 §9.5・§9.9.1)', async () => {
    const { paintSheet } = await import('../src/paint');
    const r = imp('<div style="float: left; width: 20pt; height: 20pt; background: #cccccc"></div><div style="background: #ffdddd">回り込みの横の字</div>');
    const calls: string[] = [];
    const painter = new Proxy({} as Record<string, unknown>, {
      get:
        (_t, k: string) =>
        (...args: unknown[]) => {
          if (k === 'fillRect') calls.push(`fill ${args[4]}`);
          else if (k === 'drawGlyph') calls.push('glyph');
          else if (k === 'transform') (args[1] as () => void)();
        },
    });
    paintSheet(E.engine.layout(r.document).sheets[0], painter as never);
    const pink = calls.indexOf('fill #ffdddd');
    const gray = calls.indexOf('fill #cccccc');
    expect(pink).toBeGreaterThanOrEqual(0);
    expect(gray).toBeGreaterThan(pink);
    expect(calls.indexOf('glyph')).toBeGreaterThan(gray);
  });

  it('飾り線の色は、線を指定した要素の text-decoration-color (既定はその要素の color)。子孫の字の色では変えない (Text Decoration 3 §2.3)', () => {
    const lineColors = (body: string) =>
      areas(body)
        .filter((g) => g.a.type === 'block' && g.a.backgroundColor && g.a.height < 2)
        .map((g) => g.a.backgroundColor);
    const a = lineColors('<p><span style="color: red; text-decoration: underline">aaa<span style="color: blue">bbb</span></span></p>');
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(new Set(a)).toEqual(new Set(['#ff0000']));
    const b = lineColors('<p><span style="color: red; text-decoration: underline green">aaa<span style="color: blue">bbb</span></span></p>');
    expect(new Set(b)).toEqual(new Set(['#008000']));
  });

  it('text-align-last の left・right も direction で読み替える (rtl の left は end。Text 3 §6.3)', () => {
    expect(flowJson('<div style="direction: rtl; text-align: justify; text-align-last: left">x</div>')).toContain('"textAlignLast":"end"');
    expect(flowJson('<div style="direction: rtl; text-align-last: right">x</div>')).toContain('"textAlignLast":"start"');
    expect(flowJson('<div style="text-align-last: left">x</div>')).toContain('"textAlignLast":"start"');
  });

  it('text-indent の each-line・hanging を読む: each-line は強制改行の後の行も、hanging は 1 行目以外を字下げする (Text 3 §8.1)', () => {
    const left = (body: string) => {
      const gs = glyphs(body);
      const ys = [...new Set(gs.map((g) => Math.round(g.y)))].sort((a, b) => a - b);
      return ys.map((y) => Math.min(...gs.filter((g) => Math.round(g.y) === y).map((g) => g.x)));
    };
    const x0 = (10 * 72) / 25.4;
    const each = left('<p style="text-indent: 2em each-line">一行目<br>強制改行の後の行</p>');
    expect(each.map((x) => x - x0)).toEqual([expect.closeTo(20, 1), expect.closeTo(20, 1)]);
    const plain = left('<p style="text-indent: 2em">一行目<br>強制改行の後の行</p>');
    expect(plain.map((x) => x - x0)).toEqual([expect.closeTo(20, 1), expect.closeTo(0, 1)]);
    const hang = left('<p style="text-indent: 2em hanging; width: 60pt">一二三四五六七八九十一二三四五六七八</p>');
    expect(hang.length).toBeGreaterThanOrEqual(2);
    expect(hang[0] - x0).toBeCloseTo(0, 1);
    for (const x of hang.slice(1)) expect(x - x0).toBeCloseTo(20, 1);
    // 計算値は長さと語 (§8.1 の Computed value)
    const d = new DOMParser().parseFromString('<html><body><p id="a" style="text-indent: 2em hanging each-line">x</p></body></html>', 'text/html') as unknown as Document;
    expect(cascadeStyles(d, '', { viewport: { width: 600, height: 800 } }).style(d.getElementById('a')!).getPropertyValue('text-indent')).toBe('32px hanging each-line');
  });

  it('text-spacing-trim: space-first は、行頭の始め括弧類を normal と同じく全角にする (Text 4 §8.5「Otherwise as normal」)', () => {
    // 「の次の字の、行の頭からの位置 (全角なら 1em = 10pt、半角に詰めれば 5pt)。2 つ目の「は、折り返した行の頭
    const x0 = (10 * 72) / 25.4;
    const opens = (v: string) => {
      const gs = glyphs(`<p style="text-spacing-trim: ${v}; width: 50pt">「あいう」「かきく」</p>`);
      return gs.flatMap((g, i) => (g.text === '「' ? [Math.round(gs[i + 1].x - x0)] : []));
    };
    expect(opens('space-first')).toEqual(opens('normal'));
    expect(opens('space-first')).toEqual([10, 10]);
    expect(opens('trim-start')).toEqual([5, 5]);
  });

  it('target-text() の first-letter は、::first-letter と同じく前後の約物を含む最初の字 (GCPM 3 §1.1.1.1・CSS Inline 3 §7.2)', () => {
    const all = glyphs('<p><a class="r" href="#t">x</a></p><h2 id="t">「あ」いう</h2>', 'a.r { content: target-text(attr(href url), first-letter) }')
      .map((g) => g.text)
      .join('');
    expect(all.startsWith('「あ」「あ」いう')).toBe(true);
  });

  it('ページが右から左へ進む文書 (vertical-rl) では、break-before の left・right の偶奇を入れ替える (recto・verso は変えない)', () => {
    const v = (val: string, html?: string) =>
      (JSON.parse(flowJson(`<p>a</p><p style="break-before: ${val}">b</p>`, '', html)).children as Array<{ breakBefore?: string }>).find((k) => k.breakBefore)?.breakBefore;
    expect([v('right'), v('left'), v('recto'), v('verso')]).toEqual(['odd-page', 'even-page', 'odd-page', 'even-page']);
    const rl = '<html style="writing-mode: vertical-rl">';
    expect([v('right', rl), v('left', rl), v('recto', rl), v('verso', rl)]).toEqual(['even-page', 'odd-page', 'odd-page', 'even-page']);
  });

  it('column-width から段の数を出す幅は、要素の内容の幅 (幅の指定が無ければ包含ブロックから。Multi-column 1 §3.4)', () => {
    const j = flowJson('<div style="width: 40mm"><div style="column-width: 15mm; column-gap: 2mm"><p>a</p><p>b</p></div></div>');
    expect(j).toMatch(/"columns":\{"count":2,/);
  });

  it('縦並び (column) の flex も、項目を order の順に並べる (Flexbox 1 §5.4)', () => {
    const t = glyphs('<div style="display: flex; flex-direction: column"><div style="order: 2">ORDER2</div><div style="order: 1">ORDER1</div></div>')
      .map((g) => g.text)
      .join('');
    expect(t).toBe('ORDER1ORDER2');
  });

  it('break-*: avoid-column は、段組の文脈の外では効かせない (Fragmentation 3 §3.1)', () => {
    expect(flowJson('<div style="break-inside: avoid-column">a</div>')).not.toContain('"keepTogether":true');
    expect(flowJson('<div style="break-inside: avoid">a</div>')).toContain('"keepTogether":true');
    expect(flowJson('<div style="column-count: 2"><div style="break-inside: avoid-column">a</div><p>b</p></div>')).toContain('"keepTogether":true');
    expect(flowJson('<div style="break-after: avoid-column">a</div>')).not.toContain('"keepWithNext":true');
  });

  it('rb を使うルビでも、rb の外に書いた字を親文字にする (CSS Ruby 1 §2.2・§2.3)。rt の字の色を当てる', () => {
    const rubies: Array<Record<string, unknown>> = [];
    JSON.stringify(
      imp('<p><ruby>漢<rb>字</rb><rt>かん</rt><rtc>じ</rtc></ruby></p><p><ruby><rb>A</rb><rb>B</rb><rt>a</rt><rt style="color: red">b</rt></ruby></p>').document.sequences[0].flow,
      (_k, v) => (v && v.type === 'ruby' && rubies.push(v), v),
    );
    expect(rubies[0]).toMatchObject({ baseText: '漢字', rubyText: 'かん', rubyTextUnder: 'じ' });
    expect(rubies.slice(1).map((r) => [r.baseText, r.rubyText, r.rubyColor])).toEqual([
      ['A', 'a', undefined],
      ['B', 'b', '#ff0000'],
    ]);
    const red = areas('<p><ruby>色<rt style="color: red">いろ</rt></ruby></p>').flatMap((g) => (g.a.type === 'ruby' ? g.a.ruby.map((r) => r.color) : []));
    expect(red).toEqual(['#ff0000', '#ff0000']);
  });

  it('同じ行に baseline のセルと baseline でないセルが混じっても、baseline のセルの中身は行の上端から同じ位置 (CSS 2.1 §17.5.3)', () => {
    const cellTop = (first: string) => {
      const as = areas(
        `<table style="border-collapse: collapse"><tr style="height: 15mm">${first}<td style="vertical-align: baseline"><span style="font-size: 20pt">大</span></td><td style="vertical-align: baseline">bl</td></tr></table>`,
      );
      const big = as.find((g) => g.a.type === 'glyph' && (g.a as { text: string }).text === '大')!;
      const cell = as.filter((g) => g.a.type === 'table-cell' && g.x <= big.x + 0.01 && g.x + g.a.width >= big.x).pop()!;
      const bl = as.find((g) => g.a.type === 'glyph' && (g.a as { text: string }).text === 'l')!;
      return { off: big.y - cell.y, base: big.y + (big.a as { baselineY: number }).baselineY - (bl.y + (bl.a as { baselineY: number }).baselineY) };
    };
    const only = cellTop('');
    for (const first of ['<td>既定</td>', '<td style="vertical-align: sub">sub</td>', '<td style="vertical-align: top">top</td>']) {
      const mixed = cellTop(first);
      expect(mixed.off).toBeCloseTo(only.off, 3);
      expect(mixed.base).toBeCloseTo(0, 3);
    }
  });

  it('writing-mode: sideways-rl は、vertical-rl として組み、字はすべて横倒しにする (Writing Modes 4 §3.2)', () => {
    const j = flowJson('<div style="writing-mode: sideways-rl">漢字 abc</div>');
    expect(j).toContain('"writingMode":"vertical-rl"');
    expect(j).toContain('"textOrientation":"sideways"');
  });

  it('text-combine-upright: all は、縮めすぎになっても横倒しに戻さず、1em に収める (Writing Modes 4 §9.1.3)', () => {
    const as = areas('<div style="writing-mode: vertical-rl"><p>あ<span style="text-combine-upright: all">ABCDE</span>い</p></div>');
    const t = as.find((g) => g.a.type === 'tate-chu-yoko');
    expect(t).toBeDefined();
    const tcy = t!.a as { glyphs: Array<{ text: string }>; scale: number };
    expect(tcy.glyphs.map((g) => g.text).join('')).toBe('ABCDE');
    expect(tcy.scale).toBeLessThan(0.5);
  });
});
