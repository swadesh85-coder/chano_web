export interface TransportEnvelope<TPayload extends object = Record<string, unknown>> {
  readonly protocolVersion: 2;
  readonly type: string;
  readonly sessionId: string | null;
  readonly timestamp: number;
  readonly sequence: number;
  readonly payload: TPayload;
}
