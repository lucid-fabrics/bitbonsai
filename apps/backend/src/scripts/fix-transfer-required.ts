#!/usr/bin/env node
/**
 * Migration Script: Fix transferRequired field for existing jobs
 *
 * This script updates the transferRequired field for all existing jobs based on
 * the current node's hasSharedStorage configuration.
 *
 * Logic:
 * - If target node has hasSharedStorage=true AND job originated from the same node
 *   -> transferRequired should be false (NFS access)
 * - If target node has hasSharedStorage=false OR job originated from different node
 *   -> transferRequired should be true (file transfer needed)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTransferRequired() {
  console.log('🔧 Starting migration: Fix transferRequired for existing jobs...\n');

  try {
    // Get all jobs with their node and library information
    const jobs = await prisma.job.findMany({
      include: {
        node: true,
        library: true,
      },
    });

    console.log(`📊 Found ${jobs.length} jobs to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const job of jobs) {
      const targetNode = job.node;
      const sourceNodeId = job.library.nodeId;

      // Determine if transfer is required based on current configuration
      const shouldRequireTransfer = !targetNode.hasSharedStorage && targetNode.id !== sourceNodeId;

      // Only update if the value is different from current
      if (job.transferRequired !== shouldRequireTransfer) {
        await prisma.job.update({
          where: { id: job.id },
          data: { transferRequired: shouldRequireTransfer },
        });

        console.log(
          `✅ Updated job ${job.id.substring(0, 8)}... (${job.filePath.split('/').pop()}):`
        );
        console.log(
          `   Node: ${targetNode.name} (hasSharedStorage: ${targetNode.hasSharedStorage})`
        );
        console.log(`   transferRequired: ${job.transferRequired} -> ${shouldRequireTransfer}\n`);

        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Updated: ${updatedCount} jobs`);
    console.log(`   ⏭️  Skipped: ${skippedCount} jobs (already correct)`);
    console.log(`   📊 Total:   ${jobs.length} jobs\n`);

    console.log('✨ Migration completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixTransferRequired();
