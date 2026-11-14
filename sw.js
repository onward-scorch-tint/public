self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const streams = new Map();

self.addEventListener('message', (e) => {
  if (e.data?.type === 'STREAM') {
    streams.set(e.data.id, e.data);
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.includes('/virtual-download/')) return;

  const entry = streams.get(url.searchParams.get('id'));
  if (!entry) {
    e.respondWith(new Response('Not found', { status: 404 }));
    return;
  }
  streams.delete(url.searchParams.get('id'));

  e.respondWith(
    new Response(entry.readable, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${entry.filename}"`,
      },
    })
  );
});
