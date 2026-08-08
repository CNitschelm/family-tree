'use strict';
// Classify every card's evidence, and every [doc] pin against it.
// The rule: `doc` asserts that a document exists and someone read it.
//   EVIDENCE CLASSES
//   scan      an image of the document is embedded on the card (profile.docs)
//   archive   an archival reference: fonds/cote/view/ark/act n°, AD, EDEPOT, archives6x
//   register  a named register transcription carrying act numbers (Baradel/SAIREPA cahiers)
//   index     an official or published record: census, death index, SSDI, naturalisation,
//             newspaper, county book, memorial with a register citation
//   compiled  a family tree that cites no register: astrosurf, a Geneanet member tree,
//             "family site", "Hoffman family tree"
//   family    correspondence, the family bible, an email
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const { data, people, gaz } = L.load();

const CLASS = [
  ['archive', /AD (?:Bas|Haut)-Rhin|EDEPOT|archives6[78]|\bark:|\bark\b|\bcote\b|\bvue\b|\bview \d|\bact n|\bacte n|\b\d E \d|RP\/\d|5E\/|SaiRePa|SAIREPA|original register|registre original|original scan|register scan|\bcahier \d/i],
  ['register', /registers? \(Baradel\)|registres? \(Baradel\)|Baradel|Munster registers|Gunsbach registers|parish registers|registres paroissiaux/i],
  ['index',    /corynitschelm|LinkedIn|R[ée]sum[ée]|portfolio|personal site|Site personnel|census|recensement|SSDI|Social Security|death (?:index|record|certificate|register|return)|naturali|declaration of intent|passenger|manifest|FindAGrave|find a grave|memorial|obituar|n[ée]crolog|newspaper|Free Trader|Register|Sentinel|Tribune|Journal|Herald|Republican|biographical record|county (?:book|record)|marriage (?:index|record|licen|certificate)|directory|annuaire|Nobel|BnF|INSEE|matchID|deces\.matchid|state file|court|probate|land|patent|tract|homestead|inventor|notari/i],
  ['compiled', /astrosurf|Geneanet|family site|site familial|Hoffman|family tree|arbre|member tree|compiled|Ancestry|FamilySearch tree/i],
  ['family',   /Email to Cory|family correspondence|correspondance|bible|letter|courriel|family records|family papers|Elise|Jeanette|Allen/i]
];

function classify(text) {
  const out = new Set();
  for (const [k, re] of CLASS) if (re.test(text)) out.add(k);
  return out;
}

const rows = [];
for (const p of people) {
  const n = p.node, pr = n.profile || {};
  const inv = L.sourceInventory(p);
  const classes = new Set();
  const detail = [];
  if ((pr.docs || []).length) { classes.add('scan'); detail.push(`scan×${pr.docs.length}`); }
  for (const i of inv) {
    const c = classify(i.text);
    // a Geneanet URL that is a person page, not a register transcription, is compiled
    if (c.has('register') && !/Baradel|SaiRePa|SAIREPA|cahier/i.test(i.text)) c.delete('register');
    for (const k of c) classes.add(k);
    detail.push(`${i.path}:${[...c].join('+') || '?'}`);
  }
  // "documentary" = a specific document exists and was read
  const documentary = classes.has('scan') || classes.has('archive') || classes.has('index') || classes.has('register');
  const onlyCompiled = !documentary && (classes.has('compiled') || classes.has('family') || !classes.size);
  // DECISIONS.md §2: the rule is PER PIN. A `doc` pin whose own note cross-cites
  // another card that holds the document is justified even when this card carries
  // none of its own — Caroline 1834's birth pin is the worked example.
  const CROSS = /\bcard\b|\bfiche\b|cross-cite|read entry by entry|transcribed on|cited on/i;
  const docPins = (n.pl || []).map((r, i) => ({ r, i }))
    .filter(x => x.r.c === 'doc' && !CROSS.test((x.r.w || '') + ' ' + (x.r.w_fr || '')));
  rows.push({ p, id: p.id, classes: [...classes], detail, documentary, onlyCompiled, docPins, inv });
}

const offenders = rows.filter(r => r.onlyCompiled && r.docPins.length);
const totalDocPins = offenders.reduce((a, r) => a + r.docPins.length, 0);

if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(__dirname, 'pin-audit.json'), JSON.stringify(
    offenders.map(r => ({
      card: `${r.p.node.name}|${r.p.node.years || ''}`, id: r.id,
      sources: r.inv.map(i => i.text.slice(0, 140)),
      classes: r.classes,
      pins: r.docPins.map(x => ({ i: x.i, t: x.r.t, k: x.r.k, place: (gaz[x.r.k] || {}).n, y: x.r.y, y2: x.r.y2, d: x.r.d, hasNote: !!x.r.w }))
    })), null, 1));
}

console.log(`cards: ${people.length}`);
console.log(`cards whose ONLY evidence is a compiled tree / family memory: ${rows.filter(r => r.onlyCompiled).length}`);
console.log(`  …of those, carrying [doc] pins: ${offenders.length}  (total ${totalDocPins} pins)`);
console.log('');
for (const r of offenders.sort((a, b) => b.docPins.length - a.docPins.length)) {
  console.log(`${String(r.docPins.length).padStart(2)}  ${r.id}`);
  console.log(`      sources: ${r.inv.map(i => i.text.slice(0, 70)).join(' | ') || '(NONE)'}`);
  console.log(`      pins   : ${r.docPins.map(x => `pl[${x.i}] ${x.r.t}@${(gaz[x.r.k] || {}).n || x.r.k}${x.r.d ? ' ' + x.r.d : x.r.y ? ' ' + x.r.y : ''}${x.r.w ? '' : ' [no note]'}`).join('; ')}`);
}
console.log('');
console.log('--- cards WITH documentary evidence, for contrast (first 8) ---');
rows.filter(r => r.documentary && r.docPins.length).slice(0, 8)
  .forEach(r => console.log(`  ${r.id}  [${r.classes.join(',')}]  ${r.docPins.length} doc pins`));
