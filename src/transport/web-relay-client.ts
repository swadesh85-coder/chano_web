import { Injectable, NgZone, inject, signal } from '@angular/core';
import type { TransportEnvelope } from './transport-envelope';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const TRANSPORT_PROTOCOL_VERSION = 2;

@Injectable({ providedIn: 'root' })
export class WebRelayClient {
  private readonly ngZone = inject(NgZone);
  private readonly envelopeHandlers = new Set<(envelope: TransportEnvelope) => void>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();

  private ws: WebSocket | null = null;
  private outboundSequence = 1;

  readonly state = signal<ConnectionState>('disconnected');
  readonly lastError = signal<string | null>(null);

  connect(relayUrl: string): void {
    this.disconnect();
    this.lastError.set(null);
    this.state.set('connecting');

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
            const raw = JSON.parse(String(event.data)) as unknown;
            const envelope = this.parseEnvelope(raw);

            if (envelope !== null) {
              console.log(`WEB_RELAY_ENVELOPE_RECEIVED type=${envelope.type}`);
              for (const handler of this.envelopeHandlers) {
                handler(envelope);
              }
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
    this.emitState('disconnected');
  }

  createEnvelope(
  type: string,
  payload: Record<string, unknown> = {},
  sessionId: string | null = null,
): TransportEnvelope {
  return {
    protocolVersion: TRANSPORT_PROTOCOL_VERSION,
    type,
    sessionId: sessionId ?? crypto.randomUUID(),
    timestamp: Date.now(),
    sequence: this.outboundSequence++,
    payload,
  };
}

  sendEnvelope(envelope: TransportEnvelope): TransportEnvelope | null {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return null;
    }

    this.ws.send(JSON.stringify(envelope));
    console.log(`RELAY_SEND type=${envelope.type} sequence=${envelope.sequence}`);
    return envelope;
  }

  onEnvelope(handler: (envelope: TransportEnvelope) => void): () => void {
    this.envelopeHandlers.add(handler);
    return () => {
      this.envelopeHandlers.delete(handler);
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
}
