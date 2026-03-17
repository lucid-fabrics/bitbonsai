# BitBonsai Database Quick Start Guide

## Initial Setup (First Time)

### 1. Install Dependencies
```bash
npm install
```

This will install:
- `prisma` (CLI tool)
- `@prisma/client` (TypeScript client)

### 2. Configure Environment
```bash
# Copy the example environment file
cp prisma/.env.example .env

# The default SQLite configuration is already set:
# DATABASE_URL="file:./prisma/bitbonsai.db"
```

### 3. Generate Prisma Client
```bash
npm run prisma:generate
```

This generates TypeScript types and the Prisma Client based on your schema.

### 4. Create Database & Run Migrations
```bash
npm run prisma:migrate
```

When prompted for migration name, use something descriptive like: `init`

This will:
- Create the SQLite database file (`prisma/bitbonsai.db`)
- Apply the schema to create all tables
- Generate a migration file in `prisma/migrations/`

### 5. Seed Development Data
```bash
npm run prisma:seed
```

This will populate your database with:
- 3 sample licenses (FREE, PATREON, COMMERCIAL_PRO)
- 3 nodes (1 main + 2 workers)
- 3 libraries (Movies, TV, Anime)
- 3 policies (encoding presets)
- 6 sample jobs (various stages)
- 10 days of metrics data

### 6. Explore Database (Optional)
```bash
npm run prisma:studio
```

Opens Prisma Studio at http://localhost:5555 - a visual database browser.

---

## Daily Development Workflow

### View Database Contents
```bash
npm run prisma:studio
```

### After Schema Changes

1. **Update `prisma/schema.prisma`** with your changes

2. **Create migration:**
   ```bash
   npm run prisma:migrate
   ```
   Name it descriptively: `add_user_preferences`, `update_job_indexes`, etc.

3. **Regenerate client:**
   ```bash
   npm run prisma:generate
   ```

### Reset Database (Development Only)
```bash
# WARNING: This deletes ALL data
npx prisma migrate reset
```

This will:
1. Drop the database
2. Recreate it
3. Apply all migrations
4. Run seed script automatically

---

## Using Prisma Client in Your Code

### Import and Initialize
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
```

### NestJS Integration (Recommended)
Create a Prisma service:

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

Then inject it into your services:

```typescript
// src/jobs/jobs.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async getActiveJobs(nodeId: string) {
    return this.prisma.job.findMany({
      where: {
        nodeId,
        stage: {
          in: ['QUEUED', 'ENCODING', 'VERIFYING']
        }
      },
      include: {
        policy: true,
        library: true
      }
    });
  }
}
```

---

## Common Operations

### Create a New Job
```typescript
const job = await prisma.job.create({
  data: {
    filePath: '/media/Movies/Example.mkv',
    fileLabel: 'Example Movie.mkv',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: 'QUEUED',
    beforeSizeBytes: BigInt('5368709120'), // 5GB
    nodeId: 'node_123',
    libraryId: 'lib_456',
    policyId: 'pol_789'
  }
});
```

### Update Job Progress
```typescript
await prisma.job.update({
  where: { id: jobId },
  data: {
    stage: 'ENCODING',
    progress: 45.7,
    etaSeconds: 1200
  }
});
```

### Complete a Job
```typescript
const completedJob = await prisma.job.update({
  where: { id: jobId },
  data: {
    stage: 'COMPLETED',
    progress: 100,
    afterSizeBytes: BigInt('2684354560'), // 2.5GB
    savedBytes: BigInt('2684354560'), // 5GB - 2.5GB
    savedPercent: 50.0,
    completedAt: new Date()
  }
});
```

### Query with Relations
```typescript
const nodeWithJobs = await prisma.node.findUnique({
  where: { id: nodeId },
  include: {
    license: true,
    libraries: true,
    jobs: {
      where: {
        stage: 'COMPLETED'
      },
      take: 10,
      orderBy: {
        completedAt: 'desc'
      }
    }
  }
});
```

### Aggregations
```typescript
// Total storage saved
const totalSavings = await prisma.job.aggregate({
  where: {
    stage: 'COMPLETED',
    savedBytes: { gt: 0 }
  },
  _sum: {
    savedBytes: true
  },
  _count: true
});

