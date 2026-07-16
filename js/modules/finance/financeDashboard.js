// Financiën-dashboard (Fase 5 + 6): centrale filters + KPI-kaarten +
// samenvattingstabellen + grafieken, gevoed uit finance_entries (laatste
// upload) plus de budget/projecten-snapshot uit finance_uploads.raw.
//
// Reken-logica staat in financeUtils.js (gedeeld + testbaar); grafieken in
// financeCharts.js. Auto-insights (Fase 7) en drilldown (Fase 8) volgen.

import { fmt, esc, MAAND, ACTUAL_BRON, applyFilters, groupSum, uniqueVals, computeKpis, isOnderhoudActual, isConsumableActual, rbmOpProjects, grandTotalBudget, rbmOrderOverlap } from './financeUtils.js';
import { RBM_BLOK_LABELS } from './financeParser.js';
import { renderCharts, renderLineCharts, renderVersionHistory, destroyCharts } from './financeCharts.js';
import { renderAnalysis } from './financeAnalysis.js';
import { renderSources } from './financeSources.js';
import { renderGlossary } from './financeGlossary.js';
import { loadMaintenanceOrders, renderLink, costPerOrder } from './financeLink.js';
import { exportExcel, exportPdf } from './financeExport.js';

const KPI_STORAGE_KEY = 'financeKpiSelection';
const FIN_FILTERS_KEY = 'financeFilters';
// Onthoudt de laatst gekozen filters tussen sessies (bv. na herladen of
// opnieuw inloggen); ongeldig geworden waarden (kolom bestaat niet meer,
// dataset gewisseld) worden bij het toepassen alsnog genegeerd.
function loadFinFilters() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(FIN_FILTERS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}
function saveFinFilters(filters) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FIN_FILTERS_KEY, JSON.stringify(filters || {}));
  } catch (e) {}
}
// cat = kleurgroep (subtiele accentkleur + afscheiding); groepeert de kaarten
// visueel: Kosten (groen/paars/oranje), Volume (grijs), Budget (blauw),
// Projecten (cyaan).
const KPI_DEFS = {
  actual: { key: 'actual', label: 'Actuele kosten', sub: 'CCTR + KOB1', cat: 'Kosten', accent: '#2ea043', tip: 'Werkelijk geboekte onderhoudskosten op kostenplaatsen en werkorders.' },
  personeel: { key: 'personeel', label: 'Personeelskosten', sub: 'YTD', cat: 'Kosten', accent: '#8b5cf6', tip: 'Loonkosten uit SAP: vast salaris, overwerk en inhuurkrachten.' },
  obligo: { key: 'obligo', label: 'Open obligo', sub: 'KOB2', cat: 'Kosten', accent: '#d29922', tip: 'Kosten die al zijn vastgelegd maar nog niet gefactureerd.' },
  orders: { key: 'orders', label: 'Werkorders', sub: 'met kosten', cat: 'Volume', accent: '#64748b', tip: 'Aantal verschillende werkorders met gekoppelde financiële regels.' },
  facturen: { key: 'facturen', label: 'Facturen', sub: 'KOB2', cat: 'Volume', accent: '#64748b', tip: 'Aantal open verplichtingen met een factuurnummer.' },
  budgetOp: { key: 'budgetOp', label: 'Budget (OP, jaar)', sub: 'heel jaar', cat: 'Budget', accent: '#388bfd', tip: 'Operating Plan-budget voor het volledige jaar.' },
  budgetActYtd: { key: 'budgetActYtd', label: 'Actual vs plan (YTD)', sub: 't.o.v. plan', cat: 'Budget', accent: '#388bfd', tip: 'Werkelijke YTD-kosten vergeleken met het YTD-plan.' },
  budgetFc: { key: 'budgetFc', label: 'Forecast (FC, jaar)', sub: 'heel jaar', cat: 'Budget', accent: '#388bfd', tip: 'De geactualiseerde jaarschatting op basis van het huidige jaar.' },
  overschrijding: { key: 'overschrijding', label: 'Overschrijding', sub: 'verwacht, jaareinde', cat: 'Budget', accent: '#da3633', tip: 'Het verwachte verschil tussen de forecast (FC) en het jaarbudget (OP) — hoeveel je naar verwachting over (of onder) budget uitkomt aan het einde van het jaar.' },
  projActual: { key: 'projActual', label: 'Projecten (RBM/CAPEX)', sub: 'plan vs actual', cat: 'Projecten', accent: '#06b6d4', tip: 'Projectkosten uit RBM met plan en realisatie.' },
  rbmBlokken: { key: 'rbmBlokken', label: 'RBM per blok', sub: 'goedgekeurd · geïdentificeerd · onvoorzien', cat: 'Projecten', accent: '#06b6d4', tip: 'De RBM-projecten uitgesplitst naar hun blok in het RBM-tabblad: Goedgekeurd (het vastgestelde Operating Plan), Geïdentificeerd (kandidaten) en Onvoorzien. Plansommen per blok; alleen het goedgekeurde blok is vastgesteld budget.' }
};
function defaultKpiSelection() { return ['actual','personeel','obligo','orders','facturen','budgetOp','budgetActYtd','budgetFc','overschrijding','rbmBlokken']; }
function loadKpiSelection() {
  try {
    if (typeof localStorage === 'undefined') return defaultKpiSelection();
    const raw = localStorage.getItem(KPI_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : null;
    if (Array.isArray(ids)) return ids.filter(id => KPI_DEFS[id]);
  } catch (e) {}
  return defaultKpiSelection();
}
function saveKpiSelection(ids) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KPI_STORAGE_KEY, JSON.stringify(ids.filter(id => KPI_DEFS[id])));
  } catch (e) {}
}
function renderKpiConfig(host, refresh) {
  if (!host) return;
  host.innerHTML = `<div class="fin-kpi-config-toolbar"><button class="btn btn-p" id="finKpiConfigBtn">KPI's personaliseren</button></div><div id="finKpiConfigPanel" class="fin-kpi-config-panel" style="display:none"></div>`;
  const btn = host.querySelector('#finKpiConfigBtn');
  const panel = host.querySelector('#finKpiConfigPanel');
  const buildPanel = () => {
    const selected = loadKpiSelection();
    const allIds = [...selected, ...Object.keys(KPI_DEFS).filter(id => !selected.includes(id))];
    panel.innerHTML = `<div class="fin-kpi-config">${allIds.map(id => {
      const def = KPI_DEFS[id];
      return `<div class="fin-kpi-config-row" data-id="${id}">
        <div class="fin-kpi-config-left">
          <button type="button" class="fin-kpi-order" data-move="up">▲</button>
          <button type="button" class="fin-kpi-order" data-move="down">▼</button>
          <label><input type="checkbox" ${selected.includes(id) ? 'checked' : ''}> ${def.label}</label>
        </div>
        <div class="fin-kpi-config-sub">${def.sub}</div>
      </div>`;
    }).join('')}<div class="fin-kpi-config-actions">
        <button type="button" class="btn btn-p" id="finKpiConfigSave">Opslaan</button>
        <button type="button" class="btn btn-del" id="finKpiConfigCancel">Annuleren</button>
      </div></div>`;
    panel.querySelectorAll('.fin-kpi-order').forEach(orderBtn => {
      orderBtn.addEventListener('click', () => {
        const row = orderBtn.closest('.fin-kpi-config-row');
        if (!row) return;
        const move = orderBtn.dataset.move;
        const sibling = move === 'up' ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling || !sibling.classList.contains('fin-kpi-config-row')) return;
        if (move === 'up') host.querySelector('.fin-kpi-config').insertBefore(row, sibling);
        else host.querySelector('.fin-kpi-config').insertBefore(sibling, row);
      });
    });
    panel.querySelector('#finKpiConfigSave').addEventListener('click', () => {
      const ids = Array.from(panel.querySelectorAll('.fin-kpi-config-row'))
        .filter(r => r.querySelector('input[type="checkbox"]').checked)
        .map(r => r.dataset.id);
      saveKpiSelection(ids.length ? ids : defaultKpiSelection());
      panel.style.display = 'none';
      refresh();
    });
    panel.querySelector('#finKpiConfigCancel').addEventListener('click', () => {
      panel.style.display = 'none';
    });
  };
  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') buildPanel();
  });
}

// ── Plant-state (multi-plant: IJmuiden + Rotterdam) ────────────────
// Eén implementatie, twee datasets: de actieve plant bepaalt welke uploads/
// entries geladen worden. Cache per plant zodat wisselen een pure data-swap
// is (geen nieuwe fetch). Keuze overleeft een herlaad via localStorage.
const PLANT_KEY = 'financePlant';
const PLANT_NAMES = { IJ: 'IJmuiden', R: 'Rotterdam' };
let activePlant = null;
function getActivePlant(ctx) {
  const mag = (ctx && ctx.access && ctx.access.rotterdam) ? ['IJ', 'R'] : ['IJ'];
  if (!activePlant) {
    try { activePlant = localStorage.getItem(PLANT_KEY) || 'IJ'; } catch (e) { activePlant = 'IJ'; }
  }
  if (!mag.includes(activePlant)) activePlant = 'IJ';
  return activePlant;
}
function setActivePlant(p) {
  activePlant = p;
  try { localStorage.setItem(PLANT_KEY, p); } catch (e) {}
}
export function plantName(ctx) { return PLANT_NAMES[getActivePlant(ctx)] || 'IJmuiden'; }

let cachedDashboard = {};   // per plant
let loadingPromise = {};    // per plant
// Per upload_id gecachte vergelijkingsdata (periodevergelijking bij de
// Kerncijfers) — voorkomt een herhaalde volledige entries-fetch als de
// gebruiker heen en weer wisselt tussen dezelfde twee versies.
let compareCache = {};

