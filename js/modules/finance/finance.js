// Financiënmodule — registratie, rechtencheck en pagina-opbouw.
//
// Fase 1: modulegrens + tab. Fase 2: echte rechtencheck (user_module_access,
// RLS). Fase 4: upload-flow (voor finance-admins) + versie-overzicht.
// Dashboard/analyse volgen in latere fasen.

import { esc, MAAND } from './financeUtils.js';
import { renderUpload } from './financeUpload.js';
import { renderDashboard, prefetchDashboard, invalidateDashboardCache, plantName } from './financeDashboard.js';

const NAV_ID = 'financeNavBtn';
const PAGE_ID = 'pg-financien';

let ctx = null;              // { currentUser, isAdmin, sbUrl, sbKey }
let accessLevel = null;      // 'read' | 'admin' | null

// ── Toegang ────────────────────────────────────────────────────────
async function fetchFinanceAccess(c) {
  const token = c && c.currentUser && c.currentUser.access_token;
  if (!token || !c.sbUrl || !c.sbKey) return null;
  try {
    const r = await fetch(`${c.sbUrl}/rest/v1/user_module_access?select=access_level&module=eq.finance`,
      { headers: { apikey: c.sbKey, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows.find(x => x && x.access_level) : null;
    return row ? row.access_level : null;
  } catch (e) { console.error('Finance-toegangscheck faalde:', e); return null; }
}

// ── Versie-overzicht (uploads) ─────────────────────────────────────
async function loadUploads() {
  const token = ctx && ctx.currentUser && ctx.currentUser.access_token;
  if (!token) return [];
  try {
    const r = await fetch(`${ctx.sbUrl}/rest/v1/finance_uploads?select=id,plant,jaar,periode,label,bestandsnaam,aantal_regels,aangemaakt_door,created_at&order=created_at.desc&limit=25`,
      { headers: { apikey: ctx.sbKey, Authorization: 'Bearer ' + token } });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) { console.error('Uploads laden faalde:', e); return []; }
}

function renderUploadsList(el, uploads) {
  if (!uploads.length) { el.innerHTML = '<div class="fin-note">Nog geen uploads. Upload een MIP-export om te beginnen.</div>'; return; }
  const PLANTS = { IJ: 'IJmuiden', R: 'Rotterdam' };
  const rows = uploads.map(u => {
    const dt = u.created_at ? new Date(u.created_at).toLocaleString('nl-NL') : '—';
    return `<tr>
      <td>${esc(u.label || '—')}</td>
      <td>${esc(PLANTS[u.plant] || u.plant || '—')}</td>
      <td>${u.jaar || '—'}</td>
      <td>${u.periode ? (u.periode + ' — ' + MAAND[u.periode]) : '—'}</td>
      <td style="text-align:right">${u.aantal_regels != null ? u.aantal_regels : '—'}</td>
      <td>${esc(u.aangemaakt_door || '—')}</td>
      <td style="color:#8b949e">${esc(dt)}</td>
    </tr>`;
  }).join('');
  // .tw keep-table: kaart-chroom + horizontaal scrollen op smalle schermen
  // (7 kolommen passen niet op 320px; koppen moeten leesbaar blijven).
  el.innerHTML = `<div class="tw keep-table"><table class="fin-tbl"><thead><tr><th>Versie</th><th>Plant</th><th>Jaar</th><th>Maand</th><th style="text-align:right">Regels</th><th>Door</th><th>Wanneer</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── Pagina ─────────────────────────────────────────────────────────
function ensurePage() {
  let pg = document.getElementById(PAGE_ID);
  if (pg) return pg;
  const main = document.querySelector('.main');
  if (!main) return null;
  pg = document.createElement('div');
  pg.className = 'pg';
  pg.id = PAGE_ID;
  main.appendChild(pg);
  return pg;
}

async function renderPage() {
  const pg = ensurePage();
  if (!pg) return;
  pg.innerHTML = `
    <div class="whr">
      <div><div class="wt">Financiën</div><div class="ws">Onderhoudskosten ${esc(plantName(ctx))}${accessLevel === 'admin' ? '' : ' — alleen-lezen'}</div></div>
    </div>
    <div id="finDash"></div>
    ${accessLevel === 'admin' ? '<div class="sl">Beheer — upload</div><div id="finUploadHost"></div>' : ''}
    <div class="sl">Eerdere uploads (versies)</div>
    <div id="finUploads"><div class="fin-note">Laden…</div></div>`;

  renderDashboard(pg.querySelector('#finDash'), ctx).catch(e => console.error('Finance render failed:', e));
  if (accessLevel === 'admin') {
    renderUpload(pg.querySelector('#finUploadHost'), ctx, onUploadDone);
  }
  refreshUploads().catch(e => console.error('Finance uploads refresh failed:', e));
}

// Na een geslaagde upload: cache legen (anders toont het dashboard de oude
// versie), versie-lijst herladen én het dashboard opnieuw tekenen.
async function onUploadDone() {
  invalidateDashboardCache();
  await refreshUploads();
  const dash = document.getElementById('finDash');
  if (dash) await renderDashboard(dash, ctx);
}

async function refreshUploads() {
  const el = document.getElementById('finUploads');
  if (!el) return;
  const uploads = await loadUploads();
  renderUploadsList(el, uploads);
}

// ── Navigatie ──────────────────────────────────────────────────────
async function showFinance() {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t => t.classList.remove('active'));
  // Financiën hoort niet bij de Onderhoud-subnav (index.html #onderhoudSubnav).
  if (typeof window.syncOnderhoudSubnav === 'function') window.syncOnderhoudSubnav('financien');
  const pg = ensurePage();
  if (pg) pg.classList.add('active');
  const btn = document.getElementById(NAV_ID);
  if (btn) btn.classList.add('active');
  if (typeof window.closeMobileNav === 'function') window.closeMobileNav();
  // Registreert een history-entry zodat de browser-/muis-terugknop hierheen
  // en weer terug kan navigeren (zelfde route-mechanisme als het onderhoud-
  // dashboard, zie navigate()/applyRoute() in legacy-app.js).
  if (typeof window.navigate === 'function') window.navigate({ page: 'financien' });

  // Financiën is 2FA-beveiligd: eerst opstappen naar aal2 (rest van het
  // dashboard blijft gewoon toegankelijk met e-mail + wachtwoord).
  //
  // Token vóór de aanroep vastleggen i.p.v. pas erna vergelijken: de
  // 2FA-stap muteert window.__platformAuth.currentUser (waar ctx naar
  // verwijst) VOORDAT hij teruggeeft, dus "erna" vergelijken zag altijd
  // twee gelijke waarden en de aal1-cache (leeg, want RLS blokkeert
  // finance-data zonder 2FA) werd nooit ververst — het dashboard toonde
  // dan blijvend "geen data" ook na een geslaagde 2FA.
  if (typeof window.requireFinanceAal2 === 'function') {
    const tokenBefore = ctx && ctx.currentUser && ctx.currentUser.access_token;
    const s = await window.requireFinanceAal2();
    if (!s) { if (pg) renderFinanceGate(pg); return; }
    if (ctx) ctx.currentUser = s;
    if (s.access_token !== tokenBefore) invalidateDashboardCache();
  }
  renderPage();
}

// Toegangspoort wanneer 2FA (nog) niet is voltooid.
function renderFinanceGate(pg) {
  pg.innerHTML = `
    <div class="whr"><div><div class="wt">Financiën</div><div class="ws">Beveiligd met twee-factor authenticatie</div></div></div>
    <div class="fin-card">
      <div class="fin-note">&#128274; Dit onderdeel is extra beveiligd met 2FA. Stel het eenmalig in via de
      <strong>&#128273; 2FA</strong>-knop rechtsboven, of voer je code in om te ontgrendelen.</div>
      <div style="margin-top:12px"><button class="btn btn-p" id="finUnlockBtn">Ontgrendelen</button></div>
    </div>`;
  const b = pg.querySelector('#finUnlockBtn');
  if (b) b.addEventListener('click', () => showFinance());
}

function ensureNav() {
  if (document.getElementById(NAV_ID)) return;
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  const btn = document.createElement('button');
  btn.className = 'nt';
  btn.id = NAV_ID;
  btn.innerHTML = 'Financi&euml;n';
  btn.addEventListener('click', showFinance);
  const wkTabs = document.getElementById('wkTabs');
  if (wkTabs) nav.insertBefore(btn, wkTabs);
  else nav.appendChild(btn);
}

function remove() {
  const btn = document.getElementById(NAV_ID);
  if (btn) btn.remove();
  const pg = document.getElementById(PAGE_ID);
  if (pg) pg.remove();
}

// Globaal bereikbaar zodat applyRoute() (legacy-app.js) Financiën kan
// herstellen bij een browser-/muis-terugknop-navigatie (popstate).
window.__showFinance = showFinance;

export const financeModule = {
  id: 'finance',
  async mount(c) {
    ctx = c;
    if (c && c.isAdmin) { accessLevel = 'admin'; ensureNav(); prefetchDashboard(c); return; }
    // Rechten komen bij voorkeur uit de gedeelde laag (ctx.access, één fetch
    // voor alle modules); fallback op de oude eigen fetch als die ontbreekt.
    accessLevel = (c && c.access) ? c.access.finance : await fetchFinanceAccess(c);
    if (accessLevel) { ensureNav(); prefetchDashboard(c); }
    else remove();
  },
  // Cache legen bij uitloggen: anders zou een volgende gebruiker op dezelfde
  // machine (binnen dezelfde paginasessie) de finance-data van zijn voorganger
  // uit het modulegeheugen te zien krijgen.
  unmount() { accessLevel = null; ctx = null; invalidateDashboardCache(); remove(); }
};
