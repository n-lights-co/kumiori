> 日本語: [README.md](README.md)

# Example: selecting a page of a draw.io diagram

An example that selects the page to draw from one draw.io diagram file (`diagrams.drawio`, 3 pages) after `#` in the image reference.
The syntax is described in [Selecting a page in the description of draw.io diagrams](../../docs/en/drawio.md#selecting-a-page).

| File | Contents |
| --- | --- |
| `diagrams.drawio` | A 3-page diagram: page 1 "全体図" (overview; id `overview`), page 2 "組版の流れ" (typesetting flow; id `flow`) and page 3 "凡例" (legend; id `legend`, stored compressed). It can be opened and edited in draw.io |
| `pages.html` | A document (in Japanese) that places the diagram with no fragment, `#page=2`, `#page-id=legend`, `#組版の流れ`, `#%E5%87%A1%E4%BE%8B` ("凡例") and `#page=9` (a page that does not exist) |
| `pages.fo` | The same diagrams placed with the `src` of XSL-FO's `fo:external-graphic` (`url('diagrams.drawio#page=2')` and so on; one is written without `url()`) |

## Typesetting

From the root of the repository:

```sh
npm run build:cli
node dist-cli/cli.js examples/drawio-pages/pages.html -o pages.pdf
node dist-cli/cli.js examples/drawio-pages/pages.fo -o pages-fo.pdf
```

With Kumiori installed (draw.io diagrams are read by default):

```sh
kumiori pages.html -o pages.pdf
kumiori pages.fo -o pages-fo.pdf
```

Each results in a 3-page A4 PDF. The small text at the lower left of each diagram ("2 ページ目「組版の流れ」" and so on) tells which page was drawn.
The last diagram (`#page=9`) refers to a page that does not exist, so the first page is drawn and a warning is reported (in English with `--lang en`; this is for `pages.html`, and for `pages.fo` the message is preceded by the place in the FO, `pages.fo:62:19 (fo:external-graphic):`):

```
  warning [image/partial] part of image diagrams.drawio#page=9 cannot be drawn: the draw.io diagram has no page 9 (it has 3; the first page is drawn)
```

In the web app (demo), open `pages.html` or `pages.fo` together with `diagrams.drawio`.

The diagram and document of this example were made for Kumiori and are under the same license as Kumiori.
