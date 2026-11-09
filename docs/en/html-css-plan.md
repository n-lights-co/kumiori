> English translation of [html-css-plan.md](../html-css-plan.md) (the Japanese text is the original).

# Plan for HTML+CSS Typesetting

A plan for making Kumiori able to typeset HTML+CSS documents in the same way as XSL-FO.

## 1. Purpose and Scope

- **Paged documents** such as books, reports and manuals are written in HTML+CSS and turned into PDF with Kumiori.
- The target is the part of CSS that concerns "typesetting pages" (CSS Paged Media, CSS Generated Content for Paged Media, CSS Text, CSS Writing Modes, CSS Ruby, CSS Lists, CSS Fragmentation).
- Screen-oriented layout (flex, grid, transform, animation, the results of running JavaScript) is out of scope at first (to be considered from Stage 4 onward).

## 2. Mechanism

Kumiori is built as "logical tree (`LDocument`) → typesetting (`layoutEngine.ts`) → Canvas / PDF", and XSL-FO is only one of the entry points into that logical tree (`xslfoImport.ts`).
If an entry point for HTML+CSS (`src/htmlImport.ts`) is added, the typesetting (Japanese typesetting, footnotes, multi-column layout, tables, vertical writing, ruby, hyphenation) and PDF output can be used as they are.

```
HTML + CSS ──▶ ① スタイルの確定 ──▶ ② 論理ツリーへ写す ──▶ LDocument ──▶ 組版 ──▶ Canvas / PDF
                (cssCascade.ts)      (htmlImport.ts)
                  └─ ③ ページの指定 (@page など) は自前で読む
```

(① resolve styles → ② map onto the logical tree → LDocument → typesetting → Canvas / PDF; ③ page specifications such as `@page` are read by our own parser.)

### ① Resolving styles (our own cascade; the default)

- The HTML is read (DOMParser in the web app, linkedom in the Node CLI), and the computed value of each element is determined by our own cascade (`src/cssCascade.ts`, `src/cssSelector.ts`).
  It handles inheritance, selector precedence, `!important`, the default style sheet (UA style sheet), unit conversion (em, % → px) and `::before` / `::after` (Stage 6).
- All that htmlImport receives is a StyleSource (`style()`, `isAuto()`, `select()`, `contentWidth()`). Since there is no browser layout (`rect()`),
  image sizes, flex, grid, absolute positioning and `margin: auto` are determined from the CSS specifications (items 4 to 7 of Stage 6).
