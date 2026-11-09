# Third-party notices (第三者のソフトウェアの表示)

Kumiori の配布物に含まれる、または Kumiori の実行に使われる第三者のソフトウェアの表示です。
ライセンスの本文と著作権表示は、各パッケージ (node_modules の中) のファイルから、書き換えずに転記しています。
パッケージにライセンスのファイルが無いものは、その事実と、パッケージの中の表示だけを書いています。

- 対象の版: このリポジトリの `package-lock.json` で入る版 (下の各節に版を書いています)
- この文書は、ライセンスの解釈や法的な判断を示すものではありません。

## 1. ブラウザ向けの配布物 (`dist/`・`dist-browser/`) に含まれるもの

次の 2 つのブラウザ向けの配布物は、この節のパッケージを束ねて含みます (2026-11-08 に、ビルドのソースマップで束ねられたパッケージを確かめました)。

- 画面 (`npm run build` の `dist/`。GitHub Pages に置くもの)
- ブラウザで単体で動くライブラリ (`npm run build:browser` の `dist-browser/`。npm の `kumiori/browser`)。この節のパッケージに加えて、下の 2 節の @xmldom/xmldom も束ねて含みます (XSL-FO を読むため)

ライブラリ (`npm run build:lib` の `dist-lib/`。npm の `kumiori`) は依存パッケージを束ねず、実行時に node_modules から読み込みます (下の 2 節と同じ)。

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
- 配布物には、ほかのパッケージのコードが束ねられています。その表示は下の 1.1.1 にあります。

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

### pako 1.0.11

- package.json の license: `(MIT AND Zlib)`
- 場所: `node_modules/pako`
- pdf-lib を通して使われる。package.json の license は "(MIT AND Zlib)"。Zlib の条文は下の 1.2。

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
- 必要なときだけ読み込む (別のチャンク)。英語の分綴のパターン (en-us・en-gb) の表示は下の 1.4。

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

### 1.1.1 @pdf-lib/fontkit の配布物に束ねられたもの

`node_modules/@pdf-lib/fontkit/dist/` の配布物 (`fontkit.es.js`・`fontkit.umd.js` とその縮めたもの) には、fontkit を作るときに rollup で束ねた、ほかのパッケージのコードが入っています。fontkit のパッケージにはそれらの表示が無いので、ここにまとめます。Kumiori のブラウザ向けの配布物 (`dist-browser/`) は fontkit を束ね、コメントを除くので、ここの表示がそれらの表示になります。

- 束ねたもの: fontkit の package.json の開発用の依存 (`devDependencies`) と、配布物の中のコードの特徴 (関数の名前・文字列) から洗い出しました。配布物にはソースマップが無く、束ねた版は分かりません。下の条文は、package.json の範囲に合う版のパッケージ (2026-11-09 に npm から取得) から、書き換えずに写しています。
- 配布物に入っていないことを確かめたもの: rollup-plugin-node-builtins の setimmediate・zlib など、上に挙げた以外の Node の組み込みの代わり。fontkit の依存 (`dependencies`) の pako は、束ねずに読み込みます (上の pako の節)。
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

- base64-js (@pdf-lib/brotli と buffer の依存。束ねた版は分かりません): base64-js 1.5.1 の LICENSE:

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

束ねられたファイルのうち、`src/es6/util.js` の冒頭 (`src/es6/string-decoder.js` も同じ。readable-stream の部分も Node のコードから作られたもの):

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

pako の LICENSE ファイル (上) は MIT の条文です。Zlib の条文は、`node_modules/pako/lib/zlib/` の constants.js・deflate.js・gzheader.js・inffast.js・inflate.js・inftrees.js・messages.js・trees.js・zstream.js の冒頭に、同じ形で入っています。deflate.js の 3〜20 行目をそのまま転記します。

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

### 1.4 hyphen の英語とラテン語の分綴のパターン

