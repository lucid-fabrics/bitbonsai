# BitBonsai Error Handling System

## Overview

BitBonsai uses a structured error handling system with custom error classes and a global exception filter. This ensures consistent error responses, proper HTTP status codes, and detailed logging for debugging.

## Architecture

```
Request → Controller → Service → Repository
                ↓ (throws error)
         GlobalExceptionFilter
                ↓
        Structured JSON Response
```

## Error Class Hierarchy

```
BaseError (abstract)
├── ValidationError (400)
│   ├── MissingFieldError
│   └── InvalidFieldError
├── UnauthorizedError (401)
├── ForbiddenError (403)
│   ├── InvalidLicenseError
│   └── FeatureNotLicensedError
├── NotFoundError (404)
│   ├── LibraryNotFoundError
│   ├── NodeNotFoundError
│   ├── PolicyNotFoundError
│   ├── JobNotFoundError
│   └── LicenseNotFoundError
├── ConflictError (409)
│   ├── DuplicateResourceError
│   ├── LibraryPathConflictError
│   └── NodeNameConflictError
├── BusinessRuleError (422)
│   ├── NodeOfflineError
│   ├── InsufficientCapacityError
│   ├── EncodingFailedError
│   ├── FileAccessError
│   └── StorageQuotaExceededError
├── DatabaseError (500)
├── ExternalServiceError (503)
    ├── FFmpegError
    └── NetworkError
```

## Usage Examples

### In Services

```typescript
import {
  LibraryNotFoundError,
  LibraryPathConflictError,
  ValidationError,
  NodeOfflineError,
} from '../common/errors';

export class LibrariesService {
  async findOne(id: string): Promise<Library> {
    const library = await this.prisma.library.findUnique({ where: { id } });

    if (!library) {
      throw new LibraryNotFoundError(id);
    }

    return library;
  }

  async create(dto: CreateLibraryDto): Promise<Library> {
    // Check for duplicate path
    const existing = await this.prisma.library.findFirst({
      where: { path: dto.path },
    });

    if (existing) {
      throw new LibraryPathConflictError(dto.path);
    }

    // Validate node is online
    const node = await this.nodesService.findOne(dto.nodeId);
    if (node.status !== 'ONLINE') {
      throw new NodeOfflineError(node.id, node.name);
    }

    return await this.prisma.library.create({ data: dto });
  }

  async validateInput(data: unknown): Promise<void> {
    if (!data || typeof data !== 'object') {
      throw new ValidationError('Invalid input data', { received: typeof data });
    }

    if (!('name' in data)) {
      throw new MissingFieldError('name');
    }

    if (typeof data.name !== 'string' || data.name.length < 3) {
      throw new InvalidFieldError('name', 'must be at least 3 characters');
    }
  }
}
```

### In Controllers

Controllers typically don't need to handle errors - the GlobalExceptionFilter will catch them:

```typescript
@Controller('libraries')
export class LibrariesController {
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Library> {
    // Service throws LibraryNotFoundError if not found
    // Filter converts it to proper HTTP 404 response
    return await this.librariesService.findOne(id);
  }
}
```

### Custom Business Logic Errors

