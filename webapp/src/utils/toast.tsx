import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Toast, ToastBody, ToastHeader } from 'reactstrap';

interface ToastMessage {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    const newToast: ToastMessage = { id, message, type };
    
    setToasts((prev) => [...prev, newToast]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const getToastColor = (type?: string) => {
    switch (type) {
      case 'success': return 'success';
      case 'error': return 'danger';
      case 'warning': return 'warning';
      case 'info':
      default: return 'info';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            isOpen={true}
            className={`bg-${getToastColor(toast.type)} text-white`}
            style={{ minWidth: '300px' }}
          >
            <ToastHeader
              toggle={() => removeToast(toast.id)}
              className={`bg-${getToastColor(toast.type)} text-white`}
            >
              {toast.type === 'success' && 'Success'}
              {toast.type === 'error' && 'Error'}
              {toast.type === 'warning' && 'Warning'}
              {toast.type === 'info' && 'Info'}
            </ToastHeader>
            <ToastBody className="text-white">
              {toast.message}
            </ToastBody>
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

