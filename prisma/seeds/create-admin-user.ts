import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Seed initial admin user
 *
 * SECURITY: Creates admin user with secure bcrypt password
 * Default credentials: admin / BitBonsai2024!
 *
 * IMPORTANT: Change the default password immediately after first login
 */
async function createAdminUser() {
  const BCRYPT_ROUNDS = 10;

  // Check if admin user already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { username: 'admin' },
  });

  if (existingAdmin) {
    console.log('✓ Admin user already exists');
    return;
  }

  // SECURITY: Use environment variable or secure default password
  const defaultPassword = process.env.ADMIN_PASSWORD || 'BitBonsai2024!';
  const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@bitbonsai.local',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('✓ Admin user created successfully');
  console.log('  Username: admin');
  console.log('  Email:', admin.email);
  console.log('  Role: ADMIN');
  console.log('');
  console.log('⚠️  SECURITY WARNING: Change the default password immediately!');
  console.log('  Default password:', defaultPassword);
}

createAdminUser()
  .catch((error) => {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
