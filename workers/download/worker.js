// Copyright (c) 2026 Divergent Health Technologies
// Cloudflare Worker: redirects /download to the latest GitHub release DMG

const REPO = 'elgabrielc/dicom-viewer';
const CACHE_TTL = 300; // 5 minutes

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== '/download') {
      return new Response('Not found', { status: 404 });
    }

    const cache = caches.default;
    const cacheKey = new Request('https://myradone.com/download-cache', request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const apiUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
    const resp = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'myradone-download-worker',
      },
    });

    if (!resp.ok) {
      return new Response('Could not fetch release info', { status: 502 });
    }

    const release = await resp.json();
    const dmg = release.assets.find(a => a.name.endsWith('_aarch64.dmg'));

    if (!dmg) {
      return new Response('DMG not found in latest release', { status: 404 });
    }

    const response = Response.redirect(dmg.browser_download_url, 302);
    const cacheable = new Response(response.body, response);
    cacheable.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    await cache.put(cacheKey, cacheable.clone());

    return response;
  },
};
