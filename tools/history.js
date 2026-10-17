#!/usr/bin/env node
'use strict';
/*
 * history — the history notes on Play's timeline (Cory, 17 Oct 2026: "markers for historical events on the
 * timeline … do it!").
 *
 *   node tools/history.js validate     checks history.json
 *   node tools/history.js build        checks it, then writes media/history.bin (commit it: it is ciphertext)
 *   node tools/history.js list         the notes, one a line
 *
 * history.json (private, at the root, like research.json) is the master: each note is the general history of a
 * place, never of a person, with the page it was read on and the words on that page that support it. The site
 * gets only what it shows — the years, the two captions, the page's title and address — sealed under the payload
 * key as one file in media/, the way media/links.bin is (tools/linkconf.js), so the notes stay behind the
 * password. index.html fetches it the first time Play is opened (HISTFILE). The demo build has no notes.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('./payload.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'history.json');
const OUT = path.join(ROOT, P.MEDIA_DIR, 'history.bin');

function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  try { return fs.readFileSync(path.join(ROOT, '.password'), 'utf8').trim(); } catch (_) { return null; }
}
/* every check a machine can make; a person still reads every caption against its quote */
function validate(doc) {
  const errors = [];
  const notes = doc && Array.isArray(doc.notes) ? doc.notes : null;
  if (!notes) return ['history.json needs a "notes" list'];
  const seen = new Set();
  notes.forEach((n, i) => {
    const at = 'note ' + (i + 1) + (n && n.y ? ' (' + n.y + ')' : '') + ': ';
    if (!n || typeof n !== 'object') { errors.push(at + 'not an object'); return; }
    if (!Number.isInteger(n.y) || n.y < 1000 || n.y > 2100) errors.push(at + 'y must be a year');
    if (n.y2 !== null && n.y2 !== undefined && (!Number.isInteger(n.y2) || n.y2 < n.y)) errors.push(at + 'y2 must be a year not before y, or null');
    ['en', 'fr', 'src', 'url', 'quote'].forEach(k => { if (typeof n[k] !== 'string' || !n[k].trim()) errors.push(at + k + ' is missing'); });
    if (typeof n.en === 'string' && n.en.length > 110) errors.push(at + 'the English caption is over 110 characters');
    if (typeof n.fr === 'string' && n.fr.length > 130) errors.push(at + 'the French caption is over 130 characters');
    if (typeof n.url === 'string' && !/^https:\/\/[^\s]+$/.test(n.url)) errors.push(at + 'url must be an https address');
    if (!/^(en|fr|de)$/.test(n.lang || '')) errors.push(at + 'lang (of the quote) must be en, fr or de');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.opened || '')) errors.push(at + 'opened must be the date the page was read');
    /* the same years in both captions */
    const yrs = s => (String(s).match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) || []).sort().join();
    if (typeof n.en === 'string' && typeof n.fr === 'string' && yrs(n.en) !== yrs(n.fr)) errors.push(at + 'the English and French captions give different years');
    const key = n.y + '|' + n.en;
    if (seen.has(key)) errors.push(at + 'a duplicate');
    seen.add(key);
    if (i && notes[i - 1] && n.y < notes[i - 1].y) errors.push(at + 'out of order (sort by y)');
  });
  return errors;
}
function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
function build() {
  const doc = load(), errors = validate(doc);
  if (errors.length) { errors.forEach(e => console.error('  ' + e)); process.exit(1); }
  const pw = password();
  if (!pw) { console.error('no .password (or FT_PASSWORD): the notes are sealed under the payload key'); process.exit(1); }
  const enc = P.readEnc(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const shown = doc.notes.map(n => ({ y: n.y, y2: n.y2 || null, en: n.en, fr: n.fr, src: n.src, url: n.url }));
  const json = Buffer.from(JSON.stringify(shown), 'utf8');
  const key = P.keyFor(pw, enc.salt, enc.iter);
  /* seeded on the content: the same notes give the same bytes, so a rebuild with nothing new leaves git nothing to commit */
  const file = P.sealBlob(key, 'h:' + json.length, zlib.deflateRawSync(json, { level: 9 }), Buffer.concat([Buffer.from('history\0'), json])).file;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, file);
  const back = P.openBlob(key, fs.readFileSync(OUT));
  const notes = JSON.parse(zlib.inflateRawSync(back.bytes).toString('utf8'));
  if (back.header !== 'h:' + json.length || notes.length !== shown.length) throw new Error('media/history.bin did not read back');
  console.log('wrote media/history.bin: ' + notes.length + ' notes (commit it)');
}
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'validate') {
    const errors = validate(load());
    if (errors.length) { errors.forEach(e => console.error('  ' + e)); process.exit(1); }
    console.log('ok: ' + load().notes.length + ' notes');
  } else if (cmd === 'build') build();
  else if (cmd === 'list') load().notes.forEach(n => console.log(n.y + (n.y2 ? '–' + n.y2 : '') + '  ' + n.en));
  else { console.error('usage: node tools/history.js validate | build | list'); process.exit(2); }
}
module.exports = { validate };
