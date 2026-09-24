'use strict';
/*
 * The shared core of the change loop (OPERATING.md, "The loop"):
 * card ids, field paths, fact tokens, the source archive, the register of settled
 * questions, the change ledger, and the payload's own history.
 *
 * WHY THIS EXISTS. Between 3 Aug and 24 Sep 2026 the site's history shows the same
 * facts written, struck and restored: 20 pin grades went doc -> inf -> doc, a UI commit
 * built from a stale copy silently undid a week's finding, an owner decision was
 * reverted by a later pass, and one move date was re-weighed on eight deploys. None of
 * it was new evidence. Every pass re-decided from what it could see, because nothing
 * carried forward what had been decided, on what evidence, and what had already been
 * tried and undone. This file is where that memory lives, so the tools can enforce it
 * instead of hoping each session reads the right note.
 *
 * Zero dependencies. Never names a person: everything here is mechanism.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const zlib = require('zlib');

const ROOT = process.env.FT_ROOT || path.join(__dirname, '..');
const LEDGER = process.env.FT_LEDGER || path.join(ROOT, 'ledger');
const ARCHIVE = process.env.FT_ARCHIVE || path.join(ROOT, '..', 'family-tree-sources');
const DATA = path.join(ROOT, 'data.json');

// ------------------------------------------------------------------ data + card ids
const serialize = data => JSON.stringify(data, null, 1);           // what crypt.js decrypt writes
const hashData = data => crypto.createHash('sha256').update(serialize(data)).digest('hex');

function loadData(file = DATA) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function saveData(data, file = DATA) { fs.writeFileSync(file, serialize(data)); }

// Every person on the tree, parents before children, with where they hang.
function cards(data) {
  const out = [];
  (function walk(n, parent, ui, pth) {
    out.push({ node: n, parent, unionIdx: ui, path: pth });
    (n.unions || []).forEach((u, i) => (u.c || []).forEach((c, j) => walk(c, n, i, `${pth}/${i}.${j}`)));
  })(data, null, null, 'r');
  return out;
}
const label = n => `${n.name}${n.years ? ' ' + n.years : ''}`;

// Resolve "c042", "Name|years" or a unique name substring to a card.
function findCard(data, ref) {
  const all = cards(data);
  if (/^c\d{3,}$/.test(ref)) return all.find(c => c.node.id === ref) || null;
  if (ref.includes('|')) {
    const [nm, yr] = ref.split('|');
    const hit = all.filter(c => c.node.name === nm && (c.node.years || '') === (yr || ''));
    return hit.length === 1 ? hit[0] : null;
  }
  const q = ref.toLowerCase();
  const hit = all.filter(c => label(c.node).toLowerCase().includes(q));
  return hit.length === 1 ? hit[0] : (hit.length ? { ambiguous: hit.map(c => `${c.node.id || '?'} ${label(c.node)}`) } : null);
}
const nextId = (data, retired = []) => {
  const nums = cards(data).map(c => c.node.id).concat(retired).filter(Boolean).map(s => +String(s).slice(1));
  return 'c' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
};

// ------------------------------------------------------------------ field paths
// A field path names one value on one card, the way a person reads the card:
//   name years note note_fr occ occ_fr occ_c mn mn_fr g branch anchor tag
//   headline headline_fr  bio[2]  bio_fr[2]  hl[0]  hl_fr[0]
//   sources[1].label  sources[url=https://…].label_fr  docs[0].tr
//   src[3].l  src[url=https://…].q  pl[4].c  pl[t=arrival,k=town].w  union[0].n_fr
const PROFILE_LISTS = new Set(['bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs']);
const PROFILE_SCALARS = new Set(['headline', 'headline_fr']);
const NODE_LISTS = { src: 'src', pl: 'pl', union: 'unions' };

function parsePath(p) {
  const m = /^([a-z_]+)(?:\[([^\]]*)\])?(?:\.([a-z_0-9]+))?$/i.exec(p);
  if (!m) throw new Error(`cannot parse field path "${p}"`);
  return { head: m[1], sel: m[2], key: m[3] };
}
function listOf(node, head, create) {
  if (PROFILE_LISTS.has(head)) {
    if (!node.profile) { if (!create) return null; node.profile = {}; }
    if (!node.profile[head]) { if (!create) return null; node.profile[head] = []; }
    return node.profile[head];
  }
  const k = NODE_LISTS[head];
  if (!k) return null;
  if (!node[k]) { if (!create) return null; node[k] = []; }
  return node[k];
}
// Pick one element of a list: by index, or by url=/t=/k=/y= fields (must be unique).
function pick(list, sel, head) {
  if (sel === undefined) throw new Error(`${head} needs [index] or [field=value]`);
  if (/^\d+$/.test(sel)) return +sel < list.length ? +sel : -1;
  const conds = sel.split(',').map(s => s.split('=')).map(([k, ...v]) => [k.trim(), v.join('=').trim()]);
  const urlKey = head === 'src' ? 'u' : 'url';
  const hits = [];
  list.forEach((el, i) => {
    if (conds.every(([k, v]) => String(el && el[k === 'url' ? urlKey : k]) === v)) hits.push(i);
  });
  if (hits.length > 1) throw new Error(`${head}[${sel}] matches ${hits.length} items — add a condition or use an index`);
  return hits.length ? hits[0] : -1;
}
function resolve(node, p) {
  const { head, sel, key } = parsePath(p);
  if (sel === undefined && !key) {
    if (PROFILE_SCALARS.has(head)) return { obj: node.profile || null, prop: head, ensure: () => (node.profile = node.profile || {}) };
    if (PROFILE_LISTS.has(head) || NODE_LISTS[head]) throw new Error(`"${p}" names a whole list; name one element`);
    return { obj: node, prop: head, ensure: () => node };
  }
  const list = listOf(node, head, false);
  if (!list) return { obj: null, prop: key, missing: `${head} is empty` };
  const i = pick(list, sel, head);
  if (i < 0) return { obj: null, prop: key, missing: `${head}[${sel}] not found` };
  if (!key) return { obj: list, prop: i, ensure: () => list };
  return { obj: list[i], prop: key, ensure: () => list[i] };
}
function getField(node, p) {
  const r = resolve(node, p);
  if (!r.obj) return undefined;
  return r.obj[r.prop];
}
function setField(node, p, value) {
  const r = resolve(node, p);
  const obj = r.obj || (r.ensure && r.ensure());
  if (!obj) throw new Error(`cannot set ${p}: ${r.missing || 'no such place'}`);
  if (value === null || value === undefined) {
    if (Array.isArray(obj)) throw new Error(`use a "remove" edit to take an item out of a list (${p})`);
    delete obj[r.prop];
  } else obj[r.prop] = value;
}

// The French twin of an English field, and back.
function twin(p) {
  const { head, sel, key } = parsePath(p);
  const flip = s => (s.endsWith('_fr') ? s.slice(0, -3) : s + '_fr');
  if (key) {
    if (['w', 'n', 'label', 'cap', 'tr'].includes(key.replace(/_fr$/, ''))) return `${head}[${sel}].${flip(key)}`;
    return null;
  }
  if (['note', 'note_fr', 'occ', 'occ_fr', 'mn', 'mn_fr', 'headline', 'headline_fr'].includes(head)) return flip(head);
  if (['bio', 'bio_fr', 'hl', 'hl_fr'].includes(head)) return `${flip(head)}[${sel}]`;
  return null;
}
const isFrench = p => /_fr(\b|\[|$)|\.[a-z]+_fr$/.test(p);

// Every content leaf of a card as field path -> value (unions' children excluded).
// Images are kept as a short hash: the ledger needs to know an image changed, not to hold it.
const blob = v => (typeof v === 'string' && (v.startsWith('data:') || v.length > 20000))
  ? '#blob:' + crypto.createHash('sha1').update(v).digest('hex').slice(0, 12) : v;
function leaves(node) {
  const out = {};
  const put = (k, v) => { if (v !== undefined && v !== null && typeof v !== 'object') out[k] = blob(v); };
  for (const [k, v] of Object.entries(node)) if (!['unions', 'profile', 'src', 'pl'].includes(k)) put(k, v);
  const pr = node.profile || {};
  for (const k of PROFILE_SCALARS) put(k, pr[k]);
  for (const k of PROFILE_LISTS) (pr[k] || []).forEach((el, i) => {
    if (typeof el === 'object') for (const [f, v] of Object.entries(el)) put(`${k}[${i}].${f}`, v); else put(`${k}[${i}]`, el);
  });
  for (const k of ['timeline', 'links']) if (pr[k] !== undefined) out[`profile.${k}`] = JSON.stringify(pr[k]);
  (node.src || []).forEach((el, i) => { for (const [f, v] of Object.entries(el)) put(`src[${i}].${f}`, v); });
  (node.pl || []).forEach((el, i) => { for (const [f, v] of Object.entries(el)) put(`pl[${i}].${f}`, v); });
  (node.unions || []).forEach((u, i) => { for (const [f, v] of Object.entries(u)) if (f !== 'c') put(`union[${i}].${f}`, v); });
  return out;
}
// The family a field belongs to, for tokens and locks: "bio", "pin:arrival", "src", ...
function family(node, p) {
  const { head, sel } = parsePath(p);
  if (head === 'pl' && sel !== undefined) {
    const list = node.pl || [];
    const i = /^\d+$/.test(sel) ? +sel : pick(list, sel, 'pl');
    const el = list[i];
    return el ? `pin:${el.t}` : 'pin';
  }
  return head.replace(/_fr$/, '');
}

// ------------------------------------------------------------------ fact tokens
const YEAR = /(?<![\d.,/])(1[4-9]\d\d|20[0-3]\d)(?![\d])/g;
const NUM = /(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu;
const years = s => [...String(s || '').matchAll(YEAR)].map(m => m[1]);
const numbers = s => [...String(s || '').matchAll(NUM)].map(m => m[0].replace(',', '.'));
const multiset = arr => arr.slice().sort().join(' ');
// Capitalised words that are not the first word of a sentence: names, places, titles.
const STOP = new Set(['The', 'His', 'Her', 'Their', 'He', 'She', 'They', 'It', 'In', 'On', 'At', 'By', 'For', 'From',
  'A', 'An', 'And', 'But', 'Or', 'When', 'After', 'Before', 'Both', 'No', 'Not', 'This', 'That', 'These', 'Those', 'I',
  'Le', 'La', 'Les', 'Il', 'Elle', 'Ils', 'Un', 'Une', 'Des', 'Du', 'De', 'Son', 'Sa', 'Ses', 'Leur', 'Aucun', 'Aucune']);
function properNouns(s) {
  const out = [];
  String(s || '').split(/(?<=[.!?…:;])\s+/).forEach(sent => {
    sent.split(/\s+/).slice(1).forEach(w => {
      const t = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (/^\p{Lu}\p{Ll}+/u.test(t) && !STOP.has(t)) out.push(t);
    });
  });
  return out;
}
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Text as a quote can be found in it: one spelling of quotes, dashes, spaces and dates.
function normText(s) {
  return String(s || '').normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»„]/g, '"')
    .replace(/[‐-―−]/g, '-').replace(/…/g, '...')
    .replace(/\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{4})\b/gi,
      (_, d, m, y) => `${y}-${String(MON.indexOf(m.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`)
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}),? (\d{4})\b/gi,
      (_, m, d, y) => `${y}-${String(MON.indexOf(m.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`)
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// ------------------------------------------------------------------ the source archive
// Where a source's words can be read without the source: CNitschelm/family-tree-sources,
// cloned next to this folder. A hand copy (archive/hand/<id>.txt) or the archiver's own
// capture (archive/store/<host>/<id>/…), or a family paper (archive/family/<folder>/).
const sourceId = url => crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
let _state = null;
function archiveState() {
  if (_state) return _state;
  const f = path.join(ARCHIVE, 'archive', 'store', 'state.json');
  try { _state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { _state = {}; }
  return _state;
}
function readableHtml(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(br|p|div|li|tr|td|th|h[1-6]|section|article|dd|dt|blockquote|pre|table|ul|ol|time|label)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
// What we hold of a source, and its text where it has text.
function archived(src) {
  if (!src) return { held: false, why: 'no source named' };
  if (!fs.existsSync(ARCHIVE)) return { held: false, why: `the archive clone is not at ${ARCHIVE}` };
  if (/^family:/.test(src)) {
    const dir = path.join(ARCHIVE, 'archive', 'family', src.slice(7));
    if (!fs.existsSync(dir)) return { held: false, why: `no archive/family/${src.slice(7)}` };
    const st = fs.statSync(dir);
    const files = st.isDirectory() ? fs.readdirSync(dir).map(f => path.join(dir, f)) : [dir];
    const text = files.filter(f => /\.(txt|md|eml)$/i.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    return { held: true, kind: 'family', files, text: text || null };
  }
  const id = sourceId(src);
  const out = { held: false, id, files: [], text: null };
  const hand = path.join(ARCHIVE, 'archive', 'hand', id + '.txt');
  const texts = [];
  if (fs.existsSync(hand)) {
    out.held = true; out.kind = 'hand'; out.files.push(hand);
    texts.push(fs.readFileSync(hand, 'utf8').split('\n').filter(l => !l.startsWith('# ')).join('\n'));
  }
  const s = archiveState()[id];
  const rec = s && (s.ok ? s : s.lastGood ? { ...s.lastGood, ok: true } : null);
  const files = rec ? [rec.file, ...((s.files || []))].filter(Boolean) : [];
  for (const f of new Set(files)) {
    const full = path.join(ARCHIVE, 'archive', 'store', f);
    if (!fs.existsSync(full)) continue;
    out.held = true; out.kind = out.kind || 'store'; out.files.push(full);
    if (/\.html?$/i.test(full)) texts.push(readableHtml(fs.readFileSync(full, 'utf8')));
    else if (/\.(txt|md|json)$/i.test(full)) texts.push(fs.readFileSync(full, 'utf8'));
  }
  if (s && s.result === 'pages' && Array.isArray(s.pages)) for (const pg of s.pages) {
    const full = path.join(ARCHIVE, 'archive', 'store', pg.file);
    if (fs.existsSync(full)) { out.held = true; out.kind = out.kind || 'pages'; out.files.push(full); }
  }
  if (texts.length) out.text = texts.join('\n');
  if (!out.held) out.why = 'no copy in the archive (archive/hand/' + id + '.txt or archive/store/…/' + id + ')';
  return out;
}
// Is this quote in our copy of that source? "unreadable" when the copy is an image or a PDF.
function quoteIn(src, quote) {
  const a = archived(src);
  if (!a.held) return { ok: false, why: a.why };
  if (!a.text) return { ok: null, why: `the copy we hold is ${a.files.map(f => path.extname(f)).join(', ') || 'not text'} — read it and attest`, files: a.files };
  const ok = normText(a.text).includes(normText(quote));
  return { ok, why: ok ? 'found' : 'not in our copy', files: a.files };
}

// ------------------------------------------------------------------ register
// ledger/register.jsonl: one settled question per line. See OPERATING.md, "The register".
function loadRegister() {
  const f = path.join(LEDGER, 'register.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('//')).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`register.jsonl line ${i + 1}: ${e.message}`); }
  });
}
const LOCKING = new Set(['settled', 'owner', 'policy', 'disclosed']);
// How often a register token (a year, a date, a word, a phrase) occurs in a text.
const occurrences = (text, tok) => {
  const t = normText(tok), s = normText(text);
  if (!t) return 0;
  let n = 0, i = 0;
  while ((i = s.indexOf(t, i)) !== -1) { n++; i += t.length; }
  return n;
};
// The register entries an edit on (card, field family) must answer to. An entry that lists
// tokens binds only an edit that adds or removes one of them; an entry without tokens binds
// every edit to the field families it names.
function locksFor(register, cardId, fam, before, after) {
  const b = typeof before === 'string' ? before : JSON.stringify(before ?? '');
  const a = typeof after === 'string' ? after : JSON.stringify(after ?? '');
  // the years and numbers the edit adds or takes away ("22 May" -> "19 May" touches 22 and 19)
  const count = s => { const m = {}; years(s).concat(numbers(s)).forEach(t => (m[t] = (m[t] || 0) + 1)); return m; };
  const cb = count(b), ca = count(a);
  const touched = new Set(Object.keys({ ...cb, ...ca }).filter(t => (cb[t] || 0) !== (ca[t] || 0)));
  const hits = t => occurrences(b, t) !== occurrences(a, t) || numbers(t).concat(years(t)).some(x => touched.has(x));
  return register.filter(r => LOCKING.has(r.status) && !r.superseded_by &&
    (r.cards || []).includes(cardId) &&
    (!r.fields || !r.fields.length || r.fields.includes('*') || r.fields.includes(fam) ||
      (fam.startsWith('pin:') && r.fields.includes('pin'))) &&
    (!r.tokens || !r.tokens.length || r.tokens.some(hits)));
}

// ------------------------------------------------------------------ change ledger
// ledger/changes.jsonl: one applied change set per line, with every edit's before and after.
function loadChanges() {
  const f = path.join(LEDGER, 'changes.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function appendChange(rec) {
  fs.mkdirSync(LEDGER, { recursive: true });
  fs.appendFileSync(path.join(LEDGER, 'changes.jsonl'), JSON.stringify(rec) + '\n');
}
// The change sets that lead from one state of data.json to another, by content hash.
function chain(changes, fromHash, toHash) {
  if (fromHash === toHash) return [];
  const byBefore = new Map();
  for (const c of changes) { if (!byBefore.has(c.before_hash)) byBefore.set(c.before_hash, []); byBefore.get(c.before_hash).push(c); }
  // breadth-first, newest change set first when a state was left more than once
  const q = [[fromHash, []]], seen = new Set([fromHash]);
  while (q.length) {
    const [h, trail] = q.shift();
    for (const c of (byBefore.get(h) || []).slice().reverse()) {
      if (c.after_hash === toHash) return trail.concat(c);
      if (!seen.has(c.after_hash)) { seen.add(c.after_hash); q.push([c.after_hash, trail.concat(c)]); }
    }
  }
  return null;
}

// ------------------------------------------------------------------ the lock
// One writer at a time. ledger/LOCK holds who is working; the mount cannot delete files,
// so releasing writes "free" instead of removing it.
const LOCK = path.join(LEDGER, 'LOCK');
const LOCK_HOURS = 12;
function lockState() {
  try {
    const t = fs.readFileSync(LOCK, 'utf8').trim();
    if (!t || t === 'free') return null;
    const l = JSON.parse(t);
    if (Date.now() - Date.parse(l.since) > LOCK_HOURS * 3600e3) return { ...l, stale: true };
    return l;
  } catch (_) { return null; }
}
function assertLock(who) {
  const l = lockState();
  if (!l || l.stale) return;
  if (who && l.who === who) return;
  if (process.env.FT_WHO && l.who === process.env.FT_WHO) return;
  throw new Error(`ledger/LOCK is held by "${l.who}" since ${l.since} (${l.what || ''}). ` +
    `Another session is editing. Wait, or — if that session is dead — run: node tools/lock.js take "<you>" --steal`);
}

// ------------------------------------------------------------------ payload history
// Every published state of the payload, from git, decrypted once and cached in
// ledger/history/<sha>.json.gz as { card id -> { field path -> value } }.
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
}
function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  return fs.readFileSync(path.join(ROOT, '.password'), 'utf8').trim();
}
function readEnc(html) {
  const m = html.match(/const ENC = (\{[^}]*\});/);
  if (!m) throw new Error('ENC block not found');
  return JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
}
const fingerprint = enc => enc.iv + ':' + crypto.createHash('sha256').update(enc.ct).digest('hex').slice(0, 16);
const _keys = new Map();
function decryptEnc(enc) {
  const k = enc.salt + ':' + enc.iter;
  if (!_keys.has(k)) _keys.set(k, crypto.pbkdf2Sync(Buffer.from(password()), Buffer.from(enc.salt, 'base64'), enc.iter, 32, 'sha256'));
  const ct = Buffer.from(enc.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', _keys.get(k), Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
}
function payloadAt(rev) { return decryptEnc(readEnc(git(['show', `${rev}:index.html`]))); }

// Give every card of an older payload the id of the card it became, by walking back one
// version at a time: same name and years, else same name, else same place in the tree.
function mapIds(olderCards, newerCards) {
  const out = new Map(), used = new Set();
  const keys = [c => `${c.node.name}|${c.node.years}`, c => c.node.name, c => c.path,
                c => String(c.node.name || '').split(/ \(| b\.| ×/)[0]];
  for (const kf of keys) {
    const idx = new Map();
    newerCards.forEach(c => { if (!c.id || used.has(c.id)) return; const k = kf(c); idx.set(k, idx.has(k) ? null : c); });
    const cnt = new Map();
    olderCards.forEach(c => { if (!out.has(c)) { const k = kf(c); cnt.set(k, (cnt.get(k) || 0) + 1); } });
    olderCards.forEach(c => {
      if (out.has(c)) return;
      const k = kf(c), m = idx.get(k);
      if (m && cnt.get(k) === 1 && !used.has(m.id)) { out.set(c, m.id); used.add(m.id); }
    });
  }
  return out;
}
// [{sha, date, subject, cards: {id: leaves}}], oldest first, ending at `upTo` (default origin/main).
function history(upTo = 'origin/main', { quiet = false } = {}) {
  const dir = path.join(LEDGER, 'history');
  fs.mkdirSync(dir, { recursive: true });
  const log = git(['log', '--format=%H%x09%aI%x09%s', upTo, '--', 'index.html']).trim().split('\n').filter(Boolean)
    .map(l => { const [sha, date, subject] = l.split('\t'); return { sha, date, subject }; });   // newest first
  const out = [];
  // the working data.json carries the ids; older payloads are matched back to it
  let newer = null;
  try { newer = cards(loadData()).filter(c => c.node.id).map(c => ({ id: c.node.id, node: c.node, path: c.path })); } catch (_) {}
  for (const v of log) {
    const f = path.join(dir, v.sha + '.json.gz');
    let rec = null;
    if (fs.existsSync(f)) { try { rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch (_) { rec = null; } }
    if (!rec) {
      if (!quiet) process.stderr.write(`  history: decrypting ${v.sha.slice(0, 7)} ${v.date.slice(0, 10)}\n`);
      const data = payloadAt(v.sha);
      const cs = cards(data).map(c => ({ ...c, id: c.node.id || null }));
      if (newer) {
        const m = mapIds(cs.filter(c => !c.id), newer);
        cs.forEach(c => { if (!c.id && m.has(c)) c.id = m.get(c); });
      }
      rec = { sha: v.sha, date: v.date, subject: v.subject, cards: {} };
      cs.forEach((c, i) => {
        rec.cards[c.id || `?${v.sha.slice(0, 7)}:${i}`] =
          { name: c.node.name, years: c.node.years || '', path: c.path, leaves: leaves(c.node) };
      });
      fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(rec)));
    }
    // the next (older) version is matched against this one
    newer = Object.entries(rec.cards).map(([id, c]) =>
      ({ id: id.startsWith('?') ? null : id, node: { name: c.name, years: c.years }, path: c.path }));
    out.push(rec);
  }
  return out.reverse();
}

// The family of a leaf path within one version's leaves: "bio", "src", "pin:arrival", …
function leafFamily(leavesMap, p) {
  const m = /^pl\[(\d+)\]/.exec(p);
  if (m) return `pin:${leavesMap[`pl[${m[1]}].t`]}`;
  return p.split(/[\[.]/)[0].replace(/_fr$/, '');
}

module.exports = {
  ROOT, LEDGER, ARCHIVE, DATA, serialize, hashData, loadData, saveData, cards, label, findCard, nextId,
  parsePath, resolve, getField, setField, twin, isFrench, leaves, family,
  years, numbers, multiset, properNouns, normText,
  sourceId, archived, quoteIn, archiveState,
  loadRegister, locksFor, loadChanges, appendChange, chain,
  lockState, assertLock, LOCK,
  git, readEnc, fingerprint, decryptEnc, payloadAt, history, mapIds, leafFamily,
};
