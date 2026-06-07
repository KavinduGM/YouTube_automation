import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, hashPassword } from '@yt/shared';

// Admin user management. Username/password auth — admin creates the
// editor's credentials once, then hands them over.
//   GET  /users                    list
//   POST /users                    create with { username, password, role, email?, name? }
//   PATCH /users/:id               update name / email / role / active
//   POST  /users/:id/set-password  admin overrides a user's password
//   DELETE /users/:id              remove

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
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
      username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'username may contain letters, digits, . _ -'),
      password: z.string().min(8).max(200),
      email: z.string().email().optional(),
      name: z.string().optional(),
      role: z.enum(['admin', 'manager', 'editor']).default('editor'),
    }).parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: body.username }, body.email ? { email: body.email } : { id: '__never__' }] },
    });
    if (existing) {
      return reply.code(409).send({
        error: 'exists',
        message: existing.username === body.username
          ? `Username "${body.username}" is already taken.`
          : `Email "${body.email}" is already used by another account.`,
      });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash,
      },
      select: { id: true, username: true, email: true, name: true, role: true, active: true },
    });
    return { user };
  });

  app.patch('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      name: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      role: z.enum(['admin', 'manager', 'editor']).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    if (params.id === req.user!.id && body.active === false) {
      return reply.code(400).send({ error: 'cant_disable_self' });
    }
    const user = await prisma.user.update({
      where: { id: params.id },
      data: body,
      select: { id: true, username: true, email: true, name: true, role: true, active: true },
    });
    return { user };
  });

  app.post('/:id/set-password', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ newPassword: z.string().min(8).max(200) }).parse(req.body);
    const passwordHash = await hashPassword(body.newPassword);
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash } });
    return { ok: true };
  });

  app.delete('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    if (params.id === req.user!.id) {
      return reply.code(400).send({ error: 'cant_delete_self' });
    }
    await prisma.user.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
