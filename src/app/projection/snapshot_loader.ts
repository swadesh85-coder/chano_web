import { Injectable } from '@angular/core';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import type { ProjectionSnapshotDocument, RecordSnapshotEntity, SnapshotEntity } from './projection.models';

type SnapshotLoaderEventHandler = (event: SnapshotLoaderEvent) => void;

type SnapshotAssembly = {
  readonly snapshotId: string | null;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly snapshotVersion: number;
  readonly protocolVersion: number | null;
  readonly schemaVersion: number | null;
  readonly baseEventVersion: number;
  readonly entityCount: number | null;
  readonly checksum: string | null;
  readonly startedAt: number;
  readonly chunkBytes: Uint8Array[];
  readonly nextChunkIndex: number;
  readonly receivedBytes: number;
};

type SnapshotStartPayload = {
  readonly snapshotId: string | null;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly snapshotVersion: number;
  readonly protocolVersion: number | null;
  readonly schemaVersion: number | null;
  readonly baseEventVersion: number;
  readonly entityCount: number | null;
  readonly checksum: string | null;
};

type MinimalSnapshotStartPayload = Record<string, unknown> & {
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly snapshotVersion: number;
};

type SnapshotChunkPayload = {
  readonly index: number;
  readonly data: string;
  readonly checksum?: string;
};

type SnapshotCompletePayload = {
  readonly totalChunks: number;
};

type SnapshotEntityType = SnapshotEntity['entityType'];

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

export type SnapshotLoaderEvent =
  | {
      readonly type: 'SNAPSHOT_LOADED';
      readonly parsedSnapshot: ProjectionSnapshotDocument;
      readonly baseEventVersion: number;
      readonly entityCount: number;
    }
  | {
      readonly type: 'SNAPSHOT_ERROR';
      readonly reason: string;
    };

export type SnapshotTestProtocol = {
  readonly start: TransportEnvelope;
  readonly chunks: readonly TransportEnvelope[];
  readonly complete: TransportEnvelope;
};

export type SnapshotReconstructionResult = {
  readonly snapshotJson: string;
  readonly parsedSnapshot: ProjectionSnapshotDocument;
  readonly baseEventVersion: number;
  readonly reconstructedChecksum: string;
  readonly mobileChecksum: string | null;
  readonly byteLength: number;
};

@Injectable({ providedIn: 'root' })
export class SnapshotLoader {
  private readonly eventHandlers = new Set<SnapshotLoaderEventHandler>();
  private assembly: SnapshotAssembly | null = null;
  private lastReconstruction: SnapshotReconstructionResult | null = null;

