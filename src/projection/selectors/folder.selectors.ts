import type { Folder, ProjectionState } from '../../app/projection/projection.models';
import { sortFoldersForExplorer } from './explorer.ordering.selectors';

const ROOT_FOLDER_KEY = '__root__';

export type ProjectionFolderSelectorResult = {
  readonly rootFolderIds: readonly string[];
  readonly childrenByFolderId: Readonly<Record<string, readonly string[]>>;
  readonly folderMap: Readonly<Record<string, Folder>>;
};

export type ProjectionFolderTreeNode = {
  readonly entity: Folder;
  readonly children: readonly ProjectionFolderTreeNode[];
};

export function selectFolders(state: ProjectionState): ProjectionFolderSelectorResult {
  const folderMap: Record<string, Folder> = {};
  const rootFolders: Folder[] = [];
  const childFoldersByParent: Record<string, Folder[]> = {};

  for (const folder of state.folders) {
    folderMap[folder.id] = folder;

    if (folder.parentId === null) {
      rootFolders.push(folder);
      continue;
    }

    const parentKey = normalizeParentKey(folder.parentId);
    (childFoldersByParent[parentKey] ??= []).push(folder);
  }

  const childrenByFolderId: Record<string, readonly string[]> = {};
  for (const [parentKey, children] of Object.entries(childFoldersByParent)) {
    childrenByFolderId[parentKey] = Object.freeze(
      sortFoldersForExplorer(children)
        .map((folder) => folder.id),
    );
  }

  return Object.freeze({
    rootFolderIds: Object.freeze(
      sortFoldersForExplorer(rootFolders)
        .map((folder) => folder.id),
    ),
    childrenByFolderId: Object.freeze(childrenByFolderId),
    folderMap: Object.freeze(folderMap),
  });
}

export function selectFolderChildrenMap(
  state: ProjectionState,
): ProjectionFolderSelectorResult['childrenByFolderId'] {
  return selectFolders(state).childrenByFolderId;
}

export function selectRootFolders(state: ProjectionState): readonly string[] {
  return selectFolders(state).rootFolderIds;
}

export function selectFolderById(state: ProjectionState, folderId: string | null): Folder | null {
  if (folderId === null) {
    return null;
  }

  return selectFolders(state).folderMap[folderId] ?? null;
}

export function selectFolderChildren(
  state: ProjectionState,
  parentId: string | null,
): readonly Folder[] {
  const folders = selectFolders(state);
  const childIds = parentId === null
    ? folders.rootFolderIds
    : (folders.childrenByFolderId[normalizeParentKey(parentId)] ?? []);

  return childIds
    .map((folderId) => folders.folderMap[folderId])
    .filter((folder): folder is Folder => folder !== undefined);
}

export function selectFolderTree(state: ProjectionState): readonly ProjectionFolderTreeNode[] {
  const folders = selectFolders(state);
  return buildFolderTreeNodes(folders.rootFolderIds, folders);
}

function buildFolderTreeNodes(
  folderIds: readonly string[],
  folders: ProjectionFolderSelectorResult,
): readonly ProjectionFolderTreeNode[] {
  return folderIds
    .map((folderId) => folders.folderMap[folderId])
    .filter((folder): folder is Folder => folder !== undefined)
    .map((folder) => ({
    entity: folder,
    children: buildFolderTreeNodes(
      folders.childrenByFolderId[normalizeParentKey(folder.id)] ?? [],
      folders,
    ),
  }));
}

function normalizeParentKey(parentId: string): string {
  return parentId || ROOT_FOLDER_KEY;
}
