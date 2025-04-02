import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { Session as DBSession} from "../models/Session";
import { WebSocket } from 'ws';

interface WhatsAppAuthSession {
  wid?: {
    server?: string;
    user?: string;
    _serialized?: string;
  };
  clientId?: string;
}

interface Session {
  id: string;
  ws: WebSocket;
  client: Client;
  status: 'pending' | 'authenticated' | 'ready';
  phoneNumber?: string;
  qrCode?: string;
  lastActive?: Date;
}

export class WhatsAppService {
  private client: Client | null = null;
  private sessions: Session[] = [];
  private currentQr: string | null = null;

  constructor() {}

  public async createNewSession(ws: WebSocket): Promise<string> {
    const sessionId = `session_${Date.now()}`;
    const clientId = `client_${sessionId}`;

    const client = new Client({
      authStrategy: new LocalAuth({ clientId }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    const newSession: Session = {
      id: sessionId,
      ws,
      client,
      status: 'pending',
      lastActive: new Date()
    };

    this.sessions.push(newSession);
    this.setupEventListeners(client, sessionId);
    
    try {
      await client.initialize();
      await this.persistSession({
        sessionId,
        clientId,
        status: 'pending',
        lastActive: new Date()
      });
      return sessionId;
    } catch (error) {
      console.error('Client initialization failed:', error);
      this.cleanupSession(sessionId);
      throw error;
    }
  }

  public async loadPersistedSessions() {
    try {
      const dbSessions = await DBSession.find({ status: "ready" });
      await Promise.all(dbSessions.map(async (dbSession) => {
        try {
          const client = new Client({
            authStrategy: new LocalAuth({ clientId: dbSession.clientId }),
            puppeteer: { 
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
          });

          const sessionId = dbSession.sessionId;
          const ws = null; 
          this.setupEventListeners(client, sessionId);
          await client.initialize();
          
          this.sessions.push({
            id: sessionId,
            ws: null as unknown as WebSocket,
            client,
            status: "ready",
            phoneNumber: dbSession.phoneNumber,
            lastActive: dbSession.lastActive
          });

        } catch (error) {
          console.error(`Failed to restore session ${dbSession.sessionId}:`, error);
          await DBSession.deleteOne({ sessionId: dbSession.sessionId });
        }
      }));

    } catch (error) {
      console.error("Error loading persisted sessions:", error);
    }
  }

  private setupEventListeners(client: Client, sessionId: string): void {
    if (!client) {
        console.error('Cannot setup listeners - client is null');
        return;
    }

    // Store reference to client
    this.client = client;

    // Debugging: Log all events for troubleshooting
    client.on('*', (event) => {
        console.debug(`[${sessionId}] Event: ${event}`);
    });

    // QR Code Generation
    client.on('qr', async (qr: string) => {
      console.log(`QR received for session ${sessionId}`);
      
      this.currentQr = qr;
      
      const sessionData = {
        sessionId,
        clientId: this.getClientId(client) || 'pending',
        status: 'pending' as const,
        qrCode: qr,  // This is now allowed
        lastActive: new Date()
      };
    
      try {
        // Update in-memory session - now type-safe
        this.updateSession(sessionId, { 
          qrCode: qr,
          lastActive: new Date(),
          status: 'pending'
        });
    
        // Persist to database
        const dbResult = await this.persistSession(sessionData);
        console.log('Session persisted:', dbResult);
    
        // Send to client
        this.sendToSession(sessionId, {
          action: 'qr',
          qrCode: qr,
          sessionId
        });
      } catch (error) {
        console.error('QR handling failed:', error);
      }
    });

    // Authentication
    client.on('authenticated', async (session: unknown) => {
        const authSession = session as WhatsAppAuthSession;
        const phoneNumber = authSession?.wid?.user || undefined;
        const serialized = authSession?.wid?._serialized || '';

        console.log(`Authenticated: ${phoneNumber || 'Unknown number'}`);

        try {
            // Update database
            await this.persistSession({
                sessionId,
                clientId: this.getClientId(client),
                status: 'authenticated',
                phoneNumber,
                lastActive: new Date()
            });

            // Update in-memory session
            this.updateSession(sessionId, {
                status: 'authenticated',
                phoneNumber,
                lastActive: new Date()
            });

            // Notify client
            this.sendToSession(sessionId, {
                action: 'authenticated',
                sessionId,
                phoneNumber,
                serializedId: serialized
            });
        } catch (error) {
            console.error('Authentication handling failed:', error);
        }
    });

    // Ready State
    client.on('ready', async () => {
        console.log(`Client ready (${sessionId})`);
        console.log('Client info:', client.info);

        try {
            // Update database
            await this.persistSession({
                sessionId,
                clientId: this.getClientId(client),
                status: 'ready',
                lastActive: new Date()
            });

            // Update in-memory session
            this.updateSession(sessionId, {
                status: 'ready',
                lastActive: new Date()
            });

            // Notify client
            this.sendToSession(sessionId, {
                action: 'ready',
                sessionId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Ready state handling failed:', error);
        }
    });

    // Message Handling (unchanged)
    client.on('message', (msg: Message) => {
        if (msg.fromMe) return;
        console.log(`New message from ${msg.from}: ${msg.body}`);
        this.sendToSession(sessionId, {
            action: 'message',
            sessionId,
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp
        });
    });

    // Disconnection
    client.on('disconnected', (reason: string) => {
        console.log(`Disconnected (${reason})`);
        this.sendToSession(sessionId, {
            action: 'disconnected',
            sessionId,
            reason,
            timestamp: new Date().toISOString()
        });
        this.cleanupSession(sessionId);
    });

    // Error Handling
    client.on('auth_failure', (msg: string) => {
        console.error(`Auth failure: ${msg}`);
        this.sendToSession(sessionId, {
            action: 'auth_failure',
            sessionId,
            message: msg
        });
    });

    client.on('change_state', (state: string) => {
        console.log(`State changed: ${state}`);
        this.sendToSession(sessionId, {
            action: 'state_change',
            sessionId,
            state
        });
    });
}

  private getClientId(client: Client): string {
  
    if (client.info?.wid?._serialized) {
      return client.info.wid._serialized;
    }
    
    const authStrategy = (client as any).options?.authStrategy?.options;
    if (authStrategy?.clientId) {
      return authStrategy.clientId;
    }

    return 'unknown-client-id';
  }

  private async persistSession(sessionData: {
    sessionId: string;
    clientId: string;
    status: 'pending' | 'authenticated' | 'ready';
    phoneNumber?: string;
    qrCode?: string;
    lastActive: Date;
  }) {
    try {
      // Get the client from active sessions
      const session = this.sessions.find(s => s.id === sessionData.sessionId);
      if (!session) {
        console.warn(`Session ${sessionData.sessionId} not found in active sessions`);
        return;
      }
  
      // Safely access client ID with fallbacks
      const clientId = session?.client?.info?.wid?._serialized 
        || sessionData.clientId 
        || 'unknown';
  
      if (!clientId) {
        throw new Error('Unable to determine client ID for session persistence');
      }
  
      const updateData = {
        ...sessionData,
        clientId,
        lastActive: sessionData.lastActive || new Date()
      };
  
      await DBSession.findOneAndUpdate(
        { sessionId: sessionData.sessionId },
        updateData,
        { upsert: true, new: true }
      );
  
      console.log(`Session ${sessionData.sessionId} persisted successfully`);
    } catch (error) {
      console.error('Failed to persist session:', error);
      throw error; 
    }
  }

  private async removePersistedSession(sessionId: string) {
    await DBSession.deleteOne({ sessionId });
  }

  private sendToSession(sessionId: string, data: any): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;

    try {
      session.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error sending to WebSocket:', error);
    }
  }

  private async safeDestroyClient(): Promise<void> {
    try {
      if (this.client) {
        await this.client.destroy();
      }
    } catch (error) {
      console.error('Error destroying client:', error);
    } finally {
      this.client = null;
    }
  }

  private updateSession(sessionId: string, updates: Partial<Session>): void {
    this.sessions = this.sessions.map(session => 
      session.id === sessionId ? { ...session, ...updates } : session
    );
  }

  public getActiveSessions(): Session[] {
    return this.sessions.filter(s => s.status === 'ready');
  }

  public getPendingSessions(): Session[] {
    return this.sessions.filter(s => s.status === 'pending');
  }

  public getActiveSessionsCount(): number {
    return this.getActiveSessions().length;
  }

  public cleanupSession(sessionId: string): void {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    if (this.sessions.length === 0) {
      this.safeDestroyClient();
    }
  }

  public removeWebSocket(ws: WebSocket): void {
    this.sessions = this.sessions.filter(session => session.ws !== ws);
    if (this.sessions.length === 0) {
      this.safeDestroyClient();
    }
  }

  public async cleanupAllSessions(): Promise<void> {
    this.sessions = [];
    await this.safeDestroyClient();
  }
}