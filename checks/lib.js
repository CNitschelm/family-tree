'use strict';
// Shared extractor for the family-tree machine checks.
// Walks data.json and exposes every user-visible string with a stable field path.
const fs = require('fs');
const path = require('path');

const DATA = process.env.FT_DATA || path.join(__dirname, '..', 'data.json');

function load() {
  const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const people = [];
  (function walk(n, parent, ppath) {
    people.push({ node: n, parent, ppath });
    (n.unions || []).forEach((u, ui) =>
      (u.c || []).forEach((c, ci) => walk(c, n, ppath + `/u${ui}c${ci}`)));
  })(d, null, 'root');
  people.forEach((p, i) => { p.idx = i; p.id = `${p.node.name} ${p.node.years || ''}`.trim(); });
  return { data: d, people, gaz: d.gaz || {} };
}

// ---------------------------------------------------------------- fields
// Every user-visible prose string on a card, with its path and language.
// kind: tooltip | mapnote | headline | bio | union | pin | srclabel | srcquote
//       | psource | doccap | doctr
function fields(p) {
  const n = p.node, out = [];
  const add = (path, lang, kind, text, extra) => {
    if (typeof text === 'string' && text.trim()) out.push({ path, lang, kind, text, ...(extra || {}) });
  };
  add('note', 'en', 'tooltip', n.note);
  add('note_fr', 'fr', 'tooltip', n.note_fr);
  add('mn', 'en', 'mapnote', n.mn);
  add('mn_fr', 'fr', 'mapnote', n.mn_fr);
  const pr = n.profile || {};
  add('profile.headline', 'en', 'headline', pr.headline);
  add('profile.headline_fr', 'fr', 'headline', pr.headline_fr);
  (pr.bio || []).forEach((t, i) => add(`bio[${i}]`, 'en', 'bio', t, { i }));
  (pr.bio_fr || []).forEach((t, i) => add(`bio_fr[${i}]`, 'fr', 'bio', t, { i }));
  (pr.sources || []).forEach((s, i) => {
    add(`profile.sources[${i}].label`, 'en', 'psource', s.label, { i });
    add(`profile.sources[${i}].label_fr`, 'fr', 'psource', s.label_fr, { i });
  });
  (pr.docs || []).forEach((d, i) => {
    add(`docs[${i}].cap`, 'en', 'doccap', d.cap, { i });
    add(`docs[${i}].cap_fr`, 'fr', 'doccap', d.cap_fr, { i });
    add(`docs[${i}].tr`, 'en', 'doctr', d.tr, { i });
    add(`docs[${i}].tr_fr`, 'fr', 'doctr', d.tr_fr, { i });
  });
  (n.src || []).forEach((s, i) => {
    add(`src[${i}].l`, 'en', 'srclabel', s.l, { i });
    add(`src[${i}].q`, 'en', 'srcquote', s.q, { i });
  });
  (n.unions || []).forEach((u, i) => {
    add(`union[${i}].n`, 'en', 'union', u.n, { i });
    add(`union[${i}].n_fr`, 'fr', 'union', u.n_fr, { i });
  });
  (n.pl || []).forEach((r, i) => {
    add(`pl[${i}].w`, 'en', 'pin', r.w, { i, row: r });
    add(`pl[${i}].w_fr`, 'fr', 'pin', r.w_fr, { i, row: r });
  });
  return out;
}

// Paired EN/FR fields for parity checking.
function pairs(p) {
  const n = p.node, pr = n.profile || {}, out = [];
  const P = (label, en, fr, kind) => out.push({ label, en, fr, kind });
  P('note', n.note, n.note_fr, 'tooltip');
  P('mn', n.mn, n.mn_fr, 'mapnote');
  P('headline', pr.headline, pr.headline_fr, 'headline');
  const nb = Math.max((pr.bio || []).length, (pr.bio_fr || []).length);
  for (let i = 0; i < nb; i++) P(`bio[${i}]`, (pr.bio || [])[i], (pr.bio_fr || [])[i], 'bio');
  (pr.sources || []).forEach((s, i) => P(`profile.sources[${i}]`, s.label, s.label_fr, 'psource'));
  (pr.docs || []).forEach((d, i) => {
    P(`docs[${i}].cap`, d.cap, d.cap_fr, 'doccap');
    P(`docs[${i}].tr`, d.tr, d.tr_fr, 'doctr');
  });
  (n.unions || []).forEach((u, i) => P(`union[${i}].n`, u.n, u.n_fr, 'union'));
  (n.pl || []).forEach((r, i) => P(`pl[${i}].w`, r.w, r.w_fr, 'pin'));
  return out.filter(x => (x.en && x.en.trim()) || (x.fr && x.fr.trim()));
}

// The card's own evidence inventory — everything the reader can see as a source.
function sourceInventory(p) {
  const n = p.node, pr = n.profile || {}, items = [];
  (n.src || []).forEach((s, i) => items.push({ path: `src[${i}]`, text: [s.l, s.u].filter(Boolean).join(' ') }));
  (pr.sources || []).forEach((s, i) => items.push({ path: `profile.sources[${i}]`, text: [s.label, s.label_fr, s.url].filter(Boolean).join(' ') }));
  (pr.docs || []).forEach((d, i) => items.push({ path: `docs[${i}]`, text: [d.cap, d.cap_fr, d.u, d.tr].filter(Boolean).join(' ') }));
  return items;
}

