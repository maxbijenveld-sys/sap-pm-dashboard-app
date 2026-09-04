// PX Trend — generieke data-engine (parser -> normalisatie -> datakwaliteit ->
// baseline -> afwijking -> trend -> InstallationHealth-aggregatie).
//
// Kernprincipe: geen enkele functie hier kent een installatie- of tagnaam.
// Alles wordt afgeleid uit de data zelf. Vervangt de installatiespecifieke
// analyseEL2310()/analyseBU4930() in js/pxtrend-conditie.js — die blijven nu
// alleen bestaan als dunne wrapper rond deze motor (zie migratie).
//
// Bruikbaar in browser (window.PxEngine) én Node (module.exports) — zelfde
// dual-export patroon als js/risk.js, zodat dit met `node test/...` te
// testen is zonder een browser.

// ── 1. Generieke CSV-parser ──────────────────────────────────────────────
// Verwacht: "date;TAG1;TAG2;...\n2017-06-14 15:00:00;0,12;;...". Formaat is
// afgeleid uit de echte PxTrend-exports (zie docs/sql/... nvt — dit zijn
// geen SQL-bestanden maar CSV's rechtstreeks uit PxTrend's "Reports").
// Comma-decimaal, semicolon-gescheiden, lege cel = geen meting.
function parsePxCsv(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return { tags: [], rows: [] };
  const header = lines[0].split(';');
  const tags = header.slice(1).map(t => t.trim()).filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const parts = line.split(';');
    const timestamp = parts[0];
    if (!timestamp) continue;
    const values = {};
    for (let c = 0; c < tags.length; c++) {
      const raw = parts[c + 1];
      values[tags[c]] = toNum(raw);
    }
    rows.push({ timestamp, values });
  }
  return { tags, rows };
}

