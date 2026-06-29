// Tab Rendering, UI Controllers, PWA, and Swipe Navigation

// Shared global state variables (declared in participant-config.js):
// _currentTab, _lbReady, LB_ME, LB_REG, LB_ACTS, LB_SCORES, _feedData

var _feedLoaded = false;
var _feedVisibleCount = 30;
var _feedPollInterval = null;

var _highlightsData = {};
var _activeInsight = null;
var _activeRecovery = null;
var _notificationsList = [];
var _notificationsLoaded = false;
var TAB_ORDER = ['dashboard', 'activities', 'leaderboard', 'you'];

// Tab Order for indicator rendering
function updateNavIndicator() {
  var bnav = document.querySelector('.bottom-nav');
  var indicator = document.getElementById('nav-indicator');
  var activeItem = bnav ? bnav.querySelector('.bnav-item.active') : null;
  if (!bnav || !indicator || !activeItem) return;
  var items = Array.from(bnav.querySelectorAll('.bnav-item'));
  var idx = items.indexOf(activeItem);
  if (idx === -1) return;
  var w = 100 / items.length;
  indicator.style.width = w + '%';
  indicator.style.left = (idx * w) + '%';
}

function showTab(tab) {
  if (tab === 'feed' && !CONFIG_LB.announcements_enabled) return;
  if (_currentTab === tab) return;

  var prevTab = _currentTab;
  _currentTab = tab;

  // Toggle active class in nav
  document.querySelectorAll('.bnav-item').forEach(function(el) {
    el.classList.toggle('active', el.id === 'bnav-' + tab);
  });

  // Calculate slide displacement
  var idx = TAB_ORDER.indexOf(tab);
  var track = document.getElementById('tab-track');
  if (track && idx !== -1) {
    track.style.transform = 'translateX(-' + (idx * (100 / TAB_ORDER.length)) + '%)';
  }

  updateNavIndicator();

  // Lazy loaders for tabs
  if (tab === 'dashboard') {
    triggerRingAnimation();
  }
  if (tab === 'leaderboard') {
    lbBoot();
  }
  if (tab === 'feed') {
    safeSetItem('ag_last_viewed_announcements', new Date().toISOString());
    var badgeEl = document.getElementById('feed-unread-badge');
    if (badgeEl) badgeEl.style.display = 'none';
    if (!_feedLoaded) {
      loadFeed().catch(function(e) { console.warn('showTab loadFeed error:', e); });
      _feedLoaded = true;
    }
    // Force Leaflet to re-measure container sizes after tab slide animation is complete
    setTimeout(function() {
      if (window._feedMaps && window._feedMaps.length > 0) {
        window._feedMaps.forEach(function(m) {
          try { m.invalidateSize(); } catch(e) {}
        });
      }
    }, 350);
  }

  // Poll intervals for live updates
  if (tab === 'feed' && CONFIG_LB.announcements_enabled) {
    if (!_feedPollInterval) {
      _feedPollInterval = setInterval(function() {
        loadFeed(true).catch(function(e) { console.warn('Poll loadFeed error:', e); });
      }, 10000);
    }
  } else {
    if (_feedPollInterval) {
      clearInterval(_feedPollInterval);
      _feedPollInterval = null;
    }
  }
}

// Swipe Gesture for Tab Navigation
(function() {
  var MIN_SWIPE_X = 40;
  var _swipeDir = null;
  var startX = 0, startY = 0;

  window.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    _swipeDir = null;
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (e.touches.length !== 1) return;
    if (_swipeDir === 'v') return;

    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;

    if (_swipeDir === null) {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        _swipeDir = 'h';
      } else if (Math.abs(dy) > 6) {
        _swipeDir = 'v';
      }
    }

    if (_swipeDir === 'h') {
      var activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }
      var targetModal = e.target.closest('.detail-modal');
      var leafletTouch = e.target.closest('.leaflet-container');
      if (targetModal || leafletTouch) {
        return;
      }
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchend', function(e) {
    if (_swipeDir !== 'h') return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < MIN_SWIPE_X) return;

    var curIdx = TAB_ORDER.indexOf(_currentTab);
    if (curIdx === -1) return;

    if (dx > 0) {
      if (curIdx > 0) showTab(TAB_ORDER[curIdx - 1]);
    } else {
      if (curIdx < TAB_ORDER.length - 1) showTab(TAB_ORDER[curIdx + 1]);
    }
    _swipeDir = null;
  }, { passive: true });

  window.addEventListener('touchcancel', function() {
    _swipeDir = null;
  }, { passive: true });
})();

// Dashboard community pulse tab rendering
function renderCommunityPulse() {
  var dTotalDist = document.getElementById('pulse-total-dist');
  var dTotalSteps = document.getElementById('pulse-total-steps');
  var dActCount = document.getElementById('pulse-active-count');
  var dTotalCount = document.getElementById('pulse-total-count');
  
  if (!LB_REG || !LB_REG.length || !LB_ACTS || !LB_ACTS.length) {
    if (dTotalDist) dTotalDist.textContent = '—';
    return;
  }

  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  var totalDist = 0;
  var totalActs = 0;
  var activeAthleteIds = {};

  LB_REG.forEach(function(p) {
    var acts = actsByAthlete[p.strava_athlete_id] || [];
    var fullPts = calcFullPts(acts, p.gender, p.shift);
    totalDist += fullPts.km;
    
    var validActs = acts.filter(function(a) { return !a.is_flagged; });
    totalActs += validActs.length;
    if (validActs.length > 0) {
      activeAthleteIds[p.strava_athlete_id] = true;
    }
  });

  var totalSteps = Math.round(totalDist * 1350);
  var activeCount = Object.keys(activeAthleteIds).length;

  if (dTotalDist) dTotalDist.textContent = Math.round(totalDist).toLocaleString('en-IN');
  if (dTotalSteps) dTotalSteps.textContent = totalSteps.toLocaleString('en-IN');
  if (dActCount) dActCount.textContent = activeCount;
  if (dTotalCount) dTotalCount.textContent = 'of ' + LB_REG.length + ' registered';
}

function triggerRingAnimation() {
  if (typeof _ringAnimationData === 'undefined' || !_ringAnimationData.length) return;
  _ringAnimationData.forEach(function(item) {
    item.fillEl.style.strokeDashoffset = item.offset;
    var start = 0;
    var duration = 800;
    var startTime = null;
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = timestamp - startTime;
      var current = Math.min(item.displayPct, Math.floor((progress / duration) * item.displayPct));
      item.pctEl.textContent = current + '%';
      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        item.pctEl.textContent = item.displayPct + '%';
      }
    }
    requestAnimationFrame(animate);
  });
}

