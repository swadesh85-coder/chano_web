import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerActions } from './explorer_actions';
import { ExplorerMutationGateway } from './explorer_mutation_gateway';

describe('ExplorerActions', () => {
  let actions: ExplorerActions;
  let gateway: {
    createThread: ReturnType<typeof vi.fn>;
    renameEntity: ReturnType<typeof vi.fn>;
    moveEntity: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
  };
  let projectionState: {
    readonly folders: ReturnType<typeof signal>;
    readonly threads: ReturnType<typeof signal>;
    readonly records: ReturnType<typeof signal>;
  };

  beforeEach(() => {
    gateway = {
      createThread: vi.fn(),
      renameEntity: vi.fn(),
      moveEntity: vi.fn(),
      softDelete: vi.fn(),
      restore: vi.fn(),
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
    };
    projectionState = {
      folders: signal([{ id: 'folder-1', name: 'Inbox', parentId: null }]),
      threads: signal([{ id: 'thread-1', folderId: 'folder-1', title: 'Daily' }]),
      records: signal([{ id: 'record-1', threadId: 'thread-1', type: 'text', name: 'Entry', createdAt: 1 }]),
    };

    const injector = Injector.create({
      providers: [
        { provide: ExplorerMutationGateway, useValue: gateway },
      ],
    });

    actions = runInInjectionContext(injector, () => new ExplorerActions());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ui_create_thread_command', () => {
    actions.onCreateThread('folder-1', 'Sprint Planning');

    expect(gateway.createThread).toHaveBeenCalledWith('folder-1', 'Sprint Planning');
  });

  it('ui_rename_command', () => {
    actions.onRenameEntity('thread', 'thread-1', 'Renamed Thread');

    expect(gateway.renameEntity).toHaveBeenCalledWith('thread', 'thread-1', 'Renamed Thread');
  });

  it('ui_move_command', () => {
    actions.onMoveEntity('record', 'record-1', 'thread-2');

    expect(gateway.moveEntity).toHaveBeenCalledWith('record', 'record-1', 'thread-2');
  });

  it('ui_soft_delete_command', () => {
    actions.onSoftDelete('thread', 'thread-1');

    expect(gateway.softDelete).toHaveBeenCalledWith('thread', 'thread-1');
  });

  it('ui_restore_command', () => {
    actions.onRestore('record', 'record-1');

    expect(gateway.restore).toHaveBeenCalledWith('record', 'record-1');
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
    expect(gateway.renameEntity).toHaveBeenCalledWith('thread', 'thread-1', 'Awaiting Mobile');
  });

  it('projection_after_create_event', () => {
    const beforeThreads = projectionState.threads();

    actions.onCreateThread('folder-1', 'Await Event');

    expect(projectionState.threads()).toEqual(beforeThreads);
    expect(gateway.createThread).toHaveBeenCalledWith('folder-1', 'Await Event');
  });

  it('no_duplicate_command_fire', () => {
    gateway.isCreatePending.mockReturnValue(true);

    actions.onCreateThread('folder-1', 'Blocked');

    expect(gateway.createThread).not.toHaveBeenCalled();
  });
});