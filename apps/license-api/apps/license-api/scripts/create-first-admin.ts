import { AdminRole, PrismaClient } from '@prisma/license-client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@bitbonsai.app';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.ADMIN_NAME || 'System Administrator';
  const force = process.argv.includes('--force');

  const existingAdmins = await prisma.adminUser.count();

  if (existingAdmins > 0 && !force) {
    console.error('❌ Admin users already exist. Use --force to create anyway.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log('✅ Admin user created successfully!');
  console.log('');
  console.log(`Email:    ${admin.email}`);
  console.log(`Name:     ${admin.name}`);
  console.log(`Role:     ${admin.role}`);
  console.log(`Password: ${password}`);
  console.log('');
  console.log('⚠️  IMPORTANT: Change this password immediately after first login!');
}

main()
  .catch((e) => {
    console.error('Error creating admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
