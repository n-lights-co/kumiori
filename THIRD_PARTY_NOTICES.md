# Third-party notices (第三者のソフトウェアの表示)

Kumiori の配布物に含まれる、または Kumiori の実行に使われる第三者のソフトウェアの表示です。
ライセンスの本文と著作権表示は、各パッケージ (node_modules の中) のファイルから、書き換えずに転記しています。
パッケージにライセンスのファイルが無いものは、その事実と、パッケージの中の表示だけを書いています。

- 対象の版: このリポジトリの `package-lock.json` で入る版 (下の各節に版を書いています。14 節は `tools/api-docs/package-lock.json` で入る版)
- この文書は、ライセンスの解釈や法的な判断を示すものではありません。

## 1. ブラウザ向けの配布物 (`dist/`・`dist-browser/`) に含まれるもの

次の 2 つのブラウザ向けの配布物は、この節のパッケージを取り込んでいます (2026-11-16 に、ビルドのソースマップで取り込まれたパッケージを確かめました)。

- 画面 (`npm run build` の `dist/`。GitHub Pages に置くもの)。この節のパッケージに加えて、下の 2 節の @xmldom/xmldom も取り込んでいます (XSL-FO と XHTML を読むため。2026-11-21 に、ビルドのソースマップで確かめました)。
- ブラウザで単体で動くライブラリ (`npm run build:browser` の `dist-browser/`。npm の `kumiori/browser`)。この節のパッケージに加えて、下の 2 節の @xmldom/xmldom も取り込んでいます (XSL-FO を読むため)。
  また、Web Worker の中で HTML・SVG を読むときだけ読み込む別ファイル (`chunks/esm-*.js`) に、下の 2 節の linkedom と、その依存 (htmlparser2・css-select・css-what・nth-check・boolbase・domhandler・domutils・domelementtype・dom-serializer・entities・cssomnom・uhyphen。2 節に挙げた版のすべて) を取り込んでいます (2026-11-19 に、ビルドのソースマップで確かめました。2 節の html-escaper は、使われないので取り込まれません)

draw.io の図を描く処理 (`src/drawio/`。図が出てきたときだけ読み込む別のチャンク) は、roughjs (hachure-fill・path-data-parser・points-on-curve・points-on-path を含む) を取り込んでいます。
その処理には、draw.io と mxGraph から移したコードが入っています (表示は下の 13 節)。そのチャンクの JavaScript のファイルの先頭にも、draw.io と mxGraph の著作権表示を書いています。

GitHub Pages の画面の下に置く API の説明書 (`dist/api/`) に含まれるものは、下の 14 節に書いています。

ライブラリ (`npm run build:lib` の `dist-lib/`。npm の `kumiori`) は依存パッケージを取り込まず、実行時に node_modules から読み込みます (下の 2 節と同じ)。

### pdf-lib 1.17.1

- package.json の license: `MIT`
- 場所: `node_modules/pdf-lib`

`node_modules/pdf-lib/LICENSE.md` の本文:

```text
MIT License

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### @pdf-lib/fontkit 1.1.1

- package.json の license: `MIT`
- 場所: `node_modules/@pdf-lib/fontkit`
- fontkit のフォーク (package.json の repository: `git://github.com/Hopding/fontkit.git`)。
- パッケージに LICENSE ファイルなし。
- 配布物には、ほかのパッケージのコードが取り込まれています。その表示は下の 1.1.1 にあります。

package.json の表示 (そのまま):

```text
{
  "name": "@pdf-lib/fontkit",
  "version": "1.1.1",
  "license": "MIT",
  "author": "Andrew Dillon <andrew.dillon.j@gmail.com>",
  "contributors": [
    "Devon Govett <devongovett@gmail.com> (http://badassjs.com/)"
  ],
  "repository": {
    "type": "git",
    "url": "git://github.com/Hopding/fontkit.git"
  }
}
```

README.md の License の節 (そのまま):

```text
## License
[MIT](https://choosealicense.com/licenses/mit/)
```

### @pdf-lib/standard-fonts 1.0.0

- package.json の license: `MIT`
- 場所: `node_modules/@pdf-lib/standard-fonts`
- Adobe の AFM (フォントの寸法) のデータを含む (下の 1.3)。

`node_modules/@pdf-lib/standard-fonts/LICENSE.md` の本文:

```text
MIT License

Copyright (c) 2018 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### @pdf-lib/upng 1.0.1

- package.json の license: `MIT`
- 場所: `node_modules/@pdf-lib/upng`

`node_modules/@pdf-lib/upng/LICENSE` の本文:

```text
MIT License

Copyright (c) 2017 Photopea

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### pako 3.0.3

- package.json の license: `(MIT AND Zlib)`
- 場所: `node_modules/pako`
- Kumiori の本体が、draw.io の図の圧縮を解くのに使う (draw.io の図を描く処理のチャンクに入る)。Zlib の条文は下の 1.2。

`node_modules/pako/LICENSE` の本文:

```text
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### pako 1.0.11

- package.json の license: `(MIT AND Zlib)`
- 場所: `node_modules/pdf-lib/node_modules/pako` (npm は、同じ版を `node_modules/@pdf-lib/fontkit/node_modules/pako`・`node_modules/@pdf-lib/standard-fonts/node_modules/pako`・`node_modules/@pdf-lib/upng/node_modules/pako`・`node_modules/utif/node_modules/pako` にも置く。ビルドでは 1 つにまとめて取り込む)
- pdf-lib・@pdf-lib/fontkit・@pdf-lib/standard-fonts・@pdf-lib/upng・utif を通して使われる。Zlib の条文は下の 1.2。

`node_modules/pdf-lib/node_modules/pako/LICENSE` の本文:

```text
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### tslib 1.14.1

- package.json の license: `0BSD`
- 場所: `node_modules/tslib`
- pdf-lib を通して使われる。

`node_modules/tslib/LICENSE.txt` の本文:

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### utif 3.1.0

- package.json の license: `MIT`
- 場所: `node_modules/utif`
- 必要なときだけ読み込む (別のチャンク)。

`node_modules/utif/LICENSE` の本文:

```text
MIT License

Copyright (c) 2017 Photopea

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### hyphen 1.14.1

- package.json の license: `ISC`
- 場所: `node_modules/hyphen`
- 必要なときだけ読み込む (別のチャンク)。分綴のパターン (en-us・en-gb・la・ru・uk・el-monoton) の表示は下の 1.4。

`node_modules/hyphen/LICENSE` の本文:

```text
ISC License (ISC)

Copyright (c) 2026, Yevhen Tiurin <yevhentiurin@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### roughjs 4.6.6

- package.json の license: `MIT`
- 場所: `node_modules/roughjs`
- draw.io の図の手書き風 (sketch) を描く (`src/drawio/drawioSketch.ts`。draw.io の図を描く処理と一緒に、図が出てきたときだけ読み込む)。

`node_modules/roughjs/LICENSE` の本文:

```text
MIT License

Copyright (c) 2019 Preet Shihn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### hachure-fill 0.5.2

- package.json の license: `MIT`
- 場所: `node_modules/hachure-fill`
- roughjs の依存 (斜線の塗り)。

`node_modules/hachure-fill/LICENSE` の本文:

```text
MIT License

Copyright (c) 2023 Preet Shihn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### path-data-parser 0.1.0

- package.json の license: `MIT`
- 場所: `node_modules/path-data-parser`
- roughjs の依存 (SVG の経路の読み取り)。

`node_modules/path-data-parser/LICENSE` の本文:

```text
MIT License

Copyright (c) 2020 Preet Shihn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### points-on-curve 0.2.0

- package.json の license: `MIT`
- 場所: `node_modules/points-on-curve`
- roughjs の依存 (曲線の点)。

`node_modules/points-on-curve/LICENSE` の本文:

```text
MIT License

Copyright (c) 2020 Preet Shihn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### points-on-path 0.2.1

- package.json の license: `MIT`
- 場所: `node_modules/points-on-path`
- roughjs の依存 (経路の点)。

`node_modules/points-on-path/LICENSE` の本文:

```text
MIT License

Copyright (c) 2020 Preet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 1.1 パッケージのソースの中にある、ほかのソフトウェアの表示

上のパッケージのソースファイルの冒頭などにある表示です。どれもブラウザ向けのバンドルに含まれるファイルにあります (ソースマップで確認)。コメントをそのまま転記します。

`node_modules/pdf-lib/es/api/svgPath.js` の 1〜4 行目:

```text
// Originated from pdfkit Copyright (c) 2014 Devon Govett
// https://github.com/foliojs/pdfkit/blob/1e62e6ffe24b378eb890df507a47610f4c4a7b24/lib/path.js
// MIT LICENSE
// Updated for pdf-lib & TypeScript by Jeremy Messenger
```

`node_modules/pdf-lib/es/core/streams/Stream.js` の 1〜7 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The Stream class contained in this file is a TypeScript port of the
 * JavaScript Stream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/DecodeStream.js` の 3〜9 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The DecodeStream class contained in this file is a TypeScript port of the
 * JavaScript DecodeStream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/FlateStream.js` の 1〜15 行目:

```text
/*
 * Copyright 1996-2003 Glyph & Cog, LLC
 *
 * The flate stream implementation contained in this file is a JavaScript port
 * of XPDF's implementation, made available under the Apache 2.0 open source
 * license.
 */
import { __extends } from "tslib";
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The FlateStream class contained in this file is a TypeScript port of the
 * JavaScript FlateStream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/RunLengthStream.js` の 1〜7 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The RunLengthStream class contained in this file is a TypeScript port of the
 * JavaScript RunLengthStream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/AsciiHexStream.js` の 1〜7 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The AsciiHexStream class contained in this file is a TypeScript port of the
 * JavaScript AsciiHexStream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/Ascii85Stream.js` の 1〜7 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The Ascii85Stream class contained in this file is a TypeScript port of the
 * JavaScript Ascii85Stream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/core/streams/LZWStream.js` の 1〜7 行目:

```text
/*
 * Copyright 2012 Mozilla Foundation
 *
 * The LZWStream class contained in this file is a TypeScript port of the
 * JavaScript LZWStream class in Mozilla's pdf.js project, made available
 * under the Apache 2.0 open source license.
 */
```

`node_modules/pdf-lib/es/utils/base64.js` の 1〜11 行目:

```text
/*
 * The `chars`, `lookup`, `encode`, and `decode` members of this file are
 * licensed under the following:
 *
 *     base64-arraybuffer
 *     https://github.com/niklasvh/base64-arraybuffer
 *
 *     Copyright (c) 2012 Niklas von Hertzen
 *     Licensed under the MIT license.
 *
 */
```

`node_modules/@pdf-lib/standard-fonts/es/utils.js` の 1〜11 行目:

```text
/*
 * The `chars`, `lookup`, and `decodeFromBase64` members of this file are
 * licensed under the following:
 *
 *     base64-arraybuffer
 *     https://github.com/niklasvh/base64-arraybuffer
 *
 *     Copyright (c) 2012 Niklas von Hertzen
 *     Licensed under the MIT license.
 *
 */
```

`node_modules/@pdf-lib/fontkit/dist/fontkit.es.js` の 3349〜3368 行目 (string_decoder の部分):

```text
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### 1.1.1 @pdf-lib/fontkit の配布物に取り込まれたもの

`node_modules/@pdf-lib/fontkit/dist/` の配布物 (`fontkit.es.js`・`fontkit.umd.js` とその縮めたもの) には、fontkit を作るときに rollup で取り込んだ、ほかのパッケージのコードが入っています。fontkit のパッケージにはそれらの表示が無いので、ここにまとめます。Kumiori のブラウザ向けの配布物 (`dist-browser/`) は fontkit を取り込み、コメントを除くので、ここの表示がそれらの表示になります。

- 取り込まれたもの: fontkit の package.json の開発用の依存 (`devDependencies`) と、配布物の中のコードの特徴 (関数の名前・文字列) から洗い出しました。配布物にはソースマップが無く、取り込まれた版は分かりません。下の条文は、package.json の範囲に合う版のパッケージ (2026-11-09 に npm から取得) から、書き換えずに写しています。
- 配布物に入っていないことを確かめたもの: rollup-plugin-node-builtins の setimmediate・zlib など、上に挙げた以外の Node の組み込みの代わり。fontkit の依存 (`dependencies`) の pako は、取り込まずに読み込みます (上の pako の節)。
- `fontkit.es.js` の中に残っている表示は、string_decoder の Joyent の表示 (上の 1.1 に転記)、base64-arraybuffer の表示 (23697 行目。下の base64-arraybuffer の LICENSE と同じ著作権者)、Brotli の展開の Google Inc. の表示 (34218 行目ほか。下に転記) です。
- @pdf-lib/unicode-properties の字の性質の表と、fontkit の字の並びの照合の表は、Unicode の文字データベースから作られたものです。Unicode の文字データの許諾 (Unicode License v3) の本文は、下の 6 節にあります。

#### Brotli の展開 (@pdf-lib/brotli 0.0.0) と base64-js

Kumiori は、WOFF2 の書体を読むとき (`src/webFont.ts`) に、この Brotli の展開を使います。

- @pdf-lib/brotli 0.0.0 (`@pdf-lib/brotli ^0.0.0`): package.json の license は `MIT`、repository は `https://github.com/Hopding/brotli.js.git`。パッケージに LICENSE ファイルはありません。展開のコードのファイル (`dec/decode.js`・`dec/bit_reader.js`・`dec/dictionary.js`・`dec/dictionary-data.js`・`dec/prefix.js`・`dec/transform.js`・`dec/context.js`) の冒頭には、次の表示があります (`fontkit.es.js` にも残っています。`dec/decode.js` の冒頭をそのまま。Apache License 2.0 の本文は下の 1.5 にあります):

```text
/* Copyright 2013 Google Inc. All Rights Reserved.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
```

- base64-js (@pdf-lib/brotli と buffer の依存。取り込まれた版は分かりません): base64-js 1.5.1 の LICENSE:

```text
The MIT License (MIT)

Copyright (c) 2014 Jameson Little

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### buffer 5.7.1

- 用途: Node の Buffer の代わり (`buffer ^5.6.0`)
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh, and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### ieee754 1.2.1

- 用途: buffer が使う浮動小数点の読み書き
- package.json の license: `BSD-3-Clause`

`LICENSE` (そのまま):

```text
Copyright 2008 Fair Oaks Labs, Inc.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### base64-arraybuffer 0.1.5

- 用途: `base64-arraybuffer ^0.1.5`
- package.json の license: `MIT`

`LICENSE-MIT` (そのまま):

```text
Copyright (c) 2012 Niklas von Hertzen

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

#### @pdf-lib/restructure 0.0.1

- 用途: 書体の表の読み書き (`@pdf-lib/restructure ^0.0.1`)
- package.json の license: `MIT`
- パッケージに LICENSE ファイルなし。package.json の author: `Andrew Dillon <andrew.dillon.j@gmail.com>`、repository: `git://github.com/Hopding/restructure.git`

#### @pdf-lib/unicode-properties 0.0.1

- 用途: 字の Unicode の性質 (`@pdf-lib/unicode-properties ^0.0.1`)
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
Copyright 2018

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### unicode-trie 0.3.1

- 用途: 字の性質の表 (`unicode-trie ^0.3.0`)
- package.json の license: `MIT`
- パッケージに LICENSE ファイルなし。package.json の author: `Devon Govett <devongovett@gmail.com>`、repository: `git://github.com/devongovett/unicode-trie.git`

#### tiny-inflate 1.0.3

- 用途: unicode-trie の表の展開 (`tiny-inflate ^1.0.2`)
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
MIT License

Copyright (c) 2015-present Devon Govett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### dfa 1.2.0

- 用途: 字の並びの照合 (`dfa ^1.0.0`)
- package.json の license: `MIT`
- パッケージに LICENSE ファイルなし。package.json の author: `Devon Govett <devongovett@gmail.com>`、repository: `git+ssh://git@github.com/devongovett/dfa.git`

#### clone 1.0.4

- 用途: `clone ^1.0.1`
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
Copyright © 2011-2015 Paul Vorbach <paul@vorba.ch>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### deep-equal 1.1.1

- 用途: `deep-equal ^1.0.0`
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
MIT License

Copyright (c) 2012, 2013, 2014 James Halliday <mail@substack.net>, 2009 Thomas Robinson <280north.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### is-arguments 1.0.4

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (c) 2014 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### is-date-object 1.0.2

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (c) 2015 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### is-regex 1.1.0

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (c) 2014 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### object-is 1.1.2

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (c) 2014 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### object-keys 1.1.1

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (C) 2013 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### regexp.prototype.flags 1.3.0

- 用途: deep-equal の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (C) 2014 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### define-properties 1.1.3

- 用途: regexp.prototype.flags・object-is の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
The MIT License (MIT)

Copyright (C) 2015 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### has-symbols 1.0.1

- 用途: is-date-object・is-regex の依存
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
MIT License

Copyright (c) 2016 Jordan Harband

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### rollup-plugin-node-builtins 2.1.2

- 用途: Node の組み込みの代わり: events・util・inherits・string_decoder・stream・readable-stream (Readable・Writable・Duplex・Transform・PassThrough・BufferList)
- package.json の license: `ISC`
- パッケージに LICENSE ファイルなし。package.json の author: ``、repository: `git@github.com:calvinmetcalf/rollup-plugin-node-builtins.git`

取り込まれたファイルのうち、`src/es6/util.js` の冒頭 (`src/es6/string-decoder.js` も同じ。readable-stream の部分も Node のコードから作られたもの):

```text
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### rollup-plugin-node-globals 1.4.0

- 用途: Node の大域の変数 (process・Buffer) を入れる
- package.json の license: `MIT`
- パッケージに LICENSE ファイルなし。package.json の author: `Calvin Metcalf <calvin.metcalf@gmail.com>`、repository: `git@github.com:calvinmetcalf/rollup-plugin-node-globals.git`

#### process-es6 0.11.6

- 用途: Node の process の代わり (rollup-plugin-node-globals が入れる)
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
(The MIT License)

Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### @babel/helpers 7.10.4

- 用途: Babel の補助関数 (_inheritsLoose・_createClass など。fontkit を Babel で変換したときに入ったもの)
- package.json の license: `MIT`

`LICENSE` (そのまま):

```text
MIT License

Copyright (c) 2014-present Sebastian McKenzie and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### 1.2 pako の Zlib の条文

pako の LICENSE ファイル (上。3.0.3 と 1.0.11 で同じ本文) は MIT の条文です。Zlib の条文は、pako 1.0.11 の `node_modules/pdf-lib/node_modules/pako/lib/zlib/` の constants.js・deflate.js・gzheader.js・inffast.js・inflate.js・inftrees.js・messages.js・trees.js・zstream.js の冒頭に、同じ形で入っています。deflate.js の 3〜20 行目をそのまま転記します。pako 3.0.3 は、同じ zlib の移植を、条文の注釈を除いた 1 つのファイル (`node_modules/pako/dist/pako.mjs`) にまとめて配っています (package.json の license は 1.0.11 と同じ `(MIT AND Zlib)`)。

```text
// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.
```

### 1.3 @pdf-lib/standard-fonts に含まれる Adobe の AFM の Notice

@pdf-lib/standard-fonts は、14 の標準書体の寸法 (AFM) を圧縮したデータを持っています。データを展開したときの、各書体の `Notice` の文言をそのまま引用します。
このデータは、Adobe の 14 の AFM のファイルを JSON の形に変換して圧縮したもので、元の AFM のファイルそのものではありません。

元の AFM に添えられた Adobe の配布条件 (Core 14 AFM Files の ReadMe。`MustRead.html`) は、パッケージの中にはありません。下は、その本文です。
条件のとおり、この文書で AFM のファイルに添えて配布し、上の変換をここに記します。

- 取得元: https://raw.githubusercontent.com/apache/pdfbox/trunk/pdfbox/src/main/resources/org/apache/pdfbox/resources/afm/MustRead.html (Apache PDFBox が AFM のファイルと一緒に収めているもの。取得日 2026-11-08)
- HTML から本文の段落だけを取り出しました (語句は書き換えていません。白い字で書かれた段落の外の語は含めていません)。

```text
This file and the 14 PostScript(R) AFM files it accompanies may be used, copied, and distributed for any purpose and without charge, with or without modification, provided that all copyright notices are retained; that the AFM files are not distributed without this file; that all modifications to this file or any of the AFM files are prominently noted in the modified file(s); and that this paragraph is not modified. Adobe Systems has no responsibility or obligation to support the use of the AFM files.
```

各書体の `Notice` の文言:


