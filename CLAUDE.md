# Working rules for this project

## Standing priorities (Cory, 31 Jul 2026 — applies to every task here)
1. **Thoroughness and accuracy first.** Never trade correctness for a shortcut.
2. **Then token efficiency.**
3. **Time is last.** A task that takes hours is fine if it saves tokens or improves accuracy.
4. **Use subagents whenever they serve those priorities** — fan out for research, document capture, and verification. Prefer one well-briefed agent over many shallow ones; give each the full technique notes so it doesn't rediscover them.

## Scope rule — DO NOT ADD PEOPLE WITHOUT ASKING
Cory's interest is **depth of coverage and history**, not breadth. Do not add new people to the tree — including newly discovered relatives, collateral lines, and non-Nitschelm surnames — without confirming with him first. Enriching existing people (bios, documents, photos, sources, corrections) never needs permission.

## Where things live
| File | Purpose | Committed? |
|---|---|---|
| `index.html` | The whole site. Encrypted `DATA` payload + app. | ✅ |
| `data.json` | Decrypted working copy of the payload. | ❌ never |
| `.password` | Site password. | ❌ never |
| `tests/run.js` | Zero-dependency regression suite (76 tests). | ✅ |
| `tools/crypt.js` | `decrypt` / `encrypt` the payload. | ✅ |
| `tools/photo.js` | Embed a card portrait: `node tools/photo.js "<name>" <file> [birthyear]` | ✅ |
| `OPEN-ITEMS.md` | **Living action list** — read at the start of a session, update at the end. | ❌ (names) |
| `CHANGE-LOG-COMMITS.md` | Narrative changelog. The story of each change lives here, **not** in commit messages. | ❌ (names) |
| `bio-research-notes.md` | Research log, newest entry at top. | ❌ (names) |
| `AUDITOR-NOTES.md` / `AUDIT-PROMPT.md` | For the independent auditor. | ❌ (names) |
| `evidence/` | Original document crops. | ❌ |

## Privacy invariant (non-negotiable) — read this before every commit

**Nothing outside the AES-GCM ciphertext may name a person.** Not the site's plaintext
layer, not a code comment, not a test fixture, not a regex, not a commit message. Two
reasons it is stricter than it looks:

1. The repo is **public**. Anyone can read every tracked file without the password.
2. **GitHub Pages serves every file in the repo.** `…github.io/family-tree/tests/run.js`
   returns 200 to anyone holding the family link. The plaintext files are not "developer
   only" — they are part of the published site.

`node tests/run.js` enforces this (§14) across **all tracked files**, using the payload's
own names. It is not advisory: it fails the build. Deliberate exceptions live in one
`ALLOW` set in that test — `nitschelm`, `schweitzer`, `sartre` (the site is openly this
family's tree) and `cory` (the owner's own name, already public as the account name).
Adding to `ALLOW` is a privacy decision; do not do it to make a test pass.

Never commit `.password`, `data.json`, `evidence/`, or any research `.md`. `.gitignore` is
**deny-by-default** — everything is ignored unless explicitly un-ignored, so a new research
file cannot be committed by accident. Adding a real site file means adding a `!` line.

*History: on 12 Aug 2026 commit messages had to be rewritten and on 14 Aug the whole repo
had to be replaced, because names leaked into places nobody was checking. Both were
avoidable. The checks below exist so it does not happen a third time.*

## Commit messages are public — no personal data

Anyone can read commit messages without the password, and Actions run titles republish
them. Run records and titles **never expire**, and a force-push does not remove the old
commits — GitHub keeps serving them by SHA indefinitely. There is no clean way back.

- Every commit message is **one neutral line** describing the mechanical change —
  "Update site data payload", "Update checks and tooling". No person names, no dates of
  life, no places, no quotes, no narrative. One line: no body, ever.
- This applies on **every** push route: GitHub Desktop, `mcp__GitHub__push_files`, and the
  web upload page all compose messages. The API route bypasses the local test — on that
  route the rule is the only guard.
- The narrative goes in `CHANGE-LOG-COMMITS.md` (gitignored) — append an entry in the same
  session, in the same shape: date, files touched, the full story. That file is the real
  changelog; write it as fully as you like.
- `tests/run.js` §13 fails if an unpushed commit message contains a name from the payload,
  and §14 fails if any tracked file does. Both print the offending words locally and only
  counts in CI, because CI logs are public.

## Run this first, every session
```
node tools/doctor.js                 # local state: stale data.json, git locks, unpushed commits
```
Exits 1 on a blocker. It reports only **local** state — it deliberately does not check the
live site (the `verify-deploy` workflow does) or whether the data is correct (`tests/` and
`checks/` do). A green doctor means nothing is silently broken underneath you; it does not
mean safe to deploy.

## Standard edit loop
```
node tools/crypt.js decrypt          # → data.json   (NEVER pass --newsalt: it locks out family devices)
node <script that mutates data.json>
node tools/crypt.js encrypt          # → index.html
node tests/run.js                    # must be all-green before deploy
```

