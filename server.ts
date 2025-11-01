// server.ts
// Run: deno run --allow-net --allow-run --allow-read server.ts
import { serve } from "https://deno.land/std@0.201.0/http/server.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8000);

function sanitizeFormat(fmt: Record<string, any>) {
  const {
    url,
    http_headers,
    fragments,
    _byteranges,
    // remove any other fields that may leak signed info
    request_headers,
    ...rest
  } = fmt;
  // Also normalize common fields
  return {
    itag: rest.itag ?? rest.format_id ?? null,
    format_id: rest.format_id ?? null,
    ext: rest.ext ?? null,
    acodec: rest.acodec ?? null,
    vcodec: rest.vcodec ?? null,
    abr: rest.abr ?? null,
    tbr: rest.tbr ?? null,
    filesize: rest.filesize ?? rest.filesize_approx ?? null,
    width: rest.width ?? null,
    height: rest.height ?? null,
    format_note: rest.format_note ?? rest.format ?? null,
    avg_bitrate: rest.avg_bitrate ?? null,
    fps: rest.fps ?? null,
    // preserve other safe keys
    filesize_approx: rest.filesize_approx ?? null,
    duration: rest.duration ?? null,
    // keep raw rest minimally (non-sensitive)
    _raw: (() => {
      const allowed: Record<string, any> = {};
      for (const k of ["quality", "language", "audio_ext", "resolution"]) {
        if (k in rest) allowed[k] = rest[k];
      }
      return allowed;
    })()
  };
}

async function runYtDlpJson(videoUrl: string) {
  const cmd = new Deno.Command("yt-dlp", {
    args: ["-j", "--no-warnings", "--no-check-certificate", videoUrl],
    stdout: "piped",
    stderr: "piped",
  });
  const p = cmd.spawn();
  const { code } = await p.status;
  const rawOut = await p.output();
  const rawErr = await p.stderrOutput();
  const dec = new TextDecoder();
  const outText = dec.decode(rawOut);
  const errText = dec.decode(rawErr);
  if (code !== 0) throw new Error(`yt-dlp failed (code ${code}): ${errText || outText}`);
  const firstLine = outText.trim().split("\n").find((l) => l.trim().startsWith("{"));
  if (!firstLine) throw new Error("No JSON output from yt-dlp");
  return JSON.parse(firstLine);
}

function htmlPage() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>YT itag viewer</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:0;background:#0b1020;color:#e6eef6;padding:18px}
    .card{max-width:900px;margin:18px auto;padding:18px;border-radius:10px;background:linear-gradient(180deg,#071420,#061423);box-shadow:0 6px 20px rgba(0,0,0,.6)}
    input{width:60%;padding:10px;border-radius:6px;border:1px solid #274150;background:#071c23;color:#e6eef6}
    button{padding:10px 14px;margin-left:8px;border-radius:6px;border:0;background:#00b386;color:#04201a;cursor:pointer}
    pre{white-space:pre-wrap;color:#bfe8d6}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:left;font-size:13px}
    th{color:#9fb3bf}
    .muted{color:#7f9da3;font-size:13px}
    .err{color:#ff6b6b}
  </style>
</head>
<body>
  <div class="card">
    <h2>YT itag viewer (sanitized)</h2>
    <p class="muted">Paste YouTube video ID (e.g. dQw4w9WgXcQ) or full URL. This page calls the local /formats endpoint which uses <code>yt-dlp</code> and DOES NOT return signed CDN URLs.</p>
    <div>
      <input id="input" placeholder="video id or url" />
      <button id="btn">Fetch formats</button>
    </div>
    <div id="status" style="margin-top:10px" class="muted">Ready</div>
    <div id="result"></div>
  </div>

  <script>
    function extractId(input) {
      try {
        // if URL, try to parse v= or youtu.be
        const u = new URL(input);
        if (u.hostname.includes('youtu.be')) {
          return u.pathname.slice(1);
        }
        if (u.searchParams && u.searchParams.get('v')) return u.searchParams.get('v');
        // fallback
      } catch(e) {}
      // otherwise assume it's id
      return input.trim();
    }

    document.getElementById('btn').addEventListener('click', async () => {
      const raw = document.getElementById('input').value.trim();
      if (!raw) return alert('Enter video id or url');
      const id = extractId(raw);
      const status = document.getElementById('status');
      const resDiv = document.getElementById('result');
      status.textContent = 'Fetching formats...';
      resDiv.innerHTML = '';
      try {
        const resp = await fetch('/formats?v=' + encodeURIComponent(id));
        if (!resp.ok) {
          const txt = await resp.text();
          resDiv.innerHTML = '<div class="err">Error: ' + resp.status + ' — ' + txt + '</div>';
          status.textContent = 'Error';
          return;
        }
        const json = await resp.json();
        status.textContent = 'OK — found ' + (json.formats ? json.formats.length : 0) + ' formats';
        // render summary
        const titleHtml = '<h3>' + (json.title ? json.title : json.id) + '</h3>' +
          '<div class="muted">id: ' + (json.id || '') + '</div>';
        let table = '<table><thead><tr><th>itag</th><th>format</th><th>ext</th><th>vcodec</th><th>acodec</th><th>abr/tbr</th><th>res</th><th>filesize</th></tr></thead><tbody>';
        (json.formats || []).forEach(f => {
          table += '<tr>' +
            '<td>' + (f.itag ?? '') + '</td>' +
            '<td>' + (f.format_note ?? '') + '</td>' +
            '<td>' + (f.ext ?? '') + '</td>' +
            '<td>' + (f.vcodec ?? '') + '</td>' +
            '<td>' + (f.acodec ?? '') + '</td>' +
            '<td>' + ((f.abr??f.tbr) ? (f.abr? f.abr + 'kbps' : f.tbr + 'kbps') : '') + '</td>' +
            '<td>' + ((f.width && f.height) ? (f.width + 'x' + f.height) : '') + '</td>' +
            '<td>' + (f.filesize ? Math.round(f.filesize/1024) + ' KB' : '') + '</td>' +
            '</tr>';
        });
        table += '</tbody></table>';
        resDiv.innerHTML = titleHtml + table + '<div style="margin-top:12px" class="muted">Note: direct signed CDN URLs are intentionally hidden by server.</div>';
      } catch (e) {
        status.textContent = 'Error';
        resDiv.innerHTML = '<div class="err">Exception: ' + e.message + '</div>';
      }
    });
  </script>
</body>
</html>`;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(htmlPage(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/info") {
      const v = url.searchParams.get("v");
      if (!v) return new Response(JSON.stringify({ error: "missing v param" }), { status: 400, headers: { "content-type": "application/json" } });
      const videoUrl = `https://www.youtube.com/watch?v=${v}`;
      const meta = await runYtDlpJson(videoUrl);
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
      formats.sort((a: any, b: any) => (a.itag ?? 0) - (b.itag ?? 0));
      return new Response(JSON.stringify({ id: meta.id, title: meta.title, formats }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/raw-formats") {
      return new Response(JSON.stringify({ error: "raw-formats endpoint disabled for safety" }), { status: 403, headers: { "content-type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  } catch (e) {
    console.error("handler error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}, { addr: `0.0.0.0:${PORT}` });

console.log(\`Server running on http://localhost:\${PORT}\`);
