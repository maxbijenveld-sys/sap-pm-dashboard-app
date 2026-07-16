// Onderdelen & samenhang (Fase 10). Maakt expliciet uit welk MIP-tabblad elke
// bron komt, en toont hoe de bronnen zich tot elkaar verhouden:
//
//   CCTR + KOB1            = onderhoud werkelijk (YTD)
//   + KOB2 (obligo)        = totaal vastgelegd
//   vs. Maint_Costs OP/FC  = budget/forecast
//   Personeel              = apart spoor
//   RBM-projecten          = gekoppeld aan kostenregels via ordernummer
//   Werkorders             = gekoppeld aan de onderhoudsplanning (order_nr)
//
// De reken-functies (sourceStats/projectLinkStats) zijn puur en testbaar.

import { fmt, esc, isOnderhoudActual, isConsumableActual, grandTotalBudget } from './financeUtils.js';
import { GLOSSARY_BY_AFK } from './financeGlossary.js';

const num = x => Number(x) || 0;

export function sourceStats(entries, budget, projects) {
  const perBron = {};
  let consumables = 0;
  for (const e of (entries || [])) {
    const b = e.bron || '—';
    (perBron[b] = perBron[b] || { total: 0, count: 0 });
    perBron[b].total += num(e.bedrag_eur);
    perBron[b].count++;
    if (isConsumableActual(e)) consumables += num(e.bedrag_eur);
  }
  const g = b => perBron[b] || { total: 0, count: 0 };
  const grand = grandTotalBudget(budget);
  const cctr = g('CCTR'), kob1 = g('KOB1'), kob2 = g('KOB2'), pers = g('personeel');
  // Onderhoud werkelijk (repair) = de CCTR+KOB1-tabbladen minus verbruik
  // (smeermiddelen), zodat dit exact aansluit op Maint_Costs Act YTD.
  const actueel = cctr.total + kob1.total - consumables;
  return {
    cctr, kob1, kob2, pers, consumables,
    actueel, obligo: kob2.total, vastgelegd: actueel + kob2.total,
    budgetOp: grand.op_eur ?? null, budgetFc: grand.fc_eur ?? null,
    actYtd: grand.act_ytd_eur ?? null, planYtd: grand.plan_ytd_eur ?? null,
    projActual: (projects || []).reduce((a, p) => a + num(p.actual_eur), 0),
    projPlan: (projects || []).reduce((a, p) => a + num(p.plan_eur), 0),
    projCount: (projects || []).length,
    budgetLines: (budget || []).filter(b => b.niveau === 'line').length
  };
}

// Koppeling RBM-project -> kostenregels via het ordernummer.
export function projectLinkStats(entries, projects) {
  const orderTotals = {};
  for (const e of (entries || [])) {
    if (!isOnderhoudActual(e) || !e.order_nr) continue;
    orderTotals[e.order_nr] = (orderTotals[e.order_nr] || 0) + num(e.bedrag_eur);
  }
  let gekoppeld = 0, gekoppeldBedrag = 0;
  for (const p of (projects || [])) {
    if (p.order_nr && orderTotals[p.order_nr] != null) { gekoppeld++; gekoppeldBedrag += orderTotals[p.order_nr]; }
  }
  return { gekoppeld, gekoppeldBedrag, totaal: (projects || []).length };
}

// Aantal finance-orders dat aan de onderhoudsplanning is gekoppeld.
function maintenanceLinkCount(entries, orderMap) {
  const orders = new Set();
  for (const e of (entries || [])) {
    if (isOnderhoudActual(e) && e.order_nr) orders.add(e.order_nr);
  }
  let gekoppeld = 0;
  orders.forEach(o => { if ((orderMap || {})[o]) gekoppeld++; });
  return { gekoppeld, totaal: orders.size };
}

const tip = afk => {
  const it = GLOSSARY_BY_AFK[afk.toLowerCase()];
  return it ? `${it.term} — ${it.uit}` : '';
};
function infoI(afk) {
  const t = tip(afk);
  return t ? `<span class="info-i" data-tip="${esc(t)}">i</span>` : '';
}

function srcCard(tab, naam, wat, val, valLabel, extra, kleur, afk) {
  return `<div class="fin-src-card" style="--src:${kleur}">
    ${infoI(afk)}
    <div class="fin-src-tab">${esc(tab)}</div>
    <div class="fin-src-naam">${esc(naam)}</div>
    <div class="fin-src-val">${val == null ? '—' : fmt(val)}${valLabel ? ` <span class="fin-src-vl">${esc(valLabel)}</span>` : ''}</div>
    <div class="fin-src-sub">${esc(extra)} · ${esc(wat)}</div>
  </div>`;
}

function node(label, val, accent) {
  return `<div class="fin-flow-node${accent ? ' accent' : ''}">
    <div class="fin-flow-l">${esc(label)}</div>
    <div class="fin-flow-v">${val == null ? '—' : fmt(val)}</div>
  </div>`;
}
const op = sym => `<div class="fin-flow-op">${sym}</div>`;

