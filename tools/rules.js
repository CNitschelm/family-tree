#!/usr/bin/env node
/*
 * rules.js — the generated block of standing rules in CLAUDE.md (R-0762, 17 Nov 2026).
 *
 *   node tools/rules.js [check]   compare CLAUDE.md's block with what the register makes
 *   node tools/rules.js write     rewrite the block (the text between the two markers, nothing else)
 *   node tools/rules.js list      every live rule entry and what it becomes in the block
 *   options: --json   --file <CLAUDE.md>   --register <register.jsonl>   --no-names (skip the name index)
 *
 * Exit codes: 0 current (or written); 1 the block is behind the register; 2 a defect (in CLAUDE.md or in an
 * entry's line, or a block line naming an id the register never had; write then changes nothing, though it does
 * replace a block whose only fault is such a line); 3 no register here (CI, a bare checkout, the airlock): nothing is
 * compared, the block's own shape is still checked, and a defect there is still 2.
 *
 * WHY. CLAUDE.md is read by every session and every subagent, and it is public. It holds the rules that must
 * never be broken by hand, and a short line for every other standing rule of the register (the entries of kind
 * "rule"). The register is private and governs; this file keeps the public list in step with it.
 *
 * WHAT IT READS from an entry: id, kind, superseded_by, area and line, nothing else. `line` is one of:
 *   - a sentence: the entry's public line, printed in the block under its area;
 *   - "hand": CLAUDE.md's hand-written part states the rule and must cite the id;
 *   - "with R-xxxx": that entry's line carries this rule too, and lists both ids.
 * An entry of kind rule with no `line` is left out of the block and listed (a NOTE, never a failure). A
 * superseded entry (superseded_by set) is never printed, and the hand-written part may not cite it.
 *
 * PUBLIC. CLAUDE.md is a tracked file of a public repository, served by GitHub Pages. A line may carry
 * an id and a neutral sentence only. publicLine() refuses: more than one line, under 20 or over 130
 * characters, a tab, a backtick, an address (http, @); a capitalised word but the first and PUBLIC_CAPS; a
 * number of three digits or more (a year, an act number); a month's name; a card id but c001; and, where
 * the name index can be had (data.json and the private lists, as tools/check-commit-msg.js reads them), a
 * word of four letters or more that is a person's name word. tests/run.js section 14 reads CLAUDE.md again.
 * Its output names ids, areas and public lines only, never a ruling, a topic or an entry's private rule text;
 * in CI a failing word is not printed (CI logs are public), only the id and the check it failed.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.env.FT_ROOT || path.join(__dirname, "..");
const BEGIN = "<!-- rules:begin: written by node tools/rules.js write; do not edit by hand -->";
const END = "<!-- rules:end -->";
const AREAS = [["scope", "Who goes on the tree"], ["privacy", "Privacy"], ["sources", "Sources and citations"],
  ["grades", "Grades and link figures"], ["wording", "Wording"], ["cards", "Cards and the map"],
  ["research", "Research"], ["process", "Process"], ["publishing", "Publishing"]];
const HEADS = new Set(AREAS.map(a => "### " + a[1]));
/* The capitalised words a line may carry besides its first. Widening this list is a privacy decision, as
 * widening ALLOW in tests/run.js is: none of these is a person but the owner, whose name is public already. */
const PUBLIC_CAPS = new Set(["Cory", "Cory's", "Claude", "English", "French", "France", "GitHub", "Research"]);
/* "may" is left out: it is an everyday word here ("may stay"), and a month written as a date has a capital */
const MONTH = /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/i;
const ID = /^R-\d{4,}$/;
const CITED = /\bR-(?:\d{4,}|N\d+)\b/g;
const ITEM = /^- (R-\d{4,}(?:, R-\d{4,})*): (.*)$/;
const CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

/* ------------------------------------------------------------------ the public check of one line */
/* index: { words: Set of folded name words, deny: [folded deny lines], publicWords: [] } or null.
 * Returns the problems, each { check, word? }; an empty list is a pass. */
