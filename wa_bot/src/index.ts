import { createWebSocketServer } from './websocket/websocketServer';
import { getAuthorizedUsers } from './controllers/userController';
import { connectDB, disconnectDB } from "./config/db";
import { whatsappService } from './services/whatsappInstance';
import express from 'express';
import http from 'http';
import cors from 'cors'; 

const app = express();
const server = http.createServer(app);

connectDB().then(async () => {
  // Load persisted sessions after DB connection is established
  await whatsappService.loadPersistedSessions();

  // Start your server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    whatsappStatus: whatsappService.getActiveSessions().length > 0 ? 'active' : 'inactive'
  });
});

// API endpoints
app.get('/api/authorized-users', getAuthorizedUsers);

// WebSocket server setup
createWebSocketServer(server);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  whatsappService.cleanupAllSessions();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  whatsappService.cleanupAllSessions();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🚀 Server running on http://localhost:${PORT}
  📡 WebSocket server ready on ws://localhost:${PORT}
  `);
  
  // Optional: Initialize WhatsApp service with dummy session for testing
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: WhatsApp service available');
  }
});


// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, async () => {
    console.log(`${signal} received. Shutting down gracefully...`);
    
    try {
      await whatsappService.cleanupAllSessions();
      await disconnectDB();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
});