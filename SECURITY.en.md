> English translation of [SECURITY.md](SECURITY.md) (the Japanese text is the original).

# Reporting vulnerabilities

If you find a vulnerability in Kumiori, please **do not post it in a public issue, pull request or discussion**. Report it privately instead.

## How to report

Please use GitHub's private vulnerability reporting.

- You can send a report from the repository's "Security" tab → "Report a vulnerability".
- The direct link is https://github.com/n-lights-co/kumiori/security/advisories/new.

Reports may be written in Japanese or English. Including the following helps us confirm the issue sooner:

- What happens (the possible impact)
- Steps to reproduce, and the input used (documents, CSS, images, fonts and so on; as small as possible)
- The Kumiori version and how it is used (the browser app, the Node command or the library API, and the options used)
- The environment (Node version, browser and its version, OS)

When we receive a report, we will acknowledge it and tell you the results of our investigation and our plan for a fix.
Please do not disclose the details until a fixed version is released. When we release the fix, we will ask whether we may credit you by name.

## Supported versions

We fix the latest version published on npm (`latest`), and release the fix as the next version. Fixes are not backported to earlier versions.

## In scope

Kumiori may read and typeset documents, CSS, images and fonts written by others. We treat issues such as the following as vulnerabilities:

- Crafted input (a document, CSS, image or font, including draw.io diagrams) can run arbitrary code on the machine that uses Kumiori
- Files on the machine that typesets can be read and copied into the PDF even though an option forbids it (for example, files outside the input directory are read with `--no-outside-files`)
- Requests can be made to the network even though an option forbids them (for example, by getting around `--no-fetch-images`, `--no-fetch-styles`, `fetchImages` or `fetchStyles`)
- With the default settings, dangerous actions (`javascript:` links, actions that open files and so on) can be written into the PDF
- A small input can use up time or memory beyond the limits described in the library guide [docs/en/library.md](docs/en/library.md) and the command reference [docs/en/cli.md](docs/en/cli.md) (the defaults, or the values the user set with `limits` or `--limit`, lowered limits included), or stop the process

We do not treat the following as vulnerabilities (please report them in a regular issue):

- Behavior the user allowed (links with `--link-schemes '*'` or `--link-launch`, fetching URLs allowed by `fetchImages`, the behavior of a plugin the user passed in (a plugin runs with the same rights as Kumiori), and so on)
- Using a lot of time or memory within the limits described in the library guide [docs/en/library.md](docs/en/library.md) and the command reference [docs/en/cli.md](docs/en/cli.md) (when typesetting documents written by others on a server, set a time and memory limit for each document, as described in the "Limits and memory" section of the command reference [docs/en/cli.md](docs/en/cli.md))
- When the user raises time or size limits above the defaults (`limits`, `--limit`), using correspondingly more time and memory within the raised limits (raising does not change the nesting-depth limits or the limits by file size; "Input limits" in the library guide [docs/en/library.md](docs/en/library.md))
- Errors in the typesetting results (differences in the position or shape of characters or lines) that do not fall under any of the above
- Vulnerabilities in third-party software used by Kumiori that cannot occur in the way Kumiori uses it (if they can, please report them as a Kumiori vulnerability)
