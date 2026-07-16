// Onderhoud-app (weekplanning/backlog/analyse/gebruikersbeheer). Was tot nu
// toe een inline <script>-blok in index.html; hier verplaatst als tweede
// stap van het opsplitsen van die monoliet (zie README.md).
//
// Bewust GEEN ES-module (geen <script type="module">): dit bestand wordt
// geladen als klassiek script, exact zoals het inline blok dat was, zodat
// alle top-level function-declaraties gewoon op window terechtkomen — nodig
// omdat honderden onclick="..."/onchange="..."-attributen in de HTML deze
// functies rechtstreeks aanroepen. Ze omzetten naar echte module-exports
// (en elke inline handler herschrijven naar addEventListener) is een aparte,
// grotere en risicovollere refactor die bewust NIET in deze stap zit.
//
// Puur mechanische verhuizing — geen enkele regel logica gewijzigd.

// ── Mobiele navigatie ─────────────────────────────────────────────
function toggleMobileNav(){
  const nav=document.getElementById('mainNav');
  const btn=document.getElementById('hamBtn');
  const open=nav.classList.toggle('mob-open');
  btn.classList.toggle('mob-open',open);
  btn.setAttribute('aria-expanded',open);
}
function closeMobileNav(){
  const nav=document.getElementById('mainNav');
  const btn=document.getElementById('hamBtn');
  if(!nav) return;
  nav.classList.remove('mob-open');
  btn&&btn.classList.remove('mob-open');
  btn&&btn.setAttribute('aria-expanded','false');
}
// Sluit nav bij klik buiten topbar
document.addEventListener('click',e=>{
  const nav=document.getElementById('mainNav');
  if(nav&&nav.classList.contains('mob-open')&&!e.target.closest('.topbar')){closeMobileNav();}
},{passive:true});

