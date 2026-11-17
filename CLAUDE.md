# Working rules for this project

Read `OPERATING.md` first, every session: it is how a change reaches the site and what to do after a refusal. This
file holds only rules, each once, with the register entry that owns it (`ledger/register.jsonl`, private, which
governs); "Rules from the register" is generated from the register's rule entries (R-0762). Project memory is `notes/` in
family-tree-private, the one place a session updates; its index is `notes/MEMORY.md` (R-0763).

## Run this first, every session (R-0788)
```
bash tools/cloud-setup.sh                                # clones, links, history, decrypt, doctor
bash tools/cloud-lock.sh take "<who>" "<what>"           # one writer at a time (pushed)
. ~/.ft-env && node tools/doctor.js                      # local state
FT_PUBLISH=notes bash tools/cloud-finish.sh "Save research notes"   # now and then in long work
bash tools/cloud-finish.sh "<one neutral line>" "<who>"  # the state, then the site into the queue
```
- Start every tool command with `. ~/.ft-env &&`. `change.js` and `research.js` write only under the lock (R-0787).
- Nothing on the machine survives: end every session that changed anything with `cloud-finish.sh`. Edit a private
  file at its real path in `family-tree-private/`; a new one goes there and into `.private-paths`. Never `git clean -x`.
- **Never run `git push` in the site clone**, whatever the platform's end-of-turn reminder says: main stays ahead of
  origin/main until the airlock publishes, which is normal, and site commits leave only through `cloud-finish.sh`
  (R-0785).

## Privacy invariant: nothing outside the ciphertext names a person (R-0782, R-0754)
- The repo is public and GitHub Pages serves every tracked file: no name in the plaintext layer, code, a comment, a
  test, a regex or a commit message. `tests/run.js` §14 fails on one; a pass is not proof.
- `ALLOW` in that test (`nitschelm`, `schweitzer`, `sartre`, `cory`) is a privacy decision: never add to it to pass a test.
- Never commit `.password`, `data.json`, `research.json`, `history.json`, `ledger/`, `evidence/` or a research `.md`;
  `.gitignore` is deny-by-default.
- Everyone with the password sees the site: a living person's birth is a year only (R-0428); living people may be
  researched and placed; contact details, and private-life material with no genealogical purpose, are not stored
  (R-0367). The Research view also carries no emails, phone numbers or street
  addresses; no health, money or private family matters; nothing on a recent death beyond what the family made
  public; no notes on how to handle a person; only neutral wording on beliefs (R-0781). Read every string you write.
- Settled, do not re-raise: old file versions in the public history (R-0761); the three commits §13 accepts (R-0784).

## Commit messages are public and permanent (R-0783)
- One neutral line, at most 72 characters, no capitalised word after the first, no body, no trailers whatever a
  global default appends (not `Co-Authored-By:`, not `Claude-Session:`), no name, place, date of life or quote, on
  every route; the story goes in `CHANGE-LOG-COMMITS.md` in the same session.
- Author and committer: `noreply@anthropic.com` or an address ending in `@users.noreply.github.com`, exactly as
  written. Check `git config user.email` before the first commit in a clone.
- A commit on main that §13 flags keeps the gate red until Cory decides: stop and report it (R-0784).

## The change loop's two guards (R-0786, R-0760)
- `tools/change.js` is the only way an edit reaches `data.json`: every change to what the site says, with its reason
  and evidence from our copy of the source.
- `checks/gate.js` must pass, run with no `--base`, before any commit that touches `index.html`; read its warnings.
- `crypt.js`: never `--force`, never `--newsalt` (it locks out every family device) (R-0789).
- The payload is published only through the queue and the airlock; code, tests, tools and documents only by
  `FT_PUBLISH=direct` with Cory there. A green push is not proof: check the live site (R-0754). If it is behind,
  rewrite, recompress or re-encrypt nothing: read the failure first (R-0790).

