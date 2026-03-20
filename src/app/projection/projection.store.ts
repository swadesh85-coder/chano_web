import { Injectable, inject, signal, computed } from '@angular/core';
import { WebRelayClient } from '../../transport/web-relay-client';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { SnapshotLoader, type SnapshotLoaderEvent } from './snapshot_loader';
import { ProjectionEngine } from './projection_engine';
import { validateEventEnvelope, type EventValidationFailureReason } from './projection_event_validation';
import type {
  Folder,
  Thread,
  RecordEntry,
  ExplorerNode,
  VaultEvent,
  EventOperation,
  EventEntity,
} from './projection.models';

export type SnapshotPhase = 'idle' | 'receiving' | 'ready';

type SnapshotEntityType = EventEntity;

type SnapshotEntityWrapper = {
  readonly entityType: SnapshotEntityType;
  readonly entityUuid: string;
  readonly entityVersion: number;
  readonly ownerUserId: string;
  readonly data: Record<string, unknown>;
};

type FolderEntityData = {
  readonly uuid: string;
  readonly name: string;
  readonly parentFolderUuid: string | null;
};

type ThreadEntityData = {
  readonly uuid: string;
  readonly folderUuid: string | null;
  readonly title: string;
};

type RecordEntityData = {
  readonly uuid: string;
  readonly threadUuid: string;
  readonly type: string;
  readonly body: string;
  readonly createdAt: number;
  readonly editedAt: number;
  readonly orderIndex: number;
  readonly isStarred: boolean;
  readonly imageGroupId: string | null;
};

@Injectable({ providedIn: 'root' })
export class ProjectionStore {
  private readonly relay = inject(WebRelayClient);
  private readonly snapshotLoader = inject(SnapshotLoader);
  private readonly projectionEngine = new ProjectionEngine({
    emitResyncRequired: (reason, details) => {
      console.error(
        `SNAPSHOT_RESYNC_REQUIRED reason=${reason} expected=${details.expectedEventVersion} received=${details.receivedEventVersion}`,
      );
    },
  });
  private authoritativeEventQueue: Promise<void> = Promise.resolve();

  private readonly _folders = signal<Folder[]>([]);
  private readonly _threads = signal<Thread[]>([]);
  private readonly _records = signal<RecordEntry[]>([]);
  private readonly _phase = signal<SnapshotPhase>('idle');
  private readonly _baseEventVersion = signal<number | null>(null);
  private readonly _lastAppliedEventVersion = signal<number | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly folders = this._folders.asReadonly();
  readonly threads = this._threads.asReadonly();
  readonly records = this._records.asReadonly();
  readonly baseEventVersion = this._baseEventVersion.asReadonly();
  readonly lastAppliedEventVersion = this._lastAppliedEventVersion.asReadonly();

  readonly explorerTree = computed<ExplorerNode[]>(() =>
    this.buildHierarchy(this._folders(), this._threads(), this._records()),
  );

  constructor() {
    this.snapshotLoader.onEvent((event) => this.handleSnapshotLoaderEvent(event));
    this.relay.onEnvelope((msg) => this.handleEnvelope(msg));
  }

  getEntityVersion(entityType: EventEntity, entityId: string): number | null {
    return this.projectionEngine.getEntityVersion(entityType, entityId);
  }

  hasEntityId(entityId: string): boolean {
    return this.projectionEngine.hasEntityId(entityId);
  }

  private handleEnvelope(msg: TransportEnvelope): void {
    if (msg.type.startsWith('snapshot_')) {
      switch (msg.type) {
        case 'snapshot_start':
          this.onSnapshotStart(msg);
          break;
        case 'snapshot_chunk':
          this.onSnapshotChunk(msg);
          break;
        case 'snapshot_complete':
          void this.onSnapshotComplete(msg);
          break;
      }
      return;
    }

    if (msg.type === 'event_stream') {
      this.onEventStream(msg);
    }
  }

  // ── Snapshot lifecycle ───────────────────────────────────

