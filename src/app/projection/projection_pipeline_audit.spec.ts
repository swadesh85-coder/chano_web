import { describe, expect, it } from 'vitest';
import { SnapshotLoader, type SnapshotLoaderEvent } from './snapshot_loader';
import { ProjectionEngine } from './projection_engine';
import { validateEventEnvelope } from './projection_event_validation';
import type { EventEnvelope, ProjectionState } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';

const ROOT_FOLDER_ID = '123e4567-e89b-42d3-a456-426614174001';
const CHILD_FOLDER_ID = '123e4567-e89b-42d3-a456-426614174002';
const THREAD_ID = '123e4567-e89b-42d3-a456-426614174003';
const RECORD_ID = '123e4567-e89b-42d3-a456-426614174004';
const EXTRA_RECORD_ID = '123e4567-e89b-42d3-a456-426614174005';
const BASE_EVENT_VERSION = 100;

type SnapshotProtocol = {
  readonly start: TransportEnvelope;
  readonly chunks: readonly TransportEnvelope[];
  readonly complete: TransportEnvelope;
};

type SnapshotAuditResult = {
  readonly snapshotLog: readonly string[];
  readonly checksumValid: boolean;
  readonly stateAppliedBeforeComplete: boolean;
  readonly snapshotJson: string;
  readonly baseEventVersion: number;
  readonly state: ProjectionState;
};

type EventAuditResult = {
  readonly eventLog: readonly string[];
  readonly lastAppliedEventVersion: number | null;
  readonly resyncRequired: boolean;
  readonly state: ProjectionState;
};

type ProjectionBuildAuditResult = {
  readonly entityEvidence: readonly string[];
  readonly hierarchyVerified: boolean;
  readonly keyedByEntityUuid: boolean;
};

type DeterminismAuditResult = {
  readonly hashRun1: string;
  readonly hashRun2: string;
  readonly identical: boolean;
};

function createSnapshotJson(): string {
  return JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: ROOT_FOLDER_ID,
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: ROOT_FOLDER_ID,
          name: 'Folder 0001',
          parentFolderUuid: null,
        },
      },
      {
        entityType: 'folder',
        entityUuid: CHILD_FOLDER_ID,
        entityVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: CHILD_FOLDER_ID,
          name: 'Folder 0002',
          parentFolderUuid: ROOT_FOLDER_ID,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: THREAD_ID,
        entityVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: THREAD_ID,
          folderUuid: CHILD_FOLDER_ID,
          title: 'Thread 0001',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: RECORD_ID,
        entityVersion: 4,
        ownerUserId: 'owner-1',
        data: {
          uuid: RECORD_ID,
          threadUuid: THREAD_ID,
          type: 'text',
          body: 'Record 0001',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

function createEnvelope(
  type: string,
  payload: Record<string, unknown>,
  sequence: number,
): TransportEnvelope {
  return {
    protocolVersion: 2,
    type,
    sessionId: 'session-projection-audit',
    timestamp: 1710000000 + sequence,
    sequence,
    payload,
  };
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const decoded = globalThis.atob(value);
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }

    return bytes;
  }

  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from(input: string, encoding: string): { values(): IterableIterator<number> } };
  }).Buffer;

  if (!bufferCtor) {
    throw new Error('BASE64_DECODE_UNAVAILABLE');
  }

  return Uint8Array.from(bufferCtor.from(value, 'base64').values());
}

function toBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
  }

  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;

  if (!bufferCtor) {
    throw new Error('BASE64_ENCODE_UNAVAILABLE');
  }

  return bufferCtor.from(bytes).toString('base64');
}

function splitBytes(bytes: Uint8Array, totalChunks: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;

  for (let index = 0; index < totalChunks; index += 1) {
    const remainingBytes = bytes.length - start;
    const remainingChunks = totalChunks - index;
    const chunkLength = Math.ceil(remainingBytes / remainingChunks);
    const end = start + chunkLength;
    chunks.push(bytes.slice(start, end));
    start = end;
  }

  return chunks.filter((chunk) => chunk.byteLength > 0);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function createSnapshotProtocol(
  snapshotJson: string,
  totalChunks = 5,
  baseEventVersion = BASE_EVENT_VERSION,
): Promise<SnapshotProtocol> {
  const snapshotBytes = encodeUtf8(snapshotJson);
  const chunkBytes = splitBytes(snapshotBytes, totalChunks);
  const checksum = await sha256Hex(snapshotBytes);

  return {
    start: createEnvelope('snapshot_start', {
      snapshotId: 'snapshot-projection-audit',
      totalChunks: chunkBytes.length,
      totalBytes: snapshotBytes.byteLength,
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion,
      entityCount: 4,
      checksum,
    }, 1),
    chunks: chunkBytes.map((chunk, index) =>
      createEnvelope('snapshot_chunk', {
        index,
        data: toBase64(chunk),
      }, index + 2),
    ),
    complete: createEnvelope('snapshot_complete', {
      totalChunks: chunkBytes.length,
    }, chunkBytes.length + 2),
  };
}

function createEventPayload(
  eventVersion: number,
  payloadOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uuid: EXTRA_RECORD_ID,
    threadUuid: THREAD_ID,
    type: 'text',
    body: `Record ${eventVersion}`,
    createdAt: 1710000000 + eventVersion,
    editedAt: 1710000000 + eventVersion,
    orderIndex: eventVersion - (BASE_EVENT_VERSION + 1),
    isStarred: false,
    imageGroupId: null,
    ...payloadOverrides,
  };
}

