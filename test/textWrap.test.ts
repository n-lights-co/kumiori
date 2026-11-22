/**
 * 行の並べ方の選び方 (CSS Text 4 §5.4 の text-wrap-style) と、折り返すか (§5.1 の text-wrap-mode)、その一括指定 text-wrap (§5.5)。
 * 節の番号は W3C Working Draft 2026-08-14 のもの。
 *  - balance: 行の数を変えずに、行の長さをそろえる (強制改行で区切った組ごと。10 行を超える組は auto のまま)
 *  - pretty・avoid-short-last-line: 最後の行が短すぎれば、終わりの数行を切り直す
 *  - auto・stable: 1 行ずつ先から決める (今までの組み方)
 * 書いていない文書の行分けは変えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCss } from '../src/htmlPaged';
import { unsupportedCssReport } from '../src/cssUnsupported';
import { expand } from '../src/cssCascade';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, fontDir, walk } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Area Tree の行ごとの字 */
const linesOf = (tree: AreaTree): string[] => {
  const out: string[] = [];
  for (const sheet of tree.sheets)
    walk(sheet.page.regionBody as Area, (a) => {
      if (a.type !== 'line') return;
      let s = '';
      walk(a, (g) => {
        if (g.type === 'glyph') s += (g as unknown as { text: string }).text;
      });
      out.push(s);
    });
  return out;
};

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

/** 幅 width の p に style を付けて組んだ行 (字は 10pt。205pt は和字 20 字) */
const run = async (style: string, body: string, width = '205pt', lang = 'ja') => {
  const html = `<!DOCTYPE html><html lang="${lang}"><head><title>t</title><style>@page { size: 400pt 600pt; margin: 20pt } body { margin: 0; font-size: 10pt } p { margin: 0; text-indent: 0; width: ${width}; ${style} }</style></head><body><p>${body}</p></body></html>`;
  const r = await typesetHtml(html, { name: 't.html', loadFont });
  return { lines: linesOf(r.areaTree), warnings: r.warnings };
};

// 20 字の行に 23 字: 1 行目 20 字・2 行目 3 字 (句読点の追込み・ぶら下げの無い字だけ)
const JA = 'あいうえおかきくけこさしすせそたちつてとなにぬ';

describe('text-wrap-style: balance', () => {
  it('行の数を変えずに、行の長さをそろえる (2 行なら半分ずつ)', async () => {
    const auto = await run('', JA);
    expect(auto.lines.map((l) => l.length)).toEqual([20, 3]);
    const bal = await run('text-wrap-style: balance', JA);
    expect(bal.lines.join('')).toBe(JA);
    expect(bal.lines.length).toBe(2);
    expect(Math.abs(bal.lines[0].length - bal.lines[1].length)).toBeLessThanOrEqual(1);
    expect(bal.warnings.join('\n')).not.toMatch(/text-wrap/);
  });

  it('一括指定 text-wrap: balance も同じ。stable・auto は今までどおり', async () => {
    expect((await run('text-wrap: balance', JA)).lines).toEqual((await run('text-wrap-style: balance', JA)).lines);
    const auto = (await run('', JA)).lines;
    expect((await run('text-wrap-style: stable', JA)).lines).toEqual(auto);
    expect((await run('text-wrap: auto', JA)).lines).toEqual(auto);
  });

  it('強制改行で区切った組ごとに、そろえる (§5.4)', async () => {
    const r = await run('text-wrap: balance', `あいう<br>${JA}`);
    expect(r.lines[0]).toBe('あいう');
    expect(r.lines.slice(1).join('')).toBe(JA);
    expect(Math.abs(r.lines[1].length - r.lines[2].length)).toBeLessThanOrEqual(1);
  });

  it('行頭禁則・行末禁則は守る (句読点を行頭に置かない)', async () => {
    const text = 'あいうえおかきくけ、こさしすせそたちつてと。なにぬ';
    const r = await run('text-wrap: balance', text);
    expect(r.lines.length).toBe(2);
    for (const l of r.lines.slice(1)) expect(l).not.toMatch(/^[、。]/);
  });

  it('10 行を超える組は、auto のまま (§5.4: “more than ten lines”)', async () => {
    const long = JA.repeat(10);
    expect((await run('text-wrap: balance', long)).lines).toEqual((await run('', long)).lines);
  });

  it('欧文の見出しも、語の間で分けて行の長さをそろえる', async () => {
    const t = 'A somewhat longer English heading for testing balanced wrapping';
    const auto = (await run('', t, '205pt', 'en')).lines;
    const bal = (await run('text-wrap: balance', t, '205pt', 'en')).lines;
    expect(bal.length).toBe(auto.length);
    const spread = (ls: string[]) => Math.max(...ls.map((l) => l.length)) - Math.min(...ls.map((l) => l.length));
    expect(spread(bal)).toBeLessThan(spread(auto));
  });
});

