> 日本語: [../app.md](../app.md)

# Using the web app (browser)

The web app opens a document in the browser, shows the typeset pages and saves the PDF.
Open the app hosted on GitHub Pages (<https://n-lights-co.github.io/kumiori/>), or put the `dist/` from `npm run build` on a static web server.

The app's interface is in Japanese; the labels are given below with their English meaning.

## Opening

- "Open" (開く) lets you select HTML, XSL-FO or EPUB files together with the CSS, images and fonts they use (several can be selected).
- "Open folder" (フォルダを開く) selects a whole folder; you can also open files or folders by dragging and dropping them onto the page.
- When a folder contains several documents, index.html (or, failing that, the document at the shallowest location) is opened.

## Saving

"Save PDF" (PDF を保存) writes out the PDF. "Save logical tree as JSON" (論理ツリーを JSON で保存) writes out the logical tree of the loaded document (its structure and formatting before typesetting) as JSON (<document name>.json). On the left are page thumbnails and warnings (collapsible).

"API reference" (API の説明書) at the top opens the list of the library's functions, types and options (the [API reference](https://n-lights-co.github.io/kumiori/api/)) in a new tab. On narrow screens, it is under "Other" (そのほか) in "Settings" (設定).

## Settings

"Settings" (設定) on the right has the following.

| Setting | Contents | CLI equivalent |
| --- | --- | --- |
| Default style | The default style for HTML | `--style` |
| Default page size | The paper for HTML that does not specify `size` in `@page`: A4, A5, B5, JIS-B5, letter or free input | `--page-size` |
| CSS interpretation | The own cascade (default), or a browser iframe for comparison | |
| "Typeset with the spec's default values" | The XSL-FO default-value convention | `--compat` |
| Trim marks | Add trim marks and a 3mm bleed | `--print` |
| Guides | Draw the trim and bleed guide lines on the pages on screen (on by default; with trim marks; not included in the PDF) | (`guides` of `renderPage` and others in the API) |
| Tagged PDF | Put the document structure, reading order, alternative text for figures and language into the PDF (on by default; the appearance does not change). When off, no tags are added | `--tagged`, `--no-tagged` |
| Font loading | Load fonts on your PC (TTF, OTF, TTC; MS Mincho, MS Gothic and so on) and use them. They are never sent outside the PC | `--font` |
| draw.io diagrams | Reading them or not, shape libraries ([`docs/en/drawio.md`](drawio.md)) | `--no-drawio` and others |

## Warnings

Warnings are listed one by one in the left column.

- Identical messages are merged. Four or more are collapsed to a count and can be opened. The count also appears in the top bar.
- Each line shows a severity mark (✖ content missing from the output, ⚠ warning, ℹ notice) and the diagnostic code ([`docs/en/diagnostics.md`](diagnostics.md)) and, when known, the element, line and page.
- Clicking a line with a page moves to that page.
- Warnings for HTML show no line. The app reads HTML with the browser's HTML parser (`DOMParser`), which keeps no character positions (the same with either CSS interpretation, "Kumiori" or "ブラウザ (比較用)" (browser, for comparison)). Warnings for XSL-FO show the line. When you need the line, typeset with the command or the API.

They are the same warnings as the CLI and the API give:

- layout warnings
- unsupported CSS and XSL-FO, and unknown CSS properties
- links whose actions were not written to the PDF for safety
- nesting deeper than 128 levels and too many `@import`s
- EPUB items skipped for exceeding the limits
- images not fetched
- font notices (fonts that could not be fetched and so on)

## Documents stay in the browser

All typesetting happens inside the browser; documents and fonts are never sent out.
The only things fetched from outside are the default fonts, the images the document references via `http(s):`, and the draw.io shape libraries when allowed in "Settings" (設定).
It also works when the `dist/` from `npm run build` is placed on a static web server. How to place fonts for offline use is in [`docs/en/fonts.md`](fonts.md).
