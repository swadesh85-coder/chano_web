import type { EventEnvelope } from './projection.models';

export interface ImageGroupProjectionRecord {
  readonly id: string;
  readonly threadId: string;
  readonly type: string;
  readonly imageGroupId: string | null;
  readonly orderIndex: number | null;
  readonly lastMutationVersion: number;
  readonly deleted: boolean;
}

export interface ImageGroupView {
  readonly imageGroupId: string;
  readonly threadId: string;
  readonly orderedRecordIds: readonly string[];
}

type ThreadGroupIndex = Map<string, readonly string[]>;

export class ImageGroupProjection {
  private readonly groupsByThread = new Map<string, ThreadGroupIndex>();

  constructor(
    private readonly getRecordsForThread: (threadId: string) => readonly ImageGroupProjectionRecord[],
  ) {}

  reset(): void {
    this.groupsByThread.clear();
  }

  buildImageGroups(threadId: string): readonly ImageGroupView[] {
    const groupEntries = new Map<string, ImageGroupProjectionRecord[]>();

    for (const record of this.getRecordsForThread(threadId)) {
      if (!this.isActiveImageRecord(record)) {
        continue;
      }

      const groupedRecords = groupEntries.get(record.imageGroupId) ?? [];
      groupedRecords.push(record);
      groupEntries.set(record.imageGroupId, groupedRecords);
    }

    if (groupEntries.size === 0) {
      this.groupsByThread.delete(threadId);
      return [];
    }

    const nextGroups: ThreadGroupIndex = new Map();

    for (const [imageGroupId, records] of [...groupEntries.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const orderedRecordIds = [...records]
        .sort((left, right) => this.compareRecordOrder(left, right))
        .map((record) => record.id);

      nextGroups.set(imageGroupId, orderedRecordIds);
    }

    this.groupsByThread.set(threadId, nextGroups);

    return this.getGroupsForThread(threadId);
  }

  updateOnEvent(
    eventEnvelope: EventEnvelope,
    previousRecord: ImageGroupProjectionRecord | null,
    nextRecord: ImageGroupProjectionRecord | null,
  ): void {
    if (eventEnvelope.entityType !== 'record') {
      return;
    }

    const impactedThreadIds = new Set<string>();
    if (previousRecord !== null) {
      impactedThreadIds.add(previousRecord.threadId);
    }
    if (nextRecord !== null) {
      impactedThreadIds.add(nextRecord.threadId);
    }

    const payloadThreadId = eventEnvelope.payload['threadUuid'];
    if (typeof payloadThreadId === 'string') {
      impactedThreadIds.add(payloadThreadId);
    }

    for (const threadId of impactedThreadIds) {
      this.buildImageGroups(threadId);
    }

    this.logApply(eventEnvelope, previousRecord, nextRecord);
  }

  getGroupsForThread(threadId: string): readonly ImageGroupView[] {
    const groups = this.groupsByThread.get(threadId);
    if (!groups) {
      return [];
    }

    return [...groups.entries()].map(([imageGroupId, orderedRecordIds]) => ({
      imageGroupId,
      threadId,
      orderedRecordIds,
    }));
  }

  private compareRecordOrder(
    left: ImageGroupProjectionRecord,
    right: ImageGroupProjectionRecord,
  ): number {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.lastMutationVersion !== right.lastMutationVersion) {
      return left.lastMutationVersion - right.lastMutationVersion;
    }

    return left.id.localeCompare(right.id);
  }

  private isActiveImageRecord(record: ImageGroupProjectionRecord): record is ImageGroupProjectionRecord & {
    readonly imageGroupId: string;
  } {
    return record.type === 'image' && record.imageGroupId !== null && !record.deleted;
  }

  private logApply(
    eventEnvelope: EventEnvelope,
    previousRecord: ImageGroupProjectionRecord | null,
    nextRecord: ImageGroupProjectionRecord | null,
  ): void {
    const recordType = nextRecord?.type
      ?? previousRecord?.type
      ?? this.resolveRecordType(eventEnvelope.payload);
    const imageGroupId = nextRecord?.imageGroupId
      ?? previousRecord?.imageGroupId
      ?? this.resolveImageGroupId(eventEnvelope.payload);

    if (recordType !== 'image' || imageGroupId === null) {
      return;
    }

    const operationSegment = eventEnvelope.operation === 'create' || eventEnvelope.operation === 'update'
      ? ''
      : ` ${eventEnvelope.operation}`;

    console.log(
      `APPLY eventVersion=${eventEnvelope.eventVersion} record=${recordType}${operationSegment} group=${imageGroupId}`,
    );
  }

  private resolveRecordType(payload: Record<string, unknown>): string | null {
    const recordType = payload['recordType'];
    if (typeof recordType === 'string') {
      return recordType;
    }

    const type = payload['type'];
    return typeof type === 'string' ? type : null;
  }

  private resolveImageGroupId(payload: Record<string, unknown>): string | null {
    const imageGroupId = payload['imageGroupId'];
    return typeof imageGroupId === 'string' ? imageGroupId : imageGroupId === null ? null : null;
  }
}