// ---------------------------------------------------------------- text utils
const NBSP = /[  ]/g;
const norm = s => (s || '').replace(NBSP, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function sentences(s) {
  const t = norm(s).trim();
  if (!t) return [];
  // protect abbreviations and initials before splitting
  const prot = t
    .replace(/\b([A-Z])\./g, '$1')
    .replace(/\b(Mr|Mrs|Ms|Dr|St|Ste|Jr|Sr|vol|no|p|pp|c|ca|approx|Rev|Co|Inc|etc|cf|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./gi, '$1');
  const parts = prot.split(/(?<=[.!?])["')\]]?\s+(?=[A-ZÀ-Ý"'(—])/);
  return parts.map(x => x.replace(//g, '.').trim()).filter(Boolean);
}

const NUMWORD = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12
};
const FRNUM = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100,
  premier: 1, deuxieme: 2, troisieme: 3, quatrieme: 4, cinquieme: 5
};

// "thirty-eight", "sixty-five", "twenty three"
function wordToNum(w) {
  const s = w.toLowerCase().replace(/[–—]/g, '-');
  if (/^\d+$/.test(s)) return +s;
  const parts = s.split(/[-\s]+/).filter(Boolean);
  let total = 0, ok = false;
  for (const p of parts) {
    const v = NUMWORD[p];
    if (v === undefined) return null;
    ok = true; total += v;
  }
  return ok ? total : null;
}
const NUMWORD_RE = new RegExp(
  '\\b(?:' + Object.keys(NUMWORD).sort((a, b) => b.length - a.length).join('|') + ')' +
  '(?:[-\\s](?:' + Object.keys(NUMWORD).join('|') + '))?\\b', 'gi');

// ---------------------------------------------------------------- dates
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONFR = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12
};
const deacc = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Find every explicit date in a string. Returns {y,m,d,raw,index}
function findDates(s) {
  const t = norm(s), out = [];
  let m;
  const reEn = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{3,4})\b/gi;
  while ((m = reEn.exec(t))) out.push({ d: +m[1], m: MON[m[2].slice(0, 3).toLowerCase()], y: +m[3], raw: m[0], index: m.index });
  const reEn2 = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{3,4})\b/gi;
  while ((m = reEn2.exec(t))) out.push({ d: +m[2], m: MON[m[1].slice(0, 3).toLowerCase()], y: +m[3], raw: m[0], index: m.index });
  const td = deacc(t);
  const reFr = /\b(\d{1,2}|1er)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{3,4})\b/gi;
  while ((m = reFr.exec(td))) out.push({ d: m[1] === '1er' ? 1 : +m[1], m: MONFR[m[2].toLowerCase()], y: +m[3], raw: m[0], index: m.index });
  // de-dup by index span
  const seen = new Set(); const uniq = [];
  for (const o of out) { const k = o.y + '-' + o.m + '-' + o.d; if (!seen.has(k + ':' + o.index)) { seen.add(k + ':' + o.index); uniq.push(o); } }
  return uniq.sort((a, b) => a.index - b.index);
}

function findYears(s) {
  const out = []; let m;
  const re = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
  const t = norm(s);
  while ((m = re.exec(t))) out.push({ y: +m[1], index: m.index });
  return out;
}

// days between two civil dates (proleptic Gregorian arithmetic on the given fields)
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
function jdnJulian(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - 32083;
}
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOWFR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
// Protestant Alsace used the Julian calendar until Feb 1682.
function weekday(y, m, d, julian) {
  const j = julian ? jdnJulian(y, m, d) : jdn(y, m, d);
  return DOW[((j % 7) + 7) % 7];
}
const isJulianEra = (y, m) => (y < 1682) || (y === 1682 && m <= 2);

// full years between two dates
function ageBetween(b, e) {
  let a = e.y - b.y;
  if (e.m < b.m || (e.m === b.m && e.d < b.d)) a--;
  return a;
}

// haversine km
function distKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// person's own structural birth/death years from `years`
function yearsOf(node) {
  const y = norm(node.years || '');
  let m = y.match(/^(\d{4})\s*[–—-]\s*(\d{4}|\?)$/);
  if (m) return { b: +m[1], d: m[2] === '?' ? null : +m[2] };
  m = y.match(/^b\.\s*(\d{4})$/i); if (m) return { b: +m[1], d: null };
  m = y.match(/^d\.\s*(\d{4})$/i); if (m) return { b: null, d: +m[1] };
  m = y.match(/^c\.?\s*(\d{4})/i); if (m) return { b: +m[1], d: null, approx: true };
  m = y.match(/(\d{4})/); return m ? { b: +m[1], d: null, loose: true } : { b: null, d: null };
}

module.exports = {
  load, fields, pairs, sourceInventory, sentences, norm, deacc,
  findDates, findYears, wordToNum, NUMWORD_RE, NUMWORD, FRNUM,
  jdn, jdnJulian, weekday, isJulianEra, ageBetween, distKm, yearsOf, DOW, DOWFR
};
