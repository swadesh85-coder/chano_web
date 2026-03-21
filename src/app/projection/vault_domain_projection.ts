import type {
  EventEnvelope,
  Folder,
  ProjectionSnapshotDocument,
  ProjectionState,
  RecordEntry,
  SnapshotEntity,
  Thread,
} from './projection.models';
import {
  ImageGroupProjection,
  type ImageGroupProjectionRecord,
  type ImageGroupView,
} from './image_group_projection';

type CanonicalFolder = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly ownerUserId: string;
  readonly lastMutationVersion: number;
  readonly deleted: boolean;
};

type CanonicalThread = {
  readonly id: string;
  readonly folderId: string;
  readonly title: string;
  readonly ownerUserId: string;
  readonly lastMutationVersion: number;
  readonly deleted: boolean;
};

type CanonicalRecord = {
  readonly id: string;
  readonly threadId: string;
  readonly type: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly createdAt: number;
  readonly editedAt: number;
  readonly orderIndex: number | null;
  readonly isStarred: boolean;
  readonly imageGroupId: string | null;
  readonly mediaId?: string;
  readonly mimeType?: string;
  readonly title?: string;
  readonly size?: number | null;
  readonly lastEventVersion: number | null;
  readonly lastMutationVersion: number;
  readonly deleted: boolean;
};

const ROOT_FOLDER_ID = 'root';

export class VaultDomainProjection {
  private readonly folders = new Map<string, CanonicalFolder>();
  private readonly threads = new Map<string, CanonicalThread>();
  private readonly records = new Map<string, CanonicalRecord>();
  private readonly appliedEventIds = new Set<string>();
  private readonly imageGroupProjection = new ImageGroupProjection((threadId) =>
    this.getImageGroupProjectionRecords(threadId),
  );

  reset(): void {
    this.folders.clear();
    this.threads.clear();
    this.records.clear();
    this.appliedEventIds.clear();
    this.imageGroupProjection.reset();
  }

  applySnapshot(snapshotEntities: ProjectionSnapshotDocument): ProjectionState {
    this.reset();

    for (const entity of snapshotEntities.folders ?? []) {
      this.insertSnapshotFolder(entity);
    }

    for (const entity of snapshotEntities.threads ?? []) {
      this.insertSnapshotThread(entity);
    }

    for (const entity of snapshotEntities.records ?? []) {
      this.insertSnapshotRecord(entity);
    }

    for (const threadId of this.threads.keys()) {
      this.imageGroupProjection.buildImageGroups(threadId);
    }

    return this.getState();
  }

  applyEvent(eventEnvelope: EventEnvelope): ProjectionState {
    if (this.appliedEventIds.has(eventEnvelope.eventId)) {
      return this.getState();
    }

    console.log(
      `APPLY eventVersion=${eventEnvelope.eventVersion} entity=${eventEnvelope.entityType} id=${eventEnvelope.entityId} op=${eventEnvelope.operation}`,
    );

    this.appliedEventIds.add(eventEnvelope.eventId);
    const previousRecord = eventEnvelope.entityType === 'record'
      ? this.toImageGroupProjectionRecord(this.records.get(eventEnvelope.entityId) ?? null)
      : null;

    switch (eventEnvelope.operation) {
      case 'create':
        this.applyCreate(eventEnvelope);
        break;
      case 'update':
        this.applyUpdate(eventEnvelope);
        break;
      case 'rename':
        this.applyRename(eventEnvelope);
        break;
      case 'move':
        this.applyMove(eventEnvelope);
        break;
      case 'delete':
      case 'softDelete':
        this.applySoftDelete(eventEnvelope);
        break;
      case 'restore':
        this.applyRestore(eventEnvelope);
        break;
    }

    if (eventEnvelope.entityType === 'record') {
      this.imageGroupProjection.updateOnEvent(
        eventEnvelope,
        previousRecord,
        this.toImageGroupProjectionRecord(this.records.get(eventEnvelope.entityId) ?? null),
      );
    }

    return this.getState();
  }

  buildImageGroups(threadId: string): readonly ImageGroupView[] {
    return this.imageGroupProjection.buildImageGroups(threadId);
  }

