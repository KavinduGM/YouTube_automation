import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@yt/shared';

// Per-month Drive folder configuration. Each row is one (channel × month).
//   GET  /channel-months                       all
//   GET  /channel-months?channelId=&month=     filter
//   POST /channel-months                       upsert (channelId + month is unique)
//   PATCH /channel-months/:id                  patch fields
//   DELETE /channel-months/:id

const MONTH_RE = /^\d{4}-\d{2}$/;

export const channelMonthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async (req) => {
    const q = z.object({
      channelId: z.string().optional(),
      month: z.string().regex(MONTH_RE).optional(),
    }).parse(req.query);
    const where: import('@prisma/client').Prisma.ChannelMonthWhereInput = {};
    if (q.channelId) where.channelId = q.channelId;
    if (q.month) where.month = q.month;
    const rows = await prisma.channelMonth.findMany({
      where,
      include: { channel: { select: { id: true, slug: true, name: true } } },
      orderBy: [{ month: 'desc' }, { channelId: 'asc' }],
    });
    return { months: rows };
  });

  app.post('/', async (req, reply) => {
    const body = z.object({
      channelId: z.string(),
      month: z.string().regex(MONTH_RE, 'month must be YYYY-MM'),
      driveFolderId: z.string().nullable().optional(),
      publishedFolderId: z.string().nullable().optional(),
      rawArchiveFolderId: z.string().nullable().optional(),
      defaultSheetId: z.string().nullable().optional(),
    }).parse(req.body);
    const row = await prisma.channelMonth.upsert({
      where: { channelId_month: { channelId: body.channelId, month: body.month } },
      create: body,
      update: {
        driveFolderId: body.driveFolderId,
        publishedFolderId: body.publishedFolderId,
        rawArchiveFolderId: body.rawArchiveFolderId,
        defaultSheetId: body.defaultSheetId,
      },
    });
    return { month: row };
  });

  app.patch('/:id', async (req) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      driveFolderId: z.string().nullable().optional(),
      publishedFolderId: z.string().nullable().optional(),
      rawArchiveFolderId: z.string().nullable().optional(),
      defaultSheetId: z.string().nullable().optional(),
    }).parse(req.body);
    const row = await prisma.channelMonth.update({ where: { id: params.id }, data: body });
    return { month: row };
  });

  app.delete('/:id', async (req) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    await prisma.channelMonth.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
