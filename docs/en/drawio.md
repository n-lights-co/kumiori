> English translation of [drawio.md](../drawio.md) (the Japanese text is the original).

# draw.io Diagrams

Kumiori reads draw.io (diagrams.net) diagram files (`.drawio`, `.dio`; mxGraph XML, including compressed pages) directly as images.
A page of the diagram is converted to SVG and placed in the PDF as shapes and text (not as a raster image). The first page is drawn; other pages are selected after `#` in the reference ([Selecting a page](#selecting-a-page)).

Kumiori is not affiliated with draw.io (JGraph Ltd, draw.io AG); draw.io is a registered trademark.

Diagrams are read by default (turn this off with `drawio: false` in the API, `--no-drawio` on the command line, or "draw.io の図を読む" (Read draw.io diagrams) in the settings of the web app).
The code that draws diagrams (including rough.js) is loaded only when a draw.io diagram appears in the document (as for CGM, EPS, WMF and EMF; in the web app and the browser library it is a separate file).
The code is in `src/drawio/`.

## Usage

### API

```js
import { typeset } from 'kumiori';

const r = await typeset('<p><img src="fig.drawio"></p>', {
  files: [{ name: 'fig.drawio', data: figBytes }],
  drawio: { fetchStencils: true },
});
```

Options of `TypesetOptions.drawio` (the type is `DrawioOptions`; `false` means draw.io diagrams are not read as images):

- `stencils`: shape library files (an array of `{ name, data }`): draw.io's distributed `js/stencils.min.js` (all of draw.io's libraries) or library XML (`<shapes name="mxgraph.…">`). Files named `.svg`, `.png` or `.jpg` are images from draw.io's distribution (the images inside SAP icons in `img/lib/sap/`, clip art in `img/lib/clip_art/` and so on), looked up by file name
- `fetchStencils`: whether to fetch shape libraries and distribution images a diagram uses but `stencils` lacks from draw.io's distribution. Default `false` (no fetching; shapes that cannot be drawn get only their text, with a warning). `true` fetches from draw.io's public repository at a pinned version (`stencils.min.js` for the libraries, about 6.6MB); a string fetches that URL's `stencils.min.js` and the images under the same location. A function `(path, { url, fetch }) => content` is called with the path inside the distribution (`js/stencils.min.js`, `img/lib/sap/<name>.svg` and so on) when needed (use it to keep a local copy)
- `stencilsUrl`: where to fetch from when `fetchStencils` is `true` or a function (the URL of `stencils.min.js`)
- `provideStencils`: a function that keeps the shape library registry outside typesetting (`(libraries, images) => registry`). It is called with the names of the missing libraries (`aws4` and so on) and the paths of the missing images from draw.io's distribution, and the diagram is drawn again with the registry it returns. Create the registry (the type `DrawioStencilRegistry`) with `createDrawioStencilRegistry(files)` (`files` has the same form as `stencils`; a file that cannot be read is rejected), and add what is missing with the registry's `add(text of the contents, file name)` and `addImage(path in the distribution or file name, contents)`. When given, `stencils` and `fetchStencils` are not used

Images given by URL (http(s)) in a diagram are fetched under the same rules as the document's images (`resolveResource`, `fetchImages`).
Text widths (line wrapping, button widths and so on) are measured with the fonts Kumiori uses to draw the text in the PDF.
Warnings are written in Japanese or English, following `lang` (`--lang` or the environment on the command line).

`kumiori` exports the MIME type of draw.io diagrams `DRAWIO_MIME`, `isDrawio` (which checks whether content is a draw.io diagram) and the types (`DrawioOptions`, `DrawioFile`, `DrawioFileData`, `DrawioStencilFetcher`).
When a plugin (`plugins`) that reads the same extensions or content is passed, the plugin's formats are checked first.

### Command line

```sh
kumiori doc.html --drawio-stencils ./stencils --fetch-drawio-stencils
```

- `--drawio-stencils <file or directory>`: shape libraries and distribution images (for a directory, the `.xml`, `.js`, `.svg`, `.png` and `.jpg` files in it, including subdirectories); separate several with `,` (repeatable)
- `--fetch-drawio-stencils`: allows fetching missing shape libraries and distribution images from draw.io's distribution (v24.7.5). Fetched files are saved in the font cache directory (`--font-cache`) and reused without the network (not saved with `--no-font-cache`)
- `--drawio-stencils-url <URL>`: the URL (http(s)) of the `stencils.min.js` to fetch; implies `--fetch-drawio-stencils`
- `--no-drawio`: do not read draw.io diagrams (`.drawio`, `.dio`) as images

`--watch` also watches `.drawio` and `.dio` files.

### Web app

In the "draw.io の図" (draw.io diagrams) section of the web app's settings (demo), you can turn reading diagrams on or off (on by default; when off, the code that draws diagrams is not loaded), load shape library files (remembered in the browser) and clear them, and choose to fetch them from draw.io only when a diagram needs them (off by default).
Shape libraries (`stencils.min.js` or library XML) passed together with the opened files are used for that page session only.

## Selecting a page

When a file has several pages (the tabs at the bottom of the draw.io editor), select the page to draw after `#` in the image reference. Without one, the first page is drawn.

```html
<img src="fig.drawio">              <!-- the first page -->
<img src="fig.drawio#page=2">       <!-- the second page (counted from 1) -->
<img src="fig.drawio#page-id=abc">  <!-- the page whose id is abc (<diagram id="…"> in the file) -->
<img src="fig.drawio#Details">      <!-- the page named "Details" (or, if none, the page whose id is "Details") -->
```

- `page=N` counts from 1, like `#page=N` for PDF (the `page` parameter in draw.io's editor URLs counts from 0, so it is off by one)
- Spaces and non-ASCII characters in a name may also be written as `%20`, `%E8%A9%B3…` and so on
- For a page that does not exist, the first page is drawn with a warning
- Different pages of the same file can be used in one document (each becomes its own image; up to 64 distinct references after `#` per file)

Example: [`examples/drawio-pages/`](../../examples/drawio-pages/README.en.md) (a 3-page diagram and documents using each form, in HTML and XSL-FO)

## What is drawn

Shapes, edges and arrows are drawn by code ported from the public source code of draw.io and mxGraph (Apache License 2.0).

- Standard shapes (UML, sequence diagrams, flowcharts, git, mermaid and so on), icon frames such as AWS, GCP and Cisco, swimlanes and tables
- Shapes that draw.io draws in JavaScript (about 750 shapes in `shapes/*.js`: mockups, ArchiMate, BPMN, lean mapping, floor plans, ER diagrams, AWS 3D, electrical circuits, iOS screens, UI, arrows and so on)
- Shapes from shape libraries (`mxgraph.*`) and shapes embedded in the diagram (`stencil(…)`); libraries only when passed or when fetching is allowed
- Edges: orthogonal, self-loops, sequence messages, curved, line jumps, thick arrows (`flexArrow`, the tapered `taperedArrow` and so on), 34 edge end types
- Text with HTML formatting (wrapping, per-line alignment), label placement per shape (`boundedLbl`), curved text (`curvedText`)
- Shadows (shape, text and whole-diagram shadows), the glass effect, gradients (including end opacities), the sketch style (`sketch`, rough.js) and jiggled lines (`comic`)
- Images (`data:` PNG, JPEG and SVG, images given by URL, images from draw.io's distribution)

Not drawn, or possibly different:

- Shapes whose library is missing get only their text, with a warning
- Text widths are measured with the fonts Kumiori draws with, so lines may break at different places than in draw.io
- Shapes and style keys added to draw.io after v24.7.5 are not read (such shapes (`mxgraph.archimate4.*`, `mxgraph.bpmn.task2` and so on) get only their text, with a warning, even when shape libraries are given; see "Terms of the shape libraries" below)
- To guard against crafted diagrams that exhaust time or memory from small files, there are limits on how much is read and drawn (the values and reasons are in `LIMITS` in `src/drawio/drawio.ts` and elsewhere). Parts beyond a limit are not drawn and a warning is given

## Terms of the shape libraries

Kumiori does not include the data of draw.io's shape libraries (the XML in `stencils/` and `js/stencils.min.js`) or the icon images.
The shapes written in JavaScript (`src/drawio/drawioJs/`: AWS 3D, mockups, electrical diagrams and so on) are rewrites of the shapes in draw.io's `shapes/`.
Since v29.3.2 (2026-01), draw.io has put a LICENSE on `shapes/`, `stencils/` and `img/` that forbids their use in Atlassian products and products for the Atlassian marketplace or plugin ecosystem.
The shapes from `shapes/` in Kumiori are ported from v24.7.5 (2024-07), before that restriction, when `shapes/` was covered only by the Apache License 2.0 of the whole repository, and they follow the drawing of v24.7.5 (shapes added after v24.7.5 are not included).
The shape libraries and images fetched with `fetchStencils` (`--fetch-drawio-stencils` on the command line) are also from v24.7.5 by default, and are licensed under Creative Commons Attribution 4.0 (CC BY 4.0).
Shape libraries and images you pass with `stencils` (`--drawio-stencils`), or fetch from another version with a URL in `fetchStencils` (`--drawio-stencils-url`), are subject to the LICENSE of that version.

Without `fetchStencils` (the default), the shape libraries and the images of the distribution are not fetched from the network (shapes that need a shape library are drawn as text only, with a warning).

When you hand out or publish a PDF that contains icons from fetched shape libraries or images, give credit as required by the attribution conditions of CC BY 4.0 (section 3).
CC BY 4.0 allows any reasonable manner based on the medium and context, so you can, for example, write the following in the colophon or a note to the figure.

> Some icons in the figures are from the shape libraries of draw.io (JGraph Ltd), v24.7.5, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)

- When you do not provide the PDF to others (for example, you use it only yourself or within your organization), these conditions do not apply.
- The shapes written in JavaScript (`src/drawio/drawioJs/`) are drawn by code under the Apache License 2.0 (ported from draw.io's `shapes/*.js`), not by shape library data.
  For that reason, we consider this CC BY 4.0 credit not to be needed for them.
  However, as described below, draw.io's README licenses "the JGraph provided icons" under CC BY 4.0, and shapes that draw icons (such as the AWS 3D shapes `mxgraph.aws3d.*`) could be read as such icons.
  When you hand out or publish a PDF that contains such shapes, it is safer to add the same credit as in the example above, just in case (even without `fetchStencils`).
- Icons of AWS, Azure, Cisco, Google Cloud and others are also trademarks of their companies, and CC BY 4.0 does not license the use of trademarks (section 2(b)(2)). When you use those icons, check each company's rules for using its icons as well.
- Some of the shapes written in JavaScript (`src/drawio/drawioJs/`) also draw icons and screen parts of other companies' products (AWS 3D `mxgraph.aws3d.*`, the Atlassian Jira issue `mxgraph.atlassian.issue`, and parts of iOS, Android, Material Design and Bootstrap: `mxgraph.ios.*`, `mxgraph.android.*`, `mxgraph.gmdl.*`, `mxgraph.bootstrap.*` and so on). Their names and designs (including trademarks) belong to their companies; Kumiori is not affiliated with them, and the fact that Kumiori can draw these shapes does not mean any endorsement by them.
  The README of draw.io v24.7.5 says that the source code authored by draw.io is under the Apache License 2.0, that the icons and diagram templates provided by JGraph are under CC BY 4.0, and that additional terms may apply where an icon was originally defined by a third-party copyright holder. Kumiori treats `shapes/*.js` as source code (Apache License 2.0) (section 13 of THIRD_PARTY_NOTICES.md).
  When you hand out or publish a PDF that contains these shapes, check each company's rules for using its trademarks and brand as well.
- This section does not give an interpretation of the licenses or legal advice.

The list of sources ported from draw.io and mxGraph, their copyright notices and the versions they were ported from are in section 13 of [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
