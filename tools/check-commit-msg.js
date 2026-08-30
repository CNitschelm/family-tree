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
 *   4. no token that appears as a person's name anywhere in the payload
 *
 * Rule 3 is the one that actually does the work, and it is deliberately blunt.
 * The name index (rule 4) can only know people the payload lists as nodes or
 * spouses; it did NOT contain the short form of one given name
 * and does not contain a wife who has not been added to the tree yet. A rule
 * that bans mid-sentence capitals needs to know none of that — it catches any
 * proper noun, person or place or business, including ones nobody has indexed.
 * A neutral mechanical subject never needs one.
 *
 * It FAILS CLOSED. If it cannot build the name index it refuses the commit
 * rather than waving it through, because "could not check" and "checked and
 * clean" must never look the same on a privacy guard.
 *
 * Invoked by githooks/commit-msg. Wire it up with:
 *   git config core.hooksPath githooks
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("node:crypto");
const subtle = webcrypto.subtle;

const ROOT = path.join(__dirname, "..");
const MAX_LEN = 72;
const die = m => { console.error("\ncommit-msg: " + m + "\n"); process.exit(1); };

/* ---------- the message ---------- */
const msgPath = process.argv[2];
if (!msgPath) die("no message file given (the hook passes it as $1).");
const raw = fs.readFileSync(msgPath, "utf8");
const lines = raw.split(/\r?\n/)
  .filter(l => !l.startsWith("#"))          // git's own comment block
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

/* ---------- the name index ---------- */
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function namesFromPayload(data) {
  const toks = new Set();
  const add = s => String(s || "").split(/[^\p{L}]+/u).forEach(w => {
    if (w.length >= 3) { toks.add(w.toLowerCase()); toks.add(norm(w)); }
  });
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    add(n.name);
    (n.unions || []).forEach(u => { add(u.s); (u.c || []).forEach(walk); });
  })(data.tree || data.root || data);
  return toks;
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
    if (t.size) return { toks: t, via: "data.json" };
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
    const b = s => Buffer.from(s, "base64");
    const base = await subtle.importKey("raw", Buffer.from(pw, "utf8"), "PBKDF2", false, ["deriveKey"]);
    const k = await subtle.deriveKey(
      { name: "PBKDF2", salt: b(o.salt), iterations: o.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: b(o.iv) }, k, b(o.ct));
    const t = namesFromPayload(JSON.parse(Buffer.from(pt).toString("utf8")));
    if (t.size) return { toks: t, via: "index.html" };
  } catch (_) { /* fall through */ }
  return null;
}

loadNames().then(res => {
  if (!res)
    die("could not build the name index, so this commit is REFUSED.\n" +
        "  A privacy guard that cannot check must not pass.\n" +
        "  Fix: run `node tools/crypt.js decrypt` (or set FT_PASSWORD), then commit again.");

  const words = subject.split(/[^\p{L}]+/u).filter(w => w.length >= 3);
  const all = [...res.toks];
  const bad = [...new Set(words.filter(w => {
    const lw = w.toLowerCase(), nw = norm(w);
    if (res.toks.has(lw) || res.toks.has(nw)) return true;
    /* short forms of a longer given name. >=4 chars so "the"/"and" cannot match. */
    return nw.length >= 4 && all.some(t => t.length > nw.length && t.startsWith(nw));
  }))];
  if (bad.length)
    die("this message names " + bad.length + " person(s) from the payload: " + bad.join(", ") + "\n" +
        "  The repo is PUBLIC and a force-push does not take it back — GitHub keeps\n" +
        "  serving old SHAs by hash indefinitely. There is no clean way back.\n" +
        "  Use a neutral mechanical line and put the story in CHANGE-LOG-COMMITS.md.\n" +
        "  (name index via " + res.via + ")");
  process.exit(0);
}).catch(e => die("guard crashed, refusing the commit: " + e.message));
