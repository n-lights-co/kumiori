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
4. その URL を README の「画面 (ブラウザ)」の項に書く

### リポジトリを別のアカウント (組織) へ移したら

`package.json` の `homepage`・`repository`・`bugs` の URL と、README の GitHub Pages の URL を新しいアカウントのものに直す (GitHub のリポジトリの URL は古いものから転送されるが、GitHub Pages の URL は転送されない)。

## 2. 版を出すたびに

main はルールセットで守っているので、版の変更も PR で入れる。npm への公開は、タグを push すると GitHub Actions (`.github/workflows/publish.yml`) が行う (Trusted Publishing。下の「Trusted Publishing の設定」)。

1. 作業用のブランチで、`CHANGELOG.md`・`CHANGELOG.en.md` にその版の項目を書き (見出しは「0.1.1 (公開の日付)」)、`package.json` の `version` を上げる。
   `npm version patch|minor|major --no-git-tag-version` を使う (タグはマージした後の main に付けるので、ここでは作らない)
2. 公開前の確認:

   ```bash
   npm publish --dry-run
   ```

   `prepublishOnly` が型検査・テスト・3 つのビルド (`build:dist`) を走らせ、tarball に入るファイルの一覧が出る。`dist-lib`・`dist-cli`・`dist-browser`・README・LICENSE などが入っていること、`src` やテストが入っていないことを見る。
   前の版から依存パッケージ (`package-lock.json`) や、ソースに写した仕様書・データが変わっていれば、`THIRD_PARTY_NOTICES.md` を合わせる。`npm ls --omit=dev --all` の版が 2 節と、ブラウザ向けのビルドに取り込まれたパッケージ (`npx vite build --config vite.browser.config.ts --sourcemap` の `.map` の `sources` の `node_modules/…`) が 1 節と合っていることを見る
3. PR を作り、CI が通ったらマージする
4. マージした後の main にタグを付けて push する:

   ```bash
   git switch main && git pull
   git tag -a v0.1.1 -m "v0.1.1"
   git push origin v0.1.1
   ```

   publish.yml が、タグと `package.json` の版が同じで、タグのコミットが main に入っていることを確かめ、型検査・テスト・3 つのビルドをして tarball を作る (build ジョブ)。その tarball を、別のジョブ (publish) が `npm publish` する。npm へ公開する権限 (OIDC) を持つのは publish ジョブだけで、そこでは依存を入れず、スクリプトも走らせない。Actions の「Publish」の実行で結果を見る。
   一度公開した版は取り消せても同じ番号を使い直せない
5. GitHub の Releases で、そのタグのリリースを作り、CHANGELOG の項目 (日本語と英語) を本文にする。
   リリースを公開すると、`.github/workflows/conformance-pdf.yml` がそのタグのコミットで対応仕様説明書を組み、PDF 4 冊 (v0.1.1 なら `kumiori-xsl-fo-v0.1.1.pdf`・`kumiori-html-css-v0.1.1.pdf` と、それぞれの `.en.pdf`) をリリースに付ける。Actions の「Conformance PDF」の実行で結果を見る。
   失敗したときや付け直すときは、「Conformance PDF」を「Run workflow」で動かし、タグを入れる (同じ名前のファイルは置き換える)
6. 確認: 別のディレクトリで `npx kumiori@<版> --version` が動くこと、`https://cdn.jsdelivr.net/npm/kumiori@<版>/dist-browser/kumiori.js` が開けること、GitHub Pages の画面が新しくなっていること

### Trusted Publishing の設定 (最初に 1 度だけ)

npm の Trusted Publishing では、GitHub Actions が OIDC で npm に認証する。npm のトークンを GitHub に保管しない。来歴 (provenance) も自動で付く。

1. npm の `kumiori` のパッケージの **Settings** で、**Trusted Publisher** に GitHub Actions を足し、次を入れる:
   - Organization or user: `n-lights-co`
   - Repository: `kumiori`
   - Workflow filename: `publish.yml` (拡張子まで同じに)
   - Environment name: `npm`
2. 登録した設定は、48 時間のうちに 1 度公開に使われないと切れる。次の版を出す直前に登録する (切れたら登録し直す)
3. 公開の前に人の承認を挟むなら、GitHub のリポジトリの **Settings → Environments → npm** で **Required reviewers** を付ける (環境 `npm` は publish.yml が初めて動いたときにできる。先に作っておいてもよい)
4. Trusted Publishing で公開できたら、npm のパッケージの **Settings → Publishing access** で、トークンでの公開を禁じる設定 (「Require two-factor authentication and disallow tokens」) にする
5. タグを勝手に消したり付け替えたりできないよう、GitHub の **Settings → Rules** でタグのルールセット (対象 `v*`、Restrict deletions・Restrict updates) を作っておく

手元からの公開 (`npm login` してから `npm publish`) もできる。Trusted Publishing が使えないときの代わりにする (4 でトークンを禁じても、2FA での手元からの公開はできる)

## 補足

- 書体は npm のパッケージにも Pages にも入れていない。初回の実行時に Google Fonts から取る (Node のコマンドはキャッシュに保存する)
- ライブラリは ES モジュールだけ。`require()` でも読める (ES モジュールを `require()` で読める Node 20.19.0 以降・22.12.0 以降。`exports` の条件は `types` と `default`)。動かせる Node は 20.19.0 以降の 20 系と 22.12.0 以降 (`engines` は `^20.19.0 || >=22.12.0`。依存パッケージの求める版で、`require()` で ES モジュールを読める版。CI は下限の 20.19.0 と 22 で確かめる)
- Trusted Publishing の仕組みと条件 (npm 11.5.1 以上・Node 22.14.0 以上・GitHub のホストのランナー) は npm の説明 ([Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers)) にある
- ワークフローの Action は、コミットの SHA で固定している (`uses: actions/checkout@<SHA> # v6.1.0`)。版を上げるのは Dependabot の PR (`.github/dependabot.yml`。週に 1 度)。手で上げるときは、`git ls-remote --tags https://github.com/actions/<名前>` でタグの指すコミットを確かめ、SHA と版のコメントを一緒に書き換える