// Gedeelde paginering: zowel de primaire als een vergelijkingsupload lezen
// hun kostenregels via dezelfde weg, zodat er maar één plek is die met
// "halverwege stoppen = onvolledige financiële totalen" moet omgaan.
async function fetchEntries(ctx, uploadId, h) {
  let entries = [];
  let offset = 0;
  const page = 1000;
  while (true) {
    // kostenplaats/kostenrekening/categorie/functional_loc horen in de
    // select: zonder die kolommen vielen de rekening-labels en de bevroren
    // categorie-classificatie stil terug op naam-heuristiek (bug, gevonden
    // bij het bouwen van de kostenplaats-tabel).
    const r = await fetch(`${ctx.sbUrl}/rest/v1/finance_entries?upload_id=eq.${uploadId}&select=periode,order_nr,installatie,kostensoort,kostenrekening,kostenplaats,functional_loc,categorie,order_type,leverancier,factuur_nr,bron,bedrag_eur&order=id.asc&limit=${page}&offset=${offset}`, { headers: h });
    if (!r.ok) throw new Error(`kostenregels ophalen mislukte (HTTP ${r.status})`);
    const batch = await r.json();
    entries = entries.concat(batch);
    if (batch.length < page) break;
    offset += page;
  }
  return entries;
}

// ── Data laden (per plant) ─────────────────────────────────────────
async function loadAll(ctx, force = false, plant = null) {
  const p = plant || getActivePlant(ctx);
  if (!force && cachedDashboard[p]) return cachedDashboard[p];
  if (!force && loadingPromise[p]) return loadingPromise[p];
  loadingPromise[p] = (async () => {
    try {
      const token = ctx && ctx.currentUser && ctx.currentUser.access_token;
      if (!token) return (cachedDashboard[p] = { upload: null, entries: [], orderMap: {}, others: [], plant: p });
      const h = { apikey: ctx.sbKey, Authorization: 'Bearer ' + token };
      // limit=25 i.p.v. 1: de extra 24 rijen zijn alleen metadata + de
      // budget/projecten-snapshot (raw), geen kostenregels — goedkoop, en
      // levert meteen de lijst voor de periodevergelijking zonder 2e round-trip.
      const ur = await fetch(`${ctx.sbUrl}/rest/v1/finance_uploads?select=id,jaar,periode,label,raw,created_at&plant=eq.${p}&order=created_at.desc&limit=25`, { headers: h });
      // Fail-loud: een mislukte fetch mag nooit doorgaan als "geen data" — dat
      // toont een misleidend leeg dashboard i.p.v. een herstelbare foutmelding.
      // (RLS zonder 2FA geeft gewoon 200 + lege lijst, dus dit raakt de
      // 2FA-poort niet.)
      if (!ur.ok) throw new Error(`versies ophalen mislukte (HTTP ${ur.status})`);
      const ups = await ur.json();
      if (!ups.length) return (cachedDashboard[p] = { upload: null, entries: [], orderMap: {}, others: [], plant: p });
      const upload = ups[0];
      const others = ups.slice(1);
      // De weekplanning (orderMap) bestaat alleen voor IJmuiden — voor
      // Rotterdam is er geen onderhoud-weekdata om aan te koppelen.
      const orderMapPromise = p === 'IJ' ? loadMaintenanceOrders(ctx) : Promise.resolve({});
      const entries = await fetchEntries(ctx, upload.id, h);
      const orderMap = await orderMapPromise;
      return (cachedDashboard[p] = { upload, entries, orderMap, others, plant: p });
    } finally {
      // Ook na een fout resetten, anders blijft elke volgende aanroep dezelfde
      // afgewezen promise teruggeven en herstelt het dashboard nooit meer.
      loadingPromise[p] = null;
    }
  })();
  return loadingPromise[p];
}

// Volledige data (entries + budget/projecten uit raw) van een niet-actieve
// upload, voor de periodevergelijking. Los van loadAll omdat dit een andere
// upload_id betreft dan de primair getoonde versie.
async function loadCompareData(ctx, upload) {
  if (compareCache[upload.id]) return compareCache[upload.id];
  const token = ctx && ctx.currentUser && ctx.currentUser.access_token;
  const h = { apikey: ctx.sbKey, Authorization: 'Bearer ' + token };
  const entries = await fetchEntries(ctx, upload.id, h);
  const raw = upload.raw || {};
  const label = upload.label || (upload.periode ? `${MAAND[upload.periode]} ${upload.jaar}` : String(upload.jaar));
  const data = { entries, budget: raw.budget || [], projects: raw.projects || [], label };
  compareCache[upload.id] = data;
  return data;
}

// Kerncijfers voor de startpagina (js/home.js) — leest uitsluitend de al
// geladen cache en fetcht zelf niets. De cache vult zich pas met echte data
// ná de 2FA-stap (RLS geeft zonder aal2 een lege uploads-lijst), dus dit
// lekt geen bedragen naar een niet-ontgrendelde sessie; uitloggen leegt de
// cache (invalidateDashboardCache in unmount).
window.__financeSummary = function () {
  const p = activePlant || 'IJ';
  const d = cachedDashboard[p];
  if (!d || !d.upload) return null;
  const raw = d.upload.raw || {};
  const grand = grandTotalBudget(raw.budget || []);
  const actual = (d.entries || []).filter(isOnderhoudActual).reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
  return {
    plant: PLANT_NAMES[p] || p,
    periode: d.upload.periode || null, jaar: d.upload.jaar || null,
    maand: (d.upload.periode && MAAND[d.upload.periode]) || null,
    actual, op: grand.op_eur != null ? grand.op_eur : null, fc: grand.fc_eur != null ? grand.fc_eur : null,
    fmt
  };
};

export async function prefetchDashboard(ctx) {
  try {
    await loadAll(ctx);
    // Rotterdam-toegang? Dan de andere plant alvast warm laden, zodat de
    // plant-wissel een pure data-swap is (geen fetch, < 100ms).
    if (ctx && ctx.access && ctx.access.rotterdam) {
      const other = getActivePlant(ctx) === 'IJ' ? 'R' : 'IJ';
      loadAll(ctx, false, other).catch(() => {});
    }
  } catch (err) {
    console.warn('Finance prefetch faalde:', err);
  }
}

export function invalidateDashboardCache() {
  cachedDashboard = {};
  loadingPromise = {};
  compareCache = {};
}

