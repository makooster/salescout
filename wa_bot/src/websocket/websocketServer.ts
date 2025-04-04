import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { whatsappService } from "../services/whatsappInstance";
import { validateSessionIds } from '../services/sessionValidation';
interface WebSocketMessage {
  action: string;
  [key: string]: any;
}

export const createWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server });

  const sessionStore = new Map<string, any>();

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
      
      // Store the session in our persistent storage
      sessionStore.set(sessionId, {
        id: sessionId,
        status: "pending",
        createdAt: new Date().toISOString()
      });

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

  const broadcastSessions = () => {
    const activeSessions = whatsappService.getActiveSessions().map(s => ({
      id: s.id,
      name: s.phoneNumber || 'Unknown',
      number: s.phoneNumber || 'Unknown',
      status: s.status,
      sessionId: s.id
    }));

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          action: "sessions_update",
          sessions: activeSessions
        }));
      }
    });
  };

  wss.on("connection", (ws: WebSocket) => {
    console.log("✅ New client connected");

    const handleValidateSessions = async (message: WebSocketMessage) => {
      try {
        const { sessions } = message;
        const sessionIds = sessions.map((s: any) => s.sessionId);
        
        // Use the shared validation service
        const validSessions = await validateSessionIds(sessionIds);
        
        ws.send(JSON.stringify({
          action: "sessions_validated",
          sessions: validSessions
        }));
    
        // Send authorized users
        const authorizedUsers = validSessions.filter((s: any) => s.status === 'ready');
        ws.send(JSON.stringify({
          action: "authorized_users",
          users: authorizedUsers
        }));
    
      } catch (error) {
        console.error("❌ Session validation failed:", error);
        sendError(ws, "Session validation failed");
      }
    };

    ws.on("message", async (data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        
        if (message.action === "validate_sessions") {
          await handleValidateSessions(message);
        } 
        else if (message.action === "get_initial_data") {
          const allSessions = whatsappService.getActiveSessions().map(s => ({
            id: s.id,
            name: s.phoneNumber || 'Unknown',
            number: s.phoneNumber || 'Unknown',
            status: s.status,
            sessionId: s.id
          }));

          ws.send(JSON.stringify({
            action: "sessions_update",
            sessions: allSessions
          }));

          const authorizedUsers = allSessions.filter(s => s.status === 'ready');
          ws.send(JSON.stringify({
            action: "authorized_users",
            users: authorizedUsers
          }));
        }
        else if (message.action === "create_session") {
          await handleCreateSession(ws, message);
        } 
        else if (message.action === "get_sessions") {
          broadcastSessions();
        } 
        else {
          console.warn("⚠️ Unknown WebSocket action:", message);
          sendError(ws, "Unknown action");
        }
      } catch (error) {
        console.error("❌ Error handling message:", error);
        sendError(ws, "Invalid message format");
      }
    });

    ws.on("close", () => {
      console.log("❌ Client disconnected");
      whatsappService.removeWebSocket(ws);
      broadcastSessions();
    });

    ws.on("error", (error) => {
      console.error("⚠️ WebSocket error:", error);
      whatsappService.removeWebSocket(ws);
    });
  });

  // Set up session update broadcasting
  whatsappService.onSessionUpdate = () => {
    broadcastSessions();
    
    // Update our session store
    whatsappService.getActiveSessions().forEach(session => {
      if (sessionStore.has(session.id)) {
        sessionStore.set(session.id, {
          ...sessionStore.get(session.id),
          status: session.status,
          phoneNumber: session.phoneNumber
        });
      }
    });
  };

  return wss;
  whatsappService.onSessionUpdate = broadcastSessions;
};

