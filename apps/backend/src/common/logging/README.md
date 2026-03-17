# BitBonsai Logging System

## Overview

BitBonsai uses Winston for structured logging with environment-specific formatting and comprehensive request tracing.

## Features

- ✅ **Structured JSON logging** in production
- ✅ **Pretty-printed logs** in development with colors
- ✅ **Multiple transports** (console, file rotation)
- ✅ **HTTP request/response logging** with timing
- ✅ **Correlation ID support** for request tracing
- ✅ **Contextual logging** with service/class names
- ✅ **Automatic error and rejection handling**
- ✅ **Log levels** (error, warn, info, http, debug)

## Configuration

### Environment Variables

```bash
# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Application environment
NODE_ENV=production

# Application version (for log metadata)
APP_VERSION=0.1.0
```

### Log Levels

| Level | Priority | Usage |
|-------|----------|-------|
| error | 0 | Application errors, exceptions |
| warn | 1 | Warnings, deprecations |
| info | 2 | General informational messages |
| http | 3 | HTTP request/response logs |
| debug | 4 | Detailed debugging information |
| verbose | 5 | Very detailed tracing |

## Usage in Services

### Basic Logging

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  async doSomething(): Promise<void> {
    this.logger.log('Starting operation');
    this.logger.debug('Debug details', { userId: 123 });
    this.logger.warn('Warning message');
    this.logger.error('Error occurred', error.stack);
  }
}
```

### Structured Logging with Context

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../common/logging';

@Injectable()
export class LibrariesService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(LibrariesService.name);
  }

  async createLibrary(dto: CreateLibraryDto): Promise<Library> {
    this.logger.log('Creating library', undefined, {
      libraryName: dto.name,
      path: dto.path,
      nodeId: dto.nodeId,
    });

    try {
      const library = await this.repository.create(dto);

      this.logger.log('Library created successfully', undefined, {
        libraryId: library.id,
        libraryName: library.name,
      });

      return library;
    } catch (error) {
      this.logger.error('Failed to create library', error.stack, undefined, {
        libraryName: dto.name,
        error: error.message,
      });
      throw error;
    }
  }
}
```

### HTTP Request Logging

HTTP requests are automatically logged by the `HttpLoggerMiddleware`:

```json
{
  "level": "http",
  "message": "Incoming request",
  "context": "HTTP",
  "method": "POST",
  "url": "/api/v1/libraries",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "correlationId": "abc-123-def-456",
  "timestamp": "2025-10-02T12:34:56.789Z"
}
```

```json
{
  "level": "http",
  "message": "Request completed",
  "context": "HTTP",
  "method": "POST",
  "url": "/api/v1/libraries",
  "statusCode": 201,
  "responseTime": "45ms",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "correlationId": "abc-123-def-456",
  "timestamp": "2025-10-02T12:34:56.834Z"
}
```

## Log Output Formats

### Development (Console)

```
2025-10-02 12:34:56 info [LibrariesService] Creating library
{
  "libraryName": "Movies",
  "path": "/media/movies",
  "nodeId": "node-123"
}

2025-10-02 12:34:56 error [LibrariesService] Failed to create library
{
  "libraryName": "Movies",
  "error": "Node not found",
  "stack": "Error: Node not found\n    at ..."
}
```

### Production (JSON)

```json
{
  "level": "info",
  "message": "Creating library",
  "context": "LibrariesService",
  "libraryName": "Movies",
  "path": "/media/movies",
  "nodeId": "node-123",
  "service": "bitbonsai-api",
  "environment": "production",
  "version": "0.1.0",
  "timestamp": "2025-10-02T12:34:56.789Z"
}
```

## Log Files (Production)

All logs are stored in the `logs/` directory:

```
logs/
├── combined.log       # All logs (info+)
├── error.log          # Error logs only
├── http.log           # HTTP request logs
├── exceptions.log     # Uncaught exceptions
└── rejections.log     # Unhandled promise rejections
```

### File Rotation

- **Max file size**: 10MB
- **Max files kept**:
  - combined.log: 10 files
  - error.log: 5 files
  - http.log: 5 files
  - exceptions.log: 3 files

## Correlation ID Support

Send a correlation ID in request headers to track requests across services:

```bash
curl -H "X-Correlation-ID: abc-123" https://api.bitbonsai.com/api/v1/libraries
```

