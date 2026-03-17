# Auth System Enhancements Roadmap

**Project:** BitBonsai Admin Authentication
**Status:** ✅ Immediate & Short-term Complete | 🚧 Long-term Planned

---

## ✅ COMPLETED: Immediate Tasks

### 1. Create First Admin User Script
**File:** `apps/license-api/scripts/create-first-admin.ts`

**Usage:**
```bash
cd apps/license-api

# Default credentials
npx tsx scripts/create-first-admin.ts

# Custom credentials
ADMIN_EMAIL="admin@example.com" \
ADMIN_PASSWORD="SecurePass123!" \
ADMIN_NAME="John Admin" \
npx tsx scripts/create-first-admin.ts

# Force create (if admins exist)
npx tsx scripts/create-first-admin.ts --force
```

### 2. JWT Secret Configuration
**File:** `apps/license-api/.env.local`

**Added:**
```bash
JWT_SECRET="2ec4d435b256669f0071b0d0d9614f84edb2dc23f8a4639a6fbc3f0a126f794a"
JWT_EXPIRES_IN="7d"
```

**Security:** 256-bit cryptographically random secret

### 3. Database Migration Ready
**File:** `apps/license-api/prisma/schema.prisma`

**Migration command:**
```bash
cd apps/license-api
npx prisma migrate deploy
npx prisma generate
```

---

## ✅ COMPLETED: Short-term Tasks

### 1. Backend Self-Deactivation Check
**Files Modified:**
- `apps/license-api/src/auth/auth.service.ts:117-181`
- `apps/license-api/src/auth/auth.controller.ts:49-56`

**Implementation:**
```typescript
async toggleAdminStatus(userId: string, currentUserId: string) {
  if (userId === currentUserId) {
    throw new UnauthorizedException('Cannot modify your own account status');
  }
  // ... toggle logic
}
```

**Security Benefit:** Prevents admin from accidentally locking themselves out

### 2. Audit Logging for Admin Actions
**Files Modified:**
- `apps/license-api/src/auth/auth.module.ts` (added AuditModule)
- `apps/license-api/src/auth/auth.service.ts` (added audit calls)

**Logged Actions:**
| Action | Trigger | Data Logged |
|--------|---------|-------------|
| `admin_login` | Successful login | User ID, timestamp |
| `admin_created` | New admin created | Email, name, role, creator ID |
| `admin_activated` | Status toggled to active | Old/new status, modifier ID |
| `admin_deactivated` | Status toggled to inactive | Old/new status, modifier ID |

**Query Examples:**
```typescript
// Get all actions by a specific admin
await auditService.getLogsByUser(adminId);

// Get all actions on a specific admin user
await auditService.getLogsByEntity('AdminUser', userId);

// Get recent admin actions (last 100)
await auditService.getAllLogs(100, 0);
```

### 3. Password Reset Flow (Partial)
**Files Created:**
- `apps/license-api/src/auth/dto/request-password-reset.dto.ts`
- `apps/license-api/src/auth/dto/reset-password.dto.ts`

**Status:** DTOs created, needs full implementation

**TODO for completion:**
1. Add password reset token table to Prisma schema
2. Implement email service integration
3. Add reset endpoints to auth controller
4. Build frontend reset UI

---

## 🚧 PLANNED: Long-term Enhancements

### 1. Session Management UI

**Purpose:** View and manage active admin sessions

**Features:**
- List all active JWT tokens (tracked in database)
- Show login time, IP address, device info
- Force logout (revoke token)
- Auto-expire inactive sessions

**Implementation Plan:**

#### Backend Changes

