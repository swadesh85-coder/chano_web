// @vitest-environment jsdom

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAngularTestEnvironment } from '../../testing/ensure-angular-test-environment';
import { isValidQrRelayUrl, PairingComponent } from './pairing';
import { ProjectionStore } from '../projection/projection.store';
import { WebRelayClient } from '../../transport';
import QRCode from 'qrcode';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_RELAY_URL = 'ws://192.168.0.20:8080/relay';
const BROWSER_RELAY_QUERY = `/?relayUrl=${encodeURIComponent(BROWSER_RELAY_URL)}`;
const QR_RELAY_URL = 'ws://192.168.0.21:8080/relay';
const QR_RELAY_QUERY = `/?qrRelayUrl=${encodeURIComponent(QR_RELAY_URL)}`;
const SNAPSHOT_FOLDER_ID = '123e4567-e89b-42d3-a456-426614174301';
const SNAPSHOT_THREAD_ID = '123e4567-e89b-42d3-a456-426614174302';
const SNAPSHOT_RECORD_ID = '123e4567-e89b-42d3-a456-426614174303';
const INCREMENTAL_RECORD_ID = '123e4567-e89b-42d3-a456-426614174304';

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
          lastEventVersion: 1,
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
          lastEventVersion: 1,
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
          lastEventVersion: 1,
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
  const parsedSnapshot = JSON.parse(snapshotJson) as {
    readonly snapshotVersion?: number;
    readonly protocolVersion?: number;
    readonly schemaVersion?: number;
    readonly baseEventVersion?: number;
    readonly entities?: readonly unknown[];
  };

  return {
    start: {
      type: 'snapshot_start',
      payload: {
        totalChunks: 1,
        totalBytes: bytes.byteLength,
        snapshotVersion: parsedSnapshot.snapshotVersion ?? 1,
        protocolVersion: parsedSnapshot.protocolVersion ?? 2,
        schemaVersion: parsedSnapshot.schemaVersion ?? 1,
        baseEventVersion: parsedSnapshot.baseEventVersion ?? 1,
        entityCount: parsedSnapshot.entities?.length ?? 0,
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

function createCanonicalSnapshotJson(): string {
  return JSON.stringify({
    snapshotVersion: 2,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion: 25,
    generatedAt: '2026-03-27T09:54:00.000Z',
    checksum: 'snapshot-pairing-checksum',
    entityCount: 3,
    entities: [
      {
        entityType: 'folder',
        entityUuid: SNAPSHOT_FOLDER_ID,
        entityVersion: 1,
        lastEventVersion: 25,
        ownerUserId: 'owner-1',
        data: { name: 'Work', parentFolderUuid: null },
      },
      {
        entityType: 'thread',
        entityUuid: SNAPSHOT_THREAD_ID,
        entityVersion: 1,
        lastEventVersion: 25,
        ownerUserId: 'owner-1',
        data: { folderUuid: SNAPSHOT_FOLDER_ID, title: 'Log' },
      },
      {
        entityType: 'record',
        entityUuid: SNAPSHOT_RECORD_ID,
        entityVersion: 1,
        lastEventVersion: 25,
        ownerUserId: 'owner-1',
        data: {
          threadUuid: SNAPSHOT_THREAD_ID,
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

async function createEventStreamMessage(
  sessionId: string,
  eventVersion: number,
  payload: Record<string, unknown>,
  sequence: number,
): Promise<Record<string, unknown>> {
  const checksum = await sha256Hex(encodeUtf8(JSON.stringify(payload)));
  const timestampIso = new Date(Date.UTC(2026, 2, 27, 9, 54, 10 + eventVersion - 25)).toISOString();

  return {
    protocolVersion: 2,
    type: 'event_stream',
    sessionId,
    timestamp: Date.parse(timestampIso),
    sequence,
    payload: {
      eventId: eventVersion,
      originDeviceId: 'mobile-1',
      eventVersion,
      entityType: 'record',
      entityId: payload['id'] ?? payload['uuid'],
      operation: 'create',
      timestamp: timestampIso,
      payload,
      checksum,
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

async function waitForLastAppliedEventVersion(store: ProjectionStore, eventVersion: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (store.lastAppliedEventVersion() === eventVersion) {
      return;
    }

    await flushSnapshotAsyncWork();
  }
}

async function flushPairingAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
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

  /** Simulate a raw relay frame that is not a transport envelope. */
  simulateRawFrame(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Simulate the connection closing. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

class MockRTCPeerConnection {
  static discoveredHosts: string[] = [];

  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;

  createDataChannel(): void {}

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'offer', sdp: 'mock-sdp' });
  }

  setLocalDescription(_: RTCSessionDescriptionInit): Promise<void> {
    queueMicrotask(() => {
      for (const host of MockRTCPeerConnection.discoveredHosts) {
        this.onicecandidate?.({
          candidate: {
            candidate: `candidate:1 1 UDP 2122260223 ${host} 5000 typ host`,
          },
        });
      }

      this.onicecandidate?.({ candidate: null });
    });

    return Promise.resolve();
  }

  close(): void {}
}

type MockFetchResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<MockFetchResponse>>();

// ── Setup global mock ────────────────────────────────────────

const OriginalWebSocket = globalThis.WebSocket;
const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
const OriginalFetch = globalThis.fetch;

beforeAll(() => {
  ensureAngularTestEnvironment();
  (globalThis as Record<string, unknown>)['WebSocket'] =
    MockWebSocket as unknown as typeof WebSocket;
  (globalThis as Record<string, unknown>)['RTCPeerConnection'] =
    MockRTCPeerConnection as unknown as typeof RTCPeerConnection;
  (globalThis as Record<string, unknown>)['fetch'] = mockFetch;
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
  globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
  globalThis.fetch = OriginalFetch;
});

// ── Test suite ───────────────────────────────────────────────

describe('PairingComponent', () => {
  let fixture!: ReturnType<typeof TestBed.createComponent<PairingComponent>>;
  let component!: PairingComponent;
  let router!: Router;

  beforeEach(async () => {
    globalThis.history.replaceState({}, '', BROWSER_RELAY_QUERY);
    MockWebSocket.last = undefined as unknown as MockWebSocket;
    MockRTCPeerConnection.discoveredHosts = ['192.168.0.20'];
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ preferredIpv4: '192.168.0.20' }),
    });
    TestBed.overrideComponent(PairingComponent, {
      set: {
        template: '',
        styles: [''],
      },
    });
    TestBed.configureTestingModule({
      imports: [PairingComponent],
      providers: [provideRouter([])],
    });
    await TestBed.compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(PairingComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
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
      expect(MockWebSocket.last.url).toBe(BROWSER_RELAY_URL);
    });

    it('should auto-discover a mobile-reachable IPv4 relay when browser relay is localhost', async () => {
      globalThis.history.replaceState({}, '', '/?mode=localhost');
      fixture.detectChanges();

      await flushPairingAsyncWork();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/relay-info', {
        method: 'GET',
        cache: 'no-store',
      });
      expect(MockWebSocket.last.url).toBe('ws://localhost:8080/relay');
      expect(component.status()).toBe('connecting');
      expect(isValidQrRelayUrl('ws://localhost:8080/relay')).toBe(false);
    });

    it('should set status to "connecting" initially', () => {
      fixture.detectChanges();
      expect(component.status()).toBe('connecting');
    });

    it('should connect and generate a QR automatically on localhost after IPv4 discovery', async () => {
      globalThis.history.replaceState({}, '', '/?mode=localhost');
      const qrSpy = mockQrToDataURL('data:image/png;base64,LOCALHOST-REAL-DEVICE');

      fixture.detectChanges();
      await flushPairingAsyncWork();

      expect(MockWebSocket.last.url).toBe('ws://localhost:8080/relay');

      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      const expiresAtMs = Date.now() + 120_000;
      const expiresAtIso = new Date(expiresAtMs).toISOString();
      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: expiresAtMs },
      });

      await fixture.whenStable();

      const payload = JSON.parse(qrSpy.mock.calls[0][0] as string);
      expect(payload).toEqual({
        sessionId,
        token: sessionCreateEnvelope.payload.token,
        relayUrl: BROWSER_RELAY_URL,
        expiresAt: expiresAtIso,
      });
      expect(component.status()).toBe('waiting_for_scan');

      qrSpy.mockRestore();
    });

    it('should set error status when localhost relay discovery cannot find a LAN IPv4', async () => {
      globalThis.history.replaceState({}, '', '/?mode=localhost');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ preferredIpv4: null }),
      });
      MockRTCPeerConnection.discoveredHosts = [];

      fixture.detectChanges();
      await flushPairingAsyncWork();

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toContain('Unable to determine a mobile-reachable relay address automatically');
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
      expect(envelope.payload.token).toMatch(UUID_V4_PATTERN);
      expect(envelope.payload.sessionId).toBe(envelope.sessionId);
      expect(envelope.payload.token).not.toBe('');
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
          token: expect.stringMatching(UUID_V4_PATTERN),
        },
      });
      expect(envelope.payload.sessionId).toBe(envelope.sessionId);
      expect(typeof envelope.payload.token).toBe('string');
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
      expect(envelope.payload).toEqual({
        sessionId: envelope.sessionId,
        token: expect.stringMatching(UUID_V4_PATTERN),
      });
    });
  });

  // ── 4. QR code generated on qr_session_ready ───────────

  describe('QR code generation', () => {
    it('should generate a QR code containing sessionId, token, relayUrl, expiresAt', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,FAKE');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      const expiresAtMs = Date.now() + 120_000;
      const expiresAtIso = new Date(expiresAtMs).toISOString();
      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: expiresAtMs },
      });

      await fixture.whenStable();

      expect(qrSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(qrSpy.mock.calls[0][0] as string);
      expect(payload).toEqual({
        sessionId,
        token: sessionCreateEnvelope.payload.token,
        relayUrl: BROWSER_RELAY_URL,
        expiresAt: expiresAtIso,
      });
      expect(payload.token).toBeTruthy();

      expect(component.status()).toBe('waiting_for_scan');
      expect(component.qrDataUrl()).toBe('data:image/png;base64,FAKE');

      qrSpy.mockRestore();
    });

    it('should prefer an explicit qrRelayUrl override for real-device pairing', async () => {
      globalThis.history.replaceState(
        {},
        '',
        `${BROWSER_RELAY_QUERY}&qrRelayUrl=${encodeURIComponent(QR_RELAY_URL)}`,
      );
      const qrSpy = mockQrToDataURL('data:image/png;base64,FAKE');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      const expiresAtMs = Date.now() + 120_000;
      const expiresAtIso = new Date(expiresAtMs).toISOString();
      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: expiresAtMs },
      });

      await fixture.whenStable();

      expect(qrSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(qrSpy.mock.calls[0][0] as string);
      expect(payload).toEqual({
        sessionId,
        token: sessionCreateEnvelope.payload.token,
        relayUrl: QR_RELAY_URL,
        expiresAt: expiresAtIso,
      });

      qrSpy.mockRestore();
    });

    it('should set error status if QR generation fails', async () => {
      const qrSpy = mockQrToDataURLRejected(new Error('canvas fail'));

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: sessionCreateEnvelope.sessionId,
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
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: sessionCreateEnvelope.sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId: sessionCreateEnvelope.sessionId });

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
          token: initialSessionEnvelope.payload.token,
        },
      });

      vi.useRealTimers();
      qrSpy.mockRestore();
    });

    it('should fail QR generation if the pairing token is missing', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();

      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const relay = TestBed.inject(WebRelayClient) as unknown as {
        currentSessionToken: { set(value: string | null): void };
      };
      relay.currentSessionToken.set(null);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: sessionCreateEnvelope.sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      expect(qrSpy).not.toHaveBeenCalled();
      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Missing pairing token');

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
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId });
      ws.simulateMessage({
        type: 'protocol_handshake',
        sessionId,
      });

      expect(component.status()).toBe('syncing');
      expect(component.statusText()).toBe('Syncing your data\u2026');
      expect(ws.sent.length).toBe(2);
      expect(JSON.parse(ws.sent[1])).toEqual({
        protocolVersion: 2,
        type: 'protocol_handshake',
        sessionId,
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
      const snapshot = await createSnapshotMessages(createCanonicalSnapshotJson());

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId });
      ws.simulateMessage({ type: 'protocol_handshake', sessionId });
      ws.simulateMessage({ ...snapshot.start, sessionId, sequence: 3 });
      snapshot.chunks.forEach((message, index) => ws.simulateMessage({ ...message, sessionId, sequence: 4 + index }));
      ws.simulateMessage({ ...snapshot.complete, sessionId, sequence: 5 });

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
      const snapshot = await createSnapshotMessages(createCanonicalSnapshotJson());

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId });
      ws.simulateMessage({ type: 'protocol_handshake', sessionId });
      ws.simulateMessage({ ...snapshot.start, sessionId, sequence: 3 });
      snapshot.chunks.forEach((message, index) => ws.simulateMessage({ ...message, sessionId, sequence: 4 + index }));
      ws.simulateMessage({ ...snapshot.complete, sessionId, sequence: 5 });
      await waitForProjectionReady(store);
      fixture.detectChanges();

      expect(store.phase()).toBe('ready');
      expect(store.state().folders.length).toBe(1);
      expect(store.state().threads.length).toBe(1);
      expect(store.state().records.length).toBe(1);

      qrSpy.mockRestore();
    });

    it('automates live sync through snapshot apply and first incremental event', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const store = TestBed.inject(ProjectionStore);
      const snapshot = await createSnapshotMessages(createCanonicalSnapshotJson());

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);
      const sessionId = sessionCreateEnvelope.sessionId as string;
      const eventMessage = await createEventStreamMessage(sessionId, 26, {
        id: INCREMENTAL_RECORD_ID,
        threadId: SNAPSHOT_THREAD_ID,
        type: 'text',
        name: 'Follow-up entry',
        createdAt: Date.parse('2026-03-27T09:54:11.000Z'),
        editedAt: Date.parse('2026-03-27T09:54:11.000Z'),
        orderIndex: 1,
        isStarred: false,
        imageGroupId: null,
      }, 6);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId });
      ws.simulateMessage({ type: 'protocol_handshake', sessionId });
      ws.simulateMessage({ ...snapshot.start, sessionId, sequence: 3 });
      snapshot.chunks.forEach((message, index) => {
        ws.simulateMessage({ ...message, sessionId, sequence: 4 + index });
      });
      ws.simulateMessage({ ...snapshot.complete, sessionId, sequence: 5 });

      await waitForProjectionReady(store);
      ws.simulateMessage(eventMessage);
      await waitForLastAppliedEventVersion(store, 26);
      fixture.detectChanges();

      expect(store.phase()).toBe('ready');
      expect(store.baseEventVersion()).toBe(25);
      expect(store.lastAppliedEventVersion()).toBe(26);
      expect(store.state().records.map((record) => record.id)).toEqual([SNAPSHOT_RECORD_ID, INCREMENTAL_RECORD_ID]);
      expect(store.state().records.find((record) => record.id === INCREMENTAL_RECORD_ID)?.name).toBe('Follow-up entry');
      expect(store.lastProjectionUpdate()).toEqual({
        reason: 'event_applied',
        entityType: 'record',
        eventVersion: 26,
      });
      expect(router.navigate).toHaveBeenCalledWith(['/explorer']);
      expect(logSpy.mock.calls).toContainEqual(['EVENT_FORWARDED_TO_ENGINE eventVersion=26']);
      expect(logSpy.mock.calls).toContainEqual(['EVENT_APPLY version=26']);

      qrSpy.mockRestore();
      logSpy.mockRestore();
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

    it('should surface relay control errors during pairing bootstrap', () => {
      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      ws.simulateRawFrame({
        type: 'control_error',
        payload: { reason: 'web_socket_required' },
      });

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('web_socket_required');
    });

    it('should set error status when connection closes unexpectedly', async () => {
      const qrSpy = mockQrToDataURL('data:image/png;base64,QR');

      fixture.detectChanges();
      const ws = MockWebSocket.last;
      ws.simulateOpen();
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: sessionCreateEnvelope.sessionId,
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
      const sessionCreateEnvelope = JSON.parse(ws.sent[0]);

      ws.simulateMessage({
        type: 'qr_session_ready',
        sessionId: sessionCreateEnvelope.sessionId,
        payload: { expiresAt: Date.now() + 120_000 },
      });
      await fixture.whenStable();

      ws.simulateMessage({ type: 'pair_approved', sessionId: sessionCreateEnvelope.sessionId });
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
