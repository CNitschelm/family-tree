#!/usr/bin/env node
/*
 * Build the public DEMO of this site from THIS repo's index.html.
 *
 *   node tools/build-demo.js <demo-dir> [--out <file>] [--template <file>] [--readable]
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
 *   maplbl    → the reference place names, one "<rank><lon><lat>~<name>~<ISO2>" record per line. The map's
 *               layers are the template's coastlines and borders with these names, written as map/<hash>.json
 *               beside the page and fetched on the first Map open, as the family page fetches its own.
 *   data, password, salt, iter → the payload: <data> sealed as tools/crypt.js seals the family's (tools/payload.js
 *               v3): the page holds what the tree's cards show, and everything else (bios, notes, places, every
 *               bio picture and record) is in media/<id>.bin files beside it. Without a salt in demo.json the
 *               salt of the page already in the output folder is kept, so a rebuild of the same data writes the
 *               same media files.
 *   research  → when site.research is true: a made-up research file for the demo's own invented people
 *               (tools/research.js's format; card ids from <data>), sealed under the demo's password as
 *               media/research.bin and media/research-cards.bin. With site.research false the Research tab is hidden.
 *   (Play's history notes, HISTFILE, and its coronation, PLAY_HERO, are the family build's own: the demo gets "" for both.)
 *   links     → optional: a made-up {"<card id>": <percent 0–100>} file, the "how sure" figure the tree shows on the
 *               line down to each child (the family page reads media/links.bin, R-0481), sealed the same way as
 *               media/links.bin. Without it the demo shows no figures and asks for no file.
 *
 * The output is a folder laid out like the family site (since 18 Oct 2026; before, the demo was one 2.4 MB file
 * that a phone had to download whole before anything worked): index.html, media/ and map/. Every address the page
 * fetches is a file in that folder, never a data: address and never another site. The build writes the files
 * first and the page last, and takes out of media/ and map/ the files the new page no longer names.
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

function build(template, cfg, dir, opts = {}) {
  let html = template;
  const root = opts.root || path.join(__dirname, "..");   /* where the template's map file is */
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

  /* 6. the map's layers: the template's coastlines and borders with the demo's reference place names
     (one record per line in the file), as a file of their own beside the page, named by its hash as
     tools/mapfile.js names the family's, and fetched the first time the Map opens */
  const recs = file(cfg.maplbl).split(/\r?\n/).filter(Boolean);
  if (!recs.every(r => /^[0-6][A-Za-z0-9+/]+~[^~\t]+~[A-Z]{2}$/.test(r))) die("maplbl: a record is malformed");
  const mf = html.match(/const MAPFILE = "([^"]*)";/);
  if (!mf) die("template has no MAPFILE line");
  let layers;
  try { layers = JSON.parse(fs.readFileSync(path.join(root, mf[1]), "utf8")); } catch (e) { die("cannot read the template's map file " + mf[1] + ": " + e.message); }
  layers.lbl = recs.join("\t");
  const MF = require("./mapfile.js");
  const mapBuf = MF.serialise(MF.validate(layers)), mapName = MF.hashName(mapBuf);
  const files = new Map([[mapName, mapBuf]]);
  html = html.replace(mf[0], () => "const MAPFILE = " + js(mapName) + ";");
  /* 7. Research: the demo decides (site.research); on, it needs its own made-up research file */
  if (!/const RESFILES = \{[^\n]*\};/.test(html)) die("template has no RESFILES line");
  if (cfg.site.research && !cfg.research) die("site.research is on, so the demo needs a research file (\"research\" in demo.json) — or set site.research to false");
  if (cfg.site.research) file(cfg.research);
  if (!/const PUBFILE = "[^"\n]*";/.test(html)) die("template has no PUBFILE line");
  /* 8. Play's history notes are the family's own places: the demo has none, so its Play asks for no file */
  if (!/const HISTFILE = "[^"\n]*";/.test(html)) die("template has no HISTFILE line");
  html = html.replace(/const HISTFILE = "[^"\n]*";/, () => 'const HISTFILE = "";');
  /* 9. the coronation in Play is for the family build's owner (his card): the demo crowns nobody */
  if (!/const PLAY_HERO = "[^"\n]*";/.test(html)) die("template has no PLAY_HERO line");
  html = html.replace(/const PLAY_HERO = "[^"\n]*";/, () => 'const PLAY_HERO = "";');
  if (cfg.links) file(cfg.links);
  return { html, defaults, files };
}

