> English translation of [../RELEASING.md](../RELEASING.md) (the Japanese text is the original).

# Release procedure

Kumiori is released in three forms.

| Form | Where | Contents |
| --- | --- | --- |
| npm package `kumiori` | npm (registry.npmjs.org) | the library (`dist-lib`), the single file for browsers (`dist-browser`), the Node CLI (`dist-cli`) |
| Browser web app | GitHub Pages | the `dist/` from `npm run build` |
| Source | GitHub | this repository |

## 1. Once, at the start

### npm

1. Create an account at https://www.npmjs.com/ and enable two-factor authentication (2FA) (required for publishing). An Organization in the company's name is not needed to publish
2. Run `npm login` locally (a browser opens for authentication)

### GitHub Pages

1. In the repository's **Settings → Pages**, set **Source** to "**GitHub Actions**"
2. On a push to main, `.github/workflows/pages.yml` builds `dist/` and deploys it. The URL is `https://<account>.github.io/kumiori/` (it is also shown in the result of the "Pages" run under Actions)
3. While the repository is private, the deploy step is skipped (on the free plan, Pages cannot be enabled for a private repository). The build still runs every time. Once the repository is public and step 1 is done, the next push deploys it (to deploy right away, run the "Pages" workflow with "Run workflow" under Actions)
4. Write that URL in the "Web app (browser)" section of the README

### If the repository is moved to another account (organization)

Update the `homepage`, `repository` and `bugs` URLs in `package.json` and the GitHub Pages URL in the README to those of the new account (the GitHub repository URL is redirected from the old one, but the GitHub Pages URL is not).

## 2. For every release

main is protected by a ruleset, so version changes also go in through a PR. Publishing to npm is done by GitHub Actions (`.github/workflows/publish.yml`) when a tag is pushed (Trusted Publishing; see "Setting up Trusted Publishing" below).

1. On a working branch, write the entry for the version in `CHANGELOG.md` and `CHANGELOG.en.md` (heading "0.1.1 (date of publication)") and raise `version` in `package.json`.
   Use `npm version patch|minor|major --no-git-tag-version` (the tag is put on main after merging, so do not create it here)
2. Pre-publish check:

   ```bash
   npm publish --dry-run
   ```

   `prepublishOnly` runs the type check, the tests and the three builds (`build:dist`), and the list of files that go into the tarball is printed. Check that `dist-lib`, `dist-cli`, `dist-browser`, README, LICENSE and so on are included, and that `src` and the tests are not
3. Open a PR, and merge it once CI passes
4. Tag main after the merge and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v0.1.1 -m "v0.1.1"
   git push origin v0.1.1
   ```

   publish.yml checks that the tag matches the version in `package.json` and that the tagged commit is on main, then runs `npm publish`. See the result in the "Publish" run under Actions.
   A published version can be unpublished, but the same number can never be reused
5. Create a release for the tag under Releases on GitHub, with the CHANGELOG entry (Japanese and English) as its body.
   When the release is published, `.github/workflows/conformance-pdf.yml` typesets the Conformance Guide at the tagged commit and attaches the four PDFs (`kumiori-xsl-fo-v0.1.1.pdf`, `kumiori-html-css-v0.1.1.pdf` and their `.en.pdf` versions) to the release. Check the result in the "Conformance PDF" run under Actions.
   If it fails, or to attach them again, run "Conformance PDF" with "Run workflow" and enter the tag (files with the same names are replaced)
6. Verify: in another directory, `npx kumiori@<version> --version` works, `https://cdn.jsdelivr.net/npm/kumiori@<version>/dist-browser/kumiori.js` can be opened, and the GitHub Pages web app has been updated

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

- The fonts are included neither in the npm package nor in Pages. They are fetched from Google Fonts on first run (the Node CLI saves them to a cache)
- The library is ES module only. Loading it with `require()` requires Node 22 or later
- How Trusted Publishing works and what it requires (npm 11.5.1 or later, Node 22.14.0 or later, GitHub-hosted runners) is described by npm ([Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers))