// ── Bewegende achtergrond: het hele 3D-vlak kantelt mee met de muis
// (rotateX/rotateY op de scene, blobs staan op verschillende translateZ-
// diepten), puur decoratief en altijd achter de inhoud ──
(function(){
  const scene=document.getElementById('bgScene');
  if(!scene||window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const MAX_TILT=12;
  let rx=0,ry=0,raf=null;
  function apply(){
    scene.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
    raf=null;
  }
  window.addEventListener('mousemove',e=>{
    const nx=(e.clientX/window.innerWidth)*2-1;
    const ny=(e.clientY/window.innerHeight)*2-1;
    ry=nx*MAX_TILT;
    rx=-ny*MAX_TILT;
    if(!raf) raf=requestAnimationFrame(apply);
  },{passive:true});
})();

// ── Info-tooltips op KPI-kaarten en grafieken: één gedeeld tooltip-element
// dat meeluistert via event delegation, zodat het ook werkt voor kaarten
// die later dynamisch (her)getekend worden via innerHTML ──
(function(){
  const tip=document.createElement('div');
  tip.className='info-tip';
  document.body.appendChild(tip);
  function place(el){
    // body heeft op desktop zoom:.9 — getBoundingClientRect geeft visuele
    // (gezoomde) coördinaten terug, terwijl left/top op de tooltip (zelf ook
    // een gezoomd element) nogmaals met de factor vermenigvuldigd worden.
    // Alles omrekenen naar layout-pixels, anders staat de tip ~10% scheef.
    const z=parseFloat(getComputedStyle(document.body).zoom)||1;
    const rc=el.getBoundingClientRect();
    const r={left:rc.left/z,top:rc.top/z,bottom:rc.bottom/z,width:rc.width/z};
    const vw=window.innerWidth/z,vh=window.innerHeight/z;
    const tw=tip.offsetWidth,th=tip.offsetHeight;
    let x=r.left+r.width/2-tw/2;
    x=Math.max(8,Math.min(x,vw-tw-8));
    let y=r.bottom+8;
    if(y+th>vh-8) y=r.top-th-8;
    tip.style.left=x+'px';
    tip.style.top=y+'px';
  }
  document.addEventListener('mouseover',e=>{
    const el=e.target.closest('.info-i');
    if(!el) return;
    tip.textContent=el.dataset.tip||'';
    tip.classList.add('show');
    place(el);
  });
  document.addEventListener('mouseout',e=>{
    if(e.target.closest('.info-i')) tip.classList.remove('show');
  });
  // Touch-ondersteuning voor tooltips op mobiel
  document.addEventListener('touchstart',e=>{
    const el=e.target.closest('.info-i');
    if(!el){tip.classList.remove('show');return;}
    e.preventDefault();
    tip.textContent=el.dataset.tip||'';
    tip.classList.add('show');
    place(el);
  },{passive:false});
  document.addEventListener('touchend',e=>{
    if(e.target.closest('.info-i')) setTimeout(()=>tip.classList.remove('show'),2000);
  },{passive:true});
})();

// ── Chart.js-tooltip: zelf positioneren i.p.v. Chart.js' ingebouwde
// canvas-tooltip vertrouwen — die lijnde niet meer uit met de muis onder de
// CSS-zoom van deze app. Zelfde zoom-correctie als de info-i-tooltip
// hierboven; gedeeld door alle grafieken (lc/bc/pc/kdTrend). Elke chart-
// config zet plugins.tooltip:{enabled:false,external:externalTooltipHandler}
// i.p.v. Chart.js zelf te laten tekenen.
let _chartTip=null;
function chartTooltip(){
  if(_chartTip) return _chartTip;
  _chartTip=document.createElement('div');
  _chartTip.className='chart-tip';
  document.body.appendChild(_chartTip);
  return _chartTip;
}
function externalTooltipHandler(context){
  const{chart,tooltip}=context;
  const tip=chartTooltip();
  if(!tooltip||tooltip.opacity===0){tip.classList.remove('show');return;}
  const lines=[];
  if(tooltip.title&&tooltip.title.length) lines.push(`<div class="chart-tip-title">${esc(tooltip.title.join(' '))}</div>`);
  (tooltip.body||[]).forEach((b,i)=>{
    const lc=tooltip.labelColors&&tooltip.labelColors[i];
    const dot=lc?`<span class="chart-tip-dot" style="background:${lc.borderColor||lc.backgroundColor}"></span>`:'';
    lines.push(`<div class="chart-tip-line">${dot}${esc(b.lines.join(' '))}</div>`);
  });
  tip.innerHTML=lines.join('');
  tip.classList.add('show');
  // rect is in visuele (gezoomde) pixels; caretX/Y en chart.width/height staan
  // in dezelfde logische eenheid, dus het aandeel (caretX/chart.width) toepassen
  // op de echte rect-breedte blijft correct ongeacht de zoomfactor. Het
  // eindresultaat moet daarna wél weer door z gedeeld worden, want dit element
  // hangt (net als .info-tip) zelf ook binnen de gezoomde body.
  const z=parseFloat(getComputedStyle(document.body).zoom)||1;
  const rect=chart.canvas.getBoundingClientRect();
  const scaleX=rect.width/chart.width,scaleY=rect.height/chart.height;
  const vx=(rect.left+tooltip.caretX*scaleX)/z;
  const vy=(rect.top+tooltip.caretY*scaleY)/z;
  const vw=window.innerWidth/z,vh=window.innerHeight/z;
  const tw=tip.offsetWidth,th=tip.offsetHeight;
  let left=Math.max(8,Math.min(vx-tw/2,vw-tw-8));
  let top=vy-th-14;
  if(top<8) top=vy+14;
  tip.style.left=left+'px';
  tip.style.top=top+'px';
}

const SUPABASE_URL='https://gohmnfgpczaeoysamlwy.supabase.co';
const SUPABASE_KEY='sb_publishable_eoIJ0jmspVLW9u-9u7QeNA_IXTD8EwY';
// Service key is verplaatst naar /api/admin (serverless function)

let lcI=null,bcI=null,pcI=null,kdTrendI=null;
let weeks=[];
let currentUser=null;
let isAdmin=false;
// Rechten van de ingelogde gebruiker (dashboard/finance/rotterdam) — gezet in
// initApp() via fetchUserAccess(). Fail-open default: dashboard zichtbaar
// zolang de rechten (nog) niet geladen zijn of fase17 nog niet draait.
let userAccess={dashboard:true,finance:null,rotterdam:false,enforced:false};

// Haalt de module-rechten op via de gedeelde ESM-laag (js/modules/
// permissions.js, geëxposeerd op window.PlatformPermissions). Valt terug op
// het fail-open default als de modulelaag nog niet geladen is.
async function fetchUserAccess(){
  const p=window.PlatformPermissions;
  if(!p||typeof p.fetchAccess!=='function') return userAccess;
  return p.fetchAccess({
    sbUrl:SUPABASE_URL,sbKey:SUPABASE_KEY,
    token:currentUser?.access_token,isAdmin,
    email:currentUser?.user?.email
  });
}

// "Geen toegang"-pagina (spec: directe navigatie zonder rechten → nette
// pagina, geen console-fout). Dynamisch aangemaakt zodat index.html niet
// hoeft te wijzigen.
function ensureGeenToegangPage(){
  let pg=document.getElementById('pg-geen-toegang');
  if(pg) return pg;
  const main=document.querySelector('.main');
  if(!main) return null;
  pg=document.createElement('div');
  pg.className='pg';
  pg.id='pg-geen-toegang';
  pg.innerHTML=`<div class="whr"><div><div class="wt">Geen toegang</div><div class="ws">Je account heeft geen rechten voor dit onderdeel</div></div></div>
    <div class="tw" style="padding:32px;text-align:center">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">&#128274; Dit onderdeel is niet voor jouw account opengesteld</div>
      <div style="font-size:13px;color:var(--color-text-secondary);max-width:420px;margin:0 auto">Vraag een beheerder om je toegang te geven tot het dashboard- of financi&euml;ngedeelte.</div>
    </div>`;
  main.appendChild(pg);
  return pg;
}
function showGeenToegang(){
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
  const pg=ensureGeenToegangPage();
  if(pg) pg.classList.add('active');
}
// Pagina's die onder de dashboard-permissie vallen (het hele onderhoud-deel).
const DASHBOARD_PAGES=['dashboard','backlog','analyse','addweek','kpi-detail','week','rapport'];

// ── Supabase API helpers ──────────────────────────────────────
async function sbFetch(path,opts={}){
  await ensureFreshSession();                      // token verversen vóór gebruik
  const headers={'apikey':SUPABASE_KEY,'Content-Type':'application/json',...(opts.headers||{})};
  if(currentUser?.access_token) headers['Authorization']='Bearer '+currentUser.access_token;
  const r=await fetch(SUPABASE_URL+path,{...opts,headers});
  if(!r.ok){
    // Leesbare melding i.p.v. een rauwe JSON-blob in de statusbalk.
    let msg=await r.text();
    try{const j=JSON.parse(msg);msg=j.message||j.msg||j.error_description||j.error||msg;}catch(e){}
    throw new Error(msg||`HTTP ${r.status}`);
  }
  // Niet alleen 204 heeft een lege body — een insert/upsert (POST) zonder
  // 'Prefer: return=representation' geeft standaard 201 mét lege body terug.
  // r.json() op een lege body gooit "Unexpected end of JSON input", dus altijd
  // eerst als tekst lezen en alleen parsen als er iets staat.
  const text=await r.text();
  return text?JSON.parse(text):null;
}

async function loadWeeksFromDB(){
  try {
    const data = await sbFetch('/rest/v1/weeks?select=*&order=week.asc');
    weeks = (data || []).map(w => ({
      id: w.id,
      week: w.week,
      label: w.label,
      rows: w.rows || []
    }));
    return weeks;
  } catch (e) {
    showGlobalStatus('Fout bij laden weekplanning: ' + e.message, 'error');
    return [];
  }
}

async function saveWeekToDB(w){
  // Upsert: insert or update op basis van id
  await sbFetch('/rest/v1/weeks',{
    method:'POST',
    headers:{'Prefer':'resolution=merge-duplicates'},
    body:JSON.stringify({id:w.id,week:w.week,label:w.label,rows:w.rows})
  });
}

async function deleteWeekFromDB(wid){
  await sbFetch(`/rest/v1/weeks?id=eq.${wid}`,{method:'DELETE'});
}

// ── Admin check ───────────────────────────────────────────────
// Admin-status komt uit de user_roles-tabel (single source of truth).
async function checkAdminRole(email, accessToken){
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/user_roles?email=eq.${encodeURIComponent(email)}&select=role`,{
      headers:{
        'apikey':SUPABASE_KEY,
        'Authorization':'Bearer '+accessToken,
        'Content-Type':'application/json'
      }
    });
    const data=await r.json();
    return data&&data[0]&&data[0].role==='admin';
  }catch(e){
    console.error('Admin check fout:', e);
    return false;
  }
}

// ── Auth ──────────────────────────────────────────────────────
async function signIn(email,password){
  const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({email,password})
  });
  const data=await r.json();
  // Supabase geeft fouten terug als {code,error_code,msg} (geen "error"-veld),
  // dus de statuscode is de enige betrouwbare manier om mislukte logins te zien.
  if(!r.ok) throw new Error(data.msg||data.error_description||data.error||'Inloggen mislukt');
  return data;
}

async function signOut(){
  try{
    await fetch(SUPABASE_URL+'/auth/v1/logout',{
      method:'POST',
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser?.access_token}
    });
  }catch(e){}
  currentUser=null;isAdmin=false;weeks=[];
  window.__platformAuth=null;
  if(window.Platform&&window.Platform.onSignOut) window.Platform.onSignOut();
  localStorage.removeItem('sap_pm_session');
  showLoginScreen();
}

// ── Sessie vers houden ────────────────────────────────────────
// Het dashboard staat vaak dagenlang open (werkplaatsscherm). Zonder
// verversing verloopt het access token na ±1 uur en faalt elke opslag- en
// financiën-actie tot iemand opnieuw inlogt. We verversen daarom proactief:
// vlak vóór het verlopen (2 min marge), periodiek, én bij terugkeer naar
// het tabblad. De verversing behoudt het aal-niveau (2FA blijft geldig) en
// werkt door in de financiënmodule via window.__platformAuth (zelfde object).
let _sessionRefreshing=null;
async function ensureFreshSession(){
  if(!currentUser?.refresh_token) return;
  const exp=jwtPayload(currentUser.access_token).exp||0;
  if(exp-Date.now()/1000>120) return;              // nog ruim geldig
  if(_sessionRefreshing) return _sessionRefreshing; // één verversing tegelijk
  _sessionRefreshing=(async()=>{
    try{
      const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:currentUser.refresh_token})
      });
      const d=await r.json();
      if(r.ok&&d.access_token){
        currentUser=d;
        localStorage.setItem('sap_pm_session',JSON.stringify(d));
        if(window.__platformAuth) window.__platformAuth.currentUser=d;
      }
    }catch(e){/* offline — volgende poging via interval/focus */}
    finally{_sessionRefreshing=null;}
  })();
  return _sessionRefreshing;
}
setInterval(ensureFreshSession,5*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)ensureFreshSession();});

// ── Twee-factor authenticatie (TOTP) ──────────────────────────
// Leest het JWT-payload (alleen om de 'aal'-assurance-level te zien).
function jwtPayload(t){try{return JSON.parse(atob((t||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch(e){return {};}}
let _mfaEnroll=null;

async function mfaVerifiedFactors(token){
  const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+token}});
  if(!r.ok) return [];
  const u=await r.json();
  return (u.factors||[]).filter(f=>f.factor_type==='totp'&&f.status==='verified');
}
// Alleen FINANCIËN is 2FA-beveiligd. De financiënmodule roept hieronder
// requireFinanceAal2() aan vóór het tonen van data. De rest van het dashboard
// is gewoon toegankelijk met e-mail + wachtwoord (aal1).
let _financeMfaFactorId=null, _financeMfaResolve=null;
// Toont het finance-2FA-invoerscherm en geeft een Promise terug die resolvet
// met de nieuwe (aal2-)sessie bij succes, of null bij annuleren.
function financeStepUp(factorId){
  return new Promise(resolve=>{
    _financeMfaFactorId=factorId;
    _financeMfaResolve=resolve;
    const codeEl=document.getElementById('financeMfaCode');
    codeEl.value='';
    document.getElementById('financeMfaError').textContent='';
    document.getElementById('financeMfaModal').style.display='flex';
    setTimeout(()=>codeEl.focus(),50);
  });
}
async function submitFinanceMfa(){
  const code=(document.getElementById('financeMfaCode').value||'').trim();
  const errEl=document.getElementById('financeMfaError');
  if(!/^\d{6}$/.test(code)){errEl.textContent='Voer de 6-cijferige code in';return;}
  const btn=document.getElementById('financeMfaBtn');
  errEl.textContent=''; btn.disabled=true; btn.textContent='Controleren…';
  try{
    const ch=await fetch(`${SUPABASE_URL}/auth/v1/factors/${_financeMfaFactorId}/challenge`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser.access_token}});
    const chd=await ch.json(); if(!ch.ok) throw new Error(chd.msg||'Kon geen challenge starten');
    const r=await fetch(`${SUPABASE_URL}/auth/v1/factors/${_financeMfaFactorId}/verify`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser.access_token,'Content-Type':'application/json'},body:JSON.stringify({challenge_id:chd.id,code})});
    const d=await r.json(); if(!r.ok) throw new Error(d.msg||d.error_description||'Ongeldige code');
    currentUser=d;                                   // opgestapt naar aal2
    localStorage.setItem('sap_pm_session',JSON.stringify(d));
    if(window.__platformAuth) window.__platformAuth.currentUser=d;
    document.getElementById('financeMfaModal').style.display='none';
    const resolve=_financeMfaResolve; _financeMfaResolve=null;
    if(resolve) resolve(d);
  }catch(e){
    errEl.textContent=e.message;
  }finally{
    btn.disabled=false; btn.textContent='Ontgrendelen';
  }
}
function cancelFinanceMfa(){
  document.getElementById('financeMfaModal').style.display='none';
  const resolve=_financeMfaResolve; _financeMfaResolve=null;
  if(resolve) resolve(null);
}
// Geeft de (aal2-)sessie terug als toegang tot Financiën mag, anders null.
window.requireFinanceAal2=async function(){
  if(!currentUser) return null;
  if(jwtPayload(currentUser.access_token).aal==='aal2') return currentUser;
  const factors=await mfaVerifiedFactors(currentUser.access_token);
  if(!factors.length){ openMfaEnroll(true); return null; }
  return await financeStepUp(factors[0].id);
};

async function openMfaEnroll(required){
  const modal=document.getElementById('mfaEnrollModal');
  const qrEl=document.getElementById('mfaQr'), secEl=document.getElementById('mfaSecret'), errEl=document.getElementById('mfaEnrollError');
  const reasonEl=document.getElementById('mfaEnrollReason'), otpEl=document.getElementById('mfaOtpLink');
  if(reasonEl) reasonEl.style.display=required?'block':'none';
  errEl.textContent=''; document.getElementById('mfaEnrollCode').value=''; secEl.textContent=''; qrEl.textContent='Laden…';
  otpEl.style.display='none'; otpEl.href='#';
  modal.style.display='flex';
  try{
    const existing=await mfaVerifiedFactors(currentUser.access_token);
    if(existing.length){ qrEl.textContent='✓'; secEl.textContent='2FA is al actief op dit account.'; _mfaEnroll=null; return; }
    const r=await fetch(SUPABASE_URL+'/auth/v1/factors',{
      method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({factor_type:'totp',friendly_name:'Authenticator-'+Date.now()})
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d.msg||d.error_description||'Kon 2FA niet starten');
    _mfaEnroll={factorId:d.id};
    // Supabase geeft de QR soms terug als ruwe SVG-tekst mét XML-kopje ervoor
    // (bv. <?xml version="1.0"?><svg ...>), soms als data:-URI. Beide afvangen
    // i.p.v. alleen "begint met <svg" — anders wordt ruwe SVG-tekst per
    // ongeluk als plaatje-URL behandeld (kapot icoontje, laadt nooit).
    const qr=((d.totp&&d.totp.qr_code)||'').trim();
    if(qr.includes('<svg')){
      qrEl.innerHTML=qr.slice(qr.indexOf('<svg'));
      // Bug: Supabase's QR-SVG heeft vaak alleen width/height (bv. 264x264)
      // en geen viewBox. CSS verkleint de svg naar 200px via width/height —
      // zonder viewBox schaalt de tekening dan niet mee, maar wordt hij
      // afgesneden tot de linkerbovenhoek (precies "niet de hele QR-code
      // zichtbaar op het scherm"). Fix: viewBox toevoegen op basis van de
      // eigen width/height-attributen, zodat schalen wél proportioneel gaat.
      const svgEl=qrEl.querySelector('svg');
      if(svgEl&&!svgEl.getAttribute('viewBox')){
        const w=parseFloat(svgEl.getAttribute('width'))||200;
        const h=parseFloat(svgEl.getAttribute('height'))||200;
        svgEl.setAttribute('viewBox',`0 0 ${w} ${h}`);
      }
    }
    else if(qr.startsWith('data:')) qrEl.innerHTML=`<img alt="QR-code" src="${esc(qr)}">`;
    else qrEl.textContent='(QR-code niet beschikbaar in dit formaat — gebruik de sleutel hieronder)';
    secEl.textContent=(d.totp&&d.totp.secret)||'';
    // otpauth://-deeplink: als je het dashboard zelf op je telefoon bekijkt,
    // kun je met diezelfde telefoon je eigen scherm niet scannen. Deze knop
    // opent de authenticator-app direct, zonder camera.
    const uri=(d.totp&&d.totp.uri)||'';
    if(uri){ otpEl.href=uri; otpEl.style.display='block'; }
  }catch(e){ qrEl.textContent=''; errEl.textContent=e.message; }
}
function copyMfaSecret(){
  const s=(document.getElementById('mfaSecret').textContent||'').trim();
  if(!s||!navigator.clipboard) return;
  navigator.clipboard.writeText(s).then(()=>showGlobalStatus('Sleutel gekopieerd','success')).catch(()=>{});
}
async function submitMfaEnroll(){
  const code=(document.getElementById('mfaEnrollCode').value||'').trim();
  const errEl=document.getElementById('mfaEnrollError');
  if(!_mfaEnroll){errEl.textContent='Start het instellen opnieuw';return;}
  if(!/^\d{6}$/.test(code)){errEl.textContent='Voer de 6-cijferige code in';return;}
  errEl.textContent='';
  try{
    const ch=await fetch(`${SUPABASE_URL}/auth/v1/factors/${_mfaEnroll.factorId}/challenge`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser.access_token}});
    const chd=await ch.json(); if(!ch.ok) throw new Error(chd.msg||'Kon geen challenge starten');
    const r=await fetch(`${SUPABASE_URL}/auth/v1/factors/${_mfaEnroll.factorId}/verify`,{
      method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({challenge_id:chd.id,code})
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d.msg||d.error_description||'Ongeldige code');
    if(d.access_token){ currentUser=d; localStorage.setItem('sap_pm_session',JSON.stringify(d)); }  // opgestapt naar aal2
    _mfaEnroll=null;
    document.getElementById('mfaEnrollModal').style.display='none';
    showGlobalStatus('✓ Twee-factor authenticatie is nu actief','success');
  }catch(e){ errEl.textContent=e.message; }
}
function closeMfaEnroll(){ _mfaEnroll=null; document.getElementById('mfaEnrollModal').style.display='none'; }

// Accountmenu (2FA/wachtwoord/uitloggen gebundeld i.p.v. drie losse knoppen).
function toggleAcctMenu(){
  const m=document.getElementById('acctMenu'),btn=document.getElementById('acctMenuBtn');
  const open=m.style.display==='none'||!m.style.display;
  m.style.display=open?'block':'none';
  btn.setAttribute('aria-expanded',open?'true':'false');
}
function closeAcctMenu(){
  const m=document.getElementById('acctMenu'),btn=document.getElementById('acctMenuBtn');
  if(m) m.style.display='none';
  if(btn) btn.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
  const wrap=document.querySelector('.acct-menu-wrap');
  if(wrap&&!wrap.contains(e.target)) closeAcctMenu();
});

// Toetsenbord: Enter/spatie activeert klikbare rijen (drilldowns) die met
// tabindex bereikbaar zijn gemaakt — anders zijn die muis-exclusief.
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches&&e.target.matches('tr[tabindex]')){
    e.preventDefault();e.target.click();
  }
});

// Escape sluit open pop-ups (2FA-vensters) en het mobiele menu — het
// universele "laat me hier weg"-gebaar dat iedereen instinctief probeert.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  const fin=document.getElementById('financeMfaModal');
  if(fin&&fin.style.display!=='none'&&fin.style.display!==''){cancelFinanceMfa();return;}
  const enr=document.getElementById('mfaEnrollModal');
  if(enr&&enr.style.display!=='none'&&enr.style.display!==''){closeMfaEnroll();return;}
  const fgt=document.getElementById('forgotPasswordModal');
  if(fgt&&fgt.style.display!=='none'&&fgt.style.display!==''){closeForgotPassword();return;}
  const rst=document.getElementById('resetPasswordModal');
  if(rst&&rst.style.display!=='none'&&rst.style.display!==''){closeResetPassword();return;}
  const acct=document.getElementById('acctMenu');
  if(acct&&acct.style.display==='block'){closeAcctMenu();return;}
  if(typeof closeMobileNav==='function') closeMobileNav();
});

// ── Login UI ──────────────────────────────────────────────────
function showLoginScreen(){
  document.getElementById('appShell').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginError').textContent='';
  document.getElementById('loginEmail').value='';
  document.getElementById('loginPassword').value='';
}

// ── Wachtwoord vergeten / opnieuw instellen ───────────────────
function openForgotPassword(){
  const modal=document.getElementById('forgotPasswordModal');
  document.getElementById('forgotEmail').value=document.getElementById('loginEmail').value||'';
  document.getElementById('forgotError').textContent='';
  modal.style.display='flex';
  setTimeout(()=>document.getElementById('forgotEmail').focus(),50);
}
function closeForgotPassword(){
  document.getElementById('forgotPasswordModal').style.display='none';
}
async function submitForgotPassword(){
  const email=(document.getElementById('forgotEmail').value||'').trim();
  const errEl=document.getElementById('forgotError');
  const btn=document.getElementById('forgotBtn');
  if(!email){errEl.textContent='Vul een e-mailadres in';return;}
  errEl.textContent=''; btn.disabled=true; btn.textContent='Versturen…';
  try{
    await fetch(SUPABASE_URL+'/auth/v1/recover',{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
  }catch(e){/* netwerkfout wordt bewust niet apart getoond, zie hieronder */}
  // Altijd dezelfde melding, ongeacht of het adres bestaat: anders kan een
  // aanvaller via het verschil in respons ontdekken welke e-mailadressen
  // geregistreerd zijn (user-enumeration).
  btn.disabled=false; btn.textContent='Verstuur resetlink';
  errEl.style.color='#3fb950';
  errEl.textContent='Als dit adres bekend is, is er een resetlink verstuurd. Controleer je inbox.';
}
function closeResetPassword(){
  document.getElementById('resetPasswordModal').style.display='none';
}
async function submitPasswordReset(){
  const pw1=document.getElementById('resetPassword1').value;
  const pw2=document.getElementById('resetPassword2').value;
  const errEl=document.getElementById('resetError');
  const btn=document.getElementById('resetBtn');
  if(!pw1||pw1.length<12){errEl.textContent='Wachtwoord moet minimaal 12 tekens zijn';return;}
  if(pw1!==pw2){errEl.textContent='Wachtwoorden komen niet overeen';return;}
  if(!window._recoverySession){errEl.textContent='Resetlink verlopen — vraag een nieuwe aan';return;}
  errEl.textContent=''; btn.disabled=true; btn.textContent='Bezig…';
  try{
    const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
      method:'PUT',
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+window._recoverySession.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({password:pw1})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.msg||data.error_description||data.error||'Wachtwoord instellen mislukt');
    // PUT /auth/v1/user geeft het user-object terug, geen sessie — de sessie
    // (access_token/refresh_token) kwam al mee in de resetlink zelf. Samen
    // vormen ze exact dezelfde vorm die signIn() ook teruggeeft
    // ({access_token,refresh_token,user:{email,...}}), zodat currentUser
    // overal (bv. currentUser.user.email) op dezelfde manier werkt.
    currentUser={...window._recoverySession,user:data};
    localStorage.setItem('sap_pm_session',JSON.stringify(currentUser));
    closeResetPassword();
    window._recoverySession=null;
    await initApp();
    showGlobalStatus('✓ Wachtwoord ingesteld — je bent ingelogd','success');
  }catch(e){
    errEl.textContent=e.message;
  }finally{
    btn.disabled=false; btn.textContent='Wachtwoord instellen';
  }
}
// Supabase's resetlink redirect bevat de sessie in de URL-hash
// (#access_token=...&type=recovery&refresh_token=...), niet als queryparameter
// — die wordt om privacyredenen nooit naar een server gestuurd. Bij het laden
// van de pagina checken we of dit zo'n link is en tonen dan direct het
// nieuw-wachtwoord-scherm i.p.v. het normale inlogscherm.
function checkPasswordRecoveryLink(){
  const hash=window.location.hash||'';
  if(!hash.includes('type=recovery')) return false;
  const params=new URLSearchParams(hash.replace(/^#/,''));
  const access_token=params.get('access_token');
  if(!access_token) return false;
  window._recoverySession={access_token,refresh_token:params.get('refresh_token')||null,token_type:params.get('token_type')||'bearer'};
  history.replaceState(null,'',window.location.pathname+window.location.search); // hash niet laten staan (bv. bij verversen)
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('resetPassword1').value='';
  document.getElementById('resetPassword2').value='';
  document.getElementById('resetError').textContent='';
  document.getElementById('resetPasswordModal').style.display='flex';
  return true;
}

function showAppShell(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appShell').style.display='block';
  // isAdmin is op dit punt al gezet door initApp() via checkAdminRole()
  document.querySelectorAll('.admin-only').forEach(el=>{
    el.style.display=isAdmin?'':'none';
  });
  document.querySelectorAll('.nt.add').forEach(el=>{
    el.style.display=(isAdmin&&userAccess.dashboard)?'':'none';
  });
  // Zonder dashboard-permissie: onderhoud-navigatie verbergen (niet
  // disablen — spec: verborgen). Financiën voegt zijn eigen knop toe via
  // de modulelaag, die blijft werken.
  ['navDash','navBacklog','navAnalyse','wkTabs'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=userAccess.dashboard?'':'none';
  });
  const userEl=document.getElementById('acctMenuEmail');
  if(userEl) userEl.textContent=currentUser?.user?.email||'';
  // Platform-modulelaag informeren over de auth-status (Fase 1: financiënmodule).
  // access meegeven zodat modules niet elk dezelfde rechten-fetch herhalen.
  window.__platformAuth={currentUser,isAdmin,access:userAccess,sbUrl:SUPABASE_URL,sbKey:SUPABASE_KEY};
  if(window.Platform&&window.Platform.onAuth) window.Platform.onAuth(window.__platformAuth);
}

async function handleLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pw=document.getElementById('loginPassword').value;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  if(!email||!pw){errEl.textContent='Vul e-mail en wachtwoord in';return;}
  btn.textContent='Inloggen...';btn.disabled=true;
  try{
    const session=await signIn(email,pw);          // simpele login; 2FA alleen voor Financiën
    currentUser=session;
    localStorage.setItem('sap_pm_session',JSON.stringify(session));
    await initApp();
  }catch(e){
    errEl.textContent=e.message==='Invalid login credentials'?'Ongeldig e-mailadres of wachtwoord':e.message;
  }
  btn.textContent='Inloggen';btn.disabled=false;
}

async function initApp(){
  isAdmin=await checkAdminRole(currentUser?.user?.email, currentUser?.access_token);
  userAccess=await fetchUserAccess();
  showAppShell();
  // Zonder dashboard-permissie: geen weekdata laden (RLS blokkeert die toch).
  // Met finance-toegang landt de gebruiker op de startpagina (die toont dan
  // alleen de Financiën-kaart — de 2FA-stap komt pas bij het openen, niet
  // ongevraagd als modal bij het inloggen); anders de "Geen toegang"-pagina.
  if(!userAccess.dashboard){
    if(userAccess.finance) showPage('home');
    else showGeenToegang();
    return;
  }
  showGlobalStatus('Data laden...','info');
  try{
    const dbWeeks=await loadWeeksFromDB();
    if(dbWeeks.length){
      weeks=dbWeeks;
    } else {
      // Eerste keer: seed standaarddata naar DB
      weeks=getDefaultWeeks();
      for(const w of weeks) await saveWeekToDB(w);
      showGlobalStatus('Standaarddata (W19–W24) geladen en opgeslagen.','success');
    }
  }catch(e){
    showGlobalStatus('Fout bij laden: '+e.message,'error');
    weeks=getDefaultWeeks();
  }
  rebuildWkPages();refreshTabs();refreshFilter();renderDash();
  // Landen op de startpagina (modulekeuze + signalen); het dashboard is één
  // klik of Ctrl+K verderop.
  showPage('home');
  // Invoerformulier verse start: eerst leegmaken, anders stapelen er bij
  // elke (her)login twee extra lege rijen bovenop de bestaande.
  document.getElementById('nRows').innerHTML='';
  for(let i=0;i<2;i++) addRow();
}

// Timer bijhouden en resetten: anders wist de (nog lopende) timer van een
// eerdere melding de nieuwe melding voortijdig van het scherm.
let _statusTimer=null;
function showGlobalStatus(msg,type){
  const el=document.getElementById('globalStatus');
  if(!el)return;
  el.innerHTML=`<div class="gstatus ${type||'info'}">${msg}</div>`;
  clearTimeout(_statusTimer);
  _statusTimer=setTimeout(()=>{el.innerHTML='';},7000);
}


function getDefaultWeeks(){return[
    {id:'w19',week:19,label:'4–8 mei 2026',rows:[
      {day:'Ma',wo:'11870431',omschrijving:'KL4711: K8/S4 ventiel lekt',wie:'Jeroen',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11863602',omschrijving:'KM4720: moeren nazien binnenste ring',wie:'Sjoerd, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11866496',omschrijving:'CO4711: lekkage persleiding',wie:'Sjoerd, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11859805',omschrijving:'OV4731: waaier schoonmaken',wie:'Jeroen',type:'gepland',status:'nee'},
      {day:'Di',wo:'31858073',omschrijving:'KR2410: inspectie & smeren 1-wekelijks',wie:'Sjoerd, Nello, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'32006498',omschrijving:'TB2410: controle alle rolstellen',wie:'Sjoerd, Nello, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052501',omschrijving:'GT2400A: inspectie 12-wekelijks',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Di',wo:'11878315',omschrijving:'Diverse luchtlekkages KL2311 e.a.',wie:'Jeroen',type:'gepland',status:'nee'},
      {day:'Wo',wo:'11729163',omschrijving:'TB2420: controle alle rolstellen',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Wo',wo:'32052510',omschrijving:'Inspectie GT2400B 12-wekelijks',wie:'Jeroen, Lars',type:'gepland',status:'ja'},
      {day:'Wo',wo:'32006428',omschrijving:'FI4913: V-snaren inspecteren/vervangen',wie:'Jeroen, Lars',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11857157',omschrijving:'TB2420: rolletje 120 kapot lager',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Do',wo:'32052539',omschrijving:'PG5210: aanzuigfilter vervangen',wie:'Nello',type:'gepland',status:'ja'},
      {day:'Do',wo:'32052540',omschrijving:'PG5230: aanzuigfilter vervangen',wie:'Nello',type:'gepland',status:'ja'},
      {day:'Do',wo:'32052477',omschrijving:'CT5200: inspectie en smeren',wie:'Jeroen, Sjoerd',type:'gepland',status:'nee'},
      {day:'Do',wo:'32052557',omschrijving:'VE6200: inspectie en smeren',wie:'Jeroen, Sjoerd',type:'gepland',status:'nee'},
      {day:'Vr',wo:'32006436',omschrijving:'GB0050: werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'ja'},
      {day:'Vr',wo:'32052479',omschrijving:'OV3321: lagers waaier vervangen',wie:'Jeroen, Sjoerd',type:'gepland',status:'ja'},
      {day:'Vr',wo:'11811225',omschrijving:'PG5310: lager klinkt rauw',wie:'Nello',type:'gepland',status:'nee'},
      {day:'Vr',wo:'11862927',omschrijving:'OV6321: waaier staat te trillen',wie:'Nello',type:'gepland',status:'ja'},
    ]},
    {id:'w20',week:20,label:'11–15 mei 2026',rows:[
      {day:'Ma',wo:'11859805',omschrijving:'OV4731: waaier schoonmaken',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11863602',omschrijving:'KM4720: moeren nazien binnenste ring',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11876109',omschrijving:'PO4710: nieuwe resopal plaat',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Di',wo:'31858073',omschrijving:'KR2410: inspectie & smeren 1-wekelijks',wie:'Nello, Thomas',type:'gepland',status:'ja'},
      {day:'Di',wo:'32006498',omschrijving:'TB2410: controle alle rolstellen',wie:'Nello, Thomas',type:'gepland',status:'ja'},
      {day:'Di',wo:'32006614',omschrijving:'OI2471: filterslangen vervangen',wie:'Nello, Thomas',type:'gepland',status:'ja'},
      {day:'Di',wo:'11793550',omschrijving:'KL3610: stangenijzer repareren',wie:'—',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11882139',omschrijving:'DB4720: voorbereiden voor bandwissel',wie:'Thomas, Nello',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11881617',omschrijving:'KM4720: gaten in bordes uitlooplager',wie:'Thomas, Nello',type:'gepland',status:'ja'},
      {day:'Wo',wo:'32006436',omschrijving:'GB0050: werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'ja'},
    ]},
    {id:'w21',week:21,label:'18–22 mei 2026',rows:[
      {day:'Ma',wo:'11870431',omschrijving:'KL4711: K8/S4 ventiel lekt',wie:'Jeroen, Thomas',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11863602',omschrijving:'KM4720: moeren nazien binnenste ring',wie:'Sjoerd, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11866496',omschrijving:'CO4711: lekkage persleiding',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Ma',wo:'11859805',omschrijving:'OV4731: waaier schoonmaken',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Di',wo:'31858073',omschrijving:'KR2410: inspectie & smeren',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Di',wo:'32006498',omschrijving:'TB2410: controle alle rolstellen',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Di',wo:'11870997',omschrijving:'TB2330: insnoerrol plaatsen',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Di',wo:'11831959',omschrijving:'KR2410: bedieningsstoel vervangen',wie:'Spobu, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'11878315',omschrijving:'Diverse luchtlekkages',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11873794',omschrijving:'DB2410: lagers vervangen staarttrommel',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Wo',wo:'32052481',omschrijving:'DB2410: schrapers en morsrubbers',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Wo',wo:'32052475',omschrijving:'SK5110: ketting en ski inspecteren',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Do',wo:'11878318',omschrijving:'Diverse luchtlekkages',wie:'Jeroen, Thomas',type:'gepland',status:'nee'},
      {day:'Do',wo:'11880330',omschrijving:'EL2310: instroom repareren',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Do',wo:'11875548',omschrijving:'TB2320: 2 ringen rollen versleten',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Do',wo:'11884396',omschrijving:'OL2471: vervangen luchtsluis (voorbereiden)',wie:'Wesley, Max, Lars',type:'gepland',status:'ja'},
      {day:'Vr',wo:'32006436',omschrijving:'GB0050: werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'ja'},
      {day:'Vr',wo:'11811225',omschrijving:'PG5310: lager klinkt rauw',wie:'Jeroen, Thomas',type:'gepland',status:'nee'},
      {day:'Vr',wo:'11871968',omschrijving:'GB0050: diverse revisies kleppen',wie:'Nello, Sjoerd',type:'gepland',status:'nee'},
      {day:'Vr',wo:'11884396',omschrijving:'OL2471: vervangen luchtsluis',wie:'Nello, Max, Lars',type:'gepland',status:'ja'},
    ]},
    {id:'w22',week:22,label:'25–29 mei 2026',rows:[
      {day:'Di',wo:'11873794',omschrijving:'DB2410: zuid lager stuk',wie:'Jeroen, Thomas, Lars',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052481',omschrijving:'DB2410: schrapers en morsrubbers',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052482',omschrijving:'DB2420: schrapers en morsrubbers',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052483',omschrijving:'DB2430: schrapers en morsrubbers',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Di',wo:'11882560',omschrijving:'DB2440: morsrubber noordzijde versleten',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052485',omschrijving:'DB2450: schrapers en morsrubbers',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Di',wo:'32052486',omschrijving:'DB2460: schrapers en morsrubbers',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Wo',wo:'—',omschrijving:'TB2410: geleiderol verwijderen',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Wo',wo:'—',omschrijving:'TB2330: geleiderol plaatsen onderpart',wie:'Sjoerd, Nello',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11882139',omschrijving:'DB4720: oppervlak band beschadigingen',wie:'Jeroen, Thomas',type:'gepland',status:'nee'},
      {day:'Wo',wo:'11873794',omschrijving:'DB2410: zuid lager stuk',wie:'Jeroen, Thomas',type:'gepland',status:'ja'},
      {day:'Do',wo:'23303735',omschrijving:'KM4910: oliekoelers oostzijde vervangen',wie:'Nello, Sjoerd',type:'gepland',status:'nee'},
      {day:'Do',wo:'12149547',omschrijving:'TK4910: luchtfilter vervangen',wie:'Jeroen, Thomas, Lars',type:'gepland',status:'nee'},
      {day:'Do',wo:'—',omschrijving:'BP4914: bedrijfspomp vervangen',wie:'Jeroen, Thomas, Lars',type:'gepland',status:'nee'},
      {day:'Vr',wo:'32006436',omschrijving:'GB0050: werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'nee'},
      {day:'Vr',wo:'11850733',omschrijving:'RK5350: lekkage pakking',wie:'Nello, Sjoerd',type:'gepland',status:'nee'},
      {day:'Vr',wo:'—',omschrijving:'KM4720: afgebroken bout plaatsen',wie:'—',type:'ongepland',status:'nee'},
      {day:'Vr',wo:'—',omschrijving:'TB2330: onderrol verplaatsen',wie:'—',type:'ongepland',status:'nee'},
      {day:'Vr',wo:'—',omschrijving:'TW0010: riolering aansluiten',wie:'—',type:'ongepland',status:'nee'},
    ]},
    {id:'w23',week:23,label:'1–5 juni 2026',rows:[
      {day:'Ma',wo:'11870431',omschrijving:'KL4711: K8/S4 ventiel lekt',wie:'Jeroen, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11863602',omschrijving:'KM4720: moeren nazien binnenste ring',wie:'Jeroen, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11870432',omschrijving:'KL4712: ventiel lucht lekkage',wie:'Jeroen, Nello',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11882139',omschrijving:'DB4720: oppervlak band beschadigingen',wie:'Sjoerd, Thomas, Lars',type:'gepland',status:'nee'},
      {day:'Ma',wo:'11886092',omschrijving:'LS2481: vervangen luchtsluis',wie:'Nello, Lars',type:'ongepland',status:'ja'},
      {day:'Ma',wo:'11887361',omschrijving:'TW0010: aanhelen riolering',wie:'Thomas, Sjoerd',type:'ongepland',status:'nee'},
      {day:'Ma',wo:'11887259',omschrijving:'KM4720: openen/sluiten K2 eindwand',wie:'Thomas, Sjoerd',type:'ongepland',status:'ja'},
      {day:'Di',wo:'11878318',omschrijving:'Diverse luchtlekkages',wie:'Jeroen, Thomas',type:'gepland',status:'nee'},
      {day:'Di',wo:'31858073',omschrijving:'KR2410: inspectie & smeren',wie:'Sjoerd, Nello, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'32006498',omschrijving:'TB2410: controle alle rolstellen',wie:'Sjoerd, Nello, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'11886092',omschrijving:'LS2481: vervangen luchtsluis',wie:'Sjoerd, Nello, Evert',type:'gepland',status:'ja'},
      {day:'Di',wo:'11886776',omschrijving:'TB3150: band loopt scheef',wie:'Jeroen, Nello',type:'ongepland',status:'ja'},
      {day:'Di',wo:'11886585',omschrijving:'TB2330: scheefloop nastellen',wie:'Jeroen, Nello',type:'ongepland',status:'ja'},
      {day:'Wo',wo:'11880424',omschrijving:'OI2471: fluortest van dijk',wie:'van Dijk, Max',type:'gepland',status:'ja'},
      {day:'Wo',wo:'23303735',omschrijving:'KM4910: oliekoelers oostzijde vervangen',wie:'Nello, Sjoerd',type:'gepland',status:'nee'},
      {day:'Wo',wo:'11876109',omschrijving:'PO4710: resopalplaatjes plaatsen',wie:'Nello, Sjoerd',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11886776',omschrijving:'TB3150: band loopt scheef',wie:'Jeroen, Nello',type:'ongepland',status:'nee'},
      {day:'Do',wo:'11886093',omschrijving:'SC5270: flinke luchtlekkage',wie:'Jeroen, Sjoerd',type:'gepland',status:'nee'},
      {day:'Do',wo:'11886094',omschrijving:'SC5252: wil niet schakelen',wie:'Jeroen, Sjoerd',type:'gepland',status:'nee'},
      {day:'Do',wo:'32006386',omschrijving:'CT5200: inspectiewerkzaamheden',wie:'Nello, Evert',type:'gepland',status:'ja'},
      {day:'Do',wo:'32052557',omschrijving:'VE6200: inspectie en smeren',wie:'Nello, Evert',type:'gepland',status:'ja'},
      {day:'Do',wo:'11886776',omschrijving:'TB3150: band scheef repareren',wie:'Jeroen, Nello',type:'ongepland',status:'ja'},
      {day:'Vr',wo:'11871968',omschrijving:'GB0050: revisies kleppen en schuiven',wie:'Nello',type:'gepland',status:'uc'},
      {day:'Vr',wo:'11860941',omschrijving:'KM4910: zaken rondom molenmotor',wie:'Sjoerd, Thomas',type:'gepland',status:'uc'},
      {day:'Vr',wo:'32052479',omschrijving:'CT5300: inspectie en smeren',wie:'Jeroen, Nello',type:'gepland',status:'nee'},
      {day:'Vr',wo:'32006436',omschrijving:'GB0050: werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'deels'},
      {day:'Vr',wo:'11886776',omschrijving:'TB3150: band scheef repareren',wie:'Jeroen, Nello',type:'ongepland',status:'ja'},
    ]},
    {id:'w24',week:24,label:'8–12 juni 2026',rows:[
      {day:'Ma',wo:'11882139',omschrijving:'DB4720: oppervlak band beschadigingen',wie:'Sjoerd, Thomas, Nello',type:'gepland',status:'ja'},
      {day:'Ma',wo:'—',omschrijving:'GB4910: 100 punten inspectie',wie:'H&S',type:'gepland',status:'uc'},
      {day:'Di',wo:'11879557',omschrijving:'VE6200: borden weegbruggen ophangen (1/2e af)',wie:'Nello, Lars',type:'gepland',status:'uc'},
      {day:'Di',wo:'11872827',omschrijving:'SC4043: cilinder omwisselen',wie:'Nello, Lars',type:'gepland',status:'nee'},
      {day:'Di',wo:'11886094',omschrijving:'SC5252: schuif staat vast, controleren/vervangen',wie:'Thomas, Sjoerd',type:'gepland',status:'nee'},
      {day:'Di',wo:'—',omschrijving:'GB4910: 100 punten inspectie',wie:'H&S',type:'gepland',status:'uc'},
      {day:'Di',wo:'11889336',omschrijving:'EL5210: scheefloop, lekkage verhelpen (Facta)',wie:'Sjoerd, Thomas, Pietje',type:'ongepland',status:'ja'},
      {day:'Di',wo:'—',omschrijving:'Riolering reparatie Brudi',wie:'Brudi',type:'ongepland',status:'uc'},
      {day:'Di',wo:'11877962',omschrijving:'CV010: leiding lassen (afgelast, morgen verder)',wie:'Velmon',type:'ongepland',status:'uc'},
      {day:'Wo',wo:'23303735',omschrijving:'KM4910: oliekoelers oostzijde vervangen',wie:'Sjoerd, Lars',type:'gepland',status:'nee'},
      {day:'Wo',wo:'12149547',omschrijving:'TK4910: luchtfilter aan vervanging toe',wie:'Sjoerd, Lars',type:'gepland',status:'nee'},
      {day:'Wo',wo:'11860941',omschrijving:'ML4900: restpunten E-motor',wie:'Thomas, Nello',type:'gepland',status:'deels'},
      {day:'Wo',wo:'11872838',omschrijving:'EL5210: voorbereiden vloeistofkoppeling wisselen',wie:'Nello, Lars',type:'gepland',status:'ja'},
      {day:'Wo',wo:'11879557',omschrijving:'GB6210: SkyBond borden ophangen',wie:'Nello, Lars',type:'gepland',status:'ja'},
      {day:'Wo',wo:'—',omschrijving:'GB4910: 100 punten inspectie',wie:'H&S',type:'gepland',status:'uc'},
      {day:'Wo',wo:'—',omschrijving:'CV0010: gasleiding laatste stuk plaatsen',wie:'Velmon',type:'ongepland',status:'ja'},
      {day:'Wo',wo:'—',omschrijving:'TW0010: aanpassen hemelwaterafvoer (thv turbinegebouwen)',wie:'Brudi',type:'ongepland',status:'nee'},
      {day:'Do',wo:'11878318',omschrijving:'Diverse luchtlekkages (KL2311, KL4822, KL4935, KL4944)',wie:'Thomas, Sjoerd',type:'gepland',status:'nee'},
      {day:'Do',wo:'31858073',omschrijving:'KR2410: inspectie & smeren 1-wekelijks',wie:'Nello, Evert',type:'gepland',status:'ja'},
      {day:'Do',wo:'32006498',omschrijving:'TB2410: controle alle rolstellen',wie:'Nello, Evert',type:'gepland',status:'ja'},
      {day:'Do',wo:'11886092',omschrijving:'LS2482: vervangen luchtsluis',wie:'Thomas, Sjoerd',type:'gepland',status:'ja'},
      {day:'Do',wo:'11827596',omschrijving:'TB2420: controle rollen en smeren keerwielen',wie:'Nello, Evert',type:'gepland',status:'nee'},
      {day:'Do',wo:'—',omschrijving:'GB4910: 100 punten inspectie',wie:'H&S',type:'gepland',status:'uc'},
      {day:'Do',wo:'11888945',omschrijving:'PO3613: flow meters niet betrouwbaar (switches schoonmaken)',wie:'Gijs, Lars',type:'ongepland',status:'ja'},
      {day:'Vr',wo:'11871968',omschrijving:'GB0050: diverse revisies kleppen en schuiven',wie:'Nello',type:'gepland',status:'uc'},
      {day:'Vr',wo:'11860941',omschrijving:'KM4910: zaken rondom molenmotor',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Vr',wo:'—',omschrijving:'GB0050: televisie omhangen',wie:'Nello, Thomas',type:'gepland',status:'ja'},
      {day:'Vr',wo:'11886583',omschrijving:'KL6330: luchtlekkage',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Vr',wo:'11886584',omschrijving:'CV0014: reduceer tussen RK6313/14 lekt',wie:'Nello, Thomas',type:'gepland',status:'nee'},
      {day:'Vr',wo:'32052479',omschrijving:'CT5300: inspectie en smeren',wie:'Evert',type:'gepland',status:'ja'},
      {day:'Vr',wo:'32052559',omschrijving:'VE6300: inspectie en smeren',wie:'Evert',type:'gepland',status:'ja'},
      {day:'Vr',wo:'32006436',omschrijving:'GB0050: lasbox, oliemagazijn en werkplaats schoonmaken',wie:'Allen',type:'gepland',status:'ja'},
      {day:'Vr',wo:'—',omschrijving:'GB4910: 100 punten inspectie',wie:'H&S',type:'gepland',status:'uc'},
    ]}
  ];}

// ── Excel parser ──────────────────────────────────────────────────
// parseStatus, DAGNAMEN en parseExcelSheet staan in parser.js (gedeeld met
// de testsuite in test/parser.test.js).

async function handleExcelUpload(inp){
  if(!inp.files.length) return;
  if(!isAdmin){showGlobalStatus('Geen rechten om Excel te uploaden.','error');return;}
  const file=inp.files[0];
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:false});
      const alleWeken=wb.SheetNames
        .filter(name=>name!=='Samenvatting')
        .map(name=>parseExcelSheet(XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''})))
        .filter(r=>r&&r.rows.length);

      if(!alleWeken.length){
        showUploadStatus('Geen weken met werkorders gevonden. Controleer het Excel-format.','error');
        return;
      }

      // De master-Excel bevat doorgaans alle weken van het jaar (verleden,
      // heden, toekomst), maar alleen de zojuist afgesloten week ("vorige
      // week" t.o.v. vandaag) is nieuwe informatie om te verwerken. Eerdere
      // weken staan al vast en horen niet stilzwijgend overschreven te
      // worden door een hernieuwde upload van hetzelfde bestand; latere
      // (huidige/toekomstige) weken zijn nog niet afgerond.
      // Uitzondering: bevat het bestand maar één week (bv. bewust één
      // tabblad los geëxporteerd), dan is dat een expliciete keuze van de
      // gebruiker — die gaat altijd door, ongeacht welke week het is.
      const doel=isoWeekJustFinished(new Date());
      const results=alleWeken.length===1?alleWeken:alleWeken.filter(r=>r.weekNum===doel.week&&r.yearNum===doel.year);
      const genegeerd=alleWeken.length===1?[]:alleWeken.filter(r=>!(r.weekNum===doel.week&&r.yearNum===doel.year));

      if(!results.length){
        const lijst=alleWeken.map(r=>`${r.weekNum} (${r.yearNum})`).join(', ');
        showUploadStatus(`De zojuist afgesloten week (W${doel.week}, ${doel.year}) staat niet in dit bestand — er is niets aangepast. Wel gevonden: week ${lijst}.`,'error');
        return;
      }

      // Toon altijd een preview met aantallen per week/type vóór er iets wordt
      // opgeslagen, zodat een fout in het Excel-format (bv. 0 rijen, of een
      // verkeerde gepland/ongepland-verdeling) meteen opvalt in plaats van
      // pas achteraf.
      const negeerRegel=genegeerd.length?`\n\n(${genegeerd.length} andere week(en) in dit bestand genegeerd — die staan al vast of zijn nog niet afgerond: ${genegeerd.map(r=>r.weekNum).join(', ')})`:'';
      const preview=results.map(r=>{
        const gepland=r.rows.filter(x=>x.type==='gepland').length;
        const ongepland=r.rows.filter(x=>x.type==='ongepland').length;
        const wid='w'+r.weekNum;
        const existing=weeks.findIndex(w=>w.id===wid);
        const mark=existing>=0?' (overschrijft bestaande week)':'';
        return `Week ${r.weekNum}: ${r.rows.length} WO's — ${gepland} gepland, ${ongepland} ongepland${mark}`;
      }).join('\n');
      if(!confirm(`Controleer voor het opslaan:\n\n${preview}${negeerRegel}\n\nDoorgaan?`)) return;

      let added=0,updated=0;
      for(const result of results){
        const wid='w'+result.weekNum;
        const newWeek={id:wid,week:result.weekNum,label:result.label,rows:result.rows};
        const existing=weeks.findIndex(w=>w.id===wid);
        if(existing>=0){weeks[existing]=newWeek;updated++;}
        else{weeks.push(newWeek);added++;}
        await saveWeekToDB(newWeek);
      }
      weeks.sort((a,b)=>a.week-b.week);
      rebuildWkPages();refreshFilter();refreshTabs();renderDash();

      if(results.length===1){
        showUploadStatus(`Week ${results[0].weekNum} geladen en opgeslagen — ${results[0].rows.length} werkorders.`,'success');
        showWkPg('w'+results[0].weekNum);
      } else {
        showUploadStatus(`Excel geïmporteerd — ${added} week(en) toegevoegd, ${updated} bijgewerkt.`,'success');
        showPage('dashboard');
      }
    } catch(err){
      showUploadStatus('Fout bij verwerken: '+err.message,'error');
    }
  };
  reader.readAsArrayBuffer(file);
  inp.value='';
}

