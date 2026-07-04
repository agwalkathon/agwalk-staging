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
      var s = await fetch(SUPABASE_URL + '/rest/v1/activities?event_id=eq.' + ev.id +
        '&is_deleted=is.false&is_flagged=is.false&select=total_km:distance_meters.sum(),acts:id.count()', { headers: HDR });
      var d = await s.json();
      if (d && d[0]) ev._stats = { km: (d[0].total_km || 0) / 1000, acts: d[0].acts || 0 };
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

function buildEventCard(ev, group) {
  var registrationStatus = _myEventRegistrations ? _myEventRegistrations[ev.id] : null;
  var enrolled = _myEventIds.indexOf(ev.id) > -1;
  var isApproved = enrolled && (registrationStatus === 'approved' || registrationStatus === 'active');
  var isPending = enrolled && (registrationStatus === 'pending');

  var card = document.createElement('div');
  card.className = 'ev-card-p';
  card.style.borderLeft = '4px solid ' + (ev.accent_color || '#E8622A');

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

  if (ev.description) {
    var desc = document.createElement('div');
    desc.className = 'ev-card-desc';
    desc.textContent = ev.description;
    body.appendChild(desc);
  }

  if (ev._stats) {
    var st = document.createElement('div');
    st.className = 'ev-card-stats';
    var bits = [];
    if (ev._participants) bits.push(ev._participants + ' participants');
    bits.push(Math.round(ev._stats.km).toLocaleString('en-IN') + ' km total');
    bits.push(ev._stats.acts.toLocaleString('en-IN') + ' activities');
    st.textContent = bits.join('  ·  ');
    body.appendChild(st);
  }

  var actions = document.createElement('div');
  actions.className = 'ev-card-actions';

  var today0 = new Date().toISOString().split('T')[0];
  var regOpenNow = ev.registration_open_date && ev.registration_close_date &&
                   today0 >= ev.registration_open_date && today0 <= ev.registration_close_date;
  if (group === 'live' || group === 'past') {
    var lb = document.createElement('button');
    lb.className = 'ev-btn';
    lb.textContent = group === 'past' ? '🏆 Final Results' : '🏆 Leaderboard';
    lb.addEventListener('click', function(){ openEventLeaderboard(ev); });
    actions.appendChild(lb);
    
    if (group === 'live' && !enrolled && regOpenNow) {
      var jrb = document.createElement('button');
      jrb.className = 'ev-btn ev-btn-primary';
      jrb.style.background = ev.accent_color || '';
      jrb.textContent = hasRegDraft(ev.id) ? '▶ Resume Registration' : 'Register Now';
      jrb.addEventListener('click', function(){ openEventRegistration(ev); });
      actions.appendChild(jrb);
    } else if (group === 'live' && isPending) {
      var jrb = document.createElement('button');
      jrb.className = 'ev-btn ev-btn-primary';
      jrb.style.background = 'rgba(255, 255, 255, 0.08)';
      jrb.style.color = 'rgba(255, 255, 255, 0.4)';
      jrb.style.cursor = 'not-allowed';
      jrb.disabled = true;
      jrb.textContent = 'Registered (Pending)';
      actions.appendChild(jrb);
    } else if (group === 'live' && !enrolled) {
      var sp = document.createElement('div');
      sp.className = 'ev-spectator-note';
      sp.textContent = "You're watching — join the next event to compete!";
      body.appendChild(sp);
    }
  }

  if (group === 'upcoming') {
    var regOpen = regOpenNow;
    if (isApproved) {
      var ok = document.createElement('div');
      ok.className = 'ev-spectator-note';
      ok.textContent = "You're enrolled. Get ready! 💪";
      body.appendChild(ok);
    } else if (isPending) {
      var rb = document.createElement('button');
      rb.className = 'ev-btn ev-btn-primary';
      rb.style.background = 'rgba(255, 255, 255, 0.08)';
      rb.style.color = 'rgba(255, 255, 255, 0.4)';
      rb.style.cursor = 'not-allowed';
      rb.disabled = true;
      rb.textContent = 'Registered (Pending)';
      actions.appendChild(rb);
    } else if (regOpen) {
      var rb = document.createElement('button');
      rb.className = 'ev-btn ev-btn-primary';
      rb.style.background = ev.accent_color || '';
      rb.textContent = hasRegDraft(ev.id) ? '▶ Resume Registration' : 'Register Now';
      rb.addEventListener('click', function(){ openEventRegistration(ev); });
      actions.appendChild(rb);
    } else if (ev.registration_open_date) {
      var no = document.createElement('div');
      no.className = 'ev-spectator-note';
      no.textContent = 'Registration opens ' + evFmtDate(ev.registration_open_date);
      body.appendChild(no);
    }
  }

  if (actions.children.length) body.appendChild(actions);
  card.appendChild(body);
  return card;
}

