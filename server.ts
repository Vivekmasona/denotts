// server.ts — Bihar FM WebRTC Signaling + Metadata Relay (Deno Deploy + CORS)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Connected clients
const clients = new Map<string, { socket: WebSocket; role: string | null }>();

function safeSend(socket: WebSocket, data: any) {
  try {
    socket.send(JSON.stringify(data));
  } catch (e) {
    console.error("Send error:", e.message);
  }
}

function uuid() {
  return crypto.randomUUID();
}

function handleWs(socket: WebSocket) {
  const id = uuid();
  clients.set(id, { socket, role: null });
  console.log("🔗 Connected:", id);

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const { type, role, target, payload } = msg;

    if (type === "register") {
      clients.get(id)!.role = role;
      console.log(`🧩 ${id} registered as ${role}`);
      if (role === "listener") {
        for (const [, c] of clients)
          if (c.role === "broadcaster")
            safeSend(c.socket, { type: "listener-joined", id });
      }
      return;
    }

    if (["offer", "answer", "candidate"].includes(type) && target) {
      const t = clients.get(target);
      if (t) safeSend(t.socket, { type, from: id, payload });
      return;
    }

    if (type === "metadata") {
      console.log(`🎵 Metadata update: ${payload?.title || "Unknown title"}`);
      for (const [, c] of clients)
        if (c.role === "listener")
          safeSend(c.socket, {
            type: "metadata",
            title: payload.title,
            artist: payload.artist,
            cover: payload.cover,
          });
      return;
    }
  });

  socket.addEventListener("close", () => {
    const role = clients.get(id)?.role;
    clients.delete(id);
    console.log(`❌ ${role || "client"} disconnected: ${id}`);
    if (role === "listener") {
      for (const [, c] of clients)
        if (c.role === "broadcaster")
          safeSend(c.socket, { type: "peer-left", id });
    }
  });
}

// Send keep-alive ping
setInterval(() => {
  for (const [, c] of clients) safeSend(c.socket, { type: "ping" });
}, 25000);

// Common CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// HTTP + WS server
serve((req: Request) => {
  const { pathname } = new URL(req.url);

  // Preflight for CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Root check
  if (pathname === "/") {
    return new Response(
      "🎧 Bihar FM WebRTC Signaling Server (Deno + CORS) is Live!",
      { status: 200, headers: { ...corsHeaders, "content-type": "text/plain" } },
    );
  }

  // WebSocket upgrade
  if (pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWs(socket);
    return response;
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});

console.log("✅ Bihar FM Deno server running (with CORS)...");
