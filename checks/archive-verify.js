'use strict';
// Does the archive actually hold the RECORD, or just a page the server was willing to send?
//
//   node checks/archive-verify.js            # summary + every failure, worst first
//   node checks/archive-verify.js --json out.json
//
// WHY THIS EXISTS
// archive-status.js answers "did the fetch succeed?" by reading one field: state[id].ok, which is
// set when the server answered 200. That is not the question. A server returns 200 for a cookie
// wall, a login page, a soft 404, a bot-block, and — the one that actually bit this archive — a
// JavaScript viewer shell with no scan inside it. On 9 August 2026 the archive reported 208/208
// held. Twelve of those files were byte-for-byte identical 1,333-byte React shells from
// archives68.alsace.eu reading "You need to enable JavaScript to run this app"; four were the
// matchID app shell; one was an Incapsula bot-block from geni.com; one was zero bytes.
//
// So this file asks the only question that matters on the day a source goes dark:
//   if I open the copy we kept, can I still read the thing the card cites?
//
// Three verdicts, and the distinction between them is the whole point:
//   RECORD      the stored bytes contain the record — a marker proves it
//   TRANSCRIPT  we hold someone's reading of the page, not the page (archive/hand/*.txt)
//   SHELL       we hold a wall, a viewer frame, a bot-block or an empty file. This is not a hold.
//
// A SHELL counted as a hold is worse than a known gap: it reports safety that is not there.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const mfPath = path.join(ROOT, 'sources', 'MANIFEST.json');
const tsvPath = path.join(ROOT, 'sources', 'urls.tsv');
const stPath = path.join(ROOT, 'archive', 'store', 'state.json');
const storeDir = path.join(ROOT, 'archive', 'store');
const handDir = path.join(ROOT, 'archive', 'hand');

let manifest;
if (fs.existsSync(mfPath)) manifest = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
else if (fs.existsSync(tsvPath)) {
  const crypto = require('crypto');
  manifest = { entries: fs.readFileSync(tsvPath, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => {
    const [risk, dependents, kind, url] = l.split('\t');
    return { id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 12), url, risk, kind,
             dependents: Number(dependents) || 0, cards: [] };
  }) };
} else { console.error('no sources/MANIFEST.json and no sources/urls.tsv'); process.exit(1); }
const state = fs.existsSync(stPath) ? JSON.parse(fs.readFileSync(stPath, 'utf8')) : {};

// ---------------------------------------------------------------- what a wall looks like
// Every one of these was observed in this archive, not imagined. Keep the comment with the
// pattern: a future reader needs to know these are field observations, not guesses.
const WALL = [
  [/You need to enable JavaScript to run this app/i, 'empty JS app shell'],       // archives68, 12 files
  [/Request unsuccessful\. Incapsula incident/i,     'Incapsula bot-block'],      // geni.com
  [/Please enable (?:JS|JavaScript) and disable any ad ?blocker/i, 'bot-block'],
  [/<title>\s*(?:Just a moment|Attention Required)/i, 'Cloudflare interstitial'],
  [/Access Denied: error code/i,                     'Anubis anti-bot denial'],  // archives67 seen live
  [/\bg-recaptcha\b|\bhcaptcha\b|Je ne suis pas un robot/i, 'captcha challenge'],
  [/Sign in to (?:view|continue)|Log in to (?:view|continue)/i, 'login wall'],
  [/Create a free account to (?:view|continue)/i,    'registration wall'],
  [/Subscribe to (?:read|continue)/i,                'paywall'],
  [/Whoops! We can'?t find what you'?re looking for/i, 'soft 404'],
  [/\bPage [Nn]ot [Ff]ound\b|<title>\s*404\b/i,      'soft 404'],
  [/Too [Mm]any [Rr]equests|Rate limit exceeded/i,   'rate limit'],
];

// The IIIF viewer frames (Ligeo/Monocle at archives67, the React app at archives68) are the
// subtle case: archives67's frame does carry the cote and date range in its <title>, so it is
// not worthless — it proves which register was cited. It still contains no scan. Treat the
// presence of a viewer bootstrap with no record text as a SHELL, and say which kind.
const VIEWER = [
  [/monoclePublicPath|Monocle\.iiif\(/,              'Ligeo/Monocle IIIF viewer frame'],
  [/<div id="root">\s*<\/div>/,                      'empty React root'],
  [/<div id="__next">\s*<\/div>/,                    'empty Next.js root'],
];

// ---------------------------------------------------------------- what the record looks like
// A marker is a string the real page must contain. Surnames first — nearly every source here is
// cited because it names one of these people. Then per-URL identifiers, so a register viewer that
// at least proves WHICH register is not scored the same as one that proves nothing.
/* Surnames are derived from the decrypted payload, never hardcoded: this file is
   public and is served by GitHub Pages, so a name list here is a name list online.
   Stems are cut to 6 characters so OCR variants still match, as the old list did. */
const SURNAMES = (() => {
  let stems = [];
  try {
    const L = require('./lib.js');
    const { people } = L.load();
    const set = new Set();
    Object.values(people || {}).forEach(p => {
      String((p && p.name) || '').split(/\s+/).forEach(t => {
        const w = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '');
        if (w.length >= 5) set.add(w.slice(0, 6).toLowerCase());
      });
    });
    stems = [...set];
  } catch (e) {
    console.error('SURNAMES: payload unavailable (' + e.message + ') — marker test degraded');
  }
  return stems.length ? new RegExp(stems.join('|'), 'i') : /$^/;
})();

