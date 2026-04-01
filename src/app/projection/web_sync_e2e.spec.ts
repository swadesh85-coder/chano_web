// @vitest-environment jsdom

import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAngularTestEnvironment } from '../../testing/ensure-angular-test-environment';
import { ProjectionStore } from './projection.store';
import { WebRelayClient } from '../../transport/web-relay-client';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static last: MockWebSocket;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(envelope: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

function hasSingleArgCall(spy: ReturnType<typeof vi.spyOn>, message: string): boolean {
  return spy.mock.calls.some((call: readonly unknown[]) => call.length > 0 && call[0] === message);
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }

  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;

  if (!bufferCtor) {
    throw new Error('No base64 encoder available');
  }

  return bufferCtor.from(bytes).toString('base64');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function createCanonicalSnapshotJson(baseEventVersion: number): string {
  return JSON.stringify({
    snapshotVersion: 2,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion,
    generatedAt: '2026-03-27T09:54:00.000Z',
    checksum: 'canonical-root-checksum',
    entityCount: 3,
    entities: [
      {
        entityType: 'folder',
        entityUuid: 'f1',
        entityVersion: 1,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: { uuid: 'f1', name: 'Work', parentFolderUuid: null },
      },
      {
        entityType: 'thread',
        entityUuid: 't1',
        entityVersion: 1,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: { uuid: 't1', folderUuid: 'f1', title: 'Log' },
      },
      {
        entityType: 'record',
        entityUuid: 'r1',
        entityVersion: 1,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'r1',
          threadUuid: 't1',
          type: 'text',
          body: 'Entry',
          createdAt: Date.parse('2026-03-27T09:54:10.000Z'),
          editedAt: Date.parse('2026-03-27T09:54:10.000Z'),
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

async function createSnapshotTransport(
  sessionId: string,
  baseEventVersion: number,
): Promise<{
  readonly start: Record<string, unknown>;
  readonly chunk: Record<string, unknown>;
  readonly complete: Record<string, unknown>;
  readonly derivedSnapshotId: string;
}> {
  const snapshotJson = createCanonicalSnapshotJson(baseEventVersion);
  const bytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(bytes);
  const derivedSnapshotId = `base-${baseEventVersion}-sha-${checksum.slice(0, 12)}`;

  return {
    start: {
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId,
      timestamp: Date.parse('2026-03-27T09:54:10.000Z'),
      sequence: 1,
      payload: {
        totalChunks: 1,
        totalBytes: bytes.byteLength,
        snapshotVersion: 2,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion,
        entityCount: 3,
        checksum,
      },
    },
    chunk: {
      protocolVersion: 2,
      type: 'snapshot_chunk',
      sessionId,
      timestamp: Date.parse('2026-03-27T09:54:11.000Z'),
      sequence: 2,
      payload: {
        index: 0,
        data: toBase64(bytes),
      },
    },
    complete: {
      protocolVersion: 2,
      type: 'snapshot_complete',
      sessionId,
      timestamp: Date.parse('2026-03-27T09:54:12.000Z'),
      sequence: 3,
      payload: {
        totalChunks: 1,
      },
    },
    derivedSnapshotId,
  };
}

async function createEventStreamEnvelope(sessionId: string, eventVersion: number): Promise<Record<string, unknown>> {
  return createRecordEventStreamEnvelope(sessionId, eventVersion, {
    id: 'r2',
    threadId: 't1',
    type: 'text',
    name: 'Follow-up entry',
    createdAt: Date.parse('2026-03-27T09:54:13.000Z'),
    editedAt: Date.parse('2026-03-27T09:54:13.000Z'),
    orderIndex: 1,
    isStarred: false,
    imageGroupId: null,
  }, 4);
}

async function createRecordEventStreamEnvelope(
  sessionId: string,
  eventVersion: number,
  payload: Record<string, unknown>,
  sequence: number,
): Promise<Record<string, unknown>> {
  const eventTimestampMs = Date.parse('2026-03-27T09:54:13.000Z') + ((eventVersion - 26) * 1000);
  const eventTimestampIso = new Date(eventTimestampMs).toISOString();
  const checksum = await sha256Hex(encodeUtf8(JSON.stringify(payload)));

  return {
    protocolVersion: 2,
    type: 'event_stream',
    sessionId,
    timestamp: eventTimestampMs,
    sequence,
    payload: {
      eventId: eventVersion,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType: 'record',
      entityId: typeof payload['id'] === 'string'
        ? payload['id']
        : typeof payload['uuid'] === 'string'
          ? payload['uuid']
          : 'unknown-record',
      operation: 'create',
      timestamp: eventTimestampIso,
      payload,
      checksum,
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
    await Promise.resolve();
  }
}

describe('Web Sync E2E', () => {
  let relay: WebRelayClient;
  let store: ProjectionStore;

  beforeAll(() => {
    ensureAngularTestEnvironment();
    (globalThis as Record<string, unknown>)['WebSocket'] = MockWebSocket as unknown as typeof WebSocket;
  });

  afterAll(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    relay = TestBed.inject(WebRelayClient);
    store = TestBed.inject(ProjectionStore);
  });

  afterEach(() => {
    relay.disconnect();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('receives a canonical snapshot over the relay and applies the first post-sync event', async () => {
    const baseEventVersion = 25;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    relay.connect('ws://172.20.10.3:8080/relay');
    MockWebSocket.last.simulateOpen();
    const sessionId = relay.sessionId();

    expect(sessionId).not.toBeNull();

    const snapshot = await createSnapshotTransport(sessionId!, baseEventVersion);
    const eventEnvelope = await createEventStreamEnvelope(sessionId!, 26);

    MockWebSocket.last.simulateMessage(snapshot.start);
    MockWebSocket.last.simulateMessage(snapshot.chunk);
    MockWebSocket.last.simulateMessage(snapshot.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');
    expect(store.baseEventVersion()).toBe(baseEventVersion);
    expect(store.lastAppliedEventVersion()).toBe(baseEventVersion);
    expect(store.state().records.map((record) => record.id)).toEqual(['r1']);

    MockWebSocket.last.simulateMessage(eventEnvelope);
    await flushAsyncWork();

    expect(store.lastAppliedEventVersion()).toBe(26);
    expect(store.state().records.map((record) => record.id)).toEqual(['r1', 'r2']);
    expect(store.state().records.find((record) => record.id === 'r2')?.name).toBe('Follow-up entry');
    expect(store.lastProjectionUpdate()).toEqual({
      reason: 'event_applied',
      entityType: 'record',
      eventVersion: 26,
    });
    expect(consoleLog.mock.calls).toContainEqual([
      `SNAPSHOT_ASSEMBLY_STARTED snapshotId=${snapshot.derivedSnapshotId}`,
    ]);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_FORWARDED_TO_ENGINE eventVersion=26']);
    expect(consoleLog.mock.calls).toContainEqual(['BOUNDARY_CHECK expected=26 received=26']);
    expect(consoleLog.mock.calls).toContainEqual(['BOUNDARY_OK start=26']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY version=26']);
  });

  it('applies multiple post-sync events and ignores duplicates', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    relay.connect('ws://172.20.10.3:8080/relay');
    MockWebSocket.last.simulateOpen();
    const sessionId = relay.sessionId();

    expect(sessionId).not.toBeNull();

    const snapshot = await createSnapshotTransport(sessionId!, 25);
    const event26 = await createRecordEventStreamEnvelope(sessionId!, 26, {
      id: 'r2',
      threadId: 't1',
      type: 'text',
      name: 'Second entry',
      createdAt: Date.parse('2026-03-27T09:54:13.000Z'),
      editedAt: Date.parse('2026-03-27T09:54:13.000Z'),
      orderIndex: 1,
      isStarred: false,
      imageGroupId: null,
    }, 4);
    const event27 = await createRecordEventStreamEnvelope(sessionId!, 27, {
      id: 'r3',
      threadId: 't1',
      type: 'text',
      name: 'Third entry',
      createdAt: Date.parse('2026-03-27T09:54:14.000Z'),
      editedAt: Date.parse('2026-03-27T09:54:14.000Z'),
      orderIndex: 2,
      isStarred: false,
      imageGroupId: null,
    }, 6);

    MockWebSocket.last.simulateMessage(snapshot.start);
    MockWebSocket.last.simulateMessage(snapshot.chunk);
    MockWebSocket.last.simulateMessage(snapshot.complete);
    await flushAsyncWork();

    const duplicate26 = {
      ...event26,
      sequence: 5,
    };

    MockWebSocket.last.simulateMessage(event26);
    MockWebSocket.last.simulateMessage(duplicate26);
    MockWebSocket.last.simulateMessage(event27);
    await flushAsyncWork();

    expect(store.lastAppliedEventVersion()).toBe(27);
    expect(store.state().records.map((record) => record.id)).toEqual(['r1', 'r2', 'r3']);
    expect(store.state().records.find((record) => record.id === 'r2')?.name).toBe('Second entry');
    expect(hasSingleArgCall(consoleLog, 'EVENT_IGNORE_DUPLICATE version=26')).toBe(true);
    expect(hasSingleArgCall(consoleLog, 'EVENT_APPLY version=27')).toBe(true);
  });

  it('flags resync when a post-sync event stream gap is detected', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    relay.connect('ws://172.20.10.3:8080/relay');
    MockWebSocket.last.simulateOpen();
    const sessionId = relay.sessionId();

    expect(sessionId).not.toBeNull();

    const snapshot = await createSnapshotTransport(sessionId!, 25);
    const gapEvent = await createRecordEventStreamEnvelope(sessionId!, 28, {
      id: 'r4',
      threadId: 't1',
      type: 'text',
      name: 'Gap entry',
      createdAt: Date.parse('2026-03-27T09:54:15.000Z'),
      editedAt: Date.parse('2026-03-27T09:54:15.000Z'),
      orderIndex: 3,
      isStarred: false,
      imageGroupId: null,
    }, 4);
    const blockedFollowup = await createRecordEventStreamEnvelope(sessionId!, 29, {
      id: 'r5',
      threadId: 't1',
      type: 'text',
      name: 'Blocked after gap',
      createdAt: Date.parse('2026-03-27T09:54:16.000Z'),
      editedAt: Date.parse('2026-03-27T09:54:16.000Z'),
      orderIndex: 4,
      isStarred: false,
      imageGroupId: null,
    }, 5);

    MockWebSocket.last.simulateMessage(snapshot.start);
    MockWebSocket.last.simulateMessage(snapshot.chunk);
    MockWebSocket.last.simulateMessage(snapshot.complete);
    await flushAsyncWork();

    MockWebSocket.last.simulateMessage(gapEvent);
    await flushAsyncWork();

    expect(store.lastAppliedEventVersion()).toBe(25);
    expect(store.state().records.map((record) => record.id)).toEqual(['r1']);
    expect(hasSingleArgCall(consoleLog, 'EVENT_GAP_DETECTED version=28')).toBe(true);
    expect(hasSingleArgCall(consoleLog, 'RESYNC_REQUIRED true')).toBe(true);
    expect(hasSingleArgCall(consoleError, 'SNAPSHOT_RESYNC_REQUIRED reason=EVENT_GAP expected=26 received=28')).toBe(true);

    MockWebSocket.last.simulateMessage(blockedFollowup);
    await flushAsyncWork();

    expect(store.lastAppliedEventVersion()).toBe(25);
    expect(store.state().records.map((record) => record.id)).toEqual(['r1']);
    expect(hasSingleArgCall(consoleLog, 'EVENT_GAP_DETECTED version=29')).toBe(true);
  });
});