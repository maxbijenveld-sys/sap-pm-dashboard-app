// Betrouwbaarheid — voorbeeldweergave met illustratieve storingsdata.
// Puur ter demonstratie van hoe deze pagina werkt zodra de SAP-koppeling
// (nieuwe SQL Server) echte storingsmeldingen aanlevert — zie
// docs/SAP_MODULE_PLAN.md. Geen van de cijfers hieronder is een echte
// meting. Init gebeurt via window.__initBetrouwbaarheid(), aangeroepen
// vanuit de SAP PM-kaart op Start (js/home.js) — zelfde patroon als
// window.__showFinance() voor de Financiënmodule.
//
// Vaste "vandaag"-datum (i.p.v. new Date()) zodat "dagen open" hier blijft
// kloppen met de statische 34-dagen-tekst in de KPI-kaart erboven, ook
// weken/maanden nadat dit geschreven is — dit is en blijft een prototype
// met bevroren voorbeelddata, geen live meting.
(function(){
  const VANDAAG = new Date('2026-07-30T00:00:00');

  const STORINGEN = [
    {installatie:'KM802', wo:'11862201', datum:'2026-05-05', hersteld:'2026-05-10', ordersoort:'PM01', week:19, omschrijving:'Lagertemperatuur te hoog — lager vervangen'},
    {installatie:'KM802', wo:'11864455', datum:'2026-05-19', hersteld:'2026-05-26', ordersoort:'PM01', week:21, omschrijving:'Trillingsniveau boven norm — uitlijning gecontroleerd'},
    {installatie:'KM802', wo:'11868810', datum:'2026-06-02', hersteld:'2026-06-05', ordersoort:'PM02', week:23, omschrijving:'Onverwachte stilstand — motorbeveiliging geactiveerd'},
    {installatie:'KM802', wo:'11872290', datum:'2026-06-16', hersteld:'2026-06-21', ordersoort:'PM01', week:25, omschrijving:'Lekkage smeerolie bij lagerhuis'},
    {installatie:'KM802', wo:'11886093', datum:'2026-06-26', hersteld:null,          ordersoort:'PM01', week:26, omschrijving:'Lagertemperatuur wederom afwijkend — onderdeel besteld'},
    {installatie:'KM802', wo:'11891004', datum:'2026-07-14', hersteld:'2026-07-20', ordersoort:'PM01', week:29, omschrijving:'Lager vervangen (2e keer dit kwartaal)'},

    {installatie:'BK3410', wo:'11862640', datum:'2026-05-08', hersteld:'2026-05-11', ordersoort:'PM02', week:19, omschrijving:'Hoeveelheid aardgas afwijkend — sensor gekalibreerd'},
    {installatie:'BK3410', wo:'11867500', datum:'2026-05-30', hersteld:'2026-06-02', ordersoort:'PM01', week:22, omschrijving:'UV-meting buiten bereik'},
    {installatie:'BK3410', wo:'11878820', datum:'2026-06-25', hersteld:'2026-06-29', ordersoort:'PM02', week:26, omschrijving:'Onderdruk branderkamer buiten bandbreedte'},
    {installatie:'BK3410', wo:'11893100', datum:'2026-07-18', hersteld:'2026-07-21', ordersoort:'PM01', week:30, omschrijving:'Filter vervangen na alarmmelding'},

    {installatie:'OV4731', wo:'11863310', datum:'2026-05-15', hersteld:'2026-05-17', ordersoort:'PM02', week:20, omschrijving:'Onbalans waaier — schoongemaakt'},
    {installatie:'OV4731', wo:'11875600', datum:'2026-06-20', hersteld:'2026-06-23', ordersoort:'PM01', week:25, omschrijving:'Lager vervangen'},
    {installatie:'OV4731', wo:'11894410', datum:'2026-07-22', hersteld:'2026-07-25', ordersoort:'PM02', week:30, omschrijving:'Trilling boven norm — inspectie uitgevoerd'},

    {installatie:'CO4711', wo:'11865900', datum:'2026-05-25', hersteld:'2026-05-28', ordersoort:'PM01', week:21, omschrijving:'Lekkage persleiding verholpen'},
    {installatie:'CO4711', wo:'11888700', datum:'2026-07-08', hersteld:'2026-07-13', ordersoort:'PM02', week:28, omschrijving:'Persleiding wederom lekkage — pakking vervangen'}
  ];

  // Trend is hier een redactionele voorbeeldlabel, geen berekening —
  // consistent met de illustratieve aard van deze hele pagina.
  const TREND = {KM802:'down', BK3410:'flat', OV4731:'up', CO4711:'flat'};
  const TREND_LABEL = {down:'&#9660; MTBF daalt', flat:'&#8226; stabiel', up:'&#9650; MTBF stijgt'};

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function daysBetween(a,b){ return Math.round((b-a)/86400000); }
  function fmtNl(dstr){ const d=new Date(dstr+'T00:00:00'); return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short'}); }

  let _relChart=null;
  let _relActiveInstallatie=null;

  function huidigeFilters(){
    const inst=document.getElementById('relInstallatieFilter').value;
    const periodeWeken=document.getElementById('relPeriodeFilter').value==='28'?4:13;
    const minWeek=31-periodeWeken+1; // week 31 = huidige week (zie VANDAAG)
    return {inst,minWeek};
  }

  function filteredStoringen(){
    const {inst,minWeek}=huidigeFilters();
    return STORINGEN.filter(s=>s.week>=minWeek&&(!inst||s.installatie===inst));
  }

  function renderChart(){
    const {minWeek}=huidigeFilters();
    const rows=filteredStoringen();
    const labels=[]; const counts=[];
    for(let w=minWeek; w<=31; w++){
      labels.push('Wk '+w);
      counts.push(rows.filter(r=>r.week===w).length);
    }
    const canvas=document.getElementById('relChart');
    if(!canvas||typeof Chart==='undefined') return;
    if(_relChart) _relChart.destroy();
    const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
    // Zelfde externe tooltip-handler als de rest van de app (zie
    // legacy-app.js): Chart.js' eigen tooltippositionering lijnt niet uit
    // onder de CSS-zoom van deze app (css/app.css, body{zoom:...}).
    const tooltipCfg=typeof externalTooltipHandler==='function'
      ?{enabled:false,external:externalTooltipHandler}
      :{enabled:true};
    _relChart=new Chart(canvas,{type:'bar',data:{labels,datasets:[
      {label:'Storingen',data:counts,backgroundColor:'#d29922',borderRadius:4,maxBarThickness:28}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tooltipCfg},
      scales:{
        x:{grid:{display:false},ticks:{color:tickColor,font:{size:12}}},
        y:{grid:{color:gridColor},ticks:{color:tickColor,stepSize:1,font:{size:12}},beginAtZero:true}
      }}});
  }

  function renderTabel(){
    const {inst}=huidigeFilters();
    const rows=filteredStoringen();
    const byInst=new Map();
    rows.forEach(r=>{ if(!byInst.has(r.installatie)) byInst.set(r.installatie,[]); byInst.get(r.installatie).push(r); });

    let html=`<div class="tw"><table><thead><tr><th>Installatie</th><th>Storingen</th><th>MTBF</th><th>MTTR</th><th>MTBF-trend</th></tr></thead><tbody>`;
    if(!byInst.size){
      html+=`<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--color-text-secondary)">Geen storingen in deze periode</td></tr>`;
    }
    [...byInst.entries()].sort((a,b)=>b[1].length-a[1].length).forEach(([naam,entries])=>{
      entries.sort((a,b)=>a.datum.localeCompare(b.datum));
      const hersteld=entries.filter(e=>e.hersteld);
      const mttr=hersteld.length?(hersteld.reduce((s,e)=>s+daysBetween(new Date(e.datum+'T00:00:00'),new Date(e.hersteld+'T00:00:00')),0)/hersteld.length):null;
      let mtbf=null;
      if(entries.length>1){
        const spanDagen=daysBetween(new Date(entries[0].datum+'T00:00:00'),new Date(entries[entries.length-1].datum+'T00:00:00'));
        mtbf=(spanDagen/(entries.length-1))/7;
      }
      const trend=TREND[naam]||'flat';
      html+=`<tr class="rel-row" data-inst="${esc(naam)}" style="cursor:pointer" role="button" tabindex="0">
        <td>${esc(naam)}</td>
        <td>${entries.length}</td>
        <td>${mtbf!=null?mtbf.toFixed(1).replace('.',',')+' wk':'&mdash;'}</td>
        <td>${mttr!=null?mttr.toFixed(1).replace('.',',')+' dg':'&mdash;'}</td>
        <td><span class="kc-trend ${trend}">${TREND_LABEL[trend]}</span></td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    const host=document.getElementById('relInstallatieTabel');
    if(!host) return;
    host.innerHTML=html;
    host.querySelectorAll('.rel-row').forEach(tr=>{
      const open=()=>renderDetail(tr.getAttribute('data-inst'));
      tr.addEventListener('click',open);
      tr.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
    // Filter kan de eerder geopende installatie hebben weggefilterd (bv.
    // door de periode te verkorten) — detail dan ook sluiten i.p.v. een
    // wees-paneel te laten staan.
    if(_relActiveInstallatie && !byInst.has(_relActiveInstallatie)){
      _relActiveInstallatie=null;
      document.getElementById('relInstallatieDetail').innerHTML='';
    } else if(_relActiveInstallatie){
      renderDetail(_relActiveInstallatie);
    }
  }

  function renderDetail(naam){
    _relActiveInstallatie=naam;
    const rows=filteredStoringen().filter(r=>r.installatie===naam).sort((a,b)=>b.datum.localeCompare(a.datum));
    let html=`<div class="sl" style="margin-top:20px">Meldingen — ${esc(naam)}</div>
      <div class="tw"><table><thead><tr><th>Datum</th><th>Werkorder</th><th>Ordersoort</th><th>Omschrijving</th><th>Status</th></tr></thead><tbody>`;
    rows.forEach(r=>{
      const status=r.hersteld
        ?`Hersteld (${daysBetween(new Date(r.datum+'T00:00:00'),new Date(r.hersteld+'T00:00:00'))} dg)`
        :`<span style="color:var(--color-danger);font-weight:600">Open — ${daysBetween(new Date(r.datum+'T00:00:00'),VANDAAG)} dg</span>`;
      html+=`<tr>
        <td data-label="Datum">${fmtNl(r.datum)}</td>
        <td data-label="Werkorder" style="font-family:monospace">${esc(r.wo)}</td>
        <td data-label="Ordersoort">${esc(r.ordersoort)}</td>
        <td data-label="Omschrijving">${esc(r.omschrijving)}</td>
        <td data-label="Status">${status}</td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    document.getElementById('relInstallatieDetail').innerHTML=html;
  }

  function vulInstallatieFilter(){
    const sel=document.getElementById('relInstallatieFilter');
    if(!sel||sel.dataset.filled) return;
    sel.dataset.filled='1';
    [...new Set(STORINGEN.map(s=>s.installatie))].sort().forEach(naam=>{
      const opt=document.createElement('option');
      opt.value=naam; opt.textContent=naam;
      sel.appendChild(opt);
    });
    sel.addEventListener('change',renderAll);
    document.getElementById('relPeriodeFilter').addEventListener('change',renderAll);
  }

  function renderAll(){ renderChart(); renderTabel(); }

  window.__initBetrouwbaarheid=function(){
    vulInstallatieFilter();
    renderAll();
  };
})();
