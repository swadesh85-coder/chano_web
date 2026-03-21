import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PairingComponent } from '../app/pairing/pairing';
import { ProjectionStore } from '../app/projection/projection.store';
import { CommandResultHandler } from './command-result-handler';
import { MutationCommandSender } from './mutation-command-sender';
import { WebRelayClient } from './web-relay-client';
import type { TransportEnvelope } from './transport-envelope';
import QRCode from 'qrcode';

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

const OriginalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  (globalThis as Record<string, unknown>)['WebSocket'] =
    MockWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

describe('Web transport runtime audit', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<PairingComponent>>;
  let client: WebRelayClient;
  let commandResults: CommandResultHandler;
  let sender: MutationCommandSender;
  let projection: ProjectionStore;
  let router: Router;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let capturedLogs: unknown[][];

  beforeEach(async () => {
    capturedLogs = [];

    await TestBed.configureTestingModule({
      imports: [PairingComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(QRCode, 'toDataURL').mockImplementation(
      (() => Promise.resolve('data:image/png;base64,RUNTIME-AUDIT')) as typeof QRCode.toDataURL,
    );

    const originalLog = console.log;
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args);
      originalLog(...args);
    });

    fixture = TestBed.createComponent(PairingComponent);
    client = TestBed.inject(WebRelayClient);
    commandResults = TestBed.inject(CommandResultHandler);
    sender = TestBed.inject(MutationCommandSender);
    projection = TestBed.inject(ProjectionStore);
  });

  afterEach(() => {
    fixture.destroy();
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function parsedEnvelope(type: string): TransportEnvelope {
    const match = capturedLogs.find(
      (entry) => entry[0] === 'TRANSPORT_ENVELOPE_PARSED' && isEnvelopeOfType(entry[1], type),
    );

    expect(match).toBeDefined();
    return match?.[1] as TransportEnvelope;
  }

  function isEnvelopeOfType(value: unknown, type: string): value is TransportEnvelope {
    return value !== null
      && typeof value === 'object'
      && 'type' in value
      && (value as TransportEnvelope).type === type;
  }

  async function establishRelaySession(): Promise<string> {
    fixture.detectChanges();

    const ws = MockWebSocket.last;
    ws.simulateOpen();

    const outboundSessionId = JSON.parse(ws.sent[0] as string)['sessionId'] as string;

    const sessionReadyEnvelope: TransportEnvelope = {
      protocolVersion: 2,
      type: 'qr_session_ready',
      sessionId: outboundSessionId,
      timestamp: 1_710_000_001,
      sequence: 1,
      payload: { expiresAt: Date.now() + 120_000 },
    };

    ws.simulateEnvelope(sessionReadyEnvelope);
    await fixture.whenStable();

    ws.simulateEnvelope({
      protocolVersion: 2,
      type: 'pair_approved',
      sessionId: outboundSessionId,
      timestamp: 1_710_000_002,
      sequence: 2,
      payload: {},
    });

    ws.simulateEnvelope({
      protocolVersion: 2,
      type: 'protocol_handshake',
      sessionId: outboundSessionId,
      timestamp: 1_710_000_002.5,
      sequence: 3,
      payload: {},
    });

    return sessionReadyEnvelope.sessionId as string;
  }

  async function seedProjectionSnapshot(sessionId: string): Promise<void> {
    const ws = MockWebSocket.last;
    const snapshotJson = JSON.stringify({
      folders: [
        {
          entityType: 'folder',
          entityUuid: 'folder-1',
          entityVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'folder-1',
            name: 'Inbox',
            parentFolderUuid: null,
          },
        },
      ],
      threads: [],
      records: [],
    });
    const snapshotBytes = encodeUtf8(snapshotJson);
    const checksum = await sha256Hex(snapshotBytes);

    ws.simulateEnvelope({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId,
      timestamp: 1_710_000_003,
      sequence: 4,
      payload: {
        snapshotId: 'snapshot-runtime-1',
        totalChunks: 1,
        totalBytes: snapshotBytes.byteLength,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 5,
        entityCount: 1,
        checksum,
      },
    });

    ws.simulateEnvelope({
      protocolVersion: 2,
      type: 'snapshot_chunk',
      sessionId,
      timestamp: 1_710_000_004,
      sequence: 5,
      payload: {
        index: 0,
        data: toBase64(snapshotBytes),
      },
    });

    ws.simulateEnvelope({
      protocolVersion: 2,
      type: 'snapshot_complete',
      sessionId,
      timestamp: 1_710_000_005,
      sequence: 6,
      payload: { totalChunks: 1 },
    });

    await fixture.whenStable();
    await Promise.resolve();
  }

  it('web_relay_client_connection_runtime', async () => {
    const sessionId = await establishRelaySession();

    expect(MockWebSocket.last.url).toBe('ws://172.20.10.3:8080/relay');
    expect(JSON.parse(MockWebSocket.last.sent[0] as string)).toEqual({
      protocolVersion: 2,
      type: 'qr_session_create',
      sessionId,
      timestamp: expect.any(Number),
      sequence: 1,
      payload: {
        sessionId,
      },
    });
    expect(JSON.parse(MockWebSocket.last.sent[1] as string)).toEqual({
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

    expect(capturedLogs).toContainEqual(['WEB_RELAY_CONNECT ws://172.20.10.3:8080/relay']);
    expect(capturedLogs).toContainEqual([`WEB_SEND qr_session_create session=${sessionId} seq=1`]);
    expect(capturedLogs).toContainEqual(['RELAY_ACCEPTED type=qr_session_create']);
    expect(capturedLogs).toContainEqual([`WEB_SESSION_CREATED sessionId=${sessionId}`]);
    expect(capturedLogs).toContainEqual(['MESSAGE_ROUTED type=protocol_handshake target=pairing']);
    expect(capturedLogs).toContainEqual([`PROTOCOL_HANDSHAKE_RECEIVED sessionId=${sessionId}`]);
    expect(capturedLogs).toContainEqual([`WEB_SEND protocol_handshake sessionId=${sessionId}`]);
    expect(capturedLogs).toContainEqual([`WEB_WS_SEND protocol_handshake sessionId=${sessionId}`]);
  });

  it('transport_envelope_parser_runtime', async () => {
    const sessionId = await establishRelaySession();
    await seedProjectionSnapshot(sessionId);

    MockWebSocket.last.simulateEnvelope({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId,
      timestamp: 1_710_000_006,
      sequence: 7,
      payload: {
        operation: 'create',
        entity: 'thread',
        data: {
          uuid: 'thread-43',
          folderUuid: 'folder-1',
          title: 'From event stream',
        },
      },
    });

    expect(parsedEnvelope('snapshot_start')).toEqual({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId,
      timestamp: 1_710_000_003,
      sequence: 4,
      payload: {
        snapshotId: 'snapshot-runtime-1',
        totalChunks: 1,
        totalBytes: expect.any(Number),
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 5,
        entityCount: 1,
        checksum: expect.any(String),
      },
    });

    expect(parsedEnvelope('snapshot_chunk')).toEqual({
      protocolVersion: 2,
      type: 'snapshot_chunk',
      sessionId,
      timestamp: 1_710_000_004,
      sequence: 5,
      payload: {
        index: 0,
        data: expect.any(String),
      },
    });

    expect(parsedEnvelope('event_stream')).toEqual({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId,
      timestamp: 1_710_000_006,
      sequence: 7,
      payload: {
        operation: 'create',
        entity: 'thread',
        data: {
          uuid: 'thread-43',
          folderUuid: 'folder-1',
          title: 'From event stream',
        },
      },
    });
    expect(capturedLogs).toContainEqual(['MESSAGE_ROUTED type=snapshot_start target=projection']);
  });

  it('mutation_command_send', async () => {
    const sessionId = await establishRelaySession();
    const commandId = '123e4567-e89b-42d3-a456-426614174001';

    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(commandId);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const envelope = sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Draft from web',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });

    expect(envelope).toEqual({
      protocolVersion: 2,
      type: 'mutation_command',
      sessionId,
      timestamp: 1_710_000_000,
      sequence: 3,
      payload: {
        commandId,
        originDeviceId: expect.stringMatching(/^web-/),
        entityType: 'thread',
        entityId: null,
        operation: 'create',
        expectedVersion: 0,
        timestamp: 1_710_000_000,
        payload: {
          title: 'Draft from web',
          kind: 'manual',
          folderId: 'folder-1',
        },
      },
    });

    expect(JSON.parse(MockWebSocket.last.sent[2] as string)).toEqual(envelope);
    expect((envelope?.payload.payload as Record<string, unknown>)['uuid']).toBeUndefined();
    expect(capturedLogs).toContainEqual([`MUTATION_SEND commandId=${commandId} entity=thread op=create entityId=null`]);
    expect(capturedLogs).toContainEqual([`RELAY_ROUTE web→mobile type=mutation_command session=${sessionId}`]);
  });

  it('command_result_handling', async () => {
    const sessionId = await establishRelaySession();
    const commandId = '123e4567-e89b-42d3-a456-426614174001';

    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(commandId);
    sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Draft from web',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });

    MockWebSocket.last.simulateEnvelope({
      protocolVersion: 2,
      type: 'command_result',
      sessionId,
      timestamp: 1_710_000_006,
      sequence: 6,
      payload: {
        commandId,
        status: 'applied',
        message: 'Applied on mobile',
      },
    });

    expect(commandResults.getResult(commandId)).toEqual({
      commandId,
      status: 'applied',
      message: 'Applied on mobile',
    });
    expect(capturedLogs).toContainEqual([`COMMAND_RESULT_RECEIVED commandId=${commandId} status=applied`]);
  });

  it('pairing_success', async () => {
    const sessionId = await establishRelaySession();

    expect(capturedLogs).toContainEqual([`WEB_SEND qr_session_create session=${sessionId} seq=1`]);
    expect(capturedLogs).toContainEqual([`WEB_SEND protocol_handshake sessionId=${sessionId}`]);
    expect(capturedLogs).toContainEqual([`WEB_WS_SEND protocol_handshake sessionId=${sessionId}`]);
    expect(capturedLogs).toContainEqual(['PAIR_APPROVED received']);
  });

  it('no_optimistic_update', async () => {
    const sessionId = await establishRelaySession();
    await seedProjectionSnapshot(sessionId);
    const generatedEntityId = 'generated-by-mobile';
    const commandId = '123e4567-e89b-42d3-a456-426614174001';

    const beforeMutation = {
      folders: projection.folders().length,
      threads: projection.threads().length,
      records: projection.records().length,
    };

    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(commandId);

    sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Awaiting authority',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });

    const afterOutboundCommand = {
      folders: projection.folders().length,
      threads: projection.threads().length,
      records: projection.records().length,
    };

    const localStateMutation =
      beforeMutation.folders !== afterOutboundCommand.folders
      || beforeMutation.threads !== afterOutboundCommand.threads
      || beforeMutation.records !== afterOutboundCommand.records;

    console.log(`LOCAL_STATE_MUTATION ${localStateMutation}`);

    expect(localStateMutation).toBe(false);
    expect(projection.threads().length).toBe(0);

    MockWebSocket.last.simulateEnvelope({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId,
      timestamp: 1_710_000_007,
      sequence: 7,
      payload: {
        operation: 'create',
        entity: 'thread',
        data: {
          uuid: generatedEntityId,
          folderUuid: 'folder-1',
          title: 'Awaiting authority',
        },
      },
    });

    expect(projection.threads()).toEqual([
      {
        id: generatedEntityId,
        folderId: 'folder-1',
        title: 'Awaiting authority',
      },
    ]);

    const constitution = {
      mobileAuthority: projection.threads()[0]?.id === generatedEntityId,
      mutationBoundary: !localStateMutation,
      eventOrdering: parsedEnvelope('event_stream').sequence === 7,
      relayNeutrality: parsedEnvelope('snapshot_chunk').protocolVersion === 2,
      projectionSafety: !localStateMutation,
    };

    console.log(`Mobile Authority -> ${constitution.mobileAuthority ? 'PASS' : 'FAIL'}`);
    console.log(`Mutation Boundary -> ${constitution.mutationBoundary ? 'PASS' : 'FAIL'}`);
    console.log(`Event Ordering -> ${constitution.eventOrdering ? 'PASS' : 'FAIL'}`);
    console.log(`Relay Neutrality -> ${constitution.relayNeutrality ? 'PASS' : 'FAIL'}`);
    console.log(`Projection Safety -> ${constitution.projectionSafety ? 'PASS' : 'FAIL'}`);

    expect(constitution).toEqual({
      mobileAuthority: true,
      mutationBoundary: true,
      eventOrdering: true,
      relayNeutrality: true,
      projectionSafety: true,
    });
  });
});