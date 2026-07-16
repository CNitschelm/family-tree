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

report();

})().catch(e => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
