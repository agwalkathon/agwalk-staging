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
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && (
        k.indexOf('agwalk_reg_' + athleteId) === 0 ||
        k.indexOf('agwalk_acts_v4_' + athleteId) === 0 ||
        k === 'agwalk_config' ||
        k.indexOf('agwalk_config_') === 0 ||
        k === 'agwalk_challenges' ||
        k.indexOf('agwalk_challenges_') === 0 ||
        k === 'agwalk_special_days' ||
        k.indexOf('agwalk_special_days_') === 0 ||
        k === 'agwalk_medals' ||
        k.indexOf('agwalk_medals_') === 0 ||
        k === 'agwalk_ranking_acts_v4' ||
        k === 'agwalk_ranking_reg' ||
        k === 'agwalk_ranking_summaries'
      )) {
        localStorage.removeItem(k);
      }
    }
  } catch(e) {}
  console.log('[Cache] Cleared for athlete', athleteId);
}

// Cache migrations
safeRemoveItem('agwalk_ranking_acts');

function getEventScoreUnit() {
  var rules = EVENT_ROW && EVENT_ROW.rules_config;
  if (rules && (rules.scoring_mode === 'raw' || rules.scoring_mode === 'raw_metric')) {
    var m = rules.metric || 'distance';
    if (m === 'distance' || m === 'distance_km') return 'km';
    if (m === 'elevation' || m === 'elevation_m') return 'm';
    if (m === 'steps') return 'steps';
    return m;
  }
  return 'pts';
}

function getEventScoreLabel() {
  var rules = EVENT_ROW && EVENT_ROW.rules_config;
  if (rules && (rules.scoring_mode === 'raw' || rules.scoring_mode === 'raw_metric')) {
    var m = rules.metric || 'distance';
    if (m === 'distance' || m === 'distance_km') return 'Total Distance';
    if (m === 'elevation' || m === 'elevation_m') return 'Total Elevation';
    if (m === 'steps') return 'Total Steps';
    return 'Total ' + m;
  }
  return 'Total Points';
}

