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

@Component({
  selector: 'app-content-grid-view',
  standalone: true,
  host: { class: 'content-grid-view-host' },
  template: `
    @if (folders().length === 0 && threads().length === 0) {
      <p class="explorer-state-empty panel-empty">No items in this folder</p>
    } @else {
      @if (folders().length > 0) {
        <section class="content-grid-section" aria-label="Folders">
          <h3 class="content-grid-section__title">Folders</h3>
          <div class="content-grid">
            @for (folder of folders(); track folder.id) {
              <div class="folder-card"
                [class.folder-card--selected]="selection.isSelected(folder.id)"
                (click)="onFolderClick(folder, $event)"
                (dblclick)="folderActivated.emit(folder.id)">
                <div class="folder-card__checkbox-area">
                  <input type="checkbox"
                    class="folder-card__checkbox"
                    [checked]="selection.isSelected(folder.id)"
                    (click)="onCheckboxClick(folder.id, $event)"
                    (change)="$event.stopPropagation()"
                    [attr.aria-label]="'Select folder ' + folder.name"
                  />
                </div>
                <span class="material-symbols-outlined folder-card__icon" aria-hidden="true">folder</span>
                <span class="folder-card__name">{{ folder.name }}</span>
                <span class="folder-card__meta">{{ folder.children.length }} items</span>
              </div>
            }
          </div>
        </section>
      }

      @if (threads().length > 0) {
        <section class="content-grid-section" aria-label="Threads">
          <h3 class="content-grid-section__title">Threads</h3>
          <div class="content-grid">
            @for (thread of threads(); track thread.id) {
              <div class="thread-card"
                [class.thread-card--selected]="selection.isSelected(thread.id)"
                [class.thread-card--dragging]="draggingId() === thread.id"
                draggable="true"
                (dragstart)="onThreadDragStart(thread, $event)"
                (dragend)="onDragEnd()"
                (click)="onThreadClick(thread, $event)"
                (dblclick)="threadActivated.emit(thread.id)">
                <div class="thread-card__checkbox-area">
                  <input type="checkbox"
                    class="thread-card__checkbox"
                    [checked]="selection.isSelected(thread.id)"
                    (click)="onCheckboxClick(thread.id, $event)"
                    (change)="$event.stopPropagation()"
                    [attr.aria-label]="'Select thread ' + thread.title"
                  />
                </div>
                <div class="thread-card__thumbnail">
                  <span class="material-symbols-outlined thread-card__thumb-icon" aria-hidden="true">description</span>
                </div>
                <div class="thread-card__body">
                  <span class="thread-card__title">{{ thread.title }}</span>
                  <span class="thread-card__meta">{{ thread.recordCount }} files · v{{ thread.lastEventVersion }}</span>
                </div>
              </div>
            }
          </div>
        </section>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentGridViewComponent {
  protected readonly selection = inject(SelectionService);

  readonly folders = input<readonly FolderTreeViewModel[]>([]);
  readonly threads = input<readonly ThreadListViewModel[]>([]);

  readonly folderActivated = output<string>();
  readonly threadActivated = output<string>();
  readonly threadDragStarted = output<{ readonly id: string; readonly title: string }>();

  readonly draggingId = signal<string | null>(null);

  readonly allItemIds = computed(() => [
    ...this.folders().map(f => f.id),
    ...this.threads().map(t => t.id),
  ]);

  onFolderClick(folder: FolderTreeViewModel, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.selection.handleClick(folder.id, event, this.allItemIds());
      return;
    }
    this.folderActivated.emit(folder.id);
  }

  onThreadClick(thread: ThreadListViewModel, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.selection.handleClick(thread.id, event, this.allItemIds());
      return;
    }
    this.threadActivated.emit(thread.id);
  }

  onCheckboxClick(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selection.toggleSelect(id);
  }

  onThreadDragStart(thread: ThreadListViewModel, event: DragEvent): void {
    this.draggingId.set(thread.id);
    event.dataTransfer?.setData('application/x-chano-thread', JSON.stringify({ id: thread.id, title: thread.title }));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.threadDragStarted.emit({ id: thread.id, title: thread.title });
  }

  onDragEnd(): void {
    this.draggingId.set(null);
  }
}
