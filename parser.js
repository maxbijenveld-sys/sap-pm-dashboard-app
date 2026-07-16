// Excel-parserlogica voor SAP PM weekplanning. Los van index.html zodat dit
// bestand in de browser (<script src="parser.js">), in de serverless import
// (api/import.js, via require) én in de browsertests (test/parser.test.html)
// bruikbaar is, zonder de logica dubbel te onderhouden.

function parseStatus(s){
  const v=(s||'').toString().toLowerCase().trim().replace(/[^a-z]/g,'');
  if(v==='ja'||v==='yes') return'ja';
  if(v==='nee'||v==='neen'||v==='no') return'nee';
  if(v==='deels') return'deels';
  if(v.includes('under')||v==='uc'||v.includes('construct')) return'uc';
  if(v==='') return'';
  return'nee';
}

const DAGNAMEN=['Ma','Di','Wo','Do','Vr'];

// Eén weektabblad (raw = sheet_to_json met header:1) omzetten naar {weekNum,yearNum,label,rows}.
// SAP-weekplanning markeert elke dag met een Excel-datumserienummer (5 cijfers) in kolom A —
// er staan altijd precies 5 van die markeringen per week (Ma t/m Vr), dus de volgorde waarin
// ze voorkomen bepaalt de dag, zonder dat we het exacte serienummer hoeven te kennen.
function parseExcelSheet(raw){
  let weekNum=null, yearNum=2026;
  for(let i=0;i<Math.min(10,raw.length);i++){
    const r=raw[i]||[];
    for(let j=0;j<r.length;j++){
      const v=(r[j]||'').toString().trim().toLowerCase();
      if(v==='week'&&r[j+1]) weekNum=parseInt(r[j+1]);
      if(v==='jaar'&&r[j+1]) yearNum=parseInt(r[j+1])||2026;
    }
  }
  if(!weekNum) return null;

  // W22+ splitst Gepland en Ongepland in twee kolomblokken. De ongepland-kolom
  // schuift op vanaf W26 (extra "Reden"-kolom toegevoegd), dus we zoeken de
  // startkolom dynamisch op via de "Ongeplande werkzaamheden"-koptekst in plaats
  // van een vast kolomnummer aan te nemen.
  let ongOffset=-1;
  for(const r of raw){
    const idx=(r||[]).findIndex(c=>(c||'').toString().toLowerCase().includes('ongeplande werkzaamheden'));
    if(idx>=0){ongOffset=idx;break;}
  }
  const hasSplit=ongOffset>=0;

  // Vanaf W26 staat er een "Reden"-kolom in de koptekst (los van Opmerking),
  // los per blok opzoeken zodat we 'm op de juiste kolom uitlezen voor zowel
  // gepland als (indien aanwezig) ongepland.
  let redenCols=[];
  for(const r of raw){
    for(let ci=0;ci<(r||[]).length;ci++){
      if((r[ci]||'').toString().trim().toLowerCase()==='reden') redenCols.push(ci);
    }
    if(redenCols.length) break;
  }
  const redenGepland=redenCols.find(c=>!hasSplit||c<ongOffset);
  const redenOngepland=redenCols.find(c=>hasSplit&&c>=ongOffset);

  // "Opmerking" (vrije tekst) staat los van Reden en wordt op dezelfde manier
  // dynamisch opgezocht — alleen aanwezig vanaf W26, dus oudere weken krijgen
  // gewoon geen opmerking-veld.
  let opmerkingCols=[];
  for(const r of raw){
    for(let ci=0;ci<(r||[]).length;ci++){
      if((r[ci]||'').toString().trim().toLowerCase()==='opmerking') opmerkingCols.push(ci);
    }
    if(opmerkingCols.length) break;
  }
  const opmGepland=opmerkingCols.find(c=>!hasSplit||c<ongOffset);
  const opmOngepland=opmerkingCols.find(c=>hasSplit&&c>=ongOffset);

  const skipVals=new Set(['werkzaamheden','werkzaamheden (vulwerk)','jaar','week',
    'geplande werkzaamheden','ongeplande werkzaamheden','hemelvaartsdag',
    'geen td aanwezig','2e pinksterdag','']);

  let currentDag=null, dayIdx=-1;
  const rows=[];

  const addRow=(omschr,order,w1,w2,w3,stat,reden,opmerking,type)=>{
    const o=(omschr||'').toString().trim();
    if(!o||skipVals.has(o.toLowerCase())) return;
    const ol=o.toLowerCase();
    if(ol.includes('pinkster')||ol.includes('hemelvaartsdag')||ol==='geen td aanwezig') return;
    const s=parseStatus(stat);
    const wie=[w1,w2,w3].map(x=>(x||'').toString().trim()).filter(x=>x&&x!=='-'&&x!=='0').join(', ')||'—';
    const row={day:currentDag,wo:((order||'').toString().trim())||'—',omschrijving:o,wie,type,status:s||'nee'};
    const redenVal=(reden||'').toString().trim();
    if(redenVal) row.reden=redenVal;
    const opmerkingVal=(opmerking||'').toString().trim();
    if(opmerkingVal) row.opmerking=opmerkingVal;
    rows.push(row);
  };

  for(let i=0;i<raw.length;i++){
    const r=raw[i]||[];
    const c0=(r[0]||'').toString().trim();

    // Dagmarkering: Excel-datumserienummer in kolom A
    if(/^\d{5}$/.test(c0)){
      dayIdx++;
      currentDag=DAGNAMEN[dayIdx]||'Vr';
      continue;
    }
    if(!currentDag) continue;

    // Skip gebeurt per kolomblok in addRow() (elke kant checkt zijn eigen
    // omschrijving tegen skipVals), NIET hier op basis van alleen c0/kolom A.
    // Bug tot en met 2026-07: een `continue` op skipVals.has(c0) sloeg de hele
    // rij over zodra de GEPLAND-kant leeg was — ook als de ONGEPLAND-kant
    // (andere kolommen, vanaf ongOffset) wél een item bevatte. Zo verdween een
    // rij als "gepland leeg, ongepland: OI2471 noodreparatie" stilletjes,
    // precies het scenario dat de regressietest hieronder had moeten vangen —
    // maar nooit deed omdat de test nooit automatisch draaide (zie CI).
    addRow(r[0],r[1],r[2],r[3],r[4],r[5],redenGepland!==undefined?r[redenGepland]:'',opmGepland!==undefined?r[opmGepland]:'','gepland');
    if(hasSplit) addRow(r[ongOffset],r[ongOffset+1],r[ongOffset+2],r[ongOffset+3],r[ongOffset+4],r[ongOffset+5],redenOngepland!==undefined?r[redenOngepland]:'',opmOngepland!==undefined?r[opmOngepland]:'','ongepland');
  }

  return{weekNum,yearNum,label:`Week ${weekNum}, ${yearNum}`,rows:rows.filter(r=>r.omschrijving)};
}

