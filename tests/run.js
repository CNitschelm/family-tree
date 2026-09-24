#!/usr/bin/env node
/*
 * TEMPORARY AUDIT BRANCH — never merge this file into main.
 *
 * Read-only. Decrypts the payload with the repository's own secret and counts, for living people, every
 * date finer than the year — split by kind, so a full day-month-year birth date is told apart from a
 * month-and-year, a day-and-month, or the date of some other event. Prints counts only, never a name or
 * a date, and always exits 0: a measurement, not a gate.
 */
"use strict";
const fs = require("fs"), path = require("path"), { webcrypto } = require("node:crypto");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const note = s => console.log("::notice title=Living people - dates::" + s);

(async () => {
const PW = (process.env.FT_PASSWORD || "").trim();
if (!PW) { note("no password available, nothing audited"); return; }
const ENC = JSON.parse(html.match(/const ENC = (\{[^}]*\});/)[1].replace(/(\w+):/g, '"$1":'));
const b64 = s => Buffer.from(s, "base64");
const km = await webcrypto.subtle.importKey("raw", Buffer.from(PW), "PBKDF2", false, ["deriveKey"]);
const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(ENC.salt), iterations: ENC.iter, hash: "SHA-256" },
  km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
const DATA = JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b64(ENC.iv) }, key, b64(ENC.ct))).toString("utf8"));
const all = [];
(function build(p, parent) {
  const n = { p, parent, children: [] };
  all.push(n);
  (p.unions || []).forEach(u => (u.c || []).forEach(c => n.children.push(build(c, n))));
  return n;
})(DATA, null);

const THIS_YEAR = new Date().getFullYear();
/* ft-allow-names-begin: month names in English and French — calendar vocabulary, not people */
const MONTH = "(?:jan(?:uary|vier|v)?|f[eé]b(?:ruary)?|f[eé]v(?:rier|r)?|mar(?:ch|s)?|a[pv]r(?:il)?|may|mai|june?|juin|july?|juil(?:let)?|aug(?:ust)?|ao[uû]t|sep(?:t(?:ember|embre)?)?|oct(?:ober|obre)?|nov(?:ember|embre)?|d[eé]c(?:ember|embre)?)\\.?";
/* ft-allow-names-end */
const ORD = "(?:st|nd|rd|th|er|ᵉʳ)?";
const L = "\\p{L}";
/* a full day-month-year date, every way the site writes one; group y is the year */
const FULL = () => [
  new RegExp(`(?<![${L}\\d])\\d{1,2}${ORD}\\s+${MONTH},?\\s+(?<y>\\d{4})(?!\\d)`, "giu"),
  new RegExp(`(?<![${L}\\d])${MONTH}\\s+\\d{1,2}${ORD},?\\s+(?<y>\\d{4})(?!\\d)`, "giu"),
  /(?<!\d)\d{1,2}[./-]\d{1,2}[./-](?<y>\d{4})(?!\d)/g,
  /(?<!\d)(?<y>\d{4})-\d{2}-\d{2}(?!\d)/g
];
/* a word that says the date is a birth: "ne" (French negation, no accent) and "née X" (a maiden name) are NOT counted */
const BORN = `(?:born|birthday|birth|b\\.(?=\\s*\\d)|naissance|naquit|anniversaire|né(?:e?s?)(?=\\s+(?:le|en|à|au|vers|dans)(?![${L}])))`;
const BORN_BEFORE = new RegExp(`(?<![${L}])${BORN}(?![${L}])[^.;]{0,40}$`, "iu");
const DAY_MONTH = [   /* a birthday with no year */
  new RegExp(`(?<![${L}])${BORN}(?![${L}])[^.;]{0,30}?(?<![${L}\\d])\\d{1,2}${ORD}\\s+${MONTH}(?![${L}])(?!,?\\s+\\d{4})`, "iu"),
  new RegExp(`(?<![${L}])${BORN}(?![${L}])[^.;]{0,30}?(?<![${L}])${MONTH}\\s+\\d{1,2}${ORD}(?![${L}\\d])(?!,?\\s+\\d{4})`, "iu")
];
const MONTH_YEAR = new RegExp(`(?<!\\d\\s?)(?<![${L}])${MONTH}\\s+(?<y>\\d{4})(?!\\d)`, "giu");

