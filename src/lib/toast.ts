import toast from 'react-hot-toast';

const BASE_STYLE = { borderRadius: '10px', fontSize: '13px' } as const;

export const showSuccess = (message: string) => toast.success(message, {
  style: { ...BASE_STYLE, background: '#10b981', color: '#fff', border: 'none' },
  duration: 3000,
});

export const showError = (message: string) => toast.error(message, {
  style: { ...BASE_STYLE, background: '#ef4444', color: '#fff', border: 'none' },
  duration: 5000,
});

export const showInfo = (message: string) => toast(message, {
  icon: 'ℹ️',
  // Inherits dark-mode-aware style from Toaster toastOptions
  duration: 3000,
});
