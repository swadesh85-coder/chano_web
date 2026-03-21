import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { WebRelayClient } from '../../transport/web-relay-client';
import { ProjectionEngine } from './projection_engine';
import { validateEventEnvelope, validateStartBoundary } from './projection_event_validation';
import { ProjectionStore } from './projection.store';

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
  const eventPayload = createEventPayload(payloadOverrides['payload'] as Record<string, unknown> | undefined);
  const payload = {
    eventId: 'evt-300',
    originDeviceId: 'mobile-1',
    eventVersion: 300,
    entityType: 'record',
    entityId: 'uuid-1',
    operation: 'create',
    timestamp: 1710000000,
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
      expect(result.eventEnvelope.eventVersion).toBe(300);
      expect(result.eventEnvelope.payload).toEqual(envelope.payload['payload']);
    }
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

  it('event_validation_forward_only_valid_events', async () => {
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