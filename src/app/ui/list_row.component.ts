import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  type ExplorerEntityType,
  type ExplorerRecordType,
  resolveExplorerBadge,
} from './explorer_visual.tokens';

export type ListRowKind = ExplorerEntityType;
export type ListRowDensity = 'sidebar' | 'folder' | 'thread' | 'record';

@Component({
  selector: 'app-list-row',
  standalone: true,
  template: `
    <div
      class="ui-list-row"
      [attr.data-kind]="kind()"
      [attr.data-density]="density()"
      [attr.data-selected]="selected()"
      [attr.data-disabled]="disabled()"
      [attr.data-pending]="pendingStatus()"
      [class.projection-pending]="pendingStatus() === 'pending'"
      [class.projection-acknowledged]="pendingStatus() === 'acknowledged'"
      [class.projection-timeout]="pendingStatus() === 'timeout'"
      [class.projection-failed]="pendingStatus() === 'failed'"
      [style.--ui-row-indent.px]="indent()"
    >
      <span class="ui-list-row__leading">
        <span class="ui-list-row__badge" [attr.data-badge]="badgeLabel()" aria-hidden="true"></span>

        <ng-content select="[row-leading]"></ng-content>
      </span>

      @if (interactive()) {
        <button
          type="button"
          [class]="mainClassName()"
          [attr.data-testid]="mainTestId()"
          [disabled]="disabled()"
          [attr.aria-label]="ariaLabel() ?? title()"
          (click)="activated.emit($event)"
        >
          <span class="ui-list-row__text">
            <span class="ui-list-row__title">{{ title() }}</span>

            @if (supportingText() !== null) {
              <span class="ui-list-row__supporting">{{ supportingText() }}</span>
            }

            @if (metaText() !== null) {
              <span class="ui-list-row__meta">{{ metaText() }}</span>
            }
          </span>
        </button>
      } @else {
        <div [class]="mainClassName()" [attr.data-testid]="mainTestId()">
          <span class="ui-list-row__text">
            <span class="ui-list-row__title">{{ title() }}</span>

            @if (supportingText() !== null) {
              <span class="ui-list-row__supporting">{{ supportingText() }}</span>
            }

            @if (metaText() !== null) {
              <span class="ui-list-row__meta">{{ metaText() }}</span>
            }
          </span>
        </div>
      }

      <span class="ui-list-row__actions">
        <ng-content select="[row-actions]"></ng-content>
      </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListRowComponent {
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
  readonly indent = input(0);
  readonly pendingStatus = input<string | null>(null);

  readonly activated = output<Event>();

  badgeLabel(): string {
    return resolveExplorerBadge(this.kind(), this.recordType());
  }

  mainClassName(): string {
    const mainClass = this.mainClass();
    return mainClass === null ? 'ui-list-row__main' : `ui-list-row__main ${mainClass}`;
  }
}