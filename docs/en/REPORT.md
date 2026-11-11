> English translation of [REPORT.md](../REPORT.md) (the Japanese text is the original).

# Kumiori Typesetting Algorithm Report

A record of "how the pieces were fitted together", taken down to the level of the coordinate formulas. All units are pt (1/72 inch).

## 0. Overview: two-phase layout

```
Logical Tree (JSON) ──▶ 論理座標でレイアウト (LNode: inline/block) ──▶ 物理化 toArea() ──▶ Area Tree ──▶ Canvas / PDF
```
(論理座標でレイアウト = layout in logical coordinates; 物理化 = conversion to physical coordinates.)

In vertical writing, "child x = parent width − block position − child width", so **a child's x cannot be determined until the parent's width is settled**.
Therefore, during layout only the writing-direction-independent logical coordinates `(i, b)` are handled, and they are converted to physical coordinates exactly once after the sizes are settled (`geometry.ts`).

| | horizontal-tb | vertical-rl |
|---|---|---|
| inline direction | → (x+) | ↓ (y+) |
| block direction | ↓ (y+) | ← (x−) |
| child's physical position | `x = i, y = b` | `x = PW − b − w, y = i` (PW = physical width of the parent's content box) |
| physical size | `w = isize, h = bsize` | `w = bsize, h = isize` |
| block-start edge | top | **right** |

`margin/padding/border` are given on the four physical sides, mapped to `bs/be/is/ie` by `toLogical()` for computation, and mapped back to physical sides on output.

## 1. Sheet / page / bleed / trim marks

```
extra   = bleed + (trimMarks ? trimMarkMargin : 0)          例: 3mm + 10mm
Sheet   = (W + 2·extra) × (H + 2·extra)                       ← MediaBox
PageArea.x,y = (extra, extra),  size = W × H                  ← TrimBox（コンテンツ原点）
bleedBox = (extra − bleed, extra − bleed, W + 2·bleed, H + 2·bleed)
RegionBody = PageArea 内 (margins.left, margins.top, W − l − r, H − t − b)
```
(例 = e.g.; コンテンツ原点 = content origin; PageArea 内 = inside the PageArea.)

