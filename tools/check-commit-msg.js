#!/usr/bin/env node
/* check-commit-msg.js — the commit-msg guard.
 *
 * WHY THIS EXISTS. The repo is public. Commit messages are readable without the
 * password, Actions run titles republish them, and a force-push does not
 * unpublish anything — GitHub serves old SHAs by hash forever. tests/run.js §13
 * scans commits that are not yet pushed, but it only helps if somebody runs it,
 * and once a commit IS pushed §13 can never see it again. Two commits reached
 * the public history carrying given names that way. This hook closes that door:
 * it runs on every commit, whether or not anyone remembers the test suite.
 *
 * WHAT IT ENFORCES (CLAUDE.md, "Commit messages are public"):
 *   1. one line — no body, ever, and that includes trailers
 *   2. <= 72 characters
 *   3. no capitalised word after the first — proper nouns are the tell
 *   4. no word that is a person's name: in the payload (cards, spouses, the correspondents its
 *      source labels name) or, where this clone has them, on the private lists (below)
 *   5. the author and the committer use an address the airlock publishes, written as the
 *      airlock reads it, and a name that is not an address
 *
 * Rule 3 is the one that actually does the work, and it is deliberately blunt.
 * The name index (rule 4) can only know people the payload lists as nodes or
 * spouses; it did NOT contain the short form of one given name
 * and does not contain a wife who has not been added to the tree yet. A rule
 * that bans mid-sentence capitals needs to know none of that — it catches any
 * proper noun, person or place or business, including ones nobody has indexed.
 * A neutral mechanical subject never needs one.
 *
 * THE PRIVATE LISTS (16 Nov 2026, register R-0761). The payload does not hold everyone
 * the project knows: people researched and never to be published (ledger/research-deny.txt),
 * people taken off the tree (TRIMMED-PEOPLE.md) and people found and not added
 * (NOT-ADDED-PEOPLE.md). Those files are private; a working clone has them as links in the
 * repository root, a bare checkout and CI have none. Where they are present their names join
 * the index; where they are absent the guard checks against the payload alone, as before.
 * FT_PRIVATE_LISTS names another folder that holds them at the same relative paths.
 *
 * Rule 5: an address in a commit is as public as its message, and as permanent. 58 early
 * commits carry a personal address; nothing checked. The addresses that pass are the two the
 * airlock publishes and no others, so that a commit this guard lets through is not refused
 * later, when nobody is there to redo it: the cloud sessions' own (noreply at SESSION_HOST) and
 * a GitHub address ending in @users.noreply.github.com. An address under ".invalid" passes only
 * in a repository that cannot publish (no remote, or only remotes that are folders on this
 * machine): the test suites and the rehearsal commit with one in their throwaway repositories.
 * An address is compared as it is written, capitals and all, because the airlock compares it so:
 * until the review of 16 Nov 2026 this guard put it in lower case first, and passed a commit the
 * airlock then refused. For the same reason a name that holds an @ (an address typed where the
 * name belongs) is refused: the airlock refuses it, and a refused queue stops every session.
 *
 * It FAILS CLOSED. If it cannot build the name index it refuses the commit
 * rather than waving it through, because "could not check" and "checked and
 * clean" must never look the same on a privacy guard.
 *
 * Invoked by githooks/commit-msg. Wire it up with:
 *   git config core.hooksPath githooks
 * By hand, on a commit that already exists (its message in a file, then its id):
 *   node tools/check-commit-msg.js <message file> <commit>
 * tests/run.js (sections 13 and 14) uses the name helpers this file exports.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const MAX_LEN = 72;

/* ====================================================================================
 * Names: what this guard and tests/run.js share
 * ==================================================================================== */

/* One spelling to compare by: no accents, no ligatures, lower case. A name written without its
 * accent, or with one it never had, is the same name. */
const fold = s => String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ø/g, "o")
  .replace(/ł/g, "l").replace(/đ/g, "d").replace(/ı/g, "i");
/* the words of a text, folded: runs of letters, whatever stands between them */
const words = s => fold(s).split(/[^\p{L}]+/u).filter(Boolean);

/* words that end a name without being part of it */
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "junior", "senior", "fils", "pere"]);
/* words that open one */
const TITLE = /^(?:mr|mrs|ms|miss|dr|rev|lieut|lt|capt|col|sgt|sir|mme|mlle|monsieur|madame|mademoiselle|herr|frau|aunt|uncle|the)\.?$/i;