async function encrypt(html, cfg, dir, opts = {}) {
  const P = require("./payload.js"), zlib = require("zlib");
  const files = new Map(opts.files || []);
  const media = name => P.MEDIA_DIR + "/" + name;
  const data = JSON.parse(fs.readFileSync(path.join(dir, cfg.data), "utf8"));
  /* the payload must fit the branches: every head anchored once, every card's branch listed */
  const all = []; (function walk(p, br) { const b = p.branch || br; all.push({ p, b }); (p.unions || []).forEach(u => (u.c || []).forEach(c => walk(c, b))); })(data, "legacy");
  if (!all.some(x => x.p.anchor === "trunk")) die("data: no card carries the anchor \"trunk\"");
  cfg.branches.filter(b => !b.trunk).forEach(b => { if (all.filter(x => x.p.anchor === b.key).length !== 1) die("data: branch \"" + b.key + "\" is not exactly one anchor"); });
  all.forEach(x => { if (!cfg.branches.some(b => b.id === x.b)) die("data: a card's branch \"" + x.b + "\" is not in branches"); });
  /* every picture travels with the demo: a portrait or record given as an address would be fetched from another site */
  all.forEach(x => [x.p.img, x.p.imgL, ...(((x.p.profile || {}).docs) || []).map(d => d && d.img)].forEach(v => {
    if (v !== undefined && v !== null && v !== "" && !/^data:image\/[a-z+.-]+;base64,/i.test(String(v))) die("data: " + x.p.id + " has a picture that is not a data: image (" + String(v).slice(0, 40) + ")");
  }));
  const salt = cfg.salt || opts.salt || Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const iter = cfg.iter || 600000;
  /* tools/payload.js v3, as the family page: the cards in the page, the rest in media/ (the file names are keyed
     hashes of what is in them, so the same data under the same salt writes the same files) */
  const sealed = P.sealData(data, cfg.password, { salt, iter });
  for (const [id, f] of sealed.media) files.set(media(id + ".bin"), f);
  if (!/const ENC = \{[^\n]*\};/.test(html)) die("template has no ENC line");
  html = html.replace(/const ENC = \{[^\n]*\};/, () => sealed.line);
  if (!/const RESFILES = \{[^\n]*\};/.test(html)) die("template has no RESFILES line");
  if (cfg.site.research) {
    /* the demo's research, checked like the family's (its people must be the demo's cards), sealed the same way */
    const RJ = require("./research.js");
    const R = JSON.parse(fs.readFileSync(path.join(dir, cfg.research), "utf8"));
    const v = RJ.validate(R, { cards: all.map(x => ({ id: x.p.id, name: x.p.name, years: x.p.years })), branches: cfg.branches.map(b => b.key), quiet: true });
    if (v.errors.length) die("research: " + v.errors.slice(0, 5).join("; "));
    const f = RJ.sealed(R, cfg.password, sealed.enc);
    const names = { data: media("research.bin"), cards: media("research-cards.bin") };
    files.set(names.data, f.data); files.set(names.cards, f.cards);
    html = html.replace(/const RESFILES = \{[^\n]*\};/, () => "const RESFILES = " + JSON.stringify(names) + ";");
  }
  /* the line figures: the demo's own made-up file, sealed as tools/linkconf.js seals media/links.bin; or none
     at all (an empty PUBFILE asks for nothing, so the demo makes no request that could only fail) */
  let pub = "";
  if (cfg.links) {
    const L = JSON.parse(fs.readFileSync(path.join(dir, cfg.links), "utf8"));
    const ids = new Set(all.map(x => x.p.id)), l = {};
    Object.entries(L).forEach(([id, pct]) => {
      if (!ids.has(id)) die("links: " + id + " is not a card in the demo's data");
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) die("links: " + id + " needs a whole percent from 0 to 100");
      l[id] = { p: pct };
    });
    const json = Buffer.from(JSON.stringify({ v: 1, l }), "utf8");
    const key = P.keyFor(cfg.password, sealed.enc.salt, sealed.enc.iter);
    pub = media("links.bin");
    files.set(pub, P.sealBlob(key, "k:" + json.length, zlib.deflateRawSync(json, { level: 9 }), Buffer.concat([Buffer.from("links\0"), json])).file);
  }
  html = html.replace(/const PUBFILE = "[^"\n]*";/, () => "const PUBFILE = " + JSON.stringify(pub) + ";");
  return { html, files, iv: sealed.enc.iv, people: count(data) };
}
function count(p) { let n = 1; (p.unions || []).forEach(u => (u.c || []).forEach(c => { n += count(c); })); return n; }

