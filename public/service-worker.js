self.addEventListener('push', function(e) {
  const data = e.data.json();
  const options = {
    body: data.body,
    icon: data.icon || '/logo.png',
    badge: '/logo.png',
  };
  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});
