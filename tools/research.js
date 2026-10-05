#!/usr/bin/env node
/*
 * research — the data behind the site's Research view (3 Oct 2026).
 *
 * Cory, 2 Oct 2026: "I should NEVER need to instruct an agent to update it. Agents should also
 * reference it when investigating." So the research state lives in ONE private file, research.json
 * at the repo root (gitignored like data.json), every session that changes research state updates it
 * with this tool in the same session, and the page reads a sealed copy of it.
 *
 *   node tools/research.js status                       what is open, tier by tier; what needs Cory's OK
 *   node tools/research.js show <id>                    one investigation, source or visit, in full
 *   node tools/research.js validate                     schema, French, privacy, card links
 *   node tools/research.js build                        validate, then write media/research.bin and
 *                                                       media/research-cards.bin (and .research-stamp)
 *   node tools/research.js check                        the gate's question: valid, and the two files
 *                                                       in media/ are exactly what build would write
 *   node tools/research.js link [--write]               fill in people's card ids from data.json
 *
 *   node tools/research.js set <source|visit> key=value …        st, who, who_fr, since, next, next_fr,
 *                                                                why, why_fr, where, where_fr, how, how_fr, by, visit, dec,
 *                                                                pri, pos, access, access_fr
 *   node tools/research.js log <source|visit> "<English>" "<French>" [--date YYYY-MM-DD]
 *   node tools/research.js answer <investigation> <question no.> "<note>" "<note in French>"
 *   node tools/research.js state <investigation> <question no.> open|lead|partly|answered
 *   node tools/research.js inv <investigation> key=value …        next, next_fr, imp, summary, summary_fr, title, …
 *   node tools/research.js add-source <investigation> <question no.> '<json>'
 *   node tools/research.js add-question <investigation> '<json>'
 *   node tools/research.js add-inv '<json>'
 *   node tools/research.js decide <https://claude.ai/artifact/…>  the address of Cory's private decisions page ("" removes it)
 *
 * A person's archive visits (5 Oct 2026): the page's #research/who/<name> gathers every visit list whose `who` is
 * that person. On a source in a visit list, `pos` is its place on the list (1, 2, 3 …, each once per list) and `pri`
 * its priority: A do first, B if time allows, C only at the end. `next` says what to photograph.
 * "Us" (Cory, 5 Oct 2026): the family reads every string, so research Claude and Cory do online is "Cory, online"
 * ("Cory, en ligne"), never "Us, online"; validate warns on the old words, and the tier rule still knows them.
 * Begin research (4 Oct 2026, register R-0448): a card whose id is go and a number (go1…) is a research card, work
 * Claude can do alone, online; the page labels its button Begin research. The same dec carries it.
 * Cory's Decide buttons (3 Oct 2026, register R-0445): an investigation, source or visit list that waits on one of
 * his yes/no cards carries `dec`, that card's id on his private decisions page (set <id> dec=<card>, or inv <inv>
 * dec=<card>; dec= clears it, and whoever finishes the card clears it). The page shows a Decide button for it, and
 * a "Your decisions" link, only on a device opened once with #owner; the decisions page itself is guarded by his
 * claude.ai login, so the buttons only save him a search.
 *
 * Every command that changes research.json stamps the date on what it touched (`updated` on the
 * investigation and on the file, and the date of a log line; pass --date for the day it happened, if not
 * today), and records the real time of the edit as `_touched` on each item it changed (the gate's proof
 * that a change set's research items were updated; --date never moves it). It refuses to save a file that
 * does not validate, and rebuilds the two sealed files when the password is at hand. Then commit
 * media/research.bin and media/research-cards.bin; the commit hook checks .research-stamp.
 *
 * The sealed files: media/<name>.bin = iv(12) + AES-GCM(u8 header length, header, body) under the
 * payload's key (tools/payload.js), so tests/run.js §14 proves they are ciphertext like the rest of
 * media/. research.bin: header "r:<JSON byte length>", body deflate-raw(JSON) — the family's view of
 * research.json (keys starting with "_" are private notes and are left out). research-cards.bin:
 * header "q", body JSON {updated, cards: {<card id>: [open questions, investigation ids…]},
 * invs: {<id>: [title, title_fr, tier]}} — what the tree's badges and the bio's "Open questions" need,
 * fetched once the tree is drawn. Their iv is a keyed hash of what is in them, so an unchanged file is
 * byte-for-byte the same (no churn in git) and the names never change.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const P = require("./payload.js");

const ROOT = process.env.FT_ROOT || path.join(__dirname, "..");
const FILE = process.env.FT_RESEARCH || path.join(ROOT, "research.json");
const OUT = { data: "research.bin", cards: "research-cards.bin" };
const STAMP = path.join(ROOT, ".research-stamp");
const DENY = path.join(ROOT, "ledger", "research-deny.txt");

const STATUSES = ["cory", "wait", "visit", "ready", "todo", "hold", "found", "none", "done"];
const CLOSED = new Set(["found", "none", "done"]);
const QSTATES = ["open", "lead", "partly", "answered"];
const TIERS = ["solo", "assist", "others", "hold"];


/* ---------- tiers: the same rule as the page (index.html, resTier), tested to agree ---------- */
function tierOf(s) {
  if (CLOSED.has(s.st)) return "closed";
  if (s.by) return s.by;
  if (s.st === "hold") return "hold";
  if (s.st === "ready") return "solo";
  if (s.st === "cory") return "assist";
  if (s.st === "todo") return (s.who === "Cory, online" || s.who === "Us, online") ? "solo" : (s.who === "Cory" ? "assist" : "others");
  return "others";
}
function invTier(iv) {
  const tc = { solo: 0, assist: 0, others: 0, hold: 0, closed: 0 };
  iv.qs.forEach(q => q.src.forEach(s => { tc[tierOf(s)] += 1; }));
  return TIERS.find(k => tc[k] > 0) || "closed";
}

