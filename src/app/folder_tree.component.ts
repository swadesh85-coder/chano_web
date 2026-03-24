import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FolderTreeComponent as ExplorerFolderTreeComponent } from './explorer/folder_tree';
import type { NavigationPane } from './navigation.state';
import type { FolderTreeViewModel } from '../viewmodels';
import { SectionHeaderComponent } from './ui/section_header.component';
import { SidebarItemComponent } from './ui/sidebar_item.component';

@Component({
  selector: 'app-folder-tree-pane',
  standalone: true,
  imports: [ExplorerFolderTreeComponent, SectionHeaderComponent, SidebarItemComponent],
  template: `
    <section class="layout-pane layout-pane--sidebar" aria-label="Folder tree panel">
      <app-section-header
        [title]="'Folder Tree'"
        [subtitle]="'Projection hierarchy'"
        [eyebrow]="'Navigation'"
      >
        @if (selectedFolder() !== null) {
          <button
            type="button"
            section-actions
            class="panel-action-button panel-action-button--primary"
            (click)="createThreadRequested.emit($event)"
            [disabled]="createThreadDisabled()"
            aria-label="Create thread"
          >
            New Thread
          </button>
        }
      </app-section-header>

      <div class="layout-pane__body" role="tree">
        <app-sidebar-item
          data-testid="folder-root"
          [title]="'Root'"
          [metaText]="'folderUuid=null'"
          [kind]="'root'"
          [selected]="activePane() === 'folder' && selectedFolderId() === null"
          [ariaLabel]="'Select root folder'"
          (activated)="folderSelected.emit(null)"
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
}