# Admin Authentication System

Full-featured admin authentication system for BitBonsai website with user management capabilities.

## Backend (license-api)

### Database Schema

**AdminUser Model** (`apps/license-api/prisma/schema.prisma`):
```prisma
enum AdminRole {
  SUPER_ADMIN
  ADMIN
}

model AdminUser {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  name         String
  role         AdminRole @default(ADMIN)
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdBy    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}
```

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/login` | Public | Admin login (email/password) |
| POST | `/auth/admin` | JWT | Create new admin user |
| GET | `/auth/me` | JWT | Get current user info |
| GET | `/auth/admins` | JWT | List all admin users |
| PATCH | `/auth/admins/:id/toggle` | JWT | Toggle admin active status |

### Security Features

**JWT Authentication:**
- Token-based auth with configurable expiration (default: 7 days)
- `@Public()` decorator for public endpoints
- Global JWT guard protecting all endpoints by default
- Bcrypt password hashing (10 rounds)

**Rate Limiting:**
- Login: 5 requests/60s per IP
- Standard endpoints: 100 requests/60s

**Environment Variables:**
```bash
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d
```

## Frontend (website)

### Auth Service

**Location:** `apps/website/src/app/services/auth.service.ts`

**Features:**
- Signal-based reactive state management
- Token persistence in localStorage
- Auto-load user on app start
- HTTP interceptor for Authorization header

**Key Methods:**
```typescript
login(dto: LoginDto): Observable<LoginResponse>
logout(): void
createAdmin(dto: CreateAdminDto): Observable<AdminUser>
getMe(): Observable<AdminUser>
getAllAdmins(): Observable<AdminUser[]>
toggleAdminStatus(id: string): Observable<AdminUser>
```

### Routes

| Path | Component | Guard | Description |
|------|-----------|-------|-------------|
| `/admin/login` | LoginComponent | None | Admin login page |
| `/admin/dashboard` | DashboardComponent | authGuard | User management dashboard |

### Components

**LoginComponent** (`apps/website/src/app/pages/admin/login/`):
- Email/password form
- Error handling with user-friendly messages
- Loading states
- Gradient background design

**DashboardComponent** (`apps/website/src/app/pages/admin/dashboard/`):
- List all admin users
- Create new admin users
- Toggle admin active/inactive status
- Prevent self-deactivation
- Last login timestamps
- Logout functionality

## Database Migration

Run migration to create `admin_users` table:

```bash
cd apps/license-api
npx prisma migrate dev --name add_admin_users
npx prisma generate
```

## Creating First Admin

**Option 1: API (requires database access):**
```bash
# Use psql or database client to insert first user
# Password: 'YourSecurePassword123'
INSERT INTO admin_users (id, email, password_hash, name, role, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'admin@bitbonsai.app',
  '$2b$10$YOUR_BCRYPT_HASH_HERE',
  'System Admin',
  'SUPER_ADMIN',
  true,
  NOW(),
  NOW()
);
```

**Option 2: Script (recommended):**
Create `apps/license-api/scripts/create-first-admin.ts`:
```typescript
import { PrismaClient } from '@prisma/license-client';
import * as bcrypt from 'bcrypt';

async function main() {
  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash('YourSecurePassword123', 10);

  await prisma.adminUser.create({
    data: {
      email: 'admin@bitbonsai.app',
      passwordHash,
      name: 'System Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log('Admin user created!');
  await prisma.$disconnect();
}

main();
```

## Security Considerations

1. **Password Requirements:** Minimum 8 characters enforced
2. **Token Storage:** JWT stored in localStorage (consider httpOnly cookies for production)
3. **Public Endpoints:** Only `/auth/login`, `/pricing`, `/licenses/verify`, webhooks, `/health`
4. **CORS:** Configure license-api to allow `bitbonsai.app` and `app.bitbonsai.app`
5. **Rate Limiting:** Prevents brute-force attacks on login

## Testing

**Manual Test Flow:**

1. Start license-api: `nx serve license-api`
2. Start website: `nx serve website`
3. Navigate to `http://localhost:4201/admin/login`
4. Login with created admin credentials
5. Should redirect to `/admin/dashboard`
6. Create additional admin users
7. Toggle user status (except self)
8. Logout and verify redirect to login

**API Test (curl):**
```bash
# Login
curl -X POST http://localhost:3200/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bitbonsai.app","password":"YourPassword"}'

# Get current user (use token from login response)
curl http://localhost:3200/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# List admins
curl http://localhost:3200/auth/admins \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## File Structure

```
apps/license-api/src/
├── auth/
│   ├── auth.controller.ts      # Auth endpoints
│   ├── auth.service.ts         # Auth business logic
│   ├── auth.module.ts          # Module configuration
│   ├── jwt.strategy.ts         # Passport JWT strategy
│   ├── jwt-auth.guard.ts       # Global auth guard
│   ├── dto/
│   │   ├── login.dto.ts
│   │   └── create-admin.dto.ts
│   ├── entities/
│   │   └── admin-user.entity.ts
│   └── decorators/
│       ├── public.decorator.ts
│       └── current-user.decorator.ts

apps/website/src/app/
├── services/
│   └── auth.service.ts         # Frontend auth service
├── guards/
│   └── auth.guard.ts           # Route guard
├── interceptors/
│   └── auth.interceptor.ts     # HTTP token interceptor
└── pages/admin/
    ├── login/
    │   ├── login.component.ts
    │   ├── login.component.html
    │   └── login.component.scss
    └── dashboard/
        ├── dashboard.component.ts
        ├── dashboard.component.html
        └── dashboard.component.scss
```

## Deployment Notes

**Environment Variables (Production):**
```bash
# license-api
JWT_SECRET=random-256-bit-string
JWT_EXPIRES_IN=7d
LICENSE_DATABASE_URL=postgresql://...

# CORS origins must include:
# - https://bitbonsai.app
# - https://app.bitbonsai.app
```

**Database Migration (Unraid):**
```bash
# SSH to Unraid
ssh root@192.168.1.100

# Exec into container
docker exec -it bitbonsai-license-api bash

# Run migration
cd /app/apps/license-api
npx prisma migrate deploy
npx prisma generate
```

## Future Enhancements

- Password reset flow
- Email verification
- Two-factor authentication (2FA)
- Audit logging for admin actions
- Granular role-based permissions
- Session management (active sessions list)
- Password complexity requirements
- Account lockout after failed attempts
