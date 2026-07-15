// app-employee.js
// Handles non-participant employee specific logic, login flows, and native Celebrate tab loaders.

function openImageLightbox(url) {
  var existing = document.getElementById('img-lightbox-overlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'img-lightbox-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;';
  var img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:8px;object-fit:contain;cursor:default;';
  img.addEventListener('click', function(e){ e.stopPropagation(); });
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'position:absolute;top:16px;right:20px;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:28px;width:40px;height:40px;border-radius:50%;cursor:pointer;line-height:1;';
  function closeLightbox(){ overlay.remove(); document.removeEventListener('keydown', escHandler); }
  function escHandler(e){ if (e.key === 'Escape') closeLightbox(); }
  closeBtn.addEventListener('click', function(e){ e.stopPropagation(); closeLightbox(); });
  overlay.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', escHandler);
  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}
window.openImageLightbox = openImageLightbox;

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
    var pad = base64.length % 4;
    if (pad) {
      if (pad === 1) return false;
      base64 += new Array(5 - pad).join('=');
    }
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
      var qs = window.location.search ? window.location.search : "";
      var separator = qs ? (qs.indexOf('?') !== -1 ? '&' : '?') : '?';
      window.location.replace("app.html" + qs + separator + "_cb=" + Date.now());
    } else if (window.bootAppUnified) {
      await window.bootAppUnified();
    } else {
      location.reload();
    }
  } catch(e) { err.textContent = e.message; }
  if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
}

