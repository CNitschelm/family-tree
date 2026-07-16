
# family-tree
Interactive Nitschelm family tree — rebuilt from astrosurf.com/nitschelm

## Access
The genealogical data (and photos) are AES-GCM encrypted inside `index.html`. Visitors enter the shared family password once per device; the derived key is remembered in the browser. The password is NOT in this repo — it lives in a git-ignored `.password` file locally (and optionally an `FT_PASSWORD` GitHub Actions secret for full CI coverage).

Note: this protects against scrapers and casual snooping only. The same underlying genealogy is publicly available on the original astrosurf source site. Repo history starts at the encrypted state (pre-encryption history was purged 2026-07-16); keep it that way — never commit plaintext data, data.json, or .password.

## Structure
- `index.html` — the whole site. UI code is plaintext; the `DATA` payload (people, dates, notes, photos as data URIs) is ciphertext in the `ENC` constant.
- `tools/crypt.js` — decrypt/edit/re-encrypt workflow:

```
node tools/crypt.js decrypt   # writes data.json (git-ignored)
# edit data.json  (photos go in "img" fields as data:image/... URIs)
node tools/crypt.js encrypt   # writes new ENC into index.html
node tests/run.js             # must pass before committing
```

- `favicon.png` — public (just the logo).
- `tests/run.js` — zero-dependency regression suite.

## Testing
Run before every commit:

```
node tests/run.js
```

Exit code 0 = safe to commit. Requires the password (`.password` file or `FT_PASSWORD` env) for the full suite; without it only HTML/syntax checks run. GitHub Actions runs the same suite on every push (`.github/workflows/test.yml`) — add an `FT_PASSWORD` repository secret (Settings → Secrets and variables → Actions) for full CI coverage.

## Changing the password
Set the new password in `.password`, run `node tools/crypt.js decrypt` with the OLD password first (temporarily via `FT_PASSWORD=old node tools/crypt.js decrypt`), then `encrypt` with the new one. Every family member must re-enter the password afterwards.
