import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import {
  ContextMenuService,
  type ContextMenuItem,
} from './context_menu.service';

@Component({
  selector: 'app-context-menu',
  standalone: true,
  template: `
    @if (contextMenu.state(); as menu) {
      <div
        class="context-menu-overlay"
        (click)="contextMenu.close()"
        (contextmenu)="$event.preventDefault(); contextMenu.close()"
        aria-hidden="true"
      ></div>
      <ul
        class="context-menu"
        role="menu"
        [attr.aria-label]="'Actions for ' + menu.targetType"
        [style.left.px]="menu.x"
        [style.top.px]="menu.y"
      >
        @for (item of menu.items; track item.id; let i = $index) {
          <li
            class="context-menu__item"
            [class.context-menu__item--danger]="item.danger === true"
            [class.context-menu__item--disabled]="item.disabled === true"
            [class.context-menu__item--focused]="focusedIndex() === i"
            role="menuitem"
            [attr.aria-disabled]="item.disabled === true ? 'true' : null"
            [attr.tabindex]="focusedIndex() === i ? 0 : -1"
            (click)="onItemClick(item, $event)"
            (mouseenter)="focusedIndex.set(i)"
          >
            @if (item.icon) {
              <span class="context-menu__icon material-symbols-rounded" aria-hidden="true">{{ item.icon }}</span>
            }
            <span class="context-menu__label">{{ item.label }}</span>
          </li>
          @if (item.dividerAfter) {
            <li class="context-menu__divider" role="separator" aria-hidden="true"></li>
          }
        }
      </ul>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuComponent implements OnDestroy {
  protected readonly contextMenu = inject(ContextMenuService);
  protected readonly focusedIndex = signal(0);

  private readonly selectedAction = signal<{
    readonly item: ContextMenuItem;
    readonly targetId: string;
    readonly targetType: string;
  } | null>(null);

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const menu = this.contextMenu.state();
    if (!menu) return;

    const items = menu.items;
    const enabledIndices = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !item.disabled)
      .map(({ i }) => i);

    if (enabledIndices.length === 0) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const currentPos = enabledIndices.indexOf(this.focusedIndex());
        const nextPos = currentPos < enabledIndices.length - 1 ? currentPos + 1 : 0;
        this.focusedIndex.set(enabledIndices[nextPos]);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const currentPos = enabledIndices.indexOf(this.focusedIndex());
        const prevPos = currentPos > 0 ? currentPos - 1 : enabledIndices.length - 1;
        this.focusedIndex.set(enabledIndices[prevPos]);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const focused = items[this.focusedIndex()];
        if (focused && !focused.disabled) {
          this.onItemClick(focused, event);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.contextMenu.close();
        break;
    }
  }

  onItemClick(item: ContextMenuItem, event: Event): void {
    event.stopPropagation();
    if (item.disabled) return;

    const menu = this.contextMenu.state();
    if (!menu) return;

    this.selectedAction.set({
      item,
      targetId: menu.targetId,
      targetType: menu.targetType,
    });
    this.contextMenu.close();
  }

  getLastAction() {
    return this.selectedAction();
  }

  ngOnDestroy(): void {
    this.contextMenu.close();
  }
}