// ── Render ─────────────────────────────────────────────────────────
export async function renderDashboard(container, ctx) {
  destroyCharts();
  // Skeleton i.p.v. platte "laden..."-tekst: toont al de vorm van KPI-
  // kaarten + grafiek, voelt sneller aan tijdens de netwerk-fetch.
  container.innerHTML = `<div class="fin-card"><div class="fin-kg">${
    Array.from({ length: 4 }).map(() => '<div class="fin-kpi"><div class="sk sk-row" style="width:55%"></div><div class="sk sk-row" style="width:75%;height:20px;margin-top:8px"></div></div>').join('')
  }</div><div class="sk" style="height:200px;border-radius:12px;margin-top:16px"></div></div>`;
  let data;
  try { data = await loadAll(ctx); }
  catch (e) { container.innerHTML = `<div class="fin-note fin-err">Kon financiële data niet laden: ${esc(e.message)}</div>`; return; }

  if (!data.upload) {
    container.innerHTML = '<div class="fin-note">Nog geen financiële data. Upload eerst een MIP-export.</div>';
    return;
  }
  const raw = data.upload.raw || {};
  const snapshotMaand = (raw.snapshotMaand != null ? raw.snapshotMaand : data.upload.periode);
  const state = { entries: data.entries, budget: raw.budget || [], projects: raw.projects || [], costCenters: raw.costCenters || {}, orderMap: data.orderMap || {}, filters: loadFinFilters(), snapshotMaand };

  // Drie subtabs, elk met één vraag en één consistente filter-regel:
  //   Overzicht  — "hoe staan we ervoor?"  -> altijd de volledige dataset
  //   Analyse    — "waar zit het precies?" -> alles gefilterd, filters bovenaan
  //   Bronnen    — "waar komt het vandaan?"-> volledige dataset (reconciliatie)
  // Voorheen stond alles onder elkaar (~6 schermen scrollen) en werkten de
  // filters onzichtbaar door op KPI's die buiten beeld stonden.
  const plant = getActivePlant(ctx);
  const magRotterdam = !!(ctx && ctx.access && ctx.access.rotterdam);
  // Plant-selector: alleen zichtbaar met rotterdam-permissie (spec: optie
  // verborgen, niet disabled). De keuze overleeft herladen via localStorage.
  const plantSelector = magRotterdam
    ? `<label class="fin-lbl" style="margin-right:auto">Plant:
         <select id="finPlantSel" class="fin-inp" style="font-weight:600">
           <option value="IJ"${plant === 'IJ' ? ' selected' : ''}>IJmuiden</option>
           <option value="R"${plant === 'R' ? ' selected' : ''}>Rotterdam</option>
         </select>
       </label>`
    : '';
  container.innerHTML = `
    <div class="fin-card">
      <div class="fin-toolbar">
        <div class="fin-sub"><strong>${esc(PLANT_NAMES[plant])}</strong> · versie: <strong>${esc(data.upload.label || '—')}</strong> · ${data.entries.length} regels</div>
        <div class="fin-toolbar-btns">
          ${plantSelector}
          <button class="btn" id="finGlossBtn">&#128214; Begrippen</button>
          <button class="btn" id="finExpXlsx">Exporteer Excel</button>
          <button class="btn" id="finExpPdf">Print / PDF</button>
        </div>
      </div>
      <div id="finGlossary" class="fin-gloss-panel" style="display:none"></div>
      <div class="fin-tabs" role="tablist">
        <button class="fin-tab active" data-tab="overzicht" role="tab" aria-selected="true">&#128200; Overzicht</button>
        <button class="fin-tab" data-tab="analyse" role="tab" aria-selected="false">&#128269; Analyse</button>
        <button class="fin-tab" data-tab="bronnen" role="tab" aria-selected="false">&#128230; Bronnen &amp; uitleg</button>
      </div>
    </div>

    <div class="fin-tabpane" id="finTab-overzicht">
      <!-- Elke vraag zijn eigen kaart: Kerncijfers / budgetstatus / verloop /
           inzichten liepen eerst in één kaart in elkaar over. -->
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Kerncijfers <span class="fin-sl-hint">— klik op een kaart voor uitleg, bron en berekening</span></div>
        <div class="fin-kpi-toolbar">
          <div id="finKpiConfig"></div>
          <div id="finCompareHost"></div>
        </div>
        <div id="finKpis"></div>
        <div id="finKpiDetail"></div>
      </div>
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Hoe staat het budget ervoor? <span class="info-i" data-tip="Het jaarbudget (OP) is voor onderhoud/repair. Besteed = werkelijk geboekt (YTD). Vastgelegd = open obligo (nog te factureren). Nog vrij = budget min besteed min vastgelegd. Prognose (FC) = de verwachte eindstand van het jaar.">i</span></div>
        <div id="finBudgetStatus"></div>
      </div>
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Kostenverloop t.o.v. budget</div>
        <div id="finLineCharts"></div>
      </div>
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Verloop over tijd <span class="info-i" data-tip="Elk punt is een eerdere upload/versie, niet een kalendermaand — dit laat zien of de organisatie over meerdere periodes heen beter of slechter presteert t.o.v. plan, in plaats van alleen de laatste stand.">i</span></div>
        <div id="finVersionHistory"></div>
      </div>
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Inzichten</div>
        <div id="finInsights"></div>
      </div>
    </div>

    <div class="fin-tabpane" id="finTab-analyse" style="display:none">
      <div class="fin-card">
        <div class="sl" style="margin-top:0">Filters</div>
        <div class="fin-sub">Deze filters gelden voor alle tabellen en grafieken op dit tabblad.</div>
        <div class="fr" id="finFilters" style="margin-bottom:0"></div>
      </div>
      <div class="fin-card">
        <div class="fin-two">
          <div><div class="sl">Kosten per kostensoort</div><div id="finTblSoort"></div></div>
          <div><div class="sl">Kosten per installatie (top 10)</div><div id="finTblInst"></div></div>
        </div>
      </div>
      <div class="fin-card">
        <div class="sl">Kosten per kostenplaats (top 10) <span class="info-i" data-tip="Namen komen uit het General data-tabblad van de MIP-export. Uploads van vóór parser 2.2.0 tonen alleen het nummer.">i</span></div>
        <div id="finTblCC"></div>
      </div>
      <div class="fin-card">
        <div class="sl">Grafieken</div>
        <div id="finCharts"></div>
      </div>
      <div class="fin-card">
        <div class="sl">RBM-projecten <span class="fin-sl-hint">— klik op een kolomkop om te sorteren</span></div>
        <div id="finRbmTable"></div>
      </div>
      <div class="fin-card">
        <div class="sl">Onderhoud &times; Financiën</div>
        <div id="finLink"></div>
      </div>
    </div>

    <div class="fin-tabpane" id="finTab-bronnen" style="display:none">
      <div class="fin-card">
        <div class="sl">Onderdelen &amp; samenhang <span class="info-i" data-tip="Elke bron komt uit een eigen tabblad van de MIP-export. Dit blok laat per tabblad zien wat het bevat en hoe de bronnen (onderhoud, obligo, budget, projecten) met elkaar samenhangen.">i</span></div>
        <div id="finSources"></div>
      </div>
    </div>`;

  // Overzicht + Bronnen: altijd op de volledige dataset.
  state.kFull = computeKpis(state.entries, state.budget, state.projects);
  const maand = (raw.snapshotMaand != null ? raw.snapshotMaand : data.upload.periode);
  renderKpiConfig(container.querySelector('#finKpiConfig'), () => renderKpis(container, state));
  // Periodevergelijking: vorige versie is standaard geselecteerd ("zonder
  // dat iemand zelf hoeft te vergelijken"), maar de gebruiker kan elke
  // andere versie kiezen of uitzetten. state.others komt uit loadAll (alle
  // uploads behalve de nu getoonde); leeg als dit de enige versie is.
  state.others = data.others || [];
  state.compare = null;
  state.pendingCompareId = state.others.length ? state.others[0].id : '';
  renderKpis(container, state);
  renderCompareSelector(container.querySelector('#finCompareHost'), state, id => selectCompareUpload(container, ctx, state, id));
  if (state.pendingCompareId) selectCompareUpload(container, ctx, state, state.pendingCompareId);
  renderBudgetStatus(container.querySelector('#finBudgetStatus'), state.kFull, state.budget);
  renderLineCharts(container.querySelector('#finLineCharts'), state.entries, { budgetOp: state.kFull.budgetOp, budgetFc: state.kFull.budgetFc, snapshotMaand: state.snapshotMaand });
  renderVersionHistory(container.querySelector('#finVersionHistory'), data.upload, state.others);
  renderAnalysis(container.querySelector('#finInsights'), state.entries, state.budget, state.projects, maand);
  renderSources(container.querySelector('#finSources'), { entries: state.entries, budget: state.budget, projects: state.projects, orderMap: state.orderMap });

  // Analyse-tab: gefilterd; pas renderen bij de eerste keer openen (Chart.js
  // kan niet tekenen in een verborgen container).
  buildFilters(container.querySelector('#finFilters'), state, () => renderAnalyseTab(container, state));
  let analyseRendered = false;
  container.querySelectorAll('.fin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.fin-tab').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      container.querySelectorAll('.fin-tabpane').forEach(p => { p.style.display = p.id === 'finTab-' + btn.dataset.tab ? '' : 'none'; });
      if (btn.dataset.tab === 'analyse' && !analyseRendered) { renderAnalyseTab(container, state); analyseRendered = true; }
    });
  });

  // Begrippen-paneel: lazy renderen bij de eerste keer openen.
  const glossBtn = container.querySelector('#finGlossBtn');
  const glossPanel = container.querySelector('#finGlossary');
  if (glossBtn && glossPanel) {
    let glossFilled = false;
    glossBtn.addEventListener('click', () => {
      const show = glossPanel.style.display === 'none';
      glossPanel.style.display = show ? 'block' : 'none';
      glossBtn.classList.toggle('active', show);
      if (show && !glossFilled) { renderGlossary(glossPanel); glossFilled = true; }
    });
  }

  // Export respecteert de huidige filters.
  const expXlsx = container.querySelector('#finExpXlsx');
  if (expXlsx) expXlsx.addEventListener('click', () => exportExcel(
    { entries: applyFilters(state.entries, state.filters), budget: state.budget, projects: state.projects, orderMap: state.orderMap },
    `financien_${plant}_${(data.upload.label || 'export').replace(/[^\w]+/g, '_')}.xlsx`
  ));
  const expPdf = container.querySelector('#finExpPdf');
  if (expPdf) expPdf.addEventListener('click', exportPdf);

  // Plant-wissel: alleen de datalaag wisselen. De andere plant is al
  // geprefetcht (zie prefetchDashboard), dus dit is normaal een pure
  // cache-swap zonder netwerk-fetch.
  const plantSel = container.querySelector('#finPlantSel');
  if (plantSel) plantSel.addEventListener('change', () => {
    setActivePlant(plantSel.value === 'R' ? 'R' : 'IJ');
    renderDashboard(container, ctx).catch(e => console.error('Plant-wissel faalde:', e));
    // Paginakop (buiten deze container) meenemen in de wissel.
    const ws = document.querySelector('#pg-financien .ws');
    if (ws) ws.textContent = ws.textContent.replace(/IJmuiden|Rotterdam/, PLANT_NAMES[getActivePlant(ctx)]);
  });
}

