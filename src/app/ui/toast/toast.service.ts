import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  readonly label: string;
  readonly callback: () => void;
}

export interface ToastItem {
  readonly id: number;
  readonly type: ToastType;
  readonly message: string;
  readonly action?: ToastAction;
  readonly duration: number;
}

const DEFAULT_DURATION_MS = 5000;
const UNDO_DURATION_MS = 8000;
const MAX_VISIBLE = 3;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<readonly ToastItem[]>([]);

  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string, action?: ToastAction): void {
    this.add('success', message, action);
  }

  error(message: string, action?: ToastAction): void {
    this.add('error', message, action);
  }

  info(message: string, action?: ToastAction): void {
    this.add('info', message, action);
  }

  warning(message: string, action?: ToastAction): void {
    this.add('warning', message, action);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private add(type: ToastType, message: string, action?: ToastAction): void {
    const duration = action ? UNDO_DURATION_MS : DEFAULT_DURATION_MS;
    const id = this.nextId++;
    const toast: ToastItem = { id, type, message, action, duration };

    this.toasts.update((list) => {
      const updated = [...list, toast];
      if (updated.length > MAX_VISIBLE) {
        const removed = updated.shift()!;
        this.clearTimer(removed.id);
      }
      return updated;
    });

    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, duration);

    this.timers.set(id, timer);
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
