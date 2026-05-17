import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  env,
  randomToken,
  sha256Hex,
  sendEmail,
  editorInviteEmail,
  magicLinkEmail,
} from '@yt/shared';

// Admin user-management.
//   POST /users         invite a new user (defaults role=editor)
//   GET  /users         list all
//   PATCH /users/:id    update role / active
//   POST /users/:id/resend-invite

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  app.post('/', async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(['admin', 'editor']).default('editor'),
    }).parse(req.body);
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({
        error: 'exists',
        message: `User with email ${email} already exists.`,
      });
    }

    const user = await prisma.user.create({
      data: { email, name: body.name, role: body.role },
    });

    // Issue a magic link so they can sign in.
    const token = randomToken(32);
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const link = `${env().DASHBOARD_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    const tpl = body.role === 'editor' ? editorInviteEmail({ loginUrl: link }) : magicLinkEmail(link);
    await sendEmail({ to: email, ...tpl });

    return { user };
  });

  app.patch('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      name: z.string().nullable().optional(),
      role: z.enum(['admin', 'editor']).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    if (params.id === req.user!.id && body.active === false) {
      return reply.code(400).send({ error: 'cant_disable_self' });
    }
    const user = await prisma.user.update({
      where: { id: params.id },
      data: body,
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    return { user };
  });

  app.post('/:id/resend-invite', async (req) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: params.id } });
    const token = randomToken(32);
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const link = `${env().DASHBOARD_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    const tpl = user.role === 'editor' ? editorInviteEmail({ loginUrl: link }) : magicLinkEmail(link);
    await sendEmail({ to: user.email, ...tpl });
    return { ok: true };
  });
};