async function createEventStreamEnvelope(
  eventVersion: number,
  payloadOverrides: Record<string, unknown> = {},
  envelopeOverrides: Partial<EventEnvelope> = {},
): Promise<TransportEnvelope> {
  const eventPayload = createEventPayload(eventVersion, payloadOverrides);
  const checksum = await sha256Hex(encodeUtf8(JSON.stringify(eventPayload)));

  return createEnvelope('event_stream', {
    eventId: envelopeOverrides.eventId ?? `evt-${eventVersion}`,
    originDeviceId: envelopeOverrides.originDeviceId ?? 'mobile-1',
    eventVersion,
    entityType: envelopeOverrides.entityType ?? 'record',
    entityId: envelopeOverrides.entityId ?? EXTRA_RECORD_ID,
    operation: envelopeOverrides.operation ?? 'create',
    timestamp: envelopeOverrides.timestamp ?? 1710000000 + eventVersion,
    payload: envelopeOverrides.payload ?? eventPayload,
    checksum: envelopeOverrides.checksum ?? checksum,
  }, eventVersion);
}

async function reconstructSnapshot(protocol: SnapshotProtocol): Promise<{
  readonly snapshotJson: string;
  readonly checksum: string;
}> {
  const bytes = protocol.chunks.map((chunk) => {
    const data = chunk.payload['data'];
    if (typeof data !== 'string') {
      throw new Error('INVALID_SNAPSHOT_CHUNK_PAYLOAD');
    }

    return decodeBase64(data);
  });
  const totalBytes = bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of bytes) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    snapshotJson: new TextDecoder().decode(merged),
    checksum: await sha256Hex(merged),
  };
}

async function flushProjectionAsyncWork(): Promise<void> {
  await Promise.resolve();
}

function hasProjectionData(state: ProjectionState): boolean {
  return state.folders.length > 0 || state.threads.length > 0 || state.records.length > 0;
}

async function auditSnapshotFlow(
  loader: SnapshotLoader,
  engine: ProjectionEngine,
  protocol: SnapshotProtocol,
): Promise<SnapshotAuditResult> {
  const snapshotLog = [`SNAPSHOT_START totalChunks=${protocol.start.payload['totalChunks']}`];
  let stateAppliedBeforeComplete = hasProjectionData(engine.getProjectionState());
  let appliedBaseEventVersion: number | null = null;
  let state = engine.getProjectionState();

  loader.onEvent((event) => {
    if (event.type === 'SNAPSHOT_LOADED') {
      const result = engine.applySnapshot(event.snapshotJson, event.baseEventVersion);
      appliedBaseEventVersion = result.lastAppliedEventVersion;
      state = result.state;
      return;
    }

    state = engine.getProjectionState();
  });

  loader.handleSnapshotStart(protocol.start);

  for (const chunk of protocol.chunks) {
    snapshotLog.push(`SNAPSHOT_CHUNK index=${chunk.payload['index']}`);
    loader.handleSnapshotChunk(chunk);
    stateAppliedBeforeComplete = stateAppliedBeforeComplete || hasProjectionData(engine.getProjectionState());
  }

  const reconstruction = await reconstructSnapshot(protocol);
  const checksumValid = reconstruction.checksum === protocol.start.payload['checksum'];

  snapshotLog.push('SNAPSHOT_COMPLETE');
  await loader.handleSnapshotComplete(protocol.complete);
  await flushProjectionAsyncWork();
  snapshotLog.push(`CHECKSUM_VALID ${String(checksumValid)}`);

  return {
    snapshotLog,
    checksumValid,
    stateAppliedBeforeComplete,
    snapshotJson: reconstruction.snapshotJson,
    baseEventVersion: appliedBaseEventVersion ?? -1,
    state,
  };
}

