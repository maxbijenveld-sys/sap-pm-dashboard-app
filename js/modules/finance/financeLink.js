// Onderhoud × Financiën (Fase 8). Koppelt financiële regels aan de
// onderhoud-werkorders via het ordernummer (finance order_nr == onderhoud wo).
//
// Levert: correctief (PM01) vs. preventief (PM02) kosten, kosten per werkorder
// (verrijkt met onderhoud-omschrijving/status), backlog-kosten, en een
// drilldown werkorder -> kostenregels (bron-Excelregels).
//
// De pure functies (pmSplit/costPerOrder/backlogCost) zijn los testbaar.

import { fmt, esc, MAAND, isOnderhoudActual } from './financeUtils.js';

const num = x => Number(x) || 0;
const OPEN_STATUS = ['nee', 'deels', 'uc'];

// Onderhoud-werkorders laden uit de bestaande weeks-tabel en dedupliceren op
// ordernummer (laatst bekende status = hoogste week).
export async function loadMaintenanceOrders(ctx) {
  const token = ctx && ctx.currentUser && ctx.currentUser.access_token;
  if (!token) return {};
  try {
    const r = await fetch(`${ctx.sbUrl}/rest/v1/weeks?select=week,rows&order=week.asc`, { headers: { apikey: ctx.sbKey, Authorization: 'Bearer ' + token } });
    if (!r.ok) return {};
    const weeks = await r.json();
    const map = {};
    for (const w of (weeks || [])) {
      for (const row of (w.rows || [])) {
        const wo = (row.wo || '').toString().trim();
        if (!wo || wo === '—') continue;
        const prev = map[wo];
        if (!prev || w.week >= prev._week) {
          map[wo] = { omschrijving: row.omschrijving, status: row.status, type: row.type, _week: w.week, voorkomens: (prev ? prev.voorkomens : 0) + 1 };
        } else if (prev) { prev.voorkomens += 1; }
      }
    }
    return map;
  } catch (e) { console.error('Onderhoud-orders laden faalde:', e); return {}; }
}

// Ordertype-betekenis afgeleid uit de echte omschrijvingen in MIP.xlsm (niet
// uit een SAP-configuratietabel, die is hier niet beschikbaar):
//   PM01 (662 regels, ø€3.5k) — storingstaal: "lekkage", "versleten", "zit los"
//     -> correctief, ongepland.
//   PM02 (34 regels, ø€9.1k) — "revisie", "wisselen walsrollen RBM2026",
//     "herzien retoursysteem"; 5/34 noemen RBM expliciet -> groter gepland
//     onderhoud, vaak projectmatig (RBM).
//   PM03 (150 regels, ø€1.0k) — "inspectie", "smeren", "filter vervangen",
//     "kalibratie" -> klassiek periodiek/preventief, kleine bedragen.
export function pmSplit(entries) {
  const s = { correctief: 0, gepland: 0, preventief: 0, overig: 0 };
  for (const e of entries) {
    if (!isOnderhoudActual(e)) continue;
    const t = (e.order_type || '').toUpperCase(), v = num(e.bedrag_eur);
    if (t === 'PM01') s.correctief += v;
    else if (t === 'PM02') s.gepland += v;
    else if (t === 'PM03') s.preventief += v;
    else s.overig += v;
  }
  return s;
}

export function costPerOrder(entries, orderMap, n) {
  const m = {};
  for (const e of entries) {
    if (!isOnderhoudActual(e) || !e.order_nr) continue;
    if (!m[e.order_nr]) m[e.order_nr] = { order: e.order_nr, bedrag: 0, installatie: e.installatie, type: e.order_type };
    m[e.order_nr].bedrag += num(e.bedrag_eur);
  }
  return Object.values(m).sort((a, b) => b.bedrag - a.bedrag).slice(0, n || 15).map(r => {
    const mo = (orderMap || {})[r.order];
    return Object.assign(r, { omschrijving: mo ? mo.omschrijving : null, status: mo ? mo.status : null, inMaintenance: !!mo });
  });
}

export function backlogCost(entries, orderMap) {
  const perOrder = {};
  for (const e of entries) {
    if (!isOnderhoudActual(e) || !e.order_nr) continue;
    perOrder[e.order_nr] = (perOrder[e.order_nr] || 0) + num(e.bedrag_eur);
  }
  let openKosten = 0, gekoppeldeKosten = 0, gekoppeldeOrders = 0;
  for (const [o, v] of Object.entries(perOrder)) {
    const mo = (orderMap || {})[o];
    if (mo) { gekoppeldeKosten += v; gekoppeldeOrders++; if (OPEN_STATUS.includes((mo.status || '').toLowerCase())) openKosten += v; }
  }
  return { openKosten, gekoppeldeKosten, gekoppeldeOrders };
}

// ── Render ─────────────────────────────────────────────────────────
const badge = s => {
  const v = (s || '').toLowerCase();
  if (v === 'ja') return '<span class="badge bja">Ja</span>';
  if (v === 'nee') return '<span class="badge bnee">Nee</span>';
  if (v === 'deels') return '<span class="badge bdeels">Deels</span>';
  if (v === 'uc') return '<span class="badge buc">UC</span>';
  return '<span style="font-size:11px;color:#6e7681">niet in planning</span>';
};

function kpi(label, val, sub, tip) {
  const info = tip ? `<span class="info-i" data-tip="${esc(tip)}">i</span>` : '';
  return `<div class="fin-kpi">${info}<div class="fin-kpi-l">${label}</div><div class="fin-kpi-v">${val}</div>${sub ? `<div class="fin-kpi-s">${sub}</div>` : ''}</div>`;
}

