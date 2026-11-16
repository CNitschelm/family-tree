
# family-tree
Interactive Nitschelm family tree — rebuilt from astrosurf.com/nitschelm

## Access
The genealogical data (and photos) are AES-GCM encrypted inside `index.html`. Visitors enter the shared family password once per device; the derived key is remembered in the browser. The password is NOT in this repo — it lives in a git-ignored `.password` file locally (and optionally an `FT_PASSWORD` GitHub Actions secret for full CI coverage).

Note: this protects against scrapers and casual snooping only. The same underlying genealogy is publicly available on the original astrosurf source site. Repo history starts at the encrypted state (pre-encryption history was purged 2026-07-16); keep it that way — never commit plaintext data, data.json, or .password.

## Structure
- `index.html` — the whole site. UI code is plaintext; the `DATA` payload (people, dates, notes, photos as data URIs) is ciphertext in the `ENC` constant.
- `tools/crypt.js` — decrypts the payload into `data.json` (git-ignored) and encrypts it back. `data.json` is never edited by hand: every change goes through `tools/change.js`, with its reason and its evidence, and `checks/gate.js` must pass before a commit that touches `index.html`. `OPERATING.md` describes the whole loop; in short:

```
node tools/crypt.js decrypt          # writes data.json (git-ignored)
node tools/change.js <change file>   # the only way an edit reaches data.json (a photo too)
node tools/crypt.js encrypt          # writes new ENC into index.html, and the files in media/
node checks/gate.js                  # proves the payload is what the change ledger says; runs the tests
```

- `media/` — everything the tree's cards don't show, AES-GCM encrypted under the same key: one file with the bios, notes, sources and places, and one per bio picture (large portraits and the original records). The page itself carries only the cards; it downloads the rest at once and the pictures after it. `tools/payload.js` is the one place that reads and writes the payload and these files; `data.json` still holds everything, every picture inline.
- `favicon.ico`, `favicon.svg`, `apple-touch-icon.png` and `favicon.png` — public (just the logo, the same as the personal site's).
- `tests/run.js` — zero-dependency regression suite for the site. `tests/research.js` and `tests/ledger.js` test the research tools and the change loop on invented data.

## Testing
Run before every commit:

```
node tests/run.js        # the site
node tests/research.js   # the research tools
node tests/ledger.js     # the change loop
```

Exit code 0 = safe to commit. `tests/run.js` requires the password (`.password` file or `FT_PASSWORD` env) for the full suite; without it only HTML/syntax checks run, and its name checks do not. The other two need no password. `checks/gate.js` runs all three, and the commit hook refuses an `index.html` the gate has not passed. GitHub Actions runs the three suites on every push (`.github/workflows/test.yml`) — add an `FT_PASSWORD` repository secret (Settings → Secrets and variables → Actions) for full CI coverage.

## Changing the password
Set the new password in `.password`, run `node tools/crypt.js decrypt` with the OLD password first (temporarily via `FT_PASSWORD=old node tools/crypt.js decrypt`), then `encrypt` with the new one. Every family member must re-enter the password afterwards.