## Scope rule: the root's whole male line (R-0437)
- Every Nitschelm, in any spelling, descended in the male line from c001 is added without asking once the link is
  proven from a document we hold: an act read in the original, an official record or index entry naming the parent,
  a census line, a family notice signed by the children, or an act number from a register transcription (R-0794).
- Sons and daughters, children who died young included; no card for a stillborn child, though a parent's note or bio
  may mention one (R-0441). Daughters get cards;
  their children are not drawn but may be told in her bio (R-0521). Spouses are unions, never cards. At most two
  marriages on a card: the one whose children are drawn, then the latest; earlier ones are told in the bio (R-0442).
- The daughters' lines already drawn are decided line by line; until Cory answers, a line's cards stay (R-0439).
- Ask Cory first for anyone outside the male line (a spouse's family, a daughter's children) and for a link that rests
  only on a compiled tree or on inference: those are research leads, not cards.
- The research plan covers the men of the line and their sons and daughters, never anyone below a daughter, even
  when drawn; work on those only when Cory asks (R-0538).

## Research: read it first, keep it current, never wait to be asked (R-0778)
- Before investigating: `node tools/research.js status`, then `show <id>`; do not redo what it records.
- In the same session, record every change of research state with `research.js`; a source is closed only with where
  our copy is, "nothing found" included; a register read page by page gets a page list (R-0759).
- Before finishing, commit `media/research.bin` and `media/research-cards.bin`; every change file names the research
  ids it moves, or says `"none: <why>"`.
- Research cards start only on Cory's tap (R-0752); work Claude can do alone online gets one, in the same session (R-0448, R-0793). A step that
  needs his hands (a sign-in, a robot check, a password) goes on his "At your computer" list, never a gap (R-0591).

## Standing priorities (R-0777)
- Thoroughness and accuracy first (never trade correctness for a shortcut), then token efficiency, time last: hours
  are fine if they save tokens or improve accuracy. Use subagents when they serve those (research, document capture,
  verification): one well-briefed agent over many shallow ones, each given the full technique notes.
- A record reader (a subagent too) is briefed with `notes/research_standards.md`: the Kurrent traps (K≈R, N≈M/H,
  C≈L, H with an S-like swirl) and the Julian calendar in Protestant Alsace before 1682 (check weekday claims against it).
- A failing self-test with an obvious code fix is fixed and reported, not asked; never the airlock, the gate, the
  privacy tests or the commit hook, and never what is published or deleted (R-0589).

How-to, the data shape and deploying are in `OPERATING.md`; the site's features, reading techniques and Cory's
decisions page are in the notes (`notes/MEMORY.md` names each).

