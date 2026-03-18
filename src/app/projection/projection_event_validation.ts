import type { EventEntity, EventEnvelope, EventOperation } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';

export type EventValidationFailureReason = 'INVALID_TYPE' | 'INVALID_SCHEMA' | 'CHECKSUM_MISMATCH';

export type EventValidationResult =
  | {
      readonly status: 'VALID';
      readonly eventEnvelope: EventEnvelope;
    }
  | {
      readonly status: 'INVALID';
      readonly reason: EventValidationFailureReason;
    };

export async function validateEventEnvelope(
  envelope: TransportEnvelope,
): Promise<EventValidationResult> {
  if (envelope.type !== 'event_stream') {
    console.error('EVENT_REJECTED reason=INVALID_TYPE');
    return {
      status: 'INVALID',
      reason: 'INVALID_TYPE',
    };
  }

  const payload = envelope.payload;
  if (!hasExactKeys(payload, [
    'eventId',
    'originDeviceId',
    'eventVersion',
    'entityType',
    'entityId',
    'operation',
    'timestamp',
    'payload',
    'checksum',
  ])) {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const eventId = payload['eventId'];
  const originDeviceId = payload['originDeviceId'];
  const eventVersion = payload['eventVersion'];
  const entityType = payload['entityType'];
  const entityId = payload['entityId'];
  const operation = payload['operation'];
  const timestamp = payload['timestamp'];
  const eventPayload = payload['payload'];
  const checksum = payload['checksum'];

  if (
    typeof eventId !== 'string'
    || typeof originDeviceId !== 'string'
    || !isNonNegativeInteger(eventVersion)
    || typeof entityType !== 'string'
    || !isEventEntity(entityType)
    || typeof entityId !== 'string'
    || entityId.length === 0
    || typeof operation !== 'string'
    || !isEventOperation(operation)
    || typeof timestamp !== 'number'
    || !Number.isFinite(timestamp)
    || eventPayload === null
    || typeof eventPayload !== 'object'
    || Array.isArray(eventPayload)
    || typeof checksum !== 'string'
    || checksum.length === 0
  ) {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const canonicalPayload = eventPayload as Record<string, unknown>;
  if (
    !hasConsistentEntityId(entityId, canonicalPayload)
    || !isValidEventPayload(operation, entityType, canonicalPayload)
  ) {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const expectedChecksum = await sha256PayloadHex(canonicalPayload);
  if (expectedChecksum !== checksum.toLowerCase()) {
    console.error('EVENT_VALIDATION_FAILED reason=CHECKSUM_MISMATCH');
    return {
      status: 'INVALID',
      reason: 'CHECKSUM_MISMATCH',
    };
  }

  console.log(`EVENT_VALIDATION_SUCCESS eventVersion=${eventVersion}`);

  return {
    status: 'VALID',
    eventEnvelope: {
      eventId,
      originDeviceId,
      eventVersion,
      entityType,
      entityId,
      operation,
      timestamp,
      payload: canonicalPayload,
      checksum: checksum.toLowerCase(),
    },
  };
}

async function sha256PayloadHex(payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function isValidEventPayload(
  operation: EventOperation,
  entity: EventEntity,
  payload: Record<string, unknown>,
): boolean {
  switch (entity) {
    case 'folder':
    case 'imageGroup':
      return isValidFolderEventData(operation, payload);
    case 'thread':
      return isValidThreadEventData(operation, payload);
    case 'record':
      return isValidRecordEventData(operation, payload);
  }
}

function isValidFolderEventData(
  operation: EventOperation,
  data: Record<string, unknown>,
): boolean {
  switch (operation) {
    case 'create':
      return isValidFolderEntityData(data);
    case 'update':
      return hasAllowedKeys(data, ['uuid', 'name', 'parentFolderUuid'])
        && hasRequiredKeys(data, ['uuid'])
        && isUuid(data['uuid'])
        && isOptionalString(data['name'])
        && isOptionalNullableString(data['parentFolderUuid']);
    case 'rename':
      return hasExactKeys(data, ['uuid', 'name'])
        && isUuid(data['uuid'])
        && typeof data['name'] === 'string';
    case 'move':
      return hasExactKeys(data, ['uuid', 'parentFolderUuid'])
        && isUuid(data['uuid'])
        && isNullableString(data['parentFolderUuid']);
    case 'delete':
      return hasExactKeys(data, ['uuid']) && isUuid(data['uuid']);
  }
}

function isValidThreadEventData(
  operation: EventOperation,
  data: Record<string, unknown>,
): boolean {
  switch (operation) {
    case 'create':
      return isValidThreadEntityData(data);
    case 'update':
      return hasAllowedKeys(data, ['uuid', 'folderUuid', 'title'])
        && hasRequiredKeys(data, ['uuid'])
        && isUuid(data['uuid'])
        && isOptionalNullableString(data['folderUuid'])
        && isOptionalString(data['title']);
    case 'rename':
      return hasExactKeys(data, ['uuid', 'title'])
        && isUuid(data['uuid'])
        && typeof data['title'] === 'string';
    case 'move':
      return hasExactKeys(data, ['uuid', 'folderUuid'])
        && isUuid(data['uuid'])
        && isNullableString(data['folderUuid']);
    case 'delete':
      return hasExactKeys(data, ['uuid']) && isUuid(data['uuid']);
  }
}

function isValidRecordEventData(
  operation: EventOperation,
  data: Record<string, unknown>,
): boolean {
  switch (operation) {
    case 'create':
      return isValidRecordEntityData(data);
    case 'update':
      return hasAllowedKeys(data, [
        'uuid',
        'threadUuid',
        'type',
        'body',
        'createdAt',
        'editedAt',
        'orderIndex',
        'isStarred',
        'imageGroupId',
      ])
        && hasRequiredKeys(data, ['uuid'])
        && isUuid(data['uuid'])
        && isOptionalString(data['threadUuid'])
        && isOptionalString(data['type'])
        && isOptionalString(data['body'])
        && isOptionalNumber(data['createdAt'])
        && isOptionalNumber(data['editedAt'])
        && isOptionalNumber(data['orderIndex'])
        && isOptionalBoolean(data['isStarred'])
        && isOptionalNullableString(data['imageGroupId']);
    case 'rename':
      return hasExactKeys(data, ['uuid', 'body'])
        && isUuid(data['uuid'])
        && typeof data['body'] === 'string';
    case 'move':
      return hasExactKeys(data, ['uuid', 'threadUuid'])
        && isUuid(data['uuid'])
        && typeof data['threadUuid'] === 'string';
    case 'delete':
      return hasExactKeys(data, ['uuid']) && isUuid(data['uuid']);
  }
}

function isValidFolderEntityData(data: Record<string, unknown>): boolean {
  return hasExactKeys(data, ['uuid', 'name', 'parentFolderUuid'])
    && isUuid(data['uuid'])
    && typeof data['name'] === 'string'
    && isNullableString(data['parentFolderUuid']);
}

function isValidThreadEntityData(data: Record<string, unknown>): boolean {
  return hasExactKeys(data, ['uuid', 'folderUuid', 'title'])
    && isUuid(data['uuid'])
    && isNullableString(data['folderUuid'])
    && typeof data['title'] === 'string';
}

function isValidRecordEntityData(data: Record<string, unknown>): boolean {
  return hasExactKeys(data, [
    'uuid',
    'threadUuid',
    'type',
    'body',
    'createdAt',
    'editedAt',
    'orderIndex',
    'isStarred',
    'imageGroupId',
  ])
    && isUuid(data['uuid'])
    && typeof data['threadUuid'] === 'string'
    && typeof data['type'] === 'string'
    && typeof data['body'] === 'string'
    && typeof data['createdAt'] === 'number'
    && typeof data['editedAt'] === 'number'
    && typeof data['orderIndex'] === 'number'
    && typeof data['isStarred'] === 'boolean'
    && isNullableString(data['imageGroupId']);
}

function hasConsistentEntityId(entityId: string, payload: Record<string, unknown>): boolean {
  return !('uuid' in payload) || payload['uuid'] === entityId;
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasAllowedKeys(obj, keys) && hasRequiredKeys(obj, keys);
}

function hasAllowedKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(obj).every((key) => keys.includes(key));
}

function hasRequiredKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in obj);
}

function isEventEntity(value: string): value is EventEntity {
  return ['folder', 'thread', 'record', 'imageGroup'].includes(value);
}

function isEventOperation(value: string): value is EventOperation {
  return ['create', 'update', 'rename', 'move', 'delete'].includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}