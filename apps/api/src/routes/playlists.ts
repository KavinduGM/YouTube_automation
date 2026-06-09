import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listPlaylists, createPlaylist } from '@yt/shared/google/youtube';

// Playlist management — lists and creates playlists on the YouTube channel
// connected to one of our internal Channel rows.
//
//   GET  /playlists?channelId=<our_channel_id>             list
//   POST /playlists?channelId=<our_channel_id>             create with { title, description?, privacyStatus? }

export const playlistRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireApprover);

  app.get('/', async (req, reply) => {
    const q = z.object({ channelId: z.string() }).parse(req.query);
    try {
      const playlists = await listPlaylists(q.channelId);
      return { playlists };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return reply.code(502).send({ error: 'youtube_list_failed', message: msg });
    }
  });

  app.post('/', async (req, reply) => {
    if (req.user!.role !== 'admin' && req.user!.role !== 'manager') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const q = z.object({ channelId: z.string() }).parse(req.query);
    const body = z.object({
      title: z.string().min(1).max(150),
      description: z.string().max(5000).optional(),
      privacyStatus: z.enum(['public', 'private', 'unlisted']).default('public'),
    }).parse(req.body);
    try {
      const playlist = await createPlaylist({ channelId: q.channelId, ...body });
      return { playlist };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return reply.code(502).send({ error: 'youtube_create_failed', message: msg });
    }
  });
};
