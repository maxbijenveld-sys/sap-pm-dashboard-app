// Gedeelde, pure helpers voor de financiënmodule (geen DOM/DB).
// Door dashboard én grafieken gebruikt, zodat de reken-logica één bron heeft
// en los te testen is.

export const MAAND = ['', 'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const ACTUAL_BRON = ['CCTR', 'KOB1'];

// Kostensoorten die in SAP wél op onderhouds-kostenplaatsen/orders (CCTR/KOB1)
// staan, maar in het officiële Maint_Costs "repair costs"-totaal buiten
// onderhoud vallen (verbruik). Zo sluit onderhoud-actueel exact aan op Excel
// (Act YTD). Match op kostensoort-naam, want het rekeningnummer (620103000)
// wordt niet los opgeslagen.
export const CONSUMABLE_KOSTENSOORT = ['consum. - lubricants'];
export function isConsumable(e) {
  return CONSUMABLE_KOSTENSOORT.includes(String(e.kostensoort || '').trim().toLowerCase());
}
// Werkelijke onderhoudskosten (repair): CCTR+KOB1 minus verbruik.
//
// Nieuwe uploads dragen een bevroren `categorie` (bij ingest bepaald a.d.h.v.
// het rekeningnummer + het Maint_Costs-blok); die is leidend. Voor oudere
// uploads zonder categorie vallen we terug op de naam-gebaseerde detectie.
export function isOnderhoudActual(e) {
  if (e && e.categorie) return e.categorie === 'onderhoud';
  return ACTUAL_BRON.includes(e.bron) && !isConsumable(e);
}
// Verbruik (smeermiddelen) dat op CCTR/KOB1 staat maar buiten onderhoud valt.
export function isConsumableActual(e) {
  if (e && e.categorie) return e.categorie === 'verbruik';
  return ACTUAL_BRON.includes(e.bron) && isConsumable(e);
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export function fmt(n) { return (n == null || isNaN(n)) ? '—' : eur.format(n); }
export function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function applyFilters(entries, f) {
  f = f || {};
  return entries.filter(e =>
    (!f.maand || String(e.periode) === String(f.maand)) &&
    (!f.installatie || e.installatie === f.installatie) &&
    (!f.kostensoort || e.kostensoort === f.kostensoort) &&
    (!f.leverancier || e.leverancier === f.leverancier) &&
    (!f.bron || e.bron === f.bron)
  );
}

// Bedragen + aantal per bron, altijd uit de regels zelf. Eén bron van waarheid:
// nergens een apart bijgehouden totaal dat kan verouderen.
export function bronTotals(entries) {
  const m = {};
  for (const e of (entries || [])) {
    const b = e.bron || '—';
    (m[b] = m[b] || { count: 0, totaal: 0 });
    m[b].count++;
    m[b].totaal += Number(e.bedrag_eur) || 0;
  }
  return m;
}

export function groupSum(entries, key) {
  const m = {};
  for (const e of entries) {
    const k = e[key] || '—';
    m[k] = (m[k] || 0) + (Number(e.bedrag_eur) || 0);
  }
  return Object.entries(m).map(([k, v]) => ({ key: k, bedrag: v })).sort((a, b) => b.bedrag - a.bedrag);
}

export function uniqueVals(entries, field) {
  const s = new Set();
  for (const e of entries) if (e[field] != null && e[field] !== '') s.add(e[field]);
  return [...s].sort((a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true }));
}

// De ene budgetrij die het hele jaar samenvat ("Total variable + fixed
// costs") — gebruikt door KPI's, inzichten, bronnen-overzicht, de
// upload-preview én de periodevergelijking. Eén plek voor deze
// regex+find i.p.v. hetzelfde patroon op vier plekken herhaald.
export function grandTotalBudget(budget) {
  return (budget || []).find(b => b.niveau === 'total' && /variable \+ fixed/i.test(b.categorie)) || {};
}

export function computeKpis(entries, budget, projects) {
  const sumBron = brons => entries.filter(e => brons.includes(e.bron)).reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
  const sumWhere = pred => entries.filter(pred).reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
  const distinct = (field, brons) => {
    const s = new Set();
    for (const e of entries) { if ((!brons || brons.includes(e.bron)) && e[field]) s.add(e[field]); }
    return s.size;
  };
  const grandBudget = grandTotalBudget(budget);
  // Alleen het Operating Plan-blok telt mee in de project-KPI's; de andere
  // RBM-blokken (geïdentificeerd/onvoorzien/uitgesteld, sinds parser 2.2.0)
  // zijn geen vastgesteld plan. Ontbrekend blok = oude upload = OP.
  const opProjects = rbmOpProjects(projects);
  const projActual = opProjects.reduce((a, p) => a + (Number(p.actual_eur) || 0), 0);
  const projPlan = opProjects.reduce((a, p) => a + (Number(p.plan_eur) || 0), 0);
  // RBM per blok (plansommen + aantallen + al ingeboekt) voor de "RBM per
  // blok"-KPI: goedgekeurd (= Operating Plan; ontbrekend blok-veld = oude
  // upload = OP), geïdentificeerd en onvoorzien apart zichtbaar. Elk
  // project-blok draagt óók een actual_eur (de RBM-tab heeft plan/actual/
  // variance per rij, ongeacht sectie) — dus ook geïdentificeerd/onvoorzien
  // kunnen al deels ingeboekt zijn, ook al staan ze nog niet in het
  // vastgestelde plan.
  const rbmBlok = blok => (projects || []).filter(p => p && ((p.blok || 'op') === blok));
  const blokSom = list => list.reduce((a, p) => a + (Number(p.plan_eur) || 0), 0);
  const blokActualSom = list => list.reduce((a, p) => a + (Number(p.actual_eur) || 0), 0);
  const rbmIdentifiedList = rbmBlok('identified'), rbmUnforeseenList = rbmBlok('unforeseen');
  return {
    actual: sumWhere(isOnderhoudActual),
    consumables: sumWhere(isConsumableActual),
    personeel: sumBron(['personeel']),
    obligo: sumBron(['KOB2']),
    orders: distinct('order_nr'),
    facturen: distinct('factuur_nr', ['KOB2']),
    budgetOp: grandBudget.op_eur ?? null,
    budgetFc: grandBudget.fc_eur ?? null,
    budgetActYtd: grandBudget.act_ytd_eur ?? null,
    budgetPlanYtd: grandBudget.plan_ytd_eur ?? null,
    projActual, projPlan,
    rbmOp: projPlan, rbmOpCount: opProjects.length, rbmOpActual: projActual,
    rbmIdentified: blokSom(rbmIdentifiedList), rbmIdentifiedCount: rbmIdentifiedList.length, rbmIdentifiedActual: blokActualSom(rbmIdentifiedList),
    rbmUnforeseen: blokSom(rbmUnforeseenList), rbmUnforeseenCount: rbmUnforeseenList.length, rbmUnforeseenActual: blokActualSom(rbmUnforeseenList)
  };
}

// ── Grafiek-datavoorbereiding (pure) ───────────────────────────────
// Maandreeksen over de aanwezige perioden: onderhoud (CCTR+KOB1),
// personeel en de cumulatieve onderhoudsopbouw (YTD). Gedeeld door de
// lijn- en overige grafieken zodat de aggregatie op één plek staat.
export function monthlySeries(entries) {
  const maint = {}, pers = {};
  for (const e of entries) {
    const p = Number(e.periode);
    if (!p) continue;
    const amt = Number(e.bedrag_eur) || 0;
    if (isOnderhoudActual(e)) maint[p] = (maint[p] || 0) + amt;
    if (e.bron === 'personeel') pers[p] = (pers[p] || 0) + amt;
  }
  const months = [...new Set([...Object.keys(maint), ...Object.keys(pers)].map(Number))].sort((a, b) => a - b);
  const onderhoud = months.map(m => Math.round(maint[m] || 0));
  const personeel = months.map(m => Math.round(pers[m] || 0));
  let run = 0; const cumul = onderhoud.map(v => (run += v));
  return { months, labels: months.map(m => MAAND[m] || String(m)), onderhoud, personeel, cumul };
}

// Budget vs. actual per kostencategorie (alleen 'line'-niveau uit Maint_Costs).
export function budgetVsActual(budget) {
  return (budget || []).filter(b => b.niveau === 'line').map(b => ({
    categorie: b.categorie, op: b.op_eur || 0, act: b.act_ytd_eur || 0
  }));
}

// Pareto (80/20): gesorteerde bedragen + cumulatief percentage.
export function pareto(rows) {
  const total = rows.reduce((a, r) => a + r.bedrag, 0) || 1;
  let run = 0;
  return rows.map(r => { run += r.bedrag; return { key: r.key, bedrag: r.bedrag, cumPct: Math.round(run / total * 1000) / 10 }; });
}

// Alleen de Operating Plan-projecten (het vastgestelde plan). Projecten
// zonder blok-veld komen uit uploads van vóór parser 2.2.0 — die bevatten
// per definitie alleen het OP-blok.
export function rbmOpProjects(projects) {
  return (projects || []).filter(p => p && (!p.blok || p.blok === 'op'));
}

// RBM-projecten plan vs. actual, top N op plan — alleen het OP-blok (de
// andere blokken zijn geen vastgesteld plan en zouden de vergelijking
// plan-vs-realisatie vervuilen).
export function rbmPlanActual(projects, n) {
  return rbmOpProjects(projects).slice().sort((a, b) => (b.plan_eur || 0) - (a.plan_eur || 0)).slice(0, n || 10)
    .map(p => ({ naam: p.naam, plan: p.plan_eur || 0, actual: p.actual_eur || 0 }));
}

// Dubbeltellingsrisico RBM ↔ CCTR/KOB1/KOB2: een RBM-project draagt een
// eigen ordernummer + "al ingeboekt"-bedrag, maar dat bedrag komt in de
// praktijk vaak van dezelfde onderliggende SAP-order als een CCTR/KOB1-
// kostenregel — dus dezelfde boeking, twee keer weergegeven (bevestigd op
// echte data: RBM actual_eur en de CCTR/KOB1-som voor hetzelfde order
// kwamen exact overeen). Puur signalerend — verandert geen enkele KPI-som,
// laat alleen zien hoeveel van "RBM al ingeboekt" ook al in "Actuele
// kosten" (CCTR/KOB1) meetelt, zodat niemand de twee per ongeluk optelt.
export function rbmOrderOverlap(projects, entries) {
  const entryOrders = new Set((entries || []).filter(e => e && e.order_nr).map(e => e.order_nr));
  const overlap = (projects || []).filter(p => p && p.order_nr && entryOrders.has(p.order_nr));
  const som = overlap.reduce((a, p) => a + (Number(p.actual_eur) || 0), 0);
  return { count: overlap.length, som, orders: overlap.map(p => p.order_nr) };
}

// Meerdere-periodes trend: het dashboard toonde altijd alleen de laatste
// upload (een momentopname); dit zet het Act YTD/Plan YTD/Budget/Forecast
// van ELKE beschikbare versie chronologisch op een rij, zodat zichtbaar
// wordt of de organisatie over de tijd heen beter of slechter presteert
// t.o.v. plan — niet alleen hoe het er nu voor staat. Gebruikt uitsluitend
// de al-geladen budget-snapshot (upload.raw.budget) van elke versie, geen
// aparte fetch van kostenregels per periode nodig.
export function versionHistory(currentUpload, others) {
  const all = [currentUpload, ...(others || [])].filter(Boolean);
  const rows = all.map(u => {
    const raw = u.raw || {};
    const g = grandTotalBudget(raw.budget || []);
    const label = u.label || (u.periode ? `${MAAND[u.periode]} ${u.jaar}` : String(u.jaar));
    return {
      label, created_at: u.created_at,
      op: g.op_eur ?? null, fc: g.fc_eur ?? null,
      actYtd: g.act_ytd_eur ?? null, planYtd: g.plan_ytd_eur ?? null
    };
  }).filter(h => h.actYtd != null || h.planYtd != null); // versies zonder budgettabblad overslaan
  rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return rows;
}
