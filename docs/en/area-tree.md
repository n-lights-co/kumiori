> English translation of [../area-tree.md](../area-tree.md) (the Japanese text is the original).

# Shape of the Area Tree (the typesetting result)

This document collects the rules for the `AreaTree` returned by `LayoutEngine.layout()`. The types are in `src/types.ts`, and the functions for walking it are in `src/areaTree.ts`.

## Version

- `AreaTree.schemaVersion` is the version of the shape. It is currently `2`, and the value comes from `AREA_TREE_SCHEMA_VERSION` (`src/areaTree.ts`).
- When the meaning of a field or the way children are held changes, the version is raised.
  - 1: the first version.
  - 2: the way collapsed table borders are painted (`paintWidth`, `noPaint`, `tableEdge`) was moved from fields of `BorderSide` to under `BorderSide.collapse`.
- `parseAreaTree` also reads version 1 trees and returns them converted to the version 2 shape.

## Units and coordinates

- All units are pt (1/72 inch).
- Coordinates are physical, with y pointing down. In PDF, y points up, so this is corrected when drawing (`src/pdfRenderer.ts`).
- `x` and `y` are the position of the top left of this Area's border-box relative to the top left of the parent Area's content-box. `width` and `height` are the size of the border-box.
- `margin` is the margin outside the border-box and is not included in `width` and `height`.
- When `orientation` (box rotation, counterclockwise) is present:
  - `width` and `height` are the size before rotation.
  - `x` and `y` are the top left of the bounding rectangle after rotation.
  - The children's coordinates are local coordinates before rotation.
- `GlyphArea.rotation` is the rotation of the glyph (clockwise) and is distinct from the box rotation `orientation`.
- A border side color (`border.*.color`) of `transparent` is not drawn (it still takes up its width); `#rrggbbaa` (translucent) is blended over the background beneath it with that opacity.
- Background (`backgroundColor`, `backgroundImage`):
  - `backgroundImage` is the top-most background image (its size is resolved). `under` is the list of images stacked behind it (nearest first).
  - Per image, `origin` is the positioning area (`border-box`, `content-box`; the padding box when absent) and `clip` is the painting area (`border-box`, `content-box`; the padding box when absent). HTML backgrounds normally carry `clip: "border-box"`, because the initial value of `background-clip` is `border-box` (they are painted under the border as well). XSL-FO backgrounds have no `clip` (XSL 1.1 §4.9.4: the background is rendered in the padding-rectangle).
  - `backgroundClip` is the area the background color is painted in (`padding-box`, `content-box`). When absent, the border-box (`width` × `height`) is painted.
- When an image (`image`) has `fit` (`cover`, `contain`, `none` or `scale-down` of CSS `object-fit`), `width` × `height` is the size of the box; the image is sized from its natural size (`naturalWidth` × `naturalHeight`), placed inside the box and clipped to it. `fitPosition` (CSS `object-position`) is its position inside the box (the center when absent).
- When `transform` (a paint-time transform; CSS `transform`) is present:
  - The value is a matrix `[a, b, c, d, e, f]`, with x' = a·x + c·y + e and y' = b·x + d·y + f (y points down).
  - The origin of the matrix coordinates is the point `x`, `y` of this Area (the top left of its border-box).
  - It is applied only when painting this Area and its descendants. `x`, `y`, `width`, `height` and the children's coordinates are those from before the transform (layout does not know about the transform).
- When `opacity` (CSS `opacity`; 0 or more and less than 1) is present, this Area and its descendants are rendered as one image and then blended with that opacity (overlapping parts inside do not become darker). When `transform` is also present, the transformed image is blended.
- An Area with `transform` or `opacity` is painted as a whole in the inline-content phase, without being split into background and content, even where there are floats (`float`).
- When an inline element (such as a `span` with a border) has `opacity` or `transform`, an `inline` Area (without `sourceRef`) that groups its frame and content is created and carries them.
- When `outline` (CSS `outline`; `{ width, color, style?, offset? }`, in pt) is present, a line that is the same on all four sides is drawn outside the border-box of this Area, set off by `offset` (a negative value goes inward). It takes up no space (`x`, `y`, `width`, `height` do not change). It is painted after the content and the border of this Area, and its corners are rounded on an Area with `borderRadius`. The outline of an inline element is placed, for each line, as a paint-only `block` Area (without children) at the end of the children of the line.
- When `clipRect` (the clipping rectangle of CSS `clip: rect(…)`; `{ x, y, width, height }`, with `x`, `y` measured from the top left of the border-box of this Area, in pt) is present, the shadow, background, border, outline and descendants of this Area are painted clipped to that rectangle (`clip` clips only the children, to the padding box). If the width or height is 0 or less, nothing of this Area is painted.

