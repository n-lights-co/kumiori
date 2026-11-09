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
- A re-read tree can be passed as is to the painting routines (`paintSheet`, `renderPdf`). Version 1 trees are converted to the version 2 shape before being returned. Fonts and images require the same FontManager and AssetStore as when the tree was written (`test/areaTree.test.ts` verifies that a round-tripped tree is painted identically).

## Border side fields

- `BorderSide.symmetric`: places the dashed, dotted or dash-dot pattern symmetrically about the center of each side (CSS borders). If absent, the pattern continues around the sides clockwise.
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
  - `images`: `src`, `mime`, the natural size (`width`, `height`; CSS px), and the `sha256` of the image file's bytes (when the bytes are available).
- `GlyphArea.glyphIds` are the IDs of the glyphs to draw. They are the result of shaping `text` with the font's OpenType features (`features`), in left-to-right drawing order (the same way as when writing the PDF).
- `GlyphArea.glyphPositions` is [advance, horizontal offset, vertical offset] per glyph (in font units; `unitsPerEm` is 1 em). These are positions adjusted by the font's GPOS, and are present only when there are two or more glyphs and either an advance differs from the font's advance width or there is an offset (e.g. the positioning of Arabic marks). If present, the PDF is written with the position of each glyph set individually.
- Glyph IDs and positions are shaped with the same set of features as when measuring during typesetting (kerning between characters and optional ligatures are not applied, since typesetting handles them separately).
- SHA-256 is computed in `src/sha256.ts` (FIPS 180-4). Tests verify that it gives the same values as Node's crypto.

## Current limitations

- `sourceId` is set only when the original element has an explicit id. An inline's id is set not on the inline's Area but on the Area of the first glyph (or box) of its content.
- PDF (`renderPdf`) writes the glyph IDs (`glyphIds`) if present (the same glyphs as measured during typesetting; `text` is used for ToUnicode; ligature characters (such as U+FB01, which typesetting substitutes for fi and the like) are mapped to the original character sequence (such as fi)). If absent, the characters are re-shaped with the font and written. The web app (Canvas) draws from the characters (`text`).
- Font and image data are not in the tree. The tree holds only their identification (SHA-256). Given the same font and image files, the tree can be drawn using the glyph IDs.
- A tree turned into JSON and read back is painted identically given the same FontManager and AssetStore (`test/areaTree.test.ts`).
