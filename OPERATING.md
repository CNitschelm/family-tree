# How this project runs

Rewritten 24 September 2026. **Start here, every session.** It replaces the 8 August version (four
roles, fact sheets, `patch.js`), which is kept in the private history folder. Everything below is
enforced by a tool unless it says otherwise; where a rule is only written down, it says so.

---

## The research rule (2 Oct 2026)

Read the Research view's data before investigating (`node tools/research.js status`), and in the same
session record every change of research state with `tools/research.js`, then commit
`media/research.bin` and `media/research-cards.bin`. Cory never has to ask. CLAUDE.md, "Research", has
the details; `change.js`, the gate and the commit hook enforce it.

## The one rule

**Every change to what the site says goes through one door — `tools/change.js` — with its reason and
its evidence, and nothing is committed until `checks/gate.js` proves the payload is exactly what the
ledger says it is.**

## Why it is built this way

From 3 Aug to 24 Sep 2026 the payload's own history shows facts written, struck and put back:

| what happened | how |
|---|---|
| 20 pin grades went `doc` → `inf` → `doc` (8 Aug → 7 Sep; again on 11–12 Sep) | a pass downgraded pins on what the card showed, saying a source "does not give" something it gives; the next pass opened the source and restored them |
| a week of findings silently undone (4 Aug) | a commit was built from a stale working copy; nothing compared the payload with what had been decided |
| Cory's own decisions undone by later passes | decisions lived in prose — a dispute register, a decisions file, answer sheets — and no tool read them |
| one move date re-weighed on eight deploys | the same fact sits on six cards; each pass re-decided part of it |
| the meaning of `doc` drifted | the grade was defined in a dozen places, and they disagreed |

None of that was new evidence. Each pass re-decided from what it could see. So the tools now carry
forward what was decided, on what evidence, and what has already been tried and undone — and refuse
an edit that ignores it.

---

## The loop

```bash
bash tools/cloud-setup.sh                    # 0. clones, links, full history, decrypt (CLAUDE.md, "Run this first")
bash tools/cloud-lock.sh take "<who>" "<what>"   # one writer at a time (ledger/LOCK, pushed)
. ~/.ft-env && node tools/doctor.js          #    local state: stale data.json, git locks, queued commits
node tools/crypt.js decrypt                  #    only if data.json is not current

node tools/card.js <c042 | "Name|years" | part of a name> [--history]
                                             # 1. OPEN THE CARD: fields, sources and our copies of
                                             #    them, the register entries that bind it, its history
                                             # 2. OPEN THE SOURCE — our copy in family-tree-sources —
                                             #    and take the words you will rely on from it
                                             # 3. WRITE A CHANGE FILE (below)
node tools/change.js ledger/pending/<file>.json   # 4. applies it, or refuses and says why
node tools/crypt.js encrypt                  # 5. salt unchanged — never --newsalt, never --force
node checks/gate.js                          # 6. proves the payload is the ledger; runs the tests
                                             # 7. git commit index.html, media/ and stats.json together
                                             #    (the hook checks the gate, and refuses loose media/ files)
node tools/research.js log|set|answer …      # 8. the research state this session changed (any time;
                                             #    it rebuilds media/research*.bin — commit them too)
                                             # 9. changelog entry (family-tree-private/CHANGE-LOG-COMMITS.md)
bash tools/cloud-finish.sh "<line>" "<who>"  # 10. the state, then the site into the queue; it releases
                                             #     the lock. The airlock publishes the queue; verify it
```