function formatRichText(text) {
  if (!text) return '';
  var esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  
  // Convert URLs to clickable links
  var urlRegex = /(\bhttps?:\/\/[^\s<]+)/gi;
  esc = esc.replace(urlRegex, function(url) {
    var trailing = '';
    var match;
    while ((match = url.match(/(&(?:amp|lt|gt|quot|apos|#39);|[.,!?;:])$/i))) {
      trailing = match[1] + trailing;
      url = url.substring(0, url.length - match[1].length);
    }
    var cleanUrl = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return '<a href="' + cleanUrl + '" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline;">' + url + '</a>' + trailing;
  });

  // Convert bold formatting: **text** to <strong>text</strong>
  esc = esc.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert italic formatting: *text* to <em>text</em>
  esc = esc.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Convert line breaks: \n to <br>
  esc = esc.replace(/\n/g, '<br>');
  
  return esc;
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
  return 'background: linear-gradient(135deg, ' + g.c1 + ' 0%, ' + g.c2 + ' 100%); color: #0f172a; border: none; font-weight: 700; font-family: var(--font); text-shadow: none; text-transform: uppercase;';
}
var TYPE_META = { birthday: ['🎂','#F59E0B'], anniversary: ['🎉','#8B5CF6'], custom: ['📣','#E8622A'], welcome: ['👋','#22C55E'], announcement: ['📢','#3B82F6'], medal: ['🏅','#F4A84A'] };
var EMOJIS = ['🎉','❤️','👏'];

// Occasion card cover + message treatment (welcome/birthday/anniversary only)
var OCCASION_MESSAGE_POOL = {
  welcome: [
    "The whole team is excited to have you on board. Wishing you a smooth start, great people to work with, and a journey full of growth here at Arcgate!",
    "A warm welcome to the team! We're glad you're here and can't wait to see all the great things you'll accomplish with us.",
    "Welcome to Arcgate! Here's to new beginnings, new friendships, and an exciting journey ahead.",
    "So happy to have you join us. May your time here be filled with learning, growth, and great memories!"
  ],
  birthday: [
    "Another year, another chance to celebrate everything that makes you awesome. Hope your day is filled with cake, laughter, and all your favourite things!",
    "Wishing you a year filled with happiness, good health, and amazing memories. Have a wonderful birthday!",
    "Cheers to another trip around the sun! May this year bring you closer to everything you're working towards.",
    "Hope your special day is as wonderful as you are. Enjoy every moment of it!"
  ],
  anniversary: [
    "Another milestone in a journey full of hard work and great contributions. Thank you for everything you bring to the team — here's to many more years together!",
    "Celebrating your journey with us today! Your dedication and hard work don't go unnoticed. Congratulations!",
    "Here's to another year of great teamwork and shared success. Thank you for being part of the Arcgate story!",
    "Your commitment over the years has made a real difference. Congratulations on this milestone!"
  ]
};
var OCCASION_COVER_ICONS = {
  welcome: ['🤝','✨','🎊','✨','🎉'],
  birthday: ['🎈','🎉','🎂','🎈','🎁'],
  anniversary: ['🏆','⭐','🎖️','🎊','✨']
};
var OCCASION_COVER_GRADIENT = {
  welcome: 'linear-gradient(135deg,#16A34A,#22C55E 60%,#4ADE80)',
  birthday: 'linear-gradient(135deg,#D97706,#F59E0B 60%,#FBBF24)',
  anniversary: 'linear-gradient(135deg,#6D28D9,#8B5CF6 60%,#A78BFA)'
};
var OCCASION_NAME_COLOR = { welcome:'#4ADE80', birthday:'#FBBF24', anniversary:'#A78BFA' };

function pickDeterministic(arr, seed) {
  var s = String(seed || '');
  var hash = 0;
  for (var i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
  return arr[Math.abs(hash) % arr.length];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(ch){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
  });
}

async function loadCelebrate(){
  var box = document.getElementById('celebrate-feed');
  if (!box) return;

  var btnNewPost = document.getElementById('btn-new-post');
  if (btnNewPost) {
    btnNewPost.style.display = getToken() ? 'block' : 'none';
  }

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
      return c.celebrate_date === todayStr && ['birthday','anniversary','welcome','medal'].indexOf(c.type) > -1;
    });
    if (todays.length) {
      var stripWrap = document.createElement('div');
      stripWrap.className = 'tcs-wrap';
      var sh = document.createElement('div');
      sh.className = 'tcs-head';
      sh.textContent = "🎉 Today's Celebrations";
      stripWrap.appendChild(sh);
      var strip = document.createElement('div');
      strip.className = 'tcs-scroll';
      var CTA_LABEL = { birthday: 'Send wishes', anniversary: 'Congratulate', welcome: 'Say hello', custom: 'Cheer', announcement: 'View', medal: 'Cheer' };
      var SUB_LABEL = function(c){
        if (c.type === 'birthday') return 'Birthday today';
        if (c.type === 'anniversary') return (c.title || 'Work anniversary');
        if (c.type === 'welcome') return 'New at Arcgate';
        return c.title || 'Celebration';
      };
      todays.forEach(function(c){
        var empName = (c.employee && c.employee.full_name) || '';
        var card = document.createElement('div');
        card.className = 'tcc-card';

        var av = document.createElement('div');
        av.className = 'tcc-av';
        if (c.employee && c.employee.photo_url) {
          var im = document.createElement('img'); im.src = c.employee.photo_url; av.appendChild(im);
        } else {
          av.textContent = initials(empName);
          av.style.cssText = getGlassmorphicAvatarStyle(empName) + ';width:44px;height:44px;border-radius:50%;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;position:relative;';
        }
        var badge = document.createElement('div');
        badge.className = 'tcc-badge';
        badge.textContent = (TYPE_META[c.type]||['🎉'])[0];
        av.appendChild(badge);

        var nm = document.createElement('div');
        nm.className = 'tcc-name';
        nm.textContent = empName.split(' ')[0] + (empName.split(' ')[1] ? ' ' + empName.split(' ')[1][0] + '.' : '');

        var sub = document.createElement('div');
        sub.className = 'tcc-sub';
        sub.textContent = SUB_LABEL(c);

        var btn = document.createElement('button');
        btn.className = 'tcc-btn';
        btn.textContent = CTA_LABEL[c.type] || 'View';
        btn.addEventListener('click', function(){
          var target = document.querySelector('[data-celeb-id="' + c.id + '"]');
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function(){
              var input = target.querySelector('input[placeholder]');
              if (input) input.focus();
            }, 350);
          }
        });

        card.appendChild(av); card.appendChild(nm); card.appendChild(sub); card.appendChild(btn);
        strip.appendChild(card);
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
  card.style.padding = '0';
  card.style.marginBottom = '16px';
  card.style.overflow = 'hidden';

  var isOccasion = ['welcome','birthday','anniversary'].indexOf(c.type) > -1;

  if (isOccasion) {
    var empNameOcc = (c.employee && c.employee.full_name) || '';
    var nameColor = OCCASION_NAME_COLOR[c.type];
    var typeLabel = { birthday: 'BIRTHDAY', anniversary: 'ANNIVERSARY', welcome: 'WELCOME' }[c.type] || c.type.toUpperCase();
    var subLabel = { birthday: 'Birthday · today', welcome: 'New joiner · today' }[c.type] ||
      (c.type === 'anniversary' ? ((c.title && c.title.match(/\d+\s*(yr|year)/i) ? c.title.match(/\d+\s*(yr|year)s?/i)[0] : 'Work anniversary') + ' · today') : 'today');

    var bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'padding:16px;';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:11px;position:relative;';
    var av = document.createElement('div');
    av.className = 'grad-avatar';
    av.style.cssText = 'width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;overflow:hidden;flex-shrink:0;';
    if (c.employee && c.employee.photo_url) { var im = document.createElement('img'); im.src = c.employee.photo_url; im.style.cssText='width:100%;height:100%;object-fit:cover'; av.appendChild(im); }
    else {
      av.textContent = initials(empNameOcc);
      av.style.cssText += getGlassmorphicAvatarStyle(empNameOcc) + ';font-weight:800;';
    }
    var ht = document.createElement('div');
    ht.style.cssText = 'flex:1;min-width:0;';
    var nmEl = document.createElement('div');
    nmEl.style.cssText = 'font-size:14.5px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    nmEl.textContent = empNameOcc;
    var subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:11.5px;color:' + nameColor + ';margin-top:1px;';
    subEl.textContent = subLabel;
    ht.appendChild(nmEl); ht.appendChild(subEl);
    var pill = document.createElement('div');
    pill.style.cssText = 'flex-shrink:0;background:rgba(255,255,255,0.06);color:' + nameColor + ';border:1px solid ' + nameColor + '33;font-size:9.5px;font-weight:800;letter-spacing:0.8px;padding:4px 10px;border-radius:99px;';
    pill.textContent = typeLabel;
    head.appendChild(av); head.appendChild(ht); head.appendChild(pill);
    bodyWrap.appendChild(head);

    var hasRealMsg = !!(c.message && c.message.trim());
    var msgEl = document.createElement('div');
    if (hasRealMsg) {
      msgEl.style.cssText = 'font-size:14px;color:' + nameColor + ';margin-top:12px;line-height:1.6;';
      msgEl.innerHTML = formatRichText(c.message);
    } else {
      var quoteMsg = pickDeterministic(OCCASION_MESSAGE_POOL[c.type], c.id || empNameOcc);
      msgEl.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.85);margin-top:12px;line-height:1.6;font-style:italic;';
      msgEl.innerHTML = '<span style="font-size:22px;font-weight:800;font-style:normal;line-height:0;vertical-align:-6px;margin-right:2px;opacity:0.8;color:' + nameColor + ';">&ldquo;</span>' +
        escapeHtml(quoteMsg) +
        '<span style="font-size:22px;font-weight:800;font-style:normal;line-height:0;vertical-align:-6px;margin-left:2px;opacity:0.8;color:' + nameColor + ';">&rdquo;</span>';
    }
    bodyWrap.appendChild(msgEl);

    var mediaArrOcc = Array.isArray(c.media) ? c.media : [];
    if (!mediaArrOcc.length) {
      var illo = document.createElement('div');
      var illoIcons = OCCASION_COVER_ICONS[c.type] || ['🎉'];
      illo.style.cssText = 'margin-top:12px;height:120px;border-radius:12px;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;gap:14px;font-size:38px;';
      illo.innerHTML = '<span>' + (illoIcons[2] || illoIcons[0]) + '</span><span>' + (illoIcons[0] || '🎉') + '</span>';
      bodyWrap.appendChild(illo);
    }

    var t2 = document.createElement('div');
    t2.style.cssText = 'font-size:11px;color:var(--label);margin-top:10px;';
    var dept = c.employee && c.employee.department ? c.employee.department : '';
    var timeString = formatCelebDateTime(c.created_at || c.celebrate_date);
    t2.textContent = (dept ? dept + ' · ' : '') + timeString;
    bodyWrap.appendChild(t2);

    card.appendChild(bodyWrap);
  } else {
    card.style.padding = '16px';
    card.style.borderLeft = '4px solid ' + meta[1];
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
      msg.innerHTML = formatRichText(c.message);
      card.appendChild(msg);
    }
  }

  var mediaArr = Array.isArray(c.media) ? c.media : [];
  if (mediaArr.length) {
    var mg = document.createElement('div');
    mg.style.cssText = 'display:grid;grid-template-columns:' + (mediaArr.length > 1 ? '1fr 1fr' : '1fr') + ';gap:6px;margin-top:10px;' + (isOccasion ? 'padding:0 16px;' : '');
    mediaArr.forEach(function(u){
      var im = document.createElement('img');
      im.src = u; im.loading = 'lazy';
      im.style.cssText = 'width:100%;border-radius:10px;max-height:280px;object-fit:cover;cursor:pointer;';
      im.addEventListener('click', function(){ openImageLightbox(u); });
      mg.appendChild(im);
    });
    if (isOccasion) {
      var mgWrap = document.createElement('div');
      mgWrap.style.cssText = 'padding:0 16px 16px;';
      mgWrap.appendChild(mg);
      card.appendChild(mgWrap);
    } else {
      card.appendChild(mg);
    }
  }

  var innerPad = isOccasion ? document.createElement('div') : card;
  if (isOccasion) { innerPad.style.cssText = 'padding:0 16px 16px;'; card.appendChild(innerPad); }

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
      wmsg.innerHTML = formatRichText(w.message);
      wright.appendChild(wnm); wright.appendChild(wmsg);
      if (w.media_url) {
        var wimg = document.createElement('img'); wimg.src = w.media_url;
        wimg.style.cssText = 'display:block;max-width:180px;border-radius:10px;margin-top:6px;cursor:pointer;';
        wimg.addEventListener('click', function(){ openImageLightbox(w.media_url); });
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
  wcam.style.cssText = 'padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted);';
  wcam.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  var wfile = document.createElement('input');
  wfile.type = 'file'; wfile.accept = 'image/*'; wfile.style.display = 'none';
  wcam.addEventListener('click', function(){ wfile.click(); });
  var _wishPhotoUrl = '';
  wfile.addEventListener('change', async function(){
    var f = (this.files || [])[0]; if (!f) return;
    wcam.disabled = true; wcam.innerHTML = '⏳';
    try { _wishPhotoUrl = await uploadPhoto(f); wcam.innerHTML = '✔️'; wcam.style.borderColor = 'var(--brand)'; }
    catch(e){ wcam.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'; alert(e.message); }
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
      winp.value = ''; _wishPhotoUrl = ''; wcam.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'; wcam.style.borderColor = 'var(--border)';
      drawWishes();
    } catch(e){ alert(e.message); }
    wsend.disabled = false; winp.disabled = false;
  });
  winp.addEventListener('keydown', function(e){ if (e.key === 'Enter') wsend.click(); });

  wrow.appendChild(wcam); wrow.appendChild(wfile); wrow.appendChild(winp); wrow.appendChild(wsend);
  wsec.appendChild(wlist); wsec.appendChild(wrow);

  bar.appendChild(wb);
  innerPad.appendChild(bar);
  innerPad.appendChild(wsec);
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
        if (btn) btn.innerHTML = '<span style="font-size:12px;margin-right:4px;">⏳</span> Uploading…';
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
      if (btn) btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Add photos';
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

  // Check if we are in preview mode
  var isPreview = window.location.search.indexOf('preview=1') !== -1;
  if (isPreview) {
    try {
      var temp = localStorage.getItem('ag_branding_preview_temp');
      if (temp) {
        var b = JSON.parse(temp);
        applyBrandingDOM(b, lEl, aEl, appNameEl);
        return; // Intercept and do not load normal branding
      }
    } catch(e) {}
  }

  // 1. Try to load and render cached branding instantly
  try {
    var cached = localStorage.getItem('ag_branding_cache');
    if (cached) {
      var b = JSON.parse(cached);
      applyBrandingDOM(b, lEl, aEl, appNameEl);
    }
  } catch(e) {}

  // 2. Fetch fresh branding from the network in background
  try {
    var r = await fetch(BACKEND + '/branding');
    var d = await r.json();
    if (d && d.success && d.branding) {
      var b = d.branding;
      localStorage.setItem('ag_branding_cache', JSON.stringify(b));
      applyBrandingDOM(b, lEl, aEl, appNameEl);
    } else {
      applyDefaultBrandingDOM(lEl, appNameEl);
    }
  } catch (e) {
    console.warn('Failed to load branding:', e);
    applyDefaultBrandingDOM(lEl, appNameEl);
  }
}

function applyDefaultBrandingDOM(lEl, appNameEl) {
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

function applyBrandingDOM(b, lEl, aEl, appNameEl) {
  if (b.login_title) {
    var tEl = document.getElementById('br-login-title');
    if (tEl) {
      tEl.textContent = b.login_title;
      tEl.style.display = b.show_login_title !== false ? '' : 'none';
    }
  }
  if (b.tagline) {
    var sEl = document.getElementById('br-login-sub');
    if (sEl) {
      sEl.textContent = b.tagline;
      sEl.style.display = b.show_tagline !== false ? '' : 'none';
    }
  }
  
  var logoSrc = b.logo_url || 'logo-white.png';
  if (logoSrc !== 'logo-white.png') {
    var separator = logoSrc.indexOf('?') !== -1 ? '&' : '?';
    logoSrc = logoSrc + separator + 'cb=' + Date.now();
  }
  if (lEl) {
    lEl.onerror = function() {
      this.parentNode.innerHTML = '<div class="fallback">🏆</div>';
    };
    lEl.src = logoSrc;
    lEl.style.opacity = '1';
    lEl.style.filter = b.logo_filter === 'white' ? 'brightness(0) invert(1)' : (b.logo_filter === 'black' ? 'brightness(0)' : 'none');
  }


  if (b.app_name) {
    if (document.getElementById('login-logo-img')) {
      document.title = 'Sign In — ' + b.app_name;
    } else {
      document.title = b.app_name + ' — Dashboard';
    }
    if (appNameEl) {
      appNameEl.textContent = b.app_name;
      appNameEl.style.opacity = b.show_app_name !== false ? '1' : '0';
      appNameEl.style.display = b.show_app_name !== false ? '' : 'none';
    }
  }

  // Adjust Logo Position dynamically if present on login page
  var logoDiv = document.querySelector('.login-logo');
  var appNameDiv = document.getElementById('br-app-name');
  var titleDiv = document.getElementById('br-login-title');
  if (logoDiv && appNameDiv && titleDiv) {
    var pos = b.logo_position || 'top';
    if (b.show_logo === false) {
      logoDiv.style.display = 'none';
    } else if (pos === 'center') {
      appNameDiv.parentNode.insertBefore(logoDiv, titleDiv);
      logoDiv.style.display = 'block';
    } else if (pos === 'hidden') {
      logoDiv.style.display = 'none';
    } else { // top
      appNameDiv.parentNode.insertBefore(logoDiv, appNameDiv);
      logoDiv.style.display = 'block';
    }
  }

  if (b.font_family) {
    var loadGoogleFont = function(fontName) {
      if (!fontName) return;
      var linkId = 'gfont-' + fontName.replace(/\s+/g, '-').toLowerCase();
      if (!document.getElementById(linkId)) {
        var link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fontName) + ':wght@300;400;500;600;700;800;900&display=swap';
        document.head.appendChild(link);
      }
    };
    loadGoogleFont(b.font_family);
  }

  // Inject custom branding style overrides if set
  var styleEl = document.getElementById('dynamic-branding-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-branding-style';
    document.head.appendChild(styleEl);
  }
  
  var hexToRgba = function(hex, alpha) {
    if (!hex) return 'rgba(232,98,42,' + alpha + ')';
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var rVal = parseInt(c.substring(0, 2), 16);
    var gVal = parseInt(c.substring(2, 4), 16);
    var bVal = parseInt(c.substring(4, 6), 16);
    return 'rgba(' + rVal + ',' + gVal + ',' + bVal + ',' + alpha + ')';
  };
  
  var accentColor = b.accent_color || (typeof DEFAULT_BRAND_COLOR !== 'undefined' ? DEFAULT_BRAND_COLOR : '#E8622A');
  var loginAccentColor = b.login_accent_color || accentColor;
  styleEl.textContent = `
    body, input, button, select {
      font-family: "${b.font_family || 'Inter'}", sans-serif !important;
    }
    .login-btn {
      background: ${loginAccentColor} !important;
      border: 1px solid ${loginAccentColor} !important;
      box-shadow: 0 4px 20px ${hexToRgba(loginAccentColor, 0.28)} !important;
    }
    .login-btn:hover {
      opacity: 0.95;
    }
    .login-link, .login-terms a {
      color: ${loginAccentColor} !important;
    }
    #br-app-name {
      color: ${accentColor} !important;
    }
    input.login-field:focus {
      border-color: ${loginAccentColor} !important;
    }
    #br-login-title {
      font-size: ${b.title_size || 26}px !important;
      color: ${b.title_color || '#FFFFFF'} !important;
    }
    #br-login-sub {
      font-size: ${b.tagline_size || 14}px !important;
      color: ${b.tagline_color || '#9CA3AF'} !important;
    }
    .login-footnote {
      color: ${b.footnote_color || '#6B7280'} !important;
    }
    #login-logo-img {
      width: ${b.logo_width || 120}px !important;
      max-width: ${b.logo_width || 120}px !important;
    }
  `;
}
