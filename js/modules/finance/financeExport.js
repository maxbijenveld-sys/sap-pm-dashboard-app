// Financiën-export (Fase 9): Excel (via de al geladen XLSX-lib) en PDF
// (browser-print). buildSheets is puur/testbaar; exportExcel schrijft het
// bestand. De export respecteert de huidige filters (de aanroeper geeft de
// reeds gefilterde entries mee).

import { ACTUAL_BRON, groupSum, computeKpis } from './financeUtils.js';
import { costPerOrder } from './financeLink.js';

const round = x => Math.round((Number(x) || 0) * 100) / 100;

export function buildSheets({ entries, budget, projects, orderMap }) {
  const k = computeKpis(entries, budget, projects);
  const actueel = entries.filter(e => ACTUAL_BRON.includes(e.bron) || e.bron === 'personeel');

  const samenvatting = [
    ['KPI', 'Waarde (EUR)'],
    ['Actuele kosten (CCTR+KOB1)', round(k.actual)],
    ['Personeelskosten', round(k.personeel)],
    ['Open obligo (KOB2)', round(k.obligo)],
    ['Werkorders', k.orders],
    ['Facturen', k.facturen],
    ['Budget OP (jaar)', k.budgetOp],
    ['Forecast FC (jaar)', k.budgetFc],
    ['Actual YTD', k.budgetActYtd],
    ['Plan YTD', k.budgetPlanYtd],
    ['Projecten actual (RBM)', round(k.projActual)],
    ['Projecten plan (RBM)', round(k.projPlan)]
  ];
  const soort = [['Kostensoort', 'Bedrag (EUR)'], ...groupSum(actueel, 'kostensoort').map(r => [r.key, round(r.bedrag)])];
  const inst = [['Installatie', 'Bedrag (EUR)'], ...groupSum(actueel.filter(e => e.installatie), 'installatie').map(r => [r.key, round(r.bedrag)])];
  const orders = [['Order', 'Omschrijving (onderhoud)', 'Status', 'Type', 'Kosten (EUR)'],
    ...costPerOrder(entries, orderMap, 1000).map(o => [o.order, o.omschrijving || '', o.status || '', o.type || '', round(o.bedrag)])];
  const regels = [['Bron', 'Categorie', 'Jaar', 'Maand', 'Order', 'Installatie', 'Kostensoort', 'Rekening', 'Type', 'Leverancier', 'Factuur', 'Bedrag (EUR)'],
    ...entries.map(e => [e.bron, e.categorie || '', e.jaar || '', e.periode || '', e.order_nr || '', e.installatie || '', e.kostensoort || '', e.kostenrekening || '', e.order_type || '', e.leverancier || '', e.factuur_nr || '', Number(e.bedrag_eur) || 0])];

  return { 'Samenvatting': samenvatting, 'Per kostensoort': soort, 'Per installatie': inst, 'Per werkorder': orders, 'Regels': regels };
}

export function exportExcel(data, filename) {
  if (!window.XLSX) { alert('Excel-bibliotheek niet geladen.'); return; }
  const sheets = buildSheets(data);
  const wb = window.XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));
  }
  window.XLSX.writeFile(wb, filename || 'financien_export.xlsx');
}

export function exportPdf() {
  window.print();
}
