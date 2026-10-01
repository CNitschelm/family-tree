#!/usr/bin/env node
/*
 * Build the public DEMO of this site from THIS repo's index.html.
 *
 *   node tools/build-demo.js <demo-dir> [--out <file>] [--template <file>]
 *
 * index.html is the family build and the only template. A demo is the same file with its
 * per-build parts swapped, and every one of those parts is DATA in <demo-dir>/demo.json:
 *
 *   site      → the `const SITE = {…}` switches (storage prefix, public password, search, …)
 *   branches  → `const BRANCHES = […]`       regions → `const REGIONS = {…}`
 *   i18n      → strings to set per language (null deletes a key). Branch labels of template
 *               branches the demo does not have are dropped automatically.
 *   slots     → the <!--build:NAME-->…<!--/build:NAME--> spans in the markup. A value may pull
 *               a file in with {{include:<file>}}. Every slot in the template needs a value,
 *               and every value needs a slot: a new slot fails the build until it is decided.
 *   synced, dataNote → the SYNCED date and the comment above it
 *   maplbl    → the reference place names, one "<rank><lon><lat>~<name>~<ISO2>" record per line
 *   data, password, salt, iter → the payload: <data> encrypted as tools/crypt.js does (v2, compressed),
 *               except that every picture stays inline: the demo is one file
 *
 * The demo's config and data are NOT in this repo (it is public and GitHub Pages serves every
 * file in it); they live with the site that publishes the demo. This file carries no names and
 * no paths: the demo folder is an argument. One command rebuilds the demo — nobody hand-edits it.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("node:crypto");

/* a failed check throws; run as a command, the message is printed and the exit code is 1 */
class BuildError extends Error {}
function die(msg) { throw new BuildError(msg); }

/* The Cowork mount can serve a stale copy of a cached exact path; an unseen case variant of the
 * name bypasses it (see tests/run.js). On case-sensitive filesystems the plain name wins. */
function readFresh(file) {
  const dir = path.dirname(file), base = path.basename(file);
  const variant = () => base.split("").map(c => Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()).join("");
  let best = "";
  for (const name of [base, variant(), variant()]) {
    try {
      const t = fs.readFileSync(path.join(dir, name), "utf8");
      if (t.trimEnd().endsWith("</html>") && t.length >= best.length) best = t;
    } catch (_) { /* not present */ }
  }
  if (!best) die("no complete HTML at " + file);
  return best;
}

/* the text of a top-level `const NAME = <literal>;` whose literal closes on a line of its own */
function literalSpan(html, name, close) {
  const start = html.indexOf("const " + name + " = ");
  if (start < 0) die("template has no `const " + name + "`");
  const end = html.indexOf("\n" + close + ";", start);
  if (end < 0) die("template's `const " + name + "` is not closed by a line \"" + close + ";\"");
  return { start, end: end + 1 + close.length + 1, src: html.slice(start, end + 1 + close.length + 1) };
}
const evalLiteral = (src, name) => vm.runInNewContext(src.replace(/^const /, "var ") + "\n" + name);
const js = v => JSON.stringify(v);

/* slot markers: <!--build:NAME--> … <!--/build:NAME--> */
const SLOT = /<!--build:([a-z0-9_-]+)-->([\s\S]*?)<!--\/build:\1-->/g;

