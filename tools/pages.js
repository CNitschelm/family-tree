#!/usr/bin/env node
/*
 * pages — the page list of a register scan (16 Nov 2026, register R-0759).
 *
 * When a run reads a register page by page looking for the family, the pages that held nothing were
 * recorded only in sentences ("media 40 to 95 read, nothing"), so the next run could not tell which pages
 * were covered and read them again, and a "nothing found" could not be checked. This keeps one small table
 * for each register, in the source archive, that says for every page read: when, by which run, and what it
 * held. Record the pages as they are read, the empty ones too.
 *
 *   node tools/pages.js add <register address> <page | a-b | a,b,c-d> <result> --who <text>
 *                           [--what "<register title>"] [--note "<text>"] [--date YYYY-MM-DD]
 *                           [--id <the page's own id>] [--pages <how many pages the register has>] [--new]
 *   node tools/pages.js show <register address>        what was read, by result; what never was, when the
 *                                                      register's length is known
 *   node tools/pages.js unread <register address> [--list [--limit <n>|all]]
 *                                                      the pages still to read (--list: one a line, with ids)
 *   node tools/pages.js list                           every register that has a page list
 *   node tools/pages.js import-list <register address> <tsv> [--what "<register title>"]
 *                                                      the register's length and page ids, from a list with
 *                                                      one page a line (number, id, address); marks nothing read
 *
 * <result> is one of: finding (the page holds something for us: say what in --note), nothing (read in full,
 * nothing for us), "not read" (opened or listed, not read: not a negative), unreadable (could not be read:
 * not a negative either). --who is the run or the card that read it (free text, no personal names).
 * <register address> is the register's ark or URL. A page's address under an ark is taken as its register
 * (…/ark:/<n>/<register>/<page id>, …/<register>/dao/0/<n>, …/<register>/daogrp/0/<n>, …/<register>/f<n>.item,
 * and anything after a ? or #), and a register that already has a list is also found by its key, by its ark
 * without the site, or by the ark's name alone, so the same register is not listed twice under two spellings.
 * Any other address that goes on from the address of a register with a list is refused, with the two ways
 * out: give the register's address, or --new (this address is a register of its own). A range is written
 * 40-51, with a plain hyphen. A row written by mistake is put right by a later row for the same page:
 * "not read", with a note that says so.
 *
 * The file: <archive>/archive/coverage/<key>.tsv, tab-separated, only ever added to:
 *   # address: <the register's address>      # what: <its title>      # length: <its pages>
 *   #id <tab> page <tab> id <tab> address                      a page's own id and address (import-list)
 *   page <tab> id <tab> date read <tab> who <tab> result <tab> note
 * A later line wins over an earlier one of its kind, and for a page the row with the newest date counts
 * (the later line when two share a date): a second reading is added, never written over, so the history
 * stays. <archive> is FT_ARCHIVE (by default ../family-tree-sources, as in tools/ledger.js).
 *
 * Two sessions may add rows to one list before either has pushed. Both add at the end of the file, which git
 * calls a conflict, and cloud-finish.sh would stop the second session. So the folder carries its own
 * .gitattributes (written here with the first list, committed with it): "*.tsv merge=union" tells git to keep
 * both sides' lines. That is right for these files and no others: every row stands by itself.
 *
 * It writes only inside archive/coverage/, never in a read-only session (FT_READONLY=1), and never commits:
 * the source archive is its own repository, and cloud-finish.sh stops while it has uncommitted files.
 * Zero dependencies. Never names a person: everything here is mechanism.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.FT_ROOT || path.join(__dirname, "..");
const ARCHIVE = process.env.FT_ARCHIVE || path.join(ROOT, "..", "family-tree-sources");
const SUB = ["archive", "coverage"];
const DIR = path.join(ARCHIVE, ...SUB);

const RESULTS = ["finding", "nothing", "not read", "unreadable"];
/* the words runs have used for the same four things */
const ALIAS = { hit: "finding", found: "finding", "no hit": "nothing", "no-hit": "nothing", none: "nothing", "no finding": "nothing",
  "not-read": "not read", not_read: "not read", notread: "not read", unread: "not read" };
