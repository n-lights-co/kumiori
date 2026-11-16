> English: [README.en.md](README.en.md)

# 見本: draw.io の図のページの選び方

1 つの draw.io の図のファイル (`diagrams.drawio`。3 ページ) から、画像の参照の `#` の後ろで描くページを選ぶ見本です。
書き方は [draw.io の図の説明の「ページの選び方」](../../docs/drawio.md#ページの選び方) にあります。

| ファイル | 中身 |
| --- | --- |
| `diagrams.drawio` | 3 ページの図。1 ページ目「全体図」(id `overview`)・2 ページ目「組版の流れ」(id `flow`)・3 ページ目「凡例」(id `legend`。中身を圧縮した形)。draw.io で開いて直せます |
| `pages.html` | 何も付けない参照・`#page=2`・`#page-id=legend`・`#組版の流れ`・`#%E5%87%A1%E4%BE%8B` (「凡例」)・`#page=9` (無いページ) で図を置いた文書 (HTML) |
| `pages.fo` | 同じ図を、XSL-FO の `fo:external-graphic` の `src` (`url('diagrams.drawio#page=2')` など。`url()` で囲まない形も 1 つ) で置いた文書 |

## 組み方

リポジトリの直下で:

```sh
npm run build:cli
node dist-cli/cli.js examples/drawio-pages/pages.html -o pages.pdf
node dist-cli/cli.js examples/drawio-pages/pages.fo -o pages-fo.pdf
```

入れた Kumiori で組むときは (draw.io の図は既定で読みます):

```sh
kumiori pages.html -o pages.pdf
kumiori pages.fo -o pages-fo.pdf
```

どちらも A4 の 3 ページの PDF になります。それぞれの図の左下の字 (「2 ページ目「組版の流れ」」など) で、どのページを描いたかが分かります。
最後の図 (`#page=9`) は無いページなので、最初のページを描いて、次の警告が出ます。

```
警告: 画像 diagrams.drawio#page=9 の一部を描けません: draw.io の図に 9 ページ目がありません (3 ページ。最初のページを描きます)
```

画面 (デモの Web アプリ) では、`pages.html` か `pages.fo` を、`diagrams.drawio` と一緒に開きます。

この見本の図と文書は、Kumiori のために作ったもので、Kumiori と同じ使用許諾です。
