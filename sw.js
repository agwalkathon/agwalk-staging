// Arcgate Walkathon 2026 - Service Worker v5 (network-only, no cache)
var CACHE_NAME = 'agwalk-v5';

self.addEventListener('install', function(event) {
  // Delete all old caches and activate immediately
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Network only - never serve from cache
self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'Walkathon Alert', body: event.data ? event.data.text() : '' }; }
  var title   = data.title || 'Walkathon Alert';
  var options = {
    body:    data.body || '',
    icon:    '/agwalk-staging/logo-icon.png',
    badge:   '/agwalk-staging/logo-icon.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || 'https://agwalkathon.github.io/agwalk-staging/app.html' },
    actions: [{ action: 'open', title: 'View' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://agwalkathon.github.io/agwalk-staging/app.html';
  event.waitUntil(clients.openWindow(url));
});
