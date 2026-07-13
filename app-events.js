// Events Tab — multi-event list with live/upcoming/past sections
var _eventsLoaded = false;
var _eventsData = [];
var _myEventIds = [];

function loadEventsTab() {
  if (_eventsLoaded) return;
  _eventsLoaded = true;
  renderEventsSkeleton();
  fetchEventsData().then(renderEventsTab).catch(function(e){
    console.warn('Events tab load failed:', e);
    var box = document.getElementById('events-list');
    if (box) box.textContent = 'Could not load events. Pull down to retry.';
    _eventsLoaded = false;
  });
}

function renderEventsSkeleton() {
  var box = document.getElementById('events-list');
  if (!box) return;
  box.textContent = '';
  for (var i = 0; i < 3; i++) {
    var sk = document.createElement('div');
    sk.className = 'ev-skel';
    box.appendChild(sk);
  }
}

async function fetchEventsData() {
  var evRes = await fetch(SUPABASE_URL + '/rest/v1/events?status=neq.draft&select=*&order=start_date.desc', { headers: HDR });
  _eventsData = await evRes.json();

  // which events am I enrolled/registered in?
  var athleteId = null, empCode = null, email = null;
  try {
    var u = JSON.parse(safeGetItem('wk_user') || '{}');
    athleteId = u.athleteId || null;
    empCode = u.empCode || null;
    email = u.email || null;
  } catch (e) {}
  if (!athleteId && typeof currentSession !== 'undefined' && currentSession) {
    athleteId = currentSession.athleteId;
    empCode = currentSession.empCode;
    email = currentSession.email;
  }
  if (!empCode || !email) {
    try {
      var emp = JSON.parse(safeGetItem('ag_emp') || '{}');
      if (emp) {
        if (!empCode) empCode = emp.emp_code || null;
        if (!email) email = emp.email || null;
      }
    } catch(e){}
  }

  _myEventRegistrations = {}; // mapping of event_id -> status
  _myEventIds = [];

  if (athleteId || empCode || email) {
    try {
      var filterParts = [];
      if (athleteId && athleteId !== 'null' && athleteId !== 'undefined') filterParts.push('strava_athlete_id.eq.' + encodeURIComponent(athleteId));
      if (empCode && empCode !== 'null' && empCode !== 'undefined') filterParts.push('emp_code.eq.' + encodeURIComponent(empCode));
      if (email && email !== 'null' && email !== 'undefined') filterParts.push('email.ilike.' + encodeURIComponent(email));

      var url = SUPABASE_URL + '/rest/v1/registration?select=event_id,status';
      if (filterParts.length > 0) {
        url += '&or=(' + filterParts.join(',') + ')';
      }
      
      var rr = await fetch(url, { headers: HDR });
      var rows = await rr.json();
      (rows || []).forEach(function(x){
        if (x.event_id != null) {
          _myEventRegistrations[x.event_id] = x.status || 'approved';
        }
      });
      _myEventIds = Object.keys(_myEventRegistrations).map(Number);
    } catch (e) {
      console.warn('Failed to load user event registrations:', e);
    }
  }

  // light stats for live + ended events (top 5 only)
  var statEvents = _eventsData.filter(function(e){ return e.status === 'live' || e.status === 'ended'; }).slice(0, 5);
  await Promise.all(statEvents.map(async function(ev){
    try {
      var sumRes = await fetch(SUPABASE_URL + '/rest/v1/athlete_points_summary?event_id=eq.' + ev.id + '&select=total_distance_km,activities_count', { headers: HDR });
      var sumData = await sumRes.json();
      if (Array.isArray(sumData) && sumData.length > 0) {
        var totKm = 0;
        var totActs = 0;
        sumData.forEach(function(x) {
          totKm += parseFloat(x.total_distance_km || 0);
          totActs += parseInt(x.activities_count || 0);
        });
        ev._stats = {
          km: totKm,
          acts: totActs
        };
        ev._participants = sumData.length;
        return;
      }
    } catch(err) {
      console.warn('Failed to load event stats from points summary cache:', err);
    }

    try {
      var s = await fetch(SUPABASE_URL + '/rest/v1/activities?event_id=eq.' + ev.id +
        '&is_deleted=eq.false&is_flagged=eq.false&select=distance_meters', { headers: HDR });
      var d = await s.json();
      if (Array.isArray(d)) {
        ev._stats = {
          km: d.reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000,
          acts: d.length
        };
      }
      var c = await fetch(SUPABASE_URL + '/rest/v1/registration?event_id=eq.' + ev.id + '&select=id&limit=1', {
        headers: Object.assign({}, HDR, { Prefer: 'count=exact' })
      });
      var cr = c.headers.get('content-range');
      if (cr && cr.indexOf('/') > -1) ev._participants = parseInt(cr.split('/')[1]) || 0;
    } catch (e) {}
  }));
}