  private onSnapshotStart(msg: TransportEnvelope): void {
    this.projectionEngine.reset();
    this._folders.set([]);
    this._threads.set([]);
    this._records.set([]);
    this._baseEventVersion.set(null);
    this._lastAppliedEventVersion.set(null);

    if (this.isByteSnapshotStartPayload(msg.payload)) {
      this.snapshotLoader.handleSnapshotStart(msg);
    }

    this._phase.set('receiving');
  }

  private onSnapshotChunk(msg: TransportEnvelope): void {
    if (this._phase() !== 'receiving') {
      return;
    }

    if (this.isByteSnapshotChunkPayload(msg.payload)) {
      this.snapshotLoader.handleSnapshotChunk(msg);
      return;
    }

    this.applyLegacySnapshotChunk(msg.payload);
  }

  private async onSnapshotComplete(msg: TransportEnvelope): Promise<void> {
    if (this.isByteSnapshotCompletePayload(msg.payload)) {
      await this.snapshotLoader.handleSnapshotComplete(msg);
      return;
    }

    this._phase.set('ready');
  }

  private applyLegacySnapshotChunk(payload: Record<string, unknown>): void {
    if (this._phase() !== 'receiving') return;

    let chunk: Record<string, unknown>;
    const raw = payload['data'];
    if (typeof raw === 'string') {
      try {
        chunk = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.reportSchemaValidationError();
        return;
      }
    } else if (raw !== null && typeof raw === 'object') {
      chunk = raw as Record<string, unknown>;
    } else {
      this.reportSchemaValidationError();
      return;
    }

    console.log('SNAPSHOT CHUNK PARSED:', chunk);

    const folders = this.parseSnapshotEntities(chunk['folders'], ['folder', 'imageGroup']);
    const threads = this.parseSnapshotEntities(chunk['threads'], ['thread']);
    const records = this.parseSnapshotEntities(chunk['records'], ['record']);

    if (folders.length) {
      const parsed = folders
        .map((entity) => this.parseFolderData(entity.data))
        .filter((entity): entity is Folder => entity !== null);
      if (parsed.length) {
        this._folders.update((prev) => [...prev, ...parsed]);
      }
    }
    if (threads.length) {
      const parsed = threads
        .map((entity) => this.parseThreadData(entity.data))
        .filter((entity): entity is Thread => entity !== null);
      if (parsed.length) {
        this._threads.update((prev) => [...prev, ...parsed]);
      }
    }
    if (records.length) {
      const parsed = records
        .map((entity) => this.parseRecordData(entity.data))
        .filter((entity): entity is RecordEntry => entity !== null);
      if (parsed.length) {
        this._records.update((prev) => [...prev, ...parsed]);
      }
    }
  }

  private handleSnapshotLoaderEvent(event: SnapshotLoaderEvent): void {
    switch (event.type) {
      case 'SNAPSHOT_ERROR':
        this.projectionEngine.reset();
        this._folders.set([]);
        this._threads.set([]);
        this._records.set([]);
        this._baseEventVersion.set(null);
        this._lastAppliedEventVersion.set(null);
        this._phase.set('idle');
        return;
      case 'SNAPSHOT_LOADED':
        this.applyDecodedSnapshot(event.snapshotJson, event.baseEventVersion);
        return;
    }
  }

  private applyDecodedSnapshot(snapshotJson: string, baseEventVersion: number): void {
    let snapshot: unknown;

    try {
      snapshot = JSON.parse(snapshotJson);
    } catch {
      this.projectionEngine.reset();
      this._folders.set([]);
      this._threads.set([]);
      this._records.set([]);
      this._baseEventVersion.set(null);
      this._lastAppliedEventVersion.set(null);
      this._phase.set('idle');
      this.reportSchemaValidationError();
      return;
    }

    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      this.projectionEngine.reset();
      this._folders.set([]);
      this._threads.set([]);
      this._records.set([]);
      this._baseEventVersion.set(null);
      this._lastAppliedEventVersion.set(null);
      this._phase.set('idle');
      this.reportSchemaValidationError();
      return;
    }

