import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { ExplorerComponent } from './explorer';
import { MutationCommandSender } from '../../transport';
import type {
  FolderProjectionEntity,
  ProjectionSnapshotState,
  RecordProjectionEntity,
  ThreadProjectionEntity,
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
  let projectionStateSignals: {
    folders: ReturnType<typeof signal<FolderProjectionEntity[]>>;
    threads: ReturnType<typeof signal<ThreadProjectionEntity[]>>;
    records: ReturnType<typeof signal<RecordProjectionEntity[]>>;
  };

  const folderEntity = (uuid: string, name: string, parentFolderUuid: string | null = null): FolderProjectionEntity => ({
    entityType: 'folder',
    entityUuid: uuid,
    entityVersion: 1,
    data: {
      uuid,
      name,
      parentFolderUuid,
    },
  });

  const threadEntity = (uuid: string, title: string, folderUuid: string | null): ThreadProjectionEntity => ({
    entityType: 'thread',
    entityUuid: uuid,
    entityVersion: 1,
    data: {
      uuid,
      folderUuid,
      title,
    },
  });

  const recordEntity = (uuid: string, body: string, threadUuid: string): RecordProjectionEntity => ({
    entityType: 'record',
    entityUuid: uuid,
    entityVersion: 1,
    data: {
      uuid,
      threadUuid,
      type: 'text',
      body,
      createdAt: 1,
      editedAt: 1,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
    },
  });

  beforeEach(async () => {
    sendCommand = vi.fn(() => null);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };
    projectionStateSignals = {
      folders: signal<FolderProjectionEntity[]>([]),
      threads: signal<ThreadProjectionEntity[]>([]),
      records: signal<RecordProjectionEntity[]>([]),
    };

    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
      providers: [
        ExplorerActions,
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: { sendCommand } },
        {
          provide: ProjectionStore,
          useValue: {
            getProjectionState: (): ProjectionSnapshotState => ({
              folders: projectionStateSignals.folders().map((folder) => ({
                ...folder,
                data: { ...folder.data },
              })),
              threads: projectionStateSignals.threads().map((thread) => ({
                ...thread,
                data: { ...thread.data },
              })),
              records: projectionStateSignals.records().map((record) => ({
                ...record,
                data: { ...record.data },
              })),
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplorerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function render(): void {
    fixture.detectChanges();
  }

  function getTextValues(selector: string): string[] {
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll(selector))
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim());
  }

  function hashThreadsSnapshot(): string {
    return JSON.stringify(projectionStateSignals.threads());
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

    component.selectFolder('folder-1');
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

    component.selectFolder('folder-1');
    render();

    const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });

  it('explorer_render_folder_tree', () => {
    projectionStateSignals.folders.set([
      folderEntity('uuid-1', 'Vault'),
      folderEntity('uuid-1a', 'Nested', 'uuid-1'),
    ]);

    render();

    expect(getTextValues('[data-testid="folder-item"]')[0]).toContain('Vault');
    expect(getTextValues('[data-testid="folder-item"]')[1]).toContain('Nested');
  });

  it('explorer_thread_list_render', () => {
    projectionStateSignals.folders.set([folderEntity('uuid-1', 'Vault')]);
    projectionStateSignals.threads.set([
      threadEntity('uuid-2', 'Folder Thread', 'uuid-1'),
      threadEntity('uuid-root', 'Root Thread', null),
    ]);

    component.selectFolder('uuid-1');
    render();

    const threadItems = getTextValues('[data-testid="thread-item"]');
    expect(threadItems).toHaveLength(1);
    expect(threadItems[0]).toContain('Folder Thread');
  });

  it('explorer_record_list_render', () => {
    projectionStateSignals.threads.set([threadEntity('uuid-2', 'Thread A', null)]);
    projectionStateSignals.records.set([
      recordEntity('uuid-3', 'Record Body', 'uuid-2'),
      recordEntity('uuid-4', 'Other Record', 'uuid-9'),
    ]);

    component.selectThread('uuid-2');
    render();

    const recordItems = getTextValues('[data-testid="record-item"]');
    expect(recordItems).toHaveLength(1);
    expect(recordItems[0]).toContain('Record Body');
  });

  it('explorer_reactive_update', () => {
    projectionStateSignals.folders.set([folderEntity('uuid-1', 'Vault')]);
    component.selectFolder('uuid-1');
    render();

    projectionStateSignals.threads.set([threadEntity('uuid-2', 'Projected Thread', 'uuid-1')]);
    render();

    expect(getTextValues('[data-testid="thread-item"]')[0]).toContain('Projected Thread');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RERENDER triggered');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER folders=1 threads=1 records=0');
  });

  it('selection_state_isolated', () => {
    projectionStateSignals.folders.set([folderEntity('uuid-1', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('uuid-2', 'Thread A', 'uuid-1')]);

    render();
    component.selectFolder('uuid-1');
    component.selectThread('uuid-2');

    expect(component.selectedFolderId()).toBe('uuid-1');
    expect(component.selectedThreadId()).toBe('uuid-2');
    expect(projectionStateSignals.folders()[0].data.parentFolderUuid).toBeNull();
    expect(projectionStateSignals.threads()[0].data.folderUuid).toBe('uuid-1');
  });

  it('no_projection_mutation_from_ui', () => {
    projectionStateSignals.folders.set([folderEntity('uuid-1', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('uuid-2', 'Thread A', 'uuid-1')]);
    const beforeHash = hashThreadsSnapshot();

    render();
    component.selectFolder('uuid-1');
    component.selectThread('uuid-2');
    render();

    expect(hashThreadsSnapshot()).toBe(beforeHash);
  });

  it('synthetic_root_behavior', () => {
    projectionStateSignals.threads.set([
      threadEntity('uuid-2', 'Root Thread', null),
      threadEntity('uuid-9', 'Nested Thread', 'folder-9'),
    ]);

    render();

    const threadItems = getTextValues('[data-testid="thread-item"]');
    expect(component.selectedFolderId()).toBeNull();
    expect(threadItems).toHaveLength(1);
    expect(threadItems[0]).toContain('Root Thread');
  });

  it('selection_fallback_rules', () => {
    projectionStateSignals.folders.set([folderEntity('uuid-1', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('uuid-2', 'Thread A', 'uuid-1')]);

    render();
    component.selectFolder('uuid-1');
    component.selectThread('uuid-2');
    render();

    projectionStateSignals.folders.set([]);
    projectionStateSignals.threads.set([]);
    render();

    expect(component.selectedFolderId()).toBeNull();
    expect(component.selectedThreadId()).toBeNull();
    expect(consoleLog).toHaveBeenCalledWith('THREAD_REMOVED selection cleared');
  });
});