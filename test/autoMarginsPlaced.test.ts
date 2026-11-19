/**
 * 左右 (縦書きの親では上下) の auto の余白を、組むときに置く場所の幅から配る箱:
 *  - 幅の指定のある表 (CSS 2.1 §10.3.3・§17.4)・HTML の align="center" の表
 *  - 絶対配置の箱 (left・right・width がどれも auto でない。§10.3.7)
 *  - HTML の <center>・align 属性 (-webkit-center など) の中の、幅の決まった箱 (HTML Living Standard §15.3.3)
 *  - 縦書きの親の中の箱 (余白は親の行の向き: margin-top・margin-bottom)、rtl の親の中の、置く場所より広い箱
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const PAGE = '@page { size: 400pt 400pt; margin: 0 } body { margin: 0 } p, div, td { font-size: 10pt; line-height: 12pt } td { padding: 0 } table { border-spacing: 0 }';
const RED = 'background: #ff0000';
const BLUE = 'background: #0000ff';

/** 背景の色が color の、最初の箱の [左端, 上端, 幅, 高さ] (pt。ページの左上から。丸める) */
function boxOf(body: string, color = '#ff0000'): number[] {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const tree = E.engine.layout(importHtml(d, cascadeStyles(d, PAGE, { viewport: { width: 600, height: 800 } }), { css: PAGE }).document);
  let found: number[] | undefined;
  const walk = (n: unknown, ox: number, oy: number) => {
    if (!n || typeof n !== 'object' || found) return;
    if (Array.isArray(n)) return n.forEach((c) => walk(c, ox, oy));
    const a = n as { x?: number; y?: number; width?: number; height?: number; backgroundColor?: string };
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    if (a.backgroundColor === color) return void (found = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round((a.width ?? 0) * 10) / 10, Math.round((a.height ?? 0) * 10) / 10]);
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') walk(v, x, y);
  };
  walk(tree.sheets[0], 0, 0);
  return found!;
}
const x = (body: string, color?: string) => boxOf(body, color)[0];
const LONG = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt';

describe('幅の指定のある表の auto の余白 (CSS 2.1 §10.3.3・§17.4)', () => {
  it('margin: 0 auto・align="center" の表は中央、margin-left だけ auto なら右、margin-right だけなら左', () => {
    const t = (s: string, attr = '') => x(`<div style="width: 300pt"><table ${attr} style="width: 100pt; ${s}; ${RED}"><tr><td>x</td></tr></table></div>`);
    expect(t('margin: 0 auto')).toBe(100);
    expect(t('', 'align="center"')).toBe(100);
    expect(t('margin-left: auto')).toBe(200);
    expect(t('margin-right: auto')).toBe(0);
    // 固定の配置・collapse・display: table の箱も同じ
    expect(t('margin: 0 auto; table-layout: fixed')).toBe(100);
    expect(x(`<div style="width: 300pt"><div style="display: table; width: 100pt; margin: 0 auto; ${RED}">x</div></div>`)).toBe(100);
    // collapse の表: 外枠の罫線の外へ出る半分を除いた箱を中央に置く (外へ出る半分は左右に同じだけ出る)
    const c = boxOf(`<div style="width: 300pt"><table style="width: 100pt; margin: 0 auto; border-collapse: collapse; border: 4pt solid; ${RED}"><tr><td style="border: 4pt solid">x</td></tr></table></div>`);
    expect(c[0] - (300 - (c[0] + c[2]))).toBeCloseTo(0, 1);
  });
  it('見出し (caption) は表といっしょに中央へ寄る', () => {
    const b = boxOf(`<div style="width: 300pt"><table style="width: 100pt; margin: 0 auto"><caption style="${RED}">cap</caption><tr><td>x</td></tr></table></div>`);
    expect(b[0]).toBe(100);
    expect(b[2]).toBe(100);
  });
  it('表のセルの中の、幅の指定のある表の margin: 0 auto: セルの中央 (ほかの列を縮めない)', () => {
    const r = boxOf(`<table style="width: 300pt"><tr><td style="width: 100pt"><table style="width: 40pt; margin: 0 auto; ${RED}"><tr><td>in</td></tr></table></td><td style="${BLUE}">${LONG}</td></tr></table>`);
    expect(r[0]).toBe(30);
    expect(x(`<table style="width: 300pt"><tr><td style="width: 100pt"><table style="width: 40pt; margin: 0 auto"><tr><td>in</td></tr></table></td><td style="${BLUE}">${LONG}</td></tr></table>`, '#0000ff')).toBe(100);
  });
  it('rtl の親より広い margin: 0 auto の箱・表は、左へはみ出す (margin-left が残りを取る)', () => {
    expect(x(`<div style="width: 200pt; margin-left: 100pt; direction: rtl"><div style="width: 300pt; margin: 0 auto; ${RED}">x</div></div>`)).toBe(0);
    expect(x(`<div style="width: 200pt; margin-left: 100pt; direction: rtl"><table style="width: 300pt; margin: 0 auto; ${RED}"><tr><td>x</td></tr></table></div>`)).toBe(0);
    // ltr では右へはみ出す (左から置く)
    expect(x(`<div style="width: 200pt; margin-left: 100pt"><div style="width: 300pt; margin: 0 auto; ${RED}">x</div></div>`)).toBe(100);
  });
});