let _uploadStatusTimer=null;
function showUploadStatus(msg,type){
  const el=document.getElementById('uploadStatus');
  if(!el) return;
  el.innerHTML=`<div class="note ${type||''}" style="margin-bottom:12px">${msg}</div>`;
  clearTimeout(_uploadStatusTimer);
  _uploadStatusTimer=setTimeout(()=>{el.innerHTML='';},6000);
}

// ── KPI / render helpers ──────────────────────────────────────────
function filtered(w,tf){
  if(tf==='all') return w.rows;
  return w.rows.filter(r=>r.type===tf);
}
function kpis(rows){
  const t=rows.length,ja=rows.filter(r=>r.status==='ja').length,
    nee=rows.filter(r=>r.status==='nee').length,
    d=rows.filter(r=>r.status==='deels'||r.status==='uc').length,
    g=rows.filter(r=>r.type==='gepland').length,
    o=rows.filter(r=>r.type==='ongepland').length,
    pct=t>0?Math.round(ja/t*100):0;
  return{t,ja,nee,d,g,o,pct};
}

// Eén gedeelde groepering per ordernummer (chronologisch gesorteerd: week,
// dan dag) — gebruikt door dashboard-KPI's, backlog én inzichten, zodat de
// dedupe-definitie maar op één plek bestaat. WO's zonder ordernummer (—)
// komen apart terug omdat ze niet over weken heen te koppelen zijn.
const DAY_ORDER={Ma:1,Di:2,Wo:3,Do:4,Vr:5};
function groupRowsByOrder(){
  const byOrder={},loose=[];
  weeks.forEach(w=>{
    w.rows.forEach(r=>{
      const row={...r,_week:w.week,_wk:`W${w.week}`};
      if(!r.wo||r.wo==='—'){loose.push(row);return;}
      (byOrder[r.wo]=byOrder[r.wo]||[]).push(row);
    });
  });
  Object.values(byOrder).forEach(e=>e.sort((a,b)=>(a._week-b._week)||(DAY_ORDER[a.day]-DAY_ORDER[b.day])));
  return {byOrder,loose};
}
// Per ordernummer de laatste vermelding (= laatst bekende status).
function dedupeByOrder(){
  const {byOrder,loose}=groupRowsByOrder();
  return Object.values(byOrder).map(e=>e[e.length-1]).concat(loose);
}
function sb(s){
  if(s==='ja') return'<span class="badge bja">Ja</span>';
  if(s==='nee') return'<span class="badge bnee">Nee</span>';
  if(s==='deels') return'<span class="badge bdeels">Deels</span>';
  if(s==='uc') return'<span class="badge buc" title="Under Construction">UC</span>';
  return'<span style="font-size:11px;color:#aaa">—</span>';
}
const KC_ICONS={
  totaal:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16"/></svg>',
  circle:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>',
  calendar:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  zap:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>'
};
// Ontsmet data vóór het in innerHTML gaat (voorkomt stored XSS: kwaadaardige
// tekst in bv. een werkorder-omschrijving die anders als code zou draaien).
function esc(s){return(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
// Herbruikbare lege-staat: icoon + titel + korte uitleg i.p.v. kale platte
// tekst — geeft ook aan wat de gebruiker vervolgens kan doen.
const EMPTY_ICONS={
  select:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h.01M9 9a3 3 0 1 1 3 3M12 12v3m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h4l2 3h4l2-3h4"/><path d="M5.5 5h13l2.5 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7l2.5-7z"/></svg>'
};
function emptyState(icon,title,sub){
  return `<div class="empty"><div class="empty-icon">${EMPTY_ICONS[icon]||''}</div><div class="empty-title">${esc(title)}</div>${sub?`<div class="empty-sub">${esc(sub)}</div>`:''}</div>`;
}
// Skeleton-rijen voor een <tbody>: toont de vorm van de tabel i.p.v. platte
// "Laden..."-tekst. widths = relatieve breedte per kolom (bv. [60,20,20]).
function skeletonRows(widths,rows){
  rows=rows||4;
  let h='';
  for(let i=0;i<rows;i++){
    h+='<tr>'+widths.map(w=>`<td><div class="sk sk-row" style="width:${w}%"></div></td>`).join('')+'</tr>';
  }
  return h;
}
// trend = kant-en-klare HTML-badge (zie trendBadge()) of leeg; spark = array
// met getallen voor een mini-lijntje (zie sparkline()) of leeg. Beide
// optioneel — bestaande aanroepen zonder deze twee blijven ongewijzigd ogen.
// clickKey (optioneel): maakt de kaart klikbaar -> opent de KPI-detailpagina
// (zie openKpiDetail()) met exact dezelfde rijen als deze kaart telt.
// Bestaande aanroepen zonder dit argument blijven niet-klikbaar, ongewijzigd.
function kc(l,v,s,c,icon,tip,trend,spark,hero,clickKey){
  const accent=c||'#9aa39d';
  // Waarde-tekst krijgt een heldere variant van het accent: de corporate
  // kleuren zelf halen op het donkere kaartvlak geen leesbaar contrast
  // (#238636 = 1,4:1 en #da3633 = 2,9:1 — norm voor grote cijfers is 3:1).
  // De accentbalk en het icoon (decoratief) blijven wél corporate.
  const valColor={'#238636':'#3fb950','#da3633':'#f85149'}[c]||c;
  const info=tip?`<span class="info-i" data-tip="${esc(tip)}">i</span>`:'';
  const sparkHtml=(spark&&spark.length>1)?sparkline(spark,valColor||'#9aa39d'):'';
  const clickAttrs=clickKey?` role="button" tabindex="0" data-kpi="${clickKey}" aria-label="${esc(l)}: ${esc(String(v))} — klik voor details" onclick="openKpiDetail('${clickKey}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openKpiDetail('${clickKey}')}"`:'';
  return`<div class="kc${hero?' kc-hero':''}${clickKey?' kc-click':''}" style="--accent:${accent}"${clickAttrs}>${info}<div class="icon">${KC_ICONS[icon]||''}</div><div class="kl">${l}</div><div class="kv-row"><div class="kv"${c?` style="color:${valColor}"`:''}>${v}</div>${sparkHtml}</div><div class="ks">${s}${trend||''}</div></div>`;
}
// Kleine badge met richting + verschil t.o.v. een vorige waarde (bv. vorige
// week). Neutraal qua betekenis: de aanroeper bepaalt of "omhoog" goed of
// slecht is voor die specifieke KPI (hier: altijd groen=omhoog, rood=omlaag,
// wat correct is voor "% uitgevoerd" — de enige plek waar dit nu gebruikt wordt).
function trendBadge(delta,label){
  if(delta==null) return '';
  if(delta===0) return `<span class="kc-trend flat">&#8226; gelijk ${label}</span>`;
  const up=delta>0;
  return `<span class="kc-trend ${up?'up':'down'}">${up?'&#9650;':'&#9660;'} ${Math.abs(delta)}%${label?' '+label:''}</span>`;
}
// Minimalistische inline sparkline (geen Chart.js nodig voor zo'n klein accent).
function sparkline(values,color){
  const vals=values.filter(v=>v!=null);
  if(vals.length<2) return '';
  const w=56,h=20,pad=2;
  const min=Math.min(...vals),max=Math.max(...vals),range=(max-min)||1;
  const step=(w-pad*2)/(vals.length-1);
  const pts=vals.map((v,i)=>`${(pad+i*step).toFixed(1)},${(h-pad-((v-min)/range)*(h-pad*2)).toFixed(1)}`).join(' ');
  return `<svg class="kc-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Zelfde rijen als de dashboard-KPI's tellen (incl. dedupe bij "Alle weken").
// Gedeeld door renderDash() en de KPI-detailpagina (openKpiDetail) zodat een
// aantal op een kaart en de tabel erachter nooit uit elkaar kunnen lopen.
function computeKpiRows(wf,tf){
  const fWks=wf==='all'?weeks:weeks.filter(w=>w.id===wf);
  let allRows=[];
  fWks.forEach(w=>filtered(w,tf).forEach(r=>allRows.push({...r,_wk:`W${w.week}`,_week:w.week})));
  let kpiRows=allRows;
  if(wf==='all'){
    const dedupedAll=dedupeByOrder();
    kpiRows=tf==='all'?dedupedAll:dedupedAll.filter(r=>r.type===tf);
  }
  return{fWks,allRows,kpiRows};
}

function renderDash(){
  const wf=document.getElementById('fWeek').value;
  const tf=document.getElementById('fType').value;
  const {fWks,allRows,kpiRows}=computeKpiRows(wf,tf);
  const k=kpis(kpiRows);

  // "Niet uitgevoerd — meest voorkomende redenen" volgt hetzelfde Week/
  // Type-filter als de rest van het dashboard i.p.v. altijd de volledige
  // historie te tonen — anders klopte "reden" niet met de net gekozen week.
  const redenScope=fWks.length===1?`Week ${fWks[0].week}`:(wf==='all'?'':'');
  loadRedenAnalyse(allRows,redenScope);

  // Trend + sparkline op "Afgerond": laat in één oogopslag zien of de
  // uitvoering vooruit- of achteruitgaat, zonder dat je zelf weken hoeft
  // te vergelijken. Sparkline = laatste 8 weken (altijd, ongeacht filter);
  // trendbadge = alleen bij één geselecteerde week, t.o.v. de vorige.
  const sortedWeeks=[...weeks].sort((a,b)=>a.week-b.week);
  const pctSpark=sortedWeeks.slice(-8).map(w=>{const kk=kpis(filtered(w,tf));return kk.t>0?kk.pct:null;});
  let pctTrend='';
  if(fWks.length===1){
    const idx=sortedWeeks.findIndex(w=>w.id===fWks[0].id);
    if(idx>0){
      const prevK=kpis(filtered(sortedWeeks[idx-1],tf));
      if(prevK.t>0) pctTrend=trendBadge(k.pct-prevK.pct,'vs W'+sortedWeeks[idx-1].week);
    }
  }

  document.getElementById('dKpis').innerHTML=
    kc('Totaal WO\'s',k.t,wf==='all'?'unieke werkorders':'gefilterd',null,'totaal',
      'Aantal werkorders binnen de huidige filter (week + type). Bij "Alle weken" wordt elke werkorder maar één keer geteld, op basis van ordernummer en de laatst bekende status. Klik voor het volledige overzicht.',null,null,null,'totaal')+
    kc('Afgerond',k.ja,k.pct+'% uitgevoerd','#238636','check',
      'Werkorders met status "Ja" (uitgevoerd). Percentage = afgerond ÷ totaal × 100%. Klik voor de trend en verdeling per uitvoerende.',pctTrend,pctSpark,true,'afgerond')+
    kc('Niet uitgevoerd',k.nee,'backlog risico','#da3633','alert',
      'Werkorders met status "Nee". Blijven ze in latere weken terugkomen, dan vormen ze de backlog. Klik voor de terugkeer-historie per werkorder.',null,null,null,'niet')+
    kc('Deels / UC',k.d,'','#d29922','circle',
      'Werkorders met status "Deels" (gedeeltelijk uitgevoerd) of "Under Construction" (nog in uitvoering). Klik voor de uitsplitsing.',null,null,null,'deelsuc')+
    kc('Gepland',k.g,Math.round(k.g/(k.t||1)*100)+'%',null,'calendar',
      'Werkorders die als regulier onderhoud stonden ingepland. Percentage = gepland ÷ totaal × 100%. Klik voor de reden-verdeling.',null,null,null,'gepland')+
    kc('Ongepland',k.o,Math.round(k.o/(k.t||1)*100)+'%',null,'zap',
      'Werkorders die buiten de planning om zijn uitgevoerd, bijvoorbeeld storingen of spoedreparaties. Percentage = ongepland ÷ totaal × 100%. Klik voor de reden-verdeling.',null,null,null,'ongepland');

  const singleWeek=fWks.length===1;
  const DAYS=['Ma','Di','Wo','Do','Vr'];

  let wLabels,gD,oD,jaD,neeD,dD,pctD,cumD,lcTitle,barTitle,pctTitle;
  if(singleWeek){
    const w=fWks[0];
    wLabels=DAYS;
    gD=DAYS.map(d=>filtered(w,tf).filter(r=>r.day===d&&r.type==='gepland').length);
    oD=DAYS.map(d=>filtered(w,tf).filter(r=>r.day===d&&r.type==='ongepland').length);
    jaD=DAYS.map(d=>filtered(w,tf).filter(r=>r.day===d&&r.status==='ja').length);
    neeD=DAYS.map(d=>filtered(w,tf).filter(r=>r.day===d&&r.status==='nee').length);
    dD=DAYS.map(d=>filtered(w,tf).filter(r=>r.day===d&&(r.status==='deels'||r.status==='uc')).length);
    pctD=DAYS.map(d=>{const r=filtered(w,tf).filter(x=>x.day===d);return r.length>0?Math.round(r.filter(x=>x.status==='ja').length/r.length*100):0;});
    let running=0;
    cumD=jaD.map(v=>{running+=v;return running;});
    lcTitle=`WO's per dag — week ${w.week}`;barTitle=`Uitvoering per dag`;pctTitle=`Uitvoeringspercentage en cumulatief afgerond per dag`;
  } else {
    wLabels=fWks.map(w=>`W${w.week}`);
    gD=fWks.map(w=>filtered(w,tf).filter(r=>r.type==='gepland').length);
    oD=fWks.map(w=>filtered(w,tf).filter(r=>r.type==='ongepland').length);
    jaD=fWks.map(w=>filtered(w,tf).filter(r=>r.status==='ja').length);
    neeD=fWks.map(w=>filtered(w,tf).filter(r=>r.status==='nee').length);
    dD=fWks.map(w=>filtered(w,tf).filter(r=>r.status==='deels'||r.status==='uc').length);
    pctD=fWks.map(w=>{const r=filtered(w,tf);return r.length>0?Math.round(r.filter(x=>x.status==='ja').length/r.length*100):0;});
    let running=0;
    cumD=jaD.map(v=>{running+=v;return running;});
    lcTitle=`WO's per week — gepland vs. ongepland`;barTitle=`Uitvoering per week`;pctTitle=`Uitvoeringspercentage en cumulatief afgerond per week`;
  }
  document.querySelectorAll('.lc-title').forEach(el=>el.textContent=lcTitle);
  document.querySelectorAll('.bc-title').forEach(el=>el.textContent=barTitle);
  document.querySelectorAll('.pc-title').forEach(el=>el.textContent=pctTitle);

  // Grafieken alleen als Chart.js echt geladen is (CDN kan falen of
  // geblokkeerd zijn): KPI's en de tabel hieronder blijven dan gewoon werken
  // in plaats van dat de hele pagina-render halverwege sneuvelt.
  if(typeof Chart!=='undefined'){
  if(lcI) lcI.destroy();
  const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
  // Tooltip: eigen positionering (externalTooltipHandler, zie boven) i.p.v.
  // Chart.js' ingebouwde canvas-tooltip — die lijnde onder de CSS-zoom van
  // deze app niet meer uit met de muis.
  const tooltipCfg={enabled:false,external:externalTooltipHandler};
  // Kleurenblind-veilig: rood (Nee) krijgt diagonale strepen en oranje
  // (Deels/UC) stippen, zodat de vlakken ook zónder kleurherkenning uit
  // elkaar te houden zijn (groen blijft effen).
  function chartPattern(color,type){
    const c=document.createElement('canvas');c.width=8;c.height=8;
    const x=c.getContext('2d');
    if(!x||!x.createPattern) return color;
    x.fillStyle=color;x.fillRect(0,0,8,8);
    if(type==='stripe'){
      x.strokeStyle='rgba(255,255,255,.5)';x.lineWidth=1.6;
      x.beginPath();x.moveTo(-2,6);x.lineTo(6,-2);x.moveTo(2,10);x.lineTo(10,2);x.stroke();
    }else{
      x.fillStyle='rgba(255,255,255,.55)';
      x.beginPath();x.arc(2,2,1.2,0,7);x.fill();
      x.beginPath();x.arc(6,6,1.2,0,7);x.fill();
    }
    return x.createPattern(c,'repeat');
  }
  lcI=new Chart(document.getElementById('lc'),{type:'line',data:{labels:wLabels,datasets:[
    {label:'Gepland',data:gD,borderColor:'#2ea043',backgroundColor:'rgba(46,160,67,0.1)',tension:.35,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#2ea043',pointHitRadius:10},
    {label:'Ongepland',data:oD,borderColor:'#3fb950',backgroundColor:'rgba(0,221,57,0.08)',tension:.35,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#3fb950',pointHitRadius:10,borderDash:[5,4]}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:tooltipCfg},scales:{x:{grid:{display:false},ticks:{color:tickColor,font:{size:12},autoSkip:false}},y:{grid:{color:gridColor},ticks:{color:tickColor,stepSize:2,font:{size:12}},beginAtZero:true}}}});

  if(bcI) bcI.destroy();
  bcI=new Chart(document.getElementById('bc'),{type:'bar',data:{labels:wLabels,datasets:[
    {label:'Ja',data:jaD,backgroundColor:'#2ea043'},
    {label:'Nee',data:neeD,backgroundColor:chartPattern('#da3633','stripe')},
    {label:'Deels/UC',data:dD,backgroundColor:chartPattern('#d29922','dot')}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tooltipCfg},scales:{x:{stacked:true,grid:{display:false},ticks:{color:tickColor,font:{size:12},autoSkip:false}},y:{stacked:true,grid:{color:gridColor},ticks:{color:tickColor,font:{size:12}},beginAtZero:true}}}});

  if(pcI) pcI.destroy();
  pcI=new Chart(document.getElementById('pc'),{type:'line',data:{labels:wLabels,datasets:[
    {label:'% uitgevoerd',data:pctD,borderColor:'#2ea043',backgroundColor:'rgba(46,160,67,0.12)',tension:.35,borderWidth:2.5,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#2ea043',pointHitRadius:10,fill:true,yAxisID:'y'},
    {label:'Cumulatief afgerond',data:cumD,borderColor:'#3fb950',backgroundColor:'transparent',tension:.35,borderWidth:2,borderDash:[5,4],pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:'#3fb950',pointHitRadius:10,fill:false,yAxisID:'y1'}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{boxWidth:12,font:{size:11},color:tickColor,usePointStyle:true,pointStyle:'circle'}},tooltip:tooltipCfg},scales:{
    x:{grid:{display:false},ticks:{color:tickColor,font:{size:12},autoSkip:false}},
    y:{position:'left',grid:{color:gridColor},ticks:{color:tickColor,callback:v=>v+'%',font:{size:12}},min:0,max:100,title:{display:true,text:'% uitgevoerd',font:{size:11},color:tickColor}},
    y1:{position:'right',grid:{display:false},ticks:{color:tickColor,font:{size:12}},beginAtZero:true,title:{display:true,text:'Cumulatief afgerond',font:{size:11},color:tickColor}}
  }}});
  }

  const dSearch=(document.getElementById('fSearch').value||'').trim().toLowerCase();
  let tableRows=dSearch?allRows.filter(r=>(r.wo||'').toLowerCase().includes(dSearch)||(r.omschrijving||'').toLowerCase().includes(dSearch)):allRows;
  tableRows=applySort(tableRows,_dashSort,{
    week:r=>r._week||0, day:r=>DAY_ORDER[r.day]||0, order:r=>r.wo||'', omschrijving:r=>r.omschrijving||'',
    wie:r=>r.wie||'', type:r=>r.type||'', status:r=>r.status||'', opmerking:r=>r.opmerking||''
  });

  // Paginering: toon max. _dashLimit rijen, met een "toon meer"-knop. Bij
  // honderden werkorders (filter "Alle weken") houdt dit de tabel scanbaar
  // en snel — ook op oudere fabriekstablets.
  const shown=tableRows.slice(0,_dashLimit);
  let th=`<div class="tw"><table><thead><tr>
    ${sortTh('_dashSort','week','Week','renderDash','42px')}${sortTh('_dashSort','day','Dag','renderDash','34px')}
    ${sortTh('_dashSort','order','Order','renderDash','82px')}${sortTh('_dashSort','omschrijving','Omschrijving','renderDash')}
    ${sortTh('_dashSort','wie','Uitvoerende(n)','renderDash','115px')}
    ${sortTh('_dashSort','type','Type','renderDash','72px')}${sortTh('_dashSort','status','Uitgevoerd','renderDash','82px')}
    ${sortTh('_dashSort','opmerking','Opmerking','renderDash','240px')}
  </tr></thead><tbody>`;
  if(!tableRows.length) th+=`<tr><td colspan="8" style="text-align:center;padding:2rem;color:#8b949e">Geen werkorders voor deze filter</td></tr>`;
  shown.forEach(r=>{
    th+=`<tr>
      <td data-label="Week" style="font-size:12px;color:#c3cdc6">${r._wk}</td>
      <td data-label="Dag" style="font-size:12px;color:#c3cdc6">${esc(r.day)}</td>
      <td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}</td>
      <td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}</td>
      <td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td>
      <td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td>
      <td data-label="Uitgevoerd">${sb(r.status)}</td>
      <td data-label="Opmerking" style="font-size:12px;color:#8b949e" title="${esc(r.opmerking||'')}">${esc(r.opmerking||'—')}</td>
    </tr>`;
  });
  document.getElementById('dTbl').innerHTML=th+'</tbody></table></div>'+moreBar(tableRows.length,shown.length,'_dashLimit','renderDash');
}
// Kolomsortering: klik op een tabelkop om te sorteren, nogmaals klikken
// keert de richting om. sortState = {key, dir}; getters = {kolomkey: fn(rij)}.
function applySort(rows,sortState,getters){
  if(!sortState.key||!getters[sortState.key]) return rows;
  const get=getters[sortState.key];
  return [...rows].sort((a,b)=>{
    let x=get(a),y=get(b);
    if(typeof x==='string') x=x.toLowerCase();
    if(typeof y==='string') y=y.toLowerCase();
    if(x<y) return -1*sortState.dir;
    if(x>y) return 1*sortState.dir;
    return 0;
  });
}
function toggleSort(sortState,key,renderFn){
  if(sortState.key===key) sortState.dir*=-1; else { sortState.key=key; sortState.dir=1; }
  renderFn();
}
// Bouwt een <th> met sorteer-klik + pijltje-indicator. stateName is de naam
// van de globale sort-state-variabele ('_dashSort'/'_backSort'), als string
// omdat onclick een losse HTML-attribuutstring is (geen closure-toegang).
function sortTh(stateName,key,label,renderFnName,width){
  const state=stateName==='_dashSort'?_dashSort:stateName==='_backSort'?_backSort:_kpiDetSort;
  const arrow=state.key===key?(state.dir===1?' &#9650;':' &#9660;'):'';
  const w=width?`style="width:${width}"`:'';
  return `<th ${w} class="sortable" tabindex="0" role="button" aria-label="Sorteer op ${esc(label)}" onclick="toggleSort(${stateName},'${key}',${renderFnName})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSort(${stateName},'${key}',${renderFnName})}">${esc(label)}${arrow}</th>`;
}

// Genereert een "toon meer / alles"-balk onder een ingekorte tabel.
let _dashLimit=50, _backLimit=50, _dashSort={key:null,dir:1}, _backSort={key:null,dir:1};
let _kpiDetLimit=50, _kpiDetSort={key:null,dir:1}, _kpiDetCtx=null;
function moreBar(total,shownN,varName,renderFn){
  if(total<=shownN) return '';
  return `<div style="display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;color:#8b949e;font-size:13px">
    <span>${shownN} van ${total} getoond</span>
    <button class="btn" onclick="${varName}+=50;${renderFn}()">Toon 50 meer</button>
    <button class="btn" onclick="${varName}=999999;${renderFn}()">Toon alles</button>
  </div>`;
}

// ── KPI-detailpagina ────────────────────────────────────────────────
// Klikbare KPI-kaarten (kc() met clickKey) openen hier een pagina met exact
// dezelfde rijen als de kaart telt (computeKpiRows — dezelfde functie als
// renderDash() gebruikt, dus het aantal op de kaart en de tabel erachter
// kunnen nooit uit elkaar lopen), plus een per-KPI verdieping.
const KPI_DETAIL_META={
  totaal:{title:'Totaal WO\'s'},
  afgerond:{title:'Afgerond'},
  niet:{title:'Niet uitgevoerd'},
  deelsuc:{title:'Deels / UC'},
  gepland:{title:'Gepland'},
  ongepland:{title:'Ongepland'}
};
// Klapt in-place open onder de KPI-rij (zelfde patroon als de
// Financiën-KPI's) i.p.v. naar een aparte pagina te navigeren.
function setKpiActiveCard(kind){
  document.querySelectorAll('.kc[data-kpi]').forEach(el=>{
    el.classList.toggle('active',kind!=null&&el.getAttribute('data-kpi')===kind);
  });
}
function openKpiDetail(kind){
  const panel=document.getElementById('pg-kpi-detail');
  if(!panel) return;
  const alreadyOpenSame=panel.style.display!=='none'&&_kpiDetCtx&&_kpiDetCtx.kind===kind;
  if(alreadyOpenSame){ closeKpiDetail(); return; }
  _kpiDetCtx={kind,wf:document.getElementById('fWeek').value,tf:document.getElementById('fType').value};
  _kpiDetSort={key:null,dir:1};_kpiDetLimit=50;
  document.getElementById('kpiDetSearch').value='';
  panel.style.display='block';
  setKpiActiveCard(kind);
  renderKpiDetail();
  const reduceMotion=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
  navigate({page:'kpi-detail',kind:_kpiDetCtx.kind,wf:_kpiDetCtx.wf,tf:_kpiDetCtx.tf});
}
function closeKpiDetail(){
  const panel=document.getElementById('pg-kpi-detail');
  if(panel) panel.style.display='none';
  setKpiActiveCard(null);
  _kpiDetCtx=null;
  navigate({page:'dashboard'});
}
function kpiDetailRows(kpiRows,kind){
  if(kind==='afgerond') return kpiRows.filter(r=>r.status==='ja');
  if(kind==='niet') return kpiRows.filter(r=>r.status==='nee');
  if(kind==='deelsuc') return kpiRows.filter(r=>r.status==='deels'||r.status==='uc');
  if(kind==='gepland') return kpiRows.filter(r=>r.type==='gepland');
  if(kind==='ongepland') return kpiRows.filter(r=>r.type==='ongepland');
  return kpiRows;
}
// Verrijkt rijen met hoe vaak het ordernummer al voorkomt en hoe lang het
// (nog) open staat — zelfde definitie als de Backlog-pagina (groupRowsByOrder),
// hier toegepast op de subset van de aangeklikte KPI i.p.v. alle WO's.
function enrichWithHistory(rows){
  const {byOrder}=groupRowsByOrder();
  return rows.map(r=>{
    if(!r.wo||r.wo==='—') return{...r,_occurrences:1,_weeksOpenLatest:r.status!=='ja'?1:0};
    const entries=byOrder[r.wo]||[r];
    const first=entries[0],last=entries[entries.length-1];
    const weeksOpenLatest=last.status!=='ja'?(last._week-first._week+1):0;
    return{...r,_occurrences:entries.length,_weeksOpenLatest:weeksOpenLatest};
  });
}
function openBacklogFiltered(filterVal){
  document.getElementById('bFilter').value=filterVal;
  showPage('backlog');
}
// Herbruikbare "naam — balk — aantal"-lijst (zelfde stijl als de
// Werkbelasting-sectie op de weekpagina), voor zowel de uitvoerende- als de
// reden-verdeling hieronder.
function statBars(entries,emptyMsg){
  if(!entries.length) return `<div style="color:#8b949e;font-size:13px">${esc(emptyMsg)}</div>`;
  const maxN=entries[0][1];
  return entries.map(([label,n])=>`<div class="pb"><span class="pn">${esc(label)}</span><div class="pbg"><div class="pbf" style="width:${Math.round(n/maxN*100)}%"></div></div><span class="pbc">${n}</span></div>`).join('');
}
function uitvoerendeBars(rows){
  const pc={};
  rows.forEach(r=>(r.wie||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='—').forEach(p=>{pc[p]=(pc[p]||0)+1;}));
  const sorted=Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  return statBars(sorted,'Geen data beschikbaar.');
}
function redenBars(rows){
  const rc={};
  rows.forEach(r=>{if(r.reden) rc[r.reden]=(rc[r.reden]||0)+1;});
  const sorted=Object.entries(rc).sort((a,b)=>b[1]-a[1]);
  return statBars(sorted,'Geen reden geregistreerd voor deze selectie (het Reden-veld bestaat pas vanaf week 26).');
}
// Uitvoeringspercentage over ALLE weken (i.p.v. de laatste 8 op het
// dashboard) — alleen bij de "Afgerond"-detailpagina.
function renderKpiTrendChart(tf){
  const canvas=document.getElementById('kdTrend');
  if(!canvas||typeof Chart==='undefined') return;
  const sortedWeeks=[...weeks].sort((a,b)=>a.week-b.week);
  const labels=sortedWeeks.map(w=>'W'+w.week);
  const data=sortedWeeks.map(w=>{const kk=kpis(filtered(w,tf));return kk.t>0?kk.pct:null;});
  const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
  if(kdTrendI) kdTrendI.destroy();
  kdTrendI=new Chart(canvas,{type:'line',data:{labels,datasets:[
    {label:'% uitgevoerd',data,borderColor:'#2ea043',backgroundColor:'rgba(46,160,67,0.12)',tension:.35,borderWidth:2.5,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#2ea043',pointHitRadius:10,fill:true}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false,external:externalTooltipHandler}},scales:{
    x:{grid:{display:false},ticks:{color:tickColor,font:{size:11},autoSkip:true,maxRotation:0}},
    y:{grid:{color:gridColor},ticks:{color:tickColor,callback:v=>v+'%',font:{size:12}},min:0,max:100}
  }}});
}
// .kg staat vast op 6 kolommen (voor de 6 dashboardkaarten) — bij minder
// kaarten hier (2) geeft dat een lege, uitgerekte rij. Eigen compacte grid
// i.p.v. de .kg-klasse, met een max-breedte zodat de kaarten dezelfde maat
// houden als op het dashboard in plaats van breed uit te rekken.
const KG_SMALL='display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:16px;max-width:500px';
function renderKpiExtra(kind,rows,allKindRows){
  if(kind==='niet'){
    const recurring=rows.filter(r=>r._occurrences>1).length;
    const longOpen=rows.filter(r=>r.status!=='ja'&&r._weeksOpenLatest>=3).length;
    return`<div style="${KG_SMALL}">${
      kc('Terugkerend',recurring,'komt in 2+ weken voor','#d29922','repeat','Van deze werkorders komt dit ordernummer in 2 of meer weken voor.')}${
      kc('≥ 3 weken open',longOpen,'structurele aandacht nodig','#da3633','clock','Nog openstaand en de periode tussen eerste en laatste vermelding is 3 weken of langer.')
    }</div>
    <div class="wf" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 20px">
      <span style="font-size:13px;color:var(--color-text-secondary)">Voor de volledige reden- en installatie-analyse:</span>
      <button class="btn" onclick="goToAnalyse()">Open Analyse-pagina &rsaquo;</button>
      <button class="btn" onclick="openBacklogFiltered('open')">Open in Backlog &rsaquo;</button>
    </div>`;
  }
  if(kind==='afgerond'){
    return`<div class="cc" style="margin-bottom:16px;--accent:#238636">
      <div class="cct"><span class="cc-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg></span>Uitvoeringspercentage — alle weken</div>
      <div class="chart-container chart-h170"><canvas id="kdTrend" role="img" aria-label="Lijngrafiek: uitvoeringspercentage per week over alle weken"></canvas></div>
    </div>
    <div class="wf" style="margin-bottom:16px">
      <div class="sl" style="margin-top:0">Verdeling per uitvoerende</div>
      ${uitvoerendeBars(rows)}
    </div>`;
  }
  if(kind==='deelsuc'){
    const deels=rows.filter(r=>r.status==='deels').length;
    const uc=rows.filter(r=>r.status==='uc').length;
    return`<div style="${KG_SMALL}">${
      kc('Deels',deels,'gedeeltelijk uitgevoerd','#d29922','circle')}${
      kc('Under Construction',uc,'nog in uitvoering','#d29922','circle')
    }</div>`;
  }
  if(kind==='gepland'||kind==='ongepland'){
    return`<div class="wf" style="margin-bottom:16px">
      <div class="sl" style="margin-top:0">Meest voorkomende redenen</div>
      ${redenBars(rows)}
    </div>`;
  }
  if(kind==='totaal'){
    const g=allKindRows.filter(r=>r.type==='gepland').length,o=allKindRows.filter(r=>r.type==='ongepland').length;
    return`<div style="${KG_SMALL}">${
      kc('Gepland',g,Math.round(g/(allKindRows.length||1)*100)+'%',null,'calendar')}${
      kc('Ongepland',o,Math.round(o/(allKindRows.length||1)*100)+'%',null,'zap')
    }</div>`;
  }
  return'';
}
function renderKpiDetail(){
  if(!_kpiDetCtx) return;
  const{kind,wf,tf}=_kpiDetCtx;
  const meta=KPI_DETAIL_META[kind]||KPI_DETAIL_META.totaal;
  const{kpiRows}=computeKpiRows(wf,tf);
  let rows=kpiDetailRows(kpiRows,kind);
  const showHistory=kind==='niet';
  if(showHistory) rows=enrichWithHistory(rows);

  const wLabel=wf==='all'?'alle weken':('week '+((weeks.find(w=>w.id===wf)||{}).week||'?'));
  const tLabel=tf==='all'?'gepland + ongepland':(tf==='gepland'?'alleen gepland':'alleen ongepland');
  document.getElementById('kpiDetTitle').textContent=meta.title;
  document.getElementById('kpiDetSub').textContent=
    `${rows.length} werkorder${rows.length===1?'':'s'} — filter: ${wLabel}, ${tLabel}`;

  if(kind!=='afgerond'&&kdTrendI){kdTrendI.destroy();kdTrendI=null;}
  document.getElementById('kpiDetExtra').innerHTML=renderKpiExtra(kind,rows,kpiRows);
  if(kind==='afgerond') renderKpiTrendChart(tf);

  const search=(document.getElementById('kpiDetSearch').value||'').trim().toLowerCase();
  let tableRows=search?rows.filter(r=>(r.wo||'').toLowerCase().includes(search)||(r.omschrijving||'').toLowerCase().includes(search)):rows;
  tableRows=applySort(tableRows,_kpiDetSort,{
    week:r=>r._week||0, day:r=>DAY_ORDER[r.day]||0, order:r=>r.wo||'', omschrijving:r=>r.omschrijving||'',
    wie:r=>r.wie||'', type:r=>r.type||'', status:r=>r.status||'', reden:r=>r.reden||'', opmerking:r=>r.opmerking||'',
    occurrences:r=>r._occurrences||0, weeksopen:r=>r._weeksOpenLatest||0
  });

  const hasReden=rows.some(r=>r.reden);
  const shown=tableRows.slice(0,_kpiDetLimit);
  const colCount=7+(hasReden?1:0)+(showHistory?2:0)+1;

  let th=`<div class="tw"><table><thead><tr>
    ${sortTh('_kpiDetSort','week','Week','renderKpiDetail','42px')}${sortTh('_kpiDetSort','day','Dag','renderKpiDetail','34px')}
    ${sortTh('_kpiDetSort','order','Order','renderKpiDetail','82px')}${sortTh('_kpiDetSort','omschrijving','Omschrijving','renderKpiDetail')}
    ${sortTh('_kpiDetSort','wie','Uitvoerende(n)','renderKpiDetail','115px')}
    ${sortTh('_kpiDetSort','type','Type','renderKpiDetail','72px')}${sortTh('_kpiDetSort','status','Uitgevoerd','renderKpiDetail','82px')}
    ${hasReden?sortTh('_kpiDetSort','reden','Reden','renderKpiDetail','120px'):''}
    ${showHistory?sortTh('_kpiDetSort','occurrences','Keer','renderKpiDetail','56px')+sortTh('_kpiDetSort','weeksopen','Weken open','renderKpiDetail','90px'):''}
    <th style="width:110px">Actie</th>
  </tr></thead><tbody>`;
  if(!tableRows.length) th+=`<tr><td colspan="${colCount}" style="text-align:center;padding:2rem;color:#8b949e">Geen werkorders voor deze filter</td></tr>`;
  shown.forEach(r=>{
    // Zelfde kleurhiërarchie als de backlog: aging als rustige tekst (amber
    // vanaf 3 weken), geen rode chip — rood blijft voor status/risico.
    let openBadge='<span style="font-size:12px;color:#8b949e">—</span>';
    if(showHistory&&r.status!=='ja'&&r._weeksOpenLatest>0){
      const wk=r._weeksOpenLatest;
      openBadge=`<span style="font-size:12px;color:${wk>=3?'#d29922':'#8b949e'};font-weight:${wk>=3?'600':'400'}">${wk} ${wk>1?'weken':'week'}</span>`;
    }
    th+=`<tr>
      <td data-label="Week" style="font-size:12px;color:#c3cdc6">W${r._week}</td>
      <td data-label="Dag" style="font-size:12px;color:#c3cdc6">${esc(r.day)}</td>
      <td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}</td>
      <td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}</td>
      <td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td>
      <td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td>
      <td data-label="Uitgevoerd">${sb(r.status)}</td>
      ${hasReden?`<td data-label="Reden" style="font-size:12px;color:#8b949e">${esc(r.reden||'—')}</td>`:''}
      ${showHistory?`<td data-label="Keer" style="text-align:center;font-size:12px">${r._occurrences>1?`<span style="color:#8b949e;font-weight:600">${r._occurrences}&times;</span>`:'<span style="color:#6e7681">1&times;</span>'}</td><td data-label="Weken open">${openBadge}</td>`:''}
      <td data-label="Actie"><button class="btn" style="padding:4px 10px;font-size:12px" onclick="showWkPg('w${r._week}',true)">Ga naar W${r._week} &rsaquo;</button></td>
    </tr>`;
  });
  document.getElementById('kpiDetTbl').innerHTML=th+'</tbody></table></div>'+moreBar(tableRows.length,shown.length,'_kpiDetLimit','renderKpiDetail');
}

// Set met codes van probleem-installaties (top uit de analysepagina) —
// context voor de risicoscore, zodat een open WO op een installatie die al
// vaker problemen geeft iets zwaarder weegt.
function probleemInstallatieSet(){
  if(!window._installatieStats) computeInstallatieData();
  return new Set((window._installatieStats||[]).map(s=>s.code));
}

function renderBacklog(){
  const filter=document.getElementById('bFilter').value;

  // Zelfde groepering als dashboard/inzichten (groupRowsByOrder), hier
  // verrijkt met eerste/laatste week, herhaal-statistieken en een
  // uitlegbare risicoscore (js/risk.js) per order.
  const {byOrder}=groupRowsByOrder();
  const probSet=probleemInstallatieSet();
  const unique=[];
  Object.entries(byOrder).forEach(([wo,entries])=>{
    const last=entries[entries.length-1];
    const first=entries[0];
    const weeksOpen=entries.filter(e=>e.status!=='ja').length;
    const weeksOpenLatest=last.status!=='ja'?(last._week-first._week+1):0;
    unique.push({...last,_occurrences:entries.length,_firstWeek:first._week,_lastWeek:last._week,_weeksOpen:weeksOpen,_weeksOpenLatest:weeksOpenLatest,_risk:computeRisk(entries,probSet),_refMismatch:findOrderReferenceMismatch(entries)});
  });
  // Hoogste risico bovenaan: dat is de werklijst-volgorde waarin een planner
  // de backlog wil aflopen (afgeronde WO's hebben geen risico en zakken weg).
  unique.sort((a,b)=>((b._risk?b._risk.score:0)-(a._risk?a._risk.score:0))||b._weeksOpenLatest-a._weeksOpenLatest||b._occurrences-a._occurrences||a._lastWeek-b._lastWeek);

  // KPI's
  const total=unique.length;
  const open=unique.filter(u=>u.status!=='ja').length;
  const done=unique.filter(u=>u.status==='ja').length;
  const recurring=unique.filter(u=>u._occurrences>1).length;
  const stillOpenRecurring=unique.filter(u=>u._occurrences>1&&u.status!=='ja').length;
  const longOpen=unique.filter(u=>u.status!=='ja'&&u._weeksOpenLatest>=3).length;
  const hoogRisico=unique.filter(u=>u._risk&&u._risk.level==='hoog').length;

  document.getElementById('bKpis').innerHTML=
    kc('Unieke WO\'s',total,'op basis van ordernummer',null,'totaal',
      'Totaal aantal unieke werkorders, gededupliceerd op ordernummer over alle weken heen. Werkorders zonder ordernummer worden hier niet meegeteld omdat ze niet tussen weken te koppelen zijn.')+
    kc('Nog openstaand',open,Math.round(open/(total||1)*100)+'% van totaal','#da3633','alert',
      'Unieke werkorders waarvan de laatst bekende status niet "Ja" is. Percentage = nog openstaand \u00f7 totaal unieke WO\'s \u00d7 100%.',null,null,true)+
    kc('Afgerond',done,Math.round(done/(total||1)*100)+'% van totaal','#238636','check',
      'Unieke werkorders waarvan de laatst bekende status "Ja" is. Percentage = afgerond \u00f7 totaal unieke WO\'s \u00d7 100%.')+
    kc('Terugkerend',recurring,'komt in 2+ weken voor','#d29922','repeat',
      'Werkorders die in 2 of meer weken voorkomen \u2014 een signaal dat dezelfde werkzaamheid telkens opnieuw wordt ingepland in plaats van afgerond.')+
    kc('\u2265 3 weken open',longOpen,'structurele aandacht nodig','#da3633','clock',
      'Nog openstaande werkorders waarbij de periode tussen eerste en laatste vermelding 3 weken of langer is \u2014 wijst op een structureel probleem in plaats van een eenmalige vertraging.')+
    kc('Hoog risico',hoogRisico,'eerst oppakken deze week','#da3633','zap',
      'Openstaande werkorders met risicoscore \u2265 60. De score telt uitlegbare factoren op: hoe lang open, hoe vaak opnieuw ingepland zonder afronding, laatste status, ongepland werk en probleem-installaties. Beweeg over een risicobadge in de tabel om de factoren te zien.');

  // Filter voor tabel
  let rows=unique;
  if(filter==='open') rows=unique.filter(u=>u.status!=='ja');
  else if(filter==='ja') rows=unique.filter(u=>u.status==='ja');
  else if(filter==='long') rows=unique.filter(u=>u.status!=='ja'&&u._weeksOpenLatest>=3);
  else if(filter==='risico') rows=unique.filter(u=>u._risk&&u._risk.level==='hoog');

  const bSearch=(document.getElementById('bSearch').value||'').trim().toLowerCase();
  if(bSearch) rows=rows.filter(r=>(r.wo||'').toLowerCase().includes(bSearch)||(r.omschrijving||'').toLowerCase().includes(bSearch));
  rows=applySort(rows,_backSort,{
    order:r=>r.wo||'', omschrijving:r=>r.omschrijving||'', wie:r=>r.wie||'', type:r=>r.type||'',
    status:r=>r.status||'', firstweek:r=>r._firstWeek||0, lastweek:r=>r._lastWeek||0,
    occurrences:r=>r._occurrences||0, weeksopen:r=>r._weeksOpenLatest||0, opmerking:r=>r.opmerking||'',
    risico:r=>r._risk?r._risk.score:0
  });

  let th=`<div class="tw"><table class="backlog-tbl"><thead><tr>
    ${sortTh('_backSort','risico','Risico','renderBacklog','92px')}
    ${sortTh('_backSort','order','Order','renderBacklog','82px')}${sortTh('_backSort','omschrijving','Omschrijving','renderBacklog','280px')}
    ${sortTh('_backSort','wie','Laatst uitvoerende(n)','renderBacklog','115px')}
    ${sortTh('_backSort','type','Type','renderBacklog','72px')}
    ${sortTh('_backSort','status','Laatste status','renderBacklog','90px')}
    ${sortTh('_backSort','firstweek','Sinds','renderBacklog','70px')}
    ${sortTh('_backSort','lastweek','Laatst gezien','renderBacklog','70px')}
    ${sortTh('_backSort','occurrences','Aantal weken','renderBacklog','80px')}
    ${sortTh('_backSort','weeksopen','Weken open','renderBacklog','90px')}
    ${sortTh('_backSort','opmerking','Opmerking','renderBacklog','200px')}
  </tr></thead><tbody>`;
  if(!rows.length) th+=`<tr><td colspan="11" style="text-align:center;padding:2rem;color:#8b949e">Geen werkorders voor deze filter</td></tr>`;
  const bShown=rows.slice(0,_backLimit);
  bShown.forEach(r=>{
    const recurBadge=r._occurrences>1?`<span style="font-size:11px;color:#8b949e;font-weight:600">${r._occurrences}&times;</span>`:`<span style="font-size:11px;color:#6e7681">1&times;</span>`;
    // Risicobadge: score + niveau, met de opgetelde factoren als tooltip —
    // de score blijft zo uitlegbaar i.p.v. een kaal getal.
    // Kleurhiërarchie: de risicoscore is het enige rode element in de rij
    // (naast een "Nee"-status). Aging/herhaling zijn ondersteunend en staan
    // als rustige tekst — hun informatie zit al in de score verwerkt.
    let riskBadge='<span style="font-size:12px;color:#8b949e">—</span>';
    if(r._risk){
      const rb=r._risk;
      const style=rb.level==='hoog'?'background:rgba(248,81,73,.14);color:#f85149'
        :rb.level==='verhoogd'?'background:rgba(210,153,34,.15);color:#d29922'
        :'background:#21262d;color:#8b949e';
      const uitleg=rb.factors.map(f=>`${f.label} (+${f.punten})`).join(', ');
      riskBadge=`<span class="badge" style="${style}" title="Score ${rb.score} = ${esc(uitleg)}">${rb.score} &middot; ${rb.level}</span>`;
    }
    let openBadge='<span style="font-size:12px;color:#8b949e">—</span>';
    if(r.status!=='ja'&&r._weeksOpenLatest>0){
      const wk=r._weeksOpenLatest;
      openBadge=`<span style="font-size:12px;color:${wk>=3?'#d29922':'#8b949e'};font-weight:${wk>=3?'600':'400'}">${wk} ${wk>1?'weken':'week'}</span>`;
    }
    // Referentie-check: wisselende omschrijving bij hetzelfde ordernummer
    // wijst op een hergebruikt/verkeerd getypt nummer in de bron-Excel —
    // de "Sinds"/aging hierboven zou dan een andere klus meetellen.
    let refWarning='';
    if(r._refMismatch){
      const m=r._refMismatch;
      refWarning=` <span title="Omschrijving wijkt af tussen weken bij dit ordernummer — mogelijk hergebruikt of verkeerd getypt: W${m.a.week} &ldquo;${esc(m.a.omschrijving)}&rdquo; vs. W${m.b.week} &ldquo;${esc(m.b.omschrijving)}&rdquo;. De 'Sinds'-week kan hierdoor kloppen voor een andere klus." style="color:#d29922;cursor:help">&#9888;</span>`;
    }
    th+=`<tr>
      <td data-label="Risico">${riskBadge}</td>
      <td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}${refWarning}</td>
      <td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}</td>
      <td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td>
      <td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td>
      <td data-label="Status">${sb(r.status)}</td>
      <td data-label="Eerste week" style="font-size:12px;color:#8b949e">W${r._firstWeek}</td>
      <td data-label="Laatste week" style="font-size:12px;color:#8b949e">W${r._lastWeek}</td>
      <td data-label="Keren" style="text-align:center">${recurBadge}</td>
      <td data-label="Weken open">${openBadge}</td>
      <td data-label="Opmerking" style="font-size:12px;color:#8b949e" title="${esc(r.opmerking||'')}">${esc(r.opmerking||'—')}</td>
    </tr>`;
  });
  document.getElementById('bTbl').innerHTML=th+'</tbody></table></div>'+moreBar(rows.length,bShown.length,'_backLimit','renderBacklog');
}

function refreshFilter(){
  const s=document.getElementById('fWeek');
  const cur=s.value;
  s.innerHTML='<option value="all">Alle weken</option>';
  weeks.forEach(w=>{
    const o=document.createElement('option');
    o.value=w.id;o.textContent=`Week ${w.week} (${w.label})`;
    s.appendChild(o);
  });
  if(weeks.find(w=>w.id===cur)) s.value=cur;
}

// Eén compacte "Week ▾"-keuzelijst i.p.v. losse knoppen per week — voorkomt
// dat de topbar bij veel weken een drukke rij met scrollbalk wordt.
function refreshTabs(){
  const c=document.getElementById('wkTabs');
  c.innerHTML='';
  if(!weeks.length) return;
  const sorted=[...weeks].sort((a,b)=>a.week-b.week);
  const sel=document.createElement('select');
  sel.className='nt wk-select';
  sel.id='wkSelect';
  sel.setAttribute('aria-label','Kies een week');
  sel.innerHTML='<option value="">Week</option>'+
    sorted.map(w=>`<option value="${w.id}">W${w.week} — ${esc(w.label)}</option>`).join('');
  sel.onchange=()=>{ if(sel.value){ showWkPg(sel.value); closeMobileNav(); } };
  c.appendChild(sel);
}

// ── Navigatie-historie (browser-/muis-terugknop) ─────────────────────
// Elke top-level paginawissel (showPage/showWkPg/openKpiDetail, en de
// Financiën-module via window.navigate) registreert een history-entry
// (hash bevat de route als JSON), zodat de browser- of muis-terugknop door
// de app heen navigeert i.p.v. alleen de losse "Terug naar..."-knoppen.
// popstate herstelt de juiste pagina via applyRoute(), dat op zijn beurt
// dezelfde show-functies aanroept — _applyingRoute voorkomt dat die daarbij
// zelf wéér een nieuwe history-entry pushen (oneindige lus/dubbele entries).
let _applyingRoute=false;
function appIsShown(){
  const shell=document.getElementById('appShell');
  return!!shell&&shell.style.display!=='none';
}
function navigate(state,replace){
  if(_applyingRoute||!appIsShown()) return;
  const hash='#'+encodeURIComponent(JSON.stringify(state));
  if(location.hash===hash) return;
  if(replace) history.replaceState(state,'',hash);
  else history.pushState(state,'',hash);
}
function parseRouteHash(){
  if(!location.hash||location.hash.length<2) return null;
  try{ return JSON.parse(decodeURIComponent(location.hash.slice(1))); }catch(e){ return null; }
}
function applyRoute(state){
  if(!state||!state.page||!appIsShown()) return;
  if(!userAccess.dashboard&&DASHBOARD_PAGES.includes(state.page)){showGeenToegang();return;}
  _applyingRoute=true;
  try{
    if(state.page==='week') showWkPg(state.wid,state.noDelete);
    else if(state.page==='kpi-detail'&&state.kind){
      _kpiDetCtx={kind:state.kind,wf:state.wf||'all',tf:state.tf||'all'};
      _kpiDetSort={key:null,dir:1};_kpiDetLimit=50;
      document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
      document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
      syncOnderhoudSubnav('kpi-detail');
      document.getElementById('pg-dashboard').classList.add('active');
      document.getElementById('fWeek').value=_kpiDetCtx.wf;
      document.getElementById('fType').value=_kpiDetCtx.tf;
      renderDash();
      const panel=document.getElementById('pg-kpi-detail');
      if(panel) panel.style.display='block';
      setKpiActiveCard(_kpiDetCtx.kind);
      renderKpiDetail();
    } else if(state.page==='financien'){
      syncOnderhoudSubnav('financien');
      if(typeof window.__showFinance==='function') window.__showFinance();
    } else if(state.page==='rapport'){
      // Weekrapport (js/report.js) bouwt zijn pagina dynamisch — opnieuw
      // genereren i.p.v. alleen tonen, anders is hij leeg na een reload.
      if(typeof window.openWeekRapport==='function') window.openWeekRapport();
    } else showPage(state.page);
  } finally { _applyingRoute=false; }
}
window.addEventListener('popstate',e=>applyRoute(e.state||parseRouteHash()));
window.navigate=navigate;

// Contextuele Onderhoud-subnav (index.html #onderhoudSubnav): de vaste
// topbar-nav is verborgen (zie .nav{display:none} in app.css) sinds Start
// + Ctrl+K de hoofdroutes zijn. Deze strip is de "verderklikken binnen
// Onderhoud"-laag zodra je al op zo'n pagina staat — anders zou je er
// zonder terug-knop of paginavernieuwing niet meer uit kunnen.
function syncOnderhoudSubnav(id){
  const nav=document.getElementById('onderhoudSubnav');
  if(!nav) return;
  nav.style.display=DASHBOARD_PAGES.includes(id)?'flex':'none';
  // week/kpi-detail/rapport horen inhoudelijk bij Dashboard — die markeren
  // als actief i.p.v. niets, zodat de subnav nooit "leeg" oogt.
  const activeId=(id==='week'||id==='kpi-detail'||id==='rapport')?'dashboard':id;
  nav.querySelectorAll('[data-snid]').forEach(b=>b.classList.toggle('active',b.dataset.snid===activeId));
}
window.syncOnderhoudSubnav=syncOnderhoudSubnav;

function showPage(id){
  // Rechtenpoort: zonder dashboard-permissie is het hele onderhoud-deel
  // onbereikbaar — ook via directe URL/hash-navigatie (applyRoute komt hier
  // ook langs). Gebruikers/audit-log zijn admin-only en admins hebben altijd
  // dashboard-toegang, dus die vallen hier automatisch goed.
  if(!userAccess.dashboard&&DASHBOARD_PAGES.includes(id)){showGeenToegang();return;}
  // Verse navigatie (menu/subnav/Start-tegel) reset een eventueel openstaand
  // KPI-detailpaneel altijd — alleen de expliciete deep-link via applyRoute()
  // mag 'm heropenen, showPage() zelf krijgt 'kpi-detail' nooit als id.
  const kpiPanel=document.getElementById('pg-kpi-detail');
  if(kpiPanel&&kpiPanel.style.display!=='none'){
    kpiPanel.style.display='none';
    if(typeof setKpiActiveCard==='function') setKpiActiveCard(null);
    _kpiDetCtx=null;
  }
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
  const wkSel=document.getElementById('wkSelect');
  if(wkSel) wkSel.value='';
  const pg=document.getElementById('pg-'+id);
  if(pg) pg.classList.add('active');
  syncOnderhoudSubnav(id);
  // Actieve tab op vaste id's i.p.v. positie-tellen: dat brak zodra er
  // dynamisch knoppen bijkwamen (Financiën/weektabs) — verkeerde tab lichtte op.
  if(id==='home'){
    // Startpagina (js/home.js): bewust buiten DASHBOARD_PAGES — ook een
    // finance-only gebruiker landt hier en ziet alleen zijn eigen modules.
    document.getElementById('navHome').classList.add('active');
    if(typeof window.renderHome==='function') window.renderHome();
    const homePg=document.getElementById('pg-home');
    if(homePg) homePg.classList.add('active');
  } else if(id==='dashboard'){
    document.getElementById('navDash').classList.add('active');
    renderDash();
  } else if(id==='backlog'){
    document.getElementById('navBacklog').classList.add('active');
    renderBacklog();
  } else if(id==='analyse'){
    document.getElementById('navAnalyse').classList.add('active');
    renderAnalysePage();
  } else if(id==='addweek'){
    document.getElementById('navAdd').classList.add('active');
  } else if(id==='gebruikers'){
    document.getElementById('pg-gebruikers').classList.add('active');
    loadGebruikers();
  } else if(id==='auditlog'){
    document.getElementById('pg-auditlog').classList.add('active');
    loadAuditLog();
  }
  navigate({page:id});
}

// noDelete: onderdrukt de "Verwijderen"-knop — gebruikt door de "Ga naar
// Week"-link vanuit de KPI-detailpagina, waar je een werkorder komt bekijken/
// bewerken en niet per ongeluk de hele week moet kunnen verwijderen.
function showWkPg(wid,noDelete){
  if(!userAccess.dashboard){showGeenToegang();return;}
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
  syncOnderhoudSubnav('week');
  const pg=document.getElementById('wp-'+wid);
  if(pg){pg.classList.add('active');renderWkPg(wid,noDelete);}
  const sel=document.getElementById('wkSelect');
  if(sel){ sel.value=wid; sel.classList.add('active'); }
  navigate({page:'week',wid,noDelete:!!noDelete});
}

function renderWkPg(wid,noDelete){
  const w=weeks.find(x=>x.id===wid);if(!w)return;
  const pg=document.getElementById('wp-'+wid);
  const pc={};
  w.rows.forEach(r=>(r.wie||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='—').forEach(p=>{pc[p]=(pc[p]||0)+1;}));
  const sorted=Object.entries(pc).sort((a,b)=>b[1]-a[1]);
  const maxP=sorted[0]?sorted[0][1]:1;
  const k=kpis(w.rows);
  const days=['Ma','Di','Wo','Do','Vr'];
  let html=`<div class="whr"><div><div class="wt">Week ${w.week}</div><div class="ws">${esc(w.label)} &nbsp;·&nbsp; ${w.rows.length} werkorders</div></div>
    ${noDelete?'':`<button class="btn btn-del" onclick="delWeek('${w.id}')">Verwijderen</button>`}</div>`;
  html+=`<div class="kg">`+
    kc('Totaal',k.t,'',null,'totaal','Aantal werkorders binnen deze week.')+
    kc('Afgerond',k.ja,k.pct+'%','#238636','check','Werkorders met status "Ja" binnen deze week. Percentage = afgerond ÷ totaal × 100%.',null,null,true)+
    kc('Niet uitgevoerd',k.nee,'','#da3633','alert','Werkorders met status "Nee" binnen deze week.')+
    kc('Deels/UC',k.d,'','#d29922','circle','Werkorders met status "Deels" of "Under Construction" binnen deze week.')+
    kc('Gepland',k.g,'',null,'calendar','Werkorders die binnen deze week als regulier onderhoud stonden ingepland.')+
    kc('Ongepland',k.o,'',null,'zap','Werkorders die binnen deze week buiten de planning om zijn uitgevoerd.')+
    `</div>`;
  html+=`<div class="sl">Werkbelasting</div><div style="max-width:420px;margin-bottom:20px">`;
  sorted.forEach(([p,c])=>{html+=`<div class="pb"><span class="pn">${esc(p)}</span><div class="pbg"><div class="pbf" style="width:${Math.round(c/maxP*100)}%"></div></div><span class="pbc">${c}</span></div>`;});
  html+=`</div><div class="sl">Per dag</div><div class="dtr" id="dt-${wid}">`;
  days.forEach((d,i)=>{html+=`<button class="dt2${i===0?' active':''}" onclick="showDayTbl('${wid}','${d}',this)">${d}</button>`;});
  html+=`</div><div id="dtbl-${wid}"></div>`;
  pg.innerHTML=html;
  showDayTbl(wid,'Ma',null);
}

function showDayTbl(wid,day,btn){
  if(btn){btn.closest('.dtr').querySelectorAll('.dt2').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  const w=weeks.find(x=>x.id===wid);
  const rows=w.rows.filter(r=>r.day===day);
  let h=`<div class="tw"><table><thead><tr><th style="width:82px">Order</th><th>Omschrijving</th><th style="width:115px">Uitvoerende(n)</th><th style="width:72px">Type</th><th style="width:82px">Uitgevoerd</th><th style="width:240px">Opmerking</th></tr></thead><tbody>`;
  if(!rows.length) h+=`<tr><td colspan="6" style="text-align:center;padding:1rem;color:#aaa">Geen werkorders op ${day}</td></tr>`;
  rows.forEach(r=>{h+=`<tr><td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}</td><td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}</td><td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td><td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td><td data-label="Uitgevoerd">${sb(r.status)}</td><td data-label="Opmerking" style="font-size:12px;color:#8b949e" title="${esc(r.opmerking||'')}">${esc(r.opmerking||'—')}</td></tr>`;});
  document.getElementById('dtbl-'+wid).innerHTML=h+'</tbody></table></div>';
}

function addRow(){
  const c=document.getElementById('nRows');
  const d=document.createElement('div');
  d.className='row-grid';
  const si='width:100%;font-size:12px;padding:5px 7px;border-radius:8px;border:1px solid #30363d;background:#21262d;color:#e6edf3';
  d.innerHTML=`<select class="rd" style="${si}"><option>Ma</option><option>Di</option><option>Wo</option><option>Do</option><option>Vr</option></select>
    <input class="rw" type="text" placeholder="Ordernr" style="${si}">
    <input class="ro" type="text" placeholder="Omschrijving werkzaamheden" style="${si}">
    <input class="rp" type="text" placeholder="Namen" style="${si}">
    <select class="rt" style="${si}"><option value="gepland">Gepland</option><option value="ongepland">Ongepland</option></select>
    <select class="rs" style="${si}"><option value="ja">Ja</option><option value="nee">Nee</option><option value="deels">Deels</option><option value="uc">Under Construction</option></select>
    <button style="background:#fee2e2;border:none;cursor:pointer;color:#991b1b;font-size:16px;padding:4px 6px;border-radius:5px" onclick="this.parentNode.remove()" title="Verwijder">&#10005;</button>`;
  c.appendChild(d);
}

async function saveWeek(){
  if(!isAdmin){showGlobalStatus('Geen rechten om weken toe te voegen.','error');return;}
  const yr=parseInt(document.getElementById('nYear').value)||2026;
  const wn=parseInt(document.getElementById('nWk').value)||0;
  const lbl=document.getElementById('nLbl').value||`Week ${wn}, ${yr}`;
  if(!wn){alert('Vul een weeknummer in');return;}
  const wid='w'+wn;
  if(weeks.find(w=>w.id===wid)){alert(`Week ${wn} bestaat al`);return;}
  const rowEls=document.getElementById('nRows').children;
  const rows=[];
  Array.from(rowEls).forEach(el=>{
    const o=el.querySelector('.ro').value.trim();
    if(!o) return;
    rows.push({day:el.querySelector('.rd').value,wo:el.querySelector('.rw').value.trim()||'—',omschrijving:o,wie:el.querySelector('.rp').value.trim()||'—',type:el.querySelector('.rt').value,status:el.querySelector('.rs').value});
  });
  const newWeek={id:wid,week:wn,label:lbl,rows};
  try{
    await saveWeekToDB(newWeek);
    weeks.push(newWeek);
    weeks.sort((a,b)=>a.week-b.week);
    rebuildWkPages();refreshFilter();refreshTabs();
    document.getElementById('nRows').innerHTML='';
    document.getElementById('nLbl').value='';
    document.getElementById('nWk').value='';
    showWkPg(wid);
    showGlobalStatus(`Week ${wn} opgeslagen.`,'success');
  }catch(e){showGlobalStatus('Fout bij opslaan: '+e.message,'error');}
}

async function delWeek(wid){
  if(!isAdmin){showGlobalStatus('Geen rechten om weken te verwijderen.','error');return;}
  const w=weeks.find(x=>x.id===wid);
  if(!confirm(`Week ${w?w.week:''} verwijderen?`)) return;
  try{
    await deleteWeekFromDB(wid);
    weeks=weeks.filter(w=>w.id!==wid);
    const pg=document.getElementById('wp-'+wid);if(pg)pg.remove();
    refreshFilter();refreshTabs();showPage('dashboard');
    showGlobalStatus('Week verwijderd.','success');
  }catch(e){showGlobalStatus('Fout bij verwijderen: '+e.message,'error');}
}

function rebuildWkPages(){
  const c=document.getElementById('wkPages');
  weeks.forEach(w=>{
    if(!document.getElementById('wp-'+w.id)){
      const d=document.createElement('div');
      d.className='pg';d.id='wp-'+w.id;c.appendChild(d);
    }
  });
}

// ── App opstarten ─────────────────────────────────────────────
// Op DOMContentLoaded: dat vuurt gegarandeerd ná de defer-scripts (Chart.js/
// XLSX/parser.js), dus initApp kan nooit draaien vóór de libraries er zijn.
window.addEventListener('DOMContentLoaded',async()=>{
  // Resetlink uit een "wachtwoord vergeten"-e-mail heeft voorrang op een
  // eventuele bestaande sessie: iemand die zijn wachtwoord kwijt is, wil
  // hier niet per ongeluk zijn oude (nog geldige) sessie in zien in plaats
  // van het nieuw-wachtwoord-scherm.
  if(checkPasswordRecoveryLink()) return;
  // Check bestaande sessie; een verlopen access token wordt eerst ververst
  // met het refresh token (dus 's ochtends niet opnieuw hoeven inloggen).
  try{
    const stored=localStorage.getItem('sap_pm_session');
    if(stored){
      currentUser=JSON.parse(stored);
      await ensureFreshSession();
      const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser.access_token}
      });
      if(r.ok){
        await initApp();
        return;
      }
    }
  }catch(e){}
  currentUser=null;
  showLoginScreen();
});

async function wijzigWachtwoord(){
  const nieuw=prompt('Voer je nieuwe wachtwoord in (minimaal 12 tekens):');
  if(!nieuw) return;
  if(nieuw.length<12){alert('Wachtwoord moet minimaal 12 tekens zijn');return;}
  try{
    const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{
      method:'PUT',
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser?.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({password:nieuw})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.msg||data.error_description||data.error||'Wijzigen mislukt');
    showGlobalStatus('✓ Wachtwoord succesvol gewijzigd','success');
  }catch(e){
    showGlobalStatus('Fout bij wijzigen: '+e.message,'error');
  }
}

// ── Gebruikersbeheer ──────────────────────────────────────────
async function loadGebruikers(){
  const el=document.getElementById('gebruikersLijst');
  el.innerHTML=`<table><tbody>${skeletonRows([25,20,15,20,15,15],5)}</tbody></table>`;
  try{
    // De drie bronnen zijn onafhankelijk van elkaar — parallel starten i.p.v.
    // na elkaar afwachten (dat waren drie opeenvolgende netwerkrondes, boven
    // op de tragere /api/admin-call die zelf al een serverless cold start +
    // meerdere Supabase-rondes bevat).
    const hdrs={'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser?.access_token};
    const [r,r2,rM]=await Promise.all([
      fetch(`/api/admin?action=list-users`,{headers:{'Authorization':'Bearer '+currentUser?.access_token}}),
      fetch(`${SUPABASE_URL}/rest/v1/user_roles?select=email,role`,{headers:hdrs}),
      fetch(`${SUPABASE_URL}/rest/v1/user_module_access?select=email,module,access_level`,{headers:hdrs}).catch(()=>null)
    ]);
    if(!r.ok) throw new Error(`API fout ${r.status}`);
    const data=await r.json();
    const authUsers=data.users||[];

    const rolesRaw=await r2.json().catch(()=>[]);
    const roleMap={};
    (Array.isArray(rolesRaw)?rolesRaw:[]).forEach(x=>{if(x&&x.email) roleMap[x.email]=x.role;});

    // Module-toegang per gebruiker: finance ('read'/'admin'), dashboard en
    // rotterdam (aan/uit). Marker-rij ('*') telt niet als gebruiker maar
    // vertelt of de dashboard-permissie al wordt afgedwongen (fase17).
    let finMap={},dashMap={},rotMap={},dashboardEnforced=false;
    if(rM){
      const modRaw=await rM.json().catch(()=>[]);
      (Array.isArray(modRaw)?modRaw:[]).forEach(x=>{
        if(!x||!x.email) return;
        if(x.email==='*'){ if(x.module==='dashboard') dashboardEnforced=true; return; }
        const em=x.email.toLowerCase();
        if(x.module==='finance') finMap[em]=x.access_level;
        else if(x.module==='dashboard') dashMap[em]=true;
        else if(x.module==='rotterdam') rotMap[em]=true;
      });
    }

    if(!authUsers.length){
      el.innerHTML=emptyState('inbox','Geen gebruikers gevonden');
      return;
    }

    // Label ("Aan"/"Uit") staat in een eigen <span> zodat onModuleToggle()
    // hem direct kan bijwerken — hiervoor bleef de tekst hangen op de oude
    // waarde totdat de hele gebruikerslijst opnieuw werd geladen, terwijl
    // het vinkje zelf (browser-default) wél meteen omklapte. Verwarrend:
    // leek alsof de wijziging niet zichtbaar doorkwam.
    const toggle=(email,module,aan)=>`<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
      <input type="checkbox"${aan?' checked':''} onchange="onModuleToggle(this,'${esc(email)}','${module}')" style="accent-color:var(--color-primary);width:15px;height:15px"><span class="tgl-label">${aan?'Aan':'Uit'}</span>
    </label>`;
    const viaAdmin='<span style="font-size:11px;color:#8b949e">via admin</span>';

    let html=dashboardEnforced?'':`<div class="note" style="margin-bottom:12px">&#9432; De dashboard-permissie wordt nog niet afgedwongen — draai <code>docs/sql/fase17_multiplant_rechten.sql</code> in Supabase om de Dashboard-kolom actief te maken. Tot die tijd ziet iedere gebruiker het dashboard.</div>`;
    html+=`<table><thead><tr>
      <th style="width:140px">Naam</th>
      <th>E-mailadres</th>
      <th style="width:80px">Rol</th>
      <th style="width:90px">Dashboard</th>
      <th style="width:105px">Financi&euml;n</th>
      <th style="width:90px">Rotterdam</th>
      <th style="width:110px">Aangemaakt</th>
      <th style="width:100px">Actie</th>
    </tr></thead><tbody>`;

    authUsers.forEach(u=>{
      if(!u||!u.email) return;
      const rol=roleMap[u.email]||'viewer';
      const naam=(u.user_metadata&&(u.user_metadata.naam||u.user_metadata.full_name))||'—';
      const datum=u.created_at?new Date(u.created_at).toLocaleDateString('nl-NL'):'—';
      const isZelf=u.email===currentUser?.user?.email;
      const rolBadge=rol==='admin'?'<span class="badge bja">Admin</span>':'<span class="badge buc">Viewer</span>';
      const em=(u.email||'').toLowerCase();
      const finLvl=finMap[em]||'';
      const finCell=rol==='admin'?viaAdmin
        : `<select onchange="setModuleAccess('${esc(u.email)}','finance',this.value)" style="font-size:12px;padding:4px 6px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface-elevated);color:var(--color-text-primary)">
             <option value=""${finLvl===''?' selected':''}>Geen</option>
             <option value="read"${finLvl==='read'?' selected':''}>Lezen</option>
             <option value="admin"${finLvl==='admin'?' selected':''}>Beheer</option>
           </select>`;
      const dashCell=rol==='admin'?viaAdmin:toggle(u.email,'dashboard',!!dashMap[em]);
      const rotCell=rol==='admin'?viaAdmin:toggle(u.email,'rotterdam',!!rotMap[em]);
      html+=`<tr>
        <td data-label="Naam">${esc(naam)}</td>
        <td data-label="E-mail">${esc(u.email)}</td>
        <td data-label="Rol">${rolBadge}</td>
        <td data-label="Dashboard">${dashCell}</td>
        <td data-label="Financiën">${finCell}</td>
        <td data-label="Rotterdam">${rotCell}</td>
        <td data-label="Aangemaakt" style="font-size:12px;color:#8b949e">${datum}</td>
        <td data-label="Actie">${isZelf?'<span style="font-size:11px;color:#aaa">(jijzelf)</span>':`<button class="btn btn-del" style="font-size:11px;padding:3px 8px" onclick="verwijderGebruiker('${esc(u.id)}','${esc(u.email)}')">Verwijderen</button>`}</td>
      </tr>`;
    });

    el.innerHTML=html+'</tbody></table>';
  }catch(e){
    el.innerHTML=`<div style="padding:1rem;color:#da3633">Fout: ${e.message}<br><small style="color:#8b949e">Werkt alleen via sap-pm-dashboard.vercel.app</small></div>`;
  }
}

// Audit-log: registreert wie welke beheerdersactie deed, op wie en met welke
// details. Best-effort — een mislukte logregel mag de eigenlijke actie (die
// al is uitgevoerd) nooit alsnog laten falen, dus alleen console.error, geen
// throw. RLS (fase16_admin_audit_log.sql) dwingt af dat alleen admins mogen
// inserten, en alleen met hun eigen e-mailadres als actor.
async function logAdminAction(action,targetEmail,details){
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_log`,{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser?.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({actor_email:currentUser?.user?.email,action,target_email:targetEmail||null,details:details||null})
    });
  }catch(e){console.error('Audit-log schrijven mislukt:',e);}
}

async function loadAuditLog(){
  const el=document.getElementById('auditLogLijst');
  el.innerHTML=`<table><tbody>${skeletonRows([15,20,20,30,15],6)}</tbody></table>`;
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_log?select=*&order=created_at.desc&limit=100`,{
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+currentUser?.access_token}
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows=await r.json();
    if(!Array.isArray(rows)||!rows.length){
      el.innerHTML=emptyState('inbox','Nog geen beheerdersacties gelogd','Acties zoals gebruikers aanmaken/verwijderen en financiëntoegang wijzigen verschijnen hier.');
      return;
    }
    const ACTION_LABELS={'user.create':'Gebruiker aangemaakt','user.delete':'Gebruiker verwijderd','role.set':'Rol ingesteld','finance_access.set':'Financiëntoegang ingesteld','finance_access.revoke':'Financiëntoegang ingetrokken','module_access.set':'Moduletoegang ingesteld','module_access.revoke':'Moduletoegang ingetrokken'};
    let html=`<table><thead><tr>
      <th style="width:130px">Wanneer</th>
      <th style="width:180px">Door</th>
      <th style="width:180px">Actie</th>
      <th style="width:180px">Op</th>
      <th>Details</th>
    </tr></thead><tbody>`;
    rows.forEach(row=>{
      const dt=row.created_at?new Date(row.created_at).toLocaleString('nl-NL'):'—';
      const detailsTxt=row.details?Object.entries(row.details).map(([k,v])=>`${esc(k)}: ${esc(v)}`).join(', '):'—';
      html+=`<tr>
        <td data-label="Wanneer" style="font-size:12px;color:#8b949e">${dt}</td>
        <td data-label="Door" style="font-size:12px">${esc(row.actor_email||'—')}</td>
        <td data-label="Actie">${esc(ACTION_LABELS[row.action]||row.action)}</td>
        <td data-label="Op" style="font-size:12px;color:#8b949e">${esc(row.target_email||'—')}</td>
        <td data-label="Details" style="font-size:12px;color:#8b949e">${detailsTxt}</td>
      </tr>`;
    });
    el.innerHTML=html+'</tbody></table>';
  }catch(e){
    el.innerHTML=`<div style="padding:1rem;color:#da3633">Fout bij laden audit-log: ${e.message}</div>`;
  }
}

async function voegGebruikerToe(){
  if(!isAdmin){showGlobalStatus('Geen rechten om gebruikers toe te voegen.','error');return;}
  const naam=document.getElementById('newUserNaam').value.trim();
  const email=document.getElementById('newUserEmail').value.trim();
  const rol=document.getElementById('newUserRol').value;
  const status=document.getElementById('gebruikerStatus');
  if(!email){status.style.color='#da3633';status.textContent='Vul een e-mailadres in';return;}
  status.style.color='#888';status.textContent='Bezig...';

  try{
    // Tijdelijk wachtwoord: 12 tekens cryptografisch willekeurig uit een
    // leesbare set (geen l/1/I/O/0-verwarring bij het overtypen). Het oude
    // "Welkom####!" had maar 9000 mogelijkheden en was zo te raden.
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const buf=new Uint32Array(12);crypto.getRandomValues(buf);
    const tempPw=[...buf].map(n=>chars[n%chars.length]).join('')+'!';

    // Maak account aan via serverless function
    const r=await fetch(`/api/admin?action=create-user`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentUser?.access_token},
      body:JSON.stringify({email,password:tempPw,naam})
    });
    const data=await r.json();
    if(data.error||data.msg) throw new Error(data.msg||data.error);

    // Voeg rol toe in user_roles tabel
    await fetch(`${SUPABASE_URL}/rest/v1/user_roles`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_KEY,
        'Authorization':'Bearer '+currentUser?.access_token,
        'Content-Type':'application/json',
        'Prefer':'resolution=merge-duplicates'
      },
      body:JSON.stringify({email,role:rol})
    });
    logAdminAction('role.set',email,{rol});
    // Nieuwe gebruikers krijgen standaard dashboard-toegang (het bestaansrecht
    // van een account); de admin kan dit daarna per gebruiker uitzetten.
    try{ await setModuleAccess(email,'dashboard','read'); }catch(e){/* niet-fataal */}

    status.innerHTML=`<div style="background:#12261a;border:1px solid #2ea043;border-radius:8px;padding:12px 16px">
      <div style="color:#56d364;font-weight:600;margin-bottom:6px">✓ Account aangemaakt voor ${esc(naam||email)}</div>
      <div style="color:#8b949e;margin-bottom:8px">Geef deze inloggegevens door aan de gebruiker:</div>
      <div style="background:#21262d;border-radius:6px;padding:10px 14px;font-family:monospace;font-size:13px;color:#e6edf3">
        <div>E-mail: <strong>${esc(email)}</strong></div>
        <div>Wachtwoord: <strong>${tempPw}</strong></div>
        <div style="font-size:11px;color:#8b949e;margin-top:6px">URL: sap-pm-dashboard.vercel.app</div>
      </div>
      <div style="font-size:12px;color:#8b949e;margin-top:8px">De gebruiker kan daarna zelf het wachtwoord wijzigen via de knop rechtsboven.</div>
    </div>`;
    
    document.getElementById('newUserNaam').value='';
    document.getElementById('newUserEmail').value='';
    loadGebruikers();
  }catch(e){
    status.style.color='#da3633';
    status.textContent='Fout: '+e.message;
  }
}

async function verwijderGebruiker(userId,email){
  if(!isAdmin){showGlobalStatus('Geen rechten om gebruikers te verwijderen.','error');return;}
  if(!confirm(`Gebruiker ${email} verwijderen?`)) return;
  try{
    await fetch(`/api/admin?action=delete-user&userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}`,{
      method:'DELETE',
      headers:{'Authorization':'Bearer '+currentUser?.access_token}
    });
    await fetch(`${SUPABASE_URL}/rest/v1/user_roles?email=eq.${encodeURIComponent(email)}`,{
      method:'DELETE',
      headers:{
        'apikey':SUPABASE_KEY,
        'Authorization':'Bearer '+currentUser?.access_token
      }
    });
    loadGebruikers();
  }catch(e){alert('Fout: '+e.message);}
}

// Module-toegang toekennen/intrekken (alleen admins; RLS dwingt dit ook af).
// module: 'finance' | 'dashboard' | 'rotterdam'
// level: '' = geen (verwijderen), 'read' = toegang/lezen, 'admin' = beheren
// (alleen finance kent het onderscheid read/admin).
const MODULE_LABELS={finance:'Financiën',dashboard:'Dashboard',rotterdam:'Rotterdam'};
// Retourwaarde (true/false) is nieuw t.o.v. de oorspronkelijke versie: de
// dashboard/rotterdam-vinkjes gebruiken hem om bij een mislukte opslag het
// vinkje + label terug te draaien (onModuleToggle hieronder). Bestaande
// aanroepen die de return-waarde negeren (bv. de finance-select) blijven
// ongewijzigd werken.
async function setModuleAccess(email,module,level){
  if(!isAdmin){showGlobalStatus('Geen rechten om toegang te wijzigen.','error');return false;}
  const em=(email||'').toLowerCase().trim();
  const label=MODULE_LABELS[module]||module;
  if(!em||!MODULE_LABELS[module]) return false;
  try{
    if(!level){
      const r=await fetch(`${SUPABASE_URL}/rest/v1/user_module_access?email=eq.${encodeURIComponent(em)}&module=eq.${module}`,{
        method:'DELETE',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser?.access_token}
      });
      if(!r.ok) throw new Error(await r.text());
      logAdminAction('module_access.revoke',em,{module});
      showGlobalStatus(`${label}-toegang ingetrokken voor ${em}`,'success');
    } else {
      const r=await fetch(`${SUPABASE_URL}/rest/v1/user_module_access`,{
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+currentUser?.access_token,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
        body:JSON.stringify({email:em,module,access_level:level,granted_by:currentUser?.user?.email})
      });
      if(!r.ok) throw new Error(await r.text());
      logAdminAction('module_access.set',em,{module,level});
      showGlobalStatus(`${label}-toegang (${level==='admin'?'beheer':'lezen'}) gegeven aan ${em}`,'success');
    }
    return true;
  }catch(e){showGlobalStatus(`Fout bij wijzigen ${label}-toegang: `+e.message,'error');return false;}
}

// Aan/Uit-vinkjes (Dashboard/Rotterdam): werkt het label ("Aan"/"Uit")
// meteen bij bij het klikken (optimistic UI) i.p.v. te wachten op een
// volledige herlading van de gebruikerslijst — daarvoor bleef de tekst op
// de oude waarde staan terwijl alleen het vinkje zelf al omklapte, wat
// verwarrend oogde alsof de wijziging niet doorkwam. Bij een mislukte
// opslag (bv. netwerkfout) draait het vinkje + label terug; de foutmelding
// zelf komt al uit setModuleAccess (showGlobalStatus).
async function onModuleToggle(checkbox,email,module){
  const wantsOn=checkbox.checked;
  const labelEl=checkbox.nextElementSibling;
  if(labelEl) labelEl.textContent=wantsOn?'Aan':'Uit';
  const ok=await setModuleAccess(email,module,wantsOn?'read':'');
  if(!ok){
    checkbox.checked=!wantsOn;
    if(labelEl) labelEl.textContent=!wantsOn?'Aan':'Uit';
  }
}


// ── Automatische inzichten ────────────────────────────────────
function renderInzichten(){
  const el=document.getElementById('aInzichten');
  if(!el||!weeks.length){if(el)el.innerHTML='';return;}
  const insights=[];

  // 0 — Referentie-check: ordernummer met wisselende omschrijving tussen
  // weken (hergebruikt/verkeerd getypt in de bron-Excel). Eerst getoond,
  // want dit ondermijnt de betrouwbaarheid van de andere signalen hieronder
  // (aging/risico rekent net zo goed op een stabiel ordernummer).
  const {byOrder}=groupRowsByOrder();
  const refMismatches=[];
  Object.entries(byOrder).forEach(([wo,entries])=>{
    const m=findOrderReferenceMismatch(entries);
    if(m) refMismatches.push({wo,...m});
  });
  if(refMismatches.length){
    const list=refMismatches.slice(0,3).map(m=>
      `<strong>${esc(m.wo)}</strong> — W${m.a.week} &ldquo;${esc(m.a.omschrijving)}&rdquo; vs. W${m.b.week} &ldquo;${esc(m.b.omschrijving)}&rdquo;`
    ).join('<br>');
    const more=refMismatches.length>3?`<br><em style="color:#8b949e">en ${refMismatches.length-3} andere(n)&hellip;</em>`:'';
    insights.push({c:'#da3633',i:'&#9888;',
      title:`${refMismatches.length} ordernummer${refMismatches.length===1?'':'s'} met wisselende omschrijving`,
      body:`${list}${more}<br><span style="display:block;margin-top:4px;font-size:11px">Waarschijnlijk hergebruikt of verkeerd getypt ordernummer in de bron-Excel &mdash; de aging/risicoscore in de Backlog kan hierdoor een andere klus meetellen (zie de &#9888;-markering bij de order).</span>`});
  }

  // 1 — Hardnekkige backlog: WO's die 3+ keer open staan
  const persistent=[];
  Object.entries(byOrder).forEach(([wo,entries])=>{
    const openWeeks=[...new Set(entries.filter(e=>e.status!=='ja').map(e=>e._week))];
    if(openWeeks.length>=3) persistent.push({wo,omschrijving:entries[entries.length-1].omschrijving,openWeeks});
  });
  if(persistent.length){
    const list=persistent.slice(0,3).map(p=>{
      const s=p.omschrijving.length>45?p.omschrijving.substring(0,45)+'…':p.omschrijving;
      return`<strong>${esc(p.wo)}</strong> — ${esc(s)} <span style="color:#da3633">(${p.openWeeks.length}&times; niet uitgevoerd)</span>`;
    }).join('<br>');
    const more=persistent.length>3?`<br><em style="color:#8b949e">en ${persistent.length-3} andere(n)&hellip;</em>`:'';
    insights.push({c:'#da3633',i:'&#9888;',
      title:`${persistent.length} WO${persistent.length===1?'':'s'} staat al 3+ weken open`,
      body:`${list}${more}<br><span style="display:block;margin-top:4px;font-size:11px">Worden steeds opnieuw ingepland zonder afronding &mdash; structurele aandacht nodig.</span>`});
  }

  // 2 — Uitvoeringstrend (laatste 3 weken)
  if(weeks.length>=3){
    const sorted=[...weeks].sort((a,b)=>a.week-b.week);
    const last3=sorted.slice(-3);
    const pcts=last3.map(w=>{const r=w.rows;return r.length>0?Math.round(r.filter(x=>x.status==='ja').length/r.length*100):0;});
    const trend=pcts[2]-pcts[0];
    const labels=last3.map(w=>`W${w.week}`);
    if(Math.abs(trend)>=10){
      const up=trend>0;
      insights.push({c:up?'#2ea043':'#da3633',i:up?'&#9650;':'&#9660;',
        title:`Uitvoering ${up?'verbetert':'verslechtert'} (${up?'+':''}${trend}%)`,
        body:`${labels[0]}: <strong>${pcts[0]}%</strong> &rarr; ${labels[1]}: <strong>${pcts[1]}%</strong> &rarr; ${labels[2]}: <strong>${pcts[2]}%</strong><br>
          <span style="font-size:11px">${up?'Positieve ontwikkeling &mdash; uitvoeringspercentage stijgt.':'Zorgwekkende daling &mdash; check wat er in de laatste weken speelt.'}</span>`});
    } else {
      const avg=Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length);
      insights.push({c:avg>=70?'#2ea043':'#d29922',i:'&rarr;',
        title:`Stabiel uitvoeringspercentage (~${avg}%)`,
        body:`${labels[0]}: <strong>${pcts[0]}%</strong> &rarr; ${labels[1]}: <strong>${pcts[1]}%</strong> &rarr; ${labels[2]}: <strong>${pcts[2]}%</strong>`});
    }
  }

  // 3 — Hoog aandeel ongepland werk
  const allRows=weeks.flatMap(w=>w.rows);
  const totalAll=allRows.length;
  const ong=allRows.filter(r=>r.type==='ongepland').length;
  if(totalAll>0){
    const pct=Math.round(ong/totalAll*100);
    if(pct>=25){
      insights.push({c:pct>=40?'#da3633':'#d29922',i:'&#9889;',
        title:`${pct}% van alle WO's is ongepland werk`,
        body:`<strong>${ong}</strong> van de ${totalAll} werkorders is buiten de planning binnengekomen.<br>
          <span style="font-size:11px">${pct>=40?'Hoog aandeel &mdash; storingen of spoed verdringen de reguliere planning structureel.':'Let op het groeiende aandeel ongepland werk.'}</span>`});
    }
  }

  // 4 — Dominante reden voor niet-uitvoering
  const rc={};let totalReden=0;
  weeks.forEach(w=>w.rows.forEach(r=>{
    if(r.status==='ja'||!r.reden) return;
    const rd=r.reden.toString().trim();if(!rd) return;
    rc[rd]=(rc[rd]||0)+1;totalReden++;
  }));
  if(totalReden>0){
    const top=Object.entries(rc).sort((a,b)=>b[1]-a[1])[0];
    const topPct=Math.round(top[1]/totalReden*100);
    if(topPct>=30){
      insights.push({c:topPct>=50?'#da3633':'#d29922',i:'&#9679;',
        title:`"${esc(top[0])}" veroorzaakt ${topPct}% van niet-uitvoering`,
        body:`<strong>${top[1]}</strong> van de ${totalReden} niet-uitgevoerde WO's heeft deze reden.<br>
          <span style="font-size:11px">Wegnemen van deze oorzaak heeft de grootste impact op het uitvoeringspercentage.</span>`});
    }
  }

  // 5 — Meest belaste medewerker
  const pc={};
  weeks.forEach(w=>w.rows.forEach(r=>{
    (r.wie||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='—'&&x!=='Allen'&&x!=='H&S').forEach(p=>{pc[p]=(pc[p]||0)+1;});
  }));
  const persons=Object.entries(pc).sort((a,b)=>b[1]-a[1]);
  if(persons.length>=2){
    const avg=Object.values(pc).reduce((a,b)=>a+b,0)/persons.length;
    const [naam,cnt]=persons[0];
    if(cnt>avg*1.5){
      insights.push({c:'#388bfd',i:'&#9672;',
        title:`${esc(naam)} heeft de hoogste werkbelasting`,
        body:`<strong>${cnt}</strong> werkorders &mdash; ${Math.round(cnt/avg*100-100)}% meer dan gemiddeld (${Math.round(avg)} per persoon).<br>
          <span style="font-size:11px">Overweeg herverdeling voor betere borging van de planning.</span>`});
    }
  }

  if(!insights.length){
    el.innerHTML=`<div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:14px;padding:14px 18px;color:var(--color-text-secondary);font-size:13px">Geen opvallende patronen gevonden in de huidige data.</div>`;
    return;
  }
  el.innerHTML=`<div class="insight-grid">${insights.map(ins=>`
    <div class="insight-card" style="--ic-accent:${ins.c}">
      <div class="insight-title"><span style="color:${ins.c}">${ins.i}</span>${ins.title}</div>
      <div class="insight-body">${ins.body}</div>
    </div>`).join('')}</div>`;
}