function evFmtDate(d) {
  if (!d) return '';
  var p = d.split('-');
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(p[1],10)-1];
  return parseInt(p[2],10) + ' ' + mo + ' ' + p[0];
}
function evDaysUntil(d) {
  var t = new Date(); t.setHours(0,0,0,0);
  return Math.ceil((new Date(d + 'T00:00:00') - t) / 86400000);
}

function renderEventsTab() {
  var box = document.getElementById('events-list');
  if (!box) return;
  box.textContent = '';

  var groups = [
    { key: 'live',     title: 'LIVE NOW',  events: _eventsData.filter(function(e){ return e.status === 'live'; }) },
    { key: 'upcoming', title: 'UPCOMING',  events: _eventsData.filter(function(e){ return e.status === 'upcoming'; }) },
    { key: 'past',     title: 'PAST EVENTS', events: _eventsData.filter(function(e){ return e.status === 'ended' || e.status === 'archived'; }) }
  ];

  var any = false;
  groups.forEach(function(g) {
    if (!g.events.length) return;
    any = true;
    var h = document.createElement('div');
    h.className = 'ev-section-title';
    h.textContent = g.title;
    box.appendChild(h);
    g.events.forEach(function(ev){ box.appendChild(buildEventCard(ev, g.key)); });
  });
  if (!any) {
    var e = document.createElement('div');
    e.className = 'ev-empty';
    e.textContent = 'No events yet. Stay tuned!';
    box.appendChild(e);
  }
}

function detectEventSportType(ev) {
  var name = (ev.name || '').toLowerCase();
  var sports = ev.allowed_sports || [];
  if (Array.isArray(sports)) {
    sports = sports.map(function(s) { return s.toLowerCase(); });
  } else if (typeof sports === 'string') {
    try {
      sports = JSON.parse(sports).map(function(s) { return s.toLowerCase(); });
    } catch(e) {
      sports = [sports.toLowerCase()];
    }
  }

  var hasRide = sports.indexOf('ride') > -1 || sports.indexOf('mountainbikeride') > -1 || name.indexOf('ride') > -1 || name.indexOf('cycle') > -1 || name.indexOf('bike') > -1;
  var hasWalk = sports.indexOf('walk') > -1 || name.indexOf('walk') > -1;
  var hasRun = sports.indexOf('run') > -1 || sports.indexOf('virtualrun') > -1 || name.indexOf('run') > -1 || name.indexOf('marathon') > -1;
  var hasHike = sports.indexOf('hike') > -1 || name.indexOf('hike') > -1 || name.indexOf('trek') > -1;

  if (hasRide && !hasWalk && !hasRun && !hasHike) return 'ride';
  if (hasWalk && !hasRide && !hasRun && !hasHike) return 'walk';
  if (hasRun && !hasRide && !hasWalk && !hasHike) return 'run';
  if (hasHike && !hasRide && !hasWalk && !hasRun) return 'hike';
  return 'mixed';
}

