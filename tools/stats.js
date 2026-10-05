#!/usr/bin/env node
/*
 * stats.json — the site's headline numbers, public, for the project page on corynitschelm.com (5 Oct 2026).
 *
 *   node tools/stats.js          writes stats.json when a number changed (prints what changed)
 *   node tools/stats.js --check  exit 1 if stats.json is not what the data says (checks/gate.js runs it)
 *
 * NUMBERS ONLY. The file is public (GitHub Pages serves it), so it may hold counts and a date and nothing
 * else: no names, no places, no ids, no text. tests/run.js checks the shape. It is computed from the private
 * data.json, research.json and ledger/link-confidence.json, and rewritten by crypt.js encrypt, research.js
 * build and linkconf.js build, so it moves with every change that ships. "updated" only moves when a number
 * does, so an unchanged rebuild leaves git nothing to commit.
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "stats.json");
const KEYS = ["people", "generations", "recordsSince", "biographies", "citations", "sources", "records", "places", "countries",
  "pins", "links", "linksHigh", "investigations", "questionsOpen", "questionsAnswered", "researchSources"];
const readJSON = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (_) { return null; } };

function compute() {
  const d = readJSON("data.json");
  if (!d) throw new Error("no data.json (run node tools/crypt.js decrypt)");
  const all = []; (function w(p, g) { all.push([p, g]); (p.unions || []).forEach(u => (u.c || []).forEach(c => w(c, g + 1))); })(d, 1);
  const n = {};
  n.people = all.length;
  n.generations = new Set(all.map(x => x[1])).size;
  let minY = 9999;   /* as the page's own status line counts it: estimated (c.) years are not records */
  all.forEach(([p]) => { const y = p.years || ""; if (/^c\./.test(y)) return; const m = y.match(/\d{4}/); if (m) minY = Math.min(minY, +m[0]); });
  n.recordsSince = minY;
  n.biographies = all.filter(([p]) => p.profile && (p.profile.bio || []).length).length;
  /* a citation is a linked source row as a bio shows it: the card's src and profile sources merged by address */
  const norm = u => String(u).trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  const urls = new Set(); let cites = 0;
  all.forEach(([p]) => {
    const s = new Set();
    (p.src || []).forEach(x => { if (x.u) s.add(norm(x.u)); });
    ((p.profile || {}).sources || []).forEach(x => { if (x.url) s.add(norm(x.url)); });
    cites += s.size; s.forEach(u => urls.add(u));
  });
  n.citations = cites; n.sources = urls.size;
  n.records = all.reduce((a, [p]) => a + (((p.profile || {}).docs) || []).length, 0);
  const gaz = d.gaz || {};
  n.places = Object.keys(gaz).length;
  n.countries = new Set(Object.values(gaz).map(g => String(g.c || "").split(",").map(x => x.trim()).pop())
    .filter(c => c && !/ocean|sea|atlantic|pacific/i.test(c))).size;
  n.pins = all.reduce((a, [p]) => a + (p.pl || []).length, 0);
  const lc = readJSON("ledger/link-confidence.json");
  if (lc && Array.isArray(lc.links)) {
    const shown = r => r.override ? r.override.pct : r.pct;
    n.links = lc.links.length; n.linksHigh = lc.links.filter(r => shown(r) >= 90).length;
  }
  const R = readJSON("research.json");
  if (R && Array.isArray(R.investigations)) {
    n.investigations = R.investigations.length;
    const qs = R.investigations.flatMap(i => i.qs || []);
    n.questionsAnswered = qs.filter(q => q.state === "answered").length;
    n.questionsOpen = qs.length - n.questionsAnswered;
    n.researchSources = qs.reduce((a, q) => a + (q.src || []).length, 0);
  }
  return n;
}

function current() { const s = readJSON("stats.json"); return s && typeof s === "object" ? s : null; }
const same = (a, b) => KEYS.every(k => (a || {})[k] === (b || {})[k]);

function write(quiet) {
  const n = compute(), old = current();
  if (old && same(n, old)) { if (!quiet) console.log("stats.json unchanged"); return false; }
  const day = new Date().toISOString().slice(0, 10);
  const out = { v: 1, updated: day };
  KEYS.forEach(k => { if (typeof n[k] === "number") out[k] = n[k]; });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  const ch = KEYS.filter(k => (old || {})[k] !== n[k] && n[k] !== undefined).map(k => k + " " + ((old || {})[k] ?? "–") + " → " + n[k]);
  console.log("wrote stats.json (commit it): " + (ch.join(", ") || "first write"));
  return true;
}

module.exports = { compute, write, KEYS, OUT };
if (require.main === module) {
  if (process.argv.includes("--check")) {
    const n = compute(), old = current();
    if (!old || !same(n, old)) { console.error("stats.json is not what the data says — run: node tools/stats.js"); process.exit(1); }
    console.log("stats.json current");
  } else write();
}
