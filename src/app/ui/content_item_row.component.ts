import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { type ExplorerRecordType } from './explorer_visual.tokens';
import {
  type ListRowDensity,
  type ListRowKind,
  ListRowComponent,
} from './list_row.component';

@Component({
  selector: 'app-content-item-row',
  imports: [ListRowComponent],
  template: `
    <app-list-row
      [title]="title()"
      [supportingText]="supportingText()"
      [metaText]="metaText()"
      [ariaLabel]="ariaLabel()"
      [mainClass]="mainClass()"
      [mainTestId]="mainTestId()"
      [kind]="kind()"
      [recordType]="recordType()"
      [density]="density()"
      [selected]="selected()"
      [disabled]="disabled()"
      [interactive]="interactive()"
      [pendingStatus]="pendingStatus()"
      (activated)="activated.emit($event)"
    >
      <span class="ui-content-item-row__projection" row-leading>
        <ng-content select="[row-leading]"></ng-content>
      </span>

      <span class="ui-content-item-row__projection" row-actions>
        <ng-content select="[row-actions]"></ng-content>
      </span>
    </app-list-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentItemRowComponent {
  readonly title = input.required<string>();
  readonly supportingText = input<string | null>(null);
  readonly metaText = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly mainClass = input<string | null>(null);
  readonly mainTestId = input<string | null>(null);
  readonly kind = input<ListRowKind>('record');
  readonly recordType = input<ExplorerRecordType | null>(null);
  readonly density = input<ListRowDensity>('thread');
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly interactive = input(true);
  readonly pendingStatus = input<string | null>(null);

  readonly activated = output<Event>();
}