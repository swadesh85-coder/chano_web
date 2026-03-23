import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { ExplorerComponent } from './explorer';
import { MutationCommandSender } from '../../transport';
import { WebRelayClient } from '../../transport/web-relay-client';
import type {
  Folder,
  ProjectionState,
  ProjectionUpdate,
  RecordEntry,
  Thread,
} from '../projection/projection.models';

describe('ExplorerComponent', () => {
  let fixture: ComponentFixture<ExplorerComponent>;
  let component: ExplorerComponent;
  let sendCommand: ReturnType<typeof vi.fn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let pendingStore: {
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
    setPending: ReturnType<typeof vi.fn>;
  };
  let projectionUpdateSignal: ReturnType<typeof signal<ProjectionUpdate | null>>;
  let projectionStateSignals: {
    folders: ReturnType<typeof signal<Folder[]>>;
    threads: ReturnType<typeof signal<Thread[]>>;
    records: ReturnType<typeof signal<RecordEntry[]>>;
  };

  const folderEntity = (id: string, name: string, parentId: string | null = null): Folder => ({
    id,
    name,
    parentId,
    entityVersion: 1,
  });

  const threadEntity = (id: string, title: string, folderId: string): Thread => ({
    id,
    folderId,
    title,
    entityVersion: 1,
  });

  const recordEntity = (
    id: string,
    name: string,
    threadId: string,
    imageGroupId: string | null = null,
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
    imageGroupId,
    entityVersion: 1,
    lastEventVersion: 1,
  });

  function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }

    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }

    return Object.freeze(value);
  }

  beforeEach(async () => {
    sendCommand = vi.fn(() => null);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };
    projectionUpdateSignal = signal<ProjectionUpdate | null>(null);
    projectionStateSignals = {
      folders: signal<Folder[]>([]),
      threads: signal<Thread[]>([]),
      records: signal<RecordEntry[]>([]),
    };

    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
      providers: [
        ExplorerActions,
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: { sendCommand } },
        {
          provide: WebRelayClient,
          useValue: {
            sessionId: signal('session-explorer-spec').asReadonly(),
          },
        },
        {
          provide: ProjectionStore,
          useValue: {
            state: (): ProjectionState => ({
              folders: projectionStateSignals.folders(),
              threads: projectionStateSignals.threads(),
              records: projectionStateSignals.records(),
            }),
            lastProjectionUpdate: projectionUpdateSignal.asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplorerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function render(): void {
    fixture.detectChanges();
  }

  function getTextValues(selector: string): string[] {
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll(selector))
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim());
  }

  function hashProjectionInputs(): string {
    return JSON.stringify({
      folders: projectionStateSignals.folders(),
      threads: projectionStateSignals.threads(),
      records: projectionStateSignals.records(),
    });
  }

  it('command_sent_on_user_action', () => {
    projectionStateSignals.folders.set([folderEntity('folder-1', 'Inbox')]);

    vi.spyOn(globalThis, 'prompt').mockReturnValue('Inbox Thread');
    sendCommand.mockReturnValue({
      protocolVersion: 2,
      type: 'mutation_command',
      sessionId: 'session-1',
      timestamp: 1,
      sequence: 1,
      payload: {
        commandId: 'cmd-401',
        originDeviceId: 'web-device-1',
        entityType: 'thread',
        entityId: null,
        operation: 'create',
        expectedVersion: 0,
        timestamp: 1,
        payload: {
          title: 'Inbox Thread',
          kind: 'manual',
          folderId: 'folder-1',
        },
      },
    });

    component.handleSelection('folder', 'folder-1');
    render();

    const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
    createButton.click();

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Inbox Thread',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });
  });

  it('ui_disabled_during_pending', () => {
    projectionStateSignals.folders.set([folderEntity('folder-1', 'Inbox')]);
    pendingStore.isCreatePending.mockReturnValue(true);

    component.handleSelection('folder', 'folder-1');
    render();

    const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });

  it('explorer_render_snapshot', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);
    projectionStateSignals.records.set([recordEntity('record:0001', 'Record 0001', 'thread:0001')]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 100 });

    render();
    component.handleSelection('folder', 'folder:0001');
    render();
    expect(getTextValues('[data-testid="thread-item"]')[0]).toContain('Thread 0001');

    component.handleSelection('thread', 'thread:0001');
    render();

    expect(getTextValues('[data-testid="folder-item"]')[0]).toContain('Vault');
    expect(getTextValues('[data-testid="record-item"]')[0]).toContain('Record 0001');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER snapshot_loaded');
    expect(component.folderTree().some((folder) => folder.id === 'folder:0001')).toBe(true);
    expect(component.threadList().some((thread) => thread.id === 'thread:0001')).toBe(true);
    expect(component.recordList().some((record) => record.id === 'record:0001')).toBe(true);
  });

  it('explorer_render_event_update', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 100 });
    render();

    component.handleSelection('folder', 'folder:0001');
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'thread', eventVersion: 101 });
    render();

    expect(getTextValues('[data-testid="thread-item"]')[0]).toContain('Thread 0001');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER event_applied entity=thread');
  });

  it('explorer_no_local_mutation', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);
    projectionStateSignals.records.set([recordEntity('record:0001', 'Record 0001', 'thread:0001')]);
    const beforeHash = hashProjectionInputs();

    render();
    component.handleSelection('folder', 'folder:0001');
    component.handleSelection('thread', 'thread:0001');
    render();

    expect(hashProjectionInputs()).toBe(beforeHash);
  });

  it('explorer_accepts_frozen_projection_input_without_mutation', () => {
    projectionStateSignals.folders.set(deepFreeze([folderEntity('folder:0001', 'Vault')]));
    projectionStateSignals.threads.set(
      deepFreeze([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]),
    );
    projectionStateSignals.records.set(
      deepFreeze([recordEntity('record:0001', 'Record 0001', 'thread:0001')]),
    );

    component.handleSelection('folder', 'folder:0001');
    component.handleSelection('thread', 'thread:0001');

    expect(() => render()).not.toThrow();
    expect(component.folderTree()[0]?.id).toBe('folder:0001');
    expect(component.threadList()[0]?.id).toBe('thread:0001');
    expect(component.recordList()[0]?.id).toBe('record:0001');
  });

  it('explorer_selection_state', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);

    render();
    component.handleSelection('folder', 'folder:0001');
    component.handleSelection('thread', 'thread:0001');

    expect(component.selectedFolderId()).toBe('folder:0001');
    expect(component.selectedThreadId()).toBe('thread:0001');
    expect(component.selectedFolder()?.parentId).toBeNull();
    expect(component.threadList().find((thread) => thread.id === 'thread:0001')).toBeDefined();
  });

  it('explorer_render_is_deterministic_for_same_projection_input', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);
    projectionStateSignals.records.set([recordEntity('record:0001', 'Record 0001', 'thread:0001')]);

    component.handleSelection('folder', 'folder:0001');
    component.handleSelection('thread', 'thread:0001');
    render();
    const firstRender = fixture.nativeElement.querySelector('.explorer-layout')?.textContent?.replace(/\s+/g, ' ').trim();

    render();
    const secondRender = fixture.nativeElement.querySelector('.explorer-layout')?.textContent?.replace(/\s+/g, ' ').trim();

    expect(firstRender).toBe(secondRender);
  });

  it('explorer_projection_sync', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 100 });
    render();

    component.handleSelection('folder', 'folder:0001');
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'thread', eventVersion: 101 });
    render();

    component.handleSelection('thread', 'thread:0001');
    projectionStateSignals.records.set([recordEntity('record:0001', 'Record 0001', 'thread:0001', null, 0)]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'record', eventVersion: 102 });
    render();

    expect(component.threadList()).toHaveLength(1);
    expect(getTextValues('[data-testid="record-item"]')).toHaveLength(1);
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER snapshot_loaded');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER event_applied entity=thread');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER event_applied entity=record');
  });

  it('folder_selection_shows_thread_content_and_thread_selection_shows_record_content', () => {
    projectionStateSignals.folders.set([folderEntity('folder-content', 'Inbox')]);
    projectionStateSignals.threads.set([
      threadEntity('thread-content-a', 'Thread A', 'folder-content'),
      threadEntity('thread-content-b', 'Thread B', 'folder-content'),
    ]);
    projectionStateSignals.records.set([
      recordEntity('record-content-a', 'Record A', 'thread-content-a', null, 0),
    ]);

    component.selectFolder('folder-content');
    render();

    expect(getTextValues('[data-testid="thread-item"]')).toHaveLength(2);
    expect(getTextValues('[data-testid="record-item"]')).toHaveLength(0);

    component.selectThread('thread-content-a');
    render();

    expect(getTextValues('[data-testid="record-item"]')).toHaveLength(1);
    expect(getTextValues('[data-testid="record-item"]')[0]).toContain('Record A');
  });

  it('navigation_state_is_ui_only_and_does_not_mutate_projection', () => {
    projectionStateSignals.folders.set([folderEntity('folder-nav', 'Inbox')]);
    projectionStateSignals.threads.set([threadEntity('thread-nav', 'Thread Nav', 'folder-nav')]);
    projectionStateSignals.records.set([recordEntity('record-nav', 'Record Nav', 'thread-nav')]);
    const before = hashProjectionInputs();

    component.selectFolder('folder-nav');
    component.selectThread('thread-nav');
    component.selectFolder(null);
    render();

    expect(hashProjectionInputs()).toBe(before);
  });
});