## Nodes and children

Children are returned by `childrenOf()`. The order is the painting order; earlier ones are underneath.

| type | children |
|---|---|
| `sheet` | `page` |
| `page` | `behindAreas` (behind the body) → `regionBody` → `absoluteAreas` |
| `ruby` | `base` (base text) → `ruby` (ruby text) |
| `tate-chu-yoko` | `glyphs` |
| `glyph`, `image` | none |
| others (`region-body`, `block`, `line`, `inline`, `table`, `table-row`, `table-cell`) | `children` |

To walk the tree, use `walkAreas()` (from one node) or `walkAreaTree()` (all sheets of the document). Both are depth-first, pre-order.

## Writing to and reading from JSON

- `serializeAreaTree(tree)` turns the tree into a JSON string. Fields that are `undefined` are not written.
- `parseAreaTree(json)` reads a tree from a JSON string. It checks the version (`schemaVersion`) and the shape of the nodes (the type, that `x`, `y`, `width` and `height` are numbers, and the children fields), and throws `AreaTreeFormatError` if they do not match.
- A re-read tree can be passed as is to the painting routines (`paintSheet`, `renderPdf`). Note that these two, as well as FontManager and AssetStore, are internal functions and classes that are not exported from the package entry point (`kumiori`). The public API can only draw the result of `typeset` (`renderPage`, `toPdf`); for now there is no way to draw a tree re-read with `parseAreaTree` (a re-read tree is for inspecting, comparing and storing). Version 1 trees are converted to the version 2 shape before being returned. Fonts and images require the same FontManager and AssetStore as when the tree was written (`test/areaTree.test.ts` verifies that a round-tripped tree is painted identically).

## Border side fields

- `BorderSide.symmetric`: places the dashed, dotted or dash-dot pattern symmetrically about the center of each side (CSS borders). If absent, the pattern continues around the sides clockwise.
- `BorderSide.waveStroke`, `BorderSide.waveLength`: the stroke thickness and the length of one period (pt) of a wavy line (`style` is `wave`). They are set on wavy underlines, overlines and line-throughs (CSS `text-decoration-style: wavy`). If absent, they are derived from the border width (the stroke is 1/8 of the width and the period is about six times the width).
- `BorderSide.collapse`: how a cell's side is painted, as decided by table border collapsing (`CollapsedSide`).
  - `paintWidth`: a line shared half-and-half with the neighboring cell is painted at this thickness (`width` is the space the cell takes, half the line thickness).
  - `noPaint`: takes the space only and paints no line (the neighboring cell paints it).
  - `tableEdge`: a side on the outer edge of the table. Used to join the corners only at the outer corners of the table.
- `GlyphArea.advance` is the advance width in the typesetting progression direction (including letter spacing and compression).

## References to the original input

- `sourceRef` is the index of the node in the input (`LDocument`) from which the Area was made. It is the position in the sequence returned by `documentNodes(doc)` (`src/areaTree.ts`; implemented in `src/sourceRef.ts`), so `documentNodes(doc)[area.sourceRef]` is the original node.
- The sequence is the objects that have a `type` field (a string), arranged depth-first, pre-order (the order of fields is that of the input objects).
- Areas that carry it: blocks, tables, rows, cells, images, ruby, tate-chu-yoko, and glyphs. For a glyph, it is the index of the containing inline (for a glyph outside an inline, the index of the containing block).
- Static content (running heads and the like) is typeset from nodes copied for each page, but the copied nodes inherit the index of the original node.
- Areas made from nodes created during typesetting (footnote numbers, the table for list labels, etc.) may not carry it.

## Font and image list, and glyph IDs