// Activities tab rendering
function renderActivities(acts, dayBreakdown, actBreakdown, gender) {
  var list = document.getElementById('act-list');
  if (!list) return;
  if (!acts || !acts.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🏃</div><p>No activities logged yet this month.<br>Activities synced from Strava will appear here.</p></div>';
    return;
  }
  list.innerHTML = '';

  var groupedByDay = {};
  acts.forEach(function(a) {
    var d = getActDate(a);
    if (!d) return;
    if (!groupedByDay[d]) groupedByDay[d] = [];
    groupedByDay[d].push(a);
  });

  var sortedDays = Object.keys(groupedByDay).sort(function(a,b){ return b.localeCompare(a); });
  sortedDays.forEach(function(date) {
    var dayActs = groupedByDay[date];
    var db = dayBreakdown[date] || { km: 0, distPts: 0, bonusPts: 0, challenges: [], capped: false };
    
    var dateObj = new Date(date + 'T00:00:00');
    var dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
    
    var dateRow = document.createElement('div');
    dateRow.className = 'act-date-row';
    dateRow.innerHTML = `
      <span class="date-lbl">${dateStr}</span>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="date-km">${db.km.toFixed(1)} km</span>
        <span class="date-pts">+${(db.distPts + db.bonusPts).toFixed(1)} pts</span>
      </div>
    `;
    list.appendChild(dateRow);

    dayActs.forEach(function(a) {
      var actCard = document.createElement('div');
      actCard.className = 'act-card' + (a.is_flagged ? ' flagged' : '');
      var startLocalTime = '';
      try {
        var localDt = new Date(a.activity_date);
        if (!isNaN(localDt.getTime())) {
          startLocalTime = localDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
      } catch (e) {}

      var distKmVal = (a.distance_meters || 0) / 1000;
      var paceValStr = '—';
      var movingSec = a.moving_time_seconds || 0;
      if (distKmVal > 0 && movingSec > 0) {
        paceValStr = fmtPS(movingSec / distKmVal, a.sport_type);
      }

      var calculatedSteps = Math.round(distKmVal * 1350);
      var displaySteps = calculatedSteps.toLocaleString('en-IN');
      if (a.steps && a.steps > 0) {
        displaySteps = a.steps.toLocaleString('en-IN') + ' <span style="font-size:10px; color:var(--green); font-weight:700;">(Strava)</span>';
      }

      var splitBtn = '';
      if (a.strava_activity_id) {
        splitBtn = `<div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.04); margin-top:10px; padding-top:10px;">
          <button class="splits-toggle-btn" onclick="loadSplitsForActivity('${a.strava_activity_id}')">Show Splits</button>
          <div id="splits-loader-${a.strava_activity_id}" style="display:none; font-size:11px; color:var(--muted);">Loading splits...</div>
        </div>
        <div id="splits-container-${a.strava_activity_id}" class="splits-container-block" style="display:none;"></div>`;
      }

      var actName = a.activity_name || (a.sport_type + ' Activity');
      var onclickAttr = 'openActivityDetail(\'' + a.strava_activity_id + '\', event, true)';

      actCard.innerHTML = `
        <div class="act-card-inner" onclick="${onclickAttr}" style="cursor: pointer;">
          <div class="act-header">
            <span class="act-name">${esc(actName)}</span>
            <span class="act-time">${startLocalTime}</span>
          </div>
          <div class="act-stats">
            <div class="act-stat">
              <span class="lbl">Distance</span>
              <span class="val">${distKmVal.toFixed(2)} km</span>
            </div>
            <div class="act-stat">
              <span class="lbl">Duration</span>
              <span class="val">${fmtDur(movingSec)}</span>
            </div>
            <div class="act-stat">
              <span class="lbl">Pace</span>
              <span class="val">${paceValStr}</span>
            </div>
            <div class="act-stat">
              <span class="lbl">Est Steps</span>
              <span class="val">${displaySteps}</span>
            </div>
          </div>
          ${a.is_flagged ? '<div class="flagged-banner">⚠️ Flagged in Strava (not counted in points)</div>' : ''}
        </div>
        ${splitBtn}
      `;
      list.appendChild(actCard);
    });
  });
}

function loadSplitsForActivity(actId) {
  var container = document.getElementById('splits-container-' + actId);
  var loader = document.getElementById('splits-loader-' + actId);
  var btn = container ? container.parentElement.querySelector('.splits-toggle-btn') : null;
  if (!container || !loader) return;

  var isVisible = container.style.display === 'block';
  if (isVisible) {
    container.style.display = 'none';
    if (btn) btn.textContent = 'Show Splits';
    return;
  }

  if (container.getAttribute('data-loaded') === 'true') {
    container.style.display = 'block';
    if (btn) btn.textContent = 'Hide Splits';
    return;
  }

  loader.style.display = 'block';
  if (btn) btn.style.display = 'none';

  fetch(SUPABASE_URL + '/rest/v1/activity_splits?activity_id=eq.' + actId + '&order=split_number.asc', { headers: HDR })
    .then(function(res) { return res.json(); })
    .then(function(splits) {
      loader.style.display = 'none';
      if (btn) {
        btn.style.display = 'block';
        btn.textContent = 'Hide Splits';
      }
      
      if (!splits || splits.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0;">No splits available.</div>';
        container.style.display = 'block';
        container.setAttribute('data-loaded', 'true');
        return;
      }

      var hasHR = splits.some(function(s) { return s.average_heartrate !== null && s.average_heartrate !== undefined && s.average_heartrate > 0; });
      var html = '<table class="splits-table"><thead><tr><th style="text-align:left;">Split #</th><th style="text-align:left;">Distance</th><th style="text-align:left;">Pace</th>' + (hasHR ? '<th style="text-align:left;">Avg HR</th>' : '') + '</tr></thead><tbody>';
      
      splits.forEach(function(s) {
        var sDist = ((s.distance_meters || 0) / 1000).toFixed(2) + ' km';
        var sPace = '--';
        var sDistKm = (s.distance_meters || 0) / 1000;
        var sMoving = s.moving_time_seconds || 0;
        if (sDistKm > 0 && sMoving > 0) {
          var sPaceSec = sMoving / sDistKm;
          var sPaceMin = Math.floor(sPaceSec / 60);
          var sPaceRemainder = Math.round(sPaceSec % 60);
          if (sPaceRemainder < 10) sPaceRemainder = '0' + sPaceRemainder;
          sPace = sPaceMin + ':' + sPaceRemainder + ' /km';
        }
        var sHR = s.average_heartrate ? Math.round(s.average_heartrate) + ' bpm' : '—';
        html += '<tr><td style="color:var(--muted); font-weight:600;">#' + s.split_number + '</td><td style="color:#fff; font-weight:600;">' + sDist + '</td><td style="color:#E8622A; font-weight:700;">' + sPace + '</td>' + (hasHR ? '<td style="color:rgba(255,255,255,0.7);">' + sHR + '</td>' : '') + '</tr>';
      });
      html += '</tbody></table>';
      
      container.innerHTML = html;
      container.style.display = 'block';
      container.setAttribute('data-loaded', 'true');
    })
    .catch(function(err) {
      console.warn('Failed to load splits:', err);
      loader.style.display = 'none';
      if (btn) btn.style.display = 'block';
      container.innerHTML = '<div style="font-size:11px;color:#EF4444;padding:8px 0;cursor:pointer;" onclick="loadSplitsForActivity(\'' + actId + '\')">Failed to load splits. Click to retry.</div>';
      container.style.display = 'block';
    });
}

// Leaderboards Logic
function computeTeamExclusions(){
  function boardRows(filterFn){
    return LB_REG.filter(filterFn).map(function(p){
      var aid = String(p.strava_athlete_id);
      var score = LB_SCORES[aid] || {total:0, km:0, distPts:0, bonusPts:0, challengePts:0};
      return {p:p,pts:score};
    }).filter(function(r){return r.pts.total>0;}).sort(function(a,b){return b.pts.total-a.pts.total;});
  }
  var dsF = boardRows(function(p){var g=norm(p.gender),s=norm(p.shift);return g==='female'&&s.indexOf('day')>-1;});
  var dsM = boardRows(function(p){var g=norm(p.gender),s=norm(p.shift);return (g==='male'||g==='m')&&s.indexOf('day')>-1;});
  var ns  = boardRows(function(p){return norm(p.shift).indexOf('night')>-1;});
  var exFemale = dsF.slice(0,3).map(function(r){return String(r.p.strava_athlete_id);});
  var exMale   = dsM.slice(0,3).map(function(r){return String(r.p.strava_athlete_id);});
  ns.slice(0,3).forEach(function(r){
    var g=norm(r.p.gender),id=String(r.p.strava_athlete_id);
    if(g==='female'){if(exFemale.indexOf(id)===-1)exFemale.push(id);}
    else{if(exMale.indexOf(id)===-1)exMale.push(id);}
  });
  return {male:exMale,female:exFemale};
}

function getRows(mode){
  if(!LB_ME)return[];
  var myGender=norm(LB_ME.gender),myShift=norm(LB_ME.shift),myTeam=norm(LB_ME.leaderboard_team),isNight=myShift.indexOf('night')>-1,isFemale=myGender==='female'||myGender==='f';
  var filtered=LB_REG.filter(function(p){var pg=norm(p.gender),ps=norm(p.shift),pt=norm(p.leaderboard_team),pIsFemale=pg==='female'||pg==='f';if(pIsFemale!==isFemale)return false;if(mode==='team')return pt===myTeam;return ps.indexOf('night')>-1===isNight;});
  var rows=filtered.map(function(p){
    var aid = String(p.strava_athlete_id);
    var score = LB_SCORES[aid] || {total:0, km:0, distPts:0, bonusPts:0, challengePts:0};
    return {p:p,pts:score};
  }).filter(function(r){return r.pts.total>0;}).sort(function(a,b){return b.pts.total-a.pts.total;});
  
  if (mode === 'team') {
    var ex = computeTeamExclusions();
    var exList = isFemale ? ex.female : ex.male;
    return rows.filter(function(r){ return exList.indexOf(String(r.p.strava_athlete_id)) === -1; });
  }
  return rows;
}

function precomputeLBScores() {
  LB_SCORES = {};
  if (!LB_REG || !LB_REG.length) return;
  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });
  LB_REG.forEach(function(p) {
    var aid = String(p.strava_athlete_id);
    var pActs = actsByAthlete[aid] || [];
    LB_SCORES[aid] = calcFullPts(pActs, p.gender, p.shift);
  });
}

