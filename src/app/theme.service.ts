import { Injectable, signal, effect } from '@angular/core';

type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'chano.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.loadStoredPreference());
  readonly resolvedTheme = signal<'light' | 'dark'>(this.resolveTheme(this.loadStoredPreference()));

  private readonly systemQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

  constructor() {
    effect(() => {
      const mode = this.mode();
      const resolved = this.resolveTheme(mode);
      this.resolvedTheme.set(resolved);
      this.applyTheme(resolved);
      this.persistPreference(mode);
    });

    this.systemQuery?.addEventListener('change', () => {
      if (this.mode() === 'system') {
        const resolved = this.resolveTheme('system');
        this.resolvedTheme.set(resolved);
        this.applyTheme(resolved);
      }
    });

    this.applyTheme(this.resolvedTheme());
  }

  toggle(): void {
    const current = this.resolvedTheme();
    this.mode.set(current === 'dark' ? 'light' : 'dark');
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  private resolveTheme(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'system') {
      return this.systemQuery?.matches ? 'dark' : 'light';
    }
    return mode;
  }

  private applyTheme(theme: 'light' | 'dark'): void {
    const html = globalThis.document?.documentElement;
    if (html == null) {
      return;
    }
    if (theme === 'dark') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', theme);
    }
  }

  private loadStoredPreference(): ThemeMode {
    try {
      const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // localStorage unavailable
    }
    return 'system';
  }

  private persistPreference(mode: ThemeMode): void {
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // localStorage unavailable
    }
  }
}
