/* ============================================================
   app-dashboard.js — Dynamic per-event dashboard rings
   Reads rules_config.dashboard of the participant's active event.
   No config => leaves the classic Walkathon layout untouched.
   ============================================================ */
(function(){
  // Apply last-known accent color instantly (from cache), to avoid a default-color flash
  // while the fresh event/branding fetches are still in flight.
  try { if (typeof applyEffectiveAccentColor === 'function') applyEffectiveAccentColor(); } catch(e){}

  var SHAPES = {
    circle:  '<circle cx="50" cy="50" r="43" pathLength="100"/>',
    diamond: '<path d="M50 6 L94 50 L50 94 L6 50 Z" pathLength="100"/>',
    hexagon: '<path d="M50 5 L89 27 L89 73 L50 95 L11 73 L11 27 Z" pathLength="100"/>',
    square:  '<rect x="9" y="9" width="82" height="82" rx="18" pathLength="100"/>',
    shield:  '<path d="M14 10 L86 10 L86 48 C86 71 68 86 50 94 C32 86 14 71 14 48 Z" pathLength="100"/>',
    star:    '<path d="M96 50 L72.7 66.5 L64.2 93.7 L41.3 76.6 L12.8 77 L22 50 L12.8 23 L41.3 23.4 L64.2 6.3 L72.7 33.5 Z" pathLength="100"/>',
    pentagon: '<path d="M94 50 L64 92 L14 76 L14 24 L64 8 Z" pathLength="100"/>',
    octagon: '<path d="M94 50 L81 81 L50 94 L19 81 L6 50 L19 19 L50 6 L81 19 Z" pathLength="100"/>',
    triangle: '<path d="M96 50 L6 94 L6 6 Z" pathLength="100"/>',
    heart: '<path d="M78 50 C88 50,95 58,95 68 C95 80,88 95,72 95 C55 95,35 80,12 50 C35 20,55 5,72 5 C88 5,95 20,95 32 C95 42,88 50,78 50 Z" pathLength="100"/>'
  };
  function todayIST(){
    return new Date(Date.now() + 5.5*3600*1000).toISOString().split('T')[0];
  }
  function actDay(a){
    var s = a.activity_date_time_ist || a.activity_date || '';
    return String(s).split('T')[0];
  }
  function metricOf(a, metric){
    if (metric === 'elevation_m') return parseFloat(a.elevation_gain) || 0;
    if (metric === 'moving_time_min') return (parseFloat(a.moving_time_seconds) || 0)/60;
    if (metric === 'steps') return parseFloat(a.steps) || 0;
    if (metric === 'activity_count') return 1;
    return (parseFloat(a.distance_meters) || 0)/1000; // distance_km & total_km
  }
  function unitOf(metric){
    return { points:'pts', distance_km:'km', total_km:'km', elevation_m:'m',
             steps:'steps', moving_time_min:'min', activity_count:'acts' }[metric] || '';
  }

  async function fetchJSON(url){
    var r = await fetch(url, { headers: HDR });
    return r.json();
  }

  async function getActiveEvent(){
    try {
      var s = JSON.parse(safeGetItem('wk_user') || '{}');
      if (!s.athleteId) return null;

      // These two calls are independent of each other — run them in parallel instead of one-after-another
      var results = await Promise.all([
        fetchJSON(SUPABASE_URL + '/rest/v1/events?select=id,name,start_date,end_date,status,rules_config,accent_color&status=in.(live,ended)&order=status.asc,start_date.desc'),
        fetchJSON(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + s.athleteId + '&select=event_id')
      ]);
      var evs = results[0];
      var regs = results[1];
      if (!Array.isArray(evs) || !evs.length) return null;
      var myEvIds = (Array.isArray(regs)?regs:[]).map(function(r){ return r.event_id; });
      
      var pick = null;
      evs.forEach(function(ev){
        if (myEvIds.indexOf(ev.id) === -1) return;
        if (!pick) pick = ev;
        else if (ev.status === 'live' && pick.status !== 'live') pick = ev;
      });
      
      // Fallback: If user is not registered for any live event, pick the first live event in the list for dashboard rendering
      if (!pick) {
        evs.forEach(function(ev){
          if (ev.status === 'live') {
            if (!pick) pick = ev;
          }
        });
      }
      
      var gender = 'Male';
      if (pick) {
        var regRes = await fetchJSON(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + s.athleteId + '&event_id=eq.' + pick.id + '&select=gender');
        if (Array.isArray(regRes) && regRes.length && regRes[0].gender) gender = regRes[0].gender;
      }
      return pick ? { ev: pick, athleteId: s.athleteId, gender: gender } : null;
    } catch(e){ return null; }
  }

  function ringBox(ring, value, goal){
    var pct = goal > 0 ? Math.min(100, (value/goal)*100) : 0;
    var shape = SHAPES[ring.shape] || SHAPES.circle;
    var box = document.createElement('div');
    box.className = 'ring-box';
    var unit = unitOf(ring.metric);
    var fmt = function(v){ return (unit==='km') ? v.toFixed(1) : Math.round(v).toString(); };
    var rot = (ring.shape === 'circle' || !ring.shape) ? ' transform="rotate(-90 50 50)"' : '';
    
    var brightColor = ring.color || '#fff';
    var c = brightColor.toLowerCase();
    if (c === '#70f0db') brightColor = '#00ffd5';
    else if (typeof DEFAULT_BRAND_COLOR === 'string' && c === DEFAULT_BRAND_COLOR.toLowerCase()) brightColor = '#ff5a00';
    else if (c === '#d3e92b') brightColor = '#c6ff00';

    var needed = Math.max(0, goal - value);
    var done = value >= goal;
    var needText = done ? '✓ Achieved' : fmt(needed) + ' ' + unit + ' remaining';
    var needColor = done ? 'var(--green)' : '#ffffff';

    var pctStyle = '';
    if (ring.shape === 'triangle') { pctStyle = ' style="transform:translateY(19px)"'; }

    box.innerHTML =
      '<div class="ring-svg-wrap">' +
        '<svg viewBox="0 0 100 100">' +
          '<g fill="none" stroke="' + brightColor + '" stroke-opacity="0.28" stroke-width="6">' + shape + '</g>' +
          '<g fill="none" stroke="' + brightColor + '" stroke-width="6" stroke-linecap="round">' +
            shape.replace('/>', ' stroke-dasharray="100" stroke-dashoffset="' + (100 - pct).toFixed(1) + '"' + rot + '/>') +
          '</g>' +
        '</svg>' +
        '<div class="ring-inner"><span class="ring-pct"' + pctStyle + '>' + Math.round(pct) + '%</span></div>' +
      '</div>' +
      '<div class="ring-name" style="color:' + brightColor + '">' + (ring.label || ring.metric) + '</div>' +
      '<div class="ring-need" style="color:' + needColor + '; font-weight: 600; font-size: 11.5px; margin-top: 4px; margin-bottom: 2px;">' + needText + '</div>' +
      (done ? '' : '<div style="font-size: 10px; color: var(--text-muted); opacity: 0.85;">' + fmt(value) + ' / ' + fmt(goal) + ' ' + unit + '</div>');
    return box;
  }

  function waitForFullPts(timeoutMs){
    return new Promise(function(resolve){
      if (window._myFullPtsGlobal && window._myFullPtsGlobal.total !== undefined) { resolve(); return; }
      var waited = 0;
      var iv = setInterval(function(){
        waited += 100;
        if ((window._myFullPtsGlobal && window._myFullPtsGlobal.total !== undefined) || waited >= timeoutMs) {
          clearInterval(iv);
          resolve();
        }
      }, 100);
    });
  }

  async function applyDynamicDashboard(){
    var ctx = await getActiveEvent();
    if (!ctx) return;
    var ev = ctx.ev;
    
    // 1. Update the Event Logo or Event Display Name
    var host = document.getElementById('medal-rings');
    var blk = host ? (host.closest('.hero-rings-block') || host.parentNode) : null;
    if (blk) {
      // remove any previous text logo to avoid duplicates on double render
      var oldTxt = blk.querySelector('#app-logo-text');
      if (oldTxt) oldTxt.remove();
    }
    var im = blk ? blk.querySelector('#app-logo') : null;

    if (ev.rules_config && ev.rules_config.logo_url) {
      if (im) {
        im.style.display = 'block';
        im.onerror = function() {
          this.src = 'logo-white.png';
        };
        var separator = ev.rules_config.logo_url.indexOf('?') !== -1 ? '&' : '?';
        im.src = ev.rules_config.logo_url + separator + 'cb=' + Date.now();
        im.style.maxHeight = '34px';
        im.style.height = 'auto';
        im.style.width = 'auto';
        im.style.filter = (ev.rules_config.logo_filter === 'invert') ? 'invert(1) hue-rotate(180deg)' : '';
      }
    } else if (ev.rules_config && ev.rules_config.display_name) {
      if (im) im.style.display = 'none';
      if (host) {
        var txtEl = document.createElement('div');
        txtEl.id = 'app-logo-text';
        txtEl.textContent = ev.rules_config.display_name;
        txtEl.style.cssText = "font-family:'Poppins', sans-serif; font-size:22px; font-weight:400; color:#ffffff; text-align:center; margin-bottom:14px; margin-top:2px; letter-spacing:0.5px; opacity:0.95;";
        host.parentNode.insertBefore(txtEl, host);
      }
    } else {
      if (im) {
        im.style.display = 'block';
        var cachedBr = null;
        try { cachedBr = JSON.parse(localStorage.getItem('ag_branding_cache')); } catch(e){}
        var brLogo = (cachedBr && cachedBr.logo_url) ? cachedBr.logo_url : 'logo-white.png';
        im.onerror = function() {
          this.src = 'logo-white.png';
        };
        if (brLogo !== 'logo-white.png') {
          var sep = brLogo.indexOf('?') !== -1 ? '&' : '?';
          im.src = brLogo + sep + 'cb=' + Date.now();
        } else {
          im.src = 'logo-white.png';
        }
        im.style.height = '26px';
        im.style.width = 'auto';
      }
    }
    // Cache active event config for other modules
    try { localStorage.setItem('ag_active_event_cache', JSON.stringify(ev)); } catch(e){}
    try { if (typeof applyEffectiveAccentColor === 'function') applyEffectiveAccentColor(); } catch(e){}

    // Apply sections show/hide toggles
    if (ev.rules_config && ev.rules_config.dashboard) {
      var dash = ev.rules_config.dashboard;
      var sec = dash.sections || {};
      
      // 1. My Points card
      var ptsSec = document.getElementById('my-points-section');
      if (ptsSec) {
        ptsSec.style.display = (sec.my_points === false) ? 'none' : 'block';
      }
      
      // 2. My Stats card
      var statsSec = document.getElementById('my-stats-section');
      if (statsSec) {
        statsSec.style.display = (sec.my_stats === false) ? 'none' : 'block';
      }
      
      // 3. My Stats subcomponents
      var compActs = document.getElementById('stat-item-activities');
      var compDist = document.getElementById('stat-item-distance');
      var compTime = document.getElementById('stat-item-movingtime');
      var gridContainer = document.getElementById('mystats-grid-container');
      
      var showActs = sec.stat_activities !== false;
      var showDist = sec.stat_distance !== false;
      var showTime = sec.stat_movingtime !== false;
      
      if (compActs) compActs.style.display = showActs ? 'flex' : 'none';
      if (compDist) compDist.style.display = showDist ? 'flex' : 'none';
      if (compTime) compTime.style.display = showTime ? 'flex' : 'none';
      
      // Adjust grid columns template based on how many subcomponents are visible
      if (gridContainer) {
        var visibleCount = [showActs, showDist, showTime].filter(Boolean).length;
        if (visibleCount === 0) {
          if (statsSec) statsSec.style.display = 'none'; // hide entire card if all sub-metrics hidden
        } else {
          gridContainer.style.gridTemplateColumns = 'repeat(' + visibleCount + ', 1fr)';
        }
      }
      
      // 4. Pace Goals section
      var paceSec = document.getElementById('pace-goals-section');
      if (paceSec) {
        paceSec.style.display = (sec.pace_goals === false) ? 'none' : 'block';
      }
      
      // 5. Classic streak toggle
      if (sec.streak === false) {
        var st = document.getElementById('streak-section') || document.querySelector('[data-section="streak"]');
        if (st) st.style.display = 'none';
      }
      
      // 6. Classic challenges toggle
      var chCard = document.getElementById('dashboard-challenges-card');
      if (sec.challenges === false) {
        if (chCard) chCard.style.display = 'none';
        var ch = document.getElementById('you-panel-challenges');
        var chBtn = document.getElementById('you-tab-challenges');
        if (chBtn) chBtn.style.display = 'none';
        if (ch) ch.style.display = 'none';
      } else {
        if (chCard) chCard.style.display = 'flex';
      }
    }

    // 2. Render custom rings if configured. If not, keep the classic layout
    var hasDash = ev.rules_config && ev.rules_config.dashboard &&
                  Array.isArray(ev.rules_config.dashboard.rings) && ev.rules_config.dashboard.rings.length;
    if (!hasDash) {
      // classic rings path: clear any stale dynamic flag so the hero arc can render
      try { localStorage.removeItem('ag_dyn_dash'); } catch(e){}
      var arcW = document.getElementById('hero-arc-wrap');
      var ringsHost = document.getElementById('medal-rings');
      if (arcW && ringsHost && ringsHost.style.display === 'none') arcW.style.display = 'block';
      return;
    }
    
    var dash = ev.rules_config.dashboard;
    var rows = null;
    try {
      rows = await fetchJSON(SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + ctx.athleteId +
        '&event_id=eq.' + ev.id + '&is_deleted=eq.false&is_flagged=eq.false' +
        '&select=strava_activity_id,distance_meters,elevation_gain,moving_time_seconds,steps,activity_date,activity_date_time_ist,sport_type,manual_bonus,description,is_flagged');
    } catch(e){ return; }
    var acts = Array.isArray(rows) ? rows : [];
    var today = todayIST();
    var evDays = Math.max(1, Math.round((new Date(ev.end_date) - new Date(ev.start_date))/86400000) + 1);

    // If any ring shows points, wait briefly for app-api.js's authoritative total
    // (window._myFullPtsGlobal) instead of racing ahead with an independent recompute.
    var needsPoints = dash.rings.slice(0,5).some(function(r){ return r.metric === 'points'; });
    if (needsPoints) { await waitForFullPts(5000); }

    if (!host) return;
    try { localStorage.setItem('ag_dyn_dash', '1'); } catch(e){}
    host.style.display = '';
    var arcWrap = document.getElementById('hero-arc-wrap');
    if (arcWrap) arcWrap.style.display = 'none';
    host.textContent = '';
    host.style.opacity = '1';
    
    var gKey = (ctx.gender || '').toLowerCase() === 'female' ? 'female' : 'male';

    dash.rings.slice(0,5).forEach(function(ring){
      var total = 0, todaySum = 0;
      acts.forEach(function(a){
        var v = metricOf(a, ring.metric);
        total += v;
        if (actDay(a) === today) todaySum += v;
      });
      
      var goalRaw = (gKey === 'female') ? (ring.goal_female !== undefined ? ring.goal_female : ring.goal) : (ring.goal_male !== undefined ? ring.goal_male : ring.goal);
      goalRaw = String(goalRaw || '').toLowerCase().trim();
      var goal = parseFloat(goalRaw) || 0;

      var value;
      if (ring.goal_type === 'total') { value = total; }
      else if (ring.goal_type === 'auto') { value = todaySum; goal = goal / evDays; }
      else { value = todaySum; }
      
      if (ring.metric === 'points') {
        var pTotal = 0;
        if (window._myFullPtsGlobal && window._myFullPtsGlobal.total !== undefined) {
          pTotal = window._myFullPtsGlobal.total;
        } else {
          try {
            if (typeof calcFullPts === 'function') {
              var p = calcFullPts(acts, ctx.gender, ctx.shift);
              pTotal = p.total;
            }
          } catch(e){}
        }
        value = pTotal;
      }
      host.appendChild(ringBox(ring, value, goal));
    });
    
    // retitle the block to the event
    var blockTitle = document.querySelector('.hero-rings-block .rings-title, .hero-rings-block h3');
    if (blockTitle) blockTitle.textContent = ev.name + ' — Goals';

    // section toggles
    var sec = dash.sections || {};
    if (sec.medals === false) { /* medal rings replaced already */ }
    if (sec.streak === false) {
      var st = document.getElementById('streak-section') || document.querySelector('[data-section="streak"]');
      if (st) st.style.display = 'none';
    }
    var chCard = document.getElementById('dashboard-challenges-card');
    if (sec.challenges === false) {
      if (chCard) chCard.style.display = 'none';
      var ch = document.getElementById('you-panel-challenges');
      var chBtn = document.getElementById('you-tab-challenges');
      if (chBtn) chBtn.style.display = 'none';
      if (ch) ch.style.display = 'none';
    } else {
      if (chCard) chCard.style.display = 'flex';
    }
  }

  // run after the app has booted (globals + DOM ready)
  var tries = 0;
  var t = setInterval(function(){
    tries++;
    if (typeof SUPABASE_URL !== 'undefined' && typeof HDR !== 'undefined' && document.getElementById('medal-rings')) {
      clearInterval(t);
      // avoid classic-rings flash for users we know get a dynamic dashboard
      try { if (localStorage.getItem('ag_dyn_dash') === '1') document.getElementById('medal-rings').style.opacity = '0'; } catch(e){}
      applyDynamicDashboard().then(function(){
        var h = document.getElementById('medal-rings');
        if (h) h.style.opacity = '1';
      });
    } else if (tries > 100) clearInterval(t);
  }, 100);
})();