- Courier: `Copyright (c) 1989, 1990, 1991, 1992, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.`
- Courier-Bold: `Copyright (c) 1989, 1990, 1991, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.`
- Courier-Oblique: `Copyright (c) 1989, 1990, 1991, 1992, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.`
- Courier-BoldOblique: `Copyright (c) 1989, 1990, 1991, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.`
- Helvetica: `Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.  All Rights Reserved.Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Helvetica-Bold: `Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.  All Rights Reserved.Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Helvetica-Oblique: `Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.  All Rights Reserved.Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Helvetica-BoldOblique: `Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.  All Rights Reserved.Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Times-Roman: `Copyright (c) 1985, 1987, 1989, 1990, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.Times is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Times-Bold: `Copyright (c) 1985, 1987, 1989, 1990, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.Times is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Times-Italic: `Copyright (c) 1985, 1987, 1989, 1990, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.Times is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Times-BoldItalic: `Copyright (c) 1985, 1987, 1989, 1990, 1993, 1997 Adobe Systems Incorporated.  All Rights Reserved.Times is a trademark of Linotype-Hell AG and/or its subsidiaries.`
- Symbol: `Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated. All rights reserved.`
- ZapfDingbats: `Copyright (c) 1985, 1987, 1988, 1989, 1997 Adobe Systems Incorporated. All Rights Reserved.ITC Zapf Dingbats is a registered trademark of International Typeface Corporation.`

### 1.4 hyphen の分綴のパターン

Kumiori が読み込むのは、`hyphen/en-us`・`hyphen/en-gb`・`hyphen/la`・`hyphen/ru`・`hyphen/uk`・`hyphen/el-monoton`・`hyphen/de-1996`・`hyphen/de-1901`・`hyphen/de-ch-1901`・`hyphen/fr`・`hyphen/es`・`hyphen/it`・`hyphen/pt`・`hyphen/nl`・`hyphen/pl`・`hyphen/da`・`hyphen/nb`・`hyphen/fi`・`hyphen/sk`・`hyphen/sl`・`hyphen/hr`・`hyphen/et`・`hyphen/lt`・`hyphen/ga`・`hyphen/cy`・`hyphen/gl`・`hyphen/eu`・`hyphen/bg`・`hyphen/sv`・`hyphen/ca`・`hyphen/is`・`hyphen/tr`・`hyphen/sh-latn`・`hyphen/sh-cyrl`・`hyphen/hu` だけです (`src/hyphenation.ts` の `PATTERNS`)。ライセンスが GPL・LGPL だけのもの (`cs`・`id`・`mk`・`sr-cyrl`・`lv`) と、ライセンスの表示の無いもの (`ro`) は読み込みません。hyphen の README.md (12 行目) には "Patterns for this library were taken from ctan.org and ported to Javascript." とあります (リンクの書式を除いて引用)。npm の hyphen@1.14.1 の `patterns/en-us.js`・`patterns/en-gb.js` には、ライセンスや著作権の表示は入っていません。

下に、上流の hyph-utf8 のパターンのファイルの冒頭の表示を転記します。パターンを取り込んだファイル (ブラウザ向けの配布物と画面の、言語ごとのチャンク) の先頭には、そのパターンの著作権の表示とライセンスの表示 (MIT は許諾の表示の全文、MIT 以外の許諾の表示は上流の表示、LPPL だけのもの (ru・sv・ca・is・tr・sh-latn・sh-cyrl) は LPPL の条件に従う注記、hu は MPL 1.1 の条件に従う注記) を入れています (`src/hyphenationNotices.ts` の `HYPHEN_NOTICES`)。

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-en-us.tex と、同じ場所の hyph-en-gb.tex (master ブランチ。取得日 2026-10-31。コミットは特定していない)
- hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。

#### American English (en-us): `hyph-en-us.tex` の 1〜59 行目 (パターンの前のコメントすべて)

```text
% title: Hyphenation patterns for American English
% copyright: Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: English, American spelling
%     tag: en-us
% version: 2005-05-30
% authors:
%   -
%     name: Gerard D.C. Kuiken
% licence:
%     text: >
%         Copying and distribution of this file, with or without modification,
%         are permitted in any medium without royalty provided the copyright
%         notice and this notice are preserved.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% changes:
%     March 1, 1990 Initial release
%     May 30, 2005 Added copyright notice, no patterns change.
% texlive:
%     encoding: ascii
%     babelname: usenglishmax
%     legacy_patterns: ushyphmax.tex
%     message: Hyphenation patterns for American English
%     package: english
% known_bugs:
%     de-mo-c-rat: 'instead of dem-o-crat (see GitHub issue #15)'
% ==========================================
%
% ushyphmax.tex -- patterns for more hyphenation pattern memory (12000+).
% Also known as ushyphen.max.
%
% Needs extended pattern memory.
% Hyphenation trie becomes 7283 with 377 ops.
%
% These patterns are based on the Hyphenation Exception Log
% published in TUGboat, Volume 10 (1989), No. 3, pp. 337-341,
% and a large number of incorrectly hyphenated words not yet published.
% If added to Liang's before the closing bracket } of \patterns,
% the patterns run errorfree as far as known at this moment.
%
% These patterns find all admissible hyphens of the words in
% the Exception Log.  ushyph2.tex is a smaller set.
%
% Please send bugs or suggestions to tex-live (at) tug.org.
%
% 2005-05-30 (karl): in the past, ushyphmax.tex was a file containing
% only the additional patterns, without the \patterns command, etc.
% This turned out not to be very useful, since in practice the TeX
% distributions need one self-contained file for a language.  Therefore,
% ushyphmax.tex now contains both the additional patterns from
% Dr. Kuiken, and the original patterns and hyphenations from Knuth's
% hyphen.tex.
%
% The Plain TeX hyphenation tables.
```

#### British English (en-gb): `hyph-en-gb.tex` の 1〜77 行目 (パターンの前のコメントすべて)

```text
% title: Hyphenation patterns for British English
% copyright: Copyright (C) 1992, 1996, 2005, 2016 Dominik Wujastyk, Graham Toal
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: English, British spelling
%     tag: en-gb
% authors:
%   -
%     name: Dominik Wujastyk
%     contact: wujastyk (at) gmail.com
%   -
%     name: Graham Toal
% licence:
%     name: MIT
%     url: https://opensource.org/licenses/MIT
%     text: >
%           Permission is hereby granted, free of charge, to any person
%           obtaining a copy of this software and associated documentation
%           files (the “Software”), to deal in the Software without
%           restriction, including without limitation the rights to use,
%           copy, modify, merge, publish, distribute, sublicense, and/or
%           sell copies of the Software, and to permit persons to whom the
%           Software is furnished to do so, subject to the following
%           conditions:
%
%           The above copyright notice and this permission notice shall be
%           included in all copies or substantial portions of the Software.
%
%           THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%           EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%           OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%           NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%           HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%           WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%           FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%           OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% changes:
%     - Version 1.0  Released 17 April 1992.
%     - Revision 2.0  1996/09/10 15:04:04  ucgadkw
%       o  added list of hyphenation exceptions at the end of this file.
%     - Version 1.0a.  Released 18th October 2005/PT.
% texlive:
%     synonyms:
%         - british
%         - UKenglish
%     encoding: ascii
%     babelname: ukenglish
%     legacy_patterns: ukhyphen.tex
%     message: Hyphenation patterns for British English
%     package: english
% ==========================================
% This file has been renamed from ukhyphen.tex to hyph-en-gb.tex in June 2008
% for consistency with other files with hyphenation patterns in hyph-utf8 package.
% No other changes made. See http://www.hyphenation.org/tex for more details.
%
% Created by Dominik Wujastyk and Graham Toal using Frank Liang's PATGEN 1.0.
% Like the US patterns, these UK patterns correctly hyphenate about 90% of
% the words in the input list, and produce no hyphens not in the list
% (see TeXbook pp. 451--2).
%
% These patterns are based on a file of 114925 British-hyphenated words
% generously made available to Dominik Wujastyk by Oxford University Press.
% This list of words is copyright to the OUP and may not be redistributed.
% The hyphenation break points in the words in the abovementioned file is
% also copyright to the OUP.
%
% We are very grateful to Oxford University Press for allowing us to use
% their list of hyphenated words to produce the following TeX hyphenation
% patterns.  This file of hyphenation patterns may be freely distributed.
%
% These patterns require a value of about 14000 for TeX's pattern memory size.
%
```

#### Latin (la): `hyph-la.tex` の 1〜162 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-la.tex (master ブランチ。取得日 2026-11-04。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/la.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。

```text
% title: Hyphenation patterns for modern and medieval Latin
% copyright: Copyright (C) 1999-2016 Claudio Beccari
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Latin
%     tag: la
% version: 3.201 2016-08-28
% authors:
%   -
%     name: Claudio Beccari
%     contact: claudio.beccari (at) gmail.com
% licence:
%     - This file is available under any of the following licences:
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the “Software”), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
%     -
%         name: LPPL
%         version: 1
%         or_later: true
%         url: https://latex-project.org/lppl/
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     -
%         date: 1999
%         version: 1.0
%         author: Claudio Beccari
%         description: First public release
%     -
%         date: 2007-04-16
%         version: 3.1
%         author: Claudio Beccari
%     -
%         date: 2010-05-31
%         author: Claudio Beccari
%         description: Removal of OT1 support
%     -
%         date: 2010-06-01
%         version: 3.2
%         author: Claudio Beccari
%         description: Removal of pattern 2'2
%     -
%         date: 2014-06-04
%         version: 3.2a
%     -
%         date: 2016-08-28
%         version: 3.201
%         author: Claudio Beccari
%         description: updated header with MIT licence notice;
%                   added few missing patterns
% texlive:
%     encoding: ec
%     babelname: latin
%     legacy_patterns: lahyph.tex
%     message: Latin hyphenation patterns
%     package: latin
%
% ==========================================
% Patterns for the latin language mainly in modern spelling
% (u when u is needed and v when v is needed); medieval spelling
% with the ligatures æ and œ and the (uncial) lowercase ‘v’
% written as a ‘u’ is also supported; apparently there is no conflict
% between the patterns of modern  Latin and those of medieval Latin.
%
% For more information please read the babel-latin documentation.
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%  For documentation see:
%  C. Beccari, “Computer aided hyphenation for Italian and Modern
%        Latin”, TUG vol. 13, n. 1, pp. 23-33 (1992)
%
%  see also
%
%  C. Beccari, “Typesetting of ancient languages”,
%              TUG vol.15, n.1, pp. 9-16 (1994)
%
%  In the former paper  the  code  was  described  as  being contained in file
%  ITALAT.TEX; this is substantially the same code,  but  the  file  has  been
%  renamed and included in hyph-utf8.
%
%  A corresponding file (ITHYPH.TEX) has been extracted in order to  eliminate
%  the  (few)  patterns specific to Latin and leave those specific to Italian;
%  ITHYPH.TEX has been further  extended  with  many  new patterns in order to
%  cope with the many neologisms and technical terms with foreign roots.
%
%  Should you find any word that gets hyphenated in a wrong way, please, AFTER
%  CHECKING  ON A RELIABLE MODERN DICTIONARY, report to the author, preferably
%  by e-mail.  Please  do  not  report  about  wrong  break  points concerning
%  prefixes and/or suffixes; see at the bottom of this file.
%
%  Compared with the previous versions, this file has been extended so  as  to
%  cope also with the medieval Latin spelling, where the letter ‘V’ played the
%  roles of both ‘U’ and ‘V’, as in the Roman times, save that the Romans used
%  only capitals. In the middle ages the availability of soft writing supports
%  and the necessity of copying books with a reasonable speed, several scripts
%  evolved  in  (practically)  all  of  which  there was a lower case alphabet
%  different from the upper case  one,  and  where  the lower case ‘v’ had the
%  rounded shape of our modern lower case ‘u’, and where the Latin  diphthongs
%  ‘Æ’  and  ‘Œ’,  both  in  upper and lower case, where written as ligatures,
%  not to mention the habit of  substituting  them with their sound, that is a
%  simple ‘E'.
%
%  According  to  Leon  Battista  Alberti,  who  in  1466  wrote  a  book   on
%  cryptography  where  he  thoroughly  analyzed  the hyphenation of the Latin
%  language of his (still  medieval)  times,  the  differences from the Tuscan
%  language (the Italian language, as it was named  at  his  time)  were  very
%  limited,  in particular for what concerns the handling of the ascending and
%  descending diphthongs; in  Central  and  Northern  Europe,  and later on in
%  North America, the Scholars perceived the above diphthongs as made  of  two
%  distinct  vowels;  the  hyphenation of medieval Latin, therefore, was quite
%  different in the northern countries compared to the southern ones, at least
%  for what concerns these  diphthongs.  If  you need hyphenation patterns for
%  medieval Latin that suite you better according to the  habits  of  Northern
%  Europe  you  should  resort  to the hyphenation patterns prepared by Yannis
%  Haralambous (TUGboat, vol.13 n.4 (1992)).
%
%
%
%                            PREFIXES AND SUFFIXES
%
% For what concerns prefixes and suffixes, the latter are generally  separated
% according  to  “natural”  syllabification,  while  the  former are generally
% divided etimologically. In order to  avoid  an excessive number of patterns,
% care has been paid to some prefixes,  especially  “ex”,  “trans”,  “circum”,
% “prae”,  but  this set of patterns is NOT capable of separating the prefixes
% in all circumstances.
%
%                         BABEL SHORTCUTS AND FACILITIES
%
% Read  the  documentation  coming  with the discription of the Latin language
% interface of  Babel  in  order  to  see  the  shortcuts  and  the facilities
% introduced in order to facilitate the insertion  of  “compound  word  marks”
% which are very useful for inserting etymological break points.
%
% Happy Latin and multilingual typesetting!
%
```

#### Russian (ru): `hyph-ru.tex` の 1〜44 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-ru.tex (master ブランチ。取得日 2026-11-10。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/ru.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL (LaTeX Project Public License) 1.2 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布します (本文: https://latex-project.org/lppl/lppl-1-3c.txt )。LPPL 1.3c の「Conditions on Distribution and Modification」の、変更したもの (Derived Work) を配る条件 (第 6 項) に、次のように従います。
  - **配るもの**: 上流のパターン (`hyph-ru.tex`) を、npm の hyphen が JavaScript のデータ (同じパターンを表す配列) に変換したもの (hyphen@1.14.1 の `patterns/ru.js`)。Kumiori は、これをビルドで 1 つのファイル (チャンク) にまとめ、ビルドによっては縮めます。パターンの中身は変えていません。元のファイルの TeX のコメントは入りません。これを取り込んだファイルが入るのは、ブラウザ向けの配布物 (`dist-browser/chunks/ru-*.js`) と画面 (`dist/assets/ru-*.js`) です。Node のコマンド (`dist-cli/`) とライブラリ (`dist-lib/`) は、hyphen を外部の依存として読み込むので、パターンを含みません。
  - **第 6 項 a** (元の部品の代わりに使える部品は、変更したものと名乗る): JavaScript に変換したものは、LaTeX などの上で元の `hyph-ru.tex` の代わりに使える部品ではないので、当たりません。
  - **第 6 項 b** (変更の内容を、部品ごとに目立つように書く): パターンを取り込んだファイルの先頭に、変更したものであることと変更の内容 (上の「配るもの」) を英語で書いています (`src/hyphenationNotices.ts` の `HYPHEN_NOTICES`)。この節にも書いています。
  - **第 6 項 c** (元の作者などがサポートするかのように書かない): 元のパターンの作者・保守者は、この変換したものをサポートしません。不具合は Kumiori へ報告してください。
  - **第 6 項 d** (元の Work の写しか、入手に十分な情報を付ける): 変更していない元のファイルは、hyph-utf8 パッケージ (https://ctan.org/pkg/hyph-utf8 の `tex/generic/hyph-utf8/patterns/tex/hyph-ru.tex`) と、上の取得元 (https://github.com/hyphenation/tex-hyphen ) から入手できます。
  - LPPL 1.3c に、ライセンスの本文の写しを配布物に付けることを求める項はありません (第 1〜12 項を確かめました)。本文は上の URL にあります。

```text
% title: Hyphenation patterns for Russian
% copyright: Copyright (C) 1999-2003 Alexander I. Lebedev
% notice:
%     This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Russian
%     tag: ru
% version: 2003/03/10
% authors:
%     -
%         name: Alexander I. Lebedev
%         contact: swan (at) scon155.phys.msu.su
% licence:
%     name: LPPL
%     version: 1.2
%     or_later: true
%     url: https://latex-project.org/lppl/
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     encoding: t2a
%     babelname: russian
%     use_old_patterns_comment: The old system allows choosing patterns and encodings manually. That mechanism needs to be implemented first in this package, so we still fall back on old system.
%     legacy_patterns: ruhyphen.tex
%     message: Russian hyphenation patterns
%     description: |-
%         Hyphenation patterns for Russian in T2A and UTF-8 encodings.
%         For 8-bit engines, the 'ruhyphen' package provides a number of
%         different pattern sets, as well as different (8-bit) encodings, that
%         can be chosen at format-generation time.  The UTF-8 version only
%         provides the default pattern set.  A mechanism similar to the one used
%         for 8-bit patterns may be implemented in the future.
% ==========================================
% Patterns were generated with patgen from a 990,000-word list and then
% manually corrected.
%
% The program consists of the files ruhyphal.tex, cyryoal.tex and two
% document files README.ruhyphal and hyphen.rules.  The file cyryoal.tex
% can be regenerated using mkcyryo script (a part of ruhyphen package)
% and the latest release of rus-ispell dictionaries
% <ftp://scon155.phys.msu.su/pub/russian/ispell/>.
```

#### Ukrainian (uk): `hyph-uk.tex` の 1〜38 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-uk.tex (master ブランチ。取得日 2026-11-10。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/uk.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT か LPPL のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Ukrainian
% copyright: Copyright (C) 1998-2001 Maksym Polyakov
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Ukrainian
%     tag: uk
% version: 2001/05/10
% authors:
%   -
%     name: Maksym Polyakov
%     contact: polyama (at) auburn.edu, mpoliak (at) i.com.ua
% licence:
%     - This file is available under any of the following licences:
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%     -
%         name: LPPL
%         url: https://latex-project.org/lppl/
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     encoding: t2a
%     babelname: ukrainian
%     use_old_patterns_comment: The old system allows choosing patterns and encodings manually. That mechanism needs to be implemented first in this package, so we still fall back on old system.
%     legacy_patterns: ukrhyph.tex
%     message: Ukrainian hyphenation patterns
%     description: |-
%         Hyphenation patterns for Ukrainian in T2A and UTF-8 encodings.
%         For 8-bit engines, the 'ukrhyph' package provides a number of
%         different pattern sets, as well as different (8-bit) encodings, that
%         can be chosen at format-generation time.  The UTF-8 version only
%         provides the default pattern set.  A mechanism similar to the one used
%         for 8-bit patterns may be implemented in the future.
%
```

```text
MIT License

Copyright (C) 1998-2001 Maksym Polyakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### Modern Greek, monotonic (el-monoton): `hyph-el-monoton.tex` の 1〜52 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-el-monoton.tex (master ブランチ。取得日 2026-11-10。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/el-monoton.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。`lang` が `el` の文に使います (多調の綴り el-polyton・古典ギリシャ語 grc のパターンは読み込みません)。

```text
% title: Hyphenation patterns for Modern Greek, monotonic
% copyright: Copyright (C) 2008-2011 Dimitrios Filippou
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Modern Greek, monotonic spelling
%     tag: el-monoton
% version: 5.0
% authors:
%   -
%     name: Dimitrios Filippou
%     contact: dimitrios.ap.filippou (at) gmail.com
% licence:
%     - This file is available under any of the following licences:
%     -
%         name: LPPL
%         url: https://latex-project.org/lppl/
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
% hyphenmins:
%     typesetting:
%         left: 1
%         right: 1
% changes:
%     - Created:       June 6, 2008
%     - Last modified: Sept. 12, 2011
% texlive:
%     babelname: monogreek
%     use_old_patterns_comment: Old patterns work in a different way, one-to-one conversion from UTF-8 is not possible.
%     legacy_patterns: grmhyph5.tex
%     message: Hyphenation patterns for uni-accent (monotonic) Modern Greek
%     package: greek
% ==========================================
% This file was first created by mechanical translation from
% GRMhyph5.tex via "elhyph-utf8 -m -c" (version 0.1 by Peter
% Heslin -- p.j.heslin at durham dot ac dot uk). Some additions
% were also made by hand.
%
% Created by Dimitrios Filippou with some ideas borrowed from
% Yannis Haralambous, Kostis Dryllerakis and Claudio Beccari.
% Mojca Miklavec adapted it for the "hyph-utf8" package.
%
% These hyphenation patterns are explained in "modern.pdf", which
% can be found in the "elhyphen" or "hyphenation-greek" package.
%
% Documentation in English can be found in: D. Filippou,
% "Hyphenation patterns for Ancient and Modern Greek," in
% "TeX, XML, and Digital Typography" (A. Syropoulos et al.,
% eds.), Lecture Notes in Computer Science 3130, Springer-Verlag
% Berlin-Heidelberg, 2004. ISBN 3-540-22801-2.
%
```

```text
MIT License

Copyright (C) 2008-2011 Dimitrios Filippou

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### German, reformed spelling (de-1996): `hyph-de-1996.tex` の 1〜64 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-de-1996.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/de-1996.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。`lang` が `de` の文 (異形 `1901` の無いもの。スイスの `de-CH` も) に使います。

```text
% title: German Hyphenation Patterns (Reformed Orthography, 2006)
%
% notice: TeX-Trennmuster für die reformierte (2006) deutsche Rechtschreibung
%
% version: 2024-02-28
%
% authors:
%   -
%     name:    Deutschsprachige Trennmustermannschaft
%     contact: trennmuster@dante.de
%
% copyright: Copyright (c) 2013-2024
%            Stephan Hennig, Werner Lemberg, Günter Milde,
%            Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke,
%            Tobias Wendorf, Keno Wehr
%
% licence:
%     name: MIT
%     url:  https://opensource.org/licenses/mit-license.php
%     text: >
%           Permission is hereby granted, free of charge, to any person
%           obtaining a copy of this software and associated documentation
%           files (the “Software”), to deal in the Software without
%           restriction, including without limitation the rights to use,
%           copy, modify, merge, publish, distribute, sublicense, and/or
%           sell copies of the Software, and to permit persons to whom the
%           Software is furnished to do so, subject to the following
%           conditions:
%
%           The above copyright notice and this permission notice shall be
%           included in all copies or substantial portions of the Software.
%
%           THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%           EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%           OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%           NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%           HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%           WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%           FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%           OTHER DEALINGS IN THE SOFTWARE.
%
% source: https://repo.or.cz/w/wortliste.git?a=commit;h=304aaa2188a75e57afe36bad0443d90a9c715b8e
%
% language:
%     name: German, reformed spelling
%     tag:  de-1996
%
% hyphenmins:
%     generation:
%         left:  2
%         right: 2
%     typesetting:
%         left:  2
%         right: 2
%
% texlive:
%     encoding: ec
%     babelname: ngerman
%     use_old_patterns_comment: Kept for the sake of backward compatibility, but newer and better patterns by WL are available.
%     legacy_patterns: dehyphn.tex
%     message: German hyphenation patterns (reformed orthography)
%     package: german
%
% ===========================================================================
```

#### German, traditional spelling (de-1901): `hyph-de-1901.tex` の 1〜64 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-de-1901.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/de-1901.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。`lang` が `de-1901` の文 (スイス・リヒテンシュタインのほか) に使います。

