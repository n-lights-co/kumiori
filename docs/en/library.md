> 日本語: [../library.md](../library.md)

# Using Kumiori as a library

This guide covers typesetting HTML+CSS and XSL-FO from TypeScript or JavaScript programs, and producing PDF, Canvas, SVG and PNG output.
Every function, type and option is listed in the API reference (<https://n-lights-co.github.io/kumiori/api/>; see [API reference](#api-reference)).

- [Installing](#installing)
- [A first example](#a-first-example)
- [Entry points](#entry-points)
- [Typesetting options](#typesetting-options)
- [The typeset result (TypesetResult)](#the-typeset-result-typesetresult)
  - [PDF (toPdf)](#pdf-topdf) · [PDF/X and PDF/A](#pdfx-and-pdfa) · [Canvas (renderPage)](#canvas-renderpage) · [SVG (renderPageToSvg)](#svg-renderpagetosvg) · [PNG (renderPageToPng)](#png-renderpagetopng)
- [Making only the PDF (typesetToPdf)](#making-only-the-pdf-typesettopdf)
- [Files and external resources](#files-and-external-resources)
- [Errors and diagnostics](#errors-and-diagnostics)
- [draw.io diagrams](#drawio-diagrams)
- [Plugins](#plugins)
- [Node helpers (kumiori/node)](#node-helpers-kumiorinode)
- [Package entry points and requirements](#package-entry-points-and-requirements)
- [Showing a print preview in the browser](#showing-a-print-preview-in-the-browser)
- [Typesetting in a Web Worker](#typesetting-in-a-web-worker)
- [Units and coordinates](#units-and-coordinates)
- [API reference](#api-reference)

## Installing

```bash
npm install kumiori
```

When building in this repository, use `npm run build:lib` (`dist-lib/`; ES modules and type declarations).
In a browser without a bundler, a single file can be loaded from a CDN ([Package entry points and requirements](#package-entry-points-and-requirements)).

## A first example

```ts
import { typeset, typesetToPdf, walkAreaTree } from 'kumiori';

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
const { pdf: bytes } = await typesetToPdf(html, { name: 'book.html' }); // when only the PDF is needed (it keeps no layout result, so large documents use less memory)
result.renderPage(canvas, 0);                                  // draw page 1 onto a canvas (browser)
const svg = await result.renderPageToSvg(0);                   // page 1 as an SVG string (browser or Node)
const png = await result.renderPageToPng(0, { dpi: 150 });     // page 1 as PNG (a Uint8Array; browser or Node)
```

## Entry points

| Function | What it does |
| --- | --- |
| `typeset(text, options)` | Typesets a document and returns the typeset result (`TypesetResult`). The kind comes from `options.kind`, or from `name` and the content |
| `typesetHtml`, `typesetFo` | `typeset` with the kind fixed |
| `typesetToPdf(text, options, pdfOptions)` | Makes only the PDF ([below](#making-only-the-pdf-typesettopdf)) |
| `await createTypesetter(setup)` | Creates a container that loads the fonts only once. Typeset with `typesetter.typeset(...)` and `typesetter.typesetToPdf(...)` |
| `decodeDocumentText(bytes)` | Turns the bytes of a file into a string according to the BOM, the XML declaration's `encoding` and `<meta charset>` |
| `walkAreaTree(tree, fn)` | Walks the typeset result (Area Tree) ([`docs/en/area-tree.md`](area-tree.md)) |
| `isKumioriError(e)` | Tells whether an error was thrown by Kumiori ([Errors and diagnostics](#errors-and-diagnostics)) |
| `DEFAULT_FONTS` | The fonts used by default (the `family`, `weight` and `urls` of the `spec` passed to `loadFont`) |

- `typeset` does not touch the file system. It uses the network only to fetch the default fonts (replaceable with `loadFont`) and the images and stylesheets the document references via `http(s):` (can be stopped with `fetchImages` and `fetchStyles`). So it runs both in the browser and in Node.
- `text` is a string. When reading from a file, convert it with `decodeDocumentText(bytes)` (reading as fixed UTF-8 garbles Shift_JIS FO and the like).
- When typesetting repeatedly (e.g. for an editor preview), create a container with `await createTypesetter(setup)`. It is faster because the fonts are not fetched and parsed every time (the math, monospace and symbol fonts are loaded the first time a document that uses them is typeset).
- The options that stay the same however many times you typeset, mostly about fonts (`fonts`, `genericFonts`, `loadFont`, `fetchTimeoutMs`, `deflate`; type `TypesetterOptions`) are passed in `setup` when the container is created. They are not part of the per-document options of `typesetter.typeset` and `typesetter.typesetToPdf` (type `DocumentOptions`); `fonts`, `genericFonts` and `loadFont` passed there are not used, and an `api/setup-option-ignored` warning is given.
- Internal entities declared in the internal subset of the FO's DOCTYPE (such as `<!ENTITY nbsp "&#160;">`) are expanded before import (external entities are not read).

## Typesetting options

The second argument of `typeset(text, options)` (type `TypesetOptions`). Many have the same meaning as the command's options ([`docs/en/cli.md`](cli.md)).
The tables below list the main options. All of them are in the [API reference](#api-reference).

### Input

| Option | Contents | Command |
| --- | --- | --- |
| `kind` | `html`, `xhtml`, `fo`. If omitted, determined from `name` and the content | |
| `name` | The input file name | |
| `files` | An array of `{ name, data }` for CSS, images and fonts. `data` is the content or a function that reads it only when used. Fonts may be TTF, OTF, TTC, WOFF or WOFF2 | |
| `resolveResource` | A function that returns the content of files not in `files` ([Files and external resources](#files-and-external-resources)) | |
| `lang` | Language of `warnings` and error messages: `ja` or `en`. Japanese by default. If calls with different `lang` values run at the same time (without awaiting each other), the language of the call that started last applies while they overlap (to keep the languages apart, await the calls one by one, or typeset in separate Workers or processes) | `--lang` |

### Style and fonts

| Option | Contents | Command |
| --- | --- | --- |
| `style` | The default style for HTML | `--style` |
| `pageSize` | The default paper for HTML: the paper of a document that does not specify `size` in `@page`, written like the CSS `size` property (`"A5"`, `"A5 landscape"`, `"148mm 210mm"`; lengths of 1pt or more, otherwise a `KumioriOptionError`). A4 by default. A `@page { size }` in the document wins. `width` and `height` in `@media` are also evaluated against this paper | `--page-size` |
| `compat` | The XSL-FO default-value convention | `--compat` |
| `fonts` | Fonts to add | `--font` |
| `genericFonts` | Fonts for the generic font families. The names are `serif`, `sans-serif`, `monospace`, `serif-cjk`, `sans-serif-cjk` | `--generic-font` |
| `loadFont` | How to load the default fonts. If omitted, they are fetched from Google Fonts (only `https:` URLs are tried) | |
| `svgLanguages` | An array of language tags to match SVG `systemLanguage` against | `--svg-lang` |

### PDF

| Option | Contents | Command |
| --- | --- | --- |
| `tagged` | Write tagged PDF. `true` by default; `false` omits the tags | `--tagged`, `--no-tagged` |
| `pdfua` | Write PDF/UA-1 (implies tagged PDF). `true` or `{ warnings }` | `--pdfua` |
| `documentLang` | The document language used when the input has none (a BCP 47 language tag) | `--document-lang` |
| `print` | Bleed and trim marks | `--print` |
| `spotColors` | Alternate CMYK for spot colors | `--spot-colors` |
| `links` | Which links that leave the document get an action in the PDF (below) | `--link-schemes`, `--link-launch`, `--link-relative` |
| `deflate` | A compression function. In Node, passing `zlib.deflateSync` speeds up PDF output | |

`links` is `{ schemes?: string[]; launch?: boolean; relative?: 'file' | 'uri' }`.

- By default, only URLs whose scheme is `http`, `https`, `mailto` or `tel` and relative references to a PDF get an action. The rest are typeset as plain text and reported in `warnings`.
- `schemes` is the list of allowed schemes (it replaces the default; `'*'` means all).
- `launch: true` also writes the actions that open a file (relative non-PDF files, absolute paths, `//host/…`).
- `{ schemes: ['*'], launch: true }` writes everything.

### External fetching

| Option | Contents | Command |
| --- | --- | --- |
| `fetchImages` | Whether to fetch the images the document references via `http(s):`. `true` by default; `false`, or a function that takes a URL and returns a boolean | `--no-fetch-images` |
| `fetchStyles` | Whether to fetch the stylesheets the document references via `http(s):` and the fonts of their `@font-face` rules. The same form as `fetchImages` | `--no-fetch-styles` |
| `fetchTimeoutMs` | Timeout for fetching fonts and images. 30 seconds by default. It applies until the body has been read completely | |
| `drawio` | Options for draw.io diagrams ([draw.io diagrams](#drawio-diagrams)) | `--no-drawio`, `--drawio-stencils` and others |
| `plugins` | An array of plugins ([Plugins](#plugins)) | `--plugin` |

When typesetting others' documents on a server, disable `fetchImages` and `fetchStyles` or allow only certain URLs ([Files and external resources](#files-and-external-resources)).
Check the exact names and syntax of the options in the Command column in the list in [`docs/en/cli.md`](cli.md).

## The typeset result (TypesetResult)

| Member | Contents |
| --- | --- |
| `pageCount` | The number of pages |
| `areaTree` | The physical tree of the typeset result (Area Tree). Its JSON form is in [`docs/en/area-tree.md`](area-tree.md) |
| `warnings` | Typesetting warnings (an array of strings: unreadable images, overflow and so on; they go here instead of being thrown) |
| `diagnostics` | The same events as `warnings`, with codes and locations ([Errors and diagnostics](#errors-and-diagnostics)) |
| `toPdf(options)` | Returns the PDF bytes (`Uint8Array`) |
| `renderPage(canvas, i, options)` | Draws a page onto a canvas (browser) |
| `renderPageToSvg(i, options)` | Turns a page into an SVG string (browser or Node) |
| `renderPageToPng(i, options)` | Turns a page into PNG bytes (browser or Node) |

Pages are counted from 0.

### PDF (toPdf)

`result.toPdf({ title, pdfx, pdfa, imageMaxDpi })` (type `PdfOptions`).

| Option | Contents |
| --- | --- |
| `title` | The PDF title |
| `pdfx` | PDF/X marking for print submission (below) |
| `pdfa` | PDF/A marking for long-term archiving (below) |
| `imageMaxDpi` | The upper limit of JPEG resolution |

Warnings raised while writing the PDF (characters that cannot be drawn, color glyphs that cannot be drawn in color, etc.) are added to `result.warnings`.

### PDF/X and PDF/A

**PDF/X** is `pdfx: { version, condition, info, profile, warnings }` (the same as `--pdfx` and `--output-profile` on the command line).

- `version` is `'X-1a'`, `'X-1a:2003'`, `'X-3'` or `'X-4'`. X-3 by default. Any other value (including a difference in case such as `'x4'`, and aliases such as `'X-1a:2001'` and `'X-3:2003'`) is an option error, `KumioriOptionError` (with `option` set to `'pdfx.version'`).
- RGB colors and images are converted to CMYK. X-1a and X-3 flatten transparency.
- X-4 needs a CMYK output device ICC profile in `profile`. X-1a needs `profile` when `condition` is not in the ICC registry.
- Every version checks the written PDF against its rules.
- Links, annotations and form fields on the pages, and actions (such as external bookmark destinations), are not written; their number is added to `warnings`. Bookmarks keep their titles and destinations within the document.

**PDF/A** is `pdfa: { version: 'A-2b' | 'A-3b', warnings }` (the same as `--pdfa` on the command line). Combining it with `pdfx` needs `pdfx.profile`.

**Relation to the texts of the standards**

- The PDF/X output and the check of the written PDF were built from, and checked for conformance against, the texts of PDF/X-1a:2001 (ISO 15930-1) and PDF/X-4 (ISO 15930-7). PDF/X-1a:2003 and PDF/X-3 have not been checked against their texts; the PDF/X-1a:2001 rules are applied to them. Before submitting the output, check it with a preflight tool (such as Acrobat Pro).
- PDF/A has not been verified against the text of the standard ISO 19005, so conformance is not guaranteed. Kumiori reads the written PDF back and checks it against the requirements, and development also checks output with the PDF/A validator veraPDF, but check it with a PDF/A validator before archiving it.

### Canvas (renderPage)

`result.renderPage(canvas, i, { scale, devicePixelRatio, guides })`

| Option | Contents |
| --- | --- |
| `scale` | The scale. At 1, 1pt = 1 CSS px (actual size is 96 / 72) |
| `devicePixelRatio` | The device pixel density |
| `guides` | Guide lines for the trim box and bleed |

Glyphs are drawn from the outlines in the font files, so the page's CSS and `@font-face` have no effect on them.
A nonexistent page number is a `RangeError`. An example is in [Showing a print preview in the browser](#showing-a-print-preview-in-the-browser).

### SVG (renderPageToSvg)

`result.renderPageToSvg(i, { guides, idPrefix })` turns a page into an SVG document (a string). It works in the browser and in Node, with no added dependencies.

- The size is the paper size (pt).
- Glyphs become paths from the font file outlines. There are no `text` elements, so the SVG draws the same glyphs as the PDF even where the fonts are not installed. Each glyph outline is written once in `defs` and placed with `use`.
- Images are embedded as data: URIs. PNG and JPEG as they are; GIF, BMP and WebP are converted to PNG.
- The same image is embedded once per placed size and referenced with `use` where it is placed. When one image is placed in more than 8 sizes, the other sizes reference one embedded copy stretched.
  Because the content is embedded once per size, placing one image in many sizes (the tile sizes of repeated backgrounds count too) makes the SVG up to about 9 times the image's embedded data (base64, about 4/3 of the original file).
- SVG images are turned into shapes first, as for the PDF (text as outlines; filters that cannot be approximated as images computed in pixels; `vector-effect` strokes and sizes as shapes divided by the scale at which the SVG is placed).
  However, `svgLanguages` (`--svg-lang`) has no effect (`switch` chooses by the language of the runtime), and the content of `foreignObject` is not drawn (the PDF draws it). The same applies to `renderPageToPng`.
- Color glyphs become shapes, gradients and images (a sweep gradient is filled with the average of its stop colors, and compositing such as source-in is approximated by painting on top).
- CMYK and spot colors are converted to RGB with the same formula as on screen.
- Links, annotations and form fields are not written (nor are links inside SVG images).

| Option | Contents |
| --- | --- |
| `guides` | Guide lines for the trim box and bleed |
| `idPrefix` | The prefix of the ids inside the SVG. `k` by default |

An id is the prefix followed by a number and names clip paths, gradients, images and so on.
When putting several SVGs directly into one HTML page, give each page a prefix that is not the start of another page's prefix: end it with a non-digit, such as `p1-`, `p2-` (with `k` and `k1`, `k10` and `k1` + `0` collide).
`idPrefix` must be an XML name: the Name of XML 1.0 §2.3 without `:`. It starts with a letter, `_` or another name-start character such as kana, followed by name characters such as digits, `-` and `.`. Otherwise a `RangeError` is thrown.
For a nonexistent page number, the returned Promise is rejected with a `RangeError`.

### PNG (renderPageToPng)

`result.renderPageToPng(i, { dpi, guides })` turns a page into PNG bytes (a `Uint8Array`; 8-bit RGB on white paper). It works in the browser and in Node, and is rasterized by Kumiori itself with no added dependencies.

- `dpi` is the resolution. 96 by default. Up to 40 million pixels per image, otherwise a `RangeError`.
- It draws the same way as `renderPageToSvg` (glyphs from the font outlines, SVG images as the same shapes as in the PDF), with anti-aliasing; images placed smaller are reduced by averaging pixels.
- Images that cannot be decoded to pixels (CMYK JPEG, interlaced PNG) are not drawn and are added to `result.warnings`.
- Decoded images are kept and limited (the rasterizing work and the layer pixels held at once too) as for PNG output of the command ("Limits and memory" in [`docs/en/cli.md`](cli.md)). The work of gradients with many color stops is not counted, so when rasterizing documents written by others, put a time limit on it from outside.
- Speed: a text-heavy A4 page at 150dpi takes about 0.5 seconds (Node 22 on a 2026 x86 machine).
- For a nonexistent page number, the returned Promise is rejected with a `RangeError`.

## Making only the PDF (typesetToPdf)

`typesetToPdf(text, options, pdfOptions)` makes only the PDF. It gives the same PDF, warnings and page count as calling `toPdf(pdfOptions)` after `typeset`.

- The result is `{ pdf, pageCount, warnings, diagnostics, layoutMs }` (type `TypesetPdfResult`). There is no `areaTree` or `renderPage`.
- `pdfOptions` has the type `TypesetPdfOptions`: `PdfOptions` of `toPdf` plus `lowMemory`. With `lowMemory: true`, it typesets with less memory (the same as the command's `--low-memory`).
- It turns the pages into the layout result (Area Tree) one at a time, writes each to the PDF and releases it. It never holds the layout result of the whole document, so documents of thousands of pages use less memory.
  In exchange, the layout result of a page is built twice, once to collect the fonts and images used and once to draw it.
- `layoutMs` does not include the time to turn the pages into layout results (it is part of writing the PDF).
- The Node command also makes PDFs with it. The container from `createTypesetter()` also has `typesetter.typesetToPdf(text, options, pdfOptions)`.

## Files and external resources

### resolveResource

`resolveResource(url)` is asked for each file the document or the CSS references (`<link rel="stylesheet">`, `@import`, `url()`, `<img src>`, etc.) that is not in `files`.

- `url` is the reference as written (`file:///…/a.css`, `img/a.png`, `https://…`). Relative references inside a CSS file are resolved against that CSS file's URL.
- If it returns content (a string, `Uint8Array` or `ArrayBuffer`), that is used. If it returns `undefined`, things work as before (`http(s):` images and stylesheets are fetched from the network).
- There is no need to rewrite the references and put the files into `files`.
- An image is recognized from the leading bytes of the returned content, even when its URL has no extension (such as `https://example.com/img?id=1`).

In Node, `createFileResolver()` from `kumiori/node` makes a `resolveResource` that reads files referenced with `file:` URLs ([Node helpers](#node-helpers-kumiorinode)).

### fetchImages, fetchStyles and redirects

The function passed to `fetchImages` / `fetchStyles` is asked not only about the URL written in the document but also about every redirect target.

- On Node, redirects are followed one hop at a time (up to 20), and no request is sent to a target the function refuses.
- Redirects from `https:` to `http:` and redirects to non-`http(s):` targets are refused without asking the function (also when the option is `true`).
- In browsers, scripts cannot read a redirect target in advance, so the function is asked about the final URL after the browser has followed the redirects, and the response is discarded if it is refused (the request itself has already reached the redirect target).
- The function only sees the URL string: a host name that resolves to an internal address (including DNS rebinding) cannot be stopped by it. To protect an internal network when typesetting documents written by others on a server, also restrict the runtime itself (egress rules, an outbound proxy).

Resources fetched from the network have size limits.

| Resource | Limit |
| --- | --- |
| Images | 256 MB |
| CSS | 16 MB |
| Fonts | 128 MB |

Anything larger is abandoned mid-read and treated as an unreadable resource, even when the response has no `Content-Length`.
How to limit time and memory when typesetting on a server is in the "External fetching and file access" and "Limits and memory" sections of [`docs/en/cli.md`](cli.md).

## Errors and diagnostics

### Thrown errors

| Case | Result |
| --- | --- |
| The FO's XML cannot be parsed | `typeset` throws (`XML の解析に失敗しました: …`, "failed to parse XML: …") |
| The default fonts cannot be read | `typeset` throws (`書体を読めません: …`, "cannot read font: …") |
| A font file passed in `fonts` is corrupt | Not thrown; goes into `warnings` |
| A nonexistent page number for `renderPage` | `RangeError` (`renderPageToSvg` and `renderPageToPng` return a Promise rejected with a `RangeError`) |
| Typesetting warnings (unreadable images, overflow, etc.) | Not thrown; go into `result.warnings` |

Errors thrown by Kumiori are `KumioriError` and its subclasses (`KumioriInputError`, `KumioriLimitError`, `KumioriFontError`, `KumioriPdfError`), which carry a code `code`, or `KumioriOptionError` for invalid options.
`KumioriOptionError` extends `TypeError` as before and carries the name of the option in `option`.
`isKumioriError(e)` tells them apart. The codes are listed in [`docs/en/diagnostics.md`](diagnostics.md).

### Diagnostics

`result.diagnostics` (also in the result of `typesetToPdf`) holds the same events as `warnings`, in this form.

| Member | Contents |
| --- | --- |
| `code` | The code (such as `css/unknown-property`; not changed across versions) |
| `severity` | `error` when content is missing from the output, `warning` when a specification was ignored, `info` for notices |
| `message` | The text |
| `args` | The values embedded in the text |
| `count` | The number of identical occurrences |
| `source` | When known, the location in the input (file, line, column, element, the Area Tree `sourceRef`, the PDF page) |

Unsupported and unknown CSS and XSL-FO are gathered into one text in `warnings`, but are one diagnostic per item in `diagnostics`. The texts and order of `warnings` are unchanged.
The codes and severities are listed in [`docs/en/diagnostics.md`](diagnostics.md).

## draw.io diagrams

`drawio` holds the options for draw.io (diagrams.net) diagram files (`.drawio`, `.dio`; the type is `DrawioOptions`).

By default, draw.io diagrams are read as images, and a page is converted to SVG and placed in the PDF as shapes and text (the code that draws diagrams is loaded only when a diagram appears). With `false`, draw.io diagrams are not read as images.
The table below lists the main options (all of them are in the [API reference](#api-reference)).

| Option | Contents |
| --- | --- |
| `stencils` | Shape library and distributed image files |
| `fetchStencils` | Whether to fetch missing shape libraries and images from draw.io's distribution. `false` by default |
| `stencilsUrl` | The URL of the `stencils.min.js` to fetch from (when `fetchStencils` is used) |
| `provideStencils` | A function that receives the names of the missing shape libraries and images and returns a shape library registry (when given, `stencils` and `fetchStencils` are not used) |

The syntax, page selection and what is drawn are described in [`docs/en/drawio.md`](drawio.md).

## Plugins

`plugins` is an array of plugins. For now, plugins can only add image formats.

```ts
{ apiVersion: 1, name, imageFormats: [{ name, mime, extensions, sniff, load }] }   // types KumioriPlugin and ImageFormat
```

- When an image file matches a format's `sniff` (a synchronous check of the content), its `load` (asynchronous) returns SVG and a size, and Kumiori draws it as an SVG image (it goes into the PDF as shapes).
- Files named with the `extensions` are also read as images when the document mentions them.
- Heavy code can be loaded with `import()` inside `load`, so that it is loaded only when a file of that format appears.
- `apiVersion` is the version of the plugin interface (`PLUGIN_API_VERSION`), raised on incompatible changes.
- Plugin formats are checked before the core's formats (draw.io diagrams).

What `load` receives (the main items; all of them are in the [API reference](#api-reference)):

| Name | Contents |
| --- | --- |
| `measureText` | Measures text with the fonts that draw it |
| `fetchResource` | Fetches under the same rules as the document's images (`resolveResource` and `fetchImages`) |
| `fetch` | Fetches what the user allowed through the plugin's own options |
| `warn` | Reports a warning |
| `lang` | The language for warnings (`ja` or `en`; `TypesetOptions.lang`) |
| `fragment` | The part of the image reference after `#`, to select which diagram or page of a file to draw. When the same file is referenced with different fragments, `load` is called once per reference and each becomes its own image |

The results of `load` have limits (the same applies to draw.io diagrams; `src/imageFormats.ts`). Anything beyond them is treated as an unreadable image, with a warning.

| Limit | Value |
| --- | --- |
| Size | Finite, at most 10 million px |
| Length of the SVG | About 33.6 million characters plus 128 characters per byte of the file (at most about 134 million characters) |
| Time limit | 60 seconds plus three times the fetch time limit (`fetchTimeoutMs`) (150 seconds by default) |
| References with different fragments after `#` to one file | At most 64 |

A plugin runs with the same rights as Kumiori. Pass only plugins you chose and trust.

## Node helpers (kumiori/node)

```ts
import { typeset } from 'kumiori';
import { createFileResolver, createFontLoader } from 'kumiori/node';
const result = await typeset(html, { loadFont: createFontLoader(), resolveResource: createFileResolver() });
```

The table below lists the main helpers (all of them are in the [API reference](#api-reference)).

| Helper | Contents |
| --- | --- |
| `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` | A `loadFont` that reads the default fonts the same way as the Node CLI: `fontDir` → the font cache → the network; fetched fonts are saved in the cache. `cacheDir` defaults to `defaultFontCacheDir()`; `null` disables the cache |
| `createFileResolver({ root })` | A `resolveResource` that reads files referenced with `file:` URLs. With `root`, only files inside it are read. `root` may also be a list of directories, and containment is checked on the real paths after resolving symbolic links |

## Package entry points and requirements

| Entry point | File | Use |
| --- | --- | --- |
| `kumiori` | `dist-lib/index.js` | An ES module that does not bundle its dependencies (pdf-lib, fontkit, xmldom, etc.). Use it with a bundler such as Vite or webpack, or load it from Node |
| `kumiori/node` | `dist-lib/node.js` | The Node helpers ([above](#node-helpers-kumiorinode)) |
| `kumiori/browser` | `dist-browser/kumiori.js` | A single file with the dependencies bundled, for browsers without a bundler |

- Only what is exported from `src/index.ts` (and `src/node.ts` for Node) is public. The functions and types of other modules may change between versions.
- It is ES module only, but `require('kumiori')` also works (on Node 20.19.0 or later and 22.12.0 or later, which can load ES modules with `require()`; Node 22.0 to 22.11 needs `--experimental-require-module`).
- Node 20.19.0 or later in the 20 line, or 22.12.0 or later, is required. The dependencies used to read HTML (such as css-select used by linkedom) require Node 20.19.0 or later. 22.0 to 22.11 are excluded because they cannot load ES modules with `require()`.

`kumiori/browser` is about 3.0MB (1.0MB gzipped). Together with the separate files it loads at start (`chunks/`, such as pdf-lib and pako) it is about 3.6MB (pdf-lib is a separate file because it is shared with the code for draw.io diagrams).
The hyphenation dictionaries, the CGM, EPS, WMF, EMF and draw.io diagram processing and the like are loaded as separate files only when used.
The version published on npm can be loaded directly from the jsDelivr or unpkg CDN.

```html
<script type="module">
  import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.5.0/dist-browser/kumiori.js';
  const result = await typesetHtml(html, { name: 'a.html' });
  result.renderPage(document.querySelector('canvas'), 0);
</script>
```

## Showing a print preview in the browser

`result.renderPage(canvas, pageNumber, { scale })` draws a typeset page onto a canvas.
On the browser's main thread, HTML is parsed with the browser's DOMParser (linkedom is used in Node and in a [Web Worker](#typesetting-in-a-web-worker)).

Example: typeset the HTML being edited in an editor each time the user pauses, and show it in a preview

```ts
import { typeset } from 'kumiori';
import type { FontSpec } from 'kumiori';

const printCss = '@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } } body { font-family: serif }';
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const loadFont = (spec: FontSpec) => {                          // fetch the default fonts only once and reuse them
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

- When typesetting repeatedly, create a container with `await createTypesetter(setup)` that loads the fonts only once, and typeset with `typesetter.typeset(html, options)`; it is faster (pass the font-related options such as `loadFont` in `setup`).
- Working sample: after `npm run dev`, open http://localhost:5173/examples/preview/ (`examples/preview/`).
  Edit the editing area on the left, the "HTML" box below it (write headings, ruby, tables and so on directly; it and the editing area mirror each other) or the print CSS, and the right side is re-typeset when you pause.
  It uses only Kumiori's public API and has no other dependencies.
  To connect another editor, call the equivalent of the sample's `schedule(editor HTML)` from the notification that the editor's content has changed.

## Typesetting in a Web Worker

Typesetting, drawing and writing the PDF can run in a Web Worker, so that the page does not freeze while a large document is typeset. Load the single-file browser build (`kumiori/browser`) inside the worker.
This works from 0.5.0 (0.4.0 cannot typeset in a worker).

```js
// worker.js (created with new Worker('worker.js', { type: 'module' }))
import { createTypesetter } from 'https://cdn.jsdelivr.net/npm/kumiori@0.5.0/dist-browser/kumiori.js';
const typesetter = createTypesetter();                          // Promise<Typesetter>; fonts are loaded only once
let result;
self.onmessage = async ({ data }) => {
  if (data.type === 'typeset') {
    result = await (await typesetter).typeset(data.html, { name: 'a.html' });
    self.postMessage({ type: 'typeset', pageCount: result.pageCount, sheets: result.areaTree.sheets.map((s) => [s.width, s.height]) });
  } else if (data.type === 'render') {
    const canvas = new OffscreenCanvas(1, 1);
    result.renderPage(canvas, data.page, { scale: data.scale, devicePixelRatio: data.dpr });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: 'render', page: data.page, bitmap }, [bitmap]);
  } else if (data.type === 'pdf') {
    const pdf = await result.toPdf();
    self.postMessage({ type: 'pdf', pdf }, [pdf.buffer]);
  }
};
```

### Drawing

- Pass an `OffscreenCanvas` to `renderPage`. Turn the drawn pixels into an `ImageBitmap` with `transferToImageBitmap()`, send it to the page and show it, for example on a `bitmaprenderer` canvas.
- A worker has no `window.devicePixelRatio`, so pass the page's value as `devicePixelRatio` (1 if omitted).
- When bundling `kumiori` (`dist-lib`) into a worker with a bundler, linkedom may not load (it is only loaded at run time, for Node). Use `kumiori/browser`.

### Differences from typesetting on the main thread

- A worker has no DOMParser, so HTML and SVG are parsed with linkedom (the same parsing as in Node). linkedom is loaded from a separate file (`chunks/`) the first time a document is typeset in a worker (it is not loaded when typesetting on the main thread).
- So a document typeset in a worker comes out the same as in Node, and may differ from one typeset on the main thread (DOMParser). For example, linkedom puts the `math` elements of MathML in HTML in the XHTML namespace, so formulas are typeset differently from the main thread.
- SVG in `renderPage` and in the PDF made in a worker may look different from the SVG the browser draws on the page.
  - The content of `foreignObject` is typeset like the body text in the PDF, but `renderPage` only approximates its text.
  - A filter of `feGaussianBlur` (blur) alone, such as a shadow, is drawn without the blur (as in the PDF from Node).
  - An SVG image inside an SVG (an SVG referenced by `<image>`) is drawn as a placeholder box (as in Node).

### Images and limits

- A worker has no browser images (`<img>`), so SVG images are drawn as shapes in the PDF, as in Node, and `renderPage` draws the shapes as pixels (redrawn at the resolution of the current scale). Images in other formats are read with `createImageBitmap`.
- Limits when `renderPage` rasterizes SVG images:
  - One image is drawn with up to 16 million pixels. An image placed larger is drawn at a lower resolution.
  - The work of rasterizing the shapes (number of shapes × number of pixels) is limited too, so an image with many shapes placed large is also drawn at a lower resolution.
  - The total work of one drawing is limited as well; images after it is used up are drawn as placeholder boxes with a `canvas/svg-not-drawn` warning.
- Images inside SVG in forms the typesetter's own pixel decoder cannot read (CMYK JPEG, interlaced PNG) are read with `createImageBitmap` when the document is typeset, for `renderPage`.
  - Each image is read with up to 4 million pixels. A larger image is scaled down; an image whose header gives more than 4 million pixels is scaled down while it is read, without decoding it at full size.
  - Up to 32 million pixels in total per typeset result. Images are read in the order they were loaded: first the images in the files passed in `files`, then data: URLs and fetched images in the document. Within one SVG, they are read in the order written.
    Images after the total reaches the limit (usually those later in the document; small images that still fit are read) are not read and are not drawn by `renderPage`. No warning is given for them.
  - The PDF is not affected (this limit does not apply to images in the PDF).

## Units and coordinates

- The internal unit is **pt** (only page settings use mm). An Area's `x` and `y` are physical coordinates relative to the top left of the parent's content-box (y pointing down).
- Absolute positioning (`absolutePosition`) is relative to the **top left of the trim box**. To reach into the bleed, specify negative `top` and `left`.
- `width` and `height` default to `content-box`. `boxSizing: 'border-box'` makes them include padding and border.

The shape and JSON of the typeset result (Area Tree) are in [`docs/en/area-tree.md`](area-tree.md), and how Kumiori works inside is in [`docs/en/architecture.md`](architecture.md).

## API reference

Every function, type and option is described in the API reference (<https://n-lights-co.github.io/kumiori/api/>), a list of pages generated from the comments in the type declarations.
The reference is in Japanese only, because it is generated from the Japanese comments in the source; this guide covers the main functions and options in English.
In this repository, `npm run docs:api` builds it into `dist/api/`.