  getImageGroups(threadId: string): readonly ImageGroupView[] {
    return this.imageGroupProjection.getGroupsForThread(threadId);
  }

  getEntityVersion(entityType: EventEnvelope['entityType'], entityId: string): number | null {
    switch (entityType) {
      case 'folder':
      case 'imageGroup':
        return this.folders.get(entityId)?.lastMutationVersion ?? null;
      case 'thread':
        return this.threads.get(entityId)?.lastMutationVersion ?? null;
      case 'record':
        return this.records.get(entityId)?.lastMutationVersion ?? null;
    }
  }

  getRecordLastEventVersion(entityId: string): number | null {
    return this.records.get(entityId)?.lastEventVersion ?? null;
  }

  hasEntityId(entityId: string): boolean {
    return this.folders.has(entityId)
      || this.threads.has(entityId)
      || this.records.has(entityId);
  }

  getState(): ProjectionState {
    const visibleFolderIds = this.collectVisibleFolderIds();
    const visibleFolders = this.toVisibleFolders(visibleFolderIds);
    const visibleThreadIds = this.collectVisibleThreadIds(visibleFolderIds);
    const visibleThreads = this.toVisibleThreads(visibleFolderIds, visibleThreadIds);
    const visibleRecords = this.toVisibleRecords(visibleThreadIds);

    return {
      folders: visibleFolders,
      threads: visibleThreads,
      records: visibleRecords,
    };
  }

  serializeSnapshotDocument(): string {
    const visibleFolderIds = this.collectVisibleFolderIds();
    const orderedFolders = this.getOrderedVisibleFolders(visibleFolderIds);
    const folderOrder = new Map(orderedFolders.map((folder, index) => [folder.id, index]));
    const visibleThreadIds = this.collectVisibleThreadIds(visibleFolderIds);
    const orderedThreads = this.getOrderedVisibleThreads(visibleFolderIds, visibleThreadIds, folderOrder);
    const threadOrder = new Map(orderedThreads.map((thread, index) => [thread.id, index]));
    const orderedRecords = this.getOrderedVisibleRecords(visibleThreadIds, threadOrder);

    return JSON.stringify({
      folders: orderedFolders.map((folder) => ({
        entityType: 'folder' as const,
        entityUuid: folder.id,
        entityVersion: folder.lastMutationVersion,
        ownerUserId: folder.ownerUserId,
        data: {
          uuid: folder.id,
          name: folder.name,
          parentFolderUuid: folder.parentId,
        },
      })),
      threads: orderedThreads.map((thread) => ({
        entityType: 'thread' as const,
        entityUuid: thread.id,
        entityVersion: thread.lastMutationVersion,
        ownerUserId: thread.ownerUserId,
        data: {
          uuid: thread.id,
          folderUuid: thread.folderId === ROOT_FOLDER_ID ? null : thread.folderId,
          title: thread.title,
        },
      })),
      records: orderedRecords.map((record) => ({
        entityType: 'record' as const,
        entityUuid: record.id,
        entityVersion: record.lastMutationVersion,
        ownerUserId: record.ownerUserId,
        data: {
          uuid: record.id,
          threadUuid: record.threadId,
          type: record.type,
          body: record.name,
          createdAt: record.createdAt,
          editedAt: record.editedAt,
          orderIndex: record.orderIndex ?? 0,
          isStarred: record.isStarred,
          imageGroupId: record.imageGroupId,
          ...(typeof record.mediaId === 'string' ? { mediaId: record.mediaId } : {}),
          ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
          ...(typeof record.title === 'string' ? { title: record.title } : {}),
          ...(typeof record.size === 'number' || record.size === null ? { size: record.size } : {}),
        },
      })),
    });
  }

  private insertSnapshotFolder(entity: SnapshotEntity): void {
    this.folders.set(entity.entityUuid, {
      id: entity.entityUuid,
      name: entity.data['name'] as string,
      parentId: (entity.data['parentFolderUuid'] as string | null | undefined) ?? null,
      ownerUserId: entity.ownerUserId,
      lastMutationVersion: entity.entityVersion,
      deleted: false,
    });
  }

