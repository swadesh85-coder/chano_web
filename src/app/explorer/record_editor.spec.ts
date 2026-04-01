import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerMutationGateway } from './explorer_mutation_gateway';
import { RecordEditor } from './record_editor';

describe('RecordEditor', () => {
  let editor: RecordEditor;
  let gateway: {
    createRecord: ReturnType<typeof vi.fn>;
    updateRecord: ReturnType<typeof vi.fn>;
    renameRecord: ReturnType<typeof vi.fn>;
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    gateway = {
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      renameRecord: vi.fn(),
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
    };

    const injector = Injector.create({
      providers: [
        { provide: ExplorerMutationGateway, useValue: gateway },
      ],
    });

    editor = runInInjectionContext(injector, () => new RecordEditor());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('record_create_command', () => {
    editor.createRecord('thread:0001', 'New record');

    expect(gateway.createRecord).toHaveBeenCalledWith('thread:0001', 'New record');
  });

  it('record_update_command', () => {
    editor.updateRecord('record:text-1', 'Updated body');

    expect(gateway.updateRecord).toHaveBeenCalledWith('record:text-1', 'Updated body');
  });

  it('record_rename_command', () => {
    editor.renameRecord('record:text-1', 'Renamed record');

    expect(gateway.renameRecord).toHaveBeenCalledWith('record:text-1', 'Renamed record');
  });

  it('expected_version_match', () => {
    editor.updateRecord('record:text-9', 'Versioned update');

    expect(gateway.updateRecord).toHaveBeenCalledWith('record:text-9', 'Versioned update');
  });
});