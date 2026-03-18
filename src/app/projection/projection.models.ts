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

// ── Event stream types ─────────────────────────────────────

export type EventOperation = 'create' | 'update' | 'rename' | 'move' | 'delete';
export type EventEntity = 'folder' | 'thread' | 'record' | 'imageGroup';

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
