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
 * Then the rules of 16 Nov 2026 (R-0755, R-0760): an image on file for a fact read from one, evidence
 * on a new card, each kind of edit kept to its own fields, warnings kept in the ledger, the lock in hand
 * before writing; and the gate and the commit hook themselves, run on the throwaway repo.
 * Zero dependencies; no real data and no private file: it runs in a bare checkout (CI runs it, and so
 * does checks/gate.js). The people here do not exist.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
const ARCH = path.join(T, 'archive-repo');
// Nothing of the shell that runs this may reach the tools: a cloud shell's ~/.ft-env points FT_RESEARCH at the
// real research.json and names the real lock holder, a read-only session sets FT_READONLY, and the tools prefer
// FT_PASSWORD to .password. Each of these broke this suite once. The throwaway repo is the whole world here.
for (const k of ['FT_PASSWORD', 'FT_WHO', 'FT_READONLY', 'FT_DIR', 'FT_PRIVATE_DIR', 'FT_OWNER_KEY', 'FT_DATA', 'FT_PUBLISH']) delete process.env[k];
Object.assign(process.env, { FT_ROOT: T, FT_ARCHIVE: ARCH, FT_LEDGER: path.join(T, 'ledger'), FT_RESEARCH: path.join(T, 'research.json') });
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { failN++; console.log('  FAIL ' + m); } };

// ---- a throwaway repo with the real tools in it
fs.mkdirSync(path.join(T, 'tools')); fs.mkdirSync(path.join(T, 'checks'));
for (const f of ['tools/ledger.js', 'tools/payload.js', 'tools/change.js', 'tools/crypt.js', 'tools/lock.js', 'tools/research.js', 'tools/card.js', 'tools/check-commit-msg.js', 'checks/gate.js'])
  fs.copyFileSync(path.join(SRC, f), path.join(T, f));
const PW = 'test-only-password';
fs.writeFileSync(path.join(T, '.password'), PW);
const SALT = crypto.randomBytes(16).toString('base64'), ITER = 1000;
function encrypt(data) {
  const key = crypto.pbkdf2Sync(Buffer.from(PW), Buffer.from(SALT, 'base64'), ITER, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data)), c.final(), c.getAuthTag()]);
  const enc = { v: 1, iter: ITER, salt: SALT, iv: iv.toString('base64'), ct: ct.toString('base64') };
  // written as the page writes it ("v:1, iter:…"): the commit hook reads the iv with grep
  fs.writeFileSync(path.join(T, 'index.html'), `<!doctype html><html><script>const ENC = {${Object.entries(enc).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ')}};</script></html>\n`);
  const L = require(path.join(T, 'tools', 'ledger.js'));
  fs.writeFileSync(path.join(T, '.data-stamp'), L.fingerprint(enc) + '\n');
  fs.writeFileSync(path.join(T, 'data.json'), JSON.stringify(data, null, 1));
}
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');

