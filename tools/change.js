#!/usr/bin/env node
'use strict';
/*
 * change — the only way an edit gets into data.json.  (OPERATING.md, "The loop")
 *
 *   node tools/change.js <changes.json> [--dry]
 *
 * It writes only while this session holds the writer lock (ledger/LOCK names FT_WHO; take it with
 * bash tools/cloud-lock.sh take "<who>" "<what>"), and never in a read-only session (FT_READONLY=1).
 * --dry checks a file and writes nothing: it needs no lock, and runs while another session holds it.
 *
 * A change file says what to change, what kind of change it is, and on what evidence.
 * This tool applies it only if:
 *   - every edit finds exactly the text it says it replaces (no blind overwrites);
 *   - a change of FACT or GRADE quotes a source we hold a copy of, and the quote is
 *     really in that copy — or names words the source lacks, and they really are
 *     absent from it (a "no record gives X" claim is checked, not believed);
 *   - a WORDING or TRANSLATION edit changes no year, number or name;
 *   - English and French still carry the same years;
 *   - an edit on a question the register has settled cites that entry — and says
 *     whether it keeps to the ruling or reopens it with evidence the ruling did not have;
 *   - an edit that brings back something an earlier change took out says so (`reverts`).
 * Then it writes data.json and appends the change, with every before and after, to
 * ledger/changes.jsonl. checks/gate.js later proves the payload is exactly what the
 * ledger says it is.
 *
 * The change file:
 * {
 *   "why": "one line — what this does and why",
 *   "edits": [
 *     { "card": "c042", "field": "bio[0]", "find": "…", "replace": "…",
 *       "kind": "fact", "evidence": [{ "src": "https://…", "quote": "…", "opened": "2026-09-24" }] },
 *     { "card": "c042", "field": "pl[t=arrival,k=town].c", "from": "inf", "to": "doc",
 *       "kind": "grade", "evidence": [{ "src": "https://…", "quote": "…", "opened": "…" }] },
 *     { "card": "c042", "field": "bio_fr[0]", "find": "…", "replace": "…", "kind": "translation" },
 *     { "card": "c042", "op": "add", "list": "src", "item": { "l": "…", "u": "https://…" }, "kind": "source" },
 *     { "card": "c042", "op": "remove", "list": "pl", "at": "t=residence,k=chenoa", "kind": "fact", "evidence": [ … ] },
 *     { "op": "addCard", "parent": "c042", "union": 0, "at": 1, "item": { "name": "…", "years": "…", … },
 *       "kind": "structure", "register": "R-…", "evidence": [ … ] }
 *                a new card needs Cory's decision (R-0437 for a child of a man of the line, else an owner entry
 *                that names the parent) and evidence, like any fact; "at" = its place among the siblings
 *   ]
 * }
 * and, since 3 Oct 2026, what it does to the Research view's data (CLAUDE.md, "Research"):
 *   "research": "i3 s9a"            the research items this change moves (investigation, source or visit ids)
 *   "research": "none: <why>"       or why it moves none
 * kind: fact | grade | source | wording | translation | structure | owner. Each kind has its own fields (R-0760):
 *   source      src[…] and sources[…] only: labels, addresses (in the archive, like a new source), quotes,
 *               a source added or removed
 *   structure   a card added or removed, a gazetteer entry (gaz.<key>), an exact duplicate removed ("dup_of": its index)
 *   wording, translation   never a name, a spouse's name, a pin's place, the person's sex or years
 *   owner       cites a live entry of Cory's that names the card
 *   A new pin, marriage or paragraph is a fact and needs evidence, whatever it is called.
 * evidence item: { src, quote } | { src, absent: ["word", …] } | { src, read: "image"|"pdf"|"original", transcription }
 *                and always "opened": the date the source was actually opened.
 *                "read" says what was read: "image", "pdf" or "original" for a picture of the record, "text" or
 *                "index entry" for words on a page. Any other word is taken as a picture, with a warning.
 *                A source read from an image (a register page, a film image, a newspaper page) needs the image
 *                on file in the archive, not only our typed reading (R-0755); so does a "read" of a copy that
 *                has no words in it. Where the image cannot be had now, the item says
 *                "no_image": "<why, and what will fetch it>" and the ledger marks the edit image_missing.
 * optional per edit: "register": "R-0042", "effect": "consistent"|"reopen", "reverts": "why this comes back",
 *                    "fr": "exempt: <why the French differs>", "note": "…"
 * Every warning printed here is kept on the edit's record in the ledger ("warnings"), and the gate prints
 * them again before a commit: a warning never refuses, so it must not be lost either.
 */
const fs = require('fs');
const path = require('path');
const L = require('./ledger.js');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--who');
const dry = args.includes('--dry');
// The name that counts is FT_WHO: cloud-lock.sh sets it when it takes the lock. --who is kept for a
// dry run on a machine that has no lock; it cannot stand in for the holder when writing (below).
const who = process.env.FT_WHO || (args.includes('--who') ? args[args.indexOf('--who') + 1] : 'session');
if (!file) { console.error('usage: node tools/change.js <changes.json> [--dry]'); process.exit(2); }

const errors = [], warnings = [], fileWarnings = [];
// what an edit's ledger record keeps besides the edit itself: its warnings (R-0760: until 16 Nov 2026
// they scrolled past and were gone) and the images it rests on that are not on file
const kept = [];
const keep = i => (kept[i] = kept[i] || { noImage: [], warnings: [] });
const err = (i, m) => errors.push(`edit ${i + 1}: ${m}`);
const warn = (i, m) => { warnings.push(`edit ${i + 1}: ${m}`); keep(i).warnings.push(m); };
const fileWarn = m => { warnings.push(m); fileWarnings.push(m); };