function renderUserAvatar(name, photo, hdrId, youId) {
  var initials = (name || 'Participant').trim().split(/\s+/);
  var initStr = '';
  if (initials.length >= 2) {
    initStr = (initials[0][0] + initials[initials.length - 1][0]).toUpperCase();
  } else {
    initStr = (name || 'AG').substring(0, 2).toUpperCase();
  }
  
  var grads = [
    { c1: '#38bdf8', c2: '#4ade80' },
    { c1: '#c084fc', c2: '#f472b6' },
    { c1: '#fb923c', c2: '#facc15' },
    { c1: '#818cf8', c2: '#22d3ee' },
    { c1: '#34d399', c2: '#a3e635' },
    { c1: '#fb7185', c2: '#a78bfa' },
    { c1: '#2dd4bf', c2: '#60a5fa' }
  ];
  var hash = 0;
  var str = name || '';
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var idx = Math.abs(hash) % grads.length;
  var g = grads[idx];
  
  var avStyle = 'background: linear-gradient(135deg, ' + g.c1 + ' 0%, ' + g.c2 + ' 100%); color: #0f172a; font-weight: 700; font-family: var(--font); text-shadow: none;';
  
  var hdrEl = document.getElementById(hdrId);
  if (hdrEl) {
    hdrEl.textContent = initStr;
    hdrEl.setAttribute('style', avStyle + '; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:13px; letter-spacing:0.5px; border:none; box-shadow: 0 2px 8px rgba(0,0,0,0.15);');
  }

  var youEl = document.getElementById(youId);
  if (youEl) {
    youEl.textContent = initStr;
    youEl.setAttribute('style', avStyle + '; width:84px; height:84px; border-radius:50%; font-size:28px; display:flex; align-items:center; justify-content:center; letter-spacing:0.5px; border:none; box-shadow: 0 4px 16px rgba(0,0,0,0.2);');
  }
}

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
  if (s && s.loggedIn && !isBackgroundRefresh) {
    renderUserAvatar(s.name || 'Participant', s.profilePhoto, 'hdr-avatar', 'you-avatar');
    var yNameEl = document.getElementById('you-name');
    if (yNameEl && s.name) yNameEl.textContent = s.name.toUpperCase();
    if (typeof initParticipantSession === 'function') initParticipantSession(s);
  }
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

    try {
      if (localStorage.getItem('ag_clear_event_cache') === '1') {
        localStorage.removeItem('ag_clear_event_cache');
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var key = localStorage.key(i);
          if (key && (
            key.indexOf('agwalk_event_row_') === 0 || 
            key.indexOf('agwalk_config') === 0 || 
            key.indexOf('agwalk_challenges') === 0 || 
            key.indexOf('agwalk_special_days') === 0 || 
            key.indexOf('agwalk_medals') === 0 || 
            key.indexOf('agwalk_reg_') === 0
          )) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch(e){}

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
        if (window.EVENT_ROW && window.EVENT_ROW.status === 'live' && !isBackgroundRefresh) {
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
    var photo = reg.profile_photo || s.profilePhoto || '';
    renderUserAvatar(name, photo, 'hdr-avatar', 'you-avatar');
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
    safeSetHtml('s-dist', Math.round(fullPts.km) + '<span class="stat-unit-suffix">KM</span>');
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
    var mts='—';var mtsHtml='—';if(totalMovingSec>0){var mh=Math.floor(totalMovingSec/3600),mm=Math.floor((totalMovingSec%3600)/60);mts=mh>0?mh+'h '+mm+'m':mm+'m';mtsHtml=mh>0?(mh+'<span class="stat-unit-suffix">h</span> '+mm+'<span class="stat-unit-suffix">m</span>'):(mm+'<span class="stat-unit-suffix">m</span>');}
    safeSetText('s-movetime', mts);
    safeSetHtml('s-movetime-dash', mtsHtml);

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
        
        // Calculate average metrics for comparisons
        var avgActDistM = validActs.length > 0 ? (totalDistM / validActs.length) : 0;
        var totalMovingSec = validActs.reduce(function(s,a){return s+(a.moving_time_seconds||0);},0);
        var avgSpeedKMH = totalMovingSec > 0 ? (totalDistM / 1000) / (totalMovingSec / 3600) : 0;
        
        var statDefs = {
          longest_activity: {
            label: 'Longest Activity',
            sub: 'single session max',
            color: '#ffae00',
            bg: 'rgba(255, 174, 0, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l4-8 4 4 4-8 4 8"/></svg>',
            val: maxDistM > 0 ? (maxDistM / 1000).toFixed(2) + ' km' : '—',
            insight: (function() {
              if (maxDistM > 0 && avgActDistM > 0) {
                var factor = (maxDistM / avgActDistM);
                return factor > 1.05 ? factor.toFixed(1) + 'x your average activity distance! 👟' : 'Personal best distance session!';
              }
              return 'Peak distance achievement!';
            })()
          },
          best_pace: {
            label: 'Best Pace',
            sub: 'min/km · walk/run',
            color: '#6366f1',
            bg: 'rgba(99, 102, 241, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            val: maxSpeed > 0 ? fmtPS(maxSpeed, bestPaceSport) : '—',
            insight: 'Fastest average pace logged!'
          },
          longest_session: {
            label: 'Longest Session',
            sub: 'longest moving duration',
            color: '#3b82f6',
            bg: 'rgba(59, 130, 246, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            val: maxTimeSec > 0 ? fmtDur(maxTimeSec) : '—',
            insight: 'Maximum time spent active in one session!'
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
            color: '#22c55e',
            bg: 'rgba(34, 197, 94, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            val: maxDayKm > 0 ? maxDayKm.toFixed(2) + ' km' : '—',
            insight: (function() {
              if (maxDayKm > 0 && totalDistM > 0) {
                var pct = ((maxDayKm * 1000) / totalDistM * 100);
                return 'Contributed ' + pct.toFixed(1) + '% of your total event distance! 🌟';
              }
              return 'Peak daily output achieved!';
            })()
          },
          max_elevation: {
            label: 'Max Elevation Gain',
            sub: 'single session max',
            color: '#8b5cf6',
            bg: 'rgba(139, 92, 246, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
            val: maxElevation > 0 ? maxElevation.toFixed(0) + ' m' : '—',
            insight: (function() {
              if (maxElevation > 0) {
                var stories = (maxElevation / 3);
                return 'Equivalent to climbing a ' + stories.toFixed(0) + '-story building! 🏙️';
              }
              return 'Peak elevation gain logged!';
            })()
          },
          max_speed: {
            label: 'Max Avg Speed',
            sub: 'single session max',
            color: '#ec4899',
            bg: 'rgba(236, 72, 153, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15 15"/></svg>',
            val: maxAvgSpeed > 0 ? (maxAvgSpeed * 3.6).toFixed(1) + ' km/h' : '—',
            insight: (function() {
              if (maxAvgSpeed > 0 && avgSpeedKMH > 0) {
                var factor = ((maxAvgSpeed * 3.6) / avgSpeedKMH);
                return factor > 1.05 ? factor.toFixed(1) + 'x faster than your overall average speed! ⚡' : 'Peak average session speed!';
              }
              return 'Fastest overall speed logged!';
            })()
          },
          total_distance: {
            label: 'Total Distance',
            sub: 'overall event distance',
            color: '#3b82f6',
            bg: 'rgba(59, 130, 246, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>',
            val: totalDistM > 0 ? (totalDistM / 1000).toFixed(1) + ' km' : '—',
            insight: 'Your total accumulated event distance.'
          },
          total_elevation: {
            label: 'Total Elevation',
            sub: 'overall elevation gain',
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22l-4-4h8l-4 4zM12 2l-4 4h8l-4-4z"/></svg>',
            val: totalElevation > 0 ? totalElevation.toFixed(0) + ' m' : '—',
            insight: 'Total vertical height climbed overall.'
          },
          total_activities: {
            label: 'Total Activities',
            sub: 'sync\'d sessions',
            color: '#64748b',
            bg: 'rgba(100, 116, 139, 0.12)',
            svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
            val: validActs.length + ' acts',
            insight: 'Total count of activities sync\'d.'
          }
        };
        
        var drawerHtml = '';
        var keys = ['longest_activity', 'best_day', 'max_elevation', 'max_speed', 'best_pace', 'longest_session', 'total_distance', 'total_elevation', 'total_activities'];
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

            drawerHtml += '<div class="pb-detail-card"' + clickAttr + ' style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 14px 18px; display: flex; flex-direction: column; margin-bottom: 12px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" onmouseenter="this.style.background=\'rgba(255,255,255,0.06)\'; this.style.borderColor=\'' + d.color + '40\'; this.style.transform=\'translateY(-2px)\';" onmouseleave="this.style.background=\'rgba(255,255,255,0.03)\'; this.style.borderColor=\'rgba(255,255,255,0.05)\'; this.style.transform=\'translateY(0)\';">' +
             '  <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">' +
             '    <div style="display: flex; align-items: center;">' +
             '      <div style="width: 38px; height: 38px; border-radius: 10px; background: ' + d.bg + '; color: ' + d.color + '; display: flex; align-items: center; justify-content: center; margin-right: 14px; flex-shrink: 0; box-shadow: 0 0 8px ' + d.color + '15;">' +
             '        ' + d.svg +
             '      </div>' +
             '      <div style="text-align: left;">' +
             '        <div style="font-size: 13.5px; font-weight: 700; color: #fff; letter-spacing: 0.5px; text-transform: uppercase;">' + d.label + '</div>' +
             '        <div style="font-size: 11.5px; color: rgba(255,255,255,0.4); margin-top: 2px; font-weight: 500;">' + d.sub + '</div>' +
             '      </div>' +
             '    </div>' +
             '    <div style="font-size: 18px; font-weight: 800; color: ' + d.color + '; letter-spacing: -0.2px;">' + d.val + '</div>' +
             '  </div>' +
             '  <div style="margin-top: 10px; padding: 6px 12px; background: rgba(255,255,255,0.02); border-left: 2.5px solid ' + d.color + '; border-radius: 4px; font-size: 11.5px; color: rgba(255,255,255,0.65); font-weight: 500; text-align: left; display: flex; align-items: center; gap: 6px; line-height: 1.3;">' +
             '    ' + d.insight +
             '  </div>' +
             '</div>';
          }
        });
        
        var drawerList = document.getElementById('pbs-detail-list');
        if (drawerList) {
          drawerList.innerHTML = drawerHtml || '<div class="card" style="margin-bottom:0;"><div class="empty-state" style="padding:18px"><p>No personal bests recorded yet.</p></div></div>';
        }

        // Render single teaser card on dashboard
        grid.innerHTML = '<div class="today-act-row" onclick="openPBsDrawer()" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.04); border-radius:16px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; transition:background 0.2s; cursor:pointer; width:100%; box-sizing:border-box;" onmouseenter="this.style.background=\'rgba(255,255,255,0.06)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.03)\'">' +
          '<div style="display:flex; align-items:center; gap:16px;">' +
            '<div style="background:linear-gradient(135deg, #facc15, #e8622a); display:flex; align-items:center; justify-content:center; border-radius:12px; width:40px; height:40px; box-shadow:0 2px 8px rgba(0,0,0,0.15); flex-shrink:0;">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>' +
            '</div>' +
            '<div style="text-align:left;">' +
              '<div style="font-size:14px; font-weight:700; color:#fff; letter-spacing:0.5px;">PERSONAL BESTS</div>' +
              '<div style="font-size:12px; color:rgba(255,255,255,0.4); margin-top:2px;">Tap to view all achievements</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:12px;">' +
            '<span style="font-size:12px; font-weight:700; color:#ffae00; background:rgba(255,174,0,0.12); padding:4px 10px; border-radius:8px;">' + (maxDistM > 0 ? (maxDistM / 1000).toFixed(1) + ' km' : '—') + '</span>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>' +
          '</div>' +
        '</div>';

        // Update header battery goal percentage dynamically
        (function() {
          var todayStart = new Date();
          todayStart.setHours(0,0,0,0);
          var todayEnd = new Date();
          todayEnd.setHours(23,59,59,999);
          var todayActs = validActs.filter(function(a) {
            var ad = new Date(a.activity_date);
            return ad >= todayStart && ad <= todayEnd;
          });
          var todayDistM = todayActs.reduce(function(s,a) { return s + (a.distance_meters || 0); }, 0);
          var dailyGoalM = (EVENT_ROW && EVENT_ROW.rules_config && EVENT_ROW.rules_config.daily_distance_goal_meters) ? EVENT_ROW.rules_config.daily_distance_goal_meters : 5000;
          var pctVal = Math.min(100, Math.round((todayDistM / dailyGoalM) * 100));
          if (isNaN(pctVal)) pctVal = 0;
          var pctEl = document.getElementById('hdr-battery-pct');
          var barEl = document.getElementById('hdr-battery-bar');
          if (pctEl) pctEl.textContent = pctVal + '%';
          if (barEl) {
            barEl.style.width = pctVal + '%';
            if (pctVal >= 50) {
              barEl.style.backgroundColor = '#22c55e';
            } else if (pctVal >= 20) {
              barEl.style.backgroundColor = '#f59e0b';
            } else {
              barEl.style.backgroundColor = '#ef4444';
            }
          }
        })();
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
            return '<span style="font-size:11px;font-weight:600;color:' + fg + ';background:' + bg + ';padding:5px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;margin-right:8px;margin-bottom:8px;">' + type + ' · ' + count + '</span>';
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
        else{needEl.textContent='Need '+needed.toFixed(0)+' ' + getEventScoreUnit();needEl.style.color='#ffffff';}
      }
    });
    triggerRingAnimation();
    try {
      if (typeof window.renderHeroArc === 'function') {
        window.renderHeroArc(myPts, [
          { lbl: bronzeLabel, thresh: bronzeThresh, color: '#F4A84A' },
          { lbl: silverLabel, thresh: silverThresh, color: '#C8D8E8' },
          { lbl: goldLabel, thresh: goldThresh, color: '#FFD000' }
        ], EVENT_ROW);
      }
      if (typeof window.renderMedalShelf === 'function') {
        window.renderMedalShelf(myPts, [
          { lbl: bronzeLabel, thresh: bronzeThresh, ic: '🥉', color: '#F4A84A' },
          { lbl: silverLabel, thresh: silverThresh, ic: '🥈', color: '#C8D8E8' },
          { lbl: goldLabel, thresh: goldThresh, ic: '🥇', color: '#FFD000' }
        ]);
      }
    } catch(e) { try{console.error('[hero-arc]',e);}catch(e5){} }

    (function() {
      var todayStr = new Date().toISOString().split('T')[0];
      var iKey = 'insight_' + todayStr;
      var emoji, title, body;
      var unit = getEventScoreUnit();
      if (myPts >= goldThresh) {
        emoji = '🥇'; title = goldLabel + ' Achieved!';
        body = 'Outstanding! You\'ve crossed the ' + goldLabel + ' threshold with ' + myPts.toFixed(0) + ' ' + unit + '. Keep it up!';
      } else if (myPts >= silverThresh) {
        var need = (goldThresh - myPts).toFixed(0);
        emoji = '🥈'; title = silverLabel + ' — ' + goldLabel + ' is close!';
        body = 'You need just ' + need + ' more ' + unit + ' to unlock ' + goldLabel + '. Push a little harder!';
      } else if (myPts >= bronzeThresh) {
        var need = (silverThresh - myPts).toFixed(0);
        emoji = '🥉'; title = bronzeLabel + ' Achieved!';
        body = 'Great start! ' + need + ' ' + unit + ' more gets you ' + silverLabel + '. Keep walking!';
      } else {
        var need = (bronzeThresh - myPts).toFixed(0);
        emoji = '🏃'; title = 'On your way to ' + bronzeLabel + '!';
        body = 'Walk ' + need + ' more ' + unit + ' to earn your ' + bronzeLabel + '. You can do it!';
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

      async function fetchHofActivitiesBackground() {
        try {
          var cachedActs = cacheGet('ranking_acts_v4', CACHE_TTL.ranking);
          if (cachedActs) {
            LB_ACTS = cachedActs;
            return;
          }
          console.log('[Cache] Fetching HOF activities in background...');
          var acts = await fetchAllParallel(SUPABASE_URL+'/rest/v1/activities?event_id=eq.'+EVENT_ROW.id+'&is_deleted=eq.false&created_at=lt.'+getEventCutoffUTC()+'&activity_date=gte.'+getEventUTCStart()+'&activity_date=lte.'+getEventUTCEnd()+'&order=id.asc&select=id,strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist,elevation_gain,moving_time_seconds,steps,description');
          if (Array.isArray(acts)) {
            LB_ACTS = acts;
            cacheSet('ranking_acts_v4', acts);
            console.log('[Cache] HOF activities background fetch completed. Count:', acts.length);
            if (window.LB_currentTab === 'hof' && typeof renderHallOfFame === 'function') {
              renderHallOfFame();
            }
          }
        } catch(e) {
          console.warn('[Cache] Background HOF activities fetch failed:', e);
        }
      }

      async function refreshRankingData() {
        try {
          var sumRes = await fetch(SUPABASE_URL + '/rest/v1/athlete_points_summary?event_id=eq.' + EVENT_ROW.id + '&order=total_points.desc', { headers: HDR });
          var summaries = await sumRes.json();
          if (Array.isArray(summaries) && summaries.length > 0) {
            console.log('[Cache] Pre-computed ranking retrieved from Supabase ✓');
            cacheSet('ranking_summaries', summaries);
            applyPrecomputedLBScores(summaries);
            fetchHofActivitiesBackground();
            return;
          }
        } catch (err) {
          console.warn('[Cache] Pre-computed points fetch failed, falling back to legacy:', err);
        }

        try {
          var fetched = await Promise.all([
            fetchAllParallel(SUPABASE_URL+'/rest/v1/activities?event_id=eq.'+EVENT_ROW.id+'&is_deleted=eq.false&created_at=lt.'+getEventCutoffUTC()+'&activity_date=gte.'+getEventUTCStart()+'&activity_date=lte.'+getEventUTCEnd()+'&order=id.asc&select=id,strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist,elevation_gain,moving_time_seconds,steps,description'),
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
          console.log('[Cache] Serving pre-computed ranking from cache ⚡');
          applyPrecomputedLBScores(_cachedSummaries);
          fetchHofActivitiesBackground();
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
        var myShiftN = (reg.shift || '').toLowerCase();
        var isNight = myShiftN.indexOf('night') > -1;
        var myGenderN = (reg.gender || '').toLowerCase();
        var isFemale = myGenderN === 'female' || myGenderN === 'f';

        // Check if precomputed summaries are available
        var summaries = cacheGet('ranking_summaries', CACHE_TTL.ranking) || cacheGet('ranking_summaries', 86400 * 365 * 1000);
        var shiftScoredG = [];
        if (summaries && summaries.length > 0) {
          var shiftPeersG = summaries.filter(function(p) {
            var pg = (p.gender || '').toLowerCase();
            var ps = (p.shift || '').toLowerCase();
            var pIsNight = ps.indexOf('night') > -1;
            var pIsFemale = pg === 'female' || pg === 'f';
            return pIsNight === isNight && pIsFemale === isFemale;
          });
          shiftScoredG = shiftPeersG.map(function(p) {
            return {
              id: p.athlete_id,
              name: p.full_name,
              km: p.total_distance_km || 0
            };
          }).sort(function(a, b) { return b.km - a.km; });
        } else {
          var goldActsMap={};
          allActs.forEach(function(a){if(!goldActsMap[a.strava_athlete_id])goldActsMap[a.strava_athlete_id]=[];goldActsMap[a.strava_athlete_id].push(a);});
          var shiftPeersG=allRegRes.filter(function(p){var pg=(p.gender||'').toLowerCase(),ps=(p.shift||'').toLowerCase();return(ps.indexOf('night')>-1)===isNight&&(pg==='female')===isFemale;});
          shiftScoredG=shiftPeersG.map(function(p){var km=0;(goldActsMap[p.strava_athlete_id]||[]).forEach(function(a){km+=(a.distance_meters||0)/1000;});return{id:p.strava_athlete_id,name:p.full_name,km:km};}).sort(function(a,b){return b.km-a.km;});
        }

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
            '<div class="gold-sub">' + ((myRankG > 0 && totalG > 0) ? 'Rank #' + myRankG + ' of ' + totalG + ' in your category' : 'Gold Tier Secured!') + '</div></div>'+
          '</div>'+
          '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+quote+'&rdquo;</div></div>'+
          '<div class="gold-stats">'+
            '<div class="gold-stat"><div class="gold-stat-val">'+avgKmDay.toFixed(1)+' km</div><div class="gold-stat-lbl">Daily avg</div></div>'+
            '<div class="gold-stat"><div class="gold-stat-val" style="color:var(--gold)">~'+projectedPts+' pts</div><div class="gold-stat-lbl">Projected finish</div></div>'+
          '</div>'+
          (personAbove?
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                (daysLeft === 0 ?
                  '<div class="gold-rival-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Category Rank: #'+myRankG+'</div>'+
                  '<div class="gold-rival-sub">Event has ended</div>'
                :
                  '<div class="gold-rival-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Overtake #'+(myRankG-1)+': '+esc(personAbove.name)+'</div>'+
                  '<div class="gold-rival-sub">'+daysLeft+' days left · keep pushing</div>'
                )+
              '</div>'+
            '</div>'
          :
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                (daysLeft === 0 ?
                  '<div class="gold-rival-label">🏆 Category Rank: #'+(myRankG || 1)+'</div>'+
                  '<div class="gold-rival-sub">Event has ended</div>'
                :
                  '<div class="gold-rival-label">🏆 You\'re #1 — lead to the finish!</div>'+
                  '<div class="gold-rival-sub">Defend your spot for '+daysLeft+' more days</div>'
                )+
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

        if (daysLeft > 0) {
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
        } else {
          var endDisplayStr = EVENT_ROW ? new Date(EVENT_ROW.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Jun 30';
          paceCard.appendChild(paceRow('rgba(34,197,94,0.12)',icoPaceChk,'Event Completed','Final standings locked in',endDisplayStr,'var(--green)'));
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

    var baseDate = new Date(now);
    var isEventEnded = false;
    var evEnd = EVENT_ROW ? EVENT_ROW.end_date : null;
    if (evEnd && todayLocal > evEnd) {
      isEventEnded = true;
      baseDate = new Date(evEnd + 'T12:00:00');
    }

    var days7=[],labels7=[];
    // per-day km for the last 7 days (Phase 2b)
    var dayKm={};
    myActs.filter(function(a){return !a.is_flagged;}).forEach(function(a){
      var d=getActDate(a);
      if(d)dayKm[d]=(dayKm[d]||0)+(a.distance_meters||0)/1000;
    });
    for(var di=6;di>=0;di--){
      var dd=new Date(baseDate);dd.setDate(dd.getDate()-di);dd.setHours(12,0,0,0);
      var dstr=localDateStr(dd);
      var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var isToday = !isEventEnded && di===0;
      days7.push({str:dstr,active:!!activeDays[dstr],isToday:isToday,km:dayKm[dstr]||0,label:dayNames[dd.getDay()].charAt(0),dayNum:dd.getDate()});
      labels7.push(isToday ? 'Today' : dayNames[dd.getDay()]);
    }
    // daily km target: pace for next unearned medal, else keep current average
    var _daysLeftH=Math.max(1,daysLeft||1);
    var _nextThreshH=myPts<bronzeThresh?bronzeThresh:myPts<silverThresh?silverThresh:myPts<goldThresh?goldThresh:0;
    var _daysElapsedH=Math.max(1,(now-new Date((EVENT_ROW&&EVENT_ROW.start_date||'2026-06-01')+'T00:00:00+05:30'))/86400000);
    var _targetKmH=_nextThreshH>0?(_nextThreshH-myPts)/_daysLeftH:(fullPts.km/_daysElapsedH);
    _targetKmH=Math.max(1,Math.min(25,_targetKmH));
    // km-proportional week bars with goal checkmarks
    (function(){
      var maxKm=Math.max(_targetKmH,days7.reduce(function(m,d){return Math.max(m,d.km);},0),1);
      safeSetHtml('streak-bars', days7.map(function(d){
        var h=Math.max(6,Math.round((d.km/maxKm)*100));
        var met=d.km>=_targetKmH;
        var cls=d.isToday?'dim':d.active?'on':'off';
        return '<div class="sbarw"><em>'+(met?'\u2713':'')+'</em><div class="sbar '+cls+'" style="height:'+h+'%" title="'+d.km.toFixed(1)+' km"></div></div>';
      }).join(''));
      var bw=document.getElementById('streak-bars');
      if(bw)bw.classList.add('km-bars');
    })();
    safeSetHtml('streak-labels', labels7.map(function(l){return'<span class="sdlbl">'+l+'</span>';}).join(''));
    // day strip + stat chips (rank from ranking summaries cache when available)
    try{
      var _rankH=null;
      var _sum=typeof cacheGet==='function'?(cacheGet('ranking_summaries',CACHE_TTL.ranking)||cacheGet('ranking_summaries',86400*365*1000)):null;
      if(_sum&&_sum.length){
        var _gN=(reg.gender||'').toLowerCase();var _isF=_gN==='female'||_gN==='f';
        var _sN=(reg.shift||'').toLowerCase();var _isN=_sN.indexOf('night')>-1;
        var _peers=_sum.filter(function(p){
          var pg=(p.gender||'').toLowerCase(),ps=(p.shift||'').toLowerCase();
          return (ps.indexOf('night')>-1)===_isN&&(pg==='female'||pg==='f')===_isF;
        }).sort(function(a,b){return(b.total_points||0)-(a.total_points||0);});
        var _ix=_peers.findIndex(function(p){return String(p.athlete_id)===String(athleteId);});
        if(_ix>=0)_rankH=_ix+1;
      }
      if(typeof window.renderDashHybridExtras==='function'){
        window.renderDashHybridExtras({
          days:days7,targetKm:_targetKmH,todayKm:dayKm[todayLocal]||0,
          points:myPts,streak:streak,streakLive:streakIsLive,rank:_rankH
        });
      }
      // Defensive: re-assert arc/rings visibility in case a classic-dashboard event
      // re-showed the rings host after our earlier render (belt & braces).
      try{
        if(localStorage.getItem('ag_dyn_dash')!=='1'){
          var showArc = false;
          if (EVENT_ROW && EVENT_ROW.rules_config && EVENT_ROW.rules_config.dashboard && EVENT_ROW.rules_config.dashboard.sections) {
            var sec = EVENT_ROW.rules_config.dashboard.sections;
            if (sec.show_arc_on_dashboard !== undefined) {
              showArc = !!sec.show_arc_on_dashboard;
            } else {
              try {
                var brCache = JSON.parse(localStorage.getItem('ag_branding_cache') || '{}');
                showArc = !!brCache.show_arc_on_dashboard;
              } catch(e) {}
            }
          } else {
            try {
              var brCache = JSON.parse(localStorage.getItem('ag_branding_cache') || '{}');
              showArc = !!brCache.show_arc_on_dashboard;
            } catch(e) {}
          }
          var _arcW2=document.getElementById('hero-arc-wrap');
          var _ringsH2=document.getElementById('medal-rings');
          if (showArc) {
            if(_arcW2 && _arcW2.style.display==='none') _arcW2.style.display='block';
            if(_ringsH2) _ringsH2.style.display='none';
          } else {
            if(_arcW2) _arcW2.style.display='none';
            if(_ringsH2 && _ringsH2.style.display==='none') _ringsH2.style.display='flex';
          }
        }
      }catch(e2){}
    }catch(e){try{console.error('[hybrid-dash]',e);}catch(e4){}}

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

      function renderDashboardChallenges(items){
        var container = document.getElementById('dashboard-challenges-list');
        if(!container) return;
        var card = document.getElementById('challenges-card-container');
        if(!items.length){
          if(card) card.style.display = 'none';
          return;
        }
        if(card) card.style.display = 'block';
        var html = '';
        items.forEach(function(ch){
          var pillColor = ch.earned ? 'var(--green)' : ch.missed ? 'rgba(255,255,255,0.15)' : 'var(--brand)';
          var statusLabel = ch.earned ? 'EARNED' : ch.missed ? 'MISSED' : 'ACTIVE';
          html += '<div class="today-act-row" onclick="openChallengesDrawer();" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; transition:background 0.2s; cursor:pointer;" onmouseenter="this.style.background=\'rgba(255,255,255,0.06)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.03)\'">' +
                    '<div style="display:flex; align-items:center; gap:14px; min-width:0;">' +
                      '<div style="background:' + pillColor + '; display:flex; align-items:center; justify-content:center; padding:6px 12px; border-radius:8px; min-width:44px; height:30px; box-sizing:border-box; color:#fff; font-weight:700; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">' +
                        ch.emoji +
                      '</div>' +
                      '<div style="font-size:13px; font-weight:700; color:#fff; letter-spacing:0.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;">' + esc(ch.name) + '</div>' +
                    '</div>' +
                    '<div style="display:flex; align-items:center; gap:10px;">' +
                      '<div style="display:flex; flex-direction:column; align-items:flex-end; font-size:11px; color:rgba(255,255,255,0.65); font-weight:600; line-height:1.3; font-family:var(--font);">' +
                        '<div>+' + ch.pts + ' PTS</div>' +
                        '<div style="color:rgba(255,255,255,0.4); font-size:10px;">' + statusLabel + '</div>' +
                      '</div>' +
                      '<div style="width:3px; height:26px; background:' + pillColor + '; border-radius:2px;"></div>' +
                    '</div>' +
                  '</div>';
        });
        container.innerHTML = html;
      }

      var sortedCh = combined.sort(function(a,b){return (b.start_date||'').localeCompare(a.start_date||'');});
      var dashItems=[];
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
        dashItems.push({name:toTitleCase(ch.name), emoji:getChallengeEmoji(ch.name), earned:earned, missed:missed, pts: Math.round(earned?displayPts:ch.bonus_points)});
        
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
      renderDashboardChallenges(dashItems.slice(0,3));
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
  if (typeof initParticipantSessionTracking === 'function') {
    initParticipantSessionTracking();
  }

  if (typeof loadBranding === 'function') {
    loadBranding();
  }

  window._stravaSyncHeaderEnabled = false;
  try {
    var flagRes = await fetch(BACKEND + '/app-feature-flags');
    var flagData = await flagRes.json();
    window._stravaSyncHeaderEnabled = !!(flagData && flagData.strava_sync_header_enabled);
  } catch (e) {}
  var syncBtnEl = document.getElementById('strava-sync-btn');
  if (syncBtnEl && !window._stravaSyncHeaderEnabled) syncBtnEl.style.display = 'none';

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
    
    // Refresh notifications every 15 seconds for real-time updates when app is open
    if (!window._notifPollInterval) {
      window._notifPollInterval = setInterval(loadNotifications, 15000);
    }

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
    var styleFunc = typeof getWhoopAvatarStyle === 'function' ? getWhoopAvatarStyle : function() { return (typeof getFallbackAvatarStyle === 'function') ? getFallbackAvatarStyle() : 'background:#282e36; border:2px solid #E8622A; color:#fff;'; };
    
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
    card.innerHTML = '<div style="text-align:center;padding:15px;color:rgba(255,255,255,0.4);font-size:13px;">Loading past events...</div>';

    var res = await fetch(SUPABASE_URL + '/rest/v1/registration?email=eq.' + encodeURIComponent(reg.email) + '&event_id=neq.' + reg.event_id + '&select=event_id,event_name,leaderboard_team,gender,shift,strava_athlete_id', { headers: HDR });
    var otherRegs = await res.json();
    if (!Array.isArray(otherRegs) || otherRegs.length === 0) {
      card.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);font-size:13.5px;">No Past Event Performed</div>';
      return;
    }

    var pastEventIds = otherRegs.map(function(r) { return r.event_id; });

    // Run all three lookups in parallel (was 3 sequential round-trips)
    var eventMap = {};
    var configMap = {};
    var rankMap = {};
    var summaryMap = {}; // athleteId_eventId -> summary row (reused for stats, no per-event fetch needed)

    var lookups = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/events?select=id,name,status,end_date', { headers: HDR })
        .then(function(r) { return r.json(); }).catch(function() { return []; }),
      fetch(SUPABASE_URL + '/rest/v1/leaderboard_config?event_id=in.(' + pastEventIds.join(',') + ')&select=event_id,config_key,config_value', { headers: HDR })
        .then(function(r) { return r.json(); }).catch(function() { return []; }),
      fetch(SUPABASE_URL + '/rest/v1/athlete_points_summary?event_id=in.(' + pastEventIds.join(',') + ')&select=athlete_id,event_id,total_points,total_distance_km,activities_count&order=event_id.asc,total_points.desc', { headers: HDR })
        .then(function(r) { return r.json(); }).catch(function() { return []; })
    ]);

    var eventsList = lookups[0];
    if (Array.isArray(eventsList)) {
      eventsList.forEach(function(e) {
        eventMap[e.id] = e;
      });
    }

    var cfgRows = lookups[1];
    if (Array.isArray(cfgRows)) {
      cfgRows.forEach(function(row) {
        if (!configMap[row.event_id]) configMap[row.event_id] = {};
        configMap[row.event_id][row.config_key] = row.config_value;
      });
    }

    var rankRows = lookups[2];
    if (Array.isArray(rankRows)) {
      rankRows.forEach(function(row) {
        if (!rankMap[row.event_id]) rankMap[row.event_id] = [];
        rankMap[row.event_id].push(String(row.athlete_id));
        summaryMap[String(row.athlete_id) + '_' + row.event_id] = row;
      });
    }

    var html = '';
    otherRegs.sort(function(a, b) { return a.event_id - b.event_id; });
    window.pastCertDataMap = {};

    for (var i = 0; i < otherRegs.length; i++) {
      var pReg = otherRegs[i];
      var pastEventId = pReg.event_id;
      var eventObj = eventMap[pastEventId] || null;
      var pastEventName = eventObj ? eventObj.name : (pReg.event_name || (pastEventId === 1 ? 'Walkathon 2026' : 'Event ' + pastEventId));
      var team = pReg.leaderboard_team || 'No Team';
      
      var scoreObj = summaryMap[String(pReg.strava_athlete_id) + '_' + pastEventId] || null;

      var totalKm = 0;
      var totalPts = 0;
      var actsCount = 0;

      if (scoreObj) {
        totalKm = parseFloat(scoreObj.total_distance_km || 0);
        totalPts = parseFloat(scoreObj.total_points || 0);
        actsCount = parseInt(scoreObj.activities_count || 0);
      } else {
        try {
          var actRes = await fetch(SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + pReg.strava_athlete_id + '&event_id=eq.' + pastEventId + '&is_deleted=eq.false&select=distance_meters,is_flagged', { headers: HDR });
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

      var eventCfg = configMap[pastEventId] || {};
      var certCfg = eventCfg['certificate_config'];
      var medalsCfg = eventCfg['medals'];

      var goldThresh = 300;
      var silverThresh = 200;
      var bronzeThresh = 125;
      
      if (medalsCfg) {
        var gender = pReg.gender || 'male';
        if (gender !== 'male' && gender !== 'female') gender = 'male';
        
        goldThresh = (medalsCfg.gold && medalsCfg.gold[gender]) || goldThresh;
        silverThresh = (medalsCfg.silver && medalsCfg.silver[gender]) || silverThresh;
        bronzeThresh = (medalsCfg.bronze && medalsCfg.bronze[gender]) || bronzeThresh;
      } else {
        var isCycling = pastEventName.toLowerCase().indexOf('cycling') > -1 || pastEventName.toLowerCase().indexOf('cyclothon') > -1 || pastEventId === 2;
        if (isCycling) {
          goldThresh = 750; silverThresh = 500; bronzeThresh = 250;
        }
      }

      var medalBadge = '🏅';
      var medalTitle = 'Participant';
      if (totalPts >= goldThresh) {
        medalBadge = '🥇';
        medalTitle = 'Gold Medal';
      } else if (totalPts >= silverThresh) {
        medalBadge = '🥈';
        medalTitle = 'Silver Medal';
      } else if (totalPts >= bronzeThresh) {
        medalBadge = '🥉';
        medalTitle = 'Bronze Medal';
      }

      var medalImageUrl = '';
      if (medalsCfg) {
        var tier = '';
        if (medalTitle === 'Gold Medal') tier = 'gold';
        else if (medalTitle === 'Silver Medal') tier = 'silver';
        else if (medalTitle === 'Bronze Medal') tier = 'bronze';
        
        if (tier && medalsCfg[tier] && medalsCfg[tier].image_url) {
          medalImageUrl = medalsCfg[tier].image_url;
        }
      }

      var medalBadgeHtml = '';
      if (medalImageUrl) {
        medalBadgeHtml = '<img src="' + medalImageUrl + '" style="width:28px;height:28px;object-fit:contain;border-radius:50%;" title="' + medalTitle + '">';
      } else {
        medalBadgeHtml = '<span style="font-size:22px;line-height:1;" title="' + medalTitle + '">' + medalBadge + '</span>';
      }

      // Check if event has ended and certificate config template is set
      var hasEnded = eventObj ? (eventObj.status === 'ended') : false;
      // Pre-2027 Walkathon 2026 fallback check if no db config exists
      if (pastEventId === 1 && !certCfg) {
        certCfg = {
          template_url: 'certificate_template_walkathon_2026.pdf',
          download_options: ['image', 'pdf'],
          placeholders: [
            { key: '<Participant Name>', type: 'participant_name', x: 0.22, y: 0.31, font_size: 52, color: '#E8622A', font_style: 'bold', align: 'left' },
            { key: '<MEDAL>', type: 'medal_title', x: 0.40, y: 0.75, font_size: 36, color: '#1A1D20', font_style: 'normal', align: 'left' }
          ],
          enabled: true
        };
        hasEnded = true; // Hardcoded true for 2026 historical event
      }

      var showDownloadBtn = hasEnded && certCfg && certCfg.enabled === true && (certCfg.template_url || certCfg.canvas_mode === 'blank');

      var athleteRank = null;
      var totalParticipants = rankMap[pastEventId] ? rankMap[pastEventId].length : 0;
      if (rankMap[pastEventId]) {
        var idx = rankMap[pastEventId].indexOf(String(pReg.strava_athlete_id));
        if (idx > -1) athleteRank = idx + 1;
      }

      if (showDownloadBtn) {
        window.pastCertDataMap[pastEventId] = {
          name: reg.full_name || 'Participant',
          medal: medalTitle,
          distance: totalKm,
          points: totalPts,
          rank: athleteRank,
          totalParticipants: totalParticipants,
          eventName: pastEventName,
          config: certCfg,
          medals: medalsCfg
        };
      }

      var borderStyle = i === otherRegs.length - 1 ? 'border-bottom:none;' : '';

      html += '<div class="tab-you-detail-row" style="' + borderStyle + 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);overflow:visible;">' +
        '<div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">' +
          '<span style="font-size:14px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + pastEventName + '</span>' +
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);">' + team + ' &middot; ' + actsCount + ' workouts</span>' +
        '</div>' +
        '<div style="text-align:right;display:flex;align-items:center;gap:12px;flex-shrink:0;position:relative;overflow:visible;">' +
          '<div style="display:flex;flex-direction:column;">' +
            '<span style="font-size:14px;font-weight:800;color:var(--brand);">' + totalKm.toFixed(1) + ' km</span>' +
            '<span style="font-size:10px;color:rgba(255,255,255,0.4);">' + totalPts.toFixed(0) + ' pts</span>' +
          '</div>' +
          medalBadgeHtml +
          (showDownloadBtn ? (
            '<div style="position:relative;overflow:visible;">' +
              '<button id="btn-download-' + pastEventId + '" class="btn btn-sm" onclick="togglePastCertMenu(event, ' + pastEventId + ')" style="font-size:10px;font-weight:700;padding:5px 10px;border:none;border-radius:6px;cursor:pointer;background:var(--brand);color:#fff;text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:4px;"><i class="ti ti-certificate"></i> Certificate</button>' +
              '<div id="cert-menu-' + pastEventId + '" class="past-cert-menu" style="display:none;position:absolute;right:0;top:28px;background:#1e222b;border:1px solid rgba(255,255,255,0.1);border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,0.3);z-index:100;min-width:120px;overflow:hidden;">' +
                ((certCfg.download_options || []).indexOf('image') > -1 ? '<a href="javascript:void(0)" onclick="downloadPastCertAction(\'image\', ' + pastEventId + ')" style="display:block;padding:8px 12px;color:#fff;font-size:11px;text-align:left;text-decoration:none;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.05);" onmouseenter="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseleave="this.style.background=\'none\'">Photo (JPEG)</a>' : '') +
                ((certCfg.download_options || []).indexOf('pdf') > -1 ? '<a href="javascript:void(0)" onclick="downloadPastCertAction(\'pdf\', ' + pastEventId + ')" style="display:block;padding:8px 12px;color:#fff;font-size:11px;text-align:left;text-decoration:none;font-weight:600;" onmouseenter="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseleave="this.style.background=\'none\'">PDF Document</a>' : '') +
              '</div>' +
            '</div>'
          ) : '') +
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

/* ═══ Unified Medal Arc renderer (WHOOP hybrid redesign, Phase 2) ═══
   Draws one 240° gauge arc with medal-threshold ticks from the same
   points data that fills the classic rings. Classic rings stay in the
   DOM (hidden) so app-drawers.js pct reads keep working. Skipped when
   an event uses the dynamic dashboard (ag_dyn_dash). */
window.renderHeroArc = function(myPts, medals, eventRow) {
  try {
    if (localStorage.getItem('ag_dyn_dash') === '1') return;
  } catch(e) {}
  var wrap = document.getElementById('hero-arc-wrap');
  var host = document.getElementById('medal-rings');
  
  var showArc = false;
  if (eventRow && eventRow.rules_config && eventRow.rules_config.dashboard && eventRow.rules_config.dashboard.sections) {
    var sec = eventRow.rules_config.dashboard.sections;
    if (sec.show_arc_on_dashboard !== undefined) {
      showArc = !!sec.show_arc_on_dashboard;
    } else {
      try {
        var brCache = JSON.parse(localStorage.getItem('ag_branding_cache') || '{}');
        showArc = !!brCache.show_arc_on_dashboard;
      } catch(e) {}
    }
  } else {
    try {
      var brCache = JSON.parse(localStorage.getItem('ag_branding_cache') || '{}');
      showArc = !!brCache.show_arc_on_dashboard;
    } catch(e) {}
  }

  if (!showArc) {
    if (wrap) wrap.style.display = 'none';
    if (host) host.style.display = 'flex';
    return;
  }

  var svg = document.getElementById('hero-arc-svg');
  var legend = document.getElementById('hero-arc-legend');
  if (!wrap || !svg || !legend || !medals || !medals.length) return;

  var NS = 'http://www.w3.org/2000/svg';
  var CX = 140, CY = 112, R = 100;
  var START = 150, SWEEP = 240;          // degrees
  var ARCLEN = 2 * Math.PI * R * (SWEEP / 360); // ≈ 418.9

  function pt(frac, radius) {
    var a = (START + SWEEP * frac) * Math.PI / 180;
    return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
  }
  var p0 = pt(0, R), p1 = pt(1, R);
  var d = 'M ' + p0.x.toFixed(1) + ' ' + p0.y.toFixed(1) +
          ' A ' + R + ' ' + R + ' 0 1 1 ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1);

  var goldThresh = medals[medals.length - 1].thresh || 1;
  var frac = Math.max(0, Math.min(1, myPts / goldThresh));

  // rebuild svg
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  var bg = document.createElementNS(NS, 'path');
  bg.setAttribute('class', 'hero-arc-bg');
  bg.setAttribute('d', d);
  svg.appendChild(bg);

  var fg = document.createElementNS(NS, 'path');
  fg.setAttribute('class', 'hero-arc-fg');
  fg.setAttribute('d', d);
  fg.setAttribute('stroke-dasharray', ARCLEN.toFixed(1));
  fg.setAttribute('stroke-dashoffset', ARCLEN.toFixed(1));
  svg.appendChild(fg);

  medals.forEach(function(m) {
    var f = Math.max(0, Math.min(1, m.thresh / goldThresh));
    var a = pt(f, R + 10), b = pt(f, R + 22);
    var tick = document.createElementNS(NS, 'line');
    tick.setAttribute('class', 'hero-arc-tick');
    tick.setAttribute('x1', a.x.toFixed(1)); tick.setAttribute('y1', a.y.toFixed(1));
    tick.setAttribute('x2', b.x.toFixed(1)); tick.setAttribute('y2', b.y.toFixed(1));
    tick.setAttribute('stroke', m.color);
    tick.setAttribute('opacity', myPts >= m.thresh ? '1' : '0.55');
    svg.appendChild(tick);
  });

  // center value & label
  var valEl = document.getElementById('hero-arc-value');
  if (valEl) valEl.textContent = Math.round(myPts).toLocaleString('en-IN');
  var lblEl = document.querySelector('.hero-arc-lbl');
  if (lblEl) lblEl.textContent = getEventScoreLabel();

  // legend
  while (legend.firstChild) legend.removeChild(legend.firstChild);
  medals.forEach(function(m) {
    var done = myPts >= m.thresh;
    var item = document.createElement('div');
    item.className = 'hero-arc-ml';
    var dot = document.createElement('i');
    dot.style.background = m.color;
    item.appendChild(dot);
    var txt = document.createElement('span');
    txt.textContent = done ? (m.lbl + ' \u2713') : (m.lbl + ' ' + Math.round(m.thresh).toLocaleString('en-IN'));
    if (done) item.style.color = m.color;
    item.appendChild(txt);
    legend.appendChild(item);
  });

  // next-milestone banner
  var banner = document.getElementById('hero-next-banner');
  if (banner) {
    var icons = ['\uD83E\uDD49', '\uD83E\uDD48', '\uD83E\uDD47']; // 🥉🥈🥇
    var next = null, nextIdx = -1;
    for (var i = 0; i < medals.length; i++) {
      if (myPts < medals[i].thresh) { next = medals[i]; nextIdx = i; break; }
    }
    var icEl = document.getElementById('hero-next-ic');
    var tEl = document.getElementById('hero-next-title');
    var sEl = document.getElementById('hero-next-sub');
    var pEl = document.getElementById('hero-next-pct');
    if (next) {
      var needed = next.thresh - myPts;
      var pct = Math.min(99, Math.floor((myPts / next.thresh) * 100));
      var sub = pct + '% of the way there';
      // pace estimate from event elapsed days
      try {
        if (eventRow && eventRow.start_date) {
          var elapsed = Math.max(1, Math.round((Date.now() - new Date(eventRow.start_date).getTime()) / 86400000));
          var rate = myPts / elapsed;
          if (rate > 0.01) {
            var days = Math.ceil(needed / rate);
            sub = 'About ' + days + ' day' + (days === 1 ? '' : 's') + ' at your current pace';
          }
        }
      } catch(e) {}
      if (icEl) icEl.textContent = icons[nextIdx] || '\uD83C\uDFC5';
      if (tEl) tEl.textContent = next.lbl + ' is ' + Math.round(needed).toLocaleString('en-IN') + ' ' + getEventScoreUnit() + ' away';
      if (sEl) sEl.textContent = sub;
      if (pEl) { pEl.textContent = pct + '%'; pEl.style.color = next.color; }
      banner.style.display = 'flex';
    } else {
      if (icEl) icEl.textContent = '\uD83C\uDFC6';
      if (tEl) tEl.textContent = 'All medals earned!';
      if (sEl) sEl.textContent = 'Incredible effort \u2014 you\u2019ve conquered every milestone';
      if (pEl) { pEl.textContent = '\u2713'; pEl.style.color = 'var(--green)'; }
      banner.style.display = 'flex';
    }
  }

  // show arc, hide classic rings (they stay updated & readable by drawers)
  wrap.style.display = 'block';
  var host = document.getElementById('medal-rings');
  if (host) host.style.display = 'none';

  // animate fill in
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      fg.setAttribute('stroke-dashoffset', (ARCLEN * (1 - frac)).toFixed(1));
    });
  });
};

/* ═══ Phase 2b renderer: day strip + stat chips (WHOOP hybrid) ═══
   Called from the streak section with per-day km data already computed. */
window.renderDashHybridExtras = function(opts) {
  var NS = 'http://www.w3.org/2000/svg';
  var days = opts.days || [];          // [{str,label,dayNum,km,isToday}]
  var targetKm = Math.max(0.5, opts.targetKm || 0);

  // ── 7-day mini-ring strip ──
  var strip = document.getElementById('day-strip');
  if (strip) {
    while (strip.firstChild) strip.removeChild(strip.firstChild);
    var CIRC = 2 * Math.PI * 8; // r=8 → ≈50.3
    days.forEach(function(d) {
      var cell = document.createElement('div');
      cell.className = 'day-cell' + (d.isToday ? ' today' : '');
      var dw = document.createElement('div');
      dw.className = 'dw';
      dw.textContent = d.label;
      var dn = document.createElement('div');
      dn.className = 'dn';
      dn.textContent = d.dayNum;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 20 20');
      var bg = document.createElementNS(NS, 'circle');
      bg.setAttribute('class', 'day-ring-bg');
      bg.setAttribute('cx', '10'); bg.setAttribute('cy', '10'); bg.setAttribute('r', '8');
      svg.appendChild(bg);
      var frac = Math.max(0, Math.min(1, d.km / targetKm));
      if (frac > 0.005) {
        var fgc = document.createElementNS(NS, 'circle');
        fgc.setAttribute('class', 'day-ring-fg');
        fgc.setAttribute('cx', '10'); fgc.setAttribute('cy', '10'); fgc.setAttribute('r', '8');
        fgc.setAttribute('stroke-dasharray', CIRC.toFixed(1));
        fgc.setAttribute('stroke-dashoffset', (CIRC * (1 - frac)).toFixed(1));
        fgc.setAttribute('transform', 'rotate(-90 10 10)');
        if (frac >= 1) fgc.style.filter = 'drop-shadow(0 0 4px rgba(232,98,42,0.6))';
        svg.appendChild(fgc);
      }
      cell.appendChild(dw); cell.appendChild(dn); cell.appendChild(svg);
      cell.title = d.km.toFixed(1) + ' / ' + targetKm.toFixed(1) + ' km';
      if (d.km > 0) {
        cell.style.cursor = 'pointer';
        cell.onclick = function() {
          var myActs = window._myActsGlobal || [];
          var dayActs = myActs.filter(function(a) {
            var datePart = a.activity_date ? a.activity_date.split('T')[0] : null;
            return datePart === d.str && !a.is_flagged;
          });
          if (dayActs.length > 0) {
            var act = dayActs[0];
            if (typeof openActivityDetail === 'function') {
              openActivityDetail(act.strava_activity_id || act.id, null, !!act.strava_activity_id);
            }
          } else {
            if (typeof showDateDetails === 'function') {
              showDateDetails(d.str);
            }
          }
        };
      }
      strip.appendChild(cell);
    });
    strip.style.display = 'flex';
  }

  // ── stat chips: km today · points · streak · rank ──
  var chips = document.getElementById('stat-chips');
  if (chips) {
    while (chips.firstChild) chips.removeChild(chips.firstChild);
    function chip(val, label, cls) {
      var c = document.createElement('div');
      c.className = 'stat-chip';
      if (label === 'day streak') {
        c.style.cursor = 'pointer';
        c.onclick = function() {
          if (typeof openStreakDrawer === 'function') {
            openStreakDrawer();
          }
        };
      }
      var v = document.createElement('div');
      v.className = 'scv' + (cls ? ' ' + cls : '');
      v.textContent = val;
      var k = document.createElement('div');
      k.className = 'sck';
      k.textContent = label;
      c.appendChild(v); c.appendChild(k);
      chips.appendChild(c);
    }
    chip(opts.todayKm.toFixed(1), 'km today', 'brand');
    var scoreUnit = typeof getEventScoreUnit === 'function' ? getEventScoreUnit() : 'points';
    chip(Math.round(opts.points).toLocaleString('en-IN'), scoreUnit, '');
    chip(opts.streak + (opts.streakLive && opts.streak > 0 ? '\uD83D\uDD25' : ''), 'day streak', 'green');
    chip(opts.rank ? '#' + opts.rank : '\u2014', 'rank', '');
    chips.style.display = 'flex';
  }
};

/* ═══ Phase 4: You-tab medal shelf renderer (WHOOP hybrid) ═══ */
window.renderMedalShelf = function(myPts, medals) {
  try {
    var shelf = document.getElementById('you-medal-shelf');
    if (!shelf || !medals || !medals.length) return;
    while (shelf.firstChild) shelf.removeChild(shelf.firstChild);
    medals.forEach(function(m) {
      var earned = myPts >= m.thresh;
      var item = document.createElement('div');
      item.className = 'yms-item ' + (earned ? 'earned' : 'locked');
      var ic = document.createElement('div');
      ic.className = 'yms-ic';
      ic.style.borderColor = m.color;
      ic.textContent = m.ic;
      var lbl = document.createElement('div');
      lbl.className = 'yms-lbl';
      lbl.textContent = m.lbl;
      item.appendChild(ic); item.appendChild(lbl);
      var unit = typeof getEventScoreUnit === 'function' ? getEventScoreUnit() : 'pts';
      item.title = earned ? (m.lbl + ' earned') : (m.lbl + ' at ' + Math.round(m.thresh).toLocaleString('en-IN') + ' ' + unit);
      shelf.appendChild(item);
    });
    shelf.style.display = 'flex';
  } catch(e) { try{console.error('[medal-shelf]',e);}catch(e6){} }
};

window.initParticipantSession = function(user) {
  if (!user || !user.loggedIn) return;
  try {
    var devUuid = localStorage.getItem('wk_device_uuid');
    if (!devUuid) {
      devUuid = 'dev_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
      localStorage.setItem('wk_device_uuid', devUuid);
    }

    var sessUuid = sessionStorage.getItem('wk_session_uuid');
    var isNewSession = false;
    if (!sessUuid) {
      sessUuid = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
      sessionStorage.setItem('wk_session_uuid', sessUuid);
      isNewSession = true;
    }

    var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    var devType = isMobile ? 'Mobile' : 'Web';
    
    var ua = navigator.userAgent;
    var browserName = "Generic Browser";
    if (ua.indexOf("Firefox") > -1) browserName = "Firefox";
    else if (ua.indexOf("SamsungBrowser") > -1) browserName = "Samsung Browser";
    else if (ua.indexOf("Opera") > -1 || ua.indexOf("OPR") > -1) browserName = "Opera";
    else if (ua.indexOf("Trident") > -1) browserName = "Internet Explorer";
    else if (ua.indexOf("Edge") > -1 || ua.indexOf("Edg") > -1) browserName = "Edge";
    else if (ua.indexOf("Chrome") > -1) browserName = "Chrome";
    else if (ua.indexOf("Safari") > -1) browserName = "Safari";

    var payload = {
      session_uuid: sessUuid,
      device_uuid: devUuid,
      emp_code: user.empCode || 'STRAVA_' + user.athleteId,
      email: user.email || '',
      athlete_name: user.name || 'Participant',
      device_type: devType,
      device_name: browserName,
      pwa_installed: isPWA
    };

    var backendUrl = typeof BACKEND !== 'undefined' ? BACKEND : 'https://agwalk-backend.onrender.com';

    if (isNewSession) {
      fetch(backendUrl + '/participant/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function(e) {});
    } else {
      fetch(backendUrl + '/participant/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_uuid: sessUuid })
      }).catch(function(e) {});
    }

    if (!window._sessHeartbeatInterval) {
      window._sessHeartbeatInterval = setInterval(function() {
        fetch(backendUrl + '/participant/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_uuid: sessUuid })
        }).catch(function(e) {});
      }, 120000);
    }

    // End session on tab/browser close
    window.addEventListener('pagehide', function() {
      if (sessUuid) {
        fetch(backendUrl + '/participant/session/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_uuid: sessUuid }),
          keepalive: true
        }).catch(function(e){});
      }
    });
  } catch(e) {
    console.warn('Session init failed:', e);
  }
};

window.togglePastCertMenu = function(e, pastEventId) {
  e.stopPropagation();
  document.querySelectorAll('.past-cert-menu').forEach(function(m) {
    if (m.id !== 'cert-menu-' + pastEventId) {
      m.style.display = 'none';
    }
  });
  var menu = document.getElementById('cert-menu-' + pastEventId);
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
};

document.addEventListener('click', function() {
  document.querySelectorAll('.past-cert-menu').forEach(function(m) {
    m.style.display = 'none';
  });
  var menu = document.getElementById('cert-menu');
  if (menu) menu.style.display = 'none';
});

window.downloadPastCertAction = function(type, pastEventId) {
  var certData = window.pastCertDataMap && window.pastCertDataMap[pastEventId];
  if (!certData) {
    alert('Certificate data not found for this event.');
    return;
  }

  var btn = document.getElementById('btn-download-' + pastEventId);
  var origText = btn ? btn.innerHTML : 'Certificate';
  if (btn) {
    btn.textContent = 'Wait...';
    btn.disabled = true;
  }

  var name = certData.name;
  if (name && name === name.toUpperCase()) {
    name = name.toLowerCase().split(' ').map(function(word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  var url = certData.config.template_url;
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }

  // Load Google Fonts first
  var placeholders = certData.config.placeholders || [];
  placeholders.forEach(function(p) {
    if (p.font_family) {
      window.loadGoogleFont(p.font_family);
    }
  });

  window._certBgCache = window._certBgCache || {};
  var cacheKey = pastEventId;
  var cachedBg = window._certBgCache[cacheKey];

  var isBlankMode = certData.config.canvas_mode === 'blank';

  var renderPipeline;
  if (isBlankMode) {
    // Full-design mode: solid background canvas, no PDF fetch/render at all
    renderPipeline = document.fonts.ready.then(function() {
      var bc = document.createElement('canvas');
      if ((certData.config.canvas_orientation || 'landscape') === 'portrait') {
        bc.width = 1414; bc.height = 2000;
      } else {
        bc.width = 2000; bc.height = 1414;
      }
      var bcx = bc.getContext('2d');
      bcx.fillStyle = certData.config.canvas_bg || '#ffffff';
      bcx.fillRect(0, 0, bc.width, bc.height);
      return bc;
    });
  } else if (cachedBg) {
    // Background PDF already fetched + rasterized this session - clone it and skip straight to overlay drawing
    renderPipeline = document.fonts.ready.then(function() {
      var clone = document.createElement('canvas');
      clone.width = cachedBg.width;
      clone.height = cachedBg.height;
      clone.getContext('2d').drawImage(cachedBg, 0, 0);
      return clone;
    });
  } else {
    renderPipeline = pdfjsLib.getDocument(url).promise.then(function(pdf) {
      return pdf.getPage(1);
    }).then(function(page) {
      var viewport = page.getViewport({ scale: 1.5 });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');

      var renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };
      return page.render(renderContext).promise.then(function() {
        return document.fonts.ready.then(function() {
          // Cache a clone of the freshly-rendered background before any overlay is drawn on it
          var bgClone = document.createElement('canvas');
          bgClone.width = canvas.width;
          bgClone.height = canvas.height;
          bgClone.getContext('2d').drawImage(canvas, 0, 0);
          window._certBgCache[cacheKey] = bgClone;
          return canvas;
        });
      });
    });
  }

  renderPipeline.then(function(canvas) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;

    var placeholders = certData.config.placeholders || [];

    // 1. Cover the placeholder region (PDF-template mode only; blank canvases have nothing to cover)
    placeholders.forEach(function(p) {
      if (isBlankMode) return;
      if (p.type === 'medal_image' || p.type === 'static_image') return;
      if (p.transparent_bg) return;
      
      var isStat = certStatLabel(p.type) !== null;
      var textVal = p.key;
      if (p.type === 'participant_name') textVal = name;
      else if (isStat) textVal = certStatValue(p.type, certData);
      else if (p.type === 'custom') textVal = p.custom_val || '';

      var templateText = p.key || '';

      ctx.save();
      var family = p.font_family || 'Poppins';
      var fontSize = Math.round(p.font_size * (w / 2000));
      ctx.font = (p.font_style === 'bold' ? 'bold ' : '') + fontSize + 'px "' + family + '", "Georgia", sans-serif';
      var valWidth = ctx.measureText(textVal).width;
      var templateWidth = ctx.measureText(templateText).width;
      var textWidth = Math.max(valWidth, templateWidth);
      if (isStat) {
        ctx.font = Math.round(fontSize * 0.42) + 'px "' + family + '", sans-serif';
        textWidth = Math.max(textWidth, ctx.measureText(certStatLabel(p.type)).width);
      }
      
      var textX = w * p.x;
      var textY = h * p.y;
      var boxX = textX;
      
      if (p.align === 'center') boxX = textX - textWidth / 2;
      else if (p.align === 'right') boxX = textX - textWidth;
      
      ctx.fillStyle = '#ffffff';
      var paddingX = Math.round(25 * (w / 2000));
      if (isStat) {
        ctx.fillRect(boxX - paddingX, textY - fontSize * 1.1, textWidth + (paddingX * 2), fontSize * 2.05);
      } else {
        var boxHeight = fontSize * 1.5;
        ctx.fillRect(boxX - paddingX, textY - boxHeight / 2, textWidth + (paddingX * 2), boxHeight);
      }
      ctx.restore();
    });

    // 2. Draw actual text values (stat types render as small label + big value pair)
    placeholders.forEach(function(p) {
      if (p.type === 'medal_image' || p.type === 'static_image') return;

      var family = p.font_family || 'Poppins';
      var fontSize = Math.round(p.font_size * (w / 2000));
      var textX = w * p.x;
      var textY = h * p.y;
      var statLbl = certStatLabel(p.type);

      ctx.save();
      ctx.textAlign = p.align || 'left';
      ctx.textBaseline = 'middle';

      if (statLbl !== null) {
        var labelSize = Math.max(10, Math.round(fontSize * 0.42));
        ctx.fillStyle = p.color || '#000000';
        ctx.globalAlpha = 0.55;
        ctx.font = labelSize + 'px "' + family + '", sans-serif';
        try { ctx.letterSpacing = Math.round(labelSize * 0.14) + 'px'; } catch(e) {}
        ctx.fillText(statLbl, textX, textY - fontSize * 0.68);
        try { ctx.letterSpacing = '0px'; } catch(e) {}
        ctx.globalAlpha = 1;
        ctx.font = (p.font_style === 'bold' ? 'bold ' : '') + fontSize + 'px "' + family + '", "Georgia", sans-serif';
        ctx.fillText(certStatValue(p.type, certData), textX, textY + fontSize * 0.32);
      } else {
        var textVal = p.key;
        if (p.type === 'participant_name') textVal = name;
        else if (p.type === 'custom') textVal = p.custom_val || '';
        ctx.fillStyle = p.color || '#000000';
        ctx.font = (p.font_style === 'bold' ? 'bold ' : '') + fontSize + 'px "' + family + '", "Georgia", sans-serif';
        ctx.fillText(textVal, textX, textY);
      }
      ctx.restore();
    });

    // 3. Draw image values (asynchronous loader list)
    var imagePromises = [];
    placeholders.forEach(function(p) {
      if (p.type === 'static_image') {
        var sSize = Math.round(p.font_size * (w / 2000));
        var sUrl = (p.image_url || '').trim();
        if (!sUrl) return;
        var sPms = new Promise(function(resolve) {
          var sImg = new Image();
          sImg.crossOrigin = 'anonymous';
          sImg.onload = function() {
            var sH = Math.round(sSize * (sImg.naturalHeight / sImg.naturalWidth));
            ctx.drawImage(sImg, w * p.x - sSize / 2, h * p.y - sH / 2, sSize, sH);
            resolve();
          };
          sImg.onerror = function() {
            console.warn('Failed to load certificate image: ' + sUrl);
            resolve();
          };
          sImg.src = sUrl;
        });
        imagePromises.push(sPms);
        return;
      }
      if (p.type === 'medal_image') {
        var size = Math.round(p.font_size * (w / 2000));
        var imgUrl = '';
        var tier = '';
        if (certData.medal === 'Gold Medal') tier = 'gold';
        else if (certData.medal === 'Silver Medal') tier = 'silver';
        else if (certData.medal === 'Bronze Medal') tier = 'bronze';
        
        var eventCfg = (window.pastCertDataMap[pastEventId] && window.pastCertDataMap[pastEventId].config) ? window.pastCertDataMap[pastEventId].config : null;
        var medalsCfg = (window.pastCertDataMap[pastEventId] && window.pastCertDataMap[pastEventId].medals) ? window.pastCertDataMap[pastEventId].medals : null;

        if (tier && medalsCfg && medalsCfg[tier] && medalsCfg[tier].image_url) {
          imgUrl = medalsCfg[tier].image_url;
        }

        var drawEmojiMedal = function() {
          if (!tier) return; // 'Participant' (no medal earned): draw nothing
          var emoji = tier === 'gold' ? '\uD83E\uDD47' : tier === 'silver' ? '\uD83E\uDD48' : '\uD83E\uDD49';
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = Math.round(size * 0.9) + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
          ctx.fillText(emoji, w * p.x, h * p.y);
          ctx.restore();
        };

        if (imgUrl) {
          var pms = new Promise(function(resolve) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function() {
              ctx.drawImage(img, w * p.x - size / 2, h * p.y - size / 2, size, size);
              resolve();
            };
            img.onerror = function() {
              console.warn('Failed to load medal image, using emoji fallback: ' + imgUrl);
              drawEmojiMedal();
              resolve();
            };
            img.src = imgUrl;
          });
          imagePromises.push(pms);
        } else {
          drawEmojiMedal();
        }
      }
    });

    return Promise.all(imagePromises).then(function() {
      if (type === 'image') {
        var link = document.createElement('a');
        link.download = certData.eventName.replace(/\s+/g, '_') + '_Certificate_' + name.replace(/\s+/g, '_') + '.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        if (btn) {
          btn.innerHTML = origText;
          btn.disabled = false;
        }
      } else {
        var orientation = w > h ? 'l' : 'p';
        var pdfDoc = new jspdf.jsPDF({
          orientation: orientation,
          unit: 'px',
          format: [w, h]
        });
        pdfDoc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
        pdfDoc.save(certData.eventName.replace(/\s+/g, '_') + '_Certificate_' + name.replace(/\s+/g, '_') + '.pdf');
        if (btn) {
          btn.innerHTML = origText;
          btn.disabled = false;
        }
      }
    });
  }).catch(function(err) {
    console.error('Failed to generate certificate:', err);
    alert('Failed to generate certificate: ' + err.message);
    if (btn) {
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  });
};

function certStatLabel(type) {
  if (type === 'distance') return 'DISTANCE';
  if (type === 'rank') return 'RANK';
  if (type === 'points') return 'POINTS';
  if (type === 'medal_title') return 'MEDAL';
  return null;
}

function certStatValue(type, certData) {
  if (type === 'distance') return certData.distance.toFixed(1) + ' KM';
  if (type === 'points') return certData.points.toFixed(0);
  if (type === 'rank') {
    if (!certData.rank) return '-';
    return '#' + certData.rank + (certData.totalParticipants ? ' of ' + certData.totalParticipants : '');
  }
  if (type === 'medal_title') {
    var mName = String(certData.medal || '').replace(' Medal', '');
    if (mName === 'Gold') return '\ud83e\udd47 Gold';
    if (mName === 'Silver') return '\ud83e\udd48 Silver';
    if (mName === 'Bronze') return '\ud83e\udd49 Bronze';
    return mName || '-';
  }
  return '';
}

function formatOrdinalRank(n) {
  n = parseInt(n, 10);
  if (!n || n < 1) return '-';
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

window.loadGoogleFont = function(fontName) {
  if (!fontName) return;
  var fontId = 'gf-' + fontName.toLowerCase().replace(/\s+/g, '-');
  if (document.getElementById(fontId)) return;
  
  var link = document.createElement('link');
  link.id = fontId;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + fontName.replace(/\s+/g, '+') + ':wght@400;700&display=swap';
  document.head.appendChild(link);
};

// Fallbacks for older references
window.toggleCertMenu = function(e) { togglePastCertMenu(e, 1); };
window.downloadCertAction = function(type, eventName) { downloadPastCertAction(type, 1); };

window.renderMedalInsights = function() {
  var contentEl = document.getElementById('medal-insights-content');
  if (!contentEl) return;

  var myActs = window._myActsGlobal || [];
  var validActs = myActs.filter(function(a) { return !a.is_flagged; });

  var rules = (EVENT_ROW && EVENT_ROW.rules_config) ? EVENT_ROW.rules_config : {};
  var bronzeLimit = rules.bronze_medal_distance_meters || 100000;
  var silverLimit = rules.silver_medal_distance_meters || 200000;
  var goldLimit = rules.gold_medal_distance_meters || 300000;

  var totalDistM = validActs.reduce(function(s, a) { return s + (a.distance_meters || 0); }, 0);
  var currentKm = totalDistM / 1000;

  // Find max single day distance
  var dayKm = {};
  validActs.forEach(function(a) {
    var km = (a.distance_meters || 0) / 1000;
    var d = a.activity_date ? a.activity_date.split('T')[0] : null;
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

  // Calculate active streak
  var activeDays = {};
  validActs.forEach(function(a) {
    var d = a.activity_date ? a.activity_date.split('T')[0] : null;
    if (d) activeDays[d] = true;
  });
  var sortedActive = Object.keys(activeDays).sort();
  var streakBest = 0, cur = 0, prevD = null;
  sortedActive.forEach(function(d) {
    if (prevD) {
      var diff = Math.round((new Date(d + 'T12:00:00') - new Date(prevD + 'T12:00:00')) / 86400000);
      cur = diff === 1 ? cur + 1 : 1;
    } else cur = 1;
    streakBest = Math.max(streakBest, cur);
    prevD = d;
  });

  // Days left calculation
  var daysRemaining = 1;
  if (EVENT_ROW && EVENT_ROW.end_date) {
    var diff = new Date(EVENT_ROW.end_date) - new Date();
    daysRemaining = Math.max(1, Math.ceil(diff / 86400000));
  }

  // Calculate 7-day average pace
  var sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0,0,0,0);
  var last7DaysActs = validActs.filter(function(a) {
    return new Date(a.activity_date) >= sevenDaysAgo;
  });
  var last7DaysDistKM = last7DaysActs.reduce(function(s,a){return s + (a.distance_meters || 0);}, 0) / 1000;
  var avg7DayPace = last7DaysDistKM / 7;

  var activeDaysCount = Object.keys(dayKm).length || 1;
  var avgActivePace = currentKm / activeDaysCount;
  var assumedPace = Math.max(avg7DayPace, avgActivePace);
  if (assumedPace < 0.5) assumedPace = 1.0;

  var projectedDistance = currentKm + (assumedPace * daysRemaining);

  // Projections
  var projectedMedal = 'None';
  var projectedEmoji = '⚪';
  var projectedColor = '#9ca3af';
  if (projectedDistance >= (goldLimit / 1000)) {
    projectedMedal = 'GOLD';
    projectedEmoji = '🥇';
    projectedColor = '#f59e0b';
  } else if (projectedDistance >= (silverLimit / 1000)) {
    projectedMedal = 'SILVER';
    projectedEmoji = '🥈';
    projectedColor = '#9ca3af';
  } else if (projectedDistance >= (bronzeLimit / 1000)) {
    projectedMedal = 'BRONZE';
    projectedEmoji = '🥉';
    projectedColor = '#c57f35';
  }

  // Needed daily paces
  var remainingSilver = Math.max(0, (silverLimit / 1000) - currentKm);
  var remainingGold = Math.max(0, (goldLimit / 1000) - currentKm);
  var neededPaceSilver = remainingSilver / daysRemaining;
  var neededPaceGold = remainingGold / daysRemaining;

  var paceColorSilver = neededPaceSilver <= assumedPace ? '#22c55e' : '#f97316';
  var paceColorGold = neededPaceGold <= assumedPace ? '#22c55e' : '#f97316';

  // Last 10 days chart
  var chartDays = [];
  for (var i = 9; i >= 0; i--) {
    var dObj = new Date();
    dObj.setDate(dObj.getDate() - i);
    var dStr = dObj.toISOString().split('T')[0];
    chartDays.push({
      dateStr: dStr,
      label: dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      km: dayKm[dStr] || 0
    });
  }

  var maxVal = Math.max.apply(null, chartDays.map(function(d){return d.km;})) || 5;
  
  var svgHtml = '<svg viewBox="0 0 340 160" style="width: 100%; height: auto; font-family: var(--font);">';
  svgHtml += '<line x1="30" y1="20" x2="330" y2="20" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="3,3"/>';
  svgHtml += '<line x1="30" y1="70" x2="330" y2="70" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="3,3"/>';
  svgHtml += '<line x1="30" y1="120" x2="330" y2="120" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>';
  svgHtml += '<text x="22" y="24" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end">' + maxVal.toFixed(1) + '</text>';
  svgHtml += '<text x="22" y="74" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end">' + (maxVal/2).toFixed(1) + '</text>';
  svgHtml += '<text x="22" y="124" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end">0</text>';
  
  chartDays.forEach(function(day, index) {
    var x = 36 + (index * 29);
    var barHeight = Math.round(day.km * (100 / maxVal));
    var y = 120 - barHeight;
    svgHtml += '<rect class="chart-bar" x="' + x + '" y="' + y + '" width="16" height="' + Math.max(2, barHeight) + '" rx="4" fill="' + (day.km > 0 ? 'url(#bar-grad)' : 'rgba(255,255,255,0.05)') + '" style="transition: all 0.3s ease; cursor: pointer;" title="' + day.label + ': ' + day.km.toFixed(1) + ' km"/>';
    if (index % 2 === 0) {
      svgHtml += '<text x="' + (x + 8) + '" y="' + 138 + '" fill="rgba(255,255,255,0.4)" font-size="8.5" text-anchor="middle">' + day.label + '</text>';
    }
  });
  svgHtml += '<defs><linearGradient id="bar-grad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="var(--brand)"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs>';
  svgHtml += '</svg>';

  var html = '';
  html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 18px; text-align: center; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">' +
         '  <div style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px;">PROJECTED FINISH</div>' +
         '  <div style="font-size: 26px; font-weight: 800; color: ' + projectedColor + '; margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 8px;">' +
              projectedEmoji + ' ' + projectedMedal +
         '  </div>' +
         '  <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 6px;">' +
         '    Projected Event Distance: <strong style="color: #fff;">' + projectedDistance.toFixed(1) + ' km</strong>' +
         '  </div>' +
         '  <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; font-style: italic;">' +
         '    Based on your average pace of ' + assumedPace.toFixed(1) + ' km/day over ' + daysRemaining + ' remaining days.' +
         '  </div>' +
         '</div>';

  html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">' +
         '  <div style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px;">Daily Target Pace (' + daysRemaining + ' Days Left)</div>' +
         '  <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.04);">' +
         '    <div style="display: flex; align-items: center; gap: 8px;">' +
         '      <span style="font-size: 16px;">🥈</span>' +
         '      <div style="text-align: left;">' +
         '        <div style="font-size: 13px; font-weight: 700; color: #fff;">SILVER MEDAL (200 km)</div>' +
         '        <div style="font-size: 11px; color: rgba(255,255,255,0.4);">' + remainingSilver.toFixed(1) + ' km remaining</div>' +
         '      </div>' +
         '    </div>' +
         '    <div style="text-align: right;">' +
         '      <div style="font-size: 14.5px; font-weight: 800; color: ' + paceColorSilver + ';">' + (neededPaceSilver > 0 ? neededPaceSilver.toFixed(2) + ' km/day' : 'Achieved! ✔') + '</div>' +
         '    </div>' +
         '  </div>' +
         '  <div style="display: flex; align-items: center; justify-content: space-between;">' +
         '    <div style="display: flex; align-items: center; gap: 8px;">' +
         '      <span style="font-size: 16px;">🥇</span>' +
         '      <div style="text-align: left;">' +
         '        <div style="font-size: 13px; font-weight: 700; color: #fff;">GOLD MEDAL (300 km)</div>' +
         '        <div style="font-size: 11px; color: rgba(255,255,255,0.4);">' + remainingGold.toFixed(1) + ' km remaining</div>' +
         '      </div>' +
         '    </div>' +
         '    <div style="text-align: right;">' +
         '      <div style="font-size: 14.5px; font-weight: 800; color: ' + paceColorGold + ';">' + (neededPaceGold > 0 ? neededPaceGold.toFixed(2) + ' km/day' : 'Achieved! ✔') + '</div>' +
         '    </div>' +
         '  </div>' +
         '</div>';

  html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 18px 20px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">' +
         '  <div style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px; text-align: left;">LAST 10 DAYS DISTANCE</div>' +
            svgHtml +
         '</div>';

  html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">' +
         '  <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 14px; text-align: center;">' +
         '    <div style="font-size: 20px; margin-bottom: 4px;">🔥</div>' +
         '    <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">Active Streak</div>' +
         '    <div style="font-size: 16px; font-weight: 800; color: #fff; margin-top: 2px;">' + streakBest + ' days</div>' +
         '  </div>' +
         '  <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 14px; text-align: center;">' +
         '    <div style="font-size: 20px; margin-bottom: 4px;">👑</div>' +
         '    <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">Best Day</div>' +
         '    <div style="font-size: 16px; font-weight: 800; color: #22c55e; margin-top: 2px;">' + maxDayKm.toFixed(1) + ' km</div>' +
         '  </div>' +
         '</div>';

  contentEl.innerHTML = html;
};

window.renderStreakDrawerDetails = function() {
  var contentEl = document.getElementById('streak-drawer-content');
  if (!contentEl) return;

  var myActs = window._myActsGlobal || [];
  var validActs = myActs.filter(function(a) { return !a.is_flagged; });

  // Calculate active days
  var activeDays = {};
  validActs.forEach(function(a) {
    var d = a.activity_date ? a.activity_date.split('T')[0] : null;
    if (d) activeDays[d] = true;
  });
  var sortedActive = Object.keys(activeDays).sort();

  // Calculate current streak
  var curStreak = 0;
  var streakStartStr = '—';
  var todayLocal = new Date().toISOString().split('T')[0];
  var yesterdayLocal = new Date(new Date().getTime() - 86400000).toISOString().split('T')[0];
  var lastActive = sortedActive[sortedActive.length - 1];

  var streakIsLive = false;
  if (lastActive === todayLocal || lastActive === yesterdayLocal) {
    streakIsLive = true;
  }

  if (streakIsLive && sortedActive.length > 0) {
    var current = new Date(lastActive + 'T12:00:00');
    curStreak = 1;
    while (true) {
      var prev = new Date(current.getTime() - 86400000);
      var prevStr = prev.toISOString().split('T')[0];
      if (sortedActive.indexOf(prevStr) !== -1) {
        current = prev;
        curStreak++;
      } else {
        break;
      }
    }
    streakStartStr = current.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Max Streak (streakBest)
  var streakBest = 0, cur = 0, prevD = null;
  sortedActive.forEach(function(d) {
    if (prevD) {
      var diff = Math.round((new Date(d + 'T12:00:00') - new Date(prevD + 'T12:00:00')) / 86400000);
      cur = diff === 1 ? cur + 1 : 1;
    } else cur = 1;
    streakBest = Math.max(streakBest, cur);
    prevD = d;
  });

  // Calculate Percentile
  var rankH = null;
  var peersCount = 50;
  try {
    var sum = typeof cacheGet === 'function' ? (cacheGet('ranking_summaries', 300000) || cacheGet('ranking_summaries', 86400*365*1000)) : null;
    var reg = typeof regJsonData !== 'undefined' ? regJsonData : null;
    if (sum && sum.length && reg) {
      var gN = (reg.gender || '').toLowerCase(); var isF = gN === 'female' || gN === 'f';
      var sN = (reg.shift || '').toLowerCase(); var isN = sN.indexOf('night') > -1;
      var peers = sum.filter(function(p) {
        var pg = (p.gender || '').toLowerCase(), ps = (p.shift || '').toLowerCase();
        return (ps.indexOf('night') > -1) === isN && (pg === 'female' || pg === 'f') === isF;
      }).sort(function(a, b) { return (b.total_points || 0) - (a.total_points || 0); });
      peersCount = peers.length || 50;
      var ix = peers.findIndex(function(p) { return String(p.athlete_id) === String(currentSession && currentSession.athleteId); });
      if (ix >= 0) rankH = ix + 1;
    }
  } catch (eRank) {}

  var percentileStr = 'Top 50%';
  if (rankH && peersCount) {
    var percentile = Math.round((1 - (rankH - 1) / peersCount) * 100);
    var topVal = 101 - percentile;
    if (topVal < 1) topVal = 1;
    if (topVal > 100) topVal = 100;
    percentileStr = 'Top ' + topVal + '%';
  }

  // THIS WEEK Grid (Mon-Sun)
  var monday = new Date();
  var day = monday.getDay();
  var diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  monday.setHours(0,0,0,0);

  var weekDays = [];
  var weekDaysLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday.getTime() + (i * 86400000));
    var dStr = d.toISOString().split('T')[0];
    var isActive = sortedActive.indexOf(dStr) !== -1;
    weekDays.push({
      label: weekDaysLabels[i],
      dayNum: d.getDate(),
      active: isActive
    });
  }

  // Milestones Progress
  var milestoneTiers = [0, 5, 10, 15, 20, 25, 30, 50, 100, 150, 200, 250, 300];
  var prevMilestone = 0;
  var nextMilestone = 5;
  for (var idx = 0; idx < milestoneTiers.length; idx++) {
    if (curStreak >= milestoneTiers[idx]) {
      prevMilestone = milestoneTiers[idx];
      nextMilestone = milestoneTiers[idx + 1] || (prevMilestone + 50);
    } else {
      break;
    }
  }
  var daysNeeded = nextMilestone - curStreak;
  var progressPct = Math.min(100, Math.max(0, ((curStreak - prevMilestone) / (nextMilestone - prevMilestone) * 100)));

  // SVG Flame Icon
  var flameSvg = '<svg viewBox="0 0 24 24" width="80" height="80" style="filter: drop-shadow(0 4px 12px rgba(249,115,22,0.35));">' +
    '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z" fill="url(#flame-grad)"/>' +
    '<path d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" fill="#ffedd5" opacity="0.8"/>' +
    '<defs><linearGradient id="flame-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ea580c"/><stop offset="50%" stop-color="#f97316"/><stop offset="100%" stop-color="#facc15"/></linearGradient></defs>' +
    '</svg>';

  // Week Grid HTML
  var weekGridHtml = '';
  weekDays.forEach(function(wd) {
    weekGridHtml += '<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1;">' +
      '  <span style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4);">' + wd.label + '</span>' +
      '  <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; ' + 
           (wd.active ? 'background: rgba(249,115,22,0.15); border: 1.5px solid #f97316;' : 'border: 1.5px dashed rgba(255,255,255,0.15);') + '">' +
           (wd.active ? '🔥' : '') +
      '  </div>' +
      '</div>';
  });

  var html = '';
  // Top Flame & Count
  html += '<div style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 10px; margin-bottom: 10px;">' +
         '  ' + flameSvg +
         '  <div style="font-size: 56px; font-weight: 800; color: #fff; margin-top: -10px; font-family: var(--font); letter-spacing: -1px;">' + curStreak + '</div>' +
         '  <div style="font-size: 18px; font-weight: 700; color: #fff; margin-top: 2px;">Day Streak</div>' +
         '  <div style="font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 4px;">Log activities daily to maintain your streak</div>' +
         '</div>';

  // Three stats row
  html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 14px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
         '  <div>' +
         '    <div style="font-size: 13.5px; font-weight: 800; color: #fff;">' + (curStreak > 0 ? streakStartStr : '—') + '</div>' +
         '    <div style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-top: 3px;">Streak started</div>' +
         '  </div>' +
         '  <div style="border-left: 1px solid rgba(255,255,255,0.08); border-right: 1px solid rgba(255,255,255,0.08);">' +
         '    <div style="font-size: 13.5px; font-weight: 800; color: #fff;">' + (curStreak > 0 ? percentileStr : '—') + '</div>' +
         '    <div style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-top: 3px;">WHOOP Rank</div>' +
         '  </div>' +
         '  <div>' +
         '    <div style="font-size: 13.5px; font-weight: 800; color: #fff;">' + streakBest + '</div>' +
         '    <div style="font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-top: 3px;">Max streak</div>' +
         '  </div>' +
         '</div>';

  // THIS WEEK
  html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
         '  <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; text-align: left;">THIS WEEK</div>' +
         '  <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">' +
              weekGridHtml +
         '  </div>' +
         '</div>';

  // Milestone Progress
  var milestoneLabel = daysNeeded === 1 ? '1 more day' : daysNeeded + ' more days';
  html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 18px 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
         '  <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 44px;">' +
         '    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ea580c, #facc15); display: flex; align-items: center; justify-content: center; font-size: 13px;">🔥</div>' +
         '    <span style="font-size: 14px; font-weight: 800; color: #fff;">' + prevMilestone + '</span>' +
         '  </div>' +
         '  <div style="display: flex; flex-direction: column; gap: 6px; flex: 1; text-align: center;">' +
         '    <span style="font-size: 12px; font-weight: 700; color: #fff;">' + milestoneLabel + '</span>' +
         '    <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">' +
         '      <div style="width: ' + progressPct + '%; height: 100%; background: #ea580c; border-radius: 99px; transition: width 0.4s ease;"></div>' +
         '    </div>' +
         '    <span style="font-size: 11px; color: rgba(255,255,255,0.4);">to unlock your next milestone.</span>' +
         '  </div>' +
         '  <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 44px;">' +
         '    <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 1.5px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 13px; filter: grayscale(100%);">🔥</div>' +
         '    <span style="font-size: 14px; font-weight: 800; color: rgba(255,255,255,0.4);">' + nextMilestone + '</span>' +
         '  </div>' +
         '</div>';

  contentEl.innerHTML = html;
};

window.renderParticipantProfile = async function(athleteId) {
  var contentEl = document.getElementById('participant-profile-content');
  if (!contentEl) return;

  try {
    var [regRes, actsRes, pastRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=full_name,email,gender,shift,leaderboard_team,profile_photo,emp_code', { headers: HDR }).then(r => r.json()),
      fetch(SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + athleteId + '&is_deleted=eq.false&order=activity_date.desc', { headers: HDR }).then(r => r.json()),
      fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&event_id=neq.' + EVENT_ROW.id + '&select=event_name,leaderboard_team', { headers: HDR }).then(r => r.json())
    ]);

    var reg = regRes[0];
    if (!reg) {
      contentEl.innerHTML = '<p style="color:#ef4444; text-align:center; padding:20px;">Profile not found.</p>';
      return;
    }

    var eventActs = actsRes.filter(function(a) { return String(a.event_id) === String(EVENT_ROW.id); });
    var validActs = eventActs.filter(function(a) { return !a.is_flagged; });
    var totalDistM = validActs.reduce(function(s, a) { return s + (a.distance_meters || 0); }, 0);
    var currentKm = totalDistM / 1000;

    // 1. Profile Avatar & Name Header
    var photoUrl = reg.profile_photo || '';
    var initials = (reg.full_name || 'P').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    var avatarHtml = photoUrl 
      ? '<img src="' + photoUrl + '" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 2.5px solid rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">'
      : '<div style="width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #f97316, #ea580c); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; color: #fff; border: 2.5px solid rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">' + initials + '</div>';

    var html = '';
    html += '<div style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 8px;">' +
           '  ' + avatarHtml +
           '  <div style="font-size: 22px; font-weight: 800; color: #fff; margin-top: 10px; font-family: var(--font);">' + esc(reg.full_name) + '</div>' +
           '  <div style="font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 4px;">' + (reg.leaderboard_team || 'No Team') + ' · ' + (reg.shift || 'General') + '</div>' +
           '</div>';

    // 2. Medal Prediction Section
    var rules = (EVENT_ROW && EVENT_ROW.rules_config) ? EVENT_ROW.rules_config : {};
    var bronzeLimit = rules.bronze_medal_distance_meters || 100000;
    var silverLimit = rules.silver_medal_distance_meters || 200000;
    var goldLimit = rules.gold_medal_distance_meters || 300000;

    var daysRemaining = 1;
    if (EVENT_ROW && EVENT_ROW.end_date) {
      var diff = new Date(EVENT_ROW.end_date) - new Date();
      daysRemaining = Math.max(1, Math.ceil(diff / 86400000));
    }

    var sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0,0,0,0);
    var last7DaysActs = validActs.filter(function(a) {
      return new Date(a.activity_date) >= sevenDaysAgo;
    });
    var last7DaysDistKM = last7DaysActs.reduce(function(s,a){return s + (a.distance_meters || 0);}, 0) / 1000;
    var avg7DayPace = last7DaysDistKM / 7;

    var dayKm = {};
    validActs.forEach(function(a) {
      var km = (a.distance_meters || 0) / 1000;
      var d = a.activity_date ? a.activity_date.split('T')[0] : null;
      if (d) dayKm[d] = (dayKm[d] || 0) + km;
    });
    var activeDaysCount = Object.keys(dayKm).length || 1;
    var avgActivePace = currentKm / activeDaysCount;
    var assumedPace = Math.max(avg7DayPace, avgActivePace);
    if (assumedPace < 0.5) assumedPace = 1.0;

    var projectedDistance = currentKm + (assumedPace * daysRemaining);

    var projectedMedal = 'None';
    var projectedEmoji = '⚪';
    var projectedColor = '#9ca3af';
    if (projectedDistance >= (goldLimit / 1000)) {
      projectedMedal = 'GOLD';
      projectedEmoji = '🥇';
      projectedColor = '#f59e0b';
    } else if (projectedDistance >= (silverLimit / 1000)) {
      projectedMedal = 'SILVER';
      projectedEmoji = '🥈';
      projectedColor = '#9ca3af';
    } else if (projectedDistance >= (bronzeLimit / 1000)) {
      projectedMedal = 'BRONZE';
      projectedEmoji = '🥉';
      projectedColor = '#c57f35';
    }

    var remainingSilver = Math.max(0, (silverLimit / 1000) - currentKm);
    var remainingGold = Math.max(0, (goldLimit / 1000) - currentKm);
    var neededPaceSilver = remainingSilver / daysRemaining;
    var neededPaceGold = remainingGold / daysRemaining;

    var paceColorSilver = neededPaceSilver <= assumedPace ? '#22c55e' : '#f97316';
    var paceColorGold = neededPaceGold <= assumedPace ? '#22c55e' : '#f97316';

    html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
           '  <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px;">MEDAL PREDICTION</div>' +
           '  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">' +
           '    <div>' +
           '      <div style="font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600;">PROJECTED FINISH</div>' +
           '      <div style="font-size: 18px; font-weight: 800; color: ' + projectedColor + '; margin-top: 2px;">' + projectedEmoji + ' ' + projectedMedal + '</div>' +
           '    </div>' +
           '    <div style="text-align: right;">' +
           '      <div style="font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600;">PROJECTED DISTANCE</div>' +
           '      <div style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 2px;">' + projectedDistance.toFixed(1) + ' km</div>' +
           '    </div>' +
           '  </div>' +
           '  <div style="display: flex; flex-direction: column; gap: 8px;">' +
           '    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px;">' +
           '      <span style="color: rgba(255,255,255,0.6);">Needed for Silver (200k):</span>' +
           '      <span style="font-weight: 700; color: ' + paceColorSilver + ';">' + (neededPaceSilver > 0 ? neededPaceSilver.toFixed(1) + ' km/day' : 'Lock ✔') + '</span>' +
           '    </div>' +
           '    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px;">' +
           '      <span style="color: rgba(255,255,255,0.6);">Needed for Gold (300k):</span>' +
           '      <span style="font-weight: 700; color: ' + paceColorGold + ';">' + (neededPaceGold > 0 ? neededPaceGold.toFixed(1) + ' km/day' : 'Lock ✔') + '</span>' +
           '    </div>' +
           '  </div>' +
           '</div>';

    // 3. Activity Metrics Section with Period Switching Tabs
    var tabBtnStyle = 'flex:1; background:none; border:none; color:rgba(255,255,255,0.4); padding:6px 10px; font-size:11px; font-weight:700; border-radius:8px; cursor:pointer; transition:all 0.2s ease; text-align:center; font-family:var(--font);';
    html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
           '  <div class="profile-stats-tabs" style="display:flex; gap:6px; background:rgba(255,255,255,0.04); padding:4px; border-radius:10px; margin-bottom:14px;">' +
           '    <button id="profile-tab-week" onclick="switchProfilePeriod(\'week\')" class="profile-tab-btn" style="' + tabBtnStyle + '">Week</button>' +
           '    <button id="profile-tab-month" onclick="switchProfilePeriod(\'month\')" class="profile-tab-btn" style="' + tabBtnStyle + '">Month</button>' +
           '    <button id="profile-tab-3months" onclick="switchProfilePeriod(\'3months\')" class="profile-tab-btn" style="' + tabBtnStyle + '">3 Months</button>' +
           '    <button id="profile-tab-year" onclick="switchProfilePeriod(\'year\')" class="profile-tab-btn" style="' + tabBtnStyle + '">Yearly</button>' +
           '  </div>' +
           '  <div id="profile-period-metrics" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">' +
              // Populated dynamically
           '  </div>' +
           '</div>';

    // 4. Points breakdown
    var fullPts = calcFullPts(eventActs, reg.gender, reg.shift);
    html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
           '  <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">POINTS BREAKDOWN</div>' +
           '  <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 12px;">' + esc(EVENT_ROW.name) + '</div>' +
           '  <div style="display: flex; flex-direction: column; gap: 8px;">' +
           '    <div style="display: flex; justify-content: space-between; font-size: 12.5px;">' +
           '      <span style="color: rgba(255,255,255,0.5);">Base Points:</span>' +
           '      <span style="font-weight: 600; color: #fff;">' + (fullPts.distPts || 0).toFixed(1) + '</span>' +
           '    </div>' +
           '    <div style="display: flex; justify-content: space-between; font-size: 12.5px;">' +
           '      <span style="color: rgba(255,255,255,0.5);">Bonus Points:</span>' +
           '      <span style="font-weight: 600; color: #fff;">' + (fullPts.bonusPts || 0).toFixed(1) + '</span>' +
           '    </div>' +
           '    <div style="display: flex; justify-content: space-between; font-size: 12.5px;">' +
           '      <span style="color: rgba(255,255,255,0.5);">Challenge Points:</span>' +
           '      <span style="font-weight: 600; color: #fff;">' + (fullPts.challengePts || 0).toFixed(1) + '</span>' +
           '    </div>' +
           '    <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px; margin-top: 4px;">' +
           '      <span style="color: #fff;">Total Points:</span>' +
           '      <span style="color: var(--brand);">' + (fullPts.total || 0).toFixed(1) + '</span>' +
           '    </div>' +
           '  </div>' +
           '</div>';

    // 5. Dynamic Activities List & Chart Container
    html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
           '  <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px;">PERIOD ACTIVITIES</div>' +
           '  <div id="profile-period-chart"></div>' +
           '  <div id="profile-period-list" style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;"></div>' +
           '</div>';

    // 6. Past Events Participated
    var pastHtml = '';
    if (pastRes && pastRes.length > 0) {
      pastRes.forEach(function(p) {
        pastHtml += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">' +
                   '  <div style="font-size: 13px; font-weight: 600; color: #fff;">' + esc(p.event_name) + '</div>' +
                   '  <div style="font-size: 11px; color: rgba(255,255,255,0.4);">' + esc(p.leaderboard_team || 'No Team') + '</div>' +
                   '</div>';
      });
    } else {
      pastHtml = '<p style="color: rgba(255,255,255,0.35); font-size: 12px; text-align: center; padding: 10px 0; margin: 0;">No past events found</p>';
    }

    html += '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">' +
           '  <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">PAST EVENTS PARTICIPATED</div>' +
           '  <div style="display: flex; flex-direction: column; margin-top: 4px;">' +
                pastHtml +
           '  </div>' +
           '</div>';

    contentEl.innerHTML = html;

    // Cache unflagged all-time activities for period switcher
    window._currentProfileActs = actsRes.filter(function(a) { return !a.is_flagged; });
    
    // Switch to default Week period on load
    switchProfilePeriod('week');

  } catch (err) {
    console.error('renderParticipantProfile error:', err);
    contentEl.innerHTML = '<p style="color:#ef4444; text-align:center; padding:20px;">Failed to load profile details.</p>';
  }
};