export function renderLink(container, entries, orderMap) {
  const split = pmSplit(entries);
  const totPm = split.correctief + split.gepland + split.preventief + split.overig || 1;
  const bl = backlogCost(entries, orderMap);
  const orders = costPerOrder(entries, orderMap, 15);

  const pct = v => Math.round(v / totPm * 100);
  let html = `<div class="fin-kg">
    ${kpi('Correctief (PM01)', fmt(split.correctief), pct(split.correctief) + '% van kosten',
      'PM01 = correctief onderhoud: storingen en reparaties (ongepland). Bedrag = werkelijke kosten van PM01-werkorders.')}
    ${kpi('Gepland (PM02)', fmt(split.gepland), pct(split.gepland) + '% van kosten',
      'PM02 = groter gepland onderhoud: revisies en projectmatige werkzaamheden, vaak gekoppeld aan een RBM-project. Bedrag = werkelijke kosten van PM02-werkorders.')}
    ${kpi('Preventief (PM03)', fmt(split.preventief), pct(split.preventief) + '% van kosten',
      'PM03 = periodiek/preventief onderhoud: inspecties, smeren, kalibraties en filtervervanging. Bedrag = werkelijke kosten van PM03-werkorders.')}
    ${kpi('Overig / geen type', fmt(split.overig), pct(split.overig) + '%',
      'Kosten zonder PM01/PM02/PM03-type — bijvoorbeeld creditboekingen of regels waar SAP geen ordertype heeft meegegeven.')}
    ${kpi('Kosten op openstaande WO\'s', fmt(bl.openKosten), 'gekoppeld aan backlog',
      'Kosten van werkorders die in de onderhoudsplanning nog niet zijn afgerond (status Nee, Deels of UC). Gekoppeld via het ordernummer.')}
  </div>`;

  html += `<div class="fin-sub" style="margin-top:6px">Top werkorders op kosten — klik voor de kostenregels. ${bl.gekoppeldeOrders} van de getoonde orders zijn gekoppeld aan de onderhoudsplanning.</div>`;
  // keep-table: op mobiel horizontaal scrollen mét kolomkoppen — de generieke
  // kaart-weergave zou deze cellen zonder labels stapelen (onleesbaar geld).
  html += `<div class="tw keep-table"><table class="fin-tbl"><thead><tr>
    <th>Order</th><th>Omschrijving (onderhoud)</th><th>Status</th><th>Type</th><th style="text-align:right">Kosten</th>
  </tr></thead><tbody>`;
  orders.forEach((o, i) => {
    html += `<tr class="fin-order-row" data-idx="${i}" tabindex="0" role="button" style="cursor:pointer">
      <td style="font-family:monospace;font-size:12px">${esc(o.order)} <span class="fin-tog" style="color:#8b949e">&#9658;</span></td>
      <td>${esc(o.omschrijving || (o.installatie ? o.installatie + ' — (niet in planning)' : '—'))}</td>
      <td>${badge(o.status)}</td>
      <td>${esc(o.type || '—')}</td>
      <td style="text-align:right">${fmt(o.bedrag)}</td>
    </tr>
    <tr class="fin-order-detail" data-detail="${i}" style="display:none"><td colspan="5" style="background:var(--color-surface);padding:0"></td></tr>`;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Drilldown: rij klikken -> kostenregels van die order tonen (lazy).
  // Enter/spatie wordt afgehandeld door de globale tr[tabindex]-listener in
  // index.html — een eigen keydown-handler hier zou de klik dubbel afvuren
  // (open + meteen weer dicht = netto niets).
  container.querySelectorAll('.fin-order-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = row.dataset.idx;
      const detail = container.querySelector(`.fin-order-detail[data-detail="${idx}"]`);
      if (!detail) return;
      const open = detail.style.display !== 'none';
      const tog = row.querySelector('.fin-tog');
      if (open) { detail.style.display = 'none'; if (tog) tog.innerHTML = '&#9658;'; return; }
      if (!detail.dataset.filled) {
        const order = orders[idx].order;
        const lines = entries.filter(e => e.order_nr === order);
        detail.querySelector('td').innerHTML = renderLines(lines);
        detail.dataset.filled = '1';
      }
      detail.style.display = 'table-row';
      if (tog) tog.innerHTML = '&#9660;';
    });
  });
}

function renderLines(lines) {
  if (!lines.length) return '<div class="fin-note" style="margin:8px 12px">Geen kostenregels.</div>';
  const rows = lines.map(l => `<tr>
    <td>${esc(l.bron)}</td>
    <td>${esc(l.kostensoort || '—')}${l.kostenrekening ? ` <span style="font-family:monospace;font-size:11px;color:var(--color-text-secondary)">(${esc(l.kostenrekening)})</span>` : ''}</td>
    <td>${l.periode ? (MAAND[l.periode] || l.periode) : '—'}</td>
    <td>${esc(l.leverancier || '—')}</td>
    <td>${esc(l.factuur_nr || '—')}</td>
    <td style="text-align:right">${fmt(l.bedrag_eur)}</td>
  </tr>`).join('');
  return `<div class="tw keep-table" style="margin:6px 12px 10px"><table class="fin-tbl"><thead><tr>
    <th>Bron</th><th>Kostensoort</th><th>Maand</th><th>Leverancier</th><th>Factuur</th><th style="text-align:right">Bedrag</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}
