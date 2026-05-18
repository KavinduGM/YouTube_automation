import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  env,
  randomToken,
  sha256Hex,
  verifyPassword,
} from '@yt/shared';
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_DAYS } from '../plugins/auth.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Username + password login. Session cookie lasts 1 year, auto-renews.
  app.post('/login', async (req, reply) => {
    const body = z.object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(200),
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });
    // Use a constant-ish path even on miss to avoid trivial timing oracle.
    const okPassword = user?.passwordHash
      ? await verifyPassword(body.password, user.passwordHash)
      : await verifyPassword(body.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid.');
    if (!user || !user.passwordHash || !okPassword || !user.active) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const sessionToken = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 86400 * 1000);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(sessionToken),
        expiresAt,
      },
    });
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_LIFETIME_DAYS * 86400,
    });
    return { ok: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } };
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req) => {
    const u = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, email: true, name: true, role: true },
    });
    return { user: u };
  });

  app.post('/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // Change own password (any signed-in user)
  app.post('/change-password', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(200),
    }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash) return reply.code(400).send({ error: 'no_password_set' });
    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'wrong_password' });
    const { hashPassword } = await import('@yt/shared');
    const passwordHash = await hashPassword(body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { ok: true };
  });
};
