'use strict';
// The eight machine checks (plus extras) from REMEDIATION-PLAN.md §3.
// Usage: node checks/run.js [--json out.json] [--only=C1,C2]
const fs = require('fs');
const L = require('./lib.js');
const V = require('./vocab.js');
const AGE = require('./age.js');

const { data, people, gaz } = L.load();
const findings = [];
let FID = 0;
function F(check, sev, p, path, msg, detail) {
  findings.push({ id: ++FID, check, sev, card: p ? p.id : '(tree)', idx: p ? p.idx : null, path, msg, detail });
}

const lc = s => L.deacc(L.norm(s)).toLowerCase();
function hasHedge(s, lang) {
  const t = lc(s), hits = [];
  // a documented negative that SUPPORTS the stated value is not a hedge on it
  if (lang === 'fr' ? V.NEGATIVE_SUPPORT_FR.test(t) : V.NEGATIVE_SUPPORT.test(t)) return [];
  const list = lang === 'fr' ? V.HEDGE_FR : V.HEDGE_EN;
  const res = lang === 'fr' ? V.HEDGE_FR_RE : V.HEDGE_EN_RE;
  for (const h of list) if (t.includes(L.deacc(h))) hits.push(h);
  for (const r of res) { const m = t.match(r); if (m) hits.push(m[0]); }
  return hits;
}

