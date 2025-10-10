import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { NodesService } from '../../nodes/nodes.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(NodesService)
    private readonly nodesService: NodesService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    // Validate API key exists in database
    const node = await this.nodesService.findByApiKey(apiKey);
    if (!node) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach node to request for use in controllers
    request.node = node;
    return true;
  }
}