function buildEventCard(ev, group) {
  var registrationStatus = _myEventRegistrations ? _myEventRegistrations[ev.id] : null;
  var enrolled = _myEventIds.indexOf(ev.id) > -1;
  var isApproved = enrolled && (registrationStatus === 'approved' || registrationStatus === 'active');
  var isPending = enrolled && (registrationStatus === 'pending');

  var card = document.createElement('div');
  card.className = 'ev-card-p';
  card.style.borderLeft = '4px solid ' + (ev.accent_color || (typeof getBrandingOverrideColor === 'function' ? getBrandingOverrideColor('event_accent_color', 'accent_color') : '#E8622A'));

  /**
   * Event Card Premium Background & Badge Loader
   * How it works: If no banner image exists, sets a subtle, sport-specific CSS linear-gradient background 
   * and appends a floating glass round badge containing the sport icon via the global renderIcon() function.
   * Impact: Creates a high-fidelity visual identity for each event on the Events tab.
   */
  var sportType = detectEventSportType(ev);
  
  // Clean, lightweight watermark representing the event's sport type, matching the card accent color
  var watermark = document.createElement('div');
  watermark.className = 'ev-card-watermark';
  watermark.style.color = ev.accent_color || (typeof getBrandingOverrideColor === 'function' ? getBrandingOverrideColor('event_accent_color', 'accent_color') : '#E8622A');
  var iconStr = renderIcon(sportType === 'ride' ? 'Ride' : sportType === 'run' ? 'Run' : sportType === 'hike' ? 'Hike' : sportType === 'walk' ? 'Walk' : 'Mixed');
  if (iconStr) {
    iconStr = iconStr.replace(/stroke="[^"]*"/g, 'stroke="currentColor"');
    watermark.innerHTML = iconStr;
    card.appendChild(watermark);
  }

  if (!ev.banner_url) {
    card.classList.add('has-badge');
    var badge = document.createElement('div');
    badge.className = 'ev-card-sport-badge';
    badge.innerHTML = renderIcon(sportType === 'ride' ? 'Ride' : sportType === 'run' ? 'Run' : sportType === 'hike' ? 'Hike' : sportType === 'walk' ? 'Walk' : 'Mixed');
    card.appendChild(badge);
  }

  if (ev.banner_url) {
    var img = document.createElement('img');
    img.className = 'ev-banner';
    img.src = ev.banner_url;
    img.alt = '';
    img.loading = 'lazy';
    card.appendChild(img);
  }

  var body = document.createElement('div');
  body.className = 'ev-card-body';

  var top = document.createElement('div');
  top.className = 'ev-card-top';
  
  var name = document.createElement('div');
  name.className = 'ev-card-name';
  name.style.cssText = 'flex:1;min-width:0;';
  name.textContent = ev.name;
  top.appendChild(name);
  
  if (isApproved) {
    var en = document.createElement('span'); en.className = 'ev-pill ev-pill-enrolled'; en.textContent = '✓ Enrolled'; top.appendChild(en);
  } else if (isPending) {
    var regPill = document.createElement('span'); regPill.className = 'ev-pill ev-pill-registered'; regPill.textContent = '⌛ Registered'; top.appendChild(regPill);
  } else if (group === 'live') {
    var lv = document.createElement('span'); lv.className = 'ev-pill ev-pill-live'; lv.textContent = '● LIVE'; top.appendChild(lv);
  }
  body.appendChild(top);

  var dates = document.createElement('div');
  dates.className = 'ev-card-dates';
  dates.textContent = evFmtDate(ev.start_date) + ' → ' + evFmtDate(ev.end_date);
  if (group === 'upcoming') {
    var du = evDaysUntil(ev.start_date);
    if (du > 0) dates.textContent += '  ·  Starts in ' + du + ' day' + (du === 1 ? '' : 's');
  }
  body.appendChild(dates);

  var actions = document.createElement('div');
  actions.className = 'ev-card-actions';

  // Event Details Info Button (placed first, before other action buttons)
  var infoBtn = document.createElement('button');
  infoBtn.className = 'ev-btn';
  infoBtn.style.height = '42px';
  infoBtn.style.display = 'inline-flex';
  infoBtn.style.alignItems = 'center';
  infoBtn.style.justifyContent = 'center';
  infoBtn.style.gap = '6px';
  infoBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span style="color:#38bdf8;">Event Info</span>';
  infoBtn.addEventListener('click', function(e) { e.stopPropagation(); openEventDetailsModal(ev); });
  actions.appendChild(infoBtn);

  var today0 = new Date().toISOString().split('T')[0];
  var regOpenNow = ev.registration_open_date && ev.registration_close_date &&
                   today0 >= ev.registration_open_date && today0 <= ev.registration_close_date;

  // Leaderboard Button (always visible)
  var lb = document.createElement('button');
  lb.className = 'ev-btn';
  lb.style.height = '42px';
  lb.style.display = 'inline-flex';
  lb.style.alignItems = 'center';
  lb.style.justifyContent = 'center';
  lb.style.gap = '6px';
  var lbIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"/><path d="M12 2a6 6 0 0 1 6 6v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z"/></svg>';
  lb.innerHTML = lbIcon + ' <span style="color:#fbbf24;">' + (group === 'past' ? 'Final Results' : 'Leaderboard') + '</span>';
  lb.addEventListener('click', function(){ openEventLeaderboard(ev); });
  actions.appendChild(lb);

  // Register Now (Green) / Registered (Orange) Button (hidden on past events)
  if (group !== 'past') {
    var regBtn = document.createElement('button');
    regBtn.style.height = '42px';
    regBtn.style.display = 'inline-flex';
    regBtn.style.alignItems = 'center';
    regBtn.style.justifyContent = 'center';
    regBtn.style.gap = '6px';
    if (isApproved || enrolled) {
      regBtn.className = 'ev-btn';
      regBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + (ev.accent_color || (typeof getBrandingOverrideColor === 'function' ? getBrandingOverrideColor('event_accent_color', 'accent_color') : '#E8622A')) + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span style="color:#ffaa80;">Registered</span>';
      regBtn.style.cursor = 'default';
    } else if (isPending) {
      regBtn.className = 'ev-btn';
      regBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + (ev.accent_color || (typeof getBrandingOverrideColor === 'function' ? getBrandingOverrideColor('event_accent_color', 'accent_color') : '#E8622A')) + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span style="color:#ffaa80;">Pending</span>';
      regBtn.style.cursor = 'default';
    } else if (regOpenNow || group === 'upcoming') {
      regBtn.className = 'ev-btn';
      var regIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
      var regLabel = hasRegDraft(ev.id) ? 'Resume Reg' : 'Register Now';
      regBtn.innerHTML = regIcon + ' <span style="color:#a7f3d0;">' + regLabel + '</span>';
      regBtn.addEventListener('click', function(){ openEventRegistration(ev); });
      regBtn.style.cursor = 'pointer';
    } else {
      regBtn.className = 'ev-btn';
      regBtn.style.opacity = '0.5';
      regBtn.style.cursor = 'not-allowed';
      regBtn.disabled = true;
      regBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> <span style="color:rgba(255,255,255,0.5);">Closed</span>';
    }
    actions.appendChild(regBtn);
  }

  if (actions.children.length) body.appendChild(actions);
  card.appendChild(body);
  return card;
}