- Units come back in px (CSS 1px = 0.75pt) and are converted to pt.
- The web app and the Node CLI give the same result (not affected by the browser's fonts or version).

#### The route via the browser (for comparison)

When "CSS の解釈: ブラウザ" (CSS interpretation: browser) is chosen in the web app, the HTML is loaded into an invisible iframe and the browser's resolved styles (`getComputedStyle`) and
layout (`getBoundingClientRect`) are used (`src/htmlFrame.ts`). This route was built first (the descriptions of Stages 1 to 5 are about this route).
It is now used to verify our own cascade (`scripts/compare-css.mjs` compares computed values, and `compare-pdf.mjs --css-engine browser` compares the typesetting) and
to try CSS that our own cascade cannot handle.

### ② Mapping onto the logical tree (htmlImport.ts)

The resolved styles are mapped onto `TextStyle`, `BoxStyle` and the individual nodes (`LBlock`, `LInline`, `LTable` …). The main correspondences:

| CSS | Kumiori |
|---|---|
| `display: block / inline / list-item / none` | `LBlock` / `LInline` / list (a two-column table, same as the XSL-FO list-block) / not output |
| `display: table / table-row / table-cell` etc., `<table>` | `LTable` (automatic column-width layout is implemented) |
| `<caption>`, `display: table-caption`, `caption-side: top / bottom` | `LTable.captions` (placed above or below the table, at the width outside the table's borders. CSS 2.1 §17.4, CSS Tables 3 §3.5.3) |
| `font-*`, `line-height`, `color`, `text-align`, `text-indent`, `letter-spacing` | `TextStyle` |
| `margin`, `padding`, `border`, `background-*`, `width`, `height` | `BoxStyle` |
| `writing-mode: vertical-rl`, `text-orientation`, `text-combine-upright` | vertical writing, tate-chu-yoko (`LTateChuYoko`) |
| `<ruby>` `<rt>` | `LRuby` |
| `float: left / right` | `LFloat` (start / end) |
| `break-before / after / inside`, `orphans`, `widows` | page breaks, keep, control of orphan lines |
| `column-count`, `column-gap`, `column-rule` | multi-column layout (page, container) |
| `hyphens: auto` + `lang` | hyphenation (English, Latin. The hyphenation tables for the languages given by lang / xml:lang in the document are loaded) |
| `vertical-align: super / sub`, `text-decoration` | `baselineShift`, `textDecoration` |
| `<img>`, `<svg>` | `LImage`, SVG (an `<svg>` inside the document has its element names' case restored by the table in HTML 5.2 §8.2.5.5 and is turned into an image of a standalone SVG document. `src/htmlSvg.ts`) |
| `<math>` | If a font for mathematics is available, turned into shapes with the same MathML typesetting as XSL-FO (`mathLayout`). `display="block"` is centred in the content box, as in the MathML Core default style sheet (`display: block math`) |
| `white-space`, `line-break`, `word-break`, `hanging-punctuation` | white-space handling, line-breaking rules (kinsoku), hanging punctuation |

### ③ Page specifications are read by our own parser

`@page` rules and page margin boxes such as `@top-center` cannot be obtained from `getComputedStyle`. The CSS text is read by our own parser (the `parseCss` written for SVG `<style>` is extended and used).

| CSS Paged Media | Kumiori |
|---|---|
| `@page { size; margin }`, `:first` `:left` `:right` `:blank` | `PageMaster` and conditional masters (implemented) |
| named pages (`page: chapter`) | switching page sequences |
| page margin boxes (16 positions such as `@top-center`) and `content: counter(page)` | equivalent of static-content (running heads, page numbers) |
| `string-set` / `string()`, `position: running()` / `element()` | markers (`LMarker` / `LRetrieveMarker`, implemented) |
| `float: footnote`, `::footnote-call`, `::footnote-marker` | footnotes (`LFootnote`, implemented) |
| `target-counter(attr(href), page)` | page number references (`LPageNumberCitation`, implemented) |
| `leader('.')` | leaders (`LLeader`, implemented) |
| `bleed`, `marks: crop` | bleed, trim marks (implemented) |

## 3. Stages

### Stage 1: Typesetting the body text

- Add "HTML を読み込む" (Load HTML) to the web app (the HTML, CSS and images are chosen together, in the same form as loading XSL-FO).
- Implement the mechanisms ① and ② and map the body elements (headings, paragraphs, lists, tables, images, inline decoration, vertical writing, ruby).
- Up to `size` and `margin` of `@page`, and `break-before` / `break-after` (page breaks).
- How to verify: make a few sample HTML documents and check with e2e tests (Playwright) that they can be typeset and that the page counts are right.

### Stage 2: Book layout (running heads, page numbers, footnotes, table of contents)

- Page margin boxes (running heads, page numbers), `counter(page)`, `counter(pages)`, `string-set`, `running()`
- `:first` `:left` `:right` `:blank`, named pages
- `float: footnote` (footnotes), `target-counter` (page numbers in the table of contents), `leader()`
- How to verify: make a sample with a table of contents, footnotes and running heads (the layout of a book of about one chapter).

**Implementation status (Stage 2)**: supported.

- Specifications the browser does not know (`string-set`, `position: running()`, `float: footnote`, `page`, and `target-counter()`, `leader()`, `string()`, `element()` in `content`) are read from the CSS by our own parser (`src/htmlPaged.ts`) and applied to elements by selector. Specificity is not considered; the rule written later wins.
- The extension `-ah-linefeed-treatment: ignore` (linefeed-treatment of XSL §7.16.7; inherited) discards line feeds inside text (without turning them into spaces either).
- The compatibility style "Antenna House compatible" (`--style ah`; hereafter, the compatibility style): a `名前:first` (`name:first`) @page rule is applied to the first page of each page group (the sequence of pages produced by one element that has `page` and a forced page break. GCPM 3 §3.2) (`pageGroupFirst`. `:first` in CSS Paged Media 3 §4.2.2 is only the first page of the document, and GCPM 3 does not redefine it either. By default it is applied to the first page of each run split where the page name changes).
- Content that does not fit on a line is aligned to the start of the line and overflows on the end side even when `text-align` is center or end (CSS Text 3 §6.1). The same holds in the compatibility style (previously it was centred in the compatibility style (`alignOverflowing`), but that was removed).
- The compatibility style (`--style ah`; for XSL-FO, when not `--compat spec`): if the name written in the `font-family` of SVG text is the PostScript name or full name of a loaded font (such as `'SourceSansPro-Black'` exported by Illustrator), it is drawn in that font and that weight (in CSS Fonts 4, only `src: local()` of `@font-face` looks fonts up by this name).
- The compatibility style (`--style ah`): the extension line styles `dot-dash` (dash-dot line), `dot-dot-dash` (dash-dot-dot line) and `wave` (wavy line) are read as values of `border-style` and drawn (`ahBorderStyles`. They are not CSS values, so by default the declaration is dropped, as in browsers). A chain line is a dash 3.8 times the thickness (5.2 times for dash-dot-dot) with gaps and dots equal to the thickness; a wavy line is a stroke 1/8 of the thickness with a period of about 6 times the thickness. The wavy line starts at the corner (the intersection with the centre line of the adjacent side) at mid-wave height, its period is stretched or shrunk so that an exact number of half-waves fits the side's length, and horizontal sides start swinging upward, vertical sides inward.
- CSS dashed, dotted and chain borders are placed on each side symmetrically about the centre of the side (both end corners get the same shape, and the top and bottom, left and right sides have the same pattern. This is the placement recommended by the note in CSS Backgrounds 3 §3.2. For dashed, the centre of a gap, for dash-dot, the centre of a dot, for dash-dot-dot, the centre of a dash, is at the centre of the side. Dotted has a dot at both end corners. A short side shorter than one period is solid). XSL-FO borders continue the pattern clockwise as before.
- If the colour of a 3D border (groove, ridge, inset, outset) is CMYK, it is converted to RGB (R = (1 − C)(1 − K) etc.) before being lightened or darkened (CSS Backgrounds 3 §3.2 does not define how to derive them).
- Border colours also read print colours (`device-cmyk()`, the extension `cmyk()`, `rgb-icc()`) (`border`, `border-color`, `border-<side>`, `border-<side>-color`).
- If the `font-family` of SVG text is a Courier or monospace name that has not been loaded, it is drawn in Cousine, whose character widths equal Courier New's (bold if the name includes Bold etc.).
- Rounded corners of margin boxes (`border-radius`, `border-*-radius`) are drawn too (Paged Media 3 §6 does not define how properties absent from CSS 2.1 behave in margin boxes).
- All 16 margin boxes. The boxes on the top and bottom edges are placed at the full width of the body, and their position is distinguished by alignment (left, centre, right) (the CSS box-width distribution is not performed).
- `:first`, `:left`, `:right` and `:blank` become conditional page masters. An unnamed `:first` applies only to the first page of the document; a named `:first` (`chapter:first`) applies to the first page of the run of pages with that name.
- Named pages split the page sequence where `page` changes on a block directly under body.
- The items left over from this stage, `string(…, first-except / start)`, the formatting of `::footnote-call` / `::footnote-marker` / `@footnote`, `target-text()` and `counter(page)` in the body text, were supported later (the sections below).
- The default for book typesetting (Kumiori's default style sheet) includes a page number centred at the foot of the page.

### Stage 3: Japanese typesetting and multi-column layout

- `text-spacing` (spacing between Japanese and Latin text, punctuation compression), `hanging-punctuation`, `text-emphasis` (emphasis marks (kenten); not implemented, so it is added to the typesetting too), `text-combine-upright: digits`
- Multi-column layout (`columns`), spanning columns (`column-span: all`), floats (`float`)
- `position: absolute / fixed` (page-relative placement)

**Implementation status (Stage 3)**: supported.

- `text-autospace`, `text-spacing-trim`, `text-spacing` → spacing between Japanese and Latin text, punctuation compression. The spacing between Japanese and Latin text is 1/8 em as in CSS Text 4 (1/4 em in the compatibility style (`--style ah`); `-ah-text-autospace-width` is read too). `hanging-punctuation` → hanging punctuation (the CSS default is none, so the browser default does not hang punctuation. The default for book typesetting is allow-end).
- `text-emphasis` (emphasis marks) is turned into per-character ruby (the mark becomes the ruby text). It is not attached to spaces, punctuation or symbols. `text-emphasis-position` and colour are unsupported.
- The default style for ruby is Appendix A.1 of CSS Ruby 1 (rt and rtc text at 50%, line-height: 1, white-space: nowrap, etc.). The ruby text size is the ratio of the computed font-size of the first rt (or rtc if there is none) to the font-size of the ruby. The 30% rule for bopomofo in Appendix A.1 is not included, because the selector list ends with a trailing comma and is invalid.
- `text-combine-upright: digits N` makes runs of up to N digits in vertical writing tate-chu-yoko (the browser does not know it, so it is read from the CSS).
- Multi-column layout: `columns` on body (or html) is page-level multi-column layout; on other blocks it is a multi-column container. `column-span: all` spans the columns. Anything other than `column-fill: auto` balances the ends.
- `float: left / right` is a float (the box's width, border and margins are moved to the float). `inside` / `outside` (binding side / outer edge), `top` (top of the page) and `bottom` (bottom of the column or page) are read too ("Float extensions" below). `clear` moves the element down below the floats on that side.
- `position: absolute` places the element on its page relative to the body region, and `fixed` places it on every page (static content like the margin boxes).

### Comparison with a book-style CSS typesetting sample

The results are compared with the HTML, CSS and PDF of a published sample to check the interpretation of the specifications and the finer points of typesetting (the sample is not kept in the repository).

```
node scripts/compare-pdf.mjs --html <見本>.html --ref <見本>.pdf --out <出力先> [--web-fonts <dir>]
```

(`<見本>` is the sample, `<出力先>` the output directory.)

The default style sheet for the comparison is the compatibility style (`--style ah`).

Added while checking:

- `@font-face` (the TTF / OTF files chosen along with the document are matched by the file name of the src url and loaded. Italic fonts are not loaded). In the PDF, CFF OpenType fonts are embedded as a subset font whose 'CFF ' table has the glyphs of unused characters emptied (glyph numbers unchanged. `src/cff.ts`) (CIDFontType0C in FontFile3). For CID-keyed CFF, the character codes of body text, W and ToUnicode are written by CID (ISO 32000-2 §9.7.4.2). Characters that use OpenType features (onum, vert, etc.) are also written as glyphs of the same single embedded font (it is not re-embedded for each combination of features)
- Print defaults: no body margin (the 8px of the screen). `@media print` rules are used and screen-only CSS is not (a screen condition inside an `@media` list makes that whole condition `not all`. The conditions of `<style media>` and `<link media>` are evaluated for the print medium (the page size)). `vh` is resolved against the height of the page area
- Nested `@layer` (Cascade 5 §6.4): nested layers are ordered inside their parent layer, and declarations written directly in the parent layer are stronger than any of its nested layers (`@layer a.x` written later is still inside `a`)
- Arbitrary counters in `target-counter()`, `target-text()` (converted twice to collect the numbers and text of the targets), `attr(href url)`
- `content` on elements (replacing the content), `::before` / `::after` with `display: block`, the dimensions of `content: url()` images, page typesetting specifications inside the `style` attribute
- `counter(page)` in the body text (the page number of the enclosing block), `counter(page)` / `counter(pages)` inside a `running()` element
- Case distinction in `string-set` names, page number format per named page
- `<object data="図.svg">` (the image if available, otherwise the fallback content inside), `image-resolution`
- Background images (the first `background-image`, repeat, position, size), semi-transparent colours (the colour composited onto white paper), print colours (`device-cmyk()`, the extension `rgb-icc()`). An unreadable colour declaration falls back to the previous declaration. A spot colour (`#Separation`) in `rgb-icc()` becomes a PDF Separation if its name is in the spot-colour values (`spotColors`, `--spot-colors` on the CLI) (taking precedence over a readable colour in a previous declaration)
- Footnote formatting: font size and line pitch of the footnote element, `@page { @footnote { … } }` (separator rule, space above), `::footnote-call` / `::footnote-marker` (number format and surrounding text, size of the reference number). `list-style-position` of `::footnote-marker` (the GCPM 3 §2.7 default is inside; no space after the number). In the compatibility style (`--style ah`), it is outside, and the number hangs outside the body (the gap between the end of the number and the body is half the font size)
- `leader()` (Content 3 §5): `dotted` is `leader(".")`. The characters are lined up from the end edge and at least one is shown. If it does not fit, the line is broken after the preceding content and the leader and the following content go to the next line (no line break after the leader)
- `-ah-alignment-baseline` (`alignment-baseline`) on pseudo-element images (`content: url()`): `text-after-edge` etc. align the bottom of the image with the bottom of the glyph face, `text-before-edge` etc. align the top with the top of the glyph face
- When the first line is moved down to align to the line grid, a box with a background or border that has nothing placed in it yet is moved down as a whole (the space goes outside the box. The background of table-of-contents lines, etc.)
- No space between footnotes (CSS has only the margins of the footnote element; the layout engine's default 2pt is not used). The em reference of `@footnote` is the initial value 10pt in the compatibility style (the page context inherits from the root element, but an implementation that uses the initial value also conforms: Paged Media 3 §5)
- Characters from fallback fonts (characters not in the first available font): the line height is determined only by the ascent and descent of the first available font, and the character is placed on the line's baseline by the baseline of its own font (Inline 3 §5.3; when line-height is not normal). Lines with a list marker such as "◦" that is not in the body font do not get taller
- The compatibility style: the indent of ol and ul is 2.5em (not the 40px of CSS 2.1 Appendix D). Border widths are not rounded to whole px (browsers round values under 1px up to 1px), and thin, medium and thick are 1pt, 3pt and 5pt
- `-ah-padding-start`, `-ah-margin-before` etc. (corresponding to padding-start etc. of XSL) are read as logical padding and margins
- `-ah-` aliases written in the `style` attribute (`-ah-line-height-shift-adjustment` etc.) are translated to the CSS names just like those in rules, and inherited by descendants (previously only those written in rules were read, and the values in the `style` attribute were not consulted during inheritance)
- `-ah-line-stacking-strategy` is read as XSL's line-stacking-strategy (§7.16.6) and inherited. With font-height, every line has the same height, determined by the block's font height (text-altitude, text-depth) and the half-leading above and below (the nominal-requested-line-rectangle of §4.5. Large characters or superscripts/subscripts do not expand the line)
- If the `writing-mode` of a `display: inline-block` element differs from its parent's (a horizontal box inside a vertical line; tate-chu-yoko etc.), the contents of the box are typeset in that writing mode (orthogonal flows of Writing Modes 3 §7). Previously the contents of the box were also typeset in the parent's vertical writing mode, and Latin characters were laid on their side
- The footnote reference number (`::footnote-call`) is treated as a pseudo-element inserted at the position of the footnote element (GCPM 3 §2.2, §2.6), inheriting from the original footnote element, and its font size and weight are determined from the values of the footnote element and the `::footnote-call` rules (even when the insertion point is a bold heading, it is not bold if `font-weight: normal`. `font-size` is passed as a ratio to the font size at the insertion point)
- The line height (line-height) of the footnote reference number is also inherited from the footnote element (the default style sheet in GCPM 3 §2.6 has `line-height: inherit`; the pseudo-element is read as inheriting from the original element). A number (the 1.2 of `.Footnote`) is multiplied by the font size of the reference number
- The compatibility style (`--style ah`, `footnoteCallLineHeightFromParent`): the line height of the reference number is inherited from the element at the insertion point (if the line-height at the insertion point is a number, it is multiplied by the font size of the reference number; if absolute, used as is). With 1.3 at the insertion point the line does not expand; with 13pt the box of a 6pt reference number sticks out below the strut and the line expands by 0.875pt
- In justified text, the position after a Latin hyphen (such as between `-` and `*` in `border-*`) is not expanded unless Japanese characters follow (CSS Text 3 §7.1: in Latin justification, only word separators are expanded). Previously it was only left unexpanded when a letter or digit followed the hyphen
- A box with a background or border inside a line grid (`-ah-baseline-grid`) (chapter lines in a table of contents, etc.) contains only the extent of the font size (from the top of the glyphs above the baseline to the bottom of the glyphs), and the half-leading above and below goes outside the box (the position of the text does not change)
- The compatibility style (`--style ah`, `columnsLongFirst`): when balancing the columns of a multi-column box, content is put into the first column until it reaches 1/n of the whole (the height when typeset in one column) for n columns (a line straddling the middle goes into the first column). The default is the smallest height that fits the number of columns. `column-fill: balance` in CSS Multi-column 1 is "as equal as possible" and does not define how to decide. Multi-column layouts with a float at the bottom of the column and inside a line grid use the smallest height in the compatibility style too
- The compatibility style (`--style ah`, `leaderFromStart`): the dots of `leader()` are lined up from the start edge (immediately after the preceding content), and `dotted` is `leader(". ")` (CSS Content 3 §5.3 aligns to the end edge)
- The compatibility style (`--style ah`, `columnsDiscardEndMargin`): in a multi-column box, the bottom margin of the last child is not counted in the column height
- The compatibility style (`--style ah`): `bolder` and `lighter` become the next weight among the weights of the fonts defined by `@font-face`, as in CSS 2.1 §15.6 (if there is a Semibold (600), a bold th uses it). `th { font-weight: bolder }` from CSS 2.1 Appendix D is added to the default style sheet, and the left and right margins of `figure` are set to 0 (Appendix D has no figure. Figures are placed at the full width of the body)
- Multi-column layout: a `column-span: all` element is placed across the columns and splits the multi-column layout before and after it. A `direction: rtl` multi-column layout fills from the right column (Multi-column 1). The extensions `-ah-column-rule-length`, `-ah-column-rule-align` and `-ah-column-rule-display` are read
- Words containing ligature characters (fi, fl, etc.) are hyphenated too (the ligature character is counted as the original sequence of characters)
- `preserveAspectRatio` of SVG `<image>` (meet and alignment. SVG 1.1 §7.8. slice is not handled)
- SVG text in PDF: text with only a solid fill is drawn as PDF text with the font embedded, not as glyph outlines (with outlines, the appearance of positions at low resolution differed depending on whether the viewer applied hinting)
- Vertical-writing floats: `top` and `bottom` become inline-start and inline-end (line start and line end) when the containing block is vertical, and the body text flows around them as per the initial value inline of float-reference (CSS Page Floats 3 §3.2. Previously they were placed at the top and bottom of the column as in horizontal writing). `before` and `after` (extension values) are the top and bottom of the column regardless of writing mode. `inside` and `outside` are physical left and right (binding side and outer edge), so in vertical writing they become the top and bottom of the column. Floats at the top and bottom inside a vertical box are placed at the edge of the box's content (a bottom float written later is pushed further toward the edge). `float-y` is not read (it is typeset as an ordinary block)
- `vertical-align: bottom` and `top` on an inline image are aligned to the bottom and top of the line box after the line height has been determined by the other content (CSS 2.1 §10.8.1. If the aligned image is taller than the line, the line is expanded by that amount). Previously they were aligned to the glyph face like `text-bottom` and `text-top`
- The extension `float: multicol top` (and before): the element is moved to the top of the multi-column box as a block spanning the columns (same as `column-span: all`), and the body text of every column starts below it. The width unit `gr` is the length counted as column, gap, column, … over the column widths and gaps ((2n − 1)gr for n columns)
- `@counter-style` (CSS Counter Styles 3): system (cyclic, numeric, alphabetic, symbolic, additive, fixed, extends), symbols, additive-symbols, negative, prefix, suffix, range, pad and fallback are read and used by `list-style-type` and `counter()`, `counters()`, `target-counter()` (`src/counterStyle.ts`). An undefined name is the same as decimal (§5; previously it became "•"). Rules named decimal, disc etc. are invalid (§2). Names are case-sensitive. speak-as and symbol images are not handled
- The line-break opportunity after a slash (SY in UAX #14) is used only when there is no other position to break at, if the next break opportunity is fewer than 5 characters away (the recommendation for SY in UAX #14 §5.1; the minimum distance is implementation-defined). "and/or" is not split, and the table heading "PDF/A-1a" is split after "PDF/" at the column's minimum width
- The text of `content()` in string-set, the content of `target-text()`, and bookmark titles include the text of descendants' `::before` and `::after`, use the replacement text for descendants whose content was replaced by `content`, and exclude display: none descendants. The element's own `::before` and `::after` are not included (the example in GCPM 3 §1.1.1). The handling of descendants' generated content is not defined in GCPM 3; Kumiori decided on this behaviour
- If a shrink-to-fit table (width auto) has auto left and right margins, the remainder is distributed to the margins after the table width is determined (CSS 2.1 §10.3.3. The table is centred). On a side where a collapse table has an outer border, the half that extends outward is not added to the content width (previously a gap appeared between the last column and the outer border)
- Whether a table row or block container fits on the page also counts the height of the footnotes inside it (same as the lines of a paragraph. Previously a list item with a footnote could overlap the footnote)
- The compatibility style (`--style ah`, `tableCollapseSpillAh`): the half of a collapse table's outer border that extends outward overlaps the margin, in the block direction, at the top only up to the table's own margin, and not at all at the bottom (in CSS 2.1 §17.6.2 it extends into the margin at both top and bottom)
- Print colours (rgb-icc spot colours, CMYK) written in the `color` of `::before` / `::after` are used (previously only the element's colour was consulted. Heading numbers etc.)
- `-ah-border-radius` (and each corner such as `-ah-border-top-left-radius`) is read as `border-radius`, and `-ah-text-align`, `-ah-text-align-last` as `text-align`, `text-align-last` (they are used with the same values as the CSS properties)
- A lone `<br>` between blocks is kept as a line containing only a line break (one blank line). In the HTML default style sheet (the Rendering section of WHATWG), br is `display-outside: newline` (a forced line break). Kumiori reads this as a "line ending in a preserved newline" of CSS 2.1 §9.4.2 and does not treat it as a zero-height line (previously it was discarded along with the white space between blocks)
- The bottom margin of the last child of a list item's body escapes from the li and remains between it and the next item (lists are typeset as tables, so it is not discarded at the end of the cell either)
- `-ah-alignment-baseline: text-after-edge` etc. on an inline image aligns to the glyph face of the line's font (the ascent and descent of the first available font)
- The reference of the line grid (from the top of the glyphs to the baseline) is, in HTML, the value of the first available font (previously, when the document language was unknown, the value of the Japanese font was used, and Latin table-of-contents lines were too low)
- Inside a line grid, the half-leading after the last line is not counted when judging whether the content fits on the page
- `-ah-baseline-grid` on a list box is attached to the box that wraps the table used to typeset the list
- Translation of `-ah-` extensions: `-ah-text-autospace`, `-ah-punctuation-trim`, `-ah-hanging-punctuation`, `-ah-image-resolution`, `-ah-line-height-shift-adjustment` (do not expand the line for superscripts/subscripts. Also added to the layout engine and to line-height-shift-adjustment in XSL-FO)

Added afterwards:

- PDF bookmarks: `bookmark-level`, `bookmark-label` (content(), attr(), strings), `bookmark-state`. The target is the element's id (one is assigned if missing). `bookmark-state: closed` closes them as specified
- `font-variant: small-caps` / `all-small-caps` (capitals scaled to 0.7 are used as substitutes), `text-transform` (uppercase, lowercase, capitalize, full-width)

Fixes affecting where pages break:

- The compatibility style (`--style ah`; the default style sheet of the CSS 2.1 appendix) was added to the default style sheets. It differs from the browser (Chrome) defaults in heading margins (0.83em and 0.75em for h2) and so on
- `-ah-crop-offset` (the width from the trim edge to the paper edge) is read and included in the paper size
- Layout engine: when judging whether a block with keep-together fits on the current page, the trailing space-after (discarded at the end of a page) is not counted, and the leading space-before is collapsed with the preceding margin (it used to be added). The page counts of the XSL-FO samples do not change
- `image-resolution: from-image` (the resolution written in the image. PNG pHYs and JPEG JFIF are read)
- Kerning: applied to Latin text even with `font-kerning: auto` (the default) (same as browsers)

Added afterwards (2):

- `string(…, first-except)` (empty on the page where the value is set, carried over elsewhere) and `string(…, start)` (the value at the start of the page). first-except and start were added to the layout engine's retrieve-marker
- OpenType features (`font-variant-numeric` such as oldstyle-nums, `font-feature-settings`). TextStyle.fontFeatures in the layout engine: text is measured with the advances the features produce; the web app draws glyph outlines and the PDF draws with a font embedded with the features applied (positioning features such as palt take effect too)

Footnote numbering: the CSS footnote counter is a single one for the whole document, so the numbering continues even when named pages split the page-sequence (FootnoteOptions.continueNumbering in the layout engine).
Footnotes inside a multi-column container (a `column-count` list) are numbered too and stacked into the page's footnote area.
The numbers follow the CSS counter rules (`counter-reset`, `counter-increment`); no renumbering that those rules cannot explain is done.

### Stage 4: flex and grid (implemented)

(This is about the route via the browser, when "CSS の解釈: ブラウザ" (CSS interpretation: browser) is chosen in the web app. The default route (our own cascade; the Node CLI too) does not use an iframe, but estimates the widths of the items itself and turns them into a one-row table (`flexNoRect` in `htmlImport.ts`. Items 4 and 7 of Stage 6))

- For flex and grid placement, what the browser decided inside the iframe is used. The position and size of each item (getBoundingClientRect) are read and
  items that overlap vertically are grouped into one band. If a band has one item, it becomes a block positioned by margins; if two or more, a one-row table
  (the gaps between items become empty columns, the vertical positions of items become top padding of the cells). The widths and heights of the items are what the browser decided
- With this, horizontal and vertical flex, flex wrapping, and grid are all handled the same way (centring on covers and title pages, rows of cards, etc.)
- The text inside items is typeset by Kumiori (if the browser's font has different character widths, it may overflow the item). Vertical-writing containers and containers with text directly inside are typeset as ordinary blocks
- Sample: `e2e/fixtures/layout.html`

### Comparison with the WeasyPrint samples

Samples: the 6 from WeasyPrint's sample collection (github.com/CourtBouillon/weasyprint-samples). They contain the HTML, CSS and the PDF output by WeasyPrint (not kept in the repository).
The comparison uses the "WeasyPrint compatible" default style sheet (`compare-pdf.mjs --style weasyprint`: the browser defaults (keeping the 8px body margin) plus WeasyPrint's defaults for form controls. In css/html5_ua.css of WeasyPrint 65.1 it was confirmed that form controls inherit the font, the text is 0.85×, the border is 1px black, and the fieldset border is a groove in the text colour). For the book and the poster, the user style sheet is chosen with `--css` (same as `weasyprint -s`).

| Sample | Pages (WeasyPrint / Kumiori) | Result |
|---|---|---|
| Invoice (invoice) | 1 / 1 | nearly the same |
| Letter (letter) | 1 / 1 | nearly the same (font differences remain) |
| Book (book) | 56 / 56 | nearly the same (initially the page count differed. The starting pages of all 4 chapters match) |
| Report (report) | 8 / 8 | nearly the same (initially the page count differed) |
| Ticket (ticket) | 1 / 1 | nearly the same |
| Poster (poster) | 1 / 1 | nearly the same (initially the page count differed) |

Added through the comparison (this table and the items below are for the route via the browser. The results with our own cascade are in the Stage 6 table):

- CSS files not referenced from the HTML are added after the document's CSS as user style sheets
- Inside the iframe, `@font-face` fonts and `<img>` images are loaded from blob URLs of the files chosen along with the document (the browser's layout is then determined with those font and image sizes)
- CSS nesting (`&`, descendant rules), `@page` background colour
- Images: `object-fit` (cover / contain), `background-size: cover / contain`, the size the browser placed when there are upper or lower bounds such as max-width, absolutely positioned `<img>`, behind the content when `z-index` is negative
- Absolutely positioned `::before` / `::after` (boxes for background images), `float: right` `::after` (pushed to the line end), absolutely positioned elements with `visibility: hidden` are not output
- When a vertical flex has a fixed height and text directly inside it: justify-content becomes the vertical alignment inside the box
- Left/right page breaks at the boundary of named pages (parity of the page count of the preceding sequence). A blank page takes the name of the next page (the CSS specification and WeasyPrint); in the compatibility style (`--style ah`), the name of the preceding page

Added for the report sample: CSS variables (var() in declarations we read ourselves), width, height and opacity of margin boxes, and not outputting the boxes on a page whose margins are 0,
the `@page` background image (a box behind everything covering the whole page), lists without markers (`list-style: none`) as a sequence of blocks, floated `::before` with a size or background (icons),
a flex container with a fixed height as a box that does not span pages.

Added for the poster and ticket samples: CSS `@import` (replaced with the CSS chosen along with the document), the background of the root elements (html, body) becomes the page background,
page background images (PageMaster.backgroundImage in the layout engine; drawn before the body text, out to the bleed), `inline-block` (inline boxes),
body and html as flex / grid containers (the placement of body, and the position of body within the page), absolute positioning (without top/bottom specified) inside a positioned parent becomes a left/right float,
1.5pt of slack in flex item widths, replacement of special spaces (U+202F etc.), `line-height: normal` uses the values of the loaded font (ascent, descent, lineGap).
Layout engine: for characters the base font does not have, a font that has the character is looked for among the Latin font and the other loaded fonts (Hebrew can be drawn with Tinos and Arimo).
CSS float: start / end are right / left in a right-to-left paragraph.

Added for the book sample: in justified text, Latin inter-word spaces are not compressed below their natural width (TextStyle.wordSpaceShrink in the layout engine).
Browsers and WeasyPrint do not compress inter-word spaces; they fit one word fewer and expand. The HTML compatibility style (`--style ah`) does not compress either. XSL-FO compresses as before.

Symbol font: if the document's text contains characters that none of the loaded fonts has (✈ etc.), the symbol font (Noto Sans Symbols 2, about 1.2MB) is loaded once
(if it cannot be fetched, nothing changes. The loaded font is used as a fallback for the text's font). For both XSL-FO and HTML.
The outer margins (margin) of an `inline-block` are included in the dimensions of the inline box (top and bottom make the line taller, left and right separate it from the neighbouring characters. inline-container in the layout engine).
If an `@font-face` font is first in font-family, the characters that font has are typeset in it, not only Latin ones ("…" and so on too) (the CSS way of choosing fonts. first of defineStack in the layout engine).
Characters not in that font (Japanese etc.) are typeset with the next name in the list: if the first recognisable name that follows is `serif` or a Mincho family, Noto Serif JP; if `sans-serif`, a Gothic family or monospace, Noto Sans JP. Only when no recognisable name follows is it decided from the family name (sans etc.) (the Japanese in body text with `source-sans-pro, serif` is Mincho).
The ticket sample is now nearly the same as WeasyPrint's PDF.

Added for the poster and letter samples:

- The background of the root elements (html, body) is drawn inside the page margins (the page area), and position and `cover` are also resolved against it (same as CSS Paged Media and WeasyPrint.
  PageMaster.backgroundArea in the layout engine). The `@page` background is still the whole sheet
- The baseline of an `inline-block` is the baseline of its last line (CSS. LInlineContainer.baselineFrom in the layout engine). The XSL-FO inline-container keeps the first line
- The bottom padding and border are added to a block's explicit height (`height`) (previously they were included in the height). Percentage `background-size` (relative to the box size).
  A generic font (`serif` etc.) for which no font is loaded becomes the default font (it does not inherit the parent's `@font-face` font)
- The default body margin: WeasyPrint and browser printing keep 8px; the Vivliostyle-compatible style and the compatibility style (`--style ah`) do not add it. "Browser defaults (keep the body margin)" (browser-margin) was added to the default style sheets
- Added for the book sample: a blank page inserted by a left/right page break within a run of unnamed pages takes that page's name (previously the name of the next run; the black background of the
  `@page full` of the final full-page picture was being applied). trailingBlank (only for blank pages added at the end of a run) was added to the layout engine's conditional page masters.
  The narrow no-break space (U+202F, before " ?" and " !" in French) is no longer replaced by U+00A0, and is measured as a 0.2em space if the font does not have it
  (OpenDyslexic's U+00A0 is wide at 0.78em, and lines were increasing). No line break before or after U+00A0, U+202F and U+2007
- In Western-language documents (lang not Japanese, Chinese or Korean), symbols not in the Latin font (● etc.) are typeset with Arimo / Tinos (width-compatible with Arial / Times) rather than full-width Japanese characters
- Remaining: `serif` fonts (WeasyPrint's Noto Serif is not available locally), the colour of the fieldset frame

With images now loaded in the iframe, some images are drawn at the size the CSS specifies (such as `display: block; height: 9pt` images).
Because they were drawn large before, it was not apparent that the float extensions (`float: top page`, `alternate`, `center`, etc. Kumiori supports only some of them) were not being typeset.

### Float extensions

- Added to the layout engine's floats: after (at the bottom of the column or page, stacked above the footnotes), center (placed in the middle of the column, with no body text at its height), alternate (end in the first column, start in the others)
- For HTML floats, values other than left / right are read by our own parser; top / top page / before go to the top (before), bottom / bottom page / page bottom / after to the bottom (after). Modifiers such as multicol are not read. sidenote is end
- A center float does not flow body text to the left and right but leaves the float's height empty and continues below
- The heading number's `::before` (`display: inline-block; width: 12mm`) becomes an inline box of that width. The left and right `margin` of an inline element become inline spacing (LInline.inlineMargin)
- In a height-balanced multi-column container, the body columns are balanced excluding the bottom floats (`float: bottom`), which are then stacked after the content of the column that has the reference line (afterBelowContent of Flow in the layout engine)

### Comparison with the Vivliostyle samples

Samples: the annual reports in the Vivliostyle documentation repository (github.com/vivliostyle/vivliostyle_doc) (Japanese. HTML, CSS and the PDF output by Vivliostyle). Not kept in the repository.
The Japanese font is Noto Sans JP in place of Yu Gothic (not available locally). The comparison uses the "Vivliostyle compatible" default style sheet (`--style vivliostyle`: the browser defaults plus a rule not to break the page after headings. It was confirmed that h1–h6 are break-after: avoid in the default style sheet of Vivliostyle.js 2.38.0, and added). The Vivliostyle-compatible default style sheet also inserts the spacing between Japanese and Latin text (Vivliostyle.js handles text-autospace itself, with an initial value of normal). Header cells (th) are centred regardless of the align attribute (in the sample PDF, th with align="left" and "right" were seen to be centred).

| Sample | Pages (Vivliostyle / Kumiori) | Result |
|---|---|---|
| FY2022 activity report | 6 / 6 | nearly the same |
| FY2023 activity report | 5 / 5 | nearly the same |
| FY2024 activity report | 3 / 3 | nearly the same |
| FY2025 activity report | 5 / 5 | nearly the same (a heading was left at the end of a page. The Vivliostyle-compatible default style sheet, and a fix to discard the leading margin of a heading that was pushed to the next page) |
| FY2025 financial report | 5 / 5 | nearly the same |

Added through the comparison: percentage margins in `@page` (left and right relative to the paper width, top and bottom relative to the paper height), `env(doc-title)` (the document title) in margin boxes,
margin boxes inheriting the font size, font, line pitch etc. written in `@page`, and loading images on the network (absolute URLs).

### Stage 5 onward (when needed)

- Part of flex and grid (one-per-page layouts such as covers and title pages)
- Loading `@font-face`, nested numbering with `counter-reset` / `counter-increment`

### CSS interpretation without going through the browser (Stage 6; the default)

Goal: Kumiori determines the CSS computed values and layout itself, without relying on the browser (so it can typeset in Node and Web Workers too, and the result is not affected by the browser's fonts).
All that htmlImport receives from the browser is a StyleSource (`style()`, `isAuto()`, `select()`, `rect()`), so we build that ourselves.

1. **Cascade (done)**: `src/cssSelector.ts` (parsing, specificity and matching of selectors: combinators, attributes, structural pseudo-classes, `:not()`, `:is()`, `:where()`, `:has()`, `:lang()`),
   `src/cssCascade.ts` (the default style sheet `HTML_UA_CSS`, `!important`, origin, specificity and source order, the `style` attribute and HTML attributes (`width`, `align`, `dir`, etc.),
   expansion of shorthands (`margin`, `border`, `background`, `font`, `font-variant`, `list-style`, `columns`, `text-decoration`, etc.), inheritance, initial values, `inherit`/`initial`/`unset`,
   `var()`, lengths (`em`, `rem`, `%`, `vw`, `calc()`, `min()`/`max()`/`clamp()`), colours (names, `#rgb`, `rgb()`, `hsl()`)).
   Declarations with values the browser cannot read (`float: footnote`, `position: running()`, `content` with `leader()`, etc.) are dropped (htmlImport reads them separately in `htmlPaged.ts`).
   A shorthand is dropped as a whole if any one part cannot be read. Matched to Chrome: the font size of monospace fonts (13/16), `b` and `strong` are `bolder`, `:lang()` in HTML documents looks only at the `lang` attribute, etc.
   The first half of the default style sheet follows the CSS in Chapter 15 "Rendering" of the HTML Living Standard (WHATWG) (retrieved 2026-11-04. Until then it followed HTML 5.2 and Chrome's defaults).
   Headings use `:heading()` (the level comes from the name and `headingoffset` / `headingreset`), and an h1 inside a section is also 2em. Centring of th applies only when the parent's `text-align` is the initial value.
   A closed `details` outputs only the first `summary`, with an open/closed marker (▸ / ▾). `hidden="until-found"` is `content-visibility: hidden` (the box is kept but the contents are not typeset).
   There is no `border-color: gray` on tables (the border colour is the text colour). Of body's margin attributes, `marginheight` and `topmargin` are top and bottom, `marginwidth` and `leftmargin` left and right.
   Compatibility defaults (`--style ah` etc.) go into a layer above the HTML default style sheet and win regardless of specificity (`uaExtraCss`).
   Quirks mode: determined from the DOCTYPE as in HTML Living Standard §13.2.6.4.1 (`documentMode`. No DOCTYPE means quirks. A document read as XHTML is no-quirks).
   In quirks mode, the quirks-mode rules of Chapter 15 (`QUIRKS_UA_CSS`: resetting the text formatting of tables to initial values, li outside a list is inside, etc.), the margin collapsing of §15.3.9,
   nowrap and width on td and th, case-insensitive ID and class selectors, and from the Quirks Mode Standard, hexadecimal colours without the leading `#` (`color: ff0000` etc. §3.1), unitless lengths (`width: 100` etc. §3.2) and empty tables (§3.10) were added.
   Lines in standards mode contain a strut of the block's first available font and line-height, as the lower bound of the line height (CSS 2.1 §10.8.1). In vertical writing, since characters align to the central baseline (the centre of the em box), the strut places half the line-height on each side of the baseline (CSS Writing Modes 4 §4.2).
   Inline boxes have half-leading per character (CSS 2.1 §10.8.1): the box of a smaller character with the same line-height (such as a footnote number) extends above and below the box of larger characters and expands the line.
   Shifted characters (superscripts etc.) are counted at their unshifted position with `-ah-line-height-shift-adjustment: disregard-shifts`.
   The height of an empty line consisting only of a forced line break (a blank line in pre etc.) is just the strut (measuring the line-break mark with no characters by the em box mixed with the strut font's ascent and descent and made the line taller).
   The ascent and descent of characters are the OS/2 sTypoAscender and sTypoDescender for fonts where they add up to 1 em (the values recommended by the note in CSS Inline 3 §3.2.1).
   For such fonts the hhea ascent and descent (0.984 and 0.273 for Source Sans Pro and Source Code Pro) are not used (using them would make lines mixing monospace characters slightly taller).
   Line height in quirks and limited-quirks modes: no strut is created (§3.4). Empty inline boxes and white-space-only text are treated as having a line-height of 0 (§3.3).
   Percentage heights in quirks mode walk up to an ancestor with a definite height (or the page area if there is none) (§3.5. In standards mode, the percentage applies if the containing block's height is definite,
   otherwise auto: CSS 2.1 §10.5). Ancestors' decoration lines are not propagated to tables (§3.11). A table with color: initial takes body's colour (§3.12). Cell heights are border-box (§3.13).
   html fills the page's body region (the initial containing block) and body fills html (§3.6, §3.7): the minimum content height of the block wrapping body is set to the body region's height
   minus the margins, borders and padding of html and body (the width in vertical writing). It is expanded only when body has a border or padding on both sides in the block direction
   (on a side without them, the child's margin collapses with body's margin and escapes body, so together with the expanded body it overflows the page. When expanded via the computed min-height,
   the poster of the WeasyPrint samples became 2 pages. The specification's margins are the used values of body's margins and it does not say how collapsed margins are counted).
   Documents whose body is split by named pages are not expanded.
   When measuring the minimum width of table cells, no line break is taken before or after an inline img inside a cell with auto width (one in the sequence of lines whose containing block is the cell) (§3.8). §3.9 (the minimum width of nowrap cells) comes out the same because the table's automatic layout uses the cell's width specification as the minimum width.
   The WeasyPrint samples invoice, letter, ticket, report and poster have no DOCTYPE and are therefore quirks (in the invoice, the font size of tables reverts to the initial value).
2. **Comparison with the browser (done)**: `scripts/compare-css.mjs` compares, for every element in a sample (and `::before` / `::after`), the 88 properties htmlImport reads with Chrome's `getComputedStyle`.
   Width and height that are auto and for which the browser returns laid-out dimensions (used values) are not counted as differences.

   | Sample | Elements | Differing values |
   |---|---|---|
   | Book-style CSS typesetting sample | 7,439 | 0.02% (134; mostly the alignment of rt) |
   | WeasyPrint's invoice, ticket, report, poster, book, letter | 31–332 | 0–0.25% (fonts of form controls etc.) |
   | Vivliostyle's FY2022–FY2024 reports | 55–146 | 0.02–0.08% |

   Now (all samples, October 2026): all differing values are 0. The remaining differences were settled as follows.
   - Fixed: the `align` attribute on table parts (`col`, `colgroup`, `thead`, `tbody`, `tfoot`) also becomes `-webkit-*`.
     The form of the arguments of `counter()` and `counters()` is checked (a declaration like `counter(page physical)` without a comma is dropped).
     Percentage table column widths are returned as %, and htmlImport turns them into proportional column widths (`N*`) (the reference is the table width, determined at layout)
   - Counted as used values (not cascade differences): widths such as `min-content`, flex and grid items, elements with `min-` / `max-` constraints,
     widths and heights of elements that are not displayed (the browser returns the specified value as is)

3. **Verification in typesetting**: when "CSS の解釈" (CSS interpretation) in the web app is "Kumiori" (the default), this cascade is used for typesetting instead of the browser's computed values. Choosing "ブラウザ" (browser) uses the browser's computed values and layout in an iframe (`compare-pdf.mjs --css-engine browser`).
   No iframe is used (the HTML is read with DOMParser. The way CSS is collected (`<link>`, `@import`, unreferenced CSS, the print medium) is the same as the iframe method).
   - The book-style CSS typesetting sample is the same as when typeset with the browser's computed values; the Vivliostyle samples are the same or slightly better
   - Among the WeasyPrint samples, those that depend on the browser's layout (`rect`) (flex, grid, absolute positioning, images with upper bounds) fall apart: the poster, book and report gain pages,
     and the ticket falls apart too (the invoice and the letter are about the same)
4. **Not using the browser's layout (`rect`) (done)**:
   - Images: `width`, `height`, `max-*` and `min-*` are applied to the intrinsic size (`HtmlImportOptions.imageSize`) (the table in CSS 2.1 §10.4. `constrainReplaced`)
   - flex and grid: the items are divided into rows and each row becomes a one-row table (`flexNoRect`). For flex, `flex-basis`, `width`, `flex-grow`, `flex-wrap` and `justify-content`;
     for grid, `grid-template-columns` (`px`, `%`, `fr`, `repeat()`) and `span` in `grid-column`. `align-content` of a container with a definite height becomes the layout engine's
     `blockAlign: space-between`. Items with no width specified have their content width estimated (text is not measured, so the number of characters in the longest line × the font size. Images use their intrinsic size).
     The way the container's leftover width is divided (the ratio of `flex-grow`, equal division among items of unknown width, the gaps of `justify-content`) is turned into proportional columns (`N*` + fixed lengths) and left to the layout engine
     (so it divides correctly even when the container width at layout differs from the width seen at import: a full-page cover on page 1 with 0 margins, etc. The cover of the WeasyPrint report).
     Item cells use `keepEdgeSpace` (the top and bottom margins of items are not discarded. Same for `<td>`: CSS 2.1 §17.5) and, with `align-items: stretch` (the default), `stretchContent`
     (the item is stretched to the row height and its background and border fill the row)
   - flex direction, shrinking and alignment (Flexbox 1): a line that does not fit is shrunk in proportion to `flex-shrink` × the base size, and what an item stopped by `min-width` cannot give up is taken by the other items (§9.7).
     `row-reverse` and `column-reverse` swap the main start and end (`flex-start` packs to the right or bottom. §5.1), and `wrap-reverse` stacks the lines from bottom to top (§5.2).
     `align-items: baseline` becomes the baseline alignment of the cells (§8.3), and auto margins in the cross axis take the free space before alignment (§8.1). In a single-line container with a definite height,
     the line is as tall as the container's inner height (§9.4, step 15). `start`, `end`, `left`, `right`, `safe` and `unsafe` in `justify-content` (CSS Box Alignment 3 §5.1).
     Percentages in `row-gap` and `column-gap` are kept in the computed value and resolved against the container's content width or height (0 if the height is not definite. CSS Box Alignment 3 §8.1).
     `::before`, `::after` and the children of `display: contents` are also items (§4, CSS Display 3 §2.5) and are placed in `order` order (§5.4; an `order` declaration that is not an integer is dropped).
     On the route via the browser, pseudo-element items are not typeset because their positions cannot be read.
     When shrinking, the lower limit is the automatic minimum size (`min-width: auto`. §4.5: the narrowest content width; words for Latin text, one character at a time for CJK); when growing, items stop at `max-width` (the freezing in §9.7, judged with the container width at import time).
     A `direction: rtl` container is laid out from the right (the row table also places its columns from the right, so a line without a growing column gets an empty column on the end side).
     `last baseline` becomes the `last-baseline` alignment of the table cells (the baselines of the last lines are aligned and the group is packed to the bottom of the row; the fallback alignment end of CSS Box Alignment 3 §4.2).
     In a column container with a definite height, the items' `flex-grow` and top and bottom `margin: auto` become `flexGrow` and `flexAutoMargin` on the blocks of the logical tree,
     and the layout engine divides the remaining height after laying out the box (§9.7, §8.1). Text and pseudo-elements of `display: contents` in a column container are also items
   - If html is a flex container, body is positioned within the page area by `justify-content` and `align-items`
   - Rounded corners: `border-*-radius` is read (per corner, percentages, ellipses. `BorderRadius.corners` in the layout engine). It works via the browser too
   - Multi-column containers (`column-count`): if they do not fit on the page, the columns continue across pages (the first page uses the rest of the page, the last page is balanced).
     Previously they were a single box and the overflow was cut off (indexes, etc.)
   - The extensions `-ah-content-width` / `-ah-content-height` (the size of an image's content. % is a factor of the intrinsic size)
   - Monospace (`monospace`, `Courier`, `source-code-pro, monospace`, etc.; decided by the first recognisable name in the list): Latin text uses Cousine (width-compatible with Courier New;
     loaded only for documents that specify monospace), Japanese uses Noto Sans JP (XSL-FO uses Noto Serif JP)
   - Shadows: `box-shadow` (horizontal, vertical, blur, spread, colour. The colour's alpha is the opacity; multiple shadows; `inset` is not drawn) and `filter: drop-shadow()` (approximated as a shadow in the shape of the box).
     The blur is a stack of thickened semi-transparent shapes (the same approximation as SVG shadows). Not drawn inside the box

   | Sample | Via the browser | Our own cascade (no iframe) |
   |---|---|---|
   | Book-style CSS typesetting sample | page counts match | same as via the browser |
   | Vivliostyle 2022–2025 (5) | page counts match | same or slightly better |
   | WeasyPrint invoice, letter, report | page counts match | nearly the same |
   | WeasyPrint ticket, poster, book | page counts match | nearly the same (after measuring content widths with glyph widths and centring with margin: auto) |

5. **The Node CLI (done)**: `npm run build:cli` → `node dist-cli/cli.js book.html -o book.pdf` ([README](../../README.en.md)). It does not use a browser.
   - The HTML is read with linkedom. linkedom differs from the HTML specification's parsing in places, so the unwritten `<head>` and `<body>` are supplied and
     the line feed immediately after a `<pre>` start tag is dropped (`fixImplicitStructure`). `<tbody>` in `<table>` is not supplied (htmlImport can typeset without it)
   - Made common: the way CSS is collected (`src/htmlPrepare.ts`), font assignment and `@font-face` (`src/fontMapping.ts`)
   - Images: in environments that cannot draw, the size is read from the file header (`headerSize`: PNG, JPEG, GIF, BMP, WebP, SVG. The magic bytes are checked, and a file that is an image by extension only is not read).
     PNG and JPEG go into the PDF as they are, and SVG is drawn as shapes. GIF, BMP, TIFF (and the TIFF preview of EPS) and WebP (lossless, lossy, transparency) have their pixels read and are turned into PNG (`src/pixels.ts`, `src/webp.ts`, `src/vp8.ts`, utif);
     WMF and EMF are turned into SVG and drawn as shapes. EPS is turned into SVG by executing the PostScript (`src/eps.ts`). CGM has its elements read and is turned into SVG (`src/cgm.ts`). SVG that cannot be turned into shapes (filters other than shadows and blur, etc.) and EPS that cannot be drawn are
     detected at load time, drawn as a placeholder frame, and a warning is given (`parseXml` of `AssetStore`, `ImageAsset.unsupported`)
   - Fixed (in the browser too): special spaces the font does not have (U+2000–U+200A) get the width Unicode defines (in Node they got the width of a glyphless character and table-of-contents lines were wrapping).
     `*` in SVG `<style>` (matplotlib output)
   - Result: for every sample, the same as our own cascade in the web app. A sample of a little over a hundred pages takes about 28 seconds
   - `compare-pdf.mjs --pdf <file>`: compares an already produced PDF
   - XSL-FO can be typeset too (`.fo`, `.xml`. XML is read with xmldom. `--compat antenna|spec`. Font files in the same directory are used under the names in the FO `font-family`).
     On the XSL-FO samples too, the results are about the same as the web app. The advances of glyphs whose outlines fontkit cannot read (U+00A0 in Arimo) are read from hmtx
   - Tests: `test/cli.test.ts` (builds dist-cli and typesets FO and HTML+CSS into PDF. Runs in `npm test` in CI)
6. **Measuring content widths with the font's glyph widths (done)**: the content width (max-content) of flex items is measured with the same glyph widths as the typesetting (`HtmlImportOptions.measureText`;
   Canvas in the web app, fontkit's Measurer in Node). Inline elements are each measured with their own font, font size, weight and letter spacing and summed.
   The WeasyPrint ticket and book came closer to the results via the browser. In the poster, a difference in the spacing of the row of logos remains.
7. **Made the default**: the default of "CSS の解釈" (CSS interpretation) in the web app was made Kumiori (the same as the Node CLI). Every sample is nearly the same as via the browser.
   - `margin: auto` on the left and right of a box with a definite width divides the space equally, and block images are centred
   - Vertical flex (`flex-direction: column`) is typeset as ordinary blocks, and the item alignment (`align-items`, `align-self`) becomes the text alignment of
     items whose width is determined by their content. If the height is definite, `justify-content` becomes the vertical alignment of the contents
   - `compare-css.mjs` compares with the browser's computed values, so it loads with CSS interpretation set to the browser

Speed of comparison: `compare-css.mjs --list` compares several samples in one launch. Without `--web-fonts`, the web app could not load the default fonts and waited 180 seconds for "準備完了" (ready) (now it moves on after 15 seconds).

## 4. Verification

- Unit tests: part ② of htmlImport.ts (resolved styles → logical tree) is made so that styles can be injected, and tested in Node. Part ① needs a browser, so it is tested in e2e tests.
- Comparison with samples: as with XSL-FO, compare the results with published sample PDFs (reusing `compare-pdf.mjs --ref`). Candidates to compare against are a book-style CSS typesetting sample and the Vivliostyle and WeasyPrint sample collections.
- For Japanese typesetting, whether the defaults of the XSL-FO compatibility mode (`--compat antenna`) (line pitch, spacing between Japanese and Latin text, hanging punctuation, etc.) should be kept separately from the CSS defaults is decided in Stage 3.

## 5. Decisions

1. **Input form**: one HTML file, with the CSS and images chosen along with it. EPUB is out of scope (to be added if it is easy). → Added (`src/epub.ts`: the zip is extracted and the chapters are joined in spine order and typeset as one HTML document. A page break per chapter).
2. **What to compare against**: published CSS typesetting sample PDFs.
3. **Default style sheets**: the browser defaults and the defaults for book typesetting that Kumiori provides can be chosen in the web app.
4. **Conversion outside the browser**: not done (style resolution is left to the browser). → The policy was changed and the CSS is now interpreted by our own code ("CSS interpretation without going through the browser"; now the default, and used by the Node CLI too).