// ── Reden Analyse ──────────────────────────────────────────────
// Leest de Reden direct uit de al geladen weekplanning (vastgelegd bij Excel-
// upload op rijen die niet "ja" als status hebben), in plaats van uit de
// losse 'weekplanning'-tabel die hiervoor leeg bleef.
function extractInstallatieCode(omschrijving){
  const m=(omschrijving||'').match(/^([A-Z]{2,3}\d{3,5}[A-Z]?):/);
  return m?m[1]:null;
}

function computeInstallatieData(){
  const map={};
  weeks.forEach(w=>(w.rows||[]).forEach(r=>{
    const code=extractInstallatieCode(r.omschrijving);
    if(!code) return;
    if(!map[code]) map[code]={code,rows:[]};
    map[code].rows.push({...r,_wk:`W${w.week}`});
  }));
  const stats=Object.values(map).map(({code,rows})=>{
    const totaal=rows.length;
    const nee=rows.filter(r=>r.status==='nee').length;
    const ongepland=rows.filter(r=>r.type==='ongepland').length;
    const ja=rows.filter(r=>r.status==='ja').length;
    const pct=totaal>0?Math.round(ja/totaal*100):0;
    return{code,rows,totaal,nee,ongepland,ja,pct};
  });
  stats.sort((a,b)=>(b.nee+b.ongepland)-(a.nee+a.ongepland)||b.totaal-a.totaal);
  window._installatieStats=stats.slice(0,10);
}

