> 日本語: [../diagnostics.md](../diagnostics.md)

# Diagnostic and error codes

The `diagnostics` of a typesetting result (`TypesetResult.diagnostics`, `TypesetPdfResult.diagnostics`, `AreaTree.diagnostics`) and the errors Kumiori throws (`KumioriError` and its subclasses, and `KumioriOptionError`) all carry a code (`code`). This page lists the codes. The table in `src/diagnostics.ts` is authoritative, and `test/diagnostics.test.ts` checks that this list matches it.

## Commitments

- A code has the form "stage/what" (such as `css/unknown-property`; lowercase letters and hyphens). Once released, a code is not changed across versions and is not reused for another meaning. When a code is retired, it stays in this list with the version that stopped using it.
- The text (`message`) is shown to users (in the `lang` language) and may be reworded between versions. Use `code` to tell kinds apart.
- `args` holds the values embedded in the text (for machines). Each code uses the names in the table below (some have none).
- `warnings` (the list of texts) keeps the same texts in the same order as before. `diagnostics` holds the same events one by one.
  - Unsupported and unknown CSS and XSL-FO and characters with no glyph are gathered into one text in `warnings`, but are one diagnostic per item in `diagnostics`.
  - The same diagnostic (same code, text and location) is kept once, with the number of occurrences in `count`.
  - Up to 200 diagnostics are kept per code. The rest are not counted in the `count` of the kept ones; they are gathered into one separate diagnostic with the same code (its text says "n more warnings of the same kind (m distinct) were omitted"). That diagnostic has the number of omitted diagnostics (repeats of the same diagnostic included) in `args.omitted` and the number of distinct omitted ones (different code, text or location) in `args.omittedKinds`, and has no `source` or `count`.
  - Notices of PDF/X, PDF/A and PDF/UA are in `diagnostics` even when they are sent to `pdfx.warnings`, `pdfa.warnings` or `pdfua.warnings`.

## Shape of a diagnostic

```ts
interface Diagnostic {
  code: DiagnosticCode;        // the code (table below)
  severity: 'error' | 'warning' | 'info';
  message: string;             // the text shown to users
  args?: Record<string, string | number>;
  source?: { file?: string; line?: number; column?: number; element?: string; sourceRef?: number; page?: number };
  count?: number;              // the number of merged occurrences (absent when 1)
}
```

## Location in the input (source)

A diagnostic has a location `source` when it is known. Every field is absent when unknown.

- `file`: the name of the input file (`TypesetOptions.name`). For CSS diagnostics, the name of the stylesheet file (the name in `files`), or the name of the document for `<style>` and `style` attributes
- `line`, `column`: line and column, counted from 1
  - XSL-FO: the line and column of the element (in the library, the command and the browser app). Documents whose number of line breaks changed when expanding internal entities of the DOCTYPE get no line or column, and documents whose text changed get no column
  - HTML: inside Node and Web Workers (read with linkedom), the line and column of the start tag of the element. Inside the browser page (the browser's DOMParser and the app's iframe), they are not available (only the element hint). They are not given for XHTML (read after converting to HTML), documents whose text is rewritten before reading with `--style ah`, and the content of SVG foreignObject
  - Unsupported and unknown CSS properties: when the element is known, the location of that element. Those counted from CSS declarations get the line and column of the first place they are written, searched textually in the stylesheet files, `<style>` and `style` attributes (it may hit text in comments)
- `element`: a hint for the element (such as `p#intro`, `img.photo`, `fo:block#a`: the name and `id`, or the first `class` when there is no `id`)
- `sourceRef`: for layout diagnostics, the `sourceRef` (the number of the input node) of the box of the event in the Area Tree. For line diagnostics (a line does not fit), the number of the box that contains the line
- `page`: for diagnostics while writing the PDF, the number of the page being drawn (from 0)

Diagnostics with the same code and text but different locations are separate diagnostics (up to 200 per code; the rest are gathered into one, as described under "Commitments" above).

## Severity

- `error`: content of the input is missing or changed in the output (a missing image, a character with no glyph, an overflow, a cut at a limit). It is not an exception: typesetting runs to the end and the PDF is still written.
- `warning`: a specification was ignored or laid out differently.
- `info`: the output is as intended, but it is worth knowing (a fetch turned off by an option and so on).

## Output on the command line and in the browser app

