import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandResultHandler } from '../../transport/command-result-handler';
import { MutationCommandSender } from '../../transport/mutation-command-sender';
import { PendingCommandStore } from '../../transport/pending-command-store';
import { WebDeviceIdentity } from '../../transport/web-device-identity';
import { WebRelayClient } from '../../transport/web-relay-client';
import { ProjectionStateContainer } from '../projection/projection_state.container';
import { ExplorerMutationGateway } from './explorer_mutation_gateway';

describe('ExplorerMutationGateway', () => {
  let gateway: ExplorerMutationGateway;
  let sendEnvelope: ReturnType<typeof vi.fn>;
  let projection: {
    getEntityVersion: ReturnType<typeof vi.fn>;
  };
  let pendingStore: {
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
    setPending: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sendEnvelope = vi.fn((type: string, payload: Record<string, unknown>) => ({
      protocolVersion: 2 as const,
      type,
      sessionId: 'session-1',
      timestamp: 1_710_000_000,
      sequence: 21,
      payload,
    }));
    projection = {
      getEntityVersion: vi.fn(),
    };
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };

    const senderInjector = Injector.create({
      providers: [
        { provide: ProjectionStateContainer, useValue: projection },
        { provide: CommandResultHandler, useValue: {} },
        { provide: WebDeviceIdentity, useValue: { deviceId: 'web-device-1' } },
        {
          provide: WebRelayClient,
          useValue: {
            sendEnvelope,
          },
        },
      ],
    });

    const sender = runInInjectionContext(senderInjector, () => new MutationCommandSender());

    const injector = Injector.create({
      providers: [
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: sender },
      ],
    });

    gateway = runInInjectionContext(injector, () => new ExplorerMutationGateway());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('thread_create_command', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174401');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_001);

    gateway.createThread('folder-1', 'Sprint Planning');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174401',
      originDeviceId: 'web-device-1',
      entityType: 'thread',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_001,
      payload: {
        title: 'Sprint Planning',
        kind: 'manual',
        folderUuid: 'folder-1',
      },
    });
    expect(pendingStore.setPending).toHaveBeenCalledWith(expect.objectContaining({
      commandId: '123e4567-e89b-42d3-a456-426614174401',
      entityType: 'thread',
      operation: 'create',
    }));
  });

  it('record_create_command', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174101');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_002);

    gateway.createRecord('thread:0001', 'New record');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174101',
      originDeviceId: 'web-device-1',
      entityType: 'record',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_002,
      payload: {
        threadUuid: 'thread:0001',
        body: 'New record',
        recordType: 'text',
      },
    });
  });

  it('record_update_command_uses_projection_version', () => {
    projection.getEntityVersion.mockReturnValue(12);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174102');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_003);

    gateway.updateRecord('record:text-9', 'Versioned update');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174102',
      originDeviceId: 'web-device-1',
      entityType: 'record',
      entityId: 'record:text-9',
      operation: 'update',
      expectedVersion: 12,
      timestamp: 1_710_000_003,
      payload: {
        body: 'Versioned update',
      },
    });
  });

  it('thread_and_record_moves_use_canonical_targets', () => {
    projection.getEntityVersion.mockReturnValue(4);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174103')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174104');
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_710_000_004)
      .mockReturnValueOnce(1_710_000_005);

    gateway.moveEntity('thread', 'thread-1', 'folder-2');
    gateway.moveEntity('record', 'record-1', 'thread-2');

    expect(sendEnvelope).toHaveBeenNthCalledWith(1, 'mutation_command', expect.objectContaining({
      entityType: 'thread',
      entityId: 'thread-1',
      operation: 'move',
      payload: { targetFolderUuid: 'folder-2' },
    }));
    expect(sendEnvelope).toHaveBeenNthCalledWith(2, 'mutation_command', expect.objectContaining({
      entityType: 'record',
      entityId: 'record-1',
      operation: 'move',
      payload: { targetThreadUuid: 'thread-2' },
    }));
  });
});