function renderAnalyseInstallatieList(){
  const el=document.getElementById('aInstallatieList');
  if(!el) return;
  const stats=window._installatieStats||[];
  if(!stats.length){
    el.innerHTML='<div style="color:#8b949e;font-size:13px;padding:8px 0">Geen installatie-data beschikbaar.</div>';
    return;
  }
  el.innerHTML=stats.map((s,i)=>{
    const col=s.pct>=80?'#2ea043':s.pct>=60?'#d29922':'#da3633';
    return`<div class="analyse-reden-item" id="aii-${i}" onclick="showInstallatieDetailPanel(${i})">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:13px;font-weight:600;color:#e6edf3;font-family:monospace">${s.code}</span>
        <span style="font-size:11px;color:#8b949e">${s.totaal} WO's</span>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;margin-bottom:5px">
        <span style="color:#da3633">&#9632; ${s.nee} niet uitgevoerd</span>
        <span style="color:#d29922">&#9889; ${s.ongepland} ongepland</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1;height:4px;background:#21262d;border-radius:2px;overflow:hidden"><div style="height:100%;width:${s.pct}%;background:${col};border-radius:2px"></div></div>
        <span style="font-size:11px;color:${col};min-width:32px;text-align:right">${s.pct}%</span>
      </div>
    </div>`;
  }).join('');
}

