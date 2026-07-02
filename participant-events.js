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

  // which events am I enrolled in?
  var athleteId = null;
  try {
    var u = JSON.parse(safeGetItem('wk_user') || '{}');
    athleteId = u.athleteId || null;
  } catch (e) {}
  if (!athleteId && typeof currentSession !== 'undefined' && currentSession) athleteId = currentSession.athleteId;
  _myEventIds = [];
  if (athleteId) {
    try {
      var rr = await fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=event_id', { headers: HDR });
      var rows = await rr.json();
      _myEventIds = (rows || []).map(function(x){ return x.event_id; }).filter(function(x){ return x != null; });
    } catch (e) {}
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
  var enrolled = _myEventIds.indexOf(ev.id) > -1;
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
  if (group === 'live') {
    var lv = document.createElement('span'); lv.className = 'ev-pill ev-pill-live'; lv.textContent = '● LIVE'; top.appendChild(lv);
  } else if (enrolled) {
    var en = document.createElement('span'); en.className = 'ev-pill ev-pill-enrolled'; en.textContent = '✓ Enrolled'; top.appendChild(en);
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

  if (group === 'live' || group === 'past') {
    var lb = document.createElement('button');
    lb.className = 'ev-btn';
    lb.textContent = group === 'past' ? '🏆 Final Results' : '🏆 Leaderboard';
    lb.addEventListener('click', function(){ showTab('leaderboard'); });
    actions.appendChild(lb);
    if (group === 'live' && !enrolled) {
      var sp = document.createElement('div');
      sp.className = 'ev-spectator-note';
      sp.textContent = "You're watching — join the next event to compete!";
      body.appendChild(sp);
    }
  }

  if (group === 'upcoming') {
    var today = new Date().toISOString().split('T')[0];
    var regOpen = ev.registration_open_date && ev.registration_close_date &&
                  today >= ev.registration_open_date && today <= ev.registration_close_date;
    if (enrolled) {
      var ok = document.createElement('div');
      ok.className = 'ev-spectator-note';
      ok.textContent = "You're registered. Get ready! 💪";
      body.appendChild(ok);
    } else if (regOpen) {
      var rb = document.createElement('button');
      rb.className = 'ev-btn ev-btn-primary';
      rb.textContent = 'Register Now';
      rb.addEventListener('click', function(){ window.location.href = 'register.html?event=' + encodeURIComponent(ev.slug); });
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
