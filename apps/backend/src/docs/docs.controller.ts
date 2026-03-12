import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  OnModuleInit,
  Param,
  Res,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../auth/guards/public.decorator';

@ApiTags('Documentation')
@Controller('docs')
@Public() // Make docs publicly accessible
export class DocsController implements OnModuleInit {
  private readonly logger = new Logger(DocsController.name);
  private readonly docsPath = join(process.cwd(), 'apps', 'backend', 'docs');

  onModuleInit() {
    this.logger.log(`📚 Docs path: ${this.docsPath}`);
    try {
      const files = readdirSync(this.docsPath);
      this.logger.log(`📚 Available docs: ${files.join(', ')}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`📚 Failed to read docs directory: ${message}`);
    }
  }

  @Get(':filename')
  @ApiOperation({
    summary: 'Get documentation file',
    description: 'Retrieves a markdown documentation file by filename',
  })
  @ApiParam({
    name: 'filename',
    description: 'Name of the documentation file (e.g., "REBALANCING")',
    example: 'REBALANCING',
  })
  @ApiOkResponse({
    description: 'Markdown content',
    schema: {
      type: 'string',
      example: '# Documentation\n\nContent here...',
    },
  })
  @ApiNotFoundResponse({
    description: 'Documentation file not found',
  })
  getDoc(@Param('filename') filename: string, @Res() res: Response) {
    // Sanitize filename (prevent directory traversal)
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = join(this.docsPath, `${safeName}.md`);

    this.logger.debug(`📚 Looking for: ${filePath} (exists: ${existsSync(filePath)})`);

    if (!existsSync(filePath)) {
      throw new NotFoundException(`Documentation file "${filename}" not found at ${filePath}`);
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(content);
    } catch (_error) {
      throw new NotFoundException(`Failed to read documentation file "${filename}"`);
    }
  }
}
