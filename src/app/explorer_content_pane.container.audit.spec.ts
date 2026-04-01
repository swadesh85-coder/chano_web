// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAngularTestEnvironment } from '../testing/ensure-angular-test-environment';
import { ProjectionEngine } from './projection/projection_engine';
import { ExplorerContentPaneContainer } from './explorer_content_pane.container';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type { VirtualListRange } from './virtual_list.component';
import type {
  ProjectionSnapshotDocument,
  ProjectionState,
  ProjectionUpdate,
} from './projection/projection.models';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      {
        id: 'folder-a',
        name: 'Folder A',
        parentId: null,
        entityVersion: 1,
        lastEventVersion: 1,
      },
    ],
    threads: [
      {
        id: 'thread-b',
        folderId: 'folder-a',
        title: 'Thread B',
        entityVersion: 3,
        lastEventVersion: 3,
      },
      {
        id: 'thread-a',
        folderId: 'folder-a',
        title: 'Thread A',
        entityVersion: 2,
        lastEventVersion: 2,
      },
    ],
    records: [
      {
        id: 'record-b',
        threadId: 'thread-a',
        type: 'text',
        name: 'Second',
        createdAt: 2,
        editedAt: 2,
        orderIndex: 1,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 6,
        lastEventVersion: 6,
      },
      {
        id: 'record-a',
        threadId: 'thread-a',
        type: 'text',
        name: 'First',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 5,
        lastEventVersion: 5,
      },
    ],
  };
}

function createSnapshot(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-a',
        entityVersion: 1,
        lastEventVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-a',
          name: 'Folder A',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-a',
        entityVersion: 2,
        lastEventVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-a',
          folderUuid: 'folder-a',
          title: 'Thread A',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-a',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-a',
          threadUuid: 'thread-a',
          type: 'text',
          body: 'Record A',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

describe('ExplorerContentPaneContainer audit', () => {
  ensureAngularTestEnvironment();

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps projection access and selector-to-viewmodel resolution inside the container boundary', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/explorer_content_pane.container.ts'),
      'utf8',
    );

    expect(source).toMatch(/ProjectionStateContainer/);
    expect(source).toMatch(/selectThreadListViewModel/);
    expect(source).toMatch(/selectRecordListViewModel/);
    expect(source).not.toMatch(/ProjectionStore/);
    expect(source).not.toMatch(/ProjectionEngine/);
    expect(source).not.toMatch(/\.state\(\)\.(folders|threads|records)/);
  });

  it('resolves folder selection to threads and thread selection to records without mutation', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));
    const projectionUpdate = signal<ProjectionUpdate | null>(null);

    TestBed.configureTestingModule({
      providers: [
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
            projectionUpdate: projectionUpdate.asReadonly(),
          },
        },
      ],
    });

    const container = TestBed.inject(ExplorerContentPaneContainer);
    const before = JSON.stringify(state());

    const folderContent = container.contentPane('folder-a', null, 'folder');
    const folderContentRepeat = container.contentPane('folder-a', null, 'folder');
    const threadContent = container.contentPane('folder-a', 'thread-a', 'thread');
    const threadContentRepeat = container.contentPane('folder-a', 'thread-a', 'thread');
    const emptyContent = container.contentPane(null, null, 'empty');
    const emptyContentRepeat = container.contentPane(null, null, 'empty');

    expect(folderContent.mode).toBe('threads');
    expect(folderContentRepeat).toEqual(folderContent);
    expect(folderContent.threadList.map((thread) => thread.id)).toEqual(['thread-a', 'thread-b']);
    expect(threadContent.mode).toBe('records');
    expect(threadContentRepeat).toEqual(threadContent);
    expect(container.recordList('thread-a').map((record) => record.id)).toEqual(['record-a', 'record-b']);
    expect(container.visibleRecordNodes('thread-a', { start: 0, end: 2 } satisfies VirtualListRange).map((node) => node.key)).toEqual(['record:record-a', 'record:record-b']);
    expect(container.visibleRecordNodes(null, { start: 0, end: 2 } satisfies VirtualListRange)).toEqual([]);
    expect(emptyContent.mode).toBe('empty');
    expect(emptyContentRepeat).toBe(emptyContent);
    expect(JSON.stringify(state())).toBe(before);

  });

  it('keeps navigation isolated from authoritative projection state', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));

    TestBed.configureTestingModule({
      providers: [
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
            projectionUpdate: signal<ProjectionUpdate | null>(null).asReadonly(),
          },
        },
      ],
    });

    const container = TestBed.inject(ExplorerContentPaneContainer);
    const before = JSON.stringify(state());

    expect(container.hasVisibleThread('folder-a', 'thread-a')).toBe(true);
    expect(container.hasVisibleThread('folder-a', 'missing-thread')).toBe(false);
    container.contentPane('folder-a', null, 'folder');
    container.contentPane('folder-a', 'thread-a', 'thread');
    container.contentPane(null, null, 'empty');

    expect(JSON.stringify(state())).toBe(before);

  });

  it('replays snapshot state into identical content pane output', () => {
    const firstEngine = new ProjectionEngine();
    const secondEngine = new ProjectionEngine();
    const snapshot = createSnapshot();

    firstEngine.applySnapshot(snapshot, 10);
    secondEngine.applySnapshot(snapshot, 10);

    TestBed.configureTestingModule({
      providers: [
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => firstEngine.state),
            projectionUpdate: signal<ProjectionUpdate | null>(null).asReadonly(),
          },
        },
      ],
    });

    const firstContainer = TestBed.inject(ExplorerContentPaneContainer);
    const firstContent = firstContainer.contentPane('folder-a', 'thread-a', 'thread');

    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => secondEngine.state),
            projectionUpdate: signal<ProjectionUpdate | null>(null).asReadonly(),
          },
        },
      ],
    });

    const secondContainer = TestBed.inject(ExplorerContentPaneContainer);
    const secondContent = secondContainer.contentPane('folder-a', 'thread-a', 'thread');

    expect(firstContent).toEqual(secondContent);
  });

  it('slices_record_nodes_deterministically_before_render', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));

    TestBed.configureTestingModule({
      providers: [
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
            projectionUpdate: signal<ProjectionUpdate | null>(null).asReadonly(),
          },
        },
      ],
    });

    const container = TestBed.inject(ExplorerContentPaneContainer);
    const first = container.visibleRecordNodes('thread-a', { start: 0, end: 1 });
    const second = container.visibleRecordNodes('thread-a', { start: 0, end: 1 });

    expect(first).toEqual(second);
    expect(first.map((node) => node.key)).toEqual(['record:record-a']);
  });
});