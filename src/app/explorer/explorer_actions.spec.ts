import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { MutationCommandSender } from '../../transport';

describe('ExplorerActions', () => {
  let actions: ExplorerActions;
  let sendCommand: ReturnType<typeof vi.fn>;
  let pendingStore: {
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
    setPending: ReturnType<typeof vi.fn>;
  };
  let projectionState: {
    readonly folders: ReturnType<typeof signal>;
    readonly threads: ReturnType<typeof signal>;
    readonly records: ReturnType<typeof signal>;
  };

  beforeEach(() => {
    sendCommand = vi.fn(() => null);
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };
    projectionState = {
      folders: signal([{ id: 'folder-1', name: 'Inbox', parentId: null }]),
      threads: signal([{ id: 'thread-1', folderId: 'folder-1', title: 'Daily' }]),
      records: signal([{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Entry', createdAt: 1 }]),
    };

    TestBed.configureTestingModule({
      providers: [
        ExplorerActions,
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: { sendCommand } },
        {
          provide: ProjectionStore,
          useValue: projectionState,
        },
      ],
    });

    actions = TestBed.inject(ExplorerActions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ui_create_thread_command', () => {
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
          title: 'Sprint Planning',
          kind: 'manual',
          folderUuid: 'folder-1',
        },
      },
    });

    actions.onCreateThread('folder-1', 'Sprint Planning');

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Sprint Planning',
        kind: 'manual',
        folderUuid: 'folder-1',
      },
    });
    expect(pendingStore.setPending).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'cmd-401',
      entityId: null,
    }));
  });

  it('ui_rename_command', () => {
    actions.onRenameEntity('thread', 'thread-1', 'Renamed Thread');

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'thread',
      entityId: 'thread-1',
      operation: 'rename',
      payload: {
        newTitle: 'Renamed Thread',
      },
    });
  });

  it('ui_move_command', () => {
    actions.onMoveEntity('record', 'record-1', 'thread-2');

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'record',
      entityId: 'record-1',
      operation: 'move',
      payload: {
        targetThreadUuid: 'thread-2',
      },
    });
  });

  it('ui_soft_delete_command', () => {
    actions.onSoftDelete('thread', 'thread-1');

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'thread',
      entityId: 'thread-1',
      operation: 'softDelete',
      payload: {},
    });
  });

  it('ui_restore_command', () => {
    actions.onRestore('record', 'record-1');

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'record',
      entityId: 'record-1',
      operation: 'restore',
      payload: {},
    });
  });

  it('no_local_state_mutation_ui', () => {
    const beforeState = {
      folders: projectionState.folders(),
      threads: projectionState.threads(),
      records: projectionState.records(),
    };

    actions.onRenameEntity('thread', 'thread-1', 'Awaiting Mobile');

    expect(projectionState.folders()).toEqual(beforeState.folders);
    expect(projectionState.threads()).toEqual(beforeState.threads);
    expect(projectionState.records()).toEqual(beforeState.records);
  });

  it('projection_after_create_event', () => {
    const beforeThreads = projectionState.threads();

    actions.onCreateThread('folder-1', 'Await Event');

    expect(projectionState.threads()).toEqual(beforeThreads);
  });

  it('no_duplicate_command_fire', () => {
    pendingStore.isCreatePending.mockReturnValue(true);

    actions.onCreateThread('folder-1', 'Blocked');

    expect(sendCommand).not.toHaveBeenCalled();
  });
});