import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma, sha256Hex } from '@yt/shared';

export type AppRole = 'admin' | 'manager' | 'editor';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; username: string; email: string | null; role: AppRole };
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    // admin OR manager — used for review/approval and read-only views of schedule
    requireApprover: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const SESSION_COOKIE = 'yt_session';
const SESSION_DAYS = 365;
// Slide renewal: if a session is older than this many days when used,
// extend its expiry back to a year from now.
const RENEW_AFTER_DAYS = 7;

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', undefined);

  app.addHook('preHandler', async (req, reply) => {
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
    if (!session.user.active) return;
    req.user = {
      id: session.user.id,
      username: session.user.username ?? '',
      email: session.user.email,
      role: session.user.role as AppRole,
    };

    // Sliding renewal: if the cookie is being used and is more than
    // RENEW_AFTER_DAYS old, push expiry back to SESSION_DAYS from now.
    const now = Date.now();
    const ageMs = now - session.createdAt.getTime();
    const lastRenewMs = session.expiresAt.getTime() - SESSION_DAYS * 86400_000;
    const sinceLastRenew = Math.max(ageMs, now - lastRenewMs);
    if (sinceLastRenew > RENEW_AFTER_DAYS * 86400_000) {
      const newExpiry = new Date(now + SESSION_DAYS * 86400_000);
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: newExpiry },
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_DAYS * 86400,
      });
    }
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (req.user.role !== 'admin') {
      reply.code(403).send({ error: 'forbidden', message: 'admin only' });
    }
  });

  app.decorate('requireApprover', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      reply.code(403).send({ error: 'forbidden', message: 'admin or manager only' });
    }
  });
};

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_LIFETIME_DAYS = SESSION_DAYS;
export const authPlugin = fp(plugin);
