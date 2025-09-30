# 🚀 NestJS Guidelines

## Core Principles
- Use a layered architecture: **Controller → Service → Repository/Proxy → DAO**.
- Controllers should only handle HTTP, validation, and Swagger docs.
- Services (use cases) orchestrate business logic; testable and pure.
- **For Database Access:** Repositories handle BO ↔ DAO translation and domain error mapping.
- **For External APIs:** Proxy classes handle external API calls and data transformation.
- DAO (Prisma layer) does direct database access only.
- **NO MOCK DATA ALLOWED** - All data must come from real sources, never use mock/fake data.
- **NO SIMULATION CODE** - Do not implement placeholder/simulation code (e.g., fake connection tests, simulated responses) unless explicitly requested. Methods should either be fully implemented or throw `NotImplementedException`.

## External API Integration Pattern
- **Controller → Service → Proxy → External API**
- Proxy classes (`.proxy.ts`) handle external API calls and response transformation
- Services orchestrate business logic and call proxy methods
- Proxy classes transform external API DTOs to Business Objects via factories
- Services receive Business Objects and transform to API DTOs via DTO constructors

---

## Typing & Models
- No `any`. Use **DTO classes** (with class-validator) and **BO interfaces** (for domain logic).
- Keep Prisma utility types internal; don't expose them in public API.
- Centralize shared types in a dedicated schema layer.

---

## Validation & Config
- Use global validation pipe with whitelist, transform, and forbid unknown properties.
- Validate environment configuration at bootstrap.
- Never trust input, even from internal services.

---

## Auth & Security
- Use guards for authentication and authorization.
- Custom decorator (e.g., `@AuthUser()`) to inject the authenticated user payload.
- Refresh endpoints accept only the refresh token, not both tokens.
- Apply Helmet, CORS with allowlist, and rate limiting.
- Sanitize inputs and never leak raw Prisma errors.

