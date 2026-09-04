// Financiën-upload (Fase 4, multi-plant): Excel kiezen -> parse per plant
// (financeParser) -> validatie + preview met KPI-samenvatting per plant ->
// bevestigen -> POST per plant naar /api/financeImport (server schrijft met
// audit + versiebeheer, en dwingt de rotterdam-permissie nogmaals af).
//
// Client-parse levert de preview én de payload; de server-side rechtencheck
// (finance-admin + rotterdam) blijft leidend voor het wegschrijven.

import { parseFinanceWorkbook, detectPlants } from './financeParser.js';
import { bronTotals, fmt, esc, MAAND, grandTotalBudget, rbmOpProjects, isoWeekOf, isOnderhoudActual } from './financeUtils.js';
import { allowedPlants, PLANT_NAMES } from '../permissions.js';

// Laatst geparste resultaten per plant, bewaard tussen preview en bevestigen.
let parsedPlants = null;   // [{plant, result}]
// Generatie-token: als de gebruiker een tweede bestand kiest vóór het inlezen
// van het eerste klaar is (twee overlappende async handleFile-aanroepen),
// mag alleen de LAATST gekozen file uiteindelijk parsedPlants/de preview
// bepalen — niet welke van de twee als eerste klaar is met inlezen.
let parseGeneration = 0;

export function renderUpload(container, ctx, onDone) {
  parsedPlants = null;
  const plants = allowedPlants(ctx && ctx.access);
  const scope = plants.includes('R')
    ? 'IJmuiden- en Rotterdam-tabbladen worden allebei verwerkt.'
    : 'Alleen het IJmuiden-deel wordt verwerkt — de rest wordt genegeerd.';
  container.innerHTML = `
    <div class="fin-card">
      <div class="fin-card-title">Financiële export uploaden</div>
      <div class="fin-uz" id="finUz">
        <div class="fin-uz-title">Klik om de MIP-export (.xlsm/.xlsx) te kiezen</div>
        <div class="fin-uz-sub">${scope}</div>
      </div>
      <input type="file" id="finFile" accept=".xlsx,.xlsm" style="display:none">
      <div id="finPreview"></div>
    </div>`;
  const uz = container.querySelector('#finUz');
  const input = container.querySelector('#finFile');
  uz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleFile(input, container, ctx, onDone));
}

async function handleFile(input, container, ctx, onDone) {
  const prev = container.querySelector('#finPreview');
  if (!input.files || !input.files.length) return;
  const file = input.files[0];
  const myGen = ++parseGeneration;
  prev.innerHTML = '<div class="fin-note">Bezig met inlezen…</div>';
  try {
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', blankrows: false }); });
    const inFile = detectPlants(sheets);
    const mag = allowedPlants(ctx && ctx.access);
    const plants = inFile.filter(p => mag.includes(p));
    if (myGen !== parseGeneration) return; // een later gekozen bestand is inmiddels leidend
    parsedPlants = plants.map(plant => {
      const result = parseFinanceWorkbook(sheets, { plant });
      result._bestandsnaam = file.name;
      return { plant, result };
    });
    parsedPlants._geweigerd = inFile.filter(p => !mag.includes(p));
    parsedPlants._sheetNames = wb.SheetNames;
    renderPreview(prev, ctx, onDone);
  } catch (e) {
    if (myGen !== parseGeneration) return;
    prev.innerHTML = `<div class="fin-note fin-err">Kon het bestand niet lezen: ${esc(e.message)}</div>`;
  } finally {
    input.value = '';
  }
}

