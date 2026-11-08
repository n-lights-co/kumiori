> English: [en/RELEASING.md](en/RELEASING.md)

# 公開の手順

Kumiori は 3 つの形で公開します。

| 形 | 置き場所 | 中身 |
| --- | --- | --- |
| npm のパッケージ `kumiori` | npm (registry.npmjs.org) | ライブラリ (`dist-lib`)、ブラウザ用の 1 ファイル (`dist-browser`)、Node のコマンド (`dist-cli`) |
| ブラウザの画面 | GitHub Pages | `npm run build` の `dist/` |
| ソース | GitHub | このリポジトリ |

## 1. 最初に 1 度だけ

### npm

1. https://www.npmjs.com/ でアカウントを作り、二段階認証 (2FA) を有効にする (公開には必須)。会社名義の組織 (Organization) は無くても公開できる
2. 手元で `npm login` する (ブラウザが開いて認証する)

### GitHub Pages

1. リポジトリの **Settings → Pages** で、**Source** を「**GitHub Actions**」にする
2. main に push すると、`.github/workflows/pages.yml` が `dist/` を作って置く。URL は `https://<アカウント>.github.io/kumiori/` (Actions の「Pages」の実行結果にも出る)
3. リポジトリが非公開の間は、配置 (deploy) の段階を飛ばす (無料のプランでは非公開のリポジトリの Pages を有効にできないため)。ビルドは毎回走る。公開にして 1 の設定をすれば、次の push から配置される (すぐ置くなら Actions の「Pages」を「Run workflow」で動かす)
3. その URL を README の「画面 (ブラウザ)」の項に書く

### リポジトリを別のアカウント (組織) へ移したら

`package.json` の `homepage`・`repository`・`bugs` の URL と、README の GitHub Pages の URL を新しいアカウントのものに直す (GitHub のリポジトリの URL は古いものから転送されるが、GitHub Pages の URL は転送されない)。

## 2. 版を出すたびに

1. `CHANGELOG.md` に、その版の項目を書く (「(未公開)」を日付にする)
2. `package.json` の `version` を上げる (`npm version patch|minor|major` を使うと、コミットとタグ `v0.1.1` も作られる)
3. 公開前の確認:

   ```bash
   npm publish --dry-run
   ```

   `prepublishOnly` が型検査・テスト・3 つのビルド (`build:dist`) を走らせ、tarball に入るファイルの一覧が出る。`dist-lib`・`dist-cli`・`dist-browser`・README・LICENSE などが入っていること、`src` やテストが入っていないことを見る
4. 公開:

   ```bash
   npm publish
   ```

   二段階認証のコードを聞かれる。一度公開した版は取り消せても同じ番号を使い直せないので、`--dry-run` の結果を見てから公開する
5. タグと GitHub Release:

   ```bash
   git push origin main --tags
   ```

   GitHub の Releases で `v0.1.0` のリリースを作り、CHANGELOG の項目を本文にする
6. 確認: 別のディレクトリで `npx kumiori@<版> --version` が動くこと、`https://cdn.jsdelivr.net/npm/kumiori@<版>/dist-browser/kumiori.js` が開けること、GitHub Pages の画面が新しくなっていること

## 補足

- 書体は npm のパッケージにも Pages にも入れていない。初回の実行時に Google Fonts から取る (Node のコマンドはキャッシュに保存する)
- ライブラリは ES モジュールだけ。`require()` で読むには Node 22 以降が要る
- npm の [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) を設定すれば、タグを push したときに GitHub Actions から公開できる (トークンの保管が要らず、来歴 (provenance) も付く)。最初の版を手元から公開した後に、npm のパッケージの設定で GitHub のリポジトリとワークフローの名前を登録し、公開のワークフローを足す
