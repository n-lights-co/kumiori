import { describe, expect, it } from 'vitest';
import { lineBreakActions, verticalOrientation, type LineBreakOptions } from '../src/lineBreak';
import { isUprightInVertical, verticalTreatment } from '../src/jis';

/** 改行してよい位置に | を入れた文字列 (強制改行は !) */
const show = (s: string, o: LineBreakOptions = {}) => {
  const cps = Array.from(s, (c) => c.codePointAt(0)!);
  const act = lineBreakActions(cps, o);
  return Array.from(s)
    .map((c, i) => (i > 0 && act[i] === '÷' ? '|' : i > 0 && act[i] === '!' ? '!' : '') + c)
    .join('');
};

describe('改行の機会 (UAX #14)', () => {
  it('欧文の語・空白・数・括弧', () => {
    expect(show('a quick (brown) fox')).toBe('a |quick |(brown) |fox');
    expect(show('$(12.35) 2,1234 -1/12')).toBe('$(12.35) |2,1234 |-1/12');
    expect(show('e.g. http://x')).toBe('e.g. |http://|x');
    // 結合文字の前では分けない (LB9)
    expect(show('か\u3099き')).toBe('か\u3099|き');
  });
  it('和文: 禁則 (行頭に置けない字・行末に置けない字) と数と単位', () => {
    expect(show('漢字「かな」。ア')).toBe('漢|字|「か|な」。|ア');
    expect(show('公海が14％')).toBe('公|海|が|14％');
    expect(show('ちょっと')).toBe('ちょっ|と');
    expect(show('時々……ね')).toBe('時々……|ね');
  });
  it('line-break の調整 (CSS Text 3 §5.2)', () => {
    // strict・normal は小書き仮名の前で改行しない。loose は改行してよい
    expect(show('ちょっと', { strictness: 'loose' })).toBe('ち|ょ|っ|と');
    // 〜 の前は、日本語の normal・loose で改行してよい (strict は不可)
    expect(show('一〜二', { strictness: 'normal', cjk: true })).toBe('一|〜|二');
    expect(show('一〜二', { strictness: 'strict', cjk: true })).toBe('一〜|二');
    // loose は、中点類と全角の後置記号の前でも改行してよい
    expect(show('漢・字', { strictness: 'loose', cjk: true })).toBe('漢|・|字');
    // アンテナハウス互換 (axf:line-break="normal"): 小書き仮名・長音記号の前で改行してよい。繰返し記号は行頭禁則のまま
    expect(show('ちょ時々ー', { looseLineStart: true })).toBe('ち|ょ|時々|ー');
    // JLREQ §3.1.10: 数と全角の単位記号 (後置省略記号 cl-13) の間は改行しない
    expect(show('重さ12㎏', { strictness: 'normal', cjk: true })).toBe('重|さ|12㎏');
    // anywhere: 字ごと
    expect(show('abc', { strictness: 'anywhere' })).toBe('a|b|c');
  });
  it('強制改行', () => {
    expect(show('a\nb')).toBe('a\n!b');
  });
});

describe('縦書きの字の向き (UAX #50)', () => {
  it('Vertical_Orientation の値', () => {
    expect(['あ', 'A', '©', '→', 'ー', '、', '─'].map((c) => verticalOrientation(c.codePointAt(0)!))).toEqual(['U', 'R', 'U', 'R', 'Tr', 'Tu', 'R']);
  });
  it('正立・横倒し (Tr は縦書き用の字形があるものだけ正立)', () => {
    expect(['漢', '©', '→', '─', 'ｱ', '「', '〘', 'ー'].map((c) => isUprightInVertical(c))).toEqual([true, true, false, false, false, true, false, false]);
  });
  it('text-orientation: upright・sideways', () => {
    const has = () => true;
    expect(verticalTreatment('A', has, 'upright').mode).toBe('upright');
    expect(verticalTreatment('漢', has, 'sideways').mode).toBe('rotate');
    expect(verticalTreatment('A', has).mode).toBe('rotate');
  });
});

describe('改行の機会の調整 (全体のレビュー)', () => {
  it('loose: ID の後ろの ‐ (U+2010、HH) の前で改行してよい (CSS Text 3 §5.2)', () => {
    expect(show('漢‐字', { strictness: 'loose', cjk: true })).toBe('漢|‐|字');
  });
  it('loose: 全角の後置記号の前・前置記号の後ろだけで改行してよい (反対側は改行しない)', () => {
    expect(show('25°C', { strictness: 'loose', cjk: true })).toBe('25|°C');
  });
  it('anywhere: 書記素クラスタ (ZWJ の絵文字・国旗の字の組) の中では分けない', () => {
    expect(show('👨‍👩', { strictness: 'anywhere' })).toBe('👨‍👩');
    expect(show('🇯🇵🇯🇵', { strictness: 'anywhere' })).toBe('🇯🇵|🇯🇵');
  });
});
