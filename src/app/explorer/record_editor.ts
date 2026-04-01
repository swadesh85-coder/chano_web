import { Injectable, inject } from '@angular/core';
import { ExplorerMutationGateway, type ExplorerMutationEnvelope } from './explorer_mutation_gateway';

@Injectable({ providedIn: 'root' })
export class RecordEditor {
  private readonly mutations = inject(ExplorerMutationGateway);

  createRecord(threadId: string, body: string): ExplorerMutationEnvelope | null {
    const normalizedBody = normalizeRequiredText(body, 'INVALID_RECORD_BODY');

    if (this.mutations.isCreatePending('record')) {
      return null;
    }

    console.log(`UI_ACTION create_record thread=${threadId}`);
    return this.mutations.createRecord(threadId, normalizedBody);
  }

  updateRecord(recordId: string, body: string): ExplorerMutationEnvelope | null {
    const normalizedBody = normalizeRequiredText(body, 'INVALID_RECORD_BODY');

    if (this.mutations.isPending(recordId)) {
      return null;
    }

    console.log(`UI_ACTION update_record id=${recordId}`);
    return this.mutations.updateRecord(recordId, normalizedBody);
  }

  renameRecord(recordId: string, newTitle: string): ExplorerMutationEnvelope | null {
    const normalizedTitle = normalizeRequiredText(newTitle, 'INVALID_RECORD_TITLE');

    if (this.mutations.isPending(recordId)) {
      return null;
    }

    console.log(`UI_ACTION rename_record id=${recordId}`);
    return this.mutations.renameRecord(recordId, normalizedTitle);
  }

  isPending(recordId: string): boolean {
    return this.mutations.isPending(recordId);
  }

  isCreatePending(): boolean {
    return this.mutations.isCreatePending('record');
  }
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(errorCode);
  }

  return normalizedValue;
}