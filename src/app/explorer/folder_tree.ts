import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { FolderTreeViewModel } from '../../viewmodels';

@Component({
  selector: 'app-folder-tree',
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #folderTreeNodes let-nodes let-depth="depth">
      @for (node of nodes; track trackFolder($index, node)) {
        <div class="folder-tree-node" role="treeitem" [attr.aria-level]="depth + 1">
          <button
            type="button"
            class="panel-item panel-item--folder"
            data-testid="folder-item"
            [class.panel-item--selected]="selectedFolderId() === node.id"
            [style.padding-left.rem]="0.75 + depth * 1.1"
            (click)="selectFolder(node.id)"
            [attr.aria-label]="'Select folder ' + node.name"
          >
            <span class="panel-item-title">{{ node.name }}</span>
            <span class="panel-item-meta">{{ node.id }}</span>
          </button>

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