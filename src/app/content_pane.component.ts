import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ContentPaneComponent as ExplorerContentPaneComponent } from './explorer/content_pane';
import type { NavigationPane } from './navigation.state';
import type {
  ContentPaneViewModel,
  FolderTreeViewModel,
  RecordViewModel,
} from '../viewmodels';
import { ContentItemRowComponent } from './ui/content_item_row.component';
import { SectionHeaderComponent } from './ui/section_header.component';

@Component({
  selector: 'app-explorer-content-pane',
  standalone: true,
  imports: [ExplorerContentPaneComponent, ContentItemRowComponent, SectionHeaderComponent],
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .layout-pane__body {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        overflow: hidden;
      }

      .content-main-section {
        flex: 1;
        min-height: 0;
      }

      app-content-pane {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .content-folder-list {
        display: grid;
        gap: var(--space-3);
      }
    `,
  ],
  template: `
    <section class="layout-pane layout-pane--content" aria-label="Content pane panel">
      <app-section-header
        [title]="'Content Pane'"
        [subtitle]="subtitle()"
        [eyebrow]="'Projection view'"
      ></app-section-header>

      <div class="layout-pane__body" role="region" aria-label="Content pane">
        @if (activePane() === 'folder' && childFolders().length > 0) {
          <section class="content-folder-section" aria-label="Visible folders">
            <app-section-header
              [title]="'Folders'"
              [subtitle]="'Subfolders within the current selection'"
              [eyebrow]="'Browse'"
            ></app-section-header>

            <div class="content-folder-list">
              @for (folder of childFolders(); track folder.id) {
                <app-content-item-row
                  data-testid="content-folder-item"
                  [title]="folder.name"
                  [metaText]="folder.id"
                  [kind]="'folder'"
                  [density]="'folder'"
                  [ariaLabel]="'Open folder ' + folder.name"
                  (activated)="folderSelected.emit(folder.id)"
                ></app-content-item-row>
              }
            </div>
          </section>
        }

        <section class="content-main-section" [attr.data-mode]="content().mode">
          <app-content-pane
            [content]="content()"
            [selectedThreadId]="selectedThreadId()"
            [activeThreadId]="selectedThreadId()"
            [disabledThreadIds]="disabledThreadIds()"
            [disabledRecordIds]="disabledRecordIds()"
            [createRecordDisabled]="createRecordDisabled()"
            (threadSelected)="threadSelected.emit($event)"
            (threadRenameRequested)="threadRenameRequested.emit($event)"
            (threadMoveRequested)="threadMoveRequested.emit($event)"
            (threadDeleteRequested)="threadDeleteRequested.emit($event)"
            (createRecordRequested)="createRecordRequested.emit($event)"
            (recordEditRequested)="recordEditRequested.emit($event)"
            (recordRenameRequested)="recordRenameRequested.emit($event)"
            (recordMoveRequested)="recordMoveRequested.emit($event)"
            (recordDeleteRequested)="recordDeleteRequested.emit($event)"
          ></app-content-pane>
        </section>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerContentPaneShellComponent {
  readonly activePane = input<NavigationPane>('empty');
  readonly content = input.required<ContentPaneViewModel>();
  readonly childFolders = input<readonly FolderTreeViewModel[]>([]);
  readonly selectedThreadId = input<string | null>(null);
  readonly selectedFolderId = input<string | null>(null);
  readonly selectedFolder = input<FolderTreeViewModel | null>(null);
  readonly disabledThreadIds = input<Readonly<Record<string, boolean>>>({});
  readonly disabledRecordIds = input<Readonly<Record<string, boolean>>>({});
  readonly createRecordDisabled = input(false);

  readonly folderSelected = output<string>();
  readonly threadSelected = output<string>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();
  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();

  subtitle(): string {
    if (this.activePane() === 'thread') {
      return 'Thread contents';
    }

    if (this.activePane() === 'folder' && this.selectedFolderId() === null) {
      return 'Root folder contents';
    }

    if (this.activePane() === 'folder') {
      return this.selectedFolder()?.name ?? 'Selected folder';
    }

    return 'No selection';
  }
}