export type ExplorerEntityType = 'root' | 'folder' | 'thread' | 'group' | 'record';
export type ExplorerRecordType = 'text' | 'image' | 'file' | 'audio';

export const EXPLORER_SIDEBAR_INDENT_STEP_PX = 20;
export const EXPLORER_THREAD_ROW_HEIGHT_PX = 88;
export const EXPLORER_RECORD_ROW_HEIGHT_PX = 132;
export const EXPLORER_VIRTUAL_LIST_BUFFER = 4;
export const EXPLORER_SIDEBAR_MIN_WIDTH_PX = 200;
export const EXPLORER_SIDEBAR_MAX_RATIO = 0.5;

const EXPLORER_BADGE_BY_ENTITY_TYPE: Readonly<Record<Exclude<ExplorerEntityType, 'record'>, string>> = {
  root: 'ROOT',
  folder: 'DIR',
  thread: 'THR',
  group: 'IMG',
};

const EXPLORER_BADGE_BY_RECORD_TYPE: Readonly<Record<ExplorerRecordType, string>> = {
  text: 'REC',
  image: 'IMG',
  file: 'FIL',
  audio: 'AUD',
};

export function resolveExplorerBadge(
  entityType: ExplorerEntityType,
  recordType: ExplorerRecordType | null,
): string {
  if (entityType === 'record') {
    return EXPLORER_BADGE_BY_RECORD_TYPE[recordType ?? 'text'];
  }

  return EXPLORER_BADGE_BY_ENTITY_TYPE[entityType];
}