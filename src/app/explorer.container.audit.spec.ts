import fs from 'node:fs';
import path from 'node:path';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ExplorerContainer } from './explorer.container';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type {
  ProjectionState,
  ProjectionUpdate,
} from './projection/projection.models';

function createProjectionState(): ProjectionState {
  return {
    folders: [],
    threads: [
      { id: 'thread-b', folderId: 'folder-a', title: 'Thread B', entityVersion: 3 },
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 2 },
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

describe('ExplorerContainer audit', () => {
  it('enforces projection-to-viewmodel flow without selector or store leakage', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer.container.ts'), 'utf8');

    expect(source).toMatch(/ProjectionStateContainer/);
    expect(source).toMatch(/from '\.\.\/viewmodels'/);
    expect(source).toMatch(/selectThreadListViewModel/);
    expect(source).toMatch(/selectRecordListViewModel/);
    expect(source).toMatch(/selectThreadRecordNodeViewModel/);
    expect(source).not.toMatch(/ProjectionStore/);
    expect(source).not.toMatch(/ProjectionEngine/);
    expect(source).not.toMatch(/\.\.\/projection\/selectors/);
    expect(source).not.toMatch(/\.state\(\)\.(folders|threads|records)/);
  });

  it('derives deterministic viewmodels from projection state without mutation', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));
    const projectionUpdate = signal<ProjectionUpdate | null>(null);

    TestBed.configureTestingModule({
      providers: [
        ExplorerContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
            projectionUpdate: projectionUpdate.asReadonly(),
          },
        },
      ],
    });

    const container = TestBed.inject(ExplorerContainer);
    const before = JSON.stringify(state());

    const first = {
      threads: container.threadList('folder-a'),
      records: container.recordList('thread-a'),
      nodes: container.threadRecordNodes('thread-a'),
    };
    const second = {
      threads: container.threadList('folder-a'),
      records: container.recordList('thread-a'),
      nodes: container.threadRecordNodes('thread-a'),
    };

    expect(first).toEqual(second);
    expect(first.threads.map((thread) => thread.id)).toEqual(['thread-a', 'thread-b']);
    expect(first.records.map((record) => record.id)).toEqual(['record-a', 'record-b']);
    expect(JSON.stringify(state())).toBe(before);

    TestBed.resetTestingModule();
  });
});