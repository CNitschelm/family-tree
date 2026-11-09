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
 *   node tools/linkconf.js sync                      keeps the figures current: retires links gone from the tree, rates new
 *                                                    ones from their cards' sources, builds when anything changed (below)
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
 *
 * sync (Cory, 9 Nov 2026: "Fix the percentage job and deploy the fix and calculate them"). build refuses
 * unless every link on the tree has an entry, and nothing ran it by itself, so from 7 Oct 2026 the cards
 * the decision runner added under R-0437 had no figure and the tree's figures froze for a month (card lc1,
 * R-0717, put it right by hand). tools/cloud-finish.sh now runs sync at every finish. sync reads the tree from
 * the page itself (index.html and media/, what visitors see), not from data.json, then:
 *   1. an entry whose link is no longer on the tree (the card left it, or now hangs under another parent)
 *      moves to the top-level `retired` list, kept whole, with `retired` (the date) and `retiredWhy`;
 *   2. a link with no entry is rated from the child card's own source labels, on the file's scale_pct:
 *      an act read in the original ("original register", "original ... civil register") 99, basis original;
 *      the SaiRePa or Baradel transcription with an act number 95, basis index. The entry carries
 *      `auto: true` and a `why` made from that label (no addresses, no "(this link is ...)" aside);
 *      anything else stays unrated and is listed, and sync exits 1 without building (build stays strict);
 *   3. when everything is rated, it builds, unless nothing changed: owner.bin gets a random iv at every
 *      build, so sync compares a hash of the ledger and the tree's links with the one stored at the last
 *      build (ledger/link-confidence.stamp), and before rebuilding it opens the two files in media/: when they
 *      already hold exactly these figures it writes the stamp and leaves them alone.
 * It never makes an owner key: without .owner-key it stops (exit 2) and cloud-finish.sh skips it with a note.
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
const STAMP = path.join(ROOT, 'ledger', 'link-confidence.stamp');

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

