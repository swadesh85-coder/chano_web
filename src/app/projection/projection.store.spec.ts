// @vitest-environment jsdom

import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectionStore } from './projection.store';
import { selectFolderTree } from '../../projection/selectors';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { WebRelayClient } from '../../transport/web-relay-client';

let angularTestEnvironmentInitialized = false;

function ensureAngularTestEnvironment(): void {
  if (angularTestEnvironmentInitialized) {
    return;
  }

  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cannot set base providers because it has already been called')) {
      throw error;
    }
  }

  angularTestEnvironmentInitialized = true;
}

describe('ProjectionStore', () => {
  let store: ProjectionStore;
  let messages$: Subject<TransportEnvelope>;
  let sequence: number;

  beforeAll(() => {
    ensureAngularTestEnvironment();
  });

  beforeEach(() => {
    messages$ = new Subject<TransportEnvelope>();
    sequence = 1;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: WebRelayClient,
          useValue: {
            onProjectionMessage: (handler: (envelope: TransportEnvelope) => void) => {
              const subscription = messages$.asObservable().subscribe(handler);
              return () => subscription.unsubscribe();
            },
          },
        },
      ],
    });

    store = TestBed.inject(ProjectionStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messages$.complete();
    TestBed.resetTestingModule();
  });

  function emitRaw(type: string, payload: Record<string, unknown>): void {
    messages$.next({
      protocolVersion: 2,
      type,
      sessionId: 'session-projection-store',
      timestamp: 1_710_000_000 + sequence,
      sequence,
      payload,
    });

    sequence += 1;
  }

  function encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
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
      throw new Error('No base64 encoder available');
    }

    return bufferCtor.from(bytes).toString('base64');
  }

  async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function normalizeSnapshotEntities(
    entityType: 'folder' | 'thread' | 'record',
    raw: unknown,
  ): unknown[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry;
      }

      const entity = entry as Record<string, unknown>;
      if ('entityType' in entity) {
        return entity;
      }

      switch (entityType) {
        case 'folder':
          return {
            entityType: 'folder',
            entityUuid: entity['id'] ?? entity['uuid'],
            entityVersion: 1,
            lastEventVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['id'] ?? entity['uuid'],
              name: entity['name'],
              parentFolderUuid:
                (entity['parentId'] ?? entity['parentFolderUuid']) === 'root'
                  ? null
                  : (entity['parentId'] ?? entity['parentFolderUuid'] ?? null),
            },
          };
        case 'thread':
          return {
            entityType: 'thread',
            entityUuid: entity['id'] ?? entity['uuid'],
            entityVersion: 1,
            lastEventVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['id'] ?? entity['uuid'],
              folderUuid:
                (entity['folderId'] ?? entity['folderUuid']) === 'root'
                  ? null
                  : (entity['folderId'] ?? entity['folderUuid'] ?? null),
              title: entity['title'],
            },
          };
        case 'record':
          return {
            entityType: 'record',
            entityUuid: entity['id'] ?? entity['uuid'],
            entityVersion: 1,
            lastEventVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['id'] ?? entity['uuid'],
              threadUuid: entity['threadId'] ?? entity['threadUuid'],
              type: entity['type'],
              body: entity['name'] ?? entity['body'] ?? '',
              createdAt: entity['createdAt'] ?? 0,
              editedAt: entity['editedAt'] ?? entity['createdAt'] ?? 0,
              orderIndex: entity['orderIndex'] ?? 0,
              isStarred: entity['isStarred'] ?? false,
              imageGroupId: entity['imageGroupId'] ?? null,
            },
          };
      }
    });
  }

  function buildSnapshotJson(
    folders: Record<string, unknown>[] = [],
    threads: Record<string, unknown>[] = [],
    records: Record<string, unknown>[] = [],
  ): string {
    const entities = [
      ...normalizeSnapshotEntities('folder', folders),
      ...normalizeSnapshotEntities('thread', threads),
      ...normalizeSnapshotEntities('record', records),
    ];

    return JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 100,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: entities.length,
      checksum: 'ignored-in-payload-checksum',
      entities,
    });
  }

  function buildMalformedSnapshotJson(entityType: 'folder' | 'thread'): string {
    const folderEntity: Record<string, unknown> = {
      entityType: 'folder',
      entityUuid: 'folder-1',
      entityVersion: 1,
      ownerUserId: 'owner-1',
      data: {
        uuid: 'folder-1',
        name: 'Inbox',
        parentFolderUuid: null,
      },
    };
    const threadEntity: Record<string, unknown> = {
      entityType: 'thread',
      entityUuid: 'thread-1',
      entityVersion: 1,
      ownerUserId: 'owner-1',
      data: {
        uuid: 'thread-1',
        folderUuid: 'folder-1',
        title: 'Roadmap',
      },
    };

    if (entityType !== 'folder') {
      folderEntity['lastEventVersion'] = 1;
    }

    if (entityType !== 'thread') {
      threadEntity['lastEventVersion'] = 1;
    }

    return JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 100,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 3,
      checksum: 'ignored-in-payload-checksum',
      entities: [
        folderEntity,
        threadEntity,
        {
          entityType: 'record',
          entityUuid: 'record-1',
          entityVersion: 1,
          lastEventVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'record-1',
            threadUuid: 'thread-1',
            type: 'text',
            body: 'Seed',
            createdAt: 1,
            editedAt: 1,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
      ],
    });
  }

  async function createByteSnapshotProtocol(
    snapshotJson: string,
    baseEventVersion = 100,
    chunkCount = 2,
  ): Promise<{
    readonly start: Record<string, unknown>;
    readonly chunks: readonly Record<string, unknown>[];
    readonly complete: Record<string, unknown>;
  }> {
    const bytes = encodeUtf8(snapshotJson);
    const checksum = await sha256Hex(bytes);
    const chunkSize = Math.max(1, Math.ceil(bytes.length / chunkCount));
    const chunks: Uint8Array[] = [];
    const parsedSnapshot = JSON.parse(snapshotJson) as {
      readonly entities?: readonly unknown[];
    };

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(bytes.slice(offset, offset + chunkSize));
    }

    return {
      start: {
        snapshotId: 'snapshot-store-1',
        totalChunks: chunks.length,
        totalBytes: bytes.byteLength,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion,
        entityCount: parsedSnapshot.entities?.length ?? 0,
        checksum,
      },
      chunks: chunks.map((chunk, index) => ({
        index,
        data: toBase64(chunk),
      })),
      complete: {
        totalChunks: chunks.length,
      },
    };
  }

  async function flushAsyncWork(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
      });
      await Promise.resolve();
    }
  }

  async function applySnapshot(
    folders: Record<string, unknown>[] = [],
    threads: Record<string, unknown>[] = [],
    records: Record<string, unknown>[] = [],
    baseEventVersion = 100,
  ): Promise<void> {
    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(folders, threads, records), baseEventVersion);

    emitRaw('snapshot_start', protocol.start);
    for (const chunk of protocol.chunks) {
      emitRaw('snapshot_chunk', chunk);
    }
    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();
  }

  async function emitRecordEvent(
    eventVersion: number,
    recordId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    emitRaw('event_stream', {
      eventId: eventVersion,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType: 'record',
      entityId: recordId,
      operation: 'create',
      timestamp: new Date((1_710_000_000 + eventVersion) * 1000).toISOString(),
      payload,
      checksum: await sha256Hex(encodeUtf8(JSON.stringify(payload))),
    });

    await flushAsyncWork();
  }

  it('starts idle', () => {
    expect(store.phase()).toBe('idle');
    expect(store.state().folders).toEqual([]);
    expect(store.state().threads).toEqual([]);
    expect(store.state().records).toEqual([]);
  });

  it('does not mutate projection state before snapshot_complete', async () => {
    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(
      [{ id: 'folder-1', name: 'Inbox' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' }],
      [{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Seed', createdAt: 1 }],
    ));

    emitRaw('snapshot_start', protocol.start);
    emitRaw('snapshot_chunk', protocol.chunks[0]!);
    await flushAsyncWork();

    expect(store.phase()).toBe('receiving');
    expect(store.state().folders).toEqual([]);
    expect(store.state().threads).toEqual([]);
    expect(store.state().records).toEqual([]);

    emitRaw('snapshot_chunk', protocol.chunks[1]!);
    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');
  expect(store.state().folders.map(({ id, name, parentId }) => ({ id, name, parentId }))).toEqual([{ id: 'folder-1', name: 'Inbox', parentId: null }]);
  expect(store.state().threads.map(({ id, folderId, title }) => ({ id, folderId, title }))).toEqual([{ id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' }]);
  expect(store.state().records[0]?.id).toBe('record-1');
    expect(store.lastAppliedEventVersion()).toBe(100);
  });

  it('rejects invalid checksum without mutating committed state', async () => {
    await applySnapshot(
      [{ id: 'folder-1', name: 'Original' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Original Thread' }],
      [{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Original Record', createdAt: 1 }],
      100,
    );

    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(
      [{ id: 'folder-2', name: 'Replacement' }],
      [{ id: 'thread-2', folderId: 'folder-2', title: 'Replacement Thread' }],
      [{ id: 'record-2', threadId: 'thread-2', type: 'text', name: 'Replacement Record', createdAt: 2 }],
    ), 200);

    emitRaw('snapshot_start', { ...protocol.start, checksum: 'deadbeef' });
    for (const chunk of protocol.chunks) {
      emitRaw('snapshot_chunk', chunk);
    }
    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('idle');
  expect(store.state().folders.map(({ id, name, parentId }) => ({ id, name, parentId }))).toEqual([{ id: 'folder-1', name: 'Original', parentId: null }]);
  expect(store.state().threads.map(({ id, folderId, title }) => ({ id, folderId, title }))).toEqual([{ id: 'thread-1', folderId: 'folder-1', title: 'Original Thread' }]);
  expect(store.state().records[0]?.id).toBe('record-1');
    expect(store.lastAppliedEventVersion()).toBe(100);
  });

  it('replaces projection state atomically on snapshot apply', async () => {
    await applySnapshot(
      [{ id: 'folder-1', name: 'Original' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Thread A' }],
      [{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Record A', createdAt: 1 }],
      100,
    );

    await applySnapshot(
      [{ id: 'folder-2', name: 'Replacement' }],
      [{ id: 'thread-2', folderId: 'folder-2', title: 'Thread B' }],
      [{ id: 'record-2', threadId: 'thread-2', type: 'text', name: 'Record B', createdAt: 2 }],
      200,
    );

    expect(store.state().folders.map(({ id, name, parentId }) => ({ id, name, parentId }))).toEqual([{ id: 'folder-2', name: 'Replacement', parentId: null }]);
    expect(store.state().threads.map(({ id, folderId, title }) => ({ id, folderId, title }))).toEqual([{ id: 'thread-2', folderId: 'folder-2', title: 'Thread B' }]);
    expect(store.state().records.map((record) => record.id)).toEqual(['record-2']);
    expect(store.baseEventVersion()).toBe(200);
    expect(store.lastAppliedEventVersion()).toBe(200);
    expect(selectFolderTree(store.state())[0]?.entity.name).toBe('Replacement');
  });

  it('buffers events during ingestion and applies them only after snapshot_complete', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(
      [{ id: 'folder-1', name: 'Inbox' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' }],
      [],
    ), 100);

    emitRaw('snapshot_start', protocol.start);
    emitRaw('snapshot_chunk', protocol.chunks[0]!);
    await emitRecordEvent(102, 'record-2', {
      uuid: 'record-2',
      threadUuid: 'thread-1',
      type: 'text',
      body: 'Buffered second',
      createdAt: 2,
      editedAt: 2,
      orderIndex: 1,
      isStarred: false,
      imageGroupId: null,
    });
    await emitRecordEvent(101, 'record-1', {
      uuid: 'record-1',
      threadUuid: 'thread-1',
      type: 'text',
      body: 'Buffered first',
      createdAt: 1,
      editedAt: 1,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
    });

    expect(store.state().records).toEqual([]);
    expect(store.phase()).toBe('receiving');

    emitRaw('snapshot_chunk', protocol.chunks[1]!);
    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');
    expect(store.state().records.map((record) => record.id)).toEqual(['record-1', 'record-2']);
    expect(store.lastAppliedEventVersion()).toBe(102);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_BUFFERED version=102']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_BUFFERED version=101']);
    consoleLog.mockRestore();
  });

  it('derives a stable snapshot log id when transport snapshotId is omitted', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(
      [{ id: 'folder-1', name: 'Inbox' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' }],
      [{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Seed', createdAt: 1 }],
    ), 125, 1);

    const { snapshotId: _snapshotId, ...startWithoutSnapshotId } = protocol.start;

    emitRaw('snapshot_start', startWithoutSnapshotId);
    emitRaw('snapshot_chunk', protocol.chunks[0]!);
    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');
    expect(consoleLog.mock.calls).toContainEqual([
      `SNAPSHOT_ASSEMBLY_STARTED snapshotId=base-125-sha-${String(protocol.start['checksum']).slice(0, 12)}`,
    ]);
    expect(consoleLog.mock.calls).toContainEqual([
      `SNAPSHOT_RECEIVE_START snapshotId=base-125-sha-${String(protocol.start['checksum']).slice(0, 12)} totalChunks=1 type=snapshot_start sessionId=session-projection-store`,
    ]);

    consoleLog.mockRestore();
  });

  it('rejects legacy snapshot chunk payloads and preserves committed state', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await applySnapshot(
      [{ id: 'folder-1', name: 'Committed' }],
      [{ id: 'thread-1', folderId: 'folder-1', title: 'Thread A' }],
      [],
      100,
    );

    const protocol = await createByteSnapshotProtocol(buildSnapshotJson(
      [{ id: 'folder-2', name: 'Legacy Replacement' }],
      [{ id: 'thread-2', folderId: 'folder-2', title: 'Thread B' }],
      [],
    ), 200);

    emitRaw('snapshot_start', protocol.start);
    emitRaw('snapshot_chunk', {
      data: JSON.stringify({
        folders: [{ id: 'folder-2', name: 'Legacy Replacement' }],
        threads: [{ id: 'thread-2', folderId: 'folder-2', title: 'Thread B' }],
        records: [],
      }),
    });
    await flushAsyncWork();

    expect(store.phase()).toBe('idle');
    expect(store.state().folders.map(({ id, name, parentId }) => ({ id, name, parentId }))).toEqual([{ id: 'folder-1', name: 'Committed', parentId: null }]);
    expect(errorSpy).toHaveBeenCalledWith('SNAPSHOT_ERROR invalid snapshot_chunk payload');
    errorSpy.mockRestore();
  });

  it('exposes canonical selector state without raw snapshot payloads', async () => {
    await applySnapshot(
      [{ id: 'folder-1', name: 'Projects' }],
      [{ id: 'thread-1', folderId: 'root', title: 'Inbox' }],
      [{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Task', createdAt: 1 }],
      150,
    );

    const projectionState = store.state();
    const folder = projectionState.folders.find((candidate) => candidate.id === 'folder-1');
    const thread = projectionState.threads.find((candidate) => candidate.id === 'thread-1');
    const record = projectionState.records.find((candidate) => candidate.id === 'record-1');

    expect(folder?.name).toBe('Projects');
    expect(thread?.folderId).toBe('root');
    expect(record?.name).toBe('Task');
    expect(store.lastProjectionUpdate()).toEqual({
      reason: 'snapshot_loaded',
      entityType: null,
      eventVersion: 150,
    });
  });

  it.each([
    {
      entityType: 'folder',
    },
    {
      entityType: 'thread',
    },
  ] as const)('rejects malformed snapshot pipeline when $entityType lastEventVersion is missing', async ({ entityType }) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const publishProjectionStateSpy = vi.spyOn(store as never, 'publishProjectionState');
    const applySnapshotSpy = vi.spyOn((store as never)['projectionEngine'], 'applySnapshot');
    const protocol = await createByteSnapshotProtocol(buildMalformedSnapshotJson(entityType));

    emitRaw('snapshot_start', protocol.start);
    for (const chunk of protocol.chunks) {
      emitRaw('snapshot_chunk', chunk);
    }
    await flushAsyncWork();

    expect(store.phase()).toBe('receiving');
    expect(store.state()).toEqual({
      folders: [],
      threads: [],
      records: [],
    });
    expect(store.lastProjectionUpdate()).toBeNull();
    expect(publishProjectionStateSpy).not.toHaveBeenCalled();

    emitRaw('snapshot_complete', protocol.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('idle');
    expect(store.state()).toEqual({
      folders: [],
      threads: [],
      records: [],
    });
    expect(store.baseEventVersion()).toBeNull();
    expect(store.lastAppliedEventVersion()).toBeNull();
    expect(store.lastProjectionUpdate()).toBeNull();
    expect(publishProjectionStateSpy).not.toHaveBeenCalled();
    expect(applySnapshotSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call) => String(call[0]).startsWith('SNAPSHOT_ERROR'))).toBe(true);

    errorSpy.mockRestore();
  });
});
