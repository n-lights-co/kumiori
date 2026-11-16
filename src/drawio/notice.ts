/**
 * draw.io の図を描く処理 (src/drawio/) を取り込んだ、ビルドした JavaScript のファイルの先頭に付ける表示 (vite.config.ts の postBanner が使う)。
 * ビルドするとソースのコメント (移したファイルの先頭の、draw.io と mxGraph の著作権表示) が除かれるので、
 * Apache License 2.0 の 4 項 (c) の著作権表示と、THIRD_PARTY_NOTICES.md の場所を、ファイルの中に書いておく。
 * 年の範囲は、移した元のファイルの表示 (THIRD_PARTY_NOTICES.md の 13.1 節) の範囲をまとめたもの
 */
export function drawioBanner(): string {
  return [
    '/*! Includes code ported from draw.io and mxGraph (https://github.com/jgraph/drawio), licensed under the Apache License 2.0:',
    ' * Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG; Copyright (c) 2006-2020, JGraph Ltd.',
    " * The shapes from draw.io's src/main/webapp/shapes/ are ported from draw.io v24.7.5 (Apache License 2.0 only).",
    ' * See section 13 of THIRD_PARTY_NOTICES.md. */',
  ].join('\n');
}
