#!/usr/bin/env node
/*
 * Browser checks for the Research view and the Map's load-on-open (3 Oct 2026).
 *
 *   node tests/browser.js            needs Playwright and its Chromium (npm i -g playwright); skips without them
 *
 * Builds a throwaway site in a temp folder from THIS index.html: an invented family (no real people),
 * invented research, sealed with a throwaway password exactly as tools/payload.js and tools/research.js
 * seal the real ones, plus the real map file. Serves it like GitHub Pages (gzip, ETags, 304s), and
 * proves in Chromium what Cory asked for on 2 Oct 2026: a visit that never opens Map or Research
 * requests nothing for them; the first opening fetches each file once; the badges, the views, a
 * link straight to an investigation, the phone's Back button and French all work, with no page errors.
 * Run it after any change to the page's shell; the PC session runs it before deploying the tab.
 *
 *   node tests/browser.js --real <folder>
 *
 * The same, with the REAL data.json and research.json re-sealed under a throwaway password in a temp
 * folder (deleted afterwards): opens every investigation on a wide screen and on a phone, in English and
 * French, fails on any page error, and saves screenshots to <folder> for a person to read. Never the
 * family's password, and never anything written inside the repo. <folder> must be outside it (it shows
 * real names): use a private folder such as "Claude outputs".
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), zlib = require("zlib"), crypto = require("crypto");
let chromium;
try { ({ chromium } = require("playwright")); } catch (_) { console.log("  --  Playwright is not installed here (npm i -g playwright): browser checks skipped"); process.exit(0); }
const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "tools", "payload.js"));
const RJ = require(path.join(ROOT, "tools", "research.js"));
const PW = "throwaway-test-password";
const SALT = Buffer.from("fixture-salt-16b").toString("base64"), ITER = 1000;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "ftbrowser-"));
const REAL = process.argv.includes("--real") ? path.resolve(process.argv[process.argv.indexOf("--real") + 1] || "") : null;
if (REAL && (!process.argv[process.argv.indexOf("--real") + 1] || REAL.startsWith(path.resolve(ROOT) + path.sep) || REAL === path.resolve(ROOT))) {
  console.error("--real needs a folder for the screenshots, outside the repo (they show real names)"); process.exit(2);
}
const SHOTS = REAL || process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- the invented family and research ---------- */
let n = 0;
const id = () => "c" + String(++n).padStart(3, "0");
const gaz = {
  alpha: { n: "Alphaville", n_fr: "Alphaville", c: "Haut-Rhin, France", c_fr: "Haut-Rhin, France", lat: 48.04, lon: 7.13, k: "town" },
  beta: { n: "Betaburg", n_fr: "Betaburg", c: "Bas-Rhin, France", c_fr: "Bas-Rhin, France", lat: 48.58, lon: 7.75, k: "town" },
  gamma: { n: "Gamma City", n_fr: "Gamma City", c: "Ohio, United States", c_fr: "Ohio, États-Unis", lat: 41.5, lon: -81.69, k: "city" },
  delta: { n: "Deltadam", n_fr: "Deltadam", c: "Lowland coast, Netherlands", c_fr: "Côte basse, Pays-Bas", lat: 52.37, lon: 4.9, k: "city" },
  epsilon: { n: "Epsilon Atoll", n_fr: "Atoll Epsilon", c: "Pacific Ocean", c_fr: "Océan Pacifique", lat: 21.3, lon: -157.86, k: "island" }
};
function person(name, years, g, extra) {
  const p = Object.assign({ id: id(), name, years, g, note: name + " was a test person.", note_fr: name + " était une personne de test.", src: [{ l: "Test register, act 1" }],
    pl: [{ k: "alpha", t: "birth", c: "doc", y: +(String(years).match(/\d{4}/) || [1600])[0] }] }, extra || {});
  return p;
}
const kids = (...c) => c;
/* the trunk: five generations; then one small family per branch, each head carrying its anchor */
const BR = [["fr", "fr"], ["east", "us-east"], ["west", "us-west"], ["ohio", "us-ohio"], ["doubs", "fr-doubs"], ["colmar", "colmar"], ["paris", "fr-paris"], ["nl", "nl"], ["schw", "schw"]];
const g5 = person("Octavus Testmann", "1627–1694", "m", { profile: { headline: "Beekeeper", headline_fr: "Apiculteur", bio: ["Octavus kept bees in Alphaville.", "He had two wives."], bio_fr: ["Octavus élevait des abeilles à Alphaville.", "Il eut deux épouses."] } });
g5.unions = [{ s: "Ottilie Probe", sy: "1650", c: BR.map(([key, bid], i) => {
  const h = person("Branch" + (i + 1) + " Testmann", (1670 + i) + "–" + (1730 + i), i % 2 ? "f" : "m", { anchor: key, branch: bid,
    pl: [{ k: i % 2 ? "beta" : "gamma", t: "birth", c: "doc", y: 1670 + i }, { k: "delta", t: "residence", c: "inf", y: 1700 + i, w: "Inferred from a test.", w_fr: "Déduit d’un test." }] });
  /* the last branch has no living daughter: a line where no one is living, for the dead-lines switch (17 Oct 2026) */
  const son = person("Child" + (i + 1) + " Testmann", String(1700 + i) + "–" + (1760 + i), "m");
  /* and its son ends his days on an island far from everyone: alone on the map in Play (17 Oct 2026) */
  if (i === BR.length - 1) son.pl.push({ k: "epsilon", t: "residence", c: "doc", y: 1740 });
  h.unions = [{ s: "Spouse" + (i + 1) + " Probe", sy: String(1695 + i), c: [son]
    .concat(i === BR.length - 1 ? [] : [person("Daughter" + (i + 1) + " Testmann", "b. " + (1950 + i), "f")]) }];
  return h;
}) }];
const g4 = person("Septimus Testmann", "1598–1661", "m", { unions: [{ s: "Tertia Probe", sy: "1622", c: [g5] }] });
const g3 = person("Sextus Testmann", "1566–1629", "m", { unions: [{ s: "Wendeline Probe", sy: "1593", c: [g4] }] });
const g2 = person("Quintus Testmann", "c. 1531–1597", "m", { unions: [{ s: "", c: [g3] }] });
const root = person("Probus Testmann", "c. 1495", "m", { anchor: "trunk", branch: "legacy", tag: "author", unions: [{ s: "", c: [g2] }],
  profile: { headline: "The oldest", headline_fr: "Le plus ancien", bio: ["Probus is the oldest test person."], bio_fr: ["Probus est la plus ancienne personne de test."] } });
root.gaz = gaz;
/* ids in tree order, as the real tree has them (the person, then each union's children) */
{ let k = 0; (function walk(p) { p.id = "c" + String(++k).padStart(3, "0"); (p.unions || []).forEach(u => (u.c || []).forEach(walk)); })(root); }
const idOf = {}; (function walk(p) { idOf[p.name] = p.id; (p.unions || []).forEach(u => (u.c || []).forEach(walk)); })(root);

/* the research: three topics, five investigations, every status and every question state, one visit list.
   All of it is made up — a mill, a millstone, a bakery, a sailor, a shop sign — and none of it follows the
   family's own research (review, 3 Oct 2026): this file is public, and Pages serves it. */
