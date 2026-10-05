#!/usr/bin/env node
'use strict';
/*
 * linkconf — how sure each parent-child link on the tree is (Cory, 5 Oct 2026, register R-0475).
 *
 *   node tools/linkconf.js check                     every child card has one entry, and nothing else
 *   node tools/linkconf.js show <card>               one link: the rating from the records, and any override
 *   node tools/linkconf.js list [low|medium|high]    the links by the figure the tree shows, lowest first
 *   node tools/linkconf.js override <card> <pct> "<his note>"   Cory's own figure for the link above <card>
 *   node tools/linkconf.js override <card> clear     takes it off again
 *   node tools/linkconf.js build                     writes media/owner.bin and media/links.bin (commit both, they are ciphertext)
 *   node tools/linkconf.js link                      the address that turns the owner view on, once per device
 *
 * The ratings live in ledger/link-confidence.json (private, never published): one entry per child card, with
 * the level and % the records support (`pct`), the basis and the reason, and, when Cory gives one, his
 * `override` {pct, note, date}. The tree shows the override when there is one, and the records' figure beside
 * it on hover. An override is his decision: add an owner entry to ledger/register.jsonl in his words too.
 * Research on weak links skips a link he has overridden unless his note asks for it.
 *
 * Who can see what. The % on each line is for everyone (Cory, 5 Oct 2026, register R-0481: "I want the
 * percentage to show up for everyone, all users can see it"): media/links.bin holds the figure the tree shows for
 * each link (his override when there is one) and nothing else, sealed under the payload key like every file in
 * media/. The reasons, the records' own figure beside an override, and his override notes stay his: media/owner.bin
 * is sealed twice. The outer layer is under the payload key, like
 * every file in media/ (tests/run.js proves each one is ciphertext that way). Inside it, the figures are under
 * a random key kept in .owner-key (private, gitignored), which a device receives once from the address `link`
 * prints (#owner=<key>) and keeps as a non-extractable key in the browser; #owner-off removes it. The family's
 * password opens the outer layer only. Keep .owner-key: a new key means every one of his devices needs the
 * new address.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const P = require('./payload.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ledger', 'link-confidence.json');
const KEYFILE = path.join(ROOT, '.owner-key');
const OUT = path.join(ROOT, P.MEDIA_DIR, 'owner.bin');
const PUB = path.join(ROOT, P.MEDIA_DIR, 'links.bin');

const level = p => p >= 90 ? 'high' : p >= 70 ? 'medium' : 'low';
const shown = r => r.override ? r.override.pct : r.pct;
const today = () => new Date().toISOString().slice(0, 10);

function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
function save(doc) { fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n'); }
function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  try { return fs.readFileSync(path.join(ROOT, '.password'), 'utf8').trim(); } catch (_) { return null; }
}
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function ownerKey(create) {
  try {
    const s = fs.readFileSync(KEYFILE, 'utf8').trim();
    const k = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (k.length === 32) return k;
    throw new Error('.owner-key is not a 32-byte key');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!create) return null;
    const k = crypto.randomBytes(32);
    fs.writeFileSync(KEYFILE, b64u(k) + '\n', { mode: 0o600 });
    console.log('made a new owner key in .owner-key (private: never commit it; every device needs the link below once)');
    return k;
  }
}
function siteUrl() {
  try { return 'https://' + fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim() + '/'; } catch (_) { return '(the site)/'; }
}

/* the tree's parent-child pairs, from data.json */
function pairs() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const out = new Map();
  (function walk(p) { (p.unions || []).forEach(u => (u.c || []).forEach(c => { out.set(c.id, p.id); walk(c); })); })(data);
  return out;
}

function check(doc) {
  const errs = [];
  const byChild = new Map();
  doc.links.forEach(r => {
    if (byChild.has(r.child)) errs.push(r.child + ': two entries');
    byChild.set(r.child, r);
    if (!Number.isInteger(r.pct) || r.pct < 0 || r.pct > 100) errs.push(r.child + ': pct must be a whole number 0-100');
    if (!['high', 'medium', 'low'].includes(r.level)) errs.push(r.child + ': level must be high, medium or low');
    else if (Number.isInteger(r.pct) && level(r.pct) !== r.level) errs.push(r.child + ': ' + r.pct + '% is ' + level(r.pct) + ', not ' + r.level + ' (high is 90 and up, medium 70 to 89)');
    if (!r.why) errs.push(r.child + ': no reason given');
    if (r.override) {
      const o = r.override;
      if (!Number.isInteger(o.pct) || o.pct < 0 || o.pct > 100) errs.push(r.child + ': override pct must be a whole number 0-100');
      if (!o.note || !o.date) errs.push(r.child + ': an override needs his note and the date');
    }
  });
  let tree = null;
  try { tree = pairs(); } catch (_) { console.log('note: no data.json here, so the entries were not checked against the tree'); }
  if (tree) {
    tree.forEach((par, ch) => {
      const r = byChild.get(ch);
      if (!r) errs.push(ch + ': on the tree, not rated (add an entry: parent ' + par + ')');
      else if (r.parent !== par) errs.push(ch + ': rated under ' + r.parent + ', but the tree has it under ' + par);
    });
    byChild.forEach((r, ch) => { if (!tree.has(ch)) errs.push(ch + ': rated, but no longer on the tree'); });
  }
  return errs;
}

