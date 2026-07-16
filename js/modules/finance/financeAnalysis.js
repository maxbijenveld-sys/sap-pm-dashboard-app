// Financiën auto-insights (Fase 7): regelgebaseerde tekstuele inzichten,
// zelfde kaartstijl als de bestaande onderhoud-analyse (.insight-grid /
// .insight-card in index.html). Geen externe LLM (financiële datagovernance).
//
// computeInsights is puur en testbaar; renderAnalysis tekent de kaarten.

import { fmt, esc, MAAND, groupSum, pareto, isOnderhoudActual, grandTotalBudget } from './financeUtils.js';

const num = x => Number(x) || 0;

export function computeInsights(entries, budget, projects, maand) {
  const ins = [];
  const actualEntries = entries.filter(isOnderhoudActual);
  const totalActual = actualEntries.reduce((a, e) => a + num(e.bedrag_eur), 0);
  const grand = grandTotalBudget(budget);

  // 1 — Jaarprognose (run-rate op basis van YTD)
  if (maand && grand.act_ytd_eur != null && grand.op_eur) {
    const proj = grand.act_ytd_eur / maand * 12;
    const pct = Math.round((proj / grand.op_eur - 1) * 100);
    const over = proj > grand.op_eur;
    ins.push({
      c: over ? (pct >= 15 ? '#da3633' : '#d29922') : '#2ea043', icon: over ? '&#9888;' : '&#10003;',
      title: `Jaarprognose: ${fmt(proj)} (${pct > 0 ? '+' : ''}${pct}% t.o.v. budget)`,
      body: `Bij gelijke tred (YTD <strong>${fmt(grand.act_ytd_eur)}</strong> t/m ${MAAND[maand] || ('maand ' + maand)}) koerst het jaar op <strong>${fmt(proj)}</strong> vs. budget ${fmt(grand.op_eur)}. ${over ? 'Overschrijding dreigt — bijsturen.' : 'Binnen budget.'}`
    });
  }

  // 2 — Forecast vs. operating plan (uit Maint_Costs)
  if (grand.fc_eur != null && grand.op_eur) {
    const d = grand.fc_eur - grand.op_eur, p = Math.round(d / grand.op_eur * 100);
    ins.push({
      c: d > 0 ? '#d29922' : '#2ea043', icon: '&#9679;',
      title: `Forecast ${d > 0 ? 'boven' : 'onder'} budget (${d > 0 ? '+' : ''}${p}%)`,
      body: `De eigen forecast (FC <strong>${fmt(grand.fc_eur)}</strong>) ligt ${d > 0 ? 'boven' : 'onder'} het operating plan (OP ${fmt(grand.op_eur)}).`
    });
  }

  // 3 — Grootste kostendriver (kostensoort)
  const soort = groupSum(actualEntries, 'kostensoort').filter(r => r.bedrag > 0);
  if (soort.length && totalActual > 0) {
    const top = soort[0], p = Math.round(top.bedrag / totalActual * 100);
    ins.push({ c: '#388bfd', icon: '&#8364;', title: `Grootste kostenpost: ${esc(top.key)}`, body: `<strong>${fmt(top.bedrag)}</strong> — ${p}% van de actuele kosten.` });
  }

  // 4 — 80/20 (Pareto)
  if (soort.length) {
    const par = pareto(soort);
    const idx = par.findIndex(r => r.cumPct >= 80);
    const n = idx >= 0 ? idx + 1 : par.length;
    ins.push({ c: '#d29922', icon: '&#9650;', title: `80/20: ${n} kostensoort${n === 1 ? '' : 'en'} = ~80% van de kosten`, body: `Van de ${soort.length} kostensoorten veroorzaken de grootste <strong>${n}</strong> circa 80% van de uitgaven. Daar zit de meeste stuurkracht.` });
  }

  // 5 — Duurste installatie
  const inst = groupSum(actualEntries.filter(e => e.installatie), 'installatie').filter(r => r.bedrag > 0);
  if (inst.length && totalActual > 0) {
    const top = inst[0], p = Math.round(top.bedrag / totalActual * 100);
    ins.push({ c: '#da3633', icon: '&#9650;', title: `Duurste installatie: ${esc(top.key)}`, body: `<strong>${fmt(top.bedrag)}</strong> aan onderhoudskosten — ${p}% van het totaal.${inst.length > 1 ? ` Daarna: ${esc(inst[1].key)} (${fmt(inst[1].bedrag)}).` : ''}` });
  }

  // 6 — Open obligo
  const obligo = entries.filter(e => e.bron === 'KOB2').reduce((a, e) => a + num(e.bedrag_eur), 0);
  if (obligo > 0 && totalActual > 0) {
    const p = Math.round(obligo / totalActual * 100);
    ins.push({ c: '#388bfd', icon: '&#9679;', title: `Open obligo: ${fmt(obligo)}`, body: `Er staat nog <strong>${fmt(obligo)}</strong> aan verplichtingen open (${p}% van de YTD-kosten) — al vastgelegde toekomstige uitgaven.` });
  }

  // 7 — Leverancier-concentratie
  const lev = groupSum(entries.filter(e => e.bron === 'KOB2' && e.leverancier), 'leverancier').filter(r => r.bedrag > 0);
  if (lev.length && obligo > 0) {
    const top = lev[0], p = Math.round(top.bedrag / obligo * 100);
    if (p >= 25) ins.push({ c: '#d29922', icon: '&#9650;', title: `Leverancier-concentratie: ${p}% bij één partij`, body: `Leverancier <strong>${esc(top.key)}</strong> is goed voor ${fmt(top.bedrag)} (${p}%) van het open obligo.` });
  }

  return ins;
}

export function renderAnalysis(el, entries, budget, projects, maand) {
  const ins = computeInsights(entries, budget, projects, maand);
  if (!ins.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="insight-grid">${ins.map(i => `
    <div class="insight-card" style="--ic-accent:${i.c}">
      <div class="insight-title"><span style="color:${i.c}">${i.icon}</span>${i.title}</div>
      <div class="insight-body">${i.body}</div>
    </div>`).join('')}</div>`;
}