// ===== Event-scoped leaderboard switching =====
var _lbCurrentEventId = 1;          // dynamic, initialized from registration
var _lbDefaultState = null;         // saved default (registered event) globals
var _lbEventCache = {};             // fetched data per event id

function setLbTitle(txt) {
  var el = document.getElementById('lb-event-title-text');
  var wrapper = document.getElementById('lb-event-title');
  if (el) { el.textContent = txt || ''; }
  if (wrapper) { wrapper.style.display = txt ? 'flex' : 'none'; }
  var btn = document.getElementById('lb-back-btn');
  var defaultId = window._lbRegisteredEventId || 1;
  var bnavLb = document.getElementById('bnav-leaderboard');
  var bnavLbHidden = bnavLb && bnavLb.style.display === 'none';
  var alwaysShowBack = window._lbCameFromEvents || bnavLbHidden;
  if (btn) { btn.style.display = (alwaysShowBack || (window._lbCurrentEventId && window._lbCurrentEventId !== defaultId)) ? 'flex' : 'none'; }
}

function saveDefaultLbState() {
  if (_lbDefaultState) return;
  _lbDefaultState = {
    acts: LB_ACTS, reg: LB_REG,
    bonus: CONFIG_LB.bonus, basePer_km: CONFIG_LB.basePer_km,
    challenges: CHALLENGES_LB, specialDays: SPECIAL_DAYS_LB
  };
}

function applyLbState(st) {
  LB_ACTS = st.acts; LB_REG = st.reg;
  CONFIG_LB.bonus = st.bonus; CONFIG_LB.basePer_km = st.basePer_km;
  CHALLENGES_LB = st.challenges; SPECIAL_DAYS_LB = st.specialDays;
  LB_SCORES = {};
  _lbReady = false;

  // Resolve LB_ME for the selected event
  var s = {};
  try { s = JSON.parse(localStorage.getItem('wk_user') || '{}'); } catch(e){}
  LB_ME = null;
  if (s.athleteId && Array.isArray(LB_REG)) {
    LB_ME = LB_REG.find(function(r){ return String(r.strava_athlete_id) === String(s.athleteId); }) || null;
  }
  if (!LB_ME && Array.isArray(LB_REG) && LB_REG.length > 0) {
    LB_ME = LB_REG[0];
  }
}

async function fetchEventLbState(evId, evStatus) {
  if (_lbEventCache[evId]) return _lbEventCache[evId];

  var cacheKey = 'agwalk_event_lb_cache_' + evId;
  var cachedRaw = typeof safeGetItem === 'function' ? safeGetItem(cacheKey) : null;
  if (cachedRaw) {
    try {
      var cachedObj = JSON.parse(cachedRaw);
      var isEnded = evStatus === 'ended' || evStatus === 'archived';
      var age = Date.now() - (cachedObj.ts || 0);
      if (isEnded || age < 300000) {
        console.log('[Cache] Loading custom event leaderboard ' + evId + ' from localStorage ✓');
        _lbEventCache[evId] = cachedObj.data;
        return cachedObj.data;
      }
    } catch(e){}
  }

  var slimActs = '&select=strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist';
  var results = await Promise.all([
    fetchAllParallel(SUPABASE_URL + '/rest/v1/activities?event_id=eq.' + evId + '&is_deleted=eq.false&order=id.asc' + slimActs),
    fetchAllParallel(SUPABASE_URL + '/rest/v1/registration?event_id=eq.' + evId + '&order=strava_athlete_id.asc&select=strava_athlete_id,full_name,gender,shift,leaderboard_team'),
    fetch(SUPABASE_URL + '/rest/v1/leaderboard_config?event_id=eq.' + evId + '&select=config_key,config_value', { headers: HDR }).then(function(r){ return r.json(); }),
    fetch(SUPABASE_URL + '/rest/v1/challenges?event_id=eq.' + evId + '&is_active=eq.true&select=*', { headers: HDR }).then(function(r){ return r.json(); }),
    fetch(SUPABASE_URL + '/rest/v1/special_scoring_days?event_id=eq.' + evId + '&select=special_date', { headers: HDR }).then(function(r){ return r.json(); })
  ]);
  var bonus = null, basePer = 1;
  (Array.isArray(results[2]) ? results[2] : []).forEach(function(row){
    if (row.config_key === 'bonus_points') bonus = row.config_value.map(function(b){ return { km: Number(b.km), points: Number(b.points || b.pts || 0) }; });
    if (row.config_key === 'base_points') basePer = parseFloat(row.config_value.per_km || 1);
    if (row.config_key === 'base_points_per_km') basePer = parseFloat(row.config_value) || 1;
  });
  var st = {
    acts: results[0] || [], reg: results[1] || [],
    bonus: bonus || [], basePer_km: basePer,
    challenges: Array.isArray(results[3]) ? results[3] : [],
    specialDays: (Array.isArray(results[4]) ? results[4] : []).map(function(x){ return x.special_date; })
  };
  
  if (typeof safeSetItem === 'function') {
    safeSetItem(cacheKey, JSON.stringify({ ts: Date.now(), data: st }));
  }

  _lbEventCache[evId] = st;
  return st;
}

