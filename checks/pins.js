'use strict';
// RETIRED 16 Nov 2026. This report classed each card's evidence and listed the [doc] pins on
// cards that held only a compiled tree. Its one reader, checks/retag.js, was retired on
// 24 Sep 2026, and nothing has run it since. A doc pin is now checked where it is written:
// tools/change.js refuses a new doc pin, or a change of grade, without evidence from our copy
// of the source, and checks/run.js (check C3) reads every pin's note against its grade.
//
// Its body is gone.
console.error('RETIRED: for one card run node tools/card.js <id>; for every pin run node checks/run.js --only=C3.');
process.exit(1);
