# Website and downloads

The public landing page is https://dave-patrick.github.io/arnes-control-center/ . Its source is `site/`; the Pages workflow publishes that folder on changes to main. Application hosting and device installation are separate operations.

Run `node scripts/check-site.mjs` before publishing. Preview with any static server rooted at `site/`. Screenshots are existing app captures, not new device verification.

Use GitHub Releases for downloadable versioned packages. Each release must name its source commit/tag, build commands, validation performed, signing/distribution limitations and remaining device checks. Attach SHA256 checksums. Do not label a source archive as a ready-to-run app. Development APKs are debug signed; builds from a fresh machine can have a different debug certificate and cannot update an existing installation signed by another key. Preserve local data and signing keys; do not tell users to uninstall to resolve that mismatch.

The landing page links explicitly to available prereleases because GitHub's /releases/latest omits prereleases. Update the link and version together after a new release succeeds. Never publish credentials, local.properties, logs, browser profiles or personal backups.

