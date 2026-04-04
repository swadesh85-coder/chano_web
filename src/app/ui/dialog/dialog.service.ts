import {
  ApplicationRef,
  Injectable,
  signal,
  type ComponentRef,
} from '@angular/core';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogConfig {
  readonly title: string;
  readonly size?: DialogSize;
  readonly dismissOnOverlay?: boolean;
  readonly showClose?: boolean;
}

export interface DialogState {
  readonly config: DialogConfig;
  readonly visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly state = signal<DialogState | null>(null);

  private triggerElement: HTMLElement | null = null;

  open(config: DialogConfig): void {
    this.triggerElement = document.activeElement as HTMLElement | null;
    this.state.set({
      config: {
        size: 'md',
        dismissOnOverlay: true,
        showClose: true,
        ...config,
      },
      visible: true,
    });
  }

  close(): void {
    this.state.set(null);
    this.returnFocus();
  }

  get isOpen(): boolean {
    return this.state() !== null;
  }

  private returnFocus(): void {
    if (this.triggerElement && typeof this.triggerElement.focus === 'function') {
      setTimeout(() => this.triggerElement?.focus(), 0);
      this.triggerElement = null;
    }
  }
}
