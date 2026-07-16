// Financiën-grafieken (Fase 6) met Chart.js (window.Chart, via CDN in
// index.html). Data-voorbereiding staat in financeUtils.js; hier alleen de
// Chart-configuratie + levenscyclus (oude instances netjes opruimen).

import { fmt, esc, MAAND, ACTUAL_BRON, groupSum, budgetVsActual, pareto, rbmPlanActual, monthlySeries, isOnderhoudActual, versionHistory } from './financeUtils.js';

const TICK = '#8b949e';
const GRID = 'rgba(255,255,255,0.06)';
// Gedeelde, rustige tooltipstijl i.p.v. Chart.js' default donkere doos —
// sluit aan bij het kaartoppervlak van de app. `tooltip` wordt per chart
// shallow overschreven (zie base()), dus deze props staan bewust ook bij
// elke losse tooltip-override herhaald i.p.v. alleen hier.
const GREEN = '#2ea043', ORANGE = '#d29922', RED = '#da3633', BLUE = '#388bfd';

// Chart.js tekent zijn tooltip normaliter zelf op het canvas, gepositioneerd
// via zijn eigen coördinatenberekening. Onder de CSS-zoom van deze app (zie
// body{zoom:...} in css/app.css) lijnde die niet meer uit met de muis —
// zelfde probleem en oplossing als de .info-i-tooltip in legacy-app.js:
// zelf positioneren met een zoom-correctie i.p.v. Chart.js vertrouwen.
let _chartTip = null;
function chartTooltip() {
  if (_chartTip) return _chartTip;
  _chartTip = document.createElement('div');
  _chartTip.className = 'chart-tip';
  document.body.appendChild(_chartTip);
  return _chartTip;
}
function externalTooltipHandler(context) {
  const { chart, tooltip } = context;
  const tip = chartTooltip();
  if (!tooltip || tooltip.opacity === 0) { tip.classList.remove('show'); return; }
  const lines = [];
  if (tooltip.title && tooltip.title.length) lines.push(`<div class="chart-tip-title">${esc(tooltip.title.join(' '))}</div>`);
  (tooltip.body || []).forEach((b, i) => {
    const lc = tooltip.labelColors && tooltip.labelColors[i];
    const dot = lc ? `<span class="chart-tip-dot" style="background:${lc.borderColor || lc.backgroundColor}"></span>` : '';
    lines.push(`<div class="chart-tip-line">${dot}${esc(b.lines.join(' '))}</div>`);
  });
  tip.innerHTML = lines.join('');
  tip.classList.add('show');
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const rect = chart.canvas.getBoundingClientRect();
  const scaleX = rect.width / chart.width, scaleY = rect.height / chart.height;
  const vx = (rect.left + tooltip.caretX * scaleX) / z;
  const vy = (rect.top + tooltip.caretY * scaleY) / z;
  const vw = window.innerWidth / z, vh = window.innerHeight / z;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = Math.max(8, Math.min(vx - tw / 2, vw - tw - 8));
  let top = vy - th - 14;
  if (top < 8) top = vy + 14;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
const TOOLTIP_CFG = { enabled: false, external: externalTooltipHandler };
const compact = new Intl.NumberFormat('nl-NL', { notation: 'compact', maximumFractionDigits: 1 });

// Instanties per canvas-id: zo vervangt een her-render alleen zijn éigen
// grafiek en blijven grafieken op andere (sub)tabbladen gewoon staan.
let instances = {};
export function destroyCharts() {
  Object.values(instances).forEach(c => { try { c.destroy(); } catch (e) {} });
  instances = {};
}

function base(extra) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: TICK, font: { size: 11 }, boxWidth: 12, usePointStyle: true, pointStyle: 'circle' } },
      tooltip: { ...TOOLTIP_CFG, callbacks: { label: c => `${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } }
    },
    scales: {
      x: { grid: { color: GRID }, ticks: { color: TICK, font: { size: 11 } } },
      y: { grid: { color: GRID }, ticks: { color: TICK, font: { size: 11 }, callback: v => '€' + compact.format(v) }, beginAtZero: true }
    }
  }, extra || {});
}

function card(title, id, h) {
  return `<div class="cc"><div class="cct">${esc(title)}</div><div class="chart-container" style="height:${h || 220}px"><canvas id="${id}"></canvas></div></div>`;
}
function make(id, config) {
  const cv = document.getElementById(id);
  if (!cv) return;
  if (instances[id]) { try { instances[id].destroy(); } catch (e) {} }
  instances[id] = new window.Chart(cv, config);
}

// Eén vraag, één grafiek: "past het jaar binnen budget en waar landen we?"
// De vorige maandgrafiek toonde een naar-rato-verdeling (KOB1-boekingen
// dragen geen maand) met een vlakke maandprognose — dat oogde als echte
// maandcijfers terwijl het schattingen waren. Cumulatief is het eindpunt
// (YTD-stand) wél exact en is de vergelijking met budget/forecast eerlijk.
export function renderLineCharts(el, entries, opts = {}) {
  if (!window.Chart) { el.innerHTML = '<div class="fin-note">Grafiek-bibliotheek niet geladen.</div>'; return; }
  const s = monthlySeries(entries);
  const { budgetOp = null, budgetFc = null, snapshotMaand = null } = opts;
  const labels = MAAND.slice(1);                       // jan..dec (altijd 12)

  // Maandpad naar rato van de CCTR-verdeling, opgeschaald zodat de stand
  // t/m de peilmaand exact de echte onderhoud-YTD (incl. KOB1) is.
  const trueOnd = (entries || []).filter(isOnderhoudActual).reduce((a, e) => a + (Number(e.bedrag_eur) || 0), 0);
  const distOnd = s.onderhoud.reduce((a, v) => a + v, 0);
  const ondFactor = distOnd > 0 ? trueOnd / distOnd : 1;
  const ondByM = {};
  s.months.forEach((m, i) => { ondByM[m] = s.onderhoud[i] * ondFactor; });
  const lastActual = Math.min(12, snapshotMaand || (s.months.length ? Math.max(...s.months) : 0));
  if (!lastActual) { el.innerHTML = '<div class="fin-note">Geen maandgegevens in deze export — kostenverloop niet te tekenen.</div>'; return; }

  const actCumul = []; let run = 0;
  for (let m = 1; m <= 12; m++) { if (m <= lastActual) { run += (ondByM[m] || 0); actCumul.push(Math.round(run)); } else actCumul.push(null); }
  const ytd = run;

  // Prognose: één rechte gestreepte lijn van de laatste werkelijke stand
  // naar de verwachte eindstand (FC; zonder FC: het YTD-tempo doorgetrokken).
  // Bewust geen maand-voor-maand-voorspelling — die kennis hebben we niet.
  const fcEnd = budgetFc != null ? budgetFc : (ytd / lastActual) * 12;
  const fcCumul = labels.map(() => null);
  if (lastActual < 12) { fcCumul[lastActual - 1] = Math.round(ytd); fcCumul[11] = Math.round(fcEnd); }
  const budgetLine = budgetOp != null ? labels.map(() => Math.round(budgetOp)) : null;
  const mnd = MAAND[lastActual] || ('maand ' + lastActual);

  el.innerHTML = `
    <div class="fin-sub" style="line-height:1.6">Wat je ziet: de <strong style="color:#3fb950">groene lijn</strong> is wat er t/m <strong>${mnd}</strong> cumulatief aan onderhoud is geboekt (${fmt(ytd)}).
    De <strong style="color:#f0a04b">gestreepte lijn</strong> loopt naar de verwachte eindstand van het jaar${budgetFc != null ? ` — de eigen forecast van ${fmt(budgetFc)}` : ' (het huidige tempo doorgetrokken)'} — een richting, geen maandvoorspelling.
    De <strong style="color:#94a3b8">grijze lijn</strong> is het jaarbudget${budgetOp != null ? ` (${fmt(budgetOp)})` : ''}: blijft de groene lijn daaronder, dan past het jaar binnen budget.
    <span style="color:#6e7681">Maandverdeling naar rato; de stand t/m ${mnd} is exact.</span></div>
    ${card('Cumulatieve onderhoudskosten — werkelijk, prognose en budget', 'finLine2', 300)}`;

  make('finLine2', { type: 'line', data: { labels, datasets: [
    { label: 'Werkelijk (cumulatief)', data: actCumul, borderColor: GREEN, backgroundColor: 'rgba(46,160,67,0.10)', tension: .25, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 10, fill: true },
    { label: budgetFc != null ? 'Prognose eindejaar (FC)' : 'Prognose (YTD-tempo)', data: fcCumul, borderColor: ORANGE, backgroundColor: 'transparent', borderDash: [6, 5], borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, spanGaps: true },
    ...(budgetLine ? [{ label: 'Budget (OP)', data: budgetLine, borderColor: '#94a3b8', backgroundColor: 'transparent', borderDash: [8, 4], pointRadius: 0, borderWidth: 1.5, fill: false }] : [])
  ] }, options: base() });
}

// Meerdere-periodes trend (audit-bevinding: het dashboard toonde alleen de
// laatste upload — een momentopname, geen "gaan we vooruit of achteruit?").
// Elk punt is een eerdere versie/upload, niet een kalendermaand — dus dit
// beantwoordt precies de vraag die de periodevergelijking bij de Kerncijfers
// (zie financeDashboard.js) niet kon: het verloop over méér dan twee punten.
export function renderVersionHistory(el, currentUpload, others) {
  if (!window.Chart) { el.innerHTML = '<div class="fin-note">Grafiek-bibliotheek niet geladen.</div>'; return; }
  const history = versionHistory(currentUpload, others);
  if (history.length < 2) {
    el.innerHTML = '<div class="fin-note">Nog niet genoeg versies voor een historisch verloop — dit verschijnt vanaf de tweede upload met een budgettabblad.</div>';
    return;
  }
  // Canvas-id bewust ANDERS dan de container-div (#finVersionHistory in
  // financeDashboard.js): bij dubbele id's geeft getElementById de div terug
  // en kan Chart.js nergens op tekenen — kop zichtbaar, grafiek leeg.
  el.innerHTML = card(`Verloop over tijd — ${history.length} versies`, 'finVersionHistoryChart', 260);
  make('finVersionHistoryChart', {
    type: 'line',
    data: {
      labels: history.map(h => h.label),
      datasets: [
        { label: 'Actual YTD', data: history.map(h => h.actYtd), borderColor: GREEN, backgroundColor: 'rgba(46,160,67,0.12)', tension: .25, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, pointHitRadius: 10, fill: true, spanGaps: true },
        { label: 'Plan YTD', data: history.map(h => h.planYtd), borderColor: BLUE, backgroundColor: 'transparent', tension: .25, borderWidth: 2, borderDash: [5, 4], pointRadius: 3, pointHoverRadius: 6, pointHitRadius: 10, spanGaps: true },
        { label: 'Budget (OP)', data: history.map(h => h.op), borderColor: '#94a3b8', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0, spanGaps: true },
        { label: 'Forecast (FC)', data: history.map(h => h.fc), borderColor: ORANGE, backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0, spanGaps: true }
      ]
    },
    options: base({ scales: { x: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true } } })
  });
}

export function renderCharts(el, entries, budget, projects) {
  if (!window.Chart) { el.innerHTML = '<div class="fin-note">Grafiek-bibliotheek niet geladen.</div>'; return; }

  const actueel = entries.filter(e => ACTUAL_BRON.includes(e.bron) || e.bron === 'personeel');
  const soort = groupSum(actueel, 'kostensoort').slice(0, 8);
  const inst = groupSum(actueel.filter(e => e.installatie), 'installatie').slice(0, 8);
  const lev = groupSum(entries.filter(e => e.bron === 'KOB2' && e.leverancier), 'leverancier').slice(0, 8);

  const bva = budgetVsActual(budget);
  // Pareto: alleen positieve bijdragen (credits/negatieve boekingen weglaten
  // zodat de cumulatieve lijn netjes oploopt naar 100%).
  const par = pareto(groupSum(actueel, 'kostensoort').filter(r => r.bedrag > 0));
  const rbm = rbmPlanActual(projects, 8);

  // Obligo per maand: sinds parser 2.1.0 dragen KOB2-regels een maand
  // (afgeleid uit de Debit date) — echte data, geen naar-rato-schatting.
  const obligoRows = entries.filter(e => e.bron === 'KOB2' && Number(e.periode));
  const obligoByM = {};
  obligoRows.forEach(e => { const p = Number(e.periode); obligoByM[p] = (obligoByM[p] || 0) + (Number(e.bedrag_eur) || 0); });
  const obligoMonths = Object.keys(obligoByM).map(Number).sort((a, b) => a - b);

  // Kostenverdeling per maand (gestapeld): alleen bronnen met een échte
  // maandkolom (CCTR + personeel); KOB1 draagt geen maand en blijft er
  // bewust buiten — liever een eerlijke deelverdeling dan een geschatte.
  const stackByCat = { onderhoud: {}, verbruik: {}, personeel: {} };
  entries.forEach(e => {
    const p = Number(e.periode);
    if (!p || e.bron === 'KOB2' || e.bron === 'KOB1') return;
    const cat = e.categorie || (e.bron === 'personeel' ? 'personeel' : 'onderhoud');
    if (!stackByCat[cat]) return;
    stackByCat[cat][p] = (stackByCat[cat][p] || 0) + (Number(e.bedrag_eur) || 0);
  });
  const stackMonths = [...new Set(Object.values(stackByCat).flatMap(o => Object.keys(o).map(Number)))].sort((a, b) => a - b);

  el.innerHTML = `<div class="fin-chart-grid">
    ${card('Budget (OP) vs. actual YTD', 'finC2')}
    ${card('Kostenverdeling per maand — onderhoud / verbruik / personeel', 'finC8')}
    ${card('Open obligo per maand (KOB2, o.b.v. Debit date)', 'finC9')}
    ${card('Kosten per kostensoort (top 8)', 'finC3')}
    ${card('Kosten per installatie (top 8)', 'finC4')}
    ${card('Leverancierskosten / obligo (top 8)', 'finC5')}
    ${card('Pareto — kostensoort (80/20)', 'finC6')}
    ${card('RBM-projecten: plan vs. actual (top 8)', 'finC7')}
  </div>`;

  // 8 — gestapelde kostenverdeling per maand
  if (stackMonths.length) make('finC8', {
    type: 'bar',
    data: {
      labels: stackMonths.map(m => MAAND[m] || String(m)),
      datasets: [
        { label: 'Onderhoud', data: stackMonths.map(m => Math.round(stackByCat.onderhoud[m] || 0)), backgroundColor: GREEN },
        { label: 'Verbruik', data: stackMonths.map(m => Math.round(stackByCat.verbruik[m] || 0)), backgroundColor: BLUE },
        { label: 'Personeel', data: stackMonths.map(m => Math.round(stackByCat.personeel[m] || 0)), backgroundColor: '#8b5cf6' }
      ]
    },
    options: base({ scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } },
      y: { stacked: true, grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true }
    } })
  });

  // 9 — open obligo per maand (area)
  if (obligoMonths.length) make('finC9', {
    type: 'line',
    data: {
      labels: obligoMonths.map(m => MAAND[m] || String(m)),
      datasets: [{ label: 'Open obligo', data: obligoMonths.map(m => Math.round(obligoByM[m])), borderColor: ORANGE, backgroundColor: 'rgba(210,153,34,0.16)', fill: true, tension: .25, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 10 }]
    },
    options: base({ plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_CFG, callbacks: { label: c => fmt(c.parsed.y) } } } })
  });

  // 2 — budget vs actual per categorie
  make('finC2', {
    type: 'bar',
    data: { labels: bva.map(b => b.categorie), datasets: [
      { label: 'Budget (OP)', data: bva.map(b => b.op), backgroundColor: BLUE },
      { label: 'Actual YTD', data: bva.map(b => b.act), backgroundColor: GREEN }
    ] },
    options: base({ scales: { x: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true } } })
  });

  // 3/4/5 — horizontale balken
  const hbar = (rows, color) => ({
    type: 'bar',
    data: { labels: rows.map(r => r.key), datasets: [{ label: 'Kosten', data: rows.map(r => Math.round(r.bedrag)), backgroundColor: color }] },
    options: base({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_CFG, callbacks: { label: c => fmt(c.parsed.x) } } },
      scales: { x: { grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true }, y: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } } } })
  });
  make('finC3', hbar(soort, GREEN));
  make('finC4', hbar(inst, ORANGE));
  make('finC5', hbar(lev, BLUE));

  // 6 — Pareto (bar bedrag + lijn cumulatief %)
  const parTop = par.slice(0, 12);
  make('finC6', {
    data: {
      labels: parTop.map(r => r.key),
      datasets: [
        { type: 'bar', label: 'Kosten', data: parTop.map(r => Math.round(r.bedrag)), backgroundColor: GREEN, yAxisID: 'y' },
        { type: 'line', label: 'Cumulatief %', data: parTop.map(r => r.cumPct), borderColor: ORANGE, backgroundColor: 'transparent', tension: .3, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 10, yAxisID: 'y1' }
      ]
    },
    options: base({
      plugins: { legend: { labels: { color: TICK, font: { size: 11 }, boxWidth: 12 } }, tooltip: { ...TOOLTIP_CFG, callbacks: { label: c => c.dataset.type === 'line' ? c.parsed.y + '%' : fmt(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } },
        y: { position: 'left', grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false }, ticks: { color: TICK, callback: v => v + '%' }, min: 0, max: 100 }
      }
    })
  });

  // 7 — RBM plan vs actual
  make('finC7', {
    type: 'bar',
    data: { labels: rbm.map(p => p.naam.length > 22 ? p.naam.slice(0, 22) + '…' : p.naam), datasets: [
      { label: 'Plan', data: rbm.map(p => Math.round(p.plan)), backgroundColor: BLUE },
      { label: 'Actual', data: rbm.map(p => Math.round(p.actual)), backgroundColor: GREEN }
    ] },
    options: base({ indexAxis: 'y', scales: { x: { grid: { color: GRID }, ticks: { color: TICK, callback: v => '€' + compact.format(v) }, beginAtZero: true }, y: { grid: { display: false }, ticks: { color: TICK, font: { size: 10 } } } } })
  });
}
