#!/usr/bin/env tsx

import { PrismaClient, AdminRole } from '@prisma/license-client';
import * as bcrypt from 'bcrypt';

async function main() {
  const prisma = new PrismaClient();

  console.log('Creating first admin user...\n');

  // Check if any admin users already exist
  const existingAdmins = await prisma.adminUser.count();
  if (existingAdmins > 0) {
    console.log(`⚠️  Warning: ${existingAdmins} admin user(s) already exist.`);
    console.log('This script is intended for initial setup only.');
    console.log('Use the admin dashboard to create additional users.\n');

    const continueAnyway = process.argv.includes('--force');
    if (!continueAnyway) {
      console.log('Run with --force to create admin anyway.');
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  // Admin user details
  const email = process.env.ADMIN_EMAIL || 'admin@bitbonsai.app';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.ADMIN_NAME || 'System Administrator';

  // Hash password
  console.log('Hashing password...');
  const passwordHash = await bcrypt.hash(password, 10);

  // Create admin user
  console.log('Creating admin user...');
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log('\n✅ Admin user created successfully!\n');
  console.log('Credentials:');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  Role:     SUPER_ADMIN`);
  console.log(`  ID:       ${admin.id}\n`);
  console.log('⚠️  IMPORTANT: Change the password after first login!\n');
  console.log('Login at: https://bitbonsai.app/admin/login\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Error creating admin user:', error);
  process.exit(1);
});