```text
% title: German Hyphenation Patterns (Traditional Orthography)
%
% notice: TeX-Trennmuster für die traditionelle deutsche Rechtschreibung
%
% version: 2024-02-28
%
% authors:
%   -
%     name:    Deutschsprachige Trennmustermannschaft
%     contact: trennmuster@dante.de
%
% copyright: Copyright (c) 2013-2024
%            Stephan Hennig, Werner Lemberg, Günter Milde,
%            Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke,
%            Tobias Wendorf, Keno Wehr
%
% licence:
%     name: MIT
%     url:  https://opensource.org/licenses/mit-license.php
%     text: >
%           Permission is hereby granted, free of charge, to any person
%           obtaining a copy of this software and associated documentation
%           files (the “Software”), to deal in the Software without
%           restriction, including without limitation the rights to use,
%           copy, modify, merge, publish, distribute, sublicense, and/or
%           sell copies of the Software, and to permit persons to whom the
%           Software is furnished to do so, subject to the following
%           conditions:
%
%           The above copyright notice and this permission notice shall be
%           included in all copies or substantial portions of the Software.
%
%           THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%           EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%           OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%           NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%           HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%           WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%           FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%           OTHER DEALINGS IN THE SOFTWARE.
%
% source: https://repo.or.cz/w/wortliste.git?a=commit;h=304aaa2188a75e57afe36bad0443d90a9c715b8e
%
% language:
%     name: German, traditional spelling
%     tag:  de-1901
%
% hyphenmins:
%     generation:
%         left:  2
%         right: 2
%     typesetting:
%         left:  2
%         right: 2
%
% texlive:
%     encoding: ec
%     use_old_patterns_comment: Kept for the sake of backward compatibility, but newer and better patterns by WL are available.
%     babelname: german
%     legacy_patterns: dehypht.tex
%     message: German hyphenation patterns (traditional orthography)
%     package: german
%
% ===========================================================================
```

#### German, traditional Swiss spelling (de-ch-1901): `hyph-de-ch-1901.tex` の 1〜62 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-de-ch-1901.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/de-ch-1901.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。`lang` が `de-CH-1901`・`de-LI-1901` の文に使います。

```text
% title: Swiss-German Hyphenation Patterns (Traditional Orthography)
%
% notice: TeX-Trennmuster für die traditionelle deutsch-schweizerische Rechtschreibung
%
% version: 2024-02-28
%
% authors:
%   -
%     name:    Deutschsprachige Trennmustermannschaft
%     contact: trennmuster@dante.de
%
% copyright: Copyright (c) 2013-2024
%            Stephan Hennig, Werner Lemberg, Günter Milde,
%            Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke,
%            Tobias Wendorf, Keno Wehr
%
% licence:
%     name: MIT
%     url:  https://opensource.org/licenses/mit-license.php
%     text: >
%           Permission is hereby granted, free of charge, to any person
%           obtaining a copy of this software and associated documentation
%           files (the “Software”), to deal in the Software without
%           restriction, including without limitation the rights to use,
%           copy, modify, merge, publish, distribute, sublicense, and/or
%           sell copies of the Software, and to permit persons to whom the
%           Software is furnished to do so, subject to the following
%           conditions:
%
%           The above copyright notice and this permission notice shall be
%           included in all copies or substantial portions of the Software.
%
%           THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%           EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%           OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%           NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%           HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%           WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%           FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%           OTHER DEALINGS IN THE SOFTWARE.
%
% source: https://repo.or.cz/w/wortliste.git?a=commit;h=304aaa2188a75e57afe36bad0443d90a9c715b8e
%
% language:
%     name: German, traditional Swiss spelling
%     tag:  de-CH-1901
%
% hyphenmins:
%     generation:
%         left:  2
%         right: 2
%     typesetting:
%         left:  2
%         right: 2
%
% texlive:
%     encoding: ec
%     babelname: swissgerman
%     message: Swiss-German hyphenation patterns (traditional orthography)
%     package: german
%
% ===========================================================================
```

#### French (fr): `hyph-fr.tex` の 1〜71 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-fr.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/fr.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。

```text
% title: Hyphenation patterns for French
% copyright: Copyright (C) 1994-2002 Daniel Flipo, Bernard Gaulle, 2016 Arthur Reutenauer
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: French
%     tag: fr
% version: V2.13 2016/05/12
% authors:
%     -
%         name: Daniel Flipo
%     -
%         name: Bernard Gaulle
%         note: deceased
%     -
%         name: Arthur Reutenauer
%         contact: arthur (at) reutenauer.eu
%     -
%         email: cesure-l (at) gutenberg (dot} eu (dot) org
% licence:
%     name: MIT
%     url: https://opensource.org/licenses/MIT
%     text: >
%         Permission is hereby granted, free of charge, to any person obtaining
%         a copy of this software and associated documentation files (the
%         "Software"), to deal in the Software without restriction, including
%         without limitation the rights to use, copy, modify, merge, publish,
%         distribute, sublicense, and/or sell copies of the Software, and to
%         permit persons to whom the Software is furnished to do so, subject to
%         the following conditions:
%
%         The above copyright notice and this permission notice shall be
%         included in all copies or substantial portions of the Software.
%
%         THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%         EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
%         MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%         NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
%         BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
%         ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
%         CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
%         SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     synonyms:
%         - patois
%         - francais
%     encoding: ec
%     babelname: french
%     legacy_patterns: frhyph.tex
%     message: French hyphenation patterns
%     description: Hyphenation patterns for French in T1/EC and UTF-8 encodings.
% ==========================================
%%%%%%%% The most famous good guys who worked hard to obtain something usable.
% Jacques Desarmenien, Universite de Strasbourg :
%          -  << how to run TeX in a French environment: hyphenation, fonts,
%             typography. >> in Tugboat, 5 (1984) 91-102. and TeX85 conference
%          -  << La division par ordinateur des mots francais :
%             application a TeX >> in TSI vol. 5 No 4, 1986 (C) AFCET-
%                                                             Gauthier-Villars
% Norman Buckle, UQAH (nb; many additions)
% Michael Ferguson, INRS-Telecommunications (mjf) June 1988
% Justin Bur, Universite de Montreal (jbb; checked against original list)
%                    all patterns including apostrophe missing from nb list
% after that, GUTenberg  and specially Daniel Flipo and Bernard Gaulle
% did their best effort to improve the list of patterns.
%
%
```

#### Spanish (es): `hyph-es.tex` の 1〜61 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-es.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/es.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。

```text
% copyright: Copyright (C) 1993, 1997 Javier Bezos, 2001-2019 Javier Bezos, CervanTeX
% title: Hyphenation patterns for Spanish
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Spanish
%     tag: es
% version: 5.0 2019-09-24
% authors:
%   -
%     name: Javier Bezos
% licence:
%     name: MIT/X11
%     url: https://opensource.org/licenses/MIT
%     text: >
%         Permission is hereby granted, free of charge, to any person obtaining a copy
%         of this software and associated documentation files (the "Software"), to deal
%         in the Software without restriction, including without limitation the rights
%         to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
%         copies of the Software, and to permit persons to whom the Software is
%         furnished to do so, subject to the following conditions:
%
%         The above copyright notice and this permission notice shall be included in
%         all copies or substantial portions of the Software.
%
%         THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
%         IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
%         FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
%         AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
%         LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
%         OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
%         SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     synonyms:
%         - espanol
%     encoding: ec
%     babelname: spanish
%     legacy_patterns: eshyph.tex
%     message: Spanish hyphenation patterns
%     description: Hyphenation patterns for Spanish in T1/EC and UTF-8 encodings.
% ==========================================
%
% For further info, bug reports and comments:
%
%       https://github.com/jbezos/tex-hyphen-spanish
%
% I would like to thanks Francesc Carmona for his permission
% to steal parts of his work without restrictions. For his
% patterns, (c) by Francesc Carmona
%
%
%
% _____________________________________________________________
% Javier Bezos                | http://www.cervantex.es/
% .............................................................
% TeX y tipografia            | http://www.texnia.com/
%
```

#### Italian (it): `hyph-it.tex` の 1〜73 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-it.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/it.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Italian
% copyright: Copyright (C) 2008-2011 Claudio Beccari
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Italian
%     tag: it
% version: 4.9 2014/04/22
% authors:
%   -
%     name: Claudio Beccari
%     contact: claudio.beccari (at) gmail.com
% licence:
%     - This file is available under any of the following licences:
%     -
%         name: LPPL
%         version: 1.3
%         or_later: true
%         url: http://www.latex-project.org/lppl.txt
%         status: maintained
%         maintainer: Claudio Beccari, e-mail claudio dot beccari at gmail dot com
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - 2014-04-22 - Add few patterns involving `h'
%     - 2011-08-16 - Change the licence from GNU LGPL into LPPL v1.3.
%     - 2010-05-24 - Fix for Italian patterns for proper hyphenation of -ich and Ljubljana.
%     - 2008-06-09 - Import of original ithyph.tex into hyph-utf8 package.
%     - 2008-03-08 - (last change in ithyph.tex)
% texlive:
%     encoding: ascii
%     babelname: italian
%     legacy_patterns: ithyph.tex
%     message: Italian hyphenation patterns
%     description: |-
%         Hyphenation patterns for Italian in ASCII encoding.
%         Compliant with the Recommendation UNI 6461 on hyphenation
%         issued by the Italian Standards Institution
%         (Ente Nazionale di Unificazione UNI).
% ==========================================
%
% These hyphenation patterns for the Italian language are supposed to comply
% with the Recommendation UNI 6461 on hyphenation issued by the Italian
% Standards Institution (Ente Nazionale di Unificazione UNI).  No guarantee
% or declaration of fitness to any particular purpose is given and any
% liability is disclaimed.
%
```

#### Portuguese (pt): `hyph-pt.tex` の 1〜70 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-pt.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/pt.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは BSD 3 条項 (下の表示の licence の欄に本文)。`pt-BR`・`pt-PT` とも、このパターンを使います。

```text
% title: Hyphenation patterns for Portuguese
% copyright: Copyright (C) 1987, 1994, 1996, 2015 Pedro J. de Rezende, 1996, 2015 J. Joao Dias Almeida, 2024 Leonardo Araujo and Aline Benevides
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Portuguese
%     tag: pt
% version: 1.4 2024-07-13
% authors:
%   -
%     name: Pedro J. de Rezende
%     contact: rezende (at) ic.unicamp.br
%   -
%     name: J. Joao Dias Almeida
%     contact: jj (at) di.uminho.pt
%   -
%     name: Leonardo Araujo
%     contact: leolca (at) gmail.com
%   -
%     name: Aline Benevides
%     contact: benevides.aline12 (at) gmail.com
% licence:
%     name: BSD 3-clause licence
%     url: https://opensource.org/licenses/BSD-3-Clause
%     text: >
%         Redistribution and use in source and binary forms, with or without
%         modification, are permitted provided that the following conditions
%         are met:
%         * Redistributions of source code must retain the above copyright
%           notice, this list of conditions and the following disclaimer.
%         * Redistributions in binary form must reproduce the above copyright
%           notice, this list of conditions and the following disclaimer in the
%           documentation and/or other materials provided with the
%           distribution.
%         * Neither the name of the University of Campinas, of the University
%           of Minho nor the names of its contributors may be used to endorse
%           or promote products derived from this software without specific
%           prior written permission.
% 
%         THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
%         "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
%         LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
%         A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL PEDRO J. DE
%         REZENDE OR J.JOAO DIAS ALMEIDA BE LIABLE FOR ANY DIRECT, INDIRECT,
%         INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
%         BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
%         OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
%         AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
%         LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
%         WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
%         POSSIBILITY OF SUCH DAMAGE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% changes:
%     - Version 1.4 Release date: 13/07/2024 Leonardo Araujo and Aline Benevides
%     - Version 1.3 Release date: 12/08/2015 Pedro J. de Rezende and J. Joao Dias Almeida
%     - Version 1.2 Release date: 07/21/1996 Pedro J. de Rezende and J. Joao Dias Almeida
%     - Version 1.1 Release date: 04/12/1994 Pedro J. de Rezende
%     - Version 1.0 Release date: 02/13/1987 Pedro J. de Rezende
% texlive:
%     synonyms:
%         - portuges
%     encoding: ec
%     babelname: portuguese
%     legacy_patterns: pthyph.tex
%     message: Portuguese hyphenation patterns
%     description: Hyphenation patterns for Portuguese in T1/EC and UTF-8 encodings.
%
```

#### Dutch (nl): `hyph-nl.tex` の 1〜57 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-nl.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/nl.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄。表示に本文が無いので、MIT の本文を下に添えます)。

```text
% title: Hyphenation patterns for Dutch
% copyright: Copyright (C) 1996 Piet Tutelaers
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Dutch
%     tag: nl
% version: 1.1 (November 1996)
% licence:
%     name: MIT
%     url: https://opensource.org/licenses/MIT
% authors:
%     -
%         name: Piet Tutelaers
%         contact: P.T.H.Tutelaers (at) tue.nl
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - Version 1.1 November 1996
%     - Copyright changed March 2000
% texlive:
%     encoding: ec
%     babelname: dutch
%     legacy_patterns: nehyph96.tex
%     message: Dutch hyphenation patterns
%     description: |-
%         Hyphenation patterns for Dutch in T1/EC and UTF-8 encodings.
%         These patterns don't handle cases like 'menuutje' > 'menu-tje',
%         and don't hyphenate words that have different hyphenations according
%         to their meaning.
% known_bugs:
%     xi-ii: 'when we’d expect xiii for a roman number (see GitHub issue #29)'
% ==========================================
% PURPOSE: 8-bit hyphenation patterns for TeX based upon the new Dutch
%          spelling, officially since 1 August 1996. These patterns follow
%          the new hyphenation rules in the ‘Woordenlijst Nederlandse
%          Taal, SDU Uitgevers, Den Haag 1995’ (the so called ‘Groene
%          Boekje’) described in section 5.2 (Het afbreekteken).
%
%          The main differences with our earlier patterns based upon the
%          CELEX dictionary are:
%           (1) provide 8-bit patterns based upon the T1 character encoding
%               (the encoding for DC/EC compatible TeX fonts)
%           (2) don’t hyphenate if this results in a syllable of one letter
%               before or after the hyphen (hence hyphens in a-drenaline,
%               studi-o, mensa-pen and vide-oachtig are invalid)
%           (3) handle words derived from other languages (‘bastaard
%               woorden’) according to the new rules
%
%          Like the CELEX patterns these patterns don’t hyphenate:
%           (4) in a changing syllable (menuutje can not be hyphenated as
%               menu-tje)
%           (5) in words that have different hyphenations according to
%               there meaning (buur-tje/buurt-je)
%
```

```text
MIT License

Copyright (C) 1996 Piet Tutelaers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### Polish (pl): `hyph-pl.tex` の 1〜77 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-pl.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/pl.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT か、TeX の作者の条件の public domain のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Polish
% copyright: Copyright (C) 1987-1995 Hanna Kołodziejska, Bogusław Jackowski, Marek Ryćko
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Polish
%     tag: pl
% version: 3.0a, Wednesday, May 17th, 1995
% authors:
%   -
%     name: Hanna Kołodziejska
%   -
%     name: Bogusław Jackowski
%     contact: b_jackowski (at) gust.org.pl
%   -
%     name: Marek Ryćko
%     contact: marek (at) do.com.pl
% licence:
%     - This file is made available under any of the following licences:
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the “Software”), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
%     - text: >
%         This macro file belongs to the public domain
%         under the conditions specified by the author of TeX:
%
%            “Macro files like PLAIN.TEX should not be changed in any way,
%             except with respect to preloaded fonts,
%             unless the changes are authorized by the authors of the macros.”
%
%                                                   Donald E. Knuth
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - The first version of the patterns was developed
%           by Hanna Kołodziejska (1987).
%     - The adaptation to the LeX format (see below) and extensive modification
%           were done by Bogusław Jackowski & Marek Ryćko (1987--1989).
%     - The hyphenation rules were further improved and adapted to the
%           TeX 3.x requirements by Hanna Kołodziejska (1991).
%     - Lone-standing version (3.0a) of patterns was prepared (under pressure
%           from LaTeX users) by Bogusław Jackowski and Marek Ryćko, following
%           Mariusz Olko's suggestions, 1995.
%     - The LeX format mentioned above was the first version of the adaptation
%           of TeX to the Polish language. The next version is called MeX.
% texlive:
%     encoding: qx
%     babelname: polish
%     legacy_patterns: plhyph.tex
%     message: Polish hyphenation patterns
%     description: |-
%         Hyphenation patterns for Polish in QX and UTF-8 encodings.
%         These patterns are also used by Polish TeX formats MeX and LaMeX.
%
```

#### Danish (da): `hyph-da.tex` の 1〜56 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-da.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/da.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Danish
% copyright: Copyright (C) 1994 Frank Jensen
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Danish
%     tag: da
% version: 2011-01-11
% authors:
%   -
%     name: Frank Jensen
%     contact: frank.jensen (at) hugin.com
% licence:
%     - This file is available under any of these licences:
%     -
%         name: LPPL
%         version: 1.3
%         or_later: true
%         url: http://www.latex-project.org/lppl/lppl-1-3.html
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - 2011-01-11 - remove support for OT1 encoding
% texlive:
%     encoding: ec
%     babelname: danish
%     legacy_patterns: dkhyph.tex
%     message: Danish hyphenation patterns
%     description: Hyphenation patterns for Danish in T1/EC and UTF-8 encodings.
%
```

#### Norwegian Bokmål, bokmål, norsk bokmål (nb): `hyph-nb.tex` の 1〜43 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-nb.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/nb.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは、著作権の表示とこの表示を残せば複製・配布してよいという表示 (下の表示の licence の欄)。`hyph-nb.tex` はパターンを `hyph-no.tex` から読むので、その冒頭の表示も下に写します。hyphen@1.14.1 の `patterns/nb.js`・`nn.js`・`no.js` は並びが違うだけで同じパターンなので、`lang` が `nb`・`nn`・`no` の文に、`patterns/nb.js` を使います。

```text
% title: Hyphenation patterns for Norwegian, bokmål
% copyright: Copyright (C) 2004–2005 Rune Kleveland, Ole Michael Selberg, 2007 Karl Ove Hufthammer
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Norwegian Bokmål, bokmål, norsk bokmål
%     tag: nb
% authors:
%     - name: Rune Kleveland
%     - name: Ole Michael Selberg
%     - name: Karl Ove HuftHammer
% version: 2007-02-10
% licence:
%     text: >
%         Copying and distribution of this file, with or without modification,
%         are permitted in any medium without royalty, provided the copyright
%         notice and this notice are preserved.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     synonyms:
%         - norwegian
%         - norsk
%     encoding: ec
%     babelname: bokmal
%     message: Norwegian Bokmal hyphenation patterns
%     package: norwegian
% ==========================================
% This file contains hyphenation patterns for Norwegian Bokmål.
% It uses the Norwegian hyphenation patterns from hyph-no.tex,
% created by Rune Kleveland and Ole Michael Selberg. Please see
% that file for copyright information on those patterns.
%
% The patterns in hyph-no.tex are based on both Norwegian Bokmål
% and Norwegian Nynorsk, and works about equally well for both
% languages. This file, hyph-nb.tex, contains only a few hyphenation
% exceptions, for words that needs to be hyphenated differently for
% the two languages.
%
% Please send bugs or suggestions to karl@huftis.org.
%
```

#### Norwegian, norsk (no): `hyph-no.tex` の 1〜62 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-no.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- `hyph-nb.tex` が読み込むパターンのファイル (上の nb の項)。ライセンスは、著作権の表示とこの表示を残せば複製・配布してよいという表示 (下の表示の licence の欄)。

```text
% title: Hyphenation patterns for Norwegian
% copyright: Copyright (C) 2004, 2005 Rune Kleveland, Ole Michael Selberg
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Norwegian, norsk
%     tag: "no"
% version: 2012-05-18
%     Patterns of January 25, 2005, with later additions and changes
% authors:
%     - name: Rune Kleveland
%     - name: Ole Michael Selberg
% licence:
%     - text: >
%         Copying and distribution of this file, with or without modification,
%         is permitted in any medium without royalty provided the copyright
%         notice and this notice are preserved.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     use_old_loader: true
%     message: Norwegian hyphenation patterns
% ==========================================
% The following was written when this file was called nohyphbx.tex: [AR, 2016-05-21]
%
% Please send bugs or suggestions to tex-live (at) tug.org.
%
% Based on nohyphb.tex, originally generated by a script
% written by Rune Kleveland from dictionaries available from
% http://folk.uio.no/runekl/dictionary.html.
%
% Renamed nohyphbx.tex and adjusted manually by Ole Michael Selberg
% to prevent numerous wrong hyphenations, especially in compounds.
%
% In Kleveland's nohyphb.tex there were 26017 patterns. The present
% version of the revised nohyphbx.tex with UTF-8 encoding, which has
% been renamed hyph-no.tex, contains 27448 patterns --- plus
% 108 exceptions in the \hyphenation-list.
%
% Changes from the CTAN version of 2007-02-07: 299 new patterns.
% Some old patterns have been deleted or changed.
%
% To load these hyphenation patterns the parameters
% of TeX must have the following minimum values:
%   trie_size = 33757
%   trie_op_size = 852
% (The corresponding values for nohyphb.tex are
%   trie_size = 31900    trie_op_size = 636)
% If you want to load more than one set of hyphenation patterns
% the parameters must be set to a value larger than or equal to
% the sum of all required values for each set.
%
% Notes on other Norwegian hyphenation pattern files, from Dag Langmyhr,
% tex-live mail of 29 Jun 2005 11:26:21 +0200.
% nohyph.tex -- manually created by Ivar Aavatsmark and others;
%   hyphenate according to pre-1973 rules; no longer recommended for use.
%   (Sometimes also known as nohyph1.tex.)
% nohyph2.tex -- created by Dag and a student; the present file,
%   nohyphbx.tex, is more extensive and is recommended.
%
```

#### Slovak (sk): `hyph-sk.tex` の 1〜30 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-sk.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/sk.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄。表示に本文が無いので、MIT の本文を下に添えます)。

```text
% title: Hyphenation patterns for Slovak
% copyright: Copyright (C) 1992 Jana Chlebíková
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% version: 2.0 1992-04-24
% language:
%     name: Slovak
%     tag: sk
% authors:
%   -
%     name: Jana Chlebíková
%     affiliation: Department of Informatics Education, Comenius University, 842 15 Bratislava, Slovakia 
%     contact: chlebikj (at) dcs.fmph.uniba.sk
% licence:
%     name: MIT
%     url: http://www.opensource.org/licenses/MIT
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% texlive:
%     encoding: ec
%     babelname: slovak
%     legacy_patterns: skhyph.tex
%     message: Slovak hyphenation patterns
%     description: |-
%         Hyphenation patterns for Slovak in T1/EC and UTF-8 encodings.
%         Original patterns 'skhyphen' are still distributed in the 'csplain'
%         package and loaded with ISO Latin 2 encoding (IL2).
%
```

```text
MIT License