const R = {
  schema: 1, updated: "2026-10-03",
  themes: [
    { id: "t1", name: "The mill years", name_fr: "Les années du moulin", blurb: "Who ran the Alphaville mill, and when.", blurb_fr: "Qui tenait le moulin d’Alphaville, et quand.", icon: "M12 3v18M3 12h18" },
    { id: "t2", name: "Across the water", name_fr: "De l’autre côté de l’eau", blurb: "Relatives who may have sailed away.", blurb_fr: "Des parents peut-être partis en bateau.", icon: "M3 17c3 2 6 2 9 0s6-2 9 0" },
    { id: "t3", name: "Small puzzles", name_fr: "Petites énigmes", blurb: "Odd details on cards already drawn.", blurb_fr: "Des détails curieux sur des fiches déjà en place.", icon: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z" }
  ],
  visits: { v1: { name: "Alphaville mill museum", name_fr: "Musée du moulin d’Alphaville", short: "Mill museum", short_fr: "Musée du moulin",
    access: "Open on Saturday mornings. Nothing can be borrowed.", access_fr: "Ouvert le samedi matin. Rien ne peut être emprunté.", who: "A neighbour", who_fr: "Une voisine", st: "visit", since: "2026-09-20",
    next: "The neighbour can go on the first Saturday of the month.", next_fr: "La voisine peut y aller le premier samedi du mois.",
    log: [["2026-09-18", "The museum said the ledgers are on open shelves.", "Le musée a dit que les registres sont en libre accès."], ["2026-09-29", "The neighbour offered to take photographs.", "La voisine a proposé de prendre des photos."]] } },
  investigations: [
    { id: "i1", theme: "t1", title: "Who first ran the mill?", title_fr: "Qui a tenu le moulin en premier ?", line: "Alphaville · the 1500s", line_fr: "Alphaville · le XVIe siècle", branch: "legacy", imp: 2, updated: "2026-10-02",
      next: "Read the mill’s first ledger at the museum.", next_fr: "Lire le premier registre du moulin au musée.",
      summary: "Probus is the oldest person on the tree. A family story says he ran the mill.", summary_fr: "Probus est la personne la plus ancienne de l’arbre. Une histoire de famille dit qu’il tenait le moulin.",
      people: [{ card: "c001", n: "Probus Testmann", y: "c. 1495" }, { card: "c002", n: "Quintus Testmann", y: "c. 1531–1597" }],
      qs: [
        { q: "Does the first ledger name Probus?", q_fr: "Le premier registre nomme-t-il Probus ?", note: "The ledgers start in the middle of the century.", note_fr: "Les registres commencent au milieu du siècle.", state: "open",
          src: [
            { id: "s1", t: "The first mill ledger", t_fr: "Le premier registre du moulin", where: "Mill museum · shelf A", where_fr: "Musée du moulin · étagère A", how: "In person", how_fr: "Sur place", st: "visit", who: "A neighbour", who_fr: "Une voisine", since: "2026-09-20", visit: "v1", next: "Photograph the first twenty pages.", next_fr: "Photographier les vingt premières pages.", why: "It is the only record of who ran the mill.", why_fr: "C’est le seul document qui dit qui tenait le moulin." },
            { id: "s2", t: "A booklet on the mill (1911)", t_fr: "Une brochure sur le moulin (1911)", where: "Town library · online", where_fr: "Bibliothèque municipale · en ligne", how: "Online", how_fr: "En ligne", st: "found", since: "2026-09-15", log: [["2026-09-15", "Read. It names the mill, not who ran it.", "Lu. Elle nomme le moulin, pas qui le tenait."]] }
          ] },
        { q: "Did Quintus take over the mill?", q_fr: "Quintus a-t-il repris le moulin ?", note: "A sketch of the mill shows two men.", note_fr: "Un croquis du moulin montre deux hommes.", state: "lead",
          src: [{ id: "s3", t: "The sketch’s caption", t_fr: "La légende du croquis", where: "Town library · online", where_fr: "Bibliothèque municipale · en ligne", how: "Online", how_fr: "En ligne", st: "todo", who: "Cory, online", who_fr: "Cory, en ligne", since: "2026-10-02", next: "Find a larger copy of the sketch.", next_fr: "Trouver une copie plus grande du croquis." }] }
      ] },
    { id: "i2", theme: "t1", title: "The millstone’s carved year", title_fr: "L’année gravée sur la meule", line: "Alphaville", line_fr: "Alphaville", branch: "legacy", imp: 1, updated: "2026-09-30",
      next: "Cory’s call: ask the museum for a closer look?", next_fr: "À Cory de décider : demander au musée de regarder de plus près ?",
      summary: "A millstone in the museum garden carries a year nobody has read clearly.", summary_fr: "Une meule du jardin du musée porte une année que personne n’a lue clairement.",
      people: [{ card: "c001", n: "Probus Testmann", y: "c. 1495" }],
      qs: [{ q: "What year is carved on the stone?", q_fr: "Quelle année est gravée sur la meule ?", note: "", note_fr: "", state: "open",
        src: [
          { id: "s4", t: "The millstone itself", t_fr: "La meule elle-même", where: "Mill museum · garden", where_fr: "Musée du moulin · jardin", how: "In person", how_fr: "Sur place", st: "visit", who: "A neighbour", who_fr: "Une voisine", since: "2026-09-20", visit: "v1", next: "Photograph it in low sunlight.", next_fr: "La photographier en lumière rasante." },
          { id: "s5", t: "A rubbing of the stone", t_fr: "Un frottis de la meule", where: "Mill museum · by permission", where_fr: "Musée du moulin · sur autorisation", how: "By request", how_fr: "Sur demande", st: "cory", who: "Cory", who_fr: "Cory", since: "2026-09-24", next: "Cory’s call.", next_fr: "À Cory de décider." },
          { id: "s6", t: "The museum guide’s notes", t_fr: "Les notes du guide du musée", where: "Mill museum · office", where_fr: "Musée du moulin · bureau", how: "By request", how_fr: "Sur demande", st: "wait", who: "The museum", who_fr: "Le musée", since: "2026-09-30", log: [["2026-09-30", "The guide will look through his notes.", "Le guide va parcourir ses notes."]] },
          { id: "s7", t: "Old postcards of the mill", t_fr: "Vieilles cartes postales du moulin", where: "Postcard sellers", where_fr: "Vendeurs de cartes postales", how: "Online", how_fr: "En ligne", st: "none", since: "2026-09-19" }
        ] }] },
    { id: "i3", theme: "t2", title: "The Deltadam bakers", title_fr: "Les boulangers de Deltadam", line: "Betaburg → Deltadam", line_fr: "Betaburg → Deltadam", branch: "nl", imp: 1, updated: "2026-10-03",
      next: "Look for the founder’s burial.", next_fr: "Chercher l’inhumation du fondateur.",
      summary: "A bakery in Deltadam kept the family name for three generations.", summary_fr: "Une boulangerie de Deltadam a gardé le nom de la famille pendant trois générations.",
      people: [{ card: "c009", n: "Branch3 Testmann", y: "1672–1732" }],
      qs: [
        { q: "Did one of ours open the bakery?", q_fr: "L’un des nôtres a-t-il ouvert la boulangerie ?", note: "Yes, by 1702.", note_fr: "Oui, dès 1702.", state: "answered",
          src: [{ id: "s8", t: "A bakers’ guild roll", t_fr: "Un rôle de la guilde des boulangers", where: "City archives · online", where_fr: "Archives municipales · en ligne", how: "Online", how_fr: "En ligne", st: "found", since: "2026-10-01" }] },
        { q: "Should the bakers join the tree?", q_fr: "Faut-il ajouter les boulangers à l’arbre ?", note: "Yes.", note_fr: "Oui.", state: "answered",
          src: [{ id: "s9", t: "Cory’s decision", t_fr: "La décision de Cory", where: "Asked on 1 October", where_fr: "Demandé le 1er octobre", how: "Decision", how_fr: "Décision", st: "done", since: "2026-10-01" }] },
        { q: "When did the founder die?", q_fr: "Quand le fondateur est-il mort ?", note: "No date yet.", note_fr: "Pas encore de date.", state: "open", people: [{ card: "c009", n: "Branch3 Testmann", y: "1672–1732" }],
          src: [{ id: "s10", t: "A burial list", t_fr: "Une liste d’inhumations", where: "City archives · online", where_fr: "Archives municipales · en ligne", how: "Online", how_fr: "En ligne", st: "ready", who: "Cory, online", who_fr: "Cory, en ligne", since: "2026-10-02", next: "Search the list.", next_fr: "Parcourir la liste." }] }
      ] },
    { id: "i4", theme: "t2", title: "A cousin who went to sea?", title_fr: "Un cousin parti en mer ?", line: "Unknown", line_fr: "Inconnu", branch: "", imp: 0, updated: "2026-10-02",
      next: "Set aside for now.", next_fr: "Mis de côté pour l’instant.", summary: "A letter mentions a cousin who went to sea. Nothing else is known.", summary_fr: "Une lettre parle d’un cousin parti en mer. On n’en sait pas plus.", people: [],
      qs: [{ q: "Is there a crew list to check?", q_fr: "Existe-t-il un rôle d’équipage à consulter ?", note: "", note_fr: "", state: "open",
        src: [{ id: "s11", t: "A paid record search", t_fr: "Une recherche payante", where: "A records service", where_fr: "Un service de recherche", how: "Paid", how_fr: "Payant", st: "hold", who: "Cory", who_fr: "Cory" }] }] },
    { id: "i5", theme: "t3", title: "The Gamma City shop sign", title_fr: "L’enseigne de Gamma City", line: "Alphaville → Gamma City", line_fr: "Alphaville → Gamma City", branch: "ohio", imp: 3, updated: "2026-10-03",
      next: "Check both directories for the shop’s first year.", next_fr: "Chercher la première année de la boutique dans les deux annuaires.",
      summary: "A photograph shows the family name over a shop door. The year is cut off.", summary_fr: "Une photo montre le nom de la famille au-dessus d’une boutique. L’année est coupée.", people: [{ card: "c010", n: "Branch4 Testmann", y: "1673–1733" }],
      qs: [{ q: "Which year did the shop open?", q_fr: "En quelle année la boutique a-t-elle ouvert ?", note: "The photograph narrows it to one decade.", note_fr: "La photo la situe dans une décennie.", state: "partly",
        src: [
          { id: "s12", t: "A trade directory, 1851", t_fr: "Un annuaire du commerce, 1851", where: "Library · online", where_fr: "Bibliothèque · en ligne", how: "Online", how_fr: "En ligne", st: "ready", who: "Cory, online", who_fr: "Cory, en ligne", since: "2026-09-10" },
          { id: "s13", t: "A newspaper advert", t_fr: "Une annonce de journal", where: "Newspaper archive · online", where_fr: "Archives de presse · en ligne", how: "Online", how_fr: "En ligne", st: "ready", who: "Cory, online", who_fr: "Cory, en ligne", since: "2026-09-10" }
        ] }] }
  ]
};
(function fix(o) { if (Array.isArray(o)) o.forEach(fix); else if (o && typeof o === "object") { if (o.n && o.card && idOf[o.n]) o.card = idOf[o.n]; Object.values(o).forEach(fix); } })(R.investigations);
/* Cory's Decide buttons (register R-0445): a made-up page address and made-up card ids */
R.decide = "https://claude.ai/artifact/TestDecisionsPage1";
R.investigations.find(x => x.id === "i2").qs[0].src.find(s => s.id === "s5").dec = "x1";
R.visits.v1.dec = "x2";
R.investigations.find(x => x.id === "i4").dec = "x3";
/* a research card (register R-0448): the two sources we can read alone, online, both wait on it */
R.investigations.find(x => x.id === "i5").qs[0].src.forEach(s => { s.dec = "go1"; });
/* one person's archive visits (5 Oct 2026): the visit list's places and priorities */
{ const src = id => R.investigations.flatMap(iv => iv.qs.flatMap(q => q.src)).find(s => s.id === id);
  Object.assign(src("s1"), { pri: "A", pos: 1 }); Object.assign(src("s4"), { pri: "B", pos: 2 }); }
const cards = []; (function walk(p) { cards.push({ id: p.id, name: p.name, years: p.years }); (p.unions || []).forEach(u => (u.c || []).forEach(walk)); })(root);
const v = RJ.validate(R, { cards, quiet: true });
if (v.errors.length) { console.error(v.errors.join("\n")); process.exit(1); }


/* --real: the family's own data and research, under the throwaway password, never the real one */
const DATA0 = REAL ? JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8")) : root;
const R0 = REAL ? RJ.load() : R;
if (REAL) { const v2 = RJ.validate(R0, { quiet: true }); if (v2.errors.length) { console.error("research.json does not validate:\n" + v2.errors.join("\n")); process.exit(1); } }
const sealed = P.sealData(DATA0, PW, { salt: SALT, iter: ITER });
const page0 = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
fs.mkdirSync(path.join(OUT, "media"), { recursive: true });
fs.mkdirSync(path.join(OUT, "map"), { recursive: true });
/* the coronation's card: in the invented family, Daughter1 (b. 1950) */
fs.writeFileSync(path.join(OUT, "index.html"), page0.replace(/const ENC = \{[^\n]*\};/, () => sealed.line)
  .replace(/const PLAY_HERO = "[^"]*";/, () => REAL ? 'const PLAY_HERO = "' + (page0.match(/const PLAY_HERO = "([^"]*)";/) || ["", ""])[1] + '";' : 'const PLAY_HERO = "' + idOf["Daughter1 Testmann"] + '";'));
for (const [k, f] of sealed.media) fs.writeFileSync(path.join(OUT, "media", k + ".bin"), f);
const mapName = page0.match(/const MAPFILE = "([^"]+)";/)[1];
fs.copyFileSync(path.join(ROOT, mapName), path.join(OUT, mapName));
const rs = RJ.sealed(R0, PW, P.readEnc(sealed.line));
fs.writeFileSync(path.join(OUT, "media", "research.bin"), rs.data);
fs.writeFileSync(path.join(OUT, "media", "research-cards.bin"), rs.cards);
/* Cory's owner view (5 Oct 2026, register R-0475): invented figures under an invented owner key, sealed as
   tools/linkconf.js seals the real ones (an inner layer under the owner key, inside the payload key) */
const OKEY = crypto.randomBytes(32), OKEY64 = OKEY.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const CONF0 = { v: 1, made: "2026-10-05", l: {} };
(function walk(p) { (p.unions || []).forEach(u => (u.c || []).forEach(c => { CONF0.l[c.id] = { p: 95, e: 95, w: "A test record names the parent." }; walk(c); })); })(DATA0);
if (!REAL) {
  CONF0.l[idOf["Quintus Testmann"]] = { p: 50, e: 50, w: "Only a test tree says so." };
  CONF0.l[idOf["Octavus Testmann"]] = { p: 80, e: 60, w: "A test record fits.", o: "My own test note." };
}
{
  const json = Buffer.from(JSON.stringify(CONF0)), body = zlib.deflateRawSync(json), head = "c:" + json.length, iv = crypto.randomBytes(12);
  const inner = Buffer.concat([iv, P.gcmSeal(OKEY, iv, Buffer.concat([Buffer.from([head.length]), Buffer.from(head, "latin1"), body]))]);
  fs.writeFileSync(path.join(OUT, "media", "owner.bin"), P.sealBlob(P.keyFor(PW, SALT, ITER), "o", inner, Buffer.concat([Buffer.from("owner\0"), inner])).file);
}
/* everyone's figures (5 Oct 2026, register R-0481): the figure the tree shows for each link, and nothing else,
   under the payload key alone, as tools/linkconf.js build writes media/links.bin */
{
  const l = {};
  Object.keys(CONF0.l).forEach(id => { l[id] = { p: CONF0.l[id].p }; });
  const json = Buffer.from(JSON.stringify({ v: 1, l }));
  fs.writeFileSync(path.join(OUT, "media", "links.bin"), P.sealBlob(P.keyFor(PW, SALT, ITER), "k:" + json.length, zlib.deflateRawSync(json), Buffer.concat([Buffer.from("links\0"), json])).file);
}

/* Play's history notes (17 Oct 2026): invented ones, sealed as tools/history.js seals the real ones */
{
  const json = Buffer.from(JSON.stringify([
    { y: 1600, y2: null, en: "A test event in 1600", fr: "Un événement de test en 1600", src: "Test source", url: "https://example.org/a" },
    { y: 1700, y2: 1705, en: "Another test event, 1700–1705", fr: "Un autre événement de test, 1700–1705", src: "Test source", url: "https://example.org/b" }]
    /* five a year apart, which Play at its top speed passes in half a second (the notes test, 20 Oct 2026) */
    .concat([0, 1, 2, 3, 4].map(i => ({ y: 1800 + i, y2: null, en: "A close test event in " + (1800 + i), fr: "Un événement de test rapproché en " + (1800 + i),
      src: "Test source", url: "https://example.org/c" + i })))));
  fs.writeFileSync(path.join(OUT, "media", "history.bin"), P.sealBlob(P.keyFor(PW, SALT, ITER), "h:" + json.length, zlib.deflateRawSync(json), Buffer.concat([Buffer.from("history\0"), json])).file);
}

/* the public demo's server (corynitschelm.com) sends this policy: fetch() may reach only the page's own site, so a
   demo that fetched data: addresses would show a blank map and no research there (it did until 18 Oct 2026) */
const DEMO_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'";
/* ---------- a server like GitHub Pages: gzip, ETags and 304s, and a log of what was asked for ---------- */
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".bin": "application/octet-stream" };
const reqLog = [];
/* for the loading checks: a file that is missing for now (a 404 that may be cached, as Pages serves them),
   and a file that is slow to arrive */
const FAIL = new Set(), DELAY = new Map();
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (FAIL.has(u)) { reqLog.push({ u, s: 404 }); res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "max-age=600" }); return res.end("missing"); }
  const send = () => {
    const f = path.join(OUT, u.replace(/^\//, "").replace(/(^|\/)$/, "$1index.html"));   /* a folder: its index.html */
    if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { reqLog.push({ u, s: 404 }); res.writeHead(404); return res.end(); }
    const body = fs.readFileSync(f), etag = '"' + crypto.createHash("sha1").update(body).digest("hex").slice(0, 16) + '"';
    if (req.headers["if-none-match"] === etag) { reqLog.push({ u, s: 304 }); res.writeHead(304, { ETag: etag, "Cache-Control": "max-age=600" }); return res.end(); }
    reqLog.push({ u, s: 200 });
    const head = { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Content-Encoding": "gzip", ETag: etag, "Cache-Control": "max-age=600" };
    if (u.startsWith("/demo/")) head["Content-Security-Policy"] = DEMO_CSP;   /* the demo's folder: the policy its server sends */
    res.writeHead(200, head);
    res.end(zlib.gzipSync(body));
  };
  if (DELAY.has(u)) setTimeout(send, DELAY.get(u)); else send();
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.error("  FAIL " + m); } };
let BASE = "";
const log = async () => reqLog.slice();
const reset = async () => { reqLog.length = 0; };
const got = (L, re) => L.filter(x => re.test(x.u));
const shot = (page, name, opts) => SHOTS ? page.screenshot(Object.assign({ path: path.join(SHOTS, name) }, opts || {})) : Promise.resolve();
const MAPURL = "/" + mapName;
/* the state that matters after a view change: which view, and what the address says */
const where = page => page.evaluate(() => ({ res: document.body.classList.contains("resmode"), map: document.body.classList.contains("mapmode"), hash: location.hash }));
/* relative luminance of a computed CSS colour */
const lum = c => { const m = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return m.length === 3 ? 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] : NaN; };

/* WCAG 2.5.3, label in name (18 Oct 2026): a control's spoken name holds the words it shows. This is axe 4.14's
   label-content-name-mismatch, ported (axe is not a dependency here): it looks at widgets whose role takes its name from
   their content (button, link, tab, menuitem, option, gridcell, treeitem) and that carry aria-label or aria-labelledby.
   The text shown is every text node visible on screen, joined in document order with nothing between them (a <br> is a
   space), so "1" next to "Alphaville" reads "1Alphaville". Both are lowercased, NFKD-normalised, stripped of anything in
   parentheses, every character that is not a letter or a number becomes a space, and they are split into words: the words
   shown must appear in the name as one unbroken run. Text that is a single non-digit character, "aa", "abc", or only
   symbols is left to a person (axe: needs review), as are switches, checkboxes and radios (their name may be a value). */
const nameMismatches = page => page.evaluate(() => {
  const SEG = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
  const words = s => {
    s = String(s || "").toLowerCase().normalize("NFKD");
    let was; do { was = s; s = s.replace(/\([^()]*\)/g, ""); } while (s !== was);
    s = s.replace(/[^\p{L}\p{N}]/gu, " ").replace(/\s+/g, " ").trim();
    return SEG ? [...SEG.segment(s)].map(x => x.segment.trim()).filter(Boolean) : s.split(/\s+/).filter(Boolean);
  };
  const sanitize = s => String(s || "").replace(/ /g, " ").replace(/\s{2,}/g, " ").trim();
  const readable = s => { s = sanitize(s); return !!s && !(s.length === 1 && /\D/.test(s)) && !["aa", "abc"].includes(s.toLowerCase()) &&
    !!s.replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, "").trim(); };
  const onScreen = el => el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!el.getClientRects().length;
  const shown = el => { let t = ""; (function walk(n) { n.childNodes.forEach(c => {
    if (c.nodeType === 3) { if (onScreen(c.parentElement)) t += c.nodeValue; }
    else if (c.nodeType === 1) { if (c.tagName === "BR") t += " "; else walk(c); } }); })(el); return sanitize(t); };
  const ROLES = new Set(["button", "link", "tab", "menuitem", "option", "gridcell", "treeitem"]);
  const roleOf = el => el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" && el.hasAttribute("href") ? "link" : "");
  const out = [];
  document.querySelectorAll("[aria-label], [aria-labelledby]").forEach(el => {
    if (!ROLES.has(roleOf(el)) || !onScreen(el)) return;
    const by = sanitize((el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || "").join(" "));
    const name = (by || sanitize(el.getAttribute("aria-label"))).toLowerCase(), text = shown(el).toLowerCase();
    if (!text || !name || !readable(name) || !readable(text)) return;
    const w = words(text), n = words(name);
    if (!w.length) return;
    for (let i = 0; i + w.length <= n.length; i++) if (w.every((x, j) => x === n[i + j])) return;
    out.push(JSON.stringify(shown(el)).slice(0, 40) + " is not in " + JSON.stringify(by || el.getAttribute("aria-label")).slice(0, 70));
  });
  return out;
});

