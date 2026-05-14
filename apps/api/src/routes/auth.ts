import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  env,
  randomToken,
  sha256Hex,
  sendEmail,
  magicLinkEmail,
} from '@yt/shared';
import { SESSION_COOKIE_NAME } from '../plugins/auth.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Request a magic link via email.
  app.post('/login', async (req, reply) => {
    const e = env();
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const email = body.email.toLowerCase();
    if (!e.ALLOWED_APPROVER_EMAILS.includes(email)) {
      // Don't reveal which emails are allowed; act successful
      return { ok: true };
    }
    const user = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    const token = randomToken(32);
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const link = `${e.DASHBOARD_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    const tpl = magicLinkEmail(link);
    await sendEmail({ to: email, ...tpl });
    return { ok: true };
  });

  // Consume a magic link → create session cookie.
  app.post('/verify', async (req, reply) => {
    const body = z.object({ token: z.string().min(8) }).parse(req.body);
    const ml = await prisma.magicLink.findUnique({ where: { tokenHash: sha256Hex(body.token) } });
    if (!ml || ml.consumedAt || ml.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'invalid_or_expired' });
    }
    await prisma.magicLink.update({ where: { id: ml.id }, data: { consumedAt: new Date() } });

    const sessionToken = randomToken(32);
    await prisma.session.create({
      data: {
        userId: ml.userId,
        tokenHash: sha256Hex(sessionToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return { ok: true };
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req) => {
    return { user: req.user };
  });

  app.post('/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
};
