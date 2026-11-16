'use strict';
// RETIRED 24 Sep 2026. Edits to data.json go through tools/change.js, which records each one in the
// ledger with its evidence and checks it against the register and the payload's history
// (OPERATING.md, "The loop"). This tool wrote data.json or patch files outside that loop — the route
// by which grades were set in bulk and later flipped back — so it now refuses to run.
//
// Its body is gone: every tracked file here is public and served by the site, so a retired script
// keeps nothing but this note (register R-0761; tests/run.js, "No names in the plaintext repo").
console.error('RETIRED: use node tools/change.js — see OPERATING.md, "The loop".');
process.exit(1);