describe('auto の余白の配り方の表 (CSS 2.1 §10.3.3。ltr・rtl × 両方・左だけ・右だけ × 残りが正・負)', () => {
  // 置く場所 300pt、箱の幅 100pt (残りが正) か 400pt (残りが負)。auto でない側の余白は 10pt。値は置く場所の左端からの箱の左端
  //  - 残りが正: auto の余白が残りを取る (両方 auto なら等分)。direction によらない
  //  - 残りが負: §10.3.3 の最初の決まりで、auto の余白は (いくつあっても) 0 として扱い、制約が余る。ltr は margin-right を、
  //    rtl は margin-left を、式が合うように決め直す (rtl では箱の右端が、margin-right の内側に付き、左へはみ出す)
  const cases: [string, string, number, number][] = [
    // [余白, direction, 残りが正, 残りが負]
    ['margin: 0 auto', 'ltr', 100, 0],
    ['margin-left: auto; margin-right: 10pt', 'ltr', 190, 0],
    ['margin-left: 10pt; margin-right: auto', 'ltr', 10, 10],
    ['margin: 0 auto', 'rtl', 100, -100],
    ['margin-left: auto; margin-right: 10pt', 'rtl', 190, -110],
    ['margin-left: 10pt; margin-right: auto', 'rtl', 10, -100],
  ];
  for (const [m, dir, pos, neg] of cases)
    it(`${dir}: ${m}`, () => {
      for (const [w, want] of [[100, pos], [400, neg]] as const) {
        const blk = x(`<div style="width: 300pt; margin-left: 100pt; direction: ${dir}"><div style="width: ${w}pt; ${m}; ${RED}">x</div></div>`) - 100;
        const tbl = x(`<div style="width: 300pt; margin-left: 100pt; direction: ${dir}"><table style="width: ${w}pt; ${m}; ${RED}"><tr><td>x</td></tr></table></div>`) - 100;
        expect([w, blk, tbl]).toEqual([w, want, want]);
      }
    });
  // HTML の align 属性 (-webkit-left・-webkit-right・-webkit-center) の中の、余白の指定の無い箱: 残りが正なら、属性の向きへ寄せる
  // (HTML Living Standard §15.3.3 の「align descendants」)。寄せるのは、余白が大きい値に強いられる (残りが正の) 箱だけなので、
  // 置く場所より広い箱は寄せず、ふつうの制約の余る箱と同じ (ltr は左から、rtl は右から置く)
  const aligned: [string, string, number, number][] = [
    ['left', 'ltr', 0, 0],
    ['center', 'ltr', 100, 0],
    ['right', 'ltr', 200, 0],
    ['left', 'rtl', 0, -100],
    ['center', 'rtl', 100, -100],
    ['right', 'rtl', 200, -100],
  ];
  for (const [al, dir, pos, neg] of aligned)
    it(`${dir}: align="${al}"`, () => {
      for (const [w, want] of [[100, pos], [400, neg]] as const) {
        const blk = x(`<div style="width: 300pt; margin-left: 100pt; direction: ${dir}"><div align="${al}"><div style="width: ${w}pt; ${RED}">x</div></div></div>`) - 100;
        const tbl = x(`<div style="width: 300pt; margin-left: 100pt; direction: ${dir}"><div align="${al}"><table style="width: ${w}pt; ${RED}"><tr><td>x</td></tr></table></div></div>`) - 100;
        expect([w, blk, tbl]).toEqual([w, want, want]);
      }
    });
});