    const snapshotRecord = snapshot as Record<string, unknown>;
    const folders = this.parseSnapshotEntities(snapshotRecord['folders'], ['folder', 'imageGroup'])
      .map((entity) => this.parseFolderData(entity.data))
      .filter((entity): entity is Folder => entity !== null);
    const threads = this.parseSnapshotEntities(snapshotRecord['threads'], ['thread'])
      .map((entity) => this.parseThreadData(entity.data))
      .filter((entity): entity is Thread => entity !== null);
    const records = this.parseSnapshotEntities(snapshotRecord['records'], ['record'])
      .map((entity) => this.parseRecordData(entity.data))
      .filter((entity): entity is RecordEntry => entity !== null);

    if (
      folders.length !== (Array.isArray(snapshotRecord['folders']) ? snapshotRecord['folders'].length : 0)
      || threads.length !== (Array.isArray(snapshotRecord['threads']) ? snapshotRecord['threads'].length : 0)
      || records.length !== (Array.isArray(snapshotRecord['records']) ? snapshotRecord['records'].length : 0)
    ) {
      this.projectionEngine.reset();
      this._folders.set([]);
      this._threads.set([]);
      this._records.set([]);
      this._baseEventVersion.set(null);
      this._lastAppliedEventVersion.set(null);
      this._phase.set('idle');
      return;
    }

    const result = this.projectionEngine.applySnapshot(snapshotJson, baseEventVersion);

