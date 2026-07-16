// Parser voor de financiële SAP-export (MIP.xlsm) — per plant (IJ of R).
//
// Los van UI/opslag (Fase 3): puur van ruwe tabblad-grids -> genormaliseerde
// data + validatie. Wordt door de upload-module geïmporteerd; de tests
// importeren dezelfde functies (ESM).
//
// Invoer per tabblad = een "raw grid": array van rijen, elke rij een array van
// celwaarden, zoals XLSX.utils.sheet_to_json(sheet, {header:1, defval:''}).
//
// Verwerkte tabbladen per plant (prefix IJ_ of R_):
//   {P}_CCTR       kostenplaats-actuals (regel-niveau, EUR)  -> entries bron 'CCTR'
//   {P}_KOB1       order-actuals (regel-niveau, EUR)         -> entries bron 'KOB1'
//   {P}_KOB2       open obligo + leverancier + factuur (EUR) -> entries bron 'KOB2'
//   {P}_Personeel  personeelskosten (EUR)                    -> entries bron 'personeel'
//   {P}_ RBM ...   projecten plan/actual/variance (k€)       -> projects
//   {P}_Maint_Costs budget/forecast vs actual (k€)           -> budget
// Alle andere tabbladen (Overzicht_*, qry*, General data) worden genegeerd.
//
// LET OP: de R-tabbladen zijn niet kolom-identiek aan de IJ-tabbladen
// (R_Maint_Costs en R_RBM staan één kolom naar links) — daarom worden
// kolomposities uit de koprij afgeleid, nooit hardcoded.

// Parser-versie: wordt per upload opgeslagen zodat elke dataset reproduceerbaar
// is en we weten met welke interpretatie de data is geparsed. Bump bij elke
// wijziging die de betekenis van de output verandert.
//   2.0.0 — rekeningnummer + categorie bevroren bij ingest; RBM = alleen OP-blok
//   2.0.1 — budgetkop jaar-agnostisch (OP 25/26/…); toNum begrijpt US-notatie
//   2.1.0 — multi-plant (IJ/R) met kolomdetectie uit de koprij; KOB2-periode
//           uit Debit date; formulestrings gestript; bedragen op 2 decimalen;
//           0-regels overgeslagen; validatie-log (kostenplaats/periode)
//   2.2.0 — RBM: alle blokken (OP/geïdentificeerd/onvoorzien/uitgesteld) met
//           blok-veld per project; General data (kostenplaats-masterdata)
//           meegeleverd als costCenters
const PARSER_VERSION = '2.2.0';

// ── Helpers ────────────────────────────────────────────────────────
function norm(s) { return (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Robuust een getal lezen: getallen komen meestal al als number binnen, maar
// we vangen ook Europese (1.234,56 / 1234,56) én Amerikaanse (1,234.56)
// tekstnotatie op. Zonder de US-tak zou "1,234.56" stil als 1 worden gelezen
// (parseFloat stopt bij de komma) — dat is datacorruptie, geen parse-fout.
function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '');
  if (s === '' || s === '-') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/,/.test(s) && !/\./.test(s)) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// Formulestrings ('=SUM(...)') zijn nooit data — een cel die als tekst met '='
// binnenkomt betekent dat Excel de formule niet heeft geëvalueerd; stil
// doorlaten zou rommel in omschrijvingen/labels opleveren.
function str(v) { const s = (v == null ? '' : String(v)).trim(); if (!s || s.startsWith('=')) return null; return s; }
function round2(x) { return x == null ? null : Math.round(x * 100) / 100; }
function kEuro(x) { return x == null ? null : Math.round(x * 1000 * 100) / 100; } // k€ -> €

// Excel-serial (dagen sinds 1900) -> {jaar, maand}, alleen als het resultaat
// plausibel is. KOB2 heeft geen periode-kolom maar wél een Debit date — daar
// leiden we de maand uit af zodat obligo per maand te tonen is.
function serialToJaarMaand(v) {
  const n = toNum(v);
  if (n == null || n < 20000 || n > 80000) return null;   // buiten ~1954-2118: geen datum
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  const jaar = d.getUTCFullYear();
  if (jaar < 2000 || jaar > 2100) return null;
  return { jaar, maand: d.getUTCMonth() + 1 };
}

