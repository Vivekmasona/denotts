// server.ts — VivekFy FM (Deno) — 24h-maintained playlist (auto-remove oldest when >24h)
// Deploy on Deno Deploy: https://dash.deno.com/new
// IMPORTANT: change BROADCAST_KEY if you want different secret.

let playlist: any[] = []; // items: {id,title,artist,image,url,duration,addedAt, startOverride?}
const BROADCAST_KEY = "vivekfy_secret";
const DAY_SECONDS = 24 * 3600;
const DAY_MS = DAY_SECONDS * 1000;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function startOfDayUtc(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function msToHHMM(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Ensure playlist total duration <= 24 hours by removing oldest entries
function enforce24h() {
  let total = playlist.reduce((s, p) => s + (p.duration || 180), 0);
  while (total > DAY_SECONDS && playlist.length > 0) {
    // remove oldest (shift)
    const rem = playlist.shift();
    total = playlist.reduce((s, p) => s + (p.duration || 180), 0);
    console.log("Removed oldest to enforce 24h:", rem?.title || rem?.id);
  }
}

// Build a schedule for the next 24 hours starting from UTC dayStart
function build24hSchedule(now = Date.now()) {
  const dayStart = startOfDayUtc(now);
  const dayEnd = dayStart + DAY_MS;
  const events: { song: any; start: number; duration: number }[] = [];

  // collect overrides inside day window
  const overrides = playlist
    .filter((s) => s.startOverride && s.startOverride >= dayStart && s.startOverride < dayEnd)
    .map((s) => ({ song: s, start: s.startOverride, duration: s.duration || 180 }))
    .sort((a, b) => a.start - b.start);

  // Fill by scanning cursor from dayStart -> dayEnd, honoring overrides
  let cursor = dayStart;
  let rrIndex = 0;
  let oi = 0;

  function nextSong() {
    if (playlist.length === 0) return null;
    const s = playlist[rrIndex % playlist.length];
    rrIndex++;
    return s;
  }

  while (cursor < dayEnd) {
    const nextOverride = overrides[oi];
    if (nextOverride && nextOverride.start <= cursor) {
      // if override overlaps cursor, add it and advance cursor
      events.push(nextOverride);
      cursor = nextOverride.start + nextOverride.duration * 1000;
      oi++;
      continue;
    }

    const gapEnd = nextOverride ? nextOverride.start : dayEnd;

    // fill gap with playlist items sequentially
    while (cursor < gapEnd) {
      const s = nextSong();
      if (!s) {
        cursor = gapEnd;
        break;
      }
      const dur = (s.duration || 180) * 1000;
      // if adding will exceed gapEnd, still schedule it (we want continuous play across 24h)
      events.push({ song: s, start: cursor, duration: s.duration || 180 });
      cursor += dur;
    }
  }

  return events.sort((a, b) => a.start - b.start);
}

function findCurrentEvent(now = Date.now()) {
  const schedule = build24hSchedule(now);
  if (schedule.length === 0) return null;
  for (const ev of schedule) {
    if (now >= ev.start && now < ev.start + ev.duration * 1000) {
      return { event: ev, schedule, elapsed: (now - ev.start) / 1000 };
    }
  }
  // fallback: if none match, pick nearest next or first
  const future = schedule.find((s) => s.start > now);
  const pick = future || schedule[0];
  return { event: pick, schedule, elapsed: Math.max(0, (now - pick.start) / 1000) };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;
  const p = url.searchParams;

  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // ---- /api/search?q=...  (proxy to svn Vivekfy) ----
  if (pathname === "/api/search") {
    const q = p.get("q") || "";
    if (!q) return json({ error: "missing q" }, 400);
    try {
      const r = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(q)}`);
      const j = await r.json();
      const songs = (j?.data?.results || []).map((s: any) => ({
        id: s.id || `id-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        title: s.name,
        artist: s.primaryArtists,
        image: s.image?.[2]?.link || s.image?.[1]?.link || "",
        url: s.downloadUrl?.slice(-1)?.[0]?.link || "",
        duration: 180,
      }));
      return json(songs);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // ---- /api/playlist  GET/POST/DELETE ----
  if (pathname === "/api/playlist") {
    if (method === "GET") {
      // remove stale startOverride entries that fall outside today's 24h to avoid confusing UI (but do not remove songs)
      const dayStart = startOfDayUtc();
      const dayEnd = dayStart + DAY_MS;
      playlist = playlist.map((s) => {
        if (s.startOverride && (s.startOverride < dayStart || s.startOverride >= dayEnd)) {
          delete s.startOverride;
        }
        return s;
      });
      // compute schedule and nextStarts map for UI
      const schedule = build24hSchedule();
      const nextStarts: Record<string, number[]> = {};
      for (const ev of schedule) {
        nextStarts[ev.song.id] = nextStarts[ev.song.id] || [];
        nextStarts[ev.song.id].push(ev.start);
      }
      const out = playlist.map((s) => ({ ...s, nextStarts: (nextStarts[s.id] || []).slice(0, 5) }));
      return json(out);
    }

    if (method === "POST") {
      const token = p.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      try {
        const body = await req.json();
        // normalize song object
        const item = {
          id: body.id || `s-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          title: body.title || body.name || "Unknown",
          artist: body.artist || body.primaryArtists || "",
          image: body.image || body.image?.[2]?.link || "",
          url: body.url || body.downloadUrl || "",
          duration: body.duration || 180,
          addedAt: Date.now(),
        };
        playlist.push(item);
        // enforce 24h window by removing oldest songs while total duration > 24h
        enforce24h();
        return json({ added: true, item, playlist });
      } catch (err) {
        return json({ error: String(err) }, 400);
      }
    }

    if (method === "DELETE") {
      const token = p.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      try {
        const body = await req.json();
        const id = body.id;
        playlist = playlist.filter((s) => s.id !== id);
        return json({ removed: true, id, playlist });
      } catch (err) {
        return json({ error: String(err) }, 400);
      }
    }
  }

  // ---- /api/setStart POST ?token=  body {id, hh, mm} ----
  if (pathname === "/api/setStart") {
    const token = p.get("token") || "";
    if (method !== "POST") return json({ error: "method" }, 405);
    if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
    try {
      const body = await req.json();
      const { id, hh, mm } = body;
      const song = playlist.find((s) => s.id === id);
      if (!song) return json({ error: "song not found" }, 404);
      const now = Date.now();
      const dayStart = startOfDayUtc(now);
      let target = dayStart + (Number(hh) * 3600 + Number(mm) * 60) * 1000;
      if (target <= now) target += DAY_MS; // next day
      song.startOverride = target;
      return json({ ok: true, id: song.id, startOverride: song.startOverride });
    } catch (err) {
      return json({ error: String(err) }, 400);
    }
  }

  // ---- /api/live GET (public) / POST?token= (advance now) ----
  if (pathname === "/api/live") {
    if (method === "POST") {
      const token = p.get("token") || "";
      if (token !== BROADCAST_KEY) return json({ error: "unauthorized" }, 403);
      if (playlist.length === 0) return json({ error: "no songs" }, 400);
      // schedule next song start = now (set its override)
      const now = Date.now();
      // find current event to pick next
      const cur = findCurrentEvent(now);
      let nextSong = playlist[0];
      if (cur?.event) {
        const curId = cur.event.song.id;
        const idx = playlist.findIndex((s) => s.id === curId);
        nextSong = playlist[(idx + 1) % playlist.length];
      }
      nextSong.startOverride = Date.now();
      return json({ ok: true, scheduled: nextSong.id, startOverride: nextSong.startOverride });
    }

    // GET
    if (playlist.length === 0) return json({ message: "no songs" });
    const now = Date.now();
    const cur = findCurrentEvent(now);
    if (!cur) return json({ message: "no-schedule" });
    const ev = cur.event;
    return json({
      serverNow: now,
      current: { song: ev.song, start: ev.start, duration: ev.duration },
      elapsed: cur.elapsed,
      schedule: cur.schedule.map((s) => ({
        id: s.song.id,
        title: s.song.title,
        artist: s.song.artist,
        image: s.song.image,
        url: s.song.url,
        start: s.start,
        duration: s.duration,
        hhmm: msToHHMM(s.start),
      })),
    });
  }

  return new Response("Not Found", { status: 404 });
});
