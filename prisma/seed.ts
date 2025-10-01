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
  // 1. Create Licenses
  // ============================================================================
  console.log('📋 Creating licenses...');

  const freeLicense = await prisma.license.create({
    data: {
      key: generateLicenseKey('FREE'),
      tier: 'FREE',
      status: 'ACTIVE',
      email: 'free.user@example.com',
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
  console.log(`  ✅ FREE license: ${freeLicense.key}`);

  const patreonLicense = await prisma.license.create({
    data: {
      key: generateLicenseKey('PATREON'),
      tier: 'PATREON',
      status: 'ACTIVE',
      email: 'patreon.supporter@example.com',
      maxNodes: 2,
      maxConcurrentJobs: 5,
      features: {
        multiNode: true,
        advancedPresets: true,
        api: true,
        priorityQueue: false,
        cloudStorage: false,
        webhooks: false,
      },
      validUntil: new Date('2026-12-31'), // Annual subscription
    },
  });
  console.log(`  ✅ PATREON license: ${patreonLicense.key}`);

  const commercialLicense = await prisma.license.create({
    data: {
      key: generateLicenseKey('COMMERCIAL_PRO'),
      tier: 'COMMERCIAL_PRO',
      status: 'ACTIVE',
      email: 'business@example.com',
      maxNodes: 20,
      maxConcurrentJobs: 50,
      features: {
        multiNode: true,
        advancedPresets: true,
        api: true,
        priorityQueue: true,
        cloudStorage: true,
        webhooks: true,
      },
      validUntil: new Date('2026-12-31'),
      stripeCustomerId: 'cus_test123',
      stripeSubscriptionId: 'sub_test456',
    },
  });
  console.log(`  ✅ COMMERCIAL_PRO license: ${commercialLicense.key}\n`);

  // ============================================================================
  // 2. Create Nodes
  // ============================================================================
  console.log('🖥️  Creating nodes...');

  const mainNode = await prisma.node.create({
    data: {
      name: 'Main Server',
      role: 'MAIN',
      status: 'ONLINE',
      version: '1.0.0',
      acceleration: 'NVIDIA',
      apiKey: generateApiKey(),
      lastHeartbeat: new Date(),
      uptimeSeconds: 86400, // 1 day
      licenseId: commercialLicense.id,
    },
  });
  console.log(`  ✅ Main node created (NVIDIA GPU)`);

  const workerNode1 = await prisma.node.create({
    data: {
      name: 'Worker Node 1',
      role: 'LINKED',
      status: 'ONLINE',
      version: '1.0.0',
      acceleration: 'INTEL_QSV',
      apiKey: generateApiKey(),
      lastHeartbeat: new Date(),
      uptimeSeconds: 172800, // 2 days
      licenseId: commercialLicense.id,
    },
  });
  console.log(`  ✅ Worker node 1 created (Intel QSV)`);

  const workerNode2 = await prisma.node.create({
    data: {
      name: 'Worker Node 2',
      role: 'LINKED',
      status: 'ONLINE',
      version: '1.0.0',
      acceleration: 'AMD',
      apiKey: generateApiKey(),
      lastHeartbeat: new Date(),
      uptimeSeconds: 259200, // 3 days
      licenseId: commercialLicense.id,
    },
  });
  console.log(`  ✅ Worker node 2 created (AMD GPU)\n`);

  // ============================================================================
  // 3. Create Libraries
  // ============================================================================
  console.log('📚 Creating libraries...');

  const moviesLibrary = await prisma.library.create({
    data: {
      name: 'Movies',
      path: '/media/Movies',
      mediaType: 'MOVIE',
      enabled: true,
      lastScanAt: new Date(),
      totalFiles: 677,
      totalSizeBytes: BigInt('3457890123456'), // ~3.1TB
      nodeId: mainNode.id,
    },
  });
  console.log(`  ✅ Movies library (677 files, 3.1TB)`);

  const tvLibrary = await prisma.library.create({
    data: {
      name: 'TV Shows',
      path: '/media/TV',
      mediaType: 'TV_SHOW',
      enabled: true,
      lastScanAt: new Date(),
      totalFiles: 3791,
      totalSizeBytes: BigInt('5234567890123'), // ~4.8TB
      nodeId: mainNode.id,
    },
  });
  console.log(`  ✅ TV Shows library (3,791 episodes, 4.8TB)`);

  const animeLibrary = await prisma.library.create({
    data: {
      name: 'Anime',
      path: '/media/Anime',
      mediaType: 'TV_SHOW',
      enabled: true,
      lastScanAt: new Date(),
      totalFiles: 1247,
      totalSizeBytes: BigInt('1876543210987'), // ~1.7TB
      nodeId: mainNode.id,
    },
  });
  console.log(`  ✅ Anime library (1,247 episodes, 1.7TB)\n`);

  // ============================================================================
  // 4. Create Policies
  // ============================================================================
  console.log('📜 Creating policies...');

  const balancedPolicy = await prisma.policy.create({
    data: {
      name: 'Balanced HEVC Encoding',
      preset: 'BALANCED_HEVC',
      targetCodec: 'HEVC',
      targetQuality: 23, // CRF 23 = high quality
      deviceProfiles: {
        appleTv: true,
        roku: true,
        web: true,
        chromecast: true,
        ps5: true,
        xbox: true,
      },
      advancedSettings: {
        ffmpegFlags: ['-preset', 'medium', '-tune', 'film'],
        hwaccel: 'auto',
        audioCodec: 'copy',
        subtitleHandling: 'copy',
      },
      atomicReplace: true,
      verifyOutput: true,
      skipSeeding: true,
      libraryId: moviesLibrary.id,
    },
  });
  console.log(`  ✅ Balanced HEVC policy (CRF 23, medium preset)`);

  const fastPolicy = await prisma.policy.create({
    data: {
      name: 'Fast HEVC for TV',
      preset: 'FAST_HEVC',
      targetCodec: 'HEVC',
      targetQuality: 25, // Slightly lower quality for speed
      deviceProfiles: {
        appleTv: true,
        roku: true,
        web: true,
        chromecast: true,
        ps5: false,
        xbox: false,
      },
      advancedSettings: {
        ffmpegFlags: ['-preset', 'fast'],
        hwaccel: 'auto',
        audioCodec: 'copy',
        subtitleHandling: 'copy',
      },
      atomicReplace: true,
      verifyOutput: true,
      skipSeeding: true,
      libraryId: tvLibrary.id,
    },
  });
  console.log(`  ✅ Fast HEVC policy (CRF 25, fast preset)`);

  const qualityPolicy = await prisma.policy.create({
    data: {
      name: 'Quality AV1 for Anime',
      preset: 'QUALITY_AV1',
      targetCodec: 'AV1',
      targetQuality: 28, // AV1 can use higher CRF for same quality
      deviceProfiles: {
        appleTv: false, // Limited AV1 support
        roku: false,
        web: true,
        chromecast: false,
        ps5: false,
        xbox: false,
      },
      advancedSettings: {
        ffmpegFlags: ['-preset', 'slow', '-cpu-used', '4'],
        hwaccel: 'none', // AV1 usually CPU
        audioCodec: 'copy',
        subtitleHandling: 'copy',
      },
      atomicReplace: true,
      verifyOutput: true,
      skipSeeding: true,
      libraryId: animeLibrary.id,
    },
  });
  console.log(`  ✅ Quality AV1 policy (CRF 28, slow preset)\n`);

  // ============================================================================
  // 5. Create Jobs
  // ============================================================================
  console.log('🎬 Creating sample jobs...');

  // Completed jobs
  const completedJob1 = await prisma.job.create({
    data: {
      filePath: '/media/Movies/The Matrix (1999)/The Matrix (1999).mkv',
      fileLabel: 'The Matrix (1999).mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: 'COMPLETED',
      progress: 100,
      beforeSizeBytes: BigInt('8589934592'), // 8GB
      afterSizeBytes: BigInt('4294967296'), // 4GB
      savedBytes: BigInt('4294967296'), // 4GB saved
      savedPercent: 50.0,
      startedAt: new Date('2025-09-30T10:00:00Z'),
      completedAt: new Date('2025-09-30T12:30:00Z'),
      nodeId: mainNode.id,
      libraryId: moviesLibrary.id,
      policyId: balancedPolicy.id,
    },
  });

  const completedJob2 = await prisma.job.create({
    data: {
      filePath: '/media/TV/Breaking Bad/Season 1/Breaking Bad - S01E01.mkv',
      fileLabel: 'Breaking Bad - S01E01.mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: 'COMPLETED',
      progress: 100,
      beforeSizeBytes: BigInt('1610612736'), // 1.5GB
      afterSizeBytes: BigInt('805306368'), // 768MB
      savedBytes: BigInt('805306368'), // 768MB saved
      savedPercent: 50.0,
      startedAt: new Date('2025-09-30T13:00:00Z'),
      completedAt: new Date('2025-09-30T13:45:00Z'),
      nodeId: workerNode1.id,
      libraryId: tvLibrary.id,
      policyId: fastPolicy.id,
    },
  });

  console.log(`  ✅ 2 completed jobs`);

  // Active encoding jobs
  const encodingJob = await prisma.job.create({
    data: {
      filePath: '/media/Movies/Inception (2010)/Inception (2010).mkv',
      fileLabel: 'Inception (2010).mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: 'ENCODING',
      progress: 67.5,
      etaSeconds: 1800, // 30 minutes remaining
      beforeSizeBytes: BigInt('10737418240'), // 10GB
      startedAt: new Date(),
      nodeId: workerNode2.id,
      libraryId: moviesLibrary.id,
      policyId: balancedPolicy.id,
    },
  });

  console.log(`  ✅ 1 encoding job (67.5% complete)`);

  // Queued jobs
  const queuedJob1 = await prisma.job.create({
    data: {
      filePath: '/media/Anime/Attack on Titan/Season 1/Attack on Titan - S01E01.mkv',
      fileLabel: 'Attack on Titan - S01E01.mkv',
      sourceCodec: 'H.264',
      targetCodec: 'AV1',
      stage: 'QUEUED',
      progress: 0,
      beforeSizeBytes: BigInt('1073741824'), // 1GB
      nodeId: mainNode.id,
      libraryId: animeLibrary.id,
      policyId: qualityPolicy.id,
    },
  });

  const queuedJob2 = await prisma.job.create({
    data: {
      filePath: '/media/TV/The Office/Season 1/The Office - S01E01.mkv',
      fileLabel: 'The Office - S01E01.mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: 'QUEUED',
      progress: 0,
      beforeSizeBytes: BigInt('644245094'), // 614MB
      nodeId: workerNode1.id,
      libraryId: tvLibrary.id,
      policyId: fastPolicy.id,
    },
  });

  console.log(`  ✅ 2 queued jobs`);

  // Failed job
  const failedJob = await prisma.job.create({
    data: {
      filePath: '/media/Movies/Corrupted File (2020)/Corrupted File.mkv',
      fileLabel: 'Corrupted File (2020).mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: 'FAILED',
      progress: 23.4,
      beforeSizeBytes: BigInt('5368709120'), // 5GB
      startedAt: new Date('2025-09-30T14:00:00Z'),
      completedAt: new Date('2025-09-30T14:15:00Z'),
      error: 'FFmpeg error: Invalid frame data at 00:15:32',
      nodeId: workerNode2.id,
      libraryId: moviesLibrary.id,
      policyId: balancedPolicy.id,
    },
  });

  console.log(`  ✅ 1 failed job\n`);

  // ============================================================================
  // 6. Create Metrics
  // ============================================================================
  console.log('📊 Creating metrics...');

  // System-wide metrics for the last 7 days
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    await prisma.metric.create({
      data: {
        date,
        nodeId: null, // System-wide
        licenseId: commercialLicense.id,
        jobsCompleted: Math.floor(Math.random() * 50) + 20,
        jobsFailed: Math.floor(Math.random() * 5),
        totalSavedBytes: BigInt(Math.floor(Math.random() * 100000000000) + 50000000000),
        avgThroughputFilesPerHour: Math.random() * 10 + 5,
        codecDistribution: {
          'H.264': Math.floor(Math.random() * 40) + 40, // 40-80%
          HEVC: Math.floor(Math.random() * 30) + 15, // 15-45%
          AV1: Math.floor(Math.random() * 10), // 0-10%
        },
      },
    });
  }

  console.log(`  ✅ 7 days of system-wide metrics`);

  // Per-node metrics for today
  await prisma.metric.create({
    data: {
      date: today,
      nodeId: mainNode.id,
      licenseId: commercialLicense.id,
      jobsCompleted: 15,
      jobsFailed: 1,
      totalSavedBytes: BigInt('32212254720'), // ~30GB
      avgThroughputFilesPerHour: 8.5,
      codecDistribution: {
        'H.264': 60,
        HEVC: 35,
        AV1: 5,
      },
    },
  });

  await prisma.metric.create({
    data: {
      date: today,
      nodeId: workerNode1.id,
      licenseId: commercialLicense.id,
      jobsCompleted: 22,
      jobsFailed: 0,
      totalSavedBytes: BigInt('48318382080'), // ~45GB
      avgThroughputFilesPerHour: 12.3,
      codecDistribution: {
        'H.264': 55,
        HEVC: 40,
        AV1: 5,
      },
    },
  });

  await prisma.metric.create({
    data: {
      date: today,
      nodeId: workerNode2.id,
      licenseId: commercialLicense.id,
      jobsCompleted: 18,
      jobsFailed: 2,
      totalSavedBytes: BigInt('38654705664'), // ~36GB
      avgThroughputFilesPerHour: 9.8,
      codecDistribution: {
        'H.264': 65,
        HEVC: 30,
        AV1: 5,
      },
    },
  });

  console.log(`  ✅ Node-specific metrics for today\n`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('✅ Seed completed successfully!\n');
  console.log('📋 Summary:');
  console.log(`   • 3 licenses (FREE, PATREON, COMMERCIAL_PRO)`);
  console.log(`   • 3 nodes (1 main + 2 workers)`);
  console.log(`   • 3 libraries (Movies, TV, Anime)`);
  console.log(`   • 3 policies (Balanced HEVC, Fast HEVC, Quality AV1)`);
  console.log(`   • 6 jobs (2 completed, 1 encoding, 2 queued, 1 failed)`);
  console.log(`   • 10 metrics (7 system-wide + 3 node-specific)\n`);

  console.log('🔐 Test License Keys:');
  console.log(`   FREE:            ${freeLicense.key}`);
  console.log(`   PATREON:         ${patreonLicense.key}`);
  console.log(`   COMMERCIAL_PRO:  ${commercialLicense.key}\n`);

  console.log('🚀 Ready to start development!');
  console.log('   Run: npm run prisma:studio');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
