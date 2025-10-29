// server.ts — Bihar FM WebRTC Signaling + Metadata Relay (Deno Deploy Ready)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { acceptWebSocket, isWebSocketCloseEvent } from "https://deno.land/std@0.224.0/ws/mod.ts";

// Connected clients: id → { socket, role }
const clients = new Map<string, { socket: WebSocket; role: string | null }>();

// Safe send helper
function safeSend(socket: WebSocket, data: any) {
  try {
    socket.send(JSON.stringify(data));
  } catch (e) {
    console.error("Send error:", e.message);
  }
}

// Generate random UUID
function uuid() {
  return crypto.randomUUID();
}

// WebSocket handler
async function handleWs(sock: WebSocket) {
  const id = uuid();
  clients.set(id, { socket: sock, role: null });
  console.log("🔗 Connected:", id);

  for await (const ev of sock) {
    if (typeof ev === "string") {
      let msg;
      try {
        msg = JSON.parse(ev);
      } catch {
        continue;
      }

      const { type, role, target, payload } = msg;

      // Register client role
      if (type === "register") {
        clients.get(id)!.role = role;
        console.log(`🧩 ${id} registered as ${role}`);

        // Notify broadcaster when listener joins
        if (role === "listener") {
          for (const [, c] of clients)
            if (c.role === "broadcaster")
              safeSend(c.socket, { type: "listener-joined", id });
        }
        continue;
      }

      // Relay signaling messages
      if (["offer", "answer", "candidate"].includes(type) && target) {
        const t = clients.get(target);
        if (t) safeSend(t.socket, { type, from: id, payload });
        continue;
      }

      // Broadcast metadata to listeners
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
        continue;
      }
    }

    // Handle close event
    if (isWebSocketCloseEvent(ev)) {
      const role = clients.get(id)?.role;
      clients.delete(id);
      console.log(`❌ ${role || "client"} disconnected: ${id}`);

      // Notify broadcaster when listener leaves
      if (role === "listener") {
        for (const [, c] of clients)
          if (c.role === "broadcaster")
            safeSend(c.socket, { type: "peer-left", id });
      }
    }
  }
}

// Periodic ping (keep alive)
setInterval(() => {
  for (const [, c] of clients) safeSend(c.socket, { type: "ping" });
}, 25000);

// HTTP + WS server
serve(async (req: Request) => {
  const { pathname } = new URL(req.url);

  // Root check
  if (pathname === "/") {
    return new Response("🎧 Bihar FM WebRTC Signaling Server (Deno) is Live!", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // WebSocket upgrade
  if (pathname === "/ws") {
    const upgrade = Deno.upgradeWebSocket(req);
    handleWs(upgrade.socket);
    return upgrade.response;
  }

  return new Response("Not Found", { status: 404 });
});

console.log("✅ Bihar FM Deno server running...");