function toNum(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ── 2. Installatie-identificatie afleiden uit een tagnaam ───────────────
// Geen lijst, geen mapping-bestand: elke PxTrend-tag begint met de
// equipmentcode (letters+cijfers, evt. 1 letter-suffix) gevolgd door een
// scheidingsteken. Zelfde patroon dat al is gevalideerd tegen alle 29
// exports (30 herkende equipmentcodes, 0 mismatches met de catalogus op
// 1 na — RP312030, terecht als onbekend gemeld, zie testcase-rapport).
function installationOfTag(tag) {
  const m = /^([A-Z]+[0-9]+[A-Z]?)/.exec(tag);
  return m ? m[1] : tag;
}

// ── 3. Normalisatie: CSV -> platte metingen {installationId, tag,
// timestamp, value, source} ───────────────────────────────────────────
function normalizeMeasurements(parsed, source) {
  const out = [];
  parsed.rows.forEach(row => {
    parsed.tags.forEach(tag => {
      const value = row.values[tag];
      if (value === null) return; // ontbrekende waarde: geen meting, geen "0"
      out.push({ installationId: installationOfTag(tag), tag, timestamp: row.timestamp, value, source });
    });
  });
  return out;
}

// ── 4. Tag-index bouwen + dedupliceren ───────────────────────────────────
// Uniekheid: installationId+tag+timestamp+source (§18). Bij een dubbele
// combinatie wint de laatst aangeboden meting (nieuwere export overschrijft
// oudere), zodat opnieuw aangeleverde CSV's de analyse niet vervuilen.
function buildTagIndex(measurements) {
  const index = {}; // installationId -> tag -> Map(timestamp -> value)
  measurements.forEach(m => {
    index[m.installationId] = index[m.installationId] || {};
    index[m.installationId][m.tag] = index[m.installationId][m.tag] || new Map();
    index[m.installationId][m.tag].set(m.timestamp, m.value);
  });
  const result = {};
  Object.keys(index).forEach(inst => {
    result[inst] = {};
    Object.keys(index[inst]).forEach(tag => {
      const points = Array.from(index[inst][tag], ([timestamp, value]) => ({ timestamp, value }));
      points.sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
      result[inst][tag] = points;
    });
  });
  return result;
}

// ── 5. Datakwaliteit per tagreeks ────────────────────────────────────────
// "Slechte data ≠ installatieprobleem" (§9): dit levert een APARTE
// dimensie op, nooit direct een severity.
const MIN_POINTS_FOR_ANALYSIS = 200; // te weinig punten -> geen betrouwbare baseline
function assessDataQuality(points, opts) {
  opts = opts || {};
  const n = points.length;
  if (n === 0) return { status: 'INSUFFICIENT', n: 0, reasons: ['geen metingen'] };
  const reasons = [];

  const seen = new Set();
  let duplicates = 0;
  points.forEach(p => { if (seen.has(p.timestamp)) duplicates++; seen.add(p.timestamp); });
  if (duplicates > 0) reasons.push(`${duplicates} dubbele timestamps`);

  const distinct = new Set(points.map(p => p.value));
  const isConstant = distinct.size <= 1;
  if (isConstant) reasons.push('constante waarde (waarschijnlijk setpoint, geen meting)');

  // Corruptie-detectie (géén statistische-afwijking-detectie — dat is iets
  // heel anders en juist waar de rest van de engine voor bestaat). Een
  // corrupte waarde is er een die vele ordes van grootte groter is dan de
  // rest van de reeks, ongeacht wanneer hij voorkomt — bv. BK3610_XI1 uit
  // de echte export (waarden tot 477 biljard tussen normale 0-5 trilling).
  // Een echte, sustained afwijking (bv. 4x de baseline) blijft hierdoor
  // gewoon zichtbaar voor de deviation-engine; alleen fysiek onmogelijke
  // uitschieters worden genegeerd. Mediaan i.p.v. gemiddelde: robuust
  // tegen de corrupte waarden zelf (zolang <50% van de reeks).
  const absVals = points.map(p => Math.abs(p.value)).filter(v => v > 0).sort((a, b) => a - b);
  const medAbs = absVals.length ? percentile(absVals, 0.5) : 0;
  const corruptThreshold = Math.max(medAbs * 1e6, 1e9);
  const outliers = points.filter(p => Math.abs(p.value) > corruptThreshold).length;
  if (outliers > 0) reasons.push(`${outliers} fysiek onmogelijke waarde(n) (>${corruptThreshold.toExponential(1)}) — vermoedelijke export-/sensorfout`);

  if (n < MIN_POINTS_FOR_ANALYSIS) reasons.push(`te weinig datapunten (${n} < ${MIN_POINTS_FOR_ANALYSIS})`);

  const expectedFromRange = opts.expectedCount || null;
  const pctFilled = expectedFromRange ? (n / expectedFromRange * 100) : null;
  if (pctFilled !== null && pctFilled < 10) reasons.push(`slechts ${pctFilled.toFixed(1)}% van de verwachte periode gevuld`);

  let status = 'GOOD';
  if (n < MIN_POINTS_FOR_ANALYSIS || (pctFilled !== null && pctFilled < 10)) status = 'INSUFFICIENT';
  else if (isConstant) status = 'WARNING'; // niet POOR: een setpoint is geen "slechte" data, alleen niet bruikbaar voor afwijkingsanalyse
  else if (outliers > 0 || duplicates > 0) status = 'POOR';

  return { status, n, duplicates, outliers, isConstant, pctFilled, reasons, corruptThreshold };
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return NaN;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// Corrupte (fysiek onmogelijke) waarden uitfilteren vóór de rekenkundige
// stappen — data blijft bewaard (voor weergave/audit), alleen de
// STATISTIEK negeert ze. Filtert NIET op statistische afwijking: een echte
// sustained afwijking moet juist zichtbaar blijven voor de deviation-engine.
function isCorrupt(value, quality) {
  return quality && quality.corruptThreshold != null && Math.abs(value) > quality.corruptThreshold;
}

// ── 6. Baseline-statistiek (generiek, per tag) ───────────────────────────
function computeBaselineStats(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, median: null, sd: null, min: null, max: null, p10: null, p90: null };
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n) || 0.000001;
  return {
    n, mean, sd,
    median: percentile(sorted, 0.5),
    min: sorted[0], max: sorted[n - 1],
    p10: percentile(sorted, 0.10), p90: percentile(sorted, 0.90)
  };
}

// ── 7. Afwijking t.o.v. baseline (z-score) ───────────────────────────────
// Zelfde drempels als de bestaande classifyZ() in pxtrend-conditie.js —
// hier generiek, niet aan één installatie gebonden.
function classifyDeviation(absZ) {
  if (absZ >= 3) return 'actie';
  if (absZ >= 2) return 'onderzoeken';
  if (absZ >= 1) return 'monitoren';
  return 'normaal';
}