function showInstallatieDetailPanel(idx){
  document.querySelectorAll('[id^="aii-"]').forEach(el=>el.classList.remove('active'));
  const item=document.getElementById('aii-'+idx);
  if(item){item.classList.add('active');item.scrollIntoView({block:'nearest'});}
  const s=(window._installatieStats||[])[idx];
  const el=document.getElementById('aInstallatieDetail');
  if(!el||!s) return;
  const col=s.pct>=80?'#2ea043':s.pct>=60?'#d29922':'#da3633';
  let h=`<div style="margin-bottom:14px">
    <div style="font-size:15px;font-weight:600;color:#e6edf3;font-family:monospace;margin-bottom:4px">${s.code}</div>
    <div style="display:flex;gap:16px;font-size:12px;flex-wrap:wrap">
      <span style="color:#8b949e">${s.totaal} werkorders totaal</span>
      <span style="color:#da3633">${s.nee} niet uitgevoerd</span>
      <span style="color:#d29922">${s.ongepland} ongepland</span>
      <span style="color:${col};font-weight:600">${s.pct}% uitgevoerd</span>
    </div>
  </div>
  <div class="tw" style="margin-bottom:0"><table><thead><tr>
    <th style="width:42px">Week</th><th style="width:34px">Dag</th>
    <th style="width:82px">Order</th><th>Omschrijving</th>
    <th style="width:115px">Uitvoerende(n)</th>
    <th style="width:72px">Type</th><th style="width:82px">Uitgevoerd</th>
  </tr></thead><tbody>`;
  s.rows.forEach(r=>{
    h+=`<tr>
      <td data-label="Week" style="font-size:12px;color:#c3cdc6">${r._wk}</td>
      <td data-label="Dag" style="font-size:12px;color:#c3cdc6">${esc(r.day)}</td>
      <td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}</td>
      <td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}</td>
      <td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td>
      <td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td>
      <td data-label="Uitgevoerd">${sb(r.status)}</td>
    </tr>`;
  });
  h+='</tbody></table></div>';
  el.innerHTML=h;
}

