// Copyright (c) 2026 Divergent Health Technologies
// Cloudflare Worker: redirects /download to the latest GitHub release DMG

const REPO = 'elgabrielc/dicom-viewer';
const CACHE_TTL = 300; // 5 minutes
const CACHE_KEY = 'https://myradone.com/_internal/download-url';
const GITHUB_LATEST_RELEASE_URL = `https://github.com/${REPO}/releases/latest`;

function extractTagName(location) {
  if (!location) return '';

  const match = location.match(/\/releases\/tag\/([^/?#]+)/);
  return match?.[1] || '';
}

async function resolveLatestDmgUrl() {
  const latestReleaseResp = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      'User-Agent': 'myradone-download-worker',
    },
    redirect: 'manual',
  });

  const tagName = extractTagName(latestReleaseResp.headers.get('location'));
  if (!tagName) {
    throw new Error('Could not resolve latest release tag');
  }

  const version = tagName.startsWith('v') ? tagName.slice(1) : tagName;
  return `https://github.com/${REPO}/releases/download/${tagName}/myradone_${version}_aarch64.dmg`;
}

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

    let dmgUrl = '';
    try {
      dmgUrl = await resolveLatestDmgUrl();
    } catch (_error) {
      return new Response('Could not fetch release info', { status: 502 });
    }

    // Store the URL string so the Cache API can actually cache it
    const cacheResp = new Response(dmgUrl, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
    });
    await cache.put(CACHE_KEY, cacheResp);

    return Response.redirect(dmgUrl, 302);
  },
};
