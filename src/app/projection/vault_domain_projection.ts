import type {
  EventEnvelope,
  Folder,
  ProjectionSnapshotDocument,
  ProjectionState,
  RecordSnapshotEntity,
  RecordEntry,
  SnapshotEntity,
  Thread,
} from './projection.models';

type RuntimeFolder = Folder & {
  readonly deleted: boolean;
};

type RuntimeThread = Thread & {
  readonly deleted: boolean;
};

type RuntimeRecord = RecordEntry & {
  readonly deleted: boolean;
};

type ProjectionRuntimeState = {
  readonly foldersById: ReadonlyMap<string, RuntimeFolder>;
  readonly threadsById: ReadonlyMap<string, RuntimeThread>;
  readonly recordsById: ReadonlyMap<string, RuntimeRecord>;
  readonly appliedEventIds: ReadonlySet<number | string>;
};

type ProjectionStateWithRuntime = ProjectionState & {
  readonly [PROJECTION_RUNTIME_STATE]?: ProjectionRuntimeState;
};

const ROOT_FOLDER_ID = 'root';
const PROJECTION_RUNTIME_STATE = Symbol('projectionRuntimeState');

export class VaultDomainProjection {
  applySnapshot(snapshotEntities: ProjectionSnapshotDocument): ProjectionState {
    const foldersById = new Map<string, RuntimeFolder>();
    const threadsById = new Map<string, RuntimeThread>();
    const recordsById = new Map<string, RuntimeRecord>();

    for (const entity of snapshotEntities.folders ?? []) {
      this.insertSnapshotFolder(foldersById, entity);
    }

    for (const entity of snapshotEntities.threads ?? []) {
      this.insertSnapshotThread(threadsById, entity);
    }

    for (const entity of snapshotEntities.records ?? []) {
      this.insertSnapshotRecord(recordsById, entity);
    }

    return this.createProjectionState(foldersById, threadsById, recordsById, new Set());
  }

  applyEvent(state: ProjectionState, eventEnvelope: EventEnvelope): ProjectionState {
    this.assertValidEventVersion(eventEnvelope.eventVersion);

    const runtimeState = this.getRuntimeState(state);
    if (runtimeState.appliedEventIds.has(eventEnvelope.eventId)) {
      return state;
    }

    console.log(
      `APPLY eventVersion=${eventEnvelope.eventVersion} entity=${eventEnvelope.entityType} id=${eventEnvelope.entityId} op=${eventEnvelope.operation}`,
    );

    const foldersById = new Map(runtimeState.foldersById);
    const threadsById = new Map(runtimeState.threadsById);
    const recordsById = new Map(runtimeState.recordsById);
    const appliedEventIds = new Set(runtimeState.appliedEventIds);
    appliedEventIds.add(eventEnvelope.eventId);

    switch (eventEnvelope.operation) {
      case 'create':
        this.applyCreate(foldersById, threadsById, recordsById, eventEnvelope);
        break;
      case 'update':
        this.applyUpdate(foldersById, threadsById, recordsById, eventEnvelope);
        break;
      case 'rename':
        this.applyRename(foldersById, threadsById, recordsById, eventEnvelope);
        break;
      case 'move':
        this.applyMove(foldersById, threadsById, recordsById, eventEnvelope);
        break;
      case 'delete':
      case 'softDelete':
        this.applySoftDelete(foldersById, threadsById, recordsById, eventEnvelope);
        break;
      case 'restore':
        this.applyRestore(foldersById, threadsById, recordsById, eventEnvelope);
        break;
    }

    return this.createProjectionState(foldersById, threadsById, recordsById, appliedEventIds);
  }

  getEntityVersion(state: ProjectionState, entityType: EventEnvelope['entityType'], entityId: string): number | null {
    const runtimeState = this.getRuntimeState(state);

    switch (entityType) {
      case 'folder':
        return runtimeState.foldersById.get(entityId)?.entityVersion ?? null;
      case 'thread':
        return runtimeState.threadsById.get(entityId)?.entityVersion ?? null;
      case 'record':
        return runtimeState.recordsById.get(entityId)?.entityVersion ?? null;
      case 'imageGroup':
        return this.getDerivedImageGroupVersion(runtimeState.recordsById, entityId);
    }
  }