let cs;
try { cs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
if (!cs.why || typeof cs.why !== 'string') errors.push('the change file needs "why": one line saying what it does and why');
if (!Array.isArray(cs.edits) || !cs.edits.length) errors.push('the change file needs "edits": [ … ]');
/* Cory, 2 Oct 2026: the Research view is kept current without being asked. So every change says which
   research items it moves — and research.json must show them by the time the gate runs — or why none. */
if (typeof cs.research !== 'string' || !cs.research.trim()) {
  errors.push('the change file needs "research": the research ids it moves ("i3 s9a"), or "none: <why>". Update research.json first: node tools/research.js log|set …');
} else if (/^none\s*:/i.test(cs.research)) {
  if (cs.research.replace(/^none\s*:/i, '').trim().length < 8) errors.push('"research": "none: <why>" needs a reason of a few words');
} else if (!/^[a-z][a-z0-9-]*(?:[\s,;]+[a-z][a-z0-9-]*)*$/i.test(cs.research.trim())) {
  errors.push('"research" must list research ids ("i3 s9a") or say "none: <why>"');
} else {
  let RJ = null, R = null;
  try { RJ = require('./research.js'); R = RJ.load(); } catch (_) {}
  if (R) {
    const unknown = cs.research.split(/[\s,;]+/).filter(Boolean).filter(id => !RJ.find(R, id));
    if (unknown.length) errors.push('"research" names ' + unknown.join(', ') + ', which research.json does not have');
  } else fileWarn('research.json is not here, so the research ids were not checked (the gate will check them)');
}

// Writing needs the lock in hand, not merely nobody else's (R-0760). Until 16 Nov 2026 a change applied
// while the lock was free, and a read-only session could write: two sessions could each build a payload
// on the other's stale copy. FT_WHO is set by cloud-lock.sh take, in ~/.ft-env.
// A dry run writes nothing, so it asks for no lock: a read-only session, or one waiting for the lock,
// checks its file with it. It only says who holds the lock, so nobody takes "would apply" for "applied".
{
  const refuse = m => { console.error('REFUSED: ' + m); process.exit(1); };
  const lock = L.lockState(), me = process.env.FT_WHO;
  const take = 'bash tools/cloud-lock.sh take "<who>" "<what you are doing>"';
  if (dry) {
    if (lock && !lock.stale && lock.who !== me)
      console.log(`  note  the writer lock is held by "${lock.who}" since ${lock.since}${lock.what ? ' (' + lock.what + ')' : ''}. This dry run only reads; the file can be applied once that session has released the lock and this one has taken it.`);
  } else {
    if (process.env.FT_READONLY === '1') refuse('this session is read-only (FT_READONLY=1), so it may not change data.json. ' +
      'Check the file here with --dry, and apply it in a session set up for writing (bash tools/cloud-setup.sh without FT_READONLY).');
    if (!lock) refuse(`the writer lock is free, and a change is written only by the session that holds it. Take it first:\n    ${take}\n  then run this again (or check the file now with --dry).`);
    if (lock.stale) refuse(`the writer lock ran out (taken by "${lock.who}" at ${lock.since}, over 12 hours ago). Take it again:\n    ${take}\n  then run this again.`);
    if (!me) refuse(`ledger/LOCK is held by "${lock.who}", but this shell has no FT_WHO, so it cannot tell that it is that session. ` +
      `If you took the lock, start the command with:  . ~/.ft-env &&   Otherwise take it:\n    ${take}`);
    if (lock.who !== me) refuse(`ledger/LOCK is held by "${lock.who}" since ${lock.since}${lock.what ? ' (' + lock.what + ')' : ''}, and this session is "${me}". Another session is editing: wait for it ` +
      `(the file can be checked meanwhile with --dry), then take the lock:\n    ${take}\n  If that session is gone, add --steal to that command.`);
  }
}

// data.json must be exactly the payload in index.html, or that payload plus change sets the
// ledger recorded. Anything else is a hand edit or a stale copy — the 4 Aug 2026 failure, when a
// commit built from an old working copy silently undid a week of findings.
const data = L.loadData();
const beforeHash = L.hashData(data);
{
  let shippedHash = null;
  try { shippedHash = L.hashData(L.decryptEnc(L.readEnc(fs.readFileSync(path.join(L.ROOT, 'index.html'), 'utf8')))); }
  catch (e) { console.error('REFUSED: cannot read the payload in index.html: ' + e.message); process.exit(1); }
  if (beforeHash !== shippedHash && !L.chain(L.loadChanges(), shippedHash, beforeHash)) {
    console.error('REFUSED: data.json is not the payload in index.html, and the ledger does not explain the difference.\n' +
      '  Something edited it outside tools/change.js, or it is a stale copy. Keep a backup of it, run\n' +
      '  node tools/crypt.js decrypt, and redo the work as change sets.');
    process.exit(1);
  }
}

const register = (() => { try { return L.loadRegister(); } catch (e) { errors.push(e.message); return []; } })();
const regById = new Map(register.map(r => [r.id, r]));
let hist = null;
const history = () => (hist = hist || L.history('origin/main', { quiet: false }));

const KINDS = new Set(['fact', 'grade', 'source', 'wording', 'translation', 'structure', 'owner']);
const LISTS = new Set(['src', 'pl', 'union', 'bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs', 'timeline']);
const textish = v => typeof v === 'string' && v.length > 0;
const tokDiff = (a, b) => {
  const A = L.years(a).concat(L.numbers(a)), B = L.years(b).concat(L.numbers(b));
  const out = new Set();
  const ca = {}, cb = {};
  A.forEach(t => (ca[t] = (ca[t] || 0) + 1)); B.forEach(t => (cb[t] = (cb[t] || 0) + 1));
  for (const t of new Set([...A, ...B])) if ((ca[t] || 0) !== (cb[t] || 0)) out.add(t);
  if (typeof a !== 'string' || typeof b !== 'string') { if (a !== b) { if (a != null) out.add(String(a)); if (b != null) out.add(String(b)); } }
  return [...out];
};

// ---- evidence: is what the edit leans on really in our copy of the source?
// The latest day it can be anywhere (UTC+14): "opened" is written in the writer's own day.
const LATEST_TODAY = new Date(Date.now() + 14 * 3600e3).toISOString().slice(0, 10);
const realDate = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) &&
  new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const SHORT_QUOTE = 8;
