import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PendingCommandStore } from './pending_command_store';
import { WebRelayClient } from '../../transport';

describe('PendingCommandStore', () => {
  let store: PendingCommandStore;
  let relayHandler: ((envelope: {
    type: string;
    payload: Record<string, unknown>;
  }) => void) | null;

  beforeEach(() => {
    relayHandler = null;

    TestBed.configureTestingModule({
      providers: [
        PendingCommandStore,
        {
          provide: WebRelayClient,
          useValue: {
            onEnvelope: (callback: (envelope: { type: string; payload: Record<string, unknown> }) => void) => {
              relayHandler = callback;
              return () => {
                relayHandler = null;
              };
            },
          },
        },
      ],
    });

    store = TestBed.inject(PendingCommandStore);
  });

  function setPending(commandId = 'cmd-401', entityId: string | null = null): void {
    store.setPending({
      commandId,
      originDeviceId: 'web-device-1',
      entityType: 'thread',
      entityId,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_000,
      payload: {
        title: 'New Thread',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });
  }

  async function checksumFor(payload: Record<string, unknown>): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  it('pending_state_set_on_send', () => {
    setPending();

    expect(store.pendingByCommandId()['cmd-401']).toEqual(expect.objectContaining({
      commandId: 'cmd-401',
      entityId: null,
      operation: 'create',
    }));
    expect(store.isCreatePending('thread')).toBe(true);
  });

  it('no_unlock_on_command_result_only', () => {
    setPending();

    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-401',
        status: 'applied',
        message: 'Accepted',
      },
    });

    expect(store.pendingByCommandId()['cmd-401']).toEqual(expect.objectContaining({
      status: 'acknowledged',
    }));
  });

  it('failed_command_unlock', () => {
    setPending();

    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-401',
        status: 'conflict',
        message: 'Version conflict',
      },
    });

    expect(store.pendingByCommandId()['cmd-401']).toBeUndefined();
    expect(store.isCreatePending('thread')).toBe(false);
  });

  it('forbidden_command_unlock', () => {
    setPending();

    relayHandler?.({
      type: 'command_result',
      payload: {
        commandId: 'cmd-401',
        status: 'forbidden',
        message: 'Access denied',
      },
    });

    expect(store.pendingByCommandId()['cmd-401']).toBeUndefined();
    expect(store.isCreatePending('thread')).toBe(false);
  });

  it('pending_command_resolves_on_event', async () => {
    setPending();

    const eventPayload = {
      uuid: 'generated-by-mobile',
      folderUuid: 'folder-1',
      title: 'New Thread',
    };

    relayHandler?.({
      type: 'event_stream',
      payload: {
        eventId: 'evt-501',
        originDeviceId: 'mobile-1',
        eventVersion: 501,
        entityType: 'thread',
        entityId: 'generated-by-mobile',
        operation: 'create',
        timestamp: 1_710_000_001,
        payload: eventPayload,
        checksum: await checksumFor(eventPayload),
      },
    });

    await vi.waitFor(() => {
      expect(store.pendingByCommandId()['cmd-401']).toBeUndefined();
    });
  });

  it('pending_command_resolves_with_commandId_when_present', async () => {
    setPending('cmd-401');
    setPending('cmd-402');

    const eventPayload = {
      commandId: 'cmd-402',
      uuid: 'generated-by-mobile',
      folderUuid: 'folder-1',
      title: 'New Thread',
    };

    relayHandler?.({
      type: 'event_stream',
      payload: {
        eventId: 'evt-502',
        originDeviceId: 'mobile-1',
        eventVersion: 502,
        entityType: 'thread',
        entityId: 'generated-by-mobile',
        operation: 'create',
        timestamp: 1_710_000_002,
        payload: eventPayload,
        checksum: await checksumFor(eventPayload),
      },
    });

    await vi.waitFor(() => {
      expect(store.pendingByCommandId()['cmd-402']).toBeUndefined();
    });

    expect(store.pendingByCommandId()['cmd-401']).toBeDefined();
  });
});