  getRecordLastEventVersion(state: ProjectionState, entityId: string): number | null {
    return this.getRuntimeState(state).recordsById.get(entityId)?.lastEventVersion ?? null;
  }

  hasEntityId(state: ProjectionState, entityId: string): boolean {
    const runtimeState = this.getRuntimeState(state);

    return runtimeState.foldersById.has(entityId)
      || runtimeState.threadsById.has(entityId)
      || runtimeState.recordsById.has(entityId);
  }

  private getRuntimeState(state: ProjectionState): ProjectionRuntimeState {
    const runtimeState = (state as ProjectionStateWithRuntime)[PROJECTION_RUNTIME_STATE];
    if (runtimeState !== undefined) {
      return runtimeState;
    }

    return {
      foldersById: new Map(state.folders.map((folder) => [folder.id, { ...folder, deleted: false }])),
      threadsById: new Map(state.threads.map((thread) => [thread.id, { ...thread, deleted: false }])),
      recordsById: new Map(state.records.map((record) => [record.id, { ...record, deleted: false }])),
      appliedEventIds: new Set(),
    };
  }

  private createProjectionState(
    foldersById: ReadonlyMap<string, RuntimeFolder>,
    threadsById: ReadonlyMap<string, RuntimeThread>,
    recordsById: ReadonlyMap<string, RuntimeRecord>,
    appliedEventIds: ReadonlySet<number | string>,
  ): ProjectionState {
    const visibleFolderIds = this.collectVisibleFolderIds(foldersById);
    const orderedFolders = this.getOrderedVisibleFolders(foldersById, visibleFolderIds);
    const visibleThreads = this.getOrderedVisibleThreads(foldersById, threadsById, visibleFolderIds);
    const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id));
    const threadOrder = new Map(visibleThreads.map((thread, index) => [thread.id, index]));
    const visibleRecords = this.getOrderedVisibleRecords(recordsById, visibleThreadIds, threadOrder);

    const state: ProjectionStateWithRuntime = {
      folders: Object.freeze(orderedFolders.map((folder) => Object.freeze({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        entityVersion: folder.entityVersion,
        lastEventVersion: folder.lastEventVersion,
      }))),
      threads: Object.freeze(visibleThreads.map((thread) => Object.freeze({
        id: thread.id,
        folderId: thread.folderId,
        title: thread.title,
        entityVersion: thread.entityVersion,
        lastEventVersion: thread.lastEventVersion,
      }))),
      records: Object.freeze(visibleRecords.map((record) => Object.freeze({
        id: record.id,
        threadId: record.threadId,
        type: record.type,
        name: record.name,
        createdAt: record.createdAt,
        editedAt: record.editedAt,
        orderIndex: record.orderIndex,
        isStarred: record.isStarred,
        imageGroupId: record.imageGroupId,
        entityVersion: record.entityVersion,
        lastEventVersion: record.lastEventVersion,
        ...(typeof record.mediaId === 'string' ? { mediaId: record.mediaId } : {}),
        ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.size === 'number' || record.size === null ? { size: record.size } : {}),
      }))),
    };

    Object.defineProperty(state, PROJECTION_RUNTIME_STATE, {
      value: Object.freeze({
        foldersById,
        threadsById,
        recordsById,
        appliedEventIds,
      }),
      enumerable: false,
      writable: false,
      configurable: false,
    });

    return Object.freeze(state);
  }

  private assertValidEventVersion(eventVersion: number): void {
    if (!Number.isInteger(eventVersion) || eventVersion <= 0) {
      throw new Error('Invalid eventVersion');
    }
  }

  private insertSnapshotFolder(
    foldersById: Map<string, RuntimeFolder>,
    entity: SnapshotEntity,
  ): void {
    if (!('lastEventVersion' in entity) || entity.lastEventVersion == null) {
      throw new Error('Missing folder lastEventVersion in snapshot');
    }

    this.assertValidEventVersion(entity.lastEventVersion);
    console.log('ORDERING_VALIDATION entity=folder status=OK');

    foldersById.set(entity.entityUuid, {
      id: entity.entityUuid,
      name: entity.data['name'] as string,
      parentId: (entity.data['parentFolderUuid'] as string | null | undefined) ?? null,
      entityVersion: entity.entityVersion,
      lastEventVersion: entity.lastEventVersion,
      deleted: false,
    });
  }

  private insertSnapshotThread(
    threadsById: Map<string, RuntimeThread>,
    entity: SnapshotEntity,
  ): void {
    if (!('lastEventVersion' in entity) || entity.lastEventVersion == null) {
      throw new Error('Missing thread lastEventVersion in snapshot');
    }

    this.assertValidEventVersion(entity.lastEventVersion);
    console.log('ORDERING_VALIDATION entity=thread status=OK');

    threadsById.set(entity.entityUuid, {
      id: entity.entityUuid,
      folderId: ((entity.data['folderUuid'] as string | null | undefined) ?? ROOT_FOLDER_ID),
      title: entity.data['title'] as string,
      entityVersion: entity.entityVersion,
      lastEventVersion: entity.lastEventVersion,
      deleted: false,
    });
  }

  private insertSnapshotRecord(
    recordsById: Map<string, RuntimeRecord>,
    entity: RecordSnapshotEntity,
  ): void {
    if (entity.lastEventVersion == null) {
      throw new Error('Missing lastEventVersion in snapshot');
    }

    this.assertValidEventVersion(entity.lastEventVersion);
    console.log('ORDERING_VALIDATION entity=record status=OK');

    recordsById.set(entity.entityUuid, {
      id: entity.entityUuid,
      threadId: entity.data['threadUuid'] as string,
      type: entity.data['type'] as string,
      name: entity.data['body'] as string,
      createdAt: entity.data['createdAt'] as number,
      editedAt: entity.data['editedAt'] as number,
      orderIndex: typeof entity.data['orderIndex'] === 'number' ? entity.data['orderIndex'] as number : null,
      isStarred: typeof entity.data['isStarred'] === 'boolean' ? entity.data['isStarred'] as boolean : false,
      imageGroupId: this.resolveImageGroupId(entity.data),
      mediaId: this.resolveOptionalString(entity.data, 'mediaId'),
      mimeType: this.resolveOptionalString(entity.data, 'mimeType'),
      title: this.resolveOptionalString(entity.data, 'title'),
      size: this.resolveOptionalNullableNumber(entity.data, 'size'),
      entityVersion: entity.entityVersion,
      lastEventVersion: entity.lastEventVersion,
      deleted: false,
    });
  }

  private applyCreate(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
        foldersById.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          name: eventEnvelope.payload['name'] as string,
          parentId: this.resolveFolderParentId(eventEnvelope.payload),
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      case 'thread':
        threadsById.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          folderId: this.resolveThreadFolderId(eventEnvelope.payload),
          title: eventEnvelope.payload['title'] as string,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      case 'record':
        this.assertCanonicalRecordPayload(eventEnvelope.payload);
        recordsById.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          threadId: eventEnvelope.payload['threadId'] as string,
          type: eventEnvelope.payload['type'] as string,
          name: eventEnvelope.payload['name'] as string,
          createdAt: eventEnvelope.payload['createdAt'] as number,
          editedAt: this.resolveEditedAt(eventEnvelope.payload),
          orderIndex: this.resolveOptionalNumber(eventEnvelope.payload, 'orderIndex'),
          isStarred: this.resolveIsStarred(eventEnvelope.payload),
          imageGroupId: this.resolveImageGroupId(eventEnvelope.payload),
          mediaId: this.resolveOptionalString(eventEnvelope.payload, 'mediaId'),
          mimeType: this.resolveOptionalString(eventEnvelope.payload, 'mimeType'),
          title: this.resolveOptionalString(eventEnvelope.payload, 'title'),
          size: this.resolveOptionalNullableNumber(eventEnvelope.payload, 'size'),
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      case 'imageGroup':
        return;
    }
  }

  private applyUpdate(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder': {
        const existing = foldersById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        foldersById.set(eventEnvelope.entityId, {
          id: existing.id,
          name: this.hasOwn(eventEnvelope.payload, 'name')
            ? eventEnvelope.payload['name'] as string
            : existing.name,
          parentId: this.hasOwn(eventEnvelope.payload, 'parentId') || this.hasOwn(eventEnvelope.payload, 'parentFolderUuid')
            ? this.resolveFolderParentId(eventEnvelope.payload)
            : existing.parentId,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      }
      case 'thread': {
        const existing = threadsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        threadsById.set(eventEnvelope.entityId, {
          id: existing.id,
          folderId: this.hasOwn(eventEnvelope.payload, 'folderId') || this.hasOwn(eventEnvelope.payload, 'folderUuid')
            ? this.resolveThreadFolderId(eventEnvelope.payload)
            : existing.folderId,
          title: this.hasOwn(eventEnvelope.payload, 'title')
            ? eventEnvelope.payload['title'] as string
            : existing.title,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      }
      case 'record': {
        const existing = recordsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.assertCanonicalRecordPayload(eventEnvelope.payload);
        recordsById.set(eventEnvelope.entityId, {
          id: existing.id,
          threadId: this.hasOwn(eventEnvelope.payload, 'threadId')
            ? eventEnvelope.payload['threadId'] as string
            : existing.threadId,
          type: this.hasOwn(eventEnvelope.payload, 'type')
            ? eventEnvelope.payload['type'] as string
            : existing.type,
          name: this.hasOwn(eventEnvelope.payload, 'name')
            ? eventEnvelope.payload['name'] as string
            : existing.name,
          createdAt: this.hasOwn(eventEnvelope.payload, 'createdAt')
            ? eventEnvelope.payload['createdAt'] as number
            : existing.createdAt,
          editedAt: this.hasOwn(eventEnvelope.payload, 'editedAt')
            ? eventEnvelope.payload['editedAt'] as number
            : existing.editedAt,
          orderIndex: this.hasOwn(eventEnvelope.payload, 'orderIndex')
            ? this.resolveOptionalNumber(eventEnvelope.payload, 'orderIndex')
            : existing.orderIndex,
          isStarred: this.hasOwn(eventEnvelope.payload, 'isStarred')
            ? this.resolveIsStarred(eventEnvelope.payload)
            : existing.isStarred,
          imageGroupId: this.hasOwn(eventEnvelope.payload, 'imageGroupId')
            ? this.resolveImageGroupId(eventEnvelope.payload)
            : existing.imageGroupId,
          mediaId: this.hasOwn(eventEnvelope.payload, 'mediaId')
            ? this.resolveOptionalString(eventEnvelope.payload, 'mediaId')
            : existing.mediaId,
          mimeType: this.hasOwn(eventEnvelope.payload, 'mimeType')
            ? this.resolveOptionalString(eventEnvelope.payload, 'mimeType')
            : existing.mimeType,
          title: this.hasOwn(eventEnvelope.payload, 'title')
            ? this.resolveOptionalString(eventEnvelope.payload, 'title')
            : existing.title,
          size: this.hasOwn(eventEnvelope.payload, 'size')
            ? this.resolveOptionalNullableNumber(eventEnvelope.payload, 'size')
            : existing.size,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      }
      case 'imageGroup':
        return;
    }
  }

  private applyRename(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder': {
        const existing = foldersById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        foldersById.set(eventEnvelope.entityId, {
          ...existing,
          name: eventEnvelope.payload['name'] as string,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      }
      case 'thread': {
        const existing = threadsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        threadsById.set(eventEnvelope.entityId, {
          ...existing,
          title: eventEnvelope.payload['title'] as string,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      }
      case 'record': {
        const existing = recordsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.assertCanonicalRecordPayload(eventEnvelope.payload);
        recordsById.set(eventEnvelope.entityId, {
          ...existing,
          name: eventEnvelope.payload['name'] as string,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      }
      case 'imageGroup':
        return;
    }
  }

  private applyMove(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder': {
        const existing = foldersById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        foldersById.set(eventEnvelope.entityId, {
          ...existing,
          parentId: this.resolveFolderParentId(eventEnvelope.payload),
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      }
      case 'thread': {
        const existing = threadsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        threadsById.set(eventEnvelope.entityId, {
          ...existing,
          folderId: this.resolveThreadFolderId(eventEnvelope.payload),
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      }
      case 'record': {
        const existing = recordsById.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.assertCanonicalRecordPayload(eventEnvelope.payload);
        recordsById.set(eventEnvelope.entityId, {
          ...existing,
          threadId: eventEnvelope.payload['threadId'] as string,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      }
      case 'imageGroup':
        return;
    }
  }

  private applySoftDelete(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder': {
        const existing = foldersById.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        foldersById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      }
      case 'thread': {
        const existing = threadsById.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        threadsById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      }
      case 'record': {
        const existing = recordsById.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        recordsById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      }
      case 'imageGroup':
        return;
    }
  }

  private applyRestore(
    foldersById: Map<string, RuntimeFolder>,
    threadsById: Map<string, RuntimeThread>,
    recordsById: Map<string, RuntimeRecord>,
    eventEnvelope: EventEnvelope,
  ): void {
    switch (eventEnvelope.entityType) {
      case 'folder': {
        const existing = foldersById.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        foldersById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=folder status=OK');
        return;
      }
      case 'thread': {
        const existing = threadsById.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        threadsById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=thread status=OK');
        return;
      }
      case 'record': {
        const existing = recordsById.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        recordsById.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          entityVersion: eventEnvelope.eventVersion,
          lastEventVersion: eventEnvelope.eventVersion,
        });
        console.log('ORDERING_VALIDATION entity=record status=OK');
        return;
      }
      case 'imageGroup':
        return;
    }
  }

  private collectVisibleFolderIds(foldersById: ReadonlyMap<string, RuntimeFolder>): Set<string> {
    const visibleFolderIds = new Set<string>();

    for (const folder of foldersById.values()) {
      if (this.isFolderVisible(foldersById, folder.id)) {
        visibleFolderIds.add(folder.id);
      }
    }

    return visibleFolderIds;
  }

  private getOrderedVisibleFolders(
    foldersById: ReadonlyMap<string, RuntimeFolder>,
    visibleFolderIds: ReadonlySet<string>,
  ): readonly RuntimeFolder[] {
    const childrenByParent = new Map<string | null, RuntimeFolder[]>();

    for (const folder of foldersById.values()) {
      if (!visibleFolderIds.has(folder.id)) {
        continue;
      }

      const siblings = childrenByParent.get(folder.parentId) ?? [];
      siblings.push(folder);
      childrenByParent.set(folder.parentId, siblings);
    }

    const orderedFolders: RuntimeFolder[] = [];
    const visit = (parentId: string | null): void => {
      const siblings = [...(childrenByParent.get(parentId) ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id));

      for (const folder of siblings) {
        orderedFolders.push(folder);
        visit(folder.id);
      }
    };

    visit(null);
    return orderedFolders;
  }

  private getOrderedVisibleThreads(
    foldersById: ReadonlyMap<string, RuntimeFolder>,
    threadsById: ReadonlyMap<string, RuntimeThread>,
    visibleFolderIds: ReadonlySet<string>,
  ): readonly RuntimeThread[] {
    const folderOrder = new Map(
      this.getOrderedVisibleFolders(foldersById, visibleFolderIds).map((folder, index) => [folder.id, index]),
    );
    const orderedThreads: RuntimeThread[] = [];

    for (const thread of threadsById.values()) {
      if (thread.deleted) {
        continue;
      }

      if (thread.folderId !== ROOT_FOLDER_ID && !visibleFolderIds.has(thread.folderId)) {
        continue;
      }

      orderedThreads.push(thread);
    }

    return orderedThreads.sort((left, right) => {
      const leftFolderOrder = left.folderId === ROOT_FOLDER_ID
        ? -1
        : (folderOrder.get(left.folderId) ?? Number.MAX_SAFE_INTEGER);
      const rightFolderOrder = right.folderId === ROOT_FOLDER_ID
        ? -1
        : (folderOrder.get(right.folderId) ?? Number.MAX_SAFE_INTEGER);
      if (leftFolderOrder !== rightFolderOrder) {
        return leftFolderOrder - rightFolderOrder;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private getOrderedVisibleRecords(
    recordsById: ReadonlyMap<string, RuntimeRecord>,
    visibleThreadIds: ReadonlySet<string>,
    threadOrder: ReadonlyMap<string, number>,
  ): readonly RuntimeRecord[] {
    const orderedRecords: RuntimeRecord[] = [];

    for (const record of recordsById.values()) {
      if (record.deleted || !visibleThreadIds.has(record.threadId)) {
        continue;
      }

      orderedRecords.push(record);
    }

    return orderedRecords.sort((left, right) => {
      const leftThreadOrder = threadOrder.get(left.threadId) ?? Number.MAX_SAFE_INTEGER;
      const rightThreadOrder = threadOrder.get(right.threadId) ?? Number.MAX_SAFE_INTEGER;
      if (leftThreadOrder !== rightThreadOrder) {
        return leftThreadOrder - rightThreadOrder;
      }

      const leftOrderIndex = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightOrderIndex = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftOrderIndex !== rightOrderIndex) {
        return leftOrderIndex - rightOrderIndex;
      }

      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private isFolderVisible(foldersById: ReadonlyMap<string, RuntimeFolder>, folderId: string): boolean {
    const visited = new Set<string>();
    let currentFolderId: string | null = folderId;

    while (currentFolderId !== null) {
      if (visited.has(currentFolderId)) {
        return false;
      }

      visited.add(currentFolderId);

      const folder = foldersById.get(currentFolderId);
      if (!folder || folder.deleted) {
        return false;
      }

      currentFolderId = folder.parentId;
    }

    return true;
  }

  private getDerivedImageGroupVersion(
    recordsById: ReadonlyMap<string, RuntimeRecord>,
    imageGroupId: string,
  ): number | null {
    let currentVersion: number | null = null;

    for (const record of recordsById.values()) {
      if (record.deleted || record.imageGroupId !== imageGroupId) {
        continue;
      }

      currentVersion = currentVersion === null
        ? record.entityVersion
        : Math.max(currentVersion, record.entityVersion);
    }

    return currentVersion;
  }

  private hasOwn(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key);
  }

  private assertCanonicalRecordPayload(payload: Record<string, unknown>): void {
    if (
      this.hasOwn(payload, 'uuid')
      || this.hasOwn(payload, 'threadUuid')
      || this.hasOwn(payload, 'body')
      || this.hasOwn(payload, 'recordType')
    ) {
      throw new Error('Record event payload must be canonical');
    }
  }

  private resolveImageGroupId(payload: Record<string, unknown>): string | null {
    const imageGroupId = payload['imageGroupId'];
    return typeof imageGroupId === 'string' ? imageGroupId : imageGroupId === null ? null : null;
  }

  private resolveOptionalNumber(payload: Record<string, unknown>, key: string): number | null {
    const value = payload[key];
    return typeof value === 'number' ? value : null;
  }

  private resolveOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' ? value : undefined;
  }

  private resolveOptionalNullableNumber(
    payload: Record<string, unknown>,
    key: string,
  ): number | null | undefined {
    if (!this.hasOwn(payload, key)) {
      return undefined;
    }

    const value = payload[key];
    return typeof value === 'number' || value === null ? value : undefined;
  }

  private resolveEditedAt(payload: Record<string, unknown>): number {
    const editedAt = payload['editedAt'];
    if (typeof editedAt === 'number') {
      return editedAt;
    }

    return payload['createdAt'] as number;
  }

  private resolveFolderParentId(payload: Record<string, unknown>): string | null {
    const parentId = payload['parentId'];
    if (typeof parentId === 'string' || parentId === null) {
      return parentId;
    }

    const legacyParentId = payload['parentFolderUuid'];
    return typeof legacyParentId === 'string' || legacyParentId === null ? legacyParentId : null;
  }

  private resolveThreadFolderId(payload: Record<string, unknown>): string {
    const folderId = payload['folderId'];
    if (typeof folderId === 'string') {
      return folderId;
    }

    const legacyFolderId = payload['folderUuid'];
    return typeof legacyFolderId === 'string' ? legacyFolderId : ROOT_FOLDER_ID;
  }

  private resolveIsStarred(payload: Record<string, unknown>): boolean {
    return payload['isStarred'] === true;
  }
}