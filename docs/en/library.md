> 日本語: [../library.md](../library.md)

# Using Kumiori as a library

This guide covers typesetting HTML+CSS and XSL-FO from TypeScript or JavaScript programs, and producing PDF, Canvas, SVG and PNG output.
Every function, type and option is listed in the API reference (<https://n-lights-co.github.io/kumiori/api/>; see [API reference](#api-reference)).

- [Installing](#installing)
- [A first example](#a-first-example)
- [Entry points](#entry-points)
- [Typesetting options](#typesetting-options)
- [The typeset result (TypesetResult)](#the-typeset-result-typesetresult)
  - [PDF (toPdf)](#pdf-topdf) · [PDF/X and PDF/A](#pdfx-and-pdfa) · [Canvas (renderPage)](#canvas-renderpage) · [SVG (renderPageToSvg)](#svg-renderpagetosvg) · [PNG (renderPageToPng)](#png-renderpagetopng) · [Memory estimate and releasing (memoryUsage, dispose, releaseCaches)](#memory-estimate-and-releasing-memoryusage-dispose-releasecaches)
- [Making only the PDF (typesetToPdf)](#making-only-the-pdf-typesettopdf)
- [Writing the PDF as a stream (typesetToPdfStream)](#writing-the-pdf-as-a-stream-typesettopdfstream)
- [Encrypting the PDF (encrypt)](#encrypting-the-pdf-encrypt)
- [Measuring text without a document (measureText, breakLines)](#measuring-text-without-a-document-measuretext-breaklines)
- [Files and external resources](#files-and-external-resources)
- [Errors and diagnostics](#errors-and-diagnostics)
- [draw.io diagrams](#drawio-diagrams)
- [Plugins](#plugins)
- [Node helpers (kumiori/node)](#node-helpers-kumiorinode)
- [Package entry points and requirements](#package-entry-points-and-requirements)
- [Showing a print preview in the browser](#showing-a-print-preview-in-the-browser)
- [Typesetting in a Web Worker](#typesetting-in-a-web-worker)
- [Units and coordinates](#units-and-coordinates)
- [API stability (what is kept across versions)](#api-stability-what-is-kept-across-versions)
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
await result.renderPage(canvas, 0);                            // draw page 1 onto a canvas (browser)
const svg = await result.renderPageToSvg(0);                   // page 1 as an SVG string (browser or Node)
const png = await result.renderPageToPng(0, { dpi: 150 });     // page 1 as PNG (a Uint8Array; browser or Node)
```

## Entry points

| Function | What it does |
| --- | --- |
| `typeset(text, options)` | Typesets a document and returns the typeset result (`TypesetResult`). The kind comes from `options.kind`, or from `name` and the content |
| `typesetHtml`, `typesetFo` | `typeset` with the kind fixed |
| `typesetToPdf(text, options, pdfOptions)` | Makes only the PDF ([below](#making-only-the-pdf-typesettopdf)) |
| `typesetToPdfStream(text, options, output, pdfOptions)` | Writes the PDF to an output page by page, as a stream ([below](#writing-the-pdf-as-a-stream-typesettopdfstream)) |
| `await createTypesetter(setup)` | Creates a container that loads the fonts only once. Typeset with `typesetter.typeset(...)`, `typesetter.typesetToPdf(...)` and `typesetter.typesetToPdfStream(...)`. `typesetter.measureText(...)` and `typesetter.breakLines(...)` measure text without making a document ([below](#measuring-text-without-a-document-measuretext-breaklines)). `typesetter.memoryUsage()` and `typesetter.releaseCaches()` estimate the Typesetter's memory and release its caches (images for drawing and the reuse caches) ([Memory estimate and releasing](#memory-estimate-and-releasing-memoryusage-dispose-releasecaches)) |
| `decodeDocumentText(bytes)` | Turns the bytes of a file into a string according to the BOM, the XML declaration's `encoding` and `<meta charset>` |
| `walkAreaTree(tree, fn)` | Walks the typeset result (Area Tree) ([`docs/en/area-tree.md`](area-tree.md)) |
| `snapshotDocument(document, options)` | In the browser window, turns the document as JavaScript left it into a form that can be passed to `typeset` ([below](#typesetting-a-page-built-by-javascript-snapshotdocument)) |
| `isKumioriError(e)` | Tells whether an error was thrown by Kumiori ([Errors and diagnostics](#errors-and-diagnostics)) |
| `DEFAULT_FONTS` | The fonts used by default: `{ base, math, mono, symbol, emoji }`, where `base` (the Japanese and Latin body fonts, always used) and `mono` (monospace) are arrays of `FontSpec`, and `math` (MathML), `symbol` (symbols missing from the body fonts) and `emoji` (emoji missing from the symbol font too) are a single `FontSpec` each. A `FontSpec` is `{ family, weight?, urls }`, the same as the `spec` passed to `loadFont` |

Also exported:

| Name | What it is |
| --- | --- |
| `KumioriError`, `KumioriInputError`, `KumioriLimitError`, `KumioriFontError`, `KumioriPdfError`, `KumioriOptionError`, `ERROR_CODES` | The types of the errors thrown, and the list of error names ([Errors and diagnostics](#errors-and-diagnostics)) |
| `DIAGNOSTIC_CODES` | The list of diagnostic names ([`docs/en/diagnostics.md`](diagnostics.md)) |
| `walkAreas`, `childrenOf`, `documentNodes`, `serializeAreaTree`, `parseAreaTree`, `AreaTreeFormatError`, `AREA_TREE_SCHEMA_VERSION` | Functions to walk the Area Tree, write it as JSON and read it back, and the version of its shape ([`docs/en/area-tree.md`](area-tree.md)) |
| `PLUGIN_API_VERSION` | The version of the plugin interface ([Plugins](#plugins)) |
| `DRAWIO_MIME`, `isDrawio`, `createDrawioStencilRegistry` | The MIME type of draw.io diagrams, a function that tells whether a file is a diagram, and a function that creates a shape library registry ([draw.io diagrams](#drawio-diagrams)) |

- `typeset` does not touch the file system. It uses the network only to fetch the default fonts (replaceable with `loadFont`) and the images and stylesheets the document references via `http(s):` (can be stopped with `fetchImages` and `fetchStyles`). So it runs both in the browser and in Node.
- `text` is a string. When reading from a file, convert it with `decodeDocumentText(bytes)` (reading as fixed UTF-8 garbles Shift_JIS FO and the like).
- When typesetting repeatedly (e.g. for an editor preview), create a container with `await createTypesetter(setup)`. It is faster because the fonts are not fetched and parsed every time (the math, monospace and symbol fonts are loaded the first time a document that uses them is typeset).
- The options that stay the same however many times you typeset, mostly about fonts (`fonts`, `genericFonts`, `loadFont`, `systemFonts`, `fetchTimeoutMs`, `deflate`, `reuse`, `imageCache`; type `TypesetterOptions`) are passed in `setup` when the container is created. `limits` can be given both to the container and per document (the container's `limits` apply to loading its fonts and become the default for each document; a document's `limits` are laid over them name by name). They are not part of the per-document options of `typesetter.typeset` and `typesetter.typesetToPdf` (type `DocumentOptions`); `fonts`, `genericFonts`, `loadFont`, `systemFonts` and `reuse` passed there are not used, and an `api/setup-option-ignored` warning is given. `signal` and `onProgress` in `setup` apply only while the container is created; the per-document `signal` and `onProgress` apply while that document is typeset ([Stopping and progress](#stopping-and-progress-signal-onprogress)).
- Internal entities declared in the internal subset of the FO's DOCTYPE (such as `<!ENTITY nbsp "&#160;">`) are expanded before import (external entities are not read).

## Typesetting options

The second argument of `typeset(text, options)` (type `TypesetOptions`). Many have the same meaning as the command's options ([`docs/en/cli.md`](cli.md)).
The tables below list all the options. Their types and the finer rules are in the [API reference](#api-reference).

### Input

| Option | Contents | Command |
| --- | --- | --- |
| `kind` | `html`, `xhtml`, `fo`. If omitted, determined from `name` and the content | |
| `name` | The input file name | |
| `files` | An array of `{ name, data }` for CSS, images and fonts. `data` is the content or a function that reads it only when used. Fonts may be TTF, OTF, TTC, WOFF or WOFF2 | |
| `unreferencedCss` | What to do with CSS files (`files`) that the document (HTML) does not reference. `'user-stylesheet'` (default) adds them as user style sheets; `'ignore'` does not add them and reports a warning | (the command uses `'ignore'`; use `--css` to add one) |
| `resolveResource` | A function that returns the content of files not in `files` ([Files and external resources](#files-and-external-resources)) | |
| `lang` | Language of `warnings` and error messages: `ja` or `en`. Japanese by default. Calls with different `lang` values that run at the same time (without awaiting each other) each keep their own language | `--lang` |
| `diagnostics` | How diagnostics are handled. List in `{ ignore: [...] }` the names of diagnostics not to report (`css/unknown-property` and so on; [`docs/en/diagnostics.md`](diagnostics.md)). Warnings with those names go into neither `warnings` nor `diagnostics` (including warnings while writing the PDF). An unknown name does not stop typesetting and is reported with the warning `api/unknown-diagnostic-code` | `--ignore-warning` |
| `maxPages` | How many pages to lay out from the start (an integer of 1 or more; the whole document by default; [Laying out only the first pages](#laying-out-only-the-first-pages-maxpages)) | `--max-pages` |

### Style and fonts

| Option | Contents | Command |
| --- | --- | --- |
| `style` | The default style for HTML | `--style` |
| `pageSize` | The default paper for HTML: the paper of a document that does not specify `size` in `@page`, written like the CSS `size` property (`"A5"`, `"A5 landscape"`, `"148mm 210mm"`; lengths of 1pt or more, otherwise a `KumioriOptionError`). A4 by default. A `@page { size }` in the document wins. `width` and `height` in `@media` are also evaluated against this paper | `--page-size` |
| `compat` | The XSL-FO default-value convention | `--compat` |
| `fonts` | Fonts to add | `--font` |
| `genericFonts` | Fonts for the generic font families. The names are `serif`, `sans-serif`, `monospace`, `serif-cjk`, `sans-serif-cjk` | `--generic-font` |
| `systemFonts` | A finder that sets characters no loaded font has a glyph for in OS fonts. Not used by default. In Node, pass `createSystemFonts()` from `kumiori/node` ([Node helpers](#node-helpers-kumiorinode)). Only characters that neither the default fonts nor the symbol and emoji fonts have are set in an OS font, limited to those characters (the fonts of other characters do not change), and each OS font used for typesetting is reported with `font/system-fallback`, with the characters set in it (after typesetting, one per font used). Characters in a serif (Mincho) context prefer a serif OS font, and characters in a sans-serif (Gothic) context prefer a sans-serif one (the kind comes from the OS/2 PANOSE and sFamilyClass and from the name; a specified font of unknown kind counts as serif); characters no font of the matching kind has are filled in from fonts of unknown or the other kind. Only the kinds of font the document needs are loaded (a sans-serif font is not loaded for characters that appear only in a serif context). A document's `font-family` cannot name an OS font. The result depends on the fonts of the machine, and the PDF reveals which fonts the machine has, so do not pass it when typesetting documents written by others. A `createTypesetter` option | `--system-fonts` |
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
| `links` | Which links that leave the document get an action in the PDF (below; links in page SVG output follow the same rules) | `--link-schemes`, `--link-launch`, `--link-relative` |
| `deflate` | A compression function (zlib format), used for the streams of page contents, fonts and images. In Node, passing `zlib.deflateSync` speeds up PDF output. When omitted, image streams are compressed with Node's zlib in Node and with `CompressionStream` in browsers and Web Workers, and the other streams with pdf-lib's compression (pako) | |

`links` is `{ schemes?: string[]; launch?: boolean; relative?: 'file' | 'uri' }`.

- By default, only URLs whose scheme is `http`, `https`, `mailto` or `tel` and relative references to a PDF get an action. The rest are typeset as plain text and reported in `warnings`.
- `schemes` is the list of allowed schemes (it replaces the default; `'*'` means all).
- `launch: true` also writes the actions that open a file (relative non-PDF files, absolute paths, `//host/…`).
- `{ schemes: ['*'], launch: true }` writes everything.

### External fetching

| Option | Contents | Command |
| --- | --- | --- |
| `fetchImages` | Whether to fetch the images the document references via `http(s):` (including those referenced by `image` in SVG images and inline `svg`). `true` by default; `false`, or a function that takes a URL and returns a boolean | `--no-fetch-images` |
| `fetchStyles` | Whether to fetch the stylesheets the document references via `http(s):` and the fonts of their `@font-face` rules. The same form as `fetchImages` | `--no-fetch-styles` |
| `fetchTimeoutMs` | Timeout for fetching fonts and images (milliseconds). 30 seconds by default. It applies until the body has been read completely. It is also passed to a plugin's `load` ([Plugins](#plugins)) | |
| `limits` | Change the input limits (image pixels, file sizes, nesting depths and so on; [Input limits](#input-limits-limits)) | `--limit` |
| `signal` | A signal to stop typesetting (`AbortSignal`). Fetches in flight are stopped too ([Stopping and progress](#stopping-and-progress-signal-onprogress)) | |
| `onProgress` | A progress callback ([Stopping and progress](#stopping-and-progress-signal-onprogress)) | |
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
| `layoutMs` | The time spent typesetting, in milliseconds (loading and writing the PDF are not included) |
| `truncated` | Whether layout stopped early because of `maxPages` ([Laying out only the first pages](#laying-out-only-the-first-pages-maxpages)) |
| `toPdf(options)` | Returns the PDF bytes (`Uint8Array`) |
| `toPdfStream(output, options)` | Writes the same PDF as `toPdf` to an output as a stream and returns `{ bytes }` (the number of bytes written) ([Writing the PDF as a stream](#writing-the-pdf-as-a-stream-typesettopdfstream)) |
| `renderPage(canvas, i, options)` | Draws a page onto a canvas (browser). Returns a `Promise<void>` that resolves when the page is drawn |
| `renderPageToSvg(i, options)` | Turns a page into an SVG string (browser or Node) |
| `renderPageToPng(i, options)` | Turns a page into PNG bytes (browser or Node) |
| `memoryUsage()` | Returns a rough estimate of the memory freed by releasing this result (`{ total, images, fonts, layout }`, in bytes) ([Memory estimate and releasing](#memory-estimate-and-releasing-memoryusage-dispose-releasecaches)) |
| `dispose()` | Releases what this result holds (images, the document's own fonts, caches for drawing, the area tree). Returns a `Promise<void>` that resolves when the release is done. Writing a PDF or drawing afterwards fails with `api/result-disposed` |
| `disposed` | Whether `dispose()` has been called (`boolean`; `true` as soon as it is called) |

Pages are counted from 0.

### PDF (toPdf)

`result.toPdf({ title, pdfx, pdfa, imageMaxDpi, date, encrypt })` (type `PdfOptions`).

| Option | Contents |
| --- | --- |
| `title` | The PDF title |
| `pdfx` | PDF/X marking for print submission (below) |
| `pdfa` | PDF/A marking for long-term archiving (below) |
| `imageMaxDpi` | The upper limit of JPEG resolution |
| `date` | The time written as the PDF creation and modification dates (Info and XMP) and as the modification date of attached files (a `Date`; anything below a second is dropped). Without it, the time the PDF is written. The same version of Kumiori gives the same PDF bytes for the same input, fonts, settings and `date` in the same environment (Node version, browser). Without `deflate`, image streams are compressed with the zlib of the environment (Node's zlib, the browser's `CompressionStream`), so across environments the bytes of PDFs with images can differ (they look the same). To get the same bytes everywhere, pass a fixed function to `deflate` (such as pako's `deflate`). An invalid `Date` or one outside the years 0 to 9999 is a `KumioriOptionError` (`option` is `'date'`). On the command line, the `SOURCE_DATE_EPOCH` environment variable |
| `encrypt` | Encrypts the PDF (AES-256, with passwords and permissions; [below](#encrypting-the-pdf-encrypt)). Not with PDF/X or PDF/A |
| `signal` | A signal to stop writing the PDF (the signal used for typesetting is not inherited; [Stopping and progress](#stopping-and-progress-signal-onprogress)) |
| `onProgress` | Progress of writing the PDF (`phase` is `pdf`) |

Warnings raised while writing the PDF (characters that cannot be drawn, color glyphs that cannot be drawn in color, etc.) are added to `result.warnings`.

The PDF gets page labels (the page numbers a viewer shows) from the page number formats (XSL-FO `format` and `initial-page-number`, CSS `counter(page, <type>)` and `counter-reset: page`): front matter as i, ii and the body from 1, for example. Documents numbered in decimal from 1 throughout get none. Formats that PDF cannot express (kanji numerals, circled numbers and so on) are written page by page with the same characters as on the page.

### PDF/X and PDF/A

**PDF/X** is `pdfx: { version, condition, info, profile, warnings }` (the same as `--pdfx` and `--output-profile` on the command line).

- `version` is `'X-1a'`, `'X-1a:2003'`, `'X-3'` or `'X-4'`. X-3 by default. Any other value (including a difference in case such as `'x4'`, and aliases such as `'X-1a:2001'` and `'X-3:2003'`) is an option error, `KumioriOptionError` (with `option` set to `'pdfx.version'`).
- RGB colors and images are converted to CMYK. X-1a and X-3 flatten transparency.
- X-4 needs a CMYK output device ICC profile in `profile`. X-1a and X-3 need `profile` when `condition` is not in the ICC registry. `profile` must have a header and tag table that follow the ICC.1 format (including the desc description tag), or it is an error (`pdfx/profile-invalid`).
- When `condition` is not given and `profile` is, the profile's description (desc) is used as the printing condition name and no registry (RegistryName) is written in the output intent. Without `profile` either, it is `JC200103` (the registry name of Japan Color 2001 Coated).
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
It returns a `Promise<void>` that resolves when the page is drawn (since 0.8.0; before, `void`). A nonexistent page number fails with a `RangeError`.

- Images (PNG, JPEG, GIF, WebP, BMP) hold no pixels while typesetting (they are decoded once to check that they can be read and their size, and closed at once) and are decoded when drawing.
  `renderPage` takes the page's images from the Typesetter-wide image cache (decoding and adding the missing ones) and draws the page in one go once they are all ready (the canvas never shows a partly drawn page).
  The cache's limit and eviction order are in [Memory estimate and releasing](#memory-estimate-and-releasing-memoryusage-dispose-releasecaches).
- If you call `renderPage` again on the same canvas before the previous call finishes, the drawing is still done in the order of the calls, and the page called last stays on the canvas (images are decoded in parallel, and only the drawing waits for the previous drawing; the same holds for `renderPage` of different results on the same canvas). An example is in [Showing a print preview in the browser](#showing-a-print-preview-in-the-browser).

### SVG (renderPageToSvg)

`result.renderPageToSvg(i, { guides, idPrefix, pageHref })` turns a page into an SVG document (a string). It works in the browser and in Node, with no added dependencies.

- The size is the paper size (pt).
- Glyphs become paths from the font file outlines. There are no `text` elements, so the SVG draws the same glyphs as the PDF even where the fonts are not installed. Each glyph outline is written once in `defs` and placed with `use`.
- Images are embedded as data: URIs. PNG and JPEG as they are; GIF, BMP and WebP are converted to PNG.
- The same image is embedded once per placed size and referenced with `use` where it is placed. When one image is placed in more than 8 sizes, the other sizes reference one embedded copy stretched.
  Because the content is embedded once per size, placing one image in many sizes (the tile sizes of repeated backgrounds count too) makes the SVG up to about 9 times the image's embedded data (base64, about 4/3 of the original file).
- SVG images are turned into shapes first, as for the PDF (text as outlines; filters that cannot be approximated as images computed in pixels; `vector-effect` strokes and sizes as shapes divided by the scale at which the SVG is placed).
  As in the PDF, a child of `switch` is chosen by `svgLanguages` (`--svg-lang`), and the content of `foreignObject` is typeset like the body text and drawn. The same applies to `renderPageToPng`.
- Color glyphs become shapes, gradients and images (a sweep gradient is filled with the average of its stop colors, and compositing such as source-in is approximated by painting on top).
- CMYK and spot colors are converted to RGB with the same formula as on screen.
- Links (links on the pages and links inside SVG images) become SVG `a` elements only when they pass the same rules as the PDF (`links`). The others are not written and are reported in `warnings` (`link/action-dropped`).
  - A link on a page is written as a transparent rectangle over the link area, on top of the page content.
  - A destination within the document becomes `#id` when it is on the same page. A link to another page is written as `<returned URL>#id` only when `pageHref` (a function that takes a page number and returns the URL of that page's SVG) is given (otherwise it is not written). The id of the destination is put on an element of that page's SVG (an unpainted rectangle covering the whole page).
  - ⚠️ When the written SVG is shown with an `img` element (or as a CSS background), browsers do not let its links be followed. They can be followed when the SVG is opened directly or put straight into HTML (as an `<svg>` element).
- Annotations and form fields are not written.

| Option | Contents |
| --- | --- |
| `guides` | Guide lines for the trim box and bleed |
| `idPrefix` | The prefix of the ids inside the SVG. `k` by default |
| `pageHref` | Where links to other pages go: a function that takes a page number (from 0) and returns the URL of that page's SVG (above; written without the link rules). Without it, links to other pages are not written |
| `signal` | A stop signal (the signal used for typesetting is not inherited; [Stopping and progress](#stopping-and-progress-signal-onprogress)) |

An id is the prefix followed by a number and names clip paths, gradients, images and so on.
When putting several SVGs directly into one HTML page, give each page a prefix that is not the start of another page's prefix: end it with a non-digit, such as `p1-`, `p2-` (with `k` and `k1`, `k10` and `k1` + `0` collide).
`idPrefix` must be an XML name: the Name of XML 1.0 §2.3 without `:`. It starts with a letter, `_` or another name-start character such as kana, followed by name characters such as digits, `-` and `.`. Otherwise a `RangeError` is thrown.
For a nonexistent page number, the returned Promise is rejected with a `RangeError`.

### PNG (renderPageToPng)

`result.renderPageToPng(i, { dpi, guides })` turns a page into PNG bytes (a `Uint8Array`; 8-bit RGB on white paper). It works in the browser and in Node, and is rasterized by Kumiori itself with no added dependencies.

- `dpi` is the resolution. 96 by default. Up to 40 million pixels per image, otherwise a `RangeError`.
- `signal` is a stop signal (the signal used for typesetting is not inherited; [Stopping and progress](#stopping-and-progress-signal-onprogress)).
- It draws the same way as `renderPageToSvg` (glyphs from the font outlines, SVG images as the same shapes as in the PDF), with anti-aliasing; images placed smaller are reduced by averaging pixels.
- Images that cannot be decoded to pixels (CMYK JPEG, interlaced PNG) are not drawn and are added to `result.warnings`.
- Decoded images are kept and limited (the rasterizing work and the layer pixels held at once too) as for PNG output of the command ("Limits and memory" in [`docs/en/cli.md`](cli.md)).
- Speed: a text-heavy A4 page at 150dpi takes about 0.5 seconds (Node 22 on a 2026 x86 machine).
- For a nonexistent page number, the returned Promise is rejected with a `RangeError`.

### Memory estimate and releasing (memoryUsage, dispose, releaseCaches)

These APIs help decide, under a memory budget, which result to release when you keep several earlier results so that the same document does not have to be typeset again (for example, when a preview goes back to a document seen before).
The Typesetter's part (`createTypesetter`) plus the parts of the results you hold is roughly the memory in use.

```js
const typesetter = await createTypesetter(setup);
const held = new Map(); // HTML → typeset result (oldest first)
const used = () => typesetter.memoryUsage().total + [...held.values()].reduce((n, r) => n + r.memoryUsage().total, 0);
// Over the budget: release the oldest results (and, if still over, first the image cache for drawing, then the reuse caches too)
while (used() > budget && held.size > 1) {
  const [key, oldest] = held.entries().next().value;
  oldest.dispose(); // while toPdf and so on are running, memoryUsage() keeps its value until they finish
  held.delete(key);
}
if (used() > budget) typesetter.releaseCaches({ images: true });
if (used() > budget) typesetter.releaseCaches();
```

- All of these are rough estimates (in bytes). The parts for the area tree, font tables and reuse caches multiply counts (areas, glyphs, the size of the line-breaking cache and so on) by a size per item, and differ between JavaScript engines. The way of counting and the factors may change before 1.0.
  The size of JS objects differs between engines (V8 pointer compression: Node does not use it, Chromium does), so the factors measured in Node 22 are used in Node (an engine with `process.versions.node`), and those measured in a Chromium 158 Web Worker elsewhere (browsers, Web Workers). Firefox and Safari were not measured; they use the Chromium factors.
- `result.memoryUsage()` (`{ total, images, fonts, layout }`) is what `dispose()` on that result frees.
  What is shared with the Typesetter (the Typesetter's fonts, OS fonts (`systemFonts`), the reuse caches) and what holds the caller's contents as they are (font files and attachments from `files` and `resolveResource`) are not counted.
  - `images`: the contents of image files that Kumiori makes and holds (decoded data: URLs, images fetched from the network, expanded SVGZ, GIF and the like converted to PNG in Node;
    the same contents are held again for a different reference URL), the pixels rasterized for drawing SVG and TIFF on a browser page (width × height × 4 bytes), and in a Web Worker the pixels read in advance for images inside SVG.
    Image contents given through `files` and `resolveResource` are held as they are, without a copy, and are not counted (since 0.8.0; before, they were copied and counted). While you use the result, do not modify
    the contents you passed or transfer them with `postMessage`. Images decoded for drawing (`ImageBitmap` of PNG, JPEG and so on) are counted in the Typesetter's cache (below), not in the result.
  - `fonts`: the parsed tables and glyph caches of the fonts added for the document (CSS `@font-face`, fonts passed with XSL-FO; 500 bytes per glyph in Node, 180 in the browser), and the files held only by this result (such as WOFF and WOFF2 decoded to plain font files).
  - `layout`: the area tree: 340 bytes per area in Node and 200 in the browser, 200 bytes per node of the structure tree (Tagged PDF), and bookmarks and destinations.
- `typesetter.memoryUsage()` (`{ total, fonts, caches, cacheDetail }`): `fonts` is the fonts the Typesetter loaded (the default fonts and `fonts`, fonts for math, monospace and so on, and OS fonts);
  `caches` is the image cache for drawing and the reuse caches (`reuse`). Typeset results are not included. `cacheDetail` breaks `caches` down (its fields add up to `caches`).

  | `cacheDetail` field | Contents |
  | --- | --- |
  | `images` | Images decoded for drawing (`renderPage`) (`ImageBitmap`; width × height × 4 bytes; browsers only, 0 in Node) |
  | `lines` | Line breaking of paragraphs (`reuse`) |
  | `pages` | The pages of the previous document (`reuse`; the page trees and the records of page breaks) |
  | `fontPrep` | Prepared font files (`reuse`; WOFF and WOFF2 decoded to plain font files and so on) |

- `typesetter.releaseCaches(kinds?)` releases caches (not the loaded fonts). Pass `kinds`, an object with the kinds to release set to `true`, to release only those
  (the names are the `cacheDetail` fields; for example, `releaseCaches({ images: true })` releases only the images for drawing, and `releaseCaches({ lines: true, pages: true })` only line breaking and the previous document's pages).
  Without it, everything is released. The next `typeset` has nothing to reuse and takes as long as the first one. After the images are released, `renderPage` decodes them again.
  The typeset result does not change. It may be called while a document is being typeset, and while a page is being drawn (while `renderPage` is being awaited): the images of the page being drawn are not dropped until that page is drawn.
  The caches of line breaking, the previous document's pages and font preparation are used only by typesetting, and do not affect drawing (which reads the area tree of the typeset result).
- **Image cache for drawing** (since 0.8.0): the images that `renderPage` decodes are held in one cache for the whole Typesetter. The key is the image contents, so results that use the same image
  (a document typeset again, chapters with common images and so on) share one decoded image.
  - Set the limit with `createTypesetter({ imageCache: { maxBytes } })` (bytes: the total of width × height × 4 of the decoded images; default 256MB).
  - Over the limit, images no longer used by any live result (one not `dispose()`d) are dropped first, then the rest from the least recently used (LRU), and closed with `close()`.
    Images being drawn are not dropped. When the images of one page exceed the limit, they are held over the limit only while drawing, and dropped down to the limit afterwards.
  - `dispose()` only removes the result from the users of its images, and does not close images shared with other results (drawing a live result never picks up a closed image).
    Images with no users are dropped first when over the limit, and all images are dropped by `releaseCaches({ images: true })`.
  - Choosing the limit: a few times the total width × height × 4 of the images on the pages shown (redrawn) together. For example, a 1600 × 1000 image is 6.4MB, so
    with two per page and a preview that moves back and forth over a few pages, about 64MB; when readers often leaf through the whole book and come back, a part of the whole (256MB holds about 40 of them).
    A lower limit means more time decoding again when returning to a page drawn before (about 10ms for one 1600 × 1000 PNG in a Chromium 158 Web Worker).
  - Results of `typeset`, `typesetHtml` and `typesetFo` without a Typesetter have a cache of their own (with the same default limit), released entirely by that result's `dispose()`.
- `result.dispose()` closes the browser images held only by that result (returning the pixel memory without waiting for GC) and releases the images, the document's fonts, caches for drawing and the area tree (the `sheets`, `structure`, `bookmarks`, `destinations` and `resources` of `areaTree` become empty). The memory is freed even if the result is still referenced somewhere.
  - Calling `toPdf`, `toPdfStream`, `renderPage`, `renderPageToSvg` or `renderPageToPng` afterwards fails with a `KumioriError` (`code` is `api/result-disposed`). Once released, `memoryUsage()` returns 0 for everything. Count fields such as `pageCount` remain.
  - If called while `toPdf` and so on are running, the result is released after all of them finish (they finish with the same output; for example, when the user moves to another document while a PDF is being saved).
    The result still uses that memory meanwhile, so `memoryUsage()` keeps returning the current estimate, and becomes 0 after the release.
  - `dispose()` returns a `Promise<void>` that resolves when the release is done. With nothing running, it releases at once and the promise is already resolved. It resolves once the running calls finish, even if they fail (the promise never rejects).
    Later calls do nothing and return the same promise as the first. After `await result.dispose()`, `memoryUsage()` is 0.
  - `result.disposed` (`boolean`) tells whether `dispose()` has been called. It becomes `true` as soon as it is called, and new calls fail with `api/result-disposed`. Whether the release is done is told by the promise of `dispose()`
    (there is no separate field for "requested" and "done": waiting for the release is easier to write with the promise, and for budget decisions `memoryUsage()` returns the amount before and after the release).
- `result.memoryUsage()` may be called any number of times. The first call on each result counts the areas of the area tree, which takes time (about 25ms for the documents in the table below), and caches that count (the area tree does not change after layout).
  Later calls count the image registry (image file contents, rasterized images, pixels read in advance) and the document's fonts again. These grow when drawing (rasterized images and so on), so they are not cached.
  `cacheDetail.images` of `typesetter.memoryUsage()` is a running total kept by the cache, so nothing is walked for it.
  For a document of 200 pages with 342 images ("HTML like a preview (342 images)" in the table below; 187,000 areas), one call took 30ms in Node 22 and 24ms in a Chromium 158 Web Worker the first time, and 0.07ms in Node and 0.27ms in the Web Worker afterwards
  (the "memoryUsage time" column of `scripts/measure-result-memory.mjs`). Recounting every held result each time one is released over the budget takes a few ms for a few dozen results.
  - The result of the most recently typeset document shares its font tables and part of the logical page tree with the Typesetter's reuse caches. Releasing that result leaves that part until the next document is typeset or `releaseCaches()` is called ("latest result" in the table below).
  - A result that is no longer referenced is released by GC without `dispose()`. Use `dispose()` to release earlier (especially browser images).
- Measured (`scripts/measure-result-memory.mjs`; Typesetter reuse on, `resolveResource` returning the same `ArrayBuffer`; MB):

| Document | Pages | Earlier result (estimate, freed by dispose) | Latest result (freed by dispose) | Reuse caches (estimate, freed by releaseCaches) | Result without reuse (estimate, freed by dispose) |
|---|---|---|---|---|---|
| HTML like a preview (5 images) | 3 | 5.9, 1.7 | 4.3 | 2.9, 9.4 | — |
| same (34 images) | 20 | 15.8, 11.3 | 13.9 | 14.4, 20.6 | — |
| same (342 images) | 200 | 120.8, 113.9 | 116.1 | 136.6, 140.5 | 120.8, 121.0 |
| Conformance document, HTML and CSS | 148 | 152.5, 154.4 | 97.7 | 275.4, 288.7 | 157.2, 158.4 |
| Conformance document, XSL-FO | 100 | 53.3, 54.4 | 58.8 | 126.2, 152.7 | 53.3, 59.4 |
| Text-only HTML | 215 | 77.6, 73.5 | 73.1 | 194.0, 180.2 | 77.6, 76.1 |
| Text-only HTML with a table of contents | 252 | 88.7, 87.2 | 88.1 | 227.0, 197.3 | 88.7, 89.8 |

  In Node 22, the same document was typeset twice (the earlier and the latest result), each was released with `dispose()`, then `releaseCaches()` was called, and the drop of the heap (`heapUsed + arrayBuffers`) was taken at each step.
  "HTML like a preview" has a shared CSS with three TrueType fonts in `@font-face` (0.9MB) and, per page, six paragraphs and about 1.7 images (300×200 PNG).
  In small documents the tables of the document's fonts (4.2MB in this document) stay until the reuse caches are released (the earlier result frees less, and the caches free more).
  Measured the same way inside a Chromium 158 Web Worker (the browser factors; MB). The amount is `usedSize` of `Runtime.getHeapUsage` through the Worker's CDP,
  which does not include external bytes (contents of image files, `ImageBitmap`, font files), so the estimates are given without `images` and prepared fonts (images are as estimated, by content size and width × height × 4, in both engines).

| Document | Pages | Earlier result (estimate, freed by dispose) | Latest result (freed by dispose) | Reuse caches (estimate, freed by releaseCaches) | Result without reuse (estimate, freed by dispose) |
|---|---|---|---|---|---|
| HTML like a preview (34 images) | 20 | 5.1, 3.4 | 4.4 | 7.7, 10.5 | — |
| same (342 images) | 200 | 37.9, 34.2 | 34.9 | 77.2, 80.2 | 37.9, 37.4 |
| Conformance document, HTML and CSS | 148 | 75.8, 70.8 | 53.3 | 136.5, 135.3 | 80.5, 71.2 |
| Conformance document, XSL-FO | 100 | 31.8, 32.3 | 34.4 | 69.7, 89.0 | 31.8, 34.8 |
| Text-only HTML | 215 | 46.0, 42.9 | 42.7 | 110.3, 106.1 | 46.0, 44.3 |
| Text-only HTML with a table of contents | 252 | 53.1, 50.5 | 50.8 | 129.0, 116.3 | — |

## Making only the PDF (typesetToPdf)

`typesetToPdf(text, options, pdfOptions)` makes only the PDF. It gives the same PDF, warnings and page count as calling `toPdf(pdfOptions)` after `typeset`.

- The result is `{ pdf, pageCount, warnings, diagnostics, layoutMs, truncated }` (type `TypesetPdfResult`). There is no `areaTree` or `renderPage`.
- `pdfOptions` has the type `TypesetPdfOptions`: `PdfOptions` of `toPdf` plus `lowMemory`. With `lowMemory: true`, it typesets with less memory (the same as the command's `--low-memory`).
- It turns the pages into the layout result (Area Tree) one at a time, writes each to the PDF and releases it. It never holds the layout result of the whole document, so documents of thousands of pages use less memory.
  In exchange, the layout result of a page is built twice, once to collect the fonts and images used and once to draw it.
- It draws the settled pages into the PDF while typesetting and releases the intermediate layout result of those pages
  (a page is settled when the body and the static content up to that page do not refer to anything not yet typeset, such as forward page-number references in a table of contents or the total page count).
  Images are prepared for the PDF before typesetting (expanding and compressing PNGs and so on) and put into the PDF just before the first page that uses them is drawn (since 0.8.0; before, documents with images or color fonts were not drawn while typesetting).
  Documents with images whose contents depend on the size they are placed at (JPEG shrunk by `imageMaxDpi`, GIF, BMP, WebP and TIFF converted to PNG in the browser, SVG with filters computed as pixels, SVG with `systemLanguage`)
  or with PDF images are drawn after typesetting ends. So are the pages from the first one with characters of bitmap color glyphs (CBDT, sbix and so on), since the glyphs used are not known until typesetting ends.
  Text-heavy documents use less memory while they are typeset (for a 1,600-page text-only document, the peak live heap during typesetting went down from 525MB to 127MB and the RSS peak from 1,054MB to 564MB; `scripts/measure-memory.mjs`, Node 22). The layout result of a page drawn while typesetting is built only once.
  The pages from the first one with a forward reference, and from the first page-sequence with columns, a last-page master or per-page footnote numbers, are drawn after typesetting ends.
  Documents with an index, PDF/X, PDF/A, documents using the operating system's fonts (`systemFonts`), `maxPages`, low-memory typesetting (`lowMemory`), and a Typesetter that has cached the layout of the previous document with `typeset`
  (it reuses pages of the previous document) are not drawn while typesetting. The PDF is the same either way
  (every way of writing puts the fonts and images into the PDF just before the first page that uses them; PDF/X, PDF/A and the documents above whose images are drawn after typesetting put them all in before drawing).
- When making only a PDF, the contents of prepared images are released from the image store (contents passed through `files` and `resolveResource` are held without a copy, so the caller's copy remains).
- `layoutMs` does not include the time to turn the pages into layout results (it is part of writing the PDF). When pages are drawn while typesetting, it includes the time to draw them.
- The Node command also makes PDFs with it. The container from `createTypesetter()` also has `typesetter.typesetToPdf(text, options, pdfOptions)`.

## Writing the PDF as a stream (typesetToPdfStream)

`typesetToPdfStream(text, options, output, pdfOptions)` typesets the same way as `typesetToPdf` and writes the PDF page by page to the output `output`.
It never holds the whole PDF in one `Uint8Array`, so documents with many images use less memory while the PDF is written.

- The output (type `PdfOutput`) is a `WritableStream` or a function that takes chunks of bytes (`Uint8Array`). If the function returns a `Promise`, it is awaited before the next chunk is passed;
  if it returns nothing, it is not awaited. A chunk is not changed after it is passed.
- The result is `{ bytes, pageCount, warnings, diagnostics, layoutMs, truncated }` (type `TypesetPdfStreamResult`; instead of `pdf` in the result of `typesetToPdf`, it has `bytes`, the number of bytes written).
- From a typeset result, `result.toPdfStream(output, pdfOptions)` writes the same way, and from a container, `typesetter.typesetToPdfStream(text, options, output, pdfOptions)`.
  `toPdfStream` keeps the typeset result, so only the memory on the PDF side goes down.
- Streams that are finished (images, page contents, drawings such as SVG) are written to the output where they are embedded or where a page has been drawn. Fonts (a subset is made after seeing the characters of every page), annotations, form fields, bookmarks, the structure tree and so on are written at the end.
  Up to 64KB is gathered before it is passed to the output.
- The PDF is the same as from `typesetToPdf`; usually not a single byte differs. In a tagged PDF with text inside a box with opacity, for example
  (a document where a Form XObject holding marked content has its dictionary completed later), that Form is written at the end of the file, so only the order of objects and the offsets differ (each numbered object has the same contents).
- A `WritableStream` is handled as `ReadableStream.pipeTo` does by default: before each write it waits for the writer's `ready` (with a slow output, it waits between pages); when done it calls `close()`;
  when ending on an error or the stop signal it calls `abort(reason)`; in every case it releases the writer's lock at the end. It also calls `abort(reason)` on errors before anything is written (option errors, PDF/X and PDF/A, a signal stopped beforehand, errors loading fonts).
  A `WritableStream` locked by another writer, and an output that is neither a `WritableStream` nor a function, are a `KumioriOptionError` (`option` is `output`), and the output is not touched.
- When stopped by the signal (`options.signal`) or when typesetting fails, the returned `Promise` rejects with that reason. The output keeps the bytes written so far, which are not a readable PDF, so discard them.
  When the output itself fails (the function throws, its `Promise` rejects, or a write to the `WritableStream` fails), typesetting and writing stop and that error is thrown unwrapped (`abort` is not called).
- PDF/X and PDF/A (`pdfOptions.pdfx`, `pdfa`) cannot be written as a stream, because the whole written PDF is read back and checked, and no PDF is returned if it does not conform. Giving them throws `KumioriOptionError` before anything is written
  (`option` is `pdf.pdfx` or `pdf.pdfa`; for `toPdfStream`, `pdfx` or `pdfa`). Use `typesetToPdf` or `toPdf`. PDF/UA-1 and tagged PDF can be written as a stream.
- It can be combined with `lowMemory`. Low-memory typesetting cannot wait between pages in some places, so with an output that returns a `Promise` or a `WritableStream`, chunks are gathered until it can wait.
  With `lowMemory`, a function that returns nothing (such as Node's `fs.writeSync`) is recommended.
- Streaming lowers the memory on the PDF side. Measured values (`scripts/measure-memory.mjs`, Node 22): for a document with many images (200 PNGs that do not compress, a 196MB PDF), the peak of external bytes (`arrayBuffers`) while the PDF is written went down from 660MB to 266MB,
  and the RSS peak from 1,176MB to 961MB. Since 0.8.0 the image store does not copy the images it is given, so the peak where the images are read before typesetting (about 780MB, including 533MB that the measuring side holds from the start) went down to 574MB and the RSS peak to 744MB.
  The peak of text-heavy documents is in the intermediate layout result; as with `typesetToPdf`, drawing the settled pages while typesetting and releasing them lowers it (for a 1,600-page text-only document, the peak live heap during typesetting went down from 525MB to 127MB and the RSS peak from 1,054MB to 564MB; `scripts/measure-memory.mjs`, Node 22).

Writing to a file in Node:

```ts
import fs from 'node:fs';
import { Writable } from 'node:stream';
import { typesetToPdfStream } from 'kumiori';

// Pass it as a WritableStream (a Node Writable is not taken directly)
await typesetToPdfStream(html, { name: 'book.html' }, Writable.toWeb(fs.createWriteStream('book.pdf')));

// Pass a function that writes synchronously
const fd = fs.openSync('book.pdf', 'w');
try {
  await typesetToPdfStream(html, { name: 'book.html' }, (chunk) => {
    // writeSync returns the number of bytes written (for a regular file, normally all of them)
    for (let at = 0; at < chunk.length; ) at += fs.writeSync(fd, chunk, at);
  });
} finally {
  fs.closeSync(fd);
}
```

In the browser, the writer of a save dialog (`await (await showSaveFilePicker()).createWritable()`) is a `WritableStream`, so it can be passed as it is.
When you want a `ReadableStream`, put a `TransformStream` in between. A typesetting error shows up on the reading side as an error (abort) of `readable`, but the returned `Promise` also rejects, so attach a handler
(without one, Node stops on an unhandled rejection, `unhandledRejection`).

```ts
const { readable, writable } = new TransformStream();
typesetToPdfStream(html, {}, writable).catch((e) => console.error(e)); // the error also shows up on readable
return new Response(readable);
```

## Encrypting the PDF (encrypt)

Passing `encrypt` in the PDF options (`PdfOptions` of `toPdf`, `toPdfStream`, `typesetToPdf` and `typesetToPdfStream`) encrypts the PDF with AES-256
(revision 6 of the standard security handler, ISO 32000-2 §7.6; the PDF keeps the 1.7 header and the catalog gets the Adobe extension marker (ExtensionLevel 8)).
Node uses `crypto`; browsers and workers use WebCrypto (for the hashes that make the key) and a built-in AES (both give the same result). It also works for stream output.
The shape may change before 1.0.

```ts
const { pdf } = await typesetToPdf(html, { loadFont }, {
  encrypt: { userPassword: 'password to open', ownerPassword: 'password to remove the restrictions', permissions: { print: false, copy: false } },
});
```

`encrypt` (type `PdfEncryptOptions`):

| Field | Contents |
| --- | --- |
| `userPassword` | The password to open the PDF (user password). Without it, the password is empty: the PDF opens without a password and only the `permissions` restrictions apply |
| `ownerPassword` | The password to open it without the restrictions (owner password). Without it, a random password: nobody can remove the restrictions. If it is the same as `userPassword`, anyone who opens the PDF can remove them. An empty one (also one made only of characters that SASLprep maps to nothing) is an error (anyone could open the PDF without a password) |
| `permissions` | What is allowed (type `PdfPermissions`; the table below; permissions not written are allowed) |

The password used is the first 127 bytes of its UTF-8 after SASLprep (RFC 4013) normalization (ISO 32000-2 §7.6.4.3.2; full-width letters and digits become half-width). Control characters, private-use characters and the like cannot be used and give a `KumioriOptionError` (`option` is `encrypt.userPassword` and so on).

`permissions` (Table 22 of ISO 32000-2 §7.6.4.2; all booleans, default `true`):

| Field | What is allowed |
| --- | --- |
| `print` | Printing (bit 3) |
| `modify` | Changing the contents (bit 4; other than annotations, forms and assembly) |
| `copy` | Copying and extracting text and graphics (bit 5) |
| `annotate` | Adding and changing annotations, and filling in forms (bit 6) |
| `fillForms` | Filling in forms (bit 9; allows filling in even when `annotate` is `false`) |
| `accessibility` | Extracting for assistive technology such as screen readers (bit 10). It cannot be removed with PDF/UA (`pdfua`): `false` gives the warning `pdfua/encrypt-accessibility-kept` and keeps it allowed. ISO 32000-2 deprecates this bit and readers ignore it, so `false` has no effect in some software |
| `assemble` | Assembling the document (bit 11; inserting, rotating and deleting pages, creating bookmarks) |
| `printHighQuality` | High-quality printing (bit 12; `false` allows only low-quality printing) |

- It cannot be combined with PDF/X (`pdfx`) or PDF/A (`pdfa`) (neither standard allows encryption). Passing them together throws a `KumioriPdfError` (`code` is `pdf/encrypt-incompatible`) before typesetting.
- An encrypted PDF has different bytes every time, even for the same input and the same `date`, because the initialization vectors and salts are random. The document ID is random too (unencrypted PDFs still get it from the contents).
- Whether the permissions are honored depends on the software that reads the PDF (some do not). To hide the contents, set `userPassword`.
- On the command line: `--encrypt`, `--user-password`, `--owner-password` and `--deny` ([`docs/en/cli.md`](cli.md)).

## Measuring text without a document (measureText, breakLines)

`measureText(text, style)` and `breakLines(text, style, width)` of the `Typesetter` from `createTypesetter` measure the length of a string, how it breaks into lines and the number of lines, without making a document
(for example, to know beforehand whether a name or a heading fits in a box in a template or an editor). They use the fonts the Typesetter loaded (the default fonts, `fonts`, `systemFonts`).
The shape may change before 1.0.

```ts
const t = await createTypesetter({ loadFont });
const one = await t.measureText('A typeset heading', { fontSize: 18, fontWeight: 700, fontFamily: 'sans-serif' });
one.inlineSize; // the length set on one line (pt)
const lines = await t.breakLines(text, { fontSize: 10.5, lang: 'ja' }, 120);
lines.lineCount; // the number of lines at a width of 120pt
lines.blockSize; // the total height (pt)
lines.lines.map((l) => l.text); // the characters of each line
```

- Internally, the string is made into a document with a single block (an HTML `div`), typeset with the same Typesetter, and the lines are read. So line breaking (line-breaking rules, hanging punctuation, hyphenation, spacing adjustment), font selection and kerning are the same as when the same string with the same style is set in a document in a block whose content width is `width`. Each call costs about as much as typesetting a small document (a few to a dozen or so milliseconds).
- Measuring does not change the reuse caches of the Typesetter (`reuse`: the pages of the previous document, line breaks, font preparation).
- `measureText` does not break lines (with `whiteSpace` `pre`, `pre-wrap`, `break-spaces` or `pre-line`, it breaks only at line feeds). `breakLines` breaks at the line length `width` (pt; greater than 0 and at most 14400).
- Properties not given are the same as the body text of Kumiori's default HTML style (10pt, `line-height: 1.75`, serif, `text-align: justify`, `hanging-punctuation: allow-end`). No paragraph indent is added (add one with `textIndent`).

`style` (type `TextStyle`; names are CSS properties in camelCase; values are CSS value strings, lengths can also be numbers, in pt):

| Field | Contents |
| --- | --- |
| `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontStretch`, `fontKerning`, `fontFeatureSettings`, `fontVariantEastAsian` | The font. A number for `fontSize` is in pt; a number for `fontWeight` is a CSS weight (400, 700 and so on) |
| `letterSpacing`, `wordSpacing` | Letter and word spacing (numbers are pt) |
| `lineHeight` | The line height. A number is a factor, as in CSS (multiplied by the font size); a length such as `'14pt'` also works |
| `lang` | The language tag (`ja`, `en` and so on). It affects line-breaking rules, hyphenation and glyph selection |
| `writingMode`, `textOrientation`, `direction` | The writing direction. In vertical writing (`vertical-rl`, `vertical-lr`), the line length is vertical |
| `textAlign`, `textAlignLast`, `textJustify`, `textIndent` | Alignment and indent (a number for `textIndent` is pt) |
| `whiteSpace`, `wordBreak`, `lineBreak`, `overflowWrap`, `hyphens`, `hangingPunctuation`, `textSpacingTrim`, `textAutospace` | White space, line breaking and punctuation |

Other names, characters that would leave the CSS declaration (`;`, `{`, `}`, `<`, `>`, `\`), comments and `url()` give a `KumioriOptionError` (`option` is `style.<name>`).

The result (type `MeasuredText`):

| Field | Contents |
| --- | --- |
| `lineCount` | The number of lines |
| `inlineSize` | The `inlineSize` of the longest line (pt) |
| `blockSize` | The sum of the `blockSize` of the lines (pt; the total height, or the total width in vertical writing) |
| `width`, `height` | The width and height on the page (pt; `inlineSize` and `blockSize` in horizontal writing, `blockSize` and `inlineSize` in vertical writing) |
| `overflow` | With `breakLines`, whether a line is longer than `width` (a long word that cannot be broken, hanging punctuation and so on). Always `false` with `measureText` |
| `lines` | The lines in order (type `MeasuredLine`; below) |

A line (type `MeasuredLine`):

| Field | Contents |
| --- | --- |
| `text` | The characters of the line (in the order set; including a hyphen where a word is broken at the end of the line, and excluding white space removed at the start and end of the line) |
| `inlineSize` | The length of the contents of the line in the line direction (pt; from the start of the first character to the end of the last, including letter spacing, kerning and hanging punctuation). A justified line other than the last fills `width` |
| `blockSize` | The height of the line (pt; set by `line-height`; the width of the line in vertical writing) |

## Stopping and progress (signal, onProgress)

Pass `signal` (an `AbortSignal`) to stop typesetting part way, and `onProgress` to receive progress.
Use them, for example, to stop the previous layout each time the user types in an editor preview, or to limit the time a server spends on one document.
Without them, Kumiori behaves as before, at the same speed.

```ts
let current: AbortController | undefined;
async function preview(html: string) {
  current?.abort();                                   // stop the previous layout
  const ac = (current = new AbortController());
  try {
    const r = await typesetter.typeset(html, { name: 'a.html', signal: ac.signal, onProgress: (p) => showProgress(p) });
    draw(r);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e; // stopping is not an error
  }
}
```

- When stopped, the returned Promise rejects with `signal.reason`. If `abort()` was called without a reason, that is a `DOMException` named `AbortError`
  (as with `fetch`; with `AbortSignal.timeout(ms)` it is a `TimeoutError`). It is not wrapped in Kumiori's error types (`KumioriError`).
- An already aborted signal fails before anything is read. The signal is checked each time a font or resource is read and each time a page is laid out, and fetches in flight (`fetch`) are stopped.
  `resolveResource` and `loadFont` receive `{ signal }` as a second argument (the call's signal combined with the `fetchTimeoutMs` timeout), so you can pass it to your own fetches.
  The fonts that a container (`createTypesetter`) first loads when a document needs them (math, monospace, symbols and emoji) are awaited by the other calls typesetting with the same container at the same time, so `loadFont` gets a signal with the timeout only,
  and a stopped call just stops waiting for the load (the load goes on, and the other calls typeset with the font).
- Typesetting is long synchronous work, so when `signal` or `onProgress` is passed, Kumiori pauses (yields a task) at phase boundaries (reading resources, layout passes, page-sequences, PDF pages)
  so that other work (repainting, calling `abort()`) can run.
  It does not pause while laying out one page-sequence (for HTML, the whole document unless named pages split it), so an outside `abort()` takes effect when that layout ends
  (a few seconds for a 151-page HTML document). To stop sooner, call `abort()` inside `onProgress` (the callback is called synchronously for each page, so it stops there),
  or typeset in a [Web Worker](#typesetting-in-a-web-worker) and stop the whole Worker (`worker.terminate()`).

  ```ts
  const deadline = Date.now() + 10_000;               // stop after 10 seconds (checked on each page)
  const ac = new AbortController();
  await typeset(html, { signal: ac.signal, onProgress: () => Date.now() > deadline && ac.abort() });
  ```

- The container (`createTypesetter`) stays usable after a stop. A stopped document does not count as a generation for what the container remembers across documents (the line breaking of paragraphs and so on),
  so what was remembered from the document finished before the stop is still used for the next document.
- The result's `toPdf`, `renderPageToSvg` and `renderPageToPng` do not inherit the signal used for typesetting. Pass `signal` (and, for `toPdf`, `onProgress`) in their own options.
  For `typesetToPdf`, the `signal` and `onProgress` of the typesetting options (`options`) apply through writing the PDF (they cannot be given in the PDF options, the third argument; doing so throws `KumioriOptionError` with `option` set to `pdf.signal` or `pdf.onProgress`). `setup.signal` and `setup.onProgress` of `createTypesetter` apply only while the container is created.

`onProgress` receives values of the following shape synchronously (type `TypesetProgress`). An error it throws stops typesetting and becomes the rejection of the returned Promise. Once stopped (by the stop signal or a thrown error), `onProgress` is not called again, even if resources that were being loaded in parallel finish later.

| `phase` | When | Other fields |
| --- | --- | --- |
| `fonts` | Each time a font is read (when creating a container, and at the start of `typeset` and `typesetToPdf`) | `loaded` (fonts read), `total` |
| `resources` | Each time a document resource is read (an answer of `resolveResource`, an XSL-FO font file, an image file, etc.) | `loaded` |
| `import` | Once, when reading the document and the cascade starts | |
| `layout` | Each time a page is created | `pass` (layout pass, from 1), `pages` (pages created in that pass; it can go down when a page-sequence is laid out again for conditional page masters or column balancing; the last value of the last pass is the page count) |
| `pdf` | Each time a PDF page is written | `pages` (pages written), `total` (total pages) |

The phases come in the order of this table (unused phases are skipped).

## Laying out only the first pages (maxPages)

With `maxPages: N`, layout stops once the first N pages are laid out. Use it to preview the first few pages of a long document.

```js
const r = await typesetter.typeset(html, { name: 'book.html', maxPages: 3 });
r.pageCount; // 3 (or the page count, if the document has 3 pages or fewer)
r.truncated; // true if layout stopped early
```

- When it stops, the result's `truncated` is `true`, the layout result (`areaTree`) gets `truncated: { maxPages: N }`, and the info diagnostic `layout/max-pages-reached` is reported.
  If the document has N pages or fewer, it does not stop, and the result is the same as without `maxPages` (`truncated` is `false`). The same goes for `typesetToPdf` (with `lowMemory` too) and for `typeset` and `typesetToPdf` of a container.
- Nothing after page N is known, so the following cannot be resolved. One `layout/beyond-max-pages` warning is reported for each kind.
  - Page number references to places after page N (`page-number-citation` in XSL-FO, `target-counter()` in CSS and so on), and the last page number of elements that continue after page N
    (`page-number-citation-last`): they are set as `"?"` (empty with `--style weasyprint`; the same text as for a missing id).
  - The total page count (CSS `counter(pages)`, the total in running heads): set as `"?"`.
  - Index lists: only the places within the first N pages are listed.
  - Bookmarks: bookmarks pointing after page N have no destination (their titles stay). Links within the document that point there are not written, as for a missing destination.
  - An id that is not in the document is still `layout/missing-id`.
- The layout (line breaks and page breaks) of the kept pages 1 to N is the same as pages 1 to N of the whole document, as long as their body text has nothing pointing after page N
  (page number references, last page numbers, the total page count in the body text, index lists). Page N is settled before the next page is created and does not change afterwards (page N + 1 is laid out too, to tell which elements continue).
  - References only in running heads (XSL-FO static-content, the page-margin boxes of CSS) just become `"?"`; the body layout is the same.
  - If the body text has references pointing after page N, they become `"?"`, and the difference in width from the real number can change how that line breaks, moving the following lines and page breaks
    (a table of contents with the number after a leader rarely changes, since the leader absorbs the difference; "see page …" in running text or a table of contents without leaders can change).
- What gets faster is laying out and writing the PDF. Reading the document and the cascade (turning HTML or XSL-FO into the layout tree) are done for the whole document.
  Every layout pass that resolves page number references stops at page N.
- With a container (`createTypesetter`), a stopped document keeps what it remembered (such as paragraph line breaks) but does not advance the generation of the memory
  (the count that keeps what the previous document used). Previewing many times does not throw away what was remembered from the last full layout.
- `maxPages` is not a limit (`limits`). Going over it is not an error; the result up to that page is returned. To refuse documents longer than a given page count, check `truncated`.

## Files and external resources

### resolveResource

`resolveResource(url)` is asked for each file the document or the CSS references (`<link rel="stylesheet">`, `@import`, `url()`, `<img src>`, etc.) that is not in `files`.

- `url` is the reference as written (`file:///…/a.css`, `img/a.png`, `https://…`). Relative references inside a CSS file are resolved against that CSS file's URL.
- If it returns content (a string, `Uint8Array` or `ArrayBuffer`), that is used. If it returns `undefined`, things work as before (`http(s):` images and stylesheets are fetched from the network).
- There is no need to rewrite the references and put the files into `files`.
- An image is recognized from the leading bytes of the returned content, even when its URL has no extension (such as `https://example.com/img?id=1`).
- It receives `{ signal }` as a second argument (the call's stop signal combined with the `fetchTimeoutMs` timeout). Pass it to your own fetch so that it stops when typesetting is stopped ([Stopping and progress](#stopping-and-progress-signal-onprogress)).

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

## Input limits (limits)

To keep a small input from using up time and memory, Kumiori puts limits on the number of image pixels, file sizes, nesting depths, typesetting work and so on.
The `limits` option changes these limits (on the command line, `--limit <name>=<value>`; "Limits and memory" in [`docs/en/cli.md`](cli.md)).

```ts
const r = await typeset(html, { limits: { imagePixels: 200_000_000, fileBytes: 1024 ** 3 } }); // a large, trusted document
const s = await typeset(html, { limits: { nestingDepth: 64, pngPixels: 4_000_000 } });      // tighter limits on a server
```

- Names you do not pass keep their defaults. If you pass nothing, Kumiori behaves as before and the typesetting results are the same.
- Values are integers of 1 or more. Time and size limits can be raised or lowered; nesting-depth limits ("lower only" in the table) can only be lowered.
  Nesting-depth limits keep deep nesting from using up the stack and making the whole document fail, so they cannot be raised.
- An unknown name, a value that is not an integer of 1 or more, a lower-only limit set above its default, or a value above the ceiling in the table (the size the implementation can handle, such as V8's string length)
  is rejected without typesetting, with a `KumioriOptionError` (`option` is `limits.<name>`).
- The default 300 of `nestingDepth` is the value of the largest kind (MathML, nested transforms). **The actual defaults are per kind**: 128 for HTML, 250 for XSL-FO and SVG,
  and 256 for the XML of draw.io diagrams (HTML cannot be nested 300 levels deep). A given value is combined with each default by taking the smaller, so lowering it affects every kind.
  `cssNesting` works the same way: its default 64 is the value of the largest kind (nested rules, `@supports`, `calc()`); `@layer` names, math functions, selectors and `calc()` in SVG use 32.
- Raising a limit does not change the limits by file size (the code density of each format, decompression ratios). Only a correspondingly large file can use a raised limit
  (raising `imagePixels` does not let a GIF of a few dozen bytes make a 100-megapixel image).
- When a limit is raised, one notice (severity info) with the code `limit/raised` is reported (`args.limits` lists the raised names and values).
- `setup.limits` of `createTypesetter(setup)` applies to loading the fonts of the typesetter and becomes the default for each document. The per-document `limits` of `Typesetter.typeset` is layered on the typesetter's `limits`, name by name.
  The typesetter does not reuse what it kept from the previous document (font preparation, line breaking) for a document with different limits.
- `toPdf`, `renderPage`, `renderPageToSvg` and `renderPageToPng` of a result use the `limits` it was typeset with (they do not take limits as arguments).
- The `load` context of a plugin (`ImageFormatContext`) gets the limits, filled with the defaults, in `limits` (read only). Kumiori also checks the result size, SVG length and time limit with the `format*` limits.
- Calls running at the same time (`typeset` calls not awaited one by one) do not mix their limits (limits are kept in the per-call context).
- ⚠️ Raising a limit lets one document use correspondingly more time and memory (doubling `imagePixels` makes the RGBA of one image 800MB and typesetting about twice as slow).
  The defaults were chosen so that documents written by others can be typeset within Node's default heap (about 4GB at most) without crashing. When you raise limits, set the heap (`node --max-old-space-size=…`), the container memory and a time limit from outside to match.
  Using a lot of time or memory within raised limits is not treated as a vulnerability ([`SECURITY.en.md`](../SECURITY.en.md)).

The limits (also printed by `kumiori --list-limits`). A default shown as "(see text)" is derived from other values.

| Name | Default | Raise/lower | What it limits |
| --- | --- | --- | --- |
| `imagePixels` | 100,000,000 | raise or lower | pixels in one image (also the total of EPS images, and the images kept when writing PNG) |
| `fileBytes` | 256MB | raise or lower | size of one given file or one fetched image (bytes; also the size of one EPUB entry when the browser app reads an EPUB, with the default value there) |
| `cssBytes` | 16MB | raise or lower | size of one fetched CSS file (bytes) |
| `fontBytes` | 128MB | raise or lower | size of one fetched font, or of a decoded WOFF font (bytes) |
| `fontCollectionBytes` | 1GB | raise or lower | total size of the fonts taken out of a font collection (TTC/OTC) (bytes) |
| `systemFontFaces` | 16 | raise or lower | OS fonts used in one document (systemFonts) |
| `imageFetchTotalMs` | (see text) | raise or lower | time limit for fetching all images of a document (ms; default: 10 times fetchTimeoutMs) |
| `redirects` | 20 | lower only | redirects to follow |
| `styleRefs` | 500 | raise or lower | CSS and font references to collect |
| `importDepth` | 8 | lower only | levels of @import in fetched CSS |
| `importedCssChars` | 8,388,608 | raise or lower | total length of CSS expanded by @import (characters) |
| `cssImports` | 10,000 | raise or lower | number of @import rules |
| `formatSize` | 10,000,000 | raise or lower | width and height of an image-format (plugin, draw.io) result (px; also the size and coordinates of draw.io diagrams) |
| `formatSvgChars` | 134,217,728 | raise or lower | absolute limit on the length of the SVG from an image format (characters; the limit by file size is unchanged) |
| `formatLoadMs` | 60,000 | raise or lower | time limit for loading with an image format (ms; three times fetchTimeoutMs is added) |
| `formatFragments` | 64 | raise or lower | references to one file with different fragments (#) |
| `pdfImageObjects` | 1,000,000 | raise or lower | indirect objects in one PDF image |
| `pdfImagePages` | 100,000 | raise or lower | pages in one PDF image (pages visited in its page tree) |
| `pdfImageDepth` | 64 | lower only | depth of the page tree and of nested resources in a PDF image |
| `pdfImageStreamBytes` | 256MB | raise or lower | total decompressed size of the streams of one page of a PDF image (for a page range, of the whole range) (bytes) |
| `pdfImageLoadMs` | 60,000 | raise or lower | time limit for loading one PDF image (ms; for embedding a page range, for the whole range) |
| `pdfImageRangePages` | 64 | raise or lower | pages placed side by side for a page range of a PDF image (`page=2-5`, `all` and so on, in compatibility mode) |
| `epsMs` | 20,000 | raise or lower | time limit for running one EPS (ms) |
| `epsDocumentMs` | 60,000 | raise or lower | total time for running the EPS files of one document (ms) |
| `epsMemoryBytes` | 512MB | raise or lower | total memory and VM of one EPS (bytes) |
| `epsPathPoints` | 5,000,000 | raise or lower | path points in one EPS |
| `epsImagePixels` | 64,000,000 | raise or lower | pixels in one EPS image |
| `epsSvgChars` | 134,217,728 | raise or lower | absolute limit on the length of the SVG made from EPS, metafiles and CGM (characters) |
| `metafileImagePixels` | 64,000,000 | raise or lower | absolute limit on the total pixels of the images in a WMF/EMF/CGM file (the limit by file size is unchanged) |
| `metafileClipWork` | 50,000,000 | raise or lower | work for clipping operations in WMF/EMF (path clipping points scale by the same ratio) |
| `epubTotalBytes` | 1GB | raise or lower | total uncompressed size of one EPUB (bytes) (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so `limits` and `--limit` have no effect on it) |
| `epubEntries` | 65,535 | lower only | entries in an EPUB (zip entries, chapters in the spine) (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so `limits` and `--limit` have no effect on it) |
| `epubTextChars` | 134,217,728 | raise or lower | total characters of the chapters and stylesheets of an EPUB (used only when the browser app reads an EPUB, with the default value there; the API and the command line do not read EPUB, so `limits` and `--limit` have no effect on it) |
| `nestingDepth` | 300 | lower only | element nesting depth. The default 300 is the value of the largest kind; the actual defaults are per kind (HTML 128, XSL-FO 250, SVG 250, MathML 300, transforms 300, draw.io 256). A given value is combined with each default by taking the smaller, so lowering it affects every kind (HTML cannot be nested 300 levels deep) |
| `cssNesting` | 64 | lower only | CSS nesting depth. The default 64 is the value of the largest kind; the actual defaults are per kind (nested rules, @supports and calc() 64; @layer names, math functions, selectors and calc() in SVG 32). A given value is combined with each default by taking the smaller, so lowering it affects every kind |
| `entityDepth` | 8 | lower only | nesting depth of XML internal entities |
| `entityChars` | 134,217,728 | raise or lower | characters added by expanding XML internal entities |
| `nestedSelectors` | 10,000 | raise or lower | selectors made by expanding nested CSS rules |
| `selectorWork` | 30,000,000 | raise or lower | work for memoized selector matching |
| `diagnosticsPerCode` | 200 | raise or lower | diagnostics with the same code (the rest are summarized as "n more") |
| `tableColumns` | 1,000 | raise or lower | table columns (also col span and colspan) |
| `tableSpannedCells` | 20,000 | raise or lower | spanned slots in a table structure |
| `leaderRepeats` | 20,000 | raise or lower | characters repeated in one leader |
| `mathGlyphs` | 20,000 | raise or lower | glyphs in one formula |
| `gridTracks` | 10,000 | raise or lower | grid tracks after expanding repeat() |
| `svgElements` | 500,000 | raise or lower | SVG elements expanded by use |
| `svgPathSegments` | 5,000,000 | raise or lower | absolute limit on expanded SVG path segments (the limit by file size is unchanged) |
| `svgCssMatches` | 500,000 | raise or lower | CSS matches inside an SVG |
| `svgFilterWork` | 400,000,000 | raise or lower | work for computing SVG filters in pixels (one SVG) |
| `svgLinksPerPage` | 5,000 | raise or lower | link annotations from SVG a elements on one page |
| `pngPixels` | 40,000,000 | raise or lower | pixels in one PNG page |
| `pngImageCachePixels` | (see text) | raise or lower | total pixels of the images kept when writing PNG (default: same as imagePixels) |
| `pngPageImagePixels` | 400,000,000 | raise or lower | total image pixels decoded for one PNG page |
| `pngRasterWork` | 128 | raise or lower | work for rasterizing one PNG page (per pixel; the base 64 million scales by the same ratio) |
| `pngLayerPixels` | 64,000,000 | raise or lower | absolute limit on the pixels of layers held at once while drawing PNG (growing layers are counted by the size they grow to) |
| `canvasSvgPixels` | 16,000,000 | raise or lower | pixels when rasterizing an SVG image for renderPage |
| `canvasSvgWork` | 8,000,000,000 | raise or lower | work for rasterizing one SVG image for renderPage (four times this per drawing) |
| `flattenPixels` | 36,000,000 | raise or lower | pixels of one image when flattening transparency for PDF/X |
| `drawioChars` | 67,108,864 | raise or lower | decompressed size of a compressed draw.io diagram (bytes) |
| `drawioCells` | 20,000 | raise or lower | cells in a draw.io diagram (XML elements: 10 times this) |
| `drawioLabelChars` | 2,000,000 | raise or lower | total label characters in one draw.io diagram |
| `drawioSvgChars` | 16,777,216 | raise or lower | length of the SVG made from a draw.io diagram (characters; up to twice this is written in total) |
| `drawioImages` | 200 | raise or lower | images fetched for one draw.io diagram (bundle images and URL images, each) |

## Errors and diagnostics

### Thrown errors

| Case | Result |
| --- | --- |
| The FO's XML cannot be parsed | `typeset` throws (`XML の解析に失敗しました: …`, "failed to parse XML: …") |
| The default fonts cannot be read | `typeset` throws (`書体を読めません: …`, "cannot read font: …") |
| A font file passed in `fonts` is corrupt | Not thrown; goes into `warnings` |
| A nonexistent page number for `renderPage` | `RangeError` (`renderPageToSvg` and `renderPageToPng` return a Promise rejected with a `RangeError`) |
| Typesetting warnings (unreadable images, overflow, etc.) | Not thrown; go into `result.warnings` |
| Stopped with `signal` | The returned Promise rejects with `signal.reason` (an `AbortError` `DOMException` by default; [Stopping and progress](#stopping-and-progress-signal-onprogress)) |

Errors thrown by Kumiori are `KumioriError` and its subclasses (`KumioriInputError`, `KumioriLimitError`, `KumioriFontError`, `KumioriPdfError`), which carry a code `code`, or `KumioriOptionError` for invalid options.
`KumioriOptionError` extends `TypeError` as before and carries the name of the option in `option`.
`isKumioriError(e)` tells them apart. The codes are listed in [`docs/en/diagnostics.md`](diagnostics.md), and the arrays of diagnostic codes and error codes (`DIAGNOSTIC_CODES`, `ERROR_CODES`) are exported too.

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

## PDF images

You can place a page of a PDF as an image with `<img src="a.pdf">`, `fo:external-graphic src="url(a.pdf)"`, CSS `background-image` and so on. PDF is recognized by its content (the `%PDF-` header).

- **PDF output**: the page is embedded as a Form XObject and stays vector (the same page is embedded once). Only the page content and its resources (fonts, images and so on) are carried over; annotations, links, bookmarks and the structure tree are not (`image/pdf-dropped` if there are annotations; the MCIDs of marked content in the page content and in Form XObjects and the like in the resources, and the `StructParents` of XObjects, are also removed). Fonts that the source PDF does not embed are reported with `image/pdf-font`.
- **Screen, SVG and PNG**: Kumiori has no renderer for PDF, so a placeholder frame of the right size is drawn and `image/pdf-placeholder` is reported (the pages and positions are the same as in PDF output).
- **Page**: `a.pdf#page=2` (`page=` of RFC 8118). Without it, the first page is used.
- **Size**: the CropBox of the page (or the MediaBox if there is none). `/Rotate` (rotation in steps of 90 degrees) and `UserUnit` are applied.
- **Compatibility mode** (`compat: 'antenna'`, `style: 'ah'`; `--compat antenna`, `--style ah` on the command line) reads these Antenna House extensions; other modes do not.
  - Page ranges (`#page=2-3`, `#page=2-`, `#page=all`): the pages of the range are placed side by side in one row without gaps (bottoms aligned), as one image (the same arrangement as in Antenna House's samples; the pages are not flowed). Size properties (such as `content-height`) apply to the whole row. For a range given to a background image (`background-image`), only the first page of the range is used (as in the samples). Pages are placed from the start of the range up to the limit `pdfImageRangePages` (default 64); the rest are not placed, and `image/pdf-page-range` and `limit/reached` are reported. The decompressed size (`pdfImageStreamBytes`) and time (`pdfImageLoadMs`) for the pages of a range are shared by the whole range, and pages sharing the same content streams and resources become one Form XObject.
  - The box to use (`#bbox=MediaBox|CropBox|BleedBox|TrimBox|ArtBox`).
  - `page=` in a data: URI (`data:application/pdf;page=3;base64,…`).
- **Unreadable PDF**: broken PDFs are reported with `image/pdf-invalid` and encrypted PDFs with `image/pdf-encrypted`, and a placeholder frame is drawn.
- **PDF/X, PDF/A and PDF/UA-1**: each page is checked before it is embedded. A page that does not meet the requirements (DeviceRGB in PDF/X, CMYK in PDF/A with an sRGB output intent, fonts that are not embedded, transparency, optional content in PDF/A and so on) is not embedded; a placeholder frame is drawn and `pdfx/embedded-pdf`, `pdfa/embedded-pdf` or `pdfua/embedded-pdf` is reported. The colors of embedded pages are not converted to CMYK. In output that flattens transparency (PDF/X-1a, X-3), PDF images are not placed (use PDF/X-4).
- **Limits**: `pdfImageObjects`, `pdfImagePages`, `pdfImageDepth`, `pdfImageStreamBytes`, `pdfImageLoadMs`, `pdfImageRangePages` (the "Input limits" table). Compressed streams are limited before and while they are decompressed. The object streams and cross-reference streams decompressed while loading are limited in total to the smaller of `pdfImageStreamBytes` and 100 times the file size (+ 1MB) (raising the limit does not change the limit by file size).

## draw.io diagrams

`drawio` holds the options for draw.io (diagrams.net) diagram files (`.drawio`, `.dio`; the type is `DrawioOptions`).

By default, draw.io diagrams are read as images, and a page is converted to SVG and placed in the PDF as shapes and text (the code that draws diagrams is loaded only when a diagram appears). With `false`, draw.io diagrams are not read as images.
The options are these.

| Option | Contents |
| --- | --- |
| `stencils` | Shape library files (`js/stencils.min.js`, or library XML) and distributed image files (named `.svg`, `.png` or `.jpg`): an array of `{ name, data }`, where `data` is the content or a function that reads it only when used |
| `fetchStencils` | Whether to fetch shape libraries and images missing from `stencils` from draw.io's distribution over the network. `false` by default (nothing is fetched; shapes that cannot be drawn get only their text, with a warning). `true` fetches from draw.io's public repository at a fixed version and checks the SHA-256 of the content against the list for that version. A string (URL) fetches that `stencils.min.js` and the images under the same place (`…/img/lib/…` for `…/js/stencils.min.js`), without the check. A function `(path, { url, fetch }) => content` is called with the path inside the distribution when something is needed (for keeping a local copy, for example; `url` is the default location, and `fetch` fetches with the same size limits, timeout and redirect rules as the core). What has been fetched is reused for the same URL within the process or page |
| `stencilsUrl` | The URL of the `stencils.min.js` to fetch from (when `fetchStencils` is `true` or a function; otherwise draw.io's public repository at a fixed version) |
| `provideStencils` | A function that receives the names of the missing shape libraries and images and returns a shape library registry (when given, `stencils` and `fetchStencils` are not used) |

The syntax, page selection and what is drawn are described in [`docs/en/drawio.md`](drawio.md).

## Plugins

`plugins` is an array of plugins. For now, plugins can only add image formats.

```ts
{ apiVersion: 1, name, imageFormats: [{ name, mime, extensions, sniff, load }] }   // types KumioriPlugin and ImageFormat
```

| Field | Contents |
| --- | --- |
| `apiVersion` | The version of the interface; currently `1` (`PLUGIN_API_VERSION`) |
| `name` | The plugin's name (a non-empty string; shown in warnings) |
| `imageFormats[].name`, `mime` | The format's name and MIME type |
| `imageFormats[].extensions` | Extensions of files to read as images |
| `imageFormats[].sniff(bytes)` | Returns whether the content is in this format (synchronous) |
| `imageFormats[].load(bytes, ctx)` | Reads the image and returns `{ svg, width, height, warnings }` (an SVG document, the width and height in CSS px, and warnings for what could not be drawn) (asynchronous); `undefined` if it cannot be read |

- When an image file matches a format's `sniff` (a synchronous check of the content), its `load` (asynchronous) returns SVG and a size, and Kumiori draws it as an SVG image (it goes into the PDF as shapes).
- Files named with the `extensions` are also read as images when the document mentions them.
- Heavy code can be loaded with `import()` inside `load`, so that it is loaded only when a file of that format appears.
- `apiVersion` is the version of the plugin interface (`PLUGIN_API_VERSION`), raised on incompatible changes.
- Plugin formats are checked before the core's formats (draw.io diagrams).

What `load` receives (`ctx`; type `ImageFormatContext`):

| Name | Contents |
| --- | --- |
| `measureText` | Measures text with the fonts that draw it |
| `fetchResource` | Fetches under the same rules as the document's images (`resolveResource` and `fetchImages`) |
| `fetch` | Fetches what the user allowed through the plugin's own options |
| `fetchTimeoutMs` | The timeout for fetching (milliseconds; `TypesetOptions.fetchTimeoutMs`) |
| `warn` | Reports a warning (warnings not tied to one image; per-image warnings go in the result's `warnings`) |
| `lang` | The language for warnings (`ja` or `en`; `TypesetOptions.lang`) |
| `fragment` | The part of the image reference after `#`, to select which diagram or page of a file to draw. When the same file is referenced with different fragments, `load` is called once per reference and each becomes its own image |
| `limits` | The input limits (`TypesetOptions.limits` filled in with the defaults; read only), for a format to adjust its own work |

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

The helpers in `kumiori/node` are these.

| Helper | Contents |
| --- | --- |
| `createFontLoader({ fontDir, cacheDir, log, timeoutMs })` | A `loadFont` that reads the default fonts the same way as the Node CLI: `fontDir` → the font cache → the network; fetched fonts are saved in the cache. `cacheDir` defaults to `defaultFontCacheDir()`; `null` disables the cache |
| `defaultFontCacheDir(env, platform, home)` | The default location of the font cache: the environment variable `KUMIORI_FONT_CACHE` if set, otherwise `kumiori/fonts` in the OS cache directory (`%LOCALAPPDATA%` on Windows, `~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` elsewhere). `undefined` if the home directory is unknown. Omitted arguments default to the current environment |
| `looksLikeFont(bytes)` | Whether the bytes look like a font file (by the first 4 bytes of TrueType, OpenType (CFF) or TrueType Collection), to detect truncated downloads and broken caches |
| `createFileResolver({ root })` | A `resolveResource` that reads files referenced with `file:` URLs. With `root`, only files inside it are read. `root` may also be a list of directories, and containment is checked on the real paths after resolving symbolic links |
| `createSystemFonts({ dirs, maxFiles })` | An OS font finder for `systemFonts`. It looks in the OS font locations for fonts that have the characters no loaded font has a glyph for. `dirs` is an array of the directories to search, as strings (default `systemFontDirs()`; a value that is not an array, an item that is not a string, or an empty string is a `TypeError`; relative paths are resolved against the current directory when the finder is created; an empty array searches nowhere), and `maxFiles` caps the number of files searched (default 20000). It reads only the tables it needs from each font file (the character map `cmap` and a few others), and the finder keeps the index (built once, on the first search; it is built in small steps so that it does not hold the event loop for long on a machine with many fonts, waiting for it stops on the stop signal (`signal`), and when a font file turns out to have changed after the index was built, the index is rebuilt on the next search). It picks fonts for the serif and sans-serif kinds separately, and never picks fonts that cannot be embedded in PDF (OS/2 `fsType`) |
| `systemFontDirs(env, platform, home)` | The OS font locations. On Windows, `%WINDIR%\Fonts` and `%LOCALAPPDATA%\Microsoft\Windows\Fonts`; on macOS, `/System/Library/Fonts`, `/Library/Fonts` and `~/Library/Fonts`; elsewhere (Linux and so on), the `<dir>` entries of the fontconfig configuration (`FONTCONFIG_FILE`, `FONTCONFIG_PATH`, `/etc/fonts/fonts.conf`), or the XDG locations without a configuration. Arguments left out are taken from the current environment |

## Package entry points and requirements

| Entry point | File | Use |
| --- | --- | --- |
| `kumiori` | `dist-lib/index.js` | An ES module that does not bundle its dependencies (pdf-lib, fontkit, xmldom, etc.). Use it with a bundler such as Vite or webpack, or load it from Node |
| `kumiori/node` | `dist-lib/node.js` | The Node helpers ([above](#node-helpers-kumiorinode)) |
| `kumiori/browser` | `dist-browser/kumiori.js` | A single file with the dependencies bundled, for browsers without a bundler |

- Only what is exported from `src/index.ts` (and `src/node.ts` for Node) is public. The functions and types of other modules may change between versions.
- It is ES module only, but `require('kumiori')` also works (on Node 22.12.0 or later, which can load ES modules with `require()` without a flag; 22.12 prints an `ExperimentalWarning` from Node when doing so, and 22.13 and later do not).
- Node 22.12.0 or later is required. Node 20 was dropped in 0.7.0, as its support (maintenance) ended in April 2026. 22.0 to 22.11 are excluded because they cannot load ES modules with `require()` without `--experimental-require-module`.
- It also runs on Deno and Bun, through their Node compatibility APIs (checked on Deno 2.9 and Bun 1.4). Load the package installed from npm with `import { typeset } from 'kumiori'`, as on Node (on Deno, `npm:kumiori` also works).
  What was checked: loading `kumiori`, `kumiori/node` and `kumiori/browser`; typesetting HTML and XSL-FO; writing PDF, SVG and PNG; `createTypesetter`; loading fonts with `createFontLoader` (from the cache directory and from the network); the language of overlapping calls (it takes the `AsyncLocalStorage` that Deno and Bun provide through `process.getBuiltinModule`);
  and the command (`deno run -A node_modules/kumiori/dist-cli/cli.js`, `bun node_modules/kumiori/dist-cli/cli.js`) writing PDF, PNG and SVG, reading standard input, `--system-fonts` and `--watch`.
  On Deno, it uses files, the network and environment variables, so run it with those allowed (`-A`, or `--allow-read`, `--allow-write`, `--allow-net` and `--allow-env`).
- It can also typeset inside a Web Worker ([Typesetting in a Web Worker](#typesetting-in-a-web-worker)). Where there is neither the Node API nor a DOM, such as Cloudflare Workers, use the single browser file (`kumiori/browser`).
  What was checked is typesetting inside a Chromium Web Worker, drawing to an OffscreenCanvas and making a PDF, and loading and typesetting with this file on Deno and Bun; it has not been tried on Cloudflare Workers itself
  (pass the fonts with `loadFont`; whether it fits the Workers limits on the size of a Worker, memory and CPU time depends on the size of the documents and fonts).

`kumiori/browser` is about 3.0MB (1.0MB gzipped). Together with the separate files it loads at start (`chunks/`, such as pdf-lib and pako) it is about 3.6MB (pdf-lib is a separate file because it is shared with the code for draw.io diagrams).
The hyphenation dictionaries, the CGM, EPS, WMF, EMF and draw.io diagram processing and the like are loaded as separate files only when used.
The version published on npm can be loaded directly from the jsDelivr or unpkg CDN.

```html
<script type="module">
  import { typesetHtml } from 'https://cdn.jsdelivr.net/npm/kumiori@0.8.0/dist-browser/kumiori.js';
  const result = await typesetHtml(html, { name: 'a.html' });
  await result.renderPage(document.querySelector('canvas'), 0);
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
    await r.renderPage(canvas, i, { scale: 1 });                // 1pt = 1 CSS px (actual size is 96 / 72)
    container.append(canvas);
  }
}
```

- When typesetting repeatedly, create a container with `await createTypesetter(setup)` that loads the fonts only once, and typeset with `typesetter.typeset(html, options)`; it is faster (pass the font-related options such as `loadFont` in `setup`).
  - The container remembers the parts of the previous document's typesetting that come out the same when their input is the same (the preparation of `@font-face` font files, such as decompressing WOFF2, and the line breaking of paragraphs with the same content, style and width) and reuses them for the next document.
    When a document is edited a little at a time and typeset again, typesetting is faster from the second time on (about 13 s → about 9 s for a 151-page document). Reuse does not change the result (the area tree or the PDF).
    With `typeset`, the pages of page sequences whose content and starting conditions (first page number, left/right, footnote numbering carried over) do not change are also reused from the previous document.
    An edited page sequence also takes the pages before the edit from the previous document and lays out from that page break,
    and takes its remaining pages from the previous document once the layout state at a page break after the edit matches the previous document
    (when the edit changes the page count so that later page numbers shift, the rest is laid out; edited page sequences with columns or a last-page master are laid out in full).
    Pages are taken from the previous document not only when text or attributes are edited but also when a block (a paragraph, heading, table and so on) is added or removed (the structure of the document is matched with the previous one, and the nodes outside the edit are put in correspondence).
    When a node outside the body (flow) of a page sequence (static content, region backgrounds, the footnote separator and so on, which affect every page) is added, removed or edited, that page sequence is laid out in full.
    The content of `fo:retrieve-marker` in static content (the text of markers) is laid out again from the current document also on reused pages, so editing a marker does not prevent reusing the pages of other page sequences.
    A preview of the first N pages (`maxPages`) in between does not discard the pages of the document laid out in full before it (the preview neither uses nor remembers them).
    Edits of the document-wide fields outside the page sequences that layout does not read do not prevent reuse: bookmark titles (HTML `h1`–`h6` become bookmarks by default, so this includes the bookmark title when the text of a heading is edited; `fo:bookmark-title` in XSL-FO),
    the document title and information (`<title>` and `meta` in HTML, `axf:document-info` in XSL-FO), and, when a tagged PDF (`tagged`) is made, the structure tree (structure types, alternative text, abbreviation expansions, languages, and the shift of structure element numbers caused by structure elements added earlier).
    These are rebuilt from the current document, also for reused pages.
    Page sequences and pages with page number references are used only when the references give the same values as in the previous document. Documents and page sequences with indexes or per-page footnote numbers do not reuse pages.
    Forward page number references, such as a table of contents, are laid out with provisional values in the first layout pass and get their values in the second, so the Typesetter keeps the pages of the first pass of the previous document and compares them with the first pass of the next document
    (the pages before the edit can be used also in a page sequence with a table of contents). A page sequence whose reference values change their number of digits in the second or a later pass, so that only the text cannot be replaced, is laid out
    from the page break before the first page that looked up a changed value, and once the layout state matches the previous pass, the remaining pages are taken from the previous pass (also without a previous document; only when a Typesetter lays it out).
    Nor do documents near the internal layout effort limit, page sequences that reached a limit (`limits`) or gave a font notice (errors in a font's shaping tables and so on) while being laid out, and documents whose warnings are in another language; these are laid out without reuse.
    `typesetToPdf` and `typesetToPdfStream` (which write and release each page) do not remember pages (pages remembered by an earlier `typeset` are used).
    Re-typesetting the HTML and CSS Conformance Guide (147 pages, one page sequence) after editing one paragraph takes about 6.0–6.3 s instead of about 9.5–9.9 s for `typeset` (about 2.0–2.1 s instead of about 5.6–6.1 s for the layout; the 3rd and 4th runs of `scripts/profile-relayout.mjs --edit`).
    It uses memory for what it remembers (the line breaking of one previous document: about 200 MB for a book of about 140 pages, at most about 400 MB; when pages are reused, the page trees and page-break records of the previous document are kept as well, and for page sequences laid out again in the second or a later pass, the pages of the first pass too); turn it off with `createTypesetter({ reuse: false })` if not needed.
    Of the page trees of the previous document, page sequences from the point where the number of nodes exceeds about 2 million (about 400 MB in Node) are not remembered (those page sequences are laid out in full in the next document).
  - When you keep several earlier results, decide the budget from `typesetter.memoryUsage()` plus each `result.memoryUsage()`, and release old results with `result.dispose()` and the reuse caches with `typesetter.releaseCaches()` ([Memory estimate and releasing](#memory-estimate-and-releasing-memoryusage-dispose-releasecaches)).
- Working sample: after `npm run dev`, open http://localhost:5173/examples/preview/ (`examples/preview/`).
  Edit the editing area on the left, the "HTML" box below it (write headings, ruby, tables and so on directly; it and the editing area mirror each other) or the print CSS, and the right side is re-typeset when you pause.
  It uses only Kumiori's public API and has no other dependencies.
  To connect another editor, call the equivalent of the sample's `schedule(editor HTML)` from the notification that the editor's content has changed.

## Typesetting a page built by JavaScript (snapshotDocument)

Kumiori does not run JavaScript. For a page whose content is built by JavaScript (charts, screens assembled from components, etc.), turn the document as JavaScript left it into text with `snapshotDocument(document, options)` in the browser window, and pass it to `typeset`.
It picks up what `'<!doctype html>' + document.documentElement.outerHTML` alone loses (the current values of forms, the base for relative URLs, etc.) and waits for the right time to take the text. This function is available from 0.6.0.

```ts
import { snapshotDocument, typeset } from 'kumiori';

const snap = await snapshotDocument(document, { waitFor: () => window.chartsReady });
const r = await typeset(snap.html, { ...snap.options, pageSize: 'A4' });
```

- It works only where there is a DOM and a rendered page (a browser window). Called in a Web Worker or in Node, it throws `KumioriOptionError`.
- The original document is not changed. The copy is built in a document that is not tied to the page (it loads no images and creates no custom elements).

Options (`SnapshotOptions`; all optional):

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `waitFor` | a `Promise` or a function | — | The page's own "ready" signal. A function is called on every rendering frame until it returns a truthy value |
| `timeoutMs` | number | 10000 | The longest wait (milliseconds). When it runs out, the document is taken as it is, with a `snapshot/wait-timeout` warning. 0 means no waiting |
| `signal` | `AbortSignal` | — | A signal to stop. When stopped, the returned Promise rejects with `signal.reason` |
| `shadowRoots` | `ShadowRoot[]` | — | Shadow roots whose content to include (closed roots too). Open roots are included without being passed |
| `fontSources` | a function `(face: FontFace) => content or URL` | — | Returns the content (`ArrayBuffer`, `Uint8Array`) or URL of a font added by JavaScript (`new FontFace`). `undefined` means it is not taken in |
| `canvas` | `'png'` or `'skip'` | `'png'` | `'png'`: turns the drawing of a canvas into a PNG and replaces it with an `img`. `'skip'`: does not replace it (the canvas fallback content is typeset) |
| `limits` | `{ imagePixels?, fileBytes?, snapshotBytes? }` | 100 million pixels, 256MB, 512MB | The pixels of an image taken in, the size of one file, and the total size taken in |
| `lang` | `'ja'` or `'en'` | — | The language of the warning messages |

Result (`DocumentSnapshot`):

| Field | Type | Content |
| --- | --- | --- |
| `html` | string | The document as text (from `<!doctype html>`) |
| `options` | `{ kind, name, files }` | What to pass as is to the `typeset` options. The `data` of each of the `files` is a `Uint8Array` |
| `baseUrl` | string | The base URL of the document when it was taken. The URLs in `html` are already absolute |
| `diagnostics` | `Diagnostic[]` | What could not be taken or was approximated (`snapshot/…` diagnostics; separate from those of `typeset`) |
| `warnings` | string[] | The messages of `diagnostics` |

What it waits for (up to `timeoutMs` in all):

1. The document load (`load`)
2. The font loading (`document.fonts.ready`)
3. The page's signal (`waitFor`)
4. Rendering to settle (two rendering frames, and running animations (CSS animations and transitions, and `element.animate()`) that have an end)

It does not wait for images to load (the URLs are made absolute and Kumiori fetches them itself, so images outside the screen with `loading="lazy"` are typeset too).
Animations that JavaScript runs itself (drawn with `requestAnimationFrame`, as in Chart.js) are not CSS animations, so it cannot wait for them. Turn the animation off, or raise a signal in its completion callback and wait for it with `waitFor`.

What it fixes while copying:

- Relative URLs are made absolute against the document base (`<base href>` if any). A reference that is only `#id`, or the document URL with `#` added, is written as `#id` so that it becomes a link inside the PDF. `<base>` is removed.
- The drawing of a canvas is turned into a PNG, put in `files`, and the canvas is replaced with `<img data-kumiori-canvas>` (the attributes are copied as they are, so a size in `style` still applies). Rules in the document's `<style>` that name `canvas` are applied to the replacing `img` as well, and rules that name `img` are not applied to it (rules in stylesheets loaded with `<link>` are not rewritten, so their `img` rules do apply). A canvas tainted by a cross-origin image cannot be turned into an image, so it is left as a canvas (`snapshot/canvas-tainted`). A WebGL canvas may come out blank unless it is created with `preserveDrawingBuffer: true`.
- A `<style>` keeps its source text (so that declarations the browser does not know, such as `string-set` and `-ah-*`, are not lost), and only the rules JavaScript added through the CSSOM (`insertRule`; the production build of styled-components and emotion, etc.) are written into a `<style data-kumiori-cssom>` right after it. Rules removed through the CSSOM cannot be removed from the source text, so they are kept (`snapshot/stylesheet-rule-removed`).
- Constructed stylesheets (`document.adoptedStyleSheets`) are written out as their rules in a `<style data-kumiori-adopted>` (there is no source text, so declarations the browser does not know cannot be recovered). A `<link rel="stylesheet">` is kept with its URL made absolute, and Kumiori fetches it itself (rules changed by JavaScript are not copied). Disabled stylesheets are removed.
- Shadow DOM (Web Components) is expanded into the flat tree (the host's children become a copy of the shadow tree, and each `<slot>` is replaced with the nodes assigned to it). The shadow tree's styles (including `:host` and `::slotted()`) are rewritten with their selectors enclosed by attributes, so that they apply only inside that shadow tree. This is an approximation that slightly raises specificity. `::slotted()` of the shadow trees in between nested `<slot>`s also applies, and `:host-context()` also matches the host itself. `@import` in a shadow tree has the rules of the imported sheet enclosed in the same way (`@font-face` in a shadow tree applies to the whole document). A stylesheet in a shadow tree whose rules cannot be read (a `<link>` or `@import` from another origin) is not copied, with a `snapshot/shadow-stylesheet-unreadable` warning. `::part()` is not handled. Closed shadow roots cannot be seen, so only those passed in `shadowRoots` are copied (otherwise a `snapshot/shadow-root-closed` warning is given where one seems to be).
- Fonts from CSS `@font-face` are kept as CSS (with their URLs made absolute) and Kumiori fetches them. For fonts added by JavaScript (`new FontFace` added with `document.fonts.add`) the browser returns neither the content nor the URL, so pass them with `fontSources`. The content is put in `files` and an `@font-face` with the same family, weight and style is added (otherwise `snapshot/font-face-source-unknown`; fonts with the same content share one file and identical rules are written once; returning a `javascript:` URL also gives `snapshot/font-face-source-unknown`).
- blob: URLs (in attributes and in CSS `url()`) are read and their content put in `files` (only where they are used for typesetting: images (`img`, `source` in `picture`, `src` of `input`, `poster` of `video`, SVG `href`), `link`, `object`, `embed`, and CSS; blob: URLs in the `href` of `a` and `area`, the `src` of `video` and `audio`, and so on are left as URLs without reading their content). The size is checked before reading. Even for a revoked URL, the picture of an `img` that has finished loading is taken in as a PNG (an SVG image becomes a pixel PNG too). Those that cannot be read give a `snapshot/blob-unreadable` warning.
- For `srcset` and `<picture>` images, the image the screen chose (`currentSrc`) becomes `src` (the image chosen for the screen width).
- The current values of forms are written back to attributes (`value`, `checked`, `selected` and the content of `textarea`). The values of `password` and `hidden` and `file` are not written (so that CSRF tokens and the like are not left in the copy). Kumiori currently does not draw the text of the value inside an `input` (it draws the content of a `textarea` and the text of the `option`s of a `select`).
- `<script>` (data islands too), `on…` attributes, `javascript:` URLs (including those hidden with spaces or control characters, and SVG animations (`set`, `animate` and so on) that change `href` to `javascript:`), `data:` URLs of `<iframe>`, `<object>` and `<embed>` (image `data:` URLs are kept), `<noscript>`, `<meta http-equiv="refresh">` and comments are removed. The content of `<template>` is copied with the same removals. `</style` inside the text of a `<style>` is escaped and `<xmp>` becomes `<pre>`, so that no elements are injected when the copy is parsed again. The copy contains what was on the screen (such as values the user entered), so take care with it when sending it to a server.
- The document inside an `<iframe>` is not copied (`snapshot/iframe-skipped`).

To typeset in a Web Worker ([Typesetting in a Web Worker](#typesetting-in-a-web-worker)), call `snapshotDocument` in the window and send the result to the Worker. The result is plain data only (strings and `Uint8Array`s), so it can be sent as it is.

```js
const snap = await snapshotDocument(document);
worker.postMessage({ type: 'typeset', html: snap.html, options: snap.options }, snap.options.files.map((f) => f.data.buffer));
// In the Worker: (await typesetter).typeset(data.html, data.options)
```

Limits and cross-origin resources:

- What is taken in (canvas PNGs, blob: contents, `fontSources` fonts, including `data:` URLs returned by `fontSources`) is limited to `fileBytes` per file, `imagePixels` per canvas, and `snapshotBytes` in total (anything over is not taken in, with a warning). When you raise `limits` for `typeset`, pass the same values to the `limits` of `snapshotDocument` too.
- `snapshotDocument` itself reads only what is inside the same document (canvases, blob: URLs, the CSSOM) and does not go to the network. For `http(s)` images and stylesheets it only makes the URLs absolute; `typeset` fetches them (the `fetchImages` and `fetchStyles` rules apply).
- So a cross-origin image without CORS response headers becomes an unreadable image when typeset in the browser, even though it shows on the screen (an `<img>` can show it without CORS, but `fetch` cannot read its content). Put it on the same origin or add CORS response headers.

What cannot be typeset:

- Positions and sizes that JavaScript measured against the screen width (measured with `getBoundingClientRect` and written into `style`) stay at the screen width and are not laid out again for the width of the paper's text area. Matching the screen width to the text area width before taking the text helps.
- There is no substitute for JavaScript that runs after pagination (writing page numbers or running heads with JavaScript), so write those with CSS `counter(page)`, `target-counter()` and `string-set`.

## Typesetting in a Web Worker

Typesetting, drawing and writing the PDF can run in a Web Worker, so that the page does not freeze while a large document is typeset. Load the single-file browser build (`kumiori/browser`) inside the worker.
This works from 0.5.0 (0.4.0 cannot typeset in a worker).

```js
// worker.js (created with new Worker('worker.js', { type: 'module' }))
import { createTypesetter } from 'https://cdn.jsdelivr.net/npm/kumiori@0.8.0/dist-browser/kumiori.js';
const typesetter = createTypesetter();                          // Promise<Typesetter>; fonts are loaded only once
let result;
self.onmessage = async ({ data }) => {
  if (data.type === 'typeset') {
    result = await (await typesetter).typeset(data.html, { name: 'a.html' });
    self.postMessage({ type: 'typeset', pageCount: result.pageCount, sheets: result.areaTree.sheets.map((s) => [s.width, s.height]) });
  } else if (data.type === 'render') {
    const canvas = new OffscreenCanvas(1, 1);
    await result.renderPage(canvas, data.page, { scale: data.scale, devicePixelRatio: data.dpr });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: 'render', page: data.page, bitmap }, [bitmap]);
  } else if (data.type === 'pdf') {
    const pdf = await result.toPdf();
    self.postMessage({ type: 'pdf', pdf }, [pdf.buffer]);
  }
};
```

To stop a layout in progress, call `abort()` on an `AbortController` from a message sent by the parent ([Stopping and progress](#stopping-and-progress-signal-onprogress)).
Messages inside the Worker (`onmessage`) run only where typesetting pauses (at phase boundaries), so to stop at once, stop the whole Worker with `worker.terminate()` and typeset again in a new Worker.
If you send progress (`onProgress`) to the parent with `postMessage`, the parent's page can show it while typesetting runs (the parent is not blocked, so it arrives at once).

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

- A worker has no browser images (`<img>`), so SVG images are drawn as shapes in the PDF, as in Node, and `renderPage` draws the shapes as pixels (redrawn at the resolution of the current scale). Images in other formats are read with `createImageBitmap` (while typesetting, only to check that they can be read and their size, closed at once; they are decoded again in the Typesetter's image cache when drawing. The same holds when typesetting on a page).
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

These are the rules for units and coordinates in the typeset result (Area Tree); the details are under "Units and coordinates" in [`docs/en/area-tree.md`](area-tree.md).

- All units are **pt** (1/72 inch).
- Coordinates are physical, with y pointing down (they are converted to the y-up coordinates of PDF when drawn).
- An Area's `x` and `y` are the position of its border-box's top left, measured from the top left of the parent Area's content-box. `width` and `height` are the size of the border-box and do not include `margin` (the space outside the border-box).
- When a box is rotated (`orientation`), `width` and `height` are the size before rotation, `x` and `y` are the top left of the bounding box after rotation, and the children's coordinates are local coordinates before rotation.

The characters of the typeset result (`GlyphArea`) carry `hyphen`, a mark for a character added at the end of a line by hyphenation (not an input character), and `breakSpace`, the space character removed at the end of a line. `breakSpace` is on the last character (in reading order) of a line broken at a space, and not on the last line of a paragraph or a line ended by a forced break.
When extracting text, dropping the `hyphen` characters and adding `breakSpace` gives back the input characters (after spaces have been collapsed).

How typesetting works inside (the logical tree before layout and so on, which is not public API) is in [`docs/en/architecture.md`](architecture.md).

## API stability (what is kept across versions)

The public API (what `kumiori`, `kumiori/node` and `kumiori/browser` export) is divided into what is kept across versions (stable) and what may change.
While the version is 0.x, incompatible changes may come in a minor version (such as 0.6.0 to 0.7.0). A patch version (such as 0.6.0 to 0.6.1) breaks neither.
From 1.0.0, the stable parts follow [Semantic Versioning](https://semver.org/) (only a major version breaks compatibility).

### Stable

Names, arguments, the shape of returned values and their meaning are kept. An incompatible change comes in a minor version and is marked "**compatibility changes**" in the changelog (CHANGELOG).
Where possible, the old form is still accepted for one version, with a deprecation warning. Adding options, fields or diagnostic names is a compatible change.

| What | What is stable |
| --- | --- |
| `typeset`・`typesetHtml`・`typesetFo`・`typesetToPdf` | The entry functions |
| `createTypesetter` | The function that makes a typesetter, and the typesetter's `typeset` and `typesetToPdf` |
| `decodeDocumentText`・`isKumioriError` | Turning bytes into a string; telling Kumiori errors apart |
| `TypesetResult` | `areaTree`, `pageCount`, `warnings`, `diagnostics`, `layoutMs`, `truncated` (added in 0.6.0), and how `toPdf`, `renderPage`, `renderPageToSvg` and `renderPageToPng` are called, with their options (except `RenderPageOptions.guides` and `RenderPageSvgOptions.pageHref`, listed as subject to change below) |
| `TypesetPdfResult` | `pdf`, `pageCount`, `warnings`, `diagnostics`, `layoutMs` and `truncated` of the result of `typesetToPdf` |
| `TypesetOptions` | `name`, `kind`, `files`, `fonts`, `genericFonts`, `loadFont`, `style`, `pageSize`, `compat`, `print`, `lang`, `fetchImages`, `fetchStyles`, `fetchTimeoutMs`, `resolveResource`, `links`, `tagged`, `pdfua`, `documentLang`, and `signal`, `onProgress`, `maxPages` and `limits`, added in 0.6.0 (for `limits`, the field names; the default values may change) |
| `PdfOptions` | `title`, `pdfx`, `pdfa`, `imageMaxDpi`, and `date`, `signal` and `onProgress`, added in 0.6.0 |
| `KumioriError` | The error types (such as `KumioriInputError`) and the names in `ERROR_CODES` and `DIAGNOSTIC_CODES` (removing a name or changing its meaning is a compatibility change) |
| `kumiori/node` | `createFontLoader`, `createFileResolver`, `createSystemFonts`, `defaultFontCacheDir`, `systemFontDirs`, `looksLikeFont` |
| `walkAreaTree` | The functions that walk, write and read the Area Tree (`walkAreas`, `childrenOf`, `documentNodes`, `serializeAreaTree`, `parseAreaTree`), and `AreaTreeFormatError`, the error `parseAreaTree` throws |
| `DEFAULT_FONTS` | Its shape (`base`, `math`, `mono`, `symbol`, `emoji`, and the fields of `FontSpec`). Which fonts are used may change |

### May change

The following may change, even incompatibly, in a minor version. Changes are written in the changelog.

- The layout result itself (positions and shapes of glyphs, lines and images). It changes with each fix. A version where it changes says "**typesetting results change**" in the changelog
- The details of the Area Tree fields (the types under `AreaTree`). When the meaning of a field or how children are held changes, `AREA_TREE_SCHEMA_VERSION` is raised (below)
- The wording of warnings (`warnings`) and diagnostic messages. To tell them apart in a program, use the diagnostic name (`code`)
- The internal structure of the PDF, SVG and PNG output (the order of PDF objects, how SVG elements are built, and so on)
- New and experimental options:
  `systemFonts`, `spotColors`, `svgLanguages`, `deflate`, `unreferencedCss`, `diagnostics`, `plugins`, `drawio` (and `createDrawioStencilRegistry`, `DRAWIO_MIME`, `isDrawio`), `reuse`, `TypesetPdfOptions.lowMemory`, `RenderPageOptions.guides`,
  `RenderPageSvgOptions.pageHref` and how links are written in page SVG, added in 0.6.0, `snapshotDocument`, added in 0.6.0,
  writing the PDF as a stream, added in 0.7.0 (`typesetToPdfStream`, the container's `typesetToPdfStream`, `TypesetResult.toPdfStream`, `PdfOutput`, `TypesetPdfStreamResult`, including how the output is handled, the chunk size and the order of writing),
  and PDF encryption (`PdfOptions.encrypt`, `PdfEncryptOptions`, `PdfPermissions`) and the text measuring API (the Typesetter's `measureText`, `breakLines`, `TextStyle`, `MeasuredText`, `MeasuredLine`), added in 0.8.0,
  and the APIs to estimate and release memory, added in 0.8.0 (`TypesetResult.memoryUsage`, `TypesetResult.dispose`, `Typesetter.memoryUsage`, `Typesetter.releaseCaches`, `MemoryUsage`, `TypesetterMemoryUsage`, including how the estimates are counted and their factors)
- Anything not exported from `src/index.ts` or `src/node.ts` (it is not public API)

### The two version numbers

Apart from the package version, two numbers state compatibility. Raising either is written in the changelog.

- `PLUGIN_API_VERSION`: the version of the plugin interface (`KumioriPlugin`, `ImageFormat` and so on). It is raised when the interface changes incompatibly, and a plugin with a different `apiVersion` is refused as unreadable ([Plugins](#plugins)). The interface promises compatibility through this number, so it is not in either of the two groups above
- `AREA_TREE_SCHEMA_VERSION`: the version of the Area Tree shape (the `schemaVersion` written by `serializeAreaTree`). It is raised when the meaning of a field or how children are held changes. `parseAreaTree` reads trees of the current version and of every earlier version (from version 1), and rejects a tree of an unknown version ([`docs/en/area-tree.md`](area-tree.md))

## API reference

Every function, type and option is described in the API reference (<https://n-lights-co.github.io/kumiori/api/>), a list of pages generated from the comments in the type declarations.
The reference is in Japanese only, because it is generated from the Japanese comments in the source; this guide covers the main functions and options in English.
In this repository, `npm run docs:api` builds it into `dist/api/`.
