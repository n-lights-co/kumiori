<p align="center"><img src="assets/logo/kumiori-logo.svg" alt="Kumiori 組み織り" width="480"></p>

> English translation of [README.md](README.md) (the Japanese text is the original).

# Kumiori (組み織り)

**A library for Japanese typesetting, refined with AI.**

A typesetting engine that runs both in the browser and in Node. It reads HTML+CSS and XSL-FO, typesets vertical writing, ruby, line-breaking rules (kinsoku), tables, footnotes and multi-column layouts,
and outputs a Canvas preview and PDF.

## A typesetting engine refined with AI

Kumiori is developed with an AI coding assistant ([Claude Code](https://claude.com/claude-code)) (see "[About the development method](#about-the-development-method)").

- **About 60,000 lines of TypeScript, about 1,900 tests**: Each time a feature is added, the AI adds tests, and CI (type checking, unit tests, and 15 browser integration tests) passes
- **Implemented from the standards and specifications**: Kumiori is implemented by reading the standards and specifications as thoroughly as possible, including XSL-FO 1.1, the CSS modules (Paged Media, GCPM, Writing Modes, Text, Ruby, Fragmentation and others), MathML Core, the Unicode UAX #9 (bidirectional text) and UAX #14 (line breaking), W3C's JLREQ (Requirements for Japanese Text Layout, based on JIS X 4051) and PDF (ISO 32000), and following their definitions. The fine details of Japanese typesetting, such as punctuation compression, hanging punctuation and ruby overhang, are also based on these standards. The support status of each property, with the specification's definition and how Kumiori handles it, is collected in the Conformance Guide ([`docs/en/conformance.md`](docs/en/conformance.md))
- **Behaviour checked against published PDFs**: The interpretation of the specifications and the finer points of layout are checked by comparing Kumiori's output with sample PDFs that XSL-FO and CSS typesetting tools have published

## Features

- **Input**: HTML+CSS (own CSS cascade; no browser needed), XSL-FO (supports part of Antenna House's `axf:*` extensions, focusing on the commonly used ones), JSON logical tree
- **Japanese typesetting**: vertical and horizontal writing, ruby, tate-chu-yoko, emphasis marks (kenten), line-breaking rules (kinsoku), hanging punctuation and pushing out, punctuation compression, spacing between Japanese and Latin text
- **Other scripts**: right-to-left scripts such as Arabic and Hebrew (reordered with the Unicode Bidirectional Algorithm, UAX #9; Arabic letters take their joined forms. CSS `direction: rtl`, XSL-FO `writing-mode="rl-tb"`), Thai (wrapped at word boundaries found with the dictionary of the runtime's `Intl.Segmenter`), Devanagari (Hindi and others; conjuncts and other shaping by the font), Korean (Hangul), other Indic scripts (Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala), Lao, Khmer, Burmese (Myanmar script) and Tibetan, Mongolian script (horizontal and vertical), Chinese (Simplified and Traditional), Vietnamese, Greek and Cyrillic, hyphenation (English, Latin, Russian, Ukrainian, Modern Greek), and mixed Japanese and Latin text. Fonts for Arabic, Thai, Devanagari, Hangul, Simplified and Traditional Chinese, emoji and other scripts are passed with `--font` or `fonts` (the default fonts do not include them; color emoji fonts are typeset in color; Hebrew, Greek, Cyrillic and Vietnamese letters can be set with the default Latin fonts). A table of the font each language and script needs, how it wraps, vertical writing and limitations is in the section "Supported languages and scripts" of the Conformance Guide ([`docs/en/conformance.md`](docs/en/conformance.md); section 5.6 of the XSL-FO 1.1 volume, section 5.8 of the HTML and CSS volume). The same section has typeset samples for each script (Article 1 of the Universal Declaration of Human Rights set in the font of each script), and samples of emoji and variable fonts are in sections 5.6 and 5.7 of the HTML and CSS volume
- **Pages**: page masters, running heads and page numbers (folios), footnotes, multi-column layout, floats, tables (splitting across rows and pages, repeated headers, automatic column width), page number references
- **Output**: Canvas preview, PDF (subset font embedding, bookmarks, links, annotations, forms, trim marks, PDF/X-3 marking with conversion of RGB colors and images to CMYK)
  - The PDF/X-3 marking (`pdfx` in the API) has been verified only for the parts defined by the PDF specification ISO 32000-2 (such as the form of the output intent dictionary). It has not been verified against the text of the PDF/X standard ISO 15930, so conformance to that standard is not guaranteed
- **Environments**: browser (Vite) and the Node CLI (`dist-cli/cli.js`)

Internally, every box is computed in pt following the XSL-FO **Area Model**, a **physical tree (Area Tree)** is assembled, and then it is drawn to
Canvas and **PDF (pdf-lib + fontkit)**.

## Usage

Kumiori can be used in three forms.

| Form | How to get it | Suited for |
| --- | --- | --- |
| **Web app (browser)** | Open the web app hosted on GitHub Pages (<https://n-lights-co.github.io/kumiori/>). Or put the `dist/` from `npm run build` on a static web server | Picking a document and saving a PDF |
| **Node CLI** | `npm install -g kumiori`, or without installing, `npx kumiori book.html -o book.pdf` | Converting without a browser, or converting in batches |
| **Library** | `npm install kumiori` (`import { typeset } from 'kumiori'`). In a browser without a bundler, `kumiori/browser` from a CDN | Typesetting from your own program |

The default fonts (Noto Serif JP etc.) are not included in the package; they are fetched from Google Fonts on first run (the Node CLI saves them to a local cache and reuses them; see "[Fonts](#fonts)").

To run this repository locally:

```bash
npm install
npm run dev      # http://localhost:5173  (preview + "Save PDF")
npm run build    # type check + production build (dist/; the web app)
npm run build:dist   # build the library (dist-lib), the Node CLI (dist-cli) and the single browser file (dist-browser) together
```

Node 20.19.0 or later in the 20 line, or 22.12.0 or later, is required (CI tests with 20.19.0 and 22; the dependencies used to read HTML, such as css-select used by linkedom, require Node 20.19.0 or later. 22.0 to 22.11 are excluded because they cannot load ES modules with `require()`). The release procedure is in [`docs/en/RELEASING.md`](docs/en/RELEASING.md), and the changes in each version are in [`CHANGELOG.en.md`](CHANGELOG.en.md).

### Web app (browser)

- "Open" (開く) lets you select HTML, XSL-FO or EPUB files together with the CSS, images and fonts they use (several can be selected). "Open folder" (フォルダを開く) selects a whole folder; you can also open files or folders by dragging and dropping them onto the page. When a folder contains several documents, index.html (or, failing that, the document at the shallowest location) is opened
- "Save PDF" (PDF を保存) writes out the PDF. On the left are page thumbnails and warnings (collapsible); "Settings" (設定) on the right has the default style, the default page size (the paper for HTML that does not specify `size` in `@page`: A4, A5, B5, JIS-B5, letter or free input; the same as the CLI's `--page-size`), the CSS interpretation, "Typeset with the spec's default values" (the XSL-FO default-value convention; the same as the CLI's `--compat`), trim marks and font loading
- Warnings are listed one by one in the left column (identical messages are merged; four or more are collapsed to a count and can be opened; the count also appears in the top bar). They are the same warnings as the CLI and the API give: layout warnings, unsupported CSS / XSL-FO and unknown CSS properties, links whose actions were not written to the PDF for safety, nesting deeper than 128 levels and too many `@import`s, EPUB items skipped for exceeding the limits, images not fetched, and font notices (fonts that could not be fetched and so on)
- All typesetting happens inside the browser; documents and fonts are never sent out (the only things fetched from outside are the default fonts and the images the document references via `http(s):`). It also works when the `dist/` from `npm run build` is placed on a static web server

### Node CLI (HTML+CSS and XSL-FO to PDF without a browser)

When installed from npm the command is `kumiori` (or `npx kumiori` to use it without installing); when built in this repository, `node dist-cli/cli.js` is the same command.

```bash
npx kumiori book.html -o book.pdf
npx kumiori book.fo -o book.pdf
npx kumiori a.html b.fo c.html -o out
npx kumiori book.html --watch
```

```bash
npm run build:cli                       # when building in this repository
node dist-cli/cli.js book.html -o book.pdf
```

```bash
cat book.html | node dist-cli/cli.js - -o - --base . > book.pdf
```

- With several inputs, `-o` (`--output`) is the output directory (if omitted, a `.pdf` is written next to each input). If one fails, the others are still produced (the exit code is 1). Even with a single input, if `-o` is an existing directory, `<input name>.pdf` is written inside it
- `-` reads from standard input (CSS, images and fonts come from the `--base` directory (default: the current directory); whether the input is FO is detected from its content). `-o -` writes the PDF to standard output
- The character encoding of the input is determined from the BOM, the XML declaration's `encoding` (`Shift_JIS`, `EUC-JP`, etc.) and HTML's `<meta charset>` (UTF-8 if none)
- Images the document references via `http(s):` are fetched from the network by default. `--no-fetch-images` disables this (e.g. when typesetting documents written by others on a server; they are typeset as unreadable images)
- Stylesheets the document references via `http(s):` (`<link rel="stylesheet">`, `@import`) and the fonts of their `@font-face` rules (only those whose `unicode-range` overlaps the characters of the document) are also fetched by default. `--no-fetch-styles` disables this
- Image sizes are limited (so that a small file cannot consume large amounts of memory and time; the values and their rationale are in `src/imageLimits.ts`). One image may have up to 100 million pixels. The images inside a WMF, EMF or CGM file (DIBs, cell arrays, tile arrays, patterns) may total up to 64 million pixels per file, and also no more than "260 thousand pixels (512 × 512) + 1,024 pixels per byte of the file" (a file of a few hundred bytes cannot produce a huge image; a file larger than about 61 KB may use the full 64 million pixels). Images beyond the limits are not drawn, and the rest of the document is typeset
- Of the links that leave the document (HTML `<a href>`, and `external-destination` of XSL-FO `fo:basic-link` and `fo:bookmark`), by default only URLs whose scheme is `http`, `https`, `mailto` or `tel`, and relative references to a PDF (the action that opens another PDF), get an action in the PDF. Other schemes (`javascript:`, `data:`, `file:` and so on) and actions that open a file (relative non-PDF files, absolute paths, scheme-less `//host/…`) are typeset as plain text and counted in a "warning:" (to protect whoever opens a PDF made from a document written by someone else). `--link-schemes http,https,ftp` chooses the allowed schemes (`*` means all), and `--link-launch` also writes the actions that open a file (`--link-schemes '*' --link-launch` writes everything)
- Files the document or the CSS references with a `file:` URL (`file:///…/style.css` etc.) are read from that file, even outside the input's directory
- `--watch`: re-typesets whenever the HTML, FO, CSS, images or fonts in the input's directory change
- `--help` (`-h`) prints the usage, `--version` (`-v`) prints the version
- Unsupported CSS properties and values (listed in chapter 16 of the Conformance Guide), properties unknown to Kumiori (misspelled or unsupported), XSL-FO elements and properties that cannot be read, unreadable images and so on are not silently ignored but reported as `警告:` ("warning:") messages (in the library, `result.warnings`)

- CSS, images and fonts in the same directory as the HTML (and in subdirectories) are used (the same as selecting them together in the web app). Only images whose names appear in the document and the CSS are read. Only CSS referenced by the HTML (`<link>`, `@import`) is used (unreferenced CSS is not applied, and a warning says so). `--css a.css,b.css` selects the CSS to use (comma-separated for several; `@import` targets are used too. CSS named there is added as a user stylesheet even if the HTML does not reference it)
- `--style kumiori|browser|browser-margin|ah|vivliostyle|weasyprint`: the default style (the same as "Default style" under "Settings" in the web app; the default is kumiori)
- `--page-size <size>`: the default paper for HTML (the paper of a document that does not specify `size` in `@page`; the default is A4). Written like the CSS `size` property: a paper name (`A5`, `JIS-B5`, `letter`, etc.), a name with an orientation (`"A5 landscape"`), or a width and height (`148mm,210mm`; separated by a space or a comma). A `@page { size: … }` in the document wins. `width` and `height` in `@media` are also evaluated against this paper. Not used for XSL-FO
- `--font-dir <dir>`: the directory from which the default fonts (`NotoSerifJP-Regular.ttf`, `NotoSerifJP-Bold.ttf`, `NotoSansJP-Regular.ttf`, `NotoSansJP-Bold.ttf`, `Tinos-*.ttf`, `Arimo-*.ttf`, `Cousine-*.ttf` when monospace is specified, `STIXTwoMath-Regular.ttf` when there is MathML, and `NotoSansSymbols2-Regular.ttf` when there are symbols found in none of the fonts) are read. If absent, the font cache is tried, then Google Fonts. If a bold file (`-Bold`) has the same contents as the `-Regular` file of the same font, the font is treated as having no bold face and bold text is drawn by emboldening Regular (for replacing a default font with one that has no bold face). When replacing the default fonts with your own, place the bold files too (`NotoSerifJP-Bold.ttf`, `NotoSansJP-Bold.ttf` and so on): a file that is not there comes from the cache or the network as the default font, and gets mixed with the replaced fonts
- `--font-cache <dir>`: the directory in which the default fonts fetched from Google Fonts are saved and reused. The default is the environment variable `KUMIORI_FONT_CACHE`, or else the OS cache (on Linux `kumiori/fonts` under `$XDG_CACHE_HOME` or `~/.cache`, on macOS `~/Library/Caches/kumiori/fonts`, on Windows `%LOCALAPPDATA%\kumiori\fonts`). Fonts are fetched from the network only the first time, with the message `書体 … を取得して … に保存しました` ("fetched font … and saved it to …"). From the second run on, the network is not used. Anything that is not a font file, such as an interrupted download, is not saved, and a corrupt cache is discarded and fetched again. Conversion continues even where the cache cannot be written
- `--no-font-cache`: neither reads nor writes the font cache (fetches from Google Fonts every time)
- `--lang ja|en`: language of the usage text, reports, warnings and error messages. Without it, the environment variable `KUMIORI_LANG` is used, then the OS locale (`LC_ALL`, `LC_MESSAGES`, `LANG` starting with `en` means English). The default is Japanese
- `--font <font file>` (repeatable): adds a font file (TTF, OTF, TTC, WOFF, WOFF2) (for a TTC, each font inside is added). Fonts are registered by the family name in the font's name table and the weight, width and slant in its OS/2 table, and used from `font-family` like fonts installed on the system. Faces within a family are matched by width (`font-stretch`), then slant (`font-style`), then weight (`font-weight`) (CSS Fonts 4 §5.2). When an italic or oblique font file is given, `font-style: italic` / `oblique` text is set in that face (otherwise the upright glyphs are slanted). A face of a different width (such as Arial Narrow, which shares the family name and has a narrower width) is selected by `font-stretch`, or by the name of that face alone (`font-family: "Arial Narrow"`); when the family has no face of another width, the glyphs are scaled horizontally. A variable font (OpenType Font Variations, with TrueType outlines or CFF2 outlines) is used over the full range of its axes such as weight and width: the shape matching `font-weight`, `font-stretch`, `font-variation-settings` and so on is built and used (each shape in use is embedded in the PDF as a static font; a CFF2 variable font is rebuilt as static CFF fonts). The `font-family` list is tried in order for each character, and the first font that has the character is used (generic names and the names of the default fonts are also looked up at their position in the list). Characters that no font in the list has are looked up in the default fonts and then in added fonts that are not in the list. In compatibility styles such as `--style ah`, fonts are also selected by the PostScript name written in SVG's `font-family` (e.g. `'CenturyGothic'`)
- `--generic-font serif=<font name>`, `--generic-font sans-serif=<font name>`: the font used for Latin text of the generic fonts (serif, sans-serif) (the family name of a font added with `--font`)
- `--print`: trim marks and bleed (3mm)
- `--image-max-dpi <dpi>`: JPEG photos finer than this relative to the size they are placed at are downscaled to this resolution and re-encoded (makes the PDF smaller; by default they are left as they are)
- `--spot-colors <JSON file>`: the names of spot colors and the alternate CMYK at 100% tint (`{"name": "cmyk(20%,40%,60%,80%)"}` or `{"name": [0.2,0.4,0.6,0.8]}`; the array holds numbers from 0 to 1, and a value over 1 is an error). Among `rgb-icc(r,g,b,#Separation,'name',tint)` colors, those whose name is listed here are written as a PDF Separation (the alternate color space is DeviceCMYK, and the tint transform is linear). `rgb-icc()` is read with either `--compat` in XSL-FO, and only with `--style ah` in HTML (it is an Antenna House form, not a CSS color function; with the other styles the declaration is ignored as an invalid value and reported in a warning). Those whose name is not listed are written with the alternate RGB as before. Names are written in UTF-8 (ISO 32000-2 §7.3.5). Spot color values (such as those of swatch books) are not included in Kumiori; the user supplies them
- HTML is read with linkedom, and the CSS computed values come from the own cascade (the same as "CSS interpretation: Kumiori" in the web app)
- XHTML (`.xhtml`, `.xht`) is read with XML syntax, rewritten according to namespaces, and then typeset the same as HTML (prefixed elements such as `<s:svg xmlns:s="http://www.w3.org/2000/svg">` also become SVG; `src/xhtml.ts`). `.html` is read with HTML syntax, so prefixed elements do not become SVG. With `--xhtml`, XML syntax is used regardless of the extension
- MathML (`<math>`) is typeset with the math font (`STIXTwoMath-Regular.ttf`) and turned into glyph outline shapes (`src/mathLayout.ts`, shared with XSL-FO). Formulas with `display="block"` are centered on the line
- XSL-FO (`.fo`, `.xml`, or `--fo`) is typeset the same as XSL-FO import in the web app. `--compat spec|antenna` is the default-value convention (XSL-FO 1.1 initial values (default) / AH Formatter compatible defaults; other values are an error). Font files (TTF, OTF, TTC) in the same directory are used by the name in the FO's `font-family`
- Images in PNG, JPEG, GIF, BMP, TIFF, WebP, SVG, WMF, EMF, EPS (PostScript) and CGM are placed in the PDF. SVG that cannot be converted to shapes (e.g. filters other than shadows and blur) is drawn as a placeholder frame with a warning (the web app rasterizes and draws it)

### Using as a library (from TypeScript or JavaScript)

```bash
npm install kumiori
```

When building in this repository, `npm run build:lib` (dist-lib/; ES modules and type declarations).

```ts
import { typeset, walkAreaTree } from 'kumiori';

// HTML+CSS (XSL-FO is typeset with the same function; the kind is detected from the extension of name or from the content)
const result = await typeset(html, {
  name: 'book.html',
  files: [
    { name: 'book.css', data: cssText },                        // CSS, images and fonts are { name, data }
    { name: 'img/cover.jpg', data: async () => readBytes('img/cover.jpg') }, // a function that reads only when used is fine too
  ],
  loadFont: async (spec) => readLocalFont(spec),               // how to load the default fonts (if omitted, fetched from Google Fonts)
});
console.log(result.pageCount, result.warnings);
walkAreaTree(result.areaTree, (area) => { /* walk the typeset result (Area Tree) */ });
const pdf = await result.toPdf();                              // Uint8Array
result.renderPage(canvas, 0);                                  // draw page 1 onto a canvas (browser)
```

- `typeset(text, options)` is the entry point (`typesetHtml` and `typesetFo` are variants that fix the kind). It does not touch the file system, and uses the network only to fetch the default fonts (replaceable with `loadFont`) and the images and stylesheets the document references via `http(s):` (can be stopped with `fetchImages` and `fetchStyles`), so it runs both in the browser and in Node
- `text` is a string. When reading from a file, converting it to a string with `decodeDocumentText(bytes)` decodes it according to the BOM, the XML declaration's `encoding` and `<meta charset>` (reading as fixed UTF-8 garbles Shift_JIS FO and the like)
- Main `options`: `kind` (`html`, `xhtml`, `fo`; if omitted, determined from `name` and the content), `name` (the input file name), `files` (CSS, images, fonts; fonts may be TTF, OTF, TTC, WOFF or WOFF2), `fonts` (fonts to add), `genericFonts` (fonts for Latin text of the generic fonts), `style` (the default style for HTML), `pageSize` (the default paper for HTML: the paper of a document that does not specify `size` in `@page`, written like the CSS `size` property: `"A5"`, `"A5 landscape"`, `"148mm 210mm"`; the default is A4; a `@page { size }` in the document wins; `width` and `height` in `@media` are also evaluated against this paper), `compat` (the XSL-FO default-value convention), `print` (bleed and trim marks), `spotColors` (alternate CMYK for spot colors), `loadFont`, `fetchTimeoutMs` (timeout for fetching fonts and images; default 30 seconds), `fetchImages` (whether to fetch the images the document references via `http(s):`; default `true`; `false`, or a function that takes a URL and returns a boolean; when typesetting others' documents on a server, disable it or allow only certain URLs), `fetchStyles` (whether to fetch the stylesheets the document references via `http(s):` and the fonts of their `@font-face` rules; the same form as `fetchImages`), `resolveResource` (a function that returns the content of files the document or the CSS references that are not in `files`; see below), `links` (which links that leave the document get an action in the PDF: `{ schemes?: string[]; launch?: boolean }`; by default only URLs whose scheme is `http`, `https`, `mailto` or `tel` and relative references to a PDF are written, and the rest are typeset as plain text and reported in `warnings`; `schemes` is the list of allowed schemes (it replaces the default; `'*'` means all), and `launch: true` also writes the actions that open a file (relative non-PDF files, absolute paths, `//host/…`); `{ schemes: ['*'], launch: true }` writes everything), `lang` (language of `warnings` and error messages: `ja` or `en`; default Japanese), `deflate` (in Node, passing `zlib.deflateSync` speeds up PDF output)
- The function passed to `fetchImages` / `fetchStyles` is asked not only about the URL written in the document but also about every redirect target. On Node, redirects are followed one hop at a time (up to 20), and no request is sent to a target the function refuses. Redirects from `https:` to `http:` and redirects to non-`http(s):` targets are refused without asking the function (also when the option is `true`). In browsers, scripts cannot read a redirect target in advance, so the function is asked about the final URL after the browser has followed the redirects, and the response is discarded if it is refused (the request itself has already reached the redirect target). The function only sees the URL string: a host name that resolves to an internal address (including DNS rebinding) cannot be stopped by it. To protect an internal network when typesetting documents written by others on a server, also restrict the runtime itself (egress rules, an outbound proxy). Resources fetched from the network have size limits (images 256 MB, CSS 16 MB, fonts 128 MB); anything larger is abandoned mid-read and treated as an unreadable resource, even when the response has no `Content-Length`. The `fetchTimeoutMs` time limit applies until the body has been read completely
- `result.toPdf({ title, pdfx, imageMaxDpi })`: the PDF title, the PDF/X-3 marking (`pdfx`; RGB colors and images are converted to CMYK), the upper limit of JPEG resolution. `result.renderPage(canvas, i, { scale, devicePixelRatio, guides })`: the scale, the device pixel density, and guide lines for the trim box and bleed
- Internal entities declared in the internal subset of the FO's DOCTYPE (such as `<!ENTITY nbsp "&#160;">`) are expanded before import (external entities are not read)
- Exceptions: `typeset` throws when the FO's XML cannot be parsed (`XML の解析に失敗しました: …`, "failed to parse XML: …") and when the default fonts cannot be read (`書体を読めません: …`, "cannot read font: …"). A corrupt font file passed in `fonts` does not throw but goes into `warnings`. A nonexistent page number for `renderPage` is a `RangeError`. Typesetting warnings (unreadable images, overflow, etc.) do not throw but go into `result.warnings` (an array of strings)
- `resolveResource(url)`: asked for each file the document or the CSS references (`<link rel="stylesheet">`, `@import`, `url()`, `<img src>`, etc.) that is not in `files`. `url` is the reference as written (`file:///…/a.css`, `img/a.png`, `https://…`); relative references inside a CSS file are resolved against that CSS file's URL. If it returns content (a string, `Uint8Array` or `ArrayBuffer`), that is used; if it returns `undefined`, things work as before (`http(s):` images and stylesheets are fetched from the network). There is no need to rewrite the references and put the files into `files`. An image is recognized from the leading bytes of the returned content, even when its URL has no extension (such as `https://example.com/img?id=1`)
- In Node, the helpers in `kumiori/node` can be used: `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` returns a `loadFont` that reads the default fonts the same way as the Node CLI (`fontDir` → the font cache → the network; fetched fonts are saved in the cache. `cacheDir` defaults to `defaultFontCacheDir()`; `null` disables the cache). `createFileResolver({ root })` returns a `resolveResource` that reads files referenced with `file:` URLs (with `root`, only files inside it are read; `root` may also be a list of directories, and containment is checked on the real paths after resolving symbolic links)

  ```ts
  import { typeset } from 'kumiori';
  import { createFileResolver, createFontLoader } from 'kumiori/node';
  const result = await typeset(html, { loadFont: createFontLoader(), resolveResource: createFileResolver() });
  ```
- The fonts used by default can be found in `DEFAULT_FONTS` (the `family`, `weight` and `urls` of the `spec` passed to `loadFont`)
- Only what is exported from `src/index.ts` (and `src/node.ts` for Node) is public (the functions and types of other modules may change between versions)
- `kumiori` (`dist-lib/index.js`) is an ES module that does not bundle its dependencies (pdf-lib, fontkit, xmldom, etc.). Use it with a bundler such as Vite or webpack, or load it from Node. It is ES module only, but `require('kumiori')` also works (on Node 20.19.0 or later and 22.12.0 or later, which can load ES modules with `require()`; Node 22.0 to 22.11 needs `--experimental-require-module`)
- In a browser without a bundler, use `kumiori/browser`, a single file with the dependencies bundled (`dist-browser/kumiori.js`; about 2.7MB, 0.9MB gzipped; the hyphenation dictionaries and the like are loaded as separate files only when used). The version published on npm can be loaded directly from the jsDelivr or unpkg CDN:

  ```html
  <script type="module">
    import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.2.0/dist-browser/kumiori.js';
    const result = await typesetHtml(html, { name: 'a.html' });
    result.renderPage(document.querySelector('canvas'), 0);
  </script>
  ```

#### Showing a print preview in the browser (renderPage)

`result.renderPage(canvas, pageNumber, { scale })` draws a typeset page onto a canvas (page numbers start at 0). Glyphs are drawn from the outlines in the font files, so the page's CSS and `@font-face` have no effect on them. In the browser, HTML is parsed with the browser's DOMParser (linkedom is used only in Node).

Example: typeset the HTML being edited in an editor each time the user pauses, and show it in a preview

```ts
import { typeset } from 'kumiori';

const printCss = '@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } } body { font-family: serif }';
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const loadFont = (spec) => {                                    // fetch the default fonts only once and reuse them
  const key = `${spec.family}|${spec.weight ?? 400}`;
  if (!fontCache.has(key)) fontCache.set(key, fetch(spec.urls.find((u) => u.startsWith('https:'))!).then((r) => r.arrayBuffer()));
  return fontCache.get(key)!;
};

async function showPreview(bodyHtml: string, container: HTMLElement) {
  const r = await typeset(`<!doctype html><html lang="ja"><body>${bodyHtml}</body></html>`, {
    kind: 'html',
    files: [{ name: 'print.css', data: printCss }],             // CSS not referenced from the document is added as a user stylesheet
    loadFont,
  });
  container.replaceChildren();
  for (let i = 0; i < r.pageCount; i++) {
    const canvas = document.createElement('canvas');
    r.renderPage(canvas, i, { scale: 1 });                      // 1pt = 1 CSS px (actual size is 96 / 72)
    container.append(canvas);
  }
}
```

- When typesetting repeatedly (e.g. for an editor preview), create a container with `createTypesetter()` that loads the fonts only once, and typeset with `typesetter.typeset(html, options)`. This is faster because the fonts are not fetched and parsed every time (the math, monospace and symbol fonts are loaded the first time a document that uses them is typeset)
- Working sample: after `npm run dev`, open http://localhost:5173/examples/preview/ (`examples/preview/`). Edit the editing area on the left, the "HTML" box below it (write headings, ruby, tables and so on directly; it and the editing area mirror each other) or the print CSS, and the right side is re-typeset when you pause. It uses only Kumiori's public API and has no other dependencies. To connect another editor, call the equivalent of the sample's `schedule(editor HTML)` from the notification that the editor's content has changed

## Structure

| File | Role |
| --- | --- |
| `src/index.ts`, `src/api.ts` | Public API (`typeset`, `createTypesetter`, `DEFAULT_FONTS`, etc. Only what is exported from `src/index.ts` is public) |
| `src/node.ts`, `src/nodeFonts.ts`, `src/resources.ts` | Helpers for Node (`kumiori/node`: the font cache and reading `file:` references), and collecting the references of the document and the CSS (`resolveResource`, fetching stylesheets) |
| `src/types.ts` | Types for the logical tree (Input), the physical tree (Area Tree) and page settings |
| `src/areaTree.ts`, `src/areaResources.ts` | Walking the Area Tree and reading/writing it as JSON ([`docs/en/area-tree.md`](docs/en/area-tree.md)); the list of fonts and images used |
| `src/fontManager.ts` | Fetches TTF/OTF → `FontFace` (Canvas) + `ArrayBuffer` (PDF) + fontkit (metrics) |
| `src/fontInstancer.ts`, `src/fontVariation.ts` | Builds a static font for an instance of a variable font (OpenType Font Variations) at given axis values (gvar, HVAR, MVAR, GPOS values, FeatureVariations); carries the requested axis values |
| `src/cff2Instancer.ts` | Turns an instance of a font with CFF2 (variable CFF) outlines into a static CFF (evaluates blend / vsindex in the glyphs and rewrites them as Type 2 CharStrings) |
| `src/measurer.ts`, `src/jis.ts` | Character width measurement (both Canvas and fontkit backends), measurement for vertical writing, ruby and tate-chu-yoko, line-breaking rules (kinsoku) |
| `src/geometry.ts`, `src/lnode.ts` | Conversion between logical (inline/block) and physical coordinates, intermediate layout tree |
| `src/inlineLayout.ts`, `src/inlineFlatten.ts`, `src/lineMetrics.ts` | Line breaking (kinsoku, hanging punctuation, pushing out), inline placement, generation of line nodes for ruby/tate-chu-yoko, inline tree → sequence of characters (Atom), line height (three models: CSS, XSL and compatibility) |
| `src/layoutEngine.ts` | Blocks, pagination, tables, absolute positioning; logical → physical (Area Tree) conversion |
| `src/footnotes.ts`, `src/tableBorders.ts`, `src/lineBreak.ts`, `src/bidi.ts`, `src/hyphenation.ts`, `src/counterStyle.ts` | Footnotes, collapsing of table borders, line break opportunities (UAX #14), bidirectional text (UAX #9), hyphenation, CSS counter-style |
| `src/paint.ts` | Area Tree traversal + trim mark geometry (shared by Canvas and PDF) |
| `src/canvasRenderer.ts`, `src/pdfRenderer.ts`, `src/pdfLibPatches.ts`, `src/matrix.ts` | Canvas / PDF renderers, replacements of pdf-lib internals (gathered in one place), matrices and Seg |
| `src/sampleData.ts`, `src/main.ts`, `index.html` | The ultimate sample and the preview UI |
| `src/htmlImport.ts`, `src/htmlPaged.ts`, `src/htmlPrepare.ts`, `src/htmlFrame.ts` | HTML+CSS import (computed values → logical tree, CSS for paged typesetting, collecting the CSS, import in the web app (the own cascade by default, a browser iframe for comparison)) |
| `src/cssCascade.ts`, `src/cssSelector.ts`, `src/cssText.ts` | CSS interpretation without a browser (cascade, computed values, selectors), CSS lexical helpers (separators, lengths, colors) |
| `src/xslfoImport.ts`, `src/foExpr.ts`, `src/foDom.ts`, `src/foContext.ts`, `src/foPageMaster.ts`, `src/foMathFallback.ts` | XSL-FO import (attributes → logical tree, expression evaluation, minimal DOM, page masters, MathML typesetting when no math font is available) |
| `src/svg.ts`, `src/mathLayout.ts` | Converting SVG to shapes, MathML typesetting |
| `src/jpeg.ts`, `src/webp.ts`, `src/vp8.ts`, `src/pixels.ts`, `src/ccitt.ts`, `src/imageLimits.ts`, `src/metafile.ts`, `src/cgm.ts`, `src/eps.ts`, `src/ps*.ts` (`psInterp`, `psGraphics`, `psOps*` per operator group, `psResources`, `psColorSpace`, `psFonts`, `psCff`, `psEncodings`, `psShading`, `psFilters`), `src/imageInfo.ts`, `src/base64.ts` | Image decoding (JPEG, WebP, GIF, BMP, TIFF) and limits, conversion of WMF/EMF, CGM and EPS (PostScript interpreter) to shapes, reading image dimensions |
| `src/epub.ts`, `src/xhtml.ts` | EPUB extraction, XHTML import |
| `src/fontMapping.ts`, `src/compat.ts`, `src/documentResources.ts`, `src/documentText.ts`, `src/cli.ts` | Font assignment, compatibility mode settings, fetching the math font and images, character encoding detection (shared by the web app and Node); the Node CLI |

For details of the typesetting algorithms see [`docs/en/REPORT.md`](docs/en/REPORT.md), for XSL-FO import [`docs/en/xslfo-import.md`](docs/en/xslfo-import.md), and for the plan for HTML+CSS import [`docs/en/html-css-plan.md`](docs/en/html-css-plan.md).
Per-item descriptions of the supported specifications are in the Conformance Guide ([`docs/conformance/`](docs/en/conformance.md); `npm run docs:conformance` turns it into PDFs; the PDFs for each version are attached to the GitHub release), features not yet available and known limitations are in [`docs/en/BACKLOG.md`](docs/en/BACKLOG.md), and the JSON of the typeset result (Area Tree) is described in [`docs/en/area-tree.md`](docs/en/area-tree.md).

## Fonts

The fonts for typesetting are not included in this repository. They are fetched at run time from Google Fonts' distribution host (`fonts.gstatic.com`).

| Font | Use | License |
| --- | --- | --- |
| Noto Serif JP, Noto Sans JP (Regular and Bold of each) | Japanese (Mincho, Gothic) | SIL Open Font License 1.1 |
| Tinos, Arimo (Regular and Bold of each) | Latin (serif, sans-serif) | Apache License 2.0 |
| Cousine | When monospace is specified | Apache License 2.0 |
| STIX Two Math | When there are formulas (MathML). MathML is typeset with the values of this font's MATH table | SIL Open Font License 1.1 |
| Noto Sans Symbols 2 | When the document contains symbols (such as ✈) found in none of the loaded fonts | SIL Open Font License 1.1 |

Every document loads the eight files of the first two rows (four Japanese and four Latin; about 29MB in total, of which Noto Serif JP is 8.0MB per file and Noto Sans JP 5.7MB per file); the others are loaded only when the document needs them. Bold text is typeset in the Bold of the same font (bold text in Mincho uses Noto Serif JP Bold).

The Node CLI saves the fetched fonts to the OS cache (`~/.cache/kumiori/fonts` etc.; can be changed with `--font-cache`) and does not use the network from the second run on. For offline use, in the web app (browser), TTFs with the same names placed in `public/fonts/` are used as a fallback (not tracked by git). With the Node CLI, either run once online to fill the cache, or specify the directory to read with `--font-dir`. The library's (`typeset`) default fetching tries only `https:` URLs, so pass local fonts via `loadFont`.
Fonts placed in `public/fonts/` are also copied to the build output of the web app (`dist/fonts/`). If you do not want them in what you distribute, remove them before building. The contents of `public/` are not copied to the output distributed through npm (`dist-cli/`, `dist-lib/`, `dist-browser/`). The Node CLI looks only at the directory passed with `--font-dir`.

The fonts used are embedded in the PDF. Check the license terms of each font with its distributor.

## Units and coordinates

- The internal unit is **pt** (only page settings use mm). An Area's `x,y` are physical coordinates relative to the top left of the parent's content-box (y pointing down).
- Absolute positioning (`absolutePosition`) is relative to the **top left of the trim box**. To reach into the bleed, specify negative `top/left`.
- `width/height` default to `content-box`. `boxSizing: 'border-box'` makes them include padding/border.

## License

The code is under the [Apache License 2.0](LICENSE) (Copyright 2026 Northern Lights Co.; see [NOTICE](NOTICE)). The fonts for typesetting are not bundled in this repository (for the fonts and their licenses, see the "[Fonts](#fonts)" section).

The licenses and copyright notices of the third-party software Kumiori uses (pdf-lib, pako, utif, hyphen, etc.) are collected in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The output of `npm run build`, `npm run build:cli`, `npm run build:lib` and `npm run build:browser` (`dist/`, `dist-cli/`, `dist-lib/`, `dist-browser/`) also contains `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md`. Every output JS file (including chunks) starts with a comment (`/*! … */`) giving the Kumiori version, its license and where `THIRD_PARTY_NOTICES.md` is (for when a single file is loaded from a CDN).

## Relationship to other companies' products

Kumiori is an independent project, unrelated to Antenna House's products or to typesetting software such as WeasyPrint and Vivliostyle. It has not received approval or support from these companies or projects.

The product and company names appearing in the README and docs are the trademarks or names of their respective owners. Kumiori uses these names to describe its compatibility features (import of the `axf:*` extensions, the default values of `--compat antenna`, etc.).

## About the development method

Kumiori is developed with an AI coding assistant (Anthropic's Claude Code).
Much of the code, tests and documentation is written by the AI. People decide what to build and how to follow each specification,
check the typesetting results, direct the fixes, and review changes before they are merged.
Specifications are interpreted by reading them and comparing Kumiori's output with published sample PDFs.
Third-party code and licenses are checked with tools before each release (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Tests

```bash
npm test          # unit tests (Node + fontkit; fetches Noto Serif JP into .cache/fonts)
npm run e2e       # browser integration tests (Playwright; on first run, npx playwright install chromium)
```

The fonts used by the tests are fetched on first run into `.cache/fonts` (changeable with `KUMIORI_FONT_DIR`). They come from Google Fonts (`fonts.gstatic.com`) and, for the PostScript font tests, Source Sans 3 (adobe-fonts/source-sans on `raw.githubusercontent.com`). Fetching is done in one place, `test/helpers.ts`; when a test needs another font, add it to the list there (the list is part of the CI cache key).
The official Unicode conformance tests (`LineBreakTest.txt` for UAX #14, `GraphemeBreakTest.txt` for UAX #29, `BidiTest.txt` and `BidiCharacterTest.txt` for UAX #9) are likewise fetched on first run from `unicode.org` (`https://www.unicode.org/Public/<version>/ucd/`) into `.cache/unicode` (changeable with `KUMIORI_UCD_DIR`). Fetching is done in one place, `test/ucdTestData.ts`, and the version follows the UCD version the tables in `src/unicodeData.ts` were generated from. Where they cannot be fetched, the tests check only a small hand-written set of sequences in place of the official data.
For the integration tests, setting `KUMIORI_E2E_FONT_CACHE` to a directory makes the browser's fetched fonts be stored there, so later runs do not use the network (CI uses this). `KUMIORI_E2E_FONT_DIR` is for supplying fonts by hand under fixed file names.

Comparison with sample PDFs (prepare the sample FO and PDF files yourself; they are not in the repository. poppler's pdftoppm is required):

```bash
node scripts/compare-pdf.mjs --fo <FO directory> --ref <sample PDF directory> --img <image directory> --out compare-pdf-out
```

Each FO is paired with the PDF of the same name. `compare-pdf-out/report.md` lists the page count of each sample and the difference of each page (largest differences first). Add `--compat antenna` when comparing with Antenna House samples (the default is spec mode). To typeset with the same fonts as the samples, pass the font files with `--fonts <directory>`, and replace the default fonts used for the generic families (`serif`, `sans-serif`) with `--web-fonts <directory>` (put MS Mincho, MS Gothic, Times New Roman and Arial under names such as `notoserif.ttf`, `notosans.ttf`, `tinos400.ttf` and `arimo400.ttf`; extract the first font of a TTC as a TTF).

To build a page for comparing the samples and Kumiori's output by eye (the sample PDFs and Kumiori's PDFs are paired by the same name):

```bash
node scripts/compare-view.mjs --ref <sample PDF directory> --pdf <Kumiori PDF directory> --out compare-view-out
```

Open `compare-view-out/index.html` in a browser. The samples are sorted with the largest differences first, and for each page you can switch between "Side by side", "Overlay" (with adjustable opacity), "Blink" and "Diff" (blue where only the sample has text or lines, red where only Kumiori does). `--inline` produces a single HTML file with the images embedded. `--jpeg` makes the page images JPEG to reduce their size. `--artifact` writes it out in a form for publishing as a claude.ai Artifact (the diff images are drawn in the browser).
