> English translation of [../RELEASING.md](../RELEASING.md) (the Japanese text is the original).

# Release procedure

Kumiori is released in three forms.

| Form | Where | Contents |
| --- | --- | --- |
| npm package `kumiori` | npm (registry.npmjs.org) | the library (`dist-lib`), the single file for browsers (`dist-browser`), the Node CLI (`dist-cli`) |
| Browser web app and API reference | GitHub Pages | the `dist/` from `vite build` (with the asset base set to the repository name), and the API reference below it (`dist/api/` from `npm run docs:api`) |
| Source | GitHub | this repository |

## 1. Once, at the start

### npm

1. Create an account at https://www.npmjs.com/ and enable two-factor authentication (2FA) (required for publishing). An Organization in the company's name is not needed to publish
2. Run `npm login` locally (a browser opens for authentication)

### GitHub Pages

1. In the repository's **Settings → Pages**, set **Source** to "**GitHub Actions**"
2. On a push to main, `.github/workflows/pages.yml` builds `dist/` (the web app, with the API reference under `api/`) and deploys it. The URL is `https://<account>.github.io/kumiori/` (the API reference is at `https://<account>.github.io/kumiori/api/`; the URL is also shown in the result of the "Pages" run under Actions)
3. While the repository is private, the deploy step is skipped (on the free plan, Pages cannot be enabled for a private repository). The build still runs every time. Once the repository is public and step 1 is done, the next push deploys it (to deploy right away, run the "Pages" workflow with "Run workflow" under Actions)
4. Write that URL in "Getting started" in the README (Japanese and English) and in `docs/app.md` and `docs/en/app.md`, and the URL of the API reference in the "Documentation" table of the README and in `docs/library.md` and `docs/en/library.md`

### If the repository is moved to another account (organization)

Update the `homepage`, `repository` and `bugs` URLs in `package.json` and the GitHub Pages URLs in the README and the docs (`docs/app.md`, `docs/library.md` and their English versions) to those of the new account (the GitHub repository URL is redirected from the old one, but the GitHub Pages URL is not).

## 2. For every release

main is protected by a ruleset, so version changes also go in through a PR. Publishing to npm is done by GitHub Actions (`.github/workflows/publish.yml`) when a tag is pushed (Trusted Publishing; see "Setting up Trusted Publishing" below).

1. On a working branch, write the entry for the version in `CHANGELOG.md` and `CHANGELOG.en.md` (heading "0.1.1 (date of publication)") and raise `version` in `package.json`.
   Use `npm version patch|minor|major --no-git-tag-version` (the tag is put on main after merging, so do not create it here).
   Also change the version in the URL of the CDN example in the library guide (`docs/library.md`, `docs/en/library.md`) (`kumiori@0.2.0` and so on) to the version being published.
   Sentences in the README and the docs (Japanese and English) that say a feature is available "from the next (unreleased) version" (in Japanese 「次の版 (未公開) から」) are also changed to that version number ("from 0.5.0" and so on); find them with `grep -rn '未公開' README.md docs/*.md` and `grep -rn 'unreleased' README.en.md docs/en/*.md`
2. Pre-publish check:

   ```bash
   npm publish --dry-run
   ```

   `prepublishOnly` runs the type check, the tests and the three builds (`build:dist`), and the list of files that go into the tarball is printed. Check that `dist-lib`, `dist-cli`, `dist-browser`, README, LICENSE and so on are included, and that `src`, the tests and source maps (`.map`) are not (source maps are not distributed; `test/package.test.ts` in `npm test` also checks that there are no `.map` files and no `//# sourceMappingURL=` lines).
   If the dependencies (`package-lock.json`) or the specifications and data copied into the source have changed since the previous version, update `THIRD_PARTY_NOTICES.md` to match. Check that the versions from `npm ls --omit=dev --all` match section 2, and that the packages bundled into the browser build and the web app build (the `node_modules/…` entries in `sources` of the `.map` files from `npx vite build --config vite.browser.config.ts --sourcemap` and `npx vite build --sourcemap --outDir <another directory>`) match section 1. If the bundler (vite, rolldown) versions change, update the versions and the copied texts in section 1.6 as well. `test/thirdPartyNotices.test.ts` in `npm test` also checks that the versions and licenses of the runtime dependencies and of the bundlers in section 1.6, and the license texts copied from node_modules, match the files (it fails on a mismatch).
   If the versions of the tool that builds the API reference (`tools/api-docs/package-lock.json`; TypeDoc) have changed, update section 14 of `THIRD_PARTY_NOTICES.md` (TypeDoc and lunr, which go into the pages of the reference); the same test checks the versions and licenses, and, after `npm run docs:api`, the copied license texts too.
   Also check that the API reference can be built (`npm run docs:api`; TypeDoc warnings, such as unknown tags in comments or types referenced by the public types but not exported from `src/index.ts`, are errors)
