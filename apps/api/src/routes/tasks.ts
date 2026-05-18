import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  sendEmail,
  editorRevisionEmail,
  env,
} from '@yt/shared';

// EditorTask CRUD.
// Editor uploads finals to Drive manually (no upload endpoint here).
// The watcher detects the final file and flips ContentItem to pending_approval.
//
//   GET    /tasks                       admin: all
//   GET    /tasks/mine                  editor: my open tasks
//   GET    /tasks/:id                   either (editor only their own)
//   PATCH  /tasks/:id/status            editor: set pending|ongoing|submitted
//   POST   /tasks/:id/request-revision  admin: bounce back with notes
//   POST   /tasks/:id/reassign          admin
//   DELETE /tasks/:id                   admin: removes task + frees slot

async function requireAccess(
  app: import('fastify').FastifyInstance,
  req: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  taskId: string,
) {
  void app;
  const task = await prisma.editorTask.findUnique({
    where: { id: taskId },
    include: { contentItem: true, channel: true, docs: true, assignedEditor: true },
  });
  if (!task) {
    reply.code(404).send({ error: 'not_found' });
    return null;
  }
  if (req.user!.role !== 'admin' && task.assignedEditorId !== req.user!.id) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return { task };
}

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req, reply) => {
    if (req.user!.role !== 'admin') {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const q = z.object({
      status: z.string().optional(),
      channelId: z.string().optional(),
      take: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);
    const where: import('@prisma/client').Prisma.EditorTaskWhereInput = {};
    if (q.status) where.status = q.status as import('@prisma/client').EditorTaskStatus;
    if (q.channelId) where.channelId = q.channelId;
    const tasks = await prisma.editorTask.findMany({
      where,
      include: {
        channel: { select: { id: true, slug: true, name: true } },
        contentItem: { select: { id: true, expectedFilename: true, status: true, scheduledPublishAt: true, type: true, format: true } },
        assignedEditor: { select: { id: true, username: true, name: true } },
        docs: true,
      },
      orderBy: { createdAt: 'asc' },
      take: q.take,
    });
    return { tasks };
  });

  app.get('/mine', async (req) => {
    const tasks = await prisma.editorTask.findMany({
      where: {
        assignedEditorId: req.user!.id,
        status: { in: ['pending', 'ongoing', 'submitted', 'revision_requested'] },
      },
      include: {
        channel: { select: { id: true, slug: true, name: true } },
        contentItem: { select: { expectedFilename: true, scheduledPublishAt: true, type: true, format: true } },
        docs: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return { tasks };
  });

  app.get('/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    return { task: ctx.task };
  });

  // Editor (or admin) sets the visible workflow status.
  app.patch('/:id/status', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({
      status: z.enum(['pending', 'ongoing', 'submitted']),
    }).parse(req.body);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    // Editor can move freely between pending → ongoing → submitted.
    // From submitted/revision_requested, they can still bump back via Pending.
    if (ctx.task.status === 'completed' && req.user!.role !== 'admin') {
      return reply.code(409).send({ error: 'task_completed' });
    }
    const data: import('@prisma/client').Prisma.EditorTaskUpdateInput = { status: body.status };
    if (body.status === 'ongoing' && !ctx.task.startedAt) data.startedAt = new Date();
    if (body.status === 'submitted') data.submittedAt = new Date();
    const updated = await prisma.editorTask.update({
      where: { id: params.id },
      data,
    });
    return { task: updated };
  });

  app.post('/:id/request-revision', async (req, reply) => {
    if (req.user!.role !== 'admin') {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ notes: z.string().min(1).max(2000) }).parse(req.body);
    const task = await prisma.editorTask.findUnique({
      where: { id: params.id },
      include: { channel: true, contentItem: true, assignedEditor: true },
    });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    await prisma.editorTask.update({
      where: { id: params.id },
      data: { status: 'revision_requested', revisionNotes: body.notes },
    });
    if (task.contentItemId) {
      await prisma.contentItem.update({
        where: { id: task.contentItemId },
        data: { status: 'planned', driveFileId: null, driveThumbId: null },
      });
    }
    if (task.assignedEditor?.email) {
      const e = env();
      const tpl = editorRevisionEmail({
        channel: task.channel.name,
        finalFilename: task.contentItem?.expectedFilename ?? task.rawFilename,
        notes: body.notes,
        reviewUrl: `${e.DASHBOARD_URL}/editor/tasks/${task.id}`,
      });
      await sendEmail({ to: task.assignedEditor.email, ...tpl }).catch(() => {});
    }
    return { ok: true };
  });

  app.post('/:id/reassign', async (req, reply) => {
    if (req.user!.role !== 'admin') {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ editorId: z.string().nullable() }).parse(req.body);
    await prisma.editorTask.update({
      where: { id: params.id },
      data: { assignedEditorId: body.editorId },
    });
    return { ok: true };
  });

  app.delete('/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const params = z.object({ id: z.string() }).parse(req.params);
    const task = await prisma.editorTask.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    // Free any slot the task's content item was holding
    if (task.contentItemId) {
      await prisma.publishSlot.updateMany({
        where: { assignedItemId: task.contentItemId },
        data: { status: 'available', assignedItemId: null },
      });
      await prisma.contentItem.delete({ where: { id: task.contentItemId } }).catch(() => {});
    }
    await prisma.editorTask.delete({ where: { id: params.id } });
    return { ok: true };
  });
};
