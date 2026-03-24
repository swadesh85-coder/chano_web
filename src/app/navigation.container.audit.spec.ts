import fs from 'node:fs';
import path from 'node:path';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { NavigationContainer } from './navigation.container';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type { ProjectionState } from './projection/projection.models';

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

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1, lastEventVersion: 1 },
    ],
    threads: [
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 2, lastEventVersion: 2 },
    ],
    records: [],
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

describe('NavigationContainer audit', () => {
  ensureAngularTestEnvironment();

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps navigation state in the UI boundary without projection or protocol leakage', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/navigation.container.ts'), 'utf8');

    expect(source).toMatch(/ProjectionStateContainer/);
    expect(source).toMatch(/navigationReducer/);
    expect(source).toMatch(/selectResolvedNavigation/);
    expect(source).not.toMatch(/ProjectionStore/);
    expect(source).not.toMatch(/ProjectionEngine/);
    expect(source).not.toMatch(/EventEnvelope/);
    expect(source).not.toMatch(/MutationCommand/);
    expect(source).not.toMatch(/projectionState\.(set|update|mutate)\(/);
    expect(source).not.toMatch(/\.projection\.(set|update|mutate)\(/);
  });

  it('restores navigation deterministically from projection changes without mutating projection state', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));

    TestBed.configureTestingModule({
      providers: [
        NavigationContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
          },
        },
      ],
    });

    const container = TestBed.inject(NavigationContainer);
    const before = JSON.stringify(state());

    container.selectFolder('folder-a');
    container.selectThread('thread-a');

    const first = container.state();
    const second = container.state();

    expect(first).toEqual(second);
    expect(first).toEqual({
      selectedFolderId: 'folder-a',
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    });
    expect(JSON.stringify(state())).toBe(before);

    state.set(deepFreeze({
      folders: [{ id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1, lastEventVersion: 1 }],
      threads: [],
      records: [],
    }));

    expect(container.state()).toEqual({
      selectedFolderId: 'folder-a',
      selectedThreadId: null,
      activePane: 'folder',
    });
  });
});
