> English translation of [CHANGELOG.md](CHANGELOG.md) (the Japanese text is the original).

# Changelog

Version numbers follow [Semantic Versioning](https://semver.org/). During 0.x, incompatible changes may also be released in a minor version (such as 0.2.0).

## 0.1.0 (2026-11-08)

The first public release.

- **Input**: HTML+CSS (own CSS cascade), XSL-FO 1.1 (supports part of Antenna House's `axf:*` extensions, focusing on the commonly used ones), JSON logical tree
- **Japanese typesetting**: vertical and horizontal writing, ruby, tate-chu-yoko, emphasis marks (kenten), line-breaking rules (kinsoku), hanging punctuation and pushing out, punctuation compression, spacing between Japanese and Latin text (JLREQ)
- **Pages**: page masters, running heads and page numbers (folios), footnotes, multi-column layout, floats, tables (splitting, repeated headers, automatic column width), page number references, bookmarks, links, annotations, forms
- **Output**: Canvas preview, PDF (subset font embedding, trim marks, PDF/X-3 marking)
- **Other scripts**: right-to-left scripts such as Arabic and Hebrew (UAX #9, joined forms of Arabic letters), Latin hyphenation
- **Usage**: the browser web app, the Node CLI `kumiori` (`--help`, `--version`, `--lang ja|en` and `KUMIORI_LANG` for English messages, a cache for the default fonts, warnings for unsupported CSS and XSL-FO), the library (`kumiori`: ES module; `kumiori/browser`: a single file for browsers with the dependencies bundled)
- **Documentation**: the Conformance Guide (HTML and CSS volume, XSL-FO volume; Japanese and English editions), the Area Tree JSON specification, and English versions of the README and docs (README.en.md, docs/en/)