/* ---------- reading and writing ---------- */
function load(file = FILE) {
  let txt;
  try { txt = fs.readFileSync(file, "utf8"); } catch (e) { throw new Error("no research file at " + file + " (" + (e.code || e.message) + ")"); }
  return JSON.parse(txt);
}
function save(R, file = FILE) {
  const out = JSON.stringify(R, null, 1) + "\n";
  fs.writeFileSync(file + ".new", out);
  if (fs.readFileSync(file + ".new", "utf8") !== out) throw new Error("staging write did not land");
  try { fs.renameSync(file + ".new", file); }
  catch (e) {   /* the Cowork mount can refuse rename: overwrite in place and prove it */
    fs.writeFileSync(file, out);
    if (fs.readFileSync(file, "utf8") !== out) throw new Error("in-place write was truncated; the full file is at " + file + ".new");
    try { fs.rmSync(file + ".new", { force: true }); } catch (_) {}
  }
}
const today = () => new Date().toISOString().slice(0, 10);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

/* the family's copy: drop private keys ("_…") everywhere */
function publicCopy(x) {
  if (Array.isArray(x)) return x.map(publicCopy);
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (!k.startsWith("_")) o[k] = publicCopy(v);
    return o;
  }
  return x;
}

/* ---------- what the tree's cards need ---------- */
function cardIndex(R) {
  const cards = {}, invs = {};
  for (const iv of R.investigations || []) {
    const tier = invTier(iv);
    for (const q of iv.qs) {
      if (q.state === "answered") continue;
      const who = (q.people || iv.people || []).map(p => p.card).filter(Boolean);
      for (const c of new Set(who)) {
        const e = cards[c] || (cards[c] = [0]);
        e[0] += 1;
        if (!e.includes(iv.id)) e.push(iv.id);
        invs[iv.id] = [iv.title, iv.title_fr, tier];
      }
    }
  }
  return { updated: R.updated, cards, invs };
}

/* ---------- validation: errors stop a save or a build; warnings are printed ---------- */
function branchKeys() {
  try {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const m = html.match(/const BRANCHES = \[([\s\S]*?)\n\];/);
    return m ? [...m[1].matchAll(/key:"([a-z0-9-]+)"/g)].map(x => x[1]) : null;
  } catch (_) { return null; }
}
function cardsFromData() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
    const out = [];
    (function walk(n) { if (!n || typeof n !== "object") return; if (n.id) out.push({ id: n.id, name: n.name || "", years: n.years || "" }); (n.unions || []).forEach(u => (u.c || []).forEach(walk)); })(d);
    return out;
  } catch (_) { return null; }
}
function denyList() {
  try { return fs.readFileSync(DENY, "utf8").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#")); }
  catch (_) { return []; }
}
/* every text a family member can read, with where it sits (for the privacy rules): EVERY string in the
   family's copy (publicCopy), whatever its key, so a field added by hand or through add-source is checked
   too (review, 3 Oct 2026). Only the keys whose form validate() pins down are passed over. */
const FORMAL = new Set(["id", "theme", "visit", "branch", "st", "state", "by", "card", "since", "updated", "icon", "dec", "decide", "pri", "pos"]);
function eachText(R, fn) {
  (function walk(x, where, key) {
    if (typeof x === "string") { if (x && !FORMAL.has(key)) fn(where, x); return; }
    if (Array.isArray(x)) return x.forEach((v, i) => walk(v, where + "[" + i + "]", key));
    if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, where ? where + "." + k : k, k);
  })(publicCopy(R), "", "");
}
/* the privacy list (CLAUDE.md, OPERATING.md; build prompt §2.3) — the parts a machine can check. Written
   for genealogy prose in the languages of the family's records: event dates, years, archive references and
   maiden names pass; a living person's birth date, a street address or a phone number does not. */
const ci = w => w.replace(/^([a-zäéû])/, c => "[" + c.toUpperCase() + c + "]");   /* "march" → "[Mm]arch" */
const MON = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sept?(?:ember)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?",
  "janv(?:ier)?", "f[ée]vr?(?:ier)?", "mars", "avr(?:il)?", "mai", "juin", "juil(?:let)?", "ao[ûu]t", "sept(?:embre)?", "oct(?:obre)?", "nov(?:embre)?", "d[ée]c(?:embre)?",
  "januari", "februari", "maart", "mrt", "mei", "juni", "juli", "augustus", "okt(?:ober)?",
  "januar", "februar", "m[äa]e?rz", "dezember"].map(ci).join("|");
const M_ = "(?<![\\p{L}])(?:" + MON + ")(?![\\p{L}])\\.?";                   /* a month, written out or cut short */
const D_ = "(?<![\\d\\p{L}])(?:[12]\\d|3[01]|0?[1-9])(?:er|st|nd|rd|th)?";     /* a day of the month */
const Y0 = "(?:19[3-9]\\d|20\\d\\d)", Y_ = Y0 + "(?!\\d)";                     /* a year since 1930: someone possibly living */
const FULL_DATE = "(?:" + D_ + "\\.?[\\s\\-/]+" + M_ + "[\\s,\\-/]+" + Y_ +   /* 12 March 1950, 1er janv. 1950, 12-Mar-1950, 12. März 1950 */
  "|" + M_ + "\\s+" + D_ + ",?\\s+" + Y_ +                                    /* March 12, 1950 */
  "|" + M_ + ",?\\s+" + Y_ +                                                   /* March 1950: more than a year too */
  "|(?<!\\d)\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]" + Y_ +                              /* 12/03/1950, 12.03.1950 */
  "|(?<!\\d)" + Y0 + "[/.\\-]\\d{1,2}[/.\\-]\\d{1,2}(?!\\d))";                  /* 1950-03-12, 1950/03/12 */
