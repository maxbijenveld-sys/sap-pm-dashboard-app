// Begrippen & afkortingen (Fase 10): een doorzoekbaar paneel dat het SAP-/
// finance-vakjargon uit dit dashboard uitlegt. Puur data + render, geen state.
//
// GLOSSARY is ook door andere modules te hergebruiken (bv. als bron voor
// tooltips op de bron-kaarten).

import { esc } from './financeUtils.js';

export const GLOSSARY = [
  { groep: 'SAP-bronnen (Excel-tabbladen)', items: [
    { afk: 'CCTR', term: 'Cost Center report', uit: 'SAP-rapport met de werkelijke kosten die op kostenplaatsen zijn geboekt (tabblad IJ_CCTR).' },
    { afk: 'KOB1', term: 'Order-actuals', uit: 'SAP-rapport met de werkelijke kosten per (onderhouds)order (tabblad IJ_KOB1).' },
    { afk: 'KOB2', term: 'Order-commitments', uit: 'SAP-rapport met het open obligo per order, inclusief leverancier en factuurnummer (tabblad IJ_KOB2).' },
    { afk: 'RBM', term: 'Risk Based Maintenance', uit: 'Projectmatig, op risico gebaseerd onderhoud. Plan versus actual per project (tabblad IJ_RBM).' },
    { afk: 'Maint_Costs', term: 'Maintenance Costs', uit: 'Het overkoepelende budgettabblad: OP/FC versus werkelijk en plan (tabblad IJ_Maint_Costs).' }
  ] },
  { groep: 'Budget & prognose', items: [
    { afk: 'OP', term: 'Operating Plan', uit: 'Het vooraf vastgestelde jaarbudget.' },
    { afk: 'FC', term: 'Forecast', uit: 'De geactualiseerde schatting van de jaarkosten op basis van de huidige stand.' },
    { afk: 'YTD', term: 'Year To Date', uit: 'Cumulatief vanaf 1 januari tot en met de snapshot-maand.' },
    { afk: 'Plan (YTD)', term: 'Plan tot en met nu', uit: 'Het deel van het jaarbudget dat tot en met de huidige maand gepland stond.' },
    { afk: 'Actual', term: 'Werkelijk', uit: 'De daadwerkelijk geboekte kosten.' },
    { afk: 'Variance', term: 'Verschil', uit: 'De afwijking tussen plan en actual (of tussen FC en OP).' },
    { afk: 'Obligo', term: 'Verplichting', uit: 'Vastgelegde maar nog niet gefactureerde kosten — een openstaande bestelling/verplichting.' },
    { afk: 'CAPEX', term: 'Capital Expenditure', uit: 'Investeringen die geactiveerd worden, tegenover OPEX (lopende kosten).' }
  ] },
  { groep: 'Onderhoud', items: [
    { afk: 'PM01', term: 'Correctief onderhoud', uit: 'Ongepland onderhoud: storingen en reparaties.' },
    { afk: 'PM02', term: 'Gepland onderhoud', uit: 'Grotere, geplande werkzaamheden zoals revisies — vaak gekoppeld aan een RBM-project. Gemiddeld bedrag per order ligt hoger dan bij PM01/PM03.' },
    { afk: 'PM03', term: 'Preventief onderhoud', uit: 'Periodiek, routinematig onderhoud: inspecties, smeren, kalibraties en het vervangen van filters.' },
    { afk: 'WO', term: 'Werkorder', uit: 'Het ordernummer waarop onderhoud én kosten worden geboekt; koppelt de financiën aan de onderhoudsplanning.' },
    { afk: 'FL', term: 'Functional Location', uit: 'SAP functionele locatie: de installatie-/objecthiërarchie.' },
    { afk: 'Kostensoort', term: 'Cost Element', uit: 'De SAP-categorie van een kostenpost (bijvoorbeeld materiaal of diensten).' }
  ] },
  { groep: 'Algemeen', items: [
    { afk: 'IJ', term: 'IJmuiden', uit: 'De plant/vestiging waarop dit dashboard betrekking heeft.' },
    { afk: 'Snapshot-maand', term: 'Peilmaand', uit: 'De maand tot en met welke de export de YTD-standen weergeeft.' },
    { afk: 'MIP', term: 'MIP-export', uit: 'Het bron-Excelbestand (.xlsm) waaruit dit dashboard wordt gevuld.' }
  ] }
];

// Losse index (afkorting -> uitleg) voor tooltips elders.
export const GLOSSARY_BY_AFK = GLOSSARY.reduce((m, g) => {
  g.items.forEach(it => { m[it.afk.toLowerCase()] = it; });
  return m;
}, {});

function groupsHtml(groups) {
  return groups.map(g => `<div class="fin-gloss-groep">
    <div class="fin-gloss-gt">${esc(g.groep)}</div>
    <div class="fin-gloss-grid">${g.items.map(it => `
      <div class="fin-gloss-item">
        <span class="fin-gloss-afk">${esc(it.afk)}</span>
        <div class="fin-gloss-txt">
          <div class="fin-gloss-term">${esc(it.term)}</div>
          <div class="fin-gloss-uit">${esc(it.uit)}</div>
        </div>
      </div>`).join('')}</div>
  </div>`).join('');
}

export function renderGlossary(el) {
  if (!el) return;
  el.innerHTML = `<div class="fin-gloss">
    <input type="text" class="fin-inp fin-gloss-search" placeholder="Zoek een term of afkorting…" aria-label="Zoek begrip">
    <div class="fin-gloss-body">${groupsHtml(GLOSSARY)}</div>
  </div>`;
  const search = el.querySelector('.fin-gloss-search');
  const body = el.querySelector('.fin-gloss-body');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { body.innerHTML = groupsHtml(GLOSSARY); return; }
    const filtered = GLOSSARY
      .map(g => ({ groep: g.groep, items: g.items.filter(it => `${it.afk} ${it.term} ${it.uit}`.toLowerCase().includes(q)) }))
      .filter(g => g.items.length);
    body.innerHTML = filtered.length ? groupsHtml(filtered) : '<div class="fin-note">Geen begrip gevonden.</div>';
  });
}
