import type {
  EventEnvelope,
  Folder,
  ProjectionState,
  RecordEntry,
  Thread,
} from './projection.models';

type SnapshotEntityWrapper = {
  readonly data: Record<string, unknown>;
};

type ProjectionSnapshotDocument = {
  readonly folders: readonly SnapshotEntityWrapper[];
  readonly threads: readonly SnapshotEntityWrapper[];
  readonly records: readonly SnapshotEntityWrapper[];
};

export type ProjectionResyncReason = 'EVENT_GAP';

type ProjectionEngineOptions = {
  readonly emitResyncRequired?: (
    reason: ProjectionResyncReason,
    details: { readonly expectedEventVersion: number; readonly receivedEventVersion: number },
  ) => void;
};

export type ProjectionEngineResult =
  | {
      readonly status: 'SNAPSHOT_APPLIED';
      readonly lastAppliedEventVersion: number;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_APPLIED';
      readonly lastAppliedEventVersion: number;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_IGNORED_DUPLICATE';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'SNAPSHOT_RESYNC_REQUIRED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
      readonly reason: ProjectionResyncReason;
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    };

const EMPTY_PROJECTION_STATE: ProjectionState = {
  folders: [],
  threads: [],
  records: [],
};

export class ProjectionEngine {
  private state: ProjectionState = EMPTY_PROJECTION_STATE;
  private lastAppliedEventVersion: number | null = null;
  private hasSnapshot = false;

  constructor(private readonly options: ProjectionEngineOptions = {}) {}

  reset(): void {
    this.state = EMPTY_PROJECTION_STATE;
    this.lastAppliedEventVersion = null;
    this.hasSnapshot = false;
  }

  applySnapshot(snapshotJson: string, baseEventVersion: number): ProjectionEngineResult {
    const snapshot = JSON.parse(snapshotJson) as ProjectionSnapshotDocument;

    this.state = {
      folders: snapshot.folders.map((entity) => this.toFolder(entity.data)),
      threads: snapshot.threads.map((entity) => this.toThread(entity.data)),
      records: snapshot.records.map((entity) => this.toRecord(entity.data)),
    };
    this.lastAppliedEventVersion = baseEventVersion;
    this.hasSnapshot = true;

    console.log(`PROJECTION_SNAPSHOT_APPLIED baseEventVersion=${baseEventVersion}`);

    return {
      status: 'SNAPSHOT_APPLIED',
      lastAppliedEventVersion: baseEventVersion,
      state: this.getProjectionState(),
    };
  }