The correlation ID will appear in all logs for that request.

## Integration with Error Handling

The GlobalExceptionFilter automatically logs errors with structured context:

```typescript
// This error will be automatically logged
throw new LibraryNotFoundError(id);
```

```json
{
  "level": "warn",
  "message": "Library with identifier '123' not found",
  "errorCode": "LIBRARY_NOT_FOUND",
  "statusCode": 404,
  "method": "GET",
  "url": "/api/v1/libraries/123",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "correlationId": "abc-123",
  "timestamp": "2025-10-02T12:34:56.789Z"
}
```

## Best Practices

### DO ✅

- **Use structured logging** with metadata objects
- **Include correlation IDs** in API requests
- **Log at appropriate levels** (don't use debug in production)
- **Include context** (user IDs, resource IDs, etc.)
- **Log business events** (library created, job completed, etc.)

```typescript
// Good
this.logger.log('Library created', undefined, {
  libraryId: library.id,
  libraryName: library.name,
  nodeId: library.nodeId,
});
```

### DON'T ❌

- **Don't log sensitive data** (passwords, tokens, API keys)
- **Don't log in loops** without sampling
- **Don't use console.log()** - use logger instead
- **Don't log entire objects** - extract relevant fields

```typescript
// Bad
this.logger.log('Library created', undefined, {
  library, // Entire object with potentially sensitive data
});

// Good
this.logger.log('Library created', undefined, {
  libraryId: library.id,
  libraryName: library.name,
});
```

## Logging Patterns

### Performance Monitoring

```typescript
async processJob(jobId: string): Promise<void> {
  const startTime = Date.now();

  try {
    // ... processing logic

    const duration = Date.now() - startTime;
    this.logger.log('Job processed', undefined, {
      jobId,
      duration: `${duration}ms`,
      success: true,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error('Job processing failed', error.stack, undefined, {
      jobId,
      duration: `${duration}ms`,
      error: error.message,
    });
    throw error;
  }
}
```

### Database Operations

```typescript
async findLibraries(): Promise<Library[]> {
  this.logger.debug('Querying libraries from database');

  const libraries = await this.prisma.library.findMany();

  this.logger.log('Libraries retrieved', undefined, {
    count: libraries.length,
  });

  return libraries;
}
```

### External API Calls

```typescript
async callExternalApi(endpoint: string): Promise<Response> {
  this.logger.log('Calling external API', undefined, {
    endpoint,
    method: 'GET',
  });

  try {
    const response = await fetch(endpoint);

    this.logger.log('External API response', undefined, {
      endpoint,
      statusCode: response.status,
      responseTime: '123ms',
    });

    return response;
  } catch (error) {
    this.logger.error('External API call failed', error.stack, undefined, {
      endpoint,
      error: error.message,
    });
    throw error;
  }
}
```

## Monitoring and Alerting

### Production Setup

1. **Log aggregation**: Use ELK stack, Splunk, or Datadog
2. **Alerts**: Set up alerts for error rate spikes
3. **Dashboards**: Create dashboards for:
   - HTTP request rates and latencies
   - Error rates by endpoint
   - Top errors by type
   - Request tracing with correlation IDs

### Sample Queries

```
# Find all errors in the last hour
level:error AND timestamp:[now-1h TO now]

# Trace a specific request
correlationId:"abc-123"

# Find slow requests (>1s)
responseTime:>1000ms

# Count errors by endpoint
level:error | stats count() by url
```

## Testing with Logging

```typescript
describe('LibrariesService', () => {
  let service: LibrariesService;
  let mockLogger: LoggerService;

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService;

    service = new LibrariesService(mockLogger, ...);
  });

  it('should log library creation', async () => {
    await service.createLibrary(dto);

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Creating library',
      undefined,
      expect.objectContaining({
        libraryName: dto.name,
      })
    );
  });
});
```

## Related Files

- `common/logging/logger.config.ts` - Winston configuration
- `common/logging/logger.service.ts` - Logger service wrapper
- `common/logging/http-logger.middleware.ts` - HTTP request logger
- `main.ts` - Logger initialization

## Future Enhancements

- [ ] Add request sampling for high-traffic endpoints
- [ ] Implement log sanitization for PII
- [ ] Add performance metrics collection
- [ ] Create log rotation schedule
- [ ] Integrate with APM tools (New Relic, Datadog)
