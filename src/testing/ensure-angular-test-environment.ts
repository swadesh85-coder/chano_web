import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

let angularTestEnvironmentInitialized = false;

export function ensureAngularTestEnvironment(): void {
  if (angularTestEnvironmentInitialized) {
    return;
  }

  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cannot set base providers because it has already been called')) {
      throw error;
    }
  }

  angularTestEnvironmentInitialized = true;
}