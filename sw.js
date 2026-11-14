self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const PARTS = Array.from({ length: 8 }, (_, i) =>
  `https://gh.nexa.workers.dev/xecured/files/releases/download/arch-iso-512/pop-os_24.04_amd64_nvidia_25.iso.part${i + 1}`
);
const FILENAME = 'pop-os_24.04_amd64_nvidia_25.iso';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith('/download-merged-iso')) return;

  let index = 0;
  let reader = null;

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!reader) {
          if (index >= PARTS.length) {
            controller.close();
            return;
          }
          const res = await fetch(PARTS[index++]);
          if (!res.ok) {
            controller.error(new Error(`Part ${index} failed: ${res.status}`));
            return;
          }
          reader = res.body.getReader();
        }

        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }

        // Native backpressure: Firefox only calls pull() again after flushing this chunk to disk
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
        'Content-Disposition': `attachment; filename="${FILENAME}"`,
      },
    })
  );
});
