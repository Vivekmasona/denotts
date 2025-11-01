// server.ts
// Run with: deno run --allow-net --allow-run --allow-read server.ts
import { serve } from "https://deno.land/std@0.201.0/http/server.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8000);

function sanitizeFormat(fmt: Record<string, any>) {
  // Remove fields that leak direct signed URLs / headers
  const {
    url, // signed CDN URL — remove
    http_headers, // may contain cookies/authorization — remove
    _byteranges,
    fragments,
    // keep the rest
    ...rest
  } = fmt;
  return rest;
}

async function runYtDlpJson(videoUrl: string) {
  // Call yt-dlp -j to get json metadata
  const cmd = new Deno.Command("yt-dlp", {
    args: ["-j", "--no-warnings", "--no-check-certificate", videoUrl],
    stdout: "piped",
    stderr: "piped",
  });

  const p = cmd.spawn();
  const { code } = await p.status;
  const rawOut = await p.output(); // Uint8Array
  const rawErr = await p.stderrOutput();

  const decoder = new TextDecoder();
  const outText = decoder.decode(rawOut);
  const errText = decoder.decode(rawErr);

  if (code !== 0) {
    throw new Error(`yt-dlp failed (code ${code}): ${errText || outText}`);
  }

  // yt-dlp -j might output multiple JSON objects separated by newlines
  // We'll parse the first JSON object found.
  const firstLine = outText.trim().split("\n").find((l) => l.trim().startsWith("{"));
  if (!firstLine) throw new Error("No JSON output from yt-dlp");
  return JSON.parse(firstLine);
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          info: "yt-dlp metadata proxy (sanitized). Endpoints: /info?v=VIDEO_ID , /formats?v=VIDEO_ID",
          caution:
            "This service DOES NOT return direct signed CDN URLs. Use yt-dlp locally for raw URLs (private use only).",
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/info") {
      const v = url.searchParams.get("v");
      if (!v) return new Response(JSON.stringify({ error: "missing v param" }), { status: 400, headers: { "content-type": "application/json" } });
      const videoUrl = `https://www.youtube.com/watch?v=${v}`;
      const meta = await runYtDlpJson(videoUrl);
      // Remove url/http_headers from top-level if present
      delete (meta as any).url;
      delete (meta as any).http_headers;
      return new Response(JSON.stringify(meta, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/formats") {
      const v = url.searchParams.get("v");
      if (!v) return new Response(JSON.stringify({ error: "missing v param" }), { status: 400, headers: { "content-type": "application/json" } });
      const videoUrl = `https://www.youtube.com/watch?v=${v}`;
      const meta = await runYtDlpJson(videoUrl);
      const formats = (meta.formats || []).map((f: Record<string, any>) => sanitizeFormat(f));
      // Optionally sort by itag or abr/height
      formats.sort((a: any, b: any) => {
        // try to put audio-only and then video+audio; fallback to itag numeric
        const pa = (a.format_note || "") + (a.format || "");
        const pb = (b.format_note || "") + (b.format || "");
        return (a.itag ?? 0) - (b.itag ?? 0);
      });
      return new Response(JSON.stringify({ id: meta.id, title: meta.title, formats }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    // optional: endpoint that would return direct urls - we will refuse for safety
    if (url.pathname === "/raw-formats") {
      return new Response(JSON.stringify({
        error: "raw-formats endpoint disabled for safety. This server does NOT return direct signed CDN URLs."
      }), { status: 403, headers: { "content-type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  } catch (e) {
    console.error("handler error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}, { addr: `0.0.0.0:${PORT}` });

console.log(`Server running on http://localhost:${PORT}`);