  private insertSnapshotThread(entity: SnapshotEntity): void {
    this.threads.set(entity.entityUuid, {
      id: entity.entityUuid,
      folderId: ((entity.data['folderUuid'] as string | null | undefined) ?? ROOT_FOLDER_ID),
      title: entity.data['title'] as string,
      ownerUserId: entity.ownerUserId,
      lastMutationVersion: entity.entityVersion,
      deleted: false,
    });
  }

  private insertSnapshotRecord(entity: SnapshotEntity): void {
    this.records.set(entity.entityUuid, {
      id: entity.entityUuid,
      threadId: entity.data['threadUuid'] as string,
      type: entity.data['type'] as string,
      name: entity.data['body'] as string,
      ownerUserId: entity.ownerUserId,
      createdAt: entity.data['createdAt'] as number,
      editedAt: entity.data['editedAt'] as number,
      orderIndex: typeof entity.data['orderIndex'] === 'number' ? entity.data['orderIndex'] as number : null,
      isStarred: typeof entity.data['isStarred'] === 'boolean' ? entity.data['isStarred'] as boolean : false,
      imageGroupId: this.resolveImageGroupId(entity.data),
      mediaId: this.resolveOptionalString(entity.data, 'mediaId'),
      mimeType: this.resolveOptionalString(entity.data, 'mimeType'),
      title: this.resolveOptionalString(entity.data, 'title'),
      size: this.resolveOptionalNullableNumber(entity.data, 'size'),
      lastEventVersion: null,
      lastMutationVersion: entity.entityVersion,
      deleted: false,
    });
  }

