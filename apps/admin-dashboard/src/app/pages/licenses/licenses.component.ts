import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as LicensesActions from './+state/licenses.actions';
import {
  selectCurrentPage,
  selectError,
  selectFilterTier,
  selectLicenses,
  selectLoading,
  selectPageSize,
  selectSearchEmail,
  selectShowCreateDialog,
  selectTotal,
} from './+state/licenses.selectors';
import { LicensesBo } from './licenses.bo';

@Component({
  selector: 'bb-licenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bb-licenses">
      <div class="bb-page-header">
        <h1 class="bb-page-title">License Management</h1>
        <button class="bb-btn bb-btn--primary" (click)="openCreateDialog()">
          Create License
        </button>
      </div>

      <div class="bb-filters">
        <input
          type="text"
          [ngModel]="searchEmail$ | async"
          (ngModelChange)="updateSearchEmail($event)"
          placeholder="Search by email..."
          class="bb-input"
          (keyup.enter)="search()"
        />
        <select [ngModel]="filterTier$ | async" (ngModelChange)="updateTierFilter($event)" class="bb-select">
          <option value="">All Tiers</option>
          <option value="FREE">FREE</option>
          <option value="PATREON_SUPPORTER">PATREON_SUPPORTER</option>
          <option value="PATREON_PLUS">PATREON_PLUS</option>
          <option value="PATREON_PRO">PATREON_PRO</option>
          <option value="PATREON_ULTIMATE">PATREON_ULTIMATE</option>
          <option value="COMMERCIAL_STARTER">COMMERCIAL_STARTER</option>
          <option value="COMMERCIAL_PRO">COMMERCIAL_PRO</option>
          <option value="COMMERCIAL_ENTERPRISE">COMMERCIAL_ENTERPRISE</option>
        </select>
        <button class="bb-btn bb-btn--outline" (click)="resetFilters()">Reset</button>
      </div>

      @if (loading$ | async) {
        <div class="bb-loading">Loading licenses...</div>
      } @else if ((licenses$ | async)?.length ?? 0 > 0) {
        <div class="bb-table-container">
          <table class="bb-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Key</th>
                <th>Tier</th>
                <th>Max Nodes</th>
                <th>Max Jobs</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (license of licenses$ | async; track license.id) {
                <tr>
                  <td>{{ license.email }}</td>
                  <td><code>{{ license.key }}</code></td>
                  <td>
                    <span class="bb-badge">{{ license.tier }}</span>
                  </td>
                  <td>{{ license.maxNodes }}</td>
                  <td>{{ license.maxConcurrentJobs }}</td>
                  <td>
                    {{ license.expiresAt ? (license.expiresAt | date: 'short') : 'Never' }}
                  </td>
                  <td>{{ license.createdAt | date: 'short' }}</td>
                  <td>
                    <button
                      class="bb-btn bb-btn--sm bb-btn--danger"
                      (click)="revokeLicense(license)"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="bb-pagination">
          <button
            class="bb-btn bb-btn--outline"
            [disabled]="!LicensesBo.canGoPrevious(currentPage$ | async ?? 0)"
            (click)="previousPage()"
          >
            Previous
          </button>
          <span class="bb-pagination__info">
            {{ LicensesBo.getPageInfo(currentPage$ | async ?? 0, (licenses$ | async)?.length ?? 0, total$ | async ?? 0) }}
          </span>
          <button
            class="bb-btn bb-btn--outline"
            [disabled]="!LicensesBo.canGoNext(currentPage$ | async ?? 0, pageSize$ | async ?? 20, total$ | async ?? 0)"
            (click)="nextPage()"
          >
            Next
          </button>
        </div>
      } @else {
        <div class="bb-empty">No licenses found</div>
      }

      @if (error$ | async; as error) {
        <div class="bb-error">{{ error }}</div>
      }

      @if (showCreateDialog$ | async) {
        <div class="bb-dialog-overlay" (click)="closeCreateDialog()">
          <div class="bb-dialog" (click)="$event.stopPropagation()">
            <h2>Create New License</h2>
            <div class="bb-form">
              <div class="bb-form-group">
                <label>Email</label>
                <input
                  type="email"
                  [(ngModel)]="newLicense.email"
                  class="bb-input"
                  placeholder="user@example.com"
                />
              </div>
              <div class="bb-form-group">
                <label>Tier</label>
                <select [(ngModel)]="newLicense.tier" class="bb-select">
                  <option value="FREE">FREE</option>
                  <option value="PATREON_SUPPORTER">PATREON_SUPPORTER</option>
                  <option value="PATREON_PLUS">PATREON_PLUS</option>
                  <option value="PATREON_PRO">PATREON_PRO</option>
                  <option value="PATREON_ULTIMATE">PATREON_ULTIMATE</option>
                  <option value="COMMERCIAL_STARTER">COMMERCIAL_STARTER</option>
                  <option value="COMMERCIAL_PRO">COMMERCIAL_PRO</option>
                  <option value="COMMERCIAL_ENTERPRISE">COMMERCIAL_ENTERPRISE</option>
                </select>
              </div>
              <div class="bb-form-group">
                <label>Expires At (optional)</label>
                <input type="date" [(ngModel)]="newLicense.expiresAt" class="bb-input" />
              </div>
              <div class="bb-form-group">
                <label>Notes (optional)</label>
                <textarea [(ngModel)]="newLicense.notes" class="bb-input" rows="3"></textarea>
              </div>
            </div>
            <div class="bb-dialog-actions">
              <button class="bb-btn bb-btn--outline" (click)="closeCreateDialog()">
                Cancel
              </button>
              <button class="bb-btn bb-btn--primary" (click)="createLicense()">Create</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrls: ['./licenses.component.scss'],
})
export class LicensesComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly destroy$ = new Subject<void>();

  // Expose BO to template (convention requirement)
  readonly LicensesBo = LicensesBo;

  // Selectors (NgRx state)
  licenses$ = this.store.select(selectLicenses);
  total$ = this.store.select(selectTotal);
  currentPage$ = this.store.select(selectCurrentPage);
  pageSize$ = this.store.select(selectPageSize);
  loading$ = this.store.select(selectLoading);
  error$ = this.store.select(selectError);
  searchEmail$ = this.store.select(selectSearchEmail);
  filterTier$ = this.store.select(selectFilterTier);
  showCreateDialog$ = this.store.select(selectShowCreateDialog);

  // Local component state for pagination (tracked from selectors)
  private currentPage = 0;
  private pageSize = 20;
  private filterTier = '';
  private searchEmail = '';

  // Local component state for form
  newLicense = {
    email: '',
    tier: 'FREE',
    expiresAt: '',
    notes: '',
  };

  /**
   * Component initialization
   * Delegates to NgRx effect (NO logic in component!)
   */
  ngOnInit(): void {
    // Subscribe to state changes with proper cleanup
    this.currentPage$.pipe(takeUntil(this.destroy$)).subscribe((page) => (this.currentPage = page));
    this.pageSize$.pipe(takeUntil(this.destroy$)).subscribe((size) => (this.pageSize = size));
    this.filterTier$.pipe(takeUntil(this.destroy$)).subscribe((tier) => (this.filterTier = tier));
    this.searchEmail$
      .pipe(takeUntil(this.destroy$))
      .subscribe((email) => (this.searchEmail = email));

    this.loadLicenses();
  }

  /**
   * Component cleanup
   */
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Dispatch load licenses action
   */
  loadLicenses(): void {
    this.store.dispatch(
      LicensesActions.loadLicenses({
        skip: this.currentPage * this.pageSize,
        take: this.pageSize,
        tier: this.filterTier || undefined,
      })
    );
  }

  /**
   * Dispatch search action
   */
  search(): void {
    if (!LicensesBo.hasValidSearchQuery(this.searchEmail)) {
      this.loadLicenses();
      return;
    }

    this.store.dispatch(LicensesActions.searchLicenses({ email: this.searchEmail.trim() }));
  }

  /**
   * Reset filters and reload
   */
  resetFilters(): void {
    this.store.dispatch(LicensesActions.resetFilters());
    this.loadLicenses();
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    const newPage = this.currentPage - 1;
    this.store.dispatch(LicensesActions.setPage({ page: newPage }));
    this.store.dispatch(
      LicensesActions.loadLicenses({
        skip: newPage * this.pageSize,
        take: this.pageSize,
        tier: this.filterTier || undefined,
      })
    );
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    const newPage = this.currentPage + 1;
    this.store.dispatch(LicensesActions.setPage({ page: newPage }));
    this.store.dispatch(
      LicensesActions.loadLicenses({
        skip: newPage * this.pageSize,
        take: this.pageSize,
        tier: this.filterTier || undefined,
      })
    );
  }

  /**
   * Create new license
   */
  createLicense(): void {
    if (!LicensesBo.isValidLicenseForm(this.newLicense.email, this.newLicense.tier)) {
      alert('Email and tier are required');
      return;
    }

    this.store.dispatch(
      LicensesActions.createLicense({
        email: this.newLicense.email,
        tier: this.newLicense.tier,
        expiresAt: this.newLicense.expiresAt || undefined,
        notes: this.newLicense.notes || undefined,
      })
    );

    // Reset form
    this.newLicense = { email: '', tier: 'FREE', expiresAt: '', notes: '' };

    // Reload licenses after creation
    setTimeout(() => this.loadLicenses(), 500);
  }

  /**
   * Revoke license
   */
  revokeLicense(license: { id: number; email: string }): void {
    if (!confirm(LicensesBo.getRevokeConfirmationMessage(license as { id: number; email: string })))
      return;

    const reason = prompt('Reason for revoking:');
    if (!reason) return;

    this.store.dispatch(LicensesActions.revokeLicense({ licenseId: license.id, reason }));

    // Reload licenses after revocation
    setTimeout(() => this.loadLicenses(), 500);
  }

  /**
   * Update search email
   */
  updateSearchEmail(email: string): void {
    this.store.dispatch(LicensesActions.setSearchEmail({ email }));
  }

  /**
   * Update tier filter
   */
  updateTierFilter(tier: string): void {
    this.store.dispatch(LicensesActions.setTierFilter({ tier }));
    this.store.dispatch(
      LicensesActions.loadLicenses({
        skip: 0,
        take: this.pageSize,
        tier: tier || undefined,
      })
    );
  }

  /**
   * Open create dialog
   */
  openCreateDialog(): void {
    this.store.dispatch(LicensesActions.toggleCreateDialog({ show: true }));
  }

  /**
   * Close create dialog
   */
  closeCreateDialog(): void {
    this.store.dispatch(LicensesActions.toggleCreateDialog({ show: false }));
  }
}
