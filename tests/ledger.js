#!/usr/bin/env node
'use strict';
/*
 * Tests for the change loop (tools/ledger.js, tools/change.js, checks/gate.js's chain rule).
 *
 *   node tests/ledger.js
 *
 * Builds a throwaway repo in a temp folder — a two-card tree with invented people, an
 * encrypted index.html, a git history, a source archive — and replays, one by one, the
 * ways wrong information reached the live site in Aug–Sep 2026, checking each is now refused:
 * a "wording" edit that changed a date; a grade struck on a claim nobody checked against the
 * source; a negative ("no record gives X") that the source contradicts; an owner decision
 * reopened; a value put back that an earlier pass had taken out; English and French drifting
 * apart; an edit on a stale copy; two writers at once; a card added without asking.
 * Zero dependencies; no real data. The people here do not exist.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
const ARCH = path.join(T, 'archive-repo');
process.env.FT_ARCHIVE = ARCH;     // for the tools loaded in this process, as for those spawned below
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { failN++; console.log('  FAIL ' + m); } };

// ---- a throwaway repo with the real tools in it
fs.mkdirSync(path.join(T, 'tools')); fs.mkdirSync(path.join(T, 'checks'));
for (const f of ['tools/ledger.js', 'tools/change.js', 'tools/crypt.js', 'tools/lock.js']) fs.copyFileSync(path.join(SRC, f), path.join(T, f));
const PW = 'test-only-password';
fs.writeFileSync(path.join(T, '.password'), PW);
const SALT = crypto.randomBytes(16).toString('base64'), ITER = 1000;
function encrypt(data) {
  const key = crypto.pbkdf2Sync(Buffer.from(PW), Buffer.from(SALT, 'base64'), ITER, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data)), c.final(), c.getAuthTag()]);
  const enc = { v: 1, iter: ITER, salt: SALT, iv: iv.toString('base64'), ct: ct.toString('base64') };
  fs.writeFileSync(path.join(T, 'index.html'), `<!doctype html><html><script>const ENC = ${JSON.stringify(enc).replace(/"(\w+)":/g, '$1:')};</script></html>\n`);
  const L = require(path.join(T, 'tools', 'ledger.js'));
  fs.writeFileSync(path.join(T, '.data-stamp'), L.fingerprint(enc) + '\n');
  fs.writeFileSync(path.join(T, 'data.json'), JSON.stringify(data, null, 1));
}
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');

const URL_A = 'https://example.invalid/record/1';     // a death notice we hold as text
const URL_B = 'https://example.invalid/record/2';     // a scan we hold as an image only
const tree = (bio, bioFr, grade) => ({
  id: 'c001', name: 'Probus Quillfeather', years: '1850–1920',
  note: 'Farmer.', note_fr: 'Fermier.', src: [{ l: 'Death notice', u: URL_A }],
  pl: [{ k: 'valeton', t: 'arrival', c: grade, y: 1907, w: 'Arrived.', w_fr: 'Arrivé.' }],
  profile: { headline: 'A farmer', headline_fr: 'Un fermier', bio: [bio], bio_fr: [bioFr],
             sources: [{ label: 'Death notice, 1920', label_fr: 'Avis de décès, 1920', url: URL_A }] },
  unions: [{ s: 'Ottilie Brambleworth', sy: '1855–1930', c: [{ id: 'c002', name: 'Wendelin Quillfeather', years: '1880–1950', note: 'Clerk.', note_fr: 'Commis.', src: [] }] }],
});
// published history: v1 said 1907, v2 changed it to 1908
encrypt(tree('He moved to Valeton in 1907 with his family.', 'Il s’installa à Valeton en 1907 avec sa famille.', 'doc'));
git('add', 'index.html'); git('commit', '-qm', 'v1');
encrypt(tree('He moved to Valeton in 1908 with his family.', 'Il s’installa à Valeton en 1908 avec sa famille.', 'doc'));
git('add', 'index.html'); git('commit', '-qm', 'v2');
git('update-ref', 'refs/remotes/origin/main', 'HEAD');

// the source archive, as a clone of family-tree-sources would hold it
const sid = u => crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
fs.mkdirSync(path.join(ARCH, 'archive', 'hand'), { recursive: true });
fs.mkdirSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(URL_B)), { recursive: true });
fs.writeFileSync(path.join(ARCH, 'archive', 'hand', sid(URL_A) + '.txt'),
  `# url: ${URL_A}\n# captured: 2026-09-01T00:00Z\n# kind: hand copy\n\nProbus Quillfeather died at the Town of Marrowby on Jan 5, 1920. He came to Valeton in 1908.\n`);
fs.writeFileSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(URL_B), '2026-09-01.jpg'), 'not really a jpeg');
// an old page saved in Latin-1 that also spells accents as entities, and a viewer page with no words
const URL_C = 'https://example.invalid/old-page.htm', URL_D = 'https://example.invalid/viewer/3';
for (const u of [URL_C, URL_D]) fs.mkdirSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(u)), { recursive: true });
fs.writeFileSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(URL_C), '2026-09-01.html'),
  Buffer.concat([Buffer.from('<HTML><BODY><P>Tertia Quillfeather oo Probus &Eacute;pervine (1850, 1920)</P><P>n'),
    Buffer.from([0xe9]), Buffer.from('e &agrave; Marrowby &#8212; caf&#xE9;</P></BODY></HTML>')]));
fs.writeFileSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(URL_D), '2026-09-01.html'),
  '<!doctype html><html><head><meta charset="utf-8"><script>boot()</script></head><body>\n  <div id="app"></div>\n</body></html>');
const stored = (u, f, type) => ({ id: sid(u), url: u, ok: true, result: 'new', sha256: 'x', file: `example.invalid/${sid(u)}/${f}`, contentType: type });
fs.writeFileSync(path.join(ARCH, 'archive', 'store', 'state.json'), JSON.stringify({
  [sid(URL_B)]: stored(URL_B, '2026-09-01.jpg', 'image/jpeg'),
  [sid(URL_C)]: stored(URL_C, '2026-09-01.html', 'text/html'),
  [sid(URL_D)]: stored(URL_D, '2026-09-01.html', 'text/html') }));

const env = { ...process.env, FT_ROOT: T, FT_ARCHIVE: ARCH, FT_LEDGER: path.join(T, 'ledger') };
delete env.FT_WHO;
let n = 0;
function change(cs, extra = []) {
  const f = path.join(T, `cs${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(cs));
  const r = spawnSync(process.execPath, [path.join(T, 'tools', 'change.js'), f, ...extra], { cwd: T, env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const today = '2026-09-24';
const E = (o) => ({ why: 'test', edits: [{ card: 'c001', ...o }] });
const bio = () => JSON.parse(fs.readFileSync(path.join(T, 'data.json'), 'utf8')).profile.bio[0];

console.log('== the change loop refuses what went wrong in Aug–Sep 2026');
let r = change(E({ field: 'bio[0]', find: '1908', replace: '1909', kind: 'wording' }));
ok(r.code === 1 && /may not change years/.test(r.out), 'a "wording" edit that changes a date is refused');

r = change(E({ field: 'bio[0]', find: 'with his family', replace: 'with his wife and children', kind: 'fact' }));
ok(r.code === 1 && /needs "evidence"/.test(r.out), 'a fact change with no evidence is refused');

r = change(E({ field: 'bio[0]', find: 'with his family', replace: 'with his wife', kind: 'fact',
  evidence: [{ src: URL_A, quote: 'He came to Valeton with his wife', opened: today }] }));
ok(r.code === 1 && /not in our copy/.test(r.out), 'evidence whose quote is not in our copy of the source is refused');

r = change(E({ field: 'pl[0].c', from: 'doc', to: 'inf', kind: 'grade',
  evidence: [{ src: URL_A, absent: ['Valeton'], opened: today }] }));
ok(r.code === 1 && /contains "Valeton"/.test(r.out), 'a downgrade resting on "the source does not say X" fails when the source says X');

r = change(E({ field: 'pl[0].c', from: 'doc', to: 'inf', kind: 'grade',
  evidence: [{ src: 'https://example.invalid/never-archived', quote: 'x', opened: today }] }));
ok(r.code === 1 && /not in the archive|no copy/.test(r.out), 'evidence from a source that is not archived is refused');

r = change(E({ field: 'pl[0].c', from: 'doc', to: 'inf', kind: 'grade',
  evidence: [{ src: URL_B, quote: 'arrived 1907', opened: today }] }));
ok(r.code === 1 && /no text layer/.test(r.out), 'a quote from an image-only copy must be attested as read, with a transcription');

r = change(E({ field: 'bio[0]', find: '1908', replace: '1907', kind: 'fact',
  evidence: [{ src: URL_B, read: 'image', transcription: 'came to Valeton in 1907', opened: today }] }));
ok(r.code === 1 && /1907 was in this card|puts back|brings it back/.test(r.out), 'putting back a date an earlier version dropped is refused unless it says "reverts"');

r = change(E({ field: 'bio[0]', find: '1908', replace: '1907', kind: 'fact', reverts: 'the 1908 change misread the notice; the scan reads 1907',
  evidence: [{ src: URL_B, read: 'image', transcription: 'came to Valeton in 1907', opened: today }] }));
ok(r.code === 1 && /English gives 1907, the French 1908/.test(r.out), 'English and French may not end up with different years');

r = change({ why: 'test', edits: [
  { card: 'c001', field: 'bio[0]', find: '1908', replace: '1907', kind: 'fact', reverts: 'the 1908 change misread the notice; the scan reads 1907',
    evidence: [{ src: URL_B, read: 'image', transcription: 'came to Valeton in 1907', opened: today }] },
  { card: 'c001', field: 'bio_fr[0]', find: '1908', replace: '1907', kind: 'translation' }] });
ok(r.code === 1 && /translation edit may not change years/.test(r.out), 'a "translation" that changes a date is refused too');

r = change({ why: 'test', edits: [
  { card: 'c001', field: 'bio[0]', find: '1908', replace: '1907', kind: 'fact', reverts: 'the 1908 change misread the notice; the scan reads 1907',
    evidence: [{ src: URL_B, read: 'image', transcription: 'came to Valeton in 1907', opened: today }] },
  { card: 'c001', field: 'bio_fr[0]', find: '1908', replace: '1907', kind: 'fact', reverts: 'same as the English',
    evidence: [{ src: URL_B, read: 'image', transcription: 'came to Valeton in 1907', opened: today }] }] });
ok(r.code === 0 && /1907/.test(bio()), 'with evidence, a stated reversal and both languages, the change applies');
const ledger = fs.readFileSync(path.join(T, 'ledger', 'changes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
ok(ledger.length === 1 && ledger[0].edits.length === 2 && ledger[0].edits[0].before.includes('1908'), 'the ledger records both edits with their before and after');

console.log('== the register');
fs.writeFileSync(path.join(T, 'ledger', 'register.jsonl'), [
  { id: 'R-0001', status: 'owner', by: 'Cory', decided: '2026-09-09', cards: ['c001'], fields: ['headline'], topic: 'headline wording', ruling: 'Keep the headline as "A farmer".' },
  { id: 'R-0002', status: 'settled', by: 'rule', decided: '2026-09-07', cards: ['c001'], fields: ['bio', 'pin:arrival'], tokens: ['1907', '1908'], topic: 'arrival year', ruling: 'Both years are given; neither is chosen.', considered: [URL_A, URL_B] },
].map(x => JSON.stringify(x)).join('\n') + '\n');
r = change(E({ field: 'headline', find: 'A farmer', replace: 'A farmer and carter', kind: 'wording' }));
ok(r.code === 1 && /R-0001/.test(r.out) && /settled question/.test(r.out), 'an edit on a field Cory decided is refused and shows his ruling');
r = change(E({ field: 'headline', find: 'A farmer', replace: 'A farmer and carter', kind: 'wording', register: 'R-0001', effect: 'reopen' }));
ok(r.code === 1 && /only Cory reopens it/.test(r.out), 'nobody but Cory reopens his decision');
r = change({ why: 'test', edits: [
  { card: 'c001', field: 'bio[0]', find: '1907', replace: '1908', kind: 'fact', reverts: 'test', evidence: [{ src: URL_A, quote: 'came to Valeton in 1908', opened: today }] },
  { card: 'c001', field: 'bio_fr[0]', find: '1907', replace: '1908', kind: 'fact', reverts: 'test', evidence: [{ src: URL_A, quote: 'came to Valeton in 1908', opened: today }] }] });
ok(r.code === 1 && /R-0002/.test(r.out), 'changing a year the register settled is refused without citing the entry');
r = change({ why: 'test', edits: [
  { card: 'c001', field: 'bio[0]', find: '1907', replace: '1908', kind: 'fact', reverts: 'test', register: 'R-0002', effect: 'reopen', evidence: [{ src: URL_A, quote: 'came to Valeton in 1908', opened: today }] },
  { card: 'c001', field: 'bio_fr[0]', find: '1907', replace: '1908', kind: 'fact', reverts: 'test', register: 'R-0002', effect: 'reopen', evidence: [{ src: URL_A, quote: 'came to Valeton in 1908', opened: today }] }] });
ok(r.code === 1 && /evidence the ruling did not consider/.test(r.out), 'reopening a settled question with evidence it already weighed is refused');
r = change(E({ field: 'note', find: 'Farmer.', replace: 'A farmer.', kind: 'wording' }));
ok(r.code === 0, 'an edit the register does not cover goes through');

console.log('== one writer, fresh copies, no people added without asking');
execFileSync(process.execPath, [path.join(T, 'tools', 'lock.js'), 'take', 'other session', 'testing'], { cwd: T, env });
r = change(E({ field: 'note', find: 'A farmer.', replace: 'Farmer.', kind: 'wording' }), ['--who', 'me']);
ok(r.code === 1 && /LOCK is held by "other session"/.test(r.out), 'a second writer is refused while the lock is held');
execFileSync(process.execPath, [path.join(T, 'tools', 'lock.js'), 'release', 'other session'], { cwd: T, env });
const stale = fs.readFileSync(path.join(T, 'data.json'), 'utf8');
fs.writeFileSync(path.join(T, 'data.json'), stale.replace('Clerk.', 'Clerk!'));     // a hand edit outside the tools
r = change({ why: 'test', edits: [{ card: 'c002', field: 'note_fr', find: 'Commis.', replace: 'Employé de bureau.', kind: 'translation' }] });
ok(r.code === 1 && /ledger does not explain the difference/.test(r.out), 'an edit on a data.json that neither the ledger nor index.html explains is refused');
fs.writeFileSync(path.join(T, 'data.json'), stale);
r = change({ why: 'test', edits: [{ card: 'c001', op: 'addCard', parent: 'c001', union: 0, item: { name: 'Tertia Quillfeather', years: '1885–1960' }, kind: 'structure' }] });
ok(r.code === 1 && /Cory's decision/.test(r.out), 'a card cannot be added without Cory\'s recorded decision');

console.log('== the gate\'s chain rule');
const L = require(path.join(T, 'tools', 'ledger.js'));
const live = L.payloadAt('origin/main'), now = L.loadData();
const chain = L.chain(L.loadChanges(), L.hashData(live), L.hashData(now));
ok(Array.isArray(chain) && chain.length === 2, 'every difference from the live payload is explained by the ledger (2 change sets)');
const hand = JSON.parse(JSON.stringify(now)); hand.unions[0].c[0].note = 'Clerk!';
ok(L.chain(L.loadChanges(), L.hashData(live), L.hashData(hand)) === null, 'a single hand edit breaks the chain, so the gate would refuse the commit');

console.log('== reading the archive');
ok(L.quoteIn(URL_C, 'Probus Épervine (1850, 1920)').ok === true, 'an accent written as an HTML entity matches a quote that spells it out');
ok(L.quoteIn(URL_C, 'née à Marrowby — café').ok === true, 'a Latin-1 page is read as Latin-1, not as broken UTF-8');
ok(L.quoteIn(URL_D, 'anything').ok === null, 'a copy with no words in it counts as unread, not as a copy that lacks the quote');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
