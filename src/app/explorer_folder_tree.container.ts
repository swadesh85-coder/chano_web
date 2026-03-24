import { Injectable, computed, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import { selectFolders } from '../projection/selectors';
import type { FolderTreeViewModel } from '../viewmodels';
import {
  buildFolderTreeViewModel,
  findFolderTreeViewModelById,
} from '../viewmodels';

@Injectable({ providedIn: 'root' })
export class ExplorerFolderTreeContainer {
  private readonly projection = inject(ProjectionStateContainer);

  private readonly projectionState = this.projection.state;
  readonly projectionUpdate = this.projection.projectionUpdate;
  readonly folderTree = computed(() => buildFolderTreeViewModel(selectFolders(this.projectionState())));
  private lastFindFolderId: string | null | undefined;
  private lastFindFolderTree: readonly FolderTreeViewModel[] | null = null;
  private lastFindFolderResult: FolderTreeViewModel | null = null;

  findFolder(folderId: string | null): FolderTreeViewModel | null {
    const tree = this.folderTree();
    if (this.lastFindFolderTree === tree && this.lastFindFolderId === folderId) {
      return this.lastFindFolderResult;
    }

    const result = findFolderTreeViewModelById(tree, folderId);
    this.lastFindFolderTree = tree;
    this.lastFindFolderId = folderId;
    this.lastFindFolderResult = result;
    return result;
  }

  hasFolder(folderId: string | null): boolean {
    return folderId === null || this.findFolder(folderId) !== null;
  }
}