/**
 * 百分率の主軸の大きさ (width・flex-basis) の flex の項目: 基準は flex の容器の内容の幅なので、組むときの実際の容器の幅で解く (Flexbox 1 §7.2.3)。
 * 幅の決まらない所 (float など) の容器の中身の幅を測るときは、循環する百分率なので中身の幅として扱う (CSS Sizing 3 §5.2.1)。
 * 値は Chrome で組んだ結果と同じ (前は、読み込みのときの見積もり (本文の幅) で解いていたので、float が本文の幅の半分より広がった)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 項目 (表のセル) の幅 (pt。0.1 に丸める) */
const cells = async (body: string) => {
  const html = `<!DOCTYPE html><html><head><style>@page{size:300pt 400pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} div{margin:0}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out: number[] = [];
  const rec = (a: Area) => {
    if (a.type === 'table-cell') out.push(Math.round(a.width * 10) / 10);
    for (const c of childrenOf(a)) rec(c as Area);
  };
  rec(r.areaTree.sheets[0].page as unknown as Area);
  return out;
};

describe('百分率の主軸の大きさの flex の項目', () => {
  it('float の中の容器: 容器の幅は中身の幅で決め、width: 50% はその幅の半分 (中身ははみ出す)', async () => {
    const [a, b] = await cells('<div style="float:left"><div style="display:flex"><div style="width:50%">AAAAAAAAAA</div><div>BB</div></div></div>');
    expect(a).toBeCloseTo(42.8, 0);
    expect(b).toBeCloseTo(13.4, 0);
  });
  it('flex-basis: 50% は、自動の最小の大きさ (中身の最も狭い幅) より狭くならない', async () => {
    const [a] = await cells('<div style="float:left"><div style="display:flex"><div style="flex-basis:50%">AAAAAAAAAA</div><div>BB</div></div></div>');
    expect(a).toBeCloseTo(72.2, 0);
  });
  it('幅の決まった容器は、前のとおり容器の幅で解く', async () => {
    expect((await cells('<div style="display:flex;width:200pt"><div style="width:25%">X</div><div>Y</div></div>'))[0]).toBeCloseTo(50, 1);
  });
});