async function openEventLeaderboard(ev) {
  window._lbCameFromEvents = true;
  try {
    var suffix = (ev.status === 'ended' || ev.status === 'archived') ? ' — Final Results' : '';
    var defaultId = window._lbRegisteredEventId || 1;
    
    // Check if default leaderboard data is actually loaded in memory
    var dataLoaded = (typeof LB_REG !== 'undefined' && LB_REG && LB_REG.length > 0);
    
    if (ev.id === _lbCurrentEventId && dataLoaded) {
      setLbTitle(_lbCurrentEventId === defaultId ? '' : '🏆 ' + ev.name + suffix);
      showTab('leaderboard');
      return;
    }
    
    if (ev.id === defaultId && _lbDefaultState && dataLoaded) {
      applyLbState(_lbDefaultState);
      _LB_EV_RULES = null;
      _lbCurrentEventId = defaultId;
      setLbTitle('');
      showTab('leaderboard');
      lbBoot();
      return;
    }
    
    if (ev.id !== defaultId && dataLoaded) {
      saveDefaultLbState();
    }
    
    var st;
    if (ev.id === defaultId && !_lbDefaultState) {
      st = await fetchEventLbState(ev.id, ev.status);
      _lbDefaultState = st;
    } else {
      st = await fetchEventLbState(ev.id, ev.status);
    }
    
    applyLbState(st);
    _LB_EV_RULES = ev.rules_config || null;
    _lbCurrentEventId = ev.id;
    setLbTitle(ev.id === defaultId ? '' : '🏆 ' + ev.name + suffix);
    showTab('leaderboard');
    
    // Force re-calculation and rendering
    _lbReady = false;
    lbBoot();
  } catch (e) {
    console.warn('openEventLeaderboard failed:', e);
    showTab('leaderboard');
  }
}

// When the nav Leaderboard icon is tapped directly, always show the default (registered event) board
(function hookNavLeaderboardReset(){
  var nav = document.getElementById('bnav-leaderboard');
  if (!nav) return;
  nav.addEventListener('click', function(){
    var defaultId = window._lbRegisteredEventId || 1;
    if (_lbCurrentEventId !== defaultId && _lbDefaultState) {
      applyLbState(_lbDefaultState);
      _LB_EV_RULES = null;
      _lbCurrentEventId = defaultId;
      setLbTitle('');
      lbBoot();
    }
  });
})();

// ===== In-app event registration (slide-in modal, draft auto-save) =====
var REG_FIELDS = [
  { k:'full_name',        label:'Full Name',       type:'text' },
  { k:'emp_code',         label:'Employee Code',   type:'text' },
  { k:'gender',           label:'Gender',          type:'select', opts:['Male','Female'] },
  { k:'email',            label:'Email',           type:'email' },
  { k:'whatsapp',         label:'WhatsApp Number', type:'tel' },
  { k:'shift',            label:'Shift',           type:'select', opts:['Day','Night'] },
  { k:'tshirt_size',      label:'T-Shirt Size',    type:'select', opts:['XS','S','M','L','XL','XXL'] },
  { k:'leaderboard_team', label:'Team',            type:'text' },
  { k:'team_lead',        label:'Team Lead',       type:'text' },
  { k:'strava_url',       label:'Strava Profile URL', type:'text' }
];

