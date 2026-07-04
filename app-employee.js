// app-employee.js
// Handles non-participant employee specific logic, login flows, and native Celebrate tab loaders.

var _loginEmail = '';
var _postPhotos = [];

function initials(name) {
  var parts = (name || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0] || '?')[0].toUpperCase();
}

/* ---------- session helpers ---------- */
function getToken(){ try { return localStorage.getItem('ag_emp_token'); } catch(e){ return null; } }
function setToken(t){ try { localStorage.setItem('ag_emp_token', t); } catch(e){} }
function getEmp(){ try { return JSON.parse(localStorage.getItem('ag_emp') || 'null'); } catch(e){ return null; } }
function setEmp(e){ try { localStorage.setItem('ag_emp', JSON.stringify(e)); } catch(ex){} }
function clearSession(){
  try {
    localStorage.removeItem('ag_emp_token');
    localStorage.removeItem('ag_emp');
    localStorage.removeItem('wk_user');
  } catch(e){}
}

function tokenValid(t){
  if (!t) return false;
  try {
    var base64Url = t.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    var p = JSON.parse(jsonPayload);
    return p.exp && p.exp * 1000 > Date.now();
  } catch(e){ return false; }
}

/* ---------- login flow ---------- */
function buildOtpBoxes(){
  var box = document.getElementById('otp-boxes');
  if (!box) return;
  box.textContent = '';
  for (var i = 0; i < 6; i++) {
    var inp = document.createElement('input');
    inp.className = 'otp-box';
    inp.type = 'tel'; inp.maxLength = 1; inp.inputMode = 'numeric';
    inp.setAttribute('data-i', i);
    inp.addEventListener('input', function(){
      this.value = this.value.replace(/\D/g, '');
      if (this.value && this.nextElementSibling) this.nextElementSibling.focus();
    });
    inp.addEventListener('keydown', function(ev){
      if (ev.key === 'Backspace' && !this.value && this.previousElementSibling) this.previousElementSibling.focus();
    });
    inp.addEventListener('paste', function(ev){
      var txt = (ev.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (txt.length >= 6) {
        ev.preventDefault();
        var boxes = document.querySelectorAll('.otp-box');
        for (var j = 0; j < 6; j++) {
          if (boxes[j]) boxes[j].value = txt[j] || '';
        }
        if (boxes[5]) boxes[5].focus();
      }
    });
    box.appendChild(inp);
  }
}

function otpValue(){
  return Array.from(document.querySelectorAll('.otp-box')).map(function(b){ return b.value; }).join('');
}

async function sendCode(){
  var email = document.getElementById('in-email').value.trim().toLowerCase();
  var err = document.getElementById('err-email');
  if (!err) return;
  err.textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Enter a valid email address'; return; }
  var btn = document.getElementById('btn-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    var r = await fetch(BACKEND + '/employee/request-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not send code');
    _loginEmail = email;
    document.getElementById('step-email').classList.add('hidden');
    document.getElementById('step-otp').classList.remove('hidden');
    document.getElementById('br-login-sub').textContent = 'Enter the 6-digit code sent to ' + email;
    buildOtpBoxes();
    var firstBox = document.querySelector('.otp-box');
    if (firstBox) firstBox.focus();
  } catch(e) { err.textContent = e.message; }
  if (btn) { btn.disabled = false; btn.textContent = 'Send Login Code'; }
}

async function verifyCode(){
  var err = document.getElementById('err-otp');
  if (!err) return;
  err.textContent = '';
  var code = otpValue();
  if (code.length !== 6) { err.textContent = 'Enter all 6 digits'; return; }
  var btn = document.getElementById('btn-verify');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
  try {
    var r = await fetch(BACKEND + '/employee/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: _loginEmail, code: code })
    });
    var d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || 'Verification failed');
    setToken(d.token); setEmp(d.employee);

    // Redirect to app.html if logging in from the index/login gateway
    var path = window.location.pathname;
    if (path.includes("index.html") || path.endsWith("/") || path.endsWith("/agwalk-staging")) {
      window.location.replace("app.html" + window.location.search);
    } else if (window.bootAppUnified) {
      await window.bootAppUnified();
    } else {
      location.reload();
    }
  } catch(e) { err.textContent = e.message; }
  if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
}

