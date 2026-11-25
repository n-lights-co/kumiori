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
- [Checking the output PDF (check-pdfs.mjs)](#checking-the-output-pdf-check-pdfsmjs)
- [Time taken by the checks](#time-taken-by-the-checks)
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

Node 22.12.0 or later is required (for the reasons, see "Package entry points and requirements" in [`docs/en/library.md`](library.md)).
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

`npm run ci:local` (`scripts/ci-local.mjs`) runs, locally and in order, the same steps as the build, e2e, relayout, compare and pdf jobs of CI (`.github/workflows/ci.yml`) and the web app build of GitHub Pages (`.github/workflows/pages.yml`).
The steps are npm ci, the three builds, the web app build with the asset base changed, the API reference, unit tests, integration tests, the relayout reuse checks, the comparison against the list of intended changes and the checks of the output PDF. The result of each step is listed at the end.

| Option | Contents |
| --- | --- |
| `-- --job build\|pages\|node-min\|e2e\|relayout\|compare\|pdf` | Chooses the jobs (repeatable). All but node-min when none is given. For node-min, switch to Node 22.12.x, the lowest supported version, first |
| `-- --worktree` | Checks out the current commit (HEAD) to a temporary place and tests it there (as in CI, uncommitted changes and earlier build outputs are not mixed in) |
| `-- --no-install` | Skips the initial `npm ci` |

Like `pages.yml`, the pages job builds the web app with the asset base set to the repository name (taken from `repository.url` in `package.json`: `/kumiori/`).
It checks that the asset references in the output `index.html` that are absolute paths (starting with `/`) start with that base (relative references are resolved from where the page is placed, so they are not checked), and builds the API reference (`npm run docs:api`) into `api/` below the web app. The output goes to a temporary place and is removed, so `dist/` is not changed.

The relayout job runs the relayout reuse checks on all the repository documents (the groups `conformance`, `examples`, `samples` and `generated`):
reuse by the typesetter and the places where it joins the previous layout (`scripts/check-relayout.mjs --subjects reuse,splice-verify`), the resumable layout (`scripts/check-resume.mjs`) and the late-return check (`scripts/check-resume.mjs --late 4`) ("Comparing with and without reuse").
It fails when a result differs from typesetting from the start without reuse. Fast versions on representative documents are part of `npm test` (`test/relayoutAlways.test.ts`, `test/relayoutCheck.test.ts`, `test/resume.test.ts`, `test/relayoutSplice.test.ts`).

The compare job compares against the newest commit that emptied the list of intended changes (`test/intended-changes.json`) (`scripts/compare-base.mjs --intended`), and fails when a document or page changed that the list does not name ("The list of intended changes").
It typesets all the repository documents. It checks out the earlier commit, so it needs the git history (in a shallow clone, back to the commit that emptied the list) and poppler.

The pdf job typesets the repository documents (the groups `conformance`, `examples` and `samples`) as PDF/UA-1, PDF/A and PDF/X, and checks the output PDF with qpdf, Poppler and veraPDF (`scripts/check-pdfs.mjs`; "Checking the output PDF (check-pdfs.mjs)").
It needs qpdf, poppler and Java. veraPDF is fetched when it is not in `.cache/verapdf` (this repository's, even with `--worktree`).

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
- The parts that fetch and run it are in `scripts/verapdf-lib.mjs` (also used by `scripts/check-pdfs.mjs`, which checks the output PDF).

## Checking the output PDF (check-pdfs.mjs)

`node scripts/check-pdfs.mjs` typesets documents with each PDF output setting and checks the output PDF (the pdf job of `npm run ci:local`; the parts are in `scripts/pdf-checks-lib.mjs`).

- Settings: PDF/UA-1 (`pdfua`), PDF/A-2b (`pdfa-2b`), PDF/A-3b with PDF/UA-1 (`pdfa-3b-ua`), PDF/X-4 (`pdfx-4`; the CMYK output ICC profile is the one made for the tests, `test/iccTestProfile.ts`) and PDF/X-1a (`pdfx-1a`).
  The four conformance documents are typeset as `pdfua`, `pdfa-2b` and `pdfx-4`, the documents in examples and samples with every setting, and the external samples only as `pdfua`.
- Structure checks (finding broken PDF): `qpdf --check` (errors and warnings both fail), and Poppler's `pdfinfo` (it can be read, the page count, whether it is tagged), `pdffonts` (every font is embedded) and `pdftotext` (the page content streams can be read).
  Poppler can print syntax errors (`Syntax Error` and so on) on standard error even when it reads the file, so those lines fail too.
- veraPDF checks: the failed rules (the clause of the standard and the test number, in the form "7.1-3") of PDF/UA-1 (`ua1`), PDF/A-2b (`2b`) and PDF/A-3b (`3b`) are compared with the baseline (`test/pdf-checks.json`).
  A failed rule that is not in the baseline fails. A rule in the baseline that no longer fails is reported without failing (rewrite the baseline with `--update`). PDF/X has no rules in veraPDF, so only the structure checks are run.
- The rules the current baseline allows come only from the document contents (figures without alternative text 7.3-1, a document without a title 7.1-9, alternative text for formulas 7.7-1, skipped heading levels 7.4.2-1; all PDF/UA-1). PDF/A-2b, PDF/A-3b and the structure checks pass for every document.

| Option | Contents |
| --- | --- |
| `--only <groups>,…`, `--skip <groups>,…` | The groups of documents (default `conformance,examples,samples`; the names are the same as in `scripts/check-relayout.mjs`, and the list of documents is in `scripts/doc-sources.mjs`) |
| `--filter <string>` | Typesets only the documents whose names contain the string |
| `--jobs <number>` | The number of processes that typeset documents (by default the smaller of the number of CPUs and one per 5 GB of memory). The heavy documents are typeset first |
| `--baseline <JSON>`, `--update` | The veraPDF baseline file (default `test/pdf-checks.json`) and rewriting the baseline of the typeset documents |
| `--out <directory>`, `--keep` | Where the PDF are written (a temporary place by default, removed at the end) and keeping them |

- `test/pdfChecks.test.ts` in `npm test` typesets two small repository documents (`examples/drawio-pages/pages.html` and `samples/check/fo/indent-inheritance-1.fo`) with every setting and runs the same checks (with the same baseline file).
  When qpdf, Poppler, Java or veraPDF in `.cache/verapdf` (or the `KUMIORI_VERAPDF_DIR` environment variable) are missing, those checks are skipped (not failed; veraPDF is not fetched).
- Installing the tools: on Debian and Ubuntu, `sudo apt-get install -y qpdf poppler-utils`. For veraPDF, `NODE_USE_ENV_PROXY=1 node scripts/verapdf.mjs --fetch-only` (`NODE_USE_ENV_PROXY=1` is not needed without a proxy).

## Time taken by the checks

The time taken by each check step on a machine with 4 CPUs and 16 GB of memory (about 14 GB usable), in seconds (before and after the checks were made faster at the start of 0.8.0).

| Step | Before | After | What changed |
| --- | --- | --- | --- |
| `npm test` | 713 | 628 | The number of files run at once is the number of CPUs (vitest's default is one less), the slow files run first, the Conformance Guide tests are split into two files (Japanese and English), and the two signals of the command's signal test run side by side |
| `npm run e2e` | 136 | 77 | The tests inside a file also run in parallel, with as many workers as CPUs (Playwright's default is half the CPUs, one test at a time inside a file) |
| relayout: `check-relayout` | 558 | 487 | Idle processes are handed the heavy documents first, the memory estimates keep heavy documents from overlapping, and as many documents as CPUs are typeset at once (3 before) |
| relayout: `check-resume` | 109 | 85 | The same |
| relayout: `check-resume --late 4` | 140 | 111 | The same |
| pdf: `check-pdfs` | — | 139 | A new step ("Checking the output PDF (check-pdfs.mjs)") |

- The `npm test` before figure is a run with the results of a previous run (in `node_modules/.vite`). In a run without them (right after `npm ci`, `npm run ci:local -- --worktree`), a small file with heavy tests (`test/conformance.test.ts`, which typesets the Conformance Guides) used to run late, and for the last minutes only that file was running. The after figure of 628 seconds is a run without them.
- Without the results of a previous run, the order of the slow files is estimated from `test/durations.json` (the measured seconds of the main files; `test/sequencer.ts`). When test files are added or their weight changes a lot, rewrite it with `node scripts/test-durations.mjs <report.json>` after `npx vitest run --reporter=default --reporter=json --outputFile.json=<report.json>`. When it is out of date, the test results do not change (only the order gets worse).
- What is checked (the tests, documents and settings) is not reduced.
- `check-relayout` takes about 340 seconds for one document, the English HTML and CSS Conformance Guide, and the whole is set by the larger of that document and the total of the other documents (about 1500 seconds of CPU time) divided by 4.

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
- The documents are chosen by group (`--only`, `--skip`; `--filter <string>` narrows them to the documents whose names contain the string). Groups whose samples are not available locally are skipped, and the report says why.

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

### The list of intended changes (test/intended-changes.json)

A commit that changes typesetting adds the documents and pages it changes to `test/intended-changes.json`.
`npm run compare:base -- --intended` (the compare job of `npm run ci:local`) compares the newest commit that emptied the list (before) with the current commit (`--head`, after), and exits with status 1 when something changed that the list does not name
(when before and after are the same commit, it ends without typesetting. With `--base`, that commit is used as before). The report (`report.md`, `report.json`) also lists the changes not in the list, and the listed documents that did not change.

```json
{
  "changes": [
    { "commit": "Choose table borders again at page breaks", "docs": [{ "doc": "conformance/kumiori-xsl-fo.fo", "pages": [41, "88-90"] }, { "doc": "generated/stress/fotable.fo" }] },
    { "commit": "Fix the letter spacing of headings", "docs": [{ "doc": "examples/*" }] }
  ]
}
```

- `commit` is a short description of the change (such as the commit subject). One commit adds one entry.
- `doc` is the name of the document in the comparison report (`conformance/kumiori-xsl-fo.fo`, `examples/drawio-pages/pages.html`, `samples/check/fo/indent-inheritance-1.fo (--compat spec)` and so on). `*` matches any run of characters, including `/`.
- `pages` lists the pages allowed to change (page numbers in the later version; `"88-90"` means pages 88 to 90). With it, only changes to the text and images of those pages, changes to warnings and errors, and byte changes that look the same are allowed; changes to other pages and to the page count fail.
  Without it, any change to the document is allowed (including the page count and a document that only one version has).
- A document that the later version cannot typeset fails even when it is listed.
- The list is emptied by a commit that does not change typesetting (a commit that only sets `"changes": []`, after a release or when the list has grown long). From then on, the list records the changes since that commit.
- The list adds up the changes since then, so it cannot tell when a later commit changes the same page by accident. Checking each commit is still done by comparing with the commit before the fix as `--base`.

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

## Measuring memory peaks (measure-memory.mjs)

This measures the memory peak while making a PDF, with `typesetToPdf` and with `typesetToPdfStream`, which writes the PDF as a stream (to `fs.writeSync`), each with and without `lowMemory` (`scripts/measure-memory.mjs`).
Use it to check that a change to PDF writing or to low-memory typesetting does not raise the peak.

```bash
node scripts/measure-memory.mjs                                  # the default documents in all 4 modes
node scripts/measure-memory.mjs --doc images:200 --mode pdf --mode stream
node scripts/measure-memory.mjs --doc text:11200 --json mem.json  # a text-only document of 1,600 pages
```

- The documents are the HTML and XSL-FO conformance documents (`html-spec`, `fo-spec`), a text-only document (`text[:sections]`, generated), a document with many images (`images[:count]`, generated 600×600 PNGs that do not compress),
  a book with many images (`book[:pages:count]`; by default 197 pages and 333 8-bit RGBA PNGs of 1600×1000, made by `scripts/measure-png-embed.mjs`: run `node scripts/measure-png-embed.mjs --env node` once first),
  and, when it is available locally, the 4th edition of 『CSSページ組版入門』 (`css-print`). The modes are `pdf`, `stream`, `pdf-low` and `stream-low`.
- Each document and mode is typeset in a fresh Node process (`--expose-gc`), and `process.memoryUsage()` is read every 20ms and at every progress callback. The table gives the peaks of the heap, of external bytes (`arrayBuffers`) and of RSS,
  the live heap during typesetting (the peak read after garbage collection every 100 pages of a layout pass) and the live amounts (read after garbage collection) while the PDF is written.
  The heap peak varies with the timing of garbage collection, so compare before and after, or streaming and non-streaming, by the live amounts.
  Drawing the settled pages while typesetting and releasing them (`design/pdf-writer.md` section 12) lowers the live heap during typesetting
  (from 525MB to 127MB for the 1,600-page text-only document). Since 0.8.0 documents with images are also drawn while typesetting (`design/pdf-writer.md` section 13).
  The JSON also gives the peak of external bytes for each progress phase (`resources`, `import`, `layout`, `pdf`). `--no-build` uses the build made before (`.cache/measure-memory-build`).
- For the document with many images, the tool keeps the image bytes it generated during the whole run (they are part of the starting amount of external bytes).
- Before (3fe6117) and after drawing documents with images while typesetting (0.8.0; `design/pdf-writer.md` section 13) (2026-11-25; this container, Node 22.23.5, 4 CPUs; MB and seconds):

  | Document | Mode | Live heap during typesetting | Live external bytes while writing the PDF | Peak of external bytes | RSS peak | Time |
  |---|---|---|---|---|---|---|
  | Book with many images (`book`; 197 pages, 70MB PDF) | `pdf` | 56.4 → 56.0 | 215.8 → 200.3 | 280.0 → 279.4 | 536.5 → 484.5 | 21.5 → 18.9 |
  | Same | `stream` | 56.4 → 55.8 | 165.7 → 144.4 | 187.9 → 220.8 | 425.6 → 411.5 | 21.3 → 19.9 |
  | HTML conformance document (`html-spec`; 148 pages) | `pdf` | 183.6 → 186.6 | 183.9 → 183.8 | 198.1 → 203.2 | 749.8 → 783.3 | 23.0 → 22.7 |
  | Same | `stream` | 183.6 → 187.1 | 182.9 → 183.6 | 196.5 → 201.1 | 768.6 → 809.9 | 23.5 → 22.7 |
  | Document with many images (`images`; 200 PNGs, 196MB PDF) | `pdf` | 49.1 → 53.0 | 469.0 → 261.0 | 786.5 → 565.0 | 1,169.8 → 925.0 | 3.7 → 2.4 |
  | Same | `stream` | 49.1 → 52.9 | 275.7 → 260.9 | 773.7 → 574.1 | 961.9 → 743.9 | 3.6 → 2.4 |

  - The peak of external bytes of the document with many images went down because the image store no longer copies the images it is given (on top of the 533MB the measuring side holds from the start, it added 254MB before and about 40MB after).
  - The live heap during typesetting of the book with many images is small to begin with (the images are larger than the intermediate layout result). The peak of external bytes when streaming went up by 33MB
    because the RGBA PNGs are prepared before typesetting (split into RGB and alpha and compressed; about the size of the PDF's images) and held until the first page that uses them (before, they were embedded and written one by one after typesetting).
  - The conformance document has a table of contents (forward page-number references) at the start, so the pages from the second one are drawn after typesetting and the live amounts do not change (the differences in heap and RSS peaks come from the timing of garbage collection and noise).
  - The 1,600-page text-only document (`text:11200`) is the same as before (live heap during typesetting 127MB).

## Measuring image embedding time (measure-png-embed.mjs)

Measures the time to turn a document with many PNG images with alpha into a PDF, in Node and inside a Web Worker in Chromium (`scripts/measure-png-embed.mjs`).
Use it after changing image embedding (decompression and compression) to check that neither the browser nor Node has become slower. Chromium is the one `KUMIORI_CHROMIUM` points to.

```bash
NODE_USE_ENV_PROXY=1 node scripts/measure-png-embed.mjs                     # both Node and the Worker
node scripts/measure-png-embed.mjs --env worker --runs 3 --json after.json
node scripts/measure-png-embed.mjs --src ../kumiori-before --json before.json # measure an earlier commit checked out with git worktree
```

- The test document has 197 pages with 333 1600×1000 8-bit RGBA PNG images (about 55MB in total; pictures that look like screenshots, with transparent corners), one or two per page
  (change them with `--pages` and `--images`). The tool makes the images and keeps them in `.cache/measure-png-embed/images` (they are not added to the repository).
- The document is typeset with `createTypesetter` → `typeset` → `toPdf({ title, date, onProgress })` (no deflate). The table shows the time for layout, up to the first `onProgress` (phase `pdf`), `toPdf` and the whole run,
  and the time for embedding PNG images with alpha split into four parts: (a) decompression, (b) undoing the filters and splitting RGB and alpha, (c) compressing the pixels (each the sum over all the images, processed one by one with the same functions as embedding),
  and (d) the rest (`toPdf` minus (a) to (c): the PDF writer, page contents, fonts and so on). It also prints the SHA-1 of the PDF, so you can check whether the bytes are the same before and after.
- The default fonts are cached in `.cache/fonts` for Node and in `.cache/measure-png-embed/fonts-web` for the Worker. The first run downloads them, so add `NODE_USE_ENV_PROXY=1` where a proxy is used.

## Measuring the memory and time of drawing (measure-render-memory.mjs)

Measures the memory and time of drawing (`renderPage`) in a Chromium Web Worker, in the same shape as a user (a print preview) (`scripts/measure-render-memory.mjs`).
It creates one Typesetter, holds `--results` results of the same document (default 2), and draws every page twice with `renderPage(OffscreenCanvas)`. Run it when changing the image cache (`TypesetterOptions.imageCache`).

```bash
node scripts/measure-render-memory.mjs                                     # the book with many images (197 pages, 333 PNGs), 2 results
node scripts/measure-render-memory.mjs --max-bytes 67108864 --no-build      # image cache limit of 64MB
node scripts/measure-render-memory.mjs --src ../kumiori-before --json b.json  # measure an earlier commit checked out with git worktree
```

- The document is the same test book as `scripts/measure-png-embed.mjs` (make the images first by running `node scripts/measure-png-embed.mjs --env node` once).
- The amounts are the peak of the sum of the RSS of all Chromium processes (`ps` every 100ms), the values when typesetting and drawing end, and Kumiori's estimates (the sum of the results' `memoryUsage().images` and `cacheDetail.images` of `Typesetter.memoryUsage()`).
- Measured values (2026-11-25; this container, Chromium 158, 4 CPUs; before is 3fe6117; MB and seconds):

  | | Before | After (limit 256MB, the default) | After (limit 64MB) |
  |---|---|---|---|
  | RSS peak | 5,634 | 1,598 | 1,475 |
  | RSS when typesetting ends | 5,350 | 1,218 | 1,216 |
  | Estimate of the results' `images` (sum of 2) | 4,171.5 | 0 | 0 |
  | Image cache (`cacheDetail.images`) | — | 250.2 | 61.0 |
  | Typesetting time (1st and 2nd result) | 6.1, 5.8 | 5.1, 4.2 | 5.7, 4.6 |
  | Drawing every page (394 pages; 1st and 2nd time) | 1.2, 1.1 | 7.1, 7.5 | 7.8, 8.2 |

  - Before, every result turned all of its images into `ImageBitmap` when reading them and kept them (6.4MB each × 333 × 2 results). After, images are decoded when drawing, and the Typesetter as a whole keeps them up to the limit.
  - Drawing takes longer because images that do not fit within the limit are decoded again each time they are drawn (this book has 333 images, and the 256MB limit holds about 40; about 10ms each).
    Images that fit in the cache (as in a preview that redraws the pages around the one being viewed) are not decoded again from the second time.

## Measuring the memory estimates of typeset results (measure-result-memory.mjs)

This measures how well the memory estimates of typeset results and of the Typesetter (`TypesetResult.memoryUsage`, `Typesetter.memoryUsage`) match what releasing actually frees (`dispose`, `releaseCaches`),
and is used to re-determine the factors of the estimates (`AREA_TREE_BYTES` in `src/areaTree.ts`, `FONT_BYTES_PER_GLYPH` in `src/fontManager.ts`, `REUSE_BYTES` in `src/layoutEngine.ts`) (`scripts/measure-result-memory.mjs`).
Run it when what results or the Typesetter hold (the area tree, fonts, reuse caches) changes, to see that the estimates still match.

```bash
node scripts/measure-result-memory.mjs                                   # the default documents (Node)
node scripts/measure-result-memory.mjs --doc web:200 --doc web:200+noreuse
node scripts/measure-result-memory.mjs --browser --no-build --doc web:200  # inside a Chromium Web Worker
```

- It measures under the same conditions as the user (a print preview): one Typesetter with reuse on (the default), images, fonts and CSS passed through `resolveResource`, which returns the same `ArrayBuffer` every time.
  The same document is typeset twice (the earlier and the latest result); the latest and then the earlier result are released with `dispose()`, and the reuse caches are released in the order pages of the previous document, line breaking, prepared fonts; the drop is taken at each step
  (the amount is `heapUsed + arrayBuffers` after waiting for one task and collecting garbage (`gc()`) twice).
- The documents are HTML like a preview (`web:<pages>`, generated: three TrueType fonts in `@font-face`, and per page six paragraphs and about 1.7 images), the HTML and XSL-FO conformance documents (`html-spec`, `fo-spec`), a text-only document (`text:<sections>`) and the same with a table of contents of page numbers for each section in front (`toc:<sections>`, with forward page-number references and further layout passes).
  A name can be followed by `+noreuse` (no reuse), `+noface` (no `@font-face`) and `+linesfirst` (release the line-breaking cache first). The factors come from what results without reuse free (excluding images and fonts),
  the difference from `+noface` (the fonts) and the sum of what the caches free (the pages of the previous document and the line-breaking cache share line nodes, and the one released first does not free the shared part, so the sum is used).
- `--browser` runs the same steps inside a Web Worker in Chromium (`KUMIORI_CHROMIUM`). The amount is `usedSize` of `Runtime.getHeapUsage` through the Worker's CDP, which does not include external bytes (contents of image and font files, `ImageBitmap`).
- "Left" in the table is what remains above the start after everything is released (modules loaded on the first typesetting, hyphenation dictionaries, fonts for math and so on). It is not part of the estimates of results or of the Typesetter.
- "memoryUsage time" in the table is the time of one `result.memoryUsage()` call (ms): the first call on each result (which counts the area tree) and later calls (the average of 200). For `web:200` it was 30ms and 0.07ms in Node 22, and 24ms and 0.27ms in a Chromium 158 Web Worker.
- Measured (2026-11; MB; Node 22.23.5 and a Web Worker in Chromium 158):

| Document | Runtime | Pages | Areas | Earlier result (estimate, freed) | Latest result (freed) | Caches (estimate, freed) | Result without reuse (estimate, freed) | Left |
|---|---|---|---|---|---|---|---|---|
| `web:3` | Node | 3 | 2,771 | 5.9, 1.7 | 4.3 | 2.9, 9.4 | — | 5.9 |
| `web:20` | Node | 20 | 18,564 | 15.8, 11.3 | 13.9 | 14.4, 20.6 | — | 7.2 |
| `web:200` | Node | 200 | 187,104 | 120.8, 113.9 | 116.1 | 136.6, 140.5 | 120.8, 121.0 | 11.6 |
| `html-spec` | Node | 148 | 260,963 | 152.5, 154.4 | 97.7 | 275.4, 288.7 | 157.2, 158.4 | 78.2 |
| `fo-spec` | Node | 100 | 159,294 | 53.3, 54.4 | 58.8 | 126.2, 152.7 | 53.3, 59.4 | 51.9 |
| `text:1500` | Node | 215 | 236,435 | 77.6, 73.5 | 73.1 | 194.0, 180.2 | 77.6, 76.1 | 8.4 |
| `toc:1500` | Node | 252 | 267,268 | 88.7, 87.2 | 88.1 | 227.0, 197.3 | 88.7, 89.8 | 13.3 |
| `web:20` | Chromium | 20 | 18,564 | 5.1, 3.4 | 4.4 | 7.7, 10.5 | — | 5.7 |
| `web:200` | Chromium | 200 | 187,104 | 37.9, 34.2 | 34.9 | 77.2, 80.2 | 37.9, 37.4 | 7.2 |
| `html-spec` | Chromium | 148 | 260,963 | 75.8, 70.8 | 53.3 | 136.5, 135.3 | 80.5, 71.2 | 35.2 |
| `fo-spec` | Chromium | 100 | 159,294 | 31.8, 32.3 | 34.4 | 69.7, 89.0 | 31.8, 34.8 | 23.5 |
| `text:1500` | Chromium | 215 | 236,435 | 46.0, 42.9 | 42.7 | 110.3, 106.1 | 46.0, 44.3 | 5.5 |
| `toc:1500` | Chromium | 252 | 267,268 | 53.1, 50.5 | 50.8 | 129.0, 116.3 | — | 7.8 |

  The Chromium rows are estimates with the browser factors (`memoryRuntime()` is `browser`). What is freed does not include external bytes (contents of image and font files, `ImageBitmap`),
  so the estimates are given without `images` and prepared fonts. JS objects are smaller in Chromium (V8 pointer compression): from what results without reuse free, an area takes about 190 to 220 bytes (about 340 in Node),
  a font glyph about 160 to 200 bytes (about 500 in Node), and the caches about 0.57 times Node, so the browser factors are 200, 180 and 0.57 times Node.
  Firefox and Safari were not measured (they use the browser factors).
  The pages of the previous document in the reuse caches are those of the first layout pass (page sequences laid out again in the second or a later pass also keep their first-pass pages); the estimate counts the nodes of their logical trees.
  The contents before characters were replaced in the second or a later pass (`undo`) had no entries in any measured document (`toc:1500` was laid out again rather than having characters replaced), so the size per entry (`undo` in `REUSE_BYTES`) was not measured
  and is set to the same as one unit of the line-breaking cache.

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

## Comparing with and without reuse (check-relayout.mjs)

This checks that what the container (`createTypesetter`) typesets while reusing what it remembers from the previous document is the same as without reuse (`reuse: false`).
Each document is edited a little at a time at places chosen by a seeded random number generator (inserting, deleting and replacing text, without breaking tags or character references; now and then also adding a layout attribute to a block, or only adding a background color to a page master (an XSL-FO region or an HTML `@page`)), and "the original document, the edited versions (`--edits` of them, one on top of the other) and the original document again" are typeset in turn by a container that reuses and one that does not, comparing the area tree, the diagnostics (down to the line and column of their location), the warnings and the bytes of the PDF (with the clock and the random numbers fixed). A difference is a bug on the reuse side.
Use it when changing the reuse of the container or the relayout from the middle of a document (the parts are in `scripts/relayout-check-lib.mjs`, made so that containers to compare and numbers taken from the results for the report can be added).

```bash
node scripts/check-relayout.mjs --jobs 4                          # typeset all groups available locally
node scripts/check-relayout.mjs --only conformance,css-print --seed 2 --edits 5
```

- The groups are `conformance` (the Conformance Guides in Japanese and English), `examples`, `samples`, `generated` (documents from `scripts/gen-stress-docs.mjs`), `ah`, `css-print` and `weasyprint`.
  The samples are found in the same places as for comparing before and after (`--samples`, `--weasyprint`). The default fonts are used.
- It prints one line per document (the number of versions, the page counts, the number of paragraphs reused and the time), and for a version that differs, where it differs (the first differing page of the area tree, the first differing byte of the PDF).
  If any version differs, the exit status is 1. `--json` writes the results.
- `--jobs` is the number of processes that typeset documents. Each idle process is handed one document at a time, the heavy ones (the Conformance Guides, 『CSSページ組版入門』) first,
  and the memory estimates of the documents typeset at once are kept within 80% of the machine's memory (the HTML and CSS Conformance Guide alone takes about 5 GB, the XSL-FO one about 4 GB).
- `--skip` leaves out groups, and `--no-pdf` runs faster without comparing the PDF bytes. `--src` and `--no-build` are as in `scripts/profile-relayout.mjs` (where the typesetting source is, and using the build made before).
- A fast version on small documents is `test/relayoutCheck.test.ts`, which is part of `npm test`. A fast set that checks reuse, joining (`splice-verify`), the resumable layout and the late-return check together on representative documents is
  `test/relayoutAlways.test.ts`. All the repository documents are checked by the relayout job of `npm run ci:local`.
- The `generated` group also has XSL-FO documents with one page-sequence per chapter, footnotes and markers (`generated/fofootnotes`, `generated/fomarkers`). The `page-sequence` field of the line shows how many page-sequences were reused from the previous document.

### Checking the resumable layout (check-resume.mjs)

The layout can stop a single-column page-sequence at a page boundary and lay out the rest from the state saved there (when choosing the last-page master again, it relays out from a boundary it can resume from).
`scripts/check-resume.mjs` typesets with a container that, at every boundary it can resume from, lays out one page further, goes back to the boundary and continues from the saved state (`--subjects resume`), and compares the same things as above with a container that does not reuse.
It also compares the boundary fingerprints when the layout reaches the same boundary again. Use it when changing the resumable layout.

```bash
node scripts/check-resume.mjs --jobs 4                            # typeset all groups available locally (runs check-relayout.mjs with --subjects resume --edits 0)
node scripts/check-resume.mjs --only ah --filter keep             # narrow by group and name (the arguments are those of check-relayout.mjs)
node scripts/check-resume.mjs --late 4 --jobs 4                   # the late resume check (below)
```

- `--late N` typesets with a container that, after laying out a page-sequence to the end, picks about N boundaries it can resume from, spread out, and, from the last to the first,
  goes back to each and lays out to the end again (`--subjects resume-late`). This is the same shape as the relayout from a boundary inside the layout (the last-page master), and finds bugs that change, more than one page after the boundary, things shared with the saved state.
  After each relayout it also goes back once more to the next boundary saved by that relayout and lays out to the end again (a wrong boundary saved by a resumed flow does not change the result until layout resumes from it).
- The `generated` group also has documents whose body width differs between left and right pages (HTML `@page :left`) or odd and even masters, with long paragraphs across pages (`generated/sidewidth`, `generated/fosidewidth`).
  Resuming from a boundary inside such a paragraph lays out its remaining lines again on a page with a different line length, so they find bugs in the boundaries saved meanwhile.
  It also has documents with collapsed-border tables (cells spanning two rows, rows that must not be split, repeated table headers) across pages (`generated/collapsetable`, `generated/focollapsetable`; the FO one has a last-page master).
  The borders at page breaks are decided by rewriting the sides of the cells of the laid-out rows, so they find bugs where an earlier layout's rewrites leak into the layout done again.

- The line for each document shows the boundaries saved, those it could resume from, the number of times it resumed, and the boundaries it could not resume from by reason
  (`site:children/child:<kind>` is inside a child block that cannot be resumed (`block-container-columns` is a multi-column block container), `site:inline` is inside a run of lines with floats, and so on).
- A fast version on small documents is `test/resume.test.ts`, which is part of `npm test`.

## Area tree fingerprints (npm run fingerprints:update)

Fingerprints of the area trees of the main documents are kept in `test/fingerprints/`, and `npm test` fails when the typesetting changes (`test/fingerprint.ts`).

- A fingerprint is the SHA-256 of the same JSON as `serializeAreaTree`, with numbers rounded to 1/1000 pt and byte arrays (image data and so on) replaced by their SHA-256. There is one for the whole document and one per page; on failure, the numbers of the changed pages are shown.
- The documents: each sample and the whole of each of the four conformance documents (the Japanese ones in `test/conformance.test.ts` and `test/fingerprints/conformance.json`, the English ones in `test/conformanceEn.test.ts` and `test/fingerprints/conformance-en.json`), the documents in `examples/drawio-pages`, and the FO files in `samples/check` in both modes (`test/fingerprints.test.ts`; `test/fingerprints/documents.json`).
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