(function() {
  try {
    var cachedReg = JSON.parse(safeGetItem('agwalk_ranking_reg') || 'null');
    var cachedActs = JSON.parse(safeGetItem('agwalk_ranking_acts_v2') || 'null');
    if (cachedReg && cachedReg.val && cachedActs && cachedActs.val) {
      LB_REG = cachedReg.val;
      LB_ACTS = cachedActs.val;
      precomputeLBScores();
    }
  } catch(e) {}
})();

function getMedalLB(pts, gender) {
  var gKey = (String(gender||'').trim().toLowerCase() === 'female') ? 'female' : 'male';
  var thresh = { gold:{male:300,female:250}, silver:{male:200,female:150}, bronze:{male:125,female:100} };
  if (typeof medalData !== 'undefined' && Array.isArray(medalData) && medalData.length && medalData[0] && medalData[0].config_value) {
    thresh = medalData[0].config_value;
  }
  var g = Number((thresh.gold   ||{})[gKey]) || (gKey==='female'?250:300);
  var s = Number((thresh.silver ||{})[gKey]) || (gKey==='female'?150:200);
  var b = Number((thresh.bronze ||{})[gKey]) || (gKey==='female'?100:125);
  return pts >= g ? '🥇' : pts >= s ? '🥈' : pts >= b ? '🥉' : '';
}

var _lbMode = 'peer';
function lbRender() {
  var list = document.getElementById('lb-peer-list');
  var teamList = document.getElementById('lb-team-list');
  if (!list || !teamList) return;
  list.innerHTML = '';
  teamList.innerHTML = '';

  var peerRows = getRows('peer');
  var teamRows = getRows('team');

  var myId = String(currentSession ? currentSession.athleteId : '');

  function buildList(rows, targetEl) {
    if (!rows.length) {
      targetEl.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--muted)">No rankings compiled yet.</div>';
      return;
    }
    rows.forEach(function(r, idx) {
      var isMe = String(r.p.strava_athlete_id) === myId;
      var medal = getMedalLB(r.pts.total, r.p.gender);
      var row = document.createElement('div');
      row.className = 'lb-row' + (isMe ? ' me' : '');
      if (targetEl === list && r.p.strava_athlete_id) {
        row.style.cursor = 'pointer';
        row.onclick = function(event) {
          openProfileDetail(r.p.strava_athlete_id, event);
        };
      }
      
      row.innerHTML = `
        <div class="lb-rank">${idx + 1}</div>
        <div class="lb-avatar">${esc(r.p.full_name ? r.p.full_name[0] : '?')}</div>
        <div class="lb-details">
          <span class="lb-name">${esc(r.p.full_name || '—')} ${isMe ? '<span class="you-chip">You</span>' : ''}</span>
          <span class="lb-sub">${Math.round(r.pts.km)} km &middot; ${r.pts.distPts.toFixed(0)} dist &middot; ${r.pts.bonusPts} bonus &middot; ${r.pts.challengePts} challenges</span>
        </div>
        <div class="lb-pts-col">
          <span class="pts">${r.pts.total.toFixed(0)}</span>
          <span class="medal">${medal}</span>
        </div>
      `;
      targetEl.appendChild(row);
    });
  }

  buildList(peerRows, list);
  buildList(teamRows, teamList);

  // Show/Hide Lists based on selected mode
  document.getElementById('lb-peer-container').style.display = _lbMode === 'peer' ? 'block' : 'none';
  document.getElementById('lb-team-container').style.display = _lbMode === 'team' ? 'block' : 'none';
}

function lbBoot() {
  if (!_lbReady) {
    precomputeLBScores();
    _lbReady = true;
  }
  lbRender();
}

function toggleLBMode(mode) {
  _lbMode = mode;
  var btnPeer = document.getElementById('lb-btn-peer');
  var btnTeam = document.getElementById('lb-btn-team');
  if (btnPeer && btnTeam) {
    btnPeer.classList.toggle('active', mode === 'peer');
    btnTeam.classList.toggle('active', mode === 'team');
  }
  lbRender();
}

// Standing Indicator inside Dashboard
function renderStanding() {
  var el = document.getElementById('s-standing');
  if (!el || !LB_REG.length || !LB_ME) return;
  var myId = String(LB_ME.strava_athlete_id);
  var peerRows = getRows('peer');
  var rank = peerRows.findIndex(function(r){ return String(r.p.strava_athlete_id) === myId; }) + 1;
  var total = peerRows.length;
  el.textContent = rank > 0 ? '#' + rank + ' of ' + total : '—';
}

