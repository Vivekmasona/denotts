// main.ts — Deno YouTube Metadata Fetcher (no yt-dlp)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

async function fetchVideoData(videoId: string) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetch(url).then((r) => r.text());

  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
  if (!match) return { error: "Player JSON not found" };

  const data = JSON.parse(match[1]);
  const streamingData = data.streamingData || {};
  const formats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];

  const mapped = formats.map(f => ({
    itag: f.itag,
    mimeType: f.mimeType,
    qualityLabel: f.qualityLabel || null,
    bitrate: f.bitrate,
    audioQuality: f.audioQuality || null,
    audioSampleRate: f.audioSampleRate || null,
    url: f.url || f.signatureCipher || null // ciphered URLs won't work directly
  }));

  return {
    id: videoId,
    title: data.videoDetails?.title,
    author: data.videoDetails?.author,
    lengthSeconds: data.videoDetails?.lengthSeconds,
    formats: mapped
  };
}

serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("v");
  if (!id) return new Response("Missing ?v= parameter", { status: 400 });
  const info = await fetchVideoData(id);
  return new Response(JSON.stringify(info, null, 2), {
    headers: { "content-type": "application/json" }
  });
});