### Critical Security Requirements for Error Handling
- **NEVER expose passwords, tokens, or sensitive data in error messages or logs**
- **NEVER log commands, URLs, or connection strings that contain credentials**
- **ALWAYS sanitize error messages** before sending to clients or writing to logs
- Use `ErrorMessageUtil.sanitizeErrorMessage()` to automatically remove sensitive information
- Error messages should be user-friendly and actionable, not technical dumps
- Examples of what to avoid:
  ```typescript
  // ❌ DANGEROUS - exposes password in error
  throw new Error(`Connection failed: smb://user:password123@host/share`);

  // ❌ DANGEROUS - exposes sensitive config
  this.logger.error('Failed with config:', JSON.stringify(config));

  // ❌ CRITICAL SECURITY ISSUE - logging mount command with password
  this.logger.debug(`Mount command: ${mountCmd}`);

  // ❌ DANGEROUS - even with replacement, could be incomplete
  this.logger.debug(`Mount command: ${mountCmd.replace(password, '***')}`);

  // ✅ SAFE - no credentials in logs
  this.logger.debug(`Attempting SMB mount to ${host}:${port}/${share} with user ${username}`);

  // ✅ SAFE - sanitized and user-friendly
  const errorMessage = ErrorMessageUtil.getConnectionErrorMessage(error.message, acceptLanguage);
  throw new BadRequestException(errorMessage);
  ```

---

## Errors & Observability
- Map Prisma errors to domain exceptions (`@HandlePrismaErrors`).
- Structured logging with request IDs.
- Integrate tracing and metrics (e.g., OpenTelemetry, Prometheus).

### Error Message Handling
- **NEVER throw exceptions with complex objects** - Always use clear, meaningful error messages as strings.
- **NEVER expose sensitive information** in error messages (passwords, tokens, internal paths, etc.)
- **BadRequestException should contain user-readable messages**, not generic "Bad Request" text.
- Use `ErrorMessageUtil.getErrorMessage()` for consistent error messaging with i18n support.
- Use `ErrorMessageUtil.getConnectionErrorMessage()` for technical errors that need human-readable mapping.
- Controllers should pass `Accept-Language` headers to services for proper error localization.
- Error messages should be descriptive and actionable for end users, not technical dumps.
- Examples:
  ```typescript
  // ❌ Wrong - throws object, results in "Bad Request"
  throw new BadRequestException({ error: 'connection failed', details: {...} });

  // ❌ DANGEROUS - exposes technical details that may contain sensitive info
  throw new BadRequestException(`Raw error: ${error.message}`);

  // ✅ Correct - clear message with i18n support
  const errorMessage = ErrorMessageUtil.getErrorMessage('smbConnectionFailed', acceptLanguage);
  throw new BadRequestException(errorMessage);

  // ✅ Correct - human-readable mapping of technical errors
  const errorMessage = ErrorMessageUtil.getConnectionErrorMessage(error.message, acceptLanguage);
  throw new BadRequestException(errorMessage);

  // ✅ Correct - parameterized message with sanitized params
  const errorMessage = ErrorMessageUtil.getErrorMessage('invalidShareName', acceptLanguage, {
    share: shareName  // automatically sanitized by the utility
  });
  throw new BadRequestException(errorMessage);
  ```

---

## Internationalization (i18n)
- Use **nestjs-i18n** library for proper internationalization support.
- Configure `I18nModule` with `HeaderResolver` for `Accept-Language` header support.
- Store translation files in `src/i18n/{locale}/` directory structure (e.g., `src/i18n/en/`, `src/i18n/fr/`).
- Translation files should be organized by feature/module (e.g., `smb-configuration.json`, `user-management.json`).
- **Never use hardcoded translation methods** - always inject and use `I18nService`.
- Use `this.i18n.translate('key.path', { args: { param: value }, lang: acceptLanguage || 'en' })` for parameterized messages.
- Controllers should pass `Accept-Language` header to services for proper language resolution.
- Fallback language should always be English (`en`).

### Error Message Internationalization
- For error messages, use `ErrorMessageUtil.getErrorMessage()` which provides basic i18n support.
- This utility can be used as a foundation until full nestjs-i18n integration is implemented.
- Always pass the `Accept-Language` header from controllers to services for proper language detection.
- Example:
  ```typescript
  // In controller
  async testConnection(
    @Param('id') id: string,
    @Headers('accept-language') acceptLanguage?: string
  ) {
    return this.service.testConnection(id, acceptLanguage);
  }

  // In service
  const errorMessage = ErrorMessageUtil.getErrorMessage('smbConnectionFailed', acceptLanguage);
  throw new BadRequestException(errorMessage);
  ```

---

## Database (Prisma + SQL)
- DAO methods accept Prisma `CreateInput` / `UpdateInput` types.
- Do not use `Unchecked*Input` types.
- Use transactions with retry handling.
- Keep migrations in source control.
- Cursor-based pagination preferred.
- Soft deletes with `deletedAt` column if needed.

---

## HTTP & API Surface
- Version APIs (`/api/v1/...`).
- Document endpoints with Swagger decorators (`@ApiOperation`, `@ApiResponse`, etc.).
- DTOs should be fully documented with validation rules and examples.
- Controllers remain thin, services handle file storage, async flows, etc.

---

## Performance
- Cache responses where appropriate (memory or Redis).
- Avoid N+1 queries by selecting relations efficiently in Prisma.
- Stream large files instead of buffering.
- Offload non-critical work to background jobs.

---

## Messaging & Jobs
- Use queues (e.g., BullMQ) for async/background work.
- Version job payloads and validate them.
- Ensure retries and idempotency.

---

## Testing
- Unit test services, repositories, and factories.
- Integration tests with real Prisma in ephemeral DB (e.g., Testcontainers).
- E2E tests for controllers with supertest.

---

## CI/CD
- Pipelines must run lint, unit, integration, and build before deploy.
- Verify migrations are in sync before deploying.
- Package as Docker images with health checks.
- Secrets managed via secure vault (e.g., Azure Key Vault).

---

## Conventions & Style
- Prefer `inject()` for DI where ergonomic.
- One service = one purpose; small, testable methods.
- Explicit return types everywhere.
- Never couple controllers to Prisma types; expose only DTOs and BOs.
- Consistent response envelopes for lists and pagination.
