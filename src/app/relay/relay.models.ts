export interface RelayEnvelope {
  type: string;
  sessionId: string | null;
  timestamp: number;
  payload: Record<string, unknown>;
}
