import { Injectable, signal, computed } from '@angular/core';

export interface SelectionState {
  readonly selectedIds: ReadonlySet<string>;
  readonly anchorId: string | null;
}

@Injectable({ providedIn: 'root' })
export class SelectionService {
  private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());
  private readonly _anchorId = signal<string | null>(null);

  readonly selectedIds = this._selectedIds.asReadonly();
  readonly anchorId = this._anchorId.asReadonly();
  readonly count = computed(() => this._selectedIds().size);
  readonly hasSelection = computed(() => this._selectedIds().size > 0);

  /** Single click — select one, deselect all others */
  select(id: string): void {
    this._selectedIds.set(new Set([id]));
    this._anchorId.set(id);
  }

  /** Ctrl+Click — toggle individual item */
  toggleSelect(id: string): void {
    this._selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    this._anchorId.set(id);
  }

  /** Shift+Click — range select from anchor to target */
  rangeSelect(id: string, orderedIds: readonly string[]): void {
    const anchor = this._anchorId();
    if (anchor === null) {
      this.select(id);
      return;
    }

    const anchorIndex = orderedIds.indexOf(anchor);
    const targetIndex = orderedIds.indexOf(id);

    if (anchorIndex === -1 || targetIndex === -1) {
      this.select(id);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const rangeIds = orderedIds.slice(start, end + 1);

    this._selectedIds.update((set) => {
      const next = new Set(set);
      for (const rangeId of rangeIds) {
        next.add(rangeId);
      }
      return next;
    });
  }

  /** Ctrl+A — select all visible items */
  selectAll(ids: readonly string[]): void {
    this._selectedIds.set(new Set(ids));
  }

  /** Clear all selections */
  clearSelection(): void {
    this._selectedIds.set(new Set());
    this._anchorId.set(null);
  }

  /** Check if an item is selected */
  isSelected(id: string): boolean {
    return this._selectedIds().has(id);
  }

  /** Handle a click event with modifier key detection */
  handleClick(id: string, event: MouseEvent | KeyboardEvent, orderedIds: readonly string[]): void {
    if (event.ctrlKey || event.metaKey) {
      this.toggleSelect(id);
    } else if (event.shiftKey) {
      this.rangeSelect(id, orderedIds);
    } else {
      this.select(id);
    }
  }
}
