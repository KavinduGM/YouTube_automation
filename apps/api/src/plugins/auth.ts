import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { prisma, sha256Hex } from '@yt/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

const SESSION_COOKIE = 'yt_session';

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', undefined);

  app.addHook('preHandler', async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!session) return;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return;
    }
    req.user = { id: session.user.id, email: session.user.email };
  });

  app.decorate('requireAuth', async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const authPlugin = fp(plugin);
