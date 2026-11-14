self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/virtual-download/')) {
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    const tag = url.searchParams.get('tag');
    const filename = decodeURIComponent(url.pathname.split('/virtual-download/')[1]);

    event.respondWith(handleVirtualDownload(owner, repo, tag, filename));
  }
});

async function handleVirtualDownload(owner, repo, tag, filename) {
  const releaseRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { mode: 'cors', credentials: 'omit' }
  );
  if (!releaseRes.ok) {
    return new Response(`GitHub API Error: ${releaseRes.status}`, { status: 502 });
  }
  const releaseData = await releaseRes.json();

  const slices = releaseData.assets
    .filter((asset) => asset.name.startsWith(`${filename}.part`))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (slices.length === 0) {
    return new Response('No matching slices found.', { status: 404 });
  }

  const totalBytes = slices.reduce((sum, s) => sum + s.size, 0);

  let currentSliceIndex = 0;
  let currentReader = null;

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!currentReader) {
            if (currentSliceIndex >= slices.length) {
              controller.close();
              return;
            }

            const slice = slices[currentSliceIndex++];
            console.log(`[SW] Fetching ${slice.name} from ${slice.url}`);

            const chunkRes = await fetch(slice.url, {
              method: 'GET',
              mode: 'cors',
              credentials: 'omit',
              redirect: 'follow',
              headers: {
                Accept: 'application/octet-stream',
              },
            });

            if (!chunkRes.ok) {
              throw new Error(`HTTP ${chunkRes.status} on ${slice.name}`);
            }
            if (!chunkRes.body) {
              throw new Error(`ReadableStream body missing on ${slice.name}`);
            }

            currentReader = chunkRes.body.getReader();
          }

          const { done, value } = await currentReader.read();
          if (done) {
            currentReader = null;
            continue;
          }

          controller.enqueue(value);
          return;
        }
      } catch (err) {
        console.error('[SW] Stream aborted:', err);
        controller.error(err);
      }
    },
    cancel() {
      if (currentReader) currentReader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(totalBytes),
      'Cache-Control': 'no-store',
    },
  });
}