const MAX_ADD = 5000;     /* pages in one add: a slip such as 1-100000 is not a register */
const LIST_LIMIT = 50;    /* unread --list prints this many unless told otherwise */

const NOT_SAID = "(not said)";   /* shown for a register whose title was never given; never a title */
const ATTR = ".gitattributes";    /* in archive/coverage/: git keeps both sides' rows when two sessions add to one list */
const ATTR_RULE = "*.tsv merge=union";

const refusal = msg => Object.assign(new Error(msg), { refused: true });
const today = () => new Date().toISOString().slice(0, 10);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const oneLine = s => String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();   /* a cell: no tab, no line break */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/* ---------- a register's address and its key ---------- */
/* the address as it is kept: the scheme and host in lower case, no trailing slash; under an ark, a last part
   that is a page's id (a uuid) is the page, not the register, and so is what a viewer adds to show one page.
   Only the endings the archive's sources really have, and only under an ark, whose name is the register:
   anything after a ? or # (an ark names its object by its path); /dao/0 or /daogrp/0 and what follows (the
   image's number, the layout: every address we hold has set 0, and another set is left alone, since it could
   be other images); /f<n>.item and its like. A page taken for a register by mistake would start a list of
   one row for each page, and the register's own list would never fill. Returns { address, page } */
