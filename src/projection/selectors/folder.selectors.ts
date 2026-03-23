import type { Folder, ProjectionState } from '../../app/projection/projection.models';

const ROOT_FOLDER_KEY = '__root__';

type FolderWithOptionalOrderIndex = Folder & {
  readonly orderIndex?: number | null;
};

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
      [...children]
        .sort(compareFoldersDeterministically)
        .map((folder) => folder.id),
    );
  }

  return Object.freeze({
    rootFolderIds: Object.freeze(
      [...rootFolders]
        .sort(compareFoldersDeterministically)
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

function compareFoldersDeterministically(left: Folder, right: Folder): number {
  const leftOrderIndex = readFolderOrderIndex(left);
  const rightOrderIndex = readFolderOrderIndex(right);
  if (leftOrderIndex !== rightOrderIndex) {
    return leftOrderIndex - rightOrderIndex;
  }

  if (left.entityVersion !== right.entityVersion) {
    return left.entityVersion - right.entityVersion;
  }

  return left.id.localeCompare(right.id);
}

function normalizeParentKey(parentId: string): string {
  return parentId || ROOT_FOLDER_KEY;
}

function readFolderOrderIndex(folder: Folder): number {
  const orderIndex = (folder as FolderWithOptionalOrderIndex).orderIndex;
  return typeof orderIndex === 'number' ? orderIndex : Number.MAX_SAFE_INTEGER;
}