// ---------------------------------------------------------------- indexes
// name -> {birth:{y,m,d}, death, node}  for tree people and union spouses
const NAMEIDX = new Map();
function addName(name, rec) {
  const k = lc(name);
  if (k.length < 4) return;
  if (!NAMEIDX.has(k)) NAMEIDX.set(k, []);
  NAMEIDX.get(k).push(rec);
}
for (const p of people) {
  const y = L.yearsOf(p.node);
  const bpin = (p.node.pl || []).find(r => r.t === 'birth' && r.d);
  const dpin = (p.node.pl || []).find(r => r.t === 'death' && r.d);
  const rec = {
    who: p.id,
    birth: bpin ? L.findDates(bpin.d)[0] : (y.b ? { y: y.b, m: null, d: null, approx: true } : null),
    death: dpin ? L.findDates(dpin.d)[0] : (y.d ? { y: y.d, m: null, d: null, approx: true } : null),
    node: p.node
  };
  const parts = L.norm(p.node.name).split(/\s+/);
  addName(p.node.name, rec);
  addName(parts.slice(0, -1).join(' '), rec);       // given names without surname
  addName(parts.slice(0, 2).join(' '), rec);
  addName(parts[0], rec);
  (p.node.unions || []).forEach(u => {
    if (!u.s) return;
    const sy = L.yearsOf({ years: u.sy || '' });
    const srec = { who: u.s + ' (' + (u.sy || '?') + ')', birth: sy.b ? { y: sy.b, m: null, d: null, approx: true } : null, death: sy.d ? { y: sy.d, m: null, d: null, approx: true } : null };
    addName(u.s, srec);
    const sp = L.norm(u.s).split(/\s+/);
    addName(sp.slice(0, -1).join(' '), srec);
    addName(sp[0], srec);
  });
}
function resolveName(name) {
  const k = lc(name);
  const exact = NAMEIDX.get(k);
  if (exact) return exact;
  // whole-token containment only (never substring): every token of the query
  // must appear as a whole token of the indexed name, or vice versa.
  const qt = k.split(/[^a-z]+/).filter(Boolean);
  if (!qt.length) return null;
  const out = [];
  for (const [kk, v] of NAMEIDX) {
    const it = kk.split(/[^a-z]+/).filter(Boolean);
    const qInI = qt.every(t => it.includes(t));
    const iInQ = it.every(t => qt.includes(t));
    const both2 = Math.min(qt.length, it.length) >= 2;
    if ((qInI || iInQ) && (both2 || (qt.length === 1 && qt[0].length >= 6 && it.includes(qt[0])))) out.push(...v);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- tokens
const STOP = new Set(('the a an and or but of in on at to for from by with his her their its it he she they '
  + 'was were is are be been being had has have that this these those which who whom when where what as not no '
  + 'so then than there here also only just still even both either neither one two three all any each every '
  + 'she her him them we our you your i me my il elle son sa ses leur leurs le la les un une des du de a au aux '
  + 'et ou mais dans sur par pour avec est sont etait etaient ete que qui quoi dont ce cet cette ces plus moins '
  + 'card tree site page fiche arbre').split(' '));
const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)$/i;
const TOPIC_SET = new Set(('widow widowed widower orphan mother father son daughter brother sister wife husband '
  /* ft-allow-names-begin: occupation vocabulary, not people */
  + 'brewer smith forge farrier tailor butcher vigneron mecanicien mechanic miller weaver alderman supervisor '
  /* ft-allow-names-end */
  + 'circus mexico cemetery burial buried grave stone born birth baptised baptized baptism died death marriage '
  + 'married emigrated emigration arrived arrival naturalisation naturalization census register registers '
  + 'obituary bible trade occupation spelling spelled name names surname forename witness witnesses '
  + 'unregistered registered deaths births marriages bridge post mill brewery farm homestead claim '
  + 'ship vessel port manifest passenger colony pioneer teacher school university regiment soldier '
  + 'veuve veuf orphelin mere pere fils fille frere soeur epouse mari brasseur forgeron marechal '
  + 'tailleur boucher cirque cimetiere enterre tombe naissance bapteme deces mariage emigration '
  + 'recensement registre necrologie orthographe temoin navire port colonie').split(/\s+/));

function tokens(sentence) {
  const t = L.norm(sentence), toks = new Map();
  const bump = (k, w) => toks.set(k, Math.max(toks.get(k) || 0, w));
  L.findDates(t).forEach(d => bump(`D${d.y}-${d.m}-${d.d}`, 5));
  L.findYears(t).forEach(y => bump(`Y${y.y}`, 3));
  const words = t.split(/[^A-Za-zÀ-ÿ'’-]+/).filter(Boolean);
  words.forEach((w, i) => {
    const bare = w.replace(/['’-].*$/, '');
    if (bare.length < 3) return;
    if (/^[A-ZÀ-Ý]/.test(bare) && !MONTHS.test(bare) && !STOP.has(bare.toLowerCase()))
      bump('N' + L.deacc(bare).toLowerCase(), i === 0 ? 1 : 2);
    const b = L.deacc(w).toLowerCase();
    if (TOPIC_SET.has(b)) bump('T' + b, 2);
  });
  return toks;
}
function overlap(a, b) {
  let s = 0; const shared = [];
  for (const [k, w] of a) if (b.has(k)) { s += Math.min(w, b.get(k)); shared.push(k); }
  return { score: s, shared };
}
const SHORT_KINDS = new Set(['tooltip', 'mapnote', 'headline', 'pin', 'union']);
const NOT_FLAT = new Set(['doccap', 'psource', 'srclabel']);   // labels, not claims

// ================================================================ C1 hedge/assert
function C1() {
  for (const p of people) {
    const fs_ = L.fields(p).filter(f => !['srclabel', 'psource', 'doctr', 'srcquote'].includes(f.kind));
    const units = [];
    for (const f of fs_) for (const s of L.sentences(f.text)) {
      const h = hasHedge(s, f.lang);
      units.push({ f, s, hedged: h.length > 0, hedges: h, tok: tokens(s) });
    }
    const seen = new Set();
    for (const a of units.filter(u => u.hedged)) for (const b of units) {
      if (b === a || b.hedged || b.f.lang !== a.f.lang || b.f.path === a.f.path) continue;
      if (NOT_FLAT.has(b.f.kind)) continue;
      if (b.f.row && b.f.row.x) continue;      // an x:1 pin is the declared alternative reading
      if (!(SHORT_KINDS.has(b.f.kind) || SHORT_KINDS.has(a.f.kind))) continue;
      const ov = overlap(a.tok, b.tok);
      const dates = ov.shared.filter(k => k[0] === 'D').length;
      const props = ov.shared.filter(k => k[0] === 'N').length;
      const years = ov.shared.filter(k => k[0] === 'Y').length;
      const topics = ov.shared.filter(k => k[0] === 'T').length;
      // same fact = a shared date, or a shared year plus a shared proper noun,
      // or two shared proper nouns — AND a shared subject-matter word.
      const sameFact = dates >= 1 || (years >= 1 && props >= 1) || props >= 2;
      if (!sameFact || topics < 1 || ov.score < 10) continue;
      // the "flat" side must actually assert something factual
      if (!/\b(?:record|records|recorded|shows?|gives?|states?|entered|enters|proves?|confirms?|settles?|establishes?|reads?|names?|lists?|puts?|places?|finds?|was|were|is|are|died|born|married|buried|baptised|baptized|held|took|went|says?|dit|donne|indique|montre|nomme|situe|place|meurt|na[iî]t|[ée]pouse)\b/i.test(b.s)) continue;
      const key = a.f.path + '|' + b.f.path;
      if (seen.has(key)) continue; seen.add(key);
      F('C1', ov.score >= 12 ? 'high' : 'med', p, `${a.f.path} ↔ ${b.f.path}`,
        `hedged in ${a.f.path} ("${a.hedges[0]}") but stated flat in ${b.f.path}`,
        { score: ov.score, shared: ov.shared, hedged: a.s, flat: b.s });
    }
  }
}

// A source-type mention inside a negative clause ("no register survives",
// "rather than on a register image") is a documented negative, not a citation.
const NEG_EN = /\b(no|not|never|nothing|none|neither|nor|without|rather than|instead of|fails? to|failed to|cannot|can't|do(?:es)? not|did not|is not|are not|was not|were not|unregistered|absent|missing|silent|closed|sealed|destroyed|lost|burnt|burned|unavailable|inaccessible|still shut)\b/i;
const NEG_FR = /\b(aucun|aucune|ne|pas|jamais|rien|sans|plut[oô]t que|ni|absent|manque|muet|clos|close|ferm[ée]|d[ée]truit|perdu|inaccessible)\b/i;
function NEGATED(sentence, proseRe) {
  const t = L.norm(sentence);
  const m = t.match(proseRe);
  if (!m) return false;
  const i = t.indexOf(m[0]);
  const win = t.slice(Math.max(0, i - 60), i + m[0].length + 45);
  return NEG_EN.test(win) || NEG_FR.test(win);
}

// ================================================================ C2 source support
function C2() {
  for (const p of people) {
    const inv = L.sourceInventory(p);
    const invText = inv.map(i => i.text).join(' \n ');
    const fs_ = L.fields(p).filter(f => ['tooltip', 'mapnote', 'headline', 'bio', 'union', 'pin'].includes(f.kind));
    const reported = new Set();
    for (const f of fs_) for (const s of L.sentences(f.text)) {
      // (a) source-type invoked but not carried
      const crossCited = V.CROSSCARD.test(L.norm(s));
      for (const st of V.SOURCE_TYPES) {
        if (!st.prose.test(s) || st.inv.test(invText)) continue;
        if (NEGATED(s, st.prose)) continue;   // "no register survives" is a documented negative
        if (crossCited) continue;             // the sentence names the other card that holds it
        const key = st.key + '|' + f.path;
        if (reported.has(key)) continue; reported.add(key);
        F('C2', inv.length === 0 ? 'high' : 'med', p, f.path,
          `prose cites "${st.key}" but nothing in this card's evidence matches it`,
          { sentence: s, inventory: inv.map(i => i.text.slice(0, 80)) });
      }
      // (b) a dated census/record the card does not carry
      for (const hit of (L.norm(s).match(/\b(1[7-9]\d0|19[0-5]0)\s+(census|recensement)\b/gi) || [])) {
        const yr = hit.match(/\d{4}/)[0];
        if (new RegExp(yr).test(invText)) continue;
        if (crossCited) continue;             // the sentence names the other card that holds it
        if (NEGATED(s, new RegExp(yr + '\\s+census', 'i'))) continue;
        const key = 'yr' + yr + '|' + f.path;
        if (reported.has(key)) continue; reported.add(key);
        F('C2', 'high', p, f.path, `cites the ${yr} census; no ${yr} source or document on this card`, { sentence: s });
      }
      // (c) cross-card citation — needs verifying against the other card
      const cc = L.norm(s).match(V.CROSSCARD);
      if (cc && f.lang === 'en') {
        const key = 'cc|' + f.path + '|' + cc[0];
        if (!reported.has(key)) { reported.add(key); F('C2x', 'review', p, f.path, `asserts what another card says ("${cc[0].trim()}")`, { sentence: s }); }
      }
    }
    // (d) source-count assertions vs the card's real inventory
    const allProse = fs_.filter(f => f.lang === 'en').map(f => f.text).join(' \n ');
    for (const fam of V.SOURCE_FAMILIES) {
      const n = inv.filter(i => fam.re.test(i.text)).length;
      const single = new RegExp(`\\b(?:a single|only one|the only|one)\\s+(?:online |compiled |family )*(?:${fam.key === 'compiled tree' ? 'family tree|online family tree|tree' : fam.key})`, 'i');
      const both = new RegExp(`\\b(?:both|the two)\\s+(?:${fam.key === 'compiled tree' ? 'trees|sources' : fam.key + 's|sources'})\\b`, 'i');
      if (single.test(allProse) && n > 1)
        F('C2', 'review', p, 'bio', `prose says "a single ${fam.key}" but the card carries ${n}`, { matches: inv.filter(i => fam.re.test(i.text)).map(i => i.text.slice(0, 70)) });
      if (both.test(allProse) && n < 2)
        F('C2', 'review', p, 'bio', `prose says "both ${fam.key}s" but the card carries ${n}`, { inventory: inv.map(i => i.text.slice(0, 70)) });
    }
  }
}

const EVENTRE = {
  birth: /\bborn\b|\bbirth\b|\bn[ée]e?\b/i,
  baptism: /\bbaptis|\bbaptiz|\bbapt[êe]me\b|\bchristen/i,
  death: /\bdied\b|\bdeath\b|\bdying\b|\bmeurt\b|\bd[ée]c[èe]d/i,
  burial: /\bburied\b|\bburial\b|\bgrave\b|\bcemeter|\binterred\b|\benterr/i,
  marriage: /\bmarried\b|\bmarriage\b|\bwed\b|\b[ée]pous|\bmaria/i,
  residence: /\blived\b|\bresid|\bhousehold\b|\bhome\b|\bsettled\b|\bhabit|\bdemeur/i,
  work: /\bwork|\bemploy|\btrade\b|\bbusiness\b|\bshop\b|\bforge\b|\bbrewer|\bfarm|\btravail/i,
  study: /\bstudi|\bschool\b|\buniversity\b|\b[ée]tudi|\blyc[ée]e\b|\b[ée]cole\b/i,
  emigration: /\bemigrat|\bsailed\b|\bleft\b|\bcrossing\b|\b[ée]migr/i,
  arrival: /\barriv|\blanded\b|\breached\b|\bd[ée]barqu/i,
  military: /\bmilitary\b|\bsoldier\b|\bregiment\b|\barmy\b|\bcamp\b|\bstalag\b|\bserved\b/i
};

// ================================================================ C3 pin certainty
function C3() {
  for (const p of people) {
    const rows = p.node.pl || [];
    const prose = L.fields(p).filter(f => ['bio', 'mapnote', 'tooltip', 'headline'].includes(f.kind));
    const y = L.yearsOf(p.node);
    rows.forEach((r, i) => {
      const g = gaz[r.k] || {};
      if ((r.c !== 'doc' || r.x) && (!r.w || !r.w_fr))
        F('C3', 'high', p, `pl[${i}]`, `${r.c}${r.x ? '/alt' : ''} pin has no bilingual note`, { row: r });
      if (r.c === 'doc' && !r.x) {
        const h = [...hasHedge(r.w || '', 'en'), ...hasHedge(r.w_fr || '', 'fr')];
        if (h.length) F('C3', 'high', p, `pl[${i}].w`, `[doc] pin whose own note hedges ("${h[0]}")`, { row: r, note: r.w });
      }
      if (r.c !== 'doc' && r.w) {
        const s = L.norm(r.w);
        if (/\b(?:the (?:register|act|census|record|stone|certificate)s?)\b[^.]{0,30}\b(?:records?|gives?|states?|shows?|names?|proves?|confirms?)\b/i.test(s) && !hasHedge(s, 'en').length)
          F('C3', 'med', p, `pl[${i}].w`, `[${r.c}] pin whose note asserts a document reading flatly`, { row: r });
      }
      const base = g.n ? g.n.split(' (')[0] : null;
      const solePin = ['birth', 'death', 'baptism', 'burial'].includes(r.t)
        && rows.filter(z => z.t === r.t && !z.x).length === 1;
      if (r.c === 'doc' && !r.x && base && base.length > 3 && EVENTRE[r.t]) {
        const re = new RegExp('\\b' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        for (const f of prose) if (f.lang === 'en') for (const s of L.sentences(f.text)) {
          if ((!re.test(s) && !solePin) || !EVENTRE[r.t].test(s)) continue;
          // the card already discloses the conflict if it carries an x:1 alternative for this event
          if (rows.some(z => z.x && z.t === r.t)) continue;
          // when the pin's own place is not named, a sentence naming any OTHER place is about that one
          if (!re.test(s)) {
            let other = false;
            for (const [gk, gg] of Object.entries(gaz)) {
              if (gk === r.k || !gg.n) continue;
              const nm = gg.n.split(' (')[0];
              if (nm.length < 4) continue;
              if (new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(s)) { other = true; break; }
            }
            if (other) continue;
          }
          const h = hasHedge(s, 'en');
          if (!h.length) continue;
          // the hedge must bear on the event, not on some other clause
          // the hedge must bear on the event: same clause, not merely the same sentence
          const t2 = L.norm(s);
          const eAt = t2.search(EVENTRE[r.t]);
          const hAt = L.deacc(t2).toLowerCase().indexOf(L.deacc(h[0]).toLowerCase());
          if (hAt >= 0 && Math.abs(hAt - eAt) > 90) continue;
          if (hAt >= 0 && eAt >= 0) {
            const seg = t2.slice(Math.min(hAt, eAt), Math.max(hAt, eAt));
            if (/[;—:]/.test(seg)) continue;   // a clause break separates them
          }
          F('C3', 'med', p, `pl[${i}] ↔ ${f.path}`, `[doc] ${r.t} pin at ${g.n} while the prose about that event hedges ("${h[0]}")`, { row: r, sentence: s });
        }
      }
      if (r.t === 'birth' && y.b && r.y && r.y !== y.b)
        F('C3', 'high', p, `pl[${i}]`, `birth pin year ${r.y} ≠ dates line ${p.node.years}`, { row: r });
      if (r.t === 'death' && r.y && y.d == null && !r.x)
        F('C3', 'high', p, `pl[${i}]`, `death pin publishes ${r.y}${r.d ? ' (' + r.d + ')' : ''} but the dates line carries no death year (${p.node.years})`, { row: r });
      if (r.t === 'death' && y.d && r.y && r.y !== y.d && !r.x)
        F('C3', 'high', p, `pl[${i}]`, `death pin year ${r.y} ≠ dates line ${p.node.years}`, { row: r });
      if (r.d) {
        const dd = L.findDates(r.d)[0];
        const inSpan = dd && r.y && r.y2 && dd.y >= r.y && dd.y <= r.y2;
        if (dd && r.y && dd.y !== r.y && !inSpan)
          F('C3', 'high', p, `pl[${i}]`, `pin date ${r.d} lies outside the pin's own ${r.y2 ? `span ${r.y}\u2013${r.y2}` : `year ${r.y}`}`, { row: r });
      }
      if (r.y && r.y2 && r.y2 < r.y) F('C3', 'high', p, `pl[${i}]`, `pin span reversed ${r.y}–${r.y2}`, { row: r });
      if (r.y && r.y2 && (r.y2 - r.y) > 15 && /no source|nothing (?:after|covers)|aucune source|no record (?:after|covers)/i.test((r.w || '') + (r.w_fr || '')))
        F('C3', 'high', p, `pl[${i}]`, `${r.c} span ${r.y}–${r.y2} while its own note says the later years are unsourced`, { row: r });
      // burial/death ordering
      if (y.d && r.y && r.t !== 'burial' && r.t !== 'death' && r.y > y.d)
        F('C3', 'med', p, `pl[${i}]`, `${r.t} pin dated ${r.y}, after the death year ${y.d}`, { row: r });
    });
  }
}

const DOCCLASS = /register|registre|acte|act n|act \d|census|recensement|certificate|obituar|n[ée]crolog|gravestone|headstone|FindAGrave|tombe|bible|deed|patent|naturali|manifest|passenger|SSDI|Social Security|record|index|EDEPOT|archives6[78]|AD Bas-Rhin|AD Haut-Rhin|scan|image|Kirchenbuch|BMS|declaration|oath|will\b|inventory|inventaire|marriage licen|Email to Cory|letter|biograph|Nobel|BnF|Biblioth|Encyclop|Acad[ée]mie|Institut|Foundation|Society|Museum|Archiv|directory|annuaire|newspaper|gazette|journal|press|university|college|Who's Who|published|imprim/i;
function C3d() {
  for (const p of people) {
    const inv = L.sourceInventory(p);
    if (!inv.length) continue;
    const docSrc = inv.filter(i => DOCCLASS.test(i.text));
    if (docSrc.length) continue;
    const docPins = (p.node.pl || []).map((r, i) => ({ r, i })).filter(x => x.r.c === 'doc');
    if (!docPins.length) continue;
    F('C3', 'high', p, docPins.map(x => `pl[${x.i}]`).join(', '),
      `${docPins.length} pin(s) tagged [doc] but the card carries no documentary source`,
      { sources: inv.map(i => i.text.slice(0, 80)), pins: docPins.map(x => `${x.r.t}@${x.r.k}${x.r.y ? ' ' + x.r.y : ''}`) });
  }
}

// resolve a kinship word to actual tree nodes, with their dates
const PARENT_OF = new Map();
for (const _p of people) (_p.node.unions || []).forEach(u => (u.c || []).forEach(c => PARENT_OF.set(c, { parent: _p, union: u })));
function datesOf(node, years) {
  const b = (node.pl || []).find(r => r.t === 'birth' && r.d);
  const d = (node.pl || []).find(r => r.t === 'death' && r.d);
  const y = L.yearsOf(node.years !== undefined ? node : { years });
  return {
    birth: b ? L.findDates(b.d)[0] : (y.b ? { y: y.b, m: null, d: null, approx: true } : null),
    death: d ? L.findDates(d.d)[0] : (y.d ? { y: y.d, m: null, d: null, approx: true } : null)
  };
}
function RELATIVES(p, kind) {
  const out = [];
  const rec = PARENT_OF.get(p.node);
  const kids = (p.node.unions || []).flatMap(u => u.c || []);
  const add = (label, node, years) => { const d = datesOf(node || {}, years); if (d.birth) out.push({ label, birth: d.birth, death: d.death }); };
  if (kind === 'father' && rec) add(rec.parent.id, rec.parent.node);
  if (kind === 'mother' && rec) add(rec.union.s + ' (' + (rec.union.sy || '?') + ')', {}, rec.union.sy);
  if (kind === 'son') kids.filter(k => k.g !== 'f').forEach(k => add(k.name + ' ' + k.years, k));
  if (kind === 'daughter') kids.filter(k => k.g === 'f').forEach(k => add(k.name + ' ' + k.years, k));
  if ((kind === 'brother' || kind === 'sister') && rec) {
    (rec.parent.node.unions || []).flatMap(u => u.c || []).filter(k => k !== p.node)
      .filter(k => kind === 'brother' ? k.g !== 'f' : k.g === 'f')
      .forEach(k => add(k.name + ' ' + k.years, k));
  }
  if (kind === 'husband' || kind === 'wife' || kind === 'widow')
    (p.node.unions || []).forEach(u => add(u.s + ' (' + (u.sy || '?') + ')', {}, u.sy));
  return out;
}

// ================================================================ C4 arithmetic
function C4() {
  for (const p of people) {
    const y = L.yearsOf(p.node);
    const cardBirth = (() => {
      const b = (p.node.pl || []).find(r => r.t === 'birth' && r.d);
      if (b) { const d = L.findDates(b.d)[0]; if (d) return d; }
      return y.b ? { y: y.b, m: null, d: null, approx: true } : null;
    })();
    for (const f of L.fields(p).filter(x => ['bio', 'mapnote', 'tooltip', 'union', 'pin', 'doctr', 'srcquote', 'doccap'].includes(x.kind))) {
      if (f.lang !== 'en') continue;
      const quoted = f.kind === 'doctr' || f.kind === 'srcquote';
      const paraDates = L.findDates(f.text);
      const paraYears = L.findYears(f.text);
      for (const s of L.sentences(f.text)) {
        if (/\[sic/i.test(s)) continue;   // the source itself is marked wrong; do not "correct" it
        const dates = L.findDates(s), yrs = L.findYears(s);

        // (a) weekdays, Julian-aware
        for (const wd of L.norm(s).matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi)) {
          if (!dates.length) break;
          // a weekday qualifies the date NEXT TO IT, not every date in the sentence
          const t2 = L.norm(s);
          // "Wednesday 25 September 1782" or "25 September 1782, a Wednesday" — nothing looser.
          const near = dates
            .map(d => ({ d, gap: d.index >= wd.index ? d.index - (wd.index + wd[0].length) : wd.index - (d.index + d.raw.length), after: d.index >= wd.index }))
            .filter(x => x.after ? x.gap >= 0 && x.gap <= 3 : x.gap >= 0 && x.gap <= 12)
            .sort((a, b) => a.gap - b.gap)[0];
          if (!near) continue;
          // "Thursday the 26th" names a different day from the sentence's full date
          if (/^\s*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/i.test(t2.slice(wd.index + wd[0].length))) continue;
          const d = near.d, jul = L.isJulianEra(d.y, d.m);
          const got = L.weekday(d.y, d.m, d.d, jul), gotG = L.weekday(d.y, d.m, d.d, false);
          if (got.toLowerCase() !== wd[1].toLowerCase() && gotG.toLowerCase() !== wd[1].toLowerCase())
            F('C4', 'high', p, f.path, `"${wd[1]} ${d.raw}" — Julian ${got}, Gregorian ${gotG}`, { sentence: s });
          else if (got.toLowerCase() !== wd[1].toLowerCase())
            F('C4', 'med', p, f.path, `"${wd[1]} ${d.raw}" — ${jul ? 'era is Julian; Julian weekday is ' + got : 'weekday is ' + got}`, { sentence: s });
        }

        // (b) interval words against date pairs
        if (dates.length >= 2 || (dates.length && yrs.length >= 2)) {
          const spans = [...L.norm(s).matchAll(new RegExp('\\b(' + Object.keys(L.NUMWORD).join('|') + '|\\d{1,4})(?:[-\\s](' + Object.keys(L.NUMWORD).join('|') + '))?\\s+(days?|weeks?|months?|years?)\\b', 'gi'))];
          for (const sp of spans) {
            const n = L.wordToNum([sp[1], sp[2]].filter(Boolean).join('-'));
            if (n == null) continue;
            const unit = sp[3].toLowerCase().replace(/s$/, '');
            let ok = false; const cands = [];
            for (let i = 0; i < dates.length; i++) for (let j = i + 1; j < dates.length; j++) {
              const a = dates[i], b = dates[j], jul = L.isJulianEra(a.y, a.m);
              const days = (jul ? L.jdnJulian(b.y, b.m, b.d) : L.jdn(b.y, b.m, b.d)) - (jul ? L.jdnJulian(a.y, a.m, a.d) : L.jdn(a.y, a.m, a.d));
              const val = unit === 'day' ? days : unit === 'week' ? days / 7 : unit === 'month' ? (b.y - a.y) * 12 + (b.m - a.m) : L.ageBetween(a, b);
              cands.push(`${a.raw}→${b.raw}=${Math.round(val)}${unit[0]}`);
              if (Math.abs(val - n) < (unit === 'day' ? 1.01 : 0.51)) ok = true;
            }
            if (!ok && unit === 'year') for (let i = 0; i < yrs.length; i++) for (let j = i + 1; j < yrs.length; j++) {
              const v = Math.abs(yrs[j].y - yrs[i].y); cands.push(`${yrs[i].y}→${yrs[j].y}=${v}y`);
              if (Math.abs(v - n) <= 1) ok = true;
            }
            if (!ok) {
              const openEnded = /\b(before|after|later|earlier|since|until|apart|between)\b/i.test(s);
              F('C4', quoted ? 'review' : (openEnded ? 'review' : 'med'), p, f.path,
                `"${sp[0].trim()}" matches no date pair in the sentence${openEnded ? ' (the other term is off-card — verify)' : ''}`,
                { sentence: s, candidates: [...new Set(cands)].slice(0, 8) });
            }
          }
        }

        // (c) age claims with subject resolution
        for (const ac of AGE.ageClaims(s)) {
          const nm = AGE.nearestName(s, ac.index);
          let subjects = [];
          if (nm) {
            const selfTok = lc(p.node.name).split(/[^a-z]+/).filter(Boolean);
            const qTok = lc(nm.name).split(/[^a-z]+/).filter(Boolean);
            const isSelf = qTok.length && qTok.every(t => selfTok.includes(t));
            const r = isSelf ? [{ who: p.id, birth: cardBirth, death: (() => { const d = (p.node.pl || []).find(x => x.t === 'death' && x.d); if (d) { const dd = L.findDates(d.d)[0]; if (dd) return dd; } const yy = L.yearsOf(p.node); return yy.d ? { y: yy.d, m: null, d: null, approx: true } : null; })() }] : resolveName(nm.name);
            if (r) subjects = r.map(x => ({ label: x.who, birth: x.birth, death: x.death }));
            else subjects = [{ label: nm.name + ' (not on the tree)', birth: null }];
          } else if (cardBirth) subjects = [{ label: p.id, birth: cardBirth }];
          // "her father, then twenty-nine" — the subject is a relative, not the card person
          // the kinship word must BE the grammatical subject: adjacent, same clause
          const win = L.norm(s).slice(Math.max(0, ac.index - 40), ac.index);
          const relM = win.match(/\b(?:his|her|their)\s+(father|mother|son|daughter|brother|sister|husband|wife|widow)\b(?!-in-law)(?!\s+in\s+law)/i);
          const relTail = relM ? win.slice(relM.index + relM[0].length) : null;
          const rel = (relM && relTail.length <= 22 && !/\b(?:and|but|who|which|then died|;)\b/i.test(relTail)) ? relM : null;
          if (rel) {
            const kin = RELATIVES(p, rel[1].toLowerCase());
            if (kin.length) subjects = kin;
            else subjects = [];
          }
          if (!subjects.length && cardBirth) subjects = [{ label: p.id, birth: cardBirth }];
          const evs = (dates.length ? dates.slice() : (yrs.length ? yrs.map(v => ({ y: v.y, m: null, d: null, raw: String(v.y), approx: true }))
            : (paraDates.length ? paraDates.slice() : paraYears.map(v => ({ y: v.y, m: null, d: null, raw: String(v.y), approx: true })))));
          const rows = [];
          let matched = false, resolvable = false;
          for (const sub of subjects) {
            if (!sub.birth) continue;
            const evs2 = evs.slice();
            // an age attached to a death/burial verb resolves against that person's own death
            if (/\b(died|death|buried|burial)\b/i.test(ac.raw) || /\b(died|buried)\b/i.test(s)) {
              if (sub.death) evs2.push({ ...sub.death, raw: `${sub.label} death ${sub.death.y}`, approx: sub.death.approx });
            }
            for (const e of evs2) {
              resolvable = true;
              const approx = sub.birth.approx || sub.birth.m == null || e.approx || e.m == null;
              const b = { y: sub.birth.y, m: sub.birth.m || 7, d: sub.birth.d || 1 };
              const ee = { y: e.y, m: e.m || 7, d: e.d || 1 };
              const a = L.ageBetween(b, ee);
              rows.push({ t: `${sub.label} b.${sub.birth.y} @ ${e.raw} → ${a}${approx ? '±1' : ''}`, gap: Math.abs(a - ac.n) });
              if (Math.abs(a - ac.n) <= (approx ? 1 : 0)) matched = true;
            }
          }
          rows.sort((a, b) => a.gap - b.gap);
          const matrix = [...new Set(rows.map(r => r.t))].slice(0, 8);
          if (!resolvable) {
            F('C4w', 'review', p, f.path, `age claim "${ac.raw}" (=${ac.n}) — subject "${nm ? nm.name : p.node.name}" has no birth date on the tree`, { sentence: s });
          } else if (!matched) {
            const pre = L.norm(s).slice(Math.max(0, ac.index - 70), ac.index);
            const fromDoc = /\b(?:act|acte|register|registre|census|recensement|record|book|obituary|stone|certificate|index|clerk|enumerator|entry)\b[^.]{0,45}$/i.test(pre)
              || /\b(?:gives?|records?|enters?|gave|gives|gave|says?|entered|gives|puts?|lists?|ages?)\b[^.]{0,20}$/i.test(pre);
            const relTime = /\b(?:a year|two years|three years|shortly|not long|months?|weeks?|days?)\s+(?:before|after|later|earlier)\b/i.test(s);
            const explained = /\b(?:implying|which would|would put|refutes?|demolish|conflict|disagree|one year|two years|off the|against the|wrong|error|slip|overstat|understat|too high|too low|a year high|makes him|makes her|where the)\b/i.test(s);
            const sev = (quoted || ac.quoted || fromDoc || relTime || explained) ? 'review' : (subjects.length > 3 ? 'med' : 'high');
            F(ac.quoted ? 'C4q' : 'C4', sev, p, f.path,
              `age "${ac.raw}" (=${ac.n}) matches no subject/date pairing${ac.quoted ? ' (quoted from a document — verify, do not "correct")' : ''}`,
              { sentence: s, subject: nm ? nm.name : '(card person)', matrix });
          }
        }
      }
    }
    if (y.b && y.d && y.d < y.b) F('C4', 'high', p, 'years', `dates line reversed: ${p.node.years}`);
  }
}

// ================================================================ C5 cross-card claim index
// This tree reuses given names heavily across generations, so a name is NOT an
// identifier on its own. The index is
// therefore keyed by the structural link, never by a name found in prose:
//   C5a  a card contradicting itself (dates line vs its own pins, event order)
//   C5b  a parent/child pair whose dates cannot both be true
// and the full (person, fact, value, where) index is written out for Phase 3.
// Only the order that cannot be repeated. Emigration, arrival, marriage, work,
// residence and study all recur in a life and must NOT be sequenced.
const ORDER = { birth: 0, baptism: 1, death: 9, burial: 10 };
function C5() {
  const idx = [];
  const dateOf = r => { if (!r.d) return null; const dd = L.findDates(r.d)[0]; return dd || null; };
  for (const p of people) {
    const y = L.yearsOf(p.node);
    const rows = (p.node.pl || []).map((r, i) => ({ r, i, dd: dateOf(r) }));
    idx.push({ person: p.id, fact: 'years', value: p.node.years, where: 'years' });
    rows.forEach(({ r, i, dd }) => idx.push({ person: p.id, fact: r.t, value: r.d || r.y || (r.y2 ? `${r.y}–${r.y2}` : ''), place: r.k, cert: r.c, where: `pl[${i}]` }));

    // C5a-1 — an event dated outside the person's own life span
    for (const { r, i, dd } of rows) {
      const yr = dd ? dd.y : r.y;
      if (!yr) continue;
      if (y.b && yr < y.b && !r.x) F('C5', 'high', p, `pl[${i}]`, `${r.t} dated ${yr}, before the birth year ${y.b}`, { row: r });
      if (y.d && yr > y.d && r.t !== 'burial' && !r.x) F('C5', 'high', p, `pl[${i}]`, `${r.t} dated ${yr}, after the death year ${y.d}`, { row: r });
    }
    // C5a-2 — life events out of order on one card
    const dated = rows.filter(x => x.dd && ORDER[x.r.t] != null && !x.r.x)
      .map(x => ({ ...x, j: L.jdn(x.dd.y, x.dd.m, x.dd.d) }));
    for (const a2 of dated) for (const b2 of dated) {
      if (ORDER[a2.r.t] >= ORDER[b2.r.t]) continue;
      if (a2.j <= b2.j) continue;
      F('C5', 'high', p, `pl[${a2.i}] vs pl[${b2.i}]`,
        `${a2.r.t} (${a2.r.d}) falls after ${b2.r.t} (${b2.r.d})`, { rows: [a2.r, b2.r] });
    }
    // C5a-3 — baptism long after birth, burial long after death
    const bth = rows.find(x => x.r.t === 'birth' && x.dd), bap = rows.find(x => x.r.t === 'baptism' && x.dd);
    if (bth && bap) {
      const gap = L.jdn(bap.dd.y, bap.dd.m, bap.dd.d) - L.jdn(bth.dd.y, bth.dd.m, bth.dd.d);
      if (gap < 0) F('C5', 'high', p, `pl[${bap.i}]`, `baptised ${bap.r.d} — before the birth ${bth.r.d}`, { });
      else if (gap > 120) F('C5', 'med', p, `pl[${bap.i}]`, `baptised ${gap} days after birth (${bth.r.d} → ${bap.r.d})`, { });
    }
    const dth = rows.find(x => x.r.t === 'death' && x.dd), bur = rows.find(x => x.r.t === 'burial' && x.dd);
    if (dth && bur) {
      const gap = L.jdn(bur.dd.y, bur.dd.m, bur.dd.d) - L.jdn(dth.dd.y, dth.dd.m, dth.dd.d);
      if (gap < 0) F('C5', 'high', p, `pl[${bur.i}]`, `buried ${bur.r.d} — before the death ${dth.r.d}`, {});
      else if (gap > 60) F('C5', 'med', p, `pl[${bur.i}]`, `buried ${gap} days after death (${dth.r.d} → ${bur.r.d})`, {});
    }
  }

  // C5b — parent/child pairs, using the drawn structure (no name matching)
  for (const p of people) {
    const py = L.yearsOf(p.node);
    (p.node.unions || []).forEach((u, ui) => {
      const sy = L.yearsOf({ years: u.sy || '' });
      (u.c || []).forEach((c, ci) => {
        const cy = L.yearsOf(c);
        if (!cy.b) return;
        const kid = `${c.name} ${c.years || ''}`;
        if (py.b && cy.b <= py.b) F('C5', 'high', p, `unions[${ui}].c[${ci}]`, `child ${kid} is born ${cy.b}, not after the parent's ${py.b}`);
        else if (py.b && cy.b - py.b < 14) F('C5', 'high', p, `unions[${ui}].c[${ci}]`, `parent would be ${cy.b - py.b} at the birth of ${kid}`);
        if (py.d && cy.b > py.d + 1) F('C5', 'high', p, `unions[${ui}].c[${ci}]`, `child ${kid} born ${cy.b}, ${cy.b - py.d} years after the parent's death (${py.d})`);
        if (sy.b && cy.b - sy.b < 14) F('C5', 'high', p, `unions[${ui}].c[${ci}]`, `${u.s} would be ${cy.b - sy.b} at the birth of ${kid}`);
        if (sy.b && cy.b - sy.b > 50) F('C5', 'med', p, `unions[${ui}].c[${ci}]`, `${u.s} would be ${cy.b - sy.b} at the birth of ${kid}`);
        if (sy.d && cy.b > sy.d) F('C5', 'high', p, `unions[${ui}].c[${ci}]`, `${u.s} died ${sy.d}, before the birth of ${kid} (${cy.b})`);
      });
    });
  }
  require('fs').writeFileSync(require('path').join(__dirname, 'claim-index.json'), JSON.stringify(idx, null, 0));
}

// PERSONAL names the tree uses — a dropped person name is the defect that matters.
// Place names are excluded: EN/FR variants there are legitimate translation.
/* ft-allow-names-begin: generic stopwords for the prose linter — words that happen to be names */
const NAMEBLOCK = new Set(('smith west east north south king brown young white black green gray grey '
  + 'mack mead park hall ford cross bell hill wood stone church long short march will day '
  + 'baker miller cook fisher clark wright page rose grace hope faith mason marsh field '
  + 'saint sainte comte county city town ville nord sous sur haut bas grand petit '
  + 'jean marie anne paul pierre louis henri georges george charles frederic frederick martin '
  + 'nitschelm').split(/\s+/));
/* ft-allow-names-end */
const KNOWN = new Set();
for (const _p of people) {
  const push = str => (str || '').split(/[^A-Za-z\u00C0-\u00FF]+/).forEach(w => {
    const k = L.deacc(w).toLowerCase();
    if (k.length > 3 && !NAMEBLOCK.has(k)) KNOWN.add(k);
  });
  push(_p.node.name);
  (_p.node.unions || []).forEach(u => push(u.s));
}

// Each pair must be a mirror. Where one half matched a word the other half did not — EN
// lacking 'impossible' while FR had it, FR carrying 'approfondi' with no EN counterpart — the
// check reported a parity failure that was really a gap in this table.
const INTENSIFIERS = [
  { k: 'exhaustive',  en: /\bexhaustive(?:ly)?\b|\bsystematic(?:ally)?\b|\bthorough(?:ly)?\b/i, fr: /\bexhaustif|\bexhaustive|\bapprofondi|\bsyst[ée]matique/i },
  { k: 'independent', en: /\bindependent(?:ly)?\b/i,           fr: /\bind[ée]pendant/i },
  { k: 'only/single', en: /\b(?:a single|only one|the only|sole|exactly one|just one|but one|a lone|one and only)\b/i, fr: /\b(?:un seul|une seule|le seul|la seule|seulement|qu'un seul|qu'une seule|unique)\b/i },
  { k: 'never',       en: /\bnever\b/i,                        fr: /\bjamais\b/i },
  { k: 'cannot',      en: /\bcannot\b|\bcan't\b|\bimpossible\b/i, fr: /\bne peut\b|\bne peuvent\b|\bne saurait\b|\bimpossible\b/i },
  { k: 'proved',      en: /\bprove[dn]?\b|\bdemonstrat(?:e[ds]?|ing)\b/i, fr: /\bprouv|\bd[ée]montr/i },
  { k: 'documented',  en: /\bdocumented\b/i,                    fr: /\bdocument[ée]/i }
];

// ================================================================ C6 EN/FR parity
function C6() {
  for (const p of people) {
    for (const pr of L.pairs(p)) {
      const { en, fr, label } = pr;
      if (!en && !fr) continue;
      if (!en || !fr) { F('C6', 'high', p, label, `missing ${en ? 'FR' : 'EN'} text`); continue; }
      const expand = t => {           // "1862–63" and "the 1650s" carry years too
        const set = new Set(L.findYears(t).map(x => x.y));
        for (const m of L.norm(t).matchAll(/\b(1[5-9]\d{2}|20\d{2})\s*[–—-]\s*(\d{2})\b/g))
          set.add(+(m[1].slice(0, 2) + m[2]));
        for (const m of L.norm(t).matchAll(/\b(1[5-9]\d0|20\d0)s?\b|\bann[ée]es\s+(1[5-9]\d0)\b/gi))
          set.add(+(m[1] || m[2]));
        return set;
      };
      const eY = expand(en), fY = expand(fr);
      const missY = [...eY].filter(x => !fY.has(x)).concat([...fY].filter(x => !eY.has(x)));
      if (missY.length) F('C6', 'high', p, label, `year(s) in one language only: ${missY.join(', ')}`, { en, fr });
      const nums = t => {
        const set = new Set();
        // strip clock times, ordinals suffixes and the "n° 1458" style act numbers
        const cleaned = L.norm(t)
          .replace(/\b\d{1,2}\s*[:h]\s*\d{2}\b/g, ' ')
          .replace(/\b\d{1,2}\s*(?:a\.m|p\.m|o'clock)\b/gi, ' ')
          .replace(/\bn[°o]\s*\d+/gi, ' ');
        (cleaned.match(/\b\d{1,3}(?:st|nd|rd|th|e|er|re|[èe]me)?\b/gi) || []).forEach(x => set.add(parseInt(x, 10)));
        return set;
      };
      const eN = nums(en), fN = nums(fr);
      const missN = [...eN].filter(x => !fN.has(x)).concat([...fN].filter(x => !eN.has(x)));
      if (missN.length) F('C6', 'med', p, label, `bare number(s) in one language only: ${missN.join(', ')}`, { en, fr });
      // Vocabulary-level parity is unreliable across two languages: emitted as a
      // reading queue, not as a defect. (Cold audit, 7 Aug: ~15% precision.)
      const eh = hasHedge(en, 'en'), fh = hasHedge(fr, 'fr');
      if (eh.length && !fh.length) F('C6h', 'review', p, label, `EN hedges ("${eh[0]}") — check the FR carries the same doubt`, { en, fr });
      if (fh.length && !eh.length) F('C6h', 'review', p, label, `FR hedges ("${fh[0]}") — check the EN carries the same doubt`, { en, fr });
      const es = L.sentences(en).length, fsn = L.sentences(fr).length;
      if (es !== fsn) F('C6', 'low', p, label, `sentence count EN ${es} vs FR ${fsn}`, { en, fr });
      const props = t => new Set((L.norm(t).match(/(?<![A-Za-zÀ-ÿ])[A-ZÀ-Ý][a-zà-ÿ]{3,}(?![A-Za-zÀ-ÿ])/g) || [])
        .map(x => L.deacc(x).toLowerCase()).filter(x => !STOP.has(x) && !MONTHS.test(x) && KNOWN.has(x)));
      const ep = props(en), fp = props(fr);
      const near4 = (x, set) => [...set].some(y => y.slice(0, 4) === x.slice(0, 4) || y.slice(0, 5) === x.slice(0, 5));
      const onlyE = [...ep].filter(x => !fp.has(x) && !near4(x, fp));
      const onlyF = [...fp].filter(x => !ep.has(x) && !near4(x, ep));
      if (onlyE.length || onlyF.length)
        F('C6', 'med', p, label, `name(s) present in one language only — EN: ${onlyE.slice(0, 6).join(', ') || '\u2014'} | FR: ${onlyF.slice(0, 6).join(', ') || '\u2014'}`, { en, fr });
      const iEN = [], iFR = [];
      let softOnly = true;
      for (const it of INTENSIFIERS) {
        const e = it.en.test(en), fq = it.fr.test(fr);
        if (e === fq) continue;
        (e ? iEN : iFR).push(it.k);
        if (!it.soft) softOnly = false;
      }
      if (iEN.length || iFR.length)
        F('C6h', 'review', p, label,
          `load-bearing word(s) matched in one language only — EN: ${iEN.join(', ') || '\u2014'} | FR: ${iFR.join(', ') || '\u2014'}`, { en, fr });
      const r = en.length / fr.length;
      if (r < 0.55 || r > 1.6) F('C6', 'med', p, label, `length ratio EN/FR ${r.toFixed(2)}`, { en, fr });
    }
  }
}

// ================================================================ C7 tooltip shape
function C7() {
  for (const p of people) {
    for (const [path, txt] of [['note', p.node.note], ['note_fr', p.node.note_fr]]) {
      if (!txt) continue;
      const ss = L.sentences(txt).filter(x => /\b(?:is|was|were|are|has|had|have|died|born|married|buried|lived|left|came|went|took|gave|holds?|shows?|names?|records?|est|fut|furent|sont|meurt|na[iî]t|[ée]pouse|vit|part|arrive|donne|porte|nomme|reste|a |ne )\b/i.test(x) || x.split(/\s+/).length > 8);
      if (ss.length > 1) F('C7', 'med', p, path, `tooltip is ${ss.length} sentences`, { text: txt });
      const m = txt.match(V.TOOLTIP_SOURCEY);
      if (m) F('C7', 'med', p, path, `tooltip cites a source ("${m[0]}")`, { text: txt });
      if (txt.length > 240) F('C7', 'low', p, path, `tooltip is ${txt.length} characters`, { text: txt });
    }
  }
}

// ================================================================ C8 distances
function C8() {
  const MI = 1.609344;
  for (const p of people) {
    const keys = new Set((p.node.pl || []).map(r => r.k));
    const proseAll = L.fields(p).map(f => f.text).join(' \n ');
    for (const [k, g] of Object.entries(gaz)) {
      if (!g.n) continue;
      const base = g.n.split(' (')[0];
      if (base.length > 3 && new RegExp('\\b' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(proseAll)) keys.add(k);
    }
    const places = [...keys].map(k => ({ k, g: gaz[k] })).filter(x => x.g && x.g.lat != null);
    const re = new RegExp('\\b(' + Object.keys(L.NUMWORD).join('|') + '|\\d{1,4})(?:[-\\s](' + Object.keys(L.NUMWORD).join('|') + '))?\\s*(miles?|km\\b|kilometres?|kilometers?|kilom[eè]tres?)', 'gi');
    for (const f of L.fields(p)) for (const s of L.sentences(f.text)) {
      for (const m of L.norm(s).matchAll(re)) {
        const n = L.wordToNum([m[1], m[2]].filter(Boolean).join('-'));
        if (n == null) continue;
        const km = /mile/i.test(m[3]) ? n * MI : n;
        const all = [];
        for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++)
          all.push({ s: `${places[i].g.n}→${places[j].g.n}`, d: L.distKm(places[i].g, places[j].g) });
        if (!all.length) continue;
        all.sort((a, b) => Math.abs(a.d - km) - Math.abs(b.d - km));
        if (Math.abs(all[0].d - km) > Math.max(km * 0.3, 1.0))
          F('C8', 'high', p, f.path, `"${m[0].trim()}" (=${km.toFixed(1)} km) disagrees with the site's own gazetteer — the prose or the coordinates are wrong`,
            { sentence: s, nearest: all.slice(0, 5).map(x => `${x.s}=${x.d.toFixed(1)}km`) });
      }
    }
  }
}

// ================================================================ extras
function X() {
  for (const p of people) {
    const fsAll = L.fields(p);
    for (const f of fsAll) {
      if (/\*\*|__|`|\[[^\]]+\]\(/.test(f.text)) F('X9', 'high', p, f.path, 'markdown syntax in user-visible text', { text: f.text.slice(0, 160) });
      const dp = f.text.match(/[.,;:]\s*[.,;:]/);
      if (dp) {
        const at = f.text.indexOf(dp[0]);
        const abbrev = /\b[A-Za-zÀ-ÿ]{1,4}\.$/.test(f.text.slice(Math.max(0, at - 6), at + 1));
        if (!abbrev) F('X9', 'med', p, f.path, 'doubled punctuation', { text: f.text.slice(Math.max(0, at - 60), at + 60) });
      }
      const rw = f.text.match(/\b(\w{3,})\s+\1\b/i);
      if (rw && !/^(had|that|the|is|no|so|out|far|des|les|vous|nous|plus|pour|sans|bien)$/i.test(rw[1]))
        F('X9', 'med', p, f.path, `repeated word "${rw[1]}"`, { text: f.text.slice(0, 160) });
      if (f.lang === 'en' && /\s[,.]/.test(f.text)) F('X9', 'low', p, f.path, 'space before punctuation (EN)', { text: f.text.slice(0, 160) });
      if (/\s{2,}/.test(f.text)) F('X9', 'low', p, f.path, 'double space', { text: f.text.slice(0, 120) });
      if (/[“”"][^“”"]*$/.test(f.text) && (f.text.match(/[“”"]/g) || []).length % 2) F('X9', 'med', p, f.path, 'unbalanced quotation mark', { text: f.text.slice(0, 160) });
    }
    for (const f of fsAll.filter(x => ['bio', 'mapnote', 'tooltip', 'headline', 'pin', 'union'].includes(x.kind))) {
      for (const re of V.MACHINERY) {
        const m = f.text.match(re);
        if (m) { F('X10', 'low', p, f.path, `narrates the editing process ("${m[0]}")`, { text: f.text.slice(0, 200) }); break; }
      }
    }
    const pr = p.node.profile || {};
    if (pr.headline && (pr.bio || [])[0]) {
      const h = lc(pr.headline).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      const b = lc(pr.bio[0]).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      if (h.length >= 3 && b.slice(0, h.length).join(' ') === h.join(' '))
        F('X11', 'med', p, 'profile.headline', 'headline repeats the first words of bio[0] verbatim', { headline: pr.headline });
    }
    const prose = fsAll.filter(f => ['bio', 'mapnote', 'tooltip', 'union', 'pin', 'doccap'].includes(f.kind)).map(f => lc(f.text)).join(' \n ');
    const cite = label => {
      const toks = lc(label).split(/[^a-z0-9]+/).filter(w => w.length > 4 && !STOP.has(w));
      return !toks.length || toks.some(w => prose.includes(w));
    };
    if ((pr.bio || []).length) {
      (p.node.src || []).forEach((s, i) => { if (s.l && !cite(s.l)) F('X12', 'low', p, `src[${i}]`, 'source never referenced by any prose on the card', { label: s.l }); });
      (pr.sources || []).forEach((s, i) => { if (s.label && !cite(s.label)) F('X12', 'low', p, `profile.sources[${i}]`, 'source never referenced by any prose on the card', { label: s.label }); });
    }
    // X13 — a doc transcription whose facts contradict the card's own dates line
    (pr.docs || []).forEach((d, i) => {
      if (!d.tr) return;
      const y = L.yearsOf(p.node);
      for (const dt of L.findDates(d.tr)) {
        if (y.b && Math.abs(dt.y - y.b) === 0) continue;
      }
    });
  }
}

// ================================================================ X13 family counts
// Prose asserting a count of children/siblings, checked against the tree's own structure.
// Emitted as worksheet items: the tree deliberately does not draw everyone found,
// so a mismatch is a "read this sentence", not automatically a defect.
// X13b is the hard failure: one card asserting two different counts of the same relation.
function X13() {
  const parentOf = new Map();
  for (const p of people) (p.node.unions || []).forEach(u => (u.c || []).forEach(c => parentOf.set(c, p)));
  const NUMS = Object.keys(L.NUMWORD).join('|');
  const RE = new RegExp(`\\b(${NUMS}|\\d{1,2})(?:[-\\s](${NUMS}))?\\s+(?:Nitschelm\\s+)?(children|sons|daughters|brothers|sisters|women|men|boys|girls)\\b`, 'gi');
  const GEN = /of (?:his|her|their|that) generation|siblings|brothers and sisters/i;
  const countsFor = (p) => {
    const kids = (p.node.unions || []).flatMap(u => u.c || []);
    const parent = parentOf.get(p.node);
    const sibsAll = parent ? (parent.node.unions || []).flatMap(u => u.c || []) : [];
    const sibs = sibsAll.filter(k => k !== p.node);
    const dedupe = a => [...new Set(a)];
    return {
      children:  dedupe([kids.length, ...(p.node.unions || []).map(u => (u.c || []).length)]),
      sons:      dedupe([kids.filter(k => k.g !== 'f').length]),
      daughters: dedupe([kids.filter(k => k.g === 'f').length]),
      // "the three brothers" usually counts the subject in; accept both readings
      brothers:  dedupe([sibs.filter(k => k.g !== 'f').length, sibsAll.filter(k => k.g !== 'f').length]),
      sisters:   dedupe([sibs.filter(k => k.g === 'f').length, sibsAll.filter(k => k.g === 'f').length]),
      women:     dedupe([sibsAll.filter(k => k.g === 'f').length, sibs.filter(k => k.g === 'f').length]),
      girls:     dedupe([sibsAll.filter(k => k.g === 'f').length]),
      men:       dedupe([sibsAll.filter(k => k.g !== 'f').length, sibs.filter(k => k.g !== 'f').length]),
      boys:      dedupe([sibsAll.filter(k => k.g !== 'f').length]),
      _kids: kids
    };
  };
  for (const p of people) {
    const mine = countsFor(p);
    const seen = {};   // relation -> Set of asserted numbers, for X13b
    for (const f of L.fields(p).filter(x => ['bio', 'mapnote', 'tooltip', 'union'].includes(x.kind) && x.lang === 'en')) {
      for (const sen of L.sentences(f.text)) {
        for (const m of L.norm(sen).matchAll(RE)) {
          const n = L.wordToNum([m[1], m[2]].filter(Boolean).join('-'));
          if (n == null) continue;
          const kind = m[3].toLowerCase();
          if (['women', 'men', 'boys', 'girls'].includes(kind) && !GEN.test(sen)) continue;
          // "the N children of <Someone>" — attribute the claim to that person
          const after = L.norm(sen).slice(m.index + m[0].length, m.index + m[0].length + 60);
          const of = after.match(/^\s+(?:of|born to)\s+([A-Z\u00C0-\u00DD][\w\u00C0-\u00FF'\u2019-]+(?:\s+[A-Z\u00C0-\u00DD][\w\u00C0-\u00FF'\u2019-]+){0,2})/);
          let subject = p, counts = mine, label = 'this card';
          if (of) {
            const r = people.find(q => lc(q.node.name).includes(lc(of[1])) || lc(of[1]).includes(lc(q.node.name)));
            if (r && r.idx !== p.idx) { subject = r; counts = countsFor(r); label = r.id; }
            else if (!r) continue;                 // unknown subject — not judgeable
          }
          const exp = counts[kind];
          if (!exp || !exp.length) continue;
          const key = label + '|' + kind;
          (seen[key] = seen[key] || []).push({ n, sen, path: f.path });
          if (exp.includes(n)) continue;
          F('X13', 'review', p, f.path,
            `"${m[0].trim()}" — ${label === 'this card' ? 'this card' : label} draws ${exp.join(' or ')} ${kind}`,
            { sentence: sen, drawn: kind === 'children' ? counts._kids.map(k => `${k.name} ${k.years || ''}`) : undefined });
        }
      }
    }
    for (const [key, list] of Object.entries(seen)) {
      const vals = [...new Set(list.map(x => x.n))];
      if (vals.length > 1)
        F('X13b', 'review', p, list.map(x => x.path).join(', '),
          `this card asserts ${vals.join(' and ')} ${key.split('|')[1]}${key.startsWith('this card') ? '' : ' for ' + key.split('|')[0]}`,
          { sentences: list.map(x => `${x.path}: ${x.sen}`) });
    }
  }
}

// ---------------------------------------------------------------- run
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const suite = { C1, C2, C3, C3d, C4, C5, C6, C7, C8, X, X13 };
for (const [k, fn] of Object.entries(suite)) {
  if (only && !only.split(',').includes(k)) continue;
  const before = findings.length; fn();
  process.stderr.write(`${k}: ${findings.length - before}\n`);
}
const outIdx = process.argv.indexOf('--json');
if (outIdx > -1) fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(findings, null, 1));
const bySev = {}, byCheck = {}, byCard = {};
findings.forEach(f => {
  bySev[f.sev] = (bySev[f.sev] || 0) + 1;
  byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  byCard[f.card] = (byCard[f.card] || 0) + 1;
});
console.log('TOTAL', findings.length, JSON.stringify(bySev));
console.log('by check', JSON.stringify(byCheck));
console.log('cards with findings', Object.keys(byCard).length, '/', people.length);