/* the words that introduce a birth; "née" and "nee" followed by a capitalised word are a maiden name instead */
const BORN = "(?<![\\p{L}])([Bb]orn|[Bb]\\.|[Bb]irth(?:day)?|[Nn][ée]e|[Nn]é|[Nn]aissance|[Nn]aît|[Nn]aquit|[Dd]ate of birth|DOB|[Gg]eb\\.|[Gg]eboren)(?![\\p{L}])|(?<![\\p{L}\\d*])(\\*)(?=\\s*\\d)";
/* between the word and the date: up to 40 characters, never across a sentence, a number or another event
   (a death, a marriage, a baptism or a burial has its own date); "St.", "Dr." and the like don't end a sentence */
const STOP = "(?<![\\p{L}])(?:[Dd]ied|[Dd]\\.|[Dd]eath|[Mm]ort|[Dd][ée]c[ée]d|[Dd]eceased|[Mm]arried|[Mm]arr\\.|[Mm]\\.|[Mm]ari[ée]|[ÉéEe]pous|[Ww]ed|[Bb]apt|[Bb]ur(?:ied|ial)|[Ii]nhum|[Oo]verleden|[Gg]estorven|[Gg]est\\.|[Gg]etrouwd|[Vv]erh\\.|[Tt]rouwt?)(?![\\p{L}])|†";
const GAP = "(?:(?:St|Ste|Mt|Ft|Dr|Mr|Mrs|Ms|Jr|Sr|No)\\.|(?!" + STOP + ")[^.;!?\\n\\d]){0,40}?";
const BIRTH_RE = new RegExp("(?:" + BORN + ")" + GAP + FULL_DATE, "gu");
const birthDate = { test: v => [...String(v).matchAll(BIRTH_RE)].some(m => !(/^[Nn][ée]e$/.test(m[1] || "") && /^\s+\p{Lu}/u.test(v.slice(m.index + m[1].length)))) };
const NOT_YEAR = "(?!(?:1\\d{3}|20\\d\\d)(?!\\d))";   /* a year is not a house number: "the 1880 Census", "1836 rue …" */
const PRIV = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"],
  [/(?:\+\d[\d ().-]{7,}\d|\(\d{3}\)\s?\d{3}[ .-]?\d{4}(?!\d)|(?<![\d.])\d{3}[ .-]\d{3}[ .-]\d{4}(?!\d)|(?<![\d/.-])0[1-9](?:[ .-]?\d\d){4}(?![\d/]))/, "a phone number"],
  [/\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i, "a web address (say what the source is instead)"],
  [new RegExp("(?<![\\d/.-])" + NOT_YEAR + "\\d{1,5}[A-Za-z]?\\s+(?:\\p{Lu}[\\p{L}'’-]*\\.?\\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Boulevard|Blvd|Terrace|Highway|Hwy)\\b", "u"), "a street address"],
  [new RegExp("(?<![\\d/.-])" + NOT_YEAR + "\\d{1,4}(?:\\s?(?:bis|ter))?,?\\s+(?:[Rr]ue|[Aa]venue|[Bb]oulevard|[Bb]d|[Cc]hemin|[Ii]mpasse|[Aa]llée|[Pp]lace|[Qq]uai|[Rr]oute|[Cc]ours|[Ss]quare|[Pp]assage)\\s+(?:de\\s+la\\s+|de\\s+l['’]|du\\s+|des\\s+|de\\s+|d['’])?\\p{Lu}", "u"), "a street address"],
  [new RegExp("\\p{Lu}\\p{Ll}+(?:straat|laan|weg|gracht|kade|singel|plein|dijk|steeg|stra(?:ss|ß)e|gasse|platz)\\s+" + NOT_YEAR + "\\d{1,4}(?![\\d\\p{L}])", "u"), "a street address"],
  [new RegExp("(?<![\\d/.-])" + NOT_YEAR + "\\d{1,4}[a-z]?\\s+\\p{Lu}\\p{Ll}+(?:straat|laan|gracht|kade|singel|plein|steeg|stra(?:ss|ß)e|gasse)(?![\\p{L}])", "u"), "a street address"],
  [/\b(?:nudge|chase him|chase her|remind him|remind her|who pays|he pays|she pays)\b/i, "an internal note about how to handle a person"],
  [birthDate, "a birth date with its day or month, for someone born since 1930 (living people get a birth year only)"],
  [new RegExp("\\(\\s*" + FULL_DATE + "\\s*[–-]\\s*\\)", "u"), "an open life span with a full birth date (living people get a birth year only)"],
];
function validate(R, opts = {}) {
  const errors = [], warnings = [];
  const E = m => errors.push(m), W = m => warnings.push(m);
  if (!R || typeof R !== "object") return { errors: ["research.json is not an object"], warnings };
  if (R.schema !== 1) E("schema must be 1");
  if (!isDate(R.updated || "")) E("updated must be a date (YYYY-MM-DD)");
  if (R.decide !== undefined && !/^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9_-]+$/.test(String(R.decide))) E("decide must be the address of Cory's private decisions page (https://claude.ai/artifact/…)");
  const ids = new Map();
  const claim = (id, what) => { if (!/^[a-z][a-z0-9-]*$/i.test(id || "")) E(what + " has a bad id: " + JSON.stringify(id)); else if (ids.has(id)) E("id " + id + " is used twice (" + ids.get(id) + " and " + what + ")"); else ids.set(id, what); };
  const needFr = (o, k, where) => { if (typeof o[k] === "string" && o[k].trim() && !(typeof o[k + "_fr"] === "string" && o[k + "_fr"].trim())) E(where + ": " + k + " has no French (" + k + "_fr)"); };
  const needEn = (o, k, where) => { if (!(typeof o[k] === "string" && o[k].trim())) E(where + ": " + k + " is required"); };
  const dateOk = (d, where, req) => { if (!d) { if (req) E(where + " needs a date"); return; } if (!isDate(d)) E(where + ": " + JSON.stringify(d) + " is not a date"); else if (d > (opts.today || today())) E(where + ": " + d + " is in the future"); };
  const logOk = (log, where) => {
    if (log === undefined) return;
    if (!Array.isArray(log)) return E(where + ".log must be a list");
    log.forEach((e, i) => {
      if (!Array.isArray(e) || e.length !== 3) return E(where + ".log[" + i + "] must be [date, English, French]");
      dateOk(e[0], where + ".log[" + i + "]", true);
      if (!String(e[1] || "").trim()) E(where + ".log[" + i + "] has no English");
      if (!String(e[2] || "").trim()) E(where + ".log[" + i + "] has no French");
      if (i && isDate(e[0]) && isDate(log[i - 1][0]) && e[0] < log[i - 1][0]) W(where + ".log is out of date order at " + i);
    });
  };
  const themes = new Set();
  (R.themes || []).forEach((t, i) => {
    claim(t.id, "theme " + (i + 1)); themes.add(t.id); ["name", "blurb"].forEach(k => { needEn(t, k, t.id); needFr(t, k, t.id); });
    if (t.icon !== undefined && !/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$/.test(String(t.icon))) E(t.id + ": icon must be an SVG path (M, L, C, A, Z … and numbers)");
  });
  const touchedOk = (o, where) => { if (o && o._touched !== undefined && (typeof o._touched !== "string" || isNaN(Date.parse(o._touched)))) E(where + "._touched must be a time (the tools write it)"); };
  let decs = 0;
  const decOk = (o, where) => { if (!o || o.dec === undefined) return; decs++; if (!/^[a-z]{1,4}[0-9]{1,3}$/.test(String(o.dec))) E(where + ": dec must be one decision card id, such as m1 or bz1"); };
  if (!themes.size) E("no themes");
  const visits = R.visits || {};
  const vPos = {};   /* visit list → the places taken on it (pos), to catch one used twice */
  const usOk = (o, where) => { if (o.who === "Us, online" || o.who_fr === "Nous, en ligne") W(where + ": say \"Cory, online\" (\"Cory, en ligne\"), not \"Us\": everyone with the password reads this (Cory, 5 Oct 2026)"); };
  Object.entries(visits).forEach(([id, v]) => {
    claim(id, "visit");
    ["name", "access"].forEach(k => needEn(v, k, id));
    ["name", "short", "access", "who", "next"].forEach(k => needFr(v, k, id));
    if (v.st && !STATUSES.includes(v.st)) E(id + ": unknown status " + v.st);
    touchedOk(v, id);
    decOk(v, id);
    usOk(v, id);
    dateOk(v.since, id + ".since", false);
    logOk(v.log, id);
  });
  const brs = opts.branches !== undefined ? opts.branches : branchKeys();   /* the demo passes its own */
  const cards = opts.cards === undefined ? cardsFromData() : opts.cards;
  const cardIds = cards ? new Set(cards.map(c => c.id)) : null;
  const peopleOk = (list, where) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return E(where + ".people must be a list");
    list.forEach((p, i) => {
      if (!p || typeof p !== "object") return E(where + ".people[" + i + "] must be {card, n, y}");
      if (!p.n) E(where + ".people[" + i + "] needs n (the name as the tree shows it)");
      if (p.card && !/^c\d{3,}$/.test(p.card)) E(where + ".people[" + i + "].card " + JSON.stringify(p.card) + " is not a card id");
      if (!p.card) W(where + ".people[" + i + "] (" + p.n + ") has no card id yet — run: node tools/research.js link");
      else if (cardIds && !cardIds.has(p.card)) E(where + ".people[" + i + "] names card " + p.card + ", which is not in data.json");
    });
  };
  (R.investigations || []).forEach((iv, n) => {
    claim(iv.id, "investigation " + (n + 1));
    const w = iv.id;
    if (!themes.has(iv.theme)) E(w + ": theme " + iv.theme + " does not exist");
    ["title", "next", "summary"].forEach(k => { needEn(iv, k, w); needFr(iv, k, w); });
    needFr(iv, "line", w);
    if (iv.branch && brs && !brs.includes(iv.branch)) E(w + ": branch " + iv.branch + " is not in BRANCHES");
    dateOk(iv.updated, w + ".updated", true);
    if (![0, 1, 2, 3].includes(iv.imp)) E(w + ": imp must be 0, 1, 2 or 3 (3 could settle it, 2 a big step, 1 a small step, 0 on hold)");
    touchedOk(iv, w);
    decOk(iv, w);
    peopleOk(iv.people, w);
    if (!Array.isArray(iv.qs) || !iv.qs.length) return E(w + ": needs at least one question");
    let open = 0;
    iv.qs.forEach((q, qi) => {
      const wq = w + ".q" + (qi + 1);
      needEn(q, "q", wq); needFr(q, "q", wq); needFr(q, "note", wq);
      if (!QSTATES.includes(q.state)) E(wq + ": state must be one of " + QSTATES.join(", "));
      peopleOk(q.people, wq);
      if (!Array.isArray(q.src) || !q.src.length) return E(wq + ": needs at least one source");
      q.src.forEach(s => {
        claim(s.id, wq + " source");
        const ws = s.id;
        needEn(s, "t", ws);
        ["t", "where", "how", "who", "next", "why"].forEach(k => needFr(s, k, ws));
        if (!STATUSES.includes(s.st)) E(ws + ": unknown status " + JSON.stringify(s.st));
        if (s.by && !TIERS.includes(s.by)) E(ws + ": by must be one of " + TIERS.join(", "));
        touchedOk(s, ws);
        decOk(s, ws);
        if (s.visit && !visits[s.visit]) E(ws + ": visit " + s.visit + " does not exist");
        if (s.st === "visit" && !s.visit) W(ws + ": needs a visit, but names no visit list");
        if (s.pri !== undefined && !["A", "B", "C"].includes(s.pri)) E(ws + ": pri must be A (do first), B (if time allows) or C (only at the end)");
        if (s.pos !== undefined && !(Number.isInteger(s.pos) && s.pos >= 1 && s.pos <= 99)) E(ws + ": pos must be its place on the visit list, a whole number from 1 to 99");
        if ((s.pri !== undefined || s.pos !== undefined) && !s.visit) E(ws + ": pri and pos order a visit list, but " + ws + " is on none");
        if (s.visit && Number.isInteger(s.pos)) { const t = vPos[s.visit] = vPos[s.visit] || {}; if (t[s.pos]) E(ws + ": place " + s.pos + " on visit list " + s.visit + " is taken by " + t[s.pos]); else t[s.pos] = ws; }
        usOk(s, ws);
        dateOk(s.since, ws + ".since", !CLOSED.has(s.st) && s.st !== "todo" && s.st !== "hold");
        logOk(s.log, ws);
        if (s.st === "todo" && !s.by && s.who && s.who !== "Cory, online" && s.who !== "Us, online" && s.who !== "Cory") W(ws + ": not started and waiting on " + s.who + " — fine, it counts as needs others");
        if (!CLOSED.has(s.st) && s.st !== "hold") open++;
        const last = (s.log || []).map(e => e[0]).filter(isDate).sort().pop();
        if (last && iv.updated && last > iv.updated) E(w + ".updated (" + iv.updated + ") is older than " + ws + "'s log (" + last + ")");
      });
      if (q.state === "answered" && q.src.some(s => !CLOSED.has(s.st))) W(wq + " is answered but has open sources");
    });
    if (open && !iv.imp) E(w + ": has open sources, so imp must be 1–3");
  });
  if (!(R.investigations || []).length) E("no investigations");
  if (decs && !R.decide) W(decs + " item(s) carry dec, but there is no decide address, so no Decide button shows (node tools/research.js decide <url>)");
  /* privacy: the machine-checkable part of the list; a person still reads every string before publishing */
  const deny = denyList().map(w => new RegExp("(^|[^\\p{L}])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\p{L}])", "iu"));
  eachText(R, (where, v) => {
    PRIV.forEach(([re, what]) => { if (re.test(v)) E(where + ": carries " + what + ": " + JSON.stringify(v.slice(0, 120))); });
    deny.forEach(re => { if (re.test(v)) E(where + ": names someone on the private do-not-publish list (ledger/research-deny.txt)"); });
  });
  if (!fs.existsSync(DENY) && !opts.quiet) W("no ledger/research-deny.txt: names researched but never to be published are not being checked");
  return { errors, warnings };
}