- Command line: one line per diagnostic on standard error, such as `  warning [css/unknown-property] style.css:3:3: ignored unknown CSS properties (misspelled or unsupported): colr`. The line starts with the severity, `error`, `warning` or `info` (in Japanese `誤り`, `警告`, `知らせ`). The location is `file:line:column`, followed by `(element)` and `(page n)` when known, and `(n times)` at the end when the same diagnostic occurred twice or more. Notices (`info`) are printed only with `--verbose`
  - Frequent diagnostics are condensed so that they do not bury the others. Characters with no glyph (`font/missing-glyph`) go on one line listing the 20 most frequent (`… ਭ (U+0A2D ×4), … (the 20 most frequent) and 625 more`). Other codes are printed up to 20 lines each, and the rest (including those omitted by the limit) go on one line, `n more warnings of the same kind (m distinct; …)`. `--diagnostics json` and the library's `diagnostics` keep one entry per diagnostic
- `--diagnostics json`: one JSON object per line on standard error (`{"input": the input file, "code": …, "severity": …, "message": …, "args": …, "source": …, "count": …}`), notices included. The conversion report (`a.pdf: 3 pages …`) is printed as before, so read the lines that start with `{`. DEL and C1 control characters of the document (U+007F to U+009F, including U+0085, which some readers treat as a line break), line and paragraph separators (U+2028, U+2029), bidirectional marks and controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) and the BOM (U+FEFF) are written as JSON string escapes such as `\u2028`, like control characters, so each entry is one line for any reader and the text does not change order on a terminal. The conversion report and the text output, including the input file names, also show these characters and control characters in a visible form such as `\x0a` and `\u2028`
  - An error that stops typesetting an input (an XML parse failure, a missing file, and so on) is also printed as one line of the same shape: `{"input": …, "name": "KumioriInputError", "code": "input/xml-parse", "severity": "fatal", "message": …, "args": …, "source": …}`. `severity` is `fatal`, `name` is the name of the error type, and `code` is present only for Kumiori's errors (see "Error types and codes" below; errors that are not Kumiori's, such as a missing file, have none). `args` and `source` are present only when the error has them. The exit code is 1, as before. Command-line usage errors are printed as text, not JSON
- Browser app: each line of the warnings column shows the severity mark (`✖` error, `⚠` warning, `ℹ` info), `[code]` and, when known, the element, line and page. Clicking a line with a page moves to that page

## Suppressing and exit codes

- Library: codes listed in `TypesetOptions.diagnostics.ignore` are not reported (they go into neither `warnings` nor `diagnostics`, nor the Area Tree, nor the warnings while writing the PDF). Unknown codes do not stop anything and are reported with an `api/unknown-diagnostic-code` warning. There is no option to escalate diagnostics to errors (check the `severity` in `result.diagnostics`)
- Command line: `--ignore-warning <code>` (comma-separated, repeatable) does the same. With `--fail-on error|warning`, the command writes the output and then exits with code 2 when there is a diagnostic of that severity or worse (1 when an input could not be typeset). Suppressed diagnostics are not counted

## Diagnostic codes