// Feed Tab Rendering
function initializeFeedTab(enabled) {
  var track = document.getElementById('tab-track');
  var bnavFeed = document.getElementById('bnav-feed');
  var tabFeed = document.getElementById('tab-feed');
  var bnav = document.querySelector('.bottom-nav');
  
  if (enabled) {
    if (TAB_ORDER.indexOf('feed') === -1) {
      TAB_ORDER.splice(3, 0, 'feed');
    }
    if (bnavFeed) bnavFeed.style.display = '';
    if (tabFeed) tabFeed.classList.remove('hidden-tab');
    if (bnav) bnav.classList.add('nav-five-tabs');
  } else {
    var idx = TAB_ORDER.indexOf('feed');
    if (idx !== -1) {
      TAB_ORDER.splice(idx, 1);
    }
    if (bnavFeed) bnavFeed.style.display = 'none';
    if (tabFeed) tabFeed.classList.add('hidden-tab');
    if (bnav) bnav.classList.remove('nav-five-tabs');
  }
  
  if (track) {
    track.style.width = (TAB_ORDER.length * 100) + '%';
    var contents = track.querySelectorAll('.content:not(.hidden-tab)');
    var contentWidth = (100 / TAB_ORDER.length) + '%';
    contents.forEach(function(el) {
      el.style.width = contentWidth;
    });
  }
  setTimeout(updateNavIndicator, 50);
}

function formatMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

async function loadFeed(isSilent) {
  var list = document.getElementById('feed-list');
  if (list && !isSilent) {
    list.innerHTML = `
      <div class="skel-card"><div class="skeleton skel-line full"></div><div class="skeleton skel-line medium"></div><div class="skeleton skel-line short"></div></div>
      <div class="skel-card"><div class="skeleton skel-line full"></div><div class="skeleton skel-line medium"></div><div class="skeleton skel-line short"></div></div>
    `;
  }

  try {
    var athleteId = currentSession ? currentSession.athleteId : '';
    var res = await fetch(BACKEND + '/announcements?athlete_id=' + encodeURIComponent(athleteId) + '&_t=' + Date.now());
    var d = await res.json();
    if (d.success && Array.isArray(d.feed)) {
      var sortedNewFeed = d.feed;
      sortedNewFeed.sort(function(a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      });
      
      var changed = JSON.stringify(sortedNewFeed) !== JSON.stringify(_feedData);
      if (changed || !isSilent) {
        _feedData = sortedNewFeed;
        if (!isSilent) {
          _feedVisibleCount = 30;
        }
        if (list) {
          renderFeed();
        }
      }
      
      var lastViewedStr = safeGetItem('ag_last_viewed_announcements') || '';
      var lastViewedTime = lastViewedStr ? new Date(lastViewedStr).getTime() : 0;
      if (_currentTab === 'feed') {
        lastViewedTime = Date.now();
        safeSetItem('ag_last_viewed_announcements', new Date(lastViewedTime).toISOString());
      }
      var hasNew = _feedData.some(function(item) {
        var itemTime = item.created_at ? new Date(item.created_at).getTime() : 0;
        return itemTime > lastViewedTime;
      });
      var badgeEl = document.getElementById('feed-unread-badge');
      if (badgeEl) {
        badgeEl.style.display = hasNew ? 'block' : 'none';
      }
    } else {
      if (list && !isSilent) {
        list.innerHTML = '<div class="empty-state"><div class="icon">📢</div><p>No updates in the feed yet. Check back later!</p></div>';
      }
    }
  } catch(e) {
    console.warn('Failed to load feed:', e);
    if (list && !isSilent) {
      list.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Could not load feed.</p></div>';
    }
  }
}

function getMilestoneWeight(title) {
  var t = (title || '').toLowerCase();
  if (t.indexOf('gold medal') > -1) return 100;
  if (t.indexOf('silver medal') > -1) return 90;
  if (t.indexOf('bronze medal') > -1) return 80;
  if (t.indexOf('300 km club') > -1) return 70;
  if (t.indexOf('200 km club') > -1) return 60;
  if (t.indexOf('100 km club') > -1) return 50;
  if (t.indexOf('21-day') > -1) return 45;
  if (t.indexOf('14-day') > -1) return 40;
  if (t.indexOf('7-day') > -1) return 35;
  if (t.indexOf('half-marathon') > -1 || t.indexOf('21+ km') > -1) return 30;
  if (t.indexOf('super-distance') > -1 || t.indexOf('15+ km') > -1) return 25;
  if (t.indexOf('double-digit') > -1 || t.indexOf('10+ km') > -1) return 20;
  if (t.indexOf('21 km daily') > -1) return 15;
  if (t.indexOf('15 km daily') > -1) return 10;
  if (t.indexOf('10 km daily') > -1) return 5;
  return 1;
}

function renderFeedHighlights() {
  var container = document.getElementById('feed-highlights-row');
  if (!container) return;

  if (!LB_REG || !LB_REG.length || !LB_ACTS || !LB_ACTS.length) {
    container.style.display = 'none';
    return;
  }

  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  var scored = LB_REG.map(function(p) {
    var acts = actsByAthlete[p.strava_athlete_id] || [];
    var totalKm = acts.reduce(function(s,a){return s+(a.distance_meters||0)/1000;}, 0);
    var dayKm = {};
    acts.forEach(function(a){var d=getActDate(a);if(d)dayKm[d]=(dayKm[d]||0)+(a.distance_meters||0)/1000;});
    
    var days = Object.keys(dayKm).sort(), streak=0, cur=0, prev=null;
    days.forEach(function(d){if(prev){var diff=Math.round((new Date(d+'T12:00:00')-new Date(prev+'T12:00:00'))/86400000);cur=diff===1?cur+1:1;}else cur=1;streak=Math.max(streak,cur);prev=d;});
    
    return {
      id: String(p.strava_athlete_id),
      name: p.full_name || '—',
      totalKm: totalKm,
      streak: streak,
      actCount: acts.length,
      team: p.leaderboard_team || ''
    };
  }).filter(function(x){return x.totalKm > 0;});

  if (!scored.length) {
    container.style.display = 'none';
    return;
  }

  var topDist = scored.slice().sort(function(a,b){return b.totalKm - a.totalKm;})[0];
  var topStreak = scored.slice().sort(function(a,b){return b.streak - a.streak;})[0];
  var topCount = scored.slice().sort(function(a,b){return b.actCount - a.actCount;})[0];

  var teamDist = {};
  scored.forEach(function(x) {
    if (x.team) teamDist[x.team] = (teamDist[x.team] || 0) + x.totalKm;
  });
  var topTeamName = '';
  var topTeamKm = 0;
  Object.keys(teamDist).forEach(function(team) {
    if (teamDist[team] > topTeamKm) {
      topTeamKm = teamDist[team];
      topTeamName = team;
    }
  });

  _highlightsData = {
    champ: topDist ? {
      emoji: '🚶‍♂️',
      title: 'Distance Champion',
      subtitle: topDist.totalKm.toFixed(1) + ' km walked',
      body: topDist.name + ' is leading the walkathon leaderboard with an outstanding total distance of ' + topDist.totalKm.toFixed(1) + ' km! Keep pacing the way!',
      ringColor: '#FFD000'
    } : null,
    streak: topStreak && topStreak.streak > 0 ? {
      emoji: '🔥',
      title: 'Streak Master',
      subtitle: topStreak.streak + ' Days Active',
      body: topStreak.name + ' is on fire with a consecutive daily log streak of ' + topStreak.streak + ' days! Consistency wins!',
      ringColor: '#E8622A'
    } : null,
    active: topCount ? {
      emoji: '⚡',
      title: 'Most Active',
      subtitle: topCount.actCount + ' Activities',
      body: topCount.name + ' has logged the highest activity frequency with ' + topCount.actCount + ' verified workouts this month! Relentless drive!',
      ringColor: '#22C55E'
    } : null,
    team: topTeamName ? {
      emoji: '🏆',
      title: 'Top Team',
      subtitle: topTeamKm.toFixed(1) + ' km accumulated',
      body: topTeamName + ' is leading the team leaderboard with a total combined distance of ' + topTeamKm.toFixed(1) + ' km! Strength in numbers!',
      ringColor: '#A78BFA'
    } : null
  };

  container.innerHTML = '';
  container.style.display = 'flex';
  
  var cardsHtml = [];
  ['champ', 'streak', 'active', 'team'].forEach(function(key) {
    var data = _highlightsData[key];
    if (data) {
      cardsHtml.push(`
        <div class="highlight-card" onclick="openHighlightDetail('${key}')" style="border-top: 2.5px solid ${data.ringColor};">
          <div class="highlight-emoji">${data.emoji}</div>
          <div class="highlight-info">
            <div class="highlight-title">${esc(data.title)}</div>
            <div class="highlight-sub">${esc(data.subtitle)}</div>
          </div>
        </div>
      `);
    }
  });
  container.innerHTML = cardsHtml.join('');
}