/* ---------- celebrate logic ---------- */
function formatCelebDateTime(isoStr) {
  if (!isoStr) return '';
  var dt = new Date(isoStr);
  if (isNaN(dt.getTime())) return '';
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];
  var hr = dt.getHours();
  var ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12;
  hr = hr ? hr : 12;
  var min = dt.getMinutes();
  min = min < 10 ? '0' + min : min;
  return mo + ' ' + dt.getDate() + ', ' + dt.getFullYear() + ' at ' + hr + ':' + min + ' ' + ampm;
}
function getGlassmorphicAvatarStyle(name) {
  var colors = [
    { r: 232, g: 98, b: 42, r2: 252, g2: 97, b2: 0 },    // Orange
    { r: 79, g: 70, b: 229, r2: 124, g2: 58, b2: 237 },  // Indigo/Purple
    { r: 13, g: 148, b: 136, r2: 20, g2: 184, b2: 166 }, // Teal
    { r: 219, g: 39, b: 119, r2: 236, g2: 72, b2: 153 }, // Pink
    { r: 37, g: 99, b: 235, r2: 96, g2: 165, b2: 250 }   // Blue
  ];
  var hash = 0;
  var str = name || '';
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var index = Math.abs(hash) % colors.length;
  var c = colors[index];
  var bg = 'linear-gradient(135deg, rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.35) 0%, rgba(' + c.r2 + ',' + c.g2 + ',' + c.b2 + ',0.15) 100%)';
  var border = '1px solid rgba(255,255,255,0.18)';
  var shadow = 'inset 0 1px 1px rgba(255,255,255,0.25), 0 4px 15px rgba(0,0,0,0.25)';
  return 'background:' + bg + '; border:' + border + '; color:#ffffff; box-shadow:' + shadow + '; backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); text-shadow:0 1px 2px rgba(0,0,0,0.3); font-weight:800; text-transform:uppercase;';
}
var TYPE_META = { birthday: ['🎂','#F59E0B'], anniversary: ['🎉','#8B5CF6'], custom: ['📣','#E8622A'], welcome: ['👋','#22C55E'], announcement: ['📢','#3B82F6'] };
var EMOJIS = ['🎉','❤️','👏'];

