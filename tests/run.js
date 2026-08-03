#!/usr/bin/env node
/*
 * Regression suite for the Nitschelm family-tree site.
 * Zero dependencies — run with:  node tests/run.js
 *
 * DATA is AES-encrypted inside index.html. The suite decrypts it using the
 * FT_PASSWORD env var or the git-ignored .password file at the repo root.
 * Without a password it still runs the HTML/syntax checks and exits 0.
 *
 * Every data/logic test corresponds to a bug that actually occurred, or an
 * invariant the page depends on. If you rename the section comments in
 * index.html, update the anchors in grab() calls below.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.join(__dirname, "..");

/* Cowork's sandbox mount can serve a stale cached copy of index.html; a
 * never-before-seen case variant of the name bypasses that cache (Windows
 * filesystems are case-insensitive). On case-sensitive CI/Linux the variants
 * simply don't exist and we fall back to the plain name. */
function caseVariant(name) {
  return name.split("").map(c => Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()).join("");
}
let html = "";
for (const name of ["index.html", caseVariant("index.html"), caseVariant("index.html")]) {
  try {
    const t = fs.readFileSync(path.join(ROOT, name), "utf8");
    if (t.trimEnd().endsWith("</html>") && t.length >= html.length) html = t;
  } catch (_) { /* not present on case-sensitive filesystems */ }
}
if (!html) { console.error("FATAL: no complete index.html found"); process.exit(1); }

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.error("  FAIL " + name); }
}
function section(t) { console.log("\n== " + t + " =="); }
function report() {
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

(async () => {

/* ---------- 1. HTML integrity ---------- */
section("HTML integrity");
ok(html.trimEnd().endsWith("</html>"), "file is complete (ends with </html>)");
ok(html.includes('<meta charset="UTF-8">'), "charset declared");
ok(html.includes('href="favicon.png"'), "favicon is a local file");
ok(fs.existsSync(path.join(ROOT, "favicon.png")), "favicon.png exists in repo");
ok(!/i0\.wp\.com|corynitschelm\.com\/wp-content/.test(html), "no hot-linked wp.com assets");
ok(html.includes('target="_blank"'), "footer link opens new tab");
ok(html.includes("html.dark{"), "dark palette defined");
ok(html.includes('id="theme"'), "theme toggle button present");
ok(!/color:#fff\b/.test(html.match(/<style>[\s\S]*<\/style>/)[0].replace(/#hint[^}]*}|\.badge[^}]*}|\.jumps[^}]*}/g, "")),
  "no hardcoded white text outside chips/hint (dark-mode safe)");

section("Encryption envelope");
ok(html.includes("const ENC = {"), "encrypted DATA envelope present");
ok(!html.includes("const DATA = {"), "no plaintext DATA in the page");
ok(!/Nitschelm", years:"/.test(html), "no person records leak outside the ciphertext");
ok(html.includes('id="lock"'), "lock screen present");
ok(html.includes("function boot(DATA)"), "app boots only after decryption");
ok(!/p\.name==="/.test(html), "no person-name literals in the plaintext UI layer");
ok(!/\d{4}–\d{4}/.test(html), "no lifespan literals in the plaintext UI layer");

/* ---------- 2. Script extraction + syntax ---------- */
section("Script syntax");
const mScript = html.match(/<script>([\s\S]*)<\/script>/);
ok(!!mScript, "script tag found");
if (!mScript) report();
const js = mScript[1];
let syntaxOk = true;
try { new Function(js); } catch (e) { syntaxOk = false; console.error("   " + e.message); }
ok(syntaxOk, "whole script parses (new Function)");

/* ---------- 3. Decrypt DATA ---------- */
section("Decrypt DATA");
let PW = (process.env.FT_PASSWORD || "").trim();
if (!PW) { try { PW = fs.readFileSync(path.join(ROOT, ".password"), "utf8").trim(); } catch (_) {} }
if (!PW) {
  console.log("  --  no password available (FT_PASSWORD / .password) — skipping data & logic tests");
  report();
}
const encM = js.match(/const ENC = (\{[^}]*\});/);
ok(!!encM, "ENC parseable");
const ENC = JSON.parse(encM[1].replace(/(\w+):/g, '"$1":'));
const b = s => Buffer.from(s, "base64");
let dataJson;
try {
  const km = await webcrypto.subtle.importKey("raw", Buffer.from(PW), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b(ENC.iv) }, key, b(ENC.ct));
  dataJson = Buffer.from(pt).toString("utf8");
} catch (e) {
  ok(false, "decryption with configured password");
  report();
}
ok(true, "decryption with configured password");

/* ---------- 4. Build vm context: decrypted DATA + extracted logic ---------- */
function grab(start, end) {
  const i = js.indexOf(start);
  if (i < 0) throw new Error("anchor not found: " + start);
  const j = js.indexOf(end, i);
  if (j < 0) throw new Error("anchor not found: " + end);
  return js.slice(i, j);
}
let ctxSrc;
try {
  ctxSrc = [
    grab("const SYNCED", "/* ---------------- Access"), // constants + i18n
    "const DATA = " + dataJson + ";",
    grab("let idc = 0;", "/* expand a node"),           // build()
    grab("function openRun", "/* generation ruler"),    // filters/visibility
    grab("function esc(", "const BC"),                  // esc()
    grab("const BC =", "\nfunction render"),            // branch colors
    grab("const norm", "function renderSuggest"),       // search
    grab("function noteText", "function showTip"),      // notes
  ].join("\n");
} catch (e) {
  console.error("  FAIL section extraction: " + e.message);
  fail++;
  report();
}
const ctx = { console };
vm.createContext(ctx);
vm.runInNewContext(ctxSrc, ctx);
const get = expr => vm.runInNewContext(expr, ctx);
const allNodes = get("allNodes"), root = get("root");
const initView = get("initView"), setOpenFromFilters = get("setOpenFromFilters");
const activeFilters = get("activeFilters"), searchMatches = get("searchMatches");
const T = get("T"), I18N = get("I18N"), SYNCED = get("SYNCED");
const esc = get("esc"), BC = get("BC"), noteText = get("noteText");
const openAll = get("openAll"), AV = get("AV"), BRANCH_HEADS = get("BRANCH_HEADS");
const visChildren = get("(n)=> n.open ? n.children.filter(c=>!visSet || visSet.has(c.id)) : []");

function visCount() {
  let c = 0;
  (function w(n) { c++; visChildren(n).forEach(w); })(root);
  return c;
}
function subtreeSize(n) { let c = 0; (function w(x) { c++; x.children.forEach(w); })(n); return c; }
function depth(n) { let d = 0, a = n; while (a.parent) { d++; a = a.parent; } return d; }

/* ---------- 5. Data invariants ---------- */
section("Data invariants");
ok(allNodes.length >= 108, "tree has >= 108 people (" + allNodes.length + ")");
ok(allNodes.every(n => BC[n.branch]), "every person has a known branch color");
ok(allNodes.every(n => n.p.name && typeof n.p.name === "string"), "every person has a name");
ok(/^\d{4}-\d{2}-\d{2}$/.test(SYNCED), "SYNCED is YYYY-MM-DD (" + SYNCED + ")");
/* anchors: branch navigation ids live INSIDE the encrypted data */
ok(["trunk", "fr", "east", "west", "schw"].every(a => allNodes.some(n => n.p.anchor === a)),
  "all 5 navigation anchors present in encrypted data");
ok(["fr", "east", "west", "schw"].every(k => BRANCH_HEADS[k]), "branch heads resolve via anchors");
/* people are referenced structurally, never by name, to keep this file PII-free */
const creator = allNodes.find(n => /creator of this website/i.test(n.p.note || ""));
ok(!!creator, "site-creator credit exists");
ok(creator && /^data:image\/(jpeg|png|webp);base64,/.test(creator.p.img || ""), "creator's photo embedded as data URI");
ok(allNodes.every(n => !n.p.img || /^data:image\//.test(n.p.img)), "all photos embedded (none reference repo files)");
ok(allNodes.some(n => /circus/i.test(n.p.note || "")), "family lore preserved");
ok(!allNodes.some(n => n.p.tag === "you"), "no 'you' tag (site is for the whole family)");
/* profiles: bio pages carried inside the encrypted payload */
const profiled = allNodes.filter(n => n.p.profile);
ok(profiled.length >= 1, "at least one profile exists (" + profiled.length + ")");
ok(profiled.every(n => {
  const pr = n.p.profile;
  return Array.isArray(pr.bio) && pr.bio.length &&
         Array.isArray(pr.bio_fr) && pr.bio_fr.length === pr.bio.length;
}), "profile bios are bilingual, paragraph for paragraph");
ok(profiled.every(n => (n.p.profile.timeline || []).every(t => t.y && t.t && t.t_fr)),
  "profile timeline entries bilingual");
ok(profiled.every(n => (n.p.profile.links || []).every(l => /^https:\/\//.test(l.url))),
  "profile links are https");
/* THE STANDARD: every bio must cite its sources (url optional — e.g. family correspondence) */
ok(profiled.every(n => {
  const s = n.p.profile.sources;
  return Array.isArray(s) && s.length > 0 && s.every(x => x.label && (!x.url || /^https:\/\//.test(x.url)));
}), "every profile cites at least one source");
/* THE STANDARD, extended: every PERSON carries card-level sources (src array in the payload).
   url optional (family records); when present it must be http(s). */
ok(allNodes.every(n => Array.isArray(n.p.src) && n.p.src.length > 0), "every person has at least one card source");
ok(allNodes.every(n => (n.p.src || []).every(s => s.l && typeof s.l === "string" && (!s.u || /^https?:\/\//.test(s.u)))),
  "card sources well-formed (label required, url http(s) when present)");
/* corrected-base architecture: the payload IS the up-to-date tree; _legacy holds reversions */
const DL = get("DATA")._legacy;
ok(!!DL && DL.vals && DL.phantom && DL.phantomParent, "_legacy block present (vals + phantom + parent key)");
ok(!!(DL.banner && DL.banner_fr && DL.lbanner && DL.lbanner_fr), "_legacy banners bilingual (diff + legacy view)");
ok(Object.keys(DL.vals).every(k => allNodes.some(n => ((n.p.years||"")+"|"+(n.p.name||"")) === k)),
  "every _legacy reversion key resolves to a person in the corrected base");
ok(allNodes.some(n => n.p.years === "1729–1804") && !allNodes.some(n => n.p.years === "1734–1804"),
  "base carries the corrected West keystone years (1729–1804, no 1734)");
ok(!allNodes.some(n => n.p.years === "1713–?" && n.p.anchor === "west"),
  "the superseded 1713 bridge person is gone from the corrected base");
ok(allNodes.filter(n => n.p._g26).length === 2 && allNodes.filter(n => n.p._n26).length === 50,
  "provenance tags: 2 grafted-chain people, 50 post-original additions (messages + register children)");
ok(allNodes.every(n => n.p.g === "f" || n.p.g === "m"),
  "every person carries a sex field (genogram avatar shapes)");
/* original-document images shown inside bios: embedded, captioned and transcribed in both languages */
const docPeople = allNodes.filter(n => n.p.profile && n.p.profile.docs);
const docCount = docPeople.reduce((a, n) => a + n.p.profile.docs.length, 0);
ok(docPeople.length >= 10 && docCount >= 20,
  "documents embedded in bios (" + docCount + " images on " + docPeople.length + " people)");
/* the family bible and the two Amboy gravestones are family-supplied: no URL, but still transcribed */
const bibleDocs = allNodes.filter(n => n.p.profile && n.p.profile.docs)
  .flatMap(n => n.p.profile.docs).filter(d => !d.u);
ok(bibleDocs.length >= 6 && bibleDocs.every(d => d.tr && d.tr_fr),
  "family-supplied images (bible, gravestones, 1907 photo) are transcribed too (" + bibleDocs.length + ")");
ok(docPeople.every(n => n.p.profile.docs.every(d =>
  /^data:image\/(jpeg|png);base64,/.test(d.img || "") && d.cap && d.cap_fr && d.tr && d.tr_fr &&
  (!d.u || /^https:\/\//.test(d.u)))),
  "each document has an embedded image, bilingual caption + transcription, https source");
/* bilingual data: every English note must carry a French translation */
ok(allNodes.every(n => !n.p.note || (n.p.note_fr && n.p.note_fr.length > 0)),
  "every person note has a French translation");
ok(allNodes.every(n => (n.p.unions || []).every(u => !u.n || (u.n_fr && u.n_fr.length > 0))),
  "every union note has a French translation");
/* commentary like "Married into the X family" is fine; a NAMED spouse in a
 * note ("Remarried Kathleen…", "first wife Anne…") belongs on the card */
ok(allNodes.every(n => !/(re)?married\s+[A-Z]|\b(wife|husband|spouse)\s+[A-ZÉ]/.test(n.p.note || "")),
  "no marriages hidden in notes — they belong on cards as unions");

/* ---------- 6. Descendant counts (pill labels) ---------- */
section("Descendant counts");
vm.runInNewContext(
  "(function cnt(n){ n.desc=n.children.length; n.children.forEach(c=>{cnt(c); n.desc+=c.desc;}); })(root)", ctx);
ok(root.desc === allNodes.length - 1, "root.desc === everyone else (" + root.desc + ")");

/* ---------- 7. Filters (regression: 'east shows too many cards') ---------- */
section("Filters");
initView();
const legacyN = visCount();
ok(activeFilters.size === 1 && activeFilters.has("legacy"), "default = legacy only");
ok(legacyN > 5 && legacyN < 20, "legacy shows the trunk (" + legacyN + ")");

activeFilters.delete("legacy"); activeFilters.add("east"); setOpenFromFilters();
const eastHead = BRANCH_HEADS.east;
const expectEast = subtreeSize(eastHead) + depth(eastHead);
ok(visCount() === expectEast,
  "east-only = branch + direct line only, no sibling heads (" + visCount() + " = " + expectEast + ")");

activeFilters.add("legacy");
["fr", "west", "schw"].forEach(k => activeFilters.add(k));
setOpenFromFilters();
ok(visCount() === allNodes.length, "legacy + all branches = whole tree");

["legacy", "fr", "east", "west", "schw"].forEach(k => activeFilters.delete(k));
setOpenFromFilters();
ok(visCount() === 1, "all filters off = root only");
initView();
ok(visCount() === legacyN, "reset restores default view");

/* ---------- 8. Search (regressions: accents, duplicates) ----------
 * All queries are DERIVED from the decrypted data at runtime so this
 * committed file contains no names. */
section("Search");
const norm = get("norm");
const accented = allNodes.find(n => norm(n.p.name) !== n.p.name.toLowerCase());
ok(!!accented, "data contains accented names to test with");
if (accented) {
  const word = accented.p.name.split(" ").find(w => norm(w) !== w.toLowerCase());
  ok(searchMatches(norm(word)).length >= 1, "accent-stripped query finds accented name");
  ok(searchMatches(norm(word)).length === searchMatches(word).length, "accented query = plain query");
}
const seen = {}; let dupName = null;
for (const n of allNodes) { if (seen[n.p.name]) { dupName = n.p.name; break; } seen[n.p.name] = 1; }
ok(!!dupName, "data contains duplicate display names to test with");
if (dupName) {
  const res = searchMatches(norm(dupName));
  ok(res.length >= 2, "duplicate names all returned (years disambiguate)");
}
const surname = norm(root.p.name.split(" ").pop());
ok(searchMatches(surname).length === 8, "results capped at 8");

/* partial, out-of-order, middle-name-skipping queries must still land the person:
   "<first> <first 3 of surname>" has to find "<first> <middle> <surname>" */
const threePart = allNodes.find(n => n.p.name.split(" ").length >= 3);
ok(!!threePart, "data contains a three-part name to test with");
if (threePart) {
  const parts = threePart.p.name.split(" ").map(norm);
  const q = parts[0] + " " + parts[parts.length - 1].slice(0, 3);   /* first name + start of surname */
  ok(searchMatches(q).some(r => r.n.p.name === threePart.p.name),
    "partial query skipping the middle name finds the person");
  const rev = parts[parts.length - 1].slice(0, 4) + " " + parts[0].slice(0, 3); /* reversed order */
  ok(searchMatches(rev).some(r => r.n.p.name === threePart.p.name),
    "words in any order still match");
}
ok(searchMatches("   ").length === 0, "whitespace-only query returns nothing");
ok(searchMatches("zzzz").length === 0, "no false positives");
let anySpouse = null;
outer: for (const n of allNodes) for (const u of (n.p.unions || [])) if (u.s) { anySpouse = u.s; break outer; }
ok(!!anySpouse && searchMatches(norm(anySpouse)).some(r => r.via === anySpouse),
  "spouse matches report the spouse");

/* ---------- 9. i18n ---------- */
section("i18n");
ok(Object.keys(I18N.en).sort().join() === Object.keys(I18N.fr).sort().join(), "en/fr key parity");
ok(T("nomatch") === "No match", "T() resolves");
ok(typeof T("pwmsg") === "string" && T("pwbtn") && T("pwerr"), "lock screen strings present");
ok(T("definitely_missing_key") === "definitely_missing_key", "T() falls back to key, never undefined");

/* ---------- 10. Card rendering simulation (regression: TDZ broke all cards) ---------- */
section("Card build simulation");
let built = 0, notes = 0;
let buildErr = null;
try {
  allNodes.forEach(n => {
    // mirrors the expressions in render() — order matters (TDZ regression)
    const cls = "node";
    const p = n.p;
    let sp = "";
    (p.unions || []).forEach(u => { if (u.s) sp += esc(u.s) + (u.sy ? esc(u.sy) : "") + (u.div ? "1" : ""); });
    const badge = p.tag === "author" ? T("author") : p.tag === "emig" ? "USA" : p.tag === "mem" ? "m" : "";
    const pill = n.children.length ? ("+" + n.children.length + (n.desc > n.children.length ? " → " + n.desc : "")) : "";
    const ni = "i"; /* marker always in template; visibility is a DOM-time decision */
    const s = cls + badge + esc(p.name) + esc(p.years || "") + ni + sp + pill + (p.img || AV);
    if (!s) throw new Error("empty card");
    built++; if (noteText(n)) notes++;
  });
} catch (e) { buildErr = e; }
ok(!buildErr, "all cards build without runtime errors" + (buildErr ? " — " + buildErr.message : ""));
ok(built === allNodes.length, "built " + built + "/" + allNodes.length + " cards");
ok(notes >= 25, "note tooltips present (" + notes + " cards)");
ok(esc('<a b="c">&') === "&lt;a b=&quot;c&quot;&gt;&amp;", "esc() escapes HTML");

/* ---------- 11. Uniform card height ---------- */
section("Layout");
const PILL_H = 20; // desktop
const heights = allNodes.map(n => {
  const sp = (n.p.unions || []).filter(u => u.s).length;
  return 42 + Math.min(sp, 2) * 14 + (sp > 2 ? 14 : 0) + PILL_H;
});
ok(Math.max(...heights) === 90, "uniform height source = 90px (two-marriage cards)");
ok(new Set(allNodes.map(n => n.gen)).size >= 13, "generations computed");

/* ---------- 12. Map view ---------- */
section("Map view");
ok(/const MAPGEO = \{/.test(html), "basemap geometry present in the plaintext layer");
ok(html.includes('id="mapview"') && html.includes('id="mapcanvas"'), "map view markup present");
ok(!/\bMAPGEO\b[\s\S]{0,400}?(Nitschelm|Gunsbach|Amboy)/.test(html),
  "basemap block carries no family place names");
{
  /* the encoder is delta + zig-zag base64 varints; decode it here the same way
     the page does, so a change to either side fails loudly */
  const IDX = {}; "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    .split("").forEach((c, i) => IDX[c] = i);
  const geoSrc = html.match(/const MAPGEO = \{[\s\S]*?\n\};/)[0];
  const MAPGEO = vm.runInNewContext(geoSrc + " MAPGEO");
  const decode = str => str.split("|").map(r => {
    const pts = []; let i = 0, x = 0, y = 0, c, v, sh;
    while (i < r.length) {
      v = 0; sh = 0; do { c = IDX[r[i++]]; v |= (c & 31) << sh; sh += 5; } while (c & 32);
      x += (v & 1) ? -((v + 1) >>> 1) : (v >>> 1);
      v = 0; sh = 0; do { c = IDX[r[i++]]; v |= (c & 31) << sh; sh += 5; } while (c & 32);
      y += (v & 1) ? -((v + 1) >>> 1) : (v >>> 1);
      pts.push([x / 1000, y / 1000]);
    }
    return pts;
  });
  const land = decode(MAPGEO.land);
  const all = land.flat();
  ok(land.length > 200, "basemap decodes to " + land.length + " land rings");
  ok(all.every(([lo, la]) => lo >= -180.5 && lo <= 180.5 && la >= -90 && la <= 90),
    "every decoded coordinate is a real lon/lat");
  ok(decode(MAPGEO.usst).length > 20, "US state borders decode");

  /* the reference place-name layer: what keeps a zoomed-in view from being blank */
  const MAPLBL = vm.runInNewContext(html.match(/const MAPLBL = "[\s\S]*?";/)[0] + " MAPLBL");
  const recs = MAPLBL.split("\t");
  ok(recs.length > 3000, "reference place labels present (" + recs.length + ")");
  let lx = 0, ly = 0; const pts = [];
  for (const rec of recs) {
    let i = 1, v, sh, c;
    v = 0; sh = 0; do { c = IDX[rec[i++]]; v |= (c & 31) << sh; sh += 5; } while (c & 32);
    lx += (v & 1) ? -((v + 1) >>> 1) : (v >>> 1);
    v = 0; sh = 0; do { c = IDX[rec[i++]]; v |= (c & 31) << sh; sh += 5; } while (c & 32);
    ly += (v & 1) ? -((v + 1) >>> 1) : (v >>> 1);
    const parts = rec.slice(i).split("~");
    pts.push({ r: +rec[0], lon: lx / 1000, lat: ly / 1000, n: parts[1], cc: parts[2] });
  }
  ok(pts.every(p => p.r >= 0 && p.r <= 6 && p.n && p.cc &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180), "every reference label decodes to a real point");
  const near = (lo, la, d) => pts.filter(p => Math.abs(p.lon - lo) < d && Math.abs(p.lat - la) < d).length;
  ok(near(7.17, 48.03, 0.4) >= 4, "the Munster valley has towns to orient by");
  ok(near(-122.44, 45.92, 0.6) >= 4, "the Amboy country has towns to orient by");
  ok(near(-88.84, 41.35, 0.6) >= 4, "the Ottawa country has towns to orient by");
  ok(near(-70.76, 43.07, 0.5) >= 4, "the Portsmouth country has towns to orient by");
  ok(!/Nitschelm|Schweitzer/.test(MAPLBL), "reference labels carry no family names");
}

/* gazetteer + place trails live INSIDE the ciphertext, like every other fact */
const DATA = get("DATA");
const GAZ = DATA.gaz || {};
const gazKeys = Object.keys(GAZ);
ok(gazKeys.length > 100, "gazetteer has " + gazKeys.length + " places");
ok(gazKeys.every(k => {
  const g = GAZ[k];
  return g && typeof g.lat === "number" && typeof g.lon === "number" &&
    Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180;
}), "every gazetteer entry has valid coordinates");
ok(gazKeys.every(k => GAZ[k].n && GAZ[k].n_fr), "gazetteer names bilingual");
ok(gazKeys.every(k => GAZ[k].c !== undefined && GAZ[k].c_fr !== undefined),
  "gazetteer contexts bilingual");
ok(!/gaz:\s*\{|"lat":/.test(html.replace(/const ENC = \{[\s\S]*?\};/, "")),
  "no gazetteer leaks outside the ciphertext");

const placed = allNodes.filter(n => (n.p.pl || []).length);
const rows = placed.flatMap(n => n.p.pl);
ok(placed.length >= 90, placed.length + " people carry a place trail");
ok(rows.length >= 380, rows.length + " place-events recorded");
{ /* the presence audit: a pin must be somewhere the PERSON was, not merely a
     place associated with them. These specific rows were removed after review
     and must not creep back in. */
  const banned = ["73:work:newmexico", "131:arrival:valdemunster", "11:work:bellecour",
    "11:work:perrache", "7:residence:montbeliard", "10:work:strietmuhle", "65:death:keenenh",
    "102:work:pfaffenhoffen", "148:arrival:chicago", "150:arrival:chicago",
    "57:residence:valdemunster", "97:residence:strasbourg", "62:residence:shrewsbury",
    "112:emigration:lehavre", "114:work:washington", "155:work:munster"];
  const held = new Set();
  allNodes.forEach((n, i) => (n.p.pl || []).forEach(r => held.add(i + ":" + r.t + ":" + r.k)));
  const back = banned.filter(b => held.has(b));
  ok(!back.length, "pins removed by the presence audit have not returned" + (back.length ? " — " + back.join(", ") : ""));
}
ok(rows.every(r => GAZ[r.k]), "every place-event resolves to a gazetteer entry");
ok(rows.every(r => ["doc", "inf", "apx"].includes(r.c)), "every place-event states its certainty");
ok(rows.every(r => /^(birth|baptism|marriage|residence|emigration|arrival|military|work|study|death|burial)$/.test(r.t)),
  "every place-event has a known type");
ok(rows.every(r => r.y == null || (r.y > 1400 && r.y < 2100)), "place-event years are plausible");
ok(rows.every(r => r.y2 == null || r.y == null || r.y2 >= r.y), "place-event spans never run backwards");
ok(placed.every(n => n.p.pl.every((r, i, a) => i === 0 || (r.y == null || a[i-1].y == null || r.y >= a[i-1].y)),
  ), "place trails are in chronological order");
ok(rows.every(r => !r.w || r.w_fr), "pin notes bilingual");
{ /* An undated row used to be ordered by its EVENT TYPE, which put one man's
     current city second in his trail, ahead of two universities he left years
     earlier. Trails must read as a life: nothing after the death but a burial,
     and no person may end up with a trail that is entirely undated. */
  const late = [];
  placed.forEach(n => {
    const pl = n.p.pl, di = pl.findIndex(r => r.t === "death");
    if (di < 0) return;
    /* a second death row is a disclosed alternative reading, not a drift */
    pl.slice(di + 1).forEach(r => {
      if (r.t !== "burial" && r.t !== "death" && !r.x) late.push(n.p.name + ": " + r.t + "@" + r.k);
    });
  });
  ok(!late.length, "no place-event is ordered after the person's death" + (late.length ? " — " + late.join(", ") : ""));
  const undated = placed.filter(n => n.p.pl.length > 1 && n.p.pl.every(r => r.y == null));
  ok(!undated.length, "no multi-stop trail is left entirely undated" +
    (undated.length ? " — " + undated.map(n => n.p.name).join(", ") : ""));
  /* attending a school is "study"; being paid by one is "work" */
  const named = k => (GAZ[k].n + " " + GAZ[k].c).toLowerCase();
  const uni = rows.filter(r => /universit|institute of technology|dartmouth|northwestern/.test(named(r.k)));
  ok(uni.length && uni.every(r => ["study", "work"].includes(r.t)),
    uni.length + " university pins, each typed study or work");
}
ok(rows.filter(r => r.c !== "doc" || r.x).every(r => r.w),
  "every uncertain or conflicting pin explains itself");
ok(allNodes.every(n => !n.p.mn || n.p.mn_fr), "person map notes bilingual");
{ /* the default view shows one pin per person, at their birthplace, so every
     mapped person must resolve to exactly one "home" row */
  const home = n => {
    const r = n.p.pl || [];
    return r.find(x => x.t === "birth" && !x.x) || r.find(x => x.t === "baptism" && !x.x)
        || r.find(x => !x.x) || r[0] || null;
  };
  ok(placed.every(n => home(n)), "every mapped person resolves to one home place");
  const withBirth = placed.filter(n => ["birth","baptism"].includes(home(n).t)).length;
  ok(withBirth >= 80, withBirth + " of " + placed.length + " home pins are an actual birth or baptism");
  const homes = new Set(placed.map(n => home(n).k));
  ok(homes.size >= 25, "birthplaces span " + homes.size + " distinct locations");
}
{
  const perType = {};
  rows.forEach(r => perType[r.t] = (perType[r.t] || 0) + 1);
  ok(Object.keys(perType).length >= 8, "place-events span " + Object.keys(perType).length + " event types");
  const conflicts = allNodes.filter(n => (n.p.pl || []).some(r => r.x));
  ok(conflicts.length >= 1, conflicts.length + " people disclose a conflicting place rather than picking one");
}
{ /* the map's i18n keys must exist in both languages, like every other string */
  const need = ["view_tree", "view_map", "map_nodate", "map_alt", "map_c_doc", "map_c_inf", "map_c_apx",
                "map_e_birth", "map_e_death", "map_e_burial", "map_e_study", "map_legend", "profile_viewmap",
                "map_stopof", "map_of", "map_c_n", "map_c_se", "map_c_nw",
                "map_living", "map_deceased", "map_est", "map_none",
                "map_births", "map_nobirth"];
  ok(need.every(k => I18N.en[k] && I18N.fr[k]), "map strings present in en and fr");
}

report();

})().catch(e => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