Copyright (C) 1992 Jana Chlebíková

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### Slovenian (sl): `hyph-sl.tex` の 1〜74 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-sl.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/sl.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Slovenian
% copyright: Copyright (C) 1990 Matjaž Vrečko
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Slovenian
%     tag: sl
% version: 2.3
% authors:
%   -
%     name: Matjaž Vrečko
%     affiliation: TeXCeX
%     contact: matjaz (at) mg-soft.si
% licence:
%     - This file is available under any of these licences:
%     -
%         name: LPPL
%         version: 1
%         or_later: true
%         url: http://www.latex-project.org/lppl/lppl-1-0.html
%     -
%         name: MIT
%         url: https://opensource.org/licences/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - 1990       First version of `hyphen.si' (Matjaž Vrečko, TeXCeX)
%
%     - >
%         Some cosmetic changes done later on, but none of these apply any more;
%         the patterns are still the same as they were originally:
%     - 1994-05-17 Use of code page 852 in patterns (Leon Žlajpah)
%     - 1995-04-06 Release of `sihyph21.tex'
%     - 1995-06-20 >
%             Added \slovenehyphenmins
%             Release of `sihyph22.tex'
%     - 1997-15-04 >
%             Some changes concerning "c, "s, "z and ...
%             Release of `sihyph23.tex'
%     - 2007-01-20 >
%             `sihyph23.tex' renamed to `slhyph.tex'
%             (sl is the proper language code for Slovenian)
% texlive:
%     synonyms:
%         - slovene
%     encoding: ec
%     babelname: slovenian
%     legacy_patterns: sihyph.tex
%     message: Slovenian hyphenation patterns
%     description: Hyphenation patterns for Slovenian in T1/EC and UTF-8 encodings.
%
```

#### Croatian (hr): `hyph-hr.tex` の 1〜66 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-hr.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/hr.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か、許諾の表示 (「Data Files」) のどちらか (下の表示の licence の欄)。Kumiori は許諾の表示のほうで配布します。この表示は、変えたファイルとその説明書に、変えたことをはっきり書くことを求めるので (c 項)、パターンを取り込んだファイルの先頭と、この節に書きます: 上流のパターンを npm の hyphen が JavaScript のデータに変換し、Kumiori がビルドで 1 つのファイルにまとめ、ビルドによっては縮めています。パターンの中身は変えていません。

```text
% title: Hyphenation patterns for Croatian
% copyright: Copyright (C) 1994, 1996, 2011, 2015 Igor Marinović
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Croatian
%     tag: hr
% authors:
%   -
%     name: Igor Marinović
%     contact: marinowski (at) gmail.com
% licence:
%     - This file is available under any of these licences:
%     -
%         name: LPPL
%         version: 1
%         or_later: true
%         url: http://www.latex-project.org/lppl/lppl-1-0.html
%     -
%         text: >
%             Permission is hereby granted, free of charge, to any person obtaining
%             a copy of this file and any associated documentation
%             (the "Data Files") to deal in the Data Files
%             without restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, and/or sell copies of
%             the Data Files, and to permit persons to whom the Data Files
%             are furnished to do so, provided that
%             (a) this copyright and permission notice appear with all copies 
%             of the Data Files,
%             (b) this copyright and permission notice appear in associated 
%             documentation, and
%             (c) there is clear notice in each modified Data File
%             as well as in the documentation associated with the Data File(s)
%             that the data has been modified.
%             
%             THE DATA FILES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF
%             ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
%             WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT OF THIRD PARTY RIGHTS.
%             IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS
%             NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
%             DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
%             DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
%             TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
%             PERFORMANCE OF THE DATA FILES.
%             
%             Except as contained in this notice, the name of a copyright holder
%             shall not be used in advertising or otherwise to promote the sale,
%             use or other dealings in these Data Files without prior
%             written authorization of the copyright holder.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - Late 1994 first version
%     - Beginning of 1996 much more improved version (date of last change: 19.03.1996).
%     - In summer 2008 patterns incorporated into hyph-utf8 and renamed from hrhyph.tex to hyph-hr.tex.
%     - 06.06.2011 LPPL licence added.
% texlive:
%     encoding: ec
%     babelname: croatian
%     legacy_patterns: hrhyph.tex
%     message: Croatian hyphenation patterns
%     description: Hyphenation patterns for Croatian in T1/EC and UTF-8 encodings.
%
```

#### Estonian (et): `hyph-et.tex` の 1〜61 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-et.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/et.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT か LPPL のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Estonian
% copyright: Copyright (C) 2004-2015 Enn Saar
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Estonian
%     tag: et
% authors:
%   -
%     name: Enn Saar
%     contact: saar (at) aai.ee
% licence:
%     - This file is dual-licensed under both these licences, at your discretion:
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
% 
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
% 
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
%     -
%         name: LPPL
%         version: 1.3
%         or_later: true
%         status: author-maintained
%         url: http://www.latex-project.org/lppl.txt
% changes:
%     - 2004-04-13 latest changes
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% texlive:
%     encoding: ec
%     babelname: estonian
%     legacy_patterns: ethyph.tex
%     message: Estonian hyphenation patterns
%     description: Hyphenation patterns for Estonian in T1/EC and UTF-8 encodings.
%
% ==========================================
% The patterns were generated long ago by applying patgen to
% an Estonian dictionary; a few patterns were added later manually 
% to prohibit aa-bits type cases. 
%
```

#### Lithuanian (lt): `hyph-lt.tex` の 1〜70 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-lt.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/lt.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MIT (下の表示の licence の欄)。

```text
% title: Hyphenation patterns for Lithuanian
% copyright: Copyright (C) 1992 Sigitas Tolušis, Yannis Haralambous
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% source: http://www.vtex.lt/tex/littex/index.html
% language:
%     name: Lithuanian
%     tag: lt
% authors:
%   -
%     name: Vytas Statulevičius
%     contact: vytas (at) vtex.lt
%   -
%     name: Sigitas Tolušis
%     contact: sigitas (at) vtex.lt
%   -
%     name: Yannis Haralambous
%     contact: yannis.haralambous (at) telecom-bretagne.eu
% licence:
%     name: MIT
%     url: https://opensource.org/licenses/MIT
%     text: >
%         Permission is hereby granted, free of charge, to any person
%         obtaining a copy of this software and associated documentation
%         files (the "Software"), to deal in the Software without
%         restriction, including without limitation the rights to use,
%         copy, modify, merge, publish, distribute, sublicense, and/or sell
%         copies of the Software, and to permit persons to whom the
%         Software is furnished to do so, subject to the following
%         conditions:
%
%         The above copyright notice and this permission notice shall be
%         included in all copies or substantial portions of the Software.
%
%         THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%         EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%         OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%         NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%         HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%         WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%         FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%         OTHER DEALINGS IN THE SOFTWARE.
% changes:
%     - First version in LT encoding (modified T1): Vytas Statulevičius <vytas at vtex.lt>
%           and Yannis Haralambous (Vilnius, March 4, 1992)
%     - Conversion into Latin 7 and aditional support files (babel, fonts):
%           Sigitas Tolušis <sigitas at vtex.lt> (2002-11-20)
%     - Adaptation for hyph-utf8: Mojca & Arthur (see below), October 2008
% hyphenmins:
%     generation:
%         left: 2
%         right: 2
% texlive:
%     encoding: l7x
%     babelname: lithuanian
%     message: Lithuanian hyphenation patterns
%     description: |-
%         Hyphenation patterns for Lithuanian in L7X and UTF-8 encodings.
%         \lefthyphenmin and \righthyphenmin have to be at least 2.
%
% ==========================================
% A note about lefthyphenmin/righthyphenmin (by Sigitas, February 2009):
%
% At the moment the lefthyphenmin & righthyphenmin are both set to 2.
% The Lithuanian patterns were build earlier then the latest grammatical rules
% took place in 1997. At that time it was forbidden to leave one character at boundary.
% One may change it to one now, but from typographical point of view there is no need to do
% any changes. Even more, changing lefthyphen and righthyphen to 1 requires
% to review and maybe rebuild the patterns file.
%
```

