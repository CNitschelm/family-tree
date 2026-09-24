# How this project runs

Rewritten 24 September 2026. **Start here, every session.** It replaces the 8 August version (four
roles, fact sheets, `patch.js`), which is kept in the private history folder. Everything below is
enforced by a tool unless it says otherwise; where a rule is only written down, it says so.

---

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
node tools/doctor.js                         # 0. local state: stale data.json, git locks
node tools/lock.js take "<who>" "<what>"     #    one writer at a time (ledger/LOCK)
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
                                             # 7. commit in GitHub Desktop (the hook checks the gate)
                                             # 8. push; verify the live iv; changelog entry
node tools/lock.js release "<who>"
```

The source archive is the clone of `CNitschelm/family-tree-sources` **next to this folder**. A
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
| `structure` — adding a list item, a duplicate removed | — | a new or removed **card** needs Cory's recorded decision |

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

`node tools/lock.js take "<who>"` before editing; `change.js` refuses while someone else holds it (a
lock older than 12 hours counts as abandoned; `--steal` takes it over). Two sessions in this folder
at once is how a changelog entry was overwritten and how payloads went out built from each other's
stale copies.

## Privacy and commits

- **Nothing outside the ciphertext names a person** — not code, comments, tests, the plaintext layer
  or a commit message. Every tracked file is public and served by GitHub Pages. `tests/run.js` §14
  fails on a payload name in any tracked file; `.gitignore` is deny-by-default.
- **Commit messages: one neutral line**, ≤ 72 characters, no capitalised word after the first, no
  body, no trailers. The `commit-msg` hook enforces it, and refuses an `index.html` the gate has not
  passed. `mcp__GitHub__push_files` bypasses hooks: never use it for `index.html`.
- The story of every deploy goes in `CHANGE-LOG-COMMITS.md` (private), in the same session.
- Never add a person without asking. Never pass `--newsalt` (it locks out family devices) or
  `--force` to `crypt.js`.

## Deploy and verify

Push from GitHub Desktop. A green push proves nothing: compare the live page's `ENC.iv` and the
SHA-256 of `ENC.ct` with the local `index.html` (`notes/deploying.md` has the working routes and the
traps). Record the live commit at the top of `OPEN-ITEMS.md`.

## Where things live

| | what | public? |
|---|---|---|
| `index.html` | the site: encrypted payload + app | yes |
| `tools/` `checks/` `tests/` `githooks/` | the tools above; `tests/run.js` (site) and `tests/ledger.js` (this loop) | yes |
| `data.json`, `.password`, `.data-stamp`, `.gate-stamp` | working copy, password, provenance stamps | no |
| `ledger/` | `register.jsonl` (settled questions), `changes.jsonl` (every applied change), `pending/` (change files), `history/` (payload history cache), `LOCK` | no |
| `OPEN-ITEMS.md` | the live commit and what is genuinely open — short | no |
| `CHANGE-LOG-COMMITS.md`, `bio-research-notes.md` | the story of each deploy; the research log | no |
| `AUDIT-2026-09/`, `history/` | the records the register was built from; older reports | no |
| `notes/` | project memory (mirror of the memory store) | no |
| `../family-tree-sources` | the source archive (private repo) | no |

## Tools

| tool | does |
|---|---|
| `tools/card.js` | open a card: fields, sources + archive copies, register, ledger, `--history` |
| `tools/change.js` | apply a change file, or refuse it |
| `checks/gate.js` | before every commit: payload = ledger, evidence still holds, tests, no new HIGH lint |
| `tools/lock.js` | one writer at a time |
| `tools/crypt.js` | decrypt / encrypt the payload |
| `tools/doctor.js` | local state |
| `checks/run.js` | prose linter (report only; the gate fails on new HIGH findings) |
| `checks/manifest.js` | regenerate `sources/urls.tsv` for the archive |
| `tests/run.js`, `tests/ledger.js` | site regression suite; tests for this loop |

`checks/patch.js` and `checks/dossier.js` are retired in favour of `change.js` and `card.js`.
