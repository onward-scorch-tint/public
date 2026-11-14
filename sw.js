self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept any request ending with /virtual-download/<filename>
  if (url.pathname.includes('/virtual-download/')) {
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    const tag = url.searchParams.get('tag');
    const filename = decodeURIComponent(url.pathname.split('/virtual-download/')[1]);

    event.respondWith(handleVirtualDownload(owner, repo, tag, filename));
  }
});

async function handleVirtualDownload(owner, repo, tag, filename) {
  // 1. Fetch release asset list via GitHub REST API (CORS-enabled)
  const releaseRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`
  );
  if (!releaseRes.ok) {
    return new Response(`GitHub API Error: ${releaseRes.status}`, { status: 502 });
  }
  const releaseData = await releaseRes.json();

  // 2. Filter and numerically sort .part1 .. .part8
  const slices = releaseData.assets
    .filter((asset) => asset.name.startsWith(`${filename}.part`))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (slices.length === 0) {
    return new Response('No matching slices found.', { status: 404 });
  }

  // 3. Calculate exact total byte size so Firefox shows an accurate progress bar
  const totalBytes = slices.reduce((sum, s) => sum + s.size, 0);

  // 4. Create a pull-based ReadableStream (applies backpressure so RAM stays near 0)
  let currentSliceIndex = 0;
  let currentReader = null;

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!currentReader) {
          if (currentSliceIndex >= slices.length) {
            controller.close();
            return;
          }

          const slice = slices[currentSliceIndex++];
          const chunkRes = await fetch(slice.url, {
            headers: { Accept: 'application/octet-stream' },
          });

          if (!chunkRes.ok) {
            controller.error(new Error(`Failed fetching ${slice.name}`));
            return;
          }
          currentReader = chunkRes.body.getReader();
        }

        const { done, value } = await currentReader.read();
        if (done) {
          currentReader = null; // Move to next slice on next loop iteration
          continue;
        }

        controller.enqueue(value);
        return; // Yield until browser is ready for the next chunk
      }
    },
    cancel() {
      if (currentReader) currentReader.cancel();
    }
  });

  // 5. Return synthetic download response to Firefox's download manager
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(totalBytes),
    },
  });
}