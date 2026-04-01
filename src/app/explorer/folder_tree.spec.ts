// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAngularTestEnvironment } from '../../testing/ensure-angular-test-environment';
import { FolderTreeComponent } from './folder_tree';

describe('FolderTreeComponent', () => {
  let fixture: ComponentFixture<FolderTreeComponent>;
  let component: FolderTreeComponent;

  beforeEach(async () => {
    ensureAngularTestEnvironment();

    await TestBed.configureTestingModule({
      imports: [FolderTreeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderTreeComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('declares_recursive_folder_template_without_in_ui_reordering', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/folder_tree.ts'), 'utf8');

    expect(source).toContain('@for (node of nodes; track trackFolder($index, node))');
    expect(source).toContain('*ngTemplateOutlet="folderTreeNodes; context: { $implicit: node.children, depth: depth + 1 }"');
    expect(source).toContain('*ngTemplateOutlet="folderTreeNodes; context: { $implicit: nodes(), depth: 0 }"');
    expect(source).not.toContain('.sort(');
    expect(source).not.toContain('toSorted(');
  });

  it('emits_selected_folder_id', () => {
    const emitted: string[] = [];

    component.folderSelected.subscribe((folderId) => emitted.push(folderId));
    component.selectFolder('folder-a');

    expect(emitted).toEqual(['folder-a']);
  });
});