#### Irish (ga): `hyph-ga.tex` の 1〜65 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-ga.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/ga.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは GPL (2 以降) か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Irish
% copyright: Copyright (C) 2004-2015 Kevin P. Scannell
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information on the package,
%     and http://borel.slu.edu/fleiscin/index.html for details on Irish hyphenation.
% language:
%     name: Irish
%     tag: ga
% version: 1.0 (2004-01-23:15:46:12 CST)
% authors:
%   -
%     name: Kevin P. Scannell
%     contact: scanell (at) slu.edu
% licence:
%     - This file available under any of these licences:
%     -
%         name: GPL
%         version: 2
%         or_later: true
%         url: http://www.gnu.org/licenses/gpl-2.0.html
%         text: >
%             This program is free software; you can redistribute it and/or
%             modify it under the terms of the GNU General Public License
%             as published by the Free Software Foundation; either version 2
%             of the License, or (at your option) any later version.
%            
%             This program is distributed in the hope that it will be useful,
%             but WITHOUT ANY WARRANTY; without even the implied warranty of
%             MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
%             GNU General Public License for more details.
%     -
%         name: MIT
%         url: https://opensource.org/licenses/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% texlive:
%     encoding: ec
%     babelname: irish
%     legacy_patterns: gahyph.tex
%     message: Irish hyphenation patterns
%     description: Hyphenation patterns for Irish (Gaeilge) in T1/EC and UTF-8 encodings.
%
```

#### Welsh (cy): `hyph-cy.tex` の 1〜61 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-cy.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/cy.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL か MIT のどちらか (下の表示の licence の欄)。Kumiori は MIT で配布します。

```text
% title: Hyphenation patterns for Welsh
% copyright: Copyright (C) 1996 Yannis Haralambous
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Welsh
%     tag: cy
% version: 1996
% authors:
%   -
%     name: Yannis Haralambous
%     contact: yannis.haralambous (at) imt-atlantique.fr
% licence:
%     - This file is available under any of these licences:
%     -
%         name: LPPL
%         status: maintained
%         maintainer: Yannis Haralambous
%         version: 1.0
%         or_later: true
%         url: http://www.latex-project.org/lppl/lppl-1-0.html
%     -
%         name: MIT
%         url: https://opensource.org/licences/MIT
%         text: >
%             Permission is hereby granted, free of charge, to any person
%             obtaining a copy of this software and associated documentation
%             files (the "Software"), to deal in the Software without
%             restriction, including without limitation the rights to use,
%             copy, modify, merge, publish, distribute, sublicense, and/or sell
%             copies of the Software, and to permit persons to whom the
%             Software is furnished to do so, subject to the following
%             conditions:
%
%             The above copyright notice and this permission notice shall be
%             included in all copies or substantial portions of the Software.
%
%             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
%             EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
%             OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%             NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
%             HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
%             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
%             FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
%             OTHER DEALINGS IN THE SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 3
% changes:
%     - 1996 - last change to patterns
%     - 2008 - inclusion into hyph-utf8 and file rename (cyhyph.tex -> hyph-cy.tex)
%     - June 2011 - added LPPL licence
%     - March 2016 - added MIT licence
% texlive:
%     encoding: ec
%     babelname: welsh
%     legacy_patterns: cyhyph.tex
%     message: Welsh hyphenation patterns
%     description: Hyphenation patterns for Welsh in T1/EC and UTF-8 encodings.
%
```

#### Galician (gl): `hyph-gl.tex` の 1〜31 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-gl.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/gl.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは Unlicense (下の表示の licence の欄)。

```text
% title: Hyphenation patterns for Galician
% copyright: Copyright (C) 2006, 2007, 2008, 2010 Javier A. Múgica
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Galician
%     tag: gl
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% version: 2.4 2010/04/23
% authors:
%   -
%     name: Javier A. Múgica
%     contact: javier (at) digi21.eu
% licence:
%     name: Unlicence
%     url: https://unlicense.org/
% texlive:
%     encoding: ec
%     babelname: galician
%     legacy_patterns: glhyph.tex
%     message: Galician hyphenation patterns
%     description: Hyphenation patterns for Galician in T1/EC and UTF-8 encodings.
% ==========================================
% Generated with the mkpattern utility (v. 1.2), on 2010/04/23
% The original source file were glpatter-utf8.tex
% This is a generated file
%
% Note that there is no 'j' nor 'y' in Galician
```

#### Basque (eu): `hyph-eu.tex` の 1〜74 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-eu.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/eu.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは許諾の表示 (「Data Files」。下の表示の licence の欄)。変えたファイルとその説明書に変えたことをはっきり書くことを求めるので (c 項)、パターンを取り込んだファイルの先頭と、この節に書きます: 上流のパターンを npm の hyphen が JavaScript のデータに変換し、Kumiori がビルドで 1 つのファイルにまとめ、ビルドによっては縮めています。パターンの中身は変えていません。

```text
% copyright: Copyright (C) 1997, 2008 Juan M. Aguirregabiria
% title: Hyphenation patterns for Basque
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information on the package,
%     and http://tp.lc.ehu.es/jma/basque.html for details on Basque hyphenation.
% language:
%     name: Basque
%     tag: eu
% version: June 2008
% authors:
%   -
%     name: Juan M. Aguirregabiria
%     contact: juanmari.aguirregabiria (at) ehu.es
% licence:
%     text: >
%         Permission is hereby granted, free of charge, to any person obtaining
%         a copy of this file and any associated documentation
%         (the "Data Files") to deal in the Data Files
%         without restriction, including without limitation the rights to use,
%         copy, modify, merge, publish, distribute, and/or sell copies of
%         the Data Files, and to permit persons to whom the Data Files
%         are furnished to do so, provided that
%         (a) this copyright and permission notice appear with all copies
%         of the Data Files,
%         (b) this copyright and permission notice appear in associated
%         documentation, and
%         (c) there is clear notice in each modified Data File
%         as well as in the documentation associated with the Data File(s)
%         that the data has been modified.
%
%         THE DATA FILES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF
%         ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
%         WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
%         NONINFRINGEMENT OF THIRD PARTY RIGHTS.
%         IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS
%         NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
%         DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
%         DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
%         TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
%         PERFORMANCE OF THE DATA FILES.
%
%         Except as contained in this notice, the name of a copyright holder
%         shall not be used in advertising or otherwise to promote the sale,
%         use or other dealings in these Data Files without prior
%         written authorization of the copyright holder.
% hyphenmins:
%     typesetting:
%          left: 2
%          right: 2
% changes:
%     - >
%         February 1997 Patterns created by Juan M. Aguirregabiria, based on the
%         shyphen.sh script for Spanish by Julio Sanchez, September 1991.
%     - >
%         26 June 2008 Generating script rewritten in Ruby and adapted for native
%         UTF-8 TeX engines, patterns renamed from bahyph.tex to
%         hyph-eu.tex and added to the hyph-utf8 package.  Functionality should
%         not change apart from adding ñ by default.
% texlive:
%     encoding: ec
%     babelname: basque
%     legacy_patterns: bahyph.tex
%     message: Basque hyphenation patterns
%     description: Hyphenation patterns for Basque in T1/EC and UTF-8 encodings.
% ==========================================
%
% Open vowels: a e o
% Closed vowels: i u
% Consonants: b c d f g j k l m n ñ p q r s t v w x y z
%
% Some of the patterns below represent combinations that never
% happen in Basque. Would they happen, they would be hyphenated
% according to the rules.
%
```

#### Bulgarian (bg): `hyph-bg.tex` の 1〜58 行目 (初めの表示と、著作権・ライセンスの表示。その後ろの、パターンの作り方の説明と変更の記録は写していない)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-bg.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/bg.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは、BSD 3 条項に近い許諾の表示 (下の表示の licence の欄)。

```text
% copyright: Copyright (C) 2000, 2004, 2017 Anton Zinoviev
% title: Hyphenation patterns for Bulgarian
% version: 21 October 2017
% language:
%     name: Bulgarian
%     tag: bg
% notice: >
%     This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
%     The Bulgarian patterns used to come from another file,
%     by Georgi Boshnakov, named bghyphen.tex
% authors:
%     -
%         name: Anton Zinoviev
%         contact: anton:lml.bas.bg
% licence:
%     text: > # Seems equivalent to 3-clause BSD
%         This software may be used, modified, copied, distributed, and sold,
%         both in source and binary form provided that the above copyright
%         notice and these terms are retained. The name of the author may not
%         be used to endorse or promote products derived from this software
%         without prior permission.  THIS SOFTWARE IS PROVIDES "AS IS" AND
%         ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.  IN NO EVENT
%         SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY OUT
%         OF THE USE OF THIS SOFTWARE.
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes: See below
% texlive:
%     encoding: t2a
%     message: Bulgarian hyphenation patterns
%     description: Hyphenation patterns for Bulgarian in T2A and UTF-8 encodings.
%     babelname: bulgarian
% ==========================================
% Copyright (C) 2000,2004,2017 by Anton Zinoviev <anton@lml.bas.bg>
%
% This software may be used, modified, copied, distributed, and sold,
% both in source and binary form provided that the above copyright
% notice and these terms are retained. The name of the author may not
% be used to endorse or promote products derived from this software
% without prior permission.  THIS SOFTWARE IS PROVIDES "AS IS" AND
% ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.  IN NO EVENT
% SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY OUT
% OF THE USE OF THIS SOFTWARE.
%
% Bulgarian hyphenation patterns
%
% Generated by ./hyph-bg.sh --safe-morphology --standalone-tex
%
% Both left and right hyphenmins should be set to 2.
%
% % Automated Bulgarian Hyphenation
% % Anton Zinoviev
% % 21 October 2017
% 
% Principles of the Bulgarian hyphenation
```

#### Finnish (fi): `hyph-fi.tex` の 1〜34 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-fi.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/fi.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスの表示は「Patterns may be freely distributed」(下の表示の licence の欄)。パターンの中身は変えず、JavaScript のデータに形を変えたものを、この表示を残して配布します。

```text
% title: Hyphenation patterns for Finnish
% copyright: Copyright (C) 1986, 1988, 1989 Kauko Saarinen
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Finnish
%     tag: fi
% version: 2.2
% authors:
%   -
%     name: Kauko Saarinen
%     affiliation: Computing Centre, University of Jyväskylä, Finland
% licence:
%     - text: Patterns may be freely distributed
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - First release 1986-01 by Kauko Saarinen,
%     - >
%         Completely rewritten 1988-01. The new patterns make
%         much less mistakes with foreign and compound words.
%         The article "Automatic Hyphenation of Finnish"
%         by Professor Fred Karlsson is also referred
%     - 1989-03-08 (vers. 2.2), some vowel triples by Fred Karlsson added.
%     - 1995-01-09: added \uccode and \lccode by Thomas Esser
% texlive:
%     encoding: ec
%     babelname: finnish
%     legacy_patterns: fihyph.tex
%     message: Finnish hyphenation patterns
%     package: finnish
%
```

#### Swedish (sv): `hyph-sv.tex` の 1〜55 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-sv.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/sv.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1.2 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/sv.js` を取り込んだチャンク `dist-browser/chunks/sv-*.js`・`dist/assets/sv-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。

```text
% title: Hyphenation patterns for Swedish
% copyright: Copyright (C) 1994 Jan Michael Rynning
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Swedish
%     tag: sv
% version: 1994-03-03
% authors:
%   -
%     name: Jan Michael Rynning
%     contact: jmr (at) incolumitas.se
% licence:
%     name: LPPL
%     version: 1.2
%     or_later: true
% hyphenmins:
%     generation:
%         left: 1
%         right: 2
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - 1991-01-08: First version available for anonymous FTP.
%     - 1991-08-08: Changed \aa to \aa0 at end of line, to stop TeX from
%           concatenating the patterns.
%     - 1991-09-03: Cleaned up lots of inconsistencies in the dictionary.
%           As a consequence, the patterns shrunk a lot.  Also added some 4000
%           one-syllable words, some of which were hyphenated by the old
%           patterns, and some 1500 compound words, about half of which were
%           incorrectly hyphenated by the old patterns.
%     - 1991-11-01: Added another some 6200 compound words, all of which were
%           incorrectly hyphenated by the old patterns.
%     - 1991-11-13: Added another some 6500 compound words, all of which were
%           incorrectly hyphenated by the old patterns.
%     - 1992-01-30: Changed macros to ^^, for use with LaTeX and dc fonts.
%     - 1994-03-03: The hyphenated dictionary now contains about 118,000 words.
%           The hyphenation now works much better for compound words.
%           Patgen parameters 1 2 20, 2 1 8, 1 4 7, 3 2 1, 1 10000 4.
% texlive:
%     encoding: ec
%     message: Swedish hyphenation patterns
%     legacy_patterns: svhyph.tex
%     description: Hyphenation patterns for Swedish in T1/EC and UTF-8 encodings.
%     babelname: swedish
% ==========================================
% These hyphenation patterns work quite well for simple words, but not
% quite as well for compound words.  I'm working on improving the quality,
% by adding more words.  If you know any Swedish words which are not
% correctly hypheneted using these patterns, or if you have questions or
% comments, please contact me:
%
% Jan Michael Rynning <jmr@incolumitas.se>
%
```

#### Catalan (ca): `hyph-ca.tex` の 1〜50 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-ca.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/ca.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/ca.js` を取り込んだチャンク `dist-browser/chunks/ca-*.js`・`dist/assets/ca-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。 カタルーニャ語の `l·l` (中黒) の所は、分けると字が変わる (中黒を外してハイフンにする) ので、パターンだけでは組めません。Kumiori は中黒を語の字に数えないので、`l·l` の所では分けません。

```text
% title: Hyphenation patterns for Catalan
% copyright: Copyright (C) December 1991-January 1995, July 2003 Gonçal Badenes
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Catalan
%     tag: ca
% version: 1.11 15 July 2003 15:08:12 CET
% authors:
%   -
%     name: Gonçal Badenes
%     contact: g.badenes (at) ieee.org
%   -
%     name: Francina Turon
% licence:
%     name: LPPL
%     version: 1
%     or_later: true
%     url: https://latex-project.org/lppl/
% hyphenmins:
%     generation:
%         left: 2
%         right: 2
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - Version 1.11 2003-07-15 Identical to version 1.10 except for the updated copyright notice.
%     - Version 1.10 1995-01-17
% texlive:
%     encoding: ec
%     babelname: catalan
%     legacy_patterns: cahyph.tex
%     message: Catalan hyphenation patterns
%     description: Hyphenation patterns for Catalan in T1/EC and UTF-8 encodings.
% ==========================================
%
% This patterns have been created using standard, conservative
% hyphenation rules for catalan. The results have refined running them
% through patgen. In that way, the number of hits has been increased.
%
% These rules produce no wrong patterns (Results checked against the
% “Diccionari Ortogràfic i de Pronúncia”, Enciclopèdia
% Catalana. The percentage of valid hyphen misses is lower than 1%
%
% Some of the patterns below represent combinations that never
% happen in Catalan. We have tried to keep them to a minimum.
%
% Please report any problem you might have to the authors!!!
%
```

#### Icelandic (is): `hyph-is.tex` の 1〜33 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-is.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/is.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1.2 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/is.js` を取り込んだチャンク `dist-browser/chunks/is-*.js`・`dist/assets/is-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。

```text
% title: Hyphenation patterns for Icelandic
% copyright: Copyright (C) 1988, 2004 Jörgen Pind
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Icelandic
%     tag: is
% authors:
%   -
%     name: Jörgen Pind
%     affiliation: Institute of Lexicography, Univ. of Iceland
%     contact: jorgen (at) lexis.hi.is
% licence:
%     name: LPPL
%     version: 1.2
%     or_later: true
%     url: http://www.latex-project.org/lppl.txt
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - Nov 2 1988: Latest pattern change
%     - Mar 2 2004: Uploaded a new version to CTAN, with a clarified license
%           statement, at the request of the author, Jörgen Pind.
%           Kristinn Gylfason (kristgy@ieee.org)
% texlive:
%     encoding: ec
%     babelname: icelandic
%     legacy_patterns: icehyph.tex
%     message: Icelandic hyphenation patterns
%     description: Hyphenation patterns for Icelandic in T1/EC and UTF-8 encodings.
%
```

#### Turkish (tr): `hyph-tr.tex` の 1〜64 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-tr.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/tr.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/tr.js` を取り込んだチャンク `dist-browser/chunks/tr-*.js`・`dist/assets/tr-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。

```text
% title: Hyphenation patterns for Turkish
% copyright: Copyright (C) 1987 Pierre A. MacKay, 2008, 2011 TUG
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Turkish
%     tag: tr
% authors:
%     -
%         name: Pierre A. MacKay
%     -
%         name: H. Turgut Uyar
%         contact: uyar (at) itu.edu.tr
%     -
%         name: S. Ekin Kocabas
%         contact: kocabas (at) stanford.edu
%     -
%         name: Mojca Miklavec
% licence:
%     name: LPPL
%     version: 1
%     or_later: true
%     url: https://latex-project.org/lppl/lppl-1-0.html
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% changes:
%     - 2008-06-25/27/28 - create this file by adapting Ottoman rules for modern Turkish
%     - 2011-08-10 - add LPPL licence with permission of Pierre A. MacKay
% texlive:
%     encoding: ec
%     babelname: turkish
%     legacy_patterns: tkhyph.tex
%     message: Turkish hyphenation patterns
%     description: |-
%         Hyphenation patterns for Turkish in T1/EC and UTF-8 encodings.
%         Auto-generated from a script included in the distribution.
%         The patterns for Turkish were first produced for the Ottoman Texts
%         Project in 1987 and were suitable for both Modern Turkish and Ottoman
%         Turkish in Latin script, however the required character set didn't fit
%         into EC encoding, so support for Ottoman Turkish had to be dropped to
%         keep compatibility with 8-bit engines.
% ==========================================
% This file is auto-generated from
% source/generic/hyph-utf8/languages/tr/generate_patterns_tr.rb
% that is part of hyph-utf8.
% Please don't modify this file; modify the generating script instead.
%
% Credits:
% - algorithm developed by P. A. MacKay for the Ottoman Texts Project in 1987
% - rules adapted for modern Turkish by H. Turgut Uyar <uyar at itu.edu.tr>
% - initiative to improve Turkish patterns by S. Ekin Kocabas <kocabas at stanford.edu>
% - script written by Mojca Miklavec <mojca.miklavec.lists at gmail.com> in June 2008
%
% See also:
% - http://mirror.ctan.org/language/turkish/hyphen/turk_hyf.c
% - http://www.tug.org/TUGboat/Articles/tb09-1/tb20mackay.pdf
%
% Differences with Ottoman patterns:
% - adapted for the use on modern TeX engines, using UTF-8 charactes
% - only letters for Modern Turkish + âîû (the first one often needed, the other two don't hurt)
% - (if needed, support for Ottoman Turkish might be provided separately under language code 'ota')
% 
```

#### Serbocroatian, Latin script (sh-latn): `hyph-sh-latn.tex` の 1〜48 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-sh-latn.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/sh-latn.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/sh-latn.js` を取り込んだチャンク `dist-browser/chunks/sh-latn-*.js`・`dist/assets/sh-latn-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。 `lang` が `sr-Latn`・`sr-ME`・`sh` の文に使います (hyphen の `sr-cyrl` は GPL なので使いません)。

```text
% title: Hyphenation patterns for Serbo-Croatian, Latin script
% copyright: Copyright (C) 1990, 2008 Dejan Muhamedagić
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Serbocroatian, Latin script
%     tag: sh-latn
% version: 2.02 22 June 2008
% authors:
%   -
%     name: Dejan Muhamedagić
%     contact: dejan (at) hello-penguin.com
% licence:
%     name: LPPL
%     version: 1
%     or_later: true
%     url: https://latex-project.org/lppl/
% hyphenmins:
%     generation:
%         left: 1
%         right: 2
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     encoding: ec
%     babelname: serbian
%     legacy_patterns: shhyphl.tex
%     message: Serbian hyphenation patterns in Latin script
%     package: serbian
% ==========================================
% Osnovni skup paterna dobijen je na osnovu fonoloških osobina
% srpskohrvatskog jezika.  Pravila i preporuke sam preuzeo iz:
%
% M. Pešikan, J. Jerković, M. Pižurica:
% Pravopis srpskoga jezika
% Matica srpska, Novi Sad, 1995.
%
% U drugom delu se nalaze izuzeci od fonoloških pravila bazirani
% na boljem psihološkom prelomu reči. Izradjen je korišćenjem
% sledećih rečnika:
%
% Rečnik srpskohrvatskoga književnog jezika
% Matica srpska, Matica hrvatska, Novi Sad, Zagreb, 1967-1976.
%
% Milan Vujaklija: Leksikon stranih reči i izraza
% Prosveta, Beograd, 1992.
%
```

#### Serbocroatian, Cyrillic script (sh-cyrl): `hyph-sh-cyrl.tex` の 1〜48 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-sh-cyrl.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/sh-cyrl.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは LPPL 1 かそれ以降 (下の表示の licence の欄)。Kumiori は 1.3c の条件で配布し、第 6 項への従い方はロシア語 (ru) の項と同じです (配るものは hyphen@1.14.1 の `patterns/sh-cyrl.js` を取り込んだチャンク `dist-browser/chunks/sh-cyrl-*.js`・`dist/assets/sh-cyrl-*.js`。チャンクの先頭に、変更したものであることと変更の内容、元のファイルの入手先を英語で書いています)。 `lang` が `sr`・`sr-Cyrl`・`sh-Cyrl` の文に使います (hyphen の `sr-cyrl` は GPL なので使いません)。

```text
% title: Hyphenation patterns for Serbo-Croatian, Cyrillic script
% copyright: Copyright (C) 1990, 2008 Dejan Muhamedagić
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Serbocroatian, Cyrillic script
%     tag: sh-cyrl
% version: 2.02 Jun 22, 2008
% authors:
%   -
%     name: Dejan Muhamedagić
%     contact: dejan (at) hello-penguin.com
% licence:
%     name: LPPL
%     version: 1
%     or_later: true
%     url: https://latex-project.org/lppl/
% hyphenmins:
%     generation:
%         left: 1
%         right: 2
%     typesetting:
%         left: 2 # But 1 is also possible
%         right: 2
% texlive:
%     encoding: t2a
%     babelname: serbianc
%     legacy_patterns: srhyphc.tex
%     message: Serbian hyphenation patterns in Cyrillic script
%     package: serbian
% ==========================================
% Osnovni skup paterna dobijen je na osnovu fonoloških osobina
% srpskohrvatskog jezika.  Pravila i preporuke sam preuzeo iz:
%
% M. Pešikan, J. Jerković, M. Pižurica:
% Pravopis srpskoga jezika
% Matica srpska, Novi Sad, 1995.
%
% U drugom delu se nalaze izuzeci od fonoloških pravila bazirani
% na boljem psihološkom prelomu reči. Izradjen je korišćenjem
% sledećih rečnika:
%
% Rečnik srpskohrvatskoga književnog jezika
% Matica srpska, Matica hrvatska, Novi Sad, Zagreb, 1967-1976.
%
% Milan Vujaklija: Leksikon stranih reči i izraza
% Prosveta, Beograd, 1992.
%
```

#### Hungarian (hu): `hyph-hu.tex` の 1〜40 行目 (パターンの前のコメントすべて)

- 取得元: https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-hu.tex (master ブランチ。取得日 2026-11-22。コミットは特定していない)
- npm の hyphen@1.14.1 の `patterns/hu.js` には、ライセンスや著作権の表示は入っていません。hyphen@1.14.1 のパターンが、上流のどの版から変換されたかは確認できていません。
- ライセンスは MPL 1.1・GPL 2.0・LGPL 2.1 のどれか (下の表示の licence の欄)。Kumiori は MPL (Mozilla Public License) 1.1 で配布します。MPL 1.1 はファイルごとのライセンスで、ほかのライセンスのコードとまとめて配ってよい (§3.7 Larger Works) ので、Kumiori のほかの部分 (Apache License 2.0) とまとめて配ります。MPL 1.1 の条件に、次のように従います。
  - **配るもの**: 上流のパターン (`hyph-hu.tex`) を、npm の hyphen が JavaScript のデータに変換したもの (hyphen@1.14.1 の `patterns/hu.js`。2026-01-16 に公開)。Kumiori は、これをビルドで 1 つのファイル (チャンク) にまとめます (2026-11-22 から)。パターンの中身は変えていません。これを取り込んだファイルが入るのは、ブラウザ向けの配布物 (`dist-browser/chunks/hu-*.js`) と画面 (`dist/assets/hu-*.js`) です。Node のコマンドとライブラリは、パターンを含みません。
  - **ソースの形 (§1.11・§3.2・§3.6)**: ブラウザ向けの配布物 (npm の `dist-browser/chunks/hu-*.js`) では、このチャンクを縮めません (ほかの言語のチャンクは縮めます)。チャンクそのものが、手を入れるのに向いた形 (hyphen が変換した JavaScript のまま) で、MPL 1.1 のソースの形として配ります。画面のビルド (`dist/`) は、すべてのコードを縮めるので (チャンクごとに外す設定がありません)、このチャンクも実行の形 (§1.5) になります。そのため、そのチャンクの先頭に、ソースの形が MPL 1.1 で手に入ること (npm の registry の、同じ版の kumiori の `dist-browser/chunks/hu-*.js` と、hyphen 1.14.1 の `patterns/hu.js`) を書いています (§3.6)。npm の registry は、公開した版をそのまま置き続けるので、§3.2 の、12 か月以上手に入れられるようにする条件を満たします。
  - **ライセンスの写し (§3.1)**: MPL 1.1 の本文を、この節の下に写しています。チャンクの先頭に、この本文の場所を書いています。
  - **変えたことの説明 (§3.3)**: チャンクの先頭と、この節 (上の「配るもの」) に、変えた中身と日付と、元のコード (Original Code) を最初の作者 (Initial Developer) の Bence Nagy が作ったことを書いています。
  - **表示 (§3.5)**: チャンクの先頭に、Exhibit A の表示 (元のコードの名前・最初の作者・著作権の表示) を入れています。
  - 変更していない元のファイルは、hyph-utf8 パッケージ (https://ctan.org/pkg/hyph-utf8 の `tex/generic/hyph-utf8/patterns/tex/hyph-hu.tex`) と、上の取得元 (https://github.com/hyphenation/tex-hyphen ) から入手できます。

```text
% title: Hyphenation patterns for Hungarian
% copyright: Copyright (C) 2003 Bence Nagy
% notice: This file is part of the hyph-utf8 package.
%     See http://www.hyphenation.org/tex for more information.
% language:
%     name: Hungarian
%     tag: hu
% version: 2011-08-15
% authors:
%   -
%     name: Bence Nagy
%     contact: bence.nagy (at) gmail.com
% licence:
%     - This file is available under any of these licences, at your option:
%     -
%         name: MPL
%         version: 1.1
%         initial_developer: Bence Nagy
%         contributors:
%             - Bence Nagy
%         url: https://www.mozilla.org/en-US/MPL/1.1/
%     -
%         name: GPL
%         version: 2.0
%         url: http://www.gnu.org/licenses/old-licenses/gpl-2.0.html
%     -
%         name: LGPL
%         version: 2.1
%         url: http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
% hyphenmins:
%     typesetting:
%         left: 2
%         right: 2
% texlive:
%     encoding: ec
%     babelname: hungarian
%     legacy_patterns: huhyphn.tex
%     message: Hungarian hyphenation patterns
%     description: Hyphenation patterns for Hungarian in T1/EC and UTF-8 encodings.
%
```

Mozilla Public License 1.1 の本文 (取得元: https://raw.githubusercontent.com/spdx/license-list-data/main/text/MPL-1.1.txt 。SPDX のライセンスの一覧の本文。取得日 2026-11-22。Mozilla の原文は https://www.mozilla.org/MPL/1.1/ ):

```text
Mozilla Public License Version 1.1

1. Definitions.

     1.0.1. "Commercial Use" means distribution or otherwise making the Covered Code available to a third party.

     1.1. "Contributor" means each entity that creates or contributes to the creation of Modifications.

     1.2. "Contributor Version" means the combination of the Original Code, prior Modifications used by a Contributor, and the Modifications made by that particular Contributor.

     1.3. "Covered Code" means the Original Code or Modifications or the combination of the Original Code and Modifications, in each case including portions thereof.

     1.4. "Electronic Distribution Mechanism" means a mechanism generally accepted in the software development community for the electronic transfer of data.

     1.5. "Executable" means Covered Code in any form other than Source Code.

     1.6. "Initial Developer" means the individual or entity identified as the Initial Developer in the Source Code notice required by Exhibit A.

     1.7. "Larger Work" means a work which combines Covered Code or portions thereof with code not governed by the terms of this License.

     1.8. "License" means this document.

     1.8.1. "Licensable" means having the right to grant, to the maximum extent possible, whether at the time of the initial grant or subsequently acquired, any and all of the rights conveyed herein.

     1.9. "Modifications" means any addition to or deletion from the substance or structure of either the Original Code or any previous Modifications. When Covered Code is released as a series of files, a Modification is:
Any addition to or deletion from the contents of a file containing Original Code or previous Modifications.
Any new file that contains any part of the Original Code or previous Modifications.

     1.10. "Original Code" means Source Code of computer software code which is described in the Source Code notice required by Exhibit A as Original Code, and which, at the time of its release under this License is not already Covered Code governed by this License.

     1.10.1. "Patent Claims" means any patent claim(s), now owned or hereafter acquired, including without limitation, method, process, and apparatus claims, in any patent Licensable by grantor.

     1.11. "Source Code" means the preferred form of the Covered Code for making modifications to it, including all modules it contains, plus any associated interface definition files, scripts used to control compilation and installation of an Executable, or source code differential comparisons against either the Original Code or another well known, available Covered Code of the Contributor's choice. The Source Code can be in a compressed or archival form, provided the appropriate decompression or de-archiving software is widely available for no charge.

     1.12. "You" (or "Your") means an individual or a legal entity exercising rights under, and complying with all of the terms of, this License or a future version of this License issued under Section 6.1. For legal entities, "You" includes any entity which controls, is controlled by, or is under common control with You. For purposes of this definition, "control" means (a) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (b) ownership of more than fifty percent (50%) of the outstanding shares or beneficial ownership of such entity.

2. Source Code License.

     2.1. The Initial Developer Grant. The Initial Developer hereby grants You a world-wide, royalty-free, non-exclusive license, subject to third party intellectual property claims:

          a. under intellectual property rights (other than patent or trademark) Licensable by Initial Developer to use, reproduce, modify, display, perform, sublicense and distribute the Original Code (or portions thereof) with or without Modifications, and/or as part of a Larger Work; and
          b. under Patents Claims infringed by the making, using or selling of Original Code, to make, have made, use, practice, sell, and offer for sale, and/or otherwise dispose of the Original Code (or portions thereof).
          c. the licenses granted in this Section 2.1 (a) and (b) are effective on the date Initial Developer first distributes Original Code under the terms of this License.
          d. Notwithstanding Section 2.1 (b) above, no patent license is granted: 1) for code that You delete from the Original Code; 2) separate from the Original Code; or 3) for infringements caused by: i) the modification of the Original Code or ii) the combination of the Original Code with other software or devices.

     2.2. Contributor Grant. Subject to third party intellectual property claims, each Contributor hereby grants You a world-wide, royalty-free, non-exclusive license

          a. under intellectual property rights (other than patent or trademark) Licensable by Contributor, to use, reproduce, modify, display, perform, sublicense and distribute the Modifications created by such Contributor (or portions thereof) either on an unmodified basis, with other Modifications, as Covered Code and/or as part of a Larger Work; and
          b. under Patent Claims infringed by the making, using, or selling of Modifications made by that Contributor either alone and/or in combination with its Contributor Version (or portions of such combination), to make, use, sell, offer for sale, have made, and/or otherwise dispose of: 1) Modifications made by that Contributor (or portions thereof); and 2) the combination of Modifications made by that Contributor with its Contributor Version (or portions of such combination).
          c. the licenses granted in Sections 2.2 (a) and 2.2 (b) are effective on the date Contributor first makes Commercial Use of the Covered Code.
          d. Notwithstanding Section 2.2 (b) above, no patent license is granted: 1) for any code that Contributor has deleted from the Contributor Version; 2) separate from the Contributor Version; 3) for infringements caused by: i) third party modifications of Contributor Version or ii) the combination of Modifications made by that Contributor with other software (except as part of the Contributor Version) or other devices; or 4) under Patent Claims infringed by Covered Code in the absence of Modifications made by that Contributor.

3. Distribution Obligations.

     3.1. Application of License. The Modifications which You create or to which You contribute are governed by the terms of this License, including without limitation Section 2.2. The Source Code version of Covered Code may be distributed only under the terms of this License or a future version of this License released under Section 6.1, and You must include a copy of this License with every copy of the Source Code You distribute. You may not offer or impose any terms on any Source Code version that alters or restricts the applicable version of this License or the recipients' rights hereunder. However, You may include an additional document offering the additional rights described in Section 3.5.

     3.2. Availability of Source Code. Any Modification which You create or to which You contribute must be made available in Source Code form under the terms of this License either on the same media as an Executable version or via an accepted Electronic Distribution Mechanism to anyone to whom you made an Executable version available; and if made available via Electronic Distribution Mechanism, must remain available for at least twelve (12) months after the date it initially became available, or at least six (6) months after a subsequent version of that particular Modification has been made available to such recipients. You are responsible for ensuring that the Source Code version remains available even if the Electronic Distribution Mechanism is maintained by a third party.

     3.3. Description of Modifications. You must cause all Covered Code to which You contribute to contain a file documenting the changes You made to create that Covered Code and the date of any change. You must include a prominent statement that the Modification is derived, directly or indirectly, from Original Code provided by the Initial Developer and including the name of the Initial Developer in (a) the Source Code, and (b) in any notice in an Executable version or related documentation in which You describe the origin or ownership of the Covered Code.

     3.4. Intellectual Property Matters

          (a) Third Party Claims
          If Contributor has knowledge that a license under a third party's intellectual property rights is required to exercise the rights granted by such Contributor under Sections 2.1 or 2.2, Contributor must include a text file with the Source Code distribution titled "LEGAL" which describes the claim and the party making the claim in sufficient detail that a recipient will know whom to contact. If Contributor obtains such knowledge after the Modification is made available as described in Section 3.2, Contributor shall promptly modify the LEGAL file in all copies Contributor makes available thereafter and shall take other steps (such as notifying appropriate mailing lists or newsgroups) reasonably calculated to inform those who received the Covered Code that new knowledge has been obtained.

          (b) Contributor APIs
          If Contributor's Modifications include an application programming interface and Contributor has knowledge of patent licenses which are reasonably necessary to implement that API, Contributor must also include this information in the LEGAL file.

          (c) Representations.
          Contributor represents that, except as disclosed pursuant to Section 3.4 (a) above, Contributor believes that Contributor's Modifications are Contributor's original creation(s) and/or Contributor has sufficient rights to grant the rights conveyed by this License.

     3.5. Required Notices. You must duplicate the notice in Exhibit A in each file of the Source Code. If it is not possible to put such notice in a particular Source Code file due to its structure, then You must include such notice in a location (such as a relevant directory) where a user would be likely to look for such a notice. If You created one or more Modification(s) You may add your name as a Contributor to the notice described in Exhibit A. You must also duplicate this License in any documentation for the Source Code where You describe recipients' rights or ownership rights relating to Covered Code. You may choose to offer, and to charge a fee for, warranty, support, indemnity or liability obligations to one or more recipients of Covered Code. However, You may do so only on Your own behalf, and not on behalf of the Initial Developer or any Contributor. You must make it absolutely clear than any such warranty, support, indemnity or liability obligation is offered by You alone, and You hereby agree to indemnify the Initial Developer and every Contributor for any liability incurred by the Initial Developer or such Contributor as a result of warranty, support, indemnity or liability terms You offer.

     3.6. Distribution of Executable Versions. You may distribute Covered Code in Executable form only if the requirements of Sections 3.1, 3.2, 3.3, 3.4 and 3.5 have been met for that Covered Code, and if You include a notice stating that the Source Code version of the Covered Code is available under the terms of this License, including a description of how and where You have fulfilled the obligations of Section 3.2. The notice must be conspicuously included in any notice in an Executable version, related documentation or collateral in which You describe recipients' rights relating to the Covered Code. You may distribute the Executable version of Covered Code or ownership rights under a license of Your choice, which may contain terms different from this License, provided that You are in compliance with the terms of this License and that the license for the Executable version does not attempt to limit or alter the recipient's rights in the Source Code version from the rights set forth in this License. If You distribute the Executable version under a different license You must make it absolutely clear that any terms which differ from this License are offered by You alone, not by the Initial Developer or any Contributor. You hereby agree to indemnify the Initial Developer and every Contributor for any liability incurred by the Initial Developer or such Contributor as a result of any such terms You offer.

     3.7. Larger Works. You may create a Larger Work by combining Covered Code with other code not governed by the terms of this License and distribute the Larger Work as a single product. In such a case, You must make sure the requirements of this License are fulfilled for the Covered Code.