The source archive is the clone of `CNitschelm/family-tree-sources` next to this folder; the working
state is the clone of `CNitschelm/family-tree-private` next to it (CLAUDE.md, "Three clones, one folder"). A
source that is not in it cannot be evidence: capture it first (a hand copy in `archive/hand/`, see
that repo's `archive/MANUAL.md`), then cite it. After a session that added a URL, run
`node checks/manifest.js`, copy `sources/urls.tsv` into the archive repo and push.

## A change file

```json
{
  "why": "one line: what this does and why",
  "edits": [
    { "card": "c042", "field": "bio[0]", "find": "moved in 1907", "replace": "moved in 1908",
      "kind": "fact",
      "evidence": [{ "src": "https://…the cited page", "quote": "came to the town in 1908", "opened": "2026-09-24" }] },
    { "card": "c042", "field": "bio_fr[0]", "find": "en 1907", "replace": "en 1908", "kind": "fact",
      "evidence": [{ "src": "https://…", "quote": "came to the town in 1908", "opened": "2026-09-24" }] },
    { "card": "c042", "field": "pl[t=arrival,k=town].c", "from": "doc", "to": "inf", "kind": "grade",
      "evidence": [{ "src": "https://…", "absent": ["arrived", "1907"], "opened": "2026-09-24" }] },
    { "card": "c042", "op": "add", "list": "src", "item": { "l": "…", "u": "https://…" }, "kind": "source" }
  ]
}
```

Every change file also says what it does to the research data: `"research": "i3 s9a"` (the
investigation, source or visit ids it moves; research.json must show them moved by the time the gate
runs) or `"research": "none: <why>"`. `change.js` refuses a file without it.

Field paths: `note` `occ` `occ_c` `mn` `name` `years` `headline` `bio[i]` `hl[i]` (add `_fr` for
French) · `src[i].l|u|q` · `sources[i].label|label_fr|url` · `docs[i].cap|tr` · `pl[i].k|t|c|y|y2|d|w|w_fr`
· `union[i].s|sy|n|n_fr`. A list item can be named by content instead of position:
`src[url=https://…].l`, `pl[t=arrival,k=town].w`. `find` must occur exactly once; `from` must be
the current value exactly — an edit never overwrites text it has not seen.

## What `change.js` refuses

| kind | what it must carry | checked how |
|---|---|---|
| `fact` — any change to what the card asserts, including removing something | evidence: `quote` from our copy of the source, or `absent` words for a "no record gives X" | the quote must be in our copy; each `absent` word must really be missing from it. An image or PDF copy needs `read` + `transcription` |
| `grade` — `pl[…].c`, `occ_c` | evidence for the new grade | as above; a grade change of any other kind is refused |
| `source` — labels, quotes, URLs | nothing extra | a new `q` must be in our copy; a label may not name a year its source does not contain |
| `wording` — rephrasing | nothing | refused if a year or number changes; a changed name or place is flagged |
| `translation` — the French of a pair | nothing | refused if a year or number changes |
| `owner` — Cory's decision | a register entry of his | nobody else can reopen his decisions |
| `structure` — adding a list item, a duplicate removed | — | a new or removed **card** needs Cory's recorded decision (for the male line, his standing yes: R-0437) |

And for every kind:
- **English and French must carry the same years** afterwards (or the edit says `"fr": "exempt: why"`).
- **The register answers back** (next section).
- **Putting back what an earlier change took out** — a grade, a year, a sentence — is refused unless
  the edit says `"reverts": "<what that change got wrong, and the evidence>"`. The payload's history
  (every published version since 16 Jul 2026, decrypted once into `ledger/history/`) is the memory.
- **A stale or hand-edited `data.json` is refused** — it must be the payload in `index.html` plus
  change sets from the ledger, nothing else.

## The register

`ledger/register.jsonl` (private) holds every settled question — 427 entries at the start, converted
from the dispute register, the decisions file, Cory's answer sheets, and the "do not re-raise" lists.

```json
{ "id": "R-0042", "status": "settled", "by": "rule", "decided": "2026-09-07",
  "cards": ["c042", "c043"], "fields": ["pin:arrival", "bio", "hl", "mn"],
  "tokens": ["1907", "1908"], "topic": "the arrival year", "ruling": "Both years are given; neither is chosen.",
  "considered": ["https://…", "https://…"], "source_doc": "AUDIT-2026-09/DISPUTE-REGISTER.md D-000", "superseded_by": "" }
```

- `status`: `owner` (Cory decided — only Cory reopens it) · `settled` (by rule or evidence) ·
  `disclosed` (both values shown on purpose; do not pick one) · `policy` (project-wide) · `open`.
- **An edit that touches an entry must cite it**: `"register": "R-0042"`, and `"effect": "consistent"`
  (keeps to the ruling) or `"reopen"` (with evidence from a source not in its `considered` list).
  An entry with `tokens` is touched when an edit adds or removes one of them (or a number in one);
  an entry without tokens, by any edit to its `fields`.
- When Cory decides something, add an `owner` entry **in the same session**, in his words.
  When a ruling changes, append the new entry and set the old one's `superseded_by`. Never edit a
  ruling in place.
- Audits and cold readers **read the register**. (The August rule that kept auditors away from it
  is retired: it is how true citations were struck.)

## Grades — the one definition

| grade | means |
|---|---|
| `doc` | a specific document that records this event was read — an act or record in the original, an official record, a contemporary newspaper notice, a certificate, a census line, or an act **number** cited from a register transcription — it is cited on the card and we hold a copy |
| `inf` | inferred: from a compiled tree, family memory, or reasoning across documents |
| `apx` | the event is documented but the point is coarse (only the region, county or town is known) or the date is approximate; the note says which |

Grades change **one pin at a time, with evidence**. There are no bulk re-grades: a rule change is a
`policy` entry in the register and applies to pins as they are next touched, unless Cory says otherwise.

## Audits

- An audit **proposes**; it never edits. A finding names the card id and field, quotes the card,
  quotes **our copy of the source** (open it — a finding about a source nobody opened is not a
  finding), and lists the register entries it checked. It comes with a draft change file.
- "The source does not say X" is written as `absent: [words]` — `change.js` checks it.
- Whoever writes a card does not audit it. *(Written rule; no tool enforces it.)*
- A false citation is serious; **a true citation wrongly struck is exactly as serious.** A documented
  negative ("no death act has been read, and here is why") is a correct result.

## One writer

`bash tools/cloud-lock.sh take "<who>" "<what>"` before editing, and before `tools/research.js` (it
rewrites site files too): it writes `ledger/LOCK` with `tools/lock.js` and pushes it, so of two sessions the
one that pushes second is refused; once the lock is pushed it looks at the queue again and brings this
clone up to the newest published or queued site commit and rebuilds `data.json`, so the edit starts from
what other sessions did meanwhile (`cloud-finish.sh` releases the lock only after queuing). Taking it again
under the same name renews it, also with the stretch's other private changes still uncommitted (only
`ledger/LOCK` itself must be unchanged), so a stretch whose lock ran out renews it and then finishes. It refuses until `cloud-setup.sh` has finished in the session, while a rebase
or merge is unfinished, while the airlock has refused the queue (PUBLISH BLOCKED) or the queue is out of line
with public main (QUEUE CONFLICT), and when this clone holds a commit a queue rebuild dropped. Site commits
go out only under it: `cloud-finish.sh` refuses them unless `<who>` holds the lock on GitHub, under 12 hours
old. `change.js` refuses while someone else holds it. A lock older than 12 hours counts as abandoned and is
simply taken; `bash tools/cloud-lock.sh take "<who>" "<what>" --steal` takes over a younger one whose session
is gone. Two sessions in this folder at once is how a changelog entry was overwritten and how payloads went
out built from each other's stale copies.

