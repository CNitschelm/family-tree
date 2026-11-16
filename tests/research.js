#!/usr/bin/env node
'use strict';
/*
 * Tests for the tools behind the Research view (3 Oct 2026).
 *
 *   node tests/research.js
 *
 *   tools/research.js    its tier rule is the page's; validation, and the privacy rules on every string the
 *                        family can read; Cory's Decide buttons (dec and decide: 3 Oct 2026, register R-0445);
 *                        the gate's check that a change set's research items really were
 *                        updated (claimsFor); matching people to cards (link); the sealed files carry the
 *                        family's copy and nothing more, byte for byte the same when nothing they show changed;
 *                        where our copy of each read is (`_copy`, 16 Nov 2026, register R-0759): private, checked
 *                        against the source archive, and asked for before a source is found, none or done;
 *                        show <investigation> prints each source's newest log entries only; every command
 *                        that writes needs the writer lock, held by FT_WHO, and never in a read-only session;
 *                        a save through a link goes to the link's target and leaves the link in place
 *   githooks/commit-msg  §0c: the two research files are committed only as research.js built them, and never
 *                        committed as deleted
 *   tools/crypt.js       a file that a page browsers may still hold uses (the live one, origin/main, or the
 *                        last commit) is never moved out of media/; if it cannot tell, it moves nothing
 *
 * Zero dependencies; a throwaway repo in a temp folder; invented people and research only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'research-test-'));
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { failN++; console.log('  FAIL ' + m); } };
const section = t => console.log('\n== ' + t);

/* a throwaway repo with the real tools in it */
fs.mkdirSync(path.join(T, 'tools')); fs.mkdirSync(path.join(T, 'githooks')); fs.mkdirSync(path.join(T, 'ledger'));
for (const f of ['tools/research.js', 'tools/payload.js', 'tools/crypt.js', 'tools/check-commit-msg.js', 'tools/ledger.js'])
  fs.copyFileSync(path.join(SRC, f), path.join(T, f));
/* the hook as sh reads it: a checkout with Windows line endings must not fail the test for that alone */
fs.writeFileSync(path.join(T, 'githooks', 'commit-msg'), fs.readFileSync(path.join(SRC, 'githooks', 'commit-msg'), 'utf8').replace(/\r\n/g, '\n'));
/* an invented source archive beside it; FT_ARCHIVE too, or a cloud shell's ~/.ft-env would point the tools at the real one */
const ARCH = path.join(T, 'sources');
fs.mkdirSync(path.join(ARCH, 'archive', 'hand'), { recursive: true });
fs.writeFileSync(path.join(ARCH, 'archive', 'hand', 'booklet-pages.md'), 'Pages 1 to 4 read. No miller is named.\n');
fs.writeFileSync(path.join(ARCH, 'archive', 'hand', 'booklet-p3.jpg'), 'an invented image');
fs.writeFileSync(path.join(T, 'outside.txt'), 'not in the archive');
/* the writer lock, held by this test: research.js writes only under it. FT_LEDGER too, for the same reason as FT_ARCHIVE */
const WHO = 'research-test';
const lock = (who, hoursAgo) => fs.writeFileSync(path.join(T, 'ledger', 'LOCK'), who ? JSON.stringify({ who, what: 'a test', since: new Date(Date.now() - (hoursAgo || 0) * 3600e3).toISOString() }) + '\n' : 'free\n');
lock(WHO);
const env = { ...process.env, FT_ROOT: T, FT_RESEARCH: path.join(T, 'research.json'), FT_ARCHIVE: ARCH, FT_LEDGER: path.join(T, 'ledger'), FT_WHO: WHO };
delete env.FT_PASSWORD; delete env.FT_READONLY;
const RJ = require(path.join(T, 'tools', 'research.js'));
const P = require(path.join(T, 'tools', 'payload.js'));
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');
git('config', 'core.autocrlf', 'false');

/* invented research: one topic, two investigations, a visit list */
const research = () => ({
  schema: 1, updated: '2026-10-01',
  themes: [{ id: 't1', name: 'The mill years', name_fr: 'Les années du moulin', blurb: 'Who ran the mill.', blurb_fr: 'Qui tenait le moulin.', icon: 'M12 3v18M3 12h18' }],
  visits: { v1: { name: 'Valeton mill museum', name_fr: 'Musée du moulin de Valeton', access: 'On Saturdays.', access_fr: 'Le samedi.', who: 'A neighbour', who_fr: 'Une voisine', st: 'visit', since: '2026-09-20' } },
  investigations: [
    { id: 'i1', theme: 't1', title: 'Who first ran the mill?', title_fr: 'Qui a tenu le moulin en premier ?', next: 'Read the ledger.', next_fr: 'Lire le registre.',
      summary: 'A family story.', summary_fr: 'Une histoire de famille.', updated: '2026-10-01', imp: 2,
      people: [{ card: 'c001', n: 'Probus Quillfeather', y: '1850–1920' }],
      qs: [{ q: 'Does the ledger name him?', q_fr: 'Le registre le nomme-t-il ?', state: 'open', src: [
        { id: 's1', t: 'The first ledger', t_fr: 'Le premier registre', st: 'visit', visit: 'v1', who: 'A neighbour', who_fr: 'Une voisine', since: '2026-09-20' },
        { id: 's2', t: 'A booklet', t_fr: 'Une brochure', st: 'ready', who: 'Cory, online', who_fr: 'Cory, en ligne', since: '2026-09-20' }] }] },
    { id: 'i2', theme: 't1', title: 'The millstone', title_fr: 'La meule', next: 'Look at it.', next_fr: 'La regarder.', summary: 'A carved year.', summary_fr: 'Une année gravée.',
      updated: '2026-10-01', imp: 1,
      qs: [{ q: 'What year?', q_fr: 'Quelle année ?', state: 'answered', note: 'Found.', note_fr: 'Trouvée.', src: [{ id: 's3', t: 'The stone', t_fr: 'La meule', st: 'found', since: '2026-09-21' }] }] }
  ]
});
const errs = R => RJ.validate(R, { cards: null, quiet: true }).errors;

