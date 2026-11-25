/**
 * hyphenationNotices — 分綴のパターンを取り込んだチャンクに付ける、パターンごとの著作権とライセンスの表示 (vite.config.ts の postBanner が使う)。
 * 名前は hyphen のパターンの名前 (patterns/<名前>.js)。src/hyphenation.ts の PATTERNS に足したパターンは、ここにも足す (試験で照らす)。
 * 上流の表示の写しは THIRD_PARTY_NOTICES.md の 1.4 節
 */

/** hyph-utf8 のパターンのファイルの場所 (分綴のパターンの注記に書く、元のファイルの入手先) */
export const HYPH_UTF8 = 'https://ctan.org/pkg/hyph-utf8 (tex/generic/hyph-utf8/patterns/tex/)';
export const MIT_TEXT = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
  'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
  'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
  'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of',
  'the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
  'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,',
  'TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
];
/** ビルドのモジュールの id が hyphen のパターンのファイル (hyphen/patterns/<名前>.js) なら、その名前 (de-1996 のように数字も含む) */
export function hyphenPatternOf(id: string): string | undefined {
  return /[\\/]hyphen[\\/]patterns[\\/]([a-z0-9-]+)\.js$/.exec(id.split('?')[0])?.[1];
}

/** 「Data Files」の許諾の表示 (c 項) が求める、変えたことの表示 */
const MODIFIED_DATA = (file: string, name: string) =>
  `MODIFIED: the patterns of ${file} were converted from the TeX \\patterns{...} list into JavaScript data by the npm package "hyphen" (its file patterns/${name}.js), and that file was bundled (and, in some builds, minified) into this chunk by Kumiori. The pattern data itself was not changed.`;
/**
 * LPPL だけのパターン (上流は LPPL 1.x 以降) の注記。LPPL 1.3c を選び、変更したもの (Derived Work) を配る条件 (第 6 項) の
 * b: 変更の内容を目立つように書く、c: 元の作者がサポートするかのように書かない、d: 元のファイルを入手するのに十分な情報を付ける、に従う。
 * a (LaTeX などの上で、元の部品の代わりに使える部品が、変更したものと名乗ること) は、JavaScript に変換したものは元の部品の代わりにならないので当たらない
 */
const LPPL = (name: string, language: string, copyright: string, version: string) => [
  `Hyphenation patterns for ${language}. ${copyright}.`,
  `License: LaTeX Project Public License (LPPL), version ${version} or later; distributed here under LPPL 1.3c`,
  '(https://latex-project.org/lppl/lppl-1-3c.txt).',
  'THIS IS A MODIFIED VERSION (a Derived Work under the LPPL), NOT THE ORIGINAL FILE. Nature of the changes:',
  `the patterns of hyph-${name}.tex (part of the hyph-utf8 package) were converted from the TeX \\patterns{...} list into`,
  `JavaScript data (arrays encoding the same patterns) by the npm package "hyphen" (its file patterns/${name}.js), and that`,
  'file was bundled (and, in some builds, minified) into this chunk by Kumiori. The TeX comments of the original are not included.',
  'The pattern data itself was not edited by Kumiori.',
  `The complete, unmodified original (hyph-${name}.tex) can be obtained from the hyph-utf8 package: ${HYPH_UTF8}`,
  `or https://github.com/hyphenation/tex-hyphen (hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-${name}.tex).`,
  'The author and maintainers of the original patterns do not provide any support for this modified version;',
  'report problems to the Kumiori project.',
];
/**
 * 分綴のパターン (npm の hyphen の patterns/<名前>.js。hyph-utf8 の hyph-<名前>.tex を JavaScript に変換したもの) を取り込んだ
 * チャンクの先頭に足す注記: パターンごとの著作権の表示と、ライセンスが求める表示。全文と上流の冒頭の表示は THIRD_PARTY_NOTICES.md §1.4。
 *  - MIT (en-gb・la・uk・el-monoton・el-polyton・grc・de-*・fr・es・it・nl・pl・da・sk・sl・et・lt・ga・cy): 著作権の表示と許諾の表示を、すべての複製に含める。
 *    MIT とほかのライセンスから選べるものは、MIT を選んだと書く
 *  - BSD 3 条項 (pt)・BSD 3 条項に近い表示 (bg)・著作権の表示を残せば配ってよい表示 (nb。読み込む hyph-no.tex の表示も)・
 *    「自由に配ってよい」(fi)・Unlicense (gl): 上流の表示をそのまま含める
 *  - 「Data Files」の許諾の表示 (eu・hr。hr は LPPL とどちらか): 表示を含め、変えたファイルに変えたことをはっきり書く (c 項。MODIFIED_DATA)
 *  - en-us: 「著作権の表示とこの表示を残せば、変更の有無によらず複製・配布してよい」という表示を残す
 *  - LPPL 1.3c (ru・sv・ca・is・tr・sh-latn・sh-cyrl。上流は LPPL 1.x 以降): 第 6 項の注記 (LPPL)
 *  - MPL 1.1 (hu): Exhibit A の表示、変えたこと、ライセンスの写しの場所、縮めた画面のビルドのためのソースの形の入手先
 */
