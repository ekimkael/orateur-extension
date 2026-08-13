/**
 * French rules, in two layers.
 *
 * `VERBALIZE` turns symbols and abbreviations into French words. It applies to
 * every engine, neural included: a synthesiser reads `%` or `→` however it
 * likes, so we spell out the intent ourselves.
 *
 * `PHONETIC` respells loanwords and product names for **French system voices**
 * only. A multilingual neural engine handles loanwords on its own and these
 * rewrites degrade it (see `skipPhonetic`).
 *
 * Two writing rules, learned the hard way:
 *  - a word that exists in French is never respelled (`agent` used to become
 *    `aidjeunte`, which mangled « un agent immobilier ») ;
 *  - a respelling contains no internal hyphen or space — the voice pauses
 *    exactly where we write one, which is what chopped words in half.
 */

export const VERBALIZE: [RegExp, string][] = [
  [/\be\.g\.\s*/gi, 'par exemple, '],
  [/\bex\.\s*/gi, 'par exemple, '],
  [/\betc\.\s*/gi, 'et cetera. '],
  [/\bvs\.\s*/gi, 'versus '],
  // The period is optional (« Dr Dupont » is the correct French form) but a
  // following space is required, otherwise `Dr` would eat « Drone ».
  [/\bDr\.?(?=\s)/g, 'Docteur'],
  [/\bMme\.?(?=\s)/g, 'Madame'],
  [/\bM\.(?=\s)/g, 'Monsieur'],
  [/(\d+)\s*%/g, '$1 pourcent'],
  [/(\d+)\+/g, '$1 ou plus'],
  [/\b1er\b/g, 'premier'],
  [/\b2e\b/g, 'deuxième'],
  [/\b3e\b/g, 'troisième'],
  [/→/g, ' vers '],
  [/×/g, ' fois '],
  [/\+(?=\s)/g, ' plus '],
];

export const PHONETIC: [RegExp, string][] = [
  [/\bbacklog(s)?\b/gi, 'baquelog$1'],
  [/\bstartup(s)?\b/gi, 'startop$1'],
  [/\bchangelog(s)?\b/gi, 'tcheindjlog$1'],
  [/\bonboarding\b/gi, 'onbording'],
  [/\binbound\b/gi, 'inbaound'],
  [/\bplaybook(s)?\b/gi, 'plèibouk$1'],
  [/\bfeedback\b/gi, 'fidbak'],
  [/\bhackathon(s)?\b/gi, 'hakaton$1'],
  [/\bvibe coding\b/gi, 'vaïb koding'],
  // Kept despite « prompt rétablissement »: in imported articles the AI sense
  // dominates, and untouched a French voice says « pron ».
  [/\bprompt(s)?\b/gi, 'prompte$1'],
  [/\btoken(s)?\b/gi, 'tokène$1'],
  [/\bchunk(s)?\b/gi, 'tchonk$1'],
  [/\bbug(s)?\b/gi, 'beug$1'],
  [/\bhotfix(es)?\b/gi, 'hotfixe$1'],
  [/\blifestyle\b/gi, 'laïfsstaïl'],
  [/\bmarketplace(s)?\b/gi, 'markètplèss$1'],
  [/\bworkflow(s)?\b/gi, 'workefloh$1'],
  [/\bframework(s)?\b/gi, 'fréïmework$1'],
  [/\bdashboard(s)?\b/gi, 'dacheboard$1'],
  [/\bfeature(s)?\b/gi, 'fîtcheur$1'],
  [/\bscoring\b/gi, 'skoring'],
  [/\bbenchmark(s)?\b/gi, 'bencmark$1'],
  [/\bscalable\b/gi, 'skélabeul'],
  [/\bpipeline(s)?\b/gi, 'païplaïne$1'],
  [/\bbrowser(s)?\b/gi, 'braouzeur$1'],
  [/\bfrontend\b/gi, 'frontènde'],
  [/\bbackend\b/gi, 'bakende'],
  [/\bwebhook(s)?\b/gi, 'ouèbhouk$1'],
  [/\bembed(ding|ded|s)?\b/gi, 'embède$1'],
  [/\binference\b/gi, 'ineuférence'],
  [/\blatency\b/gi, 'lètènssi'],
  [/\bdataset(s)?\b/gi, 'dèïtasète$1'],
  [/\brate limit(s)?\b/gi, 'rèïte limite$1'],
  [/\bsprint(s)?\b/gi, 'sprinte$1'],
  [/\bstandup(s)?\b/gi, 'standeup$1'],
  [/\bfreemium\b/gi, 'frîmiom'],
  [/\bupsell\b/gi, 'epsèl'],
  [/\bonline\b/gi, 'onlaïne'],
  [/\boffline\b/gi, 'oflaïne'],
  [/\bcloud\b/gi, 'klaoude'],
  [/\bopen source\b/gi, 'opène source'],
  [/\bshipping\b/gi, 'chipinge'],
  [/\bdeployment\b/gi, 'dèploïment'],
  [/\brelease(s)?\b/gi, 'rèlîss$1'],
  [/\brollout(s)?\b/gi, 'rollaout$1'],
  [/\btimeline(s)?\b/gi, 'taïmlaïne$1'],
  [/\bbottleneck(s)?\b/gi, 'botelnek$1'],
  [/\blandscape\b/gi, 'lanndskèpe'],
  [/\binsight(s)?\b/gi, 'insaïte$1'],
  [/\bstakeholder(s)?\b/gi, 'stèkeholder$1'],
  [/\blead(s)?\b/gi, 'lîde$1'],
  [/\bcheckout\b/gi, 'chèkaoute'],
  [/\bSaaS\b/g, 'saas'],
  [/\bOpenAI\b/g, 'Open A I'],
  [/\bAnthropic\b/g, 'Anssropic'],
  [/\bPerplexity\b/g, 'Perplexiti'],
  [/\bGemini\b/g, 'Djéminaï'],
  [/\bPostHog\b/g, 'Posstog'],
  [/\bAtlassian\b/g, 'Atlassiane'],
  [/\bHubSpot\b/g, 'Hèbspote'],
  [/\bAsana\b/g, 'Assana'],
  [/\bAirtable\b/g, 'Èrtèbeul'],
  [/\bLovable\b/g, 'Loveabeul'],
  [/\bSupabase\b/g, 'Soupabèïze'],
  [/\bZapier\b/g, 'Zapiyèr'],
  [/\bSlack\b/g, 'Slak'],
  [/\bStripe\b/g, 'Straïpe'],
  [/\bWebflow\b/g, 'Ouèbefloh'],
  [/\bVercel\b/g, 'Vèrsèl'],
  [/\bGitHub\b/g, 'Guiteub'],
  [/\bLinear\b/g, 'Linéar'],
];