const yearOf = s => +((String(s || "").match(/\d{4}/) || [])[0] || 0);
const livingLine = s => {
  const y = String(s || ""), b = yearOf(y);
  if (!b || b < THIS_YEAR - 110) return false;
  if (/^\s*b\./i.test(y)) return true;
  return b >= 1930 && !/\d{4}\s*[–—-]\s*(\d{4}|\?)/.test(y) && !/^\s*(d\.|\?)/i.test(y);
};
const finerThanYear = s => new RegExp(`(?<![${L}])${MONTH}(?![${L}])`, "iu").test(String(s || "")) || /\d{1,2}[./-]\d{1,2}/.test(String(s || ""));
const fullDates = t => { const out = []; FULL().forEach(re => { let m; while ((m = re.exec(t))) out.push({ y: +m.groups.y, at: m.index, end: m.index + m[0].length }); }); return out; };
const isFull = d => fullDates(String(d || "")).length > 0;
const SKIP = new Set(["img", "imgL", "u", "url", "k", "d", "years", "name"]);
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

const living = all.filter(n => livingLine(n.p.years));
const S = () => new Set();
const pinFull = S(), pinPartial = S(), pinOtherFull = S(), txtFullWord = S(), txtFullOther = S(), txtDayMonth = S(),
      txtMonthYear = S(), txtOtherEvent = S(), lineFiner = S(), kinCards = S(), kinPeople = S();
living.forEach(n => {
  const by = yearOf(n.p.years);
  if (finerThanYear(n.p.years)) lineFiner.add(n);
  (n.p.pl || []).forEach(r => {
    if (r.d === undefined || r.d === "") return;
    const bb = r.t === "birth" || r.t === "baptism";
    if (bb) (isFull(r.d) ? pinFull : pinPartial).add(n);
    else if (isFull(r.d)) pinOtherFull.add(n);
  });
  ownText(n.p).forEach(t => {
    const fd = fullDates(t);
    fd.forEach(h => {
      if (h.y !== by) { txtOtherEvent.add(n); return; }
      (BORN_BEFORE.test(t.slice(Math.max(0, h.at - 60), h.at)) ? txtFullWord : txtFullOther).add(n);
    });
    if (DAY_MONTH.some(re => re.test(t))) txtDayMonth.add(n);
    MONTH_YEAR.lastIndex = 0; let m;
    while ((m = MONTH_YEAR.exec(t))) {
      if (+m.groups.y !== by || fd.some(h => m.index >= h.at && m.index < h.end)) continue;
      if (BORN_BEFORE.test(t.slice(Math.max(0, m.index - 60), m.index))) txtMonthYear.add(n);
    }
  });
});
let spouseFiner = 0;
all.forEach(n => {
  const kin = [];
  n.children.forEach(c => { if (livingLine(c.p.years)) kin.push({ who: c, y: yearOf(c.p.years) }); });
  (n.p.unions || []).forEach((u, i) => {
    if (!livingLine(u.sy)) return;
    if (finerThanYear(u.sy)) spouseFiner++;
    kin.push({ who: n.p.name + "#" + i, y: yearOf(u.sy) });
  });
  if (!kin.length) return;
  ownText(n.p).forEach(t => fullDates(t).forEach(h => {
    if (!BORN_BEFORE.test(t.slice(Math.max(0, h.at - 60), h.at))) return;
    const hit = kin.filter(k => k.y === h.y);
    if (hit.length) { kinCards.add(n); hit.forEach(k => kinPeople.add(k.who)); }
  }));
});
const union = (...sets) => { const u = new Set(); sets.forEach(s => s.forEach(x => u.add(x))); return u.size; };
note(`FULL BIRTH DATES (day month year) - living people with one on the site: ${union(pinFull, txtFullWord, kinPeople)} ` +
     `| on their birth or baptism pin (shown on the bio card and the map): ${pinFull.size} ` +
     `| written in their own card next to a birth word: ${txtFullWord.size} ` +
     `| written on a parent's or spouse's card: ${kinCards.size} cards, ${kinPeople.size} living people ` +
     `| a full date in their birth year with no birth word next to it (probably the birth or baptism): ${txtFullOther.size}`);
note(`PARTIAL - birth or baptism pin with a date that is not a full day-month-year: ${pinPartial.size} ` +
     `| birthday as day and month, no year: ${txtDayMonth.size} | birth month and year, no day: ${txtMonthYear.size} ` +
     `| dates line finer than the year: ${lineFiner.size} | living spouse line finer than the year: ${spouseFiner}`);
note(`NOT A BIRTHDAY - living people with a full date for some other event: on a map pin ${pinOtherFull.size}, in card text ${txtOtherEvent.size} ` +
     `| living people covered: ${living.length} of ${all.length}`);
})().catch(e => note("audit could not run (" + e.name + ")"));