function urlMarkers(url) {
  const out = [];
  let m;
  if ((m = url.match(/ark:\/\d+\/([a-z0-9]+)/i))) out.push(m[1]);       // archives6x, familysearch
  if ((m = url.match(/memorial\/(\d+)/)))          out.push(m[1]);       // findagrave
  if ((m = url.match(/[?&]p=([^&]+)/)))            out.push(decodeURIComponent(m[1]).replace(/\+/g, ' '));
  if ((m = url.match(/[?&]n=([^&]+)/)))            out.push(decodeURIComponent(m[1]).replace(/\+/g, ' '));
  if ((m = url.match(/\/(\d{8})[.\-]/)))           out.push(m[1]);       // issue dates
  return out.filter(s => s && s.length >= 4);
}

function classify(entry) {
  const s = state[entry.id] || {};
  const r = { id: entry.id, url: entry.url, risk: entry.risk, dependents: entry.dependents,
              cards: entry.cards || [], host: s.host || '', bytes: s.bytes, verdict: null, why: '' };

  // 1. a hand transcription, if there is one
  const hand = path.join(handDir, entry.id + '.txt');
  const hasHand = fs.existsSync(hand);

  // 2. the automatic capture, if there is one
  let body = null;
  if (s.ok && s.file) {
    const f = path.join(storeDir, s.file);
    if (fs.existsSync(f)) body = fs.readFileSync(f, 'utf8');
    else {
      // Run this in the archive repo, where store/ actually lives. In the working copy the
      // stored bytes are not present and there is nothing to verify — that is not a defect,
      // it is the wrong working directory, and saying so beats reporting a false failure.
      r.verdict = 'UNREAD-HERE'; r.why = 'stored copy not in this checkout: archive/store/' + s.file; return r;
    }
  }

  if (body !== null) {
    if (!body.trim()) { r.verdict = 'SHELL'; r.why = 'stored file is empty (0 bytes)'; }
    else {
      const wall = WALL.find(([re]) => re.test(body));
      const text = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
      const marks = urlMarkers(entry.url);
      const hasRecord = SURNAMES.test(text) || marks.some(mk => body.includes(mk));
      if (wall && !hasRecord) { r.verdict = 'SHELL'; r.why = wall[1]; }
      else if (!hasRecord) {
        const v = VIEWER.find(([re]) => re.test(body));
        r.verdict = 'SHELL';
        r.why = v ? v[1] + ', no record text' : 'no marker for this record anywhere in the stored bytes';
      } else {
        r.verdict = 'RECORD';
        r.why = SURNAMES.test(text) ? 'a cited surname is in the stored text' : 'the record identifier is in the stored bytes';
      }
    }
    // a shell with a transcription beside it is still only a transcription
    if (r.verdict === 'SHELL' && hasHand) { r.verdict = 'TRANSCRIPT'; r.why = 'auto-capture is a ' + r.why + '; a hand transcription stands in its place'; }
    return r;
  }

  if (hasHand) {
    const t = fs.readFileSync(hand, 'utf8');
    const declared = (t.match(/^#\s*url:\s*(\S+)/m) || [])[1];
    if (declared && declared !== entry.url) { r.verdict = 'MISMATCH'; r.why = 'the transcription is of a different URL: ' + declared; return r; }
    const bodyText = t.split('\n').filter(l => !l.startsWith('#')).join('\n').trim();
    if (bodyText.length < 120) { r.verdict = 'SHELL'; r.why = 'transcription has almost no content (' + bodyText.length + ' chars)'; return r; }
    r.verdict = 'TRANSCRIPT';
    r.why = SURNAMES.test(bodyText) ? 'hand transcription, a cited surname present'
                                    : 'hand transcription, no surname — check it is a record page and not a search form';
    return r;
  }

  r.verdict = 'NONE';
  r.why = s.result ? 'never captured (' + s.result + ')' : 'never captured';
  return r;
}

const rows = manifest.entries.map(classify);
const by = v => rows.filter(r => r.verdict === v);
const cardsOf = list => new Set(list.flatMap(r => r.cards));

console.log('ARCHIVE CONTENT VERIFICATION');
console.log('  the question is not "did the fetch succeed" but "can we still read the record"');
console.log('');
for (const v of ['RECORD', 'TRANSCRIPT', 'SHELL', 'MISMATCH', 'UNREAD-HERE', 'NONE']) {
  const g = by(v);
  if (g.length) console.log(`  ${v.padEnd(11)} ${String(g.length).padStart(3)}   ${cardsOf(g).size} cards`);
}
console.log('');
const bad = rows.filter(r => ['SHELL', 'MISMATCH', 'NONE'].includes(r.verdict))
                .sort((a, b) => b.dependents - a.dependents);
if (bad.length) {
  console.log(`NOT ACTUALLY HELD — ${bad.length}, worst first by how many cards depend on them:`);
  for (const r of bad) console.log(`  ${String(r.dependents).padStart(3)} cards  ${r.risk.padEnd(6)} ${r.verdict.padEnd(9)} ${r.why.slice(0, 46).padEnd(46)} ${r.url.slice(0, 70)}`);
}
const t = by('TRANSCRIPT');
if (t.length) {
  console.log('');
  console.log(`HELD ONLY AS A TRANSCRIPTION — ${t.length}. These are honest readings, but no image and`);
  console.log('no bytes: if the source dies, the transcription cannot be checked against anything.');
}
const outIdx = process.argv.indexOf('--json');
if (outIdx > -1) fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(rows, null, 1));
const fatal = by('SHELL').length + by('MISMATCH').length + by('NONE').length;
process.exitCode = fatal ? 1 : 0;