- Absolute positioning is relative to the **PageArea origin** and is kept separately in `PageArea.absoluteAreas` (it does not consume the normal flow's `cursor`).
  A background that must reach into the bleed is specified with negative offsets, such as `top:-bleed; left:-bleed; width:W+2·bleed`.
- Headers and footers common to all pages are `PageSequence.staticContent`. They are laid out after the total page count is known (second phase), substituting `{pageNumber}` and `{totalPages}`.
- Paint order: (1) paper background over the bleed rectangle → (2) body content, **clipped to the bleedBox** → (3) trim marks (outside the clip).

**Trim mark geometry (`paint.ts: trimMarkLines`)**: for each corner `c = (cx,cy)`, outward sign `(sx,sy)`, `L = 0.85·trimMarkMargin`

```
水平: y = cy         と y = cy + sy·bleed の 2 本、x: cx+sx·bleed → cx+sx·(bleed+L)
垂直: x = cx         と x = cx + sx·bleed の 2 本、y: cy+sy·bleed → cy+sy·(bleed+L)
```
(Horizontal: two lines, `y = cy` and `y = cy + sy·bleed`, spanning x from `cx+sx·bleed` to `cx+sx·(bleed+L)`. Vertical: two lines, `x = cx` and `x = cx + sx·bleed`, spanning y from `cy+sy·bleed` to `cy+sy·(bleed+L)`.)

→ The trim line and the bleed line form a double L (Japanese-style trim marks). The center marks sit at the middle of each edge: a center line of length L running outward from the bleed edge, and a cross bar of length L crossing its midpoint.
In PDF they are drawn in a Separation with the colorant name All (registration color, which appears on every plate; ISO 32000-2 §8.6.6.4; the alternate color is `cmyk(1,1,1,1)`), with a line width of 0.3pt.

## 2. Block layout and pagination (`layoutEngine.ts: Flow`)

**Frame stack**: the "fragment on the current page" of each open block is held as `Frame{node, startB, contentStartB, opened}`. `cursor` is the amount of block-direction space consumed from the start of the region body.

- **Margin collapsing** (per CSS 2.1): a pending value `pending = maxPos + minNeg` is kept and collapsed between siblings and between parent and child (on sides without border/padding).
  At the moment the first content (a line, a table row, a leaf box) is placed, `flush()` adds the pending value to `cursor` and settles the not-yet-opened Frames with `startB = cursor`.
  Verified: `A(mb=10) B(mt=20)` → gap of 20; a nested first child with `mt=12` collapses with its parent's `mt=5` → 12.
- **Page break `breakPage()`**: from the innermost outward, closes every Frame's fragment with `bsize = cursor − startB` and cuts off the block-end border/padding/margin (`box-decoration-break: slice`).
  On the new page it reopens the fragments from the outermost inward and cuts off the block-start border/padding. Pending margins are discarded.
  Verified: a 40-line bordered block becomes 4 fragments (top rule only on the first, bottom rule only on the last).
  **No empty fragments are left behind**: a Frame with borders and padding shows its leading border as soon as it opens, so if its first content is pushed to the next page a border-only fragment would remain on the previous page. `breakPage` removes fragments with no content, returns them to the unopened state, and reopens them on the next page together with the first content (including the leading border and padding).
  **Tables alone behave like `clone`**: each fragment closes its outer border (top and bottom in horizontal writing; the right and left edges in vertical writing). The fragment is extended by the trailing border, and that amount is also accounted for when checking whether a row fits (margins and padding are still cut as in slice).
- **widows/orphans** (default 2): the number of lines `fit` that fit on the current page is simulated from each line's actual height (including ruby additions) plus the `bp_end` reserve of the Frames to be closed;
  if `remaining < widows` then `take = n − idx − widows`, and if `take < orphans` then 0 (push to the next page; at the top of a page the lines are placed forcibly to guarantee progress).
- `breakBefore/After` (`page` / `column` / `odd-page` / `even-page`; consecutive breaks are collapsed into one and no empty trailing page is created; odd / even insert a blank page if the parity does not match), `keepTogether` (trial-typeset in a separate Flow to measure the height; if it does not fit, break the page first), `keepWithNext` (trial-typeset the run and the following block in a separate Flow, and break the page first only when the first line of the following block would not land on the same page but would after a page break. The trial is cut off as soon as the first line of the following block has been placed, and the minimum/maximum length measurements of table cells are reused within the same typesetting run).

## 3. Inline typesetting (`inlineLayout.ts`, `jis.ts`)

**Atomization**: characters / ruby / tate-chu-yoko / forced line breaks. Each character is measured individually; kerning (GPOS `kernPairs`) and ligatures (a sequence that the font's liga feature turns into a single glyph becomes one unit) are added on the typesetting side, so Canvas and PDF place glyphs at the same positions (originally everything was per character and neither ligatures nor kerning were used).

**Line breaking (greedy + kinsoku)**
1. Pack atoms while `x + advance ≤ avail`, until reaching the overflowing atom `k`.
2. If `k` is a space → absorbed at the line end (trailing spaces are dropped).
3. If `k` is 、 or 。, hanging punctuation is enabled, and there is no line-breaking prohibition between `k` and `k+1` → **hang** it (place `k` immediately after the last character of the line — at the edge of the text area on justified lines — without changing the measure).
4. **Pulling in** (JLREQ §3.8.2; compressing takes precedence over expanding): if the run from `k` to the next break opportunity can be made to fit by compressing the compressible places (inter-word spaces in Latin text → the space after punctuation at the line end → before and after middle dots → the spacing of brackets and commas within the line → the spacing between Japanese and Latin text; order and limits per §3.8.3, `squeezeParts`; in compatibility mode at most a half em per line. In XSL-FO spec mode, Latin inter-word spaces are compressed only in lines that are set justified = `markWordSqueeze`; compatibility mode does not compress inter-word and Japanese/Latin spaces), that run becomes one line.
5. Otherwise, **push out**: back up from `j = k` until `canBreakAtoms(atoms[j-1], atoms[j])` is true (if, after the break opportunity backed up to, there is a hyphenation point where the text fits with a hyphen, break there instead). If backing up fails (a long run of punctuation that cannot start a line), push the text up to the next break opportunity (within 12 characters) in by compressing the punctuation spacing; if it still does not fit, break forcibly, knowingly violating the line-breaking rules.
`canBreakAtoms(a,b)` (`inlineLayout.ts`): break opportunities are decided by the UAX #14 rules (`lbBefore`, set on each character by `markLineBreaks` with the rules in `lineBreak.ts`; this covers characters prohibited at a line start or end, inseparable characters and the inside of Latin words), after first checking `white-space: nowrap`, `word-break` and leaders.

**Positioning within the line**: `justify` applies to "lines that are neither the last line of a paragraph nor a forced-break line" (the last line follows `textAlignLast` if given; with `justify` the last line is stretched too); the slack is distributed over the gaps that may be stretched (`stretchable`; no stretching inside Latin words) in the order of JLREQ §3.8.4 (`expandGaps`: Latin word spaces up to a half em → spaces between Japanese and Latin text up to a half em → other gaps up to a quarter em → any remainder evenly; amounts are proportional to the font size). `center/end` are leading offsets.

**Line box** (`lineMetrics`): horizontal writing is **baseline-aligned** (`above = baselineRatio·fs`); vertical writing is **centered on the character body (em box)** (`above = below = fs/2`).
`baselineRatio` is the OS/2 `typoAscender/upm` (0.88 for Noto CJK). `em = max(above) + max(below)`, `leading = max(lh − em, 0)`, distributed as `leading/2` above and below.

## 4. Glyphs and coordinates in vertical writing

Character classification (`jis.ts: verticalTreatment`): upright (kana, kanji, full-width symbols) / rotated sideways (Latin letters, digits, `ー〜…―` etc.). Advance:
upright full-width = `fs`, sideways Latin = horizontal width, sideways full-width symbol = `fs`.

Drawing origin of a GlyphArea (Area-local, y downward):

```
horizontal : (bx, by) = (0, br·fs)
upright    : (bx, by) = ((fs − naturalW)/2 + dx·fs,  br·fs + dy·fs)
rotate 90° : (bx, by) = ((1 − br)·fs,  (advance − naturalW)/2)      ※原点まわり時計回り 90°
```
(※原点まわり時計回り 90° = note: rotated 90° clockwise about the origin.)

Derivation of `rotate`: a 90° clockwise rotation maps `(x,y) → (−y, x)`. The em box's y range `[−br·fs, (1−br)·fs]` maps to the x range `[−(1−br)·fs, br·fs]`, so placing the origin at `x = (1−br)·fs` fits the em box within `[0, fs]`.

- For brackets, commas, periods, `︵︶﹁﹂` etc., the font's GSUB `vert` glyphs are used first; if there are none and the font supports the Unicode **vertical presentation forms (U+FE10–FE48)**, those are substituted (verified with Noto). Failing that too, brackets are rotated sideways, periods and commas are offset by `(+0.55em, −0.6em)`, and small kana by `(+0.125em, −0.125em)`.
- Lines run right → left, characters top → bottom. Blocks are stacked from the right edge toward the left (see the table above).

## 5. Ruby

```
rubySize   = fs · rubyScale (既定 0.5)
advance    = max(baseAdvance, rubyAdvance)                 ← RubyArea の確保長 (inline 方向)
親/ルビ文字 = space-around 均等割り: gap = (advance − Σadv)/n,  x_k = gap/2 + Σ(adv_j + gap)_{j<k}
RubyArea   : bsize = fs + rubyExtent, 親文字 b = rubyExtent, ルビ b = 0   (b=0 が block-start = 横書きなら上・縦書きなら右)
```
(既定 = default; RubyArea の確保長 (inline 方向) = the length reserved for the RubyArea in the inline direction; 親/ルビ文字 = space-around 均等割り = base characters / ruby characters are distributed space-around; 親文字 = base characters, ルビ = ruby; b=0 is block-start, i.e. the top in horizontal writing and the right in vertical writing.)

**Adjusting the inter-line space**: ruby protrudes by `rubyExtent` on the block-start side of the em box. The space directly before it is "this line's leadingBefore + the previous line's leadingAfter (+ pending margin)", so

```
extraBefore = max(0, rubyExtent − leading/2 − adjacentSpace)
行の bsize  = extraBefore + em + leading
```
(行の bsize = the line's bsize.)

If the ruby fits in that space the line pitch is unchanged; otherwise the inter-line space grows only by the shortfall. Verified: a line without ruby 17.0pt / the first line with ruby 18.5pt (+1.5 = 5 − 3.5) / the second of two consecutive ruby lines 17.0pt.
Ruby may encroach on the previous line's half-leading with a negative `b` (`RubyArea.y < 0`).
Ruby longer than its base characters, when `rubyOverhang` is enabled, overhangs the adjacent kana and punctuation on either side by up to one ruby character (overhang; not at the line start or end, and not over kanji), and `advance` shrinks by that amount (`inlineLayout.ts: rubyOverhang`).

## 6. Tate-chu-yoko

The character width `W = Σ advance` is measured in horizontal layout and `scale = min(1, fs/W)`. If `scale ≥ 0.5` the run is fitted into a single character cell (fs × fs); if `scale < 0.5` it falls back to sideways layout.
The advance within a vertical line is always `fs`. The internal glyphs are **given physical coordinates directly** (`phys`):

```
x_k = (fs − W·scale)/2 + Σ(width_j·scale)_{j<k},   y = (advance − fs)/2,   baseline = (0, br·fs),  scaleX = scale
```
"10" → scale 0.97; "2026" → 0.448 < 0.5, so it falls back to sideways layout (measured). In PDF the horizontal compression is expressed with `cm = [sx, 0, 0, 1, …]`.

## 7. Tables (`layoutTable`)

- Column widths: the remainder after subtracting the fixed values is apportioned by the weights `N*` (`auto` = `1*`). With automatic layout (CSS `table-layout: auto`), the minimum and maximum widths of the cells are measured and distributed to the columns (including cells that span columns; CSS 2.1 §17.5.2.2). **Columns run in the inline direction and rows in the block direction**, so vertical-writing tables (rows right → left, cells top → bottom) are handled by the same code.
- Rows: each cell is laid out in an independent Flow without page breaks; `row height = max(cell heights)`, and every cell's `bsize` is set to the row height (so backgrounds and borders fill the whole row). `colSpan` is supported.
- Page breaks: as a rule a row is moved to the next page intact (a row taller than a page is split at the boundaries between the lines of its cells; `splitRow`). If `cursor + pending + row height > limit`, then `breakPage()` (the table is itself a Frame and so is fragmented) → **the header rows are repeated** (`isRepeatedHeader`) → the row is placed.
  When "the page contains only the header", the overflow is tolerated with a warning to prevent an infinite loop.

## 7.5 rowSpan

Rows tied together by `rowSpan` are laid out as a single unit, a **row group** (`groupEnd` is found by following the chain) (if it does not fit on the page, it crosses the page at a row boundary).

1. Grid assignment: `occupiedUntil[col]` holds "the last row occupying that column"; each cell's starting column is determined by skipping the columns occupied by cells extending from above.
2. Each cell is laid out in an independent Flow to obtain its natural height `h`.
3. Row height = the maximum height of the `rowSpan = 1` cells starting in that row. For `rowSpan > 1` cells, in increasing order of span count, the shortfall `h − Σ(heights of the spanned rows)` is **added to the last spanned row**.
4. A spanning cell's `bsize = Σ(heights of the spanned rows)`. It is held as a child of its starting row and protrudes into the following rows (it extends to the left in vertical writing).

If the whole group does not fit on the current page it is moved to the next page as a group (with header repetition); if it is taller than a page, a warning is issued and it overflows.

## 7.6 fo:leader

`LLeader` (`pattern`: `dots` / `rule` / `space`; `length.minimum/optimum/maximum`) is a **stretchable atom** within the line.

- In line breaking its width is estimated with `optimum` (default 0), and **no line break is allowed before or after a leader** (so that a heading and its page number are not separated).
- In `positionLine`, the line's remaining space `free = avail − Σadvance` is distributed equally among the leaders. Each leader is clamped to `[min, max]`, and any excess is redistributed to the remaining leaders (up to 4 passes).
  Lines containing a leader are not justified, and are filled even when they are the last line or a forced-break line.
- `dots`: dots are placed at **multiples of the pitch measured from the line start**, `x_m = m·pitch`, so the dots line up vertically across lines. The default character in vertical writing is `・` (upright).
- `rule`: a band of thickness `ruleThickness` is output as a block with a background color (centered on the baseline in horizontal writing and on the center of the character body in vertical writing; the thickness is applied equally on both sides).
  Drawing uses only the existing glyph and background handling, so no changes to the Canvas/PDF renderers are needed.

## 7.7 fo:marker / fo:retrieve-marker

- `LMarker{className, children}` can be placed anywhere in the flow and produces no output. Placing one in the middle of a paragraph does not split the line (it is pushed to a pending list without cutting the inline run).
- **The page on which it is recorded**: markers are pushed to the pending list `markerSink`, and `commitMarkers()` records them on the page at the moment the next line, table row group or leaf box is actually placed (after the page-break decision).
  If the block holding a marker is moved to the next page, the marker is recorded on the next page as well. Markers inside cells and containers share `markerSink` with the parent Flow and reach the parent's page.
- `LRetrieveMarker{className, position, boundary}` inside `staticContent` is expanded into the marker contents **after all pages have been typeset** (the same second phase as page-number substitution).
  `position`: `first/last-starting-within-page` (markers starting on that page), `first/last-including-carryover` (if there are none, carried over from previous pages).
  `boundary`: `page` (no carryover) / `page-sequence` (default) / `document`.
- If the expansion result is inline-only it is wrapped in an `inline`, preserving the marker's own style. If it contains blocks, they are placed in the destination as they are.

## 7.8 Footnotes (fo:footnote)

`LFootnote{children, label?}` (inline). Formatting is specified by `PageSequence.footnotes` (`FootnoteOptions`). Implemented in `footnotes.ts` and `Flow`.

- **Numbering**: `FootnoteCtx.label()` numbers footnotes once in document order (idempotent via a `WeakMap`). `numberFormat`: decimal / circled / kanji / asterisk; `startNumber`, `labelPrefix/Suffix`, and `label` for individual overrides. The per-page reset (`reset: 'page'`) renumbers according to the order within the page where each footnote was placed in the previous typesetting pass, and re-typesets until the placements stop changing (the same second phase as §7.13).
- **Reference marks**: text smaller than the body by `referenceScale` (default 0.7), raised by `0.35em` of the body font size in the block-start direction (up in horizontal writing, right in vertical writing; `flattenFootnoteRef` in `inlineFlatten.ts`). The shift can be changed with `LFootnote.referenceShift` (`baseline-shift` on the XSL-FO reference; with `--style ah` in HTML, 1/3 of the parent font size). No line break before the mark (`glue`).
- **Reserving the area**: the footnote area is at the block-direction end of the region-body (bottom edge in horizontal writing / left edge in vertical writing). The reserved amount is `footReserve = separator + Σ heights + gap × (n−1)`. Body page-break decisions use `limit − footReserve` (`room`).
- **Moved together with the referencing line**: the fit test for a line includes "the footnote addition of that line" (`c + h + tail + resv + inc ≤ limit`). If it does not fit, the line is moved to the next page and its footnotes move with it. This is consistent with widows/orphans.
- **Overlong footnotes**: the footnotes of a line forcibly placed at the top of a page, or a single footnote that does not fit, are split line by line (`splitEntry`) and the remainder is carried to the top of the next page's footnote area (40% of the page is kept for the body). Anything left at the very end gets a footnote-only page.
- **Output**: the footnote area is added as a block at `b = limit − footReserve` as a child of the region-body. In vertical writing, physicalization gives `x = PW − b − w = 0`, i.e. the left edge. The separator is a block with a background color.

## 7.9 Floats (fo:float)

`LFloat{float: 'start'|'end'|'before', width/height, margin…}`. The contents are laid out in a fixed box as in `buildContainer` (the width from `width`, or `height` in vertical writing; the default is 1/3 of the body region, and the full width for `before`). `LBlock.clear` can advance past the bottom of the floats.

- **start / end**: fixed at the insertion point `y = cursor + pending margin` (with `max(y, bottom of the preceding float on the same side)` so as not to overlap it), and the occupied region `{side, b0=y, b1=y+outer size, size=inline outer size}` is recorded. The float itself does not consume `cursor`; it is placed as a child of the region at `i = margin.is` (start) / `rootI − margin.ie − isize` (end).
- **Per-line width**: `lineRange(y0, y1)` collects the floats overlapping the line's block interval `[y0, y0+line height)` and sets
  `left = max(content start, size of the start floats)`, `right = min(content end, rootI − size of the end floats)`.
  `shift = left − content start`, `width = right − left`. Lines are cut one at a time with `breakOne`, and the line node is placed at `i = shift` (the line narrows, and returns to the original width past the bottom of the float).
  If the width is less than 2em, the line is moved to below the float. Where the Frame's content box lies within the region is found with `contentIOffset()`.
- **before**: already-placed body content is pushed down with `shiftContent(h)` (shifts the root's children, the open Frames' `startB/contentStartB`, the floats' `b0/b1` and `cursor` by h), and the float is stacked at `b = beforeUsed + margin.bs`. In vertical writing block-start is the right edge.
- **When it does not fit**: a float that does not fit in the remainder of the current page is pushed to `deferredFloats` and placed at the **top of the next page** (at the end of `breakPage`). The body text does not stop but continues. If it does not fit even at the top of a page, a warning is issued and it overflows. Anything left at the very end gets a float-only page.
- **Switching paths**: while a float is in effect, the path that lays out lines one at a time (`layoutInlineRunFloating`) is used. Page crossing is decided per line, and if fewer lines than widows would go to the next page, already-placed lines are moved to respect widows / orphans (`widowShift`; the remaining line count is counted at the width without floats). Without floats the conventional fast path is used.
- **Limitations**: float positions are relative to the edges of the body region (page), not to nested blocks. A float whose writing mode is orthogonal to its parent's (e.g. vertical text inside horizontal text) is laid out with its line length set to the remaining height of the page. Footnotes and ruby in lines containing floats are handled as usual.

## 7.10 Boxes within a line: images (`LImage`) and `LInlineContainer`

Both are treated in line breaking as a "box atom" (`kind: 'box'`; breaks are allowed before and after it without kinsoku), with the dimensions `BoxSpec{adv, cross, above, below}`:

- `adv` = the advance in the inline direction, `cross` = the thickness in the block direction, `above/below` = in horizontal writing, the distances from the box's top/bottom edge to the baseline.
- **Images**: natural size = image px × 0.75 (96dpi → pt). If only one dimension is given the other follows the aspect ratio; if both are given the image is fitted into the box with `min(w/W, h/H)` (`uniform`).
  Horizontal writing: `above = h, below = 0` (the bottom edge sits on the baseline). Vertical writing: `above = below = cross/2` (the center of the character body). Without image data, a placeholder: 60×40pt when neither width nor height is specified; when only one is, the other follows a 3:2 width-to-height ratio (`imageBox` in `layoutEngine.ts`).
- **inline-container**: the width from `inline-progression-dimension` if present, otherwise shrink-to-fit
  (lay out at the line width → measure the longest line `max(contentLength)` → lay out again at that width). The inside is an independent Flow (its `writing-mode` may differ from the parent's).
  When both are horizontal, `firstBaseline()` gives the distance to the baseline of the first character, and `above = fb` aligns it with the surrounding baseline.
- The line's em above/below (`lineMetrics`) takes the maximum including the boxes' `above/below`, so a tall box expands the line.
- Drawing: a new `ImageArea`. Canvas uses `drawImage`; PDF embeds PNG/JPEG as they are with `embedPng/embedJpg` (for PNG, the IDAT goes straight into a FlateDecode image); other formats (GIF, BMP, WebP, TIFF etc.) are converted to PNG and embedded (either by decoding the pixels into a PNG of the original size, or by redrawing in the browser at output size × 300dpi; the same image is converted only once). SVG is turned by `svg.ts` into a shape list (paths normalized to M/L/C/Z, arcs converted to Béziers, transforms baked into the coordinates) and emitted as PDF drawing operators (gradients as shading patterns, text as glyph outlines, masks as soft masks). Things that cannot become shapes, such as filters, are rasterized in the browser, while in Node shadows and blurs are drawn approximately (the rest get a placeholder frame; `BACKLOG.md` O-01).

## 7.11 Background layer (`layer: 'behind'`)

The background colors of regions (`region-body` etc.) and pages must be laid behind the body content. Giving an absolutely positioned container `layer: 'behind'` keeps it separately in `PageArea.behindAreas`, and painting proceeds in the order **behindAreas → body (regionBody) → foreground absolute positioning**.
The whole-page background is `PageMaster.backgroundColor` (painted out to the bleed area).

## 7.12 Box rotation (reference-orientation)

A rotated box is **laid out in its pre-rotation local coordinate system and rotated only when painted**. Layout is unaware of the rotation; only the box's outer dimensions change.

- `LNode.rot` (counterclockwise 0/90/180/270). `isize/bsize` are the pre-rotation dimensions. **Bounding box** = width and height swapped for 90 and 270 (`bboxOf`).
  Normal-flow consumption, the `left/right/top/bottom` of absolute positioning, and the advance of boxes within a line are all computed from the bounding box.
- `Area.width/height` are the pre-rotation local sizes, `x/y` is the top-left of the bounding box, and the children's coordinates are local. The angle is held in `Area.orientation`
  (GlyphArea.rotation is the rotation of a "character", hence the different name).
- Painting: `paintArea` passes the local → Sheet transform to `Painter.transform`. With the bounding box's top-left (x, y) and the local size w × h:
  `90°: [0,−1,1,0, x, y+w]`, `270°: [0,1,−1,0, x+h, y]`, `180°: [−1,0,0,−1, x+w, y+h]` (x' = a·u + c·v + e, y' = b·u + d·v + f).
  Canvas uses `ctx.transform`; PDF applies `G = F∘M∘F⁻¹`, which includes the y flip (F: y → H − y), = `[a, −b, −c, d, c·H + e, H − d·H − f]` with `cm`.
  This lets the subsequent drawing code stay in Sheet coordinates (y downward).
- The default (pre-rotation) width of a rotated block-container is the full block-direction extent of the body region (the page height).
- Body region rotation (`PageMaster.bodyRotation`): the body region is laid out with its pre-rotation dimensions (width and height swapped) and the whole `RegionBodyArea` is rotated (using the paper sideways).
- A region's `writing-mode` / `reference-orientation` / `display-align` become the static-content box's `writingMode` / `rotation` / `blockAlign`
  (when rotated, the local width = the region's length, the local height = the region's width/extent).

## 7.13 Conditional page masters

`LPageSequence.masterAlternatives` (equivalent to `fo:page-sequence-master` + `conditional-page-master-reference`). Each element has `when: {pagePosition, oddOrEven}` and `master` (optionally `staticContent`); **they are evaluated from the first, and the first match is used**; if none matches, `master`.

- The page-number parity is based on `initialPageNumber`. `first/rest/only/last/any` refer to the position within the sequence.
- `last`/`only` need the total page count, so **trial layout → settle with the total → relayout** is repeated up to 3 times until it converges (with a warning if it does not).
- The body region's block-direction size and offset and the paper size can be changed per page (leaving the head empty on the first page only, mirrored margins, etc.).
  If the inline-direction size changes (page masters of different widths), the remainder of the paragraph is relaid out line by line at the new width from the page break.

## 7.13.1 Convergence of page-number references

If there are page-number references (tables of contents, cross-references), typesetting is repeated until the referenced page numbers stop changing (up to 4 times). In the first pass, already-placed targets (backward references) use their page number, and not-yet-placed targets provisionally use the current page number (which tends to have the same number of digits). From the second pass on, if a page-sequence's "starting page, continuing footnote number, and the values referenced within it" are the same as in the previous pass, its previous pages are reused as they are; and even if a reference's value has changed, if the character count and each character's advance are the same (e.g. numbers with the same number of digits), only those characters (marked with `LNode.cite`) are swapped. Only the sequences whose conditions changed (usually the table of contents) are relaid out. Documents that renumber footnotes per page are not reused.

## 7.14 Multi-column layout

- `layoutColumnSequence`: dedicated to page-sequences whose master has columns. The body is divided into "column groups" and "span=all blocks", and one Flow is used per group. From the Flow's point of view one column = one page, and `PageHost.nextPage` returns the root of the next column (or, after the last column, the first column of the next page).
- Column balancing: for the group immediately before a span=all block, (1) a normal trial layout finds the last page A, (2) trial layouts with the column height on A shrunk by binary search are repeated to find the minimum height that still fits on A, and (3) the real layout is done at that height. Trial layouts use a side-effect-free Flow.
- The next group (the span block) starts below the "most-used column" on the previous group's last page.

## 8. PDF output (`pdfRenderer.ts`)

- Coordinates: `pdfY = sheetH − y`. Text is placed with the text matrix `Tm = [sx·cosφ, sx·sinφ, −sinφ, cosφ, P.x, H − P.y]` (`φ = −rotation`). Characters that share the same matrix and the same baseline (one line of horizontal writing, sideways Latin text in vertical writing) are combined into a single `TJ`, and the spacing between characters (letter spacing, justification, kerning) is expressed as advance adjustments (1/1000 em). Characters with a different baseline (upright characters in vertical writing etc.) are written from `Tm` individually.
- Boxes: `MediaBox = Sheet`, `TrimBox = trimBox`, `BleedBox = bleedBox`, `ArtBox = trimBox` (y-flipped into PDF coordinates; verified with `pdfinfo -box`).
- Color: `cmyk(c,m,y,k)` is output as DeviceCMYK as is (Canvas uses an RGB approximation). Spot colors `spot(濃度,c,m,y,k,名前)` (濃度 = tint, 名前 = name) are written in a Separation color space (the alternate space is DeviceCMYK, the tint transform a linear FunctionType 2).
- Fonts: only the fonts used are embedded, as subsets. Characters are written using the Area Tree's `GlyphArea.glyphIds` (the glyph numbers decided during typesetting by applying OpenType features such as vert, liga and kern) as the codes when present, with `text` used for ToUnicode (if absent, the characters are shaped again with the font; [`area-tree.md`](area-tree.md)). **The TTF subsetter of `@pdf-lib/fontkit` does not align glyph data to 4-byte boundaries and writes a short-format loca, so the glyphs after an odd-length glyph are corrupted** (reproduced with Noto: "KUMIORI" becomes "KU K").
  `TTFSubset.prototype._addGlyph` is patched to pad each glyph to 4 bytes; the whole 5-page document is 204KB (several MB if the full fonts were embedded). For CFF-based OpenType (OTF) fontkit's subsetter cannot be used, so the embedding is replaced: only the CFF table is placed in a FontFile3 (CIDFontType0C) as a subset font whose unused glyphs are emptied (`cff.ts: subsetCff`) (for CID-keyed CFF, the codes, W and ToUnicode are written by CID rather than GID).

## 9. Verification results

| Item | Result |
| --- | --- |
| Canvas `measureText` vs fontkit `advanceWidth` (158 characters × 2 fonts) | maximum difference **1.7×10⁻⁵ pt** |
| Canvas preview vs PDF rasterization (96dpi, 5 pages) | ink mismatch 1.4–5.5% (mostly the color difference of the CMYK header band) |
| Kinsoku fuzzing (240 random texts / 1359 lines, horizontal and vertical) | 9 line-start violations (only on invalid input such as punctuation right after a space), 0 overflows, 99 hangs |
| Page breaks | fragment flags, border trimming, widows/orphans, keepTogether and forced page breaks confirmed by measurement |
| Error cases | a table row taller than one page → completes with only a warning; an empty flow → 1 page |

## 10. Known limitations

The list of unsupported features and known limitations is collected in [`BACKLOG.md`](BACKLOG.md) (each section of this report records the design as of the time it was written, so some limitations have since been resolved by later implementation; for example, footnotes inside tables and containers, the per-page footnote-number reset, table row splitting and `border-collapse`, fragmentation of blocks with an orthogonal writing mode, and the compression of consecutive punctuation, ruby overhang, spacing between Japanese and Latin text and kerning are all implemented). The main ones still remaining:

- When even backing up for kinsoku cannot produce a legal line start (a long run of punctuation), the text up to the next break opportunity is tried with the punctuation spacing compressed, and if it still does not fit the line is broken forcibly, knowingly violating the rules.
- The display Canvas is fixed to `fontKerning='none'`, and kerning is expressed as typesetting-side advances (to match the PDF).
- Paragraphs with floats use the line-at-a-time path and do not take the line grid into account (widows / orphans are respected by moving already-placed lines).
- Item-by-item descriptions of the unsupported parts of the specifications are in the "Unsupported" chapter of the Conformance Guide (`docs/conformance/`, Japanese).
