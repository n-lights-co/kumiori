> 日本語: [../fonts.md](../fonts.md)

# Fonts

The fonts for typesetting are included neither in this repository nor in the npm package. They are fetched at run time from Google Fonts' distribution host (`fonts.gstatic.com`).

## Default fonts

| Font | Use | License |
| --- | --- | --- |
| Noto Serif JP, Noto Sans JP (Regular and Bold of each) | Japanese (Mincho, Gothic) | SIL Open Font License 1.1 |
| Tinos, Arimo (Regular and Bold of each) | Latin (serif, sans-serif) | Apache License 2.0 |
| Cousine | When monospace is specified | Apache License 2.0 |
| STIX Two Math | When there are formulas (MathML). MathML is typeset with the values of this font's MATH table | SIL Open Font License 1.1 |
| Noto Sans Symbols 2 | When the document contains symbols (such as ✈) found in none of the loaded fonts | SIL Open Font License 1.1 |
| Noto Emoji | When the document contains emoji (such as 😀 or flags) not found in the symbol font either. Monochrome outline emoji (for color emoji, pass a font such as Noto Color Emoji with `--font` or `@font-face`) | SIL Open Font License 1.1 |

- Every document loads the eight files of the first two rows (four Japanese and four Latin). They are about 29MB in total, of which Noto Serif JP is 8.0MB per file and Noto Sans JP 5.7MB per file. The others are loaded only when the document needs them.
- Bold text is typeset in the Bold of the same font (bold text in Mincho uses Noto Serif JP Bold).
- The fonts used by default can also be found in the library's `DEFAULT_FONTS`.
- Fonts for Arabic, Thai, Devanagari, Hangul, Simplified and Traditional Chinese, color emoji and the like are not among the default fonts; pass them with `--font` or `fonts` ("Other scripts" in [`docs/en/features.md`](features.md)).

## Pointing to fonts from the document

Besides the default fonts, the document itself can point to fonts.

| How it is written | How the font is obtained |
| --- | --- |
| `@font-face { src: url(https://…/a.ttf) }` | Fetched from the network (when `fetchStyles` allows it; it does by default) |
| `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai">` | A stylesheet such as Google Fonts' is read as CSS even without a `.css` extension, and the fonts of its `@font-face` rules are fetched |
| `@font-face { src: url(fonts/a.ttf) }` (relative reference) | Read from `files`, `resolveResource` or the input directory (no network) |
| `font-family: "Noto Sans Thai"` (name only) | Not fetched. Looked up by name among the fonts passed in `files`, `--font` or `fonts` |

- Fonts of `@font-face` rules whose `unicode-range` does not overlap the document's characters are not fetched (CSS Fonts 4 §4.5). From stylesheets that split fonts by character range (such as Google Fonts'), only what the document needs is fetched.
- Fetching from the network can be stopped with `--no-fetch-styles` or `fetchStyles: false`, or limited to allowed URLs ("Files and external resources" in [`docs/en/library.md`](library.md)).
- When none of the files in the `src` of an `@font-face` rule can be found, a warning is given.
- XSL-FO has no `@font-face`, so fonts are passed with `--font` or `fonts`.

## Where fetched fonts are kept, and offline use

| Form | Where fonts are kept / offline use |
| --- | --- |
| Node CLI | Saves the fetched fonts to the OS cache (`~/.cache/kumiori/fonts` etc.; can be changed with `--font-cache`) and does not use the network from the second run on. For offline use, either run once online to fill the cache, or specify the directory to read with `--font-dir` |
| Web app (browser) | TTFs with the same names placed in `public/fonts/` are used as a fallback (not tracked by git) |
| Library (`typeset`) | The default fetching tries only `https:` URLs, so pass local fonts via `loadFont`. In Node, `createFontLoader()` from `kumiori/node` reads fonts the same way as the CLI ([`docs/en/library.md`](library.md)) |

Fonts placed in `public/fonts/` are also copied to the build output of the web app (`dist/fonts/`). If you do not want them in what you distribute, remove them before building.
The contents of `public/` are not copied to the output distributed through npm (`dist-cli/`, `dist-lib/`, `dist-browser/`). The Node CLI looks only at the directory passed with `--font-dir`.

## Embedding in the PDF and licenses

The fonts used are embedded in the PDF as subsets of the glyphs used. Check the license terms of each font with its distributor.