function headerMap(row) {
  const m = {};
  (row || []).forEach((c, i) => { const k = norm(c); if (k && !(k in m)) m[k] = i; });
  return m;
}
function pick(map, cands) { for (const c of cands) if (c in map) return map[c]; return -1; }
function findHeaderRow(raw, cands, maxScan) {
  const n = Math.min(raw.length, maxScan || 8);
  for (let i = 0; i < n; i++) if (pick(headerMap(raw[i]), cands) >= 0) return i;
  return -1;
}

// Installatiecode afleiden uit omschrijving (bv. "KM4910: ...") of anders uit
// de functional location (bv. "NL11-50-3000-ML4900_MALI").
function extractInstallatie(description, funcLoc) {
  const d = (description == null ? '' : String(description)).trim();
  let m = d.match(/^([A-Z]{2,3}\d{3,4}[A-Z]?)/);
  if (m) return m[1];
  const f = (funcLoc == null ? '' : String(funcLoc));
  m = f.match(/([A-Z]{2}\d{4})/);
  return m ? m[1] : null;
}

// ── Line-item tabbladen (CCTR/KOB1/KOB2/Personeel) ─────────────────
const LINE_SPECS = {
  cctr:      { bron: 'CCTR',      order: ['order', 'iw38order'], type: ['type'], per: ['per', 'periode'], year: ['year', 'jaar'], cc: ['costcenter', 'costctr'], fl: ['functionallocation'], ce: ['costelementname'], acct: ['costelem', 'costelement'], amount: ['valinrepcur', 'valuerepcur'], desc: ['description'] },
  kob1:      { bron: 'KOB1',      order: ['iw38order', 'order', 'kob1ijorder'], type: ['type'], per: ['per', 'periode'], year: ['year', 'jaar'], cc: ['costcenter', 'costctr'], fl: ['functionallocation'], ce: ['costelementname'], acct: ['costelement', 'costelem'], amount: ['valinrepcur'], desc: ['description'] },
  kob2:      { bron: 'KOB2',      order: ['iw38order', 'order', 'kob2ijorder', 'kob2rorder'], type: ['type'], per: [], year: [], cc: ['costcenter', 'costctr'], fl: ['functionallocation'], ce: ['costelementname'], acct: ['costelement', 'costelem'], amount: ['open', 'valinrepcur'], desc: ['description'], vendor: ['vendor'], invoice: ['refdocumentnumber'], debit: ['debitdate'] },
  personeel: { bron: 'personeel', order: [], type: [], per: ['per', 'periode'], year: ['year', 'jaar'], cc: ['costctr', 'costcenter'], fl: [], ce: ['costelementname'], acct: ['costelem', 'costelement'], amount: ['valinrepcur'], desc: [] }
};

