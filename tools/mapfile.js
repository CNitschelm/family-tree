#!/usr/bin/env node
/*
 * The map's base layers, in a file of their own (3 Oct 2026).
 *
 *   node tools/mapfile.js check                 the file index.html names exists and is what its name says
 *   node tools/mapfile.js write <layers.json>   publish new base layers: map/<hash>.json + MAPFILE in index.html
 *   node tools/mapfile.js extract               one-time move of the old inline blocks (MAPGEO, MAPHI, MAPLBL)
 *                                               out of index.html into map/<hash>.json
 *
 * Why: the coastlines, borders, the detail boxes and the reference town names were 245 KB of the
 * page (123 KB over the wire), downloaded and decoded at every visit, even by visitors who never
 * open the map. Cory (2 Oct 2026): the Map's data loads only when the Map is opened. The page now
 * carries one short line, `const MAPFILE = "map/<hash>.json";`, and fetches that file the first time
 * the Map opens.
 *
 * The file is public geography, no family data (tests/run.js decodes it and checks that), so it is
 * plain JSON: {"geo": {land, bord, usst}, "hi": [{b, ms, land, lake, coast, bord, usst}], "lbl": "<records>"}.
 * Its name is a hash of its bytes, so a browser may keep it for good and a new version is a new
 * name. `write` never deletes the file it replaces: a visitor still on the old page keeps finding
 * the old file (the 1 Oct 2026 lesson). Remove a superseded file one deploy later, by hand.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");
const DIR = "map";
const LINE = /const MAPFILE = "([^"]*)";/;

const hashName = buf => DIR + "/" + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16) + ".json";

/* the layers as the page reads them; throws on anything malformed */
function validate(m) {
  const rings = s => typeof s === "string" && /^[A-Za-z0-9+/|]*$/.test(s);
  if (!m || typeof m !== "object") throw new Error("not an object");
  if (!m.geo || !["land", "bord", "usst"].every(k => rings(m.geo[k]) && m.geo[k].length)) throw new Error("geo needs land, bord and usst");
  if (!Array.isArray(m.hi) || !m.hi.length) throw new Error("hi must be a non-empty list");
  m.hi.forEach((h, i) => {
    if (!Array.isArray(h.b) || h.b.length !== 4 || !h.b.every(Number.isFinite) || !Number.isFinite(h.ms)) throw new Error("hi[" + i + "] needs b[4] and ms");
    ["land", "lake", "coast", "bord", "usst"].forEach(k => { if (h[k] !== undefined && !rings(h[k])) throw new Error("hi[" + i + "]." + k + " is not encoded rings"); });
  });
  if (typeof m.lbl !== "string" || !m.lbl.split("\t").every(r => /^[0-6][A-Za-z0-9+/]+~[^~\t]+~[A-Z]{2}$/.test(r))) throw new Error("lbl: a record is malformed");
  return m;
}
/* the exact bytes we publish for a set of layers: stable key order, no whitespace */
const serialise = m => Buffer.from(JSON.stringify({ geo: { land: m.geo.land, bord: m.geo.bord, usst: m.geo.usst },
  hi: m.hi.map(h => { const o = { b: h.b, ms: h.ms }; ["land", "lake", "coast", "bord", "usst"].forEach(k => { if (h[k] !== undefined) o[k] = h[k]; }); return o; }),
  lbl: m.lbl }), "utf8");

function publish(html, m) {
  const buf = serialise(validate(m));
  const name = hashName(buf);
  fs.mkdirSync(path.join(ROOT, DIR), { recursive: true });
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, buf);
  if (!fs.readFileSync(p).equals(buf)) throw new Error("the write to " + name + " did not land");
  return { name, bytes: buf.length };
}
function setLine(html, name) {
  if (LINE.test(html)) return html.replace(LINE, () => 'const MAPFILE = "' + name + '";');
  throw new Error("index.html has no `const MAPFILE = \"…\";` line");
}
function save(out) {
  fs.writeFileSync(HTML + ".new", out);
  if (fs.readFileSync(HTML + ".new", "utf8") !== out) throw new Error("staging write verification failed");
  fs.renameSync(HTML + ".new", HTML);
}

function check(html) {
  const m = html.match(LINE);
  if (!m) throw new Error("index.html names no map file (const MAPFILE)");
  if (!/^map\/[0-9a-f]{16}\.json$/.test(m[1])) throw new Error("MAPFILE is not map/<16 hex>.json: " + m[1]);
  const buf = fs.readFileSync(path.join(ROOT, m[1]));
  if (hashName(buf) !== m[1]) throw new Error(m[1] + " does not match its own hash (" + hashName(buf) + ")");
  validate(JSON.parse(buf.toString("utf8")));
  if (/const (MAPGEO|MAPLBL|MAPHI) = /.test(html)) throw new Error("index.html still carries an inline map block");
  return { name: m[1], bytes: buf.length };
}

/* the old page: MAPGEO and MAPLBL were top-level, MAPHI sat inside boot() */
function extract(html) {
  const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error("no " + what + " block in index.html"); return m; };
  const geoM = grab(/const MAPGEO = \{[\s\S]*?\n\};\n/, "MAPGEO");
  const lblM = grab(/const MAPLBL = "(?:[^"\\]|\\.)*";\n/, "MAPLBL");
  const hiM = grab(/const MAPHI = \[[\s\S]*?\n\];\n/, "MAPHI");
  const ev = (src, name) => vm.runInNewContext(src.replace(/^const /, "var ") + "\n" + name);
  const m = { geo: ev(geoM[0], "MAPGEO"), hi: ev(hiM[0], "MAPHI"), lbl: ev(lblM[0], "MAPLBL") };
  return { m, spans: { geo: geoM, lbl: lblM, hi: hiM } };
}

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    const html = fs.readFileSync(HTML, "utf8");
    if (cmd === "check") {
      const r = check(html);
      console.log("map file ok: " + r.name + " (" + r.bytes + " bytes)");
    } else if (cmd === "write") {
      const src = process.argv[3];
      if (!src) throw new Error("usage: node tools/mapfile.js write <layers.json>");
      const r = publish(html, JSON.parse(fs.readFileSync(src, "utf8")));
      const prev = (html.match(LINE) || [])[1];
      save(setLine(html, r.name));
      console.log("index.html now names " + r.name + " (" + r.bytes + " bytes)." +
        (prev && prev !== r.name ? " Keep " + prev + " for one more deploy; visitors on the old page still use it." : ""));
    } else if (cmd === "extract") {
      const { m, spans } = extract(html);
      const r = publish(html, m);
      console.log("wrote " + r.name + " (" + r.bytes + " bytes). Now replace the three inline blocks in index.html by hand:" +
        " MAPGEO " + spans.geo[0].length + " chars, MAPLBL " + spans.lbl[0].length + ", MAPHI " + spans.hi[0].length + ".");
    } else {
      console.error("usage: node tools/mapfile.js check | write <layers.json> | extract");
      process.exit(2);
    }
  } catch (e) { console.error("FAILED: " + e.message); process.exit(1); }
}

module.exports = { DIR, hashName, validate, serialise, check, extract, LINE };
