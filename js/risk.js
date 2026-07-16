// Risicoscore voor openstaande werkorders — puur en gedeeld, zelfde patroon
// als parser.js: in de browser een klassiek <script> (globals), in Node
// (tests) via module.exports. Geen DOM, geen fetch.
//
// De score is bewust regelgebaseerd en uitlegbaar (geen black box): elke
// factor heeft een naam en een puntenaantal, de score is letterlijk de som
// en de UI kan die factoren tonen. Maximaal haalbaar: 92 punten
// (36 + 24 + 12 + 12 + 8 — alle factoren op hun cap).
//
// Invoer: alle vermeldingen van één ordernummer, chronologisch gesorteerd
// (zelfde vorm als groupRowsByOrder() in legacy-app.js oplevert: rijen met
// status/type/_week). Optionele context: een Set met codes van
// probleem-installaties (de top uit de analysepagina).

const RISK_LEVELS = [
  { min: 60, level: 'hoog',     kleur: '#da3633' },
  { min: 30, level: 'verhoogd', kleur: '#d29922' },
  { min: 0,  level: 'laag',     kleur: '#8b949e' },
];

// Zelfde extractie als de analysepagina (extractInstallatieCode in
// legacy-app.js) — hier gedupliceerd omdat risk.js ook in Node moet draaien
// waar legacy-app.js (DOM-afhankelijk) niet laadbaar is. Bewust identiek
// gehouden; wijzigt het patroon daar, dan hier ook.
function riskInstallatieCode(omschrijving) {
  const m = (omschrijving || '').match(/^([A-Z]{2,3}\d{3,5}[A-Z]?):/);
  return m ? m[1] : null;
}

// entries: chronologische vermeldingen van één WO. probleemInstallaties:
// optionele Set met installatiecodes die structureel problemen geven.
// Retour: null als de WO is afgerond (laatste status 'ja'), anders
// { score, level, kleur, factors: [{label, punten}] }.
function computeRisk(entries, probleemInstallaties) {
  if (!entries || !entries.length) return null;
  const last = entries[entries.length - 1];
  if (last.status === 'ja') return null;
  const first = entries[0];
  const factors = [];

  // 1 — Hoe lang staat hij al open (kalenderweken tussen eerste en laatste
  // vermelding). Langer open = structureler probleem.
  const wkOpen = Math.max(1, (last._week - first._week) + 1);
  factors.push({ label: `${wkOpen} ${wkOpen === 1 ? 'week' : 'weken'} open`, punten: Math.min(36, wkOpen * 12) });

  // 2 — Herhaald ingepland zonder afronding: elke extra vermelding met een
  // niet-afgeronde status telt mee (de planning "draait" op deze WO).
  const openHits = entries.filter(e => e.status !== 'ja').length;
  if (openHits > 1) {
    factors.push({ label: `${openHits}× niet afgerond ingepland`, punten: Math.min(24, (openHits - 1) * 8) });
  }

  // 3 — Laatste status: 'nee' weegt zwaarder dan 'deels'/'uc' (daar is het
  // werk tenminste gestart).
  if (last.status === 'nee') factors.push({ label: 'laatste status: niet uitgevoerd', punten: 12 });
  else factors.push({ label: 'laatste status: deels / under construction', punten: 6 });

  // 4 — Ongepland werk (storing/spoed) dat blijft liggen is risicovoller dan
  // uitgesteld regulier onderhoud.
  if (last.type === 'ongepland') factors.push({ label: 'ongepland werk (storing/spoed)', punten: 12 });

  // 5 — Op een installatie die al vaker problemen geeft.
  const code = riskInstallatieCode(last.omschrijving);
  if (code && probleemInstallaties && probleemInstallaties.has(code)) {
    factors.push({ label: `probleem-installatie ${code}`, punten: 8 });
  }

  const score = factors.reduce((a, f) => a + f.punten, 0);
  const bucket = RISK_LEVELS.find(b => score >= b.min);
  return { score, level: bucket.level, kleur: bucket.kleur, factors };
}

// Referentie-check: hetzelfde ordernummer hoort dezelfde klus te blijven
// over de weken heen — de backlog en de risicoscore vertrouwen daarop bij
// het tellen van "weken open" en "aantal keer ingepland". Een wisselende
// omschrijving bij hetzelfde ordernummer is een sterk signaal dat het
// nummer is hergebruikt of verkeerd getypt in de bron-Excel (twee losse
// klussen onder één nummer) — zonder deze check zou de aging/risicoscore
// stilzwijgend liegen (precies het gemelde geval: order toonde "sinds W25"
// terwijl die week een heel andere klus onder hetzelfde nummer bleek).
//
// Voorrang aan de installatiecode (het "CODE:"-voorvoegsel, zie
// riskInstallatieCode) als anker — stabieler dan de vrije tekst erna, en
// dezelfde extractie die de Analyse-pagina al gebruikt. Zonder code op
// beide entries valt hij terug op de volledige, genormaliseerde
// omschrijving.
function orderEntrySignature(entry) {
  const code = riskInstallatieCode(entry.omschrijving);
  if (code) return code;
  return (entry.omschrijving || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// entries: chronologische vermeldingen van één ordernummer (zelfde vorm
// als computeRisk verwacht). Retour: null als consistent, anders de eerste
// gevonden afwijkende twee vermeldingen (week + omschrijving van elk).
function findOrderReferenceMismatch(entries) {
  if (!entries || entries.length < 2) return null;
  const first = entries[0];
  const firstSig = orderEntrySignature(first);
  for (let i = 1; i < entries.length; i++) {
    const sig = orderEntrySignature(entries[i]);
    if (sig !== firstSig) {
      return {
        a: { week: first._week, omschrijving: first.omschrijving },
        b: { week: entries[i]._week, omschrijving: entries[i].omschrijving },
      };
    }
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeRisk, riskInstallatieCode, RISK_LEVELS, findOrderReferenceMismatch };
}
