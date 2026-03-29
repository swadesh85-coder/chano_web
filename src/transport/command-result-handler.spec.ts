import { TestBed } from '@angular/core/testing';
import { CommandResultHandler } from './command-result-handler';
import { WebRelayClient } from './web-relay-client';

describe('CommandResultHandler', () => {
  let handler: CommandResultHandler;
  let relayHandler: ((envelope: {
    type: string;
    payload: Record<string, unknown>;
  }) => void) | null;

  beforeEach(() => {
    relayHandler = null;

    TestBed.configureTestingModule({
      providers: [
        CommandResultHandler,
        {
          provide: WebRelayClient,
          useValue: {
            onCommandResultMessage: (callback: (envelope: { type: string; payload: Record<string, unknown> }) => void) => {
              relayHandler = callback;
              return () => {
                relayHandler = null;
              };
            },
          },
        },
      ],
    });

    handler = TestBed.inject(CommandResultHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('command_result_handling', () => {
    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-123',
        status: 'conflict',
        message: 'Expected version mismatch',
        entityType: 'thread',
        entityId: 'thread-123',
        operation: 'rename',
        expectedVersion: 7,
      },
    });

    expect(handler.getResult('cmd-123')).toEqual({
      commandId: 'cmd-123',
      status: 'conflict',
      message: 'Expected version mismatch',
      entityType: 'thread',
      entityId: 'thread-123',
      operation: 'rename',
      expectedVersion: 7,
    });
    expect(handler.getStatus('cmd-123')).toBe('conflict');
  });

  it('accepts_success_result_without_message', () => {
    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-124',
        status: 'applied',
        entityType: 'record',
        entityId: 'record-1',
        operation: 'create',
        eventVersion: 12,
        entityVersion: 1,
      },
    });

    expect(handler.getResult('cmd-124')).toEqual({
      commandId: 'cmd-124',
      status: 'applied',
      entityType: 'record',
      entityId: 'record-1',
      operation: 'create',
      eventVersion: 12,
      entityVersion: 1,
    });
  });

  it('duplicate_command_idempotency', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const resultEnvelope = {
      type: 'command_result',
      payload: {
        commandId: 'cmd-123',
        status: 'alreadyApplied',
        message: 'Duplicate command ignored',
      },
    };

    relayHandler?.(resultEnvelope);
    relayHandler?.(resultEnvelope);

    expect(handler.results()).toEqual({
      'cmd-123': {
        commandId: 'cmd-123',
        status: 'alreadyApplied',
        message: 'Duplicate command ignored',
      },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('forbidden_command_result_handling', () => {
    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-403',
        status: 'forbidden',
        message: 'Access denied',
      },
    });

    expect(handler.getResult('cmd-403')).toEqual({
      commandId: 'cmd-403',
      status: 'forbidden',
      message: 'Access denied',
    });
    expect(handler.getStatus('cmd-403')).toBe('forbidden');
  });
});