  onEvent(handler: SnapshotLoaderEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  handleSnapshotStart(envelope: TransportEnvelope): void {
    const payload = this.parseSnapshotStartPayload(envelope.payload);

    if (payload === null) {
      this.fail('invalid snapshot_start payload');
      return;
    }

    this.startSnapshotAssembly(payload);

    console.log(
      `SNAPSHOT_RECEIVE_START snapshotId=${payload.snapshotId ?? 'unknown'} totalChunks=${payload.totalChunks} type=${envelope.type} sessionId=${this.formatSessionId(envelope.sessionId)}`,
    );
  }

  handleSnapshotChunk(envelope: TransportEnvelope): void {
    if (this.assembly === null) {
      this.fail('snapshot_chunk received without active snapshot');
      return;
    }

    const payload = this.parseSnapshotChunkPayload(envelope.payload);
    if (payload === null) {
      this.fail('invalid snapshot_chunk payload');
      return;
    }

    if (payload.index !== this.assembly.nextChunkIndex) {
      this.fail(
        `invalid chunk order expected=${this.assembly.nextChunkIndex} actual=${payload.index}`,
      );
      return;
    }

    const chunkBytes = this.decodeBase64(payload.data);
    if (chunkBytes === null) {
      this.fail(`invalid base64 chunk index=${payload.index}`);
      return;
    }

    const receivedBytes = this.assembly.receivedBytes + chunkBytes.byteLength;
    if (receivedBytes > this.assembly.totalBytes) {
      this.fail(`snapshot byte overflow received=${receivedBytes}`);
      return;
    }

    this.assembly = {
      ...this.assembly,
      chunkBytes: [...this.assembly.chunkBytes, chunkBytes],
      nextChunkIndex: this.assembly.nextChunkIndex + 1,
      receivedBytes,
    };

    console.log(
      `SNAPSHOT_RECEIVE_CHUNK index=${payload.index} type=${envelope.type} sessionId=${this.formatSessionId(envelope.sessionId)}`,
    );
  }

  async handleSnapshotComplete(envelope: TransportEnvelope): Promise<void> {
    if (this.assembly === null) {
      this.fail('snapshot_complete received without active snapshot');
      return;
    }

    const payload = this.parseSnapshotCompletePayload(envelope.payload);
    if (payload === null) {
      this.fail('invalid snapshot_complete payload');
      return;
    }

    if (payload.totalChunks !== this.assembly.totalChunks) {
      this.fail(
        `snapshot_complete chunk mismatch expected=${this.assembly.totalChunks} actual=${payload.totalChunks}`,
      );
      return;
    }

    if (this.assembly.chunkBytes.length !== this.assembly.totalChunks) {
      this.fail(
        `missing chunks expected=${this.assembly.totalChunks} actual=${this.assembly.chunkBytes.length}`,
      );
      return;
    }

    console.log(
      `SNAPSHOT_RECEIVE_COMPLETE totalChunks=${payload.totalChunks} type=${envelope.type} sessionId=${this.formatSessionId(envelope.sessionId)}`,
    );

    const reconstruction = await this.reconstructAssembly(this.assembly);
    if (reconstruction === null) {
      return;
    }

    this.lastReconstruction = reconstruction;
    this.assembly = null;
    this.emitEvent({
      type: 'SNAPSHOT_LOADED',
      parsedSnapshot: reconstruction.parsedSnapshot,
      baseEventVersion: reconstruction.baseEventVersion,
      entityCount: this.countSnapshotEntities(reconstruction.parsedSnapshot),
    });
  }

  async loadSnapshotForTest(snapshotProtocol: SnapshotTestProtocol): Promise<SnapshotReconstructionResult> {
    let snapshotLoaded = false;
    let snapshotError: string | null = null;
    const unsubscribe = this.onEvent((event) => {
      if (event.type === 'SNAPSHOT_LOADED') {
        snapshotLoaded = true;
        return;
      }

      snapshotError = event.reason;
    });

    try {
      this.handleSnapshotStart(snapshotProtocol.start);
      for (const chunk of snapshotProtocol.chunks) {
        this.handleSnapshotChunk(chunk);
      }
      await this.handleSnapshotComplete(snapshotProtocol.complete);

      if (snapshotError !== null) {
        throw new Error(snapshotError);
      }

      if (!snapshotLoaded || this.lastReconstruction === null) {
        throw new Error('SNAPSHOT_RECONSTRUCTION_UNAVAILABLE');
      }

      return this.lastReconstruction;
    } finally {
      unsubscribe();
    }
  }

  private startSnapshotAssembly(payload: SnapshotStartPayload): void {
    this.assembly = {
      snapshotId: payload.snapshotId,
      totalChunks: payload.totalChunks,
      totalBytes: payload.totalBytes,
      snapshotVersion: payload.snapshotVersion,
      protocolVersion: payload.protocolVersion,
      schemaVersion: payload.schemaVersion,
      baseEventVersion: payload.baseEventVersion,
      entityCount: payload.entityCount,
      checksum: payload.checksum,
      startedAt: Date.now(),
      chunkBytes: [],
      nextChunkIndex: 0,
      receivedBytes: 0,
    };
  }

  private parseSnapshotStartPayload(payload: Record<string, unknown>): SnapshotStartPayload | null {
    if (!this.isValidSnapshotStart(payload)) {
      return null;
    }

    const snapshotStartPayload = payload;
    const totalChunks = snapshotStartPayload['totalChunks'];
    const totalBytes = snapshotStartPayload['totalBytes'];
    const snapshotVersion = snapshotStartPayload['snapshotVersion'];

    return {
      totalChunks,
      totalBytes,
      snapshotVersion,
      snapshotId: this.readOptionalString(snapshotStartPayload['snapshotId']),
      protocolVersion: this.readOptionalNumber(snapshotStartPayload['protocolVersion']),
      schemaVersion: this.readOptionalNumber(snapshotStartPayload['schemaVersion']),
      baseEventVersion: this.readOptionalNumber(snapshotStartPayload['baseEventVersion']) ?? snapshotVersion,
      entityCount: this.readOptionalNumber(snapshotStartPayload['entityCount']),
      checksum: this.readOptionalString(snapshotStartPayload['checksum'])?.toLowerCase() ?? null,
    };
  }

  private parseSnapshotChunkPayload(payload: Record<string, unknown>): SnapshotChunkPayload | null {
    if (!this.hasAllowedKeys(payload, ['index', 'data', 'checksum']) || !('index' in payload) || !('data' in payload)) {
      return null;
    }

    const index = payload['index'];
    const data = payload['data'];
    const checksum = payload['checksum'];

    if (!this.isNonNegativeInteger(index) || typeof data !== 'string') {
      return null;
    }

    if (checksum !== undefined && typeof checksum !== 'string') {
      return null;
    }

    return { index, data, checksum };
  }

  private parseSnapshotCompletePayload(payload: Record<string, unknown>): SnapshotCompletePayload | null {
    if (!this.hasExactKeys(payload, ['totalChunks'])) {
      return null;
    }

    const totalChunks = payload['totalChunks'];
    if (!this.isNonNegativeInteger(totalChunks)) {
      return null;
    }

    return { totalChunks };
  }

  private decodeBase64(value: string): Uint8Array | null {
    try {
      if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
      }

      const bufferCtor = (globalThis as typeof globalThis & {
        Buffer?: { from(input: string, encoding: string): Uint8Array };
      }).Buffer;

      return bufferCtor ? new Uint8Array(bufferCtor.from(value, 'base64')) : null;
    } catch {
      return null;
    }
  }