4. Inability to Comply Due to Statute or Regulation.

If it is impossible for You to comply with any of the terms of this License with respect to some or all of the Covered Code due to statute, judicial order, or regulation then You must: (a) comply with the terms of this License to the maximum extent possible; and (b) describe the limitations and the code they affect. Such description must be included in the LEGAL file described in Section 3.4 and must be included with all distributions of the Source Code. Except to the extent prohibited by statute or regulation, such description must be sufficiently detailed for a recipient of ordinary skill to be able to understand it.

5. Application of this License.
This License applies to code to which the Initial Developer has attached the notice in Exhibit A and to related Covered Code.

6. Versions of the License.

     6.1. New Versions
     Netscape Communications Corporation ("Netscape") may publish revised and/or new versions of the License from time to time. Each version will be given a distinguishing version number.

     6.2. Effect of New Versions
     Once Covered Code has been published under a particular version of the License, You may always continue to use it under the terms of that version. You may also choose to use such Covered Code under the terms of any subsequent version of the License published by Netscape. No one other than Netscape has the right to modify the terms applicable to Covered Code created under this License.

     6.3. Derivative Works
     If You create or use a modified version of this License (which you may only do in order to apply it to code which is not already Covered Code governed by this License), You must (a) rename Your license so that the phrases "Mozilla", "MOZILLAPL", "MOZPL", "Netscape", "MPL", "NPL" or any confusingly similar phrase do not appear in your license (except to note that your license differs from this License) and (b) otherwise make it clear that Your version of the license contains terms which differ from the Mozilla Public License and Netscape Public License. (Filling in the name of the Initial Developer, Original Code or Contributor in the notice described in Exhibit A shall not of themselves be deemed to be modifications of this License.)

7. DISCLAIMER OF WARRANTY
COVERED CODE IS PROVIDED UNDER THIS LICENSE ON AN "AS IS" BASIS, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, WITHOUT LIMITATION, WARRANTIES THAT THE COVERED CODE IS FREE OF DEFECTS, MERCHANTABLE, FIT FOR A PARTICULAR PURPOSE OR NON-INFRINGING. THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE COVERED CODE IS WITH YOU. SHOULD ANY COVERED CODE PROVE DEFECTIVE IN ANY RESPECT, YOU (NOT THE INITIAL DEVELOPER OR ANY OTHER CONTRIBUTOR) ASSUME THE COST OF ANY NECESSARY SERVICING, REPAIR OR CORRECTION. THIS DISCLAIMER OF WARRANTY CONSTITUTES AN ESSENTIAL PART OF THIS LICENSE. NO USE OF ANY COVERED CODE IS AUTHORIZED HEREUNDER EXCEPT UNDER THIS DISCLAIMER.

8. Termination

     8.1. This License and the rights granted hereunder will terminate automatically if You fail to comply with terms herein and fail to cure such breach within 30 days of becoming aware of the breach. All sublicenses to the Covered Code which are properly granted shall survive any termination of this License. Provisions which, by their nature, must remain in effect beyond the termination of this License shall survive.

     8.2. If You initiate litigation by asserting a patent infringement claim (excluding declatory judgment actions) against Initial Developer or a Contributor (the Initial Developer or Contributor against whom You file such action is referred to as "Participant") alleging that:

          a. such Participant's Contributor Version directly or indirectly infringes any patent, then any and all rights granted by such Participant to You under Sections 2.1 and/or 2.2 of this License shall, upon 60 days notice from Participant terminate prospectively, unless if within 60 days after receipt of notice You either: (i) agree in writing to pay Participant a mutually agreeable reasonable royalty for Your past and future use of Modifications made by such Participant, or (ii) withdraw Your litigation claim with respect to the Contributor Version against such Participant. If within 60 days of notice, a reasonable royalty and payment arrangement are not mutually agreed upon in writing by the parties or the litigation claim is not withdrawn, the rights granted by Participant to You under Sections 2.1 and/or 2.2 automatically terminate at the expiration of the 60 day notice period specified above.
          b. any software, hardware, or device, other than such Participant's Contributor Version, directly or indirectly infringes any patent, then any rights granted to You by such Participant under Sections 2.1(b) and 2.2(b) are revoked effective as of the date You first made, used, sold, distributed, or had made, Modifications made by that Participant.

     8.3. If You assert a patent infringement claim against Participant alleging that such Participant's Contributor Version directly or indirectly infringes any patent where such claim is resolved (such as by license or settlement) prior to the initiation of patent infringement litigation, then the reasonable value of the licenses granted by such Participant under Sections 2.1 or 2.2 shall be taken into account in determining the amount or value of any payment or license.

     8.4. In the event of termination under Sections 8.1 or 8.2 above, all end user license agreements (excluding distributors and resellers) which have been validly granted by You or any distributor hereunder prior to termination shall survive termination.

9. LIMITATION OF LIABILITY
UNDER NO CIRCUMSTANCES AND UNDER NO LEGAL THEORY, WHETHER TORT (INCLUDING NEGLIGENCE), CONTRACT, OR OTHERWISE, SHALL YOU, THE INITIAL DEVELOPER, ANY OTHER CONTRIBUTOR, OR ANY DISTRIBUTOR OF COVERED CODE, OR ANY SUPPLIER OF ANY OF SUCH PARTIES, BE LIABLE TO ANY PERSON FOR ANY INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOSS OF GOODWILL, WORK STOPPAGE, COMPUTER FAILURE OR MALFUNCTION, OR ANY AND ALL OTHER COMMERCIAL DAMAGES OR LOSSES, EVEN IF SUCH PARTY SHALL HAVE BEEN INFORMED OF THE POSSIBILITY OF SUCH DAMAGES. THIS LIMITATION OF LIABILITY SHALL NOT APPLY TO LIABILITY FOR DEATH OR PERSONAL INJURY RESULTING FROM SUCH PARTY'S NEGLIGENCE TO THE EXTENT APPLICABLE LAW PROHIBITS SUCH LIMITATION. SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THIS EXCLUSION AND LIMITATION MAY NOT APPLY TO YOU.

10. U.S. government end users
The Covered Code is a "commercial item," as that term is defined in 48 C.F.R. 2.101 (Oct. 1995), consisting of "commercial computer software" and "commercial computer software documentation," as such terms are used in 48 C.F.R. 12.212 (Sept. 1995). Consistent with 48 C.F.R. 12.212 and 48 C.F.R. 227.7202-1 through 227.7202-4 (June 1995), all U.S. Government End Users acquire Covered Code with only those rights set forth herein.

11. Miscellaneous
This License represents the complete agreement concerning subject matter hereof. If any provision of this License is held to be unenforceable, such provision shall be reformed only to the extent necessary to make it enforceable. This License shall be governed by California law provisions (except to the extent applicable law, if any, provides otherwise), excluding its conflict-of-law provisions. With respect to disputes in which at least one party is a citizen of, or an entity chartered or registered to do business in the United States of America, any litigation relating to this License shall be subject to the jurisdiction of the Federal Courts of the Northern District of California, with venue lying in Santa Clara County, California, with the losing party responsible for costs, including without limitation, court costs and reasonable attorneys' fees and expenses. The application of the United Nations Convention on Contracts for the International Sale of Goods is expressly excluded. Any law or regulation which provides that the language of a contract shall be construed against the drafter shall not apply to this License.

12. Responsibility for claims
As between Initial Developer and the Contributors, each party is responsible for claims and damages arising, directly or indirectly, out of its utilization of rights under this License and You agree to work with Initial Developer and Contributors to distribute such responsibility on an equitable basis. Nothing herein is intended or shall be deemed to constitute any admission of liability.

13. Multiple-licensed code
Initial Developer may designate portions of the Covered Code as "Multiple-Licensed". "Multiple-Licensed" means that the Initial Developer permits you to utilize portions of the Covered Code under Your choice of the MPL or the alternative licenses, if any, specified by the Initial Developer in the file described in Exhibit A.

Exhibit A - Mozilla Public License.

"The contents of this file are subject to the Mozilla Public License Version 1.1 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.mozilla.org/MPL/

Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.

The Original Code is ______________________________________.

The Initial Developer of the Original Code is ________________________.
Portions created by ______________________ are Copyright (C) ______
_______________________. All Rights Reserved.

Contributor(s): ______________________________________.

Alternatively, the contents of this file may be used under the terms of the _____ license (the  "[___] License"), in which case the provisions of [______] License are applicable instead of those above. If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version of this file under the MPL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the MPL or the [___] License."

NOTE: The text of this Exhibit A may differ slightly from the text of the notices in the Source Code files of the Original Code. You should use the text of this Exhibit A rather than the text found in the Original Code Source Code for Your Modifications.
```

### 1.5 Apache License 2.0 の本文

pdf-lib 1.17.1 のソースの中のコメント (上の 1.1 に転記) が、次のファイルの一部を、Apache 2.0 のライセンスで提供されたものとしています。

- `node_modules/pdf-lib/es/core/streams/Stream.js`
- `node_modules/pdf-lib/es/core/streams/DecodeStream.js`
- `node_modules/pdf-lib/es/core/streams/FlateStream.js`
- `node_modules/pdf-lib/es/core/streams/RunLengthStream.js`
- `node_modules/pdf-lib/es/core/streams/AsciiHexStream.js`
- `node_modules/pdf-lib/es/core/streams/Ascii85Stream.js`
- `node_modules/pdf-lib/es/core/streams/LZWStream.js`

@pdf-lib/fontkit 1.1.1 の配布物に取り込まれた Brotli の展開のコード (上の 1.1.1) も、Google Inc. の Apache License 2.0 の表示を持っています。

pdf-lib のパッケージには、Apache License 2.0 の本文は入っていません。下の本文は、次の配布元から取得したものを、書き換えずに転記しています。

- 取得元: https://www.apache.org/licenses/LICENSE-2.0.txt (取得日 2026-10-31)

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### 1.6 バンドラーが出力に書き込む手助けのコード (rolldown 1.2.18・vite 8.3.8)

- package.json の license: `MIT` (rolldown・vite とも)
- 場所: `node_modules/rolldown`・`node_modules/vite`

画面 (`dist/`) とブラウザで単体で動くライブラリ (`dist-browser/`) を作るバンドラーは、出力に数十行の定型の手助けのコードを書き込みます。
rolldown は CommonJS の包みを ES モジュールとして読むためのコード (`rolldown-runtime-*.js` など。`__commonJS`・`__toESM`・`__export` などの関数) を、
Vite は、画面の出力に、別のチャンクを先読みするコード (`modulepreload` の補いと、動的な読み込みの前に先読みする手助け) を、
ブラウザで単体で動くライブラリの出力に、入っていない任意の依存 (linkedom の `canvas`) を読もうとしたときに誤りを投げる数行の代わり
(ソースマップの名前は `__vite-optional-peer-dep:canvas:linkedom`。`chunks/esm-*.js` に入ります) を書き込みます
(2026-11-21 に、`npm run build`・`npm run build:browser` の出力と、`--sourcemap` を付けて作ったソースマップの `sources` で確かめました)。
どちらも MIT のライセンスのコードなので、その表示をここに書きます。
rolldown の手助けのコード (`\0rolldown/runtime.js`) は、esbuild の手助けのコードと同じ形のもので、rolldown のパッケージの
`node_modules/rolldown/THIRD-PARTY-LICENSE` に、esbuild の MIT のライセンスの表示があるので、それも下に写します。

`node_modules/rolldown/LICENSE` の本文:

```text
MIT License

Copyright (c) 2024-present VoidZero Inc. & Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

end of terms and conditions