/* the files beside the page: media/<name> and map/<name> only, no way out of the folder */
const FILE_RE = /^(?:media|map)\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/;
/* what must hold for any output — checked before anything is written */
function verify(out, defaults, cfg, files) {
  const m = out.match(/<script>([\s\S]*)<\/script>/);
  if (!m) die("output has no script");
  try { new Function(m[1]); } catch (e) { die("output script does not parse: " + e.message); }
  /* everything the page asks for is in its own folder: every file it names is one this build writes (the owner file
     is fetched only on a device holding the owner's key, which no demo visitor has), and nothing comes from another
     site or from a data: address (a fetch() of one is refused by a connect-src 'self' policy, as the demo's server sends) */
  files = files || new Map();
  [...files.keys()].forEach(f => { if (!FILE_RE.test(f)) die("the build would write " + f + ", outside media/ and map/"); });
  const one = (name, re) => { const x = m[1].match(re); if (!x) die("output has no " + name + " line"); return x[1]; };
  const want = [["MAPFILE", one("MAPFILE", /const MAPFILE = "([^"\n]*)";/)], ["PUBFILE", one("PUBFILE", /const PUBFILE = "([^"\n]*)";/)],
    ["HISTFILE", one("HISTFILE", /const HISTFILE = "([^"\n]*)";/)]];
  if (cfg.site.research) Object.entries(JSON.parse(one("RESFILES", /const RESFILES = (\{[^\n]*\});/).replace(/(\w+):"/g, '"$1":"'))).forEach(([k, v]) => want.push(["RESFILES." + k, v]));
  const enc = require("./payload.js").readEnc(out);
  if (enc.x) want.push(["ENC.x", "media/" + enc.x + ".bin"]);
  want.forEach(([k, v]) => { if (v && !files.has(v)) die(k + " names " + v.slice(0, 60) + ", which is not a file this build writes beside the page"); });
  const conf = one("CONFFILE", /const CONFFILE = "([^"\n]*)";/);
  if (!FILE_RE.test(conf)) die("CONFFILE is not a file in the page's own folder");
  /* and nothing the markup or its styles load comes from elsewhere: a stylesheet, script, font or picture from another
     site (a scheme or // in a src, srcset, a <link>'s href, url() or @import), or a script file at all; links a reader
     follows (<a href>) are not loads */
  const markup = out.slice(0, out.indexOf("<script>")) + out.slice(out.lastIndexOf("</script>"));
  const away = /^\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i, dataUri = /^\s*["']?\s*data:/i;
  const loads = [];
  for (const t of markup.matchAll(/<(link|img|source|video|audio|iframe|embed|object|input|track)\b[^>]*>/gi))
    for (const a of t[0].matchAll(/\b(href|src|srcset|data|poster)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) loads.push(a[2]);
  for (const u of markup.matchAll(/url\(([^)]*)\)/gi)) loads.push(u[1]);
  for (const u of markup.matchAll(/@import\s+(?:url\()?\s*("[^"]*"|'[^']*'|[^\s;)]+)/gi)) loads.push(u[1]);
  const bad = loads.find(v => away.test(v) && !dataUri.test(v));
  if (bad || /<script\b[^>]*\bsrc\s*=/i.test(out))
    die("the page loads something from another site (" + (bad || "a script file").slice(0, 60) + "): the demo carries its own");
  /* nothing of the family build may survive in the demo: not its title, not its site link */
  Object.entries(defaults).forEach(([k, d]) => {
    const t = d.replace(/<[^>]+>/g, "").trim();
    if (t.length >= 8 && !String(cfg.slots[k]).includes(t) && out.includes(t)) die("the template's \"" + k + "\" text is still in the output: " + t.slice(0, 40));
  });
  /* no emoji in the controls or in any string (a tour line once carried one) */
  const PICT = /\p{Extended_Pictographic}/u;
  const body = out.slice(out.indexOf("<body>"), out.indexOf("<script>"));
  const chrome = body.slice(body.search(/<(?:div|header) id="topbar">/), body.indexOf('<div id="intro">'));
  if (chrome && PICT.test(chrome)) die("an emoji is in the controls' markup");
  /* and none on the tree's cards: the Bio button carried one, drawn differently on every phone (4 Oct 2026).
     The card template is render(); typographic symbols drawn as text (the marriage sign, the cross) stay. */
  const card = m[1].slice(m[1].indexOf("function render(){"), m[1].indexOf("function markTips("));
  if (!card || card.length < 500) die("the card template (render) was not found");
  if (/\p{Emoji_Presentation}|\uFE0F/u.test(card)) die("an emoji is in the card template");
  const i18src = m[1].slice(m[1].indexOf("const I18N = {"), m[1].indexOf("\n};", m[1].indexOf("const I18N = {")) + 3);
  const I18N = vm.runInNewContext(i18src.replace(/^const /, "var ") + "\nI18N");
  Object.keys(I18N).forEach(l => Object.entries(I18N[l]).forEach(([k, v]) => { if (PICT.test(String(v))) die("i18n " + l + "." + k + " carries an emoji"); }));
  const surname = (defaults.title || "").replace(/<[^>]+>/g, "").trim().split(/\s+/)[0];
  if (surname && surname.length >= 4 && new RegExp("(?<![A-Za-z])" + surname + "(?![a-z])", "i").test(out))
    die("the family's name \"" + surname + "\" appears in the demo output — give that string a demo value in demo.json");
}

/* ---------- the published page as small as it can be (site audit PERF-3, 19 Oct 2026; Cory's yes, 20 Oct) ----------
   The demo is the family's code, readable. Published, it carries no notes and no spare whitespace: the script through
   terser with compress and mangle off (the same program, nothing renamed or rewritten: its syntax tree is checked
   against the readable one, node for node), the styles through minCss() below, licence notices kept in both. Each
   embedded variable font keeps only the weights its @font-face declares: a browser never draws a weight outside that
   range, so the rest of the axis is bytes no one sees (fontTools' instancer; every glyph's outline is checked against
   the full font at five weights). Needs terser and acorn (npm i -g terser@5 acorn@8) and Python's fontTools with
   brotli (pip install fonttools brotli); a build without them stops, rather than quietly publishing the larger page.
   --readable skips this step (for looking at the output). */
const LEGAL = /licen[cs]e|copyright/i;
function need(mod, hint) {
  try { return require(mod); } catch (_) { /* not beside this repo: try the global modules */ }
  try {
    const g = require("child_process").execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return require(path.join(g, mod));
  } catch (_) { /* not there either */ }
  die("the published demo is minified (PERF-3), and that needs " + mod + ": " + hint + " (or build with --readable to look at it)");
}

/* CSS without its notes (licence notices stay) and without spare whitespace. Strings and url(…) are copied as they
   are. A run of whitespace becomes one space, and none is kept beside { } ; , or after a colon, nor a last ; before a }.
   A space BEFORE a colon stays: in a selector it is the descendant combinator (".a :hover" is not ".a:hover"). */
function minCss(src) {
  const out = []; let i = 0, n = src.length;
  const tail = () => out.length ? out[out.length - 1] : "";
  while (i < n) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1; while (j < n && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i, j + 1)); i = j + 1;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i + 2); if (j < 0) die("a style's comment is not closed");
      const note = src.slice(i, j + 2);
      if (LEGAL.test(note)) { out.push(note); i = j + 2; }
      else { src = src.slice(0, i) + " " + src.slice(j + 2); n = src.length; }   /* a note counts as whitespace */
    } else if (/^url\(/i.test(src.slice(i, i + 4)) && !/["']/.test(src[i + 4] || "")) {
      const j = src.indexOf(")", i); if (j < 0) die("a style's url( is not closed");
      out.push(src.slice(i, j + 1)); i = j + 1;
    } else if (/\s/.test(ch)) {
      let j = i; while (j < n && /\s/.test(src[j])) j++;
      const prev = tail().slice(-1), next = src[j] || "";
      if (prev && !/[{};,:]/.test(prev) && next && !/[{};,]/.test(next)) out.push(" ");
      i = j;
    } else if (ch === "}" && tail().endsWith(";")) {
      out[out.length - 1] = tail().slice(0, -1); out.push("}"); i++;
    } else { out.push(ch); i++; }
  }
  return out.join("").trim();
}

/* two scripts are the same program when their syntax trees are the same, positions and the spelling of literals aside */
function sameProgram(a, b) {
  const acorn = need("acorn", "npm i -g acorn@8");
  const opt = { ecmaVersion: "latest", sourceType: "script" };
  const norm = v => {
    if (Array.isArray(v)) return v.map(norm);
    if (v instanceof RegExp) return "/" + v.source + "/" + v.flags;
    if (typeof v === "bigint") return v.toString() + "n";
    if (!v || typeof v !== "object") return v;
    const o = {};
    for (const k of Object.keys(v)) if (!["start", "end", "loc", "range", "raw"].includes(k)) o[k] = norm(v[k]);
    if (v.type === "TemplateElement") o.value = v.value.cooked;
    return o;
  };
  return JSON.stringify(norm(acorn.parse(a, opt))) === JSON.stringify(norm(acorn.parse(b, opt)));
}

/* one variable woff2 font cut to the weight range its @font-face declares, and checked: every glyph's advance and
   outline at the range's ends, its middle and two weights between, against the full font at the same weight, to
   within 2/1000 of an em (the instancer rounds its deltas). Prints nothing and changes nothing for a font that has
   no weight axis or whose axis is already inside the range. */
const FONT_PY = String.raw`
import sys, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.recordingPen import RecordingPen
lo, hi = float(sys.argv[1]), float(sys.argv[2])
raw = sys.stdin.buffer.read()
load = lambda b: TTFont(io.BytesIO(b), recalcTimestamp=False)
f = load(raw)
ax = [a for a in f["fvar"].axes if a.axisTag == "wght"] if "fvar" in f else []
if not ax or (ax[0].minValue >= lo and ax[0].maxValue <= hi): sys.exit(0)
lo, hi = max(lo, ax[0].minValue), min(hi, ax[0].maxValue)
if lo > hi: sys.exit("the declared weights miss the font's axis")
cut = instancer.instantiateVariableFont(f, {"wght": (lo, hi) if lo < hi else lo}, updateFontNames=False)
cut.flavor = "woff2"; o = io.BytesIO(); cut.save(o); new = o.getvalue()
upm = load(raw)["head"].unitsPerEm
def shape(b, w):
    g = instancer.instantiateVariableFont(load(b), {"wght": w}) if "fvar" in load(b) else load(b)
    gs = g.getGlyphSet(); r = {}
    for name in g.getGlyphOrder():
        p = RecordingPen(); gs[name].draw(p); r[name] = (gs[name].width, p.value)
    return r
worst = 0.0
for w in sorted({lo, hi, (lo + hi) / 2, lo + (hi - lo) / 7, hi - (hi - lo) / 5}):
    a, b = shape(raw, w), shape(new, w)
    if sorted(a) != sorted(b): sys.exit("the cut font lost or gained glyphs")
    for name in a:
        (wa, pa), (wb, pb) = a[name], b[name]
        worst = max(worst, abs(wa - wb))
        if [op for op, _ in pa] != [op for op, _ in pb]: sys.exit("glyph " + name + " changed its drawing at weight " + str(w))
        for (_, xa), (_, xb) in zip(pa, pb):
            for p, q in zip(xa, xb):
                if isinstance(p, tuple): worst = max(worst, abs(p[0] - q[0]), abs(p[1] - q[1]))
if worst > 0.002 * upm: sys.exit("a glyph moved %.2f units of %d at some weight" % (worst, upm))
sys.stdout.buffer.write(new)
`;
function cutFonts(css) {
  return css.replace(/@font-face\{[^}]*\}/g, rule => {
    const w = rule.match(/font-weight:\s*(\d+)(?:\s+(\d+))?\s*[;}]/), src = rule.match(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/);
    if (!w || !src) return rule;
    /* -P: the folder the build runs in is not searched for modules */
    const r = require("child_process").spawnSync("python3", ["-P", "-c", FONT_PY, w[1], w[2] || w[1]],
      { input: Buffer.from(src[1], "base64"), maxBuffer: 64 << 20 });
    if (r.error || r.status !== 0) {
      const why = String(r.stderr || (r.error && r.error.message) || "").trim().split("\n").pop();
      if (/No module named|ENOENT/.test(why)) die("the published demo's fonts are cut to their weights (PERF-3), and that needs Python 3.11+ with fontTools: pip install fonttools brotli (or build with --readable to look at it)");
      die("cutting an embedded font to its weights failed: " + why);
    }
    return r.stdout.length ? rule.replace(src[1], () => r.stdout.toString("base64")) : rule;
  });
}

/* "" when the script's tools are at hand (a test can say what it skips), else what is missing */
function slimReady() { try { need("terser", "npm i -g terser@5"); need("acorn", "npm i -g acorn@8"); return ""; } catch (e) { return e.message; } }

/* the readable page in, the published page out; every check above holds for it, or the build stops */
async function slim(html) {
  const terser = need("terser", "npm i -g terser@5");
  const blocks = [...html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)];
  if (blocks.filter(m => m[1] === "script").length !== 1) die("the page should have one inline script");
  let out = "", last = 0;
  for (const m of blocks) {
    out += html.slice(last, m.index);
    let body = m[2];
    if (m[1] === "style") {
      body = minCss(cutFonts(body));
      if (minCss(body) !== body) die("the styles do not minify to a fixed point");
    } else {
      const r = await terser.minify(body, { ecma: 2020, compress: false, mangle: false, module: false,
        format: { comments: (_, c) => LEGAL.test(c.value), quote_style: 3, keep_quoted_props: true, keep_numbers: true, inline_script: true } });
      if (!r.code) die("terser gave no script");
      if (!sameProgram(body, r.code)) die("the minified script is not the same program as the readable one");
      body = r.code;
    }
    out += "<" + m[1] + ">" + body + "</" + m[1] + ">";
    last = m.index + m[0].length;
  }
  out += html.slice(last);
  try { new Function(out.match(/<script>([\s\S]*)<\/script>/)[1]); } catch (e) { die("the minified script does not parse: " + e.message); }
  return out;
}
/* the page's ENC line, read whether the page is readable or minified */
const encOf = html => require("./payload.js").readEnc(html.replace(/const ENC=\{/, "const ENC = {"));

/* the files first, each read back, then the page, so a page is never there before what it names; then out of media/
   and map/ go the files the new page no longer names (only those two folders: the rest of the folder, such as the
   site's own .htaccess and icon, is not the build's) */
function writeFolder(root, page, html, files) {
  let written = 0, kept = 0;
  for (const [rel, buf] of files) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let same = false; try { same = fs.readFileSync(p).equals(buf); } catch (_) {}
    if (same) { kept++; continue; }
    fs.writeFileSync(p, buf);
    if (!fs.readFileSync(p).equals(buf)) die("the write of " + rel + " did not land");
    written++;
  }
  fs.writeFileSync(path.join(root, page), html);
  if (fs.readFileSync(path.join(root, page), "utf8") !== html) die("the written page does not read back identical");
  const removed = [];
  for (const sub of ["media", "map"]) {
    let names = []; try { names = fs.readdirSync(path.join(root, sub)); } catch (_) { continue; }
    names.filter(n => !files.has(sub + "/" + n) && /\.(bin|json)$/.test(n)).forEach(n => { fs.unlinkSync(path.join(root, sub, n)); removed.push(sub + "/" + n); });
  }
  return { written, kept, removed };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const dir = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out" && args[args.indexOf(a) - 1] !== "--template");
    if (!dir) die("usage: node tools/build-demo.js <demo-dir> [--out <file>] [--template <file>] [--readable]");
    const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const cfgPath = path.join(dir, "demo.json");
    if (!fs.existsSync(cfgPath)) die("no demo.json in " + dir);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const template = readFresh(opt("--template") || path.join(__dirname, "..", "index.html"));
    const out = opt("--out") || path.join(dir, cfg.out || "index.html");
    /* the demo goes into the site that publishes it, never into this repo: here the clean-up would take the family's own media/ */
    if (path.resolve(path.dirname(out)) === path.resolve(__dirname, "..")) die("the output folder is this repo; build the demo into its own folder");
    /* --out names the page, not its folder: given a folder, the files would land beside it, in its parent */
    if (fs.existsSync(out) && fs.statSync(out).isDirectory()) die("--out names the page's file (<folder>/index.html), and " + out + " is a folder");
    /* the salt of the page already there, so the same data writes the same media files (demo.json may fix one) */
    let salt = null;
    try { salt = encOf(fs.readFileSync(out, "utf8")).salt || null; } catch (_) { /* no page there yet */ }
    const { html, defaults, files } = build(template, cfg, dir);
    const enc = await encrypt(html, cfg, dir, { files, salt });
    verify(enc.html, defaults, cfg, enc.files);
    const page = args.includes("--readable") ? enc.html : await slim(enc.html);
    const w = writeFolder(path.dirname(out), path.basename(out), page, enc.files);
    console.log("demo built: " + out + " — " + Buffer.byteLength(page) + " bytes" + (page === enc.html ? " (readable)" : " (" + Buffer.byteLength(enc.html) + " readable)") +
      ", " + enc.people + " people, iv " + enc.iv +
      "; beside it " + enc.files.size + " files, " + [...enc.files.values()].reduce((a, b) => a + b.length, 0) + " bytes (" +
      w.written + " written, " + w.kept + " unchanged" + (w.removed.length ? ", " + w.removed.length + " no longer used taken out" : "") + ")");
  })().catch(e => { console.error("build-demo: " + (e instanceof BuildError ? e.message : (e.stack || e.message))); process.exit(1); });
}

module.exports = { build, encrypt, verify, slim, slimReady, minCss, sameProgram, encOf, writeFolder, SLOT, FILE_RE };