  private decodeUtf8(bytes: Uint8Array): string | null {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  private async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', this.toArrayBuffer(bytes));
    const hex = new Uint8Array(digest)
      .reduce((result, value) => `${result}${value.toString(16).padStart(2, '0')}`, '');

    return hex.toLowerCase();
  }

  private concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return combined;
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  private async reconstructAssembly(assembly: SnapshotAssembly): Promise<SnapshotReconstructionResult | null> {
    const snapshotBytes = this.concatBytes(assembly.chunkBytes);
    if (snapshotBytes.byteLength !== assembly.totalBytes) {
      this.fail(
        `snapshot byte mismatch expected=${assembly.totalBytes} actual=${snapshotBytes.byteLength}`,
      );
      return null;
    }

    const snapshotJson = this.decodeUtf8(snapshotBytes);
    if (snapshotJson === null) {
      this.fail('invalid utf8 snapshot payload');
      return null;
    }

    let parsedSnapshot: ProjectionSnapshotDocument;
    try {
      parsedSnapshot = JSON.parse(snapshotJson) as ProjectionSnapshotDocument;
    } catch {
      this.fail('invalid snapshot json');
      return null;
    }

    if (!this.isValidSnapshotDocument(parsedSnapshot)) {
      this.reportSchemaValidationError();
      this.fail('invalid snapshot schema');
      return null;
    }

    const reconstructedChecksum = await this.sha256Hex(snapshotBytes);
    if (assembly.checksum !== null && reconstructedChecksum !== assembly.checksum) {
      this.fail('checksum mismatch');
      return null;
    }

    if (assembly.checksum !== null) {
      console.log('SNAPSHOT_CHECKSUM_VALID');
    }

    console.log(`SNAPSHOT_RECONSTRUCTED checksum=${reconstructedChecksum}`);

    return {
      snapshotJson,
      parsedSnapshot,
      baseEventVersion: assembly.baseEventVersion,
      reconstructedChecksum,
      mobileChecksum: assembly.checksum,
      byteLength: snapshotBytes.byteLength,
    };
  }

