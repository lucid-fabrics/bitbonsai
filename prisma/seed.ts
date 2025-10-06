import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Generates a random API key for node authentication
 */
function generateApiKey(): string {
  return `bb_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Generates a random license key
 */
function generateLicenseKey(tier: string): string {
  const prefix = tier.substring(0, 3).toUpperCase();
  return `${prefix}-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

async function main() {
  console.log('🌱 Starting BitBonsai database seed...\n');

  // Clean existing data
  console.log('🧹 Cleaning existing data...');
  await prisma.metric.deleteMany();
  await prisma.job.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.library.deleteMany();
  await prisma.node.deleteMany();
  await prisma.license.deleteMany();
  console.log('✅ Database cleaned\n');

  // ============================================================================
  // 1. Create Default Active License
  // ============================================================================
  console.log('📋 Creating default license...');

  const defaultLicense = await prisma.license.create({
    data: {
      key: generateLicenseKey('FREE'),
      tier: 'FREE',
      status: 'ACTIVE',
      email: 'user@example.com',
      maxNodes: 1,
      maxConcurrentJobs: 2,
      features: {
        multiNode: false,
        advancedPresets: false,
        api: false,
        priorityQueue: false,
        cloudStorage: false,
        webhooks: false,
      },
      validUntil: null, // Perpetual
    },
  });
  console.log(`  ✅ Default FREE license created: ${defaultLicense.key}\n`);

  // ============================================================================
  // 2. Create Default Universal Policy
  // ============================================================================
  console.log('📜 Creating default policy...');

  const defaultPolicy = await prisma.policy.create({
    data: {
      name: 'Universal H.265 (Recommended)',
      preset: 'BALANCED_HEVC',
      targetCodec: 'HEVC',
      targetQuality: 20, // CRF 20 = visually lossless sweet spot
      deviceProfiles: {
        appleTv: true,
        roku: true,
        web: true,
        chromecast: true,
        ps5: true,
        xbox: true,
        fireTV: true,
        androidTV: true,
        lgTV: true,
        samsungTV: true,
      },
      advancedSettings: {
        preset: 'medium',
        tune: 'film',
        minCRF: 18,
        maxCRF: 22,
        keyframeInterval: 240,
        bframes: 4,
        refs: 3,
        meMethod: 'umh',
        subme: 7,
        hwaccel: 'auto',
        audioCodec: 'copy',
        audioFallback: 'aac',
        audioBitrate: '256k',
        subtitleHandling: 'copy',
        containerFormat: 'mkv',
        fastdecode: false,
        zerolatency: false,
        deinterlace: 'auto',
        denoise: 'none',
        twoPass: false,
      },
      atomicReplace: true,
      verifyOutput: true,
      skipSeeding: true,
      libraryId: null, // Global policy
    },
  });
  console.log(`  ✅ Default policy created: ${defaultPolicy.name}\n`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('✅ Seed completed successfully!\n');
  console.log('📋 Summary:');
  console.log(`   • 1 active FREE license`);
  console.log(`   • 1 default universal H.265 policy`);
  console.log(`   • 0 nodes (register your first node)`);
  console.log(`   • 0 libraries (create your first library)`);
  console.log(`   • 0 jobs (jobs will be created automatically)\n`);

  console.log('⭐ DEFAULT POLICY:');
  console.log(`   Name:     "${defaultPolicy.name}"`);
  console.log(`   Codec:    H.265 (HEVC)`);
  console.log(`   Quality:  CRF 20 (visually lossless)`);
  console.log(`   Preset:   medium (balanced)`);
  console.log(`   Hardware: Auto-detect`);
  console.log(`   Devices:  Universal compatibility\n`);

  console.log('🔐 License Key:');
  console.log(`   ${defaultLicense.key}\n`);

  console.log('🚀 Ready to use! Next steps:');
  console.log('   1. Register your first encoding node');
  console.log('   2. Create a library pointing to your media');
  console.log('   3. Start encoding!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
