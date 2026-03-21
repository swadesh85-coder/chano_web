export interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

export interface Thread {
  readonly id: string;
  readonly folderId: string;
  readonly title: string;
}

export interface RecordEntry {
  readonly id: string;
  readonly threadId: string;
  readonly type: string;
  readonly name: string;
  readonly createdAt: number;
}

export type ExplorerNodeType = 'folder' | 'thread' | 'record';

export interface ExplorerNode {
  readonly id: string;
  readonly name: string;
  readonly type: ExplorerNodeType;
  readonly children: ExplorerNode[];
}

export interface ProjectionState {
  readonly folders: readonly Folder[];
  readonly threads: readonly Thread[];
  readonly records: readonly RecordEntry[];
}

export interface FolderProjectionData {
  readonly uuid: string;
  readonly name: string;
  readonly parentFolderUuid: string | null;
}

export interface ThreadProjectionData {
  readonly uuid: string;
  readonly folderUuid: string | null;
  readonly title: string;
}

export interface RecordProjectionData {
  readonly uuid: string;
  readonly threadUuid: string;
  readonly type: string;
  readonly body: string;
  readonly createdAt: number;
  readonly editedAt: number;
  readonly orderIndex: number;
  readonly isStarred: boolean;
  readonly imageGroupId: string | null;
}

export interface ProjectionEntity<TType extends 'folder' | 'thread' | 'record', TData> {
  readonly entityType: TType;
  readonly entityUuid: string;
  readonly entityVersion: number;
  readonly data: Readonly<TData>;
}

export type FolderProjectionEntity = ProjectionEntity<'folder', FolderProjectionData>;
export type ThreadProjectionEntity = ProjectionEntity<'thread', ThreadProjectionData>;
export type RecordProjectionEntity = ProjectionEntity<'record', RecordProjectionData>;

export interface ProjectionSnapshotState {
  readonly folders: readonly FolderProjectionEntity[];
  readonly threads: readonly ThreadProjectionEntity[];
  readonly records: readonly RecordProjectionEntity[];
}

// ── Event stream types ─────────────────────────────────────

export type EventOperation = 'create' | 'update' | 'rename' | 'move' | 'delete' | 'softDelete' | 'restore';
export type EventEntity = 'folder' | 'thread' | 'record' | 'imageGroup';

export interface SnapshotEntity {
  readonly entityType: EventEntity;
  readonly entityUuid: string;
  readonly entityVersion: number;
  readonly ownerUserId: string;
  readonly data: Record<string, unknown>;
}

export interface ProjectionSnapshotDocument {
  readonly folders?: readonly SnapshotEntity[];
  readonly threads?: readonly SnapshotEntity[];
  readonly records?: readonly SnapshotEntity[];
}

export interface EventEnvelope {
  readonly eventId: string;
  readonly originDeviceId: string;
  readonly eventVersion: number;
  readonly entityType: EventEntity;
  readonly entityId: string;
  readonly operation: EventOperation;
  readonly timestamp: number;
  readonly payload: Record<string, unknown>;
  readonly checksum: string;
}

export interface VaultEvent {
  readonly operation: EventOperation;
  readonly entity: EventEntity;
  readonly data: Record<string, unknown>;
}
