import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExplorerComponent } from '../explorer/explorer';
import { ExplorerActions } from '../explorer/explorer_actions';
import { PendingCommandStore } from '../explorer/pending_command_store';
import { ProjectionStore } from './projection.store';
import { MutationCommandSender } from '../../transport';
import { WebRelayClient } from '../../transport/web-relay-client';
import type { TransportEnvelope } from '../../transport/transport-envelope';

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
  (globalThis as Record<string, unknown>)['WebSocket'] =
    MockWebSocket as unknown as typeof WebSocket;
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
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
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

async function waitForProjectionReady(
  fixture: ComponentFixture<ExplorerComponent>,
  projectionStore: ProjectionStore,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (projectionStore.phase() === 'ready') {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
    fixture.detectChanges();
  }
}

describe('Web snapshot ingestion audit', () => {
  let fixture: ComponentFixture<ExplorerComponent>;
  let component: ExplorerComponent;
  let relay: WebRelayClient;
  let projectionStore: ProjectionStore;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let auditLog: string[];

  beforeEach(async () => {
    auditLog = [];
    consoleLog = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      auditLog.push(args.map((value) => String(value)).join(' '));
    });

    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
      providers: [
        ExplorerActions,
        {
          provide: PendingCommandStore,
          useValue: {
            isPending: vi.fn(() => false),
            isCreatePending: vi.fn(() => false),
            setPending: vi.fn(),
            pendingEntities: signal([]),
          },
        },
        {
          provide: MutationCommandSender,
          useValue: { sendCommand: vi.fn(() => null) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplorerComponent);
    component = fixture.componentInstance;
    relay = TestBed.inject(WebRelayClient);
    projectionStore = TestBed.inject(ProjectionStore);
    relay.connect('ws://audit-relay');
    MockWebSocket.last.simulateOpen();
    fixture.detectChanges();
    auditLog = [];
  });

  afterEach(() => {
    relay.disconnect();
    vi.restoreAllMocks();
  });

  it('snapshot_start_to_render_trace', async () => {
    const sessionId = 'session-snapshot-audit';
    const protocol = await createSnapshotProtocol(sessionId);

    MockWebSocket.last.simulateEnvelope(protocol.start);
    MockWebSocket.last.simulateEnvelope(protocol.chunk);
    MockWebSocket.last.simulateEnvelope(protocol.complete);

    await waitForProjectionReady(fixture, projectionStore);
    await fixture.whenStable();
    fixture.detectChanges();

    const projectionState = projectionStore.getProjectionState();
    console.warn(`AUDIT_TRACE\n${auditLog.join('\n')}`);

    const expectedTrace = [
      `WS_MESSAGE_RECEIVED raw=${JSON.stringify(protocol.start).slice(0, 200)} type=unknown sessionId=unknown`,
      `WS_MESSAGE_PARSED type=snapshot_start sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_START snapshotId=snapshot-audit-1 totalChunks=1 type=snapshot_start sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_start sessionId=${sessionId} handled=true`,
      `WS_MESSAGE_RECEIVED raw=${JSON.stringify(protocol.chunk).slice(0, 200)} type=unknown sessionId=unknown`,
      `WS_MESSAGE_PARSED type=snapshot_chunk sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_CHUNK index=0 type=snapshot_chunk sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_chunk sessionId=${sessionId} handled=true`,
      `WS_MESSAGE_RECEIVED raw=${JSON.stringify(protocol.complete).slice(0, 200)} type=unknown sessionId=unknown`,
      `WS_MESSAGE_PARSED type=snapshot_complete sessionId=${sessionId}`,
      `SNAPSHOT_RECEIVE_COMPLETE totalChunks=1 type=snapshot_complete sessionId=${sessionId}`,
      `HANDLE_MESSAGE type=snapshot_complete sessionId=${sessionId} handled=true`,
    ];

    let cursor = -1;
    for (const line of expectedTrace) {
      const nextIndex = auditLog.findIndex((entry, index) => index > cursor && entry === line);
      expect(nextIndex, `Missing audit log: ${line}\nCaptured log:\n${auditLog.join('\n')}`).toBeGreaterThan(cursor);
      cursor = nextIndex;
    }

    expect(projectionState.folders).toHaveLength(1);
    expect(projectionState.threads).toHaveLength(1);
    expect(projectionState.records).toHaveLength(1);
    expect(component.folderTree()).toHaveLength(1);
    expect(component.threadList()).toHaveLength(1);
    expect(
      auditLog.includes(
        `EXPLORER_RENDER folders=1 threads=1 records=0 type=projection_render sessionId=${sessionId}`,
      ),
    ).toBe(true);
  });
});