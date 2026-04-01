import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ListRowComponent } from './list_row.component';
import { EXPLORER_SIDEBAR_INDENT_STEP_PX } from './explorer_visual.tokens';

@Component({
  selector: 'app-sidebar-item',
  standalone: true,
  imports: [ListRowComponent],
  template: `
    <app-list-row
      [title]="title()"
      [metaText]="metaText()"
      [ariaLabel]="ariaLabel()"
      [kind]="kind()"
      [density]="'sidebar'"
      [selected]="selected()"
      [disabled]="disabled()"
      [indent]="depth() * sidebarIndentPx"
      (activated)="activated.emit($event)"
    >
      <ng-content select="[row-leading]"></ng-content>
      <ng-content select="[row-actions]"></ng-content>
    </app-list-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarItemComponent {
  readonly title = input.required<string>();
  readonly metaText = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly depth = input(0);
  readonly kind = input<'folder' | 'root'>('folder');

  readonly activated = output<Event>();

  protected readonly sidebarIndentPx = EXPLORER_SIDEBAR_INDENT_STEP_PX;
}