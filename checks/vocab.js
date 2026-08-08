'use strict';
// Shared vocabularies for the checks.

// --- hedge language -------------------------------------------------------
const HEDGE_EN = [
  'cannot be checked', 'cannot be verified', 'cannot be proved', 'cannot be traced',
  'cannot be confirmed', 'cannot say', 'cannot be read', 'cannot be resolved',
  'is not settled', 'not settled', 'is not proven', 'not proven', 'unproven',
  'unverified', 'unconfirmed', 'undocumented', 'uncertain', 'unclear', 'unidentified',
  'nothing decides', 'never been traced', 'never been found', 'never been identified',
  'never been proved', 'never proved', 'never identified', 'has not been found',
  'has not surfaced', 'has not been traced', 'not been found', 'was never written',
  'recorded nowhere', 'nowhere recorded', 'is not known', 'not known', 'not recorded',
  'may have', 'might have', 'may be', 'might be', 'is said to', 'said to be',
  'reportedly', 'allegedly', 'alleged', 'apparently', 'probably', 'possibly',
  'perhaps', 'seems to', 'appears to',
  'is doubtful', 'doubtful', 'in doubt', 'a candidate', 'as a candidate',
  'a possibility', 'as a possibility', 'not as a fact', 'traditionally',
  'family memory', 'family accounts', 'family tradition', 'remains open', 'still open',
  'open question', 'two readings', 'both readings', 'every reading', 'one reading',
  'disputed', 'contradicts', 'contradiction', 'conflicting',
  'has never', 'never been', 'no independent',
  'not been proved', 'cannot be settled', 'is not carried', 'has failed',
  'exhaustive search', 'documented negative', 'dead end',
  'does not say', 'never says', 'is not clear',
  'a guess', 'guesswork', 'inferred', 'inference', 'presumed', 'presumably',
  'assumed', 'supposedly', 'as yet', 'not yet', 'for want of anything better',
  'went unregistered', 'has yet to'
];
// regex hedges — catch the "no <adj> <noun> …" shapes a substring list misses
// "no document says the 21st" supports the 22nd — it is not a hedge on the 22nd.
const NEGATIVE_SUPPORT = /\bno\s+(?:\w+\s+){0,2}(?:document|record|source|act|register|entry|index)\s+(?:says|gives|names|mentions|carries|reads|enters|records)\b/i;
const NEGATIVE_SUPPORT_FR = /\baucun[e]?\s+(?:\w+\s+){0,3}(?:document|acte|registre|source|relev[ée]|index)\s+ne\s+(?:dit|donne|nomme|porte|mentionne|indique|inscrit)\b/i;
const HEDGE_EN_RE = [
  /\bno\s+(?:\w+[\s-]){0,4}(records?|sources?|documents?|traces?|evidence|proof|acts?|registers?|entry|entries|day|date|mention|listing|copy|indication)\b/i,
  /\bnot(?:hing)?\s+(?:been\s+)?(?:yet\s+)?(?:been\s+)?(?:found|traced|identified|proved|proven|verified|settled|established|recorded|read)\b/i,
  /\bnever\s+(?:been\s+)?(?:found|traced|identified|proved|proven|verified|settled|established|recorded|surfaced|written)\b/i,
  /\bwhether\b/i, /\beither\b.*\bor\b/i, /\bcould (?:be|have)\b/i, /\bwould (?:be|have)\b/i,
  /\bif (?:that|it|this|he|she|they) (?:is|was|were|are)\b/i,
  /\b(?:is|are|was|were)\s+not\s+(?:settled|proven|proved|known|clear|certain|carried|among|recorded)\b/i,
  /\bonly\s+(?:a|one|the)\s+(?:single|one)?\s*\w*\s*(?:tree|source|reading|account|record)\b/i,
  /\brests? on\b/i, /\bturns? on\b/i, /\bfor want of\b/i,
  /\bthe only source\b/i, /\bonly source\b/i,
  /\bone of them gives\b/i, /\bnot cited here\b/i, /\bno source cited\b/i,
  /\bcannot\s+(?:be\s+)?(?:checked|verified|proved|proven|traced|settled|resolved|read|known|confirmed|closed|established|say|tell|be said)\b/i,
  /\bunable to\b/i, /\bnobody (?:knows|knew|recorded|wrote)\b/i,
  /\bneither\b[^.]{0,40}\b(?:cited|carried|held|survives|is on|appears)\b/i,
  /\bin circulation\b/i, /\bnot cited\b/i, /\bnone of them\b/i,
  /\blikely\b/i, /\bprobable\b/i, /\bpossible\b/i, /\bsuggests?\b/i, /\bimplies\b/i,
  /\btradition\b/i, /\bclaims?\b/i, /\bthought to\b/i, /\bbelieved to\b/i
];
const HEDGE_FR = [
  'ne peut etre verifie', 'ne peut etre verifiee', 'ne peut etre prouve', 'ne peut etre prouvee',
  "n'est pas tranche", "n'est pas tranchee", 'pas tranche', "n'est pas prouve", 'non prouve',
  'non verifie', 'inverifiable', 'incertain', 'incertaine', 'obscur',
  'non identifie', 'non identifiee', 'ignore', 'on ignore', 'peut-etre', 'sans doute',
  'probablement', 'vraisemblablement', 'apparemment', 'semble', 'parait', 'aurait',
  'douteux', 'douteuse', 'hypothese', 'candidat', 'candidate',
  'possibilite', 'tradition', 'memoire familiale', 'recits de famille', 'dit-on',
  'reste ouverte', 'question ouverte', 'deux lectures', 'les deux lectures',
  'chaque lecture', 'contradiction', 'contredit', 'litigieux',
  'savoir si', 'ne dit pas', 'ne precise pas', 'presume', 'presumee',
  'suppose', 'supposee', 'deduit', 'deduction', 'negatif documente',
  'pas encore', "n'est pas connu", 'inconnu', 'inconnue', 'non confirme',
  'faute de mieux', 'impasse documentee', "n'etaient pas enregistres", 'repose sur',
  'sans certitude', 'on ne sait', 'ne connait', 'sous reserve', 'non tranche'
];
const HEDGE_FR_RE = [
  /\b(?:aucun|aucune)\s+(?:\w+[\s-]){0,4}(?:acte|source|document|trace|preuve|registre|mention|jour|date|copie|indication|enregistrement)\b/i,
  /\bn'a\s+(?:jamais\s+)?(?:pu\s+)?(?:ete\s+)?(?:trouve|identifie|prouve|verifie|tranche|etabli|enregistre|retrouve)/i,
  /\bjamais\s+(?:ete\s+)?(?:trouve|identifie|prouve|verifie|tranche|etabli|enregistre|ecrit|retrouve)/i,
  /\bnulle part\b/i, /\brien ne\b/i, /\bsi c'est\b/i,
  /\bne peut\s+(?:pas\s+)?(?:[êe]tre\s+)?(?:v[ée]rifi|prouv|tranch|[ée]tabli|retrouv|lu\b|confirm|dire\b|savoir\b|fermer)/i,
  /\bni l'un ni l'autre\b/i, /\bn'est cit[ée]\b/i, /\ben circulation\b/i,
  /\bsoit\b.*\bsoit\b/i, /\bpourrait\b/i, /\bserait\b/i,
  /\bne (?:sont|est|etait|etaient) pas\b/i, /\bsans (?:registre|source|preuve|acte|jour|date)\b/i,
  /\bun seul\b/i, /\bune seule\b/i, /\bsuggere\b/i, /\bimplique\b/i, /\bprobable\b/i,
  /\bpersonne ne\b/i, /\bque personne\b/i, /\bnul ne\b/i, /\bfaute de\b/i, /\bne subsiste\b/i
];