// ===== Event-scoped leaderboard switching =====
var _lbCurrentEventId = 1;          // event 1 = Walkathon 2026, the data Phase 1/2 loads by default
var _lbDefaultState = null;         // saved event-1 globals
var _lbEventCache = {};             // fetched data per event id

function setLbTitle(txt) {
  var el = document.getElementById('lb-event-title');
  if (el) { el.textContent = txt || ''; el.style.display = txt ? 'block' : 'none'; }
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
}

async function fetchEventLbState(evId) {
  if (_lbEventCache[evId]) return _lbEventCache[evId];
  var slimActs = '&select=strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist';
  var results = await Promise.all([
    fetchAllParallel(SUPABASE_URL + '/rest/v1/activities?event_id=eq.' + evId + '&is_deleted=is.false&order=id.asc' + slimActs),
    fetchAllParallel(SUPABASE_URL + '/rest/v1/registration?event_id=eq.' + evId + '&order=strava_athlete_id.asc&select=strava_athlete_id,full_name,gender,shift,leaderboard_team'),
    fetch(SUPABASE_URL + '/rest/v1/leaderboard_config?event_id=eq.' + evId + '&select=config_key,config_value', { headers: HDR }).then(function(r){ return r.json(); }),
    fetch(SUPABASE_URL + '/rest/v1/challenges?event_id=eq.' + evId + '&is_active=is.true&select=*', { headers: HDR }).then(function(r){ return r.json(); }),
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
  _lbEventCache[evId] = st;
  return st;
}

async function openEventLeaderboard(ev) {
  try {
    var suffix = (ev.status === 'ended' || ev.status === 'archived') ? ' — Final Results' : '';
    if (ev.id === _lbCurrentEventId) {
      setLbTitle(_lbCurrentEventId === 1 ? '' : '🏆 ' + ev.name + suffix);
      showTab('leaderboard');
      return;
    }
    if (ev.id === 1 && _lbDefaultState) {
      applyLbState(_lbDefaultState);
      _LB_EV_RULES = null;
      _lbCurrentEventId = 1;
      setLbTitle('');
      showTab('leaderboard');
      lbBoot();
      return;
    }
    saveDefaultLbState();
    var st = await fetchEventLbState(ev.id);
    applyLbState(st);
    _LB_EV_RULES = ev.rules_config || null;
    _lbCurrentEventId = ev.id;
    setLbTitle('🏆 ' + ev.name + suffix);
    showTab('leaderboard');
    lbBoot();
  } catch (e) {
    console.warn('openEventLeaderboard failed:', e);
    showTab('leaderboard');
  }
}

// When the nav Leaderboard icon is tapped directly, always show the default (event 1) board
(function hookNavLeaderboardReset(){
  var nav = document.getElementById('bnav-leaderboard');
  if (!nav) return;
  nav.addEventListener('click', function(){
    if (_lbCurrentEventId !== 1 && _lbDefaultState) {
      applyLbState(_lbDefaultState);
      _LB_EV_RULES = null;
      _lbCurrentEventId = 1;
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