async function unlock(page, opts) {
  await page.waitForSelector("#lockpw", { state: "visible" });
  await page.fill("#lockpw", PW);
  await page.click("#lockbtn");
  await page.waitForFunction(() => document.getElementById("lock").style.display === "none");
  /* the welcome card shows on a first visit: close it (unless the test is about it) */
  await page.waitForTimeout(400);
  if (opts && opts.keepIntro) return;
  if (await page.evaluate(() => document.getElementById("intro").style.display === "flex")) {
    await page.click("#introgo");
    await page.waitForTimeout(300);
  }
}

async function run() {
  const browser = await chromium.launch();
  const errors = [];
  /* every page error fails the run; so does every console error, except the 404 a test asks for on purpose */
  const watch = (page, label, expected404) => {
    page.on("pageerror", e => { errors.push(label + ": " + e.message); console.log("   PAGEERROR " + e.message + " | " + (e.stack || "").split("\n").slice(1, 3).join(" | ")); });
    page.on("console", m => { if (m.type() === "error" && !(expected404 && /status of 404/.test(m.text()))) errors.push(label + " console: " + m.text()); });
  };
  /* ---------------- Hide dead lines (Cory, 3 Oct 2026, register R-0444) ----------------
     Every branch head of the invented family has a dead son (1700s) and a living daughter (b. 195x). */
  {
    console.log("\n== desktop, hide dead lines");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "dead lines");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(800);
    const shown = nm => page.evaluate(nm => [...document.querySelectorAll(".node")].some(e => { const x = e.querySelector(".nm"); return x && x.textContent === nm && e.getBoundingClientRect().width > 0; }), nm);
    const pillOf = nm => page.evaluate(nm => { const e = [...document.querySelectorAll(".node")].find(e => { const x = e.querySelector(".nm"); return x && x.textContent === nm; }); const p = e && e.querySelector("[data-pill]"); return p ? p.textContent : null; }, nm);
    const pill = nm => page.click(`.node:has(.nm:text-is("${nm}")) [data-pill]`);
    await page.click("#filtbtn");
    await page.waitForSelector("#deadsw", { state: "visible" });
    ok((await page.getAttribute("#deadsw", "role")) === "switch" && (await page.getAttribute("#deadsw", "aria-checked")) === "true",
      "Hide dead lines is a switch in Filters, on when the tree opens");
    ok(await page.isHidden("#restart"), "…and with it on, the tree is as it opens (no Start over)");
    await shot(page, "dl1-filters.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok(await page.isHidden("#filters"), "Escape closes the Filters panel");
    let t = await pillOf("Branch1 Testmann");
    ok(t === "+1", "a card on a live line offers its living child first (" + t + ")");
    await pill("Branch1 Testmann");
    await page.waitForTimeout(500);
    t = await pillOf("Branch1 Testmann");
    ok(await shown("Daughter1 Testmann") && !(await shown("Child1 Testmann")) && /^\+1 /.test(t || ""),
      "one click shows the living daughter, and the pill offers the dead line (" + t + ")");
    await pill("Branch1 Testmann");
    await page.waitForTimeout(500);
    ok(await shown("Child1 Testmann"), "a second click opens the dead line directly");
    await page.click("#filtbtn");
    await page.click("#deadsw");
    await page.waitForTimeout(600);
    t = await pillOf("Branch2 Testmann");
    ok((await page.getAttribute("#deadsw", "aria-checked")) === "false" && t === "+2", "switched off, a card offers all its children (" + t + ")");
    ok(await page.isVisible("#restart"), "switched off, Start over appears");
    await page.click("#restart");
    await page.waitForTimeout(600);
    ok((await page.getAttribute("#deadsw", "aria-checked")) === "true", "Start over turns the switch back on");
    /* Cory, 17 Oct 2026: with the switch on, a branch picked by its tile shows its living lines only */
    await page.click("#filtbtn");
    await page.click('.tile[data-br="east"]');
    await page.waitForTimeout(600);
    t = await pillOf("Branch2 Testmann");
    ok(await shown("Daughter2 Testmann") && !(await shown("Child2 Testmann")) && /^\+1 /.test(t || ""),
      "switch on, a branch tile shows its living line and the pill offers the dead one (" + t + ")");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.click("#restart");
    await page.waitForTimeout(600);
    /* Cory, 17 Oct 2026 (R-0575): Show all with the switch on leaves out the branch where no one is living, and says so */
    await page.click("#filtbtn");
    await page.click("#fall");
    await page.waitForTimeout(600);
    const note2 = await page.isVisible("#toast") ? await page.textContent("#toastmsg") : "";
    ok((await page.getAttribute("#deadsw", "aria-checked")) === "true" && /Schweitzer branch is left out/.test(note2) && !(await shown("Child9 Testmann")) && !(await shown("Branch9 Testmann")),
      "Show all with the switch on: the all-dead branch stays out and a note says why (" + note2 + ")");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.click("#toast .tx");
    await page.click("#restart");
    await page.waitForTimeout(600);
    /* Cory, 17 Oct 2026: picking only a branch where no one is living turns the switch off, with a note saying why */
    await page.click("#filtbtn");
    await page.click('.tile[data-br="schw"]');
    await page.waitForTimeout(600);
    const note = await page.isVisible("#toast") ? await page.textContent("#toastmsg") : "";
    ok((await page.getAttribute("#deadsw", "aria-checked")) === "false" && /Schweitzer/.test(note) && (await page.getAttribute("#toast", "role")) === "status" &&
       await shown("Child9 Testmann"),
      "picking only a branch where no one is living turns the switch off, shows the branch, and a note says why (" + note + ")");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.click("#toast .tx");
    ok(await page.isHidden("#toast"), "…and the note's × closes it");
    await page.click("#restart");
    await page.waitForTimeout(600);
    /* Cory, 17 Oct 2026: living people are marked in the suggestions, so someone finds their own name */
    await page.fill("#search", "Daughter3");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    ok((await page.textContent("#suggest .it .lv")) === "Living", "a living person's suggestion is tagged Living");
    await page.fill("#search", "");
    await page.waitForTimeout(400);
    await page.fill("#search", "Child3");
    await page.waitForFunction(() => /Child3/.test((document.querySelector("#suggest .it") || {}).textContent || ""), null, { timeout: 3000 });
    ok(!(await page.$("#suggest .it .lv")), "…and a person on a dead line is not");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    await page.click("#suggest .it");
    await page.waitForTimeout(900);
    ok(await shown("Child3 Testmann"), "search still shows a person on a dead line, with the switch on");
    await page.click("#lang");
    await page.waitForTimeout(400);
    ok((await page.textContent("#dead-l")) === "Masquer les lignées éteintes", "the switch is in French too");
    await ctx.close();
  }
  /* ---------------- Play: the family over the years (Cory, 17 Oct 2026) ---------------- */
  {
    console.log("\n== desktop, play");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "play");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(600);
    await page.click("#vt-map");
    await page.waitForTimeout(1500);
    ok(await page.isVisible("#playchip"), "the map offers Play");
    await page.click("#playchip");
    await page.waitForTimeout(400);
    ok(await page.isVisible("#playbar") && await page.isHidden("#playchip") && (await page.$$("#mappins .pin")).length === 0,
      "Play opens its bar, in place of the map's pins");
    ok(await page.isHidden("#mapwhere") && await page.isHidden("#mapaim"), "Play shows no place pill: its faces and the names under them say where");
    ok(/green ring/.test(await page.textContent("#playbar .pbcaps")), "the first Play explains the rings once");
    const y1 = +(await page.textContent("#pbyear"));
    await page.waitForTimeout(1800);
    const y2 = +(await page.textContent("#pbyear"));
    ok(y1 >= 1494 && y1 <= 1496 && y2 > y1, "it starts the year before the first record and the years run (" + y1 + " → " + y2 + ")");
    ok((await page.$$("#playfaces .pf")).length >= 1, "faces come onto the map");
    await page.click("#pbplay");
    await page.waitForTimeout(300);
    const y3 = await page.textContent("#pbyear");
    await page.waitForTimeout(900);
    ok(y3 === await page.textContent("#pbyear") && (await page.getAttribute("#pbplay", "aria-label")) === "Play", "pause stops the years");
    const s1 = await page.textContent("#pbspeed");
    await page.click("#pbspeed");
    ok(s1 === "2 yr/s" && (await page.textContent("#pbspeed")) === "5 yr/s", "the speed steps from 2 to 5 years a second");
    const drawn = await page.evaluate(() => { const c = document.getElementById("pbhist"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    ok(drawn > 100, "the timeline draws the births, moves and deaths (" + drawn + " px)");
    ok((await page.$$("#pbmarks .pbm.h")).length === 7 && (await page.$$("#pbmarks .pbm.f")).length >= 3, "the history notes and the family's own are marked on the timeline");
    /* the notes over the bar (site audit, 20 Oct 2026: at 5 and 10 years a second a note was pushed off in 83 ms).
       The five notes of 1800 to 1804, played at the top speed: every one comes up, none leaves before 2.5 s, and
       two boxes at most, so close notes share one */
    await page.evaluate(() => { const r = document.getElementById("pbrange"); r.value = 1797; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.click("#pbspeed");
    const topSpeed = await page.textContent("#pbspeed");
    const watching = page.evaluate(() => new Promise(done => {
      const el = document.querySelector("#playbar .pbcaps"), t0 = performance.now(), first = {}, last = {};
      let most = 0;
      const look = () => {
        const t = performance.now() - t0, up = [...el.querySelectorAll(".pcap")].filter(b => !b.classList.contains("out"));
        most = Math.max(most, up.length);
        /* a note's words: its line's (or, one note to a box, the box's) first span */
        up.forEach(b => [...b.querySelectorAll(".pcl")].concat(b.querySelector(".pcl") ? [] : [b]).forEach(l => {
          const k = (l.querySelector("span") || {}).textContent || ""; if (!/^180[0-4] · /.test(k)) return; if (!(k in first)) first[k] = t; last[k] = t; }));
      };
      const mo = new MutationObserver(look);
      mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      const tick = setInterval(look, 40);
      setTimeout(() => {
        look(); mo.disconnect(); clearInterval(tick);
        const upNow = new Set([...el.querySelectorAll(".pcap:not(.out) span")].map(l => l.textContent));
        const span = Object.keys(first).map(k => first[k]);
        done({ seen: Object.keys(first).length, most, within: span.length ? Math.round(Math.max(...span) - Math.min(...span)) : -1,
          short: Object.keys(first).filter(k => !upNow.has(k) && last[k] - first[k] < 2400).map(k => k.slice(0, 4) + " " + Math.round(last[k] - first[k]) + " ms") });
      }, 6000);
    }));
    await page.click("#pbplay");
    const burst = await watching;
    await page.click("#pbplay");
    for (let i = 0; i < 3; i++) await page.click("#pbspeed");
    ok(topSpeed === "10 yr/s" && burst.seen === 5 && burst.within < 1500 && burst.most <= 2 && !burst.short.length && (await page.textContent("#pbspeed")) === "5 yr/s",
      "at 10 years a second, five notes a year apart all come up at once, none leaves before 2.5 s, two boxes at most (" + JSON.stringify(burst) + ")");
    /* in 1745 the nine sons are all on dead lines with no portrait. Seen from afar their home crowd has no room (a
       crowd in the Netherlands is close by), so they wait in a +N, but one face always shows (Cory, 17 Oct 2026: "never
       show JUST the +x"); the ninth, alone on his island, has his face */
    await page.evaluate(() => { const r = document.getElementById("pbrange"); r.value = 1745; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(500);
    const sons = () => page.evaluate(() => ({ sons: [...document.querySelectorAll("#playfaces .pf")].filter(e => e.style.display !== "none" && /^Child/.test(e.getAttribute("aria-label"))).map(e => e.getAttribute("aria-label").split(",")[0]).sort(),
      named: [...document.querySelectorAll("#playfaces .pf .pl")].filter(e => getComputedStyle(e).display !== "none" && /^Child[1-8] /.test(e.textContent)).length,
      more: [...document.querySelectorAll("#playfaces .pfmore")].filter(e => e.style.display !== "none").map(e => e.textContent + (e.classList.contains("solo") ? " solo" : "")) }));
    const folded = await sons();
    ok(folded.sons.includes("Child9 Testmann") && folded.sons.length >= 2 && folded.sons.length < 9 && folded.more.length && !folded.more.some(x => /solo/.test(x)) &&
       (await page.textContent("#pbcount")) === "9 people",
      "with no room, people on dead lines with no portrait wait in a +N, and a crowd always shows a face (" + JSON.stringify(folded) + ")");
    /* close in on their home: now there is room, and the crowd is a list of all eight, each named (Cory, 17 Oct 2026:
       "there is definitely enough room to show all people / names") */
    await page.click('#goto [data-mr="alsace"]');
    await page.waitForTimeout(1600);
    const roomy = await sons();
    ok(roomy.sons.length === 9 && roomy.named === 8, "with room, the crowd is a list: everyone drawn, each named (" + JSON.stringify(roomy) + ")");
    await shot(page, "pl0-list.png");
    await page.click("#pbfollow").catch(() => {});   /* the camera back to Play */
    await page.waitForTimeout(400);
    await shot(page, "pl1-play.png");
    /* a mark: back to just before it, playing, and its note comes up with its source */
    await page.click('#pbmarks .pbm.h[data-t="1600"]');
    await page.waitForFunction(() => /1600 · A test event in 1600/.test(document.querySelector("#playbar .pbcaps").textContent), null, { timeout: 5000 }).catch(() => {});
    const cap = await page.textContent("#playbar .pbcaps");
    ok(/1600 · A test event in 1600/.test(cap) && (await page.getAttribute("#playbar .pcap.hist a", "href")) === "https://example.org/a",
      "a history mark plays up to its note, which links its source");
    /* the family's own note for a new country */
    await page.waitForFunction(() => /First of the family in the United States: Branch1 Testmann, Gamma City/.test(document.querySelector("#playbar .pbcaps").textContent), null, { timeout: 25000 }).catch(() => {});
    ok(/First of the family in the United States: Branch1 Testmann, Gamma City/.test(await page.textContent("#playbar .pbcaps")), "the family's first record in a new country gets its note");
    /* the end: the living family, today */
    await page.evaluate(() => { const r = document.getElementById("pbrange"); r.value = +r.max - 1; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForFunction(() => /Today:/.test(document.querySelector("#playbar .pbcaps").textContent), null, { timeout: 6000 }).catch(() => {});
    ok(/Today: 8 living family members on the map, in one country\./.test(await page.textContent("#playbar .pbcaps")) && (await page.textContent("#pbcount")) === "8 people",
      "it ends today, on the living family (" + (await page.textContent("#pbcount")) + ")");
    ok((await page.getAttribute("#pbplay", "aria-label")) === "Play again from the start", "at the end the button offers to play again");
    await shot(page, "pl2-end.png");
    /* a face: that person's journey, and Play steps aside */
    /* faces in a crowd overlap: tap one whose middle is not under another */
    const hit = await page.evaluate(() => {
      for (const el of document.querySelectorAll("#playfaces .pf")) {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        if (top && el.contains(top)) return { x, y, who: el.getAttribute("aria-label").split(",")[0] };
      }
      return null;
    });
    const who = hit ? hit.who : "";
    if (hit) await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(700);
    ok(who && await page.isHidden("#playbar") && await page.isVisible("#mapsheet") && (await page.textContent("#msh-h")) === who,
      "tapping a face opens that person's journey (" + who + ")");
    /* back to everyone, Play again, Escape */
    await page.click("#mapback");
    await page.waitForTimeout(500);
    await page.click("#playchip");
    await page.waitForTimeout(400);
    ok(await page.isVisible("#playbar"), "Play opens again");
    /* the coronation (Cory, 17 Oct 2026): at the crowned person's first record the year stands still, trumpets,
       a crown and confetti; the fixture crowns Daughter1 (b. 1950) */
    await page.evaluate(() => { const r = document.getElementById("pbrange"); r.value = 1947; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    if ((await page.getAttribute("#pbplay", "aria-label")) !== "Pause") await page.click("#pbplay");
    await page.waitForSelector("#playparty", { timeout: 6000 }).catch(() => {});
    const partyOn = !!(await page.$("#playparty"));
    await page.waitForTimeout(1400);
    await shot(page, "pl3-party.png");
    const yA = await page.textContent("#pbyear");
    await page.waitForTimeout(1500);
    const yB = await page.textContent("#pbyear");
    ok(partyOn && yA === "1950" && yB === "1950" && (await page.$$("#playparty .pt")).length === 2,
      "at the crowned person's birth the year stands still and the trumpets come in (" + yA + ", " + yB + ")");
    ok(/Hear ye, hear ye! Daughter1 Testmann is born in Alphaville/.test(await page.textContent("#playbar .pbcaps")) && !!(await page.$("#playbar .pcap.royal")),
      "a royal note announces the birth");
    await page.waitForTimeout(700);
    ok((await page.$$("#playbar .pcap.royal")).length === 1, "and only that one (Cory, 17 Oct 2026: \"just keep the one above it\")");
    const king = await page.evaluate(() => { const e = document.querySelector("#playfaces .pf.king"); return e ? { w: e.offsetWidth, t: e.style.transform } : null; });
    ok(king && king.w >= 50 && !/scale\((1\.[0-9]*[1-9]|[2-9])/.test(king.t), "the crowned face grows in size, not by scaling a small picture, so it stays sharp (" + JSON.stringify(king) + ")");
    await page.waitForSelector("#playparty", { state: "detached", timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const crowned = await page.evaluate(() => [...document.querySelectorAll("#playfaces .pf.crowned")].map(e => e.getAttribute("aria-label").split(",")[0]));
    ok(!(await page.$("#playparty")) && crowned.join() === "Daughter1 Testmann" && +(await page.textContent("#pbyear")) > 1950,
      "then time runs on, and the crown stays on her head (" + crowned.join() + ")");
    await shot(page, "pl4-crowned.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    ok(await page.isHidden("#playbar") && (await page.$$("#mappins .pin")).length > 0, "Escape closes Play and the pins come back");
    /* the pill names the centre of the view, and a mark shows that spot (Cory, 17 Oct 2026: "its not clear WHERE on
       the screen it is referring to") */
    await page.click('#goto [data-mr="alsace"]');
    await page.waitForTimeout(1600);
    const aim = await page.evaluate(() => { const a = document.getElementById("mapaim").getBoundingClientRect(), m = document.getElementById("mapview").getBoundingClientRect(), w = document.getElementById("mapwhere");
      return { pill: getComputedStyle(w).display !== "none" && !!w.querySelector(".wx"), aim: getComputedStyle(document.getElementById("mapaim")).display !== "none",
        dx: Math.round(Math.abs(a.left + a.width / 2 - (m.left + m.width / 2))), dy: Math.round(Math.abs(a.top + a.height / 2 - (m.top + m.height / 2))), text: w.textContent }; });
    ok(aim.pill && aim.aim && aim.dx <= 1 && aim.dy <= 1, "the place pill comes with a mark at the spot it describes, the centre of the map (" + JSON.stringify(aim) + ")");
    await shot(page, "map-aim.png");
    await page.click("#lang");
    await page.waitForTimeout(400);
    ok((await page.textContent("#playchip span")) === "Faire défiler les années", "Play is in French too");
    await ctx.close();
  }
  /* ---------------- every control's name holds its words, and the footer's date has its month's name (18 Oct 2026) ----------------
     The Play bar's speed button showed "10 yr/s" but was named "Speed: 10 years a second"; the map's markers showed
     "26" and "Alphaville +1" (or "1" and "Alphaville") in an order their names did not follow. The footer said "Data synced
     2026-10-04": Cory wants the month by name ("4 Oct 2026"; "4 oct. 2026" in French). */
  for (const [label, opts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    console.log("\n== " + label + ", label in name and the footer's date");
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    watch(page, "names " + label);
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(600);
    const phone = label === "phone", view = v => phone ? page.tap('#dock [data-view="' + v + '"]') : page.click(v === "map" ? "#vt-map" : v === "research" ? "#vt-res" : "#vt-tree");
    for (const lang of ["en", "fr"]) {
      if (lang === "fr") { await page.evaluate(() => document.getElementById("lang").click()); await page.waitForTimeout(500); }
      const want = await page.evaluate(lang => { const [y, m, d] = SYNCED.split("-").map(Number);
        const mon = lang === "fr" ? ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return (lang === "fr" ? "Données synchronisées " : "Data synced ") + (lang === "fr" && d === 1 ? "1er" : d) + " " + mon[m - 1] + " " + y; }, lang);
      const foot = await page.evaluate(() => [document.getElementById("synctxt").textContent, document.getElementById("dsync").textContent]);
      ok(foot[0] === want && foot[1] === want, label + " " + lang + ": the footer and the menu say " + JSON.stringify(foot[0]) + " (" + want + ")");
      const bad = [];
      const sweep = async where => { (await nameMismatches(page)).forEach(m => bad.push(where + ": " + m)); };
      await view("tree"); await page.waitForTimeout(500);
      await page.evaluate(() => { const p = [...document.querySelectorAll(".node [data-pill]")].find(x => x.getBoundingClientRect().width > 0); if (p) p.click(); });
      await page.waitForTimeout(400); await sweep("tree");
      await page.evaluate(() => [...document.querySelectorAll(".node [data-bio]")].find(x => x.getBoundingClientRect().width > 0).click());
      await page.waitForSelector("#pbody .pmapbtn"); await sweep("bio");
      await page.evaluate(() => document.querySelector("#pbody .pmapbtn").click());
      await page.waitForFunction(() => document.querySelectorAll("#mappins .pin.jn").length > 0, null, { timeout: 10000 });
      await page.waitForTimeout(400); await sweep("a journey on the map");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      await view("tree"); await page.waitForTimeout(300); await view("map"); await page.waitForTimeout(1200);
      if (await page.isVisible("#playchip")) {
        await sweep("the map");
        await page.click("#playchip"); await page.waitForTimeout(600);
        for (let i = 0; i < 4; i++) {
          const spd = await page.evaluate(() => { const b = document.getElementById("pbspeed"); return [b.textContent, b.getAttribute("aria-label"), b.title]; });
          if (!spd[1].startsWith(spd[0]) || spd[2] !== spd[1]) bad.push("Play: the speed button shows " + JSON.stringify(spd[0]) + " but is named " + JSON.stringify(spd[1]));
          await sweep("Play at " + spd[0]);
          await page.click("#pbspeed"); await page.waitForTimeout(150);
        }
        await page.click("#pbplay"); await page.waitForTimeout(200); await sweep("Play, paused");
        await page.click("#pbclose"); await page.waitForTimeout(400);
      } else bad.push("the map offered no Play button");
      await view("research"); await page.evaluate(() => { location.hash = "#research"; });   /* the topic list, whatever screen was left open */
      await page.waitForSelector("#resview .rinv", { timeout: 10000 }); await sweep("Research");
      await page.evaluate(() => document.querySelector("#resview .rinv").click()); await page.waitForTimeout(500);
      await page.evaluate(() => { const b = document.querySelector('#resview [data-ra="src"]'); if (b) b.click(); }); await page.waitForTimeout(400);
      await sweep("Research, a source");
      await view("tree"); await page.waitForTimeout(400);
      ok(!bad.length, label + " " + lang + ": every control's spoken name holds the words it shows (tree, bio, map, a journey, Play at each speed, Research)" + (bad.length ? " — " + bad.slice(0, 4).join("; ") : ""));
    }
    await ctx.close();
  }
  /* ---------------- desktop ---------------- */
  {
    console.log("\n== desktop, cold start");
    await reset();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "desktop");
    await page.goto(BASE);
    await page.waitForSelector("#lockpw", { state: "visible" });
    let L = await log();
    ok(!got(L, /^\/map\//).length, "the lock screen asks for no map file");
    ok(!got(L, /research/).length, "the lock screen asks for no research file");
    await unlock(page);
    await page.waitForTimeout(1500);
    L = await log();
    ok(!got(L, /^\/map\//).length, "a visit that stays on the tree never asks for the map file");
    ok(!got(L, /\/media\/research\.bin/).length, "a visit that stays on the tree never asks for the research file");
    ok(got(L, /research-cards\.bin/).length === 1, "the badges' small file is fetched once");
    const badges = await page.$$eval(".node .rqb", els => els.map(e => e.textContent));
    ok(badges.some(b => /^3 open research questions$/.test(b.replace(/\s+/g, " ").trim())), "a badge carries its count and words for screen readers (" + badges.join(" | ") + ")");
    await shot(page, "d1-tree-badges.png");
    /* Research, first open */
    await page.click("#vt-res");
    await page.waitForSelector(".rdet", { timeout: 5000 });
    L = await log();
    ok(got(L, /\/media\/research\.bin/).length === 1, "opening Research fetches its file once");
    ok(!got(L, /^\/map\//).length, "opening Research does not fetch the map file");
    ok((await page.getAttribute("#vt-res", "aria-pressed")) === "true", "the Research button shows it is pressed");
    ok(/^#research\/i\d+$/.test(await page.evaluate(() => location.hash)), "the address names the investigation (" + await page.evaluate(() => location.hash) + ")");
    const order = await page.$$eval(".rth", ths => ths.map(t => t.querySelector(".rthn").textContent + ": " + [...t.querySelectorAll(".rinv .rit b")].map(b => b.textContent).join(" / ")));
    console.log("     " + order.join("\n     "));
    ok(await page.isHidden("#filtbtn"), "Filters is hidden in Research");
    ok(await page.isHidden("#restart"), "Start over is hidden in Research");
    await shot(page, "d2-research.png");
    /* topic 1: i1 (ready to do, a big step) before i2 (needs Cory's OK) */
    const t1 = await page.$$eval("#rt-t1 .rinv", els => els.map(e => e.dataset.id));
    ok(t1.join() === "i1,i2", "topic 1 sorts ready-to-do before needs-Cory (" + t1.join() + ")");
    /* open topic 3 and pick its investigation */
    await page.click('[data-ra="theme"][data-id="t3"]');
    await page.click('[data-ra="inv"][data-id="i5"]');
    await page.waitForSelector('.rdet .rdt');
    ok((await page.textContent(".rdet .rdt")) === "The Gamma City shop sign", "picking an investigation shows it");
    ok(/Priority 1 of 1/.test(await page.textContent(".rdet .rmeta")), "the detail says its priority");
    ok(/Ohio/.test(await page.textContent(".rdet .rline")), "the branch label shows (Ohio)");
    ok((await page.evaluate(() => location.hash)) === "#research/i5", "the address follows the pick");
    ok((await page.textContent(".rdet .rq .rchip")) === "Partly answered", "a partly answered question says so");
    /* expand a source */
    await page.click('[data-ra="src"][data-id="s12"]');
    ok(await page.isVisible("#rs-s12 .rsrcd"), "a source opens in place on wide screens");
    await shot(page, "d3-detail.png");
    /* Escape with nothing on top: the view stays as it is */
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    let w = await where(page);
    ok(w.res && w.hash === "#research/i5" && (await page.textContent(".rdet .rdt")) === "The Gamma City shop sign", "Escape on the wide view leaves Research as it was");
    /* By status */
    await page.click('[data-ra="lens"][data-v="status"]');
    await page.waitForSelector(".rgroups");
    const groups = await page.$$eval(".rgrp .rgh .rchip", e => e.map(x => x.textContent));
    ok(groups[0] === "Needs Cory" && groups.includes("Done"), "By status groups in order (" + groups.join(", ") + ")");
    await shot(page, "d4-status.png");
    await page.click('[data-ra="filter"][data-v="visit"]');
    ok((await page.$$(".rgrp")).length === 1, "a status chip filters to one group");
    await page.click('.rgsub [data-ra="visit"]');
    await page.waitForSelector(".rvisit h1");
    ok((await page.textContent(".rvisit h1")) === "Alphaville mill museum", "the visit list opens");
    ok((await page.evaluate(() => location.hash)) === "#research/visit/v1", "the address names the visit list");
    ok((await page.$$(".rvlist li")).length === 2, "it lists the two things to photograph there");
    ok((await page.$$eval(".rvisit .rpri", e => e.map(x => x.textContent))).join("|") === "ADo first|BIf time allows", "under their priorities");
    await shot(page, "d5-visit.png");
    /* the person who arranges it: all their visit lists on one page (5 Oct 2026) */
    await page.click('[data-ra="who"]');
    await page.waitForSelector(".rwho h1");
    ok((await page.textContent(".rwho h1")) === "A neighbour’s list", "a visit list opens its person's whole list (" + await page.textContent(".rwho h1") + ")");
    ok((await page.evaluate(() => location.hash)) === "#research/who/a-neighbour", "the address names the person");
    const wl = await page.evaluate(() => ({ arch: document.querySelectorAll(".rwho .rarch").length,
      rows: [...document.querySelectorAll(".rwho .rvlist li")].map(li => li.querySelector(".rvn").textContent + " " + li.querySelector("b").textContent),
      todo: document.querySelectorAll(".rwho .rvdo").length, how: document.querySelectorAll(".rwho .rhow li").length, upd: (document.querySelector(".rwho .rvwho") || {}).textContent }));
    ok(wl.arch === 1 && wl.rows.join("|") === "1 The first mill ledger|2 The millstone itself" && wl.todo === 2 && wl.how === 3 && /^List last changed /.test(wl.upd || ""),
      "it shows each archive, the items in order with what to photograph, how to photograph, and when the list last changed (" + JSON.stringify(wl) + ")");
    await shot(page, "d5b-who.png");
    await page.click('[data-ra="back"]');
    await page.waitForSelector(".rvisit:not(.rwho) h1");
    ok((await page.evaluate(() => location.hash)) === "#research/visit/v1", "its Back button returns to the visit list");
    await page.click('[data-ra="back"]');
    await page.waitForSelector(".rgroups");
    ok((await page.getAttribute('[data-ra="lens"][data-v="status"]', "aria-pressed")) === "true" && (await page.$$(".rgrp")).length === 1,
      "its Back button returns to By status, filter kept");
    await page.click('.rgsub [data-ra="visit"]');
    await page.waitForSelector(".rvisit h1");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".rgroups", { timeout: 3000 }).catch(() => {});
    ok(await page.isVisible(".rgroups"), "Escape closes the visit list too");
    /* French */
    await page.click("#lang");
    await page.waitForTimeout(200);
    ok(/Enquêtes en cours/.test(await page.textContent(".rhead h1", { timeout: 3000 })), "French: the title");
    ok(/Recherche/.test(await page.textContent("#vt-res")), "French: the tab");
    await page.click('[data-ra="lens"][data-v="topic"]');
    await page.waitForSelector(".rdet");
    ok(/Mise à jour le/.test(await page.textContent(".rdet .rmeta")), "French: the detail");
    await shot(page, "d6-french.png");
    await page.click("#lang");
    await page.waitForTimeout(200);
    /* the Map, first open */
    await page.click("#vt-res");
    await page.waitForSelector(".rdet");
    await reset();
    await page.click("#vt-map");
    await page.waitForTimeout(1500);
    L = await log();
    ok(got(L, /^\/map\//).length === 1, "the first Map open fetches the map file once");
    const pins = await page.$$eval("#mappins .pin", e => e.length);
    ok(pins > 0, "the map shows people (" + pins + " markers)");
    ok(await page.evaluate(() => document.getElementById("mapempty").style.display !== "flex"), "the loading note is gone");
    await shot(page, "d7-map.png");
    ok(!/^#research/.test(await page.evaluate(() => location.hash)), "leaving Research clears the address");
    /* back to Research: no refetch of research.bin within the visit */
    await reset();
    await page.click("#vt-res");
    await page.waitForSelector(".rdet");
    L = await log();
    ok(!got(L, /\/media\/research\.bin/).length, "Research is kept for the visit (no second fetch)");
    /* the bio's open questions */
    await page.click("#vt-tree");
    await page.waitForTimeout(300);
    const bio = await page.$('.node:has(.rqb) [data-bio]');
    ok(!!bio, "a card with a badge has its Bio button");
    if (bio) {
      await bio.click();
      await page.waitForSelector("#profile .phead");
      await page.waitForTimeout(300);
      ok(await page.isVisible("#profile .prq"), "the bio lists the person's open questions");
      ok((await page.$$("#profile .prqi")).length === 2, "one entry per investigation about them");
      await shot(page, "d8-bio.png");
      await page.click("#profile .prqgo");
      await page.waitForSelector(".rdet");
      ok(/^#research\/i1$/.test(await page.evaluate(() => location.hash)), "Open in Research goes to the investigation");
    }
    /* a person chip goes to the tree, and stays there */
    await page.click('[data-ra="person"]');
    await page.waitForTimeout(900);
    w = await where(page);
    ok(!w.res && !/^#research/.test(w.hash), "a person chip goes to the tree and stays there");
    /* search from Research: the person is shown on the tree (review, 3 Oct 2026: it used to light up the hidden tree) */
    await page.click("#vt-res");
    await page.waitForSelector(".rdet");
    await page.fill("#search", "Branch4");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    await page.click("#suggest .it");
    await page.waitForTimeout(900);
    w = await where(page);
    ok(!w.res && !w.map && !/^#research/.test(w.hash) && (await page.getAttribute("#vt-tree", "aria-pressed")) === "true", "a search pick in Research shows the tree");
    ok(await page.evaluate(() => [...document.querySelectorAll(".node")].some(n => /Branch4 Testmann/.test(n.textContent) && n.getBoundingClientRect().width > 0)), "with the person on it");
    /* leaving a visit list for the tree (review, 3 Oct 2026: it bounced straight back into Research) */
    await page.evaluate(() => { location.hash = "#research/visit/v1"; });
    await page.waitForSelector(".rvisit h1");
    await page.waitForTimeout(400);
    await page.click("#vt-tree");
    await page.waitForTimeout(1000);
    w = await where(page);
    ok(!w.res && !/^#research/.test(w.hash), "leaving a visit list for the tree stays on the tree (" + JSON.stringify(w) + ")");
    /* back in Research, it opens where it was left: the visit list */
    await page.click("#vt-res");
    await page.waitForSelector(".rvisit h1", { timeout: 5000 }).catch(() => {});
    ok(await page.isVisible(".rvisit h1"), "Research reopens where it was left");
    /* dark mode, through the page's own switch */
    await page.evaluate(() => { location.hash = "#research/i1"; });
    await page.waitForSelector(".rdet .rdt");
    const was = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.click("#theme");
    await page.waitForTimeout(250);
    if (was) { await page.click("#theme"); await page.waitForTimeout(250); }
    const look = await page.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"),
      bg: getComputedStyle(document.getElementById("resview")).backgroundColor, ink: getComputedStyle(document.querySelector(".rdet .rdt")).color }));
    const lb = lum(look.bg), li = lum(look.ink);
    ok(look.dark && lb < 0.1 && (li + 0.05) / (lb + 0.05) >= 7, "dark mode: a dark page with light text (" + look.bg + " / " + look.ink + ")");
    await shot(page, "d9-dark.png");
    /* the cards' small badges in dark mode (site audit, 20 Oct 2026: "→ USA" was 2.6:1) */
    await page.click("#vt-tree");
    await page.waitForTimeout(400);
    const tags = await page.$$eval(".node .badge", els => els.map(e => ({ t: e.textContent, c: getComputedStyle(e).color, b: getComputedStyle(e).backgroundColor })));
    const tagLow = tags.filter(x => { const a = lum(x.c), b = lum(x.b); return !((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5); });
    ok(tags.length >= 1 && !tagLow.length, "dark mode: a card's badge text is 4.5:1 or better (" + tags.map(x => x.t + " " + x.c + " on " + x.b).join(" | ") + ")");
    await ctx.close();
  }
  /* ---------------- the Map's file: a failed fetch is retried, and a slow one still draws ---------------- */
  {
    console.log("\n== map file: retry and late arrival");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "map", true);
    await page.goto(BASE);
    await unlock(page);
    await reset();
    FAIL.add(MAPURL);
    await page.click("#vt-map");
    await page.waitForTimeout(1200);
    ok(/didn’t load/.test(await page.textContent("#mapempty")) && await page.isVisible("#mapempty"), "a map file that is missing says so");
    FAIL.delete(MAPURL);
    await page.click("#vt-tree");
    await page.click("#vt-map");
    await page.waitForTimeout(1500);
    const L = await log();
    ok(got(L, /^\/map\//).map(x => x.s).join() === "404,200", "opening the Map again asks the server again (" + got(L, /^\/map\//).map(x => x.s).join() + "), not the stored error");
    ok((await page.$$eval("#mappins .pin", e => e.length)) > 0 && !(await page.isVisible("#mapempty")), "and the map draws");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "map late");
    await page.goto(BASE);
    await unlock(page);
    DELAY.set(MAPURL, 1500);
    await page.click("#vt-map");
    await page.waitForTimeout(200);
    await page.click("#vt-tree");
    await page.waitForTimeout(2600);
    DELAY.delete(MAPURL);
    await page.click("#vt-map");
    await page.waitForTimeout(600);
    ok((await page.$$eval("#mappins .pin", e => e.length)) > 0 && !(await page.isVisible("#mapempty")),
      "a map file that lands after the Map was left is drawn on the next opening");
    await ctx.close();
  }
  /* ---------------- a layer kept open across views: the Map's journey, Research, the Map again, then Back ----------------
     (review, 3 Oct 2026: Back closed the journey and reopened Research, from the address Research had left behind) */
  for (const phone of [false, true]) {
    console.log("\n== " + (phone ? "phone" : "desktop") + ": a journey kept open while Research is visited, then Back");
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, phone ? "journey phone" : "journey desktop");
    const press = sel => phone ? page.tap(sel) : page.click(sel);
    await page.goto(BASE);
    await unlock(page);
    await press(phone ? '#dock [data-view="map"]' : "#vt-map");
    await page.waitForTimeout(1500);
    await page.fill("#search", "Branch4");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    await page.click("#suggest .it");
    await page.waitForTimeout(1500);
    ok(await page.evaluate(() => !!document.querySelector("#mapsheet.on")), "a search pick on the map opens that person's journey");
    await press(phone ? '#dock [data-view="research"]' : "#vt-res");
    /* long enough on Research's first screen for the guard to stand down (it checks every 250 ms): that step is
       what leaves the #research address on the entry below */
    await page.waitForSelector(phone ? ".rph .rinv" : ".rdet");
    await page.waitForTimeout(700);
    if (phone) { await page.tap('.rinv[data-id="i2"]'); await page.waitForSelector(".rdet .rdt"); }
    else { await page.click('[data-ra="lens"][data-v="status"]'); await page.waitForSelector(".rgroups"); await page.click('.rgsub [data-ra="visit"]'); await page.waitForSelector(".rvisit h1"); }
    await page.waitForTimeout(600);
    await press(phone ? '#dock [data-view="map"]' : "#vt-map");
    await page.waitForTimeout(800);
    await page.goBack();
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => ({ res: document.body.classList.contains("resmode"), map: document.body.classList.contains("mapmode"), hash: location.hash,
      sheet: !!document.querySelector("#mapsheet.on") }));
    ok(w.map && !w.res && !/^#research/.test(w.hash) && !w.sheet, "Back closes the journey and stays on the map (" + JSON.stringify(w) + ")");
    ok(page.url().startsWith(BASE), "and on the site");
    await ctx.close();
  }
  /* ---------------- links straight to Research, opened cold ---------------- */
  {
    console.log("\n== deep links");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "deep");
    await page.goto(BASE + "#research/i3");
    await unlock(page, { keepIntro: true });
    /* a first visit: the welcome card is over Research, and its button says it goes back there */
    ok(await page.evaluate(() => document.getElementById("intro").style.display === "flex"), "a first visit shows the welcome card");
    ok((await page.textContent("#introgo")) === "Back to Research", "its button says Back to Research (" + await page.textContent("#introgo") + ")");
    await page.click("#introgo");
    await page.waitForSelector(".rdet", { timeout: 5000 });
    ok((await page.textContent(".rdet .rdt")) === "The Deltadam bakers", "a link to #research/i3 opens that investigation");
    ok(/Netherlands/.test(await page.textContent(".rdet .rline")), "its branch shows (Netherlands)");
    await page.goto(BASE + "#research/visit/v1");   /* the same page, a new address */
    await page.waitForSelector(".rvisit h1", { timeout: 8000 });
    ok((await page.textContent(".rvisit h1")) === "Alphaville mill museum", "a new address in the open page opens that visit list");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "deep cold");
    await page.goto(BASE + "#research/visit/v1");
    await unlock(page, { keepIntro: true });
    await page.waitForSelector(".rvisit h1", { state: "attached", timeout: 8000 }).catch(() => {});
    ok((await page.textContent(".rvisit h1").catch(() => "")) === "Alphaville mill museum", "a link to a visit list, opened cold, opens it behind the welcome card");
    /* a person's list (5 Oct 2026), the address in any case; a name with no list falls back */
    await page.goto(BASE + "#research/who/A-Neighbour");
    await page.waitForSelector(".rwho h1", { state: "attached", timeout: 8000 }).catch(() => {});
    ok((await page.textContent(".rwho h1").catch(() => "")) === "A neighbour’s list", "a link to a person's list opens it, whatever the case");
    ok((await page.evaluate(() => location.hash)) === "#research/who/a-neighbour", "and the address settles in lower case");
    await page.goto(BASE + "#research/who/nobody");
    await page.waitForTimeout(600);
    ok(!(await page.$(".rwho")) && !/^#research\/who/.test(await page.evaluate(() => location.hash)), "a name with no visit list falls back to the investigations");
    /* the welcome card's own search lands on the tree, out of Research */
    await page.fill("#introsearch", "Branch4");
    await page.waitForSelector("#introsug .isit", { timeout: 3000 });
    await page.click("#introsug .isit");
    await page.waitForTimeout(900);
    const w = await where(page);
    ok(!w.res && !/^#research/.test(w.hash), "a person picked on the welcome card is shown on the tree");
    await ctx.close();
  }
  /* ---------------- a file the tools would never write: the page still keeps to the values it knows ---------------- */
  {
    console.log("\n== an odd research file");
    const odd = JSON.parse(JSON.stringify(R0));
    const inv = odd.investigations.find(x => x.id === "i5") || odd.investigations[0];
    inv.qs[0].src[0].st = 'ready" onmouseover="window.__odd=1';
    inv.qs[0].state = 'open" onclick="window.__odd=2';
    inv.imp = "<b>9</b>";
    const key = P.keyFor(PW, SALT, ITER);
    const oj = Buffer.from(JSON.stringify(odd), "utf8");
    const cj = Buffer.from(JSON.stringify({ updated: odd.updated, cards: { c001: [1, "i1"], c002: ['<img src=x onerror="window.__odd=3">', "i1"] },
      invs: { i1: ["Odd", "Odd", 'solo" onclick="window.__odd=4'] } }), "utf8");
    const files = ["research.bin", "research-cards.bin"].map(f => path.join(OUT, "media", f));
    const kept = files.map(f => fs.readFileSync(f));
    fs.writeFileSync(files[0], P.sealBlob(key, "r:" + oj.length, zlib.deflateRawSync(oj), Buffer.from("odd research")).file);
    fs.writeFileSync(files[1], P.sealBlob(key, "q", cj, Buffer.from("odd cards")).file);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      watch(page, "odd");
      await page.goto(BASE + "#research/" + inv.id);
      await unlock(page);
      await page.waitForSelector(".rdet .rdt", { timeout: 8000 });
      await page.hover(".rdet .rq .rchip").catch(() => {});
      await page.click(".rdet .rq .rchip").catch(() => {});
      await page.hover(".rdet .rsrc .rchip").catch(() => {});
      const st = await page.evaluate(() => ({ odd: window.__odd, attrs: document.querySelectorAll("#resin [onmouseover], #resin [onclick], .node [onerror], .node img[src='x']").length,
        badges: [...document.querySelectorAll(".node .rqb")].map(b => b.textContent.replace(/\s+/g, " ").trim()) }));
      ok(st.odd === undefined && st.attrs === 0, "statuses, states and counts the page does not know become nothing, never markup (" + JSON.stringify(st) + ")");
      ok(st.badges.length === 1 && /^1 open research question$/.test(st.badges[0]), "a badge count that is not a number shows no badge; a real one still shows (" + st.badges.join(" | ") + ")");
      /* the bio of the card with the real count: its investigation's tier is not one the page knows */
      await page.click("#vt-tree");
      await page.waitForTimeout(300);
      await page.click('.node:has(.rqb) [data-bio]');
      await page.waitForSelector("#profile .prq", { timeout: 5000 });
      const bio = await page.evaluate(() => ({ chips: document.querySelectorAll("#profile .prqt .rchip").length, attrs: document.querySelectorAll("#profile .prq [onclick]").length,
        title: (document.querySelector("#profile .prqt b") || {}).textContent, odd: window.__odd }));
      ok(bio.title === "Odd" && bio.chips === 0 && bio.attrs === 0 && bio.odd === undefined, "the bio lists it without a tier it does not know (" + JSON.stringify(bio) + ")");
      await ctx.close();
    } finally { files.forEach((f, i) => fs.writeFileSync(f, kept[i])); }
  }
  /* ---------------- Cory's Decide buttons (register R-0445): only on a device opened with #owner ---------------- */
  if (!REAL) {
    console.log("\n== Decide buttons");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "decide");
    const PAGEURL = R.decide;
    const decs = () => page.evaluate(() => [...document.querySelectorAll("#resin a.rdec")].map(a => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent.trim() })));
    await page.goto(BASE + "#research/i2");
    await unlock(page);
    await page.waitForSelector(".rdet .rdt", { timeout: 8000 });
    let d = await decs();
    ok(d.length === 0 && !(await page.$("#resin .rdecchip")), "without #owner: no Decide button and no chip (" + d.length + ")");
    await page.evaluate(() => { location.hash = "#owner"; });
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => localStorage.getItem("ft-owner") === "1"), "#owner marks this device");
    const h1 = await page.evaluate(() => location.hash);
    ok(h1 === "#research/i2", "and the address goes back to where Research was (" + h1 + ")");
    d = await decs();
    const hrefs = d.map(x => x.href);
    ok(hrefs.includes(PAGEURL), "the header links to the decisions page (" + hrefs.join(", ") + ")");
    ok(hrefs.includes(PAGEURL + "#x1"), "a source waiting on a decision links straight to its card");
    ok(d.length > 0 && d.every(x => x.target === "_blank" && /noopener/.test(x.rel)), "in a new tab, with no handle back to the site");
    ok(!!(await page.$("#rs-s5 .rdecchip")) && !(await page.$("#rs-s4 .rdecchip")), "the chip marks that source's row, and only it");
    ok(!!(await page.$('.rinv[data-id="i2"] .rdecchip')) && !(await page.$('.rinv[data-id="i1"] .rdecchip')), "and its investigation in the list, and only it");
    await shot(page, "d1-decide.png");
    await page.evaluate(() => { location.hash = "#research/i4"; });
    await page.waitForFunction(() => { const h = document.querySelector(".rdet .rdt"); return h && /sea/.test(h.textContent); }, null, { timeout: 5000 });
    ok((await decs()).some(x => x.href === PAGEURL + "#x3"), "an investigation waiting on a decision has its own button");
    /* Begin research (R-0448): a research card is not a decision */
    await page.evaluate(() => { location.hash = "#research/i5"; });
    await page.waitForFunction(() => { const h = document.querySelector(".rdet .rdt"); return h && /shop/.test(h.textContent); }, null, { timeout: 5000 });
    const gos = (await decs()).filter(x => x.href === PAGEURL + "#go1");
    ok(gos.length === 2 && gos.every(x => x.text === "Begin research"), "each source Claude can read alone, online, has a Begin research button to its research card (" + gos.map(x => x.text).join(", ") + ")");
    const goChips = await page.evaluate(() => ({ src: ((document.querySelector("#rs-s12 .rdecchip") || {}).textContent || ""), inv: [...document.querySelectorAll('.rinv[data-id="i5"] .rdecchip')].map(e => e.textContent).join("|") }));
    ok(goChips.src === "Your go-ahead" && goChips.inv === "Your go-ahead", "its chip says Your go-ahead, on the source and on the investigation (" + goChips.src + " / " + goChips.inv + ")");
    await page.evaluate(() => document.getElementById("rs-s12").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await shot(page, "d2-begin-research.png");
    await page.evaluate(() => document.getElementById("lang").click());
    await page.waitForTimeout(300);
    ok((await decs()).some(x => x.href === PAGEURL + "#go1" && x.text === "Lancer la recherche"), "French: Lancer la recherche");
    await page.evaluate(() => document.getElementById("lang").click());
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#research/visit/v1"; });
    await page.waitForSelector(".rvisit h1", { timeout: 5000 });
    ok((await decs()).some(x => x.href === PAGEURL + "#x2"), "so does a visit list");
    await page.evaluate(() => document.getElementById("lang").click());
    await page.waitForTimeout(300);
    ok((await decs()).some(x => x.text === "Décider"), "French: Décider");
    await page.evaluate(() => document.getElementById("lang").click());
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#owner-off"; });
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => localStorage.getItem("ft-owner") === null), "#owner-off unmarks the device");
    d = await decs();
    ok(d.length === 0 && (await page.evaluate(() => location.hash)) === "#research/visit/v1", "and the buttons go, the view staying where it was (" + d.length + ")");
    await ctx.close();
  }
  /* ---------------- Cory's owner view (5 Oct 2026, register R-0475): link figures on his devices only ---------------- */
  if (!REAL) {
    console.log("\n== owner view: how sure each link is");
    await reset();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "owner view");
    const labels = () => page.evaluate(() => [...document.querySelectorAll("#world text.ulabel")].map(t => ({ txt: [...t.childNodes].filter(n => n.nodeName !== "title").map(n => n.textContent).join("").replace(/\s+/g, " ").trim(),
      pct: [...t.querySelectorAll("tspan.cfp")].map(s => s.textContent.trim()), cls: [...t.querySelectorAll("tspan.cfp")].map(s => s.getAttribute("class")).join(" "),
      title: (t.querySelector("title") || {}).textContent || "" })));
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(800);
    let L = await log();
    ok(!got(L, /owner\.bin/).length, "a device without the owner key never asks for the owner file");
    /* the figures themselves are for everyone (R-0481): every line carries its %, with no reason and no override mark */
    await page.waitForFunction(() => document.querySelectorAll("#world tspan.cfp").length > 0, null, { timeout: 5000 }).catch(() => {});
    let pub = await labels();
    ok(pub.length > 0 && pub.every(l => l.pct.length === 1 && /^(· )?\d{1,3}%$/.test(l.pct[0])), "without the key every line still shows its % (" + pub.map(l => l.txt).slice(0, 4).join(" | ") + ")");
    const plow = pub.find(l => l.txt === "50%"), povr = pub.find(l => l.txt === "80%");
    ok(!!plow && /cf-l/.test(plow.cls) && /50%/.test(plow.title) && !/test tree/.test(plow.title), "a weak link shows its figure in the low colour, but not the reason");
    ok(!!povr && !/cfo/.test(povr.cls) && !/records give|My own test note/.test(povr.title), "Cory's own figure shows as a plain figure: no mark, no note, no records' figure");
    await page.click('.node:has(.nm:text-is("Octavus Testmann")) [data-bio]');
    await page.waitForSelector("#profile .pcfwhy", { timeout: 4000 }).catch(() => {});
    const pbio = await page.evaluate(() => { const e = document.querySelector("#profile .pcfwhy"); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; });
    ok(pbio === "How sure 80%", "the bio says how sure, and nothing more (" + pbio + ")");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#owner"; });
    await page.waitForTimeout(600);
    ok((await labels()).every(l => !/cfo/.test(l.cls)) && !got(await log(), /owner\.bin/).length, "#owner alone (the Decide buttons' mark) fetches nothing more");
    await page.evaluate(k => { location.hash = "#owner=" + k; }, OKEY64);
    /* everyone's figures are already there: wait for the owner file's own mark (the test's one override) */
    await page.waitForFunction(() => !!document.querySelector("#world tspan.cfo"), null, { timeout: 5000 }).catch(() => {});
    let lb = await labels();
    ok(lb.length > 0 && lb.every(l => l.pct.length === 1 && /^(· )?\d{1,3}%$/.test(l.pct[0])), "#owner=<key>: every line down to a child carries its % (" + lb.map(l => l.txt).slice(0, 4).join(" | ") + ")");
    ok((await page.evaluate(() => location.hash)) === "", "and the key leaves the address at once");
    const low = lb.find(l => l.txt === "50%"), ovr = lb.find(l => l.txt === "80%");
    ok(!!low && /cf-l/.test(low.cls) && /50%/.test(low.title) && /test tree/.test(low.title), "a weak link shows its figure in the low colour, with the reason on hover");
    ok(!!ovr && /cfo/.test(ovr.cls) && /records give 60%/.test(ovr.title) && /My own test note/.test(ovr.title), "a figure Cory set himself is marked, with the records' figure and his note on hover");
    await shot(page, "o1-owner-figures.png");
    /* the bio says it too */
    await page.click('.node:has(.nm:text-is("Octavus Testmann")) [data-bio]');
    await page.waitForSelector("#profile .pcfwhy", { timeout: 4000 }).catch(() => {});
    const bio = await page.evaluate(() => { const e = document.querySelector("#profile .pcfwhy"); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; });
    ok(/^How sure 80% \(your figure; the records give 60%\) · My own test note\.?$/.test(bio || ""), "the bio carries the figure and his note (" + bio + ")");
    await shot(page, "o2-owner-bio.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    /* a reload keeps the key: the figures come back by themselves */
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector("#world tspan.cfo"), null, { timeout: 8000 }).catch(() => {});
    ok((await labels()).some(l => /cfo/.test(l.cls)), "after a reload Cory's figures come back without the address");
    await page.evaluate(() => { location.hash = "#owner-off"; });
    await page.waitForTimeout(800);
    const offL = await labels();
    ok(offL.some(l => l.pct.length) && offL.every(l => !/cfo/.test(l.cls) && !/test tree|My own test note/.test(l.title)), "#owner-off takes the reasons away; everyone's figures stay");
    await reset();
    await page.reload();
    await page.waitForTimeout(1500);
    ok((await labels()).every(l => !/cfo/.test(l.cls) && !/test tree|My own test note/.test(l.title)) && !got(await log(), /owner\.bin/).length, "and after a reload the owner file is not asked for again");
    /* someone else's address with a wrong key: only everyone's figures, and nothing breaks */
    await page.evaluate(k => { location.hash = "#owner=" + k; }, "A".repeat(43));
    await page.waitForTimeout(1200);
    ok((await labels()).every(l => !/cfo/.test(l.cls) && !/test tree|My own test note/.test(l.title)), "a wrong key shows no reasons");
    await page.evaluate(() => { location.hash = "#owner-off"; });
    await page.waitForTimeout(400);
    await ctx.close();
  }
  /* ---------------- the bio on a desktop (Cory, 5 Oct 2026): wider, and a header that slims without jitter ---------------- */
  {
    console.log("\n== bio on a desktop: width, and the header that slims as it scrolls");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "bio header");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(800);
    await page.locator(".node [data-bio]").first().click();
    await page.waitForSelector("#profile .phead", { timeout: 4000 }).catch(() => {});
    const w = await page.evaluate(() => document.querySelector("#profile .pcard").getBoundingClientRect().width);
    ok(w > 700, "on a wide screen the bio takes more of it (" + Math.round(w) + "px wide)");
    /* Cory's video: a small scroll made the header slim, the slimmer header pulled the text back up, the header
       widened again, and round it went. Scroll in small steps and watch the scroll and the text stay put. */
    const r = await page.evaluate(async () => {
      const b = document.getElementById("pbody"), head = b.querySelector(".phead");
      const pad = document.createElement("div"); pad.style.height = "3000px"; b.appendChild(pad);
      const mark = document.createElement("p"); mark.textContent = "mark"; head.after(mark);
      const pos = () => mark.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop;
      const p0 = pos(), seen = [];
      for (const y of [8, 20, 26, 30, 24, 10, 3, 1, 0, 40, 33, 27, 29]) {
        b.scrollTop = y; b.dispatchEvent(new Event("scroll"));
        for (let i = 0; i < 4; i++) await new Promise(res => requestAnimationFrame(res));
        seen.push({ y, at: b.scrollTop, stuck: head.classList.contains("stuck"), pos: pos() });
      }
      return { p0, seen };
    });
    const at = y => r.seen.find(x => x.y === y) || {};
    ok(r.seen.every(x => x.at === x.y), "the bio stays where it is scrolled to (" + r.seen.map(x => x.y + ">" + x.at).join(" ") + ")");
    ok(r.seen.every(x => Math.abs(x.pos - r.p0) < 1), "and the text under the header never moves as it slims or widens");
    ok(!at(20).stuck && at(26).stuck && at(10).stuck && at(3).stuck && !at(1).stuck && !at(0).stuck && at(40).stuck,
      "it slims past 24px and widens again only at the very top");
    await shot(page, "b1-bio-desktop.png");
    await ctx.close();
  }
  /* ---------------- Research on a phone (Cory, 5 Oct 2026): no empty stretch where the tree's Filters button sits ---------------- */
  {
    console.log("\n== research on a phone: the dock fits its views");
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    watch(page, "research dock");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => { const b = document.querySelector('#dock [data-view="research"]'); return !!b && !b.hidden && b.getClientRects().length > 0; });
    if (shown) {
      await page.click('#dock [data-view="research"]');
      await page.waitForTimeout(700);
      const g = await page.evaluate(() => {
        const d = document.getElementById("dock").getBoundingClientRect();
        const bs = [...document.querySelectorAll("#dock > *")].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect());
        return { right: d.right - Math.max(...bs.map(b => b.right)), left: Math.min(...bs.map(b => b.left)) - d.left };
      });
      ok(Math.abs(g.right - g.left) < 3, "in Research the dock ends at its last view: no empty stretch on the right (" + Math.round(g.left) + "px / " + Math.round(g.right) + "px)");
      await shot(page, "r9-research-dock-phone.png");
    }
    await ctx.close();
  }
  /* ---------------- search: Enter goes by the words in the box (site audit, 20 Oct 2026) ----------------
     Both boxes wait a moment before they list names. Enter inside that wait opened the person the box's
     earlier words found, and in a fresh header box it did nothing. */
  {
    console.log("\n== search: Enter goes by the words in the box");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "search enter");
    await page.goto(BASE);
    await unlock(page, { keepIntro: true });
    const lit = () => page.evaluate(() => { const e = document.querySelector(".node.sel .nm"); return e ? e.textContent : null; });
    /* new words and Enter in the same moment, as a fast typist or a paste does */
    const swap = (sel, words) => page.evaluate(([sel, words]) => {
      const b = document.querySelector(sel); b.focus(); b.value = words; b.dispatchEvent(new Event("input", { bubbles: true }));
      b.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }, [sel, words]);
    ok(await page.evaluate(() => document.getElementById("intro").style.display === "flex"), "the welcome card is open, with its search");
    /* the welcome's search: a list for other words, a pick moved down it with the arrows, then new words and Enter */
    await page.fill("#introsearch", "Testmann");
    await page.waitForSelector("#introsug .isit", { timeout: 3000 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await swap("#introsearch", "Branch");
    await page.waitForTimeout(900);
    const gotW = await lit(), closed = await page.evaluate(() => document.getElementById("intro").style.display !== "flex");
    /* the first name those words find, as the header's list (the same matcher) puts it */
    await page.fill("#search", "Branch");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    const wantW = await page.evaluate(() => document.querySelector("#suggest .it .nm2").textContent);
    await page.keyboard.press("Escape");
    await page.fill("#search", "");
    ok(closed && gotW && gotW === wantW, "the welcome's search opens the first person the new words find, not a pick from the old list (" + gotW + ", first is " + wantW + ")");
    /* the header's search: a list for other words on screen, then new words and Enter */
    await page.fill("#search", "Child3");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    await swap("#search", "Branch4");
    await page.waitForTimeout(900);
    ok((await lit()) === "Branch4 Testmann", "the header's search opens the person the box names, not the list on screen (" + (await lit()) + ")");
    /* and in a fresh box, before any list has come up */
    await swap("#search", "Branch5");
    await page.waitForTimeout(900);
    ok((await lit()) === "Branch5 Testmann", "Enter in a fresh header box opens the person too (" + (await lit()) + ")");
    /* the arrows still choose, while the words stay the same */
    await page.fill("#search", "Branch");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    await page.keyboard.press("ArrowDown");
    const second = await page.evaluate(() => { const e = document.querySelectorAll("#suggest .it")[1]; return e ? e.querySelector(".nm2").textContent : null; });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    ok(second && (await lit()) === second, "with the same words, Enter opens the name picked with the arrows (" + second + ")");
    await ctx.close();
  }
  /* ---------------- search lists, for the keyboard and for assistive tech (site audit, 20 Oct 2026) ----------------
     The arrows could pick a row scrolled out of sight in the welcome's list, and Enter then opened someone the
     reader could not see; neither list told assistive tech what was on it or which row was picked, and the header's
     "No match" was never said. The Living tag's green was 4.43:1 on its tint, and an input method's Enter (still
     composing) in the welcome's box opened a person. */
  {
    console.log("\n== search lists: keyboard and assistive tech");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, "search lists");
    await page.goto(BASE);
    await unlock(page, { keepIntro: true });
    const state = (box, list) => page.evaluate(([box, list]) => {
      const b = document.getElementById(box), l = document.getElementById(list), act = l.querySelector(".act");
      const lr = l.getBoundingClientRect(), ar = act ? act.getBoundingClientRect() : null, opts = [...l.querySelectorAll('[role="option"]')];
      return { role: b.getAttribute("role"), exp: b.getAttribute("aria-expanded"), ctl: b.getAttribute("aria-controls"), ad: b.getAttribute("aria-activedescendant"),
        act: act ? act.id : null, listRole: l.getAttribute("role"), opts: opts.length, sel: opts.filter(o => o.getAttribute("aria-selected") === "true").map(o => o.id).join(),
        seen: !!ar && ar.top >= lr.top - 0.5 && ar.bottom <= lr.bottom + 0.5, scrolls: l.scrollHeight > l.clientHeight + 1 };
    }, [box, list]);
    const walk = async (box, list) => {
      const trail = [];
      for (let i = 0; i < 9; i++) { await page.keyboard.press("ArrowDown"); trail.push(await state(box, list)); }
      return { trail, unseen: trail.filter(s => !s.seen).length, untold: trail.filter(s => !(s.act && s.ad === s.act && s.sel === s.act)).length };
    };
    /* the welcome's box */
    await page.fill("#introsearch", "Testmann");
    await page.waitForSelector("#introsug .isit", { timeout: 3000 });
    const w0 = await state("introsearch", "introsug"), ww = await walk("introsearch", "introsug");
    ok(w0.role === "combobox" && w0.ctl === "introsug" && w0.exp === "true" && w0.listRole === "listbox" && w0.opts === 8 && w0.ad === "isug-o0",
      "the welcome's box is a combobox over a listbox of 8 options, its first one active (" + JSON.stringify(w0) + ")");
    ok(w0.scrolls && ww.unseen === 0, "every row the arrows pick in the welcome's list is scrolled into sight (" + ww.unseen + " of 9 out of sight; the list scrolls: " + w0.scrolls + ")");
    ok(ww.untold === 0, "…and each is the box's active, selected option (" + ww.untold + " of 9 not)");
    /* an input method's Enter is its own; the next Enter opens the picked name */
    await page.evaluate(() => document.getElementById("introsearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.getElementById("intro").style.display === "flex"), "an Enter that is still composing (an input method's) leaves the welcome open");
    const picked = await page.evaluate(() => { const a = document.querySelector("#introsug .act"); return a ? a.firstChild.textContent : null; });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const litNow = await page.evaluate(() => { const e = document.querySelector(".node.sel .nm"); return e ? e.textContent : null; });
    ok(picked && litNow === picked && (await page.evaluate(() => document.getElementById("intro").style.display !== "flex")), "…and the plain Enter after it opens the name picked in sight (" + litNow + ")");
    /* the header's box */
    await page.fill("#search", "Testmann");
    await page.waitForSelector("#suggest .it", { timeout: 3000 });
    const h0 = await state("search", "suggest"), hw = await walk("search", "suggest");
    ok(h0.role === "combobox" && h0.ctl === "suggest" && h0.exp === "true" && h0.listRole === "listbox" && h0.opts === 8 && h0.ad === "sug-o0" &&
       (await page.getAttribute("#suggest", "aria-label")) === "Search a name" && hw.untold === 0 && hw.unseen === 0,
      "the header's box is a combobox over a named listbox, and each row the arrows pick is its active option, in sight (" + hw.untold + " untold, " + hw.unseen + " out of sight, of 9)");
    /* the Living tag's text on its tint, in light and then dark */
    const lvRatio = () => page.evaluate(() => {
      const e = document.querySelector("#suggest .lv"); if (!e) return 0;
      const cs = getComputedStyle(e), px = (c) => { const m = c.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/); return m ? [+m[1] * 255, +m[2] * 255, +m[3] * 255] : (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number); };
      const L = c => { const v = c.map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const a = L(px(cs.color)), b = L(px(cs.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    const lvL = await lvRatio();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const lvD = await lvRatio();
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    ok(lvL >= 4.5 && lvD >= 4.5, "the Living tag's text is 4.5:1 or better on its tint, as drawn (" + lvL.toFixed(2) + " light, " + lvD.toFixed(2) + " dark)");
    /* no one by those words: a line, not a list, and said aloud */
    await page.fill("#search", "Qqzzx");
    await page.waitForSelector("#suggest .none", { timeout: 3000 });
    const nm = await page.evaluate(() => { const st = document.getElementById("sugstat");
      return { role: document.getElementById("suggest").getAttribute("role"), label: document.getElementById("suggest").getAttribute("aria-label"),
        exp: document.getElementById("search").getAttribute("aria-expanded"), ad: document.getElementById("search").getAttribute("aria-activedescendant"),
        live: st ? st.getAttribute("aria-live") : null, said: st ? st.textContent : null }; });
    ok(nm.role === null && nm.label === null && nm.exp === "false" && nm.ad === null && nm.live === "polite" && nm.said === "No match",
      "the header's No match is a line, not a list, and a polite live line says it (" + JSON.stringify(nm) + ")");
    await page.keyboard.press("Escape");
    ok((await page.evaluate(() => { const st = document.getElementById("sugstat"); return [document.getElementById("search").getAttribute("aria-expanded"), st ? st.textContent : "(none)"].join("|"); })) === "false|",
      "Escape closes the list, and the box says so");
    await page.fill("#search", "");
    await ctx.close();
  }
  /* ---------------- headings and landmarks (site audit, 20 Oct 2026) ----------------
     On a phone a Research screen is a page of its own: its headings step down one level at a time from its title.
     The map's Go to places, Play and the phone's Go to menu sit in a named region, so a landmark jump reaches them. */
  for (const phone of [false, true]) {
    console.log("\n== " + (phone ? "phone" : "desktop") + ": headings and landmarks");
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, (phone ? "phone" : "desktop") + " landmarks");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(600);
    /* every heading on screen, in order: none may go down more than one level from the one before */
    const steps = () => page.evaluate(() => {
      const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(h => h.getClientRects().length && getComputedStyle(h).visibility !== "hidden");
      const lv = hs.map(h => +h.tagName[1]), bad = lv.filter((l, i) => i && l > lv[i - 1] + 1);
      return { seq: lv.join(""), bad: bad.length };
    });
    const region = sel => page.evaluate(s => {
      const el = document.querySelector(s); if (!el) return null;
      const lm = el.closest("header,nav,main,aside,footer,[role=region][aria-label],[role=banner],[role=navigation],[role=main]");
      return lm ? (lm.getAttribute("aria-label") || lm.tagName.toLowerCase()) : "";
    }, sel);
    if (phone) {
      await page.tap('#dock [data-view="research"]');
      await page.waitForSelector(".rph .rinv", { timeout: 5000 });
      await page.tap('.rinv[data-id="i2"]');
      await page.waitForSelector(".rdet .rdt");
      await page.waitForTimeout(300);
      const inv = await steps();
      ok(inv.seq.startsWith("12") && !inv.bad, "phone: an investigation's headings step one level at a time from its title (" + inv.seq + ")");
      await page.tap('[data-ra="src"][data-id="s6"]');
      await page.waitForSelector(".rsheet h1");
      await page.waitForTimeout(300);
      const src = await steps();
      ok(src.seq === "12" && !src.bad && /What has happened/.test(await page.textContent(".rsheet h2")), "phone: a source's page goes from its title to What has happened, level 1 to 2 (" + src.seq + ")");
    } else {
      await page.click("#vt-res");
      await page.waitForSelector(".rdet .rdt", { timeout: 5000 });
      await page.evaluate(() => { location.hash = "#research/i2"; });
      await page.waitForSelector(".rdet .rdt");
      await page.click('[data-ra="src"][data-id="s6"]');
      await page.waitForTimeout(400);
      const desk = await steps();
      ok(!desk.bad && /^1+2/.test(desk.seq), "desktop: Research's headings step one level at a time, with a source open (" + desk.seq + ")");
    }
    /* the map: its controls are in the region, which is not there on the other views */
    await page.evaluate(() => document.querySelector('#dock [data-view="tree"]').click());
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => { const r = document.querySelector('[role=region][data-i18n-aria="map_ctl"]'); return !!r && !r.getClientRects().length; }),
      (phone ? "phone" : "desktop") + ": on the tree there is no empty Map controls region");
    await page.evaluate(() => document.querySelector('#dock [data-view="map"]').click());
    await page.waitForTimeout(1500);
    if (!phone) {
      ok((await region("#goto")) === "Map controls" && (await region("#playchip")) === "Map controls" && await page.isVisible('#goto [data-mr="alsace"]'),
        "desktop: the map's Go to places and Play are in the Map controls region");
    } else {
      await page.tap("#gochip");
      await page.waitForSelector("#gomenu button", { state: "visible", timeout: 3000 }).catch(() => {});
      const menu = await page.evaluate(() => {
        const m = document.getElementById("gomenu"), b = m.querySelector("button"); if (!b || !b.getClientRects().length) return null;
        const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { onTop: !!top && m.contains(top), n: m.querySelectorAll("button").length };
      });
      ok((await region("#gomenu")) === "Map controls" && (await region("#gochip")) === "Map controls" && menu && menu.onTop && menu.n >= 2,
        "phone: the open Go to menu is in the Map controls region and still on top of the page (" + JSON.stringify(menu) + ")");
      await page.evaluate(() => document.getElementById("lang").click());
      await page.waitForTimeout(300);
      ok((await region("#gochip")) === "Commandes de la carte", "phone: the region is named in French too");
    }
    await ctx.close();
  }
  /* ---------------- lines through a daughter (Cory, 3 Oct 2026): dashed all the way down, and a tag ---------------- */
  if (!REAL) {
    console.log("\n== lines through a daughter");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, "daughters");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(800);
    await page.click('.node:has(.nm:text-is("Branch2 Testmann")) [data-pill]');
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => {
      const card = nm => [...document.querySelectorAll(".node")].find(e => { const x = e.querySelector(".nm"); return x && x.textContent === nm; });
      const kid = card("Daughter2 Testmann") || card("Child2 Testmann"), head = card("Branch2 Testmann");
      const tag = kid && kid.querySelector(".vft");
      return { dashed: document.querySelectorAll("#world .edge.vf").length, tag: tag ? tag.textContent : null, title: tag ? tag.title : null,
        headTag: head ? !!head.querySelector(".vft") : null, legend: !!document.querySelector('[data-i18n="legend_vf"]') };
    });
    ok(st.dashed >= 1, "the line down from a daughter is dashed (" + st.dashed + ")");
    ok(st.tag === "through Branch2" && /Branch2 Testmann/.test(st.title || ""), "her child's card says through her, with her full name on hover (" + st.tag + ")");
    ok(st.headTag === false, "she herself is not marked: she is a daughter of the line");
    ok(st.legend, "Filters explains the dashed line");
    await shot(page, "v1-daughter-line.png");
    await ctx.close();
  }
  /* ---------------- the public demo: a folder like the family site (18 Oct 2026) ----------------
     Cory: "It took at least four seconds to work." The demo was one 2.4 MB file a phone fetched whole before anything
     showed. tools/build-demo.js now writes it as the family site is laid out: index.html with the cards, and beside it
     media/ (bios, pictures, the Research view's files, the line figures) and map/ (the map's layers). Built here from the
     invented family and research, served under the demo server's policy (connect-src 'self'), opened on a phone. */
  {
    console.log("\n== the demo, built as a folder");
    const BD = require(path.join(ROOT, "tools", "build-demo.js")), vm = require("vm");
    const DIR = path.join(OUT, "demo-src"), DEMO = path.join(OUT, "demo");
    fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(DEMO, { recursive: true });
    const tjs = page0.match(/<script>([\s\S]*)<\/script>/)[1];
    const lit = (re, name) => vm.runInNewContext(tjs.match(re)[0].replace(/^const /, "var ") + "\n" + name);
    const SITE = lit(/const SITE = \{[\s\S]*?\n\};/, "SITE");
    fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify(root));
    fs.writeFileSync(path.join(DIR, "research.json"), JSON.stringify(Object.assign({}, R, { decide: undefined })));
    fs.writeFileSync(path.join(DIR, "links.json"), JSON.stringify({ [idOf["Quintus Testmann"]]: 50, [idOf["Sextus Testmann"]]: 95 }));
    fs.writeFileSync(path.join(DIR, "lbl.txt"), "0AA~Alphaville~FR\n1CC~Gamma City~US\n");
    const slots = {}; [...page0.matchAll(/<!--build:([a-z0-9_-]+)-->/g)].forEach(m => { slots[m[1]] = m[1] === "head" ? "<title>Test Demo</title>" : m[1] === "title" ? "Test Demo" : ""; });
    const cfg = { site: Object.assign({}, SITE, { store: "ftbdemo-", autoPw: PW, research: true }), branches: lit(/const BRANCHES = \[[\s\S]*?\n\];/, "BRANCHES"),
      regions: lit(/const REGIONS = \{[\s\S]*?\n\};/, "REGIONS"), slots, synced: "2026-09-27", dataNote: "test demo build", maplbl: "lbl.txt",
      data: "data.json", research: "research.json", links: "links.json", password: PW, salt: SALT, iter: ITER,
      i18n: { en: { intro_title: "Test demo", search_long: "Search the test tree", pwopening: "Opening the demo", pwdemo: "Password: test" },
              fr: { intro_title: "Démo de test", search_long: "Rechercher", pwopening: "Ouverture de la démo", pwdemo: "Mot de passe : test" } } };
    const b = BD.build(page0, cfg, DIR);
    const e = await BD.encrypt(b.html, cfg, DIR, { files: b.files });
    BD.verify(e.html, b.defaults, cfg, e.files);
    BD.writeFolder(DEMO, "index.html", e.html, e.files);
    const wrote = new Set(["/demo/", "/demo/index.html", ...[...e.files.keys()].map(f => "/demo/" + f)]);
    const dEnc = P.readEnc(e.html), cardsOnly = P.openEnc(dEnc, PW, null, { core: true });
    ok(dEnc.v === 3 && e.files.has("media/" + dEnc.x + ".bin") && !cardsOnly.profile.bio && !JSON.stringify(cardsOnly).includes("oldest test person"),
      "the demo's page carries the cards only: its bios are in media/" + dEnc.x + ".bin beside it");
    for (const [label, opts] of [["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["desktop", { viewport: { width: 1280, height: 800 } }]]) {
      const ctx = await browser.newContext(opts);
      await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", ev => window.__csp.push(ev.violatedDirective + " " + ev.blockedURI)); });
      const page = await ctx.newPage();
      watch(page, "demo " + label);
      const fetched = [];
      page.on("request", r => { if (!/^(data|blob):/.test(r.url())) fetched.push(r.url().replace(BASE.replace(/\/$/, ""), "").split("?")[0]); });
      await reset();
      await page.goto(BASE + "demo/");
      await page.waitForFunction(() => document.getElementById("intro").style.display === "flex" && !!document.querySelector("#istart .istc"), null, { timeout: 15000 });
      ok(true, label + ": the demo opens itself and shows its welcome, with the start buttons (the bios came from media/)");
      const foot = await page.evaluate(() => document.getElementById("synctxt").textContent);
      ok(foot === "Data synced 27 Sep 2026", label + ": the demo's footer gives its date with the month's name (" + foot + ")");
      await page.click("#introgo");
      await page.waitForTimeout(300);
      const t = await page.evaluate(() => { const b = [...document.querySelectorAll(".node")].find(x => (x.querySelector(".nm") || {}).textContent === "Probus Testmann");
        const t0 = performance.now(); b.querySelector("[data-bio]").click();
        return { ms: performance.now() - t0, shown: document.getElementById("profile").style.display === "flex", text: !document.querySelector("#pbody .pload") && /oldest test person/.test(document.getElementById("pbody").textContent) }; });
      ok(t.shown && t.text, label + ": a card's Bio shows its text at once, in the same task as the tap (" + Math.round(t.ms) + " ms)");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (label === "phone") await page.tap('#dock [data-view="map"]'); else await page.click("#vt-map");
      await page.waitForFunction(() => document.querySelectorAll("#mappins .pin").length > 0, null, { timeout: 15000 });
      ok(true, label + ": the map draws its pins from the folder's map file");
      if (label === "phone") await page.tap('#dock [data-view="research"]'); else await page.click("#vt-res");
      await page.waitForFunction(() => /The mill years/.test(document.getElementById("resview").textContent), null, { timeout: 15000 });
      ok(true, label + ": Research shows the demo's own topics, from media/research.bin");
      const csp = await page.evaluate(() => window.__csp);
      ok(!csp.length, label + ": nothing the page does breaks the server's policy (connect-src 'self')" + (csp.length ? " — " + csp.slice(0, 3).join("; ") : ""));
      const stray = fetched.filter(u => !wrote.has(u));
      ok(fetched.length > 3 && !stray.length, label + ": every request is a file of the demo's own folder (" + fetched.length + " requests)" + (stray.length ? " — not: " + stray.slice(0, 4).join(", ") : ""));
      ok(fetched.filter(u => u === "/" + mapName.replace(/^\//, "") || /history\.bin|owner\.bin/.test(u)).length === 0, label + ": no family file is asked for (the family map, history notes, owner view)");
      await ctx.close();
    }
  }
  /* ---------------- phone ---------------- */
  {
    console.log("\n== phone");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, "phone");
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(800);
    const dock = await page.$$eval("#dock > button", bs => bs.filter(b => b.offsetWidth).map(b => b.offsetWidth));
    ok(dock.length === 4, "the dock holds Tree, Map, Research and Filters (" + dock.join(", ") + " px)");
    const dockW = await page.$eval("#dock", d => d.scrollWidth <= d.clientWidth + 1);
    ok(dockW, "the dock does not overflow at 390 px");
    await shot(page, "p1-tree.png");
    await page.tap('#dock [data-view="research"]');
    await page.waitForSelector(".rph .rinv", { timeout: 5000 });
    ok(await page.isHidden("#dockfilt"), "Filters leaves the dock in Research");
    await shot(page, "p2-list.png");
    const noScrollX = await page.evaluate(() => document.getElementById("resview").scrollWidth <= document.getElementById("resview").clientWidth + 1);
    ok(noScrollX, "no sideways scroll on the phone list");
    await page.tap('.rinv[data-id="i2"]');
    await page.waitForSelector(".rdet .rdt");
    ok((await page.textContent(".rdet .rdt")) === "The millstone’s carved year", "tapping an investigation opens it");
    await shot(page, "p3-inv.png");
    await page.tap('[data-ra="src"][data-id="s4"]');
    await page.waitForSelector(".rsheet h1");
    ok((await page.textContent(".rsheet h1")) === "The millstone itself", "tapping a source opens its sheet");
    await shot(page, "p4-source.png");
    await page.tap('[data-ra="visit"]');
    await page.waitForSelector(".rvisit h1");
    await shot(page, "p5-visit.png");
    /* the phone's Back button walks back one screen at a time and never leaves the site */
    await page.goBack();
    await page.waitForTimeout(500);
    ok(await page.isVisible(".rsheet h1"), "Back from the visit list returns to the source");
    await page.goBack();
    await page.waitForTimeout(500);
    ok(await page.isVisible(".rdet .rdt"), "Back again returns to the investigation");
    await page.goBack();
    await page.waitForTimeout(500);
    ok(await page.isVisible(".rph .rinv"), "and again to the list");
    ok(page.url().startsWith(BASE), "still on the site");
    /* leaving Research from inside it (review, 3 Oct 2026: about 250 ms later it was back in Research) */
    await page.tap('.rinv[data-id="i2"]');
    await page.waitForSelector(".rdet .rdt");
    await page.waitForTimeout(400);
    await page.tap('#dock [data-view="tree"]');
    await page.waitForTimeout(1000);
    let w = await where(page);
    ok(!w.res && !/^#research/.test(w.hash), "from an investigation, Tree stays on the tree (" + JSON.stringify(w) + ")");
    await page.tap('#dock [data-view="research"]');
    await page.waitForSelector(".rdet .rdt");
    await page.waitForTimeout(400);
    await page.tap('#dock [data-view="map"]');
    await page.waitForTimeout(1000);
    w = await where(page);
    ok(w.map && !w.res && !/^#research/.test(w.hash), "from an investigation, Map stays on the map (" + JSON.stringify(w) + ")");
    await page.tap('#dock [data-view="research"]');
    await page.waitForSelector(".rph");
    if (await page.isVisible('[data-ra="back"]')) { await page.tap('[data-ra="back"]'); await page.waitForTimeout(300); }
    await page.tap('.rinv[data-id="i1"]');
    await page.waitForSelector('.rdet [data-ra="person"]');
    await page.waitForTimeout(400);
    await page.tap('.rdet [data-ra="person"]');
    await page.waitForTimeout(1000);
    w = await where(page);
    ok(!w.res && !/^#research/.test(w.hash), "a person chip stays on the tree (" + JSON.stringify(w) + ")");
    /* the older layers keep their Back: a bio opened on the tree closes on Back (the guard change of 3 Oct) */
    const bioChip = await page.$('.node [data-bio]');
    ok(!!bioChip, "a card on the phone has its Bio button");
    if (bioChip) {
      await bioChip.evaluate(el => el.click());   /* the keyboard path: the tree reads taps from pointer events */
      await page.waitForSelector("#profile .phead", { timeout: 5000 });
      await page.waitForTimeout(400);
      await page.goBack();
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => document.getElementById("profile").style.display !== "flex"), "Back still closes a bio");
      ok(page.url().startsWith(BASE), "and stays on the site");
    }
    await page.tap('#dock [data-view="research"]');
    await page.waitForTimeout(300);
    /* French on the phone, the visit list */
    await page.evaluate(() => { location.hash = "#research/visit/v1"; });
    await page.waitForSelector(".rvisit h1");
    await page.evaluate(() => document.getElementById("lang").click());
    await page.waitForTimeout(300);
    ok(/Musée du moulin d’Alphaville/.test(await page.textContent(".rvisit h1")), "French: the visit list");
    await shot(page, "p6-visit-fr.png");
    await page.tap('[data-ra="who"]');
    await page.waitForSelector(".rwho h1");
    ok((await page.textContent(".rwho h1")) === "La liste de Une voisine" && (await page.$$eval(".rwho .rpri span", e => e.map(x => x.textContent))).join("|") === "À faire en priorité|Si le temps le permet",
      "French: the person's list and its priorities");
    ok(await page.evaluate(() => document.getElementById("resview").scrollWidth <= document.getElementById("resview").clientWidth + 1), "no sideways scroll on the person's list");
    await shot(page, "p7-who-fr.png");
    await page.goBack();
    await page.waitForTimeout(500);
    ok(await page.isVisible(".rvisit:not(.rwho) h1"), "Back from the person's list returns to the visit list");
    await ctx.close();
  }
  console.log("\npage errors: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  ok(!errors.length, "no page errors");
  await browser.close();
}

/* --real: every investigation, wide and phone, English and French, with screenshots to read */
async function runReal() {
  const browser = await chromium.launch();
  const errors = [];
  const ids = R0.investigations.map(iv => iv.id);
  for (const [label, opts] of [["wide", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(label + ": " + e.message));
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(1500);
    const badges = await page.$$eval(".node .rqb", e => e.length);
    console.log("     " + label + ": the tree shows " + badges + " research badge(s) on the cards drawn at start");
    await shot(page, label + "-0-tree.png");
    for (const lang of ["en", "fr"]) {
      if (lang === "fr") await page.evaluate(() => document.getElementById("lang").click());
      let shown = 0;
      for (const id of ids) {
        await page.evaluate(i => { location.hash = "#research/" + i; }, id);
        await page.waitForSelector(".rdet .rdt", { timeout: 8000 }).catch(() => {});
        const t = await page.$eval(".rdet .rdt", e => e.textContent).catch(() => "");
        if (t) shown++;
        await shot(page, label + "-" + lang + "-" + id + ".png");
      }
      ok(shown === ids.length, label + " " + lang + ": every investigation opens (" + shown + " of " + ids.length + ")");
      await page.evaluate(() => { location.hash = "#research"; });
      await page.waitForTimeout(300);
      await shot(page, label + "-" + lang + "-list.png");
      for (const v of Object.keys(R0.visits || {})) {
        await page.evaluate(x => { location.hash = "#research/visit/" + x; }, v);
        await page.waitForSelector(".rvisit h1", { timeout: 8000 }).catch(() => {});
        await shot(page, label + "-" + lang + "-visit-" + v + ".png");
      }
      /* each person's whole list (5 Oct 2026), from the button on a visit list */
      for (const v of Object.keys(R0.visits || {})) {
        await page.evaluate(x => { location.hash = "#research/visit/" + x; }, v);
        await page.waitForSelector('.rvisit [data-ra="who"]', { timeout: 8000 }).catch(() => {});
        const slug = await page.$eval('.rvisit [data-ra="who"]', b => b.dataset.id).catch(() => "");
        if (!slug) continue;
        await page.click('.rvisit [data-ra="who"]');
        await page.waitForSelector(".rwho h1", { timeout: 8000 }).catch(() => {});
        await shot(page, label + "-" + lang + "-who-" + slug + ".png");
      }
    }
    await ctx.close();
  }
  /* Play on the real pins (17 Oct 2026): the bar and the camera at a run of years, wide and on a phone, and a few
     seconds of playing through the emigration years, one picture a second, for a person to look at */
  for (const [label, opts] of [["wide", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(label + " play: " + e.message));
    await page.goto(BASE);
    await unlock(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-view="map"]').click());
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById("playchip").click());
    await page.waitForTimeout(1200);
    const seek = y => page.evaluate(v => { const r = document.getElementById("pbrange"); r.value = v; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }, y);
    await page.evaluate(() => document.getElementById("pbplay").click());   /* pause: each picture is one year */
    const lone = [];
    for (const y of [1500, 1600, 1700, 1760, 1800, 1850, 1880, 1900, 1905, 1950, 2000, 2026]) {
      await seek(y);
      await page.waitForTimeout(700);
      await shot(page, label + "-play-" + y + ".png");
      if (await page.evaluate(() => [...document.querySelectorAll("#playfaces .pfmore.solo")].some(e => e.style.display !== "none"))) lone.push(y);
    }
    ok(!lone.length, label + ": never a +N with no face beside it" + (lone.length ? " (not in " + lone.join(", ") + ")" : ""));
    ok(+(await page.textContent("#pbyear")) === 2026, label + ": Play moves to any year from its slider");
    await seek(1838);
    await page.evaluate(() => { document.getElementById("pbspeed").click(); document.getElementById("pbplay").click(); });   /* 5 years a second */
    for (let i = 1; i <= 8; i++) { await page.waitForTimeout(1000); await shot(page, label + "-play-run-" + i + ".png"); }
    await ctx.close();
  }
  console.log("\npage errors: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  ok(!errors.length, "no page errors with the real data");
  console.log("screenshots: " + SHOTS);
  await browser.close();
}

server.listen(0, "127.0.0.1", () => {
  BASE = "http://127.0.0.1:" + server.address().port + "/";
  (REAL ? runReal() : run()).catch(e => { console.error(e); fail++; }).finally(() => {
    server.close(); fs.rmSync(OUT, { recursive: true, force: true });
    console.log("\n" + pass + " passed, " + fail + " failed");
    process.exit(fail ? 1 : 0);
  });
});