/* ---------- sealing ---------- */
function encOf() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return P.readEnc(html);
}
function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  try { return fs.readFileSync(path.join(ROOT, ".password"), "utf8").trim(); } catch (_) { return null; }
}
function sealed(R, pw, enc) {
  const key = P.keyFor(pw, enc.salt, enc.iter);
  const json = Buffer.from(JSON.stringify(publicCopy(R)), "utf8");
  const data = P.sealBlob(key, "r:" + json.length, zlib.deflateRawSync(json, { level: 9 }), Buffer.concat([Buffer.from("research\0"), json])).file;
  const cj = Buffer.from(JSON.stringify(cardIndex(R)), "utf8");
  const cards = P.sealBlob(key, "q", cj, Buffer.concat([Buffer.from("research-cards\0"), cj])).file;
  return { data, cards };
}
/* what git calls these bytes (the commit hook compares the staged blobs with .research-stamp) */
const blobId = b => crypto.createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
function build(R, pw) {
  const v = validate(R);
  if (v.errors.length) throw Object.assign(new Error("research.json does not validate"), { v });
  const enc = encOf();
  const f = sealed(R, pw, enc);
  const dir = path.join(ROOT, P.MEDIA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, name] of Object.entries(OUT)) {
    const p = path.join(dir, name);
    let same = false; try { same = fs.readFileSync(p).equals(f[k]); } catch (_) {}
    if (!same) { fs.writeFileSync(p, f[k]); if (!fs.readFileSync(p).equals(f[k])) throw new Error("the write to media/" + name + " did not land"); }
  }
  fs.writeFileSync(STAMP, blobId(f.data) + " media/" + OUT.data + "\n" + blobId(f.cards) + " media/" + OUT.cards + "\n" +
    "# written by tools/research.js build " + new Date().toISOString() + " for research.json updated " + R.updated + "\n");
  return { v, f };
}
/* the gate's question: does media/ hold exactly what research.json makes? */
function check(R, pw) {
  const v = validate(R);
  const problems = v.errors.slice();
  if (!pw) problems.push("no password, so the sealed research files cannot be compared");
  else {
    const f = sealed(R, pw, encOf());
    for (const [k, name] of Object.entries(OUT)) {
      let cur = null; try { cur = fs.readFileSync(path.join(ROOT, P.MEDIA_DIR, name)); } catch (_) {}
      if (!cur) problems.push("media/" + name + " is missing — run: node tools/research.js build");
      else if (!cur.equals(f[k])) problems.push("media/" + name + " is not what research.json makes — run: node tools/research.js build");
    }
  }
  return { problems, warnings: v.warnings };
}
/* change sets that say they move research ids: each id must show a change in research.json no earlier than a
   day before the change set was written. The proof is `_touched`, the real time the tools record on each
   item they change: not `updated` (one edit anywhere in an investigation moved it for all its sources) and
   not a log line's date (--date back-dates those). An item edited by hand, with no `_touched`, falls back
   to its own dates (review, 3 Oct 2026). */
