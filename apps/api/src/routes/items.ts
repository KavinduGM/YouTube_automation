import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@yt/shared';

const ItemCreate = z.object({
  channelId: z.string(),
  type: z.enum(['long', 'short', 'post']),
  expectedFilename: z.string().regex(/^[A-Z]{2,4}_/, 'must follow filename convention'),
  examTag: z.string().optional(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000),
  tags: z.array(z.string()).default([]),
  categoryId: z.string().default('27'),
  defaultLanguage: z.string().default('en'),
  madeForKids: z.boolean().default(false),
  scheduledPublishAt: z.coerce.date(),
  sheetId: z.string().optional(),
  sheetTab: z.string().optional(),
  sheetRow: z.number().int().optional(),
});

const ItemUpdate = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  defaultLanguage: z.string().optional(),
  madeForKids: z.boolean().optional(),
  scheduledPublishAt: z.coerce.date().optional(),
  examTag: z.string().nullable().optional(),
  sheetId: z.string().nullable().optional(),
  sheetTab: z.string().nullable().optional(),
});

export const itemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // List with filters
  app.get('/', async (req) => {
    const q = z.object({
      status: z.string().optional(),
      channelId: z.string().optional(),
      type: z.enum(['long', 'short', 'post']).optional(),
      take: z.coerce.number().int().min(1).max(200).default(50),
      skip: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const where: import('@prisma/client').Prisma.ContentItemWhereInput = {};
    if (q.status) where.status = q.status as import('@prisma/client').ContentStatus;
    if (q.channelId) where.channelId = q.channelId;
    if (q.type) where.type = q.type;

    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        include: { channel: true },
        orderBy: { scheduledPublishAt: 'asc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.contentItem.count({ where }),
    ]);
    return { items, total };
  });

  // Inbox: pending approval
  app.get('/inbox', async () => {
    const items = await prisma.contentItem.findMany({
      where: { status: 'pending_approval' },
      include: { channel: true },
      orderBy: { uploadedAt: 'asc' },
    });
    return { items };
  });

  app.get('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const item = await prisma.contentItem.findUnique({
      where: { id: params.id },
      include: {
        channel: true,
        approvedBy: true,
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return { item };
  });

  app.post('/', async (req) => {
    const body = ItemCreate.parse(req.body);
    const item = await prisma.contentItem.create({ data: body });
    return { item };
  });

  app.patch('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = ItemUpdate.parse(req.body);
    const existing = await prisma.contentItem.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (['scheduling', 'scheduled', 'published'].includes(existing.status)) {
      return reply.code(409).send({ error: 'item is already scheduled or published' });
    }
    const item = await prisma.contentItem.update({ where: { id: params.id }, data: body });
    await prisma.contentEvent.create({
      data: {
        contentItemId: item.id,
        type: 'edited',
        actorEmail: req.user?.email,
        message: 'Item edited',
        meta: body as object,
      },
    });
    return { item };
  });

  app.post('/:id/approve', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const result = await prisma.contentItem.updateMany({
      where: { id: params.id, status: 'pending_approval' },
      data: { status: 'approved', approvedAt: new Date(), approvedById: req.user!.id },
    });
    if (result.count === 0) return reply.code(409).send({ error: 'not_in_pending_approval' });
    await prisma.contentEvent.create({
      data: {
        contentItemId: params.id,
        type: 'approved',
        actorEmail: req.user?.email,
        message: 'Approved',
      },
    });
    return { ok: true };
  });

  app.post('/:id/reject', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
    const result = await prisma.contentItem.updateMany({
      where: { id: params.id, status: 'pending_approval' },
      data: { status: 'rejected', rejectedReason: body.reason },
    });
    if (result.count === 0) return reply.code(409).send({ error: 'not_in_pending_approval' });
    await prisma.contentEvent.create({
      data: {
        contentItemId: params.id,
        type: 'rejected',
        actorEmail: req.user?.email,
        message: body.reason,
      },
    });
    return { ok: true };
  });

  // Reset a failed item back to approved (manual retry)
  app.post('/:id/retry', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const result = await prisma.contentItem.updateMany({
      where: { id: params.id, status: 'failed' },
      data: { status: 'approved', attempts: 0, lastError: null },
    });
    if (result.count === 0) return reply.code(409).send({ error: 'not_in_failed' });
    return { ok: true };
  });

  // Bulk create — convenient for pre-filling a month
  app.post('/bulk', async (req) => {
    const body = z.object({ items: z.array(ItemCreate).max(500) }).parse(req.body);
    const created = await prisma.$transaction(
      body.items.map((i) => prisma.contentItem.create({ data: i })),
    );
    return { count: created.length };
  });

  app.delete('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const existing = await prisma.contentItem.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (['scheduled', 'scheduling', 'published'].includes(existing.status)) {
      return reply.code(409).send({ error: 'cannot delete an item that has reached YouTube' });
    }
    await prisma.contentItem.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
