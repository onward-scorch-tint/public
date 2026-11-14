self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', () => {}); // Resets Firefox's 30s SW kill timer

const PARTS = Array.from({ length: 8 }, (_, i) =>
  `https://gh.nexa.workers.dev/xecured/files/releases/download/arch-iso-512/pop-os_24.04_amd64_nvidia_25.iso.part${i + 1}`
);

self.addEventListener('fetch', (event) => {
  if (!new URL(event.request.url).pathname.endsWith('/download-iso')) return;

  let i = 0;
  let reader = null;

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!reader) {
          if (i >= PARTS.length) return controller.close();
          const res = await fetch(PARTS[i++]);
          if (!res.ok) return controller.error(new Error(`HTTP ${res.status}`));
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        controller.enqueue(value);
        return;
      }
    },
    cancel() {
      if (reader) reader.cancel();
    },
  });

  event.respondWith(
    new Response(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="pop-os_24.04_amd64_nvidia_25.iso"',
      },
    })
  );
});
