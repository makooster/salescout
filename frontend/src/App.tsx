import React, { useState, useEffect, useCallback } from "react";
import { Card, Button, Row, Col, message, Switch, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import QRCard from "./components/QRCard";
import AccountCard from "./components/AccountCard";

const WS_URL = "ws://localhost:3000";
const API_URL = "http://localhost:3000";

interface Account {
  id: string;
  name: string;
  number: string;
  status: 'pending' | 'authenticated' | 'ready';
  sessionId: string;
}

interface QR {
  id: string;
  qrUrl: string;
  sessionId?: string;
  expiresAt?: number;
}

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<Account[]>([]);
  const [qrCards, setQrCards] = useState<QR[]>([]);
  const [warming, setWarming] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  
  const fetchAppData = useCallback(async (showQRCodes = false) => {
    
    try {
      
      setLoading(true);
      const [sessionsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/api/sessions`),
        fetch(`${API_URL}/api/authorized-users`)
      ]);
      
      const [sessions, users] = await Promise.all([
        sessionsRes.json(),
        usersRes.json(),
      ]);
  
      const normalizedSessions = sessions.map((s: any) => ({
        ...s,
        number: s.number || s.phoneNumber || s.id.slice(-4) 
      }));

      setAccounts(normalizedSessions);
      setAuthorizedUsers(users);
      console.log('Raw API response:', { sessions, users });
      if (showQRCodes) {
        const pendingSessions = sessions.filter((s: Account) => s.status === 'pending');
        setQrCards(pendingSessions.map((s: any) => ({
          id: s.sessionId,
          qrUrl: s.qrCode,
          sessionId: s.sessionId,
          expiresAt: Date.now() + 60000
        })));
      }
  
      localStorage.setItem('last_sessions', JSON.stringify(normalizedSessions));
    } catch (error) {
      console.error('Failed to fetch data:', error);
      message.error('Failed to load sessions');
      
      const lastSessions = localStorage.getItem('last_sessions');
      if (lastSessions) {
        setAccounts(JSON.parse(lastSessions));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const allSessions = [...authorizedUsers, ...accounts].reduce((unique, session) => {
    if (!unique.some(s => s.sessionId === session.sessionId)) {
      unique.push(session);
    }
    return unique;
  }, [] as Account[]);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const socket = new WebSocket(WS_URL);
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    socket.onopen = () => {
      reconnectAttempts = 0;
      message.success("🔗 WebSocket подключен!");
      setWs(socket);
      setIsConnected(true);
      fetchAppData(); 
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.action) {
          case "qr":
            message.info("📲 QR-код получен. Отсканируйте для входа!");
            setQrCards(prev => {
              const sessionId = data.sessionId;
              const existing = prev.find(card => card.sessionId === sessionId);
            
              if (existing) {
                return prev.map(card =>
                  card.sessionId === sessionId
                    ? { ...card, qrUrl: data.qrCode }
                    : card
                );
              } else {
                return [
                  ...prev,
                  {
                    id: sessionId || Date.now().toString(),
                    qrUrl: data.qrCode,
                    sessionId: sessionId
                  }
                ];
              }
            });
            
            break;
          case "authenticated":
            message.success("✅ Авторизация успешна!");
            setQrCards(prev => prev.filter(qr => qr.sessionId !== data.sessionId));
            fetchAppData(); 
            break;
            
          case "session_created":
            setLoading(false);
            message.success("Сессия создана. Ожидайте QR-код...");
            break;
            
          case "sessions_update":
          case "authorized_users":
            const allSessions = Array.isArray(data.sessions) ? data.sessions : [];
            const uniqueSessions = allSessions.reduce((acc: Account[], session: Account) => {
              if (!acc.some((s: Account) => s.sessionId === session.sessionId)) {
                acc.push(session);
              }
              return acc;
            }, []);
            // Update state with the unique sessions
            if (data.action === "sessions_update") {
              setAccounts(uniqueSessions);
            } else {
              setAuthorizedUsers(uniqueSessions);
            }
            break;
            
          case "sessions_validated":
            fetchAppData(); 
            break;
            
          case "error":
            setLoading(false);
            message.error(data.message || "Произошла ошибка");
            break;
        }
      } catch (error) {
        console.error("Ошибка обработки сообщения:", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      if (!isConnected) {
        message.error("⚠ Ошибка подключения к WebSocket");
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        message.warning(`WebSocket disconnected. Reconnecting in ${Math.round(delay/1000)}s...`);
        setTimeout(connectWebSocket, delay);
      } else {
        message.error("Max reconnection attempts reached. Please refresh the page.");
      }
    };

    return socket;
  }, [ ws, isConnected, fetchAppData]);

  // Initialize connection and data loading
useEffect(() => {
  const socket = connectWebSocket();
  fetchAppData(false);
  
  return () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };
}, [connectWebSocket, fetchAppData]);

  useEffect(() => {
    console.log('Current sessions data:', {
      accounts,
      authorizedUsers,
      allSessions: [...accounts, ...authorizedUsers]
    });
  }, [accounts, authorizedUsers]);

  // Handle adding new account
  const handleAddAccount = () => {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      message.error("WebSocket не подключен");
      return;
    }
    setLoading(true);
    ws.send(JSON.stringify({ action: "create_session" }));
  };

  // Handle logout
  const handleLogout = async (sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      message.error("WebSocket connection not available");
      return;
    }
  
    try {
      const deleteResponse = await fetch(`${API_URL}/api/sessions/${sessionId}`, { 
        method: 'DELETE' 
      });
      
      if (!deleteResponse.ok) {
        throw new Error('Failed to delete session');
      }
  
      // Notify WebSocket
      ws.send(JSON.stringify({ 
        action: "delete_session", 
        sessionId 
      }));
  
      // Optimistic UI update
      setAccounts(prev => prev.filter(acc => acc.sessionId !== sessionId));
      setAuthorizedUsers(prev => prev.filter(user => user.sessionId !== sessionId));
  
      message.success("Session successfully deleted");
    } catch (error) {
      console.error("Logout failed:", error);
      message.error(error instanceof Error ? error.message : "Logout failed");
      
      await fetchAppData();
    }
  };

  // Handle QR close
  const handleCloseQR = (id: string) => {
    setQrCards(prev => prev.filter(qr => qr.id !== id));
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Accounts Section */}
      <Row gutter={[16, 16]} justify="center"> 
        {allSessions.map(session => (
        <Col key={session.sessionId} xs={24} sm={12} md={12} lg={12}>
          <AccountCard 
          name={session.name}
          number={session.number} 
          status={session.status}
          onLogout={() => handleLogout(session.sessionId)}
          sessionId={session.sessionId}
          />  
        </Col>
      ))}
        
        {/* Add Account Button */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card style={{ textAlign: "center", borderRadius: 12 }}>
            <Button 
              type="dashed" 
              icon={<PlusOutlined />} 
              block 
              onClick={handleAddAccount}
              disabled={loading || !isConnected}
            >
              {loading ? <Spin size="small" /> : 'Добавить аккаунт'}
            </Button>
          </Card>
        </Col>
      </Row>
  
      {/* QR Codes Section */}
      {qrCards.length > 0 && (
        <div>
          <h2 style={{ marginTop: 30, textAlign: "center" }}>
            Сгенерированные QR-коды
          </h2>
          <Row gutter={[16, 16]} justify="center" style={{ maxWidth: 1200, margin: '0 auto' }}> 
            {qrCards.map(qr => (
              <Col key={qr.id} xs={24} sm={12} md={8} lg={6}>
                <QRCard 
                  qrUrl={qr.qrUrl} 
                  onClose={() => handleCloseQR(qr.id)} 
                />
              </Col>
            ))}
          </Row>
        </div>
      )}
  
      {/* Warming Switch */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <Switch checked={warming} onChange={setWarming} /> Вкл. Прогрев
      </div>
    </div>
  );
};

export default App;