describe('text-wrap-style: pretty', () => {
  it('最後の行が短すぎれば、終わりの行を切り直して最後の行を長くする (行の数は変えない)', async () => {
    const text = JA.repeat(2).slice(0, 42); // 20・20・2
    const auto = (await run('', text)).lines;
    expect(auto.map((l) => l.length)).toEqual([20, 20, 2]);
    const pretty = (await run('text-wrap-style: pretty', text)).lines;
    expect(pretty.length).toBe(3);
    expect(pretty.join('')).toBe(text);
    expect(pretty[2].length).toBeGreaterThanOrEqual(5);
    // avoid-short-last-line も同じ扱い
    expect((await run('text-wrap-style: avoid-short-last-line', text)).lines).toEqual(pretty);
  });

  it('最後の行が短すぎなければ、変えない', async () => {
    const text = JA.repeat(2).slice(0, 30); // 20・10
    expect((await run('text-wrap: pretty', text)).lines).toEqual((await run('', text)).lines);
  });

  it('段落全体で行を分け、行末の空きのそろいを良くする (等幅の欧文: 最後の行を除く行の空きの 3 乗の和が、1 行ずつの組み方より小さい)', async () => {
    const words = 'a bb ccc dddd eeeee ffffff ggggggg hhhhhhhh'.split(' ');
    // 決まった並びの語 (長さ 1〜8 字) の段落
    const text = Array.from({ length: 60 }, (_, i) => words[(i * 5 + (i >> 2)) % words.length]).join(' ');
    const style = 'font-family: monospace; text-align: start';
    const auto = (await run(style, text, '205pt', 'en')).lines;
    const pretty = (await run(`${style}; text-wrap: pretty`, text, '205pt', 'en')).lines;
    expect(pretty.join(' ').replace(/\s+/g, ' ')).toBe(auto.join(' ').replace(/\s+/g, ' '));
    expect(pretty).not.toEqual(auto);
    // 行の長さ (字の数) は、行に入る最も長い行の字の数に対する空きで比べる
    const W = Math.max(...auto.map((l) => l.trimEnd().length), ...pretty.map((l) => l.trimEnd().length));
    const ragged = (ls: string[]) => ls.slice(0, -1).reduce((t, l) => t + (W - l.trimEnd().length) ** 3, 0);
    expect(ragged(pretty)).toBeLessThan(ragged(auto));
  });

  it('段落全体で分けても、行頭禁則・行末禁則を守る', async () => {
    const text = '「あいうえお」、かきくけこ。さしすせそ（たちつてと）、なにぬねの。はひふへほ「まみむめも」、やゆよ。らりるれろ、わをん。'.repeat(3);
    const r = await run('text-wrap: pretty; text-align: justify', text);
    expect(r.lines.join('')).toBe(text);
    for (const l of r.lines.slice(1)) expect(l).not.toMatch(/^[、。」）]/);
    for (const l of r.lines.slice(0, -1)) expect(l).not.toMatch(/[「（]$/);
  });

  it('行の多い段落 (100 行を超える) は、終わりの数行だけを切り直す', async () => {
    const text = JA.repeat(101).slice(0, 20 * 101 + 2); // 20 字の行が 101 行と、2 字
    const auto = (await run('', text)).lines;
    expect(auto.length).toBe(102);
    const pretty = (await run('text-wrap: pretty', text)).lines;
    expect(pretty.length).toBe(102);
    expect(pretty.slice(0, 98)).toEqual(auto.slice(0, 98));
    expect(pretty[101].length).toBeGreaterThanOrEqual(5);
  });

  it('行の多い段落の切り直しで、試す行の長さの数に上限を置く (字の大きさに比べてとても長い行で、手間が行の長さの 2 乗にならない)', async () => {
    // 幅 8000pt の行に 1pt の字: 「1 行 + 1 字」の組と、強制改行の 101 行 (前は 8000 回切り直して 15 秒かかった)
    const W = 8000;
    const html = `<!DOCTYPE html><html lang="ja"><head><style>@page { size: ${W + 100}pt 2000pt; margin: 20pt } p { font-size: 1pt; line-height: 1.2; width: ${W}pt; text-wrap: pretty; margin: 0 }</style></head><body><p>${'あ'.repeat(W + 1)}<br>${'い<br>'.repeat(101)}</p></body></html>`;
    const t0 = Date.now();
    const r = await typesetHtml(html, { loadFont });
    expect(Date.now() - t0).toBeLessThan(8000);
    // 最後の行が短くならないように切り直す (1/4 以上)
    const lines = linesOf(r.areaTree);
    expect(lines[0].length + lines[1].length).toBe(W + 1);
    expect(lines[1].length).toBeGreaterThanOrEqual(W / 4);
  }, 60_000);
});

