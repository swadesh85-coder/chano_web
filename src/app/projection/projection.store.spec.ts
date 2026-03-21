import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ProjectionStore } from './projection.store';
import { ProjectionEngine } from './projection_engine';
import type { ThreadProjectionEntity } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { WebRelayClient } from '../../transport/web-relay-client';

describe('ProjectionStore', () => {
  let store: ProjectionStore;
  let messages$: Subject<TransportEnvelope>;
  let nextEventVersion: number;

  beforeEach(() => {
    messages$ = new Subject<TransportEnvelope>();
    nextEventVersion = 101;

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
  });

  function emit(
    type: string,
    payload: Record<string, unknown> = {},
  ): void {
    const normalizedPayload =
      type === 'snapshot_chunk' ? normalizeSnapshotPayload(payload) : payload;

    messages$.next({
      protocolVersion: 2,
      type,
      sessionId: null,
      timestamp: Date.now(),
      sequence: 1,
      payload: normalizedPayload,
    });
  }

  function emitRaw(
    type: string,
    payload: Record<string, unknown> = {},
  ): void {
    messages$.next({
      protocolVersion: 2,
      type,
      sessionId: null,
      timestamp: Date.now(),
      sequence: 1,
      payload,
    });
  }

  function normalizeSnapshotPayload(payload: Record<string, unknown>): Record<string, unknown> {
    if ('data' in payload) {
      return payload;
    }

    return {
      data: JSON.stringify({
        folders: normalizeSnapshotEntities('folder', payload['folders']),
        threads: normalizeSnapshotEntities('thread', payload['threads']),
        records: normalizeSnapshotEntities('record', payload['records']),
      }),
    };
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
            entityUuid: entity['uuid'] ?? entity['id'],
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['uuid'] ?? entity['id'],
              name: entity['name'],
              parentFolderUuid:
                (entity['parentFolderUuid'] ?? entity['parentUuid'] ?? entity['parentId']) === 'root'
                  ? null
                  : (entity['parentFolderUuid'] ?? entity['parentUuid'] ?? entity['parentId'] ?? null),
            },
          };
        case 'thread':
          return {
            entityType: 'thread',
            entityUuid: entity['uuid'] ?? entity['id'],
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['uuid'] ?? entity['id'],
              folderUuid:
                (entity['folderUuid'] ?? entity['folderId']) === 'root'
                  ? null
                  : (entity['folderUuid'] ?? entity['folderId'] ?? null),
              title: entity['title'],
            },
          };
        case 'record':
          return {
            entityType: 'record',
            entityUuid: entity['uuid'] ?? entity['id'],
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: entity['uuid'] ?? entity['id'],
              threadUuid: entity['threadUuid'] ?? entity['threadId'],
              type: entity['type'],
              body: entity['body'] ?? entity['name'] ?? '',
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

  function normalizeEventData(
    entity: string,
    data: Record<string, unknown>,
    operation: string,
  ): Record<string, unknown> {
    if ('uuid' in data) {
      return data;
    }

    switch (entity) {
      case 'folder':
      case 'imageGroup':
        switch (operation) {
          case 'delete':
            return { uuid: data['id'] ?? data['uuid'] };
          case 'rename':
            return { uuid: data['id'] ?? data['uuid'], name: data['name'] };
          case 'move':
            return {
              uuid: data['id'] ?? data['uuid'],
              parentFolderUuid:
                (data['parentFolderUuid'] ?? data['parentId']) === 'root'
                  ? null
                  : (data['parentFolderUuid'] ?? data['parentId'] ?? null),
            };
          default:
            return {
              uuid: data['id'] ?? data['uuid'],
              name: data['name'],
              parentFolderUuid:
                (data['parentFolderUuid'] ?? data['parentId']) === 'root'
                  ? null
                  : (data['parentFolderUuid'] ?? data['parentId'] ?? null),
            };
        }
      case 'thread':
        switch (operation) {
          case 'delete':
            return { uuid: data['id'] ?? data['uuid'] };
          case 'rename':
            return { uuid: data['id'] ?? data['uuid'], title: data['title'] };
          case 'move':
            return {
              uuid: data['id'] ?? data['uuid'],
              folderUuid:
                (data['folderUuid'] ?? data['folderId']) === 'root'
                  ? null
                  : (data['folderUuid'] ?? data['folderId'] ?? null),
            };
          default:
            return {
              uuid: data['id'] ?? data['uuid'],
              folderUuid:
                (data['folderUuid'] ?? data['folderId']) === 'root'
                  ? null
                  : (data['folderUuid'] ?? data['folderId'] ?? null),
              title: data['title'],
            };
        }
      case 'record':
        switch (operation) {
          case 'delete':
            return { uuid: data['id'] ?? data['uuid'] };
          case 'rename':
            return { uuid: data['id'] ?? data['uuid'], body: data['body'] ?? data['name'] };
          case 'move':
            return { uuid: data['id'] ?? data['uuid'], threadUuid: data['threadUuid'] ?? data['threadId'] };
          default:
            return {
              uuid: data['id'] ?? data['uuid'],
              threadUuid: data['threadUuid'] ?? data['threadId'],
              type: data['type'],
              body: data['body'] ?? data['name'],
              createdAt: data['createdAt'],
              editedAt: data['editedAt'] ?? data['createdAt'] ?? 0,
              orderIndex: data['orderIndex'] ?? 0,
              isStarred: data['isStarred'] ?? false,
              imageGroupId: data['imageGroupId'] ?? null,
            };
        }
      default:
        return data;
    }
  }

  function stripUndefinedValues(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
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

  async function createByteSnapshotProtocol(
    snapshotJson: string,
    baseEventVersion = 500,
  ): Promise<{
    readonly start: Record<string, unknown>;
    readonly chunks: readonly Record<string, unknown>[];
    readonly complete: Record<string, unknown>;
  }> {
    const bytes = encodeUtf8(snapshotJson);
    const chunkSize = Math.max(1, Math.ceil(bytes.length / 2));
    const chunkBytes: Uint8Array[] = [];

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunkBytes.push(bytes.slice(offset, offset + chunkSize));
    }

    return {
      start: {
        snapshotId: 'snapshot-store-1',
        totalChunks: chunkBytes.length,
        totalBytes: bytes.byteLength,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion,
        entityCount: 3,
        checksum: await sha256Hex(bytes),
      },
      chunks: chunkBytes.map((chunk, index) => ({
        index,
        data: toBase64(chunk),
      })),
      complete: { totalChunks: chunkBytes.length },
    };
  }

  async function createAuthoritativeEventStreamPayload(
    eventVersion: number,
    entityType: 'folder' | 'thread' | 'record' | 'imageGroup',
    entityId: string,
    payload: Record<string, unknown>,
    operation: 'create' | 'update' | 'rename' | 'move' | 'delete' | 'softDelete' | 'restore' = 'create',
  ): Promise<Record<string, unknown>> {
    return {
      eventId: `evt-${eventVersion}`,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType,
      entityId,
      operation,
      timestamp: 1710000000 + eventVersion,
      payload,
      checksum: await sha256Hex(encodeUtf8(JSON.stringify(payload))),
    };
  }

  async function flushSnapshotAsyncWork(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
      });
      await Promise.resolve();
    }
  }

  function buildAuthoritativeSnapshotJson(
    folders: Record<string, unknown>[] = [],
    threads: Record<string, unknown>[] = [],
    records: Record<string, unknown>[] = [],
  ): string {
    return JSON.stringify({
      folders: normalizeSnapshotEntities('folder', folders),
      threads: normalizeSnapshotEntities('thread', threads),
      records: normalizeSnapshotEntities('record', records),
    });
  }

  async function seedVault(
    folders: Record<string, unknown>[] = [],
    threads: Record<string, unknown>[] = [],
    records: Record<string, unknown>[] = [],
    baseEventVersion = 100,
  ): Promise<void> {
    const protocol = await createByteSnapshotProtocol(
      buildAuthoritativeSnapshotJson(folders, threads, records),
      baseEventVersion,
    );

    emitRaw('snapshot_start', protocol.start);
    protocol.chunks.forEach((chunk) => emitRaw('snapshot_chunk', chunk));
    emitRaw('snapshot_complete', protocol.complete);
    await flushSnapshotAsyncWork();
  }

  async function emitEvent(
    operation: 'create' | 'update' | 'rename' | 'move' | 'delete' | 'softDelete' | 'restore',
    entity: 'folder' | 'thread' | 'record' | 'imageGroup',
    data: Record<string, unknown>,
    options: {
      readonly eventVersion?: number;
      readonly eventId?: string;
      readonly entityId?: string;
    } = {},
  ): Promise<void> {
    const normalizedData = stripUndefinedValues(normalizeEventData(entity, data, operation));
    const eventVersion = options.eventVersion ?? nextEventVersion;

    if (options.eventVersion === undefined) {
      nextEventVersion += 1;
    }

    const entityId = options.entityId ?? (typeof normalizedData['uuid'] === 'string' ? normalizedData['uuid'] : null);
    if (entityId === null) {
      throw new Error('EVENT_ENTITY_ID_REQUIRED');
    }

    const payload = await createAuthoritativeEventStreamPayload(
      eventVersion,
      entity,
      entityId,
      normalizedData,
      operation,
    );

    emitRaw('event_stream', {
      ...payload,
      ...(typeof options.eventId === 'string' ? { eventId: options.eventId } : {}),
    });
    await flushSnapshotAsyncWork();
  }

  async function emitInvalidEventEnvelope(payload: Record<string, unknown>): Promise<void> {
    emitRaw('event_stream', payload);
    await flushSnapshotAsyncWork();
  }

  // ── Phase lifecycle ──────────────────────────────────────

  describe('Snapshot lifecycle', () => {
    it('should start in idle phase', () => {
      expect(store.phase()).toBe('idle');
    });

    it('should transition to receiving on snapshot_start', () => {
      emit('snapshot_start');
      expect(store.phase()).toBe('receiving');
    });

    it('should clear existing state on snapshot_start', () => {
      // First snapshot
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Old Folder' }],
        threads: [],
        records: [],
      });
      emit('snapshot_complete');
      expect(store.folders().length).toBe(1);

      // Second snapshot clears old data
      emit('snapshot_start');
      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
      expect(store.phase()).toBe('receiving');
    });

    it('should transition to ready on snapshot_complete', () => {
      emit('snapshot_start');
      emit('snapshot_complete');
      expect(store.phase()).toBe('ready');
    });

    it('should ignore chunks when not in receiving phase', () => {
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Stray' }],
        threads: [],
        records: [],
      });
      expect(store.folders().length).toBe(0);
    });
  });

  // ── Chunk parsing ────────────────────────────────────────

  describe('Chunk parsing', () => {
    beforeEach(() => emit('snapshot_start'));

    it('should parse folders from chunks', () => {
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Work', parentId: 'root' },
          { id: 'f2', name: 'Personal', parentId: null },
        ],
        threads: [],
        records: [],
      });

      expect(store.folders().length).toBe(2);
      expect(store.folders()[0]).toEqual({ id: 'f1', name: 'Work', parentId: null });
      expect(store.folders()[1]).toEqual({ id: 'f2', name: 'Personal', parentId: null });
    });

    it('should parse nested folders with parentId', () => {
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Work' },
          { id: 'f2', name: 'Projects', parentId: 'f1' },
        ],
        threads: [],
        records: [],
      });

      expect(store.folders()[1]).toEqual({
        id: 'f2',
        name: 'Projects',
        parentId: 'f1',
      });
    });

    it('should parse threads from chunks', () => {
      emit('snapshot_chunk', {
        folders: [],
        threads: [{ id: 't1', folderId: 'f1', title: 'Meeting Notes' }],
        records: [],
      });

      expect(store.threads().length).toBe(1);
      expect(store.threads()[0]).toEqual({
        id: 't1',
        folderId: 'f1',
        title: 'Meeting Notes',
      });
    });

    it('should parse records from chunks', () => {
      emit('snapshot_chunk', {
        folders: [],
        threads: [],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Note 1', createdAt: 1000 },
        ],
      });

      expect(store.records().length).toBe(1);
      expect(store.records()[0]).toEqual({
        id: 'r1',
        threadId: 't1',
        type: 'text',
        name: 'Note 1',
        createdAt: 1000,
        editedAt: 1000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      });
    });

    it('should accumulate across multiple chunks', () => {
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'A' }],
        threads: [],
        records: [],
      });
      emit('snapshot_chunk', {
        folders: [{ id: 'f2', name: 'B' }],
        threads: [{ id: 't1', folderId: 'f1', title: 'T1' }],
        records: [],
      });

      expect(store.folders().length).toBe(2);
      expect(store.threads().length).toBe(1);
    });

    it('should handle chunks with only one entity type', () => {
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Solo' }],
        threads: [],
        records: [],
      });

      expect(store.folders().length).toBe(1);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
    });

    it('should filter out malformed entities', () => {
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Good' },
          { id: 123 },                // bad: id not string
          { name: 'No ID' },          // bad: missing id
          null,                        // bad: null
          'garbage',                   // bad: not object
        ],
        threads: [
          { id: 't1', folderId: 'f1', title: 'Good Thread' },
          { id: 't2' },               // bad: missing folderId + title
        ],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Good', createdAt: 1 },
          { id: 'r2' },               // bad: missing threadId
        ],
      });

      expect(store.folders().length).toBe(1);
      expect(store.threads().length).toBe(1);
      expect(store.records().length).toBe(1);
    });

    it('should reject incomplete records that do not match canonical schema', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit('snapshot_chunk', {
        folders: [],
        threads: [],
        records: [
          { id: 'r1', threadId: 't1' }, // missing type, name, createdAt
        ],
      });

      expect(store.records().length).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith('SCHEMA_VALIDATION_ERROR entity field mismatch');
      errorSpy.mockRestore();
    });
  });

  // ── Hierarchy builder ────────────────────────────────────

  describe('Explorer hierarchy', () => {
    it('should build Folder → Thread → Record tree', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Work' }],
        threads: [{ id: 't1', folderId: 'f1', title: 'Daily Log' }],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Entry 1', createdAt: 1 },
          { id: 'r2', threadId: 't1', type: 'text', name: 'Entry 2', createdAt: 2 },
        ],
      });
      emit('snapshot_complete');

      const tree = store.explorerTree();
      expect(tree.length).toBe(1);

      const folder = tree[0];
      expect(folder.type).toBe('folder');
      expect(folder.name).toBe('Work');
      expect(folder.children.length).toBe(1);

      const thread = folder.children[0];
      expect(thread.type).toBe('thread');
      expect(thread.name).toBe('Daily Log');
      expect(thread.children.length).toBe(2);

      const record = thread.children[0];
      expect(record.type).toBe('record');
      expect(record.name).toBe('Entry 1');
      expect(record.children.length).toBe(0);
    });

    it('should nest child folders under parent folders', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Root Folder' },
          { id: 'f2', name: 'Nested', parentId: 'f1' },
        ],
        threads: [{ id: 't1', folderId: 'f2', title: 'Deep Thread' }],
        records: [],
      });
      emit('snapshot_complete');

      const tree = store.explorerTree();
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe('Root Folder');
      expect(tree[0].children.length).toBe(1);

      const nested = tree[0].children[0];
      expect(nested.name).toBe('Nested');
      expect(nested.type).toBe('folder');
      expect(nested.children.length).toBe(1);
      expect(nested.children[0].name).toBe('Deep Thread');
    });

    it('should place root threads at top level', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [],
        threads: [{ id: 't1', folderId: 'root', title: 'Root Thread' }],
        records: [],
      });
      emit('snapshot_complete');

      const tree = store.explorerTree();
      expect(tree.length).toBe(1);
      expect(tree[0].type).toBe('thread');
      expect(tree[0].name).toBe('Root Thread');
    });

    it('should show record name or type as fallback', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [],
        threads: [{ id: 't1', folderId: 'root', title: 'T' }],
        records: [
          { id: 'r1', threadId: 't1', type: 'image', name: '', createdAt: 1 },
        ],
      });
      emit('snapshot_complete');

      const record = store.explorerTree()[0].children[0];
      expect(record.name).toBe('image'); // falls back to type
    });

    it('should handle empty snapshot', () => {
      emit('snapshot_start');
      emit('snapshot_complete');

      expect(store.explorerTree().length).toBe(0);
    });
  });

  // ── Snapshot protocol contract ─────────────────────────────

  describe('Snapshot protocol contract', () => {
    it('snapshot_start must precede chunks — chunks ignored otherwise', () => {
      // Chunk arrives with no prior snapshot_start → discarded
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Orphan' }],
        threads: [],
        records: [],
      });
      expect(store.folders().length).toBe(0);
      expect(store.phase()).toBe('idle');

      // Now start the protocol properly
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f2', name: 'Valid' }],
        threads: [],
        records: [],
      });
      expect(store.folders().length).toBe(1);
      expect(store.folders()[0].name).toBe('Valid');
    });

    it('snapshot_complete must follow chunks — sets phase ready', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'A' }],
        threads: [{ id: 't1', folderId: 'f1', title: 'T' }],
        records: [{ id: 'r1', threadId: 't1', type: 'text', name: 'R', createdAt: 1 }],
      });

      // Before snapshot_complete, phase is still receiving
      expect(store.phase()).toBe('receiving');

      emit('snapshot_complete');
      expect(store.phase()).toBe('ready');
      expect(store.folders().length).toBe(1);
      expect(store.threads().length).toBe(1);
      expect(store.records().length).toBe(1);
    });

    it('snapshot must include folders, threads, and records in chunks', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Work' },
          { id: 'f2', name: 'Personal' },
        ],
        threads: [
          { id: 't1', folderId: 'f1', title: 'Daily Log' },
          { id: 't2', folderId: 'f2', title: 'Journal' },
        ],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Entry', createdAt: 1 },
          { id: 'r2', threadId: 't2', type: 'image', name: 'Photo', createdAt: 2 },
        ],
      });
      emit('snapshot_complete');

      expect(store.folders().length).toBe(2);
      expect(store.threads().length).toBe(2);
      expect(store.records().length).toBe(2);

      // All three entity types present in the tree
      const tree = store.explorerTree();
      const types = new Set<string>();
      function walk(nodes: typeof tree): void {
        for (const n of nodes) {
          types.add(n.type);
          walk(n.children);
        }
      }
      walk(tree);
      expect(types.has('folder')).toBe(true);
      expect(types.has('thread')).toBe(true);
      expect(types.has('record')).toBe(true);
    });

    it('snapshot export returns deterministic ordering', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Alpha' },
          { id: 'f2', name: 'Beta' },
        ],
        threads: [
          { id: 't1', folderId: 'f1', title: 'Thread A' },
          { id: 't2', folderId: 'f2', title: 'Thread B' },
        ],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Rec 1', createdAt: 1 },
          { id: 'r2', threadId: 't2', type: 'text', name: 'Rec 2', createdAt: 2 },
        ],
      });
      emit('snapshot_complete');

      const tree1 = JSON.stringify(store.explorerTree());

      // Re-run the same snapshot — output must be byte-identical
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'f1', name: 'Alpha' },
          { id: 'f2', name: 'Beta' },
        ],
        threads: [
          { id: 't1', folderId: 'f1', title: 'Thread A' },
          { id: 't2', folderId: 'f2', title: 'Thread B' },
        ],
        records: [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Rec 1', createdAt: 1 },
          { id: 'r2', threadId: 't2', type: 'text', name: 'Rec 2', createdAt: 2 },
        ],
      });
      emit('snapshot_complete');

      const tree2 = JSON.stringify(store.explorerTree());
      expect(tree1).toBe(tree2);
    });

    it('projection_snapshot_immutable_deep', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'folder:001', name: 'Root' }],
        threads: [{ id: 'thread:001', folderId: 'root', title: 'Inbox Thread' }],
        records: [
          { id: 'record:001', threadId: 'thread:001', type: 'text', name: 'Entry', createdAt: 1 },
        ],
      });
      emit('snapshot_complete');

      const snapshot = store.getProjectionState();
      const beforeStoreHash = JSON.stringify({
        folders: store.folders(),
        threads: store.threads(),
        records: store.records(),
      });
      const snapshotThread = snapshot.threads.get('thread:001');

      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(snapshot.threads instanceof Map).toBe(true);
      expect(snapshotThread).toBeDefined();
      expect(Object.isFrozen(snapshotThread)).toBe(true);
      expect(Object.isFrozen(snapshotThread?.data)).toBe(true);

      expect(() => {
        (snapshot.threads as Map<string, ThreadProjectionEntity>).set('thread:999', {
          entityType: 'thread',
          entityUuid: 'thread:999',
          entityVersion: 1,
          data: {
            uuid: 'thread:999',
            folderUuid: null,
            title: 'Illegal',
          },
        } as ThreadProjectionEntity);
      }).not.toThrow();

      expect(() => {
        (snapshotThread!.data as { title: string }).title = 'Mutated';
      }).toThrow();

      const afterStoreHash = JSON.stringify({
        folders: store.folders(),
        threads: store.threads(),
        records: store.records(),
      });

      expect(afterStoreHash).toBe(beforeStoreHash);
      expect(store.threads()[0]).toEqual({
        id: 'thread:001',
        folderId: 'root',
        title: 'Inbox Thread',
      });
    });

    it('snapshot_atomic_apply', async () => {
      const snapshotJson = JSON.stringify({
        folders: [
          {
            entityType: 'folder',
            entityUuid: 'folder-bootstrap-1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: { uuid: 'folder-bootstrap-1', name: 'Cafe \u2615', parentFolderUuid: null },
          },
        ],
        threads: [
          {
            entityType: 'thread',
            entityUuid: 'thread-bootstrap-1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: { uuid: 'thread-bootstrap-1', folderUuid: 'folder-bootstrap-1', title: 'na\u00efve' },
          },
        ],
        records: [
          {
            entityType: 'record',
            entityUuid: 'record-bootstrap-1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: 'record-bootstrap-1',
              threadUuid: 'thread-bootstrap-1',
              type: 'text',
              body: 'r\u00e9sum\u00e9',
              createdAt: 1710000000,
              editedAt: 1710000000,
              orderIndex: 0,
              isStarred: false,
              imageGroupId: null,
            },
          },
        ],
      });
      const protocol = await createByteSnapshotProtocol(snapshotJson);

      emitRaw('snapshot_start', protocol.start);

      expect(store.phase()).toBe('receiving');
      expect(store.folders()).toEqual([]);
      expect(store.threads()).toEqual([]);
      expect(store.records()).toEqual([]);

      for (const chunk of protocol.chunks) {
        emitRaw('snapshot_chunk', chunk);
      }

      expect(store.folders()).toEqual([]);
      expect(store.threads()).toEqual([]);
      expect(store.records()).toEqual([]);
      expect(store.lastAppliedEventVersion()).toBeNull();

      emitRaw('snapshot_complete', protocol.complete);
      await flushSnapshotAsyncWork();

      expect(store.phase()).toBe('ready');
      expect(store.folders()).toEqual([{ id: 'folder-bootstrap-1', name: 'Cafe ☕', parentId: null }]);
      expect(store.threads()).toEqual([{ id: 'thread-bootstrap-1', folderId: 'folder-bootstrap-1', title: 'naïve' }]);
      expect(store.records()).toEqual([
        {
          id: 'record-bootstrap-1',
          threadId: 'thread-bootstrap-1',
          type: 'text',
          name: 'résumé',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      ]);
    });

    it('snapshot_base_event_version_set', async () => {
      const protocol = await createByteSnapshotProtocol(JSON.stringify({
        folders: [],
        threads: [],
        records: [],
      }), 500);

      emitRaw('snapshot_start', protocol.start);
      protocol.chunks.forEach((chunk) => emitRaw('snapshot_chunk', chunk));
      emitRaw('snapshot_complete', protocol.complete);
      await flushSnapshotAsyncWork();

      expect(store.baseEventVersion()).toBe(500);
      expect(store.lastAppliedEventVersion()).toBe(500);
    });

    it('snapshot_atomic_apply_with_buffered_events', async () => {
      const initialSnapshotJson = JSON.stringify({
        folders: [
          {
            entityType: 'folder',
            entityUuid: '123e4567-e89b-42d3-a456-426614174001',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174001',
              name: 'Current',
              parentFolderUuid: null,
            },
          },
        ],
        threads: [
          {
            entityType: 'thread',
            entityUuid: '123e4567-e89b-42d3-a456-426614174002',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174002',
              folderUuid: '123e4567-e89b-42d3-a456-426614174001',
              title: 'Current Thread',
            },
          },
        ],
        records: [
          {
            entityType: 'record',
            entityUuid: '123e4567-e89b-42d3-a456-426614174003',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174003',
              threadUuid: '123e4567-e89b-42d3-a456-426614174002',
              type: 'text',
              body: 'Current Record',
              createdAt: 1710000000,
              editedAt: 1710000000,
              orderIndex: 0,
              isStarred: false,
              imageGroupId: null,
            },
          },
        ],
      });
      const replacementSnapshotJson = JSON.stringify({
        folders: [
          {
            entityType: 'folder',
            entityUuid: '123e4567-e89b-42d3-a456-426614174010',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174010',
              name: 'Replacement',
              parentFolderUuid: null,
            },
          },
        ],
        threads: [
          {
            entityType: 'thread',
            entityUuid: '123e4567-e89b-42d3-a456-426614174011',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174011',
              folderUuid: '123e4567-e89b-42d3-a456-426614174010',
              title: 'Replacement Thread',
            },
          },
        ],
        records: [
          {
            entityType: 'record',
            entityUuid: '123e4567-e89b-42d3-a456-426614174012',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: '123e4567-e89b-42d3-a456-426614174012',
              threadUuid: '123e4567-e89b-42d3-a456-426614174011',
              type: 'text',
              body: 'Snapshot Record',
              createdAt: 1710000100,
              editedAt: 1710000100,
              orderIndex: 0,
              isStarred: false,
              imageGroupId: null,
            },
          },
        ],
      });
      const initialProtocol = await createByteSnapshotProtocol(initialSnapshotJson, 90);
      const replacementProtocol = await createByteSnapshotProtocol(replacementSnapshotJson, 100);
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      emitRaw('snapshot_start', initialProtocol.start);
      initialProtocol.chunks.forEach((chunk) => emitRaw('snapshot_chunk', chunk));
      emitRaw('snapshot_complete', initialProtocol.complete);
      await flushSnapshotAsyncWork();

      expect(store.folders()).toEqual([
        { id: '123e4567-e89b-42d3-a456-426614174001', name: 'Current', parentId: null },
      ]);

      emitRaw('snapshot_start', replacementProtocol.start);
      replacementProtocol.chunks.forEach((chunk) => emitRaw('snapshot_chunk', chunk));

      emitRaw('event_stream', await createAuthoritativeEventStreamPayload(102, 'record', '123e4567-e89b-42d3-a456-426614174020', {
        uuid: '123e4567-e89b-42d3-a456-426614174020',
        threadUuid: '123e4567-e89b-42d3-a456-426614174011',
        type: 'text',
        body: 'Buffered 102',
        createdAt: 1710000101,
        editedAt: 1710000102,
        orderIndex: 1,
        isStarred: false,
        imageGroupId: null,
      }, 'update'));
      emitRaw('event_stream', await createAuthoritativeEventStreamPayload(101, 'record', '123e4567-e89b-42d3-a456-426614174020', {
        uuid: '123e4567-e89b-42d3-a456-426614174020',
        threadUuid: '123e4567-e89b-42d3-a456-426614174011',
        type: 'text',
        body: 'Buffered 101',
        createdAt: 1710000101,
        editedAt: 1710000101,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      }));
      await flushSnapshotAsyncWork();

      expect(store.phase()).toBe('receiving');
      expect(store.folders()).toEqual([
        { id: '123e4567-e89b-42d3-a456-426614174001', name: 'Current', parentId: null },
      ]);
      expect(store.lastAppliedEventVersion()).toBe(90);

      emitRaw('snapshot_complete', replacementProtocol.complete);
      await flushSnapshotAsyncWork();

      expect(store.phase()).toBe('ready');
      expect(store.lastAppliedEventVersion()).toBe(102);
      expect(store.folders()).toEqual([
        { id: '123e4567-e89b-42d3-a456-426614174010', name: 'Replacement', parentId: null },
      ]);
      expect(store.records()).toEqual([
        {
          id: '123e4567-e89b-42d3-a456-426614174012',
          threadId: '123e4567-e89b-42d3-a456-426614174011',
          type: 'text',
          name: 'Snapshot Record',
          createdAt: 1710000100,
          editedAt: 1710000100,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174020',
          threadId: '123e4567-e89b-42d3-a456-426614174011',
          type: 'text',
          name: 'Buffered 102',
          createdAt: 1710000101,
          editedAt: 1710000102,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: null,
        },
      ]);

      const bufferedLogs = consoleLog.mock.calls
        .map(([message]) => message)
        .filter((message): message is string => typeof message === 'string' && message.startsWith('EVENT_BUFFERED version='));

      expect(bufferedLogs).toEqual([
        'EVENT_BUFFERED version=102',
        'EVENT_BUFFERED version=101',
      ]);

      consoleLog.mockRestore();
    });

    it('root_mapping_consistency', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'folder:001', name: 'Alpha' },
          { id: 'folder:002', name: 'Beta' },
        ],
        threads: [
          { id: 'thread:001', folderId: 'root', title: 'Root Thread' },
          { id: 'thread:002', folderId: 'folder:002', title: 'Nested Thread' },
        ],
        records: [
          { id: 'record:001', threadId: 'thread:001', type: 'text', name: 'Entry', createdAt: 1 },
        ],
      });
      emit('snapshot_complete');

      const snapshot = store.getProjectionState();
      const snapshotFolders = [...snapshot.folders.values()];
      const snapshotThreads = [...snapshot.threads.values()];
      const snapshotRecords = [...snapshot.records.values()];

      expect(snapshotFolders.map((folder) => folder.entityUuid)).toEqual(['folder:001', 'folder:002']);
      expect(snapshotThreads.map((thread) => thread.entityUuid)).toEqual(['thread:001', 'thread:002']);
      expect(snapshotRecords.map((record) => record.entityUuid)).toEqual(['record:001']);

      expect(snapshotThreads[0].data.folderUuid).toBeNull();
      expect(snapshotThreads[1].data.folderUuid).toBe('folder:002');
      expect(store.threads()[0].folderId).toBe('root');
      expect(store.threads()[1].folderId).toBe('folder:002');
      expect(snapshotThreads[0].entityUuid).toBe(store.threads()[0].id);
    });

    it('projection_snapshot_order_preserved', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [
          { id: 'folder:001', name: 'Alpha' },
          { id: 'folder:002', name: 'Beta' },
        ],
        threads: [
          { id: 'thread:001', folderId: 'root', title: 'First Thread' },
          { id: 'thread:002', folderId: 'folder:002', title: 'Second Thread' },
        ],
        records: [
          { id: 'record:001', threadId: 'thread:001', type: 'text', name: 'First Record', createdAt: 1 },
          { id: 'record:002', threadId: 'thread:002', type: 'text', name: 'Second Record', createdAt: 2 },
        ],
      });
      emit('snapshot_complete');

      const snapshot = store.getProjectionState();
      const snapshotFolders = [...snapshot.folders.values()];
      const snapshotThreads = [...snapshot.threads.values()];
      const snapshotRecords = [...snapshot.records.values()];

      expect(snapshotFolders.map((folder) => folder.entityUuid)).toEqual(['folder:001', 'folder:002']);
      expect(snapshotThreads.map((thread) => thread.entityUuid)).toEqual(['thread:001', 'thread:002']);
      expect(snapshotRecords.map((record) => record.entityUuid)).toEqual(['record:001', 'record:002']);
    });

    it('no_snapshot_backflow_mutation', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'folder:001', name: 'Alpha' }],
        threads: [{ id: 'thread:001', folderId: 'root', title: 'Root Thread' }],
        records: [],
      });
      emit('snapshot_complete');

      const snapshot = store.getProjectionState();
      const beforeStoreHash = JSON.stringify(store.threads());
      const snapshotThread = snapshot.threads.get('thread:001');

      try {
        (snapshotThread!.data as { folderUuid: string | null }).folderUuid = 'folder:001';
      } catch {
        // Frozen snapshot rejects mutation attempts; store state check below is authoritative.
      }

      expect(JSON.stringify(store.threads())).toBe(beforeStoreHash);
      expect(store.threads()[0].folderId).toBe('root');
      expect(snapshotThread?.data.folderUuid).toBeNull();
    });

    it('records appear only inside threads, never at folder or root level', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Root Folder' }],
        threads: [{ id: 't1', folderId: 'f1', title: 'Thread' }],
        records: [{ id: 'r1', threadId: 't1', type: 'text', name: 'Rec', createdAt: 1 }],
      });
      emit('snapshot_complete');

      const tree = store.explorerTree();

      function assertNoRecordsAtFolderOrRoot(nodes: typeof tree, depth: string): void {
        for (const node of nodes) {
          if (node.type === 'record') {
            // Records must never be a direct child of root or folder
            expect(depth).not.toBe('root');
            expect(depth).not.toBe('folder');
          }
          const nextDepth = node.type === 'folder' ? 'folder' : node.type === 'thread' ? 'thread' : depth;
          assertNoRecordsAtFolderOrRoot(node.children, nextDepth);
        }
      }
      assertNoRecordsAtFolderOrRoot(tree, 'root');
    });

    it('large snapshots can be processed incrementally across many chunks', () => {
      emit('snapshot_start');

      const CHUNK_COUNT = 50;
      for (let i = 0; i < CHUNK_COUNT; i++) {
        emit('snapshot_chunk', {
          folders: [{ id: `f${i}`, name: `Folder ${i}` }],
          threads: [{ id: `t${i}`, folderId: `f${i}`, title: `Thread ${i}` }],
          records: [
            { id: `r${i}a`, threadId: `t${i}`, type: 'text', name: `Rec ${i}A`, createdAt: i },
            { id: `r${i}b`, threadId: `t${i}`, type: 'text', name: `Rec ${i}B`, createdAt: i + 1 },
          ],
        });
      }

      // Still receiving — not yet complete
      expect(store.phase()).toBe('receiving');
      expect(store.folders().length).toBe(CHUNK_COUNT);
      expect(store.threads().length).toBe(CHUNK_COUNT);
      expect(store.records().length).toBe(CHUNK_COUNT * 2);

      emit('snapshot_complete');
      expect(store.phase()).toBe('ready');

      // Verify full tree built correctly
      const tree = store.explorerTree();
      expect(tree.length).toBe(CHUNK_COUNT);

      // Spot-check first and last
      expect(tree[0].type).toBe('folder');
      expect(tree[0].children[0].type).toBe('thread');
      expect(tree[0].children[0].children.length).toBe(2);

      expect(tree[CHUNK_COUNT - 1].name).toBe(`Folder ${CHUNK_COUNT - 1}`);
      expect(tree[CHUNK_COUNT - 1].children[0].children.length).toBe(2);
    });
  });

  describe('Schema enforcement', () => {
    it('schema_snapshot_entity_validation', () => {
      emit('snapshot_start');
      emitRaw('snapshot_chunk', {
        data: JSON.stringify({
          folders: [
            {
              entityType: 'folder',
              entityUuid: 'folder-uuid',
              entityVersion: 1,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'folder-uuid',
                name: 'Projects',
                parentFolderUuid: null,
              },
            },
          ],
          threads: [
            {
              entityType: 'thread',
              entityUuid: 'thread-uuid',
              entityVersion: 1,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'thread-uuid',
                folderUuid: 'folder-uuid',
                title: 'Sprint',
              },
            },
          ],
          records: [
            {
              entityType: 'record',
              entityUuid: 'record-uuid',
              entityVersion: 1,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'record-uuid',
                threadUuid: 'thread-uuid',
                type: 'text',
                body: 'Task A',
                createdAt: 1,
                editedAt: 1,
                orderIndex: 0,
                isStarred: false,
                imageGroupId: null,
              },
            },
          ],
        }),
      });
      emit('snapshot_complete');

      expect(store.folders()[0]).toEqual({ id: 'folder-uuid', name: 'Projects', parentId: null });
      expect(store.threads()[0]).toEqual({ id: 'thread-uuid', folderId: 'folder-uuid', title: 'Sprint' });
      expect(store.records()[0]).toEqual({
        id: 'record-uuid',
        threadId: 'thread-uuid',
        type: 'text',
        name: 'Task A',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      });
    });

    it('schema_event_entity_validation', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
      );

      await emitEvent('create', 'record', {
        id: 'r1',
        threadId: 't1',
        type: 'text',
        name: 'Canonical body',
        createdAt: 1,
      });

      expect(store.records().length).toBe(1);
      expect(store.records()[0].name).toBe('Canonical body');
    });

    it('schema_reject_noncanonical_fields', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit('snapshot_start');
      emitRaw('snapshot_chunk', {
        data: JSON.stringify({
          folders: [
            {
              entityType: 'folder',
              entityUuid: 'folder-uuid',
              entityVersion: 1,
              ownerUserId: 'owner-1',
              data: {
                id: 'folder-uuid',
                name: 'Legacy',
                parentFolderUuid: null,
              },
            },
          ],
          threads: [],
          records: [],
        }),
      });

      expect(store.folders().length).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith('SCHEMA_VALIDATION_ERROR entity field mismatch');
      errorSpy.mockRestore();
    });

    it('schema_projection_consistency', async () => {
      await seedVault(
        [{ id: 'folder-uuid', name: 'Projects' }],
        [{ id: 'thread-uuid', folderId: 'folder-uuid', title: 'Roadmap' }],
        [{ id: 'record-uuid', threadId: 'thread-uuid', type: 'text', name: 'Milestone', createdAt: 1, editedAt: 1, orderIndex: 0, isStarred: true, imageGroupId: null }],
      );

      await emitEvent('rename', 'record', { id: 'record-uuid', name: 'Milestone updated' });

      expect(store.explorerTree()[0].children[0].children[0].name).toBe('Milestone updated');
    });
  });

  // ── Event stream ──────────────────────────────────────────

  describe('Event stream — authoritative path enforcement', () => {
    it('remove_legacy_event_path', async () => {
      const engineSpy = vi.spyOn(ProjectionEngine.prototype, 'onEvent');
      await seedVault();

      await emitInvalidEventEnvelope({
        operation: 'create',
        entity: 'record',
        data: {
          uuid: 'r1',
          threadUuid: 't1',
          type: 'text',
          body: 'Legacy payload',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      });

      expect(engineSpy).not.toHaveBeenCalled();
      expect(store.records()).toEqual([]);
    });

    it('event_only_via_projection_engine', async () => {
      const engineSpy = vi.spyOn(ProjectionEngine.prototype, 'onEvent');
      await seedVault(
        [{ id: 'f1', name: 'Inbox' }],
        [{ id: 't1', folderId: 'f1', title: 'Notes' }],
      );

      await emitEvent('create', 'record', {
        id: 'r1', threadId: 't1', type: 'text', name: 'Hello', createdAt: 1,
      });

      expect(engineSpy).toHaveBeenCalledTimes(1);
      expect(store.records().length).toBe(1);
      expect(store.records()[0].name).toBe('Hello');
    });

    it('no_direct_projection_mutation', async () => {
      await seedVault([{ id: 'f1', name: 'Original' }]);
      const committedState = {
        folders: store.folders(),
        threads: store.threads(),
        records: store.records(),
      };

      await emitInvalidEventEnvelope({
        eventId: 'evt-invalid-1',
        originDeviceId: 'mobile-1',
        eventVersion: 101,
        entityType: 'folder',
        entityId: 'f1',
        operation: 'rename',
        timestamp: 1710000101,
        payload: { name: 'Mutated without uuid' },
        checksum: 'deadbeef',
      });

      expect({
        folders: store.folders(),
        threads: store.threads(),
        records: store.records(),
      }).toEqual(committedState);
    });

    it('event_validation_enforced', async () => {
      const engineSpy = vi.spyOn(ProjectionEngine.prototype, 'onEvent');
      await seedVault([{ id: 'f1', name: 'F' }]);

      await emitInvalidEventEnvelope({
        eventId: 'evt-invalid-2',
        originDeviceId: 'mobile-1',
        eventVersion: 101,
        entityType: 'folder',
        entityId: 'f1',
        operation: 'rename',
        timestamp: 1710000101,
        payload: { uuid: 'f1', name: 'Broken checksum' },
        checksum: 'deadbeef',
      });

      expect(engineSpy).not.toHaveBeenCalled();
      expect(store.folders()[0].name).toBe('F');
    });
  });

  describe('Event stream — projection state updates', () => {
    it('schema_event_entity_validation', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
      );

      await emitEvent('create', 'record', {
        id: 'r1',
        threadId: 't1',
        type: 'text',
        name: 'Canonical body',
        createdAt: 1,
      });

      expect(store.records().length).toBe(1);
      expect(store.records()[0].name).toBe('Canonical body');
    });

    it('schema_projection_consistency', async () => {
      await seedVault(
        [{ id: 'folder-uuid', name: 'Projects' }],
        [{ id: 'thread-uuid', folderId: 'folder-uuid', title: 'Roadmap' }],
        [{ id: 'record-uuid', threadId: 'thread-uuid', type: 'text', name: 'Milestone', createdAt: 1, editedAt: 1, orderIndex: 0, isStarred: true, imageGroupId: null }],
      );

      await emitEvent('rename', 'record', { id: 'record-uuid', name: 'Milestone updated' });

      expect(store.explorerTree()[0].children[0].children[0].name).toBe('Milestone updated');
    });

    it('should preserve event order matching mutation execution order', async () => {
      await seedVault([{ id: 'f1', name: 'Root' }]);

      await emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Draft' });
      await emitEvent('rename', 'thread', { id: 't1', title: 'Final' });
      await emitEvent('create', 'record', {
        id: 'r1', threadId: 't1', type: 'text', name: 'Content', createdAt: 1,
      });

      expect(store.threads()[0].title).toBe('Final');
      expect(store.records().length).toBe(1);
      expect(store.records()[0].threadId).toBe('t1');
    });

    it('should create a folder and reflect it in explorerTree', async () => {
      await seedVault();

      await emitEvent('create', 'folder', { id: 'f1', name: 'Projects' });

      expect(store.folders().length).toBe(1);
      expect(store.explorerTree().length).toBe(1);
      expect(store.explorerTree()[0].name).toBe('Projects');
      expect(store.explorerTree()[0].type).toBe('folder');
    });

    it('should create a thread inside its parent folder', async () => {
      await seedVault([{ id: 'f1', name: 'Work' }]);

      await emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Sprint 42' });

      expect(store.threads().length).toBe(1);
      const folder = store.explorerTree()[0];
      expect(folder.children.length).toBe(1);
      expect(folder.children[0].type).toBe('thread');
      expect(folder.children[0].name).toBe('Sprint 42');
    });

    it('should update a folder via update operation', async () => {
      await seedVault([{ id: 'f1', name: 'Old' }]);

      await emitEvent('update', 'folder', { id: 'f1', name: 'New' });

      expect(store.folders()[0].name).toBe('New');
      expect(store.explorerTree()[0].name).toBe('New');
    });

    it('should update a thread via update operation', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'Old Title' }],
      );

      await emitEvent('update', 'thread', { id: 't1', title: 'New Title' });

      expect(store.threads()[0].title).toBe('New Title');
    });

    it('should update a record via update operation', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Draft', createdAt: 1 }],
      );

      await emitEvent('update', 'record', { id: 'r1', name: 'Final', type: 'markdown' });

      expect(store.records()[0].name).toBe('Final');
      expect(store.records()[0].type).toBe('markdown');
    });

    it('should move a folder under another parent', async () => {
      await seedVault([
        { id: 'f1', name: 'A' },
        { id: 'f2', name: 'B' },
      ]);

      await emitEvent('move', 'folder', { id: 'f2', parentId: 'f1' });

      expect(store.folders().find((f) => f.id === 'f2')!.parentId).toBe('f1');
      const tree = store.explorerTree();
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe('A');
      expect(tree[0].children[0].name).toBe('B');
    });

    it('should move a thread to a different folder', async () => {
      await seedVault(
        [{ id: 'f1', name: 'Src' }, { id: 'f2', name: 'Dst' }],
        [{ id: 't1', folderId: 'f1', title: 'Moving Thread' }],
      );

      await emitEvent('move', 'thread', { id: 't1', folderId: 'f2' });

      expect(store.threads()[0].folderId).toBe('f2');
      const dst = store.explorerTree().find((n) => n.id === 'f2')!;
      expect(dst.children.length).toBe(1);
      expect(dst.children[0].name).toBe('Moving Thread');
    });

    it('should move a record to a different thread', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [
          { id: 't1', folderId: 'f1', title: 'T1' },
          { id: 't2', folderId: 'f1', title: 'T2' },
        ],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Rec', createdAt: 1 }],
      );

      await emitEvent('move', 'record', { id: 'r1', threadId: 't2' });

      expect(store.records()[0].threadId).toBe('t2');
    });

    it('should create imageGroup as a folder in projection', async () => {
      await seedVault([{ id: 'f1', name: 'Photos' }]);

      await emitEvent('create', 'imageGroup', { id: 'ig1', name: 'Vacation', parentId: 'f1' });

      expect(store.folders().length).toBe(2);
      const ig = store.folders().find((f) => f.id === 'ig1')!;
      expect(ig.name).toBe('Vacation');
      expect(ig.parentId).toBe('f1');
    });
  });

  describe('Event stream — record placement and deletion', () => {
    it('should place created record inside its target thread only', async () => {
      await seedVault(
        [{ id: 'f1', name: 'Folder' }],
        [
          { id: 't1', folderId: 'f1', title: 'Thread A' },
          { id: 't2', folderId: 'f1', title: 'Thread B' },
        ],
      );

      await emitEvent('create', 'record', {
        id: 'r1', threadId: 't2', type: 'text', name: 'Belongs to B', createdAt: 1,
      });

      const tree = store.explorerTree();
      const folder = tree[0];
      const threadA = folder.children.find((n) => n.id === 't1')!;
      const threadB = folder.children.find((n) => n.id === 't2')!;

      expect(threadA.children.length).toBe(0);
      expect(threadB.children.length).toBe(1);
      expect(threadB.children[0].name).toBe('Belongs to B');
    });

    it('should remove record from flat state and explorer tree', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Keep', createdAt: 1 },
          { id: 'r2', threadId: 't1', type: 'text', name: 'Delete Me', createdAt: 2 },
        ],
      );

      await emitEvent('delete', 'record', { id: 'r2' });

      expect(store.records().length).toBe(1);
      expect(store.records()[0].id).toBe('r1');
      const thread = store.explorerTree()[0].children[0];
      expect(thread.children.length).toBe(1);
      expect(thread.children[0].name).toBe('Keep');
    });

    it('should cascade-delete records when their thread is deleted', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'Doomed Thread' }],
        [
          { id: 'r1', threadId: 't1', type: 'text', name: 'A', createdAt: 1 },
          { id: 'r2', threadId: 't1', type: 'text', name: 'B', createdAt: 2 },
        ],
      );

      await emitEvent('delete', 'thread', { id: 't1' });

      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
      expect(store.explorerTree()[0].children.length).toBe(0);
    });

    it('should cascade-delete everything when a folder is deleted', async () => {
      await seedVault(
        [
          { id: 'f1', name: 'Parent' },
          { id: 'f2', name: 'Child', parentId: 'f1' },
        ],
        [{ id: 't1', folderId: 'f2', title: 'Deep Thread' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Deep Rec', createdAt: 1 }],
      );

      await emitEvent('delete', 'folder', { id: 'f1' });

      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
      expect(store.explorerTree().length).toBe(0);
    });
  });

  describe('Event stream — rename updates explorer tree', () => {
    it('should rename a folder and reflect in explorerTree', async () => {
      await seedVault([{ id: 'f1', name: 'OldFolder' }]);

      await emitEvent('rename', 'folder', { id: 'f1', name: 'RenamedFolder' });

      expect(store.folders()[0].name).toBe('RenamedFolder');
      expect(store.explorerTree()[0].name).toBe('RenamedFolder');
    });

    it('should rename a thread and reflect in explorerTree', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'OldThread' }],
      );

      await emitEvent('rename', 'thread', { id: 't1', title: 'RenamedThread' });

      expect(store.threads()[0].title).toBe('RenamedThread');
      expect(store.explorerTree()[0].children[0].name).toBe('RenamedThread');
    });

    it('should rename a record and reflect in explorerTree', async () => {
      await seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'OldName', createdAt: 1 }],
      );

      await emitEvent('rename', 'record', { id: 'r1', name: 'RenamedRecord' });

      expect(store.records()[0].name).toBe('RenamedRecord');
      expect(store.explorerTree()[0].children[0].children[0].name).toBe('RenamedRecord');
    });

    it('should rename an imageGroup (folder) and reflect in explorerTree', async () => {
      await seedVault([{ id: 'ig1', name: 'Album' }]);

      await emitEvent('rename', 'imageGroup', { id: 'ig1', name: 'Vacation 2026' });

      expect(store.folders()[0].name).toBe('Vacation 2026');
      expect(store.explorerTree()[0].name).toBe('Vacation 2026');
    });
  });

  describe('Event stream — safety invariants', () => {
    it('should ignore events with invalid entity', async () => {
      await seedVault();

      await emitInvalidEventEnvelope({
        eventId: 'evt-invalid-entity',
        originDeviceId: 'mobile-1',
        eventVersion: 101,
        entityType: 'widget',
        entityId: 'w1',
        operation: 'create',
        timestamp: 1710000101,
        payload: { uuid: 'w1', name: 'Bad' },
        checksum: 'deadbeef',
      });

      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
    });

    it('should ignore events with missing id on mutating operations', async () => {
      await seedVault([{ id: 'f1', name: 'Original' }]);

      await emitInvalidEventEnvelope({
        eventId: 'evt-missing-id',
        originDeviceId: 'mobile-1',
        eventVersion: 101,
        entityType: 'folder',
        entityId: 'f1',
        operation: 'rename',
        timestamp: 1710000101,
        payload: { name: 'No ID' },
        checksum: 'deadbeef',
      });

      expect(store.folders()[0].name).toBe('Original');
    });

    it('should ignore events with malformed JSON in data', async () => {
      await seedVault();

      await emitInvalidEventEnvelope({
        eventId: 'evt-malformed-payload',
        originDeviceId: 'mobile-1',
        eventVersion: 101,
        entityType: 'folder',
        entityId: 'f1',
        operation: 'create',
        timestamp: 1710000101,
        payload: '{not valid json',
        checksum: 'deadbeef',
      });

      expect(store.folders().length).toBe(0);
    });

    it('should not persist data after event processing', async () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem');
      await seedVault([{ id: 'f1', name: 'F' }]);

      await emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'T' });
      await emitEvent('rename', 'thread', { id: 't1', title: 'Renamed' });
      await emitEvent('delete', 'thread', { id: 't1' });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ── Safety ───────────────────────────────────────────────

  describe('Safety invariants', () => {
    it('should never persist data (no storage APIs)', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem');
      emit('snapshot_start');
      emit('snapshot_chunk', {
        folders: [{ id: 'f1', name: 'Test' }],
        threads: [],
        records: [],
      });
      emit('snapshot_complete');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should ignore non-snapshot messages', () => {
      emit('pair_approved');
      emit('relay');
      emit('qr_session_ready');
      expect(store.phase()).toBe('idle');
    });
  });
});
