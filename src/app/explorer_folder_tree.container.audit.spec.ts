import fs from 'node:fs';
import path from 'node:path';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ExplorerFolderTreeContainer } from './explorer_folder_tree.container';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type {
  ProjectionState,
  ProjectionUpdate,
} from './projection/projection.models';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-root', name: 'Root', parentId: null, entityVersion: 2 },
      { id: 'folder-a', name: 'Folder A', parentId: 'folder-root', entityVersion: 3 },
      { id: 'folder-b', name: 'Folder B', parentId: 'folder-root', entityVersion: 4 },
    ],
    threads: [],
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

describe('ExplorerFolderTreeContainer audit', () => {
  it('keeps folder tree access inside the container boundary', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer_folder_tree.container.ts'), 'utf8');

    expect(source).toMatch(/ProjectionStateContainer/);
    expect(source).toMatch(/selectFolders/);
    expect(source).toMatch(/buildFolderTreeViewModel/);
    expect(source).toMatch(/findFolderTreeViewModelById/);
    expect(source).not.toMatch(/ProjectionStore/);
    expect(source).not.toMatch(/ProjectionEngine/);
    expect(source).not.toMatch(/signal\(/);
  });

  it('derives deterministic recursive folder trees without state duplication', () => {
    const state = signal<ProjectionState>(deepFreeze(createProjectionState()));
    const projectionUpdate = signal<ProjectionUpdate | null>(null);

    TestBed.configureTestingModule({
      providers: [
        ExplorerFolderTreeContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed(() => state()),
            projectionUpdate: projectionUpdate.asReadonly(),
          },
        },
      ],
    });

    const container = TestBed.inject(ExplorerFolderTreeContainer);
    const firstTree = container.folderTree();
    const secondTree = container.folderTree();

    expect(firstTree).toEqual(secondTree);
    expect(firstTree[0]?.id).toBe('folder-root');
    expect(firstTree[0]?.children.map((node) => node.id)).toEqual(['folder-a', 'folder-b']);
    expect(container.findFolder('folder-b')?.id).toBe('folder-b');
    expect(container.hasFolder('missing-folder')).toBe(false);

    TestBed.resetTestingModule();
  });
});