## Privacy and commits

- **Nothing outside the ciphertext names a person** — not code, comments, tests, the plaintext layer
  or a commit message. Every tracked file is public and served by GitHub Pages. `tests/run.js` §14
  fails on a payload name in any tracked file; `.gitignore` is deny-by-default.
- **Commit messages: one neutral line**, ≤ 72 characters, no capitalised word after the first, no
  body, no trailers. The `commit-msg` hook enforces it, and refuses an `index.html` the gate has not
  passed. `mcp__GitHub__push_files` bypasses hooks: never use it for `index.html`.
- The story of every deploy goes in `CHANGE-LOG-COMMITS.md` (private), in the same session.
- Add people only as the scope rule allows (CLAUDE.md: the root's male line, proven from a document
  we hold, cites R-0437; anyone else needs Cory's word). Never pass `--newsalt` (it locks out family
  devices) or `--force` to `crypt.js`.

## Deploy and verify

Finish with `tools/cloud-finish.sh`: the site's commits go into the queue, and the airlock checks and
publishes them within about two hours (CLAUDE.md, "Deploy"). A changed tool, test or document is pushed
by an interactive session with `FT_PUBLISH=direct`, only while the queue is empty and with the writer lock
held. Before the state, it pushes the source archive's own commits (the copies a payload cites); it stops
while the archive has uncommitted changes. A green push proves nothing: compare the live page's `ENC.iv` and the SHA-256 of
`ENC.ct` with the local `index.html` (`notes/deploying.md` has the working routes and the traps). Record
the live commit at the top of `OPEN-ITEMS.md` once the airlock has published it (the next session sees
that at setup).

