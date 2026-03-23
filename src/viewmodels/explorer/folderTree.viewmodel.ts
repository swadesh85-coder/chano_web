import type { ProjectionState } from '../../app/projection/projection.models';
import {
  selectFolders,
  type ProjectionFolderSelectorResult,
} from '../../projection/selectors';
import type { FolderTreeViewModel } from './explorer.viewmodel.types';

export function selectFolderTreeViewModel(state: ProjectionState): readonly FolderTreeViewModel[] {
  return buildFolderTreeViewModel(selectFolders(state));
}

export function buildFolderTreeViewModel(
  folders: ProjectionFolderSelectorResult,
): readonly FolderTreeViewModel[] {
  return buildFolderNodes(folders.rootFolderIds, folders);
}

export function findFolderTreeViewModelById(
  nodes: readonly FolderTreeViewModel[],
  folderId: string | null,
): FolderTreeViewModel | null {
  if (folderId === null) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === folderId) {
      return node;
    }

    const match = findFolderTreeViewModelById(node.children, folderId);
    if (match !== null) {
      return match;
    }
  }

  return null;
}

function buildFolderNodes(
  folderIds: readonly string[],
  folders: ProjectionFolderSelectorResult,
): readonly FolderTreeViewModel[] {
  return folderIds
    .map((folderId) => folders.folderMap[folderId])
    .filter((folder): folder is ProjectionFolderSelectorResult['folderMap'][string] => folder !== undefined)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      children: buildFolderNodes(folders.childrenByFolderId[folder.id] ?? [], folders),
    }));
}