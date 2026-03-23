import { describe, expect, it } from 'vitest';
import type { EventEnvelope, ProjectionSnapshotDocument } from './projection.models';
import { ProjectionEngine } from './projection_engine';
import { VaultDomainProjection } from './vault_domain_projection';

function createSnapshotDocument(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder:0001',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder:0001',
          name: 'Root',
          parentFolderUuid: null,
        },
      },
      {
        entityType: 'folder',
        entityUuid: 'folder:0002',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder:0002',
          name: 'Child',
          parentFolderUuid: 'folder:0001',
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread:0001',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread:0001',
          folderUuid: 'folder:0002',
          title: 'Thread A',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record:0001',
        entityVersion: 1,
        lastEventVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record:0001',
          threadUuid: 'thread:0001',
          type: 'text',
          body: 'Body 1',
          createdAt: 1710000001,
          editedAt: 1710000001,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  };
}

function createEventEnvelope(
  eventVersion: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: overrides.eventId ?? `evt-${eventVersion}`,
    originDeviceId: overrides.originDeviceId ?? 'mobile-1',
    eventVersion,
    entityType: overrides.entityType ?? 'record',
    entityId: overrides.entityId ?? 'record:0002',
    operation: overrides.operation ?? 'create',
    timestamp: overrides.timestamp ?? 1710000000 + eventVersion,
    payload: overrides.payload ?? {
      uuid: 'record:0002',
      threadUuid: 'thread:0001',
      type: 'text',
      body: `Body ${eventVersion}`,
      createdAt: 1710000000 + eventVersion,
      editedAt: 1710000000 + eventVersion,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
    },
    checksum: overrides.checksum ?? 'sha256',
  };
}

describe('VaultDomainProjection', () => {
  it('snapshot_projection_build', () => {
    const projection = new VaultDomainProjection();

    const state = projection.applySnapshot(createSnapshotDocument());

    expect(state.folders.map((folder) => folder.id)).toEqual(['folder:0001', 'folder:0002']);
    expect(state.threads.map((thread) => thread.id)).toEqual(['thread:0001']);
    expect(state.records.map((record) => record.id)).toEqual(['record:0001']);
    expect(state).toEqual({
      folders: [
        { id: 'folder:0001', name: 'Root', parentId: null, entityVersion: 1 },
        { id: 'folder:0002', name: 'Child', parentId: 'folder:0001', entityVersion: 1 },
      ],
      threads: [{ id: 'thread:0001', folderId: 'folder:0002', title: 'Thread A', entityVersion: 1 }],
      records: [
        {
          id: 'record:0001',
          threadId: 'thread:0001',
          type: 'text',
          name: 'Body 1',
          createdAt: 1710000001,
          editedAt: 1710000001,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
          entityVersion: 1,
          lastEventVersion: 1,
        },
      ],
    });
  });

  it('event_create_apply', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    const state = projection.applyEvent(createEventEnvelope(101, {
      entityType: 'record',
      entityId: 'record:0002',
      operation: 'create',
      payload: {
        uuid: 'record:0002',
        threadUuid: 'thread:0001',
        type: 'text',
        body: 'Created body',
        createdAt: 1710000101,
      },
    }));

    expect(state.records).toEqual([
      {
        id: 'record:0001',
        threadId: 'thread:0001',
        type: 'text',
        name: 'Body 1',
        createdAt: 1710000001,
        editedAt: 1710000001,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 1,
        lastEventVersion: 1,
      },
      {
        id: 'record:0002',
        threadId: 'thread:0001',
        type: 'text',
        name: 'Created body',
        createdAt: 1710000101,
        editedAt: 1710000101,
        orderIndex: null,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 101,
        lastEventVersion: 101,
      },
    ]);
  });

  it('event_update_apply', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());
    projection.applyEvent(createEventEnvelope(101));

    const state = projection.applyEvent(createEventEnvelope(102, {
      entityId: 'record:0002',
      operation: 'update',
      payload: {
        uuid: 'record:0002',
        body: 'Updated body',
        type: 'markdown',
      },
    }));

    expect(state.records[1]).toEqual({
      id: 'record:0002',
      threadId: 'thread:0001',
      type: 'markdown',
      name: 'Updated body',
      createdAt: 1710000101,
      editedAt: 1710000101,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
      entityVersion: 102,
      lastEventVersion: 102,
    });
  });

  it('event_move_apply', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot({
      ...createSnapshotDocument(),
      threads: [
        ...createSnapshotDocument().threads!,
        {
          entityType: 'thread',
          entityUuid: 'thread:0002',
          entityVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'thread:0002',
            folderUuid: 'folder:0001',
            title: 'Thread B',
          },
        },
      ],
      records: [
        ...createSnapshotDocument().records!,
        {
          entityType: 'record',
          entityUuid: 'record:0002',
          entityVersion: 1,
          lastEventVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'record:0002',
            threadUuid: 'thread:0001',
            type: 'text',
            body: 'Movable',
            createdAt: 1710000002,
            editedAt: 1710000002,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
      ],
    });

    const state = projection.applyEvent(createEventEnvelope(103, {
      entityId: 'record:0002',
      operation: 'move',
      payload: {
        uuid: 'record:0002',
        threadUuid: 'thread:0002',
      },
    }));

    expect(state.records.find((record) => record.id === 'record:0002')).toEqual({
      id: 'record:0002',
      threadId: 'thread:0002',
      type: 'text',
      name: 'Movable',
      createdAt: 1710000002,
      editedAt: 1710000002,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
      entityVersion: 103,
      lastEventVersion: 103,
    });
  });

  it('duplicate_event_ignore', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotDocument(), 100);
    engine.applyEvent(createEventEnvelope(101));

    const duplicateResult = engine.applyEvent(createEventEnvelope(101));

    expect(duplicateResult.status).toBe('EVENT_IGNORED_DUPLICATE');
    expect(duplicateResult.state.records).toHaveLength(2);
  });
});