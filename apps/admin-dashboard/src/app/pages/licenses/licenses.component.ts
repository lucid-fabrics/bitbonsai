import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { License, LicenseApiService } from '../../services/license-api.service';

@Component({
  selector: 'bb-licenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bb-licenses">
      <div class="bb-page-header">
        <h1 class="bb-page-title">License Management</h1>
        <button class="bb-btn bb-btn--primary" (click)="showCreateDialog = true">
          Create License
        </button>
      </div>

      <div class="bb-filters">
        <input
          type="text"
          [(ngModel)]="searchEmail"
          placeholder="Search by email..."
          class="bb-input"
          (keyup.enter)="search()"
        />
        <select [(ngModel)]="filterTier" class="bb-select" (change)="loadLicenses()">
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

      @if (loading) {
        <div class="bb-loading">Loading licenses...</div>
      } @else if (licenses.length > 0) {
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
              @for (license of licenses; track license.id) {
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
            [disabled]="currentPage === 0"
            (click)="previousPage()"
          >
            Previous
          </button>
          <span class="bb-pagination__info">
            Page {{ currentPage + 1 }} - Showing {{ licenses.length }} of {{ total }} licenses
          </span>
          <button
            class="bb-btn bb-btn--outline"
            [disabled]="(currentPage + 1) * pageSize >= total"
            (click)="nextPage()"
          >
            Next
          </button>
        </div>
      } @else {
        <div class="bb-empty">No licenses found</div>
      }

      @if (showCreateDialog) {
        <div class="bb-dialog-overlay" (click)="showCreateDialog = false">
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
              <button class="bb-btn bb-btn--outline" (click)="showCreateDialog = false">
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
export class LicensesComponent implements OnInit {
  private readonly licenseApi = inject(LicenseApiService);

  licenses: License[] = [];
  total = 0;
  currentPage = 0;
  pageSize = 20;
  loading = false;

  searchEmail = '';
  filterTier = '';

  showCreateDialog = false;
  newLicense = {
    email: '',
    tier: 'FREE',
    expiresAt: '',
    notes: '',
  };

  ngOnInit() {
    this.loadLicenses();
  }

  loadLicenses() {
    this.loading = true;
    this.licenseApi
      .listLicenses({
        skip: this.currentPage * this.pageSize,
        take: this.pageSize,
        tier: this.filterTier || undefined,
      })
      .subscribe({
        next: (response) => {
          this.licenses = response.data;
          this.total = response.total;
          this.loading = false;
        },
        error: (error) => {
          console.error('Failed to load licenses:', error);
          this.loading = false;
        },
      });
  }

  search() {
    if (!this.searchEmail.trim()) {
      this.loadLicenses();
      return;
    }

    this.loading = true;
    this.licenseApi.getLicensesByEmail(this.searchEmail.trim()).subscribe({
      next: (licenses) => {
        this.licenses = licenses;
        this.total = licenses.length;
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to search licenses:', error);
        this.loading = false;
      },
    });
  }

  resetFilters() {
    this.searchEmail = '';
    this.filterTier = '';
    this.currentPage = 0;
    this.loadLicenses();
  }

  previousPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.loadLicenses();
    }
  }

  nextPage() {
    if ((this.currentPage + 1) * this.pageSize < this.total) {
      this.currentPage++;
      this.loadLicenses();
    }
  }

  createLicense() {
    if (!this.newLicense.email || !this.newLicense.tier) {
      alert('Email and tier are required');
      return;
    }

    this.licenseApi.createLicense(this.newLicense).subscribe({
      next: () => {
        this.showCreateDialog = false;
        this.newLicense = { email: '', tier: 'FREE', expiresAt: '', notes: '' };
        this.loadLicenses();
      },
      error: (error) => {
        console.error('Failed to create license:', error);
        alert(`Failed to create license: ${error.message}`);
      },
    });
  }

  revokeLicense(license: License) {
    if (!confirm(`Revoke license for ${license.email}?`)) return;

    const reason = prompt('Reason for revoking:');
    if (!reason) return;

    this.licenseApi.revokeLicense(license.id, reason).subscribe({
      next: () => {
        this.loadLicenses();
      },
      error: (error) => {
        console.error('Failed to revoke license:', error);
        alert(`Failed to revoke license: ${error.message}`);
      },
    });
  }
}
