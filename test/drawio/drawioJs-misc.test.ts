import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ShapeCanvas } from '../../src/drawio/drawioCanvas';
import { SHAPES_MISC, emojiText } from '../../src/drawio/drawioJs/misc';
import type { ShapeEnv } from '../../src/drawio/drawioShapes';
import { num, parseXml, type XEl } from '../../src/drawio/drawioXml';
import { parseSvg } from '../../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;

/** 試しの図形ライブラリの形 (24 × 24 の四角を塗る)。names に挙げた名前だけ引ける */
const square = parseXml('<shape w="24" h="24" aspect="variable"><background><rect x="0" y="0" w="24" h="24"/></background><foreground><fill/></foreground></shape>') as XEl;

/** 形を、スタイル (キー → 値) で描いて、書いた要素を返す (塗り #ffffff・線 #000000・太さ 1) */
function draw(name: string, w: number, h: number, style: Record<string, string> = {}, names: string[] = []): string[] {
  const lookup = (n: string) => (names.includes(n) ? square : undefined);
  const c = new ShapeCanvas(
    { fill: style.fillColor ?? '#ffffff', stroke: '#000000', strokeWidth: 1, dashed: false, dashPattern: '3 3', fixDash: false, fillAlpha: 1, strokeAlpha: 1 },
    { stencil: lookup, gradient: () => 'url(#g)', stencilCtx: { lookup, warn: () => {}, budget: { ops: 0 } }, style: {} },
  );
  const has = (k: string) => Object.hasOwn(style, k);
  const e: ShapeEnv = {
    str: (k, d) => (has(k) ? style[k] : d),
    num: (k, d) => num(style[k], d),
    color: (k, d) => (has(k) ? (style[k] === 'none' ? undefined : style[k]) : d === 'none' ? undefined : d),
    flag: (k, d = false) => (has(k) ? style[k] === '1' || style[k] === 'true' : d),
    fill: c.fillColor,
    stroke: c.strokeColor,
    strokeWidth: 1,
    rounded: style.rounded === '1',
    direction: 'east',
    value: '',
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontColor: '#000000',
  };
  SHAPES_MISC[name](c, w, h, e);
  return c.out;
}
const ds = (out: string[]) => out.map((s) => /d="([^"]*)"/.exec(s)?.[1]);
const readable = (out: string[]) =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${out.join('')}</svg>`, parse, { outline: () => ({ segs: [], advance: 0 }) });

describe('draw.io の絵文字・Atlassian・ネットワーク・IBM・フローチャート・SAP の形', () => {
  it('どの形も、描いたものが SVG として読める', () => {
    const styles: Record<string, Record<string, string>> = {
      'mxgraph.emoji': { emoji: 'grinning_face' },
      'mxgraph.ibm.box': { prType: 'cloud', strokeColor: '#ff0000' },
    };
    for (const name of Object.keys(SHAPES_MISC)) {
      const out = draw(name, 120, 80, styles[name], ['mxgraph.ibm.cloudtag', 'mxgraph.atlassian.task', 'mxgraph.atlassian.double']);
      expect(out.length, name).toBeGreaterThan(0);
      expect(readable(out), name).not.toBeNull();
    }
  });

  it('flowchart.document2: 上の角を半径 5 で丸め、下の縁を波に (size の既定 0.5)', () => {
    // dy = 40: 波の制御点は 80 - 40 × 1.4 = 24 と 80 + 40 × 0.4 = 96
    expect(ds(draw('mxgraph.flowchart.document2', 100, 80))).toEqual(['M95 0A5 5 0 0 1 100 5L100 60Q75 24 50 60Q25 96 0 60L0 20L0 5A5 5 0 0 1 5 0Z']);
    expect(ds(draw('mxgraph.flowchart.document2', 100, 80, { size: '0.25' }))[0]).toBe('M95 0A5 5 0 0 1 100 5L100 70Q75 52 50 70Q25 88 0 70L0 10L0 5A5 5 0 0 1 5 0Z');
  });

  it('networks.bus: 管と、右の端の白い口', () => {
    const out = draw('mxgraph.networks.bus', 200, 40);
    expect(ds(out)).toEqual(['M8 30A12 12 0 0 1 8 10L192 10A12 12 0 0 1 192 30Z', 'M192 10A12 12 0 0 1 192 30A12 12 0 0 1 192 10']);
    expect(out[1]).toContain('fill="#ffffff"');
  });

  it('ibm.box: 四角と、左上の札を線の色で (prType が無ければ札を描かない)', () => {
    const out = draw('mxgraph.ibm.box', 100, 60, { prType: 'cloud', strokeColor: '#ff0000' }, ['mxgraph.ibm.cloudtag']);
    expect(ds(out)[0]).toBe('M0 0L100 0L100 60L0 60Z');
    expect(out.length).toBe(2);
    expect(out[1]).toContain('#ff0000');
    expect(draw('mxgraph.ibm.box', 100, 60, {}, ['mxgraph.ibm.cloudtag']).length).toBe(1);
  });

  it('atlassian.issue: 四角と、右上の状態の札と文字', () => {
    const out = draw('mxgraph.atlassian.issue', 100, 60);
    expect(ds(out)).toEqual(['M0 0L100 0L100 60L0 60Z', 'M55 5L95 5L95 25L55 25Z', undefined]);
    expect(out[1]).toContain('fill="#FFFFFD"');
    expect(out[2]).toContain('>TO DO</text>');
    expect(out[2]).toContain('fill="#4E6B89"');
    // ほかの状態は名前を右寄せ (札の幅は 4 字 × 6.5 = 26)
    const other = draw('mxgraph.atlassian.issue', 100, 60, { issueStatus: 'open' });
    expect(ds(other)[1]).toBe('M69 5L95 5L95 25L69 25Z');
    expect(other[2]).toContain('text-anchor="end"');
  });

  it('emoji: 名前の字を、短い辺の大きさで書く。肌の色・髪の部品を足す', () => {
    const out = draw('mxgraph.emoji', 40, 40, { emoji: 'thumbs_up' });
    expect(out[1]).toContain('font-size="40"');
    expect(out[1]).toContain('>👍</text>');
    expect(emojiText('grinning_face')).toBe('😀');
    expect(emojiText('thumbs_up_medium_skin_tone')).toBe('👍\u{1F3FD}');
    // UTF-16 で 2 単位より長い字は、初めの 2 単位の後に肌の色を入れる
    expect(emojiText('man_raising_hand_dark_skin_tone')).toBe('🙋\u{1F3FF}‍♂️');
    expect(emojiText('no_such_emoji')).toBeUndefined();
    expect(draw('mxgraph.emoji', 40, 40, { emoji: 'no_such_emoji' }).length).toBe(1);
  });

  it('sap.icon: 円 (画像は描かない)', () => {
    expect(ds(draw('mxgraph.sap.icon', 100, 60))).toEqual(['M0 30A50 30 0 1 1 100 30A50 30 0 1 1 0 30Z']);
  });
});