```typescript
import { BusinessRuleError } from '../common/errors';

// Check storage quota
const currentUsage = await this.getStorageUsage();
if (currentUsage > this.maxQuota) {
  throw new StorageQuotaExceededError(this.maxQuota, currentUsage);
}

// Handle external service failures
try {
  await this.ffmpegService.encode(file);
} catch (error) {
  throw new FFmpegError(`Failed to encode file: ${error.message}`, {
    filePath: file.path,
    originalError: error.message,
  });
}
```

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "statusCode": 404,
  "timestamp": "2025-10-02T12:34:56.789Z",
  "path": "/api/v1/libraries/123",
  "method": "GET",
  "message": "Library with identifier '123' not found",
  "errorCode": "LIBRARY_NOT_FOUND",
  "context": {
    "resource": "Library",
    "identifier": "123"
  }
}
```

In development mode, a `stack` property is also included.

## Error Codes

Error codes are constants that clients can use for:
- Conditional UI behavior
- i18n/localization
- Analytics and monitoring

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | General validation failure |
| `MISSING_FIELD` | 400 | Required field not provided |
| `INVALID_FIELD` | 400 | Field value doesn't meet requirements |
| `UNAUTHORIZED` | 401 | Authentication required |
| `INVALID_LICENSE` | 403 | License validation failed |
| `FEATURE_NOT_LICENSED` | 403 | Feature not available in license tier |
| `NOT_FOUND` | 404 | Generic resource not found |
| `LIBRARY_NOT_FOUND` | 404 | Specific library not found |
| `NODE_NOT_FOUND` | 404 | Specific node not found |
| `POLICY_NOT_FOUND` | 404 | Specific policy not found |
| `CONFLICT` | 409 | Generic resource conflict |
| `DUPLICATE_RESOURCE` | 409 | Resource already exists |
| `LIBRARY_PATH_CONFLICT` | 409 | Library path already registered |
| `BUSINESS_RULE_VIOLATION` | 422 | Generic business rule error |
| `NODE_OFFLINE` | 422 | Node is not available |
| `INSUFFICIENT_CAPACITY` | 422 | No nodes available with capacity |
| `ENCODING_FAILED` | 422 | FFmpeg encoding failed |
| `FILE_ACCESS_ERROR` | 422 | Cannot access file on filesystem |
| `DATABASE_ERROR` | 500 | Database operation failed |
| `EXTERNAL_SERVICE_ERROR` | 503 | External service unavailable |
| `FFMPEG_ERROR` | 503 | FFmpeg service failed |
| `NETWORK_ERROR` | 503 | Network request failed |

## Creating New Error Classes

1. **Identify the HTTP status code** (400, 404, 409, 422, 500, 503)
2. **Choose the appropriate parent class** (ValidationError, NotFoundError, etc.)
3. **Create the new error class**:

```typescript
// In the appropriate errors file
export class MyCustomError extends BusinessRuleError {
  constructor(customParam: string, context?: Record<string, unknown>) {
    super(
      `Custom error message: ${customParam}`,
      { customParam, ...context }
    );
    this.errorCode = 'MY_CUSTOM_ERROR';
  }
}
```

4. **Export it** from `errors/index.ts`
5. **Document it** in this README

## Logging

The GlobalExceptionFilter automatically logs errors with structured context:

- **Warn level**: Operational errors (expected, like 404s)
- **Error level**: Unexpected errors (bugs, external failures)

Log format includes:
- Error message and code
- HTTP method, URL, IP
- User agent
- Correlation ID (from `x-correlation-id` header)
- Stack trace (for unexpected errors)
- Custom context from error instance

## Best Practices

### DO ✅

- **Use specific error classes** when available (`LibraryNotFoundError` vs generic `NotFoundError`)
- **Include context** to help debugging (`throw new FileAccessError(path, 'Permission denied')`)
- **Throw early** - validate inputs and fail fast
- **Let errors bubble up** - controllers shouldn't catch service errors
- **Use error codes** for client-side logic, not HTTP status codes

### DON'T ❌

- **Don't catch and swallow** errors without re-throwing
- **Don't throw generic Error()** - use custom classes
- **Don't include sensitive data** in error messages (passwords, tokens, etc.)
- **Don't duplicate error handling** - let the filter do its job
- **Don't use HTTP status codes** for business logic in code

## Testing Errors

```typescript
describe('LibrariesService', () => {
  it('should throw LibraryNotFoundError when library does not exist', async () => {
    await expect(service.findOne('invalid-id'))
      .rejects
      .toThrow(LibraryNotFoundError);
  });

  it('should throw LibraryPathConflictError on duplicate path', async () => {
    await service.create({ path: '/media', ... });

    await expect(service.create({ path: '/media', ... }))
      .rejects
      .toThrow(LibraryPathConflictError);
  });
});
```

## Migration Guide

### Old Code (using generic errors)

```typescript
if (!library) {
  throw new Error('Library not found');
}

if (existingPath) {
  throw new Error('Path already exists');
}
```

### New Code (using custom errors)

```typescript
import { LibraryNotFoundError, LibraryPathConflictError } from '../common/errors';

if (!library) {
  throw new LibraryNotFoundError(id);
}

if (existingPath) {
  throw new LibraryPathConflictError(path);
}
```

## Related Files

- `common/errors/*.ts` - Error class definitions
- `common/filters/global-exception.filter.ts` - Global exception handler
- `main.ts` - Filter registration

## Future Enhancements

- [ ] Add error monitoring integration (Sentry, etc.)
- [ ] Implement i18n for error messages
- [ ] Add error analytics dashboard
- [ ] Create error retry mechanisms for transient failures
