import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { Session as DBSession } from "../models/Session";
import { WebSocket } from 'ws';

// ==================== Interfaces ====================
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
  qrGeneratedAt?: Date;
  qrTimeout?: NodeJS.Timeout;
}

export class WhatsAppService {
  // ==================== Properties ====================
  private client: Client | null = null;
  private sessions: Session[] = [];
  private currentQr: string | null = null;
  public onSessionUpdate: (() => void) | null = null;

  constructor() {}

  // ==================== Session Management ====================
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

  public cleanupSession(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session?.qrTimeout) {
      clearTimeout(session.qrTimeout);
    }
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
    this.sessions.forEach(session => {
      if (session.qrTimeout) {
        clearTimeout(session.qrTimeout);
      }
    });
    this.sessions = [];
    await this.safeDestroyClient();
  }

  // ==================== Session Operations ====================
  public updateSession(sessionId: string, updates: Partial<Session>): void {
    this.sessions = this.sessions.map(session => 
      session.id === sessionId ? { ...session, ...updates } : session
    );
    this.notifySessionUpdate();
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

  public async refreshQrCode(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !session.client) {
      throw new Error('Session not found or client not initialized');
    }
  
    try {
      if (session.qrTimeout) {
        clearTimeout(session.qrTimeout);
      }
  
      this.sendToSession(sessionId, {
        action: 'qr_refreshing',
        sessionId
      });
  
      if (session.client.pupBrowser) {
        await session.client.pupBrowser.close();
      }
      await session.client.initialize();
    } catch (error) {
      console.error('Error refreshing QR code:', error);
      this.sendToSession(sessionId, {
        action: 'qr_error',
        sessionId,
        message: 'Failed to refresh QR code'
      });
      throw error;
    }
  }

  // ==================== Session Data Access ====================
  public getActiveSessions(): Session[] {
    return this.sessions.filter(s => s.status === 'ready');
  }

  public getPendingSessions(): Session[] {
    return this.sessions.filter(s => s.status === 'pending');
  }

  public getActiveSessionsCount(): number {
    return this.getActiveSessions().length;
  }

  public getAuthorizedUsers() {
    return this.sessions
      .filter(session => session.status === 'ready')
      .map(session => ({
        id: session.id,
        name: session.phoneNumber || 'Unknown',
        number: session.phoneNumber || 'Unknown',
        status: session.status,
        sessionId: session.id,
        lastActive: session.lastActive
      }));
  }

  public async getActiveSessionsForAPI() {
    return this.sessions.map(session => ({
      id: session.id,
      status: session.status,
      phoneNumber: session.phoneNumber,
      lastActive: session.lastActive
    }));
  }

  public async getPersistedSessionsForAPI() {
    return await DBSession.find({});
  }

  // ==================== Event Listeners ====================
  private setupEventListeners(client: Client, sessionId: string): void {
    if (!client) {
      console.error('Cannot setup listeners - client is null');
      return;
    }

    this.client = client;

    // Debug events
    client.on('*', (event) => {
      console.debug(`[${sessionId}] Event: ${event}`);
    });
    
    // QR Code Handling
    client.on('qr', async (qr: string) => this.handleQrCode(sessionId, client, qr));
    
    // Authentication Events
    client.on('authenticated', async (session: unknown) => this.handleAuthenticated(sessionId, client, session));
    client.on('auth_failure', (msg: string) => this.handleAuthFailure(sessionId, msg));
    
    // Connection Events
    client.on('ready', async () => this.handleReady(sessionId, client));
    client.on('disconnected', (reason: string) => this.handleDisconnected(sessionId, reason));
    client.on('change_state', (state: string) => this.handleStateChange(sessionId, state));
    
    // Message Events
    client.on('message', (msg: Message) => this.handleMessage(sessionId, msg));
  }

  private async handleQrCode(sessionId: string, client: Client, qr: string) {
    console.log(`QR received for session ${sessionId}`);

    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (session.qrTimeout) {
      clearTimeout(session.qrTimeout);
    }

    const qrTimeout = setTimeout(() => {
      console.log(`QR expired for session ${sessionId}`);
      this.updateSession(sessionId, { 
        qrCode: undefined,
        qrTimeout: undefined
      });
      this.sendToSession(sessionId, {
        action: 'qr_expired',
        sessionId,
        message: 'QR code expired'
      });
    }, 40 * 1000);

    this.updateSession(sessionId, { 
      qrCode: qr,
      qrGeneratedAt: new Date(),
      qrTimeout,
      lastActive: new Date(),
      status: 'pending'
    });

    try {
      await this.persistSession({
        sessionId,
        clientId: this.getClientId(client) || 'pending',
        status: 'pending',
        qrCode: qr,
        lastActive: new Date()
      });
      
      this.sendToSession(sessionId, {
        action: 'qr',
        qrCode: qr,
        sessionId
      });
    } catch (error) {
      console.error('QR handling failed:', error);
    }
  }

  private async handleAuthenticated(sessionId: string, client: Client, session: unknown) {
    const authSession = session as WhatsAppAuthSession;
    const phoneNumber = authSession?.wid?.user || undefined;
    const serialized = authSession?.wid?._serialized || '';

    console.log(`Authenticated: ${phoneNumber || 'Unknown number'}`);

    try {
      await this.persistSession({
        sessionId,
        clientId: this.getClientId(client),
        status: 'authenticated',
        phoneNumber,
        lastActive: new Date()
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
    } catch (error) {
      console.error('Authentication handling failed:', error);
    }
  }

  private async handleReady(sessionId: string, client: Client) {
    console.log(`Client ready (${sessionId})`);
    
    const sessionData = {
      sessionId,
      clientId: this.getClientId(client),
      status: 'ready' as 'ready',
      phoneNumber: client.info?.wid?.user || undefined,
      lastActive: new Date()
    };

    await this.persistSession(sessionData);
    this.updateSession(sessionId, sessionData);
    this.notifySessionUpdate();
  }

  private handleMessage(sessionId: string, msg: Message) {
    if (msg.fromMe) return;
    console.log(`New message from ${msg.from}: ${msg.body}`);
    this.sendToSession(sessionId, {
      action: 'message',
      sessionId,
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp
    });
  }

  private handleDisconnected(sessionId: string, reason: string) {
    console.log(`Disconnected (${reason})`);
    this.sendToSession(sessionId, {
      action: 'disconnected',
      sessionId,
      reason,
      timestamp: new Date().toISOString()
    });
    this.cleanupSession(sessionId);
  }

  private handleAuthFailure(sessionId: string, msg: string) {
    console.error(`Auth failure: ${msg}`);
    this.sendToSession(sessionId, {
      action: 'auth_failure',
      sessionId,
      message: msg
    });
  }

  private handleStateChange(sessionId: string, state: string) {
    console.log(`State changed: ${state}`);
    this.sendToSession(sessionId, {
      action: 'state_change',
      sessionId,
      state
    });
  }

  // ==================== Database Operations ====================
  private async persistSession(sessionData: {
    sessionId: string;
    clientId: string;
    status: 'pending' | 'authenticated' | 'ready';
    phoneNumber?: string;
    qrCode?: string;
    lastActive: Date;
  }) {
    try {
      const session = this.sessions.find(s => s.id === sessionData.sessionId);
      if (!session) {
        console.warn(`Session ${sessionData.sessionId} not found in active sessions`);
        return;
      }
  
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

  // ==================== Utility Methods ====================
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

  private sendToSession(sessionId: string, data: any): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;

    try {
      session.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error sending to WebSocket:', error);
    }
  }

  private notifySessionUpdate() {
    if (this.onSessionUpdate) {
      this.onSessionUpdate();
    }
  }
}