**`encrypt` will refuse if `data.json` did not come from the `index.html` now on disk.**
`decrypt` records a fingerprint of the payload it read into `.data-stamp` (gitignored);
`encrypt` checks it. That refusal is not in your way — it means the working copy is stale
and encrypting would silently revert whatever landed in `index.html` since. **Do not reach
for `--force` to get past it.** Back up `data.json`, run `decrypt` again, re-apply the edit.
*This exists because on 15 Aug 2026 the `data.json` in this repo was a week and 1.4 MB
behind the payload, and nothing detected it — the suites check the shape of the data, not
whether it is the current data, so every test would have passed on top of a silent revert.*
Deploy = GitHub Desktop: Fetch → commit → Ctrl+P push. Verify with the GitHub MCP `list_commits`.

### Deploying is not done when the push succeeds
The **`verify-deploy` workflow** now proves this automatically on every push to `main`: it polls
the live site for up to ten minutes and fails if the served payload's `ENC.iv` never matches the
committed one. It prints only IVs and byte counts — Actions logs are public. On failure, read its
output before touching anything; it distinguishes "GitHub's runners" from "our file" and tells you
to re-run first. **Check that run before assuming a deploy landed.** Two mount facts it exists to
survive: this sandbox has no push credentials (pushing happens in GitHub Desktop), and it cannot
unlink, so `.git/*.lock` files accumulate and block every git write until cleared.

A green `list_commits` only proves the commit reached `main`. **Always verify the live site actually changed.** Fetch `https://cnitschelm.github.io/family-tree/` and compare `index.html`'s byte length and payload head against the local file. Three commits once sat undeployed for a day while the site quietly served an old payload and every local check was green.

**If the site is behind, do NOT rewrite, recompress or re-encrypt anything.** Read the failure first:

| Symptom in the pages run | Meaning | Fix |
|---|---|---|
| `deploy`: "The job was not acquired by Runner of type hosted", "Internal server error" | GitHub's runners, not our file | **Actions → open the pages run → Re-run jobs → Re-run all jobs.** Takes ~40s. |
| Run status `Cancelled`, "a higher priority waiting request … exists" | queue confusion during an incident | same re-run |
| `build` step itself slow then `Timeout reached, aborting!` | genuinely too big | then, and only then, look at payload size |

Check https://www.githubstatus.com/api/v2/summary.json **before** theorising. On 6 Aug 2026 I blamed file size and recompressed 62 images; the build was never the problem — the deploy runner was, and a re-run fixed it in forty seconds.

## Data shape (inside the payload)
- Node: `{name, years, note, note_fr, src[], profile{}, unions[{s, sy, n, n_fr, c[]}], g:"m"|"f", img}`
- Card source: `{l, u?, q?}` — `q` is a **verbatim** family quote; labels for family records must be specific: `"Email to Cory from <name>, <D Mon YYYY>"`.
- Profile: `{headline, headline_fr, bio[], bio_fr[], sources[{label,label_fr,url}], docs[{img,u,cap,cap_fr,tr,tr_fr}]}`
- `docs[].img` is a base64 data-URI; every doc needs a **bilingual caption and transcription**.
- Provenance tags: `_n26` (added 2026 from family messages), `_g26` (grafted register chain). Test asserts their counts.
- `_legacy` block stores original-site values so `?legacy=1` can revert the tree exactly. Any correction to a pre-2026 person needs a matching `_legacy.vals` entry keyed `"years|name"`.

## Content conventions
- **Tooltips = one sentence.** A quick factoid only; everything else belongs in the bio. Sources never appear in tooltips.
- Everything user-visible is **bilingual (en/fr)** — notes, captions, transcriptions, profile labels. Tests enforce parity.
- Genogram convention: circular avatar = woman (`g:"f"`), rounded square = man (`g:"m"`).
- Cite the **exact document and view**, not a search page (e.g. `.../ark:/46858/<register>/<media-uuid>`).
- Disclose conflicts rather than silently picking a value; a documented negative ("this cannot be verified, here's why") is a legitimate result.

## Useful technique notes
- **Archives d'Alsace (archives68/67):** every media has a direct full-res JPEG at `https://archives68.alsace.eu/images/<media-uuid>.jpg`. Don't fight the canvas viewer — draw into a `<canvas>` harness with `ctx.drawImage(img, sx,sy,sw,sh, 0,0,cw,ch)` and screenshot that. Harvest uuids by driving the "Média" input and reading `location.href`, or by scraping the thumbnail rail's DOM attributes. Fetch the catalogue page first (`Caractéristiques physiques` / `Présentation du contenu`) to learn what a register actually covers.
- Bot-blocked to WebFetch (FindAGrave, Wikimedia Commons, WikiTree, archives68): use the Claude-in-Chrome tools instead.
- Pre-1682 Protestant Alsace uses the **Julian** calendar — check weekday claims against it.
- Kurrent traps: K≈R, N≈M/H, C≈L, H has an S-like swirl.
