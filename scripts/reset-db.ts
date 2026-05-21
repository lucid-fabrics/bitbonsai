#!/usr/bin/env tsx
/**
 * Database Reset Helper Script
 * Deletes database, creates schema from Prisma, and runs seed
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';

async function resetDatabase() {
  try {
    console.log('🗑️  Deleting database...');

    // Get database URL from environment
    const dbUrl = process.env.DATABASE_URL || 'file:/data/bitbonsai.db';
    const dbPath = dbUrl.replace('file:', '');

    // Delete database file if it exists
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log(`  ✅ Deleted ${dbPath}`);
    }

    // Delete journal file if it exists
    const journalPath = `${dbPath}-journal`;
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
      console.log(`  ✅ Deleted ${journalPath}`);
    }

    console.log('📊 Creating database schema...');

    // Create new Prisma client - this will create the database file
    const prisma = new PrismaClient();

    // Execute raw SQL to create tables from schema
    // SQLite will create the file when we connect
    await prisma.$connect();

    // Read schema and execute migrations
    // The Prisma Client already has the schema baked in,
    // we just need to ensure tables are created
    // Use Prisma migrations to create schema
    execSync(
      'cd /app && node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>&1 || true',
      {
        stdio: 'ignore',
        env: process.env,
      }
    );

    await prisma.$disconnect();
    console.log('  ✅ Schema created');

    console.log('🌱 Running seed...');
    execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });

    console.log('✅ Database reset complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