**1. Add Session Tracking Table:**
```prisma
model AdminSession {
  id          String    @id @default(cuid())
  createdAt   DateTime  @default(now())
  expiresAt   DateTime

  adminUserId String    @map("admin_user_id")
  adminUser   AdminUser @relation(fields: [adminUserId], references: [id], onDelete: Cascade)

  token       String    @unique
  ipAddress   String?   @map("ip_address")
  userAgent   String?   @map("user_agent")
  lastUsedAt  DateTime  @default(now()) @map("last_used_at")
  revokedAt   DateTime? @map("revoked_at")

  @@index([adminUserId])
  @@index([token])
  @@map("admin_sessions")
}
```

**2. Track Sessions on Login:**
```typescript
// auth.service.ts
async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
  // ... existing login logic

  // Create session record
  await this.prisma.adminSession.create({
    data: {
      adminUserId: user.id,
      token: accessToken,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, user };
}
```

**3. Add Session Management Endpoints:**
```typescript
// auth.controller.ts
@Get('sessions')
async getMySessions(@CurrentUser() user: AdminUserEntity) {
  return this.authService.getUserSessions(user.id);
}

@Delete('sessions/:id')
async revokeSession(
  @Param('id') sessionId: string,
  @CurrentUser() user: AdminUserEntity,
) {
  return this.authService.revokeSession(sessionId, user.id);
}
```

#### Frontend UI

**Location:** `apps/website/src/app/pages/admin/sessions/`

**UI Features:**
- Table of active sessions
- Current session highlighted
- Revoke button (except current)
- Last activity timestamp
- Device/browser info

**Estimated Effort:** 4-6 hours

---

### 2. HttpOnly Cookies (Token Storage)

**Purpose:** Migrate from localStorage to secure cookies

**Security Benefits:**
- Immune to XSS attacks
- Automatic sending with requests
- Secure, HttpOnly, SameSite flags

**Implementation Plan:**

#### Backend Changes

**1. Update Login Response:**
```typescript
// auth.controller.ts
@Public()
@Post('login')
async login(
  @Body() loginDto: LoginDto,
  @Res({ passthrough: true }) response: Response,
) {
  const { accessToken, user } = await this.authService.login(loginDto);

  // Set httpOnly cookie
  response.cookie('auth_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return { user }; // Don't return token
}
```

**2. Extract Token from Cookies:**
```typescript
// jwt.strategy.ts
jwtFromRequest: ExtractJwt.fromExtractors([
  (request) => {
    return request?.cookies?.auth_token;
  },
  ExtractJwt.fromAuthHeaderAsBearerToken(), // Fallback
]),
```

#### Frontend Changes

**1. Remove Token Management:**
```typescript
// auth.service.ts
login(dto: LoginDto): Observable<LoginResponse> {
  return this.http.post<LoginResponse>(`${this.authUrl}/login`, dto, {
    withCredentials: true, // Send cookies
  }).pipe(
    tap((response) => {
      this.currentUser.set(response.user);
      this.isAuthenticated.set(true);
      // No token storage needed
    })
  );
}
```

**2. Update HTTP Interceptor:**
```typescript
// auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Cookies sent automatically, no need to add Authorization header
  const cloned = req.clone({
    withCredentials: true,
  });
  return next(cloned);
};
```

**3. CORS Configuration:**
```typescript
// Backend: apps/license-api/src/main.ts
app.enableCors({
  origin: ['https://bitbonsai.app', 'http://localhost:4201'],
  credentials: true, // Allow cookies
});
```

**Estimated Effort:** 3-4 hours

---

### 3. Two-Factor Authentication (2FA)

**Purpose:** TOTP-based 2FA for admin accounts

**Implementation Plan:**

#### Dependencies
```bash
npm install otplib qrcode
npm install --save-dev @types/qrcode
```

#### Database Schema

```prisma
model AdminUser {
  // ... existing fields
  twoFactorSecret  String?  @map("two_factor_secret")
  twoFactorEnabled Boolean  @default(false) @map("two_factor_enabled")
  backupCodes      String[] @map("backup_codes")
}
```

#### Backend Endpoints

