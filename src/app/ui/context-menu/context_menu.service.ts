import { Injectable, signal } from '@angular/core';

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dividerAfter?: boolean;
}

export interface ContextMenuState {
  readonly items: readonly ContextMenuItem[];
  readonly x: number;
  readonly y: number;
  readonly targetId: string;
  readonly targetType: string;
}

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<ContextMenuState | null>(null);

  open(config: ContextMenuState): void {
    const viewportWidth = globalThis.innerWidth ?? 1024;
    const viewportHeight = globalThis.innerHeight ?? 768;
    const menuWidth = 240;
    const itemHeight = 36;
    const estimatedHeight = config.items.length * itemHeight + 16;

    const x = config.x + menuWidth > viewportWidth
      ? Math.max(0, config.x - menuWidth)
      : config.x;
    const y = config.y + estimatedHeight > viewportHeight
      ? Math.max(0, config.y - estimatedHeight)
      : config.y;

    this.state.set({ ...config, x, y });
  }

  close(): void {
    this.state.set(null);
  }

  get isOpen(): boolean {
    return this.state() !== null;
  }
}