| Code | Severity | Meaning | args |
|---|---|---|---|
| `api/setup-option-ignored` | warning | a `createTypesetter` option (fonts, `reuse`) was passed in the per-document options (it is not used) | `option` |
| `api/unknown-diagnostic-code` | warning | `diagnostics.ignore` or `--ignore-warning` names something that is not a diagnostic code (nothing is suppressed for it) | `code` |
| `resource/not-fetched` | info | an image, stylesheet or font was not fetched because of `fetchImages` or `fetchStyles` | `url`, `kind` |
| `resource/fetch-failed` | warning | a stylesheet or font could not be fetched | `url`, `kind` |
| `resource/attachment-not-found` | warning | the file of a file attachment annotation is not in `files`, or the reference points outside the document's location (a URL such as `file:`, an absolute path, or a path going up with `..`), so it was not attached (the message tells which) | `file` |
| `link/action-dropped` | warning | the action of a link out of the document was not written because of `links` (the text is typeset) | — |
| `fo/unsupported` | warning | an unsupported XSL-FO element, property or value was ignored (one per item) | `item` |
| `fo/note` | warning | the XSL-FO import substituted an approximation or a default (a too-large number of columns was capped, an `fo:index-range-begin` has no matching `fo:index-range-end`, no region matches `flow-name` so the content was flowed into the body region, there is no `page-sequence`, an `axf:document-info` name that is not in the Antenna House documentation, and so on; one per message; the same text as the notes in the app's conversion report) | — |
| `fo/master-reference-not-found` | error | no page master (the `master-name` of an `fo:simple-page-master` or `fo:page-sequence-master`) matches the `master-reference` of an `fo:page-sequence`, so that `page-sequence` was not typeset | `name` |
| `css/unsupported` | warning | an unsupported CSS property, value or rule was ignored (one per item; also values that are valid CSS but that Kumiori does not read (system font names such as `font: caption`, `font-size: math`) and extension values written on an unprefixed property that are read only with the compatibility option `--style ah` (such as `border-style: dot-dash`)) | `item` |
| `css/unknown-property` | warning | an unknown CSS property was ignored (misspelled or unsupported) | `property` |
| `css/invalid-value` | warning | a declaration of a known CSS property with an invalid value was ignored (such as `display: foo` or `color: notacolor`; mistyped or unsupported; one per "property: value"). Only declarations in author style sheets and `style` attributes are counted; values with `var()` or `attr()`, prefixed values (such as `-webkit-box`) and declarations with a readable declaration of the same property in the same rule (or `style` attribute; fallback values for browsers) are not counted | `property`, `value` |
| `css/invalid-attr-value` | warning | a declaration whose value is invalid after `attr()` substitution was ignored | — |
| `css/unreferenced-stylesheet` | info | a stylesheet not referenced from the document was not applied | — |
| `font/face-not-found` | warning | the font file of an `@font-face` was not found (the next font is used) | `font`, `url` |
| `limit/nesting-depth` | warning | elements are nested too deeply; the deep ones were laid out at a shallower level | — |
| `limit/css-import` | error | too much CSS is imported (`@import`); the rest was not read | `file` |
| `limit/raised` | info | input limits (`limits`, or `--limit` on the command line) are raised above the defaults (may use more time and memory; one per typesetting) | `limits` |
| `limit/reached` | warning | an input limit (`limits`, or `--limit` on the command line) was reached, and part of the input was cut or approximated (one per limit name per typesetting; currently `gridTracks` (a grid track list was cut), `leaderRepeats` (a leader of repeated characters was left blank), `nestedSelectors` (a nested rule with too many expanded selectors was not read), `styleRefs` and `importDepth` (stylesheet and font references were not fetched), `tableColumns` (the `span` of `col` and `colspan` were cut by a limit lowered below the HTML limit of 1,000), and `pdfImageObjects`, `pdfImagePages`, `pdfImageDepth`, `pdfImageStreamBytes` and `pdfImageLoadMs` (a PDF image was not drawn; `pdfImageStreamBytes` is reached while the PDF is written, so it is added to `warnings` and `diagnostics` of the result after `toPdf`)). Limits with their own diagnostics (`limit/table-columns`, `limit/css-import` and so on) are reported there | `limit`, `value` |
| `font/file-unreadable` | warning | a given font file (`fonts`, `@font-face`) cannot be read | `file`, `font` (`font` only for `@font-face`, where the font name is known) |
| `font/family-unreadable` | warning | the family name of a given font file cannot be read | `file` |
| `font/generic-not-loaded` | warning | a font named in `genericFonts` is not loaded | `font`, `generic` |
| `font/load-failed` | warning | a font the document needs (math, monospace, symbol, emoji) could not be loaded | `font` |
| `font/missing-glyph` | error | no loaded font has a glyph for a character (drawn as the missing-glyph box; one per character) | `char`, `codePoint` |
| `font/system-fallback` | info | characters no font has a glyph for were set in an OS font (`systemFonts`); the result depends on the fonts of the machine (one per font used for typesetting; `chars` are the characters set in it) | `font`, `chars` |
| `font/system-font-not-embeddable` | warning | an OS font has the characters but cannot be embedded in PDF (OS/2 fsType), so it was not used (the characters are also reported as `font/missing-glyph`; one per font) | `font`, `chars` |
| `font/repaired` | warning | a font was used after removing broken tables or glyphs | `font` |
| `font/table-unused` | warning | a table that takes too much to read was not used (ligatures, kerning and so on may not apply) | `font` |
| `font/cff2-not-converted` | warning | a font with CFF2 outlines could not be converted to a form that can be embedded in a PDF | `font` |
| `font/variable-unsupported` | warning | a variable font without outline variations (the default instance is used) | `font` |
| `font/variable-instances-capped` | info | too many instances of a variable font; the nearest instance is used | `font` |
| `font/variable-failed` | warning | an instance of a variable font could not be made (the default instance is used) | `font` |
| `font/shaping-failed` | warning | the shaping tables (GSUB, GPOS, morx) could not lay out the text (it is laid out without ligatures and so on) | `font` |
| `font/glyph-unreadable` | error | the outline or data of some glyphs cannot be read (they are empty or not drawn) | `font` |
| `font/color-glyph-too-complex` | warning | a color glyph with too many layers or outlines was drawn without color | `font` |
| `image/not-found` | error | an image is not found or cannot be read as an image | `src` |
| `image/unsupported` | error | an image cannot be drawn; a placeholder frame is drawn | `src`, `detail` |
| `image/partial` | warning | part of an image cannot be drawn (details from the format reader in `detail`) | `src`, `detail` |
| `image/reference-not-found` | warning | a file referenced by `image` or `use` in an SVG image is missing or unreadable | `src`, `href` |
| `image/timeout` | error | an image format did not finish loading within the time limit | `src`, `format` |
| `image/invalid-size` | error | the size returned by an image format is too large or not finite | `src`, `format` |
| `image/too-many-fragments` | warning | too many references to one file with different fragments | `src` |
| `image/format-warning` | warning | a warning from an image format reader (draw.io, plugins and so on) | — |
| `image/pdf-invalid` | error | a PDF image cannot be read (broken, no such page, nested too deeply, over a limit, and so on; the reason is in `detail`); a placeholder frame is drawn | `src`, `detail` |
| `image/pdf-encrypted` | error | a PDF image is encrypted and cannot be read; a placeholder frame is drawn | `src` |
| `image/pdf-page` | warning | the `#page=` value of a PDF image cannot be read or exceeds the number of pages; the first page is used | `src`, `detail` |
| `image/pdf-page-range` | warning | the `#page=` of a PDF image is a page range; only the first page of the range is used (in compatibility mode) | `src`, `detail` |
| `image/pdf-fragment` | warning | the fragment (`#`) of a PDF image has parameters or values that are not read (the Antenna House `bbox=` and ranges are read only in compatibility mode) | `src`, `detail` |
| `image/pdf-repaired` | info | a PDF image does not follow the specification in some way but was read after repair (extra bytes before the header, a rotation that is not a multiple of 90, and so on) | `src`, `detail` |
| `image/pdf-dropped` | info | the annotations of a PDF image (links, notes, form fields and so on) were not carried over into the output (only the page content is placed) | `src`, `detail` |
| `image/pdf-font` | info | a font in a PDF image is not embedded (viewers draw it with a substitute font) | `src`, `font` |
| `image/pdf-placeholder` | error | PDF images can be drawn only in PDF output, so a placeholder frame was drawn on screen or in SVG or PNG (`output` is the output: `screen`, `SVG`, `PNG`) | `src`, `output` |
| `layout/line-overflow` | error | a line does not fit on the page | — |
| `layout/box-overflow` | error | a box is larger than the page and overflows | — |
| `layout/float-overflow` | error | a float is larger than the page and overflows | — |
| `layout/footnote-overflow` | error | a footnote does not fit on the page and overflows | — |
| `layout/column-overflow` | error | the content does not fit in a multi-column container | `columns` |
| `layout/table-row-overflow` | error | a table row exceeds the page height and overflows | — |
| `layout/continuation-dropped` | error | the continuation of footnotes or floats cannot be placed on any page and was dropped | — |
| `layout/inline-block-dropped` | error | a block inside an inline box cannot be placed; its content was omitted | — |
| `layout/height-cut` | error | a box whose specified height exceeds 50 pages was cut off at 50 pages | — |
| `layout/keep-overflow` | warning | a block was let overflow the bottom of the page to keep keeps (`--compat antenna`) | — |
| `layout/condense-overflow` | error | the content of `overflow="condense"` does not fit even when condensed | — |
| `layout/condense-capped` | warning | inner containers of nested `overflow="condense"` were not condensed because of the measurement limit | — |
| `layout/condense-height-unknown` | warning | `overflow="condense"` was not applied because the height is not determined | — |
| `layout/marker-misplaced` | warning | `fo:retrieve-marker` or `fo:retrieve-table-marker` is written where it cannot be used | — |
| `layout/table-header-not-repeated` | warning | the table header and footer are taller than the page and were not repeated on continuation pages | — |
| `layout/missing-id` | warning | the id of a page number reference or bookmark destination is missing (gathered per kind in `warnings`) | `id`, `kind` |
| `layout/index-key-missing` | warning | nothing has the index key (`ref-index-key`) | `key` |
| `layout/not-converged` | warning | page number references, the index or the last-page master did not converge | `what` |
| `layout/max-pages-reached` | info | layout stopped after the first `maxPages` pages (`--max-pages`) | `maxPages` |
| `layout/beyond-max-pages` | warning | layout stopped after the first `maxPages` pages, so page number references, the total page count, the index or bookmarks pointing beyond them could not be resolved (one per kind; references are set as `"?"`) | `maxPages`, `kind`, `count`, `ids` |
| `limit/measure-nesting` | warning | boxes sized by content and multi-column containers are nested too deeply; they were laid out without measuring | — |
| `limit/table-row-span` | warning | row spans of table cells beyond the limit were not applied | — |
| `limit/table-columns` | warning | an HTML table has more columns (the sum of `col` and `colgroup` `span`s) than the limit (1,000), so the excess columns were dropped (one per table) | `limit` |
| `limit/table-structure-cells` | warning | in the tagged PDF table structure, the empty cells that even out the rows exceed the limit (the number of cells in the document or 10,000, whichever is larger), so in those tables each row got a single empty cell spanning the missing columns (`ColSpan`) | `tables` |
| `limit/link-description` | warning | the description (`Contents`) of link annotations in a tagged PDF was cut at the length limit (2,000 characters) | `links` |
| `pdf/glyph-not-drawn` | error | some characters cannot be drawn in the PDF (they are not drawn) | `font` |
| `pdf/notdef-not-drawn` | error | characters with no glyph (.notdef) were not drawn for PDF/A, PDF/UA-1 or PDF/X-4 | `font` |
| `pdf/svg-links-capped` | warning | too many SVG links on one page; the rest were not made into links | — |
| `pdf/foreign-object-approximated` | warning | the content of an SVG foreignObject was drawn as approximate text only | — |
| `pdf/form-field-failed` | warning | a form field could not be created (only its drawn frame is kept) | `field` |
| `pdf/color-glyph-image` | error | an image of a color glyph could not be embedded in the PDF | — |
| `pdf/color-glyph-svg` | warning | some glyphs of the SVG table cannot be made into shapes (drawn with outlines) | `font` |
| `pdf/color-glyph-plus` | warning | the PLUS compositing of color glyphs was drawn as normal overlap | — |
| `png/image-not-drawn` | error | `renderPageToPng` did not draw images that cannot be decoded to pixels (CMYK JPEG, interlaced PNG and so on) | `src` (for images inside SVG, the `src` of the SVG image that contains them) |
| `png/image-limit` | error | `renderPageToPng` decoded more image pixels on one page than the limit (400 million pixels in total), so the remaining images were not drawn | `src` (for images inside SVG, the `src` of the SVG image that contains them) |
| `png/raster-budget` | error | `renderPageToPng` took more than the limit to rasterize the page, so the remaining shapes, glyphs and images were not drawn (SVG images that could not be finished are drawn as placeholder boxes) | — |
| `png/layer-limit` | warning | `renderPageToPng` would have held more layer pixels at once (offscreen layers for nested opacity groups and masks, clips included) than the limit (8 times the page's pixels but not less than 16 million, and at most 64 million pixels), so opacity groups were drawn without a layer (the opacity applied to each shape inside) or composited as far as drawn and then continued (overlaps inside get darker either way), and masks and color glyph compositing that could not grow were not drawn (growing layers are counted by the size they actually grow to) | — |
| `png/clip-limit` | warning | `renderPageToPng` would have held more clip coverage and layer pixels at once (for nested clips) than the limit (the same as for `png/layer-limit`; a clip pixel counts as a quarter of a layer pixel), so a deeper clip that encloses the outer clip was drawn with the outer clip only (its own edge was not applied), and the contents of other deeper clips were not drawn (the outermost clip is kept even beyond the limit) | — |
| `canvas/svg-not-drawn` | error | `renderPage` in a Web Worker would have spent more than the limit rasterizing an SVG image, so a placeholder frame was drawn instead | `src` |
| `pdfx/transparency` | warning | transparency was used in a PDF/X (X-3) that does not allow it | — |
| `pdfx/rasterized` | warning | areas were rasterized to flatten transparency | — |
| `pdfx/spot-in-raster` | warning | spot colors lie in rasterized areas (they become their alternate CMYK) | — |
| `pdfx/text-in-raster` | warning | text lies in rasterized areas | — |
| `pdfx/icc-fallback` | info | the table of the ICC profile cannot be read; RGB was converted to CMYK with a formula | — |
| `pdfx/annotations-dropped` | info | annotations, links and form fields on the pages were not written for PDF/X | — |
| `pdfx/actions-dropped` | info | actions (external bookmark destinations, annotations with actions) were not written for PDF/X | — |
| `pdfx/check` | warning | the written PDF does not meet a GWG 2022 rule | — |
| `pdfx/embedded-pdf` | warning | a page of a PDF image does not meet the PDF/X requirements, so it was not embedded and a placeholder frame was drawn (what does not meet them is in `detail`) | `src`, `detail` |
| `pdfa/launch-dropped` | info | PDF/A does not allow Launch actions (`links.launch`) | — |
| `pdfa/cmyk-converted` | info | CMYK colors were converted to RGB for PDF/A (sRGB) | — |
| `pdfa/forms-dropped` | warning | form fields are not written for PDF/A (their drawn frames are kept) | — |
| `pdfa/attachments-dropped` | warning | attachments that are not PDF/A were not embedded for PDF/A | — |
| `pdfa/freetext-appearance` | warning | the appearance of FreeText annotations could not draw text for PDF/A | — |
| `pdfa/embedded-pdf` | warning | a page of a PDF image does not meet the PDF/A requirements, so it was not embedded and a placeholder frame was drawn (what does not meet them is in `detail`) | `src`, `detail` |
| `pdfua/missing-title` | warning | PDF/UA-1: the document has no title | — |
| `pdfua/missing-lang` | warning | PDF/UA-1: the document has no language | — |
| `pdfua/missing-figure-alt` | warning | PDF/UA-1: some figures have no alternate text | — |
| `pdfua/missing-formula-alt` | warning | PDF/UA-1: some formulas have no alternate text | — |
| `pdfua/heading-skipped` | warning | PDF/UA-1: heading levels are skipped | — |
| `pdfua/embedded-pdf` | warning | PDF/UA-1: a page of a PDF image uses fonts that are not embedded, so it was not embedded and a placeholder frame was drawn | `src`, `detail` |
| `snapshot/wait-timeout` | warning | `snapshotDocument` ran out of wait time (`timeoutMs`) and took the document as it was (`waiting` is what it was waiting for: `load`, `fonts`, `waitFor` or `animations`) | `waiting`, `ms` |
| `snapshot/iframe-skipped` | warning | `snapshotDocument` does not copy the document inside an `<iframe>` | `src` |
| `snapshot/canvas-tainted` | warning | `snapshotDocument` could not turn a canvas tainted by a cross-origin image into an image (it was left as a canvas) | `element` |
| `snapshot/canvas-too-large` | warning | `snapshotDocument` did not turn a canvas into an image because its pixel count (`imagePixels`) or PNG size (`fileBytes`) exceeded the limit, or the browser could not make a PNG (`size` is the pixel count or bytes) | `element`, `size`, `limit` |
| `snapshot/stylesheet-rule-removed` | warning | `snapshotDocument` kept rules that were in the source text of a `<style>` but removed through the CSSOM, as they cannot be removed from the text | `count` |
| `snapshot/blob-unreadable` | warning | `snapshotDocument` did not take in the content of a blob: URL because it could not be read (a revoked URL, etc.) or it exceeded the limit (`fileBytes`) | `url` |
| `snapshot/limit` | warning | `snapshotDocument` reached the limit on the total taken in (`snapshotBytes`), so later canvases, blob: contents and fonts were not taken in | `limit` |
| `snapshot/shadow-root-closed` | warning | `snapshotDocument` could not copy the content of a custom element that seems to have a closed shadow root (a guess; passing the root in `shadowRoots` copies it) | `element` |
| `snapshot/font-face-source-unknown` | warning | `snapshotDocument` did not take in a font added by JavaScript (`new FontFace`) because its content could not be obtained or it exceeded the limit (`fileBytes`) (it will be typeset with another font) | `family` |

## Error types and codes

Errors are thrown with the following types, all carrying `code` (table below). `isKumioriError(e)` is true for both `KumioriError` and `KumioriOptionError`. Unexpected exceptions from outside Kumiori are thrown as they are, without wrapping.

- `KumioriError`: the base (internal errors use this type). It may carry `args` and `source`
- `KumioriInputError`: the input cannot be read
- `KumioriLimitError`: stopped because a limit was exceeded
- `KumioriFontError`: fonts cannot be read, or there are none
- `KumioriPdfError`: the PDF does not or cannot meet PDF/X, PDF/A or PDF/UA
- `KumioriOptionError`: an invalid option. It extends `TypeError` as before (it is not a subclass of `KumioriError`), and carries the name of the option in `option`
- `AreaTreeFormatError` (the error of `parseAreaTree`) is a subclass of `KumioriInputError`
- When stopped with a stop signal (`signal`), `signal.reason` is thrown as is, not one of Kumiori's error types (a `DOMException` named `AbortError` when `abort()` was called without a reason; tell it apart with `e.name === 'AbortError'`). It has no `code`, and `isKumioriError(e)` is false. An error thrown by `onProgress` is also passed on as is

| Code | Type | Meaning |
|---|---|---|
| `api/invalid-option` | `KumioriOptionError` | the value of an option cannot be used |
| `input/xml-parse` | `KumioriInputError` | parsing XML (XSL-FO, XHTML) failed |
| `input/not-xsl-fo` | `KumioriInputError` | no `fo:root` (not XSL-FO) |
| `input/not-zip` | `KumioriInputError` | not a zip, or a ZIP64 archive |
| `input/zip-entry` | `KumioriInputError` | a zip entry cannot be read |
| `input/not-epub` | `KumioriInputError` | not an EPUB, or its OPF cannot be read |
| `area-tree/format` | `KumioriInputError` | the shape of an Area Tree (JSON) is wrong |
| `limit/nesting-depth` | `KumioriLimitError` | XSL-FO elements are nested too deeply |
| `limit/entity-expansion` | `KumioriLimitError` | the expansion of XML internal entities is too large or too deep |
| `limit/transform-nesting` | `KumioriLimitError` | rotated or transformed areas are nested too deeply |
| `limit/zip-size` | `KumioriLimitError` | the uncompressed size of a zip exceeds the limit |
| `limit/zip-entries` | `KumioriLimitError` | too many zip entries or EPUB spine items |
| `font/load-failed` | `KumioriFontError` | a default font cannot be read or fetched |
| `font/none-registered` | `KumioriFontError` | no font is registered |
| `font/broken-file` | `KumioriFontError` | a font file is broken (the caller usually makes it a warning) |
| `pdf/tagged-incompatible` | `KumioriPdfError` | tagged PDF or PDF/UA-1 was combined with a PDF/X that flattens transparency |
| `pdfua/requires-tagged` | `KumioriPdfError` | PDF/UA-1 needs the structure tree (tagged PDF) |
| `pdfx/profile-required` | `KumioriPdfError` | an output ICC profile (CMYK) is needed (X-4, and X-1a and X-3 when the printing condition is not in the ICC registry), or it is not CMYK |
| `pdfx/profile-invalid` | `KumioriPdfError` | the output ICC profile is of the wrong kind (X-4 needs an output device profile (prtr), X-1a needs an AtoB1 table (A2B1)), or its header and tag table do not follow the ICC.1 format (including a missing desc description tag) |
| `pdfx/not-conforming` | `KumioriPdfError` | the PDF does not meet PDF/X and cannot be written as PDF/X |
| `pdfx/flatten-failed` | `KumioriPdfError` | transparency that cannot be flattened remains |
| `pdfa/not-conforming` | `KumioriPdfError` | the PDF does not meet PDF/A and cannot be written as PDF/A |
| `internal/patch-mismatch` | `KumioriError` | the version of pdf-lib or fontkit changed and a patch does not fit |
| `internal/page-sealed` | `KumioriError` | commands were added to a page already written (an internal error) |
