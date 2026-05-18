import { prisma, hashPassword, env, logger } from '@yt/shared';

// On API startup, ensure there's at least one admin user. Default
// credentials come from env (BOOTSTRAP_ADMIN_USERNAME / _PASSWORD),
// falling back to ADMIN2026 / Admin26GM@#.
//
// If the user already exists with a different password, we leave it
// alone (operator may have rotated). Only set the password when creating
// the admin for the first time.

export async function bootstrapAdmin(): Promise<void> {
  const e = env();
  const username = e.BOOTSTRAP_ADMIN_USERNAME;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    logger.info({ username }, 'bootstrap: admin already exists, skipping');
    return;
  }
  const passwordHash = await hashPassword(e.BOOTSTRAP_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      username,
      email: e.BOOTSTRAP_ADMIN_EMAIL,
      role: 'admin',
      passwordHash,
      name: 'Admin',
    },
  });
  logger.warn({ username }, 'bootstrap: created admin user from env defaults — change password ASAP');
}
