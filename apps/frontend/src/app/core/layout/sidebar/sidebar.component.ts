import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faChartBar,
  faChartLine,
  faFolderOpen,
  faGear,
  faListCheck,
  faServer,
  faSliders,
} from '@fortawesome/pro-solid-svg-icons';
import { NodeService } from '../../services/node.service';

interface MenuItem {
  label: string;
  icon: IconDefinition;
  route: string;
  mainNodeOnly?: boolean; // If true, only show for MAIN nodes
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, FontAwesomeModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent implements OnInit {
  private readonly nodeService = inject(NodeService);

  private readonly allMenuItems: MenuItem[] = [
    { label: 'Overview', icon: faChartLine, route: '/overview', mainNodeOnly: true },
    { label: 'Queue', icon: faListCheck, route: '/queue' },
    { label: 'Libraries', icon: faFolderOpen, route: '/libraries', mainNodeOnly: true },
    { label: 'Policies', icon: faSliders, route: '/policies', mainNodeOnly: true },
    { label: 'Nodes', icon: faServer, route: '/nodes', mainNodeOnly: true },
    { label: 'Insights', icon: faChartBar, route: '/insights', mainNodeOnly: true },
    { label: 'Settings', icon: faGear, route: '/settings' },
  ];

  /**
   * Reactive menu items that filter based on node role
   *
   * - MAIN nodes: See all menu items
   * - LINKED nodes: Only see Queue and Settings
   */
  readonly menuItems = computed(() => {
    const isMainNode = this.nodeService.isMainNode();

    if (isMainNode) {
      return this.allMenuItems;
    }

    // LINKED nodes only see non-restricted items
    return this.allMenuItems.filter((item) => !item.mainNodeOnly);
  });

  /**
   * Expose current node signal for template
   */
  readonly currentNode = this.nodeService.getNodeSignal();

  /**
   * Expose main node signal for template
   */
  readonly mainNode = this.nodeService.getMainNodeSignal();

  /**
   * Check if current node is MAIN
   */
  isMainNode(): boolean {
    return this.nodeService.isMainNode();
  }

  /**
   * Check if current node is LINKED (child)
   */
  isLinkedNode(): boolean {
    return this.nodeService.isLinkedNode();
  }

  ngOnInit(): void {
    // Fetch MAIN node info if this is a LINKED node
    if (this.isLinkedNode()) {
      this.nodeService.getMainNode().subscribe({
        error: (err) => {
          console.error('Failed to fetch MAIN node information:', err);
        },
      });
    }
  }
}
