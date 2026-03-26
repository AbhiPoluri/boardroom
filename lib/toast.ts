// Simple pub/sub toast system — no React context required.
// Import `toast` anywhere and call toast.success/error/info.

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

type ToastListener = (toasts: ToastMessage[]) => void;

class ToastBus {
  private toasts: ToastMessage[] = [];
  private listeners: Set<ToastListener> = new Set();
  private MAX = 3;

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      listener([...this.toasts]);
    }
  }

  add(type: ToastType, message: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: ToastMessage = { id, type, message };
    // Trim to max, oldest first
    this.toasts = [...this.toasts.slice(-(this.MAX - 1)), entry];
    this.emit();

    // Auto-dismiss after 4s
    setTimeout(() => this.dismiss(id), 4000);
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.emit();
  }

  success(message: string) { this.add('success', message); }
  error(message: string)   { this.add('error', message); }
  info(message: string)    { this.add('info', message); }
}

export const toast = new ToastBus();
