import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PairingComponent } from './pairing';
import { ProjectionStore } from '../projection/projection.store';
import QRCode from 'qrcode';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Helper to mock QRCode.toDataURL with proper typing
function mockQrToDataURL(returnValue: string) {
  return vi.spyOn(QRCode, 'toDataURL').mockImplementation(
    (() => Promise.resolve(returnValue)) as typeof QRCode.toDataURL,
  );
}

function mockQrToDataURLRejected(error: Error) {
  return vi.spyOn(QRCode, 'toDataURL').mockImplementation(
    (() => Promise.reject(error)) as typeof QRCode.toDataURL,
  );
}

// ── Minimal WebSocket mock ───────────────────────────────────

function normalizeSnapshotPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if ('data' in payload) {
    return payload;
  }

  return {
    data: JSON.stringify({
      folders: normalizeEntities('folder', payload['folders']),
      threads: normalizeEntities('thread', payload['threads']),
      records: normalizeEntities('record', payload['records']),
    }),
  };
}

function normalizeEntities(
  entityType: 'folder' | 'thread' | 'record',
  raw: unknown,
): unknown[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }

    const entity = entry as Record<string, unknown>;
    if ('entityType' in entity) {
      return entity;
    }

    switch (entityType) {
      case 'folder':
        return {
          entityType: 'folder',
          entityUuid: entity['uuid'] ?? entity['id'],
          entityVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: entity['uuid'] ?? entity['id'],
            name: entity['name'],
            parentFolderUuid: entity['parentFolderUuid'] ?? entity['parentId'] ?? null,
          },
        };
      case 'thread':
        return {
          entityType: 'thread',
          entityUuid: entity['uuid'] ?? entity['id'],
          entityVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: entity['uuid'] ?? entity['id'],
            folderUuid: entity['folderUuid'] ?? entity['folderId'] ?? null,
            title: entity['title'],
          },
        };
      case 'record':
        return {
          entityType: 'record',
          entityUuid: entity['uuid'] ?? entity['id'],
          entityVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: entity['uuid'] ?? entity['id'],
            threadUuid: entity['threadUuid'] ?? entity['threadId'],
            type: entity['type'],
            body: entity['body'] ?? entity['name'] ?? '',
            createdAt: entity['createdAt'] ?? 0,
            editedAt: entity['editedAt'] ?? entity['createdAt'] ?? 0,
            orderIndex: entity['orderIndex'] ?? 0,
            isStarred: entity['isStarred'] ?? false,
            imageGroupId: entity['imageGroupId'] ?? null,
          },
        };
    }
  });
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

async function createSnapshotMessages(snapshotJson: string): Promise<{
  readonly start: Record<string, unknown>;
  readonly chunks: readonly Record<string, unknown>[];
  readonly complete: Record<string, unknown>;
}> {
  const bytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(bytes);

  return {
    start: {
      type: 'snapshot_start',
      payload: {
        snapshotId: 'snapshot-pairing-1',
        totalChunks: 1,
        totalBytes: bytes.byteLength,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 9,
        entityCount: 3,
        checksum,
      },
    },
    chunks: [
      {
        type: 'snapshot_chunk',
        payload: {
          index: 0,
          data: toBase64(bytes),
        },
      },
    ],
    complete: {
      type: 'snapshot_complete',
      payload: { totalChunks: 1 },
    },
  };
}

async function flushSnapshotAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function waitForProjectionReady(store: ProjectionStore): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (store.phase() === 'ready') {
      return;
    }

    await flushSnapshotAsyncWork();
  }
}

