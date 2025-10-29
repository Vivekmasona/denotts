// server.ts — Bihar FM Signaling + Metadata Server (Deno)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// 🔐 Connected clients store
const clients = new Map<string, { socket: WebSocket; role: string | null }>();

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function uuid() {
  return crypto.randomUUID();
}

setInterval(() => {
  for (const [, { socket }] of clients) {
    safeSend(socket, { type: "ping" });
  }
}, 25000);

console.log("🚀 Bihar FM Deno server starting...");

serve((req) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/") {
    return new Response("🎧 Bihar FM Deno WebRTC Signaling is Live!", {
      headers: { "content-type": "text/plain" },
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const id = uuid();
  clients.set(id, { socket, role: null });
  console.log(`🔗 Connected: ${id}`);

  socket.onmessage = (event) => {
    let msg: any;
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
      console.log(`🎵 Metadata update: ${payload?.title || "Unknown"}`);
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
  };

  socket.onclose = () => {
    const role = clients.get(id)?.role;
    clients.delete(id);
    console.log(`❌ ${role || "client"} disconnected: ${id}`);
    if (role === "listener") {
      for (const [, c] of clients)
        if (c.role === "broadcaster")
          safeSend(c.socket, { type: "peer-left", id });
    }
  };

  socket.onerror = (err) => console.error("WebSocket error:", err);

  return response;
});
