// Arcgate Walkathon 2026 - Service Worker v4 (network-only, no cache)
var CACHE_NAME = 'agwalk-v4';

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
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'Arcgate Walkathon', body: event.data ? event.data.text() : '' }; }
  var title   = data.title || 'Arcgate Walkathon 2026';
  var options = {
    body:    data.body || '',
    icon:    '/agwalk/logo-icon.png',
    badge:   '/agwalk/logo-icon.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || 'https://agwalkathon.github.io/agwalk/participant.html' },
    actions: [{ action: 'open', title: 'View' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://agwalkathon.github.io/agwalk/participant.html';
  event.waitUntil(clients.openWindow(url));
});