// ------------------------------------------------------------------ the tier rule
section('the tier rule is the page\'s');
{
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const closed = html.match(/const R_CLOSED = new Set\(\[[^\]]*\]\);/), fn = html.match(/function resTier\(s\)\{[\s\S]*?\n\}/);
  ok(!!(closed && fn), 'the page has its tier rule (resTier)');
  if (closed && fn) {
    const pageTier = vm.runInNewContext(closed[0] + '\n' + fn[0] + '\nresTier');
    let same = 0, all = 0;
    for (const st of RJ.STATUSES) for (const by of [undefined, ...RJ.TIERS]) for (const who of [undefined, 'Cory, online', 'Us, online', 'Cory', 'A cousin']) {
      const s = { st, by, who }; all++;
      if (pageTier(s) === RJ.tierOf(s)) same++;
    }
    ok(same === all, 'tools/research.js and the page put every source in the same tier (' + same + ' of ' + all + ')');
  }
}

// ------------------------------------------------------------------ validation
section('validation');
{
  ok(errs(research()).length === 0, 'the invented research is valid (' + errs(research()).join('; ') + ')');
  const bad = (what, f, re) => { const R = research(); f(R); const e = errs(R); ok(e.some(x => re.test(x)), what + (e.length ? '' : ' (no error)')); };
  bad('a title with no French is refused', R => { delete R.investigations[0].title_fr; }, /title has no French/);
  bad('an unknown status is refused', R => { R.investigations[0].qs[0].src[0].st = 'maybe'; }, /unknown status/);
  bad('a tier override that is not a tier is refused', R => { R.investigations[0].qs[0].src[0].by = 'everyone'; }, /by must be one of/);
  bad('a source naming a visit list that does not exist is refused', R => { R.investigations[0].qs[0].src[0].visit = 'v9'; }, /visit v9 does not exist/);
  bad('a date in the future is refused', R => { R.investigations[0].qs[0].src[1].since = '2999-01-01'; }, /in the future/);
  bad('an id used twice is refused', R => { R.investigations[1].qs[0].src[0].id = 's1'; }, /used twice/);
  bad('open sources need an impact', R => { R.investigations[0].imp = 0; }, /imp must be 1–3/);
  bad('a topic icon that is not an SVG path is refused', R => { R.themes[0].icon = '"/><script>alert(1)</script>'; }, /icon must be an SVG path/);
  bad('a _touched that is not a time is refused', R => { R.investigations[0]._touched = 'yesterday'; }, /_touched must be a time/);
  /* a visit list's places and priorities (one person's archive visits, 5 Oct 2026) */
  { const R = research(); Object.assign(R.investigations[0].qs[0].src[0], { pri: 'A', pos: 1 }); ok(errs(R).length === 0, 'a priority and a place on its visit list are valid (' + errs(R).join('; ') + ')'); }
  bad('a priority other than A, B or C is refused', R => { R.investigations[0].qs[0].src[0].pri = 'D'; }, /pri must be A/);
  bad('a place that is not a whole number is refused', R => { R.investigations[0].qs[0].src[0].pos = '1'; }, /pos must be/);
  bad('a priority on a source in no visit list is refused', R => { R.investigations[0].qs[0].src[1].pri = 'A'; }, /on none/);
  bad('two items in one place on a visit list are refused', R => { const I = R.investigations; I[0].qs[0].src[0].pos = 1; Object.assign(I[1].qs[0].src[0], { visit: 'v1', pos: 1 }); }, /is taken by/);
  { const R = research(); Object.assign(R.investigations[0].qs[0].src[1], { who: 'Us, online', who_fr: 'Nous, en ligne' }); const v = RJ.validate(R, { cards: null, quiet: true });
    ok(!v.errors.length && v.warnings.some(w => /say "Cory, online"/.test(w)), 'the old "Us, online" draws a warning: everyone with the password reads it'); }
}

// ------------------------------------------------------------------ privacy
section('privacy rules, on every string the family can read');
{
  const flagged = s => { const R = research(); R.investigations[0].summary = s; return errs(R).some(e => /carries/.test(e)); };
  const BAD = ['b. 12 March 1950', 'né le 12 mars 1950', 'née le 1er janv. 1950', 'born March 12, 1950', 'born in March 1950', 'born 1950-03-12',
    'born 12/03/1950', 'born 1950/03/12', 'born 12-Mar-1950', 'born in St. Odo on 12 March 1950', 'Quillon (12 March 1950 – )',
    'naissance : 3 févr. 1961', 'born 4 juil. 1972', 'born 9 déc. 1981', 'né le 2 avr. 1975',
    'geb. 12.03.1950', 'geboren 12 maart 1950', 'geboren 3 mei 1962', 'geb. 12. März 1950', '* 12.03.1950',
    '123 Main Street', '42 Elm St', '12 rue des Lilas', '3, place du Lavoir', 'Brinstraat 12', '12 Odostraat',
    '(603) 555-1234', '603-555-1234', '0612345678', '06 12 34 56 78', '+33 6 12 34 56 78',
    'write to x@example.invalid', 'see https://example.invalid/a', 'see www.example.invalid', 'we could nudge him'];
  const GOOD = ['1885 street directory', 'the 1602 tax roll', 'Proven on 2 October 2026', 'born 1950', 'b. 1950', 'born c. 1602', 'né vers 1610',
    'born in Valeton. On 12 March 1950 the mill closed', 'a death on 12 March 1985', 'the 1911 printed list', 'boxes 4 E 123 and 4 E 124',
    '1840–1849', 'the 1907 County Court records', 'Ne pas confondre avec le 12 mars 1950',
    'née Quillfeather died 14 May 1987', 'née Brambleworth, décédée le 3 mars 1985', 'nee Quillfeather, buried 2 May 1990',
    'born 1928, died 3 March 1990', 'born in Valeton, married 3 June 1950', 'born at sea; landed 3 June 1950',
    'baptised 1726, Valeton St. Odo', '1880 Census St. Odo', 'recensement de 1836 rue des Tanneurs', 'Valetondijk 1802', 'Quillgracht 1660s'];
  const missed = BAD.filter(s => !flagged(s)), wrong = GOOD.filter(flagged);
  ok(!missed.length, 'catches birth dates, street addresses, phone numbers, emails, links and handling notes' + (missed.length ? ' — missed: ' + missed.join(' | ') : ''));
  ok(!wrong.length, 'and leaves years, archive references and event dates alone' + (wrong.length ? ' — flagged: ' + wrong.join(' | ') : ''));
  /* a key the old list did not name is still checked (add-source takes any JSON) */
  { const R = research(); R.investigations[0].qs[0].src[0].contact = 'someone@example.invalid'; ok(errs(R).some(e => /s1\.contact: carries an email/.test(e) || /contact.*carries an email/.test(e)), 'a field nobody planned for is checked too'); }
  { const R = research(); R.visits.v1.notes = ['call (603) 555-1234']; ok(errs(R).some(e => /carries a phone number/.test(e)), 'so is a string inside a list'); }
  { const R = research(); R.investigations[0]._notes = 'call (603) 555-1234'; ok(!errs(R).some(e => /carries/.test(e)), 'private notes ("_…") are not the family\'s, so they are not held to it'); }
  /* the do-not-publish list, whatever the case */
  fs.writeFileSync(path.join(T, 'ledger', 'research-deny.txt'), '# names researched but never to be published\nWendelin Brambleworth\nOttilie\n');
  const denied = s => { const R = research(); R.investigations[0].next = s; return errs(R).some(e => /do-not-publish/.test(e)); };
  ok(denied('Ask Wendelin Brambleworth.') && denied('ask WENDELIN BRAMBLEWORTH') && denied('ask ottilie'), 'the do-not-publish list matches whatever the case');
  ok(!denied('Ottilies are not people') && !denied('Wendelin alone'), 'and only whole names');
  fs.rmSync(path.join(T, 'ledger', 'research-deny.txt'));
}