function lastTouched(R, id) {
  const f = find(R, id);
  if (!f) return null;
  const o = f.kind === "inv" ? f.iv : f.kind === "src" ? f.s : f.v;
  if (o._touched) return String(o._touched);
  const own = (f.kind === "inv" ? [o.updated] : [o.since, ...(o.log || []).map(e => e[0])]).filter(isDate).sort().pop();
  return own ? own + "T23:59:59Z" : "";
}
function claimsFor(R, changeSets) {
  const out = [];
  for (const c of changeSets) {
    const r = String(c.research || "");
    if (!r || /^none\s*:/i.test(r)) continue;
    const at = Date.parse(c.at || ""), day = String(c.at || "").slice(0, 10);
    if (isNaN(at)) { out.push(c.id + " names research items but has no readable time (at), so they cannot be checked"); continue; }
    for (const id of r.split(/[\s,;]+/).filter(Boolean)) {
      const t = lastTouched(R, id);
      if (t === null) out.push(c.id + " says it moves research item " + id + ", which is not in research.json");
      else if (!t || isNaN(Date.parse(t)) || Date.parse(t) < at - 864e5) out.push(c.id + " (" + day + ") says it moves " + id + ", but research.json shows no change to " + id +
        (t ? " since " + t.slice(0, 10) : "") + " — record it: node tools/research.js log|set|state|inv …");
    }
  }
  return out;
}

