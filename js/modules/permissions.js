// Gebruikersrechten — pure, testbare logica (geen DOM, geen fetch hier).
//
// Drie onafhankelijke permissies bovenop de twee basisrollen (viewer/admin):
//   dashboard  — toegang tot het onderhoud-deel (Dashboard/Backlog/Analyse/weken)
//   finance    — toegang tot het Financiën-tabblad ('read' of 'admin')
//   rotterdam  — toegang tot de Rotterdam-dataset (plant-selector toont R)
//
// Opslag: bestaande tabel user_module_access (email, module, access_level) —
// één rij per (gebruiker, module). Platform-admins hebben altijd alles.
//
// Overgangsmodel voor 'dashboard': vóór de fase17-migratie bestaat er geen
// enkele dashboard-rij en zag iedere ingelogde gebruiker het onderhoud-deel.
// Om te voorkomen dat het deployen van deze code iedereen buitensluit tot de
// migratie draait, wordt de dashboard-permissie pas afgedwongen zodra de
// marker-rij (email='*', module='dashboard') bestaat — fase17 zet die marker
// én geeft alle bestaande gebruikers in dezelfde transactie een grant, dus
// er is geen venster waarin iemand ten onrechte wordt buitengesloten.
// Hetzelfde fail-open patroon als lib/rateLimit.js.

export function computeAccess({ isAdmin, rows, email }) {
  const all = Array.isArray(rows) ? rows.filter(r => r && r.module) : [];
  const enforced = all.some(r => r.email === '*' && r.module === 'dashboard');
  if (isAdmin) return { dashboard: true, finance: 'admin', rotterdam: true, enforced };
  const em = (email || '').toLowerCase();
  // Eigen rijen: RLS beperkt een viewer al tot eigen + marker-rijen, maar we
  // filteren tóch op e-mail zodat de functie ook klopt als een admin-context
  // ooit alle rijen doorgeeft.
  const own = all.filter(r => r.email !== '*' && (!em || (r.email || '').toLowerCase() === em));
  const has = m => own.some(r => r.module === m);
  const fin = own.find(r => r.module === 'finance');
  return {
    dashboard: enforced ? has('dashboard') : true,
    finance: fin ? (fin.access_level || 'read') : null,
    rotterdam: has('rotterdam'),
    enforced
  };
}

// Rijen ophalen + toegang berekenen. Fail-open bij netwerk-/tabelproblemen:
// dashboard blijft dan bereikbaar (huidig gedrag), finance/rotterdam dicht.
export async function fetchAccess({ sbUrl, sbKey, token, isAdmin, email }) {
  if (isAdmin) return computeAccess({ isAdmin: true, rows: [], email });
  try {
    const r = await fetch(`${sbUrl}/rest/v1/user_module_access?select=email,module,access_level`, {
      headers: { apikey: sbKey, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    return computeAccess({ isAdmin: false, rows, email });
  } catch (e) {
    console.error('Rechten ophalen faalde (fail-open voor dashboard):', e);
    return { dashboard: true, finance: null, rotterdam: false, enforced: false };
  }
}

// Welke plants mag deze gebruiker zien? IJmuiden altijd (basisplant).
export function allowedPlants(access) {
  return access && access.rotterdam ? ['IJ', 'R'] : ['IJ'];
}

export const PLANT_NAMES = { IJ: 'IJmuiden', R: 'Rotterdam' };
