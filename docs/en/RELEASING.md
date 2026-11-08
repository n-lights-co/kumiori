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
3. Write that URL in the "Web app (browser)" section of the README

### If the repository is moved to another account (organization)

Update the `homepage`, `repository` and `bugs` URLs in `package.json` and the GitHub Pages URL in the README to those of the new account (the GitHub repository URL is redirected from the old one, but the GitHub Pages URL is not).

## 2. For every release

1. Write the entry for the version in `CHANGELOG.md` (replace "(未公開)" ("unreleased") with the date)
2. Raise `version` in `package.json` (using `npm version patch|minor|major` also creates the commit and the tag `v0.1.1`)
3. Pre-publish check:

   ```bash
   npm publish --dry-run
   ```

   `prepublishOnly` runs the type check, the tests and the three builds (`build:dist`), and the list of files that go into the tarball is printed. Check that `dist-lib`, `dist-cli`, `dist-browser`, README, LICENSE and so on are included, and that `src` and the tests are not
4. Publish:

   ```bash
   npm publish
   ```

   You are asked for the two-factor authentication code. A published version can be unpublished, but the same number can never be reused, so look at the `--dry-run` result before publishing
5. Tag and GitHub Release:

   ```bash
   git push origin main --tags
   ```

   Create a release for `v0.1.0` under Releases on GitHub, with the CHANGELOG entry as its body
6. Verify: in another directory, `npx kumiori@<version> --version` works, `https://cdn.jsdelivr.net/npm/kumiori@<version>/dist-browser/kumiori.js` can be opened, and the GitHub Pages web app has been updated

## Notes

- The fonts are included neither in the npm package nor in Pages. They are fetched from Google Fonts on first run (the Node CLI saves them to a cache)
- The library is ES module only. Loading it with `require()` requires Node 22 or later
- If npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) is set up, publishing can be done from GitHub Actions when a tag is pushed (no token has to be stored, and provenance is attached). After publishing the first version locally, register the GitHub repository and the workflow name in the npm package settings, and add a publishing workflow
