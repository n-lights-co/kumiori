> 日本語: [../development.md](../development.md)

# Development and testing

How Kumiori is developed, how to run it locally and how to test it. The release procedure is in [`docs/en/RELEASING.md`](RELEASING.md), and the changes in each version are in [`CHANGELOG.en.md`](../../CHANGELOG.en.md).

- [How Kumiori is developed](#how-kumiori-is-developed)
- [Running locally](#running-locally)
- [Tests](#tests)
- [Running the CI steps locally (npm run ci:local)](#running-the-ci-steps-locally-npm-run-cilocal)
- [Data fetched by the tests](#data-fetched-by-the-tests)
- [Checking tagged PDF (veraPDF)](#checking-tagged-pdf-verapdf)
- [Comparison with sample PDFs](#comparison-with-sample-pdfs)

## How Kumiori is developed

Kumiori is developed with an AI coding assistant (Anthropic's [Claude Code](https://claude.com/claude-code)).

- Much of the code, tests and documentation is written by the AI. People decide what to build and how to follow each specification.
- People check the typesetting results, direct the fixes, and review changes before they are merged.
- Specifications are interpreted by reading them and comparing Kumiori's output with published sample PDFs.
- Each time a feature is added, tests are added, and type checking, unit tests and browser integration tests are run.
- Third-party code and licenses are checked with tools before each release (see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)).

### Standards and specifications followed

Kumiori is implemented by reading the standards and specifications as thoroughly as possible, including XSL-FO 1.1, the CSS modules (Paged Media, GCPM, Writing Modes, Text, Ruby, Fragmentation and others), MathML Core, the Unicode UAX #9 (bidirectional text) and UAX #14 (line breaking), W3C's JLREQ (Requirements for Japanese Text Layout, based on JIS X 4051) and PDF (ISO 32000), and following their definitions.
The fine details of Japanese typesetting, such as punctuation compression, hanging punctuation and ruby overhang, are also based on these standards.
The support status of each property, with the specification's definition and how Kumiori handles it, is collected in the Conformance Guide ([`docs/en/conformance.md`](conformance.md)).

The interpretation of the specifications and the finer points of layout are checked by comparing Kumiori's output with sample PDFs that XSL-FO and CSS typesetting tools have published ([Comparison with sample PDFs](#comparison-with-sample-pdfs)).

## Running locally

```bash
npm install
npm run dev          # http://localhost:5173  (preview + "Save PDF")
npm run build        # type check + production build (dist/; the web app)
npm run build:dist   # build the library (dist-lib), the Node CLI (dist-cli) and the single browser file (dist-browser) together
npm run docs:api     # the API reference (dist/api/)
```

Node 20.19.0 or later in the 20 line, or 22.12.0 or later, is required (for the reasons, see "Package entry points and requirements" in [`docs/en/library.md`](library.md)).
The role of each source file is described in [`docs/en/architecture.md`](architecture.md).

### Build output and license notices

The output of `npm run build`, `npm run build:cli`, `npm run build:lib` and `npm run build:browser` (`dist/`, `dist-cli/`, `dist-lib/`, `dist-browser/`) contains `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md`.
Every output JS file (including chunks) starts with a comment (`/*! … */`) giving the Kumiori version, its license and where `THIRD_PARTY_NOTICES.md` is (for when a single file is loaded from a CDN).

## Tests

```bash
npm run typecheck # type check
npm test          # unit tests (Node + fontkit; fetches Noto Serif JP into .cache/fonts)
npm run e2e       # browser integration tests (Playwright; on first run, npx playwright install chromium)
npm run ci:local  # the CI steps, run locally (below)
```

Environment variables for the integration tests:

| Variable | Contents |
| --- | --- |
| `KUMIORI_E2E_FONT_CACHE` | Set to a directory, the browser's fetched fonts are stored there, so later runs do not use the network (CI uses this) |
| `KUMIORI_E2E_FONT_DIR` | For supplying fonts by hand under fixed file names |
| `KUMIORI_CHROMIUM` | Points at a Chromium executable to use instead of the Chromium Playwright downloaded (for environments where the Playwright version and the installed Chromium do not match; for example `KUMIORI_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`). Without it, the Chromium Playwright downloaded is used. The comparison scripts (`scripts/compare-pdf.mjs`, `scripts/compare-css.mjs`) use it too |

## Running the CI steps locally (npm run ci:local)

`npm run ci:local` (`scripts/ci-local.mjs`) runs, locally and in order, the same steps as the build and e2e jobs of CI (`.github/workflows/ci.yml`) and the web app build of GitHub Pages (`.github/workflows/pages.yml`).
The steps are npm ci, the three builds, the web app build with the asset base changed, the API reference, unit tests and integration tests. The result of each step is listed at the end.

| Option | Contents |
| --- | --- |
| `-- --job build\|pages\|node-min\|e2e` | Chooses the jobs (repeatable). build, pages and e2e when none is given. For node-min, switch to Node 20.19.x, the lowest supported version, first |
| `-- --worktree` | Checks out the current commit (HEAD) to a temporary place and tests it there (as in CI, uncommitted changes and earlier build outputs are not mixed in) |
| `-- --no-install` | Skips the initial `npm ci` |

Like `pages.yml`, the pages job builds the web app with the asset base set to the repository name (taken from `repository.url` in `package.json`: `/kumiori/`).
It checks that the asset references in the output `index.html` start with that base, and builds the API reference (`npm run docs:api`) into `api/` below the web app. The output goes to a temporary place and is removed, so `dist/` is not changed.

## Data fetched by the tests

| Data | Location (variable to change it) | Source | Fetched in |
| --- | --- | --- | --- |
| Fonts used by the tests | `.cache/fonts` (`KUMIORI_FONT_DIR`) | Google Fonts (`fonts.gstatic.com`) and, for the PostScript font tests, Source Sans 3 (adobe-fonts/source-sans on `raw.githubusercontent.com`) | `test/helpers.ts` |
| Official Unicode conformance tests | `.cache/unicode` (`KUMIORI_UCD_DIR`) | `unicode.org` (`https://www.unicode.org/Public/<version>/ucd/`) | `test/ucdTestData.ts` |

- Both are fetched on first run.
- When a test needs another font, add it to the list in `test/helpers.ts` (the list is part of the CI cache key).
- The Unicode conformance tests are `LineBreakTest.txt` for UAX #14, `GraphemeBreakTest.txt` for UAX #29, and `BidiTest.txt` and `BidiCharacterTest.txt` for UAX #9. The version follows the UCD version the tables in `src/unicodeData.ts` were generated from.
  Where they cannot be fetched, the tests check only a small hand-written set of sequences in place of the official data.

## Checking tagged PDF (veraPDF)

Tagged PDF (`--tagged`, `--pdfua`) can be checked against PDF/UA-1 with [veraPDF](https://verapdf.org/) (free software that validates PDF/UA and PDF/A) by `node scripts/verapdf.mjs <PDF>...`.

- For each PDF, the script prints whether it conforms and the failed rules (the clause of the standard and the test number). `--raw` prints veraPDF's report as it is (the exit code is 1 if any PDF does not conform or could not be checked).
- `--flavour` selects other standards.
- veraPDF is fetched from Maven Central (`repo1.maven.org`) into `.cache/verapdf` (in `.gitignore`; each jar is compared with the SHA-256 written in the script).
- Java is needed to run it (verified with 21). When going through a proxy, add `NODE_USE_ENV_PROXY=1`.

## Comparison with sample PDFs

Prepare the sample FO and PDF files yourself (they are not in the repository). poppler's pdftoppm is required.

```bash
node scripts/compare-pdf.mjs --fo <FO directory> --ref <sample PDF directory> --img <image directory> --out compare-pdf-out
```

- Each FO is paired with the PDF of the same name. `compare-pdf-out/report.md` lists the page count of each sample and the difference of each page (largest differences first).
- Add `--compat antenna` when comparing with Antenna House samples (the default is spec mode).
- When the comparison scripts cannot find the Chromium Playwright downloaded (when the Playwright version and the installed Chromium do not match), point `KUMIORI_CHROMIUM` at a Chromium executable, as for the integration tests.

### Fetching the samples (fetch-samples.mjs)

`scripts/fetch-samples.mjs` fetches the samples from their publishers into `.cache/samples` (ignored by git; add `NODE_USE_ENV_PROXY=1` when going through a proxy).
It fetches Antenna House's "Sample FO collection" (the FO files and the PDFs AH Formatter produced) and the 4th edition of "CSS Page Composition Primer" (the PDF and its source files), and writes the source URL, size and SHA-256 of each file to `manifest.json`.
The fetched files are laid out so they can be passed to compare-pdf.mjs as they are.

```bash
node scripts/fetch-samples.mjs
node scripts/compare-pdf.mjs --fo .cache/samples/fo/fo --ref .cache/samples/fo/ref --img .cache/samples/fo/img --compat antenna --out compare-pdf-out
```

`.cache/samples/fo/groups.json` lists the sample names split by category into four groups (the grouping of the published comparison pages).

`--pack <directory>` and `--unpack <directory>` bundle the fetched files for storage and restore them.

- `--pack` bundles the fetched files (the zips, the PDFs and `manifest.json`) into a tar, splits it into 10MB pieces and wraps each in base64 JavaScript (for stores that do not accept zip or tar files, such as a claude.ai Artifact). It bundles only regular files.
- `--unpack` checks the pieces' SHA-256, restores them and extracts them without using the network (the same as `--offline`).
  The SHA-256 values are compared with `samples-index.json` from the same store, so they only show that the pieces are intact, not where they came from.
  So before extracting, it checks the tar's contents and stops without extracting anything if it holds anything other than regular files and directories (symbolic links, hard links, device files and so on) or names that are absolute or contain `..`.
  It does not keep the owners and permissions recorded in the tar (GNU tar's `--no-same-owner` and `--no-same-permissions`).
- Both use GNU tar.

### Typesetting with the samples' fonts and colors

- To typeset with the same fonts as the samples, pass the font files with `--fonts <directory>`, and replace the default fonts used for the generic families (`serif`, `sans-serif`) with `--web-fonts <directory>`.
  Put MS Mincho, MS Gothic, Times New Roman, Arial and Courier New under names such as `notoserif.ttf`, `notosans.ttf`, `tinos400.ttf`, `arimo400.ttf` and `cousine400.ttf`.
  Extract the first font of a TTC as a TTF. Fonts not in the directory are fetched from their source.
- When the samples are painted with spot colors (PDF Separation colors, such as PANTONE 627 PC in the 4th edition of "CSS Page Composition Primer"), extract the spot color names and the alternate CMYK at 100% tint written in the sample PDF with `node scripts/spot-colors-from-pdf.mjs <sample PDF> -o spot-colors.json`.
  Typeset with `--spot-colors spot-colors.json` on the Node command, and compare the resulting PDF with `--pdf`.
  Kumiori has no spot color values, so without it the colors are painted with the alternate RGB and differ from the samples.

### A page for comparing by eye (compare-view.mjs)

This builds a page for comparing the sample PDFs and Kumiori's PDFs by eye, paired by the same name.

```bash
node scripts/compare-view.mjs --ref <sample PDF directory> --pdf <Kumiori PDF directory> --out compare-view-out
```

Open `compare-view-out/index.html` in a browser. The samples are sorted with the largest differences first, and for each page you can switch between "Side by side", "Overlay" (with adjustable opacity), "Blink" and "Diff" (blue where only the sample has text or lines, red where only Kumiori does).

| Option | Contents |
| --- | --- |
| `--inline` | Produces a single HTML file with the images embedded |
| `--jpeg` | Makes the page images JPEG to reduce their size |
| `--artifact` | Writes it out in a form for publishing as a claude.ai Artifact (the diff images are drawn in the browser) |
| `--ref-label`, `--pdf-label` | The names of the left and right sides (default "見本" (sample) and "Kumiori") |
| `--title` | The page title |

The names and the title are changed when comparing home-made FO documents that have no sample, rendered in Kumiori's two modes or by another formatter. The home-made samples are in `samples/check/`.