describe('切り直した行のぶら下げ (長さ L より短く切った行を、長さ L に置く)', () => {
  /** 行ごとの、字の並びと、行の中の字の右端 (行の始めから)・行の長さ */
  const lineBoxes = (tree: AreaTree) => {
    const out: Array<{ text: string; end: number; width: number }> = [];
    for (const sheet of tree.sheets)
      walk(sheet.page.regionBody as Area, (a) => {
        if (a.type !== 'line') return;
        let text = '';
        let end = 0;
        const rec = (b: Area, ox: number) => {
          const x = ox + b.x;
          if (b.type === 'glyph') {
            text += (b as unknown as { text: string }).text;
            end = Math.max(end, x + b.width);
          }
          for (const c of (b as unknown as { children?: Area[] }).children ?? []) rec(c, x);
        };
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) rec(c, 0);
        out.push({ text, end, width: a.width });
      });
    return out;
  };
  const runBoxes = async (style: string, body: string, lang = 'ja') => {
    const html = `<!DOCTYPE html><html lang="${lang}"><head><title>t</title><style>@page { size: 400pt 2000pt; margin: 20pt } body { margin: 0; font-size: 10pt } p { margin: 0; text-indent: 0; width: 200pt; text-align: justify; ${style} }</style></head><body><p>${body}</p></body></html>`;
    return lineBoxes((await typesetHtml(html, { name: 't.html', loadFont })).areaTree);
  };

  it('balance: 最後の行は両端を揃えず、行末の句読点を箱の外へ出さない (和文・欧文。横書き)', async () => {
    const ja = await runBoxes('text-wrap: balance', '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。');
    expect(ja.map((l) => l.text)).toEqual(['吾輩は猫である。名前はまだ無い。', 'どこで生れたかとんと見当がつかぬ。']);
    for (const l of ja) expect(l.end).toBeLessThanOrEqual(l.width + 0.01);
    // 最後の行は字の自然な長さ (17 字) のまま
    expect(ja[1].end).toBeCloseTo(170, 0);
    const en = await runBoxes('text-wrap: balance', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.', 'en');
    expect(en.length).toBe(2);
    for (const l of en) expect(l.end).toBeLessThanOrEqual(l.width + 0.01);
    expect(en[1].end).toBeLessThan(en[1].width - 10);
  });

  it('pretty: 字間を空けて追い出したうえで、句読点をぶら下げる行を選ばない (ぶら下げた行は、1 行ずつの組み方より増えない)', async () => {
    // 読点の多い和文の段落 (1 行 20 字)。前は、短く切ってぶら下げた行 (句読点のほかに 19 字以下) を、1 行ずつの組み方より多く選んだ
    const text =
      'たこてよすな、たむめそれきれ、あまそへ、そくえすらよす、しへらちろあきるらんり、ねにこ、うられせあなひ、とおせうみやまおひきはろ。' +
      'れさはを、ろとひえとゆぬ、ねれす、あふさふくか、さけあえやこれはかゆ、こぬてさめ。';
    const auto = await runBoxes('', text);
    const pretty = await runBoxes('text-wrap: pretty', text);
    expect(pretty.map((l) => l.text).join('')).toBe(text);
    const stretchedHung = (ls: typeof auto) => ls.filter((l) => l.end > l.width + 0.01 && [...l.text].length < 21).length;
    expect(stretchedHung(pretty)).toBeLessThanOrEqual(stretchedHung(auto));
    expect(pretty.filter((l) => l.end > l.width + 0.01).length).toBeLessThanOrEqual(auto.filter((l) => l.end > l.width + 0.01).length);
  });

  it('pretty: 段落の行の数は、1 行ずつの組み方より増やさない (追込みを避けて行を足さない)', async () => {
    // 読点の多い和文の段落。前は、追込みの行を避けて、1 行ずつの組み方 (5 行) より 1 行多い 6 行に分けた
    const text =
      'ゆちきれみふみすもなあぬかれ、たかけいいはこてねしるめわ。とりなのしれぬなそねけやねちた、ゆるんは、ふみさとらよるかこを。' +
      'へるはかう、せねあうりむ、おろえむんひに、ろしさ、へゆわ、かもなめほふもるこは、';
    const auto = await runBoxes('text-indent: 1em', text);
    const pretty = await runBoxes('text-indent: 1em; text-wrap: pretty', text);
    expect(auto.length).toBe(5);
    expect(pretty.length).toBeLessThanOrEqual(auto.length);
    expect(pretty.map((l) => l.text).join('')).toBe(text);
  });

  it('pretty: 100 行の段落も、段落全体で行を分ける (最後の行を短くしない)', async () => {
    const text = JA.repeat(100).slice(0, 20 * 99 + 2); // 20 字の行が 99 行と、2 字
    expect((await run('', text)).lines.length).toBe(100);
    const pretty = (await run('text-wrap: pretty', text)).lines;
    expect(pretty.length).toBe(100);
    expect(pretty.join('')).toBe(text);
    expect(pretty[99].length).toBeGreaterThanOrEqual(5);
  });
});

