#!/usr/bin/env node
/*
 * TEMPORARY AUDIT BRANCH — never merge this file into main.
 *
 * On this branch tests/run.js is replaced by a single read-only audit: it decrypts the payload with the
 * repository's own secret, counts any living person whose birthday (finer than the year) is on the site,
 * and reports the counts. It prints counts only — never a name — and always exits 0: it is a measurement,
 * not a gate. The real guard is the same block, installed into the full suite on main.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("node:crypto");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name); } }
function section(t) { console.log("\n== " + t + " =="); }

(async () => {
const PW = (process.env.FT_PASSWORD || "").trim();
if (!PW) { console.log("::notice title=Living people - year only::no password available, nothing audited"); return; }
const ENC = JSON.parse(html.match(/const ENC = (\{[^}]*\});/)[1].replace(/(\w+):/g, '"$1":'));
const b = s => Buffer.from(s, "base64");
const km = await webcrypto.subtle.importKey("raw", Buffer.from(PW), "PBKDF2", false, ["deriveKey"]);
const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt: b(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
  km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
const DATA = JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b(ENC.iv) }, key, b(ENC.ct))).toString("utf8"));
/* the same tree walk the page does: a person's children hang off their unions */
const allNodes = [];
(function build(p, parent) {
  const n = { p, parent, children: [] };
  allNodes.push(n);
  (p.unions || []).forEach(u => (u.c || []).forEach(c => n.children.push(build(c, n))));
  return n;
})(DATA, null);
console.log("people in the payload: " + allNodes.length);

/* ---------- 5b. Living people: the year, never the day ----------
 * Cory's rule, set 7 Sep 2026 and restated 20 Sep: a living person's birthday is NOT on the
 * site — the year and the place, nothing finer. Until this section nothing enforced it, so a
 * single card written by a session that had not read the rule would have put one back.
 *
 * "Living" is the site's own definition — a dates line that opens "b." — widened by the one
 * section 14 uses (born 1930 or later, no death recorded), and capped at 110 years so that an
 * open dates line from another century is not mistaken for a living person. Offenders are
 * named locally only: CI logs are public and get counts. */