  applyEvent(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    if (!this.hasSnapshot || this.lastAppliedEventVersion === null) {
      return {
        status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    if (eventEnvelope.eventVersion <= this.lastAppliedEventVersion) {
      console.log(`EVENT_IGNORED duplicate eventVersion=${eventEnvelope.eventVersion}`);
      return {
        status: 'EVENT_IGNORED_DUPLICATE',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    const expectedEventVersion = this.lastAppliedEventVersion + 1;
    if (eventEnvelope.eventVersion > expectedEventVersion) {
      this.emitResyncRequired('EVENT_GAP', expectedEventVersion, eventEnvelope.eventVersion);

      return {
        status: 'SNAPSHOT_RESYNC_REQUIRED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
        reason: 'EVENT_GAP',
        expectedEventVersion,
        receivedEventVersion: eventEnvelope.eventVersion,
      };
    }

    console.log(
      `EVENT_APPLY eventVersion=${eventEnvelope.eventVersion} lastApplied=${this.lastAppliedEventVersion}`,
    );

    this.state = this.applyEventToState(eventEnvelope, this.state);
    this.lastAppliedEventVersion = eventEnvelope.eventVersion;

    return {
      status: 'EVENT_APPLIED',
      lastAppliedEventVersion: eventEnvelope.eventVersion,
      state: this.getProjectionState(),
    };
  }

  getProjectionState(): ProjectionState {
    return {
      folders: this.state.folders.map((folder) => ({ ...folder })),
      threads: this.state.threads.map((thread) => ({ ...thread })),
      records: this.state.records.map((record) => ({ ...record })),
    };
  }

  getLastAppliedEventVersion(): number | null {
    return this.lastAppliedEventVersion;
  }

  private emitResyncRequired(
    reason: ProjectionResyncReason,
    expectedEventVersion: number,
    receivedEventVersion: number,
  ): void {
    console.error(
      `SNAPSHOT_RESYNC_REQUIRED reason=${reason} expected=${expectedEventVersion} received=${receivedEventVersion}`,
    );
    this.options.emitResyncRequired?.(reason, {
      expectedEventVersion,
      receivedEventVersion,
    });
  }

  private applyEventToState(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.operation) {
      case 'create':
        return this.applyCreate(eventEnvelope, state);
      case 'update':
        return this.applyUpdate(eventEnvelope, state);
      case 'rename':
        return this.applyRename(eventEnvelope, state);
      case 'move':
        return this.applyMove(eventEnvelope, state);
      case 'delete':
        return this.applyDelete(eventEnvelope, state);
    }
  }

  private applyCreate(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        return {
          ...state,
          folders: this.upsertById(state.folders, {
            id: eventEnvelope.entityId,
            name: eventEnvelope.payload['name'] as string,
            parentId: (eventEnvelope.payload['parentFolderUuid'] as string | null | undefined) ?? null,
          }),
        };
      case 'thread':
        return {
          ...state,
          threads: this.upsertById(state.threads, {
            id: eventEnvelope.entityId,
            folderId: (eventEnvelope.payload['folderUuid'] as string | null | undefined) ?? 'root',
            title: eventEnvelope.payload['title'] as string,
          }),
        };
      case 'record':
        return {
          ...state,
          records: this.upsertById(state.records, {
            id: eventEnvelope.entityId,
            threadId: eventEnvelope.payload['threadUuid'] as string,
            type: eventEnvelope.payload['type'] as string,
            name: eventEnvelope.payload['body'] as string,
            createdAt: eventEnvelope.payload['createdAt'] as number,
          }),
        };
    }
  }

  private applyUpdate(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        return {
          ...state,
          folders: state.folders.map((folder) =>
            folder.id === eventEnvelope.entityId ? this.mergeFolder(folder, eventEnvelope.payload) : folder,
          ),
        };
      case 'thread':
        return {
          ...state,
          threads: state.threads.map((thread) =>
            thread.id === eventEnvelope.entityId ? this.mergeThread(thread, eventEnvelope.payload) : thread,
          ),
        };
      case 'record':
        return {
          ...state,
          records: state.records.map((record) =>
            record.id === eventEnvelope.entityId ? this.mergeRecord(record, eventEnvelope.payload) : record,
          ),
        };
    }
  }

  private applyRename(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        return {
          ...state,
          folders: state.folders.map((folder) =>
            folder.id === eventEnvelope.entityId
              ? { ...folder, name: eventEnvelope.payload['name'] as string }
              : folder,
          ),
        };
      case 'thread':
        return {
          ...state,
          threads: state.threads.map((thread) =>
            thread.id === eventEnvelope.entityId
              ? { ...thread, title: eventEnvelope.payload['title'] as string }
              : thread,
          ),
        };
      case 'record':
        return {
          ...state,
          records: state.records.map((record) =>
            record.id === eventEnvelope.entityId
              ? { ...record, name: eventEnvelope.payload['body'] as string }
              : record,
          ),
        };
    }
  }

