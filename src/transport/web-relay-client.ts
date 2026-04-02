import { Injectable, NgZone, inject, signal } from '@angular/core';
import type { TransportEnvelope } from './transport-envelope';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const PAIRING_MESSAGE_TYPES = [
  'qr_session_ready',
  'pair_approved',
  'protocol_handshake',
  'session_close',
] as const;

const PROJECTION_MESSAGE_TYPES = [
  'snapshot_start',
  'snapshot_chunk',
  'snapshot_complete',
  'event_stream',
] as const;

const COMMAND_RESULT_MESSAGE_TYPES = ['command_result'] as const;

const TRANSPORT_PROTOCOL_VERSION = 2;

@Injectable({ providedIn: 'root' })
export class WebRelayClient {
  private readonly ngZone = inject(NgZone);
  private readonly envelopeHandlers = new Set<(envelope: TransportEnvelope) => void>();
  private readonly pairingHandlers = new Set<(envelope: TransportEnvelope) => void>();
  private readonly projectionHandlers = new Set<(envelope: TransportEnvelope) => void>();
  private readonly commandResultHandlers = new Set<(envelope: TransportEnvelope) => void>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();

  private ws: WebSocket | null = null;
  private outboundSequence = 1;
  private readonly transportAuditMetadata = new WeakMap<TransportEnvelope, {
    readonly rawFrame: string;
    readonly rawFrameHash: string;
  }>();
  private readonly projectionAuditMetadata = new WeakMap<TransportEnvelope, {
    readonly ingressHash: string;
    readonly payloadRef: Record<string, unknown>;
  }>();
  private readonly currentSessionId = signal<string | null>(null);
  private readonly currentSessionToken = signal<string | null>(null);

  readonly state = signal<ConnectionState>('disconnected');
  readonly lastError = signal<string | null>(null);
  readonly sessionId = this.currentSessionId.asReadonly();
  readonly sessionToken = this.currentSessionToken.asReadonly();

  connect(relayUrl: string): void {
    this.disconnect();
    this.lastError.set(null);
    this.state.set('connecting');
    this.generateSessionId();
    this.generateSessionToken();

    this.ngZone.runOutsideAngular(() => {
      const ws = new WebSocket(relayUrl);

      ws.onopen = () =>
        this.ngZone.run(() => {
          this.state.set('connected');
          this.emitState('connected');
          console.log(`WEB_RELAY_CONNECT ${relayUrl}`);
        });

      ws.onmessage = (event: MessageEvent) =>
        this.ngZone.run(() => {
          try {
            const rawMessage = getRawTransportFrame(event.data);
            if (rawMessage === null) {
              return;
            }

            console.log(`WS_MESSAGE_RECEIVED raw=${truncateForAudit(rawMessage, 200)} type=unknown sessionId=unknown`);
            const raw = JSON.parse(rawMessage) as unknown;
            const controlErrorReason = getControlErrorReason(raw);
            if (controlErrorReason !== null) {
              this.state.set('error');
              console.warn(`WEB_RELAY_CONTROL_ERROR reason=${controlErrorReason}`);
              this.emitError(controlErrorReason);
              return;
            }
            const envelope = this.parseEnvelope(raw);

            if (envelope !== null && this.isAuthorizedInboundEnvelope(envelope)) {
              this.captureTransportIngressAudit(rawMessage, envelope);
              this.captureProjectionIngressAudit(envelope);
              console.log(
                `WS_MESSAGE_PARSED type=${envelope.type} sessionId=${formatSessionId(envelope.sessionId)}`,
              );
              console.log(`WEB_RELAY_ENVELOPE_RECEIVED type=${envelope.type}`);
              console.log('TRANSPORT_ENVELOPE_PARSED', envelope);
              this.routeMessage(envelope);
            }
          } catch {
            // ignore malformed frames
          }
        });

      ws.onerror = () =>
        this.ngZone.run(() => {
          this.state.set('error');
          this.emitError('Failed to connect to relay server');
        });

      ws.onclose = () =>
        this.ngZone.run(() => {
          if (this.state() !== 'disconnected' && this.state() !== 'error') {
            this.state.set('error');
            this.emitError('Connection to relay lost');
          }
        });

      this.ws = ws;
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }

      this.ws = null;
    }

    this.state.set('disconnected');
    this.outboundSequence = 1;
    this.currentSessionId.set(null);
    this.currentSessionToken.set(null);
    this.emitState('disconnected');
  }

