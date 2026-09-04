// PX Trend — functieplaatsen, equipments en tagnamen zijn nu echt (zie
// js/pxtrend-catalogus.js, window.PX_TAG_CATALOGUS/PX_FUNCTIEPLAATSEN, 860
// tags / 270 equipments / 27 functieplaatsen uit de A-TAG-lijst en 17
// PID-tekeningen). Bewuste afwijking van de eerder vastgestelde regel dat
// PX-data dit externe dashboard niet in mag — zie docs/PX_TREND_MODULE_PLAN.md
// §6 en de openingscommentaar van pxtrend-catalogus.js.
//
// De 7 tags hieronder (PX_TAGS) hebben een illustratieve trendreeks —
// tag/omschrijving/eenheid zijn 100% echt (overgenomen uit het
// tag-catalogus-bestand), maar er bestaat nergens een echte tijdreeks
// (temperatuur/trilling/druk over tijd) totdat de PX-historian (interne SQL
// Server) gekoppeld wordt — zie docs/PX_TREND_MODULE_PLAN.md §1/§5. Waar de
// tag een echte, niet-placeholder DCS-alarmgrens had (KM4720_TI1, DT3510_TI,
// UK3410_TI1, KM4910_PI3 — zie docs/px_trend_tag_catalog.json) is die grens
// hier als normaalbereik gebruikt; de overige 3 (WP3610_XI, WV4911_XI1,
// BK3510_PI1) hebben alleen placeholder-alarmgrenzen in de DCS (zie
// PX_TREND_MODULE_PLAN.md §2: 59% van de tags heeft dat), dus daar is een
// aannemelijk normaalbereik gekozen — expliciet gemarkeerd met 'echtGrens:false'.
//
// Init gebeurt via window.__initPxTrend(), aangeroepen vanuit de PX Trend-
// kaart op Start (js/home.js) — zelfde patroon als
// window.__initBetrouwbaarheid() voor de SAP PM-demo.
//
// Vaste "vandaag"-datum (i.p.v. new Date()) zodat de reeksen en de
// afgeleide cijfers hier blijven kloppen, ook weken/maanden nadat dit
// geschreven is — dit is en blijft een prototype met bevroren
// voorbeelddata, geen live meting.
(function(){
  const VANDAAG = new Date('2026-08-20T00:00:00');

  // Elke reeks: 15 dagwaarden, dag -14 t/m dag 0 (vandaag = laatste waarde).
  const PX_TAGS = [
    { tag:'KM4720_TI1', installatie:'KM4720', omschrijving:'Temperatuur cement', type:'temperatuur', eenheid:'°C',
      normaal:{min:100,max:129.9}, echtGrens:true,
      reeks:[112,113,114,115,117,119,121,123,125,127,129,131,133,135,137] },
    { tag:'DT3510_TI', installatie:'DT3510', omschrijving:'Temperatuur branderkamer', type:'temperatuur', eenheid:'°C',
      normaal:{min:395,max:600}, echtGrens:true,
      reeks:[432,435,430,438,441,436,433,439,442,437,434,440,436,433,435] },
    { tag:'UK3410_TI1', installatie:'UK3410', omschrijving:'Temperatuur afgas', type:'temperatuur', eenheid:'°C',
      normaal:{min:90,max:120}, echtGrens:true,
      reeks:[100,101,103,104,106,107,109,110,112,113,115,117,118,120,122] },
    { tag:'WP3610_XI', installatie:'WP3610', omschrijving:'Trillmeting (rollerpers)', type:'trilling', eenheid:'mm/s',
      normaal:{min:2,max:6}, echtGrens:false,
      reeks:[3.0,3.1,3.3,3.5,3.7,4.0,4.3,4.6,5.0,5.4,5.8,6.2,6.6,6.9,7.2] },
    // Tweede, eveneens illustratieve reeks op DEZELFDE installatie (WP3610) —
    // tagnaam en alarmgrens (19-71 bar) zijn wél echt (A-TAG-catalogus), de
    // reeks niet. Bewust zo gekozen dat hij gelijktijdig met WP3610_XI
    // oploopt: dit voedt de "mogelijke oorzaak"-demo in
    // js/pxtrend-conditie.js (Early Warning-scherm), die laat zien hoe
    // multi-parameter-correlatie op een installatie met échte meerdere
    // gemeten reeksen zou werken. Zie docs/PX_TREND_MODULE_PLAN.md §8.
    { tag:'WP3610_P07', installatie:'WP3610', omschrijving:'Pressure difference (rollerpers)', type:'druk', eenheid:'bar',
      normaal:{min:19,max:71}, echtGrens:true,
      reeks:[42,43,45,47,49,52,55,58,61,64,67,69,72,74,76] },
    { tag:'WV4911_XI1', installatie:'WV4911', omschrijving:'Vibration fan separator', type:'trilling', eenheid:'mm/s',
      normaal:{min:1.5,max:4.5}, echtGrens:false,
      reeks:[2.8,2.9,2.7,3.0,2.9,3.1,2.8,3.0,3.2,2.9,3.1,3.0,2.9,3.1,3.0] },
    { tag:'BK3510_PI1', installatie:'BK3510', omschrijving:'Onderdruk branderkamer', type:'druk', eenheid:'mbar',
      normaal:{min:-4,max:-1}, echtGrens:false,
      reeks:[-2.2,-2.3,-2.1,-2.4,-2.5,-2.6,-2.7,-2.8,-3.0,-3.2,-3.4,-3.6,-3.8,-4.0,-4.3] },
    { tag:'KM4910_PI3', installatie:'KM4910', omschrijving:'Motorlager West', type:'druk', eenheid:'bar',
      normaal:{min:0.14,max:3.2}, echtGrens:true,
      reeks:[1.6,1.7,1.5,1.8,1.6,1.9,1.7,1.8,1.6,1.9,1.7,1.8,1.6,1.7,1.8] }
  ];
  // Totale omvang van de echte PX-tagcatalogus (js/pxtrend-catalogus.js,
  // window.PX_TAG_CATALOGUS) — valt terug op 860 (het bekende totaal) als het
  // catalogusbestand onverhoopt niet geladen is.
  const TOTAAL_TAGS_CATALOGUS = (typeof window.PX_TAG_CATALOGUS!=='undefined'&&window.PX_TAG_CATALOGUS.length)||860;
  // Beschikbaar voor js/pxtrend-conditie.js (de "mogelijke oorzaak"-demo op
  // WP3610) — zelfde illustratieve set, niet gedupliceerd.
  window.PX_TAGS_VOORBEELD = PX_TAGS;

  const TYPE_LABEL = {temperatuur:'Temperatuur', trilling:'Trilling', druk:'Druk'};
  const STATUS_LABEL = {normaal:'Normaal', afwijkend:'Afwijkend', alarm:'Alarm'};
  const STATUS_CLS = {normaal:'bja', afwijkend:'bdeels', alarm:'bnee'};
  const STATUS_COLOR = {normaal:'#3fb950', afwijkend:'#d29922', alarm:'#f85149'};

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtNl(n,dec){ return (dec==null?n:Number(n).toFixed(dec)).toString().replace('.',','); }
  function dagLabel(offset){ const d=new Date(VANDAAG); d.setDate(d.getDate()+offset); return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short'}); }

  function laatsteWaarde(t){ return t.reeks[t.reeks.length-1]; }
  // Afwijking t.o.v. het normaalbereik: 0 = binnen bereik, anders het aantal
  // eenheden voorbij de dichtstbijzijnde grens (negatief = onder de grens).
  function afwijking(t){
    const v=laatsteWaarde(t);
    if(v<t.normaal.min) return v-t.normaal.min;
    if(v>t.normaal.max) return v-t.normaal.max;
    return 0;
  }
  // Ernst = afwijking als aandeel van de breedte van het normaalbereik, zodat
  // tags met heel verschillende schalen (mbar vs. °C) eerlijk vergeleken
  // worden. >15% van de bandbreedte buiten de grens = alarm, anders afwijkend.
  function status(t){
    const d=Math.abs(afwijking(t));
    if(d===0) return 'normaal';
    const breedte=t.normaal.max-t.normaal.min;
    return (d/breedte)>0.15 ? 'alarm' : 'afwijkend';
  }

  let _pxChart=null;
  let _pxActiveTag=PX_TAGS[0].tag;

  function huidigeFilters(){
    const type=document.getElementById('pxTypeFilter').value;
    const inst=document.getElementById('pxInstallatieFilter').value;
    return {type,inst};
  }
  function filteredTags(){
    const {type,inst}=huidigeFilters();
    return PX_TAGS.filter(t=>(!type||t.type===type)&&(!inst||t.installatie===inst));
  }

  function vulFilters(){
    const sel=document.getElementById('pxInstallatieFilter');
    if(!sel||sel.dataset.filled) return;
    sel.dataset.filled='1';
    [...new Set(PX_TAGS.map(t=>t.installatie))].sort().forEach(naam=>{
      const opt=document.createElement('option');
      opt.value=naam; opt.textContent=naam;
      sel.appendChild(opt);
    });
    sel.addEventListener('change',()=>{ syncActiveTagMetFilter(); renderAll(); });
    document.getElementById('pxTypeFilter').addEventListener('change',()=>{ syncActiveTagMetFilter(); renderAll(); });
  }

  // Als een filter de actief geselecteerde tag wegfiltert, val terug op de
  // eerste zichtbare tag i.p.v. een lege grafiek te laten staan.
  function syncActiveTagMetFilter(){
    const zichtbaar=filteredTags();
    if(!zichtbaar.some(t=>t.tag===_pxActiveTag)) _pxActiveTag=zichtbaar.length?zichtbaar[0].tag:null;
  }

  function kpiCard(accent,label,value,sub){
    return `<div class="kc" style="--accent:${accent}">
      <div class="kl">${label}</div>
      <div class="kv">${value}</div>
      <div class="ks">${sub}</div>
    </div>`;
  }

  function renderKpis(){
    const host=document.getElementById('pxKpis');
    if(!host) return;
    const alarmTags=PX_TAGS.filter(t=>status(t)==='alarm');
    const afwijkendTags=PX_TAGS.filter(t=>status(t)==='afwijkend');
    const grootste=PX_TAGS.slice().sort((a,b)=>Math.abs(afwijking(b))-Math.abs(afwijking(a)))[0];
    const gd=afwijking(grootste);
    const types=[...new Set(PX_TAGS.map(t=>t.type))];
    host.innerHTML=
      kpiCard('var(--color-danger)','Actieve vroegsignalen',alarmTags.length+afwijkendTags.length,
        `${alarmTags.length} alarm &middot; ${afwijkendTags.length} in de gaten houden`) +
      kpiCard('var(--color-warning)','Grootste afwijking',
        `${gd>0?'+':''}${fmtNl(gd,1)} ${grootste.eenheid}`,
        `${esc(grootste.installatie)} &mdash; ${esc(grootste.omschrijving)}`) +
      kpiCard('var(--color-info)','Tags bewaakt (voorbeeld)',PX_TAGS.length,
        `van ${TOTAAL_TAGS_CATALOGUS} beschikbare PX-tags in de historian-catalogus`) +
      kpiCard('var(--color-primary)','Metingtypen in dit voorbeeld',types.length,
        types.map(t=>TYPE_LABEL[t]).join(' &middot; '));
  }

  function renderChart(){
    const tag=PX_TAGS.find(t=>t.tag===_pxActiveTag);
    const titelEl=document.getElementById('pxChartTitel');
    const canvas=document.getElementById('pxChart');
    if(!tag){ if(titelEl) titelEl.textContent='geen tag geselecteerd'; if(_pxChart){_pxChart.destroy();_pxChart=null;} return; }
    if(titelEl) titelEl.textContent=`${tag.installatie} — ${tag.omschrijving} (${tag.tag})`;
    if(!canvas||typeof Chart==='undefined') return;
    const labels=tag.reeks.map((_,i)=>dagLabel(i-(tag.reeks.length-1)));
    if(_pxChart) _pxChart.destroy();
    const tickColor='#a3b3a9', gridColor='rgba(255,255,255,0.06)';
    const kleur=STATUS_COLOR[status(tag)];
    const tooltipCfg=typeof externalTooltipHandler==='function'
      ?{enabled:false,external:externalTooltipHandler}
      :{enabled:true};
    _pxChart=new Chart(canvas,{type:'line',data:{labels,datasets:[
      {label:`Gemeten waarde (${tag.eenheid})`,data:tag.reeks,borderColor:kleur,backgroundColor:kleur,
        pointRadius:2,pointHoverRadius:4,borderWidth:2,tension:0.3},
      {label:'Normaal — boven',data:tag.reeks.map(()=>tag.normaal.max),borderColor:'rgba(163,179,169,0.5)',
        borderDash:[5,4],pointRadius:0,borderWidth:1},
      {label:'Normaal — onder',data:tag.reeks.map(()=>tag.normaal.min),borderColor:'rgba(163,179,169,0.5)',
        borderDash:[5,4],pointRadius:0,borderWidth:1}
    ]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,labels:{color:tickColor,font:{size:11},boxWidth:14}},tooltip:tooltipCfg},
      scales:{
        x:{grid:{display:false},ticks:{color:tickColor,font:{size:11}}},
        y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:12}}}
      }}});
  }

  function renderTabel(){
    const rows=filteredTags().slice().sort((a,b)=>Math.abs(afwijking(b))-Math.abs(afwijking(a)));
    let html=`<div class="tw"><table><thead><tr><th>Installatie</th><th>Tag</th><th>Omschrijving</th><th>Type</th><th>Huidige waarde</th><th>Normaalbereik</th><th>Signaal</th></tr></thead><tbody>`;
    if(!rows.length){
      html+=`<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--color-text-secondary)">Geen tags voor deze filter</td></tr>`;
    }
    rows.forEach(t=>{
      const st=status(t);
      const actief=t.tag===_pxActiveTag;
      html+=`<tr class="px-row${actief?' active':''}" data-tag="${esc(t.tag)}" style="cursor:pointer${actief?';background:var(--color-card-hover)':''}" role="button" tabindex="0">
        <td>${esc(t.installatie)}</td>
        <td style="font-family:monospace;font-size:12px">${esc(t.tag)}</td>
        <td>${esc(t.omschrijving)}</td>
        <td>${TYPE_LABEL[t.type]}</td>
        <td>${fmtNl(laatsteWaarde(t),1)} ${esc(t.eenheid)}</td>
        <td>${fmtNl(t.normaal.min,1)} &ndash; ${fmtNl(t.normaal.max,1)} ${esc(t.eenheid)}</td>
        <td><span class="badge ${STATUS_CLS[st]}">${STATUS_LABEL[st]}</span></td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    const host=document.getElementById('pxTagTabel');
    if(!host) return;
    host.innerHTML=html;
    host.querySelectorAll('.px-row').forEach(tr=>{
      const open=()=>{ _pxActiveTag=tr.getAttribute('data-tag'); renderChart(); renderTabel(); renderDetail(); };
      tr.addEventListener('click',open);
      tr.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  function renderDetail(){
    const host=document.getElementById('pxTagDetail');
    if(!host) return;
    const tag=PX_TAGS.find(t=>t.tag===_pxActiveTag);
    if(!tag){ host.innerHTML=''; return; }
    const st=status(tag);
    const uitleg={
      normaal:'Deze meting beweegt zich binnen het normaalbereik — geen actie nodig.',
      afwijkend:'Deze meting is de afgelopen dagen richting de rand van het normaalbereik gedreven — het waard om in de gaten te houden, nog geen storing.',
      alarm:'Deze meting is buiten het normaalbereik gedreven en blijft oplopen — een vroegsignaal vóór een storing optreedt, niet erna.'
    }[st];
    const laatste5=tag.reeks.slice(-5).map((v,i,arr)=>({dag:dagLabel(i-(arr.length-1)),waarde:v}));
    let html=`<div class="sl" style="margin-top:20px">${esc(tag.installatie)} — ${esc(tag.omschrijving)}</div>
      <div class="ws" style="margin-bottom:10px"><span class="badge ${STATUS_CLS[st]}">${STATUS_LABEL[st]}</span> &nbsp; ${uitleg}</div>
      <div class="tw"><table><thead><tr><th>Dag</th><th>Waarde</th></tr></thead><tbody>`;
    laatste5.forEach(r=>{ html+=`<tr><td>${esc(r.dag)}</td><td>${fmtNl(r.waarde,1)} ${esc(tag.eenheid)}</td></tr>`; });
    html+='</tbody></table></div>';
    host.innerHTML=html;
  }

  function renderAll(){ renderKpis(); renderChart(); renderTabel(); renderDetail(); }

  // ── Functieplaatsen — overzicht (echte structuur, js/pxtrend-catalogus.js) ─
  function functieplaatsen(){ return (typeof window.PX_FUNCTIEPLAATSEN!=='undefined')?window.PX_FUNCTIEPLAATSEN:[]; }
  function tagCatalogus(){ return (typeof window.PX_TAG_CATALOGUS!=='undefined')?window.PX_TAG_CATALOGUS:[]; }

  function renderFpOverzicht(){
    const host=document.getElementById('pxFpOverzicht');
    if(!host) return;
    const fps=functieplaatsen();
    if(!fps.length){ host.innerHTML=`<div class="hm-note">Geen functieplaatscatalogus geladen.</div>`; return; }
    let html=`<div class="tw"><table><thead><tr><th>Functieplaats</th><th>Naam</th><th>Equipments</th><th>Tags</th><th>Bron</th></tr></thead><tbody>`;
    fps.forEach(f=>{
      html+=`<tr class="px-fp-row" data-fp="${esc(f.code)}" style="cursor:pointer" role="button" tabindex="0">
        <td style="font-family:monospace">${esc(f.code)}</td>
        <td>${f.naam?esc(f.naam):'<span style="color:var(--color-text-secondary)">(onbekend &mdash; geen PID beschikbaar)</span>'}</td>
        <td>${f.aantalEquipments}</td>
        <td>${f.aantalTags}</td>
        <td style="color:var(--color-text-secondary);font-size:12px">${f.bron?esc(f.bron):'&mdash;'}</td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    host.innerHTML=html;
    host.querySelectorAll('.px-fp-row').forEach(tr=>{
      const open=()=>{
        const sel=document.getElementById('pxCatFpFilter');
        if(sel){ sel.value=tr.getAttribute('data-fp'); renderCatalogus(); }
      };
      tr.addEventListener('click',open);
      tr.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
    });
  }

  // ── Volledige tagcatalogus (860 tags, alleen structuur, geen meetwaarden) ──
  function vulCatFilters(){
    const sel=document.getElementById('pxCatFpFilter');
    if(!sel||sel.dataset.filled) return;
    sel.dataset.filled='1';
    functieplaatsen().forEach(f=>{
      const opt=document.createElement('option');
      opt.value=f.code; opt.textContent=`${f.code} — ${f.naam||'onbekend'}`;
      sel.appendChild(opt);
    });
    sel.addEventListener('change',renderCatalogus);
    const zoek=document.getElementById('pxCatZoek');
    if(zoek) zoek.addEventListener('input',renderCatalogus);
  }

  function renderCatalogus(){
    const host=document.getElementById('pxCatTabel');
    if(!host) return;
    const fpSel=document.getElementById('pxCatFpFilter');
    const zoekEl=document.getElementById('pxCatZoek');
    const fp=fpSel?fpSel.value:'';
    const zoek=(zoekEl?zoekEl.value:'').trim().toLowerCase();
    let rows=tagCatalogus();
    if(fp) rows=rows.filter(t=>t.functieplaats===fp);
    if(zoek) rows=rows.filter(t=>t.tag.toLowerCase().includes(zoek)||t.omschrijving.toLowerCase().includes(zoek));
    const MAX=300;
    let html=`<div class="ws" style="margin-bottom:8px">${rows.length} tag${rows.length===1?'':'s'}${rows.length>MAX?` — eerste ${MAX} getoond, verfijn de filter voor de rest`:''}</div>`;
    html+=`<div class="tw"><table><thead><tr><th>Tag</th><th>Equipment</th><th>Functieplaats</th><th>Omschrijving</th><th>Eenheid</th></tr></thead><tbody>`;
    if(!rows.length){
      html+=`<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--color-text-secondary)">Geen tags voor deze filter</td></tr>`;
    }
    rows.slice(0,MAX).forEach(t=>{
      html+=`<tr>
        <td style="font-family:monospace;font-size:12px">${esc(t.tag)}</td>
        <td style="font-family:monospace">${t.installatie?esc(t.installatie):'&mdash;'}</td>
        <td>${t.functieplaats?esc(t.functieplaats):'&mdash;'}</td>
        <td>${esc(t.omschrijving)}</td>
        <td>${esc(t.eenheid)}</td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    host.innerHTML=html;
  }

  window.__initPxTrend=function(){
    vulFilters();
    vulCatFilters();
    _pxActiveTag=PX_TAGS[0].tag;
    renderAll();
    renderFpOverzicht();
    renderCatalogus();
  };
})();
