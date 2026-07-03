/* ============================================================
   participant-dashboard.js — Dynamic per-event dashboard rings
   Reads rules_config.dashboard of the participant's active event.
   No config => leaves the classic Walkathon layout untouched.
   ============================================================ */
(function(){
  var SHAPES = {
    circle:  '<circle cx="50" cy="50" r="43" pathLength="100"/>',
    diamond: '<path d="M50 6 L94 50 L50 94 L6 50 Z" pathLength="100"/>',
    hexagon: '<path d="M50 5 L89 27 L89 73 L50 95 L11 73 L11 27 Z" pathLength="100"/>',
    square:  '<rect x="9" y="9" width="82" height="82" rx="18" pathLength="100"/>',
    shield:  '<path d="M50 5 L87 18 L87 52 C87 73 70 87 50 95 C30 87 13 73 13 52 L13 18 Z" pathLength="100"/>'
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

  async function getActiveEventWithDash(){
    try {
      var s = JSON.parse(safeGetItem('wk_user') || '{}');
      if (!s.athleteId) return null;
      var evs = await fetchJSON(SUPABASE_URL + '/rest/v1/events?select=id,name,start_date,end_date,status,rules_config&status=in.(live,ended)&order=status.asc,start_date.desc');
      if (!Array.isArray(evs) || !evs.length) return null;
      var regs = await fetchJSON(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + s.athleteId + '&select=event_id');
      var myEvIds = (Array.isArray(regs)?regs:[]).map(function(r){ return r.event_id; });
      // prefer a LIVE enrolled event with dashboard config, then any enrolled with config
      var pick = null;
      evs.forEach(function(ev){
        if (myEvIds.indexOf(ev.id) === -1) return;
        var hasDash = ev.rules_config && ev.rules_config.dashboard &&
                      Array.isArray(ev.rules_config.dashboard.rings) && ev.rules_config.dashboard.rings.length;
        if (!hasDash) return;
        if (!pick) pick = ev;
        else if (ev.status === 'live' && pick.status !== 'live') pick = ev;
      });
      return pick ? { ev: pick, athleteId: s.athleteId } : null;
    } catch(e){ return null; }
  }

  function ringBox(ring, value, goal){
    var pct = goal > 0 ? Math.min(100, (value/goal)*100) : 0;
    var shape = SHAPES[ring.shape] || SHAPES.circle;
    var box = document.createElement('div');
    box.className = 'ring-box';
    var unit = unitOf(ring.metric);
    var fmt = function(v){ return (unit==='km') ? v.toFixed(1) : Math.round(v).toString(); };
    box.innerHTML =
      '<div class="ring-svg-wrap">' +
        '<svg viewBox="0 0 100 100">' +
          '<g fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="8">' + shape + '</g>' +
          '<g fill="none" stroke="' + ring.color + '" stroke-width="8" stroke-linecap="round" ' +
             'style="filter:drop-shadow(0 0 6px ' + ring.color + '66)">' +
            shape.replace('/>', ' stroke-dasharray="100" stroke-dashoffset="' + (100 - pct).toFixed(1) + '" transform="rotate(-90 50 50)"/>') +
          '</g>' +
        '</svg>' +
        '<div class="ring-inner"><span class="ring-pct">' + Math.round(pct) + '%</span></div>' +
      '</div>' +
      '<div class="ring-name" style="color:' + ring.color + '">' + (ring.label || ring.metric) + '</div>' +
      '<div class="ring-need">' + fmt(value) + ' / ' + fmt(goal) + ' ' + unit + '</div>';
    return box;
  }

  async function applyDynamicDashboard(){
    var ctx = await getActiveEventWithDash();
    if (!ctx) return; // classic layout stays
    var ev = ctx.ev, dash = ev.rules_config.dashboard;
    var rows = null;
    try {
      rows = await fetchJSON(SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + ctx.athleteId +
        '&event_id=eq.' + ev.id + '&is_deleted=is.false&is_flagged=is.false' +
        '&select=distance_meters,elevation_gain,moving_time_seconds,steps,activity_date,activity_date_time_ist');
    } catch(e){ return; }
    var acts = Array.isArray(rows) ? rows : [];
    var today = todayIST();
    var evDays = Math.max(1, Math.round((new Date(ev.end_date) - new Date(ev.start_date))/86400000) + 1);

    var host = document.getElementById('medal-rings');
    if (!host) return;
    host.textContent = '';
    dash.rings.slice(0,5).forEach(function(ring){
      var total = 0, todaySum = 0;
      acts.forEach(function(a){
        var v = metricOf(a, ring.metric);
        total += v;
        if (actDay(a) === today) todaySum += v;
      });
      var value, goal;
      if (ring.goal_type === 'total') { value = total; goal = ring.goal; }
      else if (ring.goal_type === 'auto') { value = todaySum; goal = ring.goal / evDays; }
      else { value = todaySum; goal = ring.goal; }
      if (ring.metric === 'points') { value = 0; goal = ring.goal; /* points ring: shown as total when engine data present */
        try { if (typeof calcFullPtsAdaptive === 'function') { var p = calcFullPtsAdaptive(acts, null, null); value = (ring.goal_type === 'daily') ? 0 : p.total; } } catch(e){}
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
    if (sec.challenges === false) {
      var ch = document.getElementById('you-panel-challenges');
      var chBtn = document.getElementById('you-tab-challenges');
      if (chBtn) chBtn.style.display = 'none';
      if (ch) ch.style.display = 'none';
    }
  }

  // run after the app has booted (globals + DOM ready)
  var tries = 0;
  var t = setInterval(function(){
    tries++;
    if (typeof SUPABASE_URL !== 'undefined' && typeof HDR !== 'undefined' && document.getElementById('medal-rings')) {
      clearInterval(t);
      setTimeout(applyDynamicDashboard, 800);
    } else if (tries > 40) clearInterval(t);
  }, 250);
})();
