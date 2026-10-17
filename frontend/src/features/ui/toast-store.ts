import { create } from "zustand";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Optional inline action, e.g. the Undo offered after a soft delete. */
  action?: ToastAction;
  /** Milliseconds before auto-dismiss; defaults to 5s (8s when an action exists). */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

/** Global toast store — every action gives visible feedback (PRD §7.7). */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    // Auto-dismiss after 5s (8s when the toast carries an Undo action).
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      toast.duration ?? (toast.action ? 8000 : 5000),
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(toast: Omit<Toast, "id">): void {
  useToastStore.getState().push(toast);
}
