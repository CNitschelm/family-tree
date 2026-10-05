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
 *                        family's copy and nothing more, byte for byte the same when nothing they show changed
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
for (const f of ['tools/research.js', 'tools/payload.js', 'tools/crypt.js', 'tools/check-commit-msg.js'])
  fs.copyFileSync(path.join(SRC, f), path.join(T, f));
/* the hook as sh reads it: a checkout with Windows line endings must not fail the test for that alone */
fs.writeFileSync(path.join(T, 'githooks', 'commit-msg'), fs.readFileSync(path.join(SRC, 'githooks', 'commit-msg'), 'utf8').replace(/\r\n/g, '\n'));
const env = { ...process.env, FT_ROOT: T, FT_RESEARCH: path.join(T, 'research.json') };
delete env.FT_PASSWORD;
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
  const f = RJ.sealed(R, PW, { salt, iter });
  const key = P.keyFor(PW, salt, iter);
  const d = P.openBlob(key, f.data), c = P.openBlob(key, f.cards);
  const json = JSON.parse(zlib.inflateRawSync(d.bytes).toString('utf8'));
  ok(/^r:\d+$/.test(d.header) && c.header === 'q', 'research.bin and research-cards.bin open with the payload key (headers ' + d.header + ', ' + c.header + ')');
  ok(JSON.stringify(json) === JSON.stringify(RJ.publicCopy(R)) && !/"_/.test(JSON.stringify(json)), 'research.bin is the family\'s copy: no private key reaches it');
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
