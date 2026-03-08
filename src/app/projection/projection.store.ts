import { Injectable, inject, signal, computed } from '@angular/core';
import { filter } from 'rxjs';
import { RelayService } from '../relay/relay.service';
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

@Injectable({ providedIn: 'root' })
export class ProjectionStore {
  private readonly relay = inject(RelayService);

  private readonly _folders = signal<Folder[]>([]);
  private readonly _threads = signal<Thread[]>([]);
  private readonly _records = signal<RecordEntry[]>([]);
  private readonly _phase = signal<SnapshotPhase>('idle');

  readonly phase = this._phase.asReadonly();
  readonly folders = this._folders.asReadonly();
  readonly threads = this._threads.asReadonly();
  readonly records = this._records.asReadonly();

  readonly explorerTree = computed<ExplorerNode[]>(() =>
    this.buildHierarchy(this._folders(), this._threads(), this._records()),
  );

  constructor() {
    this.relay.messages$
      .pipe(filter((m) => m.type.startsWith('snapshot_')))
      .subscribe((msg) => {
        switch (msg.type) {
          case 'snapshot_start':
            this.onSnapshotStart();
            break;
          case 'snapshot_chunk':
            this.onSnapshotChunk(msg.payload);
            break;
          case 'snapshot_complete':
            this.onSnapshotComplete();
            break;
        }
      });

    this.relay.messages$
      .pipe(filter((m) => m.type === 'event_stream'))
      .subscribe((msg) => this.onEventStream(msg.payload));
  }

  // ── Snapshot lifecycle ───────────────────────────────────

  private onSnapshotStart(): void {
    this._folders.set([]);
    this._threads.set([]);
    this._records.set([]);
    this._phase.set('receiving');
  }

  private onSnapshotChunk(payload: Record<string, unknown>): void {
    if (this._phase() !== 'receiving') return;

    // Mobile sends payload.data as a JSON string; parse it to extract entities.
    let chunk: Record<string, unknown>;
    const raw = payload['data'];
    if (typeof raw === 'string') {
      try {
        chunk = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.error('snapshot_chunk: malformed JSON in payload.data');
        return;
      }
    } else if (raw !== null && typeof raw === 'object') {
      chunk = raw as Record<string, unknown>;
    } else {
      // Fallback: payload itself may carry entities directly
      chunk = payload;
    }

    console.log('SNAPSHOT CHUNK PARSED:', chunk);

    const folders = chunk['folders'];
    const threads = chunk['threads'];
    const records = chunk['records'];

    if (Array.isArray(folders) && folders.length) {
      this._folders.update((prev) => [...prev, ...this.parseFolders(folders)]);
    }
    if (Array.isArray(threads) && threads.length) {
      this._threads.update((prev) => [...prev, ...this.parseThreads(threads)]);
    }
    if (Array.isArray(records) && records.length) {
      this._records.update((prev) => [...prev, ...this.parseRecords(records)]);
    }
  }

  private onSnapshotComplete(): void {
    this._phase.set('ready');
  }

  // ── Event stream handling ────────────────────────────────

  private onEventStream(payload: Record<string, unknown>): void {
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

  private parseEvent(payload: Record<string, unknown>): VaultEvent | null {
    const validOps: readonly string[] = ['create', 'update', 'rename', 'move', 'delete'];
    const validEntities: readonly string[] = ['folder', 'thread', 'record', 'imageGroup'];

    const operation = payload['operation'];
    const entity = payload['entity'];
    let data = payload['data'];

    if (typeof operation !== 'string' || !validOps.includes(operation)) return null;
    if (typeof entity !== 'string' || !validEntities.includes(entity)) return null;

    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return null; }
    }
    if (data === null || typeof data !== 'object') return null;

