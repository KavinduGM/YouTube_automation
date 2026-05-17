import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@yt/shared';

// Publish slot management. Admin pre-fills a queue of when to publish.
//   GET    /slots?channelId=&type=&month=YYYY-MM     list
//   POST   /slots                                    create one
//   POST   /slots/bulk                               create many
//   PATCH  /slots/:id                                edit
//   DELETE /slots/:id                                remove (only if not assigned)
//   POST   /slots/duplicate                          copy a month forward
//   GET    /slots/queue?channelId=&type=             next available (helper)

export const slotRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async (req) => {
    const q = z.object({
      channelId: z.string().optional(),
      type: z.enum(['long', 'short', 'post']).optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      status: z.string().optional(),
      take: z.coerce.number().int().min(1).max(1000).default(500),
    }).parse(req.query);

    const where: import('@prisma/client').Prisma.PublishSlotWhereInput = {};
    if (q.channelId) where.channelId = q.channelId;
    if (q.type) where.type = q.type;
    if (q.status) where.status = q.status as import('@prisma/client').SlotStatus;
    if (q.month) {
      const [y, m] = q.month.split('-').map(Number);
      const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
      const end = new Date(Date.UTC(y, (m ?? 1), 1));
      where.scheduledAt = { gte: start, lt: end };
    }

    const slots = await prisma.publishSlot.findMany({
      where,
      include: { channel: true, assignedItem: true },
      orderBy: { scheduledAt: 'asc' },
      take: q.take,
    });
    return { slots };
  });

  app.get('/queue', async (req, reply) => {
    const q = z.object({
      channelId: z.string(),
      type: z.enum(['long', 'short', 'post']),
    }).parse(req.query);
    const next = await prisma.publishSlot.findFirst({
      where: { channelId: q.channelId, type: q.type, status: 'available' },
      orderBy: { scheduledAt: 'asc' },
    });
    if (!next) return reply.code(404).send({ error: 'no_slots_available' });
    return { slot: next };
  });

  const Slot = z.object({
    channelId: z.string(),
    type: z.enum(['long', 'short', 'post']),
    scheduledAt: z.coerce.date(),
  });

  app.post('/', async (req, reply) => {
    const body = Slot.parse(req.body);
    try {
      const slot = await prisma.publishSlot.create({ data: body });
      return { slot };
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'P2002') {
        return reply.code(409).send({ error: 'duplicate', message: 'A slot already exists at that time for that channel + type.' });
      }
      throw err;
    }
  });

  app.post('/bulk', async (req) => {
    const body = z.object({ slots: z.array(Slot).max(2000) }).parse(req.body);
    // Use createMany with skipDuplicates so re-runs don't error
    const res = await prisma.publishSlot.createMany({
      data: body.slots,
      skipDuplicates: true,
    });
    return { count: res.count, requested: body.slots.length };
  });

  // Duplicate a month's slot pattern into a target month (preserves
  // weekday + hour:minute, just shifts the date).
  app.post('/duplicate', async (req) => {
    const body = z.object({
      channelId: z.string(),
      sourceMonth: z.string().regex(/^\d{4}-\d{2}$/),
      targetMonth: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.body);
    const [sy, sm] = body.sourceMonth.split('-').map(Number);
    const [ty, tm] = body.targetMonth.split('-').map(Number);
    const srcStart = new Date(Date.UTC(sy, (sm ?? 1) - 1, 1));
    const srcEnd = new Date(Date.UTC(sy, (sm ?? 1), 1));
    const sources = await prisma.publishSlot.findMany({
      where: { channelId: body.channelId, scheduledAt: { gte: srcStart, lt: srcEnd } },
      orderBy: { scheduledAt: 'asc' },
    });
    if (sources.length === 0) return { count: 0 };

    const newSlots: { channelId: string; type: 'long' | 'short' | 'post'; scheduledAt: Date }[] = [];
    for (const s of sources) {
      const d = s.scheduledAt;
      // Take the day-of-month, hours, minutes of the source; apply to target month.
      // If the day doesn't exist in target month (e.g. 31 in Feb), skip.
      const day = d.getUTCDate();
      const target = new Date(Date.UTC(
        ty,
        (tm ?? 1) - 1,
        day,
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
      ));
      if (target.getUTCMonth() !== (tm ?? 1) - 1) continue;
      newSlots.push({
        channelId: s.channelId,
        type: s.type,
        scheduledAt: target,
      });
    }
    const res = await prisma.publishSlot.createMany({
      data: newSlots,
      skipDuplicates: true,
    });
    return { count: res.count, considered: sources.length };
  });

  app.patch('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      scheduledAt: z.coerce.date().optional(),
      type: z.enum(['long', 'short', 'post']).optional(),
      status: z.enum(['available', 'assigned', 'used', 'skipped']).optional(),
    }).parse(req.body);
    const slot = await prisma.publishSlot.update({
      where: { id: params.id },
      data: body,
    });
    return { slot };
  });

  app.delete('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const existing = await prisma.publishSlot.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.assignedItemId) {
      return reply.code(409).send({
        error: 'slot_in_use',
        message: 'This slot is assigned to a content item. Unassign or delete the item first.',
      });
    }
    await prisma.publishSlot.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
