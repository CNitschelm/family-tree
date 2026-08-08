'use strict';
// Build the pin-certainty patch: every [doc] pin on a card that holds no
// documentary source becomes [inf], with a bilingual note naming what it does
// rest on. The note is generated from the card's own source list, so it never
// claims more than the card holds.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const { people, gaz } = L.load();
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'pin-audit.json'), 'utf8'));

// what the card actually rests on, named in the site's own words
function sourcePhrase(inv) {
  const t = inv.join(' \n ');
  const en = [], fr = [];
  if (/astrosurf|family site|site familial/i.test(t)) { en.push('the family site'); fr.push('le site familial'); }
  if (/Hoffman/i.test(t)) { en.push('the Hoffman family tree'); fr.push('l’arbre Hoffman'); }
  if (/Ban de la Roche/i.test(t)) { en.push('the Ban de la Roche study'); fr.push('l’étude du Ban de la Roche'); }
  if (/Geneanet \((?:pierfit|elsebethn|patkohler)\)|member tree|Geneanet member/i.test(t)) {
    en.push('a Geneanet member tree'); fr.push('un arbre Geneanet de contributeur');
  }
  if (/family records|family papers/i.test(t)) { en.push('the family’s own records'); fr.push('les documents de la famille'); }
  const join = (a, and) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' ' + and + ' ' + a[a.length - 1];
  return { en: join(en, 'and') || 'the compiled sources this card carries', fr: join(fr, 'et') || 'les sources compilées portées par cette fiche' };
}

const TEMPLATES = {
  birth: {
    en: (P, S, g) => `${g === 'f' ? 'Her' : 'His'} birth at ${P.en} is given by ${S.en}; no birth act has been read for it.`,
    fr: (P, S, g) => `Sa naissance à ${P.fr} est donnée par ${S.fr} ; aucun acte de naissance n’a été lu.`
  },
  baptism: {
    en: (P, S, g) => `The baptism at ${P.en} is given by ${S.en}; no baptismal act has been read for it.`,
    fr: (P, S) => `Le baptême à ${P.fr} est donné par ${S.fr} ; aucun acte de baptême n’a été lu.`
  },
  death: {
    en: (P, S, g) => `${g === 'f' ? 'Her' : 'His'} death at ${P.en} is given by ${S.en}; no death record has been read for it.`,
    fr: (P, S) => `Son décès à ${P.fr} est donné par ${S.fr} ; aucun acte de décès n’a été lu.`
  },
  burial: {
    en: (P, S) => `The burial at ${P.en} is given by ${S.en}; no burial record has been read for it.`,
    fr: (P, S) => `L’inhumation à ${P.fr} est donnée par ${S.fr} ; aucun acte de sépulture n’a été lu.`
  },
  marriage: {
    en: (P, S) => `The marriage at ${P.en} is given by ${S.en}; no marriage act has been read for it.`,
    fr: (P, S) => `Le mariage à ${P.fr} est donné par ${S.fr} ; aucun acte de mariage n’a été lu.`
  },
  residence: {
    en: (P, S, g) => `${g === 'f' ? 'She' : 'He'} is placed at ${P.en} by ${S.en}; no document records ${g === 'f' ? 'her' : 'him'} there.`,
    fr: (P, S, g) => `${g === 'f' ? 'Elle est située' : 'Il est situé'} à ${P.fr} par ${S.fr} ; aucun document ne l’y atteste.`
  },
  work: {
    en: (P, S) => `The work at ${P.en} is given by ${S.en}; no document records it.`,
    fr: (P, S) => `L’activité à ${P.fr} est donnée par ${S.fr} ; aucun document ne l’atteste.`
  },
  study: {
    en: (P, S) => `The schooling at ${P.en} is given by ${S.en}; no document records it.`,
    fr: (P, S) => `Les études à ${P.fr} sont données par ${S.fr} ; aucun document ne l’atteste.`
  }
};

const out = [];
let n = 0, skipped = [];
for (const c of audit) {
  const p = people.find(x => x.id === c.id);
  const g = p.node.g || 'm';
  const S = sourcePhrase(c.sources);
  const edits = [];
  for (const x of c.pins) {
    const r = p.node.pl[x.i];
    const tpl = TEMPLATES[r.t];
    if (!tpl) { skipped.push(`${c.id} pl[${x.i}] ${r.t}`); continue; }
    const P = { en: (gaz[r.k] || {}).n || r.k, fr: (gaz[r.k] || {}).n_fr || (gaz[r.k] || {}).n || r.k };
    edits.push({ path: `pl[${x.i}].c`, expect: 'doc', value: 'inf',
      why: `the card carries no documentary source — only ${S.en} — so [doc] claimed a document nobody has read` });
    if (!r.w) edits.push({ path: `pl[${x.i}].w`, value: tpl.en(P, S, g), why: 'the site requires a bilingual note on every non-doc pin' });
    if (!r.w_fr) edits.push({ path: `pl[${x.i}].w_fr`, value: tpl.fr(P, S, g), why: 'same, French side' });
    n++;
  }
  if (edits.length) out.push({ card: c.card, edits });
}
fs.writeFileSync(path.join(__dirname, '..', 'patches', 'pinrule.json'), JSON.stringify(out, null, 1));
console.log(`retagged ${n} pins across ${out.length} cards; ${out.reduce((a, c) => a + c.edits.length, 0)} edits`);
if (skipped.length) console.log('SKIPPED (no template):', skipped.join(', '));
console.log('\n--- sample ---');
out.slice(0, 3).forEach(c => { console.log(c.card); c.edits.filter(e => /\.w$|\.w_fr$/.test(e.path)).slice(0, 4).forEach(e => console.log('   ', e.path, '→', e.value)); });