// --- source types a sentence can invoke -----------------------------------
const SOURCE_TYPES = [
  { key: 'register', prose: /\b(?:the )?(?:parish |civil |church |baptismal |marriage |death |burial )?registers?\b|\bregistres?\b/i,
    inv: /register|registre|\bBMS\b|paroiss|parish|acte|act n|act \d|EDEPOT|archives6[78]|AD Bas-Rhin|AD Haut-Rhin|d[ée]c[èe]s|naissance|mariage|baptis|bapt[êe]me|RP\/|5E\/|Kirchenbuch|\bark\b|\bE \d|Geneanet, fhebert|transcription/i },
  { key: 'census', prose: /\b(?:the )?(?:\d{4} )?census\b|recensement/i,
    inv: /census|recensement|FamilySearch|18[3-9]0|19[0-4]0/i },
  { key: 'obituary', prose: /\bobituar|\bn[ée]crolog/i,
    inv: /obituar|n[ée]crolog|Sentinel|Herald|Tribune|Journal|Free Trader|newspaper|journal|Republican|Evening|Press|News/i },
  { key: 'gravestone', prose: /\b(?:the |his |her )?(?:grave)?stone\b|\bgravestone|\bheadstone|\bpierre tombale/i,
    inv: /FindAGrave|find a grave|gravestone|headstone|stone|tombe|memorial|cemetery|cimeti/i },
  { key: 'act', prose: /\b(?:the |his |her |a )(?:birth|death|marriage|baptism|burial|succession|notarial)? ?acts?\b|\bl'acte\b|\bacte de\b/i,
    inv: /acte|act n|act \d|register|registre|EDEPOT|archives6[78]|AD Bas-Rhin|AD Haut-Rhin|\bark\b|\bBMS\b|d[ée]c[èe]s|naissance|mariage|succession|notari|transcription|Geneanet, fhebert/i },
  { key: 'countybook', prose: /\bcounty (?:biographical )?(?:record|book)\b|\bbiographical record\b/i,
    inv: /biographical record|county|La ?Salle|1900/i },
  { key: 'bible', prose: /\b(?:the )?family bible\b|\bbible\b/i, inv: /bible/i },
  { key: 'naturalisation', prose: /\bnaturali[sz]ation\b|\bdeclaration of intention\b|\bfirst papers\b|\bsecond papers\b|\bnaturalisation oath\b/i,
    inv: /naturali|declaration|papers|oath|NDSU|Morton/i },
  { key: 'manifest', prose: /\bpassenger (?:list|manifest)\b|\bship'?s? manifest\b/i,
    inv: /manifest|passenger|SS |steer|Havre|arrival|immigra|M237/i },
  { key: 'deathrecord', prose: /\bdeath (?:record|certificate|return|index)\b|\bcertificat de d[ée]c[èe]s\b/i,
    inv: /death|d[ée]c[èe]s|certificate|register|SSDI|index|FindAGrave|record/i },
  { key: 'ssdi', prose: /\bSSDI\b|\bsocial security\b/i, inv: /SSDI|Social Security|SSA/i },
  { key: 'familysite', prose: /\bfamily (?:web)?site\b|\bastrosurf\b|\bsite familial\b/i,
    inv: /astrosurf|family site|site familial|Geneanet|Hoffman|famille|Christian/i },
  { key: 'onlinetree', prose: /\bonline family tree\b|\bcompiled tree\b|\bmember tree\b|\barbre en ligne\b/i,
    inv: /Geneanet|astrosurf|FamilySearch|Ancestry|member tree|arbre|family tree/i },
  { key: 'deed', prose: /\b(?:the )?deed\b|\bland patent\b|\bland (?:entry|record)\b|\btract book\b/i,
    inv: /deed|patent|BLM|GLO|land|tract|homestead/i },
  { key: 'banstudy', prose: /\bBan de la Roche study\b/i, inv: /Ban de la Roche|badonpierre/i }
];