/* ---------- finding things ---------- */
function find(R, id) {
  for (const iv of R.investigations || []) {
    if (iv.id === id) return { kind: "inv", iv };
    for (let qi = 0; qi < iv.qs.length; qi++) for (const s of iv.qs[qi].src) if (s.id === id) return { kind: "src", iv, q: iv.qs[qi], qi, s };
  }
  if ((R.visits || {})[id]) return { kind: "visit", v: R.visits[id] };
  return null;
}
function nextId(R, prefix) {
  let n = 0;
  const seen = s => { const m = new RegExp("^" + prefix + "(\\d+)").exec(s); if (m) n = Math.max(n, +m[1]); };
  (R.investigations || []).forEach(iv => { seen(iv.id); iv.qs.forEach(q => q.src.forEach(s => seen(s.id))); });
  return prefix + (n + 1);
}

/* ---------- link people to cards ---------- */
function link(R, cards, write) {
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const yrsOk = (want, have) => {
    want = String(want || "").trim(); have = String(have || "").trim();
    if (!want) return true;
    if (want === have) return true;
    const w = want.replace(/^b\.\s*/, "").replace(/–\?$/, ""), first = (have.match(/\d{4}/) || [""])[0];
    return /^\d{4}$/.test(w) ? first === w : have.startsWith(w);
  };
  const report = [];
  const each = (list, where) => (list || []).forEach(p => {
    if (!p || typeof p !== "object" || p.card) return;
    const n = String(p.n || "");
    if (!n.trim()) { report.push("  " + where + ": a person with no name (n) — add it, then link again"); return; }
    /* whole words from the start of the name: a first name never matches a longer one that starts the
       same way, and a name given only in brackets is matched by what is in them, never by an empty
       string (review, 3 Oct 2026) */
    const nm = norm(n.replace(/\(.*?\)/g, " ")), alt = norm((n.match(/\((.*?)\)/) || [])[1] || "");
    const starts = (name, w) => !!w && (name === w || name.startsWith(w + " "));
    const hits = cards.filter(c => (starts(norm(c.name), nm) || starts(norm(c.name), alt)) && yrsOk(p.y, c.years));
    if (hits.length === 1) { report.push("  " + where + ": " + n + " " + (p.y || "") + " → " + hits[0].id + " (" + hits[0].name + ", " + hits[0].years + ")"); if (write) p.card = hits[0].id; }
    else report.push("  " + where + ": " + n + " " + (p.y || "") + " → " + (hits.length ? "ambiguous: " + hits.map(h => h.id + " " + h.name + " " + h.years).join("; ") : "no match") + " — set it by hand");
  });
  (R.investigations || []).forEach(iv => { each(iv.people, iv.id); (iv.qs || []).forEach((q, i) => each(q.people, iv.id + ".q" + (i + 1))); });
  return report;
}

/* ---------- status ---------- */
function status(R) {
  const lines = [];
  const byTier = { solo: [], assist: [], others: [], hold: [], closed: [] };
  (R.investigations || []).forEach(iv => byTier[invTier(iv)].push(iv));
  const name = { solo: "Ready to do (we can do it alone, now)", assist: "Needs Cory's OK", others: "Needs others", hold: "On hold", closed: "All checked" };
  lines.push("Research, updated " + R.updated);
  for (const t of [...TIERS, "closed"]) {
    if (!byTier[t].length) continue;
    lines.push("\n" + name[t] + " — " + byTier[t].length);
    byTier[t].sort((a, b) => (b.imp || 0) - (a.imp || 0)).forEach(iv => lines.push("  " + iv.id + "  " + iv.title + (iv.imp ? "  [imp " + iv.imp + "]" : "") + "\n        next: " + iv.next));
  }
  const cory = [];
  (R.investigations || []).forEach(iv => iv.qs.forEach(q => q.src.forEach(s => { if (tierOf(s) === "assist") cory.push("  " + s.id + "  " + s.t + "  (" + iv.id + ")" + (s.next ? "\n        " + s.next : "")); })));
  if (cory.length) lines.push("\nNeeds Cory's OK, source by source:\n" + cory.join("\n"));
  const decs = [];
  (R.investigations || []).forEach(iv => { if (iv.dec) decs.push(iv.id + " → " + iv.dec); iv.qs.forEach(q => q.src.forEach(s => { if (s.dec) decs.push(s.id + " → " + s.dec); })); });
  Object.entries(R.visits || {}).forEach(([id, v]) => { if (v.dec) decs.push(id + " → " + v.dec); });
  if (decs.length) lines.push("\nDecide buttons, item → Cory's card (a go… card is a Begin research button: Claude alone, online, R-0448)" + (R.decide ? "" : " (NO decide address: they do not show)") + ":\n  " + decs.join(", "));
  return lines.join("\n");
}