function regDraftKey(evId){ return 'ag_reg_draft_' + evId; }
function hasRegDraft(evId){ return !!safeGetItem(regDraftKey(evId)); }

function regPrefill() {
  var pre = {};
  try {
    var u = JSON.parse(safeGetItem('wk_user') || '{}');
    if (u.name) pre.full_name = u.name;
    if (u.empCode) pre.emp_code = u.empCode;
    if (u.email) pre.email = u.email;
    if (u.athleteId) pre.strava_url = 'https://www.strava.com/athletes/' + u.athleteId;
  } catch(e) {}
  try {
    var emp = JSON.parse(safeGetItem('ag_emp') || '{}');
    if (!pre.full_name && emp.full_name) pre.full_name = emp.full_name;
    if (!pre.emp_code && emp.emp_code) pre.emp_code = emp.emp_code;
    if (!pre.email && emp.email) pre.email = emp.email;
    if (!pre.gender && emp.gender) pre.gender = emp.gender;
  } catch(e) {}
  if (typeof LB_ME !== 'undefined' && LB_ME) {
    if (LB_ME.gender) pre.gender = LB_ME.gender;
    if (LB_ME.shift) pre.shift = LB_ME.shift;
    if (LB_ME.leaderboard_team) pre.leaderboard_team = LB_ME.leaderboard_team;
  }
  return pre;
}

function openEventRegistration(ev) {
  var modal = document.getElementById('event-reg-modal');
  if (!modal) return;
  modal.textContent = '';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:560px;margin:0 auto;padding:20px;';

  var head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
  var h = document.createElement('div');
  h.style.cssText = 'font-size:19px;font-weight:700;color:#fff;';
  h.textContent = 'Register';
  var x = document.createElement('button');
  x.style.cssText = 'background:none;border:none;color:rgba(255,255,255,.6);font-size:20px;cursor:pointer;padding:8px;';
  x.textContent = '✕';
  x.addEventListener('click', closeEventRegistration);
  head.appendChild(h); head.appendChild(x);
  wrap.appendChild(head);

  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:#F97D4E;font-weight:600;margin-bottom:16px;';
  sub.textContent = ev.name;
  wrap.appendChild(sub);

  var draft = {};
  try { draft = JSON.parse(safeGetItem(regDraftKey(ev.id)) || '{}'); } catch(e) {}
  var pre = regPrefill();

  var form = document.createElement('div');
  form.className = 'glass-card';
  REG_FIELDS.forEach(function(f){
    var fw = document.createElement('div');
    fw.style.cssText = 'margin-bottom:13px;';
    var lab = document.createElement('label');
    lab.style.cssText = 'display:block;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.55);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;';
    lab.textContent = f.label;
    fw.appendChild(lab);
    var inp;
    if (f.type === 'select') {
      inp = document.createElement('select');
      var ph = document.createElement('option'); ph.value=''; ph.textContent='Select…'; inp.appendChild(ph);
      f.opts.forEach(function(o){ var op=document.createElement('option'); op.value=o; op.textContent=o; inp.appendChild(op); });
    } else {
      inp = document.createElement('input');
      inp.type = f.type;
    }
    inp.id = 'ereg-' + f.k;
    inp.value = draft[f.k] !== undefined ? draft[f.k] : (pre[f.k] || '');
    inp.style.cssText = 'width:100%;padding:11px 12px;background:var(--surface2,#1E2230);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#fff;font-size:14px;font-family:inherit;box-sizing:border-box;';
    if (f.k === 'full_name' || f.k === 'emp_code' || f.k === 'email') {
      if (pre[f.k]) {
        inp.disabled = true;
        inp.style.opacity = '0.7';
        inp.style.cursor = 'not-allowed';
      }
    }
    inp.addEventListener('input', function(){ saveRegDraft(ev.id); });
    inp.addEventListener('change', function(){ saveRegDraft(ev.id); });
    fw.appendChild(inp);
    form.appendChild(fw);
  });
  wrap.appendChild(form);

  var err = document.createElement('div');
  err.id = 'ereg-err';
  err.style.cssText = 'color:#F87171;font-size:13px;margin:10px 0;min-height:18px;';
  wrap.appendChild(err);

  var btn = document.createElement('button');
  btn.id = 'ereg-submit';
  btn.className = 'ev-btn ev-btn-primary';
  btn.style.cssText = 'width:100%;padding:14px;font-size:15px;';
  btn.textContent = 'Submit Registration Request';
  btn.addEventListener('click', function(){ submitEventRegistration(ev); });
  wrap.appendChild(btn);

  var note = document.createElement('div');
  note.style.cssText = 'font-size:11.5px;color:rgba(255,255,255,.4);margin-top:12px;text-align:center;';
  note.textContent = 'Your progress is saved automatically — you can close and resume anytime.';
  wrap.appendChild(note);

  modal.appendChild(wrap);
  modal.style.display = 'block';
  requestAnimationFrame(function(){ modal.classList.add('open'); });
}

