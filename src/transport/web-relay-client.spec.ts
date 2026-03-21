import { TestBed } from '@angular/core/testing';
import { WebRelayClient } from './web-relay-client';
import type { TransportEnvelope } from './transport-envelope';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  simulateMessage(envelope: TransportEnvelope): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  simulateRawFrame(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
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

describe('WebRelayClient', () => {
  let client: WebRelayClient;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    client = TestBed.inject(WebRelayClient);
  });

  afterEach(() => {
    client.disconnect();
  });

  it('web_relay_client_connect', () => {
    client.connect('wss://relay.chano.app');

    expect(MockWebSocket.last.url).toBe('wss://relay.chano.app');
    expect(client.state()).toBe('connecting');

    MockWebSocket.last.simulateOpen();

    expect(client.state()).toBe('connected');
  });

  it('session_id_generated', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const sessionId = client.sessionId();

    expect(sessionId).toMatch(UUID_V4_PATTERN);
  });

  it('web_relay_client_send_envelope', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const sessionId = client.sessionId();
    expect(sessionId).toMatch(UUID_V4_PATTERN);

    client.sendEnvelope('qr_session_create', { sessionId: sessionId! });
    client.sendEnvelope('pair_request', { sessionId: sessionId! });

    expect(JSON.parse(MockWebSocket.last.sent[0])).toEqual({
      protocolVersion: 2,
      type: 'qr_session_create',
      sessionId,
      timestamp: expect.any(Number),
      sequence: 1,
      payload: { sessionId },
    });
    expect(JSON.parse(MockWebSocket.last.sent[1])).toEqual({
      protocolVersion: 2,
      type: 'pair_request',
      sessionId,
      timestamp: expect.any(Number),
      sequence: 2,
      payload: { sessionId },
    });
  });

  it('transport_envelope_v2_only', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const sessionId = client.sessionId();
    client.sendEnvelope('qr_session_create', { sessionId: sessionId! });

    expect(JSON.parse(MockWebSocket.last.sent[0])['protocolVersion']).toBe(2);
  });

  it('timestamp_number_validation', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const sessionId = client.sessionId();
    client.sendEnvelope('qr_session_create', { sessionId: sessionId! });

    expect(typeof JSON.parse(MockWebSocket.last.sent[0])['timestamp']).toBe('number');
  });

  it('payload_schema_valid', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const sessionId = client.sessionId();

    expect(() => client.sendEnvelope('qr_session_create', { sessionId: sessionId! })).not.toThrow();
    expect(() => client.sendEnvelope('pair_request', { sessionId: sessionId! })).not.toThrow();
    expect(() => client.sendEnvelope('pair_request', {} as { sessionId: string })).toThrowError('INVALID_TRANSPORT_PAYLOAD');
  });

  it('web_relay_client_receive_envelope', () => {
    client.connect('wss://relay.chano.app');

    let received: TransportEnvelope | null = null;
    client.onEnvelope((envelope) => {
      received = envelope;
    });

    MockWebSocket.last.simulateMessage({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 1,
      payload: {},
    });

    expect(received).toEqual({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 1,
      payload: {},
    });
  });

  it('transport_parser_valid_envelope', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let received: TransportEnvelope | null = null;

    client.onEnvelope((envelope) => {
      received = envelope;
    });

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 3,
      payload: {
        operation: 'rename',
        entity: 'record',
        data: { uuid: 'record-1', body: 'Renamed body' },
      },
    });

    expect(received).toEqual({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 3,
      payload: {
        operation: 'rename',
        entity: 'record',
        data: { uuid: 'record-1', body: 'Renamed body' },
      },
    });
    expect(logSpy).toHaveBeenCalledWith('WEB_RELAY_ENVELOPE_RECEIVED type=event_stream');

    logSpy.mockRestore();
  });

  it('transport_parser_reject_invalid_envelope', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const handler = vi.fn();

    client.onEnvelope(handler);

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 1,
      type: 'event_stream',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 3,
      payload: {
        operation: 'rename',
        entity: 'record',
        data: { uuid: 'record-1', body: 'Renamed body' },
      },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith('WEB_RELAY_ENVELOPE_RECEIVED type=event_stream');

    logSpy.mockRestore();
  });

  it('transport_parser_payload_passthrough', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const payload = {
      operation: 'update',
      entity: 'record',
      data: {
        uuid: 'record-9',
        body: 'Opaque body',
        nested: {
          tags: ['alpha', 'beta'],
          metadata: { source: 'relay', revision: 4 },
        },
      },
    };

    const received: TransportEnvelope[] = [];
    client.onEnvelope((envelope) => {
      received.push(envelope);
    });

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId: 'session-9',
      timestamp: 1710000100,
      sequence: 9,
      payload,
    });

    expect(received).toHaveLength(1);

    const envelope = received[0]!;

    expect(envelope.payload).toEqual(payload);
    expect(envelope).toEqual({
      protocolVersion: 2,
      type: 'event_stream',
      sessionId: 'session-9',
      timestamp: 1710000100,
      sequence: 9,
      payload,
    });
  });

  it('web_relay_client_disconnect', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    client.disconnect();

    expect(client.state()).toBe('disconnected');
    expect(MockWebSocket.last.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('message_routing_control_vs_projection', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pairingHandler = vi.fn();
    const projectionHandler = vi.fn();
    const rawHandler = vi.fn();

    client.onPairingMessage(pairingHandler);
    client.onProjectionMessage(projectionHandler);
    client.onEnvelope(rawHandler);

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 2,
      type: 'protocol_handshake',
      sessionId: 'session-ctl',
      timestamp: 1710000000,
      sequence: 1,
      payload: {},
    });

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId: 'session-proj',
      timestamp: 1710000001,
      sequence: 2,
      payload: {
        snapshotId: 'snapshot-1',
        totalChunks: 1,
        totalBytes: 1,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 1,
        entityCount: 0,
        checksum: 'aa',
      },
    });

    expect(pairingHandler).toHaveBeenCalledTimes(1);
    expect(pairingHandler.mock.calls[0]?.[0]).toMatchObject({ type: 'protocol_handshake' });
    expect(projectionHandler).toHaveBeenCalledTimes(1);
    expect(projectionHandler.mock.calls[0]?.[0]).toMatchObject({ type: 'snapshot_start' });
    expect(rawHandler).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith('MESSAGE_ROUTED type=protocol_handshake target=pairing');
    expect(logSpy).toHaveBeenCalledWith('MESSAGE_ROUTED type=snapshot_start target=projection');

    logSpy.mockRestore();
  });

  it('snapshot_routed_to_projection', () => {
    client.connect('wss://relay.chano.app');
    MockWebSocket.last.simulateOpen();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const projectionHandler = vi.fn();
    const pairingHandler = vi.fn();

    client.onProjectionMessage(projectionHandler);
    client.onPairingMessage(pairingHandler);

    MockWebSocket.last.simulateRawFrame({
      protocolVersion: 2,
      type: 'snapshot_start',
      sessionId: 'session-1',
      timestamp: 1710000000,
      sequence: 1,
      payload: {
        snapshotId: 'snapshot-1',
        totalChunks: 1,
        totalBytes: 10,
        snapshotVersion: 1,
        protocolVersion: 2,
        schemaVersion: 1,
        baseEventVersion: 1,
        entityCount: 0,
        checksum: 'deadbeef',
      },
    });

    expect(projectionHandler).toHaveBeenCalledTimes(1);
    expect(pairingHandler).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('MESSAGE_ROUTED type=snapshot_start target=projection');

    logSpy.mockRestore();
  });
});
