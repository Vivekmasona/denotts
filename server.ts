// server.ts — Deno-safe YouTube playbackUrl fetcher (direct urls only)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

async function fetchPlayerResponse(videoId: string) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "user-agent": "Mozilla/5.0 (DenoFetcher)" },
  });
  const html = await res.text();
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match) throw new Error("No ytInitialPlayerResponse found");
  return JSON.parse(match[1]);
}

function extractFormats(player: any) {
  const all = [
    ...(player.streamingData?.formats ?? []),
    ...(player.streamingData?.adaptiveFormats ?? []),
  ];
  return all.map((f: any) => {
    let playbackUrl: string | null = null;

    // Case 1: direct url
    if (f.url) playbackUrl = f.url;

    // Case 2: signatureCipher (skip for deploy safety)
    if (!playbackUrl && f.signatureCipher) {
      try {
        const params = new URLSearchParams(f.signatureCipher);
        const baseUrl = params.get("url");
        // can't legally or safely decode signature here, so omit
        playbackUrl = baseUrl ? baseUrl + "&signatureCipher=true" : null;
      } catch {
        playbackUrl = null;
      }
    }

    return {
      itag: f.itag,
      mimeType: f.mimeType,
      qualityLabel: f.qualityLabel,
      bitrate: f.bitrate,
      audioQuality: f.audioQuality,
      width: f.width,
      height: f.height,
      fps: f.fps,
      playbackUrl, // may be null if ciphered
    };
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/formats") {
    const v = url.searchParams.get("v");
    if (!v) {
      return new Response(
        JSON.stringify({ error: "missing ?v param" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    try {
      const data = await fetchPlayerResponse(v);
      const info = {
        id: data.videoDetails?.videoId,
        title: data.videoDetails?.title,
        author: data.videoDetails?.author,
        lengthSeconds: data.videoDetails?.lengthSeconds,
        formats: extractFormats(data),
      };
      return new Response(JSON.stringify(info, null, 2), {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  }

  return new Response(
    JSON.stringify({
      info: "YouTube ytplayer.js extractor",
      usage: "/formats?v=VIDEO_ID",
    }, null, 2),
    { headers: { "content-type": "application/json" } },
  );
});
