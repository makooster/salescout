import React, { useState, useEffect, useCallback } from "react";
import { Card, Button, Row, Col, message, Switch, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import QRCard from "./components/QRCard";
import AccountCard from "./components/AccountCard";

const API_BASE_URL = "http://localhost:3000";
const WS_URL = "ws://localhost:3000";

interface Account {
  id: string;
  name: string;
  number: string;
  status: 'pending' | 'authenticated' | 'ready';
}

interface QR {
  id: string;
  qrUrl: string;
  sessionId?: string;
}

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [qrCards, setQrCards] = useState<QR[]>([]);
  const [warming, setWarming] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      message.success("🔗 WebSocket подключен!");
      setWs(socket);
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
        else if (data.action === "ready") {
          message.success("✅ WhatsApp готов к использованию!");
          fetchAccounts();
        }
        else if (data.action === "session_created") {
          setLoading(false);
          message.success("Сессия создана. Ожидайте QR-код...");
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
      message.error("⚠ Ошибка WebSocket");
      console.error("WebSocket error:", error);
    };

    socket.onclose = () => {
      message.warning("⚠ WebSocket отключен. Переподключение...");
      setTimeout(connectWebSocket, 5000);
    };

    setWs(socket);
    return () => socket.close();
  }, []);

  // Fetch authorized accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/authorized-users`);
      const data: Account[] = await response.json();
      setAccounts(data);
    } catch (error) {
      console.error("Ошибка загрузки аккаунтов", error);
      message.error("Не удалось загрузить аккаунты");
    }
  }, []);

  // Initialize connection and data
  useEffect(() => {
    connectWebSocket();
    fetchAccounts();
  }, [connectWebSocket, fetchAccounts]);

  // Handle adding new account
  const handleAddAccount = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      message.error("❌ WebSocket не подключен!");
      return;
    }

    setLoading(true);
    try {
      ws.send(JSON.stringify({ action: "create_session" }));
      message.loading("⏳ Создание сессии...");
    } catch (error) {
      setLoading(false);
      message.error("Ошибка при создании сессии");
      console.error(error);
    }
  };

  // Handle QR close
  const handleCloseQR = (id: string) => {
    setQrCards(prev => prev.filter(qr => qr.id !== id));
  };

  return (
    <div style={{ padding: 20 }}>
      <Row gutter={[16, 16]} justify="center">
        {accounts.map((acc) => (
          <Col key={acc.id} xs={24} sm={12} md={8} lg={6}>
            <AccountCard 
              name={acc.name}
              number={acc.number}
              status={acc.status}
              onLogout={() => console.log("Выход", acc.number)} 
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
              disabled={loading}
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