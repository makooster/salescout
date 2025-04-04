import { Button, Card } from 'antd';
import QRCode from 'qrcode.react';
import '../styles/QRCard.css';

interface QRCardProps {
  qrUrl: string;
  expiresAt?: Date;
  onClose: () => void;
}

const QRCard: React.FC<QRCardProps> = ({ qrUrl, onClose }) => (
  <Card className="qr-card">
    <div className="qr-container">
      <p className="qr-title">Сканируйте QR для входа</p>
      <div className="qr-code-wrapper">
        <QRCode 
          value={qrUrl || " "} 
          size={256}
          level="H"
          includeMargin
        />
      </div>
      {onClose && (
        <Button 
          type="primary" 
          onClick={onClose}
          className="qr-close-button"
        >
          Закрыть
        </Button>
      )}
    </div>
  </Card>
);

export default QRCard;