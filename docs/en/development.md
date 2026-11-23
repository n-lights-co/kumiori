> 日本語: [../development.md](../development.md)

# Development and testing

How Kumiori is developed, how to run it locally and how to test it. The release procedure is in [`docs/en/RELEASING.md`](RELEASING.md), and the changes in each version are in [`CHANGELOG.en.md`](../../CHANGELOG.en.md).

- [How Kumiori is developed](#how-kumiori-is-developed)
- [Running locally](#running-locally)
- [Tests](#tests)
- [Running the CI steps locally (npm run ci:local)](#running-the-ci-steps-locally-npm-run-cilocal)
- [Checks when reviewing](#checks-when-reviewing)
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
npm run compare:base -- --base <commit>  # compare with an earlier commit ("Comparing before and after")
npm run perf:compare -- --base <commit>  # compare typesetting time with an earlier commit ("Comparing typesetting time")
npm run fingerprints:update            # rewrite the area tree fingerprints ("Area tree fingerprints")
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
It checks that the asset references in the output `index.html` that are absolute paths (starting with `/`) start with that base (relative references are resolved from where the page is placed, so they are not checked), and builds the API reference (`npm run docs:api`) into `api/` below the web app. The output goes to a temporary place and is removed, so `dist/` is not changed.

## Checking Deno and Bun (check-runtimes.mjs)

`node scripts/check-runtimes.mjs` installs the distributed form (the output of `npm run build:dist`, packed with `npm pack`) into a new project in a temporary place, and on each of Node, Deno and Bun runs
the API (loading `kumiori`, `kumiori/node` and `kumiori/browser`; typesetting HTML and XSL-FO; writing PDF, SVG and PNG; `createTypesetter`; the language of overlapping calls) and the command (PDF, PNG, SVG, standard input, `--system-fonts`), then lists the results.
It does not load from inside the repository because Deno would then look for dependencies through the repository's `package.json`, which differs from how users install it.

| Option | Meaning |
| --- | --- |
| `--deno <command>`, `--bun <command>` | The runtime commands (default: `deno` and `bun` on PATH). A runtime that is not found is skipped. If they are not installed, get the npm packages with `npm i --prefix <dir> deno bun` and pass `<dir>/node_modules/.bin/deno` and `bun` |
| `--font-dir <dir>` | Where the default fonts are kept (default `.cache/fonts`; missing fonts are fetched and kept) |
| `--skip-build` | Skip the initial `npm run build:dist` |
| `--keep` | Keep the temporary place |

Run it after updating Deno or Bun, or when the code starts using another Node built-in module (`process.getBuiltinModule`, `node:*` imports).

## Checks when reviewing

Of the document mismatches that were found in almost every review before a release, the ones a machine can see are checked by `npm test`.

| Test | What it checks |
| --- | --- |
| `test/docsRules.test.ts` | Japanese and English pairs (in README, CHANGELOG, SECURITY, docs and the examples' notes: the order of sections, the number of table rows, code blocks, list items and the names in the first column of tables; in the conformance guides, the order of block elements), no review ledger numbers in the released documents and src, and no invisible characters (such as the line separator U+2028) in the released documents |
| `test/docsTables.test.ts` | The option and property tables and public functions in `docs/library.md` against the fields of the public types, the args column of `docs/diagnostics.md` against the places in src that make the diagnostics, and the environment variable table of `docs/cli.md` against the variables the command reads |
| `test/cliDocs.test.ts`, `test/diagnostics.test.ts`, `test/limits.test.ts` | The command's option tables, the names, severities and order of diagnostics, and the table of input limits |

What a machine cannot easily decide is checked by a person when reviewing.

- Whether the "Unreleased" section of the changelog has an entry for each change to src that went into main since the previous version (with notes such as "the typeset result changes" or "compatibility changes"). `node scripts/changelog-unreleased.mjs` lists the commits that changed src but not the changelog, and the commits that changed only one of the Japanese and English changelogs; read those candidates (the range starts at the commit that raised the previous version; `--since <commit>` changes it).
- Whether the text matches the current behavior (whether the description has caught up with a fix). The tests only check the names and shapes of tables.

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

## Comparing before and after (compare-base.mjs)

This typesets the same documents with Kumiori at the commit before a fix and the commit after it, and lists the documents and pages whose typesetting changed.
Use it to check that only what you meant to fix changed, and that other documents did not. It needs git and poppler (pdfinfo, pdftotext, pdftoppm).

```bash
npm run compare:base -- --base <commit before>              # after is HEAD
npm run compare:base -- --base main --head .                # after is the current files in the working tree (including uncommitted changes)
npm run compare:base -- --base main --only conformance,examples,samples
```

- It checks out the two commits in temporary locations and builds the Node command (`dist-cli`) for each. The built command is kept in `.cache/compare-base/<commit>/` and is not rebuilt next time (`--no-cache` rebuilds it).
  If a commit's `package-lock.json` is the same as the current one, this repository's `node_modules` is linked next to that place and used; if it differs, its dependencies are installed there with `npm ci`.
  The command for `--head .` is built in `build/` under `--out` with `node_modules` linked next to it, so `--out` may be outside the repository.
  Even when `.cache` is a link to another working copy, the dependencies used for typesetting are those of the working copy you run it in (the link next to the cache is redone on every run; avoid using the same cache from two working copies at once, as they would fight over the link).
- The documents are chosen by group (`--only`, `--skip`; `--filter <regular expression>` narrows them by document name). Groups whose samples are not available locally are skipped, and the report says why.

| Group | Documents |
| --- | --- |
| `conformance` | The four conformance documents (`docs/conformance`; typeset with the code listings inserted, as `npm run docs:conformance` does) |
| `examples` | The HTML and FO files in `examples` |
| `samples` | The FO files in `samples` (in both the spec mode and `--compat antenna`) and the HTML files |
| `generated` | Documents made by the test-document generators (currently the 30 multi-column footnote documents of `scripts/gen-column-footnotes.mjs` and the 7 documents of `scripts/gen-stress-docs.mjs`: deep nesting, a large table, many CSS rules, long paragraphs, many images and so on; generated once with the later commit's generator, and the same documents are typeset before and after) |
| `ah` | Antenna House's sample FO collection (`fo/samples` in the `--samples` location, default `.cache/samples`; `--compat antenna`) |
| `css-print` | The 4th edition of 『CSSページ組版入門』 (`css-print/src` in the `--samples` location; `--style ah`; spot color values from `--spot-colors`, default `.cache/spot-colors.json`, or extracted from the sample PDF if that file is missing) |
| `weasyprint` | The WeasyPrint samples ([CourtBouillon/weasyprint-samples](https://github.com/CourtBouillon/weasyprint-samples); `--style weasyprint`; the eight combinations in the samples' `printall.sh`) |

- Fetch the WeasyPrint samples with `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <location>` and pass them with `--weasyprint <location>` (the default is the environment variable `KUMIORI_WEASYPRINT_SAMPLES`, or `weasyprint-samples` next to the repository).
  The samples' text and fonts include other people's works under their own licenses, so they are not put in the repository.
- The repository's documents (`conformance`, `examples`, `samples`) are taken from each commit (if a commit changed a document, that change shows up in the differences too). The local samples are the same files for before and after.
- The default fonts are read from `.cache/fonts` (the same place as the tests). The fonts in `--fonts <directory>` (default `.cache/ms-fonts` if it exists) are passed to the `ah` and `css-print` groups, and the generic families are set to the same fonts as the samples.
  Before and after only need to use the same fonts to be compared, so the comparison works without the samples' fonts too (the report says which fonts were used).
- The PDF dates are set to 2000-01-01 with the `SOURCE_DATE_EPOCH` environment variable. For earlier versions that cannot be given the date (they write the time of typesetting and make the document identifier from random numbers), the clock and random numbers are frozen as well (`scripts/compare-base-freeze.mjs` is preloaded with `node --import`). With either version, the same code typesetting the same document gives a byte-identical PDF.
  The clock and random numbers are frozen only for those earlier versions. In a frozen version `Date.now()` does not advance, so time limits (`epsMs` for EPS, the deadline for fetching resources and so on) do not apply; a document that normally hits a time limit may give different results or warnings with the frozen earlier version and the unfrozen later one.

How it compares, and the output:

- Documents whose PDF bytes are identical are "the same, bytes too". Otherwise it compares the page count, the text of each page (words and positions from `pdftotext -bbox`) and the image (grey pixels from `pdftoppm` at `--dpi`, default 50, counting pixels whose luminance differs by more than 32); pages whose text or image changed are "changed pages".
  Documents whose page count, text and image are all the same but whose bytes differ are listed separately as "looks the same (bytes differ)".
  This comparison cannot see changes to colours of similar luminance (CMYK, spot colours, ICC) or changes only to the output intent, XMP, the tagged structure, annotations or bookmarks; those fall under "looks the same". Check such changes separately with `pdfinfo`, veraPDF (`node scripts/verapdf.mjs`) and so on.
  It also reports added and removed warnings and errors, and documents whose typesetting time grew by more than 1.5 times.
- It writes `report.md`, `report.json` and, for the changed pages, images of before, after and the difference side by side (`images/`; up to `--max-images` per document, default 20; in the difference, red is text or lines only after, blue only before) to `--out` (default `compare-base-out`). The typeset PDFs are in `pdf/base` and `pdf/head`.
- `--jobs` sets how many documents are typeset at once (default: the number of CPUs). All the groups (270 documents) take about 6 minutes on 4 CPUs (not counting building the commands).

After a fix that changes typesetting, run it with the commit before the fix as `--base`, and check that the changed documents and pages are only the ones you meant to fix.
Write the changed documents and pages (the report's "変わった文書" table) in the commit message.

## Comparing typesetting time (perf-compare.mjs)

Measures the typesetting time of an earlier commit and a later commit alternately on the same machine, and reports documents for which the later commit is much slower (`scripts/perf-compare.mjs`).

```bash
npm run perf:compare -- --base <earlier commit>             # the later commit is HEAD
npm run perf:compare -- --base v0.5.0 --head .              # compare the previous release with the current files in the working tree
npm run perf:compare -- --base main --doc fo-spec --rounds 7
```

- By default it typesets the HTML and XSL-FO conformance manuals (`html-spec`, `fo-spec`) and the table, rules, paragraph and XSL-FO nesting documents of the seeded random document generator (`scripts/gen-stress-docs.mjs`) (choose with `--doc`; the names are those of `--doc` in `scripts/profile-relayout.mjs`).
  Both commits typeset the documents and fonts of the working tree (only the typesetting code is compared).
- Machine noise is handled as follows.
  - It measures the CPU time of the typesetting thread (time spent waiting for other processes and the time of other GC threads are not included). Wall-clock time is shown alongside.
  - The two commits are measured alternately, swapping the order in each round (`--rounds` rounds, default 5). In a round each document is typeset `--runs` times (default 3) and the shortest warmed-up time is taken.
  - When the median of the per-round ratios (later ÷ earlier) exceeds `--threshold` (default 1.1) and the later commit is slower in at least 80% of the rounds, the document is reported as slower and the exit status is 1 (0 with `--no-fail`).
- With the default documents and counts it takes about 15 minutes on a machine with 4 CPUs (about 90 seconds for one side of a round). `--json <file>` also writes the results as JSON.
- `npm run compare:base` typesets many documents once each in parallel and lists documents whose typesetting seconds grew by more than 1.5 times (a coarse watch). This tool tells apart differences of about 10% on a few main documents (a precise check).
  Run it when the `compare:base` report lists slower documents, after changes that affect the typesetting work (layout passes, checks of the abort signal and so on), and before a release (against the previous release tag).

### Tests that check time

Tests in `npm test` that check time measure it with the helpers in `test/timing.ts`, so that machine speed and load (other test workers, builds) do not make them flaky.

- Time is measured as the CPU time of the test's thread (`cpuClock`), not wall-clock time. Limits are written as `scaled(milliseconds)`, and on slow machines the environment variable `KUMIORI_TIME_SCALE` (default 1) multiplies them.
- Growth is checked by measuring sizes n and 4n alternately and comparing the shortest times (`expectGrowth`; linear work gives 4 and quadratic work 16, so the limit is 8).
  Hostile inputs are bounded by the ratio to an ordinary input of the same size, measured alternately (`expectRatio`). Both re-measure up to 3 rounds until the ratio is within the limit.
- Tests of hostile inputs (small inputs that use up time) are collected in `test/hostileInputs.test.ts`. Inputs not fixed yet are `it.skip`; remove the skip when fixing them.
- `test/stressDocs.test.ts` checks the metrics (page count, number of pages with only a few lines, warnings) and growth of the seeded random documents (the multi-column footnote documents are in `test/columnFootnoteReserve.test.ts`).
  The large versions can be written with `node scripts/gen-stress-docs.mjs <directory>`, and `compare:base` also typesets them in the `generated` group.

## Checking layout stopped after N pages (check-max-pages.mjs)

It counts, for each document, whether pages 1 to N laid out with a stop after N pages (`--max-pages N`, `maxPages` of the API) are the same as pages 1 to N of the whole document.
Use it after changing the core of layout (page breaks, footnotes, columns, layout passes) to check that stopped layouts do not drift. It needs poppler (pdfinfo, pdftotext, pdftoppm).

```bash
node scripts/check-max-pages.mjs                         # N is 1, 3 and 10; typesets every sample group at hand
node scripts/check-max-pages.mjs --only weasyprint,conformance --pages 2,5
```

- The groups are `ah` (the Antenna House sample FO collection), `css-print` (『CSS ページ組版入門』, 4th edition), `weasyprint` (the WeasyPrint samples) and `conformance` (the HTML and XSL-FO conformance documents).
  The samples are found where the before/after comparison finds them (`--samples`, `--weasyprint`). It uses the command in `dist-cli` and builds it with `npm run build:cli` if missing. The clock and random numbers are frozen.
- For each page, it compares the text (words and positions from `pdftotext -bbox`) and the image (gray pixels from `pdftoppm` at `--dpi`, default 40), and sorts differing pages into:
  - reference text only: the lines are the same, and so are the words apart from digits, `"?"` and leader dots (references pointing after page N became `"?"`)
  - line breaks changed: the lines or other words differ
  - image only: the text is the same and only the image differs
- Differing pages for which no warning about references pointing after page N (`layout/beyond-max-pages`) was given are counted as "differing pages without the warning". If that is not 0, suspect a bug in layout.
- It writes `report.md` and `report.json` to `--out` (default `.cache/check-max-pages`).

## Area tree fingerprints (npm run fingerprints:update)

Fingerprints of the area trees of the main documents are kept in `test/fingerprints/`, and `npm test` fails when the typesetting changes (`test/fingerprint.ts`).

- A fingerprint is the SHA-256 of the same JSON as `serializeAreaTree`, with numbers rounded to 1/1000 pt and byte arrays (image data and so on) replaced by their SHA-256. There is one for the whole document and one per page; on failure, the numbers of the changed pages are shown.
- The documents: each sample and the whole of each of the four conformance documents (`test/conformance.test.ts`; `test/fingerprints/conformance.json`), the documents in `examples/drawio-pages`, and the FO files in `samples/check` in both modes (`test/fingerprints.test.ts`; `test/fingerprints/documents.json`).
- The default fonts are read from `.cache/fonts` (no network if they are there). Computing the fingerprints takes a few seconds in all (`test/fingerprints.test.ts` about 3 seconds; the conformance tests already typeset every sample and still take about two and a half minutes with the fingerprints).

When you change the typesetting on purpose, rewrite the fingerprints.

```bash
npm run compare:base -- --base <commit before the fix> --head .   # see which pages of which documents changed
npm run fingerprints:update                                       # rewrite the fingerprints (runs the fingerprint tests so that they write the current fingerprints instead of comparing)
git diff --stat test/fingerprints                                 # see which documents' fingerprints were rewritten
```

When narrowed as in `npm run fingerprints:update -- -t <test name>`, only the fingerprints of the documents typeset are rewritten, and the others are kept as they are in the file (a document that failed on a warning before its fingerprint was computed also keeps its old fingerprint).
Only the fingerprints of documents no longer typeset (not in the tests' list) are removed from the file.

In the commit message that rewrites fingerprints, write the documents whose fingerprints changed (from the test failures or `git diff`) and why they changed (what was fixed, and what changed on which pages: the result of the before-and-after comparison).
If a document you did not mean to change has a new fingerprint, do not rewrite it; check whether the change is right first.
