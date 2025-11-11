import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faChartBar,
  faChartLine,
  faFolderOpen,
  faGear,
  faListCheck,
  faServer,
  faSignOutAlt,
  faSliders,
} from '@fortawesome/pro-solid-svg-icons';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { PendingRequestsBellComponent } from '../../../shared/components/pending-requests-bell/pending-requests-bell.component';
import { CurrentNodeActions } from '../../+state/current-node.actions';
import {
  selectCurrentNode,
  selectIsLinkedNode,
  selectIsMainNode,
  selectMainNode,
} from '../../+state/current-node.selectors';
import { AuthService } from '../../auth/auth.service';

interface MenuItem {
  label: string;
  icon: IconDefinition;
  route: string;
  mainNodeOnly?: boolean; // If true, only show for MAIN nodes
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, FontAwesomeModule, PendingRequestsBellComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly logoutIcon = faSignOutAlt;
  readonly appVersion = environment.version;

  /**
   * Check if authentication is required (local network bypass disabled)
   * Only show logout button if authentication is required
   */
  readonly isAuthenticationRequired$: Observable<boolean> = this.http
    .get<{ allowLocalNetworkWithoutAuth: boolean }>('/api/v1/settings/security')
    .pipe(
      map((settings) => !settings.allowLocalNetworkWithoutAuth)
      // Default to true (require auth) on error for security
      // catchError(() => of(true)) // We can add this if needed
    );

  private readonly allMenuItems: MenuItem[] = [
    { label: 'Overview', icon: faChartLine, route: '/overview' },
    { label: 'Queue', icon: faListCheck, route: '/queue' },
    { label: 'Libraries', icon: faFolderOpen, route: '/libraries', mainNodeOnly: true },
    { label: 'Policies', icon: faSliders, route: '/policies', mainNodeOnly: true },
    { label: 'Nodes', icon: faServer, route: '/nodes', mainNodeOnly: true },
    // Discovery removed - only accessible during setup or via direct URL for CHILD nodes
    { label: 'Insights', icon: faChartBar, route: '/insights', mainNodeOnly: true },
    { label: 'Settings', icon: faGear, route: '/settings' },
  ];

  /**
   * Reactive menu items that filter based on node role (using NgRx selector)
   *
   * - MAIN nodes: See all menu items
   * - LINKED nodes: Only see Queue and Settings
   */
  readonly menuItems$ = this.store.select(selectIsMainNode).pipe(
    map((isMainNode) => {
      if (isMainNode) {
        return this.allMenuItems;
      }
      // LINKED nodes only see non-restricted items
      return this.allMenuItems.filter((item) => !item.mainNodeOnly);
    })
  );

  /**
   * Current node observable
   */
  readonly currentNode$ = this.store.select(selectCurrentNode);

  /**
   * Main node observable
   */
  readonly mainNode$ = this.store.select(selectMainNode);

  /**
   * Is main node observable
   */
  readonly isMainNode$ = this.store.select(selectIsMainNode);

  /**
   * Is linked node observable
   */
  readonly isLinkedNode$ = this.store.select(selectIsLinkedNode);

  ngOnInit(): void {
    // Load current node on initialization
    this.store.dispatch(CurrentNodeActions.loadCurrentNode());
  }

  /**
   * Handle logout action
   *
   * Clears authentication tokens and navigates to login page
   */
  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