function openHighlightDetail(key) {
  var data = _highlightsData[key];
  if (!data) return;
  var modal = document.getElementById('highlight-detail-modal');
  if (!modal) return;
  
  var emojiEl = document.getElementById('highlight-modal-emoji');
  var titleEl = document.getElementById('highlight-modal-title');
  var subEl = document.getElementById('highlight-modal-subtitle');
  var bodyEl = document.getElementById('highlight-modal-body');
  
  if (emojiEl) emojiEl.textContent = data.emoji;
  if (titleEl) titleEl.textContent = data.title;
  if (subEl) {
    subEl.textContent = data.subtitle;
    subEl.style.color = data.ringColor;
  }
  if (bodyEl) bodyEl.textContent = data.body;
  
  modal.style.display = 'flex';
  var card = modal.querySelector('.modal-card');
  if (card) {
    card.style.transform = 'scale(0.9)';
    setTimeout(function() {
      card.style.transform = 'scale(1)';
    }, 10);
  }
}

function triggerHighlightCheer() {
  triggerConfettiBurst();
  var modal = document.getElementById('highlight-detail-modal');
  if (modal) modal.style.display = 'none';
}

function triggerConfettiBurst() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.85 } });
  }
}

function renderFeed() {
  var list = document.getElementById('feed-list');
  if (!list) return;

  // Clean up existing feed map instances to prevent severe memory leak
  if (window._feedMaps && window._feedMaps.length > 0) {
    window._feedMaps.forEach(function(m) {
      try { m.remove(); } catch(e) {}
    });
  }
  window._feedMaps = [];

  renderFeedHighlights();
  renderCommunityPulse();
  if (!_feedData.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📢</div><p>No updates in the feed yet. Check back later!</p></div>';
    return;
  }

  var filteredFeed = [];
  var milestoneGroups = {};

  _feedData.forEach(function(item) {
    if (item.type === 'milestone') {
      var athleteId = item.tagged_athlete_id || 'unknown';
      var dateStr = getISTDate(item.created_at);
      var key = athleteId + '_' + dateStr;
      var w = getMilestoneWeight(item.title);
      
      if (!milestoneGroups[key]) {
        milestoneGroups[key] = { item: item, weight: w };
      } else {
        if (w > milestoneGroups[key].weight) {
          milestoneGroups[key] = { item: item, weight: w };
        }
      }
    } else {
      filteredFeed.push(item);
    }
  });

  Object.keys(milestoneGroups).forEach(function(key) {
    filteredFeed.push(milestoneGroups[key].item);
  });

  filteredFeed.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });

  var visibleItems = filteredFeed.slice(0, _feedVisibleCount);
  var html = '';

  var myId = currentSession ? String(currentSession.athleteId) : '';

  visibleItems.forEach(function(item) {
    var dateLabel = timeAgo(item.created_at);
    var initials = '';
    var athleteName = 'Participant';

    if (item.type === 'activity') {
      var act = {};
      try { act = JSON.parse(item.body); } catch(e) {}
      athleteName = act.athlete_name || 'Participant';
      initials = (function(){var parts=(athleteName||'').trim().split(/\s+/);if(parts.length>=2)return(parts[0][0]+(parts[parts.length-1][0])).toUpperCase();return(parts[0]||'?')[0].toUpperCase();})();
      
      var timeStr = '';
      var dateTimeStr = '';
      try {
        var adt = new Date(act.activity_date || item.created_at);
        if (!isNaN(adt.getTime())) {
          timeStr = adt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          dateTimeStr = adt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        }
      } catch(e) {}

      var distKm = ((act.distance_meters || 0) / 1000).toFixed(2);
      var durationMins = Math.round((act.moving_time_seconds || 0) / 60);
      var paceStr = '—';
      if (act.distance_meters > 0 && act.moving_time_seconds > 0) {
        paceStr = fmtPS(act.moving_time_seconds / (act.distance_meters / 1000), act.sport_type);
      }
      var steps = Math.round((act.distance_meters / 1000) * 1350);
      var calculatedStepsDisplay = steps.toLocaleString('en-IN');
      if (act.steps && act.steps > 0) {
        calculatedStepsDisplay = act.steps.toLocaleString('en-IN') + ' (Strava)';
      }

      var deviceText = act.device_name ? ' via ' + act.device_name : '';
      var sportIcon = act.sport_type ? renderIcon(act.sport_type) : '🌱';
      
      var descriptionHtml = '';
      if (act.description) {
        descriptionHtml = `<div class="feed-card-activity-desc">${esc(act.description)}</div>`;
      }

      var mapHtml = '';
      if (act.summary_polyline) {
        var mapContainerId = 'map-' + item.id;
        mapHtml = `
          <div class="feed-card-map-wrap" onclick="event.stopPropagation();" style="position: relative; margin: 12px 0 16px 0; height: 160px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden; background: #0E1012;">
            <div id="${mapContainerId}" style="width: 100%; height: 100%;"></div>
          </div>
        `;
      }

      // Appreciations
      var appreciationHtml = '';
      var elevGain = parseFloat(act.elevation_gain || 0);
      var isSpecialApp = false;
      if (act.sport_type === 'Walk' || act.sport_type === 'Run' || act.sport_type === 'VirtualRun' || act.sport_type === 'Hike') {
        var paceVal = (act.moving_time_seconds / 60) / (act.distance_meters / 1000);
        var customApps = [
          { cond: function() { return act.sport_type === 'Run' && paceVal < 5.0; }, emoji: '⚡', text: 'Lightning speed! Incredible run pace!' },
          { cond: function() { return act.distance_meters >= 21100; }, emoji: '🏅', text: 'Half marathon distance! Pure legend status!' },
          { cond: function() { return act.distance_meters >= 15000; }, emoji: '🔥', text: 'Super distance! Absolutely crushing it!' },
          { cond: function() { return act.distance_meters >= 10000; }, emoji: '🌟', text: 'Double digits! Outstanding distance effort!' },
          { cond: function() { return act.sport_type === 'Walk' && paceVal < 8.5; }, emoji: '🚶‍♂️💨', text: 'Power walking champion! Brisk pace!' }
        ];

        for (var cIdx = 0; cIdx < customApps.length; cIdx++) {
          if (customApps[cIdx].cond()) {
            appreciationHtml = `<div class="activity-appreciation-badge special"><span class="appreciation-icon">${customApps[cIdx].emoji}</span><span class="appreciation-text">${customApps[cIdx].text}</span></div>`;
            isSpecialApp = true;
            break;
          }
        }
      }

      if (!isSpecialApp && act.distance_meters > 0) {
        var actIdStr = String(act.strava_activity_id || act.activity_id || act.activity_date_time_ist || 'act');
        var appSeed = athleteName + '_' + (act.distance_meters/1000).toFixed(2) + '_' + actIdStr;
        var appIcon = '🌱';
        var appPool = ["Wonderful active minutes! Keep this beautiful rhythm going.", "Every single step counts! Great job staying active today."];
        var appHash = 0;
        for (var i = 0; i < appSeed.length; i++) {
          appHash = appSeed.charCodeAt(i) + ((appHash << 5) - appHash);
        }
        var appIndex = Math.abs(appHash) % appPool.length;
        appreciationHtml = `<div class="activity-appreciation-badge"><span class="appreciation-icon">${appIcon}</span><span class="appreciation-text">"${appPool[appIndex]}"</span></div>`;
      }

      var reactionButtonsHtml = '';
      var emojis = [{type: 'like', char: '👏'}, {type: 'fire', char: '🔥'}, {type: 'heart', char: '❤️'}];
      
      emojis.forEach(function(emo) {
        var count = (item.reaction_counts && item.reaction_counts[emo.type]) || 0;
        var activeClass = (item.my_reactions && item.my_reactions.indexOf(emo.type) > -1) ? 'active' : '';
        reactionButtonsHtml += `
          <button class="feed-react-btn ${activeClass}" onclick="reactToAnnouncement('${item.id}', '${emo.type}', event)">
            <span class="emoji">${emo.char}</span>
            <span class="count">${count}</span>
          </button>
        `;
      });

      var timeHour = new Date(act.activity_date || item.created_at).getHours();
      var timeClass = (timeHour >= 5 && timeHour < 12) ? 'time-morning' : (timeHour >= 12 && timeHour < 17) ? 'time-afternoon' : (timeHour >= 17 && timeHour < 20) ? 'time-evening' : 'time-night';

      var targetAthleteId = item.tagged_athlete_id || act.athlete_id || '';
      html += `
        <div class="feed-card type-activity ${timeClass}">
          <div class="feed-card-header">
            <div class="feed-card-avatar" style="${getAvatarStyle(athleteName)};">${initials}</div>
            <div class="feed-card-meta">
              <div class="feed-card-athlete-name">${esc(athleteName)}</div>
              <div class="feed-card-time">${timeStr}${dateTimeStr ? ' &middot; ' + dateTimeStr : ''}${deviceText}</div>
            </div>
          </div>
          <div class="feed-card-activity-info">
            <div class="feed-card-activity-title-row">
              <span class="sport-icon">${sportIcon}</span>
              <span class="activity-title" onclick="openActivityDetail('${act.activity_id || act.strava_activity_id}', event, true); event.stopPropagation();" style="cursor: pointer;">${esc(act.activity_name || 'Activity')}</span>
            </div>
            ${descriptionHtml}
            ${appreciationHtml}
            ${mapHtml}
            ${(function() {
              var statsCols = [];
              statsCols.push(`
                <div class="stat-item">
                  <span class="stat-label">Distance</span>
                  <span class="stat-val">${distKm}</span>
                  <span class="stat-unit">km</span>
                </div>
              `);
              statsCols.push(`
                <div class="stat-item">
                  <span class="stat-label">Pace</span>
                  <span class="stat-val">${paceStr}</span>
                </div>
              `);
              statsCols.push(`
                <div class="stat-item">
                  <span class="stat-label">Steps</span>
                  <span class="stat-val">${calculatedStepsDisplay}</span>
                </div>
              `);
              if (elevGain > 0) {
                statsCols.push(`
                  <div class="stat-item">
                    <span class="stat-label">Elev Gain</span>
                    <span class="stat-val">${Math.round(elevGain)}</span>
                    <span class="stat-unit">meters</span>
                  </div>
                `);
              }
              var gridStyle = 'grid-template-columns: repeat(' + statsCols.length + ', 1fr);';
              return '<div class="feed-card-stats-grid" style="' + gridStyle + '">' + statsCols.join('') + '</div>';
            })()}
          </div>
          <div class="feed-card-actions" onclick="event.stopPropagation();">
            ${reactionButtonsHtml}
          </div>
        </div>
      `;
    } else {
      var iconHtml = '';
      if (item.type === 'milestone') {
        var titleLower = (item.title || '').toLowerCase();
        var medalColor = '#FFD000';
        if (titleLower.indexOf('silver') > -1) medalColor = '#C8D8E8';
        else if (titleLower.indexOf('bronze') > -1) medalColor = '#F4A84A';
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${medalColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px ${medalColor}40);"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`;
      } else if (item.type === 'achievement') {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px rgba(232, 98, 42, 0.25));"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"/><path d="M12 2a6 6 0 0 1 6 6v3.5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z"/></svg>`;
      } else if (item.type === 'birthday') {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EC4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px rgba(236, 72, 153, 0.25));"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
      } else {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px rgba(167, 139, 250, 0.25));"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
      }

      var bodyHtml = '';
      if (item.body) {
        bodyHtml = `<div class="feed-card-body">${formatMarkdown(item.body)}</div>`;
      }

      var reactionButtonsHtml = '';
      var emojis = [{type: 'like', char: '👏'}, {type: 'fire', char: '🔥'}, {type: 'heart', char: '❤️'}];
      
      emojis.forEach(function(emo) {
        var count = (item.reaction_counts && item.reaction_counts[emo.type]) || 0;
        var activeClass = (item.my_reactions && item.my_reactions.indexOf(emo.type) > -1) ? 'active' : '';
        reactionButtonsHtml += `
          <button class="feed-react-btn ${activeClass}" onclick="reactToAnnouncement('${item.id}', '${emo.type}', event)">
            <span class="emoji">${emo.char}</span>
            <span class="count">${count}</span>
          </button>
        `;
      });

      html += `
        <div class="feed-card type-${item.type}">
          <div class="feed-card-header">
            <div class="feed-card-icon">${iconHtml}</div>
            <div class="feed-card-meta">
              <div class="feed-card-title">${esc(item.title)}</div>
              <div class="feed-card-time">${dateLabel}</div>
            </div>
          </div>
          ${bodyHtml}
          <div class="feed-card-actions" onclick="event.stopPropagation();">
            ${reactionButtonsHtml}
          </div>
        </div>
      `;
    }
  });

  if (filteredFeed.length > _feedVisibleCount) {
    html += `
      <div style="text-align:center; padding:8px 0 20px 0;">
        <button class="show-more-btn" onclick="showMoreAnnouncements()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:20px; color:#fff; font-size:12px; font-weight:700; padding:8px 18px; cursor:pointer; font-family:var(--font); letter-spacing:0.3px; transition:all 0.15s ease;">Show More</button>
      </div>
    `;
  }
  list.innerHTML = html;

  visibleItems.forEach(function(item) {
    if (item.type === 'activity' && item.summary_polyline) {
      var mapContainerId = 'map-' + item.id;
      var mapEl = document.getElementById(mapContainerId);
      if (mapEl) {
        try {
          var act = JSON.parse(item.body);
          var coordinates = decodePolyline(act.summary_polyline);
          if (coordinates && coordinates.length > 0) {
            var map = L.map(mapContainerId, {
              zoomControl: false,
              dragging: false,
              touchZoom: false,
              scrollWheelZoom: false,
              doubleClickZoom: false,
              boxZoom: false,
              keyboard: false,
              attributionControl: false
            }).setView(coordinates[0], 14);
            window._feedMaps.push(map);

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
              maxZoom: 20
            }).addTo(map);

            var poly = L.polyline(coordinates, {
              color: 'var(--brand)',
              weight: 3.5,
              opacity: 0.85,
              lineJoin: 'round'
            }).addTo(map);

            map.fitBounds(poly.getBounds(), {
              padding: [12, 12]
            });
          }
        } catch (mapErr) {
          console.warn('Failed to initialize map for card ' + mapContainerId + ':', mapErr);
        }
      }
    }
  });
}

function showMoreAnnouncements() {
  _feedVisibleCount += 30;
  renderFeed();
}

function getEmojiCharForType(type) {
  var map = { 'like': '👏', 'fire': '🔥', 'heart': '❤️' };
  return map[type] || '👏';
}

async function reactToAnnouncement(announcementId, reactionType, event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  var athleteId = currentSession ? currentSession.athleteId : '';
  if (!athleteId) return;

  var item = _feedData.find(function(x) { return String(x.id) === String(announcementId); });
  if (item) {
    var idx = item.my_reactions.indexOf(reactionType);
    if (idx > -1) {
      item.my_reactions.splice(idx, 1);
      if (item.reaction_counts[reactionType] > 0) item.reaction_counts[reactionType]--;
    } else {
      var clickX = 0, clickY = 0;
      if (event) {
        if (event.clientX && event.clientY) {
          clickX = event.clientX;
          clickY = event.clientY;
        } else {
          var target = event.currentTarget || event.target;
          if (target && typeof target.getBoundingClientRect === 'function') {
            var rect = target.getBoundingClientRect();
            clickX = rect.left + rect.width / 2;
            clickY = rect.top + rect.height / 2;
          }
        }
      }
      if (clickX && clickY) {
        triggerConfettiBurst(clickX, clickY, getEmojiCharForType(reactionType));
      }
      item.my_reactions.push(reactionType);
      if (!item.reaction_counts) item.reaction_counts = {};
      item.reaction_counts[reactionType] = (item.reaction_counts[reactionType] || 0) + 1;
    }
    renderFeed();
  }

  try {
    var res = await fetch(BACKEND + '/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        announcement_id: announcementId,
        athlete_id: athleteId,
        reaction_type: reactionType
      })
    });
    var d = await res.json();
    if (!d.success) {
      console.warn('React API unsuccessful:', d.error);
    }
  } catch(err) {
    console.warn('React API error:', err);
  }
}

function triggerConfettiBurst(x, y, emoji) {
  if (typeof confetti === 'function') {
    var scalar = 2.5;
    var shapes = [confetti.path({
      matrix: [scalar, 0, 0, scalar, -15 * scalar, -15 * scalar],
      path: 'M 10 10 L 20 10 L 20 20 L 10 20 Z'
    })];
    
    var options = {
      particleCount: 20,
      spread: 40,
      origin: { x: x / window.innerWidth, y: y / window.innerHeight },
      colors: ['#E8622A', '#FC6100', '#FFD000'],
      ticks: 120
    };
    
    if (emoji) {
      options.flat = true;
      options.shapes = [confetti.shapeFromString(emoji)];
      options.scalar = 1.6;
      options.particleCount = 12;
    }
    confetti(options);
  }
}

// ── In-App Notifications Banner Logic ──────────────────────────────
var _activeInsight = null;
var _activeRecovery = null;

function renderInAppNotificationBanner(title, body, onClick, key, onClose) {
  var onDismissStr = onClose ? 'onClose()' : 'dismissInAppBanner(event)';
  return `
    <div class="banner-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
    <div class="banner-content" onclick="${onClick}">
      <div class="banner-title">${esc(title)}</div>
      <div class="banner-body">${esc(body)}</div>
    </div>
    <button class="banner-dismiss-btn" onclick="${onDismissStr}" title="Dismiss">✕</button>
  `;
}

function dismissInAppBanner(e) {
  if (e) e.stopPropagation();
  var banner = document.getElementById('in-app-notification-banner');
  if (!banner) return;
  var key = banner.getAttribute('data-banner-key');
  if (key) {
    var dismissed = JSON.parse(safeGetItem('ag_dismissed_banners') || '{}');
    dismissed[key] = true;
    safeSetItem('ag_dismissed_banners', JSON.stringify(dismissed));
  }
  banner.style.display = 'none';
}

function updateInAppNotificationBanner() {
  var banner = document.getElementById('in-app-notification-banner');
  if (!banner) return;

  var dismissed = JSON.parse(safeGetItem('ag_dismissed_banners') || '{}');

  // Priority 1: Strava Connect Prompt
  if (window.isStravaConnected === false) {
    var scKey = 'strava_connect_prompt';
    if (!dismissed[scKey]) {
      var html = '<div class="banner-card type-warning" style="cursor: pointer; border-left: 4px solid #FC6100;" onclick="window.handleStravaConnect(event)">' +
        '<button class="banner-dismiss-btn" onclick="dismissInAppBanner(event)" title="Dismiss">✕</button>' +
        '<div class="banner-icon" style="color:#FC6100;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
        '<div class="banner-content">' +
        '<div class="banner-title" style="color:#fff;">Strava Account Disconnected</div>' +
        '<div class="banner-body" style="font-size:12px; color:rgba(255,255,255,0.75); margin-top:4px; line-height:1.4;">Your account is not connected yet. Click here to link Strava and sync your walks/runs automatically.</div>' +
        '</div>' +
        '</div>';
      banner.setAttribute('data-banner-key', scKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  // Priority 2: Recovery insights
  if (_activeRecovery) {
    var recKey = _activeRecovery.key;
    if (!dismissed[recKey]) {
      var html = renderInAppNotificationBanner(
        _activeRecovery.title,
        _activeRecovery.sub,
        'showTab(\'you\')', recKey, null
      );
      banner.setAttribute('data-banner-key', recKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  // Priority 3: Daily Milestones or Medal insights
  if (_activeInsight) {
    var iKey = _activeInsight.key;
    if (!dismissed[iKey]) {
      var html = renderInAppNotificationBanner(
        _activeInsight.title,
        _activeInsight.body,
        null, iKey, null
      );
      banner.setAttribute('data-banner-key', iKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  banner.style.display = 'none';
  banner.innerHTML = '';
  banner.removeAttribute('data-banner-key');
}

function timeAgo(dateString) {
  try {
    var now = new Date();
    var past = new Date(dateString);
    var diffMs = now - past;
    var diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    var diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    var diffDays = Math.floor(diffHrs / 24);
    if (diffDays === 1) return 'Yesterday';
    return diffDays + 'd ago';
  } catch(e) {
    return '';
  }
}

function renderNotifications() {
  var badge = document.getElementById('notification-badge');
  var list = document.getElementById('notif-list');
  var empty = document.getElementById('notif-empty');
  
  if (!list || !empty) return;

  var unreadCount = _notificationsList.filter(function(n) { return !n.is_read; }).length;
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!_notificationsList.length) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';
  list.innerHTML = '';

  _notificationsList.forEach(function(n) {
    var card = document.createElement('div');
    card.className = 'notif-item' + (n.is_read ? ' read' : '');
    
    var icon = '📢';
    if (n.type === 'challenge') icon = '🎯';
    if (n.type === 'medal') icon = '🏆';
    if (n.type === 'kudos') icon = '👏';
    if (n.type === 'comment') icon = '💬';

    var clickHandler = '';
    if (n.url === 'connect_strava') {
      clickHandler = 'window.handleStravaConnect(event);';
    } else if (n.url) {
      clickHandler = 'if(\'' + n.url + '\' && \'' + n.url + '\' !== \'null\') { window.location.href=\'' + n.url + '\'; }';
    }

    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer;" onclick="${clickHandler}">
        <div style="font-size: 20px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.04); border-radius: 50%;">${icon}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13.5px; font-weight: 700; color: #fff; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(n.title)}</div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.4;">${esc(n.body)}</div>
          <div style="font-size: 10px; color: var(--brand); font-weight: 700; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px;">${timeAgo(n.created_at)}</div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function clearPWACache() {
  if (confirm('Clear offline app cache and refresh portal?')) {
    if (currentSession && currentSession.athleteId) {
      cacheClear(currentSession.athleteId);
    }
    if ('serviceWorker' in navigator) {
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(name) { return caches.delete(name); }));
      }).then(function() {
        window.location.reload(true);
      });
    } else {
      window.location.reload(true);
    }
  }
}

// ── Service Worker & Push Notifications ──────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/agwalk/sw.js')
      .then(function(reg) { 
        console.log('[SW] Registered:', reg.scope); 
        setTimeout(checkPushSubscriptionState, 1000);
      })
      .catch(function(err) { console.log('[SW] Registration failed:', err); });
  });
}

var VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa40HI80NM9e9oFJAbHMQRXKCh_hXmEF7fPbQpxQZMSaFRbMzDqSmjLR2E8ypc';

function urlBase64ToUint8Array(base64String) {
  var cleanStr = base64String.trim();
  var padding = '='.repeat((4 - cleanStr.length % 4) % 4);
  var base64 = (cleanStr + padding).replace(/\-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function checkPushSubscriptionState() {
  window.checkPushSubscriptionState = checkPushSubscriptionState;
  var card = document.getElementById('push-notifications-card');
  var desc = document.getElementById('push-status-desc');
  var btn = document.getElementById('btn-enable-push');
  
  if (!card || !desc || !btn) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    card.style.display = 'none';
    return;
  }

  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    
    if (Notification.permission === 'denied') {
      desc.innerHTML = '<span style="color:#ef4444;">❌ Notifications blocked.</span> Please enable notifications in your browser settings to receive alerts.';
      btn.textContent = 'Blocked in Settings';
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = 'var(--muted)';
      btn.style.pointerEvents = 'none';
      btn.style.boxShadow = 'none';
      return;
    }

    if (sub) {
      desc.innerHTML = '<span style="color:#10b981;">✓ Push notifications active.</span> You will receive real-time updates when peers react, achievements unlock, and challenges start.';
      btn.textContent = 'Mute Notifications';
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = 'var(--muted)';
      btn.style.boxShadow = 'none';
      btn.onclick = disablePushNotifications;
    } else {
      desc.innerHTML = 'Stay updated. Enable push notifications to receive real-time alerts when medals unlock, challenges trigger, and comments/reactions land.';
      btn.textContent = 'Enable Push Notifications';
      btn.style.background = 'linear-gradient(135deg, #FC6100 0%, #E8622A 100%)';
      btn.style.color = '#fff';
      btn.style.pointerEvents = 'auto';
      btn.style.boxShadow = '0 4px 12px rgba(232,98,42,0.3)';
      btn.onclick = enablePushNotifications;
    }
  } catch (err) {
    console.warn('Failed checking push subscription state:', err);
  }
}

async function enablePushNotifications() {
  var btn = document.getElementById('btn-enable-push');
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
    btn.textContent = 'Enabling...';
  }

  try {
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission denied');
    }

    var reg = await navigator.serviceWorker.ready;
    var convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    
    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey
    });

    var athleteId = currentSession ? currentSession.athleteId : '';
    if (!athleteId) {
      throw new Error('Active session not found. Please log in again.');
    }

    var res = await fetch(BACKEND + '/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        subscription: sub
      })
    });
    var d = await res.json();
    if (d.success) {
      console.log('Successfully subscribed to Push Notifications.');
    } else {
      throw new Error(d.error || 'Subscription backend sync failed');
    }
  } catch (err) {
    console.warn('Failed to subscribe:', err);
    alert('❌ Push activation failed: ' + err.message);
  } finally {
    if (btn) btn.style.opacity = '1';
    checkPushSubscriptionState();
  }
}

async function disablePushNotifications() {
  var btn = document.getElementById('btn-enable-push');
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
    btn.textContent = 'Muting...';
  }

  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) {
      var athleteId = currentSession ? currentSession.athleteId : '';
      if (athleteId) {
        await fetch(BACKEND + '/push-unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athlete_id: athleteId,
            endpoint: sub.endpoint
          })
        });
      }
      await sub.unsubscribe();
      console.log('Successfully unsubscribed from Push.');
    }
  } catch (err) {
    console.warn('Failed to unsubscribe:', err);
  } finally {
    if (btn) btn.style.opacity = '1';
    checkPushSubscriptionState();
  }
}

function openStravaProfile(){
  try {
    var s = currentSession || JSON.parse(safeGetItem('wk_user')||'{}');
    var athleteId = s.athleteId;
    var reg = LB_ME || {};
    var url = reg.strava_profile_url || (athleteId ? 'https://www.strava.com/athletes/' + athleteId : 'https://www.strava.com');
    window.open(url, '_blank');
  } catch(e) {
    window.open('https://www.strava.com', '_blank');
  }
}

function toggleNotificationDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('notification-dropdown');
  if (!dd) return;
  var isVisible = dd.style.display === 'block';
  dd.style.display = isVisible ? 'none' : 'block';
}

function clearNotifications(e) {
  if (e) e.stopPropagation();
  var badge = document.getElementById('notification-badge');
  if (badge) badge.style.display = 'none';
  var list = document.getElementById('notif-list');
  if (list) list.style.display = 'none';
  var empty = document.getElementById('notif-empty');
  if (empty) empty.style.display = 'block';
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('notification-dropdown');
  var btn = document.getElementById('notification-btn');
  if (dd && dd.style.display === 'block') {
    if (!dd.contains(e.target) && !btn.contains(e.target)) {
      dd.style.display = 'none';
    }
  }
});

// Today's Date in Header
(function(){
  try{
    var d = new Date();
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var monthName = months[d.getMonth()];
    var day = d.getDate();
    var year = d.getFullYear();
    var formattedDate = monthName + ', ' + day + ', ' + year;
    var dateEl = document.getElementById('hdr-today-date');
    if(dateEl) dateEl.textContent = formattedDate;
  }catch(e){}
})();

// Boot Main Application
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', function() {
    load().finally(function(){ hideSplash(); });
  });
} else {
  load().finally(function(){ hideSplash(); });
}
