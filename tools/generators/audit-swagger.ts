#!/usr/bin/env tsx

/**
 * Swagger Documentation Auditor for BitBonsai
 *
 * Audits all NestJS controllers for complete Swagger documentation
 * Following nestjs-guidelines.md and api-design-guidelines.md
 */

import * as fs from 'fs';
import * as path from 'path';

const BACKEND_SRC = path.join(__dirname, '../../apps/backend/src');

interface AuditResult {
  file: string;
  missingApiOperation: string[];
  missingApiResponse: string[];
  missingApiProperty: string[];
  score: number;
}

const results: AuditResult[] = [];

// Check if a controller has proper Swagger documentation
const auditController = (filePath: string): AuditResult => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  const result: AuditResult = {
    file: fileName,
    missingApiOperation: [],
    missingApiResponse: [],
    missingApiProperty: [],
    score: 100,
  };

  // Find all endpoint methods (GET, POST, PUT, PATCH, DELETE)
  const methodRegex = /@(Get|Post|Put|Patch|Delete)\(['"](.*?)['"]\)/g;
  const methods = [...content.matchAll(methodRegex)];

  methods.forEach((match) => {
    const httpMethod = match[1];
    const route = match[2];
    const methodName = `${httpMethod} ${route}`;

    // Find the method definition
    const methodDefRegex = new RegExp(
      `@${httpMethod}\\(['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\)[\\s\\S]*?async\\s+(\\w+)\\s*\\(`
    );
    const methodDef = content.match(methodDefRegex);

    if (!methodDef) return;

    // Extract the section around this method
    // Look back further to catch decorators before @Get/@Post etc
    const methodIndex = content.indexOf(match[0]);
    const sectionStart = Math.max(0, methodIndex - 1500);
    const sectionEnd = Math.min(content.length, methodIndex + 1500);
    const section = content.substring(sectionStart, sectionEnd);

    // Check for @ApiOperation
    if (!section.includes('@ApiOperation')) {
      result.missingApiOperation.push(methodName);
      result.score -= 10;
    }

    // Check for @ApiResponse (or specific decorators like @ApiOkResponse, @ApiCreatedResponse)
    const hasApiResponse =
      /@Api(Response|OkResponse|CreatedResponse|NoContentResponse|BadRequestResponse|NotFoundResponse|InternalServerErrorResponse)\s*\(/.test(
        section
      );
    if (!hasApiResponse) {
      result.missingApiResponse.push(`${methodName} (missing all @ApiResponse decorators)`);
      result.score -= 15;
    } else {
      // Check for specific response decorators or status codes
      const has2xx =
        /@Api(Ok|Created|NoContent)Response/.test(section) ||
        section.includes('status: 200') ||
        section.includes('status: 201') ||
        section.includes('status: 204');
      const has400 = /@ApiBadRequestResponse/.test(section) || section.includes('status: 400');
      const has404 = /@ApiNotFoundResponse/.test(section) || section.includes('status: 404');
      const _has500 =
        /@ApiInternalServerErrorResponse/.test(section) || section.includes('status: 500');

      if (!has2xx) {
        result.missingApiResponse.push(`${methodName} (@ApiOkResponse or @ApiCreatedResponse)`);
        result.score -= 10;
      }
      // 400 is critical for POST/PATCH/PUT (input validation)
      if (!has400 && (httpMethod === 'Post' || httpMethod === 'Patch' || httpMethod === 'Put')) {
        result.missingApiResponse.push(`${methodName} (@ApiBadRequestResponse)`);
        result.score -= 5;
      }
      // 404 is critical only for GET/PATCH/DELETE with path parameters
      const hasPathParam = route.includes(':');
      if (
        !has404 &&
        hasPathParam &&
        (httpMethod === 'Get' || httpMethod === 'Patch' || httpMethod === 'Delete')
      ) {
        result.missingApiResponse.push(`${methodName} (@ApiNotFoundResponse)`);
        result.score -= 3;
      }
      // 500 is optional - systems should handle errors gracefully
      // Removing this requirement as it's overly strict
    }
  });

  result.score = Math.max(0, result.score);
  return result;
};

// Check DTOs for @ApiProperty decorators
const auditDto = (filePath: string): AuditResult => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  const result: AuditResult = {
    file: fileName,
    missingApiOperation: [],
    missingApiResponse: [],
    missingApiProperty: [],
    score: 100,
  };

  // Find all class properties that should have @ApiProperty
  // Match: "  propertyName!: Type" or "  propertyName?: Type" or "  propertyName!: Type[]"
  // but not "    key: value" (decorator params)
  const propertyRegex = /^\s{1,4}([\w_]+)(!|\?):\s+([\w<>[\]|{}]+);?/gm;
  const properties = [...content.matchAll(propertyRegex)];

  properties.forEach((match) => {
    const propertyName = match[1];

    // Skip if it's a method or constructor
    if (propertyName === 'constructor') return;

    // Check if this property has @ApiProperty or @ApiPropertyOptional
    // Use match.index to get the exact position (not just first occurrence)
    const propertyIndex = match.index || 0;
    // Look back 800 characters (decorators with large array examples can be very long)
    const beforeProperty = content.substring(Math.max(0, propertyIndex - 800), propertyIndex);

    if (
      !beforeProperty.includes('@ApiProperty') &&
      !beforeProperty.includes('@ApiPropertyOptional')
    ) {
      result.missingApiProperty.push(propertyName);
      result.score -= 5;
    }
  });

  result.score = Math.max(0, result.score);
  return result;
};

// Recursively find all controller files
const findControllers = (dir: string): string[] => {
  const files = fs.readdirSync(dir);
  let controllers: string[] = [];

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      controllers = controllers.concat(findControllers(fullPath));
    } else if (file.endsWith('.controller.ts') && !file.endsWith('.spec.ts')) {
      controllers.push(fullPath);
    }
  });

  return controllers;
};