/* the tree's parent-child pairs (child id -> parent id), from data.json, or from the data the page carries */
function pairsOf(data, nodes) {
  const out = new Map();
  (function walk(p) {
    if (nodes) nodes.set(p.id, p);
    (p.unions || []).forEach(u => (u.c || []).forEach(c => { out.set(c.id, p.id); walk(c); }));
  })(data);
  return out;
}
function pairs() { return pairsOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'))); }
/* the tree as the page draws it: the payload in index.html with its bios, notes and sources from media/ */
function pageTree(pw) {
  const enc = P.readEnc(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const nodes = new Map();
  const pairs = pairsOf(P.openEnc(enc, pw, P.mediaFromDir(ROOT), { stage: 'refs' }), nodes);
  return { enc, pairs, nodes };
}

function check(doc, given) {
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
  let tree = given || null;
  if (!tree) try { tree = pairs(); } catch (_) { console.log('note: no data.json here, so the entries were not checked against the tree'); }
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

/* what build writes: the owner view's figures (l) and everyone's (pl) */
function figures(doc) {
  const l = {}, pl = {};
  doc.links.forEach(r => {
    const e = { p: shown(r), e: r.pct, w: r.why };
    if (r.override) e.o = r.override.note;
    l[r.child] = e;
    pl[r.child] = { p: shown(r) };
  });
  return { l, pl };
}
/* what media/ holds now, or null when a file is missing or does not open with these keys */
function onDisk(pw, key, enc) {
  try {
    const pkey = P.keyFor(pw, enc.salt, enc.iter);
    const outer = P.openBlob(pkey, fs.readFileSync(OUT));
    const pt = P.gcmOpen(key, outer.bytes.subarray(0, 12), outer.bytes.subarray(12));
    const l = JSON.parse(zlib.inflateRawSync(pt.subarray(1 + pt[0])).toString('utf8')).l;
    const pb = P.openBlob(pkey, fs.readFileSync(PUB));
    const pl = JSON.parse(zlib.inflateRawSync(pb.bytes).toString('utf8')).l;
    return { l, pl };
  } catch (_) { return null; }
}
/* the hash of what the figures are built from: the ledger, the tree's links and the payload key's salt */
function stampOf(doc, tree, enc) {
  const links = [...tree].map(([c, p]) => p + '>' + c).sort().join('\n');
  return crypto.createHash('sha256').update('linkconf 1\n' + enc.salt + ':' + enc.iter + '\n' + JSON.stringify(doc) + '\n' + links).digest('hex');
}
function readStamp() { try { return fs.readFileSync(STAMP, 'utf8').split(/\s+/)[0]; } catch (_) { return null; } }
function writeStamp(doc, tree, enc) { fs.writeFileSync(STAMP, stampOf(doc, tree, enc) + ' ' + today() + '\n'); }

function build(doc, opts = {}) {
  const errs = check(doc, opts.tree);
  if (errs.length) { console.error('link-confidence.json does not check:\n  ' + errs.join('\n  ')); process.exit(1); }
  const pw = password();
  if (!pw) { console.error('no password: set FT_PASSWORD or create .password'); process.exit(1); }
  const key = ownerKey(!opts.noNewKey);
  if (!key) { console.error('no .owner-key: not built (a new key would cut off every one of his devices)'); process.exit(2); }
  const { l, pl } = figures(doc);
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
  const pjson = Buffer.from(JSON.stringify({ v: 1, l: pl }), 'utf8');
  const pkey = P.keyFor(pw, enc.salt, enc.iter);
  const pfile = P.sealBlob(pkey, 'k:' + pjson.length, zlib.deflateRawSync(pjson, { level: 9 }), Buffer.concat([Buffer.from('links\0'), pjson])).file;
  fs.writeFileSync(PUB, pfile);
  const pb = P.openBlob(pkey, fs.readFileSync(PUB));
  const pback = JSON.parse(zlib.inflateRawSync(pb.bytes).toString('utf8'));
  if (pb.header !== 'k:' + pjson.length || Object.keys(pback.l).length !== doc.links.length || Object.values(pback.l).some(e => Object.keys(e).join() !== 'p'))
    throw new Error('media/links.bin did not read back');
  console.log('wrote media/links.bin: ' + doc.links.length + ' figures for everyone, no reasons (commit it)');
  try { require('./stats.js').write(true); } catch (e) { console.log('note: stats.json not updated: ' + e.message); }
  let tree = opts.tree || null;
  if (!tree) try { tree = pairs(); } catch (_) { /* no data.json: no stamp, so the next sync looks again */ }
  if (tree) writeStamp(doc, tree, enc);
}

/* ---------------- sync: the figures keep themselves current (9 Nov 2026; see the header) */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = d => +d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
/* a source label as a reason: no addresses, no "(this link is the image of view …)" aside */
const cleanLabel = l => String(l || '').replace(/\s*\(this link is [^()]*\)/gi, '').replace(/\s*<?https?:\/\/[^\s)>]+>?/g, '')
  .replace(/\s{2,}/g, ' ').replace(/[\s,;:.\u2013\u2014-]+$/, '').trim();
const ORIGINAL = l => /\boriginal register\b/i.test(l) || /\boriginal\b[^.;:()]{0,80}?\bcivil register\b/i.test(l);
const ACT_NO = l => /\b(?:sairepa|baradel)\b/i.test(l) &&
  /\bactes?\s+n(?:\u00b0|o\.?)\s*\d|\bact\s+(?:n(?:\u00b0|o\.?)|number)\s*\d|\bwith act numbers?\b|\b(?:bapt|baptism|marr|marriage|m|death|burial)\.?\s*n\u00b0\s*\d/i.test(l);
/* the rating a card's own sources give the link above it, or null */
function rateFromSources(card, day) {
  const labels = (card.src || []).map(s => cleanLabel(s.l)).filter(Boolean);
  const when = ' Rated automatically from this card\'s source on ' + longDate(day) + '.';
  let l = labels.find(ORIGINAL);
  if (l) return { pct: 99, basis: 'original', why: l + '. Read in the original: the act names the parent.' + when };
  l = labels.find(ACT_NO);
  if (l) return { pct: 95, basis: 'index', why: l + ': the transcription with act number names the parent. Not read in the original.' + when };
  return null;
}

function sync(doc) {
  const pw = password();
  if (!pw) { console.error('no password: set FT_PASSWORD or create .password'); process.exit(2); }
  const key = ownerKey(false);
  if (!key) { console.error('no .owner-key: sync never makes one (a new key would cut off every one of his devices). Set FT_OWNER_KEY and run tools/cloud-setup.sh'); process.exit(2); }
  const { enc, pairs: tree, nodes } = pageTree(pw);
  if (readStamp() === stampOf(doc, tree, enc)) { console.log('linkconf: the figures are current (nothing changed since the last build)'); return; }
  const day = today(), D = longDate(day);
  /* 1. links no longer on the tree */
  const keep = [], gone = [];
  doc.links.forEach(r => (tree.get(r.child) === r.parent ? keep : gone).push(r));
  gone.forEach(r => {
    const now = tree.get(r.child);
    r.retired = day;
    r.retiredWhy = now
      ? 'On ' + D + ' the tree has this card under ' + now + ', not under ' + r.parent + ', so this link is no longer on it; the link above the card is rated anew. Kept here for the record.'
      : 'On ' + D + ' this card is no longer on the tree, so the tree has no line to show this figure on. Kept here for the record.';
    console.log('retired: ' + r.parent + ' -> ' + r.child + (now ? ' (now under ' + now + ')' : ' (no longer on the tree)') +
      (r.override ? '  NOTE: it carried his override (' + r.override.pct + '%), retired with it' : ''));
  });
  if (gone.length) { doc.links = keep; doc.retired = (doc.retired || []).concat(gone); }
  /* 2. links with no entry */
  const rated = new Set(doc.links.map(r => r.child));
  let n = Math.max(0, ...doc.links.map(r => r.n || 0), ...(doc.retired || []).map(r => r.n || 0));
  const added = [], unrated = [];
  tree.forEach((par, ch) => {
    if (rated.has(ch)) return;
    const c = nodes.get(ch), p = nodes.get(par), x = rateFromSources(c, day);
    if (!x) { unrated.push(ch); return; }
    const r = { n: ++n, parent: par, parent_name: p.name, parent_years: p.years || '', child: ch, child_name: c.name, child_years: c.years || '',
      kind: (p.g === 'f' ? 'mother' : 'father') + '-' + (c.g === 'f' ? 'daughter' : 'son'),
      level: level(x.pct), basis: x.basis, why: x.why, checked: day, pct: x.pct, auto: true };
    doc.links.push(r); added.push(r);
    console.log('rated: ' + par + ' -> ' + ch + '  ' + x.pct + '% (' + x.basis + ', from its source)');
  });
  if (gone.length || added.length) save(doc);
  if (unrated.length) {
    console.error(unrated.length + (unrated.length === 1 ? ' line has' : ' lines have') + ' no figure: ' + unrated.join(' '));
    unrated.forEach(ch => console.error('  ' + tree.get(ch) + ' -> ' + ch + ': its sources give no act read in the original and no SaiRePa or Baradel act number'));
    console.error('  Rate each by hand in ledger/link-confidence.json (its scale_pct; notes/link_confidence.md), then run sync again.' +
      (gone.length || added.length ? ' The ' + (gone.length + added.length) + ' change(s) above are saved.' : ''));
    process.exit(1);
  }
  /* 3. build, unless media/ already holds exactly these figures */
  const want = figures(doc), have = onDisk(pw, key, enc);
  if (have && JSON.stringify(have.l) === JSON.stringify(want.l) && JSON.stringify(have.pl) === JSON.stringify(want.pl)) {
    writeStamp(doc, tree, enc);
    console.log('linkconf: media/ already holds these ' + doc.links.length + ' figures: nothing rebuilt (stamp written)');
    return;
  }
  build(doc, { tree, noNewKey: true });
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
} else if (cmd === 'sync') {
  try { sync(doc); } catch (e) { console.error('linkconf sync failed: ' + e.message); process.exit(2); }
} else if (cmd === 'link') {
  const k = ownerKey(true);
  console.log('open once on each of Cory\'s devices (it is a key: share it with no one):\n  ' + siteUrl() + '#owner=' + b64u(k));
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 16).join('\n'));
  process.exit(cmd ? 1 : 0);
}
