/**
 * 字下げ (start-indent) の、表のセルの中・リストのラベルと本体の中への受け継ぎ (台帳の FO-19。BACKLOG の S-07)。
 * 自作の見本 samples/check/fo/indent-inheritance-1.fo の 10 のケースを組み、◆ の字の左端 (本文の領域の左端から測る) を確かめる。
 * - 仕様モード: XSL 1.1 どおり (§5.3.2・§7.11.7: 指定の無いブロックも外の start-indent を受け継ぐ。§6.7.10: セルは参照領域。
 *   §6.8.4・§6.8.5: リストのラベル・本体は参照領域ではない。§5.10.4: from-parent())。10 のケースすべて、見本の目印の A
 * - 互換モード (--compat antenna): 従来どおり (セルの中は受け継がない・リストの本体の中の長さは本体の始端から測る・from-parent() は読まない)。
 *   ただしケース 7 の、ラベルの幅が 0 になって字が縦に割れる壊れは、どちらのモードでも直す (ラベルが 1 行に収まる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';
import type { Area } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const MM = 72 / 25.4;
const xml = fs.readFileSync(path.resolve(import.meta.dirname, '../samples/check/fo/indent-inheritance-1.fo'), 'utf8');
const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;

/** 組んだ結果の、すべてのページの字 (ページの左上からの位置) */
function glyphs(compat: 'spec' | 'antenna') {
  const { document, report } = importXslFo(xml, parse, { compat });
  const tree = E.engine.layout(document);
  const out: Array<{ text: string; x: number; y: number; page: number }> = [];
  tree.sheets.forEach((sh, page) => {
    const rec = (a: Area, ox: number, oy: number) => {
      const x = ox + (a.x ?? 0);
      const y = oy + (a.y ?? 0);
      const b = a as unknown as { text?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      if (a.type === 'glyph') out.push({ text: b.text ?? '', x, y, page });
      for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
    };
    rec(sh.page as unknown as Area, 0, 0);
  });
  return { out, report };
}

const mm = (x: number) => Math.round((x / MM - 20) * 10) / 10;
/** ◆ の左端 (本文の領域の左端 = 用紙の左端から 20mm、から測った mm)。ケースの順 (説明の文の中の ◆ は除く: 「◆ここ」の ◆ だけ) */
const diamonds = (g: ReturnType<typeof glyphs>['out']) => g.flatMap((x, k) => (x.text === '◆' && g[k + 1]?.text === 'こ' ? [mm(x.x)] : []));
/** ラベル「(a)」の 3 字 (ケース 6・7 の中のリストのラベル) */
const labelsA = (g: ReturnType<typeof glyphs>['out']) => g.flatMap((x, k) => (x.text === '(' && g[k + 1]?.text === 'a' && g[k + 2]?.text === ')' ? [[x, g[k + 1], g[k + 2]]] : []));

describe('FO-19: 字下げの受け継ぎ (samples/check/fo/indent-inheritance-1.fo)', () => {
  it('仕様モード: 10 のケースすべてが仕様の読み方 (A) になる', () => {
    const { out, report } = glyphs('spec');
    // 1〜3: 表のセルの中は外の 20mm を受け継ぐ (40mm)。4: セルの中の明示 (25mm)。5: 本体 (30mm) の中のセル (60mm)。
    // 6: 入れ子のリスト (body-start()) の本体 40mm。7: 長さで書いた入れ子のリストの本体 45mm。8: 本体の中の start-indent="30mm" (30mm)。
    // 9: 本体の中の margin-left="5mm" (25mm)。10: from-parent(start-indent) + 5mm (25mm)
    expect(diamonds(out)).toEqual([40, 40, 40, 25, 60, 40, 45, 30, 25, 25]);
    // from-parent() を読むので、警告に出ない
    expect(JSON.stringify(report)).not.toContain('from-parent');
  });
  it('仕様モード: 中のリストのラベル (a) は、ケース 6 で 20mm、ケース 7 で 25mm から、1 行に組む', () => {
    const ls = labelsA(glyphs('spec').out);
    expect(ls.map((l) => mm(l[0].x))).toEqual([20, 25]);
    for (const l of ls) expect(new Set(l.map((g) => Math.round(g.y))).size).toBe(1);
  });
  it('互換モード: 結果は従来どおり (受け継がない読み方 B)', () => {
    const { out, report } = glyphs('antenna');
    expect(diamonds(out)).toEqual([20, 20, 20, 25, 30, 40, 65, 50, 25, 20]);
    expect(JSON.stringify(report)).toContain('from-parent');
  });
  it('互換モード: ケース 7 の中のラベル (a) は、幅が 0 にならず 1 行に組む (45mm から。字が縦に割れない)', () => {
    const ls = labelsA(glyphs('antenna').out);
    expect(ls.map((l) => mm(l[0].x))).toEqual([20, 45]);
    for (const l of ls) expect(new Set(l.map((g) => Math.round(g.y))).size).toBe(1);
  });
});