- `AreaTree.resources` is the list of fonts and images the tree uses (`src/areaResources.ts`; attached at the end of typesetting).
  - `fonts`: `id` (the name `GlyphArea.fontId` points to), `family`, `weight`, `postscriptName`, `unitsPerEm`, and the `sha256` of the font file's bytes.
    - A variable font (OpenType Font Variations) is typeset through an "instance" (a static font of that shape) built for each combination of axis values in use, so there is one entry per instance. An instance entry also has `variation` (the axis values, tag → value, for every axis of the font) and `sourceSha256` (the SHA-256 of the bytes of the original variable font file). `sha256` is that of the bytes of the static font built for the instance (`glyphIds` and `glyphPositions` are values in that font; glyph IDs are the same as in the original variable font). For a variable font with CFF2 outlines, the default instance is also an instance (a static CFF font).
    - For a glyph that uses an instance, `GlyphArea.fontFamily` is the font name followed by a mark for the axis values other than weight (`css:Inter{;opsz=20,wdth=75}`: after `{;` comes a list of tag = value, with the same meaning as `font-variation-settings`). `fontWeight` is the value of the weight axis (the weight clamped to the range of the font). The same instance can be looked up with this name and weight. A glyph set in an italic face or a face of a different width (a font file that is itself slanted or of another width) also carries a mark for that face in `fontFamily` (`Arial{ital=1}`, `Arial{wdth=75}`, `Arial{wdth=75,ital=1}`; an oblique face is `{slnt=14}`; written before the `;`). Such a glyph has no `italic` flag (the flag for drawing it slanted). In documents that load neither a variable font nor an italic face or a face of another width, `fontFamily` never has the mark.
  - `images`: `src`, `mime`, the natural size (`width`, `height`; CSS px), and the `sha256` of the image file's bytes (when the bytes are available).
- `GlyphArea.text` is the string of one unit of text. It is usually a single character, but a grapheme cluster (the extended grapheme cluster of UAX #29: a base character with combining marks or variation selectors, an emoji sequence and so on), a sequence that forms a ligature, and a run of joining characters (such as Arabic) become one `GlyphArea` with two or more characters. `advance` is the sum of the advances of that sequence shaped with a single font.
- `GlyphArea.glyphIds` are the IDs of the glyphs to draw. They are the result of shaping `text` with the font's OpenType features (`features`), in left-to-right drawing order (the same way as when writing the PDF).
- `GlyphArea.glyphPositions` is [advance, horizontal offset, vertical offset] per glyph (in font units; `unitsPerEm` is 1 em). These are positions adjusted by the font's GPOS, and are present only when there are two or more glyphs and either an advance differs from the font's advance width or there is an offset (e.g. the positioning of Arabic marks, or of combining marks placed on their base character). If present, the PDF is written with the position of each glyph set individually.
- `GlyphArea.fontPalette` is the palette selection for colored glyphs (the OpenType COLR/CPAL and SVG tables): the result of applying the CSS `font-palette` and `@font-palette-values` to the font of that character. `base` is the palette index, and `colors` is the list of color overrides ([color index, `#rrggbb` or `#rrggbbaa`]). It is absent for the default palette (palette 0 with no overrides) and for characters in fonts without palettes. The colored glyphs themselves (layers, gradients, images) are not stored in the tree; they are read from the font file when drawing.
- Glyph IDs and positions are shaped with the same set of features as when measuring during typesetting (kerning between characters and optional ligatures are not applied, since typesetting handles them separately).
- SHA-256 is computed in `src/sha256.ts` (FIPS 180-4). Tests verify that it gives the same values as Node's crypto.

## Current limitations

- `sourceId` is set only when the original element has an explicit id. An inline's id is set not on the inline's Area but on the Area of the first glyph (or box) of its content.
- PDF (`renderPdf`) writes the glyph IDs (`glyphIds`) if present (the same glyphs as measured during typesetting; `text` is used for ToUnicode; ligature characters (such as U+FB01, which typesetting substitutes for fi and the like) are mapped to the original character sequence (such as fi)). If absent, the characters are re-shaped with the font and written. The web app (Canvas) draws from the characters (`text`).
- Font and image data are not in the tree. The tree holds only their identification (SHA-256). Given the same font and image files, the tree can be drawn using the glyph IDs.
- A tree turned into JSON and read back is painted identically given the same FontManager and AssetStore (`test/areaTree.test.ts`).
