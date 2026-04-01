// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App', () => {
  it('should create the app', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/app.ts'), 'utf8');
    expect(source).toContain('export class App');
  });

  it('should contain a router-outlet', () => {
    const template = fs.readFileSync(path.resolve(process.cwd(), 'src/app/app.html'), 'utf8');
    expect(template).toContain('router-outlet');
  });
});
