#!/usr/bin/env node
'use strict';
/*
 * lock — one writer at a time.  (OPERATING.md, "One writer")
 *
 *   node tools/lock.js status
 *   node tools/lock.js take "<who>" ["<what you are doing>"] [--steal]
 *   node tools/lock.js release "<who>"
 *
 * Two sessions editing this folder at once is how a changelog entry was overwritten on
 * 20 Sep 2026 and how payloads have gone out built from each other's stale copies.
 * tools/change.js refuses to write while someone else holds the lock (a lock older than
 * 12 hours is treated as abandoned). The mount cannot delete files, so release writes "free".
 */
const fs = require('fs');
const L = require('./ledger.js');
const [cmd, who, what] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const steal = process.argv.includes('--steal');
fs.mkdirSync(L.LEDGER, { recursive: true });
const cur = L.lockState();
if (cmd === 'status' || !cmd) {
  console.log(cur ? `held by "${cur.who}" since ${cur.since}${cur.what ? ' — ' + cur.what : ''}${cur.stale ? ' (STALE: over 12 hours)' : ''}` : 'free');
} else if (cmd === 'take') {
  if (!who) { console.error('say who you are: node tools/lock.js take "<who>"'); process.exit(2); }
  if (cur && !cur.stale && cur.who !== who && !steal) {
    console.error(`REFUSED: held by "${cur.who}" since ${cur.since}${cur.what ? ' — ' + cur.what : ''}. Wait, or add --steal if that session is gone.`);
    process.exit(1);
  }
  fs.writeFileSync(L.LOCK, JSON.stringify({ who, what: what || '', since: new Date().toISOString() }) + '\n');
  console.log(`taken by "${who}"`);
} else if (cmd === 'release') {
  if (cur && cur.who !== who && !steal) { console.error(`REFUSED: held by "${cur.who}", not "${who}"`); process.exit(1); }
  fs.writeFileSync(L.LOCK, 'free\n');
  console.log('free');
} else { console.error('usage: node tools/lock.js status | take "<who>" ["<what>"] | release "<who>"'); process.exit(2); }