function normal(given) {
  let a = oneLine(given), page = "";
  a = a.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^\/?#]*)/i, (m, s, h) => s.toLowerCase() + h.toLowerCase());
  a = a.replace(/^(.*?ark:\/\d+\/[^?#]*)[?#].*$/i, "$1")
    .replace(/^(.*?ark:\/\d+\/[^\/?#]+)\/(?:dao|daogrp)\/0(?:\/.*)?$/i, "$1")
    .replace(/^(.*?ark:\/\d+\/[^\/?#]+)\/f\d+\.[a-z][^\/]*\/?$/i, "$1");
  const m = new RegExp("^(.*ark:/\\d+/[^/?#]+)/(" + UUID + ")/?$", "i").exec(a);
  if (m) { a = m[1]; page = m[2].toLowerCase(); }
  return { address: a.replace(/\/+$/, ""), page };
}
/* what makes two addresses the same register: the address without its scheme or a leading www. */
const ident = address => address.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
/* a name that is safe as a file name and still readable, with a short hash so that two addresses never share one */
function keyOf(given) {
  const id = ident(normal(given).address);
  const slug = id.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return (slug || "register") + "-" + crypto.createHash("sha256").update(id).digest("hex").slice(0, 8);
}

/* ---------- the file ---------- */
function parse(text) {
  const reg = { address: "", what: "", length: null, ids: new Map(), rows: [], bad: [] };
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (line.startsWith("#id\t")) { const c = line.split("\t"); if (c[1]) reg.ids.set(c[1], { id: c[2] || "", address: c[3] || "" }); return; }
    if (line.startsWith("#")) {
      const h = /^# (address|what|length): (.*)$/.exec(line);
      if (!h) return;
      if (h[1] === "length") { if (/^\d+$/.test(h[2].trim())) reg.length = +h[2]; }
      else reg[h[1]] = h[2].trim() === NOT_SAID ? "" : h[2].trim();   /* the first lists said so in the file */
      return;
    }
    const c = line.split("\t");
    if (c.length < 5 || !c[0] || !isDate(c[2]) || !RESULTS.includes(c[4])) { reg.bad.push(i + 1); return; }
    reg.rows.push({ page: c[0], id: c[1], date: c[2], who: c[3], result: c[4], note: c[5] || "", line: i + 1 });
  });
  return reg;
}
/* the coverage folder, proven to be inside the archive; made when it is not there yet and `make` is set */
function folder(make) {
  let base;
  try { base = fs.realpathSync(path.join(ARCHIVE, SUB[0])); }
  catch (_) { throw refusal("there is no source archive at " + ARCHIVE + " (no archive/ folder in it). Set FT_ARCHIVE to the family-tree-sources clone (bash tools/cloud-setup.sh does it), then run this again."); }
  if (!fs.existsSync(DIR)) { if (!make) return null; fs.mkdirSync(DIR); }
  const real = fs.realpathSync(DIR);
  if (path.dirname(real) !== base) throw refusal(DIR + " leads outside the source archive (to " + real + "). pages.js writes only inside archive/coverage/: make that a plain folder of the archive, then run this again.");
  return real;
}
function registers() {
  const dir = folder(false);
  if (!dir) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".tsv")).sort().map(f => {
    const reg = parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return Object.assign(reg, { key: f.slice(0, -4), file: path.join(dir, f) });
  });
}
/* The register an address means: its own list, or the one list that is plainly the same register under
   another spelling: its key; the tail of its address, or the address whose tail it is, cut at a / (an ark
   with or without its site); one whole part of its path, such as the ark's name. Six characters or more, since
   a short word fits too much, and never the site's name alone. An address that only goes on from a register's
   (…/<register>/<something>) is NOT taken as that register: it may be another one, and pages filed under the
   wrong register would be a false "read". The exceptions are the page endings under an ark (normal). Such an
   address is not given a list of its own in silence either: `from` names the register it goes on from, and the
   commands that write refuse, with the two ways out. `exact` (--new) looks for the address's own list only. */
function find(given, exact) {
  const n = normal(given), key = keyOf(given), all = registers();
  const own = all.find(r => r.key === key);
  if (own || exact) return { reg: own || null, key, n, alias: false, from: null };
  const id = ident(n.address), long = x => x.length >= 6, bare = !/[\/?#]/.test(id) && long(id);
  const hits = all.filter(r => {
    const rid = ident(r.address);
    if (!rid) return false;
    return id === r.key || (long(id) && rid.endsWith("/" + id)) || (long(rid) && id.endsWith("/" + rid)) || (bare && rid.split(/[\/?#=&]/).slice(1).includes(id));
  });
  if (hits.length > 1) throw refusal(JSON.stringify(oneLine(given)) + " fits " + hits.length + " registers that have a page list (" + hits.map(r => r.address).join(", ") + "). Give the register's full address.");
  /* …/<register>/<more>, <register>?<more>: the longest register it goes on from */
  const from = hits[0] ? null : all.filter(r => { const rid = ident(r.address); return rid && id.length > rid.length && id.startsWith(rid) && /[\/?#]/.test(id[rid.length]); })
    .sort((a, b) => b.address.length - a.address.length)[0] || null;
  return { reg: hits[0] || null, key: hits[0] ? hits[0].key : key, n, alias: !!hits[0], from };
}
/* an address that goes on from a register's may be one of its pages (most are) or a register of its own: only
   the reader knows, so nothing is written until it says which. Without this each such page started a list of
   one row, and the register's own list still said "never read" */
function notAPage(f, cmd, rest) {
  if (f.reg || !f.from) return;
  throw refusal(JSON.stringify(f.n.address) + " goes on from " + f.from.address + ", which has a page list (archive/coverage/" + f.from.key + ".tsv). If this is a page of that register, give the register's address instead:  node tools/pages.js " + cmd + " \"" + f.from.address + "\" " + rest + "  If it is a register of its own, run this again with --new. Nothing was written.");
}
/* said after a write that went to a list found under another spelling, so a wrong guess is seen at once */
const ALIAS_NOTE = (f, given) => "  NOTE  " + JSON.stringify(oneLine(given)) + " was taken as the register " + f.reg.address + ", which already has a list. If it is another register, give its full address with --new, and put this right with a later row (\"not read\", with a note that it was a slip).";
function append(file, lines) {
  if (!lines.length) return;
  let st = null; try { st = fs.lstatSync(file); } catch (_) {}
  if (st && !st.isFile()) throw refusal(file + " is not a plain file (a link or a folder is in its place). pages.js writes only real files inside archive/coverage/: move it away, then run this again.");
  const add = lines.join("\n") + "\n";
  const before = st ? fs.readFileSync(file, "utf8") : "";
  fs.appendFileSync(file, (before && !before.endsWith("\n") ? "\n" : "") + add);
  if (!fs.readFileSync(file, "utf8").endsWith(add)) throw new Error("the write to " + file + " did not land: check the disk (df -h), then run this again");
}
const header = (address, what) => [
  "# pages.js page list: the pages of one register that were read, and what each held (node tools/pages.js show <address>). Lines are only added; for a page, the row with the newest date counts.",
  "# address: " + address,
  ...(what ? ["# what: " + what] : []),   /* no title given: no line, and every add asks for one until it is there */
  "# columns: page\tid\tdate read\twho\tresult\tnote",
];
/* the folder's own .gitattributes (see the top of this file): written when it is not there, and the rule added
   when someone took it out. Returns true when it wrote */
function unionRule(dir) {
  const file = path.join(dir, ATTR);
  let had = ""; try { had = fs.readFileSync(file, "utf8"); } catch (_) {}
  if (had.split(/\r?\n/).some(l => l.trim() === ATTR_RULE)) return false;
  append(file, (had ? [] : ["# Written by tools/pages.js. The page lists in this folder are only ever added to, one row a line, and every",
    "# row stands by itself. When two sessions add rows to the same list, git keeps both sides' lines (union)",
    "# instead of stopping on a conflict. Commit this file with the lists."]).concat(ATTR_RULE));
  return true;
}

/* ---------- pages and ranges ---------- */
/* "12", "40-51", "3,7,40-51" → [numbers]; a name with a letter in it is one page with a name of its own (a label) */
function pagesOf(arg) {
  const s = oneLine(arg);
  if (!s) throw refusal("say which page: a number, a range such as 40-51, or a list such as 3,7,40-51");
  /* a range copied from our own notes has an en dash, or spaces around the dash: the same range. Taken as a
     page's name it was recorded as ONE page that does not exist, and the pages themselves stayed unread */
  const t = s.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s*([-,])\s*/g, "$1");
  if (/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(t)) {
    const out = [];
    for (const part of t.split(",")) {
      const [a, b] = part.split("-").map(Number), z = b === undefined ? a : b;
      if (a < 1) throw refusal("pages are numbered from 1 (" + part + ")");
      if (z < a) throw refusal("the range " + part + " runs backwards: write it as " + z + "-" + a);
      if (out.length + (z - a + 1) > MAX_ADD) throw refusal("that is more than " + MAX_ADD + " pages in one go, which looks like a slip. Record a register in ranges of at most " + MAX_ADD + ".");
      for (let p = a; p <= z; p++) out.push(String(p));
    }
    return [...new Set(out)];
  }
  /* numbers and joining words only: meant as pages, never a page's name */
  if (/\d/.test(t) && /^(?:[\d\s,;.\/&+-]|to|through|and|\u00e0|au|et)+$/i.test(t)) throw refusal(JSON.stringify(s) + " looks like pages, but is not written as pages are here. Write a range as 41-45 (a plain hyphen, no spaces or words) and a list as 3,7,40-51, then run this again. Nothing was written.");
  if (s.startsWith("#") || s.startsWith("-") || s.length > 80) throw refusal(JSON.stringify(s) + " cannot be a page: give a number, a range (40-51), or a short name of at most 80 characters that does not start with # or -");
  return [s];
}
/* numbers as ranges, names after them: "1-11, 13, 40-51, cover" */
function ranges(pages, max = 40) {
  const nums = pages.filter(p => /^\d+$/.test(p)).map(Number).sort((a, b) => a - b), names = pages.filter(p => !/^\d+$/.test(p));
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? String(nums[i]) : nums[i] + "-" + nums[j]);
    i = j;
  }
  out.push(...names);
  return out.length > max ? out.slice(0, max).join(", ") + ", … and " + (out.length - max) + " more (the file has them all)" : out.join(", ");
}

/* ---------- what a list says ---------- */
function summary(reg) {
  const newest = new Map(), seen = new Map();
  for (const r of reg.rows) {
    const cur = newest.get(r.page);
    if (!cur || r.date >= cur.date) newest.set(r.page, r);   /* rows are in the order they were added: a tie goes to the later line */
    (seen.get(r.page) || seen.set(r.page, new Set()).get(r.page)).add(r.result);
  }
  const by = { finding: [], nothing: [], "not read": [], unreadable: [] };
  newest.forEach((r, p) => by[r.result].push(p));
  const never = [];
  if (reg.length) for (let p = 1; p <= reg.length; p++) if (!newest.has(String(p))) never.push(String(p));
  /* a page whose earlier readings said something else: a "nothing" that replaced a finding must be seen */
  const changed = [...newest.keys()].filter(p => seen.get(p).size > 1);
  const who = new Map(); let first = "", last = "";
  newest.forEach(r => { if (r.result !== "finding" && r.result !== "nothing") return; who.set(r.who, (who.get(r.who) || 0) + 1); if (!first || r.date < first) first = r.date; if (r.date > last) last = r.date; });
  return { newest, by, never, changed, who, first, last, read: by.finding.length + by.nothing.length };
}
const HOW_LENGTH = address => "node tools/pages.js add \"" + address + "\" <page> <result> --who <text> --pages <n>   or   node tools/pages.js import-list \"" + address + "\" <list.tsv>";
function showText(reg) {
  const s = summary(reg), L = [];
  const line = (name, pages) => { if (pages.length) L.push("  " + name + " (" + pages.length + "): " + ranges(pages)); };
  L.push(reg.address);
  L.push("  what: " + (reg.what || NOT_SAID));
  L.push("  list: archive/coverage/" + reg.key + ".tsv");
  L.push("  read in full: " + s.read + (reg.length ? " of " + reg.length + " pages" : " pages (the register's length is not known)") +
    (s.read ? ", " + (s.first === s.last ? "on " + s.last : s.first + " to " + s.last) + ", by " + [...s.who].map(([w, n]) => w + " (" + n + ")").join(", ") : ""));
  line("finding", s.by.finding);
  line("nothing", s.by.nothing);
  line("unreadable, not a negative", s.by.unreadable);
  line("not read, not a negative", s.by["not read"]);
  if (reg.length) line("never read", s.never);
  else L.push("  never read: cannot be said without the register's length. Give it once: " + HOW_LENGTH(reg.address));
  if (s.changed.length) L.push("  an earlier reading said something else (the file has every row): " + ranges(s.changed));
  const noted = r => "    " + r.page + "  " + r.date + "  " + r.who + (r.id ? "  " + r.id : "") + (r.note ? "  " + r.note : "");
  const rowsOf = k => s.by[k].map(p => s.newest.get(p)).sort((a, b) => (+a.page || 0) - (+b.page || 0) || (a.page < b.page ? -1 : 1));
  if (s.by.finding.length) L.push("  the findings:", ...rowsOf("finding").map(noted));
  if (s.by.unreadable.length) L.push("  the unreadable pages:", ...rowsOf("unreadable").map(noted));
  if (reg.bad.length) L.push("  WARNING: " + reg.bad.length + " line(s) of the file could not be read and count for nothing (line " + reg.bad.slice(0, 10).join(", ") + "). Each row is: page, id, date (YYYY-MM-DD), who, result, note, with tabs between.");
  return L.join("\n");
}

/* ---------- the command line ---------- */
const VALUED = ["--who", "--what", "--note", "--date", "--id", "--pages", "--limit"];
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUED.includes(a)) { if (i + 1 >= argv.length) throw refusal(a + " needs a value"); opt[a.slice(2)] = argv[++i]; }
    else if (a === "--list") opt.list = true;
    else if (a === "--new") opt.new = true;
    else if (/^--[a-z]/.test(a)) throw refusal(a + " is not an option of pages.js.\n" + USAGE);
    else pos.push(a);
  }
  return { pos, opt };
}
const USAGE = "usage: node tools/pages.js add <register address> <page | a-b> <finding | nothing | \"not read\" | unreadable> --who <text> [--what \"<register title>\"] [--note \"<text>\"] [--date YYYY-MM-DD] [--id <page id>] [--pages <n>] [--new]\n" +
  "       node tools/pages.js show <register address>\n" +
  "       node tools/pages.js unread <register address> [--list [--limit <n>|all]]\n" +
  "       node tools/pages.js list\n" +
  "       node tools/pages.js import-list <register address> <tsv> [--what \"<register title>\"]";
/* asked before anything else, so a read-only session is told at once and not sent to mend its arguments first */
function mayWrite(cmd) {
  if (process.env.FT_READONLY === "1") throw refusal("this session was set up read-only (FT_READONLY=1), so pages.js " + cmd + " writes nothing: its file could not be pushed and would be lost. Keep the pages in your report, and record them from a session that may write (bash tools/cloud-setup.sh without FT_READONLY).");
}
const SAVED = "Not committed. Before finishing:  (cd \"" + ARCHIVE + "\" && git add archive/coverage && git commit -m \"Add page lists\")";
const known = given => {
  const f = find(given);
  if (!f.reg) throw refusal("there is no page list for " + JSON.stringify(f.n.address) + " yet. " + (f.from ? "It goes on from " + f.from.address + ", which has one: if that is the register, give that address. " : "") + "node tools/pages.js list  shows the registers that have one; the first add or import-list for a register starts its list.");
  return f.reg;
};
function main(argv) {
  const cmd = argv[0], { pos, opt } = parseArgs(argv.slice(1));
  switch (cmd) {
    case "add": {
      mayWrite(cmd);
      const [address, pageArg, resArg] = pos;
      if (!address || !pageArg || !resArg || pos.length > 3) throw refusal((pos.length > 3 ? "too many words (put a result of two words, a title or a note in quotes).\n" : "") + USAGE);
      const result = RESULTS.includes(oneLine(resArg).toLowerCase()) ? oneLine(resArg).toLowerCase() : ALIAS[oneLine(resArg).toLowerCase()];
      if (!result) throw refusal(JSON.stringify(resArg) + " is not a result. Say one of: finding (the page holds something for us), nothing (read in full, nothing for us), \"not read\" (opened, not read), unreadable.");
      const who = oneLine(opt.who);
      if (!who) throw refusal("say which run or card read the page: --who <text> (such as the card or the run's name; no personal names)");
      const date = opt.date === undefined ? today() : opt.date;
      if (!isDate(date)) throw refusal("--date must be YYYY-MM-DD, the day the page was read");
      if (date > today()) throw refusal("--date " + date + " is in the future: give the day the page was read");
      const note = oneLine(opt.note);
      if (result === "finding" && !note) throw refusal("a finding needs --note \"<what the page holds, in a few words>\", so the next run knows what is there without reading it again");
      const pages = pagesOf(pageArg);
      if (opt.id !== undefined && pages.length > 1) throw refusal("--id names one page's own id, and this adds " + pages.length + " pages. Add that page by itself, or leave --id out.");
      let length = null;
      if (opt.pages !== undefined) { if (!/^[1-9]\d{0,5}$/.test(opt.pages)) throw refusal("--pages is how many pages the register has, a whole number"); length = +opt.pages; }
      const f = find(address, opt.new), reg = f.reg || { address: f.n.address, what: "", length: null, ids: new Map(), rows: [] };
      notAPage(f, "add", "<page> <result> --who <text>");
      const len = length || reg.length;
      const past = len ? pages.filter(p => /^\d+$/.test(p) && +p > len) : [];
      if (past.length) throw refusal("page " + ranges(past) + " is past the end of the register, which has " + len + " pages. If it is longer than that, say so with --pages <n>; if the page number is a slip, correct it.");
      const lines = f.reg ? [] : header(reg.address, oneLine(opt.what));
      if (f.reg && oneLine(opt.what) && oneLine(opt.what) !== reg.what) lines.push("# what: " + oneLine(opt.what));
      if (length && length !== reg.length) lines.push("# length: " + length);
      const ownId = oneLine(opt.id) || (pages.length === 1 ? f.n.page : "");
      for (const p of pages) lines.push([p, ownId || (reg.ids.get(p) || {}).id || "", date, who, result, note].join("\t"));
      const dir = folder(true), file = path.join(dir, f.key + ".tsv");   /* made only now: a refused add leaves no empty folder */
      unionRule(dir);
      append(file, lines);
      const now = parse(fs.readFileSync(file, "utf8")), s = summary(now);
      console.log("recorded " + pages.length + " page" + (pages.length === 1 ? "" : "s") + " (" + ranges(pages, 8) + ") as " + result + " in archive/coverage/" + f.key + ".tsv" + (f.reg ? "" : " (a new list)"));
      console.log("this register now: " + s.read + (now.length ? " of " + now.length : "") + " read in full, " + s.by.finding.length + " with a finding" + (now.length ? ", " + s.never.length + " never read" : "") + ". " + SAVED);
      if (f.alias) console.log(ALIAS_NOTE(f, address));
      if (!now.what) console.log("  NOTE  the list does not say what this register is. Say it once: add --what \"<register title>\" to the next add.");
      if (!f.reg && !now.length) console.log("  NOTE  the register's length is not known, so the pages never read cannot be listed. Give it once: " + HOW_LENGTH(now.address));
      return;
    }
    case "import-list": {
      mayWrite(cmd);
      const [address, tsv] = pos;
      if (!address || !tsv || pos.length > 2) throw refusal(USAGE);
      let text;
      try { text = fs.readFileSync(tsv, "utf8"); } catch (e) { throw refusal("the list " + tsv + " cannot be read (" + (e.code || e.message) + "). Give the path of a file with one page a line: number, id, address, with tabs between."); }
      const rows = new Map();
      text.split(/\r?\n/).forEach((line, i) => {
        if (!line.trim() || line.startsWith("#")) return;
        const c = line.split("\t").map(x => x.trim());
        if (!/^[1-9]\d*$/.test(c[0])) throw refusal("line " + (i + 1) + " of " + tsv + " does not start with a page number. The list is one page a line: number, id, address, with tabs between.");
        const had = rows.get(c[0]);
        if (had && had.id !== (c[1] || "")) throw refusal("page " + c[0] + " is in " + tsv + " twice with two ids (line " + (i + 1) + "). Correct the list, then run this again.");
        rows.set(c[0], { id: c[1] || "", address: c[2] || "" });
      });
      if (!rows.size) throw refusal(tsv + " lists no pages. The list is one page a line: number, id, address, with tabs between.");
      const length = Math.max(...[...rows.keys()].map(Number));
      const f = find(address, opt.new), reg = f.reg || { address: f.n.address, what: "", length: null, ids: new Map(), rows: [] };
      notAPage(f, "import-list", "<tsv>");
      const lines = f.reg ? [] : header(reg.address, oneLine(opt.what));
      if (f.reg && oneLine(opt.what) && oneLine(opt.what) !== reg.what) lines.push("# what: " + oneLine(opt.what));
      if (length !== reg.length) lines.push("# length: " + length);
      let fresh = 0;
      rows.forEach((v, p) => { const k = reg.ids.get(p); if (!k || k.id !== v.id || k.address !== v.address) { lines.push(["#id", p, v.id, v.address].join("\t")); fresh++; } });
      if (lines.length) { const dir = folder(true); unionRule(dir); append(path.join(dir, f.key + ".tsv"), lines); }
      console.log("archive/coverage/" + f.key + ".tsv" + (f.reg ? "" : " (a new list)") + ": the register has " + length + " pages" + (reg.length && reg.length !== length ? " (it said " + reg.length + " before)" : "") +
        "; " + fresh + " page id" + (fresh === 1 ? "" : "s") + " recorded" + (rows.size - fresh ? ", " + (rows.size - fresh) + " already there" : "") + ". Nothing was marked read.");
      if (rows.size !== length) console.log("  NOTE  the list has " + rows.size + " pages but its highest number is " + length + ": some numbers are missing from it, and they count as never read.");
      if (lines.length) console.log(SAVED);
      if (f.alias && lines.length) console.log(ALIAS_NOTE(f, address));
      if (!reg.what && !oneLine(opt.what)) console.log("  NOTE  the list does not say what this register is. Say it once: run this again with --what \"<register title>\".");
      return;
    }
    case "show": {
      if (pos.length !== 1) throw refusal(USAGE);
      console.log(showText(known(pos[0])));
      return;
    }
    case "unread": {
      if (pos.length !== 1) throw refusal(USAGE);
      const reg = known(pos[0]), s = summary(reg);
      const marked = s.by["not read"], todo = [...marked, ...s.never].sort((a, b) => (+a || Infinity) - (+b || Infinity));
      console.log(reg.address + (reg.what ? "  (" + reg.what + ")" : ""));
      if (reg.length) console.log("  still to read: " + todo.length + " of " + reg.length + " pages" + (todo.length ? ": " + ranges(todo) : " (every page has been read)"));
      else console.log("  marked not read: " + (marked.length ? marked.length + ": " + ranges(marked) : "none") + ". The pages never opened cannot be listed without the register's length. Give it once: " + HOW_LENGTH(reg.address));
      if (s.by.unreadable.length) console.log("  unreadable, so not a negative (" + s.by.unreadable.length + "): " + ranges(s.by.unreadable));
      if (opt.list) {
        if (opt.limit !== undefined && !/^(all|[1-9]\d*)$/.test(opt.limit)) throw refusal("--limit takes a number, or all");
        const n = opt.limit === "all" ? todo.length : opt.limit ? +opt.limit : LIST_LIMIT;
        todo.slice(0, n).forEach(p => { const k = reg.ids.get(p) || {}; console.log([p, k.id || "", k.address || ""].join("\t")); });
        if (todo.length > n) console.log("… " + (todo.length - n) + " more: add --limit <n> (or --limit all)");
      } else if (todo.length) console.log("  one page a line, with its id and address where the list has them: add --list");
      return;
    }
    case "list": {
      const all = registers();
      if (!all.length) { console.log("no register has a page list yet (" + path.join(ARCHIVE, ...SUB) + "). The first add or import-list for a register starts one."); return; }
      for (const reg of all) {
        const s = summary(reg);
        console.log(reg.key + "  " + s.read + (reg.length ? "/" + reg.length : "/?") + " read, " + s.by.finding.length + " finding" + (s.by.finding.length === 1 ? "" : "s") + (s.last ? ", newest " + s.last : "") +
          "  " + (reg.what || NOT_SAID) + "  " + reg.address);
      }
      return;
    }
    default:
      console.error(USAGE);
      process.exit(2);
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error((e.refused ? "REFUSED: " : "FAILED: ") + e.message); process.exit(1); }
}
module.exports = { ARCHIVE, DIR, RESULTS, normal, keyOf, parse, summary, ranges, pagesOf, showText };
