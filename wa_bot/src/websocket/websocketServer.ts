import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { whatsappService } from "../services/whatsappInstance";

interface WebSocketMessage {
  action: string;
  [key: string]: any;
}

export const createWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  server.on('listening', () => {
    const address = server.address();
    const port = typeof address === 'string' ? address : address?.port;
    console.log(`🚀 WebSocket server running on ws://localhost:${port}`);
  });

  const sendError = (ws: WebSocket, message: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        action: "error",
        message
      }));
    }
  };

  const handleCreateSession = async (ws: WebSocket, message: WebSocketMessage) => {
    console.log("🔗 Creating new WhatsApp session");
    
    try {
      const sessionId = await whatsappService.createNewSession(ws);
      
      ws.send(JSON.stringify({
        action: "session_created",
        sessionId,
        status: "pending"
      }));
      
      console.log(`🆕 Session created with ID: ${sessionId}`);
    } catch (error) {
      console.error("❌ Failed to create session:", error);
      sendError(ws, "Failed to create WhatsApp session");
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    console.log("✅ New client connected");

    ws.on("message", async (data) => {
      console.log("📩 Received raw WebSocket message:", data.toString());

      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        console.log("✅ Parsed WebSocket message:", message);

        if (message?.action === "create_session") {
          await handleCreateSession(ws, message);
        } else {
          console.warn("⚠️ Unknown WebSocket action:", message);
          sendError(ws, "Unknown action");
        }
      } catch (error) {
        console.error("❌ Error parsing WebSocket message:", error);
        sendError(ws, "Invalid message format");
      }
    });

    ws.on("close", () => {
      console.log("❌ Client disconnected");
      whatsappService.removeWebSocket(ws);
    });

    ws.on("error", (error) => {
      console.error("⚠️ WebSocket error:", error);
      whatsappService.removeWebSocket(ws);
    });
  });

  return wss;
};