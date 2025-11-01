// server.ts — Deno Deploy Safe YouTube format info fetcher
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const YT_BASE = "https://www.youtube.com/watch?v=";

async function fetchPlayerResponse(videoId: string) {
  const url = `${YT_BASE}${videoId}`;
  const html = await (await fetch(url)).text();

  // Find ytInitialPlayerResponse JSON block
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match) throw new Error("No playerResponse found");
  const json = JSON.parse(match[1]);
  return json;
}

function sanitizeFormats(formats: any[] = []) {
  return formats.map(f => ({
    itag: f.itag,
    mimeType: f.mimeType,
    bitrate: f.bitrate,
    audioQuality: f.audioQuality,
    approxDurationMs: f.approxDurationMs,
    contentLength: f.contentLength,
    qualityLabel: f.qualityLabel,
    audioSampleRate: f.audioSampleRate,
    fps: f.fps,
    width: f.width,
    height: f.height,
    // url excluded intentionally
  }));
}

serve(async req => {
  const url = new URL(req.url);
  if (url.pathname === "/") {
    return new Response(JSON.stringify({
      info: "YouTube format fetcher (ytplayer.js style)",
      endpoints: ["/formats?v=VIDEO_ID"]
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

  if (url.pathname === "/formats") {
    const vid = url.searchParams.get("v");
    if (!vid) return new Response(JSON.stringify({ error: "missing ?v param" }), { status: 400 });
    try {
      const data = await fetchPlayerResponse(vid);
      const videoDetails = data.videoDetails ?? {};
      const streaming = data.streamingData ?? {};
      const formats = [
        ...(streaming.formats || []),
        ...(streaming.adaptiveFormats || [])
      ];
      const safe = sanitizeFormats(formats);
      return new Response(JSON.stringify({
        id: videoDetails.videoId,
        title: videoDetails.title,
        author: videoDetails.author,
        lengthSeconds: videoDetails.lengthSeconds,
        formats: safe
      }, null, 2), {
        headers: { "content-type": "application/json" }
      });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  return new Response("Not found", { status: 404 });
});
