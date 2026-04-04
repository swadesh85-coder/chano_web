import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  ViewChild,
  inject,
  input,
  output,
} from '@angular/core';
import { ThemeService } from './theme.service';

export type SyncStatus = 'synced' | 'syncing' | 'disconnected' | 'error';

@Component({
  selector: 'app-explorer-toolbar',
  standalone: true,
  template: `
    <header class="explorer-toolbar" aria-label="Explorer toolbar">
      <div class="explorer-toolbar__left">
        <button
          type="button"
          class="explorer-toolbar__hamburger"
          (click)="sidebarToggleRequested.emit()"
          aria-label="Toggle sidebar"
        >
          <span class="material-symbols-outlined icon-md">menu</span>
        </button>

        <a class="explorer-toolbar__logo" href="/" aria-label="Chano home">
          <span class="explorer-toolbar__logo-mark material-symbols-outlined icon-md">diamond</span>
          <span class="explorer-toolbar__logo-wordmark">Chano</span>
        </a>

        <nav class="explorer-toolbar__breadcrumb" aria-label="Breadcrumb">
          @for (segment of breadcrumbSegments(); track segment; let last = $last) {
            @if (!last) {
              <button
                type="button"
                class="explorer-toolbar__breadcrumb-segment"
                (click)="breadcrumbNavigated.emit(segment)"
              >{{ segment }}</button>
              <span class="explorer-toolbar__breadcrumb-sep material-symbols-outlined icon-sm" aria-hidden="true">chevron_right</span>
            } @else {
              <span class="explorer-toolbar__breadcrumb-current">{{ segment }}</span>
            }
          }
        </nav>
      </div>

      <div class="explorer-toolbar__center">
        <label class="explorer-toolbar__search">
          <span class="material-symbols-outlined icon-md explorer-toolbar__search-icon" aria-hidden="true">search</span>
          <input
            #searchInput
            type="search"
            class="explorer-toolbar__search-input"
            placeholder="Search in Chano"
            aria-label="Search in Chano"
            (input)="onSearchInput($event)"
          />
          <kbd class="explorer-toolbar__search-hint" aria-hidden="true">/</kbd>
        </label>
      </div>

      <div class="explorer-toolbar__right">
        <div class="explorer-toolbar__new-wrapper">
          <button
            type="button"
            class="explorer-toolbar__new-button"
            (click)="newItemRequested.emit()"
            aria-label="Create new item"
          >
            <span class="material-symbols-outlined icon-md" aria-hidden="true">add</span>
            New
          </button>
        </div>

        <button
          type="button"
          class="explorer-toolbar__icon-button"
          [attr.aria-label]="syncStatusLabel()"
          [class.explorer-toolbar__sync--syncing]="syncStatus() === 'syncing'"
          [class.explorer-toolbar__sync--disconnected]="syncStatus() === 'disconnected'"
          [class.explorer-toolbar__sync--error]="syncStatus() === 'error'"
        >
          <span class="material-symbols-outlined icon-md">{{ syncIcon() }}</span>
        </button>

        <button
          type="button"
          class="explorer-toolbar__icon-button"
          (click)="themeService.toggle()"
          [attr.aria-label]="themeService.resolvedTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <span class="material-symbols-outlined icon-md">{{ themeService.resolvedTheme() === 'dark' ? 'light_mode' : 'dark_mode' }}</span>
        </button>

        <button
          type="button"
          class="explorer-toolbar__avatar"
          aria-label="Profile menu"
        >
          <span class="explorer-toolbar__avatar-initials">U</span>
        </button>
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarComponent implements AfterViewInit {
  protected readonly themeService = inject(ThemeService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('searchInput') private readonly searchInputRef!: ElementRef<HTMLInputElement>;

  readonly breadcrumbSegments = input<readonly string[]>(['My Vault']);
  readonly syncStatus = input<SyncStatus>('disconnected');

  readonly sidebarToggleRequested = output<void>();
  readonly viewToggleRequested = output<void>();
  readonly newItemRequested = output<void>();
  readonly breadcrumbNavigated = output<string>();
  readonly searchQueryChanged = output<string>();

  private keydownListener: ((e: KeyboardEvent) => void) | null = null;

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.keydownListener = (event: KeyboardEvent) => {
        if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const target = event.target as HTMLElement;
          const tag = target.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
          event.preventDefault();
          this.focusSearch();
        }
      };
      document.addEventListener('keydown', this.keydownListener);
    });

    this.destroyRef.onDestroy(() => {
      if (this.keydownListener) {
        document.removeEventListener('keydown', this.keydownListener);
        this.keydownListener = null;
      }
    });
  }

  focusSearch(): void {
    this.searchInputRef?.nativeElement?.focus();
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQueryChanged.emit(value);
  }

  protected syncIcon(): string {
    switch (this.syncStatus()) {
      case 'synced': return 'cloud_done';
      case 'syncing': return 'sync';
      case 'disconnected': return 'cloud_off';
      case 'error': return 'error';
    }
  }

  protected syncStatusLabel(): string {
    switch (this.syncStatus()) {
      case 'synced': return 'Synced';
      case 'syncing': return 'Syncing…';
      case 'disconnected': return 'Disconnected — waiting for mobile connection';
      case 'error': return 'Sync error';
    }
  }
}