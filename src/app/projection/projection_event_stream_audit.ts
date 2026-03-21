import type { TransportEnvelope } from '../../transport/transport-envelope';
import type { ProjectionState } from './projection.models';
import { ProjectionEngine } from './projection_engine';
import { validateEventEnvelope } from './projection_event_validation';

export type EventStreamAuditResult = {
  readonly eventLog: readonly string[];
  readonly lastAppliedEventVersion: number | null;
  readonly resyncRequired: boolean;
  readonly orderingEvidence: readonly number[];
  readonly projectionEvidence: readonly string[];
  readonly state: ProjectionState;
};

export async function auditEventStream(
  engine: ProjectionEngine,
  envelopes: readonly TransportEnvelope[],
): Promise<EventStreamAuditResult> {
  const eventLog: string[] = [];
  const orderingEvidence: number[] = [];
  let resyncRequired = false;
  let lastAppliedEventVersion = engine.getLastAppliedEventVersion();

  for (const envelope of envelopes) {
    const validationResult = await validateEventEnvelope(envelope);
    if (validationResult.status === 'INVALID') {
      resyncRequired = true;
      eventLog.push(`REJECT invalid reason=${validationResult.reason}`);
      continue;
    }

    const result = engine.applyEvent(validationResult.eventEnvelope);
    lastAppliedEventVersion = result.lastAppliedEventVersion;

    switch (result.status) {
      case 'EVENT_APPLIED':
        eventLog.push(`APPLY eventVersion=${validationResult.eventEnvelope.eventVersion}`);
        orderingEvidence.push(validationResult.eventEnvelope.eventVersion);
        break;
      case 'EVENT_IGNORED_DUPLICATE':
        eventLog.push(`IGNORE duplicate eventVersion=${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'SNAPSHOT_RESYNC_REQUIRED':
        resyncRequired = true;
        eventLog.push(`RESYNC_REQUIRED gap at ${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
        eventLog.push(
          `IGNORE snapshot_not_applied eventVersion=${validationResult.eventEnvelope.eventVersion}`,
        );
        break;
      case 'EVENT_BUFFERED':
        eventLog.push(`BUFFER eventVersion=${validationResult.eventEnvelope.eventVersion}`);
        break;
      case 'SNAPSHOT_APPLIED':
        break;
    }
  }

  const state = engine.getProjectionState();

  return {
    eventLog,
    lastAppliedEventVersion,
    resyncRequired,
    orderingEvidence,
    projectionEvidence: collectProjectionEvidence(state),
    state,
  };
}

function collectProjectionEvidence(state: ProjectionState): string[] {
  return [
    ...state.threads.map((thread) => `thread:${thread.id}`),
    ...state.records.map((record) => `record:${record.id}`),
  ];
}