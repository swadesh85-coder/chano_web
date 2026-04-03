import type { EventEntity, EventEnvelope, EventOperation } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { extractIncomingEventSchema, formatAuditJson } from './projection_schema_audit';

export type EventValidationFailureReason = 'INVALID_TYPE' | 'INVALID_SCHEMA' | 'CHECKSUM_MISMATCH';

export type EventValidationResult =
  | {
      readonly status: 'VALID';
      readonly eventEnvelope: EventEnvelope;
      readonly correlationCommandId: string | null;
    }
  | {
      readonly status: 'INVALID';
      readonly reason: EventValidationFailureReason;
    };

export type EventStartBoundaryValidationResult =
  | {
      readonly status: 'VALID';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'INVALID';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    };

export type EventSequenceValidationResult =
  | {
      readonly status: 'APPLY';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'IGNORE_DUPLICATE';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'RESYNC_REQUIRED';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    };

type PayloadNormalizationResult =
  | {
      readonly status: 'VALID';
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly status: 'INVALID';
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

  const incomingSchema = extractIncomingEventSchema(envelope);
  if (incomingSchema.entity !== null) {
    console.log(formatAuditJson('EVENT_SCHEMA_INCOMING', incomingSchema));
  }

  const payload = envelope.payload;
  if (!hasRequiredKeys(payload, [
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
    !isEventId(eventId)
    || typeof originDeviceId !== 'string'
    || !isNonNegativeInteger(eventVersion)
    || typeof entityType !== 'string'
    || !isEventEntity(entityType)
    || typeof entityId !== 'string'
    || entityId.length === 0
    || typeof operation !== 'string'
    || !isEventOperation(operation)
    || !isEventTimestamp(timestamp)
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

  const rawPayload = eventPayload as Record<string, unknown>;
  const correlationCommandId = parseCorrelationCommandId(rawPayload);
  if (correlationCommandId === undefined) {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const normalizedEventTimestamp = normalizeEventTimestamp(timestamp);
  if (normalizedEventTimestamp === null) {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const normalizedPayload = normalizeEventPayload(
    entityType,
    entityId,
    operation,
    rawPayload,
    normalizedEventTimestamp,
  );
  if (normalizedPayload.status !== 'VALID') {
    console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
    return {
      status: 'INVALID',
      reason: 'INVALID_SCHEMA',
    };
  }

  const canonicalPayload = normalizedPayload.payload;
  console.log(formatAuditJson('EVENT_SCHEMA_CANONICAL', {
    entity: entityType,
    fields: Object.keys(canonicalPayload).sort(),
    eventId,
    sequence: typeof envelope.sequence === 'number' ? envelope.sequence : null,
  }));
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

  const expectedChecksum = await sha256PayloadHex(rawPayload);
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
    correlationCommandId: correlationCommandId ?? null,
  };
}

export function validateStartBoundary(
  baseEventVersion: number,
  eventEnvelope: EventEnvelope,
): EventStartBoundaryValidationResult {
  const expectedEventVersion = baseEventVersion + 1;
  const receivedEventVersion = eventEnvelope.eventVersion;

  console.log(
    `BOUNDARY_CHECK expected=${expectedEventVersion} received=${receivedEventVersion}`,
  );

  const validation = validateEventSequence(baseEventVersion, eventEnvelope);
  if (validation.status !== 'APPLY') {
    return {
      status: 'INVALID',
      expectedEventVersion: validation.expectedEventVersion,
      receivedEventVersion: validation.receivedEventVersion,
    };
  }

  console.log(`BOUNDARY_OK start=${receivedEventVersion}`);

  return {
    status: 'VALID',
    expectedEventVersion,
    receivedEventVersion,
  };
}

export function validateEventSequence(
  lastAppliedEventVersion: number,
  eventEnvelope: EventEnvelope,
): EventSequenceValidationResult {
  const expectedEventVersion = lastAppliedEventVersion + 1;
  const receivedEventVersion = eventEnvelope.eventVersion;

  if (receivedEventVersion === expectedEventVersion) {
    return {
      status: 'APPLY',
      expectedEventVersion,
      receivedEventVersion,
    };
  }

  if (receivedEventVersion <= lastAppliedEventVersion) {
    return {
      status: 'IGNORE_DUPLICATE',
      expectedEventVersion,
      receivedEventVersion,
    };
  }

  return {
    status: 'RESYNC_REQUIRED',
    expectedEventVersion,
    receivedEventVersion,
  };
}

function parseCorrelationCommandId(payload: Record<string, unknown>): string | null | undefined {
  if (!('commandId' in payload)) {
    return null;
  }

  const commandId = payload['commandId'];
  if (typeof commandId !== 'string' || commandId.length === 0) {
    return undefined;
  }

  return commandId;
}

function sanitizeEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!('commandId' in payload)) {
    return payload;
  }

  const { commandId: _correlationCommandId, ...sanitized } = payload;
  return sanitized;
}

function normalizeEventPayload(
  entityType: EventEntity,
  entityId: string,
  operation: EventOperation,
  payload: Record<string, unknown>,
  eventTimestampMs: number,
): PayloadNormalizationResult {
  const sanitizedPayload = sanitizeEventPayload(payload);

  switch (entityType) {
    case 'folder':
    case 'imageGroup':
      return normalizeCanonicalFolderPayload(entityId, operation, sanitizedPayload);
    case 'thread':
      return normalizeCanonicalThreadPayload(entityId, operation, sanitizedPayload);
    case 'record':
      return normalizeCanonicalRecordPayload(entityId, operation, sanitizedPayload, eventTimestampMs);
  }
}

function normalizeCanonicalFolderPayload(
  _entityId: string,
  _operation: EventOperation,
  payload: Record<string, unknown>,
): PayloadNormalizationResult {
  return {
    status: 'VALID',
    payload,
  };
}

function normalizeCanonicalThreadPayload(
  entityId: string,
  operation: EventOperation,
  payload: Record<string, unknown>,
): PayloadNormalizationResult {
  const normalizedId = normalizeEntityId(entityId, payload);
  if (normalizedId === null) {
    return { status: 'INVALID' };
  }

  if (operation === 'create' || operation === 'update') {
    const normalizedTitle = readOptionalStringAlias(payload, ['title']);
    const normalizedFolderId = readOptionalNormalizedFolderAlias(payload, ['folderId', 'folderUuid']);

    if (operation === 'create' && (normalizedTitle === undefined || normalizedFolderId === undefined)) {
      return { status: 'INVALID' };
    }

    const normalizedPayload: Record<string, unknown> = { id: normalizedId };

    if (normalizedTitle !== undefined) {
      normalizedPayload['title'] = normalizedTitle;
    }

    if (normalizedFolderId !== undefined) {
      normalizedPayload['folderId'] = normalizedFolderId;
    }

    return {
      status: 'VALID',
      payload: normalizedPayload,
    };
  }

  return {
    status: 'VALID',
    payload,
  };
}

function normalizeCanonicalRecordPayload(
  entityId: string,
  operation: EventOperation,
  payload: Record<string, unknown>,
  eventTimestampMs: number,
): PayloadNormalizationResult {
  const normalizedId = normalizeEntityId(entityId, payload);
  if (normalizedId === null) {
    return { status: 'INVALID' };
  }

  const normalizedPayload: Record<string, unknown> = { id: normalizedId };

  const normalizedThreadId = readOptionalStringAlias(payload, ['threadId', 'threadUuid']);
  if (normalizedThreadId !== undefined) {
    normalizedPayload['threadId'] = normalizedThreadId;
  }

  const normalizedType = readOptionalStringAlias(payload, ['type']);
  if (normalizedType !== undefined) {
    normalizedPayload['type'] = normalizedType;
  }

  const normalizedName = readOptionalStringAlias(payload, ['name', 'body', 'text']);
  if (normalizedName !== undefined) {
    normalizedPayload['name'] = normalizedName;
  }

  const normalizedCreatedAt = readOptionalTimestampAlias(payload, ['createdAt']);
  const normalizedEditedAt = readOptionalTimestampAlias(payload, ['editedAt']);

  if (operation === 'create') {
    normalizedPayload['createdAt'] = normalizedCreatedAt ?? eventTimestampMs;
    normalizedPayload['editedAt'] = normalizedEditedAt ?? normalizedPayload['createdAt'];

    const normalizedOrderIndex = readOptionalNumberAlias(payload, ['orderIndex']);
    if (normalizedOrderIndex === undefined) {
      return { status: 'INVALID' };
    }

    normalizedPayload['orderIndex'] = normalizedOrderIndex;
    normalizedPayload['isStarred'] = readOptionalBooleanAlias(payload, ['isStarred']) ?? false;
    normalizedPayload['imageGroupId'] = readOptionalNullableStringAlias(payload, ['imageGroupId']) ?? null;
  } else {
    if (normalizedCreatedAt !== undefined) {
      normalizedPayload['createdAt'] = normalizedCreatedAt;
    }

    if (normalizedEditedAt !== undefined) {
      normalizedPayload['editedAt'] = normalizedEditedAt;
    } else if (operation === 'update' || operation === 'rename') {
      normalizedPayload['editedAt'] = eventTimestampMs;
    }

    const normalizedOrderIndex = readOptionalNumberAlias(payload, ['orderIndex']);
    if (normalizedOrderIndex !== undefined) {
      normalizedPayload['orderIndex'] = normalizedOrderIndex;
    }

    const normalizedIsStarred = readOptionalBooleanAlias(payload, ['isStarred']);
    if (normalizedIsStarred !== undefined) {
      normalizedPayload['isStarred'] = normalizedIsStarred;
    }

    const normalizedImageGroupId = readOptionalNullableStringAlias(payload, ['imageGroupId']);
    if (normalizedImageGroupId !== undefined) {
      normalizedPayload['imageGroupId'] = normalizedImageGroupId;
    }
  }

  const normalizedMediaId = readOptionalStringAlias(payload, ['mediaId']);
  if (normalizedMediaId !== undefined) {
    normalizedPayload['mediaId'] = normalizedMediaId;
  }

  const normalizedMimeType = readOptionalStringAlias(payload, ['mimeType']);
  if (normalizedMimeType !== undefined) {
    normalizedPayload['mimeType'] = normalizedMimeType;
  }

  const normalizedTitle = readOptionalStringAlias(payload, ['title']);
  if (normalizedTitle !== undefined) {
    normalizedPayload['title'] = normalizedTitle;
  }

  const normalizedSize = readOptionalNullableNumberAlias(payload, ['size']);
  if (normalizedSize !== undefined) {
    normalizedPayload['size'] = normalizedSize;
  }

  return {
    status: 'VALID',
    payload: normalizedPayload,
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
      return hasAllowedKeys(data, ['id', 'name', 'parentId'])
        && hasRequiredKeys(data, ['id'])
        && isUuid(data['id'])
        && isOptionalString(data['name'])
        && isOptionalNullableString(data['parentId']);
    case 'rename':
      return hasExactKeys(data, ['id', 'name'])
        && isUuid(data['id'])
        && typeof data['name'] === 'string';
    case 'move':
      return hasExactKeys(data, ['id', 'parentId'])
        && isUuid(data['id'])
        && isNullableString(data['parentId']);
    case 'delete':
    case 'softDelete':
    case 'restore':
      return hasExactKeys(data, ['id']) && isUuid(data['id']);
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
      return hasAllowedKeys(data, ['id', 'folderId', 'title'])
        && hasRequiredKeys(data, ['id'])
        && isUuid(data['id'])
        && isOptionalNullableString(data['folderId'])
        && isOptionalString(data['title']);
    case 'rename':
      return hasExactKeys(data, ['id', 'title'])
        && isUuid(data['id'])
        && typeof data['title'] === 'string';
    case 'move':
      return hasExactKeys(data, ['id', 'folderId'])
        && isUuid(data['id'])
        && isNullableString(data['folderId']);
    case 'delete':
    case 'softDelete':
    case 'restore':
      return hasExactKeys(data, ['id']) && isUuid(data['id']);
  }
}

function isValidRecordEventData(
  operation: EventOperation,
  data: Record<string, unknown>,
): boolean {
  switch (operation) {
    case 'create':
      return isValidRecordEventEntityData(data);
    case 'update':
      return hasAllowedKeys(data, [
        'id',
        'threadId',
        'type',
        'name',
        'createdAt',
        'editedAt',
        'orderIndex',
        'isStarred',
        'imageGroupId',
        'mediaId',
        'mimeType',
        'title',
        'size',
      ])
        && hasRequiredKeys(data, ['id'])
        && isUuid(data['id'])
        && isOptionalString(data['threadId'])
        && isOptionalRecordType(data)
        && isOptionalString(data['name'])
        && isOptionalNumber(data['createdAt'])
        && isOptionalNumber(data['editedAt'])
        && isOptionalNumber(data['orderIndex'])
        && isOptionalBoolean(data['isStarred'])
        && isOptionalNullableString(data['imageGroupId'])
        && isOptionalString(data['mediaId'])
        && isOptionalString(data['mimeType'])
        && isOptionalString(data['title'])
        && isOptionalNullableNumber(data['size']);
    case 'rename':
      return hasExactKeys(data, ['id', 'name'])
        && isUuid(data['id'])
        && typeof data['name'] === 'string';
    case 'move':
      return hasExactKeys(data, ['id', 'threadId'])
        && isUuid(data['id'])
        && typeof data['threadId'] === 'string';
    case 'delete':
    case 'softDelete':
    case 'restore':
      return hasExactKeys(data, ['id']) && isUuid(data['id']);
  }
}

function isValidFolderEntityData(data: Record<string, unknown>): boolean {
  return hasExactKeys(data, ['id', 'name', 'parentId'])
    && isUuid(data['id'])
    && typeof data['name'] === 'string'
    && isNullableString(data['parentId']);
}

function isValidThreadEntityData(data: Record<string, unknown>): boolean {
  return hasExactKeys(data, ['id', 'folderId', 'title'])
    && isUuid(data['id'])
    && isNullableString(data['folderId'])
    && typeof data['title'] === 'string';
}

function isValidRecordEntityData(data: Record<string, unknown>): boolean {
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
    'mediaId',
    'mimeType',
    'title',
    'size',
  ])
    && hasRequiredKeys(data, [
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
    && isNullableString(data['imageGroupId'])
    && isOptionalString(data['mediaId'])
    && isOptionalString(data['mimeType'])
    && isOptionalString(data['title'])
    && isOptionalNullableNumber(data['size']);
}

function isValidRecordEventEntityData(data: Record<string, unknown>): boolean {
  return hasAllowedKeys(data, [
    'id',
    'threadId',
    'type',
    'name',
    'createdAt',
    'editedAt',
    'orderIndex',
    'isStarred',
    'imageGroupId',
    'mediaId',
    'mimeType',
    'title',
    'size',
  ])
    && hasRequiredKeys(data, [
      'id',
      'threadId',
      'type',
      'name',
      'createdAt',
      'editedAt',
      'orderIndex',
      'isStarred',
      'imageGroupId',
    ])
    && isUuid(data['id'])
    && typeof data['threadId'] === 'string'
    && typeof data['type'] === 'string'
    && typeof data['name'] === 'string'
    && typeof data['createdAt'] === 'number'
    && typeof data['editedAt'] === 'number'
    && typeof data['orderIndex'] === 'number'
    && typeof data['isStarred'] === 'boolean'
    && isNullableString(data['imageGroupId'])
    && isOptionalString(data['mediaId'])
    && isOptionalString(data['mimeType'])
    && isOptionalString(data['title'])
    && isOptionalNullableNumber(data['size']);
}

function hasConsistentEntityId(entityId: string, payload: Record<string, unknown>): boolean {
  if ('id' in payload && payload['id'] !== entityId) {
    return false;
  }

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
  return ['create', 'update', 'rename', 'move', 'delete', 'softDelete', 'restore'].includes(value);
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

function isOptionalRecordType(data: Record<string, unknown>): boolean {
  return !('type' in data) || typeof data['type'] === 'string';
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

function isNullableNumber(value: unknown): boolean {
  return typeof value === 'number' || value === null;
}

function isOptionalNullableNumber(value: unknown): boolean {
  return value === undefined || isNullableNumber(value);
}

function isEventId(value: unknown): value is number | string {
  return isNonNegativeInteger(value)
    || (typeof value === 'string' && value.length > 0);
}

function normalizeEntityId(entityId: string, payload: Record<string, unknown>): string | null {
  const payloadId = payload['id'];
  if (payloadId !== undefined && payloadId !== entityId) {
    return null;
  }

  const payloadUuid = payload['uuid'];
  if (payloadUuid !== undefined && payloadUuid !== entityId) {
    return null;
  }

  return entityId;
}

function readOptionalStringAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function readOptionalNormalizedFolderAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    if (value === null || value === 'root') {
      return null;
    }

    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function readOptionalNumberAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    return typeof value === 'number' ? value : undefined;
  }

  return undefined;
}

function readOptionalBooleanAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    return typeof value === 'boolean' ? value : undefined;
  }

  return undefined;
}

function readOptionalNullableStringAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    if (value === null) {
      return null;
    }

    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function readOptionalNullableNumberAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): number | null | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    if (value === null) {
      return null;
    }

    return typeof value === 'number' ? value : undefined;
  }

  return undefined;
}

function readOptionalTimestampAlias(
  payload: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    if (!(key in payload)) {
      continue;
    }

    const normalized = normalizeEventTimestamp(payload[key]);
    return normalized ?? undefined;
  }

  return undefined;
}

function normalizeEventTimestamp(value: unknown): number | null {
  if (isNonNegativeInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isEventTimestamp(value: unknown): value is string | number {
  return normalizeEventTimestamp(value) !== null;
}