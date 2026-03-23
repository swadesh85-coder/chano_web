import type {
  Folder,
  RecordEntry,
  Thread,
} from '../../app/projection/projection.models';

type OrderedEntity = {
  readonly id: string;
  readonly lastEventVersion: number;
  readonly orderIndex?: number | null;
};

export type OrderedImageGroupSelection = {
  readonly imageGroupId: string;
  readonly records: readonly RecordEntry[];
  readonly orderIndex: number | null;
  readonly lastEventVersion: number;
};

export function sortFoldersForExplorer(folders: readonly Folder[]): readonly Folder[] {
  return [...folders].sort(compareFoldersDeterministically);
}

export function sortThreadsForExplorer(threads: readonly Thread[]): readonly Thread[] {
  return [...threads].sort(compareThreadsDeterministically);
}

export function sortRecordsForExplorer(records: readonly RecordEntry[]): readonly RecordEntry[] {
  return [...records].sort(compareRecordsDeterministically);
}

export function compareFoldersDeterministically(left: Folder, right: Folder): number {
  return compareOrderedEntities(left, right);
}

export function compareThreadsDeterministically(left: Thread, right: Thread): number {
  return compareOrderedEntities(left, right);
}

export function compareRecordsDeterministically(left: RecordEntry, right: RecordEntry): number {
  return compareOrderedEntities(left, right);
}

export function deriveOrderedImageGroupsFromRecords(
  records: readonly RecordEntry[],
): readonly OrderedImageGroupSelection[] {
  const orderedRecords = sortRecordsForExplorer(records);
  const recordsByGroupId = new Map<string, RecordEntry[]>();
  const orderedGroupIds: string[] = [];

  for (const record of orderedRecords) {
    if (record.type !== 'image' || record.imageGroupId === null) {
      continue;
    }

    const existingGroup = recordsByGroupId.get(record.imageGroupId);
    if (existingGroup === undefined) {
      recordsByGroupId.set(record.imageGroupId, [record]);
      orderedGroupIds.push(record.imageGroupId);
      continue;
    }

    existingGroup.push(record);
  }

  return orderedGroupIds.map((imageGroupId) => {
    const groupRecords = recordsByGroupId.get(imageGroupId) ?? [];
    const leadRecord = groupRecords[0];
    if (leadRecord === undefined) {
      throw new Error('Image group missing authoritative lastEventVersion');
    }

    return Object.freeze({
      imageGroupId,
      records: Object.freeze([...groupRecords]),
      orderIndex: leadRecord.orderIndex ?? null,
      lastEventVersion: requireRecordLastEventVersion(leadRecord),
    });
  });
}

export function requireRecordLastEventVersion(record: RecordEntry): number {
  const lastEventVersion = record.lastEventVersion;
  if (lastEventVersion == null) {
    throw new Error('Record missing authoritative lastEventVersion');
  }

  return lastEventVersion;
}

function compareOrderedEntities(left: OrderedEntity, right: OrderedEntity): number {
  const leftOrderIndex = readOptionalOrderIndex(left);
  const rightOrderIndex = readOptionalOrderIndex(right);
  if (leftOrderIndex !== rightOrderIndex) {
    return leftOrderIndex - rightOrderIndex;
  }

  const leftLastEventVersion = readAuthoritativeLastEventVersion(left);
  const rightLastEventVersion = readAuthoritativeLastEventVersion(right);
  if (leftLastEventVersion !== rightLastEventVersion) {
    return leftLastEventVersion - rightLastEventVersion;
  }

  return left.id.localeCompare(right.id);
}

function readOptionalOrderIndex(entity: OrderedEntity): number {
  return typeof entity.orderIndex === 'number' ? entity.orderIndex : Number.MAX_SAFE_INTEGER;
}

function readAuthoritativeLastEventVersion(entity: OrderedEntity): number {
  if (typeof entity.lastEventVersion !== 'number' || Number.isNaN(entity.lastEventVersion)) {
    throw new Error(`Entity ${entity.id} missing authoritative lastEventVersion`);
  }

  return entity.lastEventVersion;
}