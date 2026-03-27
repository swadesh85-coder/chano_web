import type { ProjectionState } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';

export type ProjectionAuditEntity = 'folder' | 'thread' | 'record';

export type SnapshotSchemaBaseline = {
  readonly entity: ProjectionAuditEntity;
  readonly fields: readonly string[];
};

export type IncomingEventSchema = {
  readonly entity: ProjectionAuditEntity | null;
  readonly fields: readonly string[];
  readonly eventId: number | string | null;
  readonly sequence: number | null;
};

export type SchemaDiff = {
  readonly missingInEvent: readonly string[];
  readonly extraInEvent: readonly string[];
  readonly snapshotFields: readonly string[];
  readonly eventFields: readonly string[];
};

export function buildSnapshotSchemaBaselines(state: ProjectionState): readonly SnapshotSchemaBaseline[] {
  const baselines: SnapshotSchemaBaseline[] = [];

  const folder = state.folders[0];
  if (folder !== undefined) {
    baselines.push({
      entity: 'folder',
      fields: getRuntimeObjectFields(folder),
    });
  }

  const thread = state.threads[0];
  if (thread !== undefined) {
    baselines.push({
      entity: 'thread',
      fields: getRuntimeObjectFields(thread),
    });
  }

  const record = state.records[0];
  if (record !== undefined) {
    baselines.push({
      entity: 'record',
      fields: getRuntimeObjectFields(record),
    });
  }

  return baselines;
}

export function extractIncomingEventSchema(envelope: TransportEnvelope): IncomingEventSchema {
  const transportPayload = isRecord(envelope.payload) ? envelope.payload : null;
  const entity = normalizeProjectionAuditEntity(transportPayload?.['entityType']);
  const eventPayload = transportPayload?.['payload'];
  const eventId = readEventId(transportPayload?.['eventId']);

  return {
    entity,
    fields: getRuntimeObjectFields(eventPayload),
    eventId,
    sequence: typeof envelope.sequence === 'number' ? envelope.sequence : null,
  };
}

export function diffSchemaFields(
  snapshotFields: readonly string[],
  eventFields: readonly string[],
): SchemaDiff {
  const snapshot = [...snapshotFields].sort();
  const event = [...eventFields].sort();
  const snapshotSet = new Set(snapshot);
  const eventSet = new Set(event);

  return {
    missingInEvent: snapshot.filter((field) => !eventSet.has(field)),
    extraInEvent: event.filter((field) => !snapshotSet.has(field)),
    snapshotFields: snapshot,
    eventFields: event,
  };
}

export function formatAuditJson(label: string, payload: object): string {
  return `${label} ${JSON.stringify(payload)}`;
}

function getRuntimeObjectFields(value: unknown): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function normalizeProjectionAuditEntity(value: unknown): ProjectionAuditEntity | null {
  switch (value) {
    case 'folder':
    case 'thread':
    case 'record':
      return value;
    default:
      return null;
  }
}

function readEventId(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}