window.switchProfilePeriod = function(period) {
  document.querySelectorAll('.profile-tab-btn').forEach(function(btn) {
    btn.style.background = 'none';
    btn.style.color = 'rgba(255,255,255,0.4)';
    btn.style.boxShadow = 'none';
  });
  var activeBtn = document.getElementById('profile-tab-' + period);
  if (activeBtn) {
    activeBtn.style.background = 'rgba(255,255,255,0.1)';
    activeBtn.style.color = '#fff';
    activeBtn.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.2)';
  }

  var validActs = window._currentProfileActs || [];
  var now = new Date();
  var cutoffDate = new Date();
  
  if (period === 'week') {
    cutoffDate.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    cutoffDate.setDate(now.getDate() - 30);
  } else if (period === '3months') {
    cutoffDate.setDate(now.getDate() - 90);
  } else if (period === 'year') {
    cutoffDate.setDate(now.getDate() - 365);
  }
  cutoffDate.setHours(0,0,0,0);

  var periodActs = validActs.filter(function(a) {
    return new Date(a.activity_date) >= cutoffDate;
  });

  renderProfilePeriodStats(period, periodActs);
};

function renderProfilePeriodStats(period, periodActs) {
  var metricsEl = document.getElementById('profile-period-metrics');
  var chartEl = document.getElementById('profile-period-chart');
  var listEl = document.getElementById('profile-period-list');
  if (!metricsEl || !chartEl || !listEl) return;

  var totalDistM = periodActs.reduce(function(s, a) { return s + (a.distance_meters || 0); }, 0);
  var currentKm = totalDistM / 1000;
  var totalMovingSec = periodActs.reduce(function(s, a) { return s + (a.moving_time_seconds || 0); }, 0);

  var rideActs = periodActs.filter(function(a) {
    var st = (a.sport_type || '').toLowerCase();
    return st.indexOf('ride') > -1 || st.indexOf('cycling') > -1;
  });
  var isPrimaryRide = rideActs.length > (periodActs.length / 2);

  var metricTitle = 'Avg Pace';
  var avgPaceStr = '—';
  if (totalMovingSec > 0 && totalDistM > 0) {
    if (isPrimaryRide) {
      metricTitle = 'Avg Speed';
      var speedKmh = (totalDistM / 1000) / (totalMovingSec / 3600);
      avgPaceStr = speedKmh.toFixed(1) + ' km/h';
    } else {
      metricTitle = 'Avg Pace';
      var paceMinKm = (totalMovingSec / 60) / (totalDistM / 1000);
      var mins = Math.floor(paceMinKm);
      var secs = Math.round((paceMinKm - mins) * 60);
      if (secs === 60) { mins++; secs = 0; }
      avgPaceStr = mins + ':' + (secs < 10 ? '0' : '') + secs + ' /km';
    }
  }

  var hours = Math.floor(totalMovingSec / 3600);
  var minutes = Math.floor((totalMovingSec % 3600) / 60);
  var timeStr = hours + 'h ' + minutes + 'm';
  var totalElevation = periodActs.reduce(function(s, a) { return s + (a.elevation_gain || 0); }, 0);

  metricsEl.innerHTML = 
    '    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 12px; text-align: center;">' +
    '      <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">Total Distance</div>' +
    '      <div style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 4px;">' + currentKm.toFixed(1) + ' km</div>' +
    '    </div>' +
    '    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 12px; text-align: center;">' +
    '      <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">' + metricTitle + '</div>' +
    '      <div style="font-size: 18px; font-weight: 800; color: #22c55e; margin-top: 4px;">' + avgPaceStr + '</div>' +
    '    </div>' +
    '    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 12px; text-align: center;">' +
    '      <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">Moving Time</div>' +
    '      <div style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 4px;">' + timeStr + '</div>' +
    '    </div>' +
    '    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 12px; text-align: center;">' +
    '      <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase;">Total Elevation</div>' +
    '      <div style="font-size: 18px; font-weight: 800; color: #8b5cf6; margin-top: 4px;">' + totalElevation.toFixed(0) + ' m</div>' +
    '    </div>';

  var chartDays = [];
  var maxVal = 1;
  var viewWidth = 300;

  if (period === 'week') {
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var dStr = d.toISOString().split('T')[0];
      var label = d.toLocaleDateString('en-IN', { weekday: 'short' })[0];
      var km = 0;
      periodActs.forEach(function(a) {
        var aDate = a.activity_date ? a.activity_date.split('T')[0] : null;
        if (aDate === dStr) km += (a.distance_meters || 0) / 1000;
      });
      if (km > maxVal) maxVal = km;
      chartDays.push({ label: label, val: km });
    }
  } else if (period === 'month') {
    for (var i = 29; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var dStr = d.toISOString().split('T')[0];
      var label = d.getDate();
      var km = 0;
      periodActs.forEach(function(a) {
        var aDate = a.activity_date ? a.activity_date.split('T')[0] : null;
        if (aDate === dStr) km += (a.distance_meters || 0) / 1000;
      });
      if (km > maxVal) maxVal = km;
      chartDays.push({ label: label, val: km });
    }
  } else if (period === '3months') {
    for (var i = 11; i >= 0; i--) {
      var wStart = new Date();
      wStart.setDate(wStart.getDate() - (i * 7 + 6));
      var wEnd = new Date();
      wEnd.setDate(wEnd.getDate() - (i * 7));
      wStart.setHours(0,0,0,0); wEnd.setHours(23,59,59,999);
      
      var label = 'W' + (12 - i);
      var km = 0;
      periodActs.forEach(function(a) {
        var aDate = new Date(a.activity_date);
        if (aDate >= wStart && aDate <= wEnd) km += (a.distance_meters || 0) / 1000;
      });
      if (km > maxVal) maxVal = km;
      chartDays.push({ label: label, val: km });
    }
  } else if (period === 'year') {
    for (var i = 11; i >= 0; i--) {
      var d = new Date();
      d.setMonth(d.getMonth() - i);
      var mIndex = d.getMonth();
      var yIndex = d.getFullYear();
      
      var labelsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var label = labelsShort[mIndex];
      var km = 0;
      periodActs.forEach(function(a) {
        if (a.activity_date) {
          var aDate = new Date(a.activity_date);
          if (aDate.getMonth() === mIndex && aDate.getFullYear() === yIndex) {
            km += (a.distance_meters || 0) / 1000;
          }
        }
      });
      if (km > maxVal) maxVal = km;
      chartDays.push({ label: label[0], val: km, fullLabel: label });
    }
  }

  var svgHtml = '<svg viewBox="0 0 300 90" style="width: 100%; height: 90px; overflow: visible;">';
  var numBars = chartDays.length;
  var colWidth = (viewWidth - 30) / numBars;
  var barWidth = Math.max(2, colWidth - 4);
  
  chartDays.forEach(function(cd, idx) {
    var x = 15 + idx * colWidth;
    var barH = (cd.val / maxVal) * 55;
    var y = 70 - barH;
    svgHtml += '<rect x="' + x + '" y="15" width="' + barWidth + '" height="55" rx="' + (barWidth > 4 ? 4 : 1) + '" fill="rgba(255,255,255,0.03)" />';
    if (barH > 0) {
      svgHtml += '<rect x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + barH + '" rx="' + (barWidth > 4 ? 4 : 1) + '" fill="url(#p-char-grad)" />';
    }
    var showLabel = true;
    if (period === 'month') {
      showLabel = (idx % 5 === 0 || idx === numBars - 1);
    }
    if (showLabel) {
      svgHtml += '<text x="' + (x + barWidth/2) + '" y="84" fill="rgba(255,255,255,0.4)" font-size="8" font-weight="700" text-anchor="middle">' + cd.label + '</text>';
    }
    if (cd.val > 0 && period !== 'month') {
      svgHtml += '<text x="' + (x + barWidth/2) + '" y="' + (y - 3) + '" fill="#fff" font-size="8" font-weight="700" text-anchor="middle">' + cd.val.toFixed(0) + '</text>';
    }
  });
  svgHtml += '<defs><linearGradient id="p-char-grad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#ea580c" /><stop offset="100%" stop-color="#f97316" /></linearGradient></defs>';
  svgHtml += '</svg>';
  chartEl.innerHTML = svgHtml;

  var actsListHtml = '';
  var displayActs = periodActs.slice(0, 15);
  if (displayActs.length > 0) {
    displayActs.forEach(function(act) {
      var actDist = (act.distance_meters || 0) / 1000;
      var actDate = new Date(act.activity_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      
      var isRide = (act.sport_type || '').toLowerCase().indexOf('ride') > -1 || (act.sport_type || '').toLowerCase().indexOf('cycling') > -1;
      var actMetricStr = '—';
      if (act.moving_time_seconds && act.distance_meters) {
        if (isRide) {
          var speedKmh = (act.distance_meters / 1000) / (act.moving_time_seconds / 3600);
          actMetricStr = speedKmh.toFixed(1) + ' km/h';
        } else {
          var paceMin = (act.moving_time_seconds / 60) / (act.distance_meters / 1000);
          var m = Math.floor(paceMin);
          var s = Math.round((paceMin - m) * 60);
          if (s === 60) { m++; s = 0; }
          actMetricStr = m + ':' + (s < 10 ? '0' : '') + s + ' /km';
        }
      }
      
      var actTitle = act.description || (act.sport_type || 'Activity');
      if (!act.description && isRide) {
        actTitle = 'Ride';
      }
      
      actsListHtml += '<div onclick="openActivityDetail(\'' + (act.strava_activity_id || act.id) + '\', null, ' + !!act.strava_activity_id + ')" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.02)\'">' +
                     '  <div style="text-align: left;">' +
                     '    <div style="font-size: 13px; font-weight: 700; color: #fff;">' + esc(actTitle) + '</div>' +
                     '    <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;">' + actDate + ' · ' + actMetricStr + '</div>' +
                     '  </div>' +
                     '  <div style="display: flex; align-items: center; gap: 8px;">' +
                     '    <div style="font-size: 14px; font-weight: 800; color: var(--brand);">' + actDist.toFixed(1) + ' km</div>' +
                     '    <span style="color: rgba(255,255,255,0.2); font-size: 12px;">➔</span>' +
                     '  </div>' +
                     '</div>';
    });
  } else {
    actsListHtml = '<p style="color: rgba(255,255,255,0.35); font-size: 12px; text-align: center; padding: 10px 0; margin: 0;">No activities logged in this period</p>';
  }
  listEl.innerHTML = actsListHtml;
}

window.initSwipeBack = function() {
  var startX = 0;
  var startY = 0;
  var startTime = 0;

  document.querySelectorAll('.detail-modal').forEach(function(modal) {
    if (modal._swipeHooked) return;
    modal._swipeHooked = true;

    modal.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
      }
    }, { passive: true });

    modal.addEventListener('touchend', function(e) {
      if (e.changedTouches.length === 1) {
        var deltaX = e.changedTouches[0].clientX - startX;
        var deltaY = e.changedTouches[0].clientY - startY;
        var duration = Date.now() - startTime;

        var isSwipeBack = false;
        // Swipe left-to-right (standard right swipe back: deltaX > 75)
        // Also support right-to-left swipe (deltaX < -75) to be fully user-intent tolerant
        if (duration < 400 && Math.abs(deltaY) < 65) {
          if (deltaX > 75 || deltaX < -75) {
            isSwipeBack = true;
          }
        }

        if (isSwipeBack) {
          var backBtn = modal.querySelector('.btn-back');
          if (backBtn) {
            console.log('Swipe back detected on modal:', modal.id);
            backBtn.click();
          }
        }
      }
    }, { passive: true });
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initSwipeBack);
} else {
  window.initSwipeBack();
}
