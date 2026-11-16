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

Since 16 Nov 2026 the research tools also hold to these (register R-0759 for the copies and the page lists):

- **`research.js` writes only under the writer lock.** Every command that writes (`set`, `log`, `answer`,
  `state`, `inv`, `add-source`, `add-question`, `add-inv`, `decide`, `copy`, `build`, `link --write`) is
  refused unless the lock is held, under 12 hours old, by the name in `FT_WHO`
  (`bash tools/cloud-lock.sh take "<who>" "<what>"` sets it; in a shell opened before that, run
  `. ~/.ft-env` first). It is refused in a read-only session (`FT_READONLY=1`) too. `status`, `show`,
  `validate`, `check` and `link` only read and need no lock.
- **A source is closed only with its copy on record.** Before a source is set to `found`, `none` or
  `done` (the states that say it was consulted), say where our copy of what was read is, "nothing found"
  included:
  `node tools/research.js copy <source> <archive path> [<archive path> …]`, or, when there is truly
  nothing to keep, `node tools/research.js copy <source> "none: <why>"` (a reason of 12 characters or
  more: what was read, and why nothing could be kept). Without one, `set` refuses and writes nothing.
  **What counts as a copy:** a path inside the source archive that is there when it is recorded, either a
  file or the folder of one item: `archive/hand/<file>`, `archive/hand/<folder>`,
  `archive/store/<site>/<item>`, `archive/family/<folder>`. Not the archive itself, not a whole top
  folder (`archive/hand`, `archive/store/<site>`), not one of the archive's own files, not a path
  outside `archive/`. So file the copy in the archive first. `copy` adds to the source's list
  (`--replace` starts it again); `set` does not take the field; a source that arrives as JSON already
  consulted carries `"_copy"`. The record is private and never reaches the family's copy. Sources closed
  before the rule are only counted, by `validate` and `status`; record the copy when one is read again.
- **`show <investigation>` prints each source's newest 3 log entries**, with a line that says how many
  came before: add `--log all` (or `--log <n>`) for more. A source or a visit list is shown in full.
- **Log entries are for the family.** One over 600 characters, or one that names a decision card or item
  (`go12`, `yc34`, `rq5`), is accepted with a NOTE: say what was done, and put the detail in the run notes.
