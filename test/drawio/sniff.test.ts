import { describe, expect, it } from 'vitest';
import { XML_COMMENT, isDrawio } from '../../src/drawio/sniff';
import { imageMime } from '../../src/drawio/drawioStencil';

const enc = (s: string) => new TextEncoder().encode(s);
/** 1 行ずつの注釈を n 個 (ライセンスの頭の形) */
const comments = (n: number) => Array.from({ length: n }, (_, i) => `<!-- line ${i} -->\n`).join('');
const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

// IMG-35: 頭の注釈を '(?:<!--[\s\S]*?-->\s*)*' で飛ばすと、注釈 n 個の分け方が 2^(n-1) 通りになり、後ろが合わないと終わらなかった。
// 注釈 300 個は、指数の手間なら決して終わらない大きさ (n=28 で 6 秒、2 個で 4 倍)。長さに比例する手間なら一瞬で終わる
describe('draw.io の見分け (isDrawio)', () => {
  it('XML 宣言・注釈・空白・BOM の後ろの <mxfile・<mxGraphModel は draw.io', () => {
    expect(isDrawio(enc('<mxfile host="x"><diagram/></mxfile>'))).toBe(true);
    expect(isDrawio(enc('﻿  ' + DECL + '<!-- a --><!-- b -->\n<mxfile>'))).toBe(true);
    expect(isDrawio(enc(DECL + comments(100) + '<mxGraphModel><root/></mxGraphModel>'))).toBe(true);
    expect(isDrawio(enc('<!-- a - b -- c -->\n<mxGraphModel/>'))).toBe(true);
  });

  it('注釈の中の <mxfile>・閉じない注釈・ほかの根の要素は draw.io ではない', () => {
    expect(isDrawio(enc('<!-- a <mxfile> -->'))).toBe(false);
    expect(isDrawio(enc('<!-- a <mxfile>'))).toBe(false);
    expect(isDrawio(enc('<!-- a --> b --><mxfile>'))).toBe(false); // 注釈は最初の --> で終わり、b --> は根の前の字
    expect(isDrawio(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
  });

  it('頭に注釈の多い SVG・XHTML・XSL-FO (draw.io ではない) も、すぐに偽を返す (指数の手間にならない)', () => {
    const docs = [
      DECL + comments(300) + '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      DECL + comments(300) + '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>',
      DECL + comments(300) + '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"/>',
      // 閉じない注釈が多いもの (中身の読み直しが重ならないこと)
      '<!--'.repeat(500) + '<svg/>',
    ];
    for (const d of docs) expect(isDrawio(enc(d))).toBe(false);
  });
});

describe('図の画像の種類 (imageMime の SVG の見分け)', () => {
  it('XML 宣言・注釈・DOCTYPE の後ろの <svg は SVG。注釈の多いものでも長さに比例する手間で見分ける', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(imageMime(enc(svg))).toBe('image/svg+xml');
    expect(imageMime(enc(DECL + '<!-- a --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<!-- b -->' + svg))).toBe('image/svg+xml');
    expect(imageMime(enc(DECL + comments(200) + svg))).toBe('image/svg+xml');
    expect(imageMime(enc('<!-- <svg> -->'))).toBeUndefined();
    expect(imageMime(enc('<!-- <svg>'))).toBeUndefined();
    // 注釈 300 個の後ろが svg でないもの (指数の手間なら終わらない)
    expect(imageMime(enc(DECL + comments(300) + '<html xmlns="http://www.w3.org/1999/xhtml"/>'))).toBeUndefined();
    expect(imageMime(enc(DECL + comments(300) + '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"/>'))).toBeUndefined();
  });
});

describe('注釈の正規表現 (XML_COMMENT。画面の図形ライブラリの見分け isStencilFile と同じ形)', () => {
  // 画面 (src/main.ts) は読み込めないので、isStencilFile と同じ形の正規表現で確かめる
  const head = new RegExp(String.raw`^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:${XML_COMMENT}\s*)*<(?:shapes|stencils)[\s>]`);
  it('注釈は最初の --> で閉じ、注釈 300 個の後ろが合わなくても、すぐに偽を返す', () => {
    expect(new RegExp(`^${XML_COMMENT}$`).test('<!-- a -- b -->')).toBe(true);
    expect(new RegExp(`^${XML_COMMENT}$`).test('<!-- a --><!-- b -->')).toBe(false);
    expect(head.test('﻿' + DECL + comments(300) + '<shapes name="x">')).toBe(true);
    expect(head.test(DECL + comments(300) + '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"/>')).toBe(false);
    expect(head.test('<!-- <shapes> -->')).toBe(false);
  });
});
