import toast from 'react-hot-toast';

export const showSuccess = (message: string) => toast.success(message, {
  style: { background: '#10b981', color: '#fff' },
  duration: 3000,
});

export const showError = (message: string) => toast.error(message, {
  style: { background: '#ef4444', color: '#fff' },
  duration: 5000,
});

export const showInfo = (message: string) => toast(message, {
  icon: 'ℹ️',
  duration: 3000,
});
