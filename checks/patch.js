'use strict';
// Apply whole-field replacements to data.json. NEVER a regex: each edit names a
// field path, the exact text it expects to find there, and the complete new text.
// Usage: node checks/patch.js <patch.json> [--dry]
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');

const patch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dry = process.argv.includes('--dry');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const people = [];
(function walk(n) { people.push(n); (n.unions || []).forEach(u => (u.c || []).forEach(walk)); })(data);

function resolve(node, p) {
  // returns {get, set} for a field path such as bio[3], pl[2].w, union[0].n_fr,
  // docs[1].tr, profile.headline, note_fr, src[0].l, psrc[2].label
  let m;
  // never materialise `profile` for a card that has none: an empty profile
  // object fails the bilingual-bio and cites-a-source tests.
  const needsProfile = /^(?:bio(_fr)?\[|(?:profile\.)?headline|docs\[|(?:profile\.sources|psrc)\[)/.test(p);
  if (needsProfile && !node.profile) return null;
  const pr = node.profile || {};
  if ((m = p.match(/^bio(_fr)?\[(\d+)\]$/))) {
    const arr = m[1] ? (pr.bio_fr = pr.bio_fr || []) : (pr.bio = pr.bio || []);
    return { get: () => arr[+m[2]], set: v => { arr[+m[2]] = v; } };
  }
  if ((m = p.match(/^(?:profile\.)?headline(_fr)?$/))) {
    const k = m[1] ? 'headline_fr' : 'headline';
    return { get: () => pr[k], set: v => { pr[k] = v; } };
  }
  if ((m = p.match(/^(note|note_fr|mn|mn_fr|name|years|g)$/)))
    return { get: () => node[m[1]], set: v => { node[m[1]] = v; } };
  if ((m = p.match(/^pl\[(\d+)\]\.(w|w_fr|c|k|t|d|y|y2|x)$/))) {
    const r = (node.pl || [])[+m[1]];
    if (!r) return null;
    return { get: () => r[m[2]], set: v => { if (v === null) delete r[m[2]]; else r[m[2]] = v; } };
  }
  if ((m = p.match(/^union\[(\d+)\]\.(n|n_fr|s|sy)$/))) {
    const u = (node.unions || [])[+m[1]];
    if (!u) return null;
    return { get: () => u[m[2]], set: v => { if (v === null) delete u[m[2]]; else u[m[2]] = v; } };
  }
  if ((m = p.match(/^docs\[(\d+)\]\.(cap|cap_fr|tr|tr_fr|u)$/))) {
    const d = (pr.docs || [])[+m[1]];
    if (!d) return null;
    return { get: () => d[m[2]], set: v => { d[m[2]] = v; } };
  }
  if ((m = p.match(/^src\[(\d+)\]\.(l|u|q)$/))) {
    const s = (node.src || [])[+m[1]];
    if (!s) return null;
    return { get: () => s[m[2]], set: v => { if (v === null) delete s[m[2]]; else s[m[2]] = v; } };
  }
  if ((m = p.match(/^(?:profile\.sources|psrc)\[(\d+)\]\.(label|label_fr|url)$/))) {
    const s = (pr.sources || [])[+m[1]];
    if (!s) return null;
    return { get: () => s[m[2]], set: v => { s[m[2]] = v; } };
  }
  return null;
}

const norm = s => typeof s === 'string' ? s.replace(/\r\n/g, '\n') : s;
let applied = 0; const errors = [];
const cards = Array.isArray(patch) ? patch : [patch];

for (const c of cards) {
  const [name, years] = String(c.card).split('|');
  const gazOnly = c.card === '__gaz__';
  const node = gazOnly ? null : people.find(x => x.name === name && (x.years || '') === (years || ''));
  if (!gazOnly && !node) { errors.push(`card not found: ${c.card}`); continue; }
  for (const e of (c.edits || [])) {
    // structural additions the writer may legitimately need
    if (e.op === 'appendSource') {
      node.src = node.src || [];
      node.src.push(e.value);
      if (e.profileValue) {
        if (!node.profile) { errors.push(`${c.card} :: appendSource has profileValue but the card has no profile`); continue; }
        node.profile.sources = node.profile.sources || [];
        node.profile.sources.push(e.profileValue);
      }
      applied++; continue;
    }
    if (e.op === 'gaz') {
      if (!data.gaz[e.key]) { errors.push(`gaz key not found: ${e.key}`); continue; }
      Object.assign(data.gaz[e.key], e.value); applied++; continue;
    }
    const r = resolve(node, e.path);
    if (!r) { errors.push(`${c.card} :: unknown path ${e.path}`); continue; }
    const cur = r.get();
    if (e.expect !== undefined && norm(cur) !== norm(e.expect)) {
      errors.push(`${c.card} :: ${e.path} — expect mismatch\n    have: ${JSON.stringify(String(cur).slice(0, 220))}\n    want: ${JSON.stringify(String(e.expect).slice(0, 220))}`);
      continue;
    }
    if (!dry) r.set(e.value);
    applied++;
  }
}
if (errors.length) { console.error('ERRORS:\n' + errors.map(e => ' - ' + e).join('\n')); }
console.log(`${dry ? '[dry] ' : ''}edits applied: ${applied}, errors: ${errors.length}`);
if (!dry && !errors.length) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
  console.log('data.json written');
}
process.exit(errors.length ? 1 : 0);