// ── 8. Trend: korte- vs. langere-termijnvenster ──────────────────────────
// "Nog binnen de bandbreedte, maar wel verslechterend" (§8). Vergelijkt het
// laatste venster (bv. 7 dagen) met het venster daarvóór (bv. de 7-23
// dagen ervoor) t.o.v. de eigen sd, zodat de uitkomst schaalt met de
// natuurlijke spreiding van de tag (geen vaste "10 eenheden"-grens).
function computeTrend(points, opts) {
  opts = opts || {};
  const shortDays = opts.shortDays || 7;
  const priorDays = opts.priorDays || 23;
  if (!points.length) return { direction: 'onbekend', worsening: false };
  const lastTs = points[points.length - 1].timestamp;
  const lastMs = Date.parse(lastTs.replace(' ', 'T') + 'Z');
  const shortFrom = lastMs - shortDays * 86400000;
  const priorFrom = shortFrom - priorDays * 86400000;
  const toMs = t => Date.parse(t.replace(' ', 'T') + 'Z');
  const shortVals = points.filter(p => toMs(p.timestamp) >= shortFrom).map(p => p.value);
  const priorVals = points.filter(p => toMs(p.timestamp) >= priorFrom && toMs(p.timestamp) < shortFrom).map(p => p.value);
  if (shortVals.length < 5 || priorVals.length < 5) return { direction: 'onbekend', worsening: false, reden: 'onvoldoende datapunten in beide vensters' };
  const shortMean = shortVals.reduce((a, b) => a + b, 0) / shortVals.length;
  const priorMean = priorVals.reduce((a, b) => a + b, 0) / priorVals.length;
  const sd = computeBaselineStats(priorVals).sd || 0.000001;
  const deltaSd = (shortMean - priorMean) / sd;
  const direction = Math.abs(deltaSd) < 0.3 ? 'stabiel' : (deltaSd > 0 ? 'stijgend' : 'dalend');
  return { direction, shortMean, priorMean, deltaSd, worsening: Math.abs(deltaSd) >= 0.5 };
}

// ── 9. Per-tag health: combineert kwaliteit + afwijking + trend ─────────
function evaluateTagHealth(points, opts) {
  opts = opts || {};
  const quality = assessDataQuality(points, opts);
  if (quality.status === 'INSUFFICIENT') {
    return { tag: opts.tag || null, quality, status: 'onvoldoende', reden: 'Onvoldoende betrouwbare data voor een oordeel: ' + quality.reasons.join('; ') + '.' };
  }
  if (quality.isConstant) {
    return { tag: opts.tag || null, quality, status: 'onvoldoende', reden: 'Vaste waarde (setpoint), geen meting om te beoordelen.' };
  }
  const cutoffDays = opts.baselineExcludeDays || 30;
  const lastMs = Date.parse(points[points.length - 1].timestamp.replace(' ', 'T') + 'Z');
  const cutoffMs = lastMs - cutoffDays * 86400000;
  const toMs = t => Date.parse(t.replace(' ', 'T') + 'Z');
  const baselinePoints = points.filter(p => toMs(p.timestamp) < cutoffMs && !isCorrupt(p.value, quality));
  const recentPoints = points.filter(p => toMs(p.timestamp) >= cutoffMs && !isCorrupt(p.value, quality));
  const baseline = computeBaselineStats(baselinePoints.map(p => p.value));
  const recentVals = recentPoints.map(p => p.value);
  const recentMean = recentVals.length ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length : null;
  const z = (baseline.n > 20 && recentVals.length > 5 && baseline.sd) ? (recentMean - baseline.mean) / baseline.sd : 0;
  const status = (baseline.n > 20 && recentVals.length > 5) ? classifyDeviation(Math.abs(z)) : 'onvoldoende';
  const trend = computeTrend(points, opts);
  const reden = status === 'onvoldoende'
    ? 'Onvoldoende historie vóór de laatste ' + cutoffDays + ' dagen voor een betrouwbare baseline.'
    : (status === 'normaal'
      ? 'Laatste ' + cutoffDays + ' dagen binnen de eigen historische bandbreedte.'
      : `Laatste ${cutoffDays} dagen wijkt ${z >= 0 ? '+' : ''}${z.toFixed(1)} SD af van de eigen historie.`);
  return { tag: opts.tag || null, quality, baseline, recentMean, z, status, trend, reden };
}