// What "read" may say. The first three are a picture of the record, and need that picture on file
// (checkImage). The last two are words on a page: a record a site shows as text, a line of an index.
// Until 16 Nov 2026 any other word ("scan", "photo", anything) passed as a reading and skipped the image
// rule; none had been used. It is now taken as a picture, with a warning that names these words.
const IMAGE_READS = ['image', 'pdf', 'original'], TEXT_READS = ['text', 'index entry'];
// "needed": true, or the words of the refusal where a plain "a fact change needs evidence" would not say
// what is missing. "newCard": the parent, when the evidence is for a card being added.
function checkEvidence(i, e, needed, newCard) {
  const ev = e.evidence || [];
  if (!ev.length) { if (needed) err(i, typeof needed === 'string' ? needed : `a ${e.kind} change needs "evidence" — the source you opened, and the words in it (quote) or the words it lacks (absent)`); return; }
  ev.forEach((x, j) => {
    const tag = `evidence ${j + 1}`;
    if (!x.src) return err(i, `${tag}: no "src"`);
    // The small things nothing checked before 16 Nov 2026 (R-0760): "opened": "never", "absent": [] and a
    // quote of one space all passed. None had been used; each is refused now, so none ever is.
    if (!x.opened) err(i, `${tag}: say when the source was opened ("opened": "YYYY-MM-DD") — an unopened source is not evidence`);
    else if (!realDate(x.opened)) err(i, `${tag}: "opened": ${JSON.stringify(x.opened)} is not a date — write the day the source was opened as "YYYY-MM-DD"`);
    else if (x.opened > LATEST_TODAY) err(i, `${tag}: "opened": "${x.opened}" is later than today — write the day the source was actually opened`);
    if (x.quote !== undefined && (typeof x.quote !== 'string' || !/[\p{L}\p{N}]/u.test(x.quote)))
      return err(i, `${tag}: "quote" has no letter or digit in it — quote the words of the source the edit rests on`);
    if (x.absent !== undefined && (!Array.isArray(x.absent) || !x.absent.length || x.absent.some(w => typeof w !== 'string' || !w.trim())))
      return err(i, `${tag}: "absent" must be a list of the words the source lacks, each a real word: "absent": ["arrived", "1907"]`);
    if (x.src === 'owner') {
      if (newCard) err(i, `${tag}: "src": "owner" does not prove a new card. Cory's word is the register entry the edit cites; the evidence is the record that shows this child of ${newCard}: its address or family: folder as "src", with its words`);
      else if (e.kind !== 'owner') err(i, `${tag}: "src": "owner" is only for kind "owner" (Cory's own instruction)`);
      if (!x.quote) err(i, `${tag}: quote Cory's instruction`);
      return;
    }
    if (!x.quote && !x.absent && !x.read) return err(i, `${tag}: give "quote" (words in the source), "absent" (words it lacks) or "read" (image/pdf/original, with "transcription")`);
    const a = L.archived(x.src);
    if (!a.held) return err(i, `${tag}: ${x.src} — ${a.why}. Archive it first (a hand copy in archive/hand/), then cite it.`);
    if (x.quote) {
      const q = L.quoteIn(x.src, x.quote);
      if (q.ok === false) err(i, `${tag}: the quote is not in our copy of ${x.src}: "${String(x.quote).slice(0, 90)}…"`);
      if (q.ok === null && !x.read) err(i, `${tag}: our copy of ${x.src} has no text layer (${a.files.map(f => path.basename(f)).join(', ')}); add "read": "image"|"pdf" and a "transcription"`);
    }
    if (x.absent) {
      if (!a.text) { if (!x.read) err(i, `${tag}: cannot check "absent" against a copy with no text — add "read" and say what you read`); }
      else for (const w of [].concat(x.absent)) if (L.normText(a.text).includes(L.normText(w)))
        err(i, `${tag}: you say ${x.src} lacks "${w}" — our copy of it contains "${w}". A negative claim has to survive opening the source.`);
    }
    if (x.read && !x.transcription && !x.quote) err(i, `${tag}: "read": "${x.read}" needs "transcription" — what the page says, in its words`);
    if (x.read && !IMAGE_READS.includes(x.read) && !TEXT_READS.includes(x.read))
      warn(i, `${tag}: "read": ${JSON.stringify(x.read)} is not a word this tool knows, so it was taken as read from an image. Say ${IMAGE_READS.map(w => `"${w}"`).join(', ')} (a picture of the record) or ${TEXT_READS.map(w => `"${w}"`).join(', ')} (words on a page).`);
    // "read": "text" with a transcription is our own account of a page whose words we hold: nothing checks
    // it, where a quote would be checked (94 such items before 16 Nov 2026, none word for word). Kept in view.
    if (TEXT_READS.includes(x.read) && x.transcription && !x.quote && a.text && !L.normText(a.text).includes(L.normText(x.transcription)))
      warn(i, `${tag}: the "transcription" is not in our copy of ${x.src} word for word, so nothing checked it. Next time give the page's own words as "quote": a quote is checked against the copy.`);
    checkImage(i, x, tag, a);
  });
  // a quote that proves only that the source was opened (the audit's "died"): kept as a warning
  const words = ev.filter(x => x.src !== 'owner').flatMap(x => [x.quote, x.transcription]).filter(w => typeof w === 'string' && w.trim());
  if (ev.some(x => x.src !== 'owner' && x.quote) && words.every(w => w.trim().length < SHORT_QUOTE))
    warn(i, `the only words quoted are ${words.map(w => JSON.stringify(w)).join(', ')}, under ${SHORT_QUOTE} characters: that shows the source was opened, not what it says. Next time quote the passage the edit rests on.`);
}
// ---- a year or number the evidence does not show (R-0760)
// The quote check proves a source was copied, not that it says what the edit says: of 102 real edits that
// swapped a year, 19 had the new year in none of their quoted text. It cannot be a refusal (an act writes
// its years in words, an age is worked out), so it is a warning, and warnings are kept.
// What a card says about its sources (labels, addresses, document captions) and its pictures are left
// out: a page number in a label is not a fact about the person. On the evidence side every run of digits
// counts ("2ten", "27th", "B.15788", "25- 3-1752"), and so does the year the source was opened ("read in 2026").
const SKIP_KEYS = new Set(['img', 'imgL', 'u', 'url', 'id', 'src', 'sources', 'docs']);
const textOf = v => v == null ? '' : typeof v === 'object'
  ? Object.entries(v).filter(([k]) => Array.isArray(v) || !SKIP_KEYS.has(k)).map(([, x]) => textOf(x)).join(' \n ')
  : (typeof v === 'string' && (v.startsWith('data:') || v.length > 20000) ? '' : String(v));