function parseLineItems(raw, key) {
  const spec = LINE_SPECS[key];
  if (!spec) return { error: `onbekend type ${key}` };
  const hr = findHeaderRow(raw, spec.amount, 8);
  if (hr < 0) return { error: `kolom voor bedrag (${spec.amount.join('/')}) niet gevonden` };
  const map = headerMap(raw[hr]);
  const iAmt = pick(map, spec.amount);
  const iOrder = pick(map, spec.order), iType = pick(map, spec.type), iPer = pick(map, spec.per),
        iYear = pick(map, spec.year), iCC = pick(map, spec.cc), iFL = pick(map, spec.fl),
        iCE = pick(map, spec.ce), iDesc = pick(map, spec.desc || []),
        iAcct = pick(map, spec.acct || []),
        iVendor = spec.vendor ? pick(map, spec.vendor) : -1,
        iInvoice = spec.invoice ? pick(map, spec.invoice) : -1,
        iDebit = spec.debit ? pick(map, spec.debit) : -1;

  const entries = []; let skipped = 0, negatives = 0, nulRegels = 0;
  const validatie = [];                                   // gelogd, niet verwijderd
  for (let r = hr + 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const amt = toNum(row[iAmt]);
    const orderVal = iOrder >= 0 ? String(row[iOrder] || '').trim() : '';
    const descVal = iDesc >= 0 ? String(row[iDesc] || '').trim() : '';
    if (amt == null) { if (orderVal || descVal) skipped++; continue; }
    if (/^(totaal|total|subtotal|sum)\b/i.test(descVal)) { skipped++; continue; }
    // Rijen waarvan het bedrag exact 0 is dragen niets bij en vervuilen
    // tellingen (bv. "aantal orders met kosten") — overslaan, wel tellen.
    if (amt === 0) { nulRegels++; continue; }
    if (amt < 0) negatives++;
    // KOB2 heeft geen periode-kolom; leid maand/jaar af uit de Debit date.
    let periode = iPer >= 0 ? toNum(row[iPer]) : null;
    let jaar = iYear >= 0 ? toNum(row[iYear]) : null;
    if (periode == null && iDebit >= 0) {
      const jm = serialToJaarMaand(row[iDebit]);
      if (jm) { periode = jm.maand; if (jaar == null) jaar = jm.jaar; }
    }
    const e = {
      bron: spec.bron,
      jaar,
      periode,
      order_nr: orderVal || null,
      order_type: iType >= 0 ? str(row[iType]) : null,
      kostenplaats: iCC >= 0 ? str(row[iCC]) : null,
      functional_loc: iFL >= 0 ? str(row[iFL]) : null,
      installatie: extractInstallatie(descVal, iFL >= 0 ? row[iFL] : ''),
      kostensoort: iCE >= 0 ? str(row[iCE]) : null,
      kostenrekening: iAcct >= 0 ? str(row[iAcct]) : null,
      leverancier: iVendor >= 0 ? str(row[iVendor]) : null,
      factuur_nr: iInvoice >= 0 ? str(row[iInvoice]) : null,
      bedrag_eur: round2(amt)
    };
    // Validatie (§datacleaning): elke regel hoort een kostenplaats en (waar de
    // bron die kent) een periode te hebben. Loggen, niet verwijderen — de
    // bedragen zijn echt, alleen de context is onvolledig.
    if (e.order_nr && !e.kostenplaats) validatie.push(`${spec.bron} rij ${r + 1}: order ${e.order_nr} zonder kostenplaats`);
    if (e.order_nr && e.periode == null && (iPer >= 0 || iDebit >= 0)) validatie.push(`${spec.bron} rij ${r + 1}: order ${e.order_nr} zonder periode`);
    entries.push(e);
  }
  return { entries, skipped, negatives, nulRegels, validatie, headerRow: hr };
}

// ── Maint_Costs (budget/forecast vs actual, in k€) ─────────────────
function parseMaintCosts(raw) {
  // Snapshot-maand: cel rechts van "Hier de maand invullen".
  let maand = null;
  for (const row of raw) {
    for (let i = 0; i < (row || []).length; i++) {
      if (norm(row[i]) === 'hierdemaandinvullen') { maand = toNum(row[i + 1]); break; }
    }
    if (maand != null) break;
  }
  // Jaar-agnostisch: de kop heet "OP 25", volgend jaar "OP 26" — hard op één
  // jaartal matchen zou de eerste export van een nieuw boekjaar stil breken.
  // De kolóm is óók niet vast: IJ heeft het label in kolom 1 (OP in kolom 2),
  // R in kolom 0 (OP in kolom 1) — dus beide uit de koprij afleiden.
  const hr = raw.findIndex(r => (r || []).some(c => /^op\d{2}$/.test(norm(c))));
  if (hr < 0) return { error: 'Maint_Costs: budgetkop (OP xx) niet gevonden', maand };
  const opIdx = (raw[hr] || []).findIndex(c => /^op\d{2}$/.test(norm(c)));
  const lblIdx = opIdx - 1;
  const budget = [];
  for (let r = hr + 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const label = String(row[lblIdx] || '').trim();
    if (!label) continue;
    if (norm(label) === 'actualsytd') break;               // begin van het reconciliatie-blok
    const op = toNum(row[opIdx]), fc = toNum(row[opIdx + 1]), act = toNum(row[opIdx + 2]), pl = toNum(row[opIdx + 3]);
    if (op == null && fc == null && act == null && pl == null) continue;
    const isTotal = /^total\b/i.test(label), isSub = /^subtotal\b/i.test(label);
    budget.push({
      categorie: label,
      niveau: isTotal ? 'total' : isSub ? 'subtotal' : 'line',
      op_eur: kEuro(op), fc_eur: kEuro(fc), act_ytd_eur: kEuro(act), plan_ytd_eur: kEuro(pl),
      diff_plan_eur: kEuro(toNum(row[opIdx + 4])), diff_fc_eur: kEuro(toNum(row[opIdx + 5]))
    });
    if (isTotal && /variable \+ fixed/i.test(label)) break;  // grand total bereikt
  }

  // Reconciliatie-blok "Actuals YTD": label (lblIdx), account (opIdx),
  // CCTR/KOB1/Totaal (opIdx+1..+3). Hieruit leiden we de autoritatieve set
  // "repair"-rekeningen af plus de controletotalen.
  const reconStart = raw.findIndex(r => norm((r || [])[lblIdx]) === 'actualsytd');
  const maintAccounts = [];
  let recon = null;
  if (reconStart >= 0) {
    for (let r = reconStart + 1; r < raw.length; r++) {
      const row = raw[r] || [];
      const acct = String(row[opIdx] || '').trim();
      if (/^\d{5,}$/.test(acct)) maintAccounts.push(acct);
      if (/total repair costs/i.test(String(row[lblIdx] || ''))) {
        recon = { cctr: toNum(row[opIdx + 1]), kob1: toNum(row[opIdx + 2]), total: toNum(row[opIdx + 3]) };
        break;
      }
    }
  }
  return { budget, headerRow: hr, maand, maintAccounts: [...new Set(maintAccounts)], recon };
}

