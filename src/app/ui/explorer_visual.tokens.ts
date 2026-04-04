export type ExplorerEntityType = 'root' | 'folder' | 'thread' | 'group' | 'record';
export type ExplorerRecordType = 'text' | 'image' | 'file' | 'audio';

export const EXPLORER_VISUAL_DIMENSIONS = Object.freeze({
  sidebarIndentStepPx: 20,
  threadRowHeightPx: 88,
  listRowHeightPx: 44,
  recordRowHeightPx: 132,
  virtualListBuffer: 4,
  sidebarMinWidthPx: 200,
  sidebarMaxRatio: 0.5,
});

export const EXPLORER_SIDEBAR_INDENT_STEP_PX = EXPLORER_VISUAL_DIMENSIONS.sidebarIndentStepPx;
export const EXPLORER_THREAD_ROW_HEIGHT_PX = EXPLORER_VISUAL_DIMENSIONS.threadRowHeightPx;
export const EXPLORER_LIST_ROW_HEIGHT_PX = EXPLORER_VISUAL_DIMENSIONS.listRowHeightPx;
export const EXPLORER_RECORD_ROW_HEIGHT_PX = EXPLORER_VISUAL_DIMENSIONS.recordRowHeightPx;
export const EXPLORER_VIRTUAL_LIST_BUFFER = EXPLORER_VISUAL_DIMENSIONS.virtualListBuffer;
export const EXPLORER_SIDEBAR_MIN_WIDTH_PX = EXPLORER_VISUAL_DIMENSIONS.sidebarMinWidthPx;
export const EXPLORER_SIDEBAR_MAX_RATIO = EXPLORER_VISUAL_DIMENSIONS.sidebarMaxRatio;

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