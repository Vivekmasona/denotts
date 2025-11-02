// server.ts — VivekFy FM Deno Server with scheduler
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

let playlist: any[] = [];
let schedule: Record<string, number> = {}; // e.g. {"09:00":0,"09:22":1}
let lastUpdate = Date.now();

function getCurrentSong() {
  if (!playlist.length || !Object.keys(schedule).length) return null;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const times = Object.keys(schedule).sort();

  let currentKey = times[0];
  for (const t of times) {
    if (hhmm >= t) currentKey = t;
    else break;
  }
  const songIndex = schedule[currentKey];
  const song = playlist[songIndex];
  const songStart = new Date();
  const [h, m] = currentKey.split(":").map(Number);
  songStart.setHours(h, m, 0, 0);

  return { song, start: songStart.getTime() };
}

serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (url.pathname === "/api/live") {
    const data = getCurrentSong();
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (url.pathname === "/api/panel" && req.method === "POST") {
    const body = await req.json();
    playlist = body.playlist || playlist;
    schedule = body.schedule || schedule;
    lastUpdate = Date.now();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  if (url.pathname === "/api/state") {
    return new Response(JSON.stringify({ playlist, schedule, lastUpdate }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  return new Response("VivekFy FM Scheduler", { headers: { "Access-Control-Allow-Origin": "*" } });
});
