import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ProjectionStore } from './projection.store';
import { RelayService } from '../relay/relay.service';
import type { RelayEnvelope } from '../relay/relay.models';

describe('ProjectionStore', () => {
  let store: ProjectionStore;
  let messages$: Subject<RelayEnvelope>;

  beforeEach(() => {
    messages$ = new Subject<RelayEnvelope>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RelayService,
          useValue: { messages$: messages$.asObservable() },
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
    messages$.next({ type, sessionId: null, timestamp: Date.now(), payload });
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

    it('should default record name and type for incomplete records', () => {
      emit('snapshot_chunk', {
        folders: [],
        threads: [],
        records: [
          { id: 'r1', threadId: 't1' }, // missing type, name, createdAt
        ],
      });

      const record = store.records()[0];
      expect(record.type).toBe('unknown');
      expect(record.name).toBe('');
      expect(record.createdAt).toBe(0);
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

  // ── Mobile field naming (uuid / folderUuid / threadUuid) ──

  describe('Mobile field naming compatibility', () => {
    it('should parse folders with uuid instead of id', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        data: JSON.stringify({
          folders: [{ uuid: 'f1', name: 'Work', parentUuid: null }],
          threads: [],
          records: [],
        }),
      });
      emit('snapshot_complete');

      expect(store.folders().length).toBe(1);
      expect(store.folders()[0]).toEqual({ id: 'f1', name: 'Work', parentId: null });
    });

    it('should parse threads with uuid and folderUuid', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        data: JSON.stringify({
          folders: [{ uuid: 'f1', name: 'F' }],
          threads: [{ uuid: 't1', folderUuid: 'f1', title: 'Notes' }],
          records: [],
        }),
      });
      emit('snapshot_complete');

      expect(store.threads().length).toBe(1);
      expect(store.threads()[0]).toEqual({ id: 't1', folderId: 'f1', title: 'Notes' });
    });

    it('should default folderId to root when folderUuid is null', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        data: JSON.stringify({
          folders: [],
          threads: [{ uuid: 't1', folderUuid: null, title: 'Loose Note' }],
          records: [],
        }),
      });
      emit('snapshot_complete');

      expect(store.threads()[0].folderId).toBe('root');
      expect(store.explorerTree().length).toBe(1);
      expect(store.explorerTree()[0].type).toBe('thread');
    });

    it('should parse records with uuid and threadUuid', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        data: JSON.stringify({
          folders: [],
          threads: [{ uuid: 't1', folderUuid: null, title: 'T' }],
          records: [
            { uuid: 'r1', threadUuid: 't1', type: 'text', name: 'Entry', createdAt: 1000 },
          ],
        }),
      });
      emit('snapshot_complete');

      expect(store.records().length).toBe(1);
      expect(store.records()[0]).toEqual({
        id: 'r1', threadId: 't1', type: 'text', name: 'Entry', createdAt: 1000,
      });
    });

    it('should build full hierarchy from mobile-format snapshot', () => {
      emit('snapshot_start');
      emit('snapshot_chunk', {
        data: JSON.stringify({
          folders: [{ uuid: 'f1', name: 'Projects', parentUuid: null }],
          threads: [
            { uuid: 't1', folderUuid: 'f1', title: 'Sprint 1' },
            { uuid: 't2', folderUuid: null, title: 'Quick Note' },
          ],
          records: [
            { uuid: 'r1', threadUuid: 't1', type: 'text', name: 'Task A', createdAt: 100 },
            { uuid: 'r2', threadUuid: 't2', type: 'image', name: 'Photo', createdAt: 200 },
          ],
        }),
      });
      emit('snapshot_complete');

      expect(store.phase()).toBe('ready');
      const tree = store.explorerTree();
      // Root has: folder "Projects" + thread "Quick Note"
      expect(tree.length).toBe(2);

      const folder = tree.find((n) => n.type === 'folder')!;
      expect(folder.name).toBe('Projects');
      expect(folder.children.length).toBe(1);
      expect(folder.children[0].name).toBe('Sprint 1');
      expect(folder.children[0].children.length).toBe(1);
      expect(folder.children[0].children[0].name).toBe('Task A');

      const rootThread = tree.find((n) => n.type === 'thread')!;
      expect(rootThread.name).toBe('Quick Note');
      expect(rootThread.children.length).toBe(1);
      expect(rootThread.children[0].name).toBe('Photo');
    });

    it('should handle event_stream with uuid fields', () => {
      seedVault(
        [{ uuid: 'f1', name: 'F' }],
        [{ uuid: 't1', folderUuid: 'f1', title: 'T' }],
      );

      emitEvent('create', 'record', {
        uuid: 'r1', threadUuid: 't1', type: 'text', name: 'New', createdAt: 1,
      });

      expect(store.records().length).toBe(1);
      expect(store.records()[0].id).toBe('r1');
      expect(store.records()[0].threadId).toBe('t1');
    });

    it('should rename via event using uuid field', () => {
      seedVault(
        [{ uuid: 'f1', name: 'OldName' }],
      );

      emitEvent('rename', 'folder', { uuid: 'f1', name: 'NewName' });

      expect(store.folders()[0].name).toBe('NewName');
    });

    it('should delete via event using uuid field', () => {
      seedVault(
        [{ uuid: 'f1', name: 'Doomed' }],
        [{ uuid: 't1', folderUuid: 'f1', title: 'T' }],
        [{ uuid: 'r1', threadUuid: 't1', type: 'text', name: 'R', createdAt: 1 }],
      );

      emitEvent('delete', 'folder', { uuid: 'f1' });

      expect(store.folders().length).toBe(0);
      expect(store.threads().length).toBe(0);
      expect(store.records().length).toBe(0);
    });

    it('should move a thread using uuid and folderUuid', () => {
      seedVault(
        [{ uuid: 'f1', name: 'A' }, { uuid: 'f2', name: 'B' }],
        [{ uuid: 't1', folderUuid: 'f1', title: 'T' }],
      );

      emitEvent('move', 'thread', { uuid: 't1', folderUuid: 'f2' });

      expect(store.threads()[0].folderId).toBe('f2');
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
    emit('snapshot_chunk', { data: JSON.stringify({ folders, threads, records }) });
    emit('snapshot_complete');
  }

  function emitEvent(
    operation: string,
    entity: string,
    data: Record<string, unknown>,
  ): void {
    emit('event_stream', { operation, entity, data });
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
