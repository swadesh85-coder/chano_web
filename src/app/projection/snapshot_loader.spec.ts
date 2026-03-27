import { beforeEach, describe, expect, it } from 'vitest';
import { SnapshotLoader, type SnapshotLoaderEvent } from './snapshot_loader';
import type { ProjectionSnapshotDocument } from './projection.models';
import type { TransportEnvelope } from '../../transport/transport-envelope';

function createEnvelope(
  type: string,
  payload: Record<string, unknown>,
  sequence = 1,
): TransportEnvelope {
  return {
    protocolVersion: 2,
    type,
    sessionId: 'session-runtime-1',
    timestamp: 1_710_000_000,
    sequence,
    payload,
  };
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
  }

  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;

  if (!bufferCtor) {
    throw new Error('No base64 encoder available');
  }

  return bufferCtor.from(bytes).toString('base64');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function createSnapshotProtocol(snapshotJson: string, baseEventVersion = 41): Promise<{
  readonly start: TransportEnvelope;
  readonly chunks: readonly TransportEnvelope[];
  readonly complete: TransportEnvelope;
}> {
  const bytes = encodeUtf8(snapshotJson);
  const midpoint = Math.max(1, Math.floor(bytes.length / 2));
  const chunkBytes = [bytes.slice(0, midpoint), bytes.slice(midpoint)].filter((chunk) => chunk.byteLength > 0);
  const checksum = await sha256Hex(bytes);
  const parsedSnapshot = JSON.parse(snapshotJson) as { readonly entities?: readonly unknown[] };

  return {
    start: createEnvelope('snapshot_start', {
      snapshotId: 'snapshot-1',
      totalChunks: chunkBytes.length,
      totalBytes: bytes.byteLength,
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion,
      entityCount: parsedSnapshot.entities?.length ?? 0,
      checksum,
    }),
    chunks: chunkBytes.map((chunk, index) =>
      createEnvelope('snapshot_chunk', {
        index,
        data: toBase64(chunk),
      }, index + 2),
    ),
    complete: createEnvelope('snapshot_complete', { totalChunks: chunkBytes.length }, chunkBytes.length + 2),
  };
}

