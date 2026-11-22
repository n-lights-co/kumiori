> 日本語: [../features.md](../features.md)

# Features

Kumiori's features, by category. The support status of each property, with the specification's definition and how Kumiori handles it, is in the Conformance Guide ([`docs/en/conformance.md`](conformance.md)).
Features not yet available and known limitations are in [`docs/en/BACKLOG.md`](BACKLOG.md).

## Input

| Kind | Contents |
| --- | --- |
| HTML+CSS | Read with Kumiori's own CSS cascade (no browser needed) |
| XSL-FO | XSL-FO 1.1. Supports part of Antenna House's `axf:*` extensions, focusing on the commonly used ones |
| EPUB | Can be opened in the web app (browser) ([`docs/en/app.md`](app.md)) |
| Images | PNG, JPEG, GIF, BMP, TIFF, WebP, SVG, WMF, EMF, EPS (PostScript), CGM |
| Diagrams | draw.io diagrams (`.drawio`, `.dio`; [`docs/en/drawio.md`](drawio.md)) |

Image formats can be added with plugins ("Plugins" in [`docs/en/library.md`](library.md)).

## Japanese typesetting

- Vertical and horizontal writing
- Ruby, tate-chu-yoko, emphasis marks (kenten)
- Line-breaking rules (kinsoku), hanging punctuation and pushing out, punctuation compression, spacing between Japanese and Latin text
- Warichu (inline cutting notes)

Warichu is written with the Kumiori extensions `-kumiori-warichu` in CSS and `kumiori:warichu` in XSL-FO, because neither the standards nor the extensions of other formatters have a way to write it.
It is described in section 9.2 of the HTML and CSS volume and section 4.6 of the XSL-FO 1.1 volume of the Conformance Guide.

## Other scripts

| Script or language | How it is set |
| --- | --- |
| Right-to-left scripts such as Arabic and Hebrew | Reordered with the Unicode Bidirectional Algorithm (UAX #9); Arabic letters take their joined forms. CSS `direction: rtl`, XSL-FO `writing-mode="rl-tb"` |
| Thai | Wrapped at word boundaries found with the dictionary of the runtime's `Intl.Segmenter` |
| Devanagari (Hindi and others) | Conjuncts and other shaping by the font |
| Other Indic scripts | Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala |
| Southeast Asian scripts and Tibetan | Lao, Khmer, Burmese (Myanmar script), Tibetan |
| Mongolian script | Horizontal and vertical |
| Korean and Chinese | Hangul; Simplified and Traditional Chinese |
| Vietnamese, Greek, Cyrillic | Can be set with the default Latin fonts |
| Hyphenation | English, Latin, Russian, Ukrainian, Modern Greek |
| Mixed Japanese and Latin text | Set with spacing between Japanese and Latin text |

About fonts:

- Fonts for Arabic, Thai, Devanagari, Hangul, Simplified and Traditional Chinese, color emoji and other scripts are not among the default fonts; pass them with `--font` or `fonts`.
- Many Chinese characters are also in the default Japanese fonts (Noto Serif JP, Noto Sans JP), but in Japanese glyph shapes, and many characters used only in Simplified Chinese are missing. For Chinese text, pass a Chinese font.
- Monochrome emoji can be set with the default Noto Emoji.
- Color emoji fonts are typeset in color.
- Hebrew, Greek, Cyrillic and Vietnamese letters can be set with the default Latin fonts.

A table of the font each language and script needs, how it wraps, vertical writing and limitations is in the section "Supported languages and scripts" of the Conformance Guide (section 5.6 of the XSL-FO 1.1 volume, section 5.8 of the HTML and CSS volume).
The same section has typeset samples for each script (Article 1 of the Universal Declaration of Human Rights set in the font of each script). Samples of variable fonts and emoji are in sections 5.6 and 5.7 of the HTML and CSS volume.

## Pages

- Page masters, running heads and page numbers (folios)
- Footnotes, multi-column layout, floats
- Tables (splitting across rows and pages, repeated headers, automatic column width)
- Page number references

## Output

| Output | Contents |
| --- | --- |
| Canvas | The on-screen preview |
| PDF | Subset font embedding, bookmarks, links, annotations, forms, trim marks |
| Tagged PDF, PDF/UA-1 | Structure and reading order of headings, paragraphs, lists, figures, links, tables and footnotes; alternate text for figures; language (`--tagged`, `--pdfua`) |
| PDF/X | PDF/X-1a, PDF/X-3 and PDF/X-4 marking, with conversion of RGB colors and images to CMYK (`--pdfx`) |
| PDF/A | PDF/A-2b and PDF/A-3b marking for long-term archiving (`--pdfa`) |
| SVG, PNG | Written page by page |
| JSON | The logical tree can be saved as JSON (web app) |

PDF/X-1a and PDF/X-4 were built from, and checked for conformance against, the texts of the standards (ISO 15930-1, ISO 15930-7). The written PDF is also checked against their rules. Before submitting the output, check it with a preflight tool.
PDF/A has not yet been checked against the text of its standard, so conformance is not guaranteed. Check it with a validator before archiving it.
The texts of the standards that were checked, and what the checks cover, are in "PDF/X and PDF/A" in [`docs/en/library.md`](library.md).

## Environments

| Form | Contents |
| --- | --- |
| Web app (browser) | Built with Vite. All typesetting happens inside the browser ([`docs/en/app.md`](app.md)) |
| Node CLI | `kumiori` (`dist-cli/cli.js` in this repository; [`docs/en/cli.md`](cli.md)) |
| Library | Runs both in the browser and in Node. There is also a single file for browsers without a bundler ([`docs/en/library.md`](library.md)) |