  private applyMove(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        return {
          ...state,
          folders: state.folders.map((folder) =>
            folder.id === eventEnvelope.entityId
              ? {
                  ...folder,
                  parentId: (eventEnvelope.payload['parentFolderUuid'] as string | null | undefined) ?? null,
                }
              : folder,
          ),
        };
      case 'thread':
        return {
          ...state,
          threads: state.threads.map((thread) =>
            thread.id === eventEnvelope.entityId
              ? {
                  ...thread,
                  folderId: (eventEnvelope.payload['folderUuid'] as string | null | undefined) ?? 'root',
                }
              : thread,
          ),
        };
      case 'record':
        return {
          ...state,
          records: state.records.map((record) =>
            record.id === eventEnvelope.entityId
              ? { ...record, threadId: eventEnvelope.payload['threadUuid'] as string }
              : record,
          ),
        };
    }
  }

  private applyDelete(eventEnvelope: EventEnvelope, state: ProjectionState): ProjectionState {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        return this.cascadeDeleteFolder(eventEnvelope.entityId, state);
      case 'thread':
        return this.cascadeDeleteThread(eventEnvelope.entityId, state);
      case 'record':
        return {
          ...state,
          records: state.records.filter((record) => record.id !== eventEnvelope.entityId),
        };
    }
  }

  private cascadeDeleteFolder(folderId: string, state: ProjectionState): ProjectionState {
    const doomedFolderIds = new Set<string>([folderId]);
    let size = -1;

    while (size !== doomedFolderIds.size) {
      size = doomedFolderIds.size;
      for (const folder of state.folders) {
        if (folder.parentId !== null && doomedFolderIds.has(folder.parentId)) {
          doomedFolderIds.add(folder.id);
        }
      }
    }

    const doomedThreadIds = new Set(
      state.threads
        .filter((thread) => doomedFolderIds.has(thread.folderId))
        .map((thread) => thread.id),
    );

    return {
      folders: state.folders.filter((folder) => !doomedFolderIds.has(folder.id)),
      threads: state.threads.filter((thread) => !doomedThreadIds.has(thread.id)),
      records: state.records.filter((record) => !doomedThreadIds.has(record.threadId)),
    };
  }

  private cascadeDeleteThread(threadId: string, state: ProjectionState): ProjectionState {
    return {
      ...state,
      threads: state.threads.filter((thread) => thread.id !== threadId),
      records: state.records.filter((record) => record.threadId !== threadId),
    };
  }

  private mergeFolder(existing: Folder, payload: Record<string, unknown>): Folder {
    return {
      id: existing.id,
      name: this.hasOwn(payload, 'name') ? payload['name'] as string : existing.name,
      parentId: this.hasOwn(payload, 'parentFolderUuid')
        ? (payload['parentFolderUuid'] as string | null)
        : existing.parentId,
    };
  }

  private mergeThread(existing: Thread, payload: Record<string, unknown>): Thread {
    return {
      id: existing.id,
      folderId: this.hasOwn(payload, 'folderUuid')
        ? ((payload['folderUuid'] as string | null | undefined) ?? 'root')
        : existing.folderId,
      title: this.hasOwn(payload, 'title') ? payload['title'] as string : existing.title,
    };
  }

  private mergeRecord(existing: RecordEntry, payload: Record<string, unknown>): RecordEntry {
    return {
      id: existing.id,
      threadId: this.hasOwn(payload, 'threadUuid') ? payload['threadUuid'] as string : existing.threadId,
      type: this.hasOwn(payload, 'type') ? payload['type'] as string : existing.type,
      name: this.hasOwn(payload, 'body') ? payload['body'] as string : existing.name,
      createdAt: this.hasOwn(payload, 'createdAt') ? payload['createdAt'] as number : existing.createdAt,
    };
  }

  private toFolder(data: Record<string, unknown>): Folder {
    return {
      id: data['uuid'] as string,
      name: data['name'] as string,
      parentId: (data['parentFolderUuid'] as string | null | undefined) ?? null,
    };
  }

  private toThread(data: Record<string, unknown>): Thread {
    return {
      id: data['uuid'] as string,
      folderId: (data['folderUuid'] as string | null | undefined) ?? 'root',
      title: data['title'] as string,
    };
  }

  private toRecord(data: Record<string, unknown>): RecordEntry {
    return {
      id: data['uuid'] as string,
      threadId: data['threadUuid'] as string,
      type: data['type'] as string,
      name: data['body'] as string,
      createdAt: data['createdAt'] as number,
    };
  }

  private upsertById<T extends { readonly id: string }>(
    collection: readonly T[],
    entity: T,
  ): T[] {
    const existingIndex = collection.findIndex((entry) => entry.id === entity.id);
    if (existingIndex === -1) {
      return [...collection, entity];
    }

    const next = [...collection];
    next[existingIndex] = entity;
    return next;
  }

  private hasOwn(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key);
  }
}