// ------------------------------------------------------------------ claims
section('a change set\'s research items must really have been updated');
{
  const run = (...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), ...a], { cwd: T, env, encoding: 'utf8' });
  const load = () => JSON.parse(fs.readFileSync(path.join(T, 'research.json'), 'utf8'));
  const cs = (research, at) => ({ id: 'cs1', at: at || new Date().toISOString(), research });
  fs.writeFileSync(path.join(T, 'research.json'), JSON.stringify(research(), null, 1));
  let r = run('log', 's1', 'The neighbour went.', 'La voisine y est allée.', '--date', '2026-09-25');
  ok(r.status === 0, 'log, back-dated to when it happened (' + (r.stderr || '').trim().split('\n')[0] + ')');
  let R = load();
  ok(R.investigations[0].qs[0].src[0].log[0][0] === '2026-09-25', 'the log line carries the date it happened');
  const t1 = Date.parse(R.investigations[0].qs[0].src[0]._touched);
  ok(Math.abs(Date.now() - t1) < 120e3, 'and _touched the real time of the edit (' + R.investigations[0].qs[0].src[0]._touched + ')');
  ok(RJ.claimsFor(R, [cs('s1')]).length === 0, 'so a change set today that says it moves s1 passes, back-dated log or not');
  ok(RJ.claimsFor(R, [cs('i1')]).length === 0, 'and one that says it moves its investigation');
  ok(RJ.claimsFor(R, [cs('s2')]).length === 1, 'but not one for s2: an edit to s1 does not move every source in i1');
  ok(RJ.claimsFor(R, [cs('s1', new Date(Date.now() + 2 * 864e5).toISOString())]).length === 1, 'an edit two days before the change set does not count');
  ok(RJ.claimsFor(R, [cs('s1', new Date(Date.now() + 12 * 3600e3).toISOString())]).length === 0, 'one twelve hours before does (a session can cross midnight)');
  r = run('set', 'v1', 'next=The neighbour goes on Saturday.', 'next_fr=La voisine y va samedi.');
  R = load();
  ok(r.status === 0 && RJ.claimsFor(R, [cs('v1')]).length === 0, 'set on a visit list counts as moving it');
  r = run('set', 's1', 'pri=A', 'pos=2');
  R = load();
  ok(r.status === 0 && R.investigations[0].qs[0].src[0].pri === 'A' && R.investigations[0].qs[0].src[0].pos === 2, 'set takes a priority, and a place on the visit list as a number');
  ok(run('set', 's1', 'pos=two').status !== 0 && load().investigations[0].qs[0].src[0].pos === 2, 'and refuses a place that is not one');
  r = run('set', 'v1', 'access=On Saturday mornings.', 'access_fr=Le samedi matin.');
  ok(r.status === 0 && load().visits.v1.access === 'On Saturday mornings.', 'set changes how a visit list is reached (access)');
  ok(RJ.claimsFor(R, [cs('s9')]).some(m => /not in research\.json/.test(m)), 'an id that does not exist is named');
  ok(RJ.claimsFor(R, [cs('none: only a wording fix')]).length === 0, '"none: <why>" claims nothing');
  /* an item edited by hand has no _touched: its own dates count, not its investigation's */
  { const H = research(); H.investigations[0].updated = new Date().toISOString().slice(0, 10);
    ok(RJ.claimsFor(H, [cs('s2')]).length === 1 && RJ.claimsFor(H, [cs('i1')]).length === 0, 'by hand: the investigation\'s date moves the investigation, not its sources'); }
  /* the family never sees _touched, and it never changes the sealed bytes */
  ok(!JSON.stringify(RJ.publicCopy(R)).includes('_touched'), '_touched stays out of the family\'s copy');
}

