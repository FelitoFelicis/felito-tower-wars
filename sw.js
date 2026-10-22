// v0.24l: service worker for the home-screen app (iPhone "Add to Home Screen", Android "Install app").
// Makes the game start offline once it has been opened online (Training works offline; PvP needs the internet).
// Caching rules, chosen so a new version is never hidden behind an old cache:
//  - files with ?v=… (modules, style, art): cache first – a new version has a new key, old keys are dropped
//  - everything else (the page, data, manifest, unversioned art): network first, cache only as offline fallback
//  - music (streamed with Range requests): network while online, a full copy is cached once for offline play
//  - other sites (PeerJS, TURN) and non-GET requests are not touched
const CACHE = "felito-app-1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("felito-app-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) {
    if (url.pathname.endsWith(".mp3")) e.respondWith(rangeResponse(req, e));
    return;
  }
  e.respondWith(url.searchParams.has("v") ? cacheFirst(req, url) : networkFirst(req));
});

function storable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic";
}

async function cacheFirst(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) {
    await cache.put(req, res.clone());
    dropOldVersions(cache, url); // in the background
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (storable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // offline: the cached copy; a page link with ?room=… or similar falls back to the cached start page
    const hit = (await cache.match(req)) || (req.mode === "navigate" && ((await cache.match(req, { ignoreSearch: true })) || (await cache.match("./"))));
    if (hit) return hit;
    throw err;
  }
}

// Music: Safari asks for byte ranges. Online the network answers (and a full copy is stored once in the background);
// offline the stored copy answers with the requested range.
async function rangeResponse(req, e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (!hit || self.navigator.onLine) {
    if (!hit) e.waitUntil(fetch(req.url).then((r) => storable(r) && cache.put(req.url, r)).catch(() => {}));
    try {
      return await fetch(req);
    } catch (err) {
      if (!hit) throw err;
    }
  }
  const buf = await hit.arrayBuffer(),
    m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range")) || [],
    size = buf.byteLength;
  let start = m[1] ? +m[1] : 0,
    end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (!m[1] && m[2]) (start = Math.max(0, size - +m[2])), (end = size - 1); // "bytes=-500": the last 500 bytes
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": hit.headers.get("content-type") || "audio/mpeg", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" },
  });
}

// Removes cached copies of the same file under an older ?v= key, so the cache does not grow with every version.
async function dropOldVersions(cache, url) {
  const v = url.searchParams.get("v");
  for (const key of await cache.keys()) {
    const k = new URL(key.url);
    if (k.pathname === url.pathname && k.searchParams.has("v") && k.searchParams.get("v") !== v) await cache.delete(key);
  }
}