  sendEnvelope<TPayload extends object>(
    type: string,
    payload: TPayload,
  ): TransportEnvelope<TPayload> | null {
    if (type === 'protocol_handshake') {
      console.log(`WEB_SEND_ATTEMPT type=protocol_handshake sessionId=${formatSessionId(this.currentSessionId())}`);
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      return null;
    }

    const sessionId = this.ensureSessionId();
    const sessionToken = this.ensureSessionToken();
    const normalizedPayload = clonePayload(payload);
    assertOutboundPayloadShape(type, normalizedPayload as Record<string, unknown>, sessionId, sessionToken);

    const envelope: TransportEnvelope<TPayload> = {
      protocolVersion: TRANSPORT_PROTOCOL_VERSION,
      type,
      sessionId,
      timestamp: Date.now(),
      sequence: this.outboundSequence,
      payload: normalizedPayload,
    };

    this.outboundSequence += 1;

    this.ws.send(JSON.stringify(envelope));
    if (envelope.type === 'protocol_handshake') {
      console.log(`WEB_WS_SEND protocol_handshake sessionId=${formatSessionId(envelope.sessionId)}`);
      console.log(`WEB_WS_SEND type=protocol_handshake sessionId=${formatSessionId(envelope.sessionId)}`);
    }
    console.log(`WEB_SEND ${envelope.type} session=${envelope.sessionId} seq=${envelope.sequence}`);
    console.log(`RELAY_SEND type=${envelope.type} sequence=${envelope.sequence}`);
    if (envelope.type === 'mutation_command') {
      console.log(`RELAY_ROUTE web→mobile type=mutation_command session=${envelope.sessionId}`);
    }
    if (envelope.type === 'pair_request') {
      console.log(`PAIR_REQUEST_SENT session=${envelope.sessionId}`);
    }

    return envelope;
  }

  onEnvelope(handler: (envelope: TransportEnvelope) => void): () => void {
    this.envelopeHandlers.add(handler);
    return () => {
      this.envelopeHandlers.delete(handler);
    };
  }

  onPairingMessage(handler: (envelope: TransportEnvelope) => void): () => void {
    this.pairingHandlers.add(handler);
    return () => {
      this.pairingHandlers.delete(handler);
    };
  }

  onProjectionMessage(handler: (envelope: TransportEnvelope) => void): () => void {
    this.projectionHandlers.add(handler);
    return () => {
      this.projectionHandlers.delete(handler);
    };
  }

  onCommandResultMessage(handler: (envelope: TransportEnvelope) => void): () => void {
    this.commandResultHandlers.add(handler);
    return () => {
      this.commandResultHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  onError(handler: (message: string) => void): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  private parseEnvelope(raw: unknown): TransportEnvelope | null {
    if (raw === null || typeof raw !== 'object') {
      return null;
    }

    const envelope = raw as Record<string, unknown>;
    const protocolVersion = envelope['protocolVersion'];
    const type = envelope['type'];
    const sessionId = envelope['sessionId'];
    const timestamp = envelope['timestamp'];
    const sequence = envelope['sequence'];
    const payload = envelope['payload'];

    if (protocolVersion !== TRANSPORT_PROTOCOL_VERSION) {
      return null;
    }
    if (typeof type !== 'string' || type.length === 0) {
      return null;
    }
    if (sessionId !== null && typeof sessionId !== 'string') {
      return null;
    }
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return null;
    }
    if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
      return null;
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    return {
      protocolVersion: TRANSPORT_PROTOCOL_VERSION,
      type,
      sessionId,
      timestamp,
      sequence,
      payload: payload as Record<string, unknown>,
    };
  }

  private generateSessionId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = globalThis.crypto.randomUUID();
      if (!isUuidV4(sessionId)) {
        continue;
      }

      this.currentSessionId.set(sessionId);
      this.outboundSequence = 1;
      console.log(`WEB_SESSION_CREATED sessionId=${sessionId}`);
      return sessionId;
    }