// ------------------------------------------------------------------ Cory's Decide buttons (3 Oct 2026, register R-0445)
section('Cory\'s Decide buttons: dec and decide');
{
  const PAGE = 'https://claude.ai/artifact/TestDecisionsPage1';
  const D = () => { const R = research(); R.decide = PAGE; R.visits.v1.dec = 'm1'; R.investigations[0].dec = 'd6'; R.investigations[0].qs[0].src[1].dec = 'bz1'; return R; };
  ok(errs(D()).length === 0, 'a decisions page address, and card ids on an investigation, a source and a visit list, are valid (' + errs(D()).join('; ') + ')');
  const bad = (what, f, re) => { const R = D(); f(R); const e = errs(R); ok(e.some(x => re.test(x)), what + (e.length ? '' : ' (no error)')); };
  bad('an address that is not a claude.ai page is refused', R => { R.decide = 'https://example.invalid/page'; }, /decide must be/);
  bad('two card ids in one dec are refused', R => { R.investigations[0].qs[0].src[1].dec = 'bz1 lv1'; }, /s2: dec must be one decision card id/);
  bad('markup in a visit list\'s dec is refused', R => { R.visits.v1.dec = '<b>'; }, /v1: dec must be/);
  bad('and in an investigation\'s', R => { R.investigations[0].dec = 'D6'; }, /i1: dec must be/);
  { const R = D(); delete R.decide; const v = RJ.validate(R, { cards: null, quiet: true });
    ok(!v.errors.length && v.warnings.some(w => /no decide address/.test(w)), 'card ids but no address: a warning (no button can show), not an error'); }
  ok(!errs(D()).some(e => /web address/.test(e)), 'the address is not read as prose (it is pinned to a claude.ai page instead)');
  const pc = RJ.publicCopy(D());
  ok(pc.decide === PAGE && pc.visits.v1.dec === 'm1' && pc.investigations[0].dec === 'd6', 'both reach the family\'s copy, which the page reads');
  /* the commands */
  const run = (...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), ...a], { cwd: T, env, encoding: 'utf8' });
  const load = () => JSON.parse(fs.readFileSync(path.join(T, 'research.json'), 'utf8'));
  fs.writeFileSync(path.join(T, 'research.json'), JSON.stringify(research(), null, 1));
  let r = run('decide', PAGE);
  ok(r.status === 0 && load().decide === PAGE, 'decide <address> sets it' + (r.status ? ' (' + r.stderr.trim().split('\n')[0] + ')' : ''));
  r = run('decide', 'http://claude.ai/artifact/x');
  ok(r.status !== 0 && /decide must be/.test(r.stderr) && load().decide === PAGE, 'a wrong address is refused and nothing is written');
  r = run('set', 's2', 'dec=bz1');
  ok(r.status === 0 && load().investigations[0].qs[0].src[1].dec === 'bz1', 'set <source> dec=<card>');
  r = run('set', 'v1', 'dec=m1');
  ok(r.status === 0 && load().visits.v1.dec === 'm1', 'set <visit list> dec=<card>');
  r = run('inv', 'i1', 'dec=d6');
  ok(r.status === 0 && load().investigations[0].dec === 'd6', 'inv <investigation> dec=<card>');
  r = run('set', 's2', 'dec=');
  ok(r.status === 0 && !('dec' in load().investigations[0].qs[0].src[1]), 'dec= clears it on a source');
  r = run('inv', 'i1', 'dec=');
  ok(r.status === 0 && !('dec' in load().investigations[0]), 'and on an investigation');
  r = run('decide', '');
  ok(r.status === 0 && !('decide' in load()), 'decide "" removes the address');
}