// Classificeer één kostenregel definitief bij ingest, zodat de definitie van
// "onderhoud" bevroren met de data mee gaat (auditbaar, reproduceerbaar) en de
// leeslaag niet op namen hoeft te raden.
//   onderhoud = CCTR/KOB1 op een repair-rekening (Maint_Costs)
//   verbruik  = CCTR/KOB1 op een niet-repair-rekening (bv. smeermiddelen)
//   personeel / obligo    = personeel / KOB2
function classifyEntry(e, maintAccounts) {
  if (e.bron === 'personeel') return 'personeel';
  if (e.bron === 'KOB2') return 'obligo';
  if (e.bron === 'CCTR' || e.bron === 'KOB1') {
    if (maintAccounts && maintAccounts.size) {
      return maintAccounts.has(String(e.kostenrekening || '').trim()) ? 'onderhoud' : 'verbruik';
    }
    return /consum.*lubricant/i.test(e.kostensoort || '') ? 'verbruik' : 'onderhoud';
  }
  return null;
}

// ── RBM-projecten (plan/actual/variance, in k€) ────────────────────
// Kolomindeling verschilt per plant (IJ: naam in kolom 0, R: kolom 1; de
// order-kolom staat bij R twee posities anders) — dus alles uit de koprij
// afleiden. Kop = de rij met "Variance"; daarin staan ook de projectnaam-
// sectiekop ("Projects included..."), twee "Total k€"-kolommen (plan/actual)
// en "Order nr.".
//
// De tab bevat meerdere blokken; sinds 2.2.0 worden ze ALLEMAAL geparsed en
// krijgt elk project een blok-veld, zodat de leeslaag zelf kan filteren:
//   'op'         — Projects included in Operating Plan (het vastgestelde plan)
//   'identified' — Projects identified RBM (kandidaten uit de RBM-analyse)
//   'unforeseen' — Projects Unforeseen/unexpected (onvoorzien werk)
//   'postponed'  — Projects postponed RBM (uitgesteld)
// Alleen 'op' telt mee in de budget-KPI's (zie computeKpis) — de andere
// blokken zijn geen vastgesteld plan.
const RBM_BLOK_LABELS = { op: 'Operating Plan', identified: 'Geïdentificeerd', unforeseen: 'Onvoorzien', postponed: 'Uitgesteld', overig: 'Overig' };
function rbmBlokVoor(sectie) {
  const s = String(sectie || '').toLowerCase();
  if (/operating plan/.test(s)) return 'op';
  if (/identified/.test(s)) return 'identified';
  if (/unforeseen|unexpected/.test(s)) return 'unforeseen';
  if (/postponed/.test(s)) return 'postponed';
  return 'overig';
}
function parseRbm(raw) {
  const hr = raw.findIndex(r => (r || []).some(c => norm(c) === 'variance'));
  if (hr < 0) return { error: 'RBM: kop (Variance) niet gevonden' };
  const head = raw[hr] || [];
  const nameIdx = Math.max(0, head.findIndex(c => /^projects\b/i.test(String(c || '').trim())));
  const totals = head.map((c, i) => (norm(c) === 'totalk' ? i : -1)).filter(i => i >= 0);
  const planIdx = totals.length > 0 ? totals[0] : nameIdx + 4;
  const actIdx = totals.length > 1 ? totals[1] : nameIdx + 8;
  const varIdx = head.findIndex(c => norm(c) === 'variance');
  const orderIdx = head.findIndex(c => norm(c) === 'ordernr');
  const projects = []; let skipped = 0;
  // De koprij zelf is de sectiekop van het eerste blok ("Projects included
  // in Operating Plan ...").
  let blok = rbmBlokVoor(head[nameIdx]);
  for (let r = hr + 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const naam = String(row[nameIdx] || '').trim();
    if (/^projects\b/i.test(naam)) { blok = rbmBlokVoor(naam); continue; }  // volgende sectie
    if (!naam) { skipped++; continue; }
    if (/^(totaal|total)\b/i.test(naam)) continue;
    const plan = toNum(row[planIdx]), act = toNum(row[actIdx]), varc = toNum(row[varIdx]);
    if (plan == null && act == null) { skipped++; continue; }
    projects.push({
      naam,
      blok,
      order_nr: orderIdx >= 0 ? (String(row[orderIdx] || '').trim() || null) : null,
      plan_eur: kEuro(plan), actual_eur: kEuro(act), variance_eur: kEuro(varc)
    });
  }
  return { projects, skipped, headerRow: hr };
}

