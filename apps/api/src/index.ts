import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { env, logger } from '@yt/shared';
import { authRoutes } from './routes/auth.js';
import { oauthRoutes } from './routes/oauth.js';
import { channelRoutes } from './routes/channels.js';
import { itemRoutes } from './routes/items.js';
import { userRoutes } from './routes/users.js';
import { slotRoutes } from './routes/slots.js';
import { taskRoutes } from './routes/tasks.js';
import { authPlugin } from './plugins/auth.js';

async function build() {
  const e = env();
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 50 * 1024 * 1024, // 50 MB for non-multipart routes
  });

  // Allow empty JSON bodies (Fastify v5 throws otherwise on bodyless POSTs).
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
  // Multipart for editor video uploads — generous limits so 2-hour videos work
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10 GB per file
      files: 5,
    },
  });
  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(oauthRoutes, { prefix: '/oauth' });
  await app.register(channelRoutes, { prefix: '/channels' });
  await app.register(itemRoutes, { prefix: '/items' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(slotRoutes, { prefix: '/slots' });
  await app.register(taskRoutes, { prefix: '/tasks' });

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
