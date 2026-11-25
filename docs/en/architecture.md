> 日本語: [../architecture.md](../architecture.md)

# Architecture

How Kumiori works inside, and the role of each source file.

## The typesetting pipeline

```text
HTML+CSS · XSL-FO
        │
        ▼
logical tree (Input)
        │  layout (the XSL-FO Area Model, computed in pt)
        ▼
physical tree (Area Tree)
        ├─▶ Canvas (preview)
        ├─▶ PDF (pdf-lib + fontkit)
        └─▶ SVG · PNG
```

1. HTML+CSS is read with Kumiori's own CSS cascade (no browser needed) and XSL-FO by importing its attributes; both become a **logical tree**. The logical tree can be saved as JSON (web app).
2. Following the XSL-FO **Area Model**, every box is computed in pt and a **physical tree (Area Tree)** is assembled.
3. The Area Tree is drawn to Canvas and **PDF (pdf-lib + fontkit)** (SVG and PNG are made from the same Area Tree).

The rules for units and coordinates are in "Units and coordinates" in [`docs/en/library.md`](library.md), and the JSON of the Area Tree is in [`docs/en/area-tree.md`](area-tree.md).

## Architecture diagrams

Each diagram shows one mechanism. Names in the diagrams are functions, classes and files in `src`.
The diagrams are made by `scripts/architecture-diagrams.mjs`. To change one, edit the script and run `node scripts/architecture-diagrams.mjs` (do not edit the SVG by hand). `npm test` checks that the diagrams match the script's output and that every `src` name in them still exists.

### 1. Overview

![Overview: four entry points into one typesetting pipeline](images/architecture/01-overview.svg)

There are four entry points, and all of them go through the same pipeline (import → logical tree → layout → Area Tree → rendering). Only the web app (`src/main.ts`) skips the public API and combines the modules directly (it is also the only place that reads EPUB).
The logical tree can be saved as JSON (web app), and the Area Tree can be written and read as JSON (`serializeAreaTree`, `parseAreaTree`). All units are pt.

### 2. Import

![Import: from a document to the logical tree](images/architecture/02-import.svg)

Fonts and images are prepared first, then the document kind is detected. HTML+CSS and XSL-FO are read by separate paths into the same logical tree (`LDocument`). No browser is used; the CSS cascade is Kumiori's own. Once the logical tree exists, the characters it uses decide which extra fonts to load (monospace, symbol, emoji, math, OS fonts).
HTML is parsed with htmlparser2 and linkedom, XML with @xmldom/xmldom.

### 3. Layout passes

![Layout engine: lay out again until it converges](images/architecture/03-passes.svg)

Page-number citations, footnote numbers and indexes have no value until the document is laid out. `LayoutEngine` lays the document out once and lays it out again when those values change (up to 4 times). Page sequences that did not change are reused from the previous pass, and with `createTypesetter` line breaking results are reused across documents (`SharedLineMemo`).
Intermediate passes stop at the page build trees (`PageBuild`); only the converged pass becomes an Area Tree (so a document of thousands of pages does not hold the whole tree several times). Layout is written as a generator: with `signal` or `onProgress`, it checks for cancellation and reports progress at page-sequence boundaries.

### 4. Inside one layout pass

![Inside one layout pass](images/architecture/04-flow.svg)