// rows: optioneel — array met (voor)gefilterde rijen (zelfde vorm als
// computeKpiRows().allRows: heeft al _wk/_week). Zonder argument (de
// Analyse-pagina, die geen eigen week/type-filter heeft): alle rijen over
// alle weken heen, zoals voorheen.
function computeRedenData(rows){
  const redenCounts={};
  const redenRowsMap={};
  const source=rows||weeks.flatMap(w=>(w.rows||[]).map(row=>({...row,_wk:`W${w.week}`,_week:w.week})));
  source.forEach(row=>{
    if(row.status==='ja') return;
    const reden=row?.reden;
    if(reden&&reden.toString().trim()){
      const r=reden.toString().trim();
      redenCounts[r]=(redenCounts[r]||0)+1;
      if(!redenRowsMap[r]) redenRowsMap[r]=[];
      redenRowsMap[r].push(row);
    }
  });
  window._redenRowsMap=redenRowsMap;
  const total=Object.values(redenCounts).reduce((a,b)=>a+b,0);
  window._redenSorted=Object.entries(redenCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  window._redenTotal=total;
}

// rows/scopeLabel: zie computeRedenData — scopeLabel is puur voor de
// titelregel ("— Week 28" i.p.v. niets), zodat zichtbaar is dat de tabel
// het Dashboard-filter volgt i.p.v. altijd de volledige historie te tonen.
function loadRedenAnalyse(rows,scopeLabel) {
  try {
    computeRedenData(rows);
    const sorted=window._redenSorted;
    const totalNotExecuted=window._redenTotal||0;
    const scopeEl=document.getElementById('redenScopeLabel');
    if(scopeEl) scopeEl.textContent=scopeLabel?` — ${scopeLabel}`:'';
    const tbody = document.getElementById('redenTableBody');
    if (!tbody) return;
    if (sorted.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#8b949e;padding:20px 10px">Geen data beschikbaar — upload een Excel met een "Reden"-kolom om de analyse te zien.</td></tr>';
      return;
    }
    tbody.innerHTML = sorted.map(([reden, count]) => {
      const pct = totalNotExecuted > 0 ? ((count / totalNotExecuted) * 100).toFixed(1) : '0.0';
      // Reden-tekst gaat url-encoded mee i.p.v. een positie-index: de
      // Analyse-pagina berekent zijn eigen (altijd ongefilterde) volgorde
      // opnieuw, dus een index van hier zou daar op de verkeerde reden
      // kunnen wijzen zodra het Dashboard-filter actief is.
      return `<tr class="reden-row" onclick="goToAnalyse('${encodeURIComponent(reden)}')" tabindex="0" role="button" title="Klik om werkorders te bekijken">
        <td>${esc(reden)}<span class="tog">&#9658;</span></td>
        <td style="text-align:right;font-weight:500">${count}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:6px;background:#21262d;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#2ea043"></div></div><span style="font-size:11px;color:#8b949e;min-width:30px">${pct}%</span></div></td>
      </tr>`;
    }).join('');
  } catch (error) {
    console.error('Fout bij laden reden analyse:', error);
    const tbody = document.getElementById('redenTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:#da3633;padding:10px">Fout: ' + (error.message || 'Onbekende fout') + '</td></tr>';
    }
  }
}

function goToAnalyse(redenEncoded){
  showPage('analyse');
  if(redenEncoded===undefined) return;
  const reden=decodeURIComponent(redenEncoded);
  const idx=(window._redenSorted||[]).findIndex(([r])=>r===reden);
  if(idx>=0) showRedenDetailPanel(idx);
}

function renderAnalysePage(){
  computeRedenData();
  computeInstallatieData();
  renderRedenSelector();
  renderAnalyseInstallatieList();
  renderInzichten();
}

// Vult de reden-pulldown (gesorteerd op frequentie) en toont daarna de
// meest voorkomende reden — geen los "selecteer eerst iets"-scherm nodig,
// een select heeft altijd al een waarde.
function renderRedenSelector(){
  const sel=document.getElementById('aRedenSelect');
  if(!sel) return;
  const sorted=window._redenSorted||[];
  if(!sorted.length){
    sel.innerHTML='<option>Geen data</option>';
    sel.disabled=true;
    const statsEl=document.getElementById('aRedenStats');
    if(statsEl) statsEl.innerHTML='';
    const el=document.getElementById('aRedenDetail');
    if(el) el.innerHTML=emptyState('inbox','Geen reden-data beschikbaar','Upload een Excel met een "Reden"-kolom om deze analyse te zien.');
    return;
  }
  sel.disabled=false;
  sel.innerHTML=sorted.map(([reden,count],i)=>`<option value="${i}">${esc(reden)} (${count}&times;)</option>`).join('');
  showRedenDetailPanel(0);
}

// Storing-koppeling: er is geen directe link tussen een niet-uitgevoerde
// geplande WO en de storing die hem verdrong (het Excel-format legt dat
// verband niet vast) — dus wordt hij afgeleid. Sterkste signaal: ongepland
// werk in dezelfde week bij (een van) dezelfde uitvoerende(n) — die persoon
// is toen kennelijk van het geplande werk afgehaald voor de storing. Zonder
// zo'n overlap is elk ongepland werk die week een zwakkere kandidaat.
function namenSet(wie){
  return new Set((wie||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='—'&&x!=='Allen'&&x!=='H&S'));
}
function findStoringMatches(row){
  const w=weeks.find(w=>w.week===row._week);
  const cands=w?w.rows.filter(r=>r.type==='ongepland'):[];
  if(!cands.length) return{tier:0,items:[]};
  const mijnNamen=namenSet(row.wie);
  if(mijnNamen.size){
    const overlap=cands.filter(c=>{
      const cn=namenSet(c.wie);
      for(const n of cn) if(mijnNamen.has(n)) return true;
      return false;
    });
    if(overlap.length) return{tier:1,items:overlap};
  }
  return{tier:2,items:cands};
}
function renderStoringMatches(m,wkLabel){
  if(!m.items.length) return`<div class="storing-match-empty">Geen ongepland werk gevonden in ${esc(wkLabel)} om dit aan te koppelen.</div>`;
  const label=m.tier===1
    ?`Waarschijnlijke oorzaak — ongepland werk in ${esc(wkLabel)} bij dezelfde uitvoerende(n):`
    :`Ongepland werk in ${esc(wkLabel)} (geen match op uitvoerende — mogelijke oorzaak):`;
  const list=m.items.map(c=>`<div class="storing-match-row">
      <span class="storing-match-wo">${esc(c.wo||'—')}</span>
      <span class="storing-match-desc">${esc(c.omschrijving)}</span>
      <span class="storing-match-wie">${esc(c.wie||'—')}</span>
    </div>`).join('');
  return`<div class="storing-match"><div class="storing-match-label">${label}</div>${list}</div>`;
}
function toggleRedenStoringRow(id){
  const detail=document.getElementById(id);
  if(!detail) return;
  const open=detail.classList.toggle('open');
  const trigger=detail.previousElementSibling;
  if(trigger) trigger.classList.toggle('open',open);
}
window.toggleRedenStoringRow=toggleRedenStoringRow;

function showRedenDetailPanel(idx){
  const sorted=window._redenSorted||[];
  const total=window._redenTotal||0;
  const sel=document.getElementById('aRedenSelect');
  if(sel&&idx>=0&&idx<sorted.length&&sel.selectedIndex!==idx) sel.selectedIndex=idx;
  const entry=sorted[idx];
  const reden=entry?entry[0]:null;
  const count=entry?entry[1]:0;
  const pct=total>0?Math.round(count/total*100):0;
  const statsEl=document.getElementById('aRedenStats');
  if(statsEl){
    statsEl.innerHTML=entry?`
      <div class="an-stat"><div class="an-stat-l">Aantal keer</div><div class="an-stat-v">${count}</div></div>
      <div class="an-stat"><div class="an-stat-l">Aandeel van alle niet-uitgevoerde WO's</div><div class="an-stat-v">${pct}%</div></div>
      <div class="an-stat"><div class="an-stat-l">Positie</div><div class="an-stat-v">#${idx+1} <span class="an-stat-of">van ${sorted.length}</span></div></div>
    `:'';
  }
  const rows=reden?((window._redenRowsMap||{})[reden]||[]):[];
  const el=document.getElementById('aRedenDetail');
  if(!el) return;
  if(!rows.length){
    el.innerHTML=emptyState('inbox','Geen werkorders gevonden','Er zijn geen werkorders die aan deze reden gekoppeld zijn.');
    return;
  }
  // Reden gaat over een storing: rijen worden uitklapbaar en tonen welk
  // ongepland werk er die week (vermoedelijk) voor in de plaats kwam.
  const isStoring=!!(reden&&/storing/i.test(reden));
  let h=`<div class="ws" style="margin:16px 0 8px">${rows.length} werkorder${rows.length===1?'':'s'} met deze reden${isStoring?' — klik op een rij om te zien welk ongepland werk er die week voor in de plaats kwam':''}</div>
  <div class="tw" style="margin-bottom:0"><table><thead><tr>
    <th style="width:42px">Week</th><th style="width:34px">Dag</th>
    <th style="width:82px">Order</th><th>Omschrijving</th>
    <th style="width:115px">Uitvoerende(n)</th>
    <th style="width:72px">Type</th><th style="width:82px">Uitgevoerd</th>
    <th style="width:200px">Opmerking</th>
  </tr></thead><tbody>`;
  rows.forEach((r,ri)=>{
    const detailId=`redenStoring_${ri}`;
    const rowAttrs=isStoring?` class="reden-row" onclick="toggleRedenStoringRow('${detailId}')" tabindex="0" role="button" title="Klik om mogelijke storing te zien" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleRedenStoringRow('${detailId}')}"`:'';
    h+=`<tr${rowAttrs}>
      <td data-label="Week" style="font-size:12px;color:#c3cdc6">${r._wk}</td>
      <td data-label="Dag" style="font-size:12px;color:#c3cdc6">${esc(r.day)}</td>
      <td data-label="Order" style="font-family:monospace;font-size:11px;color:#c3cdc6">${esc(r.wo)}</td>
      <td data-label="Omschrijving" title="${esc(r.omschrijving)}">${esc(r.omschrijving)}${isStoring?'<span class="tog">&#9658;</span>':''}</td>
      <td data-label="Uitvoerende(n)" style="font-size:12px;color:#8b949e">${esc(r.wie)}</td>
      <td data-label="Type">${r.type==='gepland'?'<span class="badge bg2">Gepland</span>':'<span class="badge bo2">Ongepland</span>'}</td>
      <td data-label="Uitgevoerd">${sb(r.status)}</td>
      <td data-label="Opmerking" style="font-size:12px;color:#8b949e" title="${esc(r.opmerking||'')}">${esc(r.opmerking||'—')}</td>
    </tr>`;
    if(isStoring){
      h+=`<tr class="reden-detail-row" id="${detailId}"><td colspan="8">${renderStoringMatches(findStoringMatches(r),r._wk)}</td></tr>`;
    }
  });
  h+='</tbody></table></div>';
  el.innerHTML=h;
}
