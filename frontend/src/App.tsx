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
}

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<Account[]>([]);
  const [qrCards, setQrCards] = useState<QR[]>([]);
  const [warming, setWarming] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Unified data fetching function
  const fetchAppData = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/api/sessions`),
        fetch(`${API_URL}/api/authorized-users`)
      ]);
      
      const [sessions, users] = await Promise.all([
        sessionsRes.json(),
        usersRes.json()
      ]);

      setAccounts(sessions);
      setAuthorizedUsers(users);

      // Handle pending sessions with QR codes
      const pendingSessions = sessions.filter((s: any) => s.status === 'pending');
      setQrCards(pendingSessions.map((s: any) => ({
        id: s.sessionId,
        qrUrl: s.qrCode,
        sessionId: s.sessionId
      })));

      // Update localStorage
      localStorage.setItem('last_sessions', JSON.stringify(sessions));
    } catch (error) {
      console.error('Failed to fetch data:', error);
      message.error('Failed to load sessions');
      
      // Fallback to localStorage if API fails
      const lastSessions = localStorage.getItem('last_sessions');
      if (lastSessions) {
        setAccounts(JSON.parse(lastSessions));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      message.success("🔗 WebSocket подключен!");
      setWs(socket);
      setIsConnected(true);
      fetchAppData(); // Initial data load
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.action) {
          case "qr":
            message.info("📲 QR-код получен. Отсканируйте для входа!");
            setQrCards(prev => [
              ...prev, 
              { 
                id: data.sessionId || Date.now().toString(), 
                qrUrl: data.qrCode,
                sessionId: data.sessionId
              }
            ]);
            break;
            
          case "authenticated":
            message.success("✅ Авторизация успешна!");
            setQrCards(prev => prev.filter(qr => qr.sessionId !== data.sessionId));
            fetchAppData(); // Refresh data
            break;
            
          case "session_created":
            setLoading(false);
            message.success("Сессия создана. Ожидайте QR-код...");
            break;
            
          case "sessions_update":
          case "authorized_users":
          case "sessions_validated":
            fetchAppData(); // Refresh data
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
      message.warning("⚠ WebSocket отключен. Переподключение...");
      setTimeout(connectWebSocket, 5000);
    };

    return socket;
  }, [isConnected, fetchAppData]);

  // Initialize connection and data loading
  useEffect(() => {
    const socket = connectWebSocket();
    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [connectWebSocket]);

  // Handle adding new account
  const handleAddAccount = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      message.error("WebSocket не подключен");
      return;
    }
    setLoading(true);
    ws.send(JSON.stringify({ action: "create_session" }));
  };

  // Handle logout
  const handleLogout = async (sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      await fetch(`${API_URL}/api/sessions/${sessionId}`, { method: 'DELETE' });
      ws.send(JSON.stringify({ action: "delete_session", sessionId }));
      fetchAppData(); // Refresh data
      message.success("Сессия успешно удалена");
    } catch (error) {
      console.error("Error deleting session:", error);
      message.error("Ошибка при удалении сессии");
    }
  };

  // Handle QR close
  const handleCloseQR = (id: string) => {
    setQrCards(prev => prev.filter(qr => qr.id !== id));
  };

  // Filter out authorized users from accounts
  const nonAuthorizedAccounts = accounts.filter(
    acc => !authorizedUsers.some(u => u.id === acc.id)
  );

  return (
    <div style={{ padding: 20 }}>
      <Row gutter={[16, 16]} justify="center">
        {/* Authorized users */}
        {authorizedUsers.map(user => (
          <Col key={user.id} xs={24} sm={12} md={8} lg={6}>
            <AccountCard 
              name={user.name}
              number={user.number}
              status={user.status}
              onLogout={() => handleLogout(user.sessionId)}
            />
          </Col>
        ))}
        
        {/* Other sessions */}
        {nonAuthorizedAccounts.map(acc => (
          <Col key={acc.id} xs={24} sm={12} md={8} lg={6}>
            <AccountCard 
              name={acc.name}
              number={acc.number}
              status={acc.status}
              onLogout={() => handleLogout(acc.sessionId)}
            />
          </Col>
        ))}
        
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

      {qrCards.length > 0 && (
        <>
          <h2 style={{ marginTop: 30, textAlign: "center" }}>Сгенерированные QR-коды</h2>
          <Row gutter={[16, 16]} justify="center">
            {qrCards.map((qr) => (
              <Col key={qr.id} xs={24} sm={12} md={8} lg={6}>
                <QRCard 
                  qrUrl={qr.qrUrl} 
                  onClose={() => handleCloseQR(qr.id)} 
                />
              </Col>
            ))}
          </Row>
        </>
      )}

      <div style={{ marginTop: 20, textAlign: "center" }}>
        <Switch checked={warming} onChange={setWarming} /> Вкл. Прогрев
      </div>
    </div>
  );
};

export default App;