// ISO-8601-weeknummer + -jaar van een datum (maandag t/m zondag; week 1 = de
// week met de eerste donderdag van het jaar). Gebruikt bij het uploaden van
// een weekplanning-Excel om te bepalen welke week "vorige week" is t.o.v.
// vandaag — de master-Excel bevat doorgaans alle weken van het jaar, maar
// alleen de zojuist afgesloten week is nieuwe informatie; eerdere weken
// staan al vast en horen niet stilzwijgend overschreven te worden door een
// hernieuwde upload van hetzelfde (mogelijk later licht aangepaste) bestand.
function isoWeekOf(date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const dag=d.getUTCDay()||7;                 // maandag=1 ... zondag=7
  d.setUTCDate(d.getUTCDate()+4-dag);          // naar de donderdag van deze week
  const jaarStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-jaarStart)/86400000)+1)/7);
  return{week,year:d.getUTCFullYear()};
}
// Vorige week t.o.v. een datum (default: nu) — 7 dagen terug, dan isoWeekOf.
function isoWeekBefore(date){
  const d=new Date((date||new Date()).getTime());
  d.setDate(d.getDate()-7);
  return isoWeekOf(d);
}
// De "zojuist afgesloten" werkweek: de weekplanning loopt ma t/m vr, dus in
// het weekend (za/zo) is de HUIDIGE kalenderweek al afgerond en is dát de
// week om te verwerken; doordeweeks is het de vorige kalenderweek. Zonder
// dit weekend-geval verwees "vorige week" op zondag naar de week dáárvoor
// (bug: upload op zo 12 juli wilde W27 verwerken terwijl W28 net af was).
function isoWeekJustFinished(date){
  const d=date||new Date();
  const dag=d.getDay();                       // 0 = zondag, 6 = zaterdag
  return(dag===0||dag===6)?isoWeekOf(d):isoWeekBefore(d);
}

// In de browser worden parseStatus/DAGNAMEN/parseExcelSheet gewoon globals
// (klassiek <script>, geen module). In Node (tests) maken we ze via
// module.exports beschikbaar — dit blok is inert in de browser omdat
// `module` daar niet bestaat.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseStatus, DAGNAMEN, parseExcelSheet, isoWeekOf, isoWeekBefore, isoWeekJustFinished };
}
