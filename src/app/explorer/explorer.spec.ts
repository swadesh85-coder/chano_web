import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { ExplorerComponent } from './explorer';
import { MutationCommandSender } from '../../transport';
import { WebRelayClient } from '../../transport/web-relay-client';
import type {
  FolderProjectionEntity,
  ProjectionSnapshotState,
  ProjectionUpdate,
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
  let projectionUpdateSignal: ReturnType<typeof signal<ProjectionUpdate | null>>;
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

  const recordEntity = (
    uuid: string,
    body: string,
    threadUuid: string,
    imageGroupId: string | null = null,
    orderIndex = 0,
  ): RecordProjectionEntity => ({
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
      orderIndex,
      isStarred: false,
      imageGroupId,
      lastEventVersion: null,
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
    projectionUpdateSignal = signal<ProjectionUpdate | null>(null);
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
          provide: WebRelayClient,
          useValue: {
            sessionId: signal('session-explorer-spec').asReadonly(),
          },
        },
        {
          provide: ProjectionStore,
          useValue: {
            getProjectionState: (): ProjectionSnapshotState => buildProjectionState(
              projectionStateSignals.folders(),
              projectionStateSignals.threads(),
              projectionStateSignals.records(),
            ),
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
  });

  function buildProjectionState(
    folders: readonly FolderProjectionEntity[],
    threads: readonly ThreadProjectionEntity[],
    records: readonly RecordProjectionEntity[],
  ): ProjectionSnapshotState {
    const folderMap = new Map(folders.map((folder) => [folder.entityUuid, cloneFolder(folder)]));
    const threadMap = new Map(threads.map((thread) => [thread.entityUuid, cloneThread(thread)]));
    const recordMap = new Map(records.map((record) => [record.entityUuid, cloneRecord(record)]));
    const imageGroups = new Map<string, readonly RecordProjectionEntity[]>();

    for (const record of recordMap.values()) {
      const imageGroupId = record.data.imageGroupId;
      if (imageGroupId === null) {
        continue;
      }

      const group = imageGroups.get(imageGroupId) ?? [];
      imageGroups.set(imageGroupId, [...group, record]);
    }

    return {
      folders: folderMap,
      threads: threadMap,
      records: recordMap,
      imageGroups,
    };
  }

  function cloneFolder(folder: FolderProjectionEntity): FolderProjectionEntity {
    return {
      ...folder,
      data: { ...folder.data },
    };
  }

  function cloneThread(thread: ThreadProjectionEntity): ThreadProjectionEntity {
    return {
      ...thread,
      data: { ...thread.data },
    };
  }

  function cloneRecord(record: RecordProjectionEntity): RecordProjectionEntity {
    return {
      ...record,
      data: { ...record.data },
    };
  }

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
    component.handleSelection('thread', 'thread:0001');
    render();

    expect(getTextValues('[data-testid="folder-item"]')[0]).toContain('Vault');
    expect(getTextValues('[data-testid="thread-item"]')[0]).toContain('Thread 0001');
    expect(getTextValues('[data-testid="record-item"]')[0]).toContain('Record 0001');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER snapshot_loaded');
    expect(component.projectionState().folders.has('folder:0001')).toBe(true);
    expect(component.projectionState().threads.has('thread:0001')).toBe(true);
    expect(component.projectionState().records.has('record:0001')).toBe(true);
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

  it('explorer_selection_state', () => {
    projectionStateSignals.folders.set([folderEntity('folder:0001', 'Vault')]);
    projectionStateSignals.threads.set([threadEntity('thread:0001', 'Thread 0001', 'folder:0001')]);

    render();
    component.handleSelection('folder', 'folder:0001');
    component.handleSelection('thread', 'thread:0001');

    expect(component.selectedFolderId()).toBe('folder:0001');
    expect(component.selectedThreadId()).toBe('thread:0001');
    expect(component.projectionState().folders.get('folder:0001')?.data.parentFolderUuid).toBeNull();
    expect(component.projectionState().threads.get('thread:0001')?.data.folderUuid).toBe('folder:0001');
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

    expect(getTextValues('[data-testid="thread-item"]')).toHaveLength(1);
    expect(getTextValues('[data-testid="record-item"]')).toHaveLength(1);
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER snapshot_loaded');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER event_applied entity=thread');
    expect(consoleLog).toHaveBeenCalledWith('EXPLORER_RENDER event_applied entity=record');
  });
});