// PX Trend — Early Warning & Condition Monitoring-scherm.
//
// Bouwt op de echte data uit js/pxtrend-catalogus.js (27 functieplaatsen,
// 270 installaties, 860 tags) en js/pxtrend-metingen.js (echte uurmetingen
// EL2310 2017-2025, BU4930 2024). Zie docs/PX_TREND_MODULE_PLAN.md §7-§8
// voor de volledige analyse en de bewuste keuzes hierin.
//
// KERNBEPERKING (bewust niet verdoezeld): van de 270 installaties heeft er
// precies 1 een volwaardige, op metingen gebaseerde status (EL2310), 1
// gedeeltelijke data zonder genoeg context voor een oordeel (BU4930), en 268
// alleen een tagnaam zonder ooit gemeten waarde. Die 268(+BU4930) krijgen
// status "onvoldoende" (⚪) — geen geëxtrapoleerde of verzonnen status.
//
// Statustaxonomie (5 niveaus, zoals gespecificeerd):
//   🟢 normaal        — binnen 1 SD van de eigen historische belasting
//   🟡 monitoren       — 1-2 SD afwijking, licht/beginnend
//   🟠 onderzoeken     — 2-3 SD afwijking, duidelijk
//   🔴 actie vereist   — >3 SD, of een lopende, nog niet als seizoenspatroon
//                        herkende stilstand ≥150u
//   ⚪ onvoldoende data — geen (genoeg) PX Trend-historie gekoppeld
//
// Methode voor EL2310 (enige installatie met een volwaardig oordeel):
// "Draaiend" = EL2310_JI > 1,0A. De ingestelde DCS-grens EL2310_JW (24,998A)
// functioneert NIET als bruikbaar alarm (8,7% van de bedrijfsuren erboven,
// zonder gevolg) — dus niet gebruikt. Stilstand-episodes ≥150u worden
// onderling vergeleken op dag-in-het-jaar (±17 dagen, binnen dezelfde
// groottecategorie): komt eenzelfde stop in ≥2 andere jaren rond dezelfde
// tijd voor, dan is het bekend onderhoud (kerst/zomer), anders een
// afwijking. Vindt op deze reeks precies 2 afwijkingen tussen 18 grote
// stops (beide najaar 2024).
//
// "Mogelijke oorzaak" (sectie 7 van de spec) vereist meerdere échte
// tijdreeksen per installatie — die heeft nu geen enkele installatie (EL2310
// heeft alleen stroom, BU4930 alleen niveau). Op expliciet verzoek daarom
// gebouwd als duidelijk gelabelde voorbeelddemo op WP3610 (rollerpers, wél
// een echt equipment in de catalogus), met de illustratieve tags uit
// js/pxtrend.js (window.PX_TAGS_VOORBEELD) — telt NIET mee in de echte
// status-tellingen.
(function(){
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtNl(n,dec){ return (dec==null?n:Number(n).toFixed(dec)).toString().replace('.',','); }
  function hourDate(epochIso,uur){ return new Date(new Date(epochIso).getTime()+uur*3600000); }
  function fmtDatum(d){ return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'}); }
  function fmtDatumTijd(d){ return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}); }
  function mondayOf(d){
    const dt=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
    const day=dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate()+(day===0?-6:1-day));
    return dt;
  }
  function weekKey(d){ return mondayOf(d).toISOString().slice(0,10); }
  function overlaps(aStart,aEnd,bStart,bEnd){ return aStart<=bEnd && bStart<=aEnd; }
  function mean(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }

  const STATUS_LABEL={normaal:'Normaal',monitoren:'Monitoren',onderzoeken:'Onderzoeken',actie:'Actie vereist',onvoldoende:'Onvoldoende data'};
  const STATUS_EMOJI={normaal:'\u{1F7E2}',monitoren:'\u{1F7E1}',onderzoeken:'\u{1F7E0}',actie:'\u{1F534}',onvoldoende:'⚪'};
  const STATUS_CLS={normaal:'bja',monitoren:'buc',onderzoeken:'bdeels',actie:'bnee',onvoldoende:'bgrijs'};
  const STATUS_COLOR={normaal:'var(--color-success)',monitoren:'var(--color-info)',onderzoeken:'var(--color-warning)',actie:'var(--color-danger)',onvoldoende:'var(--color-text-secondary)'};
  const STATUS_ORDER=['actie','onderzoeken','monitoren','normaal','onvoldoende'];
  function classifyZ(absZ){ if(absZ>=3) return 'actie'; if(absZ>=2) return 'onderzoeken'; if(absZ>=1) return 'monitoren'; return 'normaal'; }

  // ── Procesgebieden: groepeert de 27 functieplaatsen naar de fysieke
  // procesvolgorde (grondstof -> drogerij -> malerij -> cementtransport ->
  // verlading), zodat de PX Trend-trechter niet in één keer 27 tegels toont.
  // Vaste indeling (niet uit de catalogus af te leiden — dat kent alleen losse
  // functieplaatscodes), daarom hier hardcoded en bij init tegen de echte
  // catalogus gevalideerd (zie assertAreaDekking hieronder).
  const AREA_DEFINITIONS=[
    {id:'algemeen',naam:'Algemeen / hulpsystemen',fps:['09','11']},
    {id:'grondstof',naam:'Grondstoffentransport',fps:['20','22','23','24','26','27','28']},
    {id:'drogerij',naam:'Drogerij',fps:['30','31','32','33','34','35','36']},
    {id:'malerij',naam:'Malerij',fps:['44','45','46','47','48','49']},
    {id:'cement',naam:'Cementtransport',fps:['51','52','53']},
    {id:'verlading',naam:'Verlading',fps:['62','63']}
  ];
  function gebiedVanFp(fpCode){ return AREA_DEFINITIONS.find(g=>g.fps.includes(fpCode))||null; }
  function assertAreaDekking(){
    const fpCodes=functieplaatsen().map(f=>f.code);
    const gedekt=new Set(AREA_DEFINITIONS.flatMap(g=>g.fps));
    const gemist=fpCodes.filter(c=>!gedekt.has(c));
    if(gemist.length) console.warn('PX Trend: functieplaats(en) zonder procesgebied — worden nergens getoond in de nav:',gemist);
  }

  function functieplaatsen(){ return (typeof window.PX_FUNCTIEPLAATSEN!=='undefined')?window.PX_FUNCTIEPLAATSEN:[]; }
  function tagCatalogus(){ return (typeof window.PX_TAG_CATALOGUS!=='undefined')?window.PX_TAG_CATALOGUS:[]; }
  function voorbeeldTags(){ return (typeof window.PX_TAGS_VOORBEELD!=='undefined')?window.PX_TAGS_VOORBEELD:[]; }

  // ── EL2310: kernanalyse (enige installatie met een volwaardig oordeel) ──
  function analyseEL2310(){
    const d=window.PX_METINGEN&&window.PX_METINGEN.EL2310;
    if(!d||!d.reeks||!d.reeks.length) return null;
    const epoch=d.epoch, reeks=d.reeks;
    const laatste=reeks[reeks.length-1];
    const laatsteDatum=hourDate(epoch,laatste[0]);

    let episodes=[]; let cur=null;
    reeks.forEach(([uur,ji])=>{
      const stopped=(ji===null||ji<=1.0);
      if(stopped){ if(!cur) cur={startUur:uur,endUur:uur,uren:0}; cur.endUur=uur; cur.uren++; }
      else { if(cur){ episodes.push(cur); cur=null; } }
    });
    if(cur) episodes.push(cur);

    function doy(date){ const start=Date.UTC(date.getUTCFullYear(),0,1); return Math.floor((date.getTime()-start)/86400000); }
    function doyDist(a,b){ const dd=Math.abs(a-b); return Math.min(dd,365-dd); }
    const MIN_GROOT=150;
    const groot=episodes.filter(e=>e.uren>=MIN_GROOT).map(e=>{
      const start=hourDate(epoch,e.startUur), end=hourDate(epoch,e.endUur);
      return Object.assign({},e,{start,end,doy:doy(start),jaar:start.getUTCFullYear()});
    });
    groot.forEach(e=>{
      const anderejaren=new Set(groot.filter(o=>o!==e&&doyDist(o.doy,e.doy)<=17).map(o=>o.jaar));
      e.terugkerend=anderejaren.size>=2;
    });
    const afwijkendeStops=groot.filter(e=>!e.terugkerend).sort((a,b)=>b.start-a.start);
    const seizoensStops=groot.filter(e=>e.terugkerend);

    const cutoffUur=laatste[0]-30*24;
    const runningVals=reeks.filter(([u,ji])=>ji!==null&&ji>1.0);
    const baseline=runningVals.filter(([u])=>u<cutoffUur).map(([u,ji])=>ji);
    const recent=runningVals.filter(([u])=>u>=cutoffUur).map(([u,ji])=>ji);
    function meanSd(arr){ if(!arr.length) return {m:0,sd:0,n:0}; const m=mean(arr); const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length)||0.001; return {m,sd,n:arr.length}; }
    const base=meanSd(baseline), rec=meanSd(recent);
    const z=(rec.n>10)?(rec.m-base.m)/base.sd:0;

    const laatsteEpisode=episodes[episodes.length-1];
    const laatsteIsStop=laatsteEpisode&&laatsteEpisode.endUur===laatste[0];
    let status, statusReden;
    if(laatsteIsStop&&laatsteEpisode.uren>=MIN_GROOT){
      status='actie';
      statusReden=`Langdurige stilstand is nog bezig (al ${laatsteEpisode.uren}u) en kan nog niet als bekend onderhoudspatroon herkend worden.`;
    } else {
      status=classifyZ(Math.abs(z));
      statusReden=status==='normaal'
        ?'Belasting en bedrijfspatroon vallen binnen de eigen historische bandbreedte (<1 SD).'
        :`Belasting laatste 30 dagen wijkt ${fmtNl(z,1)} SD af van de eigen historie.`;
    }

    return {epoch,reeks,laatsteDatum,episodes,groot,afwijkendeStops,seizoensStops,base,rec,z,status,statusReden,jw:d.jw,o:d.o};
  }

  // ── EL2310: status per periode (dag/week), over de hele historie ───────
  // Vereenvoudiging t.o.v. een "echte" voortschrijdende baseline: gebruikt
  // dezelfde vaste baseline (mean/sd over de hele niet-recente historie) voor
  // elke periode i.p.v. een steeds bijgewerkte venster — verdedigbaar omdat
  // er geen meerjarige drift in de data zit (zie
  // docs/PX_TREND_MODULE_PLAN.md §7: gem. stroom-tijdens-bedrijf blijft
  // 15-19A over alle 9 jaar). Gedeeld door dag- en weekrapport
  // (js/pxtrend-rapport.js) via de granularity-parameter.
  function dagKey(d){ return d.toISOString().slice(0,10); }
  function historieDoorPeriode(el,granularity){
    if(!el) return [];
    const keyFn=granularity==='dag'?d=>dagKey(d):d=>weekKey(d);
    const periodes={};
    el.reeks.forEach(([uur,ji])=>{
      const d=hourDate(el.epoch,uur);
      const k=keyFn(d);
      if(!periodes[k]) periodes[k]={key:k,start:d,end:d,jis:[]};
      if(d<periodes[k].start) periodes[k].start=d;
      if(d>periodes[k].end) periodes[k].end=d;
      if(ji!==null) periodes[k].jis.push(ji);
    });
    return Object.keys(periodes).sort().map(k=>{
      const w=periodes[k];
      const runningJis=w.jis.filter(v=>v>1.0);
      const minDraaiuren=granularity==='dag'?1:5;
      const inAfwijkend=el.afwijkendeStops.some(ep=>overlaps(ep.start,ep.end,w.start,w.end));
      const inSeizoen=!inAfwijkend&&el.seizoensStops.some(ep=>overlaps(ep.start,ep.end,w.start,w.end));
      let status;
      if(inAfwijkend) status='actie';
      else if(runningJis.length>minDraaiuren){ status=classifyZ(Math.abs((mean(runningJis)-el.base.m)/el.base.sd)); }
      else status='normaal';
      return {key:k,start:w.start,end:w.end,status,inSeizoen,draaiuren:runningJis.length};
    });
  }
  function historieWekelijks(el){ return historieDoorPeriode(el,'week'); }
  function historieDagelijks(el){ return historieDoorPeriode(el,'dag'); }

  // ── BU4930: onvoldoende context voor een oordeel ────────────────────────
  function analyseBU4930(){
    const d=window.PX_METINGEN&&window.PX_METINGEN.BU4930;
    if(!d||!d.reeks||!d.reeks.length) return null;
    const epoch=d.epoch, reeks=d.reeks;
    const levels=reeks.filter(([u,lv])=>lv!==null);
    const laatste=reeks[reeks.length-1];
    const laatsteDatum=hourDate(epoch,laatste[0]);
    const vals=levels.map(([u,lv])=>lv);
    const min=Math.min(...vals), max=Math.max(...vals);
    const gem=mean(vals);
    let deltas=[];
    for(let i=1;i<levels.length;i++){
      if(levels[i][0]-levels[i-1][0]===1) deltas.push(levels[i][1]-levels[i-1][1]);
    }
    const meanAbsDelta=mean(deltas.map(Math.abs));
    return {epoch,reeks,laatsteDatum,min,max,mean:gem,meanAbsDelta,n:vals.length,eersteD:hourDate(epoch,levels[0][0])};
  }

  // ── Prioriteit: ernst × duur × trend (impact bewust weggelaten, zie §8) ──
  function prioriteitScore(status,duurUren,verergerend){
    const severityWeight={actie:4,onderzoeken:2,monitoren:1,normaal:0,onvoldoende:0}[status]||0;
    if(!severityWeight) return 0;
    const duurFactor=Math.min(2,(duurUren||0)/72);
    const trendFactor=verergerend?0.5:0;
    return +(severityWeight*(1+duurFactor)*(1+trendFactor)).toFixed(2);
  }

  // ── Unified installation health: alle 270 installaties uit de catalogus,
  // plus eventuele installaties die wél echte PX Trend-data hebben maar nog
  // niet in de SAP-catalogus voorkomen (bv. RP312030 — transparant
  // gemarkeerd, niet verzwegen). ────────────────────────────────────────
  //
  // Databron: window.PX_INSTALLATIES / window.PX_TAGREEKSEN, gegenereerd
  // door scripts/px-ingest.js uit de generieke engine (js/pxtrend-engine.js)
  // — GEEN installatiespecifieke code hier meer, op EL2310/BU4930 na. Die
  // twee behouden hun eigen, verfijndere analyse (stilstand-episodes +
  // seizoenspatroonherkenning, zie analyseEL2310 hierboven) omdat dat
  // inhoudelijk meer is dan generieke baseline/afwijking en al gevalideerd
  // is voor de presentatie — een bewuste, beperkte uitzondering (zie
  // scripts/px-ingest.js voor de afweging), niet de manier waarop de
  // overige installaties werken.
  function genData(){ return (typeof window!=='undefined'&&window.PX_INSTALLATIES)||{}; }
  function buildInstallationHealth(){
    const fps=functieplaatsen();
    const el=analyseEL2310();
    const bu=analyseBU4930();
    const gen=genData();
    const records=[];
    const geziene=new Set();
    fps.forEach(fp=>{
      (fp.equipments||[]).forEach(code=>{
        geziene.add(code);
        const rec={
          code, functieplaats:fp.code, functieplaatsNaam:fp.naam,
          status:'onvoldoende', statusReden:'Geen PX Trend-meethistorie gekoppeld aan deze installatie.',
          hasData:false, laatsteMeting:null, prioriteit:0,
          tags:tagCatalogus().filter(t=>t.installatie===code),
          voorbeeldOorzaak: code==='WP3610'&&!gen[code]
        };
        if(code==='EL2310'&&el){
          const duurUren=(el.status==='actie'&&el.episodes.length&&el.episodes[el.episodes.length-1].endUur===el.reeks[el.reeks.length-1][0])?el.episodes[el.episodes.length-1].uren:0;
          Object.assign(rec,{status:el.status,statusReden:el.statusReden,hasData:true,laatsteMeting:el.laatsteDatum,
            prioriteit:prioriteitScore(el.status,duurUren,false),_analyse:el});
        } else if(code==='BU4930'&&bu){
          Object.assign(rec,{status:'onvoldoende',
            statusReden:'Alleen vulniveau beschikbaar (geen afvoer-/klepdebiet) — onvoldoende context voor een betrouwbaar oordeel.',
            hasData:true,laatsteMeting:bu.laatsteDatum,_analyse:bu});
        } else if(gen[code]){
          Object.assign(rec,{status:gen[code].status,statusReden:gen[code].statusReden,hasData:true,
            prioriteit:gen[code].prioriteit,_generiek:gen[code]});
        }
        records.push(rec);
      });
    });
    // Installaties die de engine wél kent maar de catalogus niet.
    Object.keys(gen).forEach(code=>{
      if(geziene.has(code)) return;
      records.push({
        code, functieplaats:null, functieplaatsNaam:null,
        status:gen[code].status,
        statusReden:gen[code].statusReden+' (niet in de SAP-functieplaatscatalogus — nieuw of nog niet gekoppeld equipment)',
        hasData:true, laatsteMeting:null, prioriteit:gen[code].prioriteit,
        tags:[], voorbeeldOorzaak:false, _generiek:gen[code], nietInCatalogus:true
      });
    });
    return records;
  }

  // ── Grafieken ────────────────────────────────────────────────────────────
  function aggregateDaily(reeks,epoch,fromUur){
    const byDay={};
    reeks.forEach(([uur,val])=>{
      if(val===null) return;
      if(fromUur!=null&&uur<fromUur) return;
      const dagKey=Math.floor(uur/24);
      byDay[dagKey]=byDay[dagKey]||[];
      byDay[dagKey].push(val);
    });
    return Object.keys(byDay).map(Number).sort((a,b)=>a-b).map(dagKey=>{
      const arr=byDay[dagKey];
      return {datum:hourDate(epoch,dagKey*24),mean:mean(arr)};
    });
  }

  let _charts={};
  const RANGE_UREN={'24u':24,'7d':7*24,'30d':30*24};
  const RANGE_LABEL={'24u':'24 uur','7d':'7 dagen','30d':'30 dagen','1j':'1 jaar','alles':'Alles'};

  function renderTijdreeksChart(canvasId,range,epoch,reeks,label,kleur,eenheid){
    const canvas=document.getElementById(canvasId);
    if(!canvas||typeof Chart==='undefined') return;
    const laatsteUur=reeks[reeks.length-1][0];
    let labels,data;
    if(RANGE_UREN[range]){
      const fromUur=laatsteUur-RANGE_UREN[range];
      const ruw=reeks.filter(([u])=>u>=fromUur);
      labels=ruw.map(([u])=>{
        const dd=hourDate(epoch,u);
        return range==='24u'?dd.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}):dd.toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
      });
      data=ruw.map(([u,v])=>v);
    } else {
      const fromUur=range==='1j'?laatsteUur-365*24:null;
      const daily=aggregateDaily(reeks,epoch,fromUur);
      labels=daily.map(r=>r.datum.toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:range==='alles'?'2-digit':undefined}));
      data=daily.map(r=>r.mean);
    }
    if(_charts[canvasId]) _charts[canvasId].destroy();
    const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
    _charts[canvasId]=new Chart(canvas,{type:'line',data:{labels,datasets:[
      {label:`${label} (${eenheid})`,data,borderColor:kleur,backgroundColor:kleur,
        pointRadius:RANGE_UREN[range]?1:0,pointHoverRadius:3,borderWidth:1.4,tension:0.15}
    ]},options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{color:tickColor,font:{size:11},boxWidth:14}},
        tooltip:typeof externalTooltipHandler==='function'?{enabled:false,external:externalTooltipHandler}:{enabled:true}},
      scales:{x:{grid:{display:false},ticks:{color:tickColor,font:{size:10},maxTicksLimit:12}},
        y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:11}}}}}});
  }

  function renderOorzaakChart(canvasId,tagsPaar){
    const canvas=document.getElementById(canvasId);
    if(!canvas||typeof Chart==='undefined') return;
    if(_charts[canvasId]) _charts[canvasId].destroy();
    const labels=tagsPaar[0].reeks.map((_,i)=>`dag ${i-(tagsPaar[0].reeks.length-1)}`);
    const kleuren=['#f85149','#388bfd'];
    const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
    _charts[canvasId]=new Chart(canvas,{type:'line',data:{labels,datasets:tagsPaar.map((t,i)=>({
      label:`${t.tag} (${t.eenheid})`,data:t.reeks,borderColor:kleuren[i],backgroundColor:kleuren[i],
      pointRadius:2,borderWidth:1.6,tension:0.2,yAxisID:i===0?'y':'y1'
    }))},options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{color:tickColor,font:{size:11},boxWidth:14}}},
      scales:{
        x:{grid:{display:false},ticks:{color:tickColor,font:{size:10}}},
        y:{position:'left',grid:{color:gridColor},ticks:{color:kleuren[0],font:{size:11}}},
        y1:{position:'right',grid:{display:false},ticks:{color:kleuren[1],font:{size:11}}}
      }}});
  }

  // ── Render: Installation Health-overzicht ───────────────────────────────
  function renderHealthOverview(records){
    const host=document.getElementById('pxHealthOverzicht');
    if(!host) return;
    const counts={normaal:0,monitoren:0,onderzoeken:0,actie:0,onvoldoende:0};
    records.forEach(r=>counts[r.status]++);
    const orderVisueel=['normaal','monitoren','onderzoeken','actie','onvoldoende'];
    host.innerHTML=`<div class="kg" style="grid-template-columns:repeat(5,1fr)">
      ${orderVisueel.map(st=>`<div class="kc" style="--accent:${STATUS_COLOR[st]}">
        <div class="kl">${STATUS_EMOJI[st]} ${STATUS_LABEL[st]}</div>
        <div class="kv">${counts[st]}</div>
        <div class="ks">van ${records.length} installaties</div>
      </div>`).join('')}
    </div>`;
  }

  // ── Render: Aandacht vereist ─────────────────────────────────────────────
  function renderAandacht(records,el){
    const host=document.getElementById('pxAandacht');
    if(!host) return;
    const actueel=records.filter(r=>['actie','onderzoeken','monitoren'].includes(r.status)).sort((a,b)=>b.prioriteit-a.prioriteit);
    let html='';
    if(actueel.length){
      html+=actueel.map(r=>`<div class="px-attn-card px-inst-row" data-code="${esc(r.code)}" role="button" tabindex="0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span class="badge ${STATUS_CLS[r.status]}">${STATUS_EMOJI[r.status]} ${STATUS_LABEL[r.status]}</span>
          <span style="font-family:monospace;font-size:12px">${esc(r.code)}</span>
        </div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:5px">${esc(r.functieplaatsNaam||r.functieplaats)} &middot; prioriteit ${fmtNl(r.prioriteit,1)}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">${esc(r.statusReden)}</div>
      </div>`).join('');
    } else {
      html+=`<div class="hm-note">Geen installaties met een actuele afwijkende status, op basis van de laatst beschikbare meting${el?` (${esc(fmtDatum(el.laatsteDatum))})`:''}.</div>`;
    }
    if(el&&el.afwijkendeStops.length){
      html+=`<div class="ws" style="margin:14px 0 6px">Recent uit de historie (EL2310) &mdash; niet actueel, wel automatisch gedetecteerd</div>`;
      html+=el.afwijkendeStops.map(e=>`<div class="px-attn-card px-inst-row" data-code="EL2310" role="button" tabindex="0">
        <div style="font-size:12px">${esc(fmtDatumTijd(e.start))} &ndash; ${esc(fmtDatumTijd(e.end))}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">${(e.uren/24).toFixed(1)} dagen &middot; prioriteit destijds ${fmtNl(prioriteitScore('actie',e.uren,false),1)}</div>
      </div>`).join('');
    }
    host.innerHTML=html;
    host.querySelectorAll('.px-inst-row').forEach(card=>{
      const open=()=>springNaarInstallatie(card.getAttribute('data-code'));
      card.addEventListener('click',open);
      card.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  // ── Render: procesgebied-nav, functieplaats-tegels per gebied en de
  // equipment-chips daaronder — samen de trechter gebied -> functieplaats ->
  // installatie. Vervangt de vroegere "alle 27 tegels ineens"-weergave en de
  // aparte pagina per functieplaats door één doorlopend, inklapbaar scherm. ─
  let _records=[];
  let _activeArea=null, _expandedFp=null, _activeEquipCode=null;
  function ergsteStatus(recs){
    for(const st of STATUS_ORDER){ if(recs.some(r=>r.status===st)) return st; }
    return 'onvoldoende';
  }
  function recordsVoorGebied(gebied){ return _records.filter(r=>gebied.fps.includes(r.functieplaats)); }
  function kiesDefaultGebied(){
    for(const st of STATUS_ORDER){
      if(st==='onvoldoende') continue;
      const gebied=AREA_DEFINITIONS.find(g=>recordsVoorGebied(g).some(r=>r.status===st));
      if(gebied) return gebied.id;
    }
    return AREA_DEFINITIONS[0].id;
  }

  function renderAreaNav(){
    const host=document.getElementById('pxAreaNav');
    if(!host) return;
    host.innerHTML=AREA_DEFINITIONS.map(g=>{
      const recs=recordsVoorGebied(g);
      const worst=ergsteStatus(recs);
      return `<div class="px-area-item${g.id===_activeArea?' active':''}" style="--dot:${STATUS_COLOR[worst]}" data-area="${g.id}" role="button" tabindex="0">
        <span class="px-area-dot"></span>
        <span class="px-area-naam">${esc(g.naam)}</span>
        <span class="px-area-n">${recs.length}</span>
      </div>`;
    }).join('');
    host.querySelectorAll('.px-area-item').forEach(item=>{
      const open=()=>selecteerGebied(item.getAttribute('data-area'));
      item.addEventListener('click',open);
      item.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  function selecteerGebied(areaId){
    _activeArea=areaId; _expandedFp=null; _activeEquipCode=null;
    renderAreaNav();
    renderAreaTiles();
    renderEquipChips();
    const detailHost=document.getElementById('pxInstDetail');
    if(detailHost) detailHost.innerHTML='<div class="hm-note">Klik op een functieplaats hierboven, dan op een installatie voor de details.</div>';
  }

  function renderAreaTiles(){
    const host=document.getElementById('pxAreaTiles');
    if(!host) return;
    const gebied=AREA_DEFINITIONS.find(g=>g.id===_activeArea);
    if(!gebied){ host.innerHTML=''; return; }
    const fps=functieplaatsen().filter(f=>gebied.fps.includes(f.code));
    host.innerHTML=`<div class="kg" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${fps.map(fp=>{
        const recs=_records.filter(r=>r.functieplaats===fp.code);
        const worst=ergsteStatus(recs);
        return `<div class="kc px-fp-tile${fp.code===_expandedFp?' active':''}" style="--accent:${STATUS_COLOR[worst]};cursor:pointer" data-fp="${esc(fp.code)}" role="button" tabindex="0">
          <div class="kl">${esc(fp.code)} &middot; ${STATUS_EMOJI[worst]}</div>
          <div class="kv" style="font-size:15px;line-height:1.3">${fp.naam?esc(fp.naam):'(onbekend)'}</div>
          <div class="ks">${recs.length} installatie${recs.length===1?'':'s'} &middot; ${STATUS_LABEL[worst]}</div>
        </div>`;
      }).join('')}
    </div>`;
    host.querySelectorAll('.px-fp-tile').forEach(tile=>{
      const open=()=>toggleFunctieplaats(tile.getAttribute('data-fp'));
      tile.addEventListener('click',open);
      tile.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  function toggleFunctieplaats(fpCode){
    const wordtGeopend=_expandedFp!==fpCode;
    _expandedFp=wordtGeopend?fpCode:null;
    _activeEquipCode=null;
    renderAreaTiles();
    renderEquipChips();
    const detailHost=document.getElementById('pxInstDetail');
    if(detailHost) detailHost.innerHTML='<div class="hm-note">Klik op een installatie hierboven voor de details.</div>';
    // Zelfde patroon als de KPI-detailpanelen elders in de app (dashboard,
    // Financiën): bij het openen schuift de nieuw zichtbare inhoud in beeld
    // i.p.v. dat de gebruiker zelf naar beneden moet scrollen.
    if(wordtGeopend){
      const chipsHost=document.getElementById('pxEquipChips');
      if(chipsHost){
        const reduceMotion=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        chipsHost.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
      }
    }
  }

  function renderEquipChips(){
    const host=document.getElementById('pxEquipChips');
    if(!host) return;
    if(!_expandedFp){ host.innerHTML=''; return; }
    const recs=_records.filter(r=>r.functieplaats===_expandedFp);
    host.innerHTML=`<div class="px-equip-chips">${recs.map(r=>
      `<span class="px-equip-chip${r.code===_activeEquipCode?' active':''}" style="color:${STATUS_COLOR[r.status]}" data-code="${esc(r.code)}" role="button" tabindex="0">${STATUS_EMOJI[r.status]} ${esc(r.code)}</span>`
    ).join('')}</div>`;
    host.querySelectorAll('.px-equip-chip').forEach(chip=>{
      const open=()=>kiesInstallatie(chip.getAttribute('data-code'));
      chip.addEventListener('click',open);
      chip.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  function kiesInstallatie(code){
    _activeEquipCode=code;
    renderEquipChips();
    selecteerInstallatie(code);
  }

  // Sneltoegang vanuit "Aandacht vereist": zet gebied + functieplaats +
  // installatie in één keer. Bewust GEEN simulatie van de losse
  // click-handlers (selecteerGebied/toggleFunctieplaats resetten juist de
  // net-gezette state van de vorige stap — dat zou de sprong meteen weer
  // ongedaan maken).
  function springNaarInstallatie(code){
    const rec=_records.find(r=>r.code===code);
    if(!rec) return;
    const gebied=gebiedVanFp(rec.functieplaats);
    if(gebied) _activeArea=gebied.id;
    _expandedFp=rec.functieplaats;
    _activeEquipCode=code;
    renderAreaNav();
    renderAreaTiles();
    renderEquipChips();
    selecteerInstallatie(code);
    const detailHost=document.getElementById('pxInstDetail');
    if(detailHost){ detailHost.setAttribute('tabindex','-1'); detailHost.focus({preventScroll:true}); }
  }

  // ── Tagcatalogus tonen/verbergen (los blok: ruwe catalogus + het
  // illustratieve 7-tags-voorbeeld uit js/pxtrend.js) i.p.v. het
  // commandocentrum. Verbergen/tonen is puur CSS — pxtrend.js heeft zijn
  // render al eenmalig gedaan via __initPxTrend; Chart.js heeft na het
  // wisselen wel een expliciete resize() nodig (canvas had breedte 0 tijdens
  // display:none). ──────────────────────────────────────────────────────
  function pxToggleTagcatalogus(){
    const cc=document.getElementById('pxCommandCenter');
    const cat=document.getElementById('pxCatalogusPaneel');
    const btn=document.getElementById('pxCatToggleBtn');
    if(!cc||!cat) return;
    const tonenCatalogus=cat.style.display==='none';
    cc.style.display=tonenCatalogus?'none':'';
    cat.style.display=tonenCatalogus?'':'none';
    if(btn) btn.textContent=tonenCatalogus?'← Terug naar overzicht':'Tagcatalogus';
    if(typeof Chart==='undefined'||!Chart.getChart) return;
    if(tonenCatalogus){
      const c=Chart.getChart('pxChart'); if(c) c.resize();
    } else {
      const c1=Chart.getChart('pxInstDetailChart'); if(c1) c1.resize();
      const c2=Chart.getChart('pxInstDetailOorzaakChart'); if(c2) c2.resize();
    }
  }
  window.pxToggleTagcatalogus=pxToggleTagcatalogus;

  // ── Render: installatiedetail (inline paneel, gedeeld voor alle 270) ───
  function episodeRow(e){
    const duurTekst=e.uren>=48?`${(e.uren/24).toFixed(1)} dagen`:`${e.uren} uur`;
    return `<tr><td>${esc(fmtDatumTijd(e.start))}</td><td>${esc(fmtDatumTijd(e.end))}</td><td>${duurTekst}</td></tr>`;
  }

  function detailKopHtml(r){
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:16px;font-weight:600;margin-bottom:2px">${esc(r.code)}</div>
        <div style="color:var(--color-text-secondary);font-size:12px">Functieplaats ${esc(r.functieplaats)}${r.functieplaatsNaam?' — '+esc(r.functieplaatsNaam):''} &middot; ${r.tags.length} PX-tag${r.tags.length===1?'':'s'} in de catalogus</div>
      </div>
      <div style="text-align:right">
        <span class="badge ${STATUS_CLS[r.status]}" style="font-size:13px;padding:4px 12px">${STATUS_EMOJI[r.status]} ${STATUS_LABEL[r.status]}</span>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">Prioriteit: ${fmtNl(r.prioriteit,1)}</div>
      </div>
    </div>`;
  }

  function rangeButtonsHtml(canvasId){
    return `<div class="fr" style="margin-bottom:8px">
      ${['24u','7d','30d','1j','alles'].map((rg,i)=>`<button type="button" class="btn${i===2?' btn-p':''} px-range-btn" data-canvas="${canvasId}" data-range="${rg}">${RANGE_LABEL[rg]}</button>`).join('')}
    </div>`;
  }

  function detailEL2310Html(r,canvasId){
    const el=r._analyse;
    return `${detailKopHtml(r)}
      <div class="hm-mod-kpis" style="margin-top:12px">
        <div class="kc" style="--accent:var(--color-info)"><div class="kl">Belasting laatste 30d</div><div class="kv">${fmtNl(el.rec.m,1)} A</div><div class="ks">gem. tijdens bedrijf &middot; n=${el.rec.n}u</div></div>
        <div class="kc" style="--accent:var(--color-info)"><div class="kl">T.o.v. eigen historie</div><div class="kv">${el.z>=0?'+':''}${fmtNl(el.z,1)} SD</div><div class="ks">${esc(el.statusReden)}</div></div>
        <div class="kc" style="--accent:var(--color-warning)"><div class="kl">Afwijkingen gevonden</div><div class="kv">${el.afwijkendeStops.length}</div><div class="ks">van ${el.groot.length} grote stops (&ge;150u), 2017&ndash;2025</div></div>
        <div class="kc"><div class="kl">Bekend onderhoudspatroon</div><div class="kv">${el.seizoensStops.length}</div><div class="ks">kerst-/zomerstops correct herkend</div></div>
      </div>
      <div class="ws" style="margin:14px 0 6px">Trend &mdash; motorstroom EL2310_JI</div>
      ${rangeButtonsHtml(canvasId)}
      <div class="chart-container chart-h220"><canvas id="${canvasId}"></canvas></div>
      <div class="ws" style="margin:14px 0 6px">Historische afwijkingen (${el.afwijkendeStops.length})</div>
      ${el.afwijkendeStops.length?`<div class="tw"><table><thead><tr><th>Van</th><th>Tot</th><th>Duur</th></tr></thead><tbody>${el.afwijkendeStops.map(episodeRow).join('')}</tbody></table></div>`
        :`<div class="hm-note">Geen afwijkende stilstanden gevonden.</div>`}
      <div class="hm-note" style="margin-top:10px">
        <strong>Methode:</strong> stilstanden &ge;150 uur worden onderling vergeleken op dag-in-het-jaar; komt eenzelfde soort stop in &ge;2 andere jaren rond dezelfde tijd voor, dan telt hij als bekend onderhoud, anders als afwijking.<br>
        <strong>Mogelijke oorzaak:</strong> niet te bepalen &mdash; deze installatie heeft maar 1 gemeten parameter (motorstroom); voor een oorzaakanalyse zijn minimaal 2 gecorreleerde metingen nodig (zie het WP3610-voorbeeld voor hoe dat eruit zou zien).<br>
        <strong>Onzeker:</strong> de installatie heeft een eigen statuscode (EL2310_aan, waarden 0/1/4/8/12) waarvan de betekenis van 4/8/12 niet is vastgesteld &mdash; hier niet gebruikt. De ingestelde grens EL2310_JW (25A) is bewust niet gebruikt als alarmcriterium (8,7% van de bedrijfsuren erboven, zonder gevolg).
      </div>`;
  }

  function detailBU4930Html(r,canvasId){
    const bu=r._analyse;
    return `${detailKopHtml(r)}
      <div class="hm-mod-kpis" style="margin-top:12px">
        <div class="kc"><div class="kl">Niveaubereik</div><div class="kv">${fmtNl(bu.min,0)}&ndash;${fmtNl(bu.max,0)}</div><div class="ks">gemeten (eenheid niet vermeld in bron)</div></div>
        <div class="kc"><div class="kl">Gemiddeld niveau</div><div class="kv">${fmtNl(bu.mean,0)}</div><div class="ks">over ${bu.n} bemeten uren, 2024</div></div>
        <div class="kc"><div class="kl">Volatiliteit</div><div class="kv">${fmtNl(bu.meanAbsDelta,1)}</div><div class="ks">gem. |verandering| per uur</div></div>
      </div>
      <div class="ws" style="margin:14px 0 6px">Trend &mdash; vulniveau</div>
      ${rangeButtonsHtml(canvasId)}
      <div class="chart-container chart-h220"><canvas id="${canvasId}"></canvas></div>
      <div class="hm-note" style="margin-top:10px">
        <strong>Waarom onvoldoende data voor een oordeel:</strong> deze reeks bevat alleen het vulniveau, geen afvoer- of klepdebiet. Een stijgend of dalend niveau kan net zo goed normaal proces zijn (aanvoer vanuit EL2310 vs. continue afvoer naar de molen) als een probleem &mdash; zonder de aanvullende tags is dat onderscheid niet te maken.
      </div>`;
  }

  function detailGeenDataHtml(r,oorzaakCanvasId){
    return `${detailKopHtml(r)}
      <div class="hm-note" style="margin-top:12px">Geen PX Trend-meethistorie gekoppeld aan deze installatie. De catalogus kent hier ${r.tags.length} tag${r.tags.length===1?'':'s'} (naam/eenheid), maar er is nooit een waarde geregistreerd in dit dashboard.</div>
      ${r.tags.length?`<div class="tw" style="margin-top:10px"><table><thead><tr><th>Tag</th><th>Omschrijving</th><th>Eenheid</th></tr></thead><tbody>
        ${r.tags.slice(0,20).map(t=>`<tr><td style="font-family:monospace;font-size:12px">${esc(t.tag)}</td><td>${esc(t.omschrijving)}</td><td>${esc(t.eenheid)}</td></tr>`).join('')}
      </tbody></table>${r.tags.length>20?`<div class="ws" style="margin-top:6px">(eerste 20 van ${r.tags.length} tags getoond)</div>`:''}</div>`:''}
      ${r.voorbeeldOorzaak?oorzaakDemoHtml(oorzaakCanvasId):''}`;
  }

  // ── Generieke installatiedetail (alle installaties buiten EL2310/BU4930
  // die wél echte data hebben via de generieke engine — zie
  // scripts/px-ingest.js / js/pxtrend-engine.js). Toont elke bruikbare tag
  // met zijn eigen status/trend/baseline, en een dagelijks-gemiddelde
  // grafiek voor de meest opvallende tag. ─────────────────────────────────
  function renderDailyChart(canvasId,epochDate,reeks,label,kleur){
    const canvas=document.getElementById(canvasId);
    if(!canvas||typeof Chart==='undefined'||!reeks.length) return;
    if(_charts[canvasId]) _charts[canvasId].destroy();
    const epoch=new Date(epochDate+'T00:00:00Z').getTime();
    const labels=reeks.map(([d])=>new Date(epoch+d*86400000).toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'2-digit'}));
    const data=reeks.map(([,v])=>v);
    const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
    _charts[canvasId]=new Chart(canvas,{type:'line',data:{labels,datasets:[
      {label,data,borderColor:kleur,backgroundColor:kleur,pointRadius:0,borderWidth:1.4,tension:0.15}
    ]},options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:true,labels:{color:tickColor,font:{size:11},boxWidth:14}}},
      scales:{x:{grid:{display:false},ticks:{color:tickColor,font:{size:10},maxTicksLimit:12}},
        y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:11}}}}}});
  }

  function detailGenerickHtml(r,canvasId){
    const gen=r._generiek;
    const rijen=Object.entries(gen.tags).sort((a,b)=>STATUS_ORDER.indexOf(a[1].status)-STATUS_ORDER.indexOf(b[1].status));
    const top=rijen[0];
    const reeksData=top&&typeof window!=='undefined'&&window.PX_TAGREEKSEN&&window.PX_TAGREEKSEN[top[0]];
    const heeftGrafiek=!!(reeksData&&reeksData.reeks&&reeksData.reeks.length);
    return `${detailKopHtml(r)}
      <div class="ws" style="margin:14px 0 6px">Tags (${rijen.length} bruikbaar van ${gen.tagsTotal})</div>
      <div class="tw"><table><thead><tr><th>Tag</th><th>Status</th><th>Trend</th><th>Baseline (30d ervoor)</th><th>Recent (30d)</th></tr></thead><tbody>
        ${rijen.map(([tag,t])=>`<tr><td style="font-family:monospace;font-size:12px">${esc(tag)}</td>
          <td><span class="badge ${STATUS_CLS[t.status]}">${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}</span></td>
          <td>${esc(t.trend)}</td>
          <td>${t.baseline?fmtNl(t.baseline.mean,2)+' &plusmn; '+fmtNl(t.baseline.sd,2):'&mdash;'}</td>
          <td>${t.recentMean!=null?fmtNl(t.recentMean,2):'&mdash;'}</td>
        </tr>`).join('')}
      </tbody></table></div>
      ${heeftGrafiek?`<div class="ws" style="margin:14px 0 6px">Trend &mdash; ${esc(top[0])} (dagelijks gemiddelde, volledige historie)</div>
      <div class="chart-container chart-h220"><canvas id="${canvasId}"></canvas></div>`:''}
      <div class="hm-note" style="margin-top:10px">Automatisch berekend met de generieke PX Trend-engine (baseline/afwijking/trend per tag, dagelijks gemiddelde over de volledige historie) &mdash; geen installatiespecifieke code.${r.nietInCatalogus?' Let op: dit equipment staat nog niet in de SAP-functieplaatscatalogus.':''}</div>`;
  }

  function oorzaakDemoHtml(canvasId){
    const paar=voorbeeldTags().filter(t=>t.installatie==='WP3610');
    if(paar.length<2) return '';
    return `<div class="proto-banner" style="margin-top:16px">
        <span class="ico" aria-hidden="true">&#9888;&#65039;</span>
        <div><strong>Voorbeeld — mogelijke-oorzaakanalyse.</strong> WP3610 heeft nu geen echte gemeten reeksen; dit toont met illustratieve voorbeelddata hoe deze functie eruit zou zien zodra een installatie 2+ echte, gecorreleerde tijdreeksen heeft.</div>
      </div>
      <div class="ws" style="margin:10px 0 6px">Trend &mdash; ${paar.map(t=>esc(t.tag)).join(' &amp; ')} (voorbeeld)</div>
      <div class="chart-container chart-h220"><canvas id="${canvasId}"></canvas></div>
      <div class="hm-note" style="margin-top:10px"><strong>Mogelijke oorzaak (voorbeeld):</strong> trilling én drukverschil stijgen in dit voorbeeld gelijktijdig &mdash; dat patroon is een <em>indicatie</em>, geen diagnose, voor toenemende vervuiling/verstopping in de rollerpers. Bij een echte installatie met deze twee tags zou het platform dit automatisch signaleren zodra beide reeksen tegelijk buiten hun normaalbereik bewegen.</div>`;
  }

  // hostId: id van het paneel waar de detail in gerenderd wordt — de
  // canvas-id's worden hiervan afgeleid zodat 2 detailpanelen (bv. het
  // paneel op de hoofdpagina én dat op een functieplaats-pagina) nooit
  // dezelfde canvas-id in de DOM krijgen.
  function selecteerInstallatie(code,hostId){
    hostId=hostId||'pxInstDetail';
    const rec=_records.find(r=>r.code===code);
    if(!rec) return;
    const host=document.getElementById(hostId);
    if(!host) return;
    const canvasId=hostId+'Chart', oorzaakCanvasId=hostId+'OorzaakChart';
    let html;
    if(rec.code==='EL2310') html=detailEL2310Html(rec,canvasId);
    else if(rec.code==='BU4930') html=detailBU4930Html(rec,canvasId);
    else if(rec._generiek) html=detailGenerickHtml(rec,canvasId);
    else html=detailGeenDataHtml(rec,oorzaakCanvasId);
    host.innerHTML=`<div class="kc" style="--accent:${STATUS_COLOR[rec.status]};padding:16px">${html}</div>`;
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
    if(rec.code==='EL2310'||rec.code==='BU4930'){
      const bron=rec._analyse;
      const label=rec.code==='EL2310'?'EL2310_JI — motorstroom':'BU4930 — vulniveau';
      const kleur=rec.code==='EL2310'?'#388bfd':'#d29922';
      const eenheid=rec.code==='EL2310'?'A':'';
      renderTijdreeksChart(canvasId,'30d',bron.epoch,bron.reeks,label,kleur,eenheid);
      host.querySelectorAll('.px-range-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          host.querySelectorAll('.px-range-btn').forEach(b=>b.classList.remove('btn-p'));
          btn.classList.add('btn-p');
          renderTijdreeksChart(btn.dataset.canvas,btn.dataset.range,bron.epoch,bron.reeks,label,kleur,eenheid);
        });
      });
    } else if(rec._generiek){
      const rijen=Object.entries(rec._generiek.tags).sort((a,b)=>STATUS_ORDER.indexOf(a[1].status)-STATUS_ORDER.indexOf(b[1].status));
      const top=rijen[0];
      const reeksData=top&&window.PX_TAGREEKSEN&&window.PX_TAGREEKSEN[top[0]];
      if(reeksData&&reeksData.reeks&&reeksData.reeks.length) renderDailyChart(canvasId,reeksData.epochDate,reeksData.reeks,top[0],STATUS_COLOR[top[1].status]);
    }
    if(rec.voorbeeldOorzaak){
      const paar=voorbeeldTags().filter(t=>t.installatie==='WP3610');
      if(paar.length>=2) renderOorzaakChart(oorzaakCanvasId,paar);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function initConditie(){
    _records=buildInstallationHealth();
    assertAreaDekking();
    const el=analyseEL2310();
    _activeArea=kiesDefaultGebied();
    _expandedFp=null; _activeEquipCode=null;
    renderHealthOverview(_records);
    renderAandacht(_records,el);
    renderAreaNav();
    renderAreaTiles();
    renderEquipChips();
    const detailHost=document.getElementById('pxInstDetail');
    if(detailHost) detailHost.innerHTML='<div class="hm-note">Klik op een functieplaats hierboven, dan op een installatie voor de details.</div>';
    // Elke (her)opening van PX Trend start weer op het commandocentrum, niet
    // op een tagcatalogus-weergave die bij een vorig bezoek openstond.
    const cc=document.getElementById('pxCommandCenter'), cat=document.getElementById('pxCatalogusPaneel'), btn=document.getElementById('pxCatToggleBtn');
    if(cc) cc.style.display='';
    if(cat) cat.style.display='none';
    if(btn) btn.textContent='Tagcatalogus';
  }

  // Blootgesteld voor js/pxtrend-rapport.js — zelfde motor hergebruikt,
  // geen dubbele analyse-logica.
  window.__pxConditie={
    buildInstallationHealth, analyseEL2310, analyseBU4930, historieWekelijks, historieDagelijks,
    prioriteitScore, classifyZ, STATUS_LABEL, STATUS_EMOJI, STATUS_CLS, STATUS_COLOR, STATUS_ORDER,
    hourDate, fmtDatum, fmtDatumTijd, fmtNl, esc, mondayOf, weekKey, dagKey, mean
  };

  const vorigeInit=window.__initPxTrend;
  window.__initPxTrend=function(){
    if(typeof vorigeInit==='function') vorigeInit();
    initConditie();
  };
})();