async function loadCelebrate(){
  var box = document.getElementById('celebrate-feed');
  if (!box) return;

  var greetEl = document.getElementById('celebrate-greeting');
  if (greetEl) {
    var userName = '';
    var emp = getEmp();
    try {
      var s = JSON.parse(safeGetItem('wk_user') || '{}');
      if (s && s.loggedIn && s.name) {
        userName = s.name;
      }
    } catch(e){}
    if (!userName && emp) {
      userName = emp.full_name;
    }
    var hr = new Date().getHours();
    var greet = 'Hello';
    if (hr < 12) greet = 'Good Morning';
    else if (hr < 17) greet = 'Good Afternoon';
    else greet = 'Good Evening';
    greetEl.textContent = greet + (userName ? ', ' + userName.split(' ')[0] : '') + ' 👋';
  }

  try {
    var r = await fetch(BACKEND + '/celebrate/feed', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (r.status === 401) { clearSession(); location.reload(); return; }
    var d = await r.json();
    box.textContent = '';
    if (!d.items || !d.items.length) {
      box.innerHTML = '<div class="placeholder"><div class="big">🎉</div>No celebrations yet.<br>Be the first to share one!</div>';
      return;
    }
    
    // Today strip
    var todayStr = new Date(Date.now() + 5.5*3600*1000).toISOString().split('T')[0];
    var todays = d.items.filter(function(c){
      return c.celebrate_date === todayStr && ['birthday','anniversary','welcome'].indexOf(c.type) > -1;
    });
    if (todays.length) {
      var stripWrap = document.createElement('div');
      stripWrap.style.cssText = 'margin-bottom:16px;';
      var sh = document.createElement('div');
      sh.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--label);margin-bottom:10px;';
      sh.textContent = "🎉 Today's Celebrations";
      stripWrap.appendChild(sh);
      var strip = document.createElement('div');
      strip.style.cssText = 'display:flex;gap:14px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:none;';
      todays.forEach(function(c){
        var it = document.createElement('div');
        it.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;flex-shrink:0;cursor:pointer;width:64px;';
        var av = document.createElement('div');
        av.className = 'grad-avatar';
        av.style.cssText += 'width:54px;height:54px;font-size:17px;position:relative;';
        if (c.employee && c.employee.photo_url) { var im = document.createElement('img'); im.src = c.employee.photo_url; av.appendChild(im); }
        else {
          av.textContent = initials(c.employee && c.employee.full_name);
          av.setAttribute('style', getGlassmorphicAvatarStyle(c.employee && c.employee.full_name) + '; width:54px; height:54px; border-radius:50%; font-size:17px; font-weight:800; display:flex; align-items:center; justify-content:center; position:relative;');
        }
        var badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;bottom:-3px;right:-3px;font-size:15px;';
        badge.textContent = (TYPE_META[c.type]||['🎉'])[0];
        av.appendChild(badge);
        var nm = document.createElement('div');
        nm.style.cssText = 'font-size:10.5px;font-weight:600;color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;';
        nm.textContent = ((c.employee && c.employee.full_name) || '').split(' ')[0];
        it.appendChild(av); it.appendChild(nm);
        it.addEventListener('click', function(){
          var target = document.querySelector('[data-celeb-id="' + c.id + '"]');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        strip.appendChild(it);
      });
      stripWrap.appendChild(strip);
      box.appendChild(stripWrap);
    }
    d.items.forEach(function(c){ box.appendChild(buildCelebCard(c)); });
  } catch(e) {
    box.innerHTML = '<div class="placeholder">Could not load the feed. Pull to retry.</div>';
  }
}

function buildCelebCard(c){
  var meta = TYPE_META[c.type] || TYPE_META.custom;
  var card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('data-celeb-id', c.id);
  card.style.borderLeft = '4px solid ' + meta[1];
  card.style.padding = '16px';
  card.style.marginBottom = '16px';
  if (c.type === 'announcement') card.style.background = 'linear-gradient(135deg, rgba(59,130,246,0.10) 0%, var(--surface) 45%)';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:11px;';
  var av = document.createElement('div');
  av.className = 'grad-avatar';
  av.style.cssText = 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;overflow:hidden;flex-shrink:0;';
  if (c.employee && c.employee.photo_url) { var im = document.createElement('img'); im.src = c.employee.photo_url; im.style.cssText='width:100%;height:100%;object-fit:cover'; av.appendChild(im); }
  else {
    var celebEmpName = (c.employee && c.employee.full_name) || (c.title && c.title.split("'")[0]) || 'Announce';
    av.textContent = initials(celebEmpName);
    av.setAttribute('style', getGlassmorphicAvatarStyle(celebEmpName) + '; width:42px; height:42px; border-radius:50%; font-size:19px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden;');
  }
  var ht = document.createElement('div');
  var t1 = document.createElement('div'); t1.style.cssText = 'font-size:14.5px;font-weight:600;line-height:1.35;'; t1.textContent = c.title;
  var t2 = document.createElement('div'); t2.style.cssText = 'font-size:11.5px;color:var(--label);margin-top:2px;';
  var timeString = formatCelebDateTime(c.created_at || c.celebrate_date);
  var empName = c.employee ? c.employee.full_name : '';
  var dept = c.employee && c.employee.department ? c.employee.department : '';
  if (c.type === 'custom' || c.type === 'announcement') {
    t2.textContent = 'By ' + (empName || 'Anonymous') + (dept ? ' (' + dept + ')' : '') + ' · ' + timeString;
  } else {
    t2.textContent = (empName ? 'Employee: ' + empName + (dept ? ' · ' : '') : '') + (dept ? 'Dept: ' + dept + ' · ' : '') + timeString;
  }
  ht.appendChild(t1); ht.appendChild(t2);
  head.appendChild(av); head.appendChild(ht);
  card.appendChild(head);

  if (c.message) {
    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:13.5px;color:var(--muted);margin-top:10px;line-height:1.5;';
    msg.textContent = c.message;
    card.appendChild(msg);
  }
  var mediaArr = Array.isArray(c.media) ? c.media : [];
  if (mediaArr.length) {
    var mg = document.createElement('div');
    mg.style.cssText = 'display:grid;grid-template-columns:' + (mediaArr.length > 1 ? '1fr 1fr' : '1fr') + ';gap:6px;margin-top:10px;';
    mediaArr.forEach(function(u){
      var im = document.createElement('img');
      im.src = u; im.loading = 'lazy';
      im.style.cssText = 'width:100%;border-radius:10px;max-height:280px;object-fit:cover;cursor:pointer;';
      im.addEventListener('click', function(){ window.open(u, '_blank'); });
      mg.appendChild(im);
    });
    card.appendChild(mg);
  }

  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px;';
  EMOJIS.forEach(function(em){
    var b = document.createElement('button');
    var count = (c.reactions && c.reactions[em]) || 0;
    var mine = (c.my_reactions || []).indexOf(em) > -1;
    b.style.cssText = 'padding:6px 12px;border-radius:20px;border:1px solid ' + (mine ? 'var(--brand)' : 'var(--border)') + ';background:' + (mine ? 'rgba(232,98,42,.12)' : 'transparent') + ';color:#fff;font-family:inherit;font-size:13px;cursor:pointer;';
    b.textContent = em + (count ? ' ' + count : '');
    b.addEventListener('click', async function(){
      try {
        var rr = await fetch(BACKEND + '/celebrate/react', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getToken() }, body: JSON.stringify({ celebration_id: c.id, emoji: em }) });
        var dd = await rr.json();
        if (dd.success) {
          c.reactions = c.reactions || {};
          c.my_reactions = c.my_reactions || [];
          if (dd.reacted) { c.reactions[em] = (c.reactions[em]||0)+1; c.my_reactions.push(em); }
          else { c.reactions[em] = Math.max(0,(c.reactions[em]||1)-1); c.my_reactions = c.my_reactions.filter(function(x){return x!==em;}); }
          var nc = (c.reactions[em]||0);
          b.textContent = em + (nc ? ' ' + nc : '');
          var m2 = c.my_reactions.indexOf(em) > -1;
          b.style.borderColor = m2 ? 'var(--brand)' : 'var(--border)';
          b.style.background = m2 ? 'rgba(232,98,42,.12)' : 'transparent';
        }
      } catch(e){}
    });
    bar.appendChild(b);
  });

  var wb = document.createElement('button');
  wb.style.cssText = 'margin-left:auto;padding:6px 12px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:inherit;font-size:12.5px;cursor:pointer;';
  wb.textContent = '💬 ' + (c.wish_count || 0);

  var wsec = document.createElement('div');
  wsec.style.cssText = 'display:block;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);';
  var wlist = document.createElement('div');
  wlist.style.cssText = 'max-height:260px;overflow-y:auto;';
  var drawWishes = function(){
    wlist.textContent = '';
    (c.wishes || []).forEach(function(w){
      var wrow = document.createElement('div');
      wrow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
      var wav = document.createElement('div');
      wav.className = 'grad-avatar';
      wav.style.cssText = 'width:28px;height:28px;font-size:10px;';
      var wEmpName = (w.employee && w.employee.full_name) || 'Anonymous';
      if (w.employee && w.employee.photo_url) { var wim=document.createElement('img'); wim.src=w.employee.photo_url; wav.appendChild(wim); }
      else {
        wav.textContent = initials(wEmpName);
        wav.setAttribute('style', getGlassmorphicAvatarStyle(wEmpName) + '; width:28px; height:28px; border-radius:50%; font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center;');
      }
      var wright = document.createElement('div');
      wright.style.cssText = 'flex:1;min-width:0;';
      var wnm = document.createElement('div');
      wnm.style.cssText = 'font-size:11.5px;font-weight:700;color:var(--brand-soft);';
      wnm.textContent = wEmpName;
      var wmsg = document.createElement('div');
      wmsg.style.cssText = 'font-size:12.5px;color:rgba(255,255,255,.85);margin-top:2px;line-height:1.45;';
      wmsg.textContent = w.message;
      wright.appendChild(wnm); wright.appendChild(wmsg);
      if (w.media_url) {
        var wimg = document.createElement('img'); wimg.src = w.media_url;
        wimg.style.cssText = 'display:block;max-width:180px;border-radius:10px;margin-top:6px;cursor:pointer;';
        wimg.addEventListener('click', function(){ window.open(w.media_url, '_blank'); });
        wright.appendChild(wimg);
      }
      wrow.appendChild(wav); wrow.appendChild(wright);
      wlist.appendChild(wrow);
    });
  };
  drawWishes();

  wb.addEventListener('click', function(){
    var isHidden = wsec.style.display === 'none';
    wsec.style.display = isHidden ? 'block' : 'none';
    if (isHidden) { drawWishes(); }
  });
  var wrow = document.createElement('div');
  wrow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
  var winp = document.createElement('input');
  winp.placeholder = 'Write a comment/wish…';
  winp.style.cssText = 'flex:1;padding:10px 13px;background:var(--surface);border:1px solid var(--border);border-radius:11px;color:#fff;font-family:inherit;font-size:13.5px;min-width:0;';
  var wsend = document.createElement('button');
  wsend.style.cssText = 'width:36px;height:36px;background:none;border:none;color:var(--brand);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;';
  wsend.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  var wcam = document.createElement('button');
  wcam.style.cssText = 'padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:11px;font-size:15px;cursor:pointer;';
  wcam.textContent = '📷';
  var wfile = document.createElement('input');
  wfile.type = 'file'; wfile.accept = 'image/*'; wfile.style.display = 'none';
  wcam.addEventListener('click', function(){ wfile.click(); });
  var _wishPhotoUrl = '';
  wfile.addEventListener('change', async function(){
    var f = (this.files || [])[0]; if (!f) return;
    wcam.disabled = true; wcam.textContent = '⏳';
    try { _wishPhotoUrl = await uploadPhoto(f); wcam.textContent = '✔️'; wcam.style.borderColor = 'var(--brand)'; }
    catch(e){ wcam.textContent = '📷'; alert(e.message); }
    wcam.disabled = false;
  });
  wsend.addEventListener('click', async function(){
    var txt = winp.value.trim();
    if (!txt && !_wishPhotoUrl) return;
    wsend.disabled = true; winp.disabled = true;
    try {
      var r = await fetch(BACKEND + '/celebrate/wish', {
        method: 'POST', headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ celebration_id: c.id, message: txt, media_url: _wishPhotoUrl })
      });
      var d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed');
      c.wishes = c.wishes || [];
      c.wishes.unshift({ created_at: new Date().toISOString(), message: txt, media_url: _wishPhotoUrl, employee: getEmp() });
      c.wish_count = (c.wish_count || 0) + 1;
      wb.textContent = '💬 ' + c.wish_count;
      winp.value = ''; _wishPhotoUrl = ''; wcam.textContent = '📷'; wcam.style.borderColor = 'var(--border)';
      drawWishes();
    } catch(e){ alert(e.message); }
    wsend.disabled = false; winp.disabled = false;
  });
  winp.addEventListener('keydown', function(e){ if (e.key === 'Enter') wsend.click(); });

  wrow.appendChild(wcam); wrow.appendChild(wfile); wrow.appendChild(winp); wrow.appendChild(wsend);
  wsec.appendChild(wlist); wsec.appendChild(wrow);

  bar.appendChild(wb);
  card.appendChild(bar);
  card.appendChild(wsec);
  return card;
}

