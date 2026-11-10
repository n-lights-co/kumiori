> English translation of [CHANGELOG.md](CHANGELOG.md) (the Japanese text is the original).

# Changelog

Version numbers follow [Semantic Versioning](https://semver.org/). During 0.x, incompatible changes may also be released in a minor version (such as 0.2.0).

## 0.2.0 (unreleased)

A release that adds flex features, WOFF/WOFF2, an API for loading referenced files, and more. While in 0.x, it is a minor release because it includes fixes that change typesetting results.

- **flex** (Flexbox 1; the CLI and the default layout path):
  - Shrinking (`flex-shrink`, the automatic minimum size of `min-width: auto`), the growth limit (stop at `max-width` and share the rest), growing when the sum of `flex-grow` is below 1
  - Reversed directions (`row-reverse`, `column-reverse`, `wrap-reverse`), containers with `direction: rtl`, vertical-writing containers
  - Alignment: `baseline` and `last baseline`, cross-axis `margin: auto`, `start`, `end`, `left`, `right`, `safe` and `unsafe` for `justify-content`, `align-content` for wrapping containers
  - Column direction: `row-gap`, `flex-basis`, `flex-shrink`, `flex-wrap` (wrapping into columns), growing in containers with a definite height
  - `order` also applies to `::before`, `::after` and children of `display: contents`; text directly inside a container becomes an anonymous item
  - Percentages in `gap`, `min-content` and `fit-content` for `flex-basis`, items with `visibility: collapse` (struts)
- **CSS**:
  - Supports `visibility` (`hidden`, `collapse`) and `aspect-ratio`
  - The horizontal margins of boxes with a definite width follow CSS 2.1 §10.3.3 (in a containing block with `direction: rtl`, boxes are placed from the right edge; a single `auto` margin takes the remaining space at layout time)
  - Collapsing of the bottom margin of the last child of a box with `min-height` follows CSS 2.1 §8.3.1
  - For a `display: block` image with both `width` and `max-width`, the wrapping box now has the width of the image
  - Named pages: no first page is created for boxes outside the flow alone (absolutely positioned, floats, etc.) (CSS Page 3 §8.1)
  - Properties that have no effect in print (`cursor`, `transition-*`, etc.) are no longer reported as unsupported CSS
- **Links and bookmarks**: `<a href>` on blocks, flex containers and tables makes the whole box a link; relative-reference links (GoToR for PDFs, Launch for other files); `h1` to `h6` become bookmarks with every default style (CSS GCPM 3 Appendix B)
- **Tables**: in tables with `border-collapse: collapse`, the border between a table header or footer repeated at a page break and the adjacent row is chosen again from the borders on both sides (XSL 1.1 §6.7.10, CSS 2.1 §17.6.2.1)
- **Fonts**: reads WOFF and WOFF2 (including font collections) (`--font`, `fonts`, `@font-face`); fonts referenced by `@font-face` over `http(s):` are also fetched (only those whose `unicode-range` overlaps the characters of the document)
- **PDF**: in ToUnicode, ligature characters (U+FB01 etc.) map to the original character sequences (fi etc.), so text extraction and search find words such as "confiance"
- **API**:
  - `resolveResource(url)`: asks for files referenced by the document or CSS that are not in `files`
  - `fetchStyles`: fetches CSS referenced by the document over `http(s):` (including `@import` targets; default `true`)
  - `kumiori/node`: `createFontLoader` (the same default-font loading and cache as the CLI), `createFileResolver` (reads `file:` references), `defaultFontCacheDir`, `looksLikeFont`
- **CLI**: reads references given as `file:` URLs; `--no-fetch-styles` disables fetching CSS
- **Robustness against broken or crafted input** (input that used to hang or crash the process now makes only that image or declaration unreadable; the limits and their rationale are in the source comments):
  - Layout: fixed a hang when a paragraph beside a narrow float gap directly follows a table with `border-collapse: collapse` and an outer border. As a consequence, a box moved below a float (`clear` etc.) right after such a table is now placed exactly at the bottom edge of the float (it used to overlap it by half the border width; CSS 2.1 §9.5.2)
  - XSL-FO: `fo:retrieve-marker` and `fo:marker` inside `fo:marker` are skipped and reported (XSL 1.1 §6.13.5, §6.13.6); an FO document whose elements nest 250 levels or deeper fails with a clear error
  - Math: no crash on extreme `scriptlevel` (math-depth is clamped to ±100; MathML Core 4.5), long `mtext`, very many children or deep nesting (up to 300 levels)
  - HTML and CSS: no crash on `attr()` without arguments, cyclic or exploding `@import`, multiply nested `var()`, huge `colspan`, `rowspan` and `<col span>` (the HTML limits of 1000 and 65534), huge `repeat()` (up to 10000 columns), or overlong counter representations (the fallback style is used beyond 1000 characters; CSS Counter Styles 3 §2). Elements nested deeper than 128 levels are read as following siblings of their ancestor at level 128. An image URL that could not be fetched is tried only once (the image list of the import report no longer contains duplicates)
  - SVG: no hang on path data with numbers after `Z`, multiplicative expansion of `use`, marker, pattern and mask (up to the number of elements + 500,000 visits), or a long `<style>`
  - WMF, EMF and CGM: point counts, character counts and color table sizes are bounded by the record length; the images of one document may total up to 64 million pixels
  - JPEG, TIFF and CCITT: bounded number of scans (up to 500), number of IFD values, and search cost of two-dimensional rows
  - EPS (PostScript): limits on VM usage (512 MB; VMerror beyond it), the total number of path points (5 million; limitcheck beyond it), the amount a filter buffers (16 MB), image mask dimensions, the per-pixel cost of mesh shadings, `resourceforall` template matching, `search`, and the length given to `StartData`
  - Output: `renderPage` no longer throws on a page that uses a font whose no-break space (U+00A0) glyph cannot be read; one broken data URI or `@font-face` URL no longer makes the whole `typeset` call fail; the CLI skips unreadable directories below the input directory
- **Documents**: corrected the line count and test count in the README, the step numbers in the release procedure, and statements in the Conformance Guides, plans and other documents that disagreed with the implementation or between the Japanese and English versions
- **Publishing**: the PDFs of the Conformance Guides (four volumes, Japanese and English) are attached to the GitHub release of each version; the "Typesetting" row of the colophon shows the Kumiori version used to typeset them
- **Third-party notices**:
  - Added notices for code bundled in the @pdf-lib/fontkit distribution (Brotli decoding, base64-js, buffer, etc.)
  - Added notices for the rules copied from CSS GCPM 3 Appendix B (section 10)
  - Every output JS file starts with a comment giving the Kumiori version, its license and where `THIRD_PARTY_NOTICES.md` is (for loading a single file from a CDN)
  - The README of the Conformance Guides states the fonts embedded in their PDFs and the fonts' licenses

## 0.1.1 (2026-11-09)

A release that completes the notices for third-party software and documents. Typesetting behaviour and the API are the same as in 0.1.0.

- **Third-party notices** (`THIRD_PARTY_NOTICES.md`, also included in the `dist-lib`, `dist-cli` and `dist-browser` distributions):
  - Added the copyright notices and licenses (including the full text of the W3C Document License) for the default style sheet rules copied from W3C documents (CSS Ruby 1 Appendix A.1 and CSS 2.1 Appendix D)
  - Stated that part of the WebP decoding code is derived from libwebp (the libwebp notice has been included since 0.1.0)
  - Added the distribution terms of the Adobe font metrics (AFM) for the standard 14 fonts, included in @pdf-lib/standard-fonts
  - Corrected the description of which distributions bundle the dependencies (`dist-browser` also bundles @xmldom/xmldom; `dist-lib` bundles none)
- **README**: states that `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are included in the output of all four builds
- **Documents**: the "Sources" appendix of the Conformance Guides (Japanese and English) now gives the version, copyright notice and full license text of each quoted W3C specification

## 0.1.0 (2026-11-08)

The first public release.

- **Input**: HTML+CSS (own CSS cascade), XSL-FO 1.1 (supports part of Antenna House's `axf:*` extensions, focusing on the commonly used ones), JSON logical tree
- **Japanese typesetting**: vertical and horizontal writing, ruby, tate-chu-yoko, emphasis marks (kenten), line-breaking rules (kinsoku), hanging punctuation and pushing out, punctuation compression, spacing between Japanese and Latin text (JLREQ)
- **Pages**: page masters, running heads and page numbers (folios), footnotes, multi-column layout, floats, tables (splitting, repeated headers, automatic column width), page number references, bookmarks, links, annotations, forms
- **Output**: Canvas preview, PDF (subset font embedding, trim marks, PDF/X-3 marking)
- **Other scripts**: right-to-left scripts such as Arabic and Hebrew (UAX #9, joined forms of Arabic letters), Latin hyphenation
- **Usage**: the browser web app, the Node CLI `kumiori` (`--help`, `--version`, `--lang ja|en` and `KUMIORI_LANG` for English messages, a cache for the default fonts, warnings for unsupported CSS and XSL-FO), the library (`kumiori`: ES module; `kumiori/browser`: a single file for browsers with the dependencies bundled; the `lang` option for English warnings)
- **Documentation**: the Conformance Guide (HTML and CSS volume, XSL-FO volume; Japanese and English editions), the Area Tree JSON specification, and English versions of the README and docs (README.en.md, docs/en/)