  private applyCreate(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup':
        this.folders.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          name: eventEnvelope.payload['name'] as string,
          parentId: (eventEnvelope.payload['parentFolderUuid'] as string | null | undefined) ?? null,
          ownerUserId: eventEnvelope.originDeviceId,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        break;
      case 'thread':
        this.threads.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          folderId: (eventEnvelope.payload['folderUuid'] as string | null | undefined) ?? ROOT_FOLDER_ID,
          title: eventEnvelope.payload['title'] as string,
          ownerUserId: eventEnvelope.originDeviceId,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        break;
      case 'record':
        this.records.set(eventEnvelope.entityId, {
          id: eventEnvelope.entityId,
          threadId: eventEnvelope.payload['threadUuid'] as string,
          type: this.resolveRecordType(eventEnvelope.payload),
          name: eventEnvelope.payload['body'] as string,
          ownerUserId: eventEnvelope.originDeviceId,
          createdAt: eventEnvelope.payload['createdAt'] as number,
          editedAt: this.resolveEditedAt(eventEnvelope.payload),
          orderIndex: this.resolveOptionalNumber(eventEnvelope.payload, 'orderIndex'),
          isStarred: this.resolveIsStarred(eventEnvelope.payload),
          imageGroupId: this.resolveImageGroupId(eventEnvelope.payload),
          mediaId: this.resolveOptionalString(eventEnvelope.payload, 'mediaId'),
          mimeType: this.resolveOptionalString(eventEnvelope.payload, 'mimeType'),
          title: this.resolveOptionalString(eventEnvelope.payload, 'title'),
          size: this.resolveOptionalNullableNumber(eventEnvelope.payload, 'size'),
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: false,
        });
        break;
    }
  }

  private applyUpdate(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const existing = this.folders.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.folders.set(eventEnvelope.entityId, {
          id: existing.id,
          name: this.hasOwn(eventEnvelope.payload, 'name')
            ? eventEnvelope.payload['name'] as string
            : existing.name,
          parentId: this.hasOwn(eventEnvelope.payload, 'parentFolderUuid')
            ? (eventEnvelope.payload['parentFolderUuid'] as string | null)
            : existing.parentId,
          ownerUserId: existing.ownerUserId,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        break;
      }
      case 'thread': {
        const existing = this.threads.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.threads.set(eventEnvelope.entityId, {
          id: existing.id,
          folderId: this.hasOwn(eventEnvelope.payload, 'folderUuid')
            ? ((eventEnvelope.payload['folderUuid'] as string | null | undefined) ?? ROOT_FOLDER_ID)
            : existing.folderId,
          title: this.hasOwn(eventEnvelope.payload, 'title')
            ? eventEnvelope.payload['title'] as string
            : existing.title,
          ownerUserId: existing.ownerUserId,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        break;
      }
      case 'record': {
        const existing = this.records.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.records.set(eventEnvelope.entityId, {
          id: existing.id,
          threadId: this.hasOwn(eventEnvelope.payload, 'threadUuid')
            ? eventEnvelope.payload['threadUuid'] as string
            : existing.threadId,
          type: this.hasOwn(eventEnvelope.payload, 'type') || this.hasOwn(eventEnvelope.payload, 'recordType')
            ? this.resolveRecordType(eventEnvelope.payload)
            : existing.type,
          name: this.hasOwn(eventEnvelope.payload, 'body')
            ? eventEnvelope.payload['body'] as string
            : existing.name,
          ownerUserId: existing.ownerUserId,
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
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
          deleted: existing.deleted,
        });
        break;
      }
    }
  }

  private applyRename(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const existing = this.folders.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.folders.set(eventEnvelope.entityId, {
          ...existing,
          name: eventEnvelope.payload['name'] as string,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'thread': {
        const existing = this.threads.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.threads.set(eventEnvelope.entityId, {
          ...existing,
          title: eventEnvelope.payload['title'] as string,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'record': {
        const existing = this.records.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.records.set(eventEnvelope.entityId, {
          ...existing,
          name: eventEnvelope.payload['body'] as string,
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
    }
  }

  private applyMove(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const existing = this.folders.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.folders.set(eventEnvelope.entityId, {
          ...existing,
          parentId: (eventEnvelope.payload['parentFolderUuid'] as string | null | undefined) ?? null,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'thread': {
        const existing = this.threads.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.threads.set(eventEnvelope.entityId, {
          ...existing,
          folderId: (eventEnvelope.payload['folderUuid'] as string | null | undefined) ?? ROOT_FOLDER_ID,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'record': {
        const existing = this.records.get(eventEnvelope.entityId);
        if (!existing) {
          return;
        }

        this.records.set(eventEnvelope.entityId, {
          ...existing,
          threadId: eventEnvelope.payload['threadUuid'] as string,
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
    }
  }

  private applySoftDelete(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const existing = this.folders.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        this.folders.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'thread': {
        const existing = this.threads.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        this.threads.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'record': {
        const existing = this.records.get(eventEnvelope.entityId);
        if (!existing || existing.deleted) {
          return;
        }

        this.records.set(eventEnvelope.entityId, {
          ...existing,
          deleted: true,
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
    }
  }

  private applyRestore(eventEnvelope: EventEnvelope): void {
    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const existing = this.folders.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        this.folders.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'thread': {
        const existing = this.threads.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        this.threads.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
      case 'record': {
        const existing = this.records.get(eventEnvelope.entityId);
        if (!existing || !existing.deleted) {
          return;
        }

        this.records.set(eventEnvelope.entityId, {
          ...existing,
          deleted: false,
          lastEventVersion: eventEnvelope.eventVersion,
          lastMutationVersion: eventEnvelope.eventVersion,
        });
        break;
      }
    }
  }

  private getImageGroupProjectionRecords(threadId: string): readonly ImageGroupProjectionRecord[] {
    const matchingRecords: ImageGroupProjectionRecord[] = [];

    for (const record of this.records.values()) {
      if (record.threadId !== threadId) {
        continue;
      }

      matchingRecords.push(this.toImageGroupProjectionRecord(record)!);
    }

    return matchingRecords;
  }

  private toImageGroupProjectionRecord(record: CanonicalRecord | null): ImageGroupProjectionRecord | null {
    if (record === null) {
      return null;
    }

    return {
      id: record.id,
      threadId: record.threadId,
      type: record.type,
      imageGroupId: record.imageGroupId,
      orderIndex: record.orderIndex,
      lastMutationVersion: record.lastMutationVersion,
      deleted: record.deleted,
    };
  }

  private collectVisibleFolderIds(): Set<string> {
    const visibleFolderIds = new Set<string>();

    for (const folder of this.folders.values()) {
      if (this.isFolderVisible(folder.id)) {
        visibleFolderIds.add(folder.id);
      }
    }

    return visibleFolderIds;
  }

  private collectVisibleThreadIds(visibleFolderIds: ReadonlySet<string>): Set<string> {
    const visibleThreadIds = new Set<string>();

    for (const thread of this.threads.values()) {
      if (thread.deleted) {
        continue;
      }

      if (thread.folderId === ROOT_FOLDER_ID || visibleFolderIds.has(thread.folderId)) {
        visibleThreadIds.add(thread.id);
      }
    }

    return visibleThreadIds;
  }

  private toVisibleFolders(visibleFolderIds: ReadonlySet<string>): Folder[] {
    return this.getOrderedVisibleFolders(visibleFolderIds).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    }));
  }

  private getOrderedVisibleFolders(visibleFolderIds: ReadonlySet<string>): readonly CanonicalFolder[] {
    const childrenByParent = new Map<string | null, CanonicalFolder[]>();

    for (const folder of this.folders.values()) {
      if (!visibleFolderIds.has(folder.id)) {
        continue;
      }

      const siblings = childrenByParent.get(folder.parentId) ?? [];
      siblings.push(folder);
      childrenByParent.set(folder.parentId, siblings);
    }

    const orderedFolders: CanonicalFolder[] = [];
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

  private toVisibleThreads(
    visibleFolderIds: ReadonlySet<string>,
    visibleThreadIds: ReadonlySet<string>,
  ): Thread[] {
    const folderOrder = new Map(this.getOrderedVisibleFolders(visibleFolderIds).map((folder, index) => [folder.id, index]));

    return this.getOrderedVisibleThreads(visibleFolderIds, visibleThreadIds, folderOrder).map((thread) => ({
      id: thread.id,
      folderId: thread.folderId,
      title: thread.title,
    }));
  }

  private getOrderedVisibleThreads(
    visibleFolderIds: ReadonlySet<string>,
    visibleThreadIds: ReadonlySet<string>,
    folderOrder: ReadonlyMap<string, number>,
  ): readonly CanonicalThread[] {
    const orderedThreads: CanonicalThread[] = [];

    for (const thread of this.threads.values()) {
      if (!visibleThreadIds.has(thread.id)) {
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

  private toVisibleRecords(visibleThreadIds: ReadonlySet<string>): RecordEntry[] {
    const visibleFolderIds = this.collectVisibleFolderIds();
    const folderOrder = new Map(
      this.getOrderedVisibleFolders(visibleFolderIds).map((folder, index) => [folder.id, index]),
    );
    const threadOrder = new Map(
      this.getOrderedVisibleThreads(visibleFolderIds, visibleThreadIds, folderOrder)
        .map((thread, index) => [thread.id, index]),
    );

    return this.getOrderedVisibleRecords(visibleThreadIds, threadOrder).map((record) => ({
      id: record.id,
      threadId: record.threadId,
      type: record.type,
      name: record.name,
      createdAt: record.createdAt,
      editedAt: record.editedAt,
      orderIndex: record.orderIndex,
      isStarred: record.isStarred,
      imageGroupId: record.imageGroupId,
      ...(typeof record.mediaId === 'string' ? { mediaId: record.mediaId } : {}),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
      ...(typeof record.size === 'number' || record.size === null ? { size: record.size } : {}),
    }));
  }

  private getOrderedVisibleRecords(
    visibleThreadIds: ReadonlySet<string>,
    threadOrder: ReadonlyMap<string, number>,
  ): readonly CanonicalRecord[] {
    const orderedRecords: CanonicalRecord[] = [];

    for (const record of this.records.values()) {
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

  private isFolderVisible(folderId: string): boolean {
    const visited = new Set<string>();
    let currentFolderId: string | null = folderId;

    while (currentFolderId !== null) {
      if (visited.has(currentFolderId)) {
        return false;
      }

      visited.add(currentFolderId);

      const folder = this.folders.get(currentFolderId);
      if (!folder || folder.deleted) {
        return false;
      }

      currentFolderId = folder.parentId;
    }

    return true;
  }

  private hasOwn(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key);
  }

  private resolveRecordType(payload: Record<string, unknown>): string {
    const recordType = payload['recordType'];
    if (typeof recordType === 'string') {
      return recordType;
    }

    return payload['type'] as string;
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

  private resolveIsStarred(payload: Record<string, unknown>): boolean {
    return payload['isStarred'] === true;
  }
}