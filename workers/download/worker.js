// Copyright (c) 2026 Divergent Health Technologies
// Cloudflare Worker: redirects /download to the latest GitHub release DMG

const REPO = 'elgabrielc/dicom-viewer';
const CACHE_TTL = 300; // 5 minutes
const CACHE_KEY = 'https://myradone.com/_internal/download-url';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== '/download') {
      return new Response('Not found', { status: 404 });
    }

    // Cache stores the resolved URL as plain text (not the 302 redirect,
    // which the Cache API silently drops)
    const cache = caches.default;
    const cached = await cache.match(CACHE_KEY);
    if (cached) {
      const dmgUrl = await cached.text();
      return Response.redirect(dmgUrl, 302);
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

    // Store the URL string so the Cache API can actually cache it
    const cacheResp = new Response(dmg.browser_download_url, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
    });
    await cache.put(CACHE_KEY, cacheResp);

    return Response.redirect(dmg.browser_download_url, 302);
  },
};