**1. Enable 2FA:**
```typescript
@Post('2fa/enable')
async enableTwoFactor(@CurrentUser() user: AdminUserEntity) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(
    user.email,
    'BitBonsai Admin',
    secret,
  );
  const qrCode = await QRCode.toDataURL(otpauthUrl);

  return { secret, qrCode };
}
```

**2. Verify and Activate:**
```typescript
@Post('2fa/verify')
async verifyTwoFactor(
  @Body() body: { code: string; secret: string },
  @CurrentUser() user: AdminUserEntity,
) {
  const isValid = authenticator.verify({
    token: body.code,
    secret: body.secret,
  });

  if (!isValid) {
    throw new UnauthorizedException('Invalid 2FA code');
  }

  // Enable 2FA
  await this.authService.enableTwoFactor(user.id, body.secret);

  return { success: true };
}
```

**3. Login with 2FA:**
```typescript
@Public()
@Post('login')
async login(@Body() loginDto: LoginDto & { twoFactorCode?: string }) {
  const { user, requires2FA } = await this.authService.validateCredentials(
    loginDto.email,
    loginDto.password,
  );

  if (requires2FA && !loginDto.twoFactorCode) {
    return { requires2FA: true };
  }

  if (requires2FA) {
    const isValid = authenticator.verify({
      token: loginDto.twoFactorCode,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
  }

  // Generate JWT
  const accessToken = this.jwtService.sign({ sub: user.id, ... });
  return { accessToken, user };
}
```

#### Frontend UI

**Flow:**
1. User enables 2FA in settings
2. QR code displayed for scanning with authenticator app
3. User enters 6-digit code to verify
4. Backup codes generated and displayed
5. On next login, prompt for 2FA code after password

**Estimated Effort:** 6-8 hours

---

### 4. Password Complexity Requirements

**Purpose:** Enforce strong passwords

**Implementation Plan:**

#### Backend Validation

**Custom Validator:**
```typescript
// password-complexity.validator.ts
export function IsStrongPassword() {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;

          const hasUpperCase = /[A-Z]/.test(value);
          const hasLowerCase = /[a-z]/.test(value);
          const hasNumber = /[0-9]/.test(value);
          const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);
          const isLongEnough = value.length >= 12;

          return (
            hasUpperCase &&
            hasLowerCase &&
            hasNumber &&
            hasSpecialChar &&
            isLongEnough
          );
        },
        defaultMessage() {
          return 'Password must contain at least 12 characters, including uppercase, lowercase, number, and special character';
        },
      },
    });
  };
}
```

**Apply to DTOs:**
```typescript
export class CreateAdminDto {
  @IsStrongPassword()
  password: string;
}
```

#### Frontend Validation

**Password Strength Indicator:**
```typescript
// password-strength.component.ts
@Component({
  selector: 'app-password-strength',
  template: `
    <div class="strength-bar" [class]="strengthClass">
      <div class="strength-fill" [style.width.%]="strength"></div>
    </div>
    <ul class="requirements">
      <li [class.met]="checks.length">12+ characters</li>
      <li [class.met]="checks.uppercase">Uppercase letter</li>
      <li [class.met]="checks.lowercase">Lowercase letter</li>
      <li [class.met]="checks.number">Number</li>
      <li [class.met]="checks.special">Special character</li>
    </ul>
  `,
})
export class PasswordStrengthComponent {
  @Input() password = '';

  get checks() {
    return {
      length: this.password.length >= 12,
      uppercase: /[A-Z]/.test(this.password),
      lowercase: /[a-z]/.test(this.password),
      number: /[0-9]/.test(this.password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(this.password),
    };
  }

  get strength() {
    const met = Object.values(this.checks).filter(Boolean).length;
    return (met / 5) * 100;
  }

  get strengthClass() {
    if (this.strength < 40) return 'weak';
    if (this.strength < 80) return 'medium';
    return 'strong';
  }
}
```

**Estimated Effort:** 2-3 hours

