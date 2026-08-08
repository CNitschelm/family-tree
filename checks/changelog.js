'use strict';
// Turn the patch files into a readable change log: every edit, by card, with the
// reason its writer gave and the exact before/after. This is the audit trail —
// `data.json` shows what the site says now, this shows why each sentence changed.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'patches');

// batch id -> what that batch was
const BATCH = {
  '_decisions': 'coordinator — gazetteer coordinates corrected against geo.api.gouv.fr',
  'w1': 'Phase 1 writer — the Munster silence group',
  'w2': 'Phase 1 writer — Emmanuel Frédéric / Rothau',
  'w3': 'Phase 1 writer — Ottawa / Illinois',
  'w4': 'Phase 1 writer — Emile Paul',
  'w5': 'Phase 1 writer — Hans Jacob / Jean Jacques / André',
  'w6': 'Phase 1 writer — Jean Georges 1821 / Barbe',
  'w7': 'Phase 1 writer — the short West cards',
  'w8': 'Phase 1 writer — Sartre / Taylor / Frédéric Théodore',
  'coord1': 'coordinator — repair after the machine re-run',
  'coord2': 'coordinator — source appended for the Belsmith reading',
  'coord3': 'coordinator — repair after the machine re-run',
  'coord4': 'coordinator — test regressions: tooltips naming a spouse, over-long pin notes',
  'coord5': 'coordinator — Jean Georges 1792, birth pin mixing two registers',
  'r1': 'Phase 1 repair — after cold audit A1',
  'r2': 'Phase 1 repair — after cold audit A2',
  'r3': 'Phase 1 repair — after cold audit A3',
  'r4': 'Phase 1 repair — after cold audit A4',
  'pinrule': 'coordinator — the settled pin-certainty rule, applied tree-wide',
  'p1': 'Phase 2 writer — the Rothau sisters',
  'p2': 'Phase 2 writer — the five Jean Martins',
  'p3': 'Phase 2 writer — the Gunsbach emigrant siblings',
  'p4': 'Phase 2 writer — the Klamath Falls generation',
  'r5': 'Phase 2 repair — after the cold audit of the Rothau sisters',
  'r6': 'Phase 2 repair — after the cold audit of the Jean Martins and Gunsbach',
  'r7': 'Phase 2 repair — after the cold audit of the Klamath Falls generation',
  'q1': 'Phase 2 writer — the Schweitzer line',
  'q2': 'Phase 2 writer — the deep Munster and Gunsbach ancestors',
  'q3': 'Phase 2 writer — the moderns',
  'r8': 'Phase 2 repair — Albert and Charles Schweitzer, after the wave-2 cold audit',
  'r9': 'Phase 2 repair — the deep Alsace cards, after the wave-2 cold audit',
  'r10': 'Phase 2 repair — the Schweitzer chain, Charles Louis, Meylert',
  'r11': 'Phase 2 repair — the machine pass on r10',
  'r12': 'Phase 2 repair — Anne-Marie Schweitzer and Jean-Paul Sartre',
  'r13': 'Phase 2 repair — editorial machinery swept, five high findings',
  'r14': 'Phase 3 seams — the Oregon and Washington branch',
  'r15': 'Phase 3 seams — the Alsace registers and the Illinois branch',
  'r16': 'Phase 3 seams — the Schweitzer line and the kinship claims',
  'coord6': 'coordinator — restored a true attribution, corrected a distance, French negatives',
  'r17': 'Phase 4 repair — the Alsace registers, after the cold audit',
  'r18': 'Phase 4 repair — the Schweitzer line, after the cold audit',
  'r19': 'Phase 4 repair — the French branch and the moderns, after the cold audit',
  'r20': 'Phase 4 repair — the Oregon and Washington branch, after the cold audit',
  'r21': 'Phase 4 repair — the Illinois branch, after the cold audit'
};
const ORDER = ['_decisions', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'coord1', 'coord2', 'coord3',
  'r1', 'r2', 'r3', 'r4', 'coord4', 'pinrule', 'p1', 'p2', 'p3', 'p4', 'coord5', 'r5', 'r6', 'r7', 'q1', 'q2', 'q3',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'coord6',
  'r17', 'r18', 'r19', 'r20', 'r21'];

const byCard = new Map();
let total = 0;
for (const id of ORDER) {
  const f = path.join(DIR, id + '.json');
  if (!fs.existsSync(f)) continue;
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const c of p) for (const e of (c.edits || [])) {
    total++;
    if (!byCard.has(c.card)) byCard.set(c.card, []);
    byCard.get(c.card).push({ batch: id, ...e });
  }
}

const out = [];
out.push('# Change log — every edit, and the reason given for it');
out.push('');
out.push(`Generated from \`patches/*.json\` by \`checks/changelog.js\`. **${total} edits on ${byCard.size} cards.**`);
out.push('');
out.push('Each edit was applied by `checks/patch.js`, which requires the exact current text of the field');
out.push('and rejects the edit if it does not match byte for byte. No regex ever touched prose. Where a');
out.push('card appears more than once, later batches are repairs made after a cold auditor read it.');
out.push('');
out.push('| batch | what it was |');
out.push('|---|---|');
for (const id of ORDER) if (BATCH[id] && fs.existsSync(path.join(DIR, id + '.json'))) out.push(`| \`${id}\` | ${BATCH[id]} |`);
out.push('');
out.push('---');
out.push('');

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
for (const [card, edits] of [...byCard.entries()].sort()) {
  out.push(`## ${card.replace('|', ' ')}`);
  out.push('');
  for (const e of edits) {
    const what = e.op ? `\`${e.op}\`${e.key ? ' ' + e.key : ''}` : `\`${e.path}\``;
    out.push(`**${what}** · ${e.batch}`);
    out.push('');
    out.push(`> ${e.why || '(no reason given)'}`);
    out.push('');
    if (e.expect !== undefined) { out.push('```diff'); out.push('- ' + String(e.expect)); out.push('+ ' + String(e.value)); out.push('```'); }
    else if (e.op) { out.push('```json'); out.push(JSON.stringify(e.value)); out.push('```'); }
    else { out.push('```diff'); out.push('+ ' + String(e.value) + '   (field did not exist)'); out.push('```'); }
    out.push('');
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'CHANGE-LOG-2026-08-07.md'), out.join('\n'));
console.log(`wrote CHANGE-LOG-2026-08-07.md — ${total} edits, ${byCard.size} cards`);