// ── General data (kostenplaats-masterdata, plant-onafhankelijk) ────
// Kolommen: Id, Naam, Type, Plant. Levert een mapping kostenplaats-id ->
// {naam, type}, zodat de UI leesbare namen kan tonen i.p.v. kale nummers.
function parseGeneralData(raw) {
  const hr = findHeaderRow(raw, ['id'], 4);
  if (hr < 0) return { costCenters: {} };
  const map = headerMap(raw[hr]);
  const iId = pick(map, ['id']), iNaam = pick(map, ['naam', 'name']), iType = pick(map, ['type']);
  if (iId < 0 || iNaam < 0) return { costCenters: {} };
  const costCenters = {};
  for (let r = hr + 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const id = String(row[iId] || '').trim();
    const naam = str(row[iNaam]);
    if (!/^\d{6,}$/.test(id) || !naam) continue;
    costCenters[id] = { naam, type: iType >= 0 ? str(row[iType]) : null };
  }
  return { costCenters };
}

// ── Tabblad-detectie ───────────────────────────────────────────────
// plant = 'IJ' of 'R'. IJ's RBM-tab heet "IJ_ RBM projects ..." (met spatie),
// R's "R_RBM projects ..." — vandaar de optionele spatie in de regex.
function detectSheet(name, plant) {
  const p = plant || 'IJ';
  if (new RegExp(`^${p}_CCTR$`, 'i').test(name)) return 'cctr';
  if (new RegExp(`^${p}_KOB1$`, 'i').test(name)) return 'kob1';
  if (new RegExp(`^${p}_KOB2$`, 'i').test(name)) return 'kob2';
  if (new RegExp(`^${p}_Personeel$`, 'i').test(name)) return 'personeel';
  if (new RegExp(`^${p}_\\s*RBM`, 'i').test(name)) return 'rbm';
  if (new RegExp(`^${p}_Maint_Costs$`, 'i').test(name)) return 'maintcosts';
  return null;
}

// Welke plants zitten er (herkenbaar) in dit werkboek?
function detectPlants(sheetsByName) {
  const plants = [];
  for (const p of ['IJ', 'R']) {
    if (Object.keys(sheetsByName || {}).some(n => detectSheet(n, p))) plants.push(p);
  }
  return plants;
}

function mode(arr) {
  const c = {}; let best = null, bestN = -1;
  for (const v of arr) { c[v] = (c[v] || 0) + 1; if (c[v] > bestN) { bestN = c[v]; best = v; } }
  return best;
}