// how many sources of each family the card carries — for count assertions
const SOURCE_FAMILIES = [
  { key: 'compiled tree', re: /astrosurf|Geneanet|family tree|member tree|arbre|FamilySearch tree|Hoffman|family site|site familial/i },
  { key: 'register',      re: /register|registre|acte|act n|BMS|EDEPOT|archives6[78]|AD Bas-Rhin|AD Haut-Rhin|paroiss|Kirchenbuch/i },
  { key: 'census',        re: /census|recensement/i }
];

const TOOLTIP_SOURCEY = /\b(?:census|registers?|registres?|recensement|obituary|source|according to|acte? n|act \d|acte \d|astrosurf|FindAGrave|SSDI|per the|selon|Geneanet)\b|https?:\/\//i;

const MACHINERY = [
  /\bthis card\b/i, /\bthis tree\b/i, /\bthis site\b/i,
  /\bcette fiche\b/i, /\bcet arbre\b/i, /\bce site\b/i, /\bcette carte\b/i,
  /\btranscribed (?:on|here)\b/i, /\bnow follows\b/i, /\bonce implied\b/i,
  /\bhas long\b/i, /\bhas said both\b/i, /\bwe (?:now )?(?:say|follow|keep)\b/i,
  /\bcarried here\b/i, /\bis carried\b/i, /\bdrawn here\b/i, /\bshown here\b/i,
  /\bon this page\b/i, /\bthe tree displays\b/i, /\bas displayed\b/i
];

// cross-card references — a claim about what some OTHER card says
const CROSSCARD = /\b(?:on|from|in)\s+(?:his|her|their|that person's|that man's|the other|[A-ZÀ-Ý][\wÀ-ÿ'’-]+(?:'s|’s))\s+(?:own\s+)?cards?\b|\b[A-ZÀ-Ý][\wÀ-ÿ'’-]+(?:'s|’s)\s+cards?\b|\bthat person'?s own cards?\b|\bsur (?:la|sa) fiche\b|\bcit[ée]e? sur la fiche\b|\bde (?:sa|la) fiche\b|\btranscrit[e]? sur la fiche\b|\bfiche de (?:celui-ci|celle-ci|son|sa)\b/i;

module.exports = {
  HEDGE_EN, HEDGE_EN_RE, HEDGE_FR, HEDGE_FR_RE, NEGATIVE_SUPPORT, NEGATIVE_SUPPORT_FR,
  SOURCE_TYPES, SOURCE_FAMILIES, TOOLTIP_SOURCEY, MACHINERY, CROSSCARD
};