section("Living people: year only");
{
  const PUBLIC = !!(process.env.CI || process.env.GITHUB_ACTIONS);
  const THIS_YEAR = new Date().getFullYear();
  /* ft-allow-names-begin: month names in English and French — calendar vocabulary, not people */
  const MONTH = "(?:jan(?:uary|vier|v)?|f[eé]b(?:ruary)?|f[eé]v(?:rier|r)?|mar(?:ch|s)?|a[pv]r(?:il)?|may|mai|june?|juin|july?|juil(?:let)?|aug(?:ust)?|ao[uû]t|sep(?:t(?:ember|embre)?)?|oct(?:ober|obre)?|nov(?:ember|embre)?|d[eé]c(?:ember|embre)?)\\.?";
  /* ft-allow-names-end */
  const ORD = "(?:st|nd|rd|th|er|ᵉʳ)?";
  /* every way a day-date is written on this site or in its sources; group "y" is the year */
  const FULL = [
    new RegExp("(?<![\\p{L}\\d])\\d{1,2}" + ORD + "\\s+" + MONTH + ",?\\s+(?<y>\\d{4})(?!\\d)", "giu"),   /* 28 May 1870 · 1er mars 1870 */
    new RegExp("(?<![\\p{L}\\d])" + MONTH + "\\s+\\d{1,2}" + ORD + ",?\\s+(?<y>\\d{4})(?!\\d)", "giu"),   /* May 28, 1870 */
    /(?<!\d)\d{1,2}[./-]\d{1,2}[./-](?<y>\d{4})(?!\d)/g,                                                  /* 28/05/1870 */
    /(?<!\d)(?<y>\d{4})-\d{2}-\d{2}(?!\d)/g                                                                /* 1870-05-28 */
  ];
  /* a day and a month with no year, straight after a word about being born */
  const BORN = "(?:born|birthday|birth|n[ée]e?s?|naissance|naquit|anniversaire)";
  const NOYEAR = [
    new RegExp("(?<![\\p{L}])" + BORN + "(?![\\p{L}])[^.;]{0,30}?(?<![\\p{L}\\d])\\d{1,2}" + ORD + "\\s+" + MONTH + "(?![\\p{L}])", "giu"),
    new RegExp("(?<![\\p{L}])" + BORN + "(?![\\p{L}])[^.;]{0,30}?(?<![\\p{L}])" + MONTH + "\\s+\\d{1,2}" + ORD + "(?![\\p{L}\\d])", "giu")
  ];
  const yearOf = s => +((String(s || "").match(/\d{4}/) || [])[0] || 0);
  const livingLine = s => {
    const y = String(s || ""), b = yearOf(y);
    if (!b || b < THIS_YEAR - 110) return false;
    if (/^\s*b\./i.test(y)) return true;
    return b >= 1930 && !/\d{4}\s*[–—-]\s*(\d{4}|\?)/.test(y) && !/^\s*(d\.|\?)/i.test(y);
  };
  const hasDayDate = s => new RegExp("(?<![\\p{L}])" + MONTH + "(?![\\p{L}])", "iu").test(String(s || "")) || /\d{1,2}[./-]\d{1,2}/.test(String(s || ""));
  /* every string a card shows, the person's own only: children are other cards, images and links are not prose */
  const SKIP = new Set(["img", "imgL", "u", "url", "k", "d", "years", "name"]);   /* a pin's own `d` is check 2's business */
  const ownText = p => {
    const out = [];
    (function walk(o, key) {
      if (typeof o === "string") { if (!SKIP.has(key)) out.push(o); return; }
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(x => walk(x, key)); return; }
      Object.keys(o).forEach(k => { if (k === "c" && Array.isArray(o[k])) return; walk(o[k], k); });
    })(p, "");
    return out;
  };
  const datesIn = text => {
    const hits = [];
    FULL.forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(text))) hits.push({ y: +m.groups.y, at: m.index }); });
    return hits;
  };
  const living = allNodes.filter(n => livingLine(n.p.years));
  const who = list => PUBLIC ? "" : ": " + [...new Set(list)].join("; ");

  /* 1. the dates line itself */
  const badLine = living.filter(n => hasDayDate(n.p.years)).map(n => n.p.name);
  ok(!badLine.length, "a living person's dates line carries the year only (" + living.length + " living people)" + (badLine.length ? " — " + badLine.length + who(badLine) : ""));
  /* 2. the birth and baptism pins: a year, never a `d` */
  const badPin = living.filter(n => (n.p.pl || []).some(r => (r.t === "birth" || r.t === "baptism") && r.d !== undefined)).map(n => n.p.name);
  ok(!badPin.length, "no living person's birth or baptism pin carries a day-date" + (badPin.length ? " — " + badPin.length + who(badPin) : ""));
  /* 3. their own card's prose: a full date in their birth year, or a day and month after a word about being born */
  const badText = [];
  living.forEach(n => {
    const by = yearOf(n.p.years);
    ownText(n.p).forEach(t => {
      if (datesIn(t).some(h => h.y === by) || NOYEAR.some(re => { re.lastIndex = 0; return re.test(t); })) badText.push(n.p.name);
    });
  });
  ok(!badText.length, "no living person's own card spells out their birthday" + (badText.length ? " — " + new Set(badText).size + who(badText) : ""));
  /* 4. a living spouse is a line on someone else's card: same rule */
  const badSpouse = [];
  allNodes.forEach(n => (n.p.unions || []).forEach(u => { if (u.s && livingLine(u.sy) && hasDayDate(u.sy)) badSpouse.push(u.s); }));
  ok(!badSpouse.length, "a living spouse's dates line carries the year only" + (badSpouse.length ? " — " + badSpouse.length + who(badSpouse) : ""));
  /* 5. anyone else's card: a full date straight after a word about being born, in a year a living
   *    relative of that card was born (a child, or a spouse) — the way a parent's bio gives a child away */
  const badKin = [];
  allNodes.forEach(n => {
    const years = new Set();
    n.children.forEach(c => { if (livingLine(c.p.years)) years.add(yearOf(c.p.years)); });
    (n.p.unions || []).forEach(u => { if (livingLine(u.sy)) years.add(yearOf(u.sy)); });
    if (!years.size) return;
    const bornRe = new RegExp("(?<![\\p{L}])" + BORN + "(?![\\p{L}])[^.;]{0,40}$", "iu");
    ownText(n.p).forEach(t => datesIn(t).forEach(h => { if (years.has(h.y) && bornRe.test(t.slice(Math.max(0, h.at - 60), h.at))) badKin.push(n.p.name); }));
  });
  ok(!badKin.length, "no card spells out the birthday of a living child or spouse" + (badKin.length ? " — " + new Set(badKin).size + who(badKin) : ""));
  /* not a failure, a count: Cory's 7 Sep rule was wider (no day-dates at all for the living). Other pins
   * that still carry one are reported so the drift is visible, and left for him to rule on. */
  const otherPins = living.reduce((a, n) => a + (n.p.pl || []).filter(r => r.d !== undefined && r.t !== "birth" && r.t !== "baptism").length, 0);
  console.log("  --  other day-dated pins on living people (reported, not enforced): " + otherPins);
  const counts = [badLine.length, badPin.length, new Set(badText).size, badSpouse.length, new Set(badKin).size, otherPins];
  if (process.env.GITHUB_ACTIONS)
    console.log("::notice title=Living people - year only::dates lines " + counts[0] + " | birth pins " + counts[1] + " | own card text " + counts[2] +
      " | spouse lines " + counts[3] + " | on a relative's card " + counts[4] + " | other day-dated pins (not enforced) " + counts[5] + " | living people " + living.length);
}


console.log("\n" + pass + " clean, " + fail + " with offenders (counts only; this audit never fails the run)");
})().catch(e => { console.log("::notice title=Living people - year only::audit could not run (" + e.name + ")"); });