function closeEventRegistration() {
  var modal = document.getElementById('event-reg-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(function(){ modal.style.display = 'none'; }, 450);
  _eventsLoaded = false; loadEventsTab(); // refresh cards (Resume label)
}

function saveRegDraft(evId) {
  var d = {};
  REG_FIELDS.forEach(function(f){
    var el = document.getElementById('ereg-' + f.k);
    if (el) d[f.k] = el.value;
  });
  safeSetItem(regDraftKey(evId), JSON.stringify(d));
}

async function submitEventRegistration(ev) {
  var err = document.getElementById('ereg-err');
  var btn = document.getElementById('ereg-submit');
  err.textContent = '';
  var d = {};
  var missing = [];
  REG_FIELDS.forEach(function(f){
    var el = document.getElementById('ereg-' + f.k);
    d[f.k] = (el && el.value || '').trim();
    if (!d[f.k]) missing.push(f.label);
  });
  if (missing.length) { err.textContent = 'Please fill: ' + missing.join(', '); return; }
  if (!/^\S+@\S+\.\S+$/.test(d.email)) { err.textContent = 'Please enter a valid email.'; return; }
  if (d.strava_url.indexOf('https://www.strava.com/athletes/') !== 0) { err.textContent = 'Strava URL must start with https://www.strava.com/athletes/'; return; }

  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    var payload = Object.assign({}, d, { event_name: ev.slug, event_id: ev.id, status: 'pending' });
    var backendUrl = (typeof BACKEND !== 'undefined' ? BACKEND : 'https://agwalk-backend.onrender.com');
    var r = await fetch(backendUrl + '/register-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      var errData = await r.json().catch(function(){return{};});
      throw new Error(errData.error || ('Submission failed (' + r.status + '). Please try again.'));
    }
    safeSetItem(regDraftKey(ev.id), '');
    try { localStorage.removeItem(regDraftKey(ev.id)); } catch(e) {}
    var modal = document.getElementById('event-reg-modal');
    modal.textContent = '';
    var ok = document.createElement('div');
    ok.style.cssText = 'max-width:480px;margin:80px auto;text-align:center;padding:20px;';
    var big = document.createElement('div'); big.style.cssText='font-size:52px;margin-bottom:14px;'; big.textContent='🎉';
    var t = document.createElement('div'); t.style.cssText='font-size:19px;font-weight:700;color:#fff;margin-bottom:8px;'; t.textContent='Request Submitted!';
    var p = document.createElement('div'); p.style.cssText='font-size:14px;color:rgba(255,255,255,.6);line-height:1.5;'; p.textContent='Your registration for ' + ev.name + ' is pending admin approval. You\'ll be notified once approved.';
    var cb = document.createElement('button'); cb.className='ev-btn ev-btn-primary'; cb.style.cssText='margin-top:22px;padding:12px 30px;'; cb.textContent='Done';
    cb.addEventListener('click', closeEventRegistration);
    ok.appendChild(big); ok.appendChild(t); ok.appendChild(p); ok.appendChild(cb);
    modal.appendChild(ok);
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Submit Registration Request';
  }
}

