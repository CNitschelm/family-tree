#!/usr/bin/env node
'use strict';
/*
 * card — open one card before touching it.  (OPERATING.md, "The loop", step 1)
 *
 *   node tools/card.js <c042 | "Name|years" | part of a name> [--full]
 *
 * Prints what a writer or an auditor needs in one place, so nobody decides from memory:
 *   - the card's fields, with the field paths a change file uses;
 *   - every source it cites, and whether the archive holds a copy you can open and quote;
 *   - the register entries that bind it (settled questions, Cory's decisions) — read them
 *     before proposing anything they cover;
 *   - what has already been changed on it, and what was changed and then changed back.
 * Reading only; it writes nothing.
 */
const L = require('./ledger.js');
const ref = process.argv[2];
const full = process.argv.includes('--full');
if (!ref) { console.error('usage: node tools/card.js <c042 | "Name|years" | part of a name> [--full]'); process.exit(2); }
const data = L.loadData();
const c = L.findCard(data, ref);
if (!c) { console.error(`no card matches "${ref}"`); process.exit(1); }
if (c.ambiguous) { console.error(`"${ref}" matches several cards:\n  ` + c.ambiguous.join('\n  ')); process.exit(1); }
const n = c.node, pr = n.profile || {};
const cut = (s, k = full ? 100000 : 220) => { s = String(s ?? ''); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
const W = s => console.log(s);

W(`${n.id}  ${L.label(n)}${n.branch ? '  [branch ' + n.branch + ']' : ''}`);
if (c.parent) W(`  child of ${c.parent.id || '?'} ${L.label(c.parent)} × ${(c.parent.unions[c.unionIdx] || {}).s || '(unnamed)'}`);
(n.unions || []).forEach((u, i) => W(`  union[${i}] × ${u.s || '(unnamed)'} ${u.sy || ''} — ${(u.c || []).map(k => `${k.id} ${L.label(k)}`).join(', ') || 'no children drawn'}`));

W('\n-- fields (path: value) --');
const lv = L.leaves(n);
for (const [p, v] of Object.entries(lv)) {
  if (/^(img|imgL|docs\[\d+\]\.img)$/.test(p) || /^(id|name|years|branch)$/.test(p)) continue;
  if (!full && /_fr(\[|\.|$)|\.[a-z]+_fr$/.test(p)) continue;
  W(`  ${p}: ${cut(v)}`);
}
if (!full) W('  (French fields hidden; --full shows them and untrimmed text)');

W('\n-- sources and what the archive holds --');
const urls = [...new Set([...(n.src || []).map(s => s.u), ...(pr.sources || []).map(s => s.url)].filter(Boolean))];
for (const u of urls) {
  const a = L.archived(u);
  const how = a.held ? `${a.kind}${a.text ? ', text' : ', no text layer — read the image/PDF'}` : `NOT HELD (${a.why})`;
  W(`  ${a.held ? '✓' : '✗'} ${u}\n      ${how}${a.files && a.files.length ? '\n      ' + a.files.map(f => f.replace(L.ARCHIVE, '<archive>')).join('\n      ') : ''}`);
}
const noUrl = (n.src || []).filter(s => !s.u);
if (noUrl.length) W(`  ${noUrl.length} source(s) without a URL (family papers, letters): archive/family/ — cite as "family:<folder>"`);

W('\n-- register: what is settled for this card (cite it in any edit it covers) --');
let reg = [];
try { reg = L.loadRegister().filter(r => (r.cards || []).includes(n.id)); } catch (e) { W('  (register unreadable: ' + e.message + ')'); }
if (!reg.length) W('  none');
for (const r of reg) {
  W(`  ${r.id} [${r.status}${r.by ? ', ' + r.by : ''}${r.decided ? ', ' + r.decided : ''}]${r.superseded_by ? ' SUPERSEDED by ' + r.superseded_by : ''} ${r.topic}`);
  W(`      ruling: ${cut(r.ruling, full ? 100000 : 400)}`);
  if (r.fields && r.fields.length) W(`      covers: ${r.fields.join(', ')}${r.tokens && r.tokens.length ? '  tokens: ' + r.tokens.join(', ') : ''}`);
}

W('\n-- changes recorded in the ledger --');
const mine = L.loadChanges().flatMap(cs => cs.edits.filter(e => e.card === n.id).map(e => ({ cs, e })));
if (!mine.length) W('  none since the ledger began');
for (const { cs, e } of mine.slice(-(full ? 1000 : 12)))
  W(`  ${cs.at.slice(0, 10)} ${cs.id} ${e.kind || ''} ${e.field || e.list || e.op}${e.register ? ' [' + e.register + ']' : ''}${e.reverts ? ' [reverts]' : ''} — ${cut(cs.why, 120)}`);

if (process.argv.includes('--history')) {
  W('\n-- published history: fields that changed, and values that came back --');
  const H = L.history('origin/main', { quiet: true });
  const vs = H.map(v => ({ v, c: v.cards[n.id] })).filter(x => x.c);
  const series = {};
  for (const { v, c: cc } of vs) for (const [p, val] of Object.entries(cc.leaves)) (series[p] = series[p] || []).push([v, val]);
  for (const [p, arr] of Object.entries(series)) {
    const runs = [];
    arr.forEach(([v, val]) => { if (!runs.length || runs[runs.length - 1][1] !== val) runs.push([v, val]); });
    if (runs.length < 2) continue;
    const back = runs.some(([, val], i) => runs.slice(0, i - 1).some(([, w]) => w === val));
    if (back || full) W(`  ${back ? '↺ ' : '  '}${p}: ` + runs.map(([v, val]) => `${v.date.slice(0, 10)} ${cut(val, 40)}`).join('  →  '));
  }
} else W('\n(--history adds the published history of every field and flags values that came back)');
