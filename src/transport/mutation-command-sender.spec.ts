import { TestBed } from '@angular/core/testing';
import { ProjectionStore } from '../app/projection/projection.store';
import { CommandResultHandler } from './command-result-handler';
import { MutationCommandSender } from './mutation-command-sender';
import { WebDeviceIdentity } from './web-device-identity';
import { WebRelayClient } from './web-relay-client';

describe('MutationCommandSender', () => {
  let sender: MutationCommandSender;
  let sendEnvelope: ReturnType<typeof vi.fn>;
  let projection: {
    getEntityVersion: ReturnType<typeof vi.fn>;
    hasEntityId: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sendEnvelope = vi.fn((type: string, payload: Record<string, unknown>) => ({
      protocolVersion: 2 as const,
      type,
      sessionId: 'session-1',
      timestamp: 1_710_000_000,
      sequence: 12,
      payload,
    }));
    projection = {
      getEntityVersion: vi.fn(),
      hasEntityId: vi.fn(() => false),
    };

    TestBed.configureTestingModule({
      providers: [
        MutationCommandSender,
        { provide: ProjectionStore, useValue: projection },
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

    sender = TestBed.inject(MutationCommandSender);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mutation_command_send', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174001');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const envelope = sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'New Thread',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174001',
      originDeviceId: 'web-device-1',
      entityType: 'thread',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_000,
      payload: {
        title: 'New Thread',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });
    expect(sendEnvelope).toHaveBeenCalledTimes(1);
    expect(envelope).toEqual({
      protocolVersion: 2,
      type: 'mutation_command',
      sessionId: 'session-1',
      timestamp: 1_710_000_000,
      sequence: 12,
      payload: {
        commandId: '123e4567-e89b-42d3-a456-426614174001',
        originDeviceId: 'web-device-1',
        entityType: 'thread',
        entityId: null,
        operation: 'create',
        expectedVersion: 0,
        timestamp: 1_710_000_000,
        payload: {
          title: 'New Thread',
          kind: 'manual',
          folderId: 'folder-1',
        },
      },
    });
  });

  it('mutation_command_schema_valid', () => {
    expect(() => sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'New Thread',
        kind: 'manual',
        folderId: 'folder-1',
        uuid: 'forbidden-local-id',
      },
    })).toThrowError('INVALID_MUTATION_COMMAND_SCHEMA');

    expect(sendEnvelope).not.toHaveBeenCalled();
  });

  it('create_command_without_entityId', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174011');

    sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Generated Thread',
        kind: 'manual',
        folderId: 'uuid-folder-1',
      },
    });

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', expect.objectContaining({
      entityId: null,
      expectedVersion: 0,
    }));
  });

  it('no_web_entityId_generation', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174022');

    sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Collision Retry',
        kind: 'manual',
        folderId: 'uuid-folder-1',
      },
    });

    expect(projection.hasEntityId).not.toHaveBeenCalled();
    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', expect.objectContaining({
      entityId: null,
      commandId: '123e4567-e89b-42d3-a456-426614174022',
    }));
  });

  it('create_command_accepts_explicit_null_entityId', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174031');

    sender.sendCommand({
      entityType: 'thread',
      entityId: null,
      operation: 'create',
      payload: {
        title: 'No Reuse',
        kind: 'manual',
        folderId: 'uuid-folder-1',
      },
    });

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', expect.objectContaining({
      entityId: null,
      payload: expect.objectContaining({
        folderId: 'uuid-folder-1',
      }),
    }));
  });

  it('record_create_command_accepts_minimal_ui_payload', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174041');

    sender.sendCommand({
      entityType: 'record',
      operation: 'create',
      payload: {
        threadId: 'thread:0001',
        body: 'New record',
        recordType: 'text',
      },
    });

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', expect.objectContaining({
      entityType: 'record',
      entityId: null,
      expectedVersion: 0,
      payload: {
        threadId: 'thread:0001',
        body: 'New record',
        recordType: 'text',
      },
    }));
  });
});