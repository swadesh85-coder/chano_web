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

  findFolder(folderId: string | null): FolderTreeViewModel | null {
    return findFolderTreeViewModelById(this.folderTree(), folderId);
  }

  hasFolder(folderId: string | null): boolean {
    return folderId === null || this.findFolder(folderId) !== null;
  }
}