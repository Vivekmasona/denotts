// --- VivekFy FM Deno Server with CORS (by Vivek Masona) ---
let playlist: any[] = [];
let live = { index: 0, start: Date.now() };

const BROADCAST_KEY = "vivekfy_secret";

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  const method = req.method;

  // --- Handle CORS preflight ---
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // --- SEARCH (JioSaavn VivekFy API) ---
  if (pathname === "/api/search") {
    const q = searchParams.get("q");
    if (!q) return jsonResponse({ error: "Missing query" }, 400);

    try {
      const res = await fetch(
        `https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      const songs = data.data.results.map((s: any) => ({
        id: s.id,
        title: s.name,
        artist: s.primaryArtists,
        image: s.image?.[2]?.link,
        url: s.downloadUrl?.pop()?.link,
        duration: 180,
      }));
      return jsonResponse(songs);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // --- PLAYLIST CRUD ---
  if (pathname === "/api/playlist") {
    const token = searchParams.get("token");
    if (token !== BROADCAST_KEY)
      return jsonResponse({ error: "Unauthorized" }, 403);

    if (method === "GET") return jsonResponse(playlist);

    if (method === "POST") {
      const body = await req.json();
      playlist.push(body);
      return jsonResponse({ added: true, playlist });
    }

    if (method === "DELETE") {
      const { id } = await req.json();
      playlist = playlist.filter((s) => s.id !== id);
      return jsonResponse({ removed: true, playlist });
    }
  }

  // --- LIVE endpoint (broadcast + listener) ---
  if (pathname === "/api/live") {
    const token = searchParams.get("token");

    if (method === "POST" && token === BROADCAST_KEY) {
      if (playlist.length === 0)
        return jsonResponse({ error: "No songs to play" }, 400);
      live.index = (live.index + 1) % playlist.length;
      live.start = Date.now();
      return jsonResponse({ status: "updated", live });
    }

    // Public GET (for listeners)
    if (playlist.length === 0)
      return jsonResponse({ message: "No songs in playlist" });

    const now = Date.now();
    const current = playlist[live.index];
    const elapsed = (now - live.start) / 1000;

    // Auto next song if finished
    if (elapsed >= current.duration) {
      live.index = (live.index + 1) % playlist.length;
      live.start = now;
    }

    return jsonResponse({
      serverNow: now,
      song: playlist[live.index],
      start: live.start,
      playlist,
    });
  }

  return new Response("Not Found", { status: 404 });
});
