import { Button, Card, Tag, Spin, Popconfirm, Tooltip } from 'antd';
import { 
  CheckCircleOutlined, 
  SyncOutlined, 
  ClockCircleOutlined,
  LogoutOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons';
import { useState } from 'react';
import '../styles/AccountCard.css';

interface AccountCardProps {
  name: string;
  number: string;
  status: 'pending' | 'authenticated' | 'ready';
  onLogout: (sessionId: string) => Promise<void>;
  sessionId: string;
}

const AccountCard: React.FC<AccountCardProps> = ({ 
  name, 
  number, 
  status, 
  onLogout,
  sessionId
}) => {
  const [logoutLoading, setLogoutLoading] = useState(false);

  const handleConfirmLogout = async () => {
    try {
      setLogoutLoading(true);
      await onLogout(sessionId);
    } finally {
      setLogoutLoading(false);
    }
  };

  const statusConfig = {
    ready: {
      icon: <CheckCircleOutlined />,
      color: 'success',
      text: 'Active'
    },
    authenticated: {
      icon: <SyncOutlined spin />,
      color: 'processing',
      text: 'Authenticating'
    },
    pending: {
      icon: <ClockCircleOutlined />,
      color: 'warning',
      text: 'Pending'
    }
  };

  return (
    <Card 
      title={
        <div className="account-title">
          <span className="account-name">{name}</span>
          <Tag 
            icon={statusConfig[status].icon} 
            color={statusConfig[status].color}
            style={{ marginLeft: 8 }}
          >
            {statusConfig[status].text}
          </Tag>
        </div>
      }
      extra={
        <Popconfirm
          title="Are you sure you want to logout?"
          icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
          onConfirm={handleConfirmLogout}
          okText="Yes"
          cancelText="No"
          placement="topRight"
          okButtonProps={{ loading: logoutLoading }}
        >
          <Tooltip title="Logout">
            <Button 
              type="primary" 
              danger
              icon={<LogoutOutlined />}
              loading={logoutLoading}
              style={{ padding: '0 12px', height: '32px' }}
            />
          </Tooltip>
        </Popconfirm>
      }
      className="account-card"
      hoverable
    >
      <div className="account-details">
        <p className="account-number">
          <strong>Number:</strong> {number || 'Not specified'}
        </p>

        {status === 'pending' && (
          <div className="pending-notice">
            <Spin size="small" />
            <span style={{ marginLeft: 8 }}>Waiting for QR scan</span>
          </div>
        )}
      </div>
    </Card>
  );
};

export default AccountCard;