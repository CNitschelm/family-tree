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
 *   5. the author and the committer use a noreply address
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
 * commits carry a personal address; nothing checked. A noreply address is one whose mailbox
 * part is "noreply" or "no-reply", or one at users.noreply.github.com. An address under
 * ".invalid" passes too: that ending is reserved, no such mailbox can exist, and the test
 * suites commit with one in their throwaway repositories.
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

/* Both files list people in tables, the names in bold. A bold phrase in a table row is taken
 * as a name when every word of it reads as one (capitalised words, initials, a nickname in
 * brackets) and, where `known` is given, at least one of its words is already a name in the
 * payload. That second test keeps out a bold place, heading or verdict, which would otherwise
 * put ordinary words on the list of names. Names in running text are not read: nothing there
 * says where one starts and stops. */
function namesFromTables(md, known) {
  const out = [];
  const WORD = /^(?:[\p{Lu}][\p{L}'’-]*\.?|\([\p{Lu}][\p{L}'’. -]*\)|["“][\p{Lu}][\p{L}'’. -]*["”])$/u;
  const SMALL = /^(?:de|du|des|la|le|von|van|der|den|zu)$/;
  for (const line of String(md).split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    for (const b of line.match(/\*\*([^*]+)\*\*/g) || []) {
      for (let part of b.replace(/\*\*/g, "").split(/\s*(?:→|×|·|,|;|\/|&|=|—|–|:|\band\b|\bet\b)\s*/)) {
        part = part.replace(/\s*\(?(?:[bd]\.|c\.)?\s*\d.*$/, "").trim().replace(/^["“]([^"“”]*)["”]$/, "$1");
        let toks = part.split(/\s+/).filter(Boolean);
        while (toks.length && TITLE.test(toks[0])) toks = toks.slice(1);
        if (toks.length < 2 || toks.length > 6) continue;
        if (!toks.every((t, i) => WORD.test(t) || (i > 0 && i < toks.length - 1 && SMALL.test(t)))) continue;
        /* two words at least outside any bracket, one of them more than an initial */
        const bare = words(toks.join(" ").replace(/\([^)]*\)|["“][^"”]*["”]/g, " "));
        if (bare.length < 2 || !bare.some(w => w.length > 2)) continue;
        if (known && !bare.some(w => w.length > 2 && known.has(w))) continue;
        out.push(toks.join(" "));
      }
    }
  }
  return out;
}

/* opts.dir: the folder that holds the files (default FT_PRIVATE_LISTS, then the repository root);
 * opts.known: folded name words of the payload (see namesFromTables).
 * Returns { dir, files (those found), deny, names, ci }. Nothing found is not an error. */
function privateLists(opts) {
  opts = opts || {};
  const dir = opts.dir || process.env.FT_PRIVATE_LISTS || ROOT;
  const res = { dir, files: [], deny: [], names: [], ci: false };
  if (process.env.CI || process.env.GITHUB_ACTIONS) { res.ci = true; return res; }
  const read = f => { try { const t = fs.readFileSync(path.join(dir, f), "utf8"); res.files.push(f); return t; } catch (_) { return null; } };
  const deny = read(PRIVATE_FILES[0]);
  if (deny !== null) res.deny = [...new Set(deny.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => words(l).join(" ")).filter(Boolean))];
  const names = new Set();
  for (const f of PRIVATE_FILES.slice(1)) {
    const md = read(f);
    if (md === null) continue;
    namesFromRecords(md).forEach(n => names.add(n));
    namesFromTables(md, opts.known).forEach(n => names.add(n));
  }
  res.names = [...names];
  return res;
}

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

/* Rule 5. True for an address that is nobody's mailbox. */
function noreply(email) {
  const m = String(email || "").trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return false;
  const local = m[1], host = m[2];
  return /^no-?reply$/.test(local) || host === "users.noreply.github.com" || /(?:^|\.)invalid$/.test(host);
}

if (require.main !== module) {
  module.exports = { fold, words, nameForms, labelNames, privateLists, namesFromRecords, namesFromTables,
    nameWords, denyHits, noreply, PRIVATE_FILES, LABEL_WORD_MIN };
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
 * and `git var` gives both addresses exactly as git is about to write them, an --author, a
 * -c user.email and an amend included. Called by hand with a commit id, that commit's own two
 * addresses are read. Called by hand with a message file alone, no commit is being made and
 * there is no address to check. */
{
  const commit = process.argv[3];
  const git = args => cp.execFileSync("git", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
  let who = null;
  try {
    if (commit) {
      const [ae, ce] = git(["log", "-1", "--format=%ae%x1f%ce", commit, "--"]).split("\x1f");
      who = { author: ae, committer: ce };
    } else if (process.env.GIT_INDEX_FILE || process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL) {
      const addr = v => (git(["var", v]).match(/<([^<>]*)>[^<>]*$/) || [])[1];
      who = { author: addr("GIT_AUTHOR_IDENT"), committer: addr("GIT_COMMITTER_IDENT") };
    }
  } catch (e) {
    die("could not read the author and committer of this commit, so it is REFUSED.\n" +
        "  A privacy guard that cannot check must not pass.\n" +
        "  Fix: check that `git var GIT_AUTHOR_IDENT` prints a name and an address here" +
        (commit ? " and that " + commit + " is a commit" : "") + ", then commit again.");
  }
  if (who) {
    const bad = Object.keys(who).filter(k => !noreply(who[k]));
    if (bad.length)
      die("the " + bad.join(" and the ") + " of this commit " + (bad.length > 1 ? "do" : "does") + " not use a noreply address" +
          " (" + bad.map(k => k + ": …@" + String(who[k] || "none").replace(/^.*@/, "")).join(", ") + ").\n" +
          "  An address in a commit is public and cannot be taken back.\n" +
          "  Fix: give this clone the noreply address the newest commits on main carry\n" +
          "  (git log -1 --format=%ae origin/main prints it):  git config user.email <that address>\n" +
          "  and leave out --author, GIT_AUTHOR_EMAIL and GIT_COMMITTER_EMAIL if one of them set this one.\n" +
          (commit ? "  Then, if " + commit + " is the newest commit: git commit --amend --reset-author --no-edit."
                  : "  Then commit again."));
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
  const listToks = nameWords(priv.names);
  priv.deny.forEach(d => d.split(" ").forEach(w => { if (w.length >= 3) listToks.add(w); }));

  const subjectWords = [...new Set(words(subject).filter(w => w.length >= 3))];
  const all = [...res.toks];
  const inPayload = subjectWords.filter(w => {
    if (res.toks.has(w)) return true;
    /* short forms of a longer given name. >=4 chars so "the"/"and" cannot match. */
    return w.length >= 4 && all.some(t => t.length > w.length && t.startsWith(w));
  });
  const inLabels = subjectWords.filter(w => res.labelToks.has(w) && !inPayload.includes(w));
  const inLists = [...new Set(subjectWords.filter(w => listToks.has(w)).concat(denyHits(subject, priv.deny)))]
    .filter(w => !inPayload.includes(w) && !inLabels.includes(w));
  const bad = inPayload.concat(inLabels, inLists);
  if (bad.length)
    die("this message carries " + bad.length + " word(s) that are a person's name: " + bad.join(", ") + "\n" +
        (inPayload.length ? "  In the payload (a card or a spouse, or the start of a given name there): " + inPayload.join(", ") + "\n" : "") +
        (inLabels.length ? "  A correspondent named in a source label: " + inLabels.join(", ") + "\n" : "") +
        (inLists.length ? "  On the private lists (" + priv.files.join(", ") + "): " + inLists.join(", ") + "\n" : "") +
        "  The repo is PUBLIC and a force-push does not take it back — GitHub keeps\n" +
        "  serving old SHAs by hash indefinitely. There is no clean way back.\n" +
        "  Fix: write a neutral mechanical line without " + (bad.length > 1 ? "those words" : "that word") +
        " (\"Update site data payload\"), commit again,\n" +
        "  and put the story in CHANGE-LOG-COMMITS.md. If the word is an ordinary one that is also\n" +
        "  somebody's name, use another word; the lists are not changed to let a message through.\n" +
        "  (name index via " + res.via + (priv.files.length ? " and " + priv.files.length + " private list(s)" : "") + ")");
  process.exit(0);
}).catch(e => die("guard crashed, refusing the commit: " + e.message));
