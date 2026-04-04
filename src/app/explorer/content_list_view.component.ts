import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { FolderTreeViewModel, ThreadListViewModel } from '../../viewmodels';
import { SelectionService } from './selection.service';

type SortField = 'name' | 'type' | 'modified' | 'size';
type SortDirection = 'asc' | 'desc';

interface ListItem {
  readonly id: string;
  readonly name: string;
  readonly itemType: 'folder' | 'thread';
  readonly modified: string;
  readonly size: string;
  readonly icon: string;
}

@Component({
  selector: 'app-content-list-view',
  standalone: true,
  host: { class: 'content-list-view-host' },
  template: `
    <div class="content-list-view" role="table" aria-label="Content list">
      <div class="content-list-view__header" role="row">
        <div class="content-list-view__col content-list-view__col--checkbox" role="columnheader">
          <input type="checkbox"
            class="content-list-view__checkbox"
            [checked]="allSelected()"
            [indeterminate]="someSelected() && !allSelected()"
            (change)="toggleSelectAll()"
            aria-label="Select all items"
          />
        </div>
        <div class="content-list-view__col content-list-view__col--icon" role="columnheader"></div>
        <button type="button"
          class="content-list-view__col content-list-view__col--name content-list-view__col--sortable"
          role="columnheader"
          (click)="toggleSort('name')">
          Name
          @if (sortField() === 'name') {
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              {{ sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
            </span>
          }
        </button>
        <button type="button"
          class="content-list-view__col content-list-view__col--type content-list-view__col--sortable"
          role="columnheader"
          (click)="toggleSort('type')">
          Type
          @if (sortField() === 'type') {
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              {{ sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
            </span>
          }
        </button>
        <button type="button"
          class="content-list-view__col content-list-view__col--modified content-list-view__col--sortable"
          role="columnheader"
          (click)="toggleSort('modified')">
          Modified
          @if (sortField() === 'modified') {
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              {{ sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
            </span>
          }
        </button>
        <button type="button"
          class="content-list-view__col content-list-view__col--size content-list-view__col--sortable"
          role="columnheader"
          (click)="toggleSort('size')">
          Size
          @if (sortField() === 'size') {
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">
              {{ sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
            </span>
          }
        </button>
      </div>

      @for (item of sortedItems(); track item.id) {
        <div class="content-list-view__row" role="row"
          [class.content-list-view__row--selected]="selection.isSelected(item.id)"
          [attr.draggable]="item.itemType === 'thread'"
          [class.content-list-view__row--dragging]="draggingId() === item.id"
          (dragstart)="onDragStart(item, $event)"
          (dragend)="onDragEnd()"
          (click)="onRowClick(item, $event)"
          (dblclick)="onRowActivate(item)">
          <div class="content-list-view__col content-list-view__col--checkbox" role="cell">
            <input type="checkbox"
              class="content-list-view__checkbox"
              [checked]="selection.isSelected(item.id)"
              (click)="onCheckboxClick(item.id, $event)"
              (change)="$event.stopPropagation()"
              [attr.aria-label]="'Select ' + item.name"
            />
          </div>
          <div class="content-list-view__col content-list-view__col--icon" role="cell">
            <span class="material-symbols-outlined icon-sm"
              [class.content-list-view__icon--folder]="item.itemType === 'folder'"
              [class.content-list-view__icon--thread]="item.itemType === 'thread'"
              aria-hidden="true">
              {{ item.icon }}
            </span>
          </div>
          <div class="content-list-view__col content-list-view__col--name" role="cell">
            {{ item.name }}
          </div>
          <div class="content-list-view__col content-list-view__col--type" role="cell">
            {{ item.itemType === 'folder' ? 'Folder' : 'Thread' }}
          </div>
          <div class="content-list-view__col content-list-view__col--modified" role="cell">
            {{ item.modified }}
          </div>
          <div class="content-list-view__col content-list-view__col--size" role="cell">
            {{ item.size }}
          </div>
        </div>
      } @empty {
        <p class="explorer-state-empty panel-empty">No items in this folder</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentListViewComponent {
  protected readonly selection = inject(SelectionService);

  readonly folders = input<readonly FolderTreeViewModel[]>([]);
  readonly threads = input<readonly ThreadListViewModel[]>([]);

  readonly folderActivated = output<string>();
  readonly threadActivated = output<string>();
  readonly threadDragStarted = output<{ readonly id: string; readonly title: string }>();

  readonly sortField = signal<SortField>('name');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly draggingId = signal<string | null>(null);

  readonly items = computed<readonly ListItem[]>(() => {
    const folderItems: ListItem[] = this.folders().map(f => ({
      id: f.id,
      name: f.name,
      itemType: 'folder' as const,
      modified: '—',
      size: f.children.length + ' items',
      icon: 'folder',
    }));

    const threadItems: ListItem[] = this.threads().map(t => ({
      id: t.id,
      name: t.title,
      itemType: 'thread' as const,
      modified: 'v' + t.lastEventVersion,
      size: t.recordCount + ' files',
      icon: 'description',
    }));

    return [...folderItems, ...threadItems];
  });

  readonly sortedItems = computed(() => {
    const items = [...this.items()];
    const field = this.sortField();
    const dir = this.sortDirection();

    items.sort((a, b) => {
      if (a.itemType !== b.itemType) {
        return a.itemType === 'folder' ? -1 : 1;
      }

      let cmp = 0;
      switch (field) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'type':
          cmp = a.itemType.localeCompare(b.itemType);
          break;
        case 'modified':
          cmp = a.modified.localeCompare(b.modified);
          break;
        case 'size':
          cmp = a.size.localeCompare(b.size);
          break;
      }

      return dir === 'asc' ? cmp : -cmp;
    });

    return items;
  });

  readonly allItemIds = computed(() => this.sortedItems().map(i => i.id));

  readonly allSelected = computed(() => {
    const items = this.sortedItems();
    if (items.length === 0) return false;
    return items.every(i => this.selection.isSelected(i.id));
  });

  readonly someSelected = computed(() => {
    const items = this.sortedItems();
    const selectedCount = items.filter(i => this.selection.isSelected(i.id)).length;
    return selectedCount > 0 && selectedCount < items.length;
  });

  toggleSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('asc');
    }
  }

  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selection.clearSelection();
    } else {
      this.selection.selectAll(this.allItemIds());
    }
  }

  onRowClick(item: ListItem, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.selection.handleClick(item.id, event, this.allItemIds());
      return;
    }

    if (item.itemType === 'folder') {
      this.folderActivated.emit(item.id);
    } else {
      this.threadActivated.emit(item.id);
    }
  }

  onRowActivate(item: ListItem): void {
    if (item.itemType === 'folder') {
      this.folderActivated.emit(item.id);
    } else {
      this.threadActivated.emit(item.id);
    }
  }

  onCheckboxClick(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selection.toggleSelect(id);
  }

  onDragStart(item: ListItem, event: DragEvent): void {
    if (item.itemType !== 'thread') {
      event.preventDefault();
      return;
    }
    this.draggingId.set(item.id);
    event.dataTransfer?.setData('application/x-chano-thread', JSON.stringify({ id: item.id, title: item.name }));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.threadDragStarted.emit({ id: item.id, title: item.name });
  }

  onDragEnd(): void {
    this.draggingId.set(null);
  }
}