    return {
      operation: operation as EventOperation,
      entity: entity as EventEntity,
      data: data as Record<string, unknown>,
    };
  }

  // ── Create ───────────────────────────────────────────────

  private applyCreate(entity: EventEntity, data: Record<string, unknown>): void {
    switch (entity) {
      case 'folder':
      case 'imageGroup': {
        const parsed = this.parseFolders([data]);
        if (parsed.length) {
          this._folders.update((prev) => [...prev, ...parsed]);
        }
        break;
      }
      case 'thread': {
        const parsed = this.parseThreads([data]);
        if (parsed.length) {
          this._threads.update((prev) => [...prev, ...parsed]);
        }
        break;
      }
      case 'record': {
        const parsed = this.parseRecords([data]);
        if (parsed.length) {
          this._records.update((prev) => [...prev, ...parsed]);
        }
        break;
      }
    }
  }

  // ── Update ───────────────────────────────────────────────

  private applyUpdate(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveId(data);
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
    const id = this.resolveId(data);
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
        const name = data['name'];
        if (typeof name !== 'string') return;
        this._records.update((prev) =>
          prev.map((r) => r.id === id ? { ...r, name } : r),
        );
        break;
      }
    }
  }

  // ── Move ─────────────────────────────────────────────────

  private applyMove(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveId(data);
    if (id === undefined) return;

    switch (entity) {
      case 'folder':
      case 'imageGroup': {
        const resolved = this.resolveParentId(data);
        this._folders.update((prev) =>
          prev.map((f) => f.id === id ? { ...f, parentId: resolved } : f),
        );
        break;
      }
      case 'thread': {
        const folderId = this.resolveFolderId(data);
        if (folderId === undefined) return;
        this._threads.update((prev) =>
          prev.map((t) => t.id === id ? { ...t, folderId } : t),
        );
        break;
      }
      case 'record': {
        const threadId = this.resolveThreadId(data);
        if (threadId === undefined) return;
        this._records.update((prev) =>
          prev.map((r) => r.id === id ? { ...r, threadId } : r),
        );
        break;
      }
    }
  }

  // ── Delete ───────────────────────────────────────────────

  private applyDelete(entity: EventEntity, data: Record<string, unknown>): void {
    const id = this.resolveId(data);
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
      parentId: ('parentId' in data || 'parentUuid' in data)
        ? this.resolveParentId(data)
        : existing.parentId,
    };
  }

  private mergeThread(existing: Thread, data: Record<string, unknown>): Thread {
    return {
      id: existing.id,
      folderId: this.resolveFolderId(data) ?? existing.folderId,
      title: typeof data['title'] === 'string' ? data['title'] : existing.title,
    };
  }

  private mergeRecord(existing: RecordEntry, data: Record<string, unknown>): RecordEntry {
    return {
      id: existing.id,
      threadId: this.resolveThreadId(data) ?? existing.threadId,
      type: typeof data['type'] === 'string' ? data['type'] : existing.type,
      name: typeof data['name'] === 'string' ? data['name'] : existing.name,
      createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : existing.createdAt,
    };
  }

  // ── Field resolvers (mobile sends uuid/folderUuid/threadUuid/parentUuid) ──

  private resolveId(o: Record<string, unknown>): string | undefined {
    const v = o['id'] ?? o['uuid'];
    return typeof v === 'string' ? v : undefined;
  }

  private resolveFolderId(o: Record<string, unknown>): string | undefined {
    const v = o['folderId'] ?? o['folderUuid'];
    return typeof v === 'string' ? v : undefined;
  }

  private resolveThreadId(o: Record<string, unknown>): string | undefined {
    const v = o['threadId'] ?? o['threadUuid'];
    return typeof v === 'string' ? v : undefined;
  }

  private resolveParentId(o: Record<string, unknown>): string | null {
    const v = o['parentId'] ?? o['parentUuid'];
    return typeof v === 'string' && v !== 'root' ? v : null;
  }

  // ── Parsers (trust-boundary validation) ──────────────────

  private parseFolders(raw: unknown[]): Folder[] {
    return raw
      .filter(
        (f): f is Record<string, unknown> =>
          f !== null && typeof f === 'object',
      )
      .filter((f) => {
        const id = this.resolveId(f);
        const name = typeof f['name'] === 'string' ? f['name'] : undefined;
        return id !== undefined && name !== undefined;
      })
      .map((f) => ({
        id: this.resolveId(f)!,
        name: f['name'] as string,
        parentId: this.resolveParentId(f),
      }));
  }

  private parseThreads(raw: unknown[]): Thread[] {
    return raw
      .filter(
        (t): t is Record<string, unknown> =>
          t !== null && typeof t === 'object',
      )
      .filter((t) => {
        const id = this.resolveId(t);
        const title = typeof t['title'] === 'string' ? t['title'] : undefined;
        return id !== undefined && title !== undefined;
      })
      .map((t) => ({
        id: this.resolveId(t)!,
        folderId: this.resolveFolderId(t) ?? 'root',
        title: t['title'] as string,
      }));
  }

  private parseRecords(raw: unknown[]): RecordEntry[] {
    return raw
      .filter(
        (r): r is Record<string, unknown> =>
          r !== null && typeof r === 'object',
      )
      .filter((r) => {
        const id = this.resolveId(r);
        const threadId = this.resolveThreadId(r);
        return id !== undefined && threadId !== undefined;
      })
      .map((r) => ({
        id: this.resolveId(r)!,
        threadId: this.resolveThreadId(r)!,
        type: typeof r['type'] === 'string' ? (r['type'] as string) : 'unknown',
        name: typeof r['name'] === 'string' ? (r['name'] as string) : '',
        createdAt:
          typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : 0,
      }));
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
