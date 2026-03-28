import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Subject } from 'rxjs';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { WebRelayClient } from '../../transport/web-relay-client';
import { ProjectionEngine } from './projection_engine';
import { validateEventEnvelope, validateStartBoundary } from './projection_event_validation';
import { ProjectionStore } from './projection.store';

let angularTestEnvironmentInitialized = false;

function ensureAngularTestEnvironment(): void {
  if (angularTestEnvironmentInitialized) {
    return;
  }

  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cannot set base providers because it has already been called')) {
      throw error;
    }
  }

  angularTestEnvironmentInitialized = true;
}

function createEventPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'uuid-1',
    threadUuid: 'thread-1',
    type: 'text',
    body: 'Body',
    createdAt: 1710000000,
    editedAt: 1710000000,
    orderIndex: 0,
    isStarred: false,
    imageGroupId: null,
    ...overrides,
  };
}

async function sha256PayloadHex(payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function createEnvelope(
  payloadOverrides: Record<string, unknown> = {},
  envelopeOverrides: Partial<TransportEnvelope> = {},
): Promise<TransportEnvelope> {
  const payloadOverride = payloadOverrides['payload'] as Record<string, unknown> | undefined;
  const eventPayload = payloadOverride === undefined ? createEventPayload() : payloadOverride;
  const payload = {
    eventId: 300,
    originDeviceId: 'mobile-1',
    eventVersion: 300,
    entityType: 'record',
    entityId: 'uuid-1',
    operation: 'create',
    timestamp: '2026-03-27T00:00:00.000Z',
    payload: eventPayload,
    checksum: await sha256PayloadHex(eventPayload),
    ...payloadOverrides,
  };

  return {
    protocolVersion: 2,
    type: 'event_stream',
    sessionId: 'session-1',
    timestamp: 1710000000,
    sequence: 10,
    payload,
    ...envelopeOverrides,
  };
}

async function flushAsyncEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('EventValidation', () => {
  it('event_validation_valid_event', async () => {
    const envelope = await createEnvelope();

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
    if (result.status === 'VALID') {
      expect(result.eventEnvelope.eventId).toBe(300);
      expect(result.eventEnvelope.eventVersion).toBe(300);
      expect(result.eventEnvelope.payload).toEqual({
        id: 'uuid-1',
        threadId: 'thread-1',
        type: 'text',
        name: 'Body',
        createdAt: 1710000000,
        editedAt: 1710000000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      });
    }
  });

  it('event_validation_accepts_string_event_ids_and_numeric_event_timestamps', async () => {
    const envelope = await createEnvelope({
      eventId: 'evt-300',
      timestamp: 1710000000,
    });

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
    if (result.status === 'VALID') {
      expect(result.eventEnvelope.eventId).toBe('evt-300');
      expect(result.eventEnvelope.timestamp).toBe(1710000000);
    }
  });

  it('event_validation_accepts_already_canonical_record_payloads', async () => {
    const envelope = await createEnvelope({
      payload: {
        id: 'uuid-1',
        threadId: 'thread-1',
        type: 'text',
        name: 'Body',
        createdAt: 1710000000,
        editedAt: 1710000000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      },
    });

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
    if (result.status === 'VALID') {
      expect(result.eventEnvelope.payload).toEqual(envelope.payload['payload']);
    }
  });

  it('event_validation_strips_legacy_record_transport_fields_and_injects_entity_id', async () => {
    const envelope = await createEnvelope({
      operation: 'update',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Body',
        orderIndex: 0,
        imageGroupId: null,
        deviceId: 'mobile-1',
        ownerUserId: 'owner-1',
        fieldName: 'body',
        spans: [],
        text: 'Body',
      },
    });

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
    if (result.status === 'VALID') {
      expect(result.eventEnvelope.payload).toEqual({
        id: 'uuid-1',
        threadId: 'thread-1',
        type: 'text',
        name: 'Body',
        orderIndex: 0,
        imageGroupId: null,
      });
    }
  });

  it('event_validation_canonicalizes_legacy_thread_transport_payloads', async () => {
    const envelope = await createEnvelope({
      entityType: 'thread',
      entityId: 'thread-2',
      payload: {
        folderUuid: 'folder-1',
        title: 'Backlog',
        contactId: 'contact-1',
        createdAt: 1710000000,
        deviceId: 'mobile-1',
        entityVersion: 77,
        fieldName: 'title',
        hasStarred: false,
        isEmptyDraft: false,
        isPrivate: false,
        kind: 'direct',
        lastUpdated: 1710000001,
        ownerUserId: 'owner-1',
      },
    });

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
    if (result.status === 'VALID') {
      expect(result.eventEnvelope.payload).toEqual({
        id: 'thread-2',
        folderId: 'folder-1',
        title: 'Backlog',
      });
    }
  });

  it('event_validation_rejects_conflicting_alias_and_canonical_record_fields', async () => {
    const envelope = await createEnvelope({
      payload: {
        uuid: 'uuid-1',
        id: 'uuid-2',
        threadUuid: 'thread-1',
        body: 'Body',
        type: 'text',
        createdAt: 1710000000,
        editedAt: 1710000000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      },
    });

    const result = await validateEventEnvelope(envelope);

    expect(result).toEqual({
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    });
  });

  it('event_validation_rejects_incomplete_record_payload_after_normalization', async () => {
    const envelope = await createEnvelope({
      payload: {
        uuid: 'uuid-1',
        type: 'text',
        body: 'Body',
        createdAt: 1710000000,
        editedAt: 1710000000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      },
    });

    const result = await validateEventEnvelope(envelope);

    expect(result).toEqual({
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    });
  });

  it('event_validation_invalid_schema', async () => {
    const envelope = await createEnvelope({ entityType: 'widget' });

    const result = await validateEventEnvelope(envelope);

    expect(result).toEqual({
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    });
  });

  it('event_validation_checksum_failure', async () => {
    const envelope = await createEnvelope({ checksum: 'deadbeef' });

    const result = await validateEventEnvelope(envelope);

    expect(result).toEqual({
      status: 'INVALID',
      reason: 'CHECKSUM_MISMATCH',
    });
  });

  it('event_validation_reject_missing_fields', async () => {
    const envelope = await createEnvelope();
    const invalidEnvelope: TransportEnvelope = {
      ...envelope,
      payload: {
        ...envelope.payload,
        eventId: undefined,
      },
    };

    const result = await validateEventEnvelope(invalidEnvelope);

    expect(result).toEqual({
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    });
  });

  it('event_validation_ignores_unknown_fields', async () => {
    const envelope = await createEnvelope({ extraField: 'accepted' });

    const result = await validateEventEnvelope(envelope);

    expect(result.status).toBe('VALID');
  });

  it('event_validation_forward_only_valid_events', async () => {
    ensureAngularTestEnvironment();
    const messages$ = new Subject<TransportEnvelope>();
    const onEventSpy = vi.spyOn(ProjectionEngine.prototype, 'onEvent');

    TestBed.configureTestingModule({
      providers: [
        ProjectionStore,
        {
          provide: WebRelayClient,
          useValue: {
            onProjectionMessage: (handler: (envelope: TransportEnvelope) => void) => {
              const subscription = messages$.subscribe(handler);
              return () => subscription.unsubscribe();
            },
          },
        },
      ],
    });

    TestBed.inject(ProjectionStore);

    messages$.next(await createEnvelope());
    messages$.next(await createEnvelope({ checksum: 'deadbeef' }, { sequence: 11 }));

    await flushAsyncEvents();

    expect(onEventSpy).toHaveBeenCalledTimes(1);
    expect(onEventSpy).toHaveBeenCalledWith(expect.objectContaining({ eventVersion: 300 }));

    onEventSpy.mockRestore();
    messages$.complete();
  });

  it('validate_start_boundary_returns_expected_versions', async () => {
    const envelope = await createEnvelope({ eventVersion: 101 });
    const validationResult = await validateEventEnvelope(envelope);

    expect(validationResult.status).toBe('VALID');
    if (validationResult.status !== 'VALID') {
      return;
    }

    const boundaryResult = validateStartBoundary(100, validationResult.eventEnvelope);

    expect(boundaryResult).toEqual({
      status: 'VALID',
      expectedEventVersion: 101,
      receivedEventVersion: 101,
    });
  });
});