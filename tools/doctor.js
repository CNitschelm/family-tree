#!/usr/bin/env node
/*
 * doctor — the state of this working copy, in one command. Run it FIRST, every session.
 *
 *   node tools/doctor.js
 *
 * WHY THIS EXISTS. Every session here starts cold: no memory of the last one, only these
 * files. The conditions that cost the most time are the ones a cold reader cannot see —
 * a data.json a week out of date, a git lock left by a mount that cannot unlink, an
 * index.html.new from an encrypt that died at the last step. Each has happened. Each was
 * diagnosed from scratch, more than once, because the knowledge lived in prose that gets
 * skimmed rather than in something that runs.
 *
 * SCOPE — read this before trusting a clean bill of health.
 * This checks LOCAL state only. It does NOT check:
 *   - whether the live site matches this repo  -> the deploy-verify workflow does that
 *   - whether the data is CORRECT              -> tests/run.js and checks/run.js do that
 * A green doctor means "nothing is silently broken underneath you". It does not mean
 * "safe to deploy". Do not let it stand in for looking.
 *
 * Zero dependencies. Never writes to the repo. Exit 1 if any BLOCKER is found.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = path.join(__dirname, "..");
const p = f => path.join(ROOT, f);
const findings = [];
const add = (level, title, detail, fix) => findings.push({ level, title, detail, fix });

const git = args => {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch (_) { return null; }
};
const exists = f => { try { fs.accessSync(p(f)); return true; } catch (_) { return false; } };

/* ---- 1. git locks. The mount cannot unlink, so these survive and block every write. ---- */
const locks = ["index.lock", "HEAD.lock", "config.lock", "ORIG_HEAD.lock"]
  .map(n => ".git/" + n).filter(exists);
if (locks.length) {
  add("BLOCKER", "Stale git lock file(s): " + locks.join(", "),
    "Every git write — add, commit, even some reads — will fail with \"Another git process seems to be running\". " +
    "No git process is actually running; this mount cannot unlink, so locks accumulate.",
    "rm -f " + locks.map(l => "'" + l + "'").join(" "));
}

/* ---- 2. is data.json a descendant of the index.html on disk? ---- */
if (exists("data.json")) {
  let stamp = null;
  try { stamp = fs.readFileSync(p(".data-stamp"), "utf8").trim(); } catch (_) { /* none */ }
  let cur = null;
  try {
    const m = fs.readFileSync(p("index.html"), "utf8").match(/const ENC = (\{[^}]*\});/);
    if (m) {
      const enc = JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
      cur = enc.iv + ":" + createHash("sha256").update(enc.ct).digest("hex").slice(0, 16);
    }
  } catch (_) { /* handled below */ }

  if (!cur) {
    add("BLOCKER", "index.html has no readable ENC block",
      "Either the file is truncated (this mount has capped grown files before) or it is not the site.", null);
  } else if (stamp === null) {
    add("BLOCKER", "data.json has no provenance stamp",
      "Nothing records which index.html this working copy came from, so it may be any age. " +
      "This is the exact state the repo was in on 15 Aug 2026, when data.json was 1.4 MB and a week behind the payload. " +
      "encrypt will refuse until this is resolved, and the test suites would NOT have caught it — " +
      "they check the shape of the data, not whether it is current.",
      "node tools/crypt.js decrypt   # after backing up data.json if it holds unsaved edits");
  } else if (stamp !== cur) {
    add("BLOCKER", "data.json is STALE — it came from a different index.html",
      "index.html has been re-encrypted since this working copy was made. Encrypting now would " +
      "silently revert whatever landed in the payload in between.",
      "cp data.json /tmp/data.backup.json && node tools/crypt.js decrypt   # then re-apply the edit");
  } else {
    add("OK", "data.json is current", "Descends from the index.html on disk.", null);
  }
} else {
  add("OK", "no data.json", "Nothing to go stale. decrypt when you need to edit.", null);
}

/* ---- 3. leftovers from an encrypt that died at the last step ---- */
if (exists("index.html.new")) {
  const a = fs.statSync(p("index.html.new")).size, b = exists("index.html") ? fs.statSync(p("index.html")).size : 0;
  add("WARN", "index.html.new is present (" + a + " bytes; index.html is " + b + ")",
    "encrypt stages here, then replaces index.html. A leftover means that last step did not complete. " +
    "It is gitignored, so it never reaches GitHub — but check which of the two is the one you want before deleting.",
    "Compare the two, then: rm -f index.html.new");
}

/* ---- 4. commits that exist only here ---- */
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const ahead = git(["rev-list", "--count", "@{upstream}..HEAD"]);
const behind = git(["rev-list", "--count", "HEAD..@{upstream}"]);
if (ahead && +ahead > 0) {
  add("WARN", ahead + " commit(s) not pushed",
    "They are on " + (branch || "this branch") + " locally only, so the live site cannot be showing them. " +
    "This sandbox holds no push credentials — pushing happens in GitHub Desktop.",
    "Push in GitHub Desktop (Ctrl+P), then confirm the live site actually changed.");
}
if (behind && +behind > 0) {
  add("WARN", behind + " commit(s) on the remote that are not here",
    "Someone or something else has pushed. Fetch before editing, or you will be working from an old base.",
    "git fetch && git status");
}

/* ---- 5. uncommitted tracked changes ---- */
const porcelain = git(["status", "--porcelain"]);
if (porcelain) {
  const n = porcelain.split("\n").filter(Boolean).length;
  add("INFO", n + " uncommitted change(s) in the working tree",
    porcelain.split("\n").filter(Boolean).map(l => "    " + l).join("\n"), null);
}

/* ---- 6. the secrets that must never be tracked ---- */
["data.json", ".password", ".data-stamp"].forEach(f => {
  if (!exists(f)) return;
  const tracked = git(["ls-files", "--error-unmatch", f]);
  if (tracked) {
    add("BLOCKER", f + " IS TRACKED BY GIT",
      "This file must never be committed. The repo is public and GitHub Pages serves every file in it.",
      "git rm --cached '" + f + "' and confirm .gitignore covers it BEFORE any further commit.");
  }
});

/* ---------------------------------- report ---------------------------------- */
const order = { BLOCKER: 0, WARN: 1, INFO: 2, OK: 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const count = l => findings.filter(f => f.level === l).length;

console.log("");
console.log("  doctor — local state of this working copy");
console.log("  " + "-".repeat(58));
for (const f of findings) {
  console.log("");
  console.log("  [" + f.level + "] " + f.title);
  if (f.detail) console.log(f.detail.split("\n").map(s => s.startsWith("    ") ? s : "      " + s).join("\n"));
  if (f.fix) console.log("      fix: " + f.fix);
}
console.log("");
console.log("  " + "-".repeat(58));
console.log("  " + count("BLOCKER") + " blocker, " + count("WARN") + " warning, " + count("INFO") + " note");
console.log("  NOT checked here: whether the live site matches this repo (the deploy-verify");
console.log("  workflow covers that), and whether the data is correct (tests/ and checks/ do).");
console.log("");
process.exit(count("BLOCKER") ? 1 : 0);