During long work, push the running notes in `family-tree-private/_work/` now and then:
`FT_PUBLISH=notes bash tools/cloud-finish.sh "Save research notes"` commits and pushes that folder only (and
the source archive's own commits).

`cloud-finish.sh` checks before it pushes anything. **Exit 1** (FINISH STOPPED) means nothing was pushed,
except perhaps the source archive's own commits. Put right what it names on this machine (a private file
outside family-tree-private, a link a tool replaced, uncommitted site or archive files, a message that has
a body or a capital, a payload the gate has not passed, the writer lock not held) and run it again. When
it names the site itself (other site work came in under this session's commits, a QUEUE CONFLICT, a commit
that changes a file the airlock does not publish, more commits than the airlock takes, a commit a rebuild
dropped or the airlock refused), push the notes as above, release the writer lock
(`bash tools/cloud-lock.sh release "<who>"`), and redo the site work in a new session: a payload commit
carries the whole payload, so it is never merged or rebased. **Exit 2** is a STATE SPLIT (below).
**Exit 3** (direct only): pushed, but the live site did not show it within ten minutes; read the
verify-deploy run.

## A refused queue

**PUBLISH BLOCKED** (the airlock refused a queued commit) and **QUEUE CONFLICT** (public main moved
while commits waited, so the queue no longer sits on it) stop every writing session at setup and at
`cloud-lock.sh take`. Under PUBLISH BLOCKED a finish already under way still queues, with a warning; under a
QUEUE CONFLICT it stops. Nothing is lost while they wait. Only an interactive session, with Cory there, clears them:

1. **Read what happened.** The verdict: `git fetch -q <family-tree-private> airlock-status`, then
   `git show FETCH_HEAD:status.json` (the result, the rule, the queue it checked) and `FETCH_HEAD:log.jsonl`;
   the full log is the run in family-tree-airlock's Actions. A QUEUE CONFLICT has no verdict:
   `git log --oneline origin/main...queue/site-queue` shows both sides.
2. **The airlock was wrong** (it refused a good commit): fix the rule in family-tree-airlock with a
   rehearsal case for it (`rehearse.sh`), push, and run the airlock by hand (Actions → airlock → Run
   workflow, mode `publish`, `force` on). Nothing else changes.