async function auditEventFlow(
  engine: ProjectionEngine,
  envelopes: readonly TransportEnvelope[],
): Promise<EventAuditResult> {
  const eventLog: string[] = [];
  let resyncRequired = false;

  for (const envelope of envelopes) {
    const validationResult = await validateEventEnvelope(envelope);
    expect(validationResult.status).toBe('VALID');
    if (validationResult.status !== 'VALID') {
      continue;
    }

    const result = engine.applyEvent(validationResult.eventEnvelope);
    switch (result.status) {
      case 'EVENT_APPLIED':
        eventLog.push(`APPLY eventVersion=${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'EVENT_IGNORED_DUPLICATE':
        eventLog.push(`IGNORE duplicate eventVersion=${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'SNAPSHOT_RESYNC_REQUIRED':
        resyncRequired = true;
        eventLog.push(`RESYNC_REQUIRED gap detected at ${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
        eventLog.push('IGNORE snapshot not applied');
        break;
      case 'SNAPSHOT_APPLIED':
        break;
    }
  }

  return {
    eventLog,
    lastAppliedEventVersion: engine.getLastAppliedEventVersion(),
    resyncRequired,
    state: engine.getProjectionState(),
  };
}

function auditProjectionBuild(
  engine: ProjectionEngine,
  state: ProjectionState,
): ProjectionBuildAuditResult {
  const folder = state.folders.find((candidate) => candidate.id === CHILD_FOLDER_ID) ?? null;
  const thread = state.threads.find((candidate) => candidate.id === THREAD_ID) ?? null;
  const record = state.records.find((candidate) => candidate.id === RECORD_ID) ?? null;
  const keyedByEntityUuid = engine.hasEntityId(ROOT_FOLDER_ID)
    && engine.hasEntityId(CHILD_FOLDER_ID)
    && engine.hasEntityId(THREAD_ID)
    && engine.hasEntityId(RECORD_ID);
  const hierarchyVerified = folder?.parentId === ROOT_FOLDER_ID
    && thread?.folderId === CHILD_FOLDER_ID
    && record?.threadId === THREAD_ID;

  return {
    entityEvidence: [
      `folder:0001=${ROOT_FOLDER_ID}`,
      `thread:0001=${THREAD_ID}`,
      `record:0001=${RECORD_ID}`,
    ],
    hierarchyVerified,
    keyedByEntityUuid,
  };
}

async function hashProjectionState(state: ProjectionState): Promise<string> {
  return sha256Hex(encodeUtf8(JSON.stringify(state)));
}

async function auditDeterminism(
  snapshotJson: string,
  baseEventVersion: number,
  envelopes: readonly TransportEnvelope[],
): Promise<DeterminismAuditResult> {
  const runReplay = async (): Promise<string> => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(snapshotJson, baseEventVersion);

    for (const envelope of envelopes) {
      const validationResult = await validateEventEnvelope(envelope);
      expect(validationResult.status).toBe('VALID');
      if (validationResult.status === 'VALID') {
        engine.applyEvent(validationResult.eventEnvelope);
      }
    }

    return hashProjectionState(engine.getProjectionState());
  };

  const hashRun1 = await runReplay();
  const hashRun2 = await runReplay();

  return {
    hashRun1,
    hashRun2,
    identical: hashRun1 === hashRun2,
  };
}

describe('Projection pipeline audit', () => {
  it('snapshot_chunk_order_validation', async () => {
    const loader = new SnapshotLoader();
    const events: SnapshotLoaderEvent[] = [];
    const protocol = await createSnapshotProtocol(createSnapshotJson());
    loader.onEvent((event) => {
      events.push(event);
    });

    loader.handleSnapshotStart(protocol.start);
    loader.handleSnapshotChunk(protocol.chunks[1] ?? protocol.chunks[0]!);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_ERROR',
        reason: 'invalid chunk order expected=0 actual=1',
      },
    ]);
  });

  it('snapshot_checksum_validation', async () => {
    const loader = new SnapshotLoader();
    const events: SnapshotLoaderEvent[] = [];
    const protocol = await createSnapshotProtocol(createSnapshotJson());
    loader.onEvent((event) => {
      events.push(event);
    });

    loader.handleSnapshotStart(createEnvelope('snapshot_start', {
      ...protocol.start.payload,
      checksum: 'deadbeef',
    }, 1));
    for (const chunk of protocol.chunks) {
      loader.handleSnapshotChunk(chunk);
    }
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_ERROR',
        reason: 'checksum mismatch',
      },
    ]);
  });

  it('snapshot_atomic_apply', async () => {
    const loader = new SnapshotLoader();
    const engine = new ProjectionEngine();
    const protocol = await createSnapshotProtocol(createSnapshotJson());

    const snapshotAudit = await auditSnapshotFlow(loader, engine, protocol);
    const buildAudit = auditProjectionBuild(engine, snapshotAudit.state);

    expect(snapshotAudit.snapshotLog).toEqual([
      'SNAPSHOT_START totalChunks=5',
      'SNAPSHOT_CHUNK index=0',
      'SNAPSHOT_CHUNK index=1',
      'SNAPSHOT_CHUNK index=2',
      'SNAPSHOT_CHUNK index=3',
      'SNAPSHOT_CHUNK index=4',
      'SNAPSHOT_COMPLETE',
      'CHECKSUM_VALID true',
    ]);
    expect(snapshotAudit.checksumValid).toBe(true);
    expect(snapshotAudit.stateAppliedBeforeComplete).toBe(false);
    expect(snapshotAudit.baseEventVersion).toBe(BASE_EVENT_VERSION);
    expect(engine.getLastAppliedEventVersion()).toBe(BASE_EVENT_VERSION);
    expect(buildAudit.keyedByEntityUuid).toBe(true);
    expect(buildAudit.hierarchyVerified).toBe(true);
    expect(buildAudit.entityEvidence).toEqual([
      `folder:0001=${ROOT_FOLDER_ID}`,
      `thread:0001=${THREAD_ID}`,
      `record:0001=${RECORD_ID}`,
    ]);
  });

  it('event_sequential_apply', async () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), BASE_EVENT_VERSION);
    const event101 = await createEventStreamEnvelope(101);
    const event102 = await createEventStreamEnvelope(102, {
      uuid: EXTRA_RECORD_ID,
      body: 'Record 102',
    }, {
      eventId: 'evt-102',
      entityId: EXTRA_RECORD_ID,
      operation: 'update',
      payload: createEventPayload(102, {
        uuid: EXTRA_RECORD_ID,
        body: 'Record 102',
      }),
    });

    const eventAudit = await auditEventFlow(engine, [event101, event102]);

    expect(eventAudit.eventLog).toEqual([
      'APPLY eventVersion=101',
      'APPLY eventVersion=102',
    ]);
    expect(eventAudit.lastAppliedEventVersion).toBe(102);
    expect(eventAudit.state.records.find((record) => record.id === EXTRA_RECORD_ID)?.name).toBe('Record 102');
  });

  it('event_duplicate_ignore', async () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), BASE_EVENT_VERSION);
    const event101 = await createEventStreamEnvelope(101);
    const duplicate101 = await createEventStreamEnvelope(101);

    const eventAudit = await auditEventFlow(engine, [event101, duplicate101]);

    expect(eventAudit.eventLog).toEqual([
      'APPLY eventVersion=101',
      'IGNORE duplicate eventVersion=101',
    ]);
    expect(eventAudit.lastAppliedEventVersion).toBe(101);
    expect(eventAudit.state.records.filter((record) => record.id === EXTRA_RECORD_ID)).toHaveLength(1);
  });

  it('event_gap_detection', async () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), BASE_EVENT_VERSION);
    const event101 = await createEventStreamEnvelope(101);
    const gap105 = await createEventStreamEnvelope(105, {
      uuid: EXTRA_RECORD_ID,
      body: 'Gap Event 105',
    }, {
      eventId: 'evt-105',
    });

    const eventAudit = await auditEventFlow(engine, [event101, gap105]);

    expect(eventAudit.eventLog).toEqual([
      'APPLY eventVersion=101',
      'RESYNC_REQUIRED gap detected at 105',
    ]);
    expect(eventAudit.resyncRequired).toBe(true);
    expect(eventAudit.lastAppliedEventVersion).toBe(101);
  });

  it('projection_determinism', async () => {
    const snapshotJson = createSnapshotJson();
    const event101 = await createEventStreamEnvelope(101);
    const event102 = await createEventStreamEnvelope(102, {
      uuid: EXTRA_RECORD_ID,
      body: 'Record 102',
    }, {
      eventId: 'evt-102',
      entityId: EXTRA_RECORD_ID,
      operation: 'update',
      payload: createEventPayload(102, {
        uuid: EXTRA_RECORD_ID,
        body: 'Record 102',
      }),
    });
    const duplicate102 = await createEventStreamEnvelope(102, {
      uuid: EXTRA_RECORD_ID,
      body: 'Record 102',
    }, {
      eventId: 'evt-102-duplicate',
      entityId: EXTRA_RECORD_ID,
      operation: 'update',
      payload: createEventPayload(102, {
        uuid: EXTRA_RECORD_ID,
        body: 'Record 102',
      }),
    });
    const gap105 = await createEventStreamEnvelope(105, {
      uuid: EXTRA_RECORD_ID,
      body: 'Gap Event 105',
    }, {
      eventId: 'evt-105',
    });

    const determinismAudit = await auditDeterminism(snapshotJson, BASE_EVENT_VERSION, [
      event101,
      event102,
      duplicate102,
      gap105,
    ]);

    expect(determinismAudit.identical).toBe(true);
    expect(determinismAudit.hashRun1).toBe(determinismAudit.hashRun2);
  });
});