#!/usr/bin/env node
'use strict';
/*
 * gate — the one check that decides whether this payload may be committed.
 * (OPERATING.md, "The loop", step 4.) Run it after `node tools/crypt.js encrypt`:
 *
 *   node checks/gate.js            # compares with origin/main, the payload that is live
 *
 * It passes only if:
 *   1. index.html's payload is exactly data.json (what was checked is what ships);
 *   2. every difference from the live payload is explained, step by step, by change sets
 *      in ledger/changes.jsonl — nothing edited by hand, nothing carried in from a stale
 *      copy, nothing lost (this is how a UI commit once undid a week of findings unseen);
 *   3. every edit's evidence still holds against the archive: its quote is in our copy of
 *      the source, and a "no record says X" is still true of that copy;
 *   4. every register entry an edit cites exists, and nothing reuses a retired card id;
 *   5. tests/run.js passes, and the prose linter finds no new HIGH on any card.
 * On a pass it writes .gate-stamp with the payload's iv. The commit-msg hook refuses to
 * commit an index.html whose iv has no passing stamp — so skipping the gate is not an option,
 * and neither is editing after it passed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const L = require('../tools/ledger.js');

const base = (process.argv.find(a => a.startsWith('--base=')) || '--base=origin/main').slice(7);
const STAMP = path.join(L.ROOT, '.gate-stamp');
const fails = [], notes = [];
const fail = m => fails.push(m);
const note = m => notes.push(m);
const section = t => console.log(`\n== ${t}`);

function finish() {
  notes.forEach(n => console.log('  note  ' + n));
  if (fails.length) {
    try { fs.writeFileSync(STAMP, 'FAIL\n'); } catch (_) {}
    console.log(`\nGATE: FAIL — ${fails.length} problem(s). Nothing may be committed until they are fixed:\n` +
      fails.map(f => '  ✗ ' + f).join('\n'));
    process.exit(1);
  }
}

// ---------------------------------------------------------------- 0. who holds the pen
const lk = L.lockState();
if (lk && !lk.stale && lk.who !== (process.env.FT_WHO || lk.who)) note(`ledger/LOCK is held by "${lk.who}" since ${lk.since}`);

// ---------------------------------------------------------------- 1. the file is the data
section('1. index.html carries exactly data.json');
const html = fs.readFileSync(path.join(L.ROOT, 'index.html'), 'utf8');
const enc = L.readEnc(html);
const shipped = L.decryptEnc(enc);
const data = L.loadData();
const shippedHash = L.hashData(shipped), dataHash = L.hashData(data);
if (shippedHash !== dataHash) fail('index.html does not carry data.json — run `node tools/crypt.js encrypt` (and nothing else) after the last change, then gate again');
else console.log(`  ok  payload iv ${enc.iv} = data.json (${dataHash.slice(0, 12)})`);
finish();

// ---------------------------------------------------------------- 2. every change is accounted for
section(`2. every difference from ${base} is in the ledger`);
let live;
try { live = L.payloadAt(base); } catch (e) { fail(`cannot read the live payload at ${base}: ${e.message}. Fetch origin in GitHub Desktop first.`); finish(); }
const liveHash = L.hashData(live);
const changes = L.loadChanges();
const trail = L.chain(changes, liveHash, dataHash);
function describeDiff(a, b) {
  const byId = d => new Map(L.cards(d).map(c => [c.node.id || '?' + c.path, c.node]));
  const A = byId(a), B = byId(b), out = [];
  for (const [id, n] of B) {
    const o = A.get(id);
    if (!o) { out.push(`  + ${id} ${L.label(n)} (new card)`); continue; }
    const la = L.leaves(o), lb = L.leaves(n);
    const keys = new Set([...Object.keys(la), ...Object.keys(lb)]);
    const changed = [...keys].filter(k => la[k] !== lb[k]);
    if (changed.length) out.push(`  ~ ${id} ${L.label(n)}: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` … (${changed.length})` : ''}`);
  }
  for (const [id, n] of A) if (!B.has(id)) out.push(`  - ${id} ${L.label(n)} (card gone)`);
  return out;
}
if (trail === null) {
  const d = describeDiff(live, data);
  fail(`data.json differs from the live payload in ways no chain of change sets explains (${d.length} card(s)):\n` +
    d.slice(0, 25).join('\n') + (d.length > 25 ? `\n  … ${d.length - 25} more` : '') +
    `\n    Every edit goes through node tools/change.js. If these differences are someone else's unpulled deploy,` +
    `\n    fetch/pull first; if they are hand edits, redo them as a change set on a fresh decrypt.`);
  finish();
}
const edits = trail.flatMap(c => c.edits.map(e => ({ ...e, cs: c.id, why: c.why })));
console.log(trail.length ? `  ok  ${trail.length} change set(s), ${edits.length} edit(s) explain every difference` : '  ok  no payload change (app-only commit)');

// ---------------------------------------------------------------- 3. the evidence still holds
section('3. evidence against the archive');
let checked = 0;
for (const e of edits) {
  for (const x of (e.evidence || [])) {
    if (!x.src || x.src === 'owner') continue;
    const a = L.archived(x.src);
    const where = `${e.cs} ${e.card} ${e.field || e.list || e.op}`;
    if (!a.held) { fail(`${where}: evidence ${x.src} is no longer in the archive (${a.why})`); continue; }
    if (x.quote) { const q = L.quoteIn(x.src, x.quote); if (q.ok === false) fail(`${where}: the quote is not in our copy of ${x.src}`); }
    if (x.absent && a.text) for (const w of [].concat(x.absent))
      if (L.normText(a.text).includes(L.normText(w))) fail(`${where}: "${w}" is in our copy of ${x.src}, though the edit said it was absent`);
    checked++;
  }
}
console.log(`  ok  ${checked} evidence item(s) re-checked`);

// ---------------------------------------------------------------- 4. register citations, ids
section('4. register and card ids');
const register = L.loadRegister();
const regIds = new Set(register.map(r => r.id));
for (const e of edits) if (e.register && !regIds.has(e.register)) fail(`${e.cs}: cites register ${e.register}, which does not exist`);
const ids = L.cards(data).map(c => c.node.id);
const missing = L.cards(data).filter(c => !c.node.id);
if (missing.length) fail(`${missing.length} card(s) have no id: ${missing.slice(0, 5).map(c => L.label(c.node)).join('; ')}`);
const dup = ids.filter((x, i) => x && ids.indexOf(x) !== i);
if (dup.length) fail(`duplicate card ids: ${[...new Set(dup)].join(', ')}`);
const retired = new Set(changes.flatMap(c => c.retired || []));
const reused = ids.filter(x => retired.has(x));
if (reused.length) fail(`retired card ids reused: ${reused.join(', ')}`);
const badReg = register.filter(r => (r.cards || []).some(c => !ids.includes(c) && !retired.has(c)));
if (badReg.length) note(`${badReg.length} register entr${badReg.length === 1 ? 'y names a card' : 'ies name cards'} not on the tree: ${badReg.slice(0, 5).map(r => r.id).join(', ')}`);
if (!fails.length) console.log(`  ok  ${ids.length} cards, all with unique ids; ${register.length} register entries`);

// ---------------------------------------------------------------- 5. the suites
section('5. tests and prose linter');
const t = spawnSync(process.execPath, [path.join(L.ROOT, 'tests', 'run.js')], { cwd: L.ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tl = (t.stdout || '').trim().split('\n');
const summary = tl.filter(l => /passed|failed|FAIL/i.test(l)).slice(-3).join(' | ');
if (t.status !== 0) fail(`tests/run.js failed: ${summary}\n    ` + tl.filter(l => /^\s*(FAIL|✗|not ok)/.test(l)).slice(0, 10).join('\n    '));
else console.log(`  ok  tests: ${summary}`);

function lint(d) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const f = path.join(dir, 'data.json'), out = path.join(dir, 'findings.json');
  fs.writeFileSync(f, L.serialize(d));
  const r = spawnSync(process.execPath, [path.join(L.ROOT, 'checks', 'run.js'), '--json', out],
    { cwd: L.ROOT, encoding: 'utf8', env: { ...process.env, FT_DATA: f }, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error((r.stderr || '').slice(-400));
  const F = JSON.parse(fs.readFileSync(out, 'utf8'));
  // a finding is known by its card id, check and path — not its wording
  const labelToId = new Map(L.cards(d).map(c => [`${c.node.name} ${c.node.years || ''}`.trim(), c.node.id]));
  return F.map(x => ({ ...x, cid: labelToId.get(x.card) || x.card }));
}
if (trail.length) {
  try {
    const before = lint(live), after = lint(data);
    const key = x => `${x.cid}|${x.check}|${x.path}`;
    const had = new Set(before.filter(x => x.sev === 'high').map(key));
    const fresh = after.filter(x => x.sev === 'high' && !had.has(key(x)));
    const touched = new Set(edits.map(e => e.card));
    const count = s => a => a.filter(x => x.sev === s).length;
    console.log(`  ok  linter: high ${count('high')(before)} → ${count('high')(after)}, med ${count('med')(before)} → ${count('med')(after)}`);
    if (fresh.length) fail(`the linter finds ${fresh.length} new HIGH finding(s):\n` + fresh.slice(0, 8).map(x => `    ${x.cid} ${x.check} ${x.path}: ${String(x.msg).slice(0, 140)}`).join('\n'));
    const freshMed = after.filter(x => x.sev === 'med' && touched.has(x.cid) && !before.some(y => key(y) === key(x)));
    if (freshMed.length) note(`${freshMed.length} new medium finding(s) on changed cards — read them: ` + freshMed.slice(0, 4).map(x => `${x.cid} ${x.check} ${x.path}`).join('; '));
  } catch (e) { fail(`the prose linter did not run: ${e.message}`); }
} else console.log('  --  no payload change; linter comparison skipped');

finish();
fs.writeFileSync(STAMP, `${enc.iv}\n${new Date().toISOString()} PASS ${trail.length} change set(s) ${edits.length} edit(s) over ${base}\n`);
console.log(`\nGATE: PASS — ${trail.length} change set(s), ${edits.length} edit(s). .gate-stamp written for iv ${enc.iv}; commit in GitHub Desktop.`);