3. **Otherwise, rebuild the queue**, in a clone of the site with the queue fetched
   (`git fetch <family-tree-private> +refs/heads/site-queue:refs/remotes/queue/site-queue`). `B` is the
   last commit to keep: the one under the refused commit, or public main.
   - *Only a message is wrong*: the same trees under new messages:
     `n=B; for c in $(git rev-list --reverse B..queue/site-queue); do n=$(git commit-tree "$c^{tree}" -p "$n" -m "<its line, fixed where it was wrong>"); done`.
   - *Public main moved* (QUEUE CONFLICT) without touching the queue's files:
     `git rebase --onto origin/main $(git merge-base origin/main queue/site-queue) queue/site-queue`, then
     `node tools/crypt.js decrypt` (data.json from the rebased page; never encrypt here), the gate and
     `tests/run.js` on the result. If the rebase meets a conflict, `git rebase --abort` and take the next way.
   - *A commit is wrong* (a file the airlock does not publish, a payload that does not open, a failing
     test): the new head is `B`. The change sets of the dropped commits are redone afterwards through the
     change loop, without the wrong part (a tool, test or document change goes out with `FT_PUBLISH=direct`
     once the queue is empty).

   Then, in family-tree-private, FIRST: write the new head into `.public-head`, and add to
   `.dropped-site-commits` every commit of the old queue the new one does not hold
   (`git rev-list <the new head>..<the old queue head>`, one per line), so no clone that still has one can
   queue it again; commit and push that ("Rebuild the site queue"). Only THEN move the queue:
   `git push --force-with-lease=refs/heads/site-queue:<the old queue head> <family-tree-private>
   <the new head>:refs/heads/site-queue`. Do the two pushes back to back: setup looks twice, 20 seconds apart,
   before it reports a STATE SPLIT. Every other session open meanwhile starts afresh.
4. **Check it**: run the airlock by hand, mode `check`; its verdict must be `checked`. The scheduled runs
   then publish it, and routines start again by themselves.

## State split

**STATE SPLIT**: family-tree-private's `.public-head` names a site commit that neither public main nor
the queue holds. A session pushed its state (step 4 of `cloud-finish.sh`) but its site commits never
reached the queue. Setup stops every session, read-only ones included, because the state describes
changes the site does not have.

1. **The machine that made it is still there** (`cloud-finish.sh` just stopped with exit 2): run the
   command it printed, `git -C <site clone> push <family-tree-private> HEAD:refs/heads/site-queue`. Once it
   goes through, nothing else is needed (release the writer lock if that session held it).
2. **Otherwise those site commits are lost.** An interactive session, with Cory there, puts the state back
   to what it was before that finish:
   ```bash
   git clone -q https://github.com/CNitschelm/family-tree-private /tmp/p && cd /tmp/p
   c=$(git log -1 --format=%H -- .public-head)     # the finish that recorded the lost commit
   git show --stat "$c"                              # what else it recorded
   git revert --no-edit "$c"
   printf 'free\n' > ledger/LOCK && git commit -qm "Release the writer lock" -- ledger/LOCK   # if it still names that session
   git push origin HEAD:main
   ```
   Before the revert, copy out what in that commit stays true without the lost site change (running notes
   in `_work/`, a research log entry for a page that was read) and add it back after it. The work the
   lost commits held is then redone: a decision card goes back to its run (`chosen`, with `paused`).

## Where things live

