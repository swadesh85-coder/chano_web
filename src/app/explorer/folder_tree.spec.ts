import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderTreeComponent } from './folder_tree';
import type { FolderTreeViewModel } from '../../viewmodels';

describe('FolderTreeComponent', () => {
  let fixture: ComponentFixture<FolderTreeComponent>;
  let component: FolderTreeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FolderTreeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderTreeComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders_recursive_folder_nodes_without_transforming_order', () => {
    const nodes: readonly FolderTreeViewModel[] = [
      {
        id: 'folder-root',
        name: 'Root',
        parentId: null,
        children: [
          {
            id: 'folder-a',
            name: 'Folder A',
            parentId: 'folder-root',
            children: [
              {
                id: 'folder-a-child',
                name: 'Folder A Child',
                parentId: 'folder-a',
                children: [],
              },
            ],
          },
          {
            id: 'folder-b',
            name: 'Folder B',
            parentId: 'folder-root',
            children: [],
          },
        ],
      },
    ];

    fixture.componentRef.setInput('nodes', nodes);
    fixture.componentRef.setInput('selectedFolderId', 'folder-a');
    fixture.detectChanges();

    const labels = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="folder-item"]'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim());

    expect(labels).toEqual([
      'Rootfolder-root',
      'Folder Afolder-a',
      'Folder A Childfolder-a-child',
      'Folder Bfolder-b',
    ]);
  });

  it('emits_selected_folder_id', () => {
    const emitted: string[] = [];
    component.folderSelected.subscribe((folderId) => emitted.push(folderId));

    fixture.componentRef.setInput('nodes', [{
      id: 'folder-a',
      name: 'Folder A',
      parentId: null,
      children: [],
    }]);
    fixture.detectChanges();

    const folderButton = fixture.nativeElement.querySelector('[data-testid="folder-item"]') as HTMLButtonElement;
    folderButton.click();

    expect(emitted).toEqual(['folder-a']);
  });
});