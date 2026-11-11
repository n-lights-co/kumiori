/**
 * axf:form-field・axf:form・axf:form-field-option の属性は、接頭辞の無い名前 (field-type・field-name など) でも読む (台帳の FO-25 の (1))。
 * アンテナハウスの公開の説明 (https://www.antenna.co.jp/AHF/help/ja/ahf-ext.html の「フォーム」。2026-11-11 取得) は、性質を
 * axf:field-* の名前で定義し、書き方の例は axf:form・axf:form-field の上に接頭辞なしで書いている。どちらも axf: の要素の属性
 * (作成者が拡張と分かって書いたもの) なので、互換の指定によらず読む。
 * スクリプト (axf:form-field-event・action-type="javascript") は PDF に書かない (読まずに報告する)。
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import type { FormField } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
const imp = (body: string, compat: 'spec' | 'antenna') => {
  const r = importXslFo(`<?xml version="1.0"?><fo:root ${NS} font-size="10pt">${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`, parse, { compat });
  const fields: Array<FormField & { boxH?: number; boxW?: number }> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const o = n as { formField?: FormField; children?: unknown[]; width?: number; height?: number };
    if (o.formField) fields.push({ ...o.formField, boxW: o.width, boxH: o.height });
    for (const c of o.children ?? []) walk(c);
  };
  walk(r.document.sequences[0].flow);
  return { fields, unsupported: r.report.unsupported };
};
const BOTH = ['spec', 'antenna'] as const;

describe('axf:form-field の接頭辞の無い属性 (FO-25 (1))', () => {
  it('欄の種類・名前・既定の値・最大の字数・複数行・必須・読み取り専用を、接頭辞の無い名前で読む (どのモードでも)', () => {
    for (const c of BOTH) {
      const r = imp(
        '<fo:block><axf:form-field field-type="text" field-name="InputText" field-default-text="hello" field-maxlen="32" field-multiline="true" field-required="true" field-readonly="true" field-description="説明" width="100pt" height="12pt"/>' +
          '<axf:form-field field-type="text" field-name="pw" field-password="true"/></fo:block>',
        c,
      );
      expect(r.fields[0]).toMatchObject({ kind: 'text', name: 'InputText', value: 'hello', maxLength: 32, multiline: true, required: true, readOnly: true, description: '説明' });
      expect(r.fields[1]).toMatchObject({ kind: 'text', name: 'pw', password: true });
      expect(r.unsupported).toEqual({});
    }
  });

  it('チェックボックス・ラジオ・リスト・コンボの指定 (値・チェック・形・選択肢・複数・編集可) を読む', () => {
    const opts = '<axf:form-field-option field-value="ja">Japan</axf:form-field-option><axf:form-field-option field-value="ko">Korea</axf:form-field-option>';
    for (const c of BOTH) {
      const r = imp(
        '<fo:block><axf:form-field field-type="checkbox" field-name="CheckMe" field-checked="true" field-checked-style="circle" field-value="yes"/>' +
          '<axf:form-field field-type="radio" field-name="Choice" field-value="a"/>' +
          `<axf:form-field field-type="listbox" field-name="L" field-multiple="true" field-top-index="2">${opts}</axf:form-field>` +
          `<axf:form-field field-type="combobox" field-name="C" field-editable="true">${opts}</axf:form-field></fo:block>`,
        c,
      );
      expect(r.fields[0]).toMatchObject({ kind: 'checkbox', name: 'CheckMe', checked: true, checkStyle: 'circle', value: 'yes' });
      expect(r.fields[1]).toMatchObject({ kind: 'radio', name: 'Choice', value: 'a' });
      expect(r.fields[2]).toMatchObject({ kind: 'listbox', name: 'L', multiple: true, options: [{ value: 'ja', label: 'Japan' }, { value: 'ko', label: 'Korea', selected: true }] });
      expect(r.fields[3]).toMatchObject({ kind: 'combobox', name: 'C', editable: true });
      // チェックボックス・ラジオは、大きさの指定が無ければ 1 字角
      expect([r.fields[0].boxW, r.fields[0].boxH]).toEqual([10, 10]);
      expect(r.unsupported).toEqual({});
    }
  });

  it('ボタンの表示と動作 (submit・reset)、axf:form の送り方を、接頭辞の無い名前で読む', () => {
    for (const c of BOTH) {
      const r = imp(
        '<axf:form external-destination="https://example.com/post" field-submit-method="post"><fo:block>' +
          '<axf:form-field field-type="button" field-name="S" action-type="submit" field-button-face="Submit!" width="50pt"/>' +
          '<axf:form-field field-type="button" field-name="R" action-type="reset" field-button-face="Reset!" width="50pt"/></fo:block></axf:form>',
        c,
      );
      expect(r.fields[0]).toMatchObject({ kind: 'button', name: 'S', caption: 'Submit!', action: 'submit', submitUrl: 'https://example.com/post', submitMethod: 'post' });
      expect(r.fields[1]).toMatchObject({ kind: 'button', name: 'R', caption: 'Reset!', action: 'reset' });
      expect(r.unsupported).toEqual({});
    }
  });

  it('axf: の付いた名前 (説明の正式の名前) も今までどおり読む。両方あれば axf: の付いた方', () => {
    const r = imp('<fo:block><axf:form-field axf:field-type="checkbox" field-type="text" axf:field-name="a" field-name="b"/></fo:block>', 'spec');
    expect(r.fields[0]).toMatchObject({ kind: 'checkbox', name: 'a' });
  });

  it('スクリプトの動作 (axf:form-field-event・action-type="javascript") と、未対応の動作 (uri) は、読まずに報告する (PDF に書かない)', () => {
    for (const c of BOTH) {
      const r = imp(
        '<fo:block><axf:form-field field-type="button" field-name="b" field-button-face="x"><axf:form-field-event name="MouseUp" action-type="javascript">app.alert(1);</axf:form-field-event></axf:form-field>' +
          '<axf:form-field field-type="button" field-name="j" action-type="javascript" field-button-face="x"/>' +
          '<axf:form-field field-type="button" field-name="u" action-type="uri" external-destination="https://example.com/" field-button-face="x"/></fo:block>',
        c,
      );
      expect(r.fields.map((f) => f.action)).toEqual([undefined, undefined, undefined]);
      expect(JSON.stringify(r.fields)).not.toContain('alert');
      expect(r.unsupported).toEqual({ 'axf:form-field-event': 1, 'axf:action-type="javascript" (axf:form-field)': 1, 'axf:action-type="uri" (axf:form-field)': 1 });
    }
  });

  it('対応していない種類 (signature)・効かない指定 (field-scroll など) は、報告に出る', () => {
    const r = imp('<fo:block><axf:form-field field-type="signature" field-name="sig1"/><axf:form-field field-type="text" field-name="t" field-scroll="true" field-button-layout="caption"/></fo:block>', 'antenna');
    expect(r.unsupported).toEqual({ 'axf:field-type="signature"': 1, 'field-scroll': 1, 'field-button-layout': 1 });
  });
});