function build(template, cfg, dir) {
  let html = template;
  const file = f => { const p = path.join(dir, f); if (!fs.existsSync(p)) die("missing " + f + " in the demo folder"); return fs.readFileSync(p, "utf8"); };
  const include = v => String(v).replace(/\{\{include:([^}]+)\}\}/g, (_, f) => file(f.trim()).replace(/\s+$/, ""));

  /* 1. slots — both directions must match, so a new one is a decision, not a silent default */
  const inTemplate = new Set([...html.matchAll(SLOT)].map(m => m[1]));
  const inConfig = new Set(Object.keys(cfg.slots || {}));
  [...inTemplate].forEach(k => { if (!inConfig.has(k)) die("the template has a slot \"" + k + "\" the demo config does not fill"); });
  [...inConfig].forEach(k => { if (!inTemplate.has(k)) die("the demo config fills a slot \"" + k + "\" the template does not have"); });
  const defaults = {};
  html = html.replace(SLOT, (_, k, dflt) => { defaults[k] = dflt; return include(cfg.slots[k]); });

  /* 2. SITE — the demo must decide every switch the template has */
  const site = literalSpan(html, "SITE", "}");
  const tSite = evalLiteral(site.src, "SITE");
  const want = Object.keys(tSite).sort().join(), got = Object.keys(cfg.site || {}).sort().join();
  if (want !== got) die("SITE switches differ — template: " + want + " / demo config: " + got);
  html = html.slice(0, site.start) + "const SITE = " + js(cfg.site) + ";" + html.slice(site.end);
  if (cfg.site.search === false) html = html.replace(/<html lang="en"( class="[^"]*")?>/, '<html lang="en" class="nosearch">');

  /* 3. BRANCHES and REGIONS */
  const br = literalSpan(html, "BRANCHES", "]");
  const tBranches = evalLiteral(br.src, "BRANCHES");
  const B = cfg.branches;
  if (!Array.isArray(B) || !B.length || !B[0].trunk || B.filter(b => b.trunk).length !== 1) die("branches: the first entry, and only it, must be the trunk");
  B.forEach(b => { if (!b.key || !b.id || !/^--[a-z0-9-]+$/.test(b.color || "")) die("branches: every entry needs key, id and a --color property"); });
  const css = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join("\n");
  const block = sel => (css.match(new RegExp("(^|\\n)" + sel + "\\{[^}]*\\}")) || [""])[0];
  B.forEach(b => ["html\\.dark", ":root"].forEach(sel => {
    if (!new RegExp(b.color + ":#[0-9A-Fa-f]{6}\\b").test(block(sel))) die("branches: " + b.color + " has no colour in " + sel.replace(/\\/g, ""));
  }));
  html = html.slice(0, br.start) + "const BRANCHES = [\n" + B.map(b => "  " + js(b)).join(",\n") + "\n];" + html.slice(br.end);
  const rg = literalSpan(html, "REGIONS", "}");
  const tRegions = evalLiteral(rg.src, "REGIONS");
  if (Object.keys(tRegions).join() !== Object.keys(cfg.regions || {}).join()) die("regions: the demo needs the template's region keys, in order: " + Object.keys(tRegions).join());
  html = html.slice(0, rg.start) + "const REGIONS = {\n" + Object.entries(cfg.regions).map(([k, v]) => "  " + k + ": " + js(v)).join(",\n") + "\n};" + html.slice(rg.end);

  /* 4. strings */
  const i18 = literalSpan(html, "I18N", "}");
  const I18N = evalLiteral(i18.src, "I18N");
  const dropped = tBranches.map(b => b.key).filter(k => !B.some(b => b.key === k));
  for (const lang of Object.keys(I18N)) {
    dropped.forEach(k => delete I18N[lang][k]);
    Object.entries((cfg.i18n || {})[lang] || {}).forEach(([k, v]) => { if (v === null) delete I18N[lang][k]; else I18N[lang][k] = v; });
  }
  const langs = Object.keys(I18N);
  const keysOf = l => Object.keys(I18N[l]).sort().join();
  if (langs.some(l => keysOf(l) !== keysOf(langs[0]))) die("i18n: the languages no longer carry the same keys");
  B.forEach(b => langs.forEach(l => { if (typeof I18N[l][b.key] !== "string") die("i18n: branch \"" + b.key + "\" has no " + l + " label"); }));
  /* a build that opens itself with a public password says so on its lock screen, in its own words */
  if (cfg.site.autoPw) ["pwopening", "pwdemo"].forEach(k => langs.forEach(l => {
    if (typeof I18N[l][k] !== "string" || !I18N[l][k].trim()) die("i18n: a build with a public password needs a \"" + k + "\" string in " + l);
  }));
  html = html.slice(0, i18.start) + "const I18N = {\n" + langs.map(l => "  " + l + ":" + js(I18N[l])).join(",\n") + "\n};" + html.slice(i18.end);

  /* 5. data date and note */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.synced || "")) die("synced must be YYYY-MM-DD");
  html = html.replace(/\/\* -{16} DATA \([^\n]*\) -{16} \*\/\nconst SYNCED = "\d{4}-\d{2}-\d{2}";/,
    () => "/* ---------------- DATA (" + cfg.dataNote + ") ---------------- */\nconst SYNCED = \"" + cfg.synced + "\";");
  if (!html.includes('const SYNCED = "' + cfg.synced + '";')) die("could not set SYNCED");

  /* 6. reference place names: one record per line in the file, tab-joined in the page */
  const recs = file(cfg.maplbl).split(/\r?\n/).filter(Boolean);
  if (!recs.every(r => /^[0-6][A-Za-z0-9+/]+~[^~\t]+~[A-Z]{2}$/.test(r))) die("maplbl: a record is malformed");
  const lbl = html.match(/const MAPLBL = "(?:[^"\\]|\\.)*";/);
  if (!lbl) die("template has no MAPLBL line");
  html = html.replace(lbl[0], () => "const MAPLBL = " + js(recs.join("\t")) + ";");
  return { html, defaults };
}