---

### 5. Granular RBAC (Role-Based Access Control)

**Purpose:** Fine-grained permissions beyond ADMIN/SUPER_ADMIN

**Implementation Plan:**

#### Database Schema

```prisma
enum Permission {
  // User Management
  USERS_VIEW
  USERS_CREATE
  USERS_EDIT
  USERS_DELETE

  // License Management
  LICENSES_VIEW
  LICENSES_CREATE
  LICENSES_REVOKE

  // Pricing Management
  PRICING_VIEW
  PRICING_EDIT

  // Promo Codes
  PROMOS_VIEW
  PROMOS_CREATE
  PROMOS_EDIT

  // Audit Logs
  AUDIT_VIEW

  // Analytics
  ANALYTICS_VIEW

  // System Config
  CONFIG_VIEW
  CONFIG_EDIT
}

model Role {
  id          String   @id @default(cuid())
  name        String   @unique
  description String
  permissions Permission[]

  adminUsers  AdminUser[]

  @@map("roles")
}

model AdminUser {
  // ... existing fields
  roleId String @map("role_id")
  role   Role   @relation(fields: [roleId], references: [id])
}
```

#### Guard Implementation

**Permission Guard:**
```typescript
// permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      'permissions',
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AdminUserEntity & { permissions: Permission[] };

    return requiredPermissions.every(permission =>
      user.permissions?.includes(permission),
    );
  }
}
```

**Decorator:**
```typescript
// permissions.decorator.ts
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);
```

**Usage:**
```typescript
@Controller('admin/licenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LicenseController {
  @Get()
  @RequirePermissions(Permission.LICENSES_VIEW)
  async findAll() { ... }

  @Post()
  @RequirePermissions(Permission.LICENSES_CREATE)
  async create() { ... }

  @Post(':id/revoke')
  @RequirePermissions(Permission.LICENSES_REVOKE)
  async revoke() { ... }
}
```

#### Frontend Role Management UI

**Features:**
- Create/edit roles
- Assign permissions (checkbox grid)
- Assign roles to users
- Default roles: Viewer, Editor, Admin, Super Admin

**Estimated Effort:** 10-12 hours

---

## Implementation Priority

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| ✅ Self-deactivation check | Critical | 1h | High |
| ✅ Audit logging | High | 2h | High |
| 🚧 Password reset | High | 4h | Medium |
| 🚧 Session management | Medium | 6h | Medium |
| 🚧 HttpOnly cookies | Medium | 4h | High |
| 🚧 2FA | Low | 8h | Medium |
| 🚧 Password complexity | Low | 3h | Low |
| 🚧 Granular RBAC | Low | 12h | Medium |

**Total Estimated Effort (Remaining):** 37 hours (~1 week)

---

## Testing Checklist

### Immediate Features
- [x] Admin user creation script
- [x] JWT secret configuration
- [x] Database migration ready

### Short-term Features
- [x] Self-deactivation prevention (backend + frontend)
- [x] Audit logging (login, create, toggle)
- [ ] Password reset flow (email sending)
- [ ] Session management (list, revoke)

### Long-term Features
- [ ] HttpOnly cookies (backend + frontend)
- [ ] 2FA setup and verification
- [ ] Password complexity validation
- [ ] RBAC permissions system

---

## Deployment Notes

**Before deploying enhancements:**

1. **Run database migrations:**
   ```bash
   npx prisma migrate deploy
   ```

2. **Update environment variables:**
   - Add JWT_SECRET to production .env
   - Add email service credentials (for password reset)

3. **Test in staging first:**
   - Verify admin creation
   - Test audit logging
   - Validate self-deactivation check

4. **Monitor after deployment:**
   - Check audit_log table for events
   - Verify no admins locked out
   - Monitor login success rates

---

**Document Version:** 1.0
**Last Updated:** 2026-01-12
**Status:** Living document - update as features are implemented
