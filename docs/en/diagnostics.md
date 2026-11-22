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
| `api/setup-option-ignored` | warning | a `createTypesetter` option (fonts) was passed in the per-document options (it is not used) | `option` |
| `api/unknown-diagnostic-code` | warning | `diagnostics.ignore` or `--ignore-warning` names something that is not a diagnostic code (nothing is suppressed for it) | `code` |
| `resource/not-fetched` | info | an image, stylesheet or font was not fetched because of `fetchImages` or `fetchStyles` | `url`, `kind` |
| `resource/fetch-failed` | warning | a stylesheet or font could not be fetched | `url`, `kind` |
| `resource/attachment-not-found` | warning | the file of a file attachment annotation is not in `files`, or the reference points outside the document's location (a URL such as `file:`, an absolute path, or a path going up with `..`), so it was not attached (the message tells which) | `file` |
| `link/action-dropped` | warning | the action of a link out of the document was not written because of `links` (the text is typeset) | — |
| `fo/unsupported` | warning | an unsupported XSL-FO element, property or value was ignored (one per item) | `item` |
| `css/unsupported` | warning | an unsupported CSS property, value or rule was ignored (one per item) | `item` |
| `css/unknown-property` | warning | an unknown CSS property was ignored (misspelled or unsupported) | `property` |
| `css/invalid-attr-value` | warning | a declaration whose value is invalid after `attr()` substitution was ignored | — |
| `css/unreferenced-stylesheet` | info | a stylesheet not referenced from the document was not applied | — |
| `font/face-not-found` | warning | the font file of an `@font-face` was not found (the next font is used) | `font`, `url` |
| `limit/nesting-depth` | warning | elements are nested too deeply; the deep ones were laid out at a shallower level | — |
| `limit/css-import` | error | too much CSS is imported (`@import`); the rest was not read | `file` |
| `font/file-unreadable` | warning | a given font file (`fonts`, `@font-face`) cannot be read | `file`, `font` |
| `font/family-unreadable` | warning | the family name of a given font file cannot be read | `file` |
| `font/generic-not-loaded` | warning | a font named in `genericFonts` is not loaded | `font`, `generic` |
| `font/load-failed` | warning | a font the document needs (math, monospace, symbol, emoji) could not be loaded | `font` |
| `font/missing-glyph` | error | no loaded font has a glyph for a character (drawn as the missing-glyph box; one per character) | `char`, `codePoint` |
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
| `png/image-not-drawn` | error | `renderPageToPng` did not draw images that cannot be decoded to pixels (CMYK JPEG, interlaced PNG and so on) | `src` (none for images inside SVG) |
| `png/image-limit` | error | `renderPageToPng` decoded more image pixels on one page than the limit (400 million pixels in total), so the remaining images were not drawn | `src` (none for images inside SVG) |
| `png/raster-budget` | error | `renderPageToPng` took more than the limit to rasterize the page, so the remaining shapes, glyphs and images were not drawn (SVG images that could not be finished are drawn as placeholder boxes) | — |
| `png/layer-limit` | warning | `renderPageToPng` would have held more layer pixels at once (offscreen layers for nested opacity groups and masks, clips included) than the limit (8 times the page's pixels but not less than 16 million, and at most 64 million pixels), so deeper opacity groups were drawn without a layer (the opacity is applied to each shape inside, so overlaps inside get darker) and masks and color glyph compositing were not drawn | — |
| `png/clip-limit` | warning | `renderPageToPng` would have held more clip coverage and layer pixels at once (for nested clips) than the limit (the same as for `png/layer-limit`; a clip pixel counts as a quarter of a layer pixel), so a deeper clip that encloses the outer clip was drawn with the outer clip only (its own edge was not applied), and the contents of other deeper clips were not drawn | — |
| `canvas/svg-not-drawn` | error | `renderPage` in a Web Worker would have spent more than the limit rasterizing an SVG image, so a placeholder frame was drawn instead | `src` |
| `pdfx/transparency` | warning | transparency was used in a PDF/X (X-3) that does not allow it | — |
| `pdfx/rasterized` | warning | areas were rasterized to flatten transparency | — |
| `pdfx/spot-in-raster` | warning | spot colors lie in rasterized areas (they become their alternate CMYK) | — |
| `pdfx/text-in-raster` | warning | text lies in rasterized areas | — |
| `pdfx/icc-fallback` | info | the table of the ICC profile cannot be read; RGB was converted to CMYK with a formula | — |
| `pdfx/annotations-dropped` | info | annotations, links and form fields on the pages were not written for PDF/X | — |
| `pdfx/actions-dropped` | info | actions (external bookmark destinations, annotations with actions) were not written for PDF/X | — |
| `pdfx/check` | warning | the written PDF does not meet a GWG 2022 rule | — |
| `pdfa/launch-dropped` | info | PDF/A does not allow Launch actions (`links.launch`) | — |
| `pdfa/cmyk-converted` | info | CMYK colors were converted to RGB for PDF/A (sRGB) | — |
| `pdfa/forms-dropped` | warning | form fields are not written for PDF/A (their drawn frames are kept) | — |
| `pdfa/attachments-dropped` | warning | attachments that are not PDF/A were not embedded for PDF/A | — |
| `pdfa/freetext-appearance` | warning | the appearance of FreeText annotations could not draw text for PDF/A | — |
| `pdfua/missing-title` | warning | PDF/UA-1: the document has no title | — |
| `pdfua/missing-lang` | warning | PDF/UA-1: the document has no language | — |
| `pdfua/missing-figure-alt` | warning | PDF/UA-1: some figures have no alternate text | — |
| `pdfua/missing-formula-alt` | warning | PDF/UA-1: some formulas have no alternate text | — |
| `pdfua/heading-skipped` | warning | PDF/UA-1: heading levels are skipped | — |

## Error types and codes

Errors are thrown with the following types, all carrying `code` (table below). `isKumioriError(e)` is true for both `KumioriError` and `KumioriOptionError`. Unexpected exceptions from outside Kumiori are thrown as they are, without wrapping.

- `KumioriError`: the base (internal errors use this type). It may carry `args` and `source`
- `KumioriInputError`: the input cannot be read
- `KumioriLimitError`: stopped because a limit was exceeded
- `KumioriFontError`: fonts cannot be read, or there are none
- `KumioriPdfError`: the PDF does not or cannot meet PDF/X, PDF/A or PDF/UA
- `KumioriOptionError`: an invalid option. It extends `TypeError` as before (it is not a subclass of `KumioriError`), and carries the name of the option in `option`
- `AreaTreeFormatError` (the error of `parseAreaTree`) is a subclass of `KumioriInputError`

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
| `pdfx/profile-required` | `KumioriPdfError` | an output ICC profile (CMYK) is needed (X-4, and X-1a when the printing condition is not in the ICC registry), or it is not CMYK |
| `pdfx/profile-invalid` | `KumioriPdfError` | the output ICC profile is of the wrong kind (X-4 needs an output device profile (prtr), X-1a needs an AtoB1 table (A2B1)) |
| `pdfx/not-conforming` | `KumioriPdfError` | the PDF does not meet PDF/X and cannot be written as PDF/X |
| `pdfx/flatten-failed` | `KumioriPdfError` | transparency that cannot be flattened remains |
| `pdfa/not-conforming` | `KumioriPdfError` | the PDF does not meet PDF/A and cannot be written as PDF/A |
| `internal/patch-mismatch` | `KumioriError` | the version of pdf-lib or fontkit changed and a patch does not fit |
| `internal/page-sealed` | `KumioriError` | commands were added to a page already written (an internal error) |
