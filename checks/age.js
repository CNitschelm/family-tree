'use strict';
// Age/interval claim extraction with subject resolution, for C4.
const L = require('./lib.js');

const NUM = Object.keys(L.NUMWORD).join('|');
// "aged N" | "at the age of N" | "then N" | "N years old" | "of N" after a trade
// | "widowed at N" | "married at N" | "N at the crossing" | "ages him at N"
const AGE_PATTERNS = [
  { re: new RegExp(`\\bage[ds]?(?:\\s+him|\\s+her|\\s+them)?\\s+(?:at\\s+|of\\s+|as\\s+)?(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'aged' },
  { re: new RegExp(`\\b(?:his|her|their) age (?:as|at)\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'age as' },
  { re: new RegExp(`\\bat the age of\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'age of' },
  { re: new RegExp(`\\bthen\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'then' },
  { re: new RegExp(`\\b(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\s+years? old\\b`, 'gi'), cue: 'years old' },
  { re: new RegExp(`\\b(?:widowed|married|orphaned|died|buried|left|emigrated|sailed|arrived|enlisted|apprenticed)\\s+at\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'verb at' },
  { re: new RegExp(`\\ba\\s+\\w+\\s+of\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'trade of N' },
  { re: new RegExp(`\\b(?:and|was|still|only|just|barely|already)\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\s+(?:at|when|on|in)\\b`, 'gi'), cue: 'N at/when' },
  { re: new RegExp(`\\bage[ds]?\\s+(?:him|her|them)\\s+at\\s+(${NUM}|\\d{1,3})(?:[-\\s](${NUM}))?\\b`, 'gi'), cue: 'ages at' }
];
// contexts where a number is NOT an age
const NOT_AGE = /(?:o'clock|in the morning|in the evening|in the afternoon|at night|a\.m|p\.m|past|to the hour|minutes?|hours?|degrees?|miles?|km|kilometres?|kilometers?|feet|foot|acres?|dollars?|cents?|per cent|percent|page|pages|vol|volume|line|lines|act|children|sons|daughters|witnesses|people|persons|entries|records|times|generations?|years later|years after|years before|days?|weeks?|months?)/i;

// things that have an "age" but are not people
const INANIMATE = /\b(?:household|marriage|farm|business|building|town|city|village|company|firm|brewery|forge|mill|colony|church|congregation|school|register|book|tree|site|house|bridge|road|inn|shop|stone|cemetery|state|county|parish|series|line|name)\b[^.]{0,25}$/i;

function ageClaims(sentence) {
  const t = L.norm(sentence), out = [], taken = [];
  for (const p of AGE_PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of t.matchAll(p.re)) {
      const n = L.wordToNum([m[1], m[2]].filter(Boolean).join('-'));
      if (n == null || n < 1 || n > 110) continue;
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 22);
      if (NOT_AGE.test(after)) continue;
      if (INANIMATE.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
      taken.push([m.index, m.index + m[0].length]);
      const pre = t.slice(0, m.index), post = t.slice(m.index);
      const q = (pre.match(/[\u201c\u201d\u00ab\u00bb"]/g) || []).length;
      const inQuote = q % 2 === 1 || /^[^\u201c\u201d\u00ab\u00bb"]{0,25}[\u201d\u00bb"]/.test(post.slice(m[0].length));
      out.push({ n, raw: m[0].trim(), index: m.index, cue: p.cue, quoted: inQuote });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// nearest capitalised personal name occurring before `index` in the sentence
const NAMEWORD = /\b([A-ZÀ-Ý][a-zà-ÿ]+(?:[-' ][A-ZÀ-Ý][a-zà-ÿ]+){0,3})\b/g;
const NOTNAME = /^(The|A|An|His|Her|Their|He|She|It|They|In|On|At|By|From|To|Of|And|But|That|This|These|Those|When|Where|What|Who|Both|Three|Two|One|Four|Five|Six|Seven|Eight|Nine|Ten|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Act|Born|Died|Married|Buried|Fifty|Forty|Thirty|Twenty|Sixty|Seventy|Eighty|Ninety|Confusingly|Signed|Godfather|Godmother)\b/;

function nearestName(sentence, index) {
  const t = L.norm(sentence);
  NAMEWORD.lastIndex = 0;
  let best = null;
  for (const m of t.matchAll(NAMEWORD)) {
    if (m.index >= index) break;
    if (NOTNAME.test(m[1])) continue;
    best = { name: m[1], index: m.index };
  }
  return best;
}

module.exports = { ageClaims, nearestName };
