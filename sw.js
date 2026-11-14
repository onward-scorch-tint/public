self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const pendingStreams = new Map();

// Receive the ReadableStream from index.html
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REGISTER_STREAM') {
    const { id, readable, filename, totalBytes } = event.data;
    pendingStreams.set(id, { readable, filename, totalBytes });
  }
});

// Hand that ReadableStream directly to Firefox's native Download Manager
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/virtual-download/')) {
    const id = url.searchParams.get('id');
    const entry = pendingStreams.get(id);

    if (!entry) {
      event.respondWith(new Response('Stream expired or not found.', { status: 404 }));
      return;
    }

    pendingStreams.delete(id);

    event.respondWith(
      new Response(entry.readable, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${entry.filename}"`,
          'Content-Length': String(entry.totalBytes),
          'Cache-Control': 'no-store',
        },
      })
    );
  }
});