const URL_A = 'https://example.invalid/record/1';     // a death notice we hold as text
const URL_B = 'https://example.invalid/record/2';     // a scan we hold as an image only
const tree = (bio, bioFr, grade) => ({
  id: 'c001', name: 'Probus Quillfeather', years: '1850–1920', g: 'm',
  note: 'Farmer.', note_fr: 'Fermier.', src: [{ l: 'Death notice', u: URL_A }],
  pl: [{ k: 'valeton', t: 'arrival', c: grade, y: 1907, w: 'Arrived.', w_fr: 'Arrivé.' }],
  profile: { headline: 'A farmer', headline_fr: 'Un fermier', bio: [bio], bio_fr: [bioFr],
             sources: [{ label: 'Death notice, 1920', label_fr: 'Avis de décès, 1920', url: URL_A }] },
  unions: [{ s: 'Ottilie Brambleworth', sy: '1855–1930', c: [
    { id: 'c002', name: 'Wendelin Quillfeather', years: '1880–1950', g: 'm', note: 'Clerk.', note_fr: 'Commis.', src: [], unions: [{ s: 'Philippa Marrowmere', c: [] }] },
    // a daughter of the line, with a marriage: her children are not drawn on the standing yes
    { id: 'c003', name: 'Ottoline Quillfeather', years: '1882–1960', g: 'f', note: 'Teacher.', note_fr: 'Institutrice.', src: [],
      profile: { hl: ['Taught for forty years.', 'Taught for forty years.', 'Kept bees.'] }, unions: [{ s: 'Barnaby Thistlewood', c: [] }] }] }],
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

/* the session these tests are: it holds the writer lock, as a session that writes must (16 Nov 2026) */
const ME = 'the tests';
const env = { ...process.env, FT_WHO: ME };
const lock = (cmd, who, e = env) => execFileSync(process.execPath, [path.join(T, 'tools', 'lock.js'), cmd, who, 'testing'], { cwd: T, env: e, encoding: 'utf8' });
lock('take', ME);
let n = 0;
function change(cs, extra = [], e = env) {
  const f = path.join(T, `cs${++n}.json`);
  /* every change says what it does to the research data (3 Oct 2026); the tests below that are not about
     that say "none"; research: null leaves the field out */
  cs = Object.assign({ research: 'none: a test of the change loop' }, cs);
  if (cs.research === null) delete cs.research;
  fs.writeFileSync(f, JSON.stringify(cs));
  const r = spawnSync(process.execPath, [path.join(T, 'tools', 'change.js'), f, ...extra], { cwd: T, env: e, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const DRY = ['--dry'];
const today = '2026-09-24';
const E = (o) => ({ why: 'test', edits: [{ card: 'c001', ...o }] });
const now = () => JSON.parse(fs.readFileSync(path.join(T, 'data.json'), 'utf8'));
const bio = () => now().profile.bio[0];
const records = () => fs.readFileSync(path.join(T, 'ledger', 'changes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

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
const ledger = records();
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

console.log('== every change says what it does to the research data');
r = change(Object.assign(E({ field: 'note', find: 'Farmer.', replace: 'A farmer.', kind: 'wording' }), { research: null }));
ok(r.code === 1 && /needs "research"/.test(r.out), 'a change file that does not say which research items it moves is refused');
r = change(Object.assign(E({ field: 'note', find: 'Farmer.', replace: 'A farmer.', kind: 'wording' }), { research: 'none:' }));
ok(r.code === 1 && /needs a reason/.test(r.out), '"none" needs its reason');
fs.writeFileSync(path.join(T, 'research.json'), JSON.stringify({ schema: 1, updated: '2026-09-24', themes: [], visits: {}, investigations: [
  { id: 'i1', theme: 't1', qs: [{ q: 'x', state: 'open', src: [{ id: 's1', t: 'x', st: 'ready' }] }] }] }));
r = change(Object.assign(E({ field: 'note', find: 'Farmer.', replace: 'A farmer.', kind: 'wording' }), { research: 'i1 s99' }));
ok(r.code === 1 && /s99, which research\.json does not have/.test(r.out), 'a change naming a research item that does not exist is refused');
fs.rmSync(path.join(T, 'research.json'));

console.log('== one writer, fresh copies, no people added without asking');
{
  const back = E({ field: 'note', find: 'A farmer.', replace: 'Farmer.', kind: 'wording' });
  lock('release', ME);
  r = change(back);
  ok(r.code === 1 && /writer lock is free/.test(r.out) && /bash tools\/cloud-lock\.sh take "<who>" "<what you are doing>"/.test(r.out) && now().note === 'A farmer.',
    'a change is not written while the lock is free, and the refusal gives the command that takes it');
  r = change(back, DRY);
  ok(r.code === 0 && /would apply cleanly/.test(r.out), '--dry checks a file without the lock');
  lock('take', 'other session');
  r = change(back, ['--who', 'me']);
  ok(r.code === 1 && /LOCK is held by "other session"/.test(r.out) && /--dry/.test(r.out) && /add --steal/.test(r.out) && now().note === 'A farmer.',
    'a second writer is refused while the lock is held, and is told to wait, to check with --dry meanwhile, and how to take over a lock left behind');
  const anon = { ...env }; delete anon.FT_WHO;
  r = change(back, DRY);
  ok(r.code === 0 && /note  the writer lock is held by "other session"/.test(r.out) && /would apply cleanly/.test(r.out) && !/steal/.test(r.out),
    '--dry runs while another session holds the lock, and says who holds it');
  r = change(back, DRY, { ...anon, FT_READONLY: '1' });
  ok(r.code === 0 && /would apply cleanly/.test(r.out) && now().note === 'A farmer.', 'so does the dry run of a read-only session, as its refusal to write promises');
  r = change(back, ['--who', 'other session'], anon);
  ok(r.code === 1 && /no FT_WHO/.test(r.out) && now().note === 'A farmer.', 'naming the holder with --who does not make a session the holder');
  lock('release', 'other session');
  lock('take', ME);
  r = change(back, [], { ...env, FT_READONLY: '1' });
  ok(r.code === 1 && /read-only/.test(r.out) && now().note === 'A farmer.', 'a read-only session (FT_READONLY=1) writes nothing, lock or no lock');
  fs.writeFileSync(path.join(T, 'ledger', 'LOCK'), JSON.stringify({ who: ME, what: 'testing', since: new Date(Date.now() - 13 * 3600e3).toISOString() }) + '\n');
  r = change(back);
  ok(r.code === 1 && /ran out/.test(r.out), 'a lock taken over 12 hours ago has run out: it is taken again before writing');
  lock('take', ME);
}
const stale = fs.readFileSync(path.join(T, 'data.json'), 'utf8');
fs.writeFileSync(path.join(T, 'data.json'), stale.replace('Clerk.', 'Clerk!'));     // a hand edit outside the tools
r = change({ why: 'test', edits: [{ card: 'c002', field: 'note_fr', find: 'Commis.', replace: 'Employé de bureau.', kind: 'translation' }] });
ok(r.code === 1 && /ledger does not explain the difference/.test(r.out), 'an edit on a data.json that neither the ledger nor index.html explains is refused');
fs.writeFileSync(path.join(T, 'data.json'), stale);
r = change({ why: 'test', edits: [{ card: 'c001', op: 'addCard', parent: 'c001', union: 0, item: { name: 'Tertia Quillfeather', years: '1885–1960' }, kind: 'structure' }] });
ok(r.code === 1 && /Cory's decision/.test(r.out), 'a card cannot be added without Cory\'s recorded decision');
const born = [{ src: URL_A, quote: 'He came to Valeton in 1908', opened: today }];      // stands in for the record that proves the child
{
  const add = (at) => ({ why: 'test', research: 'none: a test of where a new card is placed', edits: [{ card: 'c001', op: 'addCard', parent: 'c001', union: 0, at, item: { name: 'Tertia Quillfeather', years: '1878–1960' }, kind: 'structure', register: 'R-0001', evidence: born }] });
  r = change(add(5), DRY);
  ok(r.code === 1 && /"at" must be a position from 0 to 2/.test(r.out), 'a new card cannot be placed beyond the end of its parents\' children');
  r = change(add(0), DRY);
  ok(r.code === 0 && /would apply cleanly/.test(r.out), 'with Cory\'s recorded decision a new card can be placed before an older sibling (birth order)');
}

console.log('== the gate\'s chain rule');
const L = require(path.join(T, 'tools', 'ledger.js'));
const live = L.payloadAt('origin/main'), cur = L.loadData();
const chain = L.chain(L.loadChanges(), L.hashData(live), L.hashData(cur));
ok(Array.isArray(chain) && chain.length === 2, 'every difference from the live payload is explained by the ledger (2 change sets)');
const hand = JSON.parse(JSON.stringify(cur)); hand.unions[0].c[0].note = 'Clerk!';
ok(L.chain(L.loadChanges(), L.hashData(live), L.hashData(hand)) === null, 'a single hand edit breaks the chain, so the gate would refuse the commit');

console.log('== reading the archive');
ok(L.quoteIn(URL_C, 'Probus Épervine (1850, 1920)').ok === true, 'an accent written as an HTML entity matches a quote that spells it out');
ok(L.quoteIn(URL_C, 'née à Marrowby — café').ok === true, 'a Latin-1 page is read as Latin-1, not as broken UTF-8');
ok(L.quoteIn(URL_D, 'anything').ok === null, 'a copy with no words in it counts as unread, not as a copy that lacks the quote');

console.log('== the gazetteer path');
{
  const root = { id: 'c001', gaz: { valeton: { n: 'Valeton' } }, unions: [{ c: [{ id: 'c002' }] }] };
  ok(L.getField(root, 'gaz.valeton').n === 'Valeton' && L.getField(root, 'gaz.marrowby') === undefined, 'gaz.<key> reads one gazetteer entry on the root card');
  L.setField(root, 'gaz.marrowby', { n: 'Marrowby', lat: 1, lon: 2 });
  ok(root.gaz.marrowby && root.gaz.marrowby.n === 'Marrowby' && root.gaz.valeton.n === 'Valeton', 'gaz.<key> adds one entry and leaves the others alone');
  let refused = false; try { L.setField(root.unions[0].c[0], 'gaz.x', { n: 'X' }); } catch (e) { refused = true; }
  ok(refused && root.unions[0].c[0].gaz === undefined, 'a card that is not the root cannot be given a gazetteer');
}

console.log('== an image on file for a fact read from an image');
{
  // Six invented register pages, each held as our typed reading, and one image filed in each place the
  // archive keeps them. The addresses have the shape of a page in an archive's viewer.
  const page = n => `https://example.invalid/ark:/12345/reg${n}/0a1b2c3d-1111-2222-3333-44445555666${n}`;
  const hand = path.join(ARCH, 'archive', 'hand');
  const reading = (u, head = '') => fs.writeFileSync(path.join(hand, sid(u) + '.txt'),
    `# url: ${u}\n# captured: 2026-09-02\n${head}\nEntry 12. Wendelin Quillfeather, clerk at the mill.\n`);
  const jpg = f => fs.writeFileSync(f, 'not really a jpeg');
  const [P_NONE, P_HAND, P_NAMED, P_HEADER, P_ROW, P_STORE] = [1, 2, 3, 4, 5, 6].map(page);
  reading(P_NONE);
  reading(P_HAND); jpg(path.join(hand, sid(P_HAND) + '.jpg'));
  reading(P_NAMED, '# Keyed copy; the text is 2026-09-02-example-yc1-1.md word for word.\n');
  fs.writeFileSync(path.join(hand, '2026-09-02-example-yc1-1.md'), '# url: no address of its own\n\nEntry 12.\n');
  jpg(path.join(hand, '2026-09-02-example-yc1-1.jpg'));
  jpg(path.join(hand, '2026-09-02-example-yc1-10.jpg'));      // another copy's picture: "…-1" must not take it
  reading(P_HEADER);
  fs.writeFileSync(path.join(hand, '2026-09-02-example-yc1-2.md'), `# url: ${P_HEADER} (the page in the viewer).\n# captured: 2026-09-02\n\nEntry 12.\n`);
  jpg(path.join(hand, '2026-09-02-example-yc1-2a.jpg'));
  reading(P_ROW);
  jpg(path.join(hand, '2026-09-02-example-yc1-30.jpg'));
  fs.writeFileSync(path.join(hand, 'README.md'), '| image | from | bytes | sha256 | copy | how | filed |\n|---|---|---|---|---|---|---|\n' +
    `| \`2026-09-02-example-yc1-30.jpg\` | ${P_ROW} (register 5, view 30) | 17 | x | \`2026-09-02-example-yc1-pages.md\` | saved from the viewer | 2 Sep 2026 |\n`);
  reading(P_STORE);
  // two copies that are words, not readings of a picture: a record the site shows as text, and a book's OCR layer
  const TEXT_REC = 'https://example.invalid/record/text-only', OCR_BOOK = 'https://example.invalid/details/a-county-history';
  reading(TEXT_REC, '# image: none: the site shows this record as text only\n');
  reading(OCR_BOOK, '# image: https://example.invalid/stream/a-county-history_djvu.txt (OCR text layer)\n');
  // and one whose address says nothing, but whose hand copy says it was read from the archive's image
  const BY_HEADER = 'https://example.invalid/servlet/document?id=26273';
  reading(BY_HEADER, '# Read by hand from the archive\'s own image, full-size JPEG.\n# image: https://example.invalid/images/26273.jpg (view 12 of 309)\n');
  fs.mkdirSync(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(P_STORE)), { recursive: true });
  jpg(path.join(ARCH, 'archive', 'store', 'example.invalid', sid(P_STORE), 'register-6-view-12.jpg'));   // saved by hand: not in state.json
  for (const [dir, files] of [['2026-09-03-letter-with-scan', ['README.md', 'page-1.jpg']], ['2026-09-03-letter-typed-only', ['README.md']]]) {
    fs.mkdirSync(path.join(ARCH, 'archive', 'family', dir), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(ARCH, 'archive', 'family', dir, f), f.endsWith('.md') ? 'Wendelin was a clerk at the mill.\n' : 'not really a jpeg');
  }
  const fact = ev => ({ why: 'test', edits: [{ card: 'c002', field: 'note', find: 'Clerk', replace: 'Mill clerk', kind: 'fact', evidence: [{ opened: today, ...ev }] }] });
  const quote = 'clerk at the mill';

  r = change(fact({ src: P_NONE, quote }), ['--dry']);
  ok(r.code === 1 && /holds no image/.test(r.out) && /archive\/hand\/[0-9a-f]{12}\.jpg/.test(r.out) && /"no_image"/.test(r.out),
    'a quote from our typed reading of a register page is refused while no image of the page is on file, and the refusal says where to file it');
  ok(/with its row in archive\/hand\/README\.md, then: node checks\/verify\.js/.test(r.out) && r.out.includes(`node archive/file.mjs <the image file> --url "${P_NONE}"`) && /archive\/MANUAL\.md/.test(r.out),
    'and with which tools: the README row and verify.js, or file.mjs with the address');
  r = change(fact({ src: URL_A, read: 'image', transcription: 'He came to Valeton in 1908.' }), ['--dry']);
  ok(r.code === 1 && /holds no image/.test(r.out), 'so is "read": "image" from a source held as text only');
  r = change(fact({ src: URL_D, read: 'image', transcription: quote }), ['--dry']);
  ok(r.code === 1 && /holds no image/.test(r.out), 'a viewer\'s saved .html is not an image of the record, though the archive lists it as held');
  r = change(fact({ src: 'family:2026-09-03-letter-typed-only', read: 'image', transcription: quote }), ['--dry']);
  ok(r.code === 1 && /archive\/family\/2026-09-03-letter-typed-only\//.test(r.out), 'a family paper read from a photograph needs the photograph in its folder');

  const places = [[URL_B, 'the source\'s store folder, listed in state.json'], [P_STORE, 'the store folder, saved by hand and not listed'],
    [P_HAND, 'archive/hand/<id>.jpg'], [P_NAMED, 'a dated copy the keyed copy names'], [P_HEADER, 'a dated copy whose header gives the address'],
    [P_ROW, 'a row of archive/hand/README.md'], ['family:2026-09-03-letter-with-scan', 'a family paper\'s folder']];
  for (const [src, where] of places) {
    r = change(fact({ src, read: 'image', transcription: quote }), ['--dry']);
    ok(r.code === 0 && L.recordImage(src).held, `accepted with the image in ${where}`);
  }
  ok(!L.recordImage(P_NONE).held && !L.recordImage(URL_D).held && !L.recordImage(URL_A).held, 'the resolver finds no image where there is none');
  ok(L.recordImage(P_NAMED).files.map(f => path.basename(f)).join() === '2026-09-02-example-yc1-1.jpg', 'the copy "…-1" does not take the picture "…-10.jpg" for its own');
  ok(L.imageSource(P_NONE) && !L.imageSource(URL_A) && L.copyKind(P_NONE) === 'typed reading only' && L.copyKind(P_HAND) === 'image' && L.copyKind(URL_A) === 'page text',
    'the kind of copy held is known: an image, page text, or a typed reading only');
  ok(!L.imageSource(TEXT_REC) && !L.imageSource(OCR_BOOK) && L.imageSource('https://example.invalid/other/7') === false,
    'a hand copy that says "image: none", or that names an OCR text, is not taken for a reading of an image');
  r = change(fact({ src: BY_HEADER, quote }), ['--dry']);
  ok(L.imageSource(BY_HEADER) && r.code === 1 && /holds no image/.test(r.out), 'a hand copy that says it was read from an image makes its source one, whatever the address looks like');
  // "read" says what was read. A word the tool does not know is not a way round the rule: it is taken as a picture.
  r = change(fact({ src: URL_A, read: 'scan', transcription: quote }), DRY);
  ok(r.code === 1 && /holds no image/.test(r.out) && /"read": "scan" is not a word this tool knows/.test(r.out) && /"image", "pdf", "original"/.test(r.out) && /"text", "index entry"/.test(r.out),
    'a "read" the tool does not know ("scan") is taken as read from an image: refused with no image on file, and the allowed words are named');
  r = change(fact({ src: URL_B, read: 'photo', quote }), DRY);
  ok(r.code === 0 && /"read": "photo" is not a word this tool knows/.test(r.out), 'with the image on file it goes through, with the same warning');
  r = change(fact({ src: URL_D, read: 'text', quote }), DRY);
  ok(r.code === 1 && /has no words this tool can read/.test(r.out) && /2026-09-01\.html/.test(r.out) && /archive\/hand\/[0-9a-f]{12}\.txt/.test(r.out) && /"no_image"/.test(r.out),
    '"read": "text" of a copy with no words and no image (a viewer\'s empty page) is refused: nothing in the archive can be read again');
  r = change(fact({ src: URL_D, read: 'index entry', transcription: quote, no_image: 'the viewer serves no file; a chat at the main computer will capture the page' }), DRY);
  ok(r.code === 0 && /REMINDER: 1 edit/.test(r.out), 'and goes through with "no_image", marked like any other missing image');
  r = change(fact({ src: URL_A, read: 'text', transcription: 'The notice says he was a clerk at the mill.' }), DRY);
  ok(r.code === 0 && /"transcription" is not in our copy/.test(r.out) && /as "quote"/.test(r.out), '"read": "text" with our own account of the page applies, flagged: nothing checked those words');
  r = change(fact({ src: URL_A, read: 'text', quote: 'He came to Valeton in 1908' }), DRY);
  ok(r.code === 0 && !/note  /.test(r.out), 'with the page\'s own words as a quote there is nothing to flag');
  const card = spawnSync(process.execPath, [path.join(T, 'tools', 'card.js'), 'c001'], { cwd: T, env, encoding: 'utf8' });
  ok(card.status === 0 && /held as: page text/.test(card.stdout), 'and card.js prints it beside each source');

  r = change(fact({ src: P_NONE, quote, no_image: 'sign-in needed' }), ['--dry']);
  ok(r.code === 1 && /at least 20 characters/.test(r.out), 'a "no_image" too short to say why and what will fetch it is refused');
  const why = 'the archive refuses downloads from this machine; a chat at the main computer will save it';
  r = change(fact({ src: P_NONE, quote, no_image: why }));
  const last = records().pop();
  ok(r.code === 0 && /REMINDER: 1 edit/.test(r.out) && last.edits[0].image_missing === true && last.edits[0].no_image[0].src === P_NONE && last.edits[0].no_image[0].why === why,
    'with "no_image" the edit applies, the ledger marks it image_missing with the reason, and change.js prints a reminder');
}

// ---- the rules of 16 Nov 2026 (R-0760). Entries that bind no field ("card"), so they stay out of the way above.
fs.appendFileSync(path.join(T, 'ledger', 'register.jsonl'), [
  { id: 'R-0437', status: 'owner', by: 'Cory', decided: '2026-10-03', cards: [], fields: [], topic: 'scope', ruling: 'Every child of a man of the line, once proven from a document we hold.' },
  { id: 'R-0003', status: 'owner', by: 'Cory', decided: '2026-09-10', cards: ['c001', 'c002', 'c003'], fields: ['card'], topic: 'an answer since replaced', ruling: 'Add them.', superseded_by: 'R-0004' },
  { id: 'R-0004', status: 'owner', by: 'Cory', decided: '2026-09-11', cards: ['c002'], fields: ['card'], topic: 'the clerk\'s family', ruling: 'Draw his children; change his note as asked.' },
  { id: 'R-0005', status: 'owner', by: 'Cory', decided: '2026-09-12', cards: ['c003'], fields: ['card'], topic: 'the teacher\'s card', ruling: 'It may come off the tree.' },
].map(x => JSON.stringify(x)).join('\n') + '\n');
const one = e => ({ why: 'test', edits: [e] });

console.log('== a new card: evidence, a decision about that place on the tree, an id of the tool\'s own');
{
  const item = { name: 'Tertia Quillfeather', years: '1905–1980', g: 'f' };
  const add = (o = {}) => one({ op: 'addCard', parent: 'c002', union: 0, item, kind: 'structure', register: 'R-0437', evidence: born, ...o });
  r = change(add({ evidence: undefined }), DRY);
  ok(r.code === 1 && /a new card needs "evidence": the record that proves this child of c002/.test(r.out), 'a new card with no evidence is refused, and the refusal says it is the card that needs it');
  // Cory's word is the register entry; it is not the record. Under kind "owner" his quoted words once stood in for it.
  const told = [{ src: 'owner', quote: 'Add her, please.', opened: today }];
  const pinned = { ...item, pl: [{ k: 'valeton', t: 'birth', c: 'doc', y: 1905 }] };
  r = change(add({ kind: 'owner', item: pinned, evidence: told }), DRY);
  ok(r.code === 1 && /"src": "owner" does not prove a new card/.test(r.out) && /this child of c002/.test(r.out), 'a new card called "owner", with only Cory\'s words as evidence, is refused (a doc-graded pin on it or not)');
  r = change(add({ kind: 'owner', register: 'R-0004', evidence: told }), DRY);
  ok(r.code === 1 && /does not prove a new card/.test(r.out), 'also under his own entry that names the parent');
  r = change(add({ kind: 'owner', register: 'R-0004', evidence: born.concat(told) }), DRY);
  ok(r.code === 1 && /evidence 2: "src": "owner" does not prove a new card/.test(r.out), 'and beside a real record: his words are not evidence for a card');
  r = change(add({ kind: 'owner', register: 'R-0004', item: pinned }), DRY);
  ok(r.code === 0, 'called "owner" with the record as evidence, it goes on');
  r = change(add({ kind: 'source' }), DRY);
  ok(r.code === 0 && /kind "source" on a new card/.test(r.out) && /Say "kind": "structure"/.test(r.out), 'a new card under any other kind is checked the same, and flagged');
  r = change(add({ evidence: [{ src: URL_A, quote: 'a daughter Tertia was born', opened: today }] }), DRY);
  ok(r.code === 1 && /not in our copy/.test(r.out), 'its evidence is checked like a fact\'s: a quote that is not in our copy is refused');
  r = change(add(), DRY);
  ok(r.code === 0 && /brings in 1905, 1980/.test(r.out), 'under the standing yes, a child of a man of the line goes on with evidence (and the years its quotes do not show are flagged)');
  r = change(add({ evidence: [{ src: 'family:2026-09-03-letter-with-scan', quote: 'Wendelin was a clerk at the mill', opened: today }] }), DRY);
  ok(r.code === 0, 'a family paper we hold is evidence for a new card, as for a fact');
  r = change(add({ evidence: [{ src: 'family:2026-09-04-no-such-folder', quote: 'Wendelin was a clerk at the mill', opened: today }] }), DRY);
  ok(r.code === 1 && /no archive\/family\/2026-09-04-no-such-folder/.test(r.out), 'and one we do not hold is not');
  r = change(add({ parent: 'c003' }), DRY);
  ok(r.code === 1 && /c003 is a daughter/.test(r.out), 'the standing yes does not cover a daughter\'s children');
  r = change(add({ register: 'R-0001' }), DRY);
  ok(r.code === 1 && /R-0001 does not name the parent c002/.test(r.out), 'a decision of Cory\'s about another card does not add this one');
  r = change(add({ register: 'R-0004' }), DRY);
  ok(r.code === 0, 'his decision that names the parent does');
  r = change(add({ register: 'R-0003' }), DRY);
  ok(r.code === 1 && /R-0003 was replaced by R-0004/.test(r.out), 'an entry that has been replaced is not a decision in force');
  r = change(add({ item: { ...item, id: 'c001' } }), DRY);
  ok(r.code === 1 && /ids are assigned here/.test(r.out), 'an "id" inside the new card is refused');
  r = change(add({ item: { ...item, unions: [{ s: 'x', c: [{ name: 'A child with no id' }] }] } }), DRY);
  ok(r.code === 1 && /its own addCard/.test(r.out), 'so are children inside it: each card is its own addCard');
  r = change(add({ item: { ...item, src: [{ l: 'A record', u: 'https://example.invalid/never-archived' }] } }), DRY);
  ok(r.code === 1 && /new card cites .*never-archived, which is not in the archive/.test(r.out), 'a source on the new card must be in the archive, as for any added source');
  r = change(add({ item: { ...item, src: [{ l: 'Death notice', u: URL_A, q: 'Tertia was his granddaughter' }] } }), DRY);
  ok(r.code === 1 && /new card's source quote is not in our copy/.test(r.out), 'and its quote in our copy');
  const grand = reg => ({ op: 'addCard', parent: 'c004', union: 0, item: { name: 'Septimus Quillfeather', years: '1930–2001', g: 'm' }, kind: 'structure', register: reg, evidence: born });
  const first = { op: 'addCard', parent: 'c002', union: 0, item: { ...item, unions: [{ s: 'Lucian Fennimore', c: [] }] }, kind: 'structure', register: 'R-0004', evidence: born };
  r = change({ why: 'test', edits: [first, grand('R-0004')] }, DRY);
  ok(r.code === 0, 'one decision can draw two generations in one change set: the second card hangs on the first');
  r = change({ why: 'test', edits: [first, grand('R-0001')] }, DRY);
  ok(r.code === 1 && /R-0001 does not name the parent c004/.test(r.out), 'but not under a different entry');
  r = change(one({ op: 'removeCard', card: 'c003', kind: 'structure', register: 'R-0004' }), DRY);
  ok(r.code === 1 && /R-0004 does not name c003/.test(r.out), 'a card comes off only on a decision that names it');
  r = change(one({ op: 'removeCard', card: 'c003', kind: 'structure', register: 'R-0003' }), DRY);
  ok(r.code === 1 && /replaced by R-0004/.test(r.out), 'and that is still in force');
  r = change(one({ op: 'removeCard', card: 'c003', kind: 'structure', register: 'R-0005' }), DRY);
  ok(r.code === 0, 'with it, the card can be removed');
}

console.log('== each kind of edit keeps to its own fields');
{
  const wed = { card: 'c002', op: 'add', list: 'union', item: { s: 'Delphine Harrowgate', sy: '1884–1961' } };
  r = change(E({ field: 'bio[0]', find: 'with his family', replace: 'with his household', kind: 'source' }), DRY);
  ok(r.code === 1 && /kind "source" is for a card's sources/.test(r.out), 'a "source" edit cannot change a bio');
  r = change(one({ card: 'c002', op: 'add', list: 'pl', item: { k: 'valeton', t: 'residence', c: 'inf', y: 1900 }, kind: 'source' }), DRY);
  ok(r.code === 1 && /A new pin is a fact/.test(r.out), 'or add a pin');
  for (const kind of ['structure', 'wording', 'translation']) {
    r = change(one({ card: 'c002', op: 'add', list: 'src', item: { l: 'Death notice of his father', u: URL_A }, kind }), DRY);
    ok(r.code === 0 && new RegExp(`kind "${kind}" on a new source`).test(r.out) && /Say "kind": "source" next time/.test(r.out), `a source added as "${kind}" is checked as a source and flagged`);
  }
  r = change(one({ card: 'c002', op: 'add', list: 'sources', item: { label: 'A record', url: 'https://example.invalid/never-archived' }, kind: 'structure' }), DRY);
  ok(r.code === 1 && /not in the archive/.test(r.out), 'and still refused when it is not in the archive');
  r = change(one({ card: 'c002', op: 'add', list: 'src', item: { l: 'Death notice of his father', u: URL_A }, kind: 'source' }), DRY);
  ok(r.code === 0 && !/note  /.test(r.out), 'as "source" there is nothing to flag');
  r = change(E({ field: 'src[0].u', from: URL_A, to: 'https://example.invalid/never-archived', kind: 'source' }), DRY);
  ok(r.code === 1 && /never-archived is not in the archive/.test(r.out), 'a source\'s address cannot be changed to one that is not in the archive');
  r = change(E({ field: 'sources[0].url', from: URL_A, to: 'https://example.invalid/never-archived', kind: 'source' }), DRY);
  ok(r.code === 1 && /never-archived is not in the archive/.test(r.out), 'on the bio\'s source list either');
  r = change(E({ field: 'src[0].u', from: URL_A, to: URL_C, kind: 'source' }), DRY);
  ok(r.code === 0, 'to one we hold, it can');
  r = change(one({ card: 'c003', field: 'note', find: 'Teacher', replace: 'Schoolteacher', kind: 'structure' }), DRY);
  ok(r.code === 1 && /kind "structure" is for a card added or removed/.test(r.out), 'a "structure" edit cannot change a note');
  r = change(one({ ...wed, kind: 'structure' }), DRY);
  ok(r.code === 1 && /a new marriage is a change of fact/.test(r.out), 'a marriage added as "structure" with no evidence is refused');
  r = change(one({ ...wed, kind: 'structure', evidence: born }), DRY);
  ok(r.code === 0 && /checked as a fact/.test(r.out), 'with evidence it is checked as the fact it is, and says so');
  r = change(one({ card: 'c002', op: 'add', list: 'bio', item: 'He kept the mill\'s books.', kind: 'wording' }), DRY);
  ok(r.code === 1 && /a new bio paragraph is a change of fact/.test(r.out), 'a paragraph added as "wording" is refused');
  const dup = o => one({ card: 'c003', op: 'remove', list: 'hl', at: 1, from: 'Taught for forty years.', kind: 'structure', ...o });
  r = change(dup(), DRY);
  ok(r.code === 1 && /exact duplicate/.test(r.out), 'a "structure" removal must name the duplicate that stays');
  r = change(dup({ dup_of: 2 }), DRY);
  ok(r.code === 1 && /hl\[2\] is not identical to hl\[1\]/.test(r.out), 'and that item must really be identical');
  r = change(dup({ dup_of: 1 }), DRY);
  ok(r.code === 1, 'an item is not its own duplicate');
  r = change(dup({ dup_of: 0 }), DRY);
  ok(r.code === 0, 'an exact duplicate is removed without evidence');
  r = change(one({ card: 'c003', field: 'name', find: 'Ottoline', replace: 'Ottilia', kind: 'wording' }), DRY);
  ok(r.code === 1 && /the person's name/.test(r.out), 'a "wording" edit cannot change a name');
  r = change(one({ card: 'c003', field: 'union[0].s', find: 'Barnaby', replace: 'Barnabas', kind: 'wording' }), DRY);
  ok(r.code === 1 && /a spouse's name/.test(r.out), 'or a spouse\'s name');
  r = change(E({ field: 'pl[0].k', from: 'valeton', to: 'marrowby', kind: 'wording' }), DRY);
  ok(r.code === 1 && /the place a pin stands on/.test(r.out), 'or the place a pin stands on');
  r = change(one({ card: 'c003', field: 'g', from: 'f', to: 'm', kind: 'wording' }), DRY);
  ok(r.code === 1 && /the person's sex/.test(r.out), 'or the person\'s sex (it decides whose children the standing yes covers)');
  r = change(one({ card: 'c003', field: 'years', from: '1882–1960', to: 'b. 1882–1960', kind: 'wording' }), DRY);
  ok(r.code === 1 && /the person's years/.test(r.out), 'or the years, though no digit changes ("b. …" would make her a living person)');
  r = change(one({ card: 'c003', field: 'years', from: '1882–1960', to: '1882 – 1960', kind: 'wording' }), DRY);
  ok(r.code === 0, 'a dash or a space set right in the years is still wording');
  const own = (o) => one({ card: 'c002', field: 'note_fr', find: 'Commis', replace: 'Commis au moulin', kind: 'owner', ...o });
  r = change(own({ register: 'R-0001' }), DRY);
  ok(r.code === 1 && /R-0001 does not name c002/.test(r.out), 'an "owner" edit must cite a decision of Cory\'s about that card');
  r = change(own({ register: 'R-0003' }), DRY);
  ok(r.code === 1 && /R-0003 was replaced by R-0004/.test(r.out), 'one that is still in force');
  r = change(own({ register: 'R-0004' }), DRY);
  ok(r.code === 0, 'with it, the edit goes through');
  r = change(one({ ...wed, kind: 'owner' }), DRY);
  ok(r.code === 1 && /must cite the register entry/.test(r.out), 'the same holds for an "owner" add');
  r = change(one({ card: 'c003', op: 'remove', list: 'hl', at: 2, from: 'Kept bees.', kind: 'owner', register: 'R-0004' }), DRY);
  ok(r.code === 1 && /R-0004 does not name c003/.test(r.out), 'and for an "owner" removal');
}

console.log('== evidence that is not evidence');
{
  const ev = x => one({ card: 'c003', field: 'note', find: 'Teacher', replace: 'Schoolmistress', kind: 'fact', fr: 'exempt: a test', evidence: [{ src: URL_A, opened: today, ...x }] });
  for (const [x, re, what] of [
    [{ absent: [] }, /"absent" must be a list/, '"absent": [] names no word'],
    [{ absent: [''] }, /"absent" must be a list/, 'an empty word in "absent"'],
    [{ absent: 'Schoolmistress' }, /"absent" must be a list/, '"absent" that is not a list'],
    [{ quote: 'died', opened: 'never' }, /is not a date/, '"opened": "never"'],
    [{ quote: 'died', opened: '2026-02-30' }, /is not a date/, 'a day that does not exist'],
    [{ quote: 'died', opened: '2099-01-01' }, /later than today/, 'a day that has not come'],
    [{ quote: ' ' }, /no letter or digit/, 'a quote of one space'],
    [{ quote: '—' }, /no letter or digit/, 'a quote of one dash'],
  ]) { r = change(ev(x), DRY); ok(r.code === 1 && re.test(r.out), `refused: ${what}`); }
  r = change(ev({ absent: ['Schoolmistress', 'Institutrice'] }), DRY);
  ok(r.code === 0, 'a real "absent" list, checked against our copy, still goes through');
}

console.log('== warnings are kept in the ledger');
{
  r = change(one({ card: 'c003', field: 'note', find: 'Teacher.', replace: 'Teacher at Marrowby.', kind: 'wording' }));
  let rec = records().pop();
  ok(r.code === 0 && /capitalised words differ/.test(r.out) && rec.edits[0].warnings.length === 1 && /capitalised words differ/.test(rec.edits[0].warnings[0]),
    'a place that appears under "wording" is flagged, and the flag is on the edit\'s record');
  r = change(one({ card: 'c003', field: 'years', from: '1882–1960', to: '1883–1960', kind: 'fact', evidence: [{ src: URL_A, quote: 'died', opened: today }] }));
  rec = records().pop();
  ok(r.code === 0 && rec.edits[0].warnings.some(w => /brings in 1883/.test(w)), 'a fact edit whose new year is in none of its quotes is flagged and kept');
  ok(rec.edits[0].warnings.some(w => /only words quoted are "died"/.test(w)), 'so is a quote under 8 characters standing alone');
  r = change(one({ card: 'c003', field: 'note', find: 'Marrowby.', replace: 'Marrowby from 1908.', kind: 'fact', fr: 'exempt: the French note stays short',
    evidence: [{ src: URL_A, quote: 'He came to Valeton in 1908', opened: today }] }));
  rec = records().pop();
  ok(r.code === 0 && rec.edits[0].warnings.length === 1 && /exempt: the French note stays short/.test(rec.edits[0].warnings[0]), '"fr": "exempt" lets English and French differ, and the reason is kept (no figure warning: 1908 is in the quote)');
  r = change(Object.assign(one({ card: 'c002', field: 'note_fr', find: 'Commis.', replace: 'Commis au moulin.', kind: 'translation' }), { research: 'i1 s1' }));
  rec = records().pop();
  ok(r.code === 0 && (rec.warnings || []).some(w => /research ids were not checked/.test(w)) && !rec.edits[0].warnings, 'a warning about the change file as a whole is kept on the change set');
}

console.log('== refusals OPERATING.md promises');
{
  const fact = (o) => E({ kind: 'fact', evidence: born, ...o });
  r = change(fact({ field: 'bio[0]', find: 'i', replace: 'I' }), DRY);
  ok(r.code === 1 && /must occur exactly once/.test(r.out), '"find" that occurs more than once');
  r = change(fact({ field: 'bio[0]', find: 'no such words', replace: 'x' }), DRY);
  ok(r.code === 1 && /occurs 0 times/.test(r.out), '"find" that does not occur');
  r = change(fact({ field: 'years', from: '1850–1921', to: '1850–1922' }), DRY);
  ok(r.code === 1 && /is not what "from" says/.test(r.out), '"from" that is not the current value');
  r = change(E({ field: 'note', find: 'farmer', replace: 'farmer', kind: 'wording' }), DRY);
  ok(r.code === 1 && /changes nothing/.test(r.out), 'an edit that changes nothing');
  r = change(E({ field: 'note', find: 'A farmer', replace: 'A grower', kind: 'translation' }), DRY);
  ok(r.code === 1 && /French field of a pair/.test(r.out), '"translation" on the English field');
  r = change(E({ field: 'pl[0].c', from: 'doc', to: 'inf', kind: 'wording' }), DRY);
  ok(r.code === 1 && /a change of grade is kind "grade"/.test(r.out), 'a grade changed under another kind');
  r = change(E({ field: 'pl[0].c', from: 'doc', to: 'inf', kind: 'grade' }), DRY);
  ok(r.code === 1 && /needs "evidence"/.test(r.out), 'a grade changed with no evidence');
  r = change(E({ field: 'src[0].q', to: 'He never came to Valeton', kind: 'source' }), DRY);
  ok(r.code === 1 && /new quote is not in our copy/.test(r.out), 'a source quote that is not in our copy');
  r = change(E({ field: 'sources[0].label', find: '1920', replace: '1921', kind: 'source' }), DRY);
  ok(r.code === 1 && /a label may claim only what its source says/.test(r.out), 'a label that names a year its source does not contain');
  r = change(E({ op: 'add', list: 'src', item: { l: 'A record', u: 'https://example.invalid/never-archived' }, kind: 'source' }), DRY);
  ok(r.code === 1 && /not in the archive/.test(r.out), 'a new source that is not in the archive');
  r = change(E({ op: 'add', list: 'src', item: { l: 'The notice again', u: URL_A }, kind: 'source' }), DRY);
  ok(r.code === 1 && /already has this item/.test(r.out), 'a source the card already cites');
  r = change(E({ op: 'remove', list: 'src', at: 0, from: { l: 'Another label', u: URL_A }, kind: 'fact', evidence: born }), DRY);
  ok(r.code === 1 && /is not the item in "from"/.test(r.out), 'a removal whose "from" is not the item as it stands');
  r = change(E({ op: 'remove', list: 'src', at: 0, from: { l: 'Death notice', u: URL_A }, kind: 'source' }), DRY);
  ok(r.code === 1 && /needs "evidence"/.test(r.out), 'a source removed with no evidence');
  r = change(E({ field: 'note', find: 'A farmer', replace: 'A grower', kind: 'tidy' }), DRY);
  ok(r.code === 1 && /"kind" must be one of/.test(r.out), 'a kind that does not exist');
  r = change(one({ card: 'c999', field: 'note', find: 'x', replace: 'y', kind: 'wording' }), DRY);
  ok(r.code === 1 && /card "c999" not found/.test(r.out), 'a card that does not exist');
  r = change(one({ card: 'c002', op: 'removeCard', kind: 'structure' }), DRY);
  ok(r.code === 1 && /Cory's decision/.test(r.out), 'a card removed without Cory\'s recorded decision');
  // reopening a settled question is allowed with evidence the ruling did not weigh; it says what to do next
  const fresh = [{ src: 'family:2026-09-03-letter-with-scan', quote: 'Wendelin was a clerk at the mill', opened: today }];
  r = change({ why: 'test', edits: [
    { card: 'c001', field: 'bio[0]', find: '1907', replace: '1909', kind: 'fact', register: 'R-0002', effect: 'reopen', evidence: fresh },
    { card: 'c001', field: 'bio_fr[0]', find: '1907', replace: '1909', kind: 'fact', register: 'R-0002', effect: 'reopen', evidence: fresh }] }, DRY);
  ok(r.code === 0 && /reopens R-0002/.test(r.out), 'a settled question reopened with evidence the ruling did not consider goes through, with a reminder to supersede the entry');
}

console.log('== the gate and the commit hook, on this repo');
{
  // The gate itself, with what it calls stubbed: the site's own suites, the linter, the research check and the
  // public numbers are tested elsewhere. What is tested here is the gate's own work: the chain, the evidence
  // re-check, what it prints about missing images and kept warnings, that it runs this suite, and its stamp.
  const stub = (f, body) => { fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true }); fs.writeFileSync(path.join(T, f), body); };
  const passing = "console.log('7 passed, 0 failed');\n";
  stub('tests/run.js', passing); stub('tests/research.js', passing); stub('tests/ledger.js', passing);
  stub('checks/run.js', "const a = process.argv; require('fs').writeFileSync(a[a.indexOf('--json') + 1], '[]');\n");
  stub('tools/research.js', "module.exports = { load: () => ({ updated: 'test' }), check: () => ({ warnings: [], problems: [] }), claimsFor: () => [], password: () => '' };\n");
  stub('tools/stats.js', "const path = require('path');\nmodule.exports = { OUT: path.join(__dirname, '..', 'stats.json'), KEYS: ['people'], compute: () => ({ people: 3 }) };\n");
  stub('stats.json', '{"people":3,"updated":"test"}\n');
  // the gate's own temp folder, so what it leaves behind can be seen
  const TMP = path.join(T, 'tmp'); fs.mkdirSync(TMP);
  const gate = (...a) => { const g = spawnSync(process.execPath, [path.join(T, 'checks', 'gate.js'), ...a], { cwd: T, env: { ...env, TMPDIR: TMP, TMP, TEMP: TMP }, encoding: 'utf8' }); return { code: g.status, out: (g.stdout || '') + (g.stderr || '') }; };
  const stampFile = path.join(T, '.gate-stamp');
  const iv = () => L.readEnc(fs.readFileSync(path.join(T, 'index.html'), 'utf8')).iv;
  const sets = records().length;

  let g = gate();
  ok(g.code === 1 && /does not carry data\.json/.test(g.out), 'the gate fails while index.html is not the data that was checked');
  encrypt(now());
  g = gate();
  ok(g.code === 0 && new RegExp(`${sets} change set\\(s\\)`).test(g.out), `the gate passes when the ledger explains every difference from the live payload (${sets} change sets)`);
  ok(/1 edit\(s\) rest on an image that is not on file yet/.test(g.out) && /1 with an image still to file/.test(g.out), 'it counts the edits marked image_missing, and names the image');
  ok(/3b\. warnings kept with these edits \(\d+\)/.test(g.out) && /capitalised words differ/.test(g.out) && /brings in 1883/.test(g.out) && /research ids were not checked/.test(g.out),
    'it prints every warning kept with the edits, under their own heading');
  ok(/change loop: 7 passed, 0 failed/.test(g.out), 'it runs the change loop\'s own tests');
  ok(/linter: high 0/.test(g.out) && fs.readdirSync(TMP).length === 0, 'the copies of the data it gave the linter are gone when it ends');
  const stamp = fs.readFileSync(stampFile, 'utf8');
  ok(new RegExp(`^${iv().replace(/[+/]/g, '\\$&')}\\n\\S+ PASS ${sets} change set\\(s\\) \\d+ edit\\(s\\) over origin/main\\n$`).test(stamp), 'the stamp keeps its two lines: the iv, then PASS and the base');
  stub('tests/ledger.js', "console.log('  FAIL a rule\\n6 passed, 1 failed'); process.exit(1);\n");
  g = gate();
  ok(g.code === 1 && /tests\/ledger\.js failed: 6 passed, 1 failed/.test(g.out) && fs.readFileSync(stampFile, 'utf8') === 'FAIL\n', 'and fails, stamp and all, when one of them fails');
  stub('tests/ledger.js', passing);
  const hand = now(); hand.unions[0].c[0].note = 'Clerk!';
  encrypt(hand);
  g = gate();
  ok(g.code === 1 && /no chain of change sets explains/.test(g.out), 'a hand edit, encrypted, does not pass the gate');
  hand.unions[0].c[0].note = 'Mill clerk.';
  encrypt(hand);

  // the real hook, run by git (as tests/research.js runs it)
  fs.mkdirSync(path.join(T, 'githooks'));
  fs.writeFileSync(path.join(T, 'githooks', 'commit-msg'), fs.readFileSync(path.join(SRC, 'githooks', 'commit-msg'), 'utf8').replace(/\r\n/g, '\n'));
  fs.chmodSync(path.join(T, 'githooks', 'commit-msg'), 0o755);
  git('config', 'core.hooksPath', 'githooks');
  const commit = () => { git('add', 'index.html'); const c = spawnSync('git', ['commit', '-qm', 'Update site data payload'], { cwd: T, encoding: 'utf8' }); return { code: c.status, out: (c.stdout || '') + (c.stderr || '') }; };
  let c = commit();
  ok(c.code !== 0 && /has not passed on this payload/.test(c.out), 'the hook refuses a payload the gate has not passed');
  g = gate();
  const good = fs.readFileSync(stampFile, 'utf8');
  fs.writeFileSync(stampFile, good.split('\n')[0] + '\n');
  c = commit();
  ok(g.code === 0 && c.code !== 0 && /does not say PASS over origin\/main/.test(c.out) && /no second line/.test(c.out), 'a stamp that is only the iv, as a hand would write it, is refused');
  fs.writeFileSync(stampFile, good.replace(/ over origin\/main\n$/, ' over HEAD\n'));
  c = commit();
  ok(c.code !== 0 && /does not say PASS over origin\/main/.test(c.out), 'so is a stamp from a gate run against another base');
  fs.writeFileSync(stampFile, good.replace(/ over origin\/main\n$/, ' over queue/site-queue\n'));
  c = commit();
  ok(c.code !== 0 && /no refs\/remotes\/queue\/site-queue/.test(c.out), 'and one that names the queue when this clone has no queue');
  fs.writeFileSync(stampFile, good);
  c = commit();
  ok(c.code === 0, 'the gate\'s own stamp over origin/main lets the commit through' + (c.code ? ' (' + c.out.trim().split('\n').slice(0, 3).join(' ') + ')' : ''));
  // the audit's route: once a payload is in HEAD, --base=HEAD passes with nothing to explain
  encrypt(now());
  g = gate('--base=HEAD');
  c = commit();
  ok(g.code === 0 && /0 change set\(s\)/.test(g.out) && /the commit hook will not take its stamp/.test(g.out) && c.code !== 0, 'a pass over HEAD explains nothing: the gate says its stamp will not do, and the hook refuses it');
  git('update-ref', 'refs/remotes/queue/site-queue', 'HEAD');
  g = gate('--base=queue/site-queue');
  c = commit();
  ok(g.code === 0 && c.code === 0, 'a pass over the queue\'s head is taken when the queue is fetched here');
  git('config', '--unset', 'core.hooksPath');
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
