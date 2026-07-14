// Profile and Activity Details Modal Drawers

var _activeProfileStats = null;

function fmtEffortTime(s) {
  var min = Math.floor(s / 60);
  var sec = Math.round(s % 60);
  if (min > 0) {
    return min + ':' + (sec < 10 ? '0' : '') + sec;
  }
  return sec + 's';
}

var _activeStatsTimeframe = 'recent';
var _activeDetailMap = null;
var _detailMapTimeout = null;

function decodePolyline(str, precision) {
  var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision || 5);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change;
    shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function openActivityDetail(id, event, isStravaId) {
  console.log('openActivityDetail called with id:', id, 'isStravaId:', isStravaId);
  if (!id || String(id) === 'undefined' || String(id) === 'null' || String(id).trim() === '') {
    console.warn('Invalid id passed to openActivityDetail:', id);
    return;
  }
  try {
    window._currentStravaActivityId = id;
    if (event && event.target && (event.target.closest('button') || event.target.closest('.feed-react-btn'))) {
      return;
    }
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();

    // Reset fields to loading placeholders
    document.getElementById('detail-top-date').innerText = 'Loading...';
    document.getElementById('detail-title').innerText = 'Loading...';
    document.getElementById('detail-started-info').innerText = '';
    // Show all wrap divs first so they appear during load, then hide if no data
    ['det-dist-wrap','det-pace-wrap','det-movetime-wrap','det-elapsed-wrap',
     'det-hr-wrap','det-maxhr-wrap','det-cadence-wrap','det-stravasteps-wrap',
     'det-calcsteps-wrap','det-elevation-wrap','det-calories-wrap','det-device-wrap'
    ].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = ''; }
    });
    ['det-dist','det-pace','det-movetime','det-elapsed','det-avghr','det-maxhr',
     'det-cadence','det-stravasteps','det-calcsteps','det-elevation','det-device','det-calories'
    ].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerText = '—';
    });
    document.getElementById('detail-desc-box').style.display = 'none';
    document.getElementById('detail-hero-card').style.display = 'none';
    document.getElementById('detail-milestone-card').style.display = 'none';
    document.getElementById('detail-keystats-section').style.display = 'none';
    document.getElementById('detail-chart-card').style.display = 'none';
    document.getElementById('detail-appreciation-box').innerHTML = '';
    
    // Hide best efforts and photos on load
    document.getElementById('detail-best-efforts-section').style.display = 'none';
    document.getElementById('detail-best-efforts-container').innerHTML = '';
    document.getElementById('detail-photos-section').style.display = 'none';
    document.getElementById('detail-photos-container').innerHTML = '';

    var modal = document.getElementById('activity-detail-modal');
    modal.style.display = 'block';
    setTimeout(function() {
      modal.classList.add('open');
    }, 10);

    function populateFromActivity(act, createdAtStr) {
      var athleteName = act.athlete_name || 'Participant';
      var sportType = act.sport_type || 'Walk';

      var topDateStr = 'Activity';
      try {
        var dt = new Date(createdAtStr || act.activity_date);
        if (!isNaN(dt.getTime())) {
          topDateStr = dt.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
        }
      } catch (e) {}
      document.getElementById('detail-top-date').innerText = topDateStr;

      var actName = act.activity_name || (sportType + ' Activity');
      var sportIcon = renderIcon(sportType);
      document.getElementById('detail-title').innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="display:inline-flex; align-items:center; color:var(--brand);">${sportIcon}</span>
          <span style="font-weight:900; color:#fff;">${esc(actName)}</span>
        </div>
      `;

      var startedStr = '';
      try {
        var localDt = new Date(act.activity_date);
        if (!isNaN(localDt.getTime())) {
          var timeStr = localDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          var dateStr = localDt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          startedStr = esc(athleteName) + ' - Started at ' + timeStr + ' on ' + dateStr;
        }
      } catch (e) {}
      document.getElementById('detail-started-info').innerText = startedStr;

      // Helper: show/hide a field wrapper
      function setField(wrapId, valId, value) {
        var wrap = document.getElementById(wrapId);
        var el = document.getElementById(valId);
        var hasValue = value !== null && value !== undefined && value !== '' && value !== '—';
        if (wrap) wrap.style.display = hasValue ? '' : 'none';
        if (el && hasValue) el.innerText = value;
      }

      window._shareActivityData = act;
      var distanceKmVal = (act.distance_meters || 0) / 1000;
      // Distance — always show if > 0
      setField('det-dist-wrap', 'det-dist', distanceKmVal > 0 ? distanceKmVal.toFixed(2) + ' km' : null);

      var movingSec = act.moving_time_seconds || 0;
      var elapsedSec = act.elapsed_time_seconds || 0;

      // Moving time — show if > 0
      setField('det-movetime-wrap', 'det-movetime', movingSec > 0 ? fmtDur(movingSec) : null);

      // Elapsed time — always show if elapsedSec > 0
      setField('det-elapsed-wrap', 'det-elapsed', elapsedSec > 0 ? fmtDur(elapsedSec) : null);

      // Pace — show if calculable
      var paceValStr = null;
      var isRide = sportType === 'Ride' || sportType === 'MountainBikeRide' || sportType === 'VirtualRide';
      if (distanceKmVal > 0 && movingSec > 0) {
        if (isRide) {
          paceValStr = (act.avg_speed ? (act.avg_speed * 3.6).toFixed(1) : ((distanceKmVal * 1000 / movingSec) * 3.6).toFixed(1)) + ' km/h';
        } else {
          paceValStr = fmtPS((distanceKmVal * 1000) / movingSec, sportType);
        }
      }
      var paceLabel = document.querySelector('#det-pace-wrap .detail-field-label');
      if (paceLabel) paceLabel.innerText = isRide ? 'Speed' : 'Pace';
      setField('det-pace-wrap', 'det-pace', paceValStr);

      // Calculated steps — always show if distance > 0 (unless it's a ride)
      var calculatedSteps = Math.round(distanceKmVal * 1350);
      setField('det-calcsteps-wrap', 'det-calcsteps', (!isRide && distanceKmVal > 0) ? calculatedSteps.toLocaleString('en-IN') + ' steps' : null);

      // Strava steps — only if > 0 (unless it's a ride)
      var stravaStepsVal = act.steps || null;
      setField('det-stravasteps-wrap', 'det-stravasteps', (!isRide && stravaStepsVal && stravaStepsVal > 0) ? stravaStepsVal.toLocaleString('en-IN') + ' steps' : null);

      // Elevation — show as 0 m if not set or 0
      var elevVal = act.elevation_gain || 0;
      setField('det-elevation-wrap', 'det-elevation', (elevVal !== null && elevVal !== undefined) ? Math.round(elevVal) + ' m' : '0 m');

      // Device — only if explicitly set in DB (not fallback)
      setField('det-device-wrap', 'det-device', act.device_name || null);

      // Heart rate — only if avg HR exists
      var avgHrVal = act.average_heartrate || null;
      var maxHrVal = act.max_heartrate || null;
      setField('det-hr-wrap', 'det-avghr', avgHrVal ? Math.round(avgHrVal) + ' bpm' : null);
      setField('det-maxhr-wrap', 'det-maxhr', maxHrVal ? Math.round(maxHrVal) + ' bpm' : null);

      // Cadence — only if exists
      var cadenceVal = act.average_cadence || null;
      setField('det-cadence-wrap', 'det-cadence', cadenceVal ? Math.round(cadenceVal * 2) + ' spm' : null);

      // Calories — only if exists
      var caloriesVal = act.calories || null;
      setField('det-calories-wrap', 'det-calories', caloriesVal ? Math.round(caloriesVal) + ' kcal' : null);

      var descBox = document.getElementById('detail-desc-box');
      if (act.description) {
        document.getElementById('detail-desc-content').innerText = act.description;
        descBox.style.display = 'block';
      } else {
        descBox.style.display = 'none';
      }

      // Hero distance card + trend vs this athlete's own average
      var heroCard = document.getElementById('detail-hero-card');
      var heroTrend = document.getElementById('detail-hero-trend');
      if (distanceKmVal > 0) {
        document.getElementById('detail-hero-dist').innerHTML = distanceKmVal.toFixed(2) + '<span style="font-size:14px;color:rgba(255,255,255,0.5);"> km</span>';
        heroCard.style.display = 'flex';
        try {
          var athId = act.strava_athlete_id;
          var myOtherActs = (Array.isArray(LB_ACTS) ? LB_ACTS : []).filter(function(a){
            return String(a.strava_athlete_id) === String(athId) && String(a.id) !== String(act.id) && !a.is_deleted && !a.is_flagged;
          });
          if (myOtherActs.length >= 2) {
            var avgKm = myOtherActs.reduce(function(s,a){ return s + (parseFloat(a.distance_meters)||0)/1000; }, 0) / myOtherActs.length;
            if (avgKm > 0) {
              var pct = Math.round(((distanceKmVal - avgKm) / avgKm) * 100);
              heroTrend.className = 'detail-trend-pill ' + (pct >= 0 ? 'up' : 'down');
              var arrow = pct >= 0
                ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
                : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
              heroTrend.innerHTML = arrow + '<span>' + Math.abs(pct) + '% vs avg</span>';
              heroTrend.style.display = 'flex';
            } else { heroTrend.style.display = 'none'; }
          } else { heroTrend.style.display = 'none'; }
        } catch(e) { heroTrend.style.display = 'none'; }
      } else {
        heroCard.style.display = 'none';
      }

      // Milestone card — next distance-club threshold for this athlete
      var msCard = document.getElementById('detail-milestone-card');
      try {
        var athId2 = act.strava_athlete_id;
        var allMine = (Array.isArray(LB_ACTS) ? LB_ACTS : []).filter(function(a){
          return String(a.strava_athlete_id) === String(athId2) && !a.is_deleted && !a.is_flagged;
        });
        var totalKm = allMine.reduce(function(s,a){ return s + (parseFloat(a.distance_meters)||0)/1000; }, 0);
        var clubThresholds = [50,100,150,200,250,300,350,400,450,500];
        var nextClub = clubThresholds.find(function(t){ return t > totalKm; });
        if (nextClub) {
          var prevClub = clubThresholds[clubThresholds.indexOf(nextClub) - 1] || 0;
          var span = nextClub - prevClub;
          var progressed = totalKm - prevClub;
          var pctDone = Math.max(0, Math.min(1, progressed / span));
          var remainingKm = Math.max(0, nextClub - totalKm);
          document.getElementById('detail-milestone-title').innerText = Math.round(totalKm) + ' / ' + nextClub + ' km';
          document.getElementById('detail-milestone-sub').innerText = remainingKm.toFixed(1) + ' km to your next distance club';
          var arcEl = document.getElementById('detail-milestone-arc');
          var circumference = 2 * Math.PI * 10;
          arcEl.setAttribute('stroke-dasharray', (pctDone * circumference).toFixed(1) + ' ' + circumference.toFixed(1));
          msCard.style.display = 'flex';
        } else {
          msCard.style.display = 'none';
        }
      } catch(e) { msCard.style.display = 'none'; }

      // Key stats scroll row (calories, avg HR, elevation, cadence)
      var ksSection = document.getElementById('detail-keystats-section');
      var ksRow = document.getElementById('detail-keystats-row');
      ksRow.innerHTML = '';
      var ksItems = [];
      if (caloriesVal) ksItems.push({ icon:'<path d="M12 2s5 5.5 5 10a5 5 0 0 1-10 0c0-1.4.6-2.6 1.4-3.7.2 1 .9 1.7 1.6 1.7.9 0 1-1 .8-2C10.4 6.4 12 2 12 2z"/>', color:'#EF9F27', val: Math.round(caloriesVal), label:'Calories' });
      if (avgHrVal) ksItems.push({ icon:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>', color:'#E24B4A', val: Math.round(avgHrVal), label:'Avg HR' });
      if (elevVal) ksItems.push({ icon:'<path d="M3 20l6-11 4 7 3-5 5 9H3z"/>', color:'#639922', val: Math.round(elevVal) + ' m', label:'Elevation' });
      if (cadenceVal) ksItems.push({ icon:'<path d="M8 2v4M16 2v4M4 8c2 2 4-2 6 0s4-2 6 0 4-2 4 0M4 14c2 2 4-2 6 0s4-2 6 0 4-2 4 0M4 20c2 2 4-2 6 0s4-2 6 0 4-2 4 0"/>', color:'#378ADD', val: Math.round(cadenceVal*2) + ' spm', label:'Cadence' });
      if (ksItems.length) {
        ksItems.forEach(function(it){
          ksRow.innerHTML += '<div class="detail-keystat-card">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + it.color + '" stroke-width="2">' + it.icon + '</svg>' +
            '<div class="detail-keystat-val">' + it.val + '</div>' +
            '<div class="detail-keystat-label">' + it.label + '</div>' +
          '</div>';
        });
        ksSection.style.display = 'block';
      } else {
        ksSection.style.display = 'none';
      }


      // Best Efforts Grid rendering
      var bestEffSection = document.getElementById('detail-best-efforts-section');
      var bestEffContainer = document.getElementById('detail-best-efforts-container');
      bestEffSection.style.display = 'none';
      bestEffContainer.innerHTML = '';
      var bestEfforts = [];
      if (act.best_efforts) {
        try {
          bestEfforts = typeof act.best_efforts === 'string' ? JSON.parse(act.best_efforts) : act.best_efforts;
        } catch(e) {
          console.warn('Failed to parse best_efforts:', e);
        }
      }
      if (Array.isArray(bestEfforts) && bestEfforts.length > 0) {
        bestEffSection.style.display = 'block';
        var bestEffHtml = '';
        bestEfforts.forEach(function(effort) {
          var effortTime = effort.moving_time || 0;
          var formattedTime = fmtEffortTime(effortTime);
          bestEffHtml += `
            <div class="detail-field-item" style="text-align: center;">
              <div class="detail-field-label" style="font-size: 10px;">${esc(effort.name)}</div>
              <div class="detail-field-val" style="font-size: 15px; margin-top: 4px; color: var(--brand); font-weight: 800;">${formattedTime}</div>
            </div>
          `;
        });
        bestEffContainer.innerHTML = bestEffHtml;
      }

      // Photos Grid rendering
      var photosSection = document.getElementById('detail-photos-section');
      var photosContainer = document.getElementById('detail-photos-container');
      photosSection.style.display = 'none';
      photosContainer.innerHTML = '';
      var photosData = null;
      if (act.photos) {
        try {
          photosData = typeof act.photos === 'string' ? JSON.parse(act.photos) : act.photos;
        } catch(e) {
          console.warn('Failed to parse photos:', e);
        }
      }
      if (photosData && photosData.count > 0 && photosData.primary && photosData.primary.urls) {
        var urls = photosData.primary.urls;
        if (typeof urls === 'string') {
          try { urls = JSON.parse(urls); } catch(e) {}
        }
        var imgUrl = urls["600"] || urls["100"] || (typeof urls === 'object' ? Object.values(urls)[0] : null);
        if (imgUrl) {
          photosSection.style.display = 'block';
          photosContainer.innerHTML = `
            <div style="flex: 0 0 auto; width: 100%; max-width: 320px; scroll-snap-align: start; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); backdrop-filter: blur(10px);">
              <img src="${imgUrl}" style="width: 100%; height: 200px; object-fit: cover; display: block; cursor: pointer;" alt="Activity Photo" onclick="window.open('${imgUrl}', '_blank')" />
            </div>
          `;
        }
      }

      var appBox = document.getElementById('detail-appreciation-box');
      appBox.innerHTML = '';
      var isSpecialAppreciation = false;
      if (sportType === 'Walk' || sportType === 'Run' || sportType === 'VirtualRun' || sportType === 'Hike') {
        var durationMins = movingSec / 60;
        var pacePaceVal = distanceKmVal > 0 ? (durationMins / distanceKmVal) : 999;
        
        var customAppreciations = [
          { cond: function() { return sportType === 'Run' && pacePaceVal < 5.0; }, emoji: '⚡', text: 'Lightning speed! Incredible run pace!' },
          { cond: function() { return distanceKmVal >= 21.1; }, emoji: '🏅', text: 'Half marathon distance! Pure legend status!' },
          { cond: function() { return distanceKmVal >= 15.0; }, emoji: '🔥', text: 'Super distance! You\'re absolutely crushing it!' },
          { cond: function() { return distanceKmVal >= 10.0; }, emoji: '🌟', text: 'Double digits! Outstanding distance effort!' },
          { cond: function() { return sportType === 'Walk' && pacePaceVal < 8.5; }, emoji: '🚶‍♂️💨', text: 'Power walking champion! Very brisk pace!' }
        ];

        for (var cIdx = 0; cIdx < customAppreciations.length; cIdx++) {
          if (customAppreciations[cIdx].cond()) {
            var badgeHtml = `<div class="activity-appreciation-badge special"><span class="appreciation-icon">${customAppreciations[cIdx].emoji}</span><span class="appreciation-text">${customAppreciations[cIdx].text}</span></div>`;
            appBox.innerHTML = badgeHtml;
            isSpecialAppreciation = true;
            break;
          }
        }
      }

      if (!isSpecialAppreciation && distanceKmVal > 0) {
        var durationMins = movingSec / 60;
        var paceMinFloat = distanceKmVal > 0 ? (durationMins / distanceKmVal) : 999;
        var actId = String(act.strava_activity_id || act.activity_id || act.activity_date_time_ist || 'act');
        var seed = athleteName + '_' + distanceKmVal.toFixed(2) + '_' + actId;
        var icon = '🌱';
        var pool = ["Wonderful active minutes! Keep this beautiful rhythm going.", "Every single step counts! Great job staying active today."];
        
        var hash = 0;
        for (var i = 0; i < seed.length; i++) {
          hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        var index = Math.abs(hash) % pool.length;
        var msg = pool[index];
        appBox.innerHTML = `<div class="activity-appreciation-badge"><span class="appreciation-icon">${icon}</span><span class="appreciation-text">"${msg}"</span></div>`;
      }

      var mapWrap = document.getElementById('detail-map-container');
      if (act.summary_polyline) {
        mapWrap.style.display = 'block';
        mapWrap.innerHTML = '<div id="detail-map" style="width: 100%; height: 100%;"></div>';
        if (_activeDetailMap) {
          try { _activeDetailMap.remove(); } catch(e) {}
          _activeDetailMap = null;
        }
        if (_detailMapTimeout) {
          try { clearTimeout(_detailMapTimeout); } catch(e) {}
        }
        _detailMapTimeout = setTimeout(function() {
          try {
            var coordinates = decodePolyline(act.summary_polyline);
            if (coordinates && coordinates.length > 0) {
              _activeDetailMap = L.map('detail-map', {
                zoomControl: true,
                attributionControl: false
              }).setView(coordinates[0], 14);
              L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, className: 'app-map-tile' }).addTo(_activeDetailMap);
              var poly = L.polyline(coordinates, { color: 'var(--brand)', weight: 4, opacity: 0.9, lineJoin: 'round' }).addTo(_activeDetailMap);
              _activeDetailMap.fitBounds(poly.getBounds(), { padding: [20, 20] });
            }
          } catch (mapErr) {
            console.warn('Failed to draw detail map:', mapErr);
          }
        }, 400);
      } else {
        mapWrap.style.display = 'none';
      }

      var loggedInUser = null;
      try { loggedInUser = JSON.parse(localStorage.getItem('wk_user') || '{}'); } catch(e) {}
      var loggedInEmp = null;
      try { loggedInEmp = JSON.parse(localStorage.getItem('ag_emp') || '{}'); } catch(e) {}

      var loggedInAthleteId = loggedInUser ? String(loggedInUser.athleteId || '') : '';
      if (!loggedInAthleteId && loggedInEmp && loggedInEmp.emp_code && loggedInEmp.emp_code.startsWith('STRAVA_')) {
        loggedInAthleteId = loggedInEmp.emp_code.substring(7);
      }
      var loggedInEmail = (loggedInUser && loggedInUser.email) || (loggedInEmp && loggedInEmp.email) || '';
      var ownerAthleteId = String(act.strava_athlete_id || act.athlete_id || '');
      
      window._currentReportActivityId = act.id;
      window._currentReportOwnerId = ownerAthleteId;
      
      var reportSec = document.getElementById('detail-report-section');
      if (reportSec) {
        var isOwner = (loggedInAthleteId && loggedInAthleteId === ownerAthleteId);
        var isLoggedIn = !!((loggedInUser && loggedInUser.loggedIn) || (loggedInEmp && loggedInEmp.emp_code) || localStorage.getItem('ag_emp_token'));
        
        if (isOwner || !isLoggedIn) {
          reportSec.style.display = 'none';
        } else {
          reportSec.style.display = 'block';
          document.getElementById('report-form-container').style.display = 'none';
          document.getElementById('btn-report-activity').style.display = 'flex';
          document.getElementById('report-reason-select').value = '';
          document.getElementById('report-comments').value = '';
        }
      }

      var splitsSection = document.getElementById('detail-splits-section');
      var splitsTableContainer = document.getElementById('detail-splits-table-container');
      if (splitsSection) splitsSection.style.display = 'none';

      var sActId = act.strava_activity_id || act.activity_id || act.id;
      if (sActId) {
        fetch(SUPABASE_URL + '/rest/v1/activity_splits?activity_id=eq.' + sActId + '&order=split_number.asc', { headers: HDR })
          .then(function(res) { return res.json(); })
          .then(function(splits) {
            if (splits && splits.length > 0) {
              if (splitsSection) splitsSection.style.display = 'block';
              
              var isRide = sportType === 'Ride' || sportType === 'MountainBikeRide' || sportType === 'VirtualRide';
              var displaySplits = splits;
              
              if (isRide) {
                // Aggregate into 5km splits
                displaySplits = [];
                var currentGroup = [];
                for (var i = 0; i < splits.length; i++) {
                  currentGroup.push(splits[i]);
                  if (currentGroup.length === 5 || i === splits.length - 1) {
                    var splitNum = displaySplits.length + 1;
                    var totalDist = currentGroup.reduce(function(s, x) { return s + (x.distance_meters || 0); }, 0);
                    var totalMoving = currentGroup.reduce(function(s, x) { return s + (x.moving_time_seconds || 0); }, 0);
                    
                    var totalHrTime = 0;
                    var hrSum = currentGroup.reduce(function(s, x) {
                      if (x.average_heartrate && x.moving_time_seconds) {
                        totalHrTime += x.moving_time_seconds;
                        return s + (x.average_heartrate * x.moving_time_seconds);
                      }
                      return s;
                    }, 0);
                    var avgHr = totalHrTime > 0 ? Math.round(hrSum / totalHrTime) : null;
                    
                    var avgSpeed = totalMoving > 0 ? ((totalDist / totalMoving) * 3.6) : 0;
                    
                    var maxSpeed = 0;
                    currentGroup.forEach(function(x) {
                      var sp = (x.avg_speed || 0) * 3.6;
                      if (sp > maxSpeed) maxSpeed = sp;
                    });
                    
                    displaySplits.push({
                      split_number: splitNum,
                      distance_meters: totalDist,
                      moving_time_seconds: totalMoving,
                      average_heartrate: avgHr,
                      avg_speed_kmh: avgSpeed,
                      max_speed_kmh: maxSpeed
                    });
                    currentGroup = [];
                  }
                }
              }

              var hasHR = displaySplits.some(function(s) { return s.average_heartrate !== null && s.average_heartrate !== undefined && s.average_heartrate > 0; });

              // Pace/Speed chart — pace for walk/run, speed for rides
              var chartCard = document.getElementById('detail-chart-card');
              var chartTitleEl = document.getElementById('detail-chart-title');
              if (displaySplits.length >= 2 && chartCard) {
                var chartVals, chartLabel, higherIsBetter;
                if (isRide) {
                  chartVals = displaySplits.map(function(s){ return (s.avg_speed_kmh || 0) > 0 ? s.avg_speed_kmh : null; }).filter(function(v){ return v !== null; });
                  chartLabel = 'Speed per interval';
                  higherIsBetter = true;
                } else {
                  chartVals = displaySplits.map(function(s){
                    var dKm = (s.distance_meters || 0) / 1000;
                    var mSec = s.moving_time_seconds || 0;
                    return (dKm > 0 && mSec > 0) ? (mSec / dKm) : null;
                  }).filter(function(v){ return v !== null; });
                  chartLabel = 'Pace per km';
                  higherIsBetter = false;
                }
                if (chartTitleEl) chartTitleEl.innerText = chartLabel;
                if (chartVals.length >= 2) {
                  var minV = Math.min.apply(null, chartVals);
                  var maxV = Math.max.apply(null, chartVals);
                  var range = Math.max(0.001, maxV - minV);
                  var n = chartVals.length;
                  var stepX = 300 / (n - 1);
                  var pts = chartVals.map(function(v, i){
                    var x = (i * stepX).toFixed(1);
                    // Higher value draws higher on chart when higherIsBetter (speed), lower value draws higher otherwise (pace)
                    var norm = (v - minV) / range;
                    var y = higherIsBetter ? (50 - norm * 40).toFixed(1) : (10 + norm * 40).toFixed(1);
                    return x + ',' + y;
                  });
                  var linePath = 'M' + pts.join(' L');
                  var areaPath = linePath + ' L300,60 L0,60 Z';
                  var svgEl = document.getElementById('detail-chart-svg');
                  svgEl.innerHTML =
                    '<path d="' + areaPath + '" fill="var(--brand)" opacity="0.12"></path>' +
                    '<path d="' + linePath + '" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>';
                  var avgChartEl = document.getElementById('detail-chart-avg');
                  if (isRide) {
                    var avgSpeedVal = chartVals.reduce(function(a,b){return a+b;},0) / n;
                    avgChartEl.innerText = 'avg ' + avgSpeedVal.toFixed(1) + ' km/h';
                  } else {
                    var avgPaceSec = chartVals.reduce(function(a,b){return a+b;},0) / n;
                    var avgMin = Math.floor(avgPaceSec / 60);
                    var avgRem = Math.round(avgPaceSec % 60);
                    if (avgRem < 10) avgRem = '0' + avgRem;
                    avgChartEl.innerText = 'avg ' + avgMin + ':' + avgRem + '/km';
                  }
                  chartCard.style.display = 'block';
                }
              }

              var html = '<table class="splits-table"><thead><tr>' +
                '<th style="text-align:left;">Split #</th>' +
                '<th style="text-align:left;">Distance</th>';
              
              if (isRide) {
                html += '<th style="text-align:left;">Avg Speed</th>' +
                        '<th style="text-align:left;">Max Speed</th>';
              } else {
                html += '<th style="text-align:left;">Pace</th>';
              }
              
              if (hasHR) {
                html += '<th style="text-align:left;">Avg HR</th>';
              }
              html += '</tr></thead><tbody>';
              
              displaySplits.forEach(function(s) {
                var sDist = ((s.distance_meters || 0) / 1000).toFixed(2) + ' km';
                var sHR = s.average_heartrate ? Math.round(s.average_heartrate) + ' bpm' : '—';
                
                html += '<tr>' +
                  '<td style="color:var(--muted); font-weight:600;">#' + s.split_number + '</td>' +
                  '<td style="color:#fff; font-weight:600;">' + sDist + '</td>';
                
                if (isRide) {
                  var avgSpeedStr = (s.avg_speed_kmh || 0).toFixed(1) + ' km/h';
                  var maxSpeedStr = (s.max_speed_kmh || 0).toFixed(1) + ' km/h';
                  html += '<td style="color:var(--brand); font-weight:700;">' + avgSpeedStr + '</td>' +
                          '<td style="color:#FFD000; font-weight:700;">' + maxSpeedStr + '</td>';
                } else {
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
                  html += '<td style="color:var(--brand); font-weight:700;">' + sPace + '</td>';
                }
                
                if (hasHR) {
                  html += '<td style="color:rgba(255,255,255,0.7);">' + sHR + '</td>';
                }
                html += '</tr>';
              });
              html += '</tbody></table>';
              if (splitsTableContainer) splitsTableContainer.innerHTML = html;
            }
          })
          .catch(function(err) { console.warn('Failed to load splits:', err); });
      }
    }

    var stravaActId = id;
    if (!isStravaId) {
      var item = _feedData.find(function(x) { 
        if (String(x.id) === String(id)) return true;
        var act = {};
        try { act = JSON.parse(x.body); } catch(e) {}
        var actId = act.activity_id || act.strava_activity_id;
        return actId && String(actId) === String(id);
      });
      if (item) {
        var act = {};
        try { act = JSON.parse(item.body); } catch(e) {}
        stravaActId = act.activity_id || act.strava_activity_id;
        populateFromActivity(act, item.created_at);
      }
    }


    if (stravaActId) {

      function handleLoadedActivity(fullAct) {
        var athleteId = fullAct.strava_athlete_id || fullAct.athlete_id;
        if (athleteId) {
          fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=full_name', { headers: HDR })
            .then(function(r) { return r.json(); })
            .then(function(regRows) {
              if (regRows && regRows.length > 0) {
                fullAct.athlete_name = regRows[0].full_name;
              }
              populateFromActivity(fullAct, null);
            })
            .catch(function() {
              populateFromActivity(fullAct, null);
            });
        } else {
          populateFromActivity(fullAct, null);
        }
      }

      fetch(SUPABASE_URL + '/rest/v1/activities?strava_activity_id=eq.' + stravaActId, { headers: HDR })
        .then(function(res) { return res.json(); })
        .then(function(rows) {
          if (rows && rows.length > 0) {
            handleLoadedActivity(rows[0]);
          } else {
            // Try fallback query by internal database ID
            fetch(SUPABASE_URL + '/rest/v1/activities?id=eq.' + stravaActId, { headers: HDR })
              .then(function(res) { return res.json(); })
              .then(function(rows2) {
                if (rows2 && rows2.length > 0) {
                  handleLoadedActivity(rows2[0]);
                } else {
                  console.warn('Activity not found by strava_activity_id or id:', stravaActId);
                }
              })
              .catch(function(err) { console.warn('Fallback fetch failed:', err); });
          }
        })
        .catch(function(err) { console.warn('Failed to load full activity details:', err); });
    }
  } catch (errGlobal) {
    console.error('Error executing openActivityDetail:', errGlobal);
  }
}

function closeActivityDetail() {
  var modal = document.getElementById('activity-detail-modal');
  modal.classList.remove('open');
  setTimeout(function() {
    modal.style.display = 'none';
  }, 350);
}

function renderSportsStats() {
  var container = document.getElementById('prof-sports-stats-container');
  if (!container) return;
  if (!_activeProfileStats) {
    container.innerHTML = '<div style="font-size:12px; color:var(--muted); text-align:center; padding:12px 0;">No Strava stats breakdown available.</div>';
    return;
  }
  
  var prefix = _activeStatsTimeframe;
  var run = _activeProfileStats[prefix + '_run_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  var ride = _activeProfileStats[prefix + '_ride_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  var swim = _activeProfileStats[prefix + '_swim_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  
  var sports = [
    { name: 'Run/Walk', icon: '🏃', data: run },
    { name: 'Ride', icon: '🚴', data: ride },
    { name: 'Swim', icon: '🏊', data: swim }
  ];
  
  var html = '';
  sports.forEach(function(sport) {
    var count = sport.data.count || 0;
    var dist = ((sport.data.distance || 0) / 1000).toFixed(1) + ' km';
    if (sport.name === 'Swim') {
      dist = (sport.data.distance || 0).toLocaleString('en-IN') + ' m';
    }
    
    var timeSec = sport.data.moving_time || 0;
    var timeStr = '0m';
    if (timeSec >= 3600) {
      timeStr = Math.floor(timeSec / 3600) + 'h ' + Math.floor((timeSec % 3600) / 60) + 'm';
    } else if (timeSec > 0) {
      timeStr = Math.floor(timeSec / 60) + 'm';
    }
    var elev = Math.round(sport.data.elevation_gain || 0) + ' m';
    
    html += `
      <div class="prof-pb-card" style="padding:14px; background:rgba(255,255,255,0.01);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.04); padding-bottom:6px; margin-bottom:10px;">
          <span style="font-size:12.5px; font-weight:800; color:#fff;">${sport.icon} ${sport.name}</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); text-align:center; gap:6px;">
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Activities</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${count}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Distance</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${dist}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Time</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${timeStr}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Elev Gain</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${elev}</div>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function toggleStatsTimeframe(timeframe) {
  _activeStatsTimeframe = timeframe;
  var btnRecent = document.getElementById('btn-stats-recent');
  var btnAll = document.getElementById('btn-stats-alltime');
  if (btnRecent && btnAll) {
    if (timeframe === 'recent') {
      btnRecent.style.background = 'rgba(255, 255, 255, 0.08)';
      btnRecent.style.color = '#fff';
      btnAll.style.background = 'none';
      btnAll.style.color = 'var(--muted)';
    } else {
      btnAll.style.background = 'rgba(255, 255, 255, 0.08)';
      btnAll.style.color = '#fff';
      btnRecent.style.background = 'none';
      btnRecent.style.color = 'var(--muted)';
    }
  }
  renderSportsStats();
}