    throw new Error('SESSION_ID_GENERATION_FAILED');
  }

  private ensureSessionId(): string {
    const sessionId = this.currentSessionId() ?? this.generateSessionId();
    if (!isUuidV4(sessionId)) {
      throw new Error('INVALID_SESSION_ID');
    }

    return sessionId;
  }

  private generateSessionToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionToken = globalThis.crypto.randomUUID();
      if (!isNonEmptyString(sessionToken)) {
        continue;
      }

      this.currentSessionToken.set(sessionToken);
      return sessionToken;
    }

    throw new Error('SESSION_TOKEN_GENERATION_FAILED');
  }

  private ensureSessionToken(): string {
    const sessionToken = this.currentSessionToken() ?? this.generateSessionToken();
    if (!isNonEmptyString(sessionToken)) {
      throw new Error('INVALID_SESSION_TOKEN');
    }

    return sessionToken;
  }

  private emitState(state: ConnectionState): void {
    for (const handler of this.stateHandlers) {
      handler(state);
    }
  }

  private emitError(message: string): void {
    this.lastError.set(message);
    for (const handler of this.errorHandlers) {
      handler(message);
    }
  }

  private routeMessage(envelope: TransportEnvelope): void {
    try {
      if (isPairingMessageType(envelope.type)) {
        console.log(`MESSAGE_ROUTED type=${envelope.type} target=pairing`);
        for (const handler of this.pairingHandlers) {
          handler(envelope);
        }
      }

      if (isProjectionMessageType(envelope.type)) {
        this.emitProjectionEgressAudit(envelope);
        console.log(`MESSAGE_ROUTED type=${envelope.type} target=projection`);
        for (const handler of this.projectionHandlers) {
          handler(envelope);
        }
      }

      if (isCommandResultMessageType(envelope.type)) {
        console.log(`MESSAGE_ROUTED type=${envelope.type} target=command_result`);
        for (const handler of this.commandResultHandlers) {
          handler(envelope);
        }
        return;
      }

      for (const handler of this.envelopeHandlers) {
        handler(envelope);
      }
    } finally {
      this.transportAuditMetadata.delete(envelope);
    }
  }

  private isAuthorizedInboundEnvelope(envelope: TransportEnvelope): boolean {
    const currentSessionId = this.currentSessionId();
    if (envelope.sessionId === currentSessionId) {
      return true;
    }

    console.warn(
      `TRANSPORT_SESSION_REJECTED type=${envelope.type} expected=${formatSessionId(currentSessionId)} actual=${formatSessionId(envelope.sessionId)}`,
    );
    return false;
  }

  private captureTransportIngressAudit(rawFrame: string, envelope: TransportEnvelope): void {
    const rawFrameHash = hashStringForAudit(rawFrame);
    this.transportAuditMetadata.set(envelope, {
      rawFrame,
      rawFrameHash,
    });
    console.log(
      `TRANSPORT_FRAME_HASH ${JSON.stringify({ type: envelope.type, sequence: envelope.sequence, hash: rawFrameHash })}`,
    );
  }

  private captureProjectionIngressAudit(envelope: TransportEnvelope): void {
    if (!isProjectionMessageType(envelope.type)) {
      return;
    }

    const payloadRef = envelope.payload as Record<string, unknown>;
    const ingressHash = hashObjectForAudit(payloadRef);
    this.projectionAuditMetadata.set(envelope, {
      ingressHash,
      payloadRef,
    });
    console.log(`RELAY_INGRESS_HASH ${JSON.stringify({ type: envelope.type, sequence: envelope.sequence, hash: ingressHash })}`);
  }

  private emitProjectionEgressAudit(envelope: TransportEnvelope): void {
    const metadata = this.projectionAuditMetadata.get(envelope);
    const egressHash = hashObjectForAudit(envelope.payload as Record<string, unknown>);

    console.log(`RELAY_EGRESS_HASH ${JSON.stringify({ type: envelope.type, sequence: envelope.sequence, hash: egressHash })}`);
    console.log(`PAYLOAD_REFERENCE_EQUALITY ${String(metadata?.payloadRef === envelope.payload)}`);

    if (metadata && metadata.ingressHash !== egressHash) {
      console.error(`RELAY_PAYLOAD_HASH_MISMATCH ${JSON.stringify({ type: envelope.type, sequence: envelope.sequence, ingressHash: metadata.ingressHash, egressHash })}`);
    }

    this.projectionAuditMetadata.delete(envelope);
  }
}

function truncateForAudit(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').slice(0, limit);
}

function getRawTransportFrame(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getControlErrorReason(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const frame = value as Record<string, unknown>;
  if (frame['type'] !== 'control_error') {
    return null;
  }

  const payload = frame['payload'];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Relay control error';
  }

  const payloadRecord = payload as Record<string, unknown>;
  const reason = payloadRecord['reason'];
  return typeof reason === 'string' && reason.length > 0 ? reason : 'Relay control error';
}

function formatSessionId(sessionId: string | null): string {
  return sessionId ?? 'null';
}

function isPairingMessageType(type: string): type is (typeof PAIRING_MESSAGE_TYPES)[number] {
  return (PAIRING_MESSAGE_TYPES as readonly string[]).includes(type);
}

function isProjectionMessageType(type: string): type is (typeof PROJECTION_MESSAGE_TYPES)[number] {
  return (PROJECTION_MESSAGE_TYPES as readonly string[]).includes(type);
}

function isCommandResultMessageType(type: string): type is (typeof COMMAND_RESULT_MESSAGE_TYPES)[number] {
  return (COMMAND_RESULT_MESSAGE_TYPES as readonly string[]).includes(type);
}

function assertOutboundPayloadShape(
  type: string,
  payload: Record<string, unknown>,
  sessionId: string,
  sessionToken: string,
): void {
  switch (type) {
    case 'qr_session_create':
    case 'pair_request': {
      if (
        !hasExactKeys(payload, ['sessionId', 'token'])
        || payload['sessionId'] !== sessionId
        || payload['token'] !== sessionToken
      ) {
        throw new Error('INVALID_TRANSPORT_PAYLOAD');
      }
      return;
    }
    default: {
      if (payload === null || Array.isArray(payload)) {
        throw new Error('INVALID_TRANSPORT_PAYLOAD');
      }
    }
  }
}

function hasExactKeys(input: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const inputKeys = Object.keys(input).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();

  return inputKeys.length === normalizedExpectedKeys.length
    && inputKeys.every((key, index) => key === normalizedExpectedKeys[index]);
}

function clonePayload<TPayload extends object>(payload: TPayload): TPayload {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload);
  }

  return JSON.parse(JSON.stringify(payload)) as TPayload;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hashObjectForAudit(value: Record<string, unknown>): string {
  return hashStringForAudit(JSON.stringify(value));
}

function hashStringForAudit(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