    this.syncProjectionState(result.state);
    this._baseEventVersion.set(baseEventVersion);
    this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
    this._phase.set('ready');
  }

  private isByteSnapshotStartPayload(payload: Record<string, unknown>): boolean {
    return 'snapshotId' in payload
      || 'totalChunks' in payload
      || 'totalBytes' in payload
      || 'baseEventVersion' in payload
      || 'checksum' in payload;
  }

  private isByteSnapshotChunkPayload(payload: Record<string, unknown>): boolean {
    return 'index' in payload;
  }

  private isByteSnapshotCompletePayload(payload: Record<string, unknown>): boolean {
    return 'totalChunks' in payload;
  }

  // ── Event stream handling ────────────────────────────────

  private onEventStream(envelope: TransportEnvelope): void {
    if (!this.looksLikeAuthoritativeEventEnvelope(envelope.payload)) {
      this.onLegacyEventStream(envelope.payload);
      return;
    }

    this.authoritativeEventQueue = this.authoritativeEventQueue
      .then(async () => this.onValidatedEventStream(envelope))
      .catch((error: unknown) => {
        console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
        this.emitValidationResyncRequired('INVALID_SCHEMA');
        if (error instanceof Error) {
          console.error(error.message);
        }
      });
  }

  private async onValidatedEventStream(envelope: TransportEnvelope): Promise<void> {
    const validationResult = await validateEventEnvelope(envelope);
    if (validationResult.status === 'INVALID') {
      if (validationResult.reason === 'INVALID_SCHEMA') {
        this.reportSchemaValidationError();
      }

      this.emitValidationResyncRequired(validationResult.reason);
      return;
    }

    console.log(`EVENT_FORWARDED_TO_ENGINE eventVersion=${validationResult.eventEnvelope.eventVersion}`);

    const result = this.projectionEngine.applyEvent(validationResult.eventEnvelope);

    switch (result.status) {
      case 'EVENT_APPLIED':
      case 'EVENT_IGNORED_DUPLICATE':
        this.syncProjectionState(result.state);
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
      case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
      case 'SNAPSHOT_RESYNC_REQUIRED':
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
    }
  }

  private emitValidationResyncRequired(reason: EventValidationFailureReason): void {
    console.error(`SNAPSHOT_RESYNC_REQUIRED reason=${reason}`);
  }

  private onLegacyEventStream(payload: Record<string, unknown>): void {
    const event = this.parseEvent(payload);
    if (!event) return;

    console.log('EVENT_STREAM:', event.operation, event.entity, event.data);

    switch (event.operation) {
      case 'create': this.applyCreate(event.entity, event.data); break;
      case 'update': this.applyUpdate(event.entity, event.data); break;
      case 'rename': this.applyRename(event.entity, event.data); break;
      case 'move':   this.applyMove(event.entity, event.data);   break;
      case 'delete': this.applyDelete(event.entity, event.data); break;
    }
  }

  private syncProjectionState(state: {
    readonly folders: readonly Folder[];
    readonly threads: readonly Thread[];
    readonly records: readonly RecordEntry[];
  }): void {
    this._folders.set([...state.folders]);
    this._threads.set([...state.threads]);
    this._records.set([...state.records]);
  }

  private looksLikeAuthoritativeEventEnvelope(payload: Record<string, unknown>): boolean {
    return 'eventId' in payload
      || 'originDeviceId' in payload
      || 'eventVersion' in payload
      || 'entityType' in payload
      || 'entityId' in payload
      || 'checksum' in payload;
  }

  private parseEvent(payload: Record<string, unknown>): VaultEvent | null {
    const validOps: readonly string[] = ['create', 'update', 'rename', 'move', 'delete'];
    const validEntities: readonly string[] = ['folder', 'thread', 'record', 'imageGroup'];

    const operation = payload['operation'];
    const entity = payload['entity'];
    let data = payload['data'];

    if (typeof operation !== 'string' || !validOps.includes(operation)) return null;
    if (typeof entity !== 'string' || !validEntities.includes(entity)) return null;

    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch {
        this.reportSchemaValidationError();
        return null;
      }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      this.reportSchemaValidationError();
      return null;
    }

    const canonicalData = data as Record<string, unknown>;
    if (!this.isValidEventData(operation as EventOperation, entity as EventEntity, canonicalData)) {
      this.reportSchemaValidationError();
      return null;
    }

    return {
      operation: operation as EventOperation,
      entity: entity as EventEntity,
      data: canonicalData,
    };
  }

  // ── Create ───────────────────────────────────────────────

  private applyCreate(entity: EventEntity, data: Record<string, unknown>): void {
    switch (entity) {
      case 'folder':
      case 'imageGroup': {
        const parsed = this.parseFolderData(data);
        if (parsed !== null) {
          this._folders.update((prev) => [...prev, parsed]);
        }
        break;
      }
      case 'thread': {
        const parsed = this.parseThreadData(data);
        if (parsed !== null) {
          this._threads.update((prev) => [...prev, parsed]);
        }
        break;
      }
      case 'record': {
        const parsed = this.parseRecordData(data);
        if (parsed !== null) {
          this._records.update((prev) => [...prev, parsed]);
        }
        break;
      }
    }
  }

  // ── Update ───────────────────────────────────────────────

  private applyUpdate(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveUuid(data);
    if (id === undefined) return;

    switch (entity) {
      case 'folder':
      case 'imageGroup':
        this._folders.update((prev) =>
          prev.map((f) => f.id === id ? this.mergeFolder(f, data) : f),
        );
        break;
      case 'thread':
        this._threads.update((prev) =>
          prev.map((t) => t.id === id ? this.mergeThread(t, data) : t),
        );
        break;
      case 'record':
        this._records.update((prev) =>
          prev.map((r) => r.id === id ? this.mergeRecord(r, data) : r),
        );
        break;
    }
  }

  // ── Rename ───────────────────────────────────────────────

  private applyRename(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveUuid(data);
    if (id === undefined) return;

    switch (entity) {
      case 'folder':
      case 'imageGroup': {
        const name = data['name'];
        if (typeof name !== 'string') return;
        this._folders.update((prev) =>
          prev.map((f) => f.id === id ? { ...f, name } : f),
        );
        break;
      }
      case 'thread': {
        const title = data['title'];
        if (typeof title !== 'string') return;
        this._threads.update((prev) =>
          prev.map((t) => t.id === id ? { ...t, title } : t),
        );
        break;
      }
      case 'record': {
        const body = data['body'];
        if (typeof body !== 'string') return;
        this._records.update((prev) =>
          prev.map((r) => r.id === id ? { ...r, name: body } : r),
        );
        break;
      }
    }
  }

  // ── Move ─────────────────────────────────────────────────

  private applyMove(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveUuid(data);
    if (id === undefined) return;

    switch (entity) {
      case 'folder':
      case 'imageGroup': {
        const resolved = this.resolveParentFolderUuid(data);
        if (resolved === undefined) return;
        this._folders.update((prev) =>
          prev.map((f) => f.id === id ? { ...f, parentId: resolved } : f),
        );
        break;
      }
      case 'thread': {
        const folderUuid = this.resolveFolderUuid(data);
        if (folderUuid === undefined) return;
        this._threads.update((prev) =>
          prev.map((t) => t.id === id ? { ...t, folderId: folderUuid ?? 'root' } : t),
        );
        break;
      }
      case 'record': {
        const threadUuid = this.resolveThreadUuid(data);
        if (threadUuid === undefined) return;
        this._records.update((prev) =>
          prev.map((r) => r.id === id ? { ...r, threadId: threadUuid } : r),
        );
        break;
      }
    }
  }

  // ── Delete ───────────────────────────────────────────────

  private applyDelete(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveUuid(data);
    if (id === undefined) return;

    switch (entity) {
      case 'folder':
      case 'imageGroup':
        this.cascadeDeleteFolder(id);
        break;
      case 'thread':
        this.cascadeDeleteThread(id);
        break;
      case 'record':
        this._records.update((prev) => prev.filter((r) => r.id !== id));
        break;
    }
  }

  private cascadeDeleteFolder(folderId: string): void {
    // Collect all descendant folder IDs
    const doomed = new Set<string>([folderId]);
    let size = 0;
    while (doomed.size !== size) {
      size = doomed.size;
      for (const f of this._folders()) {
        if (f.parentId !== null && doomed.has(f.parentId)) doomed.add(f.id);
      }
    }

    // Remove folders
    this._folders.update((prev) => prev.filter((f) => !doomed.has(f.id)));

    // Remove threads under deleted folders and their records
    const doomedThreads = new Set<string>();
    for (const t of this._threads()) {
      if (doomed.has(t.folderId)) doomedThreads.add(t.id);
    }
    this._threads.update((prev) => prev.filter((t) => !doomedThreads.has(t.id)));
    this._records.update((prev) => prev.filter((r) => !doomedThreads.has(r.threadId)));
  }

  private cascadeDeleteThread(threadId: string): void {
    this._threads.update((prev) => prev.filter((t) => t.id !== threadId));
    this._records.update((prev) => prev.filter((r) => r.threadId !== threadId));
  }

  // ── Entity mergers ───────────────────────────────────────

  private mergeFolder(existing: Folder, data: Record<string, unknown>): Folder {
    return {
      id: existing.id,
      name: typeof data['name'] === 'string' ? data['name'] : existing.name,
      parentId: 'parentFolderUuid' in data
        ? (this.resolveParentFolderUuid(data) ?? existing.parentId)
        : existing.parentId,
    };
  }

  private mergeThread(existing: Thread, data: Record<string, unknown>): Thread {
    return {
      id: existing.id,
      folderId: 'folderUuid' in data
        ? (this.resolveFolderUuid(data) ?? existing.folderId ?? 'root')
        : existing.folderId,
      title: typeof data['title'] === 'string' ? data['title'] : existing.title,
    };
  }

  private mergeRecord(existing: RecordEntry, data: Record<string, unknown>): RecordEntry {
    return {
      id: existing.id,
      threadId: 'threadUuid' in data
        ? (this.resolveThreadUuid(data) ?? existing.threadId)
        : existing.threadId,
      type: typeof data['type'] === 'string' ? data['type'] : existing.type,
      name: typeof data['body'] === 'string' ? data['body'] : existing.name,
      createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : existing.createdAt,
    };
  }

  private resolveUuid(o: Record<string, unknown>): string | undefined {
    const v = o['uuid'];
    return typeof v === 'string' ? v : undefined;
  }

  private resolveFolderUuid(o: Record<string, unknown>): string | null | undefined {
    const v = o['folderUuid'];
    return typeof v === 'string' ? v : v === null ? null : undefined;
  }

  private resolveThreadUuid(o: Record<string, unknown>): string | undefined {
    const v = o['threadUuid'];
    return typeof v === 'string' ? v : undefined;
  }

  private resolveParentFolderUuid(o: Record<string, unknown>): string | null | undefined {
    const v = o['parentFolderUuid'];
    return typeof v === 'string' ? v : v === null ? null : undefined;
  }

  private parseSnapshotEntities(
    raw: unknown,
    allowedTypes: readonly SnapshotEntityType[],
  ): SnapshotEntityWrapper[] {
    if (!Array.isArray(raw)) {
      if (raw !== undefined) {
        this.reportSchemaValidationError();
      }
      return [];
    }

    return raw.flatMap((entity) => {
      const parsed = this.parseSnapshotEntity(entity, allowedTypes);
      return parsed === null ? [] : [parsed];
    });
  }

  private parseSnapshotEntity(
    raw: unknown,
    allowedTypes: readonly SnapshotEntityType[],
  ): SnapshotEntityWrapper | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      this.reportSchemaValidationError();
      return null;
    }

    const entity = raw as Record<string, unknown>;
    if (!this.hasExactKeys(entity, ['entityType', 'entityUuid', 'entityVersion', 'ownerUserId', 'data'])) {
      this.reportSchemaValidationError();
      return null;
    }

    const entityType = entity['entityType'];
    const entityUuid = entity['entityUuid'];
    const entityVersion = entity['entityVersion'];
    const ownerUserId = entity['ownerUserId'];
    const data = entity['data'];

    if (typeof entityType !== 'string' || !allowedTypes.includes(entityType as SnapshotEntityType)) {
      this.reportSchemaValidationError();
      return null;
    }
    if (typeof entityUuid !== 'string') {
      this.reportSchemaValidationError();
      return null;
    }
    if (typeof entityVersion !== 'number' || !Number.isInteger(entityVersion)) {
      this.reportSchemaValidationError();
      return null;
    }
    if (typeof ownerUserId !== 'string') {
      this.reportSchemaValidationError();
      return null;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      this.reportSchemaValidationError();
      return null;
    }

    const dataRecord = data as Record<string, unknown>;
    const dataUuid = this.resolveUuid(dataRecord);
    if (dataUuid !== entityUuid) {
      this.reportSchemaValidationError();
      return null;
    }

    const isValid = entityType === 'record'
      ? this.isValidRecordEntityData(dataRecord)
      : entityType === 'thread'
        ? this.isValidThreadEntityData(dataRecord)
        : this.isValidFolderEntityData(dataRecord);

    if (!isValid) {
      this.reportSchemaValidationError();
      return null;
    }

    return {
      entityType: entityType as SnapshotEntityType,
      entityUuid,
      entityVersion,
      ownerUserId,
      data: dataRecord,
    };
  }

  private parseFolderData(data: Record<string, unknown>): Folder | null {
    if (!this.isValidFolderEntityData(data)) {
      this.reportSchemaValidationError();
      return null;
    }

    return {
      id: data['uuid'] as string,
      name: data['name'] as string,
      parentId: data['parentFolderUuid'] as string | null,
    };
  }

  private parseThreadData(data: Record<string, unknown>): Thread | null {
    if (!this.isValidThreadEntityData(data)) {
      this.reportSchemaValidationError();
      return null;
    }

    return {
      id: data['uuid'] as string,
      folderId: (data['folderUuid'] as string | null) ?? 'root',
      title: data['title'] as string,
    };
  }

  private parseRecordData(data: Record<string, unknown>): RecordEntry | null {
    if (!this.isValidRecordEntityData(data)) {
      this.reportSchemaValidationError();
      return null;
    }

    return {
      id: data['uuid'] as string,
      threadId: data['threadUuid'] as string,
      type: data['type'] as string,
      name: data['body'] as string,
      createdAt: data['createdAt'] as number,
    };
  }

  private isValidEventData(
    operation: EventOperation,
    entity: EventEntity,
    data: Record<string, unknown>,
  ): boolean {
    switch (entity) {
      case 'folder':
      case 'imageGroup':
        return this.isValidFolderEventData(operation, data);
      case 'thread':
        return this.isValidThreadEventData(operation, data);
      case 'record':
        return this.isValidRecordEventData(operation, data);
    }
  }

  private isValidFolderEventData(
    operation: EventOperation,
    data: Record<string, unknown>,
  ): boolean {
    switch (operation) {
      case 'create':
        return this.isValidFolderEntityData(data);
      case 'update':
        return this.hasAllowedKeys(data, ['uuid', 'name', 'parentFolderUuid'])
          && this.hasRequiredKeys(data, ['uuid'])
          && this.isUuid(data['uuid'])
          && this.isOptionalString(data['name'])
          && this.isOptionalNullableString(data['parentFolderUuid']);
      case 'rename':
        return this.hasExactKeys(data, ['uuid', 'name'])
          && this.isUuid(data['uuid'])
          && typeof data['name'] === 'string';
      case 'move':
        return this.hasExactKeys(data, ['uuid', 'parentFolderUuid'])
          && this.isUuid(data['uuid'])
          && this.isNullableString(data['parentFolderUuid']);
      case 'delete':
        return this.hasExactKeys(data, ['uuid']) && this.isUuid(data['uuid']);
      case 'softDelete':
      case 'restore':
        return false;
    }
  }

  private isValidThreadEventData(
    operation: EventOperation,
    data: Record<string, unknown>,
  ): boolean {
    switch (operation) {
      case 'create':
        return this.isValidThreadEntityData(data);
      case 'update':
        return this.hasAllowedKeys(data, ['uuid', 'folderUuid', 'title'])
          && this.hasRequiredKeys(data, ['uuid'])
          && this.isUuid(data['uuid'])
          && this.isOptionalNullableString(data['folderUuid'])
          && this.isOptionalString(data['title']);
      case 'rename':
        return this.hasExactKeys(data, ['uuid', 'title'])
          && this.isUuid(data['uuid'])
          && typeof data['title'] === 'string';
      case 'move':
        return this.hasExactKeys(data, ['uuid', 'folderUuid'])
          && this.isUuid(data['uuid'])
          && this.isNullableString(data['folderUuid']);
      case 'delete':
        return this.hasExactKeys(data, ['uuid']) && this.isUuid(data['uuid']);
      case 'softDelete':
      case 'restore':
        return false;
    }
  }

  private isValidRecordEventData(
    operation: EventOperation,
    data: Record<string, unknown>,
  ): boolean {
    switch (operation) {
      case 'create':
        return this.isValidRecordEntityData(data);
      case 'update':
        return this.hasAllowedKeys(data, [
          'uuid',
          'threadUuid',
          'type',
          'body',
          'createdAt',
          'editedAt',
          'orderIndex',
          'isStarred',
          'imageGroupId',
        ])
          && this.hasRequiredKeys(data, ['uuid'])
          && this.isUuid(data['uuid'])
          && this.isOptionalString(data['threadUuid'])
          && this.isOptionalString(data['type'])
          && this.isOptionalString(data['body'])
          && this.isOptionalNumber(data['createdAt'])
          && this.isOptionalNumber(data['editedAt'])
          && this.isOptionalNumber(data['orderIndex'])
          && this.isOptionalBoolean(data['isStarred'])
          && this.isOptionalNullableString(data['imageGroupId']);
      case 'rename':
        return this.hasExactKeys(data, ['uuid', 'body'])
          && this.isUuid(data['uuid'])
          && typeof data['body'] === 'string';
      case 'move':
        return this.hasExactKeys(data, ['uuid', 'threadUuid'])
          && this.isUuid(data['uuid'])
          && typeof data['threadUuid'] === 'string';
      case 'delete':
        return this.hasExactKeys(data, ['uuid']) && this.isUuid(data['uuid']);
      case 'softDelete':
      case 'restore':
        return false;
    }
  }

  private isValidFolderEntityData(data: Record<string, unknown>): data is FolderEntityData {
    return this.hasExactKeys(data, ['uuid', 'name', 'parentFolderUuid'])
      && this.isUuid(data['uuid'])
      && typeof data['name'] === 'string'
      && this.isNullableString(data['parentFolderUuid']);
  }

  private isValidThreadEntityData(data: Record<string, unknown>): data is ThreadEntityData {
    return this.hasExactKeys(data, ['uuid', 'folderUuid', 'title'])
      && this.isUuid(data['uuid'])
      && this.isNullableString(data['folderUuid'])
      && typeof data['title'] === 'string';
  }

  private isValidRecordEntityData(data: Record<string, unknown>): data is RecordEntityData {
    return this.hasExactKeys(data, [
      'uuid',
      'threadUuid',
      'type',
      'body',
      'createdAt',
      'editedAt',
      'orderIndex',
      'isStarred',
      'imageGroupId',
    ])
      && this.isUuid(data['uuid'])
      && typeof data['threadUuid'] === 'string'
      && typeof data['type'] === 'string'
      && typeof data['body'] === 'string'
      && typeof data['createdAt'] === 'number'
      && typeof data['editedAt'] === 'number'
      && typeof data['orderIndex'] === 'number'
      && typeof data['isStarred'] === 'boolean'
      && this.isNullableString(data['imageGroupId']);
  }

  private hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return this.hasAllowedKeys(obj, keys) && this.hasRequiredKeys(obj, keys);
  }

  private hasAllowedKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(obj).every((key) => keys.includes(key));
  }

  private hasRequiredKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => key in obj);
  }

  private isUuid(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private isNullableString(value: unknown): value is string | null {
    return typeof value === 'string' || value === null;
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
  }

  private isOptionalNullableString(value: unknown): boolean {
    return value === undefined || this.isNullableString(value);
  }

  private isOptionalNumber(value: unknown): boolean {
    return value === undefined || typeof value === 'number';
  }

  private isOptionalBoolean(value: unknown): boolean {
    return value === undefined || typeof value === 'boolean';
  }

  private reportSchemaValidationError(): void {
    console.error('SCHEMA_VALIDATION_ERROR entity field mismatch');
  }

  // ── Hierarchy builder ────────────────────────────────────

  private buildHierarchy(
    folders: Folder[],
    threads: Thread[],
    records: RecordEntry[],
  ): ExplorerNode[] {
    // Index threads by folderId
    const threadsByFolder = new Map<string, Thread[]>();
    for (const t of threads) {
      const key = t.folderId === 'root' ? '__root__' : t.folderId;
      const arr = threadsByFolder.get(key) ?? [];
      arr.push(t);
      threadsByFolder.set(key, arr);
    }

    // Index records by threadId
    const recordsByThread = new Map<string, RecordEntry[]>();
    for (const r of records) {
      const arr = recordsByThread.get(r.threadId) ?? [];
      arr.push(r);
      recordsByThread.set(r.threadId, arr);
    }

    // Index folders by parentId
    const foldersByParent = new Map<string, Folder[]>();
    for (const f of folders) {
      const key = f.parentId ?? '__root__';
      const arr = foldersByParent.get(key) ?? [];
      arr.push(f);
      foldersByParent.set(key, arr);
    }

    const buildThread = (thread: Thread): ExplorerNode => ({
      id: thread.id,
      name: thread.title,
      type: 'thread',
      children: (recordsByThread.get(thread.id) ?? []).map((r) => ({
        id: r.id,
        name: r.name || r.type,
        type: 'record' as const,
        children: [],
      })),
    });

    const buildFolder = (folder: Folder): ExplorerNode => ({
      id: folder.id,
      name: folder.name,
      type: 'folder',
      children: [
        ...(foldersByParent.get(folder.id) ?? []).map(buildFolder),
        ...(threadsByFolder.get(folder.id) ?? []).map(buildThread),
      ],
    });

    return [
      ...(foldersByParent.get('__root__') ?? []).map(buildFolder),
      ...(threadsByFolder.get('__root__') ?? []).map(buildThread),
    ];
  }
}
