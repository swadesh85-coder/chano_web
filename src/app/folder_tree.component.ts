import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { FolderTreeComponent as ExplorerFolderTreeComponent } from './explorer/folder_tree';
import type { NavigationPane } from './navigation.state';
import type { FolderTreeViewModel } from '../viewmodels';
import { SidebarItemComponent } from './ui/sidebar_item.component';

@Component({
  selector: 'app-folder-tree-pane',
  standalone: true,
  imports: [ExplorerFolderTreeComponent, SidebarItemComponent],
  template: `
    <section class="layout-pane layout-pane--sidebar" aria-label="Folder tree panel">
      <div class="layout-pane__body" role="tree">
        <!-- Quick-access section (Doc 25 §3.2) -->
        <nav class="sidebar-quick-access" aria-label="Quick access">
          <button type="button" class="sidebar-quick-access__item" (click)="folderSelected.emit('root')">
            <span class="material-symbols-outlined icon-md">home</span>
            <span class="sidebar-quick-access__label">Home</span>
          </button>
          <button type="button" class="sidebar-quick-access__item">
            <span class="material-symbols-outlined icon-md">schedule</span>
            <span class="sidebar-quick-access__label">Recent</span>
          </button>
          <button type="button" class="sidebar-quick-access__item">
            <span class="material-symbols-outlined icon-md">star</span>
            <span class="sidebar-quick-access__label">Favorites</span>
          </button>
        </nav>

        <hr class="sidebar-separator" />

        <!-- Vault tree -->
        <div class="sidebar-tree-section"
          [class.sidebar-tree-section--drag-over]="dragOverFolderId() === '__root__'"
          (dragover)="onTreeDragOver($event)"
          (dragleave)="onTreeDragLeave($event)"
          (drop)="onTreeDrop($event)">
          <app-sidebar-item
            data-testid="folder-root"
            [title]="'My Vault'"
            [metaText]="'folderUuid=null'"
            [kind]="'root'"
            [selected]="activePane() === 'folder' && selectedFolderId() === null"
            [ariaLabel]="'Select root folder'"
            (activated)="folderSelected.emit('root')"
          >
          </app-sidebar-item>

          @if (nodes().length === 0) {
            <p class="empty-text panel-empty">No folders in projection</p>
          } @else {
            <app-folder-tree
              [nodes]="nodes()"
              [selectedFolderId]="selectedFolderId()"
              (folderSelected)="folderSelected.emit($event)"
            ></app-folder-tree>
          }
        </div>

        @if (selectedFolder() !== null) {
          <div class="sidebar-create-section">
            <button
              type="button"
              class="panel-action-button panel-action-button--primary sidebar-create-button"
              (click)="createThreadRequested.emit($event)"
              [disabled]="createThreadDisabled()"
              aria-label="Create thread"
            >
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">add</span>
              New Thread
            </button>
          </div>
        }
      </div>

      <!-- Connection chip (Doc 25 §3.2) -->
      <div class="sidebar-connection-chip" aria-label="Connection status">
        <span class="sidebar-connection-chip__dot"></span>
        <span class="sidebar-connection-chip__text">Waiting for mobile…</span>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTreePaneComponent {
  readonly nodes = input.required<readonly FolderTreeViewModel[]>();
  readonly selectedFolderId = input<string | null>(null);
  readonly selectedFolder = input<FolderTreeViewModel | null>(null);
  readonly activePane = input<NavigationPane>('empty');
  readonly createThreadDisabled = input(false);

  readonly folderSelected = output<string | null>();
  readonly createThreadRequested = output<Event>();
  readonly threadDroppedOnFolder = output<{ readonly threadId: string; readonly folderId: string | null }>();

  readonly dragOverFolderId = signal<string | null>(null);

  onTreeDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('application/x-chano-thread')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      this.dragOverFolderId.set('__root__');
    }
  }

  onTreeDragLeave(event: DragEvent): void {
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    const currentTarget = event.currentTarget as HTMLElement;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;
    this.dragOverFolderId.set(null);
  }

  onTreeDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOverFolderId.set(null);

    const data = event.dataTransfer?.getData('application/x-chano-thread');
    if (!data) return;

    try {
      const parsed = JSON.parse(data) as { id: string };
      this.threadDroppedOnFolder.emit({ threadId: parsed.id, folderId: null });
    } catch {
      // Ignore malformed drag data
    }
  }
}