function openProfileDetail(athleteId, event) {
  console.log('openProfileDetail called with athleteId:', athleteId);
  if (!athleteId || String(athleteId) === 'undefined' || String(athleteId) === 'null' || String(athleteId).trim() === '') {
    console.warn('Invalid athleteId passed to openProfileDetail:', athleteId);
    return;
  }
  try {
    if (event && event.target && (event.target.closest('button') || event.target.closest('.feed-react-btn'))) {
      return;
    }
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();

    _activeProfileStats = null;
    _activeStatsTimeframe = 'recent';
    
    var statsContainer = document.getElementById('prof-sports-stats-container');
    if (statsContainer) statsContainer.innerHTML = '<div style="font-size:12px; color:var(--muted); text-align:center; padding:12px 0;">Loading Strava stats breakdown...</div>';

    var btnRecent = document.getElementById('btn-stats-recent');
    var btnAll = document.getElementById('btn-stats-alltime');
    if (btnRecent && btnAll) {
      btnRecent.style.background = 'rgba(255, 255, 255, 0.08)';
      btnRecent.style.color = '#fff';
      btnAll.style.background = 'none';
      btnAll.style.color = 'var(--muted)';
    }

    document.getElementById('prof-name').innerHTML = 'Loading...';
    document.getElementById('prof-team-shift').innerText = '';
    document.getElementById('prof-total-dist').innerText = '—';
    document.getElementById('prof-total-steps').innerText = '—';
    document.getElementById('prof-total-activities').innerText = '—';
    document.getElementById('prof-total-hours').innerText = '—';
    var profPbContainer = document.getElementById('prof-pb-container');
    if (profPbContainer) profPbContainer.innerHTML = '';
    document.getElementById('prof-heatmap-grid').innerHTML = '';
    document.getElementById('prof-recent-activities').innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">Loading recent activities...</div>';

    if (typeof _currentProfileAthleteId !== 'undefined') _currentProfileAthleteId = athleteId;

    var modal = document.getElementById('profile-detail-modal');
    modal.style.display = 'block';
    setTimeout(function() {
      modal.classList.add('open');
    }, 10);

    var cols = 'id,emp_code,full_name,email,mobile,gender,shift,project_lead,strava_profile_url,tshirt_size,leaderboard_team,event_name,created_at,role,is_private,is_flagged,event_id,strava_athlete_id,status,profile_photo';
    fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=' + cols, { headers: HDR })
      .then(function(r){ return r.json(); })
      .then(function(regRows) {
        if (regRows && regRows.length > 0) {
          var p = regRows[0];
          var profilePhoto = p.profile_photo || '';
          var locationStr = 'India';
          
          document.getElementById('prof-name').innerHTML = `<a href="https://www.strava.com/athletes/${athleteId}" target="_blank" style="color: #fff; text-decoration: none; border-bottom: 1.5px dashed rgba(255,255,255,0.3); transition: color 0.2s ease, border-color 0.2s ease;">${esc(p.full_name || '—')} 🇮🇳</a>`;

          // Location
          var locEl = document.getElementById('prof-location');
          if (locEl) {
            locEl.innerText = '📍 ' + locationStr;
            locEl.style.display = 'block';
          }

          var pName = p.full_name || 'Participant';
          var pInitials = (function(){var pts=(pName||'').trim().split(/\s+/);if(pts.length>=2)return(pts[0][0]+(pts[pts.length-1][0])).toUpperCase();return(pts[0]||'?')[0].toUpperCase();})();
          var pStyle = getAvatarStyle(pName);
          var avEl = document.getElementById('prof-avatar');
          if (avEl) {
            var hasPhoto = profilePhoto && profilePhoto !== 'null' && profilePhoto !== 'undefined' && !profilePhoto.includes('large.png') && !profilePhoto.includes('avatar/athlete');
            if (hasPhoto) {
              avEl.textContent = '';
              avEl.setAttribute('style', `background: url('${profilePhoto}') no-repeat center center; background-size: cover; width:90px; height:90px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); border:2.5px solid rgba(255,255,255,0.08);`);
            } else {
              avEl.textContent = pInitials;
              avEl.setAttribute('style', pStyle + '; width:90px; height:90px; border-radius:50%; font-size:32px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); border:2.5px solid rgba(255,255,255,0.08);');
            }
          }
        }
      }).catch(function(err) {
        console.warn('Profile details load error:', err);
      });

    var _profileAthleteId = athleteId;
    var _profileTimeframe = document.getElementById('prof-timeframe-select') ? (document.getElementById('prof-timeframe-select').value || 'month') : 'month';
    var url = SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + athleteId + '&is_deleted=eq.false&activity_date=gte.2026-06-01&activity_date=lte.2026-07-01T15:00:00&order=activity_date.desc';
    fetch(url, { headers: HDR })
      .then(function(res) { return res.json(); })
      .then(function(acts) {
        var validActs = acts.filter(function(a) { return !a.is_flagged; });

        // Calculate stats breakdown locally from synchronized activities
        var runActs = validActs.filter(function(a) { var t = a.sport_type; return t === 'Walk' || t === 'Run' || t === 'VirtualRun' || t === 'Hike'; });
        var rideActs = validActs.filter(function(a) { var t = a.sport_type; return t === 'Ride' || t === 'VirtualRide' || t === 'MountainBikeRide'; });
        var swimActs = validActs.filter(function(a) { return a.sport_type === 'Swim'; });
        
        function sumTotals(actsList) {
          return {
            count: actsList.length,
            distance: actsList.reduce(function(s, a) { return s + (a.distance_meters || 0); }, 0),
            moving_time: actsList.reduce(function(s, a) { return s + (a.moving_time_seconds || 0); }, 0),
            elevation_gain: actsList.reduce(function(s, a) { return s + (a.elevation_gain || 0); }, 0)
          };
        }
        
        _activeProfileStats = {
          recent_run_totals: sumTotals(runActs),
          recent_ride_totals: sumTotals(rideActs),
          recent_swim_totals: sumTotals(swimActs),
          all_run_totals: sumTotals(runActs),
          all_ride_totals: sumTotals(rideActs),
          all_swim_totals: sumTotals(swimActs)
        };
        renderSportsStats();

        var pGender = 'Male';
        var pShift = 'Dayshift';
        if (LB_REG && LB_REG.length) {
          var matchingReg = LB_REG.find(function(x) { return String(x.strava_athlete_id) === String(athleteId); });
          if (matchingReg) {
            pGender = matchingReg.gender || 'Male';
            pShift = matchingReg.shift || 'Dayshift';
          }
        }
        var pPts = calcFullPts(acts, pGender, pShift);

        document.getElementById('prof-total-dist').innerText = Math.round(pPts.km) + ' km';
        
        var validCount = validActs.length;
        document.getElementById('prof-total-activities').innerText = validCount;

        var totalDistM = validActs.reduce(function(s,a) { return s + (a.distance_meters || 0); }, 0);
        var totalSteps = Math.round((totalDistM / 1000) * 1350);
        document.getElementById('prof-total-steps').innerText = totalSteps.toLocaleString('en-IN');

        // Total Hours calculation
        var totalMovingSeconds = validActs.reduce(function(s,a) { return s + (a.moving_time_seconds || 0); }, 0);
        var totalHours = (totalMovingSeconds / 3600).toFixed(1);
        document.getElementById('prof-total-hours').innerText = totalHours + 'h';

        // Split distance of Run, Walk/Hike and Ride
        var runDistM = 0;
        var walkHikeDistM = 0;
        var rideDistM = 0;
        validActs.forEach(function(a) {
          var t = a.sport_type;
          var dist = a.distance_meters || 0;
          if (t === 'Run' || t === 'VirtualRun') {
            runDistM += dist;
          } else if (t === 'Walk' || t === 'Hike') {
            walkHikeDistM += dist;
          } else if (t === 'Ride' || t === 'VirtualRide' || t === 'MountainBikeRide') {
            rideDistM += dist;
          }
        });
        document.getElementById('prof-split-run').innerText = (runDistM / 1000).toFixed(1) + ' km';
        document.getElementById('prof-split-walk').innerText = (walkHikeDistM / 1000).toFixed(1) + ' km';
        document.getElementById('prof-split-ride').innerText = (rideDistM / 1000).toFixed(1) + ' km';

        var maxDist = 0;
        var maxTime = 0;
        var maxSpeed = 0;
        var bestPaceSport = 'Walk';
        var dayKm = {};
        
        var longestAct = null;
        var longestSessionAct = null;
        var bestPaceAct = null;
        var maxElevation = 0;
        var maxElevationAct = null;
        var maxAvgSpeed = 0;
        var maxSpeedAct = null;

        validActs.forEach(function(a) {
          var km = (a.distance_meters || 0) / 1000;
          if (a.distance_meters > maxDist) {
            maxDist = a.distance_meters;
            longestAct = a;
          }
          if (a.moving_time_seconds > maxTime) {
            maxTime = a.moving_time_seconds;
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

        var bestDayAct = null;
        if (bestDayDate) {
          var dayActs = validActs.filter(function(a) { return getActDate(a) === bestDayDate; });
          if (dayActs.length > 0) {
            dayActs.sort(function(x, y) { return (y.distance_meters || 0) - (x.distance_meters || 0); });
            bestDayAct = dayActs[0];
          }
        }

        // --- Render Profile Personal Bests Dynamically ---
        (function() {
          var container = document.getElementById("prof-pb-container");
          if (!container) return;
          
          var pbConfig = (EVENT_ROW && EVENT_ROW.rules_config && EVENT_ROW.rules_config.dashboard && EVENT_ROW.rules_config.dashboard.personal_bests) ? EVENT_ROW.rules_config.dashboard.personal_bests : {
            longest_activity: true,
            best_pace: true,
            longest_session: true,
            best_day: true
          };
          
          // Find max elevation
          var maxElevation = validActs.reduce(function(mx, a) { return Math.max(mx, parseFloat(a.elevation_gain) || 0); }, 0);
          
          // Find max avg speed
          var maxAvgSpeed = validActs.reduce(function(mx, a) { return Math.max(mx, parseFloat(a.avg_speed) || 0); }, 0);
          
          // Find total elevation
          var totalElevation = validActs.reduce(function(sum, a) { return sum + (parseFloat(a.elevation_gain) || 0); }, 0);
          
          // Calculate streak
          var activeDays = {};
          validActs.forEach(function(a) {
            var d = getActDate(a);
            if (d) activeDays[d] = true;
          });
          var sortedActive = Object.keys(activeDays).sort();
          var streakBest = 0, cur = 0, prevD = null;
          sortedActive.forEach(function(d) {
            if (prevD) {
              var diff = Math.round((new Date(d + "T12:00:00") - new Date(prevD + "T12:00:00")) / 86400000);
              cur = diff === 1 ? cur + 1 : 1;
            } else cur = 1;
            streakBest = Math.max(streakBest, cur);
            prevD = d;
          });

          var statDefs = {
            longest_activity: {
              lbl: "Longest Activity",
              sub: "single session max",
              val: maxDist > 0 ? (maxDist / 1000).toFixed(2) + ' km' : '—'
            },
            best_pace: {
              lbl: "Best Pace",
              sub: "min/km - walk/run",
              val: maxSpeed > 0 ? fmtPS(maxSpeed, bestPaceSport) : '—'
            },
            longest_session: {
              lbl: "Longest Duration",
              sub: "moving duration",
              val: maxTime > 0 ? fmtDur(maxTime) : '—'
            },
            best_day: {
              lbl: "Best Day",
              sub: "daily max",
              val: (function() {
                var maxDayKm = 0;
                Object.keys(dayKm).forEach(function(d){ if (dayKm[d] > maxDayKm) maxDayKm = dayKm[d]; });
                return maxDayKm > 0 ? maxDayKm.toFixed(2) + ' km' : '—';
              })()
            },
            max_elevation: {
              lbl: "Max Elevation",
              sub: "single session max",
              val: maxElevation > 0 ? maxElevation.toFixed(0) + ' m' : '—'
            },
            max_speed: {
              lbl: "Max Avg Speed",
              sub: "single session max",
              val: maxAvgSpeed > 0 ? (maxAvgSpeed * 3.6).toFixed(1) + ' km/h' : '—'
            },
            total_distance: {
              lbl: "Total Distance",
              sub: "overall distance",
              val: maxDist > 0 ? (validActs.reduce(function(sum, a) { return sum + (a.distance_meters || 0); }, 0) / 1000).toFixed(1) + ' km' : '—'
            },
            total_elevation: {
              lbl: "Total Elevation",
              sub: "overall elevation",
              val: totalElevation > 0 ? totalElevation.toFixed(0) + ' m' : '—'
            },
            total_activities: {
              lbl: "Total Activities",
              sub: "synced sessions",
              val: validActs.length + " acts"
            }
          };

          var html = "";
          var keys = ["longest_activity", "best_pace", "longest_session", "best_day", "max_elevation", "max_speed", "total_distance", "total_elevation", "total_activities"];
          keys.forEach(function(key) {
            if (pbConfig[key] !== false) {
              var d = statDefs[key];
              var clickAttr = '';
              var styleAttr = ' style="display: flex; flex-direction: column;"';
              if (key === 'longest_activity' && longestAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (longestAct.strava_activity_id || longestAct.id) + '\', event, ' + (longestAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              } else if (key === 'best_pace' && bestPaceAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (bestPaceAct.strava_activity_id || bestPaceAct.id) + '\', event, ' + (bestPaceAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              } else if (key === 'longest_session' && longestSessionAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (longestSessionAct.strava_activity_id || longestSessionAct.id) + '\', event, ' + (longestSessionAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              } else if (key === 'max_elevation' && maxElevationAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (maxElevationAct.strava_activity_id || maxElevationAct.id) + '\', event, ' + (maxElevationAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              } else if (key === 'max_speed' && maxSpeedAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (maxSpeedAct.strava_activity_id || maxSpeedAct.id) + '\', event, ' + (maxSpeedAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              } else if (key === 'best_day' && bestDayAct) {
                clickAttr = ' onclick="openActivityDetail(\'' + (bestDayAct.strava_activity_id || bestDayAct.id) + '\', event, ' + (bestDayAct.strava_activity_id ? 'true' : 'false') + ')"';
                styleAttr = ' style="display: flex; flex-direction: column; cursor: pointer;"';
              }
              html += '<div class="prof-pb-card"' + clickAttr + styleAttr + '>' +
                '<span class="lbl">' + d.lbl + '</span>' +
                '<span class="val">' + d.val + '</span>' +
                '<span class="sub">' + d.sub + '</span>' +
              '</div>';
            }
          });
          
          // Always append streak
          html += '<div class="prof-pb-card">' +
            '<span class="lbl">Active Streak</span>' +
            '<span class="val">' + streakBest + ' days</span>' +
            '<span class="sub">consecutive days</span>' +
          '</div>';

          container.innerHTML = html;
        })();

        var grid = document.getElementById('prof-heatmap-grid');
        if (grid) {
          grid.innerHTML = '';
          var todayStr = new Date().toISOString().split('T')[0];
          for (var d = 1; d <= 30; d++) {
            var ds = '2026-06-' + (d < 10 ? '0' : '') + d;
            var cell = document.createElement('div');
            cell.className = 'hm-day';
            var km = dayKm[ds] || 0;
            cell.title = ds + (km > 0 ? ' \u00b7 ' + km.toFixed(1) + ' km' : '');
            cell.textContent = d;
            if (ds > todayStr) { cell.classList.add('future'); }
            else if (km >= 21) { cell.classList.add('km-21'); }
            else if (km >= 15) { cell.classList.add('km-15'); }
            else if (km >= 10) { cell.classList.add('km-10'); }
            else if (km >= 8)  { cell.classList.add('km-8'); }
            else if (km >= 5)  { cell.classList.add('km-5'); }
            else { cell.classList.add('rest'); }
            if (ds === todayStr) cell.classList.add('today');
            grid.appendChild(cell);
          }
        }

        var listContainer = document.getElementById('prof-recent-activities');
        if (!listContainer) return;
        if (!validActs.length) {
          listContainer.innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">No recent activities logged this month.</div>';
          return;
        }
        listContainer.innerHTML = '';
        validActs.slice(0, 10).forEach(function(a) {
          var card = document.createElement('div');
          card.className = 'prof-recent-act-card';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch';
          card.style.cursor = 'pointer';
          
          var dateLabel = '';
          try {
            var adt = new Date(a.activity_date);
            if (!isNaN(adt.getTime())) {
              dateLabel = adt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' at ' + adt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
            }
          } catch (e) {}

          var distVal = ((a.distance_meters || 0) / 1000).toFixed(2);
          var movingMins = Math.round((a.moving_time_seconds || 0) / 60);
          var stepsVal = Math.round(((a.distance_meters || 0) / 1000) * 1350);
          var paceValStr = (a.distance_meters > 0 && a.moving_time_seconds > 0) ? fmtPS(a.distance_meters / a.moving_time_seconds, a.sport_type) : '—';
          var elevVal = a.elevation_gain || 0;
          var deviceVal = a.device_name || 'Strava';

          card.addEventListener('click', function(e) {
            if (e.target.closest('.view-full-btn')) {
              return;
            }
            e.preventDefault();
            var coll = card.querySelector('.act-card-collapse');
            if (coll) {
              var isCollapsed = coll.style.display === 'none';
              coll.style.display = isCollapsed ? 'block' : 'none';
              card.style.borderColor = isCollapsed ? 'rgba(232, 98, 42, 0.4)' : 'rgba(255,255,255,0.06)';
            }
          });
          
          card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
              <div>
                <div style="font-size:14px; font-weight:800; color:#fff;">${esc(a.activity_name || 'Activity')}</div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${dateLabel} &middot; ${movingMins} mins &middot; ${stepsVal.toLocaleString('en-IN')} steps</div>
              </div>
              <div style="font-size:14px; font-weight:800; color:var(--brand); display:flex; align-items:center; gap:2px; flex-shrink:0;">
                <span>${distVal}</span> <span style="font-size:10px; color:var(--muted); font-weight:700;">KM</span>
              </div>
            </div>
            <div class="act-card-collapse" style="display: none; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,0.08); margin-top: 10px; width: 100%;">
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7);">
                <div><span style="color: var(--muted); font-weight: 700;">Pace:</span> ${paceValStr}</div>
                <div><span style="color: var(--muted); font-weight: 700;">Elapsed:</span> ${fmtDur(a.elapsed_time_seconds || 0)}</div>
                <div><span style="color: var(--muted); font-weight: 700;">Elevation:</span> ${Math.round(elevVal)} m</div>
                <div><span style="color: var(--muted); font-weight: 700;">Device:</span> ${esc(deviceVal)}</div>
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="view-full-btn" onclick="openActivityDetail('${a.strava_activity_id}', event, true)" style="background: rgba(232, 98, 42, 0.1); border: 1px solid rgba(232, 98, 42, 0.25); color: var(--brand); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                  Full Stats &amp; Map ↗
                </button>
              </div>
            </div>
          `;
          listContainer.appendChild(card);
        });
      })
      .catch(function(err) {
        console.warn('Profile activities load error:', err);
      });
  } catch (errGlobal) {
    console.error('Error executing openProfileDetail:', errGlobal);
  }
}


function closeProfileDetail() {
  var modal = document.getElementById('profile-detail-modal');
  modal.classList.remove('open');
  setTimeout(function() {
    modal.style.display = 'none';
  }, 350);
}

// Suspicious Activity Reporting Logic
function toggleReportForm() {
  var container = document.getElementById('report-form-container');
  var btn = document.getElementById('btn-report-activity');
  if (container.style.display === 'none') {
    container.style.display = 'block';
    btn.style.display = 'none';
  } else {
    container.style.display = 'none';
    btn.style.display = 'flex';
  }
}

function onReportReasonChange() {
  var select = document.getElementById('report-reason-select');
  var comments = document.getElementById('report-comments');
  if (select.value === 'custom') {
    comments.focus();
  }
}

async function submitActivityReport() {
  var activityId = window._currentReportActivityId;
  var ownerId = window._currentReportOwnerId;
  
  if ((!activityId || !ownerId) && window._currentStravaActivityId) {
    try {
      // 1. Try resolving by strava_activity_id
      var r = await fetch(SUPABASE_URL + '/rest/v1/activities?strava_activity_id=eq.' + window._currentStravaActivityId, {
        headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
      });
      var data = await r.json();
      if (data && data.length > 0) {
        activityId = data[0].id;
        ownerId = data[0].strava_athlete_id || data[0].athlete_id;
      } else {
        // 2. Try resolving by database primary key id
        var r2 = await fetch(SUPABASE_URL + '/rest/v1/activities?id=eq.' + window._currentStravaActivityId, {
          headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
        });
        var data2 = await r2.json();
        if (data2 && data2.length > 0) {
          activityId = data2[0].id;
          ownerId = data2[0].strava_athlete_id || data2[0].athlete_id;
        }
      }
      
      if (activityId) {
        window._currentReportActivityId = activityId;
        window._currentReportOwnerId = ownerId;
      }
    } catch(e) {
      console.warn('Failed to resolve activity details dynamically:', e);
    }
  }
  
  if (!activityId || !ownerId) {
    alert('Failed to report activity: Activity details not loaded.\n'
        + 'Diagnostic Log:\n'
        + '- currentReportActivityId: ' + window._currentReportActivityId + '\n'
        + '- currentReportOwnerId: ' + window._currentReportOwnerId + '\n'
        + '- currentStravaActivityId: ' + window._currentStravaActivityId);
    return;
  }
  
  var select = document.getElementById('report-reason-select');
  var reason = select.value;
  var comments = document.getElementById('report-comments').value.trim();
  
  if (reason === 'custom') {
    reason = comments;
  }
  
  if (!reason) {
    alert('Please select or specify a reason for reporting.');
    return;
  }
  
  var session = null;
  try { session = JSON.parse(localStorage.getItem('wk_user') || '{}'); } catch(e) {}
  var empSession = null;
  try { empSession = JSON.parse(localStorage.getItem('ag_emp') || '{}'); } catch(e) {}
  
  var reporterId = (session && (session.athleteId || session.email || session.empCode)) || 
                   (empSession && (empSession.emp_code || empSession.email)) || '';
  reporterId = String(reporterId).trim();
  
  if (!reporterId) {
    alert('You must be logged in to report activities.');
    return;
  }
  
  var btnSubmit = document.getElementById('btn-submit-report');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Checking limits...';
  
  try {
    var now = new Date();
    var todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    
    var limitResp = await fetch(SUPABASE_URL + '/rest/v1/activity_reports?select=id&reported_by=eq.' + reporterId + '&created_at=gte.' + todayStart, {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
    });
    if (limitResp.ok) {
      var userTodayReports = await limitResp.json();
      if (userTodayReports && userTodayReports.length >= 5) {
        alert('You have reached the daily limit of 5 reports. You are abusing this feature.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Report';
        return;
      }
    }
  } catch(e) {
    console.warn('Failed to verify user reporting limits:', e);
  }
  
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Submitting...';
  
  var payload = {
    activity_id: parseInt(activityId),
    reported_by: reporterId,
    athlete_id: ownerId,
    reason: reason,
    custom_comments: comments || null
  };
  
  try {
    var resp = await fetch(SUPABASE_URL + '/rest/v1/activity_reports', {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: 'Bearer ' + ANON,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    
    if (resp.status === 404) {
      alert('Report failed: Database table activity_reports not found. Please verify the SQL migration has been run in the Supabase Dashboard.');
      return;
    }
    
    if (!resp.ok) {
      throw new Error('Database insert failed with status ' + resp.status);
    }
    
    alert('Thank you. The activity has been reported to the administrator for review.');
    toggleReportForm();
    closeActivityDetail();
    
  } catch (e) {
    alert('Error submitting report: ' + e.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Submit Report';
  }
}


// ── Share Activity Card ──────────────────────────────────────────────────────
window._shareActivityData = null;
window._shareThemeIndex = 0;
window._shareBgTransparent = false;

function showShareSheet() {
  var sh = document.getElementById('share-sheet');
  if (sh) sh.style.display = 'flex';
  
  window._shareThemeIndex = 0;
  window._shareBgTransparent = false;
  
  var toggle = document.getElementById('share-bg-toggle');
  if (toggle) toggle.checked = false;
  
  var dots = document.querySelectorAll('.share-dot');
  dots.forEach(function(d, i) {
    if (d) d.style.opacity = (i === 0) ? '1' : '0.3';
  });
  
  setTimeout(function() {
    window.renderShareCard();
  }, 100);
}

function hideShareSheet() {
  var sh = document.getElementById('share-sheet');
  if (sh) sh.style.display = 'none';
}

window.setShareTheme = function(index) {
  window._shareThemeIndex = index;
  var dots = document.querySelectorAll('.share-dot');
  dots.forEach(function(d, i) {
    if (d) d.style.opacity = (i === index) ? '1' : '0.3';
  });
  window.renderShareCard();
};

window.toggleShareBg = function() {
  window._shareBgTransparent = document.getElementById('share-bg-toggle').checked;
  window.renderShareCard();
};

window.renderShareCard = function() {
  var act = window._shareActivityData;
  if (!act) return;
  
  var canvas = document.getElementById('share-card-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  
  var W = 600;
  var H = 800;
  canvas.width = W;
  canvas.height = H;
  
  ctx.clearRect(0, 0, W, H);
  
  if (!window._shareBgTransparent) {
    if (window._shareThemeIndex === 0) {
      var grad = ctx.createRadialGradient(W/2, 0, 50, W/2, 0, W * 1.1);
      grad.addColorStop(0, '#1e3a8a');
      grad.addColorStop(0.5, '#0b0f19');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else if (window._shareThemeIndex === 1) {
      var grad = ctx.createRadialGradient(W/2, 0, 50, W/2, 0, W * 1.1);
      grad.addColorStop(0, '#7c2d12');
      grad.addColorStop(0.5, '#0b0f19');
      grad.addColorStop(1, '#090500');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else if (window._shareThemeIndex === 2) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W-4, H-4);
    }
  }
  
  var brandText = 'ARCGATE';
  if (typeof CONFIG_LB !== 'undefined' && CONFIG_LB.display_name) {
    brandText = CONFIG_LB.display_name.toUpperCase();
  }
  ctx.font = "800 24px 'Outfit', system-ui, -apple-system, sans-serif";
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText(brandText, W/2, 60);
  ctx.letterSpacing = '0px';
  
  var coords = [];
  if (act.summary_polyline) {
    try {
      coords = decodePolyline(act.summary_polyline);
    } catch(e) {
      console.warn('Decode polyline failed for share:', e);
    }
  }
  
  var mapX = 80;
  var mapY = 130;
  var mapW = W - 160;
  var mapH = H - 360;
  
  var themeColors = ['#00f0ff', '#ef4444', '#10b981'];
  var strokeColor = themeColors[window._shareThemeIndex] || '#00f0ff';
  
  if (coords && coords.length > 0) {
    ctx.save();
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 15;
    drawRouteOnCanvas(ctx, coords, mapX, mapY, mapW, mapH, strokeColor, 6);
    ctx.shadowBlur = 0;
    drawRouteOnCanvas(ctx, coords, mapX, mapY, mapW, mapH, '#ffffff', 2.5);
    ctx.restore();
  } else {
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(W/2 - 100, H/2 - 100);
    ctx.bezierCurveTo(W/2 - 50, H/2 - 150, W/2 + 50, H/2 - 50, W/2 + 100, H/2 - 100);
    ctx.stroke();
    ctx.restore();
    ctx.font = '64px system-ui';
    ctx.fillText('🏃', W/2, H/2 - 100);
  }
  
  var iconColor = strokeColor;
  drawRunningSilhouette(ctx, W/2, H - 200, 72, iconColor);
  
  var kmVal = parseFloat(((act.distance_meters||0)/1000).toFixed(2));
  var movingSec = act.moving_time_seconds||0;
  
  var totalMins = Math.floor(movingSec/60);
  var hrs = Math.floor(totalMins/60);
  var mins = totalMins % 60;
  var durationStr = hrs > 0 ? hrs + ':' + (mins<10?'0':'') + mins : '0:' + (mins<10?'0':'') + mins;
  if (movingSec === 0 && act.duration_minutes) {
    var fallbackMins = Math.round(act.duration_minutes);
    var fHrs = Math.floor(fallbackMins/60);
    var fMins = fallbackMins % 60;
    durationStr = fHrs > 0 ? fHrs + ':' + (fMins<10?'0':'') + fMins : '0:' + (fMins<10?'0':'') + fMins;
  }
  
  var paceSecPerKm = kmVal>0 ? movingSec/kmVal : 0;
  var paceMin = Math.floor(paceSecPerKm/60);
  var paceSec = Math.round(paceSecPerKm%60);
  var paceStr = kmVal>0 ? paceMin+':'+(paceSec<10?'0':'')+paceSec + ' /km' : '--';
  
  var stats = [
    { value: kmVal.toFixed(2) + ' km', label: 'Distance' },
    { value: durationStr, label: 'Duration' },
    { value: paceStr, label: 'Pace' }
  ];
  
  var colW = W / 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  
  stats.forEach(function(s, i) {
    var cx = i * colW + colW/2;
    
    ctx.font = "bold 32px 'Outfit', system-ui, -apple-system, sans-serif";
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.value, cx, H - 90);
    
    ctx.font = "500 13px 'Outfit', system-ui, -apple-system, sans-serif";
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(s.label.toUpperCase(), cx, H - 60);
    
    if (i < 2) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + colW/2, H - 120);
      ctx.lineTo(cx + colW/2, H - 55);
      ctx.stroke();
    }
  });
};

function drawRunningSilhouette(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  ctx.arc(x, y - size*0.35, size*0.09, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(x - size*0.04, y - size*0.22);
  ctx.lineTo(x + size*0.04, y - size*0.05);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x - size*0.02, y - size*0.2);
  ctx.lineTo(x + size*0.14, y - size*0.14);
  ctx.lineTo(x + size*0.08, y - size*0.04);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x - size*0.02, y - size*0.2);
  ctx.lineTo(x - size*0.14, y - size*0.16);
  ctx.lineTo(x - size*0.16, y - size*0.05);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x + size*0.04, y - size*0.05);
  ctx.lineTo(x - size*0.08, y + size*0.06);
  ctx.lineTo(x - size*0.03, y + size*0.18);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x + size*0.04, y - size*0.05);
  ctx.lineTo(x + size*0.11, y + size*0.08);
  ctx.lineTo(x + size*0.02, y + size*0.22);
  ctx.stroke();
  
  ctx.restore();
}

function drawRouteOnCanvas(ctx, coords, boxX, boxY, boxW, boxH, strokeColor, strokeWidth) {
  if (!coords || coords.length === 0) return;
  
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const lat = coords[i][0];
    const lng = coords[i][1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  
  if (spanLat === 0 && spanLng === 0) return;
  
  const scaleX = boxW / (spanLng || 1);
  const scaleY = boxH / (spanLat || 1);
  const scale = Math.min(scaleX, scaleY);
  
  const pathW = spanLng * scale;
  const pathH = spanLat * scale;
  const offsetX = boxX + (boxW - pathW) / 2;
  const offsetY = boxY + (boxH - pathH) / 2;
  
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (let i = 0; i < coords.length; i++) {
    const lat = coords[i][0];
    const lng = coords[i][1];
    const px = offsetX + (lng - minLng) * scale;
    const py = offsetY + (maxLat - lat) * scale;
    
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

window.performShareAction = function(action) {
  var canvas = document.getElementById('share-card-canvas');
  if (!canvas) return;
  
  canvas.toBlob(function(blob) {
    if (action === 'copy') {
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]).then(function() {
          alert('Activity card copied to clipboard!');
        }).catch(function(e) {
          alert('Clipboard copy blocked or failed. Please download the image instead.');
        });
      } else {
        alert('Clipboard Copy is not supported in this browser. Please download the image instead.');
      }
    } else if (action === 'download') {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'walkathon-activity.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      var file = new File([blob], 'walkathon-activity.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'My Walkathon Activity',
          text: 'Check out my latest activity!'
        }).catch(function(err) {
          if (err.name !== 'AbortError') {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'walkathon-activity.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        });
      } else {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'walkathon-activity.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }
  }, 'image/png');
};
