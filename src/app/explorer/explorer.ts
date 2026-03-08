import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ProjectionStore } from '../projection/projection.store';
import type { ExplorerNode } from '../projection/projection.models';

@Component({
  selector: 'app-explorer',
  imports: [NgTemplateOutlet],
  templateUrl: './explorer.html',
  styleUrl: './explorer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerComponent {
  private readonly projection = inject(ProjectionStore);

  readonly tree = this.projection.explorerTree;
  readonly expandedIds = signal(new Set<string>());

  toggle(nodeId: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  isExpanded(nodeId: string): boolean {
    return this.expandedIds().has(nodeId);
  }

  trackNode(_index: number, node: ExplorerNode): string {
    return node.id;
  }
}