function publicLine(text, index) {
  const out = [], t = String(text == null ? "" : text);
  const add = (check, word) => out.push(word === undefined ? { check } : { check, word });
  if (/[\r\n]/.test(t)) add("one line");
  if (t.length < 20 || t.length > 130) add("20 to 130 characters");
  if (/\t/.test(t)) add("no tab");
  if (/`/.test(t)) add("no backtick");
  if (/https?:|www\.|@/i.test(t)) add("no address");
  const toks = t.match(/[\p{L}][\p{L}'’-]*/gu) || [];
  toks.slice(1).forEach(w => {
    const bare = w.replace(/[-'’]+$/, "");
    if (/^\p{Lu}/u.test(bare) && !PUBLIC_CAPS.has(bare.replace(/’/g, "'"))) add("capitalised word", bare);
  });
  (t.match(/\d{3,}/g) || []).forEach(n => add("number of three digits or more", n));
  const mo = t.match(MONTH); if (mo) add("month name", mo[0]);
  (t.match(/\bc\d{3,}\b/gi) || []).filter(c => c.toLowerCase() !== "c001").forEach(c => add("card id", c));
  if (index) {
    const N = require("./check-commit-msg.js");
    const pub = new Set(index.publicWords || N.PUBLIC_WORDS);
    [...new Set(N.words(t))].filter(w => w.length >= 4 && !pub.has(w) && index.words.has(w)).forEach(w => add("name word", w));
    N.denyHits(t, index.deny || []).forEach(w => add("name word", w));
  }
  return out;
}
const say = p => p.check + (p.word && !CI ? ' "' + p.word + '"' : "");

/* the name index, as the commit hook builds it from data.json and the private lists; null when it cannot */
function nameIndex(dataFile) {
  let N, d;
  try { N = require("./check-commit-msg.js"); d = JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch (_) { return null; }
  const names = [], labels = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.name) names.push(n.name);
    (n.src || []).forEach(x => { if (x && typeof x.l === "string") labels.push(x.l); });
    (n.unions || []).forEach(u => { if (u.s) names.push(u.s); (u.c || []).forEach(walk); });
  })(d.tree || d.root || d);
  const w = N.nameWords(names, null, 4);
  N.nameWords(N.labelNames(labels), w, N.LABEL_WORD_MIN);
  const priv = N.privateLists({ known: w });
  for (const x of N.listWords(priv).keys()) if (x.length >= 4) w.add(x);
  return w.size ? { words: w, deny: priv.deny, publicWords: N.PUBLIC_WORDS, lists: priv.files.length } : null;
}

/* ------------------------------------------------------------------ the file */
function parseFile(text) {
  const lines = String(text).split("\n");
  const defects = [];
  const b = lines.map((l, i) => l.startsWith("<!-- rules:begin") ? i : -1).filter(i => i >= 0);
  const e = lines.map((l, i) => l.startsWith("<!-- rules:end") ? i : -1).filter(i => i >= 0);
  if (b.length !== 1 || e.length !== 1 || b[0] > e[0]) {
    defects.push({ check: "markers", msg: `the file needs exactly one begin and one end marker, in that order (found ${b.length} and ${e.length})` });
    return { ok: false, defects };
  }
  if (lines[b[0]] !== BEGIN || lines[e[0]] !== END) defects.push({ check: "markers", msg: "a marker line is not written as rules.js writes it" });
  const block = lines.slice(b[0] + 1, e[0]);
  const hand = lines.slice(0, b[0] + 1).concat(lines.slice(e[0])).join("\n");
  const seen = new Set(), items = [];
  block.forEach((l, i) => {
    if (HEADS.has(l)) return;
    const m = ITEM.exec(l);
    if (!m) { defects.push({ check: "form", msg: `block line ${i + 1} is neither an area heading nor "- R-dddd: text"` }); return; }
    const ids = m[1].split(", ");
    ids.forEach(id => { if (seen.has(id)) defects.push({ check: "duplicate", msg: `${id} is in the block twice` }); seen.add(id); });
    publicLine(m[2], null).forEach(p => defects.push({ check: "public", msg: `${ids[0]}: its line fails the public check (${say(p)})` }));
    items.push({ ids, text: m[2] });
  });
  return { ok: true, lines, begin: b[0], end: e[0], block, hand, items, defects };
}

/* ------------------------------------------------------------------ the register */
function readRegister(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split("\n").filter(l => l.trim() && !l.startsWith("//")).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`register line ${i + 1} is not JSON`); }
  });
}
const live = r => r && r.kind === "rule" && !r.superseded_by;

/* What the register makes: the block's lines, each live rule entry's state, and the defects of the lines. */
function build(entries, index, hand) {
  const byId = new Map(entries.map(r => [r.id, r]));
  const states = [], defects = [], own = new Map();
  for (const r of entries.filter(live)) {
    const L = typeof r.line === "string" ? r.line.trim() : r.line;
    const st = { id: r.id, area: r.area || "" };
    if (L === undefined || L === null || L === "") { st.state = "none"; st.why = "no line field"; }
    else if (typeof L !== "string") { st.state = "none"; st.why = "line is not text"; defects.push({ check: "line", msg: `${r.id}: its line is not text` }); }
    else if (L === "hand") st.state = "hand";
    else if (/^with /.test(L)) {
      st.state = "with"; st.with = L.slice(5).trim();
      const o = byId.get(st.with);
      if (!ID.test(st.with) || !live(o)) defects.push({ check: "with", msg: `${r.id}: "with ${st.with}" names an entry that is not a live rule` });
      else if (typeof o.line !== "string" || o.line === "hand" || /^with /.test(o.line) || !o.line.trim())
        defects.push({ check: "with", msg: `${r.id}: "with ${st.with}" names an entry with no line of its own` });
    } else {
      st.state = "line"; st.line = L;
      const p = publicLine(L, index);
      if (p.length) { st.problems = p.map(say); p.forEach(x => defects.push({ check: "public", msg: `${r.id}: its line fails the public check (${say(x)})` })); }
      if (!AREAS.some(a => a[0] === st.area)) defects.push({ check: "area", msg: `${r.id}: area "${st.area}" is not one of ${AREAS.map(a => a[0]).join(", ")}` });
      if (!ID.test(r.id)) defects.push({ check: "id", msg: `an entry with a line has an id not of the form R-dddd` });
      own.set(r.id, { ids: [r.id], area: st.area, text: L });
    }
    states.push(st);
  }
  states.filter(s => s.state === "with" && own.has(s.with)).forEach(s => own.get(s.with).ids.push(s.id));
  const items = [...own.values()].map(o => ({ ...o, ids: [o.ids[0], ...o.ids.slice(1).sort()] }));
  const lines = [];
  for (const [area, head] of AREAS) {
    const these = items.filter(o => o.area === area).sort((a, b) => a.ids[0] < b.ids[0] ? -1 : 1);
    if (these.length) lines.push("### " + head, ...these.map(o => `- ${o.ids.join(", ")}: ${o.text}`));
  }
  if (hand !== undefined) {
    const cited = new Set(String(hand).match(CITED) || []);
    states.filter(s => s.state === "hand" && !cited.has(s.id))
      .forEach(s => defects.push({ check: "hand", msg: `${s.id} is marked hand, and CLAUDE.md's hand-written part does not cite it` }));
    [...cited].sort().forEach(id => {
      const r = byId.get(id);
      if (!r) defects.push({ check: "hand", msg: `CLAUDE.md's hand-written part cites ${id}, which is not in the register` });
      else if (r.superseded_by) defects.push({ check: "hand", msg: `CLAUDE.md's hand-written part cites ${id}, which is superseded by ${r.superseded_by}` });
    });
  }
  return { lines, items, states, defects };
}

