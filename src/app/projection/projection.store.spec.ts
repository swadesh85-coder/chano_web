import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ProjectionStore } from './projection.store';
import type { RelayEnvelope } from '../relay/relay.models';
import { WebRelayClient } from '../../transport/web-relay-client';

describe('ProjectionStore', () => {
  let store: ProjectionStore;
  let messages$: Subject<RelayEnvelope>;

  beforeEach(() => {
    messages$ = new Subject<RelayEnvelope>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: WebRelayClient,
          useValue: {
            onEnvelope: (handler: (envelope: RelayEnvelope) => void) => {
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
      });
    });

    it('schema_event_entity_validation', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
      );

      emitRaw('event_stream', {
        operation: 'create',
        entity: 'record',
        data: {
          uuid: 'r1',
          threadUuid: 't1',
          type: 'text',
          body: 'Canonical body',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
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

    it('schema_projection_consistency', () => {
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
                title: 'Roadmap',
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
                body: 'Milestone',
                createdAt: 1,
                editedAt: 1,
                orderIndex: 0,
                isStarred: true,
                imageGroupId: null,
              },
            },
          ],
        }),
      });
      emit('snapshot_complete');

      emitRaw('event_stream', {
        operation: 'rename',
        entity: 'record',
        data: { uuid: 'record-uuid', body: 'Milestone updated' },
      });

      expect(store.explorerTree()[0].children[0].children[0].name).toBe('Milestone updated');
    });
  });

  // ── Event stream ──────────────────────────────────────────

  /** Seed a minimal vault and move to 'ready' phase. */
  function seedVault(
    folders: Record<string, unknown>[] = [],
    threads: Record<string, unknown>[] = [],
    records: Record<string, unknown>[] = [],
  ): void {
    emit('snapshot_start');
    emit('snapshot_chunk', { folders, threads, records });
    emit('snapshot_complete');
  }

  function emitEvent(
    operation: string,
    entity: string,
    data: Record<string, unknown>,
  ): void {
    emitRaw('event_stream', { operation, entity, data: normalizeEventData(entity, data, operation) });
  }

  describe('Event stream — relay delivery', () => {
    it('should receive event_stream messages from relay', () => {
      seedVault(
        [{ id: 'f1', name: 'Inbox' }],
        [{ id: 't1', folderId: 'f1', title: 'Notes' }],
      );

      emitEvent('create', 'record', {
        id: 'r1', threadId: 't1', type: 'text', name: 'Hello', createdAt: 1,
      });

      expect(store.records().length).toBe(1);
    });

    it('should process events emitted after mobile mutations', () => {
      seedVault([{ id: 'f1', name: 'Work' }]);

      // Mobile creates a thread → relay delivers event
      emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Standup' });

      expect(store.threads().length).toBe(1);
      expect(store.threads()[0].title).toBe('Standup');
    });
  });

  describe('Event stream — ordering', () => {
    it('should preserve event order matching mutation execution order', () => {
      seedVault([{ id: 'f1', name: 'Root' }]);

      // Mobile performs: create thread → rename thread → create record — strict order
      emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Draft' });
      emitEvent('rename', 'thread', { id: 't1', title: 'Final' });
      emitEvent('create', 'record', {
        id: 'r1', threadId: 't1', type: 'text', name: 'Content', createdAt: 1,
      });

      expect(store.threads()[0].title).toBe('Final');
      expect(store.records().length).toBe(1);
      expect(store.records()[0].threadId).toBe('t1');
    });

    it('should apply create-then-delete in order, not collapse them', () => {
      seedVault([{ id: 'f1', name: 'Root' }]);

      emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Temp' });
      expect(store.threads().length).toBe(1);

      emitEvent('delete', 'thread', { id: 't1' });
      expect(store.threads().length).toBe(0);
    });
  });

  describe('Event stream — projection state updates', () => {
    it('should create a folder and reflect it in explorerTree', () => {
      seedVault();

      emitEvent('create', 'folder', { id: 'f1', name: 'Projects' });

      expect(store.folders().length).toBe(1);
      expect(store.explorerTree().length).toBe(1);
      expect(store.explorerTree()[0].name).toBe('Projects');
      expect(store.explorerTree()[0].type).toBe('folder');
    });

    it('should create a thread inside its parent folder', () => {
      seedVault([{ id: 'f1', name: 'Work' }]);

      emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'Sprint 42' });

      expect(store.threads().length).toBe(1);
      const folder = store.explorerTree()[0];
      expect(folder.children.length).toBe(1);
      expect(folder.children[0].type).toBe('thread');
      expect(folder.children[0].name).toBe('Sprint 42');
    });

    it('should update a folder via update operation', () => {
      seedVault([{ id: 'f1', name: 'Old' }]);

      emitEvent('update', 'folder', { id: 'f1', name: 'New' });

      expect(store.folders()[0].name).toBe('New');
      expect(store.explorerTree()[0].name).toBe('New');
    });

    it('should update a thread via update operation', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'Old Title' }],
      );

      emitEvent('update', 'thread', { id: 't1', title: 'New Title' });

      expect(store.threads()[0].title).toBe('New Title');
    });

    it('should update a record via update operation', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Draft', createdAt: 1 }],
      );

      emitEvent('update', 'record', { id: 'r1', name: 'Final', type: 'markdown' });

      expect(store.records()[0].name).toBe('Final');
      expect(store.records()[0].type).toBe('markdown');
    });

    it('should move a folder under another parent', () => {
      seedVault([
        { id: 'f1', name: 'A' },
        { id: 'f2', name: 'B' },
      ]);

      emitEvent('move', 'folder', { id: 'f2', parentId: 'f1' });

      expect(store.folders().find((f) => f.id === 'f2')!.parentId).toBe('f1');
      // B is now a child of A in the tree
      const tree = store.explorerTree();
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe('A');
      expect(tree[0].children[0].name).toBe('B');
    });

    it('should move a thread to a different folder', () => {
      seedVault(
        [{ id: 'f1', name: 'Src' }, { id: 'f2', name: 'Dst' }],
        [{ id: 't1', folderId: 'f1', title: 'Moving Thread' }],
      );

      emitEvent('move', 'thread', { id: 't1', folderId: 'f2' });

      expect(store.threads()[0].folderId).toBe('f2');
      const dst = store.explorerTree().find((n) => n.id === 'f2')!;
      expect(dst.children.length).toBe(1);
      expect(dst.children[0].name).toBe('Moving Thread');
    });

    it('should move a record to a different thread', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [
          { id: 't1', folderId: 'f1', title: 'T1' },
          { id: 't2', folderId: 'f1', title: 'T2' },
        ],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Rec', createdAt: 1 }],
      );

      emitEvent('move', 'record', { id: 'r1', threadId: 't2' });

      expect(store.records()[0].threadId).toBe('t2');
    });

    it('should create imageGroup as a folder in projection', () => {
      seedVault([{ id: 'f1', name: 'Photos' }]);

      emitEvent('create', 'imageGroup', { id: 'ig1', name: 'Vacation', parentId: 'f1' });

      expect(store.folders().length).toBe(2);
      const ig = store.folders().find((f) => f.id === 'ig1')!;
      expect(ig.name).toBe('Vacation');
      expect(ig.parentId).toBe('f1');
    });
  });

  describe('Event stream — record in correct thread', () => {
    it('should place created record inside its target thread only', () => {
      seedVault(
        [{ id: 'f1', name: 'Folder' }],
        [
          { id: 't1', folderId: 'f1', title: 'Thread A' },
          { id: 't2', folderId: 'f1', title: 'Thread B' },
        ],
      );

      emitEvent('create', 'record', {
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

    it('should not surface records at folder or root level after create', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
      );

      emitEvent('create', 'record', {
        id: 'r1', threadId: 't1', type: 'image', name: 'Pic', createdAt: 1,
      });

      const tree = store.explorerTree();
      // Root has only folder, never record
      for (const node of tree) {
        expect(node.type).not.toBe('record');
      }
      // Folder has only thread children
      for (const child of tree[0].children) {
        expect(child.type).toBe('thread');
      }
      // Record lives inside thread
      expect(tree[0].children[0].children[0].type).toBe('record');
    });
  });

  describe('Event stream — record deletion removes file from explorer', () => {
    it('should remove record from flat state and explorer tree', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [
          { id: 'r1', threadId: 't1', type: 'text', name: 'Keep', createdAt: 1 },
          { id: 'r2', threadId: 't1', type: 'text', name: 'Delete Me', createdAt: 2 },
        ],
      );
      expect(store.records().length).toBe(2);

      emitEvent('delete', 'record', { id: 'r2' });

      expect(store.records().length).toBe(1);
      expect(store.records()[0].id).toBe('r1');

      const thread = store.explorerTree()[0].children[0];
      expect(thread.children.length).toBe(1);
      expect(thread.children[0].name).toBe('Keep');
    });

    it('should cascade-delete records when their thread is deleted', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'Doomed Thread' }],
        [
          { id: 'r1', threadId: 't1', type: 'text', name: 'A', createdAt: 1 },
          { id: 'r2', threadId: 't1', type: 'text', name: 'B', createdAt: 2 },
        ],
      );

      emitEvent('delete', 'thread', { id: 't1' });

      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
      expect(store.explorerTree()[0].children.length).toBe(0);
    });

    it('should cascade-delete everything when a folder is deleted', () => {
      seedVault(
        [
          { id: 'f1', name: 'Parent' },
          { id: 'f2', name: 'Child', parentId: 'f1' },
        ],
        [{ id: 't1', folderId: 'f2', title: 'Deep Thread' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'Deep Rec', createdAt: 1 }],
      );

      emitEvent('delete', 'folder', { id: 'f1' });

      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
      expect(store.explorerTree().length).toBe(0);
    });
  });

  describe('Event stream — rename updates explorer tree', () => {
    it('should rename a folder and reflect in explorerTree', () => {
      seedVault([{ id: 'f1', name: 'OldFolder' }]);

      emitEvent('rename', 'folder', { id: 'f1', name: 'RenamedFolder' });

      expect(store.folders()[0].name).toBe('RenamedFolder');
      expect(store.explorerTree()[0].name).toBe('RenamedFolder');
    });

    it('should rename a thread and reflect in explorerTree', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'OldThread' }],
      );

      emitEvent('rename', 'thread', { id: 't1', title: 'RenamedThread' });

      expect(store.threads()[0].title).toBe('RenamedThread');
      expect(store.explorerTree()[0].children[0].name).toBe('RenamedThread');
    });

    it('should rename a record and reflect in explorerTree', () => {
      seedVault(
        [{ id: 'f1', name: 'F' }],
        [{ id: 't1', folderId: 'f1', title: 'T' }],
        [{ id: 'r1', threadId: 't1', type: 'text', name: 'OldName', createdAt: 1 }],
      );

      emitEvent('rename', 'record', { id: 'r1', name: 'RenamedRecord' });

      expect(store.records()[0].name).toBe('RenamedRecord');
      expect(store.explorerTree()[0].children[0].children[0].name).toBe('RenamedRecord');
    });

    it('should rename an imageGroup (folder) and reflect in explorerTree', () => {
      seedVault([{ id: 'ig1', name: 'Album' }]);

      emitEvent('rename', 'imageGroup', { id: 'ig1', name: 'Vacation 2026' });

      expect(store.folders()[0].name).toBe('Vacation 2026');
      expect(store.explorerTree()[0].name).toBe('Vacation 2026');
    });
  });

  describe('Event stream — safety invariants', () => {
    it('should ignore events with invalid operation', () => {
      seedVault([{ id: 'f1', name: 'F' }]);

      emitEvent('destroy' as string, 'folder', { id: 'f1' });

      expect(store.folders().length).toBe(1);
    });

    it('should ignore events with invalid entity', () => {
      seedVault();

      emitEvent('create', 'widget' as string, { id: 'w1', name: 'Bad' });

      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
    });

    it('should ignore events with missing id on mutating operations', () => {
      seedVault([{ id: 'f1', name: 'Original' }]);

      emitEvent('rename', 'folder', { name: 'No ID' });

      expect(store.folders()[0].name).toBe('Original');
    });

    it('should ignore events with malformed JSON in data', () => {
      seedVault();

      // Directly emit raw payload with non-parseable data
      emit('event_stream', {
        operation: 'create',
        entity: 'folder',
        data: '{not valid json',
      });

      expect(store.folders().length).toBe(0);
    });

    it('should not persist data after event processing', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem');
      seedVault([{ id: 'f1', name: 'F' }]);

      emitEvent('create', 'thread', { id: 't1', folderId: 'f1', title: 'T' });
      emitEvent('rename', 'thread', { id: 't1', title: 'Renamed' });
      emitEvent('delete', 'thread', { id: 't1' });

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