/* ---------- the command line ---------- */
function parseKV(args) {
  const o = {};
  for (const a of args) {
    const m = /^([a-z_]+)=([\s\S]*)$/i.exec(a);
    if (!m) throw new Error("expected key=value, got " + JSON.stringify(a));
    o[m[1]] = m[2];
  }
  return o;
}
function main(argv) {
  const args = argv.slice();
  const di = args.indexOf("--date");
  const day = di >= 0 ? args.splice(di, 2)[1] : today();
  if (!isDate(day)) throw new Error("--date must be YYYY-MM-DD");
  const writeLink = args.includes("--write"); if (writeLink) args.splice(args.indexOf("--write"), 1);
  const cmd = args.shift();
  const R = load();
  const touch = iv => { if (!iv.updated || iv.updated < day) iv.updated = day; if (!R.updated || R.updated < day) R.updated = day; };
  /* the real time of this edit, on each item it changed (never back-dated: the gate checks claims against it) */
  const now = new Date().toISOString().slice(0, 19) + "Z";
  const mark = (...items) => items.forEach(o => { if (o && typeof o === "object") o._touched = now; });
  const commit = (msg) => {
    const v = validate(R);
    v.warnings.forEach(w => console.log("  note  " + w));
    if (v.errors.length) { console.error("REFUSED — research.json would not validate; nothing was written:\n" + v.errors.map(e => "  - " + e).join("\n")); process.exit(1); }
    save(R);
    console.log(msg);
    const pw = password();
    if (!pw) { console.log("note: no password here, so media/research*.bin were NOT rebuilt — run node tools/research.js build where .password is"); return; }
    build(R, pw);
    console.log("rebuilt media/" + OUT.data + " and media/" + OUT.cards + " — commit them (and nothing else is needed for a research-only update)");
  };
  switch (cmd) {
    case "status": console.log(status(R)); return;
    case "show": {
      const f = find(R, args[0]); if (!f) throw new Error("no investigation, source or visit " + args[0]);
      console.log(JSON.stringify(f.kind === "inv" ? f.iv : f.kind === "src" ? Object.assign({ investigation: f.iv.id, question: f.qi + 1, q: f.q.q }, f.s) : f.v, null, 1)); return;
    }
    case "validate": {
      const v = validate(R);
      v.warnings.forEach(w => console.log("  note  " + w));
      if (v.errors.length) { console.error("INVALID — " + v.errors.length + " problem(s):\n" + v.errors.map(e => "  - " + e).join("\n")); process.exit(1); }
      const n = (R.investigations || []).reduce((a, iv) => a + iv.qs.reduce((b, q) => b + q.src.length, 0), 0);
      console.log("research.json is valid: " + R.investigations.length + " investigations, " + n + " sources, updated " + R.updated); return;
    }
    case "build": {
      const pw = password(); if (!pw) throw new Error("no password: set FT_PASSWORD or create .password");
      let r;
      try { r = build(R, pw); } catch (e) { if (e.v) { console.error("REFUSED:\n" + e.v.errors.map(x => "  - " + x).join("\n")); process.exit(1); } throw e; }
      r.v.warnings.forEach(w => console.log("  note  " + w));
      console.log("wrote media/" + OUT.data + " (" + r.f.data.length + " bytes) and media/" + OUT.cards + " (" + r.f.cards.length + " bytes); .research-stamp updated"); return;
    }
    case "check": {
      const r = check(R, password());
      r.warnings.forEach(w => console.log("  note  " + w));
      if (r.problems.length) { console.error("research: " + r.problems.length + " problem(s):\n" + r.problems.map(e => "  - " + e).join("\n")); process.exit(1); }
      console.log("research ok: valid, and media/ holds exactly what research.json makes"); return;
    }
    case "link": {
      const cards = cardsFromData(); if (!cards) throw new Error("no data.json to link against (node tools/crypt.js decrypt)");
      const rep = link(R, cards, writeLink);
      console.log(rep.length ? rep.join("\n") : "every person already has a card id");
      if (writeLink && rep.some(l => / → c\d+ \(/.test(l))) commit("saved the card ids");
      return;
    }
    case "set": {
      const id = args.shift(), f = find(R, id); if (!f || f.kind === "inv") throw new Error("set takes a source or a visit id; for an investigation use: inv");
      const kv = parseKV(args), o = f.kind === "src" ? f.s : f.v;
      const allowed = ["st", "who", "who_fr", "since", "next", "next_fr", "why", "why_fr", "where", "where_fr", "how", "how_fr", "by", "visit", "t", "t_fr", "dec", "pri", "pos", "access", "access_fr"];
      for (const [k, v] of Object.entries(kv)) {
        if (!allowed.includes(k)) throw new Error("set: " + k + " is not something set changes (" + allowed.join(", ") + ")");
        if (v === "") delete o[k];
        else if (k === "pos") { if (!/^\d{1,2}$/.test(v)) throw new Error("set: pos is a place on the visit list, 1 to 99"); o[k] = +v; }
        else o[k] = v;
      }
      if (kv.st && !kv.since) o.since = day;
      if (f.kind === "src") touch(f.iv); else if (!R.updated || R.updated < day) R.updated = day;
      mark(o, f.kind === "src" ? f.iv : null);
      return commit("set " + Object.keys(kv).join(", ") + " on " + id);
    }
    case "log": {
      const id = args.shift(), en = args.shift(), fr = args.shift();
      if (!en || !fr) throw new Error('usage: log <source|visit> "<English>" "<French>" [--date YYYY-MM-DD]');
      const f = find(R, id); if (!f || f.kind === "inv") throw new Error("log takes a source or a visit id");
      const o = f.kind === "src" ? f.s : f.v;
      (o.log = o.log || []).push([day, en, fr]);
      o.log.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      if (f.kind === "src") touch(f.iv); else if (!R.updated || R.updated < day) R.updated = day;
      mark(o, f.kind === "src" ? f.iv : null);
      return commit("logged on " + id + " (" + day + ")");
    }
    case "answer": case "state": {
      const id = args.shift(), qn = +args.shift(), f = find(R, id);
      if (!f || f.kind !== "inv") throw new Error(cmd + " takes an investigation id and a question number");
      const q = f.iv.qs[qn - 1]; if (!q) throw new Error(id + " has no question " + qn);
      if (cmd === "answer") { const en = args.shift(), fr = args.shift(); if (!en || !fr) throw new Error('usage: answer <inv> <no.> "<note>" "<note in French>"'); q.state = "answered"; q.note = en; q.note_fr = fr; }
      else { const st = args.shift(); if (!QSTATES.includes(st)) throw new Error("state must be one of " + QSTATES.join(", ")); q.state = st; }
      touch(f.iv); mark(f.iv);
      return commit((cmd === "answer" ? "answered " : "set the state of ") + id + " question " + qn);
    }
    case "inv": {
      const id = args.shift(), f = find(R, id); if (!f || f.kind !== "inv") throw new Error("inv takes an investigation id");
      const kv = parseKV(args);
      const allowed = ["title", "title_fr", "line", "line_fr", "next", "next_fr", "summary", "summary_fr", "imp", "branch", "onTree", "theme", "dec"];
      for (const [k, v] of Object.entries(kv)) {
        if (!allowed.includes(k)) throw new Error("inv: " + k + " is not something inv changes (" + allowed.join(", ") + ")");
        if (k === "dec" && v === "") { delete f.iv.dec; continue; }
        f.iv[k] = k === "imp" ? +v : k === "onTree" ? v !== "false" : v;
      }
      touch(f.iv); mark(f.iv);
      return commit("changed " + Object.keys(kv).join(", ") + " on " + id);
    }
    case "add-source": {
      const id = args.shift(), qn = +args.shift(), f = find(R, id);
      if (!f || f.kind !== "inv" || !f.iv.qs[qn - 1]) throw new Error("add-source takes an investigation id, a question number and the source as JSON");
      const s = JSON.parse(args.shift() || "{}");
      if (!s.id) s.id = nextId(R, "s");
      if (!s.since && !CLOSED.has(s.st)) s.since = day;
      f.iv.qs[qn - 1].src.push(s);
      touch(f.iv); mark(s, f.iv);
      return commit("added source " + s.id + " to " + id + " question " + qn);
    }
    case "add-question": {
      const id = args.shift(), f = find(R, id); if (!f || f.kind !== "inv") throw new Error("add-question takes an investigation id and the question as JSON");
      const q = JSON.parse(args.shift() || "{}"); q.src = q.src || [];
      q.src.forEach(s => { if (!s.id) s.id = nextId(R, "s"); });
      f.iv.qs.push(q); touch(f.iv); mark(f.iv, ...q.src);
      return commit("added question " + f.iv.qs.length + " to " + id);
    }
    case "add-inv": {
      const iv = JSON.parse(args.shift() || "{}");
      if (!iv.id) iv.id = nextId(R, "i");
      iv.updated = day; (R.investigations = R.investigations || []).push(iv);
      mark(iv, ...(iv.qs || []).flatMap(q => q.src || []));
      if (!R.updated || R.updated < day) R.updated = day;
      return commit("added investigation " + iv.id);
    }
    case "decide": {   /* the address of Cory's private decisions page, which the Decide buttons open */
      const url = args.shift();
      if (url === undefined) throw new Error('usage: decide <https://claude.ai/artifact/…> (or "" to remove it)');
      if (url === "") delete R.decide; else R.decide = url;
      if (!R.updated || R.updated < day) R.updated = day;
      return commit(url ? "set the decisions page address" : "removed the decisions page address");
    }
    default:
      console.error("usage: node tools/research.js status | show <id> | validate | build | check | link [--write] |\n" +
        "       set <id> k=v … | log <id> \"<en>\" \"<fr>\" | answer <inv> <no.> \"<en>\" \"<fr>\" | state <inv> <no.> <state> |\n" +
        "       inv <inv> k=v … | add-source <inv> <no.> '<json>' | add-question <inv> '<json>' | add-inv '<json>' | decide <url>   [--date YYYY-MM-DD]");
      process.exit(2);
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error("FAILED: " + e.message); process.exit(1); }
}
module.exports = { password, FILE, OUT, STAMP, STATUSES, QSTATES, TIERS, tierOf, invTier, load, validate, publicCopy, cardIndex, sealed, build, check,
  claimsFor, lastTouched, blobId, link, status, find, isDate };