// ------------------------------------------------------------------ where our copy is (16 Nov 2026, register R-0759)
section('every read records where our copy is');
{
  const run = (...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), ...a], { cwd: T, env, encoding: 'utf8' });
  const load = () => JSON.parse(fs.readFileSync(path.join(T, 'research.json'), 'utf8'));
  const src = id => RJ.find(load(), id).s;
  const said = r => (r.stdout + r.stderr).replace(/\s+/g, ' ');
  fs.writeFileSync(path.join(T, 'research.json'), JSON.stringify(research(), null, 1));
  /* the form of the field */
  const shape = (v, re) => { const R = research(); R.investigations[0].qs[0].src[1]._copy = v; const e = errs(R); return re ? e.some(x => re.test(x)) : !e.length; };
  ok(shape(['archive/hand/booklet-pages.md']) && shape('none: the reading room keeps no copies'), 'a list of archive paths, or "none: <why>", is valid');
  ok(shape([], /s2\._copy must be a list/) && shape('none: too short', /s2\._copy must be .*12 characters/) && shape('somewhere', /s2\._copy must be/) &&
    shape(['/etc/passwd'], /not a path inside the source archive/) && shape(['archive/../../x'], /not a path inside/) && shape(['a', 'a'], /twice/),
    'an empty list, a short or missing why, a path out of the archive and a path given twice are refused');
  /* closing a source needs it */
  let r = run('set', 's2', 'st=none');
  ok(r.status !== 0 && /node tools\/research\.js copy s2 <archive path>/.test(said(r)) && /node tools\/research\.js copy s2 "none: <why>"/.test(said(r)) && src('s2').st === 'ready',
    'set st=none on a source with no copy is refused, nothing is written, and the message gives the copy command');
  ok(run('set', 's2', 'st=found').status !== 0 && run('set', 's2', 'st=done').status !== 0 && src('s2').st === 'ready', 'so are found and done');
  ok(run('set', 's2', 'st=wait', 'who=A neighbour', 'who_fr=Une voisine').status === 0 && src('s2').st === 'wait', 'a state that does not say it was read needs none');
  /* recording it */
  r = run('copy', 's2', 'archive/hand/not-there.md');
  ok(r.status !== 0 && /is not in the source archive/.test(said(r)) && /File the copy there first/.test(said(r)) && src('s2')._copy === undefined, 'a path that is not in the archive is refused, with what to do');
  r = run('copy', 's2', '../outside.txt');
  ok(r.status !== 0 && /outside the source archive/.test(said(r)) && src('s2')._copy === undefined, 'so is a file that exists but lies outside it');
  const before = load();
  r = run('copy', 's2', 'archive/hand/booklet-pages.md');
  ok(r.status === 0 && JSON.stringify(src('s2')._copy) === '["archive/hand/booklet-pages.md"]', 'copy <source> <archive path> records it (' + said(r).slice(0, 80) + ')');
  ok(Math.abs(Date.now() - Date.parse(src('s2')._touched)) < 120e3 && RJ.claimsFor(load(), [{ id: 'cs1', at: new Date().toISOString(), research: 's2' }]).length === 0, 'and counts as moving the source (_touched)');
  ok(JSON.stringify(RJ.publicCopy(load())) === JSON.stringify(RJ.publicCopy(before)), 'the family\'s copy does not change at all: no date moves for a private note');
  r = run('copy', 's2', path.join(ARCH, 'archive', 'hand', 'booklet-p3.jpg'), 'archive/hand/booklet-pages.md');
  ok(r.status === 0 && JSON.stringify(src('s2')._copy) === '["archive/hand/booklet-pages.md","archive/hand/booklet-p3.jpg"]', 'a second copy is added to the list (a full path inside the archive is stored from its root; one already there is not doubled)');
  ok(run('copy', 's2', 'archive/hand').status === 0 && src('s2')._copy.length === 3, 'a folder of the archive is a copy too');
  r = run('copy', 's2', 'none: the page showed nothing to keep');
  ok(r.status !== 0 && /already records 3 copies/.test(said(r)) && /--replace/.test(said(r)) && Array.isArray(src('s2')._copy), 'a source with copies cannot also say none');
  ok(run('copy', 's2', 'none: no').status !== 0 && run('copy', 's2', 'none:').status !== 0 && run('copy', 's2').status !== 0 && run('copy', 'i1', 'archive/hand').status !== 0 && run('copy', 's2', 'archive/hand', 'none: nothing was there to keep').status !== 0,
    'a short why, no path, an investigation id, and paths mixed with none are refused');
  r = run('copy', 's2', 'archive/hand/booklet-pages.md', '--replace');
  ok(r.status === 0 && JSON.stringify(src('s2')._copy) === '["archive/hand/booklet-pages.md"]', '--replace starts the list again');
  r = run('set', 's2', '_copy=archive/hand');
  ok(r.status !== 0 && /node tools\/research\.js copy s2/.test(said(r)), 'set does not take the field: it points to copy');
  r = run('set', 's2', 'st=none');
  ok(r.status === 0 && src('s2').st === 'none', 'with its copy on record the source can be set to none' + (r.status ? ' (' + said(r).slice(0, 200) + ')' : ''));
  r = run('copy', 's1', 'none: the ledger may not be photographed');
  ok(r.status === 0 && src('s1')._copy === 'none: the ledger may not be photographed' && run('set', 's1', 'st=found').status === 0, '"none: <why>" is a record too, and lets the source close');
  ok(run('copy', 's1', 'archive/hand/booklet-p3.jpg').status === 0 && JSON.stringify(src('s1')._copy) === '["archive/hand/booklet-p3.jpg"]', 'a copy filed later takes the place of "none"');
  /* the sources closed before the rule are not refused, only counted */
  ok(src('s3')._copy === undefined && run('set', 's3', 'st=done').status === 0 && src('s3').st === 'done', 'a source that was already found may move to done without one');
  r = run('validate');
  const notes = r.stdout.split('\n').filter(l => /^\s+NOTE\s/.test(l));
  ok(r.status === 0 && notes.filter(l => /copy on record/.test(l)).length === 1 && /NOTE\s+1 of 3 consulted sources/.test(r.stdout) && /node tools\/research\.js copy <source>/.test(r.stdout),
    'validate says how many consulted sources have no copy, in one line (' + notes.length + ' NOTE line(s))');
  r = run('status');
  ok(r.status === 0 && (r.stdout.match(/copy on record/g) || []).length === 1 && /Our copies: 1 of 3 consulted sources/.test(r.stdout), 'status shows the count once');
  r = run('log', 's3', 'Looked at again.', 'Regardée de nouveau.');
  ok(r.status === 0 && !/NOTE/.test(r.stdout), 'and no other command repeats it');
  /* a recorded copy that has since left the archive */
  fs.renameSync(path.join(ARCH, 'archive', 'hand', 'booklet-p3.jpg'), path.join(ARCH, 'archive', 'hand', 'moved.jpg'));
  r = run('validate');
  ok(r.status === 0 && /NOTE\s+1 source\(s\) record a copy that is not in the source archive now \(s1\)/.test(r.stdout), 'validate counts recorded copies that are no longer in the archive (a note, not an error)');
  ok(RJ.validate(load(), { cards: null, quiet: true, archive: path.join(T, 'no-archive-here') }).notes.every(n => !/not in the source archive/.test(n)), 'where there is no archive to ask, it says nothing about them');
  fs.renameSync(path.join(ARCH, 'archive', 'hand', 'moved.jpg'), path.join(ARCH, 'archive', 'hand', 'booklet-p3.jpg'));
  /* a source that arrives as JSON */
  const S = more => JSON.stringify(Object.assign({ t: 'The parish list', t_fr: 'La liste paroissiale', st: 'none' }, more));
  r = run('add-source', 'i1', '1', S({}));
  ok(r.status !== 0 && /"_copy"/.test(said(r)) && load().investigations[0].qs[0].src.length === 2, 'add-source refuses a source that arrives already consulted with no copy');
  r = run('add-source', 'i1', '1', S({ _copy: ['archive/hand/not-there.md'] }));
  ok(r.status !== 0 && /is not in the source archive/.test(said(r)) && load().investigations[0].qs[0].src.length === 2, 'and one whose copy is not in the archive');
  r = run('add-source', 'i1', '1', S({ _copy: ['archive/hand/booklet-pages.md'] }));
  ok(r.status === 0 && load().investigations[0].qs[0].src.length === 3, 'with its copy it goes in');
  r = run('add-question', 'i1', JSON.stringify({ q: 'And the second mill?', q_fr: 'Et le second moulin ?', state: 'open', src: [JSON.parse(S({}))] }));
  ok(r.status !== 0 && load().investigations[0].qs.length === 1, 'add-question holds its sources to the same');
  /* never the family's */
  const R = load();
  ok(JSON.stringify(R).includes('_copy') && !JSON.stringify(RJ.publicCopy(R)).includes('_copy') && !JSON.stringify(RJ.publicCopy(R)).includes('booklet-pages'), '_copy and its paths stay out of the family\'s copy');
}

