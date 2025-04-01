import { Button, Card } from 'antd';
import '../styles/AccountCard.css';

interface AccountCardProps {
  name: string;
  number: string;
  status: 'pending' | 'authenticated' | 'ready';
  onLogout: () => void;
}

const AccountCard: React.FC<AccountCardProps> = ({ 
  name, 
  number, 
  status, 
  onLogout 
}) => (
  <Card 
    title={`${name} (${number})`}
    extra={
      <Button 
        type="primary" 
        danger
        onClick={onLogout}
        style={{ padding: '0 24px', height: '40px' }}
      >
        Выйти
      </Button>
    }
    className="account-card"
  >
    <p><strong>Статус:</strong> {status === 'ready' ? 'Active' : 
                               status === 'authenticated' ? 'Authenticating...' : 'Pending'}</p>
  </Card>
);

export default AccountCard;