| | what | public? |
|---|---|---|
| `index.html` | the site: encrypted payload + app | yes |
| `stats.json` | the headline numbers (counts and a date only) the project page on corynitschelm.com reads; rewritten by encrypt, `research.js build` and `linkconf.js build`, checked by the gate (§7) and tests/run.js; the commit hook refuses an index.html or media/ commit that leaves it behind | yes |
| `media/` | what the cards don't show, encrypted (`tools/payload.js`): one file of bios, notes, sources and places, and one per bio picture; committed with `index.html` (encrypt moves files no longer used to `_to_delete/`) | yes |
| `media/research.bin`, `media/research-cards.bin` | the Research view's data and the cards' badges, sealed by `tools/research.js` under the payload key; stable names | yes |
| `media/history.bin` | the history notes on the map's Play timeline, sealed by `tools/history.js build` under the payload key from `history.json`; a stable name, fetched on the first Play | yes |
| `map/<hash>.json` | the map's base layers (public geography, no family data), fetched on the first Map open; `tools/mapfile.js` | yes |
| `tools/` `checks/` `tests/` `githooks/` | the tools above; `tests/run.js` (site), `tests/ledger.js` (this loop), `tests/research.js` (the research tools, the hook's research check, crypt.js's keep rule), `tests/browser.js` (load on open, in Chromium) | yes |
| `research.json`, `.research-stamp`, `ledger/research-deny.txt` | the research state (the one source of the Research view), what `research.js build` last wrote, and names never to publish | no (family-tree-private; `.research-stamp` is rebuilt) |
| `history.json` | Play's history notes: each with the page it was read on and the words that support it (only the captions, years and source go into media/history.bin) | no (family-tree-private) |
| `data.json`, `.password`, `.data-stamp`, `.gate-stamp` | working copy, password, provenance stamps | no (rebuilt each session; the password is the environment variable `FT_PASSWORD`) |
| `ledger/` | `register.jsonl` (settled questions), `changes.jsonl` (every applied change), `pending/` (change files), `history/` (payload history cache), `LOCK` | no (family-tree-private) |
| `OPEN-ITEMS.md` | the live commit and what is genuinely open — short | no (family-tree-private) |
| `CHANGE-LOG-COMMITS.md`, `bio-research-notes.md` | the story of each deploy; the research log | no (family-tree-private) |
| `AUDIT-2026-09/`, `history/` | the records the register was built from; older reports | no (family-tree-archive; `history/` in family-tree-private) |
| `notes/` | project memory (mirror of the memory store) | no (family-tree-private) |
| `../family-tree-sources` | the source archive (private repo) | no |
| `../family-tree-private` | the working state above (private repo): `.private-paths` lists what `tools/cloud-setup.sh` links into this folder, `.public-head` the site commit the state goes with; its branch `site-queue` holds site commits waiting for the airlock, and `airlock-status` the airlock's verdicts | no |

## Tools

| tool | does |
|---|---|
| `tools/card.js` | open a card: fields, sources + archive copies, register, ledger, `--history` |
| `tools/change.js` | apply a change file, or refuse it |
| `checks/gate.js` | before every commit: payload = ledger, evidence still holds, tests, no new HIGH lint |
| `tools/lock.js` | one writer at a time |
| `tools/crypt.js` | decrypt / encrypt the payload |
| `tools/payload.js` | the payload format (v3: the cards in the page, the rest in `media/`), used by every tool that reads or writes it |
| `tools/doctor.js` | local state |
| `tools/cloud-setup.sh` | start of every cloud session: the three clones, full history, the private links, `~/.ft-env`, decrypt, doctor; stops on PUBLISH BLOCKED, QUEUE CONFLICT or STATE SPLIT (`FT_READONLY=1`, for report tasks: carries on from public main past the first two, and the session can push nothing) |
| `tools/cloud-lock.sh` | the writer lock, pushed (`status`, `take`, `release`) |
| `tools/cloud-finish.sh` | end of every cloud session: the state first, then the site into the queue (`FT_PUBLISH=direct`: straight to main, interactive sessions only; `FT_PUBLISH=notes`: the `_work/` notes only) |
| `tools/cloud-lib.sh` | what the three scripts above share (the queue's verdict, a safe push of the private repo, the newest site commit, the ready mark) |
| `tools/cloud-verify.sh`, `tools/cloud-nettest.sh`, `tools/cloud-selftest.sh` | one-off checks: the backup arrived and the tools work; what the network reaches; the rehearsal of the scripts above on throwaway copies |
| `tools/stats.js` | write `stats.json` (or `--check` it) from data.json, research.json and the link ratings |
| `tools/research.js` | the Research view's data: `status`, `show`, `validate`, `build`, `check`, `link`, and the update commands |
| `tools/mapfile.js` | the map's base layers: `check`, `write <layers.json>` (a new hashed file; keep the old one a deploy) |
| `checks/run.js` | prose linter (report only; the gate fails on new HIGH findings) |
| `checks/manifest.js` | regenerate `sources/urls.tsv` for the archive |
| `tests/run.js`, `tests/ledger.js`, `tests/research.js`, `tests/browser.js` | site regression suite; tests for this loop; tests for the research tools; browser checks (Playwright) |

`checks/patch.js` and `checks/dossier.js` are retired in favour of `change.js` and `card.js`.