// ------------------------------------------------------------------ show, and log entries written for their reader
section('show <investigation> prints the newest log entries; long entries and card ids draw a note');
{
  const run = (...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), ...a], { cwd: T, env, encoding: 'utf8' });
  const R0 = research();
  R0.investigations[0].qs[0].src[0].log = [1, 2, 3, 4, 5].map(n => ['2026-09-2' + n, 'Entry ' + n + '.', 'Entrée ' + n + '.']);
  R0.investigations[0].qs[0].src[1].log = [['2026-09-21', 'Only one.', 'Une seule.']];
  fs.writeFileSync(path.join(T, 'research.json'), JSON.stringify(R0, null, 1));
  const logs = o => o.qs[0].src.map(s => s.log);
  const noLogs = o => JSON.stringify(Object.assign({}, o, { qs: o.qs.map(q => Object.assign({}, q, { src: q.src.map(s => Object.assign({}, s, { log: 0 })) })) }));
  let r = run('show', 'i1'), o = JSON.parse(r.stdout);
  ok(r.status === 0 && logs(o)[0].length === 4 && logs(o)[0][0] === '… 2 earlier entries: add --log all (or --log <n>)' && logs(o)[0].slice(1).map(e => e[1]).join(' ') === 'Entry 3. Entry 4. Entry 5.',
    'each source shows its newest 3 entries, and a line that says how many came before and how to see them');
  ok(logs(o)[1].length === 1 && logs(o)[1][0][1] === 'Only one.', 'a source with 3 entries or fewer is shown as it is');
  ok(noLogs(o) === noLogs(R0.investigations[0]), 'everything else in the output is unchanged');
  r = run('show', 'i1', '--log', 'all'); o = JSON.parse(r.stdout);
  ok(r.status === 0 && JSON.stringify(o) === JSON.stringify(R0.investigations[0]), '--log all prints the investigation in full');
  r = run('show', 'i1', '--log', '4'); o = JSON.parse(r.stdout);
  ok(logs(o)[0].length === 5 && logs(o)[0][0] === '… 1 earlier entry: add --log all (or --log <n>)', '--log <n> prints that many');
  r = run('show', 'i1', '--log', '0'); o = JSON.parse(r.stdout);
  ok(logs(o)[0].length === 1 && /^… 5 earlier entries/.test(logs(o)[0][0]), '--log 0 prints none, only the count');
  ok(run('show', 'i1', '--log', 'some').status !== 0 && run('show', 'i1', '--log').status !== 0, '--log with anything else is refused');
  r = run('show', 's1'); o = JSON.parse(r.stdout);
  ok(r.status === 0 && o.log.length === 5 && o.investigation === 'i1', 'show <source> prints that source in full');
  ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(T, 'research.json'), 'utf8'))) === JSON.stringify(R0), 'show changes nothing in the file');
  /* entries are for the family: accepted, with a note */
  const long = n => 'x'.repeat(n);
  r = run('log', 's2', long(600), long(600));
  ok(r.status === 0 && !/NOTE/.test(r.stdout), 'a log entry of 600 characters draws no note');
  r = run('log', 's2', long(601), 'Court.');
  ok(r.status === 0 && /NOTE\s+this log entry is 601 characters/.test(r.stdout) && /run notes/.test(r.stdout) && RJ.find(JSON.parse(fs.readFileSync(path.join(T, 'research.json'), 'utf8')), 's2').s.log.length === 3,
    'one of 601 is accepted, with a note asking for the detail to go in the run notes');
  r = run('log', 's2', 'Read for go12; ergo12 and gogo3 are words.', 'Lu pour go12.');
  ok(r.status === 0 && /NOTE\s+this log entry names a decision card or item/.test(r.stdout), 'an entry that names a decision card is accepted, with a note');
  run('log', 'v1', 'The item yc34 is done (rq5).', 'L\'élément yc34 est fait (rq5).');
  run('log', 's1', 'The cargo12 of logo7 came, ago3.', 'Rien sur un algo12.');
  r = run('validate');
  ok(r.status === 0 && r.stdout.split('\n').filter(l => /decision card or item/.test(l)).length === 1 && /NOTE\s+2 log entries the family reads name a decision card or item/.test(r.stdout),
    'validate counts the family-visible log entries that name one, as whole words, in one line');
}

// ------------------------------------------------------------------ one writer (16 Nov 2026)
section('every command that writes needs the writer lock');
{
  const runAs = (e, ...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), ...a], { cwd: T, env: Object.assign({}, env, e), encoding: 'utf8' });
  const run = (...a) => runAs({}, ...a);
  const said = r => (r.stdout + r.stderr).replace(/\s+/g, ' ');
  const file = path.join(T, 'research.json');
  fs.writeFileSync(file, JSON.stringify(research(), null, 1));
  const text = () => fs.readFileSync(file, 'utf8'), start = text();
  const LOG = ['log', 's1', 'The neighbour went.', 'La voisine y est allée.'];
  const refused = (r, re) => r.status !== 0 && /REFUSED/.test(r.stderr) && /Nothing was written/.test(said(r)) && re.test(said(r)) && text() === start;
  const TAKE = /bash tools\/cloud-lock\.sh take "[^"]+" "<what>"/;
  lock(null);
  let r = run(...LOG);
  ok(refused(r, /nobody holds the writer lock/) && TAKE.test(said(r)) && said(r).includes('take "' + WHO + '"'), 'with the lock free a write is refused, nothing is written, and the message gives the command to take it');
  fs.rmSync(path.join(T, 'ledger', 'LOCK'));
  ok(refused(run(...LOG), /nobody holds the writer lock/), 'the same with no lock file at all');
  lock('another-session');
  r = run(...LOG);
  ok(refused(r, /held by "another-session"/) && /Wait until it is free/.test(said(r)) && TAKE.test(said(r)), 'held by another session: refused, with who holds it and what to do');
  lock(WHO);
  r = runAs({ FT_WHO: '' }, ...LOG);
  ok(refused(r, /FT_WHO is not set/) && /\. ~\/\.ft-env/.test(said(r)), 'held, but this shell does not say who it is (no FT_WHO): refused, with how to say it');
  lock(WHO, 13);
  r = run(...LOG);
  ok(refused(r, /over 12 hours ago/) && TAKE.test(said(r)), 'a lock over 12 hours old no longer counts, the holder\'s own included: refused, with the command to take it again');
  lock(WHO);
  r = runAs({ FT_READONLY: '1' }, ...LOG);
  ok(refused(r, /read-only \(FT_READONLY=1\)/), 'a read-only session writes nothing, lock or no lock');
  lock(null);
  const WRITES = [['set', 's2', 'next=Read it.', 'next_fr=La lire.'], LOG, ['answer', 'i1', '1', 'Yes.', 'Oui.'], ['state', 'i1', '1', 'lead'], ['inv', 'i1', 'imp=3'],
    ['add-source', 'i1', '1', '{"t":"A list","t_fr":"Une liste","st":"todo"}'], ['add-question', 'i1', '{"q":"Why?","q_fr":"Pourquoi ?","state":"open","src":[{"t":"A list","t_fr":"Une liste","st":"todo"}]}'],
    ['add-inv', '{}'], ['decide', 'https://claude.ai/artifact/TestDecisionsPage1'], ['copy', 's2', 'archive/hand/booklet-pages.md'], ['build'], ['link', '--write']];
  const through = WRITES.filter(w => !refused(run(...w), /nobody holds the writer lock/)).map(w => w[0]);
  ok(!through.length, 'every command that writes is refused without it: ' + WRITES.map(w => w[0]).join(', ') + (through.length ? ' — NOT refused: ' + through.join(', ') : ''));
  const READS = [['status'], ['show', 'i1'], ['validate'], ['check'], ['link']];
  const stopped = READS.filter(w => /writer lock|REFUSED/.test(said(run(...w)))).map(w => w[0]);
  ok(!stopped.length && run('status').status === 0 && run('show', 's1').status === 0 && run('validate').status === 0, 'the commands that only read need no lock: ' + READS.map(w => w[0]).join(', ') + (stopped.length ? ' — stopped: ' + stopped.join(', ') : ''));
  ok(RJ.writerProblem({ FT_WHO: WHO }) !== '' && RJ.writerProblem({ FT_WHO: WHO, FT_READONLY: '1' }) !== '', 'the reason is the same for a caller that asks (writerProblem)');
  lock(WHO);
  r = run(...LOG);
  ok(r.status === 0 && text() !== start, 'with the lock held by FT_WHO the write goes through' + (r.status ? ' (' + said(r).slice(0, 200) + ')' : ''));
}