function plantPreviewHtml(plant, r) {
  const diag = r.summary.bronnen || {};
  const totalen = bronTotals(r.entries);
  const amt = b => (totalen[b] ? totalen[b].totaal : 0);
  // Plan/actual-som alleen over het OP-blok; het regel-aantal toont wél alle
  // blokken (sinds parser 2.2.0 komen ook geïdentificeerd/onvoorzien mee).
  const opProj = rbmOpProjects(r.projects);
  const projPlan = opProj.reduce((a, p) => a + (Number(p.plan_eur) || 0), 0);
  const projActual = opProj.reduce((a, p) => a + (Number(p.actual_eur) || 0), 0);
  // Zelfde definitie als de live dashboard-KPI "Actuele kosten" (KPI_DEFS.actual
  // in financeDashboard.js: CCTR+KOB1, alléén onderhoud — verbruik/smeermiddelen
  // en personeel tellen daar niet in mee, personeel heeft een eigen KPI-kaart).
  // Deze preview toonde voorheen CCTR+KOB1(+verbruik)+personeel onder hetzelfde
  // label "Actuele kosten" — rekenkundig correct, maar een ander getal dan wat
  // je na het opslaan op het dashboard te zien kreeg, wat leek op een fout bij
  // het uploaden terwijl het gewoon twee verschillende definities waren.
  const onderhoudActual = r.entries.filter(isOnderhoudActual).reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
  const personeelActual = amt('personeel');
  const obligo = amt('KOB2');
  const budgetTotal = grandTotalBudget(r.budget);
  const kpi = (label, val, sub) => `<div class="fin-kpi"><div class="fin-kpi-l">${label}</div><div class="fin-kpi-v">${val}</div>${sub ? `<div class="fin-kpi-s">${sub}</div>` : ''}</div>`;
  const amountFor = b => b === 'RBM' ? projActual : b === 'Maint_Costs' ? null : (totalen[b] ? totalen[b].totaal : null);
  const bronRows = Object.entries(diag).map(([b, s]) =>
    `<tr><td>${esc(b)}</td><td style="text-align:right">${s.count != null ? s.count : '—'}</td><td style="text-align:right">${amountFor(b) != null ? fmt(amountFor(b)) : '—'}</td><td style="text-align:right;color:#8b949e">${s.overgeslagen ? s.overgeslagen + ' ovgsl.' : ''}${s.negatief ? ' · ' + s.negatief + ' neg.' : ''}${s.nul ? ' · ' + s.nul + ' nul' : ''}</td></tr>`
  ).join('');
  return `
    <div class="sl" style="margin-top:16px">${esc(PLANT_NAMES[plant] || plant)}</div>
    <div class="fin-kg">
      ${kpi('Kostenregels', r.entries.length, `${r.plant} · jaar ${r.jaar || '?'}`)}
      ${kpi('Actuele kosten', fmt(onderhoudActual), 'CCTR + KOB1 (onderhoud)')}
      ${kpi('Personeelskosten', fmt(personeelActual), 'apart, telt niet mee in Actuele kosten')}
      ${kpi('Open obligo', fmt(obligo), 'KOB2')}
      ${kpi('Projecten', r.projects.length, `${opProj.length} in OP · plan ${fmt(projPlan)}`)}
      ${kpi('Budget (OP)', fmt(budgetTotal.op_eur), `act YTD ${fmt(budgetTotal.act_ytd_eur)}`)}
    </div>
    <table class="fin-tbl"><thead><tr><th>Bron</th><th style="text-align:right">Regels</th><th style="text-align:right">Bedrag</th><th></th></tr></thead><tbody>${bronRows}</tbody></table>
    ${r.warnings.map(w => `<div class="fin-note fin-warn">⚠ ${esc(w)}</div>`).join('')}
    ${(r.validatie || []).length ? `<div class="fin-note fin-warn">⚠ ${r.validatie.length} regel(s) met onvolledige context (gelogd, niet verwijderd) — bv. ${esc(r.validatie[0])}</div>` : ''}
    ${r.errors.map(e => `<div class="fin-note fin-err">✕ ${esc(e)}</div>`).join('')}`;
}

