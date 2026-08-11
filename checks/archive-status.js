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

// A source counts as covered if we hold ANYTHING for it — but the two kinds are not equal and
// this file must stop pretending they are. `ok` means the fetcher got a 200 and saved the bytes.
// A hand file in archive/hand/ is a transcription: someone read the page and wrote down what it
// said. Those were never registered in state.json, which is why this reported 50% while the
// archive was described as complete. Both numbers were wrong. Count them, separately, and say so.
const handDir = path.join(ROOT, 'archive', 'hand');
const hasHand = e => fs.existsSync(path.join(handDir, e.id + '.txt'));
const auto = e => { const s = state[e.id]; return !!(s && s.ok); };
const held = e => auto(e) || hasHand(e);
const STALE = 180 * 864e5;
const stale = e => { const s = state[e.id]; return s && s.ok && (Date.now() - Date.parse(s.fetched)) > STALE; };

const total = manifest.entries.length;
const have = manifest.entries.filter(held);
const pct = n => ((n / total) * 100).toFixed(0) + '%';

// the real measure: cards whose evidence survives
const allCards = new Set(manifest.entries.flatMap(e => e.cards));
const coveredCards = new Set(have.flatMap(e => e.cards));
const orphaned = [...allCards].filter(c => !coveredCards.has(c));

console.log(`ARCHIVE COVERAGE`);
console.log(`  sources with a copy   ${have.length} / ${total}  (${pct(have.length)})`);
console.log(`    fetched bytes       ${manifest.entries.filter(auto).length}`);
console.log(`    hand transcription  ${manifest.entries.filter(e => hasHand(e) && !auto(e)).length}   (a reading of the page, not the page)`);
console.log(`  NOTE  a 200 is not proof the bytes are the record. Run checks/archive-verify.js —`);
console.log(`        on 11 Aug 2026 it found 41 of these are a wall, a viewer frame or an empty file.`);
console.log(`  copies over 180 days  ${manifest.entries.filter(stale).length}`);
console.log(`  cards whose evidence survives a blackout   ${coveredCards.size} / ${allCards.size}`);
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
const changed = Object.values(state).filter(s => s.result === 'CHANGED');
if (changed.length) {
  console.log(`\nCHANGED SINCE WE LAST LOOKED — check the card still says what the source says:`);
  changed.forEach(s => console.log(`  ${s.dependents} cards  ${s.url}`));
}
if (orphaned.length) console.log(`\n${orphaned.length} card(s) have no archived source at all.`);