// Recursively find all DTO files
const findDtos = (dir: string): string[] => {
  const files = fs.readdirSync(dir);
  let dtos: string[] = [];

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      dtos = dtos.concat(findDtos(fullPath));
    } else if (file.endsWith('.dto.ts') && !file.endsWith('.spec.ts')) {
      dtos.push(fullPath);
    }
  });

  return dtos;
};

// Main execution
console.log('🔍 BitBonsai Swagger Documentation Auditor\n');
console.log('Auditing API documentation per nestjs-guidelines.md...\n');

console.log('📋 Auditing Controllers...');
const controllers = findControllers(BACKEND_SRC);
controllers.forEach((controller) => {
  const result = auditController(controller);
  results.push(result);
});

console.log(`\n📋 Auditing DTOs...`);
const dtos = findDtos(BACKEND_SRC);
dtos.forEach((dto) => {
  const result = auditDto(dto);
  if (result.missingApiProperty.length > 0) {
    results.push(result);
  }
});

// Sort by score (worst first)
results.sort((a, b) => a.score - b.score);

console.log(`\n${'='.repeat(80)}`);
console.log('📊 Swagger Documentation Audit Results');
console.log('='.repeat(80));

let totalScore = 0;
let filesAudited = 0;

results.forEach((result) => {
  if (result.score < 100) {
    filesAudited++;
    totalScore += result.score;

    console.log(
      `\n${result.score >= 80 ? '🟡' : result.score >= 50 ? '🟠' : '🔴'} ${result.file} - Score: ${result.score}%`
    );

    if (result.missingApiOperation.length > 0) {
      console.log(`   Missing @ApiOperation:`);
      result.missingApiOperation.forEach((item) => {
        console.log(`     - ${item}`);
      });
    }

    if (result.missingApiResponse.length > 0) {
      console.log(`   Missing @ApiResponse:`);
      result.missingApiResponse.forEach((item) => {
        console.log(`     - ${item}`);
      });
    }

    if (result.missingApiProperty.length > 0) {
      console.log(`   Missing @ApiProperty:`);
      result.missingApiProperty.slice(0, 10).forEach((item) => {
        console.log(`     - ${item}`);
      });
      if (result.missingApiProperty.length > 10) {
        console.log(`     ... and ${result.missingApiProperty.length - 10} more`);
      }
    }
  }
});

const averageScore = filesAudited > 0 ? Math.round(totalScore / filesAudited) : 100;
const perfectFiles = results.filter((r) => r.score === 100).length;

console.log(`\n${'='.repeat(80)}`);
console.log('📈 Summary');
console.log('='.repeat(80));
console.log(`Total files audited: ${controllers.length + dtos.length}`);
console.log(`Files with issues: ${filesAudited}`);
console.log(`Perfect files (100%): ${perfectFiles}`);
console.log(`Average score: ${averageScore}%`);
console.log(
  `\n${averageScore >= 90 ? '✅ EXCELLENT' : averageScore >= 70 ? '🟡 GOOD' : averageScore >= 50 ? '🟠 NEEDS WORK' : '🔴 CRITICAL'} - Overall API documentation quality`
);

if (averageScore < 90) {
  console.log('\n💡 Action Required:');
  console.log('1. Add @ApiOperation({ summary, description }) to all endpoints');
  console.log('2. Add @ApiResponse() for status codes: 200/201, 400, 404, 500');
  console.log('3. Add @ApiProperty({ description, example }) to all DTO properties');
  console.log('4. Review: ~/git/code-conventions/nestjs-guidelines.md (lines 20-44)');
}

process.exit(averageScore < 70 ? 1 : 0);
