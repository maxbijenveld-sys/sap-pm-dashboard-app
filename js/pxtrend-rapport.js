// PX Trend — Dagrapport / Weekrapport voor het Early Warning-scherm.
// Zelfde patroon als js/report.js (het Onderhoud-weekrapport): een eigen
// pagina, on-screen én printbaar via window.print() + de @media
// print-regels in css/app.css (hier gescoped op #pxRptDoc, los van #rptDoc
// om conflicten met het Onderhoud-rapport te vermijden).
//
// Hergebruikt de analyse-motor uit js/pxtrend-conditie.js
// (window.__pxConditie) — geen dubbele statuslogica.
//
// Peildatum: de EL2310-reeks loopt tot 6 nov 2025 (bijna 10 maanden vóór
// "vandaag" in dit prototype) — een rapport op de kalenderdatum van vandaag
// zou dus altijd leeg zijn. Daarom een peildatum-kiezer, default op de
// laatste beschikbare meetdatum, zodat ook naar de echte gevonden afwijking
// (sep/okt 2024) genavigeerd kan worden. Zie docs/PX_TREND_MODULE_PLAN.md §8.
(function(){
  const PAGE_ID='pg-pxrapport';
  let _mode='week';
  let _peildatum=null;

  function ensurePage(){
    let pg=document.getElementById(PAGE_ID);
    if(pg) return pg;
    const main=document.querySelector('.main');
    if(!main) return null;
    pg=document.createElement('div');
    pg.className='pg';
    pg.id=PAGE_ID;
    main.appendChild(pg);
    return pg;
  }

  function periodeVoorDatum(periodes,datum){
    let gekozen=periodes[0];
    for(let i=0;i<periodes.length;i++){ if(periodes[i].start<=datum) gekozen=periodes[i]; else break; }
    return gekozen;
  }

  const RANK={actie:3,onderzoeken:2,monitoren:1,normaal:0};
  function classificeer(huidige,vorige){
    if(!vorige) return null;
    if(huidige.status!=='normaal'&&vorige.status==='normaal') return 'nieuw';
    if(huidige.status!=='normaal'&&huidige.status===vorige.status) return 'aanhoudend';
    if(RANK[huidige.status]>RANK[vorige.status]) return 'verslechterend';
    if(RANK[huidige.status]<RANK[vorige.status]&&vorige.status!=='normaal') return 'verbeterd';
    return null;
  }

  function build(){
    const api=window.__pxConditie;
    if(!api) return '<div class="wf">Conditiemotor (js/pxtrend-conditie.js) niet geladen.</div>';
    const {esc,fmtDatum,fmtDatumTijd,fmtNl,STATUS_LABEL,STATUS_EMOJI,prioriteitScore}=api;
    const el=api.analyseEL2310();
    if(!el) return '<div class="wf">Geen EL2310-meetdata geladen.</div>';

    const periodes=_mode==='dag'?api.historieDagelijks(el):api.historieWekelijks(el);
    if(!periodes.length) return '<div class="wf">Geen periodes berekend.</div>';
    if(!_peildatum) _peildatum=el.laatsteDatum;
    const huidige=periodeVoorDatum(periodes,_peildatum);
    const idx=periodes.indexOf(huidige);
    const vorige=idx>0?periodes[idx-1]:null;
    const classificatie=classificeer(huidige,vorige);

    const records=api.buildInstallationHealth();
    const counts={normaal:0,monitoren:0,onderzoeken:0,actie:0,onvoldoende:0};
    records.forEach(r=>{ const st=r.code==='EL2310'?huidige.status:r.status; counts[st]++; });

    const periodeLabel=_mode==='dag'
      ?fmtDatum(huidige.start)
      :`${fmtDatum(huidige.start)} t/m ${fmtDatum(huidige.end)}`;
    const gen=new Date().toLocaleString('nl-NL',{dateStyle:'full',timeStyle:'short'});

    const kpiCell=(l,v,s)=>`<div class="rpt-kpi"><div class="rpt-kpi-l">${l}</div><div class="rpt-kpi-v">${v}</div><div class="rpt-kpi-s">${s||''}</div></div>`;

    // Classificatietekst voor EL2310, de enige installatie met variabele status.
    const CLASS_TXT={
      nieuw:{label:'Nieuwe afwijking',kleur:'var(--color-danger)'},
      aanhoudend:{label:'Aanhoudende afwijking',kleur:'var(--color-warning)'},
      verslechterend:{label:'Verslechterend',kleur:'var(--color-danger)'},
      verbeterd:{label:'Verbeterd',kleur:'var(--color-success)'}
    };
    const classHtml=classificatie
      ?`<p class="rpt-lead"><strong style="color:${CLASS_TXT[classificatie].kleur}">${CLASS_TXT[classificatie].label}:</strong> EL2310 stond ${_mode==='dag'?'de vorige dag':'de vorige periode'} op <strong>${STATUS_LABEL[vorige.status]}</strong> en staat nu op <strong>${STATUS_LABEL[huidige.status]}</strong>.</p>`
      :`<p class="rpt-none">Geen statusverandering t.o.v. de vorige ${_mode==='dag'?'dag':'week'} (EL2310 blijft ${STATUS_LABEL[huidige.status]}).</p>`;

    // Top afwijkende installaties op de peildatum: effectief alleen EL2310
    // (enige met een volwaardige status) — historische episodes uit die
    // periode eromheen worden erbij getoond voor context.
    const topRows=[];
    if(huidige.status!=='normaal'){
      let streakPeriodes=0;
      for(let i=idx;i>=0&&periodes[i].status!=='normaal';i--) streakPeriodes++;
      const periodeUren=_mode==='dag'?24:7*24;
      topRows.push({code:'EL2310',status:huidige.status,reden:`Status ${STATUS_LABEL[huidige.status]} sinds ${streakPeriodes} ${_mode==='dag'?'dag':'week'}${streakPeriodes===1?'':'en'}`,prioriteit:prioriteitScore(huidige.status,streakPeriodes*periodeUren,classificatie==='verslechterend')});
    }

    return `
    <div class="whr rpt-hide-print">
      <div><div class="wt">${_mode==='dag'?'Dagrapport':'Weekrapport'} — Conditiebewaking</div><div class="ws">Automatisch gegenereerd op basis van PX Trend-data &middot; peildatum ${esc(periodeLabel)}</div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px;color:var(--color-text-secondary)">Peildatum
          <input type="date" id="pxRptDatum" class="inp" style="width:auto;display:inline-block;margin-left:6px"
            value="${_peildatum.toISOString().slice(0,10)}"
            min="${el.reeks.length?api.hourDate(el.epoch,el.reeks[0][0]).toISOString().slice(0,10):''}"
            max="${el.laatsteDatum.toISOString().slice(0,10)}">
        </label>
        <button class="btn${_mode==='dag'?' btn-p':''}" id="pxRptModeDag">Dag</button>
        <button class="btn${_mode==='week'?' btn-p':''}" id="pxRptModeWeek">Week</button>
        <button class="btn btn-p" onclick="window.print()">Print / PDF</button>
        <button class="btn" onclick="showPage('pxtrend')">&#8592; Terug</button>
      </div>
    </div>
    <div id="pxRptDoc">
      <div class="rpt-head">
        <div class="rpt-title">${_mode==='dag'?'Dagrapport':'Weekrapport'} conditiebewaking — ${esc(periodeLabel)}</div>
        <div class="rpt-meta">PX Trend Early Warning &middot; gegenereerd ${esc(gen)} &middot; peildatum gekozen door gebruiker (data loopt t/m ${esc(fmtDatum(el.laatsteDatum))})</div>
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Conditiebeoordeling</div>
        ${classHtml}
        <div class="rpt-kpis">
          ${['normaal','monitoren','onderzoeken','actie','onvoldoende'].map(st=>kpiCell(`${STATUS_EMOJI[st]} ${STATUS_LABEL[st]}`,counts[st],'installaties')).join('')}
        </div>
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Top afwijkende installaties</div>
        ${topRows.length?`<div class="tw keep-table"><table><thead><tr><th>Installatie</th><th>Status</th><th>Reden</th><th>Prioriteit</th></tr></thead><tbody>
          ${topRows.map(r=>`<tr><td style="font-family:monospace">${esc(r.code)}</td><td>${STATUS_EMOJI[r.status]} ${STATUS_LABEL[r.status]}</td><td>${esc(r.reden)}</td><td>${fmtNl(r.prioriteit,1)}</td></tr>`).join('')}
        </tbody></table></div>`:'<p class="rpt-none">Geen installaties met een afwijkende status op deze peildatum.</p>'}
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Historische afwijkingen — EL2310 (alle 9 jaar)</div>
        <p class="rpt-none" style="margin-bottom:8px">Automatisch gevonden, onafhankelijk van de gekozen peildatum — ter referentie.</p>
        ${el.afwijkendeStops.length?`<div class="tw keep-table"><table><thead><tr><th>Van</th><th>Tot</th><th>Duur</th></tr></thead><tbody>
          ${el.afwijkendeStops.map(e=>`<tr><td>${esc(fmtDatumTijd(e.start))}</td><td>${esc(fmtDatumTijd(e.end))}</td><td>${(e.uren/24).toFixed(1)} dagen</td></tr>`).join('')}
        </tbody></table></div>`:'<p class="rpt-none">Geen afwijkende stilstanden gevonden.</p>'}
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Dekking</div>
        <p class="rpt-none">Dit rapport dekt op dit moment 1 van de 270 installaties met een volwaardige status (EL2310) en 1 met gedeeltelijke data zonder oordeel (BU4930). De overige 268 hebben nog geen gekoppelde PX Trend-historie en tellen daarom mee als "Onvoldoende data" &mdash; geen verzonnen status.</p>
      </div>
    </div>`;
  }

  function bind(){
    const datumEl=document.getElementById('pxRptDatum');
    if(datumEl) datumEl.addEventListener('change',()=>{ _peildatum=new Date(datumEl.value+'T12:00:00Z'); render(); });
    const dagBtn=document.getElementById('pxRptModeDag');
    if(dagBtn) dagBtn.addEventListener('click',()=>{ _mode='dag'; render(); });
    const weekBtn=document.getElementById('pxRptModeWeek');
    if(weekBtn) weekBtn.addEventListener('click',()=>{ _mode='week'; render(); });
  }

  function render(){
    const pg=ensurePage();
    if(!pg) return;
    pg.innerHTML=build();
    bind();
  }

  window.openPxRapport=function(mode){
    _mode=mode||'week';
    _peildatum=null;
    const pg=ensurePage();
    if(!pg) return;
    render();
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
    pg.classList.add('active');
    if(typeof window.navigate==='function') window.navigate({page:'pxrapport'});
    window.scrollTo(0,0);
  };
})();
