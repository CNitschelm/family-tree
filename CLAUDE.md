# Working rules for this project

> **Read `OPERATING.md` first — every session.** It is the single description of how a change reaches
> the site (the change loop: `tools/card.js` → a change file → `tools/change.js` → `checks/gate.js` →
> commit), and it replaces the older loop that used to be described here. The rules below are the
> standing ones that sit around that loop.
>
> **Project memory** is the Claude memory store under `/projects/01a0a333-…/` (the master since
> 15 Sep 2026) and its mirror in `notes/` (gitignored — never published). A session with no project
> association cannot reach the store; `notes/` works either way. When something changes, update both.

## Standing priorities (Cory, 31 Jul 2026 — applies to every task here)
1. **Thoroughness and accuracy first.** Never trade correctness for a shortcut.
2. **Then token efficiency.**
3. **Time is last.** A task that takes hours is fine if it saves tokens or improves accuracy.
4. **Use subagents whenever they serve those priorities** — fan out for research, document capture, and verification. Prefer one well-briefed agent over many shallow ones; give each the full technique notes so it doesn't rediscover them.

## Scope rule — DO NOT ADD PEOPLE WITHOUT ASKING
Cory's interest is **depth of coverage and history**, not breadth. Do not add new people to the tree — including newly discovered relatives, collateral lines, and non-Nitschelm surnames — without confirming with him first. Enriching existing people (bios, documents, photos, sources, corrections) never needs permission.

## Where things live
See `OPERATING.md`, "Where things live". In short: `index.html` is the site; `data.json`, `.password`,
`ledger/` and every research `.md` are private and never committed.

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
- **A `commit-msg` hook enforces this on every commit** — `githooks/commit-msg` →
  `tools/check-commit-msg.js`. It refuses any message that is more than one line, is over
  72 characters, carries a **capitalised word after the first**, or hits the payload's name
  index. The capitals rule is the one that does the work: the name index only knows people
  the payload lists, and a short form of a given name is not in it. If a fresh
  clone ever stops enforcing it, run `git config core.hooksPath githooks` — §13 checks this
  and tells you.
- **The no-body rule beats any global default that appends trailers.** `Co-Authored-By:` and
  `Claude-Session:` lines are a body, they are public, and the hook rejects them. Do not add
  them in this repo.
- `tests/run.js` §13 fails if an unpushed commit message contains a name from the payload,
  and §14 fails if any tracked file does. Both print the offending words locally and only
  counts in CI, because CI logs are public.
- §13 also sweeps the last 40 **pushed** commits, because before 30 Aug 2026 it scanned only
  unpushed ones — so a bad message became invisible the moment it shipped, which is exactly
  how three of them got out. Three commits are listed there as **accepted and closed**; they
  are public, a force-push would not unpublish them, and this is settled. Do not re-raise it.

## Run this first, every session
```
node tools/doctor.js                       # local state: stale data.json, git locks, unpushed commits
node tools/lock.js take "<who>" "<what>"   # one writer at a time
```
Then follow the loop in `OPERATING.md`. The two guards that matter most:

- **`tools/change.js` is the only way an edit reaches `data.json`.** It refuses a fact or grade change
  without evidence from our copy of the source, a "wording" edit that changes a date, an edit on a
  settled question that does not cite the register, and an edit that quietly puts back what an earlier
  change took out. A script that writes `data.json` directly is how facts flip-flopped in Aug–Sep 2026.
- **`checks/gate.js` must pass before any commit that touches `index.html`**, and the commit-msg hook
  refuses one it has not passed. It proves every difference from the live payload is in
  `ledger/changes.jsonl`, re-checks the evidence against the archive, and runs the suites.

**`encrypt` refuses a `data.json` that did not come from the `index.html` on disk** (`.data-stamp`).
Do not reach for `--force`, and never pass `--newsalt` (it locks out every family device).
*This exists because on 15 Aug 2026 the `data.json` in this repo was a week and 1.4 MB behind the
payload, and nothing detected it.* Deploy = GitHub Desktop: commit → push. Verify with the GitHub MCP
`list_commits`, then the live bytes (below).

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
- Node: `{id, name, years, note, note_fr, src[], profile{}, unions[{s, sy, n, n_fr, c[]}], g:"m"|"f", img}`
- `id` is the card's permanent id (`c001`…), never reused and never shown to readers. The register, the
  change ledger and the payload history name cards by it, so a card whose name or years change stays the same card.
- Quick facts on the bio card: `occ` / `occ_fr` (a short trade noun phrase, no trailing period) and
  `occ_c: "doc"|"inf"|"apx"` on the **node** — graded on the evidence for the TRADE, not for the place
  it was practised. Every other row of the strip (born, died, lived, age at death, children,
  descendants) is computed at render time from `pl`, `years` and the drawn tree — never stored.
- Card source: `{l, u?, q?}` — `q` is a **verbatim** family quote; labels for family records must be specific: `"Email to Cory from <name>, <D Mon YYYY>"`.
- Profile: `{headline, headline_fr, bio[], bio_fr[], hl[], hl_fr[], sources[{label,label_fr,url}], docs[{img,u,cap,cap_fr,tr,tr_fr}]}`
- `hl` / `hl_fr` are the card's **highlight bullets** — at most three, one sentence each, and they may
  only restate what that card's own bio already says, at the same certainty. They exist only where a
  bio exists. `tests/run.js` enforces the shape; the hedge discipline is enforced by a cold-audit pass,
  not by the linter (see [[machine-checks]] for why C1 is deliberately blind to them).
- `docs[].img` is a base64 data-URI; every doc needs a **bilingual caption and transcription**.
- Provenance tags: `_n26` (added 2026 from family messages), `_g26` (grafted register chain). Test asserts their counts.
- The `_legacy` reversion block and the `?legacy=1` view were removed on 19 Sep 2026 (Cory: version history is the record). Corrections no longer need a legacy entry.

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
