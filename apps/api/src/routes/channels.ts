import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@yt/shared';

const SLUG = z.string().regex(/^[a-z][a-z0-9-]*$/, 'slug: lowercase letters, digits, dashes; must start with a letter');
const PREFIX = z.string().regex(/^[A-Z][A-Z0-9]*$/, 'filenamePrefix: uppercase letters/digits, must start with a letter');

const ChannelCreate = z.object({
  slug: SLUG,
  name: z.string().min(1).max(120),
  filenamePrefix: PREFIX,
  hasQuestionVideos: z.boolean().default(false),
  hasAnimationVideos: z.boolean().default(false),
  hasShortVideos: z.boolean().default(true),
});

const ChannelUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  filenamePrefix: PREFIX.optional(),
  hasQuestionVideos: z.boolean().optional(),
  hasAnimationVideos: z.boolean().optional(),
  hasShortVideos: z.boolean().optional(),
  driveFolderId: z.string().nullable().optional(),
  publishedFolderId: z.string().nullable().optional(),
  rawArchiveFolderId: z.string().nullable().optional(),
  defaultSheetId: z.string().nullable().optional(),
});

function shape(c: import('@prisma/client').Channel) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    filenamePrefix: c.filenamePrefix,
    hasQuestionVideos: c.hasQuestionVideos,
    hasAnimationVideos: c.hasAnimationVideos,
    hasShortVideos: c.hasShortVideos,
    youtubeChannelId: c.youtubeChannelId,
    driveFolderId: c.driveFolderId,
    publishedFolderId: c.publishedFolderId,
    rawArchiveFolderId: c.rawArchiveFolderId,
    defaultSheetId: c.defaultSheetId,
    connected: Boolean(c.refreshTokenEnc),
    youtubeConnectedAt: c.youtubeConnectedAt ? c.youtubeConnectedAt.toISOString() : null,
  };
}

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async () => {
    const channels = await prisma.channel.findMany({ orderBy: { name: 'asc' } });
    const driveSheets = await prisma.googleConnection.findFirst();
    return {
      channels: channels.map(shape),
      driveSheets: driveSheets
        ? { email: driveSheets.email, connectedAt: driveSheets.updatedAt.toISOString() }
        : null,
    };
  });

  app.post('/', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'admin_only' });
    const body = ChannelCreate.parse(req.body);
    try {
      const ch = await prisma.channel.create({ data: body });
      return { channel: shape(ch) };
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: string[] } };
      if (e.code === 'P2002') {
        return reply.code(409).send({
          error: 'duplicate',
          message: e.meta?.target?.includes('slug')
            ? `A channel with slug "${body.slug}" already exists.`
            : `A channel with filename prefix "${body.filenamePrefix}" already exists.`,
        });
      }
      throw err;
    }
  });

  app.patch('/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'admin_only' });
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = ChannelUpdate.parse(req.body);
    try {
      const ch = await prisma.channel.update({ where: { id: params.id }, data: body });
      return { channel: shape(ch) };
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'P2002') {
        return reply.code(409).send({ error: 'duplicate_prefix' });
      }
      throw err;
    }
  });

  app.delete('/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'admin_only' });
    const params = z.object({ id: z.string() }).parse(req.params);
    const q = z.object({ force: z.coerce.boolean().optional() }).parse(req.query);

    // Block if there are published / scheduled ContentItems (live YouTube videos)
    const live = await prisma.contentItem.count({
      where: { channelId: params.id, status: { in: ['scheduled', 'published'] } },
    });
    if (live > 0 && !q.force) {
      return reply.code(409).send({
        error: 'has_live_items',
        message: `Channel has ${live} item(s) already on YouTube. Delete those first, or call with ?force=1 to remove the channel and orphan them.`,
      });
    }
    await prisma.channel.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
