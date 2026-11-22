<p align="center"><img src="assets/logo/kumiori-logo.svg" alt="Kumiori 組み織り" width="480"></p>

<p align="center"><b>A library for Japanese typesetting, refined with AI.</b></p>

<p align="center"><a href="README.md">日本語</a> · English (a translation; the Japanese text is the original)</p>

# Kumiori (組み織り)

Kumiori is a typesetting engine that lays out the pages of books and documents from HTML+CSS and XSL-FO.
It sets Japanese text — vertical writing, ruby, line-breaking rules (kinsoku) and more — following the standards.
It runs both in the browser and in Node, and outputs a Canvas preview and PDF.

## Highlights

- **Japanese typesetting by the standards** — vertical writing, ruby, tate-chu-yoko, kinsoku, punctuation compression and warichu, based on W3C's JLREQ.
- **All the way to PDF, inside the browser** — no server and no other typesetting software needed. Everything from layout to writing the PDF happens inside the browser, and documents are never sent out. The same engine also runs in Node.
- **HTML+CSS and XSL-FO** — interprets CSS Paged Media and GCPM, and XSL-FO 1.1, with its own engine rather than the browser's rendering.
- **PDF for print and archiving** — font embedding, trim marks, PDF/X, PDF/A, tagged PDF and PDF/UA-1.
- **Many languages and scripts** — right-to-left scripts, Thai and Indic scripts, vertical Mongolian and more.
- **Built from the specifications, refined with AI** — implemented from the definitions in the specifications and compared against published sample PDFs. Much of the code is written by AI ([Claude Code](https://claude.com/claude-code)); people decide and check.

## Getting started

**In the web app** — open <https://n-lights-co.github.io/kumiori/>, choose an HTML, XSL-FO or EPUB file and press "Save PDF" (PDF を保存).
Typesetting happens inside the browser; documents are never sent out ([Using the web app](docs/en/app.md)).

**On the command line** — turn documents into PDF from Node, without a browser. It also handles batch conversion, SVG and PNG per page, and diagnostics for CI ([command reference](docs/en/cli.md)).

```bash
npx kumiori book.html -o book.pdf     # or install it: npm install -g kumiori
```

**As a library** — typeset from your own program ([library guide](docs/en/library.md)).

```ts
import { typeset } from 'kumiori';   // npm install kumiori

const result = await typeset(html, { name: 'book.html' });
const pdf = await result.toPdf();    // Uint8Array
```

The default fonts (Noto Serif JP and others) are not included in the package; they are fetched from Google Fonts on first run (the Node CLI saves them to a local cache and reuses them; see [Fonts](docs/en/fonts.md)).

## Features

| Area | Main features |
| --- | --- |
| Input | HTML+CSS, XSL-FO (with part of Antenna House's `axf:*` extensions), EPUB (web app), images (PNG, JPEG, SVG, EPS, CGM, WMF and more), draw.io diagrams |
| Japanese typesetting | vertical and horizontal writing, ruby, tate-chu-yoko, emphasis marks, warichu, kinsoku, hanging punctuation and pushing out, punctuation compression, spacing between Japanese and Latin text |
| Other scripts | Arabic and Hebrew, Thai, Indic and Southeast Asian scripts, Hangul, Chinese, Mongolian, hyphenation |
| Pages | page masters, running heads and folios, footnotes, columns, floats, tables across pages, page number references |
| Output | Canvas, PDF (bookmarks, links, forms, trim marks), tagged PDF and PDF/UA-1, PDF/X and PDF/A, SVG and PNG per page |
| Environments | browser (with a bundler, or as a single file from a CDN) and Node |

PDF/X-1a and PDF/X-4 were built from, and checked for conformance against, the texts of the standards (ISO 15930-1, ISO 15930-7). The written PDF is also checked against their rules. Before submitting the output, check it with a preflight tool.
PDF/A has not yet been checked against the text of its standard, so check it with a validator before archiving it.
The fonts each script needs, the image formats, the details of the PDF/X standards and more are in the [feature list](docs/en/features.md).

## Documentation

| Document | Contents |
| --- | --- |
| [Features](docs/en/features.md) | detailed list of features (input, Japanese typesetting, other scripts, pages, output) |
| [Using the web app](docs/en/app.md) | opening, saving, settings, warnings |
| [Command reference](docs/en/cli.md) | options, examples, environment variables, exit status |
| [Library guide](docs/en/library.md) | `typeset` options; PDF, Canvas, SVG, PNG; Web Worker; Node helpers |
| [API reference](https://n-lights-co.github.io/kumiori/api/) | every function, type and option (generated from the type declarations; Japanese only) |
| [Conformance Guide](docs/en/conformance.md) | support and handling of each item of the specifications |
| [Diagnostics](docs/en/diagnostics.md) | codes and severities of warnings and errors |
| [Fonts](docs/en/fonts.md) | default fonts and their licenses, cache, offline use |
| [draw.io diagrams](docs/en/drawio.md) | placing diagrams, choosing pages |
| [Architecture](docs/en/architecture.md) · [Area Tree](docs/en/area-tree.md) | how it works inside and the role of each file; the shape of the typeset result |
| [Development and testing](docs/en/development.md) | how Kumiori is developed, running it locally, tests, comparison with samples |
| [Changelog](CHANGELOG.en.md) · [Releasing](docs/en/RELEASING.md) | changes in each version, how to release |

## Requirements

Node 20.19.0 or later in the 20 line, or 22.12.0 or later (CI tests with 20.19.0 and 22).

## License

The code is under the [Apache License 2.0](LICENSE) (Copyright 2026 Northern Lights Co.; see [NOTICE](NOTICE)).
The fonts for typesetting are not bundled (for the fonts and their licenses, see [Fonts](docs/en/fonts.md)).
The licenses and copyright notices of the third-party software Kumiori uses (pdf-lib, pako, utif, hyphen and others) are collected in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Reporting vulnerabilities

Please do not post it in a public issue. Report it privately as described in [SECURITY.en.md](SECURITY.en.md).

## Relationship to other companies' products

Kumiori is an independent project, unrelated to Antenna House's products or to typesetting software such as WeasyPrint and Vivliostyle. It has not received approval or support from these companies or projects.

Kumiori is also not affiliated with draw.io (JGraph Ltd, draw.io AG); draw.io is a registered trademark. The feature that reads draw.io diagram files was built by porting draw.io's public source code (section 13 of `THIRD_PARTY_NOTICES.md`), and is not approved or supported by draw.io.

The product and company names appearing in the README and docs are the trademarks or names of their respective owners. These names are used to describe the compatibility features (import of the `axf:*` extensions, the default values of `--compat antenna`, etc.) and the feature that reads draw.io diagram files (`.drawio`, `.dio`).
