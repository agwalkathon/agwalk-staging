// API Fetchers and Offline Caching Engine

async function fetchAll(url) {
  var all=[],from=0,ps=1000;
  while(true){
    var sep=url.indexOf('?')>-1?'&':'?';
    var r=await fetch(url+sep+'limit='+ps+'&offset='+from,{headers:Object.assign({},HDR,{'Range-Unit':'items','Range':from+'-'+(from+ps-1)})});
    if(!r.ok)break;
    var page=await r.json();
    if(!Array.isArray(page)||!page.length)break;
    all=all.concat(page);
    if(page.length<ps)break;
    from+=ps;
  }
  return all;
}

function resolveEventMilestones(eventRow, gender) {
  var gKey = (gender || '').toLowerCase() === 'female' ? 'female' : 'male';
  var defaults = {
    bronze: { label: 'Bronze', thresh: (eventRow && eventRow.type === 'cycling') ? 250 : 125 },
    silver: { label: 'Silver', thresh: (eventRow && eventRow.type === 'cycling') ? 500 : 200 },
    gold: { label: 'Gold', thresh: (eventRow && eventRow.type === 'cycling') ? 750 : 300 }
  };
  
  if (eventRow && eventRow.rules_config && eventRow.rules_config.dashboard && Array.isArray(eventRow.rules_config.dashboard.rings)) {
    var rings = eventRow.rules_config.dashboard.rings;
    var bronzeRing = rings.find(function(r) { var l = (r.label || '').toLowerCase(); return l.indexOf('bronze') > -1 || l.indexOf('level 1') > -1 || l.indexOf('tier 1') > -1; }) || rings[0];
    var silverRing = rings.find(function(r) { var l = (r.label || '').toLowerCase(); return l.indexOf('silver') > -1 || l.indexOf('level 2') > -1 || l.indexOf('tier 2') > -1; }) || rings[1];
    var goldRing = rings.find(function(r) { var l = (r.label || '').toLowerCase(); return l.indexOf('gold') > -1 || l.indexOf('level 3') > -1 || l.indexOf('tier 3') > -1; }) || rings[2];
    
    if (bronzeRing) {
      var val = (gKey === 'female') ? (bronzeRing.goal_female !== undefined ? bronzeRing.goal_female : bronzeRing.goal) : (bronzeRing.goal_male !== undefined ? bronzeRing.goal_male : bronzeRing.goal);
      defaults.bronze = { label: bronzeRing.label || 'Bronze', thresh: parseFloat(val) || defaults.bronze.thresh };
    }
    if (silverRing) {
      var val = (gKey === 'female') ? (silverRing.goal_female !== undefined ? silverRing.goal_female : silverRing.goal) : (silverRing.goal_male !== undefined ? silverRing.goal_male : silverRing.goal);
      defaults.silver = { label: silverRing.label || 'Silver', thresh: parseFloat(val) || defaults.silver.thresh };
    }
    if (goldRing) {
      var val = (gKey === 'female') ? (goldRing.goal_female !== undefined ? goldRing.goal_female : goldRing.goal) : (goldRing.goal_male !== undefined ? goldRing.goal_male : goldRing.goal);
      defaults.gold = { label: goldRing.label || 'Gold', thresh: parseFloat(val) || defaults.gold.thresh };
    }
  }
  return defaults;
}

async function fetchAllParallel(url) {
  var sep = url.indexOf('?') > -1 ? '&' : '?';
  var countHeaders = Object.assign({}, HDR, { 'Prefer': 'count=exact' });
  try {
    var countRes = await fetch(url + sep + 'limit=1', { headers: countHeaders });
    if (!countRes.ok) {
      return fetchAll(url);
    }
    var contentRange = countRes.headers.get('content-range');
    var total = 0;
    if (contentRange) {
      var parts = contentRange.split('/');
      if (parts.length > 1) total = parseInt(parts[1]) || 0;
    }
    if (total === 0) return [];
    
    var ps = 1000;
    var promises = [];
    for (var from = 0; from < total; from += ps) {
      var pageUrl = url + sep + 'limit=' + ps + '&offset=' + from;
      var pageHeaders = Object.assign({}, HDR, { 'Range-Unit': 'items', 'Range': from + '-' + (from + ps - 1) });
      promises.push(
        fetch(pageUrl, { headers: pageHeaders }).then(function(r) {
          if (!r.ok) throw new Error("Page fetch failed: " + r.status);
          return r.json();
        })
      );
    }
    var results = await Promise.all(promises);
    var all = [];
    results.forEach(function(page) {
      if (Array.isArray(page)) all = all.concat(page);
    });
    return all;
  } catch(e) {
    console.warn('[Cache] fetchAllParallel error, falling back to sequential:', e);
    return fetchAll(url);
  }
}

// Caching Layer
var CACHE_TTL = { personal: 5*60*1000, config: 15*1000, ranking: 5*60*1000, reg: 30*60*1000 };
var EVENT_ROW = { id: 1, start_date: '2026-06-01', end_date: '2026-06-30' };

function getEventUTCStart() {
  var dStr = (EVENT_ROW && EVENT_ROW.start_date) || '2026-06-01';
  return new Date(dStr + 'T00:00:00+05:30').toISOString().replace('.000Z', 'Z');
}
function getEventUTCEnd() {
  var dStr = (EVENT_ROW && EVENT_ROW.end_date) || '2026-06-30';
  var d = new Date(dStr + 'T23:59:59.999+05:30');
  return d.toISOString().replace('.000Z', 'Z');
}
function getEventCutoffUTC() {
  var dStr = (EVENT_ROW && EVENT_ROW.end_date) || '2026-06-30';
  var d = new Date(dStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() + 1);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day + 'T11:00:00Z';
}

function cacheSet(key, data) {
  safeSetItem('agwalk_' + key, JSON.stringify({ ts: Date.now(), data: data }));
}
function cacheGet(key, ttl) {
  var raw = safeGetItem('agwalk_' + key);
  if (!raw) return null;
  try {
    var obj = JSON.parse(raw);
    if (Date.now() - obj.ts > ttl) return null;
    return obj.data;
  } catch(e) { return null; }
}
function cacheClear(athleteId) {
  var keys = ['reg_'+athleteId,'acts_v4_'+athleteId,'config','challenges','special_days','medals','ranking_acts_v4','ranking_reg'];
  keys.forEach(function(k){ safeRemoveItem('agwalk_'+k); });
  console.log('[Cache] Cleared for athlete', athleteId);
}

// Cache migrations
safeRemoveItem('agwalk_ranking_acts');

function getRegistrationFetchUrl(s) {
  var cols = 'id,emp_code,full_name,email,mobile,gender,shift,project_lead,strava_profile_url,tshirt_size,leaderboard_team,event_name,created_at,role,is_private,is_flagged,event_id,strava_athlete_id,status,profile_photo';
  var queryObj = s || {};
  if (queryObj.empCode) {
    return SUPABASE_URL + '/rest/v1/registration?emp_code=eq.' + encodeURIComponent(queryObj.empCode) + '&select=' + cols;
  }
  if (queryObj.email) {
    return SUPABASE_URL + '/rest/v1/registration?email=ilike.' + encodeURIComponent(queryObj.email) + '&select=' + cols;
  }
  var aId = queryObj.athleteId || (typeof athleteId !== 'undefined' ? athleteId : '');
  return SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + aId + '&select=' + cols;
}