The licenses of externally maintained libraries from which parts of the Software is derived are listed [here](https://github.com/rolldown/rolldown/blob/main/THIRD-PARTY-LICENSE).
```

`node_modules/rolldown/THIRD-PARTY-LICENSE` のうち、esbuild の表示 (手助けのコードの元の形の著作権の行とライセンスの本文):

```text
MIT License

Copyright (c) 2020 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`node_modules/vite/LICENSE.md` の初めの、Vite 本体のライセンスの部分 (その後ろの「Licenses of bundled dependencies」以降は、Vite のパッケージに同梱された依存の表示で、出力には入りません):

```text
# Vite core license
Vite is released under the MIT license:

MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Node のコマンド (`dist-cli/cli.js`) とライブラリ (`dist-lib/`) を配布するときの依存

Node のコマンドとライブラリのビルドでは、次のパッケージはバンドルに入らず、実行時に node_modules から読み込まれます (上の 1 のパッケージも同じ)。npm の `kumiori` を入れると、これらも依存として一緒に入ります。
このうち @xmldom/xmldom と、linkedom とその依存 (html-escaper を除く) は、ブラウザで単体で動くライブラリ (`dist-browser/`) に取り込まれます (上の 1)。

### @xmldom/xmldom 0.9.12

- package.json の license: `MIT`
- 場所: `node_modules/@xmldom/xmldom`

`node_modules/@xmldom/xmldom/LICENSE` の本文:

```text
Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors
Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### linkedom 0.18.15

- package.json の license: `ISC`
- 場所: `node_modules/linkedom`

`node_modules/linkedom/LICENSE` の本文:

```text
ISC License

Copyright (c) 2021, Andrea Giammarchi, @WebReflection

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### htmlparser2 10.1.0

- package.json の license: `MIT`
- 場所: `node_modules/htmlparser2`

`node_modules/htmlparser2/LICENSE` の本文:

```text
Copyright 2010, 2011, Chris Winberry <chris@winberry.net>. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
 
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
 
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

### css-select 7.0.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/css-select`

`node_modules/css-select/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### css-what 8.0.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/css-what`

`node_modules/css-what/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### nth-check 3.0.1

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/nth-check`

`node_modules/nth-check/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### boolbase 2.0.0

- package.json の license: `ISC`
- 場所: `node_modules/boolbase`

`node_modules/boolbase/LICENSE` の本文:

```text
Copyright (c) 2014-2015, Felix Boehm <me@feedic.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### domhandler 6.0.1

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/domhandler`

`node_modules/domhandler/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### domhandler 5.0.3

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/htmlparser2/node_modules/domhandler`

`node_modules/htmlparser2/node_modules/domhandler/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### domutils 4.0.2

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/domutils`

`node_modules/domutils/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### domutils 3.2.2

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/htmlparser2/node_modules/domutils`

`node_modules/htmlparser2/node_modules/domutils/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### domelementtype 3.0.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/domelementtype`

`node_modules/domelementtype/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### domelementtype 2.3.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/htmlparser2/node_modules/domelementtype`

`node_modules/htmlparser2/node_modules/domelementtype/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### dom-serializer 3.1.1

- package.json の license: `MIT`
- 場所: `node_modules/dom-serializer`

`node_modules/dom-serializer/LICENSE` の本文:

```text
Copyright © 2022 The Cheerio contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### dom-serializer 2.0.0

- package.json の license: `MIT`
- 場所: `node_modules/htmlparser2/node_modules/dom-serializer`

`node_modules/htmlparser2/node_modules/dom-serializer/LICENSE` の本文:

```text
License

(The MIT License)

Copyright (c) 2014 The cheeriojs contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### entities 8.1.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/entities`

`node_modules/entities/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### entities 7.0.1

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/htmlparser2/node_modules/entities`

`node_modules/htmlparser2/node_modules/entities/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### entities 4.5.0

- package.json の license: `BSD-2-Clause`
- 場所: `node_modules/htmlparser2/node_modules/dom-serializer/node_modules/entities`

`node_modules/htmlparser2/node_modules/dom-serializer/node_modules/entities/LICENSE` の本文:

```text
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### cssomnom 0.1.11

- package.json の license: `Apache-2.0`
- 場所: `node_modules/cssomnom`

`node_modules/cssomnom/LICENSE` は Apache License 2.0 の本文で、上の 1.5 の本文と同じです (行末の空白を除いて一字も違いません)。
配布物のファイル (`node_modules/cssomnom/dist/index.js` など) の冒頭には、次の表示があります (`dist/index.js` の 5〜18 行目をそのまま):

```text
* @license
* Copyright 2026 Google LLC
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     https://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
```

### html-escaper 3.0.3

- package.json の license: `MIT`
- 場所: `node_modules/html-escaper`

`node_modules/html-escaper/LICENSE.txt` の本文:

```text
Copyright (C) 2017-present by Andrea Giammarchi - @WebReflection

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### uhyphen 0.2.0

- package.json の license: `ISC`
- 場所: `node_modules/uhyphen`

`node_modules/uhyphen/LICENSE` の本文:

```text
ISC License

Copyright (c) 2020, Andrea Giammarchi, @WebReflection

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## 3. Kumiori のコードが参照している文書と、派生元のソフトウェア (VP8・WebP)

Kumiori の `src/vp8.ts`・`src/vp8Tables.ts`・`src/webp.ts` (WebP の画像を読むコード) が、ファイルの中のコメントで参照している文書と、関連するライセンスの表示です。

- `src/vp8.ts` の一部は libwebp から派生しています。WHT と 4×4 の逆 DCT の組み立て (libwebp の `src/dsp/dec.c` の `TransformWHT_C`・`TransformOne_C`)、YUV → RGB の係数 (`src/dsp/yuv.h` の `VP8YUVToR`・`VP8YUVToG`・`VP8YUVToB`)、色差の補間 (`src/dsp/upsampling.c` の `UPSAMPLE_FUNC`)、予測の向きの番号が、libwebp と同じ手順・同じ値です。2026-11-08 に、libwebp の main ブランチのソース (GitHub の写し https://github.com/webmproject/libwebp) と比べて確かめました。
- そのため libwebp のライセンス (下の 3.4。BSD 3-Clause) に従い、`src/vp8.ts` の冒頭に libwebp の著作権表示と条文を載せています。配布物には、この文書で同じ表示を添えます。
- `src/webp.ts` は RFC 9649 の手順で書いたものですが、画素の加算 (`addPixels`) と平均 (`avg2`) の 2 つの小さな関数は、libwebp の `VP8LAddPixels` (`src/dsp/lossless_common.h`) と `Average2` (`src/dsp/lossless.c`) と同じ書き方です。この 2 つも libwebp から派生したものとして扱い、`src/webp.ts` の冒頭で libwebp の表示 (`src/vp8.ts` の冒頭とこの文書) を指しています。
- `src/vp8Tables.ts` の数表は RFC 6386 の表と同じ値です。RFC の表示 (下の 3.2・3.3) は、参照している文書の表示として載せています。

### 3.1 ファイルの中のコメント

- `src/vp8.ts` の冒頭 (2 行目): 「… RGBA にする (画像を Canvas に描けない環境 (Node) 用。RFC 6386)。」。6〜10 行目は libwebp から派生した部分の説明で、その後に libwebp の著作権表示と条文が続きます。
- `src/vp8Tables.ts` の冒頭 (2 行目): 「… VP8 (WebP の非可逆圧縮) の数表 (RFC 6386 の表と同じ値)。」
- `src/webp.ts` の冒頭 (2 行目): 「… WebP の画素を読む (画像を Canvas に描けない環境 (Node) 用。RFC 9649)。」。6〜8 行目は libwebp と同じ書き方の関数の説明です。
- `src/vp8.ts` の次のコメントは、libwebp と同じであることを述べています: 4 行目 (YUV → RGB)、424 行目 (「libwebp の TransformOne と同じ」)、455 行目 (フレームの外の値)、532 行目 (4×4 の予測)、695 行目 (YUV → RGBA)。94 行目は、予測の向きの番号を「libwebp の番号」としています。

### 3.2 RFC 6386 (VP8 Data Format and Decoding Guide) の著作権とライセンスの表示

- 取得元: https://www.rfc-editor.org/rfc/rfc6386.txt (取得日 2026-10-31)
- 下は原文からの引用です (書き換えていません。ページの区切りのヘッダー・フッターの行は含めていません)。
- RFC 6386 の Section 20 (Attachment One) は、参照用のデコーダのソースコードです。そのソースのファイルの冒頭には、下の「添付のソースのファイルの冒頭の表示」と同じ文が付いています (原文で 24 か所。うち 3 か所は、行頭の * の後の空白の数だけが違う)。

Copyright Notice (原文の 40〜50 行目):

```text
Copyright Notice

   Copyright (c) 2011 IETF Trust and the persons identified as the
   document authors.  All rights reserved.

   This document is subject to BCP 78 and the IETF Trust's Legal
   Provisions Relating to IETF Documents
   (http://trustee.ietf.org/license-info) in effect on the date of
   publication of this document.  Please review these documents
   carefully, as they describe your rights and restrictions with respect
   to this document.
```

添付のソースのファイルの冒頭の表示 (原文の 7405〜7413 行目。20.1 bit_ops.h の冒頭):

```text
   /*
    *  Copyright (c) 2010, 2011, Google Inc.  All rights reserved.
    *
    *  Use of this source code is governed by a BSD-style license
    *  that can be found in the LICENSE file in the root of the source
    *  tree.  An additional intellectual property rights grant can be
    *  found in the file PATENTS.  All contributing project authors may
    *  be found in the AUTHORS file in the root of the source tree.
    */
```

20.26. LICENSE (原文の 16813〜16844 行目):

```text
20.26.  LICENSE

   Copyright (c) 2010, 2011, Google Inc.  All rights reserved.

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions
   are met:

   o  Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

   o  Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in
      the documentation and/or other materials provided with the
      distribution.

   o  Neither the name of Google nor the names of its contributors may
      be used to endorse or promote products derived from this software
      without specific prior written permission.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
   INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
   BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
   OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
   AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
   LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
   WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   POSSIBILITY OF SUCH DAMAGE.
```

20.27. PATENTS (原文の 16863〜16887 行目):

```text
20.27.  PATENTS

   Additional IP Rights Grant (Patents)

   "This implementation" means the copyrightable works distributed by
   Google as part of the WebM Project.

   Google hereby grants to you a perpetual, worldwide, non-exclusive,
   no-charge, royalty-free, irrevocable (except as stated in this
   section) patent license to make, have made, use, offer to sell, sell,
   import, transfer, and otherwise run, modify and propagate the
   contents of this implementation of VP8, where such license applies
   only to those patent claims, both currently owned by Google and
   acquired in the future, licensable by Google that are necessarily
   infringed by this implementation of VP8.  This grant does not include
   claims that would be infringed only as a consequence of further
   modification of this implementation.  If you or your agent or
   exclusive licensee institute or order or agree to the institution of
   patent litigation against any entity (including a cross-claim or
   counterclaim in a lawsuit) alleging that this implementation of VP8
   or any code incorporated within this implementation of VP8
   constitutes direct or contributory patent infringement, or inducement
   of patent infringement, then any patent rights granted to you under
   this License for this implementation of VP8 shall terminate as of the
   date such litigation is filed.
```

### 3.3 RFC 9649 (WebP Image Format) の著作権とライセンスの表示

- 取得元: https://www.rfc-editor.org/rfc/rfc9649.txt (取得日 2026-10-31)
- 下は原文からの引用です (書き換えていません)。

Copyright Notice (原文の 35〜48 行目):

```text
Copyright Notice

   Copyright (c) 2024 IETF Trust and the persons identified as the
   document authors.  All rights reserved.

   This document is subject to BCP 78 and the IETF Trust's Legal
   Provisions Relating to IETF Documents
   (https://trustee.ietf.org/license-info) in effect on the date of
   publication of this document.  Please review these documents
   carefully, as they describe your rights and restrictions with respect
   to this document.  Code Components extracted from this document must
   include Revised BSD License text as described in Section 4.e of the
   Trust Legal Provisions and are provided without warranty as described
   in the Revised BSD License.
```

### 3.4 libwebp のライセンス

- 取得元: https://raw.githubusercontent.com/webmproject/libwebp/main/COPYING と https://raw.githubusercontent.com/webmproject/libwebp/main/PATENTS (main ブランチ。取得日 2026-10-31。コミットは特定していない)
- 下は原文の全文の引用です (書き換えていません)。

COPYING:

```text
Copyright (c) 2010, Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in
    the documentation and/or other materials provided with the
    distribution.

  * Neither the name of Google nor the names of its contributors may
    be used to endorse or promote products derived from this software
    without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

PATENTS:

```text
Additional IP Rights Grant (Patents)
------------------------------------

"These implementations" means the copyrightable works that implement the WebM
codecs distributed by Google as part of the WebM Project.

Google hereby grants to you a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable (except as stated in this section) patent license to
make, have made, use, offer to sell, sell, import, transfer, and otherwise
run, modify and propagate the contents of these implementations of WebM, where
such license applies only to those patent claims, both currently owned by
Google and acquired in the future, licensable by Google that are necessarily
infringed by these implementations of WebM. This grant does not include claims
that would be infringed only as a consequence of further modification of these
implementations. If you or your agent or exclusive licensee institute or order
or agree to the institution of patent litigation or any other patent
enforcement activity against any entity (including a cross-claim or
counterclaim in a lawsuit) alleging that any of these implementations of WebM
or any code incorporated within any of these implementations of WebM
constitute direct or contributory patent infringement, or inducement of
patent infringement, then any patent rights granted to you under this License
for these implementations of WebM shall terminate as of the date such
litigation is filed.
```

## 4. Kumiori のコードに写した W3C の文書の表 (MathML の演算子辞書)

`src/mathOperators.ts` の数の表 (演算子の分類・囲みの記号・区切りの記号・伸びる向き) は、W3C の文書 MathML Core の B.1 Operator Dictionary の表 (Figure 24〜28) を、スクリプトで数の並びに書き写したものです (値は変えていません)。

This software includes material copied from or derived from MathML Core (https://www.w3.org/TR/2025/CR-mathml-core-20250624/). Copyright © 2025 World Wide Web Consortium. https://www.w3.org/copyright/software-license-2023/

- 文書の取得元: https://www.w3.org/TR/mathml-core/ (取得日 2026-11-01。取得した版は W3C Candidate Recommendation Snapshot 24 June 2025、https://www.w3.org/TR/2025/CR-mathml-core-20250624/)
- 文書の著作権表示 (原文): 「Copyright © 2025 World Wide Web Consortium. W3C® liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/copyright/software-license-2023/
- 下はそのライセンスの本文です。取得元: https://www.w3.org/copyright/software-license-2023/ (取得日 2026-11-01)。HTML から文字だけを取り出しました (語句は書き換えていません。見出しと段落の区切りは改行にしています。末尾の版の一覧は含めていません)。

```text
Software and Document license - 2023 version

Status: This document is in effect since 1 January 2023.
This work is being provided by the copyright holders under the following license.
License
By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the work or portions thereof, including modifications:
The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the W3C software and document short notice should be included.
Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived from [title and URI of the W3C document]. Copyright © [$year-of-document] World Wide Web Consortium. https://www.w3.org/copyright/software-license-2023/"
Disclaimers
THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission. Title to copyright in this work will at all times remain with copyright holders.
```

## 5. Kumiori のコードに取り込んだ WHATWG の文書の CSS (HTML の既定のスタイルシート)

`src/cssCascade.ts` の `HTML_UA_CSS` の前半は、WHATWG の文書 HTML Living Standard の 15 章「Rendering」の CSS (15.3〜15.5) を取り込んだものです。組版に効かない規則は除き、文章で書かれた規則の一部を CSS で書き足しています。
同じファイルの `QUIRKS_UA_CSS` (互換モードの文書の既定のスタイル) も、同じ 15 章の「In quirks mode」の規則 (15.3.3・15.3.7・15.3.8・15.3.10・15.4.2) を取り込んだものです。

- 文書の取得元: https://html.spec.whatwg.org/multipage/rendering.html (取得日 2026-11-04。Living Standard のため、版の名前はありません)
- 文書の著作権表示とライセンス (原文。取得元: https://html.spec.whatwg.org/multipage/acknowledgements.html 、取得日 2026-11-04): 「Copyright © WHATWG (Apple, Google, Mozilla, Microsoft). This work is licensed under a Creative Commons Attribution 4.0 International License. To the extent portions of it are incorporated into source code, such portions in the source code are licensed under the BSD 3-Clause License instead.」。BSD 3-Clause License のリンク先は https://opensource.org/licenses/BSD-3-Clause
- 下は BSD 3-Clause License の本文です。opensource.org はこの環境から取得できなかったため、SPDX のライセンスの一覧を収めた npm の包み spdx-license-list 6.12.0 (https://registry.npmjs.org/spdx-license-list/-/spdx-license-list-6.12.0.tgz 、取得日 2026-11-04) の `licenses/BSD-3-Clause.json` の本文を、そのまま写しています (1 行目の `<year> <owner>` は雛形の字のままです。この部分の著作権者の表示は、上の「Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).」です)。

```text
Copyright (c) <year> <owner>. 

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## 6. Kumiori のコードに写した Unicode の文字データ (改行・縦書きの字の向き・双方向のテキスト・字のつながり・書記素クラスタ)

`src/unicodeData.ts` の表は、Unicode の文字データベース (UCD) 18.0.0 の LineBreak.txt・EastAsianWidth.txt・VerticalOrientation.txt・extracted/DerivedGeneralCategory.txt (Mn・Mc・Pi・Pf・Cn だけ)・emoji/emoji-data.txt (Extended_Pictographic だけ)・extracted/DerivedBidiClass.txt・BidiMirroring.txt・BidiBrackets.txt・extracted/DerivedJoiningType.txt・auxiliary/GraphemeBreakProperty.txt・DerivedCoreProperties.txt (Indic_Conjunct_Break だけ) の値を、`scripts/gen-unicode-data.mjs` で範囲の並びに書き写したものです (値は変えていません)。

- データの取得元: https://www.unicode.org/Public/18.0.0/ucd/ (取得日 2026-11-04。extracted/DerivedJoiningType.txt は 2026-11-05、auxiliary/GraphemeBreakProperty.txt・DerivedCoreProperties.txt は 2026-11-10)
- 各ファイルの著作権表示 (原文): 「© 2026 Unicode®, Inc.」
- 下は Unicode License v3 の本文です。取得元: https://www.unicode.org/license.txt (取得日 2026-11-04)。書き換えずに写しています。

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

## 7. Kumiori のコードに写した W3C の文書の CSS (CSS Counter Styles 3 の定義済みの数え方)

`src/counterStylePredefined.ts` の `@counter-style` の規則 (§6 Simple Predefined Counter Styles と、§7.1.1 和文・§7.1.2 韓国語の規則) は、W3C の文書 CSS Counter Styles Level 3 の例の規則を写したものです (規則 (記述子と値) は書き換えていません。注釈のうち、字を並べただけのもの (記号の字の一覧) は写したまま残し、英文の注釈 (hebrew・disclosure-open・disclosure-closed・韓国語の 3 つ) だけを、日本語の要約に置き換えています)。

This software includes material copied from or derived from CSS Counter Styles Level 3 (https://www.w3.org/TR/2021/CR-css-counter-styles-3-20210727/). Copyright © 2021 W3C® (MIT, ERCIM, Keio, Beihang).

- 文書の取得元: https://www.w3.org/TR/css-counter-styles-3/ (取得日 2026-11-06。2026-11-07 に取り直した文書の版は W3C Candidate Recommendation Snapshot 27 July 2021、https://www.w3.org/TR/2021/CR-css-counter-styles-3-20210727/ で、Kumiori の規則 49 個は、記述子と値がすべて、その文書の例の規則と同じだった (規則についての比べで、空白の違いを無視した。英文の注釈はその後で日本語に置き換えたので、注釈はいまは例と違う))
- 文書の著作権表示 (原文): 「Copyright © 2021 W3C® (MIT, ERCIM, Keio, Beihang). W3C liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document (https://www.w3.org/copyright/software-license-2015/ に転送される)
- 下はそのライセンスの本文です。取得元: https://www.w3.org/copyright/software-license-2015/ (取得日 2026-11-07)。HTML から文字だけを取り出しました (語句は書き換えていません。見出しと段落の区切りは改行にしています。末尾の版の一覧と変更点の説明は含めていません)。

```text
Software and Document license - 2015 version
Status: This license was in effect between 13 May 2015 and 31 December 2022. It was replaced by this version.
This work is being provided by the copyright holders under the following license.
License
By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the work or portions thereof, including modifications:
The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the W3C Software and Document Short Notice should be included.
Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived from [title and URI of the W3C document]. Copyright © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."
Disclaimers
THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission. Title to copyright in this work will at all times remain with copyright holders.
```

## 8. Kumiori のコードに写した W3C の文書の CSS (CSS Ruby 1 の既定のスタイルシート)

`src/cssCascade.ts` の `HTML_UA_CSS` の後半にあるルビの規則 (rbc・rtc・rb の display、ruby・rb・rt・rbc・rtc の unicode-bidi、rtc・rt の font-variant-east-asian・text-justify・text-emphasis・white-space・line-height・font-size) は、W3C の文書 CSS Ruby Annotation Layout Module Level 1 の付録 A.1 (Default stylesheet) の規則を写したものです。台湾の注音の規則 (font-size: 30%) は、セレクタの並びの終わりに `,` があって無効な規則なので写していません。ruby・rp・rt の display は、HTML Living Standard の規則 (上の 5 節) で決まるので、ここでは写していません。

This software includes material copied from or derived from CSS Ruby Annotation Layout Module Level 1 (https://www.w3.org/TR/2022/WD-css-ruby-1-20221231/). Copyright © 2022 W3C® (MIT, ERCIM, Keio, Beihang).

- 文書の取得元: https://www.w3.org/TR/css-ruby-1/#default-stylesheet (2026-11-08 に取り直した文書の版は W3C Working Draft 31 December 2022、https://www.w3.org/TR/2022/WD-css-ruby-1-20221231/)
- 文書の著作権表示 (原文): 「Copyright © 2022 W3C® (MIT, ERCIM, Keio, Beihang). W3C liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document (https://www.w3.org/copyright/software-license-2015/ に転送される)
- ライセンスの本文は、上の 7 節に写した Software and Document license - 2015 version と同じです。

## 9. Kumiori のコードに写した W3C の文書の CSS (CSS 2.1 の付録 D の既定のスタイルシート)

`src/htmlPrepare.ts` の `CSS21_DEFAULT_CSS` (`--style ah` の既定) は、W3C の文書 CSS 2.1 の付録 D「Default style sheet for HTML 4」の規則のうち、ブラウザ (Chrome) の既定と違うものを写したものです。ol・ul の字下げ (margin-left: 40px を padding-left: 2.5em に)、figure の左右の余白、sub・sup の line-height は、Kumiori が変えたり足したりしています (変えた点は `src/htmlPrepare.ts` のコメントに書いています)。

This software includes material copied from or derived from Cascading Style Sheets Level 2 Revision 1 (CSS 2.1) Specification, Appendix D. Default style sheet for HTML 4 (https://www.w3.org/TR/2011/REC-CSS2-20110607/sample.html). Copyright © 2011 W3C® (MIT, ERCIM, Keio), All Rights Reserved.

- 文書の取得元: https://www.w3.org/TR/CSS2/sample.html (取得日 2026-11-05。2026-11-08 に取り直した文書の版は https://www.w3.org/TR/2011/REC-CSS2-20110607 )
- 文書の状態 (原文): 「W3C Recommendation 07 June 2011, edited in place 12 April 2016 to point to new work, edited in place 07 December 2021 to correct markup.」
- 文書の著作権表示 (原文。文書の表紙 https://www.w3.org/TR/CSS2/ にあるもの): 「Copyright © 2011 W3C® (MIT, ERCIM, Keio), All Rights Reserved. W3C liability, trademark and document use rules apply.」。document use のリンク先は https://www.w3.org/Consortium/Legal/copyright-documents (https://www.w3.org/copyright/document-license-2023/ に転送される)
- 下はそのライセンスの本文です。取得元: https://www.w3.org/copyright/document-license-2023/ (取得日 2026-11-08)。HTML から文字だけを取り出しました (語句は書き換えていません。見出しと段落の区切りは改行にしています。末尾の版の一覧と変更点の説明は含めていません)。

```text
Document license - 2023 version
Status: This document is in effect since 1 January 2023.
Public documents on the W3C site are provided by the copyright holders under the following license.
License
By using and/or copying this document, or the W3C document from which this statement is linked, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions:
Permission to copy, and distribute the contents of this document, or the W3C document from which this statement is linked, in any medium for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the document, or portions thereof, that you use:
A link or URL to the original W3C document.
The pre-existing copyright notice of the original author, or if it doesn't exist, a notice (hypertext is preferred, but a textual representation is permitted) of the form: "Copyright © [$date-of-document] World Wide Web Consortium. https://www.w3.org/copyright/document-license-2023/"
If it exists, the STATUS of the W3C document.
When space permits, inclusion of the full text of this NOTICE should be provided. We request that authorship attribution be provided in any software, documents, or other items or products that you create pursuant to the implementation of the contents of this document, or any portion thereof.
No right to create modifications or derivatives of W3C documents is granted pursuant to this license, except as follows: To facilitate implementation of the technical specifications set forth in this document, anyone may prepare and distribute derivative works and portions of this document in software, in supporting materials accompanying software, and in documentation of software, PROVIDED that all such works include the notice below. HOWEVER, the publication of derivative works of this document for use as a technical specification is expressly prohibited.
In addition, "Code Components" —Web IDL in sections clearly marked as Web IDL; and W3C-defined markup (HTML, CSS, etc.) and computer programming language code clearly marked as code examples— are licensed under the W3C Software License.
The notice is:
"Copyright © 2023 W3C®. This software or document includes material copied from or derived from [title and URI of the W3C document]."
Disclaimers
THIS DOCUMENT IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR TITLE; THAT THE CONTENTS OF THE DOCUMENT ARE SUITABLE FOR ANY PURPOSE; NOR THAT THE IMPLEMENTATION OF SUCH CONTENTS WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE DOCUMENT OR THE PERFORMANCE OR IMPLEMENTATION OF THE CONTENTS THEREOF.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to this document or its contents without specific, written prior permission. Title to copyright in this document will at all times remain with copyright holders.
```

## 10. Kumiori のコードに写した W3C の文書の CSS (CSS GCPM 3 の付録 B の既定のスタイルシート)

`src/htmlPrepare.ts` の `GCPM_BOOKMARK_CSS` (見出しのしおり。どの `--style` の既定にも入る) は、W3C の文書 CSS Generated Content for Paged Media Module の付録 B「Default UA Stylesheet」の規則のうち、h1〜h6 の bookmark-level の 6 行を、書き換えずに写したものです。

This software includes material copied from or derived from CSS Generated Content for Paged Media Module, Appendix B: Default UA Stylesheet (https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/). Copyright © 2024 World Wide Web Consortium.

- 文書の取得元: https://www.w3.org/TR/css-gcpm-3/ (取得日 2026-11-09。文書の版は W3C Working Draft, 25 January 2024、https://www.w3.org/TR/2024/WD-css-gcpm-3-20240125/)
- 文書の著作権表示 (原文): 「Copyright © 2024 World Wide Web Consortium. W3C® liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/copyright/software-license/ (https://www.w3.org/copyright/software-license-2023/ に転送される)
- 下はそのライセンスの本文です。取得元: https://www.w3.org/copyright/software-license-2023/ (取得日 2026-11-09)。HTML から文字だけを取り出しました (語句は書き換えていません。見出しと段落の区切りは改行にしています。末尾の版の一覧のうち、ほかのライセンスへの案内は除きました)。

```text
Software and Document license - 2023 version
Status:
This document is in effect since 1 January 2023.
This work is being provided by the copyright holders under the following license.
License
By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the work or portions thereof, including modifications:
The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the
W3C software and document short notice
should be included.
Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived from [title and URI of the W3C document]. Copyright © [$year-of-document]
World Wide Web Consortium
.
https://www.w3.org/copyright/software-license-2023/
"
Disclaimers
THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission. Title to copyright in this work will at all times remain with copyright holders.
Versions
This version:
https://www.w3.org/copyright/software-license-2023/
Latest version:
https://www.w3.org/copyright/software-license/
Previous version:
https://www.w3.org/copyright/software-license-2015/
Changes since the previous document
The 2023 version updates identification of the copyright holder.
```

## 11. Kumiori のコードに写した W3C の文書の値と式 (CSS Color 4 の色の変換の見本のコード)

`src/cssColorFunctions.ts` の色の変換 (色空間と CIE XYZ の間の行列、伝達関数、白色点、Bradford の色順応の行列、HSL・HWB・Lab・LCH・Oklab・OkLCh の変換の式、力の無い成分を欠けた成分にする決まり、ΔEOK) は、W3C の文書 CSS Color Module Level 4 の本文の見本のコード (7.1・7.2・8.1・8.2 節、19 節「Sample code for Color Conversions」、20.3 節) の値と式を、TypeScript に書き直したものです (行列と定数の値は変えていません)。色域に収める手順は、同じ文書の 14.2.2 節の擬似コードに従って書いたものです。

This software includes material copied from or derived from CSS Color Module Level 4 (https://www.w3.org/TR/2026/CRD-css-color-4-20261103/). Copyright © 2026 World Wide Web Consortium. https://www.w3.org/copyright/software-license-2023/

- 文書の取得元: https://www.w3.org/TR/css-color-4/ (取得日 2026-11-10。取得した版は W3C Candidate Recommendation Draft、https://www.w3.org/TR/2026/CRD-css-color-4-20261103/)
- 文書の著作権表示 (原文): 「Copyright © 2026 World Wide Web Consortium. W3C® liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/copyright/software-license/ (2026-11-10 の時点で https://www.w3.org/copyright/software-license-2023/ に転送される)
- ライセンスの本文は、上の 4 節に写した Software and Document license - 2023 version と同じです。

## 12. Kumiori のコードに写した W3C の文書の見本のコード (Filter Effects 1 の feTurbulence の参照の実装)

`src/svgFilterRaster.ts` の feTurbulence のノイズ (`turbulenceInit`・`noise2`・`turbulence`) は、W3C の文書 Filter Effects Module Level 1 の 9.21 節 (Filter primitive feTurbulence) の参照の実装 (C のコード) を、TypeScript に書き直したものです (乱数の作り方・格子の勾配の表の作り方・ノイズの補間・オクターブの足し方・タイルのつなぎ方の手順と定数は変えていません)。

This software or document includes material copied from or derived from Filter Effects Module Level 1 (https://www.w3.org/TR/2018/WD-filter-effects-1-20181218/). Copyright © 2018 W3C® (MIT, ERCIM, Keio, Beihang).

- 文書の取得元: https://www.w3.org/TR/filter-effects-1/ (取得日 2026-11-12。取得した版は W3C Working Draft 18 December 2018、https://www.w3.org/TR/2018/WD-filter-effects-1-20181218/)
- 文書の著作権表示 (原文): 「Copyright © 2018 W3C® (MIT, ERCIM, Keio, Beihang). W3C liability, trademark and permissive document license rules apply.」。permissive document license のリンク先は https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document (Software and Document license - 2015 version)
- 下はそのライセンスの本文です。取得元: https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document (取得日 2026-11-12)。HTML から文字だけを取り出しました (語句は書き換えていません。見出しと段落の区切りは改行にしています。言語の選び方の案内と、末尾の版の一覧・変更の説明は含めていません)。

```text
Software and Document license - 2015 version

Status: This license was in effect between 13 May 2015 and 31 December 2022. It was replaced by this version.
This work is being provided by the copyright holders under the following license.
License
By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the work or portions thereof, including modifications:
The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the W3C Software and Document Short Notice should be included.
Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived from [title and URI of the W3C document]. Copyright © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."
Disclaimers
THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission. Title to copyright in this work will at all times remain with copyright holders.
```

## 13. Kumiori のコードに移した draw.io と mxGraph のソース (draw.io の図)

draw.io の図 (`.drawio`・`.dio`) を描く次のファイルは、draw.io (diagrams.net) と mxGraph の公開のソース (https://github.com/jgraph/drawio 。`src/main/webapp/shapes/` の下のファイルは版 v24.7.5、そのほかは版 v32.6.10) の JavaScript の形の描き方 (各形の `paintVertexShape`・`redrawPath`、線の端の形、線の曲げ方、mxStencil の形の命令の解釈、`stencils.min.js` の読み方) と、既定のスタイル (`src/main/webapp/styles/default.xml`) を、TypeScript に書き直したものです。各ファイルの先頭のコメントに、移したソースのファイルの名前を書いています。

- `src/drawio/` の `drawio.ts`・`drawioCanvas.ts`・`drawioEdges.ts`・`drawioShapes.ts`・`drawioShapesA.ts`・`drawioShapesB.ts`・`drawioSketch.ts` (draw.io の Editor.js の RoughCanvas と Shapes.js の HandJiggle)・`drawioStencil.ts`・`drawioTapered.ts`
- `src/drawio/drawioJs/` の各ファイル (draw.io の `src/main/webapp/shapes/` の形)

`src/drawio/` のほかのファイル (`load.ts`・`drawioXml.ts`・`sniff.ts` など) は Kumiori で書いたもので、draw.io と mxGraph のソースを移していません。

ソースのライセンスは Apache License 2.0 です (本文は 1.5 節。Kumiori 自身のライセンスと同じ)。Apache License 2.0 の 4 項に従い、次のようにしています。

- (b) 変更したことの表示: 移した各ファイルの先頭のコメントに、元のファイルの名前と、TypeScript に書き直して変更したことを書いています。
- (c) 著作権表示を残す: 移した各ファイルの先頭のコメントに、元のファイルの先頭の著作権表示を、書き換えずに写しています。元のファイルとその表示の一覧は、下の 13.1 節にあります。
- (d) NOTICE: draw.io のリポジトリには、v24.7.5 にも v32.6.10 にも NOTICE のファイルがありません (2026-11-15 に、両方の版のファイルの一覧で確かめました)。
- ビルドした JavaScript (画面の `dist/`・`dist-browser/`・`dist-lib/`・`dist-cli/` の、これらのファイルを取り込んだもの) は、縮めるとコメントが除かれるので、ファイルの先頭に、draw.io と mxGraph の著作権表示とこの文書の場所を書いています。

Kumiori は、draw.io の図形ライブラリのデータ (`stencils/` の XML と `js/stencils.min.js`) とアイコンの画像を含みません (使う人が渡すか、許したときだけ取ります)。
`src/drawio/drawioJs/` の各ファイル (と `src/drawio/drawioShapes.ts` などの一部の形) は、draw.io の `src/main/webapp/shapes/` の形 (JavaScript で書かれた図形ライブラリ。AWS 3D・モックアップ・電気の図など) を書き直したものです。
draw.io は v29.3.2 から `shapes/` に利用の制限 (`shapes/LICENSE`。下の 13.2 節) を付けましたが、Kumiori に移した `shapes/` の形は、その前の v24.7.5 から移したもので、その制限はかかりません (13.2 節)。
v24.7.5 より後に足された形・style のキー・描き方の変更は入れず、v24.7.5 の描き方にそろえています。

移した JavaScript の形には、他社の製品のアイコン・画面の部品を、画像でなく経路の座標として描くものがあります。

- AWS 3D の形 (`mxgraph.aws3d.*` の 57 種類。`src/drawio/drawioJs/aws3d.ts`): Amazon Web Services のサービスのアイコン (`dynamoDb`・`cloudfront`・`lambda`・`s3`・`rds`・`route53` など) と、Oracle のデータセンター・サーバーの形 (`oracleDataCenter`・`oracleDbServer`・`oracleServer`) を含みます
- Atlassian の Jira の課題の形 (`mxgraph.atlassian.issue`。`src/drawio/drawioJs/misc.ts`)
- 携帯の端末と画面の部品の形 (`src/drawio/drawioJs/ui.ts`・`mockupIos.ts`): Apple の iOS (`mxgraph.ios.*`・`mxgraph.ios7ui.*`。iPhone・iPad の端末の形を含みます)、Google の Android (`mxgraph.android.*`)、Google の Material Design (`mxgraph.gmdl.*`)
- Bootstrap の画面の部品の形 (`mxgraph.bootstrap.*`。`src/drawio/drawioJs/ui.ts`)

これらの形の名前と意匠 (商標を含みます) は、各社のものです。Kumiori は各社と関係が無く、Kumiori がこれらの形を描けることは、各社の承認や後援を意味しません。

draw.io v24.7.5 の README の「License」の節は、次のように書いています (取得元: https://github.com/jgraph/drawio/blob/v24.7.5/README.md 。取得日 2026-11-16。2 つの段落の始めの部分を抜き出し、リンクの記法を除いたもの)。
draw.io の書いたソースは Apache License 2.0、JGraph の提供するアイコンと図のひな形は CC BY 4.0 で、第三者が元の権利を持つアイコンには別の条件が掛かることがある、という趣旨です。

```text
The source code authored by us in this repo is licensed under the Apache v2.
The JGraph provided icons and diagram templates are licensed under the CC BY 4.0. Additional terms may also apply where the icons are originally defined by a third-party copyright holder.
```

Kumiori は、`src/main/webapp/shapes/` の `*.js` を、この「ソース」(Apache License 2.0) として扱っています。v24.7.5 の `shapes/` には LICENSE のファイルが無く (13.2 節)、各ファイルの先頭の表示は JGraph Ltd の著作権表示だけです (13.1 節)。
これらの形を含む図を PDF にして人に配る・公開するときは、各社の商標・ブランド・アイコンの使い方の決まりを、使う人が確かめて、それに従ってください。この節は、ライセンスの解釈や法的な判断を示すものではありません。

許したときに取る (`drawio.fetchStencils`。コマンドは `--fetch-drawio-stencils`) 図形ライブラリ (`js/stencils.min.js`・`stencils/` の XML) と配布物の画像 (`img/`) は、既定では draw.io v24.7.5 のものです。そのライセンスは、v24.7.5 の `src/main/webapp/stencils/LICENSE`・`src/main/webapp/img/LICENSE` の Creative Commons Attribution 4.0 International (CC BY 4.0) です。
使う人が `drawio.stencils` (コマンドは `--drawio-stencils`) で渡すもの、`drawio.fetchStencils` の URL (コマンドは `--drawio-stencils-url`) で別の版から取るものには、その版の LICENSE がかかります (v29.3.2 から後の版の `stencils/`・`img/` には、13.2 節の制限が付いています)。

### 13.1 元のファイルと著作権表示

移した、または描き方を合わせた draw.io のファイルと、その先頭の著作権表示 (原文) です。「版」は移した版で、`src/main/webapp/shapes/` の下は v24.7.5 (13.2 節)、そのほかは v32.6.10 です。著作権表示は、その版のファイルから写しました (2026-11-15)。「(無い)」は、その版のファイルの先頭に著作権表示が無いものです。mxGraph のファイルは、draw.io のリポジトリの中の `src/main/webapp/mxgraph/src/` のものです。

| 元のファイル | 版 | 著作権表示 | Kumiori のファイル (`src/drawio/` の下) |
| --- | --- | --- | --- |
| `src/main/webapp/js/diagramly/App.js` | v32.6.10 | `Copyright (c) 2006-2020, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2020, draw.io AG` | `drawioStencil.ts` |
| `src/main/webapp/js/diagramly/Editor.js` | v32.6.10 | `Copyright (c) 2006-2026, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2026, draw.io AG` | `drawio.ts`・`drawioSketch.ts` |
| `src/main/webapp/js/diagramly/GraphViewer.js` | v32.6.10 | `Copyright (c) 2006-2016, JGraph Holdings Ltd` | `drawio.ts` |
| `src/main/webapp/js/grapheditor/Graph.js` | v32.6.10 | `Copyright (c) 2006-2012, JGraph Holdings Ltd` | `drawio.ts`・`drawioEdges.ts`・`drawioShapesA.ts`・`drawioStencil.ts`・`drawioTapered.ts` |
| `src/main/webapp/js/grapheditor/Shapes.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd` | `drawio.ts`・`drawioCanvas.ts`・`drawioEdges.ts`・`drawioJs/basic.ts`・`drawioJs/bpmn.ts`・`drawioShapes.ts`・`drawioShapesA.ts`・`drawioShapesB.ts`・`drawioSketch.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/model/mxCell.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/model/mxGeometry.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/model/mxGraphModel.js` | v32.6.10 | `Copyright (c) 2006-2018, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2018, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/shape/mxActor.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/archimate.ts`・`drawioJs/misc.ts`・`drawioShapesA.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/shape/mxArrow.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawioEdges.ts`・`drawioJs/arrows.ts`・`drawioJs/edges.ts` |
| `src/main/webapp/mxgraph/src/shape/mxArrowConnector.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioEdges.ts` |
| `src/main/webapp/mxgraph/src/shape/mxCloud.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/shape/mxConnector.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioEdges.ts` |
| `src/main/webapp/mxgraph/src/shape/mxCylinder.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioShapesA.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/shape/mxDoubleEllipse.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/shape/mxEllipse.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/archimate.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/shape/mxLine.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/shape/mxMarker.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioEdges.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/shape/mxPolyline.js` | v32.6.10 | `Copyright (c) 2006-2026, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2026, draw.io AG` | `drawio.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/shape/mxRectangleShape.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/misc.ts`・`drawioShapes.ts`・`drawioShapesA.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/shape/mxRhombus.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/shape/mxShape.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioCanvas.ts`・`drawioJs/basic.ts`・`drawioJs/electrical.ts`・`drawioJs/misc.ts`・`drawioJs/mockupIos.ts`・`drawioShapes.ts`・`drawioShapesA.ts`・`drawioShapesB.ts`・`drawioStencil.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/shape/mxStencil.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioCanvas.ts`・`drawioStencil.ts` |
| `src/main/webapp/mxgraph/src/shape/mxStencilRegistry.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/archimate.ts`・`drawioJs/misc.ts`・`drawioStencil.ts` |
| `src/main/webapp/mxgraph/src/shape/mxSwimlane.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/bpmn.ts` |
| `src/main/webapp/mxgraph/src/shape/mxText.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/util/mxAbstractCanvas2D.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawioCanvas.ts`・`drawioJs/electrical.ts`・`drawioJs/mockup.ts`・`drawioJs/mockupIos.ts`・`drawioStencil.ts` |
| `src/main/webapp/mxgraph/src/util/mxConstants.js` | v32.6.10 | `Copyright (c) 2006-2026, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2026, draw.io AG` | `drawio.ts`・`drawioEdges.ts`・`drawioJs/bpmn.ts`・`drawioJs/mockup.ts`・`drawioJs/ui.ts`・`drawioShapesA.ts`・`drawioShapesB.ts`・`drawioStencil.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/util/mxPoint.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioShapesB.ts` |
| `src/main/webapp/mxgraph/src/util/mxSvgCanvas2D.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioCanvas.ts`・`drawioJs/arrows.ts`・`drawioJs/bpmn.ts`・`drawioJs/electrical.ts`・`drawioJs/misc.ts`・`drawioJs/mockup.ts`・`drawioJs/mockupIos.ts`・`drawioJs/ui.ts`・`drawioStencil.ts` |
| `src/main/webapp/mxgraph/src/util/mxUtils.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioEdges.ts`・`drawioJs/archimate.ts`・`drawioJs/arrows.ts`・`drawioJs/basic.ts`・`drawioJs/bpmn.ts`・`drawioJs/electrical.ts`・`drawioJs/mockup.ts`・`drawioJs/mockupIos.ts`・`drawioJs/ui.ts`・`drawioShapes.ts`・`drawioShapesB.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/view/mxCellRenderer.js` | v32.6.10 | `Copyright (c) 2006-2017, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2017, draw.io AG` | `drawio.ts`・`drawioJs/archimate.ts`・`drawioJs/arrows.ts`・`drawioJs/basic.ts`・`drawioJs/bpmn.ts` |
| `src/main/webapp/mxgraph/src/view/mxEdgeStyle.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/view/mxGraph.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioCanvas.ts`・`drawioEdges.ts`・`drawioJs/archimate.ts`・`drawioJs/arrows.ts`・`drawioJs/basic.ts`・`drawioJs/bpmn.ts`・`drawioJs/electrical.ts`・`drawioJs/misc.ts`・`drawioJs/mockup.ts`・`drawioJs/ui.ts`・`drawioShapesA.ts`・`drawioShapesB.ts`・`drawioStencil.ts`・`drawioTapered.ts` |
| `src/main/webapp/mxgraph/src/view/mxGraphView.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioEdges.ts` |
| `src/main/webapp/mxgraph/src/view/mxPerimeter.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts` |
| `src/main/webapp/mxgraph/src/view/mxStylesheet.js` | v32.6.10 | `Copyright (c) 2006-2015, JGraph Holdings Ltd`<br>`Copyright (c) 2006-2015, draw.io AG` | `drawio.ts`・`drawioJs/arrows.ts`・`drawioJs/basic.ts`・`drawioJs/bpmn.ts`・`drawioJs/ui.ts` |
| `src/main/webapp/shapes/bpmn/mxBpmnShape2.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/bpmn.ts` |
| `src/main/webapp/shapes/emoji/mxEmoji.js` | v24.7.5 | (無い) | `drawioJs/misc.ts` |
| `src/main/webapp/shapes/er/mxER.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioEdges.ts`・`drawioJs/bpmn.ts` |
| `src/main/webapp/shapes/ios7/mxIOS7Ui.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/ui.ts` |
| `src/main/webapp/shapes/mockup/mxMockupButtons.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupContainers.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupForms.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupGraphics.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupMarkup.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockupIos.ts` |
| `src/main/webapp/shapes/mockup/mxMockupMisc.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupNavigation.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockupIos.ts` |
| `src/main/webapp/shapes/mockup/mxMockupText.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockup.ts` |
| `src/main/webapp/shapes/mockup/mxMockupiOS.js` | v24.7.5 | `Copyright (c) 2006-2010, JGraph Ltd` | `drawioJs/mockupIos.ts` |
| `src/main/webapp/shapes/mxAWS3D.js` | v24.7.5 | `Copyright (c) 2006-2015, JGraph Ltd` | `drawioJs/aws3d.ts` |
| `src/main/webapp/shapes/mxAWS4.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioShapes.ts` |
| `src/main/webapp/shapes/mxAndroid.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/ui.ts` |
| `src/main/webapp/shapes/mxArchiMate.js` | v24.7.5 | `Copyright (c) 2006-2014, JGraph Ltd` | `drawioJs/archimate.ts` |
| `src/main/webapp/shapes/mxArchiMate3.js` | v24.7.5 | `Copyright (c) 2006-2016, JGraph Ltd` | `drawioJs/archimate.ts` |
| `src/main/webapp/shapes/mxArrows.js` | v24.7.5 | `Copyright (c) 2006-2016, JGraph Ltd` | `drawioJs/arrows.ts` |
| `src/main/webapp/shapes/mxAtlassian.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/misc.ts` |
| `src/main/webapp/shapes/mxBasic.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/basic.ts` |
| `src/main/webapp/shapes/mxBootstrap.js` | v24.7.5 | `Copyright (c) 2006-2014, JGraph Ltd` | `drawioJs/ui.ts` |
| `src/main/webapp/shapes/mxC4.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/archimate.ts` |
| `src/main/webapp/shapes/mxCabinets.js` | v24.7.5 | `Copyright (c) 2006-2014, JGraph Ltd` | `drawioJs/arrows.ts` |
| `src/main/webapp/shapes/mxCisco19.js` | v24.7.5 | `Copyright (c) 2006-2020, JGraph Ltd` | `drawioShapes.ts` |
| `src/main/webapp/shapes/mxCiscoSafe.js` | v24.7.5 | `Copyright (c) 2006-2020, JGraph Ltd` | `drawioShapes.ts` |
| `src/main/webapp/shapes/mxDFD.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/archimate.ts` |
| `src/main/webapp/shapes/mxEip.js` | v24.7.5 | `Copyright (c) 2006-2015, JGraph Ltd` | `drawioJs/arrows.ts` |
| `src/main/webapp/shapes/mxElectrical.js` | v24.7.5 | `Copyright (c) 2006-2016, JGraph Ltd` | `drawioJs/electrical.ts` |
| `src/main/webapp/shapes/mxFloorplan.js` | v24.7.5 | `Copyright (c) 2006-2014, JGraph Ltd` | `drawioJs/bpmn.ts` |
| `src/main/webapp/shapes/mxFlowchart.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/misc.ts` |
| `src/main/webapp/shapes/mxGCP2.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioShapes.ts` |
| `src/main/webapp/shapes/mxGmdl.js` | v24.7.5 | `Copyright (c) 2006-2015, JGraph Ltd` | `drawioJs/ui.ts` |
| `src/main/webapp/shapes/mxIBM.js` | v24.7.5 | `Copyright (c) 2006-2020, JGraph Ltd` | `drawioJs/misc.ts` |
| `src/main/webapp/shapes/mxInfographic.js` | v24.7.5 | `Copyright (c) 2006-2018, JGraph Ltd` | `drawioJs/arrows.ts` |
| `src/main/webapp/shapes/mxKubernetes.js` | v24.7.5 | `Copyright (c) 2006-2020, JGraph Ltd` | `drawioJs/arrows.ts` |
| `src/main/webapp/shapes/mxLeanMap.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/bpmn.ts`・`drawioJs/edges.ts` |
| `src/main/webapp/shapes/mxNetworks.js` | v24.7.5 | `Copyright (c) 2006-2015, JGraph Ltd` | `drawioJs/edges.ts`・`drawioJs/misc.ts` |
| `src/main/webapp/shapes/mxSAP.js` | v24.7.5 | `Copyright (c) 2006-2016, JGraph Ltd` | `drawioJs/misc.ts` |
| `src/main/webapp/shapes/mxSysML.js` | v24.7.5 | `Copyright (c) 2006-2014, JGraph Ltd` | `drawioEdges.ts`・`drawioJs/basic.ts` |
| `src/main/webapp/shapes/mxUML25.js` | v24.7.5 | (無い) | `drawioJs/archimate.ts` |
| `src/main/webapp/shapes/pid2/mxPidInstruments.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/electrical.ts` |
| `src/main/webapp/shapes/pid2/mxPidMisc.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/electrical.ts` |
| `src/main/webapp/shapes/pid2/mxPidValves.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/electrical.ts` |
| `src/main/webapp/shapes/rack/mxRack.js` | v24.7.5 | `Copyright (c) 2006-2013, JGraph Ltd` | `drawioJs/ui.ts` |
| `src/main/webapp/styles/default.xml` | v32.6.10 | (無い) | `drawio.ts` |

### 13.2 draw.io の `shapes/`・`stencils/`・`img/` の利用の制限と、移した版

draw.io は v29.3.2 (2026-01-17) から、`src/main/webapp/shapes/` に次の LICENSE を付けました (`stencils/LICENSE`・`img/LICENSE` も同じ文に変わりました)。
取得元: https://github.com/jgraph/drawio/blob/v32.6.10/src/main/webapp/shapes/LICENSE (取得日 2026-11-15。そのまま)。

```text
The icon sets and stencil libraries included in this software, and any derivatives thereof (including conversions to other formats, traced reproductions, substantially similar visual representations, or AI-generated images created using these icons as reference or training input), may not be used as software assets in, distributed for use with, or incorporated into Atlassian products or products distributed through the Atlassian marketplace or plugin ecosystem, without explicit written permission.
This restriction does not apply to end-user diagram output (such as exported images or documents) created using this software.
```

Kumiori に移した `shapes/` の形を移した v24.7.5 (2024-07-25) には、この制限がありません (2026-11-15 に、v24.7.5 のタグのファイルで確かめました)。

- リポジトリの直下の `LICENSE` は Apache License 2.0 の本文だけです。
- `src/main/webapp/shapes/` に LICENSE のファイルはありません (`shapes/` のソースは、リポジトリ全体の Apache License 2.0 で公開されていました)。
- `src/main/webapp/stencils/LICENSE`・`src/main/webapp/img/LICENSE` は Creative Commons Attribution 4.0 International Public License の本文です。

そのため、`src/main/webapp/shapes/` の下のファイルは v24.7.5 から移し (13.1 節の表の「版」)、v24.7.5 より後に足されたものは入れていません。
`shapes/` の外 (`js/grapheditor/`・`js/diagramly/`・`mxgraph/src/`) のファイルは、v32.6.10 でも Apache License 2.0 だけなので、v32.6.10 から移しています。

## 14. GitHub Pages の API の説明書 (`dist/api/`) に含まれるもの

GitHub Pages には、画面 (上の 1) の下の `api/` に、API の説明書 (型の宣言のコメントから作る一覧の頁。`npm run docs:api`) を置きます。
説明書は TypeDoc で作り、頁の JavaScript (`assets/main.js` など)・CSS・アイコンは TypeDoc のものです。`assets/main.js` には lunr (頁の中の検索) が取り込まれています
(2026-11-20 に、`assets/main.js` の終わりの、取り込んだパッケージの表示 (Bundled license information) で確かめました)。
TypeDoc とそれが使うパッケージは、リポジトリの直下の依存と分けて、`tools/api-docs` の `package.json`・`package-lock.json` で入れます。npm の `kumiori` には入りません。
TypeDoc 0.28.20 が使う minimatch (10.2.6) には、`tools/api-docs` の `npm audit` に moderate の知らせ (GHSA-g3hv-75wg-m249。glob の展開の増幅によるサービス拒否。直った版は 11.0.1 から) が出ます。
説明書を作るときに手元で使うだけで、TypeDoc に渡す glob は `typedoc.json` の決まった値なので、外から届く経路はありません。minimatch は説明書の頁 (`dist/api/`) にも npm の `kumiori` にも入りません
(2026-11-21 に、頁の中に minimatch の字が無いことと、`npm pack --dry-run` の一覧に `tools/` が無いことで確かめました)。
`npm audit fix --force` は TypeDoc を 0.23.25 に下げ、minimatch を 11 に上書きすると TypeDoc 0.28.20 が動かない (`mini.matchOne is not a function`。minimatch 11 で無くなった関数を使う) ので、上げていません。
TypeDoc が minimatch 11 を使う版を出したら、上げて、この節の版と本文を合わせます。

### 14.1 typedoc (0.28.20)

- package.json の license: `Apache-2.0`
- 場所: `tools/api-docs/node_modules/typedoc`
- パッケージに著作権表示のファイル (NOTICE など) はありません。`LICENSE` は Apache License 2.0 の本文です

`tools/api-docs/node_modules/typedoc/LICENSE` の本文:

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### 14.2 lunr (2.3.9)

- package.json の license: `MIT`
- 場所: `tools/api-docs/node_modules/lunr`

`tools/api-docs/node_modules/lunr/LICENSE` の本文:

```text
Copyright (C) 2013 by Oliver Nightingale

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