describe('text-wrap-mode と、一括指定の text-wrap・white-space', () => {
  it('text-wrap-mode: nowrap・text-wrap: nowrap は折り返さない。white-space: normal で戻る', async () => {
    expect((await run('text-wrap-mode: nowrap', JA)).lines).toEqual([JA]);
    expect((await run('text-wrap: nowrap', JA)).lines).toEqual([JA]);
    expect((await run('text-wrap: nowrap; white-space: normal', JA)).lines.length).toBe(2);
    expect((await run('white-space: nowrap; text-wrap-mode: wrap', JA)).lines.length).toBe(2);
  });

  it('一括指定の分け方 (§3・§5.5)', () => {
    expect(expand('text-wrap', 'balance')).toEqual([['text-wrap-mode', 'wrap'], ['text-wrap-style', 'balance']]);
    expect(expand('text-wrap', 'nowrap')).toEqual([['text-wrap-mode', 'nowrap'], ['text-wrap-style', 'auto']]);
    expect(expand('text-wrap', 'pretty nowrap')).toEqual([['text-wrap-mode', 'nowrap'], ['text-wrap-style', 'pretty']]);
    expect(expand('text-wrap', 'balance pretty')).toEqual([]);
    expect(expand('text-wrap', 'foo')).toEqual([]);
    // white-space は text-wrap-mode も決め、text-wrap-style は戻さない
    expect(expand('white-space', 'pre')).toEqual([['white-space', 'pre'], ['text-wrap-mode', 'nowrap']]);
    expect(expand('white-space', 'pre-wrap')).toEqual([['white-space', 'pre-wrap'], ['text-wrap-mode', 'wrap']]);
  });

  it('未対応の警告に出さない', () => {
    const rep = unsupportedCssReport(parseCss('p { text-wrap: balance; text-wrap-style: pretty; text-wrap-mode: nowrap }'));
    expect(rep.unsupported).toEqual({});
  });

  it('一括指定の読めない値は、知らないプロパティに数えず、ほかの性質の読めない値と同じく黙って捨てる', () => {
    // 前は、値を分けられない一括指定 (text-wrap・text-decoration・font) が「知らない CSS のプロパティ」の警告になっていた
    const rep = unsupportedCssReport(parseCss('p { text-wrap: bogus; text-wrap: pretty pretty; text-decoration: bogus; font: bogus; display: foo; colr: red }'));
    expect(rep.unknown).toEqual({ colr: 1 });
    expect(rep.unsupported).toEqual({});
  });
});

describe('ページの余白の箱 (@page の @top-center など) の折り返し', () => {
  /** 余白の箱 (幅 100pt) に box の宣言を付けて組んだ、本文の外の行 */
  const header = async (box: string, page = '') => {
    const text = 'A long running header text that would wrap in a narrow margin box okay friends here';
    const html = `<!DOCTYPE html><html lang="en"><head><title>t</title><style>@page { size: 400pt 600pt; margin: 60pt; ${page} @top-center { content: "${text}"; width: 100pt; ${box} } } body { margin: 0; font-size: 10pt }</style></head><body><p>x</p></body></html>`;
    const r = await typesetHtml(html, { name: 't.html', loadFont });
    // 柱の行 (本文の行・ほかの余白の箱の行は数えない)
    let n = 0;
    walk(r.areaTree.sheets[0].page as unknown as Area, (a) => {
      if (a.type !== 'line') return;
      let s = '';
      walk(a, (g) => {
        if (g.type === 'glyph') s += (g as unknown as { text: string }).text;
      });
      if (/[A-Za-z]{2}/.test(s)) n++;
    });
    return n;
  };

  it('white-space: nowrap・pre、text-wrap: nowrap、text-wrap-mode: nowrap は折り返さない (CSS Text 4 §3・§5.1・§5.5)', async () => {
    expect(await header('')).toBeGreaterThan(1);
    expect(await header('white-space: nowrap')).toBe(1);
    expect(await header('white-space: pre')).toBe(1);
    expect(await header('text-wrap: nowrap')).toBe(1);
    expect(await header('text-wrap-mode: nowrap')).toBe(1);
    // 後に書いた宣言が勝つ
    expect(await header('white-space: nowrap; text-wrap-mode: wrap')).toBeGreaterThan(1);
    expect(await header('text-wrap: nowrap; white-space: normal')).toBeGreaterThan(1);
    // ページ文脈 (@page) の宣言も受け継ぐ
    expect(await header('', 'white-space: nowrap;')).toBe(1);
  });
});
