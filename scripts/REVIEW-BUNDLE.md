# Review-tool bundle — consumer notes

This directory carries a small set of files distributed from the
[roster](https://github.com/mathiasbourgoin/roster) repo: the deterministic tools
`roster-review`/`roster-qa` depend on, plus their shared libraries and schema.

**These files are upstream-owned and generated.** `scripts/review-bundle.manifest.json` is the
sole sentinel — it lists every file in the bundle with its expected sha256. **Do not hand-edit
any bundle file or the manifest.** A local edit will be detected as "modified" on the next
verify/upgrade/remove and handled conservatively (skipped with a warning, or refused outright) —
see the recovery guidance those commands print if that happens.

## Commands

Run from the repo root, using `scripts/review-bundle-install.sh` (the one script that owns this
entire lifecycle — nothing else in this repo re-implements it):

```bash
# Verify the installed bundle is complete and unmodified (no network calls).
bash scripts/review-bundle-install.sh verify

# Install (first time) or upgrade (already installed) from the roster repo.
bash scripts/review-bundle-install.sh install --from-raw https://raw.githubusercontent.com/mathiasbourgoin/roster/main
bash scripts/review-bundle-install.sh upgrade --from-raw https://raw.githubusercontent.com/mathiasbourgoin/roster/main

# Remove the bundle (the shared wrapper, scripts/xruntime-exec.sh, is kept — other
# tools may still depend on it).
bash scripts/review-bundle-install.sh remove
```

Full details, including collision handling and `--force`: see the header comment of
`scripts/review-bundle-install.sh`, and specs/review-tool-distribution.md in the roster repo.
