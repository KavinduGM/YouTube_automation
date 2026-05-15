import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env, logger } from '@yt/shared';
import { authRoutes } from './routes/auth.js';
import { oauthRoutes } from './routes/oauth.js';
import { channelRoutes } from './routes/channels.js';
import { itemRoutes } from './routes/items.js';
import { authPlugin } from './plugins/auth.js';

async function build() {
  const e = env();
  const app = Fastify({
    // Fastify v5 requires `loggerInstance` for a pre-built pino logger;
    // the `logger` option only accepts a config object.
    loggerInstance: logger,
    bodyLimit: 10 * 1024 * 1024,
  });

  // Allow empty JSON bodies — Fastify v5's default parser throws
  // FST_ERR_CTP_EMPTY_JSON_BODY otherwise, which breaks bodyless POSTs
  // like /items/:id/approve.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = (body as string) ?? '';
    if (s.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(s));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cookie, { secret: e.SESSION_SECRET });
  await app.register(cors, {
    origin: [e.DASHBOARD_URL],
    credentials: true,
  });
  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(oauthRoutes, { prefix: '/oauth' });
  await app.register(channelRoutes, { prefix: '/channels' });
  await app.register(itemRoutes, { prefix: '/items' });

  return app;
}

build()
  .then(async (app) => {
    const e = env();
    await app.listen({ port: e.API_PORT, host: '0.0.0.0' });
    logger.info({ port: e.API_PORT }, 'api listening');
  })
  .catch((err) => {
    logger.fatal({ err }, 'api failed to start');
    process.exit(1);
  });
