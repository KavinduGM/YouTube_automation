// Routes called by the Content Automation system (separate project).
// Authenticated by AUTOMATION_BEARER (NOT session cookies) so the calling
// service can plan webinar uploads without going through a browser.
//
// Mount prefix: /automation
//   POST /automation/items   create a planned ContentItem
//
// If AUTOMATION_BEARER is not set in env, every route here returns 503 so
// the integration is opt-in.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, env } from '@yt/shared';

const PlanItem = z.object({
  // Channel filename prefix as defined on the Channel row, e.g. 'OAP'.
  channel: z.string().min(1).max(8),
  type: z.enum(['long', 'short', 'post']).default('long'),
  format: z.enum(['question', 'animation']).nullable().optional(),
  // Pre-built filename in the YT app's strict convention; see README §
  // "Filename convention".
  filename: z.string().regex(/^[A-Z][A-Z0-9]+_/, 'must follow filename convention'),
  examTag: z.string().optional(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000),
  tags: z.array(z.string()).default([]),
  categoryId: z.string().default('27'),
  defaultLanguage: z.string().default('en-US'),
  recordingCountry: z.string().default('US'),
  madeForKids: z.boolean().default(false),
  scheduledPublishAt: z.coerce.date(),

  // Optional traceability — not stored on ContentItem in v1, but logged as a
  // ContentEvent so you can correlate with the source automation item.
  source: z.string().default('automation'),
  sourceRef: z.string().optional(),
});

export const automationRoutes: FastifyPluginAsync = async (app) => {
  const e = env();

  // Per-plugin bearer auth hook. Scoped to /automation/* only — does not
  // affect any other route's existing cookie auth.
  app.addHook('onRequest', async (req, reply) => {
    if (!e.AUTOMATION_BEARER) {
      return reply.code(503).send({
        error: 'automation_integration_disabled',
        hint: 'set AUTOMATION_BEARER in this app\'s env to enable',
      });
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const token = auth.slice('Bearer '.length).trim();
    if (token !== e.AUTOMATION_BEARER) {
      return reply.code(401).send({ error: 'invalid_bearer' });
    }
  });

  app.get('/ping', async () => ({ ok: true, ts: new Date().toISOString() }));

  app.post('/items', async (req, reply) => {
    const body = PlanItem.parse(req.body);

    // Resolve channel by filenamePrefix (the field the YT app uses to map
    // codes like "OAP"/"OAG"/"NUR" to channel IDs).
    const channel = await prisma.channel.findUnique({ where: { filenamePrefix: body.channel } });
    if (!channel) {
      return reply.code(404).send({
        error: 'channel_not_found',
        message: `No channel with filenamePrefix "${body.channel}"`,
      });
    }

    try {
      const item = await prisma.contentItem.create({
        data: {
          channelId: channel.id,
          type: body.type,
          format: body.format ?? null,
          expectedFilename: body.filename,
          examTag: body.examTag ?? null,
          title: body.title,
          description: body.description,
          tags: body.tags,
          categoryId: body.categoryId,
          defaultLanguage: body.defaultLanguage,
          recordingCountry: body.recordingCountry,
          madeForKids: body.madeForKids,
          scheduledPublishAt: body.scheduledPublishAt,
          status: 'planned',
        },
      });

      // Audit trail — gives you a paper trail back to the automation system
      // without needing to add columns to ContentItem.
      await prisma.contentEvent.create({
        data: {
          contentItemId: item.id,
          type: 'created_by_automation',
          actorEmail: null,
          message: 'Planned via automation integration',
          meta: { source: body.source, sourceRef: body.sourceRef ?? null },
        },
      });

      return reply.code(201).send({ id: item.id });
    } catch (err) {
      const e2 = err as { code?: string; meta?: { target?: string[] } };
      if (e2.code === 'P2002' && e2.meta?.target?.includes('expectedFilename')) {
        return reply.code(409).send({
          error: 'duplicate_filename',
          message: `An item with filename "${body.filename}" already exists.`,
        });
      }
      throw err;
    }
  });
};