// ------------------------------------------------------------------ a save never replaces a link
section('a save through a link goes to the link\'s target');
{
  /* the site folder's research.json is a link into the private repo; a save by rename onto it would leave a
     plain copy in its place, and the private repo, which is what is pushed, would keep the old data */
  const priv = path.join(T, 'private'), real = path.join(priv, 'research.json'), linkAt = path.join(T, 'linked', 'research.json');
  fs.mkdirSync(priv); fs.mkdirSync(path.dirname(linkAt));
  fs.writeFileSync(real, JSON.stringify(research(), null, 1));
  let made = true; try { fs.symlinkSync(path.join('..', 'private', 'research.json'), linkAt); } catch (_) { made = false; }
  if (!made) ok(true, '(this machine cannot make links: skipped)');
  else {
    const r = spawnSync(process.execPath, [path.join(T, 'tools', 'research.js'), 'log', 's1', 'The neighbour went.', 'La voisine y est allée.'], { cwd: T, env: Object.assign({}, env, { FT_RESEARCH: linkAt }), encoding: 'utf8' });
    ok(r.status === 0 && fs.lstatSync(linkAt).isSymbolicLink(), 'after a write the link is still a link' + (r.status ? ' (' + (r.stdout + r.stderr).trim().split('\n')[0] + ')' : ''));
    ok(!fs.lstatSync(real).isSymbolicLink() && (RJ.find(JSON.parse(fs.readFileSync(real, 'utf8')), 's1').s.log || []).length === 1, 'and the new entry is in the file it points to');
    ok(/is a link, so the save went to the file it points to/.test(r.stdout), 'the command says where the save went');
    ok(!fs.existsSync(linkAt + '.new') && !fs.existsSync(real + '.new') && fs.readdirSync(path.dirname(linkAt)).length === 1, 'nothing is left beside either');
    /* a link to a link, and a link whose target is gone */
    const link2 = path.join(T, 'linked', 'again.json'); fs.symlinkSync('research.json', link2);
    const R = JSON.parse(fs.readFileSync(real, 'utf8')); R.investigations[0].next = 'Read the ledger twice.';
    ok(RJ.save(R, link2) === fs.realpathSync(real) && fs.lstatSync(link2).isSymbolicLink() && fs.lstatSync(linkAt).isSymbolicLink() && /twice/.test(fs.readFileSync(real, 'utf8')), 'a link to a link is followed to the end, and both links stay');
    const dead = path.join(T, 'linked', 'dead.json'); fs.symlinkSync(path.join('..', 'private', 'gone.json'), dead);
    let err = null; try { RJ.save(R, dead); } catch (e) { err = e; }
    ok(err && err.refused && /cloud-setup\.sh/.test(err.message) && fs.lstatSync(dead).isSymbolicLink() && !fs.existsSync(path.join(priv, 'gone.json')), 'a link whose target is gone is refused, with the fix, and is left as it is');
    ok(RJ.save(R, real) === real, 'a plain file is saved where it is');
  }
}

// ------------------------------------------------------------------ link
section('matching people to cards');
{
  const cards = [{ id: 'c001', name: 'Brinna Odelle Quillfeather', years: '1850–1920' }, { id: 'c002', name: 'Brin Quillfeather', years: '1880–1950' },
    { id: 'c003', name: 'Otho Quillfeather', years: '1801–1870' }];
  const one = p => { const R = { investigations: [{ id: 'i1', people: [p], qs: [] }] }; RJ.link(R, cards, true); return R.investigations[0].people[0].card; };
  ok(one({ n: 'Brin' }) === 'c002', 'a first name matches that first name, not a longer one that starts the same way');
  ok(one({ n: 'Odo (Otho)' }) === 'c003', 'a name in brackets is tried too');
  ok(one({ n: '(Otho)' }) === 'c003', 'a name given only in brackets matches by what is in them');
  ok(one({ n: '(Nobody)' }) === undefined, 'and never every card');
  ok(one({ n: 'Bri' }) === undefined, 'part of a name is not a match');
  ok(one({}) === undefined, 'an entry with no name is reported, not a crash');
}

