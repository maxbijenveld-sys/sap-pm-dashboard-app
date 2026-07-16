// Startpagina — het eerste scherm na inloggen: begroeting, signalen over de
// modules heen en de modulekeuze als kaarten (concept-layout, nu echt).
//
// Onderhoud-cijfers komen live uit de al geladen weekdata; de Financiën-
// kaart toont bewust géén bedragen (RLS geeft die pas vrij na 2FA — de kaart
// is de ingang, niet het lek). PX Trend en SAP PM staan er als aangekondigde
// onderdelen met voorbeeldweergave, gemarkeerd als zodanig.
//
// Klassiek script, zelfde patroon als report.js/palette.js: leunt op de
// globals uit legacy-app.js (weeks, kpis, userAccess, sparkline, esc, …)
// en computeRisk uit js/risk.js.

(function(){
  'use strict';
  const PAGE_ID='pg-home';

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

  function groet(){
    const h=new Date().getHours();
    return h<12?'Goedemorgen':h<18?'Goedemiddag':'Goedenavond';
  }
  // Voornaam: liefst uit het profiel (naam wordt gezet bij het aanmaken van
  // de gebruiker), anders afgeleid uit het e-mailadres (max.bijenveld@ ->
  // Max). Puur cosmetisch; valt stil terug op niets zonder sessie.
  function voornaam(){
    const u=(typeof currentUser!=='undefined'&&currentUser&&currentUser.user)||null;
    const meta=(u&&u.user_metadata)||{};
    const naam=(meta.naam||meta.full_name||'').trim();
    if(naam) return naam.split(/\s+/)[0];
    // E-mail-fallback alleen als het lokale deel een scheidingsteken heeft
    // (max.bijenveld -> Max); aan elkaar geplakte adressen (maxbijenveld)
    // leveren geen bruikbare voornaam op — dan liever geen naam.
    const lokaal=((u&&u.email)||'').split('@')[0];
    if(!/[._-]/.test(lokaal)) return '';
    const deel=lokaal.split(/[._-]/)[0];
    return deel?deel.charAt(0).toUpperCase()+deel.slice(1):'';
  }

  // ── Signalen personaliseren ("Vandaag in één oogopslag") ───────────
  // Zelfde patroon als de finance-KPI-personalisatie (financeDashboard.js:
  // renderKpiConfig) — localStorage, een klein knopje, checkbox-lijst.
  const SIGNAL_STORAGE_KEY='homeSignalSelection';
  // Volledige catalogus (config-paneel); DEFAULT_SIGNAL_IDS is bewust de
  // oorspronkelijke 4 — wie nooit "Configureren" opent, ziet exact hetzelfde
  // als voorheen. De rest is opt-in, want welke signalen relevant zijn
  // verschilt per gebruiker/rol (onderhoud vs. financieel).
  const SIGNAL_ORDER=['uitvoering','risico','lang','rapport','totaalwo','ongepland','terugkerend','refmismatch','ytdactual','overschrijding'];
  const DEFAULT_SIGNAL_IDS=['uitvoering','risico','lang','rapport'];
  const SIGNAL_LABELS={
    uitvoering:{label:'Uitvoering laatste week',sub:'% afgerond, met trend'},
    risico:{label:'Backlog — hoog risico',sub:'aantal WO’s met hoog risico'},
    lang:{label:'≥ 3 weken open',sub:'structurele aandacht nodig'},
    rapport:{label:'Weekrapport',sub:'snelkoppeling naar het rapport'},
    totaalwo:{label:'Totaal WO’s deze week',sub:'gepland + ongepland'},
    ongepland:{label:'Ongepland / storingen deze week',sub:'aantal storingen/spoed'},
    terugkerend:{label:'Terugkerende WO’s',sub:'2+ weken achter elkaar, zonder afronding'},
    refmismatch:{label:'Data-kwaliteit: referentie-mismatches',sub:'ordernummers met wisselende omschrijving'},
    ytdactual:{label:'Financiën — Actual YTD',sub:'actuele kosten dit jaar (na 2FA-ontgrendeling)'},
    overschrijding:{label:'Financiën — budget-overschrijding',sub:'FC t.o.v. jaarbudget (na 2FA-ontgrendeling)'}
  };
  // Bijgewerkt door build() bij elke render: alleen de signalen die dít
  // moment daadwerkelijk data hebben (bv. financiën-signalen pas na 2FA-
  // ontgrendeling) — het configuratiepaneel toont alleen wat bruikbaar is.
  let _availableSignalIds=DEFAULT_SIGNAL_IDS.slice();
  function defaultSignalSelection(){return DEFAULT_SIGNAL_IDS.slice();}
  function loadSignalSelection(){
    try{
      if(typeof localStorage==='undefined') return defaultSignalSelection();
      const raw=localStorage.getItem(SIGNAL_STORAGE_KEY);
      const ids=raw?JSON.parse(raw):null;
      if(Array.isArray(ids)){
        const filtered=ids.filter(id=>SIGNAL_LABELS[id]);
        if(filtered.length) return filtered;
      }
    }catch(e){}
    return defaultSignalSelection();
  }
  function saveSignalSelection(ids){
    try{
      if(typeof localStorage==='undefined') return;
      const filtered=(ids||[]).filter(id=>SIGNAL_LABELS[id]);
      localStorage.setItem(SIGNAL_STORAGE_KEY,JSON.stringify(filtered.length?filtered:defaultSignalSelection()));
    }catch(e){}
  }
  window.__homeToggleSignalConfig=function(){
    const panel=document.getElementById('homeSignalConfigPanel');
    if(!panel) return;
    const show=panel.style.display==='none';
    panel.style.display=show?'block':'none';
    if(show){
      const selected=loadSignalSelection();
      // Alleen wat dít moment beschikbaar is (zie build()) — een gebruiker
      // zonder Financiën-toegang, of die nog niet ontgrendeld heeft, krijgt
      // dus geen financiën-checkboxen te zien die toch niets zouden tonen.
      panel.innerHTML=`<div class="hm-sc-list">${_availableSignalIds.map(id=>{
        const def=SIGNAL_LABELS[id];
        return `<label class="hm-sc-row"><input type="checkbox" data-sc-id="${id}"${selected.includes(id)?' checked':''}><span><span class="hm-sc-l">${def.label}</span><span class="hm-sc-s">${def.sub}</span></span></label>`;
      }).join('')}</div>
      <div class="hm-sc-actions">
        <button type="button" class="hm-sc-save" onclick="__homeSaveSignalConfig()">Opslaan</button>
        <button type="button" class="hm-sc-cancel" onclick="__homeToggleSignalConfig()">Annuleren</button>
      </div>`;
    }
  };
  window.__homeSaveSignalConfig=function(){
    const panel=document.getElementById('homeSignalConfigPanel');
    if(!panel) return;
    const ids=Array.from(panel.querySelectorAll('[data-sc-id]')).filter(i=>i.checked).map(i=>i.dataset.scId);
    saveSignalSelection(ids);
    panel.style.display='none';
    if(typeof window.renderHome==='function') window.renderHome();
  };

  // Deep-link vanuit de Onderhoud-kaart: dashboard met de weekfilter alvast
  // op die week, of direct door naar de KPI-detailpagina van die week.
  window.__homeOpenWeekDash=function(wid){
    showPage('dashboard');
    const s=document.getElementById('fWeek');
    if(s){ s.value=wid; renderDash(); }
  };
  window.__homeOpenKpi=function(wid,kind){
    window.__homeOpenWeekDash(wid);
    openKpiDetail(kind);
  };

  const IC={
    wrench:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z"/></svg>',
    euro:'<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    pulse:'<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 14 7 14 9 6 13 19 15 11 17 14 21 14"/></svg>',
    db:'<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>'
  };

  // Signaalkaartje: label + groot cijfer + sparkline + subregel.
  function sig(accent,label,value,sub,spark,sparkColor,clickJs){
    const sp=(spark&&spark.length>1&&typeof sparkline==='function')?sparkline(spark,sparkColor):'';
    const click=clickJs?` role="button" tabindex="0" onclick="${clickJs}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${clickJs}}" style="cursor:pointer"`:'';
    return `<div class="hm-sig" style="--sig:${accent}"${click}>
      <div class="hm-sig-l">${label}</div>
      <div class="hm-sig-row"><div class="hm-sig-v">${value}</div>${sp}</div>
      <div class="hm-sig-s">${sub}</div>
    </div>`;
  }

  function modCard(opts){
    const {accent,icon,titel,desc,badge,badgeCls,body,cta,meta,clickJs}=opts;
    const click=clickJs?` role="link" tabindex="0" onclick="${clickJs}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${clickJs}}"`:'';
    // Diagonale "Beta"-lint over de hoek van nog-niet-live kaarten (PX Trend/
    // SAP PM) — puur een statusmarkering, verbergt geen inhoud (de illustratieve
    // voorbeelden eronder moeten juist wél goed leesbaar blijven).
    const beta=clickJs?'':'<span class="hm-beta-ribbon" aria-hidden="true">Beta</span>';
    return `<div class="hm-mod${clickJs?'':' hm-soon'}" style="--mc:${accent}"${click}>
      ${beta}
      <div class="hm-mod-head">
        <div class="hm-mod-id">
          <div class="hm-mod-ic">${icon}</div>
          <div><h2>${titel}</h2><div class="hm-desc">${desc}</div></div>
        </div>
        <span class="hm-badge ${badgeCls}">${badge}</span>
      </div>
      ${body||''}
      <div class="hm-mod-foot"><span class="hm-cta">${cta}</span><span class="hm-meta">${meta||''}</span></div>
    </div>`;
  }

  // clickJs optioneel: maakt het mini-blok een eigen deep-link. stopPropagation
  // voorkomt dat óók de omliggende modulekaart zijn eigen klik afvuurt.
  function mk(l,v,s,color,clickJs){
    const click=clickJs?` role="button" tabindex="0" onclick="event.stopPropagation();${clickJs}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();${clickJs}}"`:'';
    return `<div class="hm-mk${clickJs?' hm-mk-click':''}"${click}><div class="hm-mk-l">${l}</div><div class="hm-mk-v"${color?` style="color:${color}"`:''}>${v}</div><div class="hm-mk-s">${s}</div></div>`;
  }

  function build(){
    const magDash=typeof userAccess!=='undefined'&&userAccess.dashboard;
    const magFin=(typeof isAdmin!=='undefined'&&isAdmin)||(typeof userAccess!=='undefined'&&!!userAccess.finance);
    const wks=(magDash&&typeof weeks!=='undefined'?weeks:[]).slice().sort((a,b)=>a.week-b.week);
    const cur=wks.length?wks[wks.length-1]:null;
    const naam=voornaam();
    const vandaag=new Date().toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    // Kalenderweek van vandaag (niet de week van de laatste data — die kan
    // achterlopen en staat al bij de signalen en op de Onderhoud-kaart).
    const wkNu=typeof isoWeekOf==='function'?isoWeekOf(new Date()).week:(cur?cur.week:'');

    // ── Signalen ("Vandaag in één oogopslag") ──────────────────────────
    // Los van elkaar: onderhoud-signalen (nodig: cur/weekdata) en
    // financiën-signalen (nodig: Financiën-toegang + al ontgrendeld deze
    // sessie) — een finance-only gebruiker krijgt dus ook een strook,
    // zonder onderhoud-cijfers, en andersom.
    let signals='';
    const signalHtml={};
    if(cur){
      const k=kpis(cur.rows);
      const prev=wks.length>1?kpis(wks[wks.length-2].rows):null;
      const delta=prev?k.pct-prev.pct:null;
      const pctSpark=wks.slice(-6).map(w=>{const r=w.rows;return r.length?Math.round(r.filter(x=>x.status==='ja').length/r.length*100):0;});
      const deltaTxt=delta==null?'&nbsp;':delta===0?'gelijk aan vorige week'
        :`<b class="${delta>0?'hm-up':'hm-down'}">${delta>0?'&#9650;':'&#9660;'} ${Math.abs(delta)}pp</b> t.o.v. W${wks[wks.length-2].week}`;

      const {byOrder}=groupRowsByOrder();
      const probSet=typeof probleemInstallatieSet==='function'?probleemInstallatieSet():new Set();
      let open=0,hoog=0,lang=0,terugkerend=0,refmismatch=0;
      Object.values(byOrder).forEach(entries=>{
        // Terugkerend/referentie-mismatch tellen over ALLE orders (ook
        // afgeronde) — zelfde definitie als de Backlog-KPI "Terugkerend".
        if(entries.length>1) terugkerend++;
        if(typeof findOrderReferenceMismatch==='function'&&findOrderReferenceMismatch(entries)) refmismatch++;
        const r=computeRisk(entries,probSet);
        if(!r) return;
        open++;
        if(r.level==='hoog') hoog++;
        const first=entries[0],last=entries[entries.length-1];
        if((last._week-first._week+1)>=3) lang++;
      });

      signalHtml.uitvoering=sig('var(--color-primary)',`Uitvoering W${cur.week}`,k.pct+'%',deltaTxt,pctSpark,'#3fb950',"showPage('dashboard')");
      signalHtml.risico=sig('var(--color-danger-strong)','Backlog — hoog risico',hoog,`van ${open} open werkorders`,null,null,"openBacklogFiltered('risico')");
      signalHtml.lang=sig('var(--color-warning)','&#8805; 3 weken open',lang,'structurele aandacht nodig',null,null,"openBacklogFiltered('long')");
      signalHtml.rapport=sig('var(--color-info)','Weekrapport','W'+cur.week,'managementrapport — printbaar',null,null,'openWeekRapport()');
      signalHtml.totaalwo=sig('var(--color-text-secondary)',`Totaal WO's W${cur.week}`,k.t,`${k.g} gepland &middot; ${k.o} ongepland`,null,null,"showPage('dashboard')");
      signalHtml.ongepland=sig('var(--color-warning)','Ongepland / storingen',k.o,`deze week (W${cur.week})`,null,null,"showPage('dashboard')");
      signalHtml.terugkerend=sig('var(--color-warning)','Terugkerende WO&rsquo;s',terugkerend,'2+ weken achter elkaar',null,null,"openBacklogFiltered('all')");
      signalHtml.refmismatch=sig('var(--color-danger-strong)','Data-kwaliteit',refmismatch,refmismatch===1?'ordernummer met wisselende omschrijving':'ordernummers met wisselende omschrijving',null,null,"openBacklogFiltered('all')");
    }
    // Financiën-signalen: alleen als de gebruiker toegang heeft én in deze
    // sessie al ontgrendeld is (2FA) — anders is er geen bedrag om te
    // tonen (zelfde bron als de Financiën-kaart hieronder, zie __financeSummary).
    const finSummary=magFin&&typeof window.__financeSummary==='function'?window.__financeSummary():null;
    if(finSummary){
      const f=finSummary.fmt||(v=>'€ '+Math.round(v).toLocaleString('nl-NL'));
      signalHtml.ytdactual=sig('var(--color-primary-deep)','Financiën — Actual YTD',f(finSummary.actual),finSummary.maand?`t/m ${finSummary.maand}`:'',null,null,"window.__showFinance&&window.__showFinance()");
      if(finSummary.fc!=null&&finSummary.op!=null){
        const diff=finSummary.fc-finSummary.op;
        const pct=finSummary.op?Math.round(diff/finSummary.op*100):0;
        signalHtml.overschrijding=sig(diff>0?'var(--color-warning)':'var(--color-success)','Budget-overschrijding (jaareinde)',f(Math.abs(diff)),diff>0?`verwacht ${pct>0?'+':''}${pct}% boven budget`:'verwacht binnen budget',null,null,"window.__showFinance&&window.__showFinance()");
      }
    }

    _availableSignalIds=SIGNAL_ORDER.filter(id=>signalHtml[id]);
    if(_availableSignalIds.length){
      const gekozen=loadSignalSelection().filter(id=>signalHtml[id]);
      const tonen=gekozen.length?gekozen:_availableSignalIds.filter(id=>DEFAULT_SIGNAL_IDS.includes(id));
      const tonenFinal=tonen.length?tonen:_availableSignalIds;
      signals=`
      <div class="hm-strip-label">Vandaag in &eacute;&eacute;n oogopslag<button type="button" class="hm-config-btn" onclick="__homeToggleSignalConfig()" title="Kies welke signalen hier staan">Configureren</button></div>
      <div id="homeSignalConfigPanel" class="hm-sc-panel" style="display:none"></div>
      <div class="hm-signals">
        ${tonenFinal.map(id=>signalHtml[id]).join('')}
      </div>`;
    }

    // ── Modulekaarten ──────────────────────────────────────────────────
    const cards=[];
    if(magDash){
      let body='';
      if(cur){
        const k=kpis(cur.rows);
        const {byOrder}=groupRowsByOrder();
        const probSet=typeof probleemInstallatieSet==='function'?probleemInstallatieSet():new Set();
        let hoog=0;
        Object.values(byOrder).forEach(e=>{const r=computeRisk(e,probSet);if(r&&r.level==='hoog')hoog++;});
        body=`<div class="hm-mod-kpis">
          ${mk('Deze week',k.t+' WO’s',`${k.g} gepland &middot; ${k.o} ongepland`,null,`__homeOpenWeekDash('${cur.id}')`)}
          ${mk('Afgerond',k.pct+'%',`${k.ja} van ${k.t}`,'#3fb950',`__homeOpenKpi('${cur.id}','afgerond')`)}
          ${mk('Hoog risico',hoog,'in de backlog',hoog>0?'#f85149':null,"openBacklogFiltered('risico')")}
        </div>`;
      }
      cards.push(modCard({accent:'var(--color-primary)',icon:IC.wrench,titel:'Onderhoud',
        desc:'Weekplanning, backlog met risicoscore, analyse en weekrapport',
        badge:'Actief',badgeCls:'hm-b-live',body,cta:'Openen &rsaquo;',
        meta:cur?`laatste week: W${cur.week}`:'',clickJs:"showPage('dashboard')"}));
    }
    if(magFin){
      // Na de 2FA-ontgrendeling (in deze sessie) heeft de financiënmodule
      // zijn data gecachet en levert __financeSummary de kerncijfers —
      // dan toont de kaart bedragen. Daarvóór: alleen de uitnodiging.
      // (finSummary is hierboven al berekend voor de signalenstrook —
      // hergebruikt i.p.v. window.__financeSummary() nogmaals aan te roepen.)
      const fs=finSummary;
      let finBody,finMeta;
      if(fs){
        const f=fs.fmt||(v=>'€ '+Math.round(v).toLocaleString('nl-NL'));
        const maand=fs.maand||(fs.periode?'P'+fs.periode:'');
        finBody=`<div class="hm-mod-kpis">
          ${mk('Actual YTD',f(fs.actual),maand?`t/m ${maand}`:'')}
          ${mk('Budget (OP)',fs.op!=null?f(fs.op):'—','jaar')}
          ${mk('Forecast (FC)',fs.fc!=null?f(fs.fc):'—','jaareinde',fs.fc!=null&&fs.op!=null&&fs.fc>fs.op?'#d29922':null)}
        </div>`;
        finMeta=`ontgrendeld &middot; ${esc(fs.plant)}${fs.jaar?' '+fs.jaar:''}`;
      } else {
        finBody=`<div class="hm-note">Bedragen verschijnen hier zodra je Financi&euml;n in deze sessie hebt ontgrendeld (2FA).</div>`;
        finMeta='IJmuiden &amp; Rotterdam';
      }
      cards.push(modCard({accent:'var(--color-primary-deep)',icon:IC.euro,titel:'Financi&euml;n',
        desc:'Onderhoudskosten, budget, forecast en RBM-projecten per plant',
        badge:'Actief &middot; 2FA',badgeCls:'hm-b-2fa',
        body:finBody,cta:fs?'Openen &rsaquo;':'Ontgrendelen &amp; openen &rsaquo;',meta:finMeta,
        clickJs:"window.__showFinance&&window.__showFinance()"}));
    }
    // Aangekondigde onderdelen: bewust zichtbaar voor iedereen — dit is de
    // roadmap van het platform, gemarkeerd als concept/voorbeeld.
    cards.push(modCard({accent:'var(--color-info)',icon:IC.pulse,titel:'PX Trend — conditie',
      desc:'Dagelijkse meetdata per installatie: temperatuur, trilling, stroom — met vroegsignalering',
      badge:'In ontwikkeling',badgeCls:'hm-b-dev',
      body:`<div class="hm-note"><span class="hm-dot" style="background:var(--color-warning)"></span>Voorbeeld: <strong>KM802 lagertemperatuur</strong> drijft 14 dagen weg van het normaalbeeld (+6&deg;C) — signaal v&oacute;&oacute;r de storing, niet erna. <em>(voorbeelddata)</em></div>`,
      cta:'Volgt — wacht op eerste extract',meta:'voorbeeldweergave'}));
    // Concrete voorbeelden i.p.v. abstracte KPI-labels: dit is de kaart die
    // laat zien wát de SAP-koppeling oplevert, niet alleen dát hij gepland
    // is — bedoeld om 1-op-1 te tonen ("dit kan ermee") i.p.v. een cijfer
    // dat als al-gemeten kan overkomen (was: "0 min/wk").
    cards.push(modCard({accent:'var(--color-warning)',icon:IC.db,titel:'SAP PM — werkorders &amp; meldingen',
      desc:'Dagelijks automatisch extract: echte datums, ordersoorten en storingsmeldingen per installatie',
      badge:'In ontwikkeling',badgeCls:'hm-b-dev',
      body:`<div class="hm-note">
        <div style="margin-bottom:8px"><strong>Wat dit oplevert</strong> — voorbeelden met illustratieve cijfers:</div>
        <div class="hm-ex-row"><span class="hm-dot" style="background:var(--color-danger)"></span>&ldquo;KM802 had de afgelopen 90 dagen 6 storingsmeldingen &mdash; 3&times; vaker dan gemiddeld.&rdquo; <em>(storingsfrequentie / MTBF per installatie)</em></div>
        <div class="hm-ex-row"><span class="hm-dot" style="background:var(--color-warning)"></span>&ldquo;Gemiddeld 4,2 dagen tussen melding en afgeronde reparatie.&rdquo; <em>(MTTR &mdash; nu niet meetbaar)</em></div>
        <div class="hm-ex-row"><span class="hm-dot" style="background:var(--color-info)"></span>&ldquo;WO 11886093 staat 34 dagen open&rdquo; i.p.v. de huidige afronding op hele weken. <em>(exacte aging in dagen)</em></div>
      </div>`,
      cta:'In ontwikkeling — wacht op voorbeeld-extract',meta:'automatische aanlevering &middot; illustratieve cijfers'}));

    return `
    <div class="hm-hello">
      <div>
        <div class="hm-h1">${groet()}${naam?', '+esc(naam):''}</div>
        <div class="hm-sub">${esc(vandaag)}${wkNu?` &middot; week ${wkNu}`:''}</div>
      </div>
    </div>
    ${signals}
    <div class="hm-strip-label">Kies een onderdeel</div>
    <div class="hm-mods">${cards.join('')}</div>`;
  }

  function renderHome(){
    const pg=ensurePage();
    if(pg) pg.innerHTML=build();
  }
  window.renderHome=renderHome;
})();
