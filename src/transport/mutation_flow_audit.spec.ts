// @vitest-environment jsdom

import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectionStore } from '../app/projection/projection.store';
import { PendingCommandStore } from './pending-command-store';
import { RecordEditor } from '../app/explorer/record_editor';
import { CommandResultHandler } from './command-result-handler';
import { auditMutationFlow } from './mutation_flow_audit';
import { ensureAngularTestEnvironment } from '../testing/ensure-angular-test-environment';
import type { CommandResultStatus } from './mutation-command';
import type { TransportEnvelope } from './transport-envelope';
import { WebRelayClient } from './web-relay-client';

const FOLDER_ID = '123e4567-e89b-42d3-a456-426614174211';
const THREAD_ID = '123e4567-e89b-42d3-a456-426614174212';
const GENERATED_RECORD_ID = '123e4567-e89b-42d3-a456-426614174201';
const BASE_EVENT_VERSION = 200;
const RELAY_URL = 'ws://relay.audit.local/relay';
const COMMAND_ID_101 = '123e4567-e89b-42d3-a456-426614174101';
const COMMAND_ID_401 = '123e4567-e89b-42d3-a456-426614174401';
const COMMAND_ID_402 = '123e4567-e89b-42d3-a456-426614174402';

type WsHandler = ((event: { data: string }) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static last: MockWebSocket;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: WsHandler = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateEnvelope(envelope: TransportEnvelope): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  (globalThis as Record<string, unknown>)['WebSocket'] = MockWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

function createEnvelope(
  type: string,
  sessionId: string | null,
  sequence: number,
  timestamp: number,
  payload: Record<string, unknown>,
): TransportEnvelope {
  return {
    protocolVersion: 2,
    type,
    sessionId,
    timestamp,
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
    throw new Error('BASE64_ENCODE_UNAVAILABLE');
  }

  return bufferCtor.from(bytes).toString('base64');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function checksumForPayload(payload: Record<string, unknown>): Promise<string> {
  return sha256Hex(encodeUtf8(JSON.stringify(payload)));
}

async function flushAuthoritativeEventWork(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await Promise.resolve();
}

async function seedProjectionSnapshot(sessionId: string): Promise<void> {
  const snapshotJson = JSON.stringify({
    snapshotVersion: 1,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion: BASE_EVENT_VERSION,
    generatedAt: '2026-03-28T00:00:00.000Z',
    entityCount: 2,
    checksum: 'snapshot-mutation-flow-root',
    entities: [
      {
        entityType: 'folder',
        entityUuid: FOLDER_ID,
        entityVersion: 1,
        lastEventVersion: BASE_EVENT_VERSION,
        ownerUserId: 'owner-1',
        data: {
          uuid: FOLDER_ID,
          name: 'Inbox',
          parentFolderUuid: null,
        },
      },
      {
        entityType: 'thread',
        entityUuid: THREAD_ID,
        entityVersion: 2,
        lastEventVersion: BASE_EVENT_VERSION,
        ownerUserId: 'owner-1',
        data: {
          uuid: THREAD_ID,
          folderUuid: FOLDER_ID,
          title: 'Seeded Thread',
        },
      },
    ],
  });
  const snapshotBytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(snapshotBytes);

  MockWebSocket.last.simulateEnvelope(createEnvelope('snapshot_start', sessionId, 1, 1_710_000_001, {
    snapshotId: 'snapshot-mutation-flow-audit',
    totalChunks: 1,
    totalBytes: snapshotBytes.byteLength,
    snapshotVersion: 1,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion: BASE_EVENT_VERSION,
    entityCount: 2,
    checksum,
  }));

  MockWebSocket.last.simulateEnvelope(createEnvelope('snapshot_chunk', sessionId, 2, 1_710_000_002, {
    index: 0,
    data: toBase64(snapshotBytes),
  }));

  MockWebSocket.last.simulateEnvelope(createEnvelope('snapshot_complete', sessionId, 3, 1_710_000_003, {
    totalChunks: 1,
  }));

  await flushAuthoritativeEventWork();
}

async function createRecordEventEnvelope(
  sessionId: string,
  commandId: string,
  body: string,
  sequence: number,
): Promise<TransportEnvelope> {
  const payload = {
    commandId,
    id: GENERATED_RECORD_ID,
    threadId: THREAD_ID,
    type: 'text',
    name: body,
    createdAt: 1_710_000_201,
    editedAt: 1_710_000_201,
    orderIndex: 0,
    isStarred: false,
    imageGroupId: null,
  };

  return createEnvelope('event_stream', sessionId, sequence, 1_710_000_201, {
    eventId: 'evt-201',
    originDeviceId: 'mobile-1',
    eventVersion: BASE_EVENT_VERSION + 1,
    entityType: 'record',
    entityId: GENERATED_RECORD_ID,
    operation: 'create',
    timestamp: 1_710_000_201,
    payload,
    checksum: await checksumForPayload(payload),
  });
}

function createCommandResultEnvelope(
  sessionId: string,
  commandId: string,
  status: CommandResultStatus,
  sequence: number,
): TransportEnvelope {
  return createEnvelope('command_result', sessionId, sequence, 1_710_000_150 + sequence, {
    commandId,
    status,
    entityType: 'record',
    entityId: GENERATED_RECORD_ID,
    operation: 'create',
    eventVersion: 200 + sequence,
    entityVersion: 1,
    message: 'Accepted by relay',
  });
}

function captureProjectionState(projection: ProjectionStore) {
  const state = projection.state();
  return {
    folders: state.folders.map((folder) => ({ ...folder })),
    threads: state.threads.map((thread) => ({ ...thread })),
    records: state.records.map((record) => ({ ...record })),
  };
}

describe('auditMutationFlow', () => {
  let client: WebRelayClient;
  let projection: ProjectionStore;
  let pending: PendingCommandStore;
  let commandResults: CommandResultHandler;
  let recordEditor: RecordEditor;

  beforeEach(async () => {
    ensureAngularTestEnvironment();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        ProjectionStore,
        PendingCommandStore,
        CommandResultHandler,
        RecordEditor,
        WebRelayClient,
      ],
    });

    client = TestBed.inject(WebRelayClient);
    projection = TestBed.inject(ProjectionStore);
    pending = TestBed.inject(PendingCommandStore);
    commandResults = TestBed.inject(CommandResultHandler);
    recordEditor = TestBed.inject(RecordEditor);

    client.connect(RELAY_URL);
    MockWebSocket.last.simulateOpen();
    await seedProjectionSnapshot(client.sessionId()!);
  });

  afterEach(() => {
    client.disconnect();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('mutation_command_send', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(COMMAND_ID_101);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_101);

    const result = await auditMutationFlow({
      triggerUiAction: () => recordEditor.createRecord(THREAD_ID, 'Record from web'),
      readProjectionState: () => captureProjectionState(projection),
      isPendingCommand: (commandId) => pending.pendingByCommandId()[commandId] !== undefined,
      getCommandResult: (commandId) => commandResults.getResult(commandId),
      dispatchEnvelope: async (envelope) => {
        MockWebSocket.last.simulateEnvelope(envelope);
      },
      flushAsyncWork: flushAuthoritativeEventWork,
    }, {
      displayCommandId: 'cmd-101',
      eventEnvelope: await createRecordEventEnvelope(client.sessionId()!, COMMAND_ID_101, 'Record from web', 10),
    });

    expect(result.commandSendLog).toBe('COMMAND_SEND id=cmd-101 op=create entity=record');
    expect(result.sentCommand).toEqual({
      commandId: COMMAND_ID_101,
      originDeviceId: expect.stringMatching(/^web-/),
      entityType: 'record',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_101,
      payload: {
        threadUuid: THREAD_ID,
        body: 'Record from web',
        recordType: 'text',
      },
    });
  });

  it('no_optimistic_update', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(COMMAND_ID_101);

    const result = await auditMutationFlow({
      triggerUiAction: () => recordEditor.createRecord(THREAD_ID, 'Await event'),
      readProjectionState: () => captureProjectionState(projection),
      isPendingCommand: (commandId) => pending.pendingByCommandId()[commandId] !== undefined,
      getCommandResult: (commandId) => commandResults.getResult(commandId),
      dispatchEnvelope: async (envelope) => {
        MockWebSocket.last.simulateEnvelope(envelope);
      },
      flushAsyncWork: flushAuthoritativeEventWork,
    }, {
      displayCommandId: 'cmd-101',
      commandResultEnvelope: createCommandResultEnvelope(client.sessionId()!, COMMAND_ID_101, 'applied', 9),
      eventEnvelope: await createRecordEventEnvelope(client.sessionId()!, COMMAND_ID_101, 'Await event', 10),
    });

    expect(result.noOptimisticMutationCheck).toEqual({
      stateBeforeEvent: 'unchanged',
      stateAfterEvent: 'updated',
    });
    expect(result.commandCorrelation.pendingBeforeEvent).toBe(true);
  });

  it('event_driven_projection_update', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(COMMAND_ID_101);

    const eventEnvelope = await createRecordEventEnvelope(client.sessionId()!, COMMAND_ID_101, 'Projected record', 10);

    const result = await auditMutationFlow({
      triggerUiAction: () => recordEditor.createRecord(THREAD_ID, 'Projected record'),
      readProjectionState: () => captureProjectionState(projection),
      isPendingCommand: (commandId) => pending.pendingByCommandId()[commandId] !== undefined,
      getCommandResult: (commandId) => commandResults.getResult(commandId),
      dispatchEnvelope: async (envelope) => {
        MockWebSocket.last.simulateEnvelope(envelope);
      },
      flushAsyncWork: flushAuthoritativeEventWork,
    }, {
      displayCommandId: 'cmd-101',
      eventEnvelope,
      duplicateEventEnvelope: {
        ...eventEnvelope,
        sequence: 11,
      },
    });

    expect(result.eventApplyLog).toBe('APPLY eventVersion=201 entity=record');
    expect(result.projectionEvidence).toContain('record:generated-id-present');
    expect(result.finalState.records).toEqual([
      expect.objectContaining({
        id: GENERATED_RECORD_ID,
        threadId: THREAD_ID,
        name: 'Projected record',
      }),
    ]);
    expect(result.duplicateEventIgnored).toBe(true);
  });

  it('command_result_no_mutation', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(COMMAND_ID_101);

    const result = await auditMutationFlow({
      triggerUiAction: () => recordEditor.createRecord(THREAD_ID, 'Result only metadata'),
      readProjectionState: () => captureProjectionState(projection),
      isPendingCommand: (commandId) => pending.pendingByCommandId()[commandId] !== undefined,
      getCommandResult: (commandId) => commandResults.getResult(commandId),
      dispatchEnvelope: async (envelope) => {
        MockWebSocket.last.simulateEnvelope(envelope);
      },
      flushAsyncWork: flushAuthoritativeEventWork,
    }, {
      displayCommandId: 'cmd-101',
      commandResultEnvelope: createCommandResultEnvelope(client.sessionId()!, COMMAND_ID_101, 'applied', 9),
      eventEnvelope: await createRecordEventEnvelope(client.sessionId()!, COMMAND_ID_101, 'Result only metadata', 10),
    });

    expect(result.commandResultLog).toBe('COMMAND_RESULT id=cmd-101 status=applied');
    expect(result.commandResultStateChange).toBe('unchanged');
    expect(commandResults.getStatus(COMMAND_ID_101)).toBe('applied');
  });

  it('mutation_correlation_by_commandId', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce(COMMAND_ID_402);

    pending.setPending({
      commandId: COMMAND_ID_401,
      originDeviceId: 'web-device-seeded',
      entityType: 'thread',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_401,
      payload: {
        title: 'Other pending',
        kind: 'manual',
        folderUuid: FOLDER_ID,
      },
    });

    const result = await auditMutationFlow({
      triggerUiAction: () => recordEditor.createRecord(THREAD_ID, 'Target record'),
      readProjectionState: () => captureProjectionState(projection),
      isPendingCommand: (commandId) => pending.pendingByCommandId()[commandId] !== undefined,
      getCommandResult: (commandId) => commandResults.getResult(commandId),
      dispatchEnvelope: async (envelope) => {
        MockWebSocket.last.simulateEnvelope(envelope);
      },
      flushAsyncWork: flushAuthoritativeEventWork,
    }, {
      displayCommandId: 'cmd-402',
      commandResultEnvelope: createCommandResultEnvelope(client.sessionId()!, COMMAND_ID_402, 'applied', 9),
      eventEnvelope: await createRecordEventEnvelope(client.sessionId()!, COMMAND_ID_402, 'Target record', 10),
    });

    expect(result.commandCorrelation).toEqual({
      commandId: COMMAND_ID_402,
      pendingBeforeEvent: true,
      pendingAfterEvent: false,
      resolvedByCommandId: true,
    });
    expect(pending.pendingByCommandId()[COMMAND_ID_401]).toBeDefined();
    expect(pending.pendingByCommandId()[COMMAND_ID_402]).toBeUndefined();
  });
});