// ── 10-11. InstallationHealth-aggregatie (transparant, geen "1 tag = rood") ─
const SEVERITY_ORDER = ['actie', 'onderzoeken', 'monitoren', 'normaal', 'onvoldoende'];
const SEVERITY_WEIGHT = { actie: 4, onderzoeken: 2, monitoren: 1, normaal: 0, onvoldoende: 0 };
function aggregateInstallationHealth(installationId, tagHealthList) {
  const bruikbaar = tagHealthList.filter(t => t.status !== 'onvoldoende');
  if (!bruikbaar.length) {
    return {
      installationId, status: 'onvoldoende',
      statusReden: tagHealthList.length ? 'Geen van de ' + tagHealthList.length + ' tags heeft genoeg bruikbare data voor een oordeel.' : 'Geen PX Trend-tags gekoppeld aan deze installatie.',
      tagsTotal: tagHealthList.length, tagsBruikbaar: 0, tagsAfwijkend: 0, prioriteit: 0, topTags: []
    };
  }
  // Gewogen aggregatie: de ernstigste tag bepaalt de status, maar het
  // AANTAL afwijkende tags en of ze verslechteren telt mee in de prioriteit
  // — zodat 1 mild afwijkende tag niet hetzelfde gewicht krijgt als 3
  // gelijktijdig afwijkende tags op dezelfde installatie.
  const sorted = bruikbaar.slice().sort((a, b) => SEVERITY_ORDER.indexOf(a.status) - SEVERITY_ORDER.indexOf(b.status) || Math.abs(b.z) - Math.abs(a.z));
  const worst = sorted[0];
  const afwijkend = bruikbaar.filter(t => t.status !== 'normaal');
  const verergerend = afwijkend.filter(t => t.trend && t.trend.worsening).length;
  const basisScore = SEVERITY_WEIGHT[worst.status] || 0;
  const aantalFactor = 1 + Math.min(1, (afwijkend.length - 1) * 0.25);
  const trendFactor = verergerend > 0 ? 0.5 : 0;
  const prioriteit = +(basisScore * aantalFactor * (1 + trendFactor)).toFixed(2);

  const topTags = sorted.filter(t => t.status !== 'normaal').slice(0, 5).map(t => ({
    tag: t.tag, status: t.status, reden: t.reden, trend: t.trend ? t.trend.direction : 'onbekend'
  }));

  let statusReden;
  if (worst.status === 'normaal') {
    statusReden = `Alle ${bruikbaar.length} bruikbare tags binnen de eigen historische bandbreedte.`;
  } else {
    statusReden = `${afwijkend.length} van ${bruikbaar.length} bruikbare tags wijken af, vooral ${worst.tag} (${worst.reden})` + (verergerend ? ` — ${verergerend} daarvan verslechterend.` : '.');
  }

  return {
    installationId, status: worst.status, statusReden,
    tagsTotal: tagHealthList.length, tagsBruikbaar: bruikbaar.length, tagsAfwijkend: afwijkend.length,
    tagsVerergerend: verergerend, prioriteit, topTags
  };
}

// ── 12. Ranking ───────────────────────────────────────────────────────────
function rankInstallations(installationHealthList) {
  return installationHealthList.slice().sort((a, b) => b.prioriteit - a.prioriteit);
}

// ── Volledige pipeline voor één folder CSV's (Node-kant, ingestion) ──────
// Geen installatie-/tagnamen hardcoded: alles komt uit parsePxCsv +
// installationOfTag. `catalogLookup(id)` is optioneel (bv. de SAP-catalogus)
// puur om te MELDEN of een gevonden installatie daarin bekend is — geen
// vereiste voor de pipeline om te werken.
function runPipeline(csvTexts, opts) {
  opts = opts || {};
  const allMeasurements = [];
  const fileReports = [];
  csvTexts.forEach(({ name, text }) => {
    try {
      const parsed = parsePxCsv(text);
      const measurements = normalizeMeasurements(parsed, name);
      // Geen allMeasurements.push(...measurements): bij grote CSV's (tot
      // ~1,3 miljoen metingen per bestand) overschrijdt spread-als-argumenten
      // de call stack. Losse pushes zijn amortized O(1), geen limiet.
      for (let i = 0; i < measurements.length; i++) allMeasurements.push(measurements[i]);
      fileReports.push({ file: name, status: 'OK', tags: parsed.tags.length, rows: parsed.rows.length });
    } catch (err) {
      fileReports.push({ file: name, status: 'ERROR', error: err.message });
    }
  });

  const index = buildTagIndex(allMeasurements);
  const installations = {};
  Object.keys(index).forEach(instId => {
    const tagHealths = Object.keys(index[instId]).map(tag => evaluateTagHealth(index[instId][tag], { tag, baselineExcludeDays: opts.baselineExcludeDays }));
    installations[instId] = {
      health: aggregateInstallationHealth(instId, tagHealths),
      tagHealths,
      knownInCatalog: opts.catalogLookup ? !!opts.catalogLookup(instId) : null
    };
  });

  return { fileReports, installations, measurementCount: allMeasurements.length };
}

if (typeof window !== 'undefined') {
  window.PxEngine = {
    parsePxCsv, installationOfTag, normalizeMeasurements, buildTagIndex,
    assessDataQuality, computeBaselineStats, classifyDeviation, computeTrend,
    evaluateTagHealth, aggregateInstallationHealth, rankInstallations, runPipeline,
    SEVERITY_ORDER, SEVERITY_WEIGHT
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parsePxCsv, installationOfTag, normalizeMeasurements, buildTagIndex,
    assessDataQuality, computeBaselineStats, classifyDeviation, computeTrend,
    evaluateTagHealth, aggregateInstallationHealth, rankInstallations, runPipeline,
    SEVERITY_ORDER, SEVERITY_WEIGHT
  };
}
