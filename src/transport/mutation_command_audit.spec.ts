import { TestBed } from '@angular/core/testing';
import { ExplorerComponent } from '../app/explorer/explorer';
import { ProjectionStore } from '../app/projection/projection.store';
import type { CommandResultStatus, MutationCommand } from './mutation-command';
import { CommandResultHandler } from './command-result-handler';
import { MutationCommandSender } from './mutation-command-sender';
import type { TransportEnvelope } from './transport-envelope';
import { WebRelayClient } from './web-relay-client';

const FOLDER_ID = '123e4567-e89b-42d3-a456-426614174301';
const GENERATED_THREAD_ID = '123e4567-e89b-42d3-a456-426614174302';
const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174303';
const BASE_EVENT_VERSION = 50;
const RELAY_URL = 'ws://relay.audit.local/relay';
const ALLOWED_RESULT_STATUSES: readonly CommandResultStatus[] = [
  'applied',
  'alreadyApplied',
  'rejected',
  'conflict',
  'notFound',
  'forbidden',
];

type MutationAuditSendResult = {
  readonly envelope: TransportEnvelope<MutationCommand>;
  readonly rawEnvelope: TransportEnvelope<MutationCommand>;
};

type MutationAuditRoutingResult = {
  readonly routingLogs: readonly string[];
};

type MutationAuditCommandResult = {
  readonly commandResultLog: string;
  readonly status: CommandResultStatus;
};

type MutationAuditLocalMutationResult = {
  readonly beforeState: ReturnType<typeof captureProjectionState>;
  readonly afterSendState: ReturnType<typeof captureProjectionState>;
  readonly changedBeforeEvent: boolean;
};

type MutationAuditEventDrivenResult = {
  readonly beforeEventState: ReturnType<typeof captureProjectionState>;
  readonly afterEventState: ReturnType<typeof captureProjectionState>;
  readonly lastAppliedEventVersion: number | null;
};

type MutationAuditIdempotencyResult = {
  readonly firstEnvelope: TransportEnvelope<MutationCommand>;
  readonly secondEnvelope: TransportEnvelope<MutationCommand>;
  readonly resultStatus: CommandResultStatus | null;
  readonly threadCount: number;
};

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

type WsHandler = ((ev: { data: string }) => void) | null;

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

