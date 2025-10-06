#!/usr/bin/env tsx
/**
 * Seed Test Libraries via Database
 * Creates a test node and libraries directly in the database
 */

import { AccelerationType, MediaType, NodeRole, NodeStatus, PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function seedTestLibraries() {
  try {
    console.log('📡 Seeding test libraries via database...');
    console.log('');

    // Step 1: Get the license
    console.log('🔑 Fetching license from database...');
    const license = await prisma.license.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!license) {
      throw new Error('No active license found - run seed first');
    }
    console.log(`   ✅ License: ${license.key}`);
    console.log('');

    // Step 2: Create a test node directly in database
    console.log('🖥️  Creating test node...');
    const node = await prisma.node.create({
      data: {
        name: 'Test Encoding Node',
        apiKey: randomBytes(32).toString('hex'),
        version: '0.1.0',
        acceleration: AccelerationType.CPU,
        status: NodeStatus.ONLINE,
        role: NodeRole.LINKED,
        licenseId: license.id,
        lastHeartbeat: new Date(),
      },
    });
    console.log(`   ✅ Node created: ${node.name} (${node.id})`);
    console.log('');

    // Step 3: Create test libraries directly in database
    console.log('📚 Creating test libraries...');

    const libraries = [
      {
        name: 'Test Anime',
        path: '/media/Anime',
        mediaType: MediaType.ANIME,
        nodeId: node.id,
      },
      {
        name: 'Test Anime Movies',
        path: '/media/Anime Movies',
        mediaType: MediaType.ANIME,
        nodeId: node.id,
      },
      {
        name: 'Test Movies',
        path: '/media/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: node.id,
      },
      {
        name: 'Test TV',
        path: '/media/TV',
        mediaType: MediaType.TV_SHOW,
        nodeId: node.id,
      },
    ];

    for (const libraryData of libraries) {
      const library = await prisma.library.create({
        data: libraryData,
      });
      console.log(`   ✅ ${library.name} → ${library.path}`);
    }

    console.log('');
    console.log('✅ Test libraries seeded!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   • Node: ${node.name}`);
    console.log(`   • Libraries: ${libraries.length} created`);
    console.log('');

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test libraries:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

seedTestLibraries();
