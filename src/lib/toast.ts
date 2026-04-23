export interface ToastOptions {
  message: string;
  kind?: "success" | "info" | "error";
}

type Listener = (opts: ToastOptions) => void;
const listeners: Listener[] = [];

export function showToast(opts: ToastOptions): void {
  listeners.forEach((l) => l(opts));
}

export function subscribeToToast(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i > -1) listeners.splice(i, 1);
  };
}
