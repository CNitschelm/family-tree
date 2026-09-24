#!/usr/bin/env node
'use strict';
/*
 * change — the only way an edit gets into data.json.  (OPERATING.md, "The loop")
 *
 *   node tools/change.js <changes.json> [--dry] [--who "<session>"]
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
 *     { "card": "c042", "op": "remove", "list": "pl", "at": "t=residence,k=chenoa", "kind": "fact", "evidence": [ … ] }
 *   ]
 * }
 * kind: fact | grade | source | wording | translation | structure | owner
 * evidence item: { src, quote } | { src, absent: ["word", …] } | { src, read: "image"|"pdf"|"original", transcription }
 *                and always "opened": the date the source was actually opened.
 * optional per edit: "register": "R-0042", "effect": "consistent"|"reopen", "reverts": "why this comes back",
 *                    "fr": "exempt: <why the French differs>", "note": "…"
 */
const fs = require('fs');
const path = require('path');
const L = require('./ledger.js');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--who');
const dry = args.includes('--dry');
const who = args.includes('--who') ? args[args.indexOf('--who') + 1] : (process.env.FT_WHO || 'session');
if (!file) { console.error('usage: node tools/change.js <changes.json> [--dry] [--who "<session>"]'); process.exit(2); }

const errors = [], warnings = [];
const err = (i, m) => errors.push(`edit ${i + 1}: ${m}`);
const warn = (i, m) => warnings.push(`edit ${i + 1}: ${m}`);