3. Open a PR, and merge it once CI passes
4. Tag main after the merge and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v0.1.1 -m "v0.1.1"
   git push origin v0.1.1
   ```

   publish.yml checks that the tag matches the version in `package.json` and that the tagged commit is on main, runs the type check, the tests and the three builds, and packs a tarball (the build job). A separate job (publish) then runs `npm publish` on that tarball. Only the publish job holds the permission to publish to npm (OIDC); it installs none of the project's dependencies (only npm 11.5.1 or later, which Trusted Publishing needs) and runs no scripts. See the result in the "Publish" run under Actions.
   A published version can be unpublished, but the same number can never be reused
5. Create a release for the tag under Releases on GitHub, with the CHANGELOG entry (Japanese and English) as its body.
   When the release is published, `.github/workflows/conformance-pdf.yml` typesets the Conformance Guide at the tagged commit and attaches the four PDFs (for v0.1.1, `kumiori-xsl-fo-v0.1.1.pdf`, `kumiori-html-css-v0.1.1.pdf` and their `.en.pdf` versions) to the release. Check the result in the "Conformance PDF" run under Actions.
   If it fails, or to attach them again, run "Conformance PDF" with "Run workflow" and enter the tag (files with the same names are replaced)
6. Verify: in another directory, `npx kumiori@<version> --version` works, `https://cdn.jsdelivr.net/npm/kumiori@<version>/dist-browser/kumiori.js` can be opened, and the GitHub Pages web app and the API reference (`/api/`) have been updated

### Setting up Trusted Publishing (once)

With npm's Trusted Publishing, GitHub Actions authenticates to npm with OIDC. No npm token is stored on GitHub, and provenance is attached automatically.

1. In the **Settings** of the `kumiori` package on npm, add GitHub Actions under **Trusted Publisher** with:
   - Organization or user: `n-lights-co`
   - Repository: `kumiori`
   - Workflow filename: `publish.yml` (including the extension)
   - Environment name: `npm`
2. A registered configuration expires unless it is used for a publish within 48 hours. Register it just before releasing the next version (register it again if it has expired)
3. To require a human approval before publishing, add **Required reviewers** under **Settings → Environments → npm** of the GitHub repository (the `npm` environment is created the first time publish.yml runs; it can also be created in advance)
4. Once a publish through Trusted Publishing has succeeded, set **Settings → Publishing access** of the npm package to disallow publishing with tokens ("Require two-factor authentication and disallow tokens")
5. Create a tag ruleset under **Settings → Rules** on GitHub (target `v*`, Restrict deletions and Restrict updates) so that tags cannot be deleted or moved

Publishing locally (`npm login`, then `npm publish`) is still possible, as a fallback when Trusted Publishing cannot be used (even with tokens disallowed in step 4, publishing locally with 2FA works)

## Notes

- The API reference (`npm run docs:api`; `scripts/build-api-docs.mjs`) is generated by TypeDoc from the comments in the type declarations of the public API. The comments are in Japanese, so the reference is in Japanese only; in English, the library guide (`docs/en/library.md`) covers the main functions and options. TypeDoc 0.28 supports only TypeScript up to 6.0, so TypeDoc and the TypeScript it uses are installed with the `package.json` and `package-lock.json` in `tools/api-docs`, separately from the top-level dependencies (TypeScript 7) (the script runs `npm ci` there; they are not in the npm package)
- The fonts are included neither in the npm package nor in Pages. They are fetched from Google Fonts on first run (the Node CLI saves them to a cache)
- The library is ES module only. It can also be loaded with `require()` (on Node 20.19.0 or later and 22.12.0 or later, which can load ES modules with `require()`; the conditions in `exports` are `types` and `default`). Node 20.19.0 or later in the 20 line, or 22.12.0 or later, is required (`engines` is `^20.19.0 || >=22.12.0`: the versions the dependencies require and that can load ES modules with `require()`; CI tests with the minimum, 20.19.0, and with 22)
- How Trusted Publishing works and what it requires (npm 11.5.1 or later, Node 22.14.0 or later, GitHub-hosted runners) is described by npm ([Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers))
- The actions used by the workflows are pinned to commit SHAs (`uses: actions/checkout@<SHA> # v6.1.0`). Versions are raised by Dependabot PRs (`.github/dependabot.yml`, weekly). To raise one by hand, check the commit the tag points to with `git ls-remote --tags https://github.com/actions/<name>` and rewrite the SHA and the version comment together
