// Single source of truth for which backend server this deployment talks to.
// Auto-detects staging vs live from the page's own URL path, so this file's
// CONTENT is identical in both the agwalk and agwalk-staging repos -- nothing
// to remember to swap by hand during a staging -> live promotion anymore.
(function () {
  var isStaging = window.location.pathname.indexOf('agwalk-staging') > -1;
  window.BACKEND_URL = isStaging
    ? 'https://agwalk-backend.onrender.com'
    : 'https://walkathon-backend-hv9j.onrender.com';

  // Visible diagnostic: quick way to confirm which backend a page is actually
  // talking to, without having to open and search every file.
  console.log('[env-config] backend =', window.BACKEND_URL, '(' + (isStaging ? 'staging' : 'live') + ')');
})();
