import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { FolderTreeViewModel } from '../../viewmodels';
import { SidebarItemComponent } from '../ui/sidebar_item.component';

@Component({
  selector: 'app-folder-tree',
  imports: [NgTemplateOutlet, SidebarItemComponent],
  template: `
    <ng-template #folderTreeNodes let-nodes let-depth="depth">
      @for (node of nodes; track trackFolder($index, node)) {
        <div class="folder-tree-node" role="treeitem" [attr.aria-level]="depth + 1">
          <app-sidebar-item
            data-testid="folder-item"
            [title]="node.name"
            [metaText]="node.id"
            [depth]="depth"
            [selected]="selectedFolderId() === node.id"
            [ariaLabel]="'Select folder ' + node.name"
            (activated)="selectFolder(node.id)"
          >
          </app-sidebar-item>

          @if (node.children.length > 0) {
            <div role="group">
              <ng-container
                *ngTemplateOutlet="folderTreeNodes; context: { $implicit: node.children, depth: depth + 1 }"
              ></ng-container>
            </div>
          }
        </div>
      }
    </ng-template>

    <ng-container
      *ngTemplateOutlet="folderTreeNodes; context: { $implicit: nodes(), depth: 0 }"
    ></ng-container>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTreeComponent {
  readonly nodes = input.required<readonly FolderTreeViewModel[]>();
  readonly selectedFolderId = input<string | null>(null);
  readonly folderSelected = output<string>();

  selectFolder(folderId: string): void {
    this.folderSelected.emit(folderId);
  }

  trackFolder(_index: number, node: FolderTreeViewModel): string {
    return node.id;
  }
}