function createCanonicalSnapshotJson(options: {
  readonly folderName?: string;
  readonly threadTitle?: string;
  readonly recordBody?: string;
} = {}): string {
  return JSON.stringify({
    snapshotVersion: 1,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion: 41,
    generatedAt: '2026-03-27T00:00:00.000Z',
    entityCount: 3,
    checksum: 'transport-checksum-is-verified-separately',
    entities: [
      {
        entityType: 'folder',
        entityUuid: 'folder-1',
        entityVersion: 1,
        lastEventVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-1',
          name: options.folderName ?? 'Inbox',
          parentFolderUuid: null,
        },
      },
      {
        entityType: 'thread',
        entityUuid: 'thread-1',
        entityVersion: 2,
        lastEventVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-1',
          folderUuid: 'folder-1',
          title: options.threadTitle ?? 'Roadmap',
        },
      },
      {
        entityType: 'record',
        entityUuid: 'record-1',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-1',
          threadUuid: 'thread-1',
          type: 'text',
          body: options.recordBody ?? 'Seed note',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

function createExpectedProjectionSnapshot(options: {
  readonly folderName?: string;
  readonly threadTitle?: string;
  readonly recordBody?: string;
} = {}): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-1',
        entityVersion: 1,
        lastEventVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-1',
          name: options.folderName ?? 'Inbox',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-1',
        entityVersion: 2,
        lastEventVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-1',
          folderUuid: 'folder-1',
          title: options.threadTitle ?? 'Roadmap',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-1',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-1',
          threadUuid: 'thread-1',
          type: 'text',
          body: options.recordBody ?? 'Seed note',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  };
}

describe('SnapshotLoader', () => {
  let loader: SnapshotLoader;
  let events: SnapshotLoaderEvent[];

  beforeEach(() => {
    loader = new SnapshotLoader();
    events = [];
    loader.onEvent((event) => {
      events.push(event);
    });
  });

  it('snapshot_start_initializes_loader', async () => {
    const firstSnapshotJson = createCanonicalSnapshotJson({ folderName: 'First' });
    const secondSnapshotJson = createCanonicalSnapshotJson({ folderName: 'Second' });
    const firstProtocol = await createSnapshotProtocol(firstSnapshotJson);
    const secondProtocol = await createSnapshotProtocol(secondSnapshotJson, 84);

    loader.handleSnapshotStart(firstProtocol.start);
    loader.handleSnapshotChunk(firstProtocol.chunks[0]!);

    loader.handleSnapshotStart(secondProtocol.start);
    loader.handleSnapshotChunk(secondProtocol.chunks[0]!);
    if (secondProtocol.chunks[1]) {
      loader.handleSnapshotChunk(secondProtocol.chunks[1]);
    }
    await loader.handleSnapshotComplete(secondProtocol.complete);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_LOADED',
        parsedSnapshot: createExpectedProjectionSnapshot({ folderName: 'Second' }),
        baseEventVersion: 84,
        entityCount: 3,
      },
    ]);
  });

  it('snapshot_chunk_byte_reconstruction', async () => {
    const snapshotJson = createCanonicalSnapshotJson({ folderName: 'Cafe \u2615' });
    const protocol = await createSnapshotProtocol(snapshotJson, 12);

    loader.handleSnapshotStart(protocol.start);
    for (const chunk of protocol.chunks) {
      loader.handleSnapshotChunk(chunk);
    }
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toContainEqual({
      type: 'SNAPSHOT_LOADED',
      parsedSnapshot: createExpectedProjectionSnapshot({ folderName: 'Cafe \u2615' }),
      baseEventVersion: 12,
      entityCount: 3,
    });
  });

  it('snapshot_utf8_reconstruction', async () => {
    const snapshotJson = createCanonicalSnapshotJson({
      folderName: 'Cafe \u2615',
      threadTitle: 'na\u00efve',
      recordBody: 'r\u00e9sum\u00e9',
    });
    const protocol = await createSnapshotProtocol(snapshotJson, 12);

    loader.handleSnapshotStart(protocol.start);
    for (const chunk of protocol.chunks) {
      loader.handleSnapshotChunk(chunk);
    }
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toContainEqual({
      type: 'SNAPSHOT_LOADED',
      parsedSnapshot: createExpectedProjectionSnapshot({
        folderName: 'Cafe \u2615',
        threadTitle: 'na\u00efve',
        recordBody: 'r\u00e9sum\u00e9',
      }),
      baseEventVersion: 12,
      entityCount: 3,
    });
  });

  it('snapshot_accepts_canonical_root_with_unknown_fields', async () => {
    const snapshotJson = JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 9,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 0,
      checksum: 'ignored-in-payload-checksum',
      entities: [],
      futureField: { nested: true },
    });
    const protocol = await createSnapshotProtocol(snapshotJson, 9);

    loader.handleSnapshotStart(protocol.start);
    for (const chunk of protocol.chunks) {
      loader.handleSnapshotChunk(chunk);
    }
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_LOADED',
        parsedSnapshot: { folders: [], threads: [], records: [] },
        baseEventVersion: 9,
        entityCount: 0,
      },
    ]);
  });

  it('snapshot_accepts_mobile_record_null_fields', async () => {
    const snapshotJson = JSON.stringify({
      snapshotVersion: 2,
      protocolVersion: 2,
      schemaVersion: 2,
      baseEventVersion: 9,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 3,
      checksum: 'entities-checksum',
      entities: [
        {
          entityType: 'folder',
          entityUuid: 'folder-1',
          entityVersion: 1,
          lastEventVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'folder-1',
            title: 'Inbox',
            parentFolderUuid: null,
            createdAt: '2026-03-27T00:00:00.000Z',
          },
        },
        {
          entityType: 'thread',
          entityUuid: 'thread-1',
          entityVersion: 2,
          lastEventVersion: 2,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'thread-1',
            folderUuid: 'folder-1',
            title: 'Roadmap',
            kind: 'notes',
          },
        },
        {
          entityType: 'record',
          entityUuid: 'record-1',
          entityVersion: 3,
          lastEventVersion: 3,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'record-1',
            threadUuid: 'thread-1',
            type: 'text',
            title: null,
            body: null,
            text: 'Fallback text',
            createdAt: '2026-03-27T00:00:00.000Z',
            editedAt: '2026-03-27T00:00:01.000Z',
            orderIndex: 0,
            isStarred: false,
            isAiGenerated: false,
            imageGroupId: null,
          },
        },
      ],
    });
    const protocol = await createSnapshotProtocol(snapshotJson, 9);

    loader.handleSnapshotStart(protocol.start);
    for (const chunk of protocol.chunks) {
      loader.handleSnapshotChunk(chunk);
    }
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_LOADED',
        parsedSnapshot: {
          folders: [
            {
              entityType: 'folder',
              entityUuid: 'folder-1',
              entityVersion: 1,
              lastEventVersion: 1,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'folder-1',
                name: 'Inbox',
                parentFolderUuid: null,
              },
            },
          ],
          threads: [
            {
              entityType: 'thread',
              entityUuid: 'thread-1',
              entityVersion: 2,
              lastEventVersion: 2,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'thread-1',
                folderUuid: 'folder-1',
                title: 'Roadmap',
              },
            },
          ],
          records: [
            {
              entityType: 'record',
              entityUuid: 'record-1',
              entityVersion: 3,
              lastEventVersion: 3,
              ownerUserId: 'owner-1',
              data: {
                uuid: 'record-1',
                threadUuid: 'thread-1',
                type: 'text',
                body: 'Fallback text',
                createdAt: Date.parse('2026-03-27T00:00:00.000Z'),
                editedAt: Date.parse('2026-03-27T00:00:01.000Z'),
                orderIndex: 0,
                isStarred: false,
                imageGroupId: null,
              },
            },
          ],
        },
        baseEventVersion: 9,
        entityCount: 3,
      },
    ]);
  });

  it('snapshot_complete_snapshot_rebuild', async () => {
    const snapshotJson = JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 7,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 1,
      checksum: 'ignored-in-payload-checksum',
      entities: [{ entityType: 'folder', entityUuid: 'f1', entityVersion: 1, lastEventVersion: 1, ownerUserId: 'u1', data: { uuid: 'f1', name: 'Inbox', parentFolderUuid: null } }],
    });
    const protocol = await createSnapshotProtocol(snapshotJson, 7);

    loader.handleSnapshotStart(protocol.start);
    protocol.chunks.forEach((chunk) => loader.handleSnapshotChunk(chunk));
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events[0]).toEqual({
      type: 'SNAPSHOT_LOADED',
      parsedSnapshot: {
        folders: [{ entityType: 'folder', entityUuid: 'f1', entityVersion: 1, lastEventVersion: 1, ownerUserId: 'u1', data: { uuid: 'f1', name: 'Inbox', parentFolderUuid: null } }],
        threads: [],
        records: [],
      },
      baseEventVersion: 7,
      entityCount: 1,
    });
  });

  it('snapshot_checksum_verification', async () => {
    const protocol = await createSnapshotProtocol(JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 41,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 0,
      checksum: 'ignored-in-payload-checksum',
      entities: [],
    }));
    const invalidStart = createEnvelope('snapshot_start', {
      ...protocol.start.payload,
      checksum: 'deadbeef',
    });

    loader.handleSnapshotStart(invalidStart);
    protocol.chunks.forEach((chunk) => loader.handleSnapshotChunk(chunk));
    await loader.handleSnapshotComplete(protocol.complete);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_ERROR',
        reason: 'checksum mismatch',
      },
    ]);
  });

  it('snapshot_loader_reconstruction', async () => {
    const snapshotJson = JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 77,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 3,
      checksum: 'ignored-in-payload-checksum',
      entities: [
        {
          entityType: 'folder',
          entityUuid: 'folder-root',
          entityVersion: 1,
          lastEventVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'folder-root',
            name: 'Inbox',
            parentFolderUuid: null,
          },
        },
        {
          entityType: 'thread',
          entityUuid: 'thread-1',
          entityVersion: 2,
          lastEventVersion: 2,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'thread-1',
            folderUuid: 'folder-root',
            title: 'Roadmap',
          },
        },
        {
          entityType: 'record',
          entityUuid: 'record-1',
          entityVersion: 3,
          lastEventVersion: 3,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'record-1',
            threadUuid: 'thread-1',
            type: 'text',
            body: 'Deterministic body',
            createdAt: 1710000001,
            editedAt: 1710000001,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
      ],
    });
    const protocol = await createSnapshotProtocol(snapshotJson, 77);

    const reconstruction = await loader.loadSnapshotForTest(protocol);

    expect(reconstruction.snapshotJson).toBe(snapshotJson);
    expect(reconstruction.parsedSnapshot).toEqual({
      folders: [
        {
          entityType: 'folder',
          entityUuid: 'folder-root',
          entityVersion: 1,
          lastEventVersion: 1,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'folder-root',
            name: 'Inbox',
            parentFolderUuid: null,
          },
        },
      ],
      threads: [
        {
          entityType: 'thread',
          entityUuid: 'thread-1',
          entityVersion: 2,
          lastEventVersion: 2,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'thread-1',
            folderUuid: 'folder-root',
            title: 'Roadmap',
          },
        },
      ],
      records: [
        {
          entityType: 'record',
          entityUuid: 'record-1',
          entityVersion: 3,
          lastEventVersion: 3,
          ownerUserId: 'owner-1',
          data: {
            uuid: 'record-1',
            threadUuid: 'thread-1',
            type: 'text',
            body: 'Deterministic body',
            createdAt: 1710000001,
            editedAt: 1710000001,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
      ],
    });
    expect(reconstruction.baseEventVersion).toBe(77);
    expect(reconstruction.reconstructedChecksum).toBe(protocol.start.payload['checksum']);
    expect(reconstruction.mobileChecksum).toBe(protocol.start.payload['checksum']);
    expect(reconstruction.byteLength).toBe(encodeUtf8(snapshotJson).byteLength);
  });

  it('snapshot_checksum_verification_for_test_hook', async () => {
    const protocol = await createSnapshotProtocol(JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 33,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 0,
      checksum: 'ignored-in-payload-checksum',
      entities: [],
    }), 33);
    const invalidProtocol = {
      ...protocol,
      start: createEnvelope('snapshot_start', {
        ...protocol.start.payload,
        checksum: 'ffffffff',
      }),
    };

    await expect(loader.loadSnapshotForTest(invalidProtocol)).rejects.toThrow('checksum mismatch');
  });

  it('snapshot_reject_on_invalid_chunk_order', async () => {
    const protocol = await createSnapshotProtocol(JSON.stringify({
      snapshotVersion: 1,
      protocolVersion: 2,
      schemaVersion: 1,
      baseEventVersion: 41,
      generatedAt: '2026-03-27T00:00:00.000Z',
      entityCount: 0,
      checksum: 'ignored-in-payload-checksum',
      entities: [],
    }));

    loader.handleSnapshotStart(protocol.start);
    loader.handleSnapshotChunk(protocol.chunks[1] ?? protocol.chunks[0]!);

    expect(events).toEqual([
      {
        type: 'SNAPSHOT_ERROR',
        reason: 'invalid chunk order expected=0 actual=1',
      },
    ]);
  });
});