// ── Hoofdingang ────────────────────────────────────────────────────
// sheetsByName: { 'IJ_CCTR': raw, 'R_CCTR': raw, ... }
// opts.plant: 'IJ' (default) of 'R' — parse alleen de tabbladen van die plant.
function parseFinanceWorkbook(sheetsByName, opts) {
  const plant = (opts && opts.plant) || 'IJ';
  const result = { plant, jaar: null, snapshotMaand: null, entries: [], projects: [], budget: [], costCenters: {}, summary: { bronnen: {} }, warnings: [], errors: [], validatie: [] };
  const seen = [];
  for (const [name, raw] of Object.entries(sheetsByName || {})) {
    // General data is plant-onafhankelijke masterdata (kostenplaats-namen).
    if (/^general\s*data$/i.test(String(name).trim())) {
      try { result.costCenters = parseGeneralData(raw).costCenters; } catch (e) { result.warnings.push(`General data: ${e.message}`); }
      continue;
    }
    const key = detectSheet(name, plant);
    if (!key) continue;
    seen.push(name);
    try {
      if (key === 'rbm') {
        const { projects, error, skipped } = parseRbm(raw);
        if (error) result.errors.push(`${name}: ${error}`);
        else { result.projects = projects; result.summary.bronnen.RBM = { count: projects.length, overgeslagen: skipped }; }
      } else if (key === 'maintcosts') {
        const { budget, error, maand, maintAccounts, recon } = parseMaintCosts(raw);
        if (maand != null) result.snapshotMaand = maand;
        if (maintAccounts && maintAccounts.length) result._maintAccounts = new Set(maintAccounts);
        if (recon) result.recon = recon;
        if (error) result.errors.push(`${name}: ${error}`);
        else {
          result.budget.push(...budget);
          const prev = result.summary.bronnen.Maint_Costs || { count: 0 };
          result.summary.bronnen.Maint_Costs = { count: prev.count + budget.length };
        }
      } else {
        const { entries, error, skipped, negatives, nulRegels, validatie } = parseLineItems(raw, key);
        if (error) { result.errors.push(`${name}: ${error}`); continue; }
        result.entries.push(...entries);
        if (validatie && validatie.length) result.validatie.push(...validatie);
        const bron = LINE_SPECS[key].bron;
        // Alleen parse-diagnostiek; bedragen worden altijd live uit de regels
        // opgeteld (bronTotals), zodat er geen tweede, mogelijk verouderd
        // totaal ontstaat.
        const prev = result.summary.bronnen[bron] || { count: 0, overgeslagen: 0, negatief: 0, nul: 0 };
        result.summary.bronnen[bron] = {
          count: prev.count + entries.length,
          overgeslagen: prev.overgeslagen + skipped,
          negatief: prev.negatief + negatives,
          nul: prev.nul + (nulRegels || 0)
        };
      }
    } catch (e) {
      result.errors.push(`${name}: ${e.message}`);
    }
  }

  // Classificeer elke regel één keer bij ingest en bevries de definitie mee
  // met de data (auditbaar). De leeslaag leest daarna alleen nog `categorie`.
  const maintAccounts = result._maintAccounts || null;
  for (const e of result.entries) e.categorie = classifyEntry(e, maintAccounts);
  delete result._maintAccounts;

  // Parse-tijd invariant: de onderhoud-som uit de regels moet aansluiten op het
  // Maint_Costs "repair costs"-totaal. Wijkt het af (bv. door een gewijzigd
  // Excel-formaat), dan een luide waarschuwing i.p.v. stil-verkeerd.
  if (result.recon && result.recon.total != null) {
    const onderhoud = result.entries.filter(e => e.categorie === 'onderhoud').reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
    const diff = onderhoud - result.recon.total;
    if (Math.abs(diff) > Math.max(1, Math.abs(result.recon.total) * 0.005)) {
      result.warnings.push(`Reconciliatie wijkt af: onderhoud uit de regels (€${Math.round(onderhoud).toLocaleString('nl-NL')}) verschilt €${Math.round(diff).toLocaleString('nl-NL')} van het Maint_Costs repair-total (€${Math.round(result.recon.total).toLocaleString('nl-NL')}). Controleer of de rekening-indeling of het Excel-formaat is gewijzigd.`);
    }
  }

  const years = result.entries.map(e => e.jaar).filter(Boolean);
  if (years.length) result.jaar = mode(years);
  if (!seen.length) result.errors.push(`Geen herkende ${plant}-tabbladen gevonden. Is dit de juiste MIP-export?`);
  else if (!result.entries.length) result.warnings.push('Geen kostenregels geparsed uit de line-item tabbladen.');

  result.parserVersion = PARSER_VERSION;
  return result;
}

export {
  parseFinanceWorkbook, parseLineItems, parseMaintCosts, parseRbm, parseGeneralData,
  classifyEntry, detectSheet, detectPlants, extractInstallatie, toNum, norm,
  PARSER_VERSION, RBM_BLOK_LABELS
};