Kumiori が読み込むのは `hyphen/en-us`・`hyphen/en-gb`・`hyphen/la` だけです。hyphen の README.md (12 行目) には "Patterns for this library were taken from ctan.org and ported to Javascript." とあります (リンクの書式を除いて引用)。npm の hyphen@1.14.1 の `patterns/en-us.js`・`patterns/en-gb.js` には、ライセンスや著作権の表示は入っていません。

下に、上流の hyph-utf8 のパターンのファイルの冒頭の表示を転記します。

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

### 1.5 Apache License 2.0 の本文

pdf-lib 1.17.1 のソースの中のコメント (上の 1.1 に転記) が、次のファイルの一部を、Apache 2.0 のライセンスで提供されたものとしています。

- `node_modules/pdf-lib/es/core/streams/Stream.js`
- `node_modules/pdf-lib/es/core/streams/DecodeStream.js`
- `node_modules/pdf-lib/es/core/streams/FlateStream.js`
- `node_modules/pdf-lib/es/core/streams/RunLengthStream.js`
- `node_modules/pdf-lib/es/core/streams/AsciiHexStream.js`
- `node_modules/pdf-lib/es/core/streams/Ascii85Stream.js`
- `node_modules/pdf-lib/es/core/streams/LZWStream.js`

@pdf-lib/fontkit 1.1.1 の配布物に束ねられた Brotli の展開のコード (上の 1.1.1) も、Google Inc. の Apache License 2.0 の表示を持っています。

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

## 2. Node のコマンド (`dist-cli/cli.js`) とライブラリ (`dist-lib/`) を配布するときの依存

Node のコマンドとライブラリのビルドでは、次のパッケージはバンドルに入らず、実行時に node_modules から読み込まれます (上の 1 のパッケージも同じ)。npm の `kumiori` を入れると、これらも依存として一緒に入ります。
このうち @xmldom/xmldom は、ブラウザで単体で動くライブラリ (`dist-browser/`) には束ねて含まれます (上の 1)。

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

### linkedom 0.18.14

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

### @acemir/cssom 0.9.32

- package.json の license: `MIT`
- 場所: `node_modules/@acemir/cssom`

`node_modules/@acemir/cssom/LICENSE.txt` の本文:

```text
Copyright (c) Nikita Vasilyev

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

## 6. Kumiori のコードに写した Unicode の文字データ (改行・縦書きの字の向き・双方向のテキスト・字のつながり)

`src/unicodeData.ts` の表は、Unicode の文字データベース (UCD) 18.0.0 の LineBreak.txt・EastAsianWidth.txt・VerticalOrientation.txt・extracted/DerivedGeneralCategory.txt (Mn・Mc・Pi・Pf・Cn だけ)・emoji/emoji-data.txt (Extended_Pictographic だけ)・extracted/DerivedBidiClass.txt・BidiMirroring.txt・BidiBrackets.txt・extracted/DerivedJoiningType.txt の値を、`scripts/gen-unicode-data.mjs` で範囲の並びに書き写したものです (値は変えていません)。

- データの取得元: https://www.unicode.org/Public/18.0.0/ucd/ (取得日 2026-11-04。extracted/DerivedJoiningType.txt は 2026-11-05)
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

`src/counterStylePredefined.ts` の `@counter-style` の規則 (§6 Simple Predefined Counter Styles と、§7.1.1 和文・§7.1.2 韓国語の規則) は、W3C の文書 CSS Counter Styles Level 3 の例の規則を、書き換えずに写したものです。

This software includes material copied from or derived from CSS Counter Styles Level 3 (https://www.w3.org/TR/2021/CR-css-counter-styles-3-20210727/). Copyright © 2021 W3C® (MIT, ERCIM, Keio, Beihang).

- 文書の取得元: https://www.w3.org/TR/css-counter-styles-3/ (取得日 2026-11-06。2026-11-07 に取り直した文書の版は W3C Candidate Recommendation Snapshot 27 July 2021、https://www.w3.org/TR/2021/CR-css-counter-styles-3-20210727/ で、Kumiori の規則 49 個はすべて、その文書の例の規則と同じだった (空白の違いを無視して比べた))
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
