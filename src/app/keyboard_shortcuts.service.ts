import { Injectable, NgZone, DestroyRef, inject, signal } from '@angular/core';

type ShortcutHandler = () => void;

interface ShortcutBinding {
  readonly key: string;
  readonly handler: ShortcutHandler;
  readonly requiresNoModifiers?: boolean;
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bindings = new Map<string, ShortcutBinding>();
  private readonly sequenceBuffer = signal<string | null>(null);
  private sequenceTimer: ReturnType<typeof setTimeout> | null = null;
  private listener: ((event: KeyboardEvent) => void) | null = null;

  constructor() {
    this.zone.runOutsideAngular(() => {
      this.listener = (event: KeyboardEvent) => this.handleKeydown(event);
      document.addEventListener('keydown', this.listener);
    });

    this.destroyRef.onDestroy(() => {
      if (this.listener !== null) {
        document.removeEventListener('keydown', this.listener);
        this.listener = null;
      }
      this.clearSequenceTimer();
    });
  }

  register(key: string, handler: ShortcutHandler): void {
    this.bindings.set(key, { key, handler, requiresNoModifiers: true });
  }

  registerSequence(prefix: string, suffix: string, handler: ShortcutHandler): void {
    this.bindings.set(`${prefix}+${suffix}`, { key: `${prefix}+${suffix}`, handler });
  }

  unregister(key: string): void {
    this.bindings.delete(key);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.isInputFocused(event)) {
      return;
    }

    const pendingPrefix = this.sequenceBuffer();

    if (pendingPrefix !== null) {
      this.clearSequenceTimer();
      this.sequenceBuffer.set(null);

      const seqKey = `${pendingPrefix}+${event.key}`;
      const binding = this.bindings.get(seqKey);
      if (binding) {
        event.preventDefault();
        this.zone.run(() => binding.handler());
        return;
      }
    }

    if (event.key === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.sequenceBuffer.set('g');
      this.sequenceTimer = setTimeout(() => {
        this.sequenceBuffer.set(null);
      }, 1000);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    const binding = this.bindings.get(event.key);
    if (binding) {
      event.preventDefault();
      this.zone.run(() => binding.handler());
    }
  }

  private isInputFocused(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;

    const dialog = target.closest('[role="dialog"]');
    if (dialog) return true;

    return false;
  }

  private clearSequenceTimer(): void {
    if (this.sequenceTimer !== null) {
      clearTimeout(this.sequenceTimer);
      this.sequenceTimer = null;
    }
  }
}