/* ---------- photo compression + upload ---------- */
function compressImage(file){
  return new Promise(function(resolve, reject){
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function(){
      URL.revokeObjectURL(url);
      var MAX = 1600;
      var w = img.width, h = img.height;
      if (w > MAX || h > MAX) { var s = MAX / Math.max(w, h); w = Math.round(w*s); h = Math.round(h*s); }
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

async function uploadPhoto(file){
  var dataUrl = await compressImage(file);
  var r = await fetch(BACKEND + '/celebrate/upload', {
    method: 'POST', headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ data: dataUrl })
  });
  var d = await r.json();
  if (!d.success) throw new Error(d.error || 'Upload failed');
  return d.url;
}

function showProfileToast(msg) {
  var t = document.getElementById('profile-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'profile-toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;font-size:12.5px;font-weight:600;padding:8px 16px;border-radius:20px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.25);border:1px solid var(--border);transition:opacity 0.2s, transform 0.2s;opacity:0;transform:translate(-50%, 10px);';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translate(-50%, 0)';
  setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, 10px)';
  }, 2000);
}

/* ---------- init employee listeners ---------- */
function initEmployeeModeListeners() {
  var btnNewPost = document.getElementById('btn-new-post');
  if (btnNewPost) {
    btnNewPost.addEventListener('click', function(){
      var drawer = document.getElementById('post-drawer');
      if (drawer) drawer.classList.remove('hidden');
    });
  }
  var postClose = document.getElementById('post-close');
  if (postClose) {
    postClose.addEventListener('click', function(){
      var drawer = document.getElementById('post-drawer');
      if (drawer) drawer.classList.add('hidden');
    });
  }
  var postDrawer = document.getElementById('post-drawer');
  if (postDrawer) {
    postDrawer.addEventListener('click', function(e){
      if (e.target === this) this.classList.add('hidden');
    });
  }
  var postPhotoBtn = document.getElementById('post-photo-btn');
  if (postPhotoBtn) {
    postPhotoBtn.addEventListener('click', function(){
      var file = document.getElementById('post-photo-file');
      if (file) file.click();
    });
  }
  var postPhotoFile = document.getElementById('post-photo-file');
  if (postPhotoFile) {
    postPhotoFile.addEventListener('change', async function(){
      var files = Array.from(this.files || []).slice(0, 4 - _postPhotos.length);
      this.value = '';
      var btn = document.getElementById('post-photo-btn');
      for (var i = 0; i < files.length; i++) {
        if (btn) btn.textContent = '⏳ Uploading…';
        try {
          var url = await uploadPhoto(files[i]);
          _postPhotos.push(url);
          var pv = document.createElement('img');
          pv.src = url;
          pv.style.cssText = 'width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;';
          pv.title = 'Tap to remove';
          pv.addEventListener('click', function(){
            var that = this;
            _postPhotos = _postPhotos.filter(function(u){ return u !== that.src; });
            that.remove();
          }.bind(pv));
          var previews = document.getElementById('post-photo-previews');
          if (previews) previews.appendChild(pv);
        } catch(e){ alert(e.message); }
      }
      if (btn) btn.textContent = '📷 Add photos';
    });
  }
  var postSubmit = document.getElementById('post-submit');
  if (postSubmit) {
    postSubmit.addEventListener('click', async function(){
      var title = document.getElementById('post-title').value.trim();
      var msg = document.getElementById('post-msg').value.trim();
      var err = document.getElementById('post-err');
      if (err) err.textContent = '';
      if (!title) { if (err) err.textContent = 'Please give it a title'; return; }
      this.disabled = true; this.style.opacity = '.5';
      try {
        var r = await fetch(BACKEND + '/celebrate/post', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getToken() },
          body: JSON.stringify({ title: title, message: msg, media: _postPhotos })
        });
        var d = await r.json();
        if (!d.success) throw new Error(d.error || 'Failed');
        var drawer = document.getElementById('post-drawer');
        if (drawer) drawer.classList.add('hidden');
        document.getElementById('post-title').value = '';
        document.getElementById('post-msg').value = '';
        _postPhotos = [];
        var previews = document.getElementById('post-photo-previews');
        if (previews) previews.textContent = '';
        if (d.status === 'pending') {
          alert('Submitted! Your post will appear after admin approval. 🎉');
        } else {
          loadCelebrate();
        }
      } catch(e) { if (err) err.textContent = e.message; }
      this.disabled = false; this.style.opacity = '1';
    });
  }
}