console.log(`Saved ${totalSavings._sum.savedBytes} bytes across ${totalSavings._count} jobs`);
```

### Transactions
```typescript
// Complete job and update metrics atomically
await prisma.$transaction(async (tx) => {
  // Complete the job
  await tx.job.update({
    where: { id: jobId },
    data: {
      stage: 'COMPLETED',
      completedAt: new Date()
    }
  });

  // Update today's metrics
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await tx.metric.upsert({
    where: {
      date_nodeId_licenseId: {
        date: today,
        nodeId: nodeId,
        licenseId: licenseId
      }
    },
    create: {
      date: today,
      nodeId,
      licenseId,
      jobsCompleted: 1,
      totalSavedBytes: savedBytes
    },
    update: {
      jobsCompleted: { increment: 1 },
      totalSavedBytes: { increment: savedBytes }
    }
  });
});
```

---

## Troubleshooting

### "Can't reach database server"
- **SQLite**: Check that `DATABASE_URL` points to a valid file path
- **PostgreSQL**: Verify the server is running and credentials are correct

### "Prisma Client not found"
Run: `npm run prisma:generate`

### Schema changes not reflected
1. `npm run prisma:migrate` - Create migration
2. `npm run prisma:generate` - Regenerate client
3. Restart your dev server

### BigInt handling in JavaScript
```typescript
// ✅ Correct
const size = BigInt('5368709120');
const sizeFromNumber = BigInt(5368709120);

// ❌ Wrong
const size = 5368709120; // Will be number, not BigInt
```

### JSON field TypeScript typing
```typescript
// Define types for JSON fields
interface LicenseFeatures {
  multiNode: boolean;
  advancedPresets: boolean;
  api: boolean;
}

const license = await prisma.license.findUnique({
  where: { id: licenseId }
});

const features = license.features as LicenseFeatures;
if (features.multiNode) {
  // Type-safe access
}
```

---

## Migration Management

### Create Migration
```bash
npm run prisma:migrate
```

### View Migration Status
```bash
npx prisma migrate status
```

### Apply Migrations (Production)
```bash
npx prisma migrate deploy
```

### Resolve Failed Migration
```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

---

## Performance Tips

### Use `select` to fetch only needed fields
```typescript
// ❌ Fetches all fields
const jobs = await prisma.job.findMany();

// ✅ Only fetches needed fields
const jobs = await prisma.job.findMany({
  select: {
    id: true,
    fileLabel: true,
    stage: true,
    progress: true
  }
});
```

### Use pagination for large result sets
```typescript
const jobs = await prisma.job.findMany({
  skip: (page - 1) * pageSize,
  take: pageSize,
  orderBy: { createdAt: 'desc' }
});
```

### Use indexes (already defined in schema)
All frequently queried fields have indexes. If you notice slow queries, check:
```bash
npx prisma studio
# Navigate to table → Indexes tab
```

---

## Switching to PostgreSQL (Optional)

For multi-node deployments or larger scale:

### 1. Update Schema
Edit `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"  // Changed from "sqlite"
  url      = env("DATABASE_URL")
}
```

### 2. Update Environment
Edit `.env`:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/bitbonsai?schema=public"
```

### 3. Regenerate and Migrate
```bash
npm run prisma:generate
npm run prisma:migrate
```

---

## Useful Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [NestJS Prisma Recipe](https://docs.nestjs.com/recipes/prisma)
- [Prisma Client API Reference](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)

---

## Quick Reference Commands

```bash
# Generate Prisma Client
npm run prisma:generate

# Create and apply migration
npm run prisma:migrate

# Open database GUI
npm run prisma:studio

# Seed database
npm run prisma:seed

# Reset database (DEV ONLY)
npx prisma migrate reset

# View migration status
npx prisma migrate status

# Format schema file
npx prisma format

# Validate schema
npx prisma validate
```

---

Happy coding! 🚀