/* ------------------------------------------------------------------ one run */
function run(mode, opts) {
  opts = opts || {};
  const L = (() => { try { return require("./ledger.js"); } catch (_) { return null; } })();
  const file = opts.file || path.join(ROOT, "CLAUDE.md");
  const regFile = opts.register || path.join(L ? L.LEDGER : path.join(ROOT, "ledger"), "register.jsonl");
  const res = { mode, exit: 0, defects: [], notes: [], behind: null, states: [] };
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { res.exit = 2; res.defects.push({ check: "file", msg: `no ${path.basename(file)} at ${file}` }); return res; }
  const F = parseFile(text);
  /* write replaces the block, so what is wrong inside the old one does not stop it; the markers do */
  res.defects.push(...F.defects.filter(d => mode !== "write" || d.check === "markers"));
  let reg;
  try { reg = readRegister(regFile); } catch (e) { res.exit = 2; res.defects.push({ check: "register", msg: e.message }); return res; }
  if (!reg) {
    res.notes.push("no register here: the block's shape was checked, nothing was compared with the register");
    res.exit = res.defects.length ? 2 : 3;
    return res;
  }
  const index = opts.names === false ? null : nameIndex(L ? L.DATA : path.join(ROOT, "data.json"));
  if (!index && opts.names !== false) res.notes.push("no name index here (no data.json): the lines were checked without it");
  const G = build(reg, index, F.ok ? F.hand : undefined);
  res.states = G.states;
  res.defects.push(...G.defects);
  const out = G.states.filter(s => s.state === "none");
  if (out.length) res.notes.push(`left out of the block, no line yet: ${out.map(s => s.id).join(", ")}`);
  if (mode === "list") { res.exit = 0; return res; }
  if (!F.ok) { res.exit = 2; return res; }
  const want = G.lines.join("\n"), have = F.block.join("\n");
  if (want !== have) {
    const key = it => it.ids.join(", ") + ": " + it.text;
    const wantBy = new Map(G.items.map(it => [it.ids[0], key(it)])), haveBy = new Map(F.items.map(it => [it.ids[0], key(it)]));
    res.behind = {
      add: [...wantBy.keys()].filter(k => !haveBy.has(k)),
      drop: [...haveBy.keys()].filter(k => !wantBy.has(k)),
      change: [...wantBy.keys()].filter(k => haveBy.has(k) && haveBy.get(k) !== wantBy.get(k)),
    };
  }
  /* register entries are never deleted, so a block line naming an id the register never had was written by hand */
  if (mode !== "write") {
    const known = new Set(reg.map(r => r.id));
    F.items.forEach(it => it.ids.filter(id => !known.has(id)).forEach(id => res.defects.push({ check: "block", msg: `the block names ${id}, which is not in the register: the block is written only by node tools/rules.js write` })));
  }
  if (res.defects.length) { res.exit = 2; return res; }
  if (mode === "write") {
    if (res.behind) {
      const nl = F.lines.slice(0, F.begin + 1).concat(G.lines, F.lines.slice(F.end));
      fs.writeFileSync(file, nl.join("\n"));
      res.written = true;
    }
    res.exit = 0;
    return res;
  }
  res.exit = res.behind ? 1 : 0;
  return res;
}

