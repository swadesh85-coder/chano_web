// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAngularTestEnvironment } from '../../testing/ensure-angular-test-environment';
import { ExplorerContentPaneContainer } from '../explorer_content_pane.container';
import { ExplorerFolderTreeContainer } from '../explorer_folder_tree.container';
import { ExplorerLayoutContainerComponent } from '../explorer.layout.container';
import { NavigationContainer } from '../navigation.container';
import { ProjectionStateContainer } from '../projection/projection_state.container';
import type {
  Folder,
  ProjectionState,
  ProjectionUpdate,
  RecordEntry,
  Thread,
} from '../projection/projection.models';

describe('Explorer layout contract', () => {
  let localStorageGetItem: ReturnType<typeof vi.fn>;
  let localStorageSetItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ensureAngularTestEnvironment();
    localStorageGetItem = vi.fn(() => null);
    localStorageSetItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: localStorageGetItem,
      setItem: localStorageSetItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
  });

  const folderEntity = (id: string, name: string, parentId: string | null = null): Folder => ({
    id,
    name,
    parentId,
    entityVersion: 1,
    lastEventVersion: 1,
  });

  const threadEntity = (id: string, title: string, folderId: string): Thread => ({
    id,
    folderId,
    title,
    entityVersion: 1,
    lastEventVersion: 1,
  });

  const recordEntity = (
    id: string,
    name: string,
    threadId: string,
    orderIndex = 0,
  ): RecordEntry => ({
    id,
    threadId,
    type: 'text',
    name,
    createdAt: 1,
    editedAt: 1,
    orderIndex,
    isStarred: false,
    imageGroupId: null,
    entityVersion: 1,
    lastEventVersion: 1,
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function createLayoutFixture(): Promise<ComponentFixture<ExplorerLayoutContainerComponent>> {
    ensureAngularTestEnvironment();

    TestBed.overrideComponent(ExplorerLayoutContainerComponent, {
      set: {
        template: '',
        styles: [],
      },
    });

    TestBed.configureTestingModule({
      imports: [ExplorerLayoutContainerComponent],
    });

    await TestBed.compileComponents();

    return TestBed.createComponent(ExplorerLayoutContainerComponent);
  }

  function projectionHash(state: {
    folders: ReturnType<typeof signal<Folder[]>>;
    threads: ReturnType<typeof signal<Thread[]>>;
    records: ReturnType<typeof signal<RecordEntry[]>>;
  }): string {
    return JSON.stringify({
      folders: state.folders(),
      threads: state.threads(),
      records: state.records(),
    });
  }

  it('declares_toolbar_split_and_both_panes_in_layout_source', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer.layout.container.ts'), 'utf8');
    const template = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer.layout.html'), 'utf8');

    expect(template).toContain('app-explorer-toolbar');
    expect(template).toContain('app-split-pane');
    expect(template).toContain('app-folder-tree-pane');
    expect(template).toContain('app-explorer-content-pane');
    expect(source).toContain('LAYOUT_INIT ratio=');
    expect(source).toContain('LAYOUT_PERSIST_LOAD ratio=');
    expect(source).toContain('LAYOUT_PERSIST_SAVE ratio=');
    expect(source).toContain('DEFAULT_SPLIT_RATIO');
    expect(source).toContain('chano.layout.splitRatio');
    expect(source).not.toContain('NavigationContainer');
    expect(source).not.toContain('ProjectionStateContainer');
  });

  it('uses_navigation_selection_to_switch_folder_and_thread_content_without_projection_mutation', () => {
    ensureAngularTestEnvironment();
    const projectionStateSignals = {
      folders: signal<Folder[]>([
        folderEntity('folder-root', 'Root'),
        folderEntity('folder-child', 'Child', 'folder-root'),
      ]),
      threads: signal<Thread[]>([
        threadEntity('thread-a', 'Thread A', 'folder-root'),
        threadEntity('thread-b', 'Thread B', 'folder-root'),
      ]),
      records: signal<RecordEntry[]>([
        recordEntity('record-a', 'Record A', 'thread-a', 0),
      ]),
    };
    const projectionUpdate = signal<ProjectionUpdate | null>(null);

    TestBed.configureTestingModule({
      providers: [
        NavigationContainer,
        ExplorerFolderTreeContainer,
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed<ProjectionState>(() => ({
              folders: projectionStateSignals.folders(),
              threads: projectionStateSignals.threads(),
              records: projectionStateSignals.records(),
            })),
            projectionUpdate: projectionUpdate.asReadonly(),
            phase: signal<'idle' | 'receiving' | 'ready'>('ready').asReadonly(),
          },
        },
      ],
    });

    const navigation = TestBed.inject(NavigationContainer);
    const folderTree = TestBed.inject(ExplorerFolderTreeContainer);
    const contentPane = TestBed.inject(ExplorerContentPaneContainer);
    const before = projectionHash(projectionStateSignals);

    navigation.selectFolder('folder-root');
    const folderMode = contentPane.contentPane(
      navigation.selectedFolderId(),
      navigation.selectedThreadId(),
      navigation.activePane(),
    );

    expect(navigation.activePane()).toBe('folder');
    expect(folderTree.folderTree()[0]?.id).toBe('folder-root');
    expect(folderMode.mode).toBe('threads');
    expect(folderMode.threadList.map((thread) => thread.id)).toEqual(['thread-a', 'thread-b']);

    navigation.selectThread('thread-a');
    const threadMode = contentPane.contentPane(
      navigation.selectedFolderId(),
      navigation.selectedThreadId(),
      navigation.activePane(),
    );

    expect(navigation.activePane()).toBe('thread');
    expect(threadMode.mode).toBe('records');
    expect(contentPane.recordList('thread-a').map((record) => record.id)).toEqual(['record-a']);
    expect(projectionHash(projectionStateSignals)).toBe(before);
  });

  it('produces_identical_viewmodel_outputs_for_the_same_state', () => {
    ensureAngularTestEnvironment();
    const projectionStateSignals = {
      folders: signal<Folder[]>([folderEntity('folder-root', 'Root')]),
      threads: signal<Thread[]>([threadEntity('thread-a', 'Thread A', 'folder-root')]),
      records: signal<RecordEntry[]>([recordEntity('record-a', 'Record A', 'thread-a')]),
    };

    TestBed.configureTestingModule({
      providers: [
        NavigationContainer,
        ExplorerFolderTreeContainer,
        ExplorerContentPaneContainer,
        {
          provide: ProjectionStateContainer,
          useValue: {
            state: computed<ProjectionState>(() => ({
              folders: projectionStateSignals.folders(),
              threads: projectionStateSignals.threads(),
              records: projectionStateSignals.records(),
            })),
            projectionUpdate: signal<ProjectionUpdate | null>(null).asReadonly(),
            phase: signal<'idle' | 'receiving' | 'ready'>('ready').asReadonly(),
          },
        },
      ],
    });

    const navigation = TestBed.inject(NavigationContainer);
    const folderTree = TestBed.inject(ExplorerFolderTreeContainer);
    const contentPane = TestBed.inject(ExplorerContentPaneContainer);

    navigation.selectFolder('folder-root');
    navigation.selectThread('thread-a');

    const first = {
      tree: folderTree.folderTree(),
      content: contentPane.contentPane(
        navigation.selectedFolderId(),
        navigation.selectedThreadId(),
        navigation.activePane(),
      ),
    };
    const second = {
      tree: folderTree.folderTree(),
      content: contentPane.contentPane(
        navigation.selectedFolderId(),
        navigation.selectedThreadId(),
        navigation.activePane(),
      ),
    };

    expect(first).toEqual(second);
  });

  it('loads_a_valid_persisted_split_ratio_on_init', async () => {
    localStorageGetItem.mockReturnValue('0.420');

    const fixture = await createLayoutFixture();
    const component = fixture.componentInstance;

    expect(component.splitRatio()).toBe(0.42);
    expect(localStorageGetItem).toHaveBeenCalledWith('chano.layout.splitRatio');
  });

  it('falls_back_to_default_when_persisted_split_ratio_is_invalid', async () => {
    localStorageGetItem.mockReturnValue('0.91');

    const fixture = await createLayoutFixture();
    const component = fixture.componentInstance;

    expect(component.splitRatio()).toBe(0.3);
  });

  it('persists_split_ratio_with_debounce_without_affecting_navigation_selection', async () => {
    vi.useFakeTimers();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fixture = await createLayoutFixture();
    const component = fixture.componentInstance;
    const selectedFolderId = signal<string | null>('folder-root');
    const selectedThreadId = signal<string | null>('thread-a');

    fixture.componentRef.setInput('selectedFolderId', selectedFolderId());
    fixture.componentRef.setInput('selectedThreadId', selectedThreadId());

    component.updateSplitRatio(0.44);
    component.updateSplitRatio(0.46);

    expect(localStorageSetItem).not.toHaveBeenCalled();
    expect(selectedFolderId()).toBe('folder-root');
    expect(selectedThreadId()).toBe('thread-a');

    vi.advanceTimersByTime(150);

    expect(localStorageSetItem).toHaveBeenCalledTimes(1);
    expect(localStorageSetItem).toHaveBeenLastCalledWith('chano.layout.splitRatio', '0.460');
    expect(consoleLog).toHaveBeenCalledWith('LAYOUT_PERSIST_SAVE ratio=0.460');
    consoleLog.mockRestore();
  });
});