async function encrypt(html, cfg, dir) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, cfg.data), "utf8"));
  /* the payload must fit the branches: every head anchored once, every card's branch listed */
  const all = []; (function walk(p, br) { const b = p.branch || br; all.push({ p, b }); (p.unions || []).forEach(u => (u.c || []).forEach(c => walk(c, b))); })(data, "legacy");
  if (!all.some(x => x.p.anchor === "trunk")) die("data: no card carries the anchor \"trunk\"");
  cfg.branches.filter(b => !b.trunk).forEach(b => { if (all.filter(x => x.p.anchor === b.key).length !== 1) die("data: branch \"" + b.key + "\" is not exactly one anchor"); });
  all.forEach(x => { if (!cfg.branches.some(b => b.id === x.b)) die("data: a card's branch \"" + x.b + "\" is not in branches"); });
  const salt = cfg.salt || Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const iter = cfg.iter || 600000;
  /* tools/payload.js: v2, compressed; split:false keeps every picture inline — the demo is one file */
  const sealed = require("./payload.js").sealData(data, cfg.password, { salt, iter, split: false });
  if (!/const ENC = \{[^\n]*\};/.test(html)) die("template has no ENC line");
  return { html: html.replace(/const ENC = \{[^\n]*\};/, () => sealed.line), iv: sealed.enc.iv, people: count(data) };
}
function count(p) { let n = 1; (p.unions || []).forEach(u => (u.c || []).forEach(c => { n += count(c); })); return n; }

/* what must hold for any output — checked before anything is written */
function verify(out, defaults, cfg) {
  const m = out.match(/<script>([\s\S]*)<\/script>/);
  if (!m) die("output has no script");
  try { new Function(m[1]); } catch (e) { die("output script does not parse: " + e.message); }
  /* nothing of the family build may survive in the demo: not its title, not its site link */
  Object.entries(defaults).forEach(([k, d]) => {
    const t = d.replace(/<[^>]+>/g, "").trim();
    if (t.length >= 8 && !String(cfg.slots[k]).includes(t) && out.includes(t)) die("the template's \"" + k + "\" text is still in the output: " + t.slice(0, 40));
  });
  /* no emoji in the controls or in any string (a tour line once carried one) */
  const PICT = /\p{Extended_Pictographic}/u;
  const body = out.slice(out.indexOf("<body>"), out.indexOf("<script>"));
  const chrome = body.slice(body.indexOf('<div id="topbar">'), body.indexOf('<div id="intro">'));
  if (chrome && PICT.test(chrome)) die("an emoji is in the controls' markup");
  const i18src = m[1].slice(m[1].indexOf("const I18N = {"), m[1].indexOf("\n};", m[1].indexOf("const I18N = {")) + 3);
  const I18N = vm.runInNewContext(i18src.replace(/^const /, "var ") + "\nI18N");
  Object.keys(I18N).forEach(l => Object.entries(I18N[l]).forEach(([k, v]) => { if (PICT.test(String(v))) die("i18n " + l + "." + k + " carries an emoji"); }));
  const surname = (defaults.title || "").replace(/<[^>]+>/g, "").trim().split(/\s+/)[0];
  if (surname && surname.length >= 4 && new RegExp("(?<![A-Za-z])" + surname + "(?![a-z])", "i").test(out))
    die("the family's name \"" + surname + "\" appears in the demo output — give that string a demo value in demo.json");
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const dir = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out" && args[args.indexOf(a) - 1] !== "--template");
    if (!dir) die("usage: node tools/build-demo.js <demo-dir> [--out <file>] [--template <file>]");
    const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const cfgPath = path.join(dir, "demo.json");
    if (!fs.existsSync(cfgPath)) die("no demo.json in " + dir);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const template = readFresh(opt("--template") || path.join(__dirname, "..", "index.html"));
    const { html, defaults } = build(template, cfg, dir);
    const enc = await encrypt(html, cfg, dir);
    verify(enc.html, defaults, cfg);
    const out = opt("--out") || path.join(dir, cfg.out || "index.html");
    fs.writeFileSync(out, enc.html);
    const back = fs.readFileSync(out, "utf8");
    if (back !== enc.html) die("the written file does not read back identical");
    console.log("demo built: " + out + " — " + Buffer.byteLength(enc.html) + " bytes, " + enc.people + " people, iv " + enc.iv);
  })().catch(e => { console.error("build-demo: " + (e instanceof BuildError ? e.message : (e.stack || e.message))); process.exit(1); });
}

module.exports = { build, encrypt, verify, SLOT };
