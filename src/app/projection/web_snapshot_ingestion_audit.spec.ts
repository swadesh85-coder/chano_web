import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectionStore } from './projection.store';
import { WebRelayClient } from '../../transport/web-relay-client';
import type { TransportEnvelope } from '../../transport/transport-envelope';

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

type WsHandler = ((ev: { data: string }) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static last: MockWebSocket;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: WsHandler = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
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

  simulateEnvelope(envelope: TransportEnvelope): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }
}

const ORIGINAL_WEB_SOCKET = globalThis.WebSocket;

beforeAll(() => {
  ensureAngularTestEnvironment();
  (globalThis as Record<string, unknown>)['WebSocket'] = MockWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  globalThis.WebSocket = ORIGINAL_WEB_SOCKET;
});

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
    throw new Error('BASE64_ENCODE_UNAVAILABLE');
  }

  return bufferCtor.from(bytes).toString('base64');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function createSnapshotProtocol(sessionId: string): Promise<{
  readonly start: TransportEnvelope;
  readonly chunk: TransportEnvelope;
  readonly complete: TransportEnvelope;
}> {
  const snapshotJson = JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-audit-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-audit-1',
          name: 'Inbox',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-audit-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-audit-1',
          folderUuid: null,
          title: 'Snapshot Thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-audit-1',
        entityVersion: 1,
        lastEventVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-audit-1',
          threadUuid: 'thread-audit-1',
          type: 'text',
          body: 'Snapshot Record',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
  const snapshotBytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(snapshotBytes);

  return {
    start: {
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId,
      timestamp: 1710000001,
      sequence: 1,
      payload: {
        snapshotId: 'snapshot-audit-1',
        totalChunks: 1,
        totalBytes: snapshotBytes.byteLength,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 12,
        entityCount: 3,
        checksum,
      },
    },
    chunk: {
      protocolVersion: 2,
      type: 'snapshot_chunk',
      sessionId,
      timestamp: 1710000002,
      sequence: 2,
      payload: {
        index: 0,
        data: toBase64(snapshotBytes),
      },
    },
    complete: {
      protocolVersion: 2,
      type: 'snapshot_complete',
      sessionId,
      timestamp: 1710000003,
      sequence: 3,
      payload: {
        totalChunks: 1,
      },
    },
  };
}

async function waitForProjectionReady(projectionStore: ProjectionStore): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (projectionStore.phase() === 'ready') {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
  }
}

describe('Web snapshot ingestion audit', () => {
  let relay: WebRelayClient;
  let projectionStore: ProjectionStore;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let auditLog: string[];

  beforeEach(() => {
    auditLog = [];
    consoleLog = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      auditLog.push(args.map((value) => String(value)).join(' '));
    });

    TestBed.configureTestingModule({});
    relay = TestBed.inject(WebRelayClient);
    projectionStore = TestBed.inject(ProjectionStore);
    relay.connect('ws://audit-relay');
    MockWebSocket.last.simulateOpen();
    auditLog = [];
  });

  afterEach(() => {
    relay?.disconnect();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('snapshot_start_to_apply_trace', async () => {
    const sessionId = 'session-snapshot-audit';
    const protocol = await createSnapshotProtocol(sessionId);

    MockWebSocket.last.simulateEnvelope(protocol.start);
    MockWebSocket.last.simulateEnvelope(protocol.chunk);
    MockWebSocket.last.simulateEnvelope(protocol.complete);

    await waitForProjectionReady(projectionStore);

    const expectedTrace = [
      `WS_MESSAGE_PARSED type=snapshot_start sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_START snapshotId=snapshot-audit-1 totalChunks=1 type=snapshot_start sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_start sessionId=${sessionId} handled=true`,
      `WS_MESSAGE_PARSED type=snapshot_chunk sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_CHUNK index=0 type=snapshot_chunk sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_chunk sessionId=${sessionId} handled=true`,
      `WS_MESSAGE_PARSED type=snapshot_complete sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_COMPLETE totalChunks=1 type=snapshot_complete sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_complete sessionId=${sessionId} handled=true`,
      `PROJECTION_BUILD_TRIGGERED type=snapshot_complete sessionId=${sessionId}`,
      'PROJECTION_SNAPSHOT_APPLIED baseEventVersion=12',
      'PROJECTION_BUILD_COMPLETE entityCount=3',
      `PROJECTION_APPLY entityCount=3 type=snapshot_apply sessionId=${sessionId}`,
    ];

    let cursor = -1;
    for (const line of expectedTrace) {
      const nextIndex = auditLog.findIndex((entry, index) => index > cursor && entry === line);
      expect(nextIndex, `Missing audit log: ${line}\nCaptured log:\n${auditLog.join('\n')}`).toBeGreaterThan(cursor);
      cursor = nextIndex;
    }

    expect(projectionStore.phase()).toBe('ready');
    expect(projectionStore.state().folders.map((folder) => folder.id)).toEqual(['folder-audit-1']);
    expect(projectionStore.state().threads.map((thread) => thread.id)).toEqual(['thread-audit-1']);
    expect(projectionStore.state().records.map((record) => record.id)).toEqual(['record-audit-1']);
  });
});
