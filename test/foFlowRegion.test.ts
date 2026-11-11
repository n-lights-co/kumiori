/**
 * fo:flow を、flow-name の合う領域へ流す (台帳の FO-25 の (3))。
 * XSL 1.1 §6.4.1.4 Flows and Flow Mapping (flow-map-reference の無い page-sequence は、flow-name と同じ region-name の領域へ流す。
 * region-body の既定の名前は xsl-region-body)・§7.27.5 flow-name (名前が空なら誤りを報告し、処理は続けてよい)。
 * https://www.w3.org/TR/xsl11/ (2026-11-11 取得)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const pm = (body = '') => `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body ${body}/><fo:region-before extent="5mm"/></fo:simple-page-master></fo:layout-master-set>`;
const flow = (name: string | undefined, text: string) => `<fo:flow${name === undefined ? '' : ` flow-name="${name}"`}><fo:block>${text}</fo:block></fo:flow>`;
const imp = (flows: string, body = '', compat: 'spec' | 'antenna' = 'spec') => {
  const r = importXslFo(`<?xml version="1.0"?><fo:root ${NS}>${pm(body)}<fo:page-sequence master-reference="m">${flows}</fo:page-sequence></fo:root>`, parse, { compat });
  const text = JSON.stringify(r.document.sequences[0].flow.children);
  return { text, notes: r.report.notes, unsupported: r.report.unsupported };
};
const BOTH = ['spec', 'antenna'] as const;

describe('fo:flow の flow-name と領域の名前 (FO-25 (3))', () => {
  it('本文の領域と名前の合う fo:flow を本文へ流す (最初の fo:flow とは限らない)。注意は出ない', () => {
    for (const c of BOTH) {
      const r = imp(flow('other', 'FIRST') + flow('xsl-region-body', 'SECOND'), '', c);
      expect(r.text).toContain('SECOND');
      expect(r.text).not.toContain('FIRST');
      expect(r.notes).toEqual([]);
      // 流さなかった fo:flow は、今までどおり報告に数える
      expect(r.unsupported).toEqual({ 'flow:other': 1 });
    }
  });

  it('region-name を付けた本文の領域は、その名前の fo:flow を受ける', () => {
    const r = imp(flow('xsl-region-body', 'FIRST') + flow('main', 'SECOND'), 'region-name="main"');
    expect(r.text).toContain('SECOND');
    expect(r.text).not.toContain('FIRST');
    expect(r.notes).toEqual([]);
    expect(r.unsupported).toEqual({ 'flow:xsl-region-body': 1 });
  });

  it('どの領域とも名前の合わない fo:flow は、最初のものを本文へ流して、注意に出す (文書を空にしない)', () => {
    for (const c of BOTH) {
      const r = imp(flow('spread', 'FIRST'), '', c);
      expect(r.text).toContain('FIRST');
      expect(r.notes).toEqual(['flow-name "spread" に合う領域が無いので、本文の領域へ流しました']);
      expect(r.unsupported).toEqual({});
    }
  });

  it('flow-name の無い fo:flow・本文でない領域の名前の fo:flow も、本文へ流して注意に出す', () => {
    const a = imp(flow(undefined, 'FIRST'));
    expect(a.text).toContain('FIRST');
    expect(a.notes).toEqual(['fo:flow に flow-name が無いので、本文の領域へ流しました']);
    const b = imp(flow('xsl-region-before', 'FIRST'));
    expect(b.text).toContain('FIRST');
    expect(b.notes).toEqual(['fo:flow を本文でない領域 "xsl-region-before" へ流すことには未対応なので、本文の領域へ流しました']);
  });
});