function build(doc) {
  const errs = check(doc);
  if (errs.length) { console.error('link-confidence.json does not check:\n  ' + errs.join('\n  ')); process.exit(1); }
  const pw = password();
  if (!pw) { console.error('no password: set FT_PASSWORD or create .password'); process.exit(1); }
  const key = ownerKey(true);
  const l = {};
  doc.links.forEach(r => {
    const e = { p: shown(r), e: r.pct, w: r.why };
    if (r.override) e.o = r.override.note;
    l[r.child] = e;
  });
  const json = Buffer.from(JSON.stringify({ v: 1, made: today(), l }), 'utf8');
  const body = zlib.deflateRawSync(json, { level: 9 }), head = 'c:' + json.length;
  const iv = crypto.randomBytes(12);
  const inner = Buffer.concat([iv, P.gcmSeal(key, iv, Buffer.concat([Buffer.from([head.length]), Buffer.from(head, 'latin1'), body]))]);
  const enc = P.readEnc(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const file = P.sealBlob(P.keyFor(pw, enc.salt, enc.iter), 'o', inner, Buffer.concat([Buffer.from('owner\0'), inner])).file;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, file);
  /* prove it opens both ways before saying so */
  const outer = P.openBlob(P.keyFor(pw, enc.salt, enc.iter), fs.readFileSync(OUT));
  const pt = P.gcmOpen(key, outer.bytes.subarray(0, 12), outer.bytes.subarray(12));
  const back = JSON.parse(zlib.inflateRawSync(pt.subarray(1 + pt[0])).toString('utf8'));
  if (outer.header !== 'o' || Object.keys(back.l).length !== doc.links.length) throw new Error('media/owner.bin did not read back');
  console.log('wrote media/owner.bin: ' + doc.links.length + ' links, ' + doc.links.filter(r => r.override).length + ' with an override (commit it)');
  /* everyone's file: the figure only (R-0481). The same content gives the same bytes, so an unchanged
     build leaves git with nothing to commit; changed content gets a new iv (it is seeded on the content). */
  const pl = {};
  doc.links.forEach(r => { pl[r.child] = { p: shown(r) }; });
  const pjson = Buffer.from(JSON.stringify({ v: 1, l: pl }), 'utf8');
  const pkey = P.keyFor(pw, enc.salt, enc.iter);
  const pfile = P.sealBlob(pkey, 'k:' + pjson.length, zlib.deflateRawSync(pjson, { level: 9 }), Buffer.concat([Buffer.from('links\0'), pjson])).file;
  fs.writeFileSync(PUB, pfile);
  const pb = P.openBlob(pkey, fs.readFileSync(PUB));
  const pback = JSON.parse(zlib.inflateRawSync(pb.bytes).toString('utf8'));
  if (pb.header !== 'k:' + pjson.length || Object.keys(pback.l).length !== doc.links.length || Object.values(pback.l).some(e => Object.keys(e).join() !== 'p'))
    throw new Error('media/links.bin did not read back');
  console.log('wrote media/links.bin: ' + doc.links.length + ' figures for everyone, no reasons (commit it)');
}

function find(doc, card) {
  const r = doc.links.find(x => x.child === card);
  if (!r) { console.error('no link above ' + card + ' (give the CHILD card id, e.g. c009)'); process.exit(1); }
  return r;
}
function line(r) {
  const o = r.override ? '  OVERRIDE ' + r.override.pct + '% (' + r.override.date + '): ' + r.override.note : '';
  return r.parent + ' -> ' + r.child + '  ' + shown(r) + '%  (records: ' + r.pct + '%, ' + r.level + ', ' + r.basis + ')' + o;
}

const [cmd, ...args] = process.argv.slice(2);
const doc = load();
if (cmd === 'check') {
  const errs = check(doc);
  if (errs.length) { console.error(errs.length + ' problem(s):\n  ' + errs.join('\n  ')); process.exit(1); }
  console.log('ok: ' + doc.links.length + ' links, ' + doc.links.filter(r => r.override).length + ' with an override');
} else if (cmd === 'show') {
  const r = find(doc, args[0]);
  console.log(line(r) + '\n  ' + r.child_name + ' (' + r.child_years + '), under ' + r.parent_name + '\n  why: ' + r.why);
} else if (cmd === 'list') {
  const want = args[0];
  doc.links.filter(r => !want || level(shown(r)) === want).sort((a, b) => shown(a) - shown(b) || a.n - b.n)
    .forEach(r => console.log(line(r) + '  ' + r.child_name));
} else if (cmd === 'override') {
  const r = find(doc, args[0]);
  if (args[1] === 'clear') { delete r.override; save(doc); console.log('override cleared: ' + line(r)); build(doc); }
  else {
    const pct = Number(args[1]), note = (args[2] || '').trim();
    const di = args.indexOf('--date'), date = di >= 0 ? args[di + 1] : today();
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) { console.error('the figure must be a whole number from 0 to 100'); process.exit(1); }
    if (!note) { console.error('give his note (his words, or what he based it on)'); process.exit(1); }
    r.override = { pct, note, date, by: 'Cory' };
    save(doc);
    console.log('override set: ' + line(r) + '\n  now add an owner entry to ledger/register.jsonl in his words');
    build(doc);
  }
} else if (cmd === 'build') {
  build(doc);
} else if (cmd === 'link') {
  const k = ownerKey(true);
  console.log('open once on each of Cory\'s devices (it is a key: share it with no one):\n  ' + siteUrl() + '#owner=' + b64u(k));
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).join('\n'));
  process.exit(cmd ? 1 : 0);
}