For each page-sequence a page master is selected and the body flow (`Flow`) is filled into the page. Lines inside a block are flattened into atoms, broken into lines (break opportunities from UAX #14, kinsoku, hanging and pushing out, hyphenation, warichu) and positioned within the line.
Table cells are laid out by the same mechanism (a Flow inside `layoutCell`). At a page boundary the layout state is captured (`captureBoundary`, `resumeFrom`) and layout continues from there. Vertical writing is laid out in logical coordinates (inline, block) and turned into physical coordinates in `toArea`.

### 5. The logical tree and the Area Tree

![The logical tree and the area tree](images/architecture/05-trees.svg)

The logical tree is the document's structure and knows nothing about pages. The Area Tree is the result placed on pages, with positions and sizes in pt. One page-sequence becomes one sheet per page, one block is split at page breaks, and text becomes lines and one area per glyph.
Paint-only `transform` and `opacity` are attached to areas; layout does not see them. The shape of the Area Tree is described in [`docs/en/area-tree.md`](area-tree.md).

### 6. Rendering

![Rendering: one traversal, four outputs](images/architecture/06-render.svg)

The paint order of the Area Tree is decided in one place, `src/paint.ts`. Differences between outputs stay inside the implementations of the `Painter` interface (Canvas, SVG, PNG, PDF).
PNG is painted by Kumiori's own rasterizer without Canvas, so it also works in Node. SVG images inside documents are turned into shapes by `src/svg.ts` for every output.

### 7. Three ways to make a PDF

![Three ways to make a PDF, and what each keeps in memory](images/architecture/07-pdf-modes.svg)

`toPdf` on a `typeset` result writes the PDF while holding the whole Area Tree. When only the PDF is needed (`typesetToPdf`, `typesetToPdfStream`), areas are built page by page from the page build trees, so the whole Area Tree is never held (page areas are built twice: once to collect fonts and images, once to paint). `typesetToPdfStream` also streams finished parts to the output.
With `lowMemory`, layout runs through `layoutLowMemory()`: pages of earlier passes are not reused, and the intermediate trees of finished page-sequences are released (layout does more work).

### 8. Fonts

![Fonts: where they come from and who uses them](images/architecture/08-fonts.svg)

Font files are registered with `FontManager` wherever they come from, and layout measuring, Canvas and PDF embedding all use the same font data. Math, monospace, symbol and emoji fonts are loaded only when the document needs them.
Measuring uses Canvas in the browser and fontkit in Node. A variable font is turned into an instance (a static font) with fixed axis values before use.

### 9. Images and drawings

![Images and drawings: detect the format, then pixels or shapes](images/architecture/09-images.svg)

Image references go to `AssetStore`, which detects the format from the content. Photographic images become pixels and drawing formats become shapes, drawn the same way in every output. EPS (a PostScript interpreter), WMF, EMF, CGM and draw.io are loaded only when that format appears.
Plugins (`ImageFormat` in `TypesetOptions.plugins`) are checked before the built-in formats.

### 10. Call context

![Call context: restore it after every await](images/architecture/10-call-context.svg)

The message language, limits, cancellation signal and progress callback apply only during one `typeset` call. In Node, AsyncLocalStorage carries them across awaits; in the browser they live in one module variable, which overlapping calls overwrite.
So every async function on the call path writes `rejoin(thisCall(), await …)` to restore its own context after the await (`test/callContextAwait.test.ts` catches a missing one).

### 11. Builds and checks

![Builds and checks](images/architecture/11-build.svg)

From the same `src`, each Vite configuration builds the library, the CLI, the browser bundle or the web app. Checks are unit tests (vitest), browser tests (Playwright) and before/after comparisons.
How to use the comparison tools is in [`docs/en/development.md`](development.md).

## Files

| File | Role |
| --- | --- |
| `src/index.ts`, `src/api.ts` | Public API (`typeset`, `createTypesetter`, `DEFAULT_FONTS`, etc. Only what is exported from `src/index.ts` is public) |
| `src/node.ts`, `src/nodeFonts.ts`, `src/resources.ts` | Helpers for Node (`kumiori/node`: the font cache and reading `file:` references), and collecting the references of the document and the CSS (`resolveResource`, fetching stylesheets) |
| `src/types.ts` | Types for the logical tree (Input), the physical tree (Area Tree) and page settings |
| `src/areaTree.ts`, `src/areaResources.ts` | Walking the Area Tree and reading/writing it as JSON ([`docs/en/area-tree.md`](area-tree.md)); the list of fonts and images used |
| `src/fontManager.ts` | Fetches TTF/OTF → `FontFace` (Canvas) + `ArrayBuffer` (PDF) + fontkit (metrics) |
| `src/fontInstancer.ts`, `src/fontVariation.ts` | Builds a static font for an instance of a variable font (OpenType Font Variations) at given axis values (gvar, HVAR, MVAR, GPOS values, FeatureVariations); carries the requested axis values |
| `src/cff2Instancer.ts` | Turns an instance of a font with CFF2 (variable CFF) outlines into a static CFF (evaluates blend / vsindex in the glyphs and rewrites them as Type 2 CharStrings) |
| `src/measurer.ts`, `src/jis.ts` | Character width measurement (both Canvas and fontkit backends), measurement for vertical writing, ruby and tate-chu-yoko, line-breaking rules (kinsoku) |
| `src/geometry.ts`, `src/lnode.ts` | Conversion between logical (inline/block) and physical coordinates, intermediate layout tree |
| `src/inlineLayout.ts`, `src/inlineFlatten.ts`, `src/lineMetrics.ts` | Line breaking (kinsoku, hanging punctuation, pushing out), inline placement, generation of line nodes for ruby/tate-chu-yoko, inline tree → sequence of characters (Atom), line height (three models: CSS, XSL and compatibility) |
| `src/warichu.ts` | Warichu (inline cutting notes; JLREQ §3.4): estimating advances before line breaking, dividing the part on each line into two lines, and brackets |
| `src/layoutEngine.ts` | Blocks, pagination, tables, absolute positioning; logical → physical (Area Tree) conversion |
| `src/footnotes.ts`, `src/tableBorders.ts`, `src/lineBreak.ts`, `src/bidi.ts`, `src/hyphenation.ts`, `src/counterStyle.ts` | Footnotes, collapsing of table borders, line break opportunities (UAX #14), bidirectional text (UAX #9), hyphenation, CSS counter-style |
| `src/paint.ts` | Area Tree traversal + trim mark geometry (shared by Canvas and PDF) |
| `src/canvasRenderer.ts`, `src/pdfRenderer.ts`, `src/pdfLibPatches.ts`, `src/matrix.ts` | Canvas / PDF renderers, replacements of pdf-lib internals (gathered in one place), matrices and Seg |
| `src/sampleData.ts`, `src/main.ts`, `index.html` | The ultimate sample and the preview UI |
| `src/htmlImport.ts`, `src/htmlPaged.ts`, `src/htmlPrepare.ts`, `src/htmlFrame.ts` | HTML+CSS import (computed values → logical tree, CSS for paged typesetting, collecting the CSS, import in the web app (the own cascade by default, a browser iframe for comparison)) |
| `src/cssCascade.ts`, `src/cssSelector.ts`, `src/cssText.ts` | CSS interpretation without a browser (cascade, computed values, selectors), CSS lexical helpers (separators, lengths, colors) |
| `src/xslfoImport.ts`, `src/foExpr.ts`, `src/foDom.ts`, `src/foContext.ts`, `src/foPageMaster.ts`, `src/foMathFallback.ts` | XSL-FO import (attributes → logical tree, expression evaluation, minimal DOM, page masters, MathML typesetting when no math font is available) |
| `src/svg.ts`, `src/svgFilterRaster.ts`, `src/mathLayout.ts` | Converting SVG to shapes (filters that cannot be approximated with shapes are computed in pixels), MathML typesetting |
| `src/jpeg.ts`, `src/webp.ts`, `src/vp8.ts`, `src/pixels.ts`, `src/ccitt.ts`, `src/imageLimits.ts`, `src/metafile.ts`, `src/cgm.ts`, `src/eps.ts`, `src/ps*.ts` (`psInterp`, `psGraphics`, `psOps*` per operator group, `psResources`, `psColorSpace`, `psFonts`, `psCff`, `psEncodings`, `psShading`, `psFilters`), `src/imageInfo.ts`, `src/imageFormats.ts`, `src/base64.ts` | Image decoding (JPEG, WebP, GIF, BMP, TIFF) and limits, conversion of WMF/EMF, CGM and EPS (PostScript interpreter) to shapes, reading image dimensions, and the hook for image formats kept outside the core and loaded only when needed |
| `src/epub.ts`, `src/xhtml.ts` | EPUB extraction, XHTML import |
| `src/fontMapping.ts`, `src/compat.ts`, `src/documentResources.ts`, `src/documentText.ts`, `src/cli.ts` | Font assignment, compatibility mode settings, fetching the math font and images, character encoding detection (shared by the web app and Node); the Node CLI |
| `src/webFont.ts`, `src/fontLoader.ts`, `src/userFonts.ts` | Converting WOFF and WOFF2 back to TTF and OTF, splitting the user's font files (including TTC) into single fonts and reading their names, storing the fonts loaded in the web app |
| `src/colorGlyph.ts`, `src/colorGlyphPdf.ts`, `src/colorGlyphCanvas.ts`, `src/colorGlyphSvg.ts` | Reading color glyphs (color emoji and the like) from the font tables and drawing them to PDF and Canvas (including glyphs in the OpenType SVG table) |
| `src/color.ts`, `src/cssColorFunctions.ts`, `src/cssGradient.ts`, `src/icc.ts`, `src/pdfStandard.ts`, `src/iccRegistry.ts`, `src/pdfxVerify.ts`, `src/srgbIcc.ts`, `src/pdfaVerify.ts` | Parsing color values, the CSS Color 4 and 5 color functions, CSS gradients, conversion to CMYK with an ICC profile, the policies for PDF/X-1a, PDF/X-3 and PDF/X-4 (with the printing condition names of the ICC registry and checking the written PDF), PDF/A-2b and 3b marking (building the sRGB ICC profile for the output intent, and checking the written PDF) |
| `src/assets.ts`, `src/linkPolicy.ts`, `src/messages.ts` | The image registry (shared by layout, Canvas and PDF), the policy for which PDF action a link leaving the document becomes, the user-facing messages (Japanese and English) |
| `src/callContext.ts` | The per-call context (settings that apply only for one `typeset` or `toPdf` call, such as the language of warnings and error messages). Kept in AsyncLocalStorage in Node and in a module variable in browsers. For this reason, every `await` in the async functions on the call path is written `rejoin(thisCall(), await …)`, which restores the context after the await (`test/callContextAwait.test.ts` catches a missing one) |
| `tools/api-docs/`, `scripts/build-api-docs.mjs` | The API reference (`npm run docs:api`; a list of pages generated by TypeDoc from the comments in the type declarations, placed under `/api/` below the web app on GitHub Pages; TypeDoc is installed in `tools/api-docs`, separately from the top-level dependencies) |
| `src/drawio/` | Reads draw.io diagrams (`.drawio`, `.dio`) and converts them to SVG (shape and edge drawing ported from the source of draw.io and mxGraph; loaded only when a diagram appears; [`docs/en/drawio.md`](drawio.md)) |

## Related documents

| Document | Contents |
| --- | --- |
| [`docs/en/REPORT.md`](REPORT.md) | Details of the typesetting algorithms |
| [`docs/en/xslfo-import.md`](xslfo-import.md) | XSL-FO import |
| [`docs/en/html-css-plan.md`](html-css-plan.md) | The plan for HTML+CSS import |
| [`docs/en/conformance.md`](conformance.md) | Per-item descriptions of the supported specifications (the Conformance Guide; `npm run docs:conformance` turns it into PDFs; the PDFs for each version are attached to the GitHub release) |
| [`docs/en/BACKLOG.md`](BACKLOG.md) | Features not yet available and known limitations |
| [`docs/en/area-tree.md`](area-tree.md) | The JSON of the typeset result (Area Tree) |