const plain = t => t.replace(/^0+(?=\d)/, '');
const figures = v => [...new Set(L.years(v).concat(L.numbers(v)).map(plain))];
function checkFigures(i, e, before, after, field) {
  if (e.kind !== 'fact' || (field && SKIP_KEYS.has(L.parsePath(field).key || L.parsePath(field).head))) return;
  const had = new Set(figures(textOf(before)));
  const added = figures(textOf(after)).filter(t => !had.has(t));
  if (!added.length) return;
  const ev = e.evidence || [];
  const said = new Set((ev.flatMap(x => [x.quote, x.transcription]).filter(w => typeof w === 'string').join(' \n ').match(/\d+/g) || []).map(plain)
    .concat(ev.map(x => String(x.opened || '').slice(0, 4))));
  const loose = added.filter(t => !said.has(t));
  if (loose.length) warn(i, `brings in ${loose.join(', ')}, which ${loose.length === 1 ? 'is' : 'are'} in none of this edit's quotes or transcriptions. ` +
    `Check ${loose.length === 1 ? 'it' : 'each'} against the source (a figure the source writes in words, or one worked out from it, is fine).`);
}
// ---- who may touch what (Cory, 16 Nov 2026, R-0760)
// The kind is what the writer calls the edit, and until then nothing held a kind to its own fields: an
// edit called "source" or "structure" could change a year or add a marriage with no evidence, and
// "owner" passed on any decision of Cory's, about any card. It had not been done; now it cannot be.
const SOURCE_LISTS = new Set(['src', 'sources']);
const THING = { pl: 'pin', union: 'marriage', bio: 'bio paragraph', bio_fr: 'bio paragraph', hl: 'highlight', hl_fr: 'highlight', docs: 'document', timeline: 'timeline entry' };
function ownerEntry(i, e, cid) {
  const r = regById.get(e.register);
  if (!r || r.status !== 'owner') return err(i, 'kind "owner" must cite the register entry recording Cory\'s decision (status "owner")');
  if (r.superseded_by) return err(i, `${r.id} was replaced by ${r.superseded_by}: read that entry and cite the one in force (it may have changed the answer)`);
  if (!(r.cards || []).includes(cid)) err(i, `${r.id} does not name ${cid} (it names ${(r.cards || []).join(', ') || 'no card'}). An owner edit cites Cory's decision about this card: ` +
    `find it with node tools/card.js ${cid}, or record his words as a new owner entry that lists ${cid}, then cite that.`);
}
// What a new card carries goes through what an "add" of the same thing would: its sources must be in
// the archive and their quotes in our copies. (Its doc-graded pins rest on the edit's own evidence,
// which addCard now requires.)
function checkNewCard(i, item) {
  for (const s of (item.src || [])) {
    if (!s || !s.u) continue;
    if (!L.archived(s.u).held) err(i, `the new card cites ${s.u}, which is not in the archive — archive it first (hand copy or capture), then cite it`);
    else if (s.q && L.quoteIn(s.u, s.q).ok === false) err(i, `the new card's source quote is not in our copy of ${s.u}: "${String(s.q).slice(0, 90)}"`);
  }
  for (const s of ((item.profile || {}).sources || []))
    if (s && s.url && !L.archived(s.url).held) err(i, `the new card cites ${s.url}, which is not in the archive — archive it first`);
}
// ---- an image on file for a fact read from an image (Cory, 16 Nov 2026, R-0755)
// Until then a typed reading counted as our copy of a register page: 123 cited record images were held
// only as words we typed ourselves, or as the empty page a viewer saves. So evidence that says it was
// read from an image, and any evidence from an address that is an image, needs the image in the archive.
// "no_image" is the way through when the image cannot be had today; the ledger then says so on the edit.
const MIN_NO_IMAGE = 20;
function checkImage(i, x, tag, a) {
  if (x.no_image !== undefined && (typeof x.no_image !== 'string' || x.no_image.trim().length < MIN_NO_IMAGE))
    return err(i, `${tag}: "no_image" must say why the image cannot be filed now and what will fetch it, in at least ${MIN_NO_IMAGE} characters ("the site needs a sign-in; an item on the At your computer list fetches it")`);
  // Read from a picture: it says so ("read" is anything but words on a page), or the address is a picture.
  // And a copy with no words in it (a viewer's empty page) that the item says it "read": what was read is
  // not in the archive at all, so the picture is the only copy there could be.
  const pictured = (x.read && !TEXT_READS.includes(x.read)) || L.imageSource(x.src);
  const blank = !pictured && x.read && !a.text;
  if (!pictured && !blank) return;
  // only an unknown word made it a picture: the writer may have meant words on a page, and must not be
  // sent to file an image, or to write "no_image", for a record that is text
  const guessed = pictured && !IMAGE_READS.includes(x.read) && !L.imageSource(x.src);
  if (L.recordImage(x.src).held) { if (x.no_image) warn(i, `${tag}: "no_image" is given, but an image of ${x.src} is on file — take "no_image" out next time`); return; }
  if (x.no_image) return void keep(i).noImage.push({ src: x.src, why: x.no_image.trim() });
  const fam = /^family:/.test(x.src), id = fam ? '' : L.sourceId(x.src);
  err(i, `${tag}: ` + (blank
      ? `our copy of ${x.src} has no words this tool can read (${a.files.map(f => path.basename(f)).join(', ') || 'no file'}; a viewer saves an empty page), and the archive holds no image of it, so what was read cannot be checked or read again.\n`
      : `${x.src} was read from an image, and the archive holds no image of it (our typed reading, or a viewer's empty page, is not a copy of the record).\n`) +
    (fam ? `    Put the photograph or scan in family-tree-sources archive/family/${x.src.slice(7)}/ with a row in that folder's README, then run this again.\n`
         : `    File the image in family-tree-sources (archive/MANUAL.md, "The image"; notes/source_archive.md), commit it there, then run this again. Either\n` +
           `      save it as archive/hand/${id}.jpg (or .png, .pdf; beside its dated copy, under that copy's name) with its row in archive/hand/README.md, then: node checks/verify.js\n` +
           `      or, for an address a card already cites: node archive/file.mjs <the image file> --url "${x.src}"   then: node checks/verify.js --record\n` +
           (blank ? `    If the page shows the record as words, not as a picture, save those words as the hand copy archive/hand/${id}.txt instead and give them as "quote".\n` : '')) +
    (guessed ? `    If what you read was words on a page, not a picture of the record, say "read": "text" and give those words as "quote": then no image is asked for.\n` : '') +
    `    If the image cannot be had now (a sign-in, a site that refuses downloads), add "no_image": "<why, and what will fetch it>" to this evidence item instead.`);
}

// ---- the register: settled questions answer back
function checkRegister(i, e, card, fam, before, after) {
  const locks = L.locksFor(register, card.node.id, fam, before, after);
  if (e.register && !regById.has(e.register)) err(i, `register entry ${e.register} does not exist`);
  if (!locks.length) return;
  const cited = locks.find(r => r.id === e.register);
  if (!cited) {
    err(i, `this touches ${locks.length === 1 ? 'a settled question' : locks.length + ' settled questions'} — read and cite it:\n` +
      locks.map(r => `      ${r.id} [${r.status}${r.by ? ', ' + r.by : ''}${r.decided ? ', ' + r.decided : ''}] ${r.topic}\n        ruling: ${r.ruling}`).join('\n') +
      `\n    Add "register": "<id>" and "effect": "consistent" (you keep to the ruling) or "reopen" (with evidence the ruling did not consider).`);
    return;
  }
  if (!['consistent', 'reopen'].includes(e.effect)) err(i, `citing ${cited.id}: say "effect": "consistent" or "reopen"`);
  if (e.effect === 'reopen') {
    if (cited.status === 'owner') err(i, `${cited.id} is Cory's own decision — only Cory reopens it (kind "owner", his words as evidence)`);
    const considered = new Set(cited.considered || []);
    const fresh = (e.evidence || []).filter(x => x.src && !considered.has(x.src) && x.src !== 'owner');
    if (!fresh.length && e.kind !== 'owner') err(i, `reopening ${cited.id} needs evidence the ruling did not consider (its "considered" list already has every source you cite)`);
    warn(i, `reopens ${cited.id} — after applying, supersede it in ledger/register.jsonl with the new ruling`);
  }
}

