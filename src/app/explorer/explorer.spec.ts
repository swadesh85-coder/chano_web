import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { ExplorerComponent } from './explorer';
import { MutationCommandSender } from '../../transport';

describe('ExplorerComponent', () => {
  let fixture: ComponentFixture<ExplorerComponent>;
  let sendCommand: ReturnType<typeof vi.fn>;
  let pendingStore: {
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
    setPending: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    sendCommand = vi.fn(() => null);
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
      providers: [
        ExplorerActions,
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: { sendCommand } },
        {
          provide: ProjectionStore,
          useValue: {
            explorerTree: signal([
              {
                id: 'folder-1',
                name: 'Inbox',
                type: 'folder',
                children: [],
              },
            ]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplorerComponent);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('command_sent_on_user_action', () => {
    vi.spyOn(globalThis, 'prompt').mockReturnValue('Inbox Thread');
    sendCommand.mockReturnValue({
      protocolVersion: 2,
      type: 'mutation_command',
      sessionId: 'session-1',
      timestamp: 1,
      sequence: 1,
      payload: {
        commandId: 'cmd-401',
        originDeviceId: 'web-device-1',
        entityType: 'thread',
        entityId: null,
        operation: 'create',
        expectedVersion: 0,
        timestamp: 1,
        payload: {
          title: 'Inbox Thread',
          kind: 'manual',
          folderId: 'folder-1',
        },
      },
    });

    fixture.detectChanges();

    const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
    createButton.click();

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: 'Inbox Thread',
        kind: 'manual',
        folderId: 'folder-1',
      },
    });
  });

  it('ui_disabled_during_pending', () => {
    pendingStore.isCreatePending.mockReturnValue(true);

    fixture.detectChanges();

    const createButton = fixture.nativeElement.querySelector('button[aria-label="Create thread"]') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });
});