// ------------------------------------------------------------------ sealed files
section('the sealed files');
{
  const PW = 'test-only-password', salt = Buffer.from('research-test-16').toString('base64'), iter = 1000;
  const R = research(); R.investigations[0]._why = 'a private note'; R.investigations[0].qs[0].src[0]._touched = '2026-10-01T10:00:00Z';
  R.investigations[0].qs[0].src[0]._copy = ['archive/hand/booklet-pages.md']; R.investigations[1].qs[0].src[0]._copy = 'none: the stone itself is the record';
  const f = RJ.sealed(R, PW, { salt, iter });
  const key = P.keyFor(PW, salt, iter);
  const d = P.openBlob(key, f.data), c = P.openBlob(key, f.cards);
  const json = JSON.parse(zlib.inflateRawSync(d.bytes).toString('utf8'));
  ok(/^r:\d+$/.test(d.header) && c.header === 'q', 'research.bin and research-cards.bin open with the payload key (headers ' + d.header + ', ' + c.header + ')');
  ok(JSON.stringify(json) === JSON.stringify(RJ.publicCopy(R)) && !/"_/.test(JSON.stringify(json)), 'research.bin is the family\'s copy: no private key reaches it');
  ok(!/_copy|booklet-pages|the stone itself/.test(JSON.stringify(json)) && !/_copy|booklet-pages/.test(c.bytes.toString('utf8')), 'where our copies are (_copy) reaches neither file');
  { const R1 = JSON.parse(JSON.stringify(R)); R1.investigations.forEach(iv => iv.qs.forEach(q => q.src.forEach(s => { delete s._copy; })));
    const f1 = RJ.sealed(R1, PW, { salt, iter }); ok(f1.data.equals(f.data) && f1.cards.equals(f.cards), 'and recording one leaves both files byte for byte the same'); }
  const cards = JSON.parse(c.bytes.toString('utf8'));
  ok(cards.cards.c001 && cards.cards.c001[0] === 1 && cards.cards.c001[1] === 'i1' && cards.invs.i1[2] === 'solo', 'the badge file: one open question on c001, in i1, ready to do');
  const R2 = JSON.parse(JSON.stringify(R)); R2.investigations[0].qs[0].src[0]._touched = '2026-10-03T09:00:00Z'; R2.investigations[0]._why = 'changed';
  const f2 = RJ.sealed(R2, PW, { salt, iter });
  ok(f2.data.equals(f.data) && f2.cards.equals(f.cards), 'an edit to private keys only leaves both files byte for byte the same');
  const R3 = JSON.parse(JSON.stringify(R)); R3.investigations[0].next = 'Read the ledger first.';
  ok(!RJ.sealed(R3, PW, { salt, iter }).data.equals(f.data), 'an edit the family can see changes the file');
}

// ------------------------------------------------------------------ the commit hook, §0c
section('the commit hook: research files only as research.js built them');
{
  /* the real hook, run by git (Windows runs it whatever its mode; Linux and macOS only when executable) */
  fs.chmodSync(path.join(T, 'githooks', 'commit-msg'), 0o755);
  git('config', 'core.hooksPath', 'githooks');
  fs.writeFileSync(path.join(T, 'data.json'), JSON.stringify({ id: 'c001', name: 'Probus Quillfeather', years: '1850–1920', unions: [] }));
  fs.mkdirSync(path.join(T, 'media'), { recursive: true });
  fs.writeFileSync(path.join(T, 'README.md'), 'test\n');
  git('add', 'README.md'); git('commit', '-qm', 'start');
  const commit = msg => spawnSync('git', ['commit', '-qm', msg], { cwd: T, encoding: 'utf8' });
  fs.writeFileSync(path.join(T, 'media', 'research.bin'), 'not built by the tool');
  git('add', 'media/research.bin');
  let r = commit('update research files');
  ok(r.status !== 0 && /did not build it/.test(r.stderr), 'a research file the tool did not build is refused');
  const id = git('ls-files', '-s', '--', 'media/research.bin').split(/\s+/)[1];
  fs.writeFileSync(path.join(T, '.research-stamp'), id + ' media/research.bin\n');
  r = commit('update research files');
  ok(r.status === 0, 'one whose id is in .research-stamp goes through' + (r.status ? ' (' + (r.stderr || '').trim().split('\n').slice(0, 2).join(' ') + ')' : ''));
  git('rm', '-q', '--cached', 'media/research.bin');
  r = commit('remove research files');
  ok(r.status !== 0 && /staged as DELETED/.test(r.stderr), 'committing its deletion is refused, with a message that says so');
  git('reset', '-q');
  git('config', '--unset', 'core.hooksPath');
}

// ------------------------------------------------------------------ crypt.js: files a live page uses stay
section('crypt.js keeps the files of every page browsers may hold');
{
  const PW = 'test-only-password';
  fs.writeFileSync(path.join(T, '.password'), PW);
  const people = note => ({ id: 'c001', name: 'Probus Quillfeather', years: '1850–1920', note, note_fr: note, src: [],
    unions: [{ s: '', c: [{ id: 'c002', name: 'Wendelin Quillfeather', years: '1880–1950', note: 'Clerk.', note_fr: 'Commis.', src: [] }] }] });
  /* the first page, sealed the way crypt.js seals it, then decrypted so data.json carries its stamp */
  const salt = Buffer.from('crypt-test-salt!').toString('base64');
  const s0 = P.sealData(people('Farmer, version 1.'), PW, { salt, iter: 1000 });
  P.writeMedia(T, s0.media);
  fs.writeFileSync(path.join(T, 'index.html'), '<!doctype html><html><body><script>\n' + s0.line + '\n</script></body></html>\n');
  const crypt = (...a) => spawnSync(process.execPath, [path.join(T, 'tools', 'crypt.js'), ...a], { cwd: T, env: { ...env, FT_PASSWORD: PW }, encoding: 'utf8' });
  let r = crypt('decrypt');
  ok(r.status === 0, 'crypt.js decrypt (' + (r.stdout + r.stderr).trim().split('\n')[0] + ')');
  const x = () => P.readEnc(fs.readFileSync(path.join(T, 'index.html'), 'utf8')).x;
  const has = id => fs.existsSync(path.join(T, 'media', id + '.bin'));
  const edit = note => { const d = JSON.parse(fs.readFileSync(path.join(T, 'data.json'), 'utf8')); d.note = note; d.note_fr = note; fs.writeFileSync(path.join(T, 'data.json'), JSON.stringify(d, null, 1)); };
  const x1 = x();
  git('add', 'index.html', 'media'); git('commit', '-qm', 'page one', '--no-verify');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');                       // page one is live
  edit('Farmer, version 2.'); r = crypt('encrypt'); const x2 = x();
  ok(r.status === 0 && x2 !== x1 && has(x1) && has(x2), 'an edit keeps the live page\'s bios file beside the new one');
  git('add', '-A', 'index.html', 'media'); git('commit', '-qm', 'page two', '--no-verify');   // committed, not pushed
  edit('Farmer, version 3.'); r = crypt('encrypt'); const x3 = x();
  ok(r.status === 0 && has(x1) && has(x2) && has(x3), 'with an unpushed commit in between, the live page\'s file AND the last commit\'s stay (' +
    [x1, x2, x3].map(has).join(', ') + ')');
  git('add', '-A', 'index.html', 'media'); git('commit', '-qm', 'page three', '--no-verify');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');                       // pushed: page three is live
  edit('Farmer, version 4.'); r = crypt('encrypt'); const x4 = x();
  ok(r.status === 0 && !has(x1) && !has(x2) && has(x3) && has(x4), 'once a page is no longer live or last, its file leaves media/ (moved, not deleted)');
  ok(fs.readdirSync(path.join(T, '_to_delete')).length === 1, 'into _to_delete/');
  git('update-ref', '-d', 'refs/remotes/origin/main');                         // a clone with no origin/main
  git('add', '-A', 'index.html', 'media'); git('commit', '-qm', 'page four', '--no-verify');
  edit('Farmer, version 5.'); r = crypt('encrypt');
  ok(r.status === 0 && has(x3) && has(x4) && /WARNING: could not read the page at origin\/main/.test(r.stdout) && /NO file was moved/.test(r.stdout),
    'when it cannot read the live page it moves nothing, and says so loudly');
}

fs.rmSync(T, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
