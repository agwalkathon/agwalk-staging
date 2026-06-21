// Shared auth guard and nav helper
const _BACKEND_URL = 'https://walkathon-backend-hv9j.onrender.com';

function authGuard() {
  const token = sessionStorage.getItem('wk_admin_token');
  if (!token) { window.location.href = 'admin-login.html'; return; }
  // Verify token with backend — only redirect on definitive 401, never on network errors
  fetch(_BACKEND_URL + '/admin-verify', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    // Only act on a clear 401 — ignore 502/503/timeouts (Render cold start)
    if (r.status === 401) {
      return r.json().then(function(d) {
        sessionStorage.removeItem('wk_admin_token');
        window.location.href = 'admin-login.html';
      });
    }
    // Any other response (200, 502, 503) — stay on page
  }).catch(function() {
    // Network error or Render sleeping — keep session, don't kick out
  });
}
function logout() {
  sessionStorage.removeItem('wk_admin_token');
  sessionStorage.removeItem('wk_admin');
  window.location.href = 'admin-login.html';
}
const SUPABASE_URL  = 'https://jhdgkncpkrttvemvwukc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpoZGdrbmNwa3J0dHZlbXZ3dWtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzgyNjMsImV4cCI6MjA5NzI1NDI2M30.d7mvXOYDq5G4aqs1Mbc6HFNgTBlQk4B6ah0eahE_yZE';
const HDR = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true }); }
function fmtDuration(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; }
function fmtPaceSpeed(ms, type) {
  if (!ms) return '—';
  if (type==='Ride'||type==='VirtualRide') return (ms*3.6).toFixed(1)+' km/h';
  const p=1000/ms, min=Math.floor(p/60), sec=Math.round(p%60);
  return `${min}:${sec.toString().padStart(2,'0')} /km`;
}
function badgeClass(t) {
  if (t==='Walk') return 'badge-walk';
  if (t==='Run'||t==='VirtualRun') return 'badge-run';
  if (t==='Ride'||t==='VirtualRide') return 'badge-ride';
  return 'badge-hike';
}