function buildFilters(el, state, onChange) {
  const mk = (id, label, field, fmtOpt) => {
    const vals = uniqueVals(state.entries, field);
    const cur = state.filters[id] || '';
    // Onthouden waarde die niet meer in de huidige dataset voorkomt (bv. na
    // een nieuwe upload) wordt genegeerd i.p.v. een lege/verweesde selectie.
    if (cur && !vals.includes(cur)) delete state.filters[id];
    const sel = state.filters[id] || '';
    return `<label>${label}:</label><select data-f="${id}"><option value=""${sel === '' ? ' selected' : ''}>Alle</option>${vals.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(fmtOpt ? fmtOpt(v) : v)}</option>`).join('')}</select>`;
  };
  el.innerHTML =
    mk('maand', 'Maand', 'periode', v => `${v} — ${MAAND[v] || v}`) +
    mk('installatie', 'Installatie', 'installatie') +
    mk('kostensoort', 'Kostensoort', 'kostensoort') +
    mk('leverancier', 'Leverancier', 'leverancier') +
    mk('bron', 'Bron', 'bron') +
    `<button class="btn" data-f="reset" style="margin-left:auto">Reset</button>`;
  el.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
    state.filters[sel.dataset.f] = sel.value;
    saveFinFilters(state.filters);
    onChange();
  }));
  const reset = el.querySelector('[data-f="reset"]');
  if (reset) reset.addEventListener('click', () => { state.filters = {}; saveFinFilters(state.filters); el.querySelectorAll('select').forEach(s => s.value = ''); onChange(); });
}

function kpiCard(label, val, sub, tip, accent, cat, id, deltaHtml, hero) {
  const info = tip ? `<span class="info-i" data-tip="${esc(tip)}">i</span>` : '';
  const tag = cat ? `<div class="fin-kpi-cat">${esc(cat)}</div>` : '';
  const attrs = id ? ` data-kpi="${esc(id)}" tabindex="0" role="button" aria-label="${esc(label)} — toon uitleg en berekening"` : '';
  const cls = hero ? 'fin-kpi fin-kpi-hero' : 'fin-kpi';
  return `<div class="${cls}"${accent ? ` style="--kpi:${accent}"` : ''}${attrs}>${info}${tag}<div class="fin-kpi-l">${esc(label)}</div><div class="fin-kpi-v">${val}</div>${sub ? `<div class="fin-kpi-s">${sub}</div>` : ''}${deltaHtml || ''}</div>`;
}
// Werkelijke uitgave (YTD) minus het plan voor diezelfde periode (YTD):
// positief = nu al boven planning, negatief/nul = binnen planning. Zelfde
// bron/berekening als de kernzin op de Budgetstatus-kaart (ytdDiff hieronder
// in renderBudgetStatus) — bewust NIET forecast (FC) min jaarbudget (OP):
// die twee kunnen tegengesteld uitpakken (FC kan onder het jaarbudget liggen
// terwijl de YTD-uitgave al boven het YTD-plan zit) en "overschrijding" is
// in de praktijk de vraag "lopen we nu al uit de pas met het plan?", niet
// een prognose voor eind jaar.
function overschrijdingBedrag(k) {
  return (k.actual != null && k.budgetPlanYtd != null) ? (k.actual - k.budgetPlanYtd) : null;
}
function kpiValue(id, k) {
  switch (id) {
    case 'actual': return fmt(k.actual);
    case 'personeel': return fmt(k.personeel);
    case 'obligo': return fmt(k.obligo);
    case 'orders': return k.orders;
    case 'facturen': return k.facturen;
    case 'budgetOp': return fmt(k.budgetOp);
    case 'budgetActYtd': return fmt(k.budgetActYtd);
    case 'budgetFc': return fmt(k.budgetFc);
    case 'overschrijding': { const d = overschrijdingBedrag(k); return d != null ? fmt(Math.abs(d)) : '—'; }
    case 'projActual': return fmt(k.projActual);
    // Detail-titel toont het totaal; de kaart zelf rendert 3 kolommen
    // (zie renderSelectedKpis).
    case 'rbmBlokken': return fmt((k.rbmOp || 0) + (k.rbmIdentified || 0) + (k.rbmUnforeseen || 0));
    default: return '—';
  }
}
// Zelfde selectie als kpiValue, maar ongeformatteerd (voor delta-berekening
// t.o.v. een vergelijkingsperiode) — orders/facturen zijn al kaal getal.
function kpiRawNumber(id, k) {
  switch (id) {
    case 'actual': return k.actual;
    case 'personeel': return k.personeel;
    case 'obligo': return k.obligo;
    case 'orders': return k.orders;
    case 'facturen': return k.facturen;
    case 'budgetOp': return k.budgetOp;
    case 'budgetActYtd': return k.budgetActYtd;
    case 'budgetFc': return k.budgetFc;
    case 'overschrijding': return overschrijdingBedrag(k);
    case 'projActual': return k.projActual;
    case 'rbmBlokken': return (k.rbmOp || 0) + (k.rbmIdentified || 0) + (k.rbmUnforeseen || 0);
    default: return null;
  }
}
const KPI_COUNT_IDS = ['orders', 'facturen'];
// Periodevergelijking onder elke KPI-kaart. Kleur alleen bij kostenposten
// (cat 'Kosten'): meer kosten = rood, minder = groen — bij budget/volume/
// projecten is "meer" niet per se goed of slecht (twee opeenvolgende
// YTD-versies laten bijna altijd een toename zien; dat is geen verslechtering,
// gewoon tijdsverloop), dus daar tonen we alleen de richting, neutraal.
function kpiDeltaHtml(id, kCur, kPrev, prevLabel) {
  const cur = kpiRawNumber(id, kCur), prev = kpiRawNumber(id, kPrev);
  if (cur == null || prev == null) return '';
  const diff = cur - prev;
  const pct = prev !== 0 ? Math.round(diff / Math.abs(prev) * 100) : null;
  const isCount = KPI_COUNT_IDS.includes(id);
  const diffAbsFmt = isCount ? Math.abs(diff) : fmt(Math.abs(diff));
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•';
  const isCost = (KPI_DEFS[id] || {}).cat === 'Kosten';
  const tone = isCost ? dir : 'neutral';
  return `<div class="fin-kpi-delta fin-kpi-delta-${tone}">${arrow} ${sign}${diffAbsFmt}${pct != null ? ` (${diff >= 0 ? '+' : ''}${pct}%)` : ''}<span class="fin-kpi-delta-vs"> vs ${esc(prevLabel)}</span></div>`;
}
// Subtekst voor de "Actual vs plan (YTD)"-kaart: het procentuele verschil
// t.o.v. het YTD-plan, zodat het getal de belofte van het label waarmaakt.
function planDiffSub(k) {
  if (k.budgetActYtd == null || k.budgetPlanYtd == null || k.budgetPlanYtd === 0) return 't.o.v. plan';
  const pct = Math.round((k.budgetActYtd / k.budgetPlanYtd - 1) * 100);
  return `${pct > 0 ? '+' : ''}${pct}% t.o.v. plan ${fmt(k.budgetPlanYtd)}`;
}
// Subtekst voor de "Overschrijding"-kaart: het cijfer alleen is dubbelzinnig
// (te veel of te weinig?) — de richting expliciet benoemen i.p.v. impliciet
// via kleur alleen (color-not-only).
function overschrijdingSub(k) {
  const d = overschrijdingBedrag(k);
  if (d == null) return 'geen plan (YTD) beschikbaar';
  return d > 0 ? 'boven planning (YTD)' : 'binnen planning (YTD)';
}
function renderSelectedKpis(k, ids, compareK, compareLabel) {
  return ids.map(id => {
    const def = KPI_DEFS[id];
    if (!def) return '';
    // RBM per blok: geen één groot cijfer maar drie kolommen op de kaart —
    // goedgekeurd (OP) voorop want dat is het vastgestelde budget, de
    // andere twee zijn kandidaten/onvoorzien (zie de tip in KPI_DEFS).
    // "Al ingeboekt": elk RBM-blok draagt een actual_eur naast plan_eur —
    // ook geïdentificeerd/onvoorzien kunnen dus al deels gerealiseerd zijn,
    // ook al staan ze niet in het vastgestelde plan. Percentage t.o.v. het
    // plan van datzelfde blok; "nog niets ingeboekt" i.p.v. "€ 0 (0%)" —
    // leesbaarder voor het overgrote-meerderheid-geval.
    const rbmActLine = (actual, plan) => {
      if (!actual) return '<span class="fin-kpi-col-a fin-kpi-col-a-none">nog niets ingeboekt</span>';
      const pct = plan ? Math.round(actual / plan * 100) : null;
      return `<span class="fin-kpi-col-a">${fmt(actual)} ingeboekt${pct != null ? ` (${pct}%)` : ''}</span>`;
    };
    const value = id === 'rbmBlokken'
      ? `<div class="fin-kpi-cols">
          <div class="fin-kpi-col"><span class="fin-kpi-col-l">Goedgekeurd</span><span class="fin-kpi-col-v">${fmt(k.rbmOp)}</span><span class="fin-kpi-col-s">${k.rbmOpCount || 0} project${(k.rbmOpCount || 0) === 1 ? '' : 'en'}</span>${rbmActLine(k.rbmOpActual, k.rbmOp)}</div>
          <div class="fin-kpi-col"><span class="fin-kpi-col-l">Ge&iuml;dentificeerd</span><span class="fin-kpi-col-v">${fmt(k.rbmIdentified)}</span><span class="fin-kpi-col-s">${k.rbmIdentifiedCount || 0} project${(k.rbmIdentifiedCount || 0) === 1 ? '' : 'en'}</span>${rbmActLine(k.rbmIdentifiedActual, k.rbmIdentified)}</div>
          <div class="fin-kpi-col"><span class="fin-kpi-col-l">Onvoorzien</span><span class="fin-kpi-col-v">${fmt(k.rbmUnforeseen)}</span><span class="fin-kpi-col-s">${k.rbmUnforeseenCount || 0} project${(k.rbmUnforeseenCount || 0) === 1 ? '' : 'en'}</span>${rbmActLine(k.rbmUnforeseenActual, k.rbmUnforeseen)}</div>
        </div>`
      : kpiValue(id, k);
    const sub = id === 'projActual' ? `plan ${fmt(k.projPlan)}`
      : id === 'budgetActYtd' ? planDiffSub(k)
      : id === 'overschrijding' ? overschrijdingSub(k)
      : id === 'rbmBlokken' ? 'plan- en ingeboekte som per RBM-blok'
      : def.sub;
    const deltaHtml = compareK ? kpiDeltaHtml(id, k, compareK, compareLabel) : '';
    // Hero-KPI (zelfde principe als .kc-hero op het onderhoud-dashboard):
    // 'actual' is het cijfer waar het eerst naar gekeken wordt ("hoeveel
    // hebben we uitgegeven?") — nadruk via gewicht, geen apart grid, dus
    // als iemand 'm uit z'n personalisatie haalt verdwijnt de nadruk gewoon
    // mee i.p.v. dat er een layout-gat valt.
    return kpiCard(def.label, value, sub, def.tip, def.accent, def.cat, id, deltaHtml, id === 'actual');
  }).join('');
}

// ── Periodevergelijking: selector + laden ───────────────────────────
function renderCompareSelector(host, state, onChange) {
  if (!host) return;
  const others = state.others || [];
  if (!others.length) { host.innerHTML = ''; return; }
  const cur = state.compare ? state.compare.id : (state.pendingCompareId || '');
  host.innerHTML = `<label class="fin-compare-lbl">Vergelijk met
    <select class="fin-inp" id="finCompareSel">
      <option value=""${cur === '' ? ' selected' : ''}>Geen vergelijking</option>
      ${others.map(u => {
        const lbl = u.label || (u.periode ? `${MAAND[u.periode]} ${u.jaar}` : String(u.jaar));
        return `<option value="${u.id}"${String(u.id) === String(cur) ? ' selected' : ''}>${esc(lbl)}</option>`;
      }).join('')}
    </select>
  </label>`;
  const sel = host.querySelector('#finCompareSel');
  sel.addEventListener('change', () => onChange(sel.value || null));
}
async function selectCompareUpload(container, ctx, state, uploadId) {
  const compareHost = container.querySelector('#finCompareHost');
  const sel = compareHost && compareHost.querySelector('select');
  if (!uploadId) {
    state.compare = null; state.pendingCompareId = '';
    renderKpis(container, state);
    return;
  }
  const upload = (state.others || []).find(u => String(u.id) === String(uploadId));
  if (!upload) { state.compare = null; renderKpis(container, state); return; }
  if (sel) sel.disabled = true;
  try {
    const cmp = await loadCompareData(ctx, upload);
    state.compare = { id: upload.id, label: cmp.label, k: computeKpis(cmp.entries, cmp.budget, cmp.projects) };
  } catch (e) {
    console.error('Vergelijkingsdata laden faalde:', e);
    state.compare = null;
  } finally {
    state.pendingCompareId = '';
    if (sel) sel.disabled = false;
    renderKpis(container, state);
  }
}

// ── Budgetstatus (manager-overzicht): jaarbudget, besteed, vastgelegd, vrij,
// prognose en de grootste overschrijdingen per categorie. Bewust simpel. ──
function pctOf(part, whole) { return (whole && whole > 0) ? Math.round(part / whole * 100) : 0; }
function renderBudgetStatus(el, k, budget) {
  if (!el) return;
  const b = k.budgetOp, fc = k.budgetFc, besteed = k.actual || 0, obligo = k.obligo || 0, planYtd = k.budgetPlanYtd;
  if (b == null) { el.innerHTML = '<div class="fin-note">Geen jaarbudget (OP) in deze export — budgetstatus niet te tonen.</div>'; return; }
  const vrij = b - besteed - obligo;                       // kan negatief = tekort
  const fcDiff = (fc != null) ? fc - b : null;             // <0 = onder budget (goed)
  const ytdDiff = (planYtd != null) ? besteed - planYtd : null; // >0 = boven plan (tekort)
  const bestP = pctOf(besteed, b), oblP = pctOf(obligo, b);
  const vrijP = Math.max(0, 100 - bestP - oblP);
  const fcPos = fc != null ? Math.min(100, pctOf(fc, b)) : null;
  const ok = fcDiff != null && fcDiff <= 0;

  // Overschrijdingen/meevallers per budgetcategorie (YTD, uit Maint_Costs-lines).
  const lines = (budget || []).filter(l => l.niveau === 'line' && l.act_ytd_eur != null && l.plan_ytd_eur != null)
    .map(l => ({ cat: l.categorie, act: l.act_ytd_eur, plan: l.plan_ytd_eur, diff: l.act_ytd_eur - l.plan_ytd_eur }))
    .sort((a, x) => x.diff - a.diff);
  const diffCell = d => d > 0
    ? `<span class="fin-over">▲ ${fmt(d)} over</span>`
    : d < 0 ? `<span class="fin-under">▼ ${fmt(-d)} onder</span>` : '<span class="fin-flat">op plan</span>';
  const tekortenRows = lines.map(l => `<tr>
      <td>${esc(l.cat)}</td>
      <td style="text-align:right">${fmt(l.act)}</td>
      <td style="text-align:right;color:#8b949e">${fmt(l.plan)}</td>
      <td style="text-align:right">${diffCell(l.diff)}</td>
    </tr>`).join('');

  // Eén zin, één kernboodschap: alle bedragen blijven neutraal behalve dat
  // ene antwoord op "hoe staan we ervoor" (vrij/tekort), dat als gekleurde
  // pil oplicht — zodat het scanbaar is zonder de hele zin te moeten lezen.
  const keyTakeaway = vrij >= 0
    ? `<span class="fin-highlight ok">nog ${fmt(vrij)} vrij</span>`
    : `<span class="fin-highlight over">${fmt(-vrij)} over budget</span>`;
  el.innerHTML = `
    <div class="fin-bs-headline fin-bs-${ok ? 'ok' : 'over'}">
      ${ok ? '✅' : '⚠️'} Van het jaarbudget van <strong>${fmt(b)}</strong> is <strong>${fmt(besteed)}</strong> uitgegeven
      en <strong>${fmt(obligo)}</strong> vastgelegd — ${keyTakeaway}.
      ${fc != null ? `Prognose eindejaar: <strong>${fmt(fc)}</strong> (${fmt(Math.abs(fcDiff))} ${ok ? 'onder' : 'boven'} budget).` : ''}
    </div>

    <div class="fin-bar" title="Verdeling van het jaarbudget">
      <div class="fin-bar-track">
        <div class="fin-bar-seg" style="width:${bestP}%;background:#2ea043"></div>
        <div class="fin-bar-seg" style="width:${oblP}%;background:#d29922"></div>
        <div class="fin-bar-seg" style="width:${vrijP}%;background:#30363d"></div>
      </div>
      ${fcPos != null ? `<div class="fin-bar-marker" style="left:${fcPos}%"><span>prognose</span></div>` : ''}
    </div>
    <div class="fin-bs-legend">
      <span><i style="background:#2ea043"></i>Besteed ${fmt(besteed)} · ${bestP}%</span>
      <span><i style="background:#d29922"></i>Vastgelegd ${fmt(obligo)} · ${oblP}%</span>
      <span><i style="background:#30363d"></i>Nog vrij ${fmt(vrij)} · ${vrijP}%</span>
      <span class="fin-bs-budget">Budget ${fmt(b)} = 100%</span>
    </div>

    ${ytdDiff != null ? `<div class="fin-bs-ytd ${ytdDiff > 0 ? 'fin-bs-over' : 'fin-bs-ok'}">
      ${ytdDiff > 0 ? '⚠️' : '✅'} Tot nu toe (YTD) ligt de uitgave
      <strong>${fmt(Math.abs(ytdDiff))} ${ytdDiff > 0 ? 'boven' : 'onder'}</strong> het plan
      (${fmt(besteed)} t.o.v. plan ${fmt(planYtd)}).</div>` : ''}

    ${lines.length ? `<div class="fin-bs-tt">Waar wijkt het af van het plan? (YTD, per kostencategorie)</div>
    <div class="tw keep-table"><table class="fin-tbl"><thead><tr>
      <th>Kostencategorie</th><th style="text-align:right">Besteed</th><th style="text-align:right">Plan</th><th style="text-align:right">Verschil</th>
    </tr></thead><tbody>${tekortenRows}</tbody></table></div>` : ''}`;
}

// Kerncijfers op het Overzicht-tab: altijd de volledige dataset, zodat de
// filters (die op het Analyse-tab staan) hier niet onzichtbaar doorwerken.
// Elke kaart is klikbaar en opent eronder een detailpaneel met wat het is,
// uit welk MIP-tabblad het komt, de berekening met de echte getallen en de
// opbouw (top-5) — zodat niemand een getal hoeft te vertrouwen zonder het
// te kunnen controleren.
function renderKpis(container, state) {
  const selectedKpis = loadKpiSelection();
  const host = container.querySelector('#finKpis');
  const detail = container.querySelector('#finKpiDetail');
  const compareK = state.compare ? state.compare.k : null;
  const compareLabel = state.compare ? state.compare.label : null;
  host.innerHTML = `<div class="fin-kg">${renderSelectedKpis(state.kFull, selectedKpis, compareK, compareLabel)}</div>`;
  if (detail) { detail.innerHTML = ''; delete detail.dataset.open; }
  const closeDetail = () => {
    detail.innerHTML = ''; delete detail.dataset.open;
    host.querySelectorAll('.fin-kpi').forEach(c => c.classList.remove('active'));
  };
  host.querySelectorAll('.fin-kpi[data-kpi]').forEach(card => {
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } });
    card.addEventListener('click', e => {
      if (e.target.closest('.info-i')) return;           // tooltip-icoon togglet niet
      if (!detail) return;
      const id = card.dataset.kpi;
      if (detail.dataset.open === id) { closeDetail(); return; }
      detail.dataset.open = id;
      detail.innerHTML = kpiDetailHtml(id, state);
      host.querySelectorAll('.fin-kpi').forEach(c => c.classList.toggle('active', c === card));
      // Gebruikersfeedback: het detailpaneel opent onder de hele KPI-grid
      // (2 rijen) — klik je op een kaart bovenin, dan verschijnt de uitleg
      // ver onder de vouw en werd hij gemist. Automatisch ernaartoe
      // scrollen lost dat op zonder een aparte pagina/modal nodig te
      // hebben (scroll-margin-top in finance.css houdt rekening met de
      // sticky topbar, zodat het paneel er niet exact onder wegduikt).
      const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detail.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      const btn = detail.querySelector('.fin-kd-close');
      if (btn) btn.addEventListener('click', closeDetail);
      // Categorierijen met specificatie (zie kdTable) klappen in-place open/
      // dicht — zelfde patroon als .reden-row op het onderhoud-dashboard.
      detail.querySelectorAll('.reden-row').forEach(row => {
        const toggle = () => {
          const open = row.classList.toggle('open');
          row.setAttribute('aria-expanded', String(open));
          const next = row.nextElementSibling;
          if (next && next.classList.contains('reden-detail-row')) next.classList.toggle('open', open);
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      });
      // "RBM per blok": de tabel is interactief (sorteren/filteren per
      // blok) — hergebruikt dezelfde renderRbmTable als het Analyse-
      // tabblad i.p.v. een aparte, kalere lijst te bouwen.
      if (id === 'rbmBlokken') renderRbmTable(detail.querySelector('#finKdRbmTable'), state.projects);
    });
  });
}

// ── KPI-detail: de informatie ACHTER het getal ─────────────────────
function kdBlock(h, body) {
  return `<div class="fin-kd-block"><div class="fin-kd-h">${esc(h)}</div><div class="fin-kd-b">${body}</div></div>`;
}
// details (optioneel): per rij ofwel null (gewone rij) of kant-en-klare HTML
// voor een uitklapbare specificatie-rij eronder — zelfde klik-om-uit-te-
// klappen-patroon (.reden-row/.reden-detail-row/.tog) als de "Niet
// uitgevoerd"-tabel op het onderhoud-dashboard, zodat het overal hetzelfde
// aanvoelt i.p.v. een nieuw interactiepatroon te verzinnen.
function kdTable(head, rows, details) {
  if (!rows.length) return '';
  const body = rows.map((r, i) => {
    const d = details && details[i];
    const cells = r.map((c, ci) => {
      const content = (ci === 0 && d) ? `${c}<span class="tog">&#9658;</span>` : c;
      return `<td${ci > 0 ? ' style="text-align:right"' : ''}>${content}</td>`;
    }).join('');
    if (!d) return `<tr>${cells}</tr>`;
    return `<tr class="reden-row" tabindex="0" role="button" aria-expanded="false">${cells}</tr>` +
      `<tr class="reden-detail-row"><td colspan="${head.length}">${d}</td></tr>`;
  }).join('');
  return `<div class="tw keep-table" style="margin:8px 0 0"><table class="fin-tbl"><thead><tr>${
    head.map((h, i) => `<th${i > 0 ? ' style="text-align:right"' : ''}>${esc(h)}</th>`).join('')
  }</tr></thead><tbody>${body}</tbody></table></div>`;
}
// Specificatie van één budgetcategorie-regel uit Maint_Costs: alle vier
// brondstuk-bedragen plus de twee diff-kolommen die de Excel zelf al
// meegeeft — dit is echte, al ingelezen data, geen nieuwe aanname. Geeft
// antwoord op "waarom staat deze categorie zo in de lijst" zonder een
// koppeling naar losse boekingen te suggereren die er (nog) niet is: de
// Maint_Costs-cijfers zijn een vooraf geaggregeerd Excel-tabblad, niet
// optelbaar uit de CCTR/KOB1/KOB2-transactieregels.
function kdCatDetail(l) {
  // diff-conventie uit het Maint_Costs-tabblad: negatief = méér uitgegeven
  // dan gepland/verwacht (overschrijding) -> rood; positief = ruimte -> groen.
  const stat = (label, val, isDiff) => {
    const cls = isDiff && val != null ? (val < 0 ? ' fin-spec-over' : val > 0 ? ' fin-spec-under' : '') : '';
    return `<div class="fin-spec-item"><div class="fin-spec-l">${esc(label)}</div><div class="fin-spec-v${cls}">${val != null ? fmt(val) : '—'}</div></div>`;
  };
  return `<div class="fin-spec">
    ${stat('Budget (OP, heel jaar)', l.op_eur)}
    ${stat('Forecast (FC, heel jaar)', l.fc_eur)}
    ${stat('Werkelijk (Act YTD)', l.act_ytd_eur)}
    ${stat('Plan (YTD)', l.plan_ytd_eur)}
    ${stat('Verschil vs. plan', l.diff_plan_eur, true)}
    ${stat('Verschil vs. forecast', l.diff_fc_eur, true)}
  </div>`;
}
// Specificatie van een kostensoort/leverancier-groep: hier WEL de losse
// finance_entries-regels tonen (i.t.t. kdCatDetail hierboven) — dit zijn
// echte transactieregels uit CCTR/KOB1/KOB2, geen vooraf geaggregeerd
// Excel-tabblad, dus optellen tot het groepstotaal is eerlijk. Top 10 op
// bedrag, met een telling van de rest zodat niets stilzwijgend verdwijnt.
function kdEntryDetail(rows, groupKey, head, rowFn) {
  head = head || ['Order', 'Leverancier', 'Installatie', 'Bedrag'];
  rowFn = rowFn || (x => [
    x.order_nr ? `<span style="font-family:monospace;font-size:12px">${esc(x.order_nr)}</span>` : '—',
    esc(x.leverancier || '—'),
    esc(x.installatie || x.functional_loc || '—'),
    fmt(x.bedrag_eur)
  ]);
  const sorted = [...rows].sort((a, b) => Math.abs(Number(b.bedrag_eur) || 0) - Math.abs(Number(a.bedrag_eur) || 0));
  const shown = sorted.slice(0, 10);
  const table = kdTable(head, shown.map(rowFn));
  const rest = rows.length - shown.length;
  const note = rest > 0
    ? `<div style="font-size:11px;color:var(--color-text-secondary);margin:6px 2px 2px">+ ${rest} meer regel${rest === 1 ? '' : 's'} binnen "${esc(groupKey)}"</div>` : '';
  return `<div style="padding:6px 2px 2px">${table}${note}</div>`;
}
// Elke kostensoort ("Cost element name", bv. "Repair materials") komt in de
// bron-Excel 1-op-1 van een numerieke kostenrekening ("Cost element(name)",
// bv. 623001000) — niet alleen bij "Third party rep. & m" (629001000), maar
// bij elke kostensoort. Toont die code als vaste referentie naast de naam.
// Kostenplaats-naam uit de General data-masterdata (parser 2.2.0): toont
// "Naam (nummer)" waar we voorheen alleen het kale SAP-nummer hadden.
// Oude uploads zonder costCenters vallen terug op het nummer.
function ccLabel(state, id) {
  if (!id) return '—';
  const m = state && state.costCenters && state.costCenters[String(id).trim()];
  return m && m.naam
    ? `${esc(m.naam)} <span style="font-family:monospace;font-size:11px;color:var(--color-text-secondary)">(${esc(id)})</span>`
    : esc(id);
}
function kostensoortLabel(rows, key) {
  const hit = rows.find(x => (x.kostensoort || '—') === key);
  const code = hit && hit.kostenrekening;
  return code ? `${esc(key)} <span style="font-family:monospace;font-size:11px;color:var(--color-text-secondary)">(${esc(code)})</span>` : esc(key);
}
function kpiDetailHtml(id, state) {
  const k = state.kFull, e = state.entries, def = KPI_DEFS[id] || {};
  const som = list => list.reduce((a, x) => a + (Number(x.bedrag_eur) || 0), 0);
  const pctVan = (deel, totaal) => totaal > 0 ? Math.round(deel / totaal * 100) + '%' : '—';
  let blocks = '', tableTitle = '', table = '';

  if (id === 'actual') {
    const ond = e.filter(isOnderhoudActual);
    const cctr = ond.filter(x => x.bron === 'CCTR'), kob1 = ond.filter(x => x.bron === 'KOB1');
    const verbruik = e.filter(isConsumableActual);
    blocks =
      kdBlock('Wat is dit?', 'De werkelijk geboekte onderhoudskosten van dit jaar (year-to-date): alles wat al écht is uitgegeven aan reparatie en onderhoud.') +
      kdBlock('Waar komt het vandaan?', `Twee tabbladen van de MIP-export: <strong>IJ_CCTR</strong> (kostenplaatsen, ${cctr.length} regels) en <strong>IJ_KOB1</strong> (werkorders, ${kob1.length} regels).`) +
      kdBlock('Berekening', `CCTR ${fmt(som(cctr))} + KOB1 ${fmt(som(kob1))} = <strong>${fmt(k.actual)}</strong>. Verbruik zoals smeermiddelen (${fmt(som(verbruik))}) telt níét mee — zo sluit dit exact aan op het "repair costs"-totaal in Maint_Costs.`);
    tableTitle = 'Grootste kostensoorten binnen dit bedrag — klik voor specificatie';
    const topSoort = groupSum(ond, 'kostensoort').slice(0, 5);
    // Leverancier bestaat niet op CCTR/KOB1 (alleen KOB2/obligo heeft dat
    // veld) — zou hier altijd leeg zijn. Bron (CCTR/KOB1) is wél altijd
    // gevuld en vertelt waar de regel vandaan komt.
    table = kdTable(['Kostensoort', 'Bedrag', 'Aandeel'],
      topSoort.map(r => [kostensoortLabel(ond, r.key), fmt(r.bedrag), pctVan(r.bedrag, k.actual)]),
      topSoort.map(r => kdEntryDetail(ond.filter(x => (x.kostensoort || '—') === r.key), r.key,
        ['Order', 'Bron', 'Installatie', 'Bedrag'],
        x => [
          x.order_nr ? `<span style="font-family:monospace;font-size:12px">${esc(x.order_nr)}</span>` : '<span style="color:var(--color-text-secondary)">geen order (kostenplaats-boeking)</span>',
          esc(x.bron || '—'),
          esc(x.installatie || x.functional_loc || '—'),
          fmt(x.bedrag_eur)
        ])));

  } else if (id === 'personeel') {
    const pers = e.filter(x => x.bron === 'personeel');
    blocks =
      kdBlock('Wat is dit?', 'Alle loonkosten van de eigen dienst (year-to-date): vast salaris, overwerk en inhuurkrachten.') +
      kdBlock('Waar komt het vandaan?', `Tabblad <strong>IJ_Personeel</strong> (${pers.length} regels). Staat bewust los van de onderhoudskosten: personeel drukt niet op het repair-budget.`) +
      kdBlock('Berekening', `Som van alle personeelsregels = <strong>${fmt(k.personeel)}</strong>.`);
    tableTitle = 'Opbouw per looncomponent — klik voor specificatie';
    const topComp = groupSum(pers, 'kostensoort').slice(0, 5);
    table = kdTable(['Component', 'Bedrag', 'Aandeel'],
      topComp.map(r => [kostensoortLabel(pers, r.key), fmt(r.bedrag), pctVan(r.bedrag, k.personeel)]),
      topComp.map(r => kdEntryDetail(pers.filter(x => (x.kostensoort || '—') === r.key), r.key,
        ['Kostenplaats', 'Bedrag'], x => [ccLabel(state, x.kostenplaats), fmt(x.bedrag_eur)])));

  } else if (id === 'obligo') {
    const kob2 = e.filter(x => x.bron === 'KOB2');
    blocks =
      kdBlock('Wat is dit?', 'Vastgelegde maar nog niet gefactureerde kosten: bestellingen en opdrachten die al geplaatst zijn. Dit komt bóvenop de al geboekte kosten en drukt dus ook op het budget.') +
      kdBlock('Waar komt het vandaan?', `Tabblad <strong>IJ_KOB2</strong> (${kob2.length} regels), inclusief leverancier en factuur-/referentienummer per post.`) +
      kdBlock('Berekening', `Som van alle open bedragen = <strong>${fmt(k.obligo)}</strong>.`);
    tableTitle = 'Grootste leveranciers in het open obligo — klik voor specificatie';
    const topLev = groupSum(kob2.filter(x => x.leverancier), 'leverancier').slice(0, 5);
    table = kdTable(['Leverancier', 'Open bedrag', 'Aandeel'],
      topLev.map(r => [esc(r.key), fmt(r.bedrag), pctVan(r.bedrag, k.obligo)]),
      topLev.map(r => kdEntryDetail(kob2.filter(x => (x.leverancier || '—') === r.key), r.key,
        ['Order', 'Factuur/ref', 'Installatie', 'Bedrag'],
        x => [
          x.order_nr ? `<span style="font-family:monospace;font-size:12px">${esc(x.order_nr)}</span>` : '—',
          x.factuur_nr ? `<span style="font-family:monospace;font-size:12px">${esc(x.factuur_nr)}</span>` : '—',
          esc(x.installatie || x.functional_loc || '—'),
          fmt(x.bedrag_eur)
        ])));

  } else if (id === 'orders') {
    const ondOrders = new Set(e.filter(x => isOnderhoudActual(x) && x.order_nr).map(x => x.order_nr));
    let gekoppeld = 0; ondOrders.forEach(o => { if ((state.orderMap || {})[o]) gekoppeld++; });
    blocks =
      kdBlock('Wat is dit?', 'Het aantal verschillende werkorders waar dit jaar kosten op zijn geboekt — een maat voor hoeveel losse klussen er financieel spelen.') +
      kdBlock('Waar komt het vandaan?', 'De ordernummers uit alle kostenregels (CCTR, KOB1 en KOB2), ontdubbeld.') +
      kdBlock('Berekening', `<strong>${k.orders}</strong> unieke ordernummers. ${gekoppeld} van de ${ondOrders.size} onderhoud-orders zijn ook terug te vinden in de weekplanning (koppeling via het ordernummer).`);
    tableTitle = 'Duurste werkorders';
    table = kdTable(['Order', 'Omschrijving', 'Kosten'],
      costPerOrder(e, state.orderMap, 5).map(o => [`<span style="font-family:monospace;font-size:12px">${esc(o.order)}</span>`, esc(o.omschrijving || o.installatie || '—'), fmt(o.bedrag)]));

  } else if (id === 'facturen') {
    const kob2 = e.filter(x => x.bron === 'KOB2' && x.factuur_nr);
    const top = [...kob2].sort((a, b) => (Number(b.bedrag_eur) || 0) - (Number(a.bedrag_eur) || 0)).slice(0, 5);
    blocks =
      kdBlock('Wat is dit?', 'Het aantal open verplichtingen met een factuur-/referentienummer — posten die binnenkort tot een echte factuur leiden.') +
      kdBlock('Waar komt het vandaan?', `Tabblad <strong>IJ_KOB2</strong>: van de open posten hebben er ${kob2.length} een referentienummer.`) +
      kdBlock('Berekening', `<strong>${k.facturen}</strong> unieke factuur-/referentienummers in het open obligo.`);
    tableTitle = 'Grootste open posten';
    table = kdTable(['Leverancier', 'Referentie', 'Bedrag'],
      top.map(x => [esc(x.leverancier || '—'), `<span style="font-family:monospace;font-size:12px">${esc(x.factuur_nr)}</span>`, fmt(x.bedrag_eur)]));

  } else if (id === 'budgetOp' || id === 'budgetFc' || id === 'budgetActYtd' || id === 'overschrijding') {
    const lines = (state.budget || []).filter(b => b.niveau === 'line');
    const bronBlok = kdBlock('Waar komt het vandaan?', `De kopregel <strong>"Total variable + fixed costs"</strong> op tabblad <strong>IJ_Maint_Costs</strong>. Bedragen staan daar in k€ en worden ×1000 omgerekend naar euro's.`);
    const overzicht = kdTable(['Kopregel Maint_Costs', 'Bedrag'], [
      ['Budget (OP, heel jaar)', fmt(k.budgetOp)],
      ['Forecast (FC, heel jaar)', fmt(k.budgetFc)],
      ['Werkelijk t/m nu (Act YTD)', fmt(k.budgetActYtd)],
      ['Gepland t/m nu (Plan YTD)', fmt(k.budgetPlanYtd)]
    ]);
    if (id === 'budgetOp') {
      blocks = kdBlock('Wat is dit?', 'Het vooraf vastgestelde jaarbudget (Operating Plan) voor onderhoud: hiermee moet het hele jaar worden gedaan.') + bronBlok +
        kdBlock('Berekening', `Rechtstreeks overgenomen uit de export (geen eigen optelling): <strong>${fmt(k.budgetOp)}</strong>.`);
      tableTitle = 'Grootste budgetposten (per kostencategorie) — klik voor specificatie';
      const topOp = [...lines].sort((a, b) => (b.op_eur || 0) - (a.op_eur || 0)).slice(0, 5);
      table = kdTable(['Kostencategorie', 'Budget (OP)'],
        topOp.map(l => [esc(l.categorie), fmt(l.op_eur)]), topOp.map(kdCatDetail)) + overzicht;
    } else if (id === 'budgetFc') {
      const d = (k.budgetFc != null && k.budgetOp != null) ? k.budgetFc - k.budgetOp : null;
      blocks = kdBlock('Wat is dit?', 'De geactualiseerde verwachting van de totale jaarkosten (forecast), op basis van wat er nu bekend is — de eigen inschatting van waar het jaar landt.') + bronBlok +
        kdBlock('Berekening', `Rechtstreeks uit de export: <strong>${fmt(k.budgetFc)}</strong>${d != null ? ` — dat is ${fmt(Math.abs(d))} ${d <= 0 ? 'ónder' : 'bóven' } het jaarbudget` : ''}.`);
      tableTitle = 'Grootste posten in de forecast — klik voor specificatie';
      const topFc = [...lines].sort((a, b) => (b.fc_eur || 0) - (a.fc_eur || 0)).slice(0, 5);
      table = kdTable(['Kostencategorie', 'Forecast (FC)'],
        topFc.map(l => [esc(l.categorie), fmt(l.fc_eur)]), topFc.map(kdCatDetail)) + overzicht;
    } else if (id === 'budgetActYtd') {
      const d = (k.budgetActYtd != null && k.budgetPlanYtd != null) ? k.budgetActYtd - k.budgetPlanYtd : null;
      blocks = kdBlock('Wat is dit?', 'Hoeveel er tot en met de peilmaand werkelijk is uitgegeven, vergeleken met wat er voor diezelfde periode gepland stond.') + bronBlok +
        kdBlock('Berekening', `Werkelijk ${fmt(k.budgetActYtd)} − plan ${fmt(k.budgetPlanYtd)} = <strong>${d != null ? fmt(Math.abs(d)) + (d > 0 ? ' bóven' : ' ónder') + ' plan' : '—'}</strong>.`);
      tableTitle = 'Grootste afwijkingen t.o.v. plan (per categorie) — klik voor specificatie';
      const afw = lines.filter(l => l.act_ytd_eur != null && l.plan_ytd_eur != null)
        .map(l => ({ cat: l.categorie, act: l.act_ytd_eur, plan: l.plan_ytd_eur, diff: l.act_ytd_eur - l.plan_ytd_eur, line: l }))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
      table = kdTable(['Kostencategorie', 'Werkelijk', 'Plan', 'Verschil'],
        afw.map(l => [esc(l.cat), fmt(l.act), fmt(l.plan),
          l.diff > 0 ? `<span class="fin-over">+${fmt(l.diff)}</span>` : `<span class="fin-under">−${fmt(-l.diff)}</span>`]),
        afw.map(l => kdCatDetail(l.line))) + overzicht;
    } else {
      // overschrijding: werkelijke uitgave (YTD) t.o.v. het plan voor diezelfde
      // periode — dezelfde vraag als de kernzin op de Budgetstatus-kaart, NIET
      // forecast t.o.v. jaarbudget (budgetFc hierboven): die twee kunnen
      // tegengesteld uitpakken, zie overschrijdingBedrag() hierboven.
      const d = overschrijdingBedrag(k);
      blocks = kdBlock('Wat is dit?', 'Hoeveel de werkelijke uitgave tot en met de peilmaand nu al boven (of onder) het geplande bedrag voor diezelfde periode ligt — dezelfde berekening als de kernzin bovenaan de Budgetstatus-kaart.') +
        kdBlock('Waar komt het vandaan?', `Werkelijk = som van de onderhoudsregels op tabbladen <strong>IJ_CCTR</strong> en <strong>IJ_KOB1</strong>. Plan (YTD) = kopregel <strong>"Total variable + fixed costs"</strong> op tabblad <strong>IJ_Maint_Costs</strong>, kolom "PL YTD".`) +
        kdBlock('Berekening', d != null
          ? `Werkelijk ${fmt(k.actual)} − plan (YTD) ${fmt(k.budgetPlanYtd)} = <strong>${fmt(Math.abs(d))} ${d > 0 ? 'bóven' : 'ónder'} planning</strong>.`
          : 'Geen werkelijke uitgave of YTD-plan in deze export beschikbaar.');
      tableTitle = 'Grootste bijdragers aan de afwijking (YTD, per kostencategorie) — klik voor specificatie';
      const afwFc = lines.filter(l => l.act_ytd_eur != null && l.plan_ytd_eur != null)
        .map(l => ({ cat: l.categorie, act: l.act_ytd_eur, plan: l.plan_ytd_eur, diff: l.act_ytd_eur - l.plan_ytd_eur, line: l }))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
      table = kdTable(['Kostencategorie', 'Werkelijk (YTD)', 'Plan (YTD)', 'Verschil'],
        afwFc.map(l => [esc(l.cat), fmt(l.act), fmt(l.plan),
          l.diff > 0 ? `<span class="fin-over">+${fmt(l.diff)}</span>` : `<span class="fin-under">−${fmt(-l.diff)}</span>`]),
        afwFc.map(l => kdCatDetail(l.line))) + overzicht;
    }

  } else if (id === 'projActual') {
    const alle = state.projects || [];
    const proj = rbmOpProjects(alle);
    const rest = alle.length - proj.length;
    blocks =
      kdBlock('Wat is dit?', 'Projectmatig onderhoud (RBM/CAPEX): grotere, vooraf geplande projecten met een eigen plan en realisatie per project.') +
      kdBlock('Waar komt het vandaan?', `Het RBM-tabblad: ${proj.length} projecten uit het vastgestelde <strong>Operating Plan</strong>-blok tellen mee in dit cijfer${rest > 0 ? `; de ${rest} overige projecten (geïdentificeerd/onvoorzien/uitgesteld) staan in de RBM-tabel op het Analyse-tabblad` : ''}. Bedragen in k€, ×1000 omgerekend.`) +
      kdBlock('Berekening', `Som van de realisatie over de OP-projecten = <strong>${fmt(k.projActual)}</strong>, tegenover ${fmt(k.projPlan)} gepland.`);
    tableTitle = 'Grootste projecten (plan vs. realisatie, Operating Plan)';
    table = kdTable(['Project', 'Plan', 'Realisatie'],
      [...proj].sort((a, b) => (b.plan_eur || 0) - (a.plan_eur || 0)).slice(0, 5).map(p => [esc(p.naam), fmt(p.plan_eur), fmt(p.actual_eur)]));

  } else if (id === 'rbmBlokken') {
    const alle = state.projects || [];
    const blokVan = p => (p.blok || 'op');
    const perBlok = blok => alle.filter(p => p && blokVan(p) === blok);
    const som = list2 => list2.reduce((a, p) => a + (Number(p.plan_eur) || 0), 0);
    const somActual = list2 => list2.reduce((a, p) => a + (Number(p.actual_eur) || 0), 0);
    const op = perBlok('op'), ident = perBlok('identified'), onv = perBlok('unforeseen');
    // Uploads van vóór parser 2.2.0 bevatten alléén het OP-blok (de blokken
    // geïdentificeerd/onvoorzien werden toen niet geparsed) — dan staan
    // hier nullen terwijl het RBM-tabblad wél data heeft. Expliciet
    // benoemen mét de oplossing i.p.v. stilletjes 0× tonen (gemeld als
    // bug: bleek een verouderde opgeslagen upload, geen parsefout — de
    // huidige parser vindt op hetzelfde bestand alle blokken).
    const parserVer = (state.upload && state.upload.raw && state.upload.raw.parserVersion) || null;
    const oudeUploadNote = (ident.length === 0 && onv.length === 0 && alle.length > 0)
      ? kdBlock('⚠ Let op — mogelijk verouderde upload', `Deze cijfers komen uit een upload${parserVer ? ` van parser ${esc(parserVer)}` : ' die vermoedelijk met een oudere parser is gemaakt'}; oudere parsers lazen alleen het goedgekeurde blok. Staat er in het RBM-tabblad wél data onder Geïdentificeerd/Onvoorzien? Upload de MIP-export dan opnieuw (Financiën &rarr; Beheer — upload) — de huidige parser leest alle blokken.`)
      : '';
    // Minder proza, meer tabel: elk project heeft zijn eigen ordernummer,
    // plan én realisatie — dat is per rij duidelijker dan blok-brede sommen
    // in tekst. De tabel eronder is daarom de VOLLEDIGE, sorteerbare/
    // filterbare RBM-tabel (renderRbmTable, ook gebruikt op het Analyse-
    // tabblad) i.p.v. een aparte top-8-op-plan lijst — die kon toevallig
    // alleen projecten zonder realisatie tonen terwijl het totaal wél
    // ingeboekt geld bevatte, wat verwarrend was.
    blocks =
      kdBlock('Wat is dit?', `De ${alle.length} RBM-projecten uit het RBM-tabblad, per blok. Alleen <strong>Goedgekeurd</strong> (het Operating Plan) is vastgesteld budget; <strong>Geïdentificeerd</strong> en <strong>Onvoorzien</strong> zijn kandidaten die er (nog) niet in zitten — maar wel al een eigen ordernummer en realisatie kunnen hebben, zie de tabel eronder.`) +
      kdBlock('Al ingeboekt', `Goedgekeurd: <strong>${fmt(somActual(op))}</strong> van ${fmt(som(op))} plan (${som(op) ? Math.round(somActual(op) / som(op) * 100) : 0}%). Geïdentificeerd: <strong>${fmt(somActual(ident))}</strong>. Onvoorzien: <strong>${fmt(somActual(onv))}</strong>.`) +
      (() => {
        // Dubbeltellingsrisico: hetzelfde SAP-ordernummer kan zowel als
        // RBM-project als als CCTR/KOB1-kostenregel voorkomen — dan is het
        // dezelfde boeking, geen extra uitgave. Puur signalerend, past geen
        // enkele KPI-som aan.
        const overlap = rbmOrderOverlap(alle, e);
        if (!overlap.count) return '';
        return kdBlock('⚠ Overlap met Actuele kosten', `<strong>${fmt(overlap.som)}</strong> (${overlap.count}×) van het ingeboekte bedrag staat óók als kostenregel in CCTR/KOB1 — dezelfde boeking, niet los optellen bij "Actuele kosten".`);
      })() +
      oudeUploadNote;
    // `table` is hier bewust een lege container, geen kdTable-HTML: de
    // inhoud is interactief (sorteren/filteren, eigen event-listeners) en
    // wordt pas gevuld ná het invoegen in de DOM, door renderRbmTable
    // aan te roepen vanuit de click-handler in renderKpis.
    table = '<div id="finKdRbmTable"></div>';
    tableTitle = 'Alle projecten — sorteerbaar, filterbaar per blok';

  } else {
    blocks = kdBlock('Wat is dit?', esc(def.tip || 'Geen uitleg beschikbaar.'));
  }

  return `<div class="fin-kd" style="--kpi:${def.accent || 'var(--color-primary)'}">
    <div class="fin-kd-head">
      <div class="fin-kd-title">${esc(def.label || id)} — ${kpiValue(id, k)}</div>
      <button type="button" class="btn fin-kd-close">Sluiten ✕</button>
    </div>
    <div class="fin-kd-grid">${blocks}</div>
    ${table ? `<div class="fin-kd-tt">${esc(tableTitle)}</div>${table}` : ''}
  </div>`;
}