// Main Application Loader
async function load(isBackgroundRefresh) {
  // Handle Strava OAuth callback
  var oauthCode = new URLSearchParams(window.location.search).get('code');
  if (oauthCode) {
    window.history.replaceState({}, '', window.location.pathname);
    var splashText = document.getElementById('splash-text');
    if (splashText) {
      splashText.textContent = 'Connecting your Strava account...';
      splashText.style.display = 'block';
    }
    
    var session = {};
    try {
      session = JSON.parse(safeGetItem('wk_user') || '{}');
    } catch(e) {}
    var sessionEmpCode = session.empCode || '';
    var sessionEmail = session.email || '';

    var urlParams = new URLSearchParams(window.location.search);
    var stateVal = urlParams.get('state');
    var activeEventId = stateVal ? parseInt(stateVal, 10) : (session.eventId || (EVENT_ROW ? EVENT_ROW.id : 1));

    try {
      var res = await fetch(BACKEND + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: oauthCode, 
          event_code: activeEventId === 2 ? 'cycling2026' : 'walkathon2026',
          event_id: activeEventId,
          emp_code: sessionEmpCode,
          email: sessionEmail
        })
      });
      var d = await res.json();
      if (d.success) {
        cacheClear(d.athlete_id);
        safeSetItem('wk_user', JSON.stringify({
          loggedIn: true,
          role: d.role || 'user',
          athleteId: d.athlete_id,
          name: d.name,
          profilePhoto: d.profile_photo || '',
          empCode: sessionEmpCode || d.emp_code || '',
          email: sessionEmail || d.email || '',
          eventId: activeEventId,
          expires: Date.now() + (8 * 60 * 60 * 1000)
        }));
        if (splashText) {
          splashText.textContent = 'Connection successful! Loading dashboard...';
        }
        await new Promise(function(resolve) { setTimeout(resolve, 800); });
      } else {
        var errMsg = d.error === 'not_registered'
          ? '⛔ Not registered. Your Strava account is not in the participant list.'
          : '❌ Strava connection failed. Please try again.';
        alert(errMsg);
      }
    } catch (err) {
      console.error('Strava registration failed:', err);
      alert('❌ Connection error. Please try again.');
    }
  }

  if (window._currentTab === 'leaderboard' && window._lbCurrentEventId && window._lbCurrentEventId !== window._lbRegisteredEventId) {
    if (typeof window.fetchEventLbState === 'function') {
      try {
        if (window._lbEventCache) delete window._lbEventCache[window._lbCurrentEventId];
        var st = await window.fetchEventLbState(window._lbCurrentEventId);
        if (typeof window.applyLbState === 'function') {
          window.applyLbState(st);
          window._lbReady = false;
          if (typeof window.lbBoot === 'function') window.lbBoot();
        }
      } catch(e) {
        console.warn('PTR custom leaderboard reload failed:', e);
      }
    }
    return;
  }

  var s;
  var urlParams = new URLSearchParams(window.location.search);
  var urlActivityId = urlParams.get('activityId');
  if (urlActivityId) {
    try {
      s = JSON.parse(safeGetItem('wk_user') || '{}');
    } catch(e) {
      s = {};
    }
    if (!s || !s.loggedIn || !s.athleteId) {
      s = { loggedIn: true, athleteId: '12345', name: 'Tester', role: 'user' };
    }
  } else {
    s = userGuard();
    if (!s) return;
  }
  currentSession = s;
  var athleteId = s.athleteId;

  // ── Maintenance mode gate — block immediately if enabled ────────────────
  var _maintBlocked = await checkMaintenanceGate(athleteId, s.empCode);
  if (_maintBlocked) return;

  loadNotifications();
  try {
    // ── Phase 1: Load live event and personal data with cache ─────────────────
    var liveEvent = null;
    try {
      var evRes = await fetch(SUPABASE_URL + '/rest/v1/events?status=eq.live&limit=1', { headers: HDR });
      var evData = await evRes.json();
      if (Array.isArray(evData) && evData.length > 0) {
        liveEvent = evData[0];
      }
    } catch(e) {
      console.warn('Failed to resolve live event at boot:', e);
    }

    var _cachedEv = cacheGet('event_row_'+athleteId, CACHE_TTL.reg);
    if (liveEvent) {
      EVENT_ROW = liveEvent;
    } else if (_cachedEv) {
      EVENT_ROW = _cachedEv;
    } else {
      EVENT_ROW = { id: 1, start_date: '2026-06-01', end_date: '2026-06-30' };
    }
    cacheSet('event_row_'+athleteId, EVENT_ROW);
    var eventId = EVENT_ROW.id;
    window._LB_EV_RULES = EVENT_ROW.rules_config || null;

    var _cachedReg   = cacheGet('reg_'+athleteId+'_'+eventId, CACHE_TTL.reg);
    var _cachedActs  = cacheGet('acts_v4_'+athleteId+'_'+eventId, CACHE_TTL.personal);
    var _cachedCfg   = cacheGet('config_'+eventId, CACHE_TTL.config);
    var _cachedCh    = cacheGet('challenges_'+eventId, CACHE_TTL.config);
    var _cachedSd    = cacheGet('special_days_'+eventId, CACHE_TTL.config);
    var _cachedMedal = cacheGet('medals_'+eventId, CACHE_TTL.config);
    var _allFromCache = _cachedReg && _cachedActs && _cachedCfg && _cachedCh && _cachedSd && _cachedMedal;

    if (_allFromCache && !isBackgroundRefresh) {
      var cacheAgeMs = 0;
      var rawActs = safeGetItem('agwalk_acts_v4_' + athleteId + '_' + eventId);
      if (rawActs) {
        try { cacheAgeMs = Date.now() - JSON.parse(rawActs).ts; } catch(e){}
      }
      if (cacheAgeMs > 60000) {
        setTimeout(function(){
          Promise.all([
            fetch(getRegistrationFetchUrl(s),{headers:HDR}).then(function(r){return r.json();}).then(function(d){
              cacheSet('reg_'+athleteId+'_'+eventId,d);
            }),
            fetchAll(SUPABASE_URL+'/rest/v1/activities?event_id=eq.'+eventId+'&strava_athlete_id=eq.'+athleteId+'&is_deleted=eq.false&activity_date=gte.'+getEventUTCStart()+'&activity_date=lte.'+getEventUTCEnd()+'&order=activity_date.desc').then(function(d){cacheSet('acts_v4_'+athleteId+'_'+eventId,d);}),
            fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?event_id=eq.'+eventId+'&select=config_key,config_value',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('config_'+eventId,d);}),
            fetch(SUPABASE_URL+'/rest/v1/challenges?event_id=eq.'+eventId+'&is_active=eq.true&select=*',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('challenges_'+eventId,d);}),
            fetch(SUPABASE_URL+'/rest/v1/special_scoring_days?event_id=eq.'+eventId+'&select=special_date',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('special_days_'+eventId,d);}),
            fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?event_id=eq.'+eventId+'&config_key=eq.medals&select=config_value',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('medals_'+eventId,d);})
          ]).then(function(){
            function doReload() {
              if (_touchInteracting) {
                console.log('[Cache] User is interacting, deferring dashboard background reload...');
                setTimeout(doReload, 300);
              } else {
                console.log('[Cache] Phase 1 background refresh complete. Re-rendering dashboard UI...');
                load(true);
              }
            }
            doReload();
          }).catch(function(e){console.warn('[Cache] Background refresh failed:', e);});
        }, 200);
      }
    }
    var regJsonData, myActs, cfgRows, chRows, sdRows, medalData;
    if (_allFromCache) {
      console.log('[Cache] Serving Phase 1 from cache ✓');
      regJsonData  = _cachedReg;
      myActs       = _cachedActs;
      cfgRows      = _cachedCfg;
      chRows       = _cachedCh;
      sdRows       = _cachedSd;
      medalData    = _cachedMedal;
    } else {
      console.log('[Cache] Cache miss — fetching Phase 1 from Supabase...');
      var regRes = await fetch(getRegistrationFetchUrl(s),{headers:HDR});
      regJsonData = await regRes.json(); cacheSet('reg_'+athleteId+'_'+eventId, regJsonData);

      var [myActsFetched,cfgRes,chRes,sdRes,medalRes]=await Promise.all([
        fetchAll(SUPABASE_URL+'/rest/v1/activities?event_id=eq.'+eventId+'&strava_athlete_id=eq.'+athleteId+'&is_deleted=eq.false&activity_date=gte.'+getEventUTCStart()+'&activity_date=lte.'+getEventUTCEnd()+'&order=activity_date.desc'),
        fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?event_id=eq.'+eventId+'&select=config_key,config_value',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/challenges?event_id=eq.'+eventId+'&is_active=eq.true&select=*',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/special_scoring_days?event_id=eq.'+eventId+'&select=special_date',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?event_id=eq.'+eventId+'&config_key=eq.medals&select=config_value',{headers:HDR})
      ]);
      myActs      = myActsFetched;       cacheSet('acts_v4_'+athleteId+'_'+eventId, myActs);
      cfgRows     = await cfgRes.json(); cacheSet('config_'+eventId, cfgRows);
      chRows      = await chRes.json();  cacheSet('challenges_'+eventId, chRows);
      sdRows      = await sdRes.json();  cacheSet('special_days_'+eventId, sdRows);
      medalData   = await medalRes.json(); cacheSet('medals_'+eventId, medalData);
    }
    var allActs=[],allRegRes=[];
    if(Array.isArray(cfgRows)) {
      cfgRows.forEach(function(row){
        if(row.config_key==='bonus_points') CONFIG_LB.bonus=row.config_value.map(function(b){return{km:Number(b.km),points:Number(b.points||b.pts||0)};});
        if(row.config_key==='base_points') CONFIG_LB.basePer_km=parseFloat(row.config_value.per_km||1);
        if(row.config_key==='base_points_per_km') CONFIG_LB.basePer_km=parseFloat(row.config_value)||1;
        if(row.config_key==='announcements_enabled') CONFIG_LB.announcements_enabled=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='maintenance_mode') CONFIG_LB.maintenance_mode=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='maintenance_message') CONFIG_LB.maintenance_message=(typeof row.config_value==='string'?row.config_value:'')||'';
        if(row.config_key==='hide_strava_connect') CONFIG_LB.hide_strava_connect=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='team_leaderboard_enabled') CONFIG_LB.team_leaderboard_enabled=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='tabs_config') {
          var val = row.config_value || {};
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch(e) {}
          }
          CONFIG_LB.tabs_config = val;
        }
        if(row.config_key==='feed_config') {
          try {
            CONFIG_LB.feed_config = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
          } catch(e) { console.error("Failed to parse feed_config:", e); }
        }
        if(row.config_key==='activities_points_config') {
          try {
            CONFIG_LB.activities_points_config = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
          } catch(e) { console.error("Failed to parse activities_points_config:", e); }
        }
      });
      if (typeof setupAppLayout === 'function') {
        if (window.EVENT_ROW && window.EVENT_ROW.status === 'live') {
          window._currentTab = 'dashboard';
        }
        setupAppLayout(true);
      }
    }

    // Enforce Strava Connect Card visibility
    var hideStrava = CONFIG_LB.hide_strava_connect === true;
    var sContainer = document.getElementById('strava-connect-container');
    if (sContainer) {
      sContainer.style.display = hideStrava ? 'none' : 'block';
    }

    if (window.enforceForceInstallPWA) {
      window.enforceForceInstallPWA();
    }
    if (window.checkPushSubscriptionState) {
      window.checkPushSubscriptionState();
    }
    initializeFeedTab(CONFIG_LB.announcements_enabled !== false);
    if (CONFIG_LB.announcements_enabled !== false) {
      loadFeed().catch(function(e) { console.warn('Failed initial loadFeed:', e); });
    }
    CHALLENGES_LB=Array.isArray(chRows)?chRows:[];
    SPECIAL_DAYS_LB=Array.isArray(sdRows)?sdRows.map(function(x){return x.special_date;}):[];
    var regs=regJsonData;
    var reg = Array.isArray(regs) ? (regs.find(function(r) { return r.event_id === EVENT_ROW.id; }) || regs[0] || {}) : {};
    LB_ME=reg;
    window._lbCurrentEventId = EVENT_ROW.id;
    window._lbRegisteredEventId = EVENT_ROW.id;
    var name=reg.full_name||s.name||'Participant';

    var initials = typeof get2Initials === 'function' ? get2Initials(name) : name.substring(0,2).toUpperCase();
    var styleFunc = typeof getWhoopAvatarStyle === 'function' ? getWhoopAvatarStyle : function() { return 'background:#282e36; border:2px solid #E8622A; color:#fff;'; };
    
    var avatarEl = document.getElementById('hdr-avatar');
    if (avatarEl) {
      avatarEl.textContent = initials;
      avatarEl.setAttribute('style', styleFunc(name) + '; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:13px; letter-spacing:0.5px;');
    }
    
    var youAvatarEl = document.getElementById('you-avatar');
    if (youAvatarEl) {
      youAvatarEl.textContent = initials;
      youAvatarEl.setAttribute('style', styleFunc(name) + '; width:84px; height:84px; border-radius:50%; font-size:28px; font-weight:800; display:flex; align-items:center; justify-content:center; letter-spacing:1px;');
    }
    var youNameEl=document.getElementById('you-name');if(youNameEl)youNameEl.textContent=name.toUpperCase();
    if(document.getElementById('you-emp-code'))document.getElementById('you-emp-code').textContent=reg.emp_code||'—';
    if(document.getElementById('you-email'))document.getElementById('you-email').textContent=reg.email||'—';
    if(document.getElementById('you-gender'))document.getElementById('you-gender').textContent=reg.gender||'—';
    if(document.getElementById('you-shift'))document.getElementById('you-shift').textContent=reg.shift||'—';
    if(document.getElementById('you-team'))document.getElementById('you-team').textContent=reg.leaderboard_team||'—';
    if(document.getElementById('you-tshirt'))document.getElementById('you-tshirt').textContent=reg.tshirt_size||'—';
    if(document.getElementById('you-project-lead'))document.getElementById('you-project-lead').textContent=reg.project_lead||'—';
    var allowPrivate = (typeof CONFIG_LB !== 'undefined' && CONFIG_LB.feed_config && CONFIG_LB.feed_config.rules && CONFIG_LB.feed_config.rules.allow_private_profiles !== undefined) ? CONFIG_LB.feed_config.rules.allow_private_profiles : true;
    var privateRow = document.getElementById('you-private-row');
    if (privateRow) {
      privateRow.style.display = allowPrivate ? 'flex' : 'none';
    }
    var privateToggle = document.getElementById('you-private-toggle');
    if (privateToggle) {
      privateToggle.checked = (reg.is_private === true || reg.is_private === 'true') && allowPrivate;
    }
    var stravaLink=document.getElementById('you-strava-link');
    if(stravaLink){var surl=reg.strava_profile_url||('https://www.strava.com/athletes/'+s.athleteId);stravaLink.href=surl;}

    // Load past events performance card
    if (typeof loadPastEventsPerformance === 'function') {
      loadPastEventsPerformance(reg, s.athleteId);
    }

    window.setStravaConnectedState = function(connectedAccountName) {
      var btn = document.getElementById('btn-strava-connect');
      var card = document.getElementById('strava-connected-card');
      var label = document.getElementById('connected-account-name-label');
      if (btn) btn.style.display = 'none';
      if (card) {
        card.style.display = 'flex';
        if (label) {
          label.textContent = connectedAccountName || (reg && reg.full_name) || 'Connected';
        }
      }
    };

    // Bind event listeners for Disconnect/Connect click interactions
    (function initStravaDisconnectBtn() {
      var btnConnect = document.getElementById('btn-strava-connect');
      var btnDisconnect = document.getElementById('btn-strava-disconnect-action');
      
      async function triggerDisconnect(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        
        var confirmDisconnect = confirm("This will stop syncing your activities from Strava. Your existing points and history will be kept. You can reconnect anytime.");
        if (!confirmDisconnect) return;

        var originalText = 'Disconnect';
        if (btnDisconnect) {
          btnDisconnect.style.pointerEvents = 'none';
          btnDisconnect.style.opacity = '0.7';
          originalText = btnDisconnect.textContent;
          btnDisconnect.textContent = 'Disconnecting...';
        }

        try {
          var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
          var res = await fetch(BACKEND + '/participant/disconnect-strava', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              athlete_id: athleteId,
              event_id: EVENT_ROW ? EVENT_ROW.id : 1
            })
          });
          var data = await res.json();
          if (data.success) {
            cacheClear(athleteId);
            window.isStravaConnected = false;
            
            // Revert DOM back to disconnected view
            var btn = document.getElementById('btn-strava-connect');
            var card = document.getElementById('strava-connected-card');
            if (card) card.style.display = 'none';
            if (btn) btn.style.display = 'block';
            
            if (btnDisconnect) {
              btnDisconnect.style.pointerEvents = 'auto';
              btnDisconnect.style.opacity = '1';
              btnDisconnect.textContent = originalText;
            }

            if (typeof updateInAppNotificationBanner === 'function') updateInAppNotificationBanner();
            if (typeof renderNotifications === 'function') renderNotifications();
          } else {
            throw new Error(data.error || 'Server error');
          }
        } catch (err) {
          alert("Failed to disconnect Strava: " + err.message);
          if (btnDisconnect) {
            btnDisconnect.style.pointerEvents = 'auto';
            btnDisconnect.style.opacity = '1';
            btnDisconnect.textContent = originalText;
          }
        }
      }

      if (btnDisconnect) {
        btnDisconnect.addEventListener('click', triggerDisconnect);
      }

      if (btnConnect) {
        btnConnect.onclick = null;
        btnConnect.removeAttribute('onclick');
        btnConnect.addEventListener('click', function(e) {
          window.handleStravaConnect(e);
        });
      }
    })();

    (async function() {
      var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
      if (!athleteId) return;
      try {
        var res = await fetch(BACKEND + '/check-authorized', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            athlete_id: athleteId,
            event_id: EVENT_ROW ? EVENT_ROW.id : 1
          })
        });
        var d = await res.json();
        if (d.success && d.authorized) {
          window.setStravaConnectedState(d.name);
          window.isStravaConnected = true;
        } else {
          window.isStravaConnected = false;
        }
        updateInAppNotificationBanner();
        renderNotifications();
      } catch (err) {
        console.warn('Silent connection check failed:', err);
      }
    })();

    window.handleStravaConnect = async function(e) {
      if (e) e.preventDefault();
      var btn = document.getElementById('btn-strava-connect');
      var msg = document.getElementById('strava-connect-msg');
      if (!btn) return;
      
      var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
      if (!athleteId) {
        alert('Employee data not loaded. Please log in again.');
        return;
      }
      
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';
      btn.innerHTML = 'Verifying connection status...';
      if (msg) msg.style.display = 'none';
      
      try {
        var res = await fetch(BACKEND + '/check-authorized', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            athlete_id: athleteId,
            event_id: EVENT_ROW ? EVENT_ROW.id : 1
          })
        });
        var d = await res.json();
        
        if (d.success && d.authorized) {
          window.setStravaConnectedState(d.name);
        } else {
          var CLIENT_ID = '29159';
          var REDIRECT = window.location.origin + window.location.pathname;
          var stateParam = EVENT_ROW ? EVENT_ROW.id : 1;
          window.location.href = 'https://www.strava.com/oauth/authorize?client_id=' + CLIENT_ID + 
            '&redirect_uri=' + encodeURIComponent(REDIRECT) + 
            '&response_type=code&scope=read,activity:read&state=' + stateParam;
        }
      } catch (err) {
        console.warn('Connection check failed:', err);
        if (msg) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(245, 158, 11, 0.08)';
          msg.style.borderColor = 'rgba(245, 158, 11, 0.2)';
          msg.style.color = '#f59e0b';
          msg.innerHTML = '⚠️ Connection check failed. Redirecting to Strava...';
        }
        setTimeout(function() {
          var CLIENT_ID = '29159';
          var REDIRECT = window.location.origin + window.location.pathname;
          window.location.href = 'https://www.strava.com/oauth/authorize?client_id=' + CLIENT_ID + 
            '&redirect_uri=' + encodeURIComponent(REDIRECT) + 
            '&response_type=code&scope=read,activity:read&state=walkathon2026';
        }, 1500);
      }
    };

    var icoMale='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="6"/><line x1="14.5" y1="9.5" x2="21" y2="3"/><polyline points="16 3 21 3 21 8"/></svg>';
    var icoFemale='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="6"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/></svg>';
    var icoClock='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    var icoTeam='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var tags=[];
    if(reg.gender)tags.push(reg.gender==='Female'?icoFemale+' Female':icoMale+' Male');
    if(reg.shift)tags.push(icoClock+' '+reg.shift);
    if(reg.leaderboard_team)tags.push(icoTeam+' '+reg.leaderboard_team);
    var tagHtml=tags.map(function(t){var sp=t.indexOf('</svg>');return sp>=0?'<span class="hero-tag">'+t.substring(0,sp+6)+' '+esc(t.substring(sp+6).trim())+'</span>':'<span class="hero-tag">'+esc(t)+'</span>';}).join('');
    var youTagsEl=document.getElementById('you-tags');if(youTagsEl)youTagsEl.innerHTML=tagHtml;

    (function(){
      var validA=myActs.filter(function(a){return !a.is_flagged;});
      var EVENT_START=new Date((EVENT_ROW && EVENT_ROW.start_date || '2026-06-01') + 'T00:00:00+05:30');
      var EVENT_END=new Date((EVENT_ROW && EVENT_ROW.end_date || '2026-06-30') + 'T23:59:59+05:30');
      var nowD=new Date();
      var totalEventDays=Math.round((Math.min(nowD,EVENT_END)-EVENT_START)/86400000)+1;
      var activeDaysSet={};
      validA.forEach(function(a){var d=getActDate(a);if(d)activeDaysSet[d]=true;});
      var activeDayCount=Object.keys(activeDaysSet).length;
      var consistPct=totalEventDays>0?Math.round((activeDayCount/totalEventDays)*100):0;
      var ade=document.getElementById('you-active-days');if(ade)ade.textContent=activeDayCount;
      var ede=document.getElementById('you-event-days');if(ede)ede.textContent='of '+totalEventDays+' event days';
      var cpe=document.getElementById('you-consistency');if(cpe)cpe.textContent=consistPct+'%';
      var cfe=document.getElementById('you-consist-fill');if(cfe)setTimeout(function(){cfe.style.width=consistPct+'%';},100);

      setTimeout(function(){
        var curS=document.getElementById('streak-num');
        var bestS=document.getElementById('streak-best-val');
        var ycs=document.getElementById('you-cur-streak');
        var ybs=document.getElementById('you-best-streak');
        if(ycs&&curS) {
          var val = (curS.textContent||'0').replace('🔥','').trim();
          ycs.textContent = val + ' Days';
        }
        if(ybs&&bestS) {
          var val = (bestS.textContent||'0').trim();
          ybs.textContent = val + ' Days';
        }
      },500);

      var fullP=calcFullPts(validA,reg.gender,reg.shift);
      var myPtsNow=fullP.total;
      var daysElapsed=Math.max(1,(nowD-EVENT_START)/86400000);
      var daysLeft=Math.max(0,Math.ceil((EVENT_END-nowD)/86400000));
      var avgPtDay=myPtsNow/daysElapsed;
      var projPts=myPtsNow+(avgPtDay*daysLeft);
      var predIco,predTitle,predSub;
      var activeMilestones = resolveEventMilestones(EVENT_ROW, reg.gender);
      var bT = activeMilestones.bronze.thresh;
      var sT = activeMilestones.silver.thresh;
      var gT = activeMilestones.gold.thresh;
      
      var bL = activeMilestones.bronze.label;
      var sL = activeMilestones.silver.label;
      var gL = activeMilestones.gold.label;

      var topMotivation=[
        'You\'re a legend — can you crack Top 3? 🏆',
        'Elite level achieved! Eyes on the podium 👀',
        'Achievement secured — now chase the #1 spot! 🥇',
        'You\'re unstoppable — keep pushing for glory! 💪',
        'Champion energy! The Top 3 is within reach 🚀',
        'All milestones unlocked — now go for the win! 🔥'
      ];
      if(myPtsNow>=gT){predIco='🏆';predTitle='All Achievements Achieved!';predSub=topMotivation[Math.floor(Math.random()*topMotivation.length)];}
      else if(projPts>=gT){predIco='🥇';predTitle='On track for ' + gL;predSub='Projected ~'+Math.round(projPts)+' pts at current pace';}
      else if(projPts>=sT){predIco='🥈';predTitle='On track for ' + sL;predSub='Need '+(Math.round(gT-projPts))+' more pts to reach ' + gL;}
      else if(projPts>=bT){predIco='🥉';predTitle='On track for ' + bL;predSub='Walk '+(daysLeft>0?((sT-myPtsNow)/daysLeft).toFixed(1):0)+' km/day to reach ' + sL;}
      else{predIco='🏃';predTitle='Keep going!';predSub='Walk '+(daysLeft>0?((bT-myPtsNow)/daysLeft).toFixed(1):0)+' km/day to reach ' + bL;}
      var pico=document.getElementById('you-medal-pred-ico');if(pico)pico.textContent=predIco;
      var ptit=document.getElementById('you-medal-pred-title');if(ptit)ptit.textContent=predTitle;
      var psub=document.getElementById('you-medal-pred-sub');if(psub)psub.textContent=predSub;

      (function(){
        var grid=document.getElementById('heatmap-grid');
        if(!grid)return;
        var dayKmMap={};
        validA.forEach(function(a){
          var d=getActDate(a);
          if(d)dayKmMap[d]=(dayKmMap[d]||0)+parseFloat(a.distance_meters||0)/1000;
        });
        var todayStr=new Date().toISOString().split('T')[0];
        grid.innerHTML='';
        var eventDaysCount = Math.round((EVENT_END - EVENT_START) / 86400000);
        for(var d=1;d<=eventDaysCount;d++){
          var currentDayDate = new Date(EVENT_START.getTime() + (d - 1) * 24 * 60 * 60 * 1000);
          var y = currentDayDate.getFullYear();
          var m = String(currentDayDate.getMonth() + 1).padStart(2, '0');
          var dayVal = String(currentDayDate.getDate()).padStart(2, '0');
          var ds = y + '-' + m + '-' + dayVal;
          var cell=document.createElement('div');
          cell.className='hm-day';
          var km=dayKmMap[ds]||0;
          cell.title=ds+(km>0?' · '+km.toFixed(1)+' km':'');
          cell.textContent=currentDayDate.getDate();
          if(ds>todayStr){cell.classList.add('future');}
          else if(km>=21){cell.classList.add('km-21');}
          else if(km>=15){cell.classList.add('km-15');}
          else if(km>=10){cell.classList.add('km-10');}
          else if(km>=8){cell.classList.add('km-8');}
          else if(km>=5){cell.classList.add('km-5');}
          else{cell.classList.add('rest');}
          if(ds===todayStr)cell.classList.add('today');
          grid.appendChild(cell);
        }
      })();

      var synced=document.getElementById('you-synced-acts');if(synced)synced.textContent=myActs.length;
      var sortedActs=validA.slice().sort(function(a,b){return (b.activity_date||'').localeCompare(a.activity_date||'');});
      var lastAct=sortedActs.length?sortedActs[0]:null;
      var ylse=document.getElementById('you-last-sync');
      var ylsd=document.getElementById('you-last-sync-date');
      if(lastAct){
        var ld=new Date(lastAct.activity_date);
        var diffD=Math.floor((nowD-ld)/86400000);
        var diffLabel=diffD===0?'Today':diffD===1?'Yesterday':diffD+' days ago';
        if(ylse)ylse.textContent=diffLabel;
        if(ylsd)ylsd.textContent=ld.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      } else {
        if(ylse)ylse.textContent='—';
      }
    })();

    var fullPts=calcFullPts(myActs,reg.gender,reg.shift);
    var validCount=myActs.filter(function(a){return !a.is_flagged;}).length;
    safeSetText('s-dist', Math.round(fullPts.km));
    safeSetText('s-acts', validCount);
    safeSetText('s-pts-dist', fullPts.distPts.toFixed(1)+' pts');
    safeSetText('s-pts-milestone', fullPts.bonusPts.toFixed(1)+' pts');
    safeSetText('s-pts-challenge', fullPts.challengePts.toFixed(1)+' pts');
    safeSetText('s-pts-total', fullPts.total.toFixed(1)+' pts');

    var validActs=myActs.filter(function(a){return !a.is_flagged;});
    var totalMovingSec=validActs.reduce(function(s,a){return s+(a.moving_time_seconds||0);},0);
    var totalDistM=validActs.reduce(function(s,a){return s+(a.distance_meters||0);},0);
    var avgPaceStr='—';
    if(totalDistM>0){var psk=totalMovingSec/(totalDistM/1000),pmin=Math.floor(psk/60),psec=Math.round(psk%60);avgPaceStr=pmin+':'+(psec<10?'0':'')+psec;}
    safeSetText('s-pace', avgPaceStr);
    var mts='—';if(totalMovingSec>0){var mh=Math.floor(totalMovingSec/3600),mm=Math.floor((totalMovingSec%3600)/60);mts=mh>0?mh+'h '+mm+'m':mm+'m';}
    safeSetText('s-movetime', mts);
    safeSetText('s-movetime-dash', mts);

    // Personal Bests
    (function(){
      var maxDistM = 0;
      var maxTimeSec = 0;
      var maxSpeed = 0;
      var bestPaceSport = 'Walk';
      var dayKm = {};

      var longestAct = null;
      var bestPaceAct = null;
      var longestSessionAct = null;
      var maxElevationAct = null;
      var maxSpeedAct = null;
      var maxElevation = 0;
      var maxAvgSpeed = 0;

      validActs.forEach(function(a){
        var km = (a.distance_meters || 0) / 1000;
        if (a.distance_meters > maxDistM) {
          maxDistM = a.distance_meters;
          longestAct = a;
        }
        if (a.moving_time_seconds > maxTimeSec) {
          maxTimeSec = a.moving_time_seconds;
          longestSessionAct = a;
        }
        
        var t = a.sport_type;
        var isWalkRun = t === 'Walk' || t === 'Run' || t === 'VirtualRun' || t === 'Hike';
        if (isWalkRun && a.avg_speed > maxSpeed && a.avg_speed < 12) {
          maxSpeed = a.avg_speed;
          bestPaceSport = t;
          bestPaceAct = a;
        }

        var elev = parseFloat(a.elevation_gain) || 0;
        if (elev > maxElevation) {
          maxElevation = elev;
          maxElevationAct = a;
        }

        var speed = parseFloat(a.avg_speed) || 0;
        if (speed > maxAvgSpeed) {
          maxAvgSpeed = speed;
          maxSpeedAct = a;
        }

        var d = getActDate(a);
        if (d) dayKm[d] = (dayKm[d] || 0) + km;
      });

      var maxDayKm = 0;
      var bestDayDate = '';
      Object.keys(dayKm).forEach(function(d){
        if (dayKm[d] > maxDayKm) {
          maxDayKm = dayKm[d];
          bestDayDate = d;
        }
      });

      // ─── Render Personal Bests Dynamically ───
      (function() {
        var grid = document.getElementById('pb-grid-container');
        if (!grid) return;
        
        var pbConfig = (EVENT_ROW && EVENT_ROW.rules_config && EVENT_ROW.rules_config.dashboard && EVENT_ROW.rules_config.dashboard.personal_bests) ? EVENT_ROW.rules_config.dashboard.personal_bests : {
          longest_activity: true,
          best_pace: true,
          longest_session: true,
          best_day: true
        };
        
        // Find total elevation
        var totalElevation = validActs.reduce(function(sum, a) { return sum + (parseFloat(a.elevation_gain) || 0); }, 0);
        
        var statDefs = {
          longest_activity: {
            label: 'Longest Activity',
            sub: 'single session max',
            color: '#ffae00',
            bg: 'rgba(255, 174, 0, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l4-8 4 4 4-8 4 8"/></svg>',
            val: maxDistM > 0 ? (maxDistM / 1000).toFixed(2) + ' km' : '—'
          },
          best_pace: {
            label: 'Best Pace',
            sub: 'min/km · walk/run',
            color: 'var(--brand)',
            bg: 'rgba(232, 98, 42, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            val: maxSpeed > 0 ? fmtPS(maxSpeed, bestPaceSport) : '—'
          },
          longest_session: {
            label: 'Longest Session',
            sub: 'longest moving duration',
            color: 'var(--blue)',
            bg: 'rgba(96, 165, 250, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            val: maxTimeSec > 0 ? fmtDur(maxTimeSec) : '—'
          },
          best_day: {
            label: 'Best Day',
            sub: (function() {
              if (maxDayKm > 0 && bestDayDate) {
                var dObj = new Date(bestDayDate + 'T00:00:00');
                return 'daily max · ' + dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              }
              return 'daily max';
            })(),
            color: 'var(--green)',
            bg: 'rgba(34, 197, 94, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            val: maxDayKm > 0 ? maxDayKm.toFixed(2) + ' km' : '—'
          },
          max_elevation: {
            label: 'Max Elevation Gain',
            sub: 'single session max',
            color: '#8b5cf6',
            bg: 'rgba(139, 92, 246, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
            val: maxElevation > 0 ? maxElevation.toFixed(0) + ' m' : '—'
          },
          max_speed: {
            label: 'Max Avg Speed',
            sub: 'single session max',
            color: '#ec4899',
            bg: 'rgba(236, 72, 153, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/></svg>',
            val: maxAvgSpeed > 0 ? (maxAvgSpeed * 3.6).toFixed(1) + ' km/h' : '—'
          },
          total_distance: {
            label: 'Total Distance',
            sub: 'overall event distance',
            color: '#3b82f6',
            bg: 'rgba(59, 130, 246, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>',
            val: totalDistM > 0 ? (totalDistM / 1000).toFixed(1) + ' km' : '—'
          },
          total_elevation: {
            label: 'Total Elevation',
            sub: 'overall elevation gain',
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22l-4-4h8l-4 4zM12 2l-4 4h8l-4-4z"/></svg>',
            val: totalElevation > 0 ? totalElevation.toFixed(0) + ' m' : '—'
          },
          total_activities: {
            label: 'Total Activities',
            sub: 'sync\'d sessions',
            color: '#64748b',
            bg: 'rgba(100, 116, 139, 0.12)',
            svg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
            val: validActs.length + ' acts'
          }
        };
        
        var html = '';
        var keys = ['longest_activity', 'best_pace', 'longest_session', 'best_day', 'max_elevation', 'max_speed', 'total_distance', 'total_elevation', 'total_activities'];
        keys.forEach(function(key) {
          if (pbConfig[key] !== false) {
            var d = statDefs[key];
            var clickAttr = '';
             if (key === 'longest_activity' && longestAct) {
               clickAttr = ' onclick="openActivityDetail(\'' + (longestAct.strava_activity_id || longestAct.id) + '\', event, ' + (longestAct.strava_activity_id ? 'true' : 'false') + ')"';
             } else if (key === 'best_pace' && bestPaceAct) {
               clickAttr = ' onclick="openActivityDetail(\'' + (bestPaceAct.strava_activity_id || bestPaceAct.id) + '\', event, ' + (bestPaceAct.strava_activity_id ? 'true' : 'false') + ')"';
             } else if (key === 'longest_session' && longestSessionAct) {
               clickAttr = ' onclick="openActivityDetail(\'' + (longestSessionAct.strava_activity_id || longestSessionAct.id) + '\', event, ' + (longestSessionAct.strava_activity_id ? 'true' : 'false') + ')"';
             } else if (key === 'max_elevation' && maxElevationAct) {
               clickAttr = ' onclick="openActivityDetail(\'' + (maxElevationAct.strava_activity_id || maxElevationAct.id) + '\', event, ' + (maxElevationAct.strava_activity_id ? 'true' : 'false') + ')"';
             } else if (key === 'max_speed' && maxSpeedAct) {
               clickAttr = ' onclick="openActivityDetail(\'' + (maxSpeedAct.strava_activity_id || maxSpeedAct.id) + '\', event, ' + (maxSpeedAct.strava_activity_id ? 'true' : 'false') + ')"';
             } else if (key === 'best_day' && bestDayDate) {
              clickAttr = ' onclick="showDateDetails(\'' + bestDayDate + '\')"';
            }

            var styleAttr = clickAttr ? ' style="cursor: pointer;"' : '';
            html += '<div class="pb-card"' + clickAttr + styleAttr + '>' +
              '<div class="pb-card-left">' +
                '<div class="pb-card-header">' +
                  '<div class="pb-card-icon" style="background: ' + d.bg + '; color: ' + d.color + ';">' +
                    d.svg +
                  '</div>' +
                  '<div class="pb-card-label">' + d.label + '</div>' +
                '</div>' +
                '<div class="pb-card-sub">' + d.sub + '</div>' +
              '</div>' +
              '<div class="pb-card-val" style="color: ' + d.color + ';">' + d.val + '</div>' +
            '</div>';
          }
        });
        
        grid.innerHTML = html || '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 20px; grid-column: 1/-1;">No personal bests enabled for this event.</div>';
      })();

      var typeCounts = {};
      validActs.forEach(function(a){
        var t = a.sport_type || 'Other';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
      var bdEl = document.getElementById('act-type-breakdown');
      if (bdEl) {
        if (Object.keys(typeCounts).length === 0) {
          bdEl.style.display = 'none';
        } else {
          var bgColors = { Walk: 'rgba(34,197,94,0.12)', Run: 'rgba(96,165,250,0.12)', VirtualRun: 'rgba(96,165,250,0.12)', Hike: 'rgba(168,85,247,0.12)', Ride: 'rgba(244,63,94,0.12)' };
          var textColors = { Walk: 'var(--green)', Run: 'var(--blue)', VirtualRun: 'var(--blue)', Hike: '#c084fc', Ride: '#f43f5e' };
          bdEl.style.display = 'flex';
          bdEl.innerHTML = Object.keys(typeCounts).map(function(type){
            var count = typeCounts[type];
            var bg = bgColors[type] || 'rgba(255,255,255,0.08)';
            var fg = textColors[type] || 'var(--muted)';
            return '<span style="font-size:11px;font-weight:700;color:' + fg + ';background:' + bg + ';padding:5px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;margin-right:8px;margin-bottom:8px;">' + type + ' · ' + count + '</span>';
          }).join('');
        }
      }
    })();

    // India City Facts
    (function(){
      var totalKm=totalDistM/1000;
      var routes=[
        {km:6,label:'Connaught Place → India Gate'},
        {km:13,label:'Delhi Airport → Connaught Place'},
        {km:25,label:'Delhi → Gurgaon'},
        {km:65,label:'Delhi → Alwar'},
        {km:120,label:'Delhi → Agra (halfway)'},
        {km:233,label:'Delhi → Jaipur'},
        {km:500,label:'Delhi → Lucknow'},
        {km:820,label:'Delhi → Mumbai (quarter)'},
        {km:1400,label:'Delhi → Chennai'}
      ];
      var eq=routes[0];
      for(var ri=0;ri<routes.length;ri++){if(totalKm>=routes[ri].km)eq=routes[ri];}
      var eqEl=document.getElementById('fact-dist-eq');
      if(eqEl)eqEl.textContent=eq.label;
      var cal=Math.round(totalKm*60);
      var calEl=document.getElementById('fact-cal');
      if(calEl)calEl.textContent=cal>=1000?(cal/1000).toFixed(1)+'k kcal':cal+' kcal';
      var steps=Math.round(totalKm*1350);
      var stEl=document.getElementById('fact-steps');
      if(stEl)stEl.textContent=steps>=1000?Math.round(steps/1000)+'k steps':steps+' steps';
      var co2=(totalKm*0.21).toFixed(1);
      var coEl=document.getElementById('fact-carbon');
      if(coEl)coEl.textContent=co2+' kg';
    })();

    // Milestones
    (function(){
      var validA=myActs.filter(function(a){return !a.is_flagged;});
      var totalKm=totalDistM/1000;
      var hasAny=validA.length>0;
      var longestKm=validA.reduce(function(mx,a){return Math.max(mx,(a.distance_meters||0)/1000);},0);
      var earlyBird=validA.some(function(a){var h=new Date(a.activity_date).getHours();return h<6;});
      var streakEl=document.getElementById('streak-num');
      var bestStreakEl=document.getElementById('streak-best-val');
      var bestStreak=bestStreakEl?parseInt(bestStreakEl.textContent)||0:0;
      var ms=[
        {id:'ms-first', earned:hasAny},
        {id:'ms-50km',  earned:totalKm>=50},
        {id:'ms-100km', earned:totalKm>=100},
        {id:'ms-200km', earned:totalKm>=200},
        {id:'ms-streak7',earned:bestStreak>=7},
        {id:'ms-longact',earned:longestKm>=20},
        {id:'ms-earlybird',earned:earlyBird}
      ];
      ms.forEach(function(m){
        var el=document.getElementById(m.id);
        if(el&&m.earned)el.classList.add('earned');
      });
    })();

    var activeMilestones = resolveEventMilestones(EVENT_ROW, reg.gender);
    var bronzeThresh = activeMilestones.bronze.thresh;
    var silverThresh = activeMilestones.silver.thresh;
    var goldThresh = activeMilestones.gold.thresh;
    
    var bronzeLabel = activeMilestones.bronze.label;
    var silverLabel = activeMilestones.silver.label;
    var goldLabel = activeMilestones.gold.label;

    var myPts = fullPts.total;
    var sptEl = document.getElementById('s-pts-display');if(sptEl)sptEl.textContent=myPts.toFixed(2);

    // Medal Progress Rings
    var CIRC=270.2;
    _ringAnimationData = [];
    [{id:'br',thresh:bronzeThresh,lbl:bronzeLabel},{id:'si',thresh:silverThresh,lbl:silverLabel},{id:'go',thresh:goldThresh,lbl:goldLabel}].forEach(function(m){
      var done=myPts>=m.thresh;
      var rawPct=(myPts/m.thresh)*100;
      var needed=Math.max(0,m.thresh-myPts);
      var displayPct=done?100:Math.min(99,Math.floor(rawPct));
      var arcPct=done?100:Math.min(96,rawPct);
      var offset=CIRC-(CIRC*arcPct/100);
      
      var fillEl=document.getElementById('ring-fill-'+m.id);
      var pctEl=document.getElementById('ring-pct-'+m.id);
      var needEl=document.getElementById('ring-need-'+m.id);
      
      var nameEl=document.querySelector('.ring-name.'+m.id);
      if(nameEl)nameEl.textContent=m.lbl;
      
      if (fillEl && pctEl) {
        _ringAnimationData.push({
          fillEl: fillEl,
          pctEl: pctEl,
          offset: done ? 0 : offset,
          displayPct: displayPct
        });
      }
      
      if(needEl){
        if(done){needEl.textContent='✓ Achieved';needEl.style.color='var(--green)';}
        else{needEl.textContent='Need '+needed.toFixed(0)+' pts';needEl.style.color='#ffffff';}
      }
    });
    triggerRingAnimation();

    (function() {
      var todayStr = new Date().toISOString().split('T')[0];
      var iKey = 'insight_' + todayStr;
      var emoji, title, body;
      if (myPts >= goldThresh) {
        emoji = '🥇'; title = goldLabel + ' Achieved!';
        body = 'Outstanding! You\'ve crossed the ' + goldLabel + ' threshold with ' + myPts.toFixed(0) + ' pts. Keep it up!';
      } else if (myPts >= silverThresh) {
        var need = (goldThresh - myPts).toFixed(0);
        emoji = '🥈'; title = silverLabel + ' — ' + goldLabel + ' is close!';
        body = 'You need just ' + need + ' more pts to unlock ' + goldLabel + '. Push a little harder!';
      } else if (myPts >= bronzeThresh) {
        var need = (silverThresh - myPts).toFixed(0);
        emoji = '🥉'; title = bronzeLabel + ' Achieved!';
        body = 'Great start! ' + need + ' pts more gets you ' + silverLabel + '. Keep walking!';
      } else {
        var need = (bronzeThresh - myPts).toFixed(0);
        emoji = '🏃'; title = 'On your way to ' + bronzeLabel + '!';
        body = 'Walk ' + need + ' more pts to earn your ' + bronzeLabel + '. You can do it!';
      }
      _activeInsight = { key: iKey, emoji: emoji, title: title, body: body };
      updateInAppNotificationBanner();
    })();

    // ── Phase 2: Load ranking data in background ────────────────────
    (async function loadRanking(){
      function applyPrecomputedLBScores(summaries) {
        LB_REG = summaries.map(function(s) {
          return {
            strava_athlete_id: s.athlete_id,
            full_name: s.full_name,
            gender: s.gender,
            shift: s.shift,
            leaderboard_team: s.leaderboard_team
          };
        });
        
        LB_SCORES = {};
        LB_OLD_SCORES = {};
        
        summaries.forEach(function(s) {
          var aid = String(s.athlete_id);
          LB_SCORES[aid] = {
            total: parseFloat(s.total_points || 0),
            km: parseFloat(s.total_distance_km || 0),
            distPts: parseFloat(s.base_points || 0),
            bonusPts: parseFloat(s.bonus_points || 0),
            challengePts: parseFloat(s.challenge_points || 0)
          };
          LB_OLD_SCORES[aid] = parseFloat(s.total_points || s.old_total_points || 0);
        });
        
        _lbReady = true;
        if (typeof lbRender === 'function') lbRender();
        if (typeof renderFeedHighlights === 'function') renderFeedHighlights();
        if (typeof renderCommunityPulse === 'function') renderCommunityPulse();
        if (typeof renderStanding === 'function') renderStanding();
      }

      async function refreshRankingData() {
        try {
          var sumRes = await fetch(SUPABASE_URL + '/rest/v1/athlete_points_summary?event_id=eq.' + EVENT_ROW.id + '&order=total_points.desc', { headers: HDR });
          var summaries = await sumRes.json();
          if (Array.isArray(summaries) && summaries.length > 0) {
            console.log('[Cache] Pre-computed ranking retrieved from Supabase ✓');
            cacheSet('ranking_summaries', summaries);
            applyPrecomputedLBScores(summaries);
            return;
          }
        } catch (err) {
          console.warn('[Cache] Pre-computed points fetch failed, falling back to legacy:', err);
        }

        try {
          var fetched = await Promise.all([
            fetchAllParallel(SUPABASE_URL+'/rest/v1/activities?event_id=eq.'+EVENT_ROW.id+'&is_deleted=eq.false&created_at=lt.'+getEventCutoffUTC()+'&activity_date=gte.'+getEventUTCStart()+'&activity_date=lte.'+getEventUTCEnd()+'&order=id.asc&select=id,strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist'),
            fetchAllParallel(SUPABASE_URL+'/rest/v1/registration?event_id=eq.'+EVENT_ROW.id+'&order=strava_athlete_id.asc&select=strava_athlete_id,full_name,gender,shift,leaderboard_team')
          ]);
          allActsRaw = fetched[0]; cacheSet('ranking_acts_v4', allActsRaw);
          allRegRaw  = fetched[1]; cacheSet('ranking_reg',  allRegRaw);
          allActs = allActsRaw; allRegRes = allRegRaw;
          
          var isViewingCustomLb = window._lbCurrentEventId && window._lbCurrentEventId !== window._lbRegisteredEventId;
          if (!isViewingCustomLb) {
            LB_REG = allRegRaw;
            LB_ACTS = allActsRaw;
            precomputeLBScores();
            if(LB_ME){_lbReady=true; if(typeof lbRender === 'function') lbRender();}
          }
          if (typeof renderFeedHighlights === 'function') renderFeedHighlights();
          if (typeof renderCommunityPulse === 'function') renderCommunityPulse();
          if (typeof renderStanding === 'function') renderStanding();
        } catch (legacyErr) {
          console.error('[Cache] Legacy fallback loading failed:', legacyErr);
        }
      }

      try{
        var _cachedSummaries = cacheGet('ranking_summaries', CACHE_TTL.ranking);
        if (_cachedSummaries) {
          console.log('[Cache] Serving pre-computed ranking from cache ✓');
          applyPrecomputedLBScores(_cachedSummaries);
          if (!isBackgroundRefresh) {
            setTimeout(refreshRankingData, 500);
          }
          return;
        }

        var _cachedRankActs = cacheGet('ranking_acts_v4', CACHE_TTL.ranking);
        var _cachedRankReg  = cacheGet('ranking_reg',  CACHE_TTL.ranking);
        if (_cachedRankActs && _cachedRankReg) {
          console.log('[Cache] Serving legacy ranking from cache ✓');
          allActsRaw = _cachedRankActs;
          allRegRaw  = _cachedRankReg;
          if (!isBackgroundRefresh) {
            setTimeout(refreshRankingData, 500);
          }
        } else {
          console.log('[Cache] Cache miss — fetching ranking data...');
          await refreshRankingData();
        }
      }catch(e2){console.warn('Ranking load failed:',e2);return;}
    })();

    // Pace Goals Card
    var now=new Date();
    var EVENT_END=new Date((EVENT_ROW && EVENT_ROW.end_date || '2026-06-30') + 'T23:59:59+05:30');
    var daysLeft=Math.max(0,Math.ceil((EVENT_END-now)/(1000*60*60*24)));
    var todayStr=getISTDate(now.toISOString());
    var todayKm=myActs.filter(function(a){return !a.is_flagged;}).reduce(function(s,a){return getActDate(a)===todayStr?s+(a.distance_meters||0)/1000:s;},0);
    var bonusTiers=[[5,1],[8,2],[10,3],[15,4],[21,7]],nextTier=null;
    for(var ti=0;ti<bonusTiers.length;ti++){if(todayKm<bonusTiers[ti][0]){nextTier=bonusTiers[ti];break;}}

    var QUOTES={
      t5:['Unstoppable. Keep the hammer down.','Built different. Prove it every day.','Relentless. That\'s your identity now.'],
      t10:['You\'re in a different league. Stay there.','Elite pace. Own it.','Almost untouchable. Stay consistent.'],
      t25:['The top is within reach. Attack it.','You\'re dangerous. Don\'t slow down.','Strong pace. One push to the podium.'],
      t50:['Stay hungry. The podium isn\'t far.','You\'re ahead of half the field. Finish strong.','Momentum is everything. Don\'t break it.'],
      b50:['The gap is closeable. Every km counts.','Every step forward counts. Keep moving.','The comeback starts today. Go.']
    };
    function pickQuote(tier){var arr=QUOTES[tier];return arr[Math.floor(Math.random()*arr.length)];}

    function paceRow(iconBg,icon,mainText,subText,valText,valColor){
      var d=document.createElement('div');d.className='pace-row';
      d.innerHTML='<div class="pace-icon" style="background:'+iconBg+'">'+icon+'</div>'+
        '<div class="pace-text"><div class="pace-main">'+mainText+'</div><div class="pace-sub">'+subText+'</div></div>'+
        '<div class="pace-val" style="color:'+valColor+'">'+valText+'</div>';
      return d;
    }

    var paceCard=document.getElementById('pace-card');
    if(paceCard){
      paceCard.innerHTML='';

      if(myPts>=goldThresh){
        var daysElapsed=Math.max(1,(now-new Date((EVENT_ROW && EVENT_ROW.start_date || '2026-06-01') + 'T00:00:00+05:30'))/86400000);
        var avgKmDay=fullPts.km/daysElapsed;
        var goldActsMap={};
        allActs.forEach(function(a){if(!goldActsMap[a.strava_athlete_id])goldActsMap[a.strava_athlete_id]=[];goldActsMap[a.strava_athlete_id].push(a);});
        var myShiftN = (reg.shift || '').toLowerCase();
        var isNight = myShiftN.indexOf('night') > -1;
        var myGenderN = (reg.gender || '').toLowerCase();
        var isFemale = myGenderN === 'female' || myGenderN === 'f';
        var shiftPeersG=allRegRes.filter(function(p){var pg=(p.gender||'').toLowerCase(),ps=(p.shift||'').toLowerCase();return(ps.indexOf('night')>-1)===isNight&&(pg==='female')===isFemale;});
        var shiftScoredG=shiftPeersG.map(function(p){var km=0;(goldActsMap[p.strava_athlete_id]||[]).forEach(function(a){km+=(a.distance_meters||0)/1000;});return{id:p.strava_athlete_id,name:p.full_name,km:km};}).sort(function(a,b){return b.km-a.km;});
        var myRankG=shiftScoredG.findIndex(function(x){return String(x.id)===String(athleteId);})+1;
        var totalG=shiftScoredG.length;
        var pctRank=totalG>0?myRankG/totalG:0.5;
        var quoteTier=pctRank<=0.05?'t5':pctRank<=0.10?'t10':pctRank<=0.25?'t25':pctRank<=0.50?'t50':'b50';
        var quote=pickQuote(quoteTier);
        var personAbove=myRankG>1?shiftScoredG[myRankG-2]:null;
        var projectedPts=(myPts+(avgKmDay*daysLeft)).toFixed(0);

        var div=document.createElement('div');div.className='gold-card';
        div.innerHTML=
          '<div class="gold-top">'+
            '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
            '<div><div class="gold-title">Gold Achieved!</div>'+
            '<div class="gold-sub">Rank #'+myRankG+' of '+totalG+' in your category</div></div>'+
          '</div>'+
          '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+quote+'&rdquo;</div></div>'+
          '<div class="gold-stats">'+
            '<div class="gold-stat"><div class="gold-stat-val">'+avgKmDay.toFixed(1)+' km</div><div class="gold-stat-lbl">Daily avg</div></div>'+
            '<div class="gold-stat"><div class="gold-stat-val" style="color:var(--gold)">~'+projectedPts+' pts</div><div class="gold-stat-lbl">Projected finish</div></div>'+
          '</div>'+
          (personAbove?
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                '<div class="gold-rival-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Overtake #'+(myRankG-1)+': '+esc(personAbove.name)+'</div>'+
                '<div class="gold-rival-sub">'+daysLeft+' days left · keep pushing</div>'+
              '</div>'+
            '</div>'
          :
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                '<div class="gold-rival-label">🏆 You\'re #1 — lead to the finish!</div>'+
                '<div class="gold-rival-sub">Defend your spot for '+daysLeft+' more days</div>'+
              '</div>'+
            '</div>'
          );
        paceCard.appendChild(div);
      } else {
        var daysElapsed2=Math.max(1,(now-new Date((EVENT_ROW && EVENT_ROW.start_date || '2026-06-01') + 'T00:00:00+05:30'))/86400000);
        var avgKmDay2=fullPts.km/daysElapsed2;
        var projectedPts2=(myPts+(avgKmDay2*daysLeft)).toFixed(0);
        var icoCalPace='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        var icoBronze='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4A84A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoSilver='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoGold='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoPaceBolt='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        var icoPaceChk='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        if(myPts>=silverThresh){
          var SQUOTES=['Silver secured! Gold is the last frontier — you can do this.','Silver is yours! One final push to Gold. You\'re so close.','Amazing effort! Silver achieved. Gold is within your reach.'];
          var sq=SQUOTES[Math.floor(Math.random()*SQUOTES.length)];
          var sdiv=document.createElement('div');sdiv.className='gold-card';
          sdiv.style.borderLeft='3px solid #C8D8E8';
          sdiv.innerHTML=
            '<div class="gold-top">'+
              '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
              '<div><div class="gold-title" style="color:#C8D8E8">Silver Achieved!</div>'+
              '<div class="gold-sub">'+myPts.toFixed(2)+' pts · ~'+projectedPts2+' pts projected</div></div>'+
            '</div>'+
            '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+sq+'&rdquo;</div></div>';
          paceCard.appendChild(sdiv);
        } else if(myPts>=bronzeThresh){
          var BQUOTES=['You earned Bronze! Silver is within reach — keep going.','Bronze locked in. Now aim higher. Silver is closer than you think.','Great start! Bronze is yours. Push for Silver next.'];
          var bq=BQUOTES[Math.floor(Math.random()*BQUOTES.length)];
          var bdiv=document.createElement('div');bdiv.className='gold-card';
          bdiv.style.borderLeft='3px solid #F4A84A';
          bdiv.innerHTML=
            '<div class="gold-top">'+
              '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4A84A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
              '<div><div class="gold-title" style="color:#F4A84A">Bronze Achieved!</div>'+
              '<div class="gold-sub">'+myPts.toFixed(2)+' pts · ~'+projectedPts2+' pts projected</div></div>'+
            '</div>'+
            '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+bq+'&rdquo;</div></div>';
          paceCard.appendChild(bdiv);
        }

        paceCard.appendChild(paceRow('rgba(96,165,250,0.12)',icoCalPace,daysLeft+' days remaining','Event ends July 1','Jul 1','var(--muted)'));

        if(myPts<bronzeThresh){
          var brN=Math.max(0,bronzeThresh-myPts),brK=daysLeft>0?(brN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(244,168,74,0.12)',icoBronze,'Walk '+brK.toFixed(1)+' km/day for Bronze','Need '+brN.toFixed(1)+' pts in '+daysLeft+' days',brK.toFixed(1)+' km','#F4A84A'));
          var siN=Math.max(0,silverThresh-myPts),siK=daysLeft>0?(siN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(200,216,232,0.12)',icoSilver,'Walk '+siK.toFixed(1)+' km/day for Silver','Need '+siN.toFixed(1)+' pts in '+daysLeft+' days',siK.toFixed(1)+' km','var(--silver)'));
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        } else if(myPts<silverThresh){
          var siN=Math.max(0,silverThresh-myPts),siK=daysLeft>0?(siN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(200,216,232,0.12)',icoSilver,'Walk '+siK.toFixed(1)+' km/day for Silver','Need '+siN.toFixed(1)+' pts in '+daysLeft+' days',siK.toFixed(1)+' km','var(--silver)'));
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        } else {
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        }

        if(nextTier){
          paceCard.appendChild(paceRow('rgba(96,165,250,0.12)',icoPaceBolt,'Walk '+(nextTier[0]-todayKm).toFixed(1)+' km more today for bonus','Today: '+todayKm.toFixed(1)+' km so far','+'+nextTier[1]+' pt','var(--blue)'));
        } else {
          paceCard.appendChild(paceRow('rgba(34,197,94,0.12)',icoPaceChk,'Max daily bonus earned!',todayKm.toFixed(1)+' km today','+7 pts','var(--green)'));
        }
      }
    }

    // Recovery Suggestions
    (function(){
      var validActs=myActs.filter(function(a){return !a.is_flagged;});
      if(!validActs.length)return;
      var sortedDates=validActs.map(function(a){return getActDate(a);}).filter(Boolean).sort();
      var lastDate=sortedDates[sortedDates.length-1];
      if(!lastDate)return;
      var nowD=new Date(); nowD.setHours(12,0,0,0);
      var lastD=new Date(lastDate+'T12:00:00');
      var daysDiff=Math.floor((nowD-lastD)/86400000);
      if(daysDiff>1)return;
      var lastKm=validActs.reduce(function(s,a){return getActDate(a)===lastDate?s+(a.distance_meters||0)/1000:s;},0);
      if(lastKm<8)return;
      var wrap=document.getElementById('recovery-card-wrap');
      var titleEl=document.getElementById('recovery-title');
      var subEl=document.getElementById('recovery-sub');
      var chipsEl=document.getElementById('recovery-chips');
      if(!wrap)return;
      var whenLabel=daysDiff===0?'today':'yesterday';
      var chips,intensity;
      if(lastKm>=21){
        intensity='Peak Effort';
        chips=[
          {e:'💧',t:'Hydrate now','c':'Drink 500ml water immediately'},
          {e:'⚡',t:'Electrolytes','c':'Replenish salts lost in sweat'},
          {e:'🥩',t:'Protein meal','c':'Aim for 25–30g protein'},
          {e:'🧊',t:'Cold compress','c':'Ice calves & feet for 10 min'},
          {e:'😴',t:'Sleep 8h+','c':'Your body repairs while you sleep'},
          {e:'🛑',t:'Rest tomorrow','c':'Let muscles recover fully'}
        ];
      } else if(lastKm>=15){
        intensity='Strong Effort';
        chips=[
          {e:'💧',t:'Stay hydrated','c':'Keep sipping water all day'},
          {e:'⚡',t:'Electrolytes','c':'Sports drink or coconut water'},
          {e:'🥩',t:'Protein snack','c':'Eggs, paneer or nuts within 1h'},
          {e:'🦵',t:'Stretch legs','c':'5 min calf & hamstring stretch'},
          {e:'😴',t:'Sleep well','c':'Aim for 7–8 hours tonight'}
        ];
      } else {
        intensity='Moderate Effort';
        chips=[
          {e:'💧',t:'Hydrate well','c':'2–3 litres water today'},
          {e:'⚡',t:'Electrolytes','c':'Add a pinch of salt to water'},
          {e:'🥩',t:'Protein','c':'Include protein in your next meal'},
          {e:'🧘',t:'Light stretch','c':'5 min of light stretching helps'}
        ];
      }
      titleEl.textContent='Recovery Tips · '+lastKm.toFixed(1)+' km '+whenLabel;
      subEl.textContent=intensity+' — take care of your body today';
      chipsEl.innerHTML=chips.map(function(c){
        return '<div class="recovery-chip" title="'+c.c+'">'+c.e+' '+c.t+'</div>';
      }).join('');
      _activeRecovery = {
        key: 'recovery_' + lastDate,
        title: 'Recovery Tips · ' + lastKm.toFixed(1) + ' km ' + whenLabel,
        sub: intensity + ' — take care of your body today',
        chips: chips
      };
      updateInAppNotificationBanner();
    })();

    // Streak and chart bars
    var activeDays={};
    myActs.filter(function(a){return !a.is_flagged;}).forEach(function(a){
      var d=getActDate(a);
      if(d)activeDays[d]=true;
    });

    function localDateStr(d){
      var yr=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,'0'),dy=String(d.getDate()).padStart(2,'0');
      return yr+'-'+mo+'-'+dy;
    }
    function addDays(dateStr,n){
      var d=new Date(dateStr+'T12:00:00');d.setDate(d.getDate()+n);return localDateStr(d);
    }

    var todayLocal=localDateStr(now);
    var yesterdayLocal=addDays(todayLocal,-1);
    var sortedActiveDays=Object.keys(activeDays).sort();

    var streak=0;
    var lastActiveDay=sortedActiveDays.length>0?sortedActiveDays[sortedActiveDays.length-1]:null;
    if(lastActiveDay){
      var walkDay=lastActiveDay;
      while(activeDays[walkDay]){streak++;walkDay=addDays(walkDay,-1);}
    }

    var streakIsLive=lastActiveDay===todayLocal||lastActiveDay===yesterdayLocal;

    var best=0,cur=0,prevD=null;
    sortedActiveDays.forEach(function(d){
      if(prevD){var diff=Math.round((new Date(d+'T12:00:00')-new Date(prevD+'T12:00:00'))/86400000);cur=diff===1?cur+1:1;}
      else cur=1;
      best=Math.max(best,cur);
      prevD=d;
    });

    safeSetText('streak-num', (streakIsLive&&streak>0?'🔥':'')+streak);
    safeSetText('streak-best-val', best);
    safeSetText('streak-msg', streakIsLive?(streak>=7?'Amazing streak!':streak>=3?'Keep it going!':'Good start!'):(lastActiveDay?'Last active '+lastActiveDay:'Start today!'));

    var days7=[],labels7=[];
    for(var di=6;di>=0;di--){
      var dd=new Date(now);dd.setDate(dd.getDate()-di);dd.setHours(12,0,0,0);
      var dstr=localDateStr(dd);
      var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      days7.push({str:dstr,active:!!activeDays[dstr],isToday:di===0});
      labels7.push(di===0?'Today':dayNames[dd.getDay()]);
    }
    safeSetHtml('streak-bars', days7.map(function(d){return'<div class="sbar '+(d.isToday?'dim':d.active?'on':'off')+'"></div>';}).join(''));
    safeSetHtml('streak-labels', labels7.map(function(l){return'<span class="sdlbl">'+l+'</span>';}).join(''));

    // Challenges list tab
    (function renderChallenges(){
      var chList=document.getElementById('challenges-list');
      if(!chList)return;

      var combined = CHALLENGES_LB.map(function(ch) {
        return {
          id: ch.id,
          name: ch.name,
          start_date: ch.start_date,
          end_date: ch.end_date,
          bonus_points: parseFloat(ch.bonus_points) || 0,
          is_manual: false
        };
      });

      myActs.forEach(function(a) {
        var mb = parseFloat(a.manual_bonus) || 0;
        if (mb > 0) {
          var matchedCh = CHALLENGES_LB.find(function(ch) {
            return ch.name === a.description;
          });
          if (matchedCh) return;

          var date = getActDate(a);
          combined.push({
            id: 'manual_' + a.strava_activity_id,
            name: a.description || 'Manual bonus',
            start_date: date,
            end_date: date,
            bonus_points: mb,
            is_manual: true
          });
        }
      });

      if(!combined.length){
        chList.innerHTML='<div class="card" style="margin-bottom:0;"><p style="font-size:var(--fs-base);color:var(--muted);padding:14px;text-align:center;">No challenges configured.</p></div>';
        return;
      }
      chList.innerHTML='';
      
      function toTitleCase(str) {
        if (!str) return '';
        return str.toLowerCase().split(' ').map(function(word) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
      }

      function getChallengeEmoji(name) {
        var n = (name || '').toLowerCase();
        if (n.indexOf('strava') > -1) return '🧡';
        if (n.indexOf('walk') > -1) return '🚶';
        if (n.indexOf('run') > -1) return '🏃';
        if (n.indexOf('ride') > -1 || n.indexOf('cycle') > -1 || n.indexOf('bike') > -1) return '🚴';
        if (n.indexOf('hike') > -1 || n.indexOf('climb') > -1) return '🥾';
        if (n.indexOf('sunchaser') > -1 || n.indexOf('sun') > -1 || n.indexOf('morning') > -1) return '🌅';
        if (n.indexOf('night') > -1 || n.indexOf('evening') > -1) return '🌙';
        if (n.indexOf('environment') > -1 || n.indexOf('nature') > -1 || n.indexOf('green') > -1) return '🌱';
        if (n.indexOf('wednesday') > -1 || n.indexOf('friday') > -1 || n.indexOf('day') > -1) return '📅';
        if (n.indexOf('weekend') > -1 || n.indexOf('saturday') > -1 || n.indexOf('sunday') > -1) return '🏖️';
        if (n.indexOf('gold') > -1) return '🥇';
        if (n.indexOf('silver') > -1) return '🥈';
        if (n.indexOf('bronze') > -1) return '🥉';
        if (n.indexOf('title') > -1 || n.indexOf('champion') > -1) return '🏆';
        return '🎯';
      }

      var sortedCh = combined.sort(function(a,b){return (b.start_date||'').localeCompare(a.start_date||'');});
      sortedCh.forEach(function(ch,ci2){
        var key = ch.is_manual ? ch.id : 'ch_'+(ch.id||ci2);
        var ep=fullPts.earnedPts||{};
        var ec=fullPts.earnedChallenges||{};
        var earned = ch.is_manual ? true : !!ec[key];
        if(!earned){var allDB=fullPts.dayBreakdown||{};for(var day in allDB){if(allDB[day].challenges&&allDB[day].challenges.some(function(x){return x.name===ch.name;})){earned=true;break;}}}
        if(!earned){var ab=fullPts.actBreakdown||{};for(var actId in ab){if(ab[actId].challenges&&ab[actId].challenges.some(function(x){return x.name===ch.name;})){earned=true;break;}}}
        var displayPts = ch.is_manual ? ch.bonus_points : (earned&&ep[key]?ep[key]:Number(ch.bonus_points)||0);
        var today2=new Date().toISOString().split('T')[0];
        var missed=!earned&&ch.end_date&&ch.end_date<today2;
        var statusCls=earned?'won':missed?'missed':'avail';
        var statusIcon=earned?'\u2713':missed?'\u2715':'!';
        
        var cardDiv=document.createElement('div');
        cardDiv.className='ch-card ' + statusCls;
        
        var displayName = getChallengeEmoji(ch.name) + ' ' + toTitleCase(ch.name);
        var statusBarHtml = earned
          ? '<span>&#10003; Achieved</span><span>+' + Math.round(displayPts) + ' pts earned</span>'
          : missed
            ? '<span>&#10007; Not completed</span><span>Deadline passed</span>'
            : '<span>! Available</span><span>+' + Math.round(ch.bonus_points) + ' pts possible</span>';
        cardDiv.innerHTML = `
          <div class="ch-card-header">
            <div class="ch-dot ${statusCls}">${statusIcon}</div>
            <div class="ch-card-title-wrap">
              <div class="ch-title">${esc(displayName)}</div>
              <div class="ch-sub">${ch.start_date === ch.end_date ? ch.start_date : ch.start_date + ' \u2013 ' + ch.end_date} &middot; <span class="ch-pts ${statusCls}">+${Math.round(earned ? displayPts : ch.bonus_points)} pts</span></div>
            </div>
          </div>
          <div class="ch-status-bar ${statusCls}">${statusBarHtml}</div>
        `;
        chList.appendChild(cardDiv);
      });
    })();

    var flaggedCount=myActs.filter(function(a){return a.is_flagged;}).length;
    var uniqueDays=new Set(myActs.filter(function(a){return !a.is_flagged;}).map(function(a){return getActDate(a);})).size;
    safeSetText('act-section-title', uniqueDays+' Days \u00b7 '+myActs.length+' Activities'+(flaggedCount?' \u00b7 '+flaggedCount+' Flagged':''));
    window._myActsGlobal = myActs;
    window._myRegGlobal = reg;
    window._myFullPtsGlobal = fullPts;
    renderActivities(myActs, fullPts.dayBreakdown, fullPts.actBreakdown, reg.gender);

    hideSplash();

    // Auto-open activity detail modal if activityId is present in the URL query string
    var urlParams = new URLSearchParams(window.location.search);
    var urlActivityId = urlParams.get('activityId');
    if (urlActivityId) {
      setTimeout(function() {
        console.log('Auto-opening activity from query parameter:', urlActivityId);
        openActivityDetail(urlActivityId, null, true);
      }, 500);
    }

  } catch(e) {
    hideSplash();
    console.error('Load error:',e.message||e);
    var err='<div class="empty-state"><div class="icon">⚠️</div><p>Could not load data.<br>'+(e.message||'Unknown error')+'</p></div>';
    safeSetHtml('act-list', err);
    safeSetHtml('tab-dashboard', '<div style="padding:40px 20px;text-align:center;color:var(--muted)">⚠️ '+(e.message||'Load error')+'</div>');
  }
}

// Notification Fetcher
async function loadNotifications() {
  try {
    var session = JSON.parse(safeGetItem('wk_user') || '{}');
    var athleteId = session.athleteId;
    if (!athleteId) return;

    var res = await fetch(BACKEND + '/notifications?athlete_id=' + encodeURIComponent(athleteId));
    var data = await res.json();
    if (data.success && Array.isArray(data.notifications)) {
      _notificationsList = data.notifications;
      _notificationsLoaded = true;
      if (typeof renderNotifications === 'function') renderNotifications();
      if (typeof renderStanding === 'function' && typeof myActs !== 'undefined' && myActs && myActs.length > 0) {
        renderStanding();
      }
    }
  } catch (e) {
    console.warn('Failed to load notifications:', e);
  }
}

async function bootAppUnified() {
  if (typeof loadBranding === 'function') {
    loadBranding();
  }
  var isParticipant = false;
  var s = null;
  try {
    s = JSON.parse(safeGetItem('wk_user') || '{}');
    if (s && s.loggedIn && s.athleteId) {
      isParticipant = true;
    }
  } catch(e){}

  var token = getToken();
  var emp = getEmp();

  if (!isParticipant && (!tokenValid(token) || !emp)) {
    document.documentElement.classList.remove('app-logged-in');
    if (typeof hideSplash === 'function') hideSplash();
    return;
  }

  // Apply the FOUC class — this is what the CSS uses to show #app-screen and hide #login-screen
  document.documentElement.classList.add('app-logged-in');

  if (!isParticipant) {
    try {
      var email = emp ? (emp.email || '') : '';
      var cols = 'id,emp_code,full_name,email,mobile,gender,shift,project_lead,strava_profile_url,tshirt_size,leaderboard_team,event_name,created_at,role,is_private,is_flagged,event_id,strava_athlete_id,status,profile_photo';
      var r = await fetch(SUPABASE_URL + '/rest/v1/registration?email=ilike.' + encodeURIComponent(email) + '&select=' + cols, { headers: HDR });
      var regs = await r.json();
      if (Array.isArray(regs) && regs.length > 0) {
        var reg = regs[0];
        if (reg.status === 'approved' || reg.strava_athlete_id) {
          s = {
            loggedIn: true,
            role: reg.role || 'user',
            athleteId: reg.strava_athlete_id,
            name: reg.full_name || emp.full_name || 'Participant',
            empCode: reg.emp_code || emp.emp_code || '',
            email: email,
            profilePhoto: reg.profile_photo || '',
            expires: Date.now() + (30 * 24 * 60 * 60 * 1000)
          };
          safeSetItem('wk_user', JSON.stringify(s));
          isParticipant = !!s.athleteId;
        }
      }
    } catch(ex) {
      console.warn('Silent participant check failed:', ex);
    }
  }

  if (typeof setupAppLayout === 'function') {
    setupAppLayout(isParticipant);
  }

  if (typeof hideSplash === 'function') hideSplash();

  if (isParticipant) {
    currentSession = s;
    loadNotifications();
    var _maintBlocked = await checkMaintenanceGate(s.athleteId, s.empCode);
    if (_maintBlocked) return;
    await load(false);

    // Exchange participant session for employee token to enable Celebrate tab features
    try {
      var exRes = await fetch(BACKEND + '/employee/exchange-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: s.athleteId })
      });
      var exData = await exRes.json();
      if (exData && exData.success) {
        if (typeof setToken === 'function') setToken(exData.token);
        if (typeof setEmp === 'function') setEmp(exData.employee);
        // Initialize Celebrate tab listeners and load feed
        if (typeof initEmployeeModeListeners === 'function') {
          initEmployeeModeListeners();
        }
        if (typeof loadCelebrate === 'function') {
          loadCelebrate();
        }
      } else {
        console.warn('Participant exchange returned non-success:', exData.error);
      }
    } catch (exErr) {
      console.warn('Failed to exchange participant session:', exErr.message);
    }
  } else {
    if (typeof loadCelebrate === 'function') loadCelebrate();
    if (typeof initEmployeeModeListeners === 'function') initEmployeeModeListeners();
    
    var initials = typeof get2Initials === 'function' ? get2Initials(emp.full_name) : emp.full_name.substring(0,2).toUpperCase();
    var styleFunc = typeof getWhoopAvatarStyle === 'function' ? getWhoopAvatarStyle : function() { return 'background:#282e36; border:2px solid #E8622A; color:#fff;'; };
    
    var avatarEl = document.getElementById('hdr-avatar');
    if (avatarEl) {
      avatarEl.textContent = initials;
      avatarEl.setAttribute('style', styleFunc(emp.full_name) + '; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:13px; letter-spacing:0.5px;');
    }
    
    var youAvatarEl = document.getElementById('you-avatar');
    if (youAvatarEl) {
      youAvatarEl.textContent = initials;
      youAvatarEl.setAttribute('style', styleFunc(emp.full_name) + '; width:84px; height:84px; border-radius:50%; font-size:28px; font-weight:800; display:flex; align-items:center; justify-content:center; letter-spacing:1px;');
    }
    var youNameEl=document.getElementById('you-name');if(youNameEl)youNameEl.textContent=emp.full_name.toUpperCase();
    if(document.getElementById('you-emp-code'))document.getElementById('you-emp-code').textContent=emp.emp_code||'—';
    if(document.getElementById('you-email'))document.getElementById('you-email').textContent=emp.email||'—';
    if(document.getElementById('you-gender'))document.getElementById('you-gender').textContent=emp.gender||'—';
    if(document.getElementById('you-shift'))document.getElementById('you-shift').textContent=emp.shift||'—';
    if(document.getElementById('you-team'))document.getElementById('you-team').textContent=emp.team||'—';
  }
}
window.bootAppUnified = bootAppUnified;

async function loadPastEventsPerformance(reg, athleteId) {
  var sec = document.getElementById('you-past-events-section');
  var card = document.getElementById('you-past-events-card');
  if (!sec || !card || !reg || !reg.email) return;

  try {
    sec.style.display = 'block';
    card.innerHTML = '<div style="text-align:center;padding:15px;color:var(--muted);font-size:13px;">Loading past events...</div>';

    var res = await fetch(SUPABASE_URL + '/rest/v1/registration?email=eq.' + encodeURIComponent(reg.email) + '&event_id=neq.' + reg.event_id + '&select=event_id,event_name,leaderboard_team,gender,shift,strava_athlete_id', { headers: HDR });
    var otherRegs = await res.json();
    if (!Array.isArray(otherRegs) || otherRegs.length === 0) {
      card.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);font-size:13.5px;">No Past Event Performed</div>';
      return;
    }

    var eventsRes = await fetch(SUPABASE_URL + '/rest/v1/events?select=id,name', { headers: HDR });
    var eventsList = await eventsRes.json();
    var eventMap = {};
    if (Array.isArray(eventsList)) {
      eventsList.forEach(function(e) {
        eventMap[e.id] = e.name;
      });
    }

    var html = '';
    otherRegs.sort(function(a, b) { return a.event_id - b.event_id; });

    for (var i = 0; i < otherRegs.length; i++) {
      var pReg = otherRegs[i];
      var pastEventId = pReg.event_id;
      var pastEventName = eventMap[pastEventId] || pReg.event_name || (pastEventId === 1 ? 'Walkathon 2026' : 'Event ' + pastEventId);
      var team = pReg.leaderboard_team || 'No Team';
      
      var scoreObj = null;
      try {
        var cacheRes = await fetch(SUPABASE_URL + '/rest/v1/athlete_points_summary?athlete_id=eq.' + pReg.strava_athlete_id + '&event_id=eq.' + pastEventId, { headers: HDR });
        var cacheData = await cacheRes.json();
        if (Array.isArray(cacheData) && cacheData.length > 0) {
          scoreObj = cacheData[0];
        }
      } catch(e) {}

      var totalKm = 0;
      var totalPts = 0;
      var actsCount = 0;

      if (scoreObj) {
        totalKm = parseFloat(scoreObj.total_distance_km || 0);
        totalPts = parseFloat(scoreObj.total_points || 0);
        actsCount = parseInt(scoreObj.activities_count || 0);
      } else {
        try {
          var actRes = await fetch(SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + pReg.strava_athlete_id + '&event_id=eq.' + pastEventId + '&is_deleted=eq.false', { headers: HDR });
          var pastActs = await actRes.json();
          if (Array.isArray(pastActs)) {
            actsCount = pastActs.length;
            pastActs.forEach(function(a) {
              if (!a.is_flagged) {
                totalKm += parseFloat(a.distance_meters || 0) / 1000;
              }
            });
            totalPts = totalKm;
          }
        } catch(err) {
          console.warn('Fallback past activity check failed:', err);
        }
      }

      var isCycling = pastEventName.toLowerCase().indexOf('cycling') > -1 || pastEventName.toLowerCase().indexOf('cyclothon') > -1 || pastEventId === 2;
      var goldThresh = isCycling ? 750 : 300;
      var silverThresh = isCycling ? 500 : 200;
      var bronzeThresh = isCycling ? 250 : 125;

      var medalBadge = '🏅';
      var medalTitle = 'Participant';
      if (totalKm >= goldThresh) {
        medalBadge = '🥇';
        medalTitle = 'Gold Medal';
      } else if (totalKm >= silverThresh) {
        medalBadge = '🥈';
        medalTitle = 'Silver Medal';
      } else if (totalKm >= bronzeThresh) {
        medalBadge = '🥉';
        medalTitle = 'Bronze Medal';
      }

      var borderStyle = i === otherRegs.length - 1 ? 'border-bottom:none;' : '';

      html += '<div class="tab-you-detail-row" style="' + borderStyle + 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
        '<div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">' +
          '<span style="font-size:14px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + pastEventName + '</span>' +
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);">' + team + ' &middot; ' + actsCount + ' workouts</span>' +
        '</div>' +
        '<div style="text-align:right;display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
          '<div style="display:flex;flex-direction:column;">' +
            '<span style="font-size:14px;font-weight:800;color:var(--brand);">' + totalKm.toFixed(1) + ' km</span>' +
            '<span style="font-size:10px;color:rgba(255,255,255,0.4);">' + totalPts.toFixed(0) + ' pts</span>' +
          '</div>' +
          '<span style="font-size:22px;line-height:1;" title="' + medalTitle + '">' + medalBadge + '</span>' +
        '</div>' +
      '</div>';
    }

    card.innerHTML = html;

  } catch(ex) {
    console.error('Failed to load past events performance card:', ex);
    sec.style.display = 'none';
  }
}
window.loadPastEventsPerformance = loadPastEventsPerformance;
// Trigger rebuild: fix config fetches and call setupAppLayout after loading config
