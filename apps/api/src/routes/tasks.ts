import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  prisma,
  sendEmail,
  editorRevisionEmail,
  env,
} from '@yt/shared';
import {
  getFileStream,
  uploadStream,
} from '@yt/shared/google/drive';

// EditorTask CRUD.
//   GET    /tasks                       admin: all tasks
//   GET    /tasks/mine                  editor: my pending/in-progress/revision
//   GET    /tasks/:id                   either (editor only their own)
//   POST   /tasks/:id/start             editor
//   POST   /tasks/:id/upload-final      editor — multipart: video + thumbnail
//   POST   /tasks/:id/request-revision  admin
//   POST   /tasks/:id/reassign          admin — change assigned editor
//   GET    /tasks/:id/raw               editor — stream download of raw video
//   GET    /tasks/:id/doc/:docId        editor — stream download of doc

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
        channel: true,
        contentItem: true,
        assignedEditor: { select: { id: true, email: true, name: true } },
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
        status: { in: ['pending', 'in_progress', 'revision_requested'] },
      },
      include: {
        channel: true,
        contentItem: { select: { expectedFilename: true, scheduledPublishAt: true, type: true } },
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

  app.post('/:id/start', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    if (!['pending', 'revision_requested'].includes(ctx.task.status)) {
      return reply.code(409).send({ error: 'wrong_status', message: `Task is ${ctx.task.status}` });
    }
    const updated = await prisma.editorTask.update({
      where: { id: params.id },
      data: { status: 'in_progress', startedAt: ctx.task.startedAt ?? new Date() },
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
    if (task.status !== 'submitted') {
      return reply.code(409).send({ error: 'wrong_status', message: `Task is ${task.status}` });
    }
    await prisma.editorTask.update({
      where: { id: params.id },
      data: { status: 'revision_requested', revisionNotes: body.notes },
    });
    // Also bounce the linked ContentItem so the watcher can re-pick the new file
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

  // Stream-download the raw video for the editor to download locally.
  app.get('/:id/raw', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    const f = await getFileStream(ctx.task.rawDriveFileId);
    reply
      .header('content-type', f.mimeType)
      .header('content-length', String(f.size))
      .header('content-disposition', `attachment; filename="${ctx.task.rawFilename}"`);
    return reply.send(f.stream);
  });

  app.get('/:id/doc/:docId', async (req, reply) => {
    const params = z.object({ id: z.string(), docId: z.string() }).parse(req.params);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    const doc = ctx.task.docs.find((d) => d.id === params.docId);
    if (!doc) return reply.code(404).send({ error: 'doc_not_found' });
    const f = await getFileStream(doc.driveFileId);
    reply
      .header('content-type', f.mimeType)
      .header('content-length', String(f.size))
      .header('content-disposition', `attachment; filename="${doc.filename}"`);
    return reply.send(f.stream);
  });

  // Editor uploads the edited video (and optional thumbnail). Multipart.
  // Fields: video (required file), thumbnail (optional file)
  app.post('/:id/upload-final', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const ctx = await requireAccess(app, req, reply, params.id);
    if (!ctx) return;
    if (!ctx.task.contentItemId) {
      return reply.code(409).send({ error: 'no_content_item' });
    }
    const ci = await prisma.contentItem.findUnique({ where: { id: ctx.task.contentItemId } });
    if (!ci) return reply.code(500).send({ error: 'content_item_missing' });
    if (!ctx.task.channel.driveFolderId) {
      return reply.code(409).send({ error: 'channel_has_no_drive_folder' });
    }

    // Parse multipart parts using Fastify multipart
    type Part = {
      file: NodeJS.ReadableStream;
      filename: string;
      mimetype: string;
      fieldname: string;
    };
    const parts = (req as unknown as { parts: () => AsyncIterableIterator<Part> }).parts();

    let videoUploaded: { id: string; name: string } | null = null;
    let thumbUploaded: { id: string; name: string } | null = null;

    const videoName = ci.expectedFilename;
    // thumbnail filename = same base, .jpg
    const thumbName = videoName.replace(/\.[^.]+$/, '.jpg');

    for await (const part of parts) {
      if (!part.filename) continue;
      if (part.fieldname === 'video') {
        const up = await uploadStream({
          parentFolderId: ctx.task.channel.driveFolderId,
          filename: videoName,
          mimeType: part.mimetype || 'video/mp4',
          body: part.file,
        });
        videoUploaded = { id: up.id, name: videoName };
      } else if (part.fieldname === 'thumbnail') {
        const up = await uploadStream({
          parentFolderId: ctx.task.channel.driveFolderId,
          filename: thumbName,
          mimeType: part.mimetype || 'image/jpeg',
          body: part.file,
        });
        thumbUploaded = { id: up.id, name: thumbName };
      } else {
        // Drain unrecognized field
        part.file.resume();
      }
    }

    if (!videoUploaded) {
      return reply.code(400).send({ error: 'no_video' });
    }

    // Mark task submitted; the existing drive-watcher will pick the file
    // up and move ContentItem → pending_approval. We also pre-write the
    // driveFileId / driveThumbId so the admin doesn't have to wait.
    await prisma.contentItem.update({
      where: { id: ci.id },
      data: {
        driveFileId: videoUploaded.id,
        driveThumbId: thumbUploaded?.id ?? null,
        uploadedAt: new Date(),
        status: 'pending_approval',
      },
    });
    await prisma.editorTask.update({
      where: { id: ctx.task.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
      },
    });
    await prisma.contentEvent.create({
      data: {
        contentItemId: ci.id,
        type: 'matched',
        actorEmail: req.user!.email,
        message: `Editor uploaded ${videoUploaded.name}${thumbUploaded ? ` + ${thumbUploaded.name}` : ''}`,
      },
    });
    return { ok: true, video: videoUploaded, thumbnail: thumbUploaded };
  });
};
