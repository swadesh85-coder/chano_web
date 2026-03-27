// @vitest-environment jsdom

import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectionStore } from './projection.store';
import { WebRelayClient } from '../../transport/web-relay-client';

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

function parseJsonLog<T extends object>(calls: readonly unknown[][], label: string): T[] {
  return calls
    .map((call) => call[0])
    .filter((entry): entry is string => typeof entry === 'string' && entry.startsWith(`${label} `))
    .map((entry) => JSON.parse(entry.slice(label.length + 1)) as T);
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

function createCanonicalSnapshotJson(baseEventVersion: number): string {
  return JSON.stringify({
    snapshotVersion: 2,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion,
    generatedAt: '2026-03-27T12:00:00.000Z',
    checksum: 'ignored-in-snapshot-root',
    entityCount: 3,
    entities: [
      {
        entityType: 'folder',
        entityUuid: 'folder-1',
        entityVersion: 11,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: { uuid: 'folder-1', name: 'Inbox', parentFolderUuid: null },
      },
      {
        entityType: 'thread',
        entityUuid: 'thread-1',
        entityVersion: 12,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: { uuid: 'thread-1', folderUuid: 'folder-1', title: 'Roadmap' },
      },
      {
        entityType: 'record',
        entityUuid: 'record-1',
        entityVersion: 13,
        lastEventVersion: baseEventVersion,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-1',
          threadUuid: 'thread-1',
          type: 'text',
          body: 'Seed record',
          createdAt: 1710000000,
          editedAt: 1710000000,
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
}> {
  const snapshotJson = createCanonicalSnapshotJson(baseEventVersion);
  const bytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(bytes);

  return {
    start: {
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId,
      timestamp: Date.parse('2026-03-27T12:00:01.000Z'),
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
      timestamp: Date.parse('2026-03-27T12:00:02.000Z'),
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
      timestamp: Date.parse('2026-03-27T12:00:03.000Z'),
      sequence: 3,
      payload: {
        totalChunks: 1,
      },
    },
  };
}

async function createLegacyCompatibleRecordEventEnvelope(
  sessionId: string,
  eventVersion: number,
): Promise<Record<string, unknown>> {
  const payload = {
    uuid: 'record-2',
    threadUuid: 'thread-1',
    type: 'text',
    body: 'Follow-up entry',
    createdAt: 1710000001,
    editedAt: 1710000001,
    orderIndex: 1,
    isStarred: false,
    imageGroupId: null,
    id: 'record-2',
  };

  return {
    protocolVersion: 2,
    type: 'event_stream',
    sessionId,
    timestamp: Date.parse('2026-03-27T12:00:04.000Z'),
    sequence: 4,
    payload: {
      eventId: eventVersion,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType: 'record',
      entityId: 'record-2',
      operation: 'create',
      timestamp: '2026-03-27T12:00:04.000Z',
      payload,
      checksum: await sha256Hex(encodeUtf8(JSON.stringify(payload))),
    },
  };
}

async function createLegacyTransportThreadEventEnvelope(
  sessionId: string,
  eventVersion: number,
): Promise<Record<string, unknown>> {
  const payload = {
    folderUuid: 'folder-1',
    title: 'Backlog',
    contactId: 'contact-1',
    createdAt: 1710000001,
    deviceId: 'mobile-1',
    entityVersion: eventVersion,
    fieldName: 'title',
    hasStarred: false,
    isEmptyDraft: false,
    isPrivate: false,
    kind: 'direct',
    lastUpdated: 1710000001,
    ownerUserId: 'owner-1',
  };

  return {
    protocolVersion: 2,
    type: 'event_stream',
    sessionId,
    timestamp: Date.parse('2026-03-27T12:00:05.000Z'),
    sequence: 5,
    payload: {
      eventId: eventVersion,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType: 'thread',
      entityId: 'thread-2',
      operation: 'create',
      timestamp: '2026-03-27T12:00:05.000Z',
      payload,
      checksum: await sha256Hex(encodeUtf8(JSON.stringify(payload))),
    },
  };
}

describe('Projection Schema Validation Audit', () => {
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
    TestBed.configureTestingModule({
      providers: [ProjectionStore, WebRelayClient],
    });

    relay = TestBed.inject(WebRelayClient);
    store = TestBed.inject(ProjectionStore);
  });

  afterEach(() => {
    relay.disconnect();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('captures deterministic raw_to_canonical_record_event evidence', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    relay.connect('ws://relay.audit.local/relay');
    MockWebSocket.last.simulateOpen();

    const sessionId = relay.sessionId();
    expect(typeof sessionId).toBe('string');

    const snapshotTransport = await createSnapshotTransport(sessionId!, 100);
    MockWebSocket.last.simulateMessage(snapshotTransport.start);
    MockWebSocket.last.simulateMessage(snapshotTransport.chunk);
    MockWebSocket.last.simulateMessage(snapshotTransport.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');

    const recordEvent = await createLegacyCompatibleRecordEventEnvelope(sessionId!, 101);
    MockWebSocket.last.simulateMessage(recordEvent);
    await flushAsyncWork();

    const baselines = parseJsonLog<{ entity: string; fields: string[] }>(consoleLog.mock.calls, 'SNAPSHOT_SCHEMA_BASELINE');
    const incomingEvents = parseJsonLog<{ entity: string; fields: string[]; eventId: number; sequence: number }>(consoleLog.mock.calls, 'EVENT_SCHEMA_INCOMING');
    const canonicalEvents = parseJsonLog<{ entity: string; fields: string[]; eventId: number; sequence: number }>(consoleLog.mock.calls, 'EVENT_SCHEMA_CANONICAL');
    const ingressHashes = parseJsonLog<{ type: string; sequence: number; hash: string }>(consoleLog.mock.calls, 'RELAY_INGRESS_HASH');
    const egressHashes = parseJsonLog<{ type: string; sequence: number; hash: string }>(consoleLog.mock.calls, 'RELAY_EGRESS_HASH');
    const schemaErrors = parseJsonLog<{
      entity: string;
      missingInEvent: string[];
      extraInEvent: string[];
      snapshotFields: string[];
      eventFields: string[];
      eventId: number;
      sequence: number;
    }>(consoleError.mock.calls, 'SCHEMA_VALIDATION_ERROR');
    const auditResults = parseJsonLog<{
      entity: string;
      snapshotFields: string[];
      eventFields: string[];
      missingInEvent: string[];
      extraInEvent: string[];
      verdict: string;
    }>(consoleError.mock.calls, 'SCHEMA_AUDIT_RESULT');

    expect(baselines).toEqual([
      {
        entity: 'folder',
        fields: ['entityVersion', 'id', 'lastEventVersion', 'name', 'parentId'],
      },
      {
        entity: 'thread',
        fields: ['entityVersion', 'folderId', 'id', 'lastEventVersion', 'title'],
      },
      {
        entity: 'record',
        fields: ['createdAt', 'editedAt', 'entityVersion', 'id', 'imageGroupId', 'isStarred', 'lastEventVersion', 'name', 'orderIndex', 'threadId', 'type'],
      },
    ]);

    expect(incomingEvents).toContainEqual({
      entity: 'record',
      fields: ['body', 'createdAt', 'editedAt', 'id', 'imageGroupId', 'isStarred', 'orderIndex', 'threadUuid', 'type', 'uuid'],
      eventId: 101,
      sequence: 4,
    });

    expect(canonicalEvents).toContainEqual({
      entity: 'record',
      fields: ['createdAt', 'editedAt', 'id', 'imageGroupId', 'isStarred', 'name', 'orderIndex', 'threadId', 'type'],
      eventId: 101,
      sequence: 4,
    });

    const eventIngressHash = ingressHashes.find((entry) => entry.type === 'event_stream' && entry.sequence === 4);
    const eventEgressHash = egressHashes.find((entry) => entry.type === 'event_stream' && entry.sequence === 4);

    expect(eventIngressHash).toBeDefined();
    expect(eventEgressHash).toBeDefined();
    expect(eventIngressHash?.hash).toBe(eventEgressHash?.hash);
    expect(consoleLog.mock.calls).toContainEqual(['PAYLOAD_REFERENCE_EQUALITY true']);

    expect(schemaErrors).toEqual([]);
    expect(auditResults).toEqual([]);
    expect(store.state().records).toContainEqual({
      id: 'record-2',
      threadId: 'thread-1',
      type: 'text',
      name: 'Follow-up entry',
      createdAt: 1710000001,
      editedAt: 1710000001,
      orderIndex: 1,
      isStarred: false,
      imageGroupId: null,
      entityVersion: 101,
      lastEventVersion: 101,
    });
  });

  it('captures deterministic raw_to_canonical_thread_event evidence', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    relay.connect('ws://relay.audit.local/relay');
    MockWebSocket.last.simulateOpen();

    const sessionId = relay.sessionId();
    expect(typeof sessionId).toBe('string');

    const snapshotTransport = await createSnapshotTransport(sessionId!, 100);
    MockWebSocket.last.simulateMessage(snapshotTransport.start);
    MockWebSocket.last.simulateMessage(snapshotTransport.chunk);
    MockWebSocket.last.simulateMessage(snapshotTransport.complete);
    await flushAsyncWork();

    expect(store.phase()).toBe('ready');

    const threadEvent = await createLegacyTransportThreadEventEnvelope(sessionId!, 101);
    MockWebSocket.last.simulateMessage(threadEvent);
    await flushAsyncWork();

    const incomingEvents = parseJsonLog<{ entity: string; fields: string[]; eventId: number; sequence: number }>(consoleLog.mock.calls, 'EVENT_SCHEMA_INCOMING');
    const canonicalEvents = parseJsonLog<{ entity: string; fields: string[]; eventId: number; sequence: number }>(consoleLog.mock.calls, 'EVENT_SCHEMA_CANONICAL');
    const schemaErrors = parseJsonLog(consoleError.mock.calls, 'SCHEMA_VALIDATION_ERROR');
    const auditResults = parseJsonLog(consoleError.mock.calls, 'SCHEMA_AUDIT_RESULT');

    expect(incomingEvents).toContainEqual({
      entity: 'thread',
      fields: ['contactId', 'createdAt', 'deviceId', 'entityVersion', 'fieldName', 'folderUuid', 'hasStarred', 'isEmptyDraft', 'isPrivate', 'kind', 'lastUpdated', 'ownerUserId', 'title'],
      eventId: 101,
      sequence: 5,
    });

    expect(canonicalEvents).toContainEqual({
      entity: 'thread',
      fields: ['folderId', 'id', 'title'],
      eventId: 101,
      sequence: 5,
    });

    expect(schemaErrors).toEqual([]);
    expect(auditResults).toEqual([]);
    expect(store.state().threads).toContainEqual({
      id: 'thread-2',
      folderId: 'folder-1',
      title: 'Backlog',
      entityVersion: 101,
      lastEventVersion: 101,
    });
  });
});