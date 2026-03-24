import { TestBed } from '@angular/core/testing';
import { CommandResultHandler } from '../../transport/command-result-handler';
import { MutationCommandSender } from '../../transport/mutation-command-sender';
import { WebDeviceIdentity } from '../../transport/web-device-identity';
import { WebRelayClient } from '../../transport/web-relay-client';
import { PendingCommandStore } from './pending_command_store';
import { ProjectionStateContainer } from '../projection/projection_state.container';
import { RecordEditor } from './record_editor';

describe('RecordEditor', () => {
  let editor: RecordEditor;
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

    TestBed.configureTestingModule({
      providers: [
        RecordEditor,
        MutationCommandSender,
        { provide: PendingCommandStore, useValue: pendingStore },
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

    editor = TestBed.inject(RecordEditor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('record_create_command', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174101');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_001);

    editor.createRecord('thread:0001', 'New record');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174101',
      originDeviceId: 'web-device-1',
      entityType: 'record',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_001,
      payload: {
        threadId: 'thread:0001',
        body: 'New record',
        recordType: 'text',
      },
    });
  });

  it('record_update_command', () => {
    projection.getEntityVersion.mockReturnValue(7);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174102');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_002);

    editor.updateRecord('record:text-1', 'Updated body');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174102',
      originDeviceId: 'web-device-1',
      entityType: 'record',
      entityId: 'record:text-1',
      operation: 'update',
      expectedVersion: 7,
      timestamp: 1_710_000_002,
      payload: {
        body: 'Updated body',
      },
    });
  });

  it('record_rename_command', () => {
    projection.getEntityVersion.mockReturnValue(11);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174103');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_003);

    editor.renameRecord('record:text-1', 'Renamed record');

    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', {
      commandId: '123e4567-e89b-42d3-a456-426614174103',
      originDeviceId: 'web-device-1',
      entityType: 'record',
      entityId: 'record:text-1',
      operation: 'rename',
      expectedVersion: 11,
      timestamp: 1_710_000_003,
      payload: {
        newTitle: 'Renamed record',
      },
    });
  });

  it('expected_version_match', () => {
    projection.getEntityVersion.mockReturnValue(19);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('123e4567-e89b-42d3-a456-426614174104');
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_004);

    editor.updateRecord('record:text-9', 'Versioned update');

    expect(projection.getEntityVersion).toHaveBeenCalledWith('record', 'record:text-9');
    expect(sendEnvelope).toHaveBeenCalledWith('mutation_command', expect.objectContaining({
      expectedVersion: 19,
    }));
  });
});