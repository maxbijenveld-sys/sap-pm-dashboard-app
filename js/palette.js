// Command palette (Ctrl/Cmd+K) — overal in de app: navigeren naar pagina's,
// weken en acties, én zoeken over álle werkorders heen (het gewone zoekveld
// zoekt alleen binnen de huidige pagina).
//
// Klassiek script (geen module), net als legacy-app.js: het leunt op de
// globals daaruit (weeks, showPage, showWkPg, esc, isAdmin, …). Laadt ná
// legacy-app.js in index.html.

(function(){
  'use strict';
  let _open=false,_items=[],_active=0;

  // ── Bronnen ─────────────────────────────────────────────────────────
  // Elke bron levert {type,label,sub,run}. Pagina's/acties zijn statisch;
  // weken en werkorders komen uit de al geladen data (geen extra fetch).
  function staticItems(){
    const it=[
      {type:'Pagina',label:'Start',sub:'Modulekeuze & signalen',run:()=>showPage('home')},
      {type:'Pagina',label:'Dashboard',sub:'Weekplanning & uitvoering',run:()=>showPage('dashboard')},
      {type:'Pagina',label:'Backlog',sub:'Unieke werkorders, risico & aging',run:()=>showPage('backlog')},
      {type:'Pagina',label:'Analyse',sub:'Niet uitgevoerd — redenen & installaties',run:()=>showPage('analyse')},
      {type:'Pagina',label:'Week toevoegen',sub:'Excel uploaden of handmatig invullen',run:()=>showPage('addweek')},
    ];
    if(document.getElementById('financeNavBtn')&&typeof window.__showFinance==='function'){
      it.push({type:'Pagina',label:'Financiën',sub:'Onderhoudskosten (2FA)',run:()=>window.__showFinance()});
    }
    if(typeof isAdmin!=='undefined'&&isAdmin){
      it.push({type:'Pagina',label:'Gebruikers',sub:'Gebruikersbeheer (admin)',run:()=>showPage('gebruikers')});
      it.push({type:'Pagina',label:'Audit-log',sub:'Beheerdersacties (admin)',run:()=>showPage('auditlog')});
    }
    if(typeof window.openWeekRapport==='function'){
      it.push({type:'Actie',label:'Weekrapport',sub:'Managementrapport — printbaar',run:()=>window.openWeekRapport()});
    }
    it.push({type:'Actie',label:'Twee-factor (2FA) instellen',sub:'Account',run:()=>openMfaEnroll()});
    it.push({type:'Actie',label:'Wachtwoord wijzigen',sub:'Account',run:()=>wijzigWachtwoord()});
    it.push({type:'Actie',label:'Uitloggen',sub:'Account',run:()=>signOut()});
    (typeof weeks!=='undefined'?weeks:[]).slice().sort((a,b)=>b.week-a.week).forEach(w=>{
      it.push({type:'Week',label:`Week ${w.week}`,sub:w.label||'',run:()=>showWkPg(w.id)});
    });
    return it;
  }

  // Werkorders: gededupliceerd op ordernummer (laatste status), doorzocht op
  // nummer én omschrijving. Selectie opent de Backlog met de zoekterm
  // ingevuld — daar staat de volledige historie van die order.
  function woItems(q){
    if(!q||q.length<2) return [];
    const seen={},out=[];
    (typeof weeks!=='undefined'?weeks:[]).forEach(w=>(w.rows||[]).forEach(r=>{
      if(!r.wo||r.wo==='—') return;
      const hit=(r.wo.toLowerCase().includes(q)||(r.omschrijving||'').toLowerCase().includes(q));
      if(!hit) return;
      // Laatste vermelding wint (zelfde idee als dedupeByOrder).
      seen[r.wo]={wo:r.wo,omschrijving:r.omschrijving||'',status:r.status,week:w.week};
    }));
    Object.values(seen).sort((a,b)=>b.week-a.week).slice(0,8).forEach(x=>{
      const st={ja:'afgerond',nee:'niet uitgevoerd',deels:'deels',uc:'under construction'}[x.status]||'—';
      out.push({type:'Werkorder',label:`${x.wo} — ${x.omschrijving}`,sub:`laatst gezien W${x.week} · ${st}`,run:()=>{
        showPage('backlog');
        const inp=document.getElementById('bSearch'),fl=document.getElementById('bFilter');
        if(fl) fl.value='all';
        if(inp){inp.value=x.wo;}
        renderBacklog();
      }});
    });
    return out;
  }

  function score(item,q){
    const l=item.label.toLowerCase();
    if(l.startsWith(q)) return 0;
    if(l.includes(q)) return 1;
    if((item.sub||'').toLowerCase().includes(q)) return 2;
    return -1;
  }

  function collect(qRaw){
    const q=(qRaw||'').trim().toLowerCase();
    const base=staticItems();
    if(!q) return base;
    const ranked=base.map(it=>({it,s:score(it,q)})).filter(x=>x.s>=0)
      .sort((a,b)=>a.s-b.s).map(x=>x.it);
    return ranked.concat(woItems(q)).slice(0,12);
  }

  // ── UI ──────────────────────────────────────────────────────────────
  function ensureDom(){
    if(document.getElementById('cmdkOverlay')) return;
    const el=document.createElement('div');
    el.id='cmdkOverlay';
    el.innerHTML=`<div class="cmdk" role="dialog" aria-modal="true" aria-label="Snel zoeken en navigeren">
      <input id="cmdkInput" type="text" autocomplete="off" spellcheck="false"
        placeholder="Zoek een pagina, week, actie of werkorder&hellip;" aria-label="Zoek een pagina, week, actie of werkorder">
      <div id="cmdkList" role="listbox" aria-label="Resultaten"></div>
      <div class="cmdk-foot"><span>&#8593;&#8595; kiezen</span><span>Enter openen</span><span>Esc sluiten</span></div>
    </div>`;
    el.addEventListener('mousedown',e=>{if(e.target===el)close();});
    document.body.appendChild(el);
    const inp=document.getElementById('cmdkInput');
    inp.addEventListener('input',()=>{_active=0;renderList(inp.value);});
    inp.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();move(1);}
      else if(e.key==='ArrowUp'){e.preventDefault();move(-1);}
      else if(e.key==='Enter'){e.preventDefault();pick(_active);}
      else if(e.key==='Escape'){e.preventDefault();close();}
    });
  }

  function renderList(q){
    _items=collect(q);
    const list=document.getElementById('cmdkList');
    if(!_items.length){
      list.innerHTML=`<div class="cmdk-empty">Geen resultaten voor &ldquo;${esc(q)}&rdquo;</div>`;
      return;
    }
    let lastType='';
    list.innerHTML=_items.map((it,i)=>{
      const hdr=it.type!==lastType?`<div class="cmdk-hdr">${it.type==='Werkorder'?'Werkorders':it.type==='Week'?'Weken':it.type==='Actie'?'Acties':'Pagina’s'}</div>`:'';
      lastType=it.type;
      return`${hdr}<div class="cmdk-item${i===_active?' active':''}" role="option" aria-selected="${i===_active}" id="cmdk-i${i}" onmousedown="event.preventDefault()" onclick="window.__cmdkPick(${i})">
        <span class="cmdk-label">${esc(it.label)}</span>
        <span class="cmdk-sub">${esc(it.sub||'')}</span>
      </div>`;
    }).join('');
  }

  function move(d){
    if(!_items.length) return;
    _active=(_active+d+_items.length)%_items.length;
    renderList(document.getElementById('cmdkInput').value);
    const el=document.getElementById('cmdk-i'+_active);
    if(el) el.scrollIntoView({block:'nearest'});
  }

  function pick(i){
    const it=_items[i];
    if(!it) return;
    close();
    it.run();
  }
  window.__cmdkPick=pick;

  function open(){
    // Alleen ná inloggen (de palette leunt op geladen data en navigatie).
    const shell=document.getElementById('appShell');
    if(!shell||shell.style.display==='none') return;
    ensureDom();
    _open=true;_active=0;
    const ov=document.getElementById('cmdkOverlay');
    ov.classList.add('show');
    const inp=document.getElementById('cmdkInput');
    inp.value='';
    renderList('');
    inp.focus();
  }
  function close(){
    _open=false;
    const ov=document.getElementById('cmdkOverlay');
    if(ov) ov.classList.remove('show');
  }
  window.openCommandPalette=open;

  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();_open?close():open();}
  });
})();