function openEventDetailsModal(ev) {
  function linkify(text) {
    if (!text) return 'No description provided.';
    var urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return text.replace(urlRegex, function(url) {
      return '<a href="' + url + '" target="_blank" style="color:var(--brand); text-decoration:underline; font-weight:800; word-break:break-all;">' + url + '</a>';
    });
  }

  var id = 'event-details-modal-container';
  var modal = document.getElementById(id);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = id;
    modal.classList.add('detail-modal');
    document.body.appendChild(modal);
  }
  
  // Style container as a full-page cover with no scrollbar
  modal.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg, #0d0f12 0%, #15191e 100%);z-index:10000;display:none;flex-direction:column;overflow:hidden;font-family:inherit;';
  
  var start = evFmtDate(ev.start_date);
  var end = evFmtDate(ev.end_date);
  var sports = Array.isArray(ev.sport_types) ? ev.sport_types.join(', ') : (ev.sport_types || 'Walk/Run');
  
  var statusBadgeStyle = '';
  var statusText = '';
  if (ev.status === 'live') {
    statusBadgeStyle = 'background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.35); color:#10B981;';
    statusText = '● Live Event';
  } else if (ev.status === 'upcoming') {
    statusBadgeStyle = 'background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#3B82F6;';
    statusText = 'Upcoming Event';
  } else {
    statusBadgeStyle = 'background:rgba(156,163,175,0.12); border:1px solid rgba(156,163,175,0.25); color:#9CA3AF;';
    statusText = 'Past Event';
  }

  var bannerHtml = ev.banner_url ? 
    '<div style="width:100%; border-radius:16px; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); position:relative; aspect-ratio:21/9; max-height:220px; flex-shrink:0; margin-bottom:10px;">' +
      '<img src="' + ev.banner_url + '" style="width:100%; height:100%; object-fit:cover;">' +
      '<div style="position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%);"></div>' +
    '</div>' : '';

  modal.innerHTML = 
    '<!-- Header -->' +
    '<div style="height:calc(60px + env(safe-area-inset-top)); display:flex; align-items:center; padding:env(safe-area-inset-top) 16px 0; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(21,25,30,0.85); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); z-index:10; flex-shrink:0;">' +
      '<button id="close-ev-details-btn" style="background:none; border:none; color:rgba(255,255,255,0.6); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; width:40px; height:40px; border-radius:50%; transition:all 0.2s; outline:none; -webkit-tap-highlight-color:transparent;" title="Back">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="15 18 9 12 15 6"></polyline></svg>' +
      '</button>' +
      '<div style="flex:1; text-align:center; font-size:16px; font-weight:900; color:#fff; text-transform:uppercase; letter-spacing:1px; margin-right:40px;">Event Details</div>' +
    '</div>' +
    
    '<!-- Scrollable Content -->' +
    '<div style="flex:1; overflow-y:auto; padding:20px 16px; display:flex; flex-direction:column; align-items:center; -webkit-overflow-scrolling:touch;">' +
      '<div style="width:100%; max-width:600px; display:flex; flex-direction:column; gap:16px;">' +
        
        bannerHtml +
        
        '<!-- Title Card -->' +
        '<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:20px; box-shadow:0 4px 15px rgba(0,0,0,0.15);">' +
          '<div style="font-size:22px; font-weight:900; color:#fff; line-height:1.25; margin-bottom:8px;">' + ev.name + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:6px; font-size:10px; font-weight:800; padding:4px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.8px; ' + statusBadgeStyle + '">' +
            statusText +
          '</div>' +
        '</div>' +
        
        '<!-- Quick Info Grid -->' +
        '<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">' +
          '<div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:12px 6px; text-align:center;">' +
            '<div style="font-size:18px; margin-bottom:4px;">📅</div>' +
            '<div style="font-size:9px; color:var(--muted); font-weight:750; text-transform:uppercase; letter-spacing:0.3px; margin-bottom:2px;">Starts</div>' +
            '<div style="font-size:11.5px; font-weight:800; color:#fff;">' + start + '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:12px 6px; text-align:center;">' +
            '<div style="font-size:18px; margin-bottom:4px;">🏁</div>' +
            '<div style="font-size:9px; color:var(--muted); font-weight:750; text-transform:uppercase; letter-spacing:0.3px; margin-bottom:2px;">Ends</div>' +
            '<div style="font-size:11.5px; font-weight:800; color:#fff;">' + end + '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:12px 6px; text-align:center;">' +
            '<div style="font-size:18px; margin-bottom:4px;">🏃‍♂️</div>' +
            '<div style="font-size:9px; color:var(--muted); font-weight:750; text-transform:uppercase; letter-spacing:0.3px; margin-bottom:2px;">Sports</div>' +
            '<div style="font-size:11.5px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + sports + '">' + sports + '</div>' +
          '</div>' +
        '</div>' +
        
        '<!-- Description Card -->' +
        '<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:20px; box-shadow:0 4px 15px rgba(0,0,0,0.15); display:flex; flex-direction:column; gap:12px;">' +
          '<div style="font-size:12px; font-weight:850; color:var(--brand); text-transform:uppercase; letter-spacing:1px;">About the Event</div>' +
          '<div style="font-size:14px; color:rgba(255,255,255,0.9); line-height:1.6; white-space:pre-wrap; word-break:break-word;">' +
            linkify(ev.description) +
          '</div>' +
        '</div>' +
        
      '</div>' +
    '</div>';
    
  modal.style.display = 'flex';
  setTimeout(function() {
    modal.classList.add('open');
  }, 10);
  document.body.style.overflow = 'hidden'; // Remove main page scrollbar
  
  var closeBtn = document.getElementById('close-ev-details-btn');
  closeBtn.onclick = function() {
    modal.classList.remove('open');
    setTimeout(function() {
      modal.style.display = 'none';
    }, 420);
    document.body.style.overflow = ''; // Restore main page scrollbar
  };
  closeBtn.onmouseenter = function() {
    closeBtn.style.background = 'rgba(255,255,255,0.08)';
  };
  closeBtn.onmouseleave = function() {
    closeBtn.style.background = 'none';
  };
}