export const HYPHEN_NOTICES: Record<string, string[]> = {
  'en-us': [
    'Hyphenation patterns for American English (hyph-en-us.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken',
    'Copying and distribution of this file, with or without modification, are permitted in any medium without royalty',
    'provided the copyright notice and this notice are preserved.',
  ],
  'en-gb': [
    'Hyphenation patterns for British English (hyph-en-gb.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1992, 1996, 2005, 2016 Dominik Wujastyk, Graham Toal',
    'MIT License.',
    ...MIT_TEXT,
  ],
  la: [
    'Hyphenation patterns for modern and medieval Latin (hyph-la.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1999-2016 Claudio Beccari',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  uk: [
    'Hyphenation patterns for Ukrainian (hyph-uk.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1998-2001 Maksym Polyakov',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  'el-monoton': [
    'Hyphenation patterns for Modern Greek, monotonic (hyph-el-monoton.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2008-2011 Dimitrios Filippou',
    'Available under the LPPL or the MIT License; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  'el-polyton': [
    'Hyphenation patterns for Modern Greek, polytonic (hyph-el-polyton.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2008-2011 Dimitrios Filippou',
    'Available under the LPPL or the MIT License; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  grc: [
    'Hyphenation patterns for Ancient Greek (hyph-grc.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2008-2016 Dimitrios Filippou',
    'Available under the LPPL or the MIT License; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  ru: LPPL('ru', 'Russian', 'Copyright (C) 1999-2003 Alexander I. Lebedev', '1.2'),
  'de-1996': [
    'Hyphenation patterns for German, reformed orthography (hyph-de-1996.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (c) 2013-2024 Stephan Hennig, Werner Lemberg, Günter Milde, Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke, Tobias Wendorf, Keno Wehr',
    'MIT License.',
    ...MIT_TEXT,
  ],
  'de-1901': [
    'Hyphenation patterns for German, traditional orthography (hyph-de-1901.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (c) 2013-2024 Stephan Hennig, Werner Lemberg, Günter Milde, Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke, Tobias Wendorf, Keno Wehr',
    'MIT License.',
    ...MIT_TEXT,
  ],
  'de-ch-1901': [
    'Hyphenation patterns for Swiss German, traditional orthography (hyph-de-ch-1901.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (c) 2013-2024 Stephan Hennig, Werner Lemberg, Günter Milde, Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke, Tobias Wendorf, Keno Wehr',
    'MIT License.',
    ...MIT_TEXT,
  ],
  fr: [
    'Hyphenation patterns for French (hyph-fr.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1994-2002 Daniel Flipo, Bernard Gaulle, 2016 Arthur Reutenauer',
    'MIT License.',
    ...MIT_TEXT,
  ],
  es: [
    'Hyphenation patterns for Spanish (hyph-es.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1993, 1997 Javier Bezos, 2001-2019 Javier Bezos, CervanTeX',
    'MIT License.',
    ...MIT_TEXT,
  ],
  it: [
    'Hyphenation patterns for Italian (hyph-it.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2008-2011 Claudio Beccari',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  pt: [
    'Hyphenation patterns for Portuguese (hyph-pt.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1987, 1994, 1996, 2015 Pedro J. de Rezende, 1996, 2015 J. Joao Dias Almeida, 2024 Leonardo Araujo and Aline Benevides',
    'BSD 3-clause licence:',
    "Redistribution and use in source and binary forms, with or without",
    "modification, are permitted provided that the following conditions",
    "are met:",
    "* Redistributions of source code must retain the above copyright",
    "notice, this list of conditions and the following disclaimer.",
    "* Redistributions in binary form must reproduce the above copyright",
    "notice, this list of conditions and the following disclaimer in the",
    "documentation and/or other materials provided with the",
    "distribution.",
    "* Neither the name of the University of Campinas, of the University",
    "of Minho nor the names of its contributors may be used to endorse",
    "or promote products derived from this software without specific",
    "prior written permission.",
    "",
    "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS",
    "\"AS IS\" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT",
    "LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR",
    "A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL PEDRO J. DE",
    "REZENDE OR J.JOAO DIAS ALMEIDA BE LIABLE FOR ANY DIRECT, INDIRECT,",
    "INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,",
    "BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS",
    "OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED",
    "AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT",
    "LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY",
    "WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE",
    "POSSIBILITY OF SUCH DAMAGE.",
  ],
  nl: [
    'Hyphenation patterns for Dutch (hyph-nl.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1996 Piet Tutelaers',
    'MIT License.',
    ...MIT_TEXT,
  ],
  pl: [
    'Hyphenation patterns for Polish (hyph-pl.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1987-1995 Hanna Kołodziejska, Bogusław Jackowski, Marek Ryćko',
    'Available under the MIT License or in the public domain under the conditions of the author of TeX; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  da: [
    'Hyphenation patterns for Danish (hyph-da.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1994 Frank Jensen',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  nb: [
    'Hyphenation patterns for Norwegian Bokmål (the patterns of hyph-no.tex) (hyph-nb.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2004–2005 Rune Kleveland, Ole Michael Selberg, 2007 Karl Ove Hufthammer',
    "Copying and distribution of this file, with or without modification,",
    "are permitted in any medium without royalty, provided the copyright",
    "notice and this notice are preserved.",
    'The patterns are read from hyph-no.tex, whose notice follows:',
    'Hyphenation patterns for Norwegian (hyph-no.tex of the hyph-utf8 package).',
    'Copyright (C) 2004, 2005 Rune Kleveland, Ole Michael Selberg',
    "Copying and distribution of this file, with or without modification,",
    "is permitted in any medium without royalty provided the copyright",
    "notice and this notice are preserved.",
  ],
  sk: [
    'Hyphenation patterns for Slovak (hyph-sk.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1992 Jana Chlebíková',
    'MIT License.',
    ...MIT_TEXT,
  ],
  sl: [
    'Hyphenation patterns for Slovenian (hyph-sl.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1990 Matjaž Vrečko',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  hr: [
    'Hyphenation patterns for Croatian (hyph-hr.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1994, 1996, 2011, 2015 Igor Marinović',
    'Available under the LPPL or the following licence; distributed here under the following licence:',
    "Permission is hereby granted, free of charge, to any person obtaining",
    "a copy of this file and any associated documentation",
    "(the \"Data Files\") to deal in the Data Files",
    "without restriction, including without limitation the rights to use,",
    "copy, modify, merge, publish, distribute, and/or sell copies of",
    "the Data Files, and to permit persons to whom the Data Files",
    "are furnished to do so, provided that",
    "(a) this copyright and permission notice appear with all copies",
    "of the Data Files,",
    "(b) this copyright and permission notice appear in associated",
    "documentation, and",
    "(c) there is clear notice in each modified Data File",
    "as well as in the documentation associated with the Data File(s)",
    "that the data has been modified.",
    "",
    "THE DATA FILES ARE PROVIDED \"AS IS\", WITHOUT WARRANTY OF",
    "ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE",
    "WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND",
    "NONINFRINGEMENT OF THIRD PARTY RIGHTS.",
    "IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS",
    "NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL",
    "DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,",
    "DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER",
    "TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR",
    "PERFORMANCE OF THE DATA FILES.",
    "",
    "Except as contained in this notice, the name of a copyright holder",
    "shall not be used in advertising or otherwise to promote the sale,",
    "use or other dealings in these Data Files without prior",
    "written authorization of the copyright holder.",
    MODIFIED_DATA('hyph-hr.tex', 'hr'),
  ],
  et: [
    'Hyphenation patterns for Estonian (hyph-et.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2004-2015 Enn Saar',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  lt: [
    'Hyphenation patterns for Lithuanian (hyph-lt.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1992 Sigitas Tolušis, Yannis Haralambous',
    'MIT License.',
    ...MIT_TEXT,
  ],
  ga: [
    'Hyphenation patterns for Irish (hyph-ga.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2004-2015 Kevin P. Scannell',
    'Available under the MIT License or the GPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  cy: [
    'Hyphenation patterns for Welsh (hyph-cy.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1996 Yannis Haralambous',
    'Available under the MIT License or the LPPL; distributed here under the MIT License.',
    ...MIT_TEXT,
  ],
  gl: [
    'Hyphenation patterns for Galician (hyph-gl.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2006, 2007, 2008, 2010 Javier A. Múgica',
    "The Unlicense (https://unlicense.org/).",
  ],
  eu: [
    'Hyphenation patterns for Basque (hyph-eu.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1997, 2008 Juan M. Aguirregabiria',
    "Permission is hereby granted, free of charge, to any person obtaining",
    "a copy of this file and any associated documentation",
    "(the \"Data Files\") to deal in the Data Files",
    "without restriction, including without limitation the rights to use,",
    "copy, modify, merge, publish, distribute, and/or sell copies of",
    "the Data Files, and to permit persons to whom the Data Files",
    "are furnished to do so, provided that",
    "(a) this copyright and permission notice appear with all copies",
    "of the Data Files,",
    "(b) this copyright and permission notice appear in associated",
    "documentation, and",
    "(c) there is clear notice in each modified Data File",
    "as well as in the documentation associated with the Data File(s)",
    "that the data has been modified.",
    "",
    "THE DATA FILES ARE PROVIDED \"AS IS\", WITHOUT WARRANTY OF",
    "ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE",
    "WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND",
    "NONINFRINGEMENT OF THIRD PARTY RIGHTS.",
    "IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS",
    "NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL",
    "DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,",
    "DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER",
    "TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR",
    "PERFORMANCE OF THE DATA FILES.",
    "",
    "Except as contained in this notice, the name of a copyright holder",
    "shall not be used in advertising or otherwise to promote the sale,",
    "use or other dealings in these Data Files without prior",
    "written authorization of the copyright holder.",
    MODIFIED_DATA('hyph-eu.tex', 'eu'),
  ],
  bg: [
    'Hyphenation patterns for Bulgarian (hyph-bg.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2000, 2004, 2017 Anton Zinoviev',
    "This software may be used, modified, copied, distributed, and sold,",
    "both in source and binary form provided that the above copyright",
    "notice and these terms are retained. The name of the author may not",
    "be used to endorse or promote products derived from this software",
    "without prior permission.  THIS SOFTWARE IS PROVIDES \"AS IS\" AND",
    "ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.  IN NO EVENT",
    "SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY OUT",
    "OF THE USE OF THIS SOFTWARE.",
  ],
  fi: [
    'Hyphenation patterns for Finnish (hyph-fi.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 1986, 1988, 1989 Kauko Saarinen',
    "Patterns may be freely distributed",
  ],
  sv: LPPL('sv', 'Swedish', 'Copyright (C) 1994 Jan Michael Rynning', '1.2'),
  ca: LPPL('ca', 'Catalan', 'Copyright (C) December 1991-January 1995, July 2003 Gonçal Badenes', '1'),
  is: LPPL('is', 'Icelandic', 'Copyright (C) 1988, 2004 Jörgen Pind', '1.2'),
  tr: LPPL('tr', 'Turkish', 'Copyright (C) 1987 Pierre A. MacKay, 2008, 2011 TUG', '1'),
  'sh-latn': LPPL('sh-latn', 'Serbo-Croatian, Latin script', 'Copyright (C) 1990, 2008 Dejan Muhamedagić', '1'),
  'sh-cyrl': LPPL('sh-cyrl', 'Serbo-Croatian, Cyrillic script', 'Copyright (C) 1990, 2008 Dejan Muhamedagić', '1'),
  // MPL 1.1 (MPL・GPL 2.0・LGPL 2.1 から選ぶ)。Exhibit A の表示 (§3.5)、変えたことと元の作者の名前 (§3.3)、ライセンスの写しの場所 (§3.1) を書く。
  // ブラウザ向けの配布物 (npm) では、このチャンクは縮めない (ソースの形 (§1.11) のまま配る)。画面のビルド (dist/) は、すべてのコードを縮めるので
  // (チャンクごとに外す設定が無い)、このチャンクも実行の形 (§1.5) になる。そのため、ソースの形の入手先 (npm の kumiori と hyphen) を告知する (§3.2・§3.6)
  hu: [
    'Hyphenation patterns for Hungarian (hyph-hu.tex of the hyph-utf8 package), converted to JavaScript by the npm package "hyphen".',
    'Copyright (C) 2003 Bence Nagy',
    'The contents of this file are subject to the Mozilla Public License Version 1.1 (the "License"); you may not use this file',
    'except in compliance with the License. You may obtain a copy of the License at http://www.mozilla.org/MPL/',
    'Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express',
    'or implied. See the License for the specific language governing rights and limitations under the License.',
    'The Original Code is the Hungarian hyphenation patterns (hyph-hu.tex of the hyph-utf8 package).',
    'The Initial Developer of the Original Code is Bence Nagy. Portions created by Bence Nagy are Copyright (C) 2003 Bence Nagy.',
    'All Rights Reserved. Contributor(s): Bence Nagy.',
    'The original file is also available under the GPL 2.0 or the LGPL 2.1; this file is distributed here under the MPL 1.1.',
    'A copy of the MPL 1.1 is included in THIRD_PARTY_NOTICES.md (section 1.4, Hungarian).',
    'MODIFICATIONS (derived from the Original Code provided by the Initial Developer, Bence Nagy): the patterns of hyph-hu.tex',
    'were converted from the TeX \\patterns{...} list into JavaScript data by the npm package "hyphen" (its file patterns/hu.js;',
    'hyphen 1.14.1, released 2026-01-16), and Kumiori (since 2026-11-22) bundles that file into this chunk without minifying it',
    'and without changing the pattern data. In the npm package (dist-browser/chunks/hu-*.js) this chunk is not minified and is',
    'the Source Code form of these patterns. In the web application build (dist/), which minifies all of its code, this chunk is',
    'an Executable form; its Source Code form is available under the MPL 1.1 from the npm registry, in the package kumiori of the',
    'same version (dist-browser/chunks/hu-*.js) and in the package hyphen 1.14.1 (patterns/hu.js).',
    `The unmodified original (hyph-hu.tex) can be obtained from the hyph-utf8 package: ${HYPH_UTF8}`,
    'or https://github.com/hyphenation/tex-hyphen (hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-hu.tex).',
  ],
};