- **A register read page by page gets a page list: `tools/pages.js`.** It keeps one table for each
  register, in the source archive (`archive/coverage/<key>.tsv`, only ever added to), that says for
  every page read: when, by which run, and what it held. Record the pages as they are read, the empty
  ones too, so no page is read twice and a "nothing found" can be checked.
  ```bash
  node tools/pages.js add <register address> <page | a-b | a,b,c-d> <result> --who <text>
                          [--what "<register title>"] [--note "<text>"] [--date YYYY-MM-DD]
                          [--id <the page's own id>] [--pages <how many pages the register has>] [--new]
  node tools/pages.js show <register address>      # what was read, by result; what never was
  node tools/pages.js unread <register address> [--list [--limit <n>|all]]   # the pages still to read
  node tools/pages.js list                         # every register that has a page list
  node tools/pages.js import-list <register address> <tsv> [--what "<register title>"]
                                                   # the register's length and page ids, from a list with
                                                   # one page a line (number, id, address); marks nothing read
  ```
  - `<result>` is `finding` (say what in `--note`), `nothing` (read in full, nothing for us), `"not read"`
    or `unreadable`. The last two are not a negative: `unread` counts those pages as still to read, and
    names the unreadable ones on a line of their own (in `--list`, in a fourth column).
  - A range is written `41-45`, with a plain hyphen, and a list `3,7,40-51`. Numbers joined by words
    ("41 to 45") are refused.
  - Give **the register's address**, not a page's. Under an ark a page's address is taken as its
    register (the page's own id, `/dao/0/<n>`, `/daogrp/0/<n>`, `/f<n>.item`, anything after `?` or `#`).
    Any other address that goes on from a register with a list is refused, with the two ways out: the
    register's address, or `--new` when the address is a register of its own.
  - `--who` is the run or the card that read it; never a person's name *(written rule)*. Give the title once (`--what`)
    and the length once (`--pages`, or `import-list`): without the length the pages never opened cannot
    be listed.
  - It needs no lock, writes only inside `archive/coverage/`, refuses in a read-only session, and never
    commits. Before finishing, commit the folder in the archive, its `.gitattributes` included (it lets
    git keep both sides' rows when two sessions add to one list):
    `(cd <family-tree-sources> && git add archive/coverage && git commit -m "Add page lists")`.
    `cloud-finish.sh` stops while the archive has uncommitted files.

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
                                             #    them (each "held as": an image, page text, or a
                                             #    typed reading only), the register entries that
                                             #    bind it, its history
                                             # 2. OPEN THE SOURCE — our copy in family-tree-sources —
                                             #    and take the words you will rely on from it
                                             # 3. WRITE A CHANGE FILE (below)
node tools/change.js ledger/pending/<file>.json   # 4. applies it, or refuses and says why. It writes only
                                             #    under the writer lock; with --dry it checks the
                                             #    file, writes nothing and needs no lock
node tools/crypt.js encrypt                  # 5. salt unchanged — never --newsalt, never --force
node checks/gate.js                          # 6. proves the payload is the ledger; runs the tests;
                                             #    prints the warnings change.js kept: read each one
                                             # 7. git commit index.html, media/ and stats.json together
                                             #    (the hook checks the gate's stamp, and refuses loose
                                             #    media/ files)
node tools/research.js log|set|answer|copy … # 8. the research state this session changed (any time;
                                             #    it rebuilds media/research*.bin — commit them too)
                                             # 9. changelog entry (family-tree-private/CHANGE-LOG-COMMITS.md)
bash tools/cloud-finish.sh "<line>" "<who>"  # 10. the line figures (below), the state, then the site into
                                             #     the queue; it releases the lock. The airlock publishes
                                             #     the queue; verify it
```

**The line figures keep themselves current (9 Nov 2026).** The % on each parent-child line comes from
`ledger/link-confidence.json` (private) through `tools/linkconf.js build`, which refuses until every link on
the tree is rated. Nothing ran it by itself, so from 7 Oct to 9 Nov 2026 the figures froze while cards came
onto the tree. Now `cloud-finish.sh` (step 2b, after the site is committed) runs `node tools/linkconf.js
sync` whenever `.owner-key` is here: when the ledger or the tree's links changed since the last build (a
hash, `ledger/link-confidence.stamp`) it moves entries whose link left the tree to the file's `retired` list,
rates each new link from its child card's own sources (an act read in the original: 99; a SaiRePa or Baradel
transcription with an act number: 95; those entries carry `auto: true`), rebuilds `media/owner.bin` and
`media/links.bin`, and commits them with `stats.json` ("Update link figures"); the ledger goes with the state.
Nothing changed: nothing is rebuilt (owner.bin would get a new random iv). A link it cannot rate stops the
finish: **FINISH STOPPED: "<n> lines have no figure: <ids>"**. Rate each by hand in the ledger (its
`scale_pct`; `notes/link_confidence.md`) and finish again. Without `.owner-key` (no `FT_OWNER_KEY`) it is
skipped with a NOTE: never let a tool make a new owner key.

The source archive is the clone of `CNitschelm/family-tree-sources` next to this folder; the working
state is the clone of `CNitschelm/family-tree-private` next to it (CLAUDE.md, "Three clones, one folder").
Both are private and must be attached to the session, with push access. When one is not, setup stops
(SETUP STOPPED: could not clone …) with git's own words and what to do: in an interactive session, ask for
the repository with the platform's add-repository tool (Cory approves it), or have him start a session with
all three selected; a routine gets it on its own page, where he adds it. A
source that is not in the archive cannot be evidence: capture it first (a hand copy in `archive/hand/`, see
that repo's `archive/MANUAL.md`), then cite it. A fact read from an image of a record needs the image
itself there, not only our typed reading of it (below, "An image on file"). The archive's list of cited
addresses, `sources/urls.tsv`, keeps itself current: the full finish rebuilds it with
`node checks/manifest.js` and commits it in the archive when it changed ("Deploy and verify").

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
· `union[i].s|sy|n|n_fr` · `img` `imgL` (a card's photo) · `gaz.<key>` (one gazetteer entry, on the root
card). A list item can be named by content instead of position:
`src[url=https://…].l`, `pl[t=arrival,k=town].w`. `find` must occur exactly once; `from` must be
the current value exactly — an edit never overwrites text it has not seen.

**Evidence.** Each item is `{ "src", "quote" }` (words that are in our copy of the source),
`{ "src", "absent": ["word", …] }` (words our copy lacks) or `{ "src", "read", "transcription" }` (what
the page says, in its words, for a copy with no text layer), and always `"opened"`: the day the source
was really opened, as `"YYYY-MM-DD"`, not later than today. `"src"` is the cited address, or
`family:<folder>` for a family paper we hold. A quote must hold a letter or a digit, and `absent` is a
list of real words.

`"read"` says what was read. The words it may be: `"image"`, `"pdf"` or `"original"` for a picture of the
record; `"text"` or `"index entry"` for words on a page. Any other word is taken as a picture, with a
warning that names these five.

**An image on file (16 Nov 2026, register R-0755).** A typed reading alone is not our copy of a record
image. Evidence counts as read from an image when its `"read"` is not `"text"` or `"index entry"`, when
its address is itself a picture of a record (a register page in an archive's viewer, a film image, a
newspaper page), when our hand copy says it was read from an image, or when it is a `"read"` of a copy
that has no words in it (a viewer's empty page). The archive must then hold an image of that source (a
picture or a PDF): in the source's store folder, beside its hand copy, under its dated copy's name, in a
row of `archive/hand/README.md`, or in the family paper's folder. A saved `.html` is never an image.
Where there is none, `change.js` refuses and says where to file it: `archive/hand/<id>.jpg` with its
README row, or `node archive/file.mjs <the image file> --url "<the address>"`, then the archive's
`node checks/verify.js` (the refusal gives the exact commands; that repo's `archive/MANUAL.md`, "The
image", has the rest). Where the image cannot be had now (a sign-in, a site that refuses downloads),
the evidence item says `"no_image": "<why, and what will fetch it>"`, in 20 characters or more. The edit
then applies, the ledger marks it `image_missing` with the reason, `change.js` prints a REMINDER, and the
gate counts and lists every such edit on each run. File the image as soon as it can be had (a step that
needs Cory's hands goes on his "At your computer" list).

**A new card.**

```json
{ "op": "addCard", "parent": "c042", "union": 0, "at": 1,
  "item": { "name": "…", "years": "…", "g": "m", "note": "…", "note_fr": "…", "src": [ … ] },
  "kind": "structure", "register": "R-0437",
  "evidence": [{ "src": "https://…", "quote": "…", "opened": "2026-11-16" }] }
```

- **Evidence**: the record that proves this child of the parent, checked as a fact's. Cory's words
  (`"src": "owner"`) are not evidence for a card: his word is the register entry.
- **A live owner entry about that place on the tree**: `"register"` names an entry with status `owner`
  that has not been replaced. R-0437 is his standing yes for a child of a man of the line; it is refused
  when the parent is a daughter or below one. Any other entry must list the parent in its `cards` (or
  the parent is a card this same change file adds under that entry).
- **No `id` and no children in `"item"`**: the tool assigns the id, in order, never reused; each child
  is its own `addCard`. `"at"` is the card's place among its brothers and sisters. The sources on the new
  card must be in the archive, and their quotes in our copies.
- A card comes off with `{ "op": "removeCard", "card": "c123", "kind": "structure", "register": "R-…" }`:
  an owner entry in force that lists that card.

## What `change.js` refuses

| kind | what it must carry | checked how |
|---|---|---|
| `fact` — any change to what the card asserts, including removing something, and any new pin, marriage, bio paragraph, highlight or document | evidence: `quote` from our copy of the source, or `absent` words for a "no record gives X" | the quote must be in our copy; each `absent` word must really be missing from it. An image or PDF copy needs `read` + `transcription`. A fact read from an image needs the image on file, or `no_image` with its reason (above) |
| `grade` — `pl[…].c`, `occ_c` | evidence for the new grade | as above; a grade change of any other kind is refused |
| `source` — `src[…]` and `sources[…]` only: labels, quotes, addresses, a source added or taken out | nothing extra to add or edit one; evidence to take one out | on any other field it is refused. A new `q` must be in our copy; a label may not name a year its source does not contain; a new or changed address must be in the archive |
| `wording` — rephrasing | nothing | refused if a year or number changes, and on a name, a spouse's name, the place a pin stands on, the person's sex (`g`) or `years` (a dash or a space set right in `years` is still wording); a changed capitalised word is flagged |
| `translation` — the French of a pair | nothing | as `wording`; refused on an English field |
| `owner` — Cory's decision | a register entry of his, in force (not replaced), that lists the card | nobody else can reopen his decisions |
| `structure` — a card added or removed, a gazetteer entry (`gaz.<key>`), an exact duplicate removed | a card: Cory's recorded decision (for the male line, his standing yes: R-0437), and for a new card its evidence ("A new card", above). A duplicate: `"dup_of"`, the index of the identical item that stays | on any other field it is refused; a removal that is not an exact duplicate is a fact |

Each kind keeps to its own fields (16 Nov 2026, register R-0760). **A new pin, marriage, bio paragraph,
highlight or document is a fact, whatever the edit is called**: under `source` it is refused; under
`wording`, `translation` or `structure` it is refused without evidence, and with evidence it is checked
as a fact and applied with a warning that is kept; under `owner` it cites his entry about the card. A
source added under another kind is checked as a source, with a kept warning.

And for every kind:
- **Writing needs the writer lock in hand.** `change.js` writes only while `ledger/LOCK` names this
  session (`FT_WHO`, which `bash tools/cloud-lock.sh take "<who>" "<what>"` sets; in a shell opened
  before that, start the command with `. ~/.ft-env &&`). It refuses while the lock is free, held by
  another session, or over 12 hours old, and always in a read-only session (`FT_READONLY=1`). `--dry`
  writes nothing, so it needs no lock: it runs while another session holds the lock, and in a read-only
  session, and says who holds it. "Would apply cleanly" is not "applied".
- **Warnings are kept.** A warning (`note …`) never refuses an edit, so it is stored on the edit's
  record in the ledger (`warnings`), and the gate prints every one again, under "3b", on each run until
  the payload ships. Read each one; if it shows a mistake, correct it with a new change file before
  committing. The common ones: a year or number that is in none of the edit's quotes, a quote under 8
  characters standing alone, a `"read"` word the tool does not know, a `"read": "text"` transcription
  that is not in our copy word for word, a kind that did not fit.
- **No other tool edits `data.json`.** `tools/photo.js`, the last that did, is retired (16 Nov 2026,
  register R-0760) and refuses to run: a photo is a change file that sets the card's `img` and `imgL`
  (`"kind": "fact"`, with the evidence for whose picture it is).
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
- When Cory decides something, add an `owner` entry **in the same session**, in his words, and list
  in its `cards` every card it is about: an `owner` edit and a removed card must cite an entry that
  lists the card, and a new card one that lists its parent (R-0437 aside).
  When a ruling changes, append the new entry and set the old one's `superseded_by`. Never edit a
  ruling in place. An entry that has been replaced is no longer a decision in force: `change.js`
  refuses it for an `owner` edit and for a card added or removed.
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
old. `change.js` and `research.js` write only while this session holds it: the lock must name `FT_WHO`, which
`take` puts in `~/.ft-env` (a shell opened before that runs `. ~/.ft-env` first), and be under 12 hours old; in
a read-only session (`FT_READONLY=1`) they never write. A dry run of `change.js` needs no lock. A lock older
than 12 hours counts as abandoned and is
simply taken; `bash tools/cloud-lock.sh take "<who>" "<what>" --steal` takes over a younger one whose session
is gone. Always take it with `cloud-lock.sh`, never with `node tools/lock.js` alone, which neither pushes the
lock nor sets `FT_WHO`. A lock push that GitHub refuses is not tried again, and the refusal says why in git's
own words. Two sessions in this folder at once is how a changelog entry was overwritten and how payloads went
out built from each other's stale copies.

## Privacy and commits

- **Nothing outside the ciphertext names a person** — not code, comments, tests, the plaintext layer
  or a commit message. Every tracked file is public and served by GitHub Pages. `tests/run.js` §14
  fails on a name in any tracked file; `.gitignore` is deny-by-default.
- **The name check is wider since 16 Nov 2026** (register R-0761). §13 (commit messages and commit
  addresses) and §14 (tracked files, their names included) compare without accents. §14 finds a full name
  whatever stands between its words (a line break, a tag, `&nbsp;`, a hyphen), inside percent-encoding or
  an escape, and joined into one word, and it counts the shorter ways to write a person. The index holds
  the cards and spouses, the correspondents the source labels name and, where they are linked in, the
  people on the private lists. A pass is still not proof: the comment above §14 lists what the check
  cannot see (a short surname or a dead person's given name standing alone, an initial with a surname, a
  name in an image, whatever points at a person without naming one). Without the site password §13 and
  §14 do not run at all.
- **The private lists** are `ledger/research-deny.txt` (researched, never to be published),
  `TRIMMED-PEOPLE.md` (taken off the tree) and `NOT-ADDED-PEOPLE.md` (found and not added). They live in
  family-tree-private, and `cloud-setup.sh` links them into this folder (`.private-paths`), so a session
  that has set up has them: the commit guard, §13 and §14 then read them. A bare checkout and CI have
  none and check against the payload alone, so a name that is only on a list fails here and at the gate
  and passes in CI and at the airlock. `FT_PRIVATE_LISTS=<folder>` names another folder that holds them
  at the same paths.
- **`checks/source-hosts.json` is private too** (family-tree-private, linked by setup): the hosts that
  say where particular people lived, studied and worked. `checks/manifest.js` reads it, and only the
  large services every family history uses are named in the public file.
- **Commit messages: one neutral line**, ≤ 72 characters, no capitalised word after the first, no
  body, no trailers, no word that is a person's name. The `commit-msg` hook enforces it, and refuses an
  `index.html` the gate has not passed: `.gate-stamp` must hold the staged payload's iv and, on its second
  line, a PASS over `origin/main` or over the queue's head (`queue/site-queue`, when this clone has it). A
  gate run with any other `--base` does not count, so run `node checks/gate.js` with no `--base`.
  `mcp__GitHub__push_files` bypasses hooks: never use it for `index.html`. With the private lists linked, an everyday word that is also a name on a list is refused:
  use another word.
- **Commit addresses: one of two.** The author and the committer of every commit use
  `noreply@anthropic.com` (the cloud sessions' own) or a GitHub address ending in
  `@users.noreply.github.com`: an address in a commit is as public and as permanent as its message. The
  hook refuses any other (16 Nov 2026), `cloud-finish.sh` checks each commit it is about to queue, §13
  checks the unpushed commits and the last 40 pushed ones, and the airlock refuses a queue that holds one.
  Before the first commit in a clone, `git config user.email` must print one of the two. (An address
  under `.invalid` passes only in a throwaway repository with no remote on the network: the suites use
  one. Where node is not on PATH the hook's shell fallback holds the same rules, reads no private list,
  and passes nothing under `.invalid`.)
- **After a refusal.** The hook says what to do; in short:
  - *the message*: write a neutral line without the word and commit again. Nobody is taken off a list to
    let a message through.
  - *the address*: `git config user.email noreply@anthropic.com`, leave out `--author`, and commit
    again (for an amend: `git commit --amend --reset-author --no-edit`).
  - *§13 on a commit that exists*: the newest one, not yet queued, is written again
    (`git commit --amend -m "<one neutral line>"`); this session's older unqueued ones are redone as one
    (`git reset --soft <the queue's head, or origin/main>`, then one new commit); one that is already
    queued or on main is nobody's to rewrite: stop, queue nothing more, and report the line to Cory.
  - *§14*: a routine stops, commits nothing that holds the change which brought the name in, and reports
    the line to Cory. In a session with him: take the name out (a card is named by its id), or, when the
    word is not a person in that file, mark the line `ft-allow-names` and say why. Never add to `ALLOW`.
  - *a find that rests only on a private list* and is not a person (a heading, a place): take the bold
    off that phrase, or move it out of the Person column, in the list in family-tree-private.
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

**The notes checkpoint.** During long work, save the notes now and then:
`FT_PUBLISH=notes bash tools/cloud-finish.sh "Save research notes"`. It commits and pushes the private
files that do not describe the site's state: family-tree-private's `_work/` (a long task's running notes),
`notes/`, `OPEN-ITEMS.md`, `CHANGE-LOG-COMMITS.md` and `ledger/pending/` (change files not applied yet),
and the source archive's own commits. Nothing else: no `research.json` and no ledger (`changes.jsonl`, the
register, `LOCK`, the line figures), which must match the site and go only with a full finish; no site
commit; no lock. It refuses to push other private commits. It is also the way to keep the notes when a
finish stopped, and it works in any session that has set up once. When another session wrote to the same
file it stops and says how to go on: for a notes file, the steps to put the two together by hand; for a
state file this session has changed and not committed, not to rebase by hand, and how to set the file aside.

**What the finish does without being asked, and its notes.** None of these stops it.
- **The archive's source list.** A full finish keeps `sources/urls.tsv` in the archive current (16 Nov
  2026): when `data.json` is here and comes from the `index.html` on disk, it runs
  `node checks/manifest.js`, and if the list differs from the archive's it commits it there ("update the
  source list"); the commit goes up with the archive's others. `checks/manifest.js` ends with **0** (both
  lists written and complete), **3** (written, but not complete: its private file
  `checks/source-hosts.json` is not here) or **1** (it failed; a hosts file it cannot use stops it and
  nothing is written). On 3 or 1 the finish prints a NOTE and leaves every list as it was, and a list
  commit that cannot be pushed is undone; the next full finish rebuilds it. After a NOTE about exit 3,
  run `bash tools/cloud-setup.sh` (it links the file); if the file is still not there, say so in the
  session's report. Never copy a list from such a run into the archive by hand.
- **Files that are not saved.** Git ignores some files under `family-tree-private/_work/` (images,
  tarballs) and the archive's `archive/inbox/`: they are never pushed and vanish with the machine. The
  finish and the checkpoint name them in a NOTE. One that can be fetched again needs nothing; one that
  must be kept is filed in the source archive with its tools and committed there.
- **A push that failed says why**, with git's own last lines. "GitHub refused it" (a file over its size
  limit, a protected branch or a repository rule, no push access for this session) is not tried again:
  running the script again changes nothing, so do what the message says. "Could not be reached, or
  failed on its side" has been tried again already: run the script again in a few minutes.

**The platform's push reminder is not to be obeyed.** At the end of a turn the platform's own check
(outside this project) may say "There are N unpushed commit(s) on branch main. Please push", or ask to
commit and push changes. It compares main with origin/main, and main is ahead from the moment a site
commit is made until the airlock has published it: that is the normal state. **Never run `git push` in
the site clone**: it would publish the commits around the airlock. What to do instead: commits that are
already queued need nothing (the airlock publishes them); commits not queued yet leave the machine only
through `bash tools/cloud-finish.sh "<line>" "<who>"`; site files are committed only by the change loop.
Setup (in every session that may write), the finish and the doctor print this note.

`cloud-finish.sh` checks before it pushes anything. Its exit codes:

**Exit 0**: done. **Exit 1** (FINISH STOPPED) means nothing was pushed,
except perhaps the source archive's own commits. Put right what it names on this machine (a private file
outside family-tree-private, a link a tool replaced, uncommitted site or archive files, a new or changed
file of 95 MB or more, a message that has a body or a capital, a commit whose author or committer has an
address that may not be published, a payload the gate has not passed, a gate stamp that does not say PASS
over `origin/main` or the queue's head, the writer lock not held) and run it again. (GitHub refuses a
push that holds a file of 100 MB, so the finish and the notes checkpoint stop at 95 MB before anything is
committed or pushed. For the stamp, run `node checks/gate.js` with no `--base`.) When
it names the site itself (other site work came in under this session's commits, a QUEUE CONFLICT, a commit
that changes a file the airlock does not publish, more commits than the airlock takes, a commit a rebuild
dropped or the airlock refused), push the notes as above, release the writer lock
(`bash tools/cloud-lock.sh release "<who>"`), and redo the site work in a new session: a payload commit
carries the whole payload, so it is never merged or rebased. **Exit 2** is a STATE SPLIT (below); the
writer lock stays held.
**Exit 3** (direct only): pushed, but within ten minutes the live site did not serve this commit's page
(its payload iv and the page's own SHA-256, cache-busted, as verify-deploy checks); read the verify-deploy run.
**Exit 4**: everything went up, but the writer lock could not be released and is still held. The last
lines say so, with the command (`bash tools/cloud-lock.sh release "<who>"`). Until it is released, or 12
hours have passed, no other session can write; if the release is refused again, say in the session's
report that the lock is still held. (When 3 applies as well, the code is 3 and both are said.)

**The airlock, its verdict and its heartbeat.** The airlock checks every queued commit: the files it
changes, its message, its payload, the suites and, since 16 Nov 2026, the address of its author and
committer (rule `author`: only the two that may be published) and the change ledger (rule `ledger`: the
queue's data must be a state `ledger/changes.jsonl` records, and not an older one than the published
data). Its verdict on a queue is in family-tree-private's branch `airlock-status` (`status.json`,
`log.jsonl`), written only when a queue is checked. So that an airlock that has stopped does not look like
one with nothing to do, every run, the quiet ones too, also leaves a heartbeat on the branch
`airlock-heartbeat` (`heartbeat.json`: the time, and one word for what the run did):
`git fetch -q <family-tree-private> airlock-heartbeat && git show FETCH_HEAD:heartbeat.json`.
Setup and `tools/doctor.js` read the heartbeat and how long the queue has waited, and warn without stopping
(a heartbeat that cannot be read is a NOTE):
- **A heartbeat more than 8 hours old** (it is due every two hours): the airlock has stopped, or GitHub
  has skipped several runs in a row. Until it runs again nothing queued is checked or published. No
  session can start it: Cory does, by hand, from its Actions page (family-tree-airlock: Actions, airlock,
  Run workflow, mode `publish`). Say in the session's report that the airlock has stopped. The session
  may go on: its site work queues and waits.
- **Queued commits that have waited more than 4 hours**: the WARNING gives the age, what the last
  heartbeat says and where to read the verdict. The session may go on (new work queues on top); say in
  its report that the airlock is late.

## A refused queue

**PUBLISH BLOCKED** (the airlock refused a queued commit) and **QUEUE CONFLICT** (public main moved
while commits waited, so the queue no longer sits on it) stop every writing session at setup and at
`cloud-lock.sh take`. Under PUBLISH BLOCKED a finish already under way still queues, with a warning; under a
QUEUE CONFLICT it stops. Nothing is lost while they wait. Only an interactive session, with Cory there, clears them:

1. **Read what happened.** The verdict: `git fetch -q <family-tree-private> airlock-status`, then
   `git show FETCH_HEAD:status.json` (the result, the rule, the queue it checked) and `FETCH_HEAD:log.jsonl`;
   the full log is the run in family-tree-airlock's Actions. The rule `author` names the commit and
   whether its author or its committer failed, never the address; the rule `ledger` says in its detail
   what to redo. A QUEUE CONFLICT has no verdict:
   `git log --oneline origin/main...queue/site-queue` shows both sides.
2. **The airlock was wrong** (it refused a good commit): fix the rule in family-tree-airlock with a
   rehearsal case for it (`rehearse.sh`), push, and run the airlock by hand (Actions → airlock → Run
   workflow, mode `publish`, `force` on). Nothing else changes.
3. **Otherwise, rebuild the queue**, in a clone of the site with the queue fetched
   (`git fetch <family-tree-private> +refs/heads/site-queue:refs/remotes/queue/site-queue`). `B` is the
   last commit to keep: the one under the refused commit, or public main.
   - *Only a message or an address is wrong* (the rule `author` included): the same trees under new
     messages:
     `n=B; for c in $(git rev-list --reverse B..queue/site-queue); do n=$(git commit-tree "$c^{tree}" -p "$n" -m "<its line, fixed where it was wrong>"); done`.
     The new commits carry this clone's own address as author and committer, so first see that
     `git config user.email` prints one that may be published.
   - *Public main moved* (QUEUE CONFLICT) without touching the queue's files:
     `git rebase --onto origin/main $(git merge-base origin/main queue/site-queue) queue/site-queue`, then
     `node tools/crypt.js decrypt` (data.json from the rebased page; never encrypt here), the gate and
     `tests/run.js` on the result. If the rebase meets a conflict, `git rebase --abort` and take the next way.
   - *A commit is wrong* (a file the airlock does not publish, a payload that does not open, a failing
     test, or the rule `ledger`: a payload no change set on record explains, or one that goes back to an
     older state than the published data): the new head is `B`. The change sets of the dropped commits are
     redone afterwards through the change loop, from the current published or queued page, without the
     wrong part (a tool, test or document change goes out with `FT_PUBLISH=direct` once the queue is empty).

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
| `tools/` `checks/` `tests/` `githooks/` | the tools above; `tests/run.js` (site), `tests/ledger.js` (this loop), `tests/research.js` (the research tools, the hook's research check, crypt.js's keep rule), all three run by the gate and by CI; `tests/browser.js` (load on open, in Chromium) | yes |
| `research.json`, `.research-stamp`, `ledger/research-deny.txt` | the research state (the one source of the Research view), what `research.js build` last wrote, and names never to publish | no (family-tree-private; `.research-stamp` is rebuilt) |
| `TRIMMED-PEOPLE.md`, `NOT-ADDED-PEOPLE.md`, `checks/source-hosts.json` | people taken off the tree, and people found and not added (with `ledger/research-deny.txt`, the private lists the name check reads); the hosts `checks/manifest.js` keeps out of its public file | no (family-tree-private) |
| `history.json` | Play's history notes: each with the page it was read on and the words that support it (only the captions, years and source go into media/history.bin) | no (family-tree-private) |
| `data.json`, `.password`, `.data-stamp`, `.gate-stamp` | working copy, password, provenance stamps | no (rebuilt each session; the password is the environment variable `FT_PASSWORD`) |
| `ledger/` | `register.jsonl` (settled questions), `changes.jsonl` (every applied change), `pending/` (change files), `history/` (payload history cache), `LOCK`, `link-confidence.json` (the line figures' ratings, with the `retired` list) and `link-confidence.stamp` (the hash of their last build) | no (family-tree-private) |
| `OPEN-ITEMS.md` | the live commit and what is genuinely open — short | no (family-tree-private) |
| `CHANGE-LOG-COMMITS.md`, `bio-research-notes.md` | the story of each deploy; the research log | no (family-tree-private) |
| `AUDIT-2026-09/`, `history/` | the records the register was built from; older reports | no (family-tree-archive; `history/` in family-tree-private) |
| `notes/` | project memory: the master, and the one place a session updates (since 16 Nov 2026, register R-0763) | no (family-tree-private) |
| `../family-tree-sources` | the source archive (private repo); its `archive/coverage/` holds the page lists of register scans (`tools/pages.js`), its `sources/urls.tsv` the list of cited addresses | no |
| `../family-tree-private` | the working state above (private repo): `.private-paths` lists what `tools/cloud-setup.sh` links into this folder, `.public-head` the site commit the state goes with; its branch `site-queue` holds site commits waiting for the airlock, `airlock-status` the airlock's verdicts, and `airlock-heartbeat` its last sign of life | no |

## Tools

| tool | does |
|---|---|
| `tools/card.js` | open a card: fields, sources + archive copies (and what kind of copy each is), register, ledger, `--history` |
| `tools/change.js` | apply a change file, or refuse it (`--dry`: check it, write nothing) |
| `checks/gate.js` | before every commit: payload = ledger, evidence still holds, the edits with an image still to file and the kept warnings printed, the three suites, no new HIGH lint; on a pass it writes `.gate-stamp` (the payload's iv, then PASS and the base it compared with) |
| `tools/lock.js` | one writer at a time: the lock file itself (sessions take and release it with `tools/cloud-lock.sh`) |
| `tools/check-commit-msg.js` | the commit guard the hook runs: one line, no capital, no name, an address that may be published; by hand on a commit that exists: `node tools/check-commit-msg.js <message file> <commit>` |
| `tools/crypt.js` | decrypt / encrypt the payload |
| `tools/payload.js` | the payload format (v3: the cards in the page, the rest in `media/`), used by every tool that reads or writes it |
| `tools/doctor.js` | local state; also how long the queue has waited and the airlock's heartbeat |
| `tools/cloud-setup.sh` | start of every cloud session: the three clones, full history, the private links, `~/.ft-env`, decrypt, doctor; stops on PUBLISH BLOCKED, QUEUE CONFLICT or STATE SPLIT (`FT_READONLY=1`, for report tasks: carries on from public main past the first two, and the session can push nothing); stops, and says what to attach, when family-tree-private or family-tree-sources is not attached to the session; warns when the queue has waited long or the airlock's heartbeat is old |
| `tools/cloud-lock.sh` | the writer lock, pushed (`status`, `take`, `release`) |
| `tools/cloud-finish.sh` | end of every cloud session: the state first, then the site into the queue (`FT_PUBLISH=direct`: straight to main, interactive sessions only; `FT_PUBLISH=notes`: the notes checkpoint); exit codes 0 to 4 ("Deploy and verify") |
| `tools/cloud-lib.sh` | what the three scripts above share (the queue's verdict, the airlock's heartbeat, a safe push of the private repo and why one failed, the newest site commit, the ready mark) |
| `tools/cloud-verify.sh`, `tools/cloud-nettest.sh`, `tools/cloud-selftest.sh` | one-off checks: the backup arrived and the tools work; what the network reaches; the rehearsal of the scripts above on throwaway copies |
| `tools/stats.js` | write `stats.json` (or `--check` it) from data.json, research.json and the link ratings |
| `tools/linkconf.js` | the line figures: `check`, `show`, `list`, `override`, `build`, and `sync` (run by `cloud-finish.sh`: retire, rate from the cards' sources, build only when something changed) |
| `tools/research.js` | the Research view's data: `status`, `show`, `validate`, `build`, `check`, `link`, and the update commands (`copy` among them: where our copy of a read is) |
| `tools/pages.js` | the page list of a register scan, kept in the source archive: `add`, `show`, `unread`, `list`, `import-list` |
| `tools/mapfile.js` | the map's base layers: `check`, `write <layers.json>` (a new hashed file; keep the old one a deploy) |
| `checks/run.js` | prose linter (report only; the gate fails on new HIGH findings) |
| `checks/manifest.js` | regenerate `sources/urls.tsv` for the archive (the full finish runs it); reads the private `checks/source-hosts.json`; exit 0 complete, 3 written but not complete, 1 failed |
| `tests/run.js`, `tests/ledger.js`, `tests/research.js`, `tests/browser.js` | site regression suite; tests for this loop; tests for the research tools (the first three run in the gate and in CI); browser checks (Playwright) |

Retired: each of these refuses to run and says what to use instead. `checks/patch.js`, `checks/retag.js`
and `checks/changelog.js` (use `change.js`); `tools/photo.js` (a photo is a change file); `checks/pins.js`
(for one card `node tools/card.js <id>`, for every pin `node checks/run.js --only=C3`);
`checks/archive-verify.js` (the archive checks itself: in the family-tree-sources clone,
`node checks/archive-status.js` and `node checks/verify.js`). `checks/dossier.js` is superseded by
`card.js`; it only reads.