describe('絶対配置の箱の auto の余白 (CSS 2.1 §10.3.7)', () => {
  const cb = (inner: string, s = '') => `<div style="position: relative; width: 300pt; height: 100pt; ${s}">${inner}</div>`;
  it('left・right・width が決まっていれば、残りを auto の余白に配る', () => {
    expect(x(cb(`<div style="position: absolute; left: 0; right: 0; width: 100pt; margin: 0 auto; ${RED}">a</div>`))).toBe(100);
    expect(x(cb(`<div style="position: absolute; left: 20pt; right: 40pt; width: 100pt; margin: 0 auto; ${RED}">a</div>`))).toBe(90);
    expect(x(cb(`<div style="position: absolute; left: 0; right: 0; width: 100pt; margin-left: auto; ${RED}">a</div>`))).toBe(200);
    expect(x(cb(`<div style="position: absolute; left: 0; right: 0; width: 100pt; margin-right: auto; ${RED}">a</div>`))).toBe(0);
    // 本文の領域が基準の箱・position: fixed も
    expect(x(`<div style="position: absolute; left: 0; right: 0; width: 100pt; margin: 0 auto; ${RED}">a</div>`)).toBe(150);
    expect(x(`<div style="position: fixed; left: 0; right: 0; width: 100pt; margin: 0 auto; ${RED}">a</div>`)).toBe(150);
  });
  it('残りが負なら、ltr は margin-left を 0 に、rtl は margin-right を 0 にする', () => {
    expect(x(cb(`<div style="position: absolute; left: 0; right: 0; width: 400pt; margin: 0 auto; ${RED}">a</div>`))).toBe(0);
    expect(x(cb(`<div style="position: absolute; left: 0; right: 0; width: 400pt; margin: 0 auto; ${RED}">a</div>`, 'direction: rtl'))).toBe(-100);
  });
  it('<center>・align の中の、left・right が auto の箱は、寄せた static position に置く (§10.3.7・HTML Living Standard §15.3.3)', () => {
    // static position は、ふつうの流れに置いたとしたときの位置。center・align は流れの中の子孫のブロックを寄せるので、寄せた位置
    const abs = `<div style="position: absolute; top: 0; width: 100pt; ${RED}">a</div>`;
    expect(x(`<div style="width: 300pt"><center style="position: relative">${abs}</center></div>`)).toBe(100);
    expect(x(`<div style="width: 300pt; position: relative"><center>${abs}</center></div>`)).toBe(100);
    expect(x(`<div style="width: 300pt; position: relative"><div align="center">${abs}</div></div>`)).toBe(100);
    expect(x(`<div style="width: 300pt; position: relative"><div align="right">${abs}</div></div>`)).toBe(200);
    expect(x(`<div style="width: 300pt; position: relative"><div align="left">${abs}</div></div>`)).toBe(0);
    // left か right を書いた箱は、その値で置く
    expect(x(`<div style="width: 300pt"><center style="position: relative"><div style="position: absolute; left: 10pt; width: 100pt; ${RED}">a</div></center></div>`)).toBe(10);
    expect(x(`<div style="width: 300pt"><center style="position: relative"><div style="position: absolute; right: 0; width: 100pt; ${RED}">a</div></center></div>`)).toBe(200);
    // 寄せない親 (text-align: center は行の中身だけを寄せる) の中は、左端
    expect(x(`<div style="width: 300pt; position: relative; text-align: center">${abs}</div>`)).toBe(0);
  });
  it('left か right が auto なら、auto の余白は 0', () => {
    expect(x(cb(`<div style="position: absolute; right: 0; width: 100pt; margin: 0 auto; ${RED}">a</div>`))).toBe(200);
    expect(x(cb(`<div style="position: absolute; left: 10pt; width: 100pt; margin: 0 auto; ${RED}">a</div>`))).toBe(10);
  });
});

