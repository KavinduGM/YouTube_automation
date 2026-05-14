import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@yt/shared';

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async () => {
    const channels = await prisma.channel.findMany({ orderBy: { slug: 'asc' } });
    const driveSheets = await prisma.googleConnection.findFirst();
    return {
      channels: channels.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        youtubeChannelId: c.youtubeChannelId,
        driveFolderId: c.driveFolderId,
        defaultSheetId: c.defaultSheetId,
        connected: Boolean(c.refreshTokenEnc),
      })),
      driveSheets: driveSheets ? { email: driveSheets.email } : null,
    };
  });

  app.post('/', async (req, reply) => {
    const body = z.object({
      slug: z.enum(['OAP', 'OAG', 'NUR']),
      name: z.string().min(1),
      driveFolderId: z.string().optional(),
      defaultSheetId: z.string().optional(),
    }).parse(req.body);
    const ch = await prisma.channel.upsert({
      where: { slug: body.slug },
      create: {
        slug: body.slug,
        name: body.name,
        driveFolderId: body.driveFolderId,
        defaultSheetId: body.defaultSheetId,
      },
      update: {
        name: body.name,
        driveFolderId: body.driveFolderId,
        defaultSheetId: body.defaultSheetId,
      },
    });
    return { channel: ch };
  });

  app.patch('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      driveFolderId: z.string().nullable().optional(),
      defaultSheetId: z.string().nullable().optional(),
    }).parse(req.body);
    const ch = await prisma.channel.update({
      where: { id: params.id },
      data: body,
    });
    return { channel: ch };
  });
};
