#!/usr/bin/env node
/*
 * doctor — the state of this working copy, in one command. Run it at the start of every session, after
 * tools/cloud-setup.sh and the writer lock (setup runs it once itself, and stops on a blocker).
 *
 *   . ~/.ft-env && node tools/doctor.js
 *
 * WHY THIS EXISTS. Every session here starts cold: no memory of the last one, only these
 * files. The conditions that cost the most time are the ones a cold reader cannot see —
 * a data.json a week out of date, a git lock left by a mount that cannot unlink, an
 * index.html.new from an encrypt that died at the last step. Each has happened. Each was
 * diagnosed from scratch, more than once, because the knowledge lived in prose that gets
 * skimmed rather than in something that runs.
 *
 * SCOPE — read this before trusting a clean bill of health.
 * This checks LOCAL state only (with one exception: it reads the airlock's last sign of life from GitHub,
 * because an old copy of that would raise a false alarm; out of reach, it says nothing). It does NOT check:
 *   - whether the live site matches this repo  -> the deploy-verify workflow does that
 *   - whether the data is CORRECT              -> tests/run.js and checks/run.js do that
 * A green doctor means "nothing is silently broken underneath you". It does not mean
 * "safe to deploy". Do not let it stand in for looking.
 *
 * Zero dependencies. Never writes to the repo. Exit 1 if any BLOCKER is found.
 *
 *   node tools/doctor.js --data-current    prints nothing; exit 0 when data.json descends from the index.html
 *                                          on disk (check 2 below), 1 when not. tools/cloud-finish.sh asks this
 *                                          before it rebuilds the archive's source list from data.json.
 * FT_ROOT (tests): the working copy to look at, instead of the one this file sits in.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");

const ROOT = process.env.FT_ROOT || path.join(__dirname, "..");
const p = f => path.join(ROOT, f);
const findings = [];
const add = (level, title, detail, fix) => findings.push({ level, title, detail, fix });

const git = args => {
  /* GIT_OPTIONAL_LOCKS=0: `git status` otherwise writes .git/index.lock, which the mount cannot
   * unlink — the very lock this tool warns about, created by the tool itself. */
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim(); }
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
const dataStamp = () => { try { return fs.readFileSync(p(".data-stamp"), "utf8").trim(); } catch (_) { return null; } };
const pageStamp = () => {   /* the payload's identity, as tools/crypt.js stamps it */
  try {
    const m = fs.readFileSync(p("index.html"), "utf8").match(/const ENC = (\{[^}]*\});/);
    if (!m) return null;
    const enc = JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
    return enc.iv + ":" + createHash("sha256").update(enc.ct).digest("hex").slice(0, 16);
  } catch (_) { return null; }
};
if (process.argv.includes("--data-current")) {
  const cur = pageStamp();
  process.exit(exists("data.json") && cur !== null && dataStamp() === cur ? 0 : 1);
}
if (exists("data.json")) {
  const stamp = dataStamp();
  const cur = pageStamp();

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

/* ---- 4. commits that exist only here ----
 * A cloud session's site commits go into the queue (family-tree-private's branch site-queue, which
 * tools/cloud-setup.sh fetches as refs/remotes/queue/site-queue); the airlock publishes them. */
/* The platform's own end-of-turn check (outside this project) compares the branch with origin/<branch> and asks
 * to push whatever is ahead. Local main is ahead of origin/main for as long as commits wait in the queue, which
 * is the normal state; a push would publish them around the airlock (16 Nov 2026). */
const PLATFORM = n => "NOTE: the platform may say there are " + n + " unpushed commit(s) on branch 'main' and ask to push them: do not. " +
  "Never run git push in the site clone; site commits leave this machine only through tools/cloud-finish.sh, " +
  "and the airlock publishes them.";
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const ahead = git(["rev-list", "--count", "@{upstream}..HEAD"]);
const behind = git(["rev-list", "--count", "HEAD..@{upstream}"]);
const queue = git(["rev-parse", "-q", "--verify", "refs/remotes/queue/site-queue"]);
const unqueued = queue ? git(["rev-list", "--count", queue + "..HEAD"]) : ahead;
if (ahead && +ahead > 0 && unqueued !== null && +unqueued === 0) {
  add("INFO", ahead + " commit(s) queued, not public yet",
    "They are in the queue (family-tree-private's branch site-queue). The airlock checks them and publishes " +
    "them within about two hours; its verdict is in family-tree-private's branch airlock-status.\n" + PLATFORM(ahead), null);
} else if (ahead && +ahead > 0) {
  add("WARN", (unqueued || ahead) + " commit(s) neither pushed nor queued",
    "They are on " + (branch || "this branch") + " locally only, so the live site cannot be showing them.\n" + PLATFORM(ahead),
    "bash tools/cloud-finish.sh \"<one neutral line>\" \"<who>\" (it queues them, and the airlock publishes them; " +
    "never run git push in the site clone). A change to code, tests, tools or documents is not for the queue: " +
    "it goes out only from a session with Cory there. Once the airlock has published, confirm the live site changed.");
}
/* Is the airlock running at all (16 Nov 2026)? Every run of it leaves a heartbeat on family-tree-private's
 * branch airlock-heartbeat, the quiet runs too; tools/cloud-lib.sh's ft_heartbeat reads it from GitHub as it is
 * now (a copy fetched at setup would be hours old by itself in a long session) and ft_heartbeat_old says when
 * its age means the airlock has stopped (cloud-setup.sh warns with the same two). It is read once here, for
 * the two findings below. null: no bash, no private clone, or no heartbeat branch yet. { unread: true }: GitHub
 * out of reach, a broken file, or a time that lies ahead of now. Neither is ever a failure. */
const LIB = path.join(__dirname, "cloud-lib.sh");
const PRIV = process.env.FT_PRIVATE_DIR || path.join(ROOT, "..", "family-tree-private");
const heartbeat = (() => {
  if (!fs.existsSync(LIB) || !fs.existsSync(PRIV)) return null;
  let out = "";
  try {
    out = execFileSync("bash", ["-c", '. "$1" && url="$(git -C "$2" remote get-url origin)" || exit 0; rc=0; h="$(ft_heartbeat "$url")" || rc=$?; echo "$rc"; [ "$rc" = 0 ] || exit 0; ' +
      'read -r hh at o <<< "$h"; echo "$h"; if ft_heartbeat_old "$hh"; then echo old; else echo fresh; fi; ft_heartbeat_means "$o"; echo "$FT_AIRLOCK_START"',
      "doctor", LIB, PRIV], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
  } catch (_) { return { unread: true }; }
  const l = out.split("\n");
  if (l[0] === "1" || l[0] === "") return null;
  const m = l[0] === "0" && (l[1] || "").match(/^([0-9.]+) (\S+) (\S+)$/);
  if (!m || !/^(old|fresh)$/.test(l[2] || "")) return { unread: true };
  return { hours: m[1], at: m[2], outcome: m[3], old: l[2] === "old", means: l[3] || "", start: l[4] || "" };
})();
/* A queue that has waited (16 Nov 2026). The airlock's verdict changes only when it checks a queue, so the
 * verdict alone cannot tell an airlock that has stopped from one that ran and did not publish: the heartbeat
 * above can, and this warning is worded by it, as cloud-setup.sh words its twin. (Until the review of 16 Nov
 * 2026 it said "it has missed a run or has stopped" whatever the heartbeat showed, against setup's own words.)
 * tools/cloud-lib.sh's ft_queue_wait works the wait out from the refs as they were last fetched (the one
 * implementation; cloud-setup.sh warns with it too). No bash, or no private clone beside this one: no
 * finding, never a failure. */
(() => {
  if (!queue || !fs.existsSync(LIB) || !fs.existsSync(PRIV)) return;
  let out = "";
  try {
    out = execFileSync("bash", ["-c", '. "$1" && w="$(ft_queue_wait "$2" "$3")" && read -r h n how <<< "$w" && ft_queue_late "$h" && echo "$w"',
      "doctor", LIB, ROOT, PRIV], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) { return; }
  const m = out.match(/^([0-9.]+) (\d+) (queued|committed)$/);
  if (!m) return;
  const hb = heartbeat && !heartbeat.unread ? heartbeat : null;
  const lately = m[3] === "committed" ? " (When the commit was queued is not in this clone's history; if that was only lately, this is nothing.)" : "";
  const verdict = "read the airlock's verdict (git -C \"" + PRIV + "\" fetch -q origin airlock-status && git -C \"" + PRIV +
    "\" show FETCH_HEAD:status.json) and the runs in family-tree-airlock's Actions; ";
  add("WARN", "the queue's " + m[2] + " commit(s) are still not published: the oldest was " + m[3] + " " + m[1] + " hours ago",
    (hb && !hb.old ? "The airlock is running: its last run was " + hb.hours + " hours ago and left \"" + hb.outcome + "\" (" + hb.means + "). So it ran and did not publish them."
     : hb ? "The airlock seems to have stopped: its last sign of life is " + hb.hours + " hours old (the next warning says what to do)."
     : "The airlock runs every two hours, so it has missed a run or has stopped.") + lately +
    " Nothing is lost while they wait, and this session may go on: new work queues on top.",
    verdict + (hb && !hb.old ? "say in this session's report that the queue has waited this long though the airlock is running, so Cory looks at it."
                             : "say in this session's report that the airlock is late, so Cory looks at it."));
})();
/* An old heartbeat is a warning whatever the queue holds: work queued later would wait too. */
if (heartbeat && !heartbeat.unread && heartbeat.old) {
  add("WARN", "the airlock's last sign of life is " + heartbeat.hours + " hours old (" + heartbeat.at + ", \"" + heartbeat.outcome + "\")",
    "It is due every two hours and leaves one at every run, so it has stopped, or GitHub has skipped several runs in a row. " +
    "Until it runs again nothing queued is checked or published. This session may go on: its site work queues and waits.",
    heartbeat.start + ".");
}
if (behind && +behind > 0) {
  add("WARN", behind + " commit(s) on the remote that are not here",
    "The airlock has published newer work, or a session with Cory has pushed. Do not edit from this base.",
    "before writing: bash tools/cloud-lock.sh take \"<who>\" \"<what>\" (it brings this clone up to the newest published " +
    "or queued commit and rebuilds data.json); to read only: bash tools/cloud-setup.sh again");
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

/* ---- 7. the change loop (OPERATING.md): ledger, lock, gate ---- */
if (!exists("ledger/register.jsonl") || !exists("ledger/changes.jsonl")) {
  add("WARN", "no ledger/ — the change loop cannot run",
    "ledger/register.jsonl (settled questions) and ledger/changes.jsonl (every applied change) are missing.",
    "Do not edit data.json until they are restored; see OPERATING.md.");
} else {
  /* The writer lock, as this clone last saw it (ledger/LOCK is family-tree-private's; bash tools/cloud-lock.sh
   * status reads it as GitHub has it now). The commands are cloud-lock.sh's: it pushes the lock, so other
   * sessions see it, and puts FT_WHO in ~/.ft-env, so tools/change.js, tools/research.js and the gate know the
   * holder. tools/lock.js alone does neither: until 16 Nov 2026 this advice named it, and a session that
   * followed it would hold a lock nobody else could see, and could not write under it. */
  try {
    const lock = fs.readFileSync(p("ledger/LOCK"), "utf8").trim();
    if (lock && lock !== "free") {
      const l = JSON.parse(lock);
      const hours = (Date.now() - Date.parse(l.since)) / 3600e3;
      const TAKE = 'bash tools/cloud-lock.sh take "<who>" "<what>"';
      const mine = !!process.env.FT_WHO && process.env.FT_WHO === l.who;
      if (hours > 12)
        add("WARN", `ledger/LOCK held by "${l.who}" for ${hours.toFixed(1)} h: over 12 hours, so it no longer counts`, l.what || "",
          (mine ? "this session's own lock ran out; to go on writing, take it again: " : "to write, take it: ") + TAKE +
          " (a lock this old is simply taken: no --steal, and not node tools/lock.js, which neither pushes the lock nor sets FT_WHO)");
      else if (mine)
        add("INFO", `ledger/LOCK held by this session ("${l.who}") for ${hours.toFixed(1)} h`, l.what || "",
          "bash tools/cloud-finish.sh \"<one neutral line>\" \"" + l.who + "\" releases it when the work is saved; it runs out after 12 hours");
      else
        add("INFO", `ledger/LOCK held by "${l.who}" for ${hours.toFixed(1)} h`, l.what || "",
          "another session is writing: wait for it (bash tools/cloud-lock.sh status reads the lock as GitHub has it now). " +
          "If this session took it, FT_WHO is not set in this shell: start the command with  . ~/.ft-env &&  " +
          "(each command runs in a shell of its own, which does not read that file by itself). " +
          "Only if that session is gone: " + TAKE + " --steal");
    }
  } catch (_) { /* no lock file: free */ }
  if (exists("index.html") && git(["diff", "--name-only", "HEAD", "--", "index.html"])) {
    let stamp = "";
    try { stamp = fs.readFileSync(p(".gate-stamp"), "utf8").split("\n")[0].trim(); } catch (_) {}
    const m = fs.readFileSync(p("index.html"), "utf8").match(/const ENC = \{v:\d+, iter:\d+, salt:"[^"]*", iv:"([^"]*)"/);
    if (!m || stamp !== m[1]) add("INFO", "index.html has changed and the gate has not passed on it",
      "The commit hook will refuse it until it does.", "node checks/gate.js");
  }
}

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