// ---- history: does this bring back something an earlier change took out?
// The failure this exists for: a value written, struck by a later pass, and put back by the
// pass after that — each time with a reason, none of them new evidence. Bringing a value back
// is allowed; doing it without saying so is not.
function checkReversal(i, e, card, field, fam, before, after, pinKey) {
  if (e.reverts) return;                       // said so, with a reason
  if (after === undefined || after === null || JSON.stringify(after) === JSON.stringify(before)) return;
  let H; try { H = history(); } catch (x) { warn(i, `history unavailable (${x.message}); reversal check skipped`); return; }
  const id = card.node.id;
  const versions = H.map(v => ({ v, c: v.cards[id] })).filter(x => x.c);
  if (!versions.length) return;
  const at = v => `${v.date.slice(0, 10)} (${v.sha.slice(0, 7)} "${v.subject.slice(0, 48)}")`;
  // what this field held in each version
  const valueIn = c => {
    if (pinKey) {                                  // a pin is known by place, event and year, not by position
      const idx = Object.keys(c.leaves).filter(p => /^pl\[\d+\]\.t$/.test(p)).map(p => +/\d+/.exec(p)[0])
        .find(j => c.leaves[`pl[${j}].k`] === pinKey.k && c.leaves[`pl[${j}].t`] === pinKey.t &&
                   (pinKey.y === undefined || String(c.leaves[`pl[${j}].y`]) === String(pinKey.y)));
      return idx === undefined ? undefined : c.leaves[`pl[${idx}].${field.split('.').pop()}`];
    }
    return c.leaves[field];
  };
  const inFamily = c => Object.entries(c.leaves).filter(([p]) => L.leafFamily(c.leaves, p) === fam).map(([, x]) => x);
  // 1. the field held exactly this value once, and a later version replaced it
  {
    let had = null, lost = null;
    for (const { v, c } of versions) {
      const here = typeof after === 'string' && after.length >= 20 && !pinKey
        ? inFamily(c).includes(after) : JSON.stringify(valueIn(c)) === JSON.stringify(after);
      if (here) { had = v; lost = null; } else if (had && !lost) lost = v;
    }
    if (had && lost) return err(i, `this puts back ${JSON.stringify(after).slice(0, 80)} — the card had it until ${at(lost)}, when a change took it out.\n` +
      `    If that change was wrong, say so: add "reverts": "<what it got wrong, and the evidence>".`);
  }
  // 2. words this edit puts in were on the card before, and a later version took them out
  const piece = e.replace && e.replace.length >= 25 ? e.replace : null;
  if (piece) {
    let had = null, lost = null;
    for (const { v, c } of versions) {
      const here = inFamily(c).some(x => typeof x === 'string' && L.normText(x).includes(L.normText(piece)));
      if (here) { had = v; lost = null; } else if (had && !lost) lost = v;
    }
    if (had && lost) return err(i, `these words were on the card until ${at(lost)}, when a change took them out: "${piece.slice(0, 80)}…"\n` +
      `    If putting them back is right, add "reverts": "<why the removal was wrong>".`);
  }
  // 3. a year this card once gave here, that a later version dropped, is coming back
  if (typeof after === 'string' || typeof before === 'string') {
    const added = L.years(after).filter(y => !L.years(before).includes(y));
    for (const y of added) {
      let had = null, lost = null;
      for (const { v, c } of versions) {
        const has = inFamily(c).some(x => typeof x === 'string' && L.years(x).includes(y)) ||
                    (fam.startsWith('pin:') && inFamily(c).some(x => String(x) === y));
        if (has) { had = v; lost = null; } else if (had && !lost) lost = v;
      }
      if (had && lost) err(i, `${y} was in this card's ${fam} until ${at(lost)}, then dropped; this brings it back. Add "reverts": "<why>" if that is the point.`);
    }
  }
}

