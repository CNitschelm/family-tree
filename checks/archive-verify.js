'use strict';
// RETIRED 16 Nov 2026. This asked whether the archive holds the record itself, or only a page the
// server was willing to send: a viewer frame, a wall, an empty file. It read archive/store and
// archive/hand, which are in the source archive's own repository (family-tree-sources), not in this
// one. Run here it found no archive at all and reported every source as never captured, which looks
// like total loss and is not. Nothing ran it: no script, no workflow, no test.
//
// The archive answers the question itself now, from its own clone: checks/index.js grades every
// source by what is held (an empty viewer page is not counted as a copy), checks/archive-status.js
// prints the numbers and what is not held, and checks/verify.js re-hashes the stored files against
// their recorded hashes.
//
// checks/archive-status.js in this repository is the older twin of the archive's script of that name.
// It stays for now, because checks/manifest.js and the private notes still name it; it too finds no
// archive here, so run the archive's own.
console.error('RETIRED: the source archive checks itself now. In the family-tree-sources clone ($FT_ARCHIVE) run ' +
  'node checks/archive-status.js (what is held, what is not, what is only a typed reading) and ' +
  'node checks/verify.js (the stored files against their recorded hashes).');
process.exit(1);