async function loadBranding() {
  var lEl = document.getElementById('login-logo-img');
  var aEl = document.getElementById('app-logo');
  var appNameEl = document.getElementById('br-app-name');
  try {
    var r = await fetch(BACKEND + '/branding');
    var d = await r.json();
    if (d && d.success && d.branding) {
      var b = d.branding;
      if (b.login_title) {
        var tEl = document.getElementById('br-login-title');
        if (tEl) tEl.textContent = b.login_title;
      }
      if (b.tagline) {
        var sEl = document.getElementById('br-login-sub');
        if (sEl) sEl.textContent = b.tagline;
      }
      
      var logoSrc = b.logo_url || 'logo-white.png';
      if (lEl) {
        lEl.onerror = function() {
          this.parentNode.innerHTML = '<div class="fallback">🏆</div>';
        };
        lEl.src = logoSrc;
        lEl.style.opacity = '1';
      }
      if (aEl) {
        aEl.onerror = function() {
          this.src = 'logo-white.png';
        };
        aEl.src = logoSrc;
      }

      if (b.app_name) {
        document.title = b.app_name + ' — Dashboard';
        if (appNameEl) {
          appNameEl.textContent = b.app_name;
          appNameEl.style.opacity = '1';
        }
      }

      // Inject custom accent color style overrides if set
      if (b.accent_color) {
        var styleEl = document.createElement('style');
        styleEl.id = 'dynamic-branding-style';
        
        // Helper to convert hex to rgba for shadow opacity
        var hexToRgba = function(hex, alpha) {
          var c = hex.replace('#', '');
          if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
          var rVal = parseInt(c.substring(0, 2), 16);
          var gVal = parseInt(c.substring(2, 4), 16);
          var bVal = parseInt(c.substring(4, 6), 16);
          return 'rgba(' + rVal + ',' + gVal + ',' + bVal + ',' + alpha + ')';
        };
        
        styleEl.textContent = `
          .login-btn {
            background: ${b.accent_color} !important;
            box-shadow: 0 4px 20px ${hexToRgba(b.accent_color, 0.28)} !important;
          }
          .login-btn:hover {
            opacity: 0.95;
          }
          .login-link, .login-terms a {
            color: ${b.accent_color} !important;
          }
          #br-app-name {
            color: ${b.accent_color} !important;
          }
          input.login-field:focus {
            border-color: ${b.accent_color} !important;
          }
        `;
        var oldStyle = document.getElementById('dynamic-branding-style');
        if (oldStyle) oldStyle.remove();
        document.head.appendChild(styleEl);
      }
    } else {
      if (lEl) {
        lEl.onerror = function() {
          this.parentNode.innerHTML = '<div class="fallback">🏆</div>';
        };
        lEl.src = 'logo-white.png';
        lEl.style.opacity = '1';
      }
      if (appNameEl) {
        appNameEl.textContent = 'Arcgate';
        appNameEl.style.opacity = '1';
      }
    }
  } catch (e) {
    console.warn('Failed to load branding:', e);
    if (lEl) {
      lEl.onerror = function() {
        this.parentNode.innerHTML = '<div class="fallback">🏆</div>';
      };
      lEl.src = 'logo-white.png';
      lEl.style.opacity = '1';
    }
    if (appNameEl) {
      appNameEl.textContent = 'Arcgate';
      appNameEl.style.opacity = '1';
    }
  }
}
