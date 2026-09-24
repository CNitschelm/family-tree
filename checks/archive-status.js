'use strict';
// How much of the site's evidence do we actually hold a copy of?
//
//   node checks/archive-status.js
//
// A citation to a dead page is not a citation. This answers the only question that matters:
// if every one of these sites went dark tonight, how many cards could still show their evidence?
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const mf = path.join(ROOT, 'sources', 'MANIFEST.json');
const tsvPath = path.join(ROOT, 'sources', 'urls.tsv');
const st = path.join(ROOT, 'archive', 'store', 'state.json');
const handDir = path.join(ROOT, 'archive', 'hand');
// the working copy has the full manifest with card names; the archive repo has urls.tsv without
let manifest;
if (fs.existsSync(mf)) manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
else if (fs.existsSync(tsvPath)) {
  const crypto = require('crypto');
  manifest = { entries: fs.readFileSync(tsvPath, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => {
    const [risk, dependents, kind, url] = l.split('\t');
    return { id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 12), url, risk, kind,
             dependents: Number(dependents) || 0, cards: [] };
  }) };
} else { console.error('no sources/MANIFEST.json and no sources/urls.tsv'); process.exit(1); }
const state = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : {};

// Pages saved out of a logged-in browser because no script may have them — Geneanet and FindAGrave
// refuse automated clients, and the Internet Archive holds no snapshot of these deep links. One
// file per source id. They count as held: the text of the page is what the citation rests on.
const hand = new Set(fs.existsSync(handDir)
  ? fs.readdirSync(handDir).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, ''))
  : []);

// A source we captured once is still held when a later run is refused (a 429, a 403, a timeout):
// the copy on disk did not go anywhere. fetch.mjs keeps it as `lastGood` on the failed record.
const copyOnDisk = s => !!(s && (s.ok || (s.lastGood && s.lastGood.file)));
const held = e => copyOnDisk(state[e.id]) || hand.has(e.id);
const STALE = 180 * 864e5;
const heldSince = s => (s.ok ? s.fetched : s.lastGood && s.lastGood.fetched);
const stale = e => { const s = state[e.id]; return copyOnDisk(s) && (Date.now() - Date.parse(heldSince(s))) > STALE; };

// A change somebody has already checked against the cards is closed, and stays closed for that
// capture. One line per review in archive/reviewed.tsv: id, the sha256 of the capture reviewed,
// the date, what was found. Without this the same change was re-reported on every run for six
// months, and every report sent somebody back to re-read the same cards.
const reviewedPath = path.join(ROOT, 'archive', 'reviewed.tsv');
const reviewed = new Set(fs.existsSync(reviewedPath)
  ? fs.readFileSync(reviewedPath, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'))
      .map(l => l.split('\t')).map(([id, sha]) => `${id}\t${sha}`)
  : []);

const total = manifest.entries.length;
const have = manifest.entries.filter(held);
const pct = n => ((n / total) * 100).toFixed(0) + '%';

// the real measure: cards whose evidence survives
const allCards = new Set(manifest.entries.flatMap(e => e.cards));
const coveredCards = new Set(have.flatMap(e => e.cards));
const orphaned = [...allCards].filter(c => !coveredCards.has(c));

const byHand = have.filter(e => hand.has(e.id) && !copyOnDisk(state[e.id]));
const viaIA = have.filter(e => (state[e.id] || {}).result === 'wayback');
const own = have.length - viaIA.length - byHand.length;

console.log('');
console.log(`  ${pct(have.length)} of the sources this family tree cites are safe.`);
console.log(`  If every one of those sites went dark tonight, ${have.length} of ${total} could still be read.`);
if (allCards.size) {
  console.log(`  ${((coveredCards.size / allCards.size) * 100).toFixed(0)}% of people on the tree would still have at least one source you can open.`);
}
console.log('');
console.log(`ARCHIVE COVERAGE`);
console.log(`  our own copy of the live page      ${own}`);
console.log(`  Internet Archive snapshot instead  ${viaIA.length}`);
console.log(`  saved by hand from a browser       ${byHand.length}`);
console.log(`  no copy at all                     ${total - have.length}`);
console.log(`  copies over 180 days old           ${manifest.entries.filter(stale).length}`);
if (allCards.size) console.log(`  cards whose evidence survives a blackout   ${coveredCards.size} / ${allCards.size}`);
else console.log(`  (card-level coverage needs the full MANIFEST.json — run this in the family-tree working copy)`);
console.log('');
for (const risk of ['high', 'medium', 'low']) {
  const g = manifest.entries.filter(e => e.risk === risk);
  console.log(`  ${risk.padEnd(7)} ${g.filter(held).length}/${g.length} held`);
}
console.log('');
const gaps = manifest.entries.filter(e => !held(e)).sort((a, b) => b.dependents - a.dependents);
if (gaps.length) {
  console.log(`NOT YET HELD — ${gaps.length}, worst first by how many cards depend on them:`);
  gaps.slice(0, 15).forEach(e => {
    const s = state[e.id] || {};
    console.log(`  ${String(e.dependents).padStart(3)} cards  ${e.risk.padEnd(6)} ${(s.result || 'never tried').padEnd(11)} ${e.url.slice(0, 84)}`);
  });
  if (gaps.length > 15) console.log(`  … and ${gaps.length - 15} more`);
}
const changedAll = Object.values(state).filter(s => s.result === 'CHANGED');
const changed = changedAll.filter(s => !reviewed.has(`${s.id}\t${s.sha256}`));
if (changed.length) {
  console.log(`\nCHANGED SINCE WE LAST LOOKED — check the card still says what the source says, then add a line to archive/reviewed.tsv:`);
  changed.forEach(s => console.log(`  ${s.dependents} cards  ${s.url}` +
    (s.changes ? `  (−${s.changes.removedCount} +${s.changes.addedCount} lines)` : '')));
}
if (changedAll.length > changed.length) console.log(`  (${changedAll.length - changed.length} earlier change(s) already reviewed — archive/reviewed.tsv)`);
const refusedNow = manifest.entries.filter(e => { const s = state[e.id]; return s && !s.ok && s.lastGood; });
if (refusedNow.length) console.log(`  ${refusedNow.length} held source(s) refused us on the last try — the copy we hold stands`);
if (orphaned.length) console.log(`\n${orphaned.length} card(s) have no archived source at all.`);
