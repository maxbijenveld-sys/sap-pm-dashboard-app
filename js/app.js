// Platform-bootstrap voor het TD-dashboard.
//
// Fase 1: een lichte modulelaag NAAST de bestaande onderhoud-app (die in
// index.html blijft staan), zonder buildstap en zonder bestaande code te
// breken. Modules registreren zich hier. De bestaande inline-app roept na
// login `window.Platform.onAuth({currentUser, isAdmin})` aan; deze laag
// beslist per module of die getoond wordt.
//
// Bewust minimaal: nog geen router-framework of plugin-systeem — we bouwen
// de modulegrens net groot genoeg dat een tweede module later makkelijk
// aanhaakt, niet meer.

import { financeModule } from './modules/finance/finance.js';
import { computeAccess, fetchAccess, allowedPlants, PLANT_NAMES } from './modules/permissions.js';

// Ook bereikbaar voor de klassieke onderhoud-app (js/legacy-app.js, geen ESM):
// die gebruikt dezelfde rechtenlogica voor het verbergen van navigatie.
window.PlatformPermissions = { computeAccess, fetchAccess, allowedPlants, PLANT_NAMES };

const modules = [financeModule];

async function renderModules(ctx) {
  // Rechten één keer ophalen en aan alle modules meegeven — voorkomt dat
  // elke module dezelfde user_module_access-fetch herhaalt.
  if (ctx && ctx.currentUser && !ctx.access) {
    ctx.access = await fetchAccess({
      sbUrl: ctx.sbUrl, sbKey: ctx.sbKey,
      token: ctx.currentUser.access_token,
      isAdmin: !!ctx.isAdmin,
      email: ctx.currentUser.user && ctx.currentUser.user.email
    });
  }
  for (const m of modules) {
    try {
      await m.mount(ctx);
    } catch (e) {
      console.error(`Module "${m.id}" mount-fout:`, e);
    }
  }
}

function teardownModules() {
  for (const m of modules) {
    try { m.unmount && m.unmount(); }
    catch (e) { console.error(`Module "${m.id}" unmount-fout:`, e); }
  }
}

window.Platform = {
  onAuth(ctx) { renderModules(ctx || {}); },
  onSignOut() { teardownModules(); }
};

// Vangnet: als de auth al plaatsvond vóór deze module klaar was met laden,
// alsnog renderen op basis van de laatst bekende context.
if (window.__platformAuth) renderModules(window.__platformAuth);
