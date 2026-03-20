import type { EventEnvelope, ProjectionSnapshotDocument } from './projection.models';
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
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread:0001',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread:0001',
          folderUuid: 'folder:0001',
          title: 'Gallery',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'rec-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'rec-1',
          threadUuid: 'thread:0001',
          type: 'image',
          body: 'Image 1',
          createdAt: 10,
          editedAt: 10,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: 'img-123',
        },
      },
      {
        entityType: 'record',
        entityUuid: 'rec-2',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'rec-2',
          threadUuid: 'thread:0001',
          type: 'image',
          body: 'Image 2',
          createdAt: 11,
          editedAt: 11,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: 'img-123',
        },
      },
      {
        entityType: 'record',
        entityUuid: 'rec-3',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'rec-3',
          threadUuid: 'thread:0001',
          type: 'image',
          body: 'Image 3',
          createdAt: 12,
          editedAt: 12,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: 'img-456',
        },
      },
      {
        entityType: 'record',
        entityUuid: 'rec-text',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'rec-text',
          threadUuid: 'thread:0001',
          type: 'text',
          body: 'Ignore me',
          createdAt: 13,
          editedAt: 13,
          orderIndex: 3,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  };
}

function createRecordEvent(
  eventVersion: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: overrides.eventId ?? `evt-${eventVersion}`,
    originDeviceId: overrides.originDeviceId ?? 'mobile-1',
    eventVersion,
    entityType: 'record',
    entityId: overrides.entityId ?? 'rec-x',
    operation: overrides.operation ?? 'create',
    timestamp: overrides.timestamp ?? 1710000000 + eventVersion,
    payload: overrides.payload ?? {
      uuid: 'rec-x',
      threadUuid: 'thread:0001',
      recordType: 'image',
      body: 'Image X',
      createdAt: 100,
      editedAt: 100,
      orderIndex: 2,
      isStarred: false,
      imageGroupId: 'img-123',
    },
    checksum: overrides.checksum ?? 'sha256',
  };
}

describe('ImageGroupProjection', () => {
  it('image_group_build_from_snapshot', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    const groups = projection.buildImageGroups('thread:0001');

    expect(groups).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1', 'rec-2'],
      },
      {
        imageGroupId: 'img-456',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-3'],
      },
    ]);
  });

  it('image_group_event_create', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    projection.applyEvent(createRecordEvent(110, {
      entityId: 'rec-4',
      payload: {
        uuid: 'rec-4',
        threadUuid: 'thread:0001',
        recordType: 'image',
        body: 'Image 4',
        createdAt: 14,
        editedAt: 14,
        orderIndex: 2,
        isStarred: false,
        imageGroupId: 'img-123',
      },
    }));

    expect(projection.getImageGroups('thread:0001')).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1', 'rec-2', 'rec-4'],
      },
      {
        imageGroupId: 'img-456',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-3'],
      },
    ]);
  });

  it('image_group_event_update', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    projection.applyEvent(createRecordEvent(111, {
      entityId: 'rec-3',
      operation: 'update',
      payload: {
        uuid: 'rec-3',
        recordType: 'image',
        imageGroupId: 'img-123',
        orderIndex: 2,
      },
    }));

    expect(projection.getImageGroups('thread:0001')).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1', 'rec-2', 'rec-3'],
      },
    ]);
  });

  it('image_group_soft_delete', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    projection.applyEvent(createRecordEvent(112, {
      entityId: 'rec-2',
      operation: 'softDelete',
      payload: { uuid: 'rec-2' },
    }));

    expect(projection.getImageGroups('thread:0001')).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1'],
      },
      {
        imageGroupId: 'img-456',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-3'],
      },
    ]);
  });

  it('image_group_restore', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());
    projection.applyEvent(createRecordEvent(112, {
      entityId: 'rec-2',
      operation: 'softDelete',
      payload: { uuid: 'rec-2' },
    }));

    projection.applyEvent(createRecordEvent(113, {
      entityId: 'rec-2',
      operation: 'restore',
      payload: { uuid: 'rec-2' },
    }));

    expect(projection.getImageGroups('thread:0001')).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1', 'rec-2'],
      },
      {
        imageGroupId: 'img-456',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-3'],
      },
    ]);
  });

  it('image_group_remove_empty', () => {
    const projection = new VaultDomainProjection();
    projection.applySnapshot(createSnapshotDocument());

    projection.applyEvent(createRecordEvent(114, {
      entityId: 'rec-3',
      operation: 'softDelete',
      payload: { uuid: 'rec-3' },
    }));

    expect(projection.getImageGroups('thread:0001')).toEqual([
      {
        imageGroupId: 'img-123',
        threadId: 'thread:0001',
        orderedRecordIds: ['rec-1', 'rec-2'],
      },
    ]);
  });

  it('deterministic_grouping', () => {
    const firstProjection = new VaultDomainProjection();
    const secondProjection = new VaultDomainProjection();
    const snapshot = createSnapshotDocument();
    const events = [
      createRecordEvent(110, {
        entityId: 'rec-4',
        payload: {
          uuid: 'rec-4',
          threadUuid: 'thread:0001',
          recordType: 'image',
          body: 'Image 4',
          createdAt: 14,
          editedAt: 14,
          orderIndex: 2,
          isStarred: false,
          imageGroupId: 'img-123',
        },
      }),
      createRecordEvent(111, {
        entityId: 'rec-5',
        payload: {
          uuid: 'rec-5',
          threadUuid: 'thread:0001',
          recordType: 'image',
          body: 'Image 5',
          createdAt: 15,
          editedAt: 15,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: 'img-123',
        },
      }),
    ];

    firstProjection.applySnapshot(snapshot);
    secondProjection.applySnapshot(snapshot);

    for (const event of events) {
      firstProjection.applyEvent(event);
      secondProjection.applyEvent(event);
    }

    expect(firstProjection.getImageGroups('thread:0001')).toEqual(secondProjection.getImageGroups('thread:0001'));
    expect(firstProjection.getImageGroups('thread:0001')[0]).toEqual({
      imageGroupId: 'img-123',
      threadId: 'thread:0001',
      orderedRecordIds: ['rec-1', 'rec-2', 'rec-5', 'rec-4'],
    });
  });
});