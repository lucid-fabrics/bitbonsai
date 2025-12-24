import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_METADATA_KEY, AuditMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.reflector.get<AuditMetadata>(AUDIT_METADATA_KEY, context.getHandler());

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || 'admin'; // TODO: Extract from auth context
    const ipAddress = request.ip || request.socket.remoteAddress;
    const userAgent = request.headers['user-agent'];

    return next.handle().pipe(
      tap((result) => {
        // Log after successful execution
        const entityId = result?.id || 'unknown';
        const action = metadata.action || request.method;

        this.auditService.log({
          action: action.toUpperCase(),
          entityType: metadata.entityType,
          entityId,
          userId,
          ipAddress,
          userAgent,
          changes: result,
        });
      })
    );
  }
}