describe('HTML の center・align の中の、幅の決まった箱 (HTML Living Standard §15.3.3)', () => {
  it('セルの中の <center>・align="center" の箱: 列の幅は箱の幅で、ほかの列を最小の幅まで縮めない', () => {
    for (const inner of [`<center><div style="width: 100pt; ${RED}">box</div></center>`, `<div align="center"><div style="width: 100pt; ${RED}">box</div></div>`]) {
      const blue = boxOf(`<table style="width: 300pt"><tr><td>${inner}</td><td style="${BLUE}">${LONG}</td></tr></table>`, '#0000ff');
      expect(blue[0]).toBe(100);
    }
    const td = boxOf(`<table style="width: 300pt"><tr><td align="center"><div style="width: 100pt; ${RED}">box</div></td><td style="${BLUE}">${LONG}</td></tr></table>`, '#0000ff');
    expect(td[0]).toBe(100);
    // セルが箱より広ければ、セルの中で寄せる
    expect(x(`<table style="width: 300pt"><tr><td align="center" style="width: 100pt"><div style="width: 40pt; ${RED}">box</div></td><td>${LONG}</td></tr></table>`)).toBe(30);
    expect(x(`<table style="width: 300pt"><tr><td align="right" style="width: 100pt"><div style="width: 40pt; ${RED}">box</div></td><td>${LONG}</td></tr></table>`)).toBe(60);
  });
  it('セルの中の align="center" の表は、セルの外へ出ない (列の幅は表の幅)', () => {
    const html = `<table style="width: 300pt"><tr><td align="center"><table style="width: 40pt; ${RED}"><tr><td>in</td></tr></table></td><td style="${BLUE}">${LONG}</td></tr></table>`;
    const r = boxOf(html);
    const b = boxOf(html, '#0000ff');
    expect(r[0]).toBeGreaterThanOrEqual(0);
    expect(r[0] + r[2]).toBeLessThanOrEqual(b[0] + 0.5);
    expect(b[0]).toBeLessThan(45);
  });
  it('flex の項目・inline-block の中の <center> の箱は、その中で寄せる (見積もりの幅で外へ出さない)', () => {
    expect(x(`<div style="display: flex"><div style="width: 100pt"><center><div style="width: 30pt; ${RED}">c</div></center></div><div>b</div></div>`)).toBe(35);
    expect(x(`<div style="display: flex"><div style="width: 100pt"><div align="center"><div style="width: 30pt; ${RED}">c</div></div></div><div>b</div></div>`)).toBe(35);
    // inline-block の幅は、中の箱の幅より広げない (見積もりの余白を中身の幅に入れない)
    expect(boxOf(`<div style="display: inline-block; ${BLUE}"><center><div style="width: 30pt; ${RED}">c</div></center></div>`, '#0000ff')[2]).toBeLessThan(40);
  });
  it('rtl の親の中の align="left" の箱は、左へ寄せる', () => {
    expect(x(`<div style="width: 300pt" dir="rtl"><div align="left"><div style="width: 100pt; ${RED}">box</div></div></div>`)).toBe(0);
    expect(x(`<div style="width: 300pt" dir="rtl"><div align="center"><div style="width: 100pt; ${RED}">box</div></div></div>`)).toBe(100);
  });
});

describe('縦書きの親の中の auto の余白 (CSS 2.1 §10.3.3 を、親の行の向きに読む)', () => {
  const v = (inner: string) => boxOf(`<div style="writing-mode: vertical-rl; height: 300pt">${inner}</div>`);
  it('margin-top・margin-bottom が auto の箱は上下の中央、margin-left・right の auto は効かない (block の向きは 0)', () => {
    expect(v(`<div style="height: 100pt; width: 30pt; margin: auto 0; ${RED}">縦</div>`)[1]).toBe(100);
    expect(v(`<div style="height: 100pt; width: 30pt; margin: 0 auto; ${RED}">縦</div>`)[1]).toBe(0);
    expect(v(`<div style="height: 100pt; width: 30pt; margin-top: auto; ${RED}">縦</div>`)[1]).toBe(200);
  });
});
