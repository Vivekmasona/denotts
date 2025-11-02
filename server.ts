// Deno — VivekFy FM Backend (Control + Live API)
let playlist: any[] = [];
let live = { index: 0, start: Date.now() };

const BROADCAST_KEY = "vivekfy_secret";

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  const method = req.method;

  // --- SEARCH from SVN VivekFy API ---
  if (pathname === "/api/search") {
    const q = searchParams.get("q");
    if (!q) return new Response("Missing query", { status: 400 });
    const res = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(q)}`);
    const data = await res.json();
    const songs = data.data.results.map((s: any) => ({
      id: s.id,
      title: s.name,
      artist: s.primaryArtists,
      image: s.image[2].link,
      url: s.downloadUrl?.pop()?.link,
      duration: 180, // default 3min
    }));
    return Response.json(songs);
  }

  // --- PLAYLIST CRUD (broadcaster only) ---
  if (pathname === "/api/playlist") {
    const token = searchParams.get("token");
    if (token !== BROADCAST_KEY) return new Response("Unauthorized", { status: 403 });

    if (method === "GET") return Response.json(playlist);

    if (method === "POST") {
      const body = await req.json();
      playlist.push(body);
      return Response.json({ added: true, playlist });
    }

    if (method === "DELETE") {
      const { id } = await req.json();
      playlist = playlist.filter((s) => s.id !== id);
      return Response.json({ removed: true, playlist });
    }
  }

  // --- BROADCAST CONTROL ---
  if (pathname === "/api/live") {
    const token = searchParams.get("token");
    if (method === "POST" && token === BROADCAST_KEY) {
      live.index = (live.index + 1) % playlist.length;
      live.start = Date.now();
      return Response.json({ status: "updated", live });
    }

    // GET — Public listener endpoint
    if (playlist.length === 0)
      return Response.json({ message: "No songs in playlist" });

    const now = Date.now();
    const current = playlist[live.index];
    const elapsed = (now - live.start) / 1000;

    // auto move next
    if (elapsed >= current.duration) {
      live.index = (live.index + 1) % playlist.length;
      live.start = now;
    }

    return Response.json({
      serverNow: now,
      song: playlist[live.index],
      start: live.start,
      playlist,
    });
  }

  return new Response("Not Found", { status: 404 });
});
