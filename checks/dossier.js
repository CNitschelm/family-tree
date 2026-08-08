'use strict';
// Print everything a writer or auditor needs to work ONE card, whole-card rule.
// Usage: node checks/dossier.js "<name substring>" [--brief]
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const { data, people, gaz } = L.load();
const q = process.argv[2];
const brief = process.argv.includes('--brief');
const matches = people.filter(p => p.id.toLowerCase().includes(q.toLowerCase()));
if (matches.length !== 1) {
  console.error(matches.length ? 'AMBIGUOUS:\n' + matches.map(m => '  ' + m.id).join('\n') : 'no card matches ' + q);
  process.exit(1);
}
const p = matches[0];
const n = p.node, pr = n.profile || {};

// parents / children / siblings
const parentOf = new Map();
for (const q2 of people) (q2.node.unions || []).forEach(u => (u.c || []).forEach(c => parentOf.set(c, { parent: q2, union: u })));
const rec = parentOf.get(n);

const out = [];
const W = s => out.push(s);
W(`CARD: ${p.id}`);
W(`sex: ${n.g || '(unset)'}    provenance tags: ${[n._n26 && '_n26', n._g26 && '_g26', n.tag && 'tag=' + n.tag].filter(Boolean).join(' ') || 'none'}`);
if (rec) {
  W(`parents: ${rec.parent.id}  ×  ${rec.union.s || '(unnamed)'} ${rec.union.sy || ''}`);
  const sibs = (rec.parent.node.unions || []).flatMap(u => u.c || []).filter(c => c !== n);
  W(`siblings drawn (${sibs.length}): ${sibs.map(c => `${c.name} ${c.years || ''}`).join(' · ') || '—'}`);
} else W('parents: (root of the tree)');
(n.unions || []).forEach((u, i) => {
  W(`union[${i}]: ${u.s || '(unnamed)'} ${u.sy || ''}${u.div ? ' [divorced]' : ''}`);
  W(`  children drawn (${(u.c || []).length}): ${(u.c || []).map(c => `${c.name} ${c.years || ''}`).join(' · ') || '—'}`);
});
W('');
W('---- EVERY USER-VISIBLE FIELD (this is the unit of work: all of it, both languages) ----');
for (const f of L.fields(p)) W(`\n[${f.path}]\n${f.text}`);
W('');
W('---- MAP PINS (pl[]) ----');
(n.pl || []).forEach((r, i) => {
  const g = gaz[r.k] || {};
  W(`pl[${i}]  ${r.t.padEnd(10)} @ ${r.k} (${g.n || '??'}, ${g.c || ''}; ${g.lat}, ${g.lon}; kind=${g.k})  c=${r.c}${r.x ? ' x=ALT' : ''}  ${r.y || ''}${r.y2 ? '–' + r.y2 : ''}  ${r.d || ''}`);
  if (r.w) W(`     w    : ${r.w}`);
  if (r.w_fr) W(`     w_fr : ${r.w_fr}`);
});
W('');
W('---- THE EVIDENCE THIS CARD ACTUALLY CARRIES ----');
W('(a claim in prose must trace to something in this list, or say plainly that it does not)');
const inv = L.sourceInventory(p);
if (!inv.length) W('  *** NONE. This card carries no source at all. ***');
inv.forEach(i => W(`  ${i.path}: ${i.text.slice(0, 400)}`));
W('');
W('---- ARITHMETIC ANCHORS ----');
const y = L.yearsOf(n);
W(`  dates line: ${n.years}   (birth ${y.b || '?'}, death ${y.d || '?'})`);
(n.pl || []).forEach((r, i) => { if (r.d) W(`  pl[${i}] ${r.t}: ${r.d}`); });
if (rec) {
  const py = L.yearsOf(rec.parent.node);
  W(`  father: ${rec.parent.node.years}   mother: ${rec.union.sy || '?'}`);
}
(n.unions || []).forEach((u, i) => (u.c || []).forEach(c => W(`  child ${c.name}: ${c.years || '?'}`)));

if (!brief) {
  W('');
  W('---- MACHINE FINDINGS ON THIS CARD ----');
  let F = [];
  try { F = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8')); } catch (e) { }
  const mine = F.filter(f => f.card === p.id);
  if (!mine.length) W('  (none)');
  const rank = { high: 0, med: 1, review: 2, low: 3 };
  mine.sort((a, b) => rank[a.sev] - rank[b.sev]).forEach(f => {
    W(`  [${f.sev}/${f.check}] ${f.path} — ${f.msg}`);
    const d = f.detail || {};
    if (d.hedged) { W(`      hedged: ${d.hedged}`); W(`      flat  : ${d.flat}`); }
    if (d.sentence) W(`      "${d.sentence}"`);
    if (d.matrix) W(`      computed: ${d.matrix.join(' · ')}`);
    if (d.candidates) W(`      computed: ${d.candidates.join(' · ')}`);
    if (d.nearest) W(`      gazetteer: ${d.nearest.join(' · ')}`);
    if (d.en) { W(`      EN: ${d.en}`); W(`      FR: ${d.fr}`); }
  });
  W('');
  W('---- WHAT THE UNCOMMITTED 7 AUG PASS CHANGED ON THIS CARD (every line here is [NEW]) ----');
  let D = null;
  try { D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'diff.json'), 'utf8')); } catch (e) { }
  const key = `${n.name}|${n.years || ''}`;
  const dr = D && D.report.find(r => r.card === key);
  if (!dr) W('  (this card was not touched by the 7 Aug pass — every defect on it is [LIVE])');
  else dr.diffs.forEach(d => {
    W(`\n  FIELD ${d.field}`);
    W(`  PUBLISHED: ${d.before === null ? '(absent)' : d.before}`);
    W(`  LOCAL NOW: ${d.after === null ? '(absent)' : d.after}`);
  });
}
console.log(out.join('\n'));
