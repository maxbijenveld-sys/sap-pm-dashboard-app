// Vangt onverwachte JS-fouten op en logt ze naar Supabase (client_errors,
// zie docs/sql/fase19_client_error_log.sql) — vóór deze toevoeging bleven
// fouten bij gebruikers volledig onzichtbaar tenzij iemand het toevallig
// meldde (audit-bevinding, "geen error-monitoring in productie").
//
// Bewust NIETS anders dan technische foutdetails: geen formuliergegevens,
// geen werkorderinhoud, geen wachtwoorden. Eigen kopie van de Supabase-
// constanten omdat classic <script>-tags elkaars top-level const/let niet
// delen (zelfde reden als de gedupliceerde esc()) — window.__platformAuth
// is wél gedeeld (expliciet op window gezet) en levert de ingelogde
// gebruiker.
(function(){
  'use strict';
  const SUPABASE_URL='https://gohmnfgpczaeoysamlwy.supabase.co';
  const SUPABASE_KEY='sb_publishable_eoIJ0jmspVLW9u-9u7QeNA_IXTD8EwY';
  const MAX_PER_SESSION=20;      // rem tegen een gek geworden loop die honderden fouten/sec vuurt
  const seen=new Set();
  let count=0;

  function truncate(s,n){ s=String(s==null?'':s); return s.length>n?s.slice(0,n):s; }

  function send(payload){
    if(count>=MAX_PER_SESSION) return;
    const auth=window.__platformAuth;
    const token=auth&&auth.currentUser&&auth.currentUser.access_token;
    const email=auth&&auth.currentUser&&auth.currentUser.user&&auth.currentUser.user.email;
    if(!token) return;             // niet ingelogd: RLS zou de insert toch weigeren
    const key=payload.message+'|'+payload.source+'|'+payload.lineno;
    if(seen.has(key)) return;      // dezelfde fout niet keer op keer loggen
    seen.add(key); count++;
    fetch(SUPABASE_URL+'/rest/v1/client_errors',{
      method:'POST',
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:'Bearer '+token,
        'Content-Type':'application/json',
        Prefer:'return=minimal'
      },
      body:JSON.stringify({
        actor_email:email||null,
        message:truncate(payload.message,500),
        source:truncate(payload.source,300),
        lineno:payload.lineno||null,
        colno:payload.colno||null,
        stack:truncate(payload.stack,2000),
        user_agent:truncate(navigator.userAgent,300),
        url:truncate(location.href,300)
      })
    }).catch(function(){/* logging mag zelf nooit een fout gooien */});
  }

  window.addEventListener('error',function(e){
    // Cross-origin scripts zonder CORS geven alleen "Script error." zonder
    // bruikbare details — niet de moeite van het loggen waard.
    if(e.message==='Script error.'&&!e.filename) return;
    send({
      message:e.message,
      source:e.filename,
      lineno:e.lineno,
      colno:e.colno,
      stack:e.error&&e.error.stack
    });
  });

  window.addEventListener('unhandledrejection',function(e){
    const reason=e.reason;
    send({
      message:'Onafgehandelde promise-rejection: '+(reason&&reason.message?reason.message:String(reason)),
      source:location.pathname,
      stack:reason&&reason.stack
    });
  });
})();
