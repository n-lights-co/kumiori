> English translation of [CHANGELOG.md](CHANGELOG.md) (the Japanese text is the original).

# Changelog

Version numbers follow [Semantic Versioning](https://semver.org/). During 0.x, incompatible changes may also be released in a minor version (such as 0.2.0).

## Unreleased

Changes that will go into the next version. When it is released, the heading becomes the version number and the release date ([`docs/en/RELEASING.md`](docs/en/RELEASING.md)).

- **HTML+CSS typesetting**:
  - Added support for flex shrinking (`flex-shrink`, automatic minimum size), reversed directions (`row-reverse`, `column-reverse`, `wrap-reverse`), baseline alignment (`align-items: baseline`, `last baseline`), cross-axis `margin: auto`, `order`, growing, shrinking and wrapping in column containers, and vertical-writing containers (Flexbox 1)
  - Added support for `visibility: hidden` and `collapse`, `aspect-ratio`, `auto` left and right margins on boxes with a fixed width and right-to-left containing blocks, and page names chosen by `page` (absolutely positioned and floated boxes do not change the name)
  - CSS referenced by the document over `http(s):` (`<link rel="stylesheet">`, `@import`) and the fonts of its `@font-face` rules are now fetched (only those whose `unicode-range` overlaps the characters of the document). This can be turned off with `fetchStyles` in the library and `--no-fetch-styles` in the command
  - WOFF and WOFF2 can now be used as font files (`--font`, `files`, `fonts`, `@font-face`; converted back to sfnt and embedded)
  - Properties that do not matter for print (`cursor`, `user-select`, `will-change`, etc.) are no longer reported as unsupported
- **XSL-FO typesetting**: In collapsed-border tables, the borders between a table header or footer repeated after a page break and the first or last row on that page are now chosen again from the borders of the adjoining rows (XSL-FO 1.1 §6.7.3, §6.7.10)
- **PDF**: The ToUnicode entries of ligature glyphs (such as fi) now map to the original sequence of characters (text search and copy give the original characters)
- **Library**: Added `resolveResource` (a function that returns the contents of files referenced by the document or CSS that are not in `files`). Added the Node components `kumiori/node` (`createFontLoader`, `createFileResolver`, `defaultFontCacheDir`)
- **Node command**: Files referenced by the document or CSS with a `file:` URL are now read even outside the input directory
- **Publishing**: Added a workflow (`.github/workflows/conformance-pdf.yml`) that attaches the four PDFs of the conformance documents (Japanese and English) to a release when it is published

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
- **Usage**: the browser web app, the Node CLI `kumiori` (`--help`, `--version`, `--lang ja|en` and `KUMIORI_LANG` for English messages, a cache for the default fonts, warnings for unsupported CSS and XSL-FO), the library (`kumiori`: ES module; `kumiori/browser`: a single file for browsers with the dependencies bundled)
- **Documentation**: the Conformance Guide (HTML and CSS volume, XSL-FO volume; Japanese and English editions), the Area Tree JSON specification, and English versions of the README and docs (README.en.md, docs/en/)
