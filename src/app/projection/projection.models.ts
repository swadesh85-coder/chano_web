export interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly entityVersion: number;
  readonly lastEventVersion: number;
}

export interface Thread {
  readonly id: string;
  readonly folderId: string;
  readonly title: string;
  readonly entityVersion: number;
  readonly lastEventVersion: number;
}

export interface RecordEntry {
  readonly id: string;
  readonly threadId: string;
  readonly type: string;
  readonly name: string;
  readonly createdAt: number;
  readonly editedAt: number;
  readonly orderIndex: number | null;
  readonly isStarred: boolean;
  readonly imageGroupId: string | null;
  readonly entityVersion: number;
  readonly lastEventVersion: number;
  readonly mediaId?: string;
  readonly mimeType?: string;
  readonly title?: string;
  readonly size?: number | null;
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

export interface ProjectionUpdate {
  readonly reason: 'snapshot_loaded' | 'event_applied';
  readonly entityType: EventEntity | null;
  readonly eventVersion: number | null;
}

// ── Event stream types ─────────────────────────────────────

export type EventOperation = 'create' | 'update' | 'rename' | 'move' | 'delete' | 'softDelete' | 'restore';
export type EventEntity = 'folder' | 'thread' | 'record' | 'imageGroup';

interface BaseSnapshotEntity {
  readonly entityType: EventEntity;
  readonly entityUuid: string;
  readonly entityVersion: number;
  readonly ownerUserId: string;
}

export interface FolderSnapshotEntity extends BaseSnapshotEntity {
  readonly entityType: 'folder';
  readonly lastEventVersion: number;
  readonly data: Record<string, unknown>;
}

export interface ThreadSnapshotEntity extends BaseSnapshotEntity {
  readonly entityType: 'thread';
  readonly lastEventVersion: number;
  readonly data: Record<string, unknown>;
}

export interface RecordSnapshotEntity extends BaseSnapshotEntity {
  readonly entityType: 'record';
  readonly lastEventVersion: number;
  readonly data: Record<string, unknown>;
}

export type SnapshotEntity = FolderSnapshotEntity | ThreadSnapshotEntity | RecordSnapshotEntity;

export interface ProjectionSnapshotDocument {
  readonly folders?: readonly FolderSnapshotEntity[];
  readonly threads?: readonly ThreadSnapshotEntity[];
  readonly records?: readonly RecordSnapshotEntity[];
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
