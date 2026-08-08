'use strict';
// Field-level diff between the published payload and the local working copy.
// Every difference here is a [NEW] change made by the uncommitted 7 Aug pass.
const fs = require('fs');
const path = require('path');

function loadPeople(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  (function walk(n, ppath) {
    out.push({ node: n, ppath });
    (n.unions || []).forEach((u, ui) => (u.c || []).forEach((c, ci) => walk(c, ppath + `/u${ui}c${ci}`)));
  })(d, 'root');
  return { data: d, people: out };
}

// user-visible strings, keyed by a stable field path
function fieldsOf(n) {
  const m = new Map();
  const put = (k, v) => { if (typeof v === 'string') m.set(k, v); };
  put('note', n.note); put('note_fr', n.note_fr);
  put('mn', n.mn); put('mn_fr', n.mn_fr);
  put('name', n.name); put('years', n.years); put('g', n.g);
  const pr = n.profile || {};
  put('profile.headline', pr.headline); put('profile.headline_fr', pr.headline_fr);
  (pr.bio || []).forEach((t, i) => put(`bio[${i}]`, t));
  (pr.bio_fr || []).forEach((t, i) => put(`bio_fr[${i}]`, t));
  (pr.sources || []).forEach((s, i) => { put(`psrc[${i}].label`, s.label); put(`psrc[${i}].label_fr`, s.label_fr); put(`psrc[${i}].url`, s.url); });
  (pr.docs || []).forEach((d, i) => {
    put(`docs[${i}].cap`, d.cap); put(`docs[${i}].cap_fr`, d.cap_fr);
    put(`docs[${i}].tr`, d.tr); put(`docs[${i}].tr_fr`, d.tr_fr); put(`docs[${i}].u`, d.u);
    m.set(`docs[${i}].img.len`, String((d.img || '').length));
  });
  (n.src || []).forEach((s, i) => { put(`src[${i}].l`, s.l); put(`src[${i}].u`, s.u); put(`src[${i}].q`, s.q); });
  (n.unions || []).forEach((u, i) => { put(`union[${i}].s`, u.s); put(`union[${i}].sy`, u.sy); put(`union[${i}].n`, u.n); put(`union[${i}].n_fr`, u.n_fr); });
  (n.pl || []).forEach((r, i) => {
    m.set(`pl[${i}]`, JSON.stringify({ k: r.k, t: r.t, c: r.c, y: r.y, y2: r.y2, d: r.d, x: r.x }));
    put(`pl[${i}].w`, r.w); put(`pl[${i}].w_fr`, r.w_fr);
  });
  if (n.img) m.set('img.len', String(n.img.length));
  return m;
}

const A = loadPeople(process.argv[2]);   // published
const B = loadPeople(process.argv[3]);   // local

const keyOf = p => `${p.node.name}|${p.node.years || ''}`;
const aMap = new Map(A.people.map(p => [keyOf(p), p]));
const bMap = new Map(B.people.map(p => [keyOf(p), p]));

const report = [];
let changed = 0, fieldsChanged = 0;
for (const [k, bp] of bMap) {
  const ap = aMap.get(k);
  if (!ap) { report.push({ card: k, kind: 'ADDED PERSON' }); changed++; continue; }
  const af = fieldsOf(ap.node), bf = fieldsOf(bp.node);
  const keys = new Set([...af.keys(), ...bf.keys()]);
  const diffs = [];
  for (const f of keys) {
    const a = af.get(f), b = bf.get(f);
    if (a === b) continue;
    diffs.push({ field: f, before: a === undefined ? null : a, after: b === undefined ? null : b });
  }
  if (diffs.length) { changed++; fieldsChanged += diffs.length; report.push({ card: k, diffs }); }
}
for (const [k] of aMap) if (!bMap.has(k)) { report.push({ card: k, kind: 'REMOVED PERSON' }); changed++; }

// gazetteer + legacy
const gA = A.data.gaz || {}, gB = B.data.gaz || {};
const gz = [];
for (const k of new Set([...Object.keys(gA), ...Object.keys(gB)])) {
  const a = JSON.stringify(gA[k] || null), b = JSON.stringify(gB[k] || null);
  if (a !== b) gz.push({ key: k, before: a, after: b });
}
const lgA = JSON.stringify(A.data._legacy || null), lgB = JSON.stringify(B.data._legacy || null);

console.error(`people: published ${A.people.length} local ${B.people.length}`);
console.error(`cards changed: ${changed}   fields changed: ${fieldsChanged}`);
console.error(`gazetteer entries changed: ${gz.length}   _legacy changed: ${lgA !== lgB}`);
fs.writeFileSync(process.argv[4] || '/tmp/ft/diff.json', JSON.stringify({ report, gz, legacyChanged: lgA !== lgB }, null, 1));

// human-readable
const out = ['# The uncommitted 7 Aug pass — exact field diff against published `4b266e7`', '',
  `${changed} cards changed, ${fieldsChanged} fields. Everything below is a **[NEW]** change.`, ''];
for (const r of report) {
  out.push(`## ${r.card}`); out.push('');
  if (r.kind) { out.push(`**${r.kind}**`); out.push(''); continue; }
  for (const d of r.diffs) {
    out.push(`**\`${d.field}\`**`); out.push('');
    out.push('```diff');
    out.push('- ' + (d.before === null ? '(absent)' : d.before));
    out.push('+ ' + (d.after === null ? '(absent)' : d.after));
    out.push('```'); out.push('');
  }
}
if (gz.length) { out.push('## Gazetteer'); out.push(''); gz.forEach(g => out.push(`- \`${g.key}\`: ${g.before} → ${g.after}`)); out.push(''); }
fs.writeFileSync(process.argv[5] || '/tmp/ft/DIFF-vs-published.md', out.join('\n'));
console.error('wrote diff.json + DIFF-vs-published.md');
