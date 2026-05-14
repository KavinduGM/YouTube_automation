import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '@yt/shared';
import {
  buildAuthUrl,
  parseState,
  exchangeCode,
  saveYouTubeConnection,
  saveDriveSheetsConnection,
} from '@yt/shared/google/auth';

// OAuth flows. Two kinds:
//   1) /oauth/google/start?kind=youtube&channelId=...   (per-channel YouTube grant)
//   2) /oauth/google/start?kind=drive_sheets             (single Drive+Sheets grant)
//
// Callback: /oauth/google/callback?code=...&state=...

export const oauthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/google/start', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = z.object({
      kind: z.enum(['youtube', 'drive_sheets']),
      channelId: z.string().optional(),
    }).parse(req.query);

    if (q.kind === 'youtube' && !q.channelId) {
      return reply.code(400).send({ error: 'channelId required for kind=youtube' });
    }

    const url = buildAuthUrl({
      kind: q.kind,
      channelId: q.channelId,
      loginEmail: req.user?.email,
    });
    return reply.redirect(url);
  });

  // Public — Google calls back here after user consents. We re-validate state.
  app.get('/google/callback', async (req, reply) => {
    const e = env();
    const q = z.object({
      code: z.string().min(1),
      state: z.string().min(1),
      error: z.string().optional(),
    }).parse(req.query);

    if (q.error) {
      return reply.redirect(`${e.DASHBOARD_URL}/channels?oauth_error=${encodeURIComponent(q.error)}`);
    }

    let state: ReturnType<typeof parseState>;
    try { state = parseState(q.state); }
    catch { return reply.code(400).send({ error: 'bad_state' }); }

    // Exchange code
    const tok = await exchangeCode(q.code);

    if (state.kind === 'youtube') {
      if (!state.channelId) return reply.code(400).send({ error: 'missing channelId in state' });
      await saveYouTubeConnection(state.channelId, {
        refreshToken: tok.refreshToken,
        scopes: tok.scopes,
      });
      return reply.redirect(`${e.DASHBOARD_URL}/channels?connected=youtube&channelId=${state.channelId}`);
    } else {
      if (!tok.email) return reply.code(400).send({ error: 'no_email_in_id_token' });
      await saveDriveSheetsConnection({
        email: tok.email,
        refreshToken: tok.refreshToken,
        scopes: tok.scopes,
      });
      return reply.redirect(`${e.DASHBOARD_URL}/channels?connected=drive_sheets`);
    }
  });
};