  private fail(reason: string): void {
    this.assembly = null;
    this.lastReconstruction = null;
    console.error(`SNAPSHOT_ERROR ${reason}`);
    this.emitEvent({ type: 'SNAPSHOT_ERROR', reason });
  }

  private countSnapshotEntities(snapshot: ProjectionSnapshotDocument): number {
    return (snapshot.folders?.length ?? 0)
      + (snapshot.threads?.length ?? 0)
      + (snapshot.records?.length ?? 0);
  }

  private isValidSnapshotDocument(snapshot: unknown): snapshot is ProjectionSnapshotDocument {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return false;
    }

    const snapshotRecord = snapshot as Record<string, unknown>;
    return this.hasAllowedKeys(snapshotRecord, ['folders', 'threads', 'records'])
      && this.isValidSnapshotEntityCollection(snapshotRecord['folders'], 'folder')
      && this.isValidSnapshotEntityCollection(snapshotRecord['threads'], 'thread')
      && this.isValidSnapshotEntityCollection(snapshotRecord['records'], 'record');
  }

  private isValidSnapshotEntityCollection(raw: unknown, expectedType: SnapshotEntityType): boolean {
    if (raw === undefined) {
      return true;
    }

    return Array.isArray(raw) && raw.every((entity) => this.isValidSnapshotEntity(entity, expectedType));
  }

  private isValidSnapshotEntity(raw: unknown, expectedType: SnapshotEntityType): raw is SnapshotEntity {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return false;
    }

    const entity = raw as Record<string, unknown>;
    if (!this.hasExactKeys(entity, ['entityType', 'entityUuid', 'entityVersion', 'ownerUserId', 'lastEventVersion', 'data'])) {
      return false;
    }
    if (!this.isNonNegativeInteger(entity['lastEventVersion'])) {
      return false;
    }

    const entityType = entity['entityType'];
    const entityUuid = entity['entityUuid'];
    const entityVersion = entity['entityVersion'];
    const ownerUserId = entity['ownerUserId'];
    const data = entity['data'];

    if (entityType !== expectedType) {
      return false;
    }
    if (!this.isUuid(entityUuid)) {
      return false;
    }
    if (!this.isNonNegativeInteger(entityVersion)) {
      return false;
    }
    if (typeof ownerUserId !== 'string') {
      return false;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return false;
    }

    const dataRecord = data as Record<string, unknown>;
    if (dataRecord['uuid'] !== entityUuid) {
      return false;
    }

    switch (expectedType) {
      case 'folder':
        return this.isValidFolderEntityData(dataRecord);
      case 'thread':
        return this.isValidThreadEntityData(dataRecord);
      case 'record':
        return this.isValidRecordSnapshotEntity(entity, dataRecord);
    }
  }

  private isValidRecordSnapshotEntity(
    entity: Record<string, unknown>,
    data: Record<string, unknown>,
  ): boolean {
    return this.isNonNegativeInteger(entity['lastEventVersion'])
      && this.isValidRecordEntityData(data);
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
      && this.isUuid(data['threadUuid'])
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

  private isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
  }

  private reportSchemaValidationError(): void {
    console.error('SCHEMA_VALIDATION_ERROR entity field mismatch');
  }

  private emitEvent(event: SnapshotLoaderEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private isValidSnapshotStart(payload: unknown): payload is MinimalSnapshotStartPayload {
    if (payload === null || typeof payload !== 'object') {
      return false;
    }

    const snapshotStartPayload = payload as Record<string, unknown>;

    return (
      typeof snapshotStartPayload['totalChunks'] === 'number'
      && typeof snapshotStartPayload['totalBytes'] === 'number'
      && typeof snapshotStartPayload['snapshotVersion'] === 'number'
    );
  }

  private readOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  private readOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private hasAllowedKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(obj).every((key) => keys.includes(key));
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }

  private formatSessionId(sessionId: string | null): string {
    return sessionId ?? 'null';
  }
}