function report(res) {
  const b = res.behind;
  if (res.mode === "list")
    res.states.forEach(s => console.log(`  ${s.id}  ${s.area.padEnd(10)} ${s.state === "line" ? "line  " + s.line : s.state === "with" ? "with  " + s.with : s.state === "hand" ? "hand" : "none  (" + s.why + ")"}`));
  res.defects.forEach(d => console.log("  DEFECT  " + d.msg));
  if (b && res.mode !== "write" && !res.defects.length) {
    const parts = [b.add.length && "to add: " + b.add.join(", "), b.drop.length && "to drop: " + b.drop.join(", "),
      b.change.length && "to change: " + b.change.join(", ")].filter(Boolean);
    console.log("  BEHIND  CLAUDE.md's rule block is not what the register makes (" + (parts.join("; ") || "headings or order") + "): run node tools/rules.js write");
  }
  res.notes.forEach(n => console.log("  NOTE  " + n));
  const live = res.states.length;
  const word = { 0: res.mode === "write" ? (res.written ? "written" : "already current") : res.mode === "list" ? "listed" : "current", 1: "behind", 2: res.mode === "write" ? "refused, nothing written" : "defect", 3: "no register" }[res.exit];
  console.log(`rules: ${word}` + (live ? ` (${live} live rule entries: ${["line", "hand", "with", "none"].map(k => res.states.filter(s => s.state === k).length + " " + k).join(", ")})` : ""));
}

module.exports = { publicLine, parseFile, build, run, readRegister, nameIndex, BEGIN, END, AREAS, PUBLIC_CAPS };

if (require.main === module) {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const mode = a.find(x => ["check", "write", "list"].includes(x)) || "check";
  const res = run(mode, { file: opt("--file"), register: opt("--register"), names: a.includes("--no-names") ? false : undefined });
  if (a.includes("--json")) console.log(JSON.stringify({ mode: res.mode, exit: res.exit, behind: res.behind, written: !!res.written,
    defects: res.defects, notes: res.notes, entries: res.states }, null, 1));
  else report(res);
  process.exit(res.exit);
}
