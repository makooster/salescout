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
  client?: Client;
  status: 'pending' | 'authenticated' | 'ready';
  phoneNumber?: string;
  lastActive: Date;
}

export class WhatsAppService {
  private client: Client | null = null;
  private sessions: Session[] = [];
  private currentQr: string | null = null;

  constructor() {}

  public async createNewSession(ws: WebSocket): Promise<string> {
    if (this.client) {
      await this.safeDestroyClient();
    }

    const sessionId = `session_${Date.now()}`;
    const newSession: Session = {
      id: sessionId,
      ws,
      status: 'pending',
      lastActive: new Date()
    };

    this.sessions.push(newSession);
    await this.initializeWhatsAppClient(sessionId);
    return sessionId;
  }

  private async initializeWhatsAppClient(sessionId: string): Promise<void> {
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    this.setupEventListeners(sessionId);
    
    try {
      await this.client.initialize();
      this.updateSession(sessionId, { client });
      await this.persistSession({
        sessionId,
        clientId,
        status: 'pending'
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
            ws,
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

  private setupEventListeners(sessionId: string): void {

    if (!this.client) return;
     // QR Code Generation - using string type instead of QRCode
     this.client.on('qr', (qr: string) => {
      console.log(`QR received for session ${sessionId}`);
      this.currentQr = qr;
      this.updateSession(sessionId, { lastActive: new Date() });
      this.sendToSession(sessionId, {
        action: 'qr',
        qrCode: qr,
        sessionId
      });
      this.persistSession({
        sessionId,
        clientId: client.options.authStrategy.options.clientId,
        status: 'pending',
        qrCode: qr
      });
    });

    // Authentication
    this.client.on('authenticated', async (session: unknown) => {
      const authSession = session as WhatsAppAuthSession;
      const phoneNumber = authSession?.wid?.user || undefined;
      const serialized = authSession?.wid?._serialized || '';

      console.log(`Authenticated: ${phoneNumber || 'Unknown number'}`);

      await this.persistSession({
        sessionId,
        clientId: client.options.authStrategy.options.clientId,
        status: 'authenticated',
        phoneNumber
      });

      this.updateSession(sessionId, {
        status: 'authenticated',
        phoneNumber,
        lastActive: new Date()
      });

      this.sendToSession(sessionId, {
        action: 'authenticated',
        sessionId,
        phoneNumber,
        serializedId: serialized
      });
    });

    // Ready State
    this.client.on('ready', async () => {
      console.log(`Client ready (${sessionId})`);

      await this.persistSession({
        sessionId,
        clientId: client.options.authStrategy.options.clientId,
        status: 'ready',
        lastActive: new Date()
      });

      this.updateSession(sessionId, {
        status: 'ready',
        lastActive: new Date()
      });

      this.sendToSession(sessionId, {
        action: 'ready',
        sessionId,
        timestamp: new Date().toISOString()
      });
    });

    // Message Handling
    this.client.on('message', (msg: Message) => {
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
    this.client.on('disconnected', (reason: string) => {
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
    this.client.on('auth_failure', (msg: string) => {
      console.error(`Auth failure: ${msg}`);
      this.sendToSession(sessionId, {
        action: 'auth_failure',
        sessionId,
        message: msg
      });
    });

    this.client.on('change_state', (state: string) => {
      console.log(`State changed: ${state}`);
      this.sendToSession(sessionId, {
        action: 'state_change',
        sessionId,
        state
      });
    });
  }

  private async persistSession(sessionData: {
    sessionId: string;
    clientId: string;
    status: 'pending' | 'authenticated' | 'ready';
    phoneNumber?: string;
    qrCode?: string;
  }) {
    await DBSession.findOneAndUpdate(
      { sessionId: sessionData.sessionId },
      sessionData,
      { upsert: true }
    );
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

  private sendToSession(sessionId: string, data: any): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return;

    try {
      session.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error sending to WebSocket:', error);
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