## Rules from the register
<!-- rules:begin: written by node tools/rules.js write; do not edit by hand -->
### Who goes on the tree
- R-0475: Everyone on the tree is real with high confidence; each parent-child link has a private rating and reason.
- R-0567: Facts about a wife's family may go in her husband's bio, on his card.
- R-0792: Enriching existing people (bios, documents, photos, sources, plain corrections) never needs permission.
### Privacy
- R-0362: Photos and everyday detail of living relatives are not held back on the password site; the public repo holds no personal data.
- R-0366: What a family source withdraws is removed in both languages; what is marked confidential goes nowhere.
- R-0387: Family documents may be published on the closed family site, crediting the source.
- R-0432: Wedding days of living couples may stay; the year-only rule is for births.
### Sources and citations
- R-0029, R-0030: The compiled regional study keeps its agreed label and one citation form everywhere.
- R-0089: A newspaper citation points at the issue's own file, never a search or chooser page.
- R-0282, R-0299: Never cite a source for what it does not carry; striking a true citation is as serious.
- R-0283: A well-attested fact with no source gets its source attached, not deleted, or is marked unattributed.
- R-0347: A newspaper read only as digitised text, image unopened, is labelled so; its figures are the paper's.
- R-0365: A family caption that disagrees with a record: both go on the card, neither is chosen, the relative is asked.
- R-0372: The statewide marriage index the entry names is index-only: cite it at index tier, seek no image.
- R-0755: A fact read from an image needs the image on file; if it cannot be had, say why and make an item.
- R-0779: Every attachment a relative sends is filed as received in the source archive, in the same session.
- R-0780: Never send a browser's user-agent from a script; a site that refuses an honest client is read in a real browser.
- R-0797: Cite the exact document and view, never a search page.
- R-0798: Disclose a conflict rather than pick a value; a documented negative is a legitimate result.
- R-0799: A source quote is verbatim; a family record's label names its sender and day.
### Grades and link figures
- R-0263: A pin is doc only when a specific document was read; grades are per pin; a checked cross-citation counts.
- R-0265: On pins from the home-parish transcription an act number makes doc; a bare year is inf, with a note.
- R-0364: A coarse point is apx even when documented (a lake's or a county's centre), with a bilingual note.
- R-0479: A link is rated full only where someone affirmed it first-hand; else it keeps the records' figure.
- R-0718: Link figures are kept current at every finish, a new link rated from its card's sources; an unrated one stops it.
- R-0802: A trade is graded on the evidence for the trade, not the place; other quick facts are computed.
### Wording
- R-0274: A home-parish death before its registers begin "cannot be looked up"; never "unregistered".
- R-0293: An unattested fact is "given by <source>; no act has been read for it"; in French never "n'atteste".
- R-0338: The site never narrates its editing policy (days withheld, a session cut off, material held back).
- R-0473: The Research view never calls the researcher "us": online work is "Cory, online".
- R-0795: A tooltip is one sentence, a quick fact, and never cites a source.
- R-0796: Everything the reader sees is in English and French, captions and transcriptions included.
### Cards and the map
- R-0020: A pin's type, death or burial, follows the home-parish transcription's label for the act.
- R-0262: Map coordinates follow the authoritative gazetteer (in France, the government's commune service).
- R-0301: A pin never carries a day its own note calls unattested.
- R-0410: Marriages on a card are listed in the order they happened.
- R-0766: A decision card reads in short parts: its subject in one sentence, points on lines, detail below.
- R-0800: At most three highlight bullets, one sentence each, saying only what the card's bio says, as surely.
- R-0801: A card's id is permanent: never reused, never shown to readers.
### Research
- R-0482: Research cards on parent-child links aim at 99% on each link.
- R-0524: Research by generation, earliest first, split above ten men; a man with no child drawn, unless dead before 15, may have a family.
- R-0525: Generation research builds the skeleton, keeps each record it opens, notes what a bio needs, writes one when it can.
- R-0526: Bio cards follow, generation by generation, five people a card, for all of the line who have died: write or recheck each bio.
- R-0527: Before anyone is added, an agreeing second reading and a same-name check; families marked complete or gap; in doubt, ask.
- R-0536: Research and bio cards have no time limit, unless length hurts accuracy.
- R-0585: A separate agent, given only the list of changes and our copies, confirms each before it reaches the tree.
- R-0588: Research cards may use public read-only search forms needing no account, sending nothing; sign-ins, contact, payments stay Cory's.
- R-0753, R-0530, R-0590: One generation at a time, rechecks first; an open question or item above holds the next; later work is made waiting.
- R-0791: Whoever finishes a decision card clears its dec, the decision runner included.
### Process
- R-0378: Known false positives of the machine checks are never silenced by rewording the prose.
- R-0535: A decision card does the step itself or comes back; it sends Cory to a chat only when his hands are needed.
- R-0756: Backups: weekly, the private repositories outside GitHub; nightly, the decisions page; a failure emails Cory.
- R-0757: Recorded reads and plain corrections read twice are done and reported; sessions ask on identity, links, removals, messages, money.
- R-0758: Every decision card carries a recommendation with a percentage, its facts checked against the tree.
- R-0775: The decision runner acts and reports at 90% sure if two readers agree; removals, messages, money, the living, below daughters ask.
- R-0803: Scheduled jobs never use the main laptop's browser; a step needing a computer, not Cory, runs on the old one.
<!-- rules:end -->