async function flushAuthoritativeEventWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function seedProjectionSnapshot(sessionId: string): Promise<void> {
  const snapshotJson = JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: FOLDER_ID,
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: FOLDER_ID,
          name: 'Inbox',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [],
    records: [],
  });
  const snapshotBytes = encodeUtf8(snapshotJson);
  const checksum = await sha256Hex(snapshotBytes);

  MockWebSocket.last.simulateEnvelope(createEnvelope('snapshot_start', sessionId, 1, 1_710_000_001, {
    snapshotId: 'snapshot-mutation-audit-1',
    totalChunks: 1,
    totalBytes: snapshotBytes.byteLength,
    snapshotVersion: 1,
    protocolVersion: 2,
    schemaVersion: 1,
    baseEventVersion: BASE_EVENT_VERSION,
    entityCount: 1,
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

function parseSentEnvelope(index: number): TransportEnvelope<MutationCommand> {
  return JSON.parse(MockWebSocket.last.sent[index]!) as TransportEnvelope<MutationCommand>;
}

function captureProjectionState(projection: ProjectionStore) {
  return {
    folders: projection.folders().map((folder) => ({ ...folder })),
    threads: projection.threads().map((thread) => ({ ...thread })),
    records: projection.records().map((record) => ({ ...record })),
    lastAppliedEventVersion: projection.lastAppliedEventVersion(),
  };
}

function expectExactCommandSchema(command: MutationCommand): void {
  expect(Object.keys(command).sort()).toEqual([
    'commandId',
    'entityId',
    'entityType',
    'expectedVersion',
    'operation',
    'originDeviceId',
    'payload',
    'timestamp',
  ]);
  expect(Object.keys(command.payload).sort()).toEqual([
    'folderId',
    'kind',
    'title',
  ]);
}

async function createThreadEventEnvelope(
  sessionId: string,
  eventVersion: number,
  entityId: string,
  title: string,
  sequence: number,
  commandId?: string,
): Promise<TransportEnvelope> {
  const payload = {
    ...(commandId ? { commandId } : {}),
    uuid: entityId,
    folderUuid: FOLDER_ID,
    title,
  };

  return createEnvelope('event_stream', sessionId, sequence, 1_710_000_100 + eventVersion, {
    eventId: `evt-${eventVersion}`,
    originDeviceId: 'mobile-1',
    eventVersion,
    entityType: 'thread',
    entityId,
    operation: 'create',
    timestamp: 1_710_000_100 + eventVersion,
    payload,
    checksum: await checksumForPayload(payload),
  });
}

function createCommandResultEnvelope(
  sessionId: string,
  commandId: string,
  status: CommandResultStatus,
  sequence: number,
  message: string,
): TransportEnvelope {
  return createEnvelope('command_result', sessionId, sequence, 1_710_000_200 + sequence, {
    commandId,
    status,
    message,
  });
}

async function auditCommandSend(
  fixture: ReturnType<typeof TestBed.createComponent<ExplorerComponent>>,
  title: string,
): Promise<MutationAuditSendResult> {
  vi.spyOn(globalThis, 'prompt').mockReturnValue(title);

  fixture.componentInstance.selectFolder(FOLDER_ID);
  await fixture.whenStable();
  fixture.detectChanges();
  const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
  expect(createButton).toBeTruthy();
  createButton.click();

  const rawEnvelope = parseSentEnvelope(MockWebSocket.last.sent.length - 1);

  return {
    envelope: rawEnvelope,
    rawEnvelope,
  };
}

function auditCommandRouting(capturedLogs: readonly string[], envelope: TransportEnvelope<MutationCommand>): MutationAuditRoutingResult {
  expect(capturedLogs).toContain(`WEB_SEND mutation_command session=${envelope.sessionId} seq=${envelope.sequence}`);
  expect(capturedLogs).toContain(`RELAY_ROUTE web→mobile type=mutation_command session=${envelope.sessionId}`);

  return {
    routingLogs: capturedLogs.filter((entry) => entry.includes('mutation_command') || entry.includes('RELAY_ROUTE web→mobile')),
  };
}

function auditCommandResultHandling(
  commandResults: CommandResultHandler,
  sessionId: string,
  commandId: string,
  status: CommandResultStatus,
): MutationAuditCommandResult {
  MockWebSocket.last.simulateEnvelope(createCommandResultEnvelope(sessionId, commandId, status, 10, 'Applied on mobile'));

  expect(ALLOWED_RESULT_STATUSES).toContain(status);
  expect(commandResults.getStatus(commandId)).toBe(status);

  return {
    commandResultLog: `COMMAND_RESULT_RECEIVED ${commandId} status=${status}`,
    status,
  };
}

async function auditNoLocalMutation(
  projection: ProjectionStore,
  send: () => Promise<MutationAuditSendResult>,
): Promise<MutationAuditLocalMutationResult> {
  const beforeState = captureProjectionState(projection);
  await send();
  const afterSendState = captureProjectionState(projection);

  return {
    beforeState,
    afterSendState,
    changedBeforeEvent: JSON.stringify(beforeState) !== JSON.stringify(afterSendState),
  };
}

async function auditEventDrivenUpdate(
  projection: ProjectionStore,
  sessionId: string,
  commandId: string,
  entityId: string,
  title: string,
): Promise<MutationAuditEventDrivenResult> {
  const beforeEventState = captureProjectionState(projection);
  MockWebSocket.last.simulateEnvelope(await createThreadEventEnvelope(
    sessionId,
    BASE_EVENT_VERSION + 1,
    entityId,
    title,
    11,
    commandId,
  ));
  await flushAuthoritativeEventWork();

  return {
    beforeEventState,
    afterEventState: captureProjectionState(projection),
    lastAppliedEventVersion: projection.lastAppliedEventVersion(),
  };
}

async function auditIdempotency(
  sender: MutationCommandSender,
  projection: ProjectionStore,
  commandResults: CommandResultHandler,
  sessionId: string,
): Promise<MutationAuditIdempotencyResult> {
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce(COMMAND_ID)
    .mockReturnValueOnce(COMMAND_ID);
  vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

  const firstEnvelope = sender.sendCommand({
    entityType: 'thread',
    operation: 'create',
    payload: {
      title: 'Idempotent Thread',
      kind: 'manual',
      folderId: FOLDER_ID,
    },
  });
  const secondEnvelope = sender.sendCommand({
    entityType: 'thread',
    operation: 'create',
    payload: {
      title: 'Idempotent Thread',
      kind: 'manual',
      folderId: FOLDER_ID,
    },
  });

  expect(firstEnvelope).not.toBeNull();
  expect(secondEnvelope).not.toBeNull();

  MockWebSocket.last.simulateEnvelope(createCommandResultEnvelope(sessionId, COMMAND_ID, 'applied', 12, 'Applied on mobile'));
  MockWebSocket.last.simulateEnvelope(await createThreadEventEnvelope(
    sessionId,
    BASE_EVENT_VERSION + 1,
    GENERATED_THREAD_ID,
    'Idempotent Thread',
    13,
    COMMAND_ID,
  ));
  await flushAuthoritativeEventWork();
  MockWebSocket.last.simulateEnvelope(createCommandResultEnvelope(sessionId, COMMAND_ID, 'alreadyApplied', 14, 'Duplicate command ignored'));
  await flushAuthoritativeEventWork();

  const projectionState = captureProjectionState(projection);

  return {
    firstEnvelope: firstEnvelope!,
    secondEnvelope: secondEnvelope!,
    resultStatus: commandResults.getStatus(COMMAND_ID),
    threadCount: projectionState.threads.filter((thread) => thread.id === GENERATED_THREAD_ID).length,
  };
}

describe('MutationCommandSender audit', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ExplorerComponent>>;
  let client: WebRelayClient;
  let projection: ProjectionStore;
  let sender: MutationCommandSender;
  let commandResults: CommandResultHandler;
  let capturedLogs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    capturedLogs = [];

    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
    }).compileComponents();

    const originalLog = console.log;
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args.map((value) => String(value)).join(' '));
      originalLog(...args);
    });

    fixture = TestBed.createComponent(ExplorerComponent);
    client = TestBed.inject(WebRelayClient);
    projection = TestBed.inject(ProjectionStore);
    sender = TestBed.inject(MutationCommandSender);
    commandResults = TestBed.inject(CommandResultHandler);

    client.connect(RELAY_URL);
    MockWebSocket.last.simulateOpen();
    await seedProjectionSnapshot(client.sessionId()!);
    fixture.detectChanges();
  });

  afterEach(() => {
    client.disconnect();
    fixture.destroy();
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('mutation_command_envelope_valid', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(COMMAND_ID);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const sendAudit = await auditCommandSend(fixture, 'Draft from web');

    expect(sendAudit.envelope.type).toBe('mutation_command');
    expect(sendAudit.envelope.protocolVersion).toBe(2);
    expect(sendAudit.envelope.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(sendAudit.envelope.sessionId).toBe(client.sessionId());
    expect(typeof sendAudit.envelope.timestamp).toBe('number');
    expect(sendAudit.envelope.sequence).toBe(1);
    expectExactCommandSchema(sendAudit.envelope.payload);
    expect(sendAudit.rawEnvelope).toEqual(sendAudit.envelope);
    expect(sendAudit.envelope.payload).toEqual({
      commandId: COMMAND_ID,
      originDeviceId: expect.stringMatching(/^web-/),
      entityType: 'thread',
      entityId: null,
      operation: 'create',
      expectedVersion: 0,
      timestamp: 1_710_000_000,
      payload: {
        title: 'Draft from web',
        kind: 'manual',
        folderId: FOLDER_ID,
      },
    });
  });

  it('mutation_command_routing', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(COMMAND_ID);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const sendAudit = await auditCommandSend(fixture, 'Draft from web');
    const routingAudit = auditCommandRouting(capturedLogs, sendAudit.envelope);

    expect(routingAudit.routingLogs).toContain(`WEB_SEND mutation_command session=${sendAudit.envelope.sessionId} seq=${sendAudit.envelope.sequence}`);
    expect(routingAudit.routingLogs).toContain(`RELAY_ROUTE web→mobile type=mutation_command session=${sendAudit.envelope.sessionId}`);
    expect(parseSentEnvelope(0)).toEqual(sendAudit.envelope);
  });

  it('command_result_handling', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(COMMAND_ID);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const sendAudit = await auditCommandSend(fixture, 'Draft from web');
    const resultAudit = auditCommandResultHandling(
      commandResults,
      sendAudit.envelope.sessionId!,
      sendAudit.envelope.payload.commandId,
      'applied',
    );

    expect(resultAudit.status).toBe('applied');
    expect(commandResults.results()[COMMAND_ID]).toEqual({
      commandId: COMMAND_ID,
      status: 'applied',
      message: 'Applied on mobile',
    });
    expect(capturedLogs).toContain(`COMMAND_RESULT_RECEIVED commandId=${COMMAND_ID} status=applied`);
  });

  it('no_local_projection_mutation', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(COMMAND_ID);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const mutationAudit = await auditNoLocalMutation(projection, async () => auditCommandSend(fixture, 'Awaiting authority'));

    expect(mutationAudit.changedBeforeEvent).toBe(false);
    expect(mutationAudit.beforeState).toEqual(mutationAudit.afterSendState);
    expect(mutationAudit.afterSendState.threads).toHaveLength(0);
    expect(mutationAudit.afterSendState.lastAppliedEventVersion).toBe(BASE_EVENT_VERSION);
  });

  it('event_driven_projection_update', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(COMMAND_ID);
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000);

    const sendAudit = await auditCommandSend(fixture, 'Authoritative thread');
    const eventAudit = await auditEventDrivenUpdate(
      projection,
      sendAudit.envelope.sessionId!,
      sendAudit.envelope.payload.commandId,
      GENERATED_THREAD_ID,
      'Authoritative thread',
    );

    expect(eventAudit.beforeEventState.threads).toHaveLength(0);
    expect(eventAudit.afterEventState.threads).toEqual([
      {
        id: GENERATED_THREAD_ID,
        folderId: FOLDER_ID,
        title: 'Authoritative thread',
      },
    ]);
    expect(eventAudit.lastAppliedEventVersion).toBe(BASE_EVENT_VERSION + 1);
    expect(capturedLogs).toContain(`EVENT_FORWARDED_TO_ENGINE eventVersion=${BASE_EVENT_VERSION + 1}`);
  });

  it('command_idempotency', async () => {
    const idempotencyAudit = await auditIdempotency(sender, projection, commandResults, client.sessionId()!);

    expect(idempotencyAudit.firstEnvelope.sessionId).toBe(idempotencyAudit.secondEnvelope.sessionId);
    expect(idempotencyAudit.secondEnvelope.sequence).toBe(idempotencyAudit.firstEnvelope.sequence + 1);
    expect(idempotencyAudit.firstEnvelope.payload).toEqual(idempotencyAudit.secondEnvelope.payload);
    expect(idempotencyAudit.resultStatus).toBe('alreadyApplied');
    expect(idempotencyAudit.threadCount).toBe(1);
    expect(capturedLogs).toContain(`COMMAND_RESULT_RECEIVED commandId=${COMMAND_ID} status=alreadyApplied`);
  });
});