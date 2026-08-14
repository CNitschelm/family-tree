'use strict';
// S1 — the source-attribution check.
//
// The most expensive error in this project's history was writers attributing schooling, careers,
// addresses and day-dates to a family-site page that carries none of those, across eleven cards
// and three branches. The second most expensive was the mirror image: writers STRIKING true
// claims because they wrongly believed a source could not carry them.
//
// Both are the same failure — deciding from memory what a source says. The fix is that every
// source now has a fact sheet in sources/, written by a steward who fetched and read it, and
// this check tests the site's prose against those sheets.
//
//   node checks/sources.js            # report
//   node checks/sources.js --json f   # machine-readable
//
// A sheet's "## Does NOT carry" section is the contract. If a sentence names a source and makes a
// claim in a category that source's sheet excludes, that is a false citation and it is reported.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const DIR = path.join(__dirname, '..', 'sources');

// How a source is named in prose, per sheet. Keys are sheet basenames.
const NAMED = {
  astrosurf: /\bthe family site\b|\bastrosurf\b|\ble site familial\b/i,
  hoffman: /\bHoffman family tree\b|\bl['’]arbre Hoffman\b|\bthe Hoffman tree\b/i,
  baradel: /\bBaradel\b|\bSaiRePa\b|\bSAIREPA\b/i,
  'archives-alsace': /\bArchives d['’]Alsace\b|\bEDEPOT\b|\bAD Bas-Rhin\b|\boriginal register\b|\bregistre original\b/i,
  'us-records': /\bcensus\b|\brecensement\b|\bdeath index\b|\bmarriage index\b|\bFindAGrave\b|\bnaturalisation\b|\bnaturalization\b|\btract book\b|\bland patent\b/i,
  newspapers: /\bEvening Herald\b|\bFree Trader\b|\bKeene Sentinel\b|\bcounty book\b|\blivre du comté\b|\bRuth King\b/i,
  /* ft-allow-names-begin: named institutions and published works, not family */
  'published-works': /\bNouveau dictionnaire de biographie alsacienne\b|\bNDBA\b|\bNeue Deutsche Biographie\b|\bNobel\b|\bMaison Albert Schweitzer\b|\bGoethe\b/i,
  /* ft-allow-names-end */
  'family-papers': /\bfamily bible\b|\bbible de famille\b|\bBan de la Roche\b|\baffidavit\b|\bfamily records\b|\bdocuments de la famille\b/i,
};

// Claim categories a sheet can exclude, and how they show up in prose.
const CATEGORY = {
  schooling: /\bschool(ing|ed)?\b|\buniversit|\bgymnasium\b|\bstudied\b|\bscolarit|\bétudes\b|\blycée\b|\bcollège\b/i,
  career: /\bschoolmaster\b|\bweaver\b|\bbrewer\b|\bfarrier\b|\bblacksmith\b|\bpastor\b|\btrade\b|\bprofession\b|\bmétier\b|\binstituteur\b|\bmaître d['’]école\b|\btisserand\b|\bpasteur\b/i,
  address: /\b\d+\s+(rue|boulevard|bd|avenue|street|road)\b|\brue [A-ZÉ]/,
  'day-date': /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\b\d{1,2}\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}\b/i,
  'act-number': /\bact n[°º]\s*\d|\bacte n[°º]\s*\d|\bn[°º]\s*\d{3,}/i,
  birthplace: /\bborn (at|in)\b|\bné(e)? à\b|\bbirthplace\b|\blieu de naissance\b/i,
};

function loadSheets() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.md')).map(f => {
    const key = f.replace(/\.md$/, '');
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    const block = (text.match(/```contract\n([\s\S]*?)```/) || [])[1] || '';
    const line = k => ((block.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').trim();
    const list = v => (v === '(none)' || !v) ? [] : v.split(/\s*[,|]\s*/).filter(Boolean);
    const excludes = list(line('excludes')).map(cat => ({ cat, re: CATEGORY[cat] })).filter(e => e.re);
    const exempt = list(line('exempt'));
    const status = (text.match(/^status:\s*(\w+)/mi) || [])[1] || 'UNKNOWN';
    return { key, name: NAMED[key], excludes, exempt, status, hasContract: !!block };
  }).filter(s => s.name);
}

const findings = [];
function main() {
  const sheets = loadSheets();
  if (!sheets.length) {
    console.error('no fact sheets in sources/ — run the source stewards first');
    process.exit(1);
  }
  const { people } = L.load();
  let checked = 0;

  for (const p of people) {
    for (const f of L.fields(p)) {
      if (!f.text || typeof f.text !== "string") continue;
      // source labels describe the source; they are allowed to name its scope
      if (/^(src|psrc|profile\.sources)\[/.test(f.path)) continue;
      for (const sh of sheets) {
        if (!sh.name.test(f.text)) continue;
        checked++;
        for (const ex of sh.excludes) {
          // only flag when the claim sits in the same sentence as the source's name
          // clauses, not sentences: this site routinely sets two sources side by side in one
          // sentence, and a co-occurrence check cannot tell which claim attaches to which
          const clauses = L.sentences(f.text).flatMap(x => x.split(/\s*[;—]\s*/));
          for (const sent of clauses) {
            if (!sh.name.test(sent) || !ex.re.test(sent)) continue;
            // if a clause names more than one source, the attribution is ambiguous — say nothing
            if (sheets.filter(o => o.name.test(sent)).length > 1) continue;
            // a documented negative naming what the source does NOT give is correct
            if (/\bno\b|\bnot\b|\bneither\b|\bnone\b|\baucun|\bni\b|\bne donne\b|\bne porte\b|\bne mentionne\b/i.test(sent)) continue;
            // the sheet may name individuals the source does carry this category for
            if (sh.exempt.some(x => sent.includes(x) || p.id.includes(x))) continue;
            findings.push({
              check: 'S1', sev: 'high', card: p.id, path: f.path,
              msg: `names ${sh.key} for a ${ex.cat} claim, which sources/${sh.key}.md says it does not carry`,
              detail: { sentence: sent.trim().slice(0, 240) },
            });
          }
        }
      }
    }
  }

  const outIdx = process.argv.indexOf('--json');
  if (outIdx > -1) fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(findings, null, 1));

  console.log(`sheets: ${sheets.length} (${sheets.filter(s => s.status === 'VERIFIED').length} VERIFIED)`);
  sheets.forEach(s => console.log(`  ${s.key.padEnd(18)} ${s.status.padEnd(10)}${s.hasContract?'':' NO-CONTRACT'} excludes: ${s.excludes.map(e => e.cat).join(', ') || '(none parsed)'}`));
  console.log(`\nfields naming a source: ${checked}`);
  console.log(`S1 findings: ${findings.length}`);
  for (const f of findings) console.log(`  [${f.card}] ${f.path}\n     ${f.msg}\n     "${f.detail.sentence}"`);
}
main();
