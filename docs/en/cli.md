> 日本語: [../cli.md](../cli.md)

# kumiori (Node CLI)

A command that typesets HTML+CSS and XSL-FO documents to PDF (and to SVG or PNG, page by page) without a browser.
When installed from npm the command is `kumiori` (or `npx kumiori` to use it without installing); when built in this repository (`npm run build:cli`), `node dist-cli/cli.js` is the same command.

- [Synopsis](#synopsis)
- [Common examples](#common-examples)
- [Options](#options)
  - [Basics](#basics) · [Input and output location](#input-and-output-location) · [Output format](#output-format) · [Style and compatibility](#style-and-compatibility) · [Fonts](#fonts)
  - [Print (trim marks, spot colors, PDF/X)](#print-trim-marks-spot-colors-pdfx) · [PDF/A](#pdfa) · [Tagged PDF and PDF/UA](#tagged-pdf-and-pdfua)
  - [Links](#links) · [External fetching and file access](#external-fetching-and-file-access) · [Memory](#memory) · [Diagnostics](#diagnostics) · [draw.io diagrams](#drawio-diagrams) · [Plugins](#plugins)
- [How input is read](#how-input-is-read)
- [Limits and memory](#limits-and-memory)
- [Detailed examples and output](#detailed-examples-and-output)
- [Environment variables](#environment-variables)
- [Exit status](#exit-status)

## Synopsis

```text
kumiori <HTML file> [-o <PDF file>] [option]...
kumiori <FO file (.fo, .xml)> [-o <PDF file>] [option]...
kumiori <input>... -o <output directory> [option]...
kumiori - [-o -] [--base <directory>] [option]... < input > output.pdf
kumiori --help | --version
```

Notation:

- `<required argument>`: a value to substitute (`<HTML file>` is `book.html` and so on)
- `[optional option or argument]`: may be omitted
- `a|b`: write one of them (`--format pdf|svg|png` means `--format svg` and so on)
- `...`: may be repeated

`--help` lists every option (in English with `--lang en`). Options may be written in any order, before or after the inputs. An unknown option or an invalid value is an error, and nothing is written ([Exit status](#exit-status)). If the value of an option that takes a value is the name of another option (`--print` in `-o --print`, for example), it is taken as a missing value and is an error (to use a file with that name, write it like `./--print`). Values cannot be empty: an empty value (`''`; for comma-separated lists, also a value with no items) for an option that takes a file, directory or plugin path (`-o`, `--font-dir`, `--font-cache`, `--font`, `--css`, `--base`, `--spot-colors`, `--output-profile`, `--drawio-stencils`, `--plugin`) or a name (`--ignore-warning`, `--output-condition`) is an invalid value, not the current directory or "not given". Control characters (such as ESC) in error messages are written in a visible form, like `\x1b`.

## Common examples

**HTML to PDF**

```bash
kumiori book.html -o book.pdf
```

**XSL-FO to PDF**

```bash
kumiori book.fo -o book.pdf
```

**Convert several files (into an output directory)**

```bash
kumiori a.html b.fo c.html -o out
```

**Re-typeset on every change**

```bash
kumiori book.html --watch
```

**Read from standard input and write to standard output**

```bash
cat book.html | kumiori - -o - --base . > book.pdf
```

**Pages as PNG (150dpi, pages 1 to 3)**

```bash
kumiori book.html -o book.png --dpi 150 --pages 1-3
```

**Pages as SVG**

```bash
kumiori book.html -o book.svg
```

**PDF/X-4 for print submission (with trim marks and bleed)**

```bash
kumiori book.html -o book.pdf --print --pdfx x4 --output-profile JapanColor2001Coated.icc
```

**PDF/A-3b for long-term archiving**

```bash
kumiori book.html -o book.pdf --pdfa 3b
```

**PDF/UA-1 (accessible tagged PDF)**

```bash
kumiori book.html -o book.pdf --pdfua --document-lang ja
```

**Typeset with local fonts**

```bash
kumiori book.html -o book.pdf --font BIZUDMincho-Regular.ttf --generic-font serif-cjk="BIZ UDMincho"
```

**Typeset a document written by someone else, with fetching and outside files turned off**

```bash
kumiori upload.html -o upload.pdf --no-fetch-images --no-fetch-styles --no-outside-files
```

**Print diagnostics as JSON, and fail CI on warnings**

```bash
kumiori book.html -o book.pdf --diagnostics json --fail-on warning
```

## Options

A "—" in the "Default" column means that the behavior is off unless the option is given. Options marked "repeatable" may be given several times.

### Basics

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `-h`, `--help` | — | — | print the usage to standard output and exit (exit code 0) |
| `-v`, `--version` | — | — | print the version to standard output and exit (exit code 0) |
| `--lang` | `ja` \| `en` | from the environment ([Environment variables](#environment-variables)); `ja` if undecided | language of the usage text, reports, warnings and error messages |

### Input and output location

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| (input) | a file, or `-` | — (required) | the document to typeset. `.html`, `.htm`, `.xhtml` and `.xht` are HTML; `.fo` and `.xml` are XSL-FO. `-` is standard input |
| `-o`, `--output` | file, directory or `-` | `<input name>.pdf` (`.svg`, `.png`) next to the input | the output file; the output directory when there are several inputs, when it is an existing directory, or when it ends with `/` (a directory is not allowed with standard input); `-` is standard output. ⚠️ An existing file is overwritten without asking |
| `--base` | directory | the current directory | directory where CSS, images and fonts of a document read from standard input (`-`) are looked up |
| `--fo` | — | decided by the extension | read as XSL-FO regardless of the extension |
| `--xhtml` | — | decided by the extension | read HTML with XML syntax (XHTML) regardless of the extension |
| `--watch` | — | — | re-typeset whenever the HTML, FO, CSS, images or fonts in the input's directory change (Ctrl+C to stop); not with standard input |

- With several inputs, `-o` is the output directory (created if missing; an error (exit code 1) if it is an existing file; without `-o`, each output is written next to its input). If one fails, the others are still produced (the exit code is 1). When output names collide (`a.html` and `a.fo` in the same directory, or inputs with the same name from different directories going to one output directory), later ones keep the input name with its extension (`a.fo.pdf`, `a.html.pdf`); if that still collides, `.2`, `.3`, … is added (`a.html.2.pdf`). A mark like `-2` is not used, because it would clash with the page numbers of `--format svg` and `png` (`a-2.svg`). Even with a single input, if `-o` is an existing directory, `<input name>.pdf` (`.svg` or `.png` with `--format svg` or `png`) is written inside it
- With a single input, an `-o` ending with `/` (also `\` on Windows) is taken as a directory: if it exists, `<input name>.pdf` is written inside it; if it does not exist or is a file, this is an error (exit code 1; the directory is not created). A name not ending with `/` that does not exist is taken as a file name (`-o out` writes a file named `out`)
- ⚠️ An existing output file is overwritten without asking. However, if the output is a file the conversion reads (the input (including the file behind standard input), the images, CSS and fonts the document uses, the fonts read from `--font-dir` and `--font-cache`, the files of `--css`, `--font`, `--spot-colors`, `--output-profile`, `--drawio-stencils` and `--plugin`, and the files under a directory given to `--drawio-stencils`; a hard-linked alias counts as the same file), or an output written from another input in the same run (`a-2.svg` of `a.html` and `a-2.svg` of `a-2.html`, for example), nothing is written and it is an error (exit code 1; `-o one.html` does not overwrite the input, and typesetting `fig.html` with `<img src="fig.svg">` as `--format svg` does not erase the image `fig.svg`). With `--format svg` or `png`, all pages of a multi-page document are checked before any is written, so on an error no page is written. Only the files read for that input's conversion are checked, so with several inputs, the output of a later input can still overwrite an image read by an earlier one (if `a.html` uses `b.svg` and `b.html` is typeset with `--format svg`, `b.svg` becomes the page of `b.html`; use `-o` to write elsewhere to avoid this). When the same input is given more than once (the same name in the same directory, as in `a.html a.html` or `./a.html a.html`), it is typeset only once, with a note (a symbolic link or a hard-linked alias in another directory is typeset as a separate input). On machines whose file systems ignore case (macOS, Windows), the output names of `A.html` and `a.fo` are also treated as colliding. With a single input, a missing directory for the `-o` file (`-o nodir/book.pdf`) is an error
- A PDF (other than with `--pdfx` and `--pdfa`) is written page by page as a stream to a temporary file in the directory of the output file (`<output>.part-<random>`) and renamed when it is complete (the API's `typesetToPdfStream`; the whole PDF is not held in memory). If writing fails or is interrupted (including stopping with SIGINT from Ctrl+C, SIGTERM or SIGHUP), the temporary file is removed, so no half-written PDF is left and the previous output stays as it was (with `--watch`, a PDF open in a viewer is never half-written). The temporary file is created when layout is done and writing the PDF begins. With `--low-memory`, a signal received while writing may be handled only when typesetting reaches a point where it can wait. Because the file is renamed, the permission bits (mode) of the previous output are copied, but its owner, group, ACLs and extended attributes are not kept, and a hard-linked alias keeps the previous contents. When the output is a symbolic link (including `-o /dev/stdout`) or not a regular file, the whole PDF is made before it is written, as with standard output (`-o -`) and with `--pdfx` and `--pdfa`. For a read-only previous output, and where the temporary file cannot be created (the output directory is not writable, the name is too long, the directory does not exist and so on), the whole PDF is also made before it is written directly to the output (with the same errors as before)
- The value of `-o` cannot be empty (`-o ''` is an invalid-value error, exit code 1; it is not treated as if `-o` were not given)
- `-` reads from standard input (CSS, images and fonts come from the `--base` directory; whether the input is FO is detected from its content). `-o -` writes the PDF to standard output (reports go to standard error). Standard input cannot be combined with other inputs or with `--watch`; since a document read from standard input has no name, `-o` cannot end with `/` or be an existing directory (an error, exit code 1; give a file name such as `-o out.pdf`); and `-o -` cannot be used with several inputs (it can when the same input is given several times and they are merged into one)
- The character encoding of the input is determined from the BOM, the XML declaration's `encoding` (`Shift_JIS`, `EUC-JP`, etc.) and HTML's `<meta charset>` (UTF-8 if none)
- The conversion report (`book.pdf: 3 pages (layout 40ms)`) goes to standard output (to standard error with `-o -`, and when the output is the same as standard output, as in `-o /dev/stdout > out.pdf` or `-o /dev/stdout | cat > out.pdf`). Diagnostics go to standard error ([Diagnostics](#diagnostics))

### Output format

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--format` | `pdf` \| `svg` \| `png` | `pdf` (`svg` or `png` when `-o` ends with `.svg` or `.png`, unless `-o` is a directory) | the output format; `svg` and `png` write each page |
| `--pages` | range (`1-3,5,7-`) | all pages | pages to write as SVG or PNG (1-based); only with `--format svg` or `png` |
| `--dpi` | number (above 0, up to 2400) | `96` | the PNG resolution (pixels per inch); only with `--format png` |
| `--max-pages` | integer of 1 or more | all pages | stop after laying out the first N pages (previewing long documents); works for PDF, SVG and PNG |

- A `--format` that does not match the `-o` extension (`.pdf`, `.svg` or `.png`) is an error
- `png` writes pages as PNG (8-bit RGB on white paper; rasterized by Kumiori itself with no added dependencies). What is not drawn is the same as for SVG, and in addition CMYK JPEG and interlaced PNG images are not drawn and a warning is given. For the limits, see [Limits and memory](#limits-and-memory)
- `svg` writes pages as SVG (glyphs become outline paths and images are embedded in the SVG, so it can be drawn without the font and image files; the size is the paper size in pt)
- For SVG and PNG too, as in the PDF, a child of `switch` in SVG images is chosen by `--svg-lang`, and the content of `foreignObject` is typeset like the body text and drawn
- When the document has several pages, each page goes to a name with `-<number>` added (`book-1.svg`, `book-2.svg`, …; the numbers are padded to the number of digits of the page count), even when only one page is chosen with `--pages`. `-o -` (standard output) only when a single page is written
- `--pages` takes page numbers and ranges separated by commas (`7-` is page 7 to the end). Naming a page the document does not have is an error, and nothing is written
- `--dpi` is written with digits and a decimal point (`150`, `72.5`); up to 40 million pixels per image
- `--max-pages` is the same as `maxPages` of the API ("Laying out only the first pages" in [`docs/en/library.md`](library.md)). When it stops, the report line says "`stopped by --max-pages N`" and the info diagnostic `layout/max-pages-reached` is reported
  - Page number references, last page numbers and the total page count pointing after page N are set as `"?"` (empty with `--style weasyprint`), index lists list only the places within the first N pages, and bookmarks pointing there have no destination; one `layout/beyond-max-pages` warning is reported for each kind
  - The layout of the kept pages is the same as for the whole document as long as their body text has nothing pointing after page N. If it has, those references become `"?"`, and the difference in width from the real number can move line breaks and page breaks (a table of contents with the number after a leader rarely changes). References only in running heads change only their own text
  - What gets faster is laying out and writing the PDF; reading the document and the cascade are done for the whole document
  - A `--pages` range pointing after page N is an error, as a page the document does not have
- SVG gets links (links on the pages and links inside SVG images) that pass the same rules as the PDF (`--link-schemes`, `--link-launch`, `--link-relative`; see [Links](#links)). A link to another page of the document becomes the file name that page is written to with `#id` added (`book-3.svg#id`, in the same directory; pages not chosen with `--pages` get that name too), and a link within the same page becomes `#id` (links to other pages are not written when writing to standard output). ⚠️ When the written SVG is shown with an HTML `img`, browsers do not let its links be followed (they can be followed when the SVG is opened directly or put straight into HTML)
- PNG gets no links. SVG and PNG get no annotations or form fields. They cannot be combined with options that only apply to PDF (`--pdfx`, `--pdfa`, `--pdfua`, `--output-profile`, `--output-condition`, `--tagged`, `--image-max-dpi`, `--low-memory`)

### Style and compatibility

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--style` | `kumiori` \| `browser` \| `browser-margin` \| `ah` \| `vivliostyle` \| `weasyprint` | `kumiori` | the default style for HTML (the same as "Default style" under "Settings" in the web app); `ah`, `vivliostyle` and `weasyprint` are compatibility styles that follow other formatters |
| `--compat` | `spec` \| `antenna` | `spec` | the XSL-FO default-value convention (`spec`: XSL-FO 1.1 initial values / `antenna`: AH Formatter compatible defaults); other values are an error |
| `--page-size` | paper (`A5`, `"A5 landscape"`, `148mm,210mm`) | `A4` | the default paper for HTML (the paper of a document that does not specify `size` in `@page`); not used for XSL-FO |
| `--css` | CSS files (`a.css,b.css`) | only the CSS referenced by the HTML | selects the CSS to use (comma-separated for several) |
| `--svg-lang` | language tags (`ja,en`) | the environment language | languages to match SVG `systemLanguage` against |

- `--page-size` is written like the CSS `size` property: a paper name (`A5`, `JIS-B5`, `letter`, etc.), a name with an orientation (`"A5 landscape"`), or a width and height (`148mm,210mm`; separated by a space or a comma; lengths of 1pt or more). A `@page { size: … }` in the document wins. `width` and `height` in `@media` are also evaluated against this paper
- `--css`: CSS, images and fonts in the same directory as the HTML (and in subdirectories) are used (the same as selecting them together in the web app). Only images whose names appear in the document and the CSS are read. Only CSS referenced by the HTML (`<link>`, `@import`) is used (unreferenced CSS is not applied, and a warning says so). CSS named with `--css` is used together with its `@import` targets, and is added as a user stylesheet even if the HTML does not reference it
- `--svg-lang` gives the languages to match SVG `systemLanguage` (the condition that picks a child of `switch`) against (language tags separated by commas, in order of preference). A language given where the SVG is placed (`lang`, `xml:lang`, `language`) wins. The default "environment language" is the language of Node's `Intl` (decided by locale variables such as `LANG`; see [Environment variables](#environment-variables))
- `--compat` is for XSL-FO and `--style` for HTML. For behavior that changes with the compatibility options, such as how `rgb-icc()` is read, see the description of each option

### Fonts

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--font` | font file (TTF, OTF, TTC, WOFF, WOFF2) | — | adds a font (repeatable), used from `font-family` like a font installed on the system |
| `--generic-font` | `<generic>=<family>` | Latin: Tinos, Arimo, Cousine; Japanese: Noto Serif JP, Noto Sans JP | the font used for a generic font family (repeatable) |
| `--font-dir` | directory | — | directory of the default fonts (otherwise the cache, then Google Fonts) |
| `--font-cache` | directory | the environment variable `KUMIORI_FONT_CACHE`, or else the OS cache | directory where the default fonts fetched from Google Fonts are saved and reused |
| `--no-font-cache` | — | — | neither reads nor writes the font cache (fetches from Google Fonts every time) |
| `--system-fonts` | — | not used | sets characters no loaded font has a glyph for in OS fonts; cannot be combined with `--no-outside-files` |

- The default fonts are Noto Serif JP, Noto Sans JP, Tinos and Arimo (Cousine when monospace is specified, STIX Two Math when there is MathML, Noto Sans Symbols 2 when there are symbols found in none of the fonts, and Noto Emoji when there are emoji found in none of them either). They are not included in the package; they are read from `--font-dir`, then the font cache, then the network (Google Fonts). Once read, they are reused for every conversion of the run
- `--font-dir <dir>`: the directory from which the default fonts (`NotoSerifJP-Regular.ttf`, `NotoSerifJP-Bold.ttf`, `NotoSansJP-Regular.ttf`, `NotoSansJP-Bold.ttf`, `Tinos-*.ttf`, `Arimo-*.ttf`, `Cousine-*.ttf` when monospace is specified, `STIXTwoMath-Regular.ttf` when there is MathML, `NotoSansSymbols2-Regular.ttf` when there are symbols found in none of the fonts, and `NotoEmoji-Regular.ttf` when there are emoji found in none of them either) are read from files with the same names. If a bold file (`-Bold`) has the same contents as the `-Regular` file of the same font, the font is treated as having no bold face and bold text is drawn by emboldening Regular (for replacing a default font with one that has no bold face). When replacing the default fonts with your own, place the bold files too (`NotoSerifJP-Bold.ttf`, `NotoSansJP-Bold.ttf` and so on): a file that is not there comes from the cache or the network as the default font, and gets mixed with the replaced fonts
- `--font-cache <dir>`: the default is the environment variable `KUMIORI_FONT_CACHE`, or else the OS cache (on Linux `kumiori/fonts` under `$XDG_CACHE_HOME` or `~/.cache`, on macOS `~/Library/Caches/kumiori/fonts`, on Windows `%LOCALAPPDATA%\kumiori\fonts`). Fonts are fetched from the network only the first time, with the message `fetched the font … and saved it to …`. From the second run on, the network is not used. Anything that is not a font file, such as an interrupted download, is not saved, and a corrupt cache is discarded and fetched again. Conversion continues even where the cache cannot be written. For offline use, run once online to fill the cache, or specify the directory to read with `--font-dir`
- `--font <font file>`: for a TTC, each font inside is added. Fonts are registered by the family name in the font's name table and the weight, width and slant in its OS/2 table. Faces within a family are matched by width (`font-stretch`), then slant (`font-style`), then weight (`font-weight`) (CSS Fonts 4 §5.2). When an italic or oblique font file is given, `font-style: italic` / `oblique` text is set in that face (otherwise the upright glyphs are slanted). A face of a different width (such as Arial Narrow, which shares the family name and has a narrower width) is selected by `font-stretch`, or by the name of that face alone (`font-family: "Arial Narrow"`); when the family has no face of another width, the glyphs are scaled horizontally. A variable font (OpenType Font Variations, with TrueType outlines or CFF2 outlines) is used over the full range of its axes such as weight and width: the shape matching `font-weight`, `font-stretch`, `font-variation-settings` and so on is built and used (each shape in use is embedded in the PDF as a static font; a CFF2 variable font is rebuilt as static CFF fonts)
- How a font is chosen for each character: the `font-family` list is tried in order for each character, and the first font that has the character is used (generic names and the names of the default fonts are also looked up at their position in the list). Characters that no font in the list has are looked up in the default fonts and then in added fonts that are not in the list. In compatibility styles such as `--style ah`, fonts are also selected by the PostScript name written in SVG's `font-family` (e.g. `'CenturyGothic'`). For XSL-FO, font files (TTF, OTF, TTC) in the same directory as the input are also used by the name in the FO's `font-family`
- `--generic-font <generic>=<family>`: the family name of a font added with `--font` or of a default font. `serif`, `sans-serif` and `monospace` set the font for Latin text; `serif-cjk` and `sans-serif-cjk` set the font for Japanese text. Japanese text in monospace uses the `sans-serif-cjk` font in HTML and the `serif-cjk` font in XSL-FO. Example: `--font BIZUDMincho-Regular.ttf --generic-font serif-cjk="BIZ UDMincho"`
- Fonts for Arabic, Thai, Devanagari, Hangul, Simplified and Traditional Chinese, (color) emoji and so on are not among the default fonts; pass them with `--font`
- `--system-fonts`: characters for which none of the default fonts nor the symbol and emoji fonts has a glyph are looked up in the OS font locations (on Windows, `%WINDIR%\Fonts` and `%LOCALAPPDATA%\Microsoft\Windows\Fonts`; on macOS, `/System/Library/Fonts`, `/Library/Fonts` and `~/Library/Fonts`; on Linux and others, the `<dir>` entries of the fontconfig configuration (`FONTCONFIG_FILE`, `FONTCONFIG_PATH`, `/etc/fonts/fonts.conf`), or, if no configuration can be read, the XDG locations (`~/.local/share/fonts`, `/usr/share/fonts` and so on); the environment variables read are in the table under [Environment variables](#environment-variables)) and set in the font found. Only those characters are set in OS fonts; the fonts of other characters do not change. Characters in a serif (Mincho) context prefer a serif font and those in a sans-serif (Gothic) context a sans-serif one, and fonts that cannot be embedded in PDF (OS/2 `fsType`) are not used. The result depends on the fonts of the machine, so this is off by default. The fonts used are reported by the `font/system-fallback` notice (printed with `--verbose`). The OS font folders are outside the input directory, so this cannot be combined with `--no-outside-files` (an error). When characters have no glyph and `--system-fonts` is not given, "(--system-fonts looks for the glyphs in the OS fonts)" is added after the diagnostics

### Print (trim marks, spot colors, PDF/X)

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--print` | — | — | add trim marks and 3mm bleed |
| `--spot-colors` | JSON file | — (painted with the alternate RGB) | spot color names and the alternate CMYK at 100% tint |
| `--image-max-dpi` | number (1 or more, written with digits and a decimal point, such as `300` or `150.5`) | left as is | JPEG photos finer than this relative to the size they are placed at are downscaled to this resolution and re-encoded (makes the PDF smaller) |
| `--pdfx` | `x1a` \| `x1a:2003` \| `x3` \| `x4` | — | write PDF/X-1a:2001, PDF/X-1a:2003, PDF/X-3:2003 or PDF/X-4 markers for print submission. ⚠️ Links, annotations and form fields on the pages are not written |
| `--output-profile` | ICC file | — | output CMYK ICC profile; required with `--pdfx x4` |
| `--output-condition` | name | the description (desc) of `--output-profile`; `JC200103` without one | printing condition name (such as an ICC registry name) |

- `--spot-colors <JSON file>`: `{"name": "cmyk(20%,40%,60%,80%)"}` or `{"name": [0.2,0.4,0.6,0.8]}` (the array holds numbers from 0 to 1, and a value over 1 is an error). Among `rgb-icc(r,g,b,#Separation,'name',tint)` colors, those whose name is listed here are written as a PDF Separation (the alternate color space is DeviceCMYK, and the tint transform is linear). `rgb-icc()` is read with either `--compat` in XSL-FO, and only with `--style ah` in HTML (it is an Antenna House form, not a CSS color function; with the other styles the declaration is ignored as an invalid value and reported in a warning). Those whose name is not listed are written with the alternate RGB. Names are written in UTF-8 (ISO 32000-2 §7.3.5). Spot color values (such as those of swatch books) are not included in Kumiori; the user supplies them
- `--pdfx x1a|x1a:2003|x3|x4`:
  - RGB colors and images are converted to CMYK, gray text, lines and fills become K-only CMYK, and K-only black body text under 12pt (including text in the page margins) and lines and rules under 2pt are overprinted (as recommended by the Ghent Workgroup submission specification GWG 2022; text and lines inside images such as SVG and EPS are not). Pages get a TrimBox only
  - ⚠️ Links, annotations and form fields on the pages are left out, with their number reported in a notice (`pdfx/annotations-dropped`; actions left out are counted in `pdfx/actions-dropped`), which is not shown by default but appears with `--verbose` or `--diagnostics json` (anything that overlaps the area up to the bleed (BleedBox) even slightly is left out; the BleedBox encloses the whole artwork of the page, so practically all links are lost, both internal ones such as those of a table of contents and those to external URLs; bookmarks are kept). Write PDFs for reading on screen without `--pdfx`. PDF/X does not allow actions, so external bookmark destinations (URLs, other PDFs) and annotations with actions left outside the bleed area are not written either, with their number reported in a warning (bookmarks keep their titles and destinations within the document)
  - Of the GWG 2022 requirements, differing finished page sizes, spot colors and coarse images (149ppi or less, and 224ppi or less) are also reported as warnings (with the values of the sheet-fed commercial variant)
  - PDF/X-4 keeps transparency as is, writes the version marker in the XMP metadata, and does not draw characters with no glyph (.notdef). For PDF/X-1a (CMYK and spot colors only, no transparency; :2001 is PDF 1.3, :2003 is PDF 1.4), PDF/X-3 (no transparency; device-independent color (ICC, Lab) is allowed; PDF 1.4) and PDF/X-4, the written PDF is read back and checked against the rules (version, markers, output intent, color spaces, transparency, graphics state and halftones, PostScript, filters, actions and JavaScript, font embedding, boxes, annotations, and for X-4 also the XMP metadata and its consistency with Info), and writing fails if it does not meet them
  - X-1a and X-3 flatten transparency: when only a single-color fill (a box background or the white page) lies under a transparent object (opacity, colors with alpha, images with alpha, translucency and masks in SVG), it is drawn as an opaque vector object in the composited CMYK color; otherwise that area is rasterized together with what lies under it into a CMYK image (300ppi; 600ppi where text under 12pt is involved), with a warning (also warning that text within rasterized areas loses quality and can no longer be selected as text). Writing fails if transparency that cannot be flattened remains (such as the transparency of color glyphs). Overlapping areas are composited in CMYK (as in printing), so they look slightly different from screen viewers that composite in RGB. X-1a and X-3 cannot be tagged ([Tagged PDF and PDF/UA](#tagged-pdf-and-pdfua))
  - Japanese printers mainly use PDF/X-4 and PDF/X-1a
- `--output-profile <ICC file>`: the one the printer specifies, such as Japan Color 2001 Coated. It is embedded in the PDF, and RGB colors and images are converted to CMYK with its tables. Required with `--pdfx x4` (an error if missing or not a CMYK output device profile (device class prtr)). With `--pdfx x1a`, it must have an AtoB1 table (A2B1). With any version, its header and tag table must follow the ICC.1 format (including the desc description tag), or it is an error (`pdfx/profile-invalid`). `--output-profile` and `--output-condition` are used together with `--pdfx`
- `--output-condition <name>`: if the name is in the ICC registry (the CMYK characterization data at registry.color.org, such as JC200103, JCS2011 and FOGRA39), the registry (RegistryName) is written in the output intent; for a name not in the registry, `--output-profile` is required even with `--pdfx x1a` and `x3`. When it is not given and `--output-profile` is, the profile's description (the text of its desc tag) is used as the printing condition name and no registry (RegistryName) is written (`JC200103` when there is no profile either)

### PDF/A

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--pdfa` | `2b` \| `3b` | — | write PDF/A-2b or PDF/A-3b markers for long-term archiving |

- PDF/A-2b and PDF/A-3b are the levels of ISO 19005-2 and -3 that preserve the appearance. The output intent is sRGB (an ICC profile that Kumiori builds), and the version and level are written in the XMP metadata. Transparency is written as is. CMYK colors and spot color alternates are converted to RGB (CMYK JPEGs cannot be used)
- Launch actions, form fields and characters with no glyph are not written, with a warning, and annotations get the Print flag and an appearance. Attachments are embedded with 3b (MIME type, `AFRelationship`, `AF` in the catalog); with 2b they are not embedded and become text annotations
- The written PDF is read back and checked against the requirements, and the output stops with an error if it does not meet them
- Combining it with `--pdfx` needs `--output-profile` (CMYK); colors are then converted to CMYK as for PDF/X (two output intents are written, referring to the same profile)
- PDF/A-1b and the a level (accessible; needs tagged PDF) cannot be written

### Tagged PDF and PDF/UA

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--tagged` | — | on (off for `--pdfx x1a` and `x3`) | write tagged PDF (document structure, reading order, alternate text for figures and language are added; backgrounds, borders and running heads become artifacts); not with `--pdfx x1a` or `x3` |
| `--no-tagged` | — | — | do not add tags (the same PDF as the default up to 0.4) |
| `--pdfua` | — | — | write PDF/UA-1 (ISO 14289-1) markers (implies `--tagged`); not with `--no-tagged`, `--pdfx x1a` or `x3` |
| `--document-lang` | language tag (`ja`, `en-US`) | — | document language when the input has none |

- `--tagged` (the default) and `--no-tagged`: write tagged PDF (ISO 32000-1 §14.8). Tags are added by default from 0.5.0. The typesetting result (positions of text, lines and images) does not change
  - Structure types of HTML elements: the headings `h1` to `h6` and `role="heading"` to H1 to H6, `p` to P, `ul`, `ol` and `li` to L and LI with their label (Lbl) and body (LBody), `img`, `svg` and an `object` shown as an image to Figure, `figcaption` to Caption, `a` to Link, `section`, `article`, `div` and so on to Sect, Art and Div, `table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th` and `td` to Table, Caption, THead, TBody, TFoot, TR, TH and TD, and `float: footnote` footnotes to Note. The structure tree is ordered in document order (the reading order)
  - Table header cells get a direction (Scope; from the `scope` attribute, otherwise column when in `thead` or when all cells of the row are header cells, and row otherwise), merged cells get RowSpan and ColSpan, and cells with a `headers` attribute get Headers. Structure types are decided by the element and `role`, not by CSS `display` (a `div` laid out with `display: table` or `grid` stays a Div, and a table with `role="presentation"` gets no table structure)
  - For footnotes, the reference mark in the text becomes Reference and the footnote body becomes the Note that follows it (with an ID); the number at the head of the body becomes Lbl inside the Note (the body is drawn at the foot of the page, but it is read at the reference)
  - Alternate text for figures (`alt`, `aria-label`, the SVG `title`; for `object`, `aria-label` or else the `title` attribute, never its fallback content) goes into Alt, the document language (`lang`) into the catalog's Lang, and the language of an element that differs from its parent into the Lang of its structure element. Link annotations are placed in the Link structure element with an alternate description (the link text or `aria-label`)
  - Backgrounds, borders, decorative images (`alt=""`) and the contents of `aria-hidden="true"` become artifacts, and running heads and page numbers (margin boxes, `running()`, `position: fixed`) and table headers and footers repeated from the second page on become pagination artifacts. Footnote separator lines are artifacts as well
  - For XSL-FO input, fo:page-sequence becomes Part, an fo:block with lines P (one that holds only blocks Div), fo:block-container, fo:float and fo:table-and-caption Div, the fo:list-* elements L, LI, Lbl and LBody, the table elements Table, Caption, THead, TBody, TFoot, TR, TH (cells in fo:table-header, with column Scope) and TD, fo:basic-link Link, fo:footnote-body Note (with the reference mark as Reference), fo:external-graphic and fo:instream-foreign-object Figure (Formula for MathML), and inline elements in a different language Span. fo:static-content becomes pagination artifacts and fo:leader an artifact. `role` (XSL 1.1 §7.5.2) gives the structure type when its value is a standard structure type name; other names are written as custom types mapped by the RoleMap to the default type. The Antenna House extensions `axf:pdftag` (structure type name; `Artifact` makes an artifact and an empty value makes no structure element), `axf:alttext` (alternate text for figures and links) and `axf:expansion-text` (expansion of an abbreviation) are also read
  - Ruby becomes Ruby (base text RB, annotation RT), and emphasis marks are artifacts. Top and bottom margin boxes and fo:region-before and fo:region-after become Header and Footer pagination artifacts. Annotations other than links go into Annot and form fields into Form structure elements, with a description (TU) on the field. The contents of boxes with opacity (transparency group Form XObjects) are also marked per structure element
  - Tags cannot be added to output whose transparency is flattened (`--pdfx x1a` and `x3`): unless `--tagged` is given, such PDFs are written without tags, and an explicit `--tagged` is an error (`x4` can be tagged)
- `--pdfua`: the identification (`pdfuaid:part`) and the title (`dc:title`) are written to the XMP metadata, `DisplayDocTitle` is set to true, and characters with no glyph in the font (.notdef) are not drawn. Form field appearances are drawn with embedded fonts and shapes. A missing document title or language, figures and formulas without alternate text, and skipped heading levels are reported as warnings (the PDF is still written). It can be combined with `--pdfa` and `--pdfx x4` (with PDF/A, `pdfuaid` is defined in a PDF/A extension schema)
- `--document-lang <lang>`: used as the catalog's Lang in tagged PDF only when the input has no language (the HTML `lang`, the XSL-FO `xml:lang` or `language`)

### Links

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--link-schemes` | list of schemes (`http,https,ftp`), or `*` | `http,https,mailto,tel` | URL schemes whose links get an action in the PDF (and are written to SVG) (`*` means all); other links are typeset as plain text |
| `--link-launch` | — | not written | ⚠️ also write links that open a file (relative non-PDF files, absolute paths, `//host/…`) to the PDF |
| `--link-relative` | `file` \| `uri` | `file` | how scheme-less relative links (`x.pdf`, `a.mp3`) are written |

- Of the links that leave the document (HTML `<a href>`, and `external-destination` of XSL-FO `fo:basic-link` and `fo:bookmark`), by default only URLs whose scheme is `http`, `https`, `mailto` or `tel`, and relative references to a PDF (the action that opens another PDF), get an action in the PDF. Other schemes (`javascript:`, `data:`, `file:` and so on) and actions that open a file (relative non-PDF files, absolute paths, scheme-less `//host/…`) are typeset as plain text and counted in a warning (`link/action-dropped`) (to protect whoever opens a PDF made from a document written by someone else)
- ⚠️ `--link-schemes '*' --link-launch` writes everything (only for documents you trust)
- `--link-relative uri` writes scheme-less relative links as a URI action with the reference as written (`/S /URI /URI (x.pdf)`; `%xx` is not decoded) instead of the actions that open a file (GoToR, Launch): many PDF viewers inside browsers do not handle GoToR and Launch. Relative non-PDF files are then written without `--link-launch`; absolute paths and `//host/…` still need `--link-launch`. In the API it is `links: { relative: 'uri' }`

### External fetching and file access

By default, the network and files outside the input's directory are read, as when a browser opens a local HTML file. ⚠️ When typesetting documents written by others on a server, turn them off with the three options below (see also [Limits and memory](#limits-and-memory)).

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--no-fetch-images` | — | fetched | do not fetch images the document references over `http(s):` |
| `--no-fetch-styles` | — | fetched | do not fetch stylesheets the document references over `http(s):` (HTML) |
| `--no-outside-files` | — | read | do not read files outside the input directory that the document points at with `file:` URLs or `../` |

- Images the document references via `http(s):` are fetched from the network by default. `--no-fetch-images` disables this (they are typeset as unreadable images). Network images are fetched up to 8 at a time, and fetching the images of a document also has an overall time limit (10 times the limit of a single fetch, 5 minutes by default; images not fetched by then are typeset as unreadable images)
- Stylesheets the document references via `http(s):` (`<link rel="stylesheet">`, `@import`) and the fonts of their `@font-face` rules (only those whose `unicode-range` overlaps the characters of the document) are also fetched by default. `--no-fetch-styles` disables this
- Files the document or the CSS references with a `file:` URL (`file:///…/style.css` etc.) are read from that file, even outside the input's directory. Relative references that point outside the input's directory (`url(../fonts/a.ttf)` in `sub/a.html` etc.) are read the same way. `--no-outside-files` stops reading files outside the input's directory (an image, font or SVG the document points at is drawn into the PDF when it can be read, so this keeps other files of the machine from being copied out; files inside the input's directory are still read). When none of the files in the `src` of an `@font-face` is found, a warning is reported
- Files and directories under the input's directory whose names start with `.` (`.env`, `.git`, etc.) and `node_modules` are not used as the document's files (CSS, images, fonts, attachments) (an image whose name starts with `.` becomes a missing image (`image/not-found`), and such a style sheet silently does not apply). To use such a style sheet, name its path with `--css`; give images and other files names that do not start with `.`
- Fetches turned off by options become notices (`info` diagnostics; shown with `--verbose`)
- The default fonts are fetched from Google Fonts independently of these options ([Fonts](#fonts)). draw.io shape libraries are fetched only with `--fetch-drawio-stencils`

### Memory

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--low-memory` | — | — | typeset with less memory (about 40% of the memory for documents of thousands of pages, about 1.5 times the time; the PDF is the same) |
| `--limit` | `<name>=<value>` (repeatable) | default limits | change an input limit (`--limit imagePixels=200000000`, `--limit fileBytes=1GB`). The names are those of `limits` in the API. Values are integers of 1 or more; `…Bytes` values may end with `K`, `M` or `G` (multiples of 1,024). Nesting-depth limits can only be lowered |
| `--list-limits` | — | — | print the limit names, defaults and whether each can be raised, and exit |

- The re-layouts that settle page number references (tables of contents and so on) do not reuse the pages of the previous pass, and the intermediate layout results of each page-sequence (for HTML, the document) are released once it has been laid out. The document is therefore laid out once more after the re-layouts to write the PDF. For the FO of the PostgreSQL documentation (3,231 pages), the maximum live heap goes from about 2.3GB to about 0.9GB (the most is used while reading the FO; it can be typeset with a 1GB heap limit), and the time from 160 s to 231 s. In the API, `lowMemory` of `typesetToPdf`. PDF output only
- Unknown names, non-numeric values and raising a lower-only limit are errors, and nothing is done. Raising a limit may use correspondingly more time and memory (a raised limit is reported with the notice `limit/raised`, shown with `--verbose`)
- For how memory is used and how to raise Node's heap limit, see [Limits and memory](#limits-and-memory)

### Diagnostics

Unsupported CSS properties and values (listed in chapter 16 of the Conformance Guide), properties unknown to Kumiori (misspelled or unsupported), XSL-FO elements and properties that cannot be read, unreadable images and so on are not silently ignored but reported on standard error as "warning [code] file:line:column: text" (also with `-o -`). The severities are "error" (content missing from the output), "warning" and "info". The codes are listed in [docs/en/diagnostics.md](diagnostics.md); in the library, see `result.warnings` and `result.diagnostics`.

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--verbose` | — | — | also print notices (diagnostics of severity `info`, such as fetches turned off by options and unreferenced stylesheets not applied) |
| `--diagnostics` | `text` \| `json` | `text` | how to print diagnostics; both go to standard error |
| `--ignore-warning` | code (such as `css/unknown-property`; comma-separated) | — | do not report diagnostics with that code (repeatable); unknown codes are warned about (`api/unknown-diagnostic-code`) and processing continues (that warning is counted by `--fail-on warning` too, so a misspelled code gives exit code 2) |
| `--fail-on` | `error` \| `warning` | — (0 even with diagnostics) | exit with code 2 after writing the output when there is a diagnostic of that severity or worse (suppressed ones are not counted) |

- `--diagnostics text` prints one line per diagnostic, "warning [code] file:line:column (element): text". `json` prints one JSON object per line (`{ input, code, severity, message, args, source, count }`; missing fields are left out; notices included). The conversion report lines still go to standard output, so read the lines on standard error that start with `{`. Errors that stop typesetting are written as a line of the same form with `"severity": "fatal"` (usage errors are written as text, not JSON). See "Output on the command line and in the browser app" in [docs/en/diagnostics.md](diagnostics.md)
- `--ignore-warning`: in the API, `diagnostics: { ignore: [...] }`
- Without `--fail-on`, the exit code is 0 even when there are "error" diagnostics (the output has been written)

### draw.io diagrams

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--drawio-stencils` | files or directories (separated by `,`) | — | shape libraries (`js/stencils.min.js`, library XML) and distributed images (`.svg`, `.png`, `.jpg`) for draw.io diagrams (repeatable) |
| `--fetch-drawio-stencils` | — | not fetched | ⚠️ allow fetching the shape libraries and images a diagram needs from draw.io's distribution (v24.7.5) when they are missing |
| `--drawio-stencils-url` | `http(s)` URL | — | the URL of the `stencils.min.js` to fetch (implies `--fetch-drawio-stencils`) |
| `--no-drawio` | — | read | do not read draw.io diagrams (`.drawio`, `.dio`) as images |

- Content fetched with `--fetch-drawio-stencils` is checked against the SHA-256 list for v24.7.5, and is not used, with a warning, if it does not match. Fetched files are saved in the font cache directory (not saved with `--no-font-cache`)
- See [docs/en/drawio.md](drawio.md)

### Plugins

| Option | Argument / type | Default | Description |
| --- | --- | --- | --- |
| `--plugin` | module (a file path or a package name) | — | ⚠️ load a plugin (the API's `plugins`; repeatable). A plugin is a program that runs with the same rights as Kumiori, so give only ones you trust |
| `--plugin-option` | `<name>=<value>` | — | an option passed to the function of the preceding `--plugin` (repeatable) |

- Search order: (1) a spec starting with `./` or `../`, an absolute path or a `file:` URL is a file path (`./plugin.js` and so on); (2) any other spec is first resolved as a package name, as `import()` does (from the current directory with the same conditions as `import()`: the `import`, `node` and `default` conditions of `exports`; `@scope/name`, `name/sub` and specs ending in an extension, such as `kp/dist/plugin.js` or `chart.js`, work too; a directory of the same name in the current directory does not make it a path); (3) if it cannot be loaded as a package (no such package, and also when the package does not export that subpath in `exports` or its entry file is missing), the file of that name in the current directory is loaded (`--plugin myplugin.js`)
- Whenever it can be loaded as a package, the package is loaded, so write `./` to be sure the file is loaded. When nothing is found, the error message says what was searched, in order
- The module's `default` export is a plugin or a function returning one (`(options, { cacheDir, lang }) => plugin`; `lang` is the message language chosen by `--lang` or the environment). `--plugin-option` values become the options of that function. A `--plugin-option` before any `--plugin` is an error
- When a plugin adds image formats, `--watch` also watches files with those extensions

## How input is read

- HTML is read with linkedom, and the CSS computed values come from the own cascade (the same as "CSS interpretation: Kumiori" in the web app)
- XHTML (`.xhtml`, `.xht`) is read with XML syntax, rewritten according to namespaces, and then typeset the same as HTML (prefixed elements such as `<s:svg xmlns:s="http://www.w3.org/2000/svg">` also become SVG; `src/xhtml.ts`). `.html` is read with HTML syntax, so prefixed elements do not become SVG. With `--xhtml`, XML syntax is used regardless of the extension
- MathML (`<math>`) is typeset with the math font (`STIXTwoMath-Regular.ttf`) and turned into glyph outline shapes (`src/mathLayout.ts`, shared with XSL-FO). Formulas with `display="block"` are centered on the line
- XSL-FO (`.fo`, `.xml`, or `--fo`) is typeset the same as XSL-FO import in the web app. The default-value convention is `--compat`
- Images in PNG, JPEG, GIF, BMP, TIFF, WebP, SVG, WMF, EMF, EPS (PostScript) and CGM, and draw.io diagrams (`.drawio`, `.dio`; as shapes and text; [docs/en/drawio.md](drawio.md)), are placed in the PDF. SVG filters are either approximated with shapes (shadows, blur, color changes, compositing) or computed in pixels and placed as an image (feTurbulence, lighting and so on; the web app has the browser rasterize them). HTML in foreignObject is approximated as text in Node. SVG that cannot be converted to shapes (e.g. foreignObject with non-HTML content) is drawn as a placeholder frame with a warning

## Limits and memory

- The limits below (image pixels, file sizes, the work of writing PNG and so on), as well as nesting-depth and typesetting-work limits, can be changed with `--limit <name>=<value>` (repeatable; the names are those of `limits` in the API; `kumiori --list-limits` and "Input limits" in [`docs/en/library.md`](library.md) list them with their defaults). Any limit can be lowered. Only time and size limits can be raised; nesting-depth limits (`nestingDepth`, `cssNesting`, `entityDepth` and others) can only be lowered. The default 300 of `nestingDepth` is the value of the largest kind; the actual defaults are per kind (128 for HTML, 250 for XSL-FO and so on; lowering it affects every kind). The same goes for the 64 of `cssNesting` (64 for nested rules, `@supports` and `calc()`; 32 for `@layer` names, math functions, selectors and `calc()` in SVG attributes). Raising a limit does not change the limits by file size (the "per byte of the file" limits below). Raising a limit may use correspondingly more time and memory, so set time and memory limits from outside as in the item below (a raised limit is reported with the notice `limit/raised`, shown with `--verbose`)
- Image sizes are limited (so that a small file cannot consume large amounts of memory and time; the values and their rationale are in `src/imageLimits.ts`). One image may have up to 100 million pixels. The images inside a WMF, EMF or CGM file (DIBs, cell arrays, tile arrays, patterns) may total up to 64 million pixels per file, and also no more than "260 thousand pixels (512 × 512) + 1,024 pixels per byte of the file" (a file of a few hundred bytes cannot produce a huge image; a file larger than about 61 KB may use the full 64 million pixels). Images beyond the limits are not drawn, and the rest of the document is typeset. GIF, WebP, JPEG, CCITT TIFF and RLE BMP images also have their pixel count bounded by the file size (per format, a value derived from the densest coding a legitimate file can have; a large, almost single-color lossless WebP, a blank CCITT image wider than 16,384 pixels, or a large, almost blank RLE BMP is not drawn when it exceeds the limit), and a PNG whose decompressed size exceeds 1,032 times its compressed data (the deflate limit) is not drawn. A font unpacked from WOFF or WOFF2 may be up to 128 MB, and no more than 100 times the file size + 1 MB. The length of the shapes made from WMF, EMF and CGM (2 MB + 128 characters per byte of the file) and the total running time of EPS in one document (60 seconds) are limited too
- Limits when writing pages as PNG (`--format png`, `renderPageToPng`): up to 40 million pixels per image. Decoded images (and their reduced versions) are kept up to 100 million pixels in total per typeset result and reused across pages (an image placed on many pages is not decoded again for each page; however, when large images that together exceed the 100-million-pixel memo are placed alternately, such as two images of nearly 100 million pixels each drawn at their original size on alternating pages, they may be decoded again for each page, still within the per-page limit). Images are identified by their content, so data: images inside SVG are reused across pages too. Images decoded while drawing one page may total up to 400 million pixels (reducing a kept original-size image to another size counts its original pixels too; images after that are not drawn, with a `png/image-limit` warning). SVG pattern tiles are kept for one page, up to 16 million pixels in total. The work of rasterizing one page (the sum of the pixels in the bounding box of each shape and glyph, the edges crossed on each scanline and the work of sorting them, the pixels painted (4 per pixel for paints that look up a color: gradients, images and patterns; for gradients with more than 16 color stops, log2 of the number of stops is added for the binary search of the stops), the pixels of layers composited and so on) is limited to 128 times the number of pixels in the page plus 64 million (a few seconds for A4 at 96dpi, about 80 seconds at 600dpi; ordinary pages use less than a tenth of it. Separately from this work limit, decoding the 400 million pixels of images allowed per page can take about 50 seconds for JPEG: four 100-million-pixel JPEG images on one page take about 48 seconds for A4 at 96dpi). Beyond that, the remaining shapes, glyphs and images are not drawn and a `png/raster-budget` warning is given (SVG images that could not be finished are drawn as placeholder boxes). Strokes outside the area being drawn are skipped without building their outlines. The layers held at once (offscreen areas for opacity groups, masks and color glyph compositing; 16 bytes per pixel) are limited in total to 8 times the number of pixels in the page (but not less than 16 million pixels) and to 64 million pixels (1GB). Layers that hold only the bounding box of their contents (opacity groups and masks) are counted by the size they actually grow to, checked when they grow (small opacity boxes rarely reach the limit, even on large pages or at high resolutions). Layers made at a fixed size (color glyph compositing) are checked before they are allocated. When the count is already at the limit, nested opacity groups are drawn without a layer, applying the opacity to each shape inside; when growing the layer of an opacity group would exceed the limit, its contents so far are composited and the layer is emptied to draw the rest (overlaps inside get darker either way); masks and compositing that would have to grow beyond the limit are not drawn, with a `png/layer-limit` warning. The coverage of the intersection of nested clips (4 bytes per pixel) counts toward the same limit as a quarter of a layer pixel (no array is made when the new clip fully covers the area of the outer clip), and a deeper clip beyond it is drawn with the outer clip only when it encloses the outer clip (its own edge is not applied), and otherwise its contents are not drawn, with a `png/clip-limit` warning (the outermost clip, which has no outer clip to fall back on, is kept even beyond the limit; it is still counted, so no further layers are made after it)
- Documents of thousands of pages use memory in proportion to the number of pages. The command and the API's `typesetToPdf` write the PDF page by page and release the layout results of each page once it is written, so the most memory is used when layout has finished, by the intermediate layout results (about 0.7MB per text-heavy page). `typeset`, which also returns the layout results (`areaTree`, `toPdf`, `renderPage`), holds the area tree of the whole document and uses correspondingly more (for the FO of the PostgreSQL documentation, 3,231 pages, the command peaks at about 2.3GB of live heap, and typesetting with `typeset` and calling `toPdf` at about 2.8GB). If Node stops at its heap limit (`JavaScript heap out of memory`; by default the limit depends on the machine's memory and is at most about 4GB), add `--low-memory` or raise the limit, as in `node --max-old-space-size=8192 dist-cli/cli.js book.fo -o book.pdf` (in MB). Image bytes are kept outside the V8 heap, so they do not count toward `--max-old-space-size`, but they use the machine's memory. When only the PDF is made (the command, `typesetToPdf`), the original bytes of each image are released once it has been embedded in the PDF, so a document with many images uses about 3 times the amount of image data (the size of the image files read; the embedded copies, the finished PDF and so on. With `typeset` the original bytes are also kept, about 3.5 times). The command writes the PDF as a stream, so while the PDF is written it holds neither the embedded copies nor the finished PDF (for a document of 200 PNGs that do not compress, a 196MB PDF, the peak of external bytes while the PDF is written went down from 660MB to 266MB; the peak where the images are read before typesetting does not change)
- ⚠️ When typesetting documents written by others on a server, also put a time limit and a memory limit on the typesetting of each document, separately from the limits above (typeset each document in a separate process or worker and stop it when the time is up; use `node --max-old-space-size=…` or a container memory limit, and so on). The limits above apply to one image or font at a time: a single image at the limit can still take several seconds to over ten seconds and about 2 GB, and a document that references many images and fonts costs correspondingly more. Also turn off fetching and reading outside files with the three options in [External fetching and file access](#external-fetching-and-file-access)

## Detailed examples and output

The output below comes from actually running the commands (times vary by machine; the `input` paths in the JSON and the usage text after an error are shortened). The messages are in English because `KUMIORI_LANG=en` is set ([Environment variables](#environment-variables)).

### Collect diagnostics as JSON in CI, and fail on errors

Convert several files and keep the diagnostics as one JSON object per line in a file. With `--fail-on error`, an "error" diagnostic (such as an unreadable image) makes the exit code 2, after the PDFs have been written.

```bash
export KUMIORI_LANG=en
kumiori book.html hello.fo report.html -o out --diagnostics json --fail-on error 2> diag.jsonl
echo "exit=$?"
```

Standard output:

```text
book.pdf: 1 page (layout 37ms)
hello.pdf: 1 page (layout 4ms)
report.pdf: 1 page (layout 7ms)
exit=2
```

`diag.jsonl` (standard error):

```json
{"input":"/work/book.html","code":"css/unknown-property","severity":"warning","message":"ignored unknown CSS properties (misspelled or unsupported): colr","args":{"property":"colr"},"source":{"file":"book.html","line":3,"column":12}}
{"input":"/work/book.html","code":"image/not-found","severity":"error","message":"image missing.png is not found or its content cannot be read as an image","args":{"src":"missing.png"},"source":{"file":"book.html","line":4,"column":37,"element":"img","sourceRef":7}}
{"input":"/work/hello.fo","code":"fo/unsupported","severity":"warning","message":"ignored unsupported XSL-FO elements/properties: fon-weight","args":{"item":"fon-weight"},"source":{"file":"hello.fo","line":10,"column":7,"element":"fo:block"}}
```

To fail on warnings too while leaving out known ones, combine `--ignore-warning` with `--fail-on warning`. Suppressed diagnostics are not counted, so with no other diagnostics the exit code is 0.

```bash
kumiori book.html -o book.pdf --fail-on warning --ignore-warning css/unknown-property,image/not-found
echo "exit=$?"
```

```text
book.pdf: 1 page (layout 43ms)
exit=0
```

### Make PDF/UA-1 and check what is missing

`--pdfua` reports what is missing, such as the title, alternate text for figures and heading order, as warnings (the PDF is still written). The HTML has no `lang`, so the document language is given with `--document-lang ja`.

```bash
kumiori report.html -o report.pdf --pdfua --document-lang ja
```

```text
report.pdf: 1 page (layout 48ms)
  warning [pdfua/missing-title] PDF/UA-1: the document has no title (set it with the HTML title or the XSL-FO axf:document-info document-title)
  warning [pdfua/missing-figure-alt] PDF/UA-1: 1 figure(s) have no alternate text (HTML alt or aria-label, XSL-FO axf:alttext; mark decorative images with alt="" or axf:pdftag="Artifact")
  warning [pdfua/heading-skipped] PDF/UA-1: heading levels are skipped in 1 place(s) (the first heading must be H1, and levels must deepen one at a time)
```

### Write PNG, with messages in Japanese

`--lang` wins over `KUMIORI_LANG`.

```bash
kumiori book.html -o page.png --dpi 150 --lang ja
```

```text
page.png: 1 ページを PNG に書きました (文書は 1 ページ。組版 135ms)
  警告 [css/unknown-property] book.html:3:12: 知らない CSS のプロパティを無視しました (綴りの誤りか未対応): colr
  誤り [image/not-found] book.html:4:37 (img): 画像 missing.png が見つからないか、中身を画像として読めません
```

### An invalid combination

A usage error writes nothing; the error goes to standard error, and the exit code is 1. Whether the full usage text follows depends on the kind of error.

- Errors found while reading the options (an unknown option, a missing or invalid value (including an empty `-o ''`), options that cannot be combined): the full usage text follows the error
- Errors found by checking the inputs against `-o` (standard input with other inputs or `--watch`, `-o -` (except when the same input given several times is merged into one) or an existing file as `-o` with several inputs, an `-o` ending with `/` or naming a directory with standard input, an `-o` ending with `/` that is missing or a file with a single input): only the error is written (it says how to fix it)

```bash
kumiori book.html -o book.pdf --pdfx x4
echo "exit=$?"
```

```text
--pdfx x4 needs an output CMYK ICC profile (--output-profile <ICC file>)
Usage: kumiori <HTML file> [-o|--output <PDF file>] …
exit=1
```

```bash
kumiori - -o out/ < book.html
echo "exit=$?"
```

```text
a document read from standard input ('-') has no name, so -o cannot be a directory: out/ (give a file name to -o, for example -o out.pdf)
exit=1
```

## Environment variables

These are the only environment variables the command reads. The order of precedence is: command-line options > environment variables > defaults.

| Variable | Corresponding option | Description |
| --- | --- | --- |
| `KUMIORI_LANG` | `--lang` | message language (`ja`, `en`); other values are ignored and the next variables are looked at |
| `LC_ALL`, `LC_MESSAGES`, `LANG` | `--lang` (after `KUMIORI_LANG`), and the default of `--svg-lang` | the message language: looked at in this order, `en…` means English and `ja…` Japanese (a variable with another value is skipped and the next one is looked at; Japanese if none matches). The SVG language when `--svg-lang` is not given is the default language of Node's `Intl`, which is not limited to en and ja and follows the OS rules: the language of the first of these variables that is set (even to an empty value) (`C` and `POSIX` give en-US, an empty value gives `und`, no language; en-US if none is set). For example, with `LC_ALL=C LANG=ja_JP.UTF-8` the messages are in Japanese and the `Intl` language is en-US; with `LANG=fr_FR.UTF-8` the messages are in Japanese and the `Intl` language is fr-FR |
| `KUMIORI_FONT_CACHE` | `--font-cache` | the font cache directory (also where fetched draw.io shape libraries are saved) |
| `XDG_CACHE_HOME` | `--font-cache` (after `KUMIORI_FONT_CACHE`; Linux and others) | `$XDG_CACHE_HOME/kumiori/fonts` becomes the font cache (otherwise `~/.cache/kumiori/fonts`) |
| `LOCALAPPDATA` | `--font-cache` (after `KUMIORI_FONT_CACHE`; Windows), `--system-fonts` | `%LOCALAPPDATA%\kumiori\fonts` becomes the font cache. With `--system-fonts`, the per-user fonts in `%LOCALAPPDATA%\Microsoft\Windows\Fonts` are also searched (without it, under `AppData\Local` in the home directory) |
| `WINDIR`, `SystemRoot` | `--system-fonts` (Windows) | `%WINDIR%\Fonts` is used as the OS font location (`SystemRoot` if `WINDIR` is not set, `C:\Windows` if neither is) |
| `FONTCONFIG_FILE`, `FONTCONFIG_PATH` | `--system-fonts` (Linux and others) | the fontconfig configuration file that lists the OS font locations: the file in `FONTCONFIG_FILE`, otherwise the first `fonts.conf` in the directories of `FONTCONFIG_PATH` (separated by `:`), otherwise `/etc/fonts/fonts.conf`; its `<dir>` entries are searched |
| `XDG_DATA_HOME`, `XDG_DATA_DIRS` | `--system-fonts` (Linux and others) | when no fontconfig configuration file can be read, `$XDG_DATA_HOME/fonts` (otherwise `~/.local/share/fonts`), `fonts` in each directory of `$XDG_DATA_DIRS` (otherwise `/usr/local/share/fonts` and `/usr/share/fonts`) and `~/.fonts` are searched. `<dir prefix="xdg">` in the configuration is also resolved from `XDG_DATA_HOME` |
| `XDG_CONFIG_HOME` | `--system-fonts` (Linux and others) | `<include prefix="xdg">` in the fontconfig configuration is resolved from `$XDG_CONFIG_HOME` (otherwise `~/.config`) |
| `SOURCE_DATE_EPOCH` | (none; `PdfOptions.date` in the library) | the time written as the PDF creation and modification dates (Info and XMP) and as the modification date of attached files: seconds since 1970-01-01 UTC as a decimal integer without a fraction (the [reproducible-builds.org](https://reproducible-builds.org/specs/source-date-epoch/) specification). Without it, the time of typesetting. A value that does not follow the specification (empty, a sign, a fraction, a non-digit, or later than the year 9999) is an error (exit status 1). The same version of Kumiori gives the same PDF bytes for the same input, fonts, options and value on the same Node version (image streams are compressed with Node's zlib, so across Node versions the bytes of PDFs with images can differ) |

Node's own environment variables (such as `NODE_OPTIONS=--max-old-space-size=8192` to raise the heap limit) work as Node defines them.

## Exit status

| Code | Meaning |
| --- | --- |
| `0` | every input was typeset and written (0 even with diagnostics unless `--fail-on` is given); also `--help` and `--version` |
| `1` | an input could not be typeset (a missing file, an XML parse error, a write error, a PDF that does not meet PDF/X or PDF/A, and so on; with several inputs, the other inputs have been written), or a usage error (an unknown option, an invalid value, an invalid combination, no input; nothing is written). Also 1 when processing stopped because a loaded plugin never completed |
| `2` | there was a diagnostic matching `--fail-on` (the output has been written); 1 if an input also failed |

With `--watch`, re-typesetting continues, so failed inputs and `--fail-on` do not change the exit code (stop it with Ctrl+C). The exception is a `--plugin` that cannot be loaded (not found, or an error while loading): that is a usage error, so nothing is watched and the exit code is 1 (plugins are loaded once at the start of the run, so re-typesetting would not load it either).
