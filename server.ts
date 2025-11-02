// server.ts — VivekFy FM (playlist-only Deno backend)
// Deploy to Deno Deploy (dash.deno.com/new)
// BROADCAST_KEY default: "vivekfy_secret"

const BROADCAST_KEY = "vivekfy_secret";
const DAY_SECONDS = 24 * 3600;
const DAY_MS = DAY_SECONDS * 1000;

let playlist = []; // items: { id, title, artist, image, url, duration, addedAt }
let versionCounter = 1;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function ensure24h() {
  // Convert durations to seconds and ensure total <= 24h by removing oldest
  let total = playlist.reduce((s, p) => s + (p.duration || 180), 0);
  while (total > DAY_SECONDS && playlist.length > 0) {
    const removed = playlist.shift();
    total = playlist.reduce((s, p) => s + (p.duration || 180), 0);
    console.log("Removed to enforce 24h:", removed?.title || removed?.id);
    versionCounter++;
  }
}

function nextVersion() {
  versionCounter++;
  return `v${versionCounter}`;
}

async function proxySearch(query) {
  // proxy to svn-vivekfy.vercel.app search
  const url = `https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const j = await res.json();
  // Map to normalized objects
  return (j?.data?.results || []).map((s) => ({
    id: s.id || `id-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    title: s.name,
    artist: s.primaryArtists,
    image: s.image?.[2]?.link || s.image?.[1]?.link || "",
    url: (s.downloadUrl && s.downloadUrl.slice(-1)[0]?.link) || "",
    duration: 180
  }));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;
  const qs = url.searchParams;

  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // SEARCH proxy
  if (pathname === "/api/search") {
    const q = qs.get("q") || "";
    if (!q) return json({ error: "missing q" }, 400);
    try {
      const results = await proxySearch(q);
      return json({ results });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // PLAYLIST endpoints /api/playlist
  if (pathname === "/api/playlist") {
    // GET -> return playlist + version + defaultDuration
    if (method === "GET") {
      const version = `v${versionCounter}`;
      // Return normalized playlist
      return json({ version, durationDefault: 180, playlist });
    }

    // POST -> add song (requires token)
    if (method === "POST") {
      const token = qs.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      try {
        const body = await req.json();
        const item = {
          id: body.id || `s-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          title: body.title || body.name || "Unknown",
          artist: body.artist || body.primaryArtists || "",
          image: body.image || "",
          url: body.url || body.downloadUrl || "",
          duration: body.duration || 180,
          addedAt: Date.now()
        };
        playlist.push(item);
        ensure24h();
        nextVersion();
        return json({ added: true, item, version: `v${versionCounter}`, playlist });
      } catch (err) {
        return json({ error: String(err) }, 400);
      }
    }

    // DELETE -> remove by id
    if (method === "DELETE") {
      const token = qs.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      try {
        const body = await req.json();
        const id = body.id;
        playlist = playlist.filter((s) => s.id !== id);
        nextVersion();
        return json({ removed: true, id, version: `v${versionCounter}`, playlist });
      } catch (err) {
        return json({ error: String(err) }, 400);
      }
    }

    // PUT -> reorder: body { order: [id1,id2,...] }
    if (method === "PUT") {
      const token = qs.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      try {
        const body = await req.json();
        const order = body.order || [];
        // Build new playlist in requested order (keep items not present at end)
        const map = new Map(playlist.map((p) => [p.id, p]));
        const newlist = [];
        for (const id of order) {
          if (map.has(id)) {
            newlist.push(map.get(id));
            map.delete(id);
          }
        }
        // append remaining
        for (const p of playlist) if (map.has(p.id)) newlist.push(p);
        playlist = newlist;
        nextVersion();
        return json({ reordered: true, version: `v${versionCounter}`, playlist });
      } catch (err) {
        return json({ error: String(err) }, 400);
      }
    }
  }

  // unknown
  return new Response("Not Found", { status: 404 });
});