export function renderSources(el, { entries, budget, projects, orderMap }) {
  if (!el) return;
  const s = sourceStats(entries, budget, projects);
  const pl = projectLinkStats(entries, projects);
  const ml = maintenanceLinkCount(entries, orderMap);

  // Reconciliatie: detail (CCTR+KOB1) versus de Maint_Costs-kopregel.
  const recoDiff = (s.actYtd != null) ? s.actueel - s.actYtd : null;
  const recoOk = recoDiff != null && Math.abs(recoDiff) < Math.max(1, Math.abs(s.actYtd) * 0.005);
  const vrijOp = (s.budgetOp != null) ? s.budgetOp - s.vastgelegd : null;

  const cards = [
    srcCard('IJ_Maint_Costs', 'Budget & forecast', 'OP/FC vs. werkelijk en plan', s.budgetOp, 'OP', `${s.budgetLines} regels`, '#388bfd', 'Maint_Costs'),
    srcCard('IJ_CCTR', 'Kostenplaats-kosten', 'werkelijke kosten op kostenplaatsen', s.cctr.total, '', `${s.cctr.count} regels`, '#2ea043', 'CCTR'),
    srcCard('IJ_KOB1', 'Werkorder-kosten', 'werkelijke kosten op onderhoudsorders', s.kob1.total, '', `${s.kob1.count} regels`, '#2ea043', 'KOB1'),
    srcCard('IJ_KOB2', 'Open obligo', 'vastgelegde, nog niet gefactureerde kosten', s.kob2.total, '', `${s.kob2.count} regels`, '#d29922', 'KOB2'),
    srcCard('IJ_Personeel', 'Personeelskosten', 'loonkosten: vast, overwerk, inhuur', s.pers.total, '', `${s.pers.count} regels`, '#8b5cf6', 'Personeel'),
    srcCard('IJ_RBM', 'RBM-projecten', 'projectmatig onderhoud: plan vs. actual', s.projActual, 'actual', `${s.projCount} projecten`, '#06b6d4', 'RBM')
  ].join('');

  el.innerHTML = `
    <div class="fin-src-intro">Elke bron komt uit een eigen tabblad van de MIP-export. Hieronder per tabblad wat het bevat, en daaronder hoe ze samenhangen.</div>
    <div class="fin-src-grid">${cards}</div>

    <div class="fin-flow-title">Zo hangen de bronnen samen</div>
    <div class="fin-flow">
      ${node('CCTR', s.cctr.total)} ${op('+')}
      ${node('KOB1', s.kob1.total)} ${op('−')}
      ${node('Verbruik (smeerm.)', s.consumables)} ${op('=')}
      ${node('Onderhoud werkelijk', s.actueel, true)} ${op('+')}
      ${node('KOB2 obligo', s.obligo)} ${op('=')}
      ${node('Totaal vastgelegd', s.vastgelegd, true)}
    </div>

    <div class="fin-reco">
      <div class="fin-reco-row">
        <span class="fin-reco-dot" style="background:#2ea043"></span>
        <span class="fin-reco-t"><strong>Controle CCTR+KOB1 ↔ Maint_Costs.</strong>
        De CCTR- en KOB1-tabbladen bevatten samen ${fmt(s.cctr.total + s.kob1.total)}, waarvan
        <strong>${fmt(s.consumables)}</strong> verbruik (smeermiddelen) buiten onderhoud valt.
        Onderhoud werkelijk is daarmee <strong>${fmt(s.actueel)}</strong>;
        volgens het budgettabblad (Actual YTD) is dat <strong>${s.actYtd == null ? '—' : fmt(s.actYtd)}</strong>.
        ${s.actYtd == null ? '' : recoOk
          ? '<span class="fin-ok-txt">Deze sluiten aan.</span>'
          : `<span class="fin-warn-txt">Verschil van ${fmt(recoDiff)} — controleer welke boekingen ontbreken of dubbel staan.</span>`}</span>
      </div>
      <div class="fin-reco-row">
        <span class="fin-reco-dot" style="background:#388bfd"></span>
        <span class="fin-reco-t"><strong>Vastgelegd t.o.v. budget.</strong>
        Totaal vastgelegd (werkelijk + obligo) is <strong>${fmt(s.vastgelegd)}</strong>.
        ${s.budgetOp == null ? 'Geen jaarbudget (OP) beschikbaar.' :
          `Van het OP-jaarbudget (${fmt(s.budgetOp)}) is daarmee nog
           <strong>${fmt(vrijOp)}</strong> ${vrijOp >= 0 ? 'vrij' : 'óver budget'}.`}
        ${s.budgetFc == null ? '' : ` Forecast (FC): ${fmt(s.budgetFc)}.`}</span>
      </div>
      <div class="fin-reco-row">
        <span class="fin-reco-dot" style="background:#8b5cf6"></span>
        <span class="fin-reco-t"><strong>Personeel loopt apart.</strong>
        Personeelskosten (<strong>${fmt(s.pers.total)}</strong>) zitten niet in de onderhoud-actual, maar tellen wel mee in het totale kostenbeeld.</span>
      </div>
      <div class="fin-reco-row">
        <span class="fin-reco-dot" style="background:#06b6d4"></span>
        <span class="fin-reco-t"><strong>RBM-projecten ↔ kostenregels.</strong>
        ${pl.totaal === 0 ? 'Geen RBM-projecten in deze export.' :
          `${pl.gekoppeld} van de ${pl.totaal} projecten zijn via hun ordernummer terug te vinden in de kostenregels
           (${fmt(pl.gekoppeldBedrag)} werkelijk geboekt).`}</span>
      </div>
      <div class="fin-reco-row">
        <span class="fin-reco-dot" style="background:#d29922"></span>
        <span class="fin-reco-t"><strong>Werkorders ↔ onderhoudsplanning.</strong>
        ${ml.totaal === 0 ? 'Geen werkorders met kosten.' :
          `${ml.gekoppeld} van de ${ml.totaal} werkorders met kosten zijn gekoppeld aan de onderhoudsplanning — zie “Onderhoud × Financiën” verderop.`}</span>
      </div>
    </div>`;
}