// ── RBM-projectentabel: sorteerbaar, met inline progress bars ───────
// Toont sinds parser 2.2.0 ALLE blokken uit het RBM-tabblad (Operating
// Plan / geïdentificeerd / onvoorzien / uitgesteld), filterbaar per blok.
// Voortgang = realisatie t.o.v. plan; variantie > 0 = nog ruimte,
// < 0 = overschrijding van het projectplan. Alleen het OP-blok telt mee
// in de KPI's — deze tabel is de plek waar de rest zichtbaar is.
let _rbmSort = { key: 'variance_eur', dir: 1 };
let _rbmBlok = 'alle';
function renderRbmTable(el, projects) {
  if (!el) return;
  const alle = (projects || []).filter(p => p && p.naam);
  if (!alle.length) { el.innerHTML = '<div class="fin-note">Geen RBM-projecten in deze export.</div>'; return; }
  const blokVan = p => p.blok || 'op';                    // oude uploads: alles OP
  const blokken = [...new Set(alle.map(blokVan))];
  const list = _rbmBlok === 'alle' ? alle : alle.filter(p => blokVan(p) === _rbmBlok);
  const { key, dir } = _rbmSort;
  const sorted = [...list].sort((a, b) => {
    const va = key === 'naam' || key === 'blok' ? String(key === 'blok' ? blokVan(a) : a.naam || '') : (Number(a[key]) || 0);
    const vb = key === 'naam' || key === 'blok' ? String(key === 'blok' ? blokVan(b) : b.naam || '') : (Number(b[key]) || 0);
    return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
  });
  const arrow = k => key === k ? (dir === 1 ? ' ▲' : ' ▼') : '';
  const th = (k, label, right) => `<th data-sort="${k}" style="cursor:pointer;user-select:none;white-space:nowrap${right ? ';text-align:right' : ''}">${label}${arrow(k)}</th>`;
  const blokBadge = p => {
    const b = blokVan(p);
    const kleur = { op: 'var(--color-primary)', identified: '#388bfd', unforeseen: '#d29922', postponed: 'var(--color-text-muted)' }[b] || 'var(--color-text-secondary)';
    return `<span style="font-size:11px;font-weight:600;color:${kleur}">${esc(RBM_BLOK_LABELS[b] || b)}</span>`;
  };
  // Blokfilter alleen tonen als er meer dan één blok in de data zit.
  const filterHtml = blokken.length > 1
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${['alle', ...blokken].map(b => `<button type="button" class="btn${_rbmBlok === b ? ' active' : ''}" data-blok="${b}" style="font-size:12px;padding:5px 12px">${b === 'alle' ? `Alle (${alle.length})` : `${esc(RBM_BLOK_LABELS[b] || b)} (${alle.filter(p => blokVan(p) === b).length})`}</button>`).join('')}
      </div>`
    : '';
  const rows = sorted.map(p => {
    const plan = Number(p.plan_eur) || 0, act = Number(p.actual_eur) || 0;
    const pct = plan > 0 ? Math.min(100, Math.round(act / plan * 100)) : (act > 0 ? 100 : 0);
    const over = plan > 0 && act > plan;
    const varc = p.variance_eur != null ? p.variance_eur : plan - act;
    return `<tr>
      <td>${esc(p.naam)}</td>
      <td>${blokBadge(p)}</td>
      <td style="font-family:monospace;font-size:12px">${esc(p.order_nr || '—')}</td>
      <td style="text-align:right">${fmt(plan)}</td>
      <td style="text-align:right">${fmt(act)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;min-width:120px">
        <div style="flex:1;height:6px;background:var(--color-secondary);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${over ? '#f85149' : '#2ea043'};transition:width .2s ease"></div></div>
        <span style="font-size:11px;color:var(--color-text-secondary);min-width:34px;text-align:right">${pct}%</span>
      </div></td>
      <td style="text-align:right">${varc < 0 ? `<span class="fin-over">−${fmt(-varc)}</span>` : `<span class="fin-under">${fmt(varc)}</span>`}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `${filterHtml}<div class="tw keep-table"><table class="fin-tbl"><thead><tr>
    ${th('naam', 'Project')}${th('blok', 'Blok')}${th('order_nr', 'Order')}${th('plan_eur', 'Plan', true)}${th('actual_eur', 'Realisatie', true)}<th>Voortgang</th>${th('variance_eur', 'Variantie', true)}
  </tr></thead><tbody>${rows}</tbody></table></div>`;
  el.querySelectorAll('th[data-sort]').forEach(h => h.addEventListener('click', () => {
    const k = h.dataset.sort;
    _rbmSort = { key: k, dir: _rbmSort.key === k ? -_rbmSort.dir : 1 };
    renderRbmTable(el, projects);
  }));
  el.querySelectorAll('button[data-blok]').forEach(b => b.addEventListener('click', () => {
    _rbmBlok = b.dataset.blok;
    renderRbmTable(el, projects);
  }));
}

// Analyse-tab: alles hier reageert op de filters (en alléén dit tabblad).
function renderAnalyseTab(container, state) {
  const filtered = applyFilters(state.entries, state.filters);

  const tbl = (rows, labelHead, labelFn) => rows.length
    ? `<table class="fin-tbl"><thead><tr><th>${labelHead}</th><th style="text-align:right">Bedrag</th></tr></thead><tbody>${rows.map(r => `<tr><td>${labelFn ? labelFn(r.key) : esc(r.key)}</td><td style="text-align:right">${fmt(r.bedrag)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="fin-note">Geen data voor deze filter.</div>';

  const actueel = filtered.filter(e => ACTUAL_BRON.includes(e.bron) || e.bron === 'personeel');
  container.querySelector('#finTblSoort').innerHTML = tbl(groupSum(actueel, 'kostensoort').slice(0, 15), 'Kostensoort', key => kostensoortLabel(actueel, key));
  container.querySelector('#finTblInst').innerHTML = tbl(groupSum(actueel.filter(e => e.installatie), 'installatie').slice(0, 10), 'Installatie');
  const ccEl = container.querySelector('#finTblCC');
  if (ccEl) ccEl.innerHTML = tbl(groupSum(actueel.filter(e => e.kostenplaats), 'kostenplaats').slice(0, 10), 'Kostenplaats', key => ccLabel(state, key));

  const linkEl = container.querySelector('#finLink');
  if (linkEl) renderLink(linkEl, filtered, state.orderMap);

  const chartsEl = container.querySelector('#finCharts');
  if (chartsEl) renderCharts(chartsEl, filtered, state.budget, state.projects);

  renderRbmTable(container.querySelector('#finRbmTable'), state.projects);
}
