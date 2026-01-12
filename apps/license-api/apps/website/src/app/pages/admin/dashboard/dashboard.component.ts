import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminRole, AdminUser, AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  protected readonly authService = inject(AuthService);

  admins = signal<AdminUser[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  newAdminEmail = signal('');
  newAdminPassword = signal('');
  newAdminName = signal('');
  newAdminRole = signal(AdminRole.ADMIN);

  readonly AdminRole = AdminRole;

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
        this.error.set('Failed to load admins');
        this.loading.set(false);
      },
    });
  }

  createAdmin(): void {
    if (!this.newAdminEmail() || !this.newAdminPassword() || !this.newAdminName()) {
      this.error.set('All fields are required');
      return;
    }

    this.authService
      .createAdmin({
        email: this.newAdminEmail(),
        password: this.newAdminPassword(),
        name: this.newAdminName(),
        role: this.newAdminRole(),
      })
      .subscribe({
        next: () => {
          this.newAdminEmail.set('');
          this.newAdminPassword.set('');
          this.newAdminName.set('');
          this.error.set(null);
          this.loadAdmins();
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Failed to create admin');
        },
      });
  }

  toggleStatus(admin: AdminUser): void {
    this.authService.toggleAdminStatus(admin.id).subscribe({
      next: () => {
        this.loadAdmins();
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to toggle admin status');
      },
    });
  }
}