type WsHandler = ((ev: { data: string }) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static last: MockWebSocket;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: WsHandler = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  url: string;

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

  // ── Test helpers ───────────────────────────────────────────

  /** Simulate the server accepting the connection. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Simulate a server message in relay envelope format. */
  simulateMessage(msg: Record<string, unknown>): void {
    const payload =
      msg['type'] === 'snapshot_chunk' && msg['payload'] !== null && typeof msg['payload'] === 'object'
        ? normalizeSnapshotPayload(msg['payload'] as Record<string, unknown>)
        : msg['payload'] ?? {};

    const envelope = msg['protocolVersion']
      ? msg
      : {
          protocolVersion: 2,
          type: msg['type'],
          sessionId: msg['sessionId'] ?? null,
          timestamp: Date.now(),
          sequence: msg['sequence'] ?? 1,
          payload,
        };
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  /** Simulate a connection error. */
  simulateError(): void {
    this.onerror?.();
  }

  /** Simulate the connection closing. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// ── Setup global mock ────────────────────────────────────────

const OriginalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  (globalThis as Record<string, unknown>)['WebSocket'] =
    MockWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

// ── Test suite ───────────────────────────────────────────────

describe('PairingComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<PairingComponent>>;
  let component: PairingComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PairingComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(PairingComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  // ── 1. Safety rules ─────────────────────────────────────

  describe('Constitutional safety', () => {
    it('must not use localStorage', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem');
      fixture.detectChanges();
      MockWebSocket.last.simulateOpen();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('must not use sessionStorage', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem');
      fixture.detectChanges();
      MockWebSocket.last.simulateOpen();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('must not store vault data or user records', () => {
      const publicKeys = Object.keys(component);
      const forbidden = ['vault', 'user', 'record', 'media', 'storage'];
      for (const key of publicKeys) {
        for (const word of forbidden) {
          expect(key.toLowerCase()).not.toContain(word);
        }
      }
    });
  });

  // ── 2. WebSocket connects via WebRelayClient ───────────

  describe('WebSocket connection', () => {
    it('should open a WebSocket to the relay on init', () => {
      fixture.detectChanges();
      expect(MockWebSocket.last).toBeDefined();
      expect(MockWebSocket.last.url).toBe('ws://172.20.10.3:8080/relay');
    });

    it('should set status to "connecting" initially', () => {
      fixture.detectChanges();
      expect(component.status()).toBe('connecting');
    });
  });

  // ── 3. Sends qr_session_create on open ─────────────────

  describe('Session creation', () => {
    it('session_id_generated', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      const envelope = JSON.parse(ws.sent[0]);

      expect(envelope.sessionId).toMatch(UUID_V4_PATTERN);
      expect(envelope.payload.sessionId).toBe(envelope.sessionId);
      expect(envelope.sessionId).not.toBe('');
    });

    it('qr_session_create_sent', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      expect(ws.sent.length).toBe(1);
      const envelope = JSON.parse(ws.sent[0]);

      expect(envelope).toEqual({
        protocolVersion: 2,
        type: 'qr_session_create',
        sessionId: expect.stringMatching(UUID_V4_PATTERN),
        timestamp: expect.any(Number),
        sequence: 1,
        payload: {
          sessionId: expect.stringMatching(UUID_V4_PATTERN),
        },
      });
      expect(envelope.payload.sessionId).toBe(envelope.sessionId);
    });

    it('transport_envelope_valid', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      const envelope = JSON.parse(ws.sent[0]);

      expect(envelope.protocolVersion).toBe(2);
      expect(envelope.type).toBe('qr_session_create');
      expect(typeof envelope.timestamp).toBe('number');
      expect(envelope.sequence).toBe(1);
      expect(envelope.payload).toEqual({ sessionId: envelope.sessionId });
    });
  });

  // ── 4. QR code generated on qr_session_ready ───────────

  describe('QR code generation', () => {
    it('should generate a QR code containing sessionId, relayUrl, expiresAt', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,FAKE');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      const expiresAtMs = Date.now() + 120_000;
      const expiresAtIso = new Date(expiresAtMs).toISOString();
      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: '123e4567-e89b-42d3-a456-426614174100',
        payload: { expiresAt: expiresAtMs },
      });

      await fixture.whenStable();

      expect(qrSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(qrSpy.mock.calls[0][0] as string);
      expect(payload).toEqual({
        sessionId: '123e4567-e89b-42d3-a456-426614174100',
        relayUrl: 'ws://172.20.10.3:8080/relay',
        expiresAt: expiresAtIso,
      });

      expect(component.status()).toBe('waiting_for_scan');
      expect(component.qrDataUrl()).toBe('data:image/png;base64,FAKE');

      qrSpy.mockRestore();
    });

    it('should set error status if QR generation fails', async () => {
      const qrSpy = mockQrToDataURLRejected(new Error('canvas fail'));

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: '123e4567-e89b-42d3-a456-426614174101',
        payload: { expiresAt: Date.now() + 60_000 },
      });

      await fixture.whenStable();

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Failed to generate QR code');

      qrSpy.mockRestore();
    });
  });

  // ── 5. pair_approved → Connected to Mobile ──────────────

  describe('Pair approval', () => {
    it('pair_approved_received', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: '123e4567-e89b-42d3-a456-426614174102',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved' });

      expect(component.status()).toBe('paired');
      expect(component.statusText()).toBe('Connected to Mobile');
      expect(logSpy).toHaveBeenCalledWith('PAIR_APPROVED received');

      logSpy.mockRestore();
      qrSpy.mockRestore();
    });
  });

  // ── 6. Session expiry auto-renews ───────────────────────

  describe('Session expiry auto-renewal', () => {
    it('should send a new qr_session_create when the session expires', async () => {
      vi.useFakeTimers();

      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      expect(ws.sent.length).toBe(1);

      const initialSessionEnvelope = JSON.parse(ws.sent[0]);
      const expiresAt = Date.now() + 5_000;
      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: initialSessionEnvelope.sessionId,
        payload: { expiresAt },
      });
      await fixture.whenStable();

      vi.advanceTimersByTime(6_000);

      expect(ws.sent.length).toBe(2);
      expect(JSON.parse(ws.sent[1])).toEqual({
        protocolVersion: 2,
        type: 'qr_session_create',
        sessionId: initialSessionEnvelope.sessionId,
        timestamp: expect.any(Number),
        sequence: 2,
        payload: {
          sessionId: initialSessionEnvelope.sessionId,
        },
      });

      vi.useRealTimers();
      qrSpy.mockRestore();
    });
  });

  // ── 7. Snapshot flow (syncing → navigation) ─────────────

  describe('Snapshot handling', () => {
    it('handshake_routed_to_pairing', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: '123e4567-e89b-42d3-a456-426614174103',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved' });
      ws.simulateMessage({
        type: 'protocol_handshake',
        sessionId: '123e4567-e89b-42d3-a456-426614174103',
      });

      expect(component.status()).toBe('syncing');
      expect(component.statusText()).toBe('Syncing your data\u2026');
      expect(ws.sent.length).toBe(2);
      expect(JSON.parse(ws.sent[1])).toEqual({
        protocolVersion: 2,
        type: 'protocol_handshake',
        sessionId: '123e4567-e89b-42d3-a456-426614174103',
        timestamp: expect.any(Number),
        sequence: 2,
        payload: {
          supportedProtocolVersions: [2],
          minProtocolVersion: 2,
        },
      });

      qrSpy.mockRestore();
    });

    it('should navigate to /explorer when snapshot completes', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');
      const store = TestBed.inject(ProjectionStore);
      const snapshot = await createSnapshotMessages(JSON.stringify({
        folders: [
          {
            entityType: 'folder',
            entityUuid: 'f1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: { uuid: 'f1', name: 'Work', parentFolderUuid: null },
          },
        ],
        threads: [],
        records: [],
      }));

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: '123e4567-e89b-42d3-a456-426614174104',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved' });
      ws.simulateMessage({ type: 'protocol_handshake' });
      ws.simulateMessage(snapshot.start);
      snapshot.chunks.forEach((message) => ws.simulateMessage(message));
      ws.simulateMessage(snapshot.complete);

      await waitForProjectionReady(store);
      fixture.detectChanges();
      await flushSnapshotAsyncWork();

      expect(store.phase()).toBe('ready');
      expect(router.navigate).toHaveBeenCalledWith(['/explorer']);

      qrSpy.mockRestore();
    });

    it('should accumulate snapshot data in ProjectionStore', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');
      const store = TestBed.inject(ProjectionStore);
      const snapshot = await createSnapshotMessages(JSON.stringify({
        folders: [
          {
            entityType: 'folder',
            entityUuid: 'f1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: { uuid: 'f1', name: 'Work', parentFolderUuid: null },
          },
        ],
        threads: [
          {
            entityType: 'thread',
            entityUuid: 't1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: { uuid: 't1', folderUuid: 'f1', title: 'Log' },
          },
        ],
        records: [
          {
            entityType: 'record',
            entityUuid: 'r1',
            entityVersion: 1,
            ownerUserId: 'owner-1',
            data: {
              uuid: 'r1',
              threadUuid: 't1',
              type: 'text',
              body: 'Entry',
              createdAt: 1,
              editedAt: 1,
              orderIndex: 0,
              isStarred: false,
              imageGroupId: null,
            },
          },
        ],
      }));

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: 'sess-acc',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved' });
      ws.simulateMessage({ type: 'protocol_handshake' });
      ws.simulateMessage(snapshot.start);
      snapshot.chunks.forEach((message) => ws.simulateMessage(message));
      ws.simulateMessage(snapshot.complete);
      await flushSnapshotAsyncWork();
      fixture.detectChanges();

      expect(store.phase()).toBe('ready');
      expect(store.folders().length).toBe(1);
      expect(store.threads().length).toBe(1);
      expect(store.records().length).toBe(1);

      qrSpy.mockRestore();
    });
  });

  // ── 8. Error / resilience ───────────────────────────────

  describe('Error handling', () => {
    it('should set error status on WebSocket error', () => {
      fixture.detectChanges();
      MockWebSocket.last.simulateError();

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Failed to connect to relay server');
    });

    it('should set error status when connection closes unexpectedly', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: 'sess-close',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateClose();

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Connection to relay lost');

      qrSpy.mockRestore();
    });

    it('should not overwrite paired status on close', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: 'sess-stay',
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved' });
      ws.simulateClose();

      expect(component.status()).toBe('paired');

      qrSpy.mockRestore();
    });

    it('should ignore malformed messages gracefully', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      // Send non-JSON — WebRelayClient catches the parse error
      ws.onmessage?.({ data: 'not json at all {{{{' });

      expect(component.status()).not.toBe('error');
    });
  });

  // ── 9. Cleanup on destroy ───────────────────────────────

  describe('Cleanup', () => {
    it('should keep relay connected after component destroy (service-owned)', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      fixture.destroy();

      // WebRelayClient owns the connection — it persists for explorer
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
    });
  });
});
