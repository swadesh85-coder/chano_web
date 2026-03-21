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
  ProjectionSnapshotState,
  ProjectionUpdate,
  FolderProjectionEntity,
  ThreadProjectionEntity,
  RecordProjectionEntity,
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
  readonly mediaId?: string;
  readonly mimeType?: string;
  readonly title?: string;
  readonly size?: number | null;
};

const INTERNAL_ROOT_FOLDER_SENTINEL = 'root';

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
  private lastInboundSessionId: string | null = null;
  private snapshotSessionId: string | null = null;

  private readonly _folders = signal<Folder[]>([]);
  private readonly _threads = signal<Thread[]>([]);
  private readonly _records = signal<RecordEntry[]>([]);
  private readonly _phase = signal<SnapshotPhase>('idle');
  private readonly _baseEventVersion = signal<number | null>(null);
  private readonly _lastAppliedEventVersion = signal<number | null>(null);
  private readonly _lastProjectionUpdate = signal<ProjectionUpdate | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly folders = this._folders.asReadonly();
  readonly threads = this._threads.asReadonly();
  readonly records = this._records.asReadonly();
  readonly baseEventVersion = this._baseEventVersion.asReadonly();
  readonly lastAppliedEventVersion = this._lastAppliedEventVersion.asReadonly();
  readonly lastProjectionUpdate = this._lastProjectionUpdate.asReadonly();

  /** @deprecated DO NOT USE — replaced by getProjectionState() (projection snapshot API) */
  readonly explorerTree = computed<ExplorerNode[]>(() =>
    this.buildHierarchy(this._folders(), this._threads(), this._records()),
  );

  constructor() {
    this.snapshotLoader.onEvent((event) => this.handleSnapshotLoaderEvent(event));
    this.relay.onProjectionMessage((msg) => this.handleEnvelope(msg));
  }

  getEntityVersion(entityType: EventEntity, entityId: string): number | null {
    return this.projectionEngine.getEntityVersion(entityType, entityId);
  }

  getProjectionState(): ProjectionSnapshotState {
    const folders = new Map<string, FolderProjectionEntity>();
    for (const folder of this._folders()) {
      const entity = this.deepFreeze(this.toProjectionFolderEntity(folder));
      folders.set(entity.entityUuid, entity);
    }

    const threads = new Map<string, ThreadProjectionEntity>();
    for (const thread of this._threads()) {
      const entity = this.deepFreeze(this.toProjectionThreadEntity(thread));
      threads.set(entity.entityUuid, entity);
    }

    const records = new Map<string, RecordProjectionEntity>();
    for (const record of this._records()) {
      const entity = this.deepFreeze(this.toProjectionRecordEntity(record));
      records.set(entity.entityUuid, entity);
    }

    return this.deepFreeze({
      folders,
      threads,
      records,
      imageGroups: this.buildImageGroups(records),
    });
  }

  hasEntityId(entityId: string): boolean {
    return this.projectionEngine.hasEntityId(entityId);
  }

  private handleEnvelope(msg: TransportEnvelope): void {
    this.lastInboundSessionId = msg.sessionId;

    let handled = false;
    if (msg.type.startsWith('snapshot_')) {
      handled = true;
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

      console.log(
        `HANDLE_MESSAGE type=${msg.type} sessionId=${this.formatSessionId(msg.sessionId)} handled=true`,
      );
      return;
    }

    if (msg.type === 'event_stream') {
      handled = true;
      this.onEventStream(msg);
    }

    console.log(
      `HANDLE_MESSAGE type=${msg.type} sessionId=${this.formatSessionId(msg.sessionId)} handled=${String(handled)}`,
    );

    if (!handled) {
      console.log(
        `UNHANDLED_MESSAGE type=${msg.type} sessionId=${this.formatSessionId(msg.sessionId)}`,
      );
    }
  }

  // ── Snapshot lifecycle ───────────────────────────────────

  private onSnapshotStart(msg: TransportEnvelope): void {
    this.snapshotSessionId = msg.sessionId;
    if (this.isByteSnapshotStartPayload(msg.payload)) {
      this.projectionEngine.onSnapshotStart(this.readSnapshotId(msg.payload));
      this.snapshotLoader.handleSnapshotStart(msg);
      this._phase.set('receiving');
      return;
    }

    this.projectionEngine.reset();
    this._folders.set([]);
    this._threads.set([]);
    this._records.set([]);
    this._baseEventVersion.set(null);
    this._lastAppliedEventVersion.set(null);
    this._lastProjectionUpdate.set(null);

    this._phase.set('receiving');
  }

  private onSnapshotChunk(msg: TransportEnvelope): void {
    this.snapshotSessionId = msg.sessionId;
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
    this.snapshotSessionId = msg.sessionId;
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
        this.projectionEngine.abortSnapshot();
        this._phase.set('idle');
        return;
      case 'SNAPSHOT_LOADED':
        console.log(
          `PROJECTION_BUILD_TRIGGERED type=snapshot_complete sessionId=${this.formatSessionId(this.snapshotSessionId)}`,
        );
        this.applyDecodedSnapshot(event.snapshotJson, event.baseEventVersion);
        return;
    }
  }

  private applyDecodedSnapshot(snapshotJson: string, baseEventVersion: number): void {
    let snapshot: unknown;

    try {
      snapshot = JSON.parse(snapshotJson);
    } catch {
      this.projectionEngine.abortSnapshot();
      this._phase.set('idle');
      this.reportSchemaValidationError();
      return;
    }

    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      this.projectionEngine.abortSnapshot();
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
      this.projectionEngine.abortSnapshot();
      this._phase.set('idle');
      return;
    }

    const result = this.projectionEngine.onSnapshotComplete(snapshotJson, baseEventVersion);

    this.syncProjectionState(result.state);
    this._lastProjectionUpdate.set({
      reason: 'snapshot_loaded',
      entityType: null,
      eventVersion: result.lastAppliedEventVersion,
    });
    console.log(
      `PROJECTION_APPLY entityCount=${folders.length + threads.length + records.length} type=snapshot_apply sessionId=${this.formatSessionId(this.snapshotSessionId)}`,
    );
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

    const result = this.projectionEngine.onEvent(validationResult.eventEnvelope);

    switch (result.status) {
      case 'EVENT_APPLIED':
        this.syncProjectionState(result.state);
        this._lastProjectionUpdate.set({
          reason: 'event_applied',
          entityType: validationResult.eventEnvelope.entityType,
          eventVersion: validationResult.eventEnvelope.eventVersion,
        });
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
      case 'EVENT_IGNORED_DUPLICATE':
      case 'EVENT_BUFFERED':
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
      case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
      case 'SNAPSHOT_RESYNC_REQUIRED':
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
    }
  }

  private readSnapshotId(payload: Record<string, unknown>): string | null {
    return typeof payload['snapshotId'] === 'string' ? payload['snapshotId'] : null;
  }

  private formatSessionId(sessionId: string | null): string {
    return sessionId ?? 'null';
  }

  private emitValidationResyncRequired(reason: EventValidationFailureReason): void {
    console.error(`SNAPSHOT_RESYNC_REQUIRED reason=${reason}`);
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

  private toProjectionFolderEntity(folder: Folder): FolderProjectionEntity {
    return {
      entityType: 'folder',
      entityUuid: folder.id,
      entityVersion: this.projectionEngine.getEntityVersion('folder', folder.id) ?? 0,
      data: {
        uuid: folder.id,
        name: folder.name,
        parentFolderUuid: folder.parentId,
      },
    };
  }

  private toProjectionThreadEntity(thread: Thread): ThreadProjectionEntity {
    return {
      entityType: 'thread',
      entityUuid: thread.id,
      entityVersion: this.projectionEngine.getEntityVersion('thread', thread.id) ?? 0,
      data: {
        uuid: thread.id,
        folderUuid: this.mapInternalRootFolderIdToSnapshot(thread.folderId),
        title: thread.title,
      },
    };
  }

  private toProjectionRecordEntity(record: RecordEntry): RecordProjectionEntity {
    const data: RecordProjectionEntity['data'] = {
      uuid: record.id,
      threadUuid: record.threadId,
      type: record.type,
      body: record.name,
      createdAt: record.createdAt,
      editedAt: record.editedAt,
      orderIndex: record.orderIndex ?? 0,
      isStarred: record.isStarred,
      imageGroupId: record.imageGroupId,
      lastEventVersion: this.projectionEngine.getRecordLastEventVersion(record.id),
      ...(typeof record.mediaId === 'string' ? { mediaId: record.mediaId } : {}),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
      ...(typeof record.size === 'number' || record.size === null ? { size: record.size } : {}),
    };

    return {
      entityType: 'record',
      entityUuid: record.id,
      entityVersion: this.projectionEngine.getEntityVersion('record', record.id) ?? 0,
      data,
    };
  }

  private buildImageGroups(
    records: ReadonlyMap<string, RecordProjectionEntity>,
  ): ReadonlyMap<string, readonly RecordProjectionEntity[]> {
    const groupedRecords = new Map<string, RecordProjectionEntity[]>();

    for (const record of records.values()) {
      const imageGroupId = record.data.imageGroupId;
      if (imageGroupId === null || record.data.type !== 'image') {
        continue;
      }

      const group = groupedRecords.get(imageGroupId) ?? [];
      group.push(record);
      groupedRecords.set(imageGroupId, group);
    }

    const imageGroups = new Map<string, readonly RecordProjectionEntity[]>();
    for (const [imageGroupId, group] of [...groupedRecords.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const orderedRecords = this.deepFreeze([...group].sort((left, right) => {
        if (left.data.orderIndex !== right.data.orderIndex) {
          return left.data.orderIndex - right.data.orderIndex;
        }

        const leftEventVersion = left.data.lastEventVersion ?? Number.MAX_SAFE_INTEGER;
        const rightEventVersion = right.data.lastEventVersion ?? Number.MAX_SAFE_INTEGER;
        if (leftEventVersion !== rightEventVersion) {
          return leftEventVersion - rightEventVersion;
        }

        return left.entityUuid.localeCompare(right.entityUuid);
      }));

      imageGroups.set(imageGroupId, orderedRecords);
    }

    return imageGroups;
  }

  private mapInternalRootFolderIdToSnapshot(folderId: string): string | null {
    return folderId === INTERNAL_ROOT_FOLDER_SENTINEL ? null : folderId;
  }

  private deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Object.isFrozen(value)) {
      return value;
    }

    const entries = Array.isArray(value) ? value : Object.values(value);
    for (const entry of entries) {
      this.deepFreeze(entry);
    }

    return Object.freeze(value);
  }

  private resolveUuid(o: Record<string, unknown>): string | undefined {
    const v = o['uuid'];
    return typeof v === 'string' ? v : undefined;
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
      editedAt: data['editedAt'] as number,
      orderIndex: data['orderIndex'] as number,
      isStarred: data['isStarred'] as boolean,
      imageGroupId: data['imageGroupId'] as string | null,
      mediaId: typeof data['mediaId'] === 'string' ? data['mediaId'] : undefined,
      mimeType: typeof data['mimeType'] === 'string' ? data['mimeType'] : undefined,
      title: typeof data['title'] === 'string' ? data['title'] : undefined,
      size: this.resolveOptionalNullableNumber(data, 'size'),
    };
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
      'mediaId',
      'mimeType',
      'title',
      'size',
    ])
      && this.hasRequiredKeys(data, [
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
      && this.isNullableString(data['imageGroupId'])
      && this.isOptionalString(data['mediaId'])
      && this.isOptionalString(data['mimeType'])
      && this.isOptionalString(data['title'])
      && this.isOptionalNullableNumber(data['size']);
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

  private isNullableNumber(value: unknown): value is number | null {
    return typeof value === 'number' || value === null;
  }

  private isOptionalNullableNumber(value: unknown): value is number | null | undefined {
    return value === undefined || this.isNullableNumber(value);
  }

  private resolveOptionalNullableNumber(
    payload: Record<string, unknown>,
    key: string,
  ): number | null | undefined {
    if (!(key in payload)) {
      return undefined;
    }

    const value = payload[key];
    if (typeof value === 'number' || value === null) {
      return value;
    }

    return undefined;
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
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
