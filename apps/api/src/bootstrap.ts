import { prisma, hashPassword, env, logger } from '@yt/shared';

// On API startup, ensure there's at least one admin user with the
// bootstrap credentials so the operator can always sign in.
//
// Behavior:
//  - If a user with username=BOOTSTRAP_ADMIN_USERNAME exists, leave it
//    alone (operator may have rotated the password).
//  - Otherwise create one with the bootstrap password.
//  - Also: clean up any legacy users left over from the magic-link era
//    that have no username AND no password — they cannot log in anyway,
//    and their presence (with unique email) can block re-creating an
//    admin under their old email.
export async function bootstrapAdmin(): Promise<void> {
  const e = env();
  const username = e.BOOTSTRAP_ADMIN_USERNAME;

  // 1. Clean up legacy magic-link users (no username, no password)
  try {
    const cleaned = await prisma.user.deleteMany({
      where: { username: null, passwordHash: null },
    });
    if (cleaned.count > 0) {
      logger.warn({ count: cleaned.count }, 'bootstrap: removed legacy users with no username/password');
    }
  } catch (err) {
    logger.error({ err }, 'bootstrap: legacy cleanup failed (continuing)');
  }

  // 2. Backfill filenamePrefix on legacy channels (uppercased slug, no dashes)
  try {
    const channels = await prisma.channel.findMany({ where: { filenamePrefix: null } });
    for (const c of channels) {
      const prefix = c.slug.toUpperCase().replace(/-/g, '').slice(0, 12);
      try {
        await prisma.channel.update({ where: { id: c.id }, data: { filenamePrefix: prefix } });
        logger.info({ slug: c.slug, prefix }, 'bootstrap: backfilled filenamePrefix');
      } catch {
        // Prefix collision — fall back to slug-derived + numeric suffix
        let n = 2;
        // try up to 50 variants
        for (; n < 50; n++) {
          try {
            await prisma.channel.update({
              where: { id: c.id },
              data: { filenamePrefix: `${prefix}${n}` },
            });
            logger.warn({ slug: c.slug, prefix: `${prefix}${n}` }, 'bootstrap: prefix collision, used variant');
            break;
          } catch { /* try next */ }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'bootstrap: filenamePrefix backfill failed (continuing)');
  }

  // 3. Ensure bootstrap admin exists
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    logger.info({ username }, 'bootstrap: admin already exists, skipping');
    return;
  }
  const passwordHash = await hashPassword(e.BOOTSTRAP_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      username,
      email: e.BOOTSTRAP_ADMIN_EMAIL ?? null,
      role: 'admin',
      passwordHash,
      name: 'Admin',
      active: true,
    },
  });
  logger.warn({ username }, 'bootstrap: created admin user from env defaults — change password ASAP');
}
