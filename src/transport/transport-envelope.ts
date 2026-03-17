export interface TransportEnvelope {
  readonly protocolVersion: 2;
  readonly type: string;
  readonly sessionId: string | null;
  readonly timestamp: number;
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
}
