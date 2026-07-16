// Weekrapport — automatisch gegenereerd managementrapport over de laatste
// week + de trend erheen: KPI's, uitvoering, redenen, top-risico's uit de
// backlog en de automatische signalen. On-screen als gewone app-pagina,
// en met één knop printbaar (PDF via de browser-printdialoog; de
// @media print-regels in app.css maken er een lichte A4-opmaak van).
//
// Klassiek script, net als palette.js: leunt op de globals uit
// legacy-app.js (weeks, kpis, groupRowsByOrder, esc, …) en computeRisk
// uit js/risk.js.

(function(){
  'use strict';
  const PAGE_ID='pg-rapport';

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

  function pctRow(w){
    const k=kpis(w.rows);
    return{week:w.week,label:w.label||'',...k};
  }

  function build(){
    const wks=(typeof weeks!=='undefined'?weeks:[]).slice().sort((a,b)=>a.week-b.week);
    if(!wks.length) return '<div class="wf">Nog geen weekdata geladen.</div>';
    const cur=wks[wks.length-1];
    const prev=wks.length>1?wks[wks.length-2]:null;
    const k=kpis(cur.rows);
    const kPrev=prev?kpis(prev.rows):null;
    const delta=kPrev?k.pct-kPrev.pct:null;
    const gen=new Date().toLocaleString('nl-NL',{dateStyle:'full',timeStyle:'short'});

    // Kernzin: één samenvattende conclusie bovenaan, zoals een mens hem in
    // een mail zou schrijven — cijfers eronder onderbouwen hem.
    const oordeel=k.pct>=80?'een sterke week':k.pct>=60?'een redelijke week':'een moeizame week';
    const trendZin=delta==null?'':delta===0?' Gelijk aan vorige week.':` Dat is ${Math.abs(delta)} procentpunt ${delta>0?'beter':'slechter'} dan W${prev.week} (${kPrev.pct}%).`;

    // Redenen voor niet-uitvoering in de rapportweek.
    const rc={};
    cur.rows.forEach(r=>{if(r.status!=='ja'&&r.reden&&r.reden.trim())rc[r.reden.trim()]=(rc[r.reden.trim()]||0)+1;});
    const redenen=Object.entries(rc).sort((a,b)=>b[1]-a[1]);

    // Top-risico's uit de hele backlog (zelfde score als de Backlog-pagina).
    const {byOrder}=groupRowsByOrder();
    const probSet=typeof probleemInstallatieSet==='function'?probleemInstallatieSet():new Set();
    const risico=[];
    Object.entries(byOrder).forEach(([wo,entries])=>{
      const r=computeRisk(entries,probSet);
      if(r) risico.push({wo,omschrijving:entries[entries.length-1].omschrijving||'',wie:entries[entries.length-1].wie||'',risk:r});
    });
    risico.sort((a,b)=>b.risk.score-a.risk.score);
    const openTotaal=risico.length;
    const top=risico.slice(0,10);

    // Trendtabel: laatste 6 weken.
    const trend=wks.slice(-6).map(pctRow);

    const kpiCell=(l,v,s)=>`<div class="rpt-kpi"><div class="rpt-kpi-l">${l}</div><div class="rpt-kpi-v">${v}</div><div class="rpt-kpi-s">${s||''}</div></div>`;

    return `
    <div class="whr rpt-hide-print">
      <div><div class="wt">Weekrapport — W${cur.week}</div><div class="ws">Automatisch gegenereerd managementrapport over de laatste week en de trend</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-p" onclick="window.print()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print / PDF</button>
        <button class="btn" onclick="showPage('dashboard')">&#8592; Terug</button>
      </div>
    </div>
    <div id="rptDoc">
      <div class="rpt-head">
        <div class="rpt-title">Weekrapport onderhoud — Week ${cur.week}${cur.label?` (${esc(cur.label)})`:''}</div>
        <div class="rpt-meta">Heidelberg Materials IJmuiden &middot; gegenereerd ${esc(gen)}</div>
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Samenvatting</div>
        <p class="rpt-lead">Week ${cur.week} was <strong>${oordeel}</strong>: <strong>${k.pct}%</strong> van de ${k.t} werkorders is afgerond.${trendZin}
        ${k.o>0?` Er kwam${k.o===1?'':'en'} <strong>${k.o}</strong> ongeplande werkorder${k.o===1?'':'s'} bij.`:''}
        ${openTotaal>0?` In de totale backlog staan <strong>${openTotaal}</strong> unieke WO's open, waarvan <strong>${risico.filter(r=>r.risk.level==='hoog').length}</strong> met hoog risico.`:''}</p>
        <div class="rpt-kpis">
          ${kpiCell('Werkorders',k.t,`${k.g} gepland · ${k.o} ongepland`)}
          ${kpiCell('Afgerond',`${k.pct}%`,`${k.ja} van ${k.t}`)}
          ${kpiCell('Niet uitgevoerd',k.nee,'status Nee')}
          ${kpiCell('Deels / UC',k.d,'gestart, niet af')}
          ${kpiCell('Backlog open',openTotaal,'unieke WO’s')}
        </div>
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Trend — laatste ${trend.length} weken</div>
        <div class="tw keep-table"><table><thead><tr><th>Week</th><th style="text-align:right">WO's</th><th style="text-align:right">Afgerond</th><th style="text-align:right">Nee</th><th style="text-align:right">Deels/UC</th><th style="text-align:right">Ongepland</th><th style="text-align:right">% afgerond</th></tr></thead><tbody>
          ${trend.map(t=>`<tr${t.week===cur.week?' style="font-weight:600"':''}><td>W${t.week}</td><td style="text-align:right">${t.t}</td><td style="text-align:right">${t.ja}</td><td style="text-align:right">${t.nee}</td><td style="text-align:right">${t.d}</td><td style="text-align:right">${t.o}</td><td style="text-align:right">${t.pct}%</td></tr>`).join('')}
        </tbody></table></div>
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Redenen voor niet-uitvoering (W${cur.week})</div>
        ${redenen.length?`<div class="tw keep-table"><table><thead><tr><th>Reden</th><th style="text-align:right">Aantal</th></tr></thead><tbody>
          ${redenen.map(([rd,n])=>`<tr><td>${esc(rd)}</td><td style="text-align:right">${n}</td></tr>`).join('')}
        </tbody></table></div>`:'<p class="rpt-none">Geen redenen geregistreerd deze week.</p>'}
      </div>

      <div class="wf rpt-sec">
        <div class="sl" style="margin-top:0">Top-risico's in de backlog</div>
        <p class="rpt-none" style="margin-bottom:8px">Hoogste risicoscore eerst — score telt uitlegbare factoren op (weken open, herhaald ingepland, status, ongepland, probleem-installatie).</p>
        ${top.length?`<div class="tw keep-table"><table><thead><tr><th>Score</th><th>Order</th><th>Omschrijving</th><th>Uitvoerende(n)</th><th>Factoren</th></tr></thead><tbody>
          ${top.map(r=>`<tr><td style="font-weight:600;color:${r.risk.kleur}">${r.risk.score} &middot; ${r.risk.level}</td><td style="font-family:monospace;font-size:11px">${esc(r.wo)}</td><td>${esc(r.omschrijving)}</td><td>${esc(r.wie)}</td><td style="font-size:11px;color:#8b949e">${esc(r.risk.factors.map(f=>f.label).join(', '))}</td></tr>`).join('')}
        </tbody></table></div>`:'<p class="rpt-none">Geen openstaande werkorders — de backlog is schoon.</p>'}
      </div>
    </div>`;
  }

  window.openWeekRapport=function(){
    // Zelfde rechtenpoort als de rest van het onderhoud-deel (showPage).
    if(typeof userAccess!=='undefined'&&!userAccess.dashboard){
      if(typeof showGeenToegang==='function') showGeenToegang();
      return;
    }
    const pg=ensurePage();
    if(!pg) return;
    pg.innerHTML=build();
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nt').forEach(t=>t.classList.remove('active'));
    pg.classList.add('active');
    if(typeof window.navigate==='function') window.navigate({page:'rapport'});
    window.scrollTo(0,0);
  };
})();
