import React, { useState, useEffect, useCallback } from "react";
import { Card, Button, Row, Col, message, Switch, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import QRCard from "./components/QRCard";
import AccountCard from "./components/AccountCard";

const WS_URL = "ws://localhost:3000";

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

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      message.success("🔗 WebSocket подключен!");
      setWs(socket);
      setIsConnected(true);
      
      // Request initial data
      socket.send(JSON.stringify({ 
        action: "get_initial_data" 
      }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.action === "qr") {
          message.destroy();
          message.info("📲 QR-код получен. Отсканируйте для входа!");
          setQrCards(prev => [
            ...prev, 
            { 
              id: data.sessionId || Date.now().toString(), 
              qrUrl: data.qrCode,
              sessionId: data.sessionId
            }
          ]);
        }
        else if (data.action === "authenticated") {
          message.success("✅ Авторизация успешна!");
          setQrCards(prev => prev.filter(qr => qr.sessionId !== data.sessionId));
        }
        else if (data.action === "authorized_users") {
          setAuthorizedUsers(data.users);
        }
        else if (data.action === "session_created") {
          setLoading(false);
          message.success("Сессия создана. Ожидайте QR-код...");
        }
        else if (data.action === "sessions_update") {
          setAccounts(data.sessions);
        } 
        else if (data.action === "sessions_validated") {
          const { validSessions } = data;
          setAccounts(validSessions);
          localStorage.setItem('last_sessions', JSON.stringify(validSessions));
        }
        else if (data.action === "error") {
          setLoading(false);
          message.error(data.message || "Произошла ошибка");
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
  }, [isConnected]);

  // Initialize WebSocket connection
  useEffect(() => {
    const socket = connectWebSocket();
    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (accounts.length > 0) {
      localStorage.setItem('last_sessions', JSON.stringify(accounts));
    } else {
      localStorage.removeItem('last_sessions');
    }
  }, [accounts]);
  
  useEffect(() => {
    if (accounts.length > 0) {
      localStorage.setItem('last_sessions', JSON.stringify(accounts));
    }
  }, [accounts]);

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
  const handleLogout = (sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      message.error("WebSocket не подключен");
      return;
    }

    ws.send(JSON.stringify({ 
      action: "delete_session", 
      sessionId 
    }));
  };

  // Handle QR close
  const handleCloseQR = (id: string) => {
    setQrCards(prev => prev.filter(qr => qr.id !== id));
  };

  return (
    <div style={{ padding: 20 }}>
      <Row gutter={[16, 16]} justify="center">
        {/* Display authorized users first */}
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
        
        {/* Display other sessions */}
        {accounts
          .filter(acc => !authorizedUsers.some(u => u.id === acc.id))
          .map(acc => (
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