// ---- apply
const working = JSON.parse(L.serialize(data));
const applied = [];
const SCOPE_ENTRY = 'R-0437';          // Cory's standing yes: the root's whole male line (CLAUDE.md, "Scope rule")
const addedUnder = new Map();          // card id this change set added -> the owner entry it cited
const retired = L.loadChanges().flatMap(c => c.retired || []);
(cs.edits || []).forEach((e, i) => {
  if (!KINDS.has(e.kind)) return err(i, `"kind" must be one of ${[...KINDS].join(', ')}`);
  const op = e.op || (e.find !== undefined ? 'edit' : e.from !== undefined || e.to !== undefined ? 'set' : null);
  if (!op) return err(i, 'say what to do: find/replace, from/to, or op add | remove | addCard | removeCard');
  // ---- whole cards: only on a decision of Cory's in the register (CLAUDE.md, "Scope rule": since
  //      3 Oct 2026 his standing yes covers the root's male line; anyone else still needs his word)
  // Until 16 Nov 2026 this branch returned before any other check: a new card needed no evidence (19 of
  // 305 had none, 10 of them with doc-graded pins), any owner entry would do, even a replaced one, and an
  // "id" in the item overrode the id this tool assigns (R-0760).
  if (op === 'addCard' || op === 'removeCard') {
    const r = regById.get(e.register);
    if (!r || r.status !== 'owner') return err(i, `${op} needs "register" citing Cory's decision (an entry with status "owner")`);
    if (r.superseded_by) return err(i, `${op}: ${r.id} was replaced by ${r.superseded_by} — read that entry and cite the one in force (it may have changed the answer)`);
    if (op === 'addCard') {
      const parent = L.findCard(working, e.parent || '');
      if (!parent || parent.ambiguous) return err(i, `parent ${e.parent} not found`);
      const u = (parent.node.unions || [])[e.union || 0];
      if (!u) return err(i, `parent ${e.parent} has no union ${e.union || 0}`);
      if (!e.item || typeof e.item !== 'object' || Array.isArray(e.item)) return err(i, 'addCard needs "item": the new card');
      if (e.item.id !== undefined) return err(i, 'the new card\'s "item" carries an "id" — take it out: ids are assigned here, in order, and never reused');
      if ((e.item.unions || []).some(x => x && (x.c || []).length))
        return err(i, 'the new card\'s "item" carries children — add each child with its own addCard edit, so each gets its own id and its own evidence');
      const node = { id: L.nextId(working, retired), ...e.item };
      if (!node.name) return err(i, 'the new card needs a name');
      // "at": the new card's place among the union's children (the tree draws them in this order;
      // default last). Siblings found later belong in birth order, not after everyone already drawn.
      const kids = (u.c = u.c || []);
      const at = e.at === undefined ? kids.length : Number(e.at);
      if (!Number.isInteger(at) || at < 0 || at > kids.length) return err(i, `"at" must be a position from 0 to ${kids.length} among the children of ${e.parent}'s union ${e.union || 0}`);
      // The decision must be about this place on the tree. R-0437 is the standing yes for a child of a man
      // of the line; any other entry must name the parent (or the new card), or the parent is itself a card
      // this change set adds under the same entry (a decision that draws several generations at once).
      const pid = parent.node.id;
      if (r.id === SCOPE_ENTRY) {
        let through = null;
        for (let c = parent; c && !through; c = c.parent ? L.findCard(working, c.parent.id) : null) if (c.node.g === 'f') through = c.node.id;
        if (through) err(i, `${SCOPE_ENTRY} is Cory's standing yes for the children of a man of the line, and ${pid} is ${through === pid ? 'a daughter' : 'below a daughter (' + through + ')'}. ` +
          `Her children are drawn only on his own decision: cite the owner entry that names ${pid}, or leave the card out and record the lead in the research data (CLAUDE.md, "Scope rule").`);
      } else if (!(r.cards || []).includes(pid) && !(r.cards || []).includes(node.id) && addedUnder.get(pid) !== r.id)
        err(i, `${r.id} does not name the parent ${pid} (it names ${(r.cards || []).join(', ') || 'no card'}). A new card cites ${SCOPE_ENTRY} (a child of a man of the line, proven from a document we hold) ` +
          `or the owner entry in which Cory decided this card: one whose "cards" list ${pid}. If he decided it and the entry does not say so, record his words as a new owner entry that lists ${pid}.`);
      // The evidence is a fact's, whatever the edit is called: under kind "owner" Cory's own words would
      // otherwise have stood in for the record (his word is the register entry, checked above).
      checkEvidence(i, { ...e, kind: 'fact' }, `a new card needs "evidence": the record that proves this child of ${pid} (the address or family: folder we hold it under, as "src"), with its words as "quote", or "read" and a "transcription"`, pid);
      if (e.kind !== 'structure' && e.kind !== 'owner') warn(i, `kind "${e.kind}" on a new card: it was checked as a card added, with its evidence. Say "kind": "structure" next time.`);
      checkNewCard(i, e.item);
      checkFigures(i, { ...e, kind: 'fact' }, null, e.item);
      kids.splice(at, 0, node);
      addedUnder.set(node.id, r.id);
      applied.push({ ...e, op, card: node.id, before: null, after: node, _i: i });
    } else {
      const c = L.findCard(working, e.card || '');
      if (!c || c.ambiguous || !c.parent) return err(i, `card ${e.card} not found (or it is the root)`);
      if (!(r.cards || []).includes(c.node.id)) return err(i, `${r.id} does not name ${c.node.id} (it names ${(r.cards || []).join(', ') || 'no card'}). A card comes off the tree only on Cory's decision about that card: cite the owner entry that lists ${c.node.id}.`);
      const u = c.parent.unions[c.unionIdx];
      u.c.splice(u.c.indexOf(c.node), 1);
      applied.push({ ...e, op, before: c.node, after: null, retired: [c.node.id], _i: i });
    }
    return;
  }
  const card = L.findCard(working, e.card || '');
  if (!card) return err(i, `card "${e.card}" not found`);
  if (card.ambiguous) return err(i, `card "${e.card}" is ambiguous: ${card.ambiguous.join('; ')}`);
  if (!card.node.id) return err(i, 'this card has no id — the payload predates ids; run the id bootstrap first');
  const cid = card.node.id;

  if (op === 'add' || op === 'remove') {
    if (!LISTS.has(e.list)) return err(i, `"list" must be one of ${[...LISTS].join(', ')}`);
    const head = e.list;
    let fam = head === 'pl' ? `pin:${(e.item && e.item.t) || 'pin'}` : head.replace(/_fr$/, '');
    if (op === 'add') {
      if (e.item === undefined) return err(i, 'add needs "item"');
      const arr = head === 'union' ? (card.node.unions = card.node.unions || []) :
        ['bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs', 'timeline'].includes(head) ? ((card.node.profile = card.node.profile || {})[head] = card.node.profile[head] || []) :
        (card.node[head] = card.node[head] || []);
      const dupKey = x => JSON.stringify(head === 'src' ? x.u || x.l : head === 'sources' ? x.url || x.label : head === 'pl' ? [x.k, x.t, x.y] : x);
      if (arr.some(x => dupKey(x) === dupKey(e.item))) return err(i, `${head} already has this item`);
      // A new source is a "source" edit. A new pin, marriage, paragraph, highlight or document asserts
      // something: it is a fact with evidence, or Cory's own decision. The decision runner called its new
      // marriages "structure", with evidence (19 real edits): that still applies, checked as the fact it
      // is, with a warning that is kept. Without evidence it is refused.
      // (A refusal here does not stop the item going in: the edits after it are then judged on the state
      // the file means, and one mistake is reported once, not again as every later edit's surprise.)
      if (e.kind === 'source' && !SOURCE_LISTS.has(head))
        err(i, `kind "source" is for a card's sources (src, sources). A new ${THING[head] || head} is a fact: say "kind": "fact" and give the evidence`);
      else if (e.kind === 'owner') ownerEntry(i, e, cid);
      else if (e.kind === 'fact' || e.kind === 'grade') checkEvidence(i, e, true);
      else if (!SOURCE_LISTS.has(head)) {
        if (!(e.evidence || []).length) err(i, `a new ${THING[head] || head} is a change of fact, whatever the edit is called: say "kind": "fact" and give the evidence (kind "${e.kind}" is not for this)`);
        else {
          warn(i, `kind "${e.kind}" on a new ${THING[head] || head}: it was checked as a fact, with its evidence. Say "kind": "fact" next time.`);
          checkEvidence(i, { ...e, kind: 'fact' }, true);
        }
      } else if (e.kind !== 'source')
        warn(i, `kind "${e.kind}" on a new source: it was checked as a source is (in the archive, its quote in our copy). Say "kind": "source" next time.`);
      if (head === 'pl' && e.item.c === 'doc' && e.kind === 'owner') checkEvidence(i, { ...e, kind: 'grade' }, true);
      if (!SOURCE_LISTS.has(head) && e.kind !== 'owner') checkFigures(i, { ...e, kind: 'fact' }, null, e.item);
      if (head === 'src' && e.item.u && e.item.q) { const q = L.quoteIn(e.item.u, e.item.q); if (q.ok === false) err(i, `the new source's quote is not in our copy of ${e.item.u}`); if (!L.archived(e.item.u).held) err(i, `${e.item.u} is not in the archive — archive it first`); }
      if (head === 'src' && e.item.u && !L.archived(e.item.u).held) err(i, `${e.item.u} is not in the archive — archive it first (hand copy or capture), then cite it`);
      if (head === 'sources' && e.item.url && !L.archived(e.item.url).held) err(i, `${e.item.url} is not in the archive — archive it first`);
      const at = e.at === undefined ? arr.length : +e.at;
      arr.splice(at, 0, e.item);
      checkRegister(i, e, card, fam, '', JSON.stringify(e.item));
      applied.push({ ...e, op, card: cid, field: `${head}[${at}]`, before: null, after: e.item, _i: i });
    } else {
      const arr = head === 'union' ? card.node.unions : ['bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs', 'timeline'].includes(head) ? (card.node.profile || {})[head] : card.node[head];
      if (!arr || !arr.length) return err(i, `${head} is empty`);
      let at;
      try { at = /^\d+$/.test(String(e.at)) ? +e.at : (() => { const r = L.resolve(card.node, `${head}[${e.at}]`); return r.prop; })(); } catch (x) { return err(i, x.message); }
      if (at === undefined || at < 0 || at >= arr.length) return err(i, `${head}[${e.at}] not found`);
      const item = arr[at];
      if (e.from === undefined) return err(i, 'remove needs "from": the item exactly as it stands (a guard against removing the wrong one)');
      if (JSON.stringify(item) !== JSON.stringify(e.from)) return err(i, `${head}[${e.at}] is not the item in "from"`);
      if (head === 'pl') fam = `pin:${item.t}`;
      if (e.kind === 'source' && !SOURCE_LISTS.has(head))
        return err(i, `kind "source" is for a card's sources (src, sources). Taking out a ${THING[head] || head} is a fact: say "kind": "fact" and give the evidence`);
      if (e.kind === 'structure') {
        // the one removal that needs no evidence: an exact duplicate, the other copy staying
        const j = e.dup_of === undefined || e.dup_of === null || e.dup_of === '' ? NaN : Number(e.dup_of);
        if (!Number.isInteger(j) || j < 0 || j >= arr.length || j === at || JSON.stringify(arr[j]) !== JSON.stringify(item))
          return err(i, `kind "structure" removes a list item only when it is an exact duplicate of one that stays: give "dup_of": <the index in ${head} of the identical item>` +
            (e.dup_of === undefined ? '' : ` (${head}[${e.dup_of}] is not identical to ${head}[${at}])`) + `. Any other removal is a fact: say "kind": "fact" and give the evidence.`);
      } else {
        if (e.kind === 'owner') ownerEntry(i, e, cid);
        checkEvidence(i, e, e.kind !== 'owner');
      }
      checkRegister(i, e, card, fam, JSON.stringify(item), '');
      arr.splice(at, 1);
      applied.push({ ...e, op, card: cid, field: `${head}[${at}]`, before: item, after: null, _i: i });
    }
    return;
  }

  // ---- edit one field
  if (!e.field) return err(i, 'no "field"');
  let before;
  try { before = L.getField(card.node, e.field); } catch (x) { return err(i, x.message); }
  let after;
  if (op === 'edit') {
    if (typeof before !== 'string') return err(i, `${e.field} is not text (it is ${JSON.stringify(before)}); use from/to`);
    if (!e.find) return err(i, '"find" is empty');
    const n = before.split(e.find).length - 1;
    if (n !== 1) return err(i, `"find" occurs ${n} times in ${e.field} — it must occur exactly once. Current text:\n      ${before.slice(0, 300)}${before.length > 300 ? '…' : ''}`);
    after = before.replace(e.find, () => e.replace ?? '');
  } else if (op === 'set') {
    const want = e.from === undefined ? undefined : e.from;
    if (JSON.stringify(before) !== JSON.stringify(want === null ? undefined : want))
      return err(i, `${e.field} is not what "from" says.\n      now:  ${JSON.stringify(before)?.slice(0, 200)}\n      from: ${JSON.stringify(want)?.slice(0, 200)}`);
    after = e.to === null ? undefined : e.to;
  } else return err(i, `unknown op ${op}`);
  if (JSON.stringify(before) === JSON.stringify(after)) return err(i, 'this edit changes nothing');

  let fam; try { fam = L.family(card.node, e.field); } catch (x) { fam = e.field; }
  // kind rules: each kind keeps to its own fields (R-0760)
  const { head: fhead, key: fkey } = L.parsePath(e.field);
  if (e.kind === 'source' && !SOURCE_LISTS.has(fhead))
    err(i, `kind "source" is for a card's sources (src[…], sources[…]: labels, addresses, quotes), and ${e.field} is not one. ` +
      `If what the card asserts changes, say "kind": "fact" and give the evidence; if only the words change, "wording" or "translation".`);
  if (e.kind === 'structure' && fhead !== 'gaz')
    err(i, `kind "structure" is for a card added or removed, a gazetteer entry (gaz.<key>) and an exact duplicate removed, and ${e.field} is none of these. ` +
      `Say "kind": "fact" and give the evidence (or "wording"/"translation" if nothing the card asserts changes).`);
  // Sex and years are not prose either. Neither had been edited as wording; but "years" turned into
  // "b. …" makes a dead person a living one with no digit changed, and "g" decides whose children the
  // standing yes covers. (A dash or a space set right in "years" is still wording.)
  const NOT_WORDS = { name: 'the person\'s name', g: 'the person\'s sex', years: 'the person\'s years' };
  const typo = v => String(v ?? '').replace(/[\u2010-\u2015\u2212-]/g, '-').replace(/\s+/g, '');
  if ((e.kind === 'wording' || e.kind === 'translation') && !(e.field === 'years' && typo(before) === typo(after)) &&
      (NOT_WORDS[e.field] || (fhead === 'union' && fkey === 's') || (fhead === 'pl' && fkey === 'k')))
    err(i, `${e.field} is ${NOT_WORDS[e.field] || (fhead === 'union' ? 'a spouse\'s name' : 'the place a pin stands on')}: changing it is a change of fact, not of ${e.kind}. Say "kind": "fact" and give the evidence.`);
  if (e.kind === 'wording' || e.kind === 'translation') {
    const d = tokDiff(before, after);
    if (d.length) err(i, `a ${e.kind} edit may not change years or numbers, and this one changes ${d.join(', ')} — it is a fact change: say "kind": "fact" and give the evidence`);
    const pa = L.multiset(L.properNouns(before)), pb = L.multiset(L.properNouns(after));
    if (e.kind === 'wording' && pa !== pb) warn(i, `the capitalised words differ (${pa} → ${pb}) — if a name or place changed, this is a fact change`);
  }
  if (e.kind === 'translation' && !L.isFrench(e.field)) err(i, '"translation" is for the French field of a pair');
  if (e.kind === 'fact' || e.kind === 'grade') checkEvidence(i, e, true);
  checkFigures(i, e, before, after, e.field);
  if (e.kind === 'grade' && !/(^|\.)(c|occ_c)$/.test(e.field)) warn(i, 'kind "grade" on a field that is not a grade (pl[…].c or occ_c)');
  if (/(^|\.)(c|occ_c)$/.test(e.field) && e.kind !== 'grade' && e.kind !== 'owner') err(i, 'a change of grade is kind "grade", with the evidence for the new grade');
  // A changed address is a new source under the old one's label: it must be in the archive, as a source
  // added is. (Until 16 Nov 2026 only "add" asked; three addresses had been changed, all to ones we hold.)
  if (/^(src\[.*\]\.u|sources\[.*\]\.url)$/.test(e.field) && textish(after) && !L.archived(after).held)
    err(i, `${after} is not in the archive — archive it first (hand copy or capture), then cite it`);
  if (e.kind === 'source') {
    if (/^src\[.*\]\.q$/.test(e.field) && textish(after)) {
      const url = L.getField(card.node, e.field.replace(/\.q$/, '.u'));
      if (url) { const q = L.quoteIn(url, after); if (q.ok === false) err(i, `the new quote is not in our copy of ${url}`); }
    }
    if (/^(src\[.*\]\.l|sources\[.*\]\.label)$/.test(e.field) && textish(after)) {
      const url = L.getField(card.node, e.field.replace(/\.l$/, '.u').replace(/\.label$/, '.url'));
      const a = url ? L.archived(url) : null;
      if (a && a.text) {
        const txt = L.normText(a.text);
        const missing = L.years(after).filter(y => !L.years(before || '').includes(y) && !txt.includes(y));
        if (missing.length) err(i, `the label now names ${missing.join(', ')}, which our copy of ${url} does not contain — a label may claim only what its source says`);
      }
    }
  }
  if (e.kind === 'owner') ownerEntry(i, e, cid);
  checkRegister(i, e, card, fam, before, after);
  let pinKey = null;
  if (/^pl\[/.test(e.field)) { const pin = L.getField(card.node, e.field.replace(/\.[a-z_0-9]+$/, '')); if (pin) pinKey = { k: pin.k, t: pin.t, y: e.field.endsWith('.y') ? undefined : pin.y }; }
  checkReversal(i, e, card, e.field, fam, before, after, pinKey);
  try { L.setField(card.node, e.field, after === undefined ? null : after); } catch (x) { return err(i, x.message); }
  applied.push({ card: cid, field: e.field, op, kind: e.kind, before, after, evidence: e.evidence, register: e.register,
    effect: e.effect, reverts: e.reverts, fr: e.fr, note: e.note, _i: i });
});

// ---- English and French must carry the same years, field pair by field pair
const touchedPairs = new Map();
for (const a of applied) {
  if (!a.field) continue;
  const tw = L.twin(a.field);
  if (!tw) continue;
  const en = L.isFrench(a.field) ? tw : a.field, fr = L.isFrench(a.field) ? a.field : tw;
  touchedPairs.set(`${a.card}|${en}`, { card: a.card, en, fr, exempt: a.fr, i: a._i });
}
for (const { card, en, fr, exempt, i } of touchedPairs.values()) {
  const c = L.findCard(working, card);
  let E, F; try { E = L.getField(c.node, en); F = L.getField(c.node, fr); } catch (_) { continue; }
  if (typeof E !== 'string' || typeof F !== 'string') continue;
  if (L.multiset(L.years(E)) !== L.multiset(L.years(F))) {
    const msg = `${card} ${en} / ${fr}: the English gives ${L.years(E).join(', ') || 'no year'}, the French ${L.years(F).join(', ') || 'no year'}`;
    if (exempt && /^exempt:/.test(exempt)) warn(i, msg + ` (exempt: ${exempt.slice(7).trim()})`);
    else errors.push(msg + ' — change both, or add "fr": "exempt: <why>" to the edit');
  }
}

// each record keeps its warnings, and says which of its evidence rests on an image not on file yet, and why
for (const a of applied) {
  const k = kept[a._i];
  delete a._i;
  if (k && k.warnings.length) a.warnings = k.warnings;
  if (k && k.noImage.length) { a.image_missing = true; a.no_image = k.noImage; }
}

// ---- verdict
warnings.forEach(w => console.log('  note  ' + w));
if (errors.length) {
  console.error(`\nREFUSED — ${errors.length} problem(s); nothing was written:\n` + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
const afterHash = L.hashData(working);
const rec = {
  id: 'CS-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15),
  at: new Date().toISOString(), who, why: cs.why, research: cs.research, file: path.basename(file),
  before_hash: beforeHash, after_hash: afterHash, edits: applied,
  retired: applied.flatMap(a => a.retired || []),
};
if (fileWarnings.length) rec.warnings = fileWarnings;
const noImage = applied.filter(a => a.image_missing).length;
const reminder = () => { if (noImage) console.log(`  REMINDER: ${noImage} edit(s) rest on an image that is not on file (image_missing in the ledger). File each image in the archive as soon as it can be had; the gate counts them until then.`); };
if (dry) { console.log(`[dry] ${applied.length} edit(s) would apply cleanly; data.json not written`); reminder(); process.exit(0); }
L.saveData(working);
L.appendChange(rec);
console.log(`applied ${applied.length} edit(s) — ${rec.id} recorded in ledger/changes.jsonl`);
reminder();
