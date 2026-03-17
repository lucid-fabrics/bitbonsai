#!/usr/bin/env ts-node
/**
 * BitBonsai - SQLite to PostgreSQL Migration Script
 *
 * This script migrates all data from the SQLite database to PostgreSQL.
 * It preserves all relationships and IDs to ensure data integrity.
 *
 * Usage:
 *   1. Ensure PostgreSQL is running and DATABASE_URL points to PostgreSQL
 *   2. Run: npx ts-node scripts/migrate-sqlite-to-postgres.ts
 */

import {
  PrismaClient as PrismaClientPostgres,
  PrismaClient as PrismaClientSQLite,
} from '@prisma/client';

const SQLITE_URL = process.env.SQLITE_DATABASE_URL || 'file:./prisma/bitbonsai.db';
const POSTGRES_URL = process.env.DATABASE_URL;

if (!POSTGRES_URL || POSTGRES_URL.startsWith('file:')) {
  console.error('❌ ERROR: DATABASE_URL must be set to PostgreSQL connection string');
  console.error('Example: DATABASE_URL="postgresql://user:password@host:5432/database"');
  process.exit(1);
}

async function migrateData() {
  console.log('🔄 Starting migration from SQLite to PostgreSQL...');
  console.log(`   SQLite:     ${SQLITE_URL}`);
  console.log(`   PostgreSQL: ${POSTGRES_URL}`);
  console.log('');

  // Connect to both databases
  const sqliteClient = new PrismaClientSQLite({
    datasources: { db: { url: SQLITE_URL } },
  });

  const postgresClient = new PrismaClientPostgres({
    datasources: { db: { url: POSTGRES_URL } },
  });

  try {
    await sqliteClient.$connect();
    await postgresClient.$connect();
    console.log('✅ Connected to both databases');
    console.log('');

    // Order matters due to foreign key relationships
    const tables = [
      'Settings',
      'User',
      'License',
      'Node',
      'NodeRegistrationRequest',
      'StorageShare',
      'Library',
      'Policy',
      'Job',
      'JobHistory',
      'Metric',
    ];

    for (const table of tables) {
      try {
        console.log(`📋 Migrating ${table}...`);

        // @ts-expect-error - Dynamic table access
        const records =
          await sqliteClient[table.charAt(0).toLowerCase() + table.slice(1)].findMany();

        if (records.length === 0) {
          console.log(`   ⏭️  No records to migrate`);
          continue;
        }

        // @ts-expect-error - Dynamic table access
        await postgresClient[table.charAt(0).toLowerCase() + table.slice(1)].createMany({
          data: records,
          skipDuplicates: true,
        });

        console.log(`   ✅ Migrated ${records.length} ${table} records`);
      } catch (error: any) {
        console.error(`   ❌ Failed to migrate ${table}:`, error.message);
        throw error;
      }
    }

    console.log('');
    console.log('🎉 Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Update main node DATABASE_URL to PostgreSQL');
    console.log('2. Update child nodes to connect to main node PostgreSQL');
    console.log('3. Restart all nodes');
  } catch (error: any) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sqliteClient.$disconnect();
    await postgresClient.$disconnect();
  }
}

migrateData();