/* The ways one name can be written. `exact` is the name as given, its words single-spaced.
 * `loose` are shorter spellings of the same person: without a nickname in brackets or quotes,
 * without initials and "Jr", given name and surname alone (in either order, as a register
 * writes it), the first two words of a longer name (two given names, or a given name and a
 * maiden name), a nickname with the surname, and a second full name given in brackets, with
 * its own shorter spellings.
 * `surname` is the last real word (not "Jr", not an initial, not a bracket), `given` the ones
 * before it. A one-word name has no forms: one word alone is not a full name. */
function nameForms(raw) {
  const s = String(raw == null ? "" : raw);
  const NICK = /\(([^)]*)\)|["“«]([^"”»]*)["”»]/g;
  const all = words(s);
  const bare = words(s.replace(NICK, " "));
  const core = bare.filter(w => w.length > 1 && !SUFFIX.has(w));
  const nicks = [];
  const second = [];
  s.replace(NICK, (m, a, b) => {
    const w = words(a || b || "");
    if (w.length) nicks.push(w.join(" "));
    if (w.filter(x => x.length > 1).length > 1) second.push(nameForms(String(a || b).replace(/[()"“”«»]/g, " ")));
    return m;
  });
  const exact = all.length > 1 ? all.join(" ") : null;
  const loose = new Set();
  let surname = null, given = [];
  if (core.length > 1) {
    surname = core[core.length - 1]; given = core.slice(0, -1);
    loose.add(bare.join(" ")); loose.add(core.join(" "));
    loose.add(core[0] + " " + surname); loose.add(surname + " " + core[0]);
    if (core.length > 2) loose.add(core[0] + " " + core[1]);
    nicks.forEach(n => loose.add(n + " " + surname));
  }
  second.forEach(f => { if (f.exact) loose.add(f.exact); f.loose.forEach(l => loose.add(l)); });
  loose.delete(exact);
  return { exact, loose: [...loose], surname, given };
}

/* Correspondents named in the payload's source labels are people too, and they are not cards.
 * Labels introduce them in a few fixed shapes ("Email to X from Y, <date>", "photographed by Y",
 * "via Y", "Letter of X to Y", "X — her photographs"); only correspondence-like labels are
 * read, which keeps place names and publications out. Until 16 Nov 2026 a name followed by a
 * comma was not read, and most labels put the date after one. */
const CORRESPONDENCE = /email|courriel|letter|lettre|correspondence|correspondance|photograph|bible|scrapbook|\bvia\b/i;
const NAME_RUN = "((?:[\\p{Lu}][\\p{L}'’.-]*(?:\\s+|(?=[^\\p{L}\\s]|$))){2,4})";
const NAMED_BY = new RegExp("(?:^|[^\\p{L}])(?:from|by|via|to|of|and)\\s+(?:contributor\\s+)?[“\"]?" + NAME_RUN, "gu");
const NAMED_FIRST = new RegExp("^" + NAME_RUN + "\\s*—", "u");
/* a run of capitalised words after "of" or "via" is as often an institution as a person */
const NOT_A_PERSON = new Set(["archives", "archive", "archief", "archiv", "library", "bibliotheque", "society", "societe",
  "museum", "musee", "magazine", "register", "cemetery", "church", "university", "college", "school", "times", "journal",
  "gazette", "herald", "tribune", "county", "state", "national", "city", "family", "bible", "letter", "index", "court",
  "hospital", "festival", "station", "war", "project", "class", "history", "ancestry", "geneanet", "familysearch", "findagrave"]);
function labelNames(labels) {
  const out = new Set();
  const take = run => {
    let toks = run.trim().split(/\s+/).map(t => t.replace(/['’]s$/, "").replace(/[.'’-]+$/, "")).filter(Boolean);
    while (toks.length && TITLE.test(toks[0])) toks = toks.slice(1);
    if (toks.length < 2 || toks.some(t => NOT_A_PERSON.has(fold(t)))) return;
    out.add(toks.join(" "));
  };
  (labels || []).filter(l => typeof l === "string" && CORRESPONDENCE.test(l)).forEach(l => {
    let m; NAMED_BY.lastIndex = 0;
    /* step back over the name just read, so that "from A B and C D" gives both */
    while ((m = NAMED_BY.exec(l))) { take(m[1]); NAMED_BY.lastIndex = m.index + 1; }
    if ((m = NAMED_FIRST.exec(l))) take(m[1]);
  });
  return [...out];
}

/* ---------- the private lists ----------
 * deny:  every line of ledger/research-deny.txt (as tools/research.js reads it)
 * names: full names from TRIMMED-PEOPLE.md and NOT-ADDED-PEOPLE.md
 * Never read in CI: the files cannot be there, and a log line about them is public. */
const PRIVATE_FILES = ["ledger/research-deny.txt", "TRIMMED-PEOPLE.md", "NOT-ADDED-PEOPLE.md"];

/* TRIMMED-PEOPLE.md keeps each card as it was, as JSON: the names are the values of these keys. */
function namesFromRecords(md) {
  const out = [];
  const re = /"(?:name|s|spouse|mother|father)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(md))) {
    let v; try { v = JSON.parse('"' + m[1] + '"'); } catch (_) { continue; }
    v = v.replace(/^c\d{3,}\s+/, "").replace(/\s+(?:c\.\s*)?\d{3,4}\b.*$/, "").trim();   /* "c042 Name 1832–1906" → "Name" */
    if (nameForms(v).exact) out.push(v);
  }
  return out;
}

/* The site's own public words: the family names on its front page and the owner's first name,
 * the same four as ALLOW in tests/run.js section 14 (which checks that the two agree). They
 * exempt nothing here. They only keep the family name from proving that a phrase on a private
 * list is a person: nearly every heading in those files carries it. */
const PUBLIC_WORDS = ["nitschelm", "schweitzer", "sartre", "cory"];

/* Words a heading, a verdict or a place is made of and a person's name is not. The list cannot
 * be complete; what gets past it is caught late and loudly (see NOT_A_PERSON_HINT). */
const HEADING = new Set([...NOT_A_PERSON, "research", "branch", "line", "lines", "cluster", "clusters", "spelling",
  "record", "records", "unknown", "unnamed", "unplaced", "updated", "resolved", "proven", "pending", "see", "tree",
  "people", "person", "children", "child", "son", "daughter", "wife", "husband", "widow", "brother", "sister", "father",
  "mother", "parents", "born", "died", "married", "yes", "no", "not", "our", "own", "new", "old", "saint", "st", "san",
  "los", "las", "fort", "mount", "falls", "island", "springs", "heights", "valley", "beach", "co", "inc"]);
const NOT_A_PERSON_HINT = "If a phrase read from a private list is a heading, a place or a verdict and not a person, " +
  "take the bold off it (or move it out of the Person column) in that file, in family-tree-private, and run this again.";

/* Both files list people in tables, and a table's header row says what each column holds.
 * Until the review of 16 Nov 2026 every bold phrase of a row was read, the verdict in the
 * recommendation column too: one verdict holding a word that is also on the tree would have
 * put ordinary words on the list of names, turned the gate red and stopped the day's commit,
 * with nothing pointing at the private file. Now:
 *  - "Person", "Name": the people the table is about. Where the column writes them in bold among
 *    other words, the bold phrases are the names; where it has no bold at all, each cell is one.
 *  - "Mother", "Father", "Parent", "Spouse": each cell is one name.
 *  - "Rec.", "Evidence", "Status" and the like (VERDICT_COLUMN): never read.
 *  - any other column (a description, the reasons): a bold phrase is a name only if `known`
 *    holds one of its words, that is, a name already in the payload, the site's public words
 *    aside. These columns name the parents, husbands and wives of the row's person, in bold,
 *    two dozen people today; they also put facts in bold, which is why the test is stricter.
 * Everywhere, a phrase is a name only when every word of it reads as one (capitalised words,
 * initials, a nickname in brackets) and none is a HEADING word; and one with a word written all
 * in capitals (how these files write a heading, and now and then a surname) needs a word of
 * `known` in the people columns too. A row that stands apart from its table (a blank line above
 * it, as one does today) is read under the header before it when it has as many cells.
 * Names in running text are not read: nothing there says where one starts and stops. */
const PEOPLE_COLUMN = /^(?:person|people|name|names)$/, ONE_PERSON_COLUMN = /^(?:mother|father|parent|spouse|husband|wife)$/;
const VERDICT_COLUMN = /^(?:rec|recommendation|recommended|verdict|status|decision|evidence|source|sources|action|next)$/;
function tablesOf(md) {
  const out = [];
  const lines = String(md).split(/\r?\n/), row = l => /^\s*\|/.test(l);
  const cellsOf = l => l.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map(c => c.trim());
  const rule = cells => cells.every(c => /^:?-+:?$/.test(c));
  for (let i = 0; i < lines.length; i++) {
    if (!row(lines[i])) continue;
    const block = [];
    while (i < lines.length && row(lines[i])) block.push(cellsOf(lines[i++]));
    if (block.length > 1 && rule(block[1])) out.push({ head: block[0], rows: block.slice(2) });
    else {
      const last = out[out.length - 1];
      if (last) last.rows.push(...block.filter(c => c.length === last.head.length && !rule(c)));
    }
  }
  return out;
}
function asName(part, known, needsKnown) {
  const WORD = /^(?:[\p{Lu}][\p{L}'’-]*\.?|\([\p{Lu}][\p{L}'’. -]*\)|["“][\p{Lu}][\p{L}'’. -]*["”])$/u;
  const SMALL = /^(?:de|du|des|la|le|von|van|der|den|zu)$/;
  /* "c042 Name 1832–1906", "Name (b. 1901)", "“Name”" → "Name" */
  part = String(part).replace(/^\s*c\d{3,}\s+/, "").replace(/\s*\(?(?:[bd]\.|c\.)?\s*\d.*$/, "").trim().replace(/^["“]([^"“”]*)["”]$/, "$1");
  let toks = part.match(/\([^)]*\)|["“][^"”]*["”]|\S+/g) || [];
  while (toks.length && TITLE.test(toks[0])) toks = toks.slice(1);
  if (toks.length < 2 || toks.length > 6) return null;
  if (!toks.every((t, i) => WORD.test(t) || (i > 0 && i < toks.length - 1 && SMALL.test(t)))) return null;
  /* two words at least outside any bracket, one of them more than an initial */
  const bare = words(toks.join(" ").replace(/\([^)]*\)|["“][^"”]*["”]/g, " "));
  if (bare.length < 2 || !bare.some(w => w.length > 2)) return null;
  const letters = t => t.replace(/[^\p{L}]/gu, "");
  if (toks.some(t => HEADING.has(fold(letters(t))))) return null;
  const capitals = toks.some(t => { const l = letters(t); return l.length > 1 && l === l.toUpperCase() && !SUFFIX.has(l.toLowerCase()); });
  if ((needsKnown || capitals) && !(known && bare.some(w => w.length > 2 && known.has(w) && !PUBLIC_WORDS.includes(w)))) return null;
  return toks.join(" ");
}
function namesFromTables(md, known) {
  const out = [];
  const take = (part, needsKnown) => { const n = asName(part, known, needsKnown); if (n) out.push(n); };
  const bold = (cell, needsKnown) => (cell.match(/\*\*([^*]+)\*\*/g) || []).forEach(b =>
    b.replace(/\*\*/g, "").split(/\s*(?:→|×|·|,|;|\/|&|=|—|–|:|\band\b|\bet\b)\s*/).forEach(p => take(p, needsKnown)));
  for (const t of tablesOf(md)) {
    t.head.forEach((h, col) => {
      const first = words(h)[0] || "";
      if (VERDICT_COLUMN.test(first)) return;
      const cells = t.rows.map(r => r[col] || "");
      if (ONE_PERSON_COLUMN.test(first)) cells.forEach(c => take(c.replace(/\*\*|~~/g, ""), false));
      else if (!PEOPLE_COLUMN.test(first)) cells.forEach(c => bold(c, true));
      else if (cells.some(c => /\*\*[^*]+\*\*/.test(c))) cells.forEach(c => bold(c, false));
      else cells.forEach(c => take(c, false));
    });
  }
  return out;
}

/* opts.dir: the folder that holds the files (default FT_PRIVATE_LISTS, then the repository root);
 * opts.known: folded name words of the payload (see namesFromTables).
 * Returns { dir, files (those found), deny, names, origin (name → the file it was read from), ci }.
 * Nothing found is not an error. */
function privateLists(opts) {
  opts = opts || {};
  const dir = opts.dir || process.env.FT_PRIVATE_LISTS || ROOT;
  const res = { dir, files: [], deny: [], names: [], origin: Object.create(null), ci: false };
  if (process.env.CI || process.env.GITHUB_ACTIONS) { res.ci = true; return res; }
  const read = f => { try { const t = fs.readFileSync(path.join(dir, f), "utf8"); res.files.push(f); return t; } catch (_) { return null; } };
  const deny = read(PRIVATE_FILES[0]);
  if (deny !== null) res.deny = [...new Set(deny.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => words(l).join(" ")).filter(Boolean))];
  for (const f of PRIVATE_FILES.slice(1)) {
    const md = read(f);
    if (md === null) continue;
    namesFromRecords(md).concat(namesFromTables(md, opts.known)).forEach(n => { if (!(n in res.origin)) res.origin[n] = f; });
  }
  res.names = Object.keys(res.origin);
  return res;
}
/* For a failure message: where each word the private lists add comes from.
 * word → { file, phrase } (phrase: the name it is part of; null for a never-publish line) */
function listWords(priv) {
  const from = new Map();
  (priv.names || []).forEach(n => words(n).forEach(w => { if (w.length >= 3 && !from.has(w)) from.set(w, { file: priv.origin[n], phrase: n }); }));
  (priv.deny || []).forEach(d => d.split(" ").concat(d).forEach(w => { if (w.length >= 3 && !from.has(w)) from.set(w, { file: PRIVATE_FILES[0], phrase: null }); }));
  return from;
}
const listedAs = (w, o) => o.phrase ? w + " (read in " + o.file + ' as part of "' + o.phrase + '")' : w + " (a never-publish line of " + o.file + ")";

/* the name words (three letters and up, or `min`, folded) of a list of names, into a Set */
function nameWords(names, into, min) {
  const set = into || new Set();
  (names || []).forEach(n => words(n).forEach(w => { if (w.length >= (min || 3)) set.add(w); }));
  return set;
}
/* A correspondent who is not on the tree is as often a stranger (a photographer, a contributor to
 * a graves site) as a relative, and a stranger's short surname is as often an ordinary word that
 * code and messages use every day. A word known only from a source label counts as a name from
 * six letters; in a full name it counts at any length. */
const LABEL_WORD_MIN = 6;

/* Does this text carry a line of the deny list? Those are never to be published in any form, so
 * a long entry counts wherever its letters stand, inside a longer word or a user name too; a
 * short one only as a word of its own, or it would match half the dictionary. */
function denyHits(text, deny) {
  if (!deny || !deny.length) return [];
  const spaced = " " + words(text).join(" ") + " ";
  return deny.filter(d => d.replace(/ /g, "").length >= 5 ? spaced.includes(d) : spaced.includes(" " + d + " "));
}

/* Rule 5. True for an address that may be published: the two forms the airlock lets through
 * (its rules.py), compared as written (no trimming, no lower case), so the guard and the airlock
 * cannot disagree about a commit. With
 * opts.throwaway, an address under the reserved ".invalid" ending as well. With opts.web, the
 * address GitHub itself writes as the committer of an edit made on its web page (noreply at
 * WEB_HOST): tests/run.js asks that way about the committer of a commit already on main, which
 * no hook and no airlock ever saw; a commit made here never carries it. */
const SESSION_HOST = "anthropic.com", WEB_HOST = "github.com";
function noreply(email, opts) {
  const m = String(email == null ? "" : email).match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return false;
  const local = m[1], host = m[2];
  if (local === "noreply" && host === SESSION_HOST) return true;
  if (host === "users.noreply.github.com" && [...local].length <= 100) return true;
  if (opts && opts.web && local === "noreply" && host === WEB_HOST) return true;
  return !!(opts && opts.throwaway) && /(?:^|\.)invalid$/.test(host);
}
/* Rule 5, the name. True for an author's or committer's name the airlock lets through: one with
 * no @ in it. An address typed where the name belongs is as public as one in its own place. */
const plainName = name => !String(name == null ? "" : name).includes("@");
/* A repository that cannot publish: it has no remote, or every remote is a folder on this
 * machine. The suites' and the rehearsal's repositories are like that; a working clone never is. */
function throwaway(cwd) {
  let out;
  try {
    out = cp.execFileSync("git", ["config", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"],
      { cwd: cwd || process.cwd(), stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  } catch (e) { return e.status === 1; }      /* 1: no remote at all; anything else could not be read, so: no */
  const urls = out.split(/\r?\n/).map(l => l.replace(/^\S+\s+/, "").trim()).filter(Boolean);
  return urls.every(u => /^(?:\/|\.\.?\/|file:\/\/|[A-Za-z]:[\\/])/.test(u));
}
/* what to do about an address: one wording, here and in tests/run.js section 13 */
const ADDRESS_FIX = "give this clone an address that may be published: git config user.email noreply@" + SESSION_HOST +
  " (the cloud sessions' own), or the GitHub account's address ending in @users.noreply.github.com";
const NAME_FIX = "give this clone a name that is not an address: git config user.name \"<a name with no @ in it>\"";

if (require.main !== module) {
  module.exports = { fold, words, nameForms, labelNames, privateLists, namesFromRecords, namesFromTables, listWords, listedAs,
    nameWords, denyHits, noreply, plainName, throwaway, PRIVATE_FILES, LABEL_WORD_MIN, PUBLIC_WORDS, SESSION_HOST, WEB_HOST, ADDRESS_FIX, NAME_FIX,
    NOT_A_PERSON_HINT };
  return;
}

/* ====================================================================================
 * The guard
 * ==================================================================================== */
const die = m => { console.error("\ncommit-msg: " + m + "\n"); process.exit(1); };

/* ---------- the message ---------- */
const msgPath = process.argv[2];
if (!msgPath) die("no message file given (the hook passes it as $1).");
const raw = fs.readFileSync(msgPath, "utf8");
/* What git will store: everything from a scissors line down is cut; "#" lines are dropped only when git
 * strips comments, which its editor template then says ("Lines starting with '#' will be ignored"). A
 * message given with -m or -F, or committed with cleanup=whitespace, keeps its "#" lines in the commit, so
 * there they are lines like any other, and a second line is a body (18 Oct 2026: "-m '# <a name>'" passed
 * this guard). */
let all = raw.split(/\r?\n/);
const cut = all.findIndex(l => /^# -+ >8 -+$/.test(l));
if (cut >= 0) all = all.slice(0, cut);
const strip = /^# with '#' will be ignored|Lines starting with '#' will be ignored/m.test(raw);
const lines = all
  .filter(l => !(strip && l.startsWith("#")))
  .map(l => l.replace(/\s+$/, ""));
while (lines.length && !lines[lines.length - 1]) lines.pop();
while (lines.length && !lines[0]) lines.shift();

if (!lines.length) die("empty commit message.");
if (lines.length > 1) {
  die("commit messages in this repo are ONE LINE — no body, ever.\n" +
      "  This applies to trailers too (Co-Authored-By, Claude-Session): they are a body,\n" +
      "  they are public, and CLAUDE.md overrides any global default that adds them.\n" +
      "  The narrative belongs in CHANGE-LOG-COMMITS.md, which is gitignored.\n" +
      "  Offending line " + (lines.length) + ': "' + lines[1] + '"');
}
const subject = lines[0];
if (subject.length > MAX_LEN)
  die("commit subject is " + subject.length + " chars; the limit is " + MAX_LEN + ".\n" +
      "  A long subject is nearly always narrative. Describe the mechanical change:\n" +
      '  "Update site data payload", "Update checks and tooling".');

/* ---------- 3. no proper nouns after the first word ----------
 * Technical terms that are capitalised but are provably not people. Being on
 * this list exempts a word from the capitals rule ONLY — it is still checked
 * against the payload name index below, so a real name here changes nothing. */
const TECH = new Set(["github","actions","pages","readme","json","html","css",
  "aes","gcm","ci","en","fr","node","npm","js","url","urls","pbkdf2","svg","jpeg",
  "png","dom","api","http","https","utf","claude","cowork","windows","linux"]);
{
  const toks = subject.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const offenders = toks.slice(1).filter(w => {
    const bare = w.replace(/['-].*$/, "");
    if (bare.length < 2) return false;
    if (TECH.has(bare.toLowerCase())) return false;
    if (bare === bare.toUpperCase()) return false;      // acronym like ENC
    return bare[0] === bare[0].toUpperCase() && bare[0] !== bare[0].toLowerCase();
  });
  if (offenders.length)
    die("capitalised word(s) after the first: " + offenders.join(", ") + "\n" +
        "  Proper nouns do not belong in a public commit subject — that is how names\n" +
        "  leak. Describe the mechanical change instead:\n" +
        '  "Update site data payload", "Update checks and tooling".');
}

/* ---------- 5. the author and the committer ----------
 * (Before rule 4: it needs no name index.) Inside `git commit` the author is in the environment
 * and `git var` gives both names and addresses exactly as git is about to write them, an --author,
 * a -c user.email and an amend included. Called by hand with a commit id, that commit's own two
 * are read. Called by hand with a message file alone, no commit is being made and there is
 * nothing to check. */
{
  const commit = process.argv[3];
  const git = args => cp.execFileSync("git", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").replace(/\r?\n$/, "");
  let who = null;
  try {
    if (commit) {
      const [ae, ce, an, cn] = git(["log", "-1", "--format=%ae%x1f%ce%x1f%an%x1f%cn", commit, "--"]).split("\x1f");
      who = { author: { addr: ae, name: an }, committer: { addr: ce, name: cn } };
    } else if (process.env.GIT_INDEX_FILE || process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL) {
      /* "<name> <<address>> <time> <zone>" */
      const ident = v => { const m = git(["var", v]).match(/^(.*?) ?<([^<>]*)>[^<>]*$/); return m ? { addr: m[2], name: m[1] } : { addr: undefined, name: "" }; };
      who = { author: ident("GIT_AUTHOR_IDENT"), committer: ident("GIT_COMMITTER_IDENT") };
    }
  } catch (e) {
    die("could not read the author and committer of this commit, so it is REFUSED.\n" +
        "  A privacy guard that cannot check must not pass.\n" +
        "  Fix: check that `git var GIT_AUTHOR_IDENT` prints a name and an address here" +
        (commit ? " and that " + commit + " is a commit" : "") + ", then commit again.");
  }
  if (who) {
    const loose = { throwaway: throwaway(process.cwd()) };
    const bad = Object.keys(who).filter(k => !noreply(who[k].addr, loose));
    const named = Object.keys(who).filter(k => !plainName(who[k].name));
    const the = list => "the " + list.join(" and the ");
    /* what to do next is the same for an address and for a name */
    const then = commit ? "  Then, if " + commit + " is the newest commit and tools/cloud-finish.sh has not queued it yet:\n" +
                          "  git commit --amend --reset-author --no-edit. If it is older or already queued, stop and report it to Cory."
                        : "  Then commit again. If this commit amends one written under the other " + (bad.length ? "address" : "name") + ", the author stays\n" +
                          "  as it was unless you say: git commit --amend --reset-author --no-edit";
    if (bad.length)
      die(the(bad) + " of this commit " + (bad.length > 1 ? "do" : "does") + " not use an address that may be published" +
          " (" + bad.map(k => k + ": …@" + String(who[k].addr || "none").replace(/^.*@/, "")).join(", ") + ").\n" +
          "  An address in a commit is public and cannot be taken back, and the airlock refuses any other.\n" +
          (bad.some(k => noreply(String(who[k].addr || "").trim().toLowerCase(), loose)) ? "  (An address is compared as it is written: with a capital letter or a space in it, it is another address.)\n" : "") +
          (bad.some(k => /invalid$/i.test(String(who[k].addr))) ? "  (An address under .invalid passes only in a throwaway repository, one with no remote on the network.)\n" : "") +
          (named.length ? "  (" + the(named).replace(/^t/, "T") + " also " + (named.length > 1 ? "have" : "has") + " a name that holds an @ sign, which the airlock refuses too: git config user.name \"<a name with no @ in it>\".)\n" : "") +
          "  Fix: " + ADDRESS_FIX.replace(": git", ":\n  git").replace(", or the", ",\n  or the") + ",\n" +
          "  and leave out --author, GIT_AUTHOR_EMAIL and GIT_COMMITTER_EMAIL if one of them set this one.\n" + then);
    if (named.length)
      die(the(named) + " of this commit " + (named.length > 1 ? "have" : "has") + " a name that holds an @ sign: an address where a name belongs.\n" +
          "  A name in a commit is as public as its address and cannot be taken back, and the airlock refuses this one.\n" +
          "  Fix: " + NAME_FIX.replace(": git", ":\n  git") + ",\n" +
          "  and leave out --author, GIT_AUTHOR_NAME and GIT_COMMITTER_NAME if one of them set this one.\n" + then);
  }
}

/* ---------- 4. the name index ---------- */
function namesFromPayload(data) {
  const names = [], labels = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.name) names.push(n.name);
    (n.src || []).forEach(x => { if (x && typeof x.l === "string") labels.push(x.l); });
    (n.unions || []).forEach(u => { if (u.s) names.push(u.s); (u.c || []).forEach(walk); });
  })(data.tree || data.root || data);
  /* the labels are in data.json only: the page itself carries the cards, and those hold no sources */
  return { toks: nameWords(names), labelToks: nameWords(labelNames(labels), null, LABEL_WORD_MIN) };
}

function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  try { return fs.readFileSync(path.join(ROOT, ".password"), "utf8").trim(); }
  catch (_) { return null; }
}

async function loadNames() {
  /* preferred: the decrypted payload sitting in the working copy */
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
    const t = namesFromPayload(d);
    if (t.toks.size) return { ...t, via: "data.json" };
  } catch (_) { /* fall through */ }

  /* fallback: decrypt index.html in memory — never writes anything */
  const pw = password();
  if (!pw) return null;
  let html;
  try { html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"); } catch (_) { return null; }
  const m = html.match(/const ENC = (\{[^}]*\});/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
    /* v1 or v2 (tools/payload.js); the names are in the payload itself, so media/ is not needed */
    const t = namesFromPayload(require("./payload.js").openEnc(o, pw, null, { core: true }));
    if (t.toks.size) return { ...t, via: "index.html" };
  } catch (_) { /* fall through */ }
  return null;
}

loadNames().then(res => {
  if (!res)
    die("could not build the name index, so this commit is REFUSED.\n" +
        "  A privacy guard that cannot check must not pass.\n" +
        "  Fix: run `node tools/crypt.js decrypt` (or set FT_PASSWORD), then commit again.");

  /* the private lists, where this clone has them: their names are names too */
  const priv = privateLists({ known: res.toks });
  const from = listWords(priv);

  const subjectWords = [...new Set(words(subject).filter(w => w.length >= 3))];
  const all = [...res.toks];
  const inPayload = subjectWords.filter(w => {
    if (res.toks.has(w)) return true;
    /* short forms of a longer given name. >=4 chars so "the"/"and" cannot match. */
    return w.length >= 4 && all.some(t => t.length > w.length && t.startsWith(w));
  });
  const inLabels = subjectWords.filter(w => res.labelToks.has(w) && !inPayload.includes(w));
  const inLists = [...new Set(subjectWords.filter(w => from.has(w)).concat(denyHits(subject, priv.deny)))]
    .filter(w => !inPayload.includes(w) && !inLabels.includes(w));
  const bad = inPayload.concat(inLabels, inLists);
  if (bad.length)
    die("this message carries " + bad.length + " word(s) that are a person's name: " + bad.join(", ") + "\n" +
        (inPayload.length ? "  In the payload (a card or a spouse, or the start of a given name there): " + inPayload.join(", ") + "\n" : "") +
        (inLabels.length ? "  A correspondent named in a source label: " + inLabels.join(", ") + "\n" : "") +
        (inLists.length ? "  Only on the private lists: " + inLists.map(w => listedAs(w, from.get(w) || { file: PRIVATE_FILES[0], phrase: null })).join("; ") + "\n" : "") +
        "  The repo is PUBLIC and a force-push does not take it back — GitHub keeps\n" +
        "  serving old SHAs by hash indefinitely. There is no clean way back.\n" +
        "  Fix: write a neutral mechanical line without " + (bad.length > 1 ? "those words" : "that word") +
        " (\"Update site data payload\"), commit again,\n" +
        "  and put the story in CHANGE-LOG-COMMITS.md. If the word is an ordinary one that is also\n" +
        "  somebody's name, use another word; no person is taken off a list to let a message through.\n" +
        (inLists.some(w => (from.get(w) || {}).phrase) ? "  " + NOT_A_PERSON_HINT.replace("and run this again", "and commit again") + "\n" : "") +
        "  (name index via " + res.via + (priv.files.length ? " and " + priv.files.length + " private list(s)" : "") + ")");
  process.exit(0);
}).catch(e => die("guard crashed, refusing the commit: " + e.message));
