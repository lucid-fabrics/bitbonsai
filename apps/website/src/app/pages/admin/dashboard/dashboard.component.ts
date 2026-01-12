import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminRole, AdminUser, AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly authService = inject(AuthService);

  admins = signal<AdminUser[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  showCreateForm = signal(false);

  newAdminEmail = signal('');
  newAdminPassword = signal('');
  newAdminName = signal('');
  newAdminRole = signal(AdminRole.ADMIN);

  get currentUser() {
    return this.authService.currentUser();
  }

  ngOnInit(): void {
    this.loadAdmins();
  }

  loadAdmins(): void {
    this.loading.set(true);
    this.authService.getAllAdmins().subscribe({
      next: (admins) => {
        this.admins.set(admins);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load admins');
        this.loading.set(false);
      },
    });
  }

  createAdmin(): void {
    this.loading.set(true);
    this.error.set(null);

    this.authService
      .createAdmin({
        email: this.newAdminEmail(),
        password: this.newAdminPassword(),
        name: this.newAdminName(),
        role: this.newAdminRole(),
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.showCreateForm.set(false);
          this.newAdminEmail.set('');
          this.newAdminPassword.set('');
          this.newAdminName.set('');
          this.newAdminRole.set(AdminRole.ADMIN);
          this.loadAdmins();
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Failed to create admin');
          this.loading.set(false);
        },
      });
  }

  toggleAdminStatus(id: string): void {
    this.authService.toggleAdminStatus(id).subscribe({
      next: () => {
        this.loadAdmins();
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to toggle admin status');
      },
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
