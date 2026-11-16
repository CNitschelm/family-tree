'use strict';
// Build sources/MANIFEST.json — every distinct URL the site cites, with the cards that depend on
// it and how likely it is to vanish.
//
// The archive exists because a citation to a dead page is not a citation. Half this genealogy
// rests on two personal websites, one on astrosurf.com and one on a free.fr account, and those
// are one lapsed subscription away from taking a hundred cards' evidence with them.
//
//   node checks/manifest.js          # write sources/MANIFEST.json and print the summary
//
// The manifest is the input to the archiver. It is regenerated from data.json, never hand-edited:
// add a source to a card and it appears here on the next run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./lib.js');

// How likely is this host to still be serving the same bytes in ten years?
// Personal sites vanish. National institutions mostly do not. Everything else is in between.
//
// Only the large services every family history uses are named here. The rest of the list (a
// relative's own site, an employer, a school, a local paper) says where particular people lived,
// studied and worked, and this file is public, so those hosts are in checks/source-hosts.json,
// which is private: it lives in family-tree-private and tools/cloud-setup.sh links it in, as it
// does checks/priority-cards.json (16 Nov 2026, register R-0761). Its shape:
//   { "risk": { "high": ["host.example", …], "medium": […], "low": […] },
//     "kind": { "scan": […], "gated": […] } }
// Each entry is a piece of a URL, matched as written, in any letter case.
const RISK = [
  // one person's hosting bill away from gone — and the genealogy leans hardest on these
  [/astrosurf\.com|free\.fr|geneanet\.org|geni\.com|wikitree\.com|corynitschelm\.com/i, 'high'],
  // institutional, but reorganised often; deep links rot even when the institution survives
  [/alsace\.eu/i, 'medium'],
  // large, funded, mandated to persist — still worth a copy, lower priority
  [/nobelprize\.org|archive\.org|loc\.gov|archives\.gov|familysearch\.org|findagrave\.com|deutsche-biographie\.de|data\.bnf\.fr|matchid\.io|schweitzer\.org|github\.com/i, 'low'],
];

// What kind of thing is behind the URL — it decides how it has to be captured.
const KIND = [
  [/ark:\/|archives6[78]\.alsace\.eu/i, 'scan'],                           // register images behind a viewer
  [/familysearch\.org\/ark/i, 'gated'],                                    // needs a signed-in session
  [/geneanet\.org|findagrave\.com|geni\.com|wikitree/i, 'public-tree'],   // public to a visitor; robots.txt decides, not us
  [/web\.archive\.org/i, 'already-archived'],
  [/\.(jpe?g|png|gif|webp|pdf)(\?|$)/i, 'file'],
];

// The private part of both lists. Without it the script still runs, and says so: a host only that
// file knows is then rated "medium" and captured as a "page", which is the answer for any unknown host.
const HOSTS_FILE = path.join(__dirname, 'source-hosts.json');
let PRIVATE = null;
try { PRIVATE = JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') {
    console.error('checks/source-hosts.json cannot be read (' + e.message + '). Fix the file in family-tree-private (see the shape at the top of checks/manifest.js), then run this again. Nothing was written.');
    process.exit(1);
  }
}
const NO_HOSTS_NOTE = 'NOTE: checks/source-hosts.json is not here, so the hosts only that private file lists are rated "medium" and "page". ' +
  'Do not copy this run\'s sources/urls.tsv into the archive repo: run bash tools/cloud-setup.sh (it links the file from family-tree-private), then run this again.';
if (!PRIVATE) console.log(NO_HOSTS_NOTE + '\n');
const listed = (group, level) => {
  const a = PRIVATE && PRIVATE[group] && PRIVATE[group][level];
  return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x).map(x => x.toLowerCase()) : [];
};
// one answer per level, in the order of the lists above: the first level that knows the URL wins
const pick = (table, group, url, fallback) => {
  const low = url.toLowerCase();
  const hit = table.find(([re, level]) => re.test(url) || listed(group, level).some(h => low.includes(h)));
  return hit ? hit[1] : fallback;
};

function classify(url) {
  return { risk: pick(RISK, 'risk', url, 'medium'), kind: pick(KIND, 'kind', url, 'page') };
}

const { people } = L.load();
const map = new Map();
const note = (url, label, card, where) => {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (!map.has(url)) map.set(url, { url, labels: new Set(), cards: new Set(), where: new Set() });
  const e = map.get(url);
  if (label) e.labels.add(String(label).slice(0, 180));
  e.cards.add(card);
  e.where.add(where);
};

for (const p of people) {
  const n = p.node, pr = n.profile || {};
  (n.src || []).forEach(s => note(s.u, s.l, p.id, 'src'));
  (pr.sources || []).forEach(s => note(s.url, s.label, p.id, 'profile.sources'));
  (pr.docs || []).forEach(s => note(s.url, s.cap, p.id, 'docs'));
  (pr.links || []).forEach(s => note(s.url, s.label, p.id, 'profile.links'));
}

const entries = [...map.values()].map(e => {
  const { risk, kind } = classify(e.url);
  return {
    // stable id: the archive path never moves when a label is reworded
    id: crypto.createHash('sha1').update(e.url).digest('hex').slice(0, 12),
    url: e.url,
    host: (() => { try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { return '?'; } })(),
    risk, kind,
    label: [...e.labels][0] || '',
    cards: [...e.cards].sort(),
    dependents: e.cards.size,
    where: [...e.where].sort(),
  };
}).sort((a, b) => {
  const r = { high: 0, medium: 1, low: 2 };
  return (r[a.risk] - r[b.risk]) || (b.dependents - a.dependents) || a.host.localeCompare(b.host);
});

const dir = path.join(__dirname, '..', 'sources');
fs.mkdirSync(dir, { recursive: true });

// Two files, because they go to two different places.
// The full one stays here, git-ignored, and carries the card names — that is what makes
// checks/archive-status.js able to say "these cards would lose their evidence".
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify({
  generated: 'regenerate with node checks/manifest.js',
  count: entries.length,
  entries,
}, null, 1));

// The archive repo gets a plain list instead. It deliberately drops the card names: the archiver
// needs to know HOW MUCH depends on a source, never WHO — keeping people out of the archive repo
// entirely is the point. It is also a fifth the size, and a text file stays readable when every
// tool that understands this JSON is gone, which for a preservation format is not a small thing.
const tsv = [
  '# Sources the Nitschelm family tree cites. Generated by checks/manifest.js — do not hand-edit.',
  '# Card names are deliberately omitted. Columns: risk, cards-depending, kind, url',
  ...entries.map(e => [e.risk, e.dependents, e.kind, e.url].join('\t')),
].join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'urls.tsv'), tsv);

const by = (k, v) => entries.filter(e => e[k] === v).length;
console.log(`MANIFEST: ${entries.length} distinct URLs, ${new Set(entries.map(e => e.host)).size} hosts`);
console.log(`  by risk of vanishing:  high ${by('risk', 'high')}   medium ${by('risk', 'medium')}   low ${by('risk', 'low')}`);
console.log(`  by capture kind:       page ${by('kind', 'page')}   gated ${by('kind', 'gated')}   scan ${by('kind', 'scan')}   file ${by('kind', 'file')}   already-archived ${by('kind', 'already-archived')}`);
console.log('');
console.log('The ten the site would miss most if they went dark tonight:');
entries.slice(0, 10).forEach(e => console.log(`  ${String(e.dependents).padStart(3)} cards  ${e.risk.padEnd(6)} ${e.kind.padEnd(9)} ${e.url.slice(0, 88)}`));
if (!PRIVATE) console.log('\n' + NO_HOSTS_NOTE);