function renderPreview(prev, ctx, onDone) {
  const list = parsedPlants || [];
  if (!list.length) {
    const geweigerd = (parsedPlants && parsedPlants._geweigerd) || [];
    const sheetNames = (parsedPlants && parsedPlants._sheetNames) || [];
    // Toon de werkelijk aangetroffen tabbladnamen erbij — zonder dat is
    // "geen herkende tabbladen" niet te onderscheiden van "verkeerd bestand
    // gekozen" (bv. de weekplanning-Excel i.p.v. de MIP-export) vs. een
    // echte naamgevingsafwijking in de export zelf.
    prev.innerHTML = geweigerd.length
      ? `<div class="fin-note fin-err">Dit bestand bevat alleen data voor ${geweigerd.map(p => PLANT_NAMES[p] || p).join(', ')}, waarvoor dit account geen toegang heeft.</div>`
      : `<div class="fin-note fin-err">Geen herkende plant-tabbladen (IJ_/R_, bv. IJ_CCTR, IJ_KOB1, IJ_Personeel, IJ_ RBM projects, IJ_Maint_Costs) gevonden in dit bestand.<br>Is dit de MIP-export? Aangetroffen tabbladen: ${sheetNames.length ? esc(sheetNames.join(', ')) : '(geen)'}.</div>`;
    return;
  }
  // Plants met parse-fouten worden uitgesloten van het opslaan, maar
  // blokkeren niet langer de rest: bij een gecombineerde IJ+R-upload waarbij
  // alleen Rotterdam een fout geeft, kan IJmuiden alsnog los worden
  // opgeslagen i.p.v. dat de hele batch vastzit tot beide plants foutloos zijn.
  const opslaanbaar = list.filter(x => x.result.errors.length === 0 && x.result.entries.length > 0);
  const uitgesloten = list.filter(x => !opslaanbaar.includes(x));
  const eerste = (opslaanbaar[0] || list[0]).result;
  const geweigerd = parsedPlants._geweigerd || [];

  prev.innerHTML = `
    ${list.map(x => plantPreviewHtml(x.plant, x.result)).join('')}
    ${geweigerd.length ? `<div class="fin-note">&#9432; Tabbladen voor ${geweigerd.map(p => PLANT_NAMES[p] || p).join(', ')} zijn genegeerd — geen toegang tot die plant.</div>` : ''}
    ${uitgesloten.length ? `<div class="fin-note fin-warn">&#9888; ${uitgesloten.map(x => esc(PLANT_NAMES[x.plant] || x.plant)).join(', ')} ${uitgesloten.length > 1 ? 'worden' : 'wordt'} niet opgeslagen door de fout(en) hierboven — los de fout op en upload opnieuw voor die plant.</div>` : ''}
    ${eerste.parserVersion ? `<div class="fin-sub">Parser ${esc(eerste.parserVersion)}</div>` : ''}
    <div class="fin-confirm-row">
      ${eerste.snapshotMaand
        ? `<div class="fin-lbl" id="finMaandDisplay">Peilmaand: <strong>${esc(MAAND[eerste.snapshotMaand])}</strong> (automatisch herkend uit de export)
             <button type="button" class="hm-config-btn" id="finMaandWijzig">wijzigen</button>
           </div>`
        : ''}
      <label class="fin-lbl" id="finMaandEditRow"${eerste.snapshotMaand ? ' style="display:none"' : ''}>${eerste.snapshotMaand ? '' : 'Snapshot-maand niet herkend in de export — kies handmatig:'}
        <select id="finMaand" class="fin-inp">
          ${MAAND.map((m, i) => i === 0 ? '' : `<option value="${i}"${i === eerste.snapshotMaand ? ' selected' : ''}>${i} — ${m}</option>`).join('')}
        </select>
        ${eerste.snapshotMaand ? `<button type="button" class="hm-config-btn" id="finMaandAnnuleer">annuleren</button>` : ''}
      </label>
      <button class="btn btn-p" id="finConfirm"${!opslaanbaar.length ? ' disabled' : ''}>Opslaan als nieuwe versie${opslaanbaar.length > 1 ? ` (${opslaanbaar.length} plants)` : ''}</button>
    </div>
    <div id="finResult"></div>`;

  const btn = prev.querySelector('#finConfirm');
  if (btn) btn.addEventListener('click', () => confirmUpload(prev, ctx, onDone));
  const wijzigBtn = prev.querySelector('#finMaandWijzig');
  if (wijzigBtn) wijzigBtn.addEventListener('click', () => {
    prev.querySelector('#finMaandDisplay').style.display = 'none';
    prev.querySelector('#finMaandEditRow').style.display = '';
  });
  const annuleerBtn = prev.querySelector('#finMaandAnnuleer');
  if (annuleerBtn) annuleerBtn.addEventListener('click', () => {
    const sel = prev.querySelector('#finMaand');
    if (sel) sel.value = String(eerste.snapshotMaand);
    prev.querySelector('#finMaandEditRow').style.display = 'none';
    prev.querySelector('#finMaandDisplay').style.display = '';
  });
}

async function confirmUpload(prev, ctx, onDone) {
  // Zelfde selectie als de preview: alleen plants zonder parse-fouten en met
  // data worden daadwerkelijk verstuurd.
  const list = (parsedPlants || []).filter(x => x.result.errors.length === 0 && x.result.entries.length > 0);
  const btn = prev.querySelector('#finConfirm');
  const resEl = prev.querySelector('#finResult');
  if (!list.length) return;
  const maand = Number(prev.querySelector('#finMaand')?.value) || list[0].result.snapshotMaand || null;
  // De MIP-export zelf is maand-gebaseerd, maar wordt in de praktijk
  // wekelijks opnieuw geüpload — het weeknummer van dít uploadmoment in het
  // label zetten voorkomt dat meerdere uploads binnen dezelfde maand
  // onderscheidbaar identiek in de versiegeschiedenis staan.
  const uploadWeek = isoWeekOf(new Date()).week;
  btn.disabled = true; btn.textContent = 'Opslaan…';
  const uitkomsten = [];
  for (const { plant, result: r } of list) {
    const payload = {
      plant, jaar: r.jaar, periode: maand,
      label: `${plant} — YTD ${maand ? MAAND[maand] + ' ' : ''}${r.jaar || ''} (wk ${uploadWeek})`.trim(),
      bestandsnaam: r._bestandsnaam,
      aantal_regels: r.entries.length,
      parser_version: r.parserVersion || null,
      recon: r.recon || null,
      entries: r.entries,
      raw: { projects: r.projects, budget: r.budget, summary: r.summary, snapshotMaand: maand, costCenters: r.costCenters || {} }
    };
    try {
      const resp = await fetch('/api/financeImport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (ctx.currentUser && ctx.currentUser.access_token) },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      // Deze route bestaat alleen als Vercel-serverless-functie — op de
      // GitHub Pages-spiegel (voor werklaptops waar vercel.app geblokkeerd
      // is, zie .github/workflows/pages-mirror.yml) draait geen backend,
      // dus een POST daar krijgt van de statische host zelf een kale 405
      // terug, nog vóór onze eigen method-check in api/financeImport.js
      // wordt bereikt. Zonder deze hint oogt dat als een willekeurige
      // serverfout i.p.v. "verkeerde omgeving" — zelfde hint als bij
      // gebruikersbeheer (legacy-app.js).
      if (resp.status === 405) throw new Error('Uploaden werkt alleen via sap-pm-dashboard.vercel.app (niet op de GitHub Pages-spiegel)');
      if (!resp.ok) throw new Error(data.error || `Serverfout ${resp.status}`);
      uitkomsten.push(`<div class="fin-note fin-ok">✓ ${esc(PLANT_NAMES[plant] || plant)}: versie met ${data.aantal_regels} regels opgeslagen (${MAAND[data.periode] || 'maand ?'} ${data.jaar}).</div>`);
    } catch (e) {
      uitkomsten.push(`<div class="fin-note fin-err">✕ ${esc(PLANT_NAMES[plant] || plant)}: opslaan mislukt — ${esc(e.message)}</div>`);
    }
    resEl.innerHTML = uitkomsten.join('');
  }
  const allesOk = uitkomsten.every(u => u.includes('fin-ok'));
  btn.textContent = allesOk ? 'Opgeslagen' : 'Opslaan als nieuwe versie';
  btn.disabled = allesOk;
  if (allesOk && typeof onDone === 'function') onDone();
}