let cs;
try { cs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
if (!cs.why || typeof cs.why !== 'string') errors.push('the change file needs "why": one line saying what it does and why');
if (!Array.isArray(cs.edits) || !cs.edits.length) errors.push('the change file needs "edits": [ … ]');

try { L.assertLock(who); } catch (e) { console.error('REFUSED: ' + e.message); process.exit(1); }

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
const LISTS = new Set(['src', 'pl', 'union', 'bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs']);
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
function checkEvidence(i, e, needed) {
  const ev = e.evidence || [];
  if (!ev.length) { if (needed) err(i, `a ${e.kind} change needs "evidence" — the source you opened, and the words in it (quote) or the words it lacks (absent)`); return; }
  ev.forEach((x, j) => {
    const tag = `evidence ${j + 1}`;
    if (!x.src) return err(i, `${tag}: no "src"`);
    if (!x.opened) err(i, `${tag}: say when the source was opened ("opened": "YYYY-MM-DD") — an unopened source is not evidence`);
    if (x.src === 'owner') {
      if (e.kind !== 'owner') err(i, `${tag}: "src": "owner" is only for kind "owner" (Cory's own instruction)`);
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
  });
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
const retired = L.loadChanges().flatMap(c => c.retired || []);
(cs.edits || []).forEach((e, i) => {
  if (!KINDS.has(e.kind)) return err(i, `"kind" must be one of ${[...KINDS].join(', ')}`);
  const op = e.op || (e.find !== undefined ? 'edit' : e.from !== undefined || e.to !== undefined ? 'set' : null);
  if (!op) return err(i, 'say what to do: find/replace, from/to, or op add | remove | addCard | removeCard');
  // ---- whole cards: never without Cory (CLAUDE.md: DO NOT ADD PEOPLE WITHOUT ASKING)
  if (op === 'addCard' || op === 'removeCard') {
    const r = regById.get(e.register);
    if (!r || r.status !== 'owner') return err(i, `${op} needs "register" citing Cory's decision (an entry with status "owner")`);
    if (op === 'addCard') {
      const parent = L.findCard(working, e.parent || '');
      if (!parent || parent.ambiguous) return err(i, `parent ${e.parent} not found`);
      const u = (parent.node.unions || [])[e.union || 0];
      if (!u) return err(i, `parent ${e.parent} has no union ${e.union || 0}`);
      const node = { id: L.nextId(working, retired), ...e.item };
      if (!node.name) return err(i, 'the new card needs a name');
      (u.c = u.c || []).push(node);
      applied.push({ ...e, op, card: node.id, before: null, after: node });
    } else {
      const c = L.findCard(working, e.card || '');
      if (!c || c.ambiguous || !c.parent) return err(i, `card ${e.card} not found (or it is the root)`);
      const u = c.parent.unions[c.unionIdx];
      u.c.splice(u.c.indexOf(c.node), 1);
      applied.push({ ...e, op, before: c.node, after: null, retired: [c.node.id] });
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
        ['bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs'].includes(head) ? ((card.node.profile = card.node.profile || {})[head] = card.node.profile[head] || []) :
        (card.node[head] = card.node[head] || []);
      const dupKey = x => JSON.stringify(head === 'src' ? x.u || x.l : head === 'sources' ? x.url || x.label : head === 'pl' ? [x.k, x.t, x.y] : x);
      if (arr.some(x => dupKey(x) === dupKey(e.item))) return err(i, `${head} already has this item`);
      if (['fact', 'grade'].includes(e.kind)) checkEvidence(i, e, true);
      if (head === 'pl' && e.item.c === 'doc' && !['fact', 'grade'].includes(e.kind)) checkEvidence(i, { ...e, kind: 'grade' }, true);
      if (head === 'src' && e.item.u && e.item.q) { const q = L.quoteIn(e.item.u, e.item.q); if (q.ok === false) err(i, `the new source's quote is not in our copy of ${e.item.u}`); if (!L.archived(e.item.u).held) err(i, `${e.item.u} is not in the archive — archive it first`); }
      if (head === 'src' && e.item.u && !L.archived(e.item.u).held) err(i, `${e.item.u} is not in the archive — archive it first (hand copy or capture), then cite it`);
      if (head === 'sources' && e.item.url && !L.archived(e.item.url).held) err(i, `${e.item.url} is not in the archive — archive it first`);
      const at = e.at === undefined ? arr.length : +e.at;
      arr.splice(at, 0, e.item);
      checkRegister(i, e, card, fam, '', JSON.stringify(e.item));
      applied.push({ ...e, op, card: cid, field: `${head}[${at}]`, before: null, after: e.item });
    } else {
      const arr = head === 'union' ? card.node.unions : ['bio', 'bio_fr', 'hl', 'hl_fr', 'sources', 'docs'].includes(head) ? (card.node.profile || {})[head] : card.node[head];
      if (!arr || !arr.length) return err(i, `${head} is empty`);
      let at;
      try { at = /^\d+$/.test(String(e.at)) ? +e.at : (() => { const r = L.resolve(card.node, `${head}[${e.at}]`); return r.prop; })(); } catch (x) { return err(i, x.message); }
      if (at === undefined || at < 0 || at >= arr.length) return err(i, `${head}[${e.at}] not found`);
      const item = arr[at];
      if (e.from === undefined) return err(i, 'remove needs "from": the item exactly as it stands (a guard against removing the wrong one)');
      if (JSON.stringify(item) !== JSON.stringify(e.from)) return err(i, `${head}[${e.at}] is not the item in "from"`);
      if (head === 'pl') fam = `pin:${item.t}`;
      if (e.kind !== 'structure' || !e.dup_of) checkEvidence(i, e, e.kind !== 'owner');
      checkRegister(i, e, card, fam, JSON.stringify(item), '');
      arr.splice(at, 1);
      applied.push({ ...e, op, card: cid, field: `${head}[${at}]`, before: item, after: null });
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
  // kind rules
  if (e.kind === 'wording' || e.kind === 'translation') {
    const d = tokDiff(before, after);
    if (d.length) err(i, `a ${e.kind} edit may not change years or numbers, and this one changes ${d.join(', ')} — it is a fact change: say "kind": "fact" and give the evidence`);
    const pa = L.multiset(L.properNouns(before)), pb = L.multiset(L.properNouns(after));
    if (e.kind === 'wording' && pa !== pb) warn(i, `the capitalised words differ (${pa} → ${pb}) — if a name or place changed, this is a fact change`);
  }
  if (e.kind === 'translation' && !L.isFrench(e.field)) err(i, '"translation" is for the French field of a pair');
  if (e.kind === 'fact' || e.kind === 'grade') checkEvidence(i, e, true);
  if (e.kind === 'grade' && !/(^|\.)(c|occ_c)$/.test(e.field)) warn(i, 'kind "grade" on a field that is not a grade (pl[…].c or occ_c)');
  if (/(^|\.)(c|occ_c)$/.test(e.field) && e.kind !== 'grade' && e.kind !== 'owner') err(i, 'a change of grade is kind "grade", with the evidence for the new grade');
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
  if (e.kind === 'owner') {
    const r = regById.get(e.register);
    if (!r || r.status !== 'owner') err(i, 'kind "owner" must cite the register entry recording Cory\'s decision (status "owner")');
  }
  checkRegister(i, e, card, fam, before, after);
  let pinKey = null;
  if (/^pl\[/.test(e.field)) { const pin = L.getField(card.node, e.field.replace(/\.[a-z_0-9]+$/, '')); if (pin) pinKey = { k: pin.k, t: pin.t, y: e.field.endsWith('.y') ? undefined : pin.y }; }
  checkReversal(i, e, card, e.field, fam, before, after, pinKey);
  try { L.setField(card.node, e.field, after === undefined ? null : after); } catch (x) { return err(i, x.message); }
  applied.push({ card: cid, field: e.field, op, kind: e.kind, before, after, evidence: e.evidence, register: e.register,
    effect: e.effect, reverts: e.reverts, fr: e.fr, note: e.note });
});

// ---- English and French must carry the same years, field pair by field pair
const touchedPairs = new Map();
for (const a of applied) {
  if (!a.field) continue;
  const tw = L.twin(a.field);
  if (!tw) continue;
  const en = L.isFrench(a.field) ? tw : a.field, fr = L.isFrench(a.field) ? a.field : tw;
  touchedPairs.set(`${a.card}|${en}`, { card: a.card, en, fr, exempt: a.fr });
}
for (const { card, en, fr, exempt } of touchedPairs.values()) {
  const c = L.findCard(working, card);
  let E, F; try { E = L.getField(c.node, en); F = L.getField(c.node, fr); } catch (_) { continue; }
  if (typeof E !== 'string' || typeof F !== 'string') continue;
  if (L.multiset(L.years(E)) !== L.multiset(L.years(F))) {
    const msg = `${card} ${en} / ${fr}: the English gives ${L.years(E).join(', ') || 'no year'}, the French ${L.years(F).join(', ') || 'no year'}`;
    if (exempt && /^exempt:/.test(exempt)) warnings.push(msg + ` (exempt: ${exempt.slice(7).trim()})`);
    else errors.push(msg + ' — change both, or add "fr": "exempt: <why>" to the edit');
  }
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
  at: new Date().toISOString(), who, why: cs.why, file: path.basename(file),
  before_hash: beforeHash, after_hash: afterHash, edits: applied,
  retired: applied.flatMap(a => a.retired || []),
};
if (dry) { console.log(`[dry] ${applied.length} edit(s) would apply cleanly; data.json not written`); process.exit(0); }
L.saveData(working);
L.appendChange(rec);
console.log(`applied ${applied.length} edit(s) — ${